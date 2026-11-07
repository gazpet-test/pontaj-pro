import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DOMENII_OFICIALE, analizeaza, verdict, urlOficial, surseAfisabile, imparteRaspuns, eDeclaratieLipsa, ancore, interogariAfisabile } from './intrebariSurse.js'

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
      const a = analizeaza(c.text, c.surse)
      expect(a.verdict).toBe(c.verdict)
      expect(a.fara_sursa.length).toBe(c.fara_sursa)
      expect(a.neconfirmate.length).toBe(c.neconfirmate)
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
    expect(analizeaza('Da.\n- art. 5 din HG 273/1994 [C1]', [{ id: 'C1', extras: 'HG 273/1994, art. 5' }]).fara_sursa).toEqual([])
    expect(analizeaza('Da.\n- art. 5 din HG 273/1994 [C2]', ['C1']).fara_sursa).toHaveLength(1)
    // runda 2 (P1-b): declarația de lipsă scutește DOAR o linie care e exclusiv declarația, fără articol/cifră/obligație
    expect(analizeaza('Da.\n- Nu am găsit sursa oficială pentru art. 5 din HG 273/1994.', []).fara_sursa).toHaveLength(1)
    expect(analizeaza('Da.\n- Nu am găsit sursa oficială pentru distanța minimă.', []).fara_sursa).toEqual([])
    expect(analizeaza('Da.\nEste obligatoriu un responsabil autorizat.', ['C1']).fara_sursa).toHaveLength(1)
    // cifrele unei afirmații cu marcaj trebuie să apară în extrasul citat (ancora minimă)
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', [{ id: 'C1', extras: 'art. 999' }]).fara_sursa).toEqual([])
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', [{ id: 'C1', extras: 'art. 9990' }]).neconfirmate).toHaveLength(1)
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', ['C1']).neconfirmate).toHaveLength(1)   // fără extras: nimic de confirmat
  })
  it('declarația de lipsă și ancorele', () => {
    expect(eDeclaratieLipsa('Nu am gasit sursa oficiala pentru X — trebuie consultat textul consolidat.')).toBe(true)
    for (const rau of ['Proba e la 99 bar; nu am găsit sursa oficială pentru alt detaliu.', 'Nu am găsit sursa oficială pentru X; e obligatoriu Y.',
      'Nu am găsit sursa oficială pentru X. Distanța e 2 m.', 'Nu am găsit sursa oficială pentru X, dar e interzis.'])
      expect(eDeclaratieLipsa(rau)).toBe(false)
    expect(ancore('1. Distanța e 0,5 m față de art. 12 [C1, W2]')).toEqual(['0.5', '12'])
  })
  it('împărțirea pentru ecran', () => {
    expect(imparteRaspuns('**Verdict:** Da [W1]\n\n- motiv [W1]')).toEqual({ verdict: 'Da [W1]', rest: '- motiv [W1]', incert: false })
    expect(imparteRaspuns('**Pe scurt**\ntext')).toEqual({ verdict: null, rest: '**Pe scurt**\ntext', incert: false })
    expect(imparteRaspuns('Incert — de verificat: x\n\nrest').incert).toBe(true)
  })
  it('interogările pentru audit', () => {
    expect(interogariAfisabile(['a b', 3, '', 'x'.repeat(300)])).toEqual(['a b', 'x'.repeat(200)])
    expect(interogariAfisabile(null)).toEqual([])
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
