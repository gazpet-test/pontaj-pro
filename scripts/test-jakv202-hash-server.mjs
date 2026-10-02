import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hashStream, verificaFisier, snapshotIdentic, ROLURI_DOVEDIT, MAX_BYTES } from '../supabase/functions/ofertare-pachet-verifica/verificare.mjs'
import { creeazaHandler } from '../supabase/functions/ofertare-pachet-verifica/index.ts'

const bytes = new TextEncoder().encode('abc')
const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const f = { id: 7, nume: 'oferta.pdf', rol: 'depus_final', fisier_path: 'pt/1/v1/oferta.pdf', sha256: sha }
const obj = { id: '00000000-0000-4000-8000-000000000007', bucket_id: 'ofertare', name: f.fisier_path,
  updated_at: '2026-09-29T10:00:00.000001Z', metadata: { eTag: 'etag-abc', size: 3 } }
const stream = chunks => new ReadableStream({ start(c) { for (const b of chunks) c.enqueue(b); c.close() } })
const deps = (a = obj, b = a, content = bytes) => {
  let reads = 0, downloads = 0
  return { snapshot: async () => structuredClone(++reads === 1 ? a : b),
    download: async () => { downloads++; return new Response(stream([content.subarray(0, 1), content.subarray(1)])) },
    counts: () => ({ reads, downloads }) }
}
test('SHA-256 streaming: vector cunoscut abc, chunk-uri, fișier mare', async () => {
  assert.equal((await hashStream(stream([...bytes].map(b => new Uint8Array([b]))))).sha256, sha)
  const chunk = new Uint8Array(64 * 1024).fill(97)
  const expected = createHash('sha256'); for (let i = 0; i < 50; i++) expected.update(chunk)
  const result = await hashStream(stream(Array(50).fill(chunk)))
  assert.equal(result.sha256, expected.digest('hex'))
  assert.equal(result.size, 50 * chunk.length)
  assert.equal(MAX_BYTES, 32 * 1024 * 1024)
})
test('obiect curent + SHA identic => PASS, actor și snapshot exacte', async () => {
  const d = deps(), r = await verificaFisier(f, 'actor', d)
  assert.equal(r.rezultat, 'PASS'); assert.equal(r.verificat_de, 'actor')
  assert.equal(r.obj_updated_at, obj.updated_at); assert.equal(r.obj_id, obj.id)
  assert.equal(r.sha256_calculat, sha); assert.equal(r.obj_size, 3)
  assert.deepEqual(d.counts(), { reads: 2, downloads: 1 })
})
test('obiect inexistent => REFUZ serializabil în coloanele NOT NULL', async () => {
  const d = deps(null), r = await verificaFisier(f, 'actor', d)
  assert.equal(r.rezultat, 'REFUZ'); assert.match(r.motiv, /inexistent/)
  assert.equal(r.obj_id, '00000000-0000-0000-0000-000000000000')
  assert.match(r.sha256_calculat, /^[0-9a-f]{64}$/); assert.equal(d.counts().downloads, 0)
})
for (const size of [0, null, -1, 'x', MAX_BYTES + 1]) {
  test(`metadata size=${size}: REFUZ înainte de download`, async () => {
    const d = deps({ ...obj, metadata: { size } }), r = await verificaFisier(f, 'actor', d)
    assert.equal(r.rezultat, 'REFUZ'); assert.equal(d.counts().downloads, 0)
    if (size > MAX_BYTES) assert.equal(r.motiv, 'prea mare, worker Terra')
  })
}
test('SHA diferit de manifest => REFUZ cu hash efectiv calculat', async () => {
  const r = await verificaFisier({ ...f, sha256: 'a'.repeat(64) }, 'actor', deps())
  assert.equal(r.rezultat, 'REFUZ'); assert.match(r.motiv, /SHA-256 diferit/); assert.equal(r.sha256_calculat, sha)
})
for (const change of [null, { ...obj, id: 'alt-id' }, { ...obj, updated_at: '2026-09-29T10:00:00.000002Z' },
  { ...obj, name: 'alt.pdf' }, { ...obj, bucket_id: 'alt' }, { ...obj, metadata: { ...obj.metadata, eTag: 'nou' } },
  { ...obj, metadata: { size: 4 } }]) {
  test(`snapshot pre/post diferit: ${JSON.stringify(change)} => REFUZ`, async () => {
    const r = await verificaFisier(f, 'actor', deps(obj, change))
    assert.equal(r.rezultat, 'REFUZ'); assert.equal(r.motiv, 'obiect schimbat în timpul verificării')
  })
}
test('eTag absent de ambele părți permis; dispariția lui refuzată', () => {
  const a = { ...obj, metadata: { size: 3 } }
  assert.equal(snapshotIdentic(a, structuredClone(a)), true)
  assert.equal(snapshotIdentic(obj, a), false)
})
for (const path of [null, '', ' ', '../secret', '/alt', 'pt/../alt', 'pt\\alt', 'pt//alt']) {
  test(`cale invalidă ${path}: fără acces Storage`, async () => {
    const d = deps(), r = await verificaFisier({ ...f, fisier_path: path }, 'actor', d)
    assert.equal(r.rezultat, 'REFUZ'); assert.deepEqual(d.counts(), { reads: 0, downloads: 0 })
  })
}
test('snapshot din alt bucket nu produce download', async () => {
  const d = deps({ ...obj, bucket_id: 'alt' }), r = await verificaFisier(f, 'actor', d)
  assert.equal(r.rezultat, 'REFUZ'); assert.equal(d.counts().downloads, 0)
})
test('stream gol / trunchiat => REFUZ', async () => {
  for (const content of [new Uint8Array(), bytes.subarray(0, 2)]) {
    const r = await verificaFisier(f, 'actor', deps(obj, obj, content))
    assert.equal(r.rezultat, 'REFUZ'); assert.match(r.motiv, /gol|dimensiunea/)
  }
})
test('stream peste limită, chiar dacă metadata minte: anulat și REFUZ', async () => {
  let cancelled = false
  const r = await verificaFisier(f, 'actor', { ...deps(), maxBytes: 3,
    download: async () => new Response(new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(4)) }, cancel() { cancelled = true },
    })) })
  assert.equal(r.rezultat, 'REFUZ'); assert.equal(r.motiv, 'prea mare, worker Terra'); assert.equal(cancelled, true)
})
test('HTTP refuzat / eroare snapshot / stream întrerupt => rezultat REFUZ, fără throw', async () => {
  for (const extra of [
    { download: async () => new Response('error', { status: 404 }) },
    { snapshot: async () => { throw new Error('rpc down') } },
    { download: async () => new Response(new ReadableStream({ start(c) { c.error(new Error('down')) } })) },
  ]) assert.equal((await verificaFisier(f, 'actor', { ...deps(), ...extra })).rezultat, 'REFUZ')
})
test('peste limită: eroarea anulării streamului nu pierde motivul worker Terra', async () => {
  const r = await verificaFisier(f, 'actor', { ...deps(), maxBytes: 3,
    download: async () => new Response(new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(4)) }, cancel() { throw new Error('cancel failed') },
    })) })
  assert.equal(r.rezultat, 'REFUZ'); assert.equal(r.motiv, 'prea mare, worker Terra')
})
test('același nume, bytes diferiți: fiecare are propria identitate și hash', async () => {
  const other = new TextEncoder().encode('xyz'), shaOther = createHash('sha256').update(other).digest('hex')
  const o2 = { ...obj, id: '00000000-0000-4000-8000-000000000008', name: 'pt/2/v1/oferta.pdf' }
  const f2 = { ...f, id: 8, fisier_path: o2.name, sha256: shaOther }
  const a = await verificaFisier(f, 'actor', deps()), b = await verificaFisier(f2, 'actor', deps(o2, o2, other))
  assert.equal(a.rezultat, 'PASS'); assert.equal(b.rezultat, 'PASS')
  assert.notEqual(a.obj_id, b.obj_id); assert.notEqual(a.sha256_calculat, b.sha256_calculat)
  assert.equal((await verificaFisier({ ...f2, sha256: sha }, 'actor', deps(o2, o2, other))).rezultat, 'REFUZ')
})

function handlerFixture({ user = 'actor', acces = true, rpcError = false, rows = [f, { ...f, id: 8, rol: 'dovada_seap' }],
  insertError = false, storageObject = obj } = {}) {
  const saved = [], calls = [], ranges = []
  const db = {
    from(table) {
      calls.push(table)
      return {
        select() { return this }, eq() { return this }, in() { return this }, order() { return this },
        maybeSingle: async () => ({ data: { id: 1, stare: 'aprobat' } }),
        range: async (a, b) => { ranges.push([a, b]); return { data: rows.slice(a, b + 1) } },
        insert: async row => { if (!insertError) saved.push(row); return { error: insertError } },
      }
    },
    rpc: async name => { assert.equal(name, 'ofertare_pt_fisier_snapshot'); return { data: storageObject } },
  }
  const handler = creeazaHandler({
    poarta: { env: () => 'local', createClient: () => ({
      auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
      rpc: async () => ({ data: acces, error: rpcError }),
    }) },
    service: async () => { calls.push('service'); return db },
    download: async () => new Response(bytes),
  })
  return { handler, saved, calls, ranges }
}
const request = body => new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer test' }, body })
for (const [options, status] of [[{ user: null }, 401], [{ acces: false }, 403], [{ rpcError: true }, 403]]) {
  test(`poartă ${status} înainte de body invalid și service_role`, async () => {
    const h = handlerFixture(options), req = request('{invalid')
    assert.equal((await h.handler(req)).status, status); assert.equal(req.bodyUsed, false); assert.deepEqual(h.calls, [])
  })
}
test('body invalid / id invalid: fără client service', async () => {
  for (const body of ['{', '{}', '{"pachet_id":-1}', '{"pachet_id":"1"}', '{"pachet_id":1.1}']) {
    const h = handlerFixture(); assert.equal((await h.handler(request(body))).status, 400); assert.deepEqual(h.calls, [])
  }
})
test('handler: toate PASS => ok, audit per fișier și actor verificat', async () => {
  const h = handlerFixture(), r = await h.handler(request('{"pachet_id":1}')), data = await r.json()
  assert.equal(r.status, 200); assert.equal(data.ok, true); assert.equal(h.saved.length, 2)
  assert.ok(h.saved.every(r => r.rezultat === 'PASS' && r.verificat_de === 'actor'))
  assert.ok(!h.calls.includes('storage.objects'))
})
test('handler: REFUZ business salvat per fișier și returnat în 200 ok=false', async () => {
  const h = handlerFixture({ storageObject: null }), r = await h.handler(request('{"pachet_id":1}')), data = await r.json()
  assert.equal(r.status, 200); assert.equal(data.ok, false); assert.equal(h.saved.length, 2)
  assert.ok(h.saved.every(r => r.rezultat === 'REFUZ')); assert.equal(data.verificari.length, 2)
})
test('handler: audit nesalvat => 503, fără ok favorabil', async () => {
  const h = handlerFixture({ insertError: true }), r = await h.handler(request('{"pachet_id":1}'))
  assert.equal(r.status, 503); assert.equal((await r.json()).ok, false); assert.equal(h.saved.length, 0)
})
test('handler: roluri lipsă / manifest gol nu dau verde', async () => {
  for (const rows of [[], [f]]) {
    const h = handlerFixture({ rows }), data = await (await h.handler(request('{"pachet_id":1}'))).json()
    assert.equal(data.ok, false); assert.match(data.error, /Lipsesc/)
  }
})
test('handler: 501 fișiere, ultimul refuzat, nu se pierde la paginare', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ ...f, id: i + 1, rol: i === 0 ? 'dovada_seap' : 'depus_final', sha256: i === 500 ? 'a'.repeat(64) : sha }))
  const h = handlerFixture({ rows }), data = await (await h.handler(request('{"pachet_id":1}'))).json()
  assert.equal(data.ok, false); assert.equal(h.saved.length, 501); assert.equal(data.verificari[500].rezultat, 'REFUZ')
  assert.deepEqual(h.ranges, [[0,499], [500,999]])
})
test('paritate SQL↔edge↔rolurile produse de UI; verificarea precede update depus', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260930a_ofertare_pachet_hash_server_jakv202.sql', import.meta.url), 'utf8')
  const list = sql.match(/SELECT p_rol IN \(([^)]+)\)/)[1].match(/'[^']+'/g).map(s => s.slice(1,-1))
  assert.deepEqual(list, ROLURI_DOVEDIT)
  const ui = readFileSync(new URL('../src/OfertarePropunere.jsx', import.meta.url), 'utf8')
  const aprobare = ui.slice(ui.indexOf('const aprobaPachet ='), ui.indexOf('const inregistreazaDepunere ='))
  const depunere = ui.slice(ui.indexOf('const inregistreazaDepunere ='), ui.indexOf('const atribuie ='))
  const produse = [...aprobare.matchAll(/rol:\s*'([^']+)'/g), ...depunere.matchAll(/await urca\([^,]+,\s*'([^']+)'\)/g)].map(m => m[1])
  assert.deepEqual(produse.sort(), [...ROLURI_DOVEDIT].sort())
  const invoke = ui.indexOf("invoke('ofertare-pachet-verifica'")
  const guard = ui.indexOf('verificare?.ok !== true', invoke)
  const update = ui.indexOf("update({ stare: 'depus' })", invoke)
  assert.ok(invoke > 0 && guard > invoke && update > guard)
  assert.ok(ui.includes('refuzuri.map('))
})
