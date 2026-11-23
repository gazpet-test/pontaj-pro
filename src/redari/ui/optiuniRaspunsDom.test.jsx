// Opțiunea „Nu particip — am obiecții” retrasă (decizia Răzvan 17.11.2026, juridic#046): componentele REALE montate cu react-dom în
// jsdom, cu clic / tastare, și ce ajunge efectiv la server — rpc('fn_red_raspuns_public') din formularul public și insert() în
// red_raspunsuri din ecranul operatorului. Clientul Supabase e fals (fără rețea), date fictive.
// jsdom nu e dependență a proiectului (ca la src/OfertareRadar.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el,
// suita e SĂRITĂ VIZIBIL. Fereastra jsdom se instalează ÎNAINTEA importurilor (vi.hoisted): react-dom decide la încărcare dacă are DOM
// (fără asta, evenimentele `input` din textarea nu ajung la React).
import React from 'react'
import { afterAll, afterEach, describe, it, expect, vi } from 'vitest'

const h = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module')
  const path = await import('node:path')
  let JSDOM = null
  const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
  for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
  const st = { client: null, JSDOM, j: null, vechi: { window: globalThis.window, document: globalThis.document } }
  if (JSDOM) {
    st.j = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' })
    st.j.window.scrollTo = () => {}
    Object.assign(globalThis, { window: st.j.window, document: st.j.window.document })
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  }
  return st
})
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: (...a) => { if (!h.client) throw new Error('fără BD în test'); return h.client.from(...a) },
    rpc: (...a) => { if (!h.client) throw new Error('fără BD în test'); return h.client.rpc(...a) },
  },
}))

import { createRoot } from 'react-dom/client'
import * as testUtils from 'react-dom/test-utils'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RedariRaspunsPublic from '../../RedariRaspunsPublic.jsx'
import { ModalRaspunsTelefon } from '../../Redari.jsx'

const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!h.JSDOM) console.warn(`[optiuniRaspunsDom.test] ${MOTIV_SARIT}`)
const dom = h.JSDOM ? describe : describe.skip
const numeDom = t => (h.JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const act = React.act || testUtils.act
const RETRASA = 'nu_particip_cu_obiectii'
const TREI = ['particip', 'nu_particip_fara_obiectii', 'constatare_teren']

// Client fals: rpc(nume, args) și from(t).insert(v) → .select().single() / await; jurnalul cererilor în st
function clientFals() {
  const st = { rpc: [], insert: [] }
  const client = {
    rpc: async (nume, args) => {
      st.rpc.push({ nume, args })
      if (nume === 'fn_red_formular_public') return { data: { ok: true, id_parcela: 'TEST-1', uat_nume: 'UAT Test', sesiune: [{ zi: '2026-12-10', program: '09:00 – 16:00' }], deja_raspuns: false, text_declaratie: 'Declarație fictivă.' }, error: null }
      if (nume === 'fn_red_raspuns_public') return { data: { ok: true }, error: null }
      return { data: null, error: { message: 'rpc necunoscut' } }
    },
    from: tabel => ({
      insert: v => {
        st.insert.push({ tabel, v })
        return { select: () => ({ single: async () => ({ data: { id: 'r-fictiv' }, error: null }) }), then: (ok, ko) => Promise.resolve({ error: null }).then(ok, ko) }
      },
    }),
  }
  return { client, st }
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; h.client = null })
afterAll(() => { if (h.j) { Object.assign(globalThis, h.vechi); h.j.window.close() } })

async function monteaza(element, client) {
  h.client = client
  const w = h.j.window, d = w.document
  const cutie = d.createElement('div'); d.body.appendChild(cutie)
  const root = createRoot(cutie)
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(element) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); cutie.remove() })
  const apasa = async el => { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const buton = text => { const b = [...cutie.querySelectorAll('button')].find(x => x.textContent.includes(text)); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  // valoare într-un câmp controlat de React: setter-ul nativ + evenimentul pe care îl ascultă React
  const scrie = async (el, valoare) => {
    const proto = el.tagName === 'SELECT' ? w.HTMLSelectElement : el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement : w.HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, valoare)
    await act(async () => { el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }); await asteapta()
  }
  return { cutie, apasa, buton, scrie, q: s => cutie.querySelector(s), text: () => cutie.textContent }
}

dom(numeDom('formularul public montat (jsdom): ce pleacă efectiv la fn_red_raspuns_public'), () => {
  const pagina = () => (
    <MemoryRouter initialEntries={['/redari/raspuns/tok-fictiv']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/redari/raspuns/:token" element={<RedariRaspunsPublic />} /></Routes>
    </MemoryRouter>
  )
  const trimise = st => st.rpc.filter(c => c.nume === 'fn_red_raspuns_public')

  it('pe ecran sunt trei variante; trimiterea fără alegere nu pleacă', async () => {
    const { client, st } = clientFals()
    const u = await monteaza(pagina(), client)
    expect([...u.cutie.querySelectorAll('[data-optiune]')].map(b => b.getAttribute('data-optiune'))).toEqual(TREI)
    expect(u.text()).not.toContain('Nu particip — am obiecții')
    await u.apasa(u.buton('Trimite răspunsul'))
    expect(u.text()).toContain('Alegeți una din cele trei variante.')
    expect(trimise(st)).toEqual([])
  })
  it('„nu particip, fără obiecții” cu declarația bifată: cererea are exact codul ales, iar rezumatul îl arată', async () => {
    const { client, st } = clientFals()
    const u = await monteaza(pagina(), client)
    await u.apasa(u.q('[data-optiune="nu_particip_fara_obiectii"]'))
    await u.apasa(u.q('input[type="checkbox"]'))
    await u.apasa(u.buton('Trimite răspunsul'))
    expect(trimise(st)).toHaveLength(1)
    expect(trimise(st)[0].args).toMatchObject({ p_token: 'tok-fictiv', p_optiune: 'nu_particip_fara_obiectii', p_zi: null, p_obiectii: null, p_declaratie_confirmata: true })
    expect(u.text()).toContain('Răspunsul a fost înregistrat')
    expect(u.text()).toContain('Nu particip — nu am obiecții')
  })
  it('„constatare pe teren”: obiecțiile tastate pleacă, codul e cel ales', async () => {
    const { client, st } = clientFals()
    const u = await monteaza(pagina(), client)
    await u.apasa(u.q('[data-optiune="constatare_teren"]'))
    await u.scrie(u.q('textarea'), 'Gard rupt (text fictiv)')
    await u.apasa(u.buton('Trimite răspunsul'))
    expect(trimise(st).map(c => c.args.p_optiune)).toEqual(['constatare_teren'])
    expect(trimise(st)[0].args.p_obiectii).toBe('Gard rupt (text fictiv)')
  })
})

dom(numeDom('ecranul operatorului montat (jsdom): ce ajunge efectiv la INSERT'), () => {
  const rand = { detinator_id: 'd1', uat_id: 'u1', nume: 'FICTIV UNU', uat3: 'TST' }
  const uats = [{ id: 'u1', nume: 'UAT Test', sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00' }]
  const modal = (show, onGata) => <ModalRaspunsTelefon rand={rand} profile={{ id: 'u-fictiv', name: 'Operator fictiv' }} uats={uats} proiect={{}} show={show} onClose={() => {}} onGata={onGata} />
  const selectOptiune = u => [...u.cutie.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'constatare_teren'))

  it('opțiunea retrasă ajunsă în stare (opțiune adăugată în DOM, ca o stare veche): eroare, nimic trimis la server', async () => {
    const { client, st } = clientFals()
    const show = vi.fn(), onGata = vi.fn()
    const u = await monteaza(modal(show, onGata), client)
    const sel = selectOptiune(u)
    expect([...sel.options].map(o => o.value)).toEqual(TREI)
    // stare veche: React primește prin onChange codul retras (lista din ecran nu îl mai are)
    const opt = h.j.window.document.createElement('option'); opt.value = RETRASA; opt.textContent = 'vechi'; sel.appendChild(opt)
    await u.scrie(sel, RETRASA)
    await u.scrie(u.q('textarea'), 'Gard nerefăcut (text fictiv)')
    expect(u.q('textarea').value).toBe('Gard nerefăcut (text fictiv)')   // starea a ajuns în componentă (altfel testul n-ar proba garda)
    await u.apasa(u.buton('Salvează'))
    expect(show).toHaveBeenCalledWith('Opțiunea aleasă nu se mai înregistrează la un răspuns nou: alege una din listă.', 'error')
    expect(st.insert).toEqual([])
    expect(onGata).not.toHaveBeenCalled()
  })
  it('„constatare pe teren” aleasă din listă: INSERT-ul are codul ales și obiecțiile, apoi nota', async () => {
    const { client, st } = clientFals()
    const show = vi.fn(), onGata = vi.fn()
    const u = await monteaza(modal(show, onGata), client)
    await u.scrie(selectOptiune(u), 'constatare_teren')
    await u.scrie(u.q('textarea'), 'Gard rupt (text fictiv)')
    await u.apasa(u.buton('Salvează'))
    expect(st.insert.map(i => i.tabel)).toEqual(['red_raspunsuri', 'red_raspunsuri_meta'])
    expect(st.insert[0].v).toEqual({ detinator_id: 'd1', canal: 'telefon', optiune: 'constatare_teren', zi_sesiune_aleasa: null, obiectii_text: 'Gard rupt (text fictiv)', declaratie_confirmata: null, created_by: 'u-fictiv' })
    expect(show).toHaveBeenCalledWith('Răspunsul a fost înregistrat.', 'success')
    expect(onGata).toHaveBeenCalledTimes(1)
  })
})
