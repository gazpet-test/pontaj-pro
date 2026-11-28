// Test de componentă: „📐 Izometrii generate” din CTC, montat cu react-dom în jsdom, cu un client Supabase FALS (fără rețea).
// #1219: exportul IZO livrat în fișiere separate se descarcă ÎNTREG (ZIP local), nu doar Excel-ul.
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import JSZip from 'jszip'
import { clientFals, fixturaSeparat, CONTINUT } from './ctcIzometriiFals.js'

const client = vi.hoisted(() => ({ sb: null }))
vi.mock('../lib/supabase.js', () => ({ get supabase() { return client.sb } }))
import CtcIzometriiProiect from './CtcIzometriiProiect.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[CtcIzometriiProiect.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(o = {}) {
  const f = fixturaSeparat()
  const c = clientFals({ tabele: f.tabele, obiecte: f.obiecte, ...o })
  client.sb = c.sb
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch }
  Object.assign(globalThis, { window: j.window, document: j.window.document, fetch: c.fetchFals })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const d = j.window.document
  // descărcarea locală: blob-ul și numele din <a download>, fără navigare în jsdom
  const blobs = [], clicuri = [], deschise = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blobs.push(b); return 'blob:fals/' + blobs.length })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  d.addEventListener('click', e => { if (e.target.tagName === 'A') { clicuri.push(e.target.getAttribute('download')); e.preventDefault() } })
  j.window.open = (...a) => { deschise.push(a); return null }
  const root = createRoot(d.getElementById('r'))
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<CtcIzometriiProiect proiectId={1} />) })
  await asteapta()
  const inchide = () => { act(() => root.unmount()); Object.assign(globalThis, vechi); client.sb = null }
  curata.push(inchide)
  const demonteaza = () => { curata = curata.filter(x => x !== inchide); inchide() }
  const clic = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }) }
  const randDe = nume => [...d.querySelectorAll('b')].find(b => b.textContent === nume)?.parentElement?.parentElement
  // după click: până nu mai e niciun buton „Se descarcă...” (JSZip lucrează cu timere reale, nu doar microtask-uri)
  const apasa = async el => {
    await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) })
    for (let i = 0; i < 200 && [...d.querySelectorAll('button')].some(b => b.textContent === 'Se descarcă...'); i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    }
    expect([...d.querySelectorAll('button')].some(b => b.textContent === 'Se descarcă...')).toBe(false)
    await asteapta()
  }
  return { d, f, c, blobs, clicuri, deschise, randDe, apasa, asteapta, clic, demonteaza }
}

dom(numeDom('CtcIzometriiProiect — livrare separată (jsdom + react-dom)'), () => {
  it('rândul livrat separat spune „+ PDF-urile în fișiere separate” și „Descarcă” aduce TOATE fișierele într-un ZIP local', async () => {
    const m = await monteaza()
    const r = m.randDe('99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx')
    expect(r.textContent).toMatch(/\+ PDF-urile în fișiere separate/)
    const btn = [...r.querySelectorAll('button')].find(b => b.textContent.includes('Descarcă'))
    expect(btn.textContent).toBe('⬇ Descarcă (ZIP)')
    await m.apasa(btn)
    expect(m.deschise).toEqual([])   // nu doar link-ul Excel-ului
    expect(m.clicuri).toEqual(['99_GAZ_X_DWG_00001_rev0_Centralizator.zip'])
    const zip = await JSZip.loadAsync(new Uint8Array(await m.blobs[0].arrayBuffer()))
    expect(Object.keys(zip.files).filter(n => !n.endsWith('/')).sort()).toEqual(Object.keys(CONTINUT).sort())
    for (const [n, b] of Object.entries(CONTINUT)) expect(await zip.file(n).async('uint8array')).toEqual(b)
    expect(m.d.querySelector('[role="status"]').textContent).toMatch(/3 fișiere de pe server, puse într-o arhivă/)
    expect(m.d.querySelector('[role="alert"]')).toBeNull()
  })

  it('fără drept de citire pe arhiva NDT → mesaj vizibil, nicio descărcare', async () => {
    const m = await monteaza({ drept: false })
    const r = m.randDe('99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx')
    await m.apasa([...r.querySelectorAll('button')].find(b => b.textContent.includes('Descarcă')))
    expect(m.d.querySelector('[role="alert"]').textContent).toMatch(/dreptul de citire pe arhiva de buletine NDT.*nu s-a descărcat nimic/)
    expect(m.clicuri).toEqual([])
    expect(m.deschise).toEqual([])
    expect(m.c.jurnal.semnat).toEqual([])
  })

  it('ecranul închis în timpul transferului (Jakarinos r1 P2, L24) → transferul se oprește, restul nu se mai cere, nicio descărcare locală', async () => {
    // primul transfer stă până după închidere, apoi se termină: fără oprire, descărcarea ar continua cu celelalte fișiere
    let pornit, elibereaza
    const primul = new Promise(r => { pornit = r })
    const liber = new Promise(r => { elibereaza = r })
    const m = await monteaza({ poarta: () => { pornit(); return liber } })
    const r = m.randDe('99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx')
    await m.clic([...r.querySelectorAll('button')].find(b => b.textContent.includes('Descarcă')))
    await primul   // primul fișier e în transfer
    m.demonteaza()
    elibereaza()
    await new Promise(res => setTimeout(res, 100))
    expect(m.c.jurnal.fetch).toHaveLength(1)
    expect(m.c.jurnal.semnat).toHaveLength(1)
    expect(m.blobs).toEqual([])
    expect(m.clicuri).toEqual([])
  })

  it('fișier lipsă → mesaj cu numele lui, fără ZIP parțial', async () => {
    const m = await monteaza()
    m.f.obiecte.delete(`executie-pachete-pdf/${m.f.fisiere[1]}`)
    const r = m.randDe('99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx')
    await m.apasa([...r.querySelectorAll('button')].find(b => b.textContent.includes('Descarcă')))
    expect(m.d.querySelector('[role="alert"]').textContent).toMatch(/buletine\/PM_5_21\.10\.2026\.pdf: descărcare eșuată \(404\)/)
    expect(m.blobs).toEqual([])
    expect(m.clicuri).toEqual([])
  })

  it('Excel-ul vechi (un singur fișier) se deschide ca până acum, prin link semnat, fără mențiune', async () => {
    const m = await monteaza({ drept: false })
    const btnToate = [...m.d.querySelectorAll('button')].find(b => b.textContent.startsWith('Toate reviziile'))
    if (btnToate) await m.apasa(btnToate)
    const r = m.randDe('vechi.xlsx')
    expect(r.textContent).not.toMatch(/fișiere separate/)
    await m.apasa([...r.querySelectorAll('button')].find(b => b.textContent.includes('Descarcă')))
    expect(m.deschise).toEqual([['https://fals/executie-pachete-pdf/9/2026-06-01_ab_vechi.xlsx', '_blank', 'noopener']])
    expect(m.c.jurnal.rpc).toEqual([])
    expect(m.clicuri).toEqual([])
  })
})
