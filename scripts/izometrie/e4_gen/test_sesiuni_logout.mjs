import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sesiuneVeche, frontVechi, abandoneazaCiorneLocale } from '../../../src/lib/izoSesiuni.js'
import { stareInitiala, creeazaCoada, memorie } from '../../../src/lib/izoCoada.js'
import { sesiuneLocala, randuriSesiune } from '../../../src/lib/izoTeren.js'
import { situatieLogout, decideLogout, coadaProfilului, coziDeschise } from '../../../src/lib/izoLogout.js'
import { citesteCoziProfil } from '../../../src/lib/izoLogoutBrowser.js'

const op = (tip, payload, stare = 'pe_tableta') => ({ stare, cerere: { tip_op: tip, payload, op_id: tip, seq: 1 } })
test('Zi București: sesiune anterioară, aceeași zi, viitoare, trimisă', () => {
  const s = { zi: '2026-10-23' }
  assert.equal(sesiuneVeche(s, '2026-10-24'), true)
  for (const x of [{ ...s, trimisa: true }, { ...s, stare: 'inchisa' }, { zi: '2026-10-24' }, { zi: '2026-10-25' }, null]) assert.equal(sesiuneVeche(x, '2026-10-24'), false)
  assert.equal(frontVechi({ activ: true, de_la: '2026-10-23T20:00:00Z', expira_la: '2026-10-24T12:00:00Z' }, new Date('2026-10-24T06:00:00Z')), true)
  assert.equal(frontVechi({ activ: false }), false)
})
test('Abandon atomic: ciorne și dependențe locale, fără ștergerea istoricului sau altei sesiuni', () => {
  const s = stareInitiala('d')
  s.ops = [op('sesiune_deschide', { uid: 's' }), op('decl_salveaza', { uid: 'a', preverificare_uid: 's' }), op('decl_salveaza', { uid: 'b', preverificare_uid: 's', depinde_de_uid: 'a' }), op('decl_salveaza', { preverificare_uid: 'alta' })]
  const result = abandoneazaCiorneLocale(s, 's')
  assert.equal(s.ops.length, 4)
  assert.equal(result.ops.length, 1)
  assert.equal(result.arhiva.length, 3)
  assert.ok(result.arhiva.every(o => o.abandonata))
  assert.equal(sesiuneLocala(result, undefined), null)
})
test('ACK pierdut: abandonul întregii sesiuni este refuzat fără mutație', () => {
  const s = stareInitiala('d')
  s.ops = [op('decl_salveaza', { preverificare_uid: 's' }), op('decl_salveaza', { preverificare_uid: 's' }, 'trimisa')]
  assert.throws(() => abandoneazaCiorneLocale(s, 's'), /ACK/)
  assert.equal(s.ops.length, 2)
})
test('Coada persistă abandonul; o eroare de stocare nu raportează succes', async () => {
  const s = stareInitiala('d'); s.ops = [op('decl_salveaza', { preverificare_uid: 's' })]
  const storage = memorie(s), q = creeazaCoada({ storage })
  await q.abandoneazaCiorne('s')
  assert.equal((await storage.read()).arhiva.length, 1)
  const broken = creeazaCoada({ storage: { read: async () => s, write: async () => { throw Error('disc') } } })
  await assert.rejects(broken.abandoneazaCiorne('s'), /disc/)
})
test('Sesiune de ieri recuperată din server, fără istoric local; trimitere goală permisă LIVE', () => {
  const s = stareInitiala('d'); s.snapshots[7] = { sesiuni: [{ id: 2, uid: 's', zi: '2026-10-23', stare: 'deschisa' }], declaratii: [] }
  const session = sesiuneLocala(s, 7)
  assert.equal(session.uid, 's')
  assert.deepEqual(randuriSesiune(s, session, s.snapshots[7]), [])
  const sql = readFileSync(new URL('../../../supabase/migrations/20261109b_izometrie_e4b_teren.sql', import.meta.url), 'utf8')
  const submit = sql.slice(sql.indexOf("IF v_type='sesiune_trimite' THEN"), sql.indexOf("IF v_type NOT IN ('decl_salveaza'"))
  assert.match(submit, /UPDATE public.izo_preverificari SET stare='trimisa'/)
  assert.doesNotMatch(submit, /v_s\.zi|current_date/)
})
test('Logout include toate operațiile, inclusiv refuz nefinal și trimisă fără ACK', () => {
  assert.equal(situatieLogout([{ stare: { ops: [{ stare: 'pe_tableta' }, { stare: 'trimisa' }, { rezultat: { cod: 'front_expirat' } }] } }]).numar, 3)
  assert.equal(situatieLogout([{ stare: { ops: [], arhiva: [{}] } }]).blocat, false)
  assert.equal(situatieLogout([], 'citire eșuată').blocat, true)
  assert.equal(coadaProfilului('izo-e4-ana-7', 'ana'), true)
  assert.equal(coadaProfilului('izo-e4-anamaria-7', 'ana'), false)
})
test('Închiderea MP nu este anulată de istoric; instantaneul anterior ACK nu închide sesiunea', () => {
  const s = stareInitiala('d')
  s.arhiva = [{ ...op('sesiune_deschide', { uid: 's', tronson_id: 7, zi: '2026-10-23' }, 'confirmata'), rezultat: { cod: 'acceptat', sesiune_id: 2 }, confirmata_la: '2026-10-24T06:00:00Z' }]
  s.snapshots[7] = { sesiuni: [], salvat_la: '2026-10-24T05:00:00Z' }
  assert.equal(sesiuneLocala(s, 7).trimisa, false)
  s.snapshots[7].salvat_la = '2026-10-24T07:00:00Z'
  assert.equal(sesiuneLocala(s, 7).confirmata, true)
  assert.equal(sesiuneVeche(sesiuneLocala(s, 7)), false)
})
async function logout(answers, extra = {}) {
  const calls = [], q = [{ stare: { ops: [{}] } }]
  const result = await decideLogout({ citeste: async () => q, confirma: async text => { calls.push(text); return answers.shift() }, exporta: async value => { calls.push('export'); assert.equal(value.numar, 1) }, iesire: async () => { calls.push('logout') }, ...extra })
  return { calls, result }
}
test('Export înainte de ieșire: rămâne conectat', async () => {
  const { calls, result } = await logout([true]); assert.equal(result, false); assert.equal(calls.at(-1), 'export'); assert.ok(!calls.includes('logout'))
})
test('Anulare la oricare dintre confirmări blochează ieșirea', async () => {
  for (const answers of [[false, false], [false, true, false]]) { const { result, calls } = await logout(answers); assert.equal(result, false); assert.ok(!calls.includes('logout')) }
})
test('Override necesită exact două confirmări după opțiunea de export', async () => {
  const { calls, result } = await logout([false, true, true]); assert.equal(result, true); assert.equal(calls.length, 4); assert.equal(calls.at(-1), 'logout')
})
test('Coada goală iese direct; eroarea de citire blochează', async () => {
  assert.deepEqual((await logout([], { citeste: async () => [] })).calls, ['logout'])
  const { calls, result } = await logout([false, false], { citeste: async () => { throw Error('IndexedDB indisponibil') } })
  assert.equal(result, false); assert.match(calls[0], /IndexedDB/)
})
test('Profil izolat: cozi în memorie din mai multe proiecte rămân exportabile după demontare', async () => {
  const previous = globalThis.indexedDB
  globalThis.indexedDB = { databases: async () => [] }
  try {
    for (const name of ['izo-e4-ana-1', 'izo-e4-ana-2', 'izo-e4-ion-1']) coziDeschise.set(name, Promise.resolve({ citeste: async () => ({ ops: [{}] }) }))
    const result = await citesteCoziProfil('ana')
    assert.equal(result.length, 2); assert.equal(situatieLogout(result).numar, 2)
    globalThis.indexedDB = undefined
    const partial = await citesteCoziProfil('ana')
    assert.equal(partial.length, 2); assert.match(partial.eroare, /inventarierea/)
  } finally { coziDeschise.clear(); globalThis.indexedDB = previous }
})
