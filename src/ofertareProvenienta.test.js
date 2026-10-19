import { describe, it, expect } from 'vitest'
import { provPeDocument, etichetaProvenienta } from './ofertareProvenienta.js'

describe('proveniența textului pe document', () => {
  it('un rând pe document din RPC; la dubluri câștigă prov_id cel mai mare; fără document_id = ignorat', () => {
    const m = provPeDocument([
      { prov_id: 3, document_id: 1654, origine: 'ocr_local_neverificat', curent: true },
      { prov_id: 2, document_id: 1655, origine: 'transcriere', curent: true },
      { prov_id: 4, document_id: 1655, origine: 'sinteza_ai', curent: true },
      { prov_id: 5, document_id: null, origine: 'transcriere' },
    ])
    expect(m.get(1654).origine).toBe('ocr_local_neverificat')
    expect(m.get(1655).prov_id).toBe(4)
    expect(m.size).toBe(2)
  })
  it('OCR local neverificat = vizibil, cu atenție și avertisment', () => {
    const e = etichetaProvenienta({ origine: 'ocr_local_neverificat', producator: 'laborator-ocr-lighton', completitudine: 'integral', curent: true })
    expect(e.atentie).toBe(true)
    expect(e.text).toBe('OCR local neverificat')
    expect(e.titlu).toMatch(/NU e verificat de om/)
    expect(e.titlu).toMatch(/laborator-ocr-lighton/)
  })
  it('review #795 r1 P1: transcriere veche pe un text schimbat ulterior = atenție, NU „transcriere AI” verde', () => {
    const e = etichetaProvenienta({ origine: 'transcriere', producator: 'ofertare-ingest-doc', curent: false })
    expect(e.atentie).toBe(true)
    expect(e.text).toMatch(/proveniență veche/)
    expect(e.titlu).toMatch(/NU e a textului actual/)
  })
  it('transcrierea AI curentă fără atenție; origine necunoscută = cu atenție (fail-closed); fără rând = nimic', () => {
    expect(etichetaProvenienta({ origine: 'transcriere', curent: true }).atentie).toBe(false)
    const n = etichetaProvenienta({ origine: 'alta_noua', curent: true })
    expect(n.atentie).toBe(true); expect(n.text).toMatch(/necunoscută/)
    expect(etichetaProvenienta(null)).toBe(null)
  })
})
