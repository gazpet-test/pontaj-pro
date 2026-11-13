// 20261220a r2 — ecranul 📱 SMS montat cu react-dom în jsdom, cu un client Supabase FALS (fără rețea, date fictive):
//   P1: migrarea neaplicată (RPC-urile noi lipsesc) = „Compune” și ⚙ Setări merg ca înainte, fără grup / secțiune și fără erori; sonda o dată;
//   P2: un număr bifat și dezactivat între timp iese din selecție la reîncărcare, cu anunț, iar previzualizarea următoare trece.
//   r3 (P2): pagina întreagă, navigare între taburi: o singură sondă pe pagină; după o listă primită, o funcție dispărută = eroare.
// jsdom nu e dependență a proiectului (ca la ContractProiectTab.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el,
// suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const srv = vi.hoisted(() => ({ raspunsuri: {}, apeluri: [] }))
vi.mock('../lib/supabase.js', () => ({
  supabase: {
    rpc: async (fn, args) => {
      srv.apeluri.push([fn, args])
      const r = srv.raspunsuri[fn]
      const v = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r
      return typeof v === 'function' ? v(args) : (v || { data: null, error: { code: 'TEST', message: 'raspuns nedefinit pentru ' + fn } })
    },
    from: t => { throw new Error('citire directă interzisă: ' + t) },
  },
}))
import SmsPagina, { Compune, NumereServiciu } from './SmsPagina.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[SmsNumereServiciuDom.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

const angajati = [
  { id: 1, nume: 'TEST UNU', departament: 'TESA', telefon_mascat: '07** *** 101', optout: false },
  { id: 2, nume: 'TEST DOI', departament: 'Executie', telefon_mascat: '07** *** 102', optout: false },
]
const panouUtil = { nivel: 'utilizator', kill_switch: false, ramas_zi: 150 }
const LIPSA = fn => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} without parameters in the schema cache`, details: null,
  hint: 'Perhaps you meant to call the function public.fn_sms_angajati_lista' } })
const lista = numere => ({ data: { total: numere.length, numere }, error: null })
const PREVIEW = { data: { lot_id: null, text_final: 'Test', lungime: 4, segmente: 1, nr_destinatari: 1, candidati: 1, excluse_optout: 0, excluse_fara_mobil: 0,
  excluse_duplicat: 0, cost_estimat_eur: 0.049, depaseste_plafon_zi: false, preview: true, nivel: 'utilizator', candidati_serviciu: 0, numere_serviciu: 0 }, error: null }
const DEZACTIVAT = { data: null, error: { code: '22023', message: 'sms: un numar de serviciu ales nu mai exista sau a fost dezactivat; reincarca lista' } }

const curata = []
afterEach(() => { while (curata.length) curata.pop()(); srv.apeluri.length = 0; srv.raspunsuri = {} })

async function monteaza(element) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const radacina = j.window.document.getElementById('r')
  const root = createRoot(radacina)
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  await act(async () => { root.render(element) }); await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  const buton = text => { const b = [...d.querySelectorAll('button')].find(x => x.textContent.includes(text)); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const bifaAngajat = nume => [...d.querySelectorAll('label')].find(l => l.textContent.includes(nume)).querySelector('input[type="checkbox"]')
  const bifaNumar = den => d.querySelector(`input[aria-label="Număr de serviciu: ${den}"]`)
  return { d, radacina, apasa, scrie, buton, bifaAngajat, bifaNumar }
}
const apeluriLa = fn => srv.apeluri.filter(a => a[0] === fn)

dom('r2 P1 — migrarea 20261220a neaplicată: ecranul merge ca înainte', () => {
  it('„Compune”: fără grupul numerelor, fără eroare, o singură sondă; lotul se previzualizează cu apelul vechi (4 argumente)', async () => {
    srv.raspunsuri = { fn_sms_numere_serviciu_lista: LIPSA('fn_sms_numere_serviciu_lista'), fn_sms_lot_intern_creeaza: [PREVIEW, DEZACTIVAT] }
    const mesaje = []
    const u = await monteaza(<Compune panou={panouUtil} setMesaj={m => mesaje.push(m)} angajatiInitiali={angajati} modInitial="selectie" />)
    expect(u.d.body.textContent).not.toContain('Numere de serviciu')
    expect(u.d.body.textContent).not.toContain('nu s-au putut citi')
    expect(u.d.querySelector('[role="alert"]')).toBeNull()
    expect(u.d.body.textContent).toContain('TEST UNU')
    await u.scrie(u.d.getElementById('sms-text'), 'Test')
    await u.apasa(u.bifaAngajat('TEST UNU'))
    await u.apasa(u.buton('Previzualizează'))
    expect(apeluriLa('fn_sms_lot_intern_creeaza').at(-1)[1]).toEqual({ p_text: 'Test', p_departamente: null, p_angajati: [1], p_doar_preview: true })
    expect(u.d.body.textContent).toContain('Previzualizare')
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(1)
    expect(mesaje.filter(m => m && m.tip === 'eroare')).toEqual([])
    // un refuz care ar cere reîncărcarea listei: după sonda „lipsă” nu se mai cere nimic funcțiilor noi (sonda o singură dată)
    await u.scrie(u.d.getElementById('sms-text'), 'Test 2')
    await u.apasa(u.buton('Previzualizează'))
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(1)
    expect(u.d.querySelector('[role="alert"]')).toBeNull()
  })
  it('⚙ Setări: secțiunea „Numere de serviciu” nu apare, fără eroare, o singură cerere', async () => {
    srv.raspunsuri = { fn_sms_numere_serviciu_admin: LIPSA('fn_sms_numere_serviciu_admin') }
    const mesaje = []
    const u = await monteaza(<NumereServiciu setMesaj={m => mesaje.push(m)} angajatiInitiali={angajati} />)
    expect(u.radacina.innerHTML).toBe('')
    expect(apeluriLa('fn_sms_numere_serviciu_admin')).toHaveLength(1)
    expect(mesaje).toEqual([])
  })
  it('migrarea aplicată: Setări arată secțiunea; o eroare de alt tip (drepturi) se vede, nu ascunde secțiunea (L18)', async () => {
    srv.raspunsuri = { fn_sms_numere_serviciu_admin: { data: [], error: null } }
    const a = await monteaza(<NumereServiciu setMesaj={() => {}} angajatiInitiali={angajati} />)
    expect(a.d.body.textContent).toContain('📞 Numere de serviciu')
    expect(a.d.body.textContent).toContain('Niciun număr de serviciu încă.')
    curata.pop()()
    srv.raspunsuri = { fn_sms_numere_serviciu_admin: { data: null, error: { code: '42501', message: 'sms: doar owner-ul' } } }
    const b = await monteaza(<NumereServiciu setMesaj={() => {}} angajatiInitiali={angajati} />)
    expect(b.d.querySelector('[role="alert"]').textContent).toContain('sms: doar owner-ul')
  })
})

dom('r2 P2 — selecția se reconciliază cu lista reîncărcată', () => {
  it('număr bifat, dezactivat între timp: refuzul BD → lista reîncărcată → scos din selecție + anunț; previzualizarea următoare trece', async () => {
    srv.raspunsuri = {
      fn_sms_numere_serviciu_lista: [lista([{ id: 7, denumire: 'Telefon Depozit', telefon_mascat: '07** *** 201', optout: false }]), lista([])],
      fn_sms_lot_intern_creeaza: [DEZACTIVAT, PREVIEW],
    }
    const mesaje = []
    const u = await monteaza(<Compune panou={panouUtil} setMesaj={m => mesaje.push(m)} angajatiInitiali={angajati} modInitial="selectie" />)
    await u.scrie(u.d.getElementById('sms-text'), 'Test')
    await u.apasa(u.bifaNumar('Telefon Depozit'))
    await u.apasa(u.bifaAngajat('TEST UNU'))
    expect(u.d.body.textContent).toContain('2 selectați (1 angajați + 1 numere de serviciu)')
    await u.apasa(u.buton('Previzualizează'))
    expect(apeluriLa('fn_sms_lot_intern_creeaza')[0][1]).toMatchObject({ p_angajati: [1], p_numere_serviciu: [7] })
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(2)
    expect(mesaje.at(-1)).toEqual({ tip: 'eroare', text: 'Numărul de serviciu „Telefon Depozit” nu mai e activ și a fost scos din selecție. Verifică destinatarii și previzualizează din nou.' })
    expect(u.bifaNumar('Telefon Depozit')).toBeNull()
    expect(u.d.body.textContent).toContain('1 selectați')
    expect(u.d.body.textContent).not.toContain('numere de serviciu)')
    await u.apasa(u.buton('Previzualizează'))
    expect(apeluriLa('fn_sms_lot_intern_creeaza')[1][1]).toEqual({ p_text: 'Test', p_departamente: null, p_angajati: [1], p_doar_preview: true })
    expect(u.d.body.textContent).toContain('Previzualizare')
  })
  it('după o listă primită, funcția care dispare = eroare vizibilă (nu „lipsă” tăcută); bifa rămâne vizibilă', async () => {
    srv.raspunsuri = {
      fn_sms_numere_serviciu_lista: [lista([{ id: 7, denumire: 'Telefon Depozit', telefon_mascat: '07** *** 201', optout: false }]), LIPSA('fn_sms_numere_serviciu_lista')],
      fn_sms_lot_intern_creeaza: DEZACTIVAT,
    }
    const u = await monteaza(<Compune panou={panouUtil} setMesaj={() => {}} angajatiInitiali={angajati} modInitial="selectie" />)
    await u.scrie(u.d.getElementById('sms-text'), 'Test')
    await u.apasa(u.bifaNumar('Telefon Depozit'))
    await u.apasa(u.buton('Previzualizează'))
    expect(u.d.querySelector('[role="alert"]').textContent).toContain('Numerele de serviciu nu s-au putut citi')
    expect(u.bifaNumar('Telefon Depozit').checked).toBe(true)
  })
})

// r3 (P2): capabilitatea se ține la nivelul PAGINII — taburile își demontează componentele, sonda nu se reia la fiecare revenire
dom('r3 P2 — pagina întreagă, navigare între taburi (ambele sensuri)', () => {
  const panouOwner = { nivel: 'owner', kill_switch: true, plafon_zi: 200, plafon_luna: 1500, consum_zi: 0, consum_luna: 0, versiune: 1, ramas_zi: 200 }
  const COMUNE = { fn_sms_angajati_lista: { data: angajati, error: null }, fn_sms_loturi_lista: { data: [], error: null }, fn_sold_sms_citeste: { data: null, error: null } }
  const TELEFON = { id: 7, denumire: 'Telefon Depozit', telefon_mascat: '07** *** 201', optout: false }
  const pagina = () => monteaza(<SmsPagina profile={{ id: 'o', is_owner: true }} panouInitial={panouOwner} soldInitial={{ sold: 1 }} />)
  const alerta = u => [...u.d.querySelectorAll('[role="alert"]')].map(a => a.textContent).join(' | ')
  it('scenariul review-ului: lista a mers → Istoric → RPC-ul dispare → înapoi în Compune = EROARE vizibilă (nu „lipsă” tăcută)', async () => {
    srv.raspunsuri = { ...COMUNE, fn_sms_numere_serviciu_lista: [lista([TELEFON]), LIPSA('fn_sms_numere_serviciu_lista')] }
    const u = await pagina()
    expect(u.d.body.textContent).toContain('Numerele de serviciu (1)')
    await u.apasa(u.buton('📋 Istoric'))
    await u.apasa(u.buton('✍ Compune'))
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(2)
    expect(alerta(u)).toContain('Numerele de serviciu nu s-au putut citi')
  })
  it('Compune → Setări: lista a mers în Compune, administrarea lipsă în Setări = EROARE vizibilă, secțiunea rămâne', async () => {
    srv.raspunsuri = { ...COMUNE, fn_sms_numere_serviciu_lista: lista([TELEFON]), fn_sms_numere_serviciu_admin: LIPSA('fn_sms_numere_serviciu_admin') }
    const u = await pagina()
    await u.apasa(u.buton('⚙ Setări'))
    expect(u.d.body.textContent).toContain('📞 Numere de serviciu')
    expect(alerta(u)).toContain('Lista numerelor de serviciu nu s-a putut citi')
  })
  it('migrarea absentă: O SINGURĂ sondă pe pagină — Compune ↔ Istoric ↔ Setări, fără nicio altă cerere către funcțiile noi, fără erori', async () => {
    srv.raspunsuri = { ...COMUNE, fn_sms_numere_serviciu_lista: LIPSA('fn_sms_numere_serviciu_lista'), fn_sms_numere_serviciu_admin: LIPSA('fn_sms_numere_serviciu_admin') }
    const u = await pagina()
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(1)
    for (const t of ['📋 Istoric', '✍ Compune', '⚙ Setări', '✍ Compune', '⚙ Setări']) await u.apasa(u.buton(t))
    expect(u.d.body.textContent).not.toContain('📞 Numere de serviciu')
    await u.apasa(u.buton('✍ Compune'))
    expect(u.d.body.textContent).not.toContain('Numerele de serviciu (')
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(1)
    expect(apeluriLa('fn_sms_numere_serviciu_admin')).toHaveLength(0)
    expect(alerta(u)).toBe('')
  })
  it('Setări → Compune: sonda făcută de Setări (administrarea a mers) face ca o lipsă în Compune să fie EROARE', async () => {
    // tabul implicit e Compune: prima lui cerere pică din alt motiv (rețea → starea rămâne „necunoscut”, eroare vizibilă), apoi Setări
    // face sonda cu succes, iar la revenirea în Compune lista lipsă nu mai poate fi „lipsă” tăcută
    srv.raspunsuri = { ...COMUNE, fn_sms_numere_serviciu_admin: { data: [], error: null },
      fn_sms_numere_serviciu_lista: [{ data: null, error: { code: '', message: 'Failed to fetch' } }, LIPSA('fn_sms_numere_serviciu_lista')] }
    const u = await pagina()
    expect(alerta(u)).toContain('Failed to fetch')
    await u.apasa(u.buton('⚙ Setări'))
    expect(u.d.body.textContent).toContain('Niciun număr de serviciu încă.')
    expect(apeluriLa('fn_sms_numere_serviciu_admin')).toHaveLength(1)
    await u.apasa(u.buton('✍ Compune'))
    expect(apeluriLa('fn_sms_numere_serviciu_lista')).toHaveLength(2)
    expect(alerta(u)).toContain('Numerele de serviciu nu s-au putut citi')
  })
})
