import { describe, it, expect } from 'vitest'
import { aplicaPropunereOCR, avertismenteOCR } from './izoDocumentePrefill.js'
import { randGol, eroriSalvare, randNormalizat } from './izoDocumenteLogica.js'
import { textKg } from './izoDocumentePrefill.js'

const doc = () => ({ proiect_id:7, depozit_id:3, sablon:'aviz_teava', antet:{ furnizor:'Manual', nr_document:'' }, randuri:[] })
const raspuns = { antet:{ furnizor:'OCR', nr_document:'001', proiect_id:99, depozit_id:99, sablon:'lista_curbe', necunoscut:'x' },
  randuri:[{ serie:'000O01I', sarja:'0009', lungime_doc:12.345, lungime_masurata:12, decizie:'primit', necunoscut:'x' }],
  totaluri_tiparite:{ total_metri:100, total_kg:200 } }
describe('prefill OCR E3', () => {
  it('completează golurile sau înlocuiește; păstrează contextul ales', () => {
    const d = doc(), a = aplicaPropunereOCR(d, raspuns), b = aplicaPropunereOCR(d, raspuns, { mod:'inlocuieste' })
    expect(a.antet.furnizor).toBe('Manual'); expect(b.antet.furnizor).toBe('OCR')
    expect(a.antet.nr_document).toBe('001')
    for (const r of [a, b]) {
      expect([r.proiect_id, r.depozit_id, r.sablon]).toEqual([7, 3, 'aviz_teava'])
      expect(r.antet).not.toHaveProperty('proiect_id'); expect(r.antet).not.toHaveProperty('necunoscut')
      expect(r.antet.total_m).toBe('100'); expect(r.antet.total_kg).toBe('200')
    }
    expect(d).toEqual(doc())
  })
  it('păstrează zerourile și metri, elimină cheile necunoscute și cere decizia umană', () => {
    const d = aplicaPropunereOCR(doc(), raspuns), r = d.randuri[0]
    expect(r.serie).toBe('000O01I'); expect(r.sarja).toBe('0009'); expect(r.lungime_doc).toBe('12.345')
    expect(r.lungime_masurata).toBe(''); expect(r.unghi_masurat).toBe(''); expect(r.decizie).toBe('')
    expect(r).not.toHaveProperty('necunoscut'); expect(eroriSalvare(d).some(x => x.includes('alege decizia'))).toBe(true)
  })
  it('sare cantitățile multiple și le raportează', () => {
    const r = { ...raspuns, avertismente:['Verifică seria'], randuri:[{ cantitate:'2', serie:'001' }] }
    expect(aplicaPropunereOCR(doc(), r).randuri).toEqual([])
    expect(avertismenteOCR(r)).toEqual(['Verifică seria', expect.stringContaining('cantitate 2')])
  })
  it('adaugă cu chei și numere unice; înlocuirea elimină rândurile vechi', () => {
    const d = { ...doc(), randuri:[{ ...randGol('aviz_teava', 8), _k:'ocr_1' }] }
    const a = aplicaPropunereOCR(d, { ...raspuns, randuri:[...raspuns.randuri, ...raspuns.randuri] })
    expect(a.randuri.map(r => r.nr_crt)).toEqual(['8', '9', '10'])
    expect(new Set(a.randuri.map(r => r._k)).size).toBe(3)
    expect(aplicaPropunereOCR(d, raspuns, { mod:'inlocuieste' }).randuri.map(r => r.nr_crt)).toEqual(['1'])
  })
  it('totalurile rămân cele tipărite și respectă modul de completare', () => {
    const d = { ...doc(), antet:{ total_m:'50', total_kg:'' } }
    expect(aplicaPropunereOCR(d, raspuns).antet).toMatchObject({ total_m:'50', total_kg:'200' })
    expect(aplicaPropunereOCR(d, raspuns, { mod:'inlocuieste' }).antet.total_m).toBe('100')
  })
  it('curbele folosesc câmpurile proprii, fără măsurători sau decizii de la AI', () => {
    const d = { ...doc(), sablon:'lista_ambalare_curbe' }
    const r = aplicaPropunereOCR(d, { antet:{ total_bucati:1 }, randuri:[{ serie:'00012', sarja:'00034', unghi_doc:45,
      unghi_masurat:46, cantitate:1, lungime_doc:12, decizie:'primit' }] }).randuri[0]
    expect(r).toMatchObject({ serie:'00012', sarja:'00034', unghi_doc:'45', unghi_masurat:'', cantitate:'1', lungime_doc:'', decizie:'' })
  })
  it('kg: AI -> prefill -> normalizare nu multiplică cu 1000 (Jak E9 r1 P1)', () => {
    expect(textKg(1402)).toEqual({ val:'1402', ok:true })
    expect(textKg(1402.5)).toEqual({ val:'1402,5', ok:true })
    expect(textKg(123.456).ok).toBe(false)
    expect(textKg('123.456').ok).toBe(false)
    const r = { antet:{}, randuri:[{ serie:'1', greutate_kg:1402.5 }, { serie:'2', greutate_kg:123.456 }, { serie:'3', greutate_kg:10192 }],
      totaluri_tiparite:{ total_kg:11594.5 } }
    const d = aplicaPropunereOCR(doc(), r, { mod:'inlocuieste' })
    expect(d.randuri.map(x => randNormalizat(x, 'aviz_teava').greutate_kg)).toEqual([1402.5, null, 10192])
    expect(d.antet.total_kg).toBe('11594,5')
    expect(d.ocrAvertismente.some(a => a.includes('123.456'))).toBe(true)
  })
  it('totaluri net/brut pe lista de curbe nu se multiplică (Jak E9 r2 P1)', () => {
    const d = aplicaPropunereOCR({ ...doc(), sablon:'lista_ambalare_curbe' }, { antet:{ total_net_kg:123.456, total_brut_kg:'234.567' }, randuri:[],
      totaluri_tiparite:{ total_kg:1500 } }, { mod:'inlocuieste' })
    expect(d.antet.total_net_kg).toBe(''); expect(d.antet.total_brut_kg).toBe('')
  })
})
