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
