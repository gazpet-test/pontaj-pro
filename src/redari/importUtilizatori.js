// Redări — importul utilizatorilor / arendașilor din fișierul TGZ „Despăgubiri LOT 1 – Date de contact utilizatori.xlsx” (juridic#040, PR4 din
// docs/redari/PLAN_UTILIZATORI.md). Import DEDICAT, separat de importTgz.js (parseazaTgz ar transforma proprietarii unici în coproprietari):
//  - foaia 1, antet pe 3 rânduri; coloanele folosite: 0 UAT („01Prunișor”), 2 Nr. Crt HG, 3 Nr. Tarla, 4 Nr. cadastral / parcelă,
//    24 „Prenume și nume” (persoana care folosește terenul, dacă diferă), 25 Adresa, 26 Telefon;
//  - parcela se caută DOAR printre parcelele existente ale proiectului, pe cheie_sursa (uat3|poz_hg|nr_cadastral|tarla — aceeași cheie ca importul TGZ);
//    nu se creează parcele; UAT-urile din afara proiectului (fișierul acoperă toată conducta) se numără, nu se importă;
//  - o persoană deja deținătoare pe aceeași parcelă (nume_normalizat) NU se adaugă a doua oară (se raportează);
//  - rândul nou: red_detinatori cu calitate 'utilizator' (fișierul nu deosebește arendașul de alt utilizator), sursa_date (cu marcajul lotului,
//    „; lot <uuid>”) + versiune_lista_tgz, plus red_detinatori_contact cu adresa (telefonul doar dacă are cel puțin 9 cifre);
//  - lotul în red_import_loturi cu sursa 'TGZ_UTILIZATORI'.
// ORDINEA DE RULARE ÎN PRODUCȚIE: utilizatorii importați intră în generarea în masă (convocatoareMasa.pregatesteLot filtrează doar
// 'neidentificat'), de aceea scrierea a stat oprită până la poarta din PR3a. PR4b (17.11.2026) o pornește (IMPORT_UTILIZATORI_ACTIV = true) pentru că:
//  - poarta PR3a (20261131c_redari_poarta_utilizatori + 20261131d_redari_stare_utilizatori) e aplicată: fără aprobarea owner-ului pe proiect
//    (red_proiecte.convocare_utilizatori_aprobata, implicit false) rezervarea, regenerarea și expedierea convocatorului unui utilizator sunt refuzate
//    în BD (RD006) și în client (convocareUtilizatori.motivConvocatorUtilizator);
//  - șablonul utilizatorului (public/redari/sabloane/convocator_utilizator.docx, PR3b) există;
//  - decizia proprietarului din 17.11.2026: utilizatorii se importă ÎNAINTE de convocări.
// Ecranul: src/redari/ui/ImportUtilizatori.jsx (previzualizare, raport, confirmare dublă). Pași și anulare: docs/redari/IMPORT_UTILIZATORI_ECRAN.md.
import * as XLSX from 'xlsx-js-style'
import { normalizeazaNume } from './idParcela.js'
import { cheieSursa, imparteAdresa, text, LOT, LOT_CITIRE, PAGINA, mesajEroareBd } from './importTgz.js'

export const IMPORT_UTILIZATORI_ACTIV = true
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
    const adresa = gol(r[COL.adresa]) ? null : imparteAdresa(text(r[COL.adresa]), null)
    const contact = adresa
      ? { adresa_strada: adresa.adresa_strada, adresa_sat: adresa.adresa_sat, adresa_comuna: adresa.adresa_comuna, adresa_judet: adresa.adresa_judet, cod_postal: null, adresa_cunoscuta: true }
      : { adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: null, cod_postal: null, adresa_cunoscuta: false }
    contact.telefon = telefonValid(r[COL.telefon])
    // r5 (Cop r3 P1-02): dublura din fișier se elimină aici DOAR dacă are același contact; cu contact diferit ambele rânduri merg în plan,
    // unde coliziunea exclude persoana (nu câștigă primul rând)
    const k = `${cs}#${nn}#${JSON.stringify(contact)}`
    if (vazut.has(k)) { statistici.dubluri_fisier++; dubluri.push({ rand: randExcel, rand_original: vazut.get(k), uat3 }); continue }
    vazut.set(k, randExcel)
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
    // r4 (Jak r3 P1-2): coliziunea se judecă ÎNAINTE de „deja deținător” — și la reluare două adrese diferite exclud persoana (nu câștigă prima)
    if (alese.has(k)) {
      const primul = alese.get(k)
      // r3 (Cop r2 P2-01): contacte diferite pentru aceeași persoană → nu se alege automat; ambele rânduri ies din import, de verificat
      const diferit = JSON.stringify(primul.contact) !== JSON.stringify(c.contact)
      coliziuni.push({ rand: c.rand, rand_ales: primul.rand, uat3: c.uat3, id_parcela: p.id_parcela, motiv: diferit ? 'aceeași persoană pe aceeași parcelă, cu adrese diferite — exclusă, de verificat' : 'aceeași persoană pe aceeași parcelă din alt rând al fișierului (după potrivire)' })
      if (diferit) primul.exclus = true
      continue
    }
    if (existenti.has(k)) {
      // r6 (Jak r4 P1 / Cop r4 P2-01): „deja deținătorii” păstrează identitatea potrivirii — la scriere trec aceeași reverificare a parcelei ca rândurile noi
      const d = { rand: c.rand, uat3: c.uat3, id_parcela: p.id_parcela, parcela_id: p.id, nume_normalizat: c.nume_normalizat, contact: c.contact, motiv: MOTIV_DEJA,
        potrivire, poz_hg: c.poz_hg, cheie_sursa: c.cheie_sursa }
      alese.set(k, d); deja.push(d); continue
    }
    const nou = { ...c, parcela_id: p.id, id_parcela: p.id_parcela, potrivire }
    alese.set(k, nou)
    noi.push(nou)
  }
  for (let x = noi.length - 1; x >= 0; x--) if (noi[x].exclus) noi.splice(x, 1)
  // la „deja deținători” excluderea înseamnă: fără contact reparat automat (rămâne în raport)
  for (const d of deja) if (d.exclus) d.contact = null
  const persoane = new Set(noi.map(n => n.nume_normalizat))
  return { noi, deja_detinatori: deja, parcela_negasita: negasite, coliziuni,
    statistici: { candidati: candidati.length, noi: noi.length, persoane_noi: persoane.size, deja_detinatori: deja.length, parcela_negasita: negasite.length,
      coliziuni: coliziuni.length, potrivire_hg: noi.filter(n => n.potrivire === 'hg').length, cu_adresa: noi.filter(n => n.contact.adresa_cunoscuta).length,
      cu_telefon: noi.filter(n => n.contact.telefon).length } }
}

export function loturi(arr, n = LOT) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
// r2 pct. 3: o eroare cu cod SQLSTATE / PostgREST = refuz determinist (nimic din acea cerere nu s-a comis); fără cod sau clasă tranzitorie
// (08 conexiune, 53 resurse, 57 oprire / timeout, 58 sistem, XX intern) = rezultat NECUNOSCUT (L05): cererea poate să fi fost comisă.
export const eroareDeterminista = e => {
  const c = String(e?.code || '')
  if (/^PGRST/.test(c)) return true
  if (/^[0-9A-Z]{5}$/.test(c)) return !['08', '53', '57', '58', 'XX'].includes(c.slice(0, 2))
  return false
}
function verifica(rezultat, ce) {
  // review #1140 r4: fără `message` NU se serializează obiectul (details / hint pot conține valori) — același mesaj ca verifica() din importTgz
  if (rezultat?.error) { const e = new Error(`${ce}: ${mesajEroareBd(rezultat.error)}`); e.code = rezultat.error.code; throw e }
  return rezultat?.data ?? null
}
// r2 (Jak P2-4): paginare keyset pe id până la pagina GOALĂ — o limită de server mai mică decât pagina cerută nu mai taie tacit rezultatul
// r3 (Jak r2 P1 / Cop r2 P1-01): coloana cursorului e parametru (red_detinatori_contact NU are `id`: cheia e detinator_id); cursorul trebuie să
// existe în proiecție și să avanseze strict, altfel eroare (nu buclă)
export async function citesteTot(construieste, ce, pagina = PAGINA, cursor = 'id') {
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

/** Parcelele ACTIVE ale proiectului (toate, și cele fără cheie), cu uat3. */
export async function citesteParcele(supabase, proiectId, { pagina = PAGINA } = {}) {
  // r2 (Jak P1-1 / Cop P1-02): TOATE parcelele active (și cele fără cheie) — unicitatea HG se judecă pe tot UAT-ul
  const parcele = await citesteTot(() => supabase.from('red_parcele').select('id, cheie_sursa, id_parcela, poz_hg, red_uat(uat3)').eq('proiect_id', proiectId).is('sters_la', null), 'citire parcele', pagina)
  return parcele.map(({ red_uat, ...p }) => ({ ...p, uat3: red_uat?.uat3 ?? null }))
}

/** Datele din BD pentru plan: parcelele ACTIVE ale proiectului (cu cheie) și deținătorii lor ACTIVI. */
export async function citesteDatePlan(supabase, proiectId, { pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  const parcele = await citesteParcele(supabase, proiectId, { pagina })
  const detinatori = []
  for (const lotI of loturi(parcele.map(p => p.id), lotCitire)) {
    detinatori.push(...await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat').in('parcela_id', lotI).is('sters_la', null), 'citire deținători', pagina))
  }
  return { parcele, detinatori }
}

// ── PR4b r2: identitatea scrierii și verificarea țintei ──────────────────────────────────────────────────────────────────────────
// Fiecare deținător scris de un lot poartă la finalul sursa_date marcajul „; lot <uuid>” (lotul se creează înaintea primului INSERT).
// Marcajul e dovada „scris de această operație” la reconciliere (și după un răspuns pierdut), la raport și la anularea pe lot.
export const markerLot = lotId => `; lot ${lotId}`
export const scrisDeLot = (d, lotId) => !!lotId && !!d && String(d.sursa_date || '').startsWith(`${SURSA_UTILIZATORI}:`) && String(d.sursa_date).endsWith(markerLot(lotId))
export const sursaUtilizator = (rand, lotId) => `${SURSA_UTILIZATORI}: TGZ Despăgubiri LOT 1 – date de contact utilizatori (col. 24–26), rândul ${rand}${markerLot(lotId)}`
const randDinSursa = s => { const m = /rândul (\d+)/.exec(String(s || '')); return m ? Number(m[1]) : null }

/** Indexul parcelelor active (citite acum): după id, numărul de parcele pe (UAT, HG) și pe cheie. */
export function indexParcele(parcele = []) {
  const dupaId = new Map(parcele.map(p => [p.id, p]))
  const hg = new Map(), cheie = new Map()
  for (const p of parcele) {
    if (p.uat3 && p.poz_hg != null && String(p.poz_hg).trim() !== '') { const k = `${p.uat3}|${normalizeazaNume(p.poz_hg)}`; hg.set(k, (hg.get(k) || 0) + 1) }
    if (p.cheie_sursa) cheie.set(p.cheie_sursa, (cheie.get(p.cheie_sursa) || 0) + 1)
  }
  return { dupaId, hg, cheie }
}

/**
 * Ținta confirmată a unui rând (parcela_id + potrivirea din plan) e încă valabilă în indexul dat? → null = da; altfel motivul.
 * Aceeași regulă înainte de fiecare bucată scrisă și în verificarea de după scriere (o singură definiție, L19).
 */
export function motivTintaSchimbata(n, idx) {
  const p = idx.dupaId.get(n.parcela_id)
  if (!p) return 'parcela nu mai e activă în proiect'
  if (n.potrivire === 'hg') {
    // r4 (Jak r3 P1-1): la HG, parcela aleasă trebuie să aibă ÎNCĂ acel HG, în același UAT, iar HG-ul să fie tot unic
    if (p.uat3 !== n.uat3 || p.poz_hg == null || normalizeazaNume(p.poz_hg) !== n.poz_hg) return 'parcela nu mai are poziția HG din fișier'
    if (idx.hg.get(`${n.uat3}|${n.poz_hg}`) !== 1) return 'poziția HG nu mai e unică în UAT'
    return null
  }
  if (n.potrivire === 'cheie') {
    // r6 (Cop r4 P2-02) + r7 (Cop r5 P2): cheia încă a parcelei, în UAT-ul din fișier, și încă unică între parcelele active
    if (p.uat3 !== n.uat3 || p.cheie_sursa !== n.cheie_sursa) return 'parcela nu mai are cheia din fișier'
    if (idx.cheie.get(n.cheie_sursa) !== 1) return 'cheia nu mai e unică în proiect'
    return null
  }
  return 'potrivire necunoscută'
}

/**
 * clasificaContacte (r3, Jak r2 P2-1) — completarea contactelor, o singură definiție pentru scriere, ecran și raport (L19).
 *  intentie: [{ detinator_id, rand }] — consemnată în lot ÎNAINTEA primului INSERT de contact (și pentru deținătorii loturilor vechi);
 *  confirmate: id-urile din bucățile cu răspuns reușit; nesigure: id-urile din bucățile cu răspuns pierdut (null = nu știm care bucăți au
 *  plecat → toată intenția neconfirmată e nesigură); acum: Map detinator_id → updated_at, citit ACUM din BD.
 * → { scrise, necunoscute, nescrise, aparute } (id-uri):
 *  scrise = confirmate; nescrise = fără contact acum (contactele nu se șterg: lipsa dovedește că nu s-a scris);
 *  necunoscute = nesigure care AU contact acum — al nostru sau al altcuiva, atribuirea nu se poate dovedi („necunoscut — de verificat”);
 *  aparute = neîncercate / refuzate determinist, dar cu contact acum (adăugat din altă parte).
 */
export function clasificaContacte({ intentie = [], confirmate = [], nesigure = null, acum = new Map() } = {}) {
  const conf = new Set(confirmate), nes = nesigure ? new Set(nesigure) : null
  const out = { scrise: [], necunoscute: [], nescrise: [], aparute: [] }
  for (const { detinator_id: id } of intentie) {
    if (conf.has(id)) out.scrise.push(id)
    else if (!acum.has(id)) out.nescrise.push(id)
    else if (!nes || nes.has(id)) out.necunoscute.push(id)
    else out.aparute.push(id)
  }
  return out
}

/**
 * reconciliazaImport — ce a scris lotul `lotId`, citit ACUM din BD, și verificarea după scriere (detecție, nu prevenire):
 * fiecare rând cu marcajul lotului trece din nou motivTintaSchimbata pe parcelele recitite; cele care nu mai trec = „de verificat”.
 * `contacte` (r3, opțional) = { intentie, confirmate, nesigure } ale completării contactelor → clasificarea lor din BD (clasificaContacte).
 * → { parcele, detinatori (activi pe parcelele țintă), contacte: Map detinator_id → updated_at, scrise: [{ id, parcela_id, rand, creat_la,
 *     modificat_la, contact_la }], deVerificat: [{ rand, id, parcela_id, id_parcela, motiv }], contacteIntentie, contacteClasificate }
 */
export async function reconciliazaImport(supabase, { proiectId, lotId, plan, contacte: evContacte = null }, { pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  const parcele = await citesteParcele(supabase, proiectId, { pagina })
  const idx = indexParcele(parcele)
  const tinte = [...new Set([...(plan?.noi ?? []), ...(plan?.deja_detinatori ?? [])].map(n => n.parcela_id).filter(Boolean))]
  const detinatori = []
  for (const lotI of loturi(tinte, lotCitire)) {
    detinatori.push(...await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat, calitate, sursa_date, created_at, updated_at').in('parcela_id', lotI).is('sters_la', null), 'reconciliere deținători', pagina))
  }
  const contacte = new Map()
  // r3: și contactele deținătorilor din intenție (inclusiv cei care între timp nu mai sunt activi pe parcelele țintă)
  const idsContact = [...new Set([...detinatori.map(d => d.id), ...(evContacte?.intentie ?? []).map(c => c.detinator_id)])]
  for (const lotI of loturi(idsContact, lotCitire)) {
    for (const c of await citesteTot(() => supabase.from('red_detinatori_contact').select('detinator_id, updated_at').in('detinator_id', lotI), 'reconciliere contacte', pagina, 'detinator_id')) contacte.set(c.detinator_id, c.updated_at ?? null)
  }
  const dinPlan = new Map((plan?.noi ?? []).map(n => [`${n.parcela_id}|${n.nume_normalizat}`, n]))
  const scrise = [], deVerificat = []
  for (const d of detinatori) {
    if (!scrisDeLot(d, lotId)) continue
    const n = dinPlan.get(`${d.parcela_id}|${d.nume_normalizat}`)
    const rand = n?.rand ?? randDinSursa(d.sursa_date)
    scrise.push({ id: d.id, parcela_id: d.parcela_id, rand, creat_la: d.created_at ?? null, modificat_la: d.updated_at ?? null, contact_la: contacte.has(d.id) ? contacte.get(d.id) : null })
    const motiv = n ? motivTintaSchimbata(n, idx) : 'rândul nu corespunde niciunui rând nou din planul confirmat'
    if (motiv) deVerificat.push({ rand, id: d.id, parcela_id: d.parcela_id, id_parcela: idx.dupaId.get(d.parcela_id)?.id_parcela ?? n?.id_parcela ?? null, motiv: `de verificat: ținta s-a schimbat în timpul importului (${motiv})` })
  }
  return { parcele, detinatori, contacte, scrise, deVerificat, contacteIntentie: evContacte?.intentie ?? null,
    contacteClasificate: evContacte ? clasificaContacte({ ...evContacte, acum: contacte }) : null }
}

/**
 * scrieUtilizatori(supabase, plan, { proiectId, versiune, fisierNume }) → { lotId, nimicDeFacut, detinatoriNoi, contacteNoi, sarite, schimbate,
 *   deVerificat, eroareVerificare, contacteNecunoscute, contacte: { intentie, confirmate, nesigure } }
 * La eroare (cu lot creat): e.lotId, e.evidenta = { deVerificat, contacteNecunoscute, eroareVerificare, contacte }, eventual e.lotNeinchis.
 * Recitește parcelele și deținătorii țintă imediat înaintea fiecărei bucăți (alt import / altă fereastră între timp → sare, nu dublează),
 * apoi verifică după scriere (vezi scrie). `plan.noi` = DOAR rândurile confirmate de operator (ecranul scoate potrivirile HG neconfirmate și le
 * pune în `plan.hg_neconfirmate`). Oprit dacă IMPORT_UTILIZATORI_ACTIV = false (vezi antetul); `permite: true` doar în teste.
 */
export async function scrieUtilizatori(supabase, plan, optiuni = {}) {
  // r3 (Cop r2 P2-03): API-ul productiv NU poate ocoli poarta; doar __scrieUtilizatoriTest (teste) primește `permite`
  return scrie(supabase, plan, { ...optiuni, permite: IMPORT_UTILIZATORI_ACTIV })
}
// r4 (Jak r3 P2): calea de test merge DOAR sub Vitest (import.meta.env.MODE === 'test'); în build-ul aplicației (production / development) refuză
export const __scrieUtilizatoriTest = (supabase, plan, optiuni = {}) => {
  if (import.meta.env?.MODE !== 'test') throw new Error('__scrieUtilizatoriTest e disponibil doar în teste')
  return scrie(supabase, plan, optiuni)
}

/*
 * scrie (r2, PR4b) — fără schemă nouă; ce garantează și ce nu:
 *  - lotul se creează ÎNAINTEA primului INSERT: id-ul lui intră în marcajul fiecărui deținător scris (sursaUtilizator); fără nimic de scris
 *    (0 noi și niciun contact de completat) NU se creează lot (r2 pct. 8);
 *  - parcelele și deținătorii țintă se recitesc IMEDIAT înaintea FIECĂREI bucăți scrise (r2 pct. 1a). Ce rămâne: intervalul dintre această
 *    recitire și INSERT-ul bucății (două cereri); o parcelă schimbată de alt operator exact atunci NU e văzută înainte de scriere;
 *  - după scriere, reconciliazaImport reverifică fiecare rând scris pe parcelele recitite (r2 pct. 1b): ce nu mai trece = „de verificat”
 *    (detecție, nu prevenire), în rezultat și în lot;
 *  - lotul păstrează în `diferente`: scrise (id-urile deținătorilor creați de lot), contacte_scrise, de_verificat_dupa_scriere,
 *    hg_neconfirmate (r2 pct. 5, 6). Fără nume / contacte în lot (lotul e citibil și de viewer);
 *  - r3 (Jak r2 P2-1): INTENȚIA completării contactelor (contacte_intentie: [{ detinator_id, rand }], și pentru deținătorii loturilor vechi)
 *    se scrie în lot ÎNAINTEA primului INSERT de contact; bucățile cu răspuns pierdut intră în contacte_nesigure. După orice eroare, contactele
 *    intenției se recitesc și se clasifică (clasificaContacte): ce nu se poate atribui exact = contacte_necunoscute („necunoscut — de verificat”);
 *  - r3 (Jak r2 P2-2): finalizarea și calea de eroare trec prin ACEEAȘI funcție (incheieLot): aceeași reconciliere, același
 *    de_verificat_dupa_scriere + verificare_dupa_scriere pe lot, ca avertismentul să rămână durabil și când ecranul nu mai poate reciti.
 */
async function scrie(supabase, plan, { proiectId, versiune, fisierNume = null, permite = false, pagina = PAGINA, lotCitire = LOT_CITIRE, marimeLot = LOT } = {}) {
  if (!permite) throw new Error('Importul utilizatorilor e oprit (IMPORT_UTILIZATORI_ACTIV = false; docs/redari/PLAN_UTILIZATORI.md)')
  if (!proiectId) throw new Error('scrieUtilizatori: proiectId lipsă')
  if (!String(versiune || '').trim()) throw new Error('scrieUtilizatori: versiunea listei e obligatorie')
  const noi = plan?.noi ?? []
  const deja = (plan?.deja_detinatori ?? []).filter(d => d.parcela_id && d.contact)   // (contactele: și pentru rândurile scrise la o rulare anterioară; excluse = fără contact)
  const faraPii = ({ contact, nume_normalizat, nume, ...d }) => d
  const cheie = n => `${n.parcela_id}|${n.nume_normalizat}`
  const schimbate = [], scrise = [], contacteScrise = [], contacteIntentie = [], contacteNesigure = []
  let detinatoriNoi = 0, contacteNoi = 0, sarite = 0, lotId = null, lipsaContact = null
  const diferente = (extra = {}) => ({ deja_detinatori: (plan?.deja_detinatori ?? []).map(faraPii), parcela_negasita: plan?.parcela_negasita ?? [],
    coliziuni: plan?.coliziuni ?? [], hg_neconfirmate: (plan?.hg_neconfirmate ?? []).map(faraPii), schimbate_la_scriere: schimbate,
    scrise, contacte_intentie: contacteIntentie, contacte_scrise: contacteScrise, contacte_nesigure: contacteNesigure, contacte_noi: contacteNoi, ...extra })
  const evidentaContacte = () => ({ intentie: [...contacteIntentie], confirmate: [...contacteScrise], nesigure: [...contacteNesigure] })
  const creeazaLot = async () => {
    const lot = verifica(await supabase.from('red_import_loturi').insert({
      proiect_id: proiectId, versiune_lista_tgz: versiune, sursa: SURSA_UTILIZATORI, fisier_nume: fisierNume, stare: 'in_curs',
      randuri_total: plan?.statistici?.candidati ?? noi.length, parcele_noi: 0, detinatori_noi: 0,
      // r3 (Cop r2 P2-02): dubluri = coliziunile din fișier; neidentificati = rândurile fără parcelă; „deja deținători” stă în diferente
      dubluri: plan?.coliziuni?.length ?? 0, neidentificati: plan?.parcela_negasita?.length ?? 0,
      diferente: diferente(),
    }).select('id').single(), 'creare lot import utilizatori')
    if (!lot?.id) throw new Error('creare lot import utilizatori: nu am primit id-ul lotului')
    return lot.id
  }
  const actualizeaza = async (v, ce) => verifica(await supabase.from('red_import_loturi').update(v).eq('id', lotId), ce)
  const citesteDetinatori = async (parcelaIds, ce) => {
    const m = new Map()
    for (const lotI of loturi(parcelaIds, lotCitire)) {
      for (const d of await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume_normalizat, calitate, sursa_date').in('parcela_id', lotI).is('sters_la', null), ce, pagina)) m.set(`${d.parcela_id}|${d.nume_normalizat}`, d)
    }
    return m
  }
  const marcheazaSchimbat = (n, motiv) => schimbate.push({ rand: n.rand, uat3: n.uat3, id_parcela: n.id_parcela, motiv: `parcela s-a schimbat între plan și scriere (${motiv}) — nescris` })
  // r3 (Jak r2 P2-2, L19): O SINGURĂ încheiere a lotului pentru finalizare ȘI pentru eroare — aceeași reconciliere din BD (deținători după
  // marcaj + contactele intenției), același rezultat al verificării de după scriere scris pe lot. Eroarea de la scrierea lotului urcă la apelant.
  const incheieLot = async (stare, eroareText = null) => {
    let rec = null, eroareVerificare = null
    try { rec = await reconciliazaImport(supabase, { proiectId, lotId, plan, contacte: evidentaContacte() }, { pagina, lotCitire }) }
    catch (e) { eroareVerificare = String(e?.message || e).slice(0, 300) }
    if (rec) scrise.splice(0, scrise.length, ...rec.scrise)
    const deVerificat = rec?.deVerificat ?? []
    // fără recitire, ce era nesigur rămâne necunoscut (L18: nu „nescris”, nu „neschimbat”)
    const contacteNecunoscute = rec ? rec.contacteClasificate.necunoscute : [...contacteNesigure]
    const idScrise = new Set(scrise.map(s => s.id))
    await actualizeaza({ stare, eroare: eroareText, detinatori_noi: stare === 'esuat' && rec ? scrise.length : detinatoriNoi,
      diferente: diferente({ sarite_la_scriere: sarite, contacte_reparate: contacteScrise.filter(id => !idScrise.has(id)).length, fara_contact: lipsaContact,
        de_verificat_dupa_scriere: deVerificat, verificare_dupa_scriere: rec ? 'facuta' : `esuata: ${eroareVerificare}`, evidenta_din_bd: !!rec,
        contacte_necunoscute: contacteNecunoscute,
        // momentul contactelor scrise de lot, citit imediat după scriere: anularea recunoaște astfel un contact modificat ulterior de un om
        contacte_la: rec ? Object.fromEntries(contacteScrise.filter(id => rec.contacte.has(id)).map(id => [id, rec.contacte.get(id)])) : {} }) },
      stare === 'esuat' ? 'marcare lot eșuat' : 'finalizare lot')
    return { deVerificat, eroareVerificare, contacteNecunoscute }
  }

  if (noi.length) lotId = await creeazaLot()
  try {
    const valideNoi = []
    for (const bucata of loturi(noi, marimeLot)) {
      // r2 pct. 1a (L01 fără schemă): ținta se recitește chiar înaintea acestei bucăți, nu o dată pentru tot lotul
      const idx = indexParcele(await citesteParcele(supabase, proiectId, { pagina }))
      const existenti = await citesteDetinatori([...new Set(bucata.map(n => n.parcela_id))], 'recitire deținători')
      const deScris = []
      for (const n of bucata) {
        const motiv = motivTintaSchimbata(n, idx)
        if (motiv) { marcheazaSchimbat(n, motiv); continue }
        valideNoi.push(n)
        if (existenti.has(cheie(n))) sarite++; else deScris.push(n)
      }
      if (deScris.length) {
        const randuri = deScris.map(n => ({ parcela_id: n.parcela_id, nume: n.nume, nume_normalizat: n.nume_normalizat, calitate: CALITATE_UTILIZATOR,
          cota: null, decedat: false, sursa_date: sursaUtilizator(n.rand, lotId), versiune_lista_tgz: versiune }))
        try { verifica(await supabase.from('red_detinatori').insert(randuri), 'inserare utilizatori') }
        catch (e) { if (e.code === '23505') e.message += ' — alt import a scris între timp aceleași persoane; reluați importul (rândurile existente se sar, contactele lipsă se completează)'; throw e }
        detinatoriNoi += randuri.length
        // r2 pct. 6: id-urile create de acest lot (după marcaj), pentru evidența lotului
        const dupa = await citesteDetinatori([...new Set(deScris.map(n => n.parcela_id))], 'citire id utilizatori')
        for (const n of deScris) { const d = dupa.get(cheie(n)); if (scrisDeLot(d, lotId)) scrise.push({ id: d.id, parcela_id: d.parcela_id, rand: n.rand }) }
      }
      await actualizeaza({ detinatori_noi: detinatoriNoi, diferente: diferente() }, 'actualizare lot (deținători)')
    }
    // r2 (Jak P1-2 / Cop P1-01): contactele — pentru TOȚI utilizatorii scriși de un import TGZ_UTILIZATORI (acum sau la o rulare anterioară
    // întreruptă) care n-au încă rând de contact; rândurile altor surse (proprietari) nu se ating. r6 (Jak r4 P1): ținta „deja deținătorilor”
    // se reverifică pe parcelele recitite acum.
    const idxC = indexParcele(await citesteParcele(supabase, proiectId, { pagina }))
    const tinte = [...valideNoi]
    for (const d of deja) { const motiv = motivTintaSchimbata(d, idxC); if (motiv) marcheazaSchimbat(d, motiv); else tinte.push(d) }
    const existenti = await citesteDetinatori([...new Set(tinte.map(n => n.parcela_id))], 'recitire deținători (contacte)')
    const alUnuiImport = d => d && d.calitate === CALITATE_UTILIZATOR && String(d.sursa_date || '').startsWith(`${SURSA_UTILIZATORI}:`)
    const candidatiContact = tinte.map(n => ({ n, d: existenti.get(cheie(n)) })).filter(x => alUnuiImport(x.d))
    const auContact = new Set()
    for (const lotI of loturi([...new Set(candidatiContact.map(x => x.d.id))], lotCitire)) {
      for (const c of await citesteTot(() => supabase.from('red_detinatori_contact').select('detinator_id').in('detinator_id', lotI), 'citire contacte', pagina, 'detinator_id')) auContact.add(c.detinator_id)
    }
    const contacteDeScris = []; const vazut = new Set()
    for (const { n, d } of candidatiContact) {
      if (!auContact.has(d.id) && !vazut.has(d.id) && n.contact) { vazut.add(d.id); contacteDeScris.push({ detinator_id: d.id, ...n.contact }); contacteIntentie.push({ detinator_id: d.id, rand: n.rand ?? null }) }
    }
    lipsaContact = candidatiContact.filter(x => !auContact.has(x.d.id) && !vazut.has(x.d.id)).length
    if (!lotId) {
      // r2 pct. 8: nimic nou și niciun contact de completat → niciun lot nou în istoric
      if (!contacteDeScris.length) return { lotId: null, nimicDeFacut: true, detinatoriNoi: 0, contacteNoi: 0, sarite, schimbate: schimbate.length, deVerificat: [], eroareVerificare: null, contacteNecunoscute: [], contacte: evidentaContacte() }
      lotId = await creeazaLot()                                     // r3: lotul nou poartă deja intenția (diferente.contacte_intentie)
    } else if (contacteDeScris.length) {
      await actualizeaza({ diferente: diferente() }, 'consemnare contacte de completat')   // r3: intenția, ÎNAINTEA primului INSERT de contact
    }
    for (const bucata of loturi(contacteDeScris, marimeLot)) {
      try { verifica(await supabase.from('red_detinatori_contact').insert(bucata), 'inserare contacte utilizatori') }
      catch (e) { if (!eroareDeterminista(e)) contacteNesigure.push(...bucata.map(c => c.detinator_id)); throw e }   // L05: răspuns pierdut = poate comis
      contacteNoi += bucata.length; contacteScrise.push(...bucata.map(c => c.detinator_id))
      await actualizeaza({ diferente: diferente() }, 'actualizare lot (contacte)')
    }
    // r2 pct. 1b: verificarea după scriere (detecție): rândurile scrise a căror țintă nu mai trece regula sunt „de verificat”
    const fin = await incheieLot('finalizat')
    return { lotId, nimicDeFacut: false, detinatoriNoi, contacteNoi, sarite, schimbate: schimbate.length, ...fin, contacte: evidentaContacte() }
  } catch (e) {
    if (lotId) {
      // r2 pct. 3 / 6 + r3: după o eroare (inclusiv un răspuns pierdut după COMMIT), aceeași încheiere ca la finalizare: evidența din BD după
      // marcaj, contactele intenției clasificate, verificarea de după scriere pe lot
      let fin = null
      try { fin = await incheieLot('esuat', String(e?.message || e).slice(0, 500)) }
      // ca în scrieImport: eroarea de la marcarea „esuat” nu se înghite — rămâne pe eroarea originală (e.lotNeinchis), lotul fiind încă in_curs
      catch (e2) { if (e && typeof e === 'object') e.lotNeinchis = String(e2?.message || e2) }
      if (e && typeof e === 'object') {
        e.lotId = lotId
        // evidența scriitorului (din BD, plus ce știe doar el: bucățile cu răspuns pierdut), pentru ecran — chiar dacă lotul n-a putut fi scris
        e.evidenta = { deVerificat: fin?.deVerificat ?? [], contacteNecunoscute: fin?.contacteNecunoscute ?? [...contacteNesigure], eroareVerificare: fin?.eroareVerificare ?? null, contacte: evidentaContacte() }
      }
    }
    throw e
  }
}
