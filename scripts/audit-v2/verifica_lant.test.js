import { describe, it, expect } from 'vitest'
import { citesteTabel, citesteDupaIds, clientDinEnv } from './verifica_lant.mjs'
import { comparaGroundTruth } from './comparatie.js'
function fake(rows, error = null) {
  const calls = []
  const db = { from(table) {
    calls.push(['from', table]); let col, value, values
    const q = { select(s) { calls.push(['select', s]); return q }, eq(c, v) { col = c; value = v; return q },
      in(c, v) { col = c; values = v; return q }, order(c) { calls.push(['order', c]); return q },
      range(a, b) { calls.push(['range', a, b]); return Promise.resolve({ data: rows.filter(r => values ? values.includes(r[col]) : r[col] === value).slice(a, b + 1), error }) } }
    return q
  } }
  return { db, calls }
}
describe('SELECT-only și paginare', () => {
  it('citește peste limita PostgREST, fără să piardă rândul vechi actualizat', async () => {
    const rows = Array.from({ length: 1101 }, (_, i) => ({ id: i + 1, licitatie_id: 100, stare: i === 0 ? 'eroare_urcare' : 'urcat' }))
    const f = fake(rows); const r = await citesteTabel(f.db, 'ofertare_seap_manifest', 'licitatie_id', 100)
    expect(r).toHaveLength(1101); expect(r[0].stare).toBe('eroare_urcare'); expect(f.calls.filter(c => c[0] === 'range')).toHaveLength(3)
  })
  it('împarte ID-uri în loturi și păstrează toate paginile', async () => {
    const rows = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, cerinta_id: i + 1 }))
    const f = fake(rows); expect(await citesteDupaIds(f.db, 'ofertare_acoperire', 'cerinta_id', rows.map(r => r.id))).toEqual(rows)
    expect(f.calls.filter(c => c[0] === 'from')).toHaveLength(3)
  })
  it('eroarea SQL nu este mulțime goală', async () => {
    await expect(citesteTabel(fake([], { code: 'PGRST200' }).db, 't', 'licitatie_id', 1)).rejects.toThrow('PGRST200')
  })
  it('refuză service_role înaintea oricărui apel', () => {
    const token = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.x`
    expect(() => clientDinEnv({ SUPABASE_URL: 'http://127.0.0.1', SUPABASE_ANON_KEY: 'x', AUDIT_ACCESS_TOKEN: token })).toThrow('authenticated')
  })
})
describe('P4 nu confundă identitatea cu semantica', () => {
  const s = { lant: { rezultate: [{ cerinta_id: 1, verigi: {} }] }, tabele: { ofertare_pt_pachet_fisiere: [{ nume: 'pt.pdf', rol: 'depus_final', sha256: 'a' }] } }
  it('ground truth absent nu e verde', () => expect(comparaGroundTruth(s)[0].stare).toBe('UNDETERMINED'))
  it('hash diferit fără promisiune de identitate nu dovedește conflict semantic', () => expect(comparaGroundTruth(s, [{ cerinta_id: 1, artefacte: [{ nume: 'pt.pdf', sha256: 'b' }] }])[0].stare).toBe('UNDETERMINED'))
  it('hash identic nu demonstrează pagina și răspunsul', () => expect(comparaGroundTruth(s, [{ cerinta_id: 1, artefacte: [{ sha256: 'a' }] }])[0].stare).toBe('PARTIAL'))
})
