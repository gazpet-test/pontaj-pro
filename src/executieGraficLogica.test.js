// Teste pentru executieGraficLogica.js. Valorile așteptate pe fixture-ul sintetic vin din specificația graficului fictiv
// (scripts/grafic/fixture_sintetic.py), scrise aici de mână — nu din codul testat (L25).
// Paritatea: forma rândurilor produse aici = coloanele din CREATE TABLE și din INSERT-urile RPC-ului din migrarea 20261202a.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  COLOANE_REVIZIE, COLOANE_ACTIVITATE, CHEI_JSON_ACTIVITATE, revizieDinJson, activitatiDinJson, revizieImplicita, verificaActivitati,
  arePliere, randuriVizibile, toatePliabile, eDepasita, doarDepasiteCuStramosi, zi, dinZi, luniaSaptamanii, scaraSaptamani, pozitieBara,
  pozitieZi, fmtData, fmtNumar, fmtPct, numeFisier, notaIncerte, descrieEroare,
} from './executieGraficLogica.js'

const DOC = JSON.parse(readFileSync(new URL('../test-fixtures/grafic/grafic_sintetic.json', import.meta.url), 'utf8'))
const MIGRARE = readFileSync(new URL('../supabase/migrations/20261202a_executie_grafic.sql', import.meta.url), 'utf8').replace(/\r/g, '')

// rânduri de mână pentru arbore: nivel 0 (proiect), 1, 2 cu copii de nivel 3
const R = (ordine, wbs, nivel, extra = {}) => ({ ordine, uid_sursa: 100 + ordine, wbs, nivel, rezumat: false, activ: true, pct_realizat: 0,
  finish_plan: '2026-06-30', ...extra })
const ARBORE = [
  R(0, '0', 0, { rezumat: true }),
  R(1, '1', 1, { rezumat: true }),
  R(2, '1.1', 2, { rezumat: true }),
  R(3, '1.1.1', 3),
  R(4, '1.1.2', 3, { rezumat: true }),
  R(5, '1.1.2.1', 4),
  R(6, '1.2', 2, { rezumat: true }),
  R(7, '1.2.1', 3),
  R(8, '2', 1),
]
const wbs = l => l.map(a => a.wbs)

describe('maparea JSON -> rânduri (fixture sintetic)', () => {
  const rev = revizieDinJson(DOC, { id: 7, importat_la: '2026-11-09T20:00:00+00:00', activ: true })
  const acts = activitatiDinJson(DOC, 7, 501)

  it('revizia: câmpurile și metadatele ca în RPC', () => {
    expect(Object.keys(rev)).toEqual(COLOANE_REVIZIE)
    expect(rev).toMatchObject({ id: 7, proiect_id: null, eticheta: 'Grafic sintetic R1', sursa_fisier: 'grafic_sintetic.xml', tip_fisier: 'MSPDI',
      data_stare: '2026-04-30', camp_pct_plan: 'TEXT5 (ales manual)', camp_pct_raportat: 'TEXT2 (ales manual)', nr_activitati: 11,
      importat_de: null, activ: true })
    expect(rev.metadate.incerte).toEqual([{ wbs: '1.3.1', camp: 'TEXT2', valoare: '#DIV/0!' }])
    expect(rev.metadate.campuri_lipsa).toEqual([])
    expect(rev.metadate.minute_pe_zi).toBe(480)
    expect(rev.metadate.statistici.activitati).toBe(11)
  })

  it('activitățile: ordinea, ierarhia și valorile din specificație', () => {
    expect(acts).toHaveLength(11)
    expect(Object.keys(acts[0])).toEqual(COLOANE_ACTIVITATE)
    expect(wbs(acts)).toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.2', '1.2.1', '1.2.2', '1.2.3', '1.3', '1.3.1', '1.3.2'])
    expect(acts.map(a => a.nivel)).toEqual([1, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3])
    expect(acts.map(a => a.id)).toEqual([501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511])
    const m = acts.find(a => a.wbs === '1.2.2')
    expect(m).toMatchObject({ revizie_id: 7, nume: 'Montaj conductă', start_plan: '2026-03-16', finish_plan: '2026-05-08', durata_zile: 40,
      pct_realizat: 60, pct_plan: 80, pct_raportat: 55.25, start_real: '2026-03-16', finish_real: null, start_baseline: '2026-03-09',
      finish_baseline: '2026-04-30', predecesori: '1.2.1 SS+5z', resurse: 'Echipa A, Echipa B', milestone: false, rezumat: false, activ: true,
      deviz_cod: null })
    expect(acts.find(a => a.wbs === '1.1.1')).toMatchObject({ milestone: true, pct_realizat: 100, durata_zile: 0 })
    expect(acts.find(a => a.wbs === '1.3.2').activ).toBe(false)
    expect(acts.find(a => a.wbs === '1.3.1').pct_raportat).toBeNull()
    expect(acts.filter(a => a.rezumat).map(a => a.wbs)).toEqual(['1', '1.1', '1.2', '1.3'])
  })

  it('verificaActivitati: numărul și ordinea față de revizie (L12)', () => {
    expect(verificaActivitati(acts, rev)).toBeNull()
    expect(verificaActivitati(acts.slice(0, 10), rev)).toMatch(/am citit 10 din 11/)
    expect(verificaActivitati([acts[1], acts[0], ...acts.slice(2)], rev)).toMatch(/nr\. 1/)
    expect(verificaActivitati(acts, { ...rev, nr_activitati: null })).toMatch(/numărul/)
  })
})

describe('paritate cu migrarea 20261202a', () => {
  const coloaneCreate = tabel => {
    const m = new RegExp(`CREATE TABLE public\\.${tabel} \\(\\n([\\s\\S]*?)\\n\\);`).exec(MIGRARE)
    expect(m, `CREATE TABLE ${tabel}`).toBeTruthy()
    return m[1].split('\n').map(l => /^  ([a-z_0-9]+) /.exec(l)?.[1]).filter(c => c && c !== 'CONSTRAINT')
  }
  const coloaneInsert = tabel => {
    const m = new RegExp(`INSERT INTO public\\.${tabel} \\(([^)]*)\\)`).exec(MIGRARE)
    expect(m, `INSERT ${tabel}`).toBeTruthy()
    return m[1].split(',').map(s => s.trim())
  }

  it('revizii: rândul din JSON = coloanele tabelului; RPC-ul scrie toate coloanele în afară de id și importat_la (implicite)', () => {
    const cre = coloaneCreate('executie_grafic_revizii')
    expect(COLOANE_REVIZIE).toEqual(cre)
    expect(coloaneInsert('executie_grafic_revizii')).toEqual(cre.filter(c => !['id', 'importat_la'].includes(c)))
  })

  it('activități: rândul din JSON = coloanele tabelului; RPC-ul scrie toate coloanele în afară de id și deviz_cod', () => {
    const cre = coloaneCreate('executie_grafic_activitati')
    expect(COLOANE_ACTIVITATE).toEqual(cre)
    expect(coloaneInsert('executie_grafic_activitati')).toEqual(cre.filter(c => !['id', 'deviz_cod'].includes(c)))
  })

  it('cheile JSON citite de RPC (e->…) = cele citite de mapare; metadatele reviziei = aceleași chei', () => {
    const chei = [...new Set([...MIGRARE.matchAll(/e->'([a-z_]+)'/g)].map(m => m[1]))].sort()
    expect(chei).toEqual([...CHEI_JSON_ACTIVITATE].sort())
    const meta = /jsonb_strip_nulls\(jsonb_build_object\(([\s\S]*?)\)\)/.exec(MIGRARE)
    expect(meta).toBeTruthy()
    const cheiMeta = [...meta[1].matchAll(/'([a-z_]+)', r->'\1'/g)].map(m => m[1])
    const rev = revizieDinJson(DOC)
    expect(Object.keys(rev.metadate).sort()).toEqual(['campuri_lipsa', 'incerte', 'statistici', ...cheiMeta].sort())
  })
})

describe('arborele și plierea', () => {
  it('doar rezumatele de nivel 1–2 au comutator (nu nivelul 0, nu nivelul 3+)', () => {
    expect(ARBORE.filter(arePliere).map(a => a.wbs)).toEqual(['1', '1.1', '1.2'])
  })
  it('fără pliere se văd toate; plierea ascunde exact descendenții', () => {
    expect(wbs(randuriVizibile(ARBORE, new Set()))).toEqual(wbs(ARBORE))
    expect(wbs(randuriVizibile(ARBORE, new Set([102])))).toEqual(['0', '1', '1.1', '1.2', '1.2.1', '2'])
    expect(wbs(randuriVizibile(ARBORE, new Set([101])))).toEqual(['0', '1', '2'])
    // un uid pliat care nu are comutator (nivel 3 rezumat, nivel 0) nu ascunde nimic
    expect(wbs(randuriVizibile(ARBORE, new Set([104, 100])))).toEqual(wbs(ARBORE))
  })
  it('„Restrânge tot” = toate pliabilele: rămân proiectul și nivelul 1', () => {
    const p = toatePliabile(ARBORE)
    expect([...p].sort()).toEqual([101, 102, 106])
    expect(wbs(randuriVizibile(ARBORE, p))).toEqual(['0', '1', '2'])
  })
})

describe('depășit', () => {
  const a = (extra) => ({ activ: true, finish_plan: '2026-05-08', pct_realizat: 60, ...extra })
  it('finish trecut și realizat < 100', () => {
    expect(eDepasita(a(), '2026-05-15')).toBe(true)
    expect(eDepasita(a(), '2026-05-09')).toBe(true)
  })
  it('limitele: finish = azi, 100%, inactiv, fără finish, procent necunoscut', () => {
    expect(eDepasita(a(), '2026-05-08')).toBe(false)
    expect(eDepasita(a({ pct_realizat: 100 }), '2026-05-15')).toBe(false)
    expect(eDepasita(a({ pct_realizat: 99.99 }), '2026-05-15')).toBe(true)
    expect(eDepasita(a({ activ: false }), '2026-05-15')).toBe(false)
    expect(eDepasita(a({ finish_plan: null }), '2026-05-15')).toBe(false)
    expect(eDepasita(a({ pct_realizat: 'x' }), '2026-05-15')).toBe(false)
    expect(eDepasita(a(), null)).toBe(false)
  })
  it('pe fixture, azi = 15.05.2026: doar 1.2.2 (1.3.2 e inactivă, 1.1.1 e 100%)', () => {
    const acts = activitatiDinJson(DOC, 1)
    expect(acts.filter(x => eDepasita(x, '2026-05-15')).map(x => x.wbs)).toEqual(['1.2.2'])
    expect(acts.filter(x => eDepasita(x, '2026-05-22')).map(x => x.wbs)).toEqual(['1.2.2'])   // 1.2.3 se termină azi: nu e depășit
    expect(acts.filter(x => eDepasita(x, '2026-05-23')).map(x => x.wbs)).toEqual(['1.2', '1.2.2', '1.2.3'])   // rezumatul 1.2 (finish 22.05, 55%) intră și el
  })
  it('„Doar depășite” păstrează strămoșii', () => {
    const acts = activitatiDinJson(DOC, 1)
    expect(wbs(doarDepasiteCuStramosi(acts, '2026-05-15'))).toEqual(['1', '1.2', '1.2.2'])
    expect(doarDepasiteCuStramosi(acts, '2026-01-01')).toEqual([])
  })
})

describe('zile și săptămâni', () => {
  it('zi / dinZi pe componente, fără fus orar; datele invalide -> null', () => {
    expect(zi('1970-01-02')).toBe(1)
    expect(dinZi(zi('2026-03-29'))).toBe('2026-03-29')   // ziua schimbării orei rămâne aceeași zi
    expect(zi('2026-02-30')).toBeNull()
    expect(zi('2026-5-1')).toBeNull()
    expect(zi(null)).toBeNull()
  })
  it('lunea săptămânii', () => {
    expect(dinZi(luniaSaptamanii(zi('2026-03-02')))).toBe('2026-03-02')   // luni
    expect(dinZi(luniaSaptamanii(zi('2026-03-08')))).toBe('2026-03-02')   // duminică
    expect(dinZi(luniaSaptamanii(zi('2026-03-09')))).toBe('2026-03-09')
  })
  it('scara pe fixture: din lunea 02.03.2026 până în săptămâna lui 26.06.2026, cu luni și ani', () => {
    const s = scaraSaptamani(activitatiDinJson(DOC, 1))
    expect(dinZi(s.z0)).toBe('2026-03-02')
    expect(s.nrSapt).toBe(17)                     // 02.03 … 22.06 (lunea săptămânii lui 26.06) = 17 săptămâni
    expect(s.luni.map(l => `${l.eticheta}:${l.deLa}+${l.nr}`)).toEqual(['mar:0+5', 'apr:5+4', 'mai:9+4', 'iun:13+4'])
    expect(s.ani).toEqual([{ an: 2026, deLa: 0, nr: 17 }])
    expect(scaraSaptamani([{ start_plan: null, finish_plan: null }])).toBeNull()
  })
  it('scara include baseline-ul când e înaintea planului', () => {
    const s = scaraSaptamani([{ start_plan: '2026-03-16', finish_plan: '2026-03-20', start_baseline: '2026-02-25', finish_baseline: '2026-03-01' }])
    expect(dinZi(s.z0)).toBe('2026-02-23')
    expect(s.nrSapt).toBe(4)
    expect(s.luni.map(l => l.eticheta)).toEqual(['feb', 'mar'])
  })
  it('poziția barelor și a zilei, în săptămâni', () => {
    const s = { z0: zi('2026-03-02'), nrSapt: 17 }
    expect(pozitieBara(s, '2026-03-02', '2026-03-13')).toEqual({ stanga: 0, latime: 12 / 7 })
    expect(pozitieBara(s, '2026-03-16', '2026-03-16')).toEqual({ stanga: 2, latime: 1 / 7 })
    expect(pozitieBara(s, '2026-03-16', '2026-03-10')).toBeNull()
    expect(pozitieBara(s, null, '2026-03-10')).toBeNull()
    expect(pozitieZi(s, '2026-03-09')).toBeCloseTo(1 + 0.5 / 7)
    expect(pozitieZi(s, '2025-12-31')).toBeNull()
  })
})

describe('formatare și erori', () => {
  it('date, numere, procente, nume de fișier', () => {
    expect(fmtData('2026-05-08')).toBe('08.05.2026')
    expect(fmtData(null)).toBe('—')
    expect(fmtData('2026-13-01')).toBe('—')
    expect(fmtNumar(40)).toBe('40')
    expect(fmtNumar(93.82)).toBe('93,82')
    expect(fmtNumar(1234.5)).toBe('1234,5')
    expect(fmtNumar(null)).toBe('—')
    expect(fmtPct(55.25)).toBe('55,25%')
    expect(fmtPct(0)).toBe('0%')
    expect(fmtPct(null)).toBe('—')
    expect(numeFisier('Z:\\Oferte\\Lot 2\\Anexa 2 - Grafic R5.mpp')).toBe('Anexa 2 - Grafic R5.mpp')
    expect(numeFisier('Z:\\Raport\\LOT 1 R16.zip!Anexa 2 R16.mpp')).toBe('Anexa 2 R16.mpp')
    expect(numeFisier('grafic.xml')).toBe('grafic.xml')
  })
  it('nota valorilor incerte', () => {
    expect(notaIncerte({ incerte: [] })).toBeNull()
    expect(notaIncerte(null)).toBeNull()
    expect(notaIncerte({ incerte: [{ wbs: '1.3.1' }] })).toBe('1 valoare necitibilă în coloanele de raport (% plan / % raport): WBS 1.3.1')
    expect(notaIncerte({ incerte: [{ wbs: '1.2.1' }, { wbs: '1.3.23' }] })).toBe('2 valori necitibile în coloanele de raport (% plan / % raport): WBS 1.2.1, 1.3.23')
  })
  it('tabelul lipsă e mesaj prietenos; orice altă eroare rămâne eroare (L18)', () => {
    expect(descrieEroare({ code: 'PGRST205', message: "Could not find the table 'public.executie_grafic_revizii' in the schema cache" }).tip).toBe('lipsa')
    expect(descrieEroare({ code: '42P01', message: 'relation "public.executie_grafic_revizii" does not exist' }).tip).toBe('lipsa')
    const e = descrieEroare({ code: '57014', message: 'timeout' })
    expect(e).toEqual({ tip: 'eroare', text: 'Nu am putut încărca graficul: timeout' })
    expect(descrieEroare(new Error('Failed to fetch')).tip).toBe('eroare')
  })
  it('revizia implicită: activa, altfel cea mai recentă', () => {
    const r = (id, importat_la, activ = false) => ({ id, importat_la, activ })
    expect(revizieImplicita([r(1, '2026-10-01'), r(2, '2026-11-01'), r(3, '2026-09-01', true)]).id).toBe(3)
    expect(revizieImplicita([r(1, '2026-10-01'), r(2, '2026-11-01'), r(3, '2026-09-01')]).id).toBe(2)
    expect(revizieImplicita([])).toBeNull()
  })
})
