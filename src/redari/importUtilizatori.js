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
  const noi = [], deja = [], negasite = [], coliziuni = []
  const alese = new Map()   // r2 (Jak P1-3 / Cop P2-01): deduplicare pe identitatea FINALĂ (parcela_id, nume) — chei diferite pot ajunge, prin HG, la aceeași parcelă
  for (const c of candidati) {
    let p = parcelaDupaCheie.get(c.cheie_sursa), potrivire = 'cheie'
    if (!p && c.poz_hg) { const l = dupaHg.get(`${c.uat3}|${c.poz_hg}`) || []; if (l.length === 1) { p = l[0]; potrivire = 'hg' } }
    if (!p) { negasite.push({ rand: c.rand, uat3: c.uat3, cheie_sursa: c.cheie_sursa, motiv: MOTIV_PARCELA_NEGASITA }); continue }
    const k = `${p.id}|${c.nume_normalizat}`
    if (existenti.has(k)) { deja.push({ rand: c.rand, uat3: c.uat3, id_parcela: p.id_parcela, parcela_id: p.id, nume_normalizat: c.nume_normalizat, contact: c.contact, motiv: MOTIV_DEJA }); continue }
    if (alese.has(k)) {
      const primul = alese.get(k)
      // r3 (Cop r2 P2-01): contacte diferite pentru aceeași persoană → nu se alege automat; ambele rânduri ies din import, de verificat
      const diferit = JSON.stringify(primul.contact) !== JSON.stringify(c.contact)
      coliziuni.push({ rand: c.rand, rand_ales: primul.rand, uat3: c.uat3, id_parcela: p.id_parcela, motiv: diferit ? 'aceeași persoană pe aceeași parcelă, cu adrese diferite — exclusă, de verificat' : 'aceeași persoană pe aceeași parcelă din alt rând al fișierului (după potrivire)' })
      if (diferit) primul.exclus = true
      continue
    }
    const nou = { ...c, parcela_id: p.id, id_parcela: p.id_parcela, potrivire }
    alese.set(k, nou)
    noi.push(nou)
  }
  for (let x = noi.length - 1; x >= 0; x--) if (noi[x].exclus) noi.splice(x, 1)
  const persoane = new Set(noi.map(n => n.nume_normalizat))
  return { noi, deja_detinatori: deja, parcela_negasita: negasite, coliziuni,
    statistici: { candidati: candidati.length, noi: noi.length, persoane_noi: persoane.size, deja_detinatori: deja.length, parcela_negasita: negasite.length,
      coliziuni: coliziuni.length, potrivire_hg: noi.filter(n => n.potrivire === 'hg').length, cu_adresa: noi.filter(n => n.contact.adresa_cunoscuta).length,
      cu_telefon: noi.filter(n => n.contact.telefon).length } }
}

function loturi(arr, n = LOT) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
function verifica(rezultat, ce) {
  if (rezultat?.error) { const e = new Error(`${ce}: ${rezultat.error.message || JSON.stringify(rezultat.error)}`); e.code = rezultat.error.code; throw e }
  return rezultat?.data ?? null
}
// r2 (Jak P2-4): paginare keyset pe id până la pagina GOALĂ — o limită de server mai mică decât pagina cerută nu mai taie tacit rezultatul
// r3 (Jak r2 P1 / Cop r2 P1-01): coloana cursorului e parametru (red_detinatori_contact NU are `id`: cheia e detinator_id); cursorul trebuie să
// existe în proiecție și să avanseze strict, altfel eroare (nu buclă)
async function citesteTot(construieste, ce, pagina, cursor = 'id') {
  const tot = []
  let ultim = null
  for (;;) {
    let q = construieste()
    if (ultim != null) q = q.gt(cursor, ultim)
    const data = verifica(await q.order(cursor).limit(pagina), ce) || []
    if (!data.length) break
    const nou = data[data.length - 1][cursor]
    if (nou == null || (ultim != null && !(String(nou) > String(ultim)))) throw new Error(`${ce}: cursorul „${cursor}” lipsește din rezultat sau nu avansează`)
    tot.push(...data)
    ultim = nou
  }
  return tot
}

/** Datele din BD pentru plan: parcelele ACTIVE ale proiectului (cu cheie) și deținătorii lor ACTIVI. */
export async function citesteDatePlan(supabase, proiectId, { pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  // r2 (Jak P1-1 / Cop P1-02): TOATE parcelele active (și cele fără cheie) — unicitatea HG se judecă pe tot UAT-ul
  const parcele = await citesteTot(() => supabase.from('red_parcele').select('id, cheie_sursa, id_parcela, poz_hg, red_uat(uat3)').eq('proiect_id', proiectId).is('sters_la', null), 'citire parcele', pagina)
  const detinatori = []
  for (const lotI of loturi(parcele.map(p => p.id), lotCitire)) {
    detinatori.push(...await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null), 'citire deținători', pagina))
  }
  return { parcele: parcele.map(({ red_uat, ...p }) => ({ ...p, uat3: red_uat?.uat3 ?? null })), detinatori }
}

/**
 * scrieUtilizatori(supabase, plan, { proiectId, versiune, fisierNume, permite }) → { lotId, detinatoriNoi, contacteNoi, sarite }
 * Recitește deținătorii parcelelor țintă imediat înainte de scriere (alt import / altă fereastră între timp → sare, nu dublează).
 * Oprit cât IMPORT_UTILIZATORI_ACTIV = false (vezi antetul); `permite: true` doar în teste.
 */
export async function scrieUtilizatori(supabase, plan, optiuni = {}) {
  // r3 (Cop r2 P2-03): API-ul productiv NU poate ocoli poarta; doar __scrieUtilizatoriTest (teste) primește `permite`
  return scrie(supabase, plan, { ...optiuni, permite: IMPORT_UTILIZATORI_ACTIV })
}
export const __scrieUtilizatoriTest = (supabase, plan, optiuni = {}) => scrie(supabase, plan, optiuni)

async function scrie(supabase, plan, { proiectId, versiune, fisierNume = null, permite = false, pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  if (!permite) throw new Error('Importul utilizatorilor e oprit până la convocatorul pentru utilizatori (PR3, docs/redari/PLAN_UTILIZATORI.md)')
  if (!proiectId) throw new Error('scrieUtilizatori: proiectId lipsă')
  if (!String(versiune || '').trim()) throw new Error('scrieUtilizatori: versiunea listei e obligatorie')
  const noi = plan?.noi ?? []
  const lot = verifica(await supabase.from('red_import_loturi').insert({
    proiect_id: proiectId, versiune_lista_tgz: versiune, sursa: SURSA_UTILIZATORI, fisier_nume: fisierNume, stare: 'in_curs',
    randuri_total: plan?.statistici?.candidati ?? noi.length, parcele_noi: 0, detinatori_noi: 0,
    // r3 (Cop r2 P2-02): dubluri = coliziunile din fișier; neidentificati = rândurile fără parcelă; „deja deținători” stă în diferente
    dubluri: plan?.coliziuni?.length ?? 0, neidentificati: plan?.parcela_negasita?.length ?? 0,
    // fără date de contact în lot (deja_detinatori poartă contactul candidatului pentru reparare)
    diferente: { deja_detinatori: (plan?.deja_detinatori ?? []).map(({ contact, nume_normalizat, ...d }) => d), parcela_negasita: plan?.parcela_negasita ?? [], coliziuni: plan?.coliziuni ?? [], contacte_noi: 0 },
  }).select('id').single(), 'creare lot import utilizatori')
  const lotId = lot?.id
  if (!lotId) throw new Error('creare lot import utilizatori: nu am primit id-ul lotului')
  const actualizeaza = async (v, ce) => verifica(await supabase.from('red_import_loturi').update(v).eq('id', lotId), ce)
  try {
    // recitire proaspătă: cine e deja pe parcelele țintă (cu sursa, ca să recunoaștem rândurile scrise de un import anterior al acestui fișier)
    const tinte = [...noi, ...(plan?.deja_detinatori ?? []).filter(d => d.parcela_id)]   // (contactele: și pentru rândurile scrise la o rulare anterioară)
    const ids = [...new Set(tinte.map(n => n.parcela_id))]
    const existenti = new Map()
    for (const lotI of loturi(ids, lotCitire)) {
      for (const d of await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat, calitate, sursa_date').in('parcela_id', lotI).is('sters_la', null), 'recitire deținători', pagina)) {
        existenti.set(`${d.parcela_id}|${d.nume_normalizat}`, d)
      }
    }
    // r3 (Cop r2 P1-02): parcelele țintă se reverifică ACUM — active, din proiect; potrivirile pe HG: HG-ul e tot unic în UAT. Orice neconcordanță → rândul
    // NU se scrie (raportat). Fereastra rămasă (schimbare între această citire și INSERT) e acoperită de indexul unic pe (parcela_id, nume) doar pentru dubluri.
    const acum = await citesteDatePlan(supabase, proiectId, { pagina, lotCitire })
    const parcelaAcum = new Map(acum.parcele.map(p => [p.id, p]))
    const hgAcum = new Map()
    for (const p of acum.parcele) if (p.uat3 && p.poz_hg != null && String(p.poz_hg).trim() !== '') { const k = `${p.uat3}|${normalizeazaNume(p.poz_hg)}`; hgAcum.set(k, (hgAcum.get(k) || 0) + 1) }
    const schimbate = []
    const valide = noi.filter(n => {
      const p = parcelaAcum.get(n.parcela_id)
      const ok = p && (n.potrivire !== 'hg' || hgAcum.get(`${n.uat3}|${n.poz_hg}`) === 1) && (n.potrivire !== 'cheie' || p.cheie_sursa === n.cheie_sursa)
      if (!ok) schimbate.push({ rand: n.rand, uat3: n.uat3, id_parcela: n.id_parcela, motiv: 'parcela s-a schimbat între plan și scriere (ștearsă / altă cheie / HG nu mai e unic) — nescris' })
      return ok
    })
    const deScris = valide.filter(n => !existenti.has(`${n.parcela_id}|${n.nume_normalizat}`))
    const sarite = valide.length - deScris.length
    let detinatoriNoi = 0, contacteNoi = 0
    const diferente = () => ({ deja_detinatori: (plan?.deja_detinatori ?? []).map(({ contact, nume_normalizat, ...d }) => d), parcela_negasita: plan?.parcela_negasita ?? [],
      coliziuni: plan?.coliziuni ?? [], schimbate_la_scriere: schimbate, contacte_noi: contacteNoi })
    for (const bucata of loturi(deScris)) {
      const randuri = bucata.map(n => ({ parcela_id: n.parcela_id, nume: n.nume, nume_normalizat: n.nume_normalizat, calitate: CALITATE_UTILIZATOR,
        cota: null, decedat: false, sursa_date: `${SURSA_UTILIZATORI}: TGZ Despăgubiri LOT 1 – date de contact utilizatori (col. 24–26), rândul ${n.rand}`, versiune_lista_tgz: versiune }))
      try { verifica(await supabase.from('red_detinatori').insert(randuri), 'inserare utilizatori') }
      catch (e) { if (e.code === '23505') e.message += ' — alt import a scris între timp aceleași persoane; reluați importul (rândurile existente se sar, contactele lipsă se completează)'; throw e }
      detinatoriNoi += randuri.length
      await actualizeaza({ detinatori_noi: detinatoriNoi, diferente: diferente() }, 'actualizare lot (deținători)')
      for (const lotI of loturi([...new Set(randuri.map(r => r.parcela_id))], lotCitire)) {
        for (const d of await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat, calitate, sursa_date').in('parcela_id', lotI).is('sters_la', null), 'citire id utilizatori', pagina)) existenti.set(`${d.parcela_id}|${d.nume_normalizat}`, d)
      }
    }
    // r2 (Jak P1-2 / Cop P1-01): contactele — pentru TOȚI utilizatorii scriși de acest import (acum sau la o rulare anterioară întreruptă)
    // care n-au încă rând de contact; rândurile altor surse (proprietari) nu se ating
    const alAcestuiImport = d => d && d.calitate === CALITATE_UTILIZATOR && String(d.sursa_date || '').startsWith(`${SURSA_UTILIZATORI}:`)
    const candidatiContact = tinte.map(n => ({ n, d: existenti.get(`${n.parcela_id}|${n.nume_normalizat}`) })).filter(x => alAcestuiImport(x.d))
    const auContact = new Set()
    for (const lotI of loturi([...new Set(candidatiContact.map(x => x.d.id))], lotCitire)) {
      for (const c of await citesteTot(() => supabase.from('red_detinatori_contact').select('detinator_id').in('detinator_id', lotI), 'citire contacte', pagina, 'detinator_id')) auContact.add(c.detinator_id)
    }
    const contacteDeScris = []; const vazut = new Set()
    for (const { n, d } of candidatiContact) { if (!auContact.has(d.id) && !vazut.has(d.id) && n.contact) { vazut.add(d.id); contacteDeScris.push({ detinator_id: d.id, ...n.contact }) } }
    for (const bucata of loturi(contacteDeScris)) {
      verifica(await supabase.from('red_detinatori_contact').insert(bucata), 'inserare contacte utilizatori')
      contacteNoi += bucata.length
      await actualizeaza({ diferente: diferente() }, 'actualizare lot (contacte)')
    }
    const lipsaContact = candidatiContact.filter(x => !auContact.has(x.d.id) && !vazut.has(x.d.id)).length
    await actualizeaza({ stare: 'finalizat', eroare: null, detinatori_noi: detinatoriNoi,
      diferente: { ...diferente(), sarite_la_scriere: sarite, contacte_reparate: contacteDeScris.filter(c => !deScris.some(n => existenti.get(`${n.parcela_id}|${n.nume_normalizat}`)?.id === c.detinator_id)).length, fara_contact: lipsaContact } }, 'finalizare lot')
    return { lotId, detinatoriNoi, contacteNoi, sarite, schimbate: schimbate.length }
  } catch (e) {
    // ca în scrieImport: eroarea de la marcarea „esuat” nu se înghite — rămâne pe eroarea originală (e.lotNeinchis), lotul fiind încă in_curs
    try { await actualizeaza({ stare: 'esuat', eroare: String(e?.message || e).slice(0, 500) }, 'marcare lot eșuat') } catch (e2) { if (e && typeof e === 'object') e.lotNeinchis = String(e2?.message || e2) }
    if (e && typeof e === 'object') e.lotId = lotId
    throw e
  }
}
