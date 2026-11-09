// Teste pentru logica „Probe pe tronsoane” (src/probeTronsoaneLogica.js). Valorile așteptate sunt calculate de mână (L25), pe km-ii
// tronsoanelor Lot 1 din proiect (planșele 1413-01-01 … 01-11: T1 0–2 km, T2 2–5, T3 5–10, T4 10–14, … T11 45–49), nu cu codul testat.
// Tranzițiile, stările, etapele, codul și fereastra de zile au test de paritate cu migrarea SQL 20261202a (L19).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ETAPE, STARI, TRANZITII, tranzitiePermisa, stariUrmatoare, cereMotiv, ZILE_INAPOI, parseKm, fmtKm, fmtLungime, tronsoaneCuKm,
  uneste, goluri, compozitie, acoperire, stareProba, presiuneCurenta, valoriDinFormular, formularDinEtapa, valideazaEtapa, payloadEtapa,
  valideazaProba, suprapuneri, payloadProba, codUrmator, decideReincercare, esteRefuzDeterminist, aplicaRand, imbinaLista,
  ordoneazaProbe, textJurnal, scadeZile, RE_COD, culoareStare, CULOARE_NECUNOSCUTA, etichetaActiune,
} from './probeTronsoaneLogica.js'

const AZI = '2026-11-09'
const SQL = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261202a_executie_probe_tronsoane.sql', import.meta.url)), 'utf8')
// Lot 1, km din proiect (raportul lot1/16_tronsoane_km.md), în ordinea inversă intenționat (funcțiile sortează)
const LOT1 = [
  ['T11', 45000, 49000], ['T10', 40000, 45000], ['T9', 35000, 40000], ['T8', 29000, 35000], ['T7', 24000, 29000], ['T6', 19000, 24000],
  ['T5', 14000, 19000], ['T4', 10000, 14000], ['T3', 5000, 10000], ['T2', 2000, 5000], ['T1', 0, 2000],
].map(([cod, a, b], i) => ({ id: 100 + i, cod, km_start_m: a, km_end_m: b }))

describe('paritate cu migrarea SQL', () => {
  it('tranzițiile = blocul TRANZITII din fn_executie_proba_tranzitie', () => {
    const bloc = SQL.slice(SQL.indexOf('-- TRANZITII-START'), SQL.indexOf('-- TRANZITII-END'))
    expect(bloc.length).toBeGreaterThan(20)
    const dinSql = [...bloc.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)].map(m => `${m[1]}>${m[2]}`).sort()
    expect(dinSql).toEqual(TRANZITII.map(([v, n]) => `${v}>${n}`).sort())
    expect(dinSql).toEqual([
      'facut>facut', 'facut>refacere', 'in_curs>facut', 'in_curs>in_curs', 'in_curs>refacere', 'nu_se_aplica>urmeaza',
      'refacere>facut', 'refacere>in_curs', 'urmeaza>facut', 'urmeaza>in_curs', 'urmeaza>nu_se_aplica', 'urmeaza>refacere',
    ])
  })
  it('stările și etapele = lista albă din CHECK-urile tabelului', () => {
    const st = SQL.match(/stare text NOT NULL DEFAULT 'urmeaza' CHECK \(stare IN \(([^)]*)\)\)/)
    const et = SQL.match(/etapa text NOT NULL CHECK \(etapa IN \(([^)]*)\)\)/)
    expect(st[1].split(',').map(x => x.trim().replace(/'/g, ''))).toEqual(STARI)
    expect(et[1].split(',').map(x => x.trim().replace(/'/g, ''))).toEqual(ETAPE)
    // RPC-ul creează etapele în aceeași ordine
    expect(SQL).toContain("unnest(ARRAY['pistonare', 'uscare', 'calibrare', 'presiune'])")
  })
  it('codul, fereastra de zile și codurile de refuz', () => {
    expect(SQL).toContain(`cod text NOT NULL CHECK (cod ~ '${RE_COD.source}')`)
    expect(SQL).toContain(`IF v_cod !~ '${RE_COD.source}'`)
    expect(ZILE_INAPOI).toBe(730)
    expect(SQL).toContain('p_data < v_azi - 730')
    // fiecare refuz al RPC-urilor folosește un cod din lista deterministă a clientului
    const coduri = new Set([...SQL.matchAll(/USING ERRCODE = '([0-9A-Z]{5})'/g)].map(m => m[1]))
    for (const c of coduri) expect(esteRefuzDeterminist({ code: c })).toBe(true)
  })
})

describe('tranziții', () => {
  it('pașii permiși din fiecare stare', () => {
    expect(stariUrmatoare('urmeaza')).toEqual(['in_curs', 'facut', 'refacere', 'nu_se_aplica'])
    expect(stariUrmatoare('facut')).toEqual(['facut', 'refacere'])
    expect(tranzitiePermisa('facut', 'urmeaza')).toBe(false)
    expect(tranzitiePermisa('nu_se_aplica', 'facut')).toBe(false)
    expect(tranzitiePermisa(undefined, 'facut')).toBe(false)
  })
  it('motivul e cerut la „de refăcut”, „nu se aplică”, corectură și revenirea din „nu se aplică”', () => {
    expect([cereMotiv('in_curs', 'refacere'), cereMotiv('urmeaza', 'nu_se_aplica'), cereMotiv('facut', 'facut'), cereMotiv('nu_se_aplica', 'urmeaza')]).toEqual([true, true, true, true])
    expect([cereMotiv('urmeaza', 'in_curs'), cereMotiv('refacere', 'in_curs'), cereMotiv('in_curs', 'facut')]).toEqual([false, false, false])
  })
  it('etichetele acțiunii și culoarea unei stări necunoscute', () => {
    expect(etichetaActiune('in_curs', 'in_curs')).toBe('Actualizare (rămâne în curs)')
    expect(etichetaActiune('facut', 'facut')).toBe('Corectură (rămâne făcut)')
    expect(etichetaActiune('urmeaza', 'facut')).toBe('Făcut')
    expect(culoareStare('ciudat')).toBe(CULOARE_NECUNOSCUTA)
  })
})

describe('km', () => {
  it('parseKm: „km+metri” sau metri întregi; restul = NaN (nu rotunjire)', () => {
    expect(parseKm('10+400')).toBe(10400)
    expect(parseKm(' 0+000 ')).toBe(0)
    expect(parseKm('2+137')).toBe(2137)
    expect(parseKm('49+000')).toBe(49000)
    expect(parseKm('10400')).toBe(10400)
    expect(parseKm(10400)).toBe(10400)
    expect(parseKm('')).toBe(null)
    expect(parseKm(null)).toBe(null)
    for (const rau of ['10+40', '10+4000', '10+400,5', '10.400', '10,4', '-5', '1+2+3', 'abc', '10+', '+400']) expect(parseKm(rau)).toBeNaN()
    expect(parseKm(10.5)).toBeNaN()
  })
  it('fmtKm / fmtLungime', () => {
    expect(fmtKm(10400)).toBe('10+400')
    expect(fmtKm(0)).toBe('0+000')
    expect(fmtLungime(400)).toBe('400 m')
    expect(fmtLungime(12400)).toBe('12,4 km')
    expect(fmtLungime(15000)).toBe('15 km')
  })
  it('uneste / goluri', () => {
    expect(uneste([{ de_la: 5, pana_la: 8 }, { de_la: 0, pana_la: 3 }, { de_la: 3, pana_la: 4 }, { de_la: 7, pana_la: 9 }]))
      .toEqual([{ de_la: 0, pana_la: 4 }, { de_la: 5, pana_la: 9 }])
    expect(goluri(0, 10, [{ de_la: 2, pana_la: 4 }, { de_la: 6, pana_la: 12 }])).toEqual([{ de_la: 0, pana_la: 2 }, { de_la: 4, pana_la: 6 }])
    expect(goluri(0, 10, [])).toEqual([{ de_la: 0, pana_la: 10 }])
    expect(goluri(0, 10, [{ de_la: -5, pana_la: 20 }])).toEqual([])
  })
})

describe('compunerea din tronsoanele de execuție (Lot 1)', () => {
  it('P1 = T1 + T2 + T3 + 400 m din T4 (exemplul lui Răzvan)', () => {
    const c = compozitie(0, 10400, LOT1)
    expect(c.text).toBe('T1 + T2 + T3 + 400 m din T4')
    expect(c.bucati.map(b => [b.cod, b.de_la, b.pana_la, b.lungime, b.integral])).toEqual([
      ['T1', 0, 2000, 2000, true], ['T2', 2000, 5000, 3000, true], ['T3', 5000, 10000, 5000, true], ['T4', 10000, 10400, 400, false],
    ])
    expect(c.neacoperit).toEqual([])
  })
  it('tronsoane secționate la ambele capete și o porțiune de pe un singur tronson', () => {
    expect(compozitie(1500, 5000, LOT1).text).toBe('500 m din T1 + T2')
    expect(compozitie(10050, 10750, LOT1).text).toBe('700 m din T4')   // porțiunea cu apă din DS4 pe T4
    expect(compozitie(14000, 29000, LOT1).text).toBe('T5 + T6 + T7')
  })
  it('porțiunea din afara tronsoanelor se raportează, nu dispare', () => {
    const c = compozitie(48500, 49500, LOT1)
    expect(c.text).toBe('500 m din T11')
    expect(c.neacoperit).toEqual([{ de_la: 49000, pana_la: 49500 }])
  })
  it('tronsoanele fără km nu intră în calcul și sunt numite', () => {
    const t = [...LOT1, { id: 1, cod: 'T12', km_start_m: null, km_end_m: 50000 }, { id: 2, cod: 'TX', km_start_m: 5, km_end_m: 5 }]
    expect(tronsoaneCuKm(t).faraKm).toEqual(['T12', 'TX'])
    expect(compozitie(0, 2000, t).faraKm).toEqual(['T12', 'TX'])
  })
  it('interval invalid = nimic calculat', () => {
    expect(compozitie(5, 5, LOT1).bucati).toEqual([])
    expect(compozitie(NaN, 5, LOT1).text).toBe('')
  })
})

describe('acoperirea traseului (banda)', () => {
  const P = (id, a, b, stare = 'activ') => ({ id, cod: 'P' + id, km_de_la_m: a, km_pana_la_m: b, stare })
  it('acoperit / neacoperit pe 49 km; anulatele nu contează', () => {
    const ac = acoperire([P(1, 0, 10400), P(2, 10400, 14000), P(3, 20000, 24000, 'anulat')], LOT1)
    expect([ac.de_la, ac.pana_la, ac.total, ac.acoperit]).toEqual([0, 49000, 49000, 14000])
    expect(ac.neacoperit).toEqual([{ de_la: 14000, pana_la: 49000 }])
    expect(ac.inAfara).toEqual([])
  })
  it('o probă care iese din traseu: partea din afară e raportată și lărgește banda', () => {
    const ac = acoperire([P(1, 0, 10400), P(4, 48000, 49500)], LOT1)
    expect([ac.de_la, ac.pana_la, ac.acoperit]).toEqual([0, 49500, 11400])
    expect(ac.neacoperit).toEqual([{ de_la: 10400, pana_la: 48000 }])
    expect(ac.inAfara).toEqual([{ de_la: 49000, pana_la: 49500 }])
  })
  it('fără tronsoane cu km: banda = probele, dar totalul e NECUNOSCUT (nu 100%)', () => {
    const ac = acoperire([P(1, 100, 300), P(2, 500, 600)], [])
    expect([ac.de_la, ac.pana_la, ac.total, ac.acoperit, ac.traseuCunoscut]).toEqual([100, 600, null, 300, false])
    expect(ac.neacoperit).toEqual([])
    expect(acoperire([], []).total).toBe(null)
    expect(acoperire([P(1, 0, 10400)], LOT1).traseuCunoscut).toBe(true)
  })
})

describe('starea probei și presiunea curentă', () => {
  const E = (...s) => ETAPE.map((etapa, i) => ({ etapa, stare: s[i] }))
  it('stareProba', () => {
    expect(stareProba(E('urmeaza', 'urmeaza', 'urmeaza', 'urmeaza'))).toBe('neinceput')
    expect(stareProba(E('in_curs', 'urmeaza', 'urmeaza', 'urmeaza'))).toBe('in_lucru')
    expect(stareProba(E('facut', 'urmeaza', 'urmeaza', 'urmeaza'))).toBe('in_lucru')
    expect(stareProba(E('facut', 'nu_se_aplica', 'facut', 'facut'))).toBe('gata')
    expect(stareProba(E('facut', 'facut', 'refacere', 'urmeaza'))).toBe('refacere')
    expect(stareProba(E('nu_se_aplica', 'nu_se_aplica', 'nu_se_aplica', 'nu_se_aplica'))).toBe('neinceput')
    expect(stareProba(E('facut', 'facut', 'facut'))).toBe('necunoscut')                     // lipsește o etapă
    expect(stareProba(E('facut', 'facut', 'facut', 'ciudat'))).toBe('necunoscut')
  })
  it('presiuneCurenta: doar cu o citire', () => {
    expect(presiuneCurenta([{ etapa: 'presiune', presiune_curenta_bar: null }])).toBe(null)
    expect(presiuneCurenta([{ etapa: 'presiune', stare: 'in_curs', presiune_curenta_bar: '48.40', presiune_proba_bar: '48.50', presiune_curenta_la: '2026-11-09T12:20:00Z' }]))
      .toEqual({ bar: 48.4, proba: 48.5, la: '2026-11-09T12:20:00Z', stare: 'in_curs' })
  })
})

describe('formularul etapei', () => {
  const v0 = { nr: null, roua: null, placa: null, fluid: null, pproba: null, pcur: null, durata: null, calc: null, rez: null, obs: null, motiv: null }
  const val = (o) => valideazaEtapa({ azi: AZI, data: AZI, dataStart: null, ...o, v: { ...v0, ...o.v } })
  it('valoriDinFormular: numere RO, doar câmpurile etapei', () => {
    const v = valoriDinFormular('presiune', { pproba: '48,5', pcur: '48,4', durata: '24', fluid: 'aer', calc: '12', nr: '3', obs: ' x ' })
    expect(v).toEqual({ ...v0, pproba: 48.5, pcur: 48.4, durata: 24, fluid: 'aer', calc: 12, obs: 'x' })
    expect(valoriDinFormular('pistonare', { nr: 'doi' }).nr).toBeNaN()
    expect(formularDinEtapa({ presiune_proba_bar: 48.5, nr_treceri: null, probe_calc_id: 7 }).pproba).toBe('48,5')
    expect(formularDinEtapa({ probe_calc_id: 7 }).calc).toBe('7')
  })
  it('căile bune trec', () => {
    expect(val({ etapa: 'pistonare', stareVeche: 'urmeaza', stareNoua: 'in_curs', v: { nr: 2 } })).toEqual([])
    expect(val({ etapa: 'calibrare', stareVeche: 'refacere', stareNoua: 'in_curs', v: {} })).toEqual([])
    expect(val({ etapa: 'presiune', stareVeche: 'in_curs', stareNoua: 'facut', v: { pproba: 48.5, durata: 24, pcur: 48.3 } })).toEqual([])
    expect(val({ etapa: 'uscare', stareVeche: 'urmeaza', stareNoua: 'nu_se_aplica', v: { motiv: 'probă cu aer' } })).toEqual([])
    expect(val({ etapa: 'pistonare', stareVeche: 'urmeaza', stareNoua: 'in_curs', data: '2024-11-09', v: { nr: 1 } })).toEqual([])   // exact 730 de zile
  })
  it('regulile (aceleași ca serverul)', () => {
    expect(val({ etapa: 'pistonare', stareVeche: 'in_curs', stareNoua: 'facut', v: {} })).toContain('Scrie numărul de treceri')
    expect(val({ etapa: 'pistonare', stareVeche: 'facut', stareNoua: 'facut', v: { nr: 5 } })).toContain('Scrie motivul')
    expect(val({ etapa: 'pistonare', stareVeche: 'urmeaza', stareNoua: 'in_curs', data: '2026-11-10', v: { nr: 1 } })).toContain('Data e în viitor')
    expect(val({ etapa: 'pistonare', stareVeche: 'urmeaza', stareNoua: 'in_curs', data: '2024-11-08', v: { nr: 1 } })).toContain('Data poate fi cel mult 2 ani în urmă')
    expect(val({ etapa: 'pistonare', stareVeche: 'in_curs', stareNoua: 'facut', data: '2026-11-01', dataStart: '2026-11-02', v: { nr: 1 } })[0]).toMatch(/^Data de final e înaintea/)
    expect(val({ etapa: 'calibrare', stareVeche: 'in_curs', stareNoua: 'facut', v: { placa: 'deformata' } })).toContain('Calibrarea e făcută doar cu placa OK (deformată = de refăcut)')
    expect(val({ etapa: 'presiune', stareVeche: 'urmeaza', stareNoua: 'in_curs', v: {} })).toContain('Scrie presiunea de probă')
    expect(val({ etapa: 'presiune', stareVeche: 'urmeaza', stareNoua: 'in_curs', v: { pproba: 48.555 } })).toContain('Presiunea de probă: cel mult 2 zecimale')
    expect(val({ etapa: 'presiune', stareVeche: 'urmeaza', stareNoua: 'in_curs', v: { pproba: 0 } })).toContain('Presiunea de probă: în afara domeniului')
    expect(val({ etapa: 'presiune', stareVeche: 'in_curs', stareNoua: 'facut', v: { pproba: 48.5 } })).toContain('Scrie durata probei')
    expect(val({ etapa: 'presiune', stareVeche: 'in_curs', stareNoua: 'facut', v: { pproba: 48.5, durata: 1.25 } })).toContain('Durata: cel mult 1 zecimală')
    expect(val({ etapa: 'uscare', stareVeche: 'urmeaza', stareNoua: 'nu_se_aplica', v: { roua: -20 } })).toEqual(['Scrie motivul', 'O etapă care urmează / nu se aplică nu are valori'])
    expect(val({ etapa: 'pistonare', stareVeche: 'facut', stareNoua: 'urmeaza', v: { motiv: 'x' } })[0]).toMatch(/^Pas nepermis/)
    expect(val({ etapa: 'pistonare', stareVeche: 'urmeaza', stareNoua: 'in_curs', v: { nr: NaN } })).toContain('Numărul de treceri: întreg între 1 și 500')
  })
  it('payloadEtapa: doar câmpurile etapei; o etapă fără valori trimite NULL (și fără rezultat)', () => {
    const et = { id: 7, etapa: 'pistonare', stare: 'urmeaza', versiune: 3 }
    const v = { ...v0, nr: 2, roua: 5, pproba: 3, rez: 'ok', obs: 'o' }
    expect(payloadEtapa(et, { stareNoua: 'in_curs', data: AZI, v })).toEqual({
      p_etapa_id: 7, p_stare_veche: 'urmeaza', p_versiune: 3, p_stare_noua: 'in_curs', p_data: AZI, p_nr_treceri: 2, p_punct_roua_c: null,
      p_placa: null, p_fluid: null, p_presiune_proba_bar: null, p_presiune_curenta_bar: null, p_durata_ore: null, p_probe_calc_id: null,
      p_rezultat: 'ok', p_observatii: 'o', p_motiv: null,
    })
    const p2 = payloadEtapa(et, { stareNoua: 'nu_se_aplica', data: AZI, v: { ...v, motiv: 'm' } })
    expect([p2.p_nr_treceri, p2.p_rezultat, p2.p_observatii, p2.p_motiv]).toEqual([null, null, 'o', 'm'])
    expect(Object.isFrozen(p2)).toBe(true)
  })
})

describe('formularul tronsonului de probă', () => {
  const P = (id, a, b, stare = 'activ', cod = 'P' + id) => ({ id, cod, km_de_la_m: a, km_pana_la_m: b, stare, versiune: 2 })
  it('valideazaProba', () => {
    expect(valideazaProba({ cod: 'p1', deLa: 0, panaLa: 10400 })).toEqual([])
    expect(valideazaProba({ cod: 'X1', deLa: 0, panaLa: 10 })).toEqual(['Codul: P1, P2, P12A…'])
    expect(valideazaProba({ cod: 'P1', deLa: 10, panaLa: 10 })).toEqual(['Sfârșitul trebuie să fie după început'])
    expect(valideazaProba({ cod: 'P1', deLa: NaN, panaLa: 10 })).toEqual(['Km: scrie „10+400” sau metri întregi („10400”)'])
    expect(valideazaProba({ cod: 'P1', deLa: null, panaLa: 10 })).toEqual(['Scrie km de început și de sfârșit'])
  })
  it('suprapuneri: capetele se pot atinge; anulatele și rândul propriu nu contează', () => {
    const probe = [P(1, 10400, 14000), P(2, 0, 10000), P(3, 11000, 11500, 'anulat')]
    expect(suprapuneri(10000, 12000, probe).map(p => p.id)).toEqual([1])
    expect(suprapuneri(10000, 12000, probe, 1)).toEqual([])
    expect(suprapuneri(10000, 10400, probe)).toEqual([])
  })
  it('payloadProba și codul următor', () => {
    expect(payloadProba({ proiectId: 1, proba: null, cod: ' p3 ', deLa: 0, panaLa: 5, denumire: ' ', observatii: 'x' })).toEqual({
      p_proiect: 1, p_id: null, p_versiune: null, p_cod: 'P3', p_km_de_la_m: 0, p_km_pana_la_m: 5, p_denumire: null, p_observatii: 'x',
    })
    expect(payloadProba({ proiectId: 1, proba: P(9, 0, 5), cod: 'P9', deLa: 0, panaLa: 6 }).p_versiune).toBe(2)
    expect(codUrmator([P(1, 0, 1), P(3, 1, 2), P(7, 2, 3, 'anulat')])).toBe('P4')
    expect(codUrmator([])).toBe('P1')
  })
  it('ordinea listei: activele după km, apoi anulatele', () => {
    expect(ordoneazaProbe([P(1, 500, 600, 'anulat'), P(2, 300, 400), P(3, 0, 100)]).map(p => p.id)).toEqual([3, 2, 1])
  })
})

describe('reluări și liste (L05)', () => {
  it('decideReincercare', () => {
    const payload = { p_id: 1, a: 1 }
    expect(decideReincercare(null, 'etapa:1', payload)).toBe('noua')
    expect(decideReincercare({ tinta: 'etapa:2', payload }, 'etapa:1', payload)).toBe('noua')
    expect(decideReincercare({ tinta: 'etapa:1', payload: { p_id: 1, a: 1 } }, 'etapa:1', payload)).toBe('aceeasi')
    expect(decideReincercare({ tinta: 'etapa:1', payload: { p_id: 1, a: 2 } }, 'etapa:1', payload)).toBe('reconciliere')
  })
  it('esteRefuzDeterminist: codurile serverului da, rețeaua / timeout-ul nu', () => {
    expect(esteRefuzDeterminist({ code: '22023' })).toBe(true)
    expect(esteRefuzDeterminist({ code: 'PGRST202' })).toBe(true)
    expect(esteRefuzDeterminist({ message: 'TypeError: Failed to fetch' })).toBe(false)
    expect(esteRefuzDeterminist({ code: '57014' })).toBe(false)
    expect(esteRefuzDeterminist({ code: '' })).toBe(false)
    expect(esteRefuzDeterminist(null)).toBe(false)
  })
  it('aplicaRand / imbinaLista: versiunea mai nouă câștigă', () => {
    const l = [{ id: 1, versiune: 3, x: 'a' }]
    expect(aplicaRand(l, { id: 1, versiune: 2, x: 'vechi' })).toEqual(l)
    expect(aplicaRand(l, { id: 1, versiune: 4, x: 'nou' })[0].x).toBe('nou')
    expect(aplicaRand(l, { id: 2, versiune: 1 }).map(r => r.id)).toEqual([1, 2])
    expect(imbinaLista([{ id: 1, versiune: 2, x: 'citit' }], l)[0].x).toBe('a')
  })
})

describe('jurnalul', () => {
  it('textJurnal pe fiecare acțiune', () => {
    expect(textJurnal({ actiune: 'creare', valori: { cod: 'P1', km_de_la_m: 0, km_pana_la_m: 10400 } })).toBe('Creat P1: km 0+000 → 10+400')
    expect(textJurnal({ actiune: 'anulare', valori: { motiv: 'greșit' } })).toBe('Anulat: greșit')
    expect(textJurnal({ actiune: 'modificare', valori: { inainte: { cod: 'P1', km_de_la_m: 0, km_pana_la_m: 10000 }, dupa: { cod: 'P1', km_de_la_m: 0, km_pana_la_m: 10400 } } }))
      .toBe('Modificat P1 km 0+000 → 10+000 → P1 km 0+000 → 10+400')
    expect(textJurnal({ actiune: 'etapa', stare_veche: 'in_curs', stare_noua: 'in_curs', valori: { etapa: 'presiune', presiune_proba_bar: 48.5, presiune_curenta_bar: 48.4, fluid: 'aer' } }))
      .toBe('Probă de presiune: Actualizare (rămâne în curs) · Aer · probă 48,5 bar · acum 48,4 bar')
    expect(textJurnal({ actiune: 'etapa', stare_veche: 'urmeaza', stare_noua: 'refacere', valori: { etapa: 'calibrare', placa: 'deformata', motiv: 'îndoită' } }))
      .toBe('Calibrare: De refăcut · Placa deformată · motiv: îndoită')
  })
  it('scadeZile pe date calendaristice', () => {
    expect(scadeZile('2026-11-09', 730)).toBe('2024-11-09')
    expect(scadeZile('2026-03-30', 1)).toBe('2026-03-29')
  })
})
