// ═══════════════════════════════════════════════════════════════════════════
// probeTronsoaneLogica.js — logica pură pentru „🧪 Probe pe tronsoane” (Execuție → proiect)
// Cererea lui Răzvan, 09.11.2026: un tronson de probă = un interval de km pe proiect (P1, P2…), format din tronsoanele de execuție
// (se pot secționa: P1 = T1 + T2 + T3 + 400 m din T4), cu etapele pistonare / uscare / calibrare / probă de presiune.
// Tabelele: executie_probe_tronsoane / _etape / _jurnal (migrarea 20261202a). Fără React, fără Supabase: km, compunerea din
// tronsoane, acoperirea traseului (banda), stările și tranzițiile etapelor (aceeași listă ca în SQL, test de paritate), validarea
// formularului (serverul o refă) și payload-urile RPC.
// ═══════════════════════════════════════════════════════════════════════════

import { parseNumar, areMaxZecimale } from './izoDocumenteLogica.js'
import { fmtKm } from './lib/izoKml.js'

export { fmtKm }

// ── etapele, în ordinea de lucru cerută ──
export const ETAPE = ['pistonare', 'uscare', 'calibrare', 'presiune']
export const ETICHETE_ETAPA = {
  pistonare: 'Pistonare / curățare', uscare: 'Uscare', calibrare: 'Calibrare', presiune: 'Probă de presiune',
}
export const STARI = ['urmeaza', 'in_curs', 'facut', 'refacere', 'nu_se_aplica']
export const ETICHETE_STARE = {
  urmeaza: 'Urmează', in_curs: 'În curs', facut: 'Făcut', refacere: 'De refăcut', nu_se_aplica: 'Nu se aplică',
}
export const CULORI_STARE = {
  urmeaza: '#8B949E', in_curs: '#58A6FF', facut: '#3FB950', refacere: '#F85149', nu_se_aplica: '#484F58',
}
export const CULOARE_NECUNOSCUTA = '#FFFFFF'
export const culoareStare = s => CULORI_STARE[s] || CULOARE_NECUNOSCUTA
export const ICON_STARE = { urmeaza: '○', in_curs: '◐', facut: '✓', refacere: '✕', nu_se_aplica: '–' }

// Tranzițiile permise — ACEEAȘI listă ca fn_executie_proba_tranzitie din migrare (testul de paritate citește blocul
// TRANZITII-START / TRANZITII-END din fișierul SQL). „in_curs → in_curs” = actualizare / citire nouă; „facut → facut” = corectură.
export const TRANZITII = [
  ['urmeaza', 'in_curs'], ['urmeaza', 'facut'], ['urmeaza', 'refacere'], ['urmeaza', 'nu_se_aplica'],
  ['in_curs', 'in_curs'], ['in_curs', 'facut'], ['in_curs', 'refacere'],
  ['refacere', 'in_curs'], ['refacere', 'facut'],
  ['facut', 'facut'], ['facut', 'refacere'],
  ['nu_se_aplica', 'urmeaza'],
]
export const tranzitiePermisa = (veche, noua) => TRANZITII.some(([v, n]) => v === veche && n === noua)
export const stariUrmatoare = veche => TRANZITII.filter(([v]) => v === veche).map(([, n]) => n)
/** Eticheta acțiunii din formular (aceeași stare = actualizare / corectură). */
export function etichetaActiune(veche, noua) {
  if (veche === noua) return veche === 'facut' ? 'Corectură (rămâne făcut)' : 'Actualizare (rămâne în curs)'
  return ETICHETE_STARE[noua] || noua
}

// Ce cere fiecare pas (aceleași reguli ca în RPC)
export const cereMotiv = (veche, noua) => noua === 'refacere' || noua === 'nu_se_aplica' || veche === 'facut' || veche === 'nu_se_aplica'
export const faraValori = noua => noua === 'urmeaza' || noua === 'nu_se_aplica'
export const ZILE_INAPOI = 730
export const FLUIDE = { apa: 'Apă', aer: 'Aer', azot: 'Azot' }
export const PLACI = { ok: 'Placa OK', deformata: 'Placa deformată' }

/** Câmpurile proprii fiecărei etape (cheile din formular; RPC-ul primește câmpurile celorlalte etape NULL). */
export const CAMPURI = {
  pistonare: ['nr'],
  uscare: ['roua'],
  calibrare: ['placa'],
  presiune: ['fluid', 'pproba', 'pcur', 'durata', 'calc'],
}

// ── km: „10+400” sau metri întregi „10400” (helper-ul existent parseNumar; zecimalele / separatorii ambigui = refuz, nu rotunjire) ──
/** text -> metri întregi; '' -> null; format greșit -> NaN */
export function parseKm(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : NaN
  const s = String(v).trim().replace(/\s+/g, '')
  if (!s) return null
  const m = /^(\d{1,4})\+(\d{3})$/.exec(s)
  if (m) return Number(m[1]) * 1000 + Number(m[2])
  if (s.includes('+')) return NaN
  const x = parseNumar(s)
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : NaN
}
/** metri -> „1.250 m” / „12,4 km” (pentru lungimi) */
export function fmtLungime(m) {
  if (!Number.isFinite(m)) return '—'
  if (Math.abs(m) >= 10000) return `${(m / 1000).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} km`
  return `${Math.round(m).toLocaleString('ro-RO')} m`
}
export const fmtInterval = (a, b) => `km ${fmtKm(a)} → ${fmtKm(b)}`

// ── tronsoanele de execuție: doar cele cu km valizi; restul se raportează separat ──
export function tronsoaneCuKm(tronsoane) {
  const valide = [], faraKm = []
  for (const t of tronsoane || []) {
    const a = Number(t.km_start_m), b = Number(t.km_end_m)
    if (t.km_start_m == null || t.km_end_m == null || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) faraKm.push(t.cod)
    else valide.push({ id: t.id, cod: t.cod, de_la: a, pana_la: b })
  }
  valide.sort((x, y) => x.de_la - y.de_la || x.pana_la - y.pana_la || String(x.cod).localeCompare(String(y.cod)))
  return { valide, faraKm }
}

/** Intervalele [a, b) ale unei liste, unite (sortate, fără suprapuneri). */
export function uneste(intervale) {
  const s = (intervale || []).filter(x => x.pana_la > x.de_la).map(x => [x.de_la, x.pana_la]).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const out = []
  for (const [a, b] of s) {
    const u = out[out.length - 1]
    if (u && a <= u[1]) u[1] = Math.max(u[1], b)
    else out.push([a, b])
  }
  return out.map(([de_la, pana_la]) => ({ de_la, pana_la }))
}
/** Ce rămâne din [a, b) după scoaterea intervalelor date (golurile). */
export function goluri(a, b, intervale) {
  const out = []
  let x = a
  for (const u of uneste(intervale)) {
    if (u.pana_la <= x) continue
    if (u.de_la >= b) break
    if (u.de_la > x) out.push({ de_la: x, pana_la: Math.min(u.de_la, b) })
    x = Math.max(x, u.pana_la)
    if (x >= b) break
  }
  if (x < b) out.push({ de_la: x, pana_la: b })
  return out
}

/**
 * Din ce tronsoane de execuție e format intervalul [deLa, panaLa) al unei probe.
 * bucati: [{cod, de_la, pana_la, lungime, integral}], în ordinea km; text: „T1 + T2 + T3 + 400 m din T4”;
 * neacoperit: porțiunile din probă care nu cad pe niciun tronson cu km (traseu necunoscut sau în afara proiectului).
 */
export function compozitie(deLa, panaLa, tronsoane) {
  const { valide, faraKm } = tronsoaneCuKm(tronsoane)
  if (!Number.isFinite(deLa) || !Number.isFinite(panaLa) || panaLa <= deLa) return { bucati: [], text: '', neacoperit: [], faraKm }
  const bucati = []
  for (const t of valide) {
    const a = Math.max(deLa, t.de_la), b = Math.min(panaLa, t.pana_la)
    if (b <= a) continue
    bucati.push({ cod: t.cod, de_la: a, pana_la: b, lungime: b - a, integral: a === t.de_la && b === t.pana_la, lungimeTronson: t.pana_la - t.de_la })
  }
  const text = bucati.map(x => (x.integral ? x.cod : `${fmtLungime(x.lungime)} din ${x.cod}`)).join(' + ')
  return { bucati, text, neacoperit: goluri(deLa, panaLa, valide), faraKm }
}

/**
 * Acoperirea traseului de probele active (pentru bandă și sumar). Traseul cunoscut = tronsoanele de execuție cu km.
 * acoperit / total în metri; neacoperit = golurile din traseu; inAfara = probe în afara tronsoanelor.
 * Fără traseu cunoscut (L18): total = null (necunoscut, NU suma probelor), neacoperit = [] (nu se știe), banda se desenează doar pe probe.
 */
export function acoperire(probe, tronsoane) {
  const { valide } = tronsoaneCuKm(tronsoane)
  const active = (probe || []).filter(p => p.stare === 'activ' && Number.isFinite(p.km_de_la_m) && Number.isFinite(p.km_pana_la_m) && p.km_pana_la_m > p.km_de_la_m)
    .map(p => ({ de_la: p.km_de_la_m, pana_la: p.km_pana_la_m }))
  const traseu = uneste(valide)
  if (!traseu.length) {
    const u = uneste(active)
    if (!u.length) return { de_la: 0, pana_la: 0, total: null, acoperit: 0, neacoperit: [], inAfara: [], traseuCunoscut: false }
    return { de_la: u[0].de_la, pana_la: u[u.length - 1].pana_la, total: null, acoperit: u.reduce((s, x) => s + (x.pana_la - x.de_la), 0),
      neacoperit: [], inAfara: [], traseuCunoscut: false }
  }
  const baza = traseu
  const de_la = baza[0].de_la, pana_la = baza[baza.length - 1].pana_la
  const total = baza.reduce((s, x) => s + (x.pana_la - x.de_la), 0)
  // acoperit = intersecția probelor cu traseul cunoscut
  let acoperit = 0
  const neacoperit = []
  for (const seg of baza) {
    const g = goluri(seg.de_la, seg.pana_la, active)
    neacoperit.push(...g)
    acoperit += (seg.pana_la - seg.de_la) - g.reduce((s, x) => s + (x.pana_la - x.de_la), 0)
  }
  const inAfara = []
  for (const p of uneste(active)) inAfara.push(...goluri(p.de_la, p.pana_la, baza))
  return { de_la: Math.min(de_la, ...active.map(x => x.de_la)), pana_la: Math.max(pana_la, ...active.map(x => x.pana_la)), total, acoperit, neacoperit, inAfara, traseuCunoscut: true }
}

// ── starea unui tronson de probă, din etapele lui ──
export const STARE_PROBA = {
  gata: { eticheta: 'Gata', culoare: '#3FB950' },
  refacere: { eticheta: 'De refăcut', culoare: '#F85149' },
  in_lucru: { eticheta: 'În lucru', culoare: '#58A6FF' },
  neinceput: { eticheta: 'Neîncepută', culoare: '#8B949E' },
  necunoscut: { eticheta: 'Etape lipsă / necunoscute', culoare: CULOARE_NECUNOSCUTA },
}
/** gata = toate cele 4 etape făcute / nu se aplică (și măcar una făcută); refacere = vreuna de refăcut; în lucru = vreuna pornită. */
export function stareProba(etape) {
  const peEtapa = new Map((etape || []).map(e => [e.etapa, e.stare]))
  if (ETAPE.some(x => !peEtapa.has(x)) || [...peEtapa.values()].some(s => !STARI.includes(s))) return 'necunoscut'
  const s = ETAPE.map(x => peEtapa.get(x))
  if (s.some(x => x === 'refacere')) return 'refacere'
  if (s.every(x => x === 'facut' || x === 'nu_se_aplica') && s.some(x => x === 'facut')) return 'gata'
  if (s.some(x => x === 'in_curs' || x === 'facut')) return 'in_lucru'
  return 'neinceput'
}
/** Presiunea curentă afișată în listă: din etapa de presiune (doar dacă are o citire). */
export function presiuneCurenta(etape) {
  const e = (etape || []).find(x => x.etapa === 'presiune')
  if (!e || e.presiune_curenta_bar == null) return null
  return { bar: Number(e.presiune_curenta_bar), la: e.presiune_curenta_la, proba: e.presiune_proba_bar == null ? null : Number(e.presiune_proba_bar), stare: e.stare }
}
export const fmtBar = x => (Number.isFinite(Number(x)) && x !== null && x !== '' ? `${Number(x).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} bar` : '—')
export const fmtZi = z => (z ? String(z).slice(0, 10).split('-').reverse().join('.') : '—')
export function fmtOra(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── formularul etapei: valorile din câmpurile text -> numere (NaN = scris greșit) ──
const txt = v => (v == null ? '' : String(v).trim())
const nr = v => { const s = txt(v); if (!s) return null; const x = parseNumar(s); return typeof x === 'number' ? x : NaN }
/** Formularul (text) -> valori. Câmpurile care nu țin de etapă sunt ignorate (trimise NULL). */
export function valoriDinFormular(etapa, f) {
  const proprii = new Set(CAMPURI[etapa] || [])
  const ia = (k, fn) => (proprii.has(k) ? fn(f?.[k]) : null)
  return {
    nr: ia('nr', nr), roua: ia('roua', nr), placa: ia('placa', v => txt(v) || null), fluid: ia('fluid', v => txt(v) || null),
    pproba: ia('pproba', nr), pcur: ia('pcur', nr), durata: ia('durata', nr), calc: ia('calc', v => (txt(v) ? Number(txt(v)) : null)),
    rez: txt(f?.rez) || null, obs: txt(f?.obs) || null, motiv: txt(f?.motiv) || null,
  }
}
/** Rândul etapei -> formularul inițial (text). */
export function formularDinEtapa(e) {
  const t = x => (x == null ? '' : String(x).replace('.', ','))
  return {
    nr: t(e?.nr_treceri), roua: t(e?.punct_roua_c), placa: e?.placa || '', fluid: e?.fluid || '',
    pproba: t(e?.presiune_proba_bar), pcur: t(e?.presiune_curenta_bar), durata: t(e?.durata_ore), calc: e?.probe_calc_id == null ? '' : String(e.probe_calc_id),
    rez: e?.rezultat || '', obs: e?.observatii || '', motiv: '',
  }
}

export function scadeZile(zi, n) {
  const [a, l, z] = zi.split('-').map(Number)
  const d = new Date(Date.UTC(a, l - 1, z, 12))
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Validarea formularului etapei, înainte de RPC (serverul o refă). Întoarce lista de erori (gol = ok). */
export function valideazaEtapa({ etapa, stareVeche, stareNoua, data, azi, dataStart, v }) {
  const e = []
  if (!ETAPE.includes(etapa)) e.push('Etapă necunoscută')
  if (!tranzitiePermisa(stareVeche, stareNoua)) e.push(`Pas nepermis: ${ETICHETE_STARE[stareVeche] || stareVeche} → ${ETICHETE_STARE[stareNoua] || stareNoua}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) e.push('Data lipsește')
  else {
    if (data > azi) e.push('Data e în viitor')
    if (data < scadeZile(azi, ZILE_INAPOI)) e.push('Data poate fi cel mult 2 ani în urmă')
    if (stareNoua === 'facut' && dataStart && data < dataStart) e.push(`Data de final e înaintea începutului etapei (${fmtZi(dataStart)})`)
  }
  const verifica = (val, eticheta, min, max, zec, minExclusiv = false) => {
    if (val == null) return
    if (!Number.isFinite(val)) { e.push(`${eticheta}: nu e un număr`); return }
    if ((minExclusiv ? val <= min : val < min) || val > max) e.push(`${eticheta}: în afara domeniului`)
    else if (!areMaxZecimale(val, zec)) e.push(`${eticheta}: cel mult ${zec} ${zec === 1 ? 'zecimală' : 'zecimale'}`)
  }
  if (v.nr != null && (!Number.isInteger(v.nr) || v.nr < 1 || v.nr > 500)) e.push('Numărul de treceri: întreg între 1 și 500')
  verifica(v.roua, 'Punctul de rouă', -100, 50, 1)
  verifica(v.pproba, 'Presiunea de probă', 0, 250, 2, true)
  verifica(v.pcur, 'Presiunea curentă', 0, 300, 2)
  verifica(v.durata, 'Durata', 0, 2000, 1, true)
  if (v.placa != null && !(v.placa in PLACI)) e.push('Placa: alege OK sau deformată')
  if (v.fluid != null && !(v.fluid in FLUIDE)) e.push('Fluidul: alege apă, aer sau azot')
  if (v.calc != null && !(Number.isInteger(v.calc) && v.calc > 0)) e.push('Proba din modulul Probe: alege din listă')
  if (cereMotiv(stareVeche, stareNoua) && !v.motiv) e.push('Scrie motivul')
  if (faraValori(stareNoua) && (v.nr != null || v.roua != null || v.placa != null || v.fluid != null || v.pproba != null || v.pcur != null || v.durata != null || v.calc != null || v.rez != null)) {
    e.push('O etapă care urmează / nu se aplică nu are valori')
  }
  if (stareNoua === 'facut' && etapa === 'pistonare' && v.nr == null) e.push('Scrie numărul de treceri')
  if (stareNoua === 'facut' && etapa === 'calibrare' && v.placa !== 'ok') e.push('Calibrarea e făcută doar cu placa OK (deformată = de refăcut)')
  if ((stareNoua === 'in_curs' || stareNoua === 'facut') && etapa === 'presiune' && v.pproba == null) e.push('Scrie presiunea de probă')
  if (stareNoua === 'facut' && etapa === 'presiune' && v.durata == null) e.push('Scrie durata probei')
  if ((v.rez || '').length > 300 || (v.obs || '').length > 2000 || (v.motiv || '').length > 500) e.push('Text prea lung')
  return e
}

/** Payload-ul RPC-ului fn_executie_proba_etapa (fără cheie). Câmpurile altor etape și cele ale unei etape fără valori = NULL. */
export function payloadEtapa(et, { stareNoua, data, v }) {
  const goale = faraValori(stareNoua)
  const p = (k, val) => (!goale && (CAMPURI[et.etapa] || []).includes(k) ? val : null)
  return Object.freeze({
    p_etapa_id: et.id, p_stare_veche: et.stare, p_versiune: et.versiune, p_stare_noua: stareNoua, p_data: data,
    p_nr_treceri: p('nr', v.nr), p_punct_roua_c: p('roua', v.roua), p_placa: p('placa', v.placa), p_fluid: p('fluid', v.fluid),
    p_presiune_proba_bar: p('pproba', v.pproba), p_presiune_curenta_bar: p('pcur', v.pcur), p_durata_ore: p('durata', v.durata),
    p_probe_calc_id: p('calc', v.calc), p_rezultat: goale ? null : v.rez, p_observatii: v.obs, p_motiv: v.motiv,
  })
}

/** Validarea și payload-ul formularului unui tronson de probă (creare: proba = null; modificare: rândul existent). */
export const RE_COD = /^P[0-9]{1,3}[A-Z]?$/
export function valideazaProba({ cod, deLa, panaLa, denumire, observatii }) {
  const e = []
  const c = txt(cod).toUpperCase()
  if (!RE_COD.test(c)) e.push('Codul: P1, P2, P12A…')
  if (deLa == null || panaLa == null) e.push('Scrie km de început și de sfârșit')
  else if (!Number.isFinite(deLa) || !Number.isFinite(panaLa)) e.push('Km: scrie „10+400” sau metri întregi („10400”)')
  else if (deLa < 0 || deLa > 999999 || panaLa > 1000000 || panaLa <= deLa) e.push('Sfârșitul trebuie să fie după început')
  if (txt(denumire).length > 200 || txt(observatii).length > 2000) e.push('Text prea lung')
  return e
}
/** Suprapunerea cu alte probe active (serverul o verifică din nou, sub lock). */
export function suprapuneri(deLa, panaLa, probe, idPropriu = null) {
  return (probe || []).filter(p => p.stare === 'activ' && p.id !== idPropriu && p.km_de_la_m < panaLa && deLa < p.km_pana_la_m)
}
export function payloadProba({ proiectId, proba, cod, deLa, panaLa, denumire, observatii }) {
  return Object.freeze({
    p_proiect: proiectId, p_id: proba ? proba.id : null, p_versiune: proba ? proba.versiune : null, p_cod: txt(cod).toUpperCase(),
    p_km_de_la_m: deLa, p_km_pana_la_m: panaLa, p_denumire: txt(denumire) || null, p_observatii: txt(observatii) || null,
  })
}
/** Codul propus pentru un tronson nou: P<n+1> după cel mai mare număr activ. */
export function codUrmator(probe) {
  const n = (probe || []).filter(p => p.stare === 'activ').map(p => Number((/^P(\d+)/.exec(p.cod) || [])[1])).filter(Number.isFinite)
  return `P${(n.length ? Math.max(...n) : 0) + 1}`
}

// ── L05: o salvare cu rezultat necunoscut se reia cu ACEEAȘI cheie doar dacă cererea e identică; altfel întâi se reîncarcă ──
/**
 * Refuz DETERMINIST al serverului = nimic nu s-a scris: excepțiile RPC-urilor (codurile SQLSTATE ridicate de ele: parametri / reguli
 * 22023, drept 42501, calcul Probe ocupat 55P03, plasa de siguranță 23P01 / 23505 / 23514) și funcția inexistentă (PGRST202,
 * migrarea neaplicată). Orice altceva (rețea, timeout, 5xx, eroare fără cod) = rezultat NECUNOSCUT: cererea se păstrează cu cheia ei.
 */
export const CODURI_REFUZ = ['22023', '42501', '55P03', '23P01', '23505', '23514', 'PGRST202']
export const esteRefuzDeterminist = err => !!err && typeof err.code === 'string' && CODURI_REFUZ.includes(err.code)
/**
 * Rezultatul retrimiterii identice a unei cereri nelămurite (aceeași cheie, același payload):
 *  'aplicat'      — duplicat: se scrisese (definitiv)
 *  'aplicat_acum' — nu ajunsese; s-a aplicat acum, cu valorile de atunci (definitiv)
 *  'neaplicat'    — conflict (CAS) sau refuz al regulilor: verificat DUPĂ cheie pe server, deci cheia nu era scrisă (definitiv)
 *  'fara_drept'   — 42501: dreptul se verifică ÎNAINTE de cheie, deci refuzul nu dovedește nimic; se mai caută cheia în jurnal
 *  'necunoscut'   — rețea / timeout / calcul ocupat (55P03) / funcție lipsă: cererea rămâne nelămurită
 */
export function clasificaReluare({ r, error }) {
  if (error) {
    if (!esteRefuzDeterminist(error) || error.code === '55P03' || error.code === 'PGRST202') return 'necunoscut'
    return error.code === '42501' ? 'fara_drept' : 'neaplicat'
  }
  if (r?.ok === true) return r.duplicat ? 'aplicat' : 'aplicat_acum'
  if (r?.ok === false) return 'neaplicat'
  return 'necunoscut'
}

// ── L05 persistent: registrul cererilor nelămurite, scris DURABIL înainte de trimitere și păstrat în browser (supraviețuiește
// navigării, schimbării proiectului și reîncărcării paginii), separat pe utilizator + proiect. Fiecare cerere stă sub cheia EI
// (prefix + UUID-ul cererii): două tab-uri nu se suprascriu (nu există citire–modificare–scriere pe o valoare comună), două cereri pe
// aceeași țintă rămân amândouă. O intrare iese doar la un rezultat definitiv sau la renunțarea explicită a omului. ──
export const RPC_PROBE = ['fn_executie_proba_salveaza', 'fn_executie_proba_anuleaza', 'fn_executie_proba_etapa']
export const prefixRegistru = (utilizator, proiect) => `gazpet.probe_tronsoane.incert.v2:${utilizator}:${proiect}:`
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const intrareValida = (x, cheieStocare, prefix, rpcPermise) => !!x && typeof x.tinta === 'string' && rpcPermise.includes(x.rpc) && RE_UUID.test(x.cheie || '')
  && cheieStocare === prefix + x.cheie && !!x.payload && typeof x.payload === 'object' && !Array.isArray(x.payload)
/**
 * Registrul pentru (utilizator, proiect), peste o stocare de tip localStorage (length / key / getItem / setItem / removeItem).
 *  toate()            -> lista intrărilor valide (conținut stricat / străin = ignorat), sau null dacă stocarea nu se poate citi
 *  pentruTinta(tinta) -> intrările unei ținte, sau null
 *  pune(intrare)      -> true doar dacă scrierea DURABILĂ a reușit (altfel cererea NU trebuie trimisă)
 *  scoate(cheie)      -> true dacă intrarea nu mai e în stocare
 * Fără stocare sau fără identitate: registrul nu e utilizabil (pune -> false, toate -> null), deci nu se trimite nimic.
 * `rpcPermise`: RPC-urile acceptate în registru (implicit cele ale probelor; Fibra optică își dă lista ei, alt prefix).
 */
export function registruNou(stocare, prefix, rpcPermise = RPC_PROBE) {
  const ok = !!(stocare && prefix)
  const toate = () => {
    if (!ok) return null
    try {
      const l = []
      for (let i = 0; i < stocare.length; i++) {
        const k = stocare.key(i)
        if (typeof k !== 'string' || !k.startsWith(prefix)) continue
        const brut = stocare.getItem(k)            // o citire eșuată NU e „intrare inexistentă”: aruncă -> tot registrul = null
        let x = null
        try { x = JSON.parse(brut) } catch { x = null }   // doar conținutul stricat se ignoră
        if (intrareValida(x, k, prefix, rpcPermise)) l.push(x)
      }
      return l.sort((a, b) => String(a.pusLa || '').localeCompare(String(b.pusLa || '')) || a.cheie.localeCompare(b.cheie))
    } catch { return null }
  }
  return {
    utilizabil: ok,
    toate,
    pentruTinta: tinta => { const l = toate(); return l && l.filter(x => x.tinta === tinta) },
    pune: intrare => {
      if (!ok || !intrareValida(intrare, prefix + intrare?.cheie, prefix, rpcPermise)) return false
      try {
        stocare.setItem(prefix + intrare.cheie, JSON.stringify(intrare))
        return stocare.getItem(prefix + intrare.cheie) !== null
      } catch { return false }
    },
    scoate: cheie => {
      if (!ok) return false
      try { stocare.removeItem(prefix + cheie); return stocare.getItem(prefix + cheie) === null } catch { return false }
    },
  }
}
/** Aceeași intenție = același RPC și același payload (comparat ca JSON, ca după ce a trecut prin stocare). */
export const aceeasiIntentie = (intrare, rpc, payload) => !!intrare && intrare.rpc === rpc && JSON.stringify(intrare.payload) === JSON.stringify(payload)

// ── listele: o versiune mai veche nu înlocuiește una mai nouă (salvare terminată între timp) ──
const maiVeche = (venit, local) => !!local && Number(venit.versiune) < Number(local.versiune)
export function aplicaRand(lista, rand) {
  if (!rand || rand.id == null) return lista
  const exista = (lista || []).some(x => x.id === rand.id)
  if (!exista) return [...(lista || []), rand]
  return lista.map(x => (x.id === rand.id && !maiVeche(rand, x) ? { ...x, ...rand } : x))
}
export function imbinaLista(citite, curente) {
  const local = new Map((curente || []).map(x => [x.id, x]))
  return (citite || []).map(r => { const l = local.get(r.id); return maiVeche(r, l) ? l : r })
}

/** Ordinea listei: activele după km, apoi anulatele. */
export function ordoneazaProbe(probe) {
  return [...(probe || [])].sort((a, b) => (a.stare === b.stare ? 0 : a.stare === 'activ' ? -1 : 1) || a.km_de_la_m - b.km_de_la_m || a.id - b.id)
}

/** Textul unui rând de jurnal (pentru afișare). */
export function textJurnal(j, etapePeId) {
  const v = j.valori || {}
  if (j.actiune === 'creare') return `Creat ${v.cod || ''}: ${fmtInterval(v.km_de_la_m, v.km_pana_la_m)}`
  if (j.actiune === 'anulare') return `Anulat: ${v.motiv || ''}`
  if (j.actiune === 'modificare') {
    const a = v.inainte || {}, d = v.dupa || {}
    return `Modificat ${a.cod || ''} ${fmtInterval(a.km_de_la_m, a.km_pana_la_m)} → ${d.cod || ''} ${fmtInterval(d.km_de_la_m, d.km_pana_la_m)}`
  }
  const etapa = v.etapa || etapePeId?.get?.(j.etapa_id)?.etapa
  const parti = [`${ETICHETE_ETAPA[etapa] || etapa || 'Etapă'}: ${etichetaActiune(j.stare_veche, j.stare_noua)}`]
  if (v.nr_treceri != null) parti.push(`${v.nr_treceri} treceri`)
  if (v.punct_roua_c != null) parti.push(`rouă ${String(v.punct_roua_c).replace('.', ',')} °C`)
  if (v.placa) parti.push(PLACI[v.placa] || v.placa)
  if (v.fluid) parti.push(FLUIDE[v.fluid] || v.fluid)
  if (v.presiune_proba_bar != null) parti.push(`probă ${fmtBar(v.presiune_proba_bar)}`)
  if (v.presiune_curenta_bar != null) parti.push(`acum ${fmtBar(v.presiune_curenta_bar)}`)
  if (v.durata_ore != null) parti.push(`${String(v.durata_ore).replace('.', ',')} h`)
  if (v.probe_calc_id != null) parti.push(`probă Probe #${v.probe_calc_id}`)
  if (v.rezultat) parti.push(`rezultat: ${v.rezultat}`)
  if (v.motiv) parti.push(`motiv: ${v.motiv}`)
  if (v.observatii) parti.push(v.observatii)
  return parti.join(' · ')
}
