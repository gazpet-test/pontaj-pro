// R5 (Copilot 25.09.2026): măsurătoarea automată din desenul CAD intră 'extras', nu 'validat'.
// Fișierul începe cu „_" ca și modulul: Vercel nu face funcții din el.
import { describe, it, expect } from 'vitest'
import { randCantitateCad } from './_cadCantitate.js'

const c = { numar: 1, lungime_3d_m: 35620.59, lungime_2d_m: 35598.1 }
const arg = { licitatieId: 3, denumire: 'Traseu măsurat din desenul proiectantului (Retea 35620.dwg)', c, notaAnaliza: 'Strat RETEA.' }

describe('randCantitateCad — o măsurătoare nu se auto-aprobă', () => {
  it('rând nou => status extras (înainte: validat fără niciun om — lic. 3, rândul 9)', () => {
    const r = randCantitateCad(arg, null)
    expect(r.op).toBe('insert'); expect(r.rand.status).toBe('extras'); expect(r.rand.cantitate).toBe(35620.59)
    expect(r.rand.diferenta_nota).toMatch(/^Măsurat din desen: 35.620,59 m în spațiu/)
    expect(r.rand.diferenta_nota).not.toMatch(/undefined/)
  })
  it('rând existent VALIDAT de om: nu i se schimbă cifra și nici statusul, doar măsurătoarea + nota', () => {
    const r = randCantitateCad(arg, { id: 9, cantitate: 35000, status: 'validat' })
    expect(r.op).toBe('update'); expect(r.patch).not.toHaveProperty('cantitate'); expect(r.patch).not.toHaveProperty('status')
    expect(r.patch.cantitate_plansa).toBe(35620.59); expect(r.patch.diferenta_nota).toMatch(/validat cu 35.000 m — noua măsurătoare diferă/)
  })
  it('rând existent nevalidat: se actualizează cifra, statusul rămâne al lui (nu devine validat)', () => {
    const r = randCantitateCad(arg, { id: 9, cantitate: 1, status: 'extras' })
    expect(r.patch.cantitate).toBe(35620.59); expect(r.patch).not.toHaveProperty('status')
  })
  it('nicio ramură nu scrie status=validat', () => {
    for (const ex of [null, { id: 1, status: 'extras' }, { id: 1, status: 'diferenta' }, { id: 1, status: 'validat', cantitate: 35620.59 }]) {
      const r = randCantitateCad(arg, ex)
      expect((r.rand || r.patch).status).not.toBe('validat')
    }
  })
})
