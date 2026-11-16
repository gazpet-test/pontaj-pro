// Teste pentru armăturile din schema 3D (16.11.2026): validarea tipurilor noi și a blocului `armare`, traseul cu îndoiri,
// lungimea „ca în extras”, greutatea, controlul față de extras și modelul fundației F6.
// Valorile așteptate vin din surse independente de cod: extrasul de armătură al planșei (bucăți, lungimi, 187 kg), cerința
// (greutatea desenată între 186 și 187 kg), formule scrise de mână (arc, secțiune × densitate).
import { describe, it, expect } from 'vitest'
import { parseModel3d, instalatia, aplicaAmplasare, cutieGrup, puncteElement } from './nodSchema3dLogica.js'
import {
  verificaTraseu, traseuBara, lungimeTraseu, lungimeExtras, masaBara, controlArmare, continutArmare, citesteArmare,
  culoareMarca, culoareDiametru, CULORI_MARCA, panouriArmare,
} from './nodSchema3dArmare.js'
import { CULORI } from './nodCuplareLogica.js'
import { CULORI_DN } from './nodSchema3dLogica.js'
import F6 from './nodSchema3d.fundatie-F6.json'

const MODEL = (grup = {}) => ({
  format: 'gazpet-nod-3d', versiune: 1, unitate: 'mm',
  grupuri: [{
    id: 'fund', titlu: 'Fundație', prefixe: [], teren_z: 0, suduri: [], fara_pozitie: [],
    armare: { stare_lista: 'neconfirmata', marci: [{ marca: '1', d: 14, otel: 'PC52', buc: 1, lungime_mm: 2014 }], extras_kg: 2.44 },
    elemente: [
      { tip: 'bara', marca: '1', d: 14, r: 42, puncte: [[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]], cert: 'desen' },
      { tip: 'beton', min: [-100, -100, -100], max: [1100, 1100, 100], et: 'Bloc' },
    ],
    ...grup,
  }],
})
const eroriDe = m => parseModel3d(m).erori.join(' | ')

describe('modelul fundației F6 (formatul nou)', () => {
  const m = parseModel3d(structuredClone(F6))
  const g = m.grupuri[0]
  const c = controlArmare(g)
  const pe = marca => c.marci.find(x => x.marca === marca)

  it('se citește fără nicio eroare; grup fără suduri, cu prefixe goale', () => {
    expect(m.erori).toEqual([])
    expect(m.grupuri).toHaveLength(1)
    expect(g.prefixe).toEqual([])
    expect(g.suduri).toEqual([])
  })
  it('56 de bare: 24 + 24 + 8, exact bucățile din extras', () => {
    expect(g.elemente.filter(e => e.tip === 'bara')).toHaveLength(56)
    expect(c.marci.map(x => [x.marca, x.d, x.otel, x.bucDesen, x.bucExtras])).toEqual([
      ['1', 14, 'PC52', 24, 24], ['2', 14, 'PC52', 24, 24], ['3', 8, 'OB37', 8, 8],
    ])
    expect(c.marci.every(x => x.bucOk)).toBe(true)
  })
  it('lungimea fiecărei bare, măsurată ca în extras: 3400 / 2700 / 3080 mm', () => {
    for (const [marca, L] of [['1', 3400], ['2', 2700], ['3', 3080]]) {
      expect(pe(marca).lungimeExtras).toBe(L)
      expect(Math.abs(pe(marca).lungimeMin - L)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(pe(marca).lungimeMax - L)).toBeLessThanOrEqual(0.5)
      expect(pe(marca).lungimeOk).toBe(true)
    }
  })
  it('greutatea desenată între 186 și 187 kg; controlul față de extras (187 kg) e în prag', () => {
    expect(c.kgDesen).toBeGreaterThan(186)
    expect(c.kgDesen).toBeLessThan(187)
    expect(c.extrasKg).toBe(187)
    expect(c.diferentaProc).toBeLessThan(0)
    expect(Math.abs(c.diferentaProc)).toBeLessThan(0.5)
    expect(c.controlOk).toBe(true)
  })
  it('lista e „neconfirmată de om” și are cele 7 puncte de confirmat (lungimea mărcii 2, etrierii, elevația, acoperirea, pasul…)', () => {
    expect(c.stareLista).toBe('neconfirmata')
    expect(c.deConfirmat).toHaveLength(7)
    const tot = c.deConfirmat.join(' ')
    for (const x of ['2,70 m', 'marca 3', '90 cm', 'acoperirea', 'Pasul', 'P1']) expect(tot).toContain(x)
    expect(m.note.join(' ')).toContain('NECONFIRMATĂ DE OM')
  })
  it('betonul (6 cutii: egalizare, bloc, elevație × 2) și piesele înglobate separate (12 buloane, 2 plăci, poziție estimată)', () => {
    const k = continutArmare(g)
    expect([k.beton, k.buloane, k.placi, k.inglobateEstimate]).toEqual([6, 12, 2, 14])
    expect(k.diametreBuloane).toEqual([20])
    const elevatie = g.elemente.find(e => e.tip === 'beton' && /Elevație.*fundația A/.test(e.et))
    expect(elevatie.dim).toEqual([800, 800, 900])           // 80 × 80 × 90 cm (−0,25 … +0,65)
    expect(elevatie.centru).toEqual([0, 0, 200])
  })
  it('repo public: modelul nu conține codul planșei, numele lucrării sau căi de pe server', () => {
    const text = JSON.stringify(F6)
    for (const x of ['1413', 'REZ-0', 'Prunis', 'Jupa', 'Transgaz', 'paw-data', 'NAS', ':\\\\']) expect(text).not.toContain(x)
  })
})

describe('validatorul elementelor noi: lipsă / imposibil = respins, nimic completat în tăcere', () => {
  it('modelul mic valid trece, cu marca text și cu marca număr întreg (1 -> "1")', () => {
    expect(parseModel3d(MODEL()).erori).toEqual([])
    const m = MODEL(); m.grupuri[0].armare.marci[0].marca = 1; m.grupuri[0].elemente[0].marca = 1
    const p = parseModel3d(m)
    expect(p.erori).toEqual([])
    expect(p.grupuri[0].elemente[0].marca).toBe('1')
  })
  it('bară fără diametru = respinsă; marca rămasă fără bare RĂMÂNE în listă (0 / 1), controlul e incomplet (review r2)', () => {
    const m = MODEL(); delete m.grupuri[0].elemente[0].d
    const p = parseModel3d(m)
    expect(p.erori.join(' | ')).toMatch(/elementul 1 \(bara\): diametrul barei lipsește/)
    expect(p.erori.join(' | ')).toMatch(/marca 1 \(Ø14\) nu are nicio bară validă în model; controlul extrasului e incomplet/)
    expect(p.grupuri[0].elemente.some(e => e.tip === 'bara')).toBe(false)
    expect(p.grupuri[0].armare.marci.map(x => x.marca)).toEqual(['1'])
    const c = controlArmare(p.grupuri[0])
    expect([c.bucDesen, c.bucExtras, c.complet, c.controlOk]).toEqual([0, 1, false, false])
  })
  it('unghi imposibil: bara care se întoarce pe ea însăși (180°) e respinsă, cu punctul și unghiul', () => {
    const m = MODEL(); m.grupuri[0].elemente[0].puncte = [[0, 0, 0], [1000, 0, 0], [0, 0, 0.001]]
    expect(eroriDe(m)).toMatch(/unghi imposibil la punctul 2: bara se întoarce pe ea însăși \(180°\)/)
  })
  it('raza de îndoire care nu încape pe segment = respinsă; în toleranță (0,5 mm) = acceptată', () => {
    const m = MODEL(); m.grupuri[0].elemente[0].puncte = [[0, 0, 0], [30, 0, 0], [30, 1000, 0]]
    expect(eroriDe(m)).toMatch(/raza de îndoire \(42 mm\) nu încape pe segmentul 1/)
    // U cu fundul de 2r = 84 mm: două îndoiri de 90° cer exact 84; 83,6 trece (toleranța), 83 nu
    const u = l => { const x = MODEL(); x.grupuri[0].elemente[0].puncte = [[0, 0, 500], [0, 0, 0], [l, 0, 0], [l, 0, 500]]; return eroriDe(x) }
    expect(u(84)).not.toMatch(/nu încape/)
    expect(u(83.6)).not.toMatch(/nu încape/)
    expect(u(83)).toMatch(/nu încape pe segmentul 2/)
  })
  it('review r2: marcă fără bare = eroare vizibilă + rând cu 0 bare; numitorul extrasului rămâne întreg, controlul INCOMPLET', () => {
    const m = MODEL(); m.grupuri[0].armare.marci.push({ marca: '4', d: 8, otel: 'OB37', buc: 8, lungime_mm: 3080 })
    const p = parseModel3d(m)
    expect(p.erori).toEqual(['Grupul 1 (fund): marca 4 (Ø8) nu are nicio bară validă în model; controlul extrasului e incomplet'])
    expect(p.grupuri[0].armare.marci.map(x => x.marca)).toEqual(['1', '4'])
    const c = controlArmare(p.grupuri[0])
    expect(c.marci.map(x => [x.marca, x.bucDesen, x.bucExtras, x.bucOk, x.lungimeOk])).toEqual([['1', 1, 1, true, true], ['4', 0, 8, false, false]])
    expect([c.bucDesen, c.bucExtras, c.complet]).toEqual([1, 9, false])
    expect(c.greutateOk).toBe(true)                    // 2,44 kg din extras = doar marca 1: greutatea singură ar fi „verde”
    expect(c.controlOk).toBe(false)                    // dar controlul nu e complet
    expect(c.motiveIncomplet.join(' ')).toMatch(/fără nicio bară desenată: marca 4 \(8 buc\.\)/)
  })
  it('review r2: date parțial respinse — o marcă respinsă, una fără bare, o bară invalidă: totalul din extras e cel original', () => {
    const m = MODEL()
    const a = m.grupuri[0].armare
    a.marci[0].buc = 2
    a.marci.push({ marca: '2', d: 12, otel: 'PC52', buc: 3, lungime_mm: 1000 })           // va rămâne fără bare
    a.marci.push({ marca: '3', d: 61, otel: 'PC52', buc: 4, lungime_mm: 1000 })           // diametru peste 60 = respinsă
    m.grupuri[0].elemente.push({ tip: 'bara', marca: '1', d: 14, r: 0, puncte: [[0, 0, 0], [0, 0, 0.2]] })   // segment sub 1 mm
    const p = parseModel3d(m)
    const e = p.erori.join(' | ')
    expect(e).toMatch(/marca 3 \(3\): diametru invalid.*controlul extrasului e incomplet/)
    expect(e).toMatch(/elementul 3 \(bara\): segmentul 1/)
    expect(e).toMatch(/marca 2 \(Ø12\) nu are nicio bară validă/)
    expect(p.grupuri[0].armare.respinse).toEqual([{ rand: 3, marca: '3', buc: 4 }])
    const c = controlArmare(p.grupuri[0])
    expect([c.bucDesen, c.bucExtras, c.bucExtrasNecunoscut, c.complet, c.controlOk]).toEqual([1, 2 + 3 + 4, false, false, false])
    expect(c.motiveIncomplet).toHaveLength(2)
    // fără mărci respinse și cu toate mărcile desenate, dar o bară lipsă (1 din 2): tot incomplet, cu motivul bucăților
    const n = MODEL(); n.grupuri[0].armare.marci[0].buc = 2
    const cn = controlArmare(parseModel3d(n).grupuri[0])
    expect([cn.complet, cn.controlOk]).toEqual([false, false])
    expect(cn.motiveIncomplet).toEqual(['bucăți desenate 1 față de 2 în extras'])
  })
  it('review r2 (P3): textele de alt tip (obiect, listă, adevărat / fals) sunt respinse, nu transformate în „[object Object]”', () => {
    const marca = f => { const m = MODEL(); const x = { marca: '2', d: 10, otel: 'PC52', buc: 1, lungime_mm: 100 }; f(x); m.grupuri[0].armare.marci.push(x); return parseModel3d(m) }
    for (const [f, re] of [
      [x => { x.otel = {} }, /marca 2 \(2\): oțelul trebuie să fie text/],
      [x => { x.otel = ['PC52'] }, /oțelul trebuie să fie text/],
      [x => { x.otel = true }, /oțelul trebuie să fie text/],
      [x => { x.forma = { a: 1 } }, /forma trebuie să fie text/],
    ]) {
      const p = marca(f)
      expect(p.erori.join(' | ')).toMatch(re)
      expect(JSON.stringify(p)).not.toContain('[object Object]')
      expect(p.grupuri[0].armare.marci.map(x => x.marca)).toEqual(['1'])
      expect(p.grupuri[0].armare.respinse.map(x => x.marca)).toEqual(['2'])
    }
    const nr = marca(x => { x.otel = 52 })                                  // un număr e text acceptat („52”)
    expect(nr.erori.join(' | ')).not.toMatch(/oțelul/)
    expect(nr.grupuri[0].armare.marci.map(x => [x.marca, x.otel])).toEqual([['1', 'PC52'], ['2', '52']])
    const cu = (f, re) => { const m = MODEL(); f(m.grupuri[0]); const p = parseModel3d(m); expect(p.erori.join(' | ')).toMatch(re); expect(JSON.stringify(p)).not.toContain('[object Object]'); return p }
    cu(g => { g.elemente[0].et = {} }, /elementul 1 \(bara\): eticheta trebuie să fie text/)
    cu(g => { g.elemente[1].et = ['Bloc'] }, /elementul 2 \(beton\): eticheta trebuie să fie text/)
    const s = cu(g => { g.armare.extras_sursa = { fisier: 'x' } }, /sursa extrasului nu e text/)
    expect(s.grupuri[0].armare.extrasSursa).toBe('')
    const d = cu(g => { g.armare.de_confirmat = ['Lungimea mărcii 1', {}, ['x']] }, /punctul de confirmat 2 nu e text/)
    expect(d.erori.join(' | ')).toMatch(/punctul de confirmat 3 nu e text/)
    expect(d.grupuri[0].armare.deConfirmat).toHaveLength(3)                // punctele necitite rămân în avertisment, nu dispar
    expect(d.grupuri[0].armare.deConfirmat[1]).toMatch(/Punctul 2 nu s-a putut citi/)
  })
  it('alte valori lipsă sau imposibile la bare / buloane', () => {
    const cu = (f, re) => { const m = MODEL(); f(m.grupuri[0].elemente[0]); expect(eroriDe(m)).toMatch(re) }
    cu(e => { delete e.r }, /raza de îndoire lipsește/)
    cu(e => { e.r = -1 }, /raza de îndoire invalidă/)
    cu(e => { e.d = 2 }, /diametru invalid/)
    cu(e => { e.d = 16 }, /diametrul \(Ø16\) nu e al mărcii 1 \(Ø14\)/)
    cu(e => { e.marca = '9' }, /marca „9” nu e în lista mărcilor/)
    cu(e => { delete e.marca }, /marca lipsește/)
    cu(e => { e.puncte = [[0, 0, 0]] }, /cel puțin 2 puncte/)
    cu(e => { e.puncte = [[0, 0, 0], [0, 0, 0.5]] }, /segmentul 1 .* sub 1 mm/)
    cu(e => { e.puncte = [[0, 0, 0], [1000, 0, NaN]] }, /punctul 2 al traseului/)
    cu(e => { e.cert = 'aproape' }, /certitudine invalidă/)
    const b = MODEL(); b.grupuri[0].elemente.push({ tip: 'bulon', r: 40, puncte: [[0, 0, 0], [0, 0, 900]] })
    expect(eroriDe(b)).toMatch(/elementul 3 \(bulon\): diametrul bulonului lipsește/)
  })
  it('beton și placă: cutie întoarsă / goală, dimensiuni lipsă, gol mai mare decât placa', () => {
    const cu = (el, re) => { const m = MODEL(); m.grupuri[0].elemente.push(el); expect(eroriDe(m)).toMatch(re) }
    cu({ tip: 'beton', min: [0, 0, 0], max: [1000, -5, 800] }, /cutia de beton e goală sau întoarsă pe axa y/)
    cu({ tip: 'beton', min: [0, 0, 0] }, /colțurile „min” \/ „max”/)
    cu({ tip: 'placa', centru: [0, 0, 650], lx: 700, grosime: 15 }, /„ly” lipsește/)
    cu({ tip: 'placa', centru: [0, 0, 650], lx: 700, ly: 700, grosime: 15, gol: 800 }, /golul plăcii e invalid/)
    cu({ tip: 'placa', centru: [0, 0, 650], lx: 700, ly: 700, grosime: 0 }, /„grosime” lipsește/)
  })
  it('blocul `armare`: structură greșită = respins cu motiv; barele lui ies ca erori, nu dispar', () => {
    const cu = (f, re) => { const m = MODEL(); f(m.grupuri[0].armare); const e = eroriDe(m); expect(e).toMatch(re); expect(e).toMatch(/elementul 1 \(bara\): marca „1” nu e în lista/) }
    cu(a => { a.stare_lista = 'poate' }, /„stare_lista” trebuie să fie/)
    cu(a => { a.necunoscut = 1 }, /câmpuri necunoscute \(necunoscut\)/)
    cu(a => { a.marci = [] }, /lista mărcilor lipsește sau e goală/)
    cu(a => { a.extras_kg = -3 }, /„extras_kg”/)
    expect(citesteArmare(undefined)).toEqual({ armare: null, erori: [] })
  })
  it('mărcile: duplicat, diametru / bucăți / lungime / oțel lipsă, câmp necunoscut = marca respinsă, restul rămân', () => {
    const cu = (marca, re) => {
      const m = MODEL(); m.grupuri[0].armare.marci.push(marca)
      expect(eroriDe(m)).toMatch(re)
      const a = parseModel3d(m).grupuri[0].armare
      expect(a.marci.map(x => x.marca)).toEqual(['1'])
      expect(a.respinse).toHaveLength(1)                                  // respinsă, dar numărată în extras (review r2)
    }
    cu({ marca: '1', d: 14, otel: 'PC52', buc: 1, lungime_mm: 2014 }, /marcă duplicată/)
    cu({ marca: '2', otel: 'PC52', buc: 1, lungime_mm: 100 }, /marca 2 \(2\): diametrul lipsește/)
    cu({ marca: '2', d: 10, otel: 'PC52', buc: 1.5, lungime_mm: 100 }, /numărul de bucăți/)
    cu({ marca: '2', d: 10, otel: 'PC52', buc: 2 }, /lungimea \(lungime_mm\)/)
    cu({ marca: '2', d: 10, buc: 2, lungime_mm: 100 }, /oțelul lipsește/)
    cu({ marca: '2', d: 10, otel: 'PC52', buc: 2, lungime_mm: 100, pas: 200 }, /câmpuri necunoscute \(pas\)/)
    cu({ marca: '2 a', d: 10, otel: 'PC52', buc: 2, lungime_mm: 100 }, /marca e invalidă/)
  })
  it('prefixe goale: permise doar la grupul fără nicio sudură (ex. o fundație); cu suduri = grup respins', () => {
    const m = MODEL(); m.grupuri[0].suduri = [{ cod: 'CR-001', p: [0, 0, 0], cert: 'desen' }]
    expect(eroriDe(m)).toMatch(/prefixele codurilor lipsesc sau sunt invalide/)
    const f = MODEL(); f.grupuri[0].fara_pozitie = [{ cod: 'CR-002', motiv: 'x' }]
    expect(eroriDe(f)).toMatch(/prefixele codurilor lipsesc/)
    const n = MODEL(); delete n.grupuri[0].prefixe
    expect(eroriDe(n)).toMatch(/prefixele codurilor lipsesc/)            // tot listă trebuie să fie
  })
})

describe('geometria barelor', () => {
  it('traseul: îndoirea de 90° cu r = 100 e un arc (toate punctele lui la r de centru), capetele rămân', () => {
    const t = traseuBara([[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]], 100)
    expect(t[0]).toEqual([0, 0, 0])
    expect(t[t.length - 1]).toEqual([1000, 1000, 0])
    const arc = t.slice(1, -1)
    expect(arc.length).toBe(7)                                             // 90° în pași de 15°: 6 pași, 7 puncte
    for (const p of arc) expect(Math.hypot(p[0] - 900, p[1] - 100, p[2])).toBeCloseTo(100, 9)
    // lungimea în ax: 2 × 900 + 6 coarde de 15° pe raza 100 (formula de mână)
    expect(lungimeTraseu(t)).toBeCloseTo(1800 + 6 * 2 * 100 * Math.sin(Math.PI / 24), 6)
  })
  it('îndoire la orice unghi (135°, ciocul etrierului): arcul e tangent la ambele segmente', () => {
    const t = traseuBara([[0, 0, 0], [500, 0, 0], [0, 300, 0]], 20)
    const u2 = [-500, 300, 0].map(v => v / Math.hypot(500, 300))
    const fin = t[t.length - 2], pre = t[t.length - 3]
    const dir = [fin[0] - pre[0], fin[1] - pre[1], 0], l = Math.hypot(dir[0], dir[1])
    expect(dir[0] / l * u2[0] + dir[1] / l * u2[1]).toBeGreaterThan(0.99)  // ultimul pas al arcului merge pe direcția segmentului 2
  })
  it('r = 0: colțul rămâne ascuțit; lungimea „ca în extras” adaugă d/2 doar la capetele îndoite', () => {
    expect(traseuBara([[0, 0, 0], [1000, 0, 0], [1000, 500, 0]], 0)).toEqual([[0, 0, 0], [1000, 0, 0], [1000, 500, 0]])
    expect(lungimeExtras([[0, 0, 0], [1000, 0, 0], [1000, 500, 0]], 10)).toBe(1005 + 505)
    expect(lungimeExtras([[0, 0, 0], [1200, 0, 0]], 10)).toBe(1200)                       // bară dreaptă
    expect(lungimeExtras([[0, 0, 0], [600, 0, 0], [1200, 0, 0]], 10)).toBe(1200)          // vârf coliniar: nu e îndoire
  })
  it('greutatea: 1 m de Ø14 = π × 0,007² × 7850 = 1,2084 kg', () => {
    expect(masaBara(1000, 14)).toBeCloseTo(Math.PI * 0.007 ** 2 * 7850, 9)
    expect(masaBara(1000, 14)).toBeCloseTo(1.2084, 4)
  })
  it('verificaTraseu: motivul exact sau null', () => {
    expect(verificaTraseu([[0, 0, 0], [100, 0, 0]], 0)).toBe(null)
    expect(verificaTraseu('x', 0)).toMatch(/cel puțin 2 puncte/)
    expect(verificaTraseu(Array.from({ length: 201 }, (_, i) => [i * 10, 0, 0]), 0)).toMatch(/peste 200/)
  })
})

describe('amplasarea și „Toată instalația” cu beton / bare', () => {
  it('rotirea grupului rotește centrul betonului și îi adaugă unghiul; barele își mută toate punctele', () => {
    const m = MODEL({ amplasare: { origine: [10000, 0, 0], rot_z: 90 } })
    const g = parseModel3d(m).grupuri[0]
    const a = aplicaAmplasare(g)
    const beton = a.elemente.find(e => e.tip === 'beton'), bara = a.elemente.find(e => e.tip === 'bara')
    expect(beton.centru).toEqual([10000 - 500, 500, 0])                   // (500, 500) rotit cu 90° = (−500, 500), apoi +10 m pe x
    expect(beton.rotZ).toBe(90)
    expect(bara.puncte).toEqual([[10000, 0, 0], [10000, 1000, 0], [9000, 1000, 0]])
    expect(g.elemente.find(e => e.tip === 'beton').rotZ).toBe(0)          // grupul sursă neschimbat
  })
  it('colțurile betonului rotit (cutia grupului) și ale plăcii', () => {
    const g = { elemente: [{ tip: 'beton', centru: [0, 0, 0], dim: [200, 100, 50], rotZ: 90 }] }
    expect(cutieGrup(g).min).toEqual([-50, -100, -25])
    expect(cutieGrup(g).max).toEqual([50, 100, 25])
    const p = puncteElement({ tip: 'placa', centru: [0, 0, 650], lx: 700, ly: 700, grosime: 15, rotZ: 0 })
    expect(p).toHaveLength(8)
    expect(Math.min(...p.map(x => x[2]))).toBe(650)
    expect(Math.max(...p.map(x => x[2]))).toBe(665)
  })
  it('o amplasare care scoate betonul în afara ±1 km e refuzată (grupul rămâne în vederea lui)', () => {
    const m = MODEL({ amplasare: { origine: [999500, 0, 0], rot_z: 0 } })
    const p = parseModel3d(m)
    expect(p.erori.join(' ')).toMatch(/amplasarea scoate grupul în afara ±1 km/)
    expect(p.grupuri[0].amplasare).toBe(null)
  })
  it('„Toată instalația” poartă blocul `armare` al părții (culorile pe marcă)', () => {
    const m = MODEL({ amplasare: { origine: [0, 0, 0], rot_z: 0 } })
    m.grupuri.push({ id: 'teava', prefixe: ['CR'], amplasare: { origine: [5000, 0, 0], rot_z: 0 }, elemente: [{ tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 100 }], suduri: [] })
    const inst = instalatia(parseModel3d(m))
    expect(inst.parti[0].armare.marci[0].marca).toBe('1')
    expect('armare' in inst.parti[1]).toBe(false)
    // review r2: vederea comună are câte un panou pe grupul cu armare, cu starea lui (reuniunea nu are bloc `armare`)
    expect('armare' in inst).toBe(false)
    const pan = panouriArmare(inst)
    expect(pan.map(x => [x.id, x.titlu, x.ctrl?.stareLista])).toEqual([['fund', 'Fundație', 'neconfirmata']])
    expect(panouriArmare(parseModel3d(MODEL()).grupuri[0]).map(x => x.ctrl.stareLista)).toEqual(['neconfirmata'])
    expect(panouriArmare(inst.parti[1])).toEqual([])                      // grupul doar cu țevi: niciun panou
  })
})

describe('culorile armăturii', () => {
  it('pe marcă: după ordinea din extras, ciclic; pe diametru: fixe, altul = gri', () => {
    expect(culoareMarca(0)).toBe(CULORI_MARCA[0])
    expect(culoareMarca(CULORI_MARCA.length)).toBe(CULORI_MARCA[0])
    expect(culoareDiametru(14)).toBe('#B23A48')
    expect(culoareDiametru(13)).toBe('#9E9E9E')
  })
  it('culorile mărcilor diferă de culorile stărilor sudurilor și de cele ale țevilor pe DN', () => {
    const alte = new Set([...Object.values(CULORI), ...Object.values(CULORI_DN)].map(c => c.toUpperCase()))
    for (const c of CULORI_MARCA) expect(alte.has(c.toUpperCase())).toBe(false)
  })
})
