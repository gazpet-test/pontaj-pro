import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Dictionar, Mascare, previzualizare, ascundeSelectia, bucatiMascate, dictionarDinRanduri, NEMASCATE, incarcaNemascate, cheieEntitate,
  eAsemanator, larg } from './intrebariMascare.js'

// Aceleași cazuri ca worker/intrebari-tehnice/test_mascare.py (paritate Python ↔ JS, L19). Date INVENTATE.
// {NBSP} / {ZW} / {SHY} din fixture → caracterele reale (ca invizibile() din test_mascare.py)
const NBSP = String.fromCharCode(0xa0), ZW = String.fromCharCode(0x200b), SHY = String.fromCharCode(0xad)
const T = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_mascare.json', 'utf8'),
  (k, v) => typeof v === 'string' ? v.replaceAll('{NBSP}', NBSP).replaceAll('{ZW}', ZW).replaceAll('{SHY}', SHY) : v)
const DICT = new Dictionar(T.dictionar.persoane, T.dictionar.firme, T.dictionar.cui, T.dictionar.localitati)
const DICT_FARA_LOCALITATI = new Dictionar(T.dictionar.persoane, T.dictionar.firme, T.dictionar.cui)
const dictionarul = c => c.dictionar_gol ? null : c.fara_localitati ? DICT_FARA_LOCALITATI : DICT

describe('mascarea — cazurile comune cu workerul', () => {
  for (const c of T.cazuri) {
    it(c.nume, () => {
      const m = new Mascare(dictionarul(c))
      if (c.invata) m.invata(...c.texte)
      const mascate = c.texte.map(t => m.mascheaza(t, false))
      expect(mascate).toEqual(c.mascate)
      expect(m.contoare()).toEqual(c.contoare)
      if ('inlocuiri' in c) expect(m.inlocuiri).toBe(c.inlocuiri)
      // dus-întors EXACT: fiecare text demascat = originalul
      mascate.forEach((x, i) => expect(m.demascheaza(x)).toBe(c.texte[i]))
      // idempotent: un text deja mascat, trecut din nou (ca la reparare), rămâne identic
      mascate.forEach(x => expect(m.mascheaza(x, true)).toBe(x))
      for (const d of c.dupa || []) expect(m.mascheaza(d.text, true)).toBe(d.mascat)
      for (const d of c.demascare || []) expect(m.demascheaza(d.text)).toBe(d.afisat)
      for (const d of c.demascare_sigura || []) expect(m.demascheazaSigur(d.text), d.text).toEqual({ afisat: d.afisat ?? null, motiv: d.motiv })
      // după demascare nu mai rămâne nicio etichetă emisă (afară de una scrisă chiar de om, pusă la loc exact)
      mascate.forEach((x, i) => { if (!/\[[A-Za-z_]+_[0-9]/.test(c.texte[i])) expect(m.emiseIn(m.demascheaza(x))).toBe(0) })
    })
  }
})

describe('mascarea — proprietăți', () => {
  it('niciun nume / dată din cazuri nu rămâne în textul mascat', () => {
    const sensibile = ['Popescu', 'Ionescu', 'Mariei', 'Alfa Construct', 'Beta Instal', '1800101221144', '0722 123 456', '244 123 456',
      'ion.popescu@exemplu.ro', 'RO49 AAAA', '12345678', '87654321', '7654321', '23456789', 'PH 12 ABC', 'Vasilescu', 'Georgescu', 'Zbârcea',
      'ȚĂRANU', 'Ţăranu', 'Dumitrescu', 'Delta Proiect']
    for (const c of T.cazuri) {
      // fără dicționar, numele necunoscute rămân (limita spusă în ecran); „text fără nume” și „tulpina” au intenționat cuvinte care
      // doar seamănă cu un nume („Popescuțu”) și rămân
      if (c.nume.startsWith('text fără nume') || c.nume.startsWith('r3: tulpina') || c.dictionar_gol) continue
      const m = new Mascare(dictionarul(c))
      if (c.invata) m.invata(...c.texte)
      for (const x of c.texte.map(t => m.mascheaza(t, false))) for (const s of sensibile) expect(x.includes(s), `${s} în „${x}”`).toBe(false)
    }
  })
  it('r3: detectorul larg — aceleași intervale ca în test_mascare.py', () => {
    for (const k of T.larg.cazuri) expect(larg(k.text), JSON.stringify(k.text)).toEqual(k.spatii)
  })
  it('r3: intrările fără valoare se aruncă și se numără (aceleași numere ca în test_mascare.py)', () => {
    const a = T.aruncate
    const d = new Dictionar(a.persoane, a.firme, [], a.localitati)
    expect(d.statistici()).toEqual(a.statistici)
    expect(new Mascare(d).mascheaza(a.text, false)).toBe(a.mascat)
  })
  it('r3: etichetele rupte ale recenzentului nu se publică', () => {
    const m = new Mascare(DICT)
    m.mascheaza('A sunat Popescu Ion de la Alfa Construct SRL.', false)
    for (const x of ['[PERSOANA_\n999]', `[PERSOANA_${NBSP}1]`, '[PERSOANA_1] și [PERSOANA_\n1]', '[PERS\nOANA_1]', `[PERSOANA${ZW}_1]`,
      '[PERSOANA_1]\n[FIRMA_\n1]', '[PERSOANA_\r\n1]', 'firma 2', 'CUI 12345678'])
      expect(m.demascheazaSigur(`Da — ${x}.`), x).toEqual({ afisat: null, motiv: 'eticheta_rupta' })
    for (const x of ['Vezi [C1] și [W2].', 'Persoana fizică [1]', 'Cnp-ul lipsește', 'Se confirma 2 bar.', 'Oricui 3 ore.'])
      expect(m.demascheazaSigur(x).motiv, x).toBe(null)
  })
  it('r3: previzualizarea face pre-trecerea ca workerul (un nume din context se ascunde și în titlu)', () => {
    const p = previzualizare({ titlu: 'Ion a cerut avizul', intrebare: 'Cine semnează?', context: 'Ion Mare, diriginte' }, DICT)
    expect(p.titlu).toBe('[PERSOANA_1] a cerut avizul')
    expect(p.context).toBe('[PERSOANA_1_F2], diriginte')
  })
  it('aceeași valoare în altă spețe primește eticheta de la zero (tabelul e per speță)', () => {
    const a = new Mascare(DICT), b = new Mascare(DICT)
    expect(a.mascheaza('Ionescu Maria', false)).toBe('[PERSOANA_1]')
    expect(a.mascheaza('Popescu Ion', false)).toBe('[PERSOANA_2]')
    expect(b.mascheaza('Popescu Ion', false)).toBe('[PERSOANA_1]')
  })
  it('r2: demascarea nu repară nimic tăcut; publicarea se oprește la orice etichetă neemisă', () => {
    const m = new Mascare(DICT)
    m.mascheaza('Popescu Ion', false)
    expect(m.demascheaza('[PERSOANA_2] și [PERSOANA_1_F5] și [persoana_1]')).toBe('[PERSOANA_2] și [PERSOANA_1_F5] și [persoana_1]')
    expect(m.demascheazaSigur('[PERSOANA_1] și [PERSOANA_999]')).toEqual({ afisat: null, motiv: 'eticheta_neemisa' })
    expect(m.demascheazaSigur('Da — [PERSOANA_1].')).toEqual({ afisat: 'Da — Popescu Ion.', motiv: null })
  })
  it('r2: „aproape etichete” — același tabel de cazuri ca în test_mascare.py', () => {
    for (const s of T.asemanatoare.da) expect(eAsemanator(s), s).toBe(true)
    for (const s of T.asemanatoare.nu) expect(eAsemanator(s), s).toBe(false)
  })
  it('emiseIn numără doar etichetele emise (garda „demascare lipsă”)', () => {
    const m = new Mascare(DICT)
    const x = m.mascheaza('Popescu Ion, tel 0722 123 456', false)
    expect(m.emiseIn(x)).toBe(2)
    expect(m.emiseIn('[PERSOANA_9] [FIRMA_1]')).toBe(0)
  })
  it('lista de firme publice nemascate e cea documentată', () => {
    for (const k of ['transgaz', 'delgaz grid', 'distrigaz sud retele', 'gazpet instal', 'engie romania']) expect(NEMASCATE.has(k), k).toBe(true)
  })
})

describe('r2: entitățile publice — un singur loc (nemascate.json), decizia owner-ului 13.11.2026', () => {
  const J = JSON.parse(readFileSync('worker/intrebari-tehnice/nemascate.json', 'utf8'))
  it('NEMASCATE = formele din nemascate.json; nicio listă scrisă în cod (JS sau Python)', () => {
    expect([...NEMASCATE].sort()).toEqual(J.entitati.flatMap(e => e.forme).sort())
    expect(readFileSync('src/intrebariMascare.js', 'utf8')).not.toMatch(/'transgaz|`transgaz|"transgaz/)
    expect(readFileSync('worker/intrebari-tehnice/mascare.py', 'utf8')).not.toMatch(/'transgaz|"transgaz/)
    expect(readFileSync('worker/intrebari-tehnice/mascare.py', 'utf8')).toContain("'nemascate.json'")
  })
  it('fiecare intrare are o categorie permisă; fără furnizori / subcontractori / clienți privați / persoane', () => {
    expect(Object.keys(J.categorii).sort()).toEqual(['companie_publica', 'institutie_publica', 'operator_retea', 'societatea_noastra'])
    for (const e of J.entitati) for (const f of e.forme) expect(cheieEntitate(f), f).toBe(f)
  })
  it('intrările invalide sunt refuzate (aceleași ca în test_mascare.py)', () => {
    const strica = [d => { d.entitati[0].categorie = 'furnizor' }, d => { d.entitati[0].forme = [] }, d => { d.entitati[0].forme = ['SNTGN Transgaz SA'] },
      d => { d.entitati = [] }, d => { d.entitati[0].motiv = 'x' }, d => { d.categorii.furnizor = 'x' }]
    for (const f of strica) { const d = JSON.parse(JSON.stringify(J)); f(d); expect(() => incarcaNemascate(d)).toThrow() }
  })
  it('cheia entității (aceleași valori ca în test_mascare.py)', () => {
    for (const [nume, cheie] of [['S.N.T.G.N. TRANSGAZ S.A.', 'sntgn transgaz'], ['SC Gazpet Instal S.R.L.', 'gazpet instal'], ['E.ON', 'e on'],
      ['Engie România SA', 'engie romania'], ['Transgaz Construct SRL', 'transgaz construct']]) expect(cheieEntitate(nume)).toBe(cheie)
  })
  it('o firmă privată cu nume asemănător, din dicționar, intră în listă (se ascunde)', () => {
    const d = new Dictionar([], ['TRANSGAZ SA', 'Delgaz Grid SA', 'Construct SRL', 'SC GAZPET INSTAL SRL', 'Alfa SRL', 'S.N.T.G.N. TRANSGAZ S.A.', 'Transgaz Construct SRL'], [])
    expect([...d.firme.keys()].sort()).toEqual(['alfa', 'transgaz'])
    expect(d.firme.get('transgaz')).toEqual([['transgaz', 'construct']])
  })
})

describe('previzualizarea din ecran', () => {
  it('maschează titlu → speță → context (ordinea workerului) și numără', () => {
    const p = previzualizare({ titlu: 'Aviz Alfa Construct', intrebare: 'A sunat Popescu Ion la 0722 123 456.', context: 'cu Ion Popescu' }, DICT)
    expect(p.titlu).toBe('Aviz [FIRMA_1]')
    expect(p.intrebare).toBe('A sunat [PERSOANA_1] la [TELEFON_1].')
    expect(p.context).toBe('cu [PERSOANA_1_F2]')
    expect(p.total).toBe(3)
    expect(p.rezumat).toBe('1 persoană, 1 firmă, 1 telefon')
  })
  it('fără nimic de ascuns → total 0', () => {
    const p = previzualizare({ titlu: 'Distanța față de canalizare', intrebare: 'Care e distanța minimă la subtraversare?', context: '' }, DICT)
    expect(p.total).toBe(0)
    expect(p.intrebare).toBe('Care e distanța minimă la subtraversare?')
  })
  it('fără dicționar (contul nu poate citi lista) → doar tiparele', () => {
    const p = previzualizare({ titlu: 'x', intrebare: 'Popescu Ion, dl. Vasilescu, 0722 123 456', context: '' }, null)
    expect(p.intrebare).toBe('Popescu Ion, dl. [PERSOANA_1], [TELEFON_1]')
  })
  it('bucățile pentru evidențiere', () => {
    expect(bucatiMascate('a [PERSOANA_1] b')).toEqual([{ t: 'text', v: 'a ' }, { t: 'eticheta', v: '[PERSOANA_1]' }, { t: 'text', v: ' b' }])
  })
  it('dicționarul din rândurile citite în ecran (angajați + terți)', () => {
    const d = dictionarDinRanduri([{ name: 'POPESCU ION' }, { name: null }], [{ nume: 'Alfa Construct SRL', contact_nume: 'Ionescu Maria', cif: 'RO12345678' }, { nume: '' }])
    const m = new Mascare(d)
    expect(m.mascheaza('Alfa Construct, Maria Ionescu, Ion Popescu, 12345678', false)).toBe('[FIRMA_1], [PERSOANA_1], [PERSOANA_2], [CUI_1]')
  })
})

describe('ascunderea manuală a unui cuvânt', () => {
  it('înconjoară selecția cu [[ ]] (fără spațiile de margine)', () => {
    expect(ascundeSelectia('A zis Zbârcea ieri', 6, 14)).toEqual({ text: 'A zis [[Zbârcea]] ieri', cursor: 17 })
    expect(ascundeSelectia('A zis Zbârcea ieri', 5, 14)).toEqual({ text: 'A zis [[Zbârcea]] ieri', cursor: 17 })
    expect(ascundeSelectia('A zis Zbârcea ieri', 14, 5)).toEqual({ text: 'A zis [[Zbârcea]] ieri', cursor: 17 })
  })
  it('selecție goală, cu rând nou sau prea lungă → nimic', () => {
    expect(ascundeSelectia('abc', 1, 1)).toBe(null)
    expect(ascundeSelectia('a\nb', 0, 3)).toBe(null)
    expect(ascundeSelectia('x'.repeat(300), 0, 300)).toBe(null)
  })
  it('cuvântul ascuns manual nu pleacă și se pune la loc exact', () => {
    const m = new Mascare(DICT)
    const x = m.mascheaza('Vorbește cu [[Zbârcea]] de la depozit', false)
    expect(x).toBe('Vorbește cu [ASCUNS_1] de la depozit')
    expect(m.demascheaza(x)).toBe('Vorbește cu [[Zbârcea]] de la depozit')
  })
})

describe('aceleași liste în mascare.py și intrebariMascare.js (L19)', () => {
  const py = readFileSync('worker/intrebari-tehnice/mascare.py', 'utf8')
  const js = readFileSync('src/intrebariMascare.js', 'utf8')
  const lista = (sursa, re) => { const m = sursa.match(re); expect(m, String(re)).not.toBe(null); return m[1].replace(/[|]/g, ' ').split(/\s+/).filter(Boolean).sort() }
  for (const nume of ['OPRIRE', 'COMUNE', 'GENERICE_FIRMA', 'TITLURI', 'FARA_VALOARE', 'MARCAJE_LOCALITATE']) {
    it(nume, () => {
      const p = lista(py, new RegExp(`${nume} = (?:sorted\\()?(?:frozenset\\()?'''([\\s\\S]*?)'''`))
      const j = lista(js, new RegExp(`${nume} = (?:new Set\\(\\[\\.\\.\\.setDin\\(|setDin\\(|new Set\\()?\`([\\s\\S]*?)\``))
      expect(j).toEqual(p)
    })
  }
  it('județele, excluderile de nr. auto, sufixele și etichetele', () => {
    expect(js).toContain("const JUDETE = 'AB AG AR BC BH BN BR BT BV BZ CJ CL CS CT CV DB DJ GJ GL GR HD HR IF IL IS MH MM MS NT OT PH SB SJ SM SV TL TM TR VL VN VS'")
    expect(py).toContain("JUDETE = ('AB AG AR BC BH BN BR BT BV BZ CJ CL CS CT CV DB DJ GJ GL GR HD HR IF IL IS MH MM MS NT OT PH SB SJ SM SV TL TM TR VL VN VS')")
    expect(js).toContain("'BAR SDR PEH PVC MPA KPA ISO DIN OTL PEX PPR HDP'")
    expect(py).toContain("'BAR SDR PEH PVC MPA KPA ISO DIN OTL PEX PPR HDP'")
    expect(js).toContain("['ului', 'ul', 'lui', 'ei', 'le', 'a', 'i']")
    expect(py).toContain("('ului', 'ul', 'lui', 'ei', 'le', 'a', 'i')")
    expect(js).toContain('(PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_([1-9][0-9]{0,3})(?:_F([1-9][0-9]{0,2}))?')
    expect(py).toContain('(PERSOANA|FIRMA|CNP|CUI|TELEFON|EMAIL|IBAN|NR_AUTO|ASCUNS)_([1-9][0-9]{0,3})(?:_F([1-9][0-9]{0,2}))?')
    // r2: categoriile „aproape etichetă” (în JS, \\- din sursa șirului = \- din Python)
    expect(js).toContain("const CAT_ASEM = '(?:PERSOAN[AĂ]|FIRM[AĂ]|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[ _.\\\\-]?AUTO|ASCUNS)'")
    expect(py).toContain("_CAT_ASEM = r'(?:PERSOAN[AĂ]|FIRM[AĂ]|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[ _.\\-]?AUTO|ASCUNS)'")
    // eticheta exactă e sensibilă la majuscule în ambele (r2: fără toleranță)
    expect(js).toContain("new RegExp(ETICHETA_SURSA, 'gu')")
    expect(py).toMatch(/^ETICHETA = re\.compile\(r'.*'\)$/m)
    // r3: terminațiile (mulțimea închisă), pragul tulpinii, prefixele detectorului larg, abrevierile de localitate
    expect(js).toContain("const TERMINATII = ['ului', 'ilor', 'ule', 'lui', 'lor', 'ul', 'le', 'ei', 'ii', 'e', 'i']")
    expect(py).toContain("TERMINATII = ('ului', 'ilor', 'ule', 'lui', 'lor', 'ul', 'le', 'ei', 'ii', 'e', 'i')")
    expect(js).toContain('const COMPONENTA_MIN_TULPINA = 4')
    expect(py).toContain('COMPONENTA_MIN_TULPINA = 4')
    expect(js).toContain("'(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[_.-]?AUTO|ASCUNS)[_#.:()\\\\[\\\\]' + LINIUTE_LARG + '-]*[0-9]+'")
    expect(py).toContain("r'(?:PERSOANA|FIRMA|CNP|CUI|TELEFON|E-?MAIL|IBAN|NR[_.-]?AUTO|ASCUNS)[_#.:()\\[\\]' + _LINIUTE_LARG + r'-]*[0-9]+'")
    expect(js).toContain("new Set(['com', 'mun', 'loc', 'jud'])")
    expect(py).toContain("frozenset(('com', 'mun', 'loc', 'jud'))")
  })
})
