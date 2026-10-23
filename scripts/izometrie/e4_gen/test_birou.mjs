import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CAS_MESAJ, creeazaControlBirou, eroareBirou, declaratiiLot, cheiDecizii, descendenti, cerereAprobare, cerereDecizie, cerereIesire, cerereFront, cerereTranzitie, executaBirou, citestePagini } from '../../../src/lib/izoBirou.js'

let passed = 0
async function test(name, fn) { await fn(); console.log(`PASS ${name}`); passed++ }
const key = () => '00000000-0000-4000-8000-000000000001'
const row = (id, extra = {}) => ({ id, uid: `uid-${id}`, versiune: 2, updated_at: '2026-10-23T10:00:00.123456+00:00', stare: 'trimisa', ...extra })
const preview = { preverificare: { id: 4 }, amprenta: 'sha-preview', randuri: [1, 2, 3].map(id => ({ declaratie: row(id) })), decizii_cerute: ['corectie:1', 'corectie:2'], simulare: { ordine: [1, 2, 3] } }

await test('StrictMode/remontare: încărcarea veche nu blochează sau suprascrie noua generație', () => {
  const c = creeazaControlBirou()
  c.invalideaza()
  const first = c.incepe()
  assert.equal(c.incepe(), null) // click dublu în aceeași montare
  c.invalideaza() // cleanup
  c.invalideaza() // efectul remontat
  const second = c.incepe()
  assert.ok(second); assert.equal(first.actuala(), false)
  assert.equal(first.incheie(), false)
  assert.equal(c.incepe(), null) // răspunsul vechi nu deblochează operația nouă
  assert.equal(second.actuala(), true); assert.equal(second.incheie(), true)
  assert.ok(c.incepe())
})

await test('aprobare totală: perechi CAS exacte, fără conversie Date/pierdere microsecunde', async () => {
  const request = cerereAprobare(preview, [1, 2, 3], { 'corectie:1': 'marcaj corectat', 'corectie:2': 'măsurat de MP' }, key)
  const calls = []
  const data = await executaBirou(async (name, args) => { calls.push([name, args]); return { data: { cod: 'aprobata' } } }, request)
  assert.equal(data.cod, 'aprobata'); assert.equal(calls[0][0], 'fn_izo_aproba')
  assert.deepEqual(calls[0][1], { p_cheie: key(), p_preverificare: 4, p_randuri: [1, 2, 3].map(id => ({ declaratie_id: id, versiune: 2, updated_at: row(id).updated_at })), p_amprenta: 'sha-preview', p_decizii: { 'corectie:1': 'marcaj corectat', 'corectie:2': 'măsurat de MP' } })
})
await test('aprobare parțială: numai deciziile submulțimii, fără aprobare implicită a dependențelor', () => {
  const req = cerereAprobare(preview, [2], { 'corectie:1': 'nu trimite', 'corectie:2': 'accept măsurarea' }, key)
  assert.deepEqual(req.args.p_decizii, { 'corectie:2': 'accept măsurarea' }); assert.equal(req.args.p_randuri.length, 1)
  assert.deepEqual(cheiDecizii(preview, [3]), []); assert.equal(declaratiiLot(preview).length, 3)
})
await test('aprobarea refuză selecție goală, duplicate, lipsă CAS, motiv gol și rând în verificare', () => {
  for (const ids of [[], [3, 3], [3, '3'], [8]]) assert.throws(() => cerereAprobare(preview, ids, {}, key))
  assert.throws(() => cerereAprobare(preview, [1], {}, key), /Motivul/)
  assert.throws(() => cerereAprobare({ ...preview, randuri: [{ declaratie: row(1, { stare: 'in_verificare' }) }] }, [1], {}, key), /identificate/)
  assert.throws(() => cerereAprobare({ ...preview, randuri: [{ declaratie: row(3, { updated_at: null }) }] }, [3], {}, key), /versiunea/)
})
await test('CAS/preview schimbat: mesaj explicit și nicio reluare automată', async () => {
  for (const message of ['cas', 'preview_vechi', 'dependente_schimbate']) {
    let calls = 0
    try { await executaBirou(async () => { calls++; return { error: { message, code: 'P0001' } } }, { nume: 'fn', args: {} }); assert.fail() }
    catch (e) { assert.equal(eroareBirou(e), CAS_MESAJ) }
    assert.equal(calls, 1)
  }
  assert.match(eroareBirou({ message: 'fara_drept' }), /fara_drept/)
})
await test('închidere tranzitivă: uid + copii/surse, inclusiv alte sesiuni; fără rânduri finale', () => {
  const ds = [row(1), row(2, { bucata_decl_uid: 'child-1' }), row(3, { depinde_de_uid: 'uid-2', stare: 'conflict' }), row(4, { sursa_decl_uid: 'child-3' }), row(5, { depinde_de_uid: 'uid-1', stare: 'aprobata' }), row(6)]
  const children = [{ uid: 'child-1', declaratie_id: 1 }, { uid: 'child-3', declaratie_id: 3 }]
  assert.deepEqual(descendenti(ds[0], ds, children).map(d => d.id), [2, 3, 4])
  ds[0].depinde_de_uid = 'uid-4' // un ciclu nu produce buclă infinită în UI
  assert.equal(descendenti(ds[0], ds, children).length, 3)
})
await test('respingere: motiv + CAS + decizii explicite ale descendenților', () => {
  const req = cerereDecizie('respinge', row(1), 'măsurare greșită', { 2: 'blocheaza', 3: 'respinge' }, key)
  assert.equal(req.nume, 'fn_izo_respinge'); assert.deepEqual(req.args.p_dependente, { 2: 'blocheaza', 3: 'respinge' })
  assert.equal(req.args.p_updated_at, row(1).updated_at)
  assert.throws(() => cerereDecizie('respinge', row(1), 'motiv', { 2: '' }, key))
  assert.throws(() => cerereDecizie('respinge', row(1, { stare: 'aprobata' }), 'motiv', {}, key), /final/)
})
await test('revizie și serie lămurită folosesc semnăturile reale, fără parametri de cascadă la revizie', () => {
  const rev = cerereDecizie('revizie_cere', row(1), 'verifică seria', {}, key)
  assert.equal(rev.nume, 'fn_izo_revizie_cere'); assert.equal('p_dependente' in rev.args, false)
  const serie = cerereDecizie('serie_lamureste', row(1), 'seria identificată', { bucata: 71 }, key)
  assert.equal(serie.args.p_bucata, 71)
  assert.throws(() => cerereDecizie('serie_lamureste', row(1), 'motiv', { bucata: '' }, key))
})
await test('ieșire: timeout după commit -> retry cu aceeași cheie și payload; un singur fapt', async () => {
  const input = { depozit: 9, tronson: 18, bucati: [10, 11], aviz: ' CJPT 42 ', data: '2026-10-23' }
  const request = cerereIesire(input, key), saved = new Map(); let calls = 0, facts = 0
  input.bucati.push(12)
  const rpc = async (n, a) => {
    assert.equal(n, 'fn_izo_iesire_tronson'); calls++
    const hash = JSON.stringify(a)
    if (!saved.has(a.p_cheie)) { saved.set(a.p_cheie, hash); facts++ }
    assert.equal(saved.get(a.p_cheie), hash)
    if (calls === 1) throw Error('timeout după commit')
    return { data: { cod: 'iesit', eveniment_ids: [31, 32] } }
  }
  await assert.rejects(() => executaBirou(rpc, request), /timeout/)
  assert.equal((await executaBirou(rpc, request)).cod, 'iesit'); assert.equal(facts, 1)
  assert.deepEqual(request.args.p_bucati, [10, 11]); assert.equal(request.args.p_nr_aviz, 'CJPT 42')
})
await test('ieșirea fără aviz/tronson/selecție este oprită înainte de RPC', () => {
  const valid = { depozit: 9, tronson: 18, bucati: [10], aviz: 'CJPT', data: '2026-10-23' }
  for (const patch of [{ aviz: ' ' }, { aviz: 'AB' }, { aviz: 'A'.repeat(101) }, { tronson: null }, { bucati: [] }, { bucati: [null] }, { bucati: [10, 10] }, { bucati: Array.from({ length: 201 }, (_, i) => i + 1) }, { data: '' }]) assert.throws(() => cerereIesire({ ...valid, ...patch }, key))
})
await test('front și confirmare perete cer motiv și respectă contractul fără cheie inventată', async () => {
  assert.deepEqual(cerereFront(18, 'predare tabletă'), { nume: 'fn_izo_front_elibereaza', args: { p_tronson: 18, p_motiv: 'predare tabletă' } })
  assert.deepEqual(cerereTranzitie(17, 'perete verificat'), { nume: 'fn_izo_tranzitie_confirma', args: { p_sudura: 17, p_motiv: 'perete verificat' } })
  assert.throws(() => cerereFront(18, '')); assert.throws(() => cerereTranzitie(17, '  '))
  await assert.rejects(() => executaBirou(async () => ({ error: { message: 'fara_drept' } }), cerereFront(18, 'motiv')), e => e.message === 'fara_drept')
})
await test('paginare: 1201 rezervări/bucăți nu sunt tăiate la plafonul API', async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id }))
  const calls = []
  const result = await citestePagini(async (from, to) => { calls.push([from, to]); return { data: rows.slice(from, to + 1) } })
  assert.equal(result.length, 1201); assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499]])
  await assert.rejects(() => citestePagini(async () => ({ error: Error('acces refuzat') })), /acces refuzat/)
})
await test('erorile de business și lipsa răspunsului nu sunt afișate drept succes', async () => {
  await assert.rejects(() => executaBirou(async () => ({ data: { cod: 'conflict', motiv: 'r1d' } }), {}), /r1d/)
  await assert.rejects(() => executaBirou(async () => ({ data: null }), {}), /lipsă/)
})
await test('contracte offline: fiecare RPC din helper există în migrarea livrată', async () => {
  const sql = await readFile(new URL('../../../supabase/migrations/20261109b_izometrie_e4b_teren.sql', import.meta.url), 'utf8')
  const requests = [cerereAprobare(preview, [3], {}, key), cerereDecizie('respinge', row(1), 'motiv', {}, key), cerereDecizie('revizie_cere', row(1), 'motiv', {}, key), cerereDecizie('serie_lamureste', row(1), 'motiv', { bucata: 2 }, key), cerereIesire({ depozit: 9, tronson: 18, bucati: [1], aviz: 'CJPT', data: '2026-10-23' }, key), cerereFront(18, 'motiv'), cerereTranzitie(1, 'motiv')]
  for (const req of requests) {
    const signature = sql.match(new RegExp(`CREATE FUNCTION public\\.${req.nume}\\(([^)]*)\\)`))?.[1]
    assert.ok(signature, req.nume)
    assert.deepEqual(Object.keys(req.args).sort(), signature.split(',').map(x => x.trim().split(/\s+/)[0]).sort(), req.nume)
  }
})
console.log(`PASS birou: ${passed} scenarii`)
