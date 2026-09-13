import { describe, it, expect } from 'vitest'
import { sha256Hex, sursaVersiuneCapitole, caleFisierPachet, construiesteManifest, manifesteIdentice } from './ofertarePachet.js'

const H = 'a'.repeat(64)

describe('sha256Hex', () => {
  it('hash-ul cunoscut al sirului gol', async () => {
    expect(await sha256Hex(new Uint8Array([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
  it('un byte schimbat = alt hash (testul 6 din audit: hash schimbat => versiune noua)', async () => {
    const a = await sha256Hex(new TextEncoder().encode('propunere v1'))
    const b = await sha256Hex(new TextEncoder().encode('propunere v1.'))
    expect(a).not.toBe(b); expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('sursaVersiuneCapitole', () => {
  it('e stabila la ordine: aceleasi versiuni => aceeasi amprenta', () => {
    const x = sursaVersiuneCapitole([{ id: 12, versiune: 3 }, { id: 13, versiune: 1 }])
    const y = sursaVersiuneCapitole([{ id: 13, versiune: 1 }, { id: 12, versiune: 3 }])
    expect(x).toBe(y); expect(x).toBe('capitole@{12:v3,13:v1}')
  })
  it('versiunea lipsa se citeste ca v1', () => expect(sursaVersiuneCapitole([{ id: 5 }])).toBe('capitole@{5:v1}'))
  it('o versiune schimbata schimba amprenta (P0.6: textul s-a schimbat => alt pachet)', () => {
    expect(sursaVersiuneCapitole([{ id: 12, versiune: 3 }])).not.toBe(sursaVersiuneCapitole([{ id: 12, versiune: 4 }]))
  })
})

describe('construiesteManifest', () => {
  const ok = { rol: 'propunere_docx', nume: 'Propunere tehnica.docx', mime: 'application/x', size: 10, sha256: H }
  it('produce randuri cu cale stabila in bucket si sursa_versiune', () => {
    const m = construiesteManifest({ licitatieId: 3, versiune: 2, fisiere: [ok], sursaVersiune: 'capitole@{1:v1}' })
    expect(m).toHaveLength(1)
    expect(m[0].fisier_path).toBe('pt/3/v2/Propunere_tehnica.docx')
    expect(m[0].sursa_versiune).toBe('capitole@{1:v1}')
  })
  it('refuza un pachet gol', () => expect(() => construiesteManifest({ licitatieId: 3, versiune: 1, fisiere: [] })).toThrow(/gol/))
  it('refuza un fisier fara hash valid', () =>
    expect(() => construiesteManifest({ licitatieId: 3, versiune: 1, fisiere: [{ ...ok, sha256: 'xyz' }] })).toThrow(/hash/))
  it('caleFisierPachet nu lasa caractere problematice', () => expect(caleFisierPachet(3, 1, 'a b/c:d.docx')).toBe('pt/3/v1/a_b_c_d.docx'))
})

describe('manifesteIdentice', () => {
  it('aceleasi (rol, hash) in alta ordine = identice', () => {
    expect(manifesteIdentice([{ rol: 'a', sha256: H }, { rol: 'b', sha256: 'b'.repeat(64) }],
                             [{ rol: 'b', sha256: 'b'.repeat(64) }, { rol: 'a', sha256: H }])).toBe(true)
  })
  it('un hash diferit = manifeste diferite', () => {
    expect(manifesteIdentice([{ rol: 'a', sha256: H }], [{ rol: 'a', sha256: 'c'.repeat(64) }])).toBe(false)
  })
})
