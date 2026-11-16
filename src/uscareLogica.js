// ═══════════════════════════════════════════════════════════════════════════
// uscareLogica.js — logica PURĂ a raportului de uscare a conductei (Execuție → proiect → „💨 Uscare conductă”, migrarea 20261225a).
// O singură definiție (L19) pentru: listele contractului cu serverul (câmpurile, ce cere închiderea, tranzițiile, categoriile de poze — testul
// de paritate le compară cu blocurile marcate din migrare), calculele (durata, viteza medie, diferența de greutate a buretelui, verificarea
// celor 24 h), ora României (Europe/Bucharest, L17) și formularul (text pe ecran ↔ valori trimise la RPC).
// Ce NU se știe (pragul punctului de rouă, criteriul pentru greutatea buretelui) NU se calculează aici: concluzia o pune omul.
// ═══════════════════════════════════════════════════════════════════════════

import { parseNumar, textNr, areMaxZecimale } from './izoDocumenteLogica.js'
import { parseKm } from './probeTronsoaneLogica.js'
import { fmtKm } from './lib/izoKml.js'
// registrul cererilor nelămurite (L05) și clasificarea răspunsurilor: aceleași ca la probele pe tronsoane (L19)
export { clasificaReluare, esteRefuzDeterminist, registruNou, aceeasiIntentie } from './probeTronsoaneLogica.js'
export { fmtKm, parseKm }

// ── contractul cu serverul (paritate cu 20261225a) ──
/** cheile EXACTE ale lui p_date (CAMPURI-START … CAMPURI-END din migrare), în aceeași ordine */
export const CAMPURI = ['proba_id', 'tronson', 'km_de_la_m', 'km_pana_la_m', 'lungime_m', 'inceput_planificat', 'notificare_la', 'notificare_ref',
  'data_operatie', 'ora_inceput', 'ora_final', 'temperatura_c', 'temperatura_sursa', 'meteo_la', 'vreme', 'constructor',
  'utilaje', 'pig_metalic_buc', 'piston_pu_buc', 'bureti_buc', 'cantariri', 'punct_roua_c', 'punct_roua_loc', 'presiune_bar',
  'timp_deplasare_min', 'observatii', 'concluzie', 'semn_constructor_nume', 'semn_constructor_functie', 'semn_beneficiar_nume',
  'semn_beneficiar_functie']
/** ce cere închiderea (OBLIGATORII-START … -END din fn_executie_uscare_lipsa), în ordinea modelului */
export const OBLIGATORII = ['data_operatie', 'lungime_m', 'temperatura_c', 'constructor', 'utilaje', 'ora_inceput', 'ora_final', 'pistoane',
  'cantariri', 'punct_roua_c', 'punct_roua_loc', 'presiune_bar', 'timp_deplasare_min', 'concluzie']
export const ETICHETE_OBLIGATORII = {
  data_operatie: 'data operației', lungime_m: 'lungimea', temperatura_c: 'temperatura exterioară', constructor: 'constructorul',
  utilaje: 'utilajele (cel puțin unul)', ora_inceput: 'ora de început', ora_final: 'ora de final', pistoane: 'configurația pistoanelor (toate trei)',
  cantariri: 'cântăririle bureților (fiecare rând, intrare și ieșire)', punct_roua_c: 'punctul de rouă', punct_roua_loc: 'locul măsurării punctului de rouă',
  presiune_bar: 'presiunea în spatele buretelui', timp_deplasare_min: 'timpul de deplasare', concluzie: 'concluzia (conform / neconform)',
}
/** tranzițiile (TRANZITII-START … -END din fn_executie_uscare_tranzitie): [stare veche, acțiune, stare nouă] */
export const TRANZITII = [['deschisa', 'inchide', 'inchisa'], ['inchisa', 'redeschide', 'deschisa'], ['deschisa', 'anuleaza', 'anulata']]
export const stareDupa = (veche, actiune) => (TRANZITII.find(([v, a]) => v === veche && a === actiune) || [])[2] || null
export const actiuniPermise = veche => TRANZITII.filter(([v]) => v === veche).map(([, a]) => a)
export const ETICHETE_STARE = { deschisa: 'Deschis (se completează)', inchisa: 'Închis', anulata: 'Anulat' }
export const CULORI_STARE = { deschisa: '#58A6FF', inchisa: '#3FB950', anulata: '#8B949E' }
/** categoriile pozelor (CATEGORII-START … -END din migrare) */
export const CATEGORII = ['manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'punct_roua', 'utilaje', 'altele']
export const ETICHETE_CATEGORII = {
  manometru: 'Manometru (presiunea)', temperatura: 'Temperatura exterioară', pistoane: 'Configurația pistoanelor', cantar_intrare: 'Cântar la intrare',
  cantar_iesire: 'Cântar la ieșire', punct_roua: 'Punctul de rouă', utilaje: 'Utilaje / echipamente', altele: 'Altele',
}
/** fotografiile cerute explicit de beneficiar (presiune, temperatura exterioară, pistoanele, cântărirea la intrare și la ieșire) */
export const POZE_CERUTE = ['manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire']
export const RPC_USCARE = ['fn_executie_uscare_salveaza', 'fn_executie_uscare_stare', 'fn_executie_uscare_poza']
export const prefixRegistru = (utilizator, proiect) => `gazpet.uscare.incert.v1:${utilizator}:${proiect}:`
export const NR_CANTARIRI_MODEL = 3

// ── ora României (L17: Europe/Bucharest, nu fusul telefonului și nu un decalaj fix) ──
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
function partiBuc(ms) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}
const pad = n => String(n).padStart(2, '0')
/** decalajul Bucureștiului față de UTC în momentul dat (ms) */
function decalaj(ms) {
  const p = partiBuc(ms)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}
/** moment (ISO / ms) → „AAAA-LL-ZZTHH:MM” în ora României (pentru <input type="datetime-local">); gol / invalid → '' */
export function oraLocalaDinIso(v) {
  if (v == null || v === '') return ''
  const ms = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(ms)) return ''
  const p = partiBuc(ms)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
}
/** „AAAA-LL-ZZTHH:MM” (ora României) → moment ISO UTC; '' → null; format greșit sau oră inexistentă (trecerea la ora de vară) → NaN */
export function isoDinOraLocala(s) {
  if (s == null || String(s).trim() === '') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s).trim())
  if (!m) return NaN
  const perete = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  // decalajul se citește în momentul aproximat, apoi se reverifică (la schimbarea orei decalajul diferă de o oră)
  let t = perete - decalaj(perete)
  t = perete - decalaj(t)
  return oraLocalaDinIso(t) === String(s).trim() ? new Date(t).toISOString() : NaN
}
/** ziua (AAAA-LL-ZZ) în ora României */
export const ziBucuresti = (ms = Date.now()) => oraLocalaDinIso(ms).slice(0, 10)
export const fmtZi = z => (z ? String(z).slice(0, 10).split('-').reverse().join('.') : '')
export const fmtOraMinut = iso => { const l = oraLocalaDinIso(iso); return l ? l.slice(11, 16) : '' }
export const fmtMoment = iso => { const l = oraLocalaDinIso(iso); return l ? `${fmtZi(l.slice(0, 10))} ${l.slice(11, 16)}` : '' }

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
/** diferența de greutate a buretelui = ieșire − intrare (kg, 3 zecimale; pozitivă = a reținut apă); o valoare lipsă → null */
export function diferentaBurete(c) {
  const a = nr(c?.intrare_kg), b = nr(c?.iesire_kg)
  if (!finit(a) || !finit(b)) return null
  return rot(b - a, 3)
}
export const ORE_NOTIFICARE = 24
/**
 * Notificarea beneficiarului cu minimum 24 h înainte de începerea operațiunilor. Începutul = ora reală de început, altfel cea planificată.
 * { stare: 'necunoscut' (lipsește notificarea sau începutul) | 'ok' | 'sub_24h', ore (cu o zecimală, trunchiată), inceput: 'real' | 'planificat' }
 * Comparația e pe momentul exact (L17), nu pe zile.
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
/** datele meteo propuse sunt departe de ora operației (> 3 h) → textul avertismentului; altfel null */
export function avertismentMeteo(meteoLa, oraInceput) {
  const a = Date.parse(meteoLa || ''), b = Date.parse(oraInceput || '')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const ore = Math.abs(a - b) / 3600e3
  return ore > 3 ? `Datele meteo sunt de la ${fmtMoment(meteoLa)}, la ${Math.round(ore)} h de ora de început: verifică temperatura.` : null
}

// ── ce lipsește pentru închidere (aceeași regulă ca fn_executie_uscare_lipsa; paritatea pe cazuri e în proba PGlite) ──
/** pe rândul salvat (valorile serverului); întoarce cheile din OBLIGATORII care lipsesc, în ordinea lor */
export function lipsaDinRand(r) {
  const gol = v => v == null
  const cant = Array.isArray(r?.cantariri) ? r.cantariri : []
  const verif = {
    data_operatie: gol(r?.data_operatie), lungime_m: gol(r?.lungime_m), temperatura_c: gol(r?.temperatura_c), constructor: gol(r?.constructor),
    utilaje: !Array.isArray(r?.utilaje) || r.utilaje.length === 0, ora_inceput: gol(r?.ora_inceput), ora_final: gol(r?.ora_final),
    pistoane: gol(r?.pig_metalic_buc) || gol(r?.piston_pu_buc) || gol(r?.bureti_buc),
    cantariri: cant.length === 0 || cant.some(c => typeof c?.intrare_kg !== 'number' || typeof c?.iesire_kg !== 'number'),
    punct_roua_c: gol(r?.punct_roua_c), punct_roua_loc: gol(r?.punct_roua_loc), presiune_bar: gol(r?.presiune_bar),
    timp_deplasare_min: gol(r?.timp_deplasare_min), concluzie: gol(r?.concluzie),
  }
  return OBLIGATORII.filter(k => verif[k])
}
/** pozele cerute de beneficiar care încă lipsesc (categoriile din POZE_CERUTE fără nicio poză) */
export const pozeLipsa = poze => POZE_CERUTE.filter(c => !(poze || []).some(p => p.categorie === c))

// ── formularul: text pe ecran ↔ valori pentru RPC ──
const txt = v => (v == null ? '' : String(v))
/** formular gol pentru un raport nou; tronsonul de probă (dacă e ales) dă codul și intervalul */
export function formularNou({ proba = null, constructor = '' } = {}) {
  return {
    proba_id: proba ? String(proba.id) : '', tronson: proba ? [proba.cod, proba.denumire].filter(Boolean).join(' — ') : '',
    km_de_la: proba ? fmtKm(proba.km_de_la_m) : '', km_pana_la: proba ? fmtKm(proba.km_pana_la_m) : '',
    lungime_m: proba ? textNr(proba.km_pana_la_m - proba.km_de_la_m) : '', inceput_planificat: '', notificare_la: '', notificare_ref: '',
    data_operatie: '', ora_inceput: '', ora_final: '', temperatura_c: '', temperatura_sursa: '', meteo_la: '', vreme: '', constructor,
    utilaje: [{ denumire: '', buc: '1' }], pig_metalic_buc: '', piston_pu_buc: '', bureti_buc: '',
    cantariri: Array.from({ length: NR_CANTARIRI_MODEL }, (_, i) => ({ nr: i + 1, intrare_kg: '', iesire_kg: '' })),
    punct_roua_c: '', punct_roua_loc: '', presiune_bar: '', timp_deplasare_min: '', observatii: '', concluzie: '',
    semn_constructor_nume: '', semn_constructor_functie: '', semn_beneficiar_nume: '', semn_beneficiar_functie: '',
  }
}
/** rândul serverului → formularul (texte; numerele cu virgulă, momentele în ora României) */
export function formularDinRand(r) {
  return {
    proba_id: r.proba_id == null ? '' : String(r.proba_id), tronson: txt(r.tronson), km_de_la: fmtKm(r.km_de_la_m), km_pana_la: fmtKm(r.km_pana_la_m),
    lungime_m: textNr(r.lungime_m), inceput_planificat: oraLocalaDinIso(r.inceput_planificat), notificare_la: oraLocalaDinIso(r.notificare_la),
    notificare_ref: txt(r.notificare_ref), data_operatie: txt(r.data_operatie), ora_inceput: oraLocalaDinIso(r.ora_inceput),
    ora_final: oraLocalaDinIso(r.ora_final), temperatura_c: textNr(r.temperatura_c), temperatura_sursa: txt(r.temperatura_sursa),
    meteo_la: txt(r.meteo_la), vreme: txt(r.vreme), constructor: txt(r.constructor),
    utilaje: (r.utilaje || []).map(u => ({ denumire: txt(u.denumire), buc: String(u.buc) })),
    pig_metalic_buc: textNr(r.pig_metalic_buc), piston_pu_buc: textNr(r.piston_pu_buc), bureti_buc: textNr(r.bureti_buc),
    cantariri: (r.cantariri || []).map(c => ({ nr: c.nr, intrare_kg: textNr(c.intrare_kg), iesire_kg: textNr(c.iesire_kg) })),
    punct_roua_c: textNr(r.punct_roua_c), punct_roua_loc: txt(r.punct_roua_loc), presiune_bar: textNr(r.presiune_bar),
    timp_deplasare_min: textNr(r.timp_deplasare_min), observatii: txt(r.observatii), concluzie: txt(r.concluzie),
    semn_constructor_nume: txt(r.semn_constructor_nume), semn_constructor_functie: txt(r.semn_constructor_functie),
    semn_beneficiar_nume: txt(r.semn_beneficiar_nume), semn_beneficiar_functie: txt(r.semn_beneficiar_functie),
  }
}
const CAMP_ETICHETA = {
  proba_id: 'tronsonul de probă', tronson: 'tronsonul', km_de_la: 'de la km', km_pana_la: 'la km', lungime_m: 'lungimea (m)',
  inceput_planificat: 'începutul planificat', notificare_la: 'notificarea beneficiarului', data_operatie: 'data operației',
  ora_inceput: 'ora de început', ora_final: 'ora de final', temperatura_c: 'temperatura (°C)', pig_metalic_buc: 'PIG metalic (buc)',
  piston_pu_buc: 'pistonul poliuretan (buc)', bureti_buc: 'bureții (buc)', punct_roua_c: 'punctul de rouă (°C)', presiune_bar: 'presiunea (bar)',
  timp_deplasare_min: 'timpul de deplasare (min)',
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
function moment(f, k, erori) {
  const v = isoDinOraLocala(f[k])
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
    const a = parseNumar(c.intrare_kg), b = parseNumar(c.iesire_kg)
    for (const [x, ce] of [[a, 'la intrare'], [b, 'la ieșire']]) {
      if (x !== null && (!finit(x) || x < 0.001 || x > 1000 || !areMaxZecimale(x, 3))) erori.push(`buretele ${c.nr} ${ce}: kg între 0,001 și 1000, cel mult 3 zecimale`)
    }
    cantariri.push({ nr: c.nr, intrare_kg: finit(a) ? a : null, iesire_kg: finit(b) ? b : null })
  }
  const temperatura = numar(f, 'temperatura_c', { min: -50, max: 60, zec: 1 }, erori)
  const sursa = temperatura === null ? null : (f.temperatura_sursa === 'meteo' ? 'meteo' : 'manual')
  const date = {
    proba_id: f.proba_id ? Number(f.proba_id) : null, tronson: textSau(f.tronson), km_de_la_m: Number.isFinite(km1) ? km1 : null,
    km_pana_la_m: Number.isFinite(km2) ? km2 : null, lungime_m: numar(f, 'lungime_m', { min: 0.1, max: 1000000, zec: 1 }, erori),
    inceput_planificat: moment(f, 'inceput_planificat', erori), notificare_la: moment(f, 'notificare_la', erori), notificare_ref: textSau(f.notificare_ref),
    data_operatie: textSau(f.data_operatie), ora_inceput: moment(f, 'ora_inceput', erori), ora_final: moment(f, 'ora_final', erori),
    temperatura_c: temperatura, temperatura_sursa: sursa, meteo_la: sursa === 'meteo' ? (textSau(f.meteo_la) || null) : null, vreme: textSau(f.vreme),
    constructor: textSau(f.constructor), utilaje,
    pig_metalic_buc: numar(f, 'pig_metalic_buc', { min: 0, max: 99, zec: 0 }, erori), piston_pu_buc: numar(f, 'piston_pu_buc', { min: 0, max: 99, zec: 0 }, erori),
    bureti_buc: numar(f, 'bureti_buc', { min: 0, max: 99, zec: 0 }, erori), cantariri,
    punct_roua_c: numar(f, 'punct_roua_c', { min: -100, max: 50, zec: 1 }, erori), punct_roua_loc: textSau(f.punct_roua_loc),
    presiune_bar: numar(f, 'presiune_bar', { min: 0.01, max: 100, zec: 2 }, erori), timp_deplasare_min: numar(f, 'timp_deplasare_min', { min: 0.1, max: 10000, zec: 1 }, erori),
    observatii: textSau(f.observatii), concluzie: f.concluzie === 'conform' || f.concluzie === 'neconform' ? f.concluzie : null,
    semn_constructor_nume: textSau(f.semn_constructor_nume), semn_constructor_functie: textSau(f.semn_constructor_functie),
    semn_beneficiar_nume: textSau(f.semn_beneficiar_nume), semn_beneficiar_functie: textSau(f.semn_beneficiar_functie),
  }
  if (date.ora_final && !date.ora_inceput && !String(f.ora_inceput ?? '').trim()) erori.push('ora de final cere ora de început')
  if (date.ora_final && date.ora_inceput && Date.parse(date.ora_final) <= Date.parse(date.ora_inceput)) erori.push('ora de final trebuie să fie după ora de început')
  if (new Set(cantariri.map(c => c.nr)).size !== cantariri.length) erori.push('cântăririle: numerele bureților se repetă')
  return { date, erori }
}
/** formularul are modificări față de rândul salvat (comparând valorile care s-ar trimite) */
export function areModificari(f, r) {
  if (!f || !r) return false
  const a = payloadDinFormular(f), b = payloadDinFormular(formularDinRand(r))
  return JSON.stringify(a.date) !== JSON.stringify(b.date)
}

// ── meteo: propunerea din vremea curentă a șantierului (meteo_cache, umplut de meteo-sync) ──
/** rândul meteo_cache → { temperatura_c (o zecimală), vreme, meteo_la } sau null dacă lipsește temperatura */
export function propunereMeteo(rand) {
  const t = Number(rand?.curent?.temp)
  if (rand?.curent?.temp == null || !Number.isFinite(t) || !rand?.actualizat_la) return null
  return { temperatura_c: textNr(Math.round(t * 10) / 10), vreme: String(rand.curent.vreme || '').slice(0, 120), meteo_la: rand.actualizat_la }
}

// ── afișare ──
export const fmtNr = (x, z = 1) => (x == null || x === '' || !Number.isFinite(Number(x)) ? '' : Number(x).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: z }))
export function numeFisierRaport(u) {
  const t = String(u?.tronson || 'tronson').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `Raport_uscare_${t || 'tronson'}_${u?.data_operatie || 'fara_data'}${u?.revizie ? `_rev${u.revizie}` : ''}.pdf`
}
