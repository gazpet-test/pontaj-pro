// Scena 3D cu armături (16.11.2026): Three.js REAL (geometrii, materiale), renderer și controale false (Node nu are WebGL).
// Pe modelul fundației F6: sub-grupurile pe marcă / beton / piese înglobate, ascunderea, culoarea pe marcă sau pe diametru,
// diametrul real al barelor (acoperirea de 50 mm la fundul blocului iese din geometria desenată) și eliberarea resurselor.
// Review r2: DOM fals minim (nodSchema3dDomFals.testutil.js) în locul lui jsdom, deci suita RULEAZĂ peste tot (nu mai e sărită);
// panoul de armare se verifică prin randare pe server (react-dom/server), fără DOM: avertismentul „neconfirmată”, starea
// „estimat” și controlul se păstrează la ascunderea unei mărci, la comutarea culorii și în vederea „Toată instalația”.
import { describe, it, expect, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE_REAL from 'three'
import NodSchema3D, { construiesteScena, PanouArmare } from './NodSchema3D.jsx'
import { parseModel3d, instalatia } from './nodSchema3dLogica.js'
import { culoareDiametru, CULORI_MARCA, controlArmare, continutArmare, cheieMarca } from './nodSchema3dArmare.js'
import { mediuScena } from './nodSchema3dDomFals.testutil.js'
import F6 from './nodSchema3d.fundatie-F6.json'

let refa = null
afterEach(() => { refa?.(); refa = null })

// partea = grupul al cărui prim copil e grupul etichetelor; sub-grupurile ei se găsesc după nume (marca:1, beton, inglobate…)
const partiDin = scena => scena.children.filter(o => o.isGroup && o.children[0]?.isGroup)
const parteDin = scena => partiDin(scena)[0]
const cutie = o => new THREE_REAL.Box3().setFromObject(o)
const scenaDe = grup => {
  const m = mediuScena()
  refa = m.refa
  const s = construiesteScena(m.THREE, m.Controale, m.gazda, grup, () => {})
  return { s, scena: m.scene[0] }
}
const F6g = () => parseModel3d(structuredClone(F6)).grupuri[0]
// un model mic de test (formatul nou), cu mărcile și elementele date
const MODEL = (marci, elemente, extra = {}) => ({
  format: 'gazpet-nod-3d', versiune: 1, unitate: 'mm',
  grupuri: [{ id: 'fund', titlu: 'Fundație', prefixe: [], teren_z: 0, suduri: [], fara_pozitie: [],
    armare: { stare_lista: 'neconfirmata', marci, extras_kg: 10, ...extra }, elemente }],
})
// F6 amplasat lângă un al doilea grup (țeavă) = vederea „Toată instalația”
const instalatieCuF6 = (alterF6 = () => {}) => {
  const f6 = structuredClone(F6)
  f6.grupuri[0].amplasare = { origine: [0, 0, 0], rot_z: 0 }
  alterF6(f6.grupuri[0])
  f6.grupuri.push({ id: 'teava', titlu: 'Țeava', prefixe: ['CR'], amplasare: { origine: [5000, 0, 0], rot_z: 0 },
    elemente: [{ tip: 'teava', a: [0, 0, 0], b: [1000, 0, 0], dn: 100 }], suduri: [] })
  const p = parseModel3d(f6)
  expect(p.erori).toEqual([])
  return instalatia(p)
}

describe('NodSchema3D — armături în scenă (DOM fals + Three.js real; nu se sare)', () => {
  const construieste = () => {
    const grup = F6g()
    const { s, scena } = scenaDe(grup)
    const parte = parteDin(scena)
    const [m1, m2, m3, beton, piese] = ['marca:1', 'marca:2', 'marca:3', 'beton', 'inglobate'].map(n => parte.children.find(o => o.name === n))
    return { s, scena, parte, grup, m1, m2, m3, beton, piese }
  }

  it('sub-grupuri separate: o marcă = un grup (barele lipite într-o plasă); betonul cu muchii; piesele înglobate separat', () => {
    const { s, parte, m1, m2, m3, beton, piese } = construieste()
    expect(parte.children).toHaveLength(6)
    for (const g of [m1, m2, m3]) { expect(g.children).toHaveLength(1); expect(g.children[0].isMesh).toBe(true) }
    expect(beton.children.filter(o => o.isLineSegments)).toHaveLength(6)   // muchiile celor 6 cutii
    expect(beton.children.filter(o => o.isMesh)).toHaveLength(1)           // cutiile lipite (același material)
    expect(beton.children.find(o => o.isMesh).material.transparent).toBe(true)
    expect(piese.children.filter(o => o.isMesh)).toHaveLength(2)           // buloanele (o plasă) + plăcile (alta)
    for (const o of piese.children) expect(o.material.opacity).toBeLessThan(1) // poziție estimată = mai deschis
    s.dispose()
  })

  it('diametrul real: fundul barelor Ø14 la −1,000 (acoperire 50 mm peste −1,05); etrierii Ø8 încep la −0,154', () => {
    const { s, m1, m3 } = construieste()
    expect(cutie(m1).min.y).toBeCloseTo(-1.0, 3)                          // ax la −993 mm, rază 7 mm
    expect(cutie(m3).min.y).toBeCloseTo(-0.154, 3)                        // ax la −150 mm, rază 4 mm
    // vârful mustăților: fundul barei −1,000 + piciorul de 1350 (pe exterior), setul Y așezat peste setul X (+14) = +0,364
    expect(cutie(m1).max.y).toBeCloseTo(0.364, 3)
    s.dispose()
  })

  it('Ø20 / Ø25 / Ø32: raza măsurată în geometria desenată = 10 / 12,5 / 16 mm (jumătate din diametrul din extras)', () => {
    // bare drepte pe x, la y = 0, z = 0; în scenă y-ul modelului devine −z, iar secțiunea tubului atinge exact ±r pe z
    const marci = [['A', 20], ['B', 25], ['C', 32]].map(([marca, d]) => ({ marca, d, otel: 'PC52', buc: 1, lungime_mm: 1000 }))
    const el = marci.map(m => ({ tip: 'bara', marca: m.marca, d: m.d, r: 0, puncte: [[0, 0, 0], [1000, 0, 0]] }))
    const p = parseModel3d(MODEL(marci, el))
    expect(p.erori).toEqual([])
    const { s, scena } = scenaDe(p.grupuri[0])
    const parte = parteDin(scena)
    for (const [marca, razaMm] of [['A', 10], ['B', 12.5], ['C', 16]]) {
      const b = cutie(parte.children.find(o => o.name === `marca:${marca}`))
      expect((b.max.z - b.min.z) / 2).toBeCloseTo(razaMm / 1000, 6)      // geometria e în float32: la 0,5 µm
      expect(b.max.x - b.min.x).toBeCloseTo(1, 9)                          // lungimea de 1 m, neschimbată
    }
    s.dispose()
  })

  it('ascunderea pe marcă (cheie grup + marcă), a betonului și a pieselor; culoarea pe diametru și înapoi pe marcă', () => {
    const { s, grup, m1, m2, m3, beton, piese } = construieste()
    s.armare({ ascunseMarci: new Set([cheieMarca(grup.id, '2')]), beton: false, inglobate: false, culoare: 'marca' })
    expect([m1.visible, m2.visible, m3.visible, beton.visible, piese.visible]).toEqual([true, false, true, false, false])
    s.armare({ ascunseMarci: new Set(), culoare: 'diametru' })
    expect([m2.visible, beton.visible, piese.visible]).toEqual([true, true, true])
    const hex = o => '#' + o.children[0].material.color.getHexString().toUpperCase()
    expect([hex(m1), hex(m2), hex(m3)]).toEqual([culoareDiametru(14), culoareDiametru(14), culoareDiametru(8)].map(c => c.toUpperCase()))
    s.armare({ culoare: 'marca' })
    expect([hex(m1), hex(m2), hex(m3)]).toEqual(CULORI_MARCA.slice(0, 3).map(c => c.toUpperCase()))
    s.dispose()
  })

  it('review r2 (P2): mărcile „beton” și „inglobate” rămân mărci — grupul lor, nu betonul / piesele; ascunderea nu se amestecă', () => {
    const marci = ['beton', 'inglobate'].map(marca => ({ marca, d: 12, otel: 'PC52', buc: 1, lungime_mm: 1000 }))
    const el = [
      { tip: 'bara', marca: 'beton', d: 12, r: 0, puncte: [[0, 0, 0], [1000, 0, 0]] },
      { tip: 'bara', marca: 'inglobate', d: 12, r: 0, puncte: [[0, 500, 0], [1000, 500, 0]] },
      { tip: 'beton', min: [-100, -100, -200], max: [1100, 600, 100] },
      { tip: 'bulon', d: 20, r: 0, puncte: [[500, 250, 0], [500, 250, 300]], cert: 'estimat' },
    ]
    const p = parseModel3d(MODEL(marci, el))
    expect(p.erori).toEqual([])
    const { s, scena } = scenaDe(p.grupuri[0])
    const parte = parteDin(scena)
    const dupa = n => parte.children.find(o => o.name === n)
    const [mBeton, mIngl, beton, piese] = ['marca:beton', 'marca:inglobate', 'beton', 'inglobate'].map(dupa)
    expect(mBeton?.children).toHaveLength(1)                               // bara mărcii „beton”, în grupul ei de marcă
    expect(mIngl?.children).toHaveLength(1)
    expect(beton.children.filter(o => o.isMesh)).toHaveLength(1)           // doar cutia de beton
    expect(beton.children.find(o => o.isMesh).material.opacity).toBeCloseTo(0.16, 9)
    expect(piese.children).toHaveLength(1)                                 // doar bulonul
    expect(piese.children[0].material.opacity).toBeLessThan(1)
    s.armare({ ascunseMarci: new Set([cheieMarca('fund', 'beton')]) })
    expect([mBeton.visible, mIngl.visible, beton.visible, piese.visible]).toEqual([false, true, true, true])
    s.armare({ ascunseMarci: new Set(), beton: false, inglobate: false })
    expect([mBeton.visible, mIngl.visible, beton.visible, piese.visible]).toEqual([true, true, false, false])
    s.dispose()
  })

  it('vederea comună: partea fundației își are mărcile; ascunderea mărcii 1 a fundației nu atinge alt grup', () => {
    const inst = instalatieCuF6()
    const { s, scena } = scenaDe(inst)
    const [pf, pt] = partiDin(scena)
    const m1 = pf.children.find(o => o.name === 'marca:1')
    expect(m1.children).toHaveLength(1)
    expect('#' + m1.children[0].material.color.getHexString().toUpperCase()).toBe(CULORI_MARCA[0].toUpperCase())
    s.armare({ ascunseMarci: new Set([cheieMarca('fundatie-f6', '1')]) })
    expect([m1.visible, pt.visible]).toEqual([false, true])
    s.armare({ ascunseMarci: new Set([cheieMarca('teava', '1')]) })        // aceeași marcă pe alt grup: fundația nu se ascunde
    expect(m1.visible).toBe(true)
    s.dispose()
  })

  it('la ieșire se eliberează fiecare geometrie și fiecare material (bare, beton, muchii, piese)', () => {
    const { s, scena } = construieste()
    const geometrii = new Set(), materiale = new Set()
    scena.traverse(o => { if (o.geometry) geometrii.add(o.geometry); if (o.material) materiale.add(o.material) })
    const eliberate = new Set()
    for (const x of [...geometrii, ...materiale]) x.addEventListener('dispose', () => { eliberate.add(x) })
    expect(geometrii.size).toBeGreaterThan(10)
    s.dispose()
    expect([...geometrii].filter(g => !eliberate.has(g))).toEqual([])
    expect([...materiale].filter(x => !eliberate.has(x))).toEqual([])
  })
})

// ── panoul de armare (randare pe server: fără DOM, fără efecte; ce vede omul sub scenă) ──
const AVERT = 'NECONFIRMATĂ DE OM'
const panou = (grup, props = {}) => renderToStaticMarkup(
  <PanouArmare parteId={grup.id} ctrl={controlArmare(grup)} cont={continutArmare(grup)} ascunse={new Set()} comuta={() => {}} culoare="marca" {...props} />)
const ecran = grup => renderToStaticMarkup(<NodSchema3D grup={grup} puncte={[]} selectatId={null} onSelect={() => {}} />)
const nrAparitii = (s, x) => s.split(x).length - 1
// F6 cu 5 bare ale mărcii 1 trecute „estimat” (poziție aleasă la scară)
const F6estimat = () => {
  const f = structuredClone(F6)
  let n = 0
  for (const e of f.grupuri[0].elemente) if (e.tip === 'bara' && String(e.marca) === '1' && n < 5) { e.cert = 'estimat'; n++ }
  return parseModel3d(f).grupuri[0]
}

describe('panoul de armare: avertismentul și starea „estimat” nu depind de ascundere, culoare sau vedere', () => {
  it('vederea grupului: avertismentul, cele 7 puncte de confirmat, controlul și nota despre greutate', () => {
    const h = ecran(F6g())
    expect(nrAparitii(h, AVERT)).toBe(1)
    expect(h).toContain('De confirmat (7)')
    expect(h).toContain('data-control-extras')
    expect(h).toContain('186,63 kg față de extras 187,00 kg')
    expect(h).toContain('convenția laturilor din extras, nu lungimea dezvoltată pe axa barei')
    expect(h).toContain('nu masa fizică exactă')
  })

  it('ascunderea unei mărci și culoarea pe diametru păstrează avertismentul, „estimate” și controlul', () => {
    const g = F6estimat()
    const baza = panou(g)
    expect(baza).toContain(AVERT)
    expect(baza).toContain('5 estimate')
    for (const props of [{ ascunse: new Set([cheieMarca(g.id, '1')]) }, { culoare: 'diametru' },
      { ascunse: new Set([cheieMarca(g.id, '1'), cheieMarca(g.id, '2'), cheieMarca(g.id, '3')]), culoare: 'diametru' }]) {
      const h = panou(g, props)
      expect(h).toContain(AVERT)
      expect(h).toContain('De confirmat (7)')
      expect(h).toContain('5 estimate')
      expect(h).toContain('data-control-extras')
      expect(h).toContain('56 / 56')
    }
    expect(panou(g, { ascunse: new Set([cheieMarca(g.id, '1')]) })).toContain('aria-pressed="false"')   // marca 1 chiar e ascunsă
  })

  it('review r2 (P2): „Toată instalația” cu fundația neconfirmată lângă alt grup = avertismentul, punctele și controlul rămân', () => {
    const inst = instalatieCuF6()
    const h = ecran(inst)
    expect(nrAparitii(h, AVERT)).toBe(1)
    expect(h).toContain('De confirmat (7)')
    expect(h).toContain('data-control-extras')
    expect(h).toContain('56 / 56')
    expect(h).toContain(F6.grupuri[0].titlu)                                // panoul spune al cărui grup e
  })

  it('vederea comună cu două grupuri cu armare: fiecare își arată starea; grupul neconfirmat păstrează avertismentul', () => {
    const f6 = structuredClone(F6)
    f6.grupuri[0].amplasare = { origine: [0, 0, 0], rot_z: 0 }
    const doi = structuredClone(f6.grupuri[0])
    Object.assign(doi, { id: 'fundatie-f7', titlu: 'Fundația F7', amplasare: { origine: [5000, 0, 0], rot_z: 0 } })
    doi.armare.stare_lista = 'confirmata'
    f6.grupuri.push(doi)
    const p = parseModel3d(f6)
    expect(p.erori).toEqual([])
    const h = ecran(instalatia(p))
    expect(nrAparitii(h, AVERT)).toBe(1)
    expect(h).toContain('Listă de armături confirmată')
    expect(nrAparitii(h, 'data-panou-armare=')).toBe(2)
    expect(h).toContain('Fundația F7')
  })

  it('vederea comună: și cu mărci estimate, avertismentul și „estimate” rămân (ascunderea grupului nu scoate panoul)', () => {
    const inst = instalatieCuF6(g => {
      let n = 0
      for (const e of g.elemente) if (e.tip === 'bara' && String(e.marca) === '1' && n < 5) { e.cert = 'estimat'; n++ }
    })
    const h = ecran(inst)
    expect(h).toContain(AVERT)
    expect(h).toContain('5 estimate')
  })

  it('model cu armare fără „extras_kg”: rândul de control scrie explicit „extras necunoscut” (nu lipsește, nu 0)', () => {
    const f = structuredClone(F6)
    delete f.grupuri[0].armare.extras_kg
    const g = parseModel3d(f).grupuri[0]
    const c = controlArmare(g)
    expect([c.extrasKg, c.diferentaProc, c.controlOk, c.greutateOk]).toEqual([null, null, null, null])
    const h = panou(g)
    expect(h).toContain('data-control-extras')
    expect(h).toContain('extras necunoscut')
    expect(h).not.toContain('kg față de extras')
    expect(h).not.toContain(' ✓')
  })

  it('review r2 (P2): o marcă din extras fără bare = totalul extrasului păstrat (56 / 76) și control INCOMPLET, nu verde', () => {
    const f = structuredClone(F6)
    f.grupuri[0].armare.marci.push({ marca: '4', d: 10, otel: 'PC52', buc: 20, lungime_mm: 1000 })
    const p = parseModel3d(f)
    expect(p.erori).toEqual(['Grupul 1 (fundatie-f6): marca 4 (Ø10) nu are nicio bară validă în model; controlul extrasului e incomplet'])
    const c = controlArmare(p.grupuri[0])
    expect([c.bucDesen, c.bucExtras, c.complet, c.controlOk]).toEqual([56, 76, false, false])
    expect(c.greutateOk).toBe(true)                                          // greutatea singură e în prag — tocmai de aceea nu ajunge
    const h = panou(p.grupuri[0])
    expect(h).toContain('56 / 76')
    expect(h).toContain('0 / 20')
    expect(h).toContain('fără bare')
    expect(h).toContain('Control INCOMPLET')
    expect(h).toContain('marca 4 (20 buc.)')
    expect(h).not.toContain(' ✓')
  })

  it('review r2 (P2): o marcă respinsă la citire intră în totalul extrasului; bucăți necitite = „+ ?”', () => {
    const f = structuredClone(F6)
    f.grupuri[0].armare.marci.push({ marca: '5', d: 2, otel: 'PC52', buc: 10, lungime_mm: 1000 })          // diametru imposibil
    f.grupuri[0].armare.marci.push({ marca: '6', d: 10, otel: 'PC52', buc: 'zece', lungime_mm: 1000 })    // bucăți necitibile
    const p = parseModel3d(f)
    expect(p.erori.join(' | ')).toMatch(/marca 4 \(5\): diametru invalid.*controlul extrasului e incomplet/)
    const c = controlArmare(p.grupuri[0])
    expect([c.bucDesen, c.bucExtras, c.bucExtrasNecunoscut, c.complet, c.controlOk]).toEqual([56, 66, true, false, false])
    const h = panou(p.grupuri[0])
    expect(h).toContain('56 / 66 + ?')
    expect(h).toContain('Control INCOMPLET')
    expect(h).toContain('marca 5, rândul 4, 10 buc.')
    expect(h).toContain('marca 6, rândul 5, bucăți necitite')
  })
})
