import { describe, expect, it } from 'vitest'
import {
  eContractNelegat, normNrContract, scorPotrivire, filtreazaContracte, proiectLegatAltundeva,
  instructiuniInregistrare, textToastInregistrare, partenerContract, fmtZi, fmtLeiSimplu, LINK_ADMIN_CONTRACTE,
  eContractOcupat, mesajEroareLegare, decizieLegaturaLaSalvare, autoDetectieSantierPermisa,
  stareLegaturaDinCitire, ghicesteSantier, santierInitial, aplicaLegaturaLaSalvare,
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
  const d = o => decizieLegaturaLaSalvare({ categorie: 'executie', stareLegatura: 'ok', ...o })
  it('proiect fără șantier legat deja: o simplă salvare PĂSTREAZĂ legătura (înainte o pierdea)', () => {
    expect(d({ siteSelectat: '', proiectLegat: faraSantier })).toBe('pastreaza')
  })
  it('dezlegarea doar la cerere explicită', () => {
    expect(d({ siteSelectat: '', proiectLegat: faraSantier, dezleagaCerut: true })).toBe('dezleaga')
    // proiect cu șantier, iar câmpul Șantier a fost golit de utilizator = cerere explicită (comportamentul vechi)
    expect(d({ siteSelectat: '', proiectLegat: cuSantier })).toBe('dezleaga')
  })
  it('șantier ales → legare prin șantier, ca până acum', () => {
    expect(d({ siteSelectat: '10', proiectLegat: cuSantier })).toBe('leaga_prin_santier')
    expect(d({ siteSelectat: '8', proiectLegat: null })).toBe('leaga_prin_santier')
  })
  it('nimic legat, niciun șantier → doar avertisment (fără UPDATE care ar putea dezlega o legătură făcută între timp)', () => {
    expect(d({ siteSelectat: '', proiectLegat: null })).toBe('avertizare')
    expect(d({ siteSelectat: '', proiectLegat: null, dezleagaCerut: true })).toBe('avertizare')
  })
  it('altă categorie → nu atinge Execuția (chiar și cu citirea eșuată)', () => {
    expect(decizieLegaturaLaSalvare({ categorie: 'prestari_servicii', siteSelectat: '', proiectLegat: faraSantier, stareLegatura: 'ok' })).toBe('nimic')
    expect(decizieLegaturaLaSalvare({ categorie: 'prestari_servicii', stareLegatura: 'eroare' })).toBe('nimic')
  })
  it('legătura necitită (eroare, în curs sau lipsă) → blocat, orice ar fi ales în câmpul Șantier', () => {
    for (const stareLegatura of ['eroare', 'in_curs', undefined]) {
      expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '', proiectLegat: null, stareLegatura })).toBe('blocat')
      expect(decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: '15', proiectLegat: null, dezleagaCerut: true, stareLegatura })).toBe('blocat')
    }
  })
  it('ghicirea șantierului: nu peste o legătură existentă și nu fără citire reușită', () => {
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: 'Conductă Finta Gheboaia', proiectLegat: faraSantier, citireOk: true })).toBe(false)
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: 'Conductă Finta Gheboaia', proiectLegat: null, citireOk: true })).toBe(true)
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: 'Conductă Finta Gheboaia', proiectLegat: null, citireOk: false })).toBe(false)
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: 'Conductă Finta Gheboaia', proiectLegat: null })).toBe(false)
    expect(autoDetectieSantierPermisa({ categorie: 'executie', denumire: '  ', proiectLegat: null, citireOk: true })).toBe(false)
    expect(autoDetectieSantierPermisa({ categorie: 'altele', denumire: 'x', proiectLegat: null, citireOk: true })).toBe(false)
  })
})

// Client Supabase fals: înregistrează fiecare cerere (tabel, operație, valori, filtre) și răspunde din `raspuns`
function dbFals(raspuns = () => ({ data: null, error: null })) {
  const cereri = []
  const db = {
    from(tabel) {
      const q = { tabel, op: null, valori: null, filtre: [] }
      const b = {
        select(c) { q.op = q.op || 'select'; q.coloane = c; return b },
        update(v) { q.op = 'update'; q.valori = v; return b },
        eq(k, v) { q.filtre.push(['eq', k, v]); return b },
        neq(k, v) { q.filtre.push(['neq', k, v]); return b },
        maybeSingle() { cereri.push(q); return Promise.resolve(raspuns(q)) },
        then(ok, ko) { cereri.push(q); return Promise.resolve(raspuns(q)).then(ok, ko) },
      }
      return b
    },
  }
  return { db, cereri, updateuri: () => cereri.filter(c => c.op === 'update') }
}

// Jakarinos r2 P2 — reproducerea: 108 legat de 27 (fără șantier), SELECT-ul legăturii cade, denumirea seamănă cu alt șantier
describe('editorul din Administrativ: citire eșuată ≠ nicio legătură', () => {
  const sites = [{ id: 15, name: 'Finta Gheboaia' }, { id: 8, name: 'Europan' }]
  const denumire = 'Execuție conductă Finta – Gheboaia'
  const dateSync = { nr_contract: '3063', data_contract: '2025-05-06', valoare_lei: 12600000, valoare_eur: null }
  const deschide = citire => {
    const st = stareLegaturaDinCitire({ isNew: false, citire })
    return { ...st, site: santierInitial({ stare: st.stare, proiectLegat: st.proiectLegat, categorie: 'executie', denumire, sites }) }
  }

  it('fără eroare și fără legătură, aceeași denumire ar ghici șantierul 15 (cazul care producea mutarea)', () => {
    expect(ghicesteSantier(denumire, sites)?.id).toBe(15)
    expect(deschide({ data: null, error: null })).toMatchObject({ stare: 'ok', site: '15' })
  })

  it('eroare la SELECT + denumire potrivită cu alt șantier → nimic ghicit, salvarea nu trimite niciun UPDATE', async () => {
    const st = deschide({ data: null, error: { message: 'timeout' } })
    expect(st).toMatchObject({ stare: 'eroare', proiectLegat: null, site: '', eroare: 'timeout' })
    // nici dacă utilizatorul alege totuși un șantier (câmpul e blocat în UI, dar decizia e și ea fail-closed)
    for (const siteSelectat of [st.site, '15']) {
      const decizie = decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat, proiectLegat: st.proiectLegat, stareLegatura: st.stare })
      expect(decizie).toBe('blocat')
      const { db, cereri } = dbFals()
      const rez = await aplicaLegaturaLaSalvare(db, { decizie, contractId: 108, siteSelectat, proiectLegat: st.proiectLegat, dateSync })
      expect(cereri).toEqual([])                       // legătura 108 ↔ 27 rămâne neatinsă
      expect(rez.ok).toBe(false)
      expect(rez.mesaj).toMatch(/NU a fost atinsă/)    // mesaj vizibil
    }
  })

  it('după o citire reușită: 108 ↔ 27 fără șantier → nimic ghicit, salvarea doar sincronizează datele pe 27', async () => {
    const st = deschide({ data: { id: 27, cod_intern: 'FINTA_GHEBOAIA', site_id: null }, error: null })
    expect(st).toMatchObject({ stare: 'ok', site: '' })
    const decizie = decizieLegaturaLaSalvare({ categorie: 'executie', siteSelectat: st.site, proiectLegat: st.proiectLegat, stareLegatura: st.stare })
    expect(decizie).toBe('pastreaza')
    const { db, updateuri } = dbFals()
    const rez = await aplicaLegaturaLaSalvare(db, { decizie, contractId: 108, siteSelectat: st.site, proiectLegat: st.proiectLegat, dateSync })
    expect(rez).toEqual({ ok: true, mesaj: null })
    expect(updateuri()).toEqual([{ tabel: 'executie_proiecte', op: 'update', valori: dateSync, filtre: [['eq', 'id', 27], ['eq', 'contract_id', 108]] }])
  })

  it('proiect legat cu șantier: șantierul lui precompletează câmpul, nu cel ghicit', () => {
    expect(deschide({ data: { id: 6, site_id: 8 }, error: null })).toMatchObject({ stare: 'ok', site: '8' })
  })

  it('contract nou: nimic de citit, ghicirea e permisă', () => {
    expect(stareLegaturaDinCitire({ isNew: true, citire: null })).toEqual({ stare: 'ok', proiectLegat: null, eroare: null })
  })
})

describe('aplicaLegaturaLaSalvare: fiecare UPDATE își verifică eroarea', () => {
  const p27 = { id: 27, cod_intern: 'FINTA_GHEBOAIA', site_id: null }
  const dateSync = { nr_contract: '3063' }
  it('dezlegare reușită → „dezlegat” + mesaj; dezlegare eșuată → fără „dezlegat”, legătura a rămas', async () => {
    const ok = dbFals()
    const r1 = await aplicaLegaturaLaSalvare(ok.db, { decizie: 'dezleaga', contractId: 108, proiectLegat: p27 })
    expect(r1.dezlegat).toBe(true)
    expect(r1.mesaj).toMatch(/dezlegat de proiectul FINTA_GHEBOAIA/)
    expect(ok.updateuri()[0]).toMatchObject({ valori: { contract_id: null }, filtre: [['eq', 'contract_id', 108]] })

    const ko = dbFals(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }))
    const r2 = await aplicaLegaturaLaSalvare(ko.db, { decizie: 'dezleaga', contractId: 108, proiectLegat: p27 })
    expect(r2.dezlegat).toBeUndefined()
    expect(r2.ok).toBe(false)
    expect(r2.mesaj).toMatch(/dezlegarea de proiectul FINTA_GHEBOAIA a eșuat \(permission denied\); legătura a rămas/)
  })
  it('sincronizare eșuată pe proiectul păstrat → mesaj', async () => {
    const ko = dbFals(() => ({ error: { message: 'boom' } }))
    const r = await aplicaLegaturaLaSalvare(ko.db, { decizie: 'pastreaza', contractId: 108, proiectLegat: p27, dateSync })
    expect(r).toMatchObject({ ok: false })
    expect(r.mesaj).toMatch(/nu s-au sincronizat.*boom/)
  })
  it('legare prin șantier: găsește proiectul, dezleagă celelalte, leagă + sincronizează', async () => {
    const f = dbFals(q => q.op === 'select' ? { data: { id: 40 }, error: null } : { data: null, error: null })
    const r = await aplicaLegaturaLaSalvare(f.db, { decizie: 'leaga_prin_santier', contractId: 200, siteSelectat: '12', dateSync })
    expect(r).toEqual({ ok: true, mesaj: null })
    expect(f.cereri.map(c => c.op)).toEqual(['select', 'update', 'update'])
    expect(f.cereri[0].filtre).toEqual([['eq', 'site_id', 12], ['eq', 'activ', true]])
    expect(f.cereri[1]).toMatchObject({ valori: { contract_id: null }, filtre: [['eq', 'contract_id', 200], ['neq', 'id', 40]] })
    expect(f.cereri[2]).toMatchObject({ valori: { contract_id: 200, nr_contract: '3063' }, filtre: [['eq', 'id', 40]] })
  })
  it('legare prin șantier: căutarea proiectului eșuează → niciun UPDATE', async () => {
    const f = dbFals(q => q.op === 'select' ? { data: null, error: { message: 'retea' } } : { data: null, error: null })
    const r = await aplicaLegaturaLaSalvare(f.db, { decizie: 'leaga_prin_santier', contractId: 200, siteSelectat: '12', dateSync })
    expect(r.ok).toBe(false)
    expect(r.mesaj).toMatch(/legătura nu s-a modificat/)
    expect(f.updateuri()).toEqual([])
  })
  it('legare prin șantier: dezlegarea anterioară eșuează → nu mai încearcă legarea', async () => {
    let n = 0
    const f = dbFals(q => q.op === 'select' ? { data: { id: 40 }, error: null } : (n++ === 0 ? { error: { message: 'x' } } : { error: null }))
    const r = await aplicaLegaturaLaSalvare(f.db, { decizie: 'leaga_prin_santier', contractId: 200, siteSelectat: '12', dateSync })
    expect(r.mesaj).toMatch(/dezlegarea proiectului anterior a eșuat/)
    expect(f.updateuri()).toHaveLength(1)
  })
  it('legare prin șantier: 23505 (indexul unic) → „deja legat de alt proiect”', async () => {
    let n = 0
    const f = dbFals(q => q.op === 'select' ? { data: { id: 40 }, error: null } : (n++ === 0 ? { error: null } : { error: { code: '23505', message: 'duplicate key' } }))
    const r = await aplicaLegaturaLaSalvare(f.db, { decizie: 'leaga_prin_santier', contractId: 200, siteSelectat: '12', dateSync })
    expect(r.mesaj).toMatch(/deja legat de alt proiect/)
  })
  it('șantier fără proiect activ → nimic de făcut, ca până acum', async () => {
    const f = dbFals()
    expect(await aplicaLegaturaLaSalvare(f.db, { decizie: 'leaga_prin_santier', contractId: 200, siteSelectat: '99', dateSync })).toEqual({ ok: true, mesaj: null })
    expect(f.updateuri()).toEqual([])
  })
  it('nimic / avertizare: fără cereri', async () => {
    const f = dbFals()
    expect(await aplicaLegaturaLaSalvare(f.db, { decizie: 'nimic' })).toEqual({ ok: true, mesaj: null })
    expect((await aplicaLegaturaLaSalvare(f.db, { decizie: 'avertizare' })).mesaj).toMatch(/nu e legat la niciun Șantier/)
    expect(f.cereri).toEqual([])
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
