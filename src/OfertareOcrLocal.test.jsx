import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import OcrLocalSection, { eroarePlafon, documenteCandidate, textConfirmare, bugetRamas, FEREASTRA_GPU, PLAFON_MAX, MAX_DOCUMENTE, STARE_RULARE } from './OfertareOcrLocal.jsx'

describe('OCR local — limitele RPC-ului și bugetul (review PR #702)', () => {
  it('cel mult 50 de documente într-o cerere, ca fn_ofertare_ocr_cerere', () => expect(MAX_DOCUMENTE).toBe(50))
  it('bugetul rămas scade și abandonatul și rezervatul, ca în BD; nu coboară sub 0', () => {
    expect(bugetRamas({ plafon_usd: 15, cost_usd: 0, cost_rezervat: 0, cost_abandonat: 15 })).toBe(0)
    expect(bugetRamas({ plafon_usd: 15, cost_usd: '1.2500', cost_rezervat: '0.0500', cost_abandonat: '0.2000' })).toBeCloseTo(13.5)
    expect(bugetRamas({ plafon_usd: 1, cost_usd: 2 })).toBe(0)
  })
})

describe('OCR local — plafonul, exact regula din fn_ofertare_ocr_cerere', () => {
  it('acceptă (0, 15] cu cel mult 2 zecimale, inclusiv virgula', () => {
    for (const v of ['15', '0.01', '7.5', '7,50', ' 3 ']) expect(eroarePlafon(v), v).toBe(null)
  })
  it('refuză 0, peste 15, 3 zecimale, negativ, text, gol', () => {
    for (const v of ['0', '0.00', '15.01', '16', '1.005', '-1', 'abc', '', null, '1e1']) expect(eroarePlafon(v), String(v)).not.toBe(null)
  })
  it('plafonul maxim e cel al RPC-ului', () => expect(PLAFON_MAX).toBe(15))
})

describe('OCR local — documentele candidate', () => {
  const docs = [
    { id: 1247, nume_original: 'PT FV', pagini: 1636, pagini_necitite: [325, 326, 326, 0, 10000] },
    { id: 772, nume_original: 'Memoriu', pagini: 447, pagini_necitite: [255] },
    { id: 527, nume_original: 'Lot 1', pagini: 10, pagini_necitite: [3] },
    { id: 9, nume_original: 'Gol', pagini: 5, pagini_necitite: [] },
  ]
  const elig = [{ document_id: 1247, eligibil: true }, { document_id: 772, eligibil: true }, { document_id: 527, eligibil: false, motiv: 'lot_neparticipant' }]
  const c = documenteCandidate(docs, elig)
  it('doar documentele cu pagini necitite valide, numărate distinct (1..9999, ca RPC-ul)', () => {
    expect(c.map(d => [d.id, d.nrPagini])).toEqual([[1247, 2], [772, 1], [527, 1]])
  })
  it('eligibilitatea vine din poarta pe loturi; necunoscută = neeligibil', () => {
    expect(c.find(d => d.id === 527)).toMatchObject({ eligibil: false, motiv: 'lot_neparticipant' })
    expect(documenteCandidate([{ id: 5, pagini_necitite: [1] }], [])[0]).toMatchObject({ eligibil: false, motiv: 'eligibilitate necunoscută' })
  })
})

describe('OCR local — confirmarea și afișarea', () => {
  it('confirmarea spune că e plătită, plafonul și fereastra GPU', () => {
    const t = textConfirmare('15.00', 2, 1447)
    expect(t).toContain('PLĂTITĂ'); expect(t).toContain('15.00 USD'); expect(t).toContain('1447 pagini'); expect(t).toContain(FEREASTRA_GPU)
    expect(FEREASTRA_GPU).toBe('22:00–06:00')
  })
  it('toate stările rulării din BD au etichetă', () => {
    for (const s of ['ceruta', 'preluata', 'citita', 'arbitrata', 'finalizata', 'oprita', 'anulata', 'esuata']) expect(STARE_RULARE[s]).toBeTruthy()
  })
  it('randarea inițială: titlul și „Se încarcă” (fără buton înainte de răspunsul porții)', () => {
    const h = renderToStaticMarkup(<OcrLocalSection licitatieId={102} profile={{ id: 'u' }} />)
    expect(h).toContain('OCR local'); expect(h).toContain('Se încarcă'); expect(h).not.toContain('Pornește OCR local (')
  })
})
