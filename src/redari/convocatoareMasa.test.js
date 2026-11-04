import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { pregatesteLot, executaLot, construiesteZip, sumar, numereDeConsumat, limitaValida, selecteazaLot, detecteazaRezervare, LIMITA_LOT, AVERTISMENT_FARA_PROTECTIE } from './convocatoareMasa.js'
import { salveazaConvocator, reincarcaConvocator } from './docx.js'

// ── date de test (TEST-RAZVAN, fictive) ────────────────────────────────────
const PROIECT = { id: 'pr1', cod: 'TEST-RAZVAN', denumire: 'Test', contract_nr: '12', contract_data: '2026-10-01', imputernicire_nr: '7', imputernicire_data: '2026-10-20',
  contact_nume: 'Ion Test', text_gdpr: 'Operator: Transgaz. Scop: convocare. Drepturi: acces.', reprezentant_tgz_nume: 'R. TGZ' }
const UAT = { id: 'u1', nume: 'Testeni', uat3: 'TST', sesiune_zi1: '2026-12-01', program_zi1: '09-15' }
const contact = (id, extra = {}) => ({ detinator_id: id, adresa_strada: 'Str. A 1', adresa_sat: 'Testeni', adresa_comuna: 'Testeni', adresa_judet: 'Mehedinți', cod_postal: '200000', adresa_cunoscuta: true, ...extra })
const idx = (i) => String(i).padStart(4, '0')

function date(n = 3) {
  const view = [], det = [], parc = [], cont = [], tok = []
  for (let i = 1; i <= n; i++) {
    const d = `d${idx(i)}`, p = `p${idx(i)}`, idp = `TST-${idx(i)}`
    view.push({ parcela_id: p, detinator_id: d, proiect_id: 'pr1', uat_id: 'u1', uat3: 'TST', id_parcela: idp, tronson: 1, nume: `POPESCU ${idx(i)}`, calitate: 'proprietar', adresa_cunoscuta: true })
    det.push({ id: d, parcela_id: p, nume: `POPESCU ${idx(i)}`, calitate: 'proprietar', sters_la: null })
    parc.push({ id: p, id_parcela: idp, uat_id: 'u1', tronson: 1, sters_la: null })
    cont.push(contact(d))
    tok.push({ detinator_id: d, token_raspuns: `tok${i}` })
  }
  return { red_v_stare_parcela: view, red_detinatori: det, red_parcele: parc, red_detinatori_contact: cont, red_detinatori_token: tok, red_convocari: [] }
}
const conv = (o) => ({ canal: 'posta', stare: 'activ', data_expediere: null, fisier_convocator_path: null, sters_la: null, created_at: '2026-11-01', ...o })

// client fals: query builder cu keyset real (order / gt / limit), maybeSingle, insert / update, rpc, storage.
// cuRpc: true = fn_red_convocare_rezerva există (lock simulat + verificare + rezervare + INSERT, ca migrarea 20261130l); false = PGRST202.
function clientFals(tabele, { rpcEsueazaLa = [], uploadEsueaza = new Set(), cuRpc = true, capPagina = Infinity, inainteDeRezervare } = {}) {
  const jurnal = { rpc: [], numere: 0, inserturi: [], updateuri: [], upload: [], download: [] }
  let contor = 100
  const builder = (tab) => {
    const filtre = []
    let op = 'select', valori = null, single = false, maybe = false, ordine = [], lim = Infinity
    const b = {
      select() { return b }, order(c) { ordine.push(c); return b }, limit(n) { lim = n; return b },
      gt(c, v) { filtre.push(r => String(r[c]) > String(v)); return b },
      eq(c, v) { filtre.push(r => r[c] === v); return b },
      is(c, v) { filtre.push(r => (r[c] ?? null) === v); return b },
      in(c, vs) { filtre.push(r => vs.includes(r[c])); return b },
      range(de, pana) { return Promise.resolve({ data: rez().slice(de, Math.min(pana + 1, de + capPagina)), error: null }) },
      insert(v) { op = 'insert'; valori = v; return b },
      update(v) { op = 'update'; valori = v; return b },
      single() { single = true; return b }, maybeSingle() { maybe = true; return b },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej) },
    }
    const rez = () => {
      let l = (tabele[tab] || []).filter(r => filtre.every(f => f(r)))
      if (ordine.length) l = l.slice().sort((a, x) => { for (const c of ordine) { const u = String(a[c]), v = String(x[c]); if (u !== v) return u < v ? -1 : 1 } return 0 })
      return l.slice(0, Math.min(lim, capPagina))
    }
    const exec = () => {
      if (op === 'insert') { const r = conv({ id: `c${++contor}`, created_at: '2026-11-04', ...valori }); (tabele[tab] ||= []).push(r); jurnal.inserturi.push(r); return { data: single ? { id: r.id } : [r], error: null } }
      if (op === 'update') { const l = (tabele[tab] || []).filter(r => filtre.every(f => f(r))); l.forEach(r => Object.assign(r, valori)); jurnal.updateuri.push(valori); return { data: single ? (l[0] ? { id: l[0].id } : null) : l, error: null } }
      const l = rez()
      if (maybe) return { data: l[0] ?? null, error: null }
      if (single) return l[0] ? { data: l[0], error: null } : { data: null, error: { message: 'nu există' } }
      return { data: l, error: null }
    }
    return b
  }
  const numar = () => { jurnal.numere++; return `C-${idx(jurnal.numere)}` }
  return {
    jurnal, tabele,
    from: builder,
    rpc: async (fn, args) => {
      jurnal.rpc.push(fn)
      if (fn === 'fn_red_convocare_rezerva') {
        if (!cuRpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }
        if (!args.p_detinator_id) return { data: null, error: { code: '22023', message: 'redari: parametri lipsa' }, status: 400 }
        await inainteDeRezervare?.(args.p_detinator_id)
        const exista = (tabele.red_convocari || []).filter(c => c.detinator_id === args.p_detinator_id && c.canal === 'posta' && c.stare === 'activ' && !c.data_expediere && !c.sters_la)
        if (exista.length) return { data: null, error: { code: 'RD001', message: `redari: detinatorul are deja convocare postala neexpediata (${exista.map(c => c.nr_document).join(', ')})` }, status: 400 }
        if (rpcEsueazaLa.includes(jurnal.numere + 1)) { jurnal.numere++; return { data: null, error: { message: 'rpc picat' }, status: 400 } }
        const r = conv({ id: `c${++contor}`, detinator_id: args.p_detinator_id, nr_document: numar(), created_at: '2026-11-04' })
        tabele.red_convocari.push(r); jurnal.inserturi.push(r)
        return { data: [{ convocare_id: r.id, nr_document: r.nr_document }], error: null, status: 200 }
      }
      expect(fn).toBe('fn_red_numar_document'); expect(args.p_tip).toBe('C')
      if (rpcEsueazaLa.includes(jurnal.numere + 1)) { jurnal.numere++; return { data: null, error: { message: 'rpc picat' } } }
      return { data: numar(), error: null }
    },
    storage: { from: () => ({
      upload: async (path) => { jurnal.upload.push(path); return uploadEsueaza.has(path) ? { error: { message: 'storage picat' } } : { error: null } },
      download: async (path) => { jurnal.download.push(path); return { data: new Blob([`vechi:${path}`]), error: null } },
      list: async () => ({ data: [], error: null }),
    }) },
  }
}

const genFals = vi.fn(async ({ nrDocument }) => ({ blob: new Blob([`doc:${nrDocument}`]), hash: 'h'.repeat(64) }))
const depsReale = { genereaza: genFals, salveaza: salveazaConvocator, reincarca: reincarcaConvocator }
const depsFalse = () => ({ genereaza: genFals, salveaza: vi.fn(async () => ({ path: 'x', convocareId: 'c' })), reincarca: vi.fn(async () => ({ path: 'y' })) })
const TPL = new ArrayBuffer(8)
const ruleaza = async (c, opt = {}) => {
  const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
  const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale, ...opt })
  return { ...p, ...r }
}
const activeNeexp = (t, d) => t.red_convocari.filter(c => c.detinator_id === d && c.stare === 'activ' && !c.data_expediere && !c.sters_la)

describe('pregatesteLot — gărzi', () => {
  it('proiect fără împuternicire → tot lotul blocat, nicio citire, niciun RPC', async () => {
    const c = clientFals(date())
    const spy = vi.spyOn(c, 'from')
    const rez = await pregatesteLot(c, { proiect: { ...PROIECT, imputernicire_nr: '' }, uat: UAT })
    expect(rez.blocat).toMatch(/împuternicire/)
    expect(rez.plan).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    expect(c.jurnal.rpc).toEqual([])
  })
  it('UAT fără zi de sesiune cu program → blocat', async () => {
    const rez = await pregatesteLot(clientFals(date()), { proiect: PROIECT, uat: { ...UAT, program_zi1: '' } })
    expect(rez.blocat).toMatch(/zi de sesiune/)
  })
  it('exclude cu motiv: neidentificat, adresă necunoscută, fără token, fără contact', async () => {
    const t = date(5)
    t.red_v_stare_parcela[0].calitate = 'neidentificat'; t.red_detinatori[0].calitate = 'neidentificat'
    t.red_v_stare_parcela[1].adresa_cunoscuta = false; t.red_detinatori_contact[1].adresa_cunoscuta = false
    t.red_detinatori_token = t.red_detinatori_token.filter(x => x.detinator_id !== 'd0003')
    t.red_detinatori_contact = t.red_detinatori_contact.filter(x => x.detinator_id !== 'd0004')
    const rez = await pregatesteLot(clientFals(t), { proiect: PROIECT, uat: UAT })
    expect(rez.blocat).toBeNull()
    expect(rez.plan.map(p => p.rand.detinator_id)).toEqual(['d0005'])
    const m = Object.fromEntries(rez.exclusi.map(x => [x.rand.detinator_id, x.motiv]))
    expect(m.d0001).toMatch(/neidentificat/)
    expect(m.d0002).toMatch(/adresă necunoscută/)
    expect(m.d0003).toMatch(/token/)
    expect(m.d0004).toMatch(/adresă/)
  })
  it('detectează RPC-ul de rezervare (22023 = există; PGRST202 = lipsă)', async () => {
    expect(await detecteazaRezervare(clientFals(date(), { cuRpc: true }))).toBe(true)
    expect(await detecteazaRezervare(clientFals(date(), { cuRpc: false }))).toBe(false)
    expect((await pregatesteLot(clientFals(date(), { cuRpc: false }), { proiect: PROIECT, uat: UAT })).protectie).toBe(false)
  })
})

describe('pregatesteLot — idempotență și paginare', () => {
  it('neexpediat cu fișier → reia; fără fișier → reîncarcă; expediat → exclus; anulat / șters logic / sms → nou', async () => {
    const t = date(6)
    t.red_convocari = [
      conv({ id: 'cv1', detinator_id: 'd0001', nr_document: 'C-0011', fisier_convocator_path: 'TEST-RAZVAN/TST/TST-0001/C-0011-v1.docx' }),
      conv({ id: 'cv2', detinator_id: 'd0002', nr_document: 'C-0012' }),
      conv({ id: 'cv3', detinator_id: 'd0003', nr_document: 'C-0013', data_expediere: '2026-11-02', fisier_convocator_path: 'a' }),
      conv({ id: 'cv4', detinator_id: 'd0004', nr_document: 'C-0014', stare: 'anulat', fisier_convocator_path: 'b' }),
      conv({ id: 'cv5', detinator_id: 'd0005', nr_document: 'C-0015', canal: 'sms', fisier_convocator_path: 'c' }),
      conv({ id: 'cv6', detinator_id: 'd0006', nr_document: 'C-0016', sters_la: '2026-11-03', fisier_convocator_path: 'd' }),   // P2: șters logic
    ]
    const rez = await pregatesteLot(clientFals(t), { proiect: PROIECT, uat: UAT })
    const a = Object.fromEntries(rez.plan.map(p => [p.rand.detinator_id, p.actiune]))
    expect(a).toEqual({ d0001: 'reia', d0002: 'reincarca', d0004: 'nou', d0005: 'nou', d0006: 'nou' })
    expect(rez.exclusi[0].motiv).toMatch(/expediată \(C-0013\)/)
  })
  it('două convocări neexpediate → exclus (nu alegem noi)', async () => {
    const t = date(1)
    t.red_convocari = ['C-0001', 'C-0002'].map((nr, i) => conv({ id: `x${i}`, detinator_id: 'd0001', nr_document: nr, fisier_convocator_path: 'p' }))
    const rez = await pregatesteLot(clientFals(t), { proiect: PROIECT, uat: UAT })
    expect(rez.plan).toEqual([]); expect(rez.exclusi[0].motiv).toMatch(/2 convocări poștale neexpediate/)
  })
  it('P2 (L23): serverul plafonează pagina la 7 rânduri → keyset citește tot UAT-ul (2.548 de rânduri nu se trunchiază)', async () => {
    const rez = await pregatesteLot(clientFals(date(25), { capPagina: 7 }), { proiect: PROIECT, uat: UAT })
    expect(rez.plan).toHaveLength(25)
  })
  it('P2 (L24): esteCurent fals oprește citirile', async () => {
    await expect(pregatesteLot(clientFals(date(3)), { proiect: PROIECT, uat: UAT, esteCurent: () => false })).rejects.toThrow(/abandonat/)
  })
})

describe('executaLot', () => {
  it('cu RPC: reia descarcă (0 numere); reîncarcă păstrează numărul și data; nou = rezervare atomică + upload v1', async () => {
    const t = date(3)
    t.red_convocari = [
      conv({ id: 'cv1', detinator_id: 'd0001', nr_document: 'C-0011', fisier_convocator_path: 'TEST-RAZVAN/TST/TST-0001/C-0011-v1.docx' }),
      conv({ id: 'cv2', detinator_id: 'd0002', nr_document: 'C-0012', created_at: '2026-11-02' }),
    ]
    const c = clientFals(t); genFals.mockClear()
    const r = await ruleaza(c, { includeGenerate: true })
    expect(c.jurnal.numere).toBe(1)
    expect(c.jurnal.rpc.filter(f => f === 'fn_red_numar_document')).toEqual([])
    expect(c.jurnal.download).toEqual(['TEST-RAZVAN/TST/TST-0001/C-0011-v1.docx'])
    expect(genFals).toHaveBeenCalledWith(expect.objectContaining({ nrDocument: 'C-0012', dataDocument: '2026-11-02' }))
    expect(c.jurnal.upload).toEqual(['TEST-RAZVAN/TST/TST-0002/C-0012-v1.docx', 'TEST-RAZVAN/TST/TST-0003/C-0001-v1.docx'])
    expect(activeNeexp(t, 'd0003').map(x => x.fisier_convocator_path)).toEqual(['TEST-RAZVAN/TST/TST-0003/C-0001-v1.docx'])
    expect(r.fisiere.map(f => f.nume)).toEqual(['C-0011_TST-0001.docx', 'C-0012_TST-0002.docx', 'C-0001_TST-0003.docx'])
    expect(sumar(r.raport, r.exclusi)).toMatchObject({ nou: 1, reia: 1, reincarca: 1, erori: 0 })
    expect(r.avertismente).toEqual([])
    expect(c.jurnal.updateuri.some(u => 'data_expediere' in u)).toBe(false)   // nimic marcat expediat
  })

  it('P1-2: 201 rânduri, două rulări → toate generate; a doua rulare nu redescarcă și nu reconsumă', async () => {
    const t = date(201), c = clientFals(t)
    const r1 = await ruleaza(c)
    expect(sumar(r1.raport)).toMatchObject({ nou: 200, amanate: 1 })
    const r2 = await ruleaza(c)
    expect(sumar(r2.raport)).toMatchObject({ nou: 1, deja: 200, amanate: 0 })
    expect(r2.fisiere.map(f => f.nume)).toEqual(['C-0201_TST-0201.docx'])
    expect(c.jurnal.numere).toBe(201)
    expect(c.jurnal.download).toEqual([])
    expect(t.red_detinatori.every(d => activeNeexp(t, d.id).length === 1)).toBe(true)
    // redescărcarea rămâne separată: cu opțiunea, cele 201 intră în zip, fără niciun număr nou
    const r3 = await ruleaza(c, { includeGenerate: true })
    expect(r3.fisiere).toHaveLength(201); expect(c.jurnal.numere).toBe(201)
  })

  it('P1-2: limita se aplică doar acțiunilor „nou” (selecteazaLot)', () => {
    const plan = [{ actiune: 'reia' }, { actiune: 'nou' }, { actiune: 'reincarca' }, { actiune: 'nou' }, { actiune: 'nou' }]
    expect(selecteazaLot(plan, { limita: 2 }).map(s => s.decizie)).toEqual(['deja', 'fa', 'fa', 'fa', 'amanat'])
    expect(selecteazaLot(plan, { limita: 2, includeGenerate: true }).map(s => s.decizie)).toEqual(['fa', 'fa', 'fa', 'fa', 'amanat'])
    expect(numereDeConsumat(plan, 2)).toBe(2)
    expect(limitaValida(5000)).toBe(LIMITA_LOT); expect(limitaValida('x')).toBe(LIMITA_LOT); expect(limitaValida(0)).toBe(LIMITA_LOT); expect(limitaValida(7)).toBe(7)
  })

  it('P1-1: alt tab a generat între timp (RPC întoarce RD001) → „schimbat”, fără număr consumat, o singură convocare', async () => {
    const t = date(2)
    const c = clientFals(t, { inainteDeRezervare: (d) => { if (d === 'd0001' && !activeNeexp(t, d).length) t.red_convocari.push(conv({ id: 'altTab', detinator_id: d, nr_document: 'C-0900' })) } })
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'ok'])
    expect(r.raport[0].motiv).toMatch(/C-0900/)
    expect(activeNeexp(t, 'd0001')).toHaveLength(1)
    expect(c.jurnal.numere).toBe(1)
  })

  it('P1-1: fără migrare (PGRST202) → calea veche + avertisment vizibil', async () => {
    const c = clientFals(date(2), { cuRpc: false })
    const r = await ruleaza(c)
    expect(r.protectie).toBe(false)
    expect(r.avertismente).toEqual([AVERTISMENT_FARA_PROTECTIE])
    expect(c.jurnal.rpc.filter(f => f === 'fn_red_numar_document')).toHaveLength(2)
    expect(sumar(r.raport)).toMatchObject({ nou: 2 })
  })
  it('P1-1: RPC dispărut în timpul rulării (PGRST202 la rezervare) → fallback cu avertisment', async () => {
    const c = clientFals(date(2), { cuRpc: false })
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.avertismente).toEqual([AVERTISMENT_FARA_PROTECTIE])
    expect(sumar(r.raport)).toMatchObject({ nou: 2, erori: 0 })
  })

  it('P1-3: adresa schimbată în BD după „Verifică” → „schimbat între timp”, fără număr consumat', async () => {
    const t = date(2), c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_detinatori_contact[0].adresa_strada = 'Str. Nouă 9'
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'ok'])
    expect(c.jurnal.numere).toBe(1)
  })
  it('P1-3: deținător șters / calitate schimbată / token schimbat / convocare nouă → toate „schimbat”, zero numere', async () => {
    const t = date(4), c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_detinatori[0].sters_la = '2026-11-04'
    t.red_detinatori[1].calitate = 'neidentificat'
    t.red_detinatori_token[2].token_raspuns = 'altul'
    t.red_convocari.push(conv({ id: 'z', detinator_id: 'd0004', nr_document: 'C-0777', fisier_convocator_path: 'q' }))
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'schimbat', 'schimbat', 'schimbat'])
    expect(c.jurnal.numere).toBe(0)
  })
  it('P1-3: generarea folosește datele recitite (nu snapshot-ul din plan)', async () => {
    const t = date(1), c = clientFals(t); genFals.mockClear()
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    p.plan[0].detinator = { ...p.plan[0].detinator, nume: 'DIN PLAN' }   // obiectul din plan nu intră în document
    await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(genFals.mock.calls[0][0].detinator.nume).toBe('POPESCU 0001')
  })

  it('a doua rulare pe același UAT nu mai consumă numere (calea veche, salveazaConvocator real)', async () => {
    const t = date(3), c = clientFals(t, { cuRpc: false })
    await ruleaza(c)
    expect(c.jurnal.numere).toBe(3)
    expect(t.red_convocari.map(x => x.fisier_convocator_path)).toEqual(['TEST-RAZVAN/TST/TST-0001/C-0001-v1.docx', 'TEST-RAZVAN/TST/TST-0002/C-0002-v1.docx', 'TEST-RAZVAN/TST/TST-0003/C-0003-v1.docx'])
    const r2 = await ruleaza(c, { includeGenerate: true })
    expect(r2.plan.map(p => p.actiune)).toEqual(['reia', 'reia', 'reia'])
    expect(c.jurnal.numere).toBe(3); expect(r2.fisiere).toHaveLength(3)
  })

  it('upload eșuat → eroare pe rând, lotul continuă; rerularea îl ia pe „reîncărcat” cu același număr', async () => {
    const t = date(3)
    const c = clientFals(t, { uploadEsueaza: new Set(['TEST-RAZVAN/TST/TST-0002/C-0002-v1.docx']) })
    const r1 = await ruleaza(c)
    expect(r1.raport.map(r => r.stare)).toEqual(['ok', 'eroare', 'ok'])
    expect(r1.raport[1].motiv).toMatch(/C-0002 a fost rezervat/)
    const r2 = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    expect(r2.plan.map(p => [p.actiune, p.conv?.nr_document])).toEqual([['reia', 'C-0001'], ['reincarca', 'C-0002'], ['reia', 'C-0003']])
  })

  it('rezervare picată pe un rând → eroare pe rând, restul merg', async () => {
    const c = clientFals(date(3), { rpcEsueazaLa: [2] })
    const r = await ruleaza(c)
    expect(r.raport.map(x => x.stare)).toEqual(['ok', 'eroare', 'ok'])
    expect(r.raport[1].motiv).toMatch(/rpc picat/)
    expect(r.fisiere).toHaveLength(2)
  })

  it('oprirea: rândurile de după cerere nu se procesează', async () => {
    const c = clientFals(date(4))
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    let stop = false
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale, esteOprit: () => stop,
      onProgres: ({ i }) => { if (i === 2) stop = true } })
    expect(r.raport.map(x => x.stare)).toEqual(['ok', 'ok', 'oprit', 'oprit'])
    expect(c.jurnal.numere).toBe(2)
  })

  it('proiectul s-a schimbat între pregătire și rulare (împuternicire ștearsă) → aruncă înainte de orice RPC', async () => {
    const c = clientFals(date(2))
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const inainte = c.jurnal.rpc.length
    await expect(executaLot(c, { plan: p.plan, proiect: { ...PROIECT, imputernicire_data: null }, uat: UAT, templateArrayBuffer: TPL, deps: depsFalse() })).rejects.toThrow(/împuternicire/)
    expect(c.jurnal.rpc.length).toBe(inainte)
  })
})

describe('construiesteZip', () => {
  it('DOCX-uri + borderou.csv + opis.xlsx (cu excluși și erori)', async () => {
    const t = date(3); t.red_v_stare_parcela[2].adresa_cunoscuta = false; t.red_detinatori_contact[2].adresa_cunoscuta = false
    const c = clientFals(t, { rpcEsueazaLa: [2] })
    const r = await ruleaza(c)
    const blob = await construiesteZip({ proiect: PROIECT, uat: UAT, fisiere: r.fisiere, raport: r.raport, exclusi: r.exclusi })
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['C-0001_TST-0001.docx', 'borderou.csv', 'opis.xlsx'])
    const csv = await zip.file('borderou.csv').async('string')
    expect(csv.split('\r\n')[0].replace('﻿', '')).toBe('nr_document;nume;adresa;cod_postal;localitate;judet;id_parcela')
    expect(csv).toContain('C-0001;POPESCU 0001;Str. A 1, Testeni;200000;Testeni;Mehedinți;TST-0001')
    const wb = XLSX.read(await zip.file('opis.xlsx').async('uint8array'), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Opis', 'Borderou'])
    const opis = XLSX.utils.sheet_to_json(wb.Sheets.Opis, { header: 1 })
    expect(opis.slice(2).map(x => x[6])).toEqual(['generat', 'EROARE', 'exclus'])
  })
})
