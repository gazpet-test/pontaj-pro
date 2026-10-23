import assert from 'node:assert/strict'
import { adaugaOperatii, aplicaRaspuns, creeazaCoada, memorie, stareInitiala, stocareBrowser, urmatorulLot } from '../../../src/lib/izoCoada.js'
import { capeteLocale, copiiLocali, codSudura, construiesteDeclaratii, propunereSudura, randuriSesiune, sesiuneLocala, ziBucuresti } from '../../../src/lib/izoTeren.js'

let nr = 0, passed = 0
const id = () => `00000000-0000-4000-8000-${String(++nr).padStart(12, '0')}`
const request = (tronson = 18, extra = {}) => ({ tip_op: 'decl_salveaza', payload: { proiect_id: 3, tronson_id: tronson, uid: id(), ...extra } })
async function test(name, f) { await f(); passed++; console.log(`PASS ${name}`) }

await test('UUID, seq, copie payload, stări și limită 50 / un singur tronson', () => {
  const p = request(), initial = stareInitiala(id())
  let s = adaugaOperatii(initial, [p, ...Array.from({ length: 55 }, () => request()), request(19)], id)
  p.payload.uid = 'modificat'
  assert.notEqual(s.ops[0].cerere.payload.uid, 'modificat')
  assert.equal(initial.seq, 0); assert.equal(s.seq, 57)
  assert.equal(urmatorulLot(s).length, 50)
  assert.equal(new Set(s.ops.map(x => x.cerere.op_id)).size, 57)
  s.ops.splice(0, 55)
  assert.equal(urmatorulLot(s).length, 1)
})

await test('ACK final pentru fiecare cod, duplicat păstrează rezultatul original', () => {
  for (const cod of ['acceptat', 'conflict', 'eroare', 'eroare_interna', 'conflict_op']) {
    for (const duplicate of [false, true]) {
      const s = adaugaOperatii(stareInitiala(id()), [request()], id), lot = urmatorulLot(s)
      const result = { cod, motiv: 'caz' }
      const r = aplicaRaspuns(s, lot, { rezultate: [{ op_id: lot[0].op_id, ...(duplicate ? { cod: 'duplicat', raspuns: result } : result) }] })
      assert.equal(r.ops.length, 0); assert.equal(r.arhiva.length, 1)
      assert.equal(r.arhiva[0].rezultat.cod, cod)
      assert.equal(r.arhiva[0].de_verificat, cod !== 'acceptat')
      assert.equal(s.ops.length, 1)
    }
  }
})

await test('acceptat cu stare conflict R1d rămâne de verificat', () => {
  const s = adaugaOperatii(stareInitiala(id()), [request()], id), lot = urmatorulLot(s)
  const r = aplicaRaspuns(s, lot, { rezultate: [{ op_id: lot[0].op_id, cod: 'acceptat', stare: 'conflict', conflict_cod: 'r1d' }] })
  assert.equal(r.arhiva[0].de_verificat, true)
})

await test('nefinale și cod necunoscut păstrează exact cererea; răspuns absent nu e ACK', () => {
  for (const cod of ['reincearca', 'blocat_de_conflict', 'fara_drept', 'front_expirat', 'limita', 'alt_dispozitiv', 'viitor']) {
    const s = adaugaOperatii(stareInitiala(id()), [request()], id), lot = urmatorulLot(s)
    for (const reply of [{ cod }, { cod: 'ok', rezultate: [{ op_id: lot[0].op_id, cod }] }, { cod: 'ok', rezultate: [] }]) {
      const r = aplicaRaspuns(s, lot, reply)
      assert.deepEqual(r.ops[0].cerere, lot[0]); assert.equal(r.arhiva.length, 0)
    }
  }
})

await test('răspuns parțial și reincearca lasă restul în coadă', () => {
  const s = adaugaOperatii(stareInitiala(id()), [request(), request(), request()], id), lot = urmatorulLot(s)
  const r = aplicaRaspuns(s, lot, { cod: 'ok', rezultate: [{ op_id: lot[0].op_id, cod: 'acceptat' }, { op_id: lot[1].op_id, cod: 'reincearca' }] })
  assert.equal(r.arhiva.length, 1); assert.deepEqual(r.ops.map(o => o.cerere), lot.slice(1))
})

await test('crash după trimitere / ACK pierdut: restart retrimite identic, duplicat este durabil', async () => {
  const storage = memorie(), calls = []
  let fail = true, refresh = 0
  const rpc = async (_name, args) => {
    calls.push(args)
    assert.equal((await storage.read()).ops[0].stare, 'trimisa')
    if (fail) throw Error('ACK pierdut')
    return { data: { cod: 'ok', rezultate: args.p_ops.map(o => ({ op_id: o.op_id, cod: 'duplicat', raspuns: { cod: 'acceptat', versiune: 1 } })) } }
  }
  let q = creeazaCoada({ storage, rpc, id, refresh: async () => { refresh++ } })
  const before = await q.adauga([request()])
  await assert.rejects(q.sync(), /ACK pierdut/)
  q = creeazaCoada({ storage, rpc, id }); fail = false
  const after = await q.sync()
  assert.deepEqual(calls[0], calls[1]); assert.equal(after.device, before.device)
  assert.equal(after.seq, before.seq); assert.equal(after.ops.length, 0)
  assert.equal((await storage.read()).arhiva.length, 1); assert.equal(refresh, 1)
})

await test('échec ACK storage: nicio confirmare locală falsă; retry identic', async () => {
  const base = memorie(); let writes = 0
  const storage = { ...base, write: async s => { writes++; if (writes === 3) throw Error('disc plin'); return base.write(s) } }
  const q = creeazaCoada({ storage, id, rpc: async (_n, a) => ({ data: { rezultate: a.p_ops.map(o => ({ op_id: o.op_id, cod: 'acceptat' })) } }) })
  await q.adauga([request()]); await assert.rejects(q.sync(), /disc plin/)
  assert.equal((await base.read()).ops[0].stare, 'trimisa')
  assert.equal((await q.sync()).ops.length, 0)
})

await test('snapshot atomic nu atinge coada; alt_dispozitiv se reia numai după Pregătește', async () => {
  const storage = memorie(), q = creeazaCoada({ storage, id, rpc: async (n, a) => ({ data: n === 'fn_izo_sync_push' ? { cod: 'alt_dispozitiv' } : { snapshot_id: id(), checksum: 'abc', proiect_id: a.p_proiect, tronson_id: a.p_tronson, frunze: [] } }) })
  await q.adauga([request()]); const paused = await q.sync()
  assert.equal(paused.pauza, 'alt_dispozitiv'); assert.equal(urmatorulLot(paused).length, 0)
  const read = await q.snapshot(3, 18); assert.equal(read.pauza, 'alt_dispozitiv')
  const prepared = await q.snapshot(3, 18, true)
  assert.equal(prepared.pauza, null); assert.deepEqual(prepared.ops, paused.ops)
})

await test('supabase error nu produce ACK; refresh e obligatoriu înainte de push', async () => {
  let calls = 0
  const storage = memorie(), q = creeazaCoada({ storage, id, refresh: async () => { throw Error('expirat') }, rpc: async () => { calls++; return { error: { message: 'interzis' } } } })
  await q.adauga([request()]); await assert.rejects(q.sync(), /expirat/)
  assert.equal(calls, 0); assert.equal((await storage.read()).ops[0].stare, 'pe_tableta')
  const q2 = creeazaCoada({ storage, id, rpc: async () => ({ error: { message: 'interzis' } }) })
  await assert.rejects(q2.sync(), /interzis/); assert.equal((await storage.read()).arhiva.length, 0)
})

await test('adăugări concurente și profiluri separate', async () => {
  const a = creeazaCoada({ storage: memorie(), id }), b = creeazaCoada({ storage: memorie(), id })
  await Promise.all([a.adauga([request()]), a.adauga([request()]), a.adauga([request()])])
  assert.deepEqual((await a.citeste()).ops.map(x => x.cerere.seq), [1, 2, 3])
  assert.equal((await b.citeste()).ops.length, 0)
})

await test('fallback memorie fără IndexedDB; retragere exclusiv înainte de trimitere', async () => {
  const storage = await stocareBrowser('node-test'); assert.equal(storage.durabil, false)
  const q = creeazaCoada({ storage, id, rpc: async () => { throw Error('offline') } })
  let s = await q.adauga([request()]); s = await q.retrage(s.ops[0].cerere.op_id); assert.equal(s.ops.length, 0)
  s = await q.adauga([request()]); await assert.rejects(q.sync(), /offline/)
  await assert.rejects(q.retrage(s.ops[0].cerere.op_id), /deja/)
})

await test('zi București, normalizare strictă și tronson nepotrivit', () => {
  assert.equal(ziBucuresti(new Date('2026-10-23T21:30:00Z')), '2026-10-24')
  assert.deepEqual(codSudura('tr14s007', 'T14', {}), { nr: 7, sufix: '' })
  assert.throws(() => codSudura('TR15S7', 'T14', {})); assert.throws(() => codSudura('TR14S7R', 'T14', {}))
})

await test('tăiere + montaj copil atomic, geometrie exactă, R1d blochează surorile', async () => {
  const piesa = { id: 51, lungime_mm: 12000, serie_canon: 'S1', sarja: 'H1' }
  const args = { baza: { proiect_id: 3, tronson_id: 18, preverificare_uid: id() }, tip: 'taiere', piesa, confirmata: true, cm: 0, taiereMm: 8000, capat: 'A', snapshot: { frunze: [piesa] }, id }
  const ops = construiesteDeclaratii(args)
  assert.equal(ops.length, 2); assert.equal(ops[0].payload.copii.reduce((a, c) => a + c.lungime_mm, 0), 12000)
  assert.equal(ops[1].payload.depinde_de_uid, ops[0].payload.uid)
  assert.equal(ops[1].payload.bucata.decl_uid, ops[0].payload.copii[0].uid)
  assert.equal(ops[0].payload.copii[1].destinatie, 'depozit')
  assert.throws(() => construiesteDeclaratii({ ...args, confirmata: false }))
  assert.throws(() => construiesteDeclaratii({ ...args, taiereMm: 6000 }), /identici/)
  assert.throws(() => construiesteDeclaratii({ ...args, taiereMm: 12000 }))
  const s = adaugaOperatii(stareInitiala(id()), ops, id)
  assert.deepEqual(randuriSesiune(s, { uid: args.baza.preverificare_uid }, {}), ops.map(o => ({ uid: o.payload.uid, versiune: 1 })))
})

await test('sesiune restaurată și trimitere offline cu versiunile declarate', () => {
  const uid = id(), open = { tip_op: 'sesiune_deschide', payload: { proiect_id: 3, tronson_id: 18, uid, zi: '2026-10-23' } }
  const s = adaugaOperatii(stareInitiala(id()), [open, request(18, { preverificare_uid: uid, versiune_baza: 0 })], id)
  const session = sesiuneLocala(s, 18)
  assert.equal(session.uid, uid); assert.equal(session.trimisa, false)
  const rows = randuriSesiune(s, session, {})
  assert.equal(rows.length, 1); assert.equal(rows[0].versiune, 1)
  const submitted = adaugaOperatii(s, [{ tip_op: 'sesiune_trimite', payload: { proiect_id: 3, tronson_id: 18, preverificare_uid: uid, randuri: rows } }], id)
  assert.equal(sesiuneLocala(submitted, 18).trimisa, true)
})

await test('montaje locale consecutive și capete copil; fără a aștepta aprobarea', () => {
  const uid = id(), root = { id: 51, serie: 'S1', lungime_mm: 12000 }
  const s = adaugaOperatii(stareInitiala(id()), [request(18, { preverificare_uid: uid, tip: 'montaj', bucata: { bucata_id: 51 }, lungime_montata_mm: 12000 })], id)
  const ends = capeteLocale(s, { frunze: [root] }, { uid })
  assert.equal(ends.length, 1); assert.deepEqual(ends[0].ref, { bucata_id: 51 })
  const ops = construiesteDeclaratii({ baza: { proiect_id: 3, tronson_id: 18, preverificare_uid: uid }, tip: 'montaj', piesa: { id: 52, lungime_mm: 12000 }, confirmata: true, cm: 0, capat: 'A', amonte: { ...ends[0].ref, tip: 'bucata', capat: 'B' }, sudura: { nr: 7, sufix: '' }, id })
  assert.equal(ops[0].payload.amonte.bucata_id, 51); assert.equal(ops[0].payload.sudura.nr, 7)
  assert.equal(capeteLocale(s, { frunze: [root], tombstone: [{ id: 51 }] }, { uid }).length, 0)
})

await test('tăiere capăt liber: rest depozit, ramane_montat și refuz cu două capete sudate', () => {
  const piesa = { id: 51, lungime_mm: 12000, serie_canon: 'S1', sarja: 'H1' }
  const args = { baza: { proiect_id: 3, tronson_id: 18, preverificare_uid: id() }, tip: 'taiere_libera', piesa, confirmata: true, cm: 0, taiereMm: 8000, snapshot: { frunze: [piesa], suduri: [{ stare: 'aprobata', capete: [{ bucata_id: 51, capat_litera: 'B', activ: true }] }] }, id }
  const ops = construiesteDeclaratii({ ...args, ramane: 'dreapta' })
  assert.equal(ops.length, 1); assert.equal(ops[0].payload.copii[0].destinatie, 'depozit')
  assert.equal(ops[0].payload.copii[1].destinatie, 'ramane_montat')
  assert.throws(() => construiesteDeclaratii({ ...args, snapshot: { ...args.snapshot, suduri: [...args.snapshot.suduri, ...args.snapshot.suduri] } }), /exact un/)
})

await test('R1d include copiii încă nesincronizați ai altei tăieri', () => {
  const piesa = { id: 51, lungime_mm: 12000, serie_canon: 'S1', sarja: 'H1' }, other = { ...piesa, id: 52, lungime_mm: 13000 }
  const snapshot = { tronson_id: 18, frunze: [piesa, other] }
  const s = adaugaOperatii(stareInitiala(id()), [request(18, { tip: 'taiere', sursa: { bucata_id: 52 }, copii: [{ uid: id(), lungime_mm: 8000 }] })], id)
  const localCopii = copiiLocali(s, snapshot)
  assert.equal(localCopii.length, 1)
  assert.throws(() => construiesteDeclaratii({ baza: {}, tip: 'taiere', piesa, confirmata: true, cm: 0, taiereMm: 8000, snapshot, localCopii, id }), /identice/)
})

await test('cuplare cere două piese și cod, transmisie cu două capete', () => {
  const args = { baza: { proiect_id: 3, tronson_id: 18 }, tip: 'cuplare', piesa: { bucata_id: 51, capat: 'B' }, amonte: { bucata_id: 52, capat: 'A' }, sudura: { nr: 8, sufix: '' }, id }
  const [op] = construiesteDeclaratii(args)
  assert.equal(op.payload.tip, 'cuplare'); assert.deepEqual(op.payload.capat1, args.amonte)
  assert.deepEqual(op.payload.capat2, args.piesa)
  assert.throws(() => construiesteDeclaratii({ ...args, amonte: null }))
  assert.throws(() => construiesteDeclaratii({ ...args, sudura: null }))
  assert.throws(() => construiesteDeclaratii({ ...args, amonte: { bucata_id: 51, capat: 'A' } }))
})

await test('limita în bytes și eroarea de lot nu pierd operații', () => {
  assert.throws(() => adaugaOperatii(stareInitiala(id()), [request(18, { serie_bruta: 'a'.repeat(221000) })], id), /limita/)
  const s = adaugaOperatii(stareInitiala(id()), [request()], id), lot = urmatorulLot(s)
  const r = aplicaRaspuns(s, lot, { cod: 'eroare', motiv: 'lot_format' })
  assert.equal(r.ops.length, 1); assert.equal(r.arhiva.length, 0); assert.equal(r.pauza, 'eroare_lot')
})

await test('blocare comună serializează două instanțe pe același dispozitiv', async () => {
  const storage = memorie(); let tail = Promise.resolve()
  const lock = f => { const result = tail.then(f); tail = result.catch(() => {}); return result }
  const a = creeazaCoada({ storage, id, lock }), b = creeazaCoada({ storage, id, lock })
  await Promise.all([a.adauga([request()]), b.adauga([request()])])
  const s = await a.citeste()
  assert.deepEqual(s.ops.map(o => o.cerere.seq), [1, 2]); assert.equal((await b.citeste()).device, s.device)
})

await test('propunerea sudurii ține cont de coadă și sens, fără zerouri', () => {
  const s = adaugaOperatii(stareInitiala(id()), [request(18, { sudura: { nr: 7, sufix: '' } })], id)
  assert.equal(propunereSudura(s, { tronson_id: 18, numar_urmator: 7, config: {} }, 'T14'), 'TR14S8')
  assert.equal(propunereSudura(s, { tronson_id: 18, numar_urmator: 8, config: { sens_numerotare: 'descrescator' } }, 'T14'), 'TR14S6')
  assert.equal(propunereSudura(s, { tronson_id: 18, numar_urmator: null }, 'T14'), '')
})

await test('trimiterea refuză conflicte cunoscute și rezervare pierdută', () => {
  const uid = id(), s = adaugaOperatii(stareInitiala(id()), [request(18, { preverificare_uid: uid, versiune_baza: 0 })], id)
  s.ops[0].rezultat = { cod: 'blocat_de_conflict' }
  assert.throws(() => randuriSesiune(s, { uid }, {}), /verificat/)
  assert.throws(() => randuriSesiune(stareInitiala(id()), { uid, id: 12 }, { declaratii: [{ preverificare_id: 12, rezervare_pierduta: true }] }), /reverificat/)
})

console.log(`PASS coada: ${passed} scenarii; storage/RPC simulate, fără BD sau rețea`)
