import { describe, it, expect } from 'vitest'
import { combinaUtilaje } from './raportUtilaje.js'

// TKT-2026-0081 (Eugen Nica, 24.07.2026): „apar masini in plus care nu mai sunt in acest santier".
// Regula dovedită de ticket: scoaterea de pe șantier ține până apare o alimentare NOUĂ.
describe('combinaUtilaje — scoaterea de pe șantier trebuie să țină', () => {
  const AZI = '2026-08-25'
  const IERI = '2026-08-24'
  const snap = (nume, active_id, o = {}) => ({ nume, active_id, cod: '', stare: 'functional', ...o })
  const alim = (active_id, marca, ultima_alimentare) => ({ active_id, marca, model: '', cod_intern: '',
    nr_inmatriculare: '', tip_categorie: 'utilaj', ore_functionare_actuale: null, km_actuali: null, ultima_alimentare })
  const nume = r => [...r.map.values()].map(u => u.nume).sort()

  it('CAZUL KIPOR: scos ieri, alimentare veche => NU revine azi', () => {
    const r = combinaUtilaje({
      prevSnapshot: [snap('EXCAVATOR', 1)],                 // KIPOR a fost scos, nu mai e în raport
      dataPrev: IERI,
      alimentari: [alim(1, 'EXCAVATOR', '2026-08-20'), alim(9, 'KIPOR KDA 35 SS', '2026-08-14')],
      azi: AZI,
    })
    expect(nume(r)).toEqual(['EXCAVATOR'])
  })
  it('o alimentare NOUĂ (după ultimul raport) îl aduce înapoi — asta e dovada', () => {
    const r = combinaUtilaje({
      prevSnapshot: [snap('EXCAVATOR', 1)], dataPrev: IERI,
      alimentari: [alim(9, 'KIPOR KDA 35 SS', AZI)], azi: AZI,
    })
    expect(nume(r)).toEqual(['EXCAVATOR', 'KIPOR KDA 35 SS'])
    expect([...r.map.values()].find(u => u.active_id === 9).alimentat).toBe(true)
  })
  it('alimentare fix în ziua ultimului raport => nu revine (managerul a văzut-o deja)', () => {
    const r = combinaUtilaje({
      prevSnapshot: [snap('EXCAVATOR', 1)], dataPrev: IERI,
      alimentari: [alim(9, 'KIPOR', IERI)], azi: AZI,
    })
    expect(nume(r)).toEqual(['EXCAVATOR'])
  })
  it('primul raport al lucrării (fără raport anterior) => se pre-completează tot', () => {
    const r = combinaUtilaje({
      prevSnapshot: null, dataPrev: null,
      alimentari: [alim(1, 'EXCAVATOR', '2026-08-14'), alim(9, 'KIPOR', '2026-08-13')], azi: AZI,
    })
    expect(nume(r)).toEqual(['EXCAVATOR', 'KIPOR'])
  })
  it('ce E în raport se îmbogățește din alimentări, oricât de veche e alimentarea', () => {
    const r = combinaUtilaje({
      prevSnapshot: [snap('EXCAVATOR', 1)], dataPrev: IERI,
      alimentari: [{ ...alim(1, 'EXCAVATOR', '2026-08-10'), ore_functionare_actuale: 4321, nr_inmatriculare: 'PH 01 ABC' }],
      azi: AZI,
    })
    const u = r.map.get('a1')
    expect(u.ore).toBe(4321); expect(u.inmatriculare).toBe('PH 01 ABC')
    expect(u.ultima_alimentare).toBe('2026-08-10'); expect(u.alimentat).toBe(false)
  })
  it('starea de defect se moștenește, nu se resetează (regresia din 04.08.2026)', () => {
    const r = combinaUtilaje({
      prevSnapshot: [snap('BULDO', 1, { stare: 'nefunctional', motiv: 'pompă spartă' })],
      dataPrev: IERI, alimentari: [], azi: AZI,
    })
    expect(r.map.get('a1').stare).toBe('nefunctional')
    expect(r.map.get('a1').motiv).toBe('pompă spartă')
  })
  it('utilajul adăugat manual (fără active_id) rămâne prin carry-forward', () => {
    const r = combinaUtilaje({
      prevSnapshot: [{ nume: 'Pompă împrumutată', active_id: null, cod: '' }],
      dataPrev: IERI, alimentari: [], azi: AZI,
    })
    expect(r.map.get('cpompă împrumutată').manual).toBe(true)
  })
  it('dinAlimentariRecente conține tot ce a alimentat, inclusiv ce nu s-a readăugat', () => {
    const r = combinaUtilaje({
      prevSnapshot: [], dataPrev: IERI, alimentari: [alim(9, 'KIPOR', '2026-08-14')], azi: AZI,
    })
    expect(r.dinAlimentariRecente.has(9)).toBe(true)
    expect(r.map.size).toBe(0)
  })
})
