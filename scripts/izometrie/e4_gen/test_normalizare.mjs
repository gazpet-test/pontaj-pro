import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeazaSudura, formatSudura } from '../../../src/lib/izoNormalizare.js'

const fixture = JSON.parse(readFileSync(new URL('../../../src/lib/izoSudura.cazuri.json', import.meta.url), 'utf8'))
const sql = readFileSync(new URL('../../../supabase/tests/izometrie_e4b_normalizare.test.sql', import.meta.url), 'utf8')
const shared = JSON.parse(sql.match(/\$vectori\$([\s\S]*?)\$vectori\$/)[1])
assert.deepEqual(shared, fixture.cazuri, 'SQL must use exactly the JS vectors')
for (const c of shared) {
  const r = normalizeazaSudura(c.in, c.opt)
  for (const [key, value] of Object.entries(c.asteptat)) {
    const actual = key === 'lot1' || key === 'lot2' ? formatSudura(r, { prefix: key === 'lot1' ? 'T' : 'TR' }) : r[key]
    assert.deepEqual(actual, value, `${JSON.stringify(c.in)}: ${key}`)
  }
}
console.log(`PASS normalizare: ${shared.length} vectori JS; identici cu fixture SQL (SQL nerulat)`)
