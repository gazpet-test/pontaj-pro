// Test de NAVIGARE reală prin modulul Execuție (src/Executie.jsx): pagina reală montată cu react-dom în jsdom, într-un MemoryRouter, cu un
// client Supabase FALS; sub-ecranele grele (Izometrie, Tronsoane, Nod, Probe, Uscare, Fibră, Grafic etc.) sunt înlocuite cu marcaje, ca
// testul să probeze DOAR drumul: banda „Execuție | Proiecte”, bara sub-filelor Izometriei și URL-ul (`?tab=`). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la src/UscareConducta.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el, suita
// e SĂRITĂ VIZIBIL (navigarea), iar suita filei „Rest de decontat” PICĂ explicit (PR3 r2).
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
vi.mock('./ExecutieSemnale.jsx', marcaj('semnale', { SemnaleOwnerPanel: () => null }))
// tab-ul „Rest de decontat” e marcaj; dreptul (src/restDecontat/dreptRestDecontat.js) rămâne REAL: fila apare doar după răspunsul RPC-ului
vi.mock('./restDecontat/RestDecontatTab.jsx', marcaj('rest_decontat'))
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

async function monteaza(adresa, { rpc = null } = {}) {
  fals.cur = clientFals()
  if (rpc) fals.cur.rpc = rpc
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

// „💰 Rest de decontat” (PR3 r2, verdict #1178): suita PICĂ explicit fără jsdom (nu se sare) — jsdom nu e în package-lock, deci nu se declară
const MOTIV_LIPSA = 'LIPSEȘTE jsdom: testul filei „Rest de decontat” nu se sare (rulați cu REDARI_JSDOM_DIR=<folder cu jsdom>)'
const domObligatoriu = (nume, fn) => (JSDOM ? describe(nume, fn) : describe(nume, () => { it('jsdom e obligatoriu', () => { throw new Error(MOTIV_LIPSA) }) }))
domObligatoriu('Execuție — fila „Rest de decontat” (jsdom + react-dom + MemoryRouter)', () => {
  it('„💰 Rest de decontat”: fila apare DOAR când fn_rest_decontat_drept(proiect, citire) e adevărat (RPC, nu rolul); eroarea RPC-ului = mesaj separat cu reîncercare, FĂRĂ filă', async () => {
    const TITLU = 'Ofertă + acte − situații confirmate · pe articol, obiect, proiect · Excel (owner, MP, acces „Rest de decontat”)'
    const are = u => u.d.querySelectorAll('button').length > 0 && [...u.d.querySelectorAll('button')].some(b => b.getAttribute('title') === TITLU)
    const cereri = []
    const drept = citire => async (fn, a) => { cereri.push([fn, a]); return fn === 'fn_rest_decontat_drept' ? { data: a.p_nivel === 'citire' ? citire : false, error: null } : { data: null, error: null } }
    // owner în profil, dar RPC-ul spune „nu” → fila nu apare (nu se deduce din rol)
    const u = await monteaza('/executie?proiect=1&tab=proiect', { rpc: drept(false) })
    expect(are(u)).toBe(false)
    expect(cereri.filter(([fn]) => fn === 'fn_rest_decontat_drept').map(([, a]) => a)).toEqual([
      { p_proiect: 1, p_nivel: 'citire' }, { p_proiect: 1, p_nivel: 'confirmare' }, { p_proiect: 1, p_nivel: 'documente_baza' }])
    curata.pop()()
    const v = await monteaza('/executie?proiect=1&tab=proiect', { rpc: drept(true) })
    expect(are(v)).toBe(true)
    // fila stă imediat după „Situații plată”
    const titluri = [...v.d.querySelectorAll('button[title]')].map(b => b.getAttribute('title'))
    expect(titluri[titluri.indexOf('SL1–SL6 · NCS · Facturare') + 1]).toBe(TITLU)
    await v.apasa(v.filaPrincipala(TITLU))
    expect(v.url()).toBe('/executie?proiect=1&tab=rest_decontat')
    expect(v.ecrane()).toEqual(['rest_decontat'])
    curata.pop()()
    // eroarea întrebării: NICI filă, NICI „fără drept” tăcut — mesaj separat în bandă, cu reîncercare; a doua întrebare reușește → fila apare
    let nEroare = 0
    const w = await monteaza('/executie?proiect=1&tab=proiect', { rpc: async (fn, a) => (fn !== 'fn_rest_decontat_drept' ? { data: null, error: null }
      : ++nEroare <= 3 ? { data: null, error: { message: 'function fn_rest_decontat_drept does not exist' } } : { data: a.p_nivel === 'citire', error: null }) })
    expect(are(w)).toBe(false)
    const mesaj = w.d.querySelector('[data-drept-rest-eroare]')
    expect(mesaj.textContent).toContain('dreptul nu s-a putut verifica')
    expect(mesaj.getAttribute('title')).toContain('function fn_rest_decontat_drept does not exist')
    await w.apasa(mesaj)
    expect(nEroare).toBe(6)
    expect(are(w)).toBe(true)
    expect(w.d.querySelector('[data-drept-rest-eroare]')).toBe(null)
    curata.pop()()
    // link vechi direct pe tab=rest_decontat cu eroare: ecranul tab-ului (care arată eroarea) se montează, dar fila nu apare în bandă
    const x = await monteaza('/executie?proiect=1&tab=rest_decontat', { rpc: async () => ({ data: null, error: { message: 'boom' } }) })
    expect(are(x)).toBe(false)
    expect(x.d.querySelector('[data-drept-rest-eroare]')).not.toBe(null)
    curata.pop()()
    const z = await monteaza('/executie', { rpc: drept(true) })               // fără proiect deschis: nicio întrebare, nicio filă
    expect(are(z)).toBe(false)
  })
})
