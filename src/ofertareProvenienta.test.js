import { describe, it, expect } from 'vitest'
import { provPeDocument, etichetaProvenienta, PROV_INDISPONIBILA } from './ofertareProvenienta.js'

describe('proveniența textului pe document', () => {
  it('un rând pe document din RPC; la dubluri câștigă prov_id cel mai mare; fără document_id = ignorat', () => {
    const m = provPeDocument([
      { prov_id: 3, document_id: 1654, origine: 'ocr_local_neverificat', curent: true, are_text: true },
      { prov_id: 2, document_id: 1655, origine: 'transcriere', curent: true, are_text: true },
      { prov_id: 4, document_id: 1655, origine: 'sinteza_ai', curent: true, are_text: true },
      { prov_id: 5, document_id: null, origine: 'transcriere' },
    ])
    expect(m.get(1654).origine).toBe('ocr_local_neverificat')
    expect(m.get(1655).prov_id).toBe(4)
    expect(m.size).toBe(2)
  })
  it('OCR local neverificat = vizibil, cu atenție și avertisment', () => {
    const e = etichetaProvenienta({ prov_id: 1, origine: 'ocr_local_neverificat', producator: 'laborator-ocr-lighton', completitudine: 'integral', curent: true, are_text: true })
    expect(e.nivel).toBe('atentie')
    expect(e.text).toBe('OCR local neverificat')
    expect(e.titlu).toMatch(/NU e verificat de om/)
    expect(e.titlu).toMatch(/laborator-ocr-lighton/)
  })
  it('review #795 r1 P1: transcriere veche pe un text schimbat ulterior = atenție, NU „transcriere AI”', () => {
    const e = etichetaProvenienta({ prov_id: 1, origine: 'transcriere', producator: 'ofertare-ingest-doc', curent: false, are_text: true })
    expect(e.nivel).toBe('atentie')
    expect(e.text).toMatch(/proveniență veche/)
    expect(e.titlu).toMatch(/NU e a textului actual/)
    // curent lipsă (null) = tratat ca necurent (fail-closed)
    expect(etichetaProvenienta({ prov_id: 1, origine: 'transcriere', curent: null, are_text: true }).text).toMatch(/proveniență veche/)
  })
  it('review #795 r2 P1: text FĂRĂ proveniență = vizibil („fără proveniență”), document fără text = nimic', () => {
    const e = etichetaProvenienta({ prov_id: null, are_text: true })
    expect(e.text).toBe('fără proveniență'); expect(e.icon).toBe('⚠'); expect(e.titlu).toMatch(/NU e sursă/)
    expect(etichetaProvenienta({ prov_id: null, are_text: false })).toBe(null)
  })
  it('review #795 r2 P1: RPC indisponibil = etichetă explicită, nu una veche', () => {
    expect(PROV_INDISPONIBILA.text).toBe('proveniență indisponibilă')
  })
  it('transcrierea AI curentă = ok; origine necunoscută = atenție (fail-closed); fără rând = nimic', () => {
    expect(etichetaProvenienta({ prov_id: 1, origine: 'transcriere', curent: true, are_text: true }).nivel).toBe('ok')
    const n = etichetaProvenienta({ prov_id: 1, origine: 'alta_noua', curent: true, are_text: true })
    expect(n.nivel).toBe('atentie'); expect(n.text).toMatch(/necunoscută/)
    expect(etichetaProvenienta(null)).toBe(null)
  })
})
