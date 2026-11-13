// Logica pură a rezumatului zilnic Vaisala Xweather din edge fn meteo-sync (supabase/functions/meteo-sync/xweather_zilnic_logica.ts).
// Răspunsurile sunt fixture-uri SCRISE DE MÂNĂ în forma documentată (success / error / response[] cu loc, place, profile, relativeTo,
// periods[].summary); valorile așteptate sunt scrise de mână (L25), nu calculate cu codul testat.
import { describe, it, expect } from 'vitest'
import {
  miezulNoptiiUtc, intervalZi, cerereConditii, cerereObservatii, cuCredentiale, clasificaRaspuns, valoriDinConditii, statieDinObservatii,
  planXweather, procesZi, valoriEgale, brut, ZILE_AUTO, MAX_ZILE_AUTO, MAX_ZILE_APEL, RAZA_STATIE_KM, VALORI,
} from '../supabase/functions/meteo-sync/xweather_zilnic_logica.ts'

const ZI = '2026-11-12'
const summary = (o = {}) => ({
  dateTimeISO: '2026-11-12T00:00:00+02:00', timestamp: 1762898400,
  temp: { maxC: 9.46, minC: 1.2, avgC: 5.04 }, precip: { totalMM: 4.6 }, snow: { totalCM: 0 },
  wind: { maxKPH: 31.5, gustKPH: 52.3, maxDir: 'NW', maxDirDEG: 315 }, rh: { avg: 81.4 }, weather: { phrase: 'Mostly Cloudy with Light Rain' },
  ...o,
})
const conditii = (s = summary(), extra = {}) => ({ success: true, error: null, response: [{ loc: { lat: 44.94, long: 26.02 }, profile: { tz: 'Europe/Bucharest' }, periods: [{ summary: s }], ...extra }] })
const observatii = (o = {}) => ({
  success: true, error: null,
  response: [{ id: 'LRBS', loc: { lat: 44.5, long: 26.08 }, place: { name: 'Bucuresti/Baneasa', country: 'ro' }, profile: { tz: 'Europe/Bucharest' },
    relativeTo: { lat: 44.94, long: 26.02, distanceKM: 12.37, bearing: 170 }, periods: [{ summary: { dateTimeISO: '2026-11-12T00:00:00+02:00', temp: { maxC: 9 } } }], ...o }],
})

describe('ziua locală (Europe/Bucharest) — granițele de fus orar', () => {
  it('miezul nopții: iarna UTC+2, vara UTC+3', () => {
    expect(new Date(miezulNoptiiUtc('2026-11-12')).toISOString()).toBe('2026-11-11T22:00:00.000Z')
    expect(new Date(miezulNoptiiUtc('2026-07-01')).toISOString()).toBe('2026-06-30T21:00:00.000Z')
  })
  it('ziua are 24 h, iar la schimbarea orei 23 h (29.03.2026) și 25 h (25.10.2026)', () => {
    const d = (z) => { const { from, to } = intervalZi(z); return to + 1 - from }
    expect(d('2026-11-12')).toBe(86400)
    expect(d('2026-03-29')).toBe(82800)
    expect(d('2026-10-25')).toBe(90000)
    expect(intervalZi('2026-03-29')).toEqual({ from: 1774735200, to: 1774817999 })   // 28.03 22:00Z → 29.03 20:59:59Z
  })
  it('zi invalidă = refuz', () => {
    expect(() => miezulNoptiiUtc('2026-02-30')).toThrow()
    expect(() => intervalZi('12.11.2026')).toThrow()
  })
})

describe('cererile', () => {
  it('fără credențiale în cererea păstrată; credențialele doar la apel', () => {
    const c = cerereConditii({ lat: 44.94, lng: 26.02, zi: ZI })
    expect(c).toBe('conditions/summary/44.94,26.02?from=1794434400&to=1794520799')
    const o = cerereObservatii({ lat: 44.94, lng: 26.02, zi: ZI })
    expect(o).toBe(`observations/summary/closest?p=44.94,26.02&radius=${RAZA_STATIE_KM}km&limit=1&from=1794434400&to=1794520799`)
    expect(c + o).not.toMatch(/client_/)
    expect(cuCredentiale(c, 'ID', 'S&X')).toBe(c + '&client_id=ID&client_secret=S%26X')
  })
  it('coordonate invalide = refuz', () => {
    expect(() => cerereConditii({ lat: 0, lng: 0, zi: ZI })).toThrow()
    expect(() => cerereObservatii({ lat: 91, lng: 26, zi: ZI })).toThrow()
  })
})

describe('clasificarea răspunsului (L05)', () => {
  it('5xx / 429 / rețea = tranzitoriu; 401 / 403 = neautorizat; warn_no_data / listă goală = fără date', () => {
    expect(clasificaRaspuns(0, null)).toBe('tranzitoriu')
    expect(clasificaRaspuns(503, {})).toBe('tranzitoriu')
    expect(clasificaRaspuns(429, {})).toBe('tranzitoriu')
    expect(clasificaRaspuns(401, {})).toBe('neautorizat')
    expect(clasificaRaspuns(200, { success: false, error: { code: 'invalid_client' } })).toBe('neautorizat')
    expect(clasificaRaspuns(200, { success: true, error: { code: 'warn_no_data' }, response: [] })).toBe('fara_date')
    expect(clasificaRaspuns(200, { success: true, error: null, response: [] })).toBe('fara_date')
    expect(clasificaRaspuns(400, { success: false, error: { code: 'invalid_location' } })).toBe('eroare')
    expect(clasificaRaspuns(200, 'text')).toBe('eroare')
    expect(clasificaRaspuns(200, conditii())).toBe('ok')
  })
})

describe('maparea conditions/summary', () => {
  it('valorile zilei, rotunjite la scara coloanei; direcția și descrierea', () => {
    expect(valoriDinConditii(conditii(), ZI)).toEqual({ valori: {
      tmin_c: 1.2, tmax_c: 9.46, tmed_c: 5.04, precipitatii_mm: 4.6, zapada_cm: 0, vant_max_kmh: 31.5, rafala_max_kmh: 52.3,
      vant_dir_grade: 315, umiditate_med: 81.4, vant_dir: 'NW', descriere: 'Mostly Cloudy with Light Rain',
    } })
  })
  it('rotunjirea la scara coloanei înainte de scriere (BD nu mai rotunjește în tăcere): 9,456 → 9,46; 359,6° → 0°', () => {
    const v = valoriDinConditii(conditii(summary({ temp: { maxC: 9.456, minC: 1.2 }, wind: { maxKPH: 10, maxDirDEG: 359.6 } })), ZI).valori
    expect(v.tmax_c).toBe(9.46)
    expect(v.vant_dir_grade).toBe(0)
  })
  it('lipsă ≠ 0: un câmp absent sau null rămâne null („0 mm” doar dacă API-ul a spus 0)', () => {
    const v = valoriDinConditii(conditii(summary({ precip: undefined, snow: { totalCM: null }, wind: { maxKPH: 20 } })), ZI).valori
    expect(v.precipitatii_mm).toBeNull()
    expect(v.zapada_cm).toBeNull()
    expect(v.rafala_max_kmh).toBeNull()
    expect(v.vant_dir).toBeNull()
    expect(valoriDinConditii(conditii(summary({ precip: { totalMM: 0 } })), ZI).valori.precipitatii_mm).toBe(0)
  })
  it('căile alternative documentate (windSpeed / windGust / humidity / weather ca text)', () => {
    const v = valoriDinConditii(conditii(summary({ wind: undefined, windSpeed: { maxKPH: 18 }, windGust: { maxKPH: 33 }, rh: undefined, humidity: { avg: 70 }, weather: 'Cloudy' })), ZI).valori
    expect([v.vant_max_kmh, v.rafala_max_kmh, v.umiditate_med, v.descriere]).toEqual([18, 33, 70, 'Cloudy'])
  })
  it('valori invalide = ziua respinsă (nu tăiată, nu scrisă)', () => {
    expect(valoriDinConditii(conditii(summary({ temp: { maxC: '9', minC: 1 } })), ZI).respins).toMatch(/tmax_c/)
    expect(valoriDinConditii(conditii(summary({ precip: { totalMM: -1 } })), ZI).respins).toMatch(/precipitatii_mm/)
    expect(valoriDinConditii(conditii(summary({ temp: { maxC: 1, minC: 5 } })), ZI).respins).toBe('Tmin > Tmax')
    expect(valoriDinConditii(conditii(summary({ temp: { maxC: 10, minC: 1, avgC: 12 } })), ZI).respins).toMatch(/Tmedie/)
    expect(valoriDinConditii(conditii(summary({ wind: { maxKPH: 10, maxDir: 'NORD' } })), ZI).respins).toMatch(/direcția/)
    expect(valoriDinConditii(conditii(summary({ weather: { phrase: 'a\u0007b' } })), ZI).respins).toMatch(/descrierea/)
    expect(valoriDinConditii(conditii(summary({ weather: { phrase: 'x'.repeat(201) } })), ZI).respins).toMatch(/descrierea/)
  })
  it('ziua: alt fus orar = respins; perioadă din altă zi = lipsă; două perioade pentru zi = respins', () => {
    expect(valoriDinConditii(conditii(summary(), { profile: { tz: 'Europe/Kiev' } }), ZI).respins).toMatch(/fus orar/)
    expect(valoriDinConditii(conditii(summary({ dateTimeISO: '2026-11-11T00:00:00+02:00' })), ZI).lipsa).toBeTruthy()
    const dublu = conditii(); dublu.response[0].periods.push({ summary: summary() })
    expect(valoriDinConditii(dublu, ZI).respins).toMatch(/mai multe/)
    expect(valoriDinConditii({ success: true, response: [] }, ZI).respins).toBeTruthy()
  })
  it('nicio valoare numerică = lipsă (nu un rând gol)', () => {
    const s = { dateTimeISO: '2026-11-12T00:00:00+02:00', weather: { phrase: 'Clear' } }
    expect(valoriDinConditii(conditii(s), ZI).lipsa).toBeTruthy()
  })
})

describe('stația cea mai apropiată (observations/summary)', () => {
  it('id, nume, distanța dată de API, poziția', () => {
    expect(statieDinObservatii('ok', observatii(), ZI)).toEqual({
      observatii_stare: 'ok', statie_id: 'LRBS', statie_nume: 'Bucuresti/Baneasa', statie_distanta_km: 12.37, statie_lat: 44.5, statie_lng: 26.08,
    })
  })
  it('lipsa stației NU e eroare: fără date / neautorizat / altceva — cu motivul, fără câmpurile stației', () => {
    const gol = { statie_id: null, statie_nume: null, statie_distanta_km: null, statie_lat: null, statie_lng: null }
    expect(statieDinObservatii('fara_date', null, ZI)).toEqual({ observatii_stare: 'fara_statie', ...gol })
    expect(statieDinObservatii('neautorizat', null, ZI)).toEqual({ observatii_stare: 'neautorizat', ...gol })
    expect(statieDinObservatii('eroare', null, ZI)).toEqual({ observatii_stare: 'eroare', ...gol })
    expect(statieDinObservatii('ok', observatii({ id: 'bad id!' }), ZI).observatii_stare).toBe('eroare')
    expect(statieDinObservatii('ok', observatii({ periods: [] }), ZI).observatii_stare).toBe('fara_statie')
  })
  it('distanța absentă sau în afara razei = NULL (nu o calculăm, nu o inventăm)', () => {
    expect(statieDinObservatii('ok', observatii({ relativeTo: {} }), ZI).statie_distanta_km).toBeNull()
    expect(statieDinObservatii('ok', observatii({ relativeTo: { distanceKM: 80 } }), ZI).statie_distanta_km).toBeNull()
  })
})

describe('planul unei rulări', () => {
  const S = [{ id: 1, lat: 44.9, lng: 26, proiect_id: 7 }, { id: 2, lat: 45, lng: 25.9, proiect_id: null }, { id: 3, lat: null, lng: null }]
  const ex = (m) => new Map(Object.entries(m).map(([k, zile]) => [k, new Map(zile.map(z => [z, { versiune: 1, data: z }]))]))
  it('zilnic: ieri nou + reverificarea lui alaltăieri (o singură dată), apoi zilele lipsă din ultimele 31, până la buget', () => {
    const p = planXweather(S, ex({ 1: ['2026-11-11', '2026-11-12'] }), new Map([['7', '2026-11-05']]), { mod: 'zilnic', ieri: '2026-11-12' })
    expect(p.sarite).toEqual([{ site_id: 3, motiv: 'fără coordonate (lat / lng)' }])
    const s1 = p.sarcini.filter(s => s.site_id === 1)
    // site 1: ieri există; alaltăieri (11) se reverifică; lipsesc 10 → 05 (de la data de start a proiectului)
    expect(s1.map(s => `${s.zi}:${s.tip}`)).toEqual(['2026-11-11:verificare', '2026-11-10:nou', '2026-11-09:nou', '2026-11-08:nou', '2026-11-07:nou', '2026-11-06:nou', '2026-11-05:nou'])
    const s2 = p.sarcini.filter(s => s.site_id === 2)
    expect(s2.slice(0, 2).map(s => `${s.zi}:${s.tip}`)).toEqual(['2026-11-12:nou', '2026-11-11:nou'])
    // zilele vechi: cel mult MAX_ZILE_AUTO pe toată rularea
    expect(p.sarcini.filter(s => s.zi <= '2026-11-10').length).toBe(MAX_ZILE_AUTO)
    expect(p.ramase).toBe(6 + (ZILE_AUTO - 2) - MAX_ZILE_AUTO)
    expect(p.continua_pana).toBeNull()
  })
  it('backfill: un șantier pe apel, de la cea mai nouă zi lipsă, max_zile, reluabil cu continua_pana; idempotent pe zilele existente', () => {
    const p = planXweather([S[0]], ex({ 1: ['2026-11-01'] }), new Map([['7', '2026-10-01']]), { mod: 'backfill', ieri: '2026-11-12', pana: '2026-11-03', maxZile: 3 })
    expect(p.sarcini.map(s => s.zi)).toEqual(['2026-11-03', '2026-11-02', '2026-10-31'])
    expect(p.continua_pana).toBe('2026-10-30')
    const p2 = planXweather([S[0]], ex({ 1: ['2026-11-01'] }), new Map([['7', '2026-10-01']]), { mod: 'backfill', ieri: '2026-11-12', pana: p.continua_pana, maxZile: MAX_ZILE_APEL })
    expect(p2.sarcini[0].zi).toBe('2026-10-30')
    expect(p2.sarcini.at(-1).zi).toBe('2026-10-01')
    expect(p2.ramase).toBe(0)
    expect(p2.continua_pana).toBeNull()
  })
  it('refuzuri: interval / max_zile invalide, backfill pe mai multe șantiere, fără dată de început', () => {
    expect(() => planXweather(S, new Map(), new Map(), { mod: 'backfill', ieri: '2026-11-12' })).toThrow(/un singur șantier/)
    expect(() => planXweather([S[0]], new Map(), new Map(), { mod: 'backfill', ieri: '2026-11-12', maxZile: 0 })).toThrow()
    expect(() => planXweather([S[0]], new Map(), new Map(), { mod: 'backfill', ieri: '2026-11-12', pana: '2026-11-13' })).toThrow()
    expect(() => planXweather(S, new Map(), new Map(), { mod: 'zilnic', ieri: '2026-11-12', deLa: '2026-11-01' })).toThrow()
    expect(planXweather([S[1]], new Map(), new Map(), { mod: 'backfill', ieri: '2026-11-12' }).sarite[0].motiv).toMatch(/fără dată de început/)
  })
})

describe('o zi: răspunsuri → rând / motiv', () => {
  const sarcina = { site_id: 10, lat: 44.94, lng: 26.02, zi: ZI, tip: 'nou' }
  const C = { status: 200, json: conditii(), cerere: 'conditions/summary/44.94,26.02?from=1&to=2' }
  const O = { status: 200, json: observatii(), cerere: 'observations/summary/closest?p=44.94,26.02' }
  it('rândul complet, versiunea 1, cu cererile fără credențiale și răspunsurile brute', () => {
    const z = procesZi(sarcina, C, O)
    expect(z.rand).toMatchObject({ site_id: 10, data: ZI, versiune: 1, tmax_c: 9.46, precipitatii_mm: 4.6, lat: 44.94, lng: 26.02,
      observatii_stare: 'ok', statie_id: 'LRBS', statie_distanta_km: 12.37, cerere_conditii: C.cerere, cerere_observatii: O.cerere })
    expect(z.rand.raspuns_conditii).toEqual(C.json)
    expect(z.rand.raspuns_observatii).toEqual(O.json)
    expect(JSON.stringify(z.rand)).not.toMatch(/client_(id|secret)/)
    expect(Object.keys(z.rand)).not.toContain('preluat_la')   // îl pune serverul
  })
  it('fără stație: rândul se scrie cu motivul (lipsa stației nu e eroare)', () => {
    const z = procesZi(sarcina, C, { status: 200, json: { success: true, error: { code: 'warn_no_data' }, response: [] }, cerere: O.cerere })
    expect(z.rand.observatii_stare).toBe('fara_statie')
    expect(z.rand.statie_id).toBeNull()
  })
  it('tranzitoriu (rețea / 5xx) = nimic scris, se reia; fără date = lipsă; respins; neautorizat = eroare', () => {
    expect(procesZi(sarcina, { status: 0, json: null, cerere: C.cerere }, null).tranzitoriu).toBeTruthy()
    expect(procesZi(sarcina, C, { status: 502, json: null, cerere: O.cerere }).tranzitoriu).toBeTruthy()
    expect(procesZi(sarcina, { status: 200, json: { success: true, error: { code: 'warn_no_data' } }, cerere: C.cerere }, null).lipsa).toBeTruthy()
    expect(procesZi(sarcina, { status: 200, json: conditii(summary({ temp: { maxC: 1, minC: 5 } })), cerere: C.cerere }, O).respins).toBeTruthy()
    expect(procesZi(sarcina, { status: 403, json: {}, cerere: C.cerere }, null).eroare).toMatch(/neautorizat/)
  })
  it('reverificarea (idempotență): aceleași valori = neschimbat (nimic scris); altele = versiune + 1, nu suprascriere', () => {
    const v1 = procesZi(sarcina, C, O).rand
    const anterior = Object.fromEntries([...VALORI, 'versiune'].map(k => [k, v1[k]]))
    expect(procesZi({ ...sarcina, tip: 'verificare', anterior }, C, O)).toEqual({ neschimbat: true })
    // valorile din BD vin la scara coloanei (numeric): 9.46 rămâne 9.46; textul comparat exact
    expect(valoriEgale({ ...anterior, tmax_c: '9.46' }, anterior)).toBe(true)
    const corectat = { status: 200, json: conditii(summary({ precip: { totalMM: 6.2 } })), cerere: C.cerere }
    const z = procesZi({ ...sarcina, tip: 'verificare', anterior }, corectat, O)
    expect(z.rand.versiune).toBe(2)
    expect(z.rand.precipitatii_mm).toBe(6.2)
    // null ≠ 0 la comparare
    expect(valoriEgale({ ...anterior, zapada_cm: null }, { ...anterior, zapada_cm: 0 })).toBe(false)
  })
  it('răspunsul brut prea mare = refuz (CHECK-ul tabelului)', () => {
    expect(() => brut({ x: 'a'.repeat(200_001) })).toThrow()
  })
})
