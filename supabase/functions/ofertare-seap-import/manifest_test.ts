import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { randManifest, sha256Hex, MANIFEST_CONFLICT } from './manifest.ts'

const acum = new Date('2026-09-25T10:00:00Z')

Deno.test('sha256Hex: vector cunoscut ("abc")', async () => {
  assertEquals(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

Deno.test('randManifest: fișier din arhivă, urcat', async () => {
  const sha = await sha256Hex(new Uint8Array([1, 2, 3]))
  const r = randManifest({ licitatieId: 102, arhivaCheie: 'PT Botosani.zip.p7s', cale: 'Plan 1.pdf', marime: 3, sha256: sha, documentId: 9, acum })
  assertEquals(r, { licitatie_id: 102, arhiva_cheie: 'pt botosani.zip', cale: 'Plan 1.pdf', marime: 3, sha256: sha, document_id: 9, stare: 'urcat', motiv: null, verificat_la: '2026-09-25T10:00:00.000Z' })
})

Deno.test('randManifest: fișier simplu → arhiva_cheie = propria cheie; fără document = eroare_urcare', async () => {
  const sha = await sha256Hex(new Uint8Array())
  const r = randManifest({ licitatieId: 1, arhivaCheie: null, cale: 'Caiet.PDF.p7s', marime: 0, sha256: sha, motiv: 'upload refuzat', acum })
  assertEquals([r.arhiva_cheie, r.cale, r.stare, r.document_id, r.motiv], ['caiet.pdf', 'Caiet.PDF', 'eroare_urcare', null, 'upload refuzat'])
})

Deno.test('randManifest: validări (sha, mărime, cale)', () => {
  assertThrows(() => randManifest({ licitatieId: 1, arhivaCheie: 'a', cale: 'x', marime: 1, sha256: 'ZZ' }))
  assertThrows(() => randManifest({ licitatieId: 1, arhivaCheie: 'a', cale: 'x', marime: -1, sha256: 'a'.repeat(64) }))
  assertThrows(() => randManifest({ licitatieId: 1, arhivaCheie: 'a', cale: '', marime: 1, sha256: 'a'.repeat(64) }))
})

Deno.test('cheia de conflict = UNIQUE din migrare', () => {
  assertEquals(MANIFEST_CONFLICT, 'licitatie_id,arhiva_cheie,cale')
})
