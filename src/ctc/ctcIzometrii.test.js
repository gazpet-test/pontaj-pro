import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { construiesteIzometrii, esteAprobat, descarcaIzometrie } from './ctcIzometrii.js'
import { clientFals, fixturaSeparat, CONTINUT, XLSX } from './ctcIzometriiFals.js'

const pachete = [
  { id: 5, proiect_id: 1, tronson_id: 7, cod_document_full: '30_GAZ_CTG1_DWG_00077', revizie: 0, status: 'draft' },
  { id: 6, proiect_id: 1, tronson_id: 7, cod_document_full: '30_GAZ_CTG1_DWG_00077', revizie: 1, status: 'aprobat', aprobat_la: '2026-06-01' },
  { id: 9, proiect_id: 1, tronson_id: 8, cod_document_full: '30_GAZ_CTG1_DWG_00106', revizie: 0, status: 'draft' },
]
const tronsoane = [{ id: 7, cod: 'T1', denumire: 'Orșova' }, { id: 8, cod: 'T2', denumire: null }]
const docs = [
  { id: 16, pachet_id: 5, tip_document: 'centralizator', fisier_nume: 'a_rev0.xlsx', uploadat_la: '2026-05-22' },
  { id: 17, pachet_id: 5, tip_document: 'centralizator', fisier_nume: 'b_rev0.xlsx', uploadat_la: '2026-05-28' },
  { id: 20, pachet_id: 6, tip_document: 'centralizator', fisier_nume: 'c_rev1.xlsx', uploadat_la: '2026-06-01' },
  { id: 21, pachet_id: 9, tip_document: 'pdf_aprobare_transgaz', fisier_nume: 'd.pdf', uploadat_la: '2026-06-02' },
  { id: 99, pachet_id: 777, tip_document: 'centralizator', fisier_nume: 'alt_proiect.xlsx', uploadat_la: '2026-06-03' },
]

describe('izometrii generate în CTC', () => {
  const r = construiesteIzometrii(docs, pachete, tronsoane)
  it('doar documentele pachetelor primite (alt proiect nu intră)', () => {
    expect(r.map(x => x.id)).toEqual([20, 17, 16, 21])
  })
  it('cea mai nouă revizie e prima și marcată ultima, pe document', () => {
    expect(r.filter(x => x.ultima).map(x => x.id)).toEqual([20, 21])
    expect(r[0]).toMatchObject({ revizie: 1, aprobat: true, tronson: 'T1 · Orșova' })
  })
  it('aprobat vs ciornă', () => {
    expect(r.find(x => x.id === 17).aprobat).toBe(false)
    expect(r.find(x => x.id === 21).aprobat).toBe(true)
    expect(esteAprobat({ tip_document: 'centralizator' }, { status: 'draft' })).toBe(false)
  })
  it('liste goale', () => {
    expect(construiesteIzometrii(null, null, null)).toEqual([])
  })
})

// #1219: exportul IZO peste 50 MB e livrat în fișiere separate (Excel-ul + PDF-urile în dosarul exportului).
// CTC-ul trebuie să-l descarce ÎNTREG, ca istoricul din Izometrie, nu doar Excel-ul.
describe('izometrii generate în CTC — exportul livrat în fișiere separate', () => {
  const docsProiect = f => construiesteIzometrii(f.tabele.executie_pachete_documente, f.tabele.executie_pachete_lansare, f.tabele.executie_tronsoane)
  const rand = (f, id) => docsProiect(f).find(x => x.id === id)

  it('rândul din dosarul exportului e marcat „separat” și păstrează pachetul; Excel-ul vechi (pachet/fișier) nu', () => {
    const f = fixturaSeparat()
    expect(rand(f, 61)).toMatchObject({ separat: true, pachet_id: 9, fisier_path: f.fisiere[0] })
    expect(rand(f, 40)).toMatchObject({ separat: false, pachet_id: 9 })
    expect(construiesteIzometrii(docs, pachete, tronsoane).every(x => x.separat === false)).toBe(true)   // fără cale = nu e separat
  })

  it('cu drept de citire NDT: TOATE fișierele exportului într-un ZIP local, cu structura arhivei (Excel la rădăcină + buletine/)', async () => {
    const f = fixturaSeparat()
    const { sb, jurnal, fetchFals } = clientFals({ tabele: f.tabele, obiecte: f.obiecte })
    const d = await descarcaIzometrie(sb, rand(f, 61), 1, fetchFals)
    expect(d).toMatchObject({ ok: true, nume: '99_GAZ_X_DWG_00001_rev0_Centralizator.zip', numar: 3 })
    expect(jurnal.rpc).toEqual([['fn_sud_drept', { p_proiect: 1, p_nivel: 'citire' }]])
    const zip = await JSZip.loadAsync(d.bytes)
    const nume = Object.keys(zip.files).filter(n => !n.endsWith('/')).sort()
    expect(nume).toEqual([XLSX, 'buletine/PA-UT_77_28.10.2026.pdf', 'buletine/PM_5_21.10.2026.pdf'].sort())
    for (const [n, b] of Object.entries(CONTINUT)) expect(await zip.file(n).async('uint8array')).toEqual(b)
  })

  it('fără drept de citire pe arhiva NDT → mesaj clar, nimic citit sau descărcat (nu tăcere, nu doar Excel-ul)', async () => {
    const f = fixturaSeparat()
    const { sb, jurnal, fetchFals } = clientFals({ tabele: f.tabele, obiecte: f.obiecte, drept: false })
    const d = await descarcaIzometrie(sb, rand(f, 61), 1, fetchFals)
    expect(d.ok).toBe(false)
    expect(d.eroare).toMatch(/dreptul de citire pe arhiva de buletine NDT a proiectului, pe care nu îl ai: nu s-a descărcat nimic/)
    expect(d.bytes).toBeUndefined()
    expect(d.url).toBeUndefined()
    expect(jurnal.from).not.toContain('sud_exporturi')
    expect(jurnal.semnat).toEqual([])
  })

  it('dreptul nu se poate verifica (eroare RPC / răspuns neclar) → necunoscut, nu „fără drept” și nu descărcare', async () => {
    for (const o of [{ dreptEroare: { message: 'timeout' } }, { drept: null }, { drept: 'da' }]) {
      const f = fixturaSeparat()
      const { sb, jurnal, fetchFals } = clientFals({ tabele: f.tabele, obiecte: f.obiecte, ...o })
      const d = await descarcaIzometrie(sb, rand(f, 61), 1, fetchFals)
      expect(d.ok).toBe(false)
      expect(d.eroare).toMatch(/nu s-a putut verifica: nu s-a descărcat nimic/)
      expect(jurnal.semnat).toEqual([])
    }
  })

  it('un PDF lipsă din Storage → eroare cu numele lui, fără ZIP parțial', async () => {
    const f = fixturaSeparat()
    f.obiecte.delete(`executie-pachete-pdf/${f.fisiere[2]}`)
    const { sb, fetchFals } = clientFals({ tabele: f.tabele, obiecte: f.obiecte })
    const d = await descarcaIzometrie(sb, rand(f, 61), 1, fetchFals)
    expect(d.ok).toBe(false)
    expect(d.eroare).toMatch(/buletine\/PA-UT_77_28\.10\.2026\.pdf: descărcare eșuată \(404\) — nu s-a descărcat nimic/)
    expect(d.bytes).toBeUndefined()
  })

  it('lista nevalidabilă (invizibilă / necitită / altă formă / link refuzat) → eroare, fără ZIP', async () => {
    const cazuri = [
      [f => { f.tabele.sud_exporturi = [] }, {}, /lista lor nu e vizibilă/],
      [f => { f.tabele['sud_exporturi:eroare'] = { message: 'timeout' } }, {}, /nu s-a putut citi \(timeout\)/],
      [f => { f.tabele.sud_exporturi[0].fotografie.fisiere = [f.fisiere[1], f.fisiere[0]] }, {}, /altă formă/],
      [f => { f.tabele.sud_exporturi[0].fotografie.fisiere = [...f.fisiere, '9/alt.zip'] }, {}, /altă formă/],
      [() => {}, { semnatEroare: { message: 'Object not found' } }, /Object not found — nu s-a descărcat nimic/],
    ]
    for (const [strica, opt, re] of cazuri) {
      const f = fixturaSeparat()
      strica(f)
      const { sb, fetchFals } = clientFals({ tabele: f.tabele, obiecte: f.obiecte, ...opt })
      const d = await descarcaIzometrie(sb, rand(f, 61), 1, fetchFals)
      expect(d.ok).toBe(false)
      expect(d.eroare).toMatch(re)
      expect(d.bytes).toBeUndefined()
    }
  })

  it('proiect necunoscut → refuz înainte de orice citire', async () => {
    const f = fixturaSeparat()
    const { sb, jurnal } = clientFals({ tabele: f.tabele, obiecte: f.obiecte })
    const d = await descarcaIzometrie(sb, rand(f, 61), undefined)
    expect(d).toMatchObject({ ok: false })
    expect(jurnal.rpc).toEqual([])
  })

  it('un singur fișier (Excel vechi, ZIP, PDF aprobat): link semnat cu numele fișierului, ca până acum, fără arhiva NDT', async () => {
    const f = fixturaSeparat()
    const { sb, jurnal } = clientFals({ tabele: f.tabele, drept: false })
    const d = await descarcaIzometrie(sb, rand(f, 40), 1)
    expect(d).toEqual({ ok: true, url: 'https://fals/executie-pachete-pdf/9/2026-06-01_ab_vechi.xlsx' })
    expect(jurnal.semnat).toEqual([['executie-pachete-pdf', '9/2026-06-01_ab_vechi.xlsx', { download: 'vechi.xlsx' }]])
    expect(jurnal.rpc).toEqual([])
    const e = await descarcaIzometrie(clientFals({ semnatEroare: { message: 'refuzat' } }).sb, rand(f, 40), 1)
    expect(e).toEqual({ ok: false, eroare: 'refuzat' })
  })
})
