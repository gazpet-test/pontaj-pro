import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import OcrLocalSection, { eroarePlafon, documenteCandidate, textConfirmare, bugetRamas, selectieDupaIncarcare, FEREASTRA_GPU, PLAFON_MAX, MAX_DOCUMENTE, STARE_RULARE } from './OfertareOcrLocal.jsx'

describe('OCR local — selecția după reîncărcare (review PR #702 r2 Jakarinos P2)', () => {
  const cand = (...el) => el.map(([id, eligibil]) => ({ id, eligibil }))
  it('prima încărcare: toate eligibile, cel mult 50', () => {
    expect(selectieDupaIncarcare({}, cand([1, true], [2, false], [3, true]), true)).toEqual({ 1: true, 3: true })
    expect(Object.keys(selectieDupaIncarcare({}, Array.from({ length: 60 }, (_, i) => ({ id: i + 1, eligibil: true })), true))).toHaveLength(50)
  })
  it('totul debifat + reîncărcare = rămâne gol (nu se rebifează singur)', () => {
    expect(selectieDupaIncarcare({ 1: false, 3: false }, cand([1, true], [3, true]), false)).toEqual({})
    expect(selectieDupaIncarcare({}, cand([1, true], [3, true]), false)).toEqual({})
  })
  it('A bifat, B debifat, A devine neeligibil → nimic bifat (B nu se bifează în locul lui A)', () => {
    expect(selectieDupaIncarcare({ 1: true, 2: false }, cand([1, false], [2, true]), false)).toEqual({})
  })
  it('alegerea omului se păstrează cât documentele rămân eligibile', () => {
    expect(selectieDupaIncarcare({ 1: true, 2: false, 3: true }, cand([1, true], [2, true], [3, true]), false)).toEqual({ 1: true, 3: true })
  })
})

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

import { egressEstimat, fmtMB, textEgress } from './OfertareOcrLocal.jsx'
describe('OCR local — estimarea de egress în preview (cerere Răzvan, Huedin)', () => {
  it('suma mărimilor documentelor alese, în MB, și apare în confirmare', () => {
    const e = egressEstimat([{ size_bytes: 10196734 }, { size_bytes: 9375265 }])
    expect(e).toEqual({ octeti: 19571999, necunoscute: 0 }); expect(fmtMB(e.octeti)).toBe('19,6 MB')
    expect(textConfirmare('15.00', 2, 1447, e)).toContain('~19,6 MB, o singură dată pe rulare')
  })
  it('mărimea lipsă e NECUNOSCUTĂ, nu zero (review r4 P2)', () => {
    expect(textEgress(egressEstimat([{ size_bytes: null }]))).toBe('estimare indisponibilă (mărime necunoscută)')
    expect(textEgress(egressEstimat([{ size_bytes: 1000000 }, { size_bytes: undefined }]))).toBe('≥ 1 MB + 1 document(e) cu mărime necunoscută')
    expect(egressEstimat([{ size_bytes: 'abc' }, { size_bytes: -5 }, { size_bytes: 0 }])).toEqual({ octeti: 0, necunoscute: 2 })
  })
})
