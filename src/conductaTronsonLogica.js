// ═══════════════════════════════════════════════════════════════════════════
// conductaTronsonLogica.js — banda conductei pe un tronson (pasul 2, DOAR CITIRE)
// Contractul: docs/izometrie/CONDUCTA_TRONSOANE_SPEC.md. Fără React, fără Supabase, fără scrieri.
//
// Din rândurile unei scheme (foile Excel confirmate) și/sau din rândurile din platformă (pachetele de lansare)
// produce: piesele poziționate, sudurile, banda pe km (realizat / restant / necunoscut, cu proveniența fiecărui
// interval), totalurile înainte și după reconciliere și raportul de diferențe schemă ↔ platformă.
//
// Reguli (spec §3–§5):
//  • „realizat” = porțiune acoperită de o piesă din sursă (prezentă în schema de montaj), NU stadiu fizic;
//  • „restant” = DOAR intervale restante confirmate explicit (intrare separată); lipsa datelor NU e restant;
//  • „necunoscut” = tot restul din limitele tronsonului (goluri, piese fără poziție, conflicte);
//  • nicio corecție tacită: km neparsabil, lungime invalidă, lanț întrerupt = poziție necunoscută + anomalie;
//  • piesa comună de la frontiera a două foi se reconciliază (o singură piesă, păstrând sudura și ambele rânduri);
//  • calculele se fac în milimetri întregi (fără erori de virgulă mobilă la sume).
// ═══════════════════════════════════════════════════════════════════════════

import { parseNumar, areMaxZecimale } from './izoDocumenteLogica.js'
import { normalizeazaSudura, tronsonNr } from './lib/izoSudura.js'

export const VERSIUNE_REGULI = 'conducta-banda-v2'
export const STARI_BANDA = ['realizat', 'restant', 'necunoscut']
export const ETICHETE_STARE_BANDA = { realizat: 'În schema de montaj', restant: 'Restant confirmat', necunoscut: 'Necunoscut (fără date)' }
/**
 * Convenția km a unei foi (se DECLARĂ și se confirmă, nu se deduce din date — spec §2.3):
 *  - km_capat_pe_rand: fiecare rând are km-ul capătului din aval al piesei (= poziția sudurii de pe rând);
 *  - start_inceput_prima_piesa: foaia are km de început = începutul primei piese; restul din lungimi cumulate;
 *  - start_capat_prima_piesa: km de început = poziția primei suduri (capătul primei piese); restul din lungimi.
 */
export const CONVENTII_KM = ['km_capat_pe_rand', 'start_inceput_prima_piesa', 'start_capat_prima_piesa']
/**
 * Pachetele din platformă: implicit B = „km start = primul rând fizic = prima sudură” (aceeași formulă ca editorul de pachete,
 * src/Izometrie.jsx, „POZ KM cascade”). A = „km start = începutul primei țevi” se folosește DOAR ca o comparație explicită.
 */
export const CONVENTIE_PLATFORMA = 'start_capat_prima_piesa'
export const CONVENTIE_PLATFORMA_COMPARATIE = 'start_inceput_prima_piesa'
/** Toleranțe (mm) — de confirmat de biroul tehnic (spec §8). */
export const TOLERANTA_POZITIE_MM = 50
export const TOLERANTA_LUNGIME_MM = 5
/** Anomaliile care ar bloca publicarea unei revizii (spec §4.4); restul sunt avertismente. */
export const ANOMALII_BLOCANTE = new Set([
  'km_neparsabil', 'km_lipsa', 'lungime_invalida', 'lungime_lipsa', 'km_start_lipsa', 'km_start_rand_fara_piesa', 'lant_intrerupt', 'conventie_km_necunoscuta',
  'conventie_km_neconfirmata', 'suprapunere', 'dublura_identitate', 'frontiera_suduri_diferite', 'frontiera_neconfirmata',
  'sudura_repetata', 'sudura_ilizibila', 'sudura_contradictorie', 'conflict_restant_realizat', 'fel_necunoscut', 'restant_invalid',
])

const FELURI_PIESA = new Set(['teava', 'curba'])
const FELURI = new Set(['teava', 'curba', 'legare', 'separator'])
// „0”, „-” sau gol în coloana SUDURĂ = fără cod pe rând (convenție de confirmat, spec §2.5)
const FARA_COD = new Set(['', '0', '-', '—'])

const txt = v => (v == null ? '' : String(v).trim())
const cheieText = v => txt(v).toUpperCase().replace(/\s+/g, '')
const m = mm => (mm == null ? null : mm / 1000)
const suma = l => l.reduce((s, x) => s + x, 0)
// criteriul final al sortărilor (rezultat independent de ordinea încărcării): id-ul, cu numerele comparate ca numere
const cmpId = (x, y) => String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true })
const cmpPozitie = (x, y) => (x.a_mm ?? Infinity) - (y.a_mm ?? Infinity) || cmpId(x.id, y.id)

/** Lungime / metri (număr sau text RO/EN) → mm întregi. null = lipsă; NaN = invalid (negativ, > 3 zecimale, text). */
export function mmDinMetri(v) {
  const x = parseNumar(v)
  if (x == null) return null
  if (!Number.isFinite(x) || x < 0 || !areMaxZecimale(x, 3)) return NaN
  return Math.round(x * 1000)
}

// km strict: „24+012.46” / „24+012,46” / „24+012” (exact 3 cifre de metri, 1–3 zecimale) sau număr de metri.
const RE_KM = /^(\d{1,3})\+(\d{3})(?:[.,](\d{1,3}))?$/
/** km → mm întregi. null = lipsă; NaN = neparsabil (ex. „1.598.97” — NU se repară tacit). */
export function kmInMm(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && areMaxZecimale(v, 3) ? Math.round(v * 1000) : NaN
  const s = String(v).trim().replace(/\s+/g, '')
  if (!s) return null
  const r = RE_KM.exec(s)
  if (!r) return NaN
  return Number(r[1]) * 1000000 + Number(r[2]) * 1000 + Number((r[3] || '').padEnd(3, '0') || 0)
}

/** mm → „24+012.46” (2 zecimale). */
export function fmtKmMm(mm) {
  if (mm == null || !Number.isFinite(mm)) return '—'
  const s = mm < 0 ? '-' : ''
  const cm = Math.round(Math.abs(mm) / 10)
  const km = Math.floor(cm / 100000), rest = cm % 100000
  return `${s}${km}+${String(Math.floor(rest / 100)).padStart(3, '0')}.${String(rest % 100).padStart(2, '0')}`
}
/** metri → „1.234,56 m” */
export const fmtM = x => (x == null || !Number.isFinite(x) ? '—' : `${x.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`)

function anomalie(cod, mesaj, extra = {}) {
  return { cod, nivel: ANOMALII_BLOCANTE.has(cod) ? 'blocant' : 'avertisment', mesaj, ...extra }
}

// ── sudura de pe un rând (normalizatorul existent, mod „legacy” = LOT 1) ──
function sudura(r, ctxTronson) {
  const original = txt(r.sudura)
  const pending = r.sant_pending === true
  if (FARA_COD.has(original)) {
    return { original, canon: null, refacuta: false, stare: pending ? 'restanta' : 'necunoscuta', motiv: pending ? 'marcaj_sant' : 'fara_cod', pm: txt(r.pm), paut: txt(r.paut) }
  }
  const n = normalizeazaSudura(original, { tronson: ctxTronson, mod: 'legacy' })
  const refacuta = n.refacuta || r.refacuta === true
  if (n.stare !== 'ok') return { original, canon: null, refacuta, stare: 'necunoscuta', motiv: 'ilizibila', pm: txt(r.pm), paut: txt(r.paut) }
  return {
    original, canon: n.canon, refacuta, altTronson: n.altTronson,
    // cod + marcaj „de făcut în șanț” pe același rând = contradicție (nu se alege una)
    stare: pending ? 'necunoscuta' : 'sudata', motiv: pending ? 'contradictie' : null,
    pm: txt(r.pm), paut: txt(r.paut),
  }
}

// validările comune ale sudurii de pe un rând (piesă SAU legare — aceleași reguli, spec §2.5)
function anomaliiSudura(s, p, ref, anomalii) {
  if (s.motiv === 'ilizibila') anomalii.push(anomalie('sudura_ilizibila', `Sudura „${s.original}” (${p.cod}, rândul ${p.rand}) nu se poate citi`, ref))
  if (s.motiv === 'contradictie') anomalii.push(anomalie('sudura_contradictorie', `Sudura ${s.original} (${p.cod}, rândul ${p.rand}) are cod și e marcată „de făcut în șanț”`, ref))
  if (s.altTronson) anomalii.push(anomalie('sudura_alt_tronson', `Sudura ${s.original} (${p.cod}, rândul ${p.rand}) e numerotată pe alt tronson`, ref))
}

// km-ul propriu al unui rând (convenția km_capat_pe_rand): mm sau null + codul anomaliei
function kmRand(r) {
  const k = kmInMm(r.km)
  if (k == null) return { km: null, cod: 'km_lipsa' }
  if (Number.isNaN(k)) return { km: null, cod: 'km_neparsabil' }
  return { km: k, cod: null }
}

/**
 * Piesele și sudurile unei foi, cu poziții după convenția declarată. Nu ghicește nimic: o poziție care nu se poate
 * stabili rămâne null (cu anomalie), iar la convenția cumulată lanțul se oprește acolo (nu se mută piesele următoare).
 * La convențiile cumulate singura ancoră explicită e km-ul de început al foii: după o întrerupere (lungime lipsă / invalidă,
 * tip de rând necunoscut) nimic din aceeași foaie nu mai primește poziție.
 */
function citesteFoaie(foaie, sursa, ctxTronson, anomalii, ignorate) {
  const conv = foaie.conventieKm
  const piese = [], suduriLegare = []
  const fid = foaie.id
  const prov = (r, i) => ({ sursa, foaie: fid, cod: txt(foaie.cod), revizie: foaie.revizie ?? null, stare: txt(foaie.stare), rand: r.rand ?? i + 1, poz: r.poz ?? null, km_original: r.km ?? null })
  if (!CONVENTII_KM.includes(conv)) anomalii.push(anomalie('conventie_km_necunoscuta', `Foaia ${txt(foaie.cod) || fid}: convenția km nu e declarată`, { foaie: fid }))
  else if (foaie.conventieConfirmata !== true) anomalii.push(anomalie('conventie_km_neconfirmata', `Foaia ${txt(foaie.cod) || fid}: convenția km (${conv}) nu e confirmată`, { foaie: fid }))
  const cumulat = conv === 'start_inceput_prima_piesa' || conv === 'start_capat_prima_piesa'
  const laSudura = conv === 'start_capat_prima_piesa' // B: km de început = poziția PRIMULUI RÂND FIZIC (prima sudură)
  const kmStart = cumulat ? kmInMm(foaie.kmStart) : null
  let cur = null
  if (cumulat) {
    if (kmStart == null || Number.isNaN(kmStart)) anomalii.push(anomalie('km_start_lipsa', `Foaia ${txt(foaie.cod) || fid}: km de început lipsă sau invalid`, { foaie: fid, valoare: foaie.kmStart ?? null }))
    else cur = kmStart
  }
  let primulRand = true, lantRaportat = false
  // întreruperea lanțului cumulat: o singură anomalie pe foaie, la primul rând care o produce
  const opresteLant = (p, motiv) => {
    if (cur != null && !lantRaportat) {
      lantRaportat = true
      anomalii.push(anomalie('lant_intrerupt', `Foaia ${p.cod}: de la rândul ${p.rand} pozițiile nu se mai pot calcula (${motiv})`, { foaie: fid, rand: p.rand }))
    }
    cur = null
  }
  // B cu primul rând fără piesă (separator / rând gol / tip necunoscut): km de început ar ancora un rând fără poziție fizică,
  // iar formula editorului ar trata prima țeavă ca la A → ambiguu, nu se alege: foaia rămâne fără poziții
  const startFaraPiesa = (p, motiv) => {
    if (!(cumulat && laSudura && primulRand && cur != null)) return
    anomalii.push(anomalie('km_start_rand_fara_piesa', `Foaia ${p.cod}: km de început (prima sudură) cade pe rândul ${p.rand}, care nu e piesă (${motiv}): pozițiile foii nu se pot stabili`, { foaie: fid, rand: p.rand, motiv }))
    lantRaportat = true
    cur = null
  }
  const randuri = foaie.randuri || []
  randuri.forEach((r, i) => {
    const fel = txt(r.fel)
    const p = prov(r, i)
    if (!FELURI.has(fel)) {
      // incertitudine: rândul poate fi o piesă cu lungime → întrerupe lanțul cumulat (piesele următoare NU se poziționează)
      ignorate.push({ ...p, motiv: 'fel_necunoscut' })
      anomalii.push(anomalie('fel_necunoscut', `Rândul ${p.rand} din ${p.cod}: tip de rând necunoscut „${fel}”`, { foaie: fid, rand: p.rand }))
      if (cumulat) { startFaraPiesa(p, 'tip necunoscut'); opresteLant(p, 'tip de rând necunoscut') }
      primulRand = false
      return
    }
    if (fel === 'separator') { ignorate.push({ ...p, motiv: 'separator' }); startFaraPiesa(p, 'separator'); primulRand = false; return }
    const L = mmDinMetri(r.lungime)
    // rând gol = țeavă fără serie, fără lungime și fără sudură; o CURBĂ fără date rămâne piesă (există, dar fără lungime / poziție)
    if (fel === 'teava' && !txt(r.serie) && (L == null || L === 0) && FARA_COD.has(txt(r.sudura)) && r.sant_pending !== true) {
      ignorate.push({ ...p, motiv: 'rand_gol' }); startFaraPiesa(p, 'rând gol'); primulRand = false; return
    }

    if (fel === 'legare') {
      // sudură fără piesă: la poziția curentă (cumulat) sau la km-ul rândului — cu ACELEAȘI validări ca sudura unei piese
      const id = `${sursa}:${fid}:${p.rand}`
      let km = null
      if (cumulat) km = cur
      else {
        const k = kmRand(r)
        km = k.km
        if (k.cod === 'km_neparsabil') anomalii.push(anomalie('km_neparsabil', `Km „${txt(r.km)}” (${p.cod}, rândul ${p.rand}, sudură de legare) nu se poate citi: sudura rămâne fără poziție`, { sudura: id, valoare: r.km }))
        else if (k.cod) anomalii.push(anomalie(k.cod, `${p.cod}, rândul ${p.rand} (sudură de legare): km lipsă`, { sudura: id, valoare: r.km ?? null }))
      }
      primulRand = false
      const s = sudura(r, ctxTronson)
      anomaliiSudura(s, p, { sudura: id }, anomalii)
      suduriLegare.push({ ...s, km_mm: km, piesa: null, id, provenienta: [p] })
      return
    }

    const an = []
    let a = null, b = null, kmSudura = null
    const Lok = Number.isInteger(L)
    if (L == null) an.push('lungime_lipsa')
    else if (!Lok) an.push('lungime_invalida')
    else if (L === 0) an.push('lungime_zero')
    if (cumulat) {
      if (laSudura && primulRand && cur != null) {
        // B, primul rând = piesă: sudura ei e chiar km-ul de început; lanțul continuă de acolo chiar dacă lungimea lipsește
        kmSudura = cur
        if (Lok) { a = cur - L; b = cur }
      } else if (cur != null && Lok) { a = cur; b = cur + L; cur = b; kmSudura = b }
      else opresteLant(p, 'lungime lipsă sau invalidă')
    } else {
      const k = kmRand(r)
      if (k.cod) an.push(k.cod)
      else { kmSudura = k.km; if (Lok) { b = k.km; a = k.km - L } }
    }
    primulRand = false
    const s = sudura(r, ctxTronson)
    const piesa = {
      id: `${sursa}:${fid}:${p.rand}`, sursa, fel, serie: txt(r.serie), tip: txt(r.tip), dim: txt(r.dim), sarja: txt(r.sarja),
      lungime_mm: Lok ? L : null, a_mm: a, b_mm: b, sudura: { ...s, km_mm: kmSudura }, provenienta: [p], anomalii: an, frontiera: false,
    }
    for (const c of an) {
      if (c === 'lungime_zero') anomalii.push(anomalie(c, `${fel === 'curba' ? 'Curba' : 'Țeava'} ${piesa.serie || '(fără serie)'} (${p.cod}, rândul ${p.rand}) are lungime 0: nu acoperă nimic pe bandă`, { piesa: piesa.id }))
      else if (c === 'km_neparsabil') anomalii.push(anomalie(c, `Km „${txt(r.km)}” (${p.cod}, rândul ${p.rand}) nu se poate citi: piesa rămâne fără poziție`, { piesa: piesa.id, valoare: r.km }))
      else anomalii.push(anomalie(c, `${p.cod}, rândul ${p.rand}: ${c.replace(/_/g, ' ')}`, { piesa: piesa.id, valoare: c.startsWith('km') ? r.km ?? null : r.lungime ?? null }))
    }
    anomaliiSudura(s, p, { piesa: piesa.id }, anomalii)
    piese.push(piesa)
  })
  return { piese, suduriLegare }
}

const aceeasiPiesa = (x, y) => !!x.serie && cheieText(x.serie) === cheieText(y.serie) && cheieText(x.tip) === cheieText(y.tip)

/**
 * Piesa comună de la frontiera a două foi consecutive (spec §2.4): aceeași serie + tip, aceeași lungime (± toleranță) și
 * aceeași poziție (± toleranță, ambele cunoscute) → o singură piesă; sudura se păstrează (cea cu cod), proveniența are ambele rânduri.
 * Aceeași serie fără poziție confirmabilă → nu se unește (anomalie). Suduri diferite pe cele două apariții → nu se alege una.
 */
function reconciliazaFrontiere(foiCitite, anomalii) {
  const frontiere = []
  const out = []
  foiCitite.forEach((f, k) => {
    let lista = f.piese
    if (k > 0 && out.length && lista.length) {
      const x = out[out.length - 1], y = lista[0]
      if (aceeasiPiesa(x, y) && x.provenienta[0].foaie !== y.provenienta[0].foaie) {
        const lungEgal = x.lungime_mm != null && y.lungime_mm != null && Math.abs(x.lungime_mm - y.lungime_mm) <= TOLERANTA_LUNGIME_MM
        const pozEgal = x.b_mm != null && y.b_mm != null && Math.abs(x.b_mm - y.b_mm) <= TOLERANTA_POZITIE_MM
        if (lungEgal && pozEgal) {
          const sx = x.sudura, sy = y.sudura
          let s
          if (sx.canon && sy.canon && (sx.canon !== sy.canon || sx.refacuta !== sy.refacuta)) {
            s = { ...sy, stare: 'necunoscuta', motiv: 'frontiera', alternativa: sx.original }
            anomalii.push(anomalie('frontiera_suduri_diferite', `Piesa ${x.serie} apare la frontieră cu suduri diferite (${sx.original} / ${sy.original})`, { piesa: x.id }))
          } else s = sy.canon ? sy : sx.canon ? sx : (sy.stare === 'restanta' ? sy : sx)
          const unita = { ...x, sudura: { ...s, km_mm: x.b_mm }, provenienta: [...x.provenienta, ...y.provenienta], frontiera: true, anomalii: [...new Set([...x.anomalii, ...y.anomalii])] }
          out[out.length - 1] = unita
          frontiere.push({ piesa: unita.id, serie: x.serie, lungime_m: m(x.lungime_mm), km_mm: x.b_mm, sudura: s.original || null, randuri: unita.provenienta.map(p => `${p.cod}#${p.rand}`) })
          lista = lista.slice(1)
        } else {
          anomalii.push(anomalie('frontiera_neconfirmata', `Piesa ${x.serie} apare la capătul a două foi, dar lungimea sau poziția nu se potrivesc (sau lipsesc): nu s-a unit`, { piesa: y.id }))
        }
      }
    }
    out.push(...lista)
  })
  return { piese: out, frontiere }
}

/** Ordinea foilor: `ordine`, apoi km de început, apoi id. */
function ordoneazaFoi(foi) {
  const k = f => { const x = kmInMm(f.kmStart); return x == null || Number.isNaN(x) ? Infinity : x }
  return [...(foi || [])].sort((a, b) => (a.ordine ?? Infinity) - (b.ordine ?? Infinity) || k(a) - k(b) || String(a.id).localeCompare(String(b.id), 'ro', { numeric: true }))
}

/** Limitele tronsonului în mm (km_start_m / km_end_m în metri, ca în executie_tronsoane); null dacă lipsesc. */
export function limiteTronson(t) {
  const a = kmInMm(t?.km_start_m), b = kmInMm(t?.km_end_m)
  return Number.isInteger(a) && Number.isInteger(b) && b > a ? { a, b } : null
}

/**
 * Banda: segmente elementare din limitele tronsonului, fiecare cu starea și proveniența (piesele / intervalele restante).
 * Fără limitele tronsonului, banda acoperă doar ÎNTINDEREA datelor (piese + restanțe) — nu e lungimea tronsonului.
 * Suprapunerea pieselor nu se ascunde și NU depinde de starea segmentului: `suprapunere: true` + anomalia `suprapunere`
 * apar și pe un segment devenit „necunoscut / conflict”.
 */
function construiesteBanda(piese, restante, lim, anomalii) {
  const poz = piese.filter(p => p.a_mm != null && p.b_mm != null && p.b_mm > p.a_mm)
  let a0, b0
  if (lim) { a0 = lim.a; b0 = lim.b }
  else if (poz.length || restante.length) {
    a0 = Math.min(...poz.map(p => p.a_mm), ...restante.map(r => r.a))
    b0 = Math.max(...poz.map(p => p.b_mm), ...restante.map(r => r.b))
  } else return { segmente: [], limite: null, in_afara_mm: 0 }
  let in_afara_mm = 0
  const cl = []
  for (const p of poz) {
    const a = Math.max(p.a_mm, a0), b = Math.min(p.b_mm, b0)
    const afara = (p.b_mm - p.a_mm) - Math.max(0, b - a)
    if (afara > 0) {
      in_afara_mm += afara
      anomalii.push(anomalie('in_afara_limitelor', `Piesa ${p.serie || p.id} iese din limitele tronsonului cu ${fmtM(m(afara))}`, { piesa: p.id }))
    }
    if (b > a) cl.push({ id: p.id, a, b })
  }
  const rest = restante.map(r => ({ ...r, a: Math.max(r.a, a0), b: Math.min(r.b, b0) })).filter(r => r.b > r.a)
  const pts = [...new Set([a0, b0, ...cl.flatMap(x => [x.a, x.b]), ...rest.flatMap(x => [x.a, x.b])])].sort((x, y) => x - y)
  const seg = []
  for (let i = 0; i < pts.length - 1; i++) {
    const x = pts[i], y = pts[i + 1]
    const peste = cl.filter(p => p.a <= x && p.b >= y).map(p => p.id)
    const r = rest.filter(q => q.a <= x && q.b >= y).map(q => q.idx)
    let stare, motiv = null
    if (peste.length && r.length) { stare = 'necunoscut'; motiv = 'conflict' }
    else if (peste.length) stare = 'realizat'
    else if (r.length) stare = 'restant'
    else { stare = 'necunoscut'; motiv = 'fara_date' }
    const u = seg[seg.length - 1]
    const cheie = `${stare}|${motiv}|${peste.join(',')}|${r.join(',')}`
    if (u && u._k === cheie && u.pana_la_mm === x) u.pana_la_mm = y
    else seg.push({ _k: cheie, de_la_mm: x, pana_la_mm: y, stare, motiv, piese: peste, restante: r, suprapunere: peste.length > 1 })
  }
  // anomaliile de suprapunere / conflict, pe porțiuni continue
  for (const s of seg) {
    if (s.suprapunere) anomalii.push(anomalie('suprapunere', `Piese suprapuse pe km ${fmtKmMm(s.de_la_mm)}–${fmtKmMm(s.pana_la_mm)} (${fmtM(m(s.pana_la_mm - s.de_la_mm))})`, { piese: s.piese }))
    if (s.motiv === 'conflict') anomalii.push(anomalie('conflict_restant_realizat', `Km ${fmtKmMm(s.de_la_mm)}–${fmtKmMm(s.pana_la_mm)}: raportat restant, dar acoperit de piese în schemă`, { piese: s.piese }))
  }
  return {
    segmente: seg.map(({ _k, de_la_mm, pana_la_mm, ...s }) => ({ de_la_mm, pana_la_mm, de_la_m: m(de_la_mm), pana_la_m: m(pana_la_mm), lungime_m: m(pana_la_mm - de_la_mm), ...s })),
    limite: { a: a0, b: b0 }, in_afara_mm,
  }
}

/** Dubluri de identitate în aceeași sursă (după frontiere): aceeași serie+tip+lungime = de decis; lungimi diferite = bucăți tăiate. */
function verificaIdentitati(piese, anomalii) {
  const grupe = new Map()
  for (const p of piese) {
    if (!p.serie) continue
    const k = `${cheieText(p.tip)}|${cheieText(p.serie)}`
    if (!grupe.has(k)) grupe.set(k, [])
    grupe.get(k).push(p)
  }
  let bucatiTaiate = 0
  for (const [, g] of grupe) {
    if (g.length < 2) continue
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const x = g[i], y = g[j]
      if (x.lungime_mm != null && y.lungime_mm != null && Math.abs(x.lungime_mm - y.lungime_mm) <= TOLERANTA_LUNGIME_MM) {
        anomalii.push(anomalie('dublura_identitate', `Seria ${x.serie} apare de două ori cu aceeași lungime (${x.provenienta[0].cod}#${x.provenienta[0].rand} și ${y.provenienta[0].cod}#${y.provenienta[0].rand}): de decis`, { piese: [x.id, y.id] }))
      }
    }
    bucatiTaiate += g.length
  }
  return bucatiTaiate
}

/** Aceeași sudură (cod normalizat + refacere) pe mai multe piese = anomalie (o singură îmbinare are un singur loc). */
function verificaSuduri(suduri, anomalii) {
  const v = new Map()
  for (const s of suduri) {
    if (!s.canon) continue
    const k = `${s.canon}|${s.refacuta ? 'R' : ''}`
    if (!v.has(k)) v.set(k, [])
    v.get(k).push(s)
  }
  for (const [, g] of v) if (g.length > 1) anomalii.push(anomalie('sudura_repetata', `Sudura ${g[0].original} apare de ${g.length} ori`, { piese: g.map(s => s.piesa || s.id).filter(Boolean) }))
  return v.size
}

const statistici = (piese, suduri) => {
  const poz = piese.filter(p => p.a_mm != null)
  return {
    piese: piese.length, tevi: piese.filter(p => p.fel === 'teava').length, curbe: piese.filter(p => p.fel === 'curba').length,
    lungime_m: m(suma(piese.map(p => p.lungime_mm || 0))),
    piese_fara_pozitie: piese.length - poz.length,
    km_min_mm: poz.length ? Math.min(...poz.map(p => p.a_mm)) : null, km_max_mm: poz.length ? Math.max(...poz.map(p => p.b_mm)) : null,
    suduri_cu_cod: suduri.filter(s => s.canon).length,
    suduri_refacute: suduri.filter(s => s.canon && s.refacuta).length,
    suduri_restante: suduri.filter(s => s.stare === 'restanta').length,
    capete_fara_cod: suduri.filter(s => !s.canon && s.stare !== 'restanta').length,
  }
}

/**
 * O sursă (schema sau platforma) pe un tronson.
 * @param {{sursa:'schema'|'platforma', foi:Array, tronson:{cod, km_start_m, km_end_m}, restanteConfirmate?:Array<{de_la_m, pana_la_m, sursa?}>}} p
 */
export function calculeazaSursa({ sursa, foi, tronson, restanteConfirmate = [] }) {
  const anomalii = [], ignorate = []
  const ctx = tronsonNr(tronson?.cod)
  const lim = limiteTronson(tronson)
  if (!lim) anomalii.push(anomalie('limite_tronson_lipsa', `Tronsonul ${txt(tronson?.cod) || '?'} nu are km de început și de sfârșit: banda se întinde doar pe datele sursei`))
  const ord = ordoneazaFoi(foi)
  const citite = ord.map(f => ({ foaie: f, ...citesteFoaie(f, sursa, ctx, anomalii, ignorate) }))
  // înainte de reconciliere: rândurile brute
  const brutPiese = citite.flatMap(c => c.piese)
  const brutSuduri = [...brutPiese.map(p => ({ ...p.sudura, piesa: p.id })), ...citite.flatMap(c => c.suduriLegare)]
  const randuri = suma(ord.map(f => (f.randuri || []).length))
  const inainte = { foi: ord.length, randuri, randuri_ignorate: ignorate.length, ...statistici(brutPiese, brutSuduri) }
  // reconcilierea frontierelor
  const { piese, frontiere } = reconciliazaFrontiere(citite, anomalii)
  const suduri = [...piese.map(p => ({ ...p.sudura, piesa: p.id })), ...citite.flatMap(c => c.suduriLegare)]
    .sort((x, y) => (x.km_mm ?? Infinity) - (y.km_mm ?? Infinity) || cmpId(x.piesa || x.id, y.piesa || y.id))
  const bucatiAceeasiSerie = verificaIdentitati(piese, anomalii)
  const suduriDistincte = verificaSuduri(suduri, anomalii)
  // restanțe confirmate (intrare explicită; azi nu există în platformă — spec §5)
  const restante = []
  restanteConfirmate.forEach((r, idx) => {
    const a = mmDinMetri(r.de_la_m), b = mmDinMetri(r.pana_la_m)
    if (!Number.isInteger(a) || !Number.isInteger(b) || b <= a) { anomalii.push(anomalie('restant_invalid', `Intervalul restant #${idx + 1} are limite invalide`)); return }
    restante.push({ idx, a, b, sursa: txt(r.sursa) })
  })
  if (!piese.length) anomalii.push(anomalie('sursa_goala', `Sursa „${sursa}” nu are nicio piesă pe tronsonul ${txt(tronson?.cod) || '?'}: totul e necunoscut (NU neexecutat)`))
  const banda = construiesteBanda(piese, restante, lim, anomalii)
  const len = st => m(suma(banda.segmente.filter(s => s.stare === st).map(s => s.pana_la_mm - s.de_la_mm)))
  // suprapunerea geometrică: Σ (piese peste − 1) × lungime, pe ORICE segment (și pe cele în conflict cu un restant)
  const suprapuneri_m = m(suma(banda.segmente.map(s => (s.piese.length > 1 ? (s.piese.length - 1) * (s.pana_la_mm - s.de_la_mm) : 0))))
  const dupa = {
    ...statistici(piese, suduri), suduri_distincte: suduriDistincte, piese_frontiera: frontiere.length, bucati_aceeasi_serie: bucatiAceeasiSerie,
    serii_distincte: new Set(piese.filter(p => p.serie).map(p => `${cheieText(p.tip)}|${cheieText(p.serie)}`)).size,
    realizat_m: len('realizat'), restant_m: len('restant'), suprapuneri_m,
    in_afara_limitelor_m: m(banda.in_afara_mm),
    // lungimea tronsonului e cunoscută DOAR din limitele lui; întinderea benzii fără limite = cât acoperă datele, nu tronsonul
    lungime_tronson_m: lim ? m(lim.b - lim.a) : null,
    intindere_banda_m: banda.limite ? m(banda.limite.b - banda.limite.a) : null,
    // necunoscut pe tronson: doar cu limite (altfel nu se știe cât lipsește în afara datelor — NU e 0)
    necunoscut_m: lim ? len('necunoscut') : null,
    necunoscut_in_intindere_m: banda.limite ? len('necunoscut') : null,
  }
  return {
    sursa, versiune: VERSIUNE_REGULI, tronson: { cod: txt(tronson?.cod), limite: lim },
    foi: ord.map(f => ({ id: f.id, cod: txt(f.cod), revizie: f.revizie ?? null, stare: txt(f.stare), conventieKm: f.conventieKm, conventieConfirmata: f.conventieConfirmata === true, kmStart: f.kmStart ?? null, randuri: (f.randuri || []).length,
      // data situației pe care o descrie foaia și data importului: null = NECUNOSCUTĂ (se afișează așa, nu se inventează)
      dataSituatie: f.dataSituatie ?? null, dataImport: f.dataImport ?? null, modificatLa: f.modificatLa ?? null })),
    inainte, dupa, piese, suduri, frontiere, ignorate, banda: banda.segmente, anomalii,
    blocante: anomalii.filter(a => a.nivel === 'blocant').length,
  }
}

/**
 * Împerecherea pe lungime a bucăților cu aceeași (tip, serie): MAXIMUL de perechi în toleranță; la egalitate, suma minimă a
 * diferențelor de lungime; restul egalităților se rup determinist (listele sortate după lungime, km, id; la scor egal se
 * preferă săritul bucății din schemă, apoi al celei din platformă, apoi perechea). Pe o axă (|Δ| ≤ toleranță) există mereu o
 * soluție optimă fără perechi încrucișate, deci programarea dinamică pe listele sortate e exactă. O(n·m) pe grupă.
 */
export function imperecheazaPeLungime(s, p, tol = TOLERANTA_LUNGIME_MM) {
  const ordL = l => l.filter(x => Number.isInteger(x.lungime_mm)).sort((x, y) => x.lungime_mm - y.lungime_mm || cmpPozitie(x, y))
  const S = ordL(s), P = ordL(p), n = S.length, k = P.length
  // dp[i][j] = cel mai bun scor pe S[i..], P[j..]: [nr. perechi, −Σ|Δ|]
  const mai = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
  const dp = Array.from({ length: n + 1 }, () => Array(k + 1).fill(null))
  const ales = Array.from({ length: n + 1 }, () => Array(k + 1).fill(null))
  for (let i = n; i >= 0; i--) for (let j = k; j >= 0; j--) {
    if (i === n || j === k) { dp[i][j] = [0, 0]; continue }
    let best = dp[i + 1][j], c = 's'
    if (mai(dp[i][j + 1], best)) { best = dp[i][j + 1]; c = 'p' }
    const d = Math.abs(S[i].lungime_mm - P[j].lungime_mm)
    if (d <= tol) { const v = [dp[i + 1][j + 1][0] + 1, dp[i + 1][j + 1][1] - d]; if (mai(v, best)) { best = v; c = 'm' } }
    dp[i][j] = best; ales[i][j] = c
  }
  const perechi = []
  for (let i = 0, j = 0; i < n && j < k;) {
    const c = ales[i][j]
    if (c === 'm') { perechi.push([S[i], P[j]]); i++; j++ } else if (c === 's') i++; else j++
  }
  const folS = new Set(perechi.map(x => x[0])), folP = new Set(perechi.map(x => x[1]))
  return { perechi, restS: s.filter(x => !folS.has(x)).sort(cmpPozitie), restP: p.filter(x => !folP.has(x)).sort(cmpPozitie) }
}

/**
 * Raportul de diferențe schemă ↔ platformă (spec §4.3). Cheia = bucata: (tip, serie) împerecheată ca MULTISET
 * (o serie poate avea mai multe bucăți tăiate): întâi maximul de perechi cu lungimea în toleranță (imperecheazaPeLungime),
 * apoi restul în ordinea km. „Lipsă din platformă” = bucată cu cheie în schemă rămasă fără pereche; piesele fără serie sunt
 * „necomparabile”, nu lipsă. Ordinea ieșirii e deterministă (cheie, apoi km, apoi id).
 */
export function comparaSurse(schema, platforma) {
  const grup = piese => {
    const g = new Map(), fara = []
    for (const p of piese) {
      if (!p.serie) { fara.push(p); continue }
      const k = `${cheieText(p.tip)}|${cheieText(p.serie)}`
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(p)
    }
    return { g, fara }
  }
  const S = grup(schema.piese), P = grup(platforma.piese)
  const perechi = [], doarSchema = [], doarPlatforma = []
  for (const k of [...new Set([...S.g.keys(), ...P.g.keys()])].sort(cmpId)) {
    const { perechi: pl, restS: rs, restP: rp } = imperecheazaPeLungime(S.g.get(k) || [], P.g.get(k) || [])
    perechi.push(...pl)
    const n = Math.min(rs.length, rp.length)
    for (let i = 0; i < n; i++) perechi.push([rs[i], rp[i]])
    doarSchema.push(...rs.slice(n)); doarPlatforma.push(...rp.slice(n))
  }
  perechi.sort((x, y) => cmpPozitie(x[0], y[0]) || cmpPozitie(x[1], y[1]))
  doarSchema.sort(cmpPozitie); doarPlatforma.sort(cmpPozitie)
  const det = perechi.map(([x, y]) => {
    const dif = []
    if (x.lungime_mm == null || y.lungime_mm == null || Math.abs(x.lungime_mm - y.lungime_mm) > TOLERANTA_LUNGIME_MM) dif.push('lungime')
    const delta = x.a_mm != null && y.a_mm != null ? y.a_mm - x.a_mm : null
    if (delta == null) dif.push('pozitie_necomparabila')
    else if (Math.abs(delta) > TOLERANTA_POZITIE_MM) dif.push('mutat')
    const cs = x.sudura?.canon ? `${x.sudura.canon}${x.sudura.refacuta ? 'R' : ''}` : null
    const cp = y.sudura?.canon ? `${y.sudura.canon}${y.sudura.refacuta ? 'R' : ''}` : null
    if (cs !== cp) dif.push('sudura')
    return { schema: x.id, platforma: y.id, serie: x.serie, tip: x.tip, dif, delta_m: m(delta), lungime_schema_m: m(x.lungime_mm), lungime_platforma_m: m(y.lungime_mm), sudura_schema: x.sudura?.original || null, sudura_platforma: y.sudura?.original || null }
  })
  // sudurile, pe codul normalizat
  const idx = rez => {
    const v = new Map()
    for (const s of rez.suduri) if (s.canon) v.set(`${s.canon}${s.refacuta ? 'R' : ''}`, s)
    return v
  }
  const sS = idx(schema), sP = idx(platforma)
  const pereche = new Map(perechi.map(([x, y]) => [y.id, x.id]))
  const suduriAltaPiesa = []
  for (const [k, s] of sS) {
    const p = sP.get(k)
    if (p && p.piesa && s.piesa && pereche.get(p.piesa) !== s.piesa) suduriAltaPiesa.push({ sudura: s.original, piesa_schema: s.piesa, piesa_platforma: p.piesa })
  }
  const serii = rez => new Set(rez.piese.filter(p => p.serie).map(p => `${cheieText(p.tip)}|${cheieText(p.serie)}`))
  const ss = serii(schema), sp = serii(platforma)
  return {
    versiune: VERSIUNE_REGULI,
    rezumat: {
      perechi: perechi.length,
      identice: det.filter(d => !d.dif.length).length,
      lungime_diferita: det.filter(d => d.dif.includes('lungime')).length,
      mutate: det.filter(d => d.dif.includes('mutat')).length,
      pozitie_necomparabila: det.filter(d => d.dif.includes('pozitie_necomparabila')).length,
      sudura_diferita: det.filter(d => d.dif.includes('sudura')).length,
      doar_schema: doarSchema.length, doar_platforma: doarPlatforma.length,
      necomparabile_schema: S.fara.length, necomparabile_platforma: P.fara.length,
      // serii distincte ≠ inventar de bucăți (o serie tăiată = mai multe bucăți) — se raportează separat
      serii_schema: ss.size, serii_platforma: sp.size, serii_comune: [...ss].filter(k => sp.has(k)).length,
      serii_doar_schema: [...ss].filter(k => !sp.has(k)).length, serii_doar_platforma: [...sp].filter(k => !ss.has(k)).length,
      suduri_doar_schema: [...sS.keys()].filter(k => !sP.has(k)).length, suduri_doar_platforma: [...sP.keys()].filter(k => !sS.has(k)).length,
      suduri_alta_piesa: suduriAltaPiesa.length,
    },
    perechi: det,
    doar_schema: doarSchema.map(p => p.id), doar_platforma: doarPlatforma.map(p => p.id),
    necomparabile_schema: S.fara.map(p => p.id), necomparabile_platforma: P.fara.map(p => p.id),
    suduri_doar_schema: [...sS.keys()].filter(k => !sP.has(k)), suduri_doar_platforma: [...sP.keys()].filter(k => !sS.has(k)),
    suduri_alta_piesa: suduriAltaPiesa,
  }
}

/** Tot tronsonul: fiecare sursă disponibilă + diferențele, dacă există ambele. */
export function reconciliazaTronson({ tronson, schema = null, platforma = null, restanteConfirmate = [] }) {
  const rs = schema ? calculeazaSursa({ sursa: 'schema', foi: schema, tronson, restanteConfirmate }) : null
  const rp = platforma ? calculeazaSursa({ sursa: 'platforma', foi: platforma, tronson, restanteConfirmate }) : null
  return { versiune: VERSIUNE_REGULI, schema: rs, platforma: rp, diferente: rs && rp ? comparaSurse(rs, rp) : null }
}

/**
 * Adaptorul platformei: pachetele de lansare + rândurile lor (executie_pachete_lansare / executie_tevi) → foi.
 * Convenția km a pachetelor NU e confirmată pe fiecare pachet (spec §2.3): implicit B (CONVENTIE_PLATFORMA, ca editorul),
 * A doar la cerere explicită, pentru comparație; se afișează ca atare. Pachetele nu au „data situației”: rămâne necunoscută;
 * `modificatLa` = ultima modificare a pachetului, dacă rândul o are (nu e data situației și nici a unui import).
 */
export function foiDinPlatforma(pachete, tevi, { conventie = CONVENTIE_PLATFORMA, confirmata = false } = {}) {
  const pePachet = new Map()
  for (const t of tevi || []) {
    if (!pePachet.has(t.pachet_id)) pePachet.set(t.pachet_id, [])
    pePachet.get(t.pachet_id).push(t)
  }
  return (pachete || []).map(p => ({
    id: p.id, cod: p.cod_document_full || p.cod_document || `pachet ${p.id}`, revizie: p.revizie ?? null, stare: p.status || '',
    kmStart: parseNumar(p.km_start_m), conventieKm: conventie, conventieConfirmata: confirmata,
    dataSituatie: null, dataImport: null, modificatLa: p.updated_at ?? null,
    randuri: (pePachet.get(p.id) || []).slice().sort((a, b) => (a.poz_in_pachet ?? 0) - (b.poz_in_pachet ?? 0) || a.id - b.id).map(t => ({
      rand: t.poz_in_pachet ?? t.id, poz: t.poz_in_pachet ?? null, fel: t.tip_rand, serie: t.serie_unica, tip: t.tip, dim: t.dimensiune, sarja: t.sarja,
      lungime: t.lungime_m, km: null, sudura: t.sudura_cod, refacuta: t.sudura_refacuta === true, sant_pending: t.sudura_sant_pending === true,
      pm: t.pm_cod, paut: t.pa_ut_cod,
    })),
  }))
}
