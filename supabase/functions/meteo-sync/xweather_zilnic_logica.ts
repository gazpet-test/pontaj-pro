// Rezumatul zilnic Vaisala Xweather pe șantier (migrarea 20261221a, tabelul meteo_zilnic_xweather) — logica pură, fără rețea și fără BD,
// folosită de meteo-sync/index.ts și testată cu vitest (src/xweatherZilnicLogica.test.js).
//
// Sursa: Vaisala Xweather = SERVICIU de date meteo (nu un senzor pe șantier). Pentru fiecare (șantier, zi încheiată, ziua în Europe/Bucharest):
//   * conditions/summary/<lat>,<lng>  — rezumatul condițiilor la coordonatele șantierului din ERP (valorile zilei);
//   * observations/summary/closest    — stația de observație cea mai apropiată (id, nume, distanța dată de API), rază RAZA_STATIE_KM.
// Răspunsurile sunt conținut EXTERN: se iau doar numere validate (intervale ca în CHECK-urile tabelului) și text scurt fără caractere de
// control; răspunsul brut se păstrează întreg ca probă. Lipsa unei valori = NULL, niciodată 0 („0 mm” doar dacă API-ul a spus 0, L18).
//
// DE CONFIRMAT LA PRIMA RULARE (fără apel real nu se poate verifica; răspunsul brut rămâne în tabel, deci valorile se pot reface):
//   - numele exacte ale câmpurilor din periods[].summary (CAMPURI: lista căilor acceptate, în ordinea priorității);
//   - parametrii from / to ca timestamp UNIX pentru o zi locală și „closest” + radius pe observations/summary;
//   - dacă abonamentul dă observations/summary (altfel observatii_stare = 'neautorizat', fără eroare pe zi).
import { esteZi, adunaZile, aziBucuresti, coordValide } from './istoric_logica.ts'

export const SURSA_XW = 'Vaisala Xweather'
export const ENDPOINT_CONDITII = 'conditions/summary'
export const ENDPOINT_OBSERVATII = 'observations/summary/closest'
export const RAZA_STATIE_KM = 50
export const PRIMA_ZI_XW = '2015-01-01'
export const ZILE_AUTO = 31              // fereastra completării automate (cron): ultimele 31 de zile încheiate
export const MAX_ZILE_AUTO = 20          // zile vechi lipsă completate pe o rulare de cron (peste ieri + reverificare), pe toate șantierele
export const MAX_ZILE_APEL = 62          // completarea pornită de owner: cel mult atâtea zile pe apel (reluabilă cu `pana`)
export const MAX_RASPUNS_OCTETI = 200_000
export const TIMP_CERERE_MS = 25_000

// ── timp: ziua locală Europe/Bucharest ──────────────────────────────────────────────────────────────────────────
const fmtOra = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function oraBucuresti(ms: number): string {
  const p = Object.fromEntries(fmtOra.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
// momentul UTC (ms) al orei 00:00 în București pentru ziua dată (ora de vară / iarnă; schimbarea orei în România nu e la miezul nopții)
export function miezulNoptiiUtc(zi: string): number {
  if (!esteZi(zi)) throw new Error('zi invalidă: ' + zi)
  const [y, m, d] = zi.split('-').map(Number)
  for (const ore of [2, 3]) {
    const t = Date.UTC(y, m - 1, d) - ore * 3600e3
    if (oraBucuresti(t) === `${zi} 00:00`) return t
  }
  throw new Error('miezul nopții nedeterminat pentru ' + zi)
}
// [from, to] în secunde UNIX: de la 00:00 la 23:59:59 ora României (23 / 24 / 25 de ore la schimbarea orei)
export function intervalZi(zi: string): { from: number; to: number } {
  return { from: miezulNoptiiUtc(zi) / 1000, to: miezulNoptiiUtc(adunaZile(zi, 1)) / 1000 - 1 }
}
export const ieriBuc = (ms = Date.now()) => adunaZile(aziBucuresti(ms), -1)

// ── cererile (FĂRĂ credențiale: ele se adaugă doar la apel; cererea salvată în tabel nu le conține niciodată) ──────────────
const coord = (x: number) => String(Number(x.toFixed(6)))
export function cerereConditii({ lat, lng, zi }: { lat: number; lng: number; zi: string }): string {
  if (!coordValide(lat, lng)) throw new Error('coordonate invalide')
  const { from, to } = intervalZi(zi)
  return `${ENDPOINT_CONDITII}/${coord(lat)},${coord(lng)}?from=${from}&to=${to}`
}
export function cerereObservatii({ lat, lng, zi }: { lat: number; lng: number; zi: string }): string {
  if (!coordValide(lat, lng)) throw new Error('coordonate invalide')
  const { from, to } = intervalZi(zi)
  return `${ENDPOINT_OBSERVATII}?p=${coord(lat)},${coord(lng)}&radius=${RAZA_STATIE_KM}km&limit=1&from=${from}&to=${to}`
}
export const cuCredentiale = (cerere: string, cid: string, csec: string) =>
  `${cerere}${cerere.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(csec)}`

// ── clasificarea unui răspuns HTTP (L05: 5xx / 429 / timeout / rețea = necunoscut → ziua nu se scrie, se reia la rularea următoare) ──
export type Clasa = 'ok' | 'fara_date' | 'neautorizat' | 'tranzitoriu' | 'eroare'
export function clasificaRaspuns(status: number, j: any): Clasa {
  if (!Number.isInteger(status) || status === 0 || status === 429 || status >= 500) return 'tranzitoriu'
  if (status === 401 || status === 403) return 'neautorizat'
  if (!j || typeof j !== 'object') return 'eroare'
  const cod = typeof j.error?.code === 'string' ? j.error.code : null
  if (cod === 'warn_no_data') return 'fara_date'
  if (cod === 'invalid_client' || cod === 'unauthorized_namespace' || cod === 'insufficient_scope') return 'neautorizat'
  if (status !== 200 || j.success !== true) return 'eroare'
  const r = j.response
  if (r == null || (Array.isArray(r) && r.length === 0)) return 'fara_date'
  if (typeof r !== 'object') return 'eroare'
  return 'ok'
}

// ── maparea rezumatului ─────────────────────────────────────────────────────────────────────────────────────────
// coloana din tabel → [căile acceptate în periods[].summary (prima prezentă câștigă), minim, maxim (exclusiv), zecimale]
export const CAMPURI: Record<string, [string[], number, number, number]> = {
  tmin_c: [['temp.minC'], -60, 60.0001, 2],
  tmax_c: [['temp.maxC'], -60, 60.0001, 2],
  tmed_c: [['temp.avgC'], -60, 60.0001, 2],
  precipitatii_mm: [['precip.totalMM'], 0, 1000, 2],
  zapada_cm: [['snow.totalCM', 'snowDepth.totalCM'], 0, 1000, 2],
  vant_max_kmh: [['wind.maxKPH', 'windSpeed.maxKPH'], 0, 400, 2],
  rafala_max_kmh: [['wind.gustKPH', 'wind.gustMaxKPH', 'windGust.maxKPH'], 0, 400, 2],
  vant_dir_grade: [['wind.maxDirDEG', 'wind.dirMaxDEG', 'windDir.maxDEG'], 0, 360.0001, 0],
  umiditate_med: [['rh.avg', 'humidity.avg'], 0, 100.0001, 2],
}
export const CAI_DIRECTIE = ['wind.maxDir', 'wind.dirMax', 'windDir.max']
export const CAI_DESCRIERE = ['weather.phrase', 'weather']
export const DIRECTII = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
// coloanele de VALORI (ce compară reverificarea; o diferență = versiune nouă, nu suprascriere)
export const VALORI = ['tmin_c', 'tmax_c', 'tmed_c', 'precipitatii_mm', 'zapada_cm', 'vant_max_kmh', 'rafala_max_kmh', 'vant_dir', 'vant_dir_grade',
  'umiditate_med', 'descriere', 'observatii_stare', 'statie_id', 'statie_nume', 'statie_distanta_km']

const cale = (o: any, p: string) => p.split('.').reduce((a, k) => (a != null && typeof a === 'object' ? a[k] : undefined), o)
const RE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/
// text extern scurt: șir, fără caractere de control, 1..max după trim; absent = null; altceva = invalid (undefined)
function textScurt(x: unknown, max: number): string | null | undefined {
  if (x === null || x === undefined) return null
  if (typeof x !== 'string') return undefined
  const t = x.trim()
  if (!t.length || t.length > max || RE_CONTROL.test(t)) return undefined
  return t
}
const rotunjeste = (x: number, zec: number) => Number(x.toFixed(zec))
const primul = (r: any) => (Array.isArray(r) ? r[0] : r)

// perioada zilei cerute din răspuns: ziua din dateTimeISO (ora locală a punctului) sau ymd; fusul orar, dacă e dat, trebuie să fie al României
function perioadaZilei(obj: any, zi: string): { summary?: any; motiv?: string } {
  const tz = obj?.profile?.tz
  if (tz != null && tz !== 'Europe/Bucharest') return { motiv: 'fus orar neașteptat: ' + String(tz).slice(0, 40) }
  const per = Array.isArray(obj?.periods) ? obj.periods : null
  if (!per) return { motiv: 'răspuns fără periods' }
  const ymd = zi.replace(/-/g, '')
  const ale = per.filter((p: any) => {
    const s = p?.summary
    if (!s || typeof s !== 'object') return false
    const d = typeof s.dateTimeISO === 'string' ? s.dateTimeISO.slice(0, 10) : null
    return d === zi || (d == null && String(s.ymd ?? '') === ymd)
  })
  if (ale.length > 1) return { motiv: 'mai multe perioade pentru aceeași zi' }
  if (!ale.length) return {}
  return { summary: ale[0].summary }
}

// conditions/summary → valorile zilei. { valori } | { lipsa } (nicio valoare pentru zi) | { respins } (formă / valoare invalidă: ziua NU se scrie)
export function valoriDinConditii(j: any, zi: string): { valori?: Record<string, unknown>; lipsa?: string; respins?: string } {
  const obj = primul(j?.response)
  if (!obj || typeof obj !== 'object') return { respins: 'răspuns conditions fără response' }
  const { summary: s, motiv } = perioadaZilei(obj, zi)
  if (motiv) return { respins: motiv }
  if (!s) return { lipsa: 'nicio perioadă pentru ziua cerută' }
  const v: Record<string, unknown> = {}
  for (const [col, [cai, min, max, zec]] of Object.entries(CAMPURI)) {
    v[col] = null
    for (const c of cai) {
      const x = cale(s, c)
      if (x === null || x === undefined) continue
      if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x >= max) return { respins: `valoare invalidă pentru ${col}` }
      const r = rotunjeste(x, zec)
      if (r < min || r >= max) return { respins: `valoare invalidă pentru ${col}` }
      v[col] = r
      break
    }
  }
  if (v.vant_dir_grade === 360) v.vant_dir_grade = 0
  v.vant_dir = null
  for (const c of CAI_DIRECTIE) {
    const x = cale(s, c)
    if (x === null || x === undefined) continue
    if (typeof x !== 'string' || !DIRECTII.includes(x)) return { respins: 'direcția vântului invalidă' }
    v.vant_dir = x
    break
  }
  v.descriere = null
  for (const c of CAI_DESCRIERE) {
    const x = cale(s, c)
    if (x === null || x === undefined || (typeof x === 'object' && c === 'weather')) continue
    const t = textScurt(x, 200)
    if (t === undefined) return { respins: 'descrierea vremii invalidă' }
    v.descriere = t
    break
  }
  const t = v as Record<string, number | null>
  if (t.tmin_c != null && t.tmax_c != null && t.tmin_c > t.tmax_c) return { respins: 'Tmin > Tmax' }
  if (t.tmed_c != null && ((t.tmin_c != null && t.tmed_c < t.tmin_c) || (t.tmax_c != null && t.tmed_c > t.tmax_c))) return { respins: 'Tmedie în afara [Tmin, Tmax]' }
  if (['tmin_c', 'tmax_c', 'tmed_c', 'precipitatii_mm', 'zapada_cm', 'vant_max_kmh', 'rafala_max_kmh', 'umiditate_med'].every(c => v[c] == null)) {
    return { lipsa: 'nicio valoare numerică pentru zi' }
  }
  return { valori: v }
}

// observations/summary/closest → stația (id, nume, distanța dată de API). Lipsa stației NU e eroare: observatii_stare o spune.
export type Statie = { observatii_stare: 'ok' | 'fara_statie' | 'neautorizat' | 'eroare'; statie_id: string | null; statie_nume: string | null;
  statie_distanta_km: number | null; statie_lat: number | null; statie_lng: number | null }
const FARA: Omit<Statie, 'observatii_stare'> = { statie_id: null, statie_nume: null, statie_distanta_km: null, statie_lat: null, statie_lng: null }
export function statieDinObservatii(clasa: Clasa, j: any, zi: string): Statie {
  if (clasa === 'fara_date') return { observatii_stare: 'fara_statie', ...FARA }
  if (clasa === 'neautorizat') return { observatii_stare: 'neautorizat', ...FARA }
  if (clasa !== 'ok') return { observatii_stare: 'eroare', ...FARA }
  const obj = primul(j?.response)
  if (!obj || typeof obj !== 'object') return { observatii_stare: 'fara_statie', ...FARA }
  const id = typeof obj.id === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(obj.id) ? obj.id : null
  if (!id) return { observatii_stare: 'eroare', ...FARA }
  // stația trebuie să aibă rezumat pentru ziua cerută; altfel nu e „stația zilei”
  const { summary, motiv } = perioadaZilei(obj, zi)
  if (motiv) return { observatii_stare: 'eroare', ...FARA }
  if (!summary) return { observatii_stare: 'fara_statie', ...FARA }
  const nume = textScurt(obj.place?.name, 120)
  const dist = obj.relativeTo?.distanceKM
  const lat = obj.loc?.lat, lng = obj.loc?.long
  return {
    observatii_stare: 'ok', statie_id: id, statie_nume: nume === undefined ? null : nume,
    // distanța doar dacă o dă API-ul (nu o calculăm noi); în afara razei cerute = nedovedită → NULL
    statie_distanta_km: typeof dist === 'number' && Number.isFinite(dist) && dist >= 0 && dist <= RAZA_STATIE_KM + 0.5 ? rotunjeste(dist, 2) : null,
    statie_lat: coordValide(lat, lng) ? rotunjeste(lat, 6) : null, statie_lng: coordValide(lat, lng) ? rotunjeste(lng, 6) : null,
  }
}

// răspunsul brut păstrat ca probă (fără credențiale: răspunsul nu le conține; dimensiune plafonată ca în CHECK)
export function brut(j: unknown): unknown {
  const s = JSON.stringify(j ?? null)
  if (s.length > MAX_RASPUNS_OCTETI) throw new Error('răspuns prea mare pentru a fi păstrat')
  return JSON.parse(s)
}

// rândul pentru meteo_zilnic_xweather (preluat_la îl pune serverul; versiunea o verifică trigger-ul)
export function randXweather({ site_id, zi, lat, lng, versiune, valori, statie, cerCond, cerObs, jCond, jObs }:
  { site_id: number; zi: string; lat: number; lng: number; versiune: number; valori: Record<string, unknown>; statie: Statie;
    cerCond: string; cerObs: string | null; jCond: unknown; jObs: unknown }) {
  return {
    site_id, data: zi, versiune, ...valori, lat: rotunjeste(lat, 6), lng: rotunjeste(lng, 6),
    cerere_conditii: cerCond, cerere_observatii: cerObs, ...statie,
    raspuns_conditii: brut(jCond), raspuns_observatii: cerObs == null ? null : brut(jObs ?? null),
  }
}

// aceleași valori (reverificarea): numere comparate ca numere (valorile din BD au deja scara coloanei), textul exact
export function valoriEgale(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return VALORI.every(c => {
    const x = a[c] ?? null, y = b[c] ?? null
    if (x === null || y === null) return x === y
    if (typeof x === 'number' || typeof y === 'number') return Number(x) === Number(y)
    return String(x) === String(y)
  })
}

// ── planul unei rulări ──────────────────────────────────────────────────────────────────────────────────────────
// existente: site_id → (zi → ultima versiune a zilei, cu valorile). start: site_id → prima zi de luat în calcul (data_start a proiectului).
// zilnic : ieri (dacă lipsește) + reverificarea lui alaltăieri (o singură dată în viața zilei: mâine nu mai e alaltăieri) pentru fiecare
//          șantier, apoi zilele lipsă din ultimele ZILE_AUTO, de la cea mai nouă, cel mult MAX_ZILE_AUTO pe toate șantierele.
// backfill (owner): zilele lipsă din [de, pana], de la cea mai nouă, cel mult maxZile; `continua_pana` = ziua de unde se reia (reluabil,
//          idempotent: o zi existentă nu se mai cere).
export type Sarcina = { site_id: number; lat: number; lng: number; zi: string; tip: 'nou' | 'verificare'; anterior?: Record<string, unknown> }
export function planXweather(
  sites: { id: number; lat: unknown; lng: unknown; proiect_id?: number | null }[],
  existente: Map<string, Map<string, Record<string, unknown>>>,
  start: Map<string, string | null>,
  { mod, ieri, deLa = null, pana = null, maxZile = MAX_ZILE_APEL }: { mod: 'zilnic' | 'backfill'; ieri: string; deLa?: string | null; pana?: string | null; maxZile?: number },
) {
  if (!esteZi(ieri)) throw new Error('ieri invalid')
  if (deLa != null && (!esteZi(deLa) || deLa < PRIMA_ZI_XW || deLa > ieri)) throw new Error('de_la invalid')
  if (pana != null && (!esteZi(pana) || pana < PRIMA_ZI_XW || pana > ieri)) throw new Error('pana invalid')
  if (!Number.isInteger(maxZile) || maxZile < 1 || maxZile > MAX_ZILE_APEL) throw new Error('max_zile invalid')
  if (mod === 'backfill' && sites.length !== 1) throw new Error('completarea pornită de owner: un singur șantier pe apel (site_id)')
  if (mod === 'zilnic' && (deLa != null || pana != null)) throw new Error('pasul zilnic nu primește interval')
  const sarcini: Sarcina[] = []
  const sarite: { site_id: number; motiv: string }[] = []
  const lipsa = new Map<number, string[]>()   // site → zile lipsă, de la cea mai nouă
  const valide: { id: number; lat: number; lng: number }[] = []
  for (const s of sites) {
    if (!coordValide(s.lat, s.lng)) { sarite.push({ site_id: s.id, motiv: 'fără coordonate (lat / lng)' }); continue }
    valide.push({ id: s.id, lat: s.lat as number, lng: s.lng as number })
    const ex = existente.get(String(s.id)) || new Map()
    let de: string, sus: string
    const st = s.proiect_id != null ? start.get(String(s.proiect_id)) ?? null : null
    if (mod === 'zilnic') {
      de = adunaZile(ieri, -(ZILE_AUTO - 1)); sus = adunaZile(ieri, -2)
      if (st && esteZi(st) && st > de) de = st
    } else {
      sus = pana ?? ieri
      const d0 = deLa ?? (st && esteZi(st) ? st : null)
      if (!d0) { sarite.push({ site_id: s.id, motiv: 'fără dată de început (proiect fără data_start; se poate da de_la)' }); continue }
      de = d0 < PRIMA_ZI_XW ? PRIMA_ZI_XW : d0
    }
    const z: string[] = []
    for (let d = sus; d >= de; d = adunaZile(d, -1)) if (!ex.has(d)) z.push(d)
    lipsa.set(s.id, z)
    if (mod === 'zilnic') {
      if (!ex.has(ieri) && (!st || !esteZi(st) || st <= ieri)) sarcini.push({ site_id: s.id, lat: s.lat as number, lng: s.lng as number, zi: ieri, tip: 'nou' })
      const al = adunaZile(ieri, -1)
      if (ex.has(al)) sarcini.push({ site_id: s.id, lat: s.lat as number, lng: s.lng as number, zi: al, tip: 'verificare', anterior: ex.get(al) })
      else if (!st || !esteZi(st) || st <= al) sarcini.push({ site_id: s.id, lat: s.lat as number, lng: s.lng as number, zi: al, tip: 'nou' })
    }
  }
  // zilele lipsă: pe rând (round-robin) între șantiere, de la cea mai nouă, până la buget
  const buget = mod === 'zilnic' ? MAX_ZILE_AUTO : maxZile
  let luate = 0
  const idx = new Map<number, number>()
  for (let progres = true; progres && luate < buget;) {
    progres = false
    for (const s of valide) {
      const z = lipsa.get(s.id) || [], i = idx.get(s.id) || 0
      if (i >= z.length || luate >= buget) continue
      sarcini.push({ site_id: s.id, lat: s.lat, lng: s.lng, zi: z[i], tip: 'nou' })
      idx.set(s.id, i + 1); luate++; progres = true
    }
  }
  let ramase = 0
  let continuaPana: string | null = null
  for (const s of valide) {
    const z = lipsa.get(s.id) || [], i = idx.get(s.id) || 0
    ramase += Math.max(0, z.length - i)
    // reluarea (backfill, un singur șantier pe apel): de la ziua de dinaintea celei mai vechi luate acum — o zi fără date la furnizor
    // nu blochează reluarea (apelul următor cu `pana` = continua_pana nu o mai cere)
    if (mod === 'backfill' && i < z.length) continuaPana = i > 0 ? adunaZile(z[i - 1], -1) : z[0]
  }
  return { sarcini, sarite, ramase, continua_pana: ramase > 0 ? continuaPana : null }
}

// ── o zi: din cele două răspunsuri → rândul de scris, sau motivul pentru care nu se scrie ────────────────────────────
// { rand } | { lipsa } | { respins } | { tranzitoriu } | { eroare } | { neschimbat }
export function procesZi(s: Sarcina, cond: { status: number; json: any; cerere: string }, obs: { status: number; json: any; cerere: string } | null) {
  const cc = clasificaRaspuns(cond.status, cond.json)
  if (cc === 'tranzitoriu') return { tranzitoriu: `conditions ${cond.status || 'rețea / timp depășit'}` }
  if (cc === 'fara_date') return { lipsa: 'Xweather nu are rezumat pentru zi' }
  if (cc !== 'ok') return { eroare: `conditions: ${cc} (${cond.status})` }
  const m = valoriDinConditii(cond.json, s.zi)
  if (m.respins) return { respins: m.respins }
  if (m.lipsa) return { lipsa: m.lipsa }
  if (!obs) return { eroare: 'cererea de observații lipsește' }
  const co = clasificaRaspuns(obs.status, obs.json)
  if (co === 'tranzitoriu') return { tranzitoriu: `observations ${obs.status || 'rețea / timp depășit'}` }
  const statie = statieDinObservatii(co, obs.json, s.zi)
  const nou = { ...m.valori, ...statie }
  if (s.tip === 'verificare' && s.anterior && valoriEgale(nou, s.anterior)) return { neschimbat: true }
  const versiune = s.tip === 'verificare' && s.anterior ? Number(s.anterior.versiune) + 1 : 1
  if (!Number.isInteger(versiune) || versiune < 1) return { eroare: 'versiunea anterioară invalidă' }
  return { rand: randXweather({ site_id: s.site_id, zi: s.zi, lat: s.lat, lng: s.lng, versiune, valori: m.valori!, statie,
    cerCond: cond.cerere, cerObs: obs.cerere, jCond: cond.json, jObs: obs.json }) }
}
