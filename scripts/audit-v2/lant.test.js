import { describe, it, afterEach, mock, stubEnv, restoreEnv } from './test-api.mjs'
import assert from 'node:assert/strict'
import { compuneNouaVerigi } from './lant.js'
const h = 'a'.repeat(64)
const baza = () => ({ cerinta: { id: 10, licitatie_id: 100, versiune: 1, sursa_document_id: 20, sursa_pagina: 2, sursa_pasaj: 'RTE', pasaj_verificat: true },
  documente: [{ id: 20 }], manifest: [{ document_id: 20, sha256: h, stare: 'urcat' }], licitatie: { status: 'in_lucru' },
  acoperiri: [{ id: 1, cerinta_id: 10, status: 'acoperit', ales: true, ales_de: 'user', verificat_pe_scan: true, valabil_la_depunere: true, autorizatie: { fisier_path: 'scan.pdf' } }],
  legaturi: [{ id: 30, cerinta_id: 10, capitol_id: 40, fel: 'capitol', stare: 'verificata', confirmat_de: 'user', confirmat_la: '2026-09-28', locator_raspuns: '§2', verificat_la_versiunea: 2 }],
  capitole: [{ id: 40, versiune: 2 }], pachet: { stare: 'aprobat', fisiere: [{ rol: 'propunere_docx', sha256: h, fisier_path: 'pt/100/v1/pt.docx', sursa_versiune: 'capitole@{40:v2}' }] } })
const veriga = (d, nr) => compuneNouaVerigi(d).verigi[nr].stare
describe('nouă verigi fără fals verde', () => {
  it('absența datelor nu produce niciun ok', () => {
    const r = compuneNouaVerigi()
    assert.strictEqual((Object.values(r.verigi)).length, 9)
    assert.strictEqual(Object.values(r.verigi).every(v => v.stare === 'lipsa'), true)
  })
  it('document fără manifest = lipsă', () => { const d = baza(); d.manifest = []; assert.strictEqual(veriga(d, 1), 'lipsa') })
  it('pasaj neverificat = propus', () => { const d = baza(); d.cerinta.pasaj_verificat = false; assert.strictEqual(veriga(d, 1), 'propusa') })
  it('include toate rândurile manifestului, inclusiv vechi actualizat în eroare', () => {
    const d = baza(); d.manifest.push({ id: 1, document_id: 20, sha256: h, stare: 'eroare_urcare' }); assert.strictEqual(veriga(d, 1), 'propusa')
  })
  it('AI nu este aprobare', () => { const d = baza(); d.acoperiri[0].verificat_pe_scan = false; assert.strictEqual(veriga(d, 3), 'propusa') })
  it('scan verificat fără ales_de nu e aprobare', () => { const d = baza(); d.acoperiri[0].ales_de = null; assert.strictEqual(veriga(d, 3), 'propusa') })
  it('dovada umană explicită și valabilă trece', () => assert.strictEqual(veriga(baza(), 3), 'ok'))
  it('scan cu reverificare cerută este vechi', () => { const d = baza(); d.acoperiri[0].reverificare_ceruta = true; assert.strictEqual(veriga(d, 3), 'veche') })
  it('valabilitate necunoscută nu este verde', () => { const d = baza(); d.acoperiri[0].valabil_la_depunere = null; assert.strictEqual(veriga(d, 3), 'propusa') })
  it('lipsa fișierului nu este aprobare', () => { const d = baza(); d.acoperiri[0].autorizatie = {}; assert.strictEqual(veriga(d, 3), 'propusa') })
  it('două alegeri nu sunt dovadă unică', () => { const d = baza(); d.acoperiri.push({ ...d.acoperiri[0], id: 2 }); assert.strictEqual(veriga(d, 3), 'nedeterminat') })
  it('versiunea veche este semnalată conform R17', () => { const d = baza(); d.capitole[0].versiune++; assert.strictEqual(veriga(d, 5), 'veche'); assert.strictEqual(veriga(d, 7), 'veche') })
  it('legătura atribuită nu e răspuns verificat', () => { const d = baza(); d.legaturi[0].stare = 'atribuita'; assert.strictEqual(veriga(d, 4), 'propusa'); assert.strictEqual(veriga(d, 5), 'propusa') })
  it('lanțul curent rupt nu devine ok', () => { const d = baza(); d.cerinta.inlocuita_de = 999; assert.strictEqual(veriga(d, 2), 'nedeterminat') })
  it('detectează ciclu de supersession', () => { const d = baza(); d.cerinta.inlocuita_de = 11; d.toateCerintele = [d.cerinta, { id: 11, inlocuita_de: 10 }]; assert.strictEqual(veriga(d, 2), 'nedeterminat') })
  it('cerința înlocuită este veche', () => { const d = baza(); d.cerinta.inlocuita_de = 11; d.toateCerintele = [{ id: 11 }]; assert.strictEqual(veriga(d, 2), 'veche') })
  it('răspuns primit nu echivalează cu rezoluție', () => { const d = baza(); d.puncte = [{ cerinta_id: 10, raspuns: 'Da', rezolutie: 'partial' }]; assert.strictEqual(veriga(d, 2), 'propusa') })
  it('anexa fără FK de cerință rămâne nedeterminată', () => { const d = baza(); d.anexe = [{ ref: 'F9' }]; assert.strictEqual(veriga(d, 6), 'nedeterminat') })
  it('hashul din BD nu dovedește read-back server', () => assert.strictEqual(veriga(baza(), 7), 'nedeterminat'))
  it('pagina globală fără versiune/fișier nu probează artefactul', () => { const d = baza(); d.dovezi = [{ legatura_id: 30, pagina_globala: 900 }]; assert.strictEqual(veriga(d, 8), 'nedeterminat') })
  it('depus fără dovadă SEAP = lipsă, chiar cu status final', () => {
    const d = baza(); d.licitatie.status = 'depusa'; d.pachet.stare = 'depus';
    d.pachet.fisiere.push({ rol: 'depus_final', sha256: h, fisier_path: 'depus.pdf' }); assert.strictEqual(veriga(d, 9), 'lipsa')
  })
  it('două roluri declarate nu certifică octeții sau cerința', () => {
    const d = baza(); d.pachet.fisiere.push(...['depus_final', 'dovada_seap'].map(rol => ({ rol, sha256: h, fisier_path: rol + '.pdf' })))
    d.pachet.stare = 'depus'; d.pachet.depus_la = '2026-09-28'; d.licitatie.status = 'depusa'
    assert.strictEqual(veriga(d, 9), 'nedeterminat')
  })
  it('fișierele fără înregistrarea depunerii nu sunt depuse', () => {
    const d = baza(); d.pachet.fisiere.push(...['depus_final', 'dovada_seap'].map(rol => ({ rol, sha256: h, fisier_path: rol + '.pdf' })))
    assert.strictEqual(veriga(d, 9), 'lipsa')
  })
  it('eroarea de citire este distinctă de absență', () => {
    const d = baza(); d.erori = { manifest: 'RLS', acoperire: 'PGRST200' }; assert.strictEqual(veriga(d, 1), 'nedeterminat'); assert.strictEqual(veriga(d, 3), 'nedeterminat')
  })
  it('nu folosește acoperirea altei cerințe', () => { const d = baza(); d.acoperiri[0].cerinta_id = 11; assert.strictEqual(veriga(d, 3), 'lipsa') })
})
