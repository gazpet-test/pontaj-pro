import { describe, it, expect } from 'vitest'
import { inventarMail } from './mailLoturi.js'

describe('inventar RPC destinatari', () => {
  it('păstrează numitorul și numără separat motivele suprapuse (inclusiv fara_token, 20261131i)', () => {
    expect(inventarMail([{ motive: [] }, { motive: ['fara_email', 'canal_postal'] }, { motive: ['opt_out'] }, { motive: ['deja_rezervat_trimis'] }, { motive: ['fara_token', 'fara_email'] }]))
      .toEqual({ total: 5, eligibili: 1, exclusi: 4, motive: { fara_email: 2, canal_postal: 1, opt_out: 1, deja_rezervat_trimis: 1, fara_token: 1 } })
  })
  it('zero destinatari este inventar complet cu zero', () => {
    expect(inventarMail([])).toEqual({ total: 0, eligibili: 0, exclusi: 0, motive: { fara_email: 0, canal_postal: 0, opt_out: 0, deja_rezervat_trimis: 0, fara_token: 0 } })
  })
  it.each([{}, { motive: null }, { motive: ['nou'] }, { motive: ['opt_out', 'opt_out'] }])('refuză contract incomplet sau motiv necunoscut %j', r => {
    expect(() => inventarMail([r])).toThrow('Inventarul destinatarilor este invalid')
  })
})
