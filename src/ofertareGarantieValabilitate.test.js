// R7 (26.09.2026): valabilitatea garanției de participare. Textele de mai jos sunt formulările REALE
// din ofertare_cerinte / ofertare_licitatii.garantie_participare (SELECT pe BD, 26.09.2026) — id-ul e în titlu.
import { describe, it, expect } from 'vitest'
import {
  plusZile, plusLuni, zileIntre, ziDepunere, extrageDurate, clasificaSurse, propuneValabilitate,
  calculeazaValabilitate, propuneActualizare, textDurata, MESAJ_NECITIT, MESAJ_CONFLICT, ETICHETA_REZUMAT,
  stareGarantie, trimiteActualizareSigur, patchActAditional, ultimaPrelungire, faraMarcaje, liniePrelungireCeruta, fmtIso,
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
  it('intrări invalide → null, nu o dată inventată (inclusiv durate neîntregi: 4,6 luni nu devine 5)', () => {
    expect(plusLuni('2026-10-19', 4.6)).toBe(null)
    expect(plusZile('2026-10-19', 90.5)).toBe(null)
    expect(plusLuni('2026-10-19', '4')).toBe('2027-02-19')
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
    expect(d('Garanția de participare, valabilă patru (4) luni de la data limită')).toEqual(['4 luni'])
    expect(d('Garanția de participare, valabilă 4 (patru) luni de la data limită')).toEqual(['4 luni'])
    expect(d('perioada de valabilitate a garanţiei: şase luni')).toEqual(['6 luni'])
    expect(d('valabilitatea garanţiei: o lună de la termen')).toEqual(['1 luni'])
    expect(d('Garanţia de participare: valabilitate 120 (o sută douăzeci) de zile de la data limită')).toEqual(['120 zile'])
    expect(d('Garanția de participare: valabilitate o sută cincizeci (150) de zile')).toEqual(['150 zile'])
  })
  it('formulările cerute (luni / litere / „de la…”) și când propoziția nu numește garanția', () => {
    expect(d('VALABILITATE: PATRU LUNI DE LA DATA LIMITĂ')).toEqual(['4 luni'])
    expect(d('valabilă 4 luni calendaristice de la termen')).toEqual(['4 luni'])
    expect(d('valabilitate o sută douăzeci de zile de la termen')).toEqual(['120 zile'])
    expect(d('valabilă 4 luni (120 de zile) de la data limită')).toEqual(['4 luni', '120 zile'])
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
  it('garanția ca subiect implicit al sursei: „Garanție … lei. Valabilitate: 4 luni …” se citește; alt subiect în propoziție, nu', () => {
    expect(d('Garanție de participare 26.000 lei. Valabilitate: 4 luni de la termenul limită.')).toEqual(['4 luni'])
    expect(d('370.000 lei; termen de execuție 18 luni; valabilitate 4 luni')).toEqual(['4 luni'])
    expect(d('Garanția de participare se constituie prin virament. Certificatul constatator trebuie să fie valabil 30 de zile.')).toEqual([])
    expect(d('Garanție de participare 1%. Autorizația ANRE valabilă 12 luni de la emitere.')).toEqual([])
    const p = propuneValabilitate(clasificaSurse({ fisa: '370.000 lei; valabilă 4 luni de la termenul-limită' }), '2026-10-19')
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
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
    // cerințele (citate din documentație) înaintea rezumatului din fișă: la durate egale se citează cerința
    expect(s.garantie.map(x => x.eticheta)).toEqual(['cerința #1', ETICHETA_REZUMAT])
    expect(s.garantie[1].secundara).toBe(true)
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
    // singura sursă e rezumatul scris în platformă (nu pasajul FD pag. 16) ⇒ marcat secundar în UI
    expect(p.sursa.eticheta).toBe(ETICHETA_REZUMAT)
    expect(p.sursa.secundara).toBe(true)
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
    expect(p.alte.map(({ fragment, ...r }) => r)).toEqual([{ n: 120, unitate: 'zile', eticheta: 'cerința #4229', pana: '2027-02-09' }])
    expect(p.conflict).toBe(false)   // 3 zile între 09.02 și 12.02 — sub pragul de 31
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

describe('recalculare la decalarea termenului de depunere — propuneActualizare (apelul exact din UI)', () => {
  const cer4 = { durata: { n: 4, unitate: 'luni' }, sursa: { eticheta: 'cerința #3452 (doc 63, pag. 12)' } }
  it('lic. 3 (garanția #1): 120 zile la cerere, termen mutat la 14.10; cerința 4 luni → 14.02.2027', () => {
    const a = propuneActualizare(cer4, 120)
    expect(a).toEqual({ durata: { n: 4, unitate: 'luni' }, eticheta: 'cerința #3452 (doc 63, pag. 12)', rezerva: false })
    expect(calculeazaValabilitate(a.durata, '2026-10-14')).toEqual({ pana: '2027-02-14', zile: 123 })
  })
  it('[cerință 4 luni, valabil_zile 123] la 31.12.2026 → 30.04.2027 (4 luni), NU 03.05.2027 (123 de zile vechi)', () => {
    const a = propuneActualizare(cer4, 123)
    expect(a.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(calculeazaValabilitate(a.durata, '2026-12-31')).toEqual({ pana: '2027-04-30', zile: 120 })
  })
  it('cerința necitibilă → durata cererii anterioare ca REZERVĂ, etichetată ca atare (nu „confirmată”)', () => {
    const a = propuneActualizare({ durata: null }, 120)
    expect(a.rezerva).toBe(true)
    expect(a.durata).toEqual({ n: 120, unitate: 'zile' })
    expect(a.eticheta).toMatch(/cererii anterioare .*cerința nu a putut fi citită/)
    expect(a.eticheta).not.toMatch(/confirmat/)
    expect(calculeazaValabilitate(a.durata, '2026-10-19').pana).toBe('2027-02-16')
  })
  it('nici cerință citibilă, nici durată anterioară → null (completare manuală)', () => {
    expect(propuneActualizare({ durata: null }, null)).toBe(null)
    expect(propuneActualizare(null, 0)).toBe(null)
  })
})

describe('extrageDurate — false pozitive (verificator R7)', () => {
  const d = t => extrageDurate(t).map(x => `${x.n} ${x.unitate}`)
  it('termenul de execuție din propoziția următoare nu devine valabilitate', () => {
    expect(d('Garanție de participare 26.000 lei, valabilă 4 luni de la termen. Termen de execuție: 18 luni.')).toEqual(['4 luni'])
    const p = propuneValabilitate({ garantie: [{ eticheta: 'x', text: 'Garanție de participare 26.000 lei, valabilă 4 luni de la termen. Termen de execuție: 18 luni.' }], oferta: [] }, '2026-10-19')
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(p.alte).toEqual([])
  })
  it('perioada de garanție a lucrărilor, restituirea, reținerea — nu sunt valabilități', () => {
    expect(d('Garanție de participare 26.000 lei; perioada de garanție: 36 de luni de la recepție.')).toEqual([])
    expect(d('Garanția de participare se restituie în termen de 30 de zile de la semnarea contractului.')).toEqual([])
    expect(d('Garanția de participare se reține până la semnarea contractului, dar nu mai mult de 60 de zile de la comunicarea rezultatului.')).toEqual([])
  })
  it('fără „valabil”: se citește doar cu garanția numită ȘI ancora „de la data / termenul …”', () => {
    expect(d('Garanția de participare: 4 luni de la data limită de depunere.')).toEqual(['4 luni'])
    expect(d('Garanția de participare se constituie pentru 120 de zile începând cu data limită.')).toEqual(['120 zile'])
    expect(d('4 luni de la data limită de depunere.')).toEqual([])
  })
  it('„19 luna februarie” e o dată, „o lună înainte de expirare” și „prelungibilă cu 30 de zile” nu sunt durate', () => {
    expect(d('Garanția de participare valabilă până pe 19 luna februarie 2027.')).toEqual([])
    expect(d('valabilitatea garanției se prelungește cu o lună înainte de expirare')).toEqual([])
    expect(d('Garanția de participare: valabilitate 90 de zile de la termen, prelungibilă cu 30 de zile.')).toEqual(['90 zile'])
  })
  it('diacritice descompuse (NFD: s + U+0326, t + U+0326) se citesc', () => {
    expect(d('valabilitatea garant\u0326iei de participare: s\u0326ase luni de la termen')).toEqual(['6 luni'])
  })
  it('FD 479 pag. 16 (lic. 95), cu rândul rupt de PDF în mijlocul frazei', () => {
    expect(d('Referitor la garanția de participare - Perioada de valabilitate a garanției de participare va fi cel puțin egală cu perioada de valabilitate a\nofertei, respectiv 4 luni de la data limita de depunere a ofertei stabilită prin anunțul de participare publicat în SEAP.')).toEqual(['4 luni'])
  })
  it('„Ofertantul … valabil 12 luni” (certificat ISO) nu e cerință despre valabilitatea ofertei', () => {
    const cer = [
      { id: 5240, text_cerinta: 'Garantie de participare in cuantum de 405.830 lei, irevocabila si neconditionata, cu valabilitate cel putin egala cu perioada de valabilitate a ofertei.', inlocuita_de: null },
      { id: 1, text_cerinta: 'Ofertantul prezintă certificat ISO 9001 valabil minim 12 luni de la data depunerii ofertelor.', inlocuita_de: null },
      { id: 4, text_cerinta: 'Ofertantul va prezenta polița RC profesională valabilă pe o perioadă de minim 12 luni de la semnare.', inlocuita_de: null },
      { id: 2, text_cerinta: 'Ofertantul menține oferta valabilă minim 4 luni de la termenul limită.', inlocuita_de: null },
    ]
    const s = clasificaSurse({ cerinte: cer })
    expect(s.oferta.map(x => x.eticheta)).toEqual(['cerința #2 (valabilitatea ofertei)'])
    const p = propuneValabilitate(s, '2026-10-19')
    expect(p.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(p.dinOferta).toBe(true)
  })
  it('#4451 („să prelungească perioada de valabilitate a ofertei și, după caz, a garanției”) nu leagă garanția de ofertă', () => {
    const p = propuneValabilitate(clasificaSurse({ cerinte: [
      { id: 4451, text_cerinta: 'La solicitarea AC, ofertantul trebuie să prelungească perioada de valabilitate a ofertei și, după caz, a garanției de participare.', inlocuita_de: null },
      { id: 4348, text_cerinta: 'Ofertantul isi menine oferta valabila minim 4 luni de la termenul limita de primire a ofertelor.', inlocuita_de: null },
    ] }), '2026-10-12')
    expect(p.durata).toBe(null)
    expect(p.motiv).toBe(MESAJ_NECITIT)
  })
  it('durate care diferă cu peste 31 de zile → câmp GOL, ambele variante afișate (nu „cea mai lungă”)', () => {
    const p = propuneValabilitate(clasificaSurse({ cerinte: [
      { id: 10, text_cerinta: 'Garanția de participare valabilă 4 luni de la termenul limită.', inlocuita_de: null },
      { id: 11, text_cerinta: 'Valabilitatea garanției de participare: minim 6 luni.', inlocuita_de: null },
    ] }), '2026-10-19')
    expect(p.durata).toBe(null)
    expect(p.conflict).toBe(true)
    expect(p.motiv).toBe(MESAJ_CONFLICT)
    expect(p.motiv).toMatch(/completează manual/)
    expect(p.alte.map(a => `${a.n} ${a.unitate} → ${a.pana} @${a.eticheta}`)).toEqual(['6 luni → 2027-04-19 @cerința #11', '4 luni → 2027-02-19 @cerința #10'])
  })
  it('fără termen de depunere, conflictul se judecă pe durate aproximative', () => {
    const p = propuneValabilitate({ garantie: [{ eticheta: 'x', text: 'Garanția de participare valabilă 4 luni; valabilitatea garanției de participare 180 de zile.' }], oferta: [] }, null)
    expect(p.conflict).toBe(true)
    expect(p.durata).toBe(null)
  })
})

describe('proveniența sursei', () => {
  it('cerința se citează cu documentul și pagina; la aceeași durată câștigă cerința, nu rezumatul din fișă', () => {
    const p = propuneValabilitate(clasificaSurse({
      fisa: '62.367,24 lei, irevocabilă și necondiționată, constituită conform art.154 din Legea nr.98/2016, valabilă 4 luni de la termenul limită de depunere a ofertelor',
      cerinte: [{ id: 1585, text_cerinta: 'Garanție de participare de 62.367,24 lei, valabilă 4 luni de la termenul limită de depunere a ofertelor, irevocabilă și necondiționată, conform art. 154 Legea 98/2016.', inlocuita_de: null, sursa_document_id: 147 }],
    }), '2026-09-22')
    expect(p.sursa.eticheta).toBe('cerința #1585 (doc 147)')
    expect(p.sursa.secundara).toBe(false)
    expect(p.alte).toEqual([])
  })
  it('lic. 3: „cerința #3452 (doc 63, pag. 12)”', () => {
    const p = propuneValabilitate(clasificaSurse({ fisa: '292641.99', cerinte: [
      { id: 3452, text_cerinta: 'Valabilitatea garanției de participare cel puțin egală cu valabilitatea ofertei, respectiv 4 luni de la data-limită de depunere.', inlocuita_de: null, sursa_document_id: 63, sursa_pagina: 12 },
    ] }), '2026-10-14')
    expect(p.sursa.eticheta).toBe('cerința #3452 (doc 63, pag. 12)')
  })
})

// ── polița în ORIGINAL + termen decalat: rândul REAL ofertare_garantii id 1 (lic. 3), SELECT 26.09.2026
const G1 = Object.freeze({ id: 1, licitatie_id: 3, status: 'original', valabil_zile: 120, valabil_de: '2026-09-24', valabil_pana: '2027-01-22',
  termen_la_cerere: '2026-09-24 00:00:00+00', actualizare_trimisa_la: null, original_la: '2026-09-22 09:36:43.303+00', polita_nr: 'AX1008360', observatii: null })
const DE_ACUM = '2026-10-14', TERMEN = '2026-10-14T12:00:00+00:00', NECESAR = '2027-02-14'
const cerut = { valabil_de: DE_ACUM, valabil_pana: NECESAR, valabil_zile: 123, termen_la_cerere: TERMEN }
const linie = liniePrelungireCeruta({ azi: '2026-09-26', termenVechi: '2026-09-24', termenNou: DE_ACUM, polita: 'AX1008360', acDe: '2026-09-24', acPana: '2027-01-22', de: DE_ACUM, pana: NECESAR, durata: { n: 4, unitate: 'luni' } })
// BD în memorie + edge fn simulată (la succes scrie actualizare_trimisa_la, ca ofertare-garantie-mail)
const bd = (rand, { mailEsueaza = false, esueazaPatch = () => false } = {}) => {
  const row = { ...rand }, apeluri = []
  return { row, apeluri,
    patch: async p => { apeluri.push(p); if (esueazaPatch(p, apeluri.length)) throw new Error('rețea'); Object.assign(row, p) },
    mail: async () => { if (mailEsueaza) throw new Error('token invalid'); row.actualizare_trimisa_la = '2026-09-26T10:00:00+00:00'; return { ok: true } } }
}
const stare = row => stareGarantie({ g: row, deAcum: DE_ACUM, necesarPana: NECESAR })

describe('garanția #1 (lic. 3): polița în original, termen decalat 24.09 → 14.10', () => {
  it('înainte de orice: decalată, insuficientă, antet cu perioada REALĂ a poliței', () => {
    const s = stare(G1)
    expect(s).toMatchObject({ decalat: true, insuficient: true, prelungireCurenta: null, acoperaPana: '2027-01-22' })
    expect(s.antet).toBe('polița valabilă 24.09.2026 – 22.01.2027')
  })
  it('mailul eșuează (401) ⇒ BD revine EXACT la rândul inițial; avertizările rămân', async () => {
    const b = bd(G1, { mailEsueaza: true })
    const r = await trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: b.mail })
    expect(r).toMatchObject({ ok: false, mail: false, revenire: true, eroare: 'token invalid' })
    expect(b.row).toEqual({ ...G1 })
    const s = stare(b.row)
    expect(s).toMatchObject({ decalat: true, insuficient: true, inAsteptare: null })
    expect(s.antet).toBe('polița valabilă 24.09.2026 – 22.01.2027')
  })
  it('mailul eșuează ȘI revenirea eșuează ⇒ rezultatul spune ambele erori (UI le afișează)', async () => {
    const b = bd(G1, { mailEsueaza: true, esueazaPatch: (p, n) => n === 2 })
    const r = await trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: b.mail })
    expect(r).toMatchObject({ ok: false, mail: false, revenire: false, eroare: 'token invalid', eroareRevenire: 'rețea' })
  })
  it('primul patch eșuează ⇒ nu pleacă niciun mail, eroarea urcă, BD neatinsă', async () => {
    const b = bd(G1, { esueazaPatch: () => true })
    let mailuri = 0
    await expect(trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: async () => { mailuri++ } })).rejects.toThrow('rețea')
    expect(mailuri).toBe(0)
    expect(b.row).toEqual({ ...G1 })
  })
  it('mailul pleacă ⇒ polița rămâne afișată cu perioada REALĂ; prelungirea e „cerută, neconfirmată”; insuficiența rămâne', async () => {
    const b = bd(G1)
    const r = await trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: b.mail })
    expect(r).toMatchObject({ ok: true, mail: true, revenire: true })
    // mailul a citit din BD perioada cerută (primul patch), apoi s-a revenit la perioada poliței
    expect(b.apeluri[0]).toMatchObject({ valabil_pana: NECESAR, termen_la_cerere: TERMEN })
    expect(b.row).toMatchObject({ valabil_de: '2026-09-24', valabil_pana: '2027-01-22', valabil_zile: 120, termen_la_cerere: G1.termen_la_cerere })
    const s = stare(b.row)
    expect(s.prelungireCurenta).toMatchObject({ de: DE_ACUM, pana: NECESAR, acDe: '2026-09-24', acPana: '2027-01-22' })
    expect(s.insuficient).toBe(true)
    expect(s.antet).toBe('polița valabilă 24.09.2026 – 22.01.2027 · prelungire cerută la 14.10.2026 – 14.02.2027 (neconfirmată)')
    expect(faraMarcaje(b.row.observatii)).not.toMatch(/⟦/)
    expect(faraMarcaje(b.row.observatii)).toMatch(/polița nr\. AX1008360 \(original\) acoperă 24\.09\.2026 – 22\.01\.2027; cerută brokerului perioada nouă 14\.10\.2026 – 14\.02\.2027 \(4 luni\) — neconfirmată/)
  })
  it('mailul pleacă, dar revenirea eșuează de 3 ori ⇒ acoperirea se ia din marcaj (tot 22.01.2027), avertizarea rămâne', async () => {
    const b = bd(G1, { esueazaPatch: p => p.valabil_pana === '2027-01-22' })
    const r = await trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: b.mail })
    expect(r).toMatchObject({ ok: true, mail: true, revenire: false })
    expect(b.apeluri.length).toBe(4)
    expect(b.row.valabil_pana).toBe(NECESAR)   // în BD a rămas perioada cerută…
    const s = stare(b.row)
    expect(s.acoperaPana).toBe('2027-01-22')   // …dar UI arată ce acoperă polița
    expect(s.insuficient).toBe(true)
    expect(s.prelungireCurenta).not.toBe(null)
    expect(s.antet).toMatch(/^polița valabilă 24\.09\.2026 – 22\.01\.2027 · prelungire cerută/)
  })
  it('„act adițional primit” închide prelungirea: perioada nouă devine perioada poliței', async () => {
    const b = bd(G1)
    await trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: b.mail })
    const p = patchActAditional({ g: b.row, de: DE_ACUM, pana: NECESAR, termenDepunere: TERMEN, azi: '2026-10-01' })
    expect(p).toMatchObject({ valabil_de: DE_ACUM, valabil_pana: NECESAR, valabil_zile: 123, termen_la_cerere: TERMEN })
    await b.patch(p)
    const s = stare(b.row)
    expect(s).toMatchObject({ decalat: false, insuficient: false, inAsteptare: null, prelungireCurenta: null })
    expect(s.antet).toBe('polița valabilă 14.10.2026 – 14.02.2027')
    expect(ultimaPrelungire(b.row.observatii).tip).toBe('act')
    expect(faraMarcaje(b.row.observatii).split('\n')).toHaveLength(2)
  })
  it('act adițional mai scurt decât cerința ⇒ insuficient rămâne; perioadă inversată ⇒ refuzat', () => {
    const p = patchActAditional({ g: G1, de: DE_ACUM, pana: '2027-02-10', termenDepunere: TERMEN, azi: '2026-10-01' })
    expect(stare({ ...G1, ...p }).insuficient).toBe(true)
    expect(patchActAditional({ g: G1, de: DE_ACUM, pana: DE_ACUM, termenDepunere: TERMEN, azi: '2026-10-01' })).toBe(null)
  })
  it('termenul se mută DIN NOU după cerere ⇒ cererea veche nu mai acoperă termenul curent', async () => {
    const b = bd(G1)
    await trimiteActualizareSigur({ g: G1, cerut, original: true, linieObs: linie, patch: b.patch, mail: b.mail })
    const s = stareGarantie({ g: b.row, deAcum: '2026-10-28', necesarPana: '2027-02-28' })
    expect(s.prelungireCurenta).toBe(null)
    expect(s.prelungireVeche).toMatchObject({ de: DE_ACUM })
    expect(s.decalat).toBe(true)
    expect(s.acoperaPana).toBe('2027-01-22')
  })
  it('poliță încă necerută în original (cerere_trimisa): perioada trimisă e „perioadă cerută”, fără marcaj', async () => {
    const g = { ...G1, status: 'cerere_trimisa', polita_nr: null, original_la: null }
    const b = bd(g)
    const r = await trimiteActualizareSigur({ g, cerut, original: false, linieObs: null, patch: b.patch, mail: b.mail })
    expect(r).toMatchObject({ ok: true, mail: true })
    expect(b.apeluri).toHaveLength(1)
    expect(b.row.observatii).toBe(null)
    expect(stare(b.row).antet).toBe('perioadă cerută 14.10.2026 – 14.02.2027')
    // mail eșuat pe o cerere ⇒ tot revenire
    const b2 = bd(g, { mailEsueaza: true })
    await trimiteActualizareSigur({ g, cerut, original: false, linieObs: null, patch: b2.patch, mail: b2.mail })
    expect(b2.row).toEqual({ ...g })
  })
  it('ultimaPrelungire / faraMarcaje / fmtIso', () => {
    expect(ultimaPrelungire(null)).toBe(null)
    expect(ultimaPrelungire('x ⟦prelungire-ceruta 2026-10-14 2027-02-14 acoperea 2026-09-24 2027-01-22⟧\ny ⟦act-aditional 2026-10-14 2027-02-14⟧')).toEqual({ tip: 'act', de: '2026-10-14', pana: '2027-02-14', acDe: null, acPana: null })
    expect(faraMarcaje('text liber ⟦act-aditional 2026-10-14 2027-02-14⟧\naltă notă')).toBe('text liber\naltă notă')
    expect(fmtIso('2027-02-14')).toBe('14.02.2027')
    expect(fmtIso(null)).toBe('—')
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
