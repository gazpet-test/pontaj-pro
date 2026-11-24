import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NORME, NORME_LABELS, NORME_RETRASE, NORME_SELECTOR, NORME_ORE, codNorma, optiuniSelectorNorma } from './pontajNorme.js'

// TKT-2026-0368 partea B: BO în loc de CM (concediu medical), IP „Învoiri Plătite” în loc de O (libere speciale).
// Listele așteptate sunt scrise de mână (codurile de pe main înainte de tichet + IP), nu derivate din modul.
const VECHI = ['BO', 'BP', 'AM', 'CO', 'CFP', 'CM', 'M', 'O', 'N', 'PRM', 'PRB', 'LL']

describe('codurile de normă', () => {
  it('toate codurile vechi rămân valide, IP e adăugat', () => {
    for (const c of VECHI) expect(NORME).toContain(c)
    expect(NORME).toContain('IP')
    expect(NORME).toHaveLength(VECHI.length + 1)
    expect(new Set(NORME).size).toBe(NORME.length)
  })
  it('fiecare cod are etichetă; IP = „Învoiri Plătite”, etichetele vechi neschimbate', () => {
    for (const c of NORME) expect(NORME_LABELS[c], c).toMatch(/\S/)
    expect(NORME_LABELS.IP).toBe('Învoiri Plătite')
    expect(NORME_LABELS.CM).toBe('Concediu Medical')
    expect(NORME_LABELS.O).toBe('Obligații Cetățenești')
    expect(NORME_LABELS.BO).toBe('Boală Obișnuită')
  })
  it('IP se plătește cu ore de normă, ca O; CFP / N / LL fără ore', () => {
    expect(NORME_ORE).toEqual(['CO', 'CM', 'BO', 'BP', 'AM', 'M', 'O', 'IP'])
    for (const c of ['CFP', 'N', 'LL', 'PRM', 'PRB']) expect(NORME_ORE).not.toContain(c)
  })
})

describe('selectorul de normă (introducere pontaj)', () => {
  it('nu mai oferă CM și O; oferă BO și IP', () => {
    expect(NORME_RETRASE).toEqual(['CM', 'O'])
    expect(NORME_SELECTOR).not.toContain('CM')
    expect(NORME_SELECTOR).not.toContain('O')
    expect(NORME_SELECTOR).toContain('BO')
    expect(NORME_SELECTOR).toContain('IP')
    expect(NORME_SELECTOR).toEqual(['BO', 'BP', 'AM', 'CO', 'CFP', 'M', 'IP', 'N', 'PRM', 'PRB', 'LL'])
  })
  it('zi nouă / zi cu cod activ: fără CM și O', () => {
    for (const cur of ['', null, undefined, 'BO', 'IP', 'CO']) {
      const o = optiuniSelectorNorma(cur)
      expect(o).not.toContain('CM')
      expect(o).not.toContain('O')
    }
  })
  it('zi veche deja salvată cu CM / O: codul rămâne în listă (nu se pierde la editare)', () => {
    expect(optiuniSelectorNorma('CM')).toEqual([...NORME_SELECTOR, 'CM'])
    expect(optiuniSelectorNorma('O')).toEqual([...NORME_SELECTOR, 'O'])
    expect(optiuniSelectorNorma('CM')).not.toContain('O')
  })
  it('App.jsx: selectorul folosește optiuniSelectorNorma, nu toată lista NORME', () => {
    const src = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/\{optiuniSelectorNorma\(norma\)\.map\(n=><option key=\{n\} value=\{n\}>/)
    expect(src).not.toMatch(/NORME\.map\(n=><option/)
    // fără liste de coduri copiate local (o singură definiție, în pontajNorme.js)
    expect(src).not.toMatch(/\['BO','BP','AM','CO'/)
    expect(src).not.toMatch(/\['CO','CM','BO','BP'/)
    expect(src).not.toMatch(/const NORME_LABELS\s*=/)
  })
})

describe('importul din Excel (codNorma)', () => {
  it('recunoaște toate codurile, inclusiv cele retrase și IP, indiferent de litere mici / spații', () => {
    for (const c of VECHI) expect(codNorma(c)).toBe(c)
    expect(codNorma('ip')).toBe('IP')
    expect(codNorma(' cm ')).toBe('CM')
    expect(codNorma('o')).toBe('O')
  })
  it('valori care nu sunt coduri → null (orele, bifele, golurile merg pe ramura de ore)', () => {
    for (const v of ['', null, undefined, '08:00-16:00', '1', 'P', 'X', 'I', 'IPP', 'C O']) expect(codNorma(v)).toBeNull()
  })
})
