// Teste pentru generatorul SQL de import al cameretelor (fibră optică), pe un CSV SINTETIC scris aici (date inventate; lista reală nu
// intră în repo). Valorile așteptate sunt scrise de mână (L25).
import { describe, it, expect } from 'vitest'
import { genereazaSql, mapeazaCamerete } from './fibra_camerete_import_sql.mjs'

const BOM = String.fromCharCode(0xFEFF)
const CSV = `${BOM}tronson;cod;km_m\r\nT1;ct-01;10100\r\nT1;CT-02;10+600\r\nT2;CT-03;12350\r\n`

describe('mapeazaCamerete', () => {
  it('antet, cod normalizat, km în metri sau km+m, BOM și CRLF', () => {
    const { camerete, erori } = mapeazaCamerete(CSV)
    expect(erori).toEqual([])
    expect(camerete).toEqual([
      { rand: 2, tronson: 'T1', cod: 'CT-01', km_m: 10100 },
      { rand: 3, tronson: 'T1', cod: 'CT-02', km_m: 10600 },
      { rand: 4, tronson: 'T2', cod: 'CT-03', km_m: 12350 },
    ])
  })
  it('fiecare rând greșit e o eroare vizibilă (nimic nu dispare tacit)', () => {
    const { camerete, erori } = mapeazaCamerete('tronson;cod;km_m\nT1;CT 1;100\nT1;CT-2;12,5\n;CT-3;100\nT1;CT-4;100\nT2;ct-4;200\nT1;CT-5\n')
    expect(camerete.map(c => c.cod)).toEqual(['CT-4'])
    expect(erori).toEqual([
      'Rândul 7: 2 câmpuri, antetul are 3',
      'Rândul 2: codul „CT 1” nu e valid (litere mari, cifre și . / _ -, cel mult 30)',
      'Rândul 3 (CT-2): km „12,5” nu e valid (metri întregi sau 12+350)',
      'Rândul 4: tronsonul lipsește',
      'Rândul 6: codul CT-4 apare de două ori (și la rândul 5)',
    ])
  })
  it('antetul greșit sau lista goală', () => {
    expect(mapeazaCamerete('tronson;cod;km\nT1;C1;1\n').erori).toEqual(['Antetul nu are coloana „km_m” (cere: tronson;cod;km_m)'])
    expect(mapeazaCamerete('tronson;cod;km_m\n').erori).toEqual(['Lista nu are nicio cameretă'])
  })
})

describe('genereazaSql', () => {
  it('valorile, proiectul, ordinea lock-urilor și postcondiția', () => {
    const { sql, raport } = genereazaSql({ proiect: 7, listaCsv: CSV, sursa: 'abc' })
    expect(raport).toEqual({ camerete: 3, tronsoane: ['T1', 'T2'] })
    expect(sql).toContain("  (2, 'T1', 'CT-01', 10100),\n  (3, 'T1', 'CT-02', 10600),\n  (4, 'T2', 'CT-03', 12350);")
    expect(sql).toContain('FROM public.executie_tronsoane WHERE proiect_id = 7 ORDER BY id FOR NO KEY UPDATE')
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = 7)")
    expect(sql).toContain('nu toate cameretele din fișier sunt în listă')
    expect(sql).not.toMatch(/DELETE|TRUNCATE|UPDATE public/)
    // ordinea: lock pe tronsoane înaintea oricărei scrieri în camerete
    expect(sql.indexOf('FOR NO KEY UPDATE')).toBeLessThan(sql.indexOf('INSERT INTO public.executie_fibra_camerete'))
  })
  it('Jakarinos r1: standard_conforming_strings = on fixat ÎNAINTEA primului literal din fișier, plus gardă dacă SET LOCAL n-a prins', () => {
    // un cod de tronson cu backslash literal (T1\n): cu setarea off, PostgreSQL l-ar citi ca linie nouă și importul ar refuza tronsonul
    const { sql } = genereazaSql({ proiect: 7, listaCsv: 'tronson;cod;km_m\nT1\\n;C1;5\n' })
    expect(sql).toContain("(2, 'T1\\n', 'C1', 5)")
    const set = sql.indexOf('SET LOCAL standard_conforming_strings = on;')
    expect(set).toBeGreaterThan(-1)
    // primul literal șir din SQL (în afara comentariilor) vine DUPĂ setare
    const faraComentarii = sql.split('\n').map(l => (l.startsWith('--') ? ' '.repeat(l.length) : l)).join('\n')
    expect(set).toBeLessThan(faraComentarii.indexOf("'"))
    // SET LOCAL în afara unei tranzacții nu are efect: garda din preflight oprește importul înaintea oricărei scrieri
    expect(sql).toContain("IF current_setting('standard_conforming_strings') IS DISTINCT FROM 'on' THEN RAISE EXCEPTION")
    expect(sql.indexOf("current_setting('standard_conforming_strings')")).toBeLessThan(sql.indexOf('INSERT INTO _fo_camerete'))
  })
  it('ghilimelele simple se dublează; proiectul invalid și erorile de parsare opresc generarea', () => {
    const { sql } = genereazaSql({ proiect: 7, listaCsv: "tronson;cod;km_m\nT'1;C1;5\n" })
    expect(sql).toContain("(2, 'T''1', 'C1', 5)")
    expect(() => genereazaSql({ proiect: 0, listaCsv: CSV })).toThrow('--proiect')
    expect(() => genereazaSql({ proiect: 7, listaCsv: 'tronson;cod;km_m\nT1;C 1;5\n' })).toThrow(/Generarea s-a oprit:\n {2}Rândul 2: codul/)
  })
})
