import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DOMENII_OFICIALE, STOP, GENERICE, analizeaza, curataRaspuns, verdict, urlOficial, surseAfisabile, imparteRaspuns, eDeclaratieLipsa,
  ancore, interogariAfisabile, termeniCheie, normalizeaza, tokeniNumerici, polaritati, propozitii, eAfirmatieNormativa,
  lipsesteMigrarea, actiuniIntrebare, restrictii, prezentareRaspuns, aplicaRegulaB, cereCitat, tipVerdict, CITAT_MIN_CUVINTE,
  INCERT_REGULA_B, formaCitat, propozitiiCitat } from './intrebariSurse.js'
import * as S from './intrebariSurse.js'

const CAZURI = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_validare.json', 'utf8'))
const NORMATIVE = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_normative.json', 'utf8'))
const LISTA = ['legislatie.just.ro', 'monitoruloficial.ro', 'anre.ro', 'isc.gov.ro', 'igsu.ro',
  'transgaz.ro', 'anap.gov.ro', 'e-licitatie.ro', 'eur-lex.europa.eu', 'magazin.asro.ro']

// cuvintele dintr-un frozenset('''...''') din cercetare.py (paritate STOP / GENERICE)
function cuvintePython(nume) {
  const t = readFileSync('worker/intrebari-tehnice/cercetare.py', 'utf8')
  const m = t.match(new RegExp(`^${nume} = (?:frozenset|set)\\('''([^']*)'''`, 'm'))
  expect(m).not.toBe(null)
  return new Set(m[1].split(/\s+/).filter(Boolean))
}

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
      expect(a.nesustinute.length).toBe(c.nesustinute)
      expect(a.citate).toEqual(c.citate)
      expect(a.necunoscute).toEqual(c.necunoscute)
      if ('temei' in c) expect(a.temei).toBe(c.temei)
    })
  }
  for (const c of CAZURI.filter(x => 'final_incert' in x)) {
    it(`după curățare: ${c.nume}`, () => {
      const [text, scoase] = curataRaspuns(c.text, c.surse)
      expect(scoase).toBe(c.final_scoase)
      expect(normalizeaza(verdict(text) ?? '').startsWith('incert')).toBe(c.final_incert)
      if (c.final_incepe) expect(text.startsWith(c.final_incepe)).toBe(true)
      if (c.final_nu_contine) expect(text).not.toContain(c.final_nu_contine)
      expect(analizeaza(text, c.surse).fara_sursa).toEqual([])   // după curățare nu mai rămâne nimic de scos
    })
  }
  it('STOP și GENERICE sunt aceleași ca în cercetare.py', () => {
    expect([...STOP].sort()).toEqual([...cuvintePython('STOP')].sort())
    expect([...GENERICE].sort()).toEqual([...cuvintePython('GENERICE')].sort())
  })
  it('termenii-cheie', () => {
    expect(termeniCheie('Este obligatoriu un responsabil autorizat [C1].')).toEqual(['respon', 'autori'])
    expect(termeniCheie('1. Conform art. 12 din PT C9 [W1]')).toEqual([])
  })
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
    // runda 3: TOATE cifrele unei afirmații cu marcaj trebuie să apară în sursele citate (nu doar una)
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', [{ id: 'C1', extras: 'art. 999' }]).neconfirmate).toHaveLength(1)
    // runda 4: „impune” cere și o obligație („trebuie”) în propoziția care are „99 bar”
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', [{ id: 'C1', extras: 'art. 999, 99 bar' }]).nesustinute).toHaveLength(1)
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', [{ id: 'C1', extras: 'art. 999: proba trebuie făcută la 99 bar' }]).fara_sursa).toEqual([])
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1, W1].', [{ id: 'C1', extras: 'art. 999' }, { id: 'W1', extras: 'Proba trebuie făcută la 99 bar.' }]).fara_sursa).toEqual([])
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', [{ id: 'C1', extras: 'art. 9990' }]).neconfirmate).toHaveLength(1)
    expect(analizeaza('Da.\nArt. 999 impune 99 bar [C1].', ['C1']).neconfirmate).toHaveLength(1)   // fără extras: nimic de confirmat
    // runda 3: suport lexical — o sursă fără extras nu susține nicio afirmație cu termeni
    expect(analizeaza('Da.\nEste obligatoriu un responsabil autorizat [C1].', ['C1']).nesustinute).toHaveLength(1)
  })
  it('declarația de lipsă și ancorele', () => {
    expect(eDeclaratieLipsa('Nu am gasit sursa oficiala pentru X — trebuie consultat textul consolidat.')).toBe(true)
    for (const rau of ['Proba e la 99 bar; nu am găsit sursa oficială pentru alt detaliu.', 'Nu am găsit sursa oficială pentru X; e obligatoriu Y.',
      'Nu am găsit sursa oficială pentru X. Distanța e 2 m.', 'Nu am găsit sursa oficială pentru X, dar e interzis.'])
      expect(eDeclaratieLipsa(rau)).toBe(false)
    // runda 4: token complet = semn + număr + unitate
    expect(ancore('1. Distanța e 0,5 m față de art. 12 [C1, W2]')).toEqual(['0.5 m', '12'])
    expect(ancore('Proba se face la −5 bar [C1]')).toEqual(['-5 bar'])
  })
  it('runda 4: tokeni, tipul regulii și propozițiile (aceleași cazuri ca unittest)', () => {
    for (const t of NORMATIVE.tokeni) expect(tokeniNumerici(normalizeaza(t.text)), t.text).toEqual(t.tokeni)
    for (const t of NORMATIVE.polaritati) {
      const n = normalizeaza(t.text)
      expect(polaritati(n), t.text).toEqual(t.clase)
      expect(polaritati(n, true), t.text).toEqual(t.extins ?? t.clase)
    }
    for (const t of NORMATIVE.propozitii) expect(propozitii(t.text), t.text).toEqual(t.propozitii)
    // runda 5 (review r4 P1): restricțiile din sursă
    for (const t of NORMATIVE.restrictii) expect(restrictii(normalizeaza(t.text)).map(([g, x]) => [g, x.trim()]), t.text).toEqual(t.restrictii)
  })
  it('runda 4: termenii unei afirmații normative nu se adună din propoziții diferite', () => {
    const s = [{ id: 'C1', extras: 'Recepția lucrărilor se face la final. Un responsabil trebuie numit.' }]
    expect(analizeaza('Da.\nEste obligatoriu un responsabil pentru recepția lucrărilor [C1].', s).nesustinute).toHaveLength(1)
    expect(eAfirmatieNormativa('Nu se poate stabili din surse.')).toBe(false)     // fără marcaj, „nu se poate” nu e o regulă
    expect(eAfirmatieNormativa('Distanța minimă față de clădiri.')).toBe(false)   // „minim” ca adjectiv, fără cifră
    expect(eAfirmatieNormativa('Trebuie cel puțin un RTS.')).toBe(true)
  })
  it('împărțirea pentru ecran', () => {
    expect(imparteRaspuns('**Verdict:** Da [W1]\n\n- motiv [W1]')).toEqual({ verdict: 'Da [W1]', rest: '- motiv [W1]', incert: false })
    expect(imparteRaspuns('**Pe scurt**\ntext')).toEqual({ verdict: null, rest: '**Pe scurt**\ntext', incert: false })
    expect(imparteRaspuns('Incert — de verificat: x\n\nrest').incert).toBe(true)
  })
  it('runda 4 (condiția de merge): cu migrarea neaplicată, ecranul nu arată butoanele ale căror RPC-uri lipsesc', () => {
    // eroarea PostgREST la coloanele noi = migrarea lipsește; altă eroare nu e confundată cu ea
    expect(lipsesteMigrarea({ message: 'column intrebari_tehnice.surse does not exist' })).toBe(true)
    expect(lipsesteMigrarea({ message: 'column intrebari_tehnice.interogari_web does not exist' })).toBe(true)
    expect(lipsesteMigrarea({ message: 'permission denied for table intrebari_tehnice' })).toBe(false)
    expect(lipsesteMigrarea(null)).toBe(false)
    const autor = { stare: 'raspuns', eAutor: true, eOwner: false }, owner = { stare: 'raspuns', eAutor: false, eOwner: true }
    // migrare neaplicată (false) sau încă nedetectată (null): niciun buton, doar nota
    for (const v2 of [false, null, undefined]) {
      expect(actiuniIntrebare({ v2, ...autor })).toEqual({ verificare: false, reia: false, nota: true })
      expect(actiuniIntrebare({ v2, ...owner })).toEqual({ verificare: false, reia: false, nota: true })
      expect(actiuniIntrebare({ v2, stare: 'eroare', eAutor: false, eOwner: true })).toEqual({ verificare: false, reia: false, nota: true })
    }
    // migrare detectată: butoanele, după drept și stare
    expect(actiuniIntrebare({ v2: true, ...autor })).toEqual({ verificare: true, reia: false, nota: false })
    expect(actiuniIntrebare({ v2: true, ...owner })).toEqual({ verificare: true, reia: true, nota: false })
    expect(actiuniIntrebare({ v2: true, stare: 'de_verificat', eAutor: true, eOwner: false })).toEqual({ verificare: false, reia: false, nota: false })
    expect(actiuniIntrebare({ v2: true, stare: 'de_verificat', eAutor: false, eOwner: true })).toEqual({ verificare: false, reia: true, nota: false })
    expect(actiuniIntrebare({ v2: true, stare: 'noua', eAutor: true, eOwner: true })).toEqual({ verificare: false, reia: false, nota: false })
    // un coleg care nu e autorul nu vede nici nota
    expect(actiuniIntrebare({ v2: false, stare: 'raspuns', eAutor: false, eOwner: false })).toEqual({ verificare: false, reia: false, nota: false })
  })
  it('runda 4: ecranul folosește actiuniIntrebare și nu cheamă RPC-urile fără migrarea detectată', () => {
    const jsx = readFileSync('src/IntrebariTehnice.jsx', 'utf8').replace(/\r\n/g, '\n')
    expect(jsx).toContain('if (lucruRand !== null || v2 !== true) return')
    expect(jsx).toContain('{act.verificare &&')
    expect(jsx).toContain('{act.reia &&')
    expect(jsx).toContain('disponibile după actualizarea bazei de date')
    expect(jsx).not.toMatch(/q\.stare === 'raspuns' && \(q\.autor === profile\.id/)   // condiția veche, fără detectarea migrării
    expect(jsx).toContain('setV2(colV2.current)')
  })
  it('runda 5 (review r4 P2): fără migrare, răspunsul arată exact ca înainte; „din cercetare” doar pe răspunsurile fluxului nou', () => {
    const vechi = { eticheta: '🤖 Răspuns AI · informativ, neverificat' }   // textul din ecranul de pe main, scris aici independent
    const cuSurse = [{ id: 'C1', tip: 'corpus', cale: 'docs/cercetare/a.md', titlu: 'A', extras: 'x' }]
    for (const v2 of [false, null, undefined]) {
      expect(prezentareRaspuns({ v2, surse: undefined, interogari: undefined })).toEqual({ v2: false, cercetare: false, ...vechi })
      expect(prezentareRaspuns({ v2, surse: cuSurse, interogari: ['q'] })).toEqual({ v2: false, cercetare: false, ...vechi })
    }
    expect(prezentareRaspuns({ v2: true, surse: [], interogari: [] })).toEqual({ v2: true, cercetare: false, ...vechi })   // răspuns de dinainte
    expect(prezentareRaspuns({ v2: true, surse: cuSurse, interogari: [] }))
      .toEqual({ v2: true, cercetare: true, eticheta: '🤖 Răspuns AI din cercetare · informativ, neverificat' })
    expect(prezentareRaspuns({ v2: true, surse: [], interogari: ['termen'] }).cercetare).toBe(true)
    expect(prezentareRaspuns({ v2: true, surse: [{ id: 'W1', tip: 'web', url: 'https://rau.com/' }], interogari: [] }).cercetare).toBe(false)
    const jsx = readFileSync('src/IntrebariTehnice.jsx', 'utf8').replace(/\r\n/g, '\n')
    // ecranul: componenta nouă și Interogările doar cu migrarea detectată; altfel Markdown-ul simplu și avertizarea veche
    expect(jsx).toContain('{pr.v2 ? <Raspuns q={q} owner={!!profile.is_owner}/> : <Markdown md={q.raspuns_md}/>}')
    expect(jsx).toContain("(pr.v2 ? (q.stare === 'raspuns' || q.stare === 'de_verificat') && q.raspuns_md : q.stare === 'raspuns')")
    expect(jsx).toContain('{pr.eticheta} · {fmtData(q.raspuns_la)}')
    expect(jsx).toContain('{pr.v2 && profile.is_owner && <Interogari')
    expect(jsx).toContain("{' '}Verifică temeiurile marcate „[DE VERIFICAT]” înainte să te bazezi pe ele. Decizia e a ta.")
    expect(jsx).toMatch(/\{v2 === true \? <>\n\s*\{' '\}Fiecare temei are un marcaj de sursă/)
    expect(jsx).not.toContain('Răspuns AI din cercetare')   // eticheta nouă vine DOAR din prezentareRaspuns
    expect(jsx).toContain('{(act.verificare || act.reia) && <div')   // fără butoane, nici rândul lor gol
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
  it('toate domeniile sunt în lista aprobată din CLAUDE.md pct. 11', () => {
    const t = readFileSync('CLAUDE.md', 'utf8')
    const linie = t.split('\n').find(l => l.includes('Claude deschide doar domenii oficiale cunoscute'))
    expect(linie).toBeTruthy()
    const aprobate = new Set(linie.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [])
    expect(aprobate.size).toBeGreaterThan(10)
    for (const d of LISTA) expect(aprobate.has(d), d).toBe(true)
    expect(aprobate.has('iscir.ro')).toBe(false)   // de aceea a ieșit din listă în runda 3
  })
  it('URL-uri', () => {
    expect(urlOficial('https://legislatie.just.ro/Public/DetaliiDocument/1')).toBe(true)
    expect(urlOficial('https://www.anre.ro/x')).toBe(true)
    for (const u of ['https://www.iscir.ro/x', 'https://anre.ro.evil.com/', 'https://evilanre.ro/', 'javascript:alert(1)', 'ftp://anre.ro/', 'https://u:p@anre.ro/', '', null])
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

// Regula B (decizia owner-ului 13.11.2026) — aceleași cazuri ca aplica_regula_b din test_cercetare.py.
const REGULA_B = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_regula_b.json', 'utf8'))
describe('regula B (r3): Da / Nu doar cu citat IDENTIC cu o propoziție întreagă, altfel Incert', () => {
  for (const c of REGULA_B.cazuri) {
    it(c.nume, () => {
      const [text, motiv] = aplicaRegulaB(c.text, REGULA_B.surse)
      expect(motiv).toBe(c.motiv)
      expect(text.split('\n')[0]).toBe(c.prima_linie)
      expect(text.split('\n').slice(1)).toEqual(c.text.split('\n').slice(1))   // doar prima linie se poate schimba
      expect(cereCitat(c.text, REGULA_B.surse)).toBe(c.cere_citat)
      expect(['da', 'nu', 'incert', null]).toContain(tipVerdict(text))          // după regulă: doar trei verdicte
      if (c.motiv === 'fara_citat') expect(imparteRaspuns(text).incert).toBe(true)
    })
  }
  it('r3: pragul minim e cel documentat (6 cuvinte); fără prag de 90% și fără liste de negații în JS sau Python', () => {
    expect(CITAT_MIN_CUVINTE).toBe(6)
    for (const nume of ['CITAT_PRAG', 'aliniere']) expect(S[nume], nume).toBe(undefined)
    const py = readFileSync('worker/intrebari-tehnice/cercetare.py', 'utf8')
    const js = readFileSync('src/intrebariSurse.js', 'utf8')
    expect(py).toMatch(/^CITAT_MIN_CUVINTE = 6$/m)
    for (const nume of ['CITAT_PRAG', 'INVERSOARE_NEGATIE', 'INVERSOARE_MODAL', '_aliniere']) expect(py, nume).not.toContain(nume)
    for (const nume of ['CITAT_PRAG', 'INVERSOARE_NEGATIE', 'INVERSOARE_MODAL']) expect(js, nume).not.toContain(nume)
    expect(py).toContain(`INCERT_REGULA_B = f'{INCERT}: niciun citat nu reproduce exact o propoziție întreagă dintr-o sursă — citește sursele alăturate.'`)
  })
  it('r3: forma de comparare și propozițiile — aceleași valori ca în test_cercetare.py', () => {
    for (const [intrare, forma] of REGULA_B.forme) expect(formaCitat(intrare), intrare).toBe(forma)
    for (const k of REGULA_B.propozitii) expect(propozitiiCitat(k.text), k.text).toEqual(k.propozitii)
  })
  it('r3: cazurile pe care vechea regulă de 90% le lăsa Da / Nu sunt marcate (mutantul e în test_cercetare.py)', () => {
    expect(REGULA_B.cazuri.filter(c => c.mutant_prag_trece).length).toBeGreaterThanOrEqual(6)
    for (const c of REGULA_B.cazuri.filter(k => k.mutant_prag_trece)) expect(aplicaRegulaB(c.text, REGULA_B.surse)[1], c.nume).toBe('fara_citat')
  })
  it('după curățare + regula B, un verdict ferm fără citat nu poate rămâne Da', () => {
    const s = [{ id: 'C1', titlu: 'PT C9', extras: 'Responsabilul tehnic cu sudura este atestat de ISCIR.' }]
    const [curat] = curataRaspuns('Da — RTS e atestat de ISCIR [C1].', s)
    expect(curat.startsWith('Da')).toBe(true)                                   // validarea veche îl lăsa
    expect(aplicaRegulaB(curat, s)[0].startsWith(INCERT_REGULA_B)).toBe(true)    // regula B îl face Incert
  })
})
