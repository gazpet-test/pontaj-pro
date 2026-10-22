import { strict as assert } from 'node:assert'
import { CHEI_ANTET, randGol } from '../../../src/izoDocumenteLogica.js'
import { ANTET_COMUN, ANTET_SPECIFIC, atribuireValidaE3, EroareE3, MAX_PDF_E3, normalizeazaE3, numarE3, RAND_NUMAR, RAND_TEXT, REZERVA_E3, schemaE3, valideazaCerereE3 } from './avizE3.ts'

const ai = (r: Record<string, unknown> = {}) => JSON.stringify({ antet: { furnizor: '  Furnizor  ', nr_document: '00019', total_m: '99,15', decizie: 'primit' }, randuri: [{ serie: '  000123  ', sarja: '00009', lungime_doc: '12,345', pagina: 2, ...r }], totaluri_tiparite: { total_metri: '99,15', total_kg: '1.234,56' }, avertismente: ['  ilizibil  ', 7] })
const cerere = () => ({ tip: 'aviz_e3', proiect_id: 1, depozit_id: 2, sablon: 'aviz_teava', pdf_base64: btoa('%PDF-1.7\n') })

Deno.test('paritate cu editorul real: antet și randGol, exclusiv câmpuri permise', () => {
  assert.deepEqual(ANTET_COMUN, CHEI_ANTET.comune)
  assert.deepEqual(ANTET_SPECIFIC.aviz_teava, CHEI_ANTET.aviz_teava)
  assert.deepEqual(ANTET_SPECIFIC.lista_curbe, CHEI_ANTET.lista_ambalare_curbe)
  const editor = Object.keys(randGol('aviz_teava', 1)).filter(k => !['decizie', 'lungime_masurata', 'unghi_masurat'].includes(k)).sort()
  assert.deepEqual([...RAND_TEXT, ...RAND_NUMAR].filter(k => k !== 'pagina').sort(), editor)
})

Deno.test('normalizare E3: trim, zerouri păstrate, metri, virgulă, total tipărit independent', () => {
  const p = normalizeazaE3(ai(), 'aviz_teava')
  assert.equal(p.antet.furnizor, 'Furnizor')
  assert.equal(p.antet.nr_document, '00019')
  assert.equal(p.randuri[0].serie, '000123')
  assert.equal(p.randuri[0].sarja, '00009')
  assert.equal(p.randuri[0].lungime_doc, 12.345)
  assert.deepEqual(p.totaluri_tiparite, { total_metri: 99.15, total_kg: 1234.56 })
  assert.deepEqual(p.avertismente, ['ilizibil'])
})
Deno.test('liste închise: chei necunoscute, măsurători, decizie, bucata_id eliminate; unghi_doc păstrat', () => {
  const p = normalizeazaE3(ai({ decizie: 'primit', bucata_id: 42, lungime_masurata: 12, lungime_doc_mm: 12345, unghi_masurat: 90, unghi: 45, unghi_doc: '89,5', injectie: 'x' }), 'lista_curbe')
  assert.deepEqual(Object.keys(p.antet), [...ANTET_COMUN, ...ANTET_SPECIFIC.lista_curbe])
  assert.deepEqual(Object.keys(p.randuri[0]), [...RAND_TEXT, ...RAND_NUMAR])
  assert.equal(p.randuri[0].unghi_doc, 89.5)
  assert.equal('decizie' in p.antet, false)
  assert.equal('total_m' in p.antet, false)
})
Deno.test('cantitate > 1: un singur rând și avertisment, fără serii inventate', () => {
  const p = normalizeazaE3(ai({ serie: null, cantitate: '4' }), 'aviz_teava')
  assert.equal(p.randuri.length, 1)
  assert.equal(p.randuri[0].serie, null)
  assert.equal(p.randuri[0].cantitate, 4)
  assert.match(p.avertismente.join(' '), /cantitate 4/)
})
Deno.test('tipuri invalide nu devin valori inventate; pagina/cantitate întregi pozitive', () => {
  const p = normalizeazaE3(ai({ serie: 123, cantitate: -1, pagina: 1.5, greutate_kg: '12kg' }), 'aviz_teava')
  assert.equal(p.randuri[0].serie, null)
  assert.equal(p.randuri[0].cantitate, null)
  assert.equal(p.randuri[0].pagina, null)
  assert.equal(p.randuri[0].greutate_kg, null)
  assert.equal(numarE3('1 234,50'), 1234.5)
  assert.equal(numarE3('1,234.50'), 1234.5)
  for (const v of [true, {}, '', Infinity, 'NaN', '1,2,3']) assert.equal(numarE3(v), null)
})
Deno.test('răspuns gol, gunoi, obiecte fără rânduri utile => eroare curată', () => {
  for (const raw of ['', 'gunoi', 'null', '[]', '{}', '{"antet":{},"randuri":[]}', '{"antet":{},"randuri":[null]}', '{"antet":{},"randuri":[{"decizie":"primit"}]}']) {
    assert.throws(() => normalizeazaE3(raw, 'aviz_teava'), (e: unknown) => e instanceof EroareE3 && e.cod === 'raspuns_ai_invalid')
  }
})
Deno.test('cerere: PDF valid, id-uri/sablon închise, 8MB și semnătură', () => {
  assert.equal(valideazaCerereE3(cerere()).sablon, 'aviz_teava')
  assert.equal(valideazaCerereE3({ ...cerere(), sablon: 'lista_curbe' }).sablon, 'lista_curbe')
  for (const patch of [{ proiect_id: '1' }, { depozit_id: 0 }, { proiect_id: 1.5 }, { sablon: 'lista_ambalare_curbe' }]) assert.throws(() => valideazaCerereE3({ ...cerere(), ...patch }), { status: 400 })
  for (const pdf_base64 of ['$$', btoa('not PDF'), '']) assert.throws(() => valideazaCerereE3({ ...cerere(), pdf_base64 }), { status: 422 })
  assert.doesNotThrow(() => valideazaCerereE3({ ...cerere(), pdf_base64: btoa('%PDF' + 'x'.repeat(MAX_PDF_E3 - 4)) }))
  assert.throws(() => valideazaCerereE3({ ...cerere(), pdf_base64: btoa('%PDF' + 'x'.repeat(MAX_PDF_E3 - 3)) }), { status: 413 })
  assert.equal(REZERVA_E3, 0.05)
  assert.equal(schemaE3('lista_curbe').additionalProperties, false)
})
Deno.test('atribuire: proiect/depozit exacte, rol gestionar, activă, limite inclusive', () => {
  const a = { proiect_id: 1, depozit_id: 2, rol: 'gestionar', activ: true, valabil_de: '2026-10-22', valabil_pana: '2026-10-22' }
  assert.equal(atribuireValidaE3(a, 1, 2, '2026-10-22'), true)
  for (const patch of [{ proiect_id: 3 }, { depozit_id: 3 }, { depozit_id: null }, { activ: false }, { rol: 'rts_rte' }, { valabil_de: '2026-10-23' }, { valabil_pana: '2026-10-21' }]) assert.equal(atribuireValidaE3({ ...a, ...patch }, 1, 2, '2026-10-22'), false)
  assert.equal(atribuireValidaE3({ ...a, valabil_de: null, valabil_pana: null }, 1, 2, '2026-10-22'), true)
})
