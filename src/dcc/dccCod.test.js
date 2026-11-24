// Registru DCC — formatorul JS pe tabelul COMUN de cazuri (aceleași cazuri le rulează proba PGlite pe funcțiile SQL, blocul p_paritate_formator).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { codDcc, numeFisierDcc, titluScurtDcc, formatValid, formatePereche, intervalCanonic, intervalECanonic } from './dccCod.js'
import { intrareReala, siruriInterval } from './dccCodSpeciale.js'

const CAZURI = JSON.parse(readFileSync(new URL('./dccCodCazuri.json', import.meta.url), 'utf8'))
const F = CAZURI.formate
const cod = msg => String(msg).split(':')[0]
const prinde = fn => { try { return { ok: fn() } } catch (e) { return { err: cod(e.message) } } }

describe('tabelul de cazuri', () => {
  it('are cel puțin 30 de cazuri și fiecare caz are exact un rezultat așteptat', () => {
    expect(CAZURI.cazuri.length).toBeGreaterThanOrEqual(30)
    for (const c of CAZURI.cazuri) {
      expect(F[c.format], c.id).toBeDefined()
      expect(('asteptat' in c) !== ('eroare' in c), c.id).toBe(true)
    }
    expect(new Set(CAZURI.cazuri.map(c => c.id)).size).toBe(CAZURI.cazuri.length)
  })
  for (const c of CAZURI.cazuri) {
    it(c.id, () => {
      const r = prinde(() => ('titlu_scurt' in c ? numeFisierDcc(F[c.format], c.comp, c.titlu_scurt, c.ext) : codDcc(F[c.format], c.comp)))
      if ('asteptat' in c) expect(r).toEqual({ ok: c.asteptat })
      else expect(r).toEqual({ err: c.eroare })
    })
  }
})

describe('formatValid', () => {
  const baza = F.lot1
  const fara = camp => baza.filter(s => s.camp !== camp)
  const cu = (i, s) => baza.map((x, j) => (j === i ? s : x))
  it('formatele valide ale tabelului', () => {
    for (const k of ['lot1', 'lot2_cod', 'lot2_fisier', 'dde', 'g6_fila_f']) expect(formatValid(F[k]), k).toBe(true)
  })
  it('refuză câmp dublat, câmpuri obligatorii lipsă, prefixe egale fila/anexa, prefix cu spațiu, primul segment cu prefix, cifre greșite', () => {
    expect(formatValid([...baza, { camp: 'tip', prefix: '-' }])).toBe(false)
    for (const c of ['revizie', 'fila', 'anexa', 'tematica', 'contract', 'emitent', 'tip', 'secventa']) expect(formatValid(fara(c)), c).toBe(false)
    expect(formatValid(F.invalid_fila_egal_anexa)).toBe(false)
    expect(formatValid(cu(1, { camp: 'emitent', prefix: '- ' }))).toBe(false)
    expect(formatValid(cu(0, { camp: 'contract', prefix: '-' }))).toBe(false)
    expect(formatValid(cu(1, { camp: 'emitent', prefix: '' }))).toBe(false)
    expect(formatValid(cu(4, { camp: 'secventa', prefix: '-', cifre: 4 }))).toBe(false)
    expect(formatValid(cu(5, { camp: 'fila', prefix: '-', cifre: 4 }))).toBe(false)
    expect(formatValid(cu(5, { camp: 'fila', prefix: '-' }))).toBe(false)
    expect(formatValid(cu(7, { camp: 'revizie', prefix: '.Rev', cifre: 2 }))).toBe(false)
    expect(formatValid(cu(1, { camp: 'emitent', prefix: '-ABCDEF' }))).toBe(false)
    expect(formatValid(cu(1, { camp: 'emitent', prefix: '-', extra: 1 }))).toBe(false)
    expect(formatValid(cu(1, { camp: 'necunoscut', prefix: '-' }))).toBe(false)
  })
  it('formate malformate: false, niciodată excepție', () => {
    const rele = [cu(1, { camp: 'emitent' }), cu(1, { camp: 'emitent', prefix: null }), cu(4, { camp: 'secventa', prefix: '-', cifre: '5' }),
      [...baza.slice(0, 3), 'x', ...baza.slice(4)], [], {}, null, undefined, 5, 'lot1', [null], cu(1, { camp: 'emitent', prefix: 5 })]
    for (const f of rele) expect(prinde(() => formatValid(f))).toEqual({ ok: false })
  })
  it('perechea (cod, fișier) cere limba în cel puțin unul', () => {
    expect(formatePereche(F.lot2_cod, F.lot2_fisier)).toBe(true)
    expect(formatePereche(F.lot1, F.lot1)).toBe(true)
    expect(formatePereche(F.lot2_cod, F.lot2_cod)).toBe(false)
    expect(formatePereche(F.lot2_cod, F.invalid_fila_egal_anexa)).toBe(false)
  })
})

describe('titluScurtDcc', () => {
  it('diacriticele cu virgulă și cu sedilă, majusculele, capetele, 60 de caractere', () => {
    expect(titluScurtDcc('ăâîșşțţ ĂÂÎȘŞȚŢ')).toBe('aaisstt_AAISSTT')
    expect(titluScurtDcc('a'.repeat(59) + ' b')).toBe('a'.repeat(59))
    expect(titluScurtDcc('x'.repeat(61))).toBe('x'.repeat(60))
    expect(prinde(() => titluScurtDcc(null))).toEqual({ err: 'DCC_TITLU_SCURT_GOL' })
    expect(prinde(() => titluScurtDcc('___'))).toEqual({ err: 'DCC_TITLU_SCURT_GOL' })
  })
})

describe('intervalele', () => {
  it('intervalCanonic pe secțiunea intervale', () => {
    for (const c of CAZURI.intervale) {
      const r = prinde(() => intervalCanonic(intrareReala(c.in)))
      if ('eroare' in c) expect(r, JSON.stringify(c.in)).toEqual({ err: c.eroare })
      else expect(r, JSON.stringify(c.in)).toEqual({ ok: c.asteptat })
    }
  })
  it('intervalECanonic pe secțiunea intervale_forma (niciodată null, nu aruncă)', () => {
    for (const c of CAZURI.intervale_forma) expect(prinde(() => intervalECanonic(intrareReala(c.in))), JSON.stringify(c.in)).toEqual({ ok: c.asteptat })
    expect(intervalECanonic(undefined)).toBe(false)
    expect(intervalECanonic(5)).toBe(false)
  })
  it('proprietatea pe 500 de șiruri: e canonic <=> intervalCanonic nu aruncă și întoarce exact șirul', () => {
    const siruri = siruriInterval()
    expect(siruri.length).toBe(500)
    let canonice = 0
    for (const s of siruri) {
      const r = prinde(() => intervalCanonic(s))
      const punctFix = 'ok' in r && r.ok === s
      expect(intervalECanonic(s), JSON.stringify(s)).toBe(punctFix)
      if (punctFix) canonice++
    }
    expect(canonice).toBeGreaterThan(10)
  })
})
