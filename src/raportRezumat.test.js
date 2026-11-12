// Rezumatul raportului zilnic (etapa 1): regula JS pe tabelul de cazuri (rezultatele scrise de mână, nu din cod — L25)
// + paritatea textelor care trebuie să fie identice între migrare, scriptul de probă și harness-ul SQL (L19).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { rezumatRaport, rezumatZi, cuNumar, citesteRapoarteZi, intrareZi, santiereDeRaportat, COLOANE_ZI,curata, trunchiaza, fmtNr, fmtGrad, normNume, etichetaRezumat, valideazaEditat, MAX_EDITAT, LIMITE, LIMITE_ZI,
  curataEditat, plafoneaza, avertizareEroare, lipsaRezumat, MAX_AUTOMAT, SUFIX_SCURTAT } from './raportRezumat.js'

const citeste = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r/g, '')
const CAZURI = JSON.parse(citeste('./raportRezumat.cazuri.json'))
const bloc = (text, start, end) => {
  const i = text.indexOf(start), j = text.indexOf(end)
  if (i < 0 || j < 0 || j < i) throw new Error(`blocul ${start} lipsește`)
  return text.slice(i + start.length, j)
}

describe('rezumatRaport — tabelul de cazuri (același pe care îl rulează și SQL-ul)', () => {
  it('are cazurile cerute în brief', () => {
    expect(CAZURI.length).toBeGreaterThanOrEqual(8)
    for (const c of CAZURI) expect(typeof c.asteptat).toBe('string')
  })
  for (const c of CAZURI) {
    it(c.nume, () => { expect(rezumatRaport(c.intrare)).toBe(c.asteptat) })
  }
  it('intrare care nu e obiect = doar titlul', () => {
    expect(rezumatRaport(null)).toBe('Raport zilnic')
    expect(rezumatRaport([1, 2])).toBe('Raport zilnic')
    expect(rezumatRaport('text')).toBe('Raport zilnic')
  })
  it('cifrele nu se rotunjesc și nu se adună (două linii pe aceeași activitate rămân două)', () => {
    const t = rezumatRaport({ linii: [
      { activitate: 'Sudură', um: 'buc', cantitate: 1.005 }, { activitate: 'Sudură', um: 'buc', cantitate: 2.999 }] })
    expect(t).toBe('Raport zilnic\nLucrări: Sudură 1,005 buc; Sudură 2,999 buc')
  })
  it('niciun număr nou față de intrare (în afara datei și a numărătorilor de utilaje)', () => {
    const c = CAZURI[0]
    const nr = (s) => (s.match(/[0-9]+(,[0-9]+)?/g) || [])
    // numerele intrării: lot / contract (9, 99, 2026), data (10, 11, 2026), meteo (8,3 -> 8, singura rotunjire), oameni, utilaje (3 = numărul,
    // 2 nefuncționale, 3 din „3CX”, 1 din „GEN-1”), cantitățile, obiectele (TR1 / TR2), poze
    const permise = new Set(['9', '99', '2026', '10', '11', '8', '2,4', '17', '4', '3', '2', '1', '6', '35,5', '12', '147,25'])
    for (const n of nr(rezumatRaport(c.intrare))) expect(permise.has(n), n).toBe(true)
  })
})

describe('unelte de text', () => {
  it('curata: controale -> spațiu, spații repetate -> unul, capete fără spații', () => {
    expect(curata('  a\t\tb\r\nc  ')).toBe('a b c')
    expect(curata(null)).toBe('')
    expect(curata(12)).toBe('')
    // spațiul neîntrerupt (U+00A0) nu e spațiu obișnuit: rămâne (aceeași regulă ca în SQL)
    const nbsp = String.fromCharCode(160)
    expect(curata(`a${nbsp}b`)).toBe(`a${nbsp}b`)
  })
  it('trunchiaza: pe cuvinte, la limită, cuvânt unic lung', () => {
    expect(trunchiaza('unu doi trei', 7)).toBe('unu doi…')
    expect(trunchiaza('unu doi trei', 8)).toBe('unu doi…')
    expect(trunchiaza('unu doi trei', 12)).toBe('unu doi trei')
    expect(trunchiaza('abcdefghij', 4)).toBe('abcd…')
    // emoji = un singur caracter (ca length() din PostgreSQL)
    expect(trunchiaza('🚧🚧🚧 x', 3)).toBe('🚧🚧🚧…')
  })
  it('fmtNr: virgulă zecimală, nenumăr = null', () => {
    expect(fmtNr(12.5)).toBe('12,5')
    expect(fmtNr(-2.5)).toBe('-2,5')
    expect(fmtNr(10000000)).toBe('10000000')
    expect(fmtNr('3')).toBe(null)
    expect(fmtNr(NaN)).toBe(null)
  })
  it('fmtGrad: grad întreg, jumătatea departe de zero, fără „-0”', () => {
    expect([8.19, 8.5, 8.49, -2.5, -0.3, 0, -0.5, 21].map(fmtGrad)).toEqual(['8', '9', '8', '-3', '0', '0', '-1', '21'])
    expect(fmtGrad('8')).toBe(null)
  })
  it('normNume: fără diacritice românești și majuscule (doar harta fixă)', () => {
    expect(normNume('  ȘANTIER Prunișor  Ţară ')).toBe('santier prunisor tara')
    expect(normNume('ÉLAN')).toBe('Élan')   // în afara hărții: neschimbat (É rămâne), A–Z -> a–z
  })
  it('eticheta rubricii și validarea textului corectat', () => {
    expect(etichetaRezumat({ rezumat_sursa: 'automat' })).toBe('generat automat')
    expect(etichetaRezumat({ rezumat_sursa: 'editat' }, 'NUME TEST')).toBe('editat de NUME TEST')
    expect(etichetaRezumat({ rezumat_sursa: null })).toBe(null)
    expect(valideazaEditat('  \n ')).toMatch(/gol/)
    expect(valideazaEditat('x'.repeat(MAX_EDITAT))).toBe(null)
    expect(valideazaEditat('x'.repeat(MAX_EDITAT + 1))).toMatch(/maximum/)
  })
  it('r4: rezumatul scos la mutarea șantierului (de_recompus): fără etichetă, rubrica spune de ce; eroarea = „nu s-a putut genera”', () => {
    expect(etichetaRezumat({ rezumat_sursa: 'de_recompus' })).toBe(null)
    expect(lipsaRezumat({ rezumat_sursa: 'de_recompus' })).toMatch(/mutat în alt proiect/)
    expect(lipsaRezumat({ rezumat_sursa: null })).toMatch(/înainte de rubrica de rezumat/)
    expect(lipsaRezumat({ rezumat_sursa: 'automat', rezumat_text: 'x' })).toBe(null)
    expect(lipsaRezumat({ rezumat_sursa: 'editat', rezumat_text: 'x' })).toBe(null)
    expect(avertizareEroare({ rezumat_sursa: 'de_recompus', rezumat_eroare: '42703' })).toMatch(/nu s-a putut genera/)
  })
  it('r3: curataEditat — aceleași caractere de control ca textul automat -> spațiu, rândul nou rămâne (CR / CRLF -> LF)', () => {
    const c = String.fromCharCode
    expect(curataEditat(`a${c(13)}${c(10)}b${c(9)}c${c(127)}`)).toBe(`a${c(10)}b c `)
    expect(curataEditat(`x${c(13)}y${c(1)}z${c(31)}`)).toBe(`x${c(10)}y z `)
    expect(curataEditat('  două  spații\nrămân  ')).toBe('  două  spații\nrămân  ')   // nimic altceva nu se schimbă
    expect(curataEditat(null)).toBe(null)
    // validarea se face DUPĂ curățare: doar controale = gol; lungimea se numără pe textul curățat (CRLF = un caracter)
    expect(valideazaEditat(`${c(9)}${c(1)} `)).toMatch(/gol/)
    expect(valideazaEditat('x'.repeat(MAX_EDITAT - 1) + `${c(13)}${c(10)}`)).toBe(null)
  })
  it('r3: plafoneaza — sub plafon neschimbat; peste: rânduri întregi + sufix; primul rând prea lung = tăiat în rând', () => {
    expect(MAX_AUTOMAT).toBe(3000)
    expect(plafoneaza('scurt\ntext')).toBe('scurt\ntext')
    const exact = 'y'.repeat(MAX_AUTOMAT)
    expect(plafoneaza(exact)).toBe(exact)
    const rand = 'r'.repeat(99)                       // 100 de caractere cu rândul nou
    const lung = Array.from({ length: 40 }, () => rand).join('\n')   // 3999
    const t = plafoneaza(lung)
    // 3000 - 38 = 2962 de caractere disponibile => 29 de rânduri întregi (29 × 100 - 1 = 2899), apoi sufixul
    expect(Array.from(SUFIX_SCURTAT).length).toBe(38)
    expect(t).toBe(Array.from({ length: 29 }, () => rand).join('\n') + SUFIX_SCURTAT)
    expect(plafoneaza('z'.repeat(3100))).toBe('z'.repeat(2962) + SUFIX_SCURTAT)
  })
  it('r3: avertizareEroare — doar la textul automat / lipsă, cu codul; fără cod = nimic', () => {
    expect(avertizareEroare({ rezumat_sursa: 'automat', rezumat_eroare: '42703' })).toMatch(/nu s-a putut reface.*42703.*de dinainte/)
    expect(avertizareEroare({ rezumat_sursa: null, rezumat_eroare: '42703' })).toMatch(/nu s-a putut genera.*42703/)
    expect(avertizareEroare({ rezumat_sursa: 'automat', rezumat_eroare: null })).toBe(null)
    expect(avertizareEroare({ rezumat_sursa: 'editat', rezumat_eroare: '42703' })).toBe(null)
    expect(avertizareEroare(null)).toBe(null)
  })
})

// ── r2: rezumatul ZILEI pe toate șantierele (doar în aplicație). Așteptările sunt scrise de mână (L25). ──
const util = (n, stare = 'functional', prefix = 'U') => Array.from({ length: n }, (_, i) => ({ nume: `${prefix}${i + 1}`, stare }))
describe('rezumatZi — rezumatul zilei pe toate șantierele', () => {
  it('cuNumar: „de” la 20–99 (pe ultimele două cifre) și la sutele rotunde', () => {
    expect([0, 1, 2, 19, 20, 95, 100, 101, 119, 120].map(n => cuNumar(n, 'om', 'oameni'))).toEqual([
      '0 oameni', '1 om', '2 oameni', '19 oameni', '20 de oameni', '95 de oameni', '100 de oameni', '101 oameni', '119 oameni', '120 de oameni'])
  })

  // 5 șantiere, 95 de oameni, 98 de utilaje (exemplul din brief), date în altă ordine decât cea a oamenilor
  const CINCI = [
    { site_id: 4, santier: 'Bărăgan', personal: { sudori: 4, total: 10 }, utilaje: util(30) },
    { site_id: 1, santier: 'Lot 1 Prunișor – Jupa', personal: { total: 40 },
      utilaje: [...util(28), ...util(4, 'nefunctional', 'N')], lucrari: 'Sudură TR3, lansare 120 m.', probleme: 'Ploaie după-amiaza.' },
    { site_id: 5, santier: 'Alfa', personal: { total: 5 }, utilaje: util(6), lucrari: 'Curățenie.' },
    { site_id: 3, santier: 'Distribuție Ploiești', personal: { total: 15 }, utilaje: util(10), lucrari: 'Am lucrat pe TR1.',
      linii: [{ obiect_cod: 'TR1', obiect_nume: 'Tronson 1', activitate: 'Săpătură', um: 'mc', cantitate: 35.5 },
              { obiect_cod: 'TR1', obiect_nume: 'Tronson 1', activitate: 'Sudură', um: 'buc', cantitate: 12 }] },
    { site_id: 2, santier: 'Domnești', personal: { total: 25 }, utilaje: util(20), lucrari: 'Montaj conductă.',
      subcontractori: 'Rominsta — foraj orizontal', plan_maine: 'nu intră în rezumatul zilei', aprovizionare: 'nici asta' },
  ]
  const TEXT_CINCI = [
    'Rapoarte șantiere — 11.11.2026: 5 șantiere, 95 de oameni, 98 de utilaje',
    '',
    '• Lot 1 Prunișor – Jupa: 40 de oameni · 32 de utilaje (nefuncționale 4: N1; N2; N3; +1)',
    '  Lucrări: Sudură TR3, lansare 120 m.',
    '  Probleme: Ploaie după-amiaza.',
    '• Domnești: 25 de oameni · 20 de utilaje',
    '  Lucrări: Montaj conductă.',
    '  Subcontractori: Rominsta — foraj orizontal',
    '• Distribuție Ploiești: 15 oameni · 10 utilaje',
    '  Lucrări: TR1 – Săpătură 35,5 mc, Sudură 12 buc — Am lucrat pe TR1.',
    '• Bărăgan: 10 oameni · 30 de utilaje',
    '  Lucrări: nimic trecut în raport',
    '• Alfa: 5 oameni · 6 utilaje',
    '  Lucrări: Curățenie.',
  ].join('\n')

  it('o zi cu 5 rapoarte: antetul cu totaluri, șantierele în ordinea oamenilor (fără lista activelor = fără „fără raport”)', () => {
    expect(rezumatZi(CINCI, '2026-11-11')).toBe(TEXT_CINCI)
    expect(rezumatZi(CINCI, '2026-11-11', { santiereActive: null })).toBe(TEXT_CINCI)
  })
  it('o zi cu 5 rapoarte + șantierele active care n-au trimis (în ordinea numelui; id-uri text sau număr) — owner, azi', () => {
    const active = [1, 2, 3, 4, 5].map(id => ({ id: String(id), nume: `S${id}` })).concat([{ id: 7, nume: 'Zeta' }, { id: 6, nume: 'Beta' }])
    expect(rezumatZi(CINCI, '2026-11-11', { santiereActive: active, vedeToate: true, azi: '2026-11-11' })).toBe(TEXT_CINCI + '\n\nFără raport (2): Beta, Zeta')
  })
  // r3 (Jakarinos P2): „fără raport” afirmat DOAR când contul vede tot și ziua e azi; altfel formularea prudentă
  it('r3: cont restrâns / zi trecută / necunoscut = „fără raport vizibil pentru contul tău” / „din lista curentă de șantiere”', () => {
    const active = [{ id: 1, nume: 'S1' }, { id: 6, nume: 'Beta' }]
    const r = [{ site_id: 1, santier: 'S1', personal: { total: 2 } }]
    const coada = (opt) => rezumatZi(r, '2026-11-11', { santiereActive: active, ...opt }).split('\n').at(-1)
    expect(coada({ vedeToate: true, azi: '2026-11-11' })).toBe('Fără raport (1): Beta')
    expect(coada({ vedeToate: true, azi: '2026-11-12' })).toBe('Fără raport, din lista curentă de șantiere (1): Beta')
    expect(coada({ vedeToate: false, azi: '2026-11-11' })).toBe('Fără raport vizibil pentru contul tău (1): Beta')
    expect(coada({ vedeToate: false, azi: '2026-11-12' })).toBe('Fără raport vizibil pentru contul tău, din lista curentă de șantiere (1): Beta')
    // necunoscut (lipsă / nu e exact true, ziua de azi lipsă) = cel mai prudent
    expect(coada({})).toBe('Fără raport vizibil pentru contul tău, din lista curentă de șantiere (1): Beta')
    expect(coada({ vedeToate: 'da', azi: '2026-11-11' })).toBe('Fără raport vizibil pentru contul tău (1): Beta')
    expect(coada({ vedeToate: true })).toBe('Fără raport, din lista curentă de șantiere (1): Beta')
    // toate au raport: aceeași regulă
    const toate = (opt) => rezumatZi(r, '2026-11-11', { santiereActive: [{ id: 1, nume: 'S1' }], ...opt }).split('\n').at(-1)
    expect(toate({ vedeToate: true, azi: '2026-11-11' })).toBe('Toate șantierele active au trimis raport.')
    expect(toate({ vedeToate: true, azi: '2026-11-10' })).toBe('Toate șantierele din lista curentă au raport în ziua aceasta.')
    expect(toate({ azi: '2026-11-11' })).toBe('Toate șantierele active din lista ta au un raport vizibil pentru contul tău.')
    expect(toate({})).toBe('Toate șantierele din lista curentă au un raport vizibil pentru contul tău în ziua aceasta.')
  })
  it('o zi cu un singur raport (singular peste tot); toate activele au raport', () => {
    const r = [{ site_id: 9, santier: 'Șantier test', personal: { total: 1 }, utilaje: [{ cod: 'GEN-1', stare: 'nefunctional', motiv: 'nu pornește' }],
      lucrari: 'Probă.' }]
    expect(rezumatZi(r, '2026-11-12', { santiereActive: [{ id: 9, nume: 'Șantier test' }], vedeToate: true, azi: '2026-11-12' })).toBe([
      'Rapoarte șantiere — 12.11.2026: 1 șantier, 1 om, 1 utilaj',
      '',
      '• Șantier test: 1 om · 1 utilaj (nefuncționale 1: GEN-1)',
      '  Lucrări: Probă.',
      '',
      'Toate șantierele active au trimis raport.',
    ].join('\n'))
  })
  it('o zi fără niciun raport (cu și fără lista activelor); intrarea care nu e listă', () => {
    expect(rezumatZi([], '2026-11-11')).toBe('Rapoarte șantiere — 11.11.2026: niciun raport')
    expect(rezumatZi(null, '2026-11-11')).toBe('Rapoarte șantiere — 11.11.2026: niciun raport')
    expect(rezumatZi([], '2026-11-11', { santiereActive: [{ id: 2, nume: 'Doi' }, { id: 1, nume: 'Ăla' }, { id: 3, nume: '' }], vedeToate: true, azi: '2026-11-11' }))
      .toBe('Rapoarte șantiere — 11.11.2026: niciun raport\n\nFără raport (3): Ăla, Doi, Șantier #3')
    expect(rezumatZi([], 'nu e dată')).toBe('Rapoarte șantiere: niciun raport')
  })
  it('texte lungi: numele la 60, lucrările la 200, subcontractorii la 120, problemele la 160 (pe cuvinte); cantitățile nu se taie', () => {
    const nume = 'Șantier ' + 'lung '.repeat(20)              // 108 caractere
    const luc = 'abcd '.repeat(60)                              // 300
    const sc = 'xy '.repeat(60)                                 // 180
    const pb = 'pqrs '.repeat(40)                               // 200
    const r = [{ site_id: 1, santier: nume, personal: { total: 3 }, utilaje: [], lucrari: luc, subcontractori: sc, probleme: pb,
      linii: [{ obiect_cod: 'OB1', activitate: 'Lansare', um: 'm', cantitate: 1234.567 }] }]
    expect(rezumatZi(r, '2026-11-11')).toBe([
      'Rapoarte șantiere — 11.11.2026: 1 șantier, 3 oameni, 0 utilaje',
      '',
      '• Șantier ' + 'lung '.repeat(9) + 'lung…: 3 oameni · 0 utilaje',
      '  Lucrări: OB1 – Lansare 1234,567 m — ' + 'abcd '.repeat(39) + 'abcd…',
      '  Subcontractori: ' + 'xy '.repeat(39) + 'xy…',
      '  Probleme: ' + 'pqrs '.repeat(31) + 'pqrs…',
    ].join('\n'))
    expect(LIMITE_ZI).toEqual({ santier: 60, lucrari: 200, subcontractori: 120, probleme: 160 })
  })
  it('rapoarte fără lucrări și fără numere: „nimic trecut în raport”, totalurile spun câte rapoarte n-au avut numărul (nu devin 0)', () => {
    const r = [
      { site_id: 2, santier: 'Beta', personal: null, utilaje: null },
      { site_id: 1, santier: 'Alfa', personal: { sudori: 2 }, utilaje: [], lucrari: '   ', linii: [] },
      { site_id: 3, santier: 'Gama', personal: { total: 3 }, utilaje: util(2), probleme: 'Lipsă motorină' },
    ]
    expect(rezumatZi(r, '2026-11-11')).toBe([
      'Rapoarte șantiere — 11.11.2026: 3 șantiere, 3 oameni (2 rapoarte fără număr), 2 utilaje (un raport fără număr)',
      '',
      '• Gama: 3 oameni · 2 utilaje',
      '  Lucrări: nimic trecut în raport',
      '  Probleme: Lipsă motorină',
      '• Alfa: 0 utilaje',
      '  Lucrări: nimic trecut în raport',
      '• Beta',
      '  Lucrări: nimic trecut în raport',
    ].join('\n'))
  })
  it('doar cantități (fără text liber), mai multe obiecte; același număr de oameni = după nume; fără nume de șantier', () => {
    const r = [
      { site_id: 8, santier: '', personal: { total: 4 },
        linii: [{ obiect_cod: 'A', activitate: 'Sudură', um: 'buc', cantitate: 2 }, { obiect_nume: 'Stație', activitate: 'Vopsire', bifa: true },
                { activitate: 'Curățenie', cantitate: null }] },
      { site_id: 7, santier: 'Zeta', personal: { total: 4 } },
    ]
    expect(rezumatZi(r, '2026-11-11')).toBe([
      'Rapoarte șantiere — 11.11.2026: 2 șantiere, 8 oameni, 0 utilaje (2 rapoarte fără număr)',
      '',
      '• Șantier #8: 4 oameni',
      '  Lucrări: A – Sudură 2 buc; Stație – Vopsire (efectuat); Curățenie (fără cantitate)',
      '• Zeta: 4 oameni',
      '  Lucrări: nimic trecut în raport',
    ].join('\n'))
  })
  it('nimic inventat: fiecare număr din text e în intrare sau e un total / număr de utilaje', () => {
    const t = rezumatZi(CINCI, '2026-11-11')
    // + numele utilajelor (N1–N3), obiectul TR1 și „TR3” din textul omului
    const permise = new Set(['11', '2026', '5', '95', '98', '40', '32', '4', '1', '2', '3', '25', '20', '15', '10', '35,5', '12', '30', '6', '120'])
    for (const n of (t.match(/[0-9]+(,[0-9]+)?/g) || [])) expect(permise.has(n), n).toBe(true)
    expect(t).not.toMatch(/mâine|nu intră|nici asta/)
  })
})

// client Supabase fals: înregistrează filtrele fiecărei cereri și întoarce rândurile filtrate (id > ultim, limit)
function clientFals(tabele, { eroareLa } = {}) {
  const cereri = []
  const client = {
    from(t) {
      const c = { t, f: [] }; cereri.push(c)
      const q = {
        select(col) { c.col = col; return q },
        in(k, v) { c.f.push(['in', k, v]); return q },
        eq(k, v) { c.f.push(['eq', k, v]); return q },
        gt(k, v) { c.f.push(['gt', k, v]); return q },
        order(k) { c.ord = k; return q },
        limit(n) { c.lim = n; return q },
        then(rez, rej) {
          if (eroareLa === t) return Promise.resolve({ data: null, error: new Error('drept refuzat') }).then(rez, rej)
          let r = (tabele[t] || []).filter(x => c.f.every(([op, k, v]) =>
            op === 'in' ? v.includes(x[k]) : op === 'eq' ? x[k] === v : x[k] > v)).sort((a, b) => a.id - b.id)
          if (c.lim) r = r.slice(0, c.lim)
          return Promise.resolve({ data: r, error: null }).then(rez, rej)
        },
      }
      return q
    },
  }
  return { client, cereri }
}
describe('rezumatul zilei în aplicație: citirea și forma intrării', () => {
  const RAP = [
    { id: 10, site_id: 1, data: '2026-11-11', personal_snapshot: { total: 7 }, utilaje_snapshot: [], lucrari_efectuate: 'Săpătură', subcontractori: null, probleme: null },
    { id: 11, site_id: 2, data: '2026-11-11', personal_snapshot: { total: 3 }, utilaje_snapshot: null, lucrari_efectuate: null, subcontractori: 'Sub', probleme: 'Pb' },
    { id: 12, site_id: 1, data: '2026-11-10', personal_snapshot: { total: 99 } },
    { id: 13, site_id: 9, data: '2026-11-11', personal_snapshot: { total: 50 } },   // șantier pe care utilizatorul nu-l are în ecran
  ]
  const LIN = [
    { id: 2, raport_id: 10, unitate_id: 5, activitate_id: 1, cantitate: '12.50', proiect_activitati: { nume: 'Sudură', um: 'buc', ordine: 1 }, proiect_unitati: { cod: 'TR1', nume: 'Tronson 1', ordine: 1 } },
    { id: 1, raport_id: 10, unitate_id: null, activitate_id: 2, cantitate: 1, proiect_activitati: { nume: 'Probă', um: null, tip_raportare: 'bifa', ordine: 2 }, proiect_unitati: null },
    { id: 3, raport_id: 12, unitate_id: null, activitate_id: 1, cantitate: 4, proiect_activitati: { nume: 'Alt', um: 'm' }, proiect_unitati: null },
  ]
  it('citește doar ziua și șantierele cerute, cu liniile lor; cererile pe chei (order id + limit)', async () => {
    const { client, cereri } = clientFals({ rapoarte_zilnice: RAP, raport_lucrari: LIN })
    const r = await citesteRapoarteZi(client, [1, 2, 2], '2026-11-11')
    expect(r.map(x => x.id)).toEqual([10, 11])
    expect(r[0].linii_raport.map(l => l.id)).toEqual([1, 2])
    expect(r[1].linii_raport).toEqual([])
    const zr = cereri.filter(c => c.t === 'rapoarte_zilnice'), lr = cereri.filter(c => c.t === 'raport_lucrari')
    expect(zr[0].f.slice(0, 2)).toEqual([['in', 'site_id', [1, 2]], ['eq', 'data', '2026-11-11']])
    expect(zr[0].col).toBe(COLOANE_ZI)
    expect(COLOANE_ZI).not.toMatch(/sef_santier|created_by|poze/)
    expect(lr[0].f[0]).toEqual(['in', 'raport_id', [10, 11]])
    for (const c of cereri) { expect(c.ord).toBe('id'); expect(c.lim).toBeGreaterThan(0) }
    // ultima pagină a fiecărei citiri e cea goală (keyset până la pagina goală)
    expect(zr.length).toBe(2)
  })
  it('id-urile pe bucăți în .in(); fără șantiere / zi invalidă = nicio cerere', async () => {
    const { client, cereri } = clientFals({ rapoarte_zilnice: RAP, raport_lucrari: LIN })
    const r = await citesteRapoarteZi(client, [1, 2, 3], '2026-11-11', { bucata: 2 })
    expect(r.map(x => x.id)).toEqual([10, 11])
    expect(cereri.filter(c => c.t === 'rapoarte_zilnice' && !c.f.some(f => f[0] === 'gt')).map(c => c.f[0][2])).toEqual([[1, 2], [3]])
    const g = clientFals({})
    expect(await citesteRapoarteZi(g.client, [], '2026-11-11')).toEqual([])
    expect(await citesteRapoarteZi(g.client, null, '2026-11-11')).toEqual([])
    expect(await citesteRapoarteZi(g.client, [1], '11.11.2026')).toEqual([])
    expect(g.cereri.length).toBe(0)
  })
  it('o eroare de citire se aruncă (nu devine „niciun raport”)', async () => {
    await expect(citesteRapoarteZi(clientFals({ rapoarte_zilnice: RAP }, { eroareLa: 'rapoarte_zilnice' }).client, [1], '2026-11-11')).rejects.toThrow('drept refuzat')
    await expect(citesteRapoarteZi(clientFals({ rapoarte_zilnice: RAP }, { eroareLa: 'raport_lucrari' }).client, [1], '2026-11-11')).rejects.toThrow('drept refuzat')
  })
  it('cap-coadă: rândurile citite -> intrareZi -> rezumatZi (nume din ecran, cantitatea exactă, lipsă = „Șantier #id”)', async () => {
    const { client } = clientFals({ rapoarte_zilnice: RAP, raport_lucrari: LIN })
    const r = await citesteRapoarteZi(client, [1, 2], '2026-11-11')
    const nume = new Map([['1', 'Lot 1']])
    const sites = [{ id: 1, name: 'Lot 1', raport_zilnic_necesar: true }, { id: 2, name: 'Doi' }, { id: 3, name: 'Birou', raport_zilnic_necesar: false },
      { id: 4, name: 'Închis', active: false }, { id: 5, name: 'Cinci', active: true }]
    expect(santiereDeRaportat(sites)).toEqual([{ id: 1, nume: 'Lot 1' }, { id: 2, nume: 'Doi' }, { id: 5, nume: 'Cinci' }])
    expect(rezumatZi(r.map(x => intrareZi(x, id => nume.get(String(id)))), '2026-11-11', { santiereActive: santiereDeRaportat(sites) })).toBe([
      'Rapoarte șantiere — 11.11.2026: 2 șantiere, 10 oameni, 0 utilaje (un raport fără număr)',
      '',
      '• Lot 1: 7 oameni · 0 utilaje',
      '  Lucrări: Probă (efectuat); TR1 – Sudură 12,5 buc — Săpătură',
      '• Șantier #2: 3 oameni',
      '  Lucrări: nimic trecut în raport',
      '  Subcontractori: Sub',
      '  Probleme: Pb',
      '',
      // r3: fără vedeToate / azi (cont restrâns, zi necunoscută) = formularea prudentă
      'Fără raport vizibil pentru contul tău, din lista curentă de șantiere (1): Cinci',
    ].join('\n'))
    expect(intrareZi(null)).toEqual({ site_id: null, santier: null, personal: null, utilaje: null, linii: [], lucrari: null, subcontractori: null, probleme: null })
  })
})

describe('paritate între fișiere (L19)', () => {
  const MIG = citeste('../supabase/migrations/20261216a_executie_raport_rezumat.sql')
  it('blocul INTRARE din migrare = cel din scriptul de probă (aceeași intrare pentru SQL și JS)', () => {
    const PROBA = citeste('../scripts/raport_rezumat_proba.sql')
    expect(bloc(PROBA, '-- INTRARE-START', '-- INTRARE-END')).toBe(bloc(MIG, '-- INTRARE-START', '-- INTRARE-END'))
  })
  it('r3: proba de vizibilitate compune EXACT aceeași intrare, de două ori (ca cititorul și ca proprietarul)', () => {
    const VIZ = citeste('../scripts/raport_rezumat_vizibilitate.sql')
    const A = '-- INTRARE-START', B = '-- INTRARE-END', toate = []
    for (let i = VIZ.indexOf(A); i >= 0; i = VIZ.indexOf(A, i + 1)) toate.push(VIZ.slice(i + A.length, VIZ.indexOf(B, i)))
    expect(toate).toHaveLength(2)
    for (const b of toate) expect(b).toBe(bloc(MIG, A, B))
    // doar citire: o tranzacție READ ONLY, ROLLBACK, fără scrieri; rolul schimbat doar local
    expect(VIZ).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m)
    expect(VIZ.trim().endsWith('ROLLBACK;')).toBe(true)
    const fara = VIZ.replace(/--[^\n]*/g, '')
    expect(fara).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMIT)\b/i)
    expect(fara).toContain("EXECUTE 'SET LOCAL ROLE authenticated'")
    // ieșirea nu tipărește id-uri de conturi (doar „cont #k”) și nici textele rapoartelor
    expect(fara).not.toMatch(/RAISE NOTICE[^;]*c\.id/)
  })
  it('r3: intrarea ia DOAR liniile / activitățile / obiectele proiectului șantierului', () => {
    const b = bloc(MIG, '-- INTRARE-START', '-- INTRARE-END')
    expect(b).toContain('JOIN public.sites sp ON sp.id = z.site_id')
    expect(b).toContain('AND (rl.proiect_id IS NULL OR rl.proiect_id = sp.proiect_id)')
    expect(b).toContain('AND (pa.id IS NULL OR pa.proiect_id = sp.proiect_id)')
    expect(b).toContain('AND (pu.id IS NULL OR pu.proiect_id = sp.proiect_id)')
  })
  it('r3: plafonul total și curățarea corecturii sunt aceleași în SQL', () => {
    expect(MIG).toContain(`c_max constant integer := ${MAX_AUTOMAT};`)
    expect(MIG).toContain(`c_sufix constant text := chr(10) || '${SUFIX_SCURTAT.slice(1)}';`)
    expect(MIG).toContain("'[' || chr(1) || '-' || chr(9) || chr(11) || '-' || chr(31) || chr(127) || ']'")
    expect(MIG).toContain('NEW.rezumat_text := public.fn_raport_rezumat_curata_editat(NEW.rezumat_text);')
  })
  it('r3: livrarea cere plafonul de 2000 ms; CHECK NOT VALID (fără scanare sub lock); lock-urile NOWAIT după verificările de catalog', () => {
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
    expect(MIG).toContain("current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current()")
    expect(MIG).toMatch(/\) NOT VALID;\n/)
    const iInainte = MIG.indexOf("PERFORM pg_temp.amp_verifica_20261216a('inainte')")
    const iLock = MIG.indexOf('LOCK TABLE public.rapoarte_zilnice IN ACCESS EXCLUSIVE MODE NOWAIT;')
    const iAlter = MIG.indexOf('ALTER TABLE public.rapoarte_zilnice')
    expect(iInainte).toBeGreaterThan(0)
    expect(iLock).toBeGreaterThan(iInainte)
    expect(iAlter).toBeGreaterThan(iLock)
    expect(MIG.indexOf('LOCK TABLE public.raport_zilnic_salvari IN SHARE ROW EXCLUSIVE MODE NOWAIT;')).toBeGreaterThan(iLock)
    // nicio citire a tabelului sub lock (r2 avea „SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa …” în postcondiții)
    // r4: corpurile plpgsql NU rulează la creare (fn_raport_rezumat_santier_mutat citește rapoartele doar la mutarea unui șantier); restul
    // textului de după lock (instrucțiuni, funcții sql, postcondiții) nu citește tabelul
    const faraCorpuri = MIG.slice(iLock).replace(/LANGUAGE plpgsql[^\n]*AS \$f\$[\s\S]*?\$f\$;/g, '')
    expect(faraCorpuri).toContain('CREATE FUNCTION public.fn_raport_rezumat_santier_mutat()')
    expect(faraCorpuri).not.toMatch(/FROM public\.rapoarte_zilnice\b/)
    // validatorul runnerului cu plafon (scripts/livrare_validator.py, verifica_plafon): pe textul BRUT (și comentariile), fără majuscule,
    // și pe textul comprimat la [a-z0-9_], transaction_timeout / pg_settings apar EXACT de câte ori apare citirea permisă
    const CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
    const permise = MIG.split(CITIRE).length - 1
    const mic = MIG.toLowerCase(), comprimat = mic.replace(/[^a-z0-9_]/g, '')
    expect(permise).toBe(1)
    for (const n of ['transaction_timeout', 'pg_settings']) {
      expect(mic.split(n).length - 1, n).toBe(permise)
      expect(comprimat.split(n).length - 1, n + ' (comprimat)').toBe(permise)
    }
    expect(mic).not.toMatch(/(?<![a-z0-9_$])reset[ \t\n\r\f\v]+all(?![a-z0-9_$])/)
  })
  it('r4: revenirea trece de validatorul runnerului cu plafon; corecturile se caută ÎNAINTEA lock-ului exclusiv, sub SHARE', () => {
    const REV = citeste('../supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql')
    const CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
    const mic = REV.toLowerCase(), comprimat = mic.replace(/[^a-z0-9_]/g, '')
    expect(REV.split(CITIRE).length - 1).toBe(1)
    for (const n of ['transaction_timeout', 'pg_settings']) {
      expect(mic.split(n).length - 1, n).toBe(1)
      expect(comprimat.split(n).length - 1, n + ' (comprimat)').toBe(1)
    }
    // fără control de tranzacție la nivel superior și fără meta-comenzi psql (un singur bloc DO)
    const sus = REV.replace(/--[^\n]*/g, '').replace(/DO \$revenire\$[\s\S]*\$revenire\$;/, '')
    expect(sus.trim()).toBe('')
    const cauta = "IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa = 'editat') THEN"
    const iCauta1 = REV.indexOf(cauta), iShare = REV.indexOf('LOCK TABLE public.rapoarte_zilnice IN SHARE MODE NOWAIT;')
    const iCauta2 = REV.indexOf(cauta, iShare), iExcl = REV.indexOf('LOCK TABLE public.rapoarte_zilnice IN ACCESS EXCLUSIVE MODE;')
    expect(iCauta1).toBeGreaterThan(0)
    expect(iShare).toBeGreaterThan(iCauta1)
    expect(iCauta2).toBeGreaterThan(iShare)
    expect(iExcl).toBeGreaterThan(iCauta2)
    // sub lock-ul exclusiv: nicio citire a tabelului (doar catalog + DROP)
    expect(REV.slice(iExcl)).not.toMatch(/FROM public\.rapoarte_zilnice\b/)
  })
  it('r5: garda ține rândul șantierului ÎNAINTEA oricărei ramuri; mutarea blochează doar rândurile șantierului, NOWAIT, fără lock pe tabel', () => {
    const corp = (nume) => {
      const i = MIG.indexOf(`CREATE FUNCTION public.${nume}()`)
      return MIG.slice(i, MIG.indexOf('END $f$;', i))
    }
    const g = corp('fn_raport_rezumat_garda')
    const iLock = g.indexOf('SELECT s.proiect_id INTO v_proiect FROM public.sites s WHERE s.id = NEW.site_id FOR SHARE OF s;')
    expect(iLock).toBeGreaterThan(0)
    // o singură citire a proiectului, înainte de prima ramură și de compunere
    expect(g.split('FROM public.sites s WHERE s.id = NEW.site_id').length - 1).toBe(1)
    expect(iLock).toBeLessThan(g.indexOf("IF TG_OP = 'INSERT' THEN"))
    expect(iLock).toBeLessThan(g.indexOf('public.fn_raport_rezumat_text(public.fn_raport_rezumat_intrare(NEW))'))
    const m = corp('fn_raport_rezumat_santier_mutat')
    expect(m).not.toMatch(/LOCK TABLE/)
    expect(m).not.toMatch(/lock_timeout/)
    const iNowait = m.indexOf('ORDER BY r.id FOR NO KEY UPDATE OF r NOWAIT;')
    expect(iNowait).toBeGreaterThan(0)
    // lock-ul pe rânduri înaintea verificării corecturilor și a UPDATE-ului (L01 / L06)
    expect(iNowait).toBeLessThan(m.indexOf("r.rezumat_sursa = 'editat' AND r.rezumat_proiect_id IS DISTINCT FROM NEW.proiect_id) x;"))
    expect(iNowait).toBeLessThan(m.indexOf('UPDATE public.rapoarte_zilnice r SET rezumat_sursa = r.rezumat_sursa'))
    expect(m).toContain("RAISE EXCEPTION 'rezumat: șantierul are % cu rezumatul corectat de om pentru proiectul vechi (%)")
  })
  it('harness-ul SQL rulează EXACT tabelul de cazuri din src/raportRezumat.cazuri.json', () => {
    const H = citeste('../scripts/test_executie_raport_rezumat.sql')
    const j = bloc(H, '-- CAZURI-START', '-- CAZURI-END')
    const m = /\$cazuri\$([\s\S]*)\$cazuri\$/.exec(j)
    expect(m).not.toBe(null)
    expect(JSON.parse(m[1])).toEqual(CAZURI)
  })
  it('limitele de tăiere și maximul textului corectat sunt aceleași în SQL', () => {
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'lucrari'), 240)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'probleme'), 240)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'masini'), 160)")
    expect(MIG).toContain("fn_raport_rezumat_sir(q.e, 'motiv'), 80)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'subcontractori'), 200)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'aprovizionare'), 160)")
    expect(MIG).toContain("fn_raport_rezumat_sir(x, 'plan_maine'), 200)")
    expect(MIG).toContain('public.fn_raport_rezumat_taie(pr, 60)')
    expect(MIG).toContain('public.fn_raport_rezumat_taie(s, 80)')
    expect(MIG).toContain('array_to_string(nef[1:3]')
    expect(MIG).toContain(`char_length(rezumat_text) <= ${MAX_EDITAT}`)
    expect([LIMITE.subcontractori, LIMITE.aprovizionare, LIMITE.plan_maine, LIMITE.proiect, LIMITE.santier, LIMITE.nefunctionale])
      .toEqual([200, 160, 200, 60, 80, 3])
  })
  it('harta diacriticelor din SQL = cea din JS (comparația numelui de proiect)', () => {
    const din = /c_din constant text := '([^']+)'/.exec(MIG)[1], in_ = /c_in constant text := '([^']+)'/.exec(MIG)[1]
    expect(Array.from(din).length).toBe(Array.from(in_).length)
    expect(normNume(din)).toBe(in_)
  })
  it('amprentele din revenire = corpurile funcțiilor din migrare (md5 fără CR, ca prosrc din BD)', async () => {
    const { createHash } = await import('node:crypto')
    const REV = citeste('../supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql')
    const linii = bloc(REV, '-- AMPRENTE-START', '-- AMPRENTE-END').split('\n').filter(l => l.includes("('fn_raport_rezumat_"))
    expect(linii.length).toBe(10)   // r4: + fn_raport_rezumat_santier_mutat
    for (const l of linii) {
      const [, nume, amp] = /\('(fn_raport_rezumat_[a-z_]+)', '[^']+', '([0-9a-f]{32})'\)/.exec(l)
      const i = MIG.indexOf(`CREATE FUNCTION public.${nume}(`)
      expect(i, nume).toBeGreaterThan(0)
      const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(MIG.slice(i))
      const st = i + a.index + a[0].length
      expect(createHash('md5').update(MIG.slice(st, MIG.indexOf(a[1], st)), 'utf8').digest('hex'), nume).toBe(amp)
    }
  })
  it('amprenta textului din postcondiția migrării = textul regulii JS pe același caz', async () => {
    const { createHash } = await import('node:crypto')
    const t = rezumatRaport({ santier: 'Ș', proiect: 'ș', data: '2026-01-02', personal: { lacatusi: 2, total: 2 }, probleme: 'a\tb' })
    expect(t).toBe('Ș · 02.01.2026\nOameni: 2 (lăcătuși 2)\nProbleme: a b')
    expect(MIG).toContain(`'${createHash('md5').update(t, 'utf8').digest('hex')}'`)
  })
  it('migrarea nu atinge RPC-urile 20261208a (amprenta lor e ținută de 20261209a / 20261213a)', () => {
    expect(MIG).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.fn_raport_zilnic_/)
    // (comentariile scoase: corpul comun al amprentei L15 explică „* = cu GRANT OPTION”)
    expect(MIG.replace(/--[^\n]*/g, '')).not.toMatch(/GRANT /)
  })
  it('numele și versiunea migrării: 20261216a / 20261216120000, marcajele de livrare și revenire pe același nume', () => {
    expect(MIG.split('\n')[0]).toContain('Version 20261216120000.')
    expect(MIG).toContain("'20261216a_executie_raport_rezumat:' || txid_current()")
    expect(MIG).not.toContain('20261215')
    const H = citeste('../scripts/test_executie_raport_rezumat.sql'), REV = citeste('../supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql')
    // r4: revenirea se livrează prin runner (marcajul de livrare cu numele fișierului de revenire), cu plafonul de 2000 ms
    expect(REV).toContain("current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261216a_executie_raport_rezumat_ROLLBACK:' || txid_current()")
    expect(REV).toContain("IS DISTINCT FROM '2000/session'")
    expect(REV).not.toContain('gazpet.revenire_20261216a')
    expect(H + REV).not.toContain('20261215a')
  })
})
