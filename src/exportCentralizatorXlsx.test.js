// Export Transgaz (CENTRALIZATOR + IZOMETRIE + BULETINE). Date inventate (tronson T7).
import { describe, it, expect } from 'vitest'
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { generateCentralizatorXlsx, buildCentralizatorFilename } from './exportCentralizatorXlsx.js'
import { randuriPentruStare, planBuletineZip } from './lib/izoExportIzo.js'
import { starePeSudura } from './lib/izoNdt.js'
const XLSX = XLSX_mod.default || XLSX_mod

const pachet = { id: 9, proiect_id: 1, tronson_id: 5, km_start_m: 1000, cod_document_full: '99_GAZ_X_DWG_00001', revizie: 1 }
const tronson = { id: 5, cod: 'T7' }
const proiect = { nume: 'Proiect de probă' }
const el = (poz, tip_rand, o = {}) => ({ id: 100 + poz, poz_in_pachet: poz, tip_rand, lot: null, serie_unica: null, tip: null, dimensiune: null, sarja: null, lungime_m: null, sudura_cod: null, pm_cod: null, pa_ut_cod: null, ut_cod: null, observatii: null, ...o })
const tevi = [
  el(1, 'teava', { serie_unica: 'S-1', tip: 'L', dimensiune: 'DN300x8', sarja: 'SJ1', lungime_m: 12, sudura_cod: 'T7S1', lot: '2' }),
  el(2, 'teava', { serie_unica: 'S-2', tip: 'L', dimensiune: 'DN300x8', sarja: 'SJ2', lungime_m: 12, sudura_cod: 'T7S2', pm_cod: 'VECHI-PM' }),
  el(3, 'curba', { serie_unica: 'C-953', tip: 'CIC', dimensiune: 'DN300x8', unghi_curba: '10°', sarja: 'SJC', lungime_m: 1.2, sudura_cod: 'T7S3' }),
  el(4, 'legare', { sudura_cod: 'T7S4' }),
  el(5, 'separator'),
  el(6, 'teava', { serie_unica: 'S-6', tip: 'L', dimensiune: 'DN300x8', sarja: 'SJ6', lungime_m: 12 }),   // ultima țeavă, fără sudură
]
const SHA = 'b'.repeat(64)
const buletine = [
  { id: 11, versiune: 2, metoda: 'PA-UT', numar: '77', data_buletin: '2026-10-28', fisier_path: '1/5/a.pdf', fisier_sha256: SHA, stare: 'confirmat' },
  { id: 12, versiune: 2, metoda: 'PM', numar: '5', data_buletin: '2026-10-21', fisier_path: '1/5/b.pdf', fisier_sha256: SHA, stare: 'confirmat' },
]
const r = (id, b, nr) => ({ id, buletin_id: b, stare_cod: 'ok', tronson_nr: 7, nr, sufix: '', refacuta: false, rezultat: 'acceptat', data_inspectie: '2026-10-20' })
const stare = starePeSudura(randuriPentruStare(buletine, [r(1, 11, 1), r(2, 11, 3), r(3, 12, 1)]).randuri)
const plan = planBuletineZip({ stare, tevi, tronsonCtx: 'T7', buletine })

async function citeste(bytes) {
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true })
  const zip = await JSZip.loadAsync(bytes)
  const xml = {}
  for (const n of Object.keys(zip.files)) if (n.endsWith('.xml')) xml[n] = await zip.file(n).async('string')
  return { wb, xml }
}
const ndtComplet = { stare, tronsonCtx: 'T7', buletine: plan, incomplet: false, lipsuri: [] }

describe('generateCentralizatorXlsx — desenul IZOMETRIE cu curbe (audit G2)', () => {
  it('curba intră în desen ca bloc, în ordinea rândurilor, cu serie / tip / dimensiune cu unghi / șarjă / lungime', async () => {
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }))
    const iz = wb.Sheets.IZOMETRIE
    // blocul 3 (cols T / W): rândurile 21–25 = serie, tip, dim, șarjă, lungime; 17–18 = POZ KM, sudură
    expect([iz.T21?.v, iz.T22?.v, iz.T23?.v, iz.T24?.v, iz.T25?.v]).toEqual(['C-953', 'CIC', 'DN300x8 10°', 'SJC', 1.2])
    expect(iz.W18?.v).toBe('T7S3')
    // blocul 4 = țeava de după curbă (nu se mai decalează)
    expect(iz.Z21?.v).toBe('S-6')
    expect(iz.AC18?.v ?? '').toBe('')
  })
  it('tabela BR–BY urmează ordinea desenului; legarea rămâne la coadă; VLOOKUP-ul acoperă tot', async () => {
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }))
    const iz = wb.Sheets.IZOMETRIE, c = wb.Sheets.CENTRALIZATOR
    expect([17, 18, 19, 20, 21].map(n => iz[`BR${n}`]?.v)).toEqual([1, 2, 3, 5, 4])
    expect(iz.BR19.f).toBe('BR18+1')            // curba continuă cascada
    expect(iz.BR20.f).toBeUndefined()           // după legare: valoare directă
    expect(iz.BS19.f).toBe('T21')
    expect(iz.BU19.f).toBe('T23')
    expect(iz.BS21.v).toBe('')                  // legarea: fără element
    expect(iz.BY21.v).toBe('T7S4')
    expect(c.J14.f).toBe('VLOOKUP($A14,IZOMETRIE!$BR$17:$BY$21,8,FALSE)&""')
    // fiecare POZ din CENTRALIZATOR (1..5) există o singură dată în BR
    const poz = [17, 18, 19, 20, 21].map(n => iz[`BR${n}`].v).sort()
    expect(poz).toEqual([1, 2, 3, 4, 5])
  })
  it('fără „0” la sudura goală: nicio formulă din BR–BY spre o celulă goală; LOT valoare directă', async () => {
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }))
    const iz = wb.Sheets.IZOMETRIE, c = wb.Sheets.CENTRALIZATOR
    expect(iz.BY20.f).toBeUndefined()           // ultima țeavă fără sudură
    expect(iz.BY20.v).toBe('')
    for (let n = 17; n <= 21; n++) {
      for (const col of ['BS', 'BT', 'BU', 'BV', 'BW', 'BX', 'BY']) {
        const cel = iz[`${col}${n}`]
        if (cel?.f) expect(String(iz[cel.f]?.v ?? '').trim(), `${col}${n} → ${cel.f}`).not.toBe('')
      }
    }
    for (let n = 14; n <= 18; n++) expect(c[`B${n}`].f, `B${n}`).toBeUndefined()
    expect([14, 15, 16].map(n => c[`B${n}`].v)).toEqual(['2', '', ''])
    for (const col of ['C', 'D', 'E', 'F', 'I', 'J']) expect(c[`${col}18`].f.endsWith('&""')).toBe(true)
  })
  it('fără „_x000d_” / CR în niciun text (antetul BS)', async () => {
    const { wb, xml } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi, ndt: ndtComplet }))
    for (const [n, x] of Object.entries(xml)) {
      expect(x.includes('_x000d_') || x.includes('_x000D_'), n).toBe(false)
    }
    expect(wb.Sheets.IZOMETRIE.BS14.v).toBe('SERIE\nUNICĂ DE\nIDENTIFICARE')
  })
  it('codul documentului într-o singură formă (antet IZOMETRIE, coloana N, nume fișier)', async () => {
    const p2 = { ...pachet, cod_document_full: '43_GAZ_X_DWG_00040_rev_1', revizie: 1 }
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet: p2, tronson, proiect, tevi }))
    expect(wb.Sheets.CENTRALIZATOR.N14.v).toBe('43_GAZ_X_DWG_00040_rev_1')
    expect(wb.Sheets.IZOMETRIE.B8.v).toBe('SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE 43_GAZ_X_DWG_00040_rev_1')
    expect(buildCentralizatorFilename(p2)).toBe('43_GAZ_X_DWG_00040_rev_1_Centralizator.xlsx')
    expect(buildCentralizatorFilename(pachet)).toBe('99_GAZ_X_DWG_00001_rev1_Centralizator.xlsx')
    const { wb: w1 } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }))
    expect(w1.Sheets.CENTRALIZATOR.N14.v).toBe('99_GAZ_X_DWG_00001 rev.1')
  })
})

describe('generateCentralizatorXlsx — coloanele K–M și foaia BULETINE', () => {
  it('K–M din arhivă când există buletin valabil, altfel textul vechi din rând', async () => {
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi, ndt: ndtComplet }))
    const c = wb.Sheets.CENTRALIZATOR
    expect([c.K14.v, c.L14.v]).toEqual(['5/21.10.2026', '77/28.10.2026'])   // T7S1: PM + PA-UT din arhivă
    expect([c.K15.v, c.L15.v]).toEqual(['VECHI-PM', ''])                     // T7S2: fără buletin → textul din rând
    expect(c.L16.v).toBe('77/28.10.2026')                                     // curba T7S3
  })
  it('fără `ndt` (apelanți vechi): K–M = textul din rând, fără foaia BULETINE', async () => {
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }))
    expect(wb.SheetNames).toEqual(['CENTRALIZATOR', 'IZOMETRIE'])
    expect(wb.Sheets.CENTRALIZATOR.K14.v).toBe('')
    expect(wb.Sheets.CENTRALIZATOR.K15.v).toBe('VECHI-PM')
  })
  it('foaia BULETINE: metodă, număr, dată, suduri acoperite, fișierul din ZIP', async () => {
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi, ndt: ndtComplet }))
    expect(wb.SheetNames).toEqual(['CENTRALIZATOR', 'IZOMETRIE', 'BULETINE'])
    const b = XLSX.utils.sheet_to_json(wb.Sheets.BULETINE, { header: 1, defval: '' })
    expect(b[0][0]).toBe('BULETINE NDT — 99_GAZ_X_DWG_00001 rev.1')
    const cap = b.findIndex(x => x[0] === 'METODĂ')
    expect(b.slice(cap, cap + 3)).toEqual([
      ['METODĂ', 'NUMĂR', 'DATA', 'SUDURI ACOPERITE DIN PACHET', 'FIȘIER ÎN ARHIVĂ'],
      ['PM', '5', '21.10.2026', 1, 'buletine/PM_5_21.10.2026.pdf'],
      ['PA-UT', '77', '28.10.2026', 2, 'buletine/PA-UT_77_28.10.2026.pdf'],
    ])
    expect(b.flat().join(' ')).not.toMatch(/INCOMPLET|LIPSURI/)
  })
  it('export incomplet: mesajul INCOMPLET + lista lipsurilor cu POZ-ul din CENTRALIZATOR (separatorul nu se numără)', async () => {
    const lipsuri = [
      { cod: 'buletin_lipsa', rand: 2, mesaj: 'Sudura T7S2 n-are buletin PM acceptat (metodă obligatorie).' },
      { cod: 'buletin_lipsa', rand: 6, mesaj: 'altă lipsă' },
      { cod: 'x', rand: null, mesaj: 'fără rând' },
    ]
    const { wb } = await citeste(await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi, ndt: { ...ndtComplet, incomplet: true, lipsuri } }))
    const b = XLSX.utils.sheet_to_json(wb.Sheets.BULETINE, { header: 1, defval: '' })
    expect(b[1][0]).toMatch(/^EXPORT INCOMPLET/)
    const i = b.findIndex(x => x[0] === 'LIPSURI LA EXPORT')
    expect(b.slice(i + 1, i + 5).map(x => x.slice(0, 2))).toEqual([['POZ.', 'DESCRIERE'], [2, lipsuri[0].mesaj], [5, 'altă lipsă'], ['', 'fără rând']])
  })
})
