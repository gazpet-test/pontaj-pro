import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pregatesteVocabular, compuneInterogari, interogareRespectata, canonInterogare } from './interogari.mjs'

// Aceleași cazuri ca test_cercetare.py (worker/intrebari-tehnice/teste_interogari.json), pe vocabularul real din repo.
const VOC_BRUT = JSON.parse(readFileSync('worker/intrebari-tehnice/vocabular_web.json', 'utf8'))
const VOC = pregatesteVocabular(VOC_BRUT)
const CAZURI = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_interogari.json', 'utf8'))

describe('vocabularul aprobat', () => {
  it('e valid (altfel workerul nu pornește)', () => {
    expect(VOC).not.toBe(null)
    expect(VOC.acte.size).toBe(VOC_BRUT.acte.length)
  })
  it('termeni: litere mici fără diacritice, fără dubluri, fără nume de firme / localități cunoscute', () => {
    expect(new Set(VOC_BRUT.termeni).size).toBe(VOC_BRUT.termeni.length)
    for (const t of VOC_BRUT.termeni) expect(t, t).toMatch(/^[a-z]{3,24}$/)
    for (const rau of ['gazpet', 'transgaz', 'delgaz', 'ploiesti', 'prahova', 'manastirea', 'popescu', 'brazi', 'valea', 'lunca'])
      expect(VOC_BRUT.termeni.includes(rau), rau).toBe(false)
  })
  it('vocabular stricat → null (fail closed)', () => {
    expect(pregatesteVocabular(null)).toBe(null)
    expect(pregatesteVocabular({ ...VOC_BRUT, versiune: '' })).toBe(null)
    expect(pregatesteVocabular({ ...VOC_BRUT, termeni: [...VOC_BRUT.termeni, 'Popescu'] })).toBe(null)    // majusculă
    expect(pregatesteVocabular({ ...VOC_BRUT, termeni: [...VOC_BRUT.termeni, 'sudura'] })).toBe(null)     // dublură
    expect(pregatesteVocabular({ ...VOC_BRUT, termeni: [...VOC_BRUT.termeni, 'pe100'] })).toBe(null)      // cifre
    expect(pregatesteVocabular({ ...VOC_BRUT, acte: [...VOC_BRUT.acte, 'Contract 30/2025'] })).toBe(null) // nu e act după tipar
    expect(pregatesteVocabular({ ...VOC_BRUT, acte: [...VOC_BRUT.acte, 'Legea nr. 10/1995'] })).toBe(null) // aceeași cheie de două ori
  })
})

describe('compunerea interogărilor (aceleași cazuri ca unittest)', () => {
  for (const c of CAZURI.compunere) {
    it(c.nume, () => {
      const [q, aruncate] = compuneInterogari(c.propuse, VOC)
      expect(q).toEqual(c.interogari)
      expect(aruncate).toBe(c.aruncate)
      for (const x of q) expect(x.length).toBeLessThanOrEqual(80)
    })
  }
  it('fără vocabular sau fără listă → nimic', () => {
    expect(compuneInterogari(['sudura polietilena'], null)).toEqual([[], 0])
    expect(compuneInterogari('sudura polietilena', VOC)).toEqual([[], 0])
  })
  it('tot ce iese e format DOAR din cuvintele / actele vocabularului', () => {
    const permise = new Set([...VOC_BRUT.termeni, ...VOC_BRUT.acte.flatMap(a => a.split(' '))])
    for (const c of CAZURI.compunere) for (const q of compuneInterogari(c.propuse, VOC)[0]) {
      const rest = [...VOC_BRUT.acte].sort((a, b) => b.length - a.length).reduce((s, a) => s.split(a).join(' '), q)
      for (const w of rest.split(/\s+/).filter(Boolean)) expect(permise.has(w), `${w} în „${q}”`).toBe(true)
    }
  })
})

describe('interogarea executată = interogarea compusă', () => {
  for (const c of CAZURI.respectare) {
    it(`${JSON.stringify(c.executate)} vs „${c.compusa}”`, () => { expect(interogareRespectata(c.executate, c.compusa)).toBe(c.ok) })
  }
  it('forma canonică', () => { expect(canonInterogare('„Probă”  de PRESIUNE, NTPEE-2018')).toBe('proba de presiune ntpee 2018') })
})
