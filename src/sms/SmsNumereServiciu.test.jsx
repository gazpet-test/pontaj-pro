// 20261220a — ecranul 📱 SMS cu numerele de serviciu: grupul separat din „Selecție manuală”, căutarea, contorul, modurile „toți” /
// „pe departament” fără numere, lista de aprobat cu denumirea, secțiunea din ⚙ Setări. Randare statică (fără rețea), date fictive.
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import SmsPagina, { Compune, RevizieLot, NumereServiciu } from './SmsPagina.jsx'

const angajati = [
  { id: 1, nume: 'TEST UNU', departament: 'TESA', telefon_mascat: '07** *** 101', optout: false },
  { id: 2, nume: 'TEST DOI', departament: 'Execuție', telefon_mascat: '07** *** 102', optout: false },
  { id: 3, nume: 'TEST TREI', departament: 'TESA', telefon_mascat: '07** *** 103', optout: false },
  { id: 4, nume: 'TEST PATRU', departament: 'TESA', telefon_mascat: '07** *** 104', optout: false },
  { id: 5, nume: 'TEST CINCI', departament: 'TESA', telefon_mascat: '07** *** 105', optout: false },
]
const numere = [
  { id: 7, denumire: 'Telefon Depozit', telefon_mascat: '07** *** 201', optout: false },
  { id: 8, denumire: 'Telefon Oprit', telefon_mascat: '07** *** 202', optout: true },
]
const panouUtil = { nivel: 'utilizator', kill_switch: false, ramas_zi: 150 }
const panouTest = { nivel: 'test', kill_switch: false, ramas_zi: 7, buget_test_zi: 10 }
const randeaza = (p) => renderToStaticMarkup(<Compune panou={panouUtil} setMesaj={() => {}} angajatiInitiali={angajati} numereInitiale={numere} modInitial="selectie" {...p} />)
const bifa = (html, eticheta) => new RegExp(`<input type="checkbox"[^>]*aria-label="Număr de serviciu: ${eticheta}"[^>]*/>`).exec(html)?.[0] || ''

describe('Compune → Selecție manuală: grupul „📞 Numere de serviciu”, separat de angajați', () => {
  it('grupul e DEASUPRA angajaților, cu denumirea, telefonul mascat și bifa lui; opt-out = bifă blocată', () => {
    const html = randeaza()
    const iGrup = html.indexOf('📞 Numere de serviciu</div>'), iAng = html.indexOf('👷 Angajați</div>')
    expect(iGrup).toBeGreaterThan(0)
    expect(iAng).toBeGreaterThan(iGrup)
    expect(html.indexOf('Telefon Depozit')).toBeGreaterThan(iGrup)
    expect(html.indexOf('Telefon Depozit')).toBeLessThan(iAng)
    expect(html.indexOf('TEST UNU')).toBeGreaterThan(iAng)
    expect(html).toContain('07** *** 201')
    expect(bifa(html, 'Telefon Depozit')).not.toContain('disabled')
    expect(bifa(html, 'Telefon Oprit')).toContain('disabled')
    expect(html).not.toMatch(/\+407|0700000/)
  })
  it('căutarea după nume prinde și numerele de serviciu (și ascunde angajații care nu se potrivesc)', () => {
    const html = randeaza({ cautaInitial: 'depozit' })
    expect(html).toContain('Telefon Depozit')
    expect(html).not.toContain('Telefon Oprit')
    expect(html).not.toContain('TEST UNU')
    const a = randeaza({ cautaInitial: 'test unu' })
    expect(a).toContain('TEST UNU')
    expect(a).not.toContain('Telefon Depozit')
    expect(a).toContain('Niciun număr de serviciu în filtru')
  })
  it('contorul numără angajații + numerele bifate', () => {
    expect(randeaza({ selectatiInitiali: [1, 2], numereAleseInitiale: [7] })).toContain('3 selectați (2 angajați + 1 numere de serviciu)')
    expect(randeaza({ selectatiInitiali: [1] })).toContain('1 selectați')
    expect(randeaza({ numereAleseInitiale: [7] })).toMatch(/<input type="checkbox"[^>]*checked=""[^>]*aria-label="Număr de serviciu: Telefon Depozit"|aria-label="Număr de serviciu: Telefon Depozit"[^>]*checked=""/)
  })
  it('contul de test: maximum 5 ÎN TOTAL — cu 4 angajați + 1 număr bifați, restul bifelor (și numerele) sunt blocate', () => {
    const html = renderToStaticMarkup(<Compune panou={panouTest} setMesaj={() => {}} angajatiInitiali={angajati} numereInitiale={[...numere, { id: 9, denumire: 'Telefon Trei', telefon_mascat: '07** *** 203', optout: false }]}
      selectatiInitiali={[1, 2, 3, 4]} numereAleseInitiale={[7]} />)
    expect(html).toContain('5 selectați')
    expect(bifa(html, 'Telefon Trei')).toContain('disabled')
    expect(bifa(html, 'Telefon Depozit')).not.toContain('disabled')
    expect(html).toContain('maximum 5 destinatari într-un lot, în total (angajați și numere de serviciu)')
  })
  it('lista nu s-a putut citi: eroare afișată, nu „nimic de ales” (L18)', () => {
    const html = randeaza({ numereInitiale: [], eroareNumereInitiala: 'permission denied' })
    expect(html).toContain('Numerele de serviciu nu s-au putut citi: permission denied')
    expect(html).not.toContain('📞 Numere de serviciu</div>')
  })
  it('fără numere de serviciu: lista angajaților ca înainte (fără grupuri, fără notă)', () => {
    const html = randeaza({ numereInitiale: [] })
    expect(html).not.toContain('📞 Numere de serviciu')
    expect(html).not.toContain('👷 Angajați</div>')
    expect(html).toContain('TEST UNU')
  })
})

describe('Compune → „Toți angajații” / „Pe departament”: numerele de serviciu NU intră (scris în interfață)', () => {
  it('toți: fără bifele numerelor, cu nota „doar la Selecție manuală”', () => {
    const html = randeaza({ modInitial: 'toti' })
    expect(html).toContain('📞 Numerele de serviciu (2) se aleg doar la „Selecție manuală”; la „Toți angajații” și „Pe departament” nu intră.')
    expect(html).not.toContain('aria-label="Număr de serviciu:')
  })
  it('pe departament: la fel; numerele rămase bifate din selecția manuală sunt anunțate că nu se trimit', () => {
    const html = randeaza({ modInitial: 'departament', numereAleseInitiale: [7] })
    expect(html).toContain('se aleg doar la „Selecție manuală”')
    expect(html).toContain('Cele 1 bifate nu se trimit în acest mod.')
    expect(html).not.toContain('aria-label="Număr de serviciu:')
  })
})

describe('Lista de aprobat și „Mesajele lotului”: destinatarul cu denumirea numărului de serviciu', () => {
  it('revizia: denumirea + eticheta „număr de serviciu”, telefon mascat', () => {
    const det = { lot_id: 'l1', categorie: 'intern', stare: 'draft', versiune: 1, text: 'Test', lungime: 4, segmente: 1, nr_destinatari: 2, cost_estimat_eur: 0.098,
      destinatari: [{ mesaj_id: 'm1', nume: 'Telefon Depozit', telefon_mascat: '07** *** 201', destinatar_tip: 'serviciu', stare: 'in_coada' },
        { mesaj_id: 'm2', nume: 'TEST UNU', telefon_mascat: '07** *** 101', destinatar_tip: 'angajat', stare: 'in_coada' }] }
    const html = renderToStaticMarkup(<RevizieLot lotId="l1" detaliiInitiale={det} />)
    expect(html).toContain('Telefon Depozit')
    expect(html.split('📞 număr de serviciu').length - 1).toBe(1)
    expect(html).toContain('Am verificat lista de 2 destinatari')
  })
})

describe('⚙ Setări → Numere de serviciu (doar owner)', () => {
  const lista = [
    { id: 7, denumire: 'Telefon Depozit', telefon_mascat: '07** *** 201', responsabil_employee_id: 1, responsabil_nume: 'TEST UNU', nota: 'la depozit', activ: true, versiune: 2, optout: false },
    { id: 6, denumire: 'Telefon Vechi', telefon_mascat: '07** *** 200', responsabil_employee_id: null, responsabil_nume: null, nota: null, activ: false, versiune: 3, optout: false },
  ]
  it('lista: denumire, telefon mascat, cine ține telefonul, activ / dezactivat; acțiuni doar pe cele active', () => {
    const html = renderToStaticMarkup(<NumereServiciu setMesaj={() => {}} listaInitiala={lista} angajatiInitiali={angajati} />)
    for (const t of ['📞 Numere de serviciu', 'Telefon Depozit', '07** *** 201', 'ține telefonul: TEST UNU', 'la depozit', 'Telefon Vechi', 'dezactivat', '＋ Adaugă numărul']) expect(html).toContain(t)
    expect(html.split('>Modifică<').length - 1).toBe(1)
    expect(html.split('>Dezactivează<').length - 1).toBe(1)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>＋ Adaugă numărul/)   // formular gol = buton blocat
    expect(html).not.toMatch(/\+407|0700000/)
  })
  it('modificarea: pe versiunea văzută, telefonul gol = rămâne', () => {
    const html = renderToStaticMarkup(<NumereServiciu setMesaj={() => {}} listaInitiala={lista} angajatiInitiali={angajati}
      formInitial={{ id: 7, denumire: 'Telefon Depozit', telefon: '', responsabilId: '1', nota: 'la depozit', versiune: 2 }} />)
    expect(html).toContain('Telefon nou (gol = rămâne)')
    expect(html).toMatch(/<button[^>]*>✔ Salvează \(versiunea 2\)/)
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>✔ Salvează/)
    expect(html).toContain('>Renunță<')
  })
  it('secțiunea e în Setări, care se vede doar de owner; utilizatorul nu o vede', () => {
    const owner = renderToStaticMarkup(<SmsPagina profile={{ id: 'x', is_owner: true }} panouInitial={{ nivel: 'owner', kill_switch: true, plafon_zi: 200, plafon_luna: 1500, consum_zi: 0, consum_luna: 0, versiune: 1 }} />)
    expect(owner).toContain('>⚙ Setări<')
    const u = renderToStaticMarkup(<SmsPagina profile={{ id: 'u', is_owner: false, module_access: ['sms'] }} panouInitial={panouUtil} />)
    expect(u).not.toContain('>⚙ Setări<')
    expect(u).not.toContain('Adaugă numărul')
  })
})
