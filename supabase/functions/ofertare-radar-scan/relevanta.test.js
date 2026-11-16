import { describe, it, expect } from 'vitest'
import { esteRelevant, detectSeg, CPV_OK, KEYWORDS, EXCLUDE } from './relevanta.js'

describe('esteRelevant — cazurile din cerere', () => {
  const cazuri = [
    ['Interconectare conducte DN800 cu DN400', '45255121-3 - Lucrari de constructii de instalatii de suprafata', true],
    ['Lucrari de constructii de instalatii de suprafata - 2 loturi', '45255121-3', true],
    ['Alimentarea cu a doua linie electrica a statiei de comprimare', '45231400-9', false],
    ['Infiintare sistem de distributie gaze naturale', '45231221-0', true],
    ['Furnizare oxigen medicinal', '24111500-0 - Gaze medicale', false],
  ]
  for (const [titlu, cpv, asteptat] of cazuri) {
    it(`${titlu} | ${cpv} -> ${asteptat ? 'relevant' : 'nerelevant'}`, () => {
      expect(esteRelevant(titlu, cpv)).toBe(asteptat)
    })
  }
})

describe('esteRelevant — ordinea regulilor', () => {
  it('excluderea bate CPV-ul 45255 (linie electrica)', () => {
    expect(esteRelevant('Mutare linie electrica', '45255121-3')).toBe(false)
  })
  it('cuvantul-cheie bate excluderea', () => {
    expect(esteRelevant('Retea de gaze si iluminat public', '45316110-9')).toBe(true)
  })
  it('bransamentul trece fara CPV potrivit, dar dupa excluderi', () => {
    expect(esteRelevant('Branșamente consumatori', '45000000-7')).toBe(true)
    expect(esteRelevant('Bransament 0,4 kv', '45000000-7')).toBe(false)
  })
  it('diacriticele nu conteaza', () => {
    expect(esteRelevant('Rețea de gaze naturale', '45000000-7')).toBe(true)
    expect(esteRelevant('Linie electrică', '45255000-7')).toBe(false)
  })
  it('CPV-ul se potriveste doar ca prefix', () => {
    expect(esteRelevant('Lucrari', '45255')).toBe(true)
    expect(esteRelevant('Lucrari', 'x45255')).toBe(false)
    expect(esteRelevant('Lucrari', '45250000-4')).toBe(false)
    expect(esteRelevant(null, null)).toBe(false)
  })
})

describe('listele', () => {
  it('CPV_OK = lista veche + 45255', () => {
    expect(CPV_OK).toEqual(['45231', '45232', '45255', '45333', '65210', '65200'])
  })
  // Asteptarile = copia literala a listelor din index.ts de pe main (8ce0a29a), inainte de mutarea in relevanta.js:
  // verificam continutul si ordinea, nu doar numarul (review #1110 P3).
  it('KEYWORDS neschimbate (continut si ordine)', () => {
    expect(KEYWORDS).toEqual([
      'gaze naturale', 'gaz metan', 'distributie gaze', 'transport gaze', 'retea de gaze', 'retele de gaze',
      'conducta de gaz', 'conducte de gaz', 'bransament gaz', 'bransamente gaz', 'statie de reglare', 'srm ',
      'alimentare cu apa', 'retea de apa', 'retele de apa', 'canalizare', 'aductiune', 'apa uzata', 'gospodarie de apa',
    ])
  })
  it('EXCLUDE neschimbate (continut si ordine)', () => {
    expect(EXCLUDE).toEqual([
      ' lea ', 'lea 0,4', '0,4 kv', '0.4 kv', '20 kv', '110 kv', 'linii electrice', 'linie electrica',
      'retele electrice', 'retea electrica', 'electricitate', 'iluminat public', 'post de transformare',
      'posturi de transformare', 'anvelopat', 'fibra optica', '45231400', '45231600', '45231500',
    ])
  })
})

describe('detectSeg', () => {
  it('segmentele', () => {
    expect(detectSeg('SNTGN TRANSGAZ SA', 'Lucrari', '45255121-3')).toBe('transgaz')
    expect(detectSeg('SNGN ROMGAZ SA', 'Lucrari', '')).toBe('romgaz')
    expect(detectSeg('CONPET SA', 'Lucrari', '')).toBe('conpet')
    expect(detectSeg('Comuna Test', 'Retea gaze', '')).toBe('distributie')
    expect(detectSeg('Comuna Test', 'Apa', '')).toBe('altele')
  })
})
