import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { declaratieNecunoscuta, corecteazaDeclaratie, mesajConflict, poateCorecta, randuriSesiune } from '../../../src/lib/izoTeren.js'
import { adaugaOperatii, aplicaRaspuns, creeazaCoada, memorie, stareInitiala, urmatorulLot } from '../../../src/lib/izoCoada.js'

let count = 0, seq = 0
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`) }
const baza = { proiect_id: 3, tronson_id: 18, preverificare_uid: id(), data_montaj: '2026-10-24' }
const snap = { praguri: { lungime_max_mm: 30000 }, frunze: [{ id: 5, disponibila: true, lungime_mm: 12000 }] }
const unknown = declaratieNecunoscuta(baza, ' 123AB12345 ', 12000, true, id)
const decl = { id: 1, uid: unknown.payload.uid, versiune: 4, stare: 'revizie_ceruta', identificare: 'nerezolvata', tip: 'montaj', payload: unknown.payload }

await test('serie necunoscută: fără identitate inventată, măsurătoare confirmată separat', () => {
  assert.equal(unknown.payload.serie_bruta, '123AB12345')
  assert.equal(unknown.payload.bucata, undefined)
  assert.deepEqual(unknown.payload.confirmare, { mod: 'masurat', masurata_mm: 12000 })
  for (const [serie, mm, ok] of [['', 100, true], ['X', 0, true], ['X', 30001, true], ['X', 12000, false]]) assert.throws(() => declaratieNecunoscuta(baza, serie, mm, ok))
})
await test('revizie: aceeași declarație, CAS curent, identitate nerezolvată păstrată', () => {
  const c = corecteazaDeclaratie(decl, { mm: 11980, confirmata: true }, snap)
  assert.equal(c.payload.uid, decl.uid); assert.equal(c.payload.versiune_baza, 4)
  assert.equal(c.payload.lungime_montata_mm, 11980)
  assert.equal(c.payload.bucata, undefined)
  assert.throws(() => corecteazaDeclaratie(decl, { mm: 12000, confirmata: true, bucata: 5 }, snap), /MP/)
  assert.equal(decl.payload.lungime_montata_mm, 12000)
})
await test('după trimitere nu se ocolește revizia; rândurile finale sunt blocate', () => {
  for (const stare of ['trimisa', 'in_verificare', 'aprobata', 'respinsa', 'stearsa']) {
    assert.equal(poateCorecta({ stare }), false)
    assert.throws(() => corecteazaDeclaratie({ ...decl, stare }, { mm: 12000, confirmata: true }, snap))
  }
  assert.throws(() => corecteazaDeclaratie(decl, { mm: 12000, confirmata: false }, snap))
})
await test('tăiere revizuită: R3 exact și UID copii păstrate', () => {
  const d = { ...decl, identificare: null, tip: 'taiere', payload: { ...baza, tip: 'taiere', sursa: { bucata_id: 5 }, copii: [{ uid: id(), destinatie: 'montaj' }, { uid: id(), destinatie: 'depozit', calculata: true }] } }
  const c = corecteazaDeclaratie(d, { mm: 12010, puncte: '8000', confirmata: true }, snap)
  assert.deepEqual(c.payload.copii.map(x => x.lungime_mm), [8000, 4010])
  assert.deepEqual(c.payload.copii.map(x => x.uid), d.payload.copii.map(x => x.uid))
  assert.throws(() => corecteazaDeclaratie(d, { mm: 12000, puncte: '12000', confirmata: true }, snap))
})
await test('schimbare piesă: doar disponibilă, se elimină dependența veche', () => {
  const d = { ...decl, identificare: 'bucata_decl', payload: { ...decl.payload, depinde_de_uid: id(), depinde_de_versiune: 2 } }
  const c = corecteazaDeclaratie(d, { mm: 12000, bucata: 5, confirmata: true }, snap)
  assert.deepEqual(c.payload.bucata, { bucata_id: 5 }); assert.equal(c.payload.depinde_de_uid, undefined)
  assert.throws(() => corecteazaDeclaratie(d, { mm: 12000, bucata: 6, confirmata: true }, snap))
})
await test('cuplare în revizie: se pot înlocui capetele cu piese reale distincte', () => {
  const d = { ...decl, tronson_id: 18, identificare: null, tip: 'cuplare', payload: { ...baza, tip: 'cuplare', capat1: { bucata_id: 1, capat: 'A' }, capat2: { bucata_id: 2, capat: 'B' }, sudura: { nr: 3, sufix: '' } } }
  const snapshot = { frunze: [{ id: 5, tronson_id: 18, stare: 'montata' }] }
  const c = corecteazaDeclaratie(d, { confirmata: true, capat1: { bucata_id: 5, capat: 'B' } }, snapshot)
  assert.deepEqual(c.payload.capat1, { bucata_id: 5, capat: 'B' })
  assert.deepEqual(c.payload.sudura, d.payload.sudura)
  assert.throws(() => corecteazaDeclaratie(d, { confirmata: true, capat1: { bucata_id: 5, capat: 'A' }, capat2: { bucata_id: 5, capat: 'B' } }, snapshot))
})
await test('blocat_de_conflict: fără retry automat, retry explicit identic', async () => {
  let s = adaugaOperatii(stareInitiala(id()), [unknown], id)
  const lot = urmatorulLot(s)
  s = aplicaRaspuns(s, lot, { rezultate: [{ op_id: lot[0].op_id, cod: 'blocat_de_conflict' }] })
  assert.deepEqual(urmatorulLot(s), [])
  const q = creeazaCoada({ storage: memorie(s), id, rpc: async () => { throw Error('Nu apelăm rețeaua') } })
  const retried = await q.reincearca(lot[0].op_id)
  assert.deepEqual(urmatorulLot(retried), lot)
})
await test('refuz final: păstrat în istoric, niciodată retrimis, abandonul nu devine succes', async () => {
  let s = adaugaOperatii(stareInitiala(id()), [unknown], id)
  const lot = urmatorulLot(s)
  s = aplicaRaspuns(s, lot, { rezultate: [{ op_id: lot[0].op_id, cod: 'conflict', motiv: 'cas' }] })
  const q = creeazaCoada({ storage: memorie(s), id })
  await assert.rejects(q.reincearca(lot[0].op_id))
  const abandoned = await q.abandoneaza(lot[0].op_id)
  assert.equal(abandoned.arhiva[0].rezultat.cod, 'conflict')
  assert.equal(abandoned.arhiva[0].abandonata, true)
  assert.deepEqual(randuriSesiune(abandoned, { uid: baza.preverificare_uid }, {}), [])
})
await test('ACK incert și acceptat în conflict: abandonul local este refuzat', async () => {
  const s = adaugaOperatii(stareInitiala(id()), [unknown], id)
  const op = s.ops[0].cerere.op_id
  await assert.rejects(creeazaCoada({ storage: memorie(s), id }).abandoneaza(op))
  const conflict = aplicaRaspuns(s, urmatorulLot(s), { rezultate: [{ op_id: op, cod: 'acceptat', stare: 'conflict' }] })
  await assert.rejects(creeazaCoada({ storage: memorie(conflict), id }).abandoneaza(op))
})
await test('istoricul conflictului reparat nu mai blochează sesiunea', () => {
  let s = adaugaOperatii(stareInitiala(id()), [unknown], id)
  s = aplicaRaspuns(s, urmatorulLot(s), { rezultate: [{ op_id: s.ops[0].cerere.op_id, cod: 'acceptat', stare: 'conflict', versiune: 1 }] })
  const snapshot = { declaratii: [{ uid: unknown.payload.uid, preverificare_id: 42, stare: 'ciorna', versiune: 2 }] }
  assert.deepEqual(randuriSesiune(s, { uid: baza.preverificare_uid, id: 42 }, snapshot), [{ uid: unknown.payload.uid, versiune: 2 }])
})
await test('mesaje românești pentru front, dependență, rezervare și R1d', () => {
  for (const r of [{ cod: 'alt_dispozitiv' }, { cod: 'blocat_de_conflict' }, { rezervare_pierduta: true }, { conflict_cod: 'r1d' }]) assert.ok(mesajConflict(r).length > 40)
})
await test('payload nou folosește numai cheile acceptate de migrarea LIVE', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261109b_izometrie_e4b_teren.sql', import.meta.url), 'utf8')
  const allowed = sql.split("IF jsonb_typeof(v_p) IS DISTINCT FROM 'object' OR v_p-ARRAY[")[1].split("]<>'{}'")[0]
  for (const c of [unknown, corecteazaDeclaratie(decl, { mm: 11990, confirmata: true }, snap)]) for (const key of Object.keys(c.payload)) assert.ok(allowed.includes(`'${key}'`), key)
  assert.ok(!allowed.includes("'foto'")); assert.ok(!allowed.includes("'descriere'"))
})
console.log(`PASS teren UI: ${count} scenarii; fără BD/rețea`)
