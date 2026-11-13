// r3 (review PR #1085 r2, două P2): garda reverificării (o versiune nouă nu pierde nimic față de cea afișată) și rezultatul adevărat al
// unui lot (zile cerute și nesalvate → ok:false / complet:false). Fixture-uri și valori așteptate SCRISE DE MÂNĂ (L25).
import { describe, it, expect } from 'vitest'
import {
  procesZi, planXweather, zConfirmata, continuaPana, campuriPierdute, pastreazaStatia, motivNesalvat, rezultatLot, statusHttpXweather,
  valoriDinConditii, VALORI,
} from '../supabase/functions/meteo-sync/xweather_zilnic_logica.ts'

const ZI = '2026-11-12'
const PER = {
  dateTimeISO: '2026-11-12T00:00:00+02:00',
  temp: { maxC: 9.46, minC: 1.2, avgC: 5.04 }, precip: { totalMM: 4.6 }, snow: { totalCM: 0 },
  windSpeed: { maxKPH: 31.5, maxDir: 'NW', maxDirDEG: 315 }, windGust: { maxKPH: 52.3 }, humidity: { avg: 81.4 },
  weather: { phrase: 'Mostly Cloudy with Light Rain' },
}
const cond = (p) => ({ status: 200, cerere: 'conditions/summary/44.94,26.02?from=1&to=2',
  json: { success: true, error: null, response: [{ loc: { lat: 44.94, long: 26.02 }, profile: { tz: 'Europe/Bucharest' }, periods: [p] }] } })
const OBS = { status: 200, cerere: 'observations/summary/closest?p=44.94,26.02',
  json: { success: true, error: null, response: [{ id: 'LRBS', loc: { lat: 44.5, long: 26.08 }, place: { name: 'Bucuresti/Baneasa' },
    profile: { tz: 'Europe/Bucharest' }, relativeTo: { distanceKM: 12.37 },
    periods: [{ summary: { dateTimeISO: '2026-11-12T00:00:00+02:00', ymd: 20261112, temp: { maxC: 9 } } }] }] } }
const OBS_400 = { status: 400, cerere: OBS.cerere, json: { success: false, error: { code: 'invalid_location', description: 'x' } } }
const NOU = { site_id: 10, lat: 44.94, lng: 26.02, zi: ZI, tip: 'nou' }
// versiunea 1 completă, așa cum o întoarce vederea (valori + versiune + poziția stației), scrisă de mână
const V1 = {
  versiune: 1, tmin_c: 1.2, tmax_c: 9.46, tmed_c: 5.04, precipitatii_mm: 4.6, zapada_cm: 0, vant_max_kmh: 31.5, rafala_max_kmh: 52.3,
  vant_dir: 'NW', vant_dir_grade: 315, umiditate_med: 81.4, descriere: 'Mostly Cloudy with Light Rain',
  observatii_stare: 'ok', statie_id: 'LRBS', statie_nume: 'Bucuresti/Baneasa', statie_distanta_km: 12.37, statie_lat: 44.5, statie_lng: 26.08,
}
const VER = { ...NOU, tip: 'verificare', anterior: V1 }

describe('garda reverificării: o versiune nouă nu pierde nimic față de cea afișată', () => {
  it('fixture-ul V1 = exact ce scrie prima rulare (altfel testele de mai jos n-ar dovedi nimic)', () => {
    const r = procesZi(NOU, cond(PER), OBS).rand
    for (const k of [...VALORI, 'statie_lat', 'statie_lng']) expect(r[k], k).toEqual(V1[k])
    expect(procesZi(VER, cond(PER), OBS)).toEqual({ neschimbat: true })
  })
  it('răspuns parțial după versiunea completă (doar temp.maxC): NIMIC scris, consemnat ca incomplet, cu câmpurile pierdute', () => {
    const z = procesZi(VER, cond({ dateTimeISO: PER.dateTimeISO, temp: { maxC: 9 } }), OBS)
    expect(z.rand).toBeUndefined()
    expect(z.incomplet).toMatch(/răspuns incomplet la reverificare/)
    for (const c of ['tmin_c', 'tmed_c', 'precipitatii_mm', 'zapada_cm', 'vant_max_kmh', 'rafala_max_kmh', 'vant_dir', 'vant_dir_grade', 'umiditate_med', 'descriere']) {
      expect(z.incomplet).toContain(c)
    }
    expect(z.incomplet).not.toContain('tmax_c')
    // rezultat dovedit: cursorul completării nu se blochează pe zi
    expect(zConfirmata(z, null)).toBe(true)
  })
  it('un singur câmp pierdut (zăpada 0 → lipsă) ajunge: incomplet, nu versiune nouă', () => {
    const { snow, ...fara } = PER
    expect(snow).toEqual({ totalCM: 0 })
    expect(procesZi(VER, cond(fara), OBS).incomplet).toMatch(/zapada_cm/)
  })
  it('observații HTTP 400 după stația cunoscută, condiții identice: stația rămâne, nimic scris (neschimbat, cu mențiunea)', () => {
    expect(procesZi(VER, cond(PER), OBS_400)).toEqual({ neschimbat: true, statie_pastrata: true })
  })
  it('observații 400 + corecție reală a condițiilor: versiunea 2 cu valorile noi și stația din v1; eșecul stă în raspuns_observatii', () => {
    const z = procesZi(VER, cond({ ...PER, precip: { totalMM: 6.2 } }), OBS_400)
    expect(z.statie_pastrata).toBe(true)
    expect(z.rand).toMatchObject({ versiune: 2, precipitatii_mm: 6.2, observatii_stare: 'ok', statie_id: 'LRBS', statie_nume: 'Bucuresti/Baneasa',
      statie_distanta_km: 12.37, statie_lat: 44.5, statie_lng: 26.08, cerere_observatii: OBS.cerere })
    expect(z.rand.raspuns_observatii).toEqual({ statie_din_versiunea: 1, reverificare_observatii: 'esuata', status: 400, stare: 'eroare', raspuns: OBS_400.json })
  })
  it('observații „neautorizat” / „fără stație” după stație cunoscută: stația se păstrează (nu devine NULL)', () => {
    expect(procesZi(VER, cond(PER), { status: 403, json: {}, cerere: OBS.cerere })).toEqual({ neschimbat: true, statie_pastrata: true })
    const fara = { status: 200, json: { success: true, error: { code: 'warn_no_data' }, response: [] }, cerere: OBS.cerere }
    expect(procesZi(VER, cond(PER), fara)).toEqual({ neschimbat: true, statie_pastrata: true })
  })
  it('„eroare” peste o stare cunoscută fără stație (fara_statie) nu o înlocuiește; „eroare” peste „eroare” = nimic de păstrat', () => {
    const ant = { ...V1, observatii_stare: 'fara_statie', statie_id: null, statie_nume: null, statie_distanta_km: null, statie_lat: null, statie_lng: null }
    expect(procesZi({ ...VER, anterior: ant }, cond(PER), OBS_400)).toEqual({ neschimbat: true, statie_pastrata: true })
    const antE = { ...ant, observatii_stare: 'eroare' }
    expect(procesZi({ ...VER, anterior: antE }, cond(PER), OBS_400)).toEqual({ neschimbat: true })
    // o stație nouă găsită acum, unde înainte era eroare = informație în plus → versiune nouă
    expect(procesZi({ ...VER, anterior: antE }, cond(PER), OBS).rand).toMatchObject({ versiune: 2, statie_id: 'LRBS' })
  })
  it('corecție reală, la fel de completă: versiune nouă, ca până acum (fără statie_pastrata)', () => {
    const z = procesZi(VER, cond({ ...PER, temp: { maxC: 10.1, minC: 1.2, avgC: 5.04 } }), OBS)
    expect(z.rand).toMatchObject({ versiune: 2, tmax_c: 10.1, tmin_c: 1.2, statie_id: 'LRBS' })
    expect(z.statie_pastrata).toBeUndefined()
    expect(z.rand.raspuns_observatii).toEqual(OBS.json)
  })
  it('corecție mai completă (v1 fără zăpadă, acum cu zăpadă): versiune nouă', () => {
    const ant = { ...V1, zapada_cm: null }
    expect(procesZi({ ...VER, anterior: ant }, cond(PER), OBS).rand).toMatchObject({ versiune: 2, zapada_cm: 0 })
  })
  it('prima versiune parțială: nu e nimic de degradat → se scrie, câmpurile lipsă NULL', () => {
    const z = procesZi(NOU, cond({ dateTimeISO: PER.dateTimeISO, temp: { maxC: 9 } }), OBS_400)
    expect(z.rand).toMatchObject({ versiune: 1, tmax_c: 9, tmin_c: null, precipitatii_mm: null, descriere: null, observatii_stare: 'eroare', statie_id: null })
    expect(z.rand.raspuns_observatii).toEqual(OBS_400.json)
    expect(z.statie_pastrata).toBeUndefined()
  })
  it('campuriPierdute / pastreazaStatia: cazurile de bază', () => {
    expect(campuriPierdute(V1, { ...V1 })).toEqual([])
    expect(campuriPierdute(V1, { ...V1, descriere: null, statie_lat: null })).toEqual(['descriere', 'statie_lat'])
    expect(campuriPierdute({ tmax_c: 1 }, { tmax_c: 1 })).toEqual([])   // poziția stației doar dacă anteriorul o are
    expect(pastreazaStatia(V1, { observatii_stare: 'ok' })).toBe(false)
    expect(pastreazaStatia(V1, { observatii_stare: 'eroare' })).toBe(true)
    expect(pastreazaStatia({ observatii_stare: 'neautorizat' }, { observatii_stare: 'fara_statie' })).toBe(false)
  })
})

describe('aliasurile tolerate (nedocumentate) se numără separat', () => {
  it('căile documentate: fără aliasuri; căile tolerate: listate', () => {
    expect(valoriDinConditii(cond(PER).json, ZI).aliasuri).toBeUndefined()
    const { windSpeed, windGust, humidity, ...rest } = PER
    const v = valoriDinConditii(cond({ ...rest, wind: { maxKPH: 30, gustKPH: 50, maxDir: 'N', maxDirDEG: 10 }, rh: { avg: 70 } }).json, ZI)
    expect(v.valori).toMatchObject({ vant_max_kmh: 30, rafala_max_kmh: 50, vant_dir: 'N', vant_dir_grade: 10, umiditate_med: 70 })
    expect(v.aliasuri.sort()).toEqual(['rh.avg', 'wind.gustKPH', 'wind.maxDir', 'wind.maxDirDEG', 'wind.maxKPH'])
    expect(procesZi(NOU, cond({ ...PER, weather: 'Rain' }), OBS).aliasuri).toEqual(['weather'])
  })
})

describe('rezultatul lotului: zile cerute și nesalvate → ok:false, complet:false', () => {
  const ziCu = (z, scriere) => (zConfirmata(z, scriere) ? null : motivNesalvat(z, scriere))
  it('lot doar cu 5xx: ok:false, complet:false, numărul și lista (zi, șantier, motiv); HTTP 207', () => {
    const zile = ['2026-11-12', '2026-11-11']
    const nes = zile.map(zi => ({ site_id: 10, zi, motiv: ziCu(procesZi({ ...NOU, zi }, { status: 503, json: null, cerere: 'c' }, null), null) }))
    const r = rezultatLot([], nes)
    expect(r).toEqual({ ok: false, complet: false, nr_nesalvate: 2, zile_nesalvate: [
      { site_id: 10, zi: '2026-11-12', motiv: 'tranzitoriu (se reia): conditions 503' },
      { site_id: 10, zi: '2026-11-11', motiv: 'tranzitoriu (se reia): conditions 503' }] })
    expect(statusHttpXweather(r)).toBe(207)
  })
  it('lot mixt (o zi scrisă, una 502 la observații, una scriere eșuată): ok:false, 2 nesalvate', () => {
    const z1 = procesZi(NOU, cond(PER), OBS)
    const z2 = procesZi(NOU, cond(PER), { status: 502, json: null, cerere: OBS.cerere })
    const z3 = procesZi(NOU, cond(PER), OBS)
    expect(ziCu(z1, 'ok')).toBeNull()
    const nes = [{ site_id: 10, zi: 'a', motiv: ziCu(z2, null) }, { site_id: 11, zi: 'b', motiv: ziCu(z3, 'eroare') }]
    const r = rezultatLot(['site 11 b: scrierea a eșuat (XX000)'], nes)
    expect(r).toMatchObject({ ok: false, complet: false, nr_nesalvate: 2 })
    expect(r.zile_nesalvate.map(x => x.motiv)).toEqual(['tranzitoriu (se reia): observations 502', 'scriere eșuată'])
  })
  it('lot complet (scrise, neschimbate, fără date, incomplete la reverificare): ok:true, complet:true, HTTP 200', () => {
    const rez = [[procesZi(NOU, cond(PER), OBS), 'ok'], [procesZi(VER, cond(PER), OBS), null],
      [procesZi(NOU, { status: 200, json: { success: true, error: { code: 'warn_no_data' } }, cerere: 'c' }, null), null],
      [procesZi(VER, cond({ dateTimeISO: PER.dateTimeISO, temp: { maxC: 9 } }), OBS), null]]
    expect(rez.every(([z, s]) => ziCu(z, s) === null)).toBe(true)
    const r = rezultatLot([], [])
    expect(r).toEqual({ ok: true, complet: true, nr_nesalvate: 0, zile_nesalvate: [] })
    expect(statusHttpXweather(r)).toBe(200)
    expect(statusHttpXweather(null)).toBe(200)            // pasul n-a rulat
    expect(statusHttpXweather({ ok: false, eroare: 'x' })).toBe(207)
  })
  it('lista plafonată la 62, numărul nu', () => {
    const nes = Array.from({ length: 70 }, (_, i) => ({ site_id: 1, zi: String(i), motiv: 'm' }))
    expect(rezultatLot([], nes)).toMatchObject({ nr_nesalvate: 70, ok: false })
    expect(rezultatLot([], nes).zile_nesalvate).toHaveLength(62)
  })
})

describe('reluarea (r4): rularea următoare recuperează zilele nesalvate ale șantierelor active și zilele cu raport', () => {
  const S = [{ id: 10, lat: 44.94, lng: 26.02, proiect_id: null }]
  const rap = (...zile) => new Map([['10', new Set(zile)]])
  it('ieri căzut pe 5xx (nescris), fără raport în ziua aceea → a doua zi e tot în plan (reluarea șantierului activ)', () => {
    const ex = new Map([['10', new Map([['2026-11-13', { versiune: 1 }]])]])
    const p = planXweather(S, ex, new Map(), { mod: 'zilnic', ieri: '2026-11-13', rapoarte: rap('2026-11-10') })
    expect(p.sarcini.filter(s => s.zi === '2026-11-12').map(s => `${s.tip}:${s.tinta}`)).toEqual(['nou:activ'])
  })
  it('o zi fără vreme acum 10 zile: cu raport → în plan (oricât de veche); fără raport → nu (doar completarea owner-ului)', () => {
    const ex = new Map([['10', new Map()]])
    const zile = []
    for (let d = new Date('2026-10-01T12:00:00Z'); d <= new Date('2026-11-13T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) zile.push(d.toISOString().slice(0, 10))
    for (const z of zile) if (!['2026-11-03', '2026-10-04', '2026-10-05'].includes(z)) ex.get('10').set(z, { versiune: 1 })
    const p = planXweather(S, ex, new Map(), { mod: 'zilnic', ieri: '2026-11-13', rapoarte: rap('2026-11-12', '2026-10-04') })
    expect(p.sarcini.map(s => `${s.zi}:${s.tinta}`)).toEqual(['2026-10-04:raport'])
    expect(p.sarcini.some(s => s.zi === '2026-11-03' || s.zi === '2026-10-05')).toBe(false)
  })
  it('completarea owner-ului: cursorul pornește de la ziua tranzitorie, nu o sare', () => {
    const p = planXweather(S, new Map(), new Map(), { mod: 'backfill', ieri: '2026-11-13', deLa: '2026-11-01', pana: '2026-11-05', maxZile: 5 })
    expect(continuaPana(p.sarcini, new Set(['2026-11-05', '2026-11-03', '2026-11-02', '2026-11-01']), p.ramase)).toBe('2026-11-04')
  })
})
