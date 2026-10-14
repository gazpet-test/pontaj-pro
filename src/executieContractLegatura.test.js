import { describe, expect, it } from 'vitest'
import {
  eContractNelegat, normNrContract, scorPotrivire, filtreazaContracte, proiectLegatAltundeva,
  instructiuniInregistrare, textToastInregistrare, partenerContract, fmtZi, fmtLeiSimplu, LINK_ADMIN_CONTRACTE,
  eContractOcupat, mesajEroareLegare, decizieLegaturaLaSalvare, autoDetectieSantierPermisa,
} from './executieContractLegatura.js'

// Proiecte ca cele din TKT-2026-0333 (forma rândului din v_executie_dashboard)
const tifesti = { id: 7, cod_intern: 'TIFESTI_CFI', nume: 'CFI Tifești', beneficiar: 'Transgaz', nr_contract: '686', data_contract: '2024-06-20', valoare_lei: '1051631.00', site_id: 10, site_name: 'Tifești', contract_id: null }
const finta = { id: 27, cod_intern: 'FINTA_GHEBOAIA', nume: 'Finta–Gheboaia', nr_contract: '3063', data_contract: '2025-05-06', valoare_lei: '12600000.00', site_id: null, contract_id: null }

describe('eContractNelegat', () => {
  it('semnalează doar nr_contract completat fără contract_id', () => {
    expect(eContractNelegat(tifesti)).toBe(true)
    expect(eContractNelegat({ ...tifesti, contract_id: 12 })).toBe(false)
    expect(eContractNelegat({ ...tifesti, nr_contract: '   ' })).toBe(false)
    expect(eContractNelegat({ ...tifesti, nr_contract: null })).toBe(false)
    expect(eContractNelegat(null)).toBe(false)
  })
  it('contract_id 0 nu e tratat ca lipsă (doar null/undefined)', () => {
    expect(eContractNelegat({ nr_contract: '1', contract_id: 0 })).toBe(false)
    expect(eContractNelegat({ nr_contract: '1' })).toBe(true)
  })
})

describe('normNrContract', () => {
  it('scoate „nr.”, spațiile și diacriticele', () => {
    expect(normNrContract('Nr. 686 / 2024')).toBe('686/2024')
    expect(normNrContract('număr 52675')).toBe('52675')
    expect(normNrContract('30/CTG1/2025')).toBe('30/ctg1/2025')
    expect(normNrContract(null)).toBe('')
  })
})

describe('scorPotrivire', () => {
  it('număr + dată + valoare + șantier = potrivire maximă', () => {
    const c = { numar_contract: 'Nr. 686', data_semnare: '2024-06-20', valoare_lei: '1051631', site_id: 10 }
    const r = scorPotrivire(tifesti, c)
    expect(r.scor).toBe(8)
    expect(r.motive).toEqual(['același număr', 'aceeași dată', 'aceeași valoare', 'același șantier'])
  })
  it('numărul cu data atașată se potrivește parțial; santiere_ids vin ca text', () => {
    const r = scorPotrivire(tifesti, { numar_contract: '686/20.06.2024', santiere_ids: ['3', '10'] })
    expect(r.motive).toEqual(['număr asemănător', 'același șantier'])
    expect(r.scor).toBe(3)
  })
  it('folosește valoarea inițială a proiectului, nu cea actualizată cu acte', () => {
    const p = { ...tifesti, valoare_lei: 2000000, valoare_initiala_lei: '1051631.00' }
    expect(scorPotrivire(p, { valoare_lei: 1051631 }).motive).toEqual(['aceeași valoare'])
  })
  it('nimic comun → 0; proiect fără șantier nu dă puncte de șantier', () => {
    expect(scorPotrivire(finta, { numar_contract: '1', site_id: null, valoare_lei: 5 })).toEqual({ scor: 0, motive: [] })
    expect(scorPotrivire(null, null)).toEqual({ scor: 0, motive: [] })
  })
})

describe('filtreazaContracte', () => {
  const benefMap = { 4: 'SNTGN Transgaz SA' }
  const contracte = [
    { id: 1, numar_contract: '122 / 06.02.2026', sens: 'plata', categorie: 'executie', data_semnare: '2026-02-06', site_id: 10, partener_text: 'Subcontractor SRL' },
    { id: 2, numar_contract: '686', sens: 'incasare', categorie: 'executie', data_semnare: '2024-06-20', beneficiar_id: 4, valoare_lei: '1051631.00' },
    { id: 3, numar_contract: '999', sens: 'incasare', categorie: 'executie', data_semnare: '2026-01-01', beneficiar_id: 4 },
    { id: 4, numar_contract: '686', sens: 'incasare', data_semnare: '2024-06-20', arhivat_la: '2026-01-01T00:00:00Z' },
    { id: 5, numar_contract: '500', sens: 'incasare', data_semnare: '2025-03-03', partener_text: 'Romgaz' },
  ]
  it('exclude arhivatele și, implicit, contractele de plată; potrivirea vine prima', () => {
    const r = filtreazaContracte(contracte, { proiect: tifesti, benefMap })
    expect(r.map(x => x.contract.id)).toEqual([2, 3, 5])
    expect(r[0].scor).toBeGreaterThan(0)
  })
  it('cu doarIncasare=false apar și cele de plată, dar tot fără arhivate', () => {
    const ids = filtreazaContracte(contracte, { doarIncasare: false, proiect: tifesti }).map(x => x.contract.id)
    expect(ids).toContain(1)
    expect(ids).not.toContain(4)
  })
  it('caută fără diacritice în partener (din beneficiari), număr și dată românească', () => {
    expect(filtreazaContracte(contracte, { cautare: 'transgaz 999', benefMap }).map(x => x.contract.id)).toEqual([3])
    expect(filtreazaContracte(contracte, { cautare: 'ROMGAZ' }).map(x => x.contract.id)).toEqual([5])
    expect(filtreazaContracte(contracte, { cautare: '20.06.2024' }).map(x => x.contract.id)).toEqual([2])
  })
  it('fără proiect: ordonare după data semnării, descrescător', () => {
    expect(filtreazaContracte(contracte).map(x => x.contract.id)).toEqual([3, 5, 2])
  })
  it('tolerează listă goală / null', () => {
    expect(filtreazaContracte(null)).toEqual([])
  })
})

describe('proiectLegatAltundeva', () => {
  const legaturi = [{ id: 7, cod_intern: 'TIFESTI_CFI', contract_id: 2 }, { id: 9, cod_intern: 'ALT', contract_id: 3 }]
  it('găsește alt proiect care folosește deja contractul', () => {
    expect(proiectLegatAltundeva(3, legaturi, 7)?.cod_intern).toBe('ALT')
    expect(proiectLegatAltundeva('3', legaturi, '7')?.id).toBe(9)
  })
  it('proiectul curent sau contract liber → null', () => {
    expect(proiectLegatAltundeva(2, legaturi, 7)).toBeNull()
    expect(proiectLegatAltundeva(55, legaturi, 7)).toBeNull()
    expect(proiectLegatAltundeva(2, null, 7)).toBeNull()
  })
})

describe('instrucțiuni de înregistrare în Administrativ', () => {
  it('cu șantier: cere șantierul asociat (legătura automată merge prin el)', () => {
    const l = instructiuniInregistrare(tifesti)
    expect(l[0]).toBe('Categorie: Execuție · Sens financiar: Încasare')
    expect(l).toContain('Partener: Transgaz')
    expect(l).toContain('Număr contract: 686 · Data semnare: 20.06.2024')
    expect(l.some(x => x.startsWith('Valoare LEI: ') && x.includes('lei'))).toBe(true)
    expect(l.at(-1)).toMatch(/Șantier asociat: Tifești — obligatoriu/)
    expect(textToastInregistrare(tifesti)).toMatch(/cu șantierul Tifești/)
  })
  it('fără șantier: spune că legătura se face manual, din Execuție', () => {
    const l = instructiuniInregistrare(finta)
    expect(l).toContain('Partener: beneficiarul lucrării')
    expect(l.at(-1)).toMatch(/nu are șantier/)
    expect(textToastInregistrare(finta)).toMatch(/n-are șantier.*Leagă/)
  })
  it('linkul duce direct la tab-ul Contracte cu terți', () => {
    expect(LINK_ADMIN_CONTRACTE).toBe('/administrativ?tab=contracte_terti')
  })
})

describe('eroarea la legare (indexul unic 20261030b)', () => {
  it('23505 = contract ocupat între timp → mesaj dedicat', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "executie_proiecte_contract_id_unic"' }
    expect(eContractOcupat(err)).toBe(true)
    expect(mesajEroareLegare(err)).toMatch(/tocmai a fost legat de alt proiect/)
  })
  it('alte erori → mesajul lor, fără „ocupat”', () => {
    expect(eContractOcupat({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(mesajEroareLegare({ code: '42501', message: 'permission denied' })).toBe('Legătura a fost refuzată: permission denied')
    expect(eContractOcupat(null)).toBe(false)
    expect(mesajEroareLegare(undefined)).toMatch(/eroare necunoscută/)
  })
})

// Administrativ → editorul de contract (Jakarinos r1 P2): contractele 108 / 110 sunt legate de proiectele 27 / 32, FĂRĂ șantier
describe('decizieLegaturaLaSalvare (salvarea în Administrativ)', () => {
  const faraSantier = { id: 27, cod_intern: 'FINTA_GHEBOAIA', site_id: null }
  const cuSantier = { id: 7, cod_intern: 'TIFESTI_CFI', site_id: 10 }
  it('proiect fără șantier legat deja: o simplă salvare PĂSTREAZĂ legătura (înainte o pierdea)', () => {
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '', proiectLegat: faraSantier })).toBe('pastreaza')
  })
  it('dezlegarea doar la cerere explicită', () => {
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '', proiectLegat: faraSantier, dezleagaCerut: true })).toBe('dezleaga')
    // proiect cu șantier, iar câmpul Șantier a fost golit de utilizator = cerere explicită (comportamentul vechi)
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '', proiectLegat: cuSantier })).toBe('dezleaga')
  })
  it('șantier ales → legare prin șantier, ca până acum', () => {
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '10', proiectLegat: cuSantier })).toBe('leaga_prin_santier')
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '8', proiectLegat: null })).toBe('leaga_prin_santier')
  })
  it('nimic legat, niciun șantier → doar avertisment (fără UPDATE care ar putea dezlega o legătură făcută între timp)', () => {
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '', proiectLegat: null })).toBe('avertizare')
    expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '', proiectLegat: null, dezleagaCerut: true })).toBe('avertizare')
  })
  it('altă categorie → nu atinge Execuția', () => {
    expect(decizieLegaturaLaSalvare({ categorie: 'prestari_servicii', siteSelectat: '', proiectLegat: faraSantier })).toBe('nimic')
  })
  it('ghicirea șantierului după denumire nu înlocuiește o legătură existentă', () => {
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: 'Conductă Finta Gheboaia', proiectLegat: faraSantier })).toBe(false)
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: 'Conductă Finta Gheboaia', proiectLegat: null })).toBe(true)
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: '  ', proiectLegat: null })).toBe(false)
    expect(autoDetectieSantierPermisa({ categorie: 'altele', denumire: 'x', proiectLegat: null })).toBe(false)
  })
})

describe('formatări mici', () => {
  it('partener: text liber, apoi beneficiar, apoi liniuță', () => {
    expect(partenerContract({ partener_text: ' Romgaz ' })).toBe('Romgaz')
    expect(partenerContract({ beneficiar_id: 4 }, { 4: 'Transgaz' })).toBe('Transgaz')
    expect(partenerContract({})).toBe('—')
  })
  it('data și valoarea', () => {
    expect(fmtZi('2024-06-20T00:00:00')).toBe('20.06.2024')
    expect(fmtZi('')).toBe('')
    expect(fmtLeiSimplu(0)).toBe('')
    expect(fmtLeiSimplu(null)).toBe('')
    expect(fmtLeiSimplu('abc')).toBe('')
    expect(fmtLeiSimplu(1500)).toMatch(/lei$/)
  })
})
