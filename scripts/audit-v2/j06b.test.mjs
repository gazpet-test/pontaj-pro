import { it } from './test-api.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { retete } from './retete.js'
import { verificaPolitica, politicaFaza, incident } from './politica-p2.js'
import { verificaCerere } from './garda-p2.mjs'
import { hash, diffSnapshot, verificaDiff, snapshotStorage, verificaActor, citesteSupraveghere } from './supraveghere-p2.mjs'
import { deschideSerie } from './serie-p2.mjs'
import { incarcaJson } from './dovezi.mjs'
import { ruleaza } from './scenariu.mjs'
import { CDP } from './cdp.mjs'
import { ACTOR_TEST, completeazaDBSimulat, completeazaDriverSimulat, monitorSimulat } from './simulare-j06b.mjs'

const base = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'))
const temp = () => mkdtemp(join(fileURLToPath(new URL('./', import.meta.url)), 'j06b-test-'))
const none = politicaFaza('10_pachet', 'pachet_incomplet')
it('J06b: toate fazele au efect, idempotență și comportament de rerulare explicit în fixture și rețetă', () => {
  for (const f of [base, retete(base)]) for (const c of Object.values(f.scenarii)) for (const p of Object.values(c.faze)) {
    assert.ok(['none', 'db', 'storage', 'seap', 'email', 'webhook', 'cron', 'alta_licitatie'].includes(p.external_effect))
    assert.equal(typeof p.safe_rerun, 'boolean'); assert.ok(p.rerun_behavior)
  }
  assert.throws(() => verificaPolitica({ ...none, expected_tables: ['ofertare_licitatii'] }, []), /contrazic/)
})
for (const effect of ['seap', 'email', 'webhook', 'cron', 'alta_licitatie', 'necunoscut']) it(`J06b: apply refuză ${effect} înainte de DB/CDP`, async () => {
  const dir = await temp(); const oldExit = process.exitCode
  try {
    const f = structuredClone(base); f.scenarii['10_pachet'].faze.aprobare.external_effect = effect
    const path = join(dir, 'fixture.json'); await writeFile(path, JSON.stringify(f))
    let calls = 0
    const r = await ruleaza('10_pachet', ['--apply', '--faza', 'aprobare', '--fixture', path], {
      dir, db: { from() { calls++; throw Error() } }, conecteaza() { calls++; throw Error() } })
    assert.equal(calls, 0); assert.equal(r.verdict, 'UNDETERMINED'); assert.match(r.eroare, /external_effect=/)
  } finally { process.exitCode = oldExit; await rm(dir, { recursive: true, force: true }) }
})
const context = { apiUrl: 'https://test.supabase.co', accessToken: 'SIMULAT', phase: { external_effect: 'db', refuz_server: true } }
const request = { url: `${context.apiUrl}/rest/v1/ofertare_licitatii?id=eq.103`, method: 'PATCH', headers: { Authorization: 'Bearer SIMULAT' }, postData: '{"status":"depusa"}' }
it('J06b: gardă activă validează endpoint, actor, predicat și corp; refuză scope prin OR', () => {
  assert.equal(verificaCerere(request, context), true)
  for (const bad of [
    { url: request.url.replace('103', '5') }, { url: request.url + '&or=(id.eq.5)' },
    { url: request.url + '&id=eq.5' }, { postData: '{"status":"depusa","derogare_depunere":true}' },
    { headers: { Authorization: 'Bearer ALT_ACTOR' } }, { url: `${context.apiUrl}/rest/v1/rpc/trimite_email`, method: 'GET' },
    { url: `${context.apiUrl}/functions/v1/ofertare-acoperire`, method: 'POST' },
    { url: 'https://extern.test/webhook', method: 'GET' },
  ]) assert.throws(() => verificaCerere({ ...request, ...bad }, context), e => !!e.exitCode)
})
it('J06b: Storage refuză pt/103, alte licitații și upload fără contract; prefixul singur nu autorizează', () => {
  const req = { ...request, method: 'GET', url: `${context.apiUrl}/storage/v1/object/licitatii/103/a.pdf` }
  assert.equal(verificaCerere(req, context), true)
  for (const path of ['pt/103/a.pdf', '5/a.pdf', '103/%2e%2e/a.pdf']) assert.throws(() => verificaCerere({ ...req, url: `${context.apiUrl}/storage/v1/object/licitatii/${path}` }, context))
  assert.throws(() => verificaCerere({ ...req, method: 'POST' }, context), /contract/)
})
it('J06b: CDP oprește cererea înainte de continueRequest și păstrează incidentul', async () => {
  const c = new CDP({ addEventListener() {} }, 'mock')
  const sent = []; c.send = async (method, params) => sent.push({ method, params })
  await c.instaleazaGarda(context)
  await c.proceseazaCerere({ requestId: 'outside', request: { ...request, url: request.url.replace('103', '5') } })
  assert.deepEqual(sent.map(r => r.method), ['Fetch.enable', 'Fetch.failRequest'])
  assert.throws(() => c.verificaGarda(), e => e.exitCode === 22)
})
const monitored = (tables, storage = []) => ({ actor_id: ACTOR_TEST, inventory_id: 'test', complete: true, tables, storage })
const snap = (tables, globalTables = {}, storage = [], globalStorage = []) => ({ tabele: tables, storage, supraveghere: monitored(globalTables, globalStorage) })
it('J06b: diff integral găsește INSERT neașteptat, UPDATE vechi și DELETE; nu se rezumă la max(id)', () => {
  const old = snap({ manifest: [{ id: 1, v: 1 }, { id: 9, v: 1 }], audit: [] })
  const next = snap({ manifest: [{ id: 1, v: 2 }], audit: [{ id: 2 }] })
  const d = diffSnapshot(old, next)
  assert.equal(d.tables.manifest.updated[0].before.id, 1); assert.equal(d.tables.manifest.removed[0].id, 9)
  assert.equal(d.tables.audit.added.length, 1)
  assert.throws(() => verificaDiff(d, { ...none, expected_tables: ['manifest'] }), e => e.exitCode === 21 && /audit/.test(e.message))
})
it('J06b: inventarul global detectează alt tabel și scope 5, chiar dacă SELECT local nu vede rândul', () => {
  const before = snap({}, { ascuns: [] })
  const after = lic => snap({}, { ascuns: [{ id: 1, licitatie_id: lic, sha256: hash({ secret: 'never stored' }) }] })
  assert.throws(() => verificaDiff(diffSnapshot(before, after(103)), none), e => e.exitCode === 21)
  assert.throws(() => verificaDiff(diffSnapshot(before, after(5)), { ...none, expected_tables: ['ascuns'] }), e => e.exitCode === 22)
})
it('J06b: identitate/hash Storage schimbate sub același nume sunt efecte detectabile', () => {
  const a = { id: 'object', bucket_id: 'b', name: '103/a', updated_at: 'v1', eTag: 'e1', size: 3, sha256: hash('aaa') }
  const d = diffSnapshot(snap({}, {}, [a]), snap({}, {}, [{ ...a, updated_at: 'v2', sha256: hash('bbb') }]))
  assert.equal(d.storage.updated.length, 1)
  assert.throws(() => verificaDiff(d, none), e => e.exitCode === 21)
})
it('J06b: inventar/endpoint/gardă absente rămân UNDETERMINED explicit', async () => {
  await assert.rejects(citesteSupraveghere(null, { id: ACTOR_TEST }), /endpoint:.*supravegherea/)
  const m = await monitorSimulat()()
  await assert.rejects(citesteSupraveghere(async () => ({ ...m, complete: false }), { id: ACTOR_TEST }), /artifact:/)
  await assert.rejects(citesteSupraveghere(async () => ({ ...m, guard: null }), { id: ACTOR_TEST }), /garda server activă/)
})
it('J06b: snapshot Storage capturează id, updated_at, eTag, size și SHA256 din bytes, nu eTag ca hash', async () => {
  const row = { id: 'uuid', name: '103/test.pdf', bucket_id: 'b', updated_at: '2026-09-29', metadata: { eTag: 'etag', size: 3 } }
  const q = { select: () => q, like: () => q, order: () => q, range: async () => ({ data: [row] }) }
  const db = { schema: s => { assert.equal(s, 'storage'); return { from: t => { assert.equal(t, 'objects'); return q } } }, storage: { from: () => ({ download: async () => ({ data: new Blob(['abc']) }) }) } }
  const [r] = await snapshotStorage(db)
  assert.equal(r.id, 'uuid'); assert.equal(r.size, 3); assert.equal(r.eTag, 'etag')
  assert.equal(r.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  row.metadata.size = 4
  await assert.rejects(snapshotStorage(db), /size Storage diferit/)
})
it('J06b: actor owner este BLOCKED_BY_ROLE; schimbarea JWT este BYPASS', async () => {
  const db = completeazaDBSimulat({ from() {} })
  db.auth.getUser = async () => ({ data: { user: { id: 'alt-actor' } } })
  await assert.rejects(verificaActor(db, ACTOR_TEST), e => e.exitCode === 21)
  db.auth.getUser = async () => ({ data: { user: { id: ACTOR_TEST } } })
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: ACTOR_TEST, is_owner: true } }) }
  db.from = () => q
  await assert.rejects(verificaActor(db, ACTOR_TEST), e => e.verdict === 'BLOCKED_BY_ROLE')
})
it('J06b: T0 persistă cu hash; tentativa este înregistrată înainte de efect, rerun nesigur cere flag', async () => {
  const dir = await temp(); let s
  try {
    s = await deschideSerie(dir, ACTOR_TEST)
    await s.initial(snap({ manifest: [] })); await s.start('faza'); await s.close(); s = null
    const checksum = await readFile(join(dir, 'T0.sha256'), 'utf8'); assert.match(checksum, /^[a-f0-9]{64}$/)
    s = await deschideSerie(dir, ACTOR_TEST)
    const unsafe = politicaFaza('11_depunere', 'status_depusa')
    assert.throws(() => verificaPolitica(unsafe, ['--apply'], s.state.attempts.faza), /confirm-rerun/)
    assert.doesNotThrow(() => verificaPolitica(unsafe, ['--apply', '--confirm-rerun'], 1))
    assert.doesNotThrow(() => verificaPolitica(none, ['--apply'], 9))
    await writeFile(join(dir, 'T0.json'), '{}')
    await assert.rejects(s.initial(snap({})), /hash/)
  } finally { await s?.close(); await rm(dir, { recursive: true, force: true }) }
})

// Harness integral: trei faze existente, aceeași serie între procese simulate.
async function integration(mode, runAgain = false) {
  const dir = await temp(); const oldExit = process.exitCode
  const tables = { ofertare_licitatii: [{ id: 103, nr_anunt: base.nr_anunt }],
    ofertare_cerinte: Object.values(base.cerinte).filter(Number.isInteger).map(id => ({ id, licitatie_id: 103 })),
    extra: [] }
  const raw = { from(table) {
    let rows = tables[table] || []
    const result = data => ({ data: structuredClone(data) })
    const q = { select: () => q, order: () => q, limit: () => q,
      eq: (k, v) => { rows = rows.filter(r => r[k] === v); return q }, in: (k, v) => { rows = rows.filter(r => v.includes(r[k])); return q },
      not: k => { rows = rows.filter(r => r[k] != null); return q }, maybeSingle: async () => result(rows[0] || null), range: async (a, b) => result(rows.slice(a, b + 1)) }; return q
  } }
  let clicks = 0
  const f = structuredClone(base)
  const assertLic = { tip: 'exists', tabela: 'ofertare_licitatii', where: { id: 103 }, asteptat: { nr_anunt: base.nr_anunt } }
  f.scenarii['01_seap_documente'].faze = Object.fromEntries(['import_copie', 'inlocuire_acelasi_nume', 'document_lipsa'].map((n, i) => [n, {
    ...politicaFaza('01_seap_documente', n), actiuni: mode === 'divergenta' ? [{ tip: 'observa', selector: 'text=critic', asteptat: { disabled: true }, critic: true }]
      : [{ tip: 'click', selector: 'text=mutatie' }],
    postconditii: [mode === 'false_green' && i === 0 ? { ...assertLic, asteptat: { nr_anunt: 'imposibil' }, la_esec: 'FALSE_GREEN' } : assertLic],
    requires_owner: mode === 'owner',
    expected_tables: mode === 'cumulative' ? ['extra'] : [],
  }]))
  const driver = completeazaDriverSimulat({ evalueaza: async () => base.app_url, asteapta: async () => {}, captura: async () => {}, jurnal: () => [], inchide() {},
    observa: async () => ({ disabled: false }), async click() {
      clicks++
      if (mode === 'cumulative') tables.extra[0] = { id: 1, licitatie_id: 103, v: clicks }
      if (clicks === 1 && ['bypass', 'outside', 'partial_error'].includes(mode)) tables.extra.push({ id: 1, licitatie_id: mode === 'outside' ? 5 : 103 })
      if (mode === 'partial_error') throw Error('selector: final lipsă după mutație')
      if (mode === 'guard') { driver.guardError = incident('OUT_OF_SCOPE', 'DB: scope 5'); throw Error('selector: timeout') }
    } })
  try {
    const path = join(dir, 'fixture.json'); await writeFile(path, JSON.stringify(f))
    const deps = { dir, serieDir: join(dir, 'serie'), db: completeazaDBSimulat(raw), supraveghere: mode === 'missing_monitor' ? null : monitorSimulat(tables), conecteaza: async () => driver }
    const args = ['--apply', '--fixture', path]
    const first = await ruleaza('01_seap_documente', args, deps)
    const code = process.exitCode
    const beforeAgain = clicks
    const second = runAgain ? await ruleaza('01_seap_documente', args, deps) : null
    const state = await incarcaJson(deps.serieDir, 'serie').catch(() => null)
    const diffs = ['ok', 'cumulative'].includes(mode) ? await incarcaJson(dir, '2-inlocuire_acelasi_nume-diff') : null
    return { first, second, code, clicks, beforeAgain, state, diffs }
  } finally { process.exitCode = oldExit; await rm(dir, { recursive: true, force: true }) }
}
for (const [mode, code] of [['false_green', 20], ['bypass', 21], ['outside', 22], ['divergenta', 23], ['partial_error', 21], ['guard', 22]])
  it(`J06b runner: ${mode} oprește seria, salvează incidentul și nu pornește faza următoare`, async () => {
    const r = await integration(mode, true)
    assert.equal(r.code, code); assert.ok(r.beforeAgain <= 1); assert.equal(r.clicks, r.beforeAgain)
    assert.ok(r.state.stopped); assert.equal(r.second.exitCode, code)
  })
it('J06b runner: fiecare fază are diff față de T0 și precedenta; rerun nesigur se oprește înainte de click', async () => {
  const r = await integration('ok', true)
  assert.equal(r.first.verdict, 'MATCH'); assert.equal(r.clicks, 3)
  assert.equal(r.second.verdict, 'UNDETERMINED'); assert.match(r.second.eroare, /confirm-rerun/)
  assert.equal(r.state.completed.length, 3); assert.ok(r.diffs.fata_de_T0); assert.ok(r.diffs.fata_de_precedenta)
})
it('J06b runner: owner necesar nu schimbă actorul; lipsa monitorului blochează înainte de UI', async () => {
  const owner = await integration('owner'); assert.equal(owner.first.verdict, 'BLOCKED_BY_ROLE'); assert.equal(owner.clicks, 0)
  const missing = await integration('missing_monitor'); assert.equal(missing.first.verdict, 'UNDETERMINED'); assert.equal(missing.clicks, 0)
  assert.match(missing.first.eroare, /endpoint:.*supravegherea/)
})
it('J06b runner: la faza a doua, diff T0 vede INSERT, iar diff precedent vede UPDATE pe același rând', async () => {
  const r = await integration('cumulative')
  assert.equal(r.first.verdict, 'MATCH')
  assert.equal(r.diffs.fata_de_T0.global.tables.extra.added.length, 1)
  assert.equal(r.diffs.fata_de_precedenta.global.tables.extra.added.length, 0)
  assert.equal(r.diffs.fata_de_precedenta.global.tables.extra.updated.length, 1)
})
