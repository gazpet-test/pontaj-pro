// Teste pentru generatorul SQL de import al elementelor de construcții, pe fișierele SINTETICE din scripts/fixtures/nod_constructii
// (date inventate; inventarul real din planșe nu intră în repo). Valorile așteptate sunt scrise de mână din fixture (L25).
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { genereazaSql, lit } from './noduri_constructii_import_sql.mjs'
import { importuriExemplu } from './fixtures/nod_constructii/genereaza_import_exemplu.mjs'

const f = n => readFileSync(fileURLToPath(new URL(`./fixtures/nod_constructii/${n}`, import.meta.url)), 'utf8')
const BOM = String.fromCharCode(0xFEFF)
const ANTET = 'cod;cod_detaliu;plansa_sursa;denumire;tip;grup;echipament;cantitate;um;pozitie;etape;certitudine;observatii;stadiu'

describe('genereazaSql pe fixture-ul sintetic', () => {
  it('rândurile listei: ghilimele dublate, etapele ca text[], cantitatea cu virgulă, stadiul inițial (k și data)', () => {
    const { sql, raport } = genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: f('lista_exemplu.csv') })
    expect(raport).toEqual({ elemente: 4, cuStadiu: 1, avertismente: [] })
    expect(sql).toContain("('F6-1', 'TEST-C-REZ-01', 'TEST-C-00', 'Fundație fictivă rezervor 1, reazem 1', 'fundatie', 'rezervoare', 'Rezervor fictiv 1', 1, 'buc', 'Poziție fictivă A', 'de_confirmat', 'Date inventate pentru test', ARRAY['sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj']::text[], 2, '2026-10-20'::date)")
    expect(sql).toContain("('IPB-1', 'TEST-C-IPB', 'TEST-C-00', 'Împrejmuire fictivă', 'imprejmuire', 'imprejmuire', NULL, 110, 'm', 'Conturul fictiv', 'de_confirmat', NULL, ARRAY['trasare', 'sapatura', 'turnare', 'montaj', 'finisaj']::text[], NULL, NULL)")
    expect(sql).toContain("('SPC-1', 'TEST-C-SPC', 'TEST-C-00', 'Fundație fictivă SPC', 'fundatie', 'spc', NULL, 1, 'buc', NULL, 'sigur', NULL,")
    expect(sql).toContain('WHERE s.proiect_id = 7 AND s.nod_cod = \'NOD-TEST\'')
    expect(genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: f('lista_exemplu_2.csv') }).sql).toContain("'IPB-1', 'TEST-C-IPB', 'TEST-C-00', 'Împrejmuire fictivă', 'imprejmuire', 'imprejmuire', NULL, 112.5, 'm'")
  })
  it('BOM-ul și finalurile CRLF nu schimbă rezultatul', () => {
    const a = genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: f('lista_exemplu.csv') }).sql
    const b = genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: BOM + f('lista_exemplu.csv').replace(/\r?\n/g, '\r\n') }).sql
    expect(b.slice(b.indexOf('\n'))).toBe(a.slice(a.indexOf('\n')))
  })
  it('o eroare de parsare oprește generarea, cu rândul și codul numite; antetul incomplet la fel', () => {
    expect(() => genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: `${ANTET}\nF6-1;X;Y;a;fundatie;g;;1;buc;;sapatura>xyz;sigur;;` })).toThrow(/Rândul 2 \(F6-1\): etape necunoscute: „xyz”/)
    expect(() => genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: 'cod;denumire\nF6-1;a' })).toThrow(/Antetul nu are coloana „cod_detaliu”/)
    expect(() => genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: ANTET })).toThrow(/niciun element valid/)
    expect(() => genereazaSql({ proiect: 0, nod: 'NOD-TEST', listaCsv: f('lista_exemplu.csv') })).toThrow(/--proiect/)
    expect(() => genereazaSql({ proiect: 7, nod: "NOD'; DROP", listaCsv: f('lista_exemplu.csv') })).toThrow(/--nod/)
  })
  it('lit: ghilimele dublate, NUL refuzat, numere finite', () => {
    expect(lit("O'Test")).toBe("'O''Test'")
    expect(lit(null)).toBe('NULL')
    expect(() => lit('a' + String.fromCharCode(0))).toThrow(/NUL/)
    expect(() => lit(NaN)).toThrow(/număr invalid/)
  })
  it('SQL-ul are opririle (bifat lipsă, prefix, stadiu, dată în viitor) înaintea oricărei scrieri', () => {
    const { sql } = genereazaSql({ proiect: 7, nod: 'NOD-TEST', listaCsv: f('lista_exemplu.csv') })
    const scriere = sql.indexOf('INSERT INTO public.executie_noduri_constructii')
    for (const t of ['stadiu inițial cu dată în viitor', 'lipsesc din listă elemente cu etape bifate', 'nu păstrează etapele deja bifate', 'stadiul inițial diferă de etapele deja bifate']) {
      expect(sql.indexOf(t)).toBeGreaterThan(0)
      expect(sql.indexOf(t)).toBeLessThan(scriere)
    }
  })
  it('fixture-urile SQL din repo sunt la zi cu generatorul (harness-ul pe clonă le folosește)', () => {
    for (const [n, sql] of Object.entries(importuriExemplu())) expect(f(n).replace(/\r\n/g, '\n')).toBe(sql)
  })
})

describe('linia de comandă', () => {
  const script = fileURLToPath(new URL('./noduri_constructii_import_sql.mjs', import.meta.url))
  const lista = fileURLToPath(new URL('./fixtures/nod_constructii/lista_exemplu.csv', import.meta.url))
  it('refuză o ieșire în repo (date ale beneficiarului) și scrie în afara lui', () => {
    const inRepo = fileURLToPath(new URL('./fixtures/nod_constructii/_nu_trebuie.sql', import.meta.url))
    expect(() => execFileSync(process.execPath, [script, '--proiect', '1', '--nod', 'NOD-TEST', '--lista', lista, '--iesire', inRepo], { stdio: 'pipe' })).toThrow()
    expect(existsSync(inRepo)).toBe(false)
    const d = mkdtempSync(path.join(tmpdir(), 'constr-'))
    try {
      const out = path.join(d, 'import.sql')
      const t = execFileSync(process.execPath, [script, '--proiect', '1', '--nod', 'NOD-TEST', '--lista', lista, '--iesire', out], { encoding: 'utf8' })
      expect(t).toContain('4 elemente, 1 cu stadiu inițial')
      expect(readFileSync(out, 'utf8')).toContain('-- Surse: lista sha256 ')
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
  it('argument necunoscut = refuz', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'constr-'))
    try {
      writeFileSync(path.join(d, 'x.csv'), f('lista_exemplu.csv'))
      expect(() => execFileSync(process.execPath, [script, '--proiect', '1', '--nod', 'NOD-TEST', '--lista', path.join(d, 'x.csv'), '--iesire', path.join(d, 'o.sql'), '--puncte', 'x'], { stdio: 'pipe' })).toThrow()
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})
