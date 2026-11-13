// r4 — pasul zilnic Vaisala Xweather trebuie să încapă în cota de 15.000 de accese / lună: țintele după activitate, plafonul de accese,
// termenul și oprirea rulării (logica pură din supabase/functions/meteo-sync/xweather_zilnic_logica.ts). Valorile așteptate sunt scrise de
// mână (L25). Bucla reală (numărătoarea, plafonul aplicat, termenul) e testată pe handler, cu rețea simulată: meteoSyncCotaHandler.test.js.
import { describe, it, expect } from 'vitest'
import {
  planXweather, santierActiv, fereastraZilnica, poateIncepeZi, timpCerere, motivOprire,
  ZILE_ACTIVITATE, ZILE_RELUARE_ACTIVE, FEREASTRA_RAPOARTE_ZILE, MAX_UNITATI_XW_APEL, ACCESE_MAX_ZI, BUGET_XW_ZILNIC_MS, BUGET_XW_APEL_MS,
  MIN_TIMP_ZI_MS, TIMP_CERERE_MS, NEAJUNSA_PLAFON, NEAJUNSA_TIMP, PRIMA_ZI_XW, MAX_ZILE_APEL,
} from '../supabase/functions/meteo-sync/xweather_zilnic_logica.ts'
import { MAX_UNITATI_XW_RULARE } from '../supabase/functions/meteo-sync/xweather_cota_logica.ts'

// azi = 13.11.2026 (ora României), ieri = 12.11
const IERI = '2026-11-12'
const site = (id, o = {}) => ({ id, lat: 44 + id / 10, lng: 26, proiect_id: null, ...o })
const rap = (o) => new Map(Object.entries(o).map(([k, zile]) => [k, new Set(zile)]))
const ex = (o) => new Map(Object.entries(o).map(([k, zile]) => [k, new Map(zile.map(z => [z, { versiune: 1, data: z }]))]))
const zile7 = ['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06']
const fmt = (p) => p.sarcini.map(s => `${s.site_id}:${s.zi}:${s.tinta}`)

describe('constantele cotei (un singur loc, valorile din livrare)', () => {
  it('pragurile', () => {
    expect([ZILE_ACTIVITATE, ZILE_RELUARE_ACTIVE, FEREASTRA_RAPOARTE_ZILE, MAX_UNITATI_XW_RULARE, MAX_UNITATI_XW_APEL, ACCESE_MAX_ZI]).toEqual([14, 7, 31, 60, 62, 2])
    expect([BUGET_XW_ZILNIC_MS, BUGET_XW_APEL_MS, MIN_TIMP_ZI_MS, TIMP_CERERE_MS]).toEqual([40_000, 100_000, 5_000, 25_000])
    // comanda owner-ului: apelul implicit (max_zile 31) încape exact sub plafonul ei (costurile documentate: 1 + 1 pe zi-șantier)
    expect(31 * ACCESE_MAX_ZI).toBe(MAX_UNITATI_XW_APEL)
    expect(MAX_ZILE_APEL).toBe(62)
  })
})

describe('șantier activ = raport zilnic în ultimele 14 zile', () => {
  it('raport acum 13 zile → activ; acum 14 → activ (granița); acum 15 → nu; fără rapoarte → nu', () => {
    expect(santierActiv(new Set(['2026-10-31']), IERI)).toBe(true)    // azi − 13
    expect(santierActiv(new Set(['2026-10-30']), IERI)).toBe(true)    // azi − 14 = ieri − 13
    expect(santierActiv(new Set(['2026-10-29']), IERI)).toBe(false)   // azi − 15
    expect(santierActiv(new Set(['2026-11-13']), IERI)).toBe(true)    // raportul de azi
    expect(santierActiv(new Set(), IERI)).toBe(false)
    expect(santierActiv(undefined, IERI)).toBe(false)
  })
})

describe('planul zilnic (r4): (a) șantierele active, (b) zilele cu raport fără vreme, nimic altceva', () => {
  it('(a) raport acum 13 zile → ieri + zilele lipsă din ultimele 7; raport acum 15 zile → doar ziua raportului (b), fără ieri', () => {
    const p = planXweather([site(1), site(2)], new Map(), new Map(), { mod: 'zilnic', ieri: IERI,
      rapoarte: rap({ 1: ['2026-10-31'], 2: ['2026-10-29'] }) })
    expect(fmt(p)).toEqual([...zile7.map(z => `1:${z}:activ`), '1:2026-10-31:raport', '2:2026-10-29:raport'])
    expect(p.activi).toEqual([1])
    expect(p.sarcini.every(s => s.tip === 'nou')).toBe(true)
  })
  it('(a) chiar fără raport ieri (zi nelucrată din cauza vremii); (b) zi cu raport și cu vreme = nu se cere', () => {
    const p = planXweather([site(1)], ex({ 1: ['2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-10-20'] }),
      new Map(), { mod: 'zilnic', ieri: IERI, rapoarte: rap({ 1: ['2026-11-05', '2026-10-20', '2026-10-19'] }) })
    // 05.11 (raport, în afara ferestrei de reluare) intră ca (b); 20.10 are vreme → nu
    expect(fmt(p)).toEqual(['1:2026-11-12:activ', '1:2026-11-05:raport', '1:2026-10-19:raport'])
  })
  it('fără niciun raport = nicio cerere (vremea activă nu mai ajunge: țintele vechi = toate șantierele)', () => {
    const p = planXweather([site(1), site(2), site(3)], new Map(), new Map(), { mod: 'zilnic', ieri: IERI, rapoarte: new Map() })
    expect(p.sarcini).toEqual([])
    expect(p.activi).toEqual([])
  })
  it('ordinea: întâi (a), apoi (b) — fiecare cu cele mai noi întâi; la aceeași zi, după șantier; fără dubluri (a)/(b)', () => {
    const p = planXweather([site(3), site(1), site(2)], ex({ 1: zile7.slice(1), 3: zile7 }), new Map(), { mod: 'zilnic', ieri: IERI,
      rapoarte: rap({ 1: ['2026-11-12', '2026-10-14', '2026-10-15'], 2: ['2026-10-15', '2026-10-13'], 3: ['2026-11-01', '2026-10-15'] }) })
    // site 1 activ: ieri lipsește (și are raport) → o singură sarcină, ca „activ”; site 3 activ, fereastra completă
    expect(fmt(p)).toEqual(['1:2026-11-12:activ', '3:2026-11-01:raport', '1:2026-10-15:raport', '2:2026-10-15:raport', '3:2026-10-15:raport',
      '1:2026-10-14:raport', '2:2026-10-13:raport'])
  })
  it('r5: (b) doar din ultimele 31 de zile (≥ 13.10); mai vechi (12.10, 01.09) = doar comanda owner-ului', () => {
    const p = planXweather([site(2)], new Map(), new Map(), { mod: 'zilnic', ieri: IERI, rapoarte: rap({ 2: ['2026-10-13', '2026-10-12', '2026-09-01'] }) })
    expect(fmt(p)).toEqual(['2:2026-10-13:raport'])
  })
  it('zile din afara ferestrei: raport azi (zi neîncheiată) nu; înainte de PRIMA_ZI_XW nu; data de start a proiectului taie doar (a)', () => {
    const p = planXweather([site(1, { proiect_id: 7 })], new Map(), new Map([['7', '2026-11-10']]), { mod: 'zilnic', ieri: IERI,
      rapoarte: rap({ 1: ['2026-11-13', '2014-12-31', '2026-11-01'] }) })
    expect(fmt(p)).toEqual(['1:2026-11-12:activ', '1:2026-11-11:activ', '1:2026-11-10:activ', '1:2026-11-01:raport'])
  })
  it('reverificarea automată NU mai are loc: o zi existentă (alaltăieri inclusiv) nu apare în planul zilnic; reverifica e refuzat', () => {
    const p = planXweather([site(1)], ex({ 1: ['2026-11-11'] }), new Map(), { mod: 'zilnic', ieri: IERI, rapoarte: rap({ 1: ['2026-11-11'] }) })
    expect(p.sarcini.some(s => s.zi === '2026-11-11' || s.tip === 'verificare')).toBe(false)
    expect(() => planXweather([site(1)], new Map(), new Map(), { mod: 'zilnic', ieri: IERI, reverifica: true })).toThrow(/reverificare/)
  })
  it('r5: fereastra citită din BD e fixă: ultimele 31 de zile până ieri (cuprinde reluarea de 7 și activitatea de 14); nu sub PRIMA_ZI_XW', () => {
    expect(fereastraZilnica(IERI)).toBe('2026-10-13')
    expect(fereastraZilnica('2026-03-01')).toBe('2026-01-30')
    expect(fereastraZilnica('2015-01-10')).toBe(PRIMA_ZI_XW)
  })
})

describe('plafonul de accese, termenul, oprirea', () => {
  const T = 1_000_000
  it('o zi începe doar dacă încape ÎNTREAGĂ sub plafon: 58 → da (60), 59 → nu (ar fi 61)', () => {
    expect(poateIncepeZi(0, 60, T, T + 40_000)).toBeNull()
    expect(poateIncepeZi(58, 60, T, T + 40_000)).toBeNull()
    expect(poateIncepeZi(59, 60, T, T + 40_000)).toBe(NEAJUNSA_PLAFON)
    expect(poateIncepeZi(60, 60, T, T + 40_000)).toBe(NEAJUNSA_PLAFON)
  })
  it('termenul: o zi nouă cere cel puțin 5 s rămase', () => {
    expect(poateIncepeZi(0, 60, T + 35_000, T + 40_000)).toBeNull()
    expect(poateIncepeZi(0, 60, T + 35_001, T + 40_000)).toBe(NEAJUNSA_TIMP)
    expect(NEAJUNSA_PLAFON).toBe('neajunsă (plafonul de unități)')
    expect(NEAJUNSA_TIMP).toBe('neajunsă (bugetul de timp)')
  })
  it('timpul unei cereri: cel mult 25 s și niciodată după termen (≤ 0 = nu se trimite)', () => {
    expect(timpCerere(T, T + 40_000)).toBe(25_000)
    expect(timpCerere(T + 30_000, T + 40_000)).toBe(10_000)
    expect(timpCerere(T + 40_000, T + 40_000)).toBe(0)
    expect(timpCerere(T + 41_000, T + 40_000)).toBeLessThan(0)
  })
  it('oprirea rulării: 429 / maxhits la orice cerere; neautorizat doar la conditions; 5xx / fără date nu opresc', () => {
    expect(motivOprire('conditions', 429, null)).toMatch(/limita de accese/)
    expect(motivOprire('observations', 429, {})).toMatch(/limita de accese/)
    expect(motivOprire('conditions', 403, { success: false, error: { code: 'maxhits_daily' } })).toMatch(/maxhits_daily/)
    expect(motivOprire('conditions', 401, {})).toMatch(/cont neautorizat/)
    expect(motivOprire('conditions', 200, { success: false, error: { code: 'invalid_client' } })).toMatch(/cont neautorizat/)
    expect(motivOprire('observations', 403, {})).toBeNull()
    expect(motivOprire('conditions', 503, null)).toBeNull()
    expect(motivOprire('conditions', 0, null)).toBeNull()
    expect(motivOprire('conditions', 200, { success: true, error: { code: 'warn_no_data' }, response: [] })).toBeNull()
  })
})
