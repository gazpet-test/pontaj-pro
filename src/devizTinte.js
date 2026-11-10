// ═══════════════════════════════════════════════════════════════════════════
// devizTinte.js — raportul zilnic legat de devize (migrarea 20261208a), logica pură comună: telefonul (/m), tabul
// Execuție → „📋 Deviz vs executat” și exportul. Calculul țintelor NU e aici: vine gata din v_executie_tinte (o singură
// definiție, L19). Aici: blocurile pe obiecte din raport, validarea liniilor (aceleași reguli ca fn_raport_lucrari_salveaza),
// etichetele alertelor, ordinea rândurilor și potrivirea PROPUSĂ obiect din deviz ↔ unitate (o confirmă omul).
// ═══════════════════════════════════════════════════════════════════════════
import { parseNumar } from './izoDocumenteLogica.js'
import { norm } from './lib/diacritice.js'

/** Amprenta setului gol de linii (md5 de șirul gol) — ce trimite un raport care n-avea linii (fn_raport_lucrari_amprenta_linii). */
export const AMPRENTA_GOL = 'd41d8cd98f00b204e9800998ecf8427e'
export const MAX_LINII = 500
export const MAX_CANTITATE = 10000000

export const ALERTE = [
  { cod: 'peste_deviz', eticheta: 'Peste deviz', detaliu: 'executat peste cantitatea din deviz — posibile lucrări suplimentare de cerut', culoare: '#F85149' },
  { cod: 'in_urma', eticheta: 'În urmă', detaliu: '% executat sub % planificat cu mai mult decât pragul', culoare: '#F0883E' },
  { cod: 'fara_raport', eticheta: 'Fără raport', detaliu: 'obiect în lucru fără raport în ultimele zile (pragul din setări)', culoare: '#D29922' },
  { cod: 'fara_tinta', eticheta: 'Fără țintă', detaliu: 'executat pe o activitate fără cantitate în devizul obiectului', culoare: '#BC8CFF' },
  { cod: 'fara_obiect', eticheta: 'Fără obiect', detaliu: 'cantități raportate fără obiect (sau pe un obiect din alt proiect)', culoare: '#8B949E' },
  { cod: 'nealocat', eticheta: 'Suduri nealocate', detaliu: 'suduri din schema nodului fără activitate pe DN-ul lor (sau fără DN)', culoare: '#8B949E' },
  { cod: 'incomplet', eticheta: 'Date incomplete', detaliu: 'articole fără cantitate sau cu UM care nu se poate converti în UM-ul activității, sau suduri raportate și în raport și în schema nodului', culoare: '#D29922' },
]
export const alerta = cod => ALERTE.find(a => a.cod === cod) || { cod, eticheta: cod, detaliu: '', culoare: '#8B949E' }

export const fmtNr = (v, z = 1) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: z }))
export const numeUnitate = u => (u ? `${u.cod ? `${u.cod} · ` : ''}${u.nume || ''}` : '— fără obiect —')
const id = v => (v == null || v === '' ? null : Number(v))

/**
 * Cantitatea scrisă în telefon. Gol sau 0 = nimic de salvat (ca până acum); altfel număr > 0, cel mult 3 zecimale
 * și cel mult 10.000.000 (contractul RPC-ului). Text nenumeric = eroare afișată, nu „0” (necunoscut ≠ 0, L18).
 */
export function cantitateLinie(v) {
  const x = parseNumar(v)
  if (x == null || x === 0) return { gol: true }
  if (!Number.isFinite(x)) return { eroare: 'nu e un număr' }
  if (x < 0) return { eroare: 'nu poate fi negativă' }
  if (x > MAX_CANTITATE) return { eroare: 'peste 10.000.000' }
  if (Math.abs(x * 1000 - Math.round(x * 1000)) > 1e-6) return { eroare: 'cel mult 3 zecimale' }
  return { valoare: x }
}

let urm = 0
/** Un bloc al raportului = un obiect (unitate) + cantitățile de azi pe activități. unitateId null = „fără obiect / toată lucrarea”. */
export const blocNou = (unitateId = null) => ({ cheie: `b${(urm += 1)}`, unitateId: id(unitateId), valori: {}, toate: false })

/** Liniile salvate (de la fn_raport_lucrari_citeste) -> blocuri, câte unul pe obiect, în ordinea primei apariții. */
export function blocuriDinLinii(linii) {
  const m = new Map()
  for (const l of linii || []) {
    const k = id(l.unitate_id)
    if (!m.has(k)) m.set(k, blocNou(k))
    m.get(k).valori[Number(l.activitate_id)] = Number(l.cantitate)
  }
  return [...m.values()]
}

/**
 * Blocuri -> liniile pentru fn_raport_lucrari_salveaza ({activitate_id, unitate_id, cantitate}), cu aceleași reguli ca serverul:
 * obiect o singură dată, activitatea și obiectul ale proiectului, bifă = 1, la nod sudurile („schema_nod”) NU se raportează.
 * Orice abatere = eroare (nu se trimite nimic), nu o linie sărită în tăcere.
 */
export function liniiDinBlocuri(blocuri, { activitati = [], unitati = [] } = {}) {
  const act = new Map(activitati.map(a => [Number(a.id), a]))
  const un = new Map(unitati.map(u => [Number(u.id), u]))
  const linii = [], erori = [], obiecte = new Set()
  for (const b of blocuri || []) {
    const uk = id(b.unitateId)
    const u = uk == null ? null : un.get(uk)
    if (obiecte.has(String(uk))) { erori.push(`${numeUnitate(u)}: obiectul apare de două ori — unește blocurile`); continue }
    obiecte.add(String(uk))
    if (uk != null && !u) { erori.push(`obiect necunoscut (#${uk}) — reîncarcă raportul`); continue }
    for (const [cheie, v] of Object.entries(b.valori || {})) {
      const c = cantitateLinie(v)
      if (c.gol) continue
      const a = act.get(Number(cheie))
      const unde = `${a ? a.nume : `activitatea #${cheie}`} · ${numeUnitate(u)}`
      if (!a) { erori.push(`${unde}: activitate necunoscută — reîncarcă raportul`); continue }
      if (c.eroare) { erori.push(`${unde}: ${c.eroare}`); continue }
      if ((a.tip_raportare || 'cantitate') === 'bifa' && c.valoare !== 1) { erori.push(`${unde}: se bifează (1)`); continue }
      if (a.sursa_executat === 'schema_nod' && u?.nod_cod) { erori.push(`${unde}: sudurile nodului se iau din schema nodului`); continue }
      linii.push({ activitate_id: Number(a.id), unitate_id: uk, cantitate: c.valoare })
    }
  }
  if (linii.length > MAX_LINII) erori.push(`prea multe linii (${linii.length}; cel mult ${MAX_LINII})`)
  return { linii, erori }
}

/**
 * Rândurile v_executie_tinte ale unui proiect, pe chei (id crescător) până la pagina goală (L23: plafonul de 1000 al serverului
 * nu taie tăcut). Orice eroare se aruncă (L18: eroare ≠ listă goală). id = unitate × 1e8 + activitate (unic, exact în JS).
 */
export async function citesteTinte(client, proiectId, coloane = '*', pas = 1000) {
  const tot = []
  for (let ultim = null; ;) {
    let q = client.from('v_executie_tinte').select(coloane === '*' ? '*' : `id,${coloane}`).eq('proiect_id', proiectId).order('id').limit(pas)
    if (ultim != null) q = q.gt('id', ultim)
    const { data, error } = await q
    if (error) throw error
    if (!data || !data.length) return tot
    for (const r of data) tot.push(r)
    const u = Number(data[data.length - 1].id)
    if (!Number.isFinite(u) || (ultim != null && !(u > ultim))) throw new Error('ținte: cheie lipsă sau neordonată')
    ultim = u
  }
}

/** Rândul vederii pentru (obiect, activitate); unitateId null = „fără obiect”. */
export const tintaPe = (tinte, unitateId, activitateId) =>
  (tinte || []).find(t => id(t.unitate_id) === id(unitateId) && id(t.activitate_id) === id(activitateId)) || null

/**
 * Activitățile arătate într-un bloc. Proiect cu activități principale: principalele care au țintă pe obiect (din deviz > 0),
 * plus cele care au deja o valoare (raport reîncărcat), plus toate dacă s-a cerut „toate activitățile”.
 * Proiect fără activități principale: toate activitățile active (ca înainte de legarea de devize).
 */
export function activitatiBloc({ activitati = [], tinte = [], unitateId = null, toate = false, valori = {} }) {
  const arePrincipale = activitati.some(a => a.principala)
  return activitati.filter(a => {
    if (!arePrincipale || toate) return true
    if (valori[a.id] != null && valori[a.id] !== '') return true
    if (!a.principala || unitateId == null) return false
    const t = tintaPe(tinte, unitateId, a.id)
    return !!t && Number(t.din_deviz) > 0
  })
}

/** Ordinea din tabel și din export: obiectul (ordine, id; „fără obiect” la final), apoi activitatea (ordine, id; „nealocat” la final). */
export function ordoneaza(tinte) {
  const k = (v, d) => (v == null ? d : Number(v))
  return [...(tinte || [])].sort((a, b) =>
    (a.unitate_id == null) - (b.unitate_id == null) || k(a.unitate_ordine, 0) - k(b.unitate_ordine, 0) || k(a.unitate_id, 0) - k(b.unitate_id, 0)
    || (a.activitate_id == null) - (b.activitate_id == null) || k(a.activitate_ordine, 0) - k(b.activitate_ordine, 0) || k(a.activitate_id, 0) - k(b.activitate_id, 0))
}

/**
 * Pragurile declarate în export = cele care au calculat rândurile exportate (din vedere), nu cele din pagină:
 * toate rândurile trebuie să aibă aceleași valori; altfel s-au schimbat în timpul citirii -> refuz (se reia).
 */
export function metadateTinte(tinte) {
  if (!tinte?.length) throw new Error('nimic de exportat')
  const chei = new Set(tinte.map(t => [t.proiect_id, t.prag_in_urma_pp, t.zile_fara_raport, t.calculat_la].join('|')))
  if (chei.size !== 1) throw new Error('pragurile sau ziua calculului s-au schimbat în timpul citirii — reîncearcă')
  const t = tinte[0]
  return { proiect_id: t.proiect_id, prag_in_urma_pp: t.prag_in_urma_pp, zile_fara_raport: t.zile_fara_raport, calculat_la: t.calculat_la }
}

const nrTronson = s => {
  const m = norm(s).trim().match(/^(?:t|tr|tronson(?:ul)?)\s*\.?\s*(\d{1,3})$/)
  return m ? Number(m[1]) : null
}
/**
 * Potrivirea PROPUSĂ obiect din deviz ↔ unitate (doar unitățile fără obiect, doar obiectele nefolosite):
 * T<n> / „Tronson n” ↔ „TRONSON n”; altfel numele identic (fără diacritice și majuscule); „cuplare” ↔ unitatea de nod.
 * Doar potrivirile UNICE (un obiect pentru o unitate și invers); ce e ambiguu rămâne de ales de om (L11).
 * obiecte: [{obiect_cod, obiect_nume}] (distincte, din proiect_articole). Întoarce [{unitate_id, obiect_cod, motiv}].
 */
export function propunePotrivire(unitati, obiecte) {
  const folosite = new Set((unitati || []).map(u => u.obiect_cod).filter(Boolean))
  const libere = (obiecte || []).filter(o => o.obiect_cod && !folosite.has(o.obiect_cod))
  const cand = []
  for (const u of unitati || []) {
    if (u.obiect_cod) continue
    const nU = nrTronson(u.cod) ?? nrTronson(u.nume) ?? nrTronson(String(u.nume || '').split(/[—–,(-]/)[0])
    for (const o of libere) {
      const nume = norm(o.obiect_nume).replace(/\s+/g, ' ').trim()
      let motiv = null
      if (nU != null && nrTronson(nume) === nU) motiv = `tronsonul ${nU}`
      else if (nume && nume === norm(u.nume).replace(/\s+/g, ' ').trim()) motiv = 'același nume'
      else if (/cuplare/.test(nume) && (u.nod_cod || /cuplare/.test(norm(u.nume)) || /cuplare/.test(norm(u.cod)))) motiv = 'nodul de cuplare'
      if (motiv) cand.push({ unitate_id: Number(u.id), obiect_cod: o.obiect_cod, motiv })
    }
  }
  const nrU = new Map(), nrO = new Map()
  for (const c of cand) { nrU.set(c.unitate_id, (nrU.get(c.unitate_id) || 0) + 1); nrO.set(c.obiect_cod, (nrO.get(c.obiect_cod) || 0) + 1) }
  return cand.filter(c => nrU.get(c.unitate_id) === 1 && nrO.get(c.obiect_cod) === 1)
}
