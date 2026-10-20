import { describe, it, expect } from 'vitest'
import {
  parseKml, clasificaNume, reparaDiacritice, haversine, lungimeLinie, compuneAx, orienteazaDupaBorne,
  proiecteaza, cumulat, calibrare, fmtKm, tronsonLaKm, ancoreDinLiniute, centroid, pozitieElement, EroareKml,
} from './izoKml.js'

// Un ax drept spre est, pe paralela 44.8: 1° longitudine ≈ 78,9 km.
const LAT = 44.8
const lonLa = m => 22 + m / (Math.cos(LAT * Math.PI / 180) * Math.PI / 180 * 6371008.8)
const pct = m => [lonLa(m), LAT]
const linie = (a, b, pas = 250) => { const out = []; for (let m = a; m < b; m += pas) out.push(pct(m)); out.push(pct(b)); return out }
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
  it('tronsonLaKm: capătul de început e inclus, cel de sfârșit nu (cu excepția ultimului tronson)', () => {
    const tr = [{ cod: 'T12', km_start_m: 49000, km_end_m: 55000 }, { cod: 'T13', km_start_m: 55000, km_end_m: 60000 }]
    expect(tronsonLaKm(55000, tr)).toBe('T13')
    expect(tronsonLaKm(54999, tr)).toBe('T12')
    expect(tronsonLaKm(60000, tr)).toBe('T13')
    expect(tronsonLaKm(48999, tr)).toBe(null)
  })
  it('lungimeLinie pe o linie dreaptă', () => expect(lungimeLinie(linie(0, 3000))).toBeCloseTo(3000, 0))
})

// ─── review r1 (#803): fail-closed și cazurile de margine ───────────────────
const codEroare = fn => { try { fn(); return null } catch (e) { return e instanceof EroareKml ? e.cod : `altă eroare: ${e.message}` } }

describe('parseKml — structură stricată (fail-closed)', () => {
  it('<Placemark> neînchis aruncă, nu se blochează', () => {
    expect(codEroare(() => parseKml('<kml><Document><Placemark><name>x</name><Point><coordinates>1,2</coordinates></Point></Document></kml>'))).toBe('kml_structura')
  })
  it('<Folder> neînchis aruncă', () => {
    expect(codEroare(() => parseKml('<kml><Document><Folder><name>a</name></Document></kml>'))).toBe('kml_structura')
  })
  it('închidere fără deschidere aruncă', () => {
    expect(codEroare(() => parseKml('<kml></Folder></kml>'))).toBe('kml_structura')
  })
  it('tag-urile self-closing se ignoră (nu rămân pe stivă, nu dau elemente)', () => {
    const el = parseKml('<kml><Document><name>D</name><Folder/><Placemark/><Placemark id="p"><name>a</name><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>')
    expect(el.length).toBe(1)
    expect(el[0].cale).toBe('D')
  })
  it('entitățile numerice zecimale și hexa', () => {
    const el = parseKml('<kml><Placemark><name>A&#160;B&#xE2;&#x219;</name><Point><coordinates>1,2</coordinates></Point></Placemark></kml>')
    expect(el[0].nume).toBe('A Bâș')
  })
})

describe('MultiGeometry', () => {
  const el = parseKml(`<kml><Placemark id="m"><name>OS</name><MultiGeometry><Point><coordinates>22,44</coordinates></Point><Polygon><outerBoundaryIs><LinearRing><coordinates>22,44 22.001,44 22.001,44.001 22,44</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>
    <Placemark id="l"><name>ax</name><MultiGeometry><LineString><coordinates>22,44 22.01,44</coordinates></LineString><LineString><coordinates>22.01,44 22.02,44</coordinates></LineString></MultiGeometry></Placemark></kml>`)
  it('geometriile amestecate dau tip „multi” și păstrează toate părțile', () => {
    expect(el[0]).toMatchObject({ tip: 'multi', multiGeometrie: true })
    expect(el[0].puncte.length + el[0].poligoane.length).toBe(2)
    expect(el[1]).toMatchObject({ tip: 'linie', multiGeometrie: true })
    expect(el[1].linii.length).toBe(2)
  })
  it('pozitieElement avertizează explicit, nu alege tacit', () => {
    const p = pozitieElement(el[0])
    expect(p.coord).toEqual([22, 44])
    expect(p.avertisment).toMatch(/geometrii amestecate/)
    expect(pozitieElement({ tip: 'punct', puncte: [[[1, 2]]], poligoane: [] }).avertisment).toBe(null)
  })
  it('liniile unei MultiGeometrii continue se compun într-un ax', () => {
    expect(compuneAx(el[1].linii).lungime_m).toBeCloseTo(lungimeLinie(el[1].linii[0]) + lungimeLinie(el[1].linii[1]), 3)
  })
})

describe('compuneAx — continuitate și orientare', () => {
  it('un gol de 200 m între linii aruncă (nu inventează segment)', () => {
    expect(codEroare(() => compuneAx([linie(0, 3000), linie(3200, 6000)]))).toBe('ax_discontinuu')
  })
  it('un gol sub prag (5 m) trece', () => {
    expect(compuneAx([linie(0, 3000), linie(3005, 6000)]).lungime_m).toBeCloseTo(6000, -1)
  })
  it('segment scurt suprapus parțial, desenat invers: capătul de pe ax devine începutul', () => {
    // linia nouă merge de la 5000 înapoi la 2800; capătul 2800 e pe ax → se întoarce, axul se taie la 2800
    const r = compuneAx([linie(0, 3000), linie(2800, 5000).reverse()])
    expect(r.lungime_m).toBeCloseTo(5000, 0)
    expect(r.jurnal[1].taiat_m).toBeCloseTo(200, 0)
  })
  it('o linie conținută în ax nu adaugă nimic', () => {
    const r = compuneAx([linie(0, 3000), linie(1000, 2000)])
    expect(r.lungime_m).toBeCloseTo(3000, 0)
    expect(r.jurnal[1].nota).toBe('conținută în ax')
  })
  it('linie cu mai puțin de 2 vârfuri aruncă', () => {
    expect(codEroare(() => compuneAx([linie(0, 3000), [pct(3000)]]))).toBe('ax_linie_goala')
  })
})

describe('calibrare — validare fail-closed și extrapolare', () => {
  it('sub 2 ancore aruncă', () => expect(codEroare(() => calibrare([{ dist: 0, km_m: 0 }]))).toBe('ancore_putine'))
  it('distanțe egale aruncă (fără „|| 1”)', () => expect(codEroare(() => calibrare([{ dist: 0, km_m: 0 }, { dist: 0, km_m: 1000 }]))).toBe('ancore_dist'))
  it('km care nu crește în sensul axului aruncă', () => expect(codEroare(() => calibrare([{ dist: 0, km_m: 2000 }, { dist: 1000, km_m: 1000 }]))).toBe('ancore_monoton'))
  it('extrapolarea e marcată și limitată', () => {
    const f = calibrare([{ dist: 0, km_m: 49000 }, { dist: 1000, km_m: 50000 }])
    expect(f.stare(500)).toBe('interpolat')
    expect(f.stare(-300)).toBe('extrapolat')
    expect(f(-300)).toBeCloseTo(48700, 6)
    expect(f.stare(1600)).toBe('in_afara')
    expect(Number.isNaN(f(1600))).toBe(true)
    expect(calibrare([{ dist: 0, km_m: 0 }, { dist: 1000, km_m: 1000 }], { extrapolare_max_m: 2000 }).stare(2500)).toBe('extrapolat')
  })
})

describe('ancoreDinLiniute — o liniuță pentru o singură bornă', () => {
  it('aceeași liniuță aleasă pentru două borne aruncă', () => {
    const ax = linie(0, 6000)
    const tick = [[lonLa(1000), LAT - 0.001], [lonLa(1000), LAT + 0.001]]
    const borne = [{ coord: [lonLa(1000), LAT + 0.0004], km_m: 1000 }, { coord: [lonLa(1050), LAT + 0.0004], km_m: 2000 }]
    expect(codEroare(() => ancoreDinLiniute(borne, [tick], ax))).toBe('ancora_dubla')
  })
})

describe('P3: centroid și tronsonLaKm', () => {
  it('centroid pe inel închis nu dublează primul vârf', () => {
    expect(centroid([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([1, 1])
    expect(centroid([])).toBe(null)
  })
  it('capătul final al ultimului tronson aparține ultimului tronson', () => {
    const tr = [{ cod: 'T18', km_start_m: 79000, km_end_m: 83000 }, { cod: 'T19', km_start_m: 83000, km_end_m: 89000 }]
    expect(tronsonLaKm(89000, tr)).toBe('T19')
    expect(tronsonLaKm(83000, tr)).toBe('T19')
    expect(tronsonLaKm(89001, tr)).toBe(null)
    expect(tronsonLaKm(NaN, tr)).toBe(null)
  })
})

// ─── review r2 (#803) ───────────────────────────────────────────────────────
describe('parseKml — coordonate și geometrii stricte', () => {
  const pm = g => `<kml><Placemark id="x"><name>x</name>${g}</Placemark></kml>`
  it.each([
    ['<LineString><coordinates>22,44 22.1,abc 22.2,44</coordinates></LineString>'],
    ['<LineString><coordinates>22,44 22.1,44,zz 22.2,44</coordinates></LineString>'],
    ['<LineString><coordinates>22,44 22.1 22.2,44</coordinates></LineString>'],
    ['<LineString><coordinates>22,44 22.1,44,0,9 22.2,44</coordinates></LineString>'],
    ['<LineString><coordinates>22,44 22.1,,0 22.2,44</coordinates></LineString>'],
    ['<Point><coordinates>200,44</coordinates></Point>'],
    ['<Point><coordinates>22,95</coordinates></Point>'],
  ])('un token invalid aruncă, nu se sare: %s', g => expect(codEroare(() => parseKml(pm(g)))).toBe('kml_coordonata'))
  it.each([
    ['<Point><coordinates></coordinates></Point>'],
    ['<Point><coordinates>22,44 23,45</coordinates></Point>'],
    ['<LineString><coordinates>22,44</coordinates></LineString>'],
    ['<Polygon><outerBoundaryIs><LinearRing><coordinates>22,44 22.1,44 22.1,44.1</coordinates></LinearRing></outerBoundaryIs></Polygon>'],
    ['<Polygon><outerBoundaryIs><LinearRing><coordinates>22,44 22.1,44 22.1,44.1 22,44.1</coordinates></LinearRing></outerBoundaryIs></Polygon>'],
  ])('geometrie invalidă aruncă: %s', g => expect(codEroare(() => parseKml(pm(g)))).toBe('kml_geometrie'))
  it('altitudinea validă (lon,lat,alt) e acceptată', () => {
    expect(parseKml(pm('<LineString><coordinates>22,44,0 22.1,44,12.5</coordinates></LineString>'))[0].linii[0]).toEqual([[22, 44], [22.1, 44]])
  })
  it('mesajul de eroare spune elementul', () => {
    expect(() => parseKml(pm('<LineString><coordinates>22,44 x,y</coordinates></LineString>'))).toThrow(/id=x/)
  })
})

describe('parseKml — închiderea trebuie să fie de același tip', () => {
  it('</Document> care închide un <Folder> aruncă', () => {
    expect(codEroare(() => parseKml('<kml><Document><name>D</name><Folder><name>F</name></Document></Folder></kml>'))).toBe('kml_structura')
  })
  it('imbricarea corectă trece și dă calea', () => {
    const el = parseKml('<kml><Document><name>D</name><Folder><name>F</name><Placemark><name>a</name><Point><coordinates>1,2</coordinates></Point></Placemark></Folder></Document></kml>')
    expect(el[0].cale).toBe('D / F')
  })
})

describe('compuneAx — ocolirea nu e „conținută”', () => {
  it('o linie cu ambele capete pe ax, dar care se depărtează, aruncă', () => {
    const ocolire = [pct(1000), [lonLa(1500), LAT + 0.002], pct(2000)]   // ~220 m spre nord la mijloc
    expect(codEroare(() => compuneAx([linie(0, 3000), ocolire]))).toBe('ax_ocolire')
  })
  it('o linie cu toate vârfurile pe ax rămâne „conținută”', () => {
    expect(compuneAx([linie(0, 3000), linie(1000, 2000, 100)]).jurnal[1].nota).toBe('conținută în ax')
  })
})
