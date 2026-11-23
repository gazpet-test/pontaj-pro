// Redări — importul TGZ: verificarea fixă a coloanelor de identificare (posibilă coloană decalată), 19.11.2026.
// Toate datele sunt FICTIVE (nume, adrese, telefoane, CNP-uri inventate). Rezultatele așteptate sunt scrise de mână din regula din brief
// (L25: nu calculate cu codul testat).
import { describe, it, expect, afterAll } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseazaTgz, scrieImport, randuriDeTratat, csvRanduriDeTratat, numarRanduriPuseDeoparte, CAMPURI_GRUP, citat, STARE_ELIGIBILA, RPC_REZERVA_NUMERE, MOTIV_NRCRT_INCOMPATIBIL } from './importTgz.js'
import {
  verificaColoaneDecalate, pareTelefonSauCnp, pareEmailSauUrl, contineNume, contineAdresa, numarRanduriDeVerificat, MOTIV_VERIFICARE as M,
  mascheazaRand, indexDeVerificat, semnalFaraValori, VALOARE_ASCUNSA as A, DETALIU_ASCUNS, ETICHETE_DETALIU, ETICHETA_IN_DETALIU, CAMPURI_VERIFICATE,
  campClasat, CAMPURI_DETALIU, CAMPURI_FARA_VALORI_PARCELA,
} from './importVerificareFixa.js'
import { faraDiacritice } from './idParcela.js'
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
  it('CSV-ul „fără nume”: pe parcelele cu semnal se ascunde EXACT câmpul semnalat (în cheia sursă și în detaliu); restul se vede', () => {
    const dt = randuriDeTratat(p)
    // parcela 8 (rândurile 9–10): tarla semnalată (rândul 10) → doar componenta tarla și segmentul „tarla” din detaliu; HG / cadastru rămân
    for (const rand of [9, 10]) expect(dt.find(r => r.rand === rand), String(rand)).toMatchObject({ cheie_sursa: `PRU|108|2345#|${A}`, detaliu: `tarla: ${A}` })
    // parcela 10 (rândul 12): cadastru și tarla semnalate → ambele componente; starea parcelei (text fix) rămâne
    expect(dt.find(r => r.rand === 12)).toMatchObject({ cheie_sursa: `PRU|110|${A}|${A}`, detaliu: `cadastru: ${A}; ${STARE_ELIGIBILA}` })
    const csv = csvRanduriDeTratat(dt).toUpperCase()
    for (const v of VALORI_SENSIBILE) expect(csv, v).not.toContain(v.toUpperCase())
    expect(csv).toContain('DE VERIFICAT — TARLA / NR. TOPO: PARE NUMELE DEȚINĂTORULUI')
    // fără semnale: CSV-ul rămâne ca înainte (cheia sursă și detaliul ambiguității se văd)
    const fara = randuriDeTratat({ ...p, de_verificat: [] })
    expect(fara.find(r => r.rand === 9)).toMatchObject({ cheie_sursa: 'PRU|108|2345#|40123#1234/5/6', detaliu: 'tarla: „40123#1234/5/6” / „IONESCU”' })
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
    // limita asumată (Jakarinos #1140): un separator de articol în mijlocul telefonului întrerupe detecția — documentată, nu ascunsă
    for (const s of ['#', ',', '+', ';']) expect(pareTelefonSauCnp(`0722${s}123456`), s).toBe(false)
    expect(pareTelefonSauCnp('0722123456')).toBe(true)
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
  it('fără apelul din parseazaTgz nu mai iese niciun semnal; fără mascarea în randuriDeTratat, CSV-ul scoate numele', async () => {
    const fara = await incarca('importTgz.js', [{ fisier: 'importTgz.js', din: 'const de_verificat = verificaColoaneDecalate(randuriVerificare)', in: 'const de_verificat = []' }])
    expect(fara.parseazaTgz(excel(), OPT).de_verificat).toEqual([])
    const intact = await incarca('importTgz.js')
    expect(intact.parseazaTgz(excel(), OPT).de_verificat.map(v => [v.rand, v.camp, v.motive])).toEqual(ASTEPTAT)
    const neascuns = await incarca('importTgz.js', [{ fisier: 'importTgz.js', din: 'const r = mascheazaRand(r0, idx)', in: 'const r = r0' }])
    const pv = neascuns.parseazaTgz(excel(), OPT)
    // rândul 12 e „cadastru suspect”: cheia lui (UAT|HG|cadastru|tarla) cuprinde e-mailul ajuns în tarla
    expect(neascuns.csvRanduriDeTratat(neascuns.randuriDeTratat(pv))).toContain('ELENA.D@EXEMPLU.RO')
    expect(intact.csvRanduriDeTratat(intact.randuriDeTratat(intact.parseazaTgz(excel(), OPT))).toUpperCase()).not.toContain('EXEMPLU')
  })
})

// ── r2 (Jakarinos #1140 P1, decizia Răzvan 19.11.2026 = B): lista „de verificat” păstrată în lot; CSV-ul de după import și cel din istoric
// ascund aceleași câmpuri ca previzualizarea. Supabase fals în memorie (forma din __tests__/importTgz.test.js), fără bază reală.
function supabaseFals({ parceleExistente = [] } = {}) {
  const tabele = { red_parcele: parceleExistente.map(r => ({ ...r })), red_detinatori: [], red_detinatori_contact: [], red_import_loturi: [] }
  const inserariLot = []; let nr = 0
  class Q {
    constructor(t) { this.t = t; this.op = null; this.filtre = []; this.unu = false; this.interval = null }
    insert(r) { this.op = 'insert'; this.randuri = Array.isArray(r) ? r : [r]; return this }
    update(v) { this.op = 'update'; this.valori = v; return this }
    select(c) { if (!this.op) this.op = 'select'; this.col = c; return this }
    eq(c, v) { this.filtre.push(r => r[c] === v); return this }
    in(c, l) { const s = new Set(l); this.filtre.push(r => s.has(r[c])); return this }
    is(c, v) { this.filtre.push(r => (v === null ? r[c] == null : r[c] === v)); return this }
    range(a, b) { this.interval = [a, b]; return this }
    single() { this.unu = true; return this }
    then(ok, ko) {
      const t = tabele[this.t]; let rez
      if (this.op === 'insert') {
        const ins = this.randuri.map(r => ({ id: `uuid-${++nr}`, sters_la: null, ...JSON.parse(JSON.stringify(r)) }))
        if (this.t === 'red_import_loturi') inserariLot.push(JSON.parse(JSON.stringify(this.randuri[0])))
        t.push(...ins); rez = { data: this.col ? (this.unu ? ins[0] : ins) : null, error: null }
      } else if (this.op === 'update') {
        for (const r of t.filter(r => this.filtre.every(f => f(r)))) Object.assign(r, JSON.parse(JSON.stringify(this.valori)))
        rez = { data: null, error: null }
      } else {
        let d = t.filter(r => this.filtre.every(f => f(r))); if (this.interval) d = d.slice(this.interval[0], this.interval[1] + 1)
        rez = { data: this.unu ? d[0] ?? null : d, error: null }
      }
      return Promise.resolve(rez).then(ok, ko)
    }
  }
  const numere = {}
  const rpc = async (n, a) => { if (n !== RPC_REZERVA_NUMERE) return { data: null, error: { message: n } }; const s = (numere[a.p_uat3] ?? 0) + 1; numere[a.p_uat3] = s + a.p_n - 1; return { data: s, error: null } }
  return { from: t => new Q(t), rpc, tabele, inserariLot }
}
// parcela 1 (rândul 2, numele în tarla) există deja în BD cu ALT grup Nr.Crt. → oprită „Nr.Crt. incompatibil”: intrarea din lot citează
// cheia sursă, adică exact numele ajuns în tarla
const CHEIE_P1 = 'PRU|101|51384#1079/1,1079/1/1|POPESCU MARIN'
const EXISTENTA_P1 = { id: 'p-existenta', proiect_id: 'proiect-test', id_parcela: 'PRU-0900', cheie_sursa: CHEIE_P1, nr_crt_grup: '1.1', sters_la: null }
const importaFictiv = async (mod = { parseazaTgz, scrieImport }) => {
  const sb = supabaseFals({ parceleExistente: [EXISTENTA_P1] })
  const pv = { ...mod.parseazaTgz(excel(), OPT), proiect_id_previzualizare: 'proiect-test' }
  const rez = await mod.scrieImport(sb, pv, { proiectId: 'proiect-test', versiune: 'v-test' })
  return { sb, rez, lot: sb.tabele.red_import_loturi[0] }
}
const contineSensibil = text => VALORI_SENSIBILE.filter(v => String(text).toUpperCase().includes(v.toUpperCase()))

describe('import TGZ r2 — lista „de verificat” în lot; CSV-ul de după import și din istoric', () => {
  it('lotul (și la creare, și la final) păstrează lista, fără valori; mascarea se face cu ea', async () => {
    const { sb, rez, lot } = await importaFictiv()
    expect(lot.stare).toBe('finalizat')
    expect(rez.nr_crt_incompatibil.map(x => [x.rand, x.cheie_parcela])).toEqual([[2, 'PRU:1']])
    for (const d of [sb.inserariLot[0].diferente, lot.diferente, rez.diferente]) {
      expect(d.de_verificat.map(v => [v.rand, v.camp, v.motive])).toEqual(ASTEPTAT)
      for (const v of d.de_verificat) expect(Object.keys(v).sort()).toEqual(['camp', 'cheie_parcela', 'motiv', 'motive', 'nr_crt', 'rand', 'uat'])
      expect(contineSensibil(JSON.stringify(d.de_verificat))).toEqual([])
    }
    expect(lot.diferente.de_verificat[0]).toEqual({ rand: 2, uat: 'PRU', nr_crt: '1', cheie_parcela: 'PRU:1', camp: 'tarla', motive: [M.NUME], motiv: 'tarla / nr. topo: pare numele deținătorului' })
    // decizia B: valoarea se importă totuși în parcelă, cum e în Excel
    expect(sb.tabele.red_parcele.find(x => x.cheie_sursa === 'PRU|110|WWW.EXEMPLU.RO|ELENA.D@EXEMPLU.RO')).toMatchObject({ tarla: 'elena.d@exemplu.ro', nr_crt_grup: null })
  })
  it('CSV-ul de după import (rezultatul) și cel din istoric (lotul citit din BD) ascund EXACT câmpurile semnalate', async () => {
    const { rez, lot } = await importaFictiv()
    for (const [eticheta, d] of [['după import', rez.diferente], ['istoric', lot.diferente]]) {
      const dt = randuriDeTratat(d)
      expect(contineSensibil(csvRanduriDeTratat(dt)), eticheta).toEqual([])
      expect(dt.find(r => r.rand === 2), eticheta).toMatchObject({ categorie: 'Nr.Crt. incompatibil + de verificat', cheie_sursa: `PRU|101|51384#1079/1,1079/1/1|${A}` })
      expect(dt.find(r => r.rand === 10), eticheta).toMatchObject({ cheie_sursa: `PRU|108|2345#|${A}`, detaliu: `tarla: ${A}` })
      expect(dt.find(r => r.rand === 12), eticheta).toMatchObject({ cheie_sursa: `PRU|110|${A}|${A}` })
      expect(dt.find(r => r.rand === 12).detaliu, eticheta).toMatch(/^cadastru: \[ascuns: de verificat\]; parcela /)
    }
  })
  it('lot vechi (fără listă): CSV-ul rămâne cel de dinainte (comportament neschimbat)', async () => {
    const { lot } = await importaFictiv()
    const { de_verificat, ...vechi } = lot.diferente
    const dt = randuriDeTratat(vechi)
    expect(dt.find(r => r.rand === 2).cheie_sursa).toBe(CHEIE_P1)
    expect(dt.some(r => r.categorie.includes('de verificat'))).toBe(false)
  })
  it('mutant: fără lista în lot, CSV-ul de după import și cel din istoric scot din nou numele', async () => {
    const mut = await incarca('importTgz.js', [{ fisier: 'importTgz.js', din: '...(Array.isArray(preview?.de_verificat) ? { de_verificat: preview.de_verificat.map(semnalFaraValori) } : {}) }', in: '}' }])
    const { rez, lot } = await importaFictiv(mut)
    expect(lot.diferente.de_verificat).toBeUndefined()
    expect(contineSensibil(mut.csvRanduriDeTratat(mut.randuriDeTratat(rez.diferente)))).toContain('POPESCU')
    expect(contineSensibil(mut.csvRanduriDeTratat(mut.randuriDeTratat(lot.diferente)))).toContain('POPESCU')
  })
})

describe('mascheazaRand — o singură funcție, cazuri pozitive / negative', () => {
  const idx = indexDeVerificat([{ rand: 4, cheie_parcela: 'X:1', camp: 'tarla' }])
  it('fără semnal pe obiect → același obiect; cu semnal → copie (originalul neatins)', () => {
    const o = { cheie_parcela: 'X:2', tarla: 'POPESCU', cheie_sursa: 'X|1|2|POPESCU' }
    expect(mascheazaRand(o, idx)).toBe(o)
    expect(mascheazaRand(o, indexDeVerificat([]))).toBe(o)
    const s = { cheie_parcela: 'X:1', tarla: 'POPESCU', poz_hg: 'HG 1', cheie_sursa: 'X|HG 1|C 2|POPESCU' }
    expect(mascheazaRand(s, idx)).toEqual({ cheie_parcela: 'X:1', tarla: A, poz_hg: 'HG 1', cheie_sursa: `X|HG 1|C 2|${A}` })
    expect(s.tarla).toBe('POPESCU')
  })
  it('obiectul-parcelă (cheie) și rezerva pe rând (fără cheie_parcela)', () => {
    expect(mascheazaRand({ cheie: 'X:1', tarla: 'POPESCU' }, idx).tarla).toBe(A)
    expect(mascheazaRand({ rand: 4, cheie_sursa: 'X|1|2|POPESCU' }, idx).cheie_sursa).toBe(`X|1|2|${A}`)
    expect(mascheazaRand({ rand: 5, cheie_sursa: 'X|1|2|POPESCU' }, idx).cheie_sursa).toBe('X|1|2|POPESCU')
  })
  it('cheia cu „|” în valoare: nu se ghicește poziția, se ascunde tot după UAT', () => {
    expect(mascheazaRand({ cheie_parcela: 'X:1', cheie_sursa: 'X|1|A|B|POPESCU' }, idx).cheie_sursa).toBe(`X|${A}`)
  })
  it('detaliul: doar segmentul câmpului semnalat; formă necunoscută / ghilimele dezechilibrate → tot detaliul', () => {
    const m = d => mascheazaRand({ cheie_parcela: 'X:1', detaliu: d }, idx).detaliu
    expect(m('HG: „1” / „2”; tarla: „POPESCU” / „T 1”; și identitate ambiguă')).toBe(`HG: „1” / „2”; tarla: ${A}; și identitate ambiguă`)
    expect(m('cadastru: „##”; parcela eligibilă')).toBe('cadastru: „##”; parcela eligibilă')
    expect(m('tarla: „POPESCU; ION” / „T 1”')).toBe(`tarla: ${A}`)                  // „; ” în valoare nu taie segmentul
    expect(m('tarla: „POPESCU / „T 1”')).toBe(DETALIU_ASCUNS)                       // ghilimele dezechilibrate
    expect(m('grup Nr.Crt. invalid „7.1” (max 9 + 9 cifre)')).toBe(DETALIU_ASCUNS)  // etichetă necunoscută cu valoare citată
    // o valoare care încearcă să închidă ghilimelele și să fabrice un segment: citat() o neutralizează
    const fabricat = `tarla: ${citat('X”; HG: „POPESCU')}`
    expect(fabricat).toBe('tarla: „X"; HG: "POPESCU”')
    expect(m(fabricat)).toBe(`tarla: ${A}`)
  })
  it('„valoare” (cadastru suspect) se ascunde doar când cadastrul e semnalat', () => {
    const c = { cheie_parcela: 'X:1', valoare: '##', detaliu: 'cadastru: „##”; s' }
    expect(mascheazaRand(c, idx)).toEqual(c)
    expect(mascheazaRand(c, indexDeVerificat([{ cheie_parcela: 'X:1', camp: 'nr_cadastral' }]))).toEqual({ cheie_parcela: 'X:1', valoare: A, detaliu: `cadastru: ${A}; s` })
  })
  it('semnal cu câmp necunoscut → se ascund toate cele trei câmpuri (L18)', () => {
    const o = mascheazaRand({ cheie_parcela: 'X:1', poz_hg: 'a', nr_cadastral: 'b', tarla: 'c' }, indexDeVerificat([{ cheie_parcela: 'X:1', camp: 'altceva' }]))
    expect([o.poz_hg, o.nr_cadastral, o.tarla]).toEqual([A, A, A])
  })
  it('semnalFaraValori: lista albă, motivul refăcut din coduri (nimic copiat din câmpuri străine)', () => {
    const s = semnalFaraValori({ rand: 3, uat: 'X', nr_crt: '1', cheie_parcela: 'X:1', camp: 'tarla', motive: ['nume', 'POPESCU'], motiv: 'POPESCU', valoare: 'POPESCU', detaliu: 'POPESCU' })
    expect(s).toEqual({ rand: 3, uat: 'X', nr_crt: '1', cheie_parcela: 'X:1', camp: 'tarla', motive: ['nume'], motiv: 'tarla / nr. topo: pare numele deținătorului' })
    expect(semnalFaraValori({ camp: 'POPESCU' })).toMatchObject({ camp: '', motive: [] })
  })
  it('paritate: etichetele din detaliu = CAMPURI_GRUP din importTgz.js', () => {
    expect([...ETICHETE_DETALIU]).toEqual(CAMPURI_GRUP.map(([, e]) => e))
    for (const c of CAMPURI_VERIFICATE) expect(ETICHETA_IN_DETALIU[c]).toBe(CAMPURI_GRUP.find(([k]) => k === c)[1])
  })
  it('r3: `detaliu_ambiguitate` = același tratament ca `detaliu`; un câmp text necunoscut al unui obiect semnalat se ascunde întreg (L18)', () => {
    const o = { cheie: 'X:1', detaliu_ambiguitate: 'HG: „1” / „2”; tarla: „POPESCU” / „T 1”; și identitate ambiguă', camp_nou: 'POPESCU', nume: 'POPESCU ION', observatii: 'Regim juridic: privat', rand: 4, ambigua: true }
    expect(mascheazaRand(o, idx)).toEqual({ ...o, detaliu_ambiguitate: `HG: „1” / „2”; tarla: ${A}; și identitate ambiguă`, camp_nou: A })
    // fără semnal pe obiect: nimic nu se atinge, nici câmpul necunoscut
    expect(mascheazaRand({ ...o, cheie: 'X:2', rand: 5 }, idx)).toEqual({ ...o, cheie: 'X:2', rand: 5 })
    expect(CAMPURI_DETALIU.filter(c => CAMPURI_FARA_VALORI_PARCELA.includes(c) || CAMPURI_VERIFICATE.includes(c))).toEqual([])
  })
})

// ── r3 (Jakarinos #1140 r2 P1): parserul copiază valorile contradictorii ale unei parcele ambigue în `detaliu_ambiguitate`, pe care
// tab-ul „Parcele” îl afișează (TabelPreview arată toate câmpurile scalare). Regresia pornește din PARSERUL REAL, cu Excel fictiv: două
// rânduri ale aceleiași parcele, tarla = un e-mail / numele deținătorului vs o tarla normală. Date FICTIVE.
const RANDURI_R3 = [
  ['1/1', '201', 'Prunisor', 'Mehedinti', 'ANGHEL RADU', '', 'ana@example.ro', ''],                 // 2: e-mail în tarla
  ['1/2', '', 'Prunisor', 'Mehedinti', 'ANGHEL MARIA', '', 'T 12', ''],                              // 3: tarla normală → contradicție
  ['2/1', '202', 'Prunisor', 'Mehedinti', 'CONSTANTINESCU VLAD', '', 'CONSTANTINESCU VLAD', ''],     // 4: numele deținătorului în tarla
  ['2/2', '', 'Prunisor', 'Mehedinti', 'BARBU ION', '', 'T 13', ''],                                 // 5
  ['3/1', '204', 'Prunisor', 'Mehedinti', 'POPA LUCIAN', '', 'POPA LUCIAN', ''],                     // 6: HG ȘI tarla contradictorii
  ['3/2', '205', 'Prunisor', 'Mehedinti', 'POPA ELENA', '', 'T 15', ''],                             // 7
  [4, '206', 'Prunisor', 'Mehedinti', 'DOBRE GEO', '', 'T 16', ''],                                  // 8: control, fără semnal
]
const N = s => faraDiacritice(String(s ?? '')).toUpperCase()
const EMAIL_R3 = ['ANA@EXAMPLE', 'EXAMPLE.RO']                // nu are voie să apară NICĂIERI
const NUME_IN_TARLA = ['CONSTANTINESCU', 'LUCIAN']             // apar legitim DOAR în câmpurile de nume ale deținătorului
const CAMPURI_NUME = new Set(['nume', 'nume_normalizat', 'cheie_detinator'])
const TABURI = ['parcele', 'detinatori', 'contacte', 'dubluri', 'neidentificati', 'fara_cheie', 'ambigue', 'cadastru_suspect', 'erori']
// ce arată un tab / tabel: aceeași transformare ca ImportTgz.jsx (lista.map(r => mascheazaRand(r, idx))); întoarce „tab.câmp” cu scurgeri
const scurgeri = (liste, masc, idx) => {
  const out = new Set()
  for (const [tab, lista] of liste) for (const o0 of lista || []) {
    if (!o0 || typeof o0 !== 'object') continue   // ex. diferente.existente = listă de id_parcela
    const o = masc(o0, idx)
    for (const [k, v] of Object.entries(o)) {
      if (v == null || typeof v === 'object') continue
      const t = N(v)
      if (EMAIL_R3.some(e => t.includes(e))) out.add(`${tab}.${k}`)
      const campNume = CAMPURI_NUME.has(k) || (tab === 'detinatori' && k === 'cheie')   // cheia deținătorului = parcela + numele
      if (!campNume && NUME_IN_TARLA.some(n => t.includes(n))) out.add(`${tab}.${k}`)
    }
  }
  return [...out].sort()
}
const tabelePreview = pv => TABURI.map(t => [t, pv[t]])
const sensibileInText = text => [...EMAIL_R3, ...NUME_IN_TARLA].filter(v => N(text).includes(v))   // CSV-ul „fără nume”: nimic din ele

describe('import TGZ r3 — parcela contradictorie: valoarea semnalată nu scapă prin `detaliu_ambiguitate` (parserul real)', () => {
  const pv = parseazaTgz(excel(RANDURI_R3), OPT)
  const idx = indexDeVerificat(pv.de_verificat)
  it('premisa: semnalele, parcelele contradictorii și detaliul ambiguității (care conține valoarea) ies din parser', () => {
    expect(pv.erori).toEqual([])
    expect(pv.de_verificat.map(v => [v.rand, v.camp, v.motive])).toEqual([[2, 'tarla', [M.EMAIL_URL]], [4, 'tarla', [M.NUME]], [6, 'tarla', [M.NUME]]])
    expect(pv.parcele.map(p => [p.cheie, p.ambigua, p.detaliu_ambiguitate ?? null])).toEqual([
      ['PRU:1', true, 'tarla: „ANA@EXAMPLE.RO” / „T 12”'],
      ['PRU:2', true, 'tarla: „CONSTANTINESCU VLAD” / „T 13”'],
      ['PRU:3', true, 'HG: „204” / „205”; tarla: „POPA LUCIAN” / „T 15”'],
      ['PRU:4', false, null],
    ])
    // fără mascare, valorile apar în parcele (tarla, cheia sursă, detaliul ambiguității) și în ambigue (cheia sursă, detaliul)
    expect(scurgeri(tabelePreview(pv), o => o)).toEqual(['ambigue.cheie_sursa', 'ambigue.detaliu', 'parcele.cheie_sursa', 'parcele.detaliu_ambiguitate', 'parcele.tarla'])
  })
  it('fiecare tab al previzualizării: nicio valoare semnalată; în detaliul ambiguității doar segmentul câmpului semnalat e ascuns', () => {
    expect(scurgeri(tabelePreview(pv), mascheazaRand, idx)).toEqual([])
    const parc = pv.parcele.map(p => mascheazaRand(p, idx))
    expect(parc.map(p => [p.cheie, p.poz_hg, p.tarla, p.detaliu_ambiguitate ?? null])).toEqual([
      ['PRU:1', '201', A, `tarla: ${A}`],
      ['PRU:2', '202', A, `tarla: ${A}`],
      ['PRU:3', '204', A, `HG: „204” / „205”; tarla: ${A}`],   // HG nu e semnalat: segmentul lui rămâne
      ['PRU:4', '206', 'T 16', null],                            // parcelă fără semnal: neschimbată
    ])
    expect(parc[3]).toBe(pv.parcele[3])
    expect(pv.ambigue.map(a => mascheazaRand(a, idx)).map(a => [a.rand, a.detaliu])).toEqual([
      [2, `tarla: ${A}`], [3, `tarla: ${A}`], [4, `tarla: ${A}`], [5, `tarla: ${A}`], [6, `HG: „204” / „205”; tarla: ${A}`], [7, `HG: „204” / „205”; tarla: ${A}`],
    ])
    expect(pv.parcele[0].detaliu_ambiguitate).toBe('tarla: „ANA@EXAMPLE.RO” / „T 12”')   // previzualizarea însăși rămâne neatinsă (decizia B)
  })
  it('CSV-ul previzualizării, cel de după import și cel din istoric + tabelele raportului: nicio valoare semnalată', async () => {
    expect(sensibileInText(csvRanduriDeTratat(randuriDeTratat(pv)))).toEqual([])
    const sb = supabaseFals()
    const rez = await scrieImport(sb, { ...pv, proiect_id_previzualizare: 'proiect-test' }, { proiectId: 'proiect-test', versiune: 'v-test' })
    const lot = sb.tabele.red_import_loturi[0]
    expect(lot.stare).toBe('finalizat')
    for (const [et, d] of [['după import', rez.diferente], ['istoric', lot.diferente]]) {
      expect(sensibileInText(csvRanduriDeTratat(randuriDeTratat(d))), et).toEqual([])
      const ix = indexDeVerificat(d.de_verificat)
      expect(scurgeri(Object.entries(d).filter(([, v]) => Array.isArray(v)), mascheazaRand, ix), et).toEqual([])
    }
    // tabelele raportului de după import (ImportTgz.jsx: raport[k].map(x0 => mascheazaRand(x0, idxRaport)))
    expect(scurgeri([['raport.ambigue', rez.ambigue], ['raport.fara_cheie', rez.fara_cheie]], mascheazaRand, indexDeVerificat(rez.diferente.de_verificat))).toEqual([])
  })
  it('mesajul de eroare „două parcele ACTIVE” (afișat și scris în lot.eroare) nu citează cheia sursă', async () => {
    const dubla = [EXISTENTA_P1, { ...EXISTENTA_P1, id: 'p-a-doua', id_parcela: 'PRU-0901' }]
    const sb = supabaseFals({ parceleExistente: dubla })
    const e = await scrieImport(sb, { ...parseazaTgz(excel(), OPT), proiect_id_previzualizare: 'proiect-test' }, { proiectId: 'proiect-test', versiune: 'v-test' }).catch(x => x)
    expect(e.message).toBe('Două parcele ACTIVE cu aceeași cheie sursă (PRU-0900, PRU-0901; parcela PRU:1 din fișier) — UNIQUE încălcat?; nimic nu a fost scris')
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', eroare: e.message })
    expect(contineSensibil(e.message)).toEqual([])
  })
})

// Mutanți pe mascare (sursa copiată, o modificare textuală exactă): fără tratarea câmpului derivat, valoarea iese din nou în tab-ul „Parcele”
const MUT_R3 = {
  // `detaliu_ambiguitate` clasat (greșit) ca text fără valori — echivalentul lui ed730c43 (r2: se masca doar `detaliu`)
  derivatCaSigur: [
    { fisier: F, din: "Object.freeze(['detaliu', 'detaliu_ambiguitate'])", in: "Object.freeze(['detaliu'])" },
    { fisier: F, din: "'observatii',", in: "'observatii', 'detaliu_ambiguitate'," },
  ],
  // doar scos din clasa „detaliu”: rămâne neclasat → ascuns ÎNTREG de regula pentru câmpuri necunoscute (L18), nu scapă
  scosDinDetaliu: [{ fisier: F, din: "Object.freeze(['detaliu', 'detaliu_ambiguitate'])", in: "Object.freeze(['detaliu'])" }],
  // fără regula pentru câmpuri necunoscute: azi nu scapă nimic (toate câmpurile sunt clasate), dar un câmp nou ar scăpa
  faraNecunoscute: [{ fisier: F, din: 'else if (!CAMPURI_FARA_VALORI_PARCELA.includes(k)) out[k] = VALOARE_ASCUNSA', in: '' }],
}
describe('import TGZ r3 — mutanți pe mascare', () => {
  const ruleaza = async mutatii => {
    const mod = await incarca('importTgz.js', mutatii)
    const vf = await incarca(F, mutatii)
    const pv = mod.parseazaTgz(excel(RANDURI_R3), OPT)
    return { pv, vf, mod, idx: vf.indexDeVerificat(pv.de_verificat) }
  }
  it('intactul (copiat): nicio scurgere', async () => {
    const { pv, vf, idx } = await ruleaza([])
    expect(scurgeri(tabelePreview(pv), vf.mascheazaRand, idx)).toEqual([])
  })
  it('mutant „câmpul derivat clasat ca sigur” (forma r2): `detaliu_ambiguitate` scoate e-mailul și numele în tab-ul „Parcele”', async () => {
    const { pv, vf, idx } = await ruleaza(MUT_R3.derivatCaSigur)
    expect(scurgeri(tabelePreview(pv), vf.mascheazaRand, idx)).toEqual(['parcele.detaliu_ambiguitate'])
    expect(vf.mascheazaRand(pv.parcele[0], idx).detaliu_ambiguitate).toBe('tarla: „ANA@EXAMPLE.RO” / „T 12”')
  })
  it('mutant „scos din clasa detaliu”: nu scapă (câmp necunoscut → ascuns întreg), dar se pierde restul textului', async () => {
    const { pv, vf, idx } = await ruleaza(MUT_R3.scosDinDetaliu)
    expect(scurgeri(tabelePreview(pv), vf.mascheazaRand, idx)).toEqual([])
    expect(vf.mascheazaRand(pv.parcele[2], idx).detaliu_ambiguitate).toBe(A)
  })
  it('mutant „fără regula pentru câmpuri necunoscute”: un câmp text nou al parcelei ar scăpa nemascat', async () => {
    const { pv, vf, idx } = await ruleaza(MUT_R3.faraNecunoscute)
    expect(scurgeri(tabelePreview(pv), vf.mascheazaRand, idx)).toEqual([])   // azi toate câmpurile sunt clasate
    const cuCampNou = pv.parcele.map(p => ({ ...p, rezumat_nou: `tarla ${p.tarla}` }))
    expect(scurgeri([['parcele', cuCampNou]], vf.mascheazaRand, idx)).toEqual(['parcele.rezumat_nou'])
    expect(scurgeri([['parcele', cuCampNou]], mascheazaRand, indexDeVerificat(pv.de_verificat))).toEqual([])   // intactul îl ascunde
  })
})

// Inventarul (cerința 3): fiecare câmp text ieșit din parser și din scrieImport, pe obiectele care trec prin mascare, e clasat în
// importVerificareFixa.js; un câmp NOU construit din valorile parcelei pică aici până e clasat. Fixture-uri: RANDURI, RANDURI_R3 și
// scenariile din BD fals (Nr.Crt. incompatibil, identitate ștearsă logic).
describe('import TGZ r3 — inventarul câmpurilor text', () => {
  const obiecteCuParcela = async () => {
    const out = []   // [sursa, obiect]
    const pv1 = parseazaTgz(excel(), OPT); const pv3 = parseazaTgz(excel(RANDURI_R3), OPT)
    for (const [et, pv] of [['RANDURI', pv1], ['RANDURI_R3', pv3]]) for (const t of TABURI) for (const o of pv[t] || []) out.push([`${et}.${t}`, o])
    const { rez, lot } = await importaFictiv()
    const cheie4 = pv3.parcele.find(p => p.cheie === 'PRU:4').cheie_sursa
    const sb = supabaseFals({ parceleExistente: [{ id: 'p-stearsa', proiect_id: 'proiect-test', id_parcela: 'PRU-0800', cheie_sursa: cheie4, nr_crt_grup: null, sters_la: '2026-11-01T00:00:00Z' }] })
    const rez3 = await scrieImport(sb, { ...pv3, proiect_id_previzualizare: 'proiect-test' }, { proiectId: 'proiect-test', versiune: 'v-test' })
    expect(rez3.identitate_stearsa.map(x => [x.rand, x.detaliu])).toEqual([[8, 'parcela ștearsă logic: PRU-0800']])
    expect(rez.nr_crt_incompatibil).toHaveLength(1)
    for (const [et, d] of [['rez', rez], ['lot', lot.diferente], ['rez3', rez3], ['lot3', sb.tabele.red_import_loturi[0].diferente]])
      for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) for (const o of v) if (o && typeof o === 'object') out.push([`${et}.${k}`, o])
    return out
  }
  it('toate câmpurile text sunt clasate; contactele n-au cheie de parcelă (nu se potrivesc niciodată cu un semnal)', async () => {
    const neclasate = new Set(); let campuriText = 0
    for (const [sursa, o] of await obiecteCuParcela()) {
      if (sursa.endsWith('.contacte')) { expect(['cheie_parcela', 'cheie', 'rand'].filter(k => k in o), sursa).toEqual([]); continue }
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string') { campuriText++; if (!campClasat(k)) neclasate.add(`${sursa}.${k}`) }
    }
    expect(campuriText).toBeGreaterThan(100)
    expect([...neclasate]).toEqual([])
  })
  it('orice câmp care citează valori („…”) pe un obiect de parcelă e în CAMPURI_DETALIU (motivele = texte fixe din cod)', async () => {
    const cuCitate = new Set(); const motiveCitate = new Set()
    for (const [, o] of await obiecteCuParcela()) {
      if (!('cheie_parcela' in o) && !('cheie' in o)) continue
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && /[„”]/.test(v)) { if (k === 'motiv') motiveCitate.add(v); else cuCitate.add(k) }
    }
    expect([...cuCitate].sort()).toEqual([...CAMPURI_DETALIU].sort())
    // singurul motiv cu ghilimele e textul fix al Nr.Crt. incompatibil („x.y” / „x” = exemple din cod, nu valori din fișier)
    expect([...motiveCitate]).toEqual([MOTIV_NRCRT_INCOMPATIBIL])
  })
})
