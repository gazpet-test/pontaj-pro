// node --test scripts/test-edge-dependente.mjs — graful de module al edge functions + data de referință pentru
// verificatorul „repo vs producție” (scripts/verifica-edge-functions.mjs). Fără rețea, fără secrete.
// Cere node_modules (esbuild vine prin vite): `npm ci` înainte, ca în CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { grafFunctie, ultimaModificare } from './edgeDependente.mjs'

async function arbore(fisiere) {
  const root = await mkdtemp(join(tmpdir(), 'edge-dep-'))
  for (const [cale, text] of Object.entries(fisiere)) {
    await mkdir(join(root, cale, '..'), { recursive: true })
    await writeFile(join(root, cale), text)
  }
  return root
}
const curata = (root) => rm(root, { recursive: true, force: true })

test('graful real: tranzitiv cu ciclu, alt folder importat, fișier _test importat din cod; fără fișiere moarte, comentarii, texte, teste', async () => {
  const root = await arbore({
    'f/fn-a/index.ts': `import { h } from './handler.ts'\n// import { x } from '../_shared/comentariu.ts'\n/* from '../_shared/comentariu.ts' */\nconst s = "from '../_shared/text.ts'"\nexport default () => h + s\n`,
    'f/fn-a/handler.ts': `import { a } from '../_shared/a.ts'\nimport { z } from '../fn-b/z.ts'\nimport { fx } from './fixture_test.ts'\nexport const h = a + z + fx\n`,
    'f/fn-a/mort.ts': `import { n } from '../_shared/nefolosit.ts'\nexport const m = n\n`,
    'f/fn-a/handler_test.ts': `import { t } from '../_shared/doar-test.ts'\nimport { h } from './handler.ts'\nconsole.log(t, h)\n`,
    'f/fn-a/fixture_test.ts': `export const fx = 1\n`,
    'f/fn-b/z.ts': `export const z = 1\n`,
    'f/_shared/a.ts': `import { b } from './b.mjs'\nexport const a = b\n`,
    'f/_shared/b.mjs': `import { c } from './sub/c.ts'\nimport { createClient } from 'npm:@supabase/supabase-js@2'\nimport x from 'https://esm.sh/x'\nexport const b = c + (createClient ? 1 : 0) + (x ? 1 : 0)\n`,
    'f/_shared/sub/c.ts': `import { a } from '../a.ts'\nexport const c = 1\nexport const ciclu = () => a\n`,
    'f/_shared/comentariu.ts': `export const x = 1\n`,
    'f/_shared/text.ts': `export const x = 1\n`,
    'f/_shared/nefolosit.ts': `export const n = 1\n`,
    'f/_shared/doar-test.ts': `export const t = 1\n`,
  })
  try {
    const g = await grafFunctie('f', 'fn-a', { cwd: root })
    assert.deepEqual(g.probleme, [])
    assert.deepEqual(g.intrari, ['f/_shared/a.ts', 'f/_shared/b.mjs', 'f/_shared/sub/c.ts', 'f/fn-a/fixture_test.ts', 'f/fn-a/handler.ts', 'f/fn-a/index.ts', 'f/fn-b/z.ts'])
  } finally { await curata(root) }
})

test('fail-closed: alias fără hartă, import()/require() calculat, fișier lipsă, fără index.ts — raportate, nu ghicite', async () => {
  const root = await arbore({
    'g/fn-alias/index.ts': `import { a } from '#shared/a.ts'\nexport default a\n`,
    'g/fn-bare/index.ts': `import { z } from 'zod'\nexport default z\n`,
    'g/fn-dinamic/index.ts': `const p = '../_shared/' + 'a.ts'\nexport default await import(p)\n`,
    'g/fn-template/index.ts': 'const base = "../_shared"\nexport default await import(`${base}/a.ts`)\n',
    'g/fn-require/index.ts': `declare const require: (s: string) => unknown\nconst p = String(Date.now())\nexport default require(p)\n`,
    'g/fn-lipsa/index.ts': `import { x } from '../_shared/lipsa.ts'\nexport default x\n`,
    'g/fn-fara-index/handler.ts': `export const h = 1\n`,
    'g/fn-glob/index.ts': 'const k = "a"\nexport default await import(`../_shared/${k}.ts`)\n',
    'g/_shared/a.ts': `export const a = 1\n`,
    'g/_shared/b.ts': `export const b = 1\n`,
  })
  try {
    const p = async (slug) => (await grafFunctie('g', slug, { cwd: root })).probleme.join(' | ')
    assert.match(await p('fn-alias'), /specificator nerezolvat.*#shared\/a\.ts/)
    assert.match(await p('fn-bare'), /specificator nerezolvat.*zod/)
    assert.match(await p('fn-dinamic'), /import\(\) cu argument calculat/)
    assert.match(await p('fn-template'), /import\(\) cu argument calculat/)
    assert.match(await p('fn-require'), /require\(\) cu argument calculat/)
    assert.match(await p('fn-lipsa'), /lipsa\.ts/)
    assert.match(await p('fn-fara-index'), /index\.ts/)
    // șablon cu prefix fix: esbuild ia TOȚI candidații din folder — acoperire mai largă, nu „verde fals”
    const glob = await grafFunctie('g', 'fn-glob', { cwd: root })
    assert.deepEqual(glob.probleme, [])
    assert.ok(glob.intrari.includes('g/_shared/a.ts') && glob.intrari.includes('g/_shared/b.ts'), glob.intrari.join(', '))
  } finally { await curata(root) }
})

test('hartă de importuri (deno.json în folderul funcției): aliasul se rezolvă, npm: rămâne extern, harta intră în graf', async () => {
  const root = await arbore({
    'h/fn-a/deno.json': JSON.stringify({ imports: { '#shared/': '../_shared/', zod: 'npm:zod@3' } }),
    'h/fn-a/index.ts': `import { a } from '#shared/a.ts'\nimport { z } from 'zod'\nexport default [a, z]\n`,
    'h/fn-b/deno.jsonc': '{ // comentariu\n "imports": {} }\n',
    'h/fn-b/index.ts': `export default 1\n`,
    'h/_shared/a.ts': `export const a = 1\n`,
  })
  try {
    const g = await grafFunctie('h', 'fn-a', { cwd: root })
    assert.deepEqual(g.probleme, [])
    assert.deepEqual(g.intrari, ['h/_shared/a.ts', 'h/fn-a/deno.json', 'h/fn-a/index.ts'])
    assert.match((await grafFunctie('h', 'fn-b', { cwd: root })).probleme.join(' | '), /deno\.jsonc nu e citit/)
  } finally { await curata(root) }
})

test('data de referință: _shared prin alias, folderul fără teste, testul importat din cod se numără', async () => {
  const root = await arbore({
    'f/fn-a/deno.json': JSON.stringify({ imports: { '#shared/': '../_shared/' } }),
    'f/fn-a/index.ts': `import { a } from '#shared/a.ts'\nimport { fx } from './fixture_test.ts'\nexport default a + fx\n`,
    'f/fn-a/fixture_test.ts': `export const fx = 1\n`,
    'f/fn-b/index.ts': `export const x = 1\n`,
    'f/_shared/a.ts': `export const a = 1\n`,
  })
  const git = (args, data) => execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  const iso = (u) => new Date(u.commit).toISOString().slice(0, 10)
  try {
    git(['init', '-q'], '2026-01-01T00:00:00Z')
    git(['add', '.'], '2026-01-01T00:00:00Z')
    git(['commit', '-q', '-m', 'initial'], '2026-01-01T00:00:00Z')
    await writeFile(join(root, 'f/_shared/a.ts'), 'export const a = 2\n')
    git(['commit', '-q', '-am', 'doar _shared'], '2026-02-01T00:00:00Z')
    const a = await ultimaModificare('f', 'fn-a', { cwd: root })
    assert.deepEqual([iso(a), a.din, a.probleme], ['2026-02-01', 'f/_shared/a.ts', []], 'aliasul din deno.json „îmbătrânește” funcția odată cu _shared/a.ts')
    const b = await ultimaModificare('f', 'fn-b', { cwd: root })
    assert.deepEqual([iso(b), b.din], ['2026-01-01', null], 'fn-b nu importă a.ts — neatinsă')
    await writeFile(join(root, 'f/fn-a/index.ts'), `import { a } from '#shared/a.ts'\nimport { fx } from './fixture_test.ts'\nexport default a + fx // nou\n`)
    git(['commit', '-q', '-am', 'funcția'], '2026-03-01T00:00:00Z')
    const a2 = await ultimaModificare('f', 'fn-a', { cwd: root })
    assert.deepEqual([iso(a2), a2.din], ['2026-03-01', null], 'folderul propriu e mai nou: fără „prin …”')
    await mkdir(join(root, 'f/fn-a/sub'), { recursive: true })
    await writeFile(join(root, 'f/fn-a/index_test.ts'), 'Deno.test("x", () => {})\n')
    await writeFile(join(root, 'f/fn-a/sub/logic.test.js'), 'test("y", () => {})\n')
    git(['add', '.'], '2026-04-01T00:00:00Z')
    git(['commit', '-q', '-m', 'doar teste'], '2026-04-01T00:00:00Z')
    assert.equal(iso(await ultimaModificare('f', 'fn-a', { cwd: root })), '2026-03-01', 'un commit doar pe teste nu cere deploy')
    await writeFile(join(root, 'f/fn-a/fixture_test.ts'), 'export const fx = 2\n')
    git(['commit', '-q', '-am', 'fixture importată din cod'], '2026-05-01T00:00:00Z')
    const a4 = await ultimaModificare('f', 'fn-a', { cwd: root })
    assert.deepEqual([iso(a4), a4.din], ['2026-05-01', 'f/fn-a/fixture_test.ts'], 'un _test importat de cod intră în bundle — se numără')
    assert.equal(await ultimaModificare('f', 'fn-inexistenta', { cwd: root }), null)
  } finally { await curata(root) }
})

test('repo-ul real: toate funcțiile au graf demonstrabil; seap-import → tipDocument.mjs (cazul PR #641)', async () => {
  const DIR = 'supabase/functions'
  const slugs = (await readdir(DIR, { withFileTypes: true })).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name)
  assert.ok(slugs.length > 50, `doar ${slugs.length} funcții?`)
  for (const s of slugs) assert.deepEqual((await grafFunctie(DIR, s)).probleme, [], s)
  const din = async (s) => (await grafFunctie(DIR, s)).intrari.filter(f => !f.startsWith(`${DIR}/${s}/`))
  assert.deepEqual(await din('ofertare-seap-import'), [`${DIR}/_shared/identitateFisier.mjs`, `${DIR}/_shared/paginat.mjs`, `${DIR}/_shared/poartaOfertare.ts`, `${DIR}/_shared/semnaturaCms.mjs`, `${DIR}/_shared/tipDocument.mjs`, `${DIR}/_shared/zipFlux.mjs`])
  // var. B (07.10.2026): veghea desface semnătura cu aceeași regulă (o schimbare în semnaturaCms.mjs cere deploy și aici)
  // audit #21 (08.10.2026): inventarele se citesc pe pagini în ambele edge-uri (paginat.mjs)
  assert.deepEqual(await din('ofertare-seap-veghe'), [`${DIR}/_shared/oraRO.ts`, `${DIR}/_shared/paginat.mjs`, `${DIR}/_shared/semnaturaCms.mjs`, `${DIR}/_shared/tipDocument.mjs`])
  assert.ok((await din('ofertare-poarta-text')).includes(`${DIR}/_shared/ofertarePoartaText.mjs`))
})
