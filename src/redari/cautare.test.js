// Paritate căutare Registru: calea SQL (ILIKE pe filtrul generat) vs calea locală (potrivesteCautare), pe același tabel de cazuri (L19).
// ILIKE e emulat independent aici, după semantica PostgreSQL: % = orice șir, _ = un caracter, \ = escape implicit, fără majuscule;
// PostgREST traduce * în % înainte de ILIKE.
import { describe, it, expect } from 'vitest'
import { curataCautare, filtruCautareSql, potrivesteCautare } from './cautare.js'

function ilike(valoare, tipar) {
  const p = tipar.replace(/\*/g, '%')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '\\' && i + 1 < p.length) { re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    re += c === '%' ? '[\\s\\S]*' : c === '_' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'iu').test(valoare)
}
// filtrul or=(a.ilike.X,b.ilike.Y) aplicat pe un rând (fără virgule în termen — curataCautare le scoate)
function aplicaSql(rand, t) {
  const f = filtruCautareSql(t)
  if (!f) return true
  return f.split(',').some(cond => { const [col, op, ...rest] = cond.split('.'); expect(op).toBe('ilike'); return ilike(String(rand[col] ?? ''), rest.join('.')) })
}

const RANDURI = [
  { id_parcela: 'TST-0001', nume: 'POPESCU ION' }, { id_parcela: 'TST-0010', nume: 'IONESCU MARIA' },
  { id_parcela: 'ALT-0050', nume: 'Parcela 50 SRL' }, { id_parcela: 'TST-0002', nume: 'ȘTEFAN Ă. VASILE' },
  { id_parcela: 'TSTX0001', nume: 'A_B C' }, { id_parcela: 'BAC-0003', nume: 'O\'BRIEN' },
]
const TERMENI = ['', '   ', 'tst', 'TST-0001', 'TST_0001', 'TST%0001', '50%', '%', '_', '*', 'TST*1', 'a\\b', 'ion', 'ștefan', 'Ș', '(pop)', 'pop,esc', 'A_B', '"ion"', "o'brien", 'TST-000']

describe('căutare Registru — paritate SQL (ILIKE) ↔ local (includes)', () => {
  for (const t of TERMENI) {
    it(`termen ${JSON.stringify(t)}`, () => {
      for (const r of RANDURI) expect(potrivesteCautare(r, t), `${r.id_parcela}`).toBe(aplicaSql(r, t))
    })
  }
  it('cazurile cerute: TST_0001 nu mai prinde TST-0001 / TSTX0001 (literal); 50% caută „50”', () => {
    expect(aplicaSql(RANDURI[0], 'TST_0001')).toBe(false)
    expect(aplicaSql(RANDURI[4], 'TST_0001')).toBe(false)
    expect(potrivesteCautare(RANDURI[0], 'TST_0001')).toBe(false)
    expect(aplicaSql(RANDURI[2], '50%')).toBe(true)
    expect(potrivesteCautare(RANDURI[2], '50%')).toBe(true)
    // fără curățare, ILIKE brut ar fi prins TST-0001 cu „TST_0001” — exact nepotrivirea reparată
    expect(ilike('TST-0001', '%TST_0001%')).toBe(true)
  })
  it('termen doar din caractere speciale = fără căutare (toate rândurile), pe ambele căi', () => {
    for (const t of ['%', '_', '*', '(,)']) { expect(curataCautare(t)).toBe(''); expect(filtruCautareSql(t)).toBeNull() }
  })
})
