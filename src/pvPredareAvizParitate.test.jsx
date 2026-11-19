// Paritate aviz ↔ PV (L19, TKT-2026-0379 r2).
// Avizul NU se atinge în acest PR, deci regula „ce bunuri arată documentul” există de două ori:
// în JSX-ul din AvizInsotireMarfaModal (Logistica.jsx) și în avizContinut.js (folosit de PV).
// Testul compilează și randează JSX-ul REAL al avizului, citit din Logistica.jsx la fiecare rulare,
// pe ACELAȘI tabel de cazuri (fixe + 3000 aleatoare) și îl compară:
//  (A) cu oglinda randuriContinutAviz — identic, celulă cu celulă;
//  (B) cu liniile PV-ului și HTML-ul PV — aceleași bunuri, în aceeași ordine, aceeași identificare și cantitate.
// Diferențele PERMISE în (B) sunt doar cele două reguli declarate ale PV-ului:
//  (1) fără bunuri → PV-ul nu se generează (avizul arată „—”); (2) denumire de utilaj goală → „—” în PV.
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithEsbuild } from 'vite'
import { describe, it, expect } from 'vitest'
import { randuriContinutAviz, SELECT_CONTINUT_AVIZ, SELECT_ACTIV_AVIZ } from './avizContinut.js'
import { liniiPvDinTransport, construiesteHtmlPv } from './pvPredareAviz.js'

// ── JSX-ul avizului, extras din sursă ──────────────────────────────────────────────────────────────
const SURSA = readFileSync(new URL('./Logistica.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const I0 = SURSA.indexOf('function AvizInsotireMarfaModal(')
const MODAL = SURSA.slice(I0, SURSA.indexOf('\nfunction ', I0 + 10))
const IT = MODAL.indexOf('📦 Conținut transport</div>')
const ITB = MODAL.indexOf('<tbody>', IT)
const ITE = MODAL.indexOf('</tbody>', ITB)
const CORP_TBODY = MODAL.slice(ITB + '<tbody>'.length, ITE)
const { code } = await transformWithEsbuild(
  `function __AvizRanduri(T, continutItems) { return (<>${CORP_TBODY}</>) }`,
  'aviz_tbody.jsx', { loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
)
const avizRanduriReale = new Function('React', `${code}\nreturn __AvizRanduri`)(React)

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' }
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, m => ENT[m])
const divuri = (h) => [...h.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map(m => text(m[1]))

// Celulele avizului, din HTML-ul randat de JSX-ul real (ce vede omul pe aviz).
function randuriAviz(T, C) {
  const html = renderToStaticMarkup(<table><tbody>{avizRanduriReale(T, C)}</tbody></table>).replace(/<!-- -->/g, '')
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => {
    const td = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1])
    expect(td.length).toBe(5)
    const den = divuri(td[1])
    return {
      nr: text(td[0]),
      den,
      denumire: den[0] ?? '',
      regim: den.includes('⚠️ REGIM TRANSPORT SPECIAL'),
      observatii: td[1].includes('font-style:italic') ? den[den.length - 1] : '',
      identificareCelula: text(td[2]) === '—' ? null : divuri(td[2]),
      identificare: text(td[2]) === '—' ? [] : divuri(td[2]),
      um: text(td[3]),
      cantitate: text(td[4]),
    }
  })
}

// ── Tabelul comun de cazuri (date sintetice) ───────────────────────────────────────────────────────
const A = { cod_intern: 'EX-01', nr_inventar: 'INV-7', marca: 'Alfa', model: 'X1', nr_inmatriculare: 'PH-01-ABC', serie_sasiu: 'VIN123', regim_transport_special: false }
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

// Cazuri aleatoare deterministe (mulberry32): toate combinațiile de câmpuri lipsă / goale / spații / numere.
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const VAL = [undefined, null, '', ' ', 'A', 'Alfa', 'X1', '0', 7, 'INV-7', 'Ț&<b>']
const CANT = [undefined, null, '', 0, '0', 1, 2.5, 120.555, '4', '1.2345', 'abc']
const UM = [undefined, null, '', 'm', 'buc', 'kg']
function cazAleator(r) {
  const p = (a) => a[Math.floor(r() * a.length)]
  const activ = () => (r() < 0.2 ? p([null, undefined]) : { marca: p(VAL), model: p(VAL), cod_intern: p(VAL), nr_inventar: p(VAL), nr_inmatriculare: p(VAL), serie_sasiu: p(VAL), regim_transport_special: p([true, false, null, undefined]) })
  const n = Math.floor(r() * 5)
  const C = Array.from({ length: n }, (_, i) => ({ id: r() < 0.8 ? 'c' + i : undefined, tip: p(['utilaj', 'marfa', undefined]), asset: activ(), denumire: p(VAL), cantitate: p(CANT), um: p(UM), observatii: p(VAL) }))
  const T = { id: 't', continut_multiplu: p([true, false, undefined]), tip: p(['utilaj', 'materiale', undefined]), activ_transportat: activ(), continut_descriere: p([...VAL, 'a\nb', '  \n ']) }
  return { T, C }
}
const ALEATOARE = (() => { const r = rng(20261120); return Array.from({ length: 3000 }, () => cazAleator(r)) })()

// ── (A) oglinda = avizul real ──────────────────────────────────────────────────────────────────────
function asteptatDinOglinda(r) {
  const S = (v) => String(v)
  const den = r.forma === 'multiplu'
    ? [S(r.denumire), r.isUtilaj ? '🚛 Utilaj' : '📦 Marfă', ...(r.regimSpecial ? ['⚠️ REGIM TRANSPORT SPECIAL'] : []), ...(r.observatii ? [S(r.observatii)] : [])]
    : r.isUtilaj ? [S(r.denumire), ...(r.regimSpecial ? ['⚠️ REGIM TRANSPORT SPECIAL'] : [])] : [S(r.descriere)]
  return {
    nr: S(r.nr), den,
    identificareCelula: r.identificare ? r.identificare.map(i => `${i.eticheta}: ${S(i.valoare)}`) : null,
    um: S(r.um), cantitate: S(r.cantitate),
  }
}
const proiectie = (a) => ({ nr: a.nr, den: a.den, identificareCelula: a.identificareCelula, um: a.um, cantitate: a.cantitate })

describe('(A) avizContinut.js = JSX-ul real al avizului (Logistica.jsx)', () => {
  it('JSX-ul avizului a fost găsit și compilat', () => {
    expect(I0).toBeGreaterThan(0)
    expect(IT).toBeGreaterThan(0)
    expect(CORP_TBODY).toContain('continutItems')
    expect(typeof avizRanduriReale).toBe('function')
  })

  it('cazurile fixe + 3000 aleatoare: aceleași rânduri, celulă cu celulă', () => {
    let multiplu = 0, simplu = 0
    for (const { T, C } of [...CAZURI, ...ALEATOARE]) {
      const aviz = randuriAviz(T, C).map(proiectie)
      const oglinda = randuriContinutAviz(T, C).map(asteptatDinOglinda)
      expect(oglinda, JSON.stringify({ T, C })).toEqual(aviz)
      if (T.continut_multiplu && Array.isArray(C) && C.length > 0) multiplu++; else simplu++
    }
    expect(multiplu).toBeGreaterThan(500)
    expect(simplu).toBeGreaterThan(500)
  })

  it('selecția avizului din BD = SELECT_CONTINUT_AVIZ; activul transportului are aceleași câmpuri', () => {
    expect(MODAL).toContain(`.select('${SELECT_CONTINUT_AVIZ}')`)
    expect(MODAL).toMatch(/\.eq\('transport_id', T\.id\)\n\s+\.order\('ordine'\)/)
    expect(SURSA).toContain(`activ_transportat:logistica_active!activ_transportat_id(${SELECT_ACTIV_AVIZ})`)
  })
})

// ── (B) PV = aviz, cu diferențele declarate ────────────────────────────────────────────────────────
const cantitateDinAviz = (um, cant) => (cant === '—' ? '' : (um === '—' ? cant : `${cant} ${um}`))

function verificaPvFataDeAviz(T, C, faraBunuriAsteptat) {
  const aviz = randuriAviz(T, C)
  const pv = liniiPvDinTransport(T, C)
  expect(aviz.length).toBeGreaterThan(0)                       // avizul arată mereu cel puțin un rând
  if (pv.length === 0) {
    // Diferența permisă (1): avizul arată un singur rând fără bun, PV-ul refuză.
    if (faraBunuriAsteptat === false) throw new Error('PV gol pe un caz cu bunuri')
    expect(aviz.length).toBe(1)
    expect(aviz[0].denumire.trim() === '' || aviz[0].denumire === '—').toBe(true)
    expect(aviz[0].identificare).toEqual([])
    return 'refuz'
  }
  if (faraBunuriAsteptat === true) throw new Error('PV generat pe un caz fără bunuri')
  expect(pv.length).toBe(aviz.length)
  aviz.forEach((a, i) => {
    const p = pv[i]
    expect(a.nr).toBe(String(i + 1))
    expect(p.denumire).toBe(a.denumire.trim() || '—')          // diferența permisă (2)
    expect(p.identificare).toEqual(a.identificare)
    expect(p.cantitate).toBe(cantitateDinAviz(a.um, a.cantitate))
    expect(p.regimSpecial).toBe(a.regim)
    expect(p.observatii).toBe(a.observatii.trim())
  })
  return 'pv'
}

describe('(B) PV-ul arată aceleași bunuri ca avizul real', () => {
  for (const caz of CAZURI) {
    it(caz.nume, () => {
      expect(verificaPvFataDeAviz(caz.T, caz.C, !!caz.faraBunuri)).toBe(caz.faraBunuri ? 'refuz' : 'pv')
      if (caz.faraBunuri) return
      // Și în HTML-ul PV: aceleași linii, în aceeași ordine, cu identificarea avizului.
      const aviz = randuriAviz(caz.T, caz.C)
      const h = construiesteHtmlPv({ aviz: { numar_aviz: 'AVZ-T' }, linii: liniiPvDinTransport(caz.T, caz.C), dataPv: '2026-11-20' })
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

  it('3000 de cazuri aleatoare: PV = aviz (cu cele două diferențe declarate)', () => {
    const n = { pv: 0, refuz: 0 }
    for (const { T, C } of ALEATOARE) n[verificaPvFataDeAviz(T, C)]++
    expect(n.pv).toBeGreaterThan(1000)
    expect(n.refuz).toBeGreaterThan(50)
  })

  it('tabelul fix acoperă ambele forme, ambele etichete de înmatriculare, regimul special, observațiile și refuzul', () => {
    const toate = CAZURI.flatMap(c => randuriAviz(c.T, c.C))
    expect(toate.some(a => a.regim)).toBe(true)
    expect(toate.some(a => a.observatii)).toBe(true)
    expect(toate.some(a => a.identificare.some(x => x.startsWith('Nr. înmatr.:')))).toBe(true)
    expect(toate.some(a => a.identificare.some(x => x.startsWith('Nr. înmatriculare:')))).toBe(true)
    expect(toate.some(a => a.denumire.trim() === '')).toBe(true)
    expect(CAZURI.filter(c => c.faraBunuri).length).toBeGreaterThanOrEqual(4)
  })

  it('avizul real: valori scrise de mână pe cazul mixt (oracolul nu e codul PV)', () => {
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
