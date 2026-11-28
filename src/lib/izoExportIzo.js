// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — „Export IZO înainte de lansare”: logica pură (docs/izometrie/BULETINE_NDT_SPEC.md §7, §8, §21 R6, §22, §24)
// ════════════════════════════════════════════════════════════════════════
// Fără Supabase, fără DOM. Regulile de business (starea pe sudură, coloanele K–M, lipsurile) sunt în izoNdt.js
// (o singură definiție, L19); aici doar: rândurile din BD → intrarea lor, fotografia trimisă la
// fn_sud_export_inregistreaza, gruparea lipsurilor pentru fereastră, planul ZIP-ului, numele fișierului și
// diferențele „export depășit” (R6), amprenta pachetului și a rândurilor lui.

import { starePeSudura, verificaExport, coloaneCentralizator, normalizeazaRandBuletin, dataRo, METODE_CENTRALIZATOR } from './izoNdt.js'

export const TIP_EXPORT_IZO = 'izo'
export const MOTIV_DEBLOCARE_MIN = 5          // fn_sud_export_deblocheaza: motiv ≥ 5 caractere
const txt = v => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()
const areText = v => /\S/.test(txt(v))

// ── 1. codul documentului: O SINGURĂ formă (audit 27.11, G6) ─────────────
// La importul din Excel revizia se scoate din cod (ImportExcelIzometrie: codClean), dar pachetele refăcute pe 27.11
// au revizia și în cod („…_00040_rev_1”). Revizia se adaugă doar dacă nu e deja în cod; altfel ieșea „…_rev_1 rev.1”.
const RE_REVIZIE_IN_COD = /(?:^|[\s_.-])rev[\s_.-]*\d+$/i
export const codAreRevizie = cod => RE_REVIZIE_IN_COD.test(txt(cod))
const nrRevizie = p => (Number.isInteger(Number(p?.revizie)) && Number(p.revizie) > 0 ? Number(p.revizie) : 0)

/** Codul afișat (antet, coloana DOCUMENT, foaia IZOMETRIE): „COD rev.N” sau „COD” dacă revizia e deja în cod / e 0. */
export function codDocumentAfisat(pachet) {
  const cod = txt(pachet?.cod_document_full)
  if (codAreRevizie(cod)) return cod
  const rev = nrRevizie(pachet)
  return rev > 0 ? `${cod} rev.${rev}` : cod
}

/** Baza numelui de fișier: „COD_revN” (și „_rev0”, ca până acum) sau „COD” dacă revizia e deja în cod. */
export function codDocumentFisier(pachet) {
  const cod = txt(pachet?.cod_document_full).replace(/[\\/:*?"<>|\s]+/g, '_')
  return codAreRevizie(cod) ? cod : `${cod}_rev${nrRevizie(pachet)}`
}

/** Numele exportului: „COD_revN_Centralizator.xlsx|zip”; exportul deblocat poartă „INCOMPLET” (§8). */
export function numeExportIzo(pachet, { incomplet = false, ext = 'zip' } = {}) {
  return `${codDocumentFisier(pachet)}${incomplet ? '_INCOMPLET' : ''}_Centralizator.${ext}`
}

// ── 2. rândurile din BD → intrarea starePeSudura ─────────────────────────
/**
 * buletine: sud_buletine CONFIRMATE ale tronsonului; randuri: sud_buletin_randuri ale lor.
 * Cheia sudurii se recalculează din (tronson_nr, nr, sufix) — forma JS „12|126|”; cheia BD („T12S126”) nu se folosește.
 * Nimic nu dispare tăcut (L12): rândurile nepotrivite, cele fără buletin în listă și buletinele fără rânduri se numără.
 */
export function randuriPentruStare(buletine, randuri) {
  const peId = new Map((buletine || []).map(b => [String(b.id), b]))
  const out = [], nepotrivite = [], orfane = []
  const cuRanduri = new Set()
  for (const r of randuri || []) {
    const b = peId.get(String(r?.buletin_id))
    if (!b) { orfane.push(r); continue }
    cuRanduri.add(String(b.id))
    if (r.stare_cod !== 'ok' || !Number.isInteger(r.tronson_nr) || !Number.isInteger(r.nr)) { nepotrivite.push(r); continue }
    out.push({
      tronson: r.tronson_nr, nr: r.nr, sufix: r.sufix || '', refacuta: r.refacuta === true,
      metoda: b.metoda, numar: b.numar, data_buletin: b.data_buletin, data_inspectie: r.data_inspectie,
      rezultat: r.rezultat, buletin_id: b.id, buletin_stare: b.stare, cale_pdf: b.fisier_path,
    })
  }
  const faraRanduri = (buletine || []).filter(b => !cuRanduri.has(String(b.id)))
  return { randuri: out, nepotrivite, orfane, faraRanduri }
}

const eticheta = b => `${b.metoda} ${txt(b.numar)}${dataRo(b.data_buletin) ? `/${dataRo(b.data_buletin)}` : ''}`
const el = (cod, rand, mesaj) => ({ cod, rand: rand ?? null, mesaj })

// ── 3. evaluarea (aceeași pentru fereastra de export și pentru antetul pachetului) ──
/**
 * @param {object} p
 * @param {object} p.pachet   executie_pachete_lansare (km_start_m, total_lungime_m)
 * @param {object} p.tronson  executie_tronsoane (cod)
 * @param {Array}  p.tevi     rândurile pachetului (executie_tevi)
 * @param {object} p.arhiva   citesteArhivaNdt: { ok, eroare?, buletine, randuri, eliminate, metode (null = nesetat), pachetAnterior, eroareAnterior? }
 * @returns {{stare, verificare, fotografie, info}}  fotografie = null dacă arhiva nu s-a putut citi (exportul e blocat)
 */
export function evalueazaExportIzo({ pachet, tronson, tevi, arhiva }) {
  const ok = arhiva?.ok === true
  const conv = ok ? randuriPentruStare(arhiva.buletine, arhiva.randuri) : null
  const metode = ok && Array.isArray(arhiva.metode) ? arhiva.metode : undefined    // nesetat = undefined → blocaj (item 7, L18)
  const stare = ok ? starePeSudura(conv.randuri) : null
  const eliminate = ok ? (arhiva.eliminate || []).map(e => e.cheie) : undefined
  const verificare = verificaExport({
    pachet: { km_start_m: pachet?.km_start_m, total_lungime_m: pachet?.total_lungime_m },
    randuri: Array.isArray(tevi) ? tevi : undefined,
    stare, metodeObligatorii: metode,
    pachetAnterior: ok ? (arhiva.pachetAnterior || null) : null,
    tronson: tronson?.cod, eliminate,
  })
  // semnalele citirii (nu reguli noi): ce nu s-a putut lega de nicio sudură apare ca avertisment, nu dispare
  if (ok) {
    if (arhiva.eroareAnterior) verificare.avertismente.push(el('km_anterior_necitit', null, `Pachetul anterior de pe tronson nu s-a putut citi (${arhiva.eroareAnterior}): golul de km nu s-a verificat.`))
    if (conv.nepotrivite.length) verificare.avertismente.push(el('randuri_buletin_nepotrivite', null, `${conv.nepotrivite.length} rânduri din buletinele confirmate au cod de sudură nepotrivit pe tronson și nu acoperă nicio sudură.`))
    for (const b of conv.faraRanduri) verificare.avertismente.push(el('buletin_fara_randuri', null, `Buletinul ${eticheta(b)} e confirmat, dar nu i s-a citit niciun rând.`))
  }
  const fotografie = ok && metode !== undefined ? construiesteFotografie({ arhiva, verificare, pachet, tevi }) : null
  return { stare, verificare, fotografie, info: conv ? { nrBuletine: (arhiva.buletine || []).length, nepotrivite: conv.nepotrivite.length } : null }
}

// ── 4. fotografia (R6, §22) ──────────────────────────────────────────────
/**
 * Exact ce verifică fn_sud_export_inregistreaza: TOATE buletinele confirmate ale tronsonului (id + versiune; eticheta e doar
 * pentru citirea diferențelor mai târziu, serverul o ignoră), cheile sudurilor eliminate active, metodele obligatorii,
 * lipsurile blocante (= cele deblocate de MP; la exportul complet []) și avertismentele. Ordonate, ca două citiri egale
 * să dea aceeași fotografie.
 * În plus (Jakarinos #1219 r1 P1): amprenta PACHETULUI (pachet) și a RÂNDURILOR lui (randuri), din exact copia folosită la
 * generare. Serverul NU le compară (fn_sud_export_inregistreaza verifică doar buletine / eliminate / metode / lipsuri); le
 * compară clientul: imediat înainte de generare și din nou înainte de înregistrare (verificaPachetNeschimbat) + „export depășit”.
 */
export function construiesteFotografie({ arhiva, verificare, pachet, tevi }) {
  const buletine = (arhiva.buletine || []).map(b => ({ id: Number(b.id), versiune: Number(b.versiune), eticheta: eticheta(b) }))
    .sort((a, b) => a.id - b.id)
  const scurt = l => l.map(x => ({ cod: x.cod, rand: x.rand ?? null, mesaj: x.mesaj }))
  return {
    buletine,
    eliminate: (arhiva.eliminate || []).map(e => String(e.cheie)).sort(),
    metode: [...(arhiva.metode || [])].map(String).sort(),
    lipsuri_blocante: scurt(verificare.blocajeDeblocabile),
    avertismente: scurt(verificare.avertismente),
    pachet: amprentaPachet(pachet),
    randuri: amprentaRanduri(tevi),
  }
}

// ── 4b. amprenta pachetului și a rândurilor (R6 pe pachet) ───────────────
// Câmpurile rândului care intră în Excel (exportCentralizatorXlsx) sau în verificare; id-ul prinde și rândurile înlocuite.
export const CAMPURI_RAND_AMPRENTA = ['id', 'poz_in_pachet', 'tip_rand', 'serie_unica', 'sudura_cod', 'sudura_refacuta', 'lungime_m', 'tip',
  'dimensiune', 'sarja', 'unghi_curba', 'lot', 'observatii', 'pm_cod', 'pa_ut_cod', 'ut_cod']
const CAMPURI_NUMERICE = new Set(['poz_in_pachet', 'lungime_m', 'unghi_curba'])
// Forma canonică doar pentru comparare (nu se scrie nicăieri): gol / null = null; numeric „12.50” = 12.5 (PostgREST vs editor).
function valCanonica(camp, v) {
  if (camp === 'id') return v === null || v === undefined ? null : String(v)
  if (camp === 'sudura_refacuta') return v === true
  if (v === null || v === undefined) return null
  if (CAMPURI_NUMERICE.has(camp)) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
    if (!/\S/.test(String(v))) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : String(v)
  }
  const s = String(v)
  return /\S/.test(s) ? s : null
}
// hash nesecret, determinist (cyrb53 pe 64 de biți): detectează o schimbare, nu e o dovadă criptografică
function hash64(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}
const cmpId = (a, b) => {
  const x = Number(a), y = Number(b)
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

/** Amprenta pachetului: id, updated_at, km start, revizie, cod. null = pachet necunoscut. */
export function amprentaPachet(p) {
  if (!p || p.id === null || p.id === undefined) return null
  return {
    id: Number(p.id),
    updated_at: p.updated_at === null || p.updated_at === undefined ? null : String(p.updated_at),
    km_start_m: valCanonica('lungime_m', p.km_start_m),
    revizie: valCanonica('lungime_m', p.revizie),
    cod_document_full: valCanonica('cod', p.cod_document_full),
  }
}

/** Amprenta deterministă a rândurilor (ordinea de citire nu contează: sortate pe id). null = rânduri necitite. */
export function amprentaRanduri(tevi) {
  if (!Array.isArray(tevi)) return null
  const linii = tevi.map(r => CAMPURI_RAND_AMPRENTA.map(c => valCanonica(c, r?.[c]))).sort((a, b) => cmpId(a[0], b[0]))
  return { numar: linii.length, amprenta: hash64(JSON.stringify([CAMPURI_RAND_AMPRENTA, linii])) }
}

/**
 * Diferențele pe pachet + rânduri între două fotografii (sau fotografie vs amprentele recitite din BD).
 * Amprentă lipsă pe oricare parte = o diferență explicită (necunoscut ≠ neschimbat, L18).
 */
export function diferentePachet(veche, curenta, cand = 'după export') {
  const vp = veche?.pachet, vr = veche?.randuri, cp = curenta?.pachet, cr = curenta?.randuri
  if (!vp || !vr) return ['Exportul anterior nu are amprenta pachetului: nu se poate spune dacă rândurile sunt la zi.']
  if (!cp || !cr) return ['Pachetul sau rândurile lui nu s-au putut citi: nu se poate spune dacă sunt la zi.']
  const dif = []
  if (vp.id !== cp.id) dif.push(`Alt pachet (${vp.id} → ${cp.id}).`)
  if (vp.km_start_m !== cp.km_start_m) dif.push(`Km start s-a schimbat ${cand}: ${vp.km_start_m ?? '—'} → ${cp.km_start_m ?? '—'}.`)
  if (vp.revizie !== cp.revizie) dif.push(`Revizia s-a schimbat ${cand}: ${vp.revizie ?? '—'} → ${cp.revizie ?? '—'}.`)
  if (vp.cod_document_full !== cp.cod_document_full) dif.push(`Codul documentului s-a schimbat ${cand}.`)
  if (vr.numar !== cr.numar) dif.push(`Numărul de rânduri s-a schimbat ${cand}: ${vr.numar} → ${cr.numar}.`)
  else if (vr.amprenta !== cr.amprenta) dif.push(`Rândurile pachetului s-au schimbat ${cand} (serie, sudură, lungime, tip, dimensiune, șarjă sau PM / PA-UT / UT).`)
  if (vp.updated_at !== cp.updated_at && !dif.length) dif.push(`Pachetul a fost salvat ${cand}.`)
  return dif
}

// ── 5. lipsurile → fereastra ─────────────────────────────────────────────
export const GRUPE_LIPSURI = [
  { tip: 'blocaj', camp: 'blocaje', titlu: 'Blocaj (documentul ar ieși greșit)' },
  { tip: 'deblocabil', camp: 'blocajeDeblocabile', titlu: 'Blocaj cu deblocare de MP (lipsesc documente)' },
  { tip: 'avertisment', camp: 'avertismente', titlu: 'Avertisment (exportul merge)' },
]
/** Lipsurile grupate pe gravitate, apoi pe cod (cu numărul lor), în ordinea apariției; rand = poz_in_pachet (salt la rând). */
export function grupeazaLipsuri(verificare) {
  return GRUPE_LIPSURI.map(g => {
    const peCod = new Map()
    for (const x of verificare?.[g.camp] || []) {
      if (!peCod.has(x.cod)) peCod.set(x.cod, [])
      peCod.get(x.cod).push(x)
    }
    return { ...g, total: (verificare?.[g.camp] || []).length, coduri: [...peCod].map(([cod, elemente]) => ({ cod, elemente })) }
  })
}
/** Metodele obligatorii nesetate pe proiect → fereastra trimite la „Buletine NDT” (fără valoare implicită inventată). */
export const cereMetode = verificare => (verificare?.blocaje || []).some(x => x.cod === 'setare_metode_lipsa')

/**
 * Butonul de export. drept: { scriere, export } (true / false / null = necunoscut — decide serverul).
 * @returns {{activ:boolean, incomplet:boolean, motiv:string|null}}
 */
export function stareButonExport({ evaluare, drept = {}, bifa = false, motiv = '' }) {
  const v = evaluare?.verificare
  if (!v || !evaluare.fotografie) return { activ: false, incomplet: false, motiv: 'Arhiva de buletine sau setarea metodelor nu s-a putut citi.' }
  if (v.blocaje.length) return { activ: false, incomplet: false, motiv: `${v.blocaje.length} blocaje fără deblocare: corectează pachetul.` }
  if (v.blocajeDeblocabile.length) {
    if (drept.scriere !== true) return { activ: false, incomplet: true, motiv: 'Lipsesc documente: doar managerul de proiect (sau owner-ul) poate debloca exportul.' }
    if (!bifa) return { activ: false, incomplet: true, motiv: 'Bifează „Export cu documente lipsă” ca să continui.' }
    if (txt(motiv).length < MOTIV_DEBLOCARE_MIN) return { activ: false, incomplet: true, motiv: `Scrie motivul deblocării (cel puțin ${MOTIV_DEBLOCARE_MIN} caractere).` }
    return { activ: true, incomplet: true, motiv: null }
  }
  if (drept.export === false) return { activ: false, incomplet: false, motiv: 'Nu ai drept de export pe acest proiect.' }
  return { activ: true, incomplet: false, motiv: null }
}

// ── 6. coloanele PM / PA-UT / UT (editor + Excel, aceeași regulă) ─────────
const CAMP_TEXT = { pm: 'pm_cod', pa_ut: 'pa_ut_cod', ut: 'ut_cod' }
/**
 * Valoarea afișată în PM / PA-UT / UT: din arhivă (coloaneCentralizator) când sudura are buletin valabil, altfel textul
 * scris în rând (proiectele vechi rămân cum sunt, D13). stare = null (arhivă necitită) → doar textul.
 * @returns {{pm_cod, pa_ut_cod, ut_cod, sursa: {pm_cod:'arhiva'|'text', ...}}}
 */
export function coloaneAfisate(rand, stare, tronsonCtx) {
  const arh = stare ? coloaneCentralizator(rand, stare, tronsonCtx) : { pm: null, pa_ut: null, ut: null }
  const out = { sursa: {} }
  for (const [k, camp] of Object.entries(CAMP_TEXT)) {
    if (arh[k] !== null) { out[camp] = arh[k]; out.sursa[camp] = 'arhiva' }
    else { out[camp] = rand?.[camp] ?? ''; out.sursa[camp] = 'text' }
  }
  return out
}
export const METODA_CAMP = { pm_cod: 'PM', pa_ut_cod: 'PA-UT', ut_cod: 'UT' }

// ── 7. ZIP: buletinele distincte folosite de sudurile pachetului ─────────
const ORDINE_METODA = m => { const i = METODE_CENTRALIZATOR.indexOf(m); return i < 0 ? 99 : i }
const sigur = s => txt(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x'
/**
 * Buletinul VALABIL al fiecărei suduri (neeliminate) a pachetului, pe fiecare metodă, o singură dată (fără dubluri).
 * @returns {Array<{buletin, metoda, numar, data, suduri:number, fisierZip:string}>}  ordonate: metodă, dată, număr, id
 */
export function planBuletineZip({ stare, tevi, tronsonCtx, buletine, eliminate = [] }) {
  const peId = new Map((buletine || []).map(b => [String(b.id), b]))
  const elim = new Set(eliminate.map(e => (typeof e === 'string' ? e : e?.cheie)).map(c => normalizeazaRandBuletin(c, tronsonCtx)).filter(n => n.stare === 'ok').map(n => n.cheie))
  const folosite = new Map()   // id buletin → Set(chei suduri)
  for (const r of tevi || []) {
    if (!r || r.tip_rand === 'separator' || !areText(r.sudura_cod)) continue
    const n = normalizeazaRandBuletin(r.sudura_cod, tronsonCtx)
    if (n.stare !== 'ok' || elim.has(n.cheie)) continue
    for (const s of Object.values(stare?.suduri?.[n.cheie]?.metode || {})) {
      const id = s?.valabil?.buletin_id
      if (id === undefined || id === null) continue
      if (!peId.has(String(id))) throw new Error(`buletinul ${id} folosit de sudura ${n.cod} nu e în fotografie`)
      if (!folosite.has(String(id))) folosite.set(String(id), new Set())
      folosite.get(String(id)).add(n.cheie)
    }
  }
  const lista = [...folosite].map(([id, chei]) => ({ buletin: peId.get(id), suduri: chei.size }))
  lista.sort((a, b) => ORDINE_METODA(a.buletin.metoda) - ORDINE_METODA(b.buletin.metoda)
    || String(a.buletin.metoda).localeCompare(String(b.buletin.metoda))
    || String(a.buletin.data_buletin || '').localeCompare(String(b.buletin.data_buletin || ''))
    || txt(a.buletin.numar).localeCompare(txt(b.buletin.numar), 'ro', { numeric: true })
    || Number(a.buletin.id) - Number(b.buletin.id))
  const luate = new Set()
  return lista.map(({ buletin: b, suduri }) => {
    let nume = `buletine/${sigur(b.metoda)}_${sigur(b.numar)}_${sigur(dataRo(b.data_buletin) || b.data_buletin)}.pdf`
    if (luate.has(nume.toLowerCase())) nume = nume.replace(/\.pdf$/, `_${b.id}.pdf`)
    luate.add(nume.toLowerCase())
    return { buletin: b, metoda: b.metoda, numar: txt(b.numar), data: dataRo(b.data_buletin) || txt(b.data_buletin), suduri, fisierZip: nume }
  })
}

// ── 8. „export depășit” (R6) ─────────────────────────────────────────────
const cheieLipsa = x => `${x?.cod}|${x?.rand ?? ''}|${x?.mesaj}`
function fotografieValida(f) {
  return !!f && typeof f === 'object' && ['buletine', 'eliminate', 'metode', 'lipsuri_blocante'].every(k => Array.isArray(f[k]))
    && f.buletine.every(b => b && Number.isFinite(Number(b.id)) && Number.isFinite(Number(b.versiune)))
}
/**
 * Diferențele dintre fotografia ultimului export și starea curentă. [] = la zi.
 * Fotografia veche ilizibilă sau cea curentă necunoscută → o diferență explicită (necunoscut ≠ la zi, L18).
 */
export function diferenteFotografie(veche, curenta) {
  if (!fotografieValida(veche)) return ['Fotografia exportului anterior nu se poate citi.']
  if (!fotografieValida(curenta)) return ['Starea curentă a buletinelor nu s-a putut citi: nu se poate spune dacă exportul e la zi.']
  const dif = []
  const v = new Map(veche.buletine.map(b => [String(b.id), b])), c = new Map(curenta.buletine.map(b => [String(b.id), b]))
  const et = b => b.eticheta || `#${b.id}`
  for (const [id, b] of c) {
    if (!v.has(id)) dif.push(`Buletin confirmat după export: ${et(b)}.`)
    else if (Number(v.get(id).versiune) !== Number(b.versiune)) dif.push(`Buletin schimbat după export: ${et(b)}.`)
  }
  for (const [id, b] of v) if (!c.has(id)) dif.push(`Buletin anulat după export: ${et(b)}.`)
  const sv = new Set(veche.eliminate.map(String)), sc = new Set(curenta.eliminate.map(String))
  for (const k of sc) if (!sv.has(k)) dif.push(`Sudură eliminată după export: ${k}.`)
  for (const k of sv) if (!sc.has(k)) dif.push(`Eliminare retrasă după export: ${k}.`)
  const mv = [...veche.metode].map(String).sort().join(', '), mc = [...curenta.metode].map(String).sort().join(', ')
  if (mv !== mc) dif.push(`Metodele obligatorii s-au schimbat: ${mv || '—'} → ${mc || '—'}.`)
  // lipsurile ca multiseturi (aceeași lipsă de două ori contează de două ori)
  const numara = l => l.reduce((m, x) => m.set(cheieLipsa(x), (m.get(cheieLipsa(x)) || 0) + 1), new Map())
  const lv = numara(veche.lipsuri_blocante), lc = numara(curenta.lipsuri_blocante)
  const prima = (l, k) => l.find(x => cheieLipsa(x) === k)
  for (const [k, n] of lc) if ((lv.get(k) || 0) < n) dif.push(`Lipsă nouă: ${prima(curenta.lipsuri_blocante, k).mesaj}`)
  for (const [k, n] of lv) if ((lc.get(k) || 0) < n) dif.push(`Lipsă rezolvată: ${prima(veche.lipsuri_blocante, k).mesaj}`)
  // pachetul + rândurile lui (km, revizie, serie, lungime, …): o schimbare aici face exportul depășit chiar fără buletine noi
  dif.push(...diferentePachet(veche, curenta, 'după export'))
  return dif
}
