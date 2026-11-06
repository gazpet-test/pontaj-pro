import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DOMENII_OFICIALE, analizeaza, verdict, urlOficial, surseAfisabile, imparteRaspuns } from './intrebariSurse.js'

const CAZURI = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_validare.json', 'utf8'))
const LISTA = ['legislatie.just.ro', 'monitoruloficial.ro', 'iscir.ro', 'anre.ro', 'isc.gov.ro', 'igsu.ro',
  'transgaz.ro', 'anap.gov.ro', 'e-licitatie.ro', 'eur-lex.europa.eu', 'magazin.asro.ro']

// lista din alt fișier: șirurile dintre „NUME = (” / „NUME = [” și paranteza de închidere (domeniile n-au paranteze)
function domeniiDin(fisier, nume) {
  const t = readFileSync(fisier, 'utf8')
  const i = t.indexOf(nume)
  expect(i).toBeGreaterThan(-1)
  const sf = t.indexOf(nume.endsWith('(') ? ')' : ']', i + nume.length)
  return [...t.slice(i + nume.length, sf).matchAll(/'([^']*)'/g)].map(m => m[1])
}

describe('verdict și surse (aceleași cazuri ca unittest)', () => {
  for (const c of CAZURI) {
    it(c.nume, () => {
      const a = analizeaza(c.text, c.ids)
      expect(a.verdict).toBe(c.verdict)
      expect(a.fara_sursa.length).toBe(c.fara_sursa)
      expect(a.citate).toEqual(c.citate)
      expect(a.necunoscute).toEqual(c.necunoscute)
    })
  }
  it('verdictul e prima linie nevidă', () => {
    expect(verdict('\n\nNu, nu e nevoie [C1].\nDa în altă linie')).toBe('Nu, nu e nevoie [C1].')
    expect(verdict('Analiză\nDa')).toBe(null)
    expect(verdict('')).toBe(null)
  })
  it('refuzul afirmațiilor fără sursă', () => {
    expect(analizeaza('Da.\n- art. 5 din HG 273/1994', ['C1']).fara_sursa).toEqual(['- art. 5 din HG 273/1994'])
    expect(analizeaza('Da.\n- art. 5 din HG 273/1994 [C1]', ['C1']).fara_sursa).toEqual([])
    expect(analizeaza('Da.\n- art. 5 din HG 273/1994 [C2]', ['C1']).fara_sursa).toHaveLength(1)
    expect(analizeaza('Da.\n- Nu am găsit sursa oficială pentru art. 5 din HG 273/1994.', []).fara_sursa).toEqual([])
  })
  it('împărțirea pentru ecran', () => {
    expect(imparteRaspuns('**Verdict:** Da [W1]\n\n- motiv [W1]')).toEqual({ verdict: 'Da [W1]', rest: '- motiv [W1]' })
    expect(imparteRaspuns('**Pe scurt**\ntext')).toEqual({ verdict: null, rest: '**Pe scurt**\ntext' })
  })
})

describe('domenii oficiale', () => {
  it('lista fixă', () => { expect(DOMENII_OFICIALE).toEqual(LISTA) })
  it('aceeași listă în worker (Python) și în edge', () => {
    expect(domeniiDin('worker/intrebari-tehnice/cercetare.py', 'DOMENII_OFICIALE = (')).toEqual(LISTA)
    expect(domeniiDin('supabase/functions/intrebari-tehnice-worker/index.ts', 'const DOMENII_OFICIALE = [')).toEqual(LISTA)
  })
  it('URL-uri', () => {
    expect(urlOficial('https://legislatie.just.ro/Public/DetaliiDocument/1')).toBe(true)
    expect(urlOficial('https://www.iscir.ro/x')).toBe(true)
    for (const u of ['https://iscir.ro.evil.com/', 'https://eviliscir.ro/', 'javascript:alert(1)', 'ftp://anre.ro/', 'https://u:p@anre.ro/', '', null])
      expect(urlOficial(u)).toBe(false)
  })
  it('sursele afișabile: web doar oficial, corpus doar docs/', () => {
    expect(surseAfisabile([
      { id: 'W1', tip: 'web', url: 'https://anre.ro/a', titlu: 'A' },
      { id: 'W2', tip: 'web', url: 'https://rau.com/a' },
      { id: 'C1', tip: 'corpus', cale: 'docs/cercetare/a.md', titlu: 'B', extras: 'x' },
      { id: 'C2', tip: 'corpus', cale: '../a.md' },
      { id: 'X', tip: 'web', url: 'https://anre.ro/' },
    ]).map(s => s.id)).toEqual(['W1', 'C1'])
    expect(surseAfisabile(null)).toEqual([])
  })
})
