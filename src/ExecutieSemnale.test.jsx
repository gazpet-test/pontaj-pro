// Teste de componentă pentru ExecutieSemnale („🔔 Semnale”, 20270106a): componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS
// ale cărui răspunsuri se pot ține și elibera manual. Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la ContractProiectTab.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e
// SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import ExecutieSemnale, { SemnaleOwnerPanel } from './ExecutieSemnale.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[ExecutieSemnale.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const AZI = '2026-11-21'
const SEM = (id, extra = {}) => ({
  id, proiect_id: 1, proiect_cod: 'P1', proiect_nume: 'Proiect unu', flux: 'lipsuri', tip: 'termen_apropiat', obiect: 'contract:termen', gravitate: 'atentie',
  titlu: `Semnal ${id}`, detalii: 'detalii ' + id, constatare: 'constatat', surse_consultate: [], dovada_sursa: 'camp_erp', dovada_data: '2026-11-21',
  dovada_fragment: 'data_termen = 2026-12-11', dovada_ref: 'executie_proiecte.data_termen', dovada_amprenta: '0'.repeat(32), termen: '2026-12-11', termen_baza: 'câmpul data_termen',
  termen_confirmat: true, incertitudine: null, propunere: 'Verificați AA.', responsabil_employee_id: null, responsabil_sursa: null, stare: 'nou', stare_motiv: null,
  stare_dovada: null, actiune_ref: null, stare_de: null, stare_la: null, regula_versiune: 'lipsuri-v1', detectat_la: '2026-11-21T20:00:00+00:00',
  ultima_verificare: '2026-11-21T20:00:00+00:00', versiune: 1, ...extra,
})
const ANG = [{ id: 10, name: 'POPESCU ION', active: true }, { id: 11, name: 'IONESCU ANA', active: true }, { id: 15, name: 'PLECAT X', active: false }]

// clientul fals: vederea (pagini keyset pe id), angajații, jurnalul; RPC-ul se eliberează manual
function clientFals({ randuri = [], jurnal = {}, erori = {} } = {}) {
  const server = new Map(randuri.map(r => [r.id, { ...r }]))
  const st = { poarta: null, rpc: [], cereri: [] }
  const client = {
    from: tabel => {
      const f = { eq: {}, in: null, gt: null, lim: 1000 }
      const q = {
        select: () => q, order: () => q, limit: n => { f.lim = n; return q },
        eq: (c, v) => { f.eq[c] = v; return q }, in: (_c, v) => { f.in = v; return q }, gt: (_c, v) => { f.gt = v; return q },
        then: (res, rej) => {
          st.cereri.push({ tabel, ...f })
          if (erori[tabel]) return Promise.resolve({ data: null, error: erori[tabel] }).then(res, rej)
          let rows
          if (tabel === 'v_executie_semnale') rows = [...server.values()].filter(r => (f.eq.proiect_id == null || r.proiect_id === f.eq.proiect_id) && (f.gt == null || r.id > f.gt)).sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
          else if (tabel === 'employees') rows = (f.in ? ANG.filter(a => f.in.includes(a.id)) : ANG).filter(a => f.gt == null || a.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim).map(a => ({ ...a }))
          else if (tabel === 'executie_semnale_jurnal') rows = (jurnal[f.eq.semnal_id] || []).filter(j => f.gt == null || j.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim)
          else rows = []
          const poarta = tabel === 'v_executie_semnale' && f.gt == null ? st.poarta : null
          return (poarta ? poarta.p : Promise.resolve()).then(() => ({ data: rows, error: null })).then(res, rej)
        },
      }
      return q
    },
    // moduri: 'ok' / 'auto' (serverul aplică); 'conflict'; 'refuz' (4xx: nimic scris); 'retea' / '5xx' (serverul A COMIS, răspunsul s-a pierdut:
    // postgrest-js dă status 0 la „Failed to fetch”)
    rpc: (fn, a) => {
      const d = amana(); st.rpc.push({ fn, a, ...d })
      return d.p.then(mod => {
        if (mod === 'refuz') return { data: null, error: { code: '42501', message: 'semnale: semnalul nu există sau nu ai drept asupra lui' }, status: 403 }
        const r = server.get(a.p_id)
        if (mod === 'conflict' || r.versiune !== a.p_versiune) return { data: { ok: false, motiv: 'conflict', semnal: { ...r } }, error: null, status: 200 }
        Object.assign(r, { stare: a.p_stare || r.stare, stare_motiv: a.p_motiv, stare_dovada: a.p_dovada, actiune_ref: a.p_actiune_ref, versiune: r.versiune + 1,
          stare_de: 'u1', stare_la: '2026-11-22T08:00:00+00:00',
          ...(a.p_schimba_responsabil ? { responsabil_employee_id: a.p_responsabil, responsabil_sursa: 'om' } : {}) })   // ca serverul: orice alegere a omului = sursa om
        if (mod === 'retea') return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
        if (mod === '5xx') return { data: null, error: { message: 'gateway timeout' }, status: 504 }
        return { data: { ok: true, semnal: { ...r } }, error: null, status: 200 }
      })
    },
  }
  return { client, st, server }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })

async function monteaza(client, props = {}) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  const randeaza = async p => { await act(async () => { root.render(props.owner ? <SemnaleOwnerPanel client={client} /> : <ExecutieSemnale proiectId={1} client={client} azi={AZI} {...p} />) }); await asteapta() }
  await randeaza(props)
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = text => { const b = [...d.querySelectorAll('button')].filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const bifa = async el => { await act(async () => { el.click() }); await asteapta() }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  const camp = eticheta => d.querySelector(`[aria-label="${eticheta}"]`)
  const semnale = () => [...d.querySelectorAll('[data-semnal]')].map(x => Number(x.getAttribute('data-semnal')))
  return { d, buton, apasa, scrie, bifa, elibereaza, randeaza, camp, semnale, asteapta }
}

dom(numeDom('ExecutieSemnale (jsdom + react-dom)'), () => {
  it('lista: sortată după termen, deschisele implicit; filtrele pe gravitate / stare și textul; „arată și rezolvate”', async () => {
    const { client, st } = clientFals({ randuri: [
      SEM(1, { termen: '2026-12-11' }), SEM(2, { termen: '2026-11-30', gravitate: 'critic', titlu: 'Polița CAR expiră' }),
      SEM(3, { termen: null, gravitate: 'info', stare: 'in_lucru' }), SEM(4, { termen: '2026-11-25', stare: 'respins', stare_motiv: 'nu e cazul' }),
      SEM(9, { proiect_id: 2, proiect_cod: 'P2' }),
    ] })
    const u = await monteaza(client)
    expect(u.semnale()).toEqual([2, 1, 3])                          // fără respinsul 4 și fără P2 (filtrat pe proiect)
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale')[0].eq.proiect_id).toBe(1)
    expect(u.d.body.textContent).toContain('3 deschise din 4')
    expect(u.d.body.textContent).toContain('termen 30.11.2026 · 9 z')
    await u.bifa([...u.d.querySelectorAll('input[type="checkbox"]')][0])   // arată și rezolvate / respinse
    expect(u.semnale()).toEqual([4, 2, 1, 3])
    await u.apasa(u.buton('critic'))
    expect(u.semnale()).toEqual([2])
    await u.apasa(u.buton('critic'))
    await u.scrie(u.camp('caută'), 'polita car')
    expect(u.semnale()).toEqual([2])
    await u.scrie(u.camp('caută'), '')
    await u.apasa(u.buton('în lucru'))
    expect(u.semnale()).toEqual([3])
  })

  it('eroarea de citire se arată (nu listă goală); „Reîncearcă” cere din nou (L18)', async () => {
    const { client, st } = clientFals({ erori: { v_executie_semnale: { message: 'relation "public.v_executie_semnale" does not exist' } } })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Nu am putut încărca semnalele')
    expect(u.d.body.textContent).toContain('migrarea 20270106a')
    expect(u.d.body.textContent).not.toContain('Niciun semnal')
    const n = st.cereri.length
    await u.apasa(u.buton('Reîncearcă'))
    expect(st.cereri.length).toBeGreaterThan(n)
  })

  it('detaliile: constatarea, dovada, propunerea, istoricul; schimbarea stării cu motiv → RPC cu id + versiune (CAS), rândul se actualizează', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1, { responsabil_employee_id: 10, responsabil_sursa: 'agent' })],
      jurnal: { 1: [{ id: 1, semnal_id: 1, actiune: 'creat', actor: 'agent', stare_veche: null, stare_noua: 'nou', motiv: null, valori: {}, creat_la: '2026-11-21T20:00:00+00:00' }] } })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('POPESCU ION')
    expect(u.d.body.textContent).toContain('(propus de agent)')
    await u.bifa([...u.d.querySelectorAll('input[type="checkbox"]')][0])   // arată și rezolvate / respinse (ca rândul să rămână după respingere)
    await u.apasa(u.buton('Semnal 1'))
    expect(u.d.body.textContent).toContain('constatat (cu dovadă)')
    expect(u.d.body.textContent).toContain('câmp ERP · 21.11.2026 · data_termen = 2026-12-11')
    expect(u.d.body.textContent).toContain('Verificați AA.')
    expect(u.d.body.textContent).toContain('creat · agent')
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'respins')
    expect(u.d.body.textContent).toContain('Motiv (obligatoriu)')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(0)
    expect(u.d.body.textContent).toContain('Motivul e obligatoriu')
    await u.scrie(u.camp('motiv'), ' Termenul e prelungit prin AA 2. ')
    await u.scrie(u.camp('acțiune'), 'TKT-2026-9999')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].fn).toBe('fn_executie_semnal_stare')
    expect(st.rpc[0].a).toEqual({ p_id: 1, p_versiune: 1, p_stare: 'respins', p_motiv: 'Termenul e prelungit prin AA 2.', p_dovada: null, p_actiune_ref: 'TKT-2026-9999', p_responsabil: null, p_schimba_responsabil: false })
    expect(u.d.body.textContent).toContain('Se salvează…')
    await u.elibereaza(st.rpc[0], 'ok')
    expect(server.get(1).stare).toBe('respins')
    expect(u.d.body.textContent).toContain('Salvat: respins.')
    expect(u.d.body.textContent).toContain('decizia: respins · Termenul e prelungit prin AA 2.')
    expect(u.d.body.textContent).toContain('acțiune: TKT-2026-9999')
    // fără bifa „arată și rezolvate / respinse” respinsul dispare din listă
    await u.bifa([...u.d.querySelectorAll('input[type="checkbox"]')][0])
    expect(u.semnale()).toEqual([])
  })

  it('conflictul (versiune veche) reîncarcă lista și spune de ce; eroarea serverului se arată; responsabilul se schimbă doar cu bifa', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1, { stare: 'in_lucru', versiune: 3, stare_de: 'u1', stare_la: '2026-11-21T21:00:00+00:00' })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    expect(u.camp('responsabil')).toBeTruthy()
    expect([...u.camp('responsabil').querySelectorAll('option')].map(o => o.textContent)).toEqual(['— fără responsabil —', 'IONESCU ANA', 'POPESCU ION'])   // activii, sortați
    await u.scrie(u.camp('responsabil'), '11')
    server.get(1).versiune = 4                                      // altcineva a salvat între timp
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[0].a).toMatchObject({ p_id: 1, p_versiune: 3, p_stare: null, p_responsabil: 11, p_schimba_responsabil: true })
    const cereriInainte = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
    await u.elibereaza(st.rpc[0], 'auto')
    expect(u.d.body.textContent).toContain('s-a schimbat între timp')
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale').length).toBeGreaterThan(cereriInainte)
    expect(u.d.body.textContent).toContain('versiunea rândului 4')
    // a doua încercare, pe versiunea nouă: refuzul SIGUR al serverului (4xx) se arată ca eroare, fără reîncărcare, formularul rămâne
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    await u.scrie(u.camp('responsabil'), '11')
    await u.apasa(u.buton('Salvează'))
    const cereriRefuz = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
    await u.elibereaza(st.rpc[1], 'refuz')
    expect(u.d.body.textContent).toContain('Schimbarea nu s-a salvat')
    expect(u.d.body.textContent).toContain('nu ai drept')
    expect(u.d.body.textContent).not.toContain('Rezultat necunoscut')
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale').length).toBe(cereriRefuz)
    // a treia, reușită: numele noului responsabil apare, ca decizie a omului
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[2], 'ok')
    expect(server.get(1).responsabil_employee_id).toBe(11)
    expect(u.d.body.textContent).toContain('IONESCU ANA (stabilit de om)')
    expect(u.d.body.textContent).not.toContain('(propus de agent)')
  })

  it('rezultat NECUNOSCUT (eroare de rețea după COMMIT, 5xx): nu „nu s-a salvat”; formularul se închide, lista se reîncarcă și arată starea reală (L05)', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1), SEM(2, { titlu: 'Semnal 2' })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'in_lucru')
    await u.apasa(u.buton('Salvează'))
    const cereri = st.cereri.filter(c => c.tabel === 'v_executie_semnale').length
    await u.elibereaza(st.rpc[0], 'retea')                            // serverul a comis, răspunsul s-a pierdut (status 0)
    expect(server.get(1).stare).toBe('in_lucru')
    expect(u.d.body.textContent).toContain('Rezultat necunoscut')
    expect(u.d.body.textContent).not.toContain('Schimbarea nu s-a salvat')
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale').length).toBeGreaterThan(cereri)   // reîncărcat
    expect(u.d.querySelector('[data-semnal="1"]').textContent).toContain('în lucru')                 // starea reală, de pe server
    expect(u.d.querySelector('[data-semnal="1"]').textContent).toContain('versiunea rândului 2')
    expect(u.d.querySelector('[role="form"]')).toBeNull()                                            // formularul închis: omul verifică, nu retrimite orb
    expect(st.rpc).toHaveLength(1)                                                                   // nicio retrimitere automată
    // 5xx = tot necunoscut
    await u.apasa(u.buton('Semnal 2'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'asteapta_informatii')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[1], '5xx')
    expect(u.d.body.textContent).toContain('Rezultat necunoscut')
    expect(u.d.body.textContent).toContain('status 504')
    expect(u.d.querySelector('[data-semnal="2"]').textContent).toContain('așteaptă informații')
  })

  it('confirmarea responsabilului propus de agent (același angajat) și „fără responsabil” pleacă la server și se arată ca decizii ale omului', async () => {
    const { client, st, server } = clientFals({ randuri: [SEM(1, { responsabil_employee_id: 10, responsabil_sursa: 'agent' })] })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('POPESCU ION (propus de agent)')
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    expect(u.camp('responsabil').value).toBe('10')                     // propunerea agentului, preselectată
    expect(u.d.body.textContent).toContain('devine decizia ta')
    await u.apasa(u.buton('Salvează'))                                 // fără nicio altă schimbare: confirmarea E o schimbare
    expect(st.rpc[0].a).toMatchObject({ p_id: 1, p_versiune: 1, p_stare: null, p_responsabil: 10, p_schimba_responsabil: true })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(server.get(1).responsabil_sursa).toBe('om')
    expect(u.d.body.textContent).toContain('POPESCU ION (stabilit de om)')
    expect(u.d.body.textContent).not.toContain('(propus de agent)')
    // „fără responsabil”
    await u.apasa(u.buton('Schimbă starea'))
    await u.bifa(u.camp('schimbă responsabilul'))
    await u.scrie(u.camp('responsabil'), '')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a).toMatchObject({ p_versiune: 2, p_responsabil: null, p_schimba_responsabil: true })
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.d.body.textContent).toContain('fără responsabil (stabilit de om)')
  })

  it('rezolvarea cere dovada SAU acțiunea (oprit local, fără RPC); „negăsit” arată obligația care cere documentul', async () => {
    const { client, st } = clientFals({ randuri: [SEM(1, { stare: 'in_lucru', versiune: 2, stare_de: 'u1', stare_la: '2026-11-21T21:00:00+00:00' }),
      SEM(2, { titlu: 'Polița GBE negăsită', constatare: 'negasit_in_surse', surse_consultate: ['ERP: polițe', 'NAS: dosar'], dovada_sursa: 'document', dovada_data: '2026-09-18',
        dovada_fragment: 'art. 8: GBE 10% în max. 15 zile', dovada_ref: 'NAS: contract.pdf', termen: null, termen_baza: null, termen_confirmat: null })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Polița GBE negăsită'))
    expect(u.d.body.textContent).toContain('Negăsit în sursele consultate: ERP: polițe, NAS: dosar · obligația: document · 18.09.2026 · art. 8: GBE 10% în max. 15 zile')
    expect(u.d.body.textContent).toContain('NAS: contract.pdf')
    await u.apasa(u.buton('Semnal 1'))
    await u.apasa(u.buton('Schimbă starea'))
    await u.scrie(u.camp('stare nouă'), 'rezolvat')
    expect(u.d.body.textContent).toContain('la rezolvare: dovada SAU acțiunea, obligatoriu')
    await u.scrie(u.camp('motiv'), 'gata')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(0)
    expect(u.d.body.textContent).toContain('dovada rezolvării')
    await u.scrie(u.camp('acțiune'), 'TKT-2026-0001')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].a).toMatchObject({ p_stare: 'rezolvat', p_motiv: 'gata', p_dovada: null, p_actiune_ref: 'TKT-2026-0001' })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('Salvat: rezolvat.')
  })

  it('schimbarea proiectului: răspunsul întârziat al proiectului vechi nu se aplică (L24)', async () => {
    const { client, st } = clientFals({ randuri: [SEM(1), SEM(2, { proiect_id: 2, proiect_cod: 'P2', titlu: 'Semnal P2' })] })
    st.poarta = amana()
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Se încarcă semnalele')
    const poartaVeche = st.poarta
    st.poarta = null
    await u.randeaza({ proiectId: 2 })
    expect(u.semnale()).toEqual([2])
    await u.elibereaza(poartaVeche, undefined)                      // răspunsul vechi (P1) sosește târziu
    expect(u.semnale()).toEqual([2])
    expect(u.d.body.textContent).not.toContain('Semnal 1')
  })

  it('panoul owner-ului: închis implicit (nicio cerere), la deschidere lista tuturor proiectelor cu codul proiectului, fără filtru pe proiect', async () => {
    const { client, st } = clientFals({ randuri: [SEM(1), SEM(2, { proiect_id: 2, proiect_cod: 'P2', titlu: 'Semnal P2', gravitate: 'critic' })] })
    const u = await monteaza(client, { owner: true })
    expect(st.cereri).toHaveLength(0)
    await u.apasa(u.buton('Semnale — toate proiectele'))
    expect(st.cereri.filter(c => c.tabel === 'v_executie_semnale')[0].eq.proiect_id).toBeUndefined()
    expect(u.semnale()).toEqual([2, 1])
    expect(u.d.body.textContent).toContain('P2')
    expect(u.d.body.textContent).toContain('P1')
  })
})
