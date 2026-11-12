// TKT-2026-0362 — F23 pe o categorie, cu dovada deținerii / chiriei, doar din ce există pe activ.
import { describe, it, expect } from 'vitest'
import { dovadaActiv, randuriF23Categorie, foaieF23Categorie, DETINERE, incarcaActiveCategorie, pregatesteF23Categorie, NOTA_F23_CATEGORIE } from './logisticaF23Dovezi.js'

const AZI = '2026-11-12'

describe('dovada pe activ', () => {
  it('proprietate: nr. de inventar = dovada; lipsa lui e marcată', () => {
    expect(dovadaActiv({ tip_proprietate: 'firma', nr_inventar: ' 2134 ' }, AZI)).toEqual({ detinere: 'Proprietate', dovada: 'nr. inventar 2134', stare: 'ok' })
    expect(dovadaActiv({ tip_proprietate: 'firma', nr_inventar: '', firma_proprietara: 'Gazpet Instal' }, AZI))
      .toEqual({ detinere: 'Proprietate', dovada: 'fără nr. de inventar în evidență · proprietar: Gazpet Instal', stare: 'lipsa' })
    // implicit (tip_proprietate gol) = firmă, ca în formularul activului
    expect(dovadaActiv({ nr_inventar: '7' }, AZI).detinere).toBe(DETINERE.firma)
  })
  it('chirie: contractul atașat, furnizorul, perioada; expirat după ultima zi', () => {
    const a = { tip_proprietate: 'inchiriat', comodat_contract_path: 'x/contract.pdf', inchiriere_furnizor: 'Furnizor Test SRL',
      comodat_data_start: '2026-01-01', comodat_data_sfarsit: '2026-12-31' }
    expect(dovadaActiv(a, AZI)).toEqual({ detinere: 'În chirie', stare: 'ok',
      dovada: 'contract de închiriere atașat · furnizor: Furnizor Test SRL · perioada: 01.01.2026 – 31.12.2026' })
    expect(dovadaActiv({ ...a, comodat_data_sfarsit: '2026-11-12' }, AZI).stare).toBe('ok')        // ultima zi = încă valabil
    expect(dovadaActiv({ ...a, comodat_data_sfarsit: '2026-11-11' }, AZI)).toMatchObject({ stare: 'expirat', dovada: expect.stringMatching(/EXPIRAT$/) })
    expect(dovadaActiv({ ...a, comodat_contract_path: '  ' }, AZI)).toMatchObject({ stare: 'lipsa', dovada: expect.stringMatching(/^LIPSĂ contract atașat/) })
    expect(dovadaActiv({ tip_proprietate: 'inchiriat', comodat_contract_path: 'c.pdf' }, AZI).dovada).toBe('contract de închiriere atașat')
  })
  it('comodat: proprietarul din lista de nume (helperul existent), perioadă nedeterminată', () => {
    const a = { tip_proprietate: 'comodat', comodat_contract_path: 'c.pdf', comodat_employee_id: 5, comodat_data_start: '2026-03-01' }
    expect(dovadaActiv(a, AZI, id => (id === 5 ? 'POPESCU ION' : null)).dovada)
      .toBe('contract de comodat atașat · proprietar: POPESCU ION · perioada: 01.03.2026 – nedeterminat')
  })
  it('formă de deținere necunoscută: nu o ghicim', () => {
    expect(dovadaActiv({ tip_proprietate: 'leasing' }, AZI)).toEqual({ detinere: 'leasing', dovada: 'formă de deținere necunoscută', stare: 'necunoscut' })
  })
})

describe('lista pe categorie', () => {
  const active = [
    { id: 1, categorie_id: 9, marca: 'Ritmo', model: 'Delta 315', cod_intern: 'SA-02', tip_proprietate: 'firma', nr_inventar: '11', stare: 'Functional' },
    { id: 2, categorie_id: 9, marca: 'Ritmo', model: 'Delta 315', cod_intern: 'SA-01', tip_proprietate: 'inchiriat', stare: 'Functional' },
    { id: 3, categorie_id: 9, marca: 'Vândut', cod_intern: 'SA-03', vandut: true },
    { id: 4, categorie_id: 9, marca: 'Conservat', cod_intern: 'SA-04', deep_sleep: true },
    { id: 5, categorie_id: 8, marca: 'Altă categorie', cod_intern: 'EX-01' },
  ]
  it('doar categoria aleasă, fără vândute / conservate, ordonat după denumire și cod', () => {
    const r = randuriF23Categorie(active, '9', AZI)
    expect(r.map(x => x.cod_intern)).toEqual(['SA-01', 'SA-02'])
    expect(r[0]).toMatchObject({ denumire: 'Ritmo Delta 315', detinere: 'În chirie', stare: 'lipsa' })
    expect(r[1]).toMatchObject({ detinere: 'Proprietate', stare: 'ok' })
    expect(randuriF23Categorie(active, 'abc', AZI)).toEqual([])
    expect(randuriF23Categorie(null, 9, AZI)).toEqual([])
  })
  it('foaia Excel: titlu, sumar, antet, rânduri cu verificarea pe înțeles', () => {
    const f = foaieF23Categorie(randuriF23Categorie(active, 9, AZI), 'Aparat sudură · Automată', AZI)
    expect(f[0][0]).toBe('Formular 23 — listă separată: Aparat sudură · Automată')
    expect(f[1][0]).toBe('Situația la 12.11.2026 · 2 bucăți · 1 fără dovadă completă')
    expect(f[3]).toEqual(['Nr. crt.', 'Denumire', 'Cod intern', 'Serie', 'An', 'Stare activ', 'Deținere', 'Dovada', 'Verificare'])
    expect(f[4][8]).toBe('LIPSĂ DOVADĂ')
    expect(f[5][8]).toBe('OK')
  })
})

// ------------------------------------------------------------
// r2 (Jakarinos #1068): exportul citește singur activele, complet. Server fals care aplică filtrele ca
// PostgREST, ordonează, limitează și TAIE la plafonul max-rows (implicit 1000). Așteptările sunt numărate
// de mână din setul construit, nu derivate din codul testat (L25).
// ------------------------------------------------------------
function serverFals(tabele, { maxRows = 1000, laCerere = null } = {}) {
  const cereri = []
  const tabel = nume => {
    const st = { nume, cols: null, opts: {}, filtre: [], order: [], limit: null }
    const b = {
      select(cols, opts = {}) { st.cols = cols; st.opts = opts; return b },
      eq(c, v) { st.filtre.push(['eq', c, v]); return b },
      gt(c, v) { st.filtre.push(['gt', c, v]); return b },
      in(c, v) { st.filtre.push(['in', c, v]); return b },
      order(c, o) { st.order.push([c, o?.ascending !== false]); return b },
      limit(n) { st.limit = n; return b },
      then(ok, ko) { return Promise.resolve().then(() => raspunde(st)).then(ok, ko) },
    }
    return b
  }
  const trece = (r, [op, c, v]) => op === 'eq' ? r[c] === v : op === 'gt' ? r[c] > v : v.includes(r[c])
  const raspunde = st => {
    const nr = cereri.push(st) - 1
    const h = laCerere && laCerere(st, nr, tabele)
    if (h && h.error) return { data: null, error: h.error, count: null }
    let rez = (tabele[st.nume] || []).filter(r => st.filtre.every(f => trece(r, f)))
    const count = st.opts.count === 'exact' ? rez.length : null
    if (st.opts.head) return { data: null, error: null, count }
    for (const [c, asc] of [...st.order].reverse()) rez = [...rez].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1))
    return { data: rez.slice(0, Math.min(st.limit ?? Infinity, maxRows)), error: null, count }
  }
  return { tabel, cereri }
}

// Categoria 9 = „Aparat sudură · Automată”: 1500 de aparate (id 1..1500, peste o pagină de server):
// id 1..1200 proprietate cu nr. inventar; 1201..1400 în chirie cu contract 2026; 1401..1450 comodat (angajat 5);
// 1451..1480 vândute, 1481..1490 conservate, 1491 = rândul tehnic NEALOCAT, 1492..1500 în chirie cu contract 2027.
// Plus 300 de active în altă categorie (8), care nu trebuie să apară.
function flota() {
  const a = []
  for (let id = 1; id <= 1500; id++) {
    const r = { id, categorie_id: 9, marca: 'Sudor', model: `M${String(id).padStart(4, '0')}`, cod_intern: `SA-${id}`, stare: 'Functional' }
    if (id <= 1200) Object.assign(r, { tip_proprietate: 'firma', nr_inventar: String(10000 + id) })
    else if (id <= 1400) Object.assign(r, { tip_proprietate: 'inchiriat', comodat_contract_path: `c/${id}.pdf`, comodat_data_start: '2026-01-01', comodat_data_sfarsit: '2026-12-31' })
    else if (id <= 1450) Object.assign(r, { tip_proprietate: 'comodat', comodat_contract_path: `c/${id}.pdf`, comodat_employee_id: 5 })
    else if (id <= 1480) Object.assign(r, { vandut: true })
    else if (id <= 1490) Object.assign(r, { deep_sleep: true })
    else if (id === 1491) Object.assign(r, { cod_intern: 'NEALOCAT' })
    else Object.assign(r, { tip_proprietate: 'inchiriat', comodat_contract_path: `c/${id}.pdf`, comodat_data_start: '2027-01-01', comodat_data_sfarsit: '2027-12-31' })
    a.push(r)
  }
  for (let id = 1501; id <= 1800; id++) a.push({ id, categorie_id: 8, marca: 'Altul', cod_intern: `EX-${id}`, tip_proprietate: 'firma', nr_inventar: '1' })
  return { logistica_active: a, employees: [{ id: 5, name: 'POPESCU ION' }, { id: 6, name: 'ALTCINEVA' }] }
}
const CAT = { id: 9, tip: 'Aparat sudură', subcategorie: 'Automată' }

describe('contract de chirie / comodat neînceput (r2, P2)', () => {
  const a = { tip_proprietate: 'inchiriat', comodat_contract_path: 'c.pdf', inchiriere_furnizor: 'Furnizor Test SRL', comodat_data_start: '2027-01-01', comodat_data_sfarsit: '2027-12-31' }
  it('contract 01.01–31.12.2027 văzut la 12.11.2026 = NEÎNCEPUT, nu OK', () => {
    expect(dovadaActiv(a, '2026-11-12')).toEqual({ detinere: 'În chirie', stare: 'neinceput',
      dovada: 'contract de închiriere atașat · furnizor: Furnizor Test SRL · perioada: 01.01.2027 – 31.12.2027 · NEÎNCEPUT (începe la 01.01.2027)' })
  })
  it('prima zi a contractului = OK; ziua dinainte = neînceput', () => {
    expect(dovadaActiv(a, '2027-01-01').stare).toBe('ok')
    expect(dovadaActiv(a, '2026-12-31').stare).toBe('neinceput')
  })
  it('comodat neînceput, la fel; foaia scrie „NEÎNCEPUT” la verificare', () => {
    const c = { id: 1, categorie_id: 9, tip_proprietate: 'comodat', comodat_contract_path: 'c.pdf', comodat_data_start: '2026-12-01', cod_intern: 'X' }
    expect(dovadaActiv(c, AZI).stare).toBe('neinceput')
    expect(foaieF23Categorie(randuriF23Categorie([c], 9, AZI), 'x', AZI)[4][8]).toBe('NEÎNCEPUT')
  })
})

describe('exportul F23 pe categorie citește COMPLET (r2, P1)', () => {
  it('serverul fals taie într-adevăr la 1000 (o citire simplă ar pierde aparate)', async () => {
    const { tabel } = serverFals(flota())
    const r = await tabel('logistica_active').select('*').eq('categorie_id', 9)
    expect(r.data.length).toBe(1000)
  })
  it('incarcaActiveCategorie: toate cele 1500 ale categoriei, nimic din altă categorie', async () => {
    const { tabel } = serverFals(flota())
    const rows = await incarcaActiveCategorie(() => tabel('logistica_active'), '9')
    expect(rows.length).toBe(1500)
    expect(new Set(rows.map(r => r.id)).size).toBe(1500)
    expect(rows.every(r => r.categorie_id === 9)).toBe(true)
  })
  it('rândurile exportului: 1500 − 30 vândute − 10 conservate − NEALOCAT = 1459, cu stările numărate de mână', async () => {
    const { tabel } = serverFals(flota())
    const { randuri, foaie, eticheta } = await pregatesteF23Categorie(tabel, CAT, { azi: AZI })
    expect(eticheta).toBe('Aparat sudură · Automată')
    expect(randuri.length).toBe(1459)
    const pe = s => randuri.filter(r => r.stare === s).length
    expect(pe('ok')).toBe(1200 + 200 + 50)
    expect(pe('neinceput')).toBe(9)
    // foaia: titlu, sumar, rând gol, antet + 1459 rânduri; aparatul de după plafon (id 1001 = M1001) e în fișier
    expect(foaie.length).toBe(4 + 1459)
    expect(foaie[1][0]).toBe('Situația la 12.11.2026 · 1459 bucăți · 9 fără dovadă completă')
    expect(foaie.some(r => r[2] === 'SA-1001')).toBe(true)
    expect(foaie.some(r => r[2] === 'SA-1500' && r[8] === 'NEÎNCEPUT')).toBe(true)
    expect(foaie.some(r => r[2] === 'SA-1450' && /proprietar: POPESCU ION/.test(r[7]))).toBe(true)
    expect(foaie.some(r => /^EX-/.test(r[2] || '') || r[2] === 'NEALOCAT' || r[2] === 'SA-1460')).toBe(false)
  })
  it('plafon de server sub pagina cerută (300) — tot 1459', async () => {
    const { tabel } = serverFals(flota(), { maxRows: 300 })
    const { randuri } = await pregatesteF23Categorie(tabel, CAT, { azi: AZI })
    expect(randuri.length).toBe(1459)
  })
  it('paginile cer ordine pe id crescător și continuă de la ultimul id', async () => {
    const { tabel, cereri } = serverFals(flota())
    await incarcaActiveCategorie(() => tabel('logistica_active'), 9)
    const pagini = cereri.filter(c => !c.opts.head)
    expect(pagini.every(c => c.order.length === 1 && c.order[0][0] === 'id' && c.order[0][1] === true)).toBe(true)
    expect(pagini.some(c => c.filtre.some(([op, col, v]) => op === 'gt' && col === 'id' && v === 1000))).toBe(true)
  })
  it('lista se schimbă în timpul citirii = eroare, nu export parțial', async () => {
    const { tabel } = serverFals(flota(), {
      laCerere: (st, nr, t) => { if (nr === 1) t.logistica_active.push({ id: 5000, categorie_id: 9, cod_intern: 'NOU' }) },
    })
    await expect(pregatesteF23Categorie(tabel, CAT, { azi: AZI })).rejects.toThrow(/s-a modificat în timpul citirii/)
  })
  it('eroare pe o pagină = eroare, nu export parțial', async () => {
    const { tabel } = serverFals(flota(), { laCerere: (st, nr) => (nr === 2 ? { error: new Error('timeout') } : null) })
    await expect(pregatesteF23Categorie(tabel, CAT, { azi: AZI })).rejects.toThrow(/timeout/)
  })
  it('categorie invalidă = eroare', async () => {
    const { tabel } = serverFals(flota())
    await expect(incarcaActiveCategorie(() => tabel('logistica_active'), 'abc')).rejects.toThrow(/nu e validă/)
  })
  it('nota din ecran: regula pe categorie, nu pe denumire', () => {
    expect(NOTA_F23_CATEGORIE).toMatch(/nu după denumire/)
    expect(NOTA_F23_CATEGORIE).toMatch(/subcategoria dedicată/)
  })
})
