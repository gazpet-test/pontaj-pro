import { describe, it, expect } from 'vitest'
import { indexConfirmari, stareConfirmare, stareExceptarePT, nsaScoasa, statisticiAcoperire, propunereCurenta, TIP_NSA, TIP_EXCEPTAT_PT } from './ofertareNeaplicabil.js'

const conf = (cerinta_id, tip, valida, extra = {}) => ({ cerinta_id, tip, valida, revocata_la: null, ...extra })

describe('J02b — AI „nu se aplică"/„exceptat" = propunere, nu verde', () => {
  it('fără confirmări: nimic nu e închis', () => {
    const idx = indexConfirmari([])
    expect(stareConfirmare(idx, 1, TIP_NSA)).toBe(null)
    expect(nsaScoasa({ id: 1, stare: 'nu_se_aplica' }, idx)).toBe(false) // stare veche fără amprentă nu închide
  })
  it('index fail-closed pe input null/rânduri invalide/revocate', () => {
    const idx = indexConfirmari([null, { tip: TIP_NSA }, conf(2, TIP_NSA, true, { revocata_la: '2026-10-01' })])
    expect(idx.size).toBe(0)
    expect(indexConfirmari(undefined).size).toBe(0)
  })
  it('confirmare validă câștigă peste una invalidată pe aceeași cheie', () => {
    const idx = indexConfirmari([conf(3, TIP_NSA, false), conf(3, TIP_NSA, true), conf(3, TIP_NSA, false)])
    expect(stareConfirmare(idx, 3, TIP_NSA)).toBe('confirmata')
  })
  it('valida=null/undefined ⇒ invalidată (nu verde)', () => {
    expect(stareConfirmare(indexConfirmari([conf(4, TIP_NSA, null)]), 4, TIP_NSA)).toBe('invalidata')
  })
  it('PT: exceptat doar de AI ⇒ propunere, neînchis', () => {
    const r = stareExceptarePT([{ fel: 'exceptat', sursa: 'ai' }], indexConfirmari([]), 10)
    expect(r.inchisa).toBe(false); expect(r.propunere).toBe(true); expect(r.eticheta).toMatch(/propunere AI/)
  })
  it('PT: exceptat de om fără confirmare cu amprentă ⇒ neînchis', () => {
    const r = stareExceptarePT([{ fel: 'exceptat', sursa: 'om' }], indexConfirmari([]), 10)
    expect(r.inchisa).toBe(false); expect(r.eticheta).toMatch(/lipsește confirmarea/)
  })
  it('PT: confirmare validă ⇒ închisă; confirmare de alt tip nu contează', () => {
    const leg = [{ fel: 'exceptat', sursa: 'ai' }]
    expect(stareExceptarePT(leg, indexConfirmari([conf(10, TIP_EXCEPTAT_PT, true)]), 10).inchisa).toBe(true)
    expect(stareExceptarePT(leg, indexConfirmari([conf(10, TIP_NSA, true)]), 10).inchisa).toBe(false)
    expect(stareExceptarePT(leg, indexConfirmari([conf(11, TIP_EXCEPTAT_PT, true)]), 10).inchisa).toBe(false)
  })
  it('PT: sursa schimbată (valida=false) ⇒ invalidată, neînchisă', () => {
    const r = stareExceptarePT([{ fel: 'exceptat', sursa: 'ai' }], indexConfirmari([conf(10, TIP_EXCEPTAT_PT, false)]), 10)
    expect(r.inchisa).toBe(false); expect(r.eticheta).toMatch(/invalidată/)
  })
  it('PT: confirmare fără legătură exceptat nu închide nimic', () => {
    expect(stareExceptarePT([{ fel: 'capitol' }], indexConfirmari([conf(10, TIP_EXCEPTAT_PT, true)]), 10).inchisa).toBe(false)
  })
})

describe('J02b — contoare acoperire', () => {
  const cer = [
    { id: 1, tip: 'eliminatorie', stare: 'nu_se_aplica' }, // stare veche de om, fără amprentă
    { id: 2, tip: 'eliminatorie' },                          // AI nsa, confirmat valid
    { id: 3, tip: 'eliminatorie' },                          // AI nsa, confirmare invalidată
    { id: 4, tip: 'propunere' },                             // AI nsa, neconfirmat
    { id: 5, tip: 'eliminatorie' },                          // acoperit
  ]
  const acop = { 1: { status: 'nu_se_aplica' }, 2: { status: 'nu_se_aplica' }, 3: { status: 'nu_se_aplica' }, 4: { status: 'nu_se_aplica' }, 5: { status: 'acoperit' } }
  it('AI-only nsa rămâne în alarmă; doar confirmarea validă scoate cerința', () => {
    const s = statisticiAcoperire(cer, acop, indexConfirmari([conf(2, TIP_NSA, true), conf(3, TIP_NSA, false)]))
    expect(s.nuSeAplica).toBe(1)
    expect(s.naElim).toBe(2)          // 1 (stare veche) + 3 (invalidată)
    expect(s.nsaPropuseAI).toBe(3)    // 1, 3, 4
    expect(s.nsaInvalidate).toBe(1)
    expect(s.elimFaraDovada).toBe(2)
    expect(s.acoperit).toBe(1)
  })
  it('fără confirmări (view lipsă) ⇒ toate eliminatoriile nsa în alarmă', () => {
    const s = statisticiAcoperire(cer, acop, indexConfirmari([]))
    expect(s.nuSeAplica).toBe(0); expect(s.naElim).toBe(3); expect(s.elimFaraDovada).toBe(3)
  })
  it('neevaluate și reverificare păstrează semantica veche', () => {
    const s = statisticiAcoperire([{ id: 9, tip: 'eliminatorie' }, { id: 8, tip: 'eliminatorie' }],
      { 8: { status: 'acoperit', reverificare_ceruta: true } }, indexConfirmari([]))
    expect(s.neevaluateElim).toBe(1); expect(s.reverifElim).toBe(1); expect(s.elimFaraDovada).toBe(2)
  })
})

import { evalueazaPoarta } from './ofertarePoarta.js'
describe('J02b — poarta PT (rândul „Cerințe fără capitol”)', () => {
  it('exceptări doar propuse (view după migrare: fara_capitol le include) ⇒ block și mesaj vizibil', () => {
    const r = evalueazaPoarta({ capitole: 3, de_raspuns: 10, fara_capitol: 2, exceptate_propuse_ai: 2 }).randuri.find(x => x.k === 'fara')
    expect(r.stare).toBe('block')
    expect(r.detalii).toMatch(/2 exceptate doar propus/)
  })
  it('fără exceptări propuse ⇒ niciun text în plus', () => {
    const r = evalueazaPoarta({ capitole: 3, de_raspuns: 10, fara_capitol: 0 }).randuri.find(x => x.k === 'fara')
    expect(r.stare).toBe('ok'); expect(r.detalii).not.toMatch(/propus/)
  })
})

describe('J02b runda 2 — propunerea concretă (id maxim, ca în BD)', () => {
  it('exceptat: legătura cea mai nouă; capitolele nu contează', () => {
    const ls = [{ id: 5, cerinta_id: 1, fel: 'exceptat' }, { id: 9, cerinta_id: 1, fel: 'exceptat' }, { id: 12, cerinta_id: 1, fel: 'capitol' }, { id: 20, cerinta_id: 2, fel: 'exceptat' }]
    expect(propunereCurenta(ls, 1, TIP_EXCEPTAT_PT)).toBe(9)
    expect(propunereCurenta(ls, 3, TIP_EXCEPTAT_PT)).toBe(null)
  })
  it('nu_se_aplica: rândul AI cel mai nou; fără rând ⇒ null (decizie fără propunere)', () => {
    const ac = [{ id: 3, cerinta_id: 1, status: 'nu_se_aplica' }, { id: 7, cerinta_id: 1, status: 'gol' }, { id: 4, cerinta_id: 1, status: 'nu_se_aplica' }]
    expect(propunereCurenta(ac, 1, TIP_NSA)).toBe(4)
    expect(propunereCurenta(ac, 2, TIP_NSA)).toBe(null)
    expect(propunereCurenta(null, 1, TIP_NSA)).toBe(null)
  })
  it('tip necunoscut ⇒ null', () => {
    expect(propunereCurenta([{ id: 1, cerinta_id: 1, fel: 'exceptat', status: 'nu_se_aplica' }], 1, 'altceva')).toBe(null)
  })
})
