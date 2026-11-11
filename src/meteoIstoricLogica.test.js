// Logica pură a istoricului meteo din edge fn meteo-sync (supabase/functions/meteo-sync/istoric_logica.ts); valorile așteptate sunt
// scrise de mână (L25), răspunsurile arhivei sunt fixture-uri în forma documentată de Open-Meteo (daily + daily_units).
import { describe, it, expect } from 'vitest'
import { esteZi, adunaZile, aziBucuresti, ieriBucuresti, intervale, coordValide, urlArhiva, planCitire, randuriDinRaspuns, ZILE_REFACERE, VARIABILE, SURSA }
  from '../supabase/functions/meteo-sync/istoric_logica.ts'

const UNITATI = { time: 'iso8601', precipitation_sum: 'mm', rain_sum: 'mm', snowfall_sum: 'cm', temperature_2m_min: '°C', temperature_2m_max: '°C',
  wind_speed_10m_max: 'km/h', wind_gusts_10m_max: 'km/h', weather_code: 'wmo code' }
const raspuns = (zile) => ({
  latitude: 44.6, longitude: 22.6, daily_units: { ...UNITATI },
  daily: {
    time: zile.map(z => z[0]),
    precipitation_sum: zile.map(z => z[1]), rain_sum: zile.map(z => z[2]), snowfall_sum: zile.map(z => z[3]),
    temperature_2m_min: zile.map(z => z[4]), temperature_2m_max: zile.map(z => z[5]),
    wind_speed_10m_max: zile.map(z => z[6]), wind_gusts_10m_max: zile.map(z => z[7]), weather_code: zile.map(z => z[8]),
  },
})
const OPT = { site_id: 7, lat: 44.6, lng: 22.6, de: '2026-01-01', pana: '2026-01-10', preluatLa: '2026-01-11T04:05:00.000Z' }

describe('istoric meteo — date și intervale', () => {
  it('zile valide, aritmetică pe zile, ziua în București (iarnă / vară)', () => {
    expect(esteZi('2026-02-28')).toBe(true)
    expect(esteZi('2026-02-30')).toBe(false)
    expect(esteZi('2026-2-3')).toBe(false)
    expect(adunaZile('2026-03-01', -1)).toBe('2026-02-28')
    expect(adunaZile('2024-02-28', 1)).toBe('2024-02-29')
    expect(aziBucuresti(Date.UTC(2026, 0, 31, 22, 30))).toBe('2026-02-01')   // UTC+2
    expect(aziBucuresti(Date.UTC(2026, 6, 31, 21, 30))).toBe('2026-08-01')   // UTC+3
    expect(aziBucuresti(Date.UTC(2026, 6, 31, 20, 59))).toBe('2026-07-31')
    expect(ieriBucuresti(Date.UTC(2026, 10, 10, 4, 5))).toBe('2026-11-09')
  })
  it('intervale de cel mult N zile, fără goluri și fără suprapuneri', () => {
    expect(intervale('2026-01-01', '2026-01-01')).toEqual([['2026-01-01', '2026-01-01']])
    const b = intervale('2025-05-05', '2026-11-08', 366)
    expect(b).toEqual([['2025-05-05', '2026-05-05'], ['2026-05-06', '2026-11-08']])
    expect(intervale('2026-01-01', '2026-01-10', 4)).toEqual([['2026-01-01', '2026-01-04'], ['2026-01-05', '2026-01-08'], ['2026-01-09', '2026-01-10']])
    expect(intervale('2026-01-02', '2026-01-01')).toEqual([])
    expect(() => intervale('x', '2026-01-01')).toThrow()
  })
  it('coordonatele și adresa cererii', () => {
    expect(coordValide(44.6, 22.6)).toBe(true)
    expect(coordValide(0, 0)).toBe(false)
    expect(coordValide('44.6', 22.6)).toBe(false)
    expect(coordValide(91, 22.6)).toBe(false)
    const u = new URL(urlArhiva({ lat: 44.6, lng: 22.6, de: '2026-01-01', pana: '2026-01-07' }))
    expect(u.origin + u.pathname).toBe('https://archive-api.open-meteo.com/v1/archive')
    expect(u.searchParams.get('latitude')).toBe('44.6')
    expect(u.searchParams.get('start_date')).toBe('2026-01-01')
    expect(u.searchParams.get('end_date')).toBe('2026-01-07')
    expect(u.searchParams.get('timezone')).toBe('Europe/Bucharest')
    expect(u.searchParams.get('daily').split(',')).toEqual(Object.keys(VARIABILE))
    expect(u.searchParams.get('apikey')).toBe(null)
    const c = new URL(urlArhiva({ lat: 44.6, lng: 22.6, de: '2026-01-01', pana: '2026-01-07', cheie: 'K' }))
    expect(c.host).toBe('customer-archive-api.open-meteo.com')
    expect(c.searchParams.get('apikey')).toBe('K')
    expect(() => urlArhiva({ lat: 0, lng: 0, de: '2026-01-01', pana: '2026-01-07' })).toThrow()
    expect(() => urlArhiva({ lat: 44.6, lng: 22.6, de: '2026-01-08', pana: '2026-01-07' })).toThrow()
  })
})

describe('istoric meteo — ce se citește', () => {
  const SITES = [
    { id: 1, lat: 44.6, lng: 22.6, proiect_id: 10 },
    { id: 2, lat: null, lng: 22.6, proiect_id: 10 },        // fără coordonate
    { id: 3, lat: 44.7, lng: 22.4, proiect_id: null },      // fără proiect
    { id: 4, lat: 44.8, lng: 22.5, proiect_id: 11 },        // proiect fără data_start
    { id: 5, lat: 44.9, lng: 22.3, proiect_id: 12 },        // proiect care începe după ieri
  ]
  const START = new Map([['10', '2025-05-05'], ['11', null], ['12', '2026-12-01']])
  it('zilnic: ultimele ZILE_REFACERE zile până ieri, pe toate site-urile cu coordonate', () => {
    const { plan, sarite } = planCitire(SITES, START, { mod: 'zilnic', ieri: '2026-11-09' })
    expect(ZILE_REFACERE).toBe(7)
    expect(plan.map(p => [p.site_id, p.de, p.pana])).toEqual([[1, '2026-11-03', '2026-11-09'], [3, '2026-11-03', '2026-11-09'], [4, '2026-11-03', '2026-11-09'], [5, '2026-11-03', '2026-11-09']])
    expect(sarite.map(s => s.site_id)).toEqual([2])
  })
  it('backfill: de la data_start a proiectului; fără dată / după ieri = sărit cu motiv; de_la explicit pentru toate', () => {
    const a = planCitire(SITES, START, { mod: 'backfill', ieri: '2026-11-09' })
    expect(a.plan.map(p => [p.site_id, p.de, p.pana])).toEqual([[1, '2025-05-05', '2026-11-09']])
    expect(a.sarite.map(s => s.site_id)).toEqual([2, 3, 4, 5])
    expect(a.sarite.find(s => s.site_id === 4).motiv).toMatch(/fără dată de început/)
    const b = planCitire(SITES, START, { mod: 'backfill', ieri: '2026-11-09', deLa: '2026-01-01' })
    expect(b.plan.map(p => [p.site_id, p.de])).toEqual([[1, '2026-01-01'], [3, '2026-01-01'], [4, '2026-01-01'], [5, '2026-01-01']])
    expect(() => planCitire(SITES, START, { mod: 'backfill', ieri: '2026-11-09', deLa: '2026-11-10' })).toThrow()
    expect(() => planCitire(SITES, START, { mod: 'backfill', ieri: '2026-11-09', deLa: '2014-12-31' })).toThrow()
    expect(() => planCitire(SITES, START, { mod: 'backfill', ieri: '2026-11-09', deLa: '01.01.2026' })).toThrow()
  })
})

describe('istoric meteo — răspunsul arhivei (conținut extern)', () => {
  it('zilele valide devin rânduri; lipsă / respinse numărate, nu tăiate', () => {
    const { randuri, lipsa, respinse } = randuriDinRaspuns(raspuns([
      ['2026-01-01', 12.4, 10.1, 1.4, -3.2, 2.5, 25.2, 48.6, 73],     // ok
      ['2026-01-02', 0, 0, 0, -1, 4, 10, 20, 3],                      // ok
      ['2026-01-03', null, null, null, null, null, 10, 20, 3],        // încă nepublicată → lipsă
      ['2026-01-04', -0.1, 0, 0, -1, 4, 10, 20, 3],                   // precipitații negative → respinsă
      ['2026-01-05', 0, 0, 0, 5, 4, 10, 20, 3],                       // tmin > tmax → respinsă
      ['2026-01-06', 0, 0, 0, -1, 4, 10, 20, 3.5],                    // cod nu e întreg → respinsă
      ['2025-12-31', 0, 0, 0, -1, 4, 10, 20, 3],                      // în afara intervalului cerut → respinsă
      ['2026-01-02', 0, 0, 0, -1, 4, 10, 20, 3],                      // zi repetată → respinsă
      ['2026-01-07', '5', 0, 0, -1, 4, 10, 20, 3],                    // text în loc de număr → respinsă
      ['2026-01-08', null, null, 2, -6, -1, 10, null, 71],           // precipitații lipsă, zăpada cunoscută → rând (cu null)
    ]), OPT)
    expect(lipsa).toBe(1)
    expect(respinse).toBe(6)
    expect(randuri.map(r => r.data)).toEqual(['2026-01-01', '2026-01-02', '2026-01-08'])
    expect(randuri[0]).toEqual({ site_id: 7, data: '2026-01-01', lat: 44.6, lng: 22.6, grila_lat: 44.6, grila_lng: 22.6, altitudine_m: null,
      sursa: SURSA, preluat_la: OPT.preluatLa,
      precipitatii_mm: 12.4, ploaie_mm: 10.1, zapada_cm: 1.4, tmin_c: -3.2, tmax_c: 2.5, vant_max_kmh: 25.2, rafale_max_kmh: 48.6, cod_vreme: 73 })
    expect(randuri[2]).toMatchObject({ precipitatii_mm: null, ploaie_mm: null, zapada_cm: 2, rafale_max_kmh: null })
  })
  it('zilele cerute care lipsesc din răspuns se numără ca absente (răspuns gol / goluri) (review r1 P2)', () => {
    const OPT7 = { ...OPT, de: '2026-01-01', pana: '2026-01-07' }
    expect(randuriDinRaspuns(raspuns([]), OPT7)).toEqual({ randuri: [], lipsa: 0, respinse: 0, absente: 7 })
    const g = randuriDinRaspuns(raspuns([['2026-01-01', 1, 1, 0, 0, 2, 5, 9, 3], ['2026-01-04', 1, 1, 0, 0, 2, 5, 9, 3], ['2026-01-07', 1, 1, 0, 0, 2, 5, 9, 3]]), OPT7)
    expect(g.randuri.map(r => r.data)).toEqual(['2026-01-01', '2026-01-04', '2026-01-07'])
    expect(g.absente).toBe(4)
    // o zi respinsă la validare nu e și „absentă” (e numărată o singură dată)
    const r = randuriDinRaspuns(raspuns([['2026-01-01', -1, 1, 0, 0, 2, 5, 9, 3]]), { ...OPT, de: '2026-01-01', pana: '2026-01-01' })
    expect([r.respinse, r.absente]).toEqual([1, 0])
  })
  it('punctul de grilă și altitudinea din răspuns; valori invalide → null, nu refuz', () => {
    const a = randuriDinRaspuns({ ...raspuns([['2026-01-01', 1, 1, 0, 0, 2, 5, 9, 3]]), latitude: 44.674866, longitude: 22.465332, elevation: 65 }, { ...OPT, pana: '2026-01-01' })
    expect(a.randuri[0]).toMatchObject({ lat: 44.6, lng: 22.6, grila_lat: 44.674866, grila_lng: 22.465332, altitudine_m: 65 })
    const b = randuriDinRaspuns({ ...raspuns([['2026-01-01', 1, 1, 0, 0, 2, 5, 9, 3]]), latitude: 'x', longitude: 200, elevation: NaN }, { ...OPT, pana: '2026-01-01' })
    expect(b.randuri[0]).toMatchObject({ grila_lat: null, grila_lng: null, altitudine_m: null })
  })
  it('forma sau unitățile neașteptate = refuz total (nimic scris)', () => {
    expect(() => randuriDinRaspuns(null, OPT)).toThrow()
    expect(() => randuriDinRaspuns({ daily: {} }, OPT)).toThrow(/daily\.time/)
    const f = raspuns([['2026-01-01', 1, 1, 0, 0, 1, 1, 1, 1]])
    expect(() => randuriDinRaspuns({ ...f, daily_units: { ...UNITATI, snowfall_sum: 'mm' } }, OPT)).toThrow(/unitate neașteptată pentru snowfall_sum/)
    expect(() => randuriDinRaspuns({ ...f, daily_units: { ...UNITATI, temperature_2m_max: '°F' } }, OPT)).toThrow(/temperature_2m_max/)
    expect(() => randuriDinRaspuns({ ...f, daily: { ...f.daily, rain_sum: [] } }, OPT)).toThrow(/rain_sum/)
    const fara = { ...f, daily: { ...f.daily } }; delete fara.daily.weather_code
    expect(() => randuriDinRaspuns(fara, OPT)).toThrow(/weather_code/)
  })
})
