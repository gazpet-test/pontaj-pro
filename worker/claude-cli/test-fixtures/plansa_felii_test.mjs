// Linux/NAS sau un shell POSIX local: node --test worker/claude-cli/test-fixtures/plansa_felii_test.mjs
// SHELL_D4=/cale/catre/sh dacă sh nu e în PATH. Nu rulează Docker sau Claude real.
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'

const sha = s => createHash('sha256').update(s).digest('hex')
const pachetId = m => sha(JSON.stringify({ doc_id: m.doc_id, taiat_la: m.taiat_la,
  felii: m.felii.map(({ eticheta, sha256 }) => ({ eticheta, sha256 })), perechi_lipire: m.perechi_lipire,
  instructiuni_sha256: m.instructiuni_sha256, instructiuni_lipire_sha256: m.instructiuni_lipire_sha256 }))

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
  m.instructiuni_sha256 = sha('instrucțiuni test'); m.instructiuni_lipire_sha256 = sha('lipire test'); m.pachet_id = pachetId(m)
  writeFileSync(join(dir, 'data/INSTRUCTIUNI.md'), 'instrucțiuni test\n')
  writeFileSync(join(dir, 'data/INSTRUCTIUNI_LIPIRE.md'), 'lipire test\n')
  const result = { doc_id: m.doc_id, taiat_la: m.taiat_la, felii: { z1_1: { sha256: hash, text: '{"tronsoane":[]}' } }, lipiri: {}, pachet_id: 'inventat de model', rulare: { model: 'inventat' } }
  writeFileSync(join(dir, 'data/manifest.json'), JSON.stringify(m))
  writeFileSync(join(dir, 'prompts/plansa_felii.md'), readFileSync(join(root, 'prompts/plansa_felii.md')))
  const envelope = { result: JSON.stringify(result), subtype: 'success', is_error: false, num_turns: 3, modelUsage: { 'claude-opus-5': { inputTokens: 100 } } }
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
  const parsed = JSON.parse(readFileSync(output, 'utf8'))
  assert.deepEqual(parsed, { ...result, pachet_id: m.pachet_id, rulare: {
    prompt_sha256: sha(args[args.indexOf('-p') + 1]), instructiuni_sha256: m.instructiuni_sha256,
    instructiuni_lipire_sha256: m.instructiuni_lipire_sha256, cli_version: 'claude-test', model: 'claude-opus-5',
  } })
}))

// Execută chiar fragmentele Node din launcher, fără CLI, shell sau subprocess.
test('r2 proveniență launcher: metadate independente de model, hash efectiv și refuz prompt/model greșit', () => {
  const launcher = readFileSync(join(root, 'launcher.sh'), 'utf8')
  const fragments = [...launcher.matchAll(/node -e '([^']*)'/g)].map(m => m[1])
  const prepare = fragments.find(s => s.includes('plansa_provenienta.json'))
  const finish = fragments.find(s => s.includes('const meta=JSON.parse'))
  assert.ok(prepare && finish)
  const m = { doc_id: 470, taiat_la: 'taiere', felii: [{ eticheta: 'z1_1', sha256: sha('A') }, { eticheta: 'z1_2', sha256: sha('B') }],
    perechi_lipire: [['z1_1', 'z1_2']], instructiuni_sha256: sha('P2'), instructiuni_lipire_sha256: sha('L2') }
  m.pachet_id = pachetId(m)
  const files = new Map([['/data/manifest.json', JSON.stringify(m)], ['/data/INSTRUCTIUNI.md', 'P2\n'], ['/data/INSTRUCTIUNI_LIPIRE.md', 'L2\n']])
  const fs = { readFileSync: p => { assert.ok(files.has(p), p); return files.get(p) }, writeFileSync: (p, s) => files.set(p, s) }
  const run = (s, args) => runInNewContext(s, { require: n => n === 'fs' ? fs : n === 'crypto' ? { createHash } : assert.fail(n),
    process: { argv: ['node', ...args], exit: code => { throw new Error(`exit ${code}`) } } })
  const prompt = 'prompt efectiv\nP2\nL2'
  run(prepare, [prompt, 'claude-test'])
  const raw = { doc_id: 470, taiat_la: 'taiere', pachet_id: 'model-mincinos', rulare: { model: 'model-mincinos' }, felii: {},
    lipiri: { 'z1_1+z1_2': { sha256_a: sha('A'), sha256_b: sha('B'), text: '{"randuri":[]}' } } }
  files.set('raw', JSON.stringify(raw))
  const envelope = { subtype: 'success', modelUsage: { 'claude-opus-5': {} } }
  files.set('envelope', JSON.stringify(envelope))
  run(finish, ['envelope', 'raw', 'result'])
  const out = JSON.parse(files.get('result'))
  assert.equal(out.pachet_id, m.pachet_id)
  assert.deepEqual(out.rulare, { prompt_sha256: sha(prompt), instructiuni_sha256: sha('P2'), instructiuni_lipire_sha256: sha('L2'), cli_version: 'claude-test', model: 'claude-opus-5' })
  for (const modelUsage of [undefined, {}, { 'claude-sonnet-5': {} }, { 'claude-opus-5': {}, 'claude-sonnet-5': {} }]) {
    files.set('envelope', JSON.stringify({ ...envelope, modelUsage })); files.delete('result')
    assert.throws(() => run(finish, ['envelope', 'raw', 'result']), /exit 4/)
    assert.equal(files.has('result'), false)
  }
  files.set('envelope', JSON.stringify(envelope))
  raw.lipiri['z1_1+z1_2'].sha256_b = sha('B vechi'); files.set('raw', JSON.stringify(raw))
  assert.throws(() => run(finish, ['envelope', 'raw', 'result']), /exit 4/)
  files.set('/data/INSTRUCTIUNI.md', 'P1\n'); files.delete('/work/plansa_provenienta.json')
  assert.throws(() => run(prepare, [prompt, 'claude-test']), /exit 2/)
  assert.equal(files.has('/work/plansa_provenienta.json'), false)
})

test('r2 pilot: două lansări simultane → a doua refuzată, staging-ul primei intact și curățare proprie', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jak-d4-lock-'))
  const posix = p => p.split(sep).join('/')
  let first, completed
  try {
    const d = join(dir, 'pilot'), src = join(dir, 'source'), release = join(dir, 'release'), started = join(dir, 'started')
    mkdirSync(d); mkdirSync(src); mkdirSync(join(d, 'staging')); mkdirSync(join(d, 'staging', 'rulare-anterioara'))
    writeFileSync(join(d, 'staging', 'rulare-anterioara', 'martor'), 'nu șterge')
    writeFileSync(join(src, 'manifest.json'), '{}'); writeFileSync(join(src, 'martor'), 'prima rulare')
    const dc = join(dir, 'compose-fals')
    writeFileSync(dc, '#!/bin/sh\necho "$LIC_FOLDER" > "$D4_STARTED"\nwhile [ ! -f "$D4_RELEASE" ]; do sleep 0.05; done\nexit 7\n', { mode: 0o755 })
    const script = join(dir, 'run_pilot.sh')
    writeFileSync(script, readFileSync(join(root, 'run_pilot.sh'), 'utf8')
      .replace('D=/Volume1/docker/gazpet-claude-cli', `D="${posix(d)}"`)
      .replace('DC=/Volume1/@apps/DockerEngine/dockerd/bin/docker-compose', `DC="${posix(dc)}"`)
      .replace('chown -R 1000:1000 "$ST"', 'true')) // fixture fără root; lock/copiere/trap rămân reale
    const args = [script, src, 'plansa_felii']
    const env = { ...process.env, D4_STARTED: posix(started), D4_RELEASE: posix(release) }
    first = spawn(process.env.SHELL_D4 || 'sh', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    completed = new Promise((resolve, reject) => { first.once('error', reject); first.once('close', code => resolve(code)) })
    const waitReady = async () => {
      const until = Date.now() + 10000
      while (!existsSync(started)) {
        if (Date.now() > until) throw new Error('Prima rulare nu a creat staging-ul')
        await new Promise(r => setTimeout(r, 25))
      }
      return 'ready'
    }
    assert.equal(await Promise.race([waitReady(), completed]), 'ready')
    const st = readFileSync(started, 'utf8').trim()
    assert.match(st, /\/staging\/\d{8}_\d{6}_\d+$/)
    const second = spawnSync(process.env.SHELL_D4 || 'sh', args, { env, encoding: 'utf8', timeout: 3000 })
    if (second.error) throw second.error
    assert.equal(second.status, 3, second.stderr)
    assert.match(second.stdout, /pilotul rulează deja/)
    assert.equal(readFileSync(join(st, 'martor'), 'utf8'), 'prima rulare')
    assert.equal(readdirSync(join(d, 'staging')).length, 2)
    writeFileSync(release, '')
    assert.equal(await completed, 7)
    assert.equal(existsSync(st), false)
    assert.equal(readFileSync(join(d, 'staging', 'rulare-anterioara', 'martor'), 'utf8'), 'nu șterge')
  } finally {
    writeFileSync(join(dir, 'release'), '')
    if (completed) await completed.catch(() => {})
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true })
  }
})
