import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaTgz, scrieImport, parseazaNrCrt, imparteAdresa, cheieSursa, LOT, RPC_REZERVA_NUMERE } from '../importTgz.js'

// ───────── fixture: xlsx fictiv construit în test (antet pe rândul 3) ─────────
const ANTET = ['Nr.Crt.', 'Nr.Poz.Hg.', 'UAT', 'Județ', 'Nume Deținător', 'Adresă', 'Suprafață Afectată Temporar',
  'Categorie Folosință', 'Tarla/Nr. Topo', 'Nr. cadastral/Parcelă', 'Regim juridic']

function xlsxDin(randuri, { antet = ANTET, randAntet = 3 } = {}) {
  const aoa = []
  for (let i = 1; i < randAntet; i++) aoa.push(i === 1 ? ['Raport Informatii Generale Terenuri — FICTIV'] : [])
  aoa.push(antet)
  for (const r of randuri) aoa.push(r)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Raport')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

const UATS = [
  { id: 'uuid-hus', nume: 'Husnicioara', uat3: 'HUS' },
  { id: 'uuid-pru', nume: 'Prunișor', uat3: 'PRU' },
]
const OPT = { uats: UATS, tronsonPeUat: { HUS: 3, PRU: 2 }, versiune: 'TGZ 13.07.2026', sursa: 'TGZ' }

// 12 rânduri fictive: proprietar simplu, coproprietari 7/1 și 7/2, neidentificat, adresă goală, UAT necunoscut, dublură...
const RANDURI = [
  ['1', 'HG 1', 'Husnicioara', 'Mehedinți', 'Test Proprietar Unu', 'Sat Peri, Com. Husnicioara, Str. Fictivă nr. 1', '120,5', 'arabil', 'T12', 'CF 1001', 'privat'],
  ['2', 'HG 2', 'Husnicioara', 'Mehedinți', 'Test Proprietar Doi', 'Str. Exemplu nr. 2', 80, 'pășune', 'T13', 'CF 1002', 'privat'],
  ['7/1', 'HG 7', 'Husnicioara', 'Mehedinți', 'Test Coproprietar Alfa', 'Sat Peri, Com. Husnicioara', 300, 'arabil', 'T20', 'CF 1007', 'privat'],
  ['7/2', 'HG 7', 'Husnicioara', 'Mehedinți', 'Test Coproprietar Beta', 'Com. Husnicioara, sat Peri', 300, 'arabil', 'T20', 'CF 1007', 'privat'],
  ['8', 'HG 8', 'Husnicioara', 'Mehedinți', 'Proprietar NEIDENTIFICAT', '', 50, 'fâneață', 'T21', 'CF 1008', 'neclarificat'],
  ['9', 'HG 9', 'Husnicioara', 'Mehedinți', 'Test Fără Adresă', '', 60, 'arabil', 'T22', 'CF 1009', 'privat'],
  ['10', 'HG 10', 'Comuna Inexistentă', 'Mehedinți', 'Test Uat Gresit', 'Str. X', 10, 'arabil', 'T1', 'CF 1', 'privat'],
  ['11', 'HG 11', 'Husnicioara', 'Mehedinți', 'Test Dublură', 'Str. Y nr. 3', 20, 'arabil', 'T23', 'CF 1011', 'privat'],
  ['11', 'HG 11', 'Husnicioara', 'Mehedinți', 'TEST  DUBLURĂ', 'Str. Y nr. 3', 20, 'arabil', 'T23', 'CF 1011', 'privat'],
  ['12', 'HG 12', 'Prunișor', 'Mehedinți', 'Test Prunisor Unu', 'Com. Prunișor, Sat Gârnița', 15, 'arabil', 'T2', 'CF 2001', 'privat'],
  ['abc', 'HG 13', 'Husnicioara', 'Mehedinți', 'Test NrCrt Invalid', 'Str. Z', 5, 'arabil', 'T24', 'CF 1013', 'privat'],
  [13, 'HG 14', 'Husnicioara', 'Mehedinți', 'Test Numeric', 'Jud. Mehedinți, Oraș Strehaia, Str. W nr. 9', 7, 'arabil', 'T25', 'CF 1014', 'privat'],
]

describe('parseazaNrCrt / imparteAdresa / cheieSursa', () => {
  it('Nr.Crt.', () => {
    expect(parseazaNrCrt('7/2')).toEqual({ x: 7, y: 2 })
    expect(parseazaNrCrt(' 7 / 1 ')).toEqual({ x: 7, y: 1 })
    expect(parseazaNrCrt('12')).toEqual({ x: 12, y: null })
    expect(parseazaNrCrt(12)).toEqual({ x: 12, y: null })
    expect(parseazaNrCrt('abc')).toBeNull()
    expect(parseazaNrCrt('0')).toBeNull()
    expect(parseazaNrCrt('')).toBeNull()
    expect(parseazaNrCrt(null)).toBeNull()
  })
  it('adresa best-effort, fără să inventeze', () => {
    expect(imparteAdresa('Sat Peri, Com. Husnicioara, Str. Fictivă nr. 1', 'Mehedinți')).toEqual({
      adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Peri', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinți',
    })
    expect(imparteAdresa('Str. Exemplu nr. 2', 'Mehedinți')).toEqual({ adresa_strada: 'Str. Exemplu nr. 2', adresa_sat: null, adresa_comuna: null, adresa_judet: 'Mehedinți' })
    expect(imparteAdresa('ceva ce nu se poate împărți', null)).toEqual({ adresa_strada: 'ceva ce nu se poate împărți', adresa_sat: null, adresa_comuna: null, adresa_judet: null })
    expect(imparteAdresa('Jud. Dolj, Mun. Craiova, bd. Test 5', '')).toEqual({ adresa_strada: 'bd. Test 5', adresa_sat: null, adresa_comuna: 'Craiova', adresa_judet: 'Dolj' })
    expect(imparteAdresa('', 'Mehedinți')).toEqual({ adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: 'Mehedinți' })
    // „Satu Mare” nu e „Sat …”
    expect(imparteAdresa('Satu Mare', null).adresa_strada).toBe('Satu Mare')
  })
  it('cheieSursa: normalizată, null când lipsesc toate trei', () => {
    expect(cheieSursa('HUS', 'HG 1', 'CF 1001', 'T12')).toBe('HUS|HG 1|CF 1001|T12')
    expect(cheieSursa('hus', ' hg  1 ', 'cf 1001', 'Tărla 12')).toBe('HUS|HG 1|CF 1001|TARLA 12')
    expect(cheieSursa('HUS', null, 'CF 1001', null)).toBe('HUS||CF 1001|')
    expect(cheieSursa('HUS', '', null, '  ')).toBeNull()
  })
})

describe('parseazaTgz — preview', () => {
  const p = parseazaTgz(xlsxDin(RANDURI), OPT)

  it('găsește antetul pe rândul 3 și mapează coloanele', () => {
    expect(p.antet.rand).toBe(3)
    expect(Object.keys(p.antet.coloane).sort()).toEqual(['adresa', 'categorie', 'judet', 'nr_cadastral', 'nr_crt', 'nume', 'poz_hg', 'regim', 'suprafata', 'tarla', 'uat'].sort())
  })
  it('numără rândurile și erorile (UAT necunoscut, Nr.Crt. invalid)', () => {
    expect(p.statistici.randuri_total).toBe(12)
    expect(p.erori).toHaveLength(2)
    expect(p.erori.find(e => e.rand === 10)).toMatchObject({ motiv: expect.stringMatching(/UAT necunoscut/) })
    expect(p.erori.find(e => e.rand === 14)).toMatchObject({ motiv: expect.stringMatching(/Nr\.Crt\. invalid/) })
  })
  it('parcele: 7 pe HUS (1,2,7,8,9,11,13) + 1 pe PRU, id-uri PROVIZORII, cheie_sursa stabilă', () => {
    expect(p.parcele).toHaveLength(8)
    expect(p.parcele.filter(x => x.uat3 === 'HUS').map(x => x.id_parcela)).toEqual(Array(7).fill('T3-HUS-????'))
    expect(p.parcele.filter(x => x.uat3 === 'HUS').map(x => x.nr_provizoriu)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(p.parcele.find(x => x.uat3 === 'PRU')).toMatchObject({ id_parcela: 'T2-PRU-????', nr_provizoriu: 1, tronson: 2, uat_id: 'uuid-pru', cheie_sursa: 'PRU|HG 12|CF 2001|T2' })
    expect(p.parcele[0]).toMatchObject({ nr_crt: 1, cheie: 'HUS|HG 1|CF 1001|T12', cheie_sursa: 'HUS|HG 1|CF 1001|T12', uat_id: 'uuid-hus', tronson: 3, poz_hg: 'HG 1', suprafata_temporara_mp: 120.5, categoria_folosinta: 'arabil', tarla: 'T12', nr_cadastral: 'CF 1001', observatii: 'Regim juridic: privat' })
    expect(p.statistici.parcele_fara_cheie).toBe(0)
  })
  it('idStart e ignorat (compatibilitate)', () => {
    const p2 = parseazaTgz(xlsxDin(RANDURI), { ...OPT, idStart: { HUS: 500 } })
    expect(p2.parcele[0].id_parcela).toBe('T3-HUS-????')
  })
  it('coproprietarii 7/1 și 7/2 stau pe aceeași parcelă, cu calitate coproprietar', () => {
    const p7 = p.parcele.find(x => x.nr_crt === 7)
    const dets = p.detinatori.filter(d => d.cheie_parcela === p7.cheie)
    expect(dets).toHaveLength(2)
    expect(dets.map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar'])
    expect(p7.nr_detinatori).toBe(2)
  })
  it('proprietar simplu, cu sursa și versiunea', () => {
    expect(p.detinatori[0]).toMatchObject({ nume: 'Test Proprietar Unu', nume_normalizat: 'TEST PROPRIETAR UNU', calitate: 'proprietar', cota: null, sursa_date: 'TGZ', versiune_lista_tgz: 'TGZ 13.07.2026', cheie_parcela: 'HUS|HG 1|CF 1001|T12' })
  })
  it('neidentificat → calitate neidentificat + adresa_cunoscuta=false', () => {
    const d = p.detinatori.find(x => x.nume.includes('NEIDENTIFICAT'))
    expect(d.calitate).toBe('neidentificat')
    expect(p.contacte.find(c => c.cheie_detinator === d.cheie).adresa_cunoscuta).toBe(false)
    expect(p.neidentificati).toHaveLength(1)
    expect(p.neidentificati[0]).toMatchObject({ rand: 8, cheie_parcela: d.cheie_parcela, nr_crt: 8 })
  })
  it('adresă goală → adresa_cunoscuta=false, dar calitatea rămâne proprietar', () => {
    const d = p.detinatori.find(x => x.nume === 'Test Fără Adresă')
    expect(d.calitate).toBe('proprietar')
    expect(p.contacte.find(c => c.cheie_detinator === d.cheie)).toMatchObject({ adresa_cunoscuta: false, adresa_strada: null, adresa_judet: 'Mehedinți' })
  })
  it('dublura (aceeași parcelă + nume normalizat) nu intră în deținători, e raportată', () => {
    expect(p.dubluri).toHaveLength(1)
    expect(p.dubluri[0]).toMatchObject({ rand: 12, rand_original: 11, nume_normalizat: 'TEST DUBLURA', nr_crt: 11 })
    expect(p.detinatori.filter(d => d.nume_normalizat === 'TEST DUBLURA')).toHaveLength(1)
  })
  it('adresa se împarte în strada/sat/comuna/judet', () => {
    const d1 = p.detinatori[0]
    expect(p.contacte.find(c => c.cheie_detinator === d1.cheie)).toMatchObject({ adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Peri', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinți', adresa_cunoscuta: true, cod_postal: null })
    const d13 = p.detinatori.find(x => x.nume === 'Test Numeric')
    expect(p.contacte.find(c => c.cheie_detinator === d13.cheie)).toMatchObject({ adresa_strada: 'Str. W nr. 9', adresa_comuna: 'Strehaia', adresa_judet: 'Mehedinți' })
  })
  it('statistici și un contact per deținător', () => {
    expect(p.contacte).toHaveLength(p.detinatori.length)
    expect(p.statistici).toMatchObject({ parcele: 8, detinatori: 9, contacte: 9, dubluri: 1, neidentificati: 1, erori: 2, unite: 0 })
    expect(p.statistici.pe_uat.HUS).toMatchObject({ parcele: 7, detinatori: 8, dubluri: 1, neidentificati: 1 })
    expect(p.statistici.pe_uat.PRU).toMatchObject({ parcele: 1, detinatori: 1 })
  })
})

describe('parseazaTgz — robustețe', () => {
  it('antet tolerant la diacritice/spații/majuscule și pe alt rând', () => {
    const antet = ['NR. CRT', 'nr poz hg', ' uat ', 'JUDET', 'nume detinator', 'adresa', 'suprafata afectata temporar (mp)', 'categorie folosinta', 'tarla / nr topo', 'nr cadastral / parcela', 'regim juridic']
    const p = parseazaTgz(xlsxDin([['1', 'HG', 'HUS', 'MH', 'Test Antet', 'Str. A', 1, 'arabil', 'T', 'CF', 'privat']], { antet, randAntet: 5 }), OPT)
    expect(p.erori).toEqual([])
    expect(p.antet.rand).toBe(5)
    expect(p.parcele).toHaveLength(1)
    expect(p.detinatori[0]).toMatchObject({ nume: 'Test Antet', id_parcela: 'T3-HUS-????' })
  })
  it('același teren sub alt Nr.Crt. (aceeași cheie_sursa) se unește într-o parcelă și se raportează', () => {
    const p = parseazaTgz(xlsxDin([
      ['1', 'HG 1', 'HUS', 'MH', 'Test A', 'Str. A', 1, 'arabil', 'T1', 'CF 1', ''],
      ['2', 'HG 1', 'HUS', 'MH', 'Test B', 'Str. B', 1, 'arabil', 'T1', 'CF 1', ''],
    ]), OPT)
    expect(p.parcele).toHaveLength(1)
    expect(p.detinatori.map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar'])
    expect(p.unite).toEqual([{ rand: 5, nr_crt: 2, cu_nr_crt: 1, cheie_sursa: 'HUS|HG 1|CF 1|T1' }])
    expect(p.statistici.unite).toBe(1)
  })
  it('fără poz_hg/cadastral/tarla → cheie_sursa null, cheia internă cade pe Nr.Crt.', () => {
    const p = parseazaTgz(xlsxDin([['5', '', 'HUS', 'MH', 'Test Fără Cheie', 'Str. A', 1, '', '', '', '']]), OPT)
    expect(p.parcele[0]).toMatchObject({ cheie_sursa: null, cheie: 'HUS:5' })
    expect(p.statistici.parcele_fara_cheie).toBe(1)
  })
  it('UAT dat prin uat3 în fișier se recunoaște; tronson lipsă → eroare pe rând', () => {
    const p = parseazaTgz(xlsxDin([['1', '', 'PRU', 'MH', 'Test Fără Tronson', 'Str. A', 1, '', '', '', '']]), { ...OPT, tronsonPeUat: { HUS: 3 } })
    expect(p.parcele).toHaveLength(0)
    expect(p.erori[0].motiv).toMatch(/Tronson/)
  })
  it('fără antet → eroare, fără excepție', () => {
    const p = parseazaTgz(xlsxDin([['1', 'x']], { antet: ['A', 'B'] }), OPT)
    expect(p.parcele).toEqual([])
    expect(p.erori[0].motiv).toMatch(/antet/)
  })
  it('fișier care nu e Excel → eroare, fără excepție', () => {
    const p = parseazaTgz(new Uint8Array([1, 2, 3, 4]).buffer, OPT)
    expect(p.erori).toHaveLength(1)
    expect(p.statistici.erori).toBe(1)
  })
  it('rândurile goale dintre date se sar', () => {
    const p = parseazaTgz(xlsxDin([['1', '', 'HUS', 'MH', 'Test A', 'Str. A', 1, '', '', '', ''], [], ['2', '', 'HUS', 'MH', 'Test B', 'Str. B', 1, '', '', '', '']]), OPT)
    expect(p.parcele).toHaveLength(2)
    expect(p.statistici.randuri_goale).toBe(1)
  })
  it('performanță: 2.800 de rânduri fictive parsate sub 2 s', () => {
    const randuri = []
    for (let i = 1; i <= 2800; i++) {
      const x = i % 10 === 1 && i > 1 ? i - 1 : i          // rândul x/2 urmează rândului x/1
      const uat = x % 2 ? 'Husnicioara' : 'Prunișor'
      const nrCrt = i % 10 === 0 ? `${i}/1` : (x !== i ? `${x}/2` : String(i))
      randuri.push([nrCrt, `HG ${x}`, uat, 'Mehedinți', `Test Persoană ${i}`, i % 7 === 0 ? '' : `Sat Fictiv ${i % 30}, Com. ${uat}, Str. Test nr. ${i}`, i * 1.5, 'arabil', `T${x % 40}`, `CF ${1000 + x}`, 'privat'])
    }
    const buf = xlsxDin(randuri)
    const t0 = performance.now()
    const p = parseazaTgz(buf, OPT)
    const durata = performance.now() - t0
    expect(p.statistici.randuri_total).toBe(2800)
    expect(p.erori).toEqual([])
    expect(p.detinatori).toHaveLength(2800)
    expect(p.parcele.length).toBeLessThan(2800)  // coproprietarii x/1, x/2 împart parcela
    expect(p.unite).toEqual([])
    expect(durata).toBeLessThan(2000)
  })
})

// ───────── fake supabase: înregistrează apelurile, răspunde la select/update din datele inserate, rpc rezervă numere ─────────
function creeazaFakeSupabase({ esueazaLa = null } = {}) {
  const tabele = { red_parcele: [], red_detinatori: [], red_detinatori_contact: [], red_import_loturi: [] }
  const apeluri = []
  const numere = {}   // 'HUS|3' → ultimul rezervat
  let nr = 0
  const uuid = () => `uuid-${++nr}`
  const stare = { esueazaLa }

  class Query {
    constructor(tabel) { this.tabel = tabel; this.op = null; this.filtre = []; this.randuri = null; this.unRand = false }
    insert(randuri) { this.op = 'insert'; this.randuri = Array.isArray(randuri) ? randuri : [randuri]; apeluri.push({ op: 'insert', tabel: this.tabel, n: this.randuri.length }); return this }
    update(valori) { this.op = 'update'; this.valori = valori; apeluri.push({ op: 'update', tabel: this.tabel }); return this }
    select(col) { if (!this.op) { this.op = 'select'; apeluri.push({ op: 'select', tabel: this.tabel }) } this.col = col; return this }
    eq(c, v) { this.filtre.push(r => r[c] === v); return this }
    in(c, lista) { const s = new Set(lista); this.filtre.push(r => s.has(r[c])); return this }
    is(c, v) { this.filtre.push(r => (v === null ? r[c] == null : r[c] === v)); return this }
    single() { this.unRand = true; return this }
    _exec() {
      const t = tabele[this.tabel]
      if (!t) return { data: null, error: { message: `tabel necunoscut ${this.tabel}` } }
      if (this.op === 'insert') {
        if (stare.esueazaLa && stare.esueazaLa === this.tabel) return { data: null, error: { message: `eșec simulat la ${this.tabel}` } }
        const inserate = this.randuri.map(r => ({ id: uuid(), sters_la: null, ...r }))
        t.push(...inserate)
        if (this.col) return { data: this.unRand ? inserate[0] : inserate, error: null }
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        const tinta = t.filter(r => this.filtre.every(f => f(r)))
        for (const r of tinta) Object.assign(r, this.valori)
        return { data: this.col ? tinta : null, error: null }
      }
      const data = t.filter(r => this.filtre.every(f => f(r)))
      return { data: this.unRand ? data[0] ?? null : data, error: null }
    }
    then(ok, ko) { return Promise.resolve(this._exec()).then(ok, ko) }
  }
  const rpc = async (nume, args) => {
    apeluri.push({ op: 'rpc', nume, args })
    if (nume !== RPC_REZERVA_NUMERE) return { data: null, error: { message: `rpc necunoscut ${nume}` } }
    const k = `${args.p_uat3}|${args.p_tronson}`
    const start = (numere[k] ?? 0) + 1
    numere[k] = start + args.p_n - 1
    return { data: start, error: null }
  }
  return { from: tabel => new Query(tabel), rpc, tabele, apeluri, stare, numere }
}

function previewMare(n) {
  const parcele = []; const detinatori = []; const contacte = []
  for (let i = 1; i <= n; i++) {
    const cheie = `HUS|HG ${i}|CF ${1000 + i}|T${i % 40}`
    parcele.push({ cheie, cheie_sursa: cheie, nr_crt: i, uat_id: 'uuid-hus', uat3: 'HUS', id_parcela: 'T3-HUS-????', nr_provizoriu: i, tronson: 3, poz_hg: `HG ${i}`, suprafata_temporara_mp: i, categoria_folosinta: 'arabil', tarla: `T${i % 40}`, nr_cadastral: `CF ${1000 + i}`, observatii: null, nr_detinatori: 1 })
    const cheieDet = `${cheie}|TEST PERSOANA ${i}`
    detinatori.push({ cheie: cheieDet, cheie_parcela: cheie, id_parcela: 'T3-HUS-????', nume: `Test Persoana ${i}`, nume_normalizat: `TEST PERSOANA ${i}`, calitate: 'proprietar', cota: null, sursa_date: 'TGZ', versiune_lista_tgz: 'v1' })
    contacte.push({ cheie_detinator: cheieDet, adresa_strada: `Str. ${i}`, adresa_sat: null, adresa_comuna: null, adresa_judet: 'Mehedinți', cod_postal: null, adresa_cunoscuta: true })
  }
  return { parcele, detinatori, contacte, dubluri: [], neidentificati: [], unite: [], erori: [], statistici: { randuri_total: n } }
}

const secventa = sb => sb.apeluri.map(a => (a.op === 'rpc' ? `rpc:${a.nume}` : `${a.op}:${a.tabel}`))

describe('scrieImport — fake supabase', () => {
  it('scrie preview-ul real: lot in_curs → parcele (numere rezervate prin RPC) → detinatori → contact → lot finalizat', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase()
    const progres = []
    const r = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'TGZ 13.07.2026', sursa: 'TGZ', fisierNume: 'fictiv.xlsx', onProgress: e => progres.push(e) })

    expect(r).toMatchObject({ parceleNoi: 8, parceleRefolosite: 0, detinatoriNoi: 9, detinatoriExistenti: 0, contacteNoi: 9, existente: [] })
    expect(r.lotId).toMatch(/^uuid-/)
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
    expect(sb.tabele.red_import_loturi).toHaveLength(1)

    // id-urile finale vin din RPC: HUS 1..7, PRU 1
    expect(sb.tabele.red_parcele.filter(p => p.uat_id === 'uuid-hus').map(p => p.id_parcela)).toEqual(['T3-HUS-0001', 'T3-HUS-0002', 'T3-HUS-0003', 'T3-HUS-0004', 'T3-HUS-0005', 'T3-HUS-0006', 'T3-HUS-0007'])
    expect(sb.tabele.red_parcele.find(p => p.uat_id === 'uuid-pru').id_parcela).toBe('T2-PRU-0001')
    expect(sb.apeluri.filter(a => a.op === 'rpc').map(a => a.args)).toEqual([{ p_uat3: 'HUS', p_tronson: 3, p_n: 7 }, { p_uat3: 'PRU', p_tronson: 2, p_n: 1 }])
    expect(sb.tabele.red_parcele[0]).toMatchObject({ proiect_id: 'proiect-1', uat_id: 'uuid-hus', tronson: 3, id_parcela: 'T3-HUS-0001', cheie_sursa: 'HUS|HG 1|CF 1001|T12' })
    expect(sb.tabele.red_parcele.every(p => !p.id_parcela.includes('?'))).toBe(true)

    // legături: coproprietarii pointează la uuid-ul parcelei T3-HUS-0003; contactul la uuid-ul deținătorului
    const p7 = sb.tabele.red_parcele.find(p => p.id_parcela === 'T3-HUS-0003')
    const cop = sb.tabele.red_detinatori.filter(d => d.parcela_id === p7.id)
    expect(cop.map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar'])
    const dNeid = sb.tabele.red_detinatori.find(d => d.calitate === 'neidentificat')
    expect(sb.tabele.red_detinatori_contact.find(c => c.detinator_id === dNeid.id).adresa_cunoscuta).toBe(false)
    expect(sb.tabele.red_detinatori[0]).toMatchObject({ nume: 'Test Proprietar Unu', versiune_lista_tgz: 'TGZ 13.07.2026', sursa_date: 'TGZ' })

    // lotul: creat întâi 'in_curs', la final 'finalizat' cu cifre
    const lot = sb.tabele.red_import_loturi[0]
    expect(lot).toMatchObject({ id: r.lotId, proiect_id: 'proiect-1', versiune_lista_tgz: 'TGZ 13.07.2026', sursa: 'TGZ', fisier_nume: 'fictiv.xlsx', randuri_total: 12, stare: 'finalizat', eroare: null, parcele_noi: 8, detinatori_noi: 9, dubluri: 1, neidentificati: 1 })
    expect(lot.diferente).toMatchObject({ existente: [], parcele_refolosite: 0, detinatori_existenti: 0, contacte_noi: 9, fara_cheie: 0 })
    expect(lot.diferente.erori).toHaveLength(2)

    expect(secventa(sb)).toEqual([
      'insert:red_import_loturi',
      'select:red_parcele',            // existente pe cheie_sursa
      `rpc:${RPC_REZERVA_NUMERE}`, `rpc:${RPC_REZERVA_NUMERE}`,
      'insert:red_parcele', 'select:red_parcele',
      'insert:red_detinatori', 'select:red_detinatori',
      'insert:red_detinatori_contact',
      'update:red_import_loturi',
    ])
    expect(progres.map(e => e.etapa)).toEqual(['parcele', 'detinatori', 'contacte', 'gata'])
  })

  it('loturi de 200: 450 de parcele → 3 loturi per tabel, în ordine, un singur RPC per (uat, tronson)', async () => {
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, previewMare(450), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 450, detinatoriNoi: 450, contacteNoi: 450 })
    const ins = tabel => sb.apeluri.filter(a => a.op === 'insert' && a.tabel === tabel).map(a => a.n)
    expect(ins('red_parcele')).toEqual([200, 200, 50])
    expect(ins('red_detinatori')).toEqual([200, 200, 50])
    expect(ins('red_detinatori_contact')).toEqual([200, 200, 50])
    expect(ins('red_import_loturi')).toEqual([1])
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toEqual([{ op: 'rpc', nume: RPC_REZERVA_NUMERE, args: { p_uat3: 'HUS', p_tronson: 3, p_n: 450 } }])
    expect(sb.tabele.red_parcele[449].id_parcela).toBe('T3-HUS-0450')
    expect(LOT).toBe(200)
    const idx = (op, tabel, ultimul = false) => { const l = sb.apeluri.map((a, i) => (a.op === op && a.tabel === tabel ? i : -1)).filter(i => i >= 0); return ultimul ? l[l.length - 1] : l[0] }
    expect(idx('insert', 'red_import_loturi')).toBe(0)
    expect(idx('insert', 'red_parcele', true)).toBeLessThan(idx('insert', 'red_detinatori'))
    expect(idx('insert', 'red_detinatori', true)).toBeLessThan(idx('insert', 'red_detinatori_contact'))
    expect(idx('insert', 'red_detinatori_contact', true)).toBeLessThan(idx('update', 'red_import_loturi'))
    // verificarea existenței pe cheie_sursa: 450 chei → 3 selecturi; + 3 citiri de id după insert
    expect(sb.apeluri.filter(a => a.op === 'select' && a.tabel === 'red_parcele')).toHaveLength(3 + 3)
    const ids = new Set(sb.tabele.red_detinatori.map(d => d.id))
    expect(sb.tabele.red_detinatori_contact.every(c => ids.has(c.detinator_id))).toBe(true)
  })

  it('P1-1 reimportul aceluiași fișier NU duplică: parcelele existente (cheie_sursa) se refolosesc, numerotarea nu avansează', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase()
    await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 8, detinatoriNoi: 0, detinatoriExistenti: 9, contacteNoi: 0 })
    expect(r2.existente.sort()).toEqual(['T2-PRU-0001', 'T3-HUS-0001', 'T3-HUS-0002', 'T3-HUS-0003', 'T3-HUS-0004', 'T3-HUS-0005', 'T3-HUS-0006', 'T3-HUS-0007'])
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
    expect(sb.tabele.red_import_loturi).toHaveLength(2)
    expect(sb.tabele.red_import_loturi[1]).toMatchObject({ stare: 'finalizat', parcele_noi: 0, detinatori_noi: 0, versiune_lista_tgz: 'v2' })
    expect(sb.numere['HUS|3']).toBe(7)   // niciun număr rezervat în plus
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toHaveLength(2)
  })

  it('P1-1 parcelă existentă + deținător nou pe ea: parcela se refolosește, deținătorul și contactul se adaugă', async () => {
    const sb = creeazaFakeSupabase()
    await scrieImport(sb, parseazaTgz(xlsxDin(RANDURI.slice(0, 2)), OPT), { proiectId: 'proiect-1', versiune: 'v1' })
    const randuriV2 = [...RANDURI.slice(0, 2), ['1/2', 'HG 1', 'Husnicioara', 'Mehedinți', 'Test Mostenitor Nou', 'Str. Nouă 1', '120,5', 'arabil', 'T12', 'CF 1001', 'privat']]
    const r2 = await scrieImport(sb, parseazaTgz(xlsxDin(randuriV2), { ...OPT, versiune: 'v2' }), { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 2, detinatoriNoi: 1, detinatoriExistenti: 2, contacteNoi: 1 })
    const p1 = sb.tabele.red_parcele.find(p => p.id_parcela === 'T3-HUS-0001')
    expect(sb.tabele.red_parcele).toHaveLength(2)
    const dNou = sb.tabele.red_detinatori.find(d => d.nume === 'Test Mostenitor Nou')
    expect(dNou).toMatchObject({ parcela_id: p1.id, calitate: 'coproprietar', versiune_lista_tgz: 'v2' })
    expect(sb.tabele.red_detinatori_contact.find(c => c.detinator_id === dNou.id).adresa_strada).toBe('Str. Nouă 1')
  })

  it('P1-2 reluare după eroare la contacte: lotul 1 e „esuat” cu mesaj, lotul 2 completează doar ce lipsește → aceeași stare finală', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_detinatori_contact' })
    await expect(scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/inserare contacte: eșec simulat/)
    expect(sb.tabele.red_import_loturi).toHaveLength(1)
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', eroare: expect.stringMatching(/inserare contacte/) })
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(0)

    sb.stare.esueazaLa = null
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 8, detinatoriNoi: 0, detinatoriExistenti: 9, contacteNoi: 9 })
    expect(sb.tabele.red_import_loturi[1]).toMatchObject({ stare: 'finalizat', eroare: null })

    // aceeași stare finală ca un import reușit dintr-o bucată
    const ok = creeazaFakeSupabase()
    await scrieImport(ok, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    const fara = r => { const { id, detinator_id, parcela_id, ...rest } = r; return rest }
    expect(sb.tabele.red_parcele.map(fara)).toEqual(ok.tabele.red_parcele.map(fara))
    expect(sb.tabele.red_detinatori.map(fara)).toEqual(ok.tabele.red_detinatori.map(fara))
    expect(sb.tabele.red_detinatori_contact.map(fara)).toEqual(ok.tabele.red_detinatori_contact.map(fara))
    // legăturile sunt consistente
    const idsDet = new Set(sb.tabele.red_detinatori.map(d => d.id))
    expect(sb.tabele.red_detinatori_contact.every(c => idsDet.has(c.detinator_id))).toBe(true)
  })

  it('P1-2 reluare după eroare la deținători: parcelele deja scrise se refolosesc, deținătorii și contactele se completează', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_detinatori' })
    await expect(scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/inserare deținători/)
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(0)
    sb.stare.esueazaLa = null
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 8, detinatoriNoi: 9, contacteNoi: 9 })
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
  })

  it('eroarea de la BD oprește scrierea, marchează lotul „esuat” și poartă lotId', async () => {
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_parcele' })
    let eroare
    try { await scrieImport(sb, previewMare(3), { proiectId: 'proiect-1', versiune: 'v1' }) } catch (e) { eroare = e }
    expect(eroare.message).toMatch(/inserare parcele: eșec simulat/)
    expect(eroare.lotId).toBe(sb.tabele.red_import_loturi[0].id)
    expect(sb.tabele.red_import_loturi[0].stare).toBe('esuat')
    // numerele rezervate rămân consumate (fără refolosire, ca la red_numere)
    expect(sb.numere['HUS|3']).toBe(3)
  })

  it('RPC-ul care întoarce un rând/obiect e acceptat; un început invalid → eroare clară', async () => {
    const sb = creeazaFakeSupabase()
    const rpcVechi = sb.rpc
    sb.rpc = async (n, a) => { const r = await rpcVechi(n, a); return { data: [{ start: r.data }], error: null } }
    const r = await scrieImport(sb, previewMare(2), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r.parceleNoi).toBe(2)
    expect(sb.tabele.red_parcele.map(p => p.id_parcela)).toEqual(['T3-HUS-0001', 'T3-HUS-0002'])

    const sb2 = creeazaFakeSupabase()
    sb2.rpc = async () => ({ data: null, error: null })
    await expect(scrieImport(sb2, previewMare(1), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/început invalid/)
    expect(sb2.tabele.red_import_loturi[0].stare).toBe('esuat')
  })

  it('fără proiectId → eroare înainte de orice scriere', async () => {
    const sb = creeazaFakeSupabase()
    await expect(scrieImport(sb, previewMare(1), {})).rejects.toThrow(/proiectId/)
    expect(sb.apeluri).toEqual([])
  })
})
