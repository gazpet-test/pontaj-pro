import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NORME, NORME_LABELS, NORME_RETRASE, NORME_SELECTOR, NORME_SELECTOR_ISTORIC, NORME_ORE, DATA_CODURI_NOI, codNorma, optiuniSelectorNorma, ziCuCoduriIstorice } from './pontajNorme.js'

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
  // Listele pe perioade, scrise de mână: octombrie = codurile de pe main dinainte de tichet (VECHI),
  // noiembrie = VECHI fără CM / O, cu IP după M.
  const NOU = ['BO', 'BP', 'AM', 'CO', 'CFP', 'M', 'IP', 'N', 'PRM', 'PRB', 'LL']
  const ZILE_VECHI = ['2026-09-15', '2026-10-01', '2026-10-15', '2026-10-31', '2025-12-31']
  const ZILE_NOI = ['2026-11-01', '2026-11-02', '2026-11-30', '2026-12-15', '2027-01-04']

  it('trecerea e pe 01.11.2026', () => {
    expect(DATA_CODURI_NOI).toBe('2026-11-01')
    expect(ziCuCoduriIstorice('2026-10-31')).toBe(true)
    expect(ziCuCoduriIstorice('2026-11-01')).toBe(false)
  })
  it('zi din octombrie (și mai vechi): CM și O disponibile, fără IP', () => {
    for (const zi of ZILE_VECHI) for (const cur of ['', null, undefined, 'BO', 'CO']) {
      const o = optiuniSelectorNorma(cur, zi)
      expect(o, `${zi} / ${cur}`).toEqual(VECHI)
      expect(o).toContain('CM')
      expect(o).toContain('O')
      expect(o).not.toContain('IP')
    }
    expect(NORME_SELECTOR_ISTORIC).toEqual(VECHI)
  })
  it('zi din noiembrie (și după): fără CM și O, cu BO și IP', () => {
    for (const zi of ZILE_NOI) for (const cur of ['', null, undefined, 'BO', 'IP', 'CO']) {
      const o = optiuniSelectorNorma(cur, zi)
      expect(o, `${zi} / ${cur}`).toEqual(NOU)
      expect(o).not.toContain('CM')
      expect(o).not.toContain('O')
    }
  })
  it('valoarea existentă rămâne în listă, chiar dacă nu e a perioadei (nu se pierde la editare)', () => {
    // CM / O salvate pe o zi din noiembrie (înainte de corectura datelor)
    expect(optiuniSelectorNorma('CM', '2026-11-05')).toEqual([...NOU, 'CM'])
    expect(optiuniSelectorNorma('O', '2026-11-05')).toEqual([...NOU, 'O'])
    expect(optiuniSelectorNorma('CM', '2026-11-05')).not.toContain('O')
    // IP salvat pe o zi din octombrie
    expect(optiuniSelectorNorma('IP', '2026-10-20')).toEqual([...VECHI, 'IP'])
    // CM / O pe octombrie: deja în listă, fără dubluri
    expect(optiuniSelectorNorma('CM', '2026-10-20')).toEqual(VECHI)
    expect(optiuniSelectorNorma('O', '2026-10-20')).toEqual(VECHI)
    // cod necunoscut deja salvat: rămâne afișat, nu dispare
    expect(optiuniSelectorNorma('XZ', '2026-11-05')).toEqual([...NOU, 'XZ'])
  })
  it('dată lipsă sau în alt format = lista curentă (fără CM / O), nu lista istorică', () => {
    for (const zi of [undefined, null, '', '2026-10', '15.10.2026', '2026-10-15T00:00:00Z', 20261015]) {
      expect(ziCuCoduriIstorice(zi), String(zi)).toBe(false)
      expect(optiuniSelectorNorma('', zi)).toEqual(NOU)
    }
    expect(NORME_SELECTOR).toEqual(NOU)
  })
  it('App.jsx: selectorul folosește optiuniSelectorNorma cu ziua pontată, nu toată lista NORME', () => {
    const src = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/\{optiuniSelectorNorma\(norma,selectedDate\)\.map\(n=><option key=\{n\} value=\{n\}>/)
    // PontajRow primește ziua selectată în pagina de pontaj
    expect(src).toMatch(/<PontajRow [^\n]*selectedDate=\{date\}/)
    expect(src).toMatch(/function PontajRow\(\{[^}]*selectedDate[^}]*\}\)/)
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
