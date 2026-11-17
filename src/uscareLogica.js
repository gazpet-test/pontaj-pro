// ═══════════════════════════════════════════════════════════════════════════
// uscareLogica.js — logica PURĂ a raportului de uscare a conductei (Execuție → proiect → „💨 Uscare conductă”, migrarea 20261225a).
// O singură definiție (L19) pentru: listele contractului cu serverul (câmpurile, ce cere închiderea, fotografiile cerute, tranzițiile,
// categoriile de poze — testul de paritate le compară cu blocurile marcate din migrare, iar proba PGlite compară regulile pe cazuri),
// calculele (durata, viteza medie, diferența de greutate a buretelui, verificarea celor 24 h), ora României (Europe/Bucharest, L17, inclusiv
// ora care apare de două ori la trecerea la ora de iarnă), formularul (text pe ecran ↔ valori trimise la RPC), îmbinarea la conflict
// (pe câmpuri, explicit) și poziția operațiunii (GPS / traseu / manual).
// Criteriul de acceptare din caietul de sarcini (cap. 4.1.8.5): „ultimul piston vehiculat iese uscat”. Pragurile pentru punctul de rouă și
// pentru diferența de greutate a buretelui NU sunt date: nu se calculează nimic din ele; concluzia o pune omul.
// ═══════════════════════════════════════════════════════════════════════════

import { parseNumar, textNr, areMaxZecimale } from './izoDocumenteLogica.js'
import { parseKm } from './probeTronsoaneLogica.js'
import { fmtKm, cumulat, haversine } from './lib/izoKml.js'
// registrul cererilor nelămurite (L05) și clasificarea răspunsurilor: aceleași ca la probele pe tronsoane (L19)
export { clasificaReluare, esteRefuzDeterminist, registruNou, aceeasiIntentie } from './probeTronsoaneLogica.js'
export { fmtKm, parseKm }

// ── contractul cu serverul (paritate cu 20261225a) ──
/** cheile EXACTE ale lui p_date (CAMPURI-START … CAMPURI-END din migrare), în aceeași ordine */
export const CAMPURI = ['proba_id', 'tronson', 'km_de_la_m', 'km_pana_la_m', 'lungime_m', 'inceput_planificat', 'notificare_la', 'notificare_ref',
  'data_operatie', 'ora_inceput', 'ora_final', 'poz_lat', 'poz_lng', 'poz_sursa', 'poz_precizie_m', 'poz_la', 'poz_km_m',
  'poz_traseu_versiune', 'temperatura_c', 'temperatura_sursa', 'meteo', 'vreme', 'constructor', 'utilaje', 'pig_metalic_buc',
  'piston_pu_buc', 'bureti_buc', 'cantariri', 'punct_roua_c', 'punct_roua_loc', 'presiune_bar', 'timp_deplasare_min',
  'piston_final_rezultat', 'poze_justificare', 'observatii', 'concluzie', 'semn_constructor_nume', 'semn_constructor_functie',
  'semn_beneficiar_nume', 'semn_beneficiar_functie']
/** ce cere închiderea (OBLIGATORII-START … -END din fn_executie_uscare_lipsa), în ordinea modelului */
export const OBLIGATORII = ['data_operatie', 'lungime_m', 'temperatura_c', 'constructor', 'utilaje', 'ora_inceput', 'ora_final', 'pistoane',
  'cantariri', 'presiune_bar', 'timp_deplasare_min', 'piston_final_rezultat', 'concluzie', 'dovada_conform', 'poze_justificare',
  'incarcari_nelamurite']
export const ETICHETE_OBLIGATORII = {
  data_operatie: 'data operației', lungime_m: 'lungimea', temperatura_c: 'temperatura exterioară', constructor: 'constructorul',
  utilaje: 'utilajele (cel puțin unul)', ora_inceput: 'ora de început', ora_final: 'ora de final', pistoane: 'configurația pistoanelor (toate trei)',
  cantariri: 'cântărirea fiecărui burete declarat (intrare și ieșire, sau „nu se aplică” cu motiv)',
  presiune_bar: 'presiunea în spatele buretelui', timp_deplasare_min: 'timpul de deplasare',
  piston_final_rezultat: 'rezultatul ultimului piston vehiculat (uscat / umed)', concluzie: 'concluzia (conform / neconform)',
  dovada_conform: 'dovada pentru CONFORM: ultimul piston „uscat” și fotografia lui',
  poze_justificare: 'justificarea fotografiilor cerute care lipsesc', incarcari_nelamurite: 'încărcările de fotografii nelămurite (înregistrează sau renunță)',
}
/** fotografiile cerute pe raport, în afara cântăririlor (POZE-CERUTE-START … -END din fn_executie_uscare_poze_lipsa) */
export const POZE_CERUTE = ['manometru', 'temperatura', 'pistoane']
/** tranzițiile (TRANZITII-START … -END din fn_executie_uscare_tranzitie): [stare veche, acțiune, stare nouă] */
export const TRANZITII = [['deschisa', 'inchide', 'inchisa'], ['inchisa', 'redeschide', 'deschisa'], ['deschisa', 'anuleaza', 'anulata']]
export const stareDupa = (veche, actiune) => (TRANZITII.find(([v, a]) => v === veche && a === actiune) || [])[2] || null
export const actiuniPermise = veche => TRANZITII.filter(([v]) => v === veche).map(([, a]) => a)
export const ETICHETE_STARE = { deschisa: 'Deschis (se completează)', inchisa: 'Închis', anulata: 'Anulat' }
export const CULORI_STARE = { deschisa: '#58A6FF', inchisa: '#3FB950', anulata: '#8B949E' }
/** categoriile pozelor (CATEGORII-START … -END din migrare; aceleași la rezervări) */
export const CATEGORII = ['manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'piston_final', 'punct_roua', 'utilaje', 'altele']
export const ETICHETE_CATEGORII = {
  manometru: 'Manometru (presiunea)', temperatura: 'Temperatura exterioară', pistoane: 'Configurația pistoanelor', cantar_intrare: 'Cântar la intrare',
  cantar_iesire: 'Cântar la ieșire', piston_final: 'Ultimul piston vehiculat', punct_roua: 'Punctul de rouă', utilaje: 'Utilaje / echipamente', altele: 'Altele',
}
export const CU_BURETE = ['cantar_intrare', 'cantar_iesire']
export const RPC_USCARE = ['fn_executie_uscare_salveaza', 'fn_executie_uscare_stare', 'fn_executie_uscare_poza']
/** „Renunț” la o cerere nelămurită: întreabă serverul după cheie; neaplicată = retrasă definitiv (nu e o intenție, nu intră în registru) */
export const RPC_RETRAGE = 'fn_executie_uscare_retrage'
export const prefixRegistru = (utilizator, proiect) => `gazpet.uscare.incert.v2:${utilizator}:${proiect}:`
export const MAX_BURETI = 20

// ── ora României (L17: Europe/Bucharest, nu fusul telefonului și nu un decalaj fix) ──
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
function partiBuc(ms) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}
const pad = n => String(n).padStart(2, '0')
/** moment (ISO / ms) → „AAAA-LL-ZZTHH:MM” în ora României (pentru <input type="datetime-local">); gol / invalid → '' */
export function oraLocalaDinIso(v) {
  if (v == null || v === '') return ''
  const ms = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(ms)) return ''
  const p = partiBuc(ms)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
}
/** marcajul orei locale care apare de două ori (trecerea la ora de iarnă: 03:00–03:59 în ultima duminică din octombrie) */
export const ORA_AMBIGUA = 'ora_ambigua'
/** momentele posibile pentru o oră locală „AAAA-LL-ZZTHH:MM”: [] (oră inexistentă, trecerea la ora de vară), una, sau două (vara, apoi iarna) */
export function momenteLocale(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const perete = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  // România: UTC+3 vara, UTC+2 iarna; un moment e valid dacă se afișează exact ca ora scrisă
  return [3, 2].map(h => perete - h * 3600e3).filter(t => oraLocalaDinIso(t) === String(s).trim())
}
/**
 * „AAAA-LL-ZZTHH:MM” (ora României) → moment ISO UTC; '' → null; format greșit sau oră inexistentă → NaN;
 * ora care apare de două ori → ORA_AMBIGUA, dacă nu e dată `alegere` ('vara' = prima apariție, 'iarna' = a doua).
 */
export function isoDinOraLocala(s, alegere = null) {
  if (s == null || String(s).trim() === '') return null
  const c = momenteLocale(s)
  if (!c || !c.length) return NaN
  if (c.length === 1) return new Date(c[0]).toISOString()
  if (alegere === 'vara') return new Date(c[0]).toISOString()
  if (alegere === 'iarna') return new Date(c[1]).toISOString()
  return ORA_AMBIGUA
}
/** pentru un moment salvat: 'vara' / 'iarna' dacă ora lui locală e ambiguă (ca formularul să-l poată reface exact), altfel '' */
export function alegereDinIso(iso) {
  const l = oraLocalaDinIso(iso)
  const c = l ? momenteLocale(l) : null
  if (!c || c.length < 2) return ''
  return Date.parse(iso) === c[0] ? 'vara' : 'iarna'
}
/** ziua (AAAA-LL-ZZ) în ora României */
export const ziBucuresti = (ms = Date.now()) => oraLocalaDinIso(ms).slice(0, 10)
export const fmtZi = z => (z ? String(z).slice(0, 10).split('-').reverse().join('.') : '')
export const fmtOraMinut = iso => { const l = oraLocalaDinIso(iso); return l ? l.slice(11, 16) : '' }
/** ZZ.LL.AAAA HH:MM; la ora care apare de două ori se spune care (ora de vară / de iarnă) */
export const fmtMoment = iso => {
  const l = oraLocalaDinIso(iso)
  if (!l) return ''
  const a = alegereDinIso(iso)
  return `${fmtZi(l.slice(0, 10))} ${l.slice(11, 16)}${a ? (a === 'vara' ? ' (ora de vară)' : ' (ora de iarnă)') : ''}`
}

// ── calcule (nu se stochează; aceleași pe ecran și în PDF) ──
const finit = x => typeof x === 'number' && Number.isFinite(x)
const nr = v => (v == null || v === '' ? null : typeof v === 'number' ? v : Number(v))
const rot = (x, z) => Math.round(x * 10 ** z) / 10 ** z
/** durata în ore (2 zecimale) între două momente; lipsă / final înaintea începutului → null */
export function durataOre(inceput, final) {
  const a = Date.parse(inceput || ''), b = Date.parse(final || '')
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null
  return rot((b - a) / 3600e3, 2)
}
/** viteza medie a buretelui = lungimea (m) / timpul de deplasare (min × 60), m/s cu 2 zecimale; lipsă / zero → null */
export function vitezaMedie(lungimeM, timpMin) {
  const l = nr(lungimeM), t = nr(timpMin)
  if (!finit(l) || !finit(t) || l <= 0 || t <= 0) return null
  return rot(l / (t * 60), 2)
}
/** diferența de greutate a buretelui = ieșire − intrare (kg, 3 zecimale; pozitivă = a reținut apă); o valoare lipsă → null. DOAR în aplicație. */
export function diferentaBurete(c) {
  const a = nr(c?.intrare_kg), b = nr(c?.iesire_kg)
  if (!finit(a) || !finit(b)) return null
  return rot(b - a, 3)
}
export const ORE_NOTIFICARE = 24
/**
 * Notificarea beneficiarului cu minimum 24 h înainte de începerea operațiunilor. Începutul = ora reală de început, altfel cea planificată.
 * { stare: 'necunoscut' (lipsește notificarea sau începutul) | 'ok' | 'sub_24h', ore (cu o zecimală, trunchiată), inceput: 'real' | 'planificat' }
 */
export function verificare24h(notificareLa, oraInceput, inceputPlanificat) {
  const n = Date.parse(notificareLa || '')
  const iReal = Date.parse(oraInceput || ''), iPlan = Date.parse(inceputPlanificat || '')
  const i = Number.isFinite(iReal) ? iReal : iPlan
  const sursa = Number.isFinite(iReal) ? 'real' : Number.isFinite(iPlan) ? 'planificat' : null
  if (!Number.isFinite(n) || !Number.isFinite(i)) return { stare: 'necunoscut', ore: null, inceput: sursa }
  const ms = i - n
  return { stare: ms >= ORE_NOTIFICARE * 3600e3 ? 'ok' : 'sub_24h', ore: Math.trunc(ms / 360e3) / 10, inceput: sursa }
}

// ── ce lipsește pentru închidere (aceeași regulă ca fn_executie_uscare_lipsa / _poze_lipsa; paritatea pe cazuri e în proba PGlite) ──
/** fotografiile cerute care lipsesc: 'manometru', 'temperatura', 'pistoane', apoi 'cantar_intrare:<nr>' / 'cantar_iesire:<nr>' pe fiecare burete cântărit */
export function pozeLipsa(r, poze) {
  const are = (cat, nrB = null) => (poze || []).some(p => p.categorie === cat && (nrB == null || Number(p.burete_nr) === nrB))
  const out = POZE_CERUTE.filter(c => !are(c))
  const cant = (Array.isArray(r?.cantariri) ? r.cantariri : []).filter(c => typeof c?.motiv !== 'string').map(c => Number(c.nr)).sort((a, b) => a - b)
  for (const n of cant) for (const cat of CU_BURETE) if (!are(cat, n)) out.push(`${cat}:${n}`)
  return out
}
/** lipsa fotografiilor cerute e JUSTIFICATĂ (poze_justificare pe rând): singura definiție (L19), folosită de închidere și de etapele pe pași */
export const pozeJustificate = r => r?.poze_justificare != null
/** pe rândul salvat (valorile serverului) + pozele înregistrate + câte încărcări sunt nelămurite; întoarce cheile din OBLIGATORII care lipsesc */
export function lipsaDinRand(r, poze = [], deschise = 0) {
  const gol = v => v == null
  const cant = Array.isArray(r?.cantariri) ? r.cantariri : []
  const b = r?.bureti_buc
  const verif = {
    data_operatie: gol(r?.data_operatie), lungime_m: gol(r?.lungime_m), temperatura_c: gol(r?.temperatura_c), constructor: gol(r?.constructor),
    utilaje: !Array.isArray(r?.utilaje) || r.utilaje.length === 0, ora_inceput: gol(r?.ora_inceput), ora_final: gol(r?.ora_final),
    pistoane: gol(r?.pig_metalic_buc) || gol(r?.piston_pu_buc) || gol(b),
    cantariri: gol(b) || cant.length !== Number(b) || cant.some(c => Number(c?.nr) > Number(b)
      || (typeof c?.motiv !== 'string' && (typeof c?.intrare_kg !== 'number' || typeof c?.iesire_kg !== 'number'))),
    presiune_bar: gol(r?.presiune_bar), timp_deplasare_min: gol(r?.timp_deplasare_min),
    piston_final_rezultat: gol(r?.piston_final_rezultat), concluzie: gol(r?.concluzie),
    dovada_conform: r?.concluzie === 'conform' && (r?.piston_final_rezultat !== 'uscat' || !(poze || []).some(p => p.categorie === 'piston_final')),
    poze_justificare: !pozeJustificate(r) && pozeLipsa(r, poze).length > 0,
    incarcari_nelamurite: Number(deschise || 0) > 0,
  }
  return OBLIGATORII.filter(k => verif[k])
}
/** textul unei chei din pozeLipsa: „Cântar la intrare (buretele 2)” */
export function etichetaPozaLipsa(k) {
  const [cat, n] = String(k).split(':')
  return `${ETICHETE_CATEGORII[cat] || cat}${n ? ` (buretele ${n})` : ''}`
}
/** rezervările de încărcare nelămurite: nici înregistrate ca poză, nici renunțate */
export const incarcariDeschise = (incarcari, poze) => (incarcari || []).filter(i => !i.renuntat_la && !(poze || []).some(p => p.cale === i.cale))

// ── formularul: text pe ecran ↔ valori pentru RPC ──
const txt = v => (v == null ? '' : String(v))
const MOMENTE = ['inceput_planificat', 'notificare_la', 'ora_inceput', 'ora_final']
/** rândurile de cântărire pentru n bureți (păstrează ce era scris pe numerele rămase) */
export function cantaririPentru(n, existente = []) {
  const k = Math.max(0, Math.min(MAX_BURETI, Number.isInteger(n) ? n : 0))
  return Array.from({ length: k }, (_, i) => existente.find(c => Number(c.nr) === i + 1) || { nr: i + 1, intrare_kg: '', iesire_kg: '', motiv: '' })
}
/** formular gol pentru un raport nou; tronsonul de probă (dacă e ales) dă codul și intervalul; constructorul propus (de confirmat) */
export function formularNou({ proba = null, constructor = '' } = {}) {
  return {
    proba_id: proba ? String(proba.id) : '', tronson: proba ? [proba.cod, proba.denumire].filter(Boolean).join(' — ') : '',
    km_de_la: proba ? fmtKm(proba.km_de_la_m) : '', km_pana_la: proba ? fmtKm(proba.km_pana_la_m) : '',
    lungime_m: proba ? textNr(proba.km_pana_la_m - proba.km_de_la_m) : '', inceput_planificat: '', notificare_la: '', notificare_ref: '',
    data_operatie: '', ora_inceput: '', ora_final: '',
    poz_lat: '', poz_lng: '', poz_sursa: '', poz_precizie_m: '', poz_la: '', poz_km_m: '', poz_traseu_versiune: '',
    temperatura_c: '', temperatura_sursa: '', meteo: null, meteo_cerere: null, vreme: '', constructor,
    utilaje: [{ denumire: '', buc: '1' }], pig_metalic_buc: '', piston_pu_buc: '', bureti_buc: '',
    cantariri: [], punct_roua_c: '', punct_roua_loc: '', presiune_bar: '', timp_deplasare_min: '', piston_final_rezultat: '', poze_justificare: '',
    observatii: '', concluzie: '', semn_constructor_nume: '', semn_constructor_functie: '', semn_beneficiar_nume: '', semn_beneficiar_functie: '',
    _orig: {}, dst: {},
  }
}
/** rândul serverului → formularul (texte; numerele cu virgulă, momentele în ora României, momentul ORIGINAL păstrat pentru câmpurile nemodificate) */
export function formularDinRand(r) {
  const orig = {}, dst = {}
  for (const k of MOMENTE) if (r[k]) { orig[k] = { local: oraLocalaDinIso(r[k]), iso: new Date(Date.parse(r[k])).toISOString() }; dst[k] = alegereDinIso(r[k]) }
  return {
    proba_id: r.proba_id == null ? '' : String(r.proba_id), tronson: txt(r.tronson), km_de_la: fmtKm(r.km_de_la_m), km_pana_la: fmtKm(r.km_pana_la_m),
    lungime_m: textNr(r.lungime_m), inceput_planificat: oraLocalaDinIso(r.inceput_planificat), notificare_la: oraLocalaDinIso(r.notificare_la),
    notificare_ref: txt(r.notificare_ref), data_operatie: txt(r.data_operatie), ora_inceput: oraLocalaDinIso(r.ora_inceput),
    ora_final: oraLocalaDinIso(r.ora_final),
    poz_lat: textNr(r.poz_lat), poz_lng: textNr(r.poz_lng), poz_sursa: txt(r.poz_sursa), poz_precizie_m: textNr(r.poz_precizie_m),
    poz_la: r.poz_la ? new Date(Date.parse(r.poz_la)).toISOString() : '', poz_km_m: r.poz_km_m == null ? '' : String(r.poz_km_m),
    poz_traseu_versiune: txt(r.poz_traseu_versiune),
    temperatura_c: textNr(r.temperatura_c), temperatura_sursa: txt(r.temperatura_sursa), meteo: r.meteo || null, meteo_cerere: null,
    vreme: txt(r.vreme), constructor: txt(r.constructor),
    utilaje: (r.utilaje || []).map(u => ({ denumire: txt(u.denumire), buc: String(u.buc) })),
    pig_metalic_buc: textNr(r.pig_metalic_buc), piston_pu_buc: textNr(r.piston_pu_buc), bureti_buc: textNr(r.bureti_buc),
    cantariri: (r.cantariri || []).map(c => ({ nr: c.nr, intrare_kg: textNr(c.intrare_kg), iesire_kg: textNr(c.iesire_kg), motiv: txt(c.motiv) })),
    punct_roua_c: textNr(r.punct_roua_c), punct_roua_loc: txt(r.punct_roua_loc), presiune_bar: textNr(r.presiune_bar),
    timp_deplasare_min: textNr(r.timp_deplasare_min), piston_final_rezultat: txt(r.piston_final_rezultat), poze_justificare: txt(r.poze_justificare),
    observatii: txt(r.observatii), concluzie: txt(r.concluzie),
    semn_constructor_nume: txt(r.semn_constructor_nume), semn_constructor_functie: txt(r.semn_constructor_functie),
    semn_beneficiar_nume: txt(r.semn_beneficiar_nume), semn_beneficiar_functie: txt(r.semn_beneficiar_functie),
    _orig: orig, dst,
  }
}
const CAMP_ETICHETA = {
  proba_id: 'tronsonul de probă', tronson: 'tronsonul', km_de_la: 'de la km', km_pana_la: 'la km', lungime_m: 'lungimea (m)',
  inceput_planificat: 'începutul planificat', notificare_la: 'notificarea beneficiarului', data_operatie: 'data operației',
  ora_inceput: 'ora de început', ora_final: 'ora de final', temperatura_c: 'temperatura (°C)', pig_metalic_buc: 'PIG metalic (buc)',
  piston_pu_buc: 'pistonul poliuretan (buc)', bureti_buc: 'bureții (buc)', punct_roua_c: 'punctul de rouă (°C)', presiune_bar: 'presiunea (bar)',
  timp_deplasare_min: 'timpul de deplasare (min)', poz_lat: 'latitudinea', poz_lng: 'longitudinea', poz_precizie_m: 'precizia (m)',
}
/** număr din text (helper-ul existent parseNumar, RO / EN); gol → null; zecimale în plus / în afara domeniului → eroare (nu rotunjire, L17) */
function numar(f, k, { min, max, zec }, erori) {
  const x = parseNumar(f[k])
  if (x === null) return null
  if (!finit(x) || x < min || x > max || !areMaxZecimale(x, zec)) {
    erori.push(`${CAMP_ETICHETA[k] || k}: număr între ${textNr(min)} și ${textNr(max)}${zec ? `, cel mult ${zec} zecimal${zec === 1 ? 'ă' : 'e'}` : ', întreg'}`)
    return null
  }
  return x
}
/**
 * INSTANTUL unui câmp-moment din formular: cel ORIGINAL dacă ora de pe ecran (și alegerea apariției) n-au fost atinse, altfel cel calculat din
 * ora locală + alegerea apariției. → ISO | null (gol) | NaN (oră invalidă / inexistentă) | ORA_AMBIGUA (ora care apare de două ori, nealeasă).
 */
export function instantDinFormular(f, k) {
  const o = f?._orig?.[k]
  if (o && f[k] === o.local && !(f.dst?.[k] && f.dst[k] !== alegereDinIso(o.iso))) return o.iso
  return isoDinOraLocala(f?.[k], f?.dst?.[k] || null)
}
/** forma comparabilă a unui moment: instantul (nu textul orei locale); nevalid / ambiguu = textul + alegerea, ca să nu fie egal cu un instant */
export function canonMoment(f, k) {
  const v = instantDinFormular(f, k)
  if (v === null) return ''
  if (typeof v === 'string' && v !== ORA_AMBIGUA) return new Date(Date.parse(v)).toISOString()
  return `?${String(f?.[k] ?? '').trim()}|${f?.dst?.[k] || ''}`
}
/** momentul unui câmp: cel ORIGINAL dacă ora de pe ecran n-a fost atinsă; ora ambiguă cere alegerea explicită */
function moment(f, k, erori) {
  const v = instantDinFormular(f, k)
  if (v === ORA_AMBIGUA) { erori.push(`${CAMP_ETICHETA[k] || k}: ora ${String(f[k]).slice(11, 16)} apare de două ori (trecerea la ora de iarnă): alege prima sau a doua`); return null }
  if (Number.isNaN(v)) { erori.push(`${CAMP_ETICHETA[k] || k}: oră invalidă`); return null }
  return v
}
const textSau = v => { const s = String(v ?? '').trim(); return s === '' ? null : s }
/**
 * formularul → { date, erori }: `date` are EXACT cheile CAMPURI (contractul RPC); `erori` = ce nu se poate trimite (cu eticheta câmpului).
 * Nimic nu se ignoră pe tăcute: un rând de utilaj fără denumire dar cu bucăți, sau o cântărire pe jumătate, e păstrat / semnalat.
 */
export function payloadDinFormular(f) {
  const erori = []
  const km1 = parseKm(f.km_de_la), km2 = parseKm(f.km_pana_la)
  if (km1 === null || Number.isNaN(km1)) erori.push('de la km: „3+200” sau metri întregi')
  if (km2 === null || Number.isNaN(km2)) erori.push('la km: „3+900” sau metri întregi')
  if (Number.isFinite(km1) && Number.isFinite(km2) && km2 <= km1) erori.push('intervalul de km: sfârșitul trebuie să fie după început')
  if (!textSau(f.tronson)) erori.push('tronsonul e obligatoriu')
  const utilaje = []
  for (const [i, u] of (f.utilaje || []).entries()) {
    const den = textSau(u.denumire), buc = parseNumar(u.buc)
    if (!den && (buc === null || buc === 1)) continue            // rândul gol lăsat de formular
    if (!den) { erori.push(`utilajul ${i + 1}: denumirea lipsește`); continue }
    if (!finit(buc) || !Number.isInteger(buc) || buc < 1 || buc > 99) { erori.push(`utilajul ${i + 1}: numărul de bucăți (1–99)`); continue }
    utilaje.push({ denumire: den, buc })
  }
  const cantariri = []
  for (const c of f.cantariri || []) {
    const motiv = textSau(c.motiv)
    const a = parseNumar(c.intrare_kg), b = parseNumar(c.iesire_kg)
    if (motiv && (a !== null || b !== null)) erori.push(`buretele ${c.nr}: „nu se aplică” nu are cântăriri (șterge kg sau motivul)`)
    if (motiv && motiv.length > 200) erori.push(`buretele ${c.nr}: motivul are cel mult 200 de caractere`)
    for (const [x, ce] of [[a, 'la intrare'], [b, 'la ieșire']]) {
      if (x !== null && (!finit(x) || x < 0.001 || x > 1000 || !areMaxZecimale(x, 3))) erori.push(`buretele ${c.nr} ${ce}: kg între 0,001 și 1000, cel mult 3 zecimale`)
    }
    cantariri.push({ nr: c.nr, intrare_kg: finit(a) ? a : null, iesire_kg: finit(b) ? b : null, motiv })
  }
  const temperatura = numar(f, 'temperatura_c', { min: -50, max: 60, zec: 1 }, erori)
  const sursa = temperatura === null ? null : (f.temperatura_sursa === 'meteo' ? 'meteo' : 'manual')
  const meteo = f.meteo_cerere ? { cerere: 'santier', site_id: Number(f.meteo_cerere.site_id) } : (f.meteo || null)
  // poziția: toată sau deloc
  const lat = numar(f, 'poz_lat', { min: -90, max: 90, zec: 6 }, erori), lng = numar(f, 'poz_lng', { min: -180, max: 180, zec: 6 }, erori)
  const pozSursa = textSau(f.poz_sursa)
  const prec = numar(f, 'poz_precizie_m', { min: 0.1, max: 100000, zec: 1 }, erori)
  const kmPoz = textSau(f.poz_km_m) == null ? null : Number(f.poz_km_m)
  if ((lat === null) !== (lng === null)) erori.push('poziția: completează și latitudinea, și longitudinea')
  const arePoz = lat !== null && lng !== null
  const date = {
    proba_id: f.proba_id ? Number(f.proba_id) : null, tronson: textSau(f.tronson), km_de_la_m: Number.isFinite(km1) ? km1 : null,
    km_pana_la_m: Number.isFinite(km2) ? km2 : null, lungime_m: numar(f, 'lungime_m', { min: 0.1, max: 1000000, zec: 1 }, erori),
    inceput_planificat: moment(f, 'inceput_planificat', erori), notificare_la: moment(f, 'notificare_la', erori), notificare_ref: textSau(f.notificare_ref),
    data_operatie: textSau(f.data_operatie), ora_inceput: moment(f, 'ora_inceput', erori), ora_final: moment(f, 'ora_final', erori),
    poz_lat: arePoz ? lat : null, poz_lng: arePoz ? lng : null, poz_sursa: arePoz ? (pozSursa || 'manual') : null,
    poz_precizie_m: arePoz && pozSursa === 'gps' ? prec : null, poz_la: arePoz ? (textSau(f.poz_la) || null) : null,
    poz_km_m: arePoz && pozSursa === 'traseu' && Number.isInteger(kmPoz) ? kmPoz : null,
    poz_traseu_versiune: arePoz && pozSursa === 'traseu' ? textSau(f.poz_traseu_versiune) : null,
    temperatura_c: temperatura, temperatura_sursa: sursa, meteo, vreme: textSau(f.vreme),
    constructor: textSau(f.constructor), utilaje,
    pig_metalic_buc: numar(f, 'pig_metalic_buc', { min: 0, max: 99, zec: 0 }, erori), piston_pu_buc: numar(f, 'piston_pu_buc', { min: 0, max: 99, zec: 0 }, erori),
    bureti_buc: numar(f, 'bureti_buc', { min: 0, max: MAX_BURETI, zec: 0 }, erori), cantariri,
    punct_roua_c: numar(f, 'punct_roua_c', { min: -100, max: 50, zec: 1 }, erori), punct_roua_loc: textSau(f.punct_roua_loc),
    presiune_bar: numar(f, 'presiune_bar', { min: 0.01, max: 100, zec: 2 }, erori), timp_deplasare_min: numar(f, 'timp_deplasare_min', { min: 0.1, max: 10000, zec: 1 }, erori),
    piston_final_rezultat: f.piston_final_rezultat === 'uscat' || f.piston_final_rezultat === 'umed' ? f.piston_final_rezultat : null,
    poze_justificare: textSau(f.poze_justificare), observatii: textSau(f.observatii),
    concluzie: f.concluzie === 'conform' || f.concluzie === 'neconform' ? f.concluzie : null,
    semn_constructor_nume: textSau(f.semn_constructor_nume), semn_constructor_functie: textSau(f.semn_constructor_functie),
    semn_beneficiar_nume: textSau(f.semn_beneficiar_nume), semn_beneficiar_functie: textSau(f.semn_beneficiar_functie),
  }
  if (arePoz && !date.poz_la) erori.push('poziția: lipsește momentul capturii (reia GPS-ul sau rescrie coordonatele)')
  if (arePoz && pozSursa === 'gps' && prec === null) erori.push('poziția GPS: lipsește precizia')
  if (arePoz && pozSursa === 'traseu' && (date.poz_km_m === null || !/^[0-9a-f]{64}$/.test(date.poz_traseu_versiune || ''))) erori.push('poziția din traseu: lipsește km-ul sau versiunea traseului')
  if (date.ora_final && !date.ora_inceput && !String(f.ora_inceput ?? '').trim()) erori.push('ora de final cere ora de început')
  if (date.ora_final && date.ora_inceput && Date.parse(date.ora_final) <= Date.parse(date.ora_inceput)) erori.push('ora de final trebuie să fie după ora de început')
  if (new Set(cantariri.map(c => c.nr)).size !== cantariri.length) erori.push('cântăririle: numerele bureților se repetă')
  if (date.bureti_buc != null && cantariri.some(c => c.nr > date.bureti_buc)) erori.push('cântăririle: sunt mai multe rânduri decât bureții declarați')
  if (sursa === 'meteo' && !meteo) erori.push('temperatura „din meteo” fără propunere: propune din nou sau scrie temperatura măsurată')
  return { date, erori }
}
/** formularul are modificări față de rândul salvat (comparând valorile care s-ar trimite) */
export function areModificari(f, r) {
  if (!f || !r) return false
  return formulareDiferite(f, formularDinRand(r))
}
/** două formulare diferă în ce s-ar trimite (aceeași comparație ca areModificari, între formulare: raportul NOU față de propunerea lui) */
export function formulareDiferite(f, g) {
  if (!f || !g) return false
  return JSON.stringify(payloadDinFormular(f).date) !== JSON.stringify(payloadDinFormular(g).date)
}

// ── conflictul de versiune: îmbinare în trei, pe câmpuri, rezolvată EXPLICIT de om ──
/** câmpurile formularului care se compară ca valori (fără cele interne; momentele se compară separat, pe INSTANT) */
export const CHEI_FORMULAR = Object.keys(formularNou()).filter(k => !['_orig', 'dst', 'meteo_cerere'].includes(k) && !MOMENTE.includes(k))
export const MOMENTE_FORMULAR = MOMENTE
const canon = v => (v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '').trim())
// starea completă a unui moment din formular (textul orei, alegerea apariției, instantul original) și afișarea ei
const stareMoment = (f, k) => ({ v: f[k] ?? '', dst: f.dst?.[k] || '', orig: f._orig?.[k] || null })
function puneMoment(f, k, s) {
  const o = { ...f, [k]: s.v, dst: { ...(f.dst || {}), [k]: s.dst }, _orig: { ...(f._orig || {}) } }
  if (s.orig) o._orig[k] = s.orig; else delete o._orig[k]
  return o
}
function afisMoment(f, k) {
  const v = instantDinFormular(f, k)
  if (v === null) return ''
  if (typeof v === 'string' && v !== ORA_AMBIGUA) return fmtMoment(v)
  return `${String(f[k] ?? '').replace('T', ' ')} (${v === ORA_AMBIGUA ? 'apariția nealeasă' : 'oră invalidă'})`
}
/**
 * baza = rândul pe care s-a pornit formularul, form = ce a scris omul, server = rândul de acum.
 * { form: formularul îmbinat (pe baza serverului: schimbările colegului intră, ale mele rămân), conflicte: [{ camp, al_meu, al_colegului, … }] }
 * Un câmp schimbat de ambii, cu valori diferite = conflict (rămâne valoarea mea până alege omul, cu aleg()).
 * MOMENTELE (runda 3, ora de iarnă): se compară pe INSTANT (ora locală + apariția aleasă + instantul original), nu pe textul orei: la
 * 25.10.2026, 00:30Z și 01:30Z se afișează amândouă „03:30”. O schimbare a colegului care NU se vede pe ecran (același text al orei, alt
 * instant) se arată tot ca alegere explicită — nu se preia și nu se suprascrie pe tăcute.
 */
export function imbinare(baza, form, server) {
  const fb = formularDinRand(baza), fs = formularDinRand(server)
  let out = { ...fs, meteo_cerere: null, dst: { ...(fs.dst || {}) }, _orig: { ...(fs._orig || {}) } }
  const conflicte = []
  for (const k of CHEI_FORMULAR) {
    const mine = canon(form[k]) !== canon(fb[k]), alor = canon(fs[k]) !== canon(fb[k])
    if (mine && (!alor || canon(form[k]) === canon(fs[k]))) out[k] = form[k]
    else if (mine && alor) { out[k] = form[k]; conflicte.push({ camp: k, al_meu: form[k], al_colegului: fs[k] }) }
  }
  for (const k of MOMENTE) {
    const b = canonMoment(fb, k), m = canonMoment(form, k), s = canonMoment(fs, k)
    const mine = m !== b, alor = s !== b
    const invizibila = !mine && alor && String(fs[k] ?? '') === String(form[k] ?? '')
    if ((mine && alor && m !== s) || invizibila) {
      out = puneMoment(out, k, stareMoment(form, k))
      conflicte.push({ camp: k, moment: true, al_meu: afisMoment(form, k), al_colegului: afisMoment(fs, k), stare_meu: stareMoment(form, k), stare_colegului: stareMoment(fs, k) })
    } else if (mine) out = puneMoment(out, k, stareMoment(form, k))
  }
  // o cerere meteo nelămurită a mea rămâne doar dacă ora începerii (instantul) e aceeași cu cea pentru care am cerut-o
  if (form.meteo_cerere && canonMoment(out, 'ora_inceput') === canonMoment(form, 'ora_inceput')) out.meteo_cerere = form.meteo_cerere
  return { form: out, conflicte }
}
/** alegerea omului pentru un câmp în conflict: 'al_meu' | 'al_colegului' (la momente: textul, apariția și instantul original, împreună) */
export function aleg(form, conflict, alegere, server) {
  if (conflict.moment) return puneMoment(form, conflict.camp, alegere === 'al_colegului' ? conflict.stare_colegului : conflict.stare_meu)
  const fs = formularDinRand(server)
  return { ...form, [conflict.camp]: alegere === 'al_colegului' ? fs[conflict.camp] : conflict.al_meu }
}

// ── meteo: propunerea din vremea curentă a șantierului (meteo_cache, umplut de meteo-sync); instantaneul îl construiește SERVERUL ──
export const ORE_METEO_MAX = 3
/**
 * rândul meteo_cache + ora începerii (ISO) → { ok: true, temperatura_c (text, o zecimală), vreme, ora_observatiei, preluat_la }
 * sau { ok: false, motiv }. Ora observației = curent.la (a furnizorului), NU ora preluării. Nu se propune vremea curentă pentru o
 * operațiune la peste 3 h de observație (trecută sau viitoare).
 */
export function propunereMeteo(rand, oraInceputIso) {
  const t = Number(rand?.curent?.temp)
  if (rand?.curent?.temp == null || !Number.isFinite(t)) return { ok: false, motiv: 'șantierul nu are temperatura curentă' }
  const obs = Date.parse(rand?.curent?.la || '')
  if (!Number.isFinite(obs)) return { ok: false, motiv: 'vremea șantierului nu are ora observației' }
  const inc = Date.parse(oraInceputIso || '')
  if (!Number.isFinite(inc)) return { ok: false, motiv: 'completează întâi ora începerii (vremea se propune pentru ea)' }
  if (Math.abs(obs - inc) > ORE_METEO_MAX * 3600e3) return { ok: false, motiv: `vremea curentă e observată la ${fmtMoment(rand.curent.la)}, la peste ${ORE_METEO_MAX} h de ora începerii: scrie temperatura măsurată` }
  return { ok: true, temperatura_c: textNr(Math.round(t * 10) / 10), vreme: String(rand.curent.vreme || '').slice(0, 120), ora_observatiei: rand.curent.la, preluat_la: rand.actualizat_la || null }
}
/** schimbarea cere o nouă propunere meteo: INSTANTUL orei începerii s-a schimbat (inclusiv alegerea apariției la ora de iarnă) sau poziția */
export function schimbaSursaMeteo(form, patch) {
  const nou = { ...form, ...patch }
  const ora = ['ora_inceput', 'dst', '_orig'].some(k => k in patch) && canonMoment(form, 'ora_inceput') !== canonMoment(nou, 'ora_inceput')
  const poz = ['poz_lat', 'poz_lng'].some(k => k in patch && canon(patch[k]) !== canon(form[k]))
  return { ora, poz }
}
/**
 * Invalidarea propunerii meteo (patch-ul suplimentar, sau {}):
 *  - ora începerii schimbată (instantul): temperatura „din meteo” se golește (propunerea / instantaneul era pentru ora veche; serverul refuză
 *    oricum sursa „meteo” pe altă oră), cererea nesalvată cade; o temperatură MĂSURATĂ rămâne (cererea cade);
 *  - poziția schimbată: cade doar propunerea NESALVATĂ (cererea; temperatura ei, dacă era „din meteo”); instantaneul salvat e al șantierului
 *    (nu depinde de poziție) și rămâne. Răspunsurile meteo în zbor se ignoră în ecran (generația sursei).
 */
export function invalidareMeteo(form, patch) {
  const { ora, poz } = schimbaSursaMeteo(form, patch)
  if (ora) {
    if (form.temperatura_sursa === 'meteo') return { temperatura_c: '', temperatura_sursa: '', meteo_cerere: null }
    return form.meteo_cerere ? { meteo_cerere: null } : {}
  }
  if (poz && form.meteo_cerere) return form.temperatura_sursa === 'meteo' ? { temperatura_c: '', temperatura_sursa: '', meteo_cerere: null } : { meteo_cerere: null }
  return {}
}

// ── poziția operațiunii ──
const r6 = x => Math.round(x * 1e6) / 1e6
/** captura GPS (Geolocation API) → câmpurile poziției; precizia rotunjită în sus la 0,1 m */
export function pozitieDinGps(pos) {
  const c = pos?.coords
  if (!c || !finit(c.latitude) || !finit(c.longitude) || !finit(c.accuracy)) return null
  return {
    poz_lat: textNr(r6(c.latitude)), poz_lng: textNr(r6(c.longitude)), poz_sursa: 'gps', poz_precizie_m: textNr(Math.max(0.1, Math.ceil(c.accuracy * 10) / 10)),
    poz_la: new Date(finit(pos.timestamp) ? pos.timestamp : Date.now()).toISOString(), poz_km_m: '', poz_traseu_versiune: '',
  }
}
/**
 * Propunerea din traseu: punctul de pe ax la km-ul dat, prin INVERSAREA calibrării pe borne (ancore [{ dist, km_m }], ca la calibrare()
 * din izoKml.js). Distanța geometrică pe ax NU e automat km contractual: km-ul vine din bornele calibrate; între borne se interpolează,
 * în afara lor se extrapolează cel mult `extrapolare_max_m`, altfel null.
 * → { poz_lat, poz_lng, poz_sursa: 'traseu', poz_km_m, poz_traseu_versiune, poz_la, stare: 'interpolat' | 'extrapolat' } sau null
 */
export function pozitieDinTraseu({ ax, ancore, versiune }, km_m, { extrapolare_max_m = 500, acum = Date.now() } = {}) {
  if (!Array.isArray(ax) || ax.length < 2 || !Number.isInteger(km_m) || !/^[0-9a-f]{64}$/.test(versiune || '')) return null
  const a = (ancore || []).slice().sort((x, y) => x.dist - y.dist)
  if (a.length < 2 || a.some((x, i) => i && !(x.dist > a[i - 1].dist && x.km_m > a[i - 1].km_m))) return null
  let i = a.findIndex(x => x.km_m >= km_m)
  if (i <= 0) i = i === 0 ? 1 : a.length - 1
  const p = a[i - 1], q = a[i]
  const d = p.dist + (km_m - p.km_m) * (q.dist - p.dist) / (q.km_m - p.km_m)
  const stare = d >= a[0].dist && d <= a[a.length - 1].dist ? 'interpolat' : (d >= a[0].dist - extrapolare_max_m && d <= a[a.length - 1].dist + extrapolare_max_m ? 'extrapolat' : null)
  const cum = cumulat(ax)
  if (!stare || d < 0 || d > cum[cum.length - 1]) return null
  let s = 1
  while (s < cum.length - 1 && cum[s] < d) s++
  const t = cum[s] === cum[s - 1] ? 0 : (d - cum[s - 1]) / (cum[s] - cum[s - 1])
  const pt = [ax[s - 1][0] + (ax[s][0] - ax[s - 1][0]) * t, ax[s - 1][1] + (ax[s][1] - ax[s - 1][1]) * t]
  return { poz_lat: textNr(r6(pt[1])), poz_lng: textNr(r6(pt[0])), poz_sursa: 'traseu', poz_precizie_m: '', poz_km_m: String(km_m), poz_traseu_versiune: versiune, poz_la: new Date(acum).toISOString(), stare }
}
/** distanța (m) între poziția operațiunii și coordonatele instantaneului meteo; lipsă → null */
export function distantaMeteo(form) {
  const la = parseNumar(form?.poz_lat), lo = parseNumar(form?.poz_lng), m = form?.meteo
  if (!finit(la) || !finit(lo) || !m || !finit(Number(m.lat)) || !finit(Number(m.lng)) || m.lat == null || m.lng == null) return null
  return Math.round(haversine([lo, la], [Number(m.lng), Number(m.lat)]))
}
export const ETICHETE_POZ_SURSA = { gps: 'GPS din telefon', traseu: 'propusă din traseu (km calibrat pe borne)', manual: 'scrisă de mână' }

// ── afișare ──
export const fmtNr = (x, z = 1) => (x == null || x === '' || !Number.isFinite(Number(x)) ? '' : Number(x).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: z }))
export function numeFisierRaport(u) {
  const t = String(u?.tronson || 'tronson').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `Raport_uscare_${t || 'tronson'}_${u?.data_operatie || 'fara_data'}${u?.revizie ? `_rev${u.revizie}` : ''}.pdf`
}
