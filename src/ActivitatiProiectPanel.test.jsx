// Teste pentru ActivitatiProiectPanel (Rest de decontat PR1 r8, review #1158 P1: cititorii plafonați la 1000 de rânduri). „Contract” = suma articolelor
// al căror cod începe cu prefixele activității; PostgREST dă cel mult 1000 de rânduri pe cerere, iar citirea veche (fără ordine, fără paginare) primea un
// SUBSET dependent de ordinea fizică a rândurilor — după confirmarea ofertei în „Rest de decontat” (rândurile vechi mutate în istoric, cele confirmate
// scrise la loc, deci la SFÂRȘITUL tabelului) suma se schimba pe proiectele cu peste 1000 de articole (reproducerea review-ului: 100 → 900 pe 1.001 rânduri).
// Aici: 1.001 articole (101 TSA + 900 GC) în două ordini fizice (ca înainte / după confirmare) → aceeași sumă, egală cu cea calculată din date (L25);
// 1.001 raportări → progresul complet; o eroare de citire e arătată, nu devine 0 (L18). Componenta reală cu react-dom în jsdom, client Supabase FALS cu
// plafonul max-rows (src/lib/supabaseFalsPlafon.js). jsdom nu e dependență a proiectului (ca la CatalogDevizPanel.test.jsx): fără el suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const st = vi.hoisted(() => ({ tabele: {}, cereri: [], erori: {} }))
vi.mock('./lib/supabase.js', async () => {
  const { creeazaClientFals } = await import('./lib/supabaseFalsPlafon.js')
  return { supabase: creeazaClientFals(st) }
})
import ActivitatiProiectPanel from './ActivitatiProiectPanel.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[ActivitatiProiectPanel.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const PID = 4
// 1.001 articole: 101 cu codul TSA01A1 (cantitate 1 fiecare), 900 cu GC 01 (cantitate 2 fiecare); „înainte”: ordinea fizică = ordinea id-urilor (TSA primele)
const ARTICOLE = Array.from({ length: 1001 }, (_, i) => ({
  id: i + 1, proiect_id: PID, cod: i < 101 ? 'TSA01A1' : 'GC 01', um: i < 101 ? 'M' : 'M', cantitate: i < 101 ? 1 : 2, sursa: 'contract_initial',
}))
// „după confirmare”: aceleași 1.001 articole (date echivalente), dar rândurile TSA au fost rescrise la SFÂRȘITUL tabelului, cu id-uri noi
const ARTICOLE_DUPA = [...ARTICOLE.filter(a => a.cod !== 'TSA01A1'), ...ARTICOLE.filter(a => a.cod === 'TSA01A1').map((a, i) => ({ ...a, id: 2000 + i }))]
// 1.001 raportări pe activitatea 1, cantitate 1 fiecare → progres 1.001 (și el peste plafon)
const RAPORTARI = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, proiect_id: PID, activitate_id: 1, cantitate: 1 }))
const ACTIVITATI = [{ id: 1, proiect_id: PID, nume: 'Săpat șanț', um: 'm', coduri_deviz: 'TSA', ordine: 1, tip_raportare: 'cantitate' }]
// așteptatul, din DATE (nu din codul testat, L25): suma cantităților TSA pe toate cele 1.001 rânduri
const TSA_ASTEPTAT = ARTICOLE.filter(a => a.cod.toUpperCase().startsWith('TSA')).reduce((s, a) => s + a.cantitate, 0)
const TSA_ASTEPTAT_DUPA = ARTICOLE_DUPA.filter(a => a.cod.toUpperCase().startsWith('TSA')).reduce((s, a) => s + a.cantitate, 0)
const RAPORTAT_ASTEPTAT = RAPORTARI.reduce((s, r) => s + r.cantitate, 0)

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.cereri = []; st.tabele = {}; st.erori = {}; vi.restoreAllMocks() })

async function monteaza() {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const toast = vi.fn()
  await act(async () => { root.render(<ActivitatiProiectPanel proiectId={PID} showToast={toast} />) })
  await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve() })
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  return { d: j.window.document, toast }
}
// celula „Contract” a primei activități (textul „<q> <um> (<n>)”) și celula de progres
const contract = d => [...d.querySelectorAll('span')].map(s => s.textContent).find(t => /^[\d.,]+ m \(\d+\)$|^— maparea$/.test(t.trim()))
const citiri = tabel => st.cereri.filter(c => c.tabel === tabel && c.op === 'select')

describe('plafonul fals reproduce condiția review-ului', () => {
  it('cititorul VECHI (fără ordine, fără paginare) ar vedea alt total după confirmare — altfel testul n-ar dovedi nimic', async () => {
    const { creeazaClientFals, MAX_ROWS } = await import('./lib/supabaseFalsPlafon.js')
    const vechi = async tabele => {
      const c = creeazaClientFals({ tabele, cereri: [], erori: {} })
      const { data } = await c.from('proiect_articole').select('cod, um, cantitate, sursa').eq('proiect_id', PID).neq('sursa', 'extras_materiale')
      return { n: data.length, tsa: data.filter(x => x.cod.toUpperCase().startsWith('TSA')).reduce((s, x) => s + x.cantitate, 0) }
    }
    const a = await vechi({ proiect_articole: ARTICOLE }), b = await vechi({ proiect_articole: ARTICOLE_DUPA })
    expect(a.n).toBe(MAX_ROWS); expect(b.n).toBe(MAX_ROWS)
    expect(a.tsa).toBe(TSA_ASTEPTAT)           // înainte: TSA sunt primele → toate în primele 1000
    expect(b.tsa).toBeLessThan(TSA_ASTEPTAT)   // după: TSA la sfârșit → o parte cad peste plafon (ca în reproducerea Jakarinos)
  })
})

dom(numeDom('ActivitatiProiectPanel: „Contract” și progresul pe proiecte cu peste 1000 de rânduri'), () => {
  it('1.001 articole, ordinea fizică de dinainte: Contract = suma TUTUROR articolelor TSA, citite pe chei (id, limit, gt)', async () => {
    st.tabele = { proiect_activitati: ACTIVITATI, proiect_articole: ARTICOLE, raport_lucrari: RAPORTARI }
    const { d, toast } = await monteaza()
    expect(contract(d)).toBe(`${TSA_ASTEPTAT.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} m (${TSA_ASTEPTAT})`)
    expect(toast).not.toHaveBeenCalled()
    // citirea e paginată pe chei: ordonată pe id, cu limită, până la pagina goală (2 cereri pentru 1.001 rânduri + 1 goală… sau 2, fără dubluri / goluri)
    const c = citiri('proiect_articole')
    expect(c.length).toBeGreaterThanOrEqual(2)
    expect(c.every(x => x.ordine.includes('id') && x.limita != null)).toBe(true)
    // progresul: toate cele 1.001 raportări (și ele peste plafon) — în titlul barei: „<raportat> / <contract> m”
    const titluri = [...d.querySelectorAll('[title]')].map(e => e.getAttribute('title'))
    expect(titluri).toContain(`${RAPORTAT_ASTEPTAT.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} / ${TSA_ASTEPTAT.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} m`)
    expect(citiri('raport_lucrari').length).toBeGreaterThanOrEqual(2)
  })
  it('aceleași articole după confirmare (TSA rescrise la sfârșit, id-uri noi): EXACT același Contract', async () => {
    st.tabele = { proiect_activitati: ACTIVITATI, proiect_articole: ARTICOLE_DUPA, raport_lucrari: RAPORTARI }
    const { d } = await monteaza()
    expect(TSA_ASTEPTAT_DUPA).toBe(TSA_ASTEPTAT)
    expect(contract(d)).toBe(`${TSA_ASTEPTAT.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} m (${TSA_ASTEPTAT})`)
  })
  it('eroare la citirea articolelor: mesaj de eroare, Contract necunoscut (nu „0 m (0)”)', async () => {
    st.tabele = { proiect_activitati: ACTIVITATI, proiect_articole: ARTICOLE, raport_lucrari: RAPORTARI }
    st.erori = { proiect_articole: { message: 'permission denied for table proiect_articole', code: '42501' } }
    const { d, toast } = await monteaza()
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('error')
    expect(toast.mock.calls[0][0]).toContain('permission denied for table proiect_articole')
    expect(d.body.textContent).toContain('nu s-au putut citi')
    expect(d.body.textContent).not.toContain('0 m (0)')
    expect(contract(d)).toBe('— maparea')
  })
})
