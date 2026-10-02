import { describe, it, expect } from 'vitest'
import {
  slugFisier, numeInZip, calculeazaOrdine, clonarePozitii, pozitiiPentruUnitate, calculeazaBorderou,
  paginiBorderou, progres, grupeazaDocumente, paginiDinBytes, numeProba, esteProba, etichetaTronson, calculeazaMutare,
} from './ctcUtil.js'

const T = [
  { id: 1, categorie: 'Autorizații & avize', denumire_document: 'Autorizație de construire', ordine: 10, obligatoriu: true, repetabil: false },
  { id: 2, categorie: 'Certificate materiale + PVRC', denumire_document: 'Țeavă de linie', ordine: 410, obligatoriu: true, repetabil: false },
  { id: 3, categorie: 'PVLA lucrări ascunse', denumire_document: 'PVLA săpătură șanț', ordine: 620, obligatoriu: true, repetabil: true },
  { id: 4, categorie: 'Sudură', denumire_document: 'Tabel execuție suduri', ordine: 710, obligatoriu: true, repetabil: true },
  { id: 5, categorie: 'Probe presiune', denumire_document: 'PV probă de presiune', ordine: 820, obligatoriu: true, repetabil: true },
  { id: 6, categorie: 'Recepție', denumire_document: 'PV recepție', ordine: 930, obligatoriu: true, repetabil: false },
]

describe('slugFisier / numeInZip', () => {
  it('scoate diacriticele și caracterele nepermise', () => {
    expect(slugFisier('Țeavă — certificat 3.1 (lot 2)')).toBe('Teava_certificat_3.1_lot_2')
    expect(slugFisier('')).toBe('fisier')
  })
  it('numerotează cu 3 cifre și pune tronsonul', () => {
    expect(numeInZip(7, 'PVLA săpătură șanț', 'Mal drept')).toBe('007_Mal_drept_PVLA_sapatura_sant.pdf')
    expect(numeInZip(12, 'Autorizație', null)).toBe('012_Autorizatie.pdf')
    expect(numeInZip(3, 'PV probă', numeProba('etanșeitate'))).toBe('003_etanseitate_PV_proba.pdf')
  })
})

describe('proba vs tronson', () => {
  it('prefixul distinge probele', () => {
    expect(esteProba(numeProba('rezistență'))).toBe(true)
    expect(esteProba('FOD')).toBe(false)
    expect(etichetaTronson(numeProba('rezistență'))).toBe('rezistență')
    expect(etichetaTronson('FOD')).toBe('FOD')
  })
})

describe('clonarePozitii', () => {
  it('poziții generale o dată, repetabile pe tronson, probe pe probă', () => {
    const r = clonarePozitii(T, ['FOD', 'Mal drept', numeProba('rezistență'), numeProba('etanșeitate')], 9)
    expect(r.filter(x => x.tronson === null)).toHaveLength(3)           // 3 generale
    expect(r.filter(x => x.tronson === 'FOD')).toHaveLength(2)          // PVLA + tabel suduri
    expect(r.filter(x => x.tronson === 'Mal drept')).toHaveLength(2)
    expect(r.filter(x => esteProba(x.tronson))).toHaveLength(2)         // 1 poziție de probă × 2 probe
    expect(r.every(x => x.carte_id === 9 && x.status === 'lipsa')).toBe(true)
    expect(r).toHaveLength(9)
  })
  it('fără tronsoane: repetabilele apar o singură dată, cu tronson null', () => {
    const r = clonarePozitii(T, [], 1)
    expect(r).toHaveLength(6)
    expect(r.every(x => x.tronson === null)).toBe(true)
  })
  it('3 tronsoane + 3 probe pe template-ul cu 38 generale / 16 C / 4 D = 98 rânduri', () => {
    const t = []
    for (let i = 0; i < 38; i++) t.push({ id: i + 1, categorie: 'X', denumire_document: 'g' + i, ordine: 10 + i, obligatoriu: true, repetabil: false })
    for (let i = 0; i < 16; i++) t.push({ id: 100 + i, categorie: 'PVLA lucrări ascunse', denumire_document: 'c' + i, ordine: 610 + i, obligatoriu: true, repetabil: true })
    for (let i = 0; i < 4; i++) t.push({ id: 200 + i, categorie: 'Probe presiune', denumire_document: 'd' + i, ordine: 810 + i, obligatoriu: true, repetabil: true })
    const r = clonarePozitii(t, ['FOD', 'Mal drept', 'Mal stâng', numeProba('a'), numeProba('b'), numeProba('c')], 1)
    expect(r).toHaveLength(38 + 16 * 3 + 4 * 3)
  })
  it('ordinea grupează pe tronson în cadrul secțiunii, nu pe tip de document', () => {
    const r = clonarePozitii(T, ['FOD', 'Mal drept'], 1).sort((a, b) => a.ordine - b.ordine)
    const ex = r.filter(x => x.categorie === 'PVLA lucrări ascunse' || x.categorie === 'Sudură').map(x => `${x.tronson}:${x.denumire_document}`)
    expect(ex).toEqual([
      'FOD:PVLA săpătură șanț', 'FOD:Tabel execuție suduri',
      'Mal drept:PVLA săpătură șanț', 'Mal drept:Tabel execuție suduri',
    ])
    // generale înainte de execuție, recepția la final
    expect(r[0].denumire_document).toBe('Autorizație de construire')
    expect(r[r.length - 1].denumire_document).toBe('PV recepție')
  })
  it('calculeazaOrdine e monoton între secțiuni', () => {
    const a = calculeazaOrdine({ ordine: 410, repetabil: false }, 0)
    const c = calculeazaOrdine({ ordine: 750, repetabil: true }, 5)
    const d = calculeazaOrdine({ ordine: 810, repetabil: true }, 0)
    const e = calculeazaOrdine({ ordine: 930, repetabil: false }, 0)
    expect(a < c && c < d && d < e).toBe(true)
  })
})

describe('pozitiiPentruUnitate', () => {
  it('adaugă doar pozițiile potrivite tipului de unitate', () => {
    const tr = pozitiiPentruUnitate(T, 'Mal stâng', 2, 5)
    expect(tr.map(x => x.denumire_document).sort()).toEqual(['PVLA săpătură șanț', 'Tabel execuție suduri'])
    expect(tr.every(x => x.tronson === 'Mal stâng' && x.carte_id === 5)).toBe(true)
    const pr = pozitiiPentruUnitate(T, numeProba('etanșeitate'), 0, 5)
    expect(pr.map(x => x.denumire_document)).toEqual(['PV probă de presiune'])
  })
})

describe('calculeazaBorderou', () => {
  const d = (id, ordine, status, pagini, cale = 'p/' + id) => ({ id, ordine, status, nr_pagini: pagini, fisier_path: status === 'lipsa' || status === 'na' ? null : cale })
  it('paginare cumulată după borderou, doar poziții cu fișier', () => {
    const b = calculeazaBorderou([d(1, 20, 'incarcat', 3), d(2, 10, 'verificat', 2), d(3, 30, 'lipsa', null), d(4, 40, 'na', null), d(5, 50, 'incarcat', 5)], 2)
    expect(b.randuri.map(r => [r.nr, r.doc.id, r.start, r.end])).toEqual([[1, 2, 3, 4], [2, 1, 5, 7], [3, 5, 8, 12]])
    expect(b.totalPagini).toBe(12)
    expect(b.faraPagini).toBe(0)
  })
  it('poziție cu fișier dar fără pagini: apare, fără start/end, e numărată', () => {
    const b = calculeazaBorderou([d(1, 10, 'incarcat', null), d(2, 20, 'incarcat', 4)], 1)
    expect(b.randuri[0]).toMatchObject({ nr: 1, pagini: null, start: null, end: null })
    expect(b.randuri[1]).toMatchObject({ nr: 2, start: 2, end: 5 })
    expect(b.faraPagini).toBe(1)
  })
  it('pagini borderou', () => {
    expect(paginiBorderou(0)).toBe(1)
    expect(paginiBorderou(30)).toBe(1)
    expect(paginiBorderou(31)).toBe(2)
    expect(paginiBorderou(98)).toBe(4)
  })
})

describe('progres / grupeazaDocumente', () => {
  const docs = [
    { id: 1, ordine: 10, status: 'verificat', obligatoriu: true, nr_pagini: 2, fisier_path: 'a', tronson: null },
    { id: 2, ordine: 20, status: 'lipsa', obligatoriu: true, tronson: null },
    { id: 3, ordine: 30, status: 'na', obligatoriu: true, tronson: null },
    { id: 4, ordine: 610000, status: 'incarcat', obligatoriu: false, nr_pagini: 5, fisier_path: 'b', tronson: 'FOD' },
    { id: 5, ordine: 800000, status: 'lipsa', obligatoriu: true, tronson: numeProba('etanșeitate') },
  ]
  it('progres', () => {
    expect(progres(docs)).toEqual({ total: 5, aplicabile: 4, incarcate: 2, verificate: 1, obligatoriiLipsa: 2, pagini: 7 })
  })
  it('grupare: generale, tronsoane, probe', () => {
    const g = grupeazaDocumente(docs)
    expect(g.map(x => x.eticheta)).toEqual(['Documentație generală', '🔧 Tronson: FOD', '🧪 Probă: etanșeitate'])
  })
})

describe('paginiDinBytes', () => {
  const enc = (s) => new TextEncoder().encode(s)
  it('numără /Type /Page, nu /Pages', () => {
    const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 2/Kids[3 0 R 4 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R>>endobj\n4 0 obj<< /Type /Page /Parent 2 0 R>>endobj'
    expect(paginiDinBytes(enc(pdf))).toBe(2)
  })
  it('fallback pe /Count când paginile sunt în object streams', () => {
    expect(paginiDinBytes(enc('2 0 obj<</Type/Pages/Count 17/Kids[]>>endobj'))).toBe(17)
    expect(paginiDinBytes(enc('2 0 obj<</Count 9/Type/Pages>>endobj'))).toBe(9)
  })
  it('null când nu se poate determina', () => {
    expect(paginiDinBytes(enc('nimic util aici'))).toBeNull()
  })
})

describe('calculeazaMutare', () => {
  const g = [{ id: 1, ordine: 10 }, { id: 2, ordine: 20 }, { id: 3, ordine: 30 }]
  it('schimbă între ele ordinea a două poziții vecine', () => {
    expect(calculeazaMutare(g, 2, -1)).toEqual([{ id: 2, ordine: 10 }, { id: 1, ordine: 20 }])
    expect(calculeazaMutare(g, 2, 1)).toEqual([{ id: 2, ordine: 30 }, { id: 3, ordine: 20 }])
  })
  it('nu mută peste capete', () => {
    expect(calculeazaMutare(g, 1, -1)).toEqual([])
    expect(calculeazaMutare(g, 3, 1)).toEqual([])
    expect(calculeazaMutare(g, 99, 1)).toEqual([])
  })
  it('ordine egală: depărtează cu 1, în direcția cerută', () => {
    const e = [{ id: 1, ordine: 50 }, { id: 2, ordine: 50 }]
    expect(calculeazaMutare(e, 2, -1)).toEqual([{ id: 2, ordine: 49 }])
    expect(calculeazaMutare(e, 1, 1)).toEqual([{ id: 1, ordine: 51 }])
  })
})
