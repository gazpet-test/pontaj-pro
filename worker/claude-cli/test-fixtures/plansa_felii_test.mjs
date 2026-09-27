// Linux/NAS sau un shell POSIX local: node --test worker/claude-cli/test-fixtures/plansa_felii_test.mjs
// SHELL_D4=/cale/catre/sh dacă sh nu e în PATH. Nu rulează Docker sau Claude real.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function sandbox(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'jak-d4-launcher-'))
  try {
    for (const n of ['data', 'out', 'work', 'context', 'prompts', 'bin']) mkdirSync(join(dir, n))
    let launcher = readFileSync(join(root, 'launcher.sh'), 'utf8')
    for (const [a, b] of [['/opt/prompts', 'prompts'], ['/data', 'data'], ['/out', 'out'], ['/work', 'work'], ['/context', 'context']])
      launcher = launcher.replaceAll(a, join(dir, b).split(sep).join('/'))
    const script = join(dir, 'launcher.sh')
    writeFileSync(script, launcher)
    const run = (extra = {}) => {
      const r = spawnSync(process.env.SHELL_D4 || 'sh', [script, 'plansa_felii'], {
        env: { ...process.env, ...extra }, encoding: 'utf8', timeout: 15000,
      })
      if (r.error) throw r.error
      return r
    }
    fn(dir, run)
  } finally {
    // Numai directorul temporar creat de acest test; o singură API, fără compunere între shell-uri.
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  }
}

test('plansa_felii: manifest lipsă → cod 2 și manifest_lipsa în jurnal, înainte de CLI/token', () => sandbox((dir, run) => {
  const r = run({ CLAUDE_CODE_OAUTH_TOKEN: '' })
  assert.equal(r.status, 2, r.stderr)
  assert.match(readFileSync(join(dir, 'out/jurnal.log'), 'utf8'), /cod=2 motiv=manifest_lipsa/)
}))

test('plansa_felii: JPEG fără OCR, Opus, ture în funcție de N, JSON extras din envelope', () => sandbox((dir, run) => {
  const hash = 'a'.repeat(64)
  const m = { doc_id: 470, taiat_la: '2026-09-27', felii: Array.from({ length: 6 }, (_, i) => ({ eticheta: `z1_${i + 1}`, fisier: `felii/z1_${i + 1}.jpg`, sha256: hash })), perechi_lipire: [] }
  const result = { doc_id: m.doc_id, taiat_la: m.taiat_la, felii: { z1_1: { sha256: hash, text: '{"tronsoane":[]}' } }, lipiri: {} }
  writeFileSync(join(dir, 'data/manifest.json'), JSON.stringify(m))
  writeFileSync(join(dir, 'prompts/plansa_felii.md'), readFileSync(join(root, 'prompts/plansa_felii.md')))
  const envelope = { result: JSON.stringify(result), subtype: 'success', is_error: false, num_turns: 3 }
  // Numai CLI fals. Dacă launcherul lasă cheile în mediu, testul pică înainte de rezultat.
  writeFileSync(join(dir, 'bin/claude'), `#!/usr/bin/env node
const fs=require('fs');
if(process.env.ANTHROPIC_API_KEY||process.env.ANTHROPIC_AUTH_TOKEN||process.env.ANTHROPIC_BASE_URL)process.exit(91);
if(process.argv.includes('--version')){console.log('claude-test');process.exit(0)}
fs.writeFileSync(process.env.D4_ARGS,JSON.stringify(process.argv));
console.log(${JSON.stringify(JSON.stringify(envelope))});
`, { mode: 0o755 })
  const r = run({ PATH: join(dir, 'bin') + ':' + process.env.PATH, CLAUDE_CODE_OAUTH_TOKEN: 'token-fals',
    ANTHROPIC_API_KEY: 'cheie-falsa', ANTHROPIC_AUTH_TOKEN: 'auth-fals', ANTHROPIC_BASE_URL: 'https://invalid',
    TASK_MODEL: 'sonnet', TASK_MAX_TURNS: '20', D4_ARGS: join(dir, 'args.json') })
  assert.equal(r.status, 0, r.stderr)
  const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'))
  assert.equal(args[args.indexOf('--model') + 1], 'opus')
  assert.ok(Number(args[args.indexOf('--max-turns') + 1]) >= 36)
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep')
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk')
  assert.ok(args.includes('--no-session-persistence'))
  assert.equal(existsSync(join(dir, 'work/text')), false)
  const log = readFileSync(join(dir, 'out/jurnal.log'), 'utf8')
  assert.doesNotMatch(log, /cheie-falsa|token-fals|auth-fals/)
  assert.match(log, /cod=0 motiv=ok/)
  const output = log.match(/PLANSA=(.*?) sha256=/)?.[1]
  assert.ok(output)
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), result)
}))
