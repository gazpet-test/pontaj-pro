// Teste pentru generatorul SQL de import al nodului de cuplare, pe fișierele SINTETICE din scripts/fixtures/nod_cuplare
// (date inventate; lista reală și desenul nu intră în repo). Valorile așteptate sunt scrise de mână din fixture (L25).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { genereazaSql, lit } from './noduri_cuplare_import_sql.mjs'
import { importuriExemplu } from './fixtures/nod_cuplare/genereaza_import_exemplu.mjs'

const f = n => readFileSync(fileURLToPath(new URL(`./fixtures/nod_cuplare/${n}`, import.meta.url)), 'utf8')
const BOM = String.fromCharCode(0xFEFF)
const baza = () => ({ proiect: 7, nod: 'NOD-TEST', listaCsv: f('lista_exemplu.csv'), puncteCsv: f('puncte_exemplu.csv'), manifest: JSON.parse(f('vederi_exemplu.json')) })

describe('genereazaSql pe fixture-ul sintetic', () => {
  it('rândurile listei, cu ghilimele simple dublate și certitudinea mapată', () => {
    const { sql, raport } = genereazaSql(baza())
    expect(raport.suduri).toBe(5)
    expect(sql).toContain("('CP-001', 'Z1. Linie fictivă DN300', 300, '323,9×8 / 323,9×8', '1 Țeavă test 2,00 m', '2 Cot test 90°', 'sigur')")
    expect(sql).toContain("('CP-002', 'Z1. Linie fictivă DN300', 300, '323,9×8 / 323,9×10', '2 Cot test 90°', '3 Teu O''Test', 'de_confirmat')")
    expect(sql).toContain("('CP-003', 'Z2. Ramură fictivă DN100', 100, '114,3×6,3 / flanșă DN100', '4 Țeavă test', '5 Flanșă test', 'posibil')")
    expect(sql).toContain("('CP-005', 'Z3. Ansamblu fictiv (estimare)', 50, '60,3×4 / 60,3×4', '(de completat)', '(de completat)', 'de_confirmat')")
    expect(raport.avertismente).toEqual(['Rândul 6 (CP-005): certitudine nerecunoscută → de_confirmat'])
  })
  it('punctele: virgula zecimală; primul rând = vederea principală, al doilea = vedere secundară (jsonb)', () => {
    const { sql, raport } = genereazaSql(baza())
    expect(raport.puncte).toBe(4)
    expect(sql).toContain(`('CP-001', 'PLAN', 12.5, 40, 'sigur', '[]'::jsonb)`)
    expect(sql).toContain(`('CP-002', 'PLAN', 30.25, 40, 'aproximativ', '[]'::jsonb)`)
    expect(sql).toContain(`('CP-003', 'A', 55, 60, 'sigur', '[{"vedere":"PLAN","x_pct":70,"y_pct":20,"certitudine":"sigur"}]'::jsonb)`)
    expect(sql).toContain(`('CP-004', 'A', 80, 75, 'aproximativ', '[]'::jsonb)`)
    expect(raport.puncteIgnorate).toEqual(['Rândul 7: CR-090 e a furnizorului (sărită din listă), punct ignorat'])
  })
  it('sudurile furnizorului rezervorului se sar (nu intră în „rest”) și se raportează: ignorate 1 (furnizor)', () => {
    const { sql, raport } = genereazaSql(baza())
    expect(raport.furnizor).toEqual(['CR-090'])
    expect(sql).not.toContain("'CR-090'")
    expect(sql).toContain('ignorate: 1 (furnizor)')
  })
  it('un punct al unui cod care nu e în listă (ex. coduri vechi înlocuite) oprește generarea, cu codul numit', () => {
    const p = f('puncte_exemplu.csv') + 'CP-201;PLAN;5;5;fara_pozitie_pe_plansa;\n'
    expect(() => genereazaSql({ ...baza(), puncteCsv: p })).toThrow(/sudură necunoscută „CP-201”/)
  })
  it('SQL-ul: proiectul și nodul ca literali, upsert pe (proiect, nod, cod), lipsa = anulat, sudatele lipsă opresc importul', () => {
    const { sql } = genereazaSql({ ...baza(), surse: { lista: 'ab'.repeat(32) } })
    expect(sql).toContain("SELECT 7, 'NOD-TEST', l.cod")
    expect(sql).toContain('ON CONFLICT (proiect_id, nod_cod, cod) DO UPDATE SET subansamblu = EXCLUDED.subansamblu')
    expect(sql).toContain("SET stare = 'anulat', motiv = 'import: lipsește din lista importată (sha256 abababababab)'")
    expect(sql).toMatch(/RAISE EXCEPTION 'import nod: lipsesc din listă suduri deja sudate/)
    expect(sql).toContain("s.stare = 'anulat' AND s.motiv LIKE 'import: %'")
    expect(sql).toContain('SET LOCAL standard_conforming_strings = on')
    expect(sql).toMatch(/RAISE EXCEPTION 'import nod: nu toate sudurile/)
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })
  it('BOM la începutul CSV-ului nu strică antetul', () => {
    const { raport } = genereazaSql({ ...baza(), listaCsv: BOM + f('lista_exemplu.csv'), puncteCsv: BOM + f('puncte_exemplu.csv') })
    expect([raport.suduri, raport.puncte]).toEqual([5, 4])
  })
  it('fără puncte: doar lista', () => {
    const { sql, raport } = genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: f('lista_exemplu.csv') })
    expect(raport.puncte).toBe(0)
    expect(sql).toContain('-- fără puncte')
  })
})

describe('fixture-urile SQL ale harness-ului (scripts/test_executie_noduri_suduri.sql, T14)', () => {
  it('sunt la zi cu generatorul (altfel: node scripts/fixtures/nod_cuplare/genereaza_import_exemplu.mjs)', () => {
    for (const [n, sql] of Object.entries(importuriExemplu())) {
      const salvat = f(n).replace(/\r\n/g, '\n')
      expect(salvat.slice(salvat.indexOf('\n') + 1), n).toBe(sql.replace(/\r\n/g, '\n'))
    }
  })
  it('lista 2 lasă pe dinafară CP-004 și CP-005 și aduce CR-001 (cazurile din T14)', () => {
    const { sql } = genereazaSql({ proiect: 1, nod: 'NOD-TEST-IMPORT', listaCsv: f('lista_exemplu_2.csv') })
    expect(sql).toContain("('CR-001', 'Z4. Rezervor fictiv', 50,")
    expect(sql).not.toContain("('CP-004'")
    expect(sql).not.toContain("('CP-005'")
  })
})

describe('genereazaSql: refuzuri (nimic nu se scrie pe jumătate)', () => {
  it('proiect / nod invalid', () => {
    expect(() => genereazaSql({ ...baza(), proiect: 0 })).toThrow(/--proiect/)
    expect(() => genereazaSql({ ...baza(), nod: "nod'; drop" })).toThrow(/--nod/)
  })
  it('cod duplicat în listă', () => {
    const l = f('lista_exemplu.csv').replace('CP-005;', 'CP-004;')
    expect(() => genereazaSql({ ...baza(), listaCsv: l })).toThrow(/cod duplicat CP-004/)
  })
  it('punct pe o sudură care nu e în listă / pe o vedere care nu e în manifest / în afara 0–100', () => {
    expect(() => genereazaSql({ ...baza(), puncteCsv: f('puncte_exemplu.csv').replace('CP-004;A', 'CP-099;A') })).toThrow(/sudură necunoscută „CP-099”/)
    expect(() => genereazaSql({ ...baza(), puncteCsv: f('puncte_exemplu.csv').replace('CP-004;A', 'CP-004;Q') })).toThrow(/vedere necunoscută „Q”/)
    expect(() => genereazaSql({ ...baza(), puncteCsv: f('puncte_exemplu.csv').replace('80;75', '101;75') })).toThrow(/x_pct invalid/)
  })
  it('punctele fără manifest', () => {
    expect(() => genereazaSql({ ...baza(), manifest: null })).toThrow(/manifestul vederilor/)
  })
  it('literalii SQL: ghilimele dublate, NUL și numere nefinite refuzate', () => {
    expect(lit("O'Brien")).toBe("'O''Brien'")
    expect(lit(null)).toBe('NULL')
    expect(lit(12.5)).toBe('12.5')
    expect(() => lit('a' + String.fromCharCode(0) + 'b')).toThrow(/NUL/)
    expect(() => lit(Infinity)).toThrow(/număr/)
  })
})
