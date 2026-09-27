import { strictEqual as assertEquals } from 'node:assert'
import { aplicaRegulaAprobare } from './invalidare.js'
import { cazuriUnitatiF2 } from '../../../src/ofertareInvalidareUnitati.cazuri.js'

for (const c of cazuriUnitatiF2) {
  Deno.test(`U runda 2 — ${c.nume}`, () => {
    // Funcția JS are default null; inferența TS nu descrie obiectul opțional acceptat la runtime.
    const r = aplicaRegulaAprobare(c.vechi, c.patch, c.referinta as any)
    assertEquals(r.invalidat, c.invalidat)
    assertEquals({ ...c.vechi, ...r.patch }.status, c.invalidat ? 'diferenta' : 'validat')
  })
}
