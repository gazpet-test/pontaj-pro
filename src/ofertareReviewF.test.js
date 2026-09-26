import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { controlSursaAprobareFinala, CONTOARE_BLOCANTE_CANTITATI } from './ofertarePoarta.js'
import { COLOANE_GRAFIC_REVERIFICARE } from './ofertareGraficReverificare.js'
import { controlTotaluri } from './ofertareTotaluri.js'
import { aplicaRegulaAprobare } from './ofertareCantitatiInvalidare.js'
import { cazuriUnitatiF2 } from './ofertareInvalidareUnitati.cazuri.js'
import { fronturiDinCantitati, controlFronturiGrafic, reverificareGraficInghetat, mesajPropuneFronturi } from './ofertareCantitatiAprobare.js'

const st = { ...Object.fromEntries(CONTOARE_BLOCANTE_CANTITATI.map(k => [k, 0])),
  totaluri_control: [], unitati_de_verificat: 0, transfer_conflicte_docs: 0, transfer_in_curs: 0 }
const rand = (id, denumire, cantitate = 100, extra = {}) => ({ id, licitatie_id: 5, denumire, cantitate,
  obiect: 'Lot A', categorie: 'Conducte', tip_sursa: 'lista_f3', sursa: 'F3', um: 'm', status: 'validat', ...extra })

describe('F01 — poarta finală reflectă blocajele cantităților', () => {
  it.each(CONTOARE_BLOCANTE_CANTITATI)('%s blochează chiar fără conflicte de transfer', k => {
    const r = controlSursaAprobareFinala({ ...st, [k]: 2 })
    expect(r.stare).toBe('block')
    expect(r.detalii).toContain(`${k} = 2`)
  })
  it('zero permite; date lipsă rămân indisponibile', () => {
    expect(controlSursaAprobareFinala(st).stare).toBe('ok')
    expect(controlSursaAprobareFinala({ ...st, total_invalidate: undefined }).stare).toBe('block')
  })
})

describe('F09 — proiecția folosită efectiv de loader', () => {
  const coloane = COLOANE_GRAFIC_REVERIFICARE.split(',').map(s => s.trim())
  const proiecteaza = r => Object.fromEntries(coloane.map(k => [k, r[k]]))
  it('loaderul folosește constanta; contractul cuprinde perimetrul și atributele', () => {
    const loader = readFileSync(new URL('./OfertarePropunere.jsx', import.meta.url), 'utf8')
    expect(loader).toContain("from('ofertare_cantitati').select(COLOANE_GRAFIC_REVERIFICARE)")
    for (const k of ['id', 'licitatie_id', 'obiect', 'categorie', 'tip_sursa', 'sursa', 'denumire', 'um',
      'cantitate', 'cantitate_plansa', 'status', 'diferenta_nota']) expect(coloane).toContain(k)
  })
  it('TOTAL comparabil rămâne ok după SELECT; alt tip_sursa nu se adună', () => {
    const r = [rand(1, 'Conductă DN1000'), rand(2, 'TOTAL', 100), rand(3, 'Conductă DN63', 400, { tip_sursa: 'memoriu' })]
    const p = r.map(proiecteaza)
    expect(controlTotaluri(p)).toEqual(controlTotaluri(r))
    expect(controlTotaluri(p)[0].stare).toBe('ok')
    const parametri = { fronturi: fronturiDinCantitati(r).fronturi }
    expect(reverificareGraficInghetat(parametri, p)).toEqual(reverificareGraficInghetat(parametri, r))
    expect(reverificareGraficInghetat(parametri, p).grafic_de_reverificat).toBe(0)
    expect(controlTotaluri(p.map(({ tip_sursa, ...rest }) => rest))[0].stare).toBe('necomparabil')
  })
})

describe('F10 — Dn nu se trunchiază', () => {
  it.each([['De914,4×7,1', '914,4', 'De'], ['De60.3', '60.3', 'De'], ['De110', '110', 'De'], ['DN60.3', '60.3', 'DN']])(
    '%s păstrează valoarea și notația; modelul nesuportat cere verificare', (notatie, valoare, tip) => {
      const r = [rand(57, `Conductă ${notatie}`)]
      const rezultat = fronturiDinCantitati(r)
      expect(rezultat.fronturi[0].dn).toBe(valoare)
      expect(rezultat.fronturi[0].dn_tip).toBe(tip)
      expect(mesajPropuneFronturi(rezultat).text).toContain('de verificat')
      expect(mesajPropuneFronturi(rezultat).text).toContain(`${tip}${valoare}`)
      expect(controlFronturiGrafic({ fronturi: rezultat.fronturi }, r).stare).toBe('block')
      // Și fronturile istorice trunchiate, inclusiv cele cu denumire_sursa, rămân blocate.
      expect(controlFronturiGrafic({ fronturi: [{ ...rezultat.fronturi[0], dn: String(parseInt(valoare, 10)) }] }, r).stare).toBe('block')
      expect(reverificareGraficInghetat({ fronturi: rezultat.fronturi }, r).grafic_de_reverificat).toBeGreaterThan(0)
    })
  it('DN1000 se păstrează, iar un front vechi DN100 cere reverificare', () => {
    const r = [rand(57, 'Conductă DN1000')]
    const f = fronturiDinCantitati(r).fronturi[0]
    expect(f.dn).toBe('1000')
    const { denumire_sursa, obiect_sursa, ...vechi } = f
    expect(controlFronturiGrafic({ fronturi: [{ ...vechi, dn: '100' }] }, r).stare).toBe('block')
    expect(controlFronturiGrafic({ fronturi: [f] }, r).stare).toBe('ok')
    expect(fronturiDinCantitati([rand(58, 'Conductă DN1000mm')]).fronturi[0].dn).toBe('1000')
  })
  it.each(['9', '10000', '123456'])('tokenul nesuportat %s se păstrează și se semnalează', dn => {
    const r = [rand(57, `Conductă DN${dn}`)]
    const f = fronturiDinCantitati(r)
    expect(f.fronturi[0].dn).toBe(dn)
    expect(mesajPropuneFronturi(f).text).toContain('nesuportat')
    expect(controlFronturiGrafic({ fronturi: f.fronturi }, r).stare).toBe('block')
  })
})

describe('U runda 2 — observația efectivă și referința în metri', () => {
  it.each(cazuriUnitatiF2)('$nume', ({ vechi, patch, referinta, invalidat }) => {
    const r = aplicaRegulaAprobare(vechi, patch, referinta)
    expect(r.invalidat).toBe(invalidat)
    expect({ ...vechi, ...r.patch }.status).toBe(invalidat ? 'diferenta' : 'validat')
  })
  it('regula UI și regula workerului sunt identice octet cu octet', () => {
    expect(readFileSync(new URL('../supabase/functions/ofertare-plansa-citeste/invalidare.js', import.meta.url), 'utf8'))
      .toBe(readFileSync(new URL('./ofertareCantitatiInvalidare.js', import.meta.url), 'utf8'))
  })
})

// Contractul unităților (întrebarea din review-ul Copilot): cantitate_plansa e în metri — fără a doua conversie.
import { inMetri as inMetriU } from './ofertareUnitati.js'
import { controlTotaluri as controlTotaluriU } from './ofertareTotaluri.js'
describe('unități: cantitate în unitatea rândului, cantitate_plansa în metri', () => {
  it('km: cantitate 1 → 1000 m; cantitate_plansa 1000 → 1000 m (nu 1.000.000)', () => {
    const r = { um: 'km', cantitate: 1, cantitate_plansa: 1000 }
    expect(inMetriU(r)).toBe(1000)
    expect(inMetriU(r, 'cantitate_plansa')).toBe(1000)
  })
  it('controlTotaluri pe baza planșei nu reaplică factorul km', () => {
    const b = { licitatie_id: 1, obiect: 'Lot A', categorie: 'Conducte', tip_sursa: 'lista_f3', sursa: 'Doc 8', status: 'validat' }
    const [t] = controlTotaluriU([
      { ...b, id: 1, denumire: 'TOTAL', um: 'km', cantitate: 1.2, cantitate_plansa: 1200 },
      { ...b, id: 2, denumire: 'Tronson A', um: 'km', cantitate: 1, cantitate_plansa: 1000 },
      { ...b, id: 3, denumire: 'Tronson B', um: 'm', cantitate: 200, cantitate_plansa: 200 },
    ], 'cantitate_plansa')
    expect(t.stare).toBe('ok')
    expect(t.declarat).toBe(1200)
  })
})
