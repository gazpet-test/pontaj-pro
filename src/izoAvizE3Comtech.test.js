// Aviz COMTECH CO P 0160 (27.10.2026): Nr.Sarja citit ca număr de țeavă. Răspunsuri AI SIMULATE (fără rețea) din fixture-ul
// transcris (scripts/ocr_local/tests/e3/aviz_comtech_p0160.json) → normalizare edge (avizE3.ts) → garda pe server → prefill UI.
import { describe, it, expect } from 'vitest'
import aviz from '../scripts/ocr_local/tests/e3/aviz_comtech_p0160.json'
import { EroareE3, MESAJ_SERIE_REPETATA_E3, MODEL_AVIZ_E3, costMaximE3, limitaInputE3, gradOtelE3, normalizeazaE3, promptE3, rezervaE3, valideazaCerereE3, verificaSeriiE3 } from '../supabase/functions/ocr-packing-list/avizE3.ts'
import { MESAJ_SERIE_REPETATA, aplicaPropunereOCR, avertismenteOCR, seriiRepetateOCR } from './izoDocumentePrefill.js'
import { randNormalizat, validareDocument } from './izoDocumenteLogica.js'

const nul = { lot:null, standard:null, dimensiune:null, grad_otel:null, izolatie:'PEHD', cod:null, item:null, pachet_nr:null, dimensiuni_cm:null,
  motiv:null, observatie:null, perete_mm:null, diametru_mm:null, unghi_doc:null, cantitate:null, net_kg:null, brut_kg:null, pagina:1 }
// răspunsul corect: serie = Cod Articol, sarja = Nr.Sarja, greutatea ca număr de kg (0,684 t → 684)
const corect = () => ({ rotatie_grade:0, avertismente:[],
  antet:{ furnizor:'COMTECH CO S.R.L', nr_document:'P 0160', data_document:'2026-10-21', cumparator:'TRANSGAZ S.A' },
  totaluri_tiparite:{ total_metri:178.97, total_kg:20564 },
  randuri:aviz.randuri.map(r => ({ ...nul, nr_crt:Number(r.nr_crt), serie:r.cod_articol, sarja:r.sarja, specificatie:aviz.denumire,
    lungime_doc:r.lungime_m, greutate_kg:Number(r.greutate_neta.replace('0,', '')) })) })
// răspunsul greșit raportat: serie = Nr.Sarja (B2407893 pe 4 țevi …), sarja goală
const gresit = () => { const o = corect(); o.randuri = o.randuri.map(r => ({ ...r, serie:r.sarja, sarja:null })); return o }
const norm = o => normalizeazaE3(JSON.stringify(o), 'aviz_teava')
const refuzat = fn => expect(fn).toThrow(expect.objectContaining({ cod:'serie_repetata', status:422 }))

describe('aviz COMTECH P 0160 — calea Sonnet (ocr-packing-list aviz_e3)', () => {
  it('fixture-ul transcris: 30 de țevi, Cod Articol unic, șarje repetate, totalurile tipărite bat', () => {
    expect(aviz.randuri).toHaveLength(30)
    expect(new Set(aviz.randuri.map(r => r.cod_articol)).size).toBe(30)
    expect(aviz.randuri.filter(r => r.sarja === 'B2407893').map(r => r.nr_crt)).toEqual(['1', '2', '5', '12'])
    expect(Math.round(aviz.randuri.reduce((s, r) => s + Number(r.lungime_m.replace(',', '.')), 0) * 100) / 100).toBe(178.97)
  })
  it('răspunsul corect: normalizat, trece garda, grad din denumire, kg și metri neatinse', () => {
    const p = norm(corect())
    expect(() => verificaSeriiE3(p, 'aviz_teava')).not.toThrow()
    expect(p.randuri.map(r => r.serie)).toEqual(aviz.randuri.map(r => r.cod_articol))
    expect(p.randuri.map(r => r.sarja)).toEqual(aviz.randuri.map(r => r.sarja))
    expect(new Set(p.randuri.map(r => r.grad_otel))).toEqual(new Set(['L360NE']))
    expect(p.randuri[0]).toMatchObject({ lungime_doc:5.95, greutate_kg:684 })
    expect(p.totaluri_tiparite).toEqual({ total_metri:178.97, total_kg:20564 })
    // greutatea ca text „0,684” (cum e tipărită) → tot 684 kg (separator de mii)
    const t = corect(); t.randuri[0].greutate_kg = '0,684'
    expect(norm(t).randuri[0].greutate_kg).toBe(684)
  })
  it('P1-01: serie = B2407893 pe 4 țevi (șarja citită ca serie) → refuzat pe server, fără propunere', () => {
    refuzat(() => verificaSeriiE3(norm(gresit()), 'aviz_teava'))
    // varianta din review: aceeași serie pe 6 țevi
    const o = corect(); for (const i of [0, 1, 4, 11, 20, 26]) o.randuri[i].serie = 'B2407893'
    refuzat(() => verificaSeriiE3(norm(o), 'aviz_teava'))
    // canonic: spații / cratime nu ascund dublura
    const c = corect(); c.randuri[1].serie = '247 EK-04204'
    refuzat(() => verificaSeriiE3(norm(c), 'aviz_teava'))
  })
  it('P1-01: serie egală cu șarja pe același rând → refuzat', () => {
    const o = corect(); o.randuri[3].serie = o.randuri[3].sarja
    refuzat(() => verificaSeriiE3(norm(o), 'aviz_teava'))
  })
  it('garda nu atinge listele de curbe și rândurile cu cantitate > 1', () => {
    const c = { ...corect(), antet:{}, randuri:[{ ...nul, serie:'1001', sarja:'H', cantitate:1, pachet_nr:'1', cod:'1001-610-8-25-6100-H-9' },
      { ...nul, serie:'1001', sarja:'H', cantitate:1, pachet_nr:'1', cod:'1001-610-8-45-6100-H-9' }] }
    expect(() => verificaSeriiE3(normalizeazaE3(JSON.stringify(c), 'lista_curbe'), 'lista_curbe')).not.toThrow()
    const m = corect(); m.randuri[1] = { ...m.randuri[1], serie:m.randuri[0].serie, cantitate:3 }
    expect(() => verificaSeriiE3(norm(m), 'aviz_teava')).not.toThrow()
    expect(new EroareE3('serie_repetata').status).toBe(422)
    expect(MESAJ_SERIE_REPETATA_E3).toMatch(/Numărul țevii se repetă/)
  })
  it('decizia Răzvan: aviz_e3 citește pe Sonnet 5.5 (și cu „haiku” trimis de UI-ul vechi), rezerva 0,20 USD', () => {
    const cerere = { tip:'aviz_e3', proiect_id:1, depozit_id:2, sablon:'aviz_teava', pdf_base64:btoa('%PDF-1.7\n') }
    for (const model of [undefined, 'haiku', 'sonnet']) expect(valideazaCerereE3({ ...cerere, model }).model).toBe('claude-sonnet-5-5')
    expect(MODEL_AVIZ_E3).toBe('claude-sonnet-5-5')
    expect(rezervaE3(MODEL_AVIZ_E3)).toBe(0.2)
    // P1-01 r2: costul maxim (costApel la limita de intrare impusă + max_tokens) încape în rezervă
    expect(costMaximE3(MODEL_AVIZ_E3)).toBeLessThanOrEqual(rezervaE3(MODEL_AVIZ_E3))
    expect(limitaInputE3(MODEL_AVIZ_E3)).toBe(46000)
    expect(() => valideazaCerereE3({ ...cerere, model:'opus' })).toThrow()
  })
  it('promptul aviz: Cod articol → serie doar fără Nr. țeavă, șarja doar în sarja, grad fără spații, exemplul descris', () => {
    const p = promptE3('aviz_teava')
    expect(p).toMatch(/Dacă există ambele, serie = „Nr\. țeavă”/)
    expect(p).toMatch(/merge DOAR în sarja, niciodată în serie/)
    expect(p).toMatch(/„L 360 NE” → „L360NE”/)
    expect(p).toMatch(/Cod Articol e diferit pe fiecare rând/)
    expect(p).toMatch(/izolatie: „PEHD” dacă țeava e izolată/)   // regula de izolație rămâne cea existentă (decizie chat 27.10)
    expect(promptE3('lista_curbe')).not.toMatch(/AVIZ DE ȚEAVĂ/)
  })
  it('grad oțel: normalizare fără spații, text nerecunoscut păstrat', () => {
    const o = corect(); o.randuri[0].grad_otel = 'L 415 ME'; o.randuri[1].grad_otel = 'P235GH'; o.randuri[2].specificatie = 'Teava 610x7.1'
    const p = norm(o)
    expect([p.randuri[0].grad_otel, p.randuri[1].grad_otel, p.randuri[2].grad_otel]).toEqual(['L415ME', 'P235GH', null])
    expect(gradOtelE3('teava 610 X 52 mm')).toBe(null)
  })
})

describe('aviz COMTECH P 0160 — garda în UI înainte de „Aplică în formular”', () => {
  it('propunerea greșită: avertisment „Numărul țevii se repetă” primul, cu seriile și rândurile', () => {
    const r = { ...gresit(), sablon:'aviz_teava' }
    const rep = seriiRepetateOCR(r)
    expect(rep.find(x => x.serie === 'B2407893').randuri).toEqual([1, 2, 5, 12])
    expect(rep.map(x => x.serie).sort()).toEqual(['2485300887', '2489300883', 'B0408378', 'B0408380', 'B0408382', 'B0408383', 'B0408384', 'B2407893']
      .filter(s => aviz.randuri.filter(x => x.sarja === s).length > 1).sort())
    const av = avertismenteOCR(r)
    expect(av[0].startsWith(MESAJ_SERIE_REPETATA)).toBe(true)
    expect(av[0]).toMatch(/B2407893 \(rândurile 1, 2, 5, 12\)/)
    // aplicate oricum (după confirmare), rândurile dublate rămân blocante la salvare
    const d = aplicaPropunereOCR({ sablon:'aviz_teava', antet:{}, randuri:[] }, r, { mod:'inlocuieste' })
    expect(validareDocument(d).randuri[1].some(x => x.camp === 'serie' && x.nivel === 'blocant')).toBe(true)
  })
  it('propunerea corectă: fără avertisment; prefill: kg 684, metri 5.95, grad L360NE, izolația ca până acum (PEHD)', () => {
    const r = { ...norm(corect()), sablon:'aviz_teava', tip:'aviz_e3' }
    expect(seriiRepetateOCR(r)).toEqual([])
    expect(avertismenteOCR(r).some(x => x.startsWith(MESAJ_SERIE_REPETATA))).toBe(false)
    const d = aplicaPropunereOCR({ sablon:'aviz_teava', antet:{}, randuri:[] }, r, { mod:'inlocuieste' })
    expect(d.randuri).toHaveLength(30)
    expect(d.randuri[0]).toMatchObject({ serie:'247EK04204', sarja:'B2407893', greutate_kg:'684', lungime_doc:'5.95', grad_otel:'L360NE', izolatie:'PEHD' })
    expect(randNormalizat(d.randuri[0], 'aviz_teava')).toMatchObject({ greutate_kg:684, lungime_doc_mm:5950 })
  })
  it('cantitate „1.0” e piesă; cantitate 2 și listele de curbe nu intră în gardă', () => {
    const r = { sablon:'aviz_teava', randuri:[{ serie:'A', cantitate:'1.0' }, { serie:'A', cantitate:1 }, { serie:'B', cantitate:2 }, { serie:'B', cantitate:null }] }
    expect(seriiRepetateOCR(r)).toEqual([{ serie:'A', randuri:[1, 2] }])
    expect(seriiRepetateOCR({ ...r, sablon:'lista_curbe' })).toEqual([])
  })
})
