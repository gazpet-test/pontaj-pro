import { describe, it, expect } from 'vitest'
import { stareBazaCiorna, deExportat, poateAcceptaExceptieIdentitate } from './ofertareClarificariBaza.js'

const q = { id: 1, cheie: 'auto_planse_test', status: 'de_trimis', intrebare: 'Text verificat' }
const avertisment = 'Identitate limitată: nu putem detecta înlocuirea fișierului cu alt conținut la aceeași cale și aceeași mărime (documente: #8 F3.pdf).'
const row = (stare, extra = {}) => ({ id: 1, stare, text: avertisment, amprenta_curenta: 'token-curent',
  marcaj_planse: false, detalii: { avertisment_identitate: avertisment }, ...extra })
const state = r => stareBazaCiorna(q, new Map([[1, r]]), null)

describe('F04 — identitate limitată și excepție per ciornă', () => {
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
