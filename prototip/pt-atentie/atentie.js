// ════════════════════════════════════════════════════════════════
// atentie.js — „Necesită atenția ta" (prototip B, PT Workspace V2) — FUNCȚII PURE, READ-ONLY.
//
// Contract: construiesteAtentia v1 (Audit V2, 29.09.2026) — vezi README.md din acest folder.
// Transformă un snapshot DEJA CITIT în lista de lucru a omului. Nu face I/O, nu importă supabase
// sau React, nu citește ceasul (`acum` vine din afară), nu modifică intrarea.
//
// Verdictul e SIMULAT: J07 (ofertare_poarta_server) NU există în BD. Orice verdict de aici poartă
// eticheta literală „SIMULAT — J07 neaplicat" și NU înseamnă „gata de depus".
//
// Regulile Audit V2, aplicate mecanic:
//   1. AI candidate ≠ human verified — un candidat AI nu ajunge niciodată în ok[].
//   2. Lipsa informației ≠ negativ și ≠ verde — NULL / câmp absent = necunoscut (indisponibil / decizie umană).
//   3. Eroare / stale / lipsă nu devin verde și nici listă goală — intră în indisponibile[].
//   4. Sistemul grupează munca, nu judecata — acțiunile sunt doar navigare / recitire (scrie:false),
//      fără „confirmă toate", fără preselecție după scor.
// ════════════════════════════════════════════════════════════════

import { evalueazaPoarta, CONTOARE_BLOCANTE_CANTITATI } from '../../src/ofertarePoarta.js'
import { campuriCantitatiNevalidate } from '../../src/ofertareCantitatiAprobare.js'

export const ETICHETA_SIMULAT = 'SIMULAT — J07 neaplicat'
export const NEGATIE_GATA = 'Nu înseamnă «gata de depus»'
export const PRAGURI_IMPLICITE = Object.freeze({ stale_ms: 10 * 60e3, expirat_ms: 2 * 3600e3, toleranta_viitor_ms: 2 * 60e3 })
export const LICITATII_PERMISE_IMPLICIT = Object.freeze([103])
export const INTENTII_PERMISE = Object.freeze(['deschide_capitol', 'deschide_matrice', 'deschide_registru', 'deschide_acoperire',
  'deschide_documente', 'deschide_cantitati', 'deschide_f9', 'deschide_grafic', 'deschide_conformitate', 'deschide_observatii',
  'deschide_participanti', 'deschide_garantie', 'recitire'])
// I10: nicio etichetă / intenție nu are voie să sune a judecată în bloc sau a scriere finală
export const REGEX_JUDECATA_IN_BLOC = /confirm[aă]?\s*(toate|tot|lot|în bloc)|bulk|aprob|semneaz|verific[aă] (toate|lot)/i
// Copiat EXACT din CTE-ul `cer` al v_ofertare_pt_stare (20260913_ofertare_pt_stare_cerinte_neverificate.sql)
export const REGEX_CAPCANA = /(respins|resping[ăa-z]* (a |la )?(ofert|candidatur)|neconform|descalific|inacceptabil|sub sanc[tț]iune|f[aă]r[aă] (posibilitatea de a solicita )?clarific|nu se accept|se consider[aă] (ca )?lips[aă]|indiferent de modul de prezentare)/iu

export const SURSE_OBLIGATORII = Object.freeze(['licitatie', 'cerinte', 'legaturi', 'capitole', 'acoperire', 'pt_dovezi', 'documente',
  'documente_firma_valabilitate', 'pt_stare', 'seap_completitudine', 'r5', 'e2_neconfirmate', 'echipa_blocaje', 'cantitati_nevalidate'])
export const SURSE_OPTIONALE = Object.freeze(['candidati_citat', 'j07', 'capitole_versiuni', 'poarta_pt', 'pachet'])
// surse opționale doar pentru afișare (istoric, ultima semnătură): nu intră în reguli, deci nici în prospețime;
// apar în indisponibile doar dacă au venit cu eroare / pentru altă licitație / în formă invalidă
const SURSE_AFISARE = new Set(['capitole_versiuni', 'poarta_pt', 'pachet'])
const FORMA = {
  licitatie: 'obiect', cerinte: 'lista', legaturi: 'lista', capitole: 'lista', acoperire: 'lista', pt_dovezi: 'lista', documente: 'lista',
  documente_firma_valabilitate: 'lista', pt_stare: 'obiect', seap_completitudine: 'obiect', r5: 'obiect', e2_neconfirmate: 'obiect',
  echipa_blocaje: 'lista', cantitati_nevalidate: 'obiect', candidati_citat: 'lista', j07: 'obiect', capitole_versiuni: 'lista',
  poarta_pt: 'lista', pachet: 'lista',
}
// Ce tabel / view stă în spatele fiecărei surse (pentru cauze și proveniență)
export const TABEL_SURSA = {
  licitatie: 'ofertare_licitatii', cerinte: 'ofertare_cerinte', legaturi: 'ofertare_pt_legaturi', capitole: 'ofertare_pt_capitole',
  acoperire: 'ofertare_acoperire', pt_dovezi: 'ofertare_pt_dovezi', documente: 'ofertare_documente_atribuire',
  documente_firma_valabilitate: 'documente_firma', pt_stare: 'v_ofertare_pt_stare', seap_completitudine: 'v_ofertare_seap_completitudine',
  r5: 'ofertare_r5_blocaj_sursa()', e2_neconfirmate: 'v_ofertare_pt_cerinte_neconfirmate', echipa_blocaje: 'v_ofertare_pt_echipa_blocaje',
  cantitati_nevalidate: 'v_ofertare_cantitati_nevalidate', candidati_citat: 'candidați de citat (inexistent încă)',
  j07: 'ofertare_poarta_server()', capitole_versiuni: 'ofertare_pt_capitole_versiuni', poarta_pt: 'ofertare_pt_poarta', pachet: 'ofertare_pt_pachet',
}
export const RANG_CLASA = Object.freeze({ BLOCK: 0, HUMAN_DECISION: 1, CONFIRM: 2, WARN: 3 })
const RANG_POARTA = { pt: 0, depunere: 1, pachet: 2, f9: 3 }
const RANG_CALITATE = { proaspat: 0, stale: 1, expirat: 2 }
const RANG_J07 = { OK: 0, READY: 0, WARN: 1, INDISPONIBIL: 2, UNAVAILABLE: 2, BLOCKED: 3 }

// ── R06 — dovada (formula server, inclusiv NULL, în JS strict) ──────────────────────────────────
// SQL: a.status IN ('acoperit','acoperit_partener') AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta,false)
//   verificat_pe_scan NULL → NULL AND … → nu e TRUE → NU e dovedită. Orice altceva decât `true` (null, undefined, 'true', 1) = neverificat.
//   reverificare_ceruta NULL → COALESCE false → nu blochează. O valoare non-boolean non-null = CONSERVATOR „reverificare cerută".
const FAV = new Set(['acoperit', 'acoperit_partener'])
export const favorabila = a => FAV.has(a?.status)
export const reverif = a => !(a?.reverificare_ceruta === false || a?.reverificare_ceruta == null)
export const doveditaR06 = a => favorabila(a) && a?.verificat_pe_scan === true && !reverif(a)

// ── utilitare pure ──────────────────────────────────────────────────────────────────────────────
const esteObiect = v => v != null && typeof v === 'object' && !Array.isArray(v)
const isoDin = ms => new Date(ms).toISOString()
const ora = iso => (typeof iso === 'string' && iso.length >= 16 ? `${iso.slice(11, 16)} UTC` : '?')
const cmpNum = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const cmpStr = (a, b) => { const x = String(a), y = String(b); return x < y ? -1 : x > y ? 1 : 0 }
const nrNumeric = nr => { const n = typeof nr === 'number' ? nr : parseFloat(String(nr ?? '')); return Number.isFinite(n) ? n : Infinity }
const cmpCapitol = (a, b) => cmpNum(nrNumeric(a.nr), nrNumeric(b.nr)) || cmpStr(a.nr ?? '', b.nr ?? '') || cmpNum(a.id, b.id)
const plural = (n, unu, multe) => `${n} ${n === 1 ? unu : multe}`
const e_trunchiat = t => typeof t === 'string' && /\s\[trunchiat\]$/.test(t)
// Actor = cine a făcut acțiunea. NULL, șir gol sau doar spații = FĂRĂ actor (nu e dovada unei acțiuni umane).
export const areActor = v => (typeof v === 'string' ? v.trim() !== '' : v != null)
// Momentul unei acțiuni, la secundă (ISO „YYYY-MM-DDTHH:MM:SS" UTC); invalid / lipsă → null
const secunda = t => { const ms = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19) : null }
// Decizii „în bloc": mai multe rânduri cu ACELAȘI moment (la secundă) = o singură acțiune pe grup, nu judecăți individuale.
// UI-ul de azi scrie rând cu rând (cu reîncărcare între ele), deci două decizii individuale nu cad în aceeași secundă.
function grupeInBloc(randuri, moment) {
  const g = new Map()
  for (const r of randuri) { const s = secunda(moment(r)); if (s == null) continue; if (!g.has(s)) g.set(s, []); g.get(s).push(r) }
  const inBloc = new Map()   // rând → { secunda, marime }
  for (const [s, lst] of g) if (lst.length > 1) for (const r of lst) inBloc.set(r, { secunda: s, marime: lst.length })
  return inBloc
}

function parseAcum(acum) {
  let ms = NaN
  if (acum instanceof Date) ms = acum.getTime()
  else if (typeof acum === 'string') ms = Date.parse(acum)
  else if (typeof acum === 'number') ms = acum
  if (!Number.isFinite(ms)) throw new TypeError('acum')
  return ms
}
function normPraguri(p) {
  const x = { ...PRAGURI_IMPLICITE, ...(esteObiect(p) ? p : {}) }
  for (const k of ['stale_ms', 'expirat_ms', 'toleranta_viitor_ms']) if (!Number.isFinite(x[k]) || x[k] < 0) throw new TypeError('praguri')
  if (x.expirat_ms < x.stale_ms) throw new TypeError('praguri')
  return { stale_ms: x.stale_ms, expirat_ms: x.expirat_ms, toleranta_viitor_ms: x.toleranta_viitor_ms }
}
// Curăță ieșirea: fără `undefined`, fără Date / funcții (ieșirea trebuie să fie JSON pur)
function curata(v) {
  if (Array.isArray(v)) return v.map(curata)
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw new TypeError('ieșire neserializabilă')
    return v
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) throw new TypeError('ieșire neserializabilă')
  const o = {}
  for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = curata(v[k])
  return o
}
const actiune = (intent, eticheta, parametri) => ({ intent, eticheta, parametri, scrie: false })

// ════════════════════════════════════════════════════════════════
// SURSE — validare, licitație, prospețime (contract §2)
// ════════════════════════════════════════════════════════════════
function infoSursa(nume, s, L, capturat_la, acumMs, P) {
  const obligatorie = SURSE_OBLIGATORII.includes(nume)
  const tabel = TABEL_SURSA[nume]
  const nu = (motiv, detaliu) => ({ nume, obligatorie, tabel, prezenta: true, utilizabila: false, motiv, detaliu })
  if (s == null || (esteObiect(s) && s.stare === 'lipsa')) {
    if (!obligatorie) return { nume, obligatorie, tabel, prezenta: false }
    return nu('lipsa', `${tabel}: ${s?.eroare ? String(s.eroare) : 'sursa nu a fost citită'}`)
  }
  if (!esteObiect(s)) return nu('forma_invalida', `${tabel}: sursa nu e un obiect`)
  if (s.stare === 'eroare') return nu('eroare', `${tabel}: ${s.eroare != null ? String(s.eroare) : 'eroare necunoscută'} — datele primite odată cu eroarea NU se folosesc`)
  // stare 'ok' ÎMPREUNĂ cu o eroare (loader inconsecvent, ex. {data:[], error} mapat pe ok) = eroare, nu „listă goală"
  if (s.eroare != null) return nu('eroare', `${tabel}: stare „${String(s.stare)}", dar a venit cu eroarea „${String(s.eroare)}" — datele NU se folosesc`)
  if (s.stare !== 'ok') return nu('forma_invalida', `${tabel}: stare necunoscută (${String(s.stare)})`)
  if (s.licitatie_id == null) return nu('forma_invalida', `${tabel}: sursa nu declară licitația pentru care a fost citită`)
  if (s.licitatie_id !== L) return nu('alta_licitatie', `${tabel}: citită pentru licitația ${s.licitatie_id}, nu pentru ${L} — ignorată`)
  if (FORMA[nume] === 'lista' && !Array.isArray(s.date)) return nu('forma_invalida', `${tabel}: se aștepta o listă de rânduri`)
  // rândurile care își declară licitația trebuie să fie ale lui L (eticheta sursei poate veni de la ecran, nu de la cerere).
  // echipa_blocaje se verifică rând cu rând la F9 (rândurile valide rămân, cele neatribuibile fac F9 indisponibil).
  if (FORMA[nume] === 'lista' && nume !== 'echipa_blocaje') {
    const straine = s.date.filter(r => esteObiect(r) && r.licitatie_id != null && r.licitatie_id !== L)
    if (straine.length) return nu('alta_licitatie', `${tabel}: ${plural(straine.length, 'rând e', 'rânduri sunt')} al${straine.length === 1 ? '' : 'e'} licitației ${[...new Set(straine.map(r => r.licitatie_id))].join(', ')}, nu ale lui ${L} — sursa se ignoră în întregime`)
  }
  if (FORMA[nume] === 'obiect') {
    if (s.date == null) return nu('forma_invalida', `${tabel}: niciun rând pentru licitația ${L} — un view fără rând NU înseamnă „fără blocaj"`)
    if (!esteObiect(s.date)) return nu('forma_invalida', `${tabel}: se aștepta un singur rând`)
    const rl = nume === 'licitatie' ? s.date.id : s.date.licitatie_id
    if (rl != null && rl !== L) return nu('alta_licitatie', `${tabel}: rândul e al licitației ${rl}, nu al lui ${L} — ignorat`)
  }
  // prospețime
  const t = s.citit_la ?? capturat_la
  const baza = { nume, obligatorie, tabel, prezenta: true, utilizabila: true, date: s.date }
  if (t == null) return { ...baza, calitate: 'expirat', motiv: 'fara_timestamp', detaliu: `${tabel}: nu știm când a fost citită (fără citit_la / capturat_la)`, citit_la: null }
  const ms = typeof t === 'string' ? Date.parse(t) : NaN
  if (!Number.isFinite(ms)) return { ...baza, calitate: 'expirat', motiv: 'timp_invalid', detaliu: `${tabel}: momentul citirii e invalid (${String(t)})`, citit_la: null }
  const iso = isoDin(ms)
  if (ms > acumMs + P.toleranta_viitor_ms) return { ...baza, calitate: 'expirat', motiv: 'timp_invalid', detaliu: `${tabel}: citită „în viitor" (${iso}) față de ceasul de evaluare`, citit_la: iso }
  const varsta = acumMs - ms
  if (varsta > P.expirat_ms) return { ...baza, calitate: 'expirat', motiv: 'expirat', detaliu: `${tabel}: citită acum ${formatDurata(varsta)} (peste pragul de ${formatDurata(P.expirat_ms)})`, citit_la: iso, varsta_ms: varsta }
  if (varsta > P.stale_ms) return { ...baza, calitate: 'stale', motiv: null, citit_la: iso, varsta_ms: varsta }
  return { ...baza, calitate: 'proaspat', motiv: null, citit_la: iso, varsta_ms: Math.max(0, varsta) }
}
export function formatDurata(ms) {
  const m = Math.round(ms / 60e3)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`
  return `${Math.floor(h / 24)} zile`
}

function analizeazaSurse(snapshot, L, acumMs, P) {
  const surse = esteObiect(snapshot.surse) ? snapshot.surse : {}
  const S = {}
  for (const n of [...SURSE_OBLIGATORII, ...SURSE_OPTIONALE]) S[n] = infoSursa(n, surse[n], L, snapshot.capturat_la ?? null, acumMs, P)
  return S
}

// ── validări de intrare comune (contract §1) ──
function verificaIntrarea(snapshot, opts) {
  const { acum, licitatieId, praguri = PRAGURI_IMPLICITE, licitatiiPermise = LICITATII_PERMISE_IMPLICIT } = opts || {}
  const acumMs = parseAcum(acum)
  if (!Number.isInteger(licitatieId)) throw new TypeError('licitatieId')
  const P = normPraguri(praguri)
  if (snapshot == null) return { gol: true }
  const acumIso = isoDin(acumMs)
  const permise = Array.isArray(licitatiiPermise) ? licitatiiPermise : []
  if (!permise.includes(licitatieId)) return { acumMs, acumIso, P, L: licitatieId, oprire: { motiv: 'licitatie_nepermisa',
    detaliu: `Prototipul evaluează doar licitațiile ${permise.join(', ') || '(niciuna)'} (clona de audit). Licitația ${licitatieId} nu se evaluează — nu înseamnă că e în regulă.` } }
  if (!esteObiect(snapshot) || !Number.isInteger(snapshot.licitatie_id)) return { acumMs, acumIso, P, L: licitatieId, oprire: { motiv: 'snapshot_invalid',
    detaliu: 'Snapshotul nu are forma așteptată (lipsește licitatie_id întreg) — nu putem evalua nimic.' } }
  if (snapshot.licitatie_id !== licitatieId) return { acumMs, acumIso, P, L: licitatieId, oprire: { motiv: 'alta_licitatie',
    detaliu: `Datele primite sunt ale licitației ${snapshot.licitatie_id}, dar pe ecran e selectată ${licitatieId} (răspuns întârziat / cursă de încărcare). Conținutul se ignoră în întregime.` } }
  return { acumMs, acumIso, P, L: licitatieId }
}

// ════════════════════════════════════════════════════════════════
// MODELUL — derivările pe cerință / capitol (contract §4), din sursele UTILIZABILE
// ════════════════════════════════════════════════════════════════
function construiesteModel(S, L) {
  const ut = n => (S[n]?.utilizabila ? S[n].date : null)
  const M = { L, int02: [], int04: [], int01: [] }
  M.capitole = ut('capitole')
  M.capById = new Map((M.capitole || []).map(k => [k.id, k]))
  M.cerinte = ut('cerinte')
  M.cerById = new Map((M.cerinte || []).map(c => [c.id, c]))
  M.activa = c => c.inlocuita_de == null && c.duplicat_al == null
  M.C_act = (M.cerinte || []).filter(M.activa)
  M.U_PT = M.C_act.filter(c => c.tip === 'propunere' || c.tip === 'forma')
  M.uptIds = new Set(M.U_PT.map(c => c.id))
  M.legaturi = ut('legaturi')
  M.acoperire = ut('acoperire')
  M.ptDovezi = ut('pt_dovezi')

  // legăturile brute pe cerință + filtrul Lg (capitole ale lui L, existente)
  M.lgBrute = new Map(); M.lg = new Map()
  if (M.legaturi && M.capitole && M.cerinte) {
    for (const l of M.legaturi) {
      if (!M.cerById.has(l.cerinta_id)) { M.int02.push({ legatura_id: l.id, motiv: `legătura #${l.id} indică cerința ${l.cerinta_id}, care nu e în cerințele licitației ${L}` }); continue }
      if (!M.lgBrute.has(l.cerinta_id)) M.lgBrute.set(l.cerinta_id, [])
      M.lgBrute.get(l.cerinta_id).push(l)
      if (l.fel === 'capitol') {
        const alta = l.capitol_licitatie_id !== undefined && l.capitol_licitatie_id !== L
        if (alta || !M.capById.has(l.capitol_id)) {
          M.int02.push({ cerinta_id: l.cerinta_id, legatura_id: l.id, capitol_id: l.capitol_id,
            motiv: alta ? `legătura #${l.id} indică un capitol al licitației ${l.capitol_licitatie_id} — ignorată` : `legătura #${l.id} indică capitolul ${l.capitol_id}, inexistent în cuprinsul licitației ${L} — ignorată` })
          continue
        }
      }
      if (!M.lg.has(l.cerinta_id)) M.lg.set(l.cerinta_id, [])
      M.lg.get(l.cerinta_id).push(l)
    }
  }
  M.Lg = c => M.lg.get(c.id) || []
  M.LgBrute = c => M.lgBrute.get(c.id) || []

  // acoperirea pe cerință
  M.ac = new Map()
  if (M.acoperire && M.cerinte) {
    for (const a of M.acoperire) {
      if (!M.cerById.has(a.cerinta_id)) { M.int02.push({ acoperire_id: a.id, motiv: `acoperirea #${a.id} indică cerința ${a.cerinta_id}, care nu e a licitației ${L} — ignorată` }); continue }
      if (a.verificat_pe_scan != null && typeof a.verificat_pe_scan !== 'boolean')
        M.int04.push({ cerinta_id: a.cerinta_id, acoperire_id: a.id, motiv: `acoperire #${a.id}: verificat_pe_scan = ${JSON.stringify(a.verificat_pe_scan)} (nu e boolean) — tratat ca NEVERIFICAT` })
      // coloană ABSENTĂ (citire fără câmp) ≠ NULL: pe o acoperire favorabilă nu știm dacă s-a cerut reverificare / ce document e referit
      if (favorabila(a)) for (const k of ['reverificare_ceruta', 'doc_firma_id']) if (!(k in a))
        M.int04.push({ cerinta_id: a.cerinta_id, acoperire_id: a.id, motiv: `acoperire #${a.id}: câmpul ${k} lipsește din citire — tratat ca în SQL (NULL), dar nu știm dacă e NULL sau necitit` })
      if (a.reverificare_ceruta != null && typeof a.reverificare_ceruta !== 'boolean')
        M.int04.push({ cerinta_id: a.cerinta_id, acoperire_id: a.id, motiv: `acoperire #${a.id}: reverificare_ceruta = ${JSON.stringify(a.reverificare_ceruta)} (nu e boolean) — tratat ca „reverificare cerută"` })
      if (typeof a.dovada_r06 === 'boolean' && a.dovada_r06 !== doveditaR06(a))
        M.int01.push({ blocant: true, cerinta_id: a.cerinta_id, acoperire_id: a.id, surse: ['acoperire'],
          motiv: `acoperire #${a.id}: dovada_r06 (server) = ${a.dovada_r06}, recalcul R06 = ${doveditaR06(a)} — se ia varianta mai puțin verde` })
      if (!M.ac.has(a.cerinta_id)) M.ac.set(a.cerinta_id, [])
      M.ac.get(a.cerinta_id).push(a)
    }
    for (const [cid, lst] of M.ac) {
      if (lst.some(a => a.status === 'nu_se_aplica') && lst.some(favorabila))
        M.int04.push({ cerinta_id: cid, motiv: `cerința ${M.cerById.get(cid)?.nr_ordine ?? cid}: acoperiri contradictorii pe aceeași cerință („nu_se_aplica" și favorabilă)` })
    }
  }
  M.Ac = c => M.ac.get(c.id) || []
  const dovR06 = a => doveditaR06(a) && (typeof a.dovada_r06 === 'boolean' ? a.dovada_r06 : true)

  // flag efectiv = recalcul ȘI server_cer (varianta mai puțin verde); divergențele → INT01
  const efectiv = (c, flag, rec, surse) => {
    const sc = c.server_cer
    if (!esteObiect(sc) || rec == null) return rec
    const v = sc[flag]
    if (typeof v !== 'boolean') { M.int04.push({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv: `server_cer.${flag} lipsește sau nu e boolean — se folosește recalculul` }); return rec }
    if (v !== rec) M.int01.push({ blocant: true, cerinta_id: c.id, nr_ordine: c.nr_ordine, surse,
      motiv: `cerința #${c.nr_ordine}: ${flag} server = ${v}, recalcul = ${rec} — se ia varianta mai puțin verde (${rec && v})` })
    return rec && v
  }
  M.cap = id => M.capById.get(id)
  M.legVerificata = l => {
    const k = M.cap(l.capitol_id)
    return l.fel === 'capitol' && l.stare === 'verificata' && Number.isInteger(l.verificat_la_versiunea) && Number.isInteger(k?.versiune)
      && l.verificat_la_versiunea === k.versiune && areActor(l.confirmat_de) && l.confirmat_la != null
  }
  M.stareDerivata = new Map()   // cerinta_id → flaguri PT
  const areLeg = !!(M.legaturi && M.capitole && M.cerinte)
  for (const c of M.U_PT) {
    const lg = M.Lg(c), lgB = M.LgBrute(c)
    const f = {}
    if (areLeg) {
      const pl = ['cerinte', 'legaturi', 'capitole']
      for (const l of lgB) if (l.stare === 'verificata' && (!Number.isInteger(l.verificat_la_versiunea) || !areActor(l.confirmat_de) || l.confirmat_la == null))
        M.int04.push({ cerinta_id: c.id, nr_ordine: c.nr_ordine, legatura_id: l.id, motiv: `legătura #${l.id} are stare 'verificata' fără versiune / confirmat_de (NULL sau gol) / confirmat_la — tratată ca NEVERIFICATĂ` })
      f.are_capitol = efectiv(c, 'are_capitol', lg.some(l => l.fel === 'capitol'), pl)
      f.exceptata = efectiv(c, 'exceptata', lg.some(l => l.fel === 'exceptat'), pl)
      f.blocata = lgB.some(l => l.stare === 'blocata')
      f.verificata = efectiv(c, 'verificata', lg.some(M.legVerificata) && !f.blocata, pl)
      const capL = lg.filter(l => l.fel === 'capitol').map(l => M.cap(l.capitol_id)).filter(Boolean)
      const uniq = [...new Map(capL.map(k => [k.id, k])).values()].sort(cmpCapitol)
      f.principal = uniq[0] || null
      f.alte_capitole = uniq.slice(1).map(k => k.id)
      f.versiune_veche = lg.some(l => l.fel === 'capitol' && l.stare === 'verificata' && Number.isInteger(l.verificat_la_versiunea)
        && Number.isInteger(M.cap(l.capitol_id)?.versiune) && l.verificat_la_versiunea !== M.cap(l.capitol_id).versiune)
    }
    // capcana: server ∨ recalcul (pe text integral); niciuna → null (necunoscut)
    const rec = typeof c.text_cerinta === 'string' && !e_trunchiat(c.text_cerinta) ? REGEX_CAPCANA.test(c.text_cerinta) : null
    const srv = esteObiect(c.server_cer) && typeof c.server_cer.capcana === 'boolean' ? c.server_cer.capcana : null
    if (rec != null && srv != null && rec !== srv) M.int01.push({ blocant: true, cerinta_id: c.id, nr_ordine: c.nr_ordine, surse: ['cerinte'],
      motiv: `cerința #${c.nr_ordine}: capcana server = ${srv}, regex local = ${rec} — se ia varianta mai puțin verde (capcană)` })
    f.capcana = rec == null && srv == null ? null : (rec === true || srv === true)
    if (M.acoperire && M.cerinte) {
      const pa = ['cerinte', 'acoperire']
      f.dovedita = efectiv(c, 'dovedita', M.Ac(c).some(dovR06), pa)
      f.propusa = efectiv(c, 'propusa', M.Ac(c).some(favorabila), pa)
    }
    M.stareDerivata.set(c.id, f)
  }
  // dovedita pentru toate cerințele active (universul depunerii)
  M.dovedita = c => {
    const f = M.stareDerivata.get(c.id)
    if (f && typeof f.dovedita === 'boolean') return f.dovedita
    return M.Ac(c).some(dovR06)
  }
  M.propusa = c => {
    const f = M.stareDerivata.get(c.id)
    if (f && typeof f.propusa === 'boolean') return f.propusa
    return M.Ac(c).some(favorabila)
  }
  M.acoperitaDep = c => M.Ac(c).some(a => a.status === 'nu_se_aplica') || M.dovedita(c)
  // dovada R06 are și AUTOR: formula serverului nu cere verificat_de, dar „verificat pe scan de om" fără om nu e dovadă umană
  M.dovedataCuAutor = c => M.Ac(c).some(a => dovR06(a) && areActor(a.verificat_de))
  // capitolul principal al oricărei cerințe active (pentru grupare)
  M.principal = c => {
    const f = M.stareDerivata.get(c.id)
    if (f && 'principal' in f) return f.principal
    if (!areLeg) return undefined
    const capL = M.Lg(c).filter(l => l.fel === 'capitol').map(l => M.cap(l.capitol_id)).filter(Boolean).sort(cmpCapitol)
    return capL[0] || null
  }
  // candidați de citat (sursa opțională) — validați strict (§5.8)
  M.candidati = new Map()   // cerinta_id → { valizi:[], invalizi:[] }
  const cand = S.candidati_citat?.utilizabila ? S.candidati_citat.date : null
  if (cand && M.cerinte && M.capitole && M.legaturi) {
    for (const x of cand) {
      const c = M.cerById.get(x?.cerinta_id)
      const inv = cauza => {
        M.int02.push({ cerinta_id: x?.cerinta_id, legatura_id: x?.legatura_id, capitol_id: x?.capitol_id, motiv: `candidat de citat #${x?.id} invalid (${cauza}) — ignorat la clasare` })
        if (c) { if (!M.candidati.has(c.id)) M.candidati.set(c.id, { valizi: [], invalizi: [] }); M.candidati.get(c.id).invalizi.push({ id: x.id, cauza }) }
      }
      if (!c || !M.activa(c)) { inv(c ? 'cerinta_inactiva' : 'cerinta_necunoscuta'); continue }
      const l = M.Lg(c).find(y => y.id === x.legatura_id)
      if (!l) { inv('legatura'); continue }
      if (l.fel !== 'capitol' || l.capitol_id !== x.capitol_id) { inv('alt_capitol'); continue }
      const k = M.cap(x.capitol_id)
      if (x.capitol_versiune !== k.versiune) { inv('versiune'); continue }
      if (x.hash_text == null) { inv('fara_hash'); continue }
      if (x.hash_text !== k.continut_md5) { inv('hash'); continue }
      if (x.cerinta_versiune != null && x.cerinta_versiune !== c.versiune) { inv('versiune_cerinta'); continue }
      if (x.hash_cerinta != null && x.hash_cerinta !== c.text_md5) { inv('hash_cerinta'); continue }
      if (!M.candidati.has(c.id)) M.candidati.set(c.id, { valizi: [], invalizi: [] })
      M.candidati.get(c.id).valizi.push(x)
    }
  }
  return M
}

// Afișarea candidatului: fără scor în ordonare; scorul doar informativ
const candidatAfisare = x => ({ id: x.id, propunere_ai: x.propunere_ai, citat: x.citat, locator: x.locator, citat_gasit_exact: x.citat_gasit_exact === true,
  capitol_versiune: x.capitol_versiune, hash_text: x.hash_text, parser_version: x.parser_version ?? null })
const problematic = x => ['PARTIAL', 'CONFLICT', 'UNDETERMINED'].includes(x.propunere_ai) || x.citat_gasit_exact !== true || !['MATCH', 'PARTIAL', 'CONFLICT', 'UNDETERMINED'].includes(x.propunere_ai)
const motivCandidat = x => x.propunere_ai === 'CONFLICT' ? 'citat_contradictoriu' : x.propunere_ai === 'PARTIAL' ? 'citat_partial'
  : x.propunere_ai === 'UNDETERMINED' ? 'citat_nedeterminat' : x.citat_gasit_exact !== true ? 'citat_negasit_exact' : 'citat_propunere_necunoscuta'

// ════════════════════════════════════════════════════════════════
// Regulile → sursele lor (pentru reguli_afectate și calitatea datelor)
// ════════════════════════════════════════════════════════════════
const R_PT = ['cerinte', 'legaturi', 'capitole']
const R_DEP = ['cerinte', 'acoperire']
const R_DEP_GRUP = ['cerinte', 'acoperire', 'legaturi', 'capitole']
export const SURSE_REGULI = Object.freeze({
  PT00: R_PT, PT01: [...R_PT, 'acoperire'], PT02: R_PT, PT03: R_PT, PT04: R_PT, PT05: R_PT, PT06: R_PT, PT07: [...R_PT, 'candidati_citat'],
  E2_01: ['cerinte', 'e2_neconfirmate'], E2_BLOC: ['cerinte', 'e2_neconfirmate'],
  R06_REVERIF: R_DEP, R06_ELIM_PROPUSA: R_DEP, R06_ELIM_FARA: R_DEP, R06_ELIM_NEDET: R_DEP, R06_PROPUSA: R_DEP_GRUP,
  R06_ELIM_AI_NA: R_DEP, R06_AI_NA: R_DEP_GRUP, R06_FARA_AUTOR: R_DEP, DEP00: ['cerinte'], DEP01: R_DEP,
  DEP_ROSII: ['licitatie', 'cerinte', 'acoperire', 'documente_firma_valabilitate'],
  CAP00: ['capitole'], CAP01: ['capitole'], CAP02: ['capitole'], CAP03: ['capitole'], INT03: ['capitole'],
  DOC01: ['documente'], DOC02: ['documente'], DOC03: ['seap_completitudine'], R5: ['r5'], F9: ['echipa_blocaje'],
  CTRL: ['pt_stare'], 'CTRL.cantitati': ['pt_stare', 'cantitati_nevalidate'],
  INT01: ['pt_stare'],
})
// Ce clase de excepție POATE produce fiecare regulă — ca ecranul să spună „0 evaluate + N reguli neevaluate" pe clasa afectată,
// nu un 0 simplu, când o sursă lipsește.
const CTRL_CLASE = ['BLOCK', 'WARN']
export const CLASE_REGULI = Object.freeze({
  PT00: ['HUMAN_DECISION'], PT01: ['BLOCK'], PT02: ['CONFIRM'], PT03: ['HUMAN_DECISION'], PT04: ['HUMAN_DECISION'], PT05: ['BLOCK'], PT06: ['HUMAN_DECISION'], PT07: ['HUMAN_DECISION'],
  E2_01: ['CONFIRM'], E2_BLOC: ['CONFIRM'],
  R06_REVERIF: ['BLOCK'], R06_ELIM_PROPUSA: ['BLOCK'], R06_ELIM_FARA: ['BLOCK'], R06_ELIM_NEDET: ['HUMAN_DECISION'], R06_PROPUSA: ['CONFIRM'],
  R06_ELIM_AI_NA: ['HUMAN_DECISION'], R06_AI_NA: ['CONFIRM'], R06_FARA_AUTOR: ['CONFIRM'], DEP00: ['BLOCK'], DEP01: ['BLOCK'], DEP_ROSII: ['BLOCK'],
  CAP00: ['BLOCK'], CAP01: ['BLOCK'], CAP02: ['CONFIRM'], CAP03: ['WARN'], INT03: ['WARN'],
  DOC01: ['BLOCK'], DOC02: ['WARN'], DOC03: ['BLOCK'], R5: ['BLOCK'], F9: ['BLOCK'], INT01: ['BLOCK', 'WARN'],
  'CTRL.nu_e_cazul': CTRL_CLASE, 'CTRL.conformitate': CTRL_CLASE, 'CTRL.observatii': CTRL_CLASE, 'CTRL.grafic': CTRL_CLASE, 'CTRL.cantitati': CTRL_CLASE,
  'CTRL.garantie': CTRL_CLASE, 'CTRL.anexe': CTRL_CLASE, 'CTRL.identitate': ['BLOCK', 'HUMAN_DECISION'], 'CTRL.numere': CTRL_CLASE, 'CTRL.participare': CTRL_CLASE,
  'CTRL.pachet': CTRL_CLASE, 'CTRL.grafic_sursa': CTRL_CLASE, 'CTRL.grafic_relatii': CTRL_CLASE,
})

// Controalele preluate din evalueazaPoarta (§5.6)
const CTRL_MAPATE = ['nu_e_cazul', 'conformitate', 'observatii', 'grafic', 'cantitati', 'garantie', 'anexe', 'identitate', 'numere',
  'participare', 'pachet', 'grafic_sursa', 'grafic_relatii']
// „ok prin absență": regula întoarce ok pentru că obiectul verificat NU EXISTĂ încă → WARN „neevaluat", nu verde.
// `numere` (H6) e adăugat față de contract §5.6: pe 103 dă „278 … același număr peste tot" deși cerințele n-au niciun
// număr (bransamente_in_cerinte = null) — nimic de comparat (AS-IS, capcana 11). Regula tare „lipsa informației ≠ verde" bate §11.
const OK_PRIN_ABSENTA = {
  pachet: st => !st.pachet_stare || !(Array.isArray(st.pachet_fisiere) && st.pachet_fisiere.length),
  grafic_sursa: st => !(Array.isArray(st.pachet_fisiere) && st.pachet_fisiere.length),
  numere: st => !(Array.isArray(st.bransamente_in_cerinte) && st.bransamente_in_cerinte.length),
}
const CTRL_ACTIUNE = {
  nu_e_cazul: ['deschide_capitol', 'Caută „nu este cazul" în capitole și compară cu fișa de date', 'propunere'],
  conformitate: ['deschide_conformitate', 'Deschide conformitatea (afirmațiile propunerii vs ERP)', 'propunere'],
  observatii: ['deschide_observatii', 'Deschide observațiile deschise', 'propunere'],
  grafic: ['deschide_grafic', 'Deschide Graficul', 'grafic'],
  cantitati: ['deschide_cantitati', 'Deschide Cantități (lista F3 vs fronturi)', 'cantitati'],
  garantie: ['deschide_garantie', 'Deschide Garanția (luni + moment de start)', 'propunere'],
  anexe: ['deschide_capitol', 'Deschide capitolele cu trimiterile semnalate', 'propunere'],
  identitate: ['deschide_capitol', 'Citește fiecare nume străin în context și decide', 'propunere'],
  numere: ['deschide_capitol', 'Compară numărul de branșamente din capitole cu documentația', 'propunere'],
  participare: ['deschide_participanti', 'Deschide Participanți / declarații', 'propunere'],
  pachet: ['deschide_participanti', 'Deschide Participanți / anexe (piesele așteptate în pachet)', 'propunere'],
  grafic_sursa: ['deschide_grafic', 'Deschide Graficul (versiunea înghețată)', 'grafic'],
  grafic_relatii: ['deschide_grafic', 'Deschide Graficul (relațiile declarate)', 'grafic'],
}
// Forma câmpurilor din v_ofertare_pt_stare pe care le citește fiecare control (§5.6). Evaluatorul (ofertarePoarta.js /
// ofertareControale.js) face `|| 0` și `|| []`: un câmp ABSENT (view în altă versiune) sau NULL pe un contor ar ieși „0 ⇒ în regulă".
//   int   = întreg ≥ 0, obligatoriu (contoarele sunt count(*) în SQL: NULL = rând invalid)
//   lista = listă sau NULL, câmpul trebuie să existe; NULL = NECUNOSCUT (array_agg fără rânduri dă tot NULL — nu putem deosebi
//           „nimic găsit" de „necalculat"), deci controlul nu iese verde pe el: rămâne „neevaluat"
//   val   = orice valoare (NULL inclus, evaluatorul îl tratează ca „lipsește obiectul" → warn / block), dar câmpul trebuie să existe
const TIP_CAMP = { int: v => Number.isInteger(v) && v >= 0, lista: v => v === null || Array.isArray(v), val: () => true }
const DESCRIERE_TIP = { int: 'întreg ≥ 0', lista: 'listă sau NULL', val: 'câmp prezent' }
const CAMPURI_CTRL = {
  nu_e_cazul: { int: ['capitole_nu_e_cazul'] },
  conformitate: { int: ['afirmatii', 'afirmatii_blocante', 'afirmatii_de_verificat'] },
  observatii: { int: ['observatii_deschise'] },
  grafic: { int: ['grafic_avertismente'], val: ['grafic_versiune'] },
  cantitati: { val: ['lista_f3_m', 'lista_c6_m', 'memoriu_m', 'plansa_m', 'grafic_fronturi_m'] },
  garantie: { int: ['garantie_cerinte_lucrari'], lista: ['garantie_luni_in_capitole'],
    val: ['garantie_cerut_luni', 'garantie_cerut_moment', 'garantie_oferit_luni', 'garantie_oferit_moment', 'garantie_confirmata', 'garantie_justificata'] },
  anexe: { lista: ['anexe_referite', 'anexe_existente', 'fraze_anexe', 'capitole_ref'] },
  identitate: { lista: ['identitate_straine'] },
  numere: { lista: ['bransamente_in_capitole', 'bransamente_in_cerinte'] },
  participare: { lista: ['participanti', 'participanti_acte', 'fraze_asociere', 'declaratii_participare'] },
  pachet: { lista: ['anexe_asteptate', 'anexe_declarate', 'pachet_fisiere'], val: ['pachet_stare', 'anexe_responsabili'] },
  grafic_sursa: { lista: ['pachet_fisiere'], val: ['grafic_versiune', 'grafic_versiune_mod'] },
  grafic_relatii: { lista: ['grafic_activitati_declarate'], val: ['grafic_versiune', 'grafic_versiune_mod'] },
}
// Contoarele din v_ofertare_cantitati_nevalidate pe care campuriCantitatiNevalidate le completează cu 0 când sunt NULL / absente
const CAMPURI_CANTITATI = [...CONTOARE_BLOCANTE_CANTITATI, 'transfer_conflicte_docs', 'transfer_in_curs', 'unitati_de_verificat', 'fara_tip_nevalidate',
  'um_de_normalizat', 'retea_alte_unitati', 'sterse_dupa_validare', 'lista_c6_nevalidate', 'memoriu_nevalidate', 'plansa_nevalidate', 'retea_validate_fara_cant']
function campuriInvalide(rand, spec) {
  const rau = []
  for (const [tip, campuri] of Object.entries(spec)) for (const k of campuri) {
    if (!(k in rand)) rau.push(`${k} (lipsește)`)
    else if (!TIP_CAMP[tip](rand[k])) rau.push(`${k} = ${JSON.stringify(rand[k])} (se aștepta ${DESCRIERE_TIP[tip]})`)
  }
  return rau
}
// cheile evaluatorului re-derivate aici; comparate DOAR ca gardă listă ↔ poartă (dacă sursele există)
// `sari`: dacă oricare dintre aceste reguli e „control indisponibil", garda nu se aplică (nu numărăm aceeași problemă de două ori)
const GARDA_EXCLUSE = {
  neconfirmate: { reguli: ['E2_01'], surse: ['cerinte', 'e2_neconfirmate'], sari: ['E2_01'] },
  documentatie: { reguli: ['DOC03'], surse: ['seap_completitudine'], sari: ['DOC03'] },
  sursa_cantitati: { reguli: ['R5'], surse: ['r5', 'cantitati_nevalidate'], sari: ['R5', 'CTRL.cantitati'] },
}
// perechile verificate încrucișat cu v_ofertare_pt_stare (INT01)
const PERECHI = [
  ['de_raspuns', R_PT, false], ['fara_capitol', [...R_PT, 'acoperire'], true], ['dovada_de_verificat', [...R_PT, 'acoperire'], false],
  ['cerinte_neverificate', R_PT, true], ['capcane_descoperite', R_PT, true], ['exceptate', R_PT, false],
  ['inchise_cu_dovada', [...R_PT, 'acoperire'], false], ['capitole', ['capitole'], 'zero'], ['capitole_goale', ['capitole'], true],
  ['capitole_nescrise_de_om', ['capitole'], true], ['documente', ['documente'], 'zero'], ['documente_necitite', ['documente'], false],
]

// ════════════════════════════════════════════════════════════════
// construiesteAtentia — contract §1–§9
// ════════════════════════════════════════════════════════════════
export function construiesteAtentia(snapshot, opts = {}) {
  const v = verificaIntrarea(snapshot, opts)
  if (v.gol) return null
  const { acumMs, acumIso, P, L } = v
  if (v.oprire) {
    const ind = [{ id: `SNAP:${v.oprire.motiv}`, sursa: 'snapshot', motiv: v.oprire.motiv, detaliu: v.oprire.detaliu, reguli_afectate: ['*'],
      blocheaza_final: true, actiune_umana: actiune('recitire', 'Recitește licitația selectată', { licitatie_id: L }) }]
    return curata({ verdict: construiesteVerdict({ exceptii: [], ok: [], indisponibile: ind, L, acumIso, P, toateOk: false, dateCapturate: null,
      listaConstruita: false, motivLista: v.oprire.detaliu }), exceptii: [], ok: [], indisponibile: ind })
  }

  const S = analizeazaSurse(snapshot, L, acumMs, P)
  const M = construiesteModel(S, L)
  const exceptii = [], ok = []
  const afectate = new Map()   // sursa → Set(reguli)
  const indispControl = []     // controale invalide (sursele sunt ok, dar valoarea nu)
  const marcheaza = (sursa, regula) => { if (!afectate.has(sursa)) afectate.set(sursa, new Set()); afectate.get(sursa).add(regula) }

  // Poarta unei reguli: toate sursele utilizabile? calitatea cea mai slabă + citit_la minim
  const poarta = (regula, surse) => {
    const lipsa = surse.filter(n => !(S[n]?.utilizabila))
    const optAbs = lipsa.filter(n => SURSE_OPTIONALE.includes(n) && !S[n]?.prezenta)
    if (optAbs.length) return null                        // sursă opțională absentă: regula nu există încă, fără zgomot
    if (lipsa.length) { lipsa.forEach(n => marcheaza(n, regula)); return null }
    let cal = 'proaspat', cit = null
    for (const n of surse) {
      const s = S[n]
      if (RANG_CALITATE[s.calitate] > RANG_CALITATE[cal]) cal = s.calitate
      if (s.calitate === 'expirat') marcheaza(n, regula)
      if (s.citit_la && (cit == null || s.citit_la < cit)) cit = s.citit_la
    }
    return { calitate: cal, citit_la: cit ?? acumIso, surse }
  }
  // aceeași poartă, fără să marcheze o regulă (pentru blocuri care își marchează regulile individual)
  const poartaTacuta = surse => {
    if (surse.some(n => !(S[n]?.utilizabila))) return null
    let cal = 'proaspat', cit = null
    for (const n of surse) { const s = S[n]; if (RANG_CALITATE[s.calitate] > RANG_CALITATE[cal]) cal = s.calitate; if (s.citit_la && (cit == null || s.citit_la < cit)) cit = s.citit_la }
    return { calitate: cal, citit_la: cit ?? acumIso, surse }
  }
  const emite = (e, q) => {
    const el = e.elemente
    const x = { ...e, tinta: { licitatie_id: L, ...(e.tinta || {}) }, provenienta: { ...(e.provenienta || {}), citit_la: q.citit_la } }
    if (el) { x.elemente = [...el].sort(cmpElement); x.numar = el.length }
    if (q.calitate === 'stale') x.stale = true
    if (q.calitate === 'expirat') x.din_date_expirate = true
    exceptii.push(x)
  }
  const emiteOk = (r, q) => {
    if (q.calitate === 'expirat') return                   // din date expirate nu iese niciodată verde
    ok.push({ ...r, provenienta: { ...r.provenienta, citit_la: q.citit_la }, ...(q.calitate === 'stale' ? { stale: true } : {}) })
  }
  const capT = k => ({ id: k.id, nr: k.nr, titlu: k.titlu, versiune: k.versiune })
  const nrC = c => (c?.nr_ordine != null ? `#${c.nr_ordine}` : `id ${c?.id}`)

  // ── 5.1 Legături PT ────────────────────────────────────────────────────────────────────────
  const partitie = { PT02: new Map(), PT03: new Map(), PT04: new Map(), PT07: new Map() }
  const N = [], F = [], D = [], capNull = [], pt06 = [], okVerif = [], okExcOm = []
  const qPT01 = poarta('PT01', SURSE_REGULI.PT01)
  const qPT05 = poarta('PT05', SURSE_REGULI.PT05)
  ;['PT03', 'PT04', 'PT06'].forEach(r => poarta(r, SURSE_REGULI[r]))   // marchează regulile, dacă sursele lipsesc
  const qPT0x = poarta('PT02', SURSE_REGULI.PT02)
  const qPT07 = poarta('PT07', SURSE_REGULI.PT07)
  if (qPT0x) {
    for (const c of M.U_PT) {
      const f = M.stareDerivata.get(c.id)
      const lg = M.Lg(c)
      if (f.are_capitol && !f.verificata) N.push(c)
      if (f.are_capitol && f.verificata) okVerif.push(c)
      if (!f.are_capitol && !f.exceptata) {
        if (f.capcana === true) D.push(c)
        if (f.capcana === null) capNull.push(c)
      }
      if (f.exceptata && !f.are_capitol) {
        if (lg.some(l => l.fel === 'exceptat' && l.sursa === 'om')) okExcOm.push(c)
        else pt06.push(c)
      }
      if (qPT01 && !f.are_capitol && !f.exceptata && !f.dovedita && !f.propusa) F.push(c)
    }
  }
  // Partiția lui N: PT03 (blocată) → PT04 (capcană / necunoscută) → PT07 (candidat problematic) → PT02 (rest)
  const elementPT = (c, extra = {}) => {
    const f = M.stareDerivata.get(c.id), k = f.principal
    const lp = M.Lg(c).find(l => l.fel === 'capitol' && l.capitol_id === k?.id) || null
    const toateLeg = M.Lg(c).map(l => l.id)
    const dovezi = M.ptDovezi && S.pt_dovezi.utilizabila ? M.ptDovezi.filter(d => toateLeg.includes(d.legatura_id)).length : null
    const cand = M.candidati.get(c.id)
    return {
      cerinta_id: c.id, nr_ordine: c.nr_ordine, legatura_id: lp?.id ?? null, capitol_id: k?.id ?? null,
      sursa: lp?.sursa ?? 'necunoscuta', ...(f.alte_capitole?.length ? { alte_capitole: f.alte_capitole } : {}),
      detalii: { verificat_la_versiunea: lp?.verificat_la_versiunea ?? null, capitol_versiune: k?.versiune ?? null, dovezi_atasate: dovezi,
        ...(cand?.invalizi?.length ? { candidat_invalid: cand.invalizi.map(x => x.cauza) } : {}) },
      actiune: actiune('deschide_capitol', `Cerința ${nrC(c)} în cap. ${k?.nr ?? '?'}`, { licitatie_id: L, capitol_id: k?.id ?? null, cerinta_id: c.id }),
      ...extra,
    }
  }
  const adaugaPart = (regula, c, el) => {
    const k = M.stareDerivata.get(c.id).principal
    const m = partitie[regula]
    if (!m.has(k.id)) m.set(k.id, { k, el: [] })
    m.get(k.id).el.push(el)
  }
  if (qPT0x) {
    for (const c of N) {
      const f = M.stareDerivata.get(c.id)
      const bl = M.LgBrute(c).find(l => l.stare === 'blocata')
      if (bl) { adaugaPart('PT03', c, elementPT(c, { motiv: 'legatura_blocata', detalii: { ...elementPT(c).detalii, constatare: bl.constatare ?? null, severitate: bl.severitate ?? null, legatura_blocata_id: bl.id } })); continue }
      if (f.capcana !== false) { adaugaPart('PT04', c, elementPT(c, { motiv: f.capcana === true ? 'capcana' : 'capcana_necunoscuta' })); continue }
      const cand = M.candidati.get(c.id)
      const prob = qPT07 && cand ? [...cand.valizi].sort((a, b) => cmpStr(a.id, b.id)).find(problematic) : null
      if (prob) { adaugaPart('PT07', c, elementPT(c, { motiv: motivCandidat(prob), candidat: candidatAfisare(prob) })); continue }
      const match = cand?.valizi?.filter(x => !problematic(x)).sort((a, b) => cmpStr(a.id, b.id))[0]
      const motivLeg = f.versiune_veche ? 'versiune_veche' : 'neverificata'
      const motiv = cand?.invalizi?.length && !match ? `candidat_invalid:${cand.invalizi[0].cauza}` : motivLeg
      adaugaPart('PT02', c, elementPT(c, { motiv, ...(match ? { candidat: candidatAfisare(match) } : {}) }))
    }
  }
  const DEF_PART = {
    PT02: { clasa: 'CONFIRM', titlu: (k, n) => `Cap. ${k.nr} «${k.titlu}» (v${k.versiune}): ${plural(n, 'cerință atribuită, neverificată', 'cerințe atribuite, neverificate')} de om`,
      et: k => `Deschide cap. ${k.nr} și examinează fiecare cerință lângă text` },
    PT03: { clasa: 'HUMAN_DECISION', titlu: (k, n) => `Cap. ${k.nr} «${k.titlu}»: ${plural(n, 'cerință cu legătură blocată', 'cerințe cu legătură blocată')} (R09)`,
      et: k => `Deschide cap. ${k.nr} și citește constatarea blocării` },
    PT04: { clasa: 'HUMAN_DECISION', titlu: (k, n) => `Cap. ${k.nr} «${k.titlu}»: ${plural(n, 'capcană de respingere atribuită, neverificată', 'capcane de respingere atribuite, neverificate')}`,
      et: k => `Deschide cap. ${k.nr} și decide pe fiecare capcană` },
    PT07: { clasa: 'HUMAN_DECISION', titlu: (k, n) => `Cap. ${k.nr} «${k.titlu}»: ${plural(n, 'citat candidat problematic', 'citate candidate problematice')}`,
      et: k => `Deschide cap. ${k.nr} și judecă fiecare citat` },
  }
  for (const regula of ['PT02', 'PT03', 'PT04', 'PT07']) {
    const q = regula === 'PT07' ? qPT07 : qPT0x
    if (!q) continue
    for (const { k, el } of partitie[regula].values()) {
      const cnt = { ai: 0, om: 0, necunoscuta: 0 }
      for (const e of el) cnt[e.sursa === 'ai' ? 'ai' : e.sursa === 'om' ? 'om' : 'necunoscuta']++
      const tipuri = Object.entries(cnt).filter(([, n]) => n > 0).map(([t]) => t)
      const vv = el.filter(e => e.motiv === 'versiune_veche').length
      const d = DEF_PART[regula]
      emite({
        id: `${regula}:cap:${k.id}`, regula, clasa: d.clasa, blocheaza_final: true, porti: ['pt'], domeniu: 'pt', aspect: 'raspuns_pt',
        titlu: d.titlu(k, el.length),
        cauza: regula === 'PT02'
          ? `${plural(el.length, 'legătură', 'legături')} ofertare_pt_legaturi fel='capitol' spre acest capitol nu ${el.length === 1 ? 'e verificată' : 'sunt verificate'} de un om la versiunea curentă v${k.versiune} (${cnt.ai} atribuite de AI, ${cnt.om} de om${cnt.necunoscuta ? `, ${cnt.necunoscuta} cu sursă necunoscută` : ''}${vv ? `; ${vv} verificate la o versiune veche` : ''}). Atribuirea nu e verificare: serverul le numără în cerinte_neverificate, iar rândul „neverificate" al porții blochează. Verificarea e a unui om, cerință cu cerință — nu există acțiune pe grup.`
          : regula === 'PT03' ? `R09: cel puțin o legătură a cerinței are stare='blocata' — cerința nu e verificată chiar dacă altă legătură e bifată. Decizia (deblocare cu motiv sau schimbarea textului) e a omului.`
          : regula === 'PT04' ? `Cerința conține o clauză de respingere (regex-ul REGEX_CAPCANA din v_ofertare_pt_stare, pe textul integral) sau nu putem ști (text trunchiat, fără server_cer). Are capitol atribuit, dar nimeni n-a verificat răspunsul: o capcană se judecă individual, nu intră în lista de confirmări.`
          : `Candidatul de citat (sursa candidati_citat) e PARTIAL / CONFLICT / UNDETERMINED sau citatul nu e găsit exact în textul capitolului v${k.versiune}. Candidatul e doar propunere AI: judecata e a omului.`,
        actiune_umana: actiune('deschide_capitol', d.et(k), { licitatie_id: L, capitol_id: k.id }),
        tinta: { capitol: capT(k), ecran: 'propunere' },
        provenienta: { sursa: tipuri.length === 1 ? tipuri[0] : 'mixt', tabel: 'ofertare_pt_legaturi', versiune: k.versiune, hash: k.continut_md5 ?? undefined,
          detaliu: { ...cnt, versiune_veche: vv } },
        elemente: el, grup: `cap:${k.id}`,
      }, q)
    }
  }
  // PT00 — universul PT e gol: „0 neverificate / 0 fără capitol" ar fi verde prin absență
  const qPT00 = poarta('PT00', SURSE_REGULI.PT00)
  if (qPT00 && M.U_PT.length === 0) emite({ id: 'PT00', regula: 'PT00', clasa: 'HUMAN_DECISION', blocheaza_final: true, porti: ['pt'], domeniu: 'pt', aspect: null,
    titlu: '0 cerințe de răspuns în PT (tip propunere / formă) — extracția e de verificat',
    cauza: `Registrul licitației ${L} nu are nicio cerință activă de tip propunere sau formă. Fără ele nu există nimic de verificat în PT, iar „0 neverificate / 0 fără capitol" ar fi un verde prin absență. Un om verifică extracția (tipurile cerințelor, documentele citite).`,
    actiune_umana: actiune('deschide_registru', 'Deschide registrul de cerințe și verifică tipurile extrase', { licitatie_id: L }), tinta: { ecran: 'registru' },
    provenienta: { sursa: 'regula_client', tabel: 'ofertare_cerinte' } }, qPT00)
  if (qPT01) {
    // cerințe PT fără capitol, ținute afară din F (= fara_capitol pe server) doar de o propunere AI sau de o dovadă fără autor:
    // serverul nu le numără, dar nici nu sunt închise de om → PT01.ok NU se emite (ele apar în R06_PROPUSA / R06_FARA_AUTOR)
    const faraCapNeinchise = M.U_PT.filter(c => { const f = M.stareDerivata.get(c.id); return !f.are_capitol && !f.exceptata && !F.includes(c) && !M.dovedataCuAutor(c) })
    const nInchise = M.U_PT.filter(c => { const f = M.stareDerivata.get(c.id); return !f.are_capitol && !f.exceptata && M.dovedataCuAutor(c) }).length
    if (F.length) emite({ id: 'PT01', regula: 'PT01', clasa: 'BLOCK', blocheaza_final: true, porti: ['pt'], domeniu: 'pt', aspect: 'raspuns_pt',
      titlu: `${plural(F.length, 'cerință PT fără capitol', 'cerințe PT fără capitol')}, fără excepție și fără dovadă`,
      cauza: `Cerințe active de tip propunere/forma fără nicio legătură fel='capitol' (în cuprinsul licitației ${L}), fără excepție și fără acoperire favorabilă — exact mulțimea fara_capitol din v_ofertare_pt_stare.`,
      actiune_umana: actiune('deschide_matrice', 'Deschide matricea pe filtrul „fără capitol"', { licitatie_id: L, filtru: 'fara' }),
      tinta: { ecran: 'matrice', filtru: 'fara' }, provenienta: { sursa: 'regula_client', tabel: 'ofertare_pt_legaturi' },
      elemente: F.map(c => ({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv: 'fara_capitol', sursa: 'necunoscuta',
        actiune: actiune('deschide_matrice', `Cerința ${nrC(c)}`, { licitatie_id: L, filtru: 'fara', cerinta_id: c.id }) })), grup: 'fara_capitol' }, qPT01)
    else if (M.U_PT.length && !faraCapNeinchise.length) emiteOk({ id: 'PT01.ok', regula: 'PT01',
      titlu: `Fiecare cerință PT are capitol, excepție sau dovadă verificată pe scan cu autor (${M.U_PT.length} cerințe PT${nInchise ? `, din care ${nInchise} închise cu dovadă` : ''})`,
      provenienta: { sursa: 'regula_client', tabel: 'ofertare_pt_legaturi' } }, qPT01)
  }
  if (qPT05) {
    if (capNull.length) indispControl.push({ regula: 'PT05', surse: SURSE_REGULI.PT05,
      detaliu: `${plural(capNull.length, 'cerință fără capitol are', 'cerințe fără capitol au')} textul trunchiat și nu au server_cer: nu putem ști dacă ${capNull.length === 1 ? 'e capcană' : 'sunt capcane'} — controlul capcanelor nu e „0"` })
    if (D.length) emite({ id: 'PT05', regula: 'PT05', clasa: 'BLOCK', blocheaza_final: true, porti: ['pt'], domeniu: 'pt', aspect: 'capcana',
      titlu: `${plural(D.length, 'capcană de respingere fără capitol', 'capcane de respingere fără capitol')}`,
      cauza: 'Cerințe cu clauză de respingere (REGEX_CAPCANA, ca în v_ofertare_pt_stare) fără capitol și fără excepție = capcane_descoperite.',
      actiune_umana: actiune('deschide_matrice', 'Deschide matricea pe filtrul „capcane"', { licitatie_id: L, filtru: 'capcane' }),
      tinta: { ecran: 'matrice', filtru: 'capcane' }, provenienta: { sursa: 'regula_client', tabel: 'ofertare_cerinte' },
      elemente: D.map(c => ({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv: 'capcana_fara_capitol' })), grup: 'fara_capitol' }, qPT05)
    else if (!capNull.length && M.U_PT.length) {
      const nCap = M.U_PT.filter(c => M.stareDerivata.get(c.id)?.capcana === true).length
      emiteOk({ id: 'PT05.ok', regula: 'PT05', titlu: `Nicio capcană de respingere fără capitol (regex pe ${plural(M.U_PT.length, 'cerință PT', 'cerințe PT')}: ${plural(nCap, 'capcană găsită', 'capcane găsite')}${nCap ? ', toate cu capitol — verificarea lor e în listă' : ''})`,
        provenienta: { sursa: 'regula_client', tabel: 'ofertare_cerinte' } }, qPT05)
    }
  }
  if (qPT0x) {
    if (pt06.length) emite({ id: 'PT06', regula: 'PT06', clasa: 'HUMAN_DECISION', blocheaza_final: true, porti: ['pt'], domeniu: 'pt', aspect: 'raspuns_pt',
      titlu: `${plural(pt06.length, 'excepție PT nepusă de om', 'excepții PT nepuse de om')}`,
      cauza: `Cerința e exceptată printr-o legătură fel='exceptat' cu sursa ≠ 'om' (AI / necunoscută). Serverul o scoate din „fără capitol" (v_ofertare_pt_stare), deci poarta o socotește rezolvată: incidentul deschis INCIDENT_V2_NSA_AI_2026-09-29 o califică FALSE_GREEN. Excepția „nu se aplică la PT" e o decizie umană motivată (TO-BE §2, corecții), așa că simularea blochează până o ia un om. Decizia finală: Copilot + Răzvan.`,
      actiune_umana: actiune('deschide_matrice', 'Deschide matricea pe filtrul „exceptate"', { licitatie_id: L, filtru: 'exceptate' }),
      tinta: { ecran: 'matrice', filtru: 'exceptate' }, provenienta: { sursa: 'ai', tabel: 'ofertare_pt_legaturi' },
      elemente: pt06.map(c => ({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv: 'exceptie_fara_om', sursa: M.Lg(c).find(l => l.fel === 'exceptat')?.sursa ?? 'necunoscuta' })), grup: 'fara_capitol' }, qPT0x)
    if (okVerif.length) emiteOk({ id: 'PT.ok_verificate', regula: 'PT', titlu: `${plural(okVerif.length, 'cerință verificată', 'cerințe verificate')} de om la versiunea curentă`, numar: okVerif.length,
      provenienta: { sursa: 'om', tabel: 'ofertare_pt_legaturi' } }, qPT0x)
    if (okExcOm.length) emiteOk({ id: 'PT.ok_exceptate_om', regula: 'PT', titlu: `${plural(okExcOm.length, 'cerință exceptată', 'cerințe exceptate')} de om, cu motiv`, numar: okExcOm.length,
      provenienta: { sursa: 'om', tabel: 'ofertare_pt_legaturi' } }, qPT0x)
  }

  // pt_dovezi indisponibilă: PT02 afișează dovezi_atasate = null (nu 0)
  if (qPT0x && !S.pt_dovezi.utilizabila) marcheaza('pt_dovezi', 'PT02')

  // ── 5.2 Registru E2 ───────────────────────────────────────────────────────────────────────
  const qE2 = poarta('E2_01', SURSE_REGULI.E2_01)
  const qE2b = poarta('E2_BLOC', SURSE_REGULI.E2_BLOC)
  // gruparea pe capitolul principal (doar pentru organizarea muncii; judecata rămâne pe fiecare cerință)
  const grupeazaPeCapitol = lista => {
    const areLeg = S.legaturi.utilizabila && S.capitole.utilizabila
    const grupuri = new Map()
    for (const c of lista) {
      const k = areLeg ? M.principal(c) : undefined
      const g = k ? `cap:${k.id}` : (areLeg ? 'fara_capitol' : 'registru')
      if (!grupuri.has(g)) grupuri.set(g, { k: k || null, el: [] })
      grupuri.get(g).el.push(c)
    }
    return grupuri
  }
  const prefixGrup = (g, k) => (k ? `Cap. ${k.nr} «${k.titlu}»: ` : g === 'fara_capitol' ? 'Fără capitol: ' : '')
  if (qE2) {
    const v2 = S.e2_neconfirmate.date
    if (M.cerinte.some(c => !('e2_confirmata_de' in c))) indispControl.push({ regula: 'E2_01', surse: SURSE_REGULI.E2_01, motiv: 'forma_invalida',
      detaliu: 'rândurile din ofertare_cerinte nu au câmpul confirmata_de (e2_confirmata_de) — nu putem spune câte sunt neconfirmate; NU înseamnă „toate confirmate"' })
    else if (!Number.isInteger(v2.cerinte_neconfirmate_cu_capitol) || v2.cerinte_neconfirmate_cu_capitol < 0 || !Array.isArray(v2.cerinte_neconfirmate_ids)) indispControl.push({ regula: 'E2_01', surse: SURSE_REGULI.E2_01,
      detaliu: `v_ofertare_pt_cerinte_neconfirmate a întors un rezultat invalid (cerinte_neconfirmate_cu_capitol = ${JSON.stringify(v2.cerinte_neconfirmate_cu_capitol)}) — controlul e indisponibil, nu „0 neconfirmate"` })
    else {
      // confirmata_de NULL, gol sau doar spații = neconfirmată (un șir gol nu e un om)
      const X = M.C_act.filter(c => !areActor(c.e2_confirmata_de))
      const xIds = new Set(X.map(c => c.id))
      const nuSunt = v2.cerinte_neconfirmate_ids.filter(id => !xIds.has(id))
      if (nuSunt.length || v2.cerinte_neconfirmate_ids.length !== v2.cerinte_neconfirmate_cu_capitol)
        M.int01.push({ blocant: nuSunt.length > 0, surse: SURSE_REGULI.E2_01,
          motiv: `E2: view-ul spune ${v2.cerinte_neconfirmate_cu_capitol} neconfirmate cu capitol (ids ${v2.cerinte_neconfirmate_ids.length}), iar ${nuSunt.length} dintre ele apar confirmate în rândurile citite` })
      for (const [g, { k, el }] of grupeazaPeCapitol(X)) emite({
        id: `E2_01:${g}`, regula: 'E2_01', clasa: 'CONFIRM', blocheaza_final: true, porti: ['pt', 'depunere'], domeniu: 'registru', aspect: 'registru_e2',
        titlu: `${prefixGrup(g, k)}${plural(el.length, 'cerință neconfirmată', 'cerințe neconfirmate')} în registru (E2)`,
        cauza: 'ofertare_cerinte.confirmata_de e NULL (sau gol): extracția obligației n-a fost confirmată de un om (aceeași condiție ca n_neconfirmate din fn_gate_depunere). E2 e o confirmare DISTINCTĂ de verificarea răspunsului PT.',
        actiune_umana: actiune('deschide_registru', 'Deschide registrul pe „neconfirmate" și confirmă fiecare cerință separat', { licitatie_id: L, filtru: 'neconfirmate', cerinta_ids: el.map(c => c.id) }),
        tinta: { ...(k ? { capitol: capT(k) } : {}), ecran: 'registru', filtru: 'neconfirmate' }, provenienta: { sursa: 'server', tabel: 'ofertare_cerinte' },
        elemente: el.map(c => ({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv: 'neconfirmata_e2', sursa: c.extras_de_ai === true ? 'ai' : 'necunoscuta' })), grup: g }, qE2)
      // E2_BLOC — confirmările „în bloc" (același moment, la secundă) nu sunt judecăți individuale: nu se arată verde
      const confirmate = M.C_act.filter(c => areActor(c.e2_confirmata_de))
      let bloc = null
      if (qE2b) {
        if (confirmate.some(c => !('e2_confirmata_la' in c))) indispControl.push({ regula: 'E2_BLOC', surse: SURSE_REGULI.E2_BLOC, motiv: 'forma_invalida',
          detaliu: 'rândurile din ofertare_cerinte nu au câmpul confirmata_la (e2_confirmata_la) — nu putem spune dacă confirmările E2 sunt individuale; NU înseamnă „confirmate de om"' })
        else {
          const inBloc = grupeInBloc(confirmate, c => c.e2_confirmata_la)
          bloc = confirmate.filter(c => inBloc.has(c) || secunda(c.e2_confirmata_la) == null)
          const nMomente = new Set(bloc.map(c => inBloc.get(c)?.secunda).filter(Boolean)).size
          for (const [g, { k, el }] of grupeazaPeCapitol(bloc)) emite({
            id: `E2_BLOC:${g}`, regula: 'E2_BLOC', clasa: 'CONFIRM', blocheaza_final: true, porti: ['pt', 'depunere'], domeniu: 'registru', aspect: 'registru_e2',
            titlu: `${prefixGrup(g, k)}${plural(el.length, 'confirmare E2 fără judecată individuală', 'confirmări E2 fără judecată individuală')} (în bloc / fără moment) — de reexaminat una câte una`,
            cauza: `ofertare_cerinte.confirmata_de e completat, dar confirmata_la arată o acțiune pe grup: mai multe cerințe confirmate în ACEEAȘI secundă (${plural(nMomente, 'moment', 'momente')} de acest fel în registru) sau fără moment. Asta e o confirmare pe tot registrul dintr-un singur click, nu citirea fiecărei obligații. Serverul (fn_gate_depunere) le socotește confirmate; simularea nu le arată verde și le ține blocante — „sistemul poate grupa munca, nu judecata" (Audit V2). Decizia finală: Copilot + Răzvan.`,
            actiune_umana: actiune('deschide_registru', 'Deschide registrul și reexaminează fiecare cerință separat', { licitatie_id: L, cerinta_ids: el.map(c => c.id) }),
            tinta: { ...(k ? { capitol: capT(k) } : {}), ecran: 'registru' },
            provenienta: { sursa: el.every(c => inBloc.has(c)) ? 'om_in_bloc' : el.every(c => !inBloc.has(c)) ? 'om_fara_moment' : 'mixt', tabel: 'ofertare_cerinte',
              detaliu: { in_bloc: el.filter(c => inBloc.has(c)).length, fara_moment: el.filter(c => !inBloc.has(c)).length } },
            elemente: el.map(c => ({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv: inBloc.has(c) ? 'confirmata_in_bloc' : 'confirmata_fara_moment', sursa: inBloc.has(c) ? 'om_in_bloc' : 'om_fara_moment',
              detalii: { confirmata_la: secunda(c.e2_confirmata_la), confirmari_in_aceeasi_secunda: inBloc.get(c)?.marime ?? null } })), grup: g }, qE2b)
        }
      }
      if (M.C_act.length && !X.length && bloc && !bloc.length) emiteOk({ id: 'E2.ok', regula: 'E2_01',
        titlu: `Toate cele ${M.C_act.length} cerințe active sunt confirmate de om în registru (E2), fiecare separat`, numar: M.C_act.length,
        provenienta: { sursa: 'om', tabel: 'ofertare_cerinte' } }, qE2)
    }
  }

  // ── 5.3 Dovezi R06 + poarta de depunere ─────────────────────────────────────────────────────
  const qDep = poartaTacuta(R_DEP)
  const regDep = ['R06_REVERIF', 'R06_ELIM_PROPUSA', 'R06_ELIM_FARA', 'R06_ELIM_NEDET', 'R06_ELIM_AI_NA', 'R06_FARA_AUTOR', 'DEP00', 'DEP01']
  const qR = Object.fromEntries(regDep.map(r => [r, poarta(r, SURSE_REGULI[r])]))
  const qGrupDep = { R06_PROPUSA: poarta('R06_PROPUSA', SURSE_REGULI.R06_PROPUSA), R06_AI_NA: poarta('R06_AI_NA', SURSE_REGULI.R06_AI_NA) }
  if (qR.DEP00 && M.C_act.length === 0) emite({ id: 'DEP00', regula: 'DEP00', clasa: 'BLOCK', blocheaza_final: true, porti: ['depunere'], domeniu: 'dovezi', aspect: null,
    titlu: '0 cerințe active', cauza: 'Poarta de depunere refuză o licitație fără nicio cerință extrasă activă (fn_gate_depunere). „Nimic de făcut" nu înseamnă OK.',
    actiune_umana: actiune('deschide_registru', 'Deschide registrul de cerințe', { licitatie_id: L }), tinta: { ecran: 'registru' },
    provenienta: { sursa: 'regula_client', tabel: 'ofertare_cerinte' } }, qR.DEP00)
  if (qDep) {
    const bucket = { R06_REVERIF: [], R06_ELIM_PROPUSA: [], R06_ELIM_FARA: [], R06_ELIM_NEDET: [], R06_PROPUSA: [], DEP01: [], R06_ELIM_AI_NA: [], R06_AI_NA: [], R06_FARA_AUTOR: [] }
    let okDov = 0, okScoase = 0, nReverifRanduri = 0
    const coveredPT = new Set([...F, ...N, ...pt06, ...okVerif, ...okExcOm].map(c => c.id))
    // „scoasă de om" = decizie INDIVIDUALĂ: autor (stare_de nevid) + moment propriu (stare_la). Mai multe cerințe scoase în aceeași
    // secundă = o acțiune pe grup (UI-ul scrie rând cu rând) → nu e verde (INCIDENT_V2_NSA_AI_2026-09-29).
    const scoaseBloc = grupeInBloc(M.C_act.filter(c => c.stare === 'nu_se_aplica' && areActor(c.stare_de)), c => c.stare_la)
    for (const c of M.C_act) {
      const elim = c.tip === 'eliminatorie'
      const doc = String(c.document_probant ?? '').trim() !== ''
      const ac = M.Ac(c)
      const na = ac.some(a => a.status === 'nu_se_aplica')
      const scoasaAutor = c.stare === 'nu_se_aplica' && areActor(c.stare_de)
      const inBloc = scoaseBloc.get(c)
      const faraMoment = scoasaAutor && secunda(c.stare_la) == null
      const scoasaOm = scoasaAutor && !inBloc && !faraMoment
      const acDep = M.acoperitaDep(c), prop = M.propusa(c), dov = M.dovedita(c)
      const statusuri = [...new Set(ac.map(a => a.status))].sort()
      const stAc = !ac.length ? 'fara_rand' : statusuri.length === 1 ? statusuri[0] : `mixt:${statusuri.join('+')}`
      const el = motiv => ({ cerinta_id: c.id, nr_ordine: c.nr_ordine, motiv, detalii: { tip: c.tip, status_acoperire: stAc, document_probant: c.document_probant ?? null } })
      const rv = ac.filter(a => favorabila(a) && reverif(a))
      nReverifRanduri += rv.length
      if (rv.length) { bucket.R06_REVERIF.push({ ...el('reverificare_ceruta'), acoperire_id: rv[0].id, detalii: { ...el().detalii, randuri_reverificare: rv.length } }); continue }
      if (!acDep) {
        if (prop && elim && doc) bucket.R06_ELIM_PROPUSA.push({ ...el('dovada_doar_propusa'), sursa: 'ai' })
        else if (!prop && elim && doc) bucket.R06_ELIM_FARA.push(el('fara_dovada'))
        else if (elim && !doc) bucket.R06_ELIM_NEDET.push(el('document_probant_nespecificat'))
        else if (prop && !elim) bucket.R06_PROPUSA.push({ ...el('dovada_doar_propusa'), sursa: 'ai' })
        else bucket.DEP01.push(el('fara_acoperire_valida'))
        continue
      }
      if (dov) {
        if (M.dovedataCuAutor(c)) okDov++
        else bucket.R06_FARA_AUTOR.push({ ...el('verificata_pe_scan_fara_autor'), sursa: 'necunoscuta' })
        continue
      }
      if (na && scoasaOm) { okScoase++; continue }
      const naEl = () => {
        const e = el(inBloc ? 'scoasa_in_bloc' : faraMoment ? 'scoasa_fara_moment' : 'nu_se_aplica_neconfirmat_de_om')
        return { ...e, sursa: scoasaAutor ? (inBloc ? 'om_in_bloc' : 'om_fara_moment') : 'ai',
          detalii: { ...e.detalii, ...(inBloc ? { stare_la: inBloc.secunda, scoase_in_aceeasi_secunda: inBloc.marime } : {}) } }
      }
      if (na && elim) { bucket.R06_ELIM_AI_NA.push(naEl()); continue }
      if (M.uptIds.has(c.id) && coveredPT.has(c.id)) continue   // acoperită pe aspectul raspuns_pt (PT01–PT07 / ok PT)
      bucket.R06_AI_NA.push(naEl())
    }
    const defDep = {
      R06_REVERIF: ['BLOCK', true, n => `${plural(n, 'dovadă cu reverificare cerută', 'dovezi cu reverificare cerută')}`,
        `Acoperire favorabilă cu reverificare_ceruta — fn_gate_depunere o numără în n_reverif (${nReverifRanduri} rânduri) și refuză depunerea.`],
      R06_ELIM_PROPUSA: ['BLOCK', true, n => `${plural(n, 'eliminatorie', 'eliminatorii')} cu dovadă doar propusă, neverificată pe scan`,
        'Cerință eliminatorie cu document probant, acoperită doar de o propunere (acoperit / acoperit_partener) fără verificat_pe_scan = true (NULL inclus). Propunerea AI nu e dovadă (R06); fn_gate_depunere o numără în n_neacoperite.'],
      R06_ELIM_FARA: ['BLOCK', true, n => `${plural(n, 'eliminatorie', 'eliminatorii')} fără dovadă`,
        'Cerință eliminatorie cu document probant, fără acoperire sau cu acoperire gol / in_lucru / regula_propunere. fn_gate_depunere o numără în n_neacoperite.'],
      R06_ELIM_NEDET: ['HUMAN_DECISION', true, n => `${plural(n, 'eliminatorie', 'eliminatorii')} fără document probant specificat`,
        'Documentul probant nu e specificat: nu știm dacă cerința se satisface prin text sau prin document (lipsa informației ≠ negativ). Decide omul; serverul oricum blochează depunerea până atunci.'],
      R06_PROPUSA: ['CONFIRM', true, n => `${plural(n, 'dovadă propusă de AI', 'dovezi propuse de AI')}, neverificate pe scan`,
        'Acoperire favorabilă fără verificat_pe_scan = true: e candidat AI, nu dovadă. Poarta de depunere (R06) cere verificarea pe scan de un om.'],
      DEP01: ['BLOCK', true, n => `${plural(n, 'cerință fără acoperire validă', 'cerințe fără acoperire validă')} la depunere`,
        'Poarta de depunere (fn_gate_depunere, R06/R07) ar refuza: fără acoperire nu_se_aplica sau verificată pe scan.'],
      R06_ELIM_AI_NA: ['HUMAN_DECISION', true, n => `${plural(n, 'eliminatorie', 'eliminatorii')} „nu se aplică" fără decizie umană individuală`,
        'Acoperire nu_se_aplica, dar cerința n-a fost scoasă din registru printr-o decizie umană individuală: fără autor (stare_de NULL — clasare automată), „în bloc" (mai multe cerințe cu același moment stare_la, la secundă — o singură acțiune pe grup) sau fără moment. J02 / fn_gate_depunere o socotește acoperită: incidentul deschis INCIDENT_V2_NSA_AI_2026-09-29 o califică FALSE_GREEN (remedierea A). TO-BE §5: lipsa informației rămâne BLOCK pe eliminatorii, deci simularea blochează. Decizia finală: Copilot + Răzvan.'],
      R06_AI_NA: ['CONFIRM', false, n => `${plural(n, 'cerință', 'cerințe')} „nu se aplică" fără decizie umană individuală`,
        'Acoperire nu_se_aplica fără ca cerința să fie scoasă din registru de un om, individual (fără autor, în bloc sau fără moment). Serverul o acceptă; clasarea automată sau pe grup nu se prezintă ca verde. Nu e eliminatorie, deci nu blochează final.'],
      R06_FARA_AUTOR: ['CONFIRM', true, n => `${plural(n, 'dovadă bifată', 'dovezi bifate')} „verificat pe scan" fără autor`,
        'verificat_pe_scan = true, dar verificat_de e NULL sau gol. Formula R06 a serverului nu cere autorul, deci fn_gate_depunere o socotește dovedită; simularea nu o arată ca verificare umană: o bifă fără autor nu spune cine a văzut scanul. Decizia finală: Copilot + Răzvan.'],
    }
    for (const [regula, el] of Object.entries(bucket)) {
      if (!el.length) continue
      const [clasa, bf, tit, cauza] = defDep[regula]
      const q = qGrupDep[regula] ?? qR[regula]
      if (!q) continue
      const porti = ['depunere']
      // proveniența grupului: 'ai' (fără autor), 'om_in_bloc' / 'om_fara_moment' (a scris un om, dar nu individual) — niciodată simplu „om"
      const surseNA = [...new Set(el.map(e => e.sursa))]
      const sursaExc = ['R06_ELIM_AI_NA', 'R06_AI_NA'].includes(regula) ? (surseNA.length === 1 ? surseNA[0] : 'mixt')
        : ['R06_PROPUSA', 'R06_ELIM_PROPUSA'].includes(regula) ? 'ai' : regula === 'R06_FARA_AUTOR' ? 'necunoscuta' : 'regula_client'
      const detNA = ['R06_ELIM_AI_NA', 'R06_AI_NA'].includes(regula)
        ? { detaliu: { fara_autor: el.filter(e => e.sursa === 'ai').length, in_bloc: el.filter(e => e.sursa === 'om_in_bloc').length, fara_moment: el.filter(e => e.sursa === 'om_fara_moment').length } } : {}
      const baza = { regula, clasa, blocheaza_final: bf, porti, domeniu: 'dovezi', aspect: 'dovada', cauza,
        provenienta: { sursa: sursaExc, tabel: regula === 'R06_ELIM_AI_NA' || regula === 'R06_AI_NA' ? 'ofertare_cerinte' : 'ofertare_acoperire', ...detNA } }
      if (regula === 'R06_PROPUSA') {
        const g = new Map()
        let faraCap = 0
        for (const e of el) {
          const c = M.cerById.get(e.cerinta_id), k = M.principal(c)
          const key = k ? `cap:${k.id}` : 'fara_capitol'
          if (!k) faraCap++
          if (!g.has(key)) g.set(key, { k, el: [] })
          g.get(key).el.push({ ...e, capitol_id: k?.id ?? null, actiune: actiune('deschide_acoperire', `Acoperirea cerinței ${nrC(c)}`, { licitatie_id: L, cerinta_id: c.id }) })
        }
        for (const [key, { k, el: ge }] of g) emite({ ...baza, id: `R06_PROPUSA:${key}`,
          titlu: `${k ? `Cap. ${k.nr} «${k.titlu}»: ` : 'Fără capitol: '}${tit(ge.length)}`,
          actiune_umana: actiune('deschide_acoperire', 'Deschide acoperirea și verifică fiecare dovadă pe scan', { licitatie_id: L, cerinta_ids: ge.map(e => e.cerinta_id) }),
          tinta: { ...(k ? { capitol: capT(k) } : {}), ecran: 'acoperire' },
          provenienta: { ...baza.provenienta, detaliu: { din_care_fara_capitol: faraCap } }, elemente: ge, grup: key }, q)
        continue
      }
      emite({ ...baza, id: regula, titlu: tit(el.length),
        actiune_umana: actiune(regula === 'R06_AI_NA' || regula === 'R06_ELIM_AI_NA' ? 'deschide_registru' : 'deschide_acoperire',
          regula === 'R06_AI_NA' || regula === 'R06_ELIM_AI_NA' ? 'Deschide registrul și decide pe fiecare cerință' : 'Deschide acoperirea (dovezile) pe cerințele listate',
          { licitatie_id: L, cerinta_ids: el.map(e => e.cerinta_id) }),
        tinta: { ecran: regula === 'R06_AI_NA' || regula === 'R06_ELIM_AI_NA' ? 'registru' : 'acoperire' },
        ...(regula === 'DEP01' ? { provenienta: { ...baza.provenienta, detaliu: { pe_tip: numaraPe(el, e => `${e.detalii.tip}|${e.detalii.status_acoperire}`) } } } : {}),
        ...(regula === 'R06_FARA_AUTOR' ? { provenienta: { ...baza.provenienta, detaliu: { n_fara_autor: el.length } } } : {}),
        ...(regula === 'R06_REVERIF' ? { provenienta: { ...baza.provenienta, detaliu: { n_reverif_randuri: nReverifRanduri } } } : {}),
        elemente: el.map(e => ({ ...e, actiune: actiune('deschide_acoperire', `Acoperirea cerinței ${nrC(M.cerById.get(e.cerinta_id))}`, { licitatie_id: L, cerinta_id: e.cerinta_id }) })),
        grup: regula === 'R06_AI_NA' || regula === 'R06_ELIM_AI_NA' ? 'registru' : 'depunere' }, q)
    }
    if (okDov) emiteOk({ id: 'R06.ok_dovedite', regula: 'R06', titlu: `${plural(okDov, 'cerință cu dovadă verificată', 'cerințe cu dovadă verificată')} pe scan de om (R06, cu autorul verificării)`, numar: okDov,
      provenienta: { sursa: 'om', tabel: 'ofertare_acoperire' } }, qDep)
    if (okScoase) emiteOk({ id: 'R06.ok_scoase_om', regula: 'R06', titlu: `${plural(okScoase, 'cerință scoasă', 'cerințe scoase')} de om din registru („nu se aplică"), fiecare cu autor și moment propriu`, numar: okScoase,
      provenienta: { sursa: 'om', tabel: 'ofertare_cerinte' } }, qDep)
  }
  // DEP_ROSII — valabilitatea documentelor de firmă (tri-valent, ca în SQL)
  const qRosii = poarta('DEP_ROSII', SURSE_REGULI.DEP_ROSII)
  if (qRosii) {
    const docs = new Map(S.documente_firma_valabilitate.date.map(d => [d.id, d]))
    const termen = S.licitatie.date.termen_depunere
    const bazaTermen = zi(typeof termen === 'string' ? termen.slice(0, 10) : null)
    // fără termen de depunere nu putem judeca „valabil ≥ 90 de zile după termen": nu înlocuim termenul cu ziua de azi
    const baza = bazaTermen ?? Infinity
    const rosii = [], necitite = new Map()   // doc_firma_id → acoperiri care îl referă
    let faraTermen = 0
    for (const c of M.C_act) for (const a of M.Ac(c)) {
      if (a.doc_firma_id == null) continue
      const d = docs.get(a.doc_firma_id)
      if (!d) { if (!necitite.has(a.doc_firma_id)) necitite.set(a.doc_firma_id, []); necitite.get(a.doc_firma_id).push(a.id); continue }
      const b = (camp, conservator) => {
        const x = d[camp]
        if (x === true || x === false) return x
        if (x == null) { M.int04.push({ cerinta_id: c.id, document_id: d.id, motiv: `documente_firma #${d.id}.${camp} = NULL (tratat ca în SQL)` }); return null }
        M.int04.push({ cerinta_id: c.id, document_id: d.id, motiv: `documente_firma #${d.id}.${camp} = ${JSON.stringify(x)} (nu e boolean) — interpretat conservator` }); return conservator
      }
      const util = b('utilizabil', false), fara = b('fara_expirare', false)
      const reemite = d.se_reemite === true
      const dv = d.data_valabilitate == null ? null : zi(String(d.data_valabilitate).slice(0, 10))
      if (d.data_valabilitate != null && dv == null) M.int04.push({ cerinta_id: c.id, document_id: d.id, motiv: `documente_firma #${d.id}.data_valabilitate invalidă` })
      if (bazaTermen == null && d.data_valabilitate != null && fara !== true) faraTermen++
      const expira = and3(not3(fara), d.data_valabilitate != null, dv == null || bazaTermen == null ? null : dv < baza + (reemite ? 0 : 90))
      if (or3(not3(util), expira) === true) rosii.push({ cerinta_id: c.id, nr_ordine: c.nr_ordine, acoperire_id: a.id, document_id: d.id,
        motiv: util === false ? 'document_neutilizabil' : 'valabilitate_insuficienta', detalii: { data_valabilitate: d.data_valabilitate ?? null, se_reemite: d.se_reemite ?? null } })
    }
    if (faraTermen) indispControl.push({ regula: 'DEP_ROSII', surse: SURSE_REGULI.DEP_ROSII, motiv: 'forma_invalida',
      detaliu: `ofertare_licitatii.termen_depunere lipsește sau e invalid (${JSON.stringify(termen ?? null)}): pentru ${plural(faraTermen, 'dovadă cu dată de valabilitate', 'dovezi cu dată de valabilitate')} nu putem judeca „valabil ≥ 90 de zile după termen" — nu înseamnă „fără dovezi roșii"` })
    // document referit de acoperire, dar absent din citirea de valabilitate: valabilitatea lui e NECUNOSCUTĂ → control indisponibil, nu „fără roșii"
    if (necitite.size) indispControl.push({ regula: 'DEP_ROSII', surse: SURSE_REGULI.DEP_ROSII, motiv: 'forma_invalida',
      detaliu: `valabilitate necunoscută pentru ${plural(necitite.size, 'document de firmă referit', 'documente de firmă referite')} de acoperire, dar absente din citirea documente_firma (${[...necitite.entries()].map(([id, ac]) => `doc ${id} ← acoperire ${ac.join(', ')}`).join('; ')}) — nu înseamnă „fără dovezi roșii"` })
    if (rosii.length) emite({ id: 'DEP_ROSII', regula: 'DEP_ROSII', clasa: 'BLOCK', blocheaza_final: true, porti: ['depunere'], domeniu: 'dovezi', aspect: null,
      titlu: `${plural(rosii.length, 'dovadă roșie', 'dovezi roșii')} (expirate / expiră la mai puțin de 90 de zile după termen / neutilizabile)`,
      cauza: 'Predicatul n_rosii din fn_gate_depunere: NOT utilizabil OR data_valabilitate < termen + (se_reemite ? 0 : 90) zile.',
      actiune_umana: actiune('deschide_acoperire', 'Deschide acoperirea pe documentele listate', { licitatie_id: L }), tinta: { ecran: 'acoperire' },
      provenienta: { sursa: 'server', tabel: 'documente_firma' }, elemente: rosii, grup: 'depunere' }, qRosii)
  }

  // ── 5.4 Capitole ────────────────────────────────────────────────────────────────────────────
  ;['CAP00', 'CAP01', 'CAP02', 'CAP03', 'INT03'].forEach(r => poarta(r, SURSE_REGULI[r]))
  const qCap = poartaTacuta(['capitole'])
  if (qCap) {
    const K = M.capitole
    const obligatoriu = k => {
      if (typeof k.obligatoriu === 'boolean') return k.obligatoriu
      M.int04.push({ capitol_id: k.id, motiv: `capitolul ${k.nr}: obligatoriu = ${JSON.stringify(k.obligatoriu)} — tratat conservator ca obligatoriu` }); return true
    }
    if (!K.length) emite({ id: 'CAP00', regula: 'CAP00', clasa: 'BLOCK', blocheaza_final: true, porti: ['pt'], domeniu: 'capitole', aspect: null,
      titlu: 'Niciun capitol în cuprins', cauza: 'ofertare_pt_capitole nu are niciun rând pentru licitație (citire reușită): cuprinsul lipsește. 0 capitole NU înseamnă „0 goale ⇒ ok".',
      actiune_umana: actiune('deschide_capitol', 'Deschide cuprinsul (se ia din fișa de date)', { licitatie_id: L }), tinta: { ecran: 'propunere' },
      provenienta: { sursa: 'server', tabel: 'ofertare_pt_capitole' } }, qCap)
    else if (K.some(k => typeof k.continut_gol !== 'boolean')) indispControl.push({ regula: 'CAP01', surse: ['capitole'], motiv: 'forma_invalida',
      detaliu: 'capitole fără câmpul continut_gol (boolean calculat pe textul integral) — nu putem spune care sunt goale; CAP01/CAP02 neevaluate' })
    else {
      const goale = K.filter(k => obligatoriu(k) && k.stare !== 'nu_se_aplica' && k.continut_gol === true && k.are_fisier !== true)
      if (goale.length) emite({ id: 'CAP01', regula: 'CAP01', clasa: 'BLOCK', blocheaza_final: true, porti: ['pt'], domeniu: 'capitole', aspect: 'text_capitol',
        titlu: `${plural(goale.length, 'capitol obligatoriu gol', 'capitole obligatorii goale')}`, cauza: 'Capitol obligatoriu fără text și fără fișier (capitole_goale din v_ofertare_pt_stare).',
        actiune_umana: actiune('deschide_capitol', 'Deschide capitolele goale', { licitatie_id: L, capitol_ids: goale.map(k => k.id) }), tinta: { ecran: 'propunere' },
        provenienta: { sursa: 'server', tabel: 'ofertare_pt_capitole' },
        elemente: goale.map(k => ({ capitol_id: k.id, motiv: `cap. ${k.nr} gol`, actiune: actiune('deschide_capitol', `Cap. ${k.nr}`, { licitatie_id: L, capitol_id: k.id }) })) }, qCap)
      else emiteOk({ id: 'CAP01.ok', regula: 'CAP01', titlu: `Niciun capitol obligatoriu gol (${K.length} capitole citite)`, provenienta: { sursa: 'server', tabel: 'ofertare_pt_capitole' } }, qCap)
      for (const k of [...K].sort(cmpCapitol)) {
        if (!(obligatoriu(k) && k.stare !== 'nu_se_aplica' && k.continut_gol === false && (k.sursa ?? 'om') !== 'om')) continue
        emite({ id: `CAP02:cap:${k.id}`, regula: 'CAP02', clasa: 'CONFIRM', blocheaza_final: true, porti: ['pt'], domeniu: 'capitole', aspect: 'text_capitol',
          titlu: `Cap. ${k.nr}: text ${k.sursa === 'ai' ? 'AI' : `„${k.sursa}"`} v${k.versiune} necitit de om`,
          cauza: `Capitolul obligatoriu are text cu sursa='${k.sursa}' (capitole_nescrise_de_om). Acceptarea explicită „Accept v${k.versiune}" nu există încă (QW4, livrare separată): azi blocajul se stinge doar printr-o salvare de om, care schimbă sursa și crește versiunea — de aceea prototipul NU oferă nicio acțiune de acceptare.`,
          actiune_umana: actiune('deschide_capitol', `Deschide cap. ${k.nr} și citește textul v${k.versiune}`, { licitatie_id: L, capitol_id: k.id }),
          tinta: { capitol: capT(k), ecran: 'propunere' }, provenienta: { sursa: k.sursa === 'ai' ? 'ai' : 'necunoscuta', tabel: 'ofertare_pt_capitole', versiune: k.versiune, hash: k.continut_md5 ?? undefined },
          grup: `cap:${k.id}` }, qCap)
      }
      const nul = K.filter(k => k.continut_gol === false && k.sursa == null)
      if (nul.length) emite({ id: 'CAP03', regula: 'CAP03', clasa: 'WARN', blocheaza_final: false, porti: ['pt'], domeniu: 'capitole', aspect: null,
        titlu: `${plural(nul.length, 'capitol cu text și proveniență necunoscută', 'capitole cu text și proveniență necunoscută')}`,
        cauza: 'sursa = NULL: serverul o tratează ca „om" (COALESCE), dar nu știm cine a scris textul — nu se prezintă ca verificat.',
        actiune_umana: actiune('deschide_capitol', 'Deschide capitolele listate', { licitatie_id: L }), tinta: { ecran: 'propunere' },
        provenienta: { sursa: 'necunoscuta', tabel: 'ofertare_pt_capitole' }, elemente: nul.map(k => ({ capitol_id: k.id, motiv: `cap. ${k.nr}: sursa NULL` })) }, qCap)
    }
    const contrad = K.filter(k => k.stare === 'gol' && (k.continut_gol === false || k.are_fisier === true))
    if (contrad.length) emite({ id: 'INT03', regula: 'INT03', clasa: 'WARN', blocheaza_final: false, porti: ['pt'], domeniu: 'integritate', aspect: null,
      titlu: `${plural(contrad.length, 'capitol are', 'capitole au')} stare stocată „gol", dar au text`,
      cauza: "ofertare_pt_capitole.stare='gol' contrazice conținutul (continut_gol = false sau fișier). UI-ul derivă eticheta din text; starea stocată rămâne greșită.",
      actiune_umana: actiune('deschide_capitol', 'Deschide cuprinsul', { licitatie_id: L }), tinta: { ecran: 'propunere' }, provenienta: { sursa: 'server', tabel: 'ofertare_pt_capitole' },
      elemente: contrad.map(k => ({ capitol_id: k.id, motiv: `cap. ${k.nr}: stare 'gol', ${k.continut_len ?? '?'} caractere` })) }, qCap)
  }

  // ── 5.5 Documente, SEAP, R5, F9 ─────────────────────────────────────────────────────────────
  ;['DOC01', 'DOC02'].forEach(r => poarta(r, SURSE_REGULI[r]))
  const qDoc = poartaTacuta(['documente'])
  if (qDoc) {
    const Dd = S.documente.date
    if (!Dd.length) emite({ id: 'DOC01', regula: 'DOC01', clasa: 'BLOCK', blocheaza_final: true, porti: ['pt'], domeniu: 'documente', aspect: null,
      titlu: 'Niciun document de atribuire încărcat', cauza: 'ofertare_documente_atribuire: 0 rânduri (citire reușită) — cerințele nu pot exista.',
      actiune_umana: actiune('deschide_documente', 'Deschide Documentația', { licitatie_id: L }), tinta: { ecran: 'documente' }, provenienta: { sursa: 'server', tabel: 'ofertare_documente_atribuire' } }, qDoc)
    const necitit = d => typeof d.necitit_server === 'boolean' ? d.necitit_server
      : ((d.eroare != null && d.status_procesare !== 'procesat') || ['neprocesat', 'partial'].includes(d.status_procesare))
    const nec = Dd.filter(necitit)
    if (nec.length) emite({ id: 'DOC02', regula: 'DOC02', clasa: 'WARN', blocheaza_final: false, porti: ['pt'], domeniu: 'documente', aspect: null,
      titlu: `${plural(nec.length, 'document necitit', 'documente necitite')} sau cu eroare`,
      cauza: 'Aceeași expresie ca documente_necitite din v_ofertare_pt_stare (eroare fără „procesat", sau neprocesat / partial). Cerințele pot veni dintr-un corpus incomplet. Documentele se identifică după id, nu după nume.',
      actiune_umana: actiune('deschide_documente', 'Deschide Documentația pe documentele listate', { licitatie_id: L, document_ids: nec.map(d => d.id) }), tinta: { ecran: 'documente' },
      provenienta: { sursa: 'server', tabel: 'ofertare_documente_atribuire' },
      elemente: nec.map(d => ({ document_id: d.id, motiv: `${d.status_procesare ?? '?'}${d.eroare != null ? ' · cu eroare' : ''}`, detalii: { text_sursa: d.nume_original ?? null, revizie: d.revizie ?? null, size_bytes: d.size_bytes ?? null } })) }, qDoc)
  }
  const qSeap = poarta('DOC03', SURSE_REGULI.DOC03)
  // forma rândului SEAP: câmpul blocaj trebuie să EXISTE; NULL = „fără blocaj" doar când e scris explicit de view
  const seapValid = S.seap_completitudine.utilizabila && 'blocaj' in S.seap_completitudine.date
    && (S.seap_completitudine.date.blocaj === null || (typeof S.seap_completitudine.date.blocaj === 'string' && S.seap_completitudine.date.blocaj.trim() !== ''))
  if (qSeap) {
    const b = S.seap_completitudine.date.blocaj
    if (!('blocaj' in S.seap_completitudine.date)) indispControl.push({ regula: 'DOC03', surse: ['seap_completitudine'], motiv: 'forma_invalida',
      detaliu: 'v_ofertare_seap_completitudine: rândul nu are câmpul blocaj — nu putem spune dacă documentația e completă și citită; NU înseamnă „fără blocaj"' })
    else if (b === null) emiteOk({ id: 'DOC03.ok', regula: 'DOC03', titlu: 'Documentația de atribuire: completă și citită (R12, server)', provenienta: { sursa: 'server', tabel: 'v_ofertare_seap_completitudine' } }, qSeap)
    else if (typeof b !== 'string' || !b.trim()) indispControl.push({ regula: 'DOC03', surse: ['seap_completitudine'], detaliu: `v_ofertare_seap_completitudine.blocaj = ${JSON.stringify(b)} (nici NULL, nici text) — control indisponibil` })
    else emite({ id: 'DOC03', regula: 'DOC03', clasa: 'BLOCK', blocheaza_final: true, porti: ['pt', 'pachet'], domeniu: 'documente', aspect: null,
      titlu: 'Documentația de atribuire nu e completă și citită (R12)', cauza: `v_ofertare_seap_completitudine.blocaj: ${b}`,
      actiune_umana: actiune('deschide_documente', 'Deschide Documentația (esențialele necitite)', { licitatie_id: L }), tinta: { ecran: 'documente' },
      provenienta: { sursa: 'server', tabel: 'v_ofertare_seap_completitudine', detaliu: { text_sursa: b, esentiale: S.seap_completitudine.date.esentiale ?? null, esentiale_necitite: S.seap_completitudine.date.esentiale_necitite ?? null } } }, qSeap)
  }
  const qR5 = poarta('R5', SURSE_REGULI.R5)
  if (qR5) {
    const r = S.r5.date
    if (!('rezultat' in r)) indispControl.push({ regula: 'R5', surse: ['r5'], motiv: 'forma_invalida', detaliu: 'ofertare_r5_blocaj_sursa: rândul nu are câmpul rezultat' })
    else if (r.rezultat == null) emiteOk({ id: 'R5.ok', regula: 'R5', titlu: 'Sursa cantităților fără blocaj (R5, server)', provenienta: { sursa: 'server', tabel: 'ofertare_r5_blocaj_sursa()' } }, qR5)
    else if (typeof r.rezultat !== 'string' || !r.rezultat.trim()) indispControl.push({ regula: 'R5', surse: ['r5'], detaliu: `ofertare_r5_blocaj_sursa: rezultat = ${JSON.stringify(r.rezultat)} — control indisponibil` })
    else emite({ id: 'R5', regula: 'R5', clasa: 'BLOCK', blocheaza_final: true, porti: ['pachet', 'depunere'], domeniu: 'cantitati', aspect: null,
      titlu: 'Sursa cantităților are blocaj (R5)', cauza: `ofertare_r5_blocaj_sursa(${L}):${r.rezultat.startsWith(' ') ? '' : ' '}${r.rezultat}`,
      actiune_umana: actiune('deschide_cantitati', 'Deschide Cantități și validează pozițiile semnalate', { licitatie_id: L }), tinta: { ecran: 'cantitati' },
      provenienta: { sursa: 'server', tabel: 'ofertare_r5_blocaj_sursa()', detaliu: { text_sursa: r.rezultat } } }, qR5)
  }
  const qF9 = poarta('F9', SURSE_REGULI.F9)
  if (qF9) {
    const pe = new Map()
    const faraLic = [], altaLic = []
    for (const r of S.echipa_blocaje.date) {
      // fiecare rând de blocaj trebuie să fie, dovedit, al lui L; altfel NU se aruncă tăcut: F9 devine indisponibil (nu verde)
      if (!esteObiect(r) || r.licitatie_id == null) { faraLic.push(r); continue }
      if (r.licitatie_id !== L) { altaLic.push(r); continue }
      const fel = String(r.fel ?? 'necunoscut')
      if (!pe.has(fel)) pe.set(fel, [])
      pe.get(fel).push({ motiv: String(r.motiv ?? ''), detalii: { text_sursa: String(r.motiv ?? '') } })
    }
    if (faraLic.length || altaLic.length) indispControl.push({ regula: 'F9', surse: ['echipa_blocaje'], motiv: faraLic.length ? 'forma_invalida' : 'alta_licitatie',
      detaliu: `v_ofertare_pt_echipa_blocaje: ${[faraLic.length ? `${plural(faraLic.length, 'rând de blocaj fără', 'rânduri de blocaj fără')} licitatie_id` : '', altaLic.length ? `${plural(altaLic.length, 'rând de blocaj al', 'rânduri de blocaj ale')} altei licitații (${[...new Set(altaLic.map(r => r.licitatie_id))].join(', ')})` : ''].filter(Boolean).join(' și ')} — nu le putem atribui licitației ${L}; F9 nu poate fi „fără blocaje"` })
    if (!pe.size && !faraLic.length && !altaLic.length) emiteOk({ id: 'F9.ok', regula: 'F9', titlu: 'Echipa F9 fără blocaje (server)', provenienta: { sursa: 'server', tabel: 'v_ofertare_pt_echipa_blocaje' } }, qF9)
    for (const [fel, el] of pe) emite({ id: `F9:${fel}`, regula: 'F9', clasa: 'BLOCK', blocheaza_final: true, porti: ['f9'], domeniu: 'f9', aspect: null,
      titlu: `Echipa F9: ${plural(el.length, 'blocaj', 'blocaje')} „${fel}"`, cauza: `v_ofertare_pt_echipa_blocaje, fel='${fel}' — motivele sunt listate mai jos, fiecare.`,
      actiune_umana: actiune('deschide_f9', 'Deschide Echipa F9', { licitatie_id: L, fel }), tinta: { ecran: 'f9' },
      provenienta: { sursa: 'server', tabel: 'v_ofertare_pt_echipa_blocaje' }, elemente: el, grup: 'f9' }, qF9)
  }

  // ── 5.6 Controale preluate din evalueazaPoarta ─────────────────────────────────────────────
  let ev = null, st = null, cantInvalide = []
  const qCtrl = poartaTacuta(['pt_stare'])
  if (qCtrl) {
    st = { ...S.pt_stare.date }
    if (S.cantitati_nevalidate.utilizabila) {
      // campuriCantitatiNevalidate completează NULL / absent cu 0: întâi verificăm că fiecare contor există și e întreg ≥ 0
      const dc = S.cantitati_nevalidate.date
      cantInvalide = campuriInvalide(dc, { int: CAMPURI_CANTITATI })
      if (!Array.isArray(dc.totaluri_control)) cantInvalide.push(`totaluri_control ${'totaluri_control' in dc ? `= ${JSON.stringify(dc.totaluri_control)}` : '(lipsește)'} (se aștepta listă)`)
      if (cantInvalide.length) st.cantitati_nevalidate_indisponibil = `câmpuri lipsă / invalide: ${cantInvalide.join(', ')}`
      else Object.assign(st, campuriCantitatiNevalidate({ data: dc }))
    }
    if (S.e2_neconfirmate.utilizabila) st.cerinte_neconfirmate_cu_capitol = S.e2_neconfirmate.date.cerinte_neconfirmate_cu_capitol
    if (seapValid) Object.assign(st, { documentatie_verificata: true, documentatie_blocaj: S.seap_completitudine.date.blocaj, documentatie_esentiale: S.seap_completitudine.date.esentiale })
    ev = evalueazaPoarta(st)
    if (!ev) CTRL_MAPATE.forEach(k => marcheaza('pt_stare', `CTRL.${k}`))
  } else CTRL_MAPATE.forEach(k => marcheaza('pt_stare', `CTRL.${k}`))
  if (ev) {
    for (const k of CTRL_MAPATE) {
      const r = ev.randuri.find(x => x.k === k)
      const q = poarta(`CTRL.${k}`, k === 'cantitati' ? SURSE_REGULI['CTRL.cantitati'] : SURSE_REGULI.CTRL)
      if (!q) continue
      // forma câmpurilor pe care le citește controlul: absent / tip greșit → control indisponibil (nu îl evaluăm cu „|| 0")
      const rau = campuriInvalide(S.pt_stare.date, CAMPURI_CTRL[k]).map(x => `v_ofertare_pt_stare.${x}`)
      if (k === 'cantitati') rau.push(...cantInvalide.map(x => `v_ofertare_cantitati_nevalidate.${x}`))
      if (rau.length) { indispControl.push({ regula: `CTRL.${k}`, surse: k === 'cantitati' ? SURSE_REGULI['CTRL.cantitati'] : ['pt_stare'], motiv: 'forma_invalida',
        detaliu: `câmpuri lipsă sau invalide pentru controlul „${k}": ${rau.join('; ')} — controlul e indisponibil, nu „în regulă"` }); continue }
      if (!r || !['ok', 'warn', 'block'].includes(r.stare)) { indispControl.push({ regula: `CTRL.${k}`, surse: ['pt_stare'], detaliu: `evalueazaPoarta: rândul „${k}" lipsește sau are o stare necunoscută` }); continue }
      const [intent, et, ecran] = CTRL_ACTIUNE[k]
      const absentaObiect = r.stare === 'ok' && !!OK_PRIN_ABSENTA[k]?.(st)
      const listeNule = r.stare === 'ok' ? (CAMPURI_CTRL[k].lista || []).filter(c => S.pt_stare.date[c] === null) : []
      const absenta = absentaObiect || listeNule.length > 0
      if (r.stare === 'ok' && !absenta) { emiteOk({ id: `CTRL.${k}.ok`, regula: `CTRL.${k}`, titlu: `${r.titlu}: în regulă (regulă client)`, provenienta: { sursa: 'regula_client', tabel: 'v_ofertare_pt_stare' } }, q); continue }
      const clasa = r.stare === 'block' ? 'BLOCK' : (k === 'identitate' ? 'HUMAN_DECISION' : 'WARN')
      emite({ id: `CTRL.${k}`, regula: `CTRL.${k}`, clasa, blocheaza_final: clasa === 'BLOCK', porti: ['pt'], domeniu: 'controale', aspect: null,
        titlu: absenta ? `${r.titlu}: neevaluat — ${absentaObiect ? 'obiectul nu există încă' : `${listeNule.join(', ')} = NULL (necunoscut)`}` : r.titlu,
        cauza: absenta
          ? (absentaObiect
            ? `Regula client (evalueazaPoarta, rândul „${k}") întoarce „ok" doar pentru că nu are ce verifica. Lipsa informației nu e verde: rămâne neevaluat până există obiectul.`
            : `Regula client (evalueazaPoarta, rândul „${k}") întoarce „ok", dar ${listeNule.join(', ')} din v_ofertare_pt_stare ${listeNule.length === 1 ? 'e' : 'sunt'} NULL: nu putem deosebi „nimic găsit" de „necalculat" (array_agg fără rânduri dă tot NULL). Lipsa informației nu e verde: rămâne neevaluat.`)
          : `Regula client evalueazaPoarta (src/ofertarePoarta.js), rândul „${k}", peste v_ofertare_pt_stare citit la ${ora(q.citit_la)}. Textul regulii e mai jos.${k === 'identitate' ? ' Numele străine le clasifică omul (contaminare / experiență / referință / terț) — decizia B, fără blocaj.' : ''}`,
        actiune_umana: actiune(intent, et, { licitatie_id: L, control: k }), tinta: { ecran },
        provenienta: { sursa: 'regula_client', tabel: 'v_ofertare_pt_stare', detaliu: { text_sursa: r.detalii, stare_regula: r.stare } } }, q)
    }
  }

  // ── 5.7 Integritate ─────────────────────────────────────────────────────────────────────────
  if (S.pt_stare.utilizabila) {
    const sv = S.pt_stare.date
    const rec = {
      de_raspuns: () => M.U_PT.length, fara_capitol: () => F.length,
      dovada_de_verificat: () => M.U_PT.filter(c => { const f = M.stareDerivata.get(c.id); return f.propusa && !f.dovedita && !f.are_capitol && !f.exceptata }).length,
      cerinte_neverificate: () => N.length, capcane_descoperite: () => (capNull.length ? null : D.length),
      exceptate: () => M.U_PT.filter(c => { const f = M.stareDerivata.get(c.id); return f.exceptata && !f.are_capitol }).length,
      inchise_cu_dovada: () => M.U_PT.filter(c => { const f = M.stareDerivata.get(c.id); return f.dovedita && !f.are_capitol && !f.exceptata }).length,
      capitole: () => M.capitole.length, capitole_goale: () => (M.capitole.some(k => typeof k.continut_gol !== 'boolean') ? null
        : M.capitole.filter(k => k.obligatoriu !== false && k.stare !== 'nu_se_aplica' && k.continut_gol === true && k.are_fisier !== true).length),
      capitole_nescrise_de_om: () => (M.capitole.some(k => typeof k.continut_gol !== 'boolean') ? null
        : M.capitole.filter(k => k.obligatoriu !== false && k.stare !== 'nu_se_aplica' && k.continut_gol === false && (k.sursa ?? 'om') !== 'om').length),
      documente: () => S.documente.date.length,
      documente_necitite: () => S.documente.date.filter(d => typeof d.necitit_server === 'boolean' ? d.necitit_server
        : ((d.eroare != null && d.status_procesare !== 'procesat') || ['neprocesat', 'partial'].includes(d.status_procesare))).length,
    }
    for (const [col, surse, blocant] of PERECHI) {
      if (!surse.every(n => S[n]?.utilizabila)) continue
      if (!(M.legaturi || !surse.includes('legaturi'))) continue
      const r = rec[col](), s = sv[col]
      if (r == null) continue
      if (!Number.isInteger(s)) { M.int04.push({ motiv: `v_ofertare_pt_stare.${col} = ${JSON.stringify(s)} (nu e întreg) — comparația cu recalculul nu se poate face` }); continue }
      if (s === r) continue
      const esteBlocant = blocant === 'zero' ? (s === 0 && r > 0) : (blocant === true && s > r)
      M.int01.push({ blocant: esteBlocant, surse: ['pt_stare', ...surse], motiv: `v_ofertare_pt_stare.${col}: server ${s}, recalcul din rânduri ${r}${esteBlocant ? ' — serverul vede mai multe probleme decât lista: lista nu e completă' : ''}` })
    }
    // garda listă ↔ poartă pe cheile excluse
    const invalide = new Set(indispControl.map(c => c.regula))   // controlul echivalent e deja „indisponibil": nu-l mai numărăm și ca divergență
    if (ev) for (const [k, g] of Object.entries(GARDA_EXCLUSE)) {
      const r = ev.randuri.find(x => x.k === k)
      if (r?.stare !== 'block' || !g.surse.every(n => S[n]?.utilizabila) || g.sari.some(x => invalide.has(x))) continue
      const acoperit = exceptii.some(e => g.reguli.includes(e.regula) && e.blocheaza_final)
      if (!acoperit) M.int01.push({ blocant: true, surse: ['pt_stare', ...g.surse], motiv: `evalueazaPoarta blochează pe „${k}", dar regula echivalentă (${g.reguli.join(', ')}) n-a produs niciun blocaj — divergență listă ↔ poartă`,
        detalii: { text_sursa: r.detalii } })
    }
  } else marcheaza('pt_stare', 'INT01')
  for (const blocant of [true, false]) {
    const el = M.int01.filter(x => !!x.blocant === blocant)
    if (!el.length) continue
    const surse = [...new Set(el.flatMap(x => x.surse || []))]
    const q = poarta(`INT01`, surse.length ? surse : ['pt_stare']) || { calitate: 'proaspat', citit_la: acumIso }
    emite({ id: blocant ? 'INT01:blocant' : 'INT01:informativ', regula: 'INT01', clasa: blocant ? 'BLOCK' : 'WARN', blocheaza_final: blocant, porti: ['pt'],
      domeniu: 'integritate', aspect: null, titlu: blocant ? 'Divergență recalcul ↔ server: serverul vede mai mult decât lista' : 'Divergență recalcul ↔ server (informativ; s-a luat varianta mai puțin verde)',
      cauza: 'Aceleași mulțimi recalculate din rânduri și citite din view-uri / câmpuri server nu coincid. Nu alegem varianta convenabilă: se păstrează cea mai puțin verde și se arată diferența.',
      actiune_umana: actiune('recitire', 'Recitește toate sursele; dacă persistă, e o eroare de date de raportat', { licitatie_id: L }), tinta: { ecran: 'propunere' },
      provenienta: { sursa: 'mixt', tabel: 'v_ofertare_pt_stare' },
      elemente: el.map(({ blocant: _b, surse: _s, ...x }) => x) }, q)
  }
  if (M.int02.length) emite({ id: 'INT02', regula: 'INT02', clasa: 'WARN', blocheaza_final: false, porti: ['pt'], domeniu: 'integritate', aspect: null,
    titlu: `${plural(M.int02.length, 'rând ignorat', 'rânduri ignorate')} (altă licitație / orfane / candidați invalizi)`,
    cauza: 'Rândurile care nu aparțin licitației sau nu au părinte în datele citite nu intră în clasare; se arată aici ca să nu dispară tăcut.',
    actiune_umana: actiune('recitire', 'Recitește sursele', { licitatie_id: L }), tinta: { ecran: 'propunere' }, provenienta: { sursa: 'regula_client' },
    elemente: M.int02 }, calitateGlobala(S, acumIso))
  if (M.int04.length) emite({ id: 'INT04', regula: 'INT04', clasa: 'WARN', blocheaza_final: false, porti: ['pt'], domeniu: 'integritate', aspect: null,
    titlu: `${plural(M.int04.length, 'valoare invalidă sau contradictorie', 'valori invalide sau contradictorii')} (interpretate conservator)`,
    cauza: 'Câmpuri boolean care nu sunt boolean, verificări fără ștampile, acoperiri contradictorii: fiecare e interpretat în varianta cea mai puțin verde.',
    actiune_umana: actiune('recitire', 'Recitește sursele', { licitatie_id: L }), tinta: { ecran: 'propunere' }, provenienta: { sursa: 'regula_client' },
    elemente: dedupElemente(M.int04) }, calitateGlobala(S, acumIso))

  // PROSP01 — surse vechi (stale), dar încă nu expirate
  const stale = [...SURSE_OBLIGATORII, ...SURSE_OPTIONALE].filter(n => !SURSE_AFISARE.has(n) && S[n]?.utilizabila && S[n].calitate === 'stale')
  if (stale.length) {
    const cit = stale.map(n => S[n].citit_la).sort()[0]
    exceptii.push({ id: 'PROSP01', regula: 'PROSP01', clasa: 'WARN', blocheaza_final: false, porti: ['pt'], domeniu: 'prospetime', aspect: null,
      titlu: `Date vechi: ${plural(stale.length, 'sursă citită', 'surse citite')} acum mai mult de ${formatDurata(P.stale_ms)}`,
      cauza: `Datele pot fi depășite (${stale.map(n => `${TABEL_SURSA[n]}: ${formatDurata(S[n].varsta_ms)}`).join('; ')}). Recitește înainte de orice decizie; verdictul nu poate fi OK pe date vechi.`,
      actiune_umana: actiune('recitire', 'Recitește datele', { licitatie_id: L, surse: stale }), tinta: { licitatie_id: L, ecran: 'propunere' },
      provenienta: { sursa: 'regula_client', citit_la: cit }, numar: stale.length,
      elemente: stale.map(n => ({ motiv: `${TABEL_SURSA[n]}: citită acum ${formatDurata(S[n].varsta_ms)}` })), stale: true })
  }

  // INT05 — divergență față de J07 (doar dacă sursa există)
  // (se calculează după verdict, mai jos)

  // ── indisponibile ────────────────────────────────────────────────────────────────────────
  const indisponibile = []
  for (const n of [...SURSE_OBLIGATORII, ...SURSE_OPTIONALE]) {
    const s = S[n]
    if (!s.prezenta) continue
    if (s.utilizabila && (s.calitate !== 'expirat' || SURSE_AFISARE.has(n))) continue
    const reguli = [...(afectate.get(n) || [])].sort()
    indisponibile.push({ id: `IND:${n}:${s.motiv}`, sursa: n, motiv: s.motiv, detaliu: s.detaliu, reguli_afectate: reguli, blocheaza_final: true,
      actiune_umana: actiune('recitire', `Recitește ${TABEL_SURSA[n]}`, { licitatie_id: L, sursa: n }) })
  }
  // același control cu același motiv din mai multe cauze → un singur rând, cu toate cauzele
  const peControl = new Map()
  for (const c of indispControl) {
    const id = `IND:control:${c.motiv || 'control_invalid'}:${c.regula}`
    if (peControl.has(id)) { const x = peControl.get(id); x.detaliu = `${x.detaliu} · ${c.detaliu}`; x.actiune_umana.parametri.surse = [...new Set([...(x.actiune_umana.parametri.surse || []), ...(c.surse || [])])]; continue }
    peControl.set(id, { id, sursa: 'control', motiv: c.motiv || 'control_invalid', detaliu: c.detaliu, reguli_afectate: [c.regula], blocheaza_final: true,
      actiune_umana: actiune('recitire', 'Recitește sursele controlului', { licitatie_id: L, surse: c.surse }) })
  }
  indisponibile.push(...peControl.values())

  // ── verdict ──────────────────────────────────────────────────────────────────────────────
  exceptii.sort(cmpExceptie); ok.sort((a, b) => cmpStr(a.id, b.id)); indisponibile.sort((a, b) => cmpStr(a.sursa, b.sursa) || cmpStr(a.id, b.id))
  const toateOk = SURSE_OBLIGATORII.every(n => S[n].utilizabila && S[n].calitate === 'proaspat')
  const folosite = [...SURSE_OBLIGATORII, ...SURSE_OPTIONALE].filter(n => !SURSE_AFISARE.has(n) && S[n].utilizabila && S[n].citit_la).map(n => S[n].citit_la).sort()
  // lista „Necesită atenția ta" există doar dacă măcar o sursă obligatorie a putut fi folosită; altfel NU e „0 excepții"
  const listaConstruita = SURSE_OBLIGATORII.some(n => S[n].utilizabila)
  const argV = { ok, indisponibile, L, acumIso, P, toateOk, dateCapturate: folosite[0] ?? null, listaConstruita,
    motivLista: listaConstruita ? null : 'nicio sursă obligatorie n-a putut fi folosită (vezi Indisponibile)' }
  let verdict = construiesteVerdict({ exceptii, ...argV })
  if (S.j07.utilizabila && S.j07.calitate !== 'expirat') {
    // J07 mai sever decât simularea → BLOCK (se ia varianta mai puțin verde); mai permisiv → WARN de investigat
    const j = String(S.j07.date.stare ?? S.j07.date.verdict ?? '').toUpperCase()
    const rj = RANG_J07[j], rs = RANG_J07[verdict.stare]
    if (j && rj !== rs) {
      const maiSever = rj == null || rj > rs
      const jAfis = rj == null ? 'o stare necunoscută (tratată ca blocaj)' : j === 'READY' ? 'OK' : j
      exceptii.push({ id: 'INT05', regula: 'INT05', clasa: maiSever ? 'BLOCK' : 'WARN', blocheaza_final: maiSever, porti: ['pt'], domeniu: 'integritate', aspect: null,
        titlu: maiSever ? 'J07 (server) e mai sever decât simularea — se ia varianta mai puțin verde' : 'Verdictul simulat e mai sever decât J07 — de investigat',
        cauza: `J07 spune ${jAfis}, simularea spune ${verdict.stare}. ${maiSever ? 'Roșul serverului nu se slăbește: verdictul afișat devine BLOCKED.' : 'Simularea rămâne mai strictă.'} Afișarea rămâne SIMULATĂ; divergența se investighează.`,
        actiune_umana: actiune('recitire', 'Recitește J07 și sursele', { licitatie_id: L }), tinta: { licitatie_id: L, ecran: 'propunere' },
        provenienta: { sursa: 'server', tabel: 'ofertare_poarta_server()', citit_la: S.j07.citit_la }, ...(S.j07.calitate === 'stale' ? { stale: true } : {}) })
      exceptii.sort(cmpExceptie)
      verdict = construiesteVerdict({ exceptii, ...argV })
    }
  }
  return curata({ verdict, exceptii, ok, indisponibile })
}

function calitateGlobala(S, acumIso) {
  let cal = 'proaspat', cit = null
  for (const n of SURSE_OBLIGATORII) {
    const s = S[n]
    if (!s.utilizabila) continue
    if (RANG_CALITATE[s.calitate] > RANG_CALITATE[cal]) cal = s.calitate
    if (s.citit_la && (cit == null || s.citit_la < cit)) cit = s.citit_la
  }
  return { calitate: cal, citit_la: cit ?? acumIso }
}
const numaraPe = (el, f) => { const o = {}; for (const e of el) { const k = f(e); o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmpStr(a, b))) }
const dedupElemente = el => { const v = new Set(); return el.filter(e => { const k = JSON.stringify(e); if (v.has(k)) return false; v.add(k); return true }) }
const zi = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const ms = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); return Number.isFinite(ms) ? Math.floor(ms / 864e5) : null }
// logică SQL tri-valentă
const not3 = x => (x === null ? null : !x)
const and3 = (...xs) => (xs.includes(false) ? false : xs.includes(null) ? null : true)
const or3 = (...xs) => (xs.includes(true) ? true : xs.includes(null) ? null : false)

// §8 ordonare
function cmpExceptie(a, b) {
  const nrA = a.tinta?.capitol ? nrNumeric(a.tinta.capitol.nr) : Infinity, nrB = b.tinta?.capitol ? nrNumeric(b.tinta.capitol.nr) : Infinity
  const pA = a.porti?.length ? (RANG_POARTA[a.porti[0]] ?? 4) : 4, pB = b.porti?.length ? (RANG_POARTA[b.porti[0]] ?? 4) : 4
  return cmpNum(b.blocheaza_final ? 1 : 0, a.blocheaza_final ? 1 : 0) || cmpNum(RANG_CLASA[a.clasa], RANG_CLASA[b.clasa]) || cmpNum(pA, pB) || cmpNum(nrA, nrB) || cmpStr(a.id, b.id)
}
function cmpElement(a, b) {
  const idOf = e => e.cerinta_id ?? e.capitol_id ?? e.document_id ?? e.acoperire_id ?? e.legatura_id ?? null
  const na = a.nr_ordine ?? Infinity, nb = b.nr_ordine ?? Infinity
  const ia = idOf(a), ib = idOf(b)
  return cmpNum(na, nb) || (ia == null || ib == null ? 0 : cmpNum(ia, ib))
}

// §7 verdictul (algoritm exact)
function construiesteVerdict({ exceptii, ok, indisponibile, L, acumIso, P, toateOk, dateCapturate, listaConstruita = true, motivLista = null }) {
  const actuale = exceptii.filter(e => !e.din_date_expirate)
  const expirate = exceptii.filter(e => e.din_date_expirate)
  const stare = actuale.some(e => e.blocheaza_final) ? 'BLOCKED'
    : (indisponibile.length > 0 || expirate.length > 0) ? 'INDISPONIBIL'
    : exceptii.length > 0 ? 'WARN'
    : toateOk ? 'OK' : 'INDISPONIBIL'
  const cnt = cl => exceptii.filter(e => e.clasa === cl).length
  const contoare = { BLOCK: cnt('BLOCK'), HUMAN_DECISION: cnt('HUMAN_DECISION'), CONFIRM: cnt('CONFIRM'), WARN: cnt('WARN'),
    ok: ok.length, indisponibile: indisponibile.length, blocheaza_final: actuale.filter(e => e.blocheaza_final).length }
  const motive = (stare === 'BLOCKED' ? actuale.filter(e => e.blocheaza_final).map(e => e.id)
    : stare === 'INDISPONIBIL' ? [...indisponibile.map(i => i.id), ...expirate.map(e => e.id)]
    : stare === 'WARN' ? exceptii.map(e => e.id) : []).slice(0, 5)
  const numeInd = [...new Set(indisponibile.map(i => (i.sursa === 'control' ? `controlul ${i.reguli_afectate[0]}` : i.sursa === 'snapshot' ? 'snapshotul' : TABEL_SURSA[i.sursa] || i.sursa)))]
  const eticheta = stare === 'BLOCKED'
    ? `⛔ BLOCKED (${ETICHETA_SIMULAT}): ${plural(contoare.blocheaza_final, 'blocaj', 'blocaje')} · ${plural(indisponibile.length, 'sursă indisponibilă', 'surse indisponibile')}`
    : stare === 'INDISPONIBIL'
      ? `INDISPONIBIL (${ETICHETA_SIMULAT}): nu putem verifica ${numeInd.length ? numeInd.join(', ') : 'datele (citite pe date expirate)'}. Recitește`
      : stare === 'WARN'
        ? `⚠ WARN (${ETICHETA_SIMULAT}): ${plural(exceptii.length, 'excepție', 'excepții')} fără blocaj final. ${NEGATIE_GATA}.`
        : `OK (${ETICHETA_SIMULAT}): nicio excepție în sursele citite la ${ora(dateCapturate)}. ${NEGATIE_GATA}: semnătura, pachetul și porțile server (J02, R5, R12, fn_gate_depunere) decid.`
  // regulile care n-au putut fi evaluate, pe clasa pe care ar fi putut-o produce (ecranul nu arată „0" simplu pe ele)
  const neevaluate = [...new Set(indisponibile.flatMap(i => i.reguli_afectate).filter(r => r !== '*'))].sort()
  const peClasa = { BLOCK: [], HUMAN_DECISION: [], CONFIRM: [], WARN: [] }
  for (const r of neevaluate) for (const cl of CLASE_REGULI[r] || []) peClasa[cl].push(r)
  return { stare, simulat: true, sursa: ETICHETA_SIMULAT, calculat_la: acumIso, eticheta, nu_inseamna_gata_de_depus: true, licitatie_id: L,
    date_capturate_la: dateCapturate, praguri: { ...P }, contoare, motive,
    lista_construita: listaConstruita, lista_motiv: listaConstruita ? null : motivLista, reguli_neevaluate: neevaluate, neevaluate_pe_clasa: peClasa }
}

// ════════════════════════════════════════════════════════════════
// normalizeazaSnapshot — fixture-ul (meta + array-uri) → Snapshot (contract §2)
// ════════════════════════════════════════════════════════════════
export function normalizeazaSnapshot(fixture, { citit_la } = {}) {
  if (!esteObiect(fixture) || !esteObiect(fixture.meta)) throw new TypeError('fixture')
  const L = fixture.meta.licitatie_id
  const cap = fixture.meta.capturat_la ?? null
  const t = citit_la === undefined ? cap : citit_la
  const ok = date => ({ stare: 'ok', licitatie_id: L, citit_la: t, eroare: null, date })
  const lista = k => (Array.isArray(fixture[k]) ? ok(fixture[k]) : { stare: 'lipsa', licitatie_id: L, citit_la: null, eroare: `fixture fără „${k}"`, date: null })
  // view cu un singur rând: 0 rânduri = date null (→ forma_invalida în construiesteAtentia, nu „fără blocaj")
  const unu = k => (Array.isArray(fixture[k]) ? ok(fixture[k][0] ?? null) : { stare: 'lipsa', licitatie_id: L, citit_la: null, eroare: `fixture fără „${k}"`, date: null })
  return {
    versiune_format: 1,
    licitatie_id: L,
    capturat_la: cap,
    surse: {
      licitatie: unu('licitatie'), cerinte: lista('cerinte'), legaturi: lista('legaturi'), capitole: lista('capitole'),
      acoperire: lista('acoperire'), pt_dovezi: lista('ofertare_pt_dovezi'), documente: lista('documente'),
      documente_firma_valabilitate: Array.isArray(fixture.documente_firma_valabilitate) ? ok(fixture.documente_firma_valabilitate)
        : { stare: 'lipsa', licitatie_id: L, citit_la: null, eroare: 'nu e în fixture — citirea read-only a documente_firma (rândurile referite de acoperire.doc_firma_id) nu s-a făcut încă (decizia deschisă 6)', date: null },
      pt_stare: unu('v_ofertare_pt_stare'), seap_completitudine: unu('v_ofertare_seap_completitudine'), r5: unu('ofertare_r5_blocaj_sursa'),
      e2_neconfirmate: unu('v_ofertare_pt_cerinte_neconfirmate'), echipa_blocaje: lista('v_ofertare_pt_echipa_blocaje'),
      cantitati_nevalidate: unu('v_ofertare_cantitati_nevalidate'),
      j07: { stare: 'lipsa', licitatie_id: L, citit_la: null, eroare: 'ofertare_poarta_server() nu există în BD', date: null },
      capitole_versiuni: lista('capitole_versiuni'), poarta_pt: lista('ofertare_pt_poarta'), pachet: lista('ofertare_pt_pachet'),
    },
  }
}

// ════════════════════════════════════════════════════════════════
// construiesteCuprins — cuprinsul cu progres + workspace-ul pe capitol (pentru ecran)
// Aceleași predicate ca mai sus (construiesteModel). Sursă lipsă → disponibil:false, NICIODATĂ listă goală.
// ════════════════════════════════════════════════════════════════
export function construiesteCuprins(snapshot, opts = {}, rezultat = null) {
  const v = verificaIntrarea(snapshot, opts)
  if (v.gol) return null
  if (v.oprire) return { disponibil: false, motiv: v.oprire.detaliu, surse_lipsa: ['snapshot'] }
  const { acumMs, P, L } = v
  const S = analizeazaSurse(snapshot, L, acumMs, P)
  const nec = ['cerinte', 'legaturi', 'capitole']
  const lipsa = nec.filter(n => !S[n].utilizabila)
  if (lipsa.length) return { disponibil: false, surse_lipsa: lipsa,
    motiv: `Cuprinsul nu poate fi construit: ${lipsa.map(n => `${TABEL_SURSA[n]} (${S[n].motiv})`).join(', ')}. Nu afișăm o listă goală în loc.` }
  const cal = nec.map(n => S[n].calitate).sort((a, b) => RANG_CALITATE[b] - RANG_CALITATE[a])[0]
  const M = construiesteModel(S, L)
  // excepțiile pe cerință / capitol, din rezultatul deja calculat (o singură sursă de adevăr)
  const excCer = new Map(), excCap = new Map()
  for (const e of rezultat?.exceptii || []) {
    if (e.tinta?.capitol) { if (!excCap.has(e.tinta.capitol.id)) excCap.set(e.tinta.capitol.id, []); excCap.get(e.tinta.capitol.id).push(e.id) }
    for (const el of e.elemente || []) if (el.cerinta_id != null) { if (!excCer.has(el.cerinta_id)) excCer.set(el.cerinta_id, []); if (!excCer.get(el.cerinta_id).includes(e.id)) excCer.get(el.cerinta_id).push(e.id) }
  }
  const txt = t => (typeof t === 'string' ? t : null)
  const capitole = [...M.capitole].sort(cmpCapitol).map(k => {
    const leg = M.legaturi.filter(l => l.fel === 'capitol' && l.capitol_id === k.id && M.cerById.has(l.cerinta_id) && (l.capitol_licitatie_id === undefined || l.capitol_licitatie_id === L))
    const cer = []
    const prog = { total: 0, verificate_om: 0, verificate_alt_capitol: 0, candidati_ai: 0, atribuite_om: 0, blocate: 0, versiune_veche: 0, necunoscute: 0, inactive: 0 }
    const vazute = new Set()
    for (const l of [...leg].sort((a, b) => cmpNum(M.cerById.get(a.cerinta_id).nr_ordine ?? Infinity, M.cerById.get(b.cerinta_id).nr_ordine ?? Infinity) || cmpNum(a.id, b.id))) {
      const c = M.cerById.get(l.cerinta_id)
      if (!M.activa(c)) { prog.inactive++; continue }
      if (vazute.has(c.id)) continue
      vazute.add(c.id)
      const f = M.stareDerivata.get(c.id) || {}
      const cand = M.candidati.get(c.id)
      const valid = cand?.valizi?.slice().sort((a, b) => cmpStr(a.id, b.id))[0] || null
      const blocata = M.LgBrute(c).find(x => x.stare === 'blocata') || null
      const vv = l.stare === 'verificata' && Number.isInteger(l.verificat_la_versiunea) && l.verificat_la_versiunea !== k.versiune
      // starea e a LEGĂTURII spre acest capitol: „verificată de om" doar dacă legătura asta e verificată la versiunea curentă
      // (o verificare în alt capitol nu face verde răspunsul din capitolul ăsta)
      const verificataOm = M.legVerificata(l) && !blocata && (M.uptIds.has(c.id) ? f.verificata === true : true)
      const altaVerif = !verificataOm && !blocata ? M.Lg(c).find(x => x.id !== l.id && M.legVerificata(x)) : null
      const stare = blocata ? 'blocata' : verificataOm ? 'verificata_om' : vv ? 'versiune_veche' : altaVerif ? 'verificata_alt_capitol' : valid ? 'citat_candidat_ai'
        : l.sursa === 'ai' ? 'atribuita_ai' : l.sursa === 'om' ? 'atribuita_om' : 'atribuita_necunoscuta'
      prog.total++
      if (stare === 'verificata_om') prog.verificate_om++
      else if (stare === 'verificata_alt_capitol') prog.verificate_alt_capitol++
      else if (stare === 'blocata') prog.blocate++
      else if (stare === 'versiune_veche') prog.versiune_veche++
      else if (stare === 'atribuita_om') prog.atribuite_om++
      else if (stare === 'atribuita_necunoscuta') prog.necunoscute++
      else prog.candidati_ai++
      cer.push({ cerinta_id: c.id, nr_ordine: c.nr_ordine, tip: c.tip, text: txt(c.text_cerinta), text_trunchiat: e_trunchiat(c.text_cerinta),
        legatura_id: l.id, stare, sursa_legatura: l.sursa ?? null, principal: f.principal ? f.principal.id === k.id : false,
        ...(altaVerif ? { verificata_in_capitol: M.cap(altaVerif.capitol_id)?.nr ?? null } : {}),
        capcana: f.capcana ?? null, e2: 'e2_confirmata_de' in c ? (c.e2_confirmata_de != null ? 'confirmata' : 'neconfirmata') : null,
        candidat: valid ? candidatAfisare(valid) : null, candidat_invalid: cand?.invalizi?.length ? cand.invalizi.map(x => x.cauza) : null,
        constatare: blocata?.constatare ?? null, severitate: blocata?.severitate ?? null, verificat_la_versiunea: l.verificat_la_versiunea ?? null,
        confirmat_de: l.stare === 'verificata' ? (l.confirmat_de ?? null) : null, nota: txt(l.nota), exceptii: excCer.get(c.id) || [] })
    }
    return { id: k.id, nr: k.nr, titlu: k.titlu, versiune: k.versiune, sursa: k.sursa ?? null, obligatoriu: k.obligatoriu ?? null, blocat: k.blocat === true,
      stare_stocata: k.stare ?? null, continut_len: k.continut_len ?? null, continut_md5: k.continut_md5 ?? null, continut_gol: k.continut_gol ?? null,
      are_fisier: k.are_fisier ?? null, text: txt(k.continut), text_trunchiat: e_trunchiat(k.continut), progres: prog, cerinte: cer, exceptii: excCap.get(k.id) || [] }
  })
  const faraCapitol = M.U_PT.filter(c => !M.stareDerivata.get(c.id)?.are_capitol).map(c => {
    const f = M.stareDerivata.get(c.id)
    return { cerinta_id: c.id, nr_ordine: c.nr_ordine, tip: c.tip, text: txt(c.text_cerinta), text_trunchiat: e_trunchiat(c.text_cerinta), exceptata: f.exceptata === true,
      sursa_exceptie: M.Lg(c).find(l => l.fel === 'exceptat')?.sursa ?? null, motiv_exceptie: txt(M.Lg(c).find(l => l.fel === 'exceptat')?.motiv), exceptii: excCer.get(c.id) || [] }
  }).sort((a, b) => cmpNum(a.nr_ordine ?? Infinity, b.nr_ordine ?? Infinity))
  return curata({ disponibil: true, calitate: cal, licitatie_id: L, capitole, fara_capitol: faraCapitol })
}
