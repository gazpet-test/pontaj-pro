// Istoricul meteo zilnic pe șantiere (migrarea 20261202a, tabelul meteo_istoric_zilnic) — logica pură, fără rețea și fără BD,
// folosită de meteo-sync/index.ts și testată cu vitest (src/meteoIstoricLogica.test.js).
// Sursa: arhiva Open-Meteo (archive-api.open-meteo.com), valori zilnice în ziua Europe/Bucharest, pe lat/lng din sites.
// Răspunsul e conținut EXTERN: se folosesc doar numere validate (unități exacte, intervale ca în CHECK-urile tabelului); textul nu se citește.

export const ARHIVA = 'https://archive-api.open-meteo.com/v1/archive'
// cu cheie (planul comercial Open-Meteo), dacă e setat secretul OPEN_METEO_API_KEY
export const ARHIVA_CU_CHEIE = 'https://customer-archive-api.open-meteo.com/v1/archive'
export const SURSA = 'open-meteo-archive'
// pasul zilnic reia ultimele zile: arhiva publică primește valorile cu câteva zile întârziere, iar zilele încă goale se completează la rulările următoare
export const ZILE_REFACERE = 7
export const MAX_ZILE_CERERE = 366
export const PRIMA_ZI = '2015-01-01'

// variabila Open-Meteo → [coloana din tabel, unitatea cerută, valoare minimă, valoare maximă (exclusiv), întreg?]
export const VARIABILE: Record<string, [string, string, number, number, boolean]> = {
  precipitation_sum: ['precipitatii_mm', 'mm', 0, 1000, false],
  rain_sum: ['ploaie_mm', 'mm', 0, 1000, false],
  snowfall_sum: ['zapada_cm', 'cm', 0, 1000, false],
  temperature_2m_min: ['tmin_c', '°C', -60, 60.0001, false],
  temperature_2m_max: ['tmax_c', '°C', -60, 60.0001, false],
  wind_speed_10m_max: ['vant_max_kmh', 'km/h', 0, 400, false],
  wind_gusts_10m_max: ['rafale_max_kmh', 'km/h', 0, 400, false],
  weather_code: ['cod_vreme', 'wmo code', 0, 99.0001, true],
}
const ESENTIALE = ['precipitatii_mm', 'ploaie_mm', 'zapada_cm', 'tmin_c', 'tmax_c']

const RE_ZI = /^(\d{4})-(\d{2})-(\d{2})$/
export function esteZi(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = RE_ZI.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === s
}
// aritmetică pe zile 'YYYY-MM-DD', fără fus orar
export function adunaZile(ymd: string, n: number): string {
  if (!esteZi(ymd)) throw new Error('dată invalidă: ' + ymd)
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
export function aziBucuresti(ms = Date.now()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
export const ieriBucuresti = (ms = Date.now()) => adunaZile(aziBucuresti(ms), -1)

// [de, pana] tăiat în bucăți de cel mult maxZile (inclusiv capetele)
export function intervale(de: string, pana: string, maxZile = MAX_ZILE_CERERE): [string, string][] {
  if (!esteZi(de) || !esteZi(pana)) throw new Error('interval invalid')
  const out: [string, string][] = []
  for (let a = de; a <= pana; a = adunaZile(a, maxZile)) {
    const b = adunaZile(a, maxZile - 1)
    out.push([a, b < pana ? b : pana])
  }
  return out
}

export const coordValide = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)

export function urlArhiva({ lat, lng, de, pana, cheie }: { lat: number; lng: number; de: string; pana: string; cheie?: string | null }): string {
  if (!coordValide(lat, lng)) throw new Error('coordonate invalide')
  if (!esteZi(de) || !esteZi(pana) || de > pana) throw new Error('interval invalid')
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lng), start_date: de, end_date: pana,
    daily: Object.keys(VARIABILE).join(','), timezone: 'Europe/Bucharest',
    temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
  })
  if (cheie) q.set('apikey', cheie)
  return `${cheie ? ARHIVA_CU_CHEIE : ARHIVA}?${q.toString()}`
}

// Ce se citește pentru fiecare site:
//  - zilnic: ultimele ZILE_REFACERE zile până ieri (inclusiv);
//  - backfill: de la `deLa` (dacă e dat) sau de la data de start a proiectului site-ului (sites.proiect_id → executie_proiecte.data_start), până ieri.
// Site-urile fără coordonate valide sau (la backfill) fără dată de început se raportează, nu se ghicesc.
export function planCitire(
  sites: { id: number; lat: unknown; lng: unknown; proiect_id?: number | null }[],
  startProiect: Map<string, string | null>,
  { mod, ieri, deLa }: { mod: 'zilnic' | 'backfill'; ieri: string; deLa?: string | null },
) {
  if (!esteZi(ieri)) throw new Error('ieri invalid')
  if (deLa != null && (!esteZi(deLa) || deLa < PRIMA_ZI || deLa > ieri)) throw new Error('de_la invalid')
  const plan: { site_id: number; lat: number; lng: number; de: string; pana: string }[] = []
  const sarite: { site_id: number; motiv: string }[] = []
  for (const s of sites) {
    if (!coordValide(s.lat, s.lng)) { sarite.push({ site_id: s.id, motiv: 'fără coordonate (lat / lng)' }); continue }
    let de: string | null
    if (mod === 'zilnic') de = adunaZile(ieri, -(ZILE_REFACERE - 1))
    else {
      de = deLa ?? (s.proiect_id != null ? startProiect.get(String(s.proiect_id)) ?? null : null)
      if (!de || !esteZi(de)) { sarite.push({ site_id: s.id, motiv: 'fără dată de început (proiect fără data_start; se poate da de_la)' }); continue }
      if (de < PRIMA_ZI) de = PRIMA_ZI
      if (de > ieri) { sarite.push({ site_id: s.id, motiv: 'proiectul începe după ieri' }); continue }
    }
    plan.push({ site_id: s.id, lat: s.lat as number, lng: s.lng as number, de, pana: ieri })
  }
  return { plan, sarite }
}

// Răspunsul arhivei → rânduri pentru meteo_istoric_zilnic. Refuz TOTAL (excepție) dacă forma sau unitățile nu sunt cele cerute;
// o zi cu o valoare în afara intervalului e respinsă (numărată), nu tăiată; o zi fără nicio valoare esențială (încă nepublicată) e „lipsă”.
export function randuriDinRaspuns(j: any, { site_id, lat, lng, de, pana, preluatLa }: { site_id: number; lat: number; lng: number; de: string; pana: string; preluatLa: string }) {
  if (!j || typeof j !== 'object' || !j.daily || typeof j.daily !== 'object' || !Array.isArray(j.daily.time)) throw new Error('răspuns arhivă fără daily.time')
  const u = j.daily_units || {}
  for (const [v, [, unit]] of Object.entries(VARIABILE)) {
    if (u[v] !== unit) throw new Error(`unitate neașteptată pentru ${v}: ${String(u[v]).slice(0, 20)}`)
    if (!Array.isArray(j.daily[v]) || j.daily[v].length !== j.daily.time.length) throw new Error(`răspuns arhivă: ${v} lipsește sau are altă lungime`)
  }
  const randuri: Record<string, unknown>[] = []
  let lipsa = 0, respinse = 0
  const vazute = new Set<string>()
  j.daily.time.forEach((zi: unknown, i: number) => {
    if (!esteZi(zi) || zi < de || zi > pana || vazute.has(zi)) { respinse++; return }
    vazute.add(zi)
    const r: Record<string, unknown> = { site_id, data: zi, lat, lng, sursa: SURSA, preluat_la: preluatLa }
    let ok = true
    for (const [v, [col, , min, max, intreg]] of Object.entries(VARIABILE)) {
      const x = j.daily[v][i]
      if (x === null || x === undefined) { r[col] = null; continue }
      if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x >= max || (intreg && !Number.isInteger(x))) { ok = false; break }
      r[col] = x
    }
    if (!ok) { respinse++; return }
    if (ESENTIALE.every(c => r[c] == null)) { lipsa++; return }
    if (r.tmin_c != null && r.tmax_c != null && (r.tmin_c as number) > (r.tmax_c as number)) { respinse++; return }
    randuri.push(r)
  })
  return { randuri, lipsa, respinse }
}
