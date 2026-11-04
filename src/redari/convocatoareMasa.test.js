import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { pregatesteLot, executaLot, construiesteZip, sumar, numereDeConsumat, limitaValida, LIMITA_LOT } from './convocatoareMasa.js'
import { salveazaConvocator } from './docx.js'

// ── date de test (TEST-RAZVAN, fictive) ────────────────────────────────────
const PROIECT = { id: 'pr1', cod: 'TEST-RAZVAN', denumire: 'Test', contract_nr: '12', contract_data: '2026-10-01', imputernicire_nr: '7', imputernicire_data: '2026-10-20',
  contact_nume: 'Ion Test', text_gdpr: 'Operator: Transgaz. Scop: convocare. Drepturi: acces.', reprezentant_tgz_nume: 'R. TGZ' }
const UAT = { id: 'u1', nume: 'Testeni', uat3: 'TST', sesiune_zi1: '2026-12-01', program_zi1: '09-15' }
const contact = (id, extra = {}) => ({ detinator_id: id, adresa_strada: 'Str. A 1', adresa_sat: 'Testeni', adresa_comuna: 'Testeni', adresa_judet: 'Mehedinți', cod_postal: '200000', adresa_cunoscuta: true, ...extra })

function date(n = 3) {
  const view = [], det = [], parc = [], cont = [], tok = []
  for (let i = 1; i <= n; i++) {
    const d = `d${i}`, p = `p${i}`
    view.push({ parcela_id: p, detinator_id: d, proiect_id: 'pr1', uat_id: 'u1', uat3: 'TST', id_parcela: `TST-${String(i).padStart(3, '0')}`, tronson: 1, nume: `POPESCU ${i}`, calitate: 'proprietar', adresa_cunoscuta: true })
    det.push({ id: d, parcela_id: p, nume: `POPESCU ${i}`, calitate: 'proprietar', sters_la: null })
    parc.push({ id: p, id_parcela: `TST-${String(i).padStart(3, '0')}`, uat_id: 'u1', tronson: 1 })
    cont.push(contact(d))
    tok.push({ detinator_id: d, token_raspuns: `tok${i}` })
  }
  return { red_v_stare_parcela: view, red_detinatori: det, red_parcele: parc, red_detinatori_contact: cont, red_detinatori_token: tok, red_convocari: [] }
}

// client fals: query builder minimal (eq / is / in / order / range / limit / gt), insert/update, rpc, storage
function clientFals(tabele, { rpcEsueazaLa = [], uploadEsueaza = new Set() } = {}) {
  const jurnal = { rpc: 0, inserturi: [], updateuri: [], upload: [], download: [] }
  let contor = 100
  const builder = (tab) => {
    const filtre = []
    let op = 'select', valori = null, single = false
    const b = {
      select() { return b }, order() { return b }, limit() { return b }, gt() { return b },
      eq(c, v) { filtre.push(r => r[c] === v); return b },
      is(c, v) { filtre.push(r => (r[c] ?? null) === v); return b },
      in(c, vs) { filtre.push(r => vs.includes(r[c])); return b },
      range(de, pana) { return Promise.resolve({ data: rez().slice(de, pana + 1), error: null }) },
      insert(v) { op = 'insert'; valori = v; return b },
      update(v) { op = 'update'; valori = v; return b },
      single() { single = true; return b },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej) },
    }
    const rez = () => (tabele[tab] || []).filter(r => filtre.every(f => f(r)))
    const exec = () => {
      if (op === 'insert') { const r = { id: `c${++contor}`, stare: 'activ', created_at: '2026-11-04', ...valori }; (tabele[tab] ||= []).push(r); jurnal.inserturi.push(r); return { data: single ? { id: r.id } : [r], error: null } }
      if (op === 'update') { const l = rez(); l.forEach(r => Object.assign(r, valori)); jurnal.updateuri.push(valori); return { data: single ? (l[0] ? { id: l[0].id } : null) : l, error: null } }
      return { data: rez(), error: null }
    }
    return b
  }
  let nr = 0
  return {
    jurnal,
    from: builder,
    rpc: async (fn, args) => {
      expect(fn).toBe('fn_red_numar_document'); expect(args.p_tip).toBe('C')
      jurnal.rpc++; nr++
      if (rpcEsueazaLa.includes(nr)) return { data: null, error: { message: 'rpc picat' } }
      return { data: `C-${String(nr).padStart(4, '0')}`, error: null }
    },
    storage: { from: () => ({
      upload: async (path) => { jurnal.upload.push(path); return uploadEsueaza.has(path) ? { error: { message: 'storage picat' } } : { error: null } },
      download: async (path) => { jurnal.download.push(path); return { data: new Blob([`vechi:${path}`]), error: null } },
      list: async () => ({ data: [], error: null }),
    }) },
  }
}

const genFals = vi.fn(async ({ nrDocument }) => ({ blob: new Blob([`doc:${nrDocument}`]), hash: 'h'.repeat(64) }))
const depsFalse = () => ({ genereaza: genFals, salveaza: vi.fn(async () => ({ path: 'x', convocareId: 'c' })), reincarca: vi.fn(async () => ({ path: 'y' })) })
const TPL = new ArrayBuffer(8)

describe('pregatesteLot — gărzi', () => {
  it('proiect fără împuternicire → tot lotul blocat, nicio citire, niciun RPC', async () => {
    const c = clientFals(date())
    const spy = vi.spyOn(c, 'from')
    const rez = await pregatesteLot(c, { proiect: { ...PROIECT, imputernicire_nr: '' }, uat: UAT })
    expect(rez.blocat).toMatch(/împuternicire/)
    expect(rez.plan).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    expect(c.jurnal.rpc).toBe(0)
  })
  it('UAT fără zi de sesiune cu program → blocat', async () => {
    const rez = await pregatesteLot(clientFals(date()), { proiect: PROIECT, uat: { ...UAT, program_zi1: '' } })
    expect(rez.blocat).toMatch(/zi de sesiune/)
  })
  it('exclude cu motiv: neidentificat, adresă necunoscută, fără token, fără contact', async () => {
    const t = date(5)
    t.red_v_stare_parcela[0].calitate = 'neidentificat'; t.red_detinatori[0].calitate = 'neidentificat'
    t.red_v_stare_parcela[1].adresa_cunoscuta = false
    t.red_detinatori_token = t.red_detinatori_token.filter(x => x.detinator_id !== 'd3')
    t.red_detinatori_contact = t.red_detinatori_contact.filter(x => x.detinator_id !== 'd4')
    const rez = await pregatesteLot(clientFals(t), { proiect: PROIECT, uat: UAT })
    expect(rez.blocat).toBeNull()
    expect(rez.plan.map(p => p.rand.detinator_id)).toEqual(['d5'])
    const m = Object.fromEntries(rez.exclusi.map(x => [x.rand.detinator_id, x.motiv]))
    expect(m.d1).toMatch(/neidentificat/)
    expect(m.d2).toMatch(/adresă necunoscută/)
    expect(m.d3).toMatch(/token/)
    expect(m.d4).toMatch(/adresă/)
  })
})

describe('pregatesteLot — idempotență', () => {
  it('neexpediat cu fișier → reia (fără număr); fără fișier → reîncarcă; expediat → exclus; nimic → nou', async () => {
    const t = date(5)
    t.red_convocari = [
      { id: 'cv1', detinator_id: 'd1', canal: 'posta', stare: 'activ', nr_document: 'C-0011', data_expediere: null, fisier_convocator_path: 'TEST-RAZVAN/TST/TST-001/C-0011-v1.docx', created_at: '2026-11-01' },
      { id: 'cv2', detinator_id: 'd2', canal: 'posta', stare: 'activ', nr_document: 'C-0012', data_expediere: null, fisier_convocator_path: null, created_at: '2026-11-01' },
      { id: 'cv3', detinator_id: 'd3', canal: 'posta', stare: 'activ', nr_document: 'C-0013', data_expediere: '2026-11-02', fisier_convocator_path: 'a', created_at: '2026-11-01' },
      { id: 'cv4', detinator_id: 'd4', canal: 'posta', stare: 'anulat', nr_document: 'C-0014', data_expediere: null, fisier_convocator_path: 'b', created_at: '2026-11-01' },
      { id: 'cv5', detinator_id: 'd5', canal: 'sms', stare: 'activ', nr_document: 'C-0015', data_expediere: null, fisier_convocator_path: 'c', created_at: '2026-11-01' },
    ]
    const rez = await pregatesteLot(clientFals(t), { proiect: PROIECT, uat: UAT })
    const a = Object.fromEntries(rez.plan.map(p => [p.rand.detinator_id, p.actiune]))
    expect(a).toEqual({ d1: 'reia', d2: 'reincarca', d4: 'nou', d5: 'nou' })
    expect(rez.exclusi[0].motiv).toMatch(/expediată \(C-0013\)/)
  })
  it('două convocări neexpediate → exclus (nu alegem noi)', async () => {
    const t = date(1)
    t.red_convocari = ['C-0001', 'C-0002'].map((nr, i) => ({ id: `x${i}`, detinator_id: 'd1', canal: 'posta', stare: 'activ', nr_document: nr, data_expediere: null, fisier_convocator_path: 'p', created_at: '2026-11-01' }))
    const rez = await pregatesteLot(clientFals(t), { proiect: PROIECT, uat: UAT })
    expect(rez.plan).toEqual([]); expect(rez.exclusi[0].motiv).toMatch(/2 convocări poștale neexpediate/)
  })
})

describe('executaLot', () => {
  it('reia descarcă fișierul existent (0 RPC); reîncarcă păstrează numărul și data; nou consumă exact un număr', async () => {
    const t = date(3)
    t.red_convocari = [
      { id: 'cv1', detinator_id: 'd1', canal: 'posta', stare: 'activ', nr_document: 'C-0011', data_expediere: null, fisier_convocator_path: 'TEST-RAZVAN/TST/TST-001/C-0011-v1.docx', created_at: '2026-11-01' },
      { id: 'cv2', detinator_id: 'd2', canal: 'posta', stare: 'activ', nr_document: 'C-0012', data_expediere: null, fisier_convocator_path: null, created_at: '2026-11-02' },
    ]
    const c = clientFals(t), deps = depsFalse(); genFals.mockClear()
    const { plan, exclusi } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    expect(numereDeConsumat(plan)).toBe(1)
    const { fisiere, raport } = await executaLot(c, { plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps })
    expect(c.jurnal.rpc).toBe(1)
    expect(c.jurnal.download).toEqual(['TEST-RAZVAN/TST/TST-001/C-0011-v1.docx'])
    expect(deps.reincarca).toHaveBeenCalledWith(c, expect.objectContaining({ convocareId: 'cv2', nrDocument: 'C-0012', idParcela: 'TST-002', uat3: 'TST' }))
    expect(genFals).toHaveBeenCalledWith(expect.objectContaining({ nrDocument: 'C-0012', dataDocument: '2026-11-02' }))
    expect(deps.salveaza).toHaveBeenCalledWith(c, expect.objectContaining({ nrDocument: 'C-0001', detinatorId: 'd3', canal: 'posta', uat3: 'TST', idParcela: 'TST-003' }))
    expect(fisiere.map(f => f.nume)).toEqual(['C-0011_TST-001.docx', 'C-0012_TST-002.docx', 'C-0001_TST-003.docx'])
    expect(sumar(raport, exclusi)).toMatchObject({ nou: 1, reia: 1, reincarca: 1, erori: 0 })
    // nimic marcat expediat
    expect(c.jurnal.updateuri.some(u => 'data_expediere' in u)).toBe(false)
  })

  it('a doua rulare pe același UAT nu mai consumă numere (calea reală salveazaConvocator)', async () => {
    const t = date(3), c = clientFals(t)
    const deps = { genereaza: genFals, salveaza: salveazaConvocator }
    const r1 = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    await executaLot(c, { plan: r1.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps })
    expect(c.jurnal.rpc).toBe(3)
    expect(t.red_convocari.map(x => x.fisier_convocator_path)).toEqual(['TEST-RAZVAN/TST/TST-001/C-0001-v1.docx', 'TEST-RAZVAN/TST/TST-002/C-0002-v1.docx', 'TEST-RAZVAN/TST/TST-003/C-0003-v1.docx'])
    const r2 = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    expect(r2.plan.map(p => p.actiune)).toEqual(['reia', 'reia', 'reia'])
    const { fisiere } = await executaLot(c, { plan: r2.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps })
    expect(c.jurnal.rpc).toBe(3)
    expect(fisiere).toHaveLength(3)
  })

  it('upload eșuat → eroare pe rând, lotul continuă; rerularea îl ia pe „reîncărcat” cu același număr', async () => {
    const t = date(3)
    const c = clientFals(t, { uploadEsueaza: new Set(['TEST-RAZVAN/TST/TST-002/C-0002-v1.docx']) })
    const r1 = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const { raport } = await executaLot(c, { plan: r1.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps: { genereaza: genFals, salveaza: salveazaConvocator } })
    expect(raport.map(r => r.stare)).toEqual(['ok', 'eroare', 'ok'])
    expect(raport[1].motiv).toMatch(/C-0002 a fost rezervat/)
    const r2 = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    expect(r2.plan.map(p => [p.actiune, p.conv?.nr_document])).toEqual([['reia', 'C-0001'], ['reincarca', 'C-0002'], ['reia', 'C-0003']])
  })

  it('RPC picat pe un rând → eroare pe rând, restul merg', async () => {
    const c = clientFals(date(3), { rpcEsueazaLa: [2] })
    const { plan } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const { raport, fisiere } = await executaLot(c, { plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps: depsFalse() })
    expect(raport.map(r => r.stare)).toEqual(['ok', 'eroare', 'ok'])
    expect(raport[1].motiv).toMatch(/rpc picat/)
    expect(fisiere).toHaveLength(2)
  })

  it('limita: doar primele N rânduri, restul „amânat”; limita se plafonează la 200', async () => {
    const c = clientFals(date(5))
    const { plan } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const { raport } = await executaLot(c, { plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, limita: 2, deps: depsFalse() })
    expect(c.jurnal.rpc).toBe(2)
    expect(raport.map(r => r.stare)).toEqual(['ok', 'ok', 'amanat', 'amanat', 'amanat'])
    expect(limitaValida(5000)).toBe(LIMITA_LOT); expect(limitaValida('x')).toBe(LIMITA_LOT); expect(limitaValida(0)).toBe(LIMITA_LOT); expect(limitaValida(7)).toBe(7)
    expect(numereDeConsumat(plan, 2)).toBe(2)
  })

  it('oprirea: rândurile de după cerere nu se procesează', async () => {
    const c = clientFals(date(4))
    const { plan } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    let stop = false
    const { raport } = await executaLot(c, { plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps: depsFalse(), esteOprit: () => stop,
      onProgres: ({ i }) => { if (i === 2) stop = true } })
    expect(raport.map(r => r.stare)).toEqual(['ok', 'ok', 'oprit', 'oprit'])
    expect(c.jurnal.rpc).toBe(2)
  })

  it('datele s-au schimbat între pregătire și rulare (împuternicire ștearsă) → aruncă înainte de orice RPC', async () => {
    const c = clientFals(date(2))
    const { plan } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    await expect(executaLot(c, { plan, proiect: { ...PROIECT, imputernicire_data: null }, uat: UAT, templateArrayBuffer: TPL, deps: depsFalse() })).rejects.toThrow(/împuternicire/)
    expect(c.jurnal.rpc).toBe(0)
  })

  it('garda pe rând refăcută la rulare: token dispărut → eroare fără număr consumat', async () => {
    const c = clientFals(date(2))
    const { plan } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    plan[0].token = null
    const { raport } = await executaLot(c, { plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps: depsFalse() })
    expect(raport[0]).toMatchObject({ stare: 'eroare', nrDocument: '' })
    expect(raport[0].motiv).toMatch(/niciun număr consumat/)
    expect(c.jurnal.rpc).toBe(1)
  })
})

describe('construiesteZip', () => {
  it('DOCX-uri + borderou.csv + opis.xlsx (cu excluși și erori)', async () => {
    const t = date(3); t.red_v_stare_parcela[2].adresa_cunoscuta = false
    const c = clientFals(t, { rpcEsueazaLa: [2] })
    const { plan, exclusi } = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const { fisiere, raport } = await executaLot(c, { plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps: depsFalse() })
    const blob = await construiesteZip({ proiect: PROIECT, uat: UAT, fisiere, raport, exclusi })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['C-0001_TST-001.docx', 'borderou.csv', 'opis.xlsx'])
    const csv = await zip.file('borderou.csv').async('string')
    expect(csv.split('\r\n')[0].replace('﻿', '')).toBe('nr_document;nume;adresa;cod_postal;localitate;judet;id_parcela')
    expect(csv).toContain('C-0001;POPESCU 1;Str. A 1, Testeni;200000;Testeni;Mehedinți;TST-001')
    const wb = XLSX.read(await zip.file('opis.xlsx').async('uint8array'), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Opis', 'Borderou'])
    const opis = XLSX.utils.sheet_to_json(wb.Sheets.Opis, { header: 1 })
    expect(opis.slice(2).map(r => r[6])).toEqual(['generat', 'EROARE', 'exclus'])
  })
})
