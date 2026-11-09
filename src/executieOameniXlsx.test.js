import { describe, it, expect, vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))   // employeesPersonal.js deschide clientul la import; aici nu e nevoie de el
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { EMPLOYEES_PUBLIC_COLUMNS } from './employeesPersonal.js'
import {
  COLOANE_ANGAJAT, FEREASTRA_ZILE, adunaZile, zzll, estePrezenta, santiereProiect, ultimaPrezenta, alcatuiesteOameni, grupeazaPeFoi,
  sinteza, numeFoi, stilCelula, CULORI, completeazaFoaieXml, construiesteXlsx, numeFisier, incarcaOameniProiect, exportaOameniProiect,
} from './executieOameniXlsx.js'
const XLSX = XLSX_mod.default || XLSX_mod

// ── date de test (fictive), scrise de mână; rezultatele așteptate sunt deduse din regulile cererii, nu din cod ──
const AZI = '2026-11-09'
const SITES = [
  { id: 1, name: 'Gazpet - Orsova Lot 1', proiect_id: 1 },
  { id: 2, name: 'Gazpet LOT 2 Orsova', proiect_id: 1 },
  { id: 3, name: 'Probe-Presiune', proiect_id: null },
  { id: 4, name: 'Alt proiect', proiect_id: 2 },
  { id: 5, name: 'Santier principal nelegat', proiect_id: null },
]
const PII = { cnp: '1111111111111', telefon: '0700000000', adresa: 'Str. X', iban: 'RO00XXXX' }   // coloane care NU au voie să iasă
const ang = (id, o) => ({ id, name: `TEST${id} PRENUME`, functie: null, position: null, department: 'Executie', departament_hr: null, site_id: null, active: true, ...PII, ...o })
const EMPLOYEES = [
  ang(1, { site_id: 1, functie: 'SUDOR' }),                 // alocat L1, pontat L1 → L1, fără galben
  ang(2, { site_id: 1, position: 'Muncitor' }),             // alocat L1, pontat ultima dată pe Probe → L1, galben
  ang(3, { site_id: 4, functie: 'SUDOR' }),                 // alocat la alt proiect, ultima prezență pe L2 → L2, galben
  ang(4, { site_id: 4, functie: 'SUDOR' }),                 // a fost pe L1, dar ultima prezență e pe alt proiect → afară
  ang(5, { site_id: 1, functie: 'SUDOR', active: false }),  // inactiv → afară
  ang(6, { site_id: 1, functie: 'INGINER' }),               // alocat L1, fără pontaj în fereastră → L1, câmpuri goale
  ang(7, { site_id: null, functie: 'SOFER' }),              // ultima zi e CO pe L2, ultima PREZENȚĂ e pe Probe → afară
  ang(8, { site_id: 5, functie: 'SOFER' }),                 // alocat pe șantierul principal nelegat → foaia lui
]
let pid = 1
const pz = (employee_id, date, site_id, o = {}) => ({ id: pid++, employee_id, date, site_id, check_in: `${date}T07:00:00+02:00`, norma: null, ...o })
const PONTAJ = [
  pz(1, '2026-11-06', 1), pz(1, '2026-11-02', 2),
  pz(2, '2026-11-03', 1), pz(2, '2026-11-07', 3),
  pz(3, '2026-11-01', 4), pz(3, '2026-11-08', 2),
  pz(4, '2026-11-02', 1), pz(4, '2026-11-05', 4), pz(4, '2026-08-01', 1),
  pz(6, '2026-08-20', 1),                                    // în afara ferestrei de 60 de zile
  pz(7, '2026-11-04', 3), pz(7, '2026-11-06', 2, { check_in: null, norma: 'CO' }), pz(7, '2026-11-07', 2, { norma: 'CO' }),
  pz(1, '2026-11-12', 4),                                    // viitor (pontaj planificat) → ignorat
  pz(8, '2026-11-06', 5),
]
const PROIECTE = [{ id: 1, cod_intern: 'LOT1', site_id: 5 }, { id: 9, cod_intern: 'GOL', site_id: null }]

// client Supabase fals: filtre în memorie, maxRows = plafonul serverului (mai mic decât limit → forțează paginarea pe chei)
function fakeSb(tabele, { maxRows = 2, eroare = null } = {}) {
  const jurnal = []
  const from = (t) => {
    const q = { t, cols: '*', ops: [], f: [], ord: null, lim: null, single: false }
    const exec = () => {
      jurnal.push(q)
      const e = eroare && eroare(q, jurnal.filter(x => x.t === t).length - 1)
      if (e) return { data: null, error: { message: e } }
      let rows = (tabele[t] || []).filter(r => q.f.every(f => f(r)))
      if (q.ord) rows = [...rows].sort((a, b) => (a[q.ord[0]] > b[q.ord[0]] ? 1 : -1) * (q.ord[1] ? 1 : -1))
      rows = rows.slice(0, Math.min(q.lim ?? Infinity, maxRows))
      const cols = q.cols === '*' ? null : q.cols.split(',').map(s => s.trim())
      rows = rows.map(r => (cols ? Object.fromEntries(cols.map(c => [c, r[c]])) : { ...r }))
      return q.single ? { data: rows[0] || null, error: null } : { data: rows, error: null }
    }
    const api = {
      select(c) { q.cols = c; q.ops.push(['select', c]); return api },
      eq(c, v) { q.ops.push(['eq', c, v]); q.f.push(r => r[c] === v); return api },
      in(c, vs) { q.ops.push(['in', c, vs]); const s = new Set(vs.map(String)); q.f.push(r => r[c] != null && s.has(String(r[c]))); return api },
      gt(c, v) { q.ops.push(['gt', c, v]); q.f.push(r => r[c] > v); return api },
      gte(c, v) { q.ops.push(['gte', c, v]); q.f.push(r => r[c] >= v); return api },
      lte(c, v) { q.ops.push(['lte', c, v]); q.f.push(r => r[c] <= v); return api },
      not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('operator neașteptat'); q.ops.push(['not', c, op, v]); q.f.push(r => r[c] != null); return api },
      order(c, o) { q.ops.push(['order', c, o]); q.ord = [c, o?.ascending !== false]; return api },
      limit(n) { q.ops.push(['limit', n]); q.lim = n; return api },
      maybeSingle() { q.single = true; return api },
      then(res, rej) { return Promise.resolve().then(exec).then(res, rej) },
    }
    return api
  }
  return { from, jurnal }
}
const TABELE = { executie_proiecte: PROIECTE, sites: SITES, employees: EMPLOYEES, pontaj_records: PONTAJ }

describe('Oameni pe șantier — reguli', () => {
  it('doar coloane publice din employees, fără date personale', () => {
    const publice = new Set(EMPLOYEES_PUBLIC_COLUMNS.split(','))
    for (const c of COLOANE_ANGAJAT.split(',')) expect(publice.has(c), c).toBe(true)
    for (const c of ['cnp', 'telefon', 'phone', 'adresa', 'address', 'iban', 'email', 'data_nasterii', 'serie_ci', 'nr_ci'])
      expect(COLOANE_ANGAJAT.split(',')).not.toContain(c)
  })
  it('date calendaristice fără fus orar (L17)', () => {
    expect(adunaZile('2026-03-28', 1)).toBe('2026-03-29')
    expect(adunaZile('2026-03-28', 2)).toBe('2026-03-30')   // trecerea la ora de vară
    expect(adunaZile('2026-12-31', 1)).toBe('2027-01-01')
    expect(adunaZile('2026-03-01', -1)).toBe('2026-02-28')
    expect(adunaZile(AZI, -FEREASTRA_ZILE)).toBe('2026-09-10')
    expect(() => adunaZile('09.11.2026', 1)).toThrow()
    expect(zzll('2026-11-10')).toBe('10.11')
    expect(zzll(null)).toBe('')
  })
  it('prezență = oră de intrare, fără cod de absență, cu șantier', () => {
    expect(estePrezenta({ check_in: 'x', norma: null, site_id: 1 })).toBe(true)
    expect(estePrezenta({ check_in: 'x', norma: 'CO', site_id: 1 })).toBe(false)
    expect(estePrezenta({ check_in: null, norma: null, site_id: 1 })).toBe(false)
    expect(estePrezenta({ check_in: 'x', norma: null, site_id: null })).toBe(false)
  })
  it('șantierele proiectului: sites.proiect_id + șantierul principal doar dacă nu e al altui proiect', () => {
    expect([...santiereProiect(1, 5, SITES)].sort()).toEqual(['1', '2', '5'])
    expect([...santiereProiect(1, 4, SITES)].sort()).toEqual(['1', '2'])     // principalul e al proiectului 2
    expect([...santiereProiect(1, null, SITES)].sort()).toEqual(['1', '2'])
    expect(santiereProiect(3, null, SITES).size).toBe(0)
  })
  it('ultima prezență ignoră absențele', () => {
    const u = ultimaPrezenta(PONTAJ.filter(r => r.date <= AZI))
    expect(u.get('7').site_id).toBe(3)
    expect(u.get('7').date).toBe('2026-11-04')
    expect(u.get('2').site_id).toBe(3)
  })
  it('cine intră, pe ce foaie, cu ce galben', () => {
    const ultime = ultimaPrezenta(PONTAJ.filter(r => r.date >= '2026-09-10' && r.date <= AZI))
    const numeSantier = new Map(SITES.map(s => [String(s.id), s.name]))
    const r = alcatuiesteOameni({ santiere: new Set(['1', '2', '5']), numeSantier, angajati: [...EMPLOYEES, EMPLOYEES[0]], ultime })
    const pe = Object.fromEntries(r.map(x => [x.id, x]))
    expect(Object.keys(pe).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 6, 8])
    expect(pe[1]).toMatchObject({ foaie: '1', alt: false, pontatPe: 'Gazpet - Orsova Lot 1', data: '2026-11-06', functie: 'SUDOR' })
    expect(pe[2]).toMatchObject({ foaie: '1', alt: true, pontatPe: 'Probe-Presiune', functie: 'Muncitor' })
    expect(pe[3]).toMatchObject({ foaie: '2', alt: true, santierAlocat: 'Alt proiect', pontatPe: 'Gazpet LOT 2 Orsova' })
    expect(pe[6]).toMatchObject({ foaie: '1', alt: false, pontatPe: '', data: null })
    expect(pe[8]).toMatchObject({ foaie: '5', alt: false })
  })
  it('foi în ordinea numelui, rânduri după funcție apoi nume; sinteza descrescătoare cu totaluri', () => {
    const ultime = ultimaPrezenta(PONTAJ.filter(r => r.date >= '2026-09-10' && r.date <= AZI))
    const numeSantier = new Map(SITES.map(s => [String(s.id), s.name]))
    const foi = grupeazaPeFoi(alcatuiesteOameni({ santiere: new Set(['1', '2', '5']), numeSantier, angajati: EMPLOYEES, ultime }), numeSantier)
    expect(foi.map(f => f.santier)).toEqual(['Gazpet - Orsova Lot 1', 'Gazpet LOT 2 Orsova', 'Santier principal nelegat'])
    expect(foi[0].randuri.map(r => r.id)).toEqual([6, 2, 1])   // INGINER, Muncitor, SUDOR
    const s = sinteza(foi)
    expect(s.linii).toEqual([
      { functie: 'SUDOR', nr: [1, 1, 0], total: 2 },
      { functie: 'INGINER', nr: [1, 0, 0], total: 1 },
      { functie: 'MUNCITOR', nr: [1, 0, 0], total: 1 },
      { functie: 'SOFER', nr: [0, 0, 1], total: 1 },
    ])
    expect(s.total).toEqual([3, 1, 1])
    expect(s.totalGeneral).toBe(5)
  })
  it('numele foilor: caractere interzise, max. 31, unice, diferite de Sinteza', () => {
    const n = numeFoi([{ santier: 'A/B: C*?' }, { santier: 'Sinteza' }, { santier: 'x'.repeat(40) }, { santier: 'x'.repeat(40) }, { santier: '  ' }, { santier: 'a/b: c' }])
    expect(n[0]).toBe('A B C')
    expect(n[1]).toBe('Sinteza (2)')
    expect(n[2]).toBe('x'.repeat(31))
    expect(n[3]).toBe('x'.repeat(27) + ' (2)')
    expect(n[4]).toBe('Santier')
    expect(n[5]).toBe('a b c (2)')            // Excel nu face diferența între litere mari și mici
    for (const x of n) expect(x.length).toBeLessThanOrEqual(31)
  })
  it('stilurile: de completat în albastru deschis, galben doar pe „Pontat ultima dată pe” la șantier diferit', () => {
    expect(stilCelula(7, {}).fill.fgColor.rgb).toBe(CULORI.deCompletat)
    expect(stilCelula(8, {}).fill.fgColor.rgb).toBe(CULORI.deCompletat)
    expect(stilCelula(9, {}).fill).toBeUndefined()
    expect(stilCelula(5, { alt: true }).fill.fgColor.rgb).toBe('FFF2CC')
    expect(stilCelula(5, { alt: false }).fill).toBeUndefined()
    expect(stilCelula(4, { alt: true }).fill).toBeUndefined()
  })
  it('XML-ul foii: refuză structura neașteptată; completează sheetPr existent', () => {
    expect(() => completeazaFoaieXml('<worksheet><sheetData/></worksheet>', { xSplit: 0, ySplit: 1 })).toThrow()
    const x = completeazaFoaieXml('<worksheet><sheetPr filterMode="1"/><dimension ref="A1"/><sheetData/><pageMargins left="1"/></worksheet>', { xSplit: 2, ySplit: 1 })
    expect(x).toContain('<sheetPr filterMode="1"><pageSetUpPr fitToPage="1"/></sheetPr>')
    expect(x).toContain('<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>')
    expect(x.indexOf('<pageSetup ')).toBeGreaterThan(x.indexOf('<pageMargins'))
  })
  it('numele fișierului', () => {
    expect(numeFisier('LOT1', AZI)).toBe('Oameni_santier_LOT1_09.11.2026.xlsx')
    expect(numeFisier('A/B C', AZI)).toBe('Oameni_santier_A_B_C_09.11.2026.xlsx')
  })
})

// stilul (fill) unei celule din fișierul generat, citit din XML (sheetN.xml → s= → cellXfs → fills)
async function fillCelula(zip, foaie, ref) {
  const sx = await zip.file(`xl/worksheets/${foaie}`).async('string')
  const m = new RegExp(`<c r="${ref}"[^>]*?s="(\\d+)"`).exec(sx)
  if (!m) return null
  const st = await zip.file('xl/styles.xml').async('string')
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st)[1].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)
  const fillId = Number(/fillId="(\d+)"/.exec(xfs[Number(m[1])])[1])
  const fills = /<fills[^>]*>([\s\S]*?)<\/fills>/.exec(st)[1].match(/<fill>[\s\S]*?<\/fill>/g)
  const rgb = /fgColor rgb="([0-9A-F]+)"/i.exec(fills[fillId])
  return rgb ? rgb[1].slice(-6).toUpperCase() : null
}

describe('Oameni pe șantier — fișierul xlsx', () => {
  it('foi, antete, rânduri, filtru, înghețare, landscape, galben', async () => {
    const sb = fakeSb(TABELE)
    const r = await exportaOameniProiect(sb, 1, AZI)
    expect(r).toMatchObject({ faraSantiere: false, nrOameni: 5, nrFoi: 3, numeFisier: 'Oameni_santier_LOT1_09.11.2026.xlsx' })
    const wb = XLSX.read(r.bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Sinteza', 'Gazpet - Orsova Lot 1', 'Gazpet LOT 2 Orsova', 'Santier principal nelegat'])
    const L1 = XLSX.utils.sheet_to_json(wb.Sheets['Gazpet - Orsova Lot 1'], { header: 1, defval: '' })
    expect(L1[0]).toEqual(['Nr', 'Nume', 'Funcție', 'Departament', 'Șantier alocat în ERP', 'Pontat ultima dată pe', 'Data',
      'Mâine 10.11 – front / echipă', 'Șef echipă', 'Observații'])
    expect(L1.slice(1)).toEqual([
      [1, 'TEST6 PRENUME', 'INGINER', 'Executie', 'Gazpet - Orsova Lot 1', '', '', '', '', ''],
      [2, 'TEST2 PRENUME', 'Muncitor', 'Executie', 'Gazpet - Orsova Lot 1', 'Probe-Presiune', '07.11', '', '', ''],
      [3, 'TEST1 PRENUME', 'SUDOR', 'Executie', 'Gazpet - Orsova Lot 1', 'Gazpet - Orsova Lot 1', '06.11', '', '', ''],
    ])
    const S = XLSX.utils.sheet_to_json(wb.Sheets.Sinteza, { header: 1, defval: '' })
    expect(S[0]).toEqual(['Funcție', 'Gazpet - Orsova Lot 1', 'Gazpet LOT 2 Orsova', 'Santier principal nelegat', 'Total'])
    expect(S[S.length - 1]).toEqual(['TOTAL', 3, 1, 1, 5])
    // nicio coloană personală nu ajunge în fișier
    const tot = JSON.stringify(wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 })))
    for (const v of Object.values(PII)) expect(tot).not.toContain(v)
    // XML: înghețare, filtru, pagina, ordinea elementelor
    const zip = await JSZip.loadAsync(r.bytes)
    const s2 = await zip.file('xl/worksheets/sheet2.xml').async('string')
    expect(s2).toContain('<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>')
    expect(s2).toMatch(/<autoFilter ref="A1:J4"\s*\/>/)
    expect(s2).toContain('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>')
    expect(s2).toContain('<pageSetUpPr fitToPage="1"/>')
    const ordine = ['<sheetPr', '<dimension', '<sheetViews', '<sheetData', '<autoFilter', '<pageMargins', '<pageSetup ']
    const poz = ordine.map(t => s2.indexOf(t))
    expect(poz.every(p => p >= 0)).toBe(true)
    expect([...poz].sort((a, b) => a - b)).toEqual(poz)
    const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string')
    expect(s1).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(s1).toContain('orientation="landscape"')
    // galben: F3 (TEST2, pontat pe alt șantier) da; F4 (TEST1) nu; H2 de completat
    expect(await fillCelula(zip, 'sheet2.xml', 'F3')).toBe('FFF2CC')
    expect(await fillCelula(zip, 'sheet2.xml', 'F4')).toBe(null)
    expect(await fillCelula(zip, 'sheet2.xml', 'H2')).toBe('E8F1FB')
  })
})

describe('Oameni pe șantier — citirea din BD', () => {
  it('pe chei până la pagina goală, chiar dacă serverul taie la 2 rânduri (L23); doar coloanele cerute', async () => {
    const sb = fakeSb(TABELE, { maxRows: 2 })
    const d = await incarcaOameniProiect(sb, 1, AZI)
    // de citit: 1, 2, 6 alocați pe L1; 8 pe principal; 3, 4 cu prezență pe L1 / L2. 7 are pe proiect doar CO → nu e candidat
    expect(d.angajati.map(e => e.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 6, 8])
    for (const e of d.angajati) for (const k of Object.keys(PII)) expect(e).not.toHaveProperty(k)
    const qEmp = sb.jurnal.filter(q => q.t === 'employees')
    expect(qEmp.length).toBeGreaterThan(2)                                        // mai multe pagini
    for (const q of qEmp) expect(q.cols).toBe(COLOANE_ANGAJAT)
    for (const q of sb.jurnal.filter(q => q.t === 'pontaj_records')) {
      expect(q.ops).toContainEqual(['lte', 'date', AZI])
      expect(q.ops).toContainEqual(['gte', 'date', '2026-09-10'])
      expect(q.ops).toContainEqual(['not', 'check_in', 'is', null])
    }
    // fiecare pagină de după prima continuă după ultimul id
    expect(sb.jurnal.some(q => q.ops.some(o => o[0] === 'gt' && o[1] === 'id'))).toBe(true)
  })
  it('o eroare la orice citire se aruncă, nu devine listă goală (L18)', async () => {
    await expect(incarcaOameniProiect(fakeSb(TABELE, { eroare: q => q.t === 'pontaj_records' && 'permission denied' }), 1, AZI))
      .rejects.toThrow(/pontajul pe șantierele proiectului: permission denied/)
    await expect(incarcaOameniProiect(fakeSb(TABELE, { eroare: (q, i) => q.t === 'employees' && i === 1 && 'timeout' }), 1, AZI))
      .rejects.toThrow(/angajații alocați: timeout/)
    await expect(incarcaOameniProiect(fakeSb(TABELE, { eroare: q => q.t === 'sites' && 'eroare retea' }), 1, AZI)).rejects.toThrow(/șantierele/)
    await expect(incarcaOameniProiect(fakeSb(TABELE), 77, AZI)).rejects.toThrow(/nu se poate citi/)
    await expect(incarcaOameniProiect(fakeSb(TABELE), 'x', AZI)).rejects.toThrow(/proiect invalid/)
  })
  it('fără șantiere / fără oameni: raportat distinct, fără fișier', async () => {
    const a = await exportaOameniProiect(fakeSb(TABELE), 9, AZI)
    expect(a).toMatchObject({ faraSantiere: true, nrOameni: 0 })
    expect(a.bytes).toBeUndefined()
    const b = await exportaOameniProiect(fakeSb({ ...TABELE, employees: [], pontaj_records: [] }), 1, AZI)
    expect(b).toMatchObject({ faraSantiere: false, nrOameni: 0 })
    expect(b.bytes).toBeUndefined()
  })
})
