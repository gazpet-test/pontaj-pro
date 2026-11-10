// Teste pentru logica „🧵 Fibră optică” (fibraOpticaLogica.js). Date SINTETICE (tronsoane T1–T3 fictive); valorile așteptate sunt calculate
// de mână în comentarii, nu din codul testat. Paritatea cu SQL: listele de etape și de tranziții se citesc din migrarea 20261211a.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ETAPE, ETAPA_ANTERIOARA, ETAPA_URMATOARE, TRANZITII_CAMERETA, tranzitieCameretaPermisa, RE_COD_CAMERETA, parseKm, fmtKm, areKm,
  ordoneazaTronsoane, valideazaRaport, blocajAnulare, poateAnula, poateAnulaMontarea, poateScoateCamereta, rezumatTronson, rezumatProiect,
  csvRezumat, bandaTronson, deFacut, payloadRaport, payloadAnulare, payloadCameretaNoua, payloadCameretaStare, valideazaCameretaNoua,
  RPC_FIBRA, prefixRegistruFibra, textJurnal,
} from './fibraOpticaLogica.js'
import { registruNou, RPC_PROBE } from './probeTronsoaneLogica.js'

const SQL = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261211a_executie_fibra_optica.sql', import.meta.url)), 'utf8').replace(/\r/g, '')
const bloc = (start, end) => SQL.slice(SQL.indexOf(start), SQL.indexOf(end))

const T1 = { id: 1, proiect_id: 9, cod: 'T1', km_start_m: 10000, km_end_m: 12000 }
const T2 = { id: 2, proiect_id: 9, cod: 'T2', km_start_m: 12000, km_end_m: 15000 }
const T3 = { id: 3, proiect_id: 9, cod: 'T3', km_start_m: null, km_end_m: null }
let nextId = 100
const I = (tronson, etapa, a, b, data, extra = {}) => ({ id: nextId++, proiect_id: 9, tronson_id: tronson.id, etapa, km_de_la_m: a, km_pana_la_m: b, data_lucru: data, stare: 'activ', raportat_de: 'u1', ...extra })
const AZI = '2026-11-10'

describe('paritatea cu migrarea 20261211a', () => {
  it('etapele și etapa anterioară sunt aceleași ca în fn_executie_fibra_etapa_anterioara', () => {
    const b = bloc('-- ETAPE-START', '-- ETAPE-END')
    const perechi = [...b.matchAll(/\('([a-z]+)', (NULL::text|'([a-z]+)')\)/g)].map(m => [m[1], m[3] ?? null])
    expect(perechi).toEqual([['monotub', null], ['validat', 'monotub'], ['suflat', 'validat']])
    expect(perechi.map(p => p[0])).toEqual(ETAPE)
    expect(Object.fromEntries(perechi)).toEqual(ETAPA_ANTERIOARA)
    for (const [et, ant] of perechi) if (ant) expect(ETAPA_URMATOARE[ant]).toBe(et)
    expect(ETAPA_URMATOARE.suflat).toBe(null)
  })
  it('tranzițiile cameretei sunt aceleași ca în fn_executie_fibra_cam_tranzitie', () => {
    const b = bloc('-- TRANZITII-START', '-- TRANZITII-END')
    const perechi = [...b.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map(m => [m[1], m[2]])
    expect(perechi).toEqual(TRANZITII_CAMERETA)
    expect(tranzitieCameretaPermisa('de_montat', 'montata')).toBe(true)
    expect(tranzitieCameretaPermisa('montata', 'anulata')).toBe(false)
    expect(tranzitieCameretaPermisa('anulata', 'de_montat')).toBe(false)
  })
  it('codul cameretei: același tipar ca CHECK-ul din tabel', () => {
    expect(SQL).toContain(`cod text NOT NULL CHECK (cod ~ '^[A-Z0-9][A-Z0-9./_-]{0,29}$')`)
    expect(RE_COD_CAMERETA.source).toBe('^[A-Z0-9][A-Z0-9./_-]{0,29}$')
    for (const ok of ['CT-1', 'C12', 'CAM.3/A', 'X_1']) expect(RE_COD_CAMERETA.test(ok)).toBe(true)
    for (const ko of ['', '-C1', 'ct-1', 'C 1', 'A'.repeat(31)]) expect(RE_COD_CAMERETA.test(ko)).toBe(false)
  })
  it('RPC-urile din registru sunt exact cele 4 RPC-uri de scriere ale migrării', () => {
    for (const rpc of RPC_FIBRA) expect(SQL).toContain(`CREATE FUNCTION public.${rpc}(`)
    expect(RPC_FIBRA).toHaveLength(4)
  })
})

describe('km', () => {
  it('„12+350” și metri întregi; altceva = NaN', () => {
    expect(parseKm('12+350')).toBe(12350)
    expect(parseKm(' 0+005 ')).toBe(5)
    expect(parseKm('12350')).toBe(12350)
    expect(parseKm('')).toBe(null)
    for (const ko of ['12+35', '12+3500', '12,5', '-5', '12+350+1', 'abc']) expect(Number.isNaN(parseKm(ko))).toBe(true)
    expect(fmtKm(12350)).toBe('12+350')
    expect(fmtKm(5)).toBe('0+005')
  })
  it('tronsoanele: cu km întâi (după început), fără km la final', () => {
    expect(ordoneazaTronsoane([T3, T2, T1]).map(t => t.cod)).toEqual(['T1', 'T2', 'T3'])
    expect(areKm(T3)).toBe(false)
    expect(areKm({ km_start_m: 5, km_end_m: 5 })).toBe(false)
  })
})

describe('valideazaRaport (aceleași reguli ca baza)', () => {
  const m1 = I(T1, 'monotub', 10000, 10500, '2026-11-10')
  const m2 = I(T1, 'monotub', 10500, 11000, '2026-11-09')
  const v1 = I(T1, 'validat', 10200, 10800, '2026-11-10')
  const anulat = I(T1, 'monotub', 11000, 11500, '2026-11-10', { stare: 'anulat' })
  const intervale = [m1, m2, v1, anulat]
  const val = o => valideazaRaport({ tronson: T1, data: AZI, azi: AZI, intervale, ...o })
  it('intervalul corect trece; capetele se pot atinge', () => {
    expect(val({ etapa: 'monotub', deLa: 11000, panaLa: 11800 })).toEqual([])   // peste un interval ANULAT: permis
    expect(val({ etapa: 'validat', deLa: 10800, panaLa: 11000, data: '2026-11-09' })).toEqual([])
  })
  it('limitele tronsonului, ordinea, formatul', () => {
    expect(val({ etapa: 'monotub', deLa: 11900, panaLa: 12100 })).toEqual(['Intervalul iese din tronsonul T1 (km 10+000–12+000)'])
    expect(val({ etapa: 'monotub', deLa: 11500, panaLa: 11500 })).toEqual(['Sfârșitul trebuie să fie după început'])
    expect(val({ etapa: 'monotub', deLa: NaN, panaLa: 11500 })[0]).toMatch(/^Km: scrie/)
    expect(val({ etapa: 'monotub', deLa: null, panaLa: null })).toEqual(['Scrie km de început și de sfârșit'])
    expect(valideazaRaport({ tronson: T3, etapa: 'monotub', deLa: 0, panaLa: 10, data: AZI, azi: AZI, intervale })[0]).toMatch(/nu are km de început și de sfârșit/)
  })
  it('suprapunerea cu aceeași etapă: porțiunea comună și ziua', () => {
    // m1 = 10+000–10+500 pe 10.11; noul 10+400–10+600 -> comun 10+400–10+500
    expect(val({ etapa: 'monotub', deLa: 10400, panaLa: 10600 })).toEqual(['Porțiunea km 10+400–10+500 e deja raportată pe 10.11 (monotub montat)'])
  })
  it('acoperirea de către etapa anterioară și data ei', () => {
    // monotub acoperă 10+000–11+000; 10+800–11+200 -> lipsește 11+000–11+200
    expect(val({ etapa: 'validat', deLa: 10800, panaLa: 11200 })).toEqual(['Porțiunea km 11+000–11+200 nu are „monotub montat” raportat („validat” se raportează doar peste „monotub montat”)'])
    // 10+000–10+200 are monotub doar din 10.11 -> validat pe 09.11 refuzat
    expect(val({ etapa: 'validat', deLa: 10000, panaLa: 10200, data: '2026-11-09' })).toEqual(['Pe km 10+000–10+200 „monotub montat” e raportat abia pe 10.11, după data aleasă'])
    // suflat doar peste validat (10+200–10+800)
    expect(val({ etapa: 'suflat', deLa: 10200, panaLa: 10800 })).toEqual([])
    expect(val({ etapa: 'suflat', deLa: 10100, panaLa: 10300 })[0]).toMatch(/^Porțiunea km 10\+100–10\+200 nu are „validat”/)
  })
  it('data: nu în viitor; 7 zile (owner: 365)', () => {
    expect(val({ etapa: 'monotub', deLa: 11000, panaLa: 11100, data: '2026-11-11' })).toEqual(['Data e în viitor'])
    expect(val({ etapa: 'monotub', deLa: 11000, panaLa: 11100, data: '2026-11-03' })).toEqual([])
    expect(val({ etapa: 'monotub', deLa: 11000, panaLa: 11100, data: '2026-11-02' })).toEqual(['Data poate fi cel mult 7 zile în urmă'])
    expect(val({ etapa: 'monotub', deLa: 11000, panaLa: 11100, data: '2026-06-01', owner: true })).toEqual([])
    expect(val({ etapa: 'monotub', deLa: 11000, panaLa: 11100, data: '2025-11-09', owner: true })).toEqual(['Data poate fi cel mult 365 de zile în urmă'])
  })
})

describe('anularea', () => {
  const m1 = I(T1, 'monotub', 10000, 10500, AZI)
  const v1 = I(T1, 'validat', 10200, 10400, AZI)
  const s1 = I(T1, 'suflat', 10200, 10300, AZI, { stare: 'anulat' })
  it('dependența etapei următoare active (cea anulată nu contează)', () => {
    expect(blocajAnulare(m1, [m1, v1, s1])).toBe('Pe km 10+200–10+400 există „validat” raportat pe 10.11: anulează întâi acea raportare')
    expect(blocajAnulare(v1, [m1, v1, s1])).toBe(null)
    expect(blocajAnulare(s1, [m1, v1, s1])).toBe('Raportarea e deja anulată')
  })
  it('cine poate: autorul sau owner-ul', () => {
    expect(poateAnula(m1, 'u1', false)).toBe(true)
    expect(poateAnula(m1, 'u2', false)).toBe(false)
    expect(poateAnula(m1, 'u2', true)).toBe(true)
    expect(poateAnula(s1, 'u1', true)).toBe(false)
    expect(poateAnula(m1, null, false)).toBe(false)
  })
  it('cameretele: montarea o anulează autorul / owner-ul; scoate cine a adăugat-o de pe șantier / owner-ul', () => {
    const mont = { stare: 'montata', montat_de: 'u1' }
    expect(poateAnulaMontarea(mont, 'u1', false)).toBe(true)
    expect(poateAnulaMontarea(mont, 'u2', false)).toBe(false)
    expect(poateAnulaMontarea(mont, 'u2', true)).toBe(true)
    const proiect = { stare: 'de_montat', sursa: 'proiect', creat_de: null }
    const santier = { stare: 'de_montat', sursa: 'santier', creat_de: 'u1' }
    expect(poateScoateCamereta(proiect, 'u1', false)).toBe(false)
    expect(poateScoateCamereta(proiect, 'u1', true)).toBe(true)
    expect(poateScoateCamereta(santier, 'u1', false)).toBe(true)
    expect(poateScoateCamereta(santier, 'u2', false)).toBe(false)
    expect(poateScoateCamereta({ ...santier, stare: 'montata' }, 'u1', true)).toBe(false)
  })
})

describe('rezumatul azi / cumulat / rest', () => {
  // T1 = 2000 m: monotub 10+000–10+500 (azi) + 10+500–11+000 (ieri) = 1000 m, azi 500; validat 10+200–10+800 (azi) = 600 m;
  // suflat 0. Un interval anulat nu contează. T2 = 3000 m: monotub 12+000–13+500 (ieri) = 1500 m.
  const intervale = [
    I(T1, 'monotub', 10000, 10500, AZI), I(T1, 'monotub', 10500, 11000, '2026-11-09'), I(T1, 'validat', 10200, 10800, AZI),
    I(T1, 'suflat', 10200, 10300, AZI, { stare: 'anulat' }), I(T2, 'monotub', 12000, 13500, '2026-11-09'),
  ]
  const camerete = [
    { id: 1, tronson_id: 1, cod: 'C1', km_m: 10000, stare: 'montata', data_montare: AZI },
    { id: 2, tronson_id: 1, cod: 'C2', km_m: 11000, stare: 'de_montat' },
    { id: 3, tronson_id: 1, cod: 'C3', km_m: 11500, stare: 'anulata' },
    { id: 4, tronson_id: 2, cod: 'C4', km_m: 13000, stare: 'montata', data_montare: '2026-11-08' },
  ]
  it('pe tronson', () => {
    const r = rezumatTronson(T1, intervale, camerete, AZI)
    expect(r.lungime).toBe(2000)
    expect(r.etape.monotub).toEqual({ azi: 500, cumulat: 1000, rest: 1000, pct: 50 })
    expect(r.etape.validat).toEqual({ azi: 600, cumulat: 600, rest: 1400, pct: 30 })
    expect(r.etape.suflat).toEqual({ azi: 0, cumulat: 0, rest: 2000, pct: 0 })
    expect(r.camerete).toEqual({ total: 2, montate: 1, azi: 1 })
  })
  it('tronsonul fără km: necunoscut, nu 0 (L18)', () => {
    const r = rezumatTronson(T3, intervale, camerete, AZI)
    expect(r.areKm).toBe(false)
    expect(r.etape.monotub).toEqual({ azi: null, cumulat: null, rest: null, pct: null })
  })
  it('pe proiect: doar tronsoanele cu km intră în lungime', () => {
    const p = rezumatProiect([T3, T2, T1], intervale, camerete, AZI)
    // lungime 2000 + 3000 = 5000; monotub 1000 + 1500 = 2500 (50%), azi 500
    expect(p.lungime).toBe(5000)
    expect(p.etape.monotub).toEqual({ azi: 500, cumulat: 2500, rest: 2500, pct: 50 })
    expect(p.etape.validat).toEqual({ azi: 600, cumulat: 600, rest: 4400, pct: 12 })
    expect(p.faraKm).toEqual(['T3'])
    expect(p.camerete).toEqual({ total: 3, montate: 2, azi: 1 })
    expect(p.randuri.map(r => r.cod)).toEqual(['T1', 'T2', 'T3'])
  })
  it('CSV: BOM, „;”, un rând pe tronson + TOTAL, procente cu virgulă', () => {
    const p = rezumatProiect([T1, T2, T3], intervale, camerete, AZI)
    const csv = csvRezumat(p, AZI)
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    const linii = csv.slice(1).split('\r\n')
    expect(linii[0]).toBe('Fibră optică — situația la 10.11.2026')
    expect(linii[1].split(';')).toHaveLength(4 + 3 * 4 + 3)
    expect(linii[2]).toBe('T1;10+000;12+000;2000;500;1000;1000;50;600;600;1400;30;0;0;2000;0;1;2;1')
    expect(linii[4].startsWith('T3 (fără km — nu intră în total);;;;')).toBe(true)
    expect(linii[5]).toBe('TOTAL;;;5000;500;2500;2500;50;600;600;4400;12;0;0;5000;0;2;3;1')
  })
  it('banda: segmentele unite pe etapă, cameretele active ca puncte', () => {
    const b = bandaTronson(T1, intervale, camerete)
    expect(b.benzi.monotub).toEqual([{ de_la: 10000, pana_la: 11000, x0: 0, x1: 0.5 }])
    expect(b.benzi.suflat).toEqual([])
    expect(b.puncte.map(p => [p.cod, p.x])).toEqual([['C1', 0], ['C2', 0.5]])
    expect(bandaTronson(T3, intervale, camerete)).toBe(null)
  })
  it('de făcut: monotub pe tot tronsonul minus făcut; validat doar peste monotub', () => {
    expect(deFacut(T1, 'monotub', intervale)).toEqual([{ de_la: 11000, pana_la: 12000 }])
    expect(deFacut(T1, 'validat', intervale)).toEqual([{ de_la: 10000, pana_la: 10200 }, { de_la: 10800, pana_la: 11000 }])
    expect(deFacut(T1, 'suflat', intervale)).toEqual([{ de_la: 10200, pana_la: 10800 }])
  })
})

describe('payload-uri și camerete noi', () => {
  it('raport / anulare / camereta', () => {
    expect(payloadRaport({ proiectId: 9, tronsonId: 1, etapa: 'monotub', deLa: 10000, panaLa: 10100, data: AZI, observatii: '  ' }))
      .toEqual({ p_proiect: 9, p_tronson: 1, p_etapa: 'monotub', p_km_de_la_m: 10000, p_km_pana_la_m: 10100, p_data: AZI, p_observatii: null })
    expect(payloadAnulare({ id: 5 }, ' greșit ')).toEqual({ p_id: 5, p_motiv: 'greșit' })
    expect(payloadCameretaNoua({ proiectId: 9, tronsonId: 1, cod: ' ct-1 ', km: 10100, montata: false, data: AZI }))
      .toEqual({ p_proiect: 9, p_tronson: 1, p_cod: 'CT-1', p_km_m: 10100, p_montata: false, p_data: null, p_observatii: null })
    expect(payloadCameretaStare({ id: 4, versiune: 3 }, { stareNoua: 'montata', data: AZI, motiv: 'x' }))
      .toEqual({ p_id: 4, p_versiune: 3, p_stare_noua: 'montata', p_data: AZI, p_motiv: null })
    expect(payloadCameretaStare({ id: 4, versiune: 3 }, { stareNoua: 'anulata', data: AZI, motiv: ' nu e ' }))
      .toEqual({ p_id: 4, p_versiune: 3, p_stare_noua: 'anulata', p_data: null, p_motiv: 'nu e' })
  })
  it('validarea cameretei noi', () => {
    const camerete = [{ cod: 'CT-1', km_m: 10100, stare: 'de_montat' }, { cod: 'CT-2', km_m: 10200, stare: 'anulata' }]
    const v = o => valideazaCameretaNoua({ tronson: T1, azi: AZI, camerete, montata: false, ...o })
    expect(v({ cod: 'ct-3', km: 12000 })).toEqual([])                 // capătul tronsonului inclus
    expect(v({ cod: 'CT-2', km: 10300 })).toEqual([])                 // codul unei camerete scoase e liber
    expect(v({ cod: 'CT-1', km: 10300 })).toEqual(['Camereta CT-1 există deja pe proiect (km 10+100)'])
    expect(v({ cod: 'CT-3', km: 12001 })).toEqual(['Camereta iese din tronsonul T1 (km 10+000–12+000)'])
    expect(v({ cod: 'C 3', km: 10300 })).toEqual(['Codul: litere mari, cifre și . / _ - (cel mult 30)'])
    expect(v({ cod: 'CT-3', km: 10300, montata: true, data: '2026-11-11' })).toEqual(['Data e în viitor'])
  })
})

describe('registrul L05 (aceleași reguli ca la probe, altă listă de RPC-uri)', () => {
  const stocare = () => {
    const m = new Map()
    const s = { key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
    Object.defineProperty(s, 'length', { get: () => m.size })
    return s
  }
  it('acceptă doar RPC-urile fibrei sub prefixul ei; registrul probelor rămâne neschimbat', () => {
    const st = stocare()
    const reg = registruNou(st, prefixRegistruFibra('u1', 9), RPC_FIBRA)
    const cheie = '11111111-1111-4111-8111-111111111111'
    expect(reg.pune({ tinta: 'raport:1', rpc: 'fn_executie_fibra_raporteaza', cheie, payload: { p_tronson: 1 } })).toBe(true)
    expect(reg.pune({ tinta: 'x', rpc: 'fn_executie_proba_salveaza', cheie: '22222222-2222-4222-8222-222222222222', payload: {} })).toBe(false)
    expect(reg.toate().map(x => x.cheie)).toEqual([cheie])
    const regProbe = registruNou(st, 'gazpet.probe_tronsoane.incert.v2:u1:9:')
    expect(regProbe.pune({ tinta: 'nou', rpc: RPC_PROBE[0], cheie: '33333333-3333-4333-8333-333333333333', payload: {} })).toBe(true)
    expect(regProbe.pune({ tinta: 'nou', rpc: 'fn_executie_fibra_raporteaza', cheie: '44444444-4444-4444-8444-444444444444', payload: {} })).toBe(false)
  })
})

describe('jurnalul', () => {
  it('textele operațiilor', () => {
    expect(textJurnal({ actiune: 'raportare', valori: { etapa: 'validat', km_de_la_m: 10200, km_pana_la_m: 10800, data: AZI } })).toBe('Validat: km 10+200 → 10+800 (600 m), lucrat 10.11.2026')
    expect(textJurnal({ actiune: 'anulare', valori: { etapa: 'monotub', km_de_la_m: 1, km_pana_la_m: 2, motiv: 'km greșiți' } })).toBe('Anulat Monotub km 0+001 → 0+002: km greșiți')
    expect(textJurnal({ actiune: 'camereta_scoasa', valori: { cod: 'C1', motiv: 'nu există' } })).toBe('Cameretă C1 scoasă din listă (nu există)')
  })
})
