// Paritate aviz ↔ PV (L19, TKT-2026-0379 r2): pe ACELAȘI tabel de cazuri, tabelul randat de aviz
// (AvizContinutRanduri, cel din AvizInsotireMarfaModal) și liniile PV-ului (liniiPvDinTransport + HTML-ul PV)
// trebuie să arate aceleași bunuri, în aceeași ordine, cu aceeași identificare și cantitate.
// Diferențele PERMISE sunt doar cele două reguli declarate ale PV-ului:
//  (1) fără bunuri → PV-ul nu se generează (avizul arată „—”); (2) denumire de utilaj goală → „—” în PV.
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import AvizContinutRanduri from './AvizContinutRanduri.jsx'
import { liniiPvDinTransport, construiesteHtmlPv } from './pvPredareAviz.js'

const A = { cod_intern: 'EX-01', nr_inventar: 'INV-7', marca: 'Alfa', model: 'X1', nr_inmatriculare: 'PH-01-ABC', serie_sasiu: 'VIN123', regim_transport_special: false }

// Tabelul comun de cazuri (date sintetice).
const CAZURI = [
  { nume: 'multiplu mixt', T: { continut_multiplu: true, tip: 'utilaj', activ_transportat: A }, C: [
    { id: 1, tip: 'utilaj', asset: { ...A, regim_transport_special: true } },
    { id: 2, tip: 'marfa', denumire: 'Țeavă PE 110', cantitate: 120.5, um: 'm', observatii: 'colac' },
    { id: 3, tip: 'marfa', denumire: '', cantitate: null },
    { id: 4, tip: 'utilaj', asset: { cod_intern: 'EX-09' } },
    { id: 5, tip: 'utilaj', asset: null, denumire: 'Pompă' },
    { id: 6, tip: 'marfa', denumire: 'Cot 90', cantitate: '1.2345', um: null },
    { id: 7, tip: 'marfa', denumire: 'Sârmă', cantitate: 0, um: 'kg' },
    { id: 8, tip: 'utilaj', asset: { marca: 'Beta', serie_sasiu: 'SN-1' } },
  ] },
  { nume: 'multiplu fără rânduri → utilajul transportului', T: { continut_multiplu: true, tip: 'utilaj', activ_transportat: A }, C: [] },
  { nume: 'simplu utilaj, regim special', T: { tip: 'utilaj', activ_transportat: { ...A, regim_transport_special: true } }, C: null },
  { nume: 'simplu utilaj fără marcă', T: { tip: 'utilaj', activ_transportat: { model: 'X1', nr_inventar: 'INV-2' } }, C: [] },
  { nume: 'simplu utilaj fără marcă / model', T: { tip: 'utilaj', activ_transportat: { cod_intern: 'EX-3' } }, C: [] },
  { nume: 'simplu descriere pe mai multe rânduri', T: { tip: 'materiale', continut_descriere: '10 saci ciment\nși nisip' }, C: [] },
  { nume: 'tip utilaj fără activ, cu descriere', T: { tip: 'utilaj', activ_transportat: null, continut_descriere: 'Macara închiriată' }, C: [] },
  { nume: 'fără bunuri: descriere goală', T: { tip: 'materiale', continut_descriere: '' }, C: [], faraBunuri: true },
  { nume: 'fără bunuri: descriere doar spații', T: { tip: 'materiale', continut_descriere: '  \n ' }, C: [], faraBunuri: true },
  { nume: 'fără bunuri: multiplu gol, fără activ', T: { continut_multiplu: true, tip: 'utilaj', activ_transportat: null }, C: [], faraBunuri: true },
  { nume: 'fără bunuri: transport gol', T: {}, C: [], faraBunuri: true },
]

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' }
const text = (h) => h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, m => ENT[m])
const divuri = (h) => [...h.replace(/<!-- -->/g, '').matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map(m => text(m[1]))

// Celulele avizului, citite din HTML-ul randat (ce vede omul pe aviz).
function randuriAviz(T, C) {
  const html = renderToStaticMarkup(<table><tbody><AvizContinutRanduri transport={T} continutItems={C} /></tbody></table>)
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => {
    const td = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1])
    expect(td.length).toBe(5)
    const den = divuri(td[1])
    return {
      nr: text(td[0]),
      denumire: den[0] ?? '',
      regim: den.includes('⚠️ REGIM TRANSPORT SPECIAL'),
      observatii: td[1].includes('font-style:italic') ? den[den.length - 1] : '',
      identificare: text(td[2]) === '—' ? [] : divuri(td[2]),
      um: text(td[3]),
      cantitate: text(td[4]),
    }
  })
}

const cantitateDinAviz = (um, cant) => (cant === '—' ? '' : (um === '—' ? cant : `${cant} ${um}`))

describe('paritate aviz ↔ PV pe același tabel de cazuri', () => {
  for (const caz of CAZURI) {
    it(caz.nume, () => {
      const aviz = randuriAviz(caz.T, caz.C)
      const pv = liniiPvDinTransport(caz.T, caz.C)
      expect(aviz.length).toBeGreaterThan(0)                       // avizul arată mereu cel puțin un rând
      if (caz.faraBunuri) {
        // Diferența permisă (1): avizul arată un rând fără bun, PV-ul refuză.
        expect(aviz.length).toBe(1)
        expect(aviz[0].denumire.trim() === '' || aviz[0].denumire === '—').toBe(true)
        expect(aviz[0].identificare).toEqual([])
        expect(pv).toEqual([])
        return
      }
      expect(pv.length).toBe(aviz.length)
      aviz.forEach((a, i) => {
        const p = pv[i]
        expect(a.nr).toBe(String(i + 1))
        // Diferența permisă (2): celula albă din aviz devine „—” în PV.
        expect(p.denumire).toBe(a.denumire.trim() || '—')
        expect(p.identificare).toEqual(a.identificare)
        expect(p.cantitate).toBe(cantitateDinAviz(a.um, a.cantitate))
        expect(p.regimSpecial).toBe(a.regim)
        expect(p.observatii).toBe(a.observatii)
      })
      // Și în HTML-ul PV: aceleași linii, în aceeași ordine, cu identificarea avizului.
      const h = construiesteHtmlPv({ aviz: { numar_aviz: 'AVZ-T' }, linii: pv, dataPv: '2026-11-20' })
      expect((h.match(/<tr data-pv-linie="/g) || []).length).toBe(aviz.length)
      let poz = 0
      for (const a of aviz) {
        for (const x of [a.denumire.trim() || '—', ...a.identificare]) {
          const e = x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          const j = h.indexOf(e, poz)
          expect(j, `„${x}” lipsește sau e în altă ordine în PV`).toBeGreaterThan(-1)
          poz = j
        }
      }
      expect((h.match(/REGIM TRANSPORT SPECIAL/g) || []).length).toBe(aviz.filter(a => a.regim).length)
    })
  }

  it('tabelul de cazuri acoperă ambele forme, ambele tipuri, regimul special și refuzul', () => {
    const toate = CAZURI.flatMap(c => randuriAviz(c.T, c.C))
    expect(toate.some(a => a.regim)).toBe(true)
    expect(toate.some(a => a.observatii)).toBe(true)
    expect(toate.some(a => a.identificare.some(x => x.startsWith('Nr. înmatr.:')))).toBe(true)
    expect(toate.some(a => a.identificare.some(x => x.startsWith('Nr. înmatriculare:')))).toBe(true)
    expect(toate.some(a => a.denumire.trim() === '')).toBe(true)
    expect(CAZURI.filter(c => c.faraBunuri).length).toBeGreaterThanOrEqual(4)
  })

  it('avizul din Logistica.jsx folosește aceeași definiție: selecția, ordinea și rândurile', () => {
    const src = readFileSync(new URL('./Logistica.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const i0 = src.indexOf('function AvizInsotireMarfaModal(')
    const corp = src.slice(i0, src.indexOf('\nfunction ', i0 + 10))
    expect(i0).toBeGreaterThan(0)
    expect(corp).toMatch(/\.from\('logistica_transporturi_continut'\)\n\s+\.select\(SELECT_CONTINUT_AVIZ\)\n\s+\.eq\('transport_id', T\.id\)\n\s+\.order\(ORDINE_CONTINUT_AVIZ\[0\]\)\n\s+\.order\(ORDINE_CONTINUT_AVIZ\[1\]\)/)
    expect(corp).toMatch(/<tbody>\n\s+\{\/\*[^\n]*\*\/\}\n\s+<AvizContinutRanduri transport=\{T\} continutItems=\{continutItems\} \/>\n\s+<\/tbody>/)
    // nicio regulă veche rămasă în modal (a doua definiție)
    expect(corp).not.toContain('continutItems.map(')
    expect(corp).not.toContain('Serie șasiu:')
  })

  it('avizul randat: valori scrise de mână pe cazul mixt (oracolul nu e codul PV)', () => {
    const a = randuriAviz(CAZURI[0].T, CAZURI[0].C)
    expect(a.map(x => [x.denumire, x.um, x.cantitate])).toEqual([
      ['Alfa X1', 'buc', '1'], ['Țeavă PE 110', 'm', '120,5'], ['—', '—', '—'], ['', 'buc', '1'],
      ['Pompă', 'buc', '1'], ['Cot 90', '—', '1,23'], ['Sârmă', 'kg', '—'], ['Beta', 'buc', '1'],
    ])
    expect(a[0].identificare).toEqual(['Nr. inventar: INV-7', 'Cod intern: EX-01', 'Nr. înmatr.: PH-01-ABC', 'Serie șasiu: VIN123'])
    expect(a[0].regim).toBe(true)
    expect(a[1].observatii).toBe('colac')
    expect(a[4].identificare).toEqual([])
    expect(a[7].identificare).toEqual(['Serie șasiu: SN-1'])
  })
})
