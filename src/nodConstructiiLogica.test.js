// Teste pentru logica pură a elementelor de construcții ale nodului (20261207a). Valorile așteptate sunt scrise de mână (L25);
// paritatea cu SQL-ul citește migrarea (vocabularul etapelor, tipurile, UM, formele codurilor).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ETAPE, ETICHETE_ETAPE, TIPURI, UM, RE_COD_CONSTR, RE_PLANSA, RE_GRUP, progres, contorConstructii, filtreaza, grupeazaPeTip, valideazaEtapa,
  payloadEtapa, mapeazaElemente, etapeDinText, dataValida, GRUP_PRIORITAR, etichetaGrup,
} from './nodConstructiiLogica.js'
import { obiecteCsv, decideReincercare } from './nodCuplareLogica.js'

const SQL = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261207a_executie_noduri_constructii.sql', import.meta.url)), 'utf8')
const F8 = ['sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj']
const EL = (id, cod, extra = {}) => ({
  id, proiect_id: 1, nod_cod: 'NOD-A', cod, cod_detaliu: 'X-1', plansa_sursa: 'X-0', denumire: 'Test ' + cod, tip: 'fundatie', grup: 'rezervoare',
  echipament: null, cantitate: 1, um: 'buc', pozitie: null, certitudine: 'de_confirmat', observatii: null, etape: F8, etape_data: [], etape_de: [], etape_la: [],
  stare: 'activ', motiv: null, ultima_retragere: null, versiune: 1, ...extra,
})

describe('paritate cu migrarea 20261207a', () => {
  it('vocabularul etapelor (blocul ETAPE-START / ETAPE-END) = ETAPE, în aceeași ordine', () => {
    const bloc = SQL.slice(SQL.indexOf('-- ETAPE-START'), SQL.indexOf('-- ETAPE-END'))
    expect(bloc.length).toBeGreaterThan(20)
    expect([...bloc.matchAll(/'([a-z_]+)'/g)].map(m => m[1])).toEqual(ETAPE)
    expect(ETAPE).toEqual(['trasare', 'sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'strat_suport', 'finisaj', 'confectionare', 'montaj'])
    expect(Object.keys(ETICHETE_ETAPE).sort()).toEqual([...ETAPE].sort())
  })
  it('tipurile și UM din CHECK = TIPURI / UM', () => {
    const t = SQL.match(/tip text NOT NULL CHECK \(tip IN \(([^)]*)\)\)/)
    const u = SQL.match(/um text NOT NULL DEFAULT 'buc' CHECK \(um IN \(([^)]*)\)\)/)
    const lista = m => m[1].split(',').map(x => x.trim().replace(/'/g, ''))
    expect(lista(t)).toEqual(TIPURI)
    expect(lista(u)).toEqual(UM)
  })
  it('formele codurilor din CHECK = expresiile din JS', () => {
    expect(SQL).toContain(`cod ~ '${RE_COD_CONSTR.source}'`)
    expect(SQL).toContain(`cod_detaliu ~ '${RE_PLANSA.source}'`)
    expect(SQL).toContain(`plansa_sursa ~ '${RE_PLANSA.source}'`)
    expect(SQL).toContain(`grup ~ '${RE_GRUP.source}'`)
  })
})

describe('progres / contor', () => {
  it('progresul: următoarea, ultima, procentul; forma invalidă nu devine 0', () => {
    expect(progres(EL(1, 'F6-1'))).toMatchObject({ valid: true, total: 8, facute: 0, pct: 0, gata: false, urmatoare: 'sapatura', ultima: null })
    expect(progres(EL(1, 'F6-1', { etape_data: ['2026-11-01', '2026-11-02'] }))).toMatchObject({ facute: 2, pct: 25, urmatoare: 'armare_cofrare', ultima: 'egalizare', ultimaData: '2026-11-02' })
    expect(progres(EL(1, 'F6-1', { etape: ['montaj'], etape_data: ['2026-11-01'] }))).toMatchObject({ gata: true, pct: 100, urmatoare: null })
    expect(progres(EL(1, 'X-1', { etape: null }))).toMatchObject({ valid: false, pct: null })
    expect(progres(EL(1, 'X-1', { etape: ['montaj'], etape_data: ['2026-11-01', '2026-11-02'] }))).toMatchObject({ valid: false, pct: null })
  })
  it('contorul: doar active; procent pe etape; azi; pe tip și pe grup în ordinea de afișare; invalidele numărate separat', () => {
    const el = [
      EL(1, 'F6-1', { etape_data: ['2026-11-09', '2026-11-10'] }),
      EL(2, 'F6-2', { etape: ['sapatura', 'turnare'], etape_data: ['2026-11-10', '2026-11-10'] }),
      EL(3, 'SPC-1', { grup: 'spc', etape: ['sapatura', 'turnare'] }),
      EL(4, 'IPB-1', { tip: 'imprejmuire', grup: 'imprejmuire', etape: ['trasare', 'montaj'], stare: 'anulat', motiv: 'x' }),
      EL(5, 'Y-1', { tip: 'suport', grup: 'altul', etape: [] }),
    ]
    const c = contorConstructii(el, '2026-11-10')
    // etape: 2/8 + 2/2 + 0/2 = 4/12 -> 33%; Y-1 invalid (fără etape)
    expect(c).toMatchObject({ n: 4, gata: 1, inLucru: 1, neincepute: 1, invalide: 1, facute: 4, total: 12, pct: 33, azi: 3, anulate: 1 })
    expect(c.peTip.map(t => [t.cheie, t.n, t.pct])).toEqual([['fundatie', 3, 33], ['suport', 1, null]])
    expect(c.peGrup.map(g => [g.cheie, g.n, g.pct])).toEqual([['rezervoare', 2, 40], ['spc', 1, 0], ['altul', 1, null]])
    expect(c.peGrup[0].cheie).toBe(GRUP_PRIORITAR)
    expect(etichetaGrup('rezervoare')).toContain('rezervoare')
    expect(etichetaGrup('altul')).toBe('altul')
  })
  it('filtrul și gruparea: anulatele ascunse implicit, doar nefinalizate, ordinea pe tip și cod natural', () => {
    const el = [EL(1, 'F6-10'), EL(2, 'F6-2'), EL(3, 'IPB-1', { tip: 'imprejmuire', grup: 'imprejmuire' }), EL(4, 'F6-3', { stare: 'anulat', motiv: 'x' }),
      EL(5, 'F6-4', { etape: ['montaj'], etape_data: ['2026-11-01'] }), EL(6, 'CAM-1', { tip: 'camin' })]
    expect(filtreaza(el).map(e => e.cod)).toEqual(['F6-10', 'F6-2', 'IPB-1', 'F6-4', 'CAM-1'])
    expect(filtreaza(el, { grup: 'imprejmuire' }).map(e => e.cod)).toEqual(['IPB-1'])
    expect(filtreaza(el, { doarNeterminate: true }).map(e => e.cod)).toEqual(['F6-10', 'F6-2', 'IPB-1', 'CAM-1'])
    expect(filtreaza(el, { cuAnulate: true })).toHaveLength(6)
    const g = grupeazaPeTip(filtreaza(el))
    expect(g.map(x => x.tip)).toEqual(['fundatie', 'camin', 'imprejmuire'])
    expect(g[0].elemente.map(e => e.cod)).toEqual(['F6-2', 'F6-4', 'F6-10'])
    expect(g[0]).toMatchObject({ n: 3, gata: 1, pct: 6 })   // 1 / (8 + 8 + 1) = 5,9% -> 6
  })
})

describe('bifarea / retragerea', () => {
  const azi = '2026-11-10'
  it('bifarea: data în fereastra de 7 zile, nu înaintea etapei anterioare, fără motiv; nimic după gata', () => {
    const el = EL(1, 'F6-1', { etape_data: ['2026-11-08'] })
    expect(valideazaEtapa({ actiune: 'bifeaza', element: el, data: '2026-11-10', azi })).toEqual([])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: EL(1, 'F6-1'), data: '2026-11-03', azi })).toEqual([])   // exact 7 zile: permis
    expect(valideazaEtapa({ actiune: 'bifeaza', element: el, data: '2026-11-02', azi })).toEqual(['Data poate fi cel mult 7 zile în urmă', 'Data e înaintea etapei anterioare'])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: el, data: '2026-11-11', azi })).toEqual(['Data e în viitor'])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: el, data: '2026-11-07', azi })).toEqual(['Data e înaintea etapei anterioare'])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: el, data: '', azi })).toEqual(['Data lipsește'])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: el, data: azi, azi, motiv: 'x' })).toEqual(['Motivul se dă doar la retragere'])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: EL(1, 'X-1', { etape: ['montaj'], etape_data: ['2026-11-01'] }), data: azi, azi })).toEqual(['Toate etapele sunt deja bifate'])
    expect(valideazaEtapa({ actiune: 'bifeaza', element: EL(1, 'X-1', { stare: 'anulat' }), data: azi, azi })).toEqual(['Elementul nu e activ'])
  })
  it('retragerea: doar cu etape bifate și motiv', () => {
    expect(valideazaEtapa({ actiune: 'retrage', element: EL(1, 'F6-1', { etape_data: ['2026-11-08'] }), azi, motiv: ' greșit ' })).toEqual([])
    expect(valideazaEtapa({ actiune: 'retrage', element: EL(1, 'F6-1', { etape_data: ['2026-11-08'] }), azi, motiv: '  ' })).toEqual(['Scrie motivul retragerii'])
    expect(valideazaEtapa({ actiune: 'retrage', element: EL(1, 'F6-1'), azi, motiv: 'x' })).toEqual(['Nicio etapă bifată'])
    expect(valideazaEtapa({ actiune: 'sterge', element: EL(1, 'F6-1'), azi })).toEqual(['Acțiune necunoscută'])
  })
  it('payload-ul: etapa următoare la bifare, ultima la retragere; înghețat, comparabil la reîncercare', () => {
    const el = EL(7, 'F6-1', { etape_data: ['2026-11-08'], versiune: 3 })
    const b = payloadEtapa(el, { actiune: 'bifeaza', data: '2026-11-10', motiv: 'ignorat' })
    expect(b).toEqual({ p_id: 7, p_versiune: 3, p_actiune: 'bifeaza', p_etapa: 'egalizare', p_data: '2026-11-10', p_motiv: null })
    expect(Object.isFrozen(b)).toBe(true)
    expect(payloadEtapa(el, { actiune: 'retrage', data: '2026-11-10', motiv: ' greșit ' })).toEqual({ p_id: 7, p_versiune: 3, p_actiune: 'retrage', p_etapa: 'sapatura', p_data: null, p_motiv: 'greșit' })
    expect(decideReincercare({ payload: b, cheie: 'k' }, payloadEtapa(el, { actiune: 'bifeaza', data: '2026-11-10' }))).toBe('aceeasi')
    expect(decideReincercare({ payload: b, cheie: 'k' }, payloadEtapa(el, { actiune: 'bifeaza', data: '2026-11-09' }))).toBe('reconciliere')
  })
})

describe('inventarul CSV -> elemente (generatorul de import)', () => {
  const ANTET = 'cod;cod_detaliu;plansa_sursa;denumire;tip;grup;echipament;cantitate;um;pozitie;etape;certitudine;observatii;stadiu'
  const csv = randuri => obiecteCsv([ANTET, ...randuri].join('\n')).obiecte
  it('un rând valid: etape, cantitate cu virgulă, stadiu inițial', () => {
    const r = mapeazaElemente(csv(['f6-1;1413-C-REZ-01;1413-PR-C-00;Fundație F6;fundatie;rezervoare;Rezervor 1;12,5;mc;sus;sapatura>egalizare>turnare;sigur;obs;egalizare@2026-10-20']))
    expect(r.erori).toEqual([])
    expect(r.elemente[0]).toEqual({ cod: 'F6-1', cod_detaliu: '1413-C-REZ-01', plansa_sursa: '1413-PR-C-00', denumire: 'Fundație F6', tip: 'fundatie', grup: 'rezervoare',
      echipament: 'Rezervor 1', um: 'mc', pozitie: 'sus', observatii: 'obs', cantitate: 12.5, etape: ['sapatura', 'egalizare', 'turnare'], certitudine: 'sigur',
      stadiu: { etapa: 'egalizare', k: 2, data: '2026-10-20' } })
  })
  it('erorile nu taie / nu rotunjesc nimic tacit; certitudinea necunoscută = avertisment', () => {
    const r = mapeazaElemente(csv([
      'F6-1;X;Y;a;fundatie;g;;1,234;buc;;sapatura;de confirmat;;',
      'F6-1;X;Y;a;fundatie;g;;1;buc;;sapatura;de confirmat;;',
      'F6-1;X;Y;a;fundatie;g;;1;buc;;sapatura;poate;;',
      'Z-1;X;Y;a;cladire;G;;1;kg;;sapatura>betonare>sapatura;sigur;;',
      'Z-2;X;Y;;fundatie;g;;0;buc;;sapatura;sigur;;turnare@2026-10-20',
      'Z-3;X;Y;a;fundatie;g;;1;buc;;sapatura;sigur;;sapatura@2026-02-30',
      `Z-4;X;Y;${'a'.repeat(201)};fundatie;g;;1.000;buc;;sapatura;sigur;;`,
    ]))
    expect(r.elemente.map(e => e.cod)).toEqual(['F6-1'])
    expect(r.erori).toEqual([
      'Rândul 2 (F6-1): cantitate invalidă „1,234” (număr pozitiv, cel mult 2 zecimale)',
      'Rândul 4 (F6-1): cod duplicat F6-1',
      'Rândul 5 (Z-1): tip necunoscut „cladire”, grup invalid „G”, UM necunoscută „kg”, etape necunoscute: „betonare”',
      'Rândul 6 (Z-2): denumire lipsă, cantitatea trebuie să fie pozitivă, stadiu: etapa „turnare” nu e în lista elementului',
      'Rândul 7 (Z-3): stadiu: dată invalidă „2026-02-30”',
      'Rândul 8 (Z-4): denumire peste 200 de caractere, cantitate invalidă „1.000” (număr pozitiv, cel mult 2 zecimale)',
    ])
    expect(r.avertismente).toEqual([])
    const a = mapeazaElemente(csv(['F6-9;X;Y;a;fundatie;g;;1;buc;;sapatura;poate;;']))
    expect(a.avertismente).toEqual(['Rândul 2 (F6-9): certitudine nerecunoscută „poate” → de_confirmat'])
    expect(a.elemente[0].certitudine).toBe('de_confirmat')
  })
  it('etapele din text și datele calendaristice', () => {
    expect(etapeDinText('sapatura > turnare')).toEqual({ etape: ['sapatura', 'turnare'] })
    expect(etapeDinText('')).toEqual({ eroare: 'fără etape' })
    expect(etapeDinText('sapatura>sapatura')).toEqual({ eroare: 'etapă repetată' })
    expect(etapeDinText(Array(13).fill('montaj').join('>'))).toEqual({ eroare: 'peste 12 etape' })
    expect([dataValida('2026-11-10'), dataValida('2026-02-29'), dataValida('2028-02-29'), dataValida('10.11.2026')]).toEqual([true, false, true, false])
  })
})
