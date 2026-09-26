// R5 (Copilot 25.09.2026): „Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta
// aprobată." Fixture = rândurile REALE 1751–1756 ale lic. 95 (SELECT pe ofertare_cantitati, 25.09.2026 22:3x).
import { describe, it, expect } from 'vitest'
import { esteAprobata, randuriFront, controlCantitatiGrafic, fronturiDinCantitati, campuriCantitatiNevalidate } from './ofertareCantitatiAprobare.js'

const SURSA = 'Planșa 1 — tabel de dimensionare, citit automat din scanare'
const r = (id, dn, m, extra = {}) => ({ id, obiect: null, categorie: 'Conducte și montaj', denumire: `Conductă distribuție gaze Dn${dn}`, um: 'm', cantitate: m, cantitate_plansa: m, status: 'extras', tip_sursa: null, sursa: SURSA, ...extra })
const LIC95 = [r(1751, 200, 17785), r(1752, 125, 2275), r(1753, 110, 780), r(1754, 90, 4545), r(1755, 63, 9670), r(1756, 40, 13140)]
const valideaza = (rows, ids = null) => rows.map(x => (!ids || ids.includes(x.id)) ? { ...x, status: 'validat' } : x)

describe('esteAprobata — doar bifa unui om', () => {
  it('validat = aprobat; extras / diferenta / revizuit_clarificare / fara status = nu', () => {
    expect(esteAprobata({ status: 'validat' })).toBe(true)
    for (const s of ['extras', 'diferenta', 'revizuit_clarificare', undefined, null, 'VALIDAT']) expect(esteAprobata({ status: s })).toBe(false)
    expect(esteAprobata(null)).toBe(false)
  })
})

describe('randuriFront — mutat neschimbat din GraficPoarta', () => {
  it('lic. 95: cele 6 randuri de conducta sunt fronturi (Σ 48.195 m)', () => {
    const f = randuriFront(LIC95)
    expect(f.map(x => x.id)).toEqual([1751, 1752, 1753, 1754, 1755, 1756])
    expect(f.reduce((s, x) => s + x.cantitate, 0)).toBe(48195)
  })
  it('titlurile de sectiune castiga si nu se amesteca cu articolele de deviz (Domnesti)', () => {
    const rows = [{ um: 'm', categorie: 'TITLU SECȚIUNE', denumire: 'Extindere rețele - Făgului', cantitate: 500 }, { um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE', cantitate: 3500 }]
    expect(randuriFront(rows)).toHaveLength(1)
  })
  it('randurile „total" si cele fara metri nu sunt fronturi; baza planse ia cantitate_plansa', () => {
    const rows = [{ um: 'm', obiect: 'TOTAL', categorie: 'Conducte', cantitate: 9 }, { um: 'buc', categorie: 'Conducte', cantitate: 5 },
      { um: 'm', categorie: 'Conducte', cantitate: null, cantitate_plansa: 70 }]
    expect(randuriFront(rows)).toHaveLength(0) // baza 'cantitate': rândul cu cantitate NULL nu e front
    expect(randuriFront(rows, 'cantitate_plansa')).toHaveLength(1)
  })
})

describe('controlCantitatiGrafic — randul „cant" din poarta graficului', () => {
  it('lic. 95 azi (6 × extras): BLOCK, nu „ok" — 48.195 m nevalidati, inclusiv Dn200 17.785 m', () => {
    const c = controlCantitatiGrafic(LIC95, '')
    expect(c.stare).toBe('block')
    expect(c.nevalidate.map(x => x.id)).toEqual([1751, 1752, 1753, 1754, 1755, 1756])
    expect(c.m_nevalidate).toBe(48195)
    expect(c.detalii).toMatch(/6 din 6 rânduri de rețea NEVALIDATE \(48.195 m/)
  })
  it('un singur rand nevalidat (1751) tine poarta inchisa chiar daca restul sunt validate', () => {
    const c = controlCantitatiGrafic(valideaza(LIC95, [1752, 1753, 1754, 1755, 1756]), 'memoriu')
    expect(c.stare).toBe('block'); expect(c.nevalidate.map(x => x.id)).toEqual([1751]); expect(c.m_nevalidate).toBe(17785)
  })
  it('regula veche „diferenta + baza aleasa = warn" nu mai trece: diferenta nevalidata = block', () => {
    const rows = [r(1, 110, 1000, { status: 'diferenta', cantitate_plansa: 1200 })]
    expect(controlCantitatiGrafic(rows, 'plansa').stare).toBe('block')
    expect(controlCantitatiGrafic(rows, '').detalii).toMatch(/alege și baza/)
  })
  it('toate validate => ok; totalul declarat nevalidat e etichetat', () => {
    const rows = [...valideaza(LIC95), { id: 9, obiect: 'Total rețea', um: 'm', categorie: 'Conducte', denumire: 'Total', cantitate: 48195, status: 'extras' }]
    const c = controlCantitatiGrafic(rows, '')
    expect(c.stare).toBe('ok'); expect(c.detalii).toMatch(/toate validate, total declarat 48.195 m \(nevalidat\)/)
  })
  it('fara randuri de retea => block (neschimbat)', () =>
    expect(controlCantitatiGrafic([], '').stare).toBe('block'))
})

describe('fronturiDinCantitati — „Propune din cantitati" doar din randuri validate', () => {
  it('lic. 95 azi: niciun front propus, 6 randuri excluse (48.195 m)', () => {
    const { fronturi, excluse, m_excluse } = fronturiDinCantitati(LIC95, '')
    expect(fronturi).toEqual([]); expect(excluse).toHaveLength(6); expect(m_excluse).toBe(48195)
  })
  it('dupa validarea lui 1752–1756: 5 fronturi (30.410 m), Dn200 17.785 m ramane pe dinafara', () => {
    const { fronturi, excluse } = fronturiDinCantitati(valideaza(LIC95, [1752, 1753, 1754, 1755, 1756]), '')
    expect(fronturi.map(f => f.dn)).toEqual(['125', '110', '90', '63', '40'])
    expect(fronturi.reduce((s, f) => s + f.lungime_m, 0)).toBe(30410)
    expect(excluse.map(x => x.id)).toEqual([1751])
  })
  it('maparea numelui/lungimii/Dn e cea veche', () => {
    const rows = [{ id: 1, um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn110 — Făgului', cantitate: 512.4, status: 'validat' }]
    expect(fronturiDinCantitati(rows, '').fronturi).toEqual([{ nume: 'Făgului', lungime_m: 512, dn: '110', echipe: 1 }])
  })
})

describe('campuriCantitatiNevalidate — view lipsa ≠ zero', () => {
  it('eroare (view neaplicat) => niciun camp (H2 va spune „nu putem verifica")', () => {
    expect(campuriCantitatiNevalidate({ error: { message: 'relation does not exist' }, data: null })).toEqual({})
    expect(campuriCantitatiNevalidate(null)).toEqual({})
  })
  it('rand lipsa (licitatia n-are randuri de retea) => 0', () =>
    expect(campuriCantitatiNevalidate({ data: null, error: null }).lista_f3_nevalidate).toBe(0))
  it('valorile din view trec numerice', () => {
    const c = campuriCantitatiNevalidate({ data: { lista_f3_nevalidate: '47', lista_f3_nevalidate_m: '6520', plansa_nevalidate: 20 }, error: null })
    expect(c).toEqual({ lista_f3_nevalidate: 47, lista_f3_nevalidate_m: 6520, lista_c6_nevalidate: 0, memoriu_nevalidate: 0, plansa_nevalidate: 20 })
  })
})
