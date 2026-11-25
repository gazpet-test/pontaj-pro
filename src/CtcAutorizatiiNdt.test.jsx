// Teste de componentă (TKT-2026-0389, 20270111a): secțiunea „Firme de control nedistructiv” din CTC și formularul de document din Ofertare →
// Parteneri, montate cu react-dom în jsdom, cu un client Supabase FALS. Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import { SectiuneNdt } from './ctc/CtcAutorizatii.jsx'
import { FormDocument, CATEGORII_DOC } from './OfertareParteneri.jsx'
import { MESAJ_CATEGORIE_NOUA } from './ofertareParteneriCale.js'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[CtcAutorizatiiNdt.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = [] })

async function monteaza(element) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document, File: globalThis.File }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  await act(async () => { root.render(element) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const butoane = text => [...d.querySelectorAll('button')].filter(x => x.textContent.includes(text))
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const alege = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  const fisier = async (el, nume) => {
    const f = new j.window.File(['%PDF-1.4'], nume, { type: 'application/pdf' })
    Object.defineProperty(el, 'files', { value: [f], configurable: true })
    await act(async () => { el.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  return { j, d, butoane, apasa, alege, scrie, fisier, asteapta }
}

// clientul fals al CTC: lista NDT (RPC cu keyset) + funcția edge
function clientCtc({ rows = [], eroare = null, scan = { data: { url: 'https://semnat/x' }, error: null } } = {}) {
  const st = { invoke: [], rpc: [] }
  const client = {
    rpc(nume) {
      const q = { gt: null }
      const b = { order() { return b }, limit() { return b }, gt(_c, v) { q.gt = v; return b },
        then(res, rej) { st.rpc.push(nume); const r = eroare ? { data: null, error: eroare } : { data: rows.filter(x => q.gt == null || x.id > q.gt), error: null }; return Promise.resolve(r).then(res, rej) } }
      return b
    },
    functions: { invoke: async (n, o) => { st.invoke.push([n, o]); return scan } },
  }
  return { client, st }
}

dom(numeDom('SectiuneNdt (CTC, jsdom + react-dom)'), () => {
  const ROWS = [
    { id: 1, firma: 'NDT CONTROL SRL', cui: 'RO111', numar_document: 'RT-1', emitent: 'ISCIR', metoda: 'RT', data_emitere: '2025-01-10', data_valabilitate: '2027-01-01', fara_expirare: false, stare: 'valabil', are_fisier: true },
    { id: 2, firma: 'NDT CONTROL SRL', cui: 'RO111', numar_document: 'PT-3', emitent: 'ISCIR', metoda: 'PT', data_emitere: null, data_valabilitate: null, fara_expirare: true, stare: 'valabil', are_fisier: false },
    { id: 3, firma: 'LABORATOR UT SRL', cui: 'RO222', numar_document: 'UT-2', emitent: 'ASRO', metoda: 'UT', data_emitere: null, data_valabilitate: '2026-01-01', fara_expirare: false, stare: 'expirat', are_fisier: true },
  ]
  it('lista: rândurile, starea, butonul DOAR la are_fisier; scanul prin edge cu ndt_document_id', async () => {
    const { client, st } = clientCtc({ rows: ROWS })
    const u = await monteaza(<SectiuneNdt client={client} />)
    const text = u.d.body.textContent
    expect(st.rpc[0]).toBe('fn_ctc_autorizatii_ndt')
    for (const s of ['🔬 Firme de control nedistructiv', 'NDT CONTROL SRL', 'RO111', 'RT-1', 'PT-3', 'UT-2', 'Expirată', 'fără expirare', '01.01.2027', 'fără scan']) expect(text).toContain(s)
    const deschide = u.butoane('Deschide scanul')
    expect(deschide).toHaveLength(2)
    const f = { closed: false, opener: 'x', location: { replace: vi.fn() }, close: vi.fn() }
    u.j.window.open = vi.fn(() => f)
    const rand = [...u.d.querySelectorAll('tr')].find(tr => tr.textContent.includes('RT-1'))
    await u.apasa(rand.querySelector('button'))
    expect(st.invoke).toEqual([['ctc-autorizatie-fisier', { body: { ndt_document_id: 1 } }]])
    expect(f.location.replace).toHaveBeenCalledWith('https://semnat/x')
    expect(f.opener).toBe(null)
  })
  it('filtrul de stare și textul', async () => {
    const { client } = clientCtc({ rows: ROWS })
    const u = await monteaza(<SectiuneNdt client={client} />)
    await u.alege(u.d.querySelector('select'), 'expirat')
    expect(u.d.querySelectorAll('tbody tr')).toHaveLength(1)
    await u.alege(u.d.querySelector('select'), 'toate')
    await u.scrie(u.d.querySelector('input'), 'laborator')
    expect([...u.d.querySelectorAll('tbody tr')].map(t => t.textContent.includes('UT-2'))).toEqual([true])
  })
  it('erorile se deosebesc (L18): fără drept / neactivat / eroare cu reîncercare; lista goală = mesaj propriu', async () => {
    for (const [eroare, astept] of [[{ code: '42501' }, 'Contul nu are acces la modulul CTC.'], [{ code: 'PGRST202' }, 'Secțiunea nu e încă activă'],
      [{ code: '57014', message: 'timeout' }, 'Autorizațiile nu au putut fi încărcate: timeout']]) {
      const { client } = clientCtc({ eroare })
      const u = await monteaza(<SectiuneNdt client={client} />)
      expect(u.d.body.textContent).toContain(astept)
      expect(u.d.querySelectorAll('table')).toHaveLength(0)
    }
    const { client } = clientCtc({ rows: [] })
    const u = await monteaza(<SectiuneNdt client={client} />)
    expect(u.d.body.textContent).toContain('Nicio autorizație de firmă NDT în evidență')
  })
  it('scanul refuzat: fila se închide, mesajul serverului se vede', async () => {
    const { client } = clientCtc({ rows: ROWS, scan: { data: null, error: { message: 'x', context: { status: 404, json: async () => ({ error: 'Autorizație NDT inexistentă sau fără scan' }) } } } })
    const u = await monteaza(<SectiuneNdt client={client} />)
    const f = { closed: false, location: { replace: vi.fn() }, close: vi.fn() }
    u.j.window.open = vi.fn(() => f)
    await u.apasa(u.butoane('Deschide scanul')[0])
    expect(f.close).toHaveBeenCalled()
    expect(f.location.replace).not.toHaveBeenCalled()
    expect(u.d.body.textContent).toContain('Autorizație NDT inexistentă sau fără scan')
  })
})

// clientul fals al Parteneri: storage (upload / remove) + update / insert pe documente, în ordinea apelurilor
function clientOf({ scriere = { data: [{ id: 7 }], error: null, status: 200 } } = {}) {
  const st = { pasi: [] }
  const client = {
    storage: { from: b => ({
      upload: async (cale) => { st.pasi.push(['upload', b, cale]); return { error: null } },
      remove: async (cai) => { st.pasi.push(['remove', b, cai]); return { error: null } },
    }) },
    from: t => {
      const op = { t }
      const q = {
        update: r => { op.fel = 'update'; op.rand = r; return q }, insert: r => { op.fel = 'insert'; op.rand = r; return q },
        eq: (c, v) => { op.eq = [c, v]; return q },
        select: () => { st.pasi.push([op.fel, op.t, op.rand.fisier_path, op.rand.categorie]); return Promise.resolve(scriere) },
      }
      return q
    },
  }
  return { client, st }
}

dom(numeDom('FormDocument (Ofertare → Parteneri, jsdom + react-dom)'), () => {
  const DOC = { id: 7, categorie: 'alta', denumire: 'Autorizatie RT', fisier_path: 'parteneri/3/1700000000000_x.pdf' }
  const selectCategorie = d => [...d.querySelectorAll('select')][0]
  const inputFisier = d => d.querySelector('input[type="file"]')
  it('selectorul oferă categoria NDT; câmpul domeniu devine „Metoda (RT/UT/PT/MT/VT)”', async () => {
    const { client } = clientOf()
    const u = await monteaza(<FormDocument pid={3} d={{}} client={client} showToast={() => {}} onClose={() => {}} onSaved={() => {}} />)
    const opt = [...selectCategorie(u.d).options].map(o => [o.value, o.textContent])
    expect(opt).toContainEqual(['autorizatie_ndt', CATEGORII_DOC.autorizatie_ndt])
    expect(CATEGORII_DOC.autorizatie_ndt).toContain('Autorizație control nedistructiv (NDT)')
    expect(u.d.body.textContent).not.toContain('Metoda (RT/UT/PT/MT/VT)')
    await u.alege(selectCategorie(u.d), 'autorizatie_ndt')
    expect(u.d.body.textContent).toContain('Metoda (RT/UT/PT/MT/VT)')
  })
  it('alta → NDT fără fișier nou: mesajul, salvarea blocată, nimic trimis; cu fișier nou: upload în ndt/, apoi update, apoi ștergerea celui vechi', async () => {
    const { client, st } = clientOf()
    const toast = [], salvat = []
    const u = await monteaza(<FormDocument pid={3} d={DOC} client={client} showToast={(m, t) => toast.push([m, t])} onClose={() => {}} onSaved={() => salvat.push(1)} />)
    await u.alege(selectCategorie(u.d), 'autorizatie_ndt')
    expect(u.d.body.textContent).toContain(MESAJ_CATEGORIE_NOUA)
    const salveaza = u.butoane('Salvează')[0]
    expect(salveaza.disabled).toBe(true)
    await u.apasa(salveaza)
    expect(st.pasi).toEqual([])
    await u.fisier(inputFisier(u.d), 'Raport RT ș.pdf')
    expect(u.d.body.textContent).not.toContain(MESAJ_CATEGORIE_NOUA)
    expect(u.butoane('Salvează')[0].disabled).toBe(false)
    await u.apasa(u.butoane('Salvează')[0])
    expect(st.pasi.map(p => p[0])).toEqual(['upload', 'update', 'remove'])
    expect(st.pasi[0][1]).toBe('ofertare')
    expect(st.pasi[0][2]).toMatch(/^parteneri\/3\/ndt\/\d+_Raport_RT_s\.pdf$/)
    expect(st.pasi[1]).toEqual(['update', 'ofertare_parteneri_documente', st.pasi[0][2], 'autorizatie_ndt'])
    expect(st.pasi[2]).toEqual(['remove', 'ofertare', ['parteneri/3/1700000000000_x.pdf']])
    expect(salvat).toEqual([1])
  })
  it('refuzul cert al serverului (4xx): fișierul nou se șterge; rezultatul necunoscut (rețea): fișierul nou RĂMÂNE (L05), cel vechi neatins', async () => {
    for (const [scriere, sterge] of [[{ data: null, error: { code: '23514', message: 'cale' }, status: 400 }, true],
      [{ data: null, error: { message: 'Failed to fetch' }, status: 0 }, false]]) {
      const { client, st } = clientOf({ scriere })
      const toast = []
      const u = await monteaza(<FormDocument pid={3} d={DOC} client={client} showToast={(m, t) => toast.push([m, t])} onClose={() => {}} onSaved={() => {}} />)
      await u.alege(selectCategorie(u.d), 'autorizatie_ndt')
      await u.fisier(inputFisier(u.d), 'rt.pdf')
      await u.apasa(u.butoane('Salvează')[0])
      const nou = st.pasi[0][2]
      expect(st.pasi.map(p => p[0])).toEqual(sterge ? ['upload', 'update', 'remove'] : ['upload', 'update'])
      if (sterge) expect(st.pasi[2]).toEqual(['remove', 'ofertare', [nou]])
      expect(toast.at(-1)[1]).toBe('error')
      if (!sterge) expect(toast.at(-1)[0]).toContain('Rezultat necunoscut')
    }
  })
  it('un document fără fișier își schimbă liber categoria; un document nou NDT cu certificat..pdf ajunge în ndt/', async () => {
    const { client, st } = clientOf()
    const u = await monteaza(<FormDocument pid={3} d={{ ...DOC, fisier_path: null }} client={client} showToast={() => {}} onClose={() => {}} onSaved={() => {}} />)
    await u.alege(selectCategorie(u.d), 'autorizatie_ndt')
    expect(u.d.body.textContent).not.toContain(MESAJ_CATEGORIE_NOUA)
    await u.apasa(u.butoane('Salvează')[0])
    expect(st.pasi).toEqual([['update', 'ofertare_parteneri_documente', null, 'autorizatie_ndt']])
    const b = clientOf()
    const v = await monteaza(<FormDocument pid={4} d={{}} client={b.client} showToast={() => {}} onClose={() => {}} onSaved={() => {}} />)
    await v.alege(selectCategorie(v.d), 'autorizatie_ndt')
    await v.scrie([...v.d.querySelectorAll('input')].find(i => i.parentElement.textContent.startsWith('Denumire')), 'Autorizatie UT')
    await v.fisier(inputFisier(v.d), 'certificat..pdf')
    await v.apasa(v.butoane('Salvează')[0])
    expect(b.st.pasi.map(p => p[0])).toEqual(['upload', 'insert'])
    expect(b.st.pasi[0][2]).toMatch(/^parteneri\/4\/ndt\/\d+_certificat\.\.pdf$/)
  })
})
