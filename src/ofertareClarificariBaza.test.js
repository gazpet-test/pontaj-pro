import { describe, it, expect } from 'vitest'
import { stareBazaCiorna, deExportat, poateAcceptaExceptieIdentitate, eCiornaAutomata, MESAJ_SCHIMBATA } from './ofertareClarificariBaza.js'

// TKT-2026-0329 A (PR-UI Task 10, inventar #1): circuitul ciornelor automate se extinde EXPLICIT la auto_surse_* (spec §3.5)
describe('eCiornaAutomata — auto_planse_* și auto_surse_*', () => {
  it('auto_surse_x și auto_planse_x sunt automate; auto_sursex, manual, fără cheie nu', () => {
    expect(eCiornaAutomata({ cheie: 'auto_surse_x' })).toBe(true)
    expect(eCiornaAutomata({ cheie: 'auto_surse_0123456789abcdef' })).toBe(true)
    expect(eCiornaAutomata({ cheie: 'auto_planse_1' })).toBe(true)
    expect(eCiornaAutomata({ cheie: 'auto_sursex' })).toBe(false)
    expect(eCiornaAutomata({ cheie: 'manual' })).toBe(false)
    expect(eCiornaAutomata({ cheie: 'xauto_surse_1' })).toBe(false)
    expect(eCiornaAutomata({ cheie: null })).toBe(false)
    expect(eCiornaAutomata(null)).toBe(false)
  })
})

describe('stările bazei pentru auto_surse_* (ofertare_semnal_baza_stare, 20270112a §9a)', () => {
  const qs = { id: 2, cheie: 'auto_surse_0123456789abcdef', status: 'de_trimis', intrebare: 'Text verificat' }
  const rs = (stare, text, extra = {}) => ({ id: 2, stare, text, amprenta_curenta: 'tok', marcaj_planse: false, detalii: { evaluare: 'surse_v1', mod_ciorna: 'surse' }, ...extra })
  const st = r => stareBazaCiorna(qs, new Map([[2, r]]), null)
  it('evaluare_in_curs blochează cu textul serverului', () => {
    const r = rs('evaluare_in_curs', 'baza s-a schimbat — de reverificat')
    expect(st(r)).toMatchObject({ nivel: 'evaluare_in_curs', blocheaza: true, text: 'baza s-a schimbat — de reverificat', rand: r })
    expect(deExportat([qs], [r], null)).toEqual({ incluse: [], excluse: [{ q: qs, motiv: 'baza s-a schimbat — de reverificat' }] })
  })
  it('fara_diferenta blochează (verdictul nu mai e „diferență” — nu mai e nimic de întrebat)', () => {
    const r = rs('fara_diferenta', 'baza s-a schimbat — de reverificat')
    expect(st(r)).toMatchObject({ nivel: 'fara_diferenta', blocheaza: true, text: 'baza s-a schimbat — de reverificat' })
    expect(deExportat([qs], [r], null).incluse).toEqual([])
  })
  it('rezolvata_de_raspuns blochează cu textul serverului', () => {
    const txt = 'semnal rezolvat prin răspunsul Autorității — ciorna nu mai e necesară'
    expect(st(rs('rezolvata_de_raspuns', txt))).toMatchObject({ nivel: 'rezolvata_de_raspuns', blocheaza: true, text: txt })
    expect(deExportat([qs], [rs('rezolvata_de_raspuns', txt)], null).excluse[0].motiv).toBe(txt)
  })
  it('fără text de la server → mesajul unic „baza s-a schimbat”', () => {
    for (const s of ['evaluare_in_curs', 'fara_diferenta', 'rezolvata_de_raspuns']) expect(st(rs(s, null)).text).toBe(MESAJ_SCHIMBATA)
  })
  it('ok pe o ciornă de surse (marcaj_planse e mereu false) → nu blochează; necesita_review / schimbata / indisponibila blochează ca la planșe', () => {
    expect(st(rs('ok', 'Text aprobat de om pe evaluarea publicată, actuală.'))).toMatchObject({ nivel: 'ok', blocheaza: false, text: '' })
    for (const s of ['necesita_review', 'schimbata', 'indisponibila']) expect(st(rs(s, 'x')).blocheaza, s).toBe(true)
  })
  it('o ciornă auto_surse_* retrasă nu are stare de bază (na)', () => {
    expect(stareBazaCiorna({ ...qs, status: 'retrasa' }, new Map(), null)).toEqual({ nivel: 'na', blocheaza: false, text: '' })
  })
})

const q = { id: 1, cheie: 'auto_planse_test', status: 'de_trimis', intrebare: 'Text verificat' }
const avertisment = 'Identitate limitată: nu putem detecta înlocuirea fișierului cu alt conținut la aceeași cale și aceeași mărime (documente: #8 F3.pdf).'
const row = (stare, extra = {}) => ({ id: 1, stare, text: avertisment, amprenta_curenta: 'token-curent',
  marcaj_planse: false, detalii: { avertisment_identitate: avertisment }, ...extra })
const state = r => stareBazaCiorna(q, new Map([[1, r]]), null)

describe('F04 — identitate limitată și excepție per ciornă', () => {
  it('contradicția blochează exportul și excepția, chiar cu o excepție anterioară', () => {
    const text = 'Identitate contradictorie: hash-uri diferite pentru același document (documente: #8 F3.pdf) — de rezolvat, nu se poate accepta prin excepție.'
    for (const exceptie_identitate_valida of [false, true]) {
      const r = row('identitate_contradictorie', { text, detalii: { exceptie_identitate_valida } })
      expect(state(r)).toMatchObject({ nivel: 'identitate_contradictorie', blocheaza: true, text })
      expect(deExportat([q], [r], null)).toEqual({ incluse: [], excluse: [{ q, motiv: text }] })
      for (const status of ['propunere', 'de_trimis']) {
        expect(poateAcceptaExceptieIdentitate({ ...q, status }, state(r), true)).toBe(false)
      }
    }
  })
  it('contradicția păstrează explicația din detalii sau mesajul explicit de refuz', () => {
    const text = 'Identitate contradictorie: document #8 — de rezolvat.'
    expect(state(row('identitate_contradictorie', { text: '', detalii: { avertisment_identitate: text } })).text).toBe(text)
    const st = state(row('identitate_contradictorie', { text: '', detalii: {} }))
    expect(st.blocheaza).toBe(true)
    expect(st.text).toContain('nu se poate accepta prin excepție')
  })
  it('identitatea limitată blochează exportul și păstrează explicația nominală', () => {
    const r = row('identitate_limitata')
    expect(state(r)).toMatchObject({ nivel: 'identitate_limitata', blocheaza: true, text: avertisment })
    expect(deExportat([q], [r], null)).toEqual({ incluse: [], excluse: [{ q, motiv: avertisment }] })
  })
  it('excepția și reconfirmarea validate de server permit exportul cu avertisment vizibil', () => {
    const r = row('ok_identitate_limitata')
    expect(state(r)).toMatchObject({ nivel: 'ok_identitate_limitata', blocheaza: false, text: avertisment })
    expect(deExportat([q], [r], null)).toEqual({ incluse: [q], excluse: [] })
  })
  it('starea permisă nu suprimă marcajul planșelor sau editarea locală', () => {
    const r = row('ok_identitate_limitata', { marcaj_planse: true })
    expect(state(r).blocheaza).toBe(true)
    expect(state(r).text).toContain(avertisment)
    expect(deExportat([q], [r], null).incluse).toEqual([])
    expect(deExportat([{ ...q, _mod: true }], [row('ok_identitate_limitata')], null).incluse).toEqual([])
    expect(deExportat([{ ...q, sursa: 'plansa,revizie_planse_auto' }], [row('ok_identitate_limitata')], null).incluse).toEqual([])
  })
  it('schimbarea bazei sau lipsa controlului refuză din nou', () => {
    for (const stare of ['identitate_limitata', 'schimbata', 'necesita_review', 'indisponibila', 'necunoscuta']) {
      expect(deExportat([q], [row(stare)], null).incluse).toEqual([])
    }
    expect(deExportat([q], [], null).incluse).toEqual([])
    expect(deExportat([q], [row('ok_identitate_limitata')], 'eroare API').incluse).toEqual([])
  })
  it('butonul cere drept explicit, ciornă salvată și amprentă disponibilă', () => {
    const st = state(row('identitate_limitata'))
    expect(poateAcceptaExceptieIdentitate(q, st, true)).toBe(true)
    for (const drept of [false, undefined, null]) expect(poateAcceptaExceptieIdentitate(q, st, drept)).toBe(false)
    for (const status of ['trimisa', 'raspunsa', 'retrasa']) expect(poateAcceptaExceptieIdentitate({ ...q, status }, st, true)).toBe(false)
    expect(poateAcceptaExceptieIdentitate({ ...q, _mod: true }, st, true)).toBe(false)
    expect(poateAcceptaExceptieIdentitate({ ...q, cheie: null }, st, true)).toBe(false)
    expect(poateAcceptaExceptieIdentitate(q, { ...st, rand: {} }, true)).toBe(false)
    expect(poateAcceptaExceptieIdentitate(q, state(row('ok')), true)).toBe(false)
    expect(poateAcceptaExceptieIdentitate(q, state(row('ok_identitate_limitata')), true)).toBe(false)
    expect(poateAcceptaExceptieIdentitate(q, state(row('identitate_limitata', { detalii: { exceptie_identitate_valida: true } })), true)).toBe(false)
  })
  it('manifestul verificat continuă pe starea ok obișnuită', () => {
    expect(state(row('ok', { text: '' }))).toMatchObject({ nivel: 'ok', blocheaza: false, text: '' })
    expect(deExportat([q], [row('ok')], null).incluse).toEqual([q])
  })
})
