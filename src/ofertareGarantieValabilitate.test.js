// R7 (26.09.2026): valabilitatea garanției de participare. Textele de mai jos sunt formulările REALE
// din ofertare_cerinte / ofertare_licitatii.garantie_participare (SELECT pe BD, 26.09.2026) — id-ul e în titlu.
import { describe, it, expect } from 'vitest'
import {
  plusZile, plusLuni, zileIntre, ziDepunere, extrageDurate, clasificaSurse, propuneValabilitate,
  calculeazaValabilitate, propuneActualizare, textDurata, MESAJ_NECITIT, MESAJ_CONFLICT, ETICHETA_REZUMAT,
  stareGarantie, trimiteActualizareSigur, patchActAditional, ultimaPrelungire, faraMarcaje, liniePrelungireCeruta, fmtIso,
  evalueazaGarantie, semnalReverificare, termenMutat, patchVerificatAcoperire, perioadaPolita, NIVEL_REVERIFICARE,
  indicatorGarantie, semnalDinCitire, precompletarePerioada,
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

// ════════════════════════════════════════════════════════════════
// TEST DE PROPAGARE (R7, cerut de Copilot 26.09.2026) — de păstrat:
//  (1) mutarea termenului de depunere recalculează valabilitatea cerută a garanției;
//  (2) garanția existentă primește semnalul de reverificare când nu mai acoperă noul termen + valabilitatea cerută;
//  (3) polița EMISĂ nu e considerată prelungită: perioada ei rămâne cea din poliță până la actul adițional;
//  (4) fără 90 de zile implicit (#487).
// Sursele sunt cele REALE ale lic. 95 (Vâlcelele): rezumatul din fișă + cerințele 6386/6427 (fără durată).
// ════════════════════════════════════════════════════════════════
describe('propagarea termenului de depunere → garanția de participare (lic. 95, T → T+30 zile)', () => {
  const FISA_95 = '370.000 lei (fișa de date III.1.6.a, doc 479), conform art. 154 L98/2016; virament sau instrument de garantare; valabilitate ≥ perioada de valabilitate a ofertei (4 luni de la termenul-limită).'
  const CER_95 = [
    { id: 6386, text_cerinta: 'Garantie de participare de 370.000 lei, constituita conform art. 154 din Legea 98/2016; virament in contul RO71TREZ2015006XXX000189, Trezoreria Calarasi, UAT Valcelele.', stare: 'de_analizat', inlocuita_de: null },
    { id: 6427, text_cerinta: 'Prezentarea garanției de participare.', stare: 'de_analizat', inlocuita_de: null },
  ]
  const T = '2026-10-19T12:00:00+00:00'           // termenul actual al lic. 95 (SELECT 26.09.2026)
  const T30 = '2026-11-18T12:00:00.000Z'          // T + 30 de zile, cum îl scrie formularul (toISOString)
  const X = '2027-02-19'                          // polița emisă pe termenul T: 4 luni de la 19.10.2026
  // polița emisă (în original) pe termenul T, acoperind exact cerința de atunci
  const POLITA = Object.freeze({ id: 99, licitatie_id: 95, status: 'original', polita_nr: 'TEST-95', valabil_de: '2026-10-19', valabil_pana: X, valabil_zile: 123,
    termen_la_cerere: '2026-10-19 12:00:00+00', observatii: null })
  const evalua = (g, termen, extra = {}) => evalueazaGarantie({ g, termenDepunere: termen, fisa: FISA_95, cerinte: CER_95, ...extra })

  it('înainte de mutare (termen T): cerința 4 luni → 19.02.2027; polița o acoperă; niciun semnal (KPI verde e corect)', () => {
    const ev = evalua(POLITA, T)
    expect(ev.deAcum).toBe('2026-10-19')
    expect(ev.propunere.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(ev.necesar).toEqual({ pana: X, zile: 123 })
    expect(ev.st).toMatchObject({ decalat: false, insuficient: false, incepeDupaTermen: false, acoperaPana: X })
    expect(ev.reverificare).toEqual({ da: false, nivel: null, motive: [], acoperaVerificat: true })
  })

  it('SCENARIUL COMPLET: termen T → T+30 ⇒ cerința nouă (18.03.2027), semnal de reverificare, polița emisă rămâne până la X', () => {
    const ev = evalua(POLITA, T30)
    // (1) cerința se recalculează pe termenul nou, în unitatea ei (4 luni calendaristice, nu 123 de zile copiate)
    expect(termenMutat(T, T30)).toEqual({ de: '2026-10-19', la: '2026-11-18' })
    expect(ev.deAcum).toBe('2026-11-18')
    expect(ev.propunere.durata).toEqual({ n: 4, unitate: 'luni' })
    expect(ev.necesar).toEqual({ pana: '2027-03-18', zile: 120 })
    expect(ev.necesar.pana).not.toBe(plusZile('2026-11-18', 123))   // nu „aceeași durată în zile” de la cererea veche
    // (3) polița EMISĂ: perioada rămâne cea din poliță (X), nimic nu o „prelungește”
    expect(ev.st.acoperaDe).toBe('2026-10-19')
    expect(ev.st.acoperaPana).toBe(X)
    expect(POLITA.valabil_pana).toBe(X)                              // rândul nu e atins de recalculare
    expect(ev.st.antet).toBe('polița valabilă 19.10.2026 – 19.02.2027')
    // (2) semnalul: termen mutat + polița nu acoperă cerința nouă ⇒ „nu acoperă termenul”
    expect(ev.st).toMatchObject({ decalat: true, insuficient: true, incepeDupaTermen: false, termenCerere: '2026-10-19' })
    expect(ev.reverificare.da).toBe(true)
    expect(ev.reverificare.nivel).toBe('nu_acopera')
    expect(NIVEL_REVERIFICARE[ev.reverificare.nivel]).toBe('nu acoperă termenul')
    expect(ev.reverificare.motive).toEqual([
      'termenul de depunere s-a mutat (19.10.2026 → 18.11.2026) față de cel pentru care s-a cerut polița',
      'polița acoperă până la 19.02.2027, cerința cere până la 18.03.2027',
    ])
    // nu se poate închide „verificat” fără act adițional: acoperirea nu e dovedită
    expect(ev.reverificare.acoperaVerificat).toBe(false)
    expect(patchVerificatAcoperire({ g: POLITA, ev, termenDepunere: T30, azi: '2026-09-26' })).toBe(null)
  })

  it('T → T+30, polița emisă: cererea de prelungire trimisă NU o prelungește; doar actul adițional o face', async () => {
    const row = { ...POLITA }, patch = async p => { Object.assign(row, p) }, mail = async () => ({ ok: true })
    const ev0 = evalua(row, T30)
    const cerut = { valabil_de: ev0.deAcum, valabil_pana: ev0.necesar.pana, valabil_zile: ev0.necesar.zile, termen_la_cerere: T30 }
    const linieObs = liniePrelungireCeruta({ azi: '2026-09-26', termenVechi: '2026-10-19', termenNou: ev0.deAcum, polita: row.polita_nr,
      acDe: ev0.st.acoperaDe, acPana: ev0.st.acoperaPana, de: cerut.valabil_de, pana: cerut.valabil_pana, durata: ev0.propunere.durata })
    const r = await trimiteActualizareSigur({ g: { ...row }, cerut, original: true, linieObs, patch, mail })
    expect(r).toMatchObject({ ok: true, mail: true, revenire: true })
    const ev1 = evalua(row, T30)
    expect(row.valabil_pana).toBe(X)                                  // BD: perioada poliței, nu cea cerută
    expect(ev1.st.acoperaPana).toBe(X)
    expect(ev1.st.prelungireCurenta).toMatchObject({ de: '2026-11-18', pana: '2027-03-18' })
    expect(ev1.reverificare.nivel).toBe('nu_acopera')                  // semnalul rămâne
    expect(ev1.reverificare.motive).toContain('prelungire cerută la 18.11.2026 – 18.03.2027, neconfirmată (fără act adițional)')
    // actul adițional (confirmat de om) e singurul care schimbă perioada poliței
    await patch(patchActAditional({ g: row, de: '2026-11-18', pana: '2027-03-18', termenDepunere: T30, azi: '2026-10-05' }))
    const ev2 = evalua(row, T30)
    expect(ev2.st.acoperaPana).toBe('2027-03-18')
    expect(ev2.reverificare).toMatchObject({ da: false, nivel: null, motive: [] })
  })

  it('(4) T → T+30 cu cerința NECITIBILĂ: fără 90 de zile implicit — acoperirea rămâne „de reverificat”, nu verde', () => {
    const ev = evalueazaGarantie({ g: POLITA, termenDepunere: T30, fisa: '370.000 lei', cerinte: CER_95 })
    expect(ev.propunere.durata).toBe(null)
    expect(ev.propunere.motiv).toBe(MESAJ_NECITIT)
    expect(ev.necesar).toBe(null)                                      // nici 17.01.2027, nici 18.02.2027 (90 de zile)
    expect(ev.st.insuficient).toBe(false)                              // nu se poate afirma…
    expect(ev.reverificare.da).toBe(true)                              // …dar nici nu e verde
    expect(ev.reverificare.nivel).toBe('de_verificat')
    expect(ev.reverificare.acoperaVerificat).toBe(false)
    expect(ev.reverificare.motive).toContain('valabilitatea cerută pe termenul curent nu a putut fi calculată — acoperirea nu e verificată')
    expect(JSON.stringify(ev)).not.toMatch(/2027-01-17|2027-02-16/)   // T+90 / T+30+90
  })

  it('termen mutat MAI DEVREME (T → T−10): polița începe după ziua depunerii ⇒ nu acoperă', () => {
    const ev = evalua(POLITA, '2026-10-09T12:00:00+00:00')
    expect(ev.necesar.pana).toBe('2027-02-09')
    expect(ev.st).toMatchObject({ decalat: true, insuficient: false, incepeDupaTermen: true })
    expect(ev.reverificare.nivel).toBe('nu_acopera')
    expect(ev.reverificare.motive).toContain('polița începe abia pe 19.10.2026, după ziua depunerii (09.10.2026)')
    expect(patchVerificatAcoperire({ g: POLITA, ev, termenDepunere: '2026-10-09T12:00:00+00:00', azi: '2026-09-26' })).toBe(null)
  })

  it('T → T+30, dar polița emisă e destul de lungă: semnal „de reverificat”; omul confirmă fără act, perioada poliței neschimbată', () => {
    const lunga = { ...POLITA, valabil_pana: '2027-06-30', valabil_zile: 254 }
    const ev = evalua(lunga, T30)
    expect(ev.reverificare).toMatchObject({ da: true, nivel: 'de_verificat', acoperaVerificat: true })
    const p = patchVerificatAcoperire({ g: lunga, ev, termenDepunere: T30, azi: '2026-09-27' })
    expect(Object.keys(p).sort()).toEqual(['observatii', 'termen_la_cerere'])   // valabil_* NU se ating
    expect(p.termen_la_cerere).toBe(T30)
    expect(p.observatii).toBe('27.09.2026: termen 19.10.2026 → 18.11.2026; polița nr. TEST-95 acoperă 19.10.2026 – 30.06.2027, suficient pentru cerință (până la 18.03.2027) — verificat, fără act adițional.')
    const dupa = evalua({ ...lunga, ...p }, T30)
    expect(dupa.st.acoperaPana).toBe('2027-06-30')
    expect(dupa.reverificare).toMatchObject({ da: false, nivel: null })
    // termenul se mută DIN NOU ⇒ semnalul revine
    expect(evalua({ ...lunga, ...p }, '2026-12-01T12:00:00Z').reverificare.da).toBe(true)
  })

  it('polița „achitată” cu perioada actualizată la broker: la „original” se reține perioada DIN POLIȚĂ, nu cea cerută', () => {
    // după mutare, cererea de actualizare (status achitata) a scris în BD perioada cerută + termenul nou…
    const achitata = { ...POLITA, status: 'achitata', polita_nr: null, valabil_de: '2026-11-18', valabil_pana: '2027-03-18', valabil_zile: 120, termen_la_cerere: T30 }
    expect(evalua(achitata, T30).reverificare.da).toBe(false)             // perioadă cerută suficientă (antet „perioadă cerută”)
    expect(evalua(achitata, T30).st.antet).toBe('perioadă cerută 18.11.2026 – 18.03.2027')
    // …dar polița fizică sosită e cea veche (brokerul n-a reemis): omul trece perioada de pe poliță la pasul 4
    const per = perioadaPolita('2026-10-19', X)
    expect(per).toEqual({ valabil_de: '2026-10-19', valabil_pana: X, valabil_zile: 123 })
    const orig = { ...achitata, status: 'original', polita_nr: 'TEST-95', ...per }
    const ev = evalua(orig, T30)
    expect(ev.st.acoperaPana).toBe(X)
    expect(ev.reverificare.nivel).toBe('nu_acopera')
    // perioadă inversată / goală ⇒ refuzată (nu se salvează o poliță fără perioadă)
    expect(perioadaPolita(X, '2026-10-19')).toBe(null)
    expect(perioadaPolita('', X)).toBe(null)
  })

  it('poliță încă necerută în original (cerere_trimisa) + termen mutat ⇒ semnal și acolo', () => {
    const cerere = { ...POLITA, status: 'cerere_trimisa', polita_nr: null }
    const ev = evalua(cerere, T30)
    expect(ev.st.original).toBe(false)
    expect(ev.reverificare).toMatchObject({ da: true, nivel: 'nu_acopera' })
  })

  it('fără garanție ⇒ fără semnal; fără termen de depunere ⇒ „de reverificat”, nu verde', () => {
    expect(evalua(null, T30).reverificare).toEqual({ da: false, nivel: null, motive: [], acoperaVerificat: false })
    const ev = evalua(POLITA, null)
    expect(ev.reverificare).toMatchObject({ da: true, nivel: 'de_verificat' })
    expect(ev.reverificare.motive[0]).toMatch(/nu are termen de depunere/)
    expect(semnalReverificare(null)).toEqual({ da: false, nivel: null, motive: [], acoperaVerificat: false })
  })

  it('termenMutat: aceeași zi (altă oră) nu e mutare; ziua se ia în ora României', () => {
    expect(termenMutat('2026-10-19T09:00:00Z', '2026-10-19T12:00:00+00:00')).toBe(null)
    expect(termenMutat('2026-10-19T12:00:00Z', '2026-10-19T22:30:00Z')).toEqual({ de: '2026-10-19', la: '2026-10-20' })  // 01:30 ora RO
    expect(termenMutat(null, null)).toBe(null)
    expect(termenMutat(null, T30)).toEqual({ de: null, la: '2026-11-18' })
  })
})

// ════════════════════════════════════════════════════════════════
// R7 propagare — runda 2 (verificatorul, 26.09.2026): regresia KPI pe garanțiile în curs, semnalul blocat după
// „termen mutat și înapoi”, cerința necitită pe polița în original, precompletarea pasului 4.
// ════════════════════════════════════════════════════════════════
describe('R7 runda 2 — KPI / eticheta tab-ului (indicatorGarantie) + semnalul din citire', () => {
  // date REALE (SELECT 26.09.2026): garanția #1, lic. 3, cerința #3452; termen 24.09 → 14.10
  const C3452 = { id: 3452, text_cerinta: 'Valabilitatea garanției de participare cel puțin egală cu valabilitatea ofertei, respectiv 4 luni de la data-limită de depunere.', stare: 'de_analizat', inlocuita_de: null, sursa_document_id: 63, sursa_pagina: 12 }
  const G1 = Object.freeze({ id: 1, status: 'original', valabil_de: '2026-09-24', valabil_pana: '2027-01-22', valabil_zile: 120, termen_la_cerere: '2026-09-24T00:00:00+00:00', observatii: null, polita_nr: 'AX1008360' })
  const L3 = Object.freeze({ id: 3, garantie_status: 'original', termen_depunere: '2026-10-14T12:00:00+00:00', garantie_participare: '292641.99' })
  const ind = (l, semnal) => indicatorGarantie({ status: l.garantie_status, fisa: l.garantie_participare, semnal })

  it('REGRESIA: cerere_trimisa + termen mutat, perioada cerută acoperă ⇒ rămâne ROȘU „în curs”, cu semnalul adăugat (nu portocaliu)', () => {
    const l = { ...L3, garantie_status: 'cerere_trimisa' }
    const ev = semnalDinCitire({ l, g: { ...G1, status: 'cerere_trimisa', polita_nr: null, valabil_pana: '2027-06-30' }, cerinte: [C3452] })
    expect(ev.reverificare).toMatchObject({ da: true, nivel: 'de_verificat' })
    expect(ind(l, ev)).toEqual({ unit: 'în curs · ⚠ de reverificat', ton: 'rosu', tab: ' · în curs · ⚠ de reverificat' })
    expect(ind(l, null)).toEqual({ unit: 'în curs', ton: 'rosu', tab: ' · în curs' })          // fără semnal: ca înainte
    expect(ind(l, undefined)).toEqual({ unit: 'în curs', ton: 'rosu', tab: ' · în curs' })     // se încarcă: tot „în curs”
  })
  it('garanție în curs: fără termen / eroare de citire / garanție negăsită ⇒ tot roșu „în curs · ⚠ de reverificat”', () => {
    const fara = { ...L3, garantie_status: 'achitata', termen_depunere: null }
    expect(ind(fara, semnalDinCitire({ l: fara, g: { ...G1, status: 'achitata' }, cerinte: [C3452] }))).toMatchObject({ unit: 'în curs · ⚠ de reverificat', ton: 'rosu' })
    const dp = { ...L3, garantie_status: 'draft_primit' }
    expect(ind(dp, semnalDinCitire({ l: dp, eroare: 'timeout' }))).toMatchObject({ unit: 'în curs · ⚠ de reverificat', ton: 'rosu' })
    expect(ind(dp, semnalDinCitire({ l: dp, g: null, cerinte: [] }))).toMatchObject({ ton: 'rosu' })
    // perioada cerută NU acoperă ⇒ „nu acoperă termenul”, tot roșu și tot „în curs”
    const ct = { ...L3, garantie_status: 'cerere_trimisa' }
    expect(ind(ct, semnalDinCitire({ l: ct, g: { ...G1, status: 'cerere_trimisa' }, cerinte: [C3452] }))).toEqual({ unit: 'în curs · ⚠ nu acoperă termenul', ton: 'rosu', tab: ' · în curs · ⚠ nu acoperă termenul' })
  })
  it('garanție în curs fără valoare în fișă: semnalul o ridică la portocaliu / roșu (niciodată mai slab decât „în curs” neutru de dinainte)', () => {
    const rev = nivel => ({ reverificare: { da: true, nivel, motive: ['x'], acoperaVerificat: false } })
    expect(indicatorGarantie({ status: 'cerere_trimisa', fisa: null, semnal: null })).toMatchObject({ unit: 'în curs', ton: 'neutru' })
    expect(indicatorGarantie({ status: 'cerere_trimisa', fisa: null, semnal: rev('de_verificat') })).toMatchObject({ unit: 'în curs · ⚠ de reverificat', ton: 'portocaliu' })
    expect(indicatorGarantie({ status: 'cerere_trimisa', fisa: null, semnal: rev('nu_acopera') })).toMatchObject({ ton: 'rosu' })
  })
  it('orice status ≠ original: niciodată verde, mereu „în curs” la început', () => {
    const semnale = [undefined, null, { reverificare: { da: false, nivel: null, motive: [] } },
      { reverificare: { da: true, nivel: 'de_verificat', motive: ['x'] } }, { reverificare: { da: true, nivel: 'nu_acopera', motive: ['x'] } }]
    for (const status of ['cerere_trimisa', 'draft_primit', 'achitata'])
      for (const fisa of ['292641.99', null])
        for (const semnal of semnale) {
          const r = indicatorGarantie({ status, fisa, semnal })
          expect(r.ton).not.toBe('verde')
          expect(r.unit.startsWith('în curs')).toBe(true)
          expect(r.tab).toBe(` · ${r.unit}`)
        }
  })
  it('polița în original: semnalul decide culoarea (lic. 3 real ⇒ roșu „nu acoperă”; se încarcă ⇒ neutru; fără semnal ⇒ verde)', () => {
    const ev = semnalDinCitire({ l: L3, g: G1, cerinte: [C3452] })
    expect(ev.reverificare.nivel).toBe('nu_acopera')
    expect(ind(L3, ev)).toEqual({ unit: '⚠ nu acoperă termenul', ton: 'rosu', tab: ' · ⚠ nu acoperă termenul' })
    expect(ind(L3, undefined)).toEqual({ unit: '…', ton: 'neutru', tab: ' · …' })
    expect(ind(L3, semnalDinCitire({ l: L3, eroare: 'timeout' }))).toEqual({ unit: '⚠ de reverificat', ton: 'portocaliu', tab: ' · ⚠ de reverificat' })
    const ok = semnalDinCitire({ l: L3, g: { ...G1, valabil_pana: '2027-03-01', termen_la_cerere: L3.termen_depunere }, cerinte: [C3452] })
    expect(ind(L3, ok)).toEqual({ unit: '✓ original', ton: 'verde', tab: ' · ✓' })
    // dashboard-ul zice „original”, dar recitirea nu găsește garanția ⇒ NU verde
    expect(ind(L3, semnalDinCitire({ l: L3, g: null, cerinte: [] }))).toMatchObject({ ton: 'portocaliu' })
  })
  it('fără garanție: gol (roșu dacă fișa cere garanție, ca înainte); semnalDinCitire ⇒ null fără interpretare', () => {
    expect(indicatorGarantie({ status: null, fisa: '292641.99', semnal: null })).toEqual({ unit: '', ton: 'rosu', tab: '' })
    expect(indicatorGarantie({ status: null, fisa: '', semnal: null })).toEqual({ unit: '', ton: 'neutru', tab: '' })
    expect(semnalDinCitire({ l: { ...L3, garantie_status: null }, g: G1, cerinte: [] })).toBe(null)
    expect(semnalDinCitire({ l: null })).toBe(null)
  })
})

describe('R7 runda 2 — cererea de prelungire rămasă pentru alt termen (T → T+30 → înapoi la T)', () => {
  const FISA = 'Garanția de participare: valabilitate 120 de zile de la data limită de depunere a ofertelor.'
  const T = '2026-11-02T10:00:00+00:00', T30 = '2026-12-02T10:00:00+00:00', T10 = '2026-11-12T10:00:00+00:00'
  const X = plusZile('2026-11-02', 120)                 // 2027-03-02 — polița emisă pe T
  const LUNG = '2027-12-31'                             // poliță care acoperă și T+30
  const POL = Object.freeze({ id: 7, status: 'original', polita_nr: 'P7', valabil_de: '2026-11-02', valabil_pana: X, valabil_zile: 120, termen_la_cerere: T, observatii: null })
  const ev = (g, termen, fisa = FISA) => evalueazaGarantie({ g, termenDepunere: termen, fisa, cerinte: [] })
  // polița pe T; termenul → T+30; se trimite cererea de prelungire (mail OK); revenirea după mail reușește sau nu
  const cuCerere = async (g, { revenireEsuata = false } = {}) => {
    const row = { ...g }; let n = 0
    const patch = async p => { n++; if (revenireEsuata && n > 1) throw new Error('rețea'); Object.assign(row, p) }
    const e0 = ev(row, T30)
    const cerut = { valabil_de: e0.deAcum, valabil_pana: e0.necesar.pana, valabil_zile: e0.necesar.zile, termen_la_cerere: T30 }
    const linieObs = liniePrelungireCeruta({ azi: '2026-11-10', termenVechi: '2026-11-02', termenNou: e0.deAcum, polita: row.polita_nr, acDe: e0.st.acoperaDe, acPana: e0.st.acoperaPana, de: cerut.valabil_de, pana: cerut.valabil_pana })
    const r = await trimiteActualizareSigur({ g: { ...row }, cerut, original: true, linieObs, patch, mail: async () => ({}) })
    expect(r.mail).toBe(true)
    return row
  }

  it('înapoi la T, polița acoperă T ⇒ „nu mai e necesară” se poate închide; după închidere semnalul dispare, polița rămâne X', async () => {
    const row = await cuCerere(POL)
    const inapoi = ev(row, T)
    expect(inapoi.st).toMatchObject({ decalat: false, prelungireCurenta: null })
    expect(inapoi.st.prelungireVeche).toMatchObject({ de: '2026-12-02' })
    expect(inapoi.reverificare).toMatchObject({ da: true, nivel: 'de_verificat', acoperaVerificat: true })
    expect(inapoi.reverificare.motive).toContain('prelungire cerută la 02.12.2026 – 01.04.2027, neconfirmată (fără act adițional) — cerută pentru termenul 02.12.2026, nu pentru cel curent')
    // înainte: null ⇒ semnal blocat, fără nicio acțiune de închidere
    const p = patchVerificatAcoperire({ g: row, ev: inapoi, termenDepunere: T, azi: '2026-11-12' })
    expect(p).not.toBe(null)
    expect(Object.keys(p).sort()).toEqual(['observatii', 'termen_la_cerere'])     // revenirea reușise ⇒ valabil_* neatinse
    expect(p.observatii.split('\n').pop()).toBe('12.11.2026: cererea de prelungire la 02.12.2026 – 01.04.2027 (pentru termenul 02.12.2026) nu mai e necesară, termenul curent e 02.11.2026; ' +
      'polița nr. P7 acoperă 02.11.2026 – 02.03.2027, suficient pentru cerință (până la 02.03.2027) — verificat, fără act adițional. ⟦prelungire-renuntata 2026-12-02 2027-04-01⟧')
    Object.assign(row, p)
    expect(ultimaPrelungire(row.observatii)).toMatchObject({ tip: 'renuntata', de: '2026-12-02', pana: '2027-04-01' })
    expect(faraMarcaje(row.observatii)).not.toMatch(/⟦/)
    const dupa = ev(row, T)
    expect(dupa.st).toMatchObject({ inAsteptare: null, prelungireVeche: null, acoperaPana: X })
    expect(dupa.reverificare).toMatchObject({ da: false, nivel: null })
    expect(indicatorGarantie({ status: 'original', fisa: FISA, semnal: dupa })).toMatchObject({ unit: '✓ original', ton: 'verde' })
    // termenul se mută din nou ⇒ semnalul revine (cererea închisă nu mai contează)
    const iar = ev(row, T30)
    expect(iar.st).toMatchObject({ decalat: true, inAsteptare: null })
    expect(iar.reverificare.nivel).toBe('nu_acopera')
  })
  it('revenirea după mail EȘUASE (în BD: perioada cerută + termenul T+30): închiderea readuce perioada REALĂ a poliței, nu prelungirea neconfirmată', async () => {
    const row = await cuCerere(POL, { revenireEsuata: true })
    expect(row.valabil_pana).toBe('2027-04-01')              // BD: perioada cerută (revenirea a eșuat)
    const inapoi = ev(row, T)
    expect(inapoi.st.acoperaPana).toBe(X)                     // acoperirea se citește din marcaj
    expect(inapoi.st.decalat).toBe(true)                      // termen_la_cerere a rămas T+30
    expect(inapoi.reverificare.acoperaVerificat).toBe(true)
    const p = patchVerificatAcoperire({ g: row, ev: inapoi, termenDepunere: T, azi: '2026-11-12' })
    expect(p).toMatchObject({ valabil_de: '2026-11-02', valabil_pana: X, valabil_zile: 120, termen_la_cerere: T })
    expect(p.observatii).toMatch(/12\.11\.2026: termen 02\.12\.2026 → 02\.11\.2026; cererea de prelungire la 02\.12\.2026 – 01\.04\.2027 .* ⟦prelungire-renuntata 2026-12-02 2027-04-01⟧$/)
    Object.assign(row, p)
    const dupa = ev(row, T)
    expect(dupa.st.acoperaPana).toBe(X)                       // NU 01.04.2027 (cerută, neconfirmată)
    expect(dupa.reverificare.da).toBe(false)
    // pe T+30 polița (X) nu acoperă ⇒ semnalul revine: nimic nu a „prelungit-o”
    expect(ev(row, T30).reverificare.nivel).toBe('nu_acopera')
  })
  it('termen T → T+30 (cerere) → T+10, poliță lungă: banner de decalare + „marchează verificat” închide și cererea veche', async () => {
    const row = await cuCerere({ ...POL, valabil_pana: LUNG })
    const e = ev(row, T10)
    expect(e.st).toMatchObject({ decalat: true, prelungireCurenta: null })
    expect(e.st.prelungireVeche).toBeTruthy()
    expect(e.reverificare.acoperaVerificat).toBe(true)
    const p = patchVerificatAcoperire({ g: row, ev: e, termenDepunere: T10, azi: '2026-11-12' })   // înainte: null (inAsteptare)
    expect(p.observatii).toMatch(/termen 02\.11\.2026 → 12\.11\.2026; cererea de prelungire la 02\.12\.2026 – .* ⟦prelungire-renuntata 2026-12-02 \d{4}-\d{2}-\d{2}⟧$/)
    Object.assign(row, p)
    expect(ev(row, T10).reverificare.da).toBe(false)
    expect(row.valabil_pana).toBe(LUNG)
  })
  it('prelungirea cerută pentru termenul CURENT nu se închide cu „verificat” (doar actul adițional); nici fără nimic de închis', async () => {
    const row = await cuCerere({ ...POL, valabil_pana: LUNG })
    const e = ev(row, T30)
    expect(e.st.prelungireCurenta).toBeTruthy()
    expect(e.reverificare.acoperaVerificat).toBe(true)
    expect(patchVerificatAcoperire({ g: row, ev: e, termenDepunere: T30, azi: '2026-11-12' })).toBe(null)
    // termen nemutat, fără cerere ⇒ nimic de închis
    expect(patchVerificatAcoperire({ g: POL, ev: ev(POL, T), termenDepunere: T, azi: '2026-11-12' })).toBe(null)
  })
  it('înapoi la T, polița NU acoperă cerința pe T: fără „nu mai e necesară”; actul adițional pentru cererea veche închide', async () => {
    const scurta = { ...POL, valabil_pana: '2027-02-01', valabil_zile: 91 }
    const row = await cuCerere(scurta)
    const inapoi = ev(row, T)
    expect(inapoi.st.prelungireVeche).toBeTruthy()
    expect(inapoi.reverificare).toMatchObject({ nivel: 'nu_acopera', acoperaVerificat: false })
    expect(patchVerificatAcoperire({ g: row, ev: inapoi, termenDepunere: T, azi: '2026-11-12' })).toBe(null)
    Object.assign(row, patchActAditional({ g: row, de: '2026-11-02', pana: '2027-04-01', termenDepunere: T, azi: '2026-11-15' }))
    const dupa = ev(row, T)
    expect(dupa.st).toMatchObject({ inAsteptare: null, acoperaPana: '2027-04-01' })
    expect(dupa.reverificare.da).toBe(false)
  })
})

describe('R7 runda 2 — cerința necitită pe polița în ORIGINAL (termen nemutat) + precompletarea pasului 4', () => {
  const T = '2026-11-02T10:00:00+00:00'
  const POL = Object.freeze({ id: 7, status: 'original', polita_nr: 'P7', valabil_de: '2026-11-02', valabil_pana: '2027-03-02', valabil_zile: 120, termen_la_cerere: T, observatii: null })
  const ev = (g, fisa) => evalueazaGarantie({ g, termenDepunere: T, fisa, cerinte: [] })

  it('original + termen nemutat + cerința necitibilă ⇒ „de reverificat” (înainte: fără semnal ⇒ KPI verde)', () => {
    const e = ev(POL, '292.641,99 lei')
    expect(e.necesar).toBe(null)
    expect(e.st.decalat).toBe(false)
    expect(e.reverificare).toEqual({ da: true, nivel: 'de_verificat', motive: ['valabilitatea cerută pe termenul curent nu a putut fi calculată — acoperirea nu e verificată'], acoperaVerificat: false })
    expect(indicatorGarantie({ status: 'original', fisa: '292.641,99 lei', semnal: e })).toMatchObject({ unit: '⚠ de reverificat', ton: 'portocaliu' })
  })
  it('original + durate contradictorii (4 luni vs 180 de zile) ⇒ tot „de reverificat”; cerința citibilă ⇒ verde', () => {
    const c = ev(POL, 'Garanția de participare valabilă 4 luni de la termen. Garanția de participare valabilă 180 de zile de la termen.')
    expect(c.propunere.conflict).toBe(true)
    expect(c.reverificare).toMatchObject({ da: true, nivel: 'de_verificat' })
    expect(ev(POL, 'Garanția de participare: valabilitate 120 de zile de la data limită de depunere a ofertelor.').reverificare.da).toBe(false)
  })
  it('garanție în curs + termen nemutat + cerința necitibilă ⇒ fără semnal suplimentar (KPI-ul e oricum roșu „în curs”)', () => {
    const e = ev({ ...POL, status: 'achitata', polita_nr: null }, '292.641,99 lei')
    expect(e.reverificare.da).toBe(false)
    expect(indicatorGarantie({ status: 'achitata', fisa: '292.641,99 lei', semnal: e })).toEqual({ unit: 'în curs', ton: 'rosu', tab: ' · în curs' })
  })
  it('pasul 4: perioada trecută de om de pe polița fizică NU e suprascrisă la reîncărcare (ex. după o actualizare trimisă în „achitată”)', () => {
    const achitata = { id: 7, status: 'achitata', valabil_de: '2026-11-02', valabil_pana: '2027-03-02' }
    let f4 = { polita_nr: '', polita_prima: '', de: '', pana: '', gid: null, atins: false }
    f4 = precompletarePerioada(f4, achitata)                                        // prima încărcare: perioada cerută
    expect(f4).toMatchObject({ gid: 7, atins: false, de: '2026-11-02', pana: '2027-03-02' })
    f4 = { ...f4, pana: '2027-02-20', atins: true }                                 // omul trece ce scrie pe poliță
    const actualizata = { ...achitata, valabil_de: '2026-12-02', valabil_pana: '2027-04-01' }   // actualizare trimisă ⇒ load()
    f4 = precompletarePerioada(f4, actualizata)
    expect(f4).toMatchObject({ de: '2026-11-02', pana: '2027-02-20', atins: true })  // înainte: revenea în tăcere la 02.12 – 01.04
    // neatinse ⇒ urmează perioada cerută curentă
    expect(precompletarePerioada({ gid: 7, atins: false, de: '2026-11-02', pana: '2027-03-02' }, actualizata)).toMatchObject({ de: '2026-12-02', pana: '2027-04-01' })
    // altă garanție (după anulare) ⇒ se precompletează din nou, chiar dacă cele vechi fuseseră atinse
    expect(precompletarePerioada(f4, { ...actualizata, id: 8 })).toMatchObject({ gid: 8, atins: false, de: '2026-12-02', pana: '2027-04-01' })
    expect(precompletarePerioada(f4, null)).toBe(f4)
  })
})
