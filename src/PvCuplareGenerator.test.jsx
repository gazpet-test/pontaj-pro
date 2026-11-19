// Teste de componentă pentru PvCuplareGenerator: componenta reală montată cu react-dom în jsdom, cu un client Supabase fals
// ale cărui răspunsuri le eliberează testul (ordinea controlată). Fără rețea, fără librării noi: jsdom se caută în node_modules
// sau în REDARI_JSDOM_DIR (tiparul din OameniSantierButon.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import JSZip from 'jszip'
import PvCuplareGenerator, { incarcaDatePv, COLOANE_PROIECT_PV } from './PvCuplareGenerator.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[PvCuplareGenerator.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const PROIECT = { id: 5, cod_intern: 'TEST-PV', nume: 'Racord de test', beneficiar: 'SNTGN TRANSGAZ SA', nr_contract: '21',
  data_contract: '2026-01-12', sef_santier_employee_id: 10, rte_employee_id: 11 }

// client fals: fiecare cerere (tabel + filtre) intră în `cereri`, iar testul o eliberează cu { data, error }
function clientFals(cereri) {
  const lant = (tabel) => {
    const c = { tabel, filtre: [], coloane: null }
    const promite = () => new Promise((res) => cereri.push({ ...c, res }))
    const o = {
      select: (col) => { c.coloane = col; return o },
      eq: (k, v) => { c.filtre.push(['eq', k, v]); return o },
      in: (k, v) => { c.filtre.push(['in', k, v]); return o },
      maybeSingle: () => promite(),
      then: (a, b) => promite().then(a, b),
    }
    return o
  }
  return { from: lant }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(proiectId = 5, proiect = { id: proiectId, site_name: 'Șantier Domnești' }) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const descarcari = []
  const bloburi = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { bloburi.push(b); return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  j.window.HTMLAnchorElement.prototype.click = function () { descarcari.push(this.download) }
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const cereri = []
  const sb = clientFals(cereri)
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  const randeaza = async (pid, pr = { id: pid }) => { await act(async () => { root.render(<PvCuplareGenerator supabase={sb} proiectId={pid} proiect={pr} />) }); await asteapta() }
  await randeaza(proiectId, proiect)
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const click = async (el) => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const elibereaza = async (i, val) => { await act(async () => { cereri[i].res(val) }); await asteapta() }
  // input controlat React: setter-ul nativ + eveniment „input”
  const scrie = async (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? j.window.HTMLTextAreaElement.prototype : j.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    await act(async () => { el.dispatchEvent(new j.window.Event('input', { bubbles: true })) }); await asteapta()
  }
  const camp = n => d.querySelector(`[data-camp="${n}"]`)
  return { d, j, cereri, click, elibereaza, scrie, camp, randeaza, descarcari, bloburi, buton: () => d.querySelector('[data-pv-cuplare]') }
}

const deschideCuDate = async (u, { proiect = PROIECT, angajati = [{ id: 10, name: 'POPESCU ION' }, { id: 11, name: 'IONESCU ȘTEFAN' }] } = {}) => {
  await u.click(u.buton())
  await u.elibereaza(0, { data: proiect, error: null })
  if (u.cereri[1]) await u.elibereaza(1, { data: angajati, error: null })
}

dom(numeDom('PvCuplareGenerator'), () => {
  it('butonul nu apare cât proiectul încărcat în pagină nu e proiectul curent', async () => {
    const u = await monteaza(5, { id: 4 })
    expect(u.buton()).toBeNull()
    await u.randeaza(5, null)
    expect(u.buton()).toBeNull()
  })

  it('apăsare → „Se încarcă” → formular cu antetul din proiect; citește doar coloanele declarate, pe proiectul curent', async () => {
    const u = await monteaza()
    await u.click(u.buton())
    expect(u.d.querySelector('[role="status"]').textContent).toMatch(/Se încarcă/)
    expect(u.cereri[0]).toMatchObject({ tabel: 'executie_proiecte', coloane: COLOANE_PROIECT_PV, filtre: [['eq', 'id', 5]] })
    await u.elibereaza(0, { data: PROIECT, error: null })
    expect(u.cereri[1]).toMatchObject({ tabel: 'employees', coloane: 'id, name', filtre: [['in', 'id', [10, 11]]] })
    await u.elibereaza(1, { data: [{ id: 10, name: 'POPESCU ION' }, { id: 11, name: 'IONESCU ȘTEFAN' }], error: null })
    expect(u.camp('obiectiv').value).toBe('Racord de test')
    expect(u.camp('beneficiar').value).toBe('SNTGN TRANSGAZ SA')
    expect(u.camp('contract').value).toBe('nr. 21 din 12.01.2026')
    expect(u.camp('executant').value).toBe('GAZPET INSTAL S.R.L.')
    expect(u.camp('locul').value).toBe('')            // nu există localitate în proiect: nu se inventează
    expect(u.camp('diametru').value).toBe('')
    const randuri = [...u.d.querySelectorAll('[data-pv-participant]')].map(r => [...r.querySelectorAll('input')].map(i => i.value))
    expect(randuri).toHaveLength(5)
    expect(randuri[3]).toEqual(['Executant – șef de șantier', 'POPESCU ION'])
    expect(randuri[4]).toEqual(['Executant – RTE', 'IONESCU ȘTEFAN'])
    // orele efective nu sunt câmpuri în formular
    expect([...u.d.querySelectorAll('[data-camp]')].map(e => e.getAttribute('data-camp')).filter(n => /ora/.test(n))).toEqual([])
    expect(u.d.querySelectorAll('input[type="time"]')).toHaveLength(0)
  })

  it('eroare la citirea proiectului = mesaj de eroare cu reîncercare, nu formular gol', async () => {
    const u = await monteaza()
    await u.click(u.buton())
    await u.elibereaza(0, { data: null, error: { message: 'permission denied' } })
    expect(u.d.querySelector('[role="alert"]').textContent).toMatch(/nu s-au putut citi: permission denied/)
    expect(u.camp('obiectiv')).toBeNull()
    await u.click([...u.d.querySelectorAll('button')].find(b => b.textContent === 'Reîncearcă'))
    expect(u.cereri).toHaveLength(2)
    await u.elibereaza(1, { data: { ...PROIECT, sef_santier_employee_id: null, rte_employee_id: null }, error: null })
    expect(u.camp('obiectiv').value).toBe('Racord de test')
    expect(u.cereri).toHaveLength(2)   // fără oameni în proiect: nicio cerere spre employees
  })

  it('proiect negăsit (null fără eroare) = eroare vizibilă', async () => {
    const u = await monteaza()
    await u.click(u.buton())
    await u.elibereaza(0, { data: null, error: null })
    expect(u.d.querySelector('[role="alert"]').textContent).toMatch(/Proiectul nu a putut fi citit/)
  })

  it('eroare la oameni = avertisment vizibil, antetul rămâne completat, numele goale', async () => {
    const u = await monteaza()
    await u.click(u.buton())
    await u.elibereaza(0, { data: PROIECT, error: null })
    await u.elibereaza(1, { data: null, error: { message: 'timeout' } })
    expect(u.d.querySelector('[data-pv-avertisment]').textContent).toMatch(/nu s-au putut citi \(timeout\)/)
    expect(u.camp('beneficiar').value).toBe('SNTGN TRANSGAZ SA')
    const nume = [...u.d.querySelectorAll('[data-pv-participant]')].map(r => r.querySelectorAll('input')[1].value)
    expect(nume.every(n => n === '')).toBe(true)
  })

  it('rânduri de participanți: adaugă și șterge', async () => {
    const u = await monteaza()
    await deschideCuDate(u)
    await u.click(u.d.querySelector('[data-pv-adauga-participant]'))
    expect(u.d.querySelectorAll('[data-pv-participant]')).toHaveLength(6)
    await u.click(u.d.querySelectorAll('[data-pv-sterge-participant]')[0])
    const calitati = [...u.d.querySelectorAll('[data-pv-participant]')].map(r => r.querySelector('input').value)
    expect(calitati).toHaveLength(5)
    expect(calitati[0]).toBe('Transgaz – Exploatarea Teritorială / Sector (manevre)')
  })

  it('„Preia numele șantierului” completează locul doar la cerere', async () => {
    const u = await monteaza()
    await deschideCuDate(u)
    expect(u.camp('locul').value).toBe('')
    await u.click(u.d.querySelector('[data-pv-preia-santier]'))
    expect(u.camp('locul').value).toBe('Șantier Domnești')
    expect(u.d.querySelector('[data-pv-preia-santier]')).toBeNull()
  })

  it('„Descarcă Word”: fișierul cu numele din specificație conține ce s-a scris în formular', async () => {
    const u = await monteaza()
    await deschideCuDate(u)
    await u.scrie(u.camp('data_cuplarii'), '2026-11-26')
    await u.scrie(u.camp('srm'), 'SRM Domnești AG (SM1104D0)')
    await u.scrie(u.camp('intervale'), 'punere în siguranță 08:00–09:30\nextragere obturatoare 16:00–17:00')
    await u.click(u.d.querySelector('[data-pv-descarca]'))
    for (let i = 0; i < 20 && !u.descarcari.length; i++) await new Promise(r => setTimeout(r, 25))
    expect(u.descarcari).toEqual(['PV_predare_conducta_cuplare_TEST-PV_2026-11-26.docx'])
    const zip = await JSZip.loadAsync(await u.bloburi[0].arrayBuffer())
    const xml = await zip.file('word/document.xml').async('string')
    expect(xml).toContain('SRM Domnești AG (SM1104D0)')
    expect(xml).toContain('Nr. ______ / 26.11.2026')
    expect(xml).toContain('punere în siguranță 08:00–09:30; extragere obturatoare 16:00–17:00')
    await new Promise(r => setTimeout(r, 0)); await u.click(u.d.body)
    expect(u.d.querySelector('[role="status"]').textContent).toMatch(/✓ PV_predare_conducta_cuplare_TEST-PV_2026-11-26\.docx/)
  })

  it('L24: răspunsul întârziat al proiectului vechi nu se aplică după schimbarea proiectului', async () => {
    const u = await monteaza(5)
    await u.click(u.buton())
    await u.randeaza(6, { id: 6 })          // utilizatorul a trecut la alt proiect
    await u.elibereaza(0, { data: PROIECT, error: null })
    expect(u.d.querySelector('[data-pv-cuplare-modal]')).toBeNull()
    expect(u.cereri).toHaveLength(1)        // nu s-a mai cerut nimic pentru proiectul vechi
  })

  it('L24: închiderea formularului în timpul citirii = răspunsul ignorat; redeschiderea citește din nou', async () => {
    const u = await monteaza()
    await u.click(u.buton())
    await u.click([...u.d.querySelectorAll('button')].find(b => b.textContent.includes('Închide')))
    await u.elibereaza(0, { data: PROIECT, error: null })
    expect(u.d.querySelector('[data-pv-cuplare-modal]')).toBeNull()
    await u.click(u.buton())
    expect(u.cereri).toHaveLength(2)
  })
})

describe('incarcaDatePv (fără DOM)', () => {
  it('proiect fără șef de șantier / RTE: o singură cerere, fără avertisment', async () => {
    const cereri = []
    const p = incarcaDatePv(clientFals(cereri), 5)
    await Promise.resolve()
    cereri[0].res({ data: { ...PROIECT, sef_santier_employee_id: null, rte_employee_id: null }, error: null })
    const r = await p
    expect(r.form.cod_intern).toBe('TEST-PV')
    expect(r.avertisment).toBeNull()
  })
  it('curent() fals după prima citire: întoarce null și nu mai cere oamenii', async () => {
    const cereri = []
    const p = incarcaDatePv(clientFals(cereri), 5, () => false)
    cereri[0].res({ data: PROIECT, error: null })
    expect(await p).toBeNull()
    expect(cereri).toHaveLength(1)
  })
})

dom(numeDom('PvCuplareGenerator — răspuns pentru alt proiect'), () => {
  it('rândul întors are alt id decât proiectul deschis = eroare, nu formular', async () => {
    const u = await monteaza()
    await u.click(u.buton())
    await u.elibereaza(0, { data: { ...PROIECT, id: 99, sef_santier_employee_id: null, rte_employee_id: null }, error: null })
    expect(u.d.querySelector('[role="alert"]').textContent).toMatch(/nu corespunde proiectului deschis/)
    expect(u.camp('obiectiv')).toBeNull()
  })
})
