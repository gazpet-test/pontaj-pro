// Mecanica probei de cost cu două sesiuni (supabase/tests/20261131i_redari_mail_link_cost_concurenta.sh, r5 — Jakarinos #1138 r4 P2): scriptul COMPARĂ
// EXPLICIT cu pragul duratele raportate de A (rpc_ms, lock-urile până la sfârșitul tranzacției) și de B (blocarea văzută pe setări și pe numerotare);
// orice durată peste prag, lipsă sau nenumerică = ieșire 1. Fără bază: un psql FALS pe PATH (B = cel care citește SQL-ul din stdin, A = cel cu fișierul)
// scrie liniile NOTICE date de test. Mutanții (comparația lui B / a lui A scoasă din script) TREBUIE să treacă pe cazurile peste prag — adică testul
// de mai jos pică pe ei. Concurența reală rămâne pe clonă (scriptul însuși).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../supabase/tests/20261131i_redari_mail_link_cost_concurenta.sh', import.meta.url))
const TEXT = readFileSync(SCRIPT, 'utf8').replace(/\r/g, '')
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' })
const FALS = mkdtempSync(join(tmpdir(), 'psql_fals_'))
writeFileSync(join(FALS, 'psql'), [
  '#!/usr/bin/env bash',
  '# psql fals: „-f -” = sesiunea B (citește SQL-ul din stdin), altfel sesiunea A',
  'mod=A; for x in "$@"; do [ "$x" = "-" ] && mod=B; done',
  'if [ "$mod" = B ]; then cat >/dev/null; printf "%s\\n" "${FALS_B:-}"; exit "${FALS_B_EXIT:-0}"; fi',
  'printf "%s\\n" "${FALS_A:-}"; exit "${FALS_A_EXIT:-0}"', ''].join('\n'))
chmodSync(join(FALS, 'psql'), 0o755)

const linieA = (o = {}) => 'NOTICE:  COST 20261131i: ' + Object.entries({ destinatari: 300, caractere: 19000, tokenuri_sintetice: 20000, tokenuri_total: 20300,
  rpc_ms: 900, lock_setari_rpc_ms: 850, lock_setari_tranzactie_ms: 870, lock_numerotare_tranzactie_ms: 860, mesaje: 300, mesaje_cu_linkul_lor: 300,
  prag_ms: 2000, verdict: 'OK', ...o }).map(([k, v]) => `${k}=${v}`).join(' ')
const linieB = (o = {}) => 'NOTICE:  COST_B 20261131i: ' + Object.entries({ setari_blocat_ms: 880, numerotare_blocat_ms: 865, incercari: 4100, verdict: 'VAZUT', ...o })
  .map(([k, v]) => `${k}=${v}`).join(' ')

function ruleaza(script, { a = linieA(), b = linieB(), env = {}, args = [] } = {}) {
  const r = spawnSync('bash', [script, ...args], { encoding: 'utf8',
    env: { ...process.env, PATH: FALS + delimiter + process.env.PATH, COST_CLONA: 'da', FALS_A: a, FALS_B: b, ...env } })
  return { cod: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function mutant(nume, marcaj) {
  const i = TEXT.indexOf(`# >>> ${marcaj}\n`), j = TEXT.indexOf(`# <<< ${marcaj}\n`)
  if (i < 0 || j < 0) throw new Error('lipsește marcajul ' + marcaj)
  const d = mkdtempSync(join(tmpdir(), 'cost_mutant_'))
  const f = join(d, nume + '.sh')
  writeFileSync(f, TEXT.slice(0, i) + TEXT.slice(j))
  copyFileSync(fileURLToPath(new URL('../../supabase/tests/20261131i_redari_mail_link_cost.sql', import.meta.url)), join(d, '20261131i_redari_mail_link_cost.sql'))
  return f
}
// cazurile peste prag (sau fără durată): fiecare TREBUIE să dea ESEC
const PESTE = {
  'B: setări blocate 2500 ms': { b: linieB({ setari_blocat_ms: 2500 }), rand: /ESEC B setari_blocat_ms=2500 > prag 2000 ms/ },
  'B: numerotare blocată 2001 ms': { b: linieB({ numerotare_blocat_ms: 2001 }), rand: /ESEC B numerotare_blocat_ms=2001 > prag 2000 ms/ },
  'B: numerotarea nevăzută': { b: linieB({ numerotare_blocat_ms: 'nevazut', verdict: 'ESEC' }), rand: /ESEC B numerotare_blocat_ms=nevazut/ },
  'A: lock-ul setărilor până la ROLLBACK 2400 ms (verdictul lui A spune OK)': { a: linieA({ lock_setari_tranzactie_ms: 2400 }), rand: /ESEC A lock_setari_tranzactie_ms=2400 > prag/ },
  'A: numerotarea până la ROLLBACK 3000 ms': { a: linieA({ lock_numerotare_tranzactie_ms: 3000 }), rand: /ESEC A lock_numerotare_tranzactie_ms=3000 > prag/ },
  'A: rpc 2100 ms': { a: linieA({ rpc_ms: 2100 }), rand: /ESEC A rpc_ms=2100 > prag/ },
}

describe.skipIf(bash.status !== 0)('20261131i_redari_mail_link_cost_concurenta.sh — comparația explicită cu pragul (psql fals)', () => {
  it('sub prag pe toate duratele = REZULTAT: OK, ieșire 0; fiecare comparație e afișată', () => {
    const r = ruleaza(SCRIPT)
    expect(r.cod, r.out).toBe(0)
    expect(r.out).toMatch(/REZULTAT: OK/)
    for (const c of ['A rpc_ms=900', 'A lock_setari_tranzactie_ms=870', 'A lock_numerotare_tranzactie_ms=860', 'B setari_blocat_ms=880', 'B numerotare_blocat_ms=865'])
      expect(r.out).toContain(`ok   ${c} <= prag 2000 ms`)
  })
  it('exact pe prag (2000) trece; pragul dat ca parametru se aplică (3000)', () => {
    expect(ruleaza(SCRIPT, { b: linieB({ setari_blocat_ms: 2000 }) }).cod).toBe(0)
    expect(ruleaza(SCRIPT, { b: linieB({ setari_blocat_ms: 2500 }), args: ['300', '19000', '20000', '8s', '3000'] }).cod).toBe(0)
    expect(ruleaza(SCRIPT, { b: linieB({ setari_blocat_ms: 3001 }), args: ['300', '19000', '20000', '8s', '3000'] }).cod).toBe(1)
  })
  for (const [nume, c] of Object.entries(PESTE)) {
    it(`${nume} = ESEC, ieșire 1`, () => {
      const r = ruleaza(SCRIPT, c)
      expect(r.cod, r.out).toBe(1)
      expect(r.out).toMatch(c.rand)
      expect(r.out).toMatch(/REZULTAT: ESEC/)
    })
  }
  it('fără liniile de rezultat, cu verdict A ≠ OK sau cu psql picat = ESEC', () => {
    expect(ruleaza(SCRIPT, { a: '' }).cod).toBe(1)
    expect(ruleaza(SCRIPT, { b: '' }).cod).toBe(1)
    expect(ruleaza(SCRIPT, { a: linieA({ verdict: 'DEPASIT' }) }).cod).toBe(1)
    expect(ruleaza(SCRIPT, { env: { FALS_B_EXIT: '3' } }).cod).toBe(1)
    expect(ruleaza(SCRIPT, { env: { FALS_A_EXIT: '3' } }).cod).toBe(1)
  })
  it('folosire greșită = 2 (fără COST_CLONA, prag nenumeric)', () => {
    expect(ruleaza(SCRIPT, { env: { COST_CLONA: '' } }).cod).toBe(2)
    expect(ruleaza(SCRIPT, { args: ['300', '19000', '20000', '8s', '2s'] }).cod).toBe(2)
  })
  it('MUTANT: fără comparația lui B cu pragul — cazurile B peste prag ar ieși 0 (testul de mai sus le prinde)', () => {
    const m = mutant('fara_prag_b', 'PRAG-B')
    expect(ruleaza(m, PESTE['B: setări blocate 2500 ms']).cod).toBe(0)
    expect(ruleaza(m, PESTE['B: numerotare blocată 2001 ms']).cod).toBe(0)
  })
  it('MUTANT: fără comparația lui A cu pragul — lock-ul până la ROLLBACK peste prag ar ieși 0', () => {
    const m = mutant('fara_prag_a', 'PRAG-A')
    expect(ruleaza(m, PESTE['A: lock-ul setărilor până la ROLLBACK 2400 ms (verdictul lui A spune OK)']).cod).toBe(0)
  })
})
