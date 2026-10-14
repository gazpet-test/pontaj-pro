import { describe, it, expect } from 'vitest'
import { construiesteIzometrii, esteAprobat } from './ctcIzometrii.js'

const pachete = [
  { id: 5, proiect_id: 1, tronson_id: 7, cod_document_full: '30_GAZ_CTG1_DWG_00077', revizie: 0, status: 'draft' },
  { id: 6, proiect_id: 1, tronson_id: 7, cod_document_full: '30_GAZ_CTG1_DWG_00077', revizie: 1, status: 'aprobat', aprobat_la: '2026-06-01' },
  { id: 9, proiect_id: 1, tronson_id: 8, cod_document_full: '30_GAZ_CTG1_DWG_00106', revizie: 0, status: 'draft' },
]
const tronsoane = [{ id: 7, cod: 'T1', denumire: 'Orșova' }, { id: 8, cod: 'T2', denumire: null }]
const docs = [
  { id: 16, pachet_id: 5, tip_document: 'centralizator', fisier_nume: 'a_rev0.xlsx', uploadat_la: '2026-05-22' },
  { id: 17, pachet_id: 5, tip_document: 'centralizator', fisier_nume: 'b_rev0.xlsx', uploadat_la: '2026-05-28' },
  { id: 20, pachet_id: 6, tip_document: 'centralizator', fisier_nume: 'c_rev1.xlsx', uploadat_la: '2026-06-01' },
  { id: 21, pachet_id: 9, tip_document: 'pdf_aprobare_transgaz', fisier_nume: 'd.pdf', uploadat_la: '2026-06-02' },
  { id: 99, pachet_id: 777, tip_document: 'centralizator', fisier_nume: 'alt_proiect.xlsx', uploadat_la: '2026-06-03' },
]

describe('izometrii generate în CTC', () => {
  const r = construiesteIzometrii(docs, pachete, tronsoane)
  it('doar documentele pachetelor primite (alt proiect nu intră)', () => {
    expect(r.map(x => x.id)).toEqual([20, 17, 16, 21])
  })
  it('cea mai nouă revizie e prima și marcată ultima, pe document', () => {
    expect(r.filter(x => x.ultima).map(x => x.id)).toEqual([20, 21])
    expect(r[0]).toMatchObject({ revizie: 1, aprobat: true, tronson: 'T1 · Orșova' })
  })
  it('aprobat vs ciornă', () => {
    expect(r.find(x => x.id === 17).aprobat).toBe(false)
    expect(r.find(x => x.id === 21).aprobat).toBe(true)
    expect(esteAprobat({ tip_document: 'centralizator' }, { status: 'draft' })).toBe(false)
  })
  it('liste goale', () => {
    expect(construiesteIzometrii(null, null, null)).toEqual([])
  })
})
