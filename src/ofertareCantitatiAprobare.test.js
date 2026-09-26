// R5 (Copilot 25.09.2026): „Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta
// aprobată." Fixture = rândurile REALE 1751–1756 ale lic. 95 (SELECT pe ofertare_cantitati, 25.09.2026 22:3x).
import { describe, it, expect } from 'vitest'
import { esteAprobata, randuriFront, controlCantitatiGrafic, fronturiDinCantitati, controlFronturiGrafic, campuriCantitatiNevalidate } from './ofertareCantitatiAprobare.js'

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
  it('maparea numelui/lungimii/Dn e cea veche; runda 4: + proveniența (rândul-sursă, baza, cifra la propunere)', () => {
    const rows = [{ id: 1, um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn110 — Făgului', cantitate: 512.4, cantitate_plansa: 530, status: 'validat' }]
    expect(fronturiDinCantitati(rows, '').fronturi).toEqual([{ nume: 'Făgului', lungime_m: 512, dn: '110', echipe: 1, cantitate_id: 1, baza: 'cantitate', lungime_sursa: 512.4 }])
    expect(fronturiDinCantitati(rows, 'plansa').fronturi[0]).toMatchObject({ lungime_m: 530, baza: 'cantitate_plansa', lungime_sursa: 530 })
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

// ════════════════════════════════════════════════════════════════
// R5 runda 4 (verificator R3): rândul „front" — referința și proveniența fronturilor salvate
// ════════════════════════════════════════════════════════════════
const P = (fronturi, baza = '') => ({ cantitati_asumate: baza, fronturi })
describe('controlFronturiGrafic — referința doar din total VALIDAT (ADV6)', () => {
  const rete = [r(1, 110, 1000, { status: 'validat' })]
  const fr = fronturiDinCantitati(rete, '').fronturi
  it('total declarat NEVALIDAT (50.000 m) nu mai e referința: ref = rețeaua validată (1.000) => ok, nu „2% din rețea"', () => {
    const c = controlFronturiGrafic(P(fr), [...rete, { id: 2, obiect: 'Total rețea', um: 'm', categorie: 'Conducte', denumire: 'Total', cantitate: 50000, status: 'extras' }])
    expect(c.ref).toBe(1000); expect(c.totalAprobat).toBe(false); expect(c.stare).toBe('ok')
    expect(c.detalii).toMatch(/100% din rețeaua validată; totalul declarat e nevalidat, nu e referință/)
  })
  it('total declarat VALIDAT e referința (deviere > 10% => warn)', () => {
    const c = controlFronturiGrafic(P(fr), [...rete, { id: 2, obiect: 'Total rețea', um: 'm', categorie: 'Conducte', denumire: 'Total', cantitate: 5000, status: 'validat' }])
    expect(c.ref).toBe(5000); expect(c.stare).toBe('warn'); expect(c.detalii).toMatch(/20% din totalul declarat \(validat\)/)
  })
  it('rânduri de rețea nevalidate nu intră în referință', () => {
    const c = controlFronturiGrafic(P(fr), [...rete, r(3, 90, 4000)])
    expect(c.ref).toBe(1000)
  })
})
describe('controlFronturiGrafic — fronturile SALVATE trebuie să vină din rânduri validate cu cifra de acum', () => {
  // lic. 3, grafic_parametri (SELECT 26.09.2026): 6 fronturi / 29.985 m, salvate 04.09 pe baza „planșe", fără legătură cu rândurile
  const LIC3_FR = [['Oltenița racord + Ulmeni (magistrală)', 6200, '250'], ['Spanțov', 8015, '250'], ['Chiselet', 6255, '250'],
    ['Mânăstirea + DJ303', 3165, '250'], ['Mânăstirea → Coconi (extravilan)', 1100, '180'], ['Coconi + Sultana', 5250, '160']].map(([nume, lungime_m, dn]) => ({ nume, lungime_m, dn, echipe: 1 }))
  const LIC3_R = [
    { id: 1, status: 'validat', um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn250 — tronsoane magistrală', cantitate: 23630, cantitate_plansa: 34465 },
    { id: 2, status: 'validat', um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn180 — extravilan', cantitate: 1100, cantitate_plansa: 2210 },
    { id: 3, status: 'validat', um: 'm', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn160 — Coconi + Sultana', cantitate: 5250, cantitate_plansa: 5245 }]
  it('lic. 3 real: 6 fronturi salvate înainte de R5, fără legătură => BLOCK chiar cu toate rândurile validate (înainte: doar warn)', () => {
    const c = controlFronturiGrafic(P(LIC3_FR, 'plansa'), LIC3_R)
    expect(c.stare).toBe('block'); expect(c.probleme).toHaveLength(6)
    expect(c.detalii).toMatch(/^6 din 6 fronturi nu vin din cantități validate cu cifra de acum — apasă „Propune din cantități"/)
  })
  it('aceleași fronturi marcate manual (decizia omului) => trec, numărate în detalii', () => {
    const c = controlFronturiGrafic(P(LIC3_FR.map(f => ({ ...f, manual: true })), 'plansa'), LIC3_R)
    expect(c.stare).not.toBe('block'); expect(c.detalii).toMatch(/6 introduse manual/)
  })
  it('re-propuse din rândurile validate => ok; rândul-sursă redeschis (↩) => BLOCK', () => {
    const fr = fronturiDinCantitati(LIC3_R, 'plansa').fronturi
    expect(controlFronturiGrafic(P(fr, 'plansa'), LIC3_R).stare).toBe('ok')
    const c = controlFronturiGrafic(P(fr, 'plansa'), LIC3_R.map(x => x.id === 2 ? { ...x, status: 'diferenta' } : x))
    expect(c.stare).toBe('block'); expect(c.detalii).toMatch(/rândul-sursă #2 nu e validat \(diferenta\)/)
  })
  it('cifra rândului-sursă s-a schimbat de la propunere (revalidat pe altă cifră) => BLOCK', () => {
    const fr = fronturiDinCantitati(LIC3_R, 'plansa').fronturi
    const c = controlFronturiGrafic(P(fr, 'plansa'), LIC3_R.map(x => x.id === 2 ? { ...x, cantitate_plansa: 2600 } : x))
    expect(c.stare).toBe('block'); expect(c.detalii).toMatch(/#2 s-a schimbat de la propunere \(2\.210 → 2\.600 m\)/)
  })
  it('baza schimbată după propunere (planșe → memoriu) => BLOCK; rând-sursă șters => BLOCK', () => {
    const fr = fronturiDinCantitati(LIC3_R, 'plansa').fronturi
    expect(controlFronturiGrafic(P(fr, 'memoriu'), LIC3_R).detalii).toMatch(/propus pe altă bază \(planșe\)/)
    expect(controlFronturiGrafic(P(fr, 'plansa'), LIC3_R.filter(x => x.id !== 3)).detalii).toMatch(/#3 nu mai există/)
  })
  it('lungimea editată de om pe un front propus (rândul neschimbat) => nu blochează', () => {
    const fr = fronturiDinCantitati(LIC3_R, '').fronturi.map(f => f.cantitate_id === 1 ? { ...f, lungime_m: 20000 } : f)
    expect(controlFronturiGrafic(P(fr), LIC3_R).stare).not.toBe('block')
  })
  it('fără fronturi => block (neschimbat)', () => expect(controlFronturiGrafic(P([]), LIC3_R).stare).toBe('block'))
})
