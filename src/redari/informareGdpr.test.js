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
  it('textul v3 final (Final_v2, 03.11) contine elementele noi', () => {
    const t = TEXT_INFORMARE_LOT1
    const liste = blocuri(t).filter(b => b.tip === 'lista').flatMap(b => b.elemente)
    // SMSLink la „Cine mai vede datele” (capitolul 4)
    const cap4 = t.slice(t.indexOf('### 4.'), t.indexOf('### 5.'))
    expect(cap4).toContain('furnizorul de SMS, SMSLink (ASTINVEST COM S.R.L.)')
    expect(cap4).toContain('datele sunt stocate în România')
    // firmele care lucreaza la verificare (camp inca deschis)
    expect(cap4).toContain('firmele care lucrează efectiv la verificarea terenurilor, numai dacă accesul lor este autorizat de Transgaz')
    // dreptul de opozitie + plangerea la ANSPDCP
    expect(t).toContain('vă puteți opune folosirii datelor făcute pentru sarcina de interes public')
    expect(t).toContain('Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), www.dataprotection.ro')
    // sursa datelor
    expect(t).toContain('Datele provin de la Transgaz, care le-a obținut pentru acest proiect de la oficiul de cadastru')
    // listele se randeaza ca liste (si in sectiunea 2 / temeiul legal)
    expect(liste).toContain('păstrăm dovezile lucrărilor pentru recepția conductei.')
    expect(liste.some(e => e.startsWith('pentru identificarea proprietarilor'))).toBe(true)
    // fara textul scurt de pe fata si fara versiunea v2
    expect(t).not.toMatch(/Versiunea 3 din|\[link scurt|Pe verso găsiți/)
  })
  it('campurile [de completat] / [de confirmat] tin pagina in modul PROIECT, chiar daca ar fi marcata publicata', () => {
    expect(campuriNecompletate(TEXT_INFORMARE_LOT1)).toEqual([
      '[surse exacte – de confirmat de Transgaz]', '[denumiri – de completat]', '[de confirmat]',
      '[, ori depuneți cererea la primăria comunei – numai dacă circuitul e convenit cu primăria]'])
    expect(informareGata(TEXT_INFORMARE_LOT1, true)).toBe(false)
    expect(informareGata(TEXT_INFORMARE_LOT1, INFORMARE_LOT1_PUBLICATA)).toBe(false)
  })
  it('markdown minimal: titlu, lista, paragraf; fara HTML din sursa', () => {
    expect(blocuri('### A\n\n- x\n- y\n\nPar **b** [c]')).toEqual([
      { tip: 'titlu', text: 'A' }, { tip: 'lista', elemente: ['x', 'y'] }, { tip: 'paragraf', text: 'Par **b** [c]' }])
    expect(campuriNecompletate('a [__] b [de completat]')).toEqual(['[__]', '[de completat]'])
  })
})
