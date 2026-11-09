// Teste de componentă pentru OameniSantierButon: componenta reală montată cu react-dom în jsdom; exportul e înlocuit cu promisiuni
// eliberate manual de test (ordinea răspunsurilor controlată). Fără rețea, fără librării noi: jsdom se caută în node_modules sau în
// REDARI_JSDOM_DIR (tiparul din NodCuplareSchema.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const cereri = []
vi.mock('./executieOameniXlsx.js', () => ({
  ExportAnulat: class ExportAnulat extends Error {},
  exportaOameniProiect: vi.fn((sb, proiectId, azi, semnal) => {
    let res, rej
    const p = new Promise((a, b) => { res = a; rej = b })
    cereri.push({ proiectId, semnal, res, rej })
    return p
  }),
}))
import OameniSantierButon from './OameniSantierButon.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[OameniSantierButon.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; cereri.length = 0; vi.restoreAllMocks() })

async function monteaza(proiectId = 1, proiect = { id: proiectId }) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const descarcari = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  j.window.HTMLAnchorElement.prototype.click = function () { descarcari.push(this.download) }
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }) }
  const randeaza = async (pid, pr = { id: pid }) => { await act(async () => { root.render(<OameniSantierButon supabase={{}} proiectId={pid} proiect={pr} />) }); await asteapta() }
  let montat = true
  const demonteaza = async () => { if (montat) { montat = false; await act(async () => { root.unmount() }) } }
  await randeaza(proiectId, proiect)
  curata.push(() => { if (montat) act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = () => d.querySelector('[data-oameni-santier-excel]')
  const apasa = async () => { await act(async () => { buton().dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const elibereaza = async (i, val, eroare = false) => { await act(async () => { eroare ? cereri[i].rej(val) : cereri[i].res(val) }); await asteapta() }
  const mesaj = () => d.querySelector('[role="status"], [role="alert"]')
  return { d, buton, apasa, elibereaza, mesaj, randeaza, demonteaza, descarcari }
}

dom(numeDom('OameniSantierButon'), () => {
  it('apăsare → „Se pregătește” (buton blocat) → fișier descărcat și număr afișat', async () => {
    const u = await monteaza(1)
    await u.apasa()
    expect(u.mesaj().textContent).toContain('Se pregătește')
    expect(u.buton().disabled).toBe(true)
    await u.apasa()                                   // a doua apăsare cât lucrează: nicio cerere nouă
    expect(cereri.length).toBe(1)
    await u.elibereaza(0, { nrOameni: 74, nrFoi: 2, bytes: new Uint8Array([1]), numeFisier: 'Oameni_santier_X_09.11.2026.xlsx' })
    expect(u.descarcari).toEqual(['Oameni_santier_X_09.11.2026.xlsx'])
    expect(u.mesaj().textContent).toBe('✓ 74 oameni, 2 șantiere')
    expect(u.buton().disabled).toBe(false)
  })
  it('eroarea se afișează (rol alert), nu se descarcă nimic (L18)', async () => {
    const u = await monteaza(1)
    await u.apasa()
    await u.elibereaza(0, new Error('pontajul pe șantierele proiectului: permission denied'), true)
    expect(u.mesaj().getAttribute('role')).toBe('alert')
    expect(u.mesaj().textContent).toBe('Exportul nu s-a putut face: pontajul pe șantierele proiectului: permission denied')
    expect(u.descarcari).toEqual([])
  })
  it('fără șantiere / fără oameni: informare distinctă, fără fișier', async () => {
    const u = await monteaza(1)
    await u.apasa()
    await u.elibereaza(0, { faraSantiere: true, nrOameni: 0, nrFoi: 0 })
    expect(u.mesaj().textContent).toBe('Proiectul nu are șantiere legate în ERP.')
    await u.apasa()
    await u.elibereaza(1, { faraSantiere: false, nrOameni: 0, nrFoi: 0 })
    expect(u.mesaj().textContent).toContain('Niciun om activ')
    expect(u.descarcari).toEqual([])
  })
  it('rezultatul unei apăsări vechi nu se aplică după schimbarea proiectului; citirea veche e anulată (L24)', async () => {
    const u = await monteaza(1)
    await u.apasa()
    await u.randeaza(2)                               // utilizatorul a trecut pe alt proiect cât se pregătea lista
    expect(cereri[0].semnal.anulat).toBe(true)
    expect(u.mesaj()).toBe(null)
    await u.elibereaza(0, { nrOameni: 5, nrFoi: 1, bytes: new Uint8Array([1]), numeFisier: 'vechi.xlsx' })
    expect(u.descarcari).toEqual([])
    expect(u.mesaj()).toBe(null)
    await u.apasa()
    expect(cereri[1].proiectId).toBe(2)
    await u.elibereaza(1, new Error('x'), true)
    await u.elibereaza(0, new Error('tarziu'), true)  // o eroare întârziată a cererii vechi nu suprascrie mesajul curent
    expect(u.mesaj().textContent).toBe('Exportul nu s-a putut face: x')
  })
  it('ieșirea din pagină în timpul exportului: citirea e anulată, nicio descărcare (review r1 P2)', async () => {
    const u = await monteaza(1)
    await u.apasa()
    await u.demonteaza()
    expect(cereri[0].semnal.anulat).toBe(true)
    await u.elibereaza(0, { nrOameni: 5, nrFoi: 1, bytes: new Uint8Array([1]), numeFisier: 'dupa_iesire.xlsx' })
    expect(u.descarcari).toEqual([])
  })
  it('butonul apare doar când proiectul încărcat în pagină e proiectul curent (review r1 P2)', async () => {
    const u = await monteaza(2, { id: 1 })          // bannerul încă are proiectul vechi (1), URL-ul e deja pe 2
    expect(u.buton()).toBe(null)
    await u.randeaza(2, null)                         // se încarcă proiectul 2
    expect(u.buton()).toBe(null)
    await u.randeaza(2, { id: 2 })
    expect(u.buton()).not.toBe(null)
    await u.randeaza('2', { id: 2 })                  // id din URL (text) = id din BD (număr)
    expect(u.buton()).not.toBe(null)
  })
})
