// Teste pentru logica fișei de contract (executieContractRepere.js) și pentru generatorul de import (scripts/contract_repere_import_sql.mjs).
// Paritatea cu migrarea 20261203a se citește din fișierul SQL (blocurile marcate SECTIUNI / STARI / PUTERI, limitele din CHECK-uri,
// lista albă a RPC-ului), nu din codul testat (L19, L25).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SECTIUNI, STARI, PUTERI, LIMITE, DOAR_EVENIMENT, CAMPURI, CAMPURI_DATA, SECTIUNI_UI, STARE_INFO, PUTERE_INFO,
  ziNr, fmtZi, urgenta, sorteaza, filtreaza, rezumat, codUrmator, formular, valideaza, payload, amprenta, aplicaRand, imbinaLista,
  mesajEroare, eAmbigua,
} from './executieContractRepere.js'
import { randuri, genereaza, interzis } from '../scripts/contract_repere_import_sql.mjs'

const NL = String.fromCharCode(10), CR = String.fromCharCode(13)
const SQL = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261203a_executie_contract_repere.sql', import.meta.url)), 'utf8')
const bloc = (nume) => {
  const a = SQL.indexOf(`-- ${nume}-START`), b = SQL.indexOf(`-- ${nume}-END`)
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a)
  return [...SQL.slice(a, b).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}

describe('paritate cu migrarea 20261203a', () => {
  it('secțiunile, stările și puterile = listele albe din CHECK-uri', () => {
    expect(bloc('SECTIUNI')).toEqual(SECTIUNI)
    expect(bloc('STARI')).toEqual(STARI)
    expect(bloc('PUTERI')).toEqual(PUTERI)
  })
  it('limitele de lungime = CHECK-urile din tabel', () => {
    const dinSql = {}
    for (const m of SQL.matchAll(/^\s+([a-z_]+) text (?:NOT NULL )?CHECK \(.*?length\(\1\) (?:BETWEEN 1 AND|<=) (\d+)/gm)) dinSql[m[1]] = Number(m[2])
    expect(dinSql).toEqual(LIMITE)
  })
  it('câmpurile „doar la evenimente” = CHECK-ul executie_contract_repere_eveniment', () => {
    const a = SQL.indexOf('CONSTRAINT executie_contract_repere_eveniment')
    expect(a).toBeGreaterThan(0)
    const c = SQL.slice(a, SQL.indexOf(NL + ');', a))
    const nule = [...c.matchAll(/([a-z_]+) IS NULL/g)].map(m => m[1]).sort()
    expect(nule).toEqual([...DOAR_EVENIMENT].sort())
  })
  it('lista albă a RPC-ului acoperă exact câmpurile pe care le poate trimite clientul', () => {
    const arr = nume => [...SQL.match(new RegExp(`${nume} constant text\\[\\] := ARRAY\\[([^\\]]*)\\]`))[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    const dinRpc = new Set([...arr('v_texte'), ...arr('v_date_k'), 'ordine', 'activ'])
    const client = new Set(['sectiune', 'cod', 'titlu', 'ordine', 'activ', ...Object.values(CAMPURI).flat().map(([c]) => c)])
    expect([...client].sort()).toEqual([...dinRpc].sort())
  })
  it('fiecare secțiune, stare și putere are etichetă', () => {
    expect(SECTIUNI_UI.map(s => s.key).sort()).toEqual([...SECTIUNI].sort())
    expect(Object.keys(STARE_INFO).sort()).toEqual([...STARI].sort())
    expect(Object.keys(PUTERE_INFO).sort()).toEqual([...PUTERI].sort())
  })
  it('câmpurile doar-eveniment apar numai în secțiunea eveniment', () => {
    for (const s of SECTIUNI.filter(x => x !== 'eveniment')) for (const [c] of CAMPURI[s]) expect(DOAR_EVENIMENT).not.toContain(c)
  })
})

describe('date și urgență', () => {
  it('ziNr: zile calendaristice, datele invalide = null', () => {
    expect(ziNr('2026-11-11') - ziNr('2026-11-09')).toBe(2)
    expect(ziNr('2027-01-04') - ziNr('2025-05-05')).toBe(609)          // 610 zile calendaristice, capetele incluse
    expect(ziNr('2028-03-01') - ziNr('2028-02-28')).toBe(2)            // an bisect
    expect(ziNr('2026-02-30')).toBeNull()
    expect(ziNr('2026-11-9')).toBeNull()
    expect(ziNr(null)).toBeNull()
    expect(fmtZi('2026-11-12')).toBe('12.11.2026')
    expect(fmtZi('')).toBe('—')
  })
  it('urgenta: depășit / azi / urgent / curând / ok', () => {
    expect(urgenta('2026-11-08', '2026-11-09')).toMatchObject({ zile: -1, nivel: 'depasit', text: 'depășit cu 1 zi' })
    expect(urgenta('2026-11-09', '2026-11-09')).toMatchObject({ zile: 0, nivel: 'azi' })
    expect(urgenta('2026-11-11', '2026-11-09')).toMatchObject({ zile: 2, nivel: 'urgent', text: 'în 2 zile' })
    expect(urgenta('2026-11-16', '2026-11-09')).toMatchObject({ zile: 7, nivel: 'urgent' })
    expect(urgenta('2026-11-17', '2026-11-09')).toMatchObject({ zile: 8, nivel: 'curand' })
    expect(urgenta('2026-12-09', '2026-11-09')).toMatchObject({ zile: 30, nivel: 'curand' })
    expect(urgenta('2027-01-04', '2026-11-09')).toMatchObject({ zile: 56, nivel: 'ok' })
    expect(urgenta(null, '2026-11-09')).toMatchObject({ zile: null, nivel: null })
  })
})

const R = (id, sectiune, cod, extra = {}) => ({ id, proiect_id: 1, sectiune, cod, ordine: 0, titlu: `T ${cod}`, activ: true, versiune: 1, ...extra })

describe('listă, căutare, rezumat', () => {
  const ev = [
    R(1, 'eveniment', 'E01', { stare: 'decazut', termen_urmator: null }),
    R(2, 'eveniment', 'E02', { stare: 'de_notificat', termen_urmator: '2026-11-25' }),
    R(3, 'eveniment', 'E03', { stare: 'in_curs', termen_urmator: '2026-11-11' }),
    R(4, 'eveniment', 'E10', { stare: 'de_notificat', termen_urmator: '2026-11-19' }),
    R(5, 'eveniment', 'E04', { stare: 'de_notificat', termen_urmator: null }),
    R(6, 'eveniment', 'E05', { stare: 'risc', termen_urmator: '2026-11-08', activ: false }),
  ]
  it('sorteaza: stare (în curs, de notificat…), apoi termen (fără termen la urmă), apoi cod numeric', () => {
    expect(sorteaza(ev, 'eveniment').map(x => x.cod)).toEqual(['E03', 'E10', 'E02', 'E04', 'E05', 'E01'])
    const cl = [R(7, 'clauza', 'A10'), R(8, 'clauza', 'A02'), R(9, 'clauza', 'A01', { ordine: 5 })]
    expect(sorteaza(cl, 'clauza').map(x => x.cod)).toEqual(['A02', 'A10', 'A01'])
  })
  it('filtreaza: secțiunea, arhivatele doar la cerere, căutare fără diacritice', () => {
    const l = [...ev, R(10, 'clauza', 'A01', { titlu: 'Suspendare și penalități' })]
    expect(filtreaza(l, { sectiune: 'eveniment' }).map(x => x.id)).toEqual([1, 2, 3, 4, 5])
    expect(filtreaza(l, { sectiune: 'eveniment', arhivate: true })).toHaveLength(6)
    expect(filtreaza(l, { sectiune: 'clauza', text: 'penalitati' }).map(x => x.id)).toEqual([10])
    expect(filtreaza(l, { sectiune: 'clauza', text: 'SUSPENDARE si' }).map(x => x.id)).toEqual([10])
  })
  it('rezumat: doar evenimentele active; următoarele termene deschise, în ordine (cele depășite rămân vizibile)', () => {
    const r = rezumat(ev, '2026-11-09')
    expect(r.total).toBe(5)
    expect(r.peStari).toMatchObject({ de_notificat: 3, in_curs: 1, decazut: 1, risc: 0 })
    expect(r.urmatoare.map(x => [x.cod, x.nivel])).toEqual([['E03', 'urgent'], ['E10', 'curand'], ['E02', 'curand']])
    const cuDepasit = rezumat([...ev, R(11, 'eveniment', 'E11', { stare: 'risc', termen_urmator: '2026-11-01' })], '2026-11-09')
    expect(cuDepasit.urmatoare[0]).toMatchObject({ cod: 'E11', nivel: 'depasit' })
  })
  it('codUrmator: următorul număr liber pe secțiune', () => {
    expect(codUrmator(ev, 'eveniment')).toBe('E11')
    expect(codUrmator(ev, 'cale')).toBe('B01')
  })
})

describe('formular, validare, payload', () => {
  it('formular nou pentru eveniment pornește cu starea „de_notificat”', () => {
    const f = formular('eveniment')
    expect(f).toMatchObject({ sectiune: 'eveniment', stare: 'de_notificat', titlu: '', activ: true, ordine: '0' })
  })
  it('valideaza: titlu, cod, ordine, limite, date, stare', () => {
    const f = { ...formular('eveniment'), cod: 'E1', titlu: '   ', ordine: '-3', termen_urmator: '2026-02-30', stare: 'altceva', continut: 'x'.repeat(6001) }
    const v = valideaza(f, { nou: true })
    expect(v.ok).toBe(false)
    expect(Object.keys(v.erori).sort()).toEqual(['continut', 'ordine', 'stare', 'termen_urmator', 'titlu'])
    expect(valideaza({ ...f, cod: 'e1' }, { nou: true }).erori.cod).toBeTruthy()
    const bun = { ...formular('eveniment'), cod: 'E07', titlu: 'Ordin de suspendare', termen_urmator: '2026-11-25' }
    expect(valideaza(bun, { nou: true })).toEqual({ ok: true, erori: {} })
    expect(valideaza({ ...bun, cod: 'gresit' }, { nou: false }).ok).toBe(true)   // la modificare codul nu se trimite
  })
  it('payload: doar câmpurile secțiunii, text gol -> null, trim; sectiune + cod doar la rând nou', () => {
    const f = { ...formular('clauza'), cod: 'A03', titlu: '  Preț  ', clauze: ' 48.3 ', continut: '', ordine: '20', stare: 'in_curs', putere: 'medie' }
    const nou = payload(f, { nou: true })
    expect(nou).toEqual({ sectiune: 'clauza', cod: 'A03', titlu: 'Preț', ordine: 20, activ: true, clauze: '48.3', continut: null, citat: null, sursa: null })
    const mod = payload({ ...f, activ: false }, { nou: false })
    expect(mod).not.toHaveProperty('sectiune'); expect(mod).not.toHaveProperty('cod')
    expect(mod.activ).toBe(false)
    for (const c of DOAR_EVENIMENT) expect(mod).not.toHaveProperty(c)
    const ev = payload({ ...formular('eveniment'), cod: 'E01', titlu: 'X', termen_urmator: '2026-11-11', putere: '' }, { nou: true })
    expect(ev).toMatchObject({ stare: 'de_notificat', termen_urmator: '2026-11-11', putere: null })
    for (const c of CAMPURI_DATA) expect(Object.keys(ev)).toContain(c)
  })
  it('amprenta: aceeași intenție = același text; alt conținut / altă versiune = alt text', () => {
    const p = { titlu: 'A' }
    expect(amprenta(1, 5, 2, p)).toBe(amprenta(1, 5, 2, { titlu: 'A' }))
    expect(amprenta(1, 5, 2, p)).not.toBe(amprenta(1, 5, 3, p))
    expect(amprenta(1, 5, 2, p)).not.toBe(amprenta(1, 5, 2, { titlu: 'B' }))
  })
})

describe('aplicarea rezultatelor și erorile', () => {
  it('aplicaRand / imbinaLista: versiunea mai nouă câștigă', () => {
    const l = [R(1, 'clauza', 'A01', { versiune: 3, titlu: 'nou' })]
    expect(aplicaRand(l, R(1, 'clauza', 'A01', { versiune: 2, titlu: 'vechi' }))[0].titlu).toBe('nou')
    expect(aplicaRand(l, R(1, 'clauza', 'A01', { versiune: 4, titlu: 'mai nou' }))[0].titlu).toBe('mai nou')
    expect(aplicaRand(l, R(2, 'clauza', 'A02'))).toHaveLength(2)
    expect(imbinaLista([R(1, 'clauza', 'A01', { versiune: 2, titlu: 'citit' })], l)[0].titlu).toBe('nou')
    // review r1 P2: un rând salvat după pornirea citirii nu dispare când citirea veche se termină
    expect(imbinaLista([], [R(1, 'clauza', 'A01')])).toEqual([])
    expect(imbinaLista([], [R(1, 'clauza', 'A01')], [R(1, 'clauza', 'A01')]).map(x => x.id)).toEqual([1])
    expect(imbinaLista([R(2, 'clauza', 'A02')], [], [R(3, 'clauza', 'A03', { versiune: 1 })]).map(x => x.id)).toEqual([2, 3])
    expect(imbinaLista([R(3, 'clauza', 'A03', { versiune: 4, titlu: 'citit' })], [], [R(3, 'clauza', 'A03', { versiune: 2, titlu: 'salvat' })])[0].titlu).toBe('citit')
  })
  it('mesajEroare / eAmbigua', () => {
    expect(mesajEroare({ code: '42501', message: 'x' })).toMatch(/drept de scriere/)
    expect(mesajEroare({ code: '23505', message: 'x' })).toMatch(/există deja/)
    expect(eAmbigua({ message: 'Failed to fetch' })).toBe(true)
    expect(eAmbigua({ code: '57014', message: 'timeout' })).toBe(true)
    expect(eAmbigua({ code: '42501', message: 'nu' })).toBe(false)
    expect(eAmbigua({ code: '22023', message: 'nu' })).toBe(false)
  })
})

describe('generatorul de import', () => {
  const baza = () => ({ evenimente: [{ cod: 'E01', titlu: 'Ev', stare: 'de_notificat', termen_urmator: '2026-11-11' }] })
  it('refuză câmpuri străine secțiunii, stări / date invalide, coduri duplicate, evenimente fără stare', () => {
    expect(() => randuri({ clauze: [{ cod: 'A01', titlu: 'X', stare: 'in_curs' }] })).toThrow(/stare.*nu există pentru secțiunea clauza/)
    expect(() => randuri({ evenimente: [{ cod: 'E01', titlu: 'X', stare: 'altceva' }] })).toThrow(/stare necunoscută/)
    expect(() => randuri({ evenimente: [{ cod: 'E01', titlu: 'X', stare: 'viitor', termen_urmator: '2026-02-30' }] })).toThrow(/dată/)
    expect(() => randuri({ evenimente: [{ cod: 'E01', titlu: 'X' }] })).toThrow(/nu are stare/)
    expect(() => randuri({ evenimente: [{ cod: 'E01', titlu: 'X', stare: 'viitor' }, { cod: 'E01', titlu: 'Y', stare: 'viitor' }] })).toThrow(/duplicat/)
    expect(() => randuri({ surse: [{ cod: 'S01', titlu: 'X', continut: 'a\u0007b' }] })).toThrow(/control/)
    expect(() => randuri({})).toThrow(/niciun rând/)
    // review r1 P2: o grupă necunoscută (greșeală de scriere) oprește generarea; „meta” e permis
    expect(() => randuri({ clauze: [{ cod: 'A01', titlu: 'X' }], evenimnete: [] })).toThrow(/grupa „evenimnete”/)
    expect(() => randuri([])).toThrow(/obiect/)
    expect(randuri({ meta: { x: 1 }, clauze: [{ cod: 'A01', titlu: 'X' }] })).toHaveLength(1)
  })
  it('refuză mențiunile interne în textele pentru ERP („ai” românesc trece)', () => {
    expect(interzis('Nu ai drept de scriere')).toBe(false)
    expect(interzis('pregătit de AI')).toBe(true)
    expect(interzis('vezi paw-data')).toBe(true)
    expect(interzis('după review')).toBe(true)
    expect(() => randuri({ clauze: [{ cod: 'A01', titlu: 'Generat de Claude' }] })).toThrow(/mențiune/)
  })
  it('SQL: apostrofuri dublate, NULL-uri tipizate, garda pe proiect, fără id de proiect în fișier', () => {
    const sql = genereaza({ clauze: [{ cod: 'A01', titlu: "l'eau", continut: '' }] }, { regex: 'pruni[sș]or' })
    expect(sql).toContain("'l''eau'")
    expect(sql).toContain('NULL::date')
    expect(sql).toContain("nume ~* 'pruni[sș]or'")
    expect(sql).toContain("current_setting('gazpet.import_contract_proiect', true)")
    expect(sql).toContain('WHERE t.modificat_de IS NULL AND')
    expect(() => genereaza(baza(), { regex: "a'b" })).toThrow(/regex/)
    // review r1 P1: un rând nou în regex ar ieși din comentariu și ar rula SQL înaintea gărzilor
    expect(() => genereaza(baza(), { regex: '.' + NL + 'SELECT 9173;' + NL + '--|.*' })).toThrow(/regex/)
    expect(() => genereaza(baza(), { regex: 'a' + CR + 'b' })).toThrow(/regex/)
    expect(() => genereaza(baza(), { regex: 'x', sha: 'nu-e-hex' })).toThrow(/sha/)
    const numeRau = genereaza(baza(), { regex: 'x', numeSursa: 'a' + NL + 'SELECT 1;.json' })
    expect(numeRau.split(NL).filter(l => l.startsWith('SELECT'))).toEqual([])
    expect(genereaza(baza(), { regex: 'x' })).toBe(genereaza(baza(), { regex: 'x' }))
    // fiecare rând SQL din afara blocului DO e comentariu (nimic executabil înaintea gărzilor)
    const linii = sql.split(NL)
    const iDo = linii.findIndex(l => l.startsWith('DO '))
    expect(linii.slice(0, iDo).every(l => l.startsWith('--'))).toBe(true)
  })
  it('review r1 P2: un text cu „$imp$” nu închide blocul DO (delimitatorul se alege să nu apară în corp)', () => {
    const sql = genereaza({ clauze: [{ cod: 'A01', titlu: 'Text $imp$ admis', continut: 'și $imp1$' }] }, { regex: 'x' })
    const tag = sql.match(/^DO (\$[a-z0-9]*\$)$/m)[1]
    expect(tag).toBe('$imp2$')
    expect(sql.split(tag)).toHaveLength(3)              // deschidere + închidere, nimic în corp
    expect(sql).toContain("'Text $imp$ admis'")
    expect(sql.trimEnd().endsWith(tag + ';')).toBe(true)
  })
  it('fixture-urile din repo sunt exact ieșirea generatorului (fără linia de antet cu sha)', () => {
    for (const n of [1, 2]) {
      const dir = new URL('../scripts/fixtures/contract_repere/', import.meta.url)
      const date = JSON.parse(readFileSync(fileURLToPath(new URL(`exemplu_${n}.json`, dir)), 'utf8'))
      const fix = readFileSync(fileURLToPath(new URL(`import_exemplu_${n}.sql`, dir)), 'utf8').replace(/\r\n/g, '\n')
      const gen = genereaza(date, { regex: '.', numeSursa: `exemplu_${n}.json` })
      expect(fix.split('\n').slice(1).join('\n')).toBe(gen.split('\n').slice(1).join('\n'))
    }
  })
})
