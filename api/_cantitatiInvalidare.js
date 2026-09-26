// ════════════════════════════════════════════════════════════════
// ofertareCantitatiInvalidare.js — CÂND o aprobare („validat") a unui rând din ofertare_cantitati nu mai e valabilă.
//
// Copilot (26.09.2026, condiția 1 a „aprobat = validat"): invalidarea nu privește doar cifra. O schimbare relevantă a unității,
// a diametrului (Dn), a materialului, a SDR-ului, a tronsonului / etapei (obiectul) sau a sursei aplicabile face aprobarea
// anterioară nevalabilă chiar dacă lungimea rămâne identică. Valoarea și aprobarea veche se păstrează în ISTORIC.
//
// Regula (aceeași în BD — trigger-ul propus în docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql — și în aplicație):
//   rândul e 'validat' și o scriere schimbă RELEVANT oricare dintre CAMPURI_APROBARE ⇒ status 'diferenta' („de reverificat”),
//   cu nota „Rândul era VALIDAT — aprobarea veche (…) nu mai e valabilă: s-a schimbat …”. O validare explicită ulterioară
//   (UPDATE doar pe status, bifa ✓) rămâne posibilă — și e singurul drum înapoi în 'validat'.
//   - cifrele (cantitate, cifra din planșă): diferență ≥ 1 m pe unitățile de lungime (m / ml / fără unitate), orice diferență pe
//     celelalte; apariția / dispariția cifrei contează. Cifra din planșă se compară EFECTIV (cantitate_plansa, altfel cantitate),
//     exact ca `cifraSchimbata` din transferul planșei și din citirea CAD: prima cifră din planșă egală cu memoriul nu e o schimbare;
//   - textele (denumire — unde stau Dn / material / SDR / tronsonul —, specificații, obiect, categorie, sursa, tip_sursa,
//     cod_articol): orice schimbare după normalizare (spații — și cele Unicode, ca NBSP —, majuscule; `normText`, identic în SQL);
//   - unitatea de măsură (um): runda 6 (decis în audit 26.09.2026 pe principiile Copilot, reversibil) — comparată NORMALIZAT
//     (`normUm` = `normText`: spații — și NBSP —, trim, lower; SQL: public.ofertare_norm_text), ca „m” → „M” / „m ” să nu
//     invalideze (se raportează sub prag), dar „m” → „ml” da. Filtrele de rețea folosesc ACEEAȘI normalizare (randuriFront,
//     v_ofertare_cantitati_nevalidate, v6); v_ofertare_pt_stare.qm (live, neatins) cere încă exact 'm' — rândurile de rețea cu
//     unitatea scrisă altfel sunt SEMNALATE în view (um_de_normalizat_*) și în H2, nu scăzute tacit din totaluri;
//   - un rând NEAPROBAT care își schimbă unitatea din / în „m” (normalizat) iese / intră în rețea: nu invalidează (n-are aprobare),
//     dar nu dispare tacit din semnalul de lipsă — istoric 'unitate_schimbata' (trigger) și, până la migrare, prefixul notei
//     „Unitatea s-a schimbat (…) — … de reverificat.” (`aplicaRegulaUnitate`, păstrat de transfer / CAD ca prefixul invalidării);
//   - schimbările SUB PRAG (ex. 5.245 → 5.245,4 m) nu invalidează, dar se raportează (în BD: rând de istoric „modificat_sub_prag”).
//   - runda 5 (MAJOR verificator): pragul se măsoară față de valoarea APROBATĂ (a ultimei validări, din istoric), nu față de
//     valoarea de dinainte de scriere: altfel pași mici cumulați (5 × 0,99 m) mutau cifra fără ca nimeni s-o fi aprobat.
//     `referinta` = rândul de la validare (`referinteDinIstoric`); fără istoric (migrarea neaplicată) = rândul de acum.
// Dn / material / SDR nu au coloane proprii: se citesc din denumire + specificații doar ca să NUMEASCĂ schimbarea în notă.
//
// COPII IDENTICE (ține-le la fel; testul src/ofertareCantitatiInvalidare.test.js compară octet cu octet):
//   src/ofertareCantitatiInvalidare.js (UI, 📋 Cantități) · api/_cantitatiInvalidare.js (citirea CAD, Vercel) ·
//   supabase/functions/ofertare-plansa-citeste/invalidare.js (transferul din planșă; deploy-ul pe folder nu garantează ../_shared).
// Funcții PURE, fără dependențe.
// ════════════════════════════════════════════════════════════════

export const STATUS_VALIDAT = 'validat'
export const STATUS_DE_REVERIFICAT = 'diferenta'
export const TOLERANTA_LUNGIME_M = 1
// ordinea = ordinea din notă
export const CAMPURI_APROBARE = ['licitatie_id', 'um', 'cantitate', 'cantitate_plansa', 'denumire', 'specificatii', 'obiect', 'categorie', 'tip_sursa', 'sursa', 'cod_articol']
export const ETICHETE_CAMP = {
  licitatie_id: 'licitația', um: 'unitatea de măsură', cantitate: 'cantitatea', cantitate_plansa: 'cifra din planșă',
  denumire: 'denumirea', specificatii: 'specificațiile', obiect: 'obiectul (tronson / etapă)', categorie: 'categoria',
  tip_sursa: 'tipul sursei', sursa: 'sursa', cod_articol: 'codul articolului (poziția din listă)',
  dn: 'Dn', material: 'materialul', sdr: 'SDR',
}
export const PREFIX_INVALIDARE = 'Rândul era VALIDAT — aprobarea veche'

const CIFRE = new Set(['cantitate', 'cantitate_plansa'])
// spațiile Unicode (NBSP, thin space …) devin spațiu, apoi spațiile ASCII se comasează — IDENTIC cu public.ofertare_norm_text (SQL)
const SPATII_UNICODE = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g
export const normText = v => (v == null ? '' : String(v).replace(SPATII_UNICODE, ' ').replace(/[ \t\n\v\f\r]+/g, ' ').replace(/^ | $/g, '').toLowerCase())
const numar = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
// runda 6: unitatea NORMALIZATĂ (aceeași funcție ca textele; SQL: ofertare_norm_text) — și în filtrele de rețea
export const normUm = v => normText(v)
export const esteUnitateLungime = um => um == null || ['m', 'ml', ''].includes(normUm(um))
export const toleranta = um => (esteUnitateLungime(um) ? TOLERANTA_LUNGIME_M : 0)
// a / b: numere sau null. Apariția / dispariția cifrei e mereu o schimbare.
export function cifraDiferita(a, b, tol) {
  if ((a === null) !== (b === null)) return true
  if (a === null) return false
  return tol > 0 ? Math.abs(a - b) >= tol : a !== b
}
export const fmtRo = v => {
  const n = numar(v)
  return n === null ? '—' : (+n.toFixed(2)).toLocaleString('ro-RO', { maximumFractionDigits: 2 })
}

// Dn / material / SDR din denumire + specificații (doar pentru a numi schimbarea; aceleași expresii ca în trigger-ul SQL).
// Toate valorile găsite, unice, în ordinea apariției („Tub PE80 SDR17 (Dn315) pentru conductă Dn250” → Dn „315/250”).
const unice = xs => [...new Set(xs)].join('/') || null
export function atributeTehnice(r) {
  const t = `${r?.denumire || ''} ${r?.specificatii || ''}`
  const dn = unice([...t.matchAll(/(?:\bdn|\bde|ø|φ)\s*(\d{2,4})(?!\d)/gi)].map(m => m[1]))
  const sdr = unice([...t.matchAll(/\bsdr\s*(\d+(?:[.,]\d+)?)/gi)].map(m => m[1].replace(',', '.')))
  const pe100 = /\bpe\s*-?\s*100(?!\d)/i.test(t), pe80 = /\bpe\s*-?\s*80(?!\d)/i.test(t)
  const material = unice([pe100 && 'PE100', pe80 && 'PE80', !pe100 && !pe80 && /\b(pehd|pe)\b/i.test(t) && 'PE', /\bol\b|o[țţt]el/i.test(t) && 'OL'].filter(Boolean))
  return { dn, material, sdr }
}

// Ce schimbă `patch` pe rândul `vechi` (doar câmpurile din CAMPURI_APROBARE prezente în patch și diferite de `vechi`).
// `referinta` (opțional) = rândul APROBAT (de la ultima validare, `referinteDinIstoric`): relevanța se măsoară față de el, ca pașii
// mici cumulați să nu ocolească pragul; fără ea, față de `vechi` (ca înainte). `vechi` din fiecare schimbare relevantă = valoarea aprobată.
// → { relevante: [{camp, eticheta, vechi, nou}], subPrag: [...], derivate: [{camp: 'dn'|'material'|'sdr', …}] }
export function schimbariRelevante(vechi, patch, referinta = null) {
  const v = vechi || {}, p = patch || {}, ref = referinta || v
  const nou = { ...v, ...p }
  const tol = toleranta(nou.um)
  const relevante = [], subPrag = []
  const efectiva = r => numar(r.cantitate_plansa ?? r.cantitate)
  for (const camp of CAMPURI_APROBARE) {
    if (!(camp in p)) continue
    const a = v[camp], b = nou[camp], r = ref[camp]
    let distinct, relevant
    if (camp === 'licitatie_id') { distinct = numar(a) !== numar(b); relevant = numar(r) !== numar(b) }
    else if (CIFRE.has(camp)) {
      distinct = numar(a) !== numar(b)
      relevant = camp === 'cantitate'
        ? cifraDiferita(numar(r), numar(b), tol)
        // cifra din planșă EFECTIVĂ (ca `referintaCitire` / `cifraSchimbata`)
        : numar(r) !== numar(b) && cifraDiferita(efectiva(ref), efectiva(nou), tol)
    } else if (camp === 'um') {
      // runda 6: normalizat (trim + lower + spații Unicode): „m” → „M” = sub prag; „m” → „ml” = relevant
      distinct = (a ?? '') !== (b ?? ''); relevant = normUm(r) !== normUm(b)
    } else {
      distinct = (a ?? '') !== (b ?? '')
      relevant = normText(r) !== normText(b)
    }
    if (!distinct) continue
    const x = { camp, eticheta: ETICHETE_CAMP[camp], vechi: (relevant ? r : a) ?? null, nou: b ?? null };
    (relevant ? relevante : subPrag).push(x)
  }
  const derivate = []
  if (relevante.some(x => x.camp === 'denumire' || x.camp === 'specificatii')) {
    const ta = atributeTehnice(ref), tb = atributeTehnice(nou)
    for (const k of ['dn', 'material', 'sdr']) if ((ta[k] || null) !== (tb[k] || null)) derivate.push({ camp: k, eticheta: ETICHETE_CAMP[k], vechi: ta[k], nou: tb[k] })
  }
  return { relevante, subPrag, derivate }
}

const scurt = (s, n = 60) => { const t = String(s ?? '—'); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const valoare = (x, v) => (CIFRE.has(x.camp) ? `${fmtRo(v)}${v == null ? '' : ' m'}` : x.camp === 'licitatie_id' ? `#${v ?? '—'}` : `„${scurt(v ?? '—')}”`)
export function descrieSchimbari({ relevante, derivate }) {
  const d = (derivate || []).map(x => `${x.eticheta} ${x.vechi ?? '—'} → ${x.nou ?? '—'}`)
  const c = (relevante || []).map(x => `${x.eticheta} (${valoare(x, x.vechi)} → ${valoare(x, x.nou)})`)
  return [...d, ...c].join('; ')
}
// momentul în UTC, „AAAA-LL-ZZ HH:MM” (ca to_char(… AT TIME ZONE 'UTC') din SQL), oricare ar fi fusul din text
const momentUtc = t => { const d = new Date(t); return Number.isNaN(d.getTime()) ? String(t).slice(0, 16).replace('T', ' ') : d.toISOString().slice(0, 16).replace('T', ' ') }
export function descrieAprobareaVeche(v) {
  const p = [`cantitate ${fmtRo(v?.cantitate)}${v?.cantitate == null ? '' : ' ' + (v?.um || 'm')}`]
  if (v?.cantitate_plansa != null) p.push(`cifra din planșă ${fmtRo(v.cantitate_plansa)} m`)
  if (v?.updated_at) p.push(`ultima scriere ${momentUtc(v.updated_at)}`)
  return p.join(', ')
}
// Orice prefix de invalidare pune o regulă („Rândul era VALIDAT — aprobarea veche (…) …” sau „Rândul era VALIDAT cu … —”, al
// transferului / CAD) se termină cu „validarea se reface.” — acolo se taie (SQL: aceeași regulă, în trigger).
const FINAL_PREFIX = 'validarea se reface.'
export const prefixInvalidare = nota => {
  const s = String(nota ?? '')
  if (!s.startsWith('Rândul era VALIDAT')) return ''
  const i = s.indexOf(FINAL_PREFIX)
  return i < 0 ? '' : s.slice(0, i + FINAL_PREFIX.length)
}
// scoate un prefix de invalidare anterior (să nu se adune la fiecare ciclu validare → schimbare)
export const faraPrefixVechi = nota => { const s = String(nota ?? ''), pre = prefixInvalidare(s); return pre ? s.slice(pre.length).replace(/^ +/, '') : s }
export function notaInvalidare(aprobat, sch, notaNoua) {
  return `${PREFIX_INVALIDARE} (${descrieAprobareaVeche(aprobat)}) nu mai e valabilă: s-a schimbat ${descrieSchimbari(sch)}. ` +
    `Valoarea și aprobarea veche rămân în istoric; validarea se reface. ` + faraPrefixVechi(notaNoua)
}

// Regula la nivel de aplicație (pereche cu trigger-ul din BD, ca protecția să nu depindă doar de el):
// rând 'validat' + patch care schimbă relevant un atribut (față de valoarea APROBATĂ, `referinta`) ⇒ patch cu status 'diferenta'
// și nota de invalidare. Un patch care pune el însuși alt status (ex. transferul care a scris deja „Rândul era VALIDAT cu …”)
// se lasă cum e.  → { patch, invalidat: bool, schimbari }
export function aplicaRegulaAprobare(vechi, patch, referinta = null) {
  const sch = schimbariRelevante(vechi, patch, referinta)
  if (vechi?.status !== STATUS_VALIDAT || !sch.relevante.length) return { patch, invalidat: false, schimbari: sch }
  if (patch && 'status' in patch && patch.status !== STATUS_VALIDAT) return { patch, invalidat: true, schimbari: sch }
  const notaNoua = patch && 'diferenta_nota' in patch ? patch.diferenta_nota : vechi.diferenta_nota
  return { patch: { ...patch, status: STATUS_DE_REVERIFICAT, diferenta_nota: notaInvalidare(referinta || vechi, sch, notaNoua) }, invalidat: true, schimbari: sch }
}

// ── R5 runda 5 (verificator, MAJOR 1): starea „invalidat” nu depinde de textul notei ──
// Un rând scos din „validat” de regulă (sau redeschis) rămâne „invalidat” până la o validare nouă, oricine i-ar rescrie apoi nota
// (transferul din planșă și citirea CAD rescriu nota oricărui rând nevalidat). Două surse, aceeași regulă ca view-ul
// v_ofertare_cantitati_nevalidate: (1) ISTORICUL — ultimul eveniment al rândului e 'invalidat' / 'redeschis' (fără 'validat' după
// el); (2) până la aplicarea migrării, prefixul notei — pe care transferul și CAD îl PĂSTREAZĂ acum (`pastreazaInvalidarea`).
// runda 6: + 'unitate_schimbata' (rând NEAPROBAT a cărui unitate normalizată a ieșit din / intrat în „m”; nu atinge aprobarea).
export const MOTIVE_ISTORIC = ['validat', 'invalidat', 'redeschis', 'modificat_sub_prag', 'sters', 'unitate_schimbata']
// ordinea de citire nu contează (desc / paginat): se sortează aici crescător după id
const evenimenteValide = ev => (ev || []).filter(e => e && e.cantitate_id != null && MOTIVE_ISTORIC.includes(e.motiv))
  .sort((a, b) => Number(a.id) - Number(b.id))
// ultimul eveniment din `motive`, pe rând → Map(cantitate_id → motiv)
const ultimulDin = (evenimente, motive) => {
  const ultim = new Map()
  for (const e of evenimenteValide(evenimente)) if (motive.includes(e.motiv)) ultim.set(Number(e.cantitate_id), e.motiv)
  return ultim
}
// → Set(cantitate_id) cu ultimul eveniment al APROBĂRII 'invalidat' / 'redeschis' (runda 6: 'unitate_schimbata' nu șterge starea —
// un rând invalidat căruia i se schimbă apoi unitatea rămâne invalidat; SQL: același filtru pe motiv în view și v6)
export function invalidateDinIstoric(evenimente) {
  const ultim = ultimulDin(evenimente, ['validat', 'invalidat', 'redeschis', 'modificat_sub_prag', 'sters'])
  return new Set([...ultim].filter(([, m]) => m === 'invalidat' || m === 'redeschis').map(([id]) => id))
}
// → Set(cantitate_id) cu o schimbare de unitate (din / în „m”) după ultima validare (runda 6; SQL: același criteriu)
export function unitateSchimbataDinIstoric(evenimente) {
  const ultim = ultimulDin(evenimente, ['validat', 'unitate_schimbata'])
  return new Set([...ultim].filter(([, m]) => m === 'unitate_schimbata').map(([id]) => id))
}
// Valoarea APROBATĂ a fiecărui rând (referința regulii; identic cu trigger-ul): rândul de la ULTIMA validare înregistrată
// ('validat', valori_noi = rândul întreg); fără validare înregistrată (rând validat înainte de migrare) = rândul dinaintea PRIMEI
// scrieri înregistrate (valori_vechi — rândul era validat). Fără evenimente: lipsă (se folosește rândul de acum).
// → Map(cantitate_id → rând)
export function referinteDinIstoric(evenimente) {
  const per = new Map()
  for (const e of evenimenteValide(evenimente)) {
    const k = Number(e.cantitate_id), x = per.get(k) || {}
    if (e.motiv === 'validat') { if (e.valori_noi) x.validare = e.valori_noi }
    // 'unitate_schimbata' e scris pe un rând NEVALIDAT: nu e o aprobare, nu poate fi referință
    else if (e.motiv !== 'unitate_schimbata' && !x.prim && e.valori_vechi) x.prim = e.valori_vechi
    per.set(k, x)
  }
  const out = new Map()
  for (const [k, x] of per) if (x.validare || x.prim) out.set(k, x.validare || x.prim)
  return out
}
// ── runda 6: unitatea schimbată pe un rând NEAPROBAT (semnal până la aplicarea migrării; după ea, istoricul 'unitate_schimbata') ──
export const PREFIX_UNITATE = 'Unitatea s-a schimbat'
const FINAL_UNITATE = 'de reverificat.'
export const prefixUnitate = nota => {
  const s = String(nota ?? '')
  if (!s.startsWith(PREFIX_UNITATE)) return ''
  const i = s.indexOf(FINAL_UNITATE)
  return i < 0 ? '' : s.slice(0, i + FINAL_UNITATE.length)
}
const faraPrefixUnitate = nota => { const s = String(nota ?? ''), pre = prefixUnitate(s); return pre ? s.slice(pre.length).replace(/^ +/, '') : s }
// schimbarea de unitate care contează: normalizat diferit și una din ele e „m” (rândul iese din / intră în rețea)
export const unitateIeseDinRetea = (vechiUm, nouUm) => normUm(vechiUm) !== normUm(nouUm) && (normUm(vechiUm) === 'm' || normUm(nouUm) === 'm')
export function notaUnitate(vechiUm, nouUm, notaNoua) {
  const u = v => `„${v == null || v === '' ? '—' : v}”`
  return `${PREFIX_UNITATE} (${u(vechiUm)} → ${u(nouUm)})` + (normUm(nouUm) === 'm' ? '' : ' — rândul nu mai e o lungime de rețea în metri') +
    `; ${FINAL_UNITATE} ` + faraPrefixUnitate(notaNoua)
}
// Rând NEAPROBAT (validatul trece prin aplicaRegulaAprobare) + patch care schimbă unitatea din / în „m” (fără să-l valideze) =>
// nota primește prefixul „Unitatea s-a schimbat (…) … de reverificat.”  → { patch, unitate: bool }
export function aplicaRegulaUnitate(vechi, patch) {
  if (!patch || !('um' in patch) || vechi?.status === STATUS_VALIDAT || patch.status === STATUS_VALIDAT) return { patch, unitate: false }
  if (!unitateIeseDinRetea(vechi?.um, patch.um)) return { patch, unitate: false }
  const notaNoua = 'diferenta_nota' in patch ? patch.diferenta_nota : vechi?.diferenta_nota
  return { patch: { ...patch, diferenta_nota: notaUnitate(vechi?.um, patch.um, notaNoua).trim() }, unitate: true }
}
// prefixele de la începutul notei (invalidare și / sau unitate, în orice ordine)
const prefixeleNotei = nota => {
  let s = String(nota ?? ''), pre = []
  for (let i = 0; i < 2; i++) {
    const p = prefixInvalidare(s) || prefixUnitate(s)
    if (!p) break
    pre.push(p); s = s.slice(p.length).replace(/^ +/, '')
  }
  return pre.join(' ')
}
// Transferul / CAD rescriu nota unui rând NEVALIDAT: dacă rândul fusese invalidat (prefixul regulii) sau își schimbase unitatea
// (runda 6, prefixul unității), prefixele rămân în față.
export function pastreazaInvalidarea(vechi, patch) {
  if (!patch || !('diferenta_nota' in patch) || vechi?.status === STATUS_VALIDAT || patch.status === STATUS_VALIDAT) return patch
  const pre = prefixeleNotei(vechi?.diferenta_nota)
  const nou = String(patch.diferenta_nota ?? '')
  if (!pre || nou.startsWith('Rândul era VALIDAT') || nou.startsWith(PREFIX_UNITATE)) return patch
  return { ...patch, diferenta_nota: `${pre} ${patch.diferenta_nota ?? ''}`.trim() }
}

// ── runda 6 (verificatorul rundei 5, minor „istoric fără paginare”): citirea completă, pe pagini ──
// `pagina(from, to)` = o cerere PostgREST cu .range(from, to) (ordonată DESCRESCĂTOR după id, ca cele mai noi evenimente — ultima
// validare / invalidare — să vină primele). Se avansează cu câte rânduri au VENIT (un plafon db-max-rows mai mic decât `pas` nu sare
// rânduri) și se oprește la o pagină goală; peste `max` rânduri => eroare („istoric trunchiat”), ca apelantul să nu ia o listă
// tăiată drept completă.  → { data, error }
export async function citestePaginat(pagina, pas = 1000, max = 100000) {
  const out = []
  while (out.length <= max) {
    const { data, error } = await pagina(out.length, out.length + pas - 1)
    if (error) return { data: null, error }
    if (!data || !data.length) return { data: out, error: null }
    out.push(...data)
  }
  return { data: null, error: { message: `istoric trunchiat (peste ${max} evenimente)` } }
}
