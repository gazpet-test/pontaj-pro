// Vremea zilei (Vaisala Xweather, 20261221a) în raportul zilnic și în exportul Excel: texte, „fără date” ≠ 0, citire paginată, foile Excel.
// Valorile așteptate sunt scrise de mână din cerere (L25); clientul Supabase e un fals care imită plafonul max-rows și filtrele PostgREST.
import { describe, it, expect } from 'vitest'
import * as XLSX_mod from 'xlsx-js-style'
import { zileXweather, ziXweather, stareZi, textValori, textStatie, textSursa, sursaScurta, descriereRo, directieRo, TEXT_IN_CURS, TEXT_FARA }
  from './meteoXweatherUtil.js'
import { celuleVreme, foaieSursaVreme, construiesteRapoarteXlsx, toateRapoartele, CAP_VREME, FARA_DATE, FOAIE_VREME } from './rapoarteExcelVreme.js'
const XLSX = XLSX_mod.default || XLSX_mod

const R = {
  site_id: 10, data: '2026-11-12', versiune: 1, versiuni: 1, tmin_c: 1.2, tmax_c: 9.46, tmed_c: 5.04, precipitatii_mm: 4.6, zapada_cm: 0,
  vant_max_kmh: 31.5, rafala_max_kmh: 52.3, vant_dir: 'NW', vant_dir_grade: 315, umiditate_med: 81.4, descriere: 'Light Rain',
  lat: 44.94, lng: 26.02, observatii_stare: 'ok', statie_id: 'LRBS', statie_nume: 'Bucuresti/Baneasa', statie_distanta_km: 12.37,
  preluat_la: '2026-11-13T04:05:10Z', prima_preluare_la: '2026-11-13T04:05:10Z',
}

// client fals: un tabel în memorie, filtre eq / gte / lte / gt / in, ordonare, limită plafonată la 1000 (ca max-rows)
function clientFals(tabele, { eroare = null, plafon = 1000 } = {}) {
  const apeluri = []
  return {
    apeluri,
    from(t) {
      const f = []; let ord = null, lim = null
      const q = {
        select() { return q },
        eq(c, v) { f.push(r => r[c] === v); return q }, gte(c, v) { f.push(r => r[c] >= v); return q }, lte(c, v) { f.push(r => r[c] <= v); return q },
        gt(c, v) { f.push(r => r[c] > v); return q }, in(c, vs) { f.push(r => vs.includes(r[c])); return q },
        order(c) { ord = c; return q }, limit(n) { lim = n; return q },
        then(res, rej) {
          apeluri.push(t)
          if (eroare) return Promise.resolve({ data: null, error: { message: eroare } }).then(res, rej)
          let d = (tabele[t] || []).filter(r => f.every(fn => fn(r)))
          if (ord) d = [...d].sort((a, b) => (a[ord] < b[ord] ? -1 : a[ord] > b[ord] ? 1 : 0))
          d = d.slice(0, Math.min(lim ?? Infinity, plafon))
          return Promise.resolve({ data: d, error: null }).then(res, rej)
        },
      }
      return q
    },
  }
}
const zi = (n) => new Date(Date.UTC(2023, 0, 1 + n)).toISOString().slice(0, 10)

describe('texte (raportul zilnic)', () => {
  it('valorile, cu „—” pentru lipsă (niciodată 0 inventat), direcția în notația românească', () => {
    expect(textValori(R)).toBe('T min 1,2°C · T max 9,5°C (medie 5°C) · precipitații 4,6 mm · zăpadă 0 cm · vânt max 32 km/h, rafale 52 km/h din NV · umiditate medie 81%')
    expect(textValori({ ...R, precipitatii_mm: null, zapada_cm: null, tmed_c: null, rafala_max_kmh: null, vant_dir: null }))
      .toBe('T min 1,2°C · T max 9,5°C · precipitații — · zăpadă — · vânt max 32 km/h · umiditate medie 81%')
    expect(directieRo('WSW')).toBe('VSV')
    expect(directieRo('X')).toBeNull()
  })
  it('sursa scrisă explicit: Vaisala Xweather (serviciu de date), coordonatele, stația și distanța, momentul preluării; niciodată „senzor”', () => {
    expect(textSursa(R)).toBe('Sursa: Vaisala Xweather — rezumatul zilei la coordonatele șantierului 44.94, 26.02; stația de observație cea mai apropiată: Bucuresti/Baneasa (LRBS), la 12,4 km; preluat 13.11.2026, 06:05')
    expect(textSursa({ ...R, versiune: 2, versiuni: 2, preluat_la: '2026-11-14T04:05:00Z' })).toMatch(/corectat de furnizor \(versiunea 2, 14\.11\.2026, 06:05\)$/)
    expect(textSursa(R) + sursaScurta(R)).not.toMatch(/senzor/i)
  })
  it('stația lipsă: motivul, fără eroare', () => {
    expect(textStatie({ ...R, observatii_stare: 'fara_statie', statie_id: null })).toBe('stația de observație: nicio stație cu date în raza de 50 km')
    expect(textStatie({ ...R, observatii_stare: 'neautorizat', statie_id: null })).toMatch(/nedisponibilă în abonament/)
    expect(textStatie({ ...R, statie_distanta_km: null })).toMatch(/distanța nedată de furnizor$/)
  })
  it('ziua fără rezumat: în curs (după miezul nopții) vs. fără date', () => {
    expect(stareZi(null, '2026-11-13', '2026-11-13')).toBe('in_curs')
    expect(stareZi(null, '2026-11-12', '2026-11-13')).toBe('fara_date')
    expect(stareZi(R, '2026-11-12', '2026-11-13')).toBe('date')
    expect(TEXT_IN_CURS).toMatch(/după miezul nopții/)
    expect(TEXT_FARA).toMatch(/Fără rezumat/)
  })
  it('descrierea: tradusă când e cunoscută, altfel textul furnizorului marcat ca atare', () => {
    expect(descriereRo('Light Rain')).toBe('Ploaie slabă')
    expect(descriereRo('Mostly Cloudy with Light Rain')).toBe('„Mostly Cloudy with Light Rain” (descrierea furnizorului)')
    expect(descriereRo(null)).toBeNull()
  })
})

describe('citirea (L18, L23)', () => {
  it('paginat pe chei, peste plafonul de 1000 de rânduri, pe fiecare șantier', async () => {
    const rows = [...Array.from({ length: 2345 }, (_, i) => ({ ...R, data: zi(i) })), ...Array.from({ length: 5 }, (_, i) => ({ ...R, site_id: 20, data: zi(i) }))]
    const c = clientFals({ v_meteo_zilnic_xweather: rows })
    const out = await zileXweather(c, [10, 20, 10], { de: zi(0), pana: zi(3000) })
    expect(out.length).toBe(2350)
    expect(new Set(out.map(r => `${r.site_id}|${r.data}`)).size).toBe(2350)
    expect(c.apeluri.length).toBe(4 + 2)   // 3 pagini + pagina goală pe 10; o pagină + pagina goală pe 20
  })
  it('eroarea se aruncă (nu devine „fără date”)', async () => {
    await expect(zileXweather(clientFals({}, { eroare: 'permission denied' }), [10], {})).rejects.toThrow(/nu se poate citi: permission denied/)
    await expect(ziXweather(clientFals({}, { eroare: 'x' }), 10, '2026-11-12')).rejects.toThrow(/nu se poate citi/)
  })
  it('o zi: rândul sau null', async () => {
    const c = clientFals({ v_meteo_zilnic_xweather: [R] })
    expect(await ziXweather(c, 10, '2026-11-12')).toEqual(R)
    expect(await ziXweather(c, 10, '2026-11-11')).toBeNull()
  })
  it('rapoartele intervalului: paginat pe id (2500 de rapoarte), în ordinea ecranului', async () => {
    const rap = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, site_id: i % 2 ? 10 : 20, data: zi(i % 100) }))
    const out = await toateRapoartele(clientFals({ rapoarte_zilnice: rap }), { siteIds: [10, 20], from: zi(0), to: zi(99) })
    expect(out.length).toBe(2500)
    expect(out[0].data).toBe(zi(99))
    expect(out.at(-1).data).toBe(zi(0))
    const unul = await toateRapoartele(clientFals({ rapoarte_zilnice: rap }), { siteIds: [10, 20], from: zi(0), to: zi(99), siteId: 10 })
    expect(unul.every(r => r.site_id === 10) && unul.length === 1250).toBe(true)
    await expect(toateRapoartele(clientFals({}, { eroare: 'boom' }), { siteIds: [10], from: zi(0), to: zi(1) })).rejects.toThrow(/rapoartele nu se pot citi/)
    expect(await toateRapoartele(clientFals({}), { siteIds: [], from: zi(0), to: zi(1) })).toEqual([])
  })
})

describe('exportul Excel pe lucrare', () => {
  const list = [
    { id: 1, site_id: 10, data: '2026-11-12', personal_snapshot: { total: 5 }, utilaje_snapshot: [] },
    { id: 2, site_id: 10, data: '2026-11-13', personal_snapshot: { total: 4 }, utilaje_snapshot: [] },
  ]
  const nume = (id) => (id === 10 ? 'Santier A' : `#${id}`)
  it('celulele zilei: numere; „fără date” = celule goale + text, nu zero', () => {
    expect(celuleVreme(R)).toEqual([1.2, 9.46, 4.6, 0, 31.5, 'Ploaie slabă', 'Vaisala Xweather · coord. 44.94, 26.02 · stația Bucuresti/Baneasa (LRBS) la 12,4 km · preluat 13.11.2026, 06:05'])
    expect(celuleVreme(undefined)).toEqual(['', '', '', '', '', FARA_DATE, FARA_DATE])
    expect(celuleVreme({ ...R, precipitatii_mm: null, descriere: null }).slice(2, 6)).toEqual(['', 0, 31.5, ''])
  })
  it('foaia „Rapoarte”: coloanele de vreme pe fiecare raport + foaia „Vremea — sursă și metodă”', () => {
    const wb = construiesteRapoarteXlsx({ XLSX, list, siteNameOf: nume, titluSite: 'Santier A', from: '2026-11-01', to: '2026-11-13', vreme: [R], generatLa: '13.11.2026, 10:00' })
    expect(wb.SheetNames).toEqual(['Rapoarte', FOAIE_VREME])
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets.Rapoarte, { header: 1, defval: '' })
    const cap = aoa[3]
    expect(cap.slice(-7)).toEqual(CAP_VREME)
    expect(cap.slice(-7)).toEqual(['T min (°C)', 'T max (°C)', 'Precipitații (mm)', 'Zăpadă (cm)', 'Vânt max (km/h)', 'Descriere vreme', 'Sursa vremii'])
    const r12 = aoa[4], r13 = aoa[5]
    expect(r12.slice(-7, -2)).toEqual([1.2, 9.46, 4.6, 0, 31.5])
    expect(r12.at(-1)).toMatch(/^Vaisala Xweather · coord\. 44\.94, 26\.02 · stația Bucuresti\/Baneasa \(LRBS\) la 12,4 km/)
    // ziua fără rezumat (13.11, în curs): goale + „fără date”, niciun 0
    expect(r13.slice(-7)).toEqual(['', '', '', '', '', 'fără date', 'fără date'])
    const sursa = XLSX.utils.sheet_to_json(wb.Sheets[FOAIE_VREME], { header: 1, defval: '' })
    const text = sursa.map(r => r.join(' | ')).join('\n')
    expect(text).toMatch(/Vaisala Xweather — serviciu de date meteo \(NU un senzor montat pe șantier\)/)
    expect(text).toMatch(/nu pot fi modificate sau șterse în platformă/)
    expect(text).toMatch(/Automat, o dată pe zi/)
    expect(text).toMatch(/Santier A \| coordonate: 44\.94, 26\.02 · stația de observație cea mai apropiată: Bucuresti\/Baneasa \(LRBS\), la 12,4 km · 2 zile cu rapoarte: 1 cu date, 1 fără date/)
    expect(text).not.toMatch(/\bAI\b|Claude|generat automat/i)
  })
  it('fără niciun rând de vreme: exportul merge, cu „fără date” peste tot', () => {
    const wb = construiesteRapoarteXlsx({ XLSX, list, siteNameOf: nume, titluSite: 'Santier A', from: '2026-11-01', to: '2026-11-13', vreme: [], generatLa: 'x' })
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets.Rapoarte, { header: 1, defval: '' })
    expect(aoa.slice(4).every(r => r.at(-1) === 'fără date' && r.at(-3) === '')).toBe(true)
    expect(foaieSursaVreme({ list, vreme: [], siteNameOf: nume, from: 'a', to: 'b', generatLa: 'x' }).at(-1)[1]).toMatch(/0 cu date, 2 fără date/)
  })
})
