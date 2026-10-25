import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeazaVin, vinMascat, vechimeCitire, ziBucuresti, formatData,
  kmPeIntervale, sumaKm, consumLa100, formatKm, formatProcent } from './bmwCardataLogica.js'

const mock = vi.hoisted(() => ({ stare: null, efect: null, cereri: [], eroare: false }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual,
    useState: initial => actual.useState(initial && typeof initial === 'object' && 'citiri' in initial && mock.stare ? mock.stare : initial),
    useEffect: fn => { mock.efect = fn },
  }
})
vi.mock('./lib/supabase.js', () => ({ supabase: { from: tabel => {
  const cerere = { tabel }
  mock.cereri.push(cerere)
  const q = {
    select: campuri => { cerere.campuri = campuri; return q },
    eq: (camp, valoare) => { cerere.filtru = [camp, valoare]; return q },
    order: (camp, optiuni) => { cerere.ordine = [camp, optiuni]; return q },
    limit: limita => { cerere.limita = limita; return Promise.resolve({ data: [], error: mock.eroare ? { message: 'offline' } : null }) },
  }
  return q
} } }))
import BmwCardataCard from './BmwCardataCard.jsx'

const VIN = 'WBA12345678912345'
const citiri = [144391, 144406, 144437, 144477.9, 144516].map((km, i) => ({
  citit_la: `2026-10-${19 + i}T03:10:00Z`, vin: VIN, odometru_km: km,
  combustibil_pct: [69, 68, 66, 64, 62][i], soc_pct: [74, 100, 100, 100, 100][i],
}))
const G = { muted: '#8B949E', blue: '#58A6FF', orange: '#F0883E', green: '#3FB950', yellow: '#D29922', yellowDim: '#3A2A0A', border: '#21262D', border2: '#30363D' }
const S = { card: {}, btnS: {} }
function render(stare, serieSasiu = VIN) {
  mock.stare = { vin: VIN, citiri: [], comparatie: [], eroare: false, incarcare: false, ...stare }
  return renderToStaticMarkup(React.createElement(BmwCardataCard, { serieSasiu, G, S }))
}

describe('BMW CarData - logica', () => {
  it('normalizeaza VIN si arata numai ultimele sase caractere', () => {
    expect(normalizeazaVin(`  ${VIN.toLowerCase()}  `)).toBe(VIN)
    expect(vinMascat(VIN)).toBe('******912345')
    expect(normalizeazaVin(null)).toBe('')
    expect(vinMascat(null)).toBe('')
  })
  it('reproduce seria reala fara sa modifice ordinea originala', () => {
    const invers = [...citiri].reverse()
    const intervale = kmPeIntervale(invers)
    expect(intervale.map(i => i.km)).toEqual([15, 31, 40.9, 38.1])
    expect(intervale.map(i => i.zile)).toEqual([1, 1, 1, 1])
    expect(invers[0]).toBe(citiri[4])
    expect(sumaKm(intervale, 7, '2026-10-25T03:10:00Z')).toBe(125)
  })
  it('nu inventeaza citiri in zilele lipsa', () => {
    const intervale = kmPeIntervale([citiri[1], citiri[4]])
    expect(intervale).toHaveLength(1)
    expect(intervale[0]).toMatchObject({ zile: 3, km: 110, km_pe_zi: 110 / 3 })
  })
  it('marcheaza si exclude kilometrajul descrescator', () => {
    const intervale = kmPeIntervale([citiri[1], { ...citiri[2], odometru_km: 140000 }])
    expect(intervale[0]).toMatchObject({ anomalie: true, km: null, km_pe_zi: null })
    expect(sumaKm(intervale, 30, '2026-10-25')).toBe(0)
    expect(consumLa100(intervale)).toBeNull()
  })
  it('nu transforma lipsa kilometrilor in zero si nu imparte la zero in aceeasi zi', () => {
    expect(kmPeIntervale([citiri[0], { ...citiri[1], odometru_km: null }])[0].km).toBeNull()
    expect(kmPeIntervale([citiri[0], { ...citiri[1], citit_la: '2026-10-19T10:00:00Z' }])[0].km_pe_zi).toBeNull()
    expect(kmPeIntervale([])).toEqual([])
    expect(kmPeIntervale([{ citit_la: 'invalid' }])).toEqual([])
  })
  it('nu numara din nou kilometrii la revenirea dupa o scadere', () => {
    const intervale = kmPeIntervale(citiri.map((c, i) => ({ ...c, odometru_km: [100, 90, 110, 120, 130][i] })))
    expect(intervale.map(i => i.anomalie)).toEqual([true, true, false, false])
    expect(sumaKm(intervale, 30, '2026-10-25')).toBe(20)
  })
  it('foloseste zile calendaristice Bucuresti inclusiv la schimbarea orei', () => {
    const intervale = kmPeIntervale([
      { citit_la: '2026-10-24T03:10:00Z', odometru_km: 100 },
      { citit_la: '2026-10-25T04:10:00Z', odometru_km: 120 },
    ])
    expect(intervale[0].zile).toBe(1)
    expect(ziBucuresti('2026-10-20T22:30:00Z')).toBe('2026-10-21')
    expect(formatData('2026-10-20T22:30:00Z')).toContain('21.10.2026')
  })
  it('calculeaza pragul de 36 ore exact', () => {
    const acum = new Date('2026-10-25T10:00:00Z')
    expect(vechimeCitire(new Date(acum - 40 * 3600000), acum)).toMatchObject({ ore: 40, eVeche: true, text: 'acum 1 zi' })
    expect(vechimeCitire(new Date(acum - 5 * 3600000), acum)).toMatchObject({ ore: 5, eVeche: false, text: 'acum 5 ore' })
    expect(vechimeCitire(new Date(acum - 36 * 3600000), acum).eVeche).toBe(false)
  })
  it('include numai intervale complete de 7/30 zile, fara date din viitor', () => {
    const acum = '2026-10-25T03:10:00Z'
    const intervale = kmPeIntervale([
      { ...citiri[0], citit_la: '2026-09-24T03:10:00Z' },
      ...citiri,
      { ...citiri[4], citit_la: '2026-10-26T03:10:00Z', odometru_km: 145000 },
    ])
    expect(sumaKm(intervale, 30, acum)).toBe(125)
    expect(sumaKm(intervale, 7, acum)).toBe(125)
    expect(sumaKm(intervale, 2, acum)).toBe(0)
  })
  it('nu estimeaza consumul din procente sau din scaderea rezervorului', () => {
    expect(consumLa100(kmPeIntervale(citiri))).toBeNull()
    expect(consumLa100(kmPeIntervale(citiri.map((c, i) => ({ ...c, combustibil_litri: 50 - i }))))).toBeNull()
    expect(consumLa100([])).toBeNull()
  })
  it('calculeaza consum ponderat doar pe intervale cu OBFCM valid', () => {
    const date = citiri.map((c, i) => ({ ...c, obfcm_combustibil_l: [10, 11, 13, 16, 18][i], obfcm_distanta_km: [100, 115, 146, 186.9, 225][i] }))
    expect(consumLa100(kmPeIntervale(date))).toBeCloseTo(6.4)
    expect(consumLa100([{ km: 0, litri: 3 }])).toBeNull()
    expect(consumLa100(kmPeIntervale([date[0], { ...date[1], obfcm_combustibil_l: 2 }]))).toBeNull()
    expect(consumLa100([{ km: 100, litri: 5 }, { km: 200, litri: null }])).toBe(5)
  })
  it('formateaza romaneste si ascunde null', () => {
    expect(formatKm(144477.9)).toBe('144.477,9')
    expect(formatProcent('62.0')).toBe('62%')
    expect(formatProcent(0)).toBe('0%')
    expect(formatKm(null)).toBe('')
    expect(formatProcent(null)).toBe('')
  })
})

describe('BMW CarData - componenta fara browser', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  it('nu afiseaza nimic fara VIN sau citiri', () => {
    expect(render({})).toBe('')
    expect(render({ citiri }, '')).toBe('')
    expect(render({ citiri, vin: 'VECHI' })).toBe('')
  })
  it('ascunde null, comparatia goala si VIN complet; arata datele si bannerul', () => {
    const html = render({ citiri: [...citiri].reverse() }, ` ${VIN.toLowerCase()} `)
    expect(html).toContain('BMW CarData')
    expect(html).toContain('144.516 km')
    expect(html).toContain('******912345')
    expect(html).not.toContain(VIN)
    expect(html).not.toContain('Autonomie')
    expect(html).not.toContain('Consum mediu')
    expect(html).not.toContain('Comparatie cu EvoGPS')
    expect(html).toContain('Ultima citire BMW e veche')
    expect(html).toContain('Locatia nu se afiseaza.')
  })
  it('afiseaza comparatia numai pentru km EvoGPS nenul, inclusiv zero', () => {
    expect(render({ citiri, comparatie: [{ zi: '2026-10-23', km_evogps_interval: null }] })).not.toContain('Comparatie cu EvoGPS')
    expect(render({ citiri, comparatie: [{ zi: '2026-10-23', km_evogps_interval: 0 }] })).toContain('Comparatie cu EvoGPS')
  })
  it('afiseaza discret esecul, fara cartela goala', () => {
    const html = render({ eroare: true })
    expect(html).toContain('Date BMW indisponibile acum')
    expect(html).not.toContain('<section')
  })
  it('porneste pliata sub 700px', () => {
    vi.stubGlobal('window', { innerWidth: 699 })
    try {
      const html = render({ citiri })
      expect(html).toContain('aria-expanded="false"')
      expect(html).not.toContain('<svg')
    } finally { vi.unstubAllGlobals() }
  })
  it('graficul nu uneste zilele lipsa si nu produce avertismente React', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const html = render({ citiri: [citiri[4], citiri[1]] })
      expect((html.match(/<rect /g) || []).length).toBe(1)
      expect((html.match(/<circle /g) || []).length).toBe(4)
      expect((html.match(/<line /g) || []).length).toBe(2)
      expect(error).not.toHaveBeenCalled()
    } finally { error.mockRestore() }
  })
  it('cere doar tabelul si view-ul cu VIN normalizat, ordine si limita 60', async () => {
    mock.cereri = []
    render({}, ` ${VIN.toLowerCase()} `)
    const cleanup = mock.efect()
    await new Promise(resolve => setTimeout(resolve, 0))
    cleanup()
    expect(mock.cereri.map(c => c.tabel)).toEqual(['bmw_cardata_citiri', 'v_bmw_cardata_vs_evogps'])
    for (const c of mock.cereri) {
      expect(c.filtru).toEqual(['vin', VIN])
      expect(c.limita).toBe(60)
      expect(c.ordine[1]).toEqual({ ascending: false })
      expect(c.campuri).not.toMatch(/locati|brut|\*/)
    }
  })
  it('logheaza esecurile fara payload extern', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.eroare = true
    render({})
    const cleanup = mock.efect()
    await new Promise(resolve => setTimeout(resolve, 0))
    cleanup()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
    mock.eroare = false
  })
})
