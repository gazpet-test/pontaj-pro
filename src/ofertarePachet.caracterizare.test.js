import { describe, it, expect } from 'vitest'
import { pachetDepasit, manifesteIdentice, construiesteManifest } from './ofertarePachet.js'
import { controlPachetComplet } from './ofertareControale.js'

describe('pachetDepasit', () => {
  it('returneaza null cand pachetul nu are fisiere (pachet fara fisiere)', () => {
    expect(pachetDepasit({ fisiere: [] }, [])).toBeNull()
  })

  it('returneaza null cand pachetul este null', () => {
    expect(pachetDepasit(null, [])).toBeNull()
  })

  it('[JAK-V2-01] arunca eroare daca capitoleAcum este null sau lipseste (liste goale/null)', () => {
    // GOL: pachetDepasit arunca TypeError (capitole is not iterable) in loc sa returneze un verdict sau sa gestioneze lipsa datelor
    const pachet = { fisiere: [{ sursa_versiune: 'capitole@{1:v1}' }] }
    expect(() => pachetDepasit(pachet, null)).toThrow(TypeError)
    expect(() => pachetDepasit(pachet, undefined)).toThrow(TypeError)
  })
})

describe('manifesteIdentice', () => {
  it('returneaza false cand un fisier lipseste din manifest', () => {
    const a = [{ rol: 'doc', sha256: 'a'.repeat(64) }]
    const b = []
    expect(manifesteIdentice(a, b)).toBe(false)
  })

  it('returneaza false cand hash-ul difera (sha diferit)', () => {
    const a = [{ rol: 'doc', sha256: 'a'.repeat(64) }]
    const b = [{ rol: 'doc', sha256: 'b'.repeat(64) }]
    expect(manifesteIdentice(a, b)).toBe(false)
  })

  it('[JAK-V2-02] arunca eroare cand un manifest este null in loc de lista goala', () => {
    // GOL: manifesteIdentice arunca TypeError cand primeste null in loc sa il trateze drept manifest gol si sa returneze false
    const a = [{ rol: 'doc', sha256: 'a'.repeat(64) }]
    expect(() => manifesteIdentice(a, null)).toThrow(TypeError)
  })
})

describe('controlPachetComplet', () => {
  it('este ok cand pachetul nu are fisiere (pachet fara fisiere) pentru pachet_stare="ciorna"', () => {
    const r = controlPachetComplet({
      anexe_asteptate: ['Anexa 1'],
      pachet_stare: 'ciorna',
      pachet_fisiere: []
    })
    expect(r.stare).toBe('ok')
    expect(r.detalii).toContain('nu e încă asamblat')
  })

  it('[JAK-V2-03] trateaza pachetul lipsa cu "ok" inclusiv pentru stare de pachet depus vs aprobat vs propus', () => {
    // GOL: un pachet care are starea 'depus', 'aprobat' sau 'propus', dar lista_fisiere este goala, 
    // primeste verdict 'ok' justificat ca "nu e inca asamblat", ceea ce contrazice stadiul sau.
    const stadii = ['depus', 'aprobat', 'propus']
    for (const stare of stadii) {
      const r = controlPachetComplet({
        anexe_asteptate: ['Anexa 1'],
        pachet_stare: stare,
        pachet_fisiere: []
      })
      expect(r.stare).toBe('ok')
      expect(r.detalii).toContain('nu e încă asamblat')
    }
  })

  it('suporta liste goale/null fara sa crape', () => {
    const r = controlPachetComplet({
      anexe_asteptate: null,
      anexe_declarate: null,
      pachet_stare: 'ciorna',
      pachet_fisiere: null
    })
    expect(r.stare).toBe('ok')
  })
  
  it('identifica fisier lipsa fizic din pachet cand pachetul contine alte fisiere', () => {
      const r = controlPachetComplet({
          anexe_asteptate: ['Anexa 1', 'Anexa 2'],
          pachet_stare: 'ciorna',
          pachet_fisiere: [{ nume: 'Anexa 1.pdf' }]
      })
      expect(r.stare).toBe('block')
      expect(r.lipsa[0].ref).toBe('anexa:2')
  })
})
