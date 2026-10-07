import { strict as assert } from 'node:assert'
import { decideAccesTts, normalizeazaText, imparteText, numarCaractere, cheieCache, VOCI, VOCE_IMPLICITA } from './ttsLogica.ts'

const st = (d: ReturnType<typeof decideAccesTts>) => (d.ok ? 200 : d.status)

Deno.test('poarta: fără utilizator 401, fără modul 403, owner sau modul 200', () => {
  assert.equal(st(decideAccesTts({ user: false, isOwner: true, areModul: true })), 401)
  assert.equal(st(decideAccesTts({ user: true, isOwner: false, areModul: false })), 403)
  assert.equal(st(decideAccesTts({ user: true, isOwner: true, areModul: false })), 200)
  assert.equal(st(decideAccesTts({ user: true, isOwner: false, areModul: true })), 200)
})

Deno.test('vocea implicită e Aoede și e în lista albă; doar voci ro-RO', () => {
  assert.equal(VOCE_IMPLICITA, 'ro-RO-Chirp3-HD-Aoede')
  assert.ok(VOCI.has(VOCE_IMPLICITA))
  for (const v of VOCI) assert.match(v, /^ro-RO-/)
})

Deno.test('normalizare: CRLF, spații multiple, NFC, trim', () => {
  assert.equal(normalizeazaText('  Bună   ziua\r\n\r\n\r\nAzi  '), 'Bună ziua\n\nAzi')
  assert.equal(normalizeazaText('s\u0326'), '\u0219')   // s + virgulă combinantă → ș precompus
  assert.equal(normalizeazaText(null), '')
})

Deno.test('caractere = code points, nu octeți', () => {
  assert.equal(numarCaractere('ăîșțâ'), 5)
})

Deno.test('textul scurt rămâne o bucată; cel lung se împarte sub limită și se reface', () => {
  assert.deepEqual(imparteText('Salut.'), ['Salut.'])
  const fraza = 'Aceasta este o propoziție cu diacritice ăîșțâ. '
  const lung = fraza.repeat(300)
  const b = imparteText(lung, 1000)
  assert.ok(b.length > 1)
  for (const x of b) assert.ok(new TextEncoder().encode(x).length <= 1000, 'bucată peste limită')
  assert.equal(b.join(' ').replace(/\s+/g, ' ').trim(), lung.replace(/\s+/g, ' ').trim())
})

Deno.test('propoziție fără punct și cuvânt uriaș fără spații: tot sub limită, nimic pierdut', () => {
  const t = 'cuvant '.repeat(500) + 'x'.repeat(3000)
  const b = imparteText(t, 500)
  for (const x of b) assert.ok(new TextEncoder().encode(x).length <= 500)
  assert.equal(b.join('').replace(/\s+/g, ''), t.replace(/\s+/g, ''))
})

Deno.test('cheia de cache: hex 64, depinde de voce și text', async () => {
  const a = await cheieCache('ro-RO-Chirp3-HD-Aoede', 'Salut')
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, await cheieCache('ro-RO-Chirp3-HD-Achird', 'Salut'))
  assert.notEqual(a, await cheieCache('ro-RO-Chirp3-HD-Aoede', 'Salut!'))
  assert.equal(a, await cheieCache('ro-RO-Chirp3-HD-Aoede', 'Salut'))
})

Deno.test('bucăți: rezervare înaintea fiecărei bucăți, fără restituire la eșecul Google (J13-1/P12-1)', async () => {
  const { genereazaPeBucati } = await import('./ttsLogica.ts')
  let contor = 940000
  const rezerva = (n: number) => Promise.resolve(contor + n <= 950000 ? (contor += n, 950000 - contor) : null)
  let apel = 0
  const sint = (_t: string) => { apel++; return apel === 2 ? Promise.reject(new Error('503')) : Promise.resolve(new Uint8Array([1, 2])) }
  const r = await genereazaPeBucati(['a'.repeat(4500), 'b'.repeat(500)], rezerva, sint)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.motiv, 'google')
  assert.equal(contor, 945000, 'ambele bucăți rămân numărate: prima a reușit, a doua a plecat spre Google')
  // reîncercări repetate nu pot trece de plafon: contorul crește la fiecare încercare
  for (let i = 0; i < 20; i++) { apel = 0; await genereazaPeBucati(['a'.repeat(4500), 'b'.repeat(500)], rezerva, sint) }
  assert.ok(contor <= 950000)
  const sintetizate = (contor - 940000)
  assert.ok(sintetizate <= 10000, 'consumul trimis la Google e mereu acoperit de contor')
})

Deno.test('bucăți: plafon atins la mijloc ⇒ se oprește, fără apel Google pentru bucata refuzată', async () => {
  const { genereazaPeBucati } = await import('./ttsLogica.ts')
  let contor = 949000, apeluri = 0
  const rezerva = (n: number) => Promise.resolve(contor + n <= 950000 ? (contor += n, 950000 - contor) : null)
  const r = await genereazaPeBucati(['x'.repeat(800), 'y'.repeat(800)], rezerva, () => { apeluri++; return Promise.resolve(new Uint8Array([7])) })
  assert.equal(r.ok === false && r.motiv, 'plafon')
  assert.equal(apeluri, 1)
  assert.equal(contor, 949800)
})

Deno.test('bucăți: succes ⇒ audio concatenat în ordine, rest = ultimul rest', async () => {
  const { genereazaPeBucati } = await import('./ttsLogica.ts')
  let contor = 0
  const rezerva = (n: number) => Promise.resolve((contor += n, 950000 - contor))
  const r = await genereazaPeBucati(['ab', 'cde'], rezerva, (t) => Promise.resolve(new TextEncoder().encode(t)))
  assert.ok(r.ok)
  if (r.ok) { assert.equal(new TextDecoder().decode(r.audio), 'abcde'); assert.equal(r.rest, 949995); assert.equal(r.rezervate, 5) }
})
