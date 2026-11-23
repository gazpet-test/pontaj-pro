// Regresii cu parserul REAL (fără mock pe devizParser) pentru CatalogDevizPanel — review #1165 r1 P1: acceptarea semnului în parseDeviz
// trebuie să fie DOAR sub opțiunea explicită a lui parseDevizModificare, iar cele două importuri din catalog (oferta, actul adițional)
// să se comporte EXACT ca pe main pe un .docx cu o linie negativă: linia negativă e sărită, totalurile neschimbate.
// Așteptările sunt scrise de mână după regula veche a parserului (regexul fără „-”), nu citite din cod (L25). Componenta reală montată cu
// react-dom în jsdom, client Supabase FALS (înregistrează cererile), .docx real construit în memorie (JSZip). jsdom nu e dependență a
// proiectului (ca la src/CatalogDevizPanel.test.jsx): fără el suita e SĂRITĂ VIZIBIL. Date SINTETICE, fără rețea.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import JSZip from 'jszip'

const st = vi.hoisted(() => ({ cereri: [] }))
vi.mock('./lib/supabase.js', () => ({
  supabase: {
    from: tabel => {
      const q = { tabel, op: 'select', filtre: [], rows: null }
      q.select = () => { q.op = 'select'; return q }
      q.delete = () => { q.op = 'delete'; return q }
      q.insert = rows => { q.op = 'insert'; q.rows = rows; return q }
      q.eq = (c, v) => { q.filtre.push([c, v]); return q }
      q.gt = () => q
      q.order = () => q
      q.limit = () => q
      q.then = (res, rej) => {
        st.cereri.push({ op: q.op, filtre: q.filtre, rows: q.rows })
        return Promise.resolve(q.op === 'select' ? { data: [], error: null } : { error: null }).then(res, rej)
      }
      return q
    },
  },
}))
import CatalogDevizPanel from './CatalogDevizPanel.jsx'

// devizul AA mixt din reproducerea review-ului: +10 / +100 și −5 / −50 (stilul F3: paragrafe)
const AA_MIXT = [
  'Obiectul: 01 1 TRONSON A', 'Deviz oferta 0101 CONDUCTA',
  '001 TSA01A1 MC 10.000', 'SAPATURA MANUALA', 'Total= 100.00',
  '002 TSD01B1 MC -5.000', 'UMPLUTURA COMPACTATA', 'Total= -50.00',
]
async function docxBuf(paragrafe) {
  const zip = new JSZip()
  const body = paragrafe.map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[CatalogDevizPanelParserReal.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.cereri = []; vi.restoreAllMocks() })

async function monteaza({ confirma = () => true, prompt = () => '2' } = {}) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  const confirmari = []
  j.window.confirm = m => { confirmari.push(m); return confirma(m) }
  j.window.prompt = prompt
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  // parserul real deschide zip-ul și citește XML-ul: așteptăm până la toast (succes sau eroare), nu un număr fix de microtask-uri
  const asteapta = async (toast) => { for (let k = 0; k < 200 && !(toast && toast.mock.calls.length); k++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
  const toast = vi.fn()
  await act(async () => { root.render(<CatalogDevizPanel proiectId={7} showToast={toast} />) })
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  // alegerea fișierului în input-ul de tip file al unui buton (0 = „Deviz inițial”, 1 = „Act adițional”); fișierul = .docx REAL,
  // cu interfața pe care o folosește parserul (name + arrayBuffer(), ca un File din browser)
  const importa = async (i, buf) => {
    const input = d.querySelectorAll('input[type="file"]')[i]
    Object.defineProperty(input, 'files', { value: [{ name: 'AA2.docx', arrayBuffer: async () => buf }], configurable: true })
    await act(async () => { input.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta(toast)
  }
  return { d, toast, importa, confirmari }
}
const ops = () => st.cereri.map(c => c.op)

dom(numeDom('CatalogDevizPanel cu parserul REAL: .docx cu o linie negativă se importă ca pe main (review #1165 r1 P1)'), () => {
  it('(a) importul OFERTEI: linia negativă e sărită → 1 articol, 100 lei în confirmare, un singur rând inserat (+10 / +100)', async () => {
    const buf = await docxBuf(AA_MIXT)
    const { toast, importa, confirmari } = await monteaza()
    await importa(0, buf)
    expect(confirmari).toEqual(['1 articole (100 lei).\n\nÎnlocuiesc CONTRACTUL INIȚIAL? (actele adiționale rămân)'])
    expect(ops()).toEqual(['select', 'delete', 'insert', 'select'])
    const ins = st.cereri[2]
    expect(ins.rows).toHaveLength(1)
    expect(ins.rows[0]).toMatchObject({ proiect_id: 7, sursa: 'contract_initial', act_nr: null, obiect_cod: '01', deviz_cod: '0101', nr: '001', cod: 'TSA01A1', um: 'mc', cantitate: 10, valoare: 100 })
    expect(toast).toHaveBeenCalledWith('✓ 1 articole — contract inițial', 'success')
  })
  it('(b) importul ACTULUI ADIȚIONAL mixt (+100 / −50), SUPLIMENTARE: ca pe main, doar +10 / +100 (nu +150: diminuarea nu devine suplimentare)', async () => {
    const buf = await docxBuf(AA_MIXT)
    const { toast, importa } = await monteaza({ confirma: () => true })
    await importa(1, buf)
    expect(ops()).toEqual(['select', 'delete', 'insert', 'select'])
    const del = st.cereri[1], ins = st.cereri[2]
    expect(del.filtre).toEqual([['proiect_id', 7], ['sursa', 'act_aditional'], ['act_nr', '2']])
    expect(ins.rows.map(r => [r.cod, r.cantitate, r.valoare])).toEqual([['TSA01A1', 10, 100]])
    expect(ins.rows.reduce((s, r) => s + r.valoare, 0)).toBe(100)
    expect(toast).toHaveBeenCalledWith('✓ 1 articole — Act 2 (suplimentare +)', 'success')
  })
  it('(b′) același act ca RENUNȚARE: ca pe main, doar −10 / −100 (semnul vine din alegerea omului, pe singura linie importată)', async () => {
    const buf = await docxBuf(AA_MIXT)
    const { toast, importa } = await monteaza({ confirma: () => false })
    await importa(1, buf)
    expect(ops()).toEqual(['select', 'delete', 'insert', 'select'])
    expect(st.cereri[2].rows.map(r => [r.cod, r.cantitate, r.valoare])).toEqual([['TSA01A1', -10, -100]])
    expect(toast).toHaveBeenCalledWith('✓ 1 articole — Act 2 (renunțare −)', 'success')
  })
})
