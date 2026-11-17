// Test de NAVIGARE reală prin modulul Execuție (src/Executie.jsx): pagina reală montată cu react-dom în jsdom, într-un MemoryRouter, cu un
// client Supabase FALS; sub-ecranele grele (Izometrie, Tronsoane, Nod, Probe, Uscare, Fibră, Grafic etc.) sunt înlocuite cu marcaje, ca
// testul să probeze DOAR drumul: banda „Execuție | Proiecte”, bara sub-filelor Izometriei și URL-ul (`?tab=`). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la src/UscareConducta.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el, suita
// e SĂRITĂ VIZIBIL.
// Ce probează (runda 3 a PR #1127, verdict P2-2): sub-fila afișată are O SINGURĂ sursă, URL-ul. Reproducerea recenzentului: deschizi
// ?tab=uscare, apeși fila principală „Izometrie” → URL-ul devine tab=izometrie; înainte sub-fila locală rămânea „uscare” (formularul de
// uscare rămânea pe ecran, banda redevenea lipită, iar după reîncărcare se vedea altceva). Acum ecranul urmează URL-ul la fiecare pas, iar
// „reîncărcarea” (montare nouă pe același URL) arată același lucru.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

// factoriile vi.mock sunt ridicate deasupra importurilor: ce folosesc ele vine tot din vi.hoisted; marcajul se construiește cu React importat
// dinamic în factorie (la ridicare, importul static de React încă nu e evaluat)
// clientul fals se schimbă la fiecare test; modulele (care creează clientul la import) primesc un intermediar stabil
const { fals, marcaj } = vi.hoisted(() => {
  const h = { cur: null }
  h.client = {
    auth: { getUser: (...a) => h.cur.auth.getUser(...a), getSession: (...a) => h.cur.auth.getSession(...a) },
    from: t => h.cur.from(t), rpc: (...a) => h.cur.rpc(...a), storage: { from: b => h.cur.storage.from(b) },
  }
  return {
    fals: h,
    marcaj: (nume, extra = {}) => async () => {
      const R = await import('react')
      return { default: () => R.createElement('div', { 'data-ecran': nume }, 'ECRAN ' + nume), ...extra }
    },
  }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fals.client }))
vi.mock('./lib/supabase.js', () => ({ supabase: fals.client }))
vi.mock('./lib/storageRls.js', () => ({ instrumenteazaStorageRls: c => c }))
vi.mock('./lib/sesiuneCereri.js', () => ({ optiuniClient: () => ({}) }))
vi.mock('./Izometrie.jsx', marcaj('izometrie'))
vi.mock('./TabTronsoane.jsx', marcaj('tronsoane'))
vi.mock('./NodCuplareSectiuni.jsx', marcaj('nod'))
vi.mock('./ProbeTronsoane.jsx', marcaj('probe'))
vi.mock('./UscareConducta.jsx', marcaj('uscare'))
vi.mock('./FibraOptica.jsx', marcaj('fibra'))
vi.mock('./TabMeteoIstoric.jsx', marcaj('meteo'))
vi.mock('./ExecutieGrafic.jsx', marcaj('grafic'))
vi.mock('./DevizVsExecutatTab.jsx', marcaj('deviz'))
vi.mock('./ContractProiectTab.jsx', marcaj('contract'))
vi.mock('./TabSituatiiPlata.jsx', marcaj('situatii_plata'))
vi.mock('./TabDocumenteNAS.jsx', marcaj('documente'))
vi.mock('./CereriInterneProiect.jsx', marcaj('cereri'))
vi.mock('./ConsumuriBonuriTab.jsx', marcaj('consumuri'))
vi.mock('./TabSantiere.jsx', marcaj('santiere', { NavetaTura: () => null }))
vi.mock('./Meteo.jsx', () => ({ MeteoToggle: () => null, MeteoSantier: () => null }))
vi.mock('./CitesteOricePanel.jsx', () => ({ default: () => null }))
vi.mock('./DocumenteDeRepartizat.jsx', () => ({ default: () => null }))
vi.mock('./CatalogDevizPanel.jsx', () => ({ default: () => null }))
vi.mock('./ActivitatiProiectPanel.jsx', () => ({ default: () => null }))
vi.mock('./MaterialeProiectPanel.jsx', () => ({ default: () => null }))
vi.mock('./UnitatiProiectPanel.jsx', () => ({ default: () => null }))
vi.mock('./ProiectNouWizard.jsx', () => ({ default: () => null }))
vi.mock('./PoliteProiectCard.jsx', () => ({ default: () => null }))
vi.mock('./redari/ui/LegaturaExecutie.jsx', () => ({ default: () => null }))
vi.mock('./OameniSantierButon.jsx', () => ({ default: () => null }))
vi.mock('./ContractNelegatPanel.jsx', () => ({ default: () => null }))
vi.mock('./OfertarePF.jsx', () => ({ default: () => null, useAccesPF: () => ({ gata: true }) }))
vi.mock('./ExecutieDeciziiEchipa.jsx', () => ({ useDeciziiProiect: () => ({}), EtichetaDecizie: () => null, EchipaExtinsa: () => null, GeneratorProiect: () => null }))
import { MemoryRouter, useLocation } from 'react-router-dom'
import ExecutiePage from './Executie.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[Executie.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

// clientul fals: contul u1 (owner), proiectul 1 în v_executie_dashboard; restul tabelelor goale. Lanțul de interogare e generic.
function clientFals() {
  const T = {
    profiles: [{ id: 'u1', is_owner: true, role: 'owner', can_manage_contracts: true }],
    v_executie_dashboard: [{ id: 1, cod_intern: 'T1', nume: 'Proiect test', site_name: null, data_termen: null, zile_pana_termen: null }],
  }
  const interogare = tabel => {
    const f = { eq: [], unul: false }
    const q = {
      select: () => q, order: () => q, in: () => q, limit: () => q, gt: () => q, lt: () => q, is: () => q, or: () => q, not: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q }, maybeSingle: () => { f.unul = true; return q }, single: () => { f.unul = true; return q },
      then: (res, rej) => {
        const r = (T[tabel] || []).filter(x => f.eq.every(([c, v]) => String(x[c]) === String(v))).map(x => ({ ...x }))
        return Promise.resolve({ data: f.unul ? r[0] || null : r, error: null }).then(res, rej)
      },
    }
    return q
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }), getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    from: interogare, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  }
}
// sonda URL-ului curent (ce ar vedea bara de adrese), pusă lângă pagină în același router
function SondaUrl() { const l = useLocation(); return <div id="url">{l.pathname + l.search}</div> }

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(adresa) {
  fals.cur = clientFals()
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<MemoryRouter initialEntries={[adresa]}><ExecutiePage /><SondaUrl /></MemoryRouter>) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const butoane = () => [...d.querySelectorAll('button')]
  // fila principală (banda „Execuție | Proiecte”) după descrierea ei (title); sub-fila Izometriei după text
  const filaPrincipala = titlu => { const b = butoane().find(x => x.getAttribute('title') === titlu); if (!b) throw new Error('nu găsesc fila ' + titlu); return b }
  const subFila = text => { const b = butoane().find(x => x.hasAttribute('data-activ') && x.textContent.includes(text)); if (!b) throw new Error('nu găsesc sub-fila ' + text); return b }
  const subFilaActiva = () => d.querySelector('[data-activ="1"]')?.textContent.trim() ?? null
  const ecrane = () => [...d.querySelectorAll('[data-ecran]')].map(e => e.getAttribute('data-ecran'))
  // banda de sus: elementul cu `top: 60px` și z-index 50 (singurul din pagină)
  const banda = () => [...d.querySelectorAll('div')].find(x => x.style.top === '60px' && x.style.zIndex === '50')
  const url = () => d.getElementById('url').textContent
  return { d, apasa, filaPrincipala, subFila, subFilaActiva, ecrane, banda, url, text: () => d.body.textContent }
}

dom(numeDom('Execuție — navigarea între file și sub-file (jsdom + react-dom + MemoryRouter)'), () => {
  it('runda 3 (P2-2): sub-fila urmează URL-ul: „Izometrie” din banda principală scoate uscarea de pe ecran și relipește banda; sub-filele scriu URL-ul; reîncărcarea arată același ecran', async () => {
    const u = await monteaza('/executie?proiect=1&tab=uscare')
    expect(u.text()).toContain('T1')
    expect(u.ecrane()).toEqual(['uscare'])
    expect(u.subFilaActiva()).toBe('💨 Uscare conductă')
    expect(u.banda().style.position).toBe('static')                          // cât e deschisă uscarea, banda derulează cu pagina
    // reproducerea recenzentului: fila principală „Izometrie”
    await u.apasa(u.filaPrincipala('Pachete lansare · Tronsoane · Cumulat'))
    expect(u.url()).toBe('/executie?proiect=1&tab=izometrie')
    expect(u.ecrane()).toEqual(['izometrie'])                                 // uscarea NU mai e pe ecran
    expect(u.subFilaActiva()).toBe('📐 Izometrie')
    expect(u.banda().style.position).toBe('sticky')                           // banda redevine lipită
    // sub-fila „Uscare conductă”: URL-ul și ecranul, împreună
    await u.apasa(u.subFila('Uscare conductă'))
    expect(u.url()).toBe('/executie?proiect=1&tab=uscare')
    expect(u.ecrane()).toEqual(['uscare'])
    expect(u.subFilaActiva()).toBe('💨 Uscare conductă')
    expect(u.banda().style.position).toBe('static')
    // altă sub-filă (fibra): la fel; banda lipită
    await u.apasa(u.subFila('Fibră optică'))
    expect(u.url()).toBe('/executie?proiect=1&tab=fibra')
    expect(u.ecrane()).toEqual(['fibra'])
    expect(u.subFilaActiva()).toBe('🧵 Fibră optică')
    expect(u.banda().style.position).toBe('sticky')
    // o filă principală care nu e a Izometriei: bara sub-filelor dispare
    await u.apasa(u.filaPrincipala('Dashboard · Echipă · ISC · Stadiu'))
    expect(u.url()).toBe('/executie?proiect=1&tab=proiect')
    expect(u.subFilaActiva()).toBe(null)
    expect(u.ecrane()).not.toContain('fibra')
    // „reîncărcarea” (montare nouă pe URL-ul rămas după navigare) arată același ecran ca înaintea ei
    curata.pop()()
    const v = await monteaza('/executie?proiect=1&tab=izometrie')
    expect(v.ecrane()).toEqual(['izometrie'])
    expect(v.subFilaActiva()).toBe('📐 Izometrie')
    expect(v.banda().style.position).toBe('sticky')
    curata.pop()()
    const w = await monteaza('/executie?proiect=1&tab=nod')                   // link direct de pe telefon
    expect(w.ecrane()).toEqual(['nod'])
    expect(w.subFilaActiva()).toBe('🔩 Nod cuplare')
  })
})
