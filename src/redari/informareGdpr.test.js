import { describe, it, expect } from 'vitest'
import { TEXT_INFORMARE_LOT1, INFORMARE_LOT1_PUBLICATA } from './informareGdpr.js'
import { blocuri, campuriNecompletate, informareGata } from '../RedariInformarePublic.jsx'

describe('informarea GDPR publica (Lot 1)', () => {
  it('textul are cele 7 capitole si nu contine nota interna', () => {
    const titluri = blocuri(TEXT_INFORMARE_LOT1).filter(b => b.tip === 'titlu').map(b => b.text)
    expect(titluri).toHaveLength(7)
    expect(titluri[0]).toMatch(/^1\. Cine folosește/)
    expect(TEXT_INFORMARE_LOT1).not.toMatch(/NOTĂ INTERNĂ|nu se publică|TEXT SCURT/)
    expect(TEXT_INFORMARE_LOT1).not.toMatch(/art\. 11 alin\. \(4\)/)
  })
  it('cat timp are campuri [ ] sau nu e marcata publicata, pagina NU e gata (banda PROIECT + noindex)', () => {
    expect(campuriNecompletate(TEXT_INFORMARE_LOT1).length).toBeGreaterThan(0)
    expect(INFORMARE_LOT1_PUBLICATA).toBe(false)
    expect(informareGata(TEXT_INFORMARE_LOT1, true)).toBe(false)
    expect(informareGata('Text complet fara campuri.', false)).toBe(false)
    expect(informareGata('Text complet fara campuri.', true)).toBe(true)
  })
  it('markdown minimal: titlu, lista, paragraf; fara HTML din sursa', () => {
    expect(blocuri('### A\n\n- x\n- y\n\nPar **b** [c]')).toEqual([
      { tip: 'titlu', text: 'A' }, { tip: 'lista', elemente: ['x', 'y'] }, { tip: 'paragraf', text: 'Par **b** [c]' }])
    expect(campuriNecompletate('a [__] b [de completat]')).toEqual(['[__]', '[de completat]'])
  })
})
