// Mutanții logicii Xweather (r2, după review: parserul conditions/summary, cursorul reluării, reverificarea): fiecare copie stricată
// intenționat a xweather_zilnic_logica.ts TREBUIE să pice cel puțin o proprietate de mai jos, iar originalul pe niciuna — altfel testele
// nu dovedesc nimic (L25). Copiile se scriu într-un folder temporar (cu istoric_logica.ts lângă), se importă, apoi se șterg.
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = new URL('../supabase/functions/meteo-sync/', import.meta.url)
const LOGICA = readFileSync(new URL('xweather_zilnic_logica.ts', DIR), 'utf8')
const ISTORIC = readFileSync(new URL('istoric_logica.ts', DIR), 'utf8')
// calea REALĂ (pe Windows tmpdir() poate fi forma scurtă 8.3, „GAZPET~1”, pe care Vite n-o rezolvă)
const TMP = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'xw-mutanti-')))
writeFileSync(path.join(TMP, 'istoric_logica.ts'), ISTORIC)
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

let n = 0
async function incarca(text) {
  const f = path.join(TMP, `logica_${n++}.ts`)
  writeFileSync(f, text)
  return import(/* @vite-ignore */ pathToFileURL(f).href)
}
function mutant(inlocuiri) {
  let t = LOGICA
  for (const [din, in_] of inlocuiri) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 80))
    t = t.split(din).join(in_)
  }
  return t
}

// proprietățile cerute (valorile scrise de mână); întoarce lista celor încălcate
const ZI = '2026-11-12'
const PER = { dateTimeISO: '2026-11-12T00:00:00+02:00', temp: { minC: 1.2, maxC: 9.46 }, precip: { totalMM: 4.6 } }
const COND = { success: true, error: null, response: [{ loc: { lat: 44.94, long: 26.02 }, periods: [PER] }] }
const COND_FORMA_OBS = { success: true, error: null, response: [{ loc: { lat: 44.94, long: 26.02 }, periods: [{ summary: PER }] }] }
async function incalcari(m) {
  const out = []
  const v = m.valoriDinConditii(COND, ZI)
  if (v.valori?.tmax_c !== 9.46 || v.valori?.precipitatii_mm !== 4.6) out.push('parser: forma reală conditions nu dă valorile')
  if (!/formă neașteptată/.test(m.valoriDinConditii(COND_FORMA_OBS, ZI).respins || '')) out.push('parser: forma greșită nu e respinsă')
  const S = [{ id: 1, lat: 44.9, lng: 26, proiect_id: 7 }]
  const p = m.planXweather(S, new Map(), new Map([['7', '2026-10-01']]), { mod: 'backfill', ieri: '2026-11-12', pana: '2026-11-05', maxZile: 4 })
  if (m.continuaPana(p.sarcini, new Set(['2026-11-05', '2026-11-03', '2026-11-02']), p.ramase) !== '2026-11-04') out.push('cursor: sare ziua eșuată')
  if (m.zConfirmata({ rand: { versiune: 1 } }, 'eroare') !== false) out.push('confirmare: scrierea eșuată trece drept confirmată')
  if (m.zConfirmata({ tranzitoriu: 'rețea' }, null) !== false) out.push('confirmare: tranzitoriul trece drept confirmat')
  if (m.zConfirmata({ rand: { versiune: 1 } }, 'deja') !== true) out.push('confirmare: 23505 (există deja) nu e confirmat')
  const ex = new Map([['1', new Map([['2026-11-03', { versiune: 1 }]])]])
  const pr = m.planXweather(S, ex, new Map(), { mod: 'backfill', ieri: '2026-11-12', deLa: '2026-11-03', pana: '2026-11-03', reverifica: true })
  if (pr.sarcini.map(s => s.tip).join() !== 'verificare') out.push('reverificare: ziua existentă nu se reverifică')
  return out
}

const MUTANTI = [
  ['P1 parserul caută periods[].summary la conditions (forma r1)', [["const s = forma === 'conditions' ? p : p?.summary", 'const s = p?.summary']]],
  ['P2 perioada fără dată ignorată (formă greșită = „lipsă” tăcută)', [["if (d == null && y == null) return { motiv: `perioadă fără dată (formă neașteptată pentru ${forma}/summary)` }", 'if (d == null && y == null) continue']]],
  ['C1 cursorul din plan (nu din rezultate)', [['const prima = zile.find(z => !confirmate.has(z))', 'const prima = undefined']]],
  ['C2 rândul trimis = confirmat, fără rezultatul scrierii', [["return !!z?.rand && (scriere === 'ok' || scriere === 'deja')", 'return !!z?.rand']]],
  ['C3 tranzitoriul = confirmat', [["if (z?.neschimbat === true || (typeof z?.lipsa === 'string' && z.lipsa)) return true", 'if (z?.neschimbat === true || z?.lipsa || z?.tranzitoriu) return true']]],
  ['R1 reverificarea ignorată', [["if (!ex.has(d) || (mod === 'backfill' && reverifica)) z.push(d)", 'if (!ex.has(d)) z.push(d)']]],
]

describe('mutanții logicii Xweather (parser, cursor, reverificare)', () => {
  it('originalul respectă toate proprietățile', async () => {
    expect(await incalcari(await incarca(LOGICA))).toEqual([])
  })
  for (const [nume, inl] of MUTANTI) {
    it(`${nume}: pică`, async () => {
      const r = await incalcari(await incarca(mutant(inl)))
      expect(r.length, nume).toBeGreaterThan(0)
    })
  }
})
