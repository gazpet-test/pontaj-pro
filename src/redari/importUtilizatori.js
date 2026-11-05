// Redări — importul utilizatorilor / arendașilor din fișierul TGZ „Despăgubiri LOT 1 – Date de contact utilizatori.xlsx” (juridic#040, PR4 din
// docs/redari/PLAN_UTILIZATORI.md). Import DEDICAT, separat de importTgz.js (parseazaTgz ar transforma proprietarii unici în coproprietari):
//  - foaia 1, antet pe 3 rânduri; coloanele folosite: 0 UAT („01Prunișor”), 2 Nr. Crt HG, 3 Nr. Tarla, 4 Nr. cadastral / parcelă,
//    24 „Prenume și nume” (persoana care folosește terenul, dacă diferă), 25 Adresa, 26 Telefon;
//  - parcela se caută DOAR printre parcelele existente ale proiectului, pe cheie_sursa (uat3|poz_hg|nr_cadastral|tarla — aceeași cheie ca importul TGZ);
//    nu se creează parcele; UAT-urile din afara proiectului (fișierul acoperă toată conducta) se numără, nu se importă;
//  - o persoană deja deținătoare pe aceeași parcelă (nume_normalizat) NU se adaugă a doua oară (se raportează);
//  - rândul nou: red_detinatori cu calitate 'utilizator' (fișierul nu deosebește arendașul de alt utilizator), sursa_date + versiune_lista_tgz,
//    plus red_detinatori_contact cu adresa (telefonul doar dacă are cel puțin 9 cifre);
//  - lotul în red_import_loturi cu sursa 'TGZ_UTILIZATORI'.
// ORDINEA DE RULARE ÎN PRODUCȚIE: utilizatorii importați intră automat în generarea în masă (convocatoareMasa.pregatesteLot filtrează doar
// 'neidentificat'), deci scrierea e oprită (IMPORT_UTILIZATORI_ACTIV = false) până la poarta din PR3 (convocatorul pentru utilizatori).
import * as XLSX from 'xlsx-js-style'
import { normalizeazaNume } from './idParcela.js'
import { cheieSursa, imparteAdresa, text, LOT, LOT_CITIRE, PAGINA } from './importTgz.js'

export const IMPORT_UTILIZATORI_ACTIV = false
export const SURSA_UTILIZATORI = 'TGZ_UTILIZATORI'
export const CALITATE_UTILIZATOR = 'utilizator'
export const COL = { uat: 0, poz_hg: 2, tarla: 3, nr_cadastral: 4, nume: 24, adresa: 25, telefon: 26 }
const RANDURI_ANTET = 3
const MOTIV_FARA_CHEIE = 'fără identitate (poziție HG și nr. cadastral lipsă)'
const MOTIV_PARCELA_NEGASITA = 'parcela nu există în proiect (cheie_sursa negăsită)'
const MOTIV_DEJA = 'persoana e deja deținător pe aceeași parcelă'

const gol = v => { const t = text(v); return !t || /^#+$/.test(t) || t === '0' }
export const telefonValid = v => { const cifre = String(v ?? '').replace(/\D/g, ''); return cifre.length >= 9 ? String(v).trim() : null }
const uatDinCelula = v => text(v).replace(/^\d+/, '').trim()

/**
 * parseazaUtilizatori(arrayBuffer, { uats }) → { candidati, in_afara_proiectului, fara_cheie, dubluri_fisier, statistici }
 * candidat = { rand, uat3, cheie_sursa, nume, nume_normalizat, contact: { adresa_* , adresa_cunoscuta, telefon } }
 * Rândurile fără nume de utilizator se ignoră (proprietarul folosește terenul). Același (cheie_sursa, nume) de mai multe ori = o singură persoană.
 */
export function parseazaUtilizatori(arrayBuffer, { uats = [] } = {}) {
  const wb = XLSX.read(arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : arrayBuffer, { type: 'array', cellDates: false })
  const foaie = wb.Sheets[wb.SheetNames[0]]
  if (!foaie) throw new Error('Fișierul nu are nicio foaie')
  const randuri = XLSX.utils.sheet_to_json(foaie, { header: 1, raw: false, defval: '' })
  const uatDupaNume = new Map(uats.map(u => [normalizeazaNume(u.nume), u.uat3]))
  const statistici = { randuri: 0, cu_utilizator: 0, in_afara_proiectului: 0, fara_cheie: 0, dubluri_fisier: 0, candidati: 0, pe_uat: {} }
  const candidati = [], in_afara = [], fara_cheie = [], dubluri = []
  const vazut = new Map()
  for (let i = RANDURI_ANTET; i < randuri.length; i++) {
    const r = randuri[i]; const randExcel = i + 1
    const uatBrut = uatDinCelula(r[COL.uat])
    if (!uatBrut) continue
    statistici.randuri++
    const nume = text(r[COL.nume])
    if (gol(nume)) continue
    statistici.cu_utilizator++
    const uat3 = uatDupaNume.get(normalizeazaNume(uatBrut))
    if (!uat3) { statistici.in_afara_proiectului++; in_afara.push({ rand: randExcel, uat: uatBrut }); continue }
    const cs = cheieSursa(uat3, gol(r[COL.poz_hg]) ? '' : r[COL.poz_hg], gol(r[COL.nr_cadastral]) ? '' : r[COL.nr_cadastral], gol(r[COL.tarla]) ? '' : r[COL.tarla])
    if (!cs) { statistici.fara_cheie++; fara_cheie.push({ rand: randExcel, uat3, motiv: MOTIV_FARA_CHEIE }); continue }
    const nn = normalizeazaNume(nume)
    const k = `${cs}#${nn}`
    if (vazut.has(k)) { statistici.dubluri_fisier++; dubluri.push({ rand: randExcel, rand_original: vazut.get(k), uat3 }); continue }
    vazut.set(k, randExcel)
    const adresa = gol(r[COL.adresa]) ? null : imparteAdresa(text(r[COL.adresa]), null)
    const contact = adresa
      ? { adresa_strada: adresa.adresa_strada, adresa_sat: adresa.adresa_sat, adresa_comuna: adresa.adresa_comuna, adresa_judet: adresa.adresa_judet, cod_postal: null, adresa_cunoscuta: true }
      : { adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: null, cod_postal: null, adresa_cunoscuta: false }
    contact.telefon = telefonValid(r[COL.telefon])
    candidati.push({ rand: randExcel, uat3, cheie_sursa: cs, poz_hg: gol(r[COL.poz_hg]) ? null : normalizeazaNume(r[COL.poz_hg]), nume, nume_normalizat: nn, contact })
    const s = (statistici.pe_uat[uat3] ??= { candidati: 0 }); s.candidati++
  }
  statistici.candidati = candidati.length
  return { candidati, in_afara_proiectului: in_afara, fara_cheie, dubluri_fisier: dubluri, statistici }
}

/**
 * planUtilizatori(candidati, { parcele, detinatori }) — funcție pură.
 *  parcele: [{ id, cheie_sursa, id_parcela, uat3, poz_hg }] ACTIVE ale proiectului; detinatori: [{ parcela_id, nume_normalizat }] ACTIVI.
 *  Potrivire: întâi cheie_sursa exactă; dacă lipsește, poziția HG când e UNICĂ printre parcelele active ale UAT-ului (aceeași regulă ca
 *  analiza din 05.11) — raportată separat (`potrivire: 'hg'`); HG ne-unic sau lipsă → „parcela negăsită”.
 * → { noi: [{ ...candidat, parcela_id, id_parcela }], deja_detinatori, parcela_negasita, statistici }
 */
export function planUtilizatori(candidati, { parcele = [], detinatori = [] } = {}) {
  const parcelaDupaCheie = new Map()
  for (const p of parcele) {
    if (!p.cheie_sursa) continue
    if (parcelaDupaCheie.has(p.cheie_sursa)) throw new Error(`Două parcele active cu aceeași cheie ${p.cheie_sursa}; nimic nu se importă`)
    parcelaDupaCheie.set(p.cheie_sursa, p)
  }
  const dupaHg = new Map()
  for (const p of parcele) {
    if (!p.uat3 || p.poz_hg == null || String(p.poz_hg).trim() === '') continue
    const k = `${p.uat3}|${normalizeazaNume(p.poz_hg)}`; dupaHg.set(k, [...(dupaHg.get(k) || []), p])
  }
  const existenti = new Set(detinatori.map(d => `${d.parcela_id}|${d.nume_normalizat}`))
  const noi = [], deja = [], negasite = []
  for (const c of candidati) {
    let p = parcelaDupaCheie.get(c.cheie_sursa), potrivire = 'cheie'
    if (!p && c.poz_hg) { const l = dupaHg.get(`${c.uat3}|${c.poz_hg}`) || []; if (l.length === 1) { p = l[0]; potrivire = 'hg' } }
    if (!p) { negasite.push({ rand: c.rand, uat3: c.uat3, cheie_sursa: c.cheie_sursa, motiv: MOTIV_PARCELA_NEGASITA }); continue }
    if (existenti.has(`${p.id}|${c.nume_normalizat}`)) { deja.push({ rand: c.rand, uat3: c.uat3, id_parcela: p.id_parcela, motiv: MOTIV_DEJA }); continue }
    noi.push({ ...c, parcela_id: p.id, id_parcela: p.id_parcela, potrivire })
  }
  const persoane = new Set(noi.map(n => n.nume_normalizat))
  return { noi, deja_detinatori: deja, parcela_negasita: negasite,
    statistici: { candidati: candidati.length, noi: noi.length, persoane_noi: persoane.size, deja_detinatori: deja.length, parcela_negasita: negasite.length,
      potrivire_hg: noi.filter(n => n.potrivire === 'hg').length, cu_adresa: noi.filter(n => n.contact.adresa_cunoscuta).length, cu_telefon: noi.filter(n => n.contact.telefon).length } }
}

function loturi(arr, n = LOT) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
function verifica(rezultat, ce) {
  if (rezultat?.error) throw new Error(`${ce}: ${rezultat.error.message || JSON.stringify(rezultat.error)}`)
  return rezultat?.data ?? null
}
async function citesteTot(construieste, ce, pagina) {
  const tot = []
  for (let de_la = 0; ; de_la += pagina) {
    const data = verifica(await construieste().range(de_la, de_la + pagina - 1), ce) || []
    tot.push(...data)
    if (data.length < pagina) break
  }
  return tot
}

/** Datele din BD pentru plan: parcelele ACTIVE ale proiectului (cu cheie) și deținătorii lor ACTIVI. */
export async function citesteDatePlan(supabase, proiectId, { pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  const parcele = await citesteTot(() => supabase.from('red_parcele').select('id, cheie_sursa, id_parcela, poz_hg, red_uat(uat3)').eq('proiect_id', proiectId).is('sters_la', null).not('cheie_sursa', 'is', null).order('id'), 'citire parcele', pagina)
  const detinatori = []
  for (const lotI of loturi(parcele.map(p => p.id), lotCitire)) {
    detinatori.push(...await citesteTot(() => supabase.from('red_detinatori').select('parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null).order('id'), 'citire deținători', pagina))
  }
  return { parcele: parcele.map(({ red_uat, ...p }) => ({ ...p, uat3: red_uat?.uat3 ?? null })), detinatori }
}

/**
 * scrieUtilizatori(supabase, plan, { proiectId, versiune, fisierNume, permite }) → { lotId, detinatoriNoi, contacteNoi, sarite }
 * Recitește deținătorii parcelelor țintă imediat înainte de scriere (alt import / altă fereastră între timp → sare, nu dublează).
 * Oprit cât IMPORT_UTILIZATORI_ACTIV = false (vezi antetul); `permite: true` doar în teste.
 */
export async function scrieUtilizatori(supabase, plan, { proiectId, versiune, fisierNume = null, permite = IMPORT_UTILIZATORI_ACTIV, pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  if (!permite) throw new Error('Importul utilizatorilor e oprit până la convocatorul pentru utilizatori (PR3, docs/redari/PLAN_UTILIZATORI.md)')
  if (!proiectId) throw new Error('scrieUtilizatori: proiectId lipsă')
  if (!String(versiune || '').trim()) throw new Error('scrieUtilizatori: versiunea listei e obligatorie')
  const noi = plan?.noi ?? []
  const lot = verifica(await supabase.from('red_import_loturi').insert({
    proiect_id: proiectId, versiune_lista_tgz: versiune, sursa: SURSA_UTILIZATORI, fisier_nume: fisierNume, stare: 'in_curs',
    randuri_total: plan?.statistici?.candidati ?? noi.length, parcele_noi: 0, detinatori_noi: 0, dubluri: plan?.deja_detinatori?.length ?? 0, neidentificati: 0,
    diferente: { deja_detinatori: plan?.deja_detinatori ?? [], parcela_negasita: plan?.parcela_negasita ?? [], contacte_noi: 0 },
  }).select('id').single(), 'creare lot import utilizatori')
  const lotId = lot?.id
  if (!lotId) throw new Error('creare lot import utilizatori: nu am primit id-ul lotului')
  const actualizeaza = async (v, ce) => verifica(await supabase.from('red_import_loturi').update(v).eq('id', lotId), ce)
  try {
    // recitire proaspătă: cine e deja pe parcelele țintă
    const ids = [...new Set(noi.map(n => n.parcela_id))]
    const existenti = new Set()
    for (const lotI of loturi(ids, lotCitire)) {
      for (const d of await citesteTot(() => supabase.from('red_detinatori').select('parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null).order('id'), 'recitire deținători', pagina)) existenti.add(`${d.parcela_id}|${d.nume_normalizat}`)
    }
    const deScris = noi.filter(n => !existenti.has(`${n.parcela_id}|${n.nume_normalizat}`))
    const sarite = noi.length - deScris.length
    let detinatoriNoi = 0, contacteNoi = 0
    for (const bucata of loturi(deScris)) {
      const randuri = bucata.map(n => ({ parcela_id: n.parcela_id, nume: n.nume, nume_normalizat: n.nume_normalizat, calitate: CALITATE_UTILIZATOR,
        cota: null, decedat: false, sursa_date: `${SURSA_UTILIZATORI}: TGZ Despăgubiri LOT 1 – date de contact utilizatori (col. 24–26), rândul ${n.rand}`, versiune_lista_tgz: versiune }))
      verifica(await supabase.from('red_detinatori').insert(randuri), 'inserare utilizatori')
      detinatoriNoi += randuri.length
      const idDupa = new Map()
      for (const lotI of loturi([...new Set(randuri.map(r => r.parcela_id))], lotCitire)) {
        for (const d of await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null).order('id'), 'citire id utilizatori', pagina)) idDupa.set(`${d.parcela_id}|${d.nume_normalizat}`, d.id)
      }
      const contacte = bucata.map(n => {
        const id = idDupa.get(`${n.parcela_id}|${n.nume_normalizat}`)
        if (!id) throw new Error(`Utilizatorul de pe rândul ${n.rand} nu s-a regăsit după inserare`)
        return { detinator_id: id, ...n.contact }
      })
      verifica(await supabase.from('red_detinatori_contact').insert(contacte), 'inserare contacte utilizatori')
      contacteNoi += contacte.length
      await actualizeaza({ detinatori_noi: detinatoriNoi, diferente: { deja_detinatori: plan?.deja_detinatori ?? [], parcela_negasita: plan?.parcela_negasita ?? [], contacte_noi: contacteNoi } }, 'actualizare lot')
    }
    await actualizeaza({ stare: 'finalizat', eroare: null, detinatori_noi: detinatoriNoi,
      diferente: { deja_detinatori: plan?.deja_detinatori ?? [], parcela_negasita: plan?.parcela_negasita ?? [], contacte_noi: contacteNoi, sarite_la_scriere: sarite } }, 'finalizare lot')
    return { lotId, detinatoriNoi, contacteNoi, sarite }
  } catch (e) {
    // ca în scrieImport: eroarea de la marcarea „esuat” nu se înghite — rămâne pe eroarea originală (e.lotNeinchis), lotul fiind încă in_curs
    try { await actualizeaza({ stare: 'esuat', eroare: String(e?.message || e).slice(0, 500) }, 'marcare lot eșuat') } catch (e2) { if (e && typeof e === 'object') e.lotNeinchis = String(e2?.message || e2) }
    if (e && typeof e === 'object') e.lotId = lotId
    throw e
  }
}
