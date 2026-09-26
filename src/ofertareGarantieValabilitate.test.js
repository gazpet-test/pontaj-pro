// R7 (26.09.2026): valabilitatea garanției de participare. Textele de mai jos sunt formulările REALE
// din ofertare_cerinte / ofertare_licitatii.garantie_participare (SELECT pe BD, 26.09.2026) — id-ul e în titlu.
import { describe, it, expect } from 'vitest'
import {
  plusZile, plusLuni, zileIntre, ziDepunere, extrageDurate, clasificaSurse, propuneValabilitate,
  calculeazaValabilitate, alegeDurataActualizare, textDurata, MESAJ_NECITIT,
} from './ofertareGarantieValabilitate.js'

describe('date calendaristice', () => {
  it('Vâlcelele: 4 luni de la 19.10.2026 = 19.02.2027 = 123 de zile (nu 17.01.2027 cât dădea 90 implicit)', () => {
    expect(plusLuni('2026-10-19', 4)).toBe('2027-02-19')
    expect(zileIntre('2026-10-19', '2027-02-19')).toBe(123)
    expect(plusZile('2026-10-19', 90)).toBe('2027-01-17')
  })
  it('luni calendaristice, nu 30 × N: capăt de lună → ultima zi a lunii de sosire', () => {
    expect(plusLuni('2026-10-31', 4)).toBe('2027-02-28')
    expect(plusLuni('2027-10-31', 4)).toBe('2028-02-29')   // an bisect
    expect(plusLuni('2026-01-31', 1)).toBe('2026-02-28')
    expect(plusLuni('2026-12-15', 2)).toBe('2027-02-15')   // trece peste an
    expect(zileIntre('2026-10-31', plusLuni('2026-10-31', 4))).toBe(120)  // ≠ 123: durata în zile depinde de dată
  })
  it('plusZile nu alunecă la trecerea la ora de iarnă (25.10.2026)', () => {
    expect(plusZile('2026-10-19', 123)).toBe('2027-02-19')
    expect(plusZile('2026-03-20', 10)).toBe('2026-03-30')
  })
  it('intrări invalide → null, nu o dată inventată', () => {
    expect(plusLuni(null, 4)).toBe(null)
    expect(plusZile('', 90)).toBe(null)
    expect(zileIntre('x', '2026-01-01')).toBe(null)
  })
  it('ziDepunere ia ziua în ora României', () => {
    expect(ziDepunere('2026-10-19T12:00:00+00:00')).toBe('2026-10-19')   // lic. 95, 15:00 ora RO
    expect(ziDepunere('2026-10-18T21:30:00+00:00')).toBe('2026-10-19')   // 00:30 ora RO — slice(0,10) ar da 18
    expect(ziDepunere('2026-10-30')).toBe('2026-10-30')
    expect(ziDepunere(null)).toBe(null)
  })
})

describe('extrageDurate — formulări reale', () => {
  const d = t => extrageDurate(t).map(x => `${x.n} ${x.unitate}`)
  it('lic. 95, câmpul garantie_participare: „(4 luni de la termenul-limită)”', () => {
    expect(d('370.000 lei (fișa de date III.1.6.a, doc 479), conform art. 154 L98/2016; virament sau instrument de garantare; valabilitate ≥ perioada de valabilitate a ofertei (4 luni de la termenul-limită). ATENȚIE: în fișă CUI apare „379683”')).toEqual(['4 luni'])
  })
  it('#3452 / #6363 (lic. 3): „cel puțin egală cu valabilitatea ofertei, respectiv 4 luni”', () => {
    expect(d('Valabilitatea garanției de participare cel puțin egală cu valabilitatea ofertei, respectiv 4 luni de la data-limită de depunere.')).toEqual(['4 luni'])
    expect(d('Ofertantul va constitui garanția de participare în cuantum de 292.641,99 lei. Perioada de valabilitate va fi cel puțin egală cu valabilitatea ofertei, respectiv 4 luni de la data-limită de depunere.')).toEqual(['4 luni'])
  })
  it('#1585 (lic. 9): „valabilă 4 luni de la termenul limită”', () => {
    expect(d('Garanție de participare de 62.367,24 lei, valabilă 4 luni de la termenul limită de depunere a ofertelor, irevocabilă și necondiționată, conform art. 154 Legea 98/2016.')).toEqual(['4 luni'])
  })
  it('#4229 (lic. 15): „minim 120 zile (4 luni)” → ambele durate', () => {
    expect(d('Garanția de participare trebuie să aibă valabilitate cel puțin egală cu valabilitatea ofertei, minim 120 zile (4 luni) de la data limită de depunere.')).toEqual(['4 luni', '120 zile'])
  })
  it('#4341 (lic. 15): „Valabilitatea garanției de participare: minim 4 luni.”', () => {
    expect(d('Valabilitatea garanției de participare: minim 4 luni.')).toEqual(['4 luni'])
  })
  it('#5646 (lic. 100): „valabilitate 4 luni de la data limită … inclusiv”', () => {
    expect(d('Garanția de participare trebuie să aibă valabilitate 4 luni de la data limită de depunere a ofertei, inclusiv, și să fie irevocabilă.')).toEqual(['4 luni'])
  })
  it('numere în litere și cu diacritice în ambele variante (ș/ş, ț/ţ)', () => {
    expect(d('valabilă patru (4) luni de la data limită')).toEqual(['4 luni'])
    expect(d('valabilă 4 (patru) luni de la data limită')).toEqual(['4 luni'])
    expect(d('perioada de valabilitate: şase luni')).toEqual(['6 luni'])
    expect(d('valabilitatea garanţiei: o lună de la termen')).toEqual(['1 luni'])
    expect(d('valabilitate 120 (o sută douăzeci) de zile de la data limită')).toEqual(['120 zile'])
    expect(d('valabilitate o sută cincizeci (150) de zile')).toEqual(['150 zile'])
  })
  it('formularea veche „NNN de zile” se citește în continuare', () => {
    expect(d('Perioada de valabilitate a garanției: 90 de zile de la data limită stabilită pentru depunerea ofertelor')).toEqual(['90 zile'])
    expect(d('garanția de participare, valabilă 150 zile calendaristice de la data limită')).toEqual(['150 zile'])
  })
  it('fără durată de valabilitate → nimic (#6386, #6427 din lic. 95, #5240 din lic. 100)', () => {
    expect(d('Garantie de participare de 370.000 lei, constituita conform art. 154 din Legea 98/2016; virament in contul RO71TREZ2015006XXX000189, Trezoreria Calarasi, UAT Valcelele.')).toEqual([])
    expect(d('Prezentarea garanției de participare.')).toEqual([])
    expect(d('Garantie de participare in cuantum de 405.830 lei, irevocabila si neconditionata, cu valabilitate cel putin egala cu perioada de valabilitate a ofertei.')).toEqual([])
  })
  it('nu confundă alte termene cu valabilitatea', () => {
    expect(d('Garanția de participare se restituie în 3 zile lucrătoare de la semnarea contractului.')).toEqual([])
    expect(d('Garanția de participare, în original, se prezintă în 5 zile de la data comunicării.')).toEqual([])   // sub 30 de zile
    expect(d('Garanția de participare se depune odată cu oferta; garanția de bună execuție e valabilă pe durata contractului, 12 luni de la semnare.')).toEqual([])
    expect(d('Garanție de participare 1% (valoare estimată 6236724,56 RON); durata contractului 12 luni.')).toEqual([])
  })
})

describe('clasificaSurse', () => {
  it('fișa licitației + cerințe; sar peste versiunile înlocuite și „nu se aplică”', () => {
    const s = clasificaSurse({ fisa: '370.000 lei … (4 luni de la termenul-limită)', cerinte: [
      { id: 1, text_cerinta: 'Garanție de participare 26.000 lei.', stare: 'de_analizat', inlocuita_de: null },
      { id: 2, text_cerinta: 'Garanția de participare, valabilă 90 de zile.', stare: 'de_analizat', inlocuita_de: 7 },
      { id: 3, text_cerinta: 'Garanţie de participare 30.572 RON.', stare: 'nu_se_aplica', inlocuita_de: null },
      { id: 4, text_cerinta: 'Ofertantul menține oferta valabilă minim 4 luni de la termenul limită de primire a ofertelor.', stare: 'de_analizat', inlocuita_de: null },
      { id: 5, text_cerinta: 'Aviz ANPM valabil pe toată durata contractului (12 luni).', stare: 'de_analizat', inlocuita_de: null },
    ] })
    expect(s.garantie.map(x => x.eticheta)).toEqual(['fișa licitației (câmpul „garanție de participare”)', 'cerința #1'])
    expect(s.oferta.map(x => x.eticheta)).toEqual(['cerința #4 (valabilitatea ofertei)'])
  })
  it('fără nimic → liste goale', () => {
    expect(clasificaSurse({})).toEqual({ garantie: [], oferta: [] })
  })
})

describe('propuneValabilitate — fără valoare implicită', () => {
  it('lic. 95: doar fișa conține durata → 4 luni, 19.02.2027, 123 de zile', () => {
    const surse = clasificaSurse({ fisa: '370.000 lei; valabilitate ≥ perioada de valabilitate a ofertei (4 luni de la termenul-limită).', cerinte: [
      { id: 6386, text_cerinta: 'Garantie de participare de 370.000 lei, constituita conform art. 154 din Legea 98/2016; virament in contul RO71TREZ2015006XXX000189, Trezoreria Calarasi, UAT Valcelele.', stare: 'de_analizat', inlocuita_de: null },
      { id: 6427, text_cerinta: 'Prezentarea garanției de participare.', stare: 'de_analizat', inlocuita_de: null },
    ] })
    const p = propuneValabilitate(surse, '2026-10-19')
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(p.sursa.eticheta).toMatch(/fișa licitației/)
    expect(p.sursa.fragment).toMatch(/4 luni de la termenul-limită/)
    expect(calculeazaValabilitate(p.durata, '2026-10-19')).toEqual({ pana: '2027-02-19', zile: 123 })
  })
  it('lic. 95 FĂRĂ câmpul din fișă (doar cerințele 6386/6427) → gol + mesaj, NU 90', () => {
    const p = propuneValabilitate(clasificaSurse({ cerinte: [
      { id: 6386, text_cerinta: 'Garantie de participare de 370.000 lei, constituita conform art. 154 din Legea 98/2016.', inlocuita_de: null },
      { id: 6427, text_cerinta: 'Prezentarea garanției de participare.', inlocuita_de: null },
    ] }), '2026-10-19')
    expect(p.durata).toBe(null)
    expect(p.motiv).toBe(MESAJ_NECITIT)
    expect(p.motiv).toMatch(/completează manual/)
  })
  it('nicio sursă → gol (nici 90, nici 150)', () => {
    const p = propuneValabilitate({ garantie: [], oferta: [] }, '2026-10-19')
    expect(p.durata).toBe(null)
  })
  it('lic. 15: „120 zile (4 luni)” + „minim 4 luni” → 4 luni (expiră mai târziu), cu 120 zile la atenționare', () => {
    const surse = clasificaSurse({ cerinte: [
      { id: 4229, text_cerinta: 'Garanția de participare trebuie să aibă valabilitate cel puțin egală cu valabilitatea ofertei, minim 120 zile (4 luni) de la data limită de depunere.', inlocuita_de: null },
      { id: 4341, text_cerinta: 'Valabilitatea garanției de participare: minim 4 luni.', inlocuita_de: null },
    ] })
    const p = propuneValabilitate(surse, '2026-10-12')
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(calculeazaValabilitate(p.durata, '2026-10-12').pana).toBe('2027-02-12')
    expect(p.alte).toEqual([{ n: 120, unitate: 'zile', eticheta: 'cerința #4229', pana: '2027-02-09' }])
  })
  it('când zilele depășesc lunile, câștigă zilele', () => {
    const p = propuneValabilitate({ garantie: [{ eticheta: 'x', text: 'garanția de participare: valabilitate minim 4 luni, respectiv 150 de zile de la data limită' }], oferta: [] }, '2026-10-19')
    expect(p.durata).toEqual({ n: 150, unitate: 'zile' })
  })
  it('lic. 100: garanția „cel puțin egală cu valabilitatea ofertei” → durata din cerința despre ofertă, marcată', () => {
    const surse = clasificaSurse({ cerinte: [
      { id: 5240, text_cerinta: 'Garantie de participare in cuantum de 405.830 lei, irevocabila si neconditionata, cu valabilitate cel putin egala cu perioada de valabilitate a ofertei.', inlocuita_de: null },
      { id: 9001, text_cerinta: 'Ofertantul menține oferta valabilă minim 4 luni de la termenul limită de primire a ofertelor.', inlocuita_de: null },
    ] })
    const p = propuneValabilitate(surse, '2026-10-30')
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(p.dinOferta).toBe(true)
    expect(p.sursa.eticheta).toBe('cerința #9001 (valabilitatea ofertei)')
    expect(calculeazaValabilitate(p.durata, '2026-10-30').pana).toBe('2027-02-28')
  })
  it('fără legătură explicită garanție ↔ ofertă, valabilitatea ofertei NU se împrumută', () => {
    const surse = clasificaSurse({ cerinte: [
      { id: 1, text_cerinta: 'Garanție de participare 10.037,58 lei, irevocabilă.', inlocuita_de: null },
      { id: 2, text_cerinta: 'Ofertantul menține oferta valabilă minim 4 luni de la termenul limită.', inlocuita_de: null },
    ] })
    expect(propuneValabilitate(surse, '2026-10-02').durata).toBe(null)
  })
  it('fără termen de depunere: propune durata, dar nu inventează data', () => {
    const p = propuneValabilitate({ garantie: [{ eticheta: 'x', text: 'garanție de participare valabilă 4 luni de la data limită' }], oferta: [] }, null)
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(calculeazaValabilitate(p.durata, null)).toEqual({ pana: null, zile: null })
    expect(calculeazaValabilitate({ n: 120, unitate: 'zile' }, null)).toEqual({ pana: null, zile: 120 })
  })
  it('durată goală / zero → null (câmpul rămâne gol)', () => {
    expect(calculeazaValabilitate(null, '2026-10-19')).toBe(null)
    expect(calculeazaValabilitate({ n: '', unitate: 'luni' }, '2026-10-19')).toBe(null)
    expect(calculeazaValabilitate({ n: 0, unitate: 'zile' }, '2026-10-19')).toBe(null)
  })
})

describe('recalculare la decalarea termenului de depunere', () => {
  it('lic. 3 (garanția #1): 120 zile de la 24.09 → termen mutat la 14.10; cerința 4 luni → 14.02.2027', () => {
    const cerinta = { durata: { n: 4, unitate: 'luni' }, eticheta: 'cerința #3452' }
    const anterior = { durata: { n: 120, unitate: 'zile' }, eticheta: 'durata de la cerere' }
    const a = alegeDurataActualizare([cerinta, anterior], '2026-10-14')
    expect(a).toEqual({ durata: { n: 4, unitate: 'luni' }, eticheta: 'cerința #3452' })
    expect(calculeazaValabilitate(a.durata, '2026-10-14')).toEqual({ pana: '2027-02-14', zile: 123 })
    // polița existentă (până la 22.01.2027) nu mai acoperă
    expect('2027-01-22' < calculeazaValabilitate(a.durata, '2026-10-14').pana).toBe(true)
  })
  it('omul a ales mai mult decât minimul (150 zile) → nu se scurtează la decalare', () => {
    const a = alegeDurataActualizare([{ durata: { n: 4, unitate: 'luni' }, eticheta: 'cerința' }, { durata: { n: 150, unitate: 'zile' }, eticheta: 'cerere' }], '2026-11-02')
    expect(a.durata).toEqual({ n: 150, unitate: 'zile' })
  })
  it('4 luni recitite pe termenul nou dau alt număr de zile (123 → 120), nu se copiază zilele vechi', () => {
    const a = alegeDurataActualizare([{ durata: { n: 4, unitate: 'luni' }, eticheta: 'cerința' }], '2026-12-31')
    expect(calculeazaValabilitate(a.durata, '2026-12-31')).toEqual({ pana: '2027-04-30', zile: 120 })
  })
  it('nici cerință citibilă, nici durată anterioară → null (completare manuală)', () => {
    expect(alegeDurataActualizare([{ durata: null, eticheta: 'cerința' }, { durata: null, eticheta: 'cerere' }], '2026-10-19')).toBe(null)
  })
})

describe('textDurata', () => {
  it('română corectă', () => {
    expect(textDurata({ n: 4, unitate: 'luni' })).toBe('4 luni')
    expect(textDurata({ n: 1, unitate: 'luni' })).toBe('1 lună')
    expect(textDurata({ n: 24, unitate: 'luni' })).toBe('24 de luni')
    expect(textDurata({ n: 123, unitate: 'zile' })).toBe('123 de zile')
    expect(textDurata({ n: 105, unitate: 'zile' })).toBe('105 zile')
    expect(textDurata({ n: 100, unitate: 'zile' })).toBe('100 de zile')
    expect(textDurata(null)).toBe('')
  })
})
