// R6 — test pur pentru manifestul rutei Vercel (api/_manifest.js). Rulare: node scripts/test-manifest-vercel.mjs
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { randManifest, sha256Hex, dedupManifest, MANIFEST_CONFLICT, ARHIVA_SEAP } from '../api/_manifest.js'

let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok -', n) }
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

t('sha256 vector standard "abc"', () => assert.equal(sha256Hex(Buffer.from('abc')), ABC))
const buf = Buffer.from(Array.from({ length: 70000 }, (_, i) => i % 251))
const web = Buffer.from(await webcrypto.subtle.digest('SHA-256', new Uint8Array(buf))).toString('hex')
assert.equal(sha256Hex(buf), web); assert.equal(sha256Hex(new Uint8Array(buf)), web)

const acum = new Date('2026-09-25T10:00:00Z')
t('rand urcat, arhiva lowercase fara .p7s', () => {
  const r = randManifest({ licitatieId: 102, arhivaCheie: ARHIVA_SEAP, cale: 'Caiet Sarcini.pdf.p7s', marime: 5, sha256: ABC, documentId: 9, acum })
  assert.deepEqual(r, { licitatie_id: 102, arhiva_cheie: 'seap:downloadarchive', cale: 'Caiet Sarcini.pdf', marime: 5, sha256: ABC, document_id: 9, stare: 'urcat', motiv: null, verificat_la: acum.toISOString() })
})
t('fara document => eroare_urcare; fara arhiva => cheia = cale', () => {
  const r = randManifest({ licitatieId: 1, arhivaCheie: null, cale: 'A.PDF', marime: 0, sha256: ABC, motiv: 'x' })
  assert.equal(r.stare, 'eroare_urcare'); assert.equal(r.arhiva_cheie, 'a.pdf'); assert.equal(r.motiv, 'x')
})
t('validari', () => {
  assert.throws(() => randManifest({ licitatieId: 1, cale: 'a', marime: 1, sha256: 'xyz' }), /sha256/)
  assert.throws(() => randManifest({ licitatieId: 1, cale: 'a', marime: -1, sha256: ABC }), /marime/)
  assert.throws(() => randManifest({ licitatieId: 1, cale: '.p7s', marime: 1, sha256: ABC }), /cale/)
})
t('dedup pe lot pastreaza ultimul', () => {
  const a = randManifest({ licitatieId: 1, arhivaCheie: ARHIVA_SEAP, cale: 'x.pdf', marime: 1, sha256: ABC, motiv: 'e' })
  const b = randManifest({ licitatieId: 1, arhivaCheie: ARHIVA_SEAP, cale: 'x.pdf', marime: 1, sha256: ABC, documentId: 3 })
  const c = randManifest({ licitatieId: 1, arhivaCheie: ARHIVA_SEAP, cale: 'y.pdf', marime: 1, sha256: ABC, documentId: 4 })
  const u = dedupManifest([a, b, c]); assert.equal(u.length, 2); assert.equal(u[0].document_id, 3)
})
t('cheie upsert identica cu edge', () => assert.equal(MANIFEST_CONFLICT, 'licitatie_id,arhiva_cheie,cale'))
console.log(`\n${ok} teste trecute`)
