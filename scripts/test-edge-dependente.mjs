// node --test scripts/test-edge-dependente.mjs — dependențele _shared ale edge functions + data de referință pentru
// verificatorul „repo vs producție” (scripts/verifica-edge-functions.mjs). Fără rețea, fără secrete.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { importuriRelative, dependenteShared, ultimaModificare } from './edgeDependente.mjs'

test('importurile relative: from, export from, import(), import doar cu efecte; npm/jsr/https ignorate', () => {
  const src = `
    import { a } from '../_shared/a.ts'
    import type { T } from "../_shared/tipuri.ts"
    export { b } from './local.ts'
    import '../_shared/efect.mjs'
    const m = await import('../_shared/dinamic.ts')
    import { createClient } from 'npm:@supabase/supabase-js@2'
    import x from 'https://esm.sh/x'
    // un comentariu care pomenește from 'fals' nu e cale relativă
  `
  assert.deepEqual(importuriRelative(src), ['../_shared/a.ts', '../_shared/tipuri.ts', './local.ts', '../_shared/efect.mjs', '../_shared/dinamic.ts'])
})

async function arbore(fisiere) {
  const root = await mkdtemp(join(tmpdir(), 'edge-dep-'))
  for (const [cale, text] of Object.entries(fisiere)) {
    await mkdir(join(root, cale, '..'), { recursive: true })
    await writeFile(join(root, cale), text)
  }
  return root
}

test('dependențele _shared: tranzitive, cu cicluri, fără teste și fără fișierele altor funcții', async () => {
  const root = await arbore({
    'f/fn-a/index.ts': `import { h } from './handler.ts'\n`,
    'f/fn-a/handler.ts': `import { a } from '../_shared/a.ts'\nimport { z } from '../fn-b/z.ts'\n`,
    'f/fn-a/handler_test.ts': `import { t } from '../_shared/doar-test.ts'\n`,
    'f/fn-b/z.ts': `import { n } from '../_shared/nefolosit.ts'\n`,
    'f/_shared/a.ts': `import { b } from './b.mjs'\n`,
    'f/_shared/b.mjs': `import { a } from './a.ts'\nimport { c } from './sub/c.ts'\n`,
    'f/_shared/sub/c.ts': `export const c = 1\n`,
    'f/_shared/doar-test.ts': `export const t = 1\n`,
    'f/_shared/nefolosit.ts': `export const n = 1\n`,
  })
  try {
    const process_cwd = process.cwd()
    process.chdir(root)
    try {
      assert.deepEqual(await dependenteShared('f', 'fn-a'), ['f/_shared/a.ts', 'f/_shared/b.mjs', 'f/_shared/sub/c.ts'])
      assert.deepEqual(await dependenteShared('f', 'fn-inexistenta'), [])
    } finally { process.chdir(process_cwd) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('data de referință = cea mai nouă dintre folderul funcției (fără teste) și _shared importat; `din` arată fișierul comun', async () => {
  const root = await arbore({
    'f/fn-a/index.ts': `import { a } from '../_shared/a.ts'\n`,
    'f/fn-b/index.ts': `export const x = 1\n`,
    'f/_shared/a.ts': `export const a = 1\n`,
  })
  const git = (args, data) => execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  try {
    git(['init', '-q'], '2026-01-01T00:00:00Z')
    git(['add', '.'], '2026-01-01T00:00:00Z')
    git(['commit', '-q', '-m', 'initial'], '2026-01-01T00:00:00Z')
    await writeFile(join(root, 'f/_shared/a.ts'), 'export const a = 2\n')
    git(['commit', '-q', '-am', 'doar _shared'], '2026-02-01T00:00:00Z')
    const a = await ultimaModificare('f', 'fn-a', { cwd: root })
    assert.equal(new Date(a.commit).toISOString(), '2026-02-01T00:00:00.000Z', 'fn-a „îmbătrânește” odată cu _shared/a.ts')
    assert.equal(a.din, 'f/_shared/a.ts')
    const b = await ultimaModificare('f', 'fn-b', { cwd: root })
    assert.equal(new Date(b.commit).toISOString(), '2026-01-01T00:00:00.000Z', 'fn-b nu importă a.ts — neatinsă')
    assert.equal(b.din, null)
    await writeFile(join(root, 'f/fn-a/index.ts'), `import { a } from '../_shared/a.ts'\n// nou\n`)
    git(['commit', '-q', '-am', 'funcția'], '2026-03-01T00:00:00Z')
    const a2 = await ultimaModificare('f', 'fn-a', { cwd: root })
    assert.equal(a2.din, null, 'folderul propriu e mai nou: fără „prin _shared”')
    await mkdir(join(root, 'f/fn-a/sub'), { recursive: true })
    await writeFile(join(root, 'f/fn-a/index_test.ts'), 'Deno.test("x", () => {})\n')
    await writeFile(join(root, 'f/fn-a/sub/logic.test.js'), 'test("y", () => {})\n')
    git(['add', '.'], '2026-04-01T00:00:00Z')
    git(['commit', '-q', '-m', 'doar teste'], '2026-04-01T00:00:00Z')
    const a3 = await ultimaModificare('f', 'fn-a', { cwd: root })
    assert.equal(new Date(a3.commit).toISOString(), '2026-03-01T00:00:00.000Z', 'un commit doar pe teste nu cere deploy')
    assert.equal(await ultimaModificare('f', 'fn-inexistenta', { cwd: root }), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('repo-ul real: ofertare-poarta-text → ofertarePoartaText.mjs; ofertare-seap-import → tipDocument.mjs (cazul PR #641)', async () => {
  const dep = await dependenteShared('supabase/functions', 'ofertare-poarta-text')
  assert.ok(dep.includes('supabase/functions/_shared/ofertarePoartaText.mjs'), dep.join(', '))
  assert.deepEqual(await dependenteShared('supabase/functions', 'ofertare-seap-import'), ['supabase/functions/_shared/tipDocument.mjs'])
})
