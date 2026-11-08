import { describe, it, expect } from 'vitest'
import { tipCapitol, normativeDin, ferestre, paginaLa, esteDocTehnic, blocTehnic, cuvinteCheie, SCHELET } from '../supabase/functions/ofertare-genereaza-capitol/tehnic.mjs'

// Titlurile reale ale capitolelor din cuprinsurile folosite în Ofertare (licitația de test 103 / modelele ANAP)
describe('tipCapitol — din titlu', () => {
  const cazuri = [
    ['Metodologia de executarea lucrărilor', 'metodologie'],
    ['Planul de management al calității în cadrul Contractului', 'calitate'],
    ['Grafic general de realizare a investiției (fizic)', 'grafic'],
    ['Personalul propus și managementul contractului pentru execuția lucrărilor', 'personal'],
    ['Infrastructura care va fi utilizată în realizarea activităților în cadrul Contractului', 'utilaje'],
    ['Măsuri aplicabile de Ofertant pe perioada Contractului pentru asigurarea îndeplinirii obligațiilor din domeniul mediului', 'mediu'],
    ['Măsuri aplicabile de Ofertant pe perioada Contractului pentru asigurarea îndeplinirii obligațiilor din domeniul social și al relațiilor de muncă', 'social'],
    ['Adecvarea la constrângerile fizice impuse de amplasamentul lucrării', 'organizare'],
    ['Măsuri aplicate de Ofertant pentru supravegherea lucrărilor în perioada de garanție acordată', 'garantie'],
    ['Memoriu tehnic', 'metodologie'],
    ['Rezumat', 'altul'],
  ]
  for (const [titlu, tip] of cazuri) it(`${titlu.slice(0, 50)} → ${tip}`, () => expect(tipCapitol(titlu)).toBe(tip))
  it('fără titlu → altul', () => expect(tipCapitol(null)).toBe('altul'))
  it('tipurile cu schelet au cel puțin 4 subcapitole; metodologia cere subcapitol pe categorie de lucrări', () => {
    for (const t of ['metodologie', 'calitate', 'ssm', 'social', 'mediu', 'organizare']) expect(SCHELET[t].length).toBeGreaterThanOrEqual(4)
    expect(SCHELET.metodologie.join(' ')).toMatch(/FIECARE categorie de lucrări/)
  })
})

describe('normativeDin — lista albă de citare', () => {
  const text = `Executia se face conform NP 133-2022 si I9-2022. Probele conform SR EN 805 si SR 4163-3.
    Materiale: teava PE 100 SDR 17, capace SR EN 124-1. Distante fata de alte retele STAS 9570/1-89 si SR 8591:1997.
    Calitatea: Legea nr. 10/1995, H.G. nr. 273/1994, C 56-85. Ordinul 1530/1996. Pagina 12, articolul 4.`
  const n = normativeDin(text)
  it('găsește normativele, fără dubluri, sortate', () => {
    for (const x of ['NP 133-2022', 'I9-2022', 'SR EN 805', 'SR 4163-3', 'SR EN 124-1', 'STAS 9570/1-89', 'SR 8591:1997', 'Legea nr. 10/1995', 'C 56-85', 'Ordinul 1530/1996']) {
      expect(n).toContain(x)
    }
    expect(n.some(x => /H\.?G\.? nr\. 273\/1994/.test(x))).toBe(true)
    expect(new Set(n).size).toBe(n.length)
  })
  it('nu ia numere oarecare (pagina 12, articolul 4) și nu ia materialele drept normative', () => {
    expect(n.some(x => /^12$|^4$/.test(x))).toBe(false)
    expect(n.some(x => /PE 100|SDR/.test(x))).toBe(false)
  })
  it('aceeași normă scrisă diferit apare o singură dată', () => {
    expect(normativeDin('NP 133-2022 și NP 133 - 2022 și NP133-2022 și NP133/2022').length).toBe(1)
    expect(normativeDin('HG 395/2016, HG nr. 395/2016, H.G. nr. 395/2016').length).toBe(1)
    expect(normativeDin('STAS 6054 și STAS 6054-77').length).toBe(2)   // ediția contează
  })
  it('text gol → listă goală', () => expect(normativeDin('')).toEqual([]))
  it('identificatorii se iau întregi, cu ediția (review Jakarinos #1030 P2)', () => {
    expect(normativeDin('conform STAS 6054:1977')).toEqual(['STAS 6054:1977'])
    expect(normativeDin('SR EN 12201-2:2011+A1:2013')).toEqual(['SR EN 12201-2:2011'])
    expect(normativeDin('NP 1333-2022')).toEqual([])            // NP are 2–3 cifre: nu devine „NP 133”
    expect(normativeDin('NP 133-20221')).toEqual([])           // anul nu se taie din 5 cifre
    expect(normativeDin('Legea 10/19955')).toEqual([])
    expect(normativeDin('STAS 9570/1-89')).toEqual(['STAS 9570/1-89'])
  })
})

describe('ferestre + paginaLa', () => {
  const umplutura = 'Text administrativ fara legatura. '.repeat(60)
  const tehnic = 'Sapatura se executa mecanizat, cu sprijiniri la adancime peste 1,5 m; pozarea conductei PEHD PE 100 SDR 17 pe pat de nisip; sudura cap la cap si electrofuziune; proba de presiune la 10 bar. '
  const text = `⟦PAGINA 1⟧ ${umplutura}⟦PAGINA 7⟧ ${tehnic}${umplutura}⟦PAGINA 9⟧ Camine de vane si hidranti; spalare si dezinfectie. ${umplutura}`
  it('alege fragmentul bogat în cuvinte-cheie, cu pagina lui; ignoră textul administrativ', () => {
    const f = ferestre(text, cuvinteCheie('metodologie'), { latime: 400, max: 3 })
    expect(f.length).toBeGreaterThan(0)
    expect(f[0].text).toMatch(/pozarea conductei PEHD/)
    expect(f[0].pagina).toBe(7)
    expect(f.every(x => !/^Text administrativ fara legatura\. Text administrativ/.test(x.text) || /sudur|proba|pozar/i.test(x.text))).toBe(true)
  })
  it('potrivire fără diacritice (Săpătura / pozarea / sudură)', () => {
    const f = ferestre('Săpătura și pozarea țevii; sudură și probă de presiune.' + umplutura, cuvinteCheie('metodologie'), { latime: 300, max: 2 })
    expect(f.length).toBe(1)
    expect(f[0].text).toMatch(/^Săpătura/)
  })
  it('ferestrele nu se suprapun și sunt în ordinea din document', () => {
    const t2 = (tehnic + umplutura).repeat(4)
    const f = ferestre(t2, cuvinteCheie('metodologie'), { latime: 300, max: 4 })
    expect(f.length).toBeGreaterThan(1)
    for (let i = 1; i < f.length; i++) expect(f[i].start - f[i - 1].start).toBeGreaterThanOrEqual(300)
  })
  it('paginaLa: ultimul marcaj înaintea poziției; fără marcaje → null', () => {
    expect(paginaLa(text, text.indexOf('pozarea'))).toBe(7)
    expect(paginaLa('fara marcaje', 3)).toBeNull()
  })
  it('text gol / fără chei → nimic', () => {
    expect(ferestre('', ['x'])).toEqual([])
    expect(ferestre('abc', [])).toEqual([])
  })
})

describe('esteDocTehnic + blocTehnic', () => {
  const docs = [
    { id: 1, nume_original: 'CAIET DE SARCINI.pdf', tip: 'cs_volum', text_extras: 'Executantul respecta NP 133-2022. Sapatura si pozarea conductei, proba de presiune.' },
    { id: 2, nume_original: 'PT/01. Parte scrisa PT.pdf', tip: 'alta', text_extras: '⟦PAGINA 3⟧ Pozare pe pat de nisip, sudura PE, proba de presiune conform SR EN 805. Camine de vane.' },
    { id: 3, nume_original: 'Instructiuni_ofertanti_FisaDate.pdf', tip: 'fisa_date', text_extras: 'Legea 98/2016. Garantia de participare.' },
    { id: 4, nume_original: 'F3 FARA VALORI.pdf', tip: 'lista_cantitati', text_extras: 'Sapatura mc 1000. Pozare m 5455.' },
    { id: 5, nume_original: 'Raspuns consolidat.pdf', tip: 'raspuns_clarificare', text_extras: 'Raspuns: proba de presiune la 10 bar.' },
  ]
  it('doar caietul și partea scrisă a proiectului sunt tehnice', () => {
    expect(docs.filter(esteDocTehnic).map(d => d.id)).toEqual([1, 2])
  })
  it('blocul: normativele doar din documentele tehnice, extrase cu documentul și pagina', () => {
    const b = blocTehnic(docs, 'metodologie', { latime: 200 })
    expect(b.docuri).toBe(2)
    expect(b.norme).toEqual(['NP 133-2022', 'SR EN 805'])
    expect(b.extrase.some(x => x.startsWith('[PT/01. Parte scrisa PT.pdf, p. 3]'))).toBe(true)
    expect(b.taiat).toBe(false)
  })
  it('plafonul de caractere taie explicit (taiat = true), nu tăcut', () => {
    const mare = [{ id: 9, nume_original: 'Memoriu tehnic.pdf', tip: 'alta', text_extras: ('Sapatura, pozare, sudura, proba de presiune, camine, hidranti. ' + 'x'.repeat(400)).repeat(50) }]
    const b = blocTehnic(mare, 'metodologie', { maxCar: 1000, latime: 300, perDoc: 20 })
    expect(b.taiat).toBe(true)
    expect(b.extrase.join('').length).toBeLessThanOrEqual(1000)
  })
})
