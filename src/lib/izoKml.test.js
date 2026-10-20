import { describe, it, expect } from 'vitest'
import {
  parseKml, clasificaNume, reparaDiacritice, haversine, lungimeLinie, compuneAx, orienteazaDupaBorne,
  proiecteaza, cumulat, calibrare, fmtKm, tronsonLaKm, ancoreDinLiniute,
} from './izoKml.js'

// Un ax drept spre est, pe paralela 44.8: 1° longitudine ≈ 78,9 km.
const LAT = 44.8
const lonLa = m => 22 + m / (Math.cos(LAT * Math.PI / 180) * Math.PI / 180 * 6371008.8)
const pct = m => [lonLa(m), LAT]
const linie = (a, b, pas = 250) => { const out = []; for (let m = a; m <= b; m += pas) out.push(pct(m)); return out }
const coord = c => c.map(([x, y]) => `${x},${y},0`).join(' ')

const KML = `<?xml version="1.0"?><kml><Document><name>Test</name>
<Style id="rosu"><LineStyle><color>ff0000ff</color></LineStyle></Style>
<StyleMap id="m_rosu"><Pair><key>normal</key><styleUrl>#rosu</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#x</styleUrl></Pair></StyleMap>
<Folder><name>ax conducta</name>
 <Placemark id="ax1"><name>kml_1</name><styleUrl>#m_rosu</styleUrl><LineString><coordinates>${coord(linie(0, 3000))}</coordinates></LineString></Placemark>
 <Placemark id="ax2"><name>kml_2</name><Style><LineStyle><color>ff00ff00</color></LineStyle></Style><LineString><coordinates>${coord(linie(2500, 6000))}</coordinates></LineString></Placemark>
</Folder>
<Folder><name>puncte</name>
 <Placemark><name>1km</name><Point><coordinates>${coord([[lonLa(1000), LAT + 0.0004]])}</coordinates></Point></Placemark>
 <Placemark><name>DJ 671E TD9</name><Point><coordinates>${coord([pct(2200)])}</coordinates></Point></Placemark>
 <Placemark><name>Robinet R 3</name><Point><coordinates>${coord([pct(4000)])}</coordinates></Point></Placemark>
 <Placemark><name>Prunis&amp;or &lt;x&gt;</name><ExtendedData><SchemaData><SimpleData name="TEXTSTRING">abc</SimpleData></SchemaData></ExtendedData><Point><coordinates>1,2</coordinates></Point></Placemark>
 <Placemark><name>OS</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coord([pct(100), pct(200), [lonLa(200), LAT + 0.001], pct(100)])}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Folder></Document></kml>`

describe('parseKml', () => {
  const el = parseKml(KML)
  it('citește elementele, calea și tipul', () => {
    expect(el.length).toBe(7)
    expect(el[0]).toMatchObject({ id: 'ax1', nume: 'kml_1', tip: 'linie', cale: 'Test / ax conducta' })
    expect(el[6].tip).toBe('poligon')
  })
  it('culoarea vine din StyleMap → Style sau din stilul inline', () => {
    expect(el[0].culoare).toBe('ff0000ff')
    expect(el[1].culoare).toBe('ff00ff00')
  })
  it('entitățile XML și ExtendedData', () => {
    expect(el[5].nume).toBe('Prunis&or <x>')
    expect(el[5].date.TEXTSTRING).toBe('abc')
  })
})

describe('clasificaNume', () => {
  it.each([
    ['49km', { clasa: 'borna', km_m: 49000 }], ['0km', { clasa: 'borna', km_m: 0 }],
    ['TD 28', { clasa: 'TD', nr: 28 }], ['DJ 671E TD9', { clasa: 'TD', nr: 9 }], ['TA 17', { clasa: 'TA', nr: 17 }],
    ['THC', { clasa: 'THC', nr: null }], ['THC12', { clasa: 'THC', nr: 12 }], ['TCF 2+TD 38', { clasa: 'TCF', nr: 2 }],
    ['CF', { clasa: 'CF' }], ['R 1', { clasa: 'robinet', nr: 1 }], ['Robinet R 7', { clasa: 'robinet', nr: 7 }],
    ['DM Jupanesti S = 2500 mp', { clasa: 'depozit' }], ['Depozit Materiale Lot 1 Balvanesti', { clasa: 'depozit' }],
    ['OS TOPLET S= 5000 mp', { clasa: 'os' }], ['Organizare de Santier Lot 1 Sisesti', { clasa: 'os' }],
    ['SPC 3', { clasa: 'SPC' }], ['qsas', { clasa: 'altul' }], ['KM 336', { clasa: 'altul' }], ['DRUM ACCES 6', { clasa: 'altul' }],
  ])('%s', (n, r) => expect(clasificaNume(n)).toEqual(r))
  it('diacriticele se repară doar la afișare', () => expect(reparaDiacritice('Pruniºor Faþa')).toBe('Prunișor Fața'))
})

describe('geometrie', () => {
  it('haversine ≈ distanța construită', () => expect(haversine(pct(0), pct(1000))).toBeCloseTo(1000, 0))
  it('compuneAx scoate suprapunerea (2500–3000 m)', () => {
    const r = compuneAx([linie(0, 3000), linie(2500, 6000)])
    expect(r.lungime_m).toBeCloseTo(6000, 0)
    expect(r.jurnal[1].taiat_m).toBeCloseTo(500, 0)
  })
  it('compuneAx întoarce linia dată invers', () => {
    expect(compuneAx([linie(0, 3000), linie(3000, 6000).reverse()]).lungime_m).toBeCloseTo(6000, 0)
  })
  it('proiecteaza: distanța pe ax, distanța laterală și latura', () => {
    const ax = linie(0, 6000)
    const st = proiecteaza(ax, [lonLa(2000), LAT + 0.0009])   // ~100 m la nord = stânga mergând spre est
    expect(st.dist).toBeCloseTo(2000, 0)
    expect(st.lateral).toBeCloseTo(100, -1)
    expect(st.latura).toBe(1)
    expect(proiecteaza(ax, [lonLa(2000), LAT - 0.0009]).latura).toBe(-1)
  })
  it('orienteazaDupaBorne întoarce axul desenat invers', () => {
    const ax = linie(0, 6000).reverse()
    const o = orienteazaDupaBorne(ax, [{ coord: pct(1000), km_m: 1000 }, { coord: pct(5000), km_m: 5000 }])
    expect(o[0][0]).toBeCloseTo(lonLa(0), 9)
  })
  it('ancoreDinLiniute ia punctul în care liniuța taie axul, nu eticheta', () => {
    const ax = linie(0, 6000)
    const tick = [[lonLa(1000), LAT - 0.001], [lonLa(1000), LAT + 0.003]]   // necentrată pe ax
    const [a] = ancoreDinLiniute([{ coord: [lonLa(1000), LAT + 0.0004], km_m: 1000 }], [tick], ax)
    expect(a.sursa_ancora).toBe('liniuta')
    expect(proiecteaza(ax, a.coord, cumulat(ax)).lateral).toBeLessThan(2)
  })
})

describe('calibrare și km', () => {
  const f = calibrare([{ dist: 0, km_m: 49000 }, { dist: 990, km_m: 50000 }, { dist: 2000, km_m: 51000 }])
  it('interpolează între ancore', () => {
    expect(f(495)).toBeCloseTo(49500, 6)
    expect(f(1495)).toBeCloseTo(50500, 6)
  })
  it('extrapolează la capete cu panta ancorelor de capăt', () => {
    expect(f(-99)).toBeCloseTo(48900, 6)
    expect(f(2101)).toBeCloseTo(51100, 6)
  })
  it('fmtKm', () => {
    expect(fmtKm(49000)).toBe('49+000')
    expect(fmtKm(5039.82)).toBe('5+040')
    expect(fmtKm(55999.6)).toBe('56+000')
    expect(fmtKm(null)).toBe('—')
  })
  it('tronsonLaKm: capătul de început e inclus, cel de sfârșit nu', () => {
    const tr = [{ cod: 'T12', km_start_m: 49000, km_end_m: 55000 }, { cod: 'T13', km_start_m: 55000, km_end_m: 60000 }]
    expect(tronsonLaKm(55000, tr)).toBe('T13')
    expect(tronsonLaKm(54999, tr)).toBe('T12')
    expect(tronsonLaKm(60000, tr)).toBe(null)
  })
  it('lungimeLinie pe o linie dreaptă', () => expect(lungimeLinie(linie(0, 3000))).toBeCloseTo(3000, 0))
})
