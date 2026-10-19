import { describe, it, expect } from 'vitest'
import { ultimaProvPeDocument, etichetaProvenienta } from './ofertareProvenienta.js'

describe('proveniența textului pe document', () => {
  it('ultimul rând pe document (după constatat_la, apoi id)', () => {
    const m = ultimaProvPeDocument([
      { id: 1, document_id: 1654, origine: 'transcriere', constatat_la: '2026-10-19T10:00:00Z' },
      { id: 3, document_id: 1654, origine: 'ocr_local_neverificat', constatat_la: '2026-10-20T10:00:00Z' },
      { id: 2, document_id: 1655, origine: 'transcriere', constatat_la: '2026-10-19T19:32:00Z' },
      { id: 4, document_id: 1655, origine: 'sinteza_ai', constatat_la: '2026-10-19T19:32:00Z' },
      { id: 5, document_id: null, origine: 'transcriere' },
    ])
    expect(m.get(1654).origine).toBe('ocr_local_neverificat')
    expect(m.get(1655).id).toBe(4)
    expect(m.size).toBe(2)
  })
  it('OCR local neverificat = vizibil, cu atenție și avertisment', () => {
    const e = etichetaProvenienta({ origine: 'ocr_local_neverificat', producator: 'laborator-ocr-lighton', completitudine: 'integral' })
    expect(e.atentie).toBe(true)
    expect(e.text).toBe('OCR local neverificat')
    expect(e.titlu).toMatch(/NU e verificat de om/)
    expect(e.titlu).toMatch(/laborator-ocr-lighton/)
  })
  it('transcrierea AI fără atenție; origine necunoscută = cu atenție (fail-closed); fără rând = nimic', () => {
    expect(etichetaProvenienta({ origine: 'transcriere' }).atentie).toBe(false)
    const n = etichetaProvenienta({ origine: 'alta_noua' })
    expect(n.atentie).toBe(true); expect(n.text).toMatch(/necunoscută/)
    expect(etichetaProvenienta(null)).toBe(null)
  })
})
