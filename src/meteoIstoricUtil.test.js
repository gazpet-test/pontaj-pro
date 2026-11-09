// Utilitarele tabului 🌧️ Meteo: calendar, rezumate, citirea pe chei, exportul Excel. Valorile așteptate scrise de mână (L25).
import { describe, it, expect } from 'vitest'
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { calendarLuna, zileInLuna, rezumatLuna, peLuni, motiveText, vremeWmo, eticheta, ziSaptamana, pragText, toateZilele, construiesteExport,
  numeFisierMeteo, CAP_ZILE, CULOARE_NELUCRABIL, COLOANE, parsePrag, pragurileExportului } from './meteoIstoricUtil.js'
const XLSX = XLSX_mod.default || XLSX_mod

const P = { precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, versiune: 3, actualizat_la: '2026-11-09T10:00:00Z' }
const zi = (site_id, data, o = {}) => ({ site_id, data, precipitatii_mm: 0, ploaie_mm: 0, zapada_cm: 0, tmin_c: 1, tmax_c: 8, vant_max_kmh: 10, rafale_max_kmh: 20,
  cod_vreme: 3, lat: 44.6, lng: 22.6, sursa: 'open-meteo-archive', preluat_la: '2026-11-10T04:05:00Z', zi_nelucrabila: false, motive: [],
  precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, praguri_versiune: 3, ...o })

describe('Meteo — calendar și rezumate', () => {
  it('săptămânile încep luni; celulele din afara lunii sunt goale', () => {
    const feb = calendarLuna(2026, 2)                    // 1 februarie 2026 = duminică
    expect(feb.length).toBe(5)
    expect(feb[0]).toEqual([null, null, null, null, null, null, '2026-02-01'])
    expect(feb[4]).toEqual(['2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', null])
    expect(calendarLuna(2026, 6)[0][0]).toBe('2026-06-01')   // 1 iunie 2026 = luni
    expect(zileInLuna(2024, 2)).toBe(29)
    expect(zileInLuna(2026, 2)).toBe(28)
    expect(ziSaptamana('2026-11-09')).toBe('luni')
  })
  it('rezumatul lunii: nelucrabile, necunoscute, zile fără date doar până azi', () => {
    const r = [zi(1, '2026-01-02', { zi_nelucrabila: true, motive: ['precipitatii'] }), zi(1, '2026-01-03'), zi(1, '2026-01-04', { zi_nelucrabila: null }),
      zi(1, '2026-02-01', { zi_nelucrabila: true })]
    expect(rezumatLuna(r, 2026, 1, '2026-01-10')).toEqual({ cuDate: 3, nelucrabile: 1, necunoscute: 1, faraDate: 6 })   // 1–9 ianuarie = 9 zile trecute
    expect(rezumatLuna(r, 2026, 1, '2026-03-01')).toEqual({ cuDate: 3, nelucrabile: 1, necunoscute: 1, faraDate: 28 })
    expect(peLuni(r)).toEqual([{ luna: '2026-01', cuDate: 3, nelucrabile: 1, necunoscute: 1 }, { luna: '2026-02', cuDate: 1, nelucrabile: 1, necunoscute: 0 }])
  })
  it('textele: motive cu valorile și pragurile, vremea WMO, eticheta', () => {
    expect(motiveText(zi(1, '2026-01-02', { precipitatii_mm: 12.4, zapada_cm: 2, tmin_c: -6, tmax_c: -1, motive: ['precipitatii', 'zapada', 'tmax', 'tmin'] })))
      .toBe('precipitații 12,4 mm ≥ 10; zăpadă 2 cm ≥ 1; Tmax -1 °C < 0; Tmin -6 °C ≤ -5')
    expect(vremeWmo(0).text).toBe('Senin')
    expect(vremeWmo(63).text).toBe('Ploaie')
    expect(vremeWmo(73).text).toBe('Ninsoare')
    expect(vremeWmo(95).text).toBe('Furtună')
    expect(vremeWmo(null).text).toBe('—')
    expect([eticheta(true), eticheta(false), eticheta(null)]).toEqual(['DA', 'NU', 'necunoscut'])
    expect(pragText(P)).toBe('precipitații ≥ 10 mm sau zăpadă ≥ 1 cm sau Tmax < 0 °C sau Tmin ≤ -5 °C')
    expect(numeFisierMeteo('PRUNISOR_JUPA', '2026-11-09')).toBe('Meteo_zile_nelucrabile_PRUNISOR_JUPA_09.11.2026.xlsx')
  })
  it('pragurile din formular: obligatorii, cel mult o zecimală, virgula acceptată; golul NU devine 0 (review r1 P2)', () => {
    expect(['10', ' 9,9 ', '-5', '-5.5', '0'].map(parsePrag)).toEqual([10, 9.9, -5, -5.5, 0])
    expect(['', '   ', null, undefined, '9.99', '1e3', 'abc', '10,', '-', '1234'].map(parsePrag)).toEqual([null, null, null, null, null, null, null, null, null, null])
  })
})

// client fals: v_meteo_zile în memorie; serverul taie la `maxRows` (paginarea pe chei trebuie să continue până la pagina goală)
function fakeClient(randuri, { maxRows = 2, eroare = null } = {}) {
  const jurnal = []
  return {
    jurnal,
    from(t) {
      const q = { t, ops: [], f: [] }
      const api = {
        select(c) { q.ops.push(['select', c]); return api },
        eq(c, v) { q.ops.push(['eq', c, v]); q.f.push(r => r[c] === v); return api },
        gte(c, v) { q.ops.push(['gte', c, v]); q.f.push(r => r[c] >= v); return api },
        lte(c, v) { q.ops.push(['lte', c, v]); q.f.push(r => r[c] <= v); return api },
        gt(c, v) { q.ops.push(['gt', c, v]); q.f.push(r => r[c] > v); return api },
        order(c) { q.ord = c; return api },
        limit(n) { q.lim = n; return api },
        then(res, rej) {
          return Promise.resolve().then(() => {
            jurnal.push(q)
            const e = eroare && eroare(q, jurnal.length - 1)
            if (e) return { data: null, error: { message: e } }
            const rows = randuri.filter(r => q.f.every(f => f(r))).sort((a, b) => (a[q.ord] < b[q.ord] ? -1 : 1)).slice(0, Math.min(q.lim, maxRows))
            return { data: rows, error: null }
          }).then(res, rej)
        },
      }
      return api
    },
  }
}

describe('Meteo — citirea pe chei (L23) și erorile (L18)', () => {
  const R = [zi(1, '2026-01-01'), zi(1, '2026-01-02'), zi(1, '2026-01-03'), zi(1, '2026-01-04'), zi(1, '2026-01-05'), zi(2, '2026-01-01'), zi(2, '2026-01-02')]
  it('toate zilele, pe fiecare șantier, chiar dacă serverul taie la 2 rânduri; interval opțional', async () => {
    const c = fakeClient(R)
    const t = await toateZilele(c, [1, 2])
    expect(t.map(r => `${r.site_id}:${r.data.slice(8)}`)).toEqual(['1:01', '1:02', '1:03', '1:04', '1:05', '2:01', '2:02'])
    expect(c.jurnal.length).toBe(6)                   // 3 pagini + pagina goală pe 1, o pagină + pagina goală pe 2
    expect(c.jurnal.every(q => q.ops[0][1] === COLOANE)).toBe(true)
    const i = await toateZilele(fakeClient(R), [1], { de: '2026-01-02', pana: '2026-01-04' })
    expect(i.map(r => r.data)).toEqual(['2026-01-02', '2026-01-03', '2026-01-04'])
  })
  it('o eroare pe orice pagină se aruncă, nu întoarce o listă scurtă', async () => {
    await expect(toateZilele(fakeClient(R, { eroare: (q, i) => i === 1 && 'permission denied' }), [1, 2])).rejects.toThrow(/istoricul meteo nu se poate citi: permission denied/)
  })
  it('anularea oprește citirea', async () => {
    const s = { anulat: true }
    await expect(toateZilele(fakeClient(R), [1], { semnal: s })).rejects.toThrow(/anulat/)
  })
})

async function fillCelula(zip, foaie, ref) {
  const sx = await zip.file(`xl/worksheets/${foaie}`).async('string')
  const m = new RegExp(`<c r="${ref}"[^>]*?s="(\\d+)"`).exec(sx)
  if (!m) return null
  const st = await zip.file('xl/styles.xml').async('string')
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st)[1].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)
  const fillId = Number(/fillId="(\d+)"/.exec(xfs[Number(m[1])])[1])
  const fills = /<fills[^>]*>([\s\S]*?)<\/fills>/.exec(st)[1].match(/<fill>[\s\S]*?<\/fill>/g)
  const rgb = /fgColor rgb="([0-9A-F]+)"/i.exec(fills[fillId])
  return rgb ? rgb[1].slice(-6).toUpperCase() : null
}

describe('Meteo — exportul Excel', () => {
  it('pragurile declarate = cele din rânduri; versiuni / valori amestecate = refuz (review r1 P1)', async () => {
    expect(pragurileExportului([zi(1, '2026-01-01'), zi(2, '2026-01-02')])).toEqual({ versiune: 3, precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5 })
    expect(() => pragurileExportului([zi(1, '2026-01-01'), zi(1, '2026-01-02', { praguri_versiune: 4, precipitatii_mm_min: 20 })])).toThrow(/pragurile s-au schimbat în timpul exportului/)
    expect(() => pragurileExportului([zi(1, '2026-01-01'), zi(1, '2026-01-02', { precipitatii_mm_min: 20 })])).toThrow(/s-au schimbat/)
    await expect(construiesteExport({ santiere: [{ id: 1, name: 'A' }], randuri: [zi(1, '2026-01-01'), zi(1, '2026-01-02', { praguri_versiune: 4 })], jurnal: [], generatLa: 'x' }))
      .rejects.toThrow(/s-au schimbat/)
  })
  it('foile, antetul, zilele cu DA / NU / necunoscut, pe luni, pragurile și sursa; înghețare + filtru + landscape', async () => {
    const santiere = [{ id: 2, name: 'B Lot 2', active: false }, { id: 1, name: 'A Lot 1' }]
    const randuri = [zi(2, '2026-01-01'), zi(1, '2026-01-02', { zi_nelucrabila: true, motive: ['precipitatii'], precipitatii_mm: 12.4, cod_vreme: 63, grila_lat: 44.674866, grila_lng: 22.465332, altitudine_m: 65 }),
      zi(1, '2026-01-01', { zi_nelucrabila: null, precipitatii_mm: null })]
    const jurnal = [{ versiune: 1, precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, actualizat_la: '2026-11-01T08:00:00Z' },
      { versiune: 3, precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, actualizat_la: '2026-11-09T10:00:00Z' }]
    // pagina are alte praguri (P = versiunea 3 aici); fișierul trebuie să le ia din rânduri, nu din pagină
    const bytes = await construiesteExport({ santiere, randuri, jurnal, generatLa: '09.11.2026, 18:00' })
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Zile', 'Pe luni', 'Praguri si sursa'])
    const Z = XLSX.utils.sheet_to_json(wb.Sheets.Zile, { header: 1, defval: '' })
    expect(Z[0]).toEqual(CAP_ZILE)
    expect(Z.slice(1).map(r => [r[0], r[1], r[2], r[3], r[10], r[11], r[12], r[14]])).toEqual([
      ['A Lot 1', '01.01.2026', 'joi', '', 'Înnorat (3)', 'necunoscut', '', ''],
      ['A Lot 1', '02.01.2026', 'vineri', 12.4, 'Ploaie (63)', 'DA', 'precipitații 12,4 mm ≥ 10', '44.674866, 22.465332 · 65 m'],
      ['B Lot 2 (închis)', '01.01.2026', 'joi', 0, 'Înnorat (3)', 'NU', '', ''],
    ])
    const L = XLSX.utils.sheet_to_json(wb.Sheets['Pe luni'], { header: 1, defval: '' })
    expect(L.slice(1)).toEqual([['B Lot 2 (închis)', 'ianuarie 2026', 1, 0, 0], ['A Lot 1', 'ianuarie 2026', 2, 1, 1]])
    const I = XLSX.utils.sheet_to_json(wb.Sheets['Praguri si sursa'], { header: 1, defval: '' })
    expect(I[1]).toEqual(['Zi nelucrabilă dacă', 'precipitații ≥ 10 mm sau zăpadă ≥ 1 cm sau Tmax < 0 °C sau Tmin ≤ -5 °C'])
    expect(I[2]).toEqual(['Versiunea pragurilor folosită', '3'])
    expect(I[3]).toEqual(['Versiunea stabilită la', '2026-11-09 10:00 UTC'])
    expect(JSON.stringify(I)).toContain('Open-Meteo')
    expect(I.slice(-2).map(r => r[0])).toEqual(['versiunea 1', 'versiunea 3 (folosită)'])
    const zip = await JSZip.loadAsync(bytes)
    const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string')
    expect(s1).toContain('<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>')
    expect(s1).toMatch(/<autoFilter ref="A1:Q4"\s*\/>/)
    expect(s1).toContain('orientation="landscape"')
    expect(await fillCelula(zip, 'sheet1.xml', 'L3')).toBe(CULOARE_NELUCRABIL)   // ziua nelucrabilă
    expect(await fillCelula(zip, 'sheet1.xml', 'B3')).toBe(CULOARE_NELUCRABIL)
    expect(await fillCelula(zip, 'sheet1.xml', 'L2')).toBe(null)                 // necunoscută: fără culoare
    expect(await fillCelula(zip, 'sheet1.xml', 'L4')).toBe(null)
  })
})
