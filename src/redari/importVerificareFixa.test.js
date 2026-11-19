// Redări — importul TGZ: verificarea fixă a coloanelor de identificare (posibilă coloană decalată), 19.11.2026.
// Toate datele sunt FICTIVE (nume, adrese, telefoane, CNP-uri inventate). Rezultatele așteptate sunt scrise de mână din regula din brief
// (L25: nu calculate cu codul testat).
import { describe, it, expect, afterAll } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseazaTgz, randuriDeTratat, csvRanduriDeTratat, numarRanduriPuseDeoparte, DETALIU_ASCUNS } from './importTgz.js'
import {
  verificaColoaneDecalate, pareTelefonSauCnp, pareEmailSauUrl, contineNume, contineAdresa, numarRanduriDeVerificat, MOTIV_VERIFICARE as M,
} from './importVerificareFixa.js'
import { canonizeazaIdentificator, MOTIV } from './identificatoriPublici.js'

const ANTET = ['Nr.Crt.', 'Poz. HG', 'UAT', 'Județ', 'Nume Deținător', 'Adresa', 'Tarla/Nr. Topo', 'Nr. cadastral/Parcelă']
// rândul Excel = indexul din listă + 2 (antetul e pe rândul 1)
const RANDURI = [
  [1, '101', 'Prunisor', 'Mehedinti', 'POPESCU MARIN', 'sat Garnita, com. Prunisor', 'POPESCU MARIN', '51384#1079/1,1079/1/1'],   // 2: numele în tarla
  [2, '102', 'Prunisor', 'Mehedinti', 'IONESCU ANA', 'Str. Libertatii nr. 5, sat Garnita, com. Prunisor', 'UP II Gârnița', 'Str. Libertatii nr. 5, sat Garnita, com. Prunisor'],   // 3: adresa în cadastru
  [3, '0722 123 456', 'Prunisor', 'Mehedinti', 'MARINESCU ION', 'sat Garnita', 'UA 80G', 'HCN 949'],   // 4: telefon în poz. HG
  [4, '1800101123456', 'Prunisor', 'Mehedinti', 'VASILESCU DAN', '', 'HR_4004', 'PD_1913'],   // 5: CNP în poz. HG
  [5, '105', 'Prunisor', 'Mehedinti', 'PAROHIA GARNITA', 'sat Gârnița, com. Prunișor', 'UP II Gârnița', '#1/2#'],   // 6: legitim (localitatea)
  [6, '106', 'Prunisor', 'Mehedinti', 'POP UTA', '', 'UTA 12', 'HCN 949'],   // 7: legitim (nume scurt)
  [7, '107', 'Prunisor', 'Mehedinti', 'VALE ION', '', 'VALEA 12', '50029#30#'],   // 8: legitim (cuvânt întreg, nu subșir)
  ['8/1', '108', 'Prunisor', 'Mehedinti', 'IONESCU VASILE', '', '40123#1234/5/6', '2345#'],   // 9: legitim (nu se lipește peste „#”)
  ['8/2', '', 'Prunisor', 'Mehedinti', 'MARINESCU ANA', '', 'IONESCU', ''],   // 10: numele altui deținător din grup
  [9, '109', 'Prunisor', 'Mehedinti', 'ȘTEFĂNESCU MIHAI', '', 'STEFANESCU 3', ''],   // 11: diacritice
  [10, '110', 'Prunisor', 'Mehedinti', 'DUMITRU ELENA', '', 'elena.d@exemplu.ro', 'www.exemplu.ro'],   // 12: e-mail / web
]
const excel = (randuri = RANDURI) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ANTET, ...randuri]), 'TGZ')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
const OPT = { uats: [{ id: 'uat-test', nume: 'Prunișor', uat3: 'PRU' }] }
// valorile fictive care NU au voie să apară în raportul „de verificat” sau în CSV-ul fără nume
const VALORI_SENSIBILE = ['POPESCU', 'LIBERTATII', '0722', '1800101', 'IONESCU', 'STEFANESCU', 'exemplu', 'ELENA']

const ASTEPTAT = [   // [rând, câmp, motive] — în ordinea rândurilor, apoi poz_hg / nr_cadastral / tarla
  [2, 'tarla', [M.NUME]],
  [3, 'nr_cadastral', [M.ADRESA]],
  [4, 'poz_hg', [M.TELEFON_CNP]],
  [5, 'poz_hg', [M.TELEFON_CNP]],
  [10, 'tarla', [M.NUME]],
  [11, 'tarla', [M.NUME]],
  [12, 'nr_cadastral', [M.EMAIL_URL]],
  [12, 'tarla', [M.NUME, M.EMAIL_URL]],   // „elena.d@…” conține și prenumele deținătorului
]

describe('import TGZ — verificarea fixă a coloanelor decalate (previzualizare)', () => {
  const p = parseazaTgz(excel(), OPT)
  it('semnalează exact rândurile cu nume / adresă / telefon / CNP / e-mail în tarla, cadastru, poz. HG; formele Transgaz legitime nu', () => {
    expect(p.erori).toEqual([])
    expect(p.de_verificat.map(v => [v.rand, v.camp, v.motive])).toEqual(ASTEPTAT)
    expect(p.statistici.de_verificat).toBe(8)
    expect(p.statistici.randuri_de_verificat).toBe(7)
    expect(numarRanduriDeVerificat(p.de_verificat)).toBe(7)
    expect(p.de_verificat[0]).toEqual({ rand: 2, uat: 'PRU', nr_crt: '1', cheie_parcela: 'PRU:1', camp: 'tarla', motive: [M.NUME], motiv: 'tarla / nr. topo: pare numele deținătorului' })
  })
  it('raportul NU conține valorile (doar rândul, parcela, câmpul, motivul)', () => {
    const json = JSON.stringify(p.de_verificat).toUpperCase()
    for (const v of VALORI_SENSIBILE) expect(json, v).not.toContain(v.toUpperCase())
    for (const v of p.de_verificat) expect(Object.keys(v).sort()).toEqual(['camp', 'cheie_parcela', 'motiv', 'motive', 'nr_crt', 'rand', 'uat'])
  })
  it('semnalul NU blochează și NU schimbă importul: aceleași parcele / deținători / chei ca fără verificare', () => {
    // parcela 8 e ambiguă din cauza tarlalei contradictorii („40123#…” / „IONESCU”), nu din cauza semnalului
    expect(p.parcele.filter(x => !x.ambigua && x.cheie_sursa).map(x => x.cheie)).toEqual(['PRU:1', 'PRU:2', 'PRU:3', 'PRU:4', 'PRU:5', 'PRU:6', 'PRU:7', 'PRU:9', 'PRU:10'])
    expect(p.ambigue.map(a => a.rand)).toEqual([9, 10])
    expect(p.statistici.parcele_de_importat).toBe(9)
    expect(p.statistici.reconciliere_randuri.ok).toBe(true)
    // rândurile doar „de verificat” sunt marcaj (informativ), nu „puse deoparte” — aceeași definiție ca statistica (L19)
    const dt = randuriDeTratat(p)
    expect(numarRanduriPuseDeoparte(dt)).toBe(p.statistici.randuri_de_tratat)
    expect(p.statistici.randuri_de_tratat).toBe(2)
    expect(dt.filter(r => r.categorie === 'de verificat').map(r => [r.rand, r.informativ])).toEqual([[2, true], [3, true], [4, true], [5, true], [11, true]])
    expect(dt.find(r => r.rand === 10)).toMatchObject({ categorie: 'ambiguă + de verificat', informativ: false })
    // „www.exemplu.ro” în cadastru n-are nicio cifră → e și „cadastru suspect” (marcajul vechi); două marcaje = tot informativ
    expect(dt.find(r => r.rand === 12)).toMatchObject({ categorie: 'cadastru suspect + de verificat', informativ: true })
  })
  it('CSV-ul „fără nume”: pe parcelele cu semnal, cheia sursă și detaliul (care citează valori) sunt ascunse', () => {
    const dt = randuriDeTratat(p)
    for (const r of dt.filter(r => [2, 3, 4, 5, 9, 10, 11, 12].includes(r.rand))) { expect(r.cheie_sursa, String(r.rand)).toBe(''); expect(r.detaliu).toBe(DETALIU_ASCUNS) }
    const csv = csvRanduriDeTratat(dt).toUpperCase()
    for (const v of VALORI_SENSIBILE) expect(csv, v).not.toContain(v.toUpperCase())
    expect(csv).toContain('DE VERIFICAT — TARLA / NR. TOPO: PARE NUMELE DEȚINĂTORULUI')
    // fără semnale: CSV-ul rămâne ca înainte (cheia sursă și detaliul ambiguității se văd)
    const fara = randuriDeTratat({ ...p, de_verificat: [] })
    expect(fara.find(r => r.rand === 9).cheie_sursa).toMatch(/^PRU\|/)
    expect(fara.some(r => r.categorie.includes('de verificat'))).toBe(false)
  })
  it('fișier fără semnale: listă goală, statistici 0', () => {
    const q = parseazaTgz(excel(RANDURI.slice(4, 8)), OPT)
    expect(q.de_verificat).toEqual([])
    expect([q.statistici.de_verificat, q.statistici.randuri_de_verificat]).toEqual([0, 0])
    // fișier necitibil: forma rezultatului are și lista goală
    const r = parseazaTgz(new Uint8Array([1, 2, 3]), OPT)
    expect(r.de_verificat).toEqual([])
  })
})

// ── Tabelul regulilor: [eticheta, câmp, valoare, nume, adresa, sat din adresă, motive așteptate] (UAT-ul rândului: Prunișor)
const T = [
  ['nume întreg', 'tarla', 'POPESCU MARIN', 'POPESCU MARIN', '', '', [M.NUME]],
  ['cuvânt din nume', 'nr_cadastral', '12#POPESCU#', 'POPESCU ION', '', '', [M.NUME]],
  ['diacritice', 'tarla', 'STEFANESCU 3', 'ȘTEFĂNESCU MIHAI', '', '', [M.NUME]],
  ['nume scurt complet', 'tarla', 'POP ANA', 'Pop Ana', '', '', [M.NUME]],
  ['nume scurt parțial', 'tarla', 'UTA 12', 'POP UTA', '', '', []],
  ['nume de 2 litere', 'tarla', 'UA 80G', 'UA ION', '', '', []],
  ['subșir', 'tarla', 'VALEA 12', 'VALE ION', '', '', []],
  ['localitatea UAT', 'tarla', 'UP II PRUNISOR', 'COMUNA PRUNIȘOR', '', '', []],
  ['localitatea din adresă', 'tarla', 'UP II Gârnița', 'PAROHIA GARNITA', 'sat Gârnița', 'Gârnița', []],
  ['generic TGZ', 'tarla', 'TARLA 12', 'TARLA ION', '', '', []],
  ['adresa completă', 'nr_cadastral', 'Str. Libertatii nr. 5, sat Garnita', 'IONESCU ANA', 'Str. Libertății nr. 5, sat Gârnița', 'Gârnița', [M.ADRESA]],
  ['bucată de adresă', 'nr_cadastral', 'Str. Libertatii nr. 5', 'IONESCU ANA', 'Str. Libertății nr. 5, sat Gârnița', 'Gârnița', [M.ADRESA]],
  ['localitatea nu e adresă', 'tarla', 'UP II GARNITA', 'IONESCU ANA', 'sat Garnita', 'Garnita', []],
  ['telefon mobil', 'poz_hg', '0722 123 456', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['telefon +40', 'poz_hg', '+40 722 123 456', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['telefon 0040', 'tarla', '0040722123456', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['telefon fix', 'poz_hg', '021 312 34 56', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['telefon cu text', 'tarla', 'tel. 0733-111-222', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['CNP', 'poz_hg', '1800101123456', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['CNP în cadastru compus', 'nr_cadastral', '1800101123456##', 'IONESCU ANA', '', '', [M.TELEFON_CNP]],
  ['9 cifre', 'poz_hg', '722123456', 'IONESCU ANA', '', '', []],
  ['12 cifre', 'nr_cadastral', '123456789012', 'IONESCU ANA', '', '', []],
  ['peste „#”', 'tarla', '40123#1234/5/6', 'IONESCU ANA', '', '', []],
  ['listă', 'nr_cadastral', '51384#1079/1,1079/1/1', 'IONESCU ANA', '', '', []],
  ['listă cu 40', 'nr_cadastral', '4079/1,4079/1/1', 'IONESCU ANA', '', '', []],
  ['e-mail', 'tarla', 'ion.pop@exemplu.ro', 'ALTCINEVA X', '', '', [M.EMAIL_URL]],
  ['url', 'nr_cadastral', 'https://exemplu.com/x', 'ALTCINEVA X', '', '', [M.EMAIL_URL]],
  ['www', 'tarla', 'www.exemplu.ro', 'ALTCINEVA X', '', '', [M.EMAIL_URL]],
  ['legitim UP', 'tarla', 'UP II Gârnița', 'IONESCU ANA', '', '', []],
  ['legitim UA', 'tarla', 'UA 80G', 'IONESCU ANA', '', '', []],
  ['legitim HCN', 'nr_cadastral', 'HCN 949', 'IONESCU ANA', '', '', []],
  ['legitim HR_', 'poz_hg', 'HR_4004', 'IONESCU ANA', '', '', []],
  ['legitim PD_', 'tarla', 'PD_1913', 'IONESCU ANA', '', '', []],
  ['legitim fracție', 'nr_cadastral', '#1/2#', 'IONESCU ANA', '', '', []],
  ['legitim compus', 'nr_cadastral', '50029#30#', 'IONESCU ANA', '', '', []],
  ['legitim punct', 'tarla', 'T.12', 'IONESCU ANA', '', '', []],
]
const rezultatT = mod => T.map(([, camp, valoare, nume, adresa, sat]) => {
  const r = mod.verificaColoaneDecalate([{ rand: 1, uat: 'PRU', nr_crt: '1', cheie_parcela: 'PRU:1', [camp]: valoare, nume, adresa, adresa_sat: sat, adresa_comuna: '', uat_nume: 'Prunișor' }])
  return r.length ? r[0].motive : []
})
const diferente = mod => { const r = rezultatT(mod); return T.filter((t, i) => JSON.stringify(r[i]) !== JSON.stringify(t[6])).map(t => t[0]) }

describe('regulile, pe tabel', () => {
  it('fiecare caz dă exact motivele așteptate', () => {
    const r = rezultatT({ verificaColoaneDecalate })
    T.forEach((t, i) => expect(r[i], t[0]).toEqual(t[6]))
  })
  it('helperii: pozitiv + negativ', () => {
    expect(contineNume('x', '')).toBe(false)
    expect(contineNume('', 'POPESCU')).toBe(false)
    expect(contineAdresa('POPESCU', 'PRUNISOR')).toBe(false)   // adresa de un singur cuvânt nu se compară
    expect(pareEmailSauUrl('a@b')).toBe(false)
    expect(pareEmailSauUrl('a@b.ro')).toBe(true)
    expect(pareTelefonSauCnp(null)).toBe(false)
  })
  it('telefonul / CNP-ul: aceeași formă ca detectorul anunțului (identificatoriPublici.js) pe valorile pe care acela le judecă doar după ferestre', () => {
    // valori cu forma subcâmpurilor de tarla (≤ 6 cifre pe subcâmp, fără „,” / „+”), într-un singur articol: cele două detectoare trebuie să coincidă
    const lipit = v => v.replace(/#/g, '')   // articolul importului = toată valoarea, fără „#”
    const CAZURI = [
      ['07221#23456', true], ['03123#45678', true], ['02123#45678', true], ['08123#45678', false], ['40722#123456', true], ['0040#722123#456', true],
      ['180010#112345#6', true], ['72212#3456', false], ['07221#234567', false], ['123456#123456', false], ['012345#678901#2', true], ['50029#30', false],
    ]
    for (const [v, asteptat] of CAZURI) {
      expect(canonizeazaIdentificator('tarla', v).motiv === MOTIV.TELEFON_CNP, `anunț ${v}`).toBe(asteptat)
      expect(pareTelefonSauCnp(lipit(v)), `import ${v}`).toBe(asteptat)
    }
  })
})

// ── Mutanți (sursa din arborele de lucru, o regulă scoasă pe rând): fiecare schimbă EXACT cazurile ei din tabel / din fișier
const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
const RX_IMPORT_LOCAL = /from\s+'\.\/([\w.-]+\.js)'/g
const sursa = n => readFileSync(new URL(`./${n}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')   // CRLF în arborele de lucru pe Windows
async function incarca(intrare, mutatii = []) {
  const dir = mkdtempSync(join(TMP, 'verif_fixa_')); foldere.push(dir)
  const surse = new Map(); const coada = [intrare]
  while (coada.length) {
    const n = coada.shift(); if (surse.has(n)) continue
    let t = sursa(n)
    for (const m of mutatii.filter(x => x.fisier === n)) {
      if (t.split(m.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${n}: ${m.din}`)
      t = t.replace(m.din, m.in)
    }
    surse.set(n, t)
    for (const m of t.matchAll(RX_IMPORT_LOCAL)) coada.push(m[1])
  }
  for (const [n, t] of surse) writeFileSync(join(dir, n), t)
  return import(pathToFileURL(join(dir, intrare)).href + `?v=${Date.now()}${Math.random()}`)
}
const F = 'importVerificareFixa.js'
const MUT = {
  subsir: { fisier: F, din: '!localitati.has(w) && setV.has(w))) return true', in: "!localitati.has(w) && v.join(' ').includes(w))) return true" },
  localitati: { fisier: F, din: '!CUVINTE_GENERICE.has(w) && !localitati.has(w) && setV.has(w)', in: '!CUVINTE_GENERICE.has(w) && setV.has(w)' },
  articole: { fisier: F, din: "String(valoare ?? '').split(/[#,+;]/).some(", in: "[String(valoare ?? '')].some(" },
  minLitere: { fisier: F, din: 'export const MIN_LITERE_CUVANT = 4', in: 'export const MIN_LITERE_CUVANT = 3' },
  generice: { fisier: F, din: "'TARLA', 'TARLAUA', ", in: "'TARLAUA', " },
}
describe('mutanți', () => {
  it('intactul (copiat) nu are diferențe; fiecare regulă scoasă schimbă EXACT cazurile ei', async () => {
    expect(diferente(await incarca(F))).toEqual([])
    expect(diferente(await incarca(F, [MUT.subsir]))).toEqual(['subșir'])
    expect(diferente(await incarca(F, [MUT.localitati]))).toEqual(['localitatea UAT', 'localitatea din adresă'])
    expect(diferente(await incarca(F, [MUT.articole]))).toEqual(['peste „#”', 'listă cu 40'])
    expect(diferente(await incarca(F, [MUT.minLitere]))).toEqual(['nume scurt parțial'])
    expect(diferente(await incarca(F, [MUT.generice]))).toEqual(['generic TGZ'])
  })
  it('fără apelul din parseazaTgz nu mai iese niciun semnal; fără ascunderea cheii, CSV-ul scoate numele', async () => {
    const fara = await incarca('importTgz.js', [{ fisier: 'importTgz.js', din: 'const de_verificat = verificaColoaneDecalate(randuriVerificare)', in: 'const de_verificat = []' }])
    expect(fara.parseazaTgz(excel(), OPT).de_verificat).toEqual([])
    const intact = await incarca('importTgz.js')
    expect(intact.parseazaTgz(excel(), OPT).de_verificat.map(v => [v.rand, v.camp, v.motive])).toEqual(ASTEPTAT)
    const neascuns = await incarca('importTgz.js', [{ fisier: 'importTgz.js', din: "cheie_sursa: g.ascuns ? '' : g.cheie_sursa,", in: 'cheie_sursa: g.cheie_sursa,' }])
    const pv = neascuns.parseazaTgz(excel(), OPT)
    // rândul 12 e „cadastru suspect”: cheia lui (UAT|HG|cadastru|tarla) cuprinde e-mailul ajuns în tarla
    expect(neascuns.csvRanduriDeTratat(neascuns.randuriDeTratat(pv))).toContain('ELENA.D@EXEMPLU.RO')
    expect(intact.csvRanduriDeTratat(intact.randuriDeTratat(intact.parseazaTgz(excel(), OPT))).toUpperCase()).not.toContain('EXEMPLU')
  })
})
