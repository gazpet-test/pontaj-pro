// R3-7: componenta reală montată, fără cereri externe.
// În checkout-uri fără infrastructura DOM/Testing Library, suita se raportează SKIPPED;
// nu instalăm pachete și nu înlocuim montarea cu un test de text sursă.
import React from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const mock = vi.hoisted(() => ({ invoke:vi.fn(), rpc:vi.fn() }))
vi.mock('./lib/supabase.js', () => ({ supabase:{
  auth:{ getUser:async () => ({ data:{ user:{ id:'u' } } }) },
  functions:{ invoke:mock.invoke }, rpc:mock.rpc,
  from:table => {
    const date = {
      izo_documente_intrare:[], executie_proiecte:[{ id:7, nume:'Proiect test', site_id:9 }],
      logistica_depozite:[{ id:3, name:'Depozit test', site_id:9, activ:true }],
      profiles:{ id:'u', is_owner:true }, user_module_access:{ access_level:'admin' }, izo_atribuiri:[],
    }
    const q = { then:resolve => Promise.resolve({ data:date[table] ?? [], error:null }).then(resolve) }
    for (const op of ['select', 'eq', 'order', 'limit', 'gt', 'in', 'maybeSingle']) q[op] = () => q
    return q
  },
} }))
vi.mock('./CitesteOricePanel.jsx', () => ({ imageToPdf:vi.fn() }))
import IzoDocumenteIntrare from './IzoDocumenteIntrare.jsx'

let rtl, dom, motivLipsa
try {
  const require = createRequire(import.meta.url)
  require.resolve('jsdom'); require.resolve('@testing-library/react')
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e
  motivLipsa = e.message
}
if (!motivLipsa) {
  const jsdomNume = 'jsdom', rtlNume = '@testing-library/react'
  const { JSDOM } = await import(/* @vite-ignore */ jsdomNume)
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://localhost/' })
  for (const cheie of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) vi.stubGlobal(cheie, dom.window[cheie])
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  rtl = await import(/* @vite-ignore */ rtlNume)
}

const propunere = { success:true, tip:'aviz_e3', sablon:'aviz_teava', antet:{ nr_document:'AI-001' },
  randuri:[{ serie:'001', lungime_doc:12.5 }], totaluri_tiparite:{}, model:'ocr_local:lighton+mineru', cost_usd:0 }
const ok = data => ({ data, error:null })
const refuz = (status, eroare) => ({ data:null, error:{ context:{ status, json:async () => ({ success:false, eroare }) } } })
const flush = async () => { await rtl.act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
const avanseaza = async ms => { await rtl.act(async () => { await vi.advanceTimersByTimeAsync(ms) }); await flush() }
const ops = () => mock.invoke.mock.calls.map(([nume, { body }]) => nume === 'ocr-packing-list' ? nume : body.op)

// ArrayBuffer și FileReader deterministe; aici verificăm UI/lock, nu implementarea browserului.
async function monteaza() {
  rtl.render(<IzoDocumenteIntrare />)
  await flush()
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name:/\+.*Aviz țeavă/ }))
  await flush()
  const pdf = { type:'application/pdf', name:'aviz.pdf', size:100, slice:() => ({ arrayBuffer:async () => new TextEncoder().encode('%PDF-').buffer }) }
  rtl.fireEvent.change(document.querySelectorAll('input[type=file]')[1], { target:{ files:[pdf] } })
  await flush()
  return rtl.screen.getByRole('button', { name:'Citește cu AI' })
}

describe.skipIf(!rtl)(`E9 B4 — componentă montată${rtl ? '' : ` (infrastructură absentă: ${motivLipsa})`}`, () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T09:00:00Z'))
    mock.invoke.mockReset(); mock.rpc.mockReset()
    mock.rpc.mockResolvedValue({ data:[{ proiect_id:7 }], error:null })
    vi.stubGlobal('FileReader', class {
      readAsDataURL() { this.result = 'data:application/pdf;base64,JVBERi0='; this.onload() }
    })
    vi.stubGlobal('confirm', () => true)
    window.confirm = () => true
  })
  afterEach(() => { rtl.cleanup(); vi.clearAllTimers(); vi.useRealTimers() })

  it.each([409, 429])('cere %i → exact un Haiku direct sub același lock', async status => {
    mock.invoke.mockResolvedValueOnce(refuz(status, status === 409 ? 'local_indisponibil' : 'limita_orara')).mockResolvedValueOnce(ok(propunere))
    const buton = await monteaza()
    rtl.fireEvent.click(buton); await flush()
    expect(ops()).toEqual(['cere', 'ocr-packing-list'])
    expect(rtl.screen.getByText(/Haiku fallback/)).toBeTruthy()
    expect(rtl.screen.getByRole('button', { name:'Aplică în formular' })).toBeTruthy()
    expect(mock.rpc.mock.calls.every(([nume]) => nume === 'fn_izo_proiecte_protejate')).toBe(true)
    expect(document.querySelector('input[value="AI-001"]')).toBeNull()
  })

  it('expirata → exact un fallback local și zero pilot direct; sursă și cost vizibile', async () => {
    mock.invoke.mockResolvedValueOnce(ok({ success:true, cerere_id:'id', termen_local:new Date(Date.now() + 90000).toISOString() }))
      .mockResolvedValueOnce(ok({ success:true, stare:'expirata' }))
      .mockResolvedValueOnce(ok({ ...propunere, sursa:{ ramura:'haiku' }, cost_usd:0.0123 }))
    rtl.fireEvent.click(await monteaza()); await avanseaza(1500)
    expect(ops()).toEqual(['cere', 'stare', 'fallback'])
    expect(rtl.screen.getByText(/Haiku fallback/)).toBeTruthy()
    expect(rtl.screen.getByText(/0,0123 USD/)).toBeTruthy()
    expect(mock.rpc.mock.calls.every(([nume]) => nume === 'fn_izo_proiecte_protejate')).toBe(true)
  })

  it('schimbarea fișierului/editorului în polling → zero Haiku și zero propunere tardivă', async () => {
    let rezolva
    mock.invoke.mockResolvedValueOnce(ok({ success:true, cerere_id:'id' }))
      .mockImplementationOnce(() => new Promise(resolve => { rezolva = resolve }))
    rtl.fireEvent.click(await monteaza()); await avanseaza(1500)
    // Lista resetează fișierul și contextul; apoi se deschide un document cu alt fișier.
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name:'← Lista' })); await flush()
    await avanseaza(250)
    rezolva(ok({ success:true, stare:'expirata' })); await flush()
    expect(ops()).toEqual(['cere', 'stare'])
    expect(rtl.screen.queryByRole('button', { name:'Aplică în formular' })).toBeNull()
  })

  it('dublu-clic → o singură operație; Haiku rămâne sub lock până la răspuns', async () => {
    let rezolva
    mock.invoke.mockResolvedValueOnce(refuz(409, 'noapte')).mockImplementationOnce(() => new Promise(resolve => { rezolva = resolve }))
    const buton = await monteaza()
    rtl.act(() => { rtl.fireEvent.click(buton); rtl.fireEvent.click(buton) }); await flush()
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name:'Citește cu Haiku' })); await flush()
    expect(ops()).toEqual(['cere', 'ocr-packing-list'])
    rezolva(ok(propunere)); await flush()
    expect(rtl.screen.getByRole('button', { name:'Aplică în formular' })).toBeTruthy()
  })
})

afterAll(() => { dom?.window.close(); vi.unstubAllGlobals() })
