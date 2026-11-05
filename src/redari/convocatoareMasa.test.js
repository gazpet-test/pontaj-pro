import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('fără BD în test') }, rpc: () => { throw new Error('fără BD în test') } } }))
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { pregatesteLot, executaLot, construiesteZip, sumar, numereDeConsumat, limitaValida, selecteazaLot, detecteazaRezervare, LIMITA_LOT, MESAJ_FARA_PROTECTIE } from './convocatoareMasa.js'
import { reincarcaConvocator } from './docx.js'
import { rezervaNumarConvocare } from './convocatorNeexpediat.js'

// ── date de test (TEST-RAZVAN, fictive) ────────────────────────────────────
const PROIECT = { id: 'pr1', cod: 'TEST-RAZVAN', denumire: 'Test', contract_nr: '12', contract_data: '2026-10-01', imputernicire_nr: '7', imputernicire_data: '2026-10-20',
  contact_nume: 'Ion Test', contact_telefon: '0700000002', contact_email: 'test@exemplu.local', text_gdpr: 'Operator: Transgaz. Scop: convocare. Drepturi: acces.',
  reprezentant_tgz_nume: 'R. TGZ', reprezentant_tgz_telefon: '0700000001' }
const UAT = { id: 'u1', nume: 'Testeni', uat3: 'TST', sesiune_zi1: '2026-12-01', program_zi1: '09-15' }
const contact = (id, extra = {}) => ({ detinator_id: id, adresa_strada: 'Str. A 1', adresa_sat: 'Testeni', adresa_comuna: 'Testeni', adresa_judet: 'Mehedinți', cod_postal: '200000', adresa_cunoscuta: true, ...extra })
const idx = (i) => String(i).padStart(4, '0')

function date(n = 3) {
  const view = [], det = [], parc = [], cont = [], tok = []
  for (let i = 1; i <= n; i++) {
    const d = `d${idx(i)}`, p = `p${idx(i)}`, idp = `TST-${idx(i)}`
    view.push({ parcela_id: p, detinator_id: d, proiect_id: 'pr1', uat_id: 'u1', uat3: 'TST', id_parcela: idp, tronson: 1, nume: `POPESCU ${idx(i)}`, calitate: 'proprietar', adresa_cunoscuta: true })
    det.push({ id: d, parcela_id: p, nume: `POPESCU ${idx(i)}`, calitate: 'proprietar', sters_la: null })
    parc.push({ id: p, proiect_id: 'pr1', id_parcela: idp, uat_id: 'u1', tronson: 1, sters_la: null })
    cont.push(contact(d))
    tok.push({ detinator_id: d, token_raspuns: `tok${i}` })
  }
  return { red_v_stare_parcela: view, red_detinatori: det, red_parcele: parc, red_detinatori_contact: cont, red_detinatori_token: tok, red_convocari: [],
    red_proiecte: [{ ...PROIECT }], red_uat: [{ ...UAT }] }
}
const conv = (o) => ({ canal: 'posta', stare: 'activ', data_expediere: null, fisier_convocator_path: null, sters_la: null, created_at: '2026-11-01', ...o })

// client fals: query builder cu keyset real (order / gt / limit), maybeSingle, insert / update, rpc, storage.
// fn_red_convocare_rezerva simulat ca migrarea 20261130l: P0002 (șters), RD002 (împuternicire lipsă, recitită din tabelă), RD001 (convocare
// activă neexpediată, inclusiv fără număr), 55P03 (UAT ocupat), apoi număr + INSERT; o eroare NU consumă număr (tranzacția se anulează).
// cuRpc: false = PGRST202 (migrarea neaplicată).
function clientFals(tabele, { rpcEsueazaLa = [], uploadEsueaza = new Set(), cuRpc = true, capPagina = Infinity, inainteDeRezervare, uatOcupat = false, inainteDeCitire, informarePublicata = true } = {}) {
  const jurnal = { rpc: [], numere: 0, apeluriRezerva: 0, inserturi: [], updateuri: [], upload: [], download: [] }
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
      then(res, rej) { return Promise.resolve(op === 'select' && maybe ? inainteDeCitire?.(tab) : null).then(() => exec()).then(res, rej) },
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
  const err = (code, message) => ({ data: null, error: { code, message }, status: 400 })
  return {
    jurnal, tabele,
    from: builder,
    rpc: async (fn, args) => {
      // #939 r2: indicatorul „informare publicată” (fn_red_informare_publicata) — citire, nu intră în jurnalul rezervărilor
      if (fn === 'fn_red_informare_publicata') { jurnal.informare = (jurnal.informare || 0) + 1; return { data: informarePublicata === true, error: null } }
      jurnal.rpc.push(fn)
      if (fn !== 'fn_red_convocare_rezerva') throw new Error(`RPC neașteptat în generarea în masă: ${fn}`)   // fără cale alternativă
      jurnal.argumente = [...(jurnal.argumente || []), args]
      if (!cuRpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }
      if (!args.p_detinator_id) return err('22023', 'redari: parametri lipsa')
      jurnal.apeluriRezerva++
      await inainteDeRezervare?.(args.p_detinator_id)
      const d = tabele.red_detinatori.find(x => x.id === args.p_detinator_id)
      const p = d && tabele.red_parcele.find(x => x.id === d.parcela_id)
      if (!d || d.sters_la || !p || p.sters_la) return err('P0002', 'redari: detinatorul sau parcela au fost sterse')
      if (!tabele.red_proiecte[0]?.imputernicire_nr) return err('RD002', 'redari: convocatorul nu se poate rezerva: proiect fara nr./data imputernicire Transgaz')
      const canal = args.p_canal ?? 'posta'
      const exista = tabele.red_convocari.filter(c => c.detinator_id === d.id && c.canal === canal && c.stare === 'activ' && !c.data_expediere && !c.sters_la)
      if (exista.length && args.p_numar_nou_confirmat !== true) return err('RD001', `redari: detinatorul are deja convocare postala neexpediata (${exista.map(c => c.nr_document ?? '(fara numar)').join(', ')})`)
      if (uatOcupat) return err('55P03', 'redari: o plicuire / expediere ... e în curs în acest UAT; reîncercați')
      if (rpcEsueazaLa.includes(jurnal.apeluriRezerva)) return err('XX000', 'rpc picat')
      jurnal.numere++
      const r = conv({ id: `c${++contor}`, detinator_id: d.id, canal, nr_document: `C-${idx(jurnal.numere)}`, created_at: '2026-11-04' })
      tabele.red_convocari.push(r); jurnal.inserturi.push(r)
      return { data: [{ convocare_id: r.id, nr_document: r.nr_document, parcela_id: p.id, uat_id: p.uat_id, proiect_id: p.proiect_id }], error: null, status: 200 }
    },
    storage: { from: () => ({
      upload: async (path) => { jurnal.upload.push(path); return uploadEsueaza.has(path) ? { error: { message: 'storage picat' } } : { error: null } },
      download: async (path) => { jurnal.download.push(path); return { data: new Blob([`vechi:${path}`]), error: null } },
      list: async () => ({ data: [], error: null }),
    }) },
  }
}

const genFals = vi.fn(async ({ nrDocument }) => ({ blob: new Blob([`doc:${nrDocument}`]), hash: 'h'.repeat(64) }))
const depsReale = { genereaza: genFals, reincarca: reincarcaConvocator }
const TPL = new ArrayBuffer(8)
const ruleaza = async (c, opt = {}) => {
  const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
  const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale, ...opt })
  return { ...p, ...r }
}
const activeNeexp = (t, d) => t.red_convocari.filter(c => c.detinator_id === d && c.stare === 'activ' && !c.data_expediere && !c.sters_la)

describe('pregatesteLot — gărzi', () => {
  it('#939 r2: informarea nepublicată pe server (fn_red_informare_publicata = false) → niciun rând nou, nicio rezervare; indicatorul se cere serverului', async () => {
    const c = clientFals(date(), { informarePublicata: false })
    const rez = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    expect(c.jurnal.informare).toBeGreaterThan(0)
    expect(rez.plan.filter(p => p.actiune === 'nou')).toEqual([])
    expect(rez.exclusi.length).toBeGreaterThan(0)
    expect(rez.exclusi.every(x => /informarea GDPR de pe verso nu e publicată/.test(x.motiv))).toBe(true)
    expect(c.jurnal.apeluriRezerva).toBe(0)
  })
  it('r7: proiect fără împuternicire → generarea nouă blocată (motiv), niciun nou în plan, nicio rezervare', async () => {
    const c = clientFals(date())
    const rez = await pregatesteLot(c, { proiect: { ...PROIECT, imputernicire_nr: '' }, uat: UAT })
    expect(rez.blocat).toBeNull()
    expect(rez.blocatGenerare).toMatch(/împuternicire/)
    expect(rez.plan).toEqual([])
    expect(rez.exclusi.every(x => /împuternicire/.test(x.motiv))).toBe(true)
    expect(c.jurnal.apeluriRezerva).toBe(0)
  })
  it('r7: UAT fără zi de sesiune cu program → generarea nouă blocată', async () => {
    const rez = await pregatesteLot(clientFals(date()), { proiect: PROIECT, uat: { ...UAT, program_zi1: '' } })
    expect(rez.blocatGenerare).toMatch(/zi de sesiune/)
  })
  it('r7 (Copilot r2 P2-01): contact incomplet → „reia” (fișier arhivat) merge; nou și regenerarea blocate', async () => {
    const t = date(3)
    t.red_convocari = [conv({ id: 'cv1', detinator_id: 'd0001', nr_document: 'C-0011', fisier_convocator_path: 'a/C-0011-v1.docx' }),
      conv({ id: 'cv2', detinator_id: 'd0002', nr_document: 'C-0012' })]
    const fara = { ...PROIECT, contact_telefon: '' }
    t.red_proiecte = [{ ...fara }]
    const c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: fara, uat: UAT })
    expect(p.blocatGenerare).toMatch(/contact/)
    expect(p.plan.map(x => [x.rand.detinator_id, x.actiune])).toEqual([['d0001', 'reia']])
    expect(p.exclusi.map(x => x.rand.detinator_id)).toEqual(['d0002', 'd0003'])
    const r = await executaLot(c, { plan: p.plan, proiect: fara, uat: UAT, templateArrayBuffer: TPL, protectie: true, includeGenerate: true, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['ok'])
    expect(c.jurnal.download).toEqual(['a/C-0011-v1.docx']); expect(c.jurnal.apeluriRezerva).toBe(0)
  })
  it('r3 (fără fallback): migrarea 20261130l neaplicată (PGRST202) → lot blocat, nicio citire de date', async () => {
    const c = clientFals(date(), { cuRpc: false })
    const spy = vi.spyOn(c, 'from')
    const rez = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    expect(rez).toMatchObject({ blocat: MESAJ_FARA_PROTECTIE, plan: [], protectie: false })
    expect(rez.blocat).toMatch(/aplicați migrarea 20261130l/)
    expect(spy).not.toHaveBeenCalled()
  })
  it('detectează RPC-ul de rezervare (22023 = există; PGRST202 = lipsă)', async () => {
    expect(await detecteazaRezervare(clientFals(date(), { cuRpc: true }))).toBe(true)
    expect(await detecteazaRezervare(clientFals(date(), { cuRpc: false }))).toBe(false)
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
  it('P2 (L23): serverul plafonează pagina la 7 rânduri → keyset citește tot UAT-ul', async () => {
    const rez = await pregatesteLot(clientFals(date(25), { capPagina: 7 }), { proiect: PROIECT, uat: UAT })
    expect(rez.plan).toHaveLength(25)
  })
  it('P2 (L24): esteCurent fals oprește citirile', async () => {
    await expect(pregatesteLot(clientFals(date(3)), { proiect: PROIECT, uat: UAT, esteCurent: () => false })).rejects.toThrow(/abandonat/)
  })
})

describe('executaLot', () => {
  it('reia descarcă (0 numere); reîncarcă păstrează numărul și data; nou = rezervare atomică + upload v1; doar RPC-ul atomic', async () => {
    const t = date(3)
    t.red_convocari = [
      conv({ id: 'cv1', detinator_id: 'd0001', nr_document: 'C-0011', fisier_convocator_path: 'TEST-RAZVAN/TST/TST-0001/C-0011-v1.docx' }),
      conv({ id: 'cv2', detinator_id: 'd0002', nr_document: 'C-0012', created_at: '2026-11-02' }),
    ]
    const c = clientFals(t); genFals.mockClear()
    const r = await ruleaza(c, { includeGenerate: true })
    expect(c.jurnal.numere).toBe(1)
    expect([...new Set(c.jurnal.rpc)]).toEqual(['fn_red_convocare_rezerva'])
    expect(c.jurnal.download).toEqual(['TEST-RAZVAN/TST/TST-0001/C-0011-v1.docx'])
    expect(genFals).toHaveBeenCalledWith(expect.objectContaining({ nrDocument: 'C-0012', dataDocument: '2026-11-02' }))
    expect(c.jurnal.upload).toEqual(['TEST-RAZVAN/TST/TST-0002/C-0012-v1.docx', 'TEST-RAZVAN/TST/TST-0003/C-0001-v1.docx'])
    expect(activeNeexp(t, 'd0003').map(x => x.fisier_convocator_path)).toEqual(['TEST-RAZVAN/TST/TST-0003/C-0001-v1.docx'])
    expect(r.fisiere.map(f => f.nume)).toEqual(['C-0011_TST-0001.docx', 'C-0012_TST-0002.docx', 'C-0001_TST-0003.docx'])
    expect(sumar(r.raport, r.exclusi)).toMatchObject({ nou: 1, reia: 1, reincarca: 1, erori: 0 })
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

  it('r3 (fără fallback): executaLot cu protectie !== true refuză înainte de orice apel', async () => {
    const c = clientFals(date(2))
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const n0 = c.jurnal.rpc.length
    await expect(executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: false, deps: depsReale })).rejects.toThrow(/20261130l/)
    await expect(executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, deps: depsReale })).rejects.toThrow(/20261130l/)
    expect(c.jurnal.rpc.length).toBe(n0)
  })
  it('r3 (fără fallback): RPC dispărut în timpul rulării (PGRST202) → rândul cu eroare, restul oprite, niciun număr pe altă cale', async () => {
    const c = clientFals(date(3), { cuRpc: false })
    const p = await pregatesteLot(clientFals(date(3)), { proiect: PROIECT, uat: UAT })
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['eroare', 'oprit', 'oprit'])
    expect(r.raport[0].motiv).toBe(MESAJ_FARA_PROTECTIE)
    expect(r.raport[2].motiv).toMatch(/20261130l/)
    expect(c.jurnal.numere).toBe(0); expect(r.fisiere).toEqual([])
  })

  it('P1-1: alt tab a generat între timp (RPC întoarce RD001) → „schimbat”, fără număr consumat, o singură convocare', async () => {
    const t = date(2)
    const c = clientFals(t, { inainteDeRezervare: (d) => { if (d === 'd0001' && !activeNeexp(t, d).length) t.red_convocari.push(conv({ id: 'altTab', detinator_id: d, nr_document: 'C-0900' })) } })
    const r = await ruleaza(c)
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'ok'])
    expect(r.raport[0].motiv).toMatch(/C-0900/)
    expect(activeNeexp(t, 'd0001')).toHaveLength(1)
    expect(c.jurnal.numere).toBe(1)
  })
  it('RPC: P0002 (șters sub lock) și RD002 → „schimbat”; 55P03 (UAT ocupat) → eroare; niciun număr', async () => {
    const t = date(2)
    const c = clientFals(t, { inainteDeRezervare: (d) => { if (d === 'd0001') t.red_detinatori[0].sters_la = '2026-11-05' } })
    const r = await ruleaza(c)
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'ok'])
    expect(r.raport[0].motiv).toMatch(/sterse/)
    const t2 = date(1), c2 = clientFals(t2, { uatOcupat: true })
    const r2 = await ruleaza(c2)
    expect(r2.raport[0]).toMatchObject({ stare: 'eroare' }); expect(r2.raport[0].motiv).toMatch(/UAT/)
    expect(c2.jurnal.numere).toBe(0)
  })

  it('r3 P1-2: împuternicirea retrasă în BD după „Verifică” (argumentul rămâne vechi) → „schimbat”, fără RPC', async () => {
    const t = date(2), c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_proiecte[0].imputernicire_nr = null
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'schimbat'])
    expect(r.raport[0].motiv).toMatch(/proiectul sau UAT-ul/)
    expect(c.jurnal.apeluriRezerva).toBe(0)
  })
  it('r3 P1-2: sesiunea UAT scoasă în BD → „schimbat”; generarea folosește proiectul / UAT-ul recitite', async () => {
    const t = date(2), c = clientFals(t); genFals.mockClear()
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_uat[0].program_zi1 = ''
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'schimbat'])
    t.red_uat[0].program_zi1 = '09-15'
    const r2 = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(sumar(r2.raport)).toMatchObject({ nou: 2 })
    expect(genFals.mock.calls[0][0].uat).not.toBe(UAT)                // obiectul recitit, nu cel din UI
    expect(genFals.mock.calls[0][0].uat).toEqual(UAT)
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
    p.plan[0].detinator = { ...p.plan[0].detinator, nume: 'DIN PLAN' }
    await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: p.protectie, deps: depsReale })
    expect(genFals.mock.calls[0][0].detinator.nume).toBe('POPESCU 0001')
  })
  it('r3 P2-8: recitirea convocărilor e completă (60 expediate + 1 fără fișier → „reîncărcat”, nu „schimbat” din trunchiere)', async () => {
    const t = date(1)
    for (let i = 0; i < 60; i++) t.red_convocari.push(conv({ id: `e${idx(i)}`, detinator_id: 'd0001', nr_document: `E-${idx(i)}`, data_expediere: '2026-10-01', fisier_convocator_path: 'x' }))
    t.red_convocari.push(conv({ id: 'zz', detinator_id: 'd0001', nr_document: 'C-0500' }))
    const c = clientFals(t, { capPagina: 7 })
    const r = await ruleaza(c)
    expect(r.raport.map(x => [x.actiune, x.stare])).toEqual([['reincarca', 'ok']])
  })

  it('a doua rulare pe același UAT nu mai consumă numere', async () => {
    const t = date(3), c = clientFals(t)
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

  it('rezervare picată pe un rând → eroare pe rând (fără număr), restul merg', async () => {
    const c = clientFals(date(3), { rpcEsueazaLa: [2] })
    const r = await ruleaza(c)
    expect(r.raport.map(x => x.stare)).toEqual(['ok', 'eroare', 'ok'])
    expect(r.raport[1].motiv).toMatch(/rpc picat/)
    expect(r.fisiere).toHaveLength(2); expect(c.jurnal.numere).toBe(2)
  })

  it('oprirea și generația depășită (esteCurent fals) opresc rândurile rămase', async () => {
    const c = clientFals(date(4))
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    let stop = false
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale, esteOprit: () => stop,
      onProgres: ({ i }) => { if (i === 2) stop = true } })
    expect(r.raport.map(x => x.stare)).toEqual(['ok', 'ok', 'oprit', 'oprit'])
    expect(c.jurnal.numere).toBe(2)
    let curent = true
    const c2 = clientFals(date(3))
    const p2 = await pregatesteLot(c2, { proiect: PROIECT, uat: UAT })
    const r2 = await executaLot(c2, { plan: p2.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale, esteCurent: () => curent,
      onProgres: () => { curent = false } })
    // generația s-a schimbat în timpul rândului 1: recitirea lui se abandonează ÎNAINTE de rezervare (niciun număr), restul oprite
    expect(r2.raport.map(x => x.stare)).toEqual(['eroare', 'oprit', 'oprit'])
    expect(r2.raport[0].motiv).toMatch(/abandonat/)
    expect(c2.jurnal.numere).toBe(0)
  })

  it('proiectul argument fără împuternicire → rândurile noi „schimbat” (generare blocată), nicio rezervare', async () => {
    const c = clientFals(date(2))
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const r = await executaLot(c, { plan: p.plan, proiect: { ...PROIECT, imputernicire_data: null }, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'schimbat'])
    expect(r.raport[0].motiv).toMatch(/împuternicire/)
    expect(c.jurnal.apeluriRezerva).toBe(0)
  })
})

describe('r4: protocolul comun cale individuală / lot', () => {
  it('lotul cheamă rezervaNumarConvocare (RPC atomic, canal poștă, fără confirmare)', async () => {
    const c = clientFals(date(2))
    await ruleaza(c)
    expect(c.jurnal.argumente.filter(a => a.p_detinator_id)).toEqual([
      { p_detinator_id: 'd0001', p_numar_nou_confirmat: false, p_canal: 'posta' },
      { p_detinator_id: 'd0002', p_numar_nou_confirmat: false, p_canal: 'posta' }])
  })
  it('individual (ModalConvocator → rezervaNumarConvocare) după „Verifică” al lotului, pe același deținător → lotul primește RD001: o singură convocare', async () => {
    const t = date(1), c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    // calea individuală rezervă prin ACELAȘI RPC (fără bifă) între „Verifică” și execuția lotului — rândul apare doar în RPC
    const ind = await rezervaNumarConvocare(c, { detinatorId: 'd0001', confirmat: false, canal: 'posta' })
    expect(ind.nrDocument).toBe('C-0001')
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.raport[0].stare).toBe('schimbat')
    expect(activeNeexp(t, 'd0001')).toHaveLength(1); expect(c.jurnal.numere).toBe(1)
    // invers: după lot, individualul fără bifă e refuzat; cu bifa explicită primește al doilea număr
    await expect(rezervaNumarConvocare(c, { detinatorId: 'd0001' })).rejects.toMatchObject({ code: 'RD001' })
    expect((await rezervaNumarConvocare(c, { detinatorId: 'd0001', confirmat: true })).nrDocument).toBe('C-0002')
  })
  it('fără migrare, și calea individuală refuză cu același mesaj', async () => {
    await expect(rezervaNumarConvocare(clientFals(date(1), { cuRpc: false }), { detinatorId: 'd0001' }))
      .rejects.toMatchObject({ code: 'FARA_RPC', message: MESAJ_FARA_PROTECTIE })
  })
  it('r4 P2: răspuns proiect/UAT întârziat + identitate schimbată între timp → zero rezervări', async () => {
    let curent = true
    const t = date(3)
    const c = clientFals(t, { inainteDeCitire: async (tab) => { if (tab === 'red_proiecte') { await new Promise(r => setTimeout(r, 5)); curent = false } } })
    const p = await pregatesteLot(clientFals(date(3)), { proiect: PROIECT, uat: UAT })
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale, esteCurent: () => curent })
    expect(c.jurnal.apeluriRezerva).toBe(0); expect(c.jurnal.numere).toBe(0)
    expect(r.raport.map(x => x.stare)).toEqual(['oprit', 'oprit', 'oprit'])
  })
})

describe('r5 (Copilot #989)', () => {
  it('P1-01: deținătorul mutat pe altă parcelă după „Verifică” → zero documente, zero rezervări', async () => {
    const t = date(2), c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_detinatori[0].parcela_id = 'p0002'
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'ok'])
    expect(r.fisiere.map(f => f.nume)).toEqual(['C-0001_TST-0002.docx'])
    expect(c.jurnal.upload.every(u => !u.includes('TST-0001'))).toBe(true)
  })
  it('P1-01: parcela mutată în alt UAT / categorie schimbată → „schimbat” (amprenta include uat_id / categoria_folosinta)', async () => {
    const t = date(2), c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_parcele[0].categoria_folosinta = 'pasune'
    t.red_parcele[1].uat_id = 'u2'
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'schimbat'])
    expect(c.jurnal.apeluriRezerva).toBe(0)
  })
  it('P1-01: serverul a rezervat pe altă parcelă / UAT (mutare între recitire și RPC) → niciun document, convocarea rămâne „fișier neîncărcat”', async () => {
    const t = date(1)
    const c = clientFals(t, { inainteDeRezervare: () => { t.red_parcele[0].uat_id = 'u9' } })
    genFals.mockClear()
    const r = await ruleaza(c)
    expect(r.raport[0]).toMatchObject({ stare: 'eroare', nrDocument: 'C-0001' })
    expect(r.raport[0].motiv).toMatch(/altă parcelă \/ UAT.*fișier neîncărcat/)
    expect(genFals).not.toHaveBeenCalled(); expect(c.jurnal.upload).toEqual([]); expect(r.fisiere).toEqual([])
    expect(activeNeexp(t, 'd0001').map(x => x.fisier_convocator_path)).toEqual([null])
  })
  it('P2-01: regenerarea în masă folosește data civilă București (2026-11-03T22:30:00Z → 2026-11-04)', async () => {
    const t = date(1)
    t.red_convocari = [conv({ id: 'cv1', detinator_id: 'd0001', nr_document: 'C-0050', created_at: '2026-11-03T22:30:00Z' })]
    const c = clientFals(t); genFals.mockClear()
    const r = await ruleaza(c)
    expect(r.raport[0]).toMatchObject({ actiune: 'reincarca', stare: 'ok' })
    expect(genFals.mock.calls[0][0].dataDocument).toBe('2026-11-04')
  })
  it('P2-02: „reia” recitește eligibilitatea — convocarea expediată după „Verifică” nu mai intră în zip / borderou', async () => {
    const t = date(2)
    t.red_convocari = [conv({ id: 'cv1', detinator_id: 'd0001', nr_document: 'C-0011', fisier_convocator_path: 'a/C-0011-v1.docx' }),
      conv({ id: 'cv2', detinator_id: 'd0002', nr_document: 'C-0012', fisier_convocator_path: 'a/C-0012-v1.docx' })]
    const c = clientFals(t)
    const p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_convocari[0].data_expediere = '2026-11-05'
    t.red_convocari[1].fisier_convocator_path = 'a/C-0012-v2.docx'
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, includeGenerate: true, deps: depsReale })
    expect(r.raport.map(x => x.stare)).toEqual(['schimbat', 'schimbat'])
    expect(c.jurnal.download).toEqual([]); expect(r.fisiere).toEqual([])
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

describe('PR3a — utilizatori / arendasi', () => {
  it.each(['utilizator', 'arendas'])('%s neaprobat: exclus separat din UAT, proprietarii se rezerva normal', async calitate => {
    const t = date(3)
    t.red_detinatori[1].calitate = calitate
    t.red_v_stare_parcela[1].calitate = calitate
    const c = clientFals(t), r = await ruleaza(c)
    expect(r.exclusi.map(x => [x.rand.detinator_id, x.motiv])).toEqual([['d0002', 'utilizator - convocare neaprobata']])
    expect(r.raport.filter(x => x.stare === 'ok')).toHaveLength(2)
    expect(c.jurnal.numere).toBe(2)
    expect(c.jurnal.inserturi.map(x => x.detinator_id)).toEqual(['d0001', 'd0003'])
  })
  it('nu reia nici documentul arhivat al utilizatorului neaprobat', async () => {
    const t = date(1); t.red_detinatori[0].calitate = 'utilizator'
    t.red_convocari = [conv({ id: 'cv1', detinator_id: 'd0001', fisier_convocator_path: 'fictiv.docx' })]
    const r = await ruleaza(clientFals(t))
    expect(r.plan).toEqual([])
    expect(r.exclusi[0].motiv).toBe('utilizator - convocare neaprobata')
    expect(r.fisiere).toEqual([])
  })
  it('refuzul serverului RD006 dupa planificare se raporteaza fara numar, upload sau fallback', async () => {
    const c = clientFals(date(1)), p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    const rpcVechi = c.rpc
    c.rpc = async (fn, args) => fn === 'fn_red_convocare_rezerva' && args.p_detinator_id
      ? { data: null, error: { code: 'RD006', message: 'utilizator - convocare neaprobata' } }
      : rpcVechi(fn, args)
    const genereaza = vi.fn(), reincarca = vi.fn()
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: { genereaza, reincarca } })
    expect(r.raport[0]).toMatchObject({ stare: 'schimbat', motiv: 'schimbat între timp: utilizator - convocare neaprobata' })
    expect(c.jurnal.numere).toBe(0)
    expect(c.jurnal.upload).toEqual([])
    expect(genereaza).not.toHaveBeenCalled()
    expect(reincarca).not.toHaveBeenCalled()
  })
  it('plan vechi: schimbarea calitatii opreste generarea la recitire', async () => {
    const t = date(1), c = clientFals(t), p = await pregatesteLot(c, { proiect: PROIECT, uat: UAT })
    t.red_detinatori[0].calitate = 'arendas'
    const r = await executaLot(c, { plan: p.plan, proiect: PROIECT, uat: UAT, templateArrayBuffer: TPL, protectie: true, deps: depsReale })
    expect(r.raport[0]).toMatchObject({ stare: 'schimbat', motiv: 'utilizator - convocare neaprobata' })
    expect(c.jurnal.numere).toBe(0)
  })
})

describe('PR3a — separarea portii de sablonul PR3b', () => {
  it('aprobarea owner-ului nu permite folosirea sablonului proprietarului pentru utilizator', async () => {
    const t = date(1); t.red_detinatori[0].calitate = 'utilizator'
    t.red_proiecte[0].convocare_utilizatori_aprobata = true
    const c = clientFals(t)
    const r = await pregatesteLot(c, { proiect: { ...PROIECT, convocare_utilizatori_aprobata: true }, uat: UAT })
    expect(r.plan).toEqual([])
    expect(r.exclusi[0].motiv).toBe('utilizator - șablonul convocatorului lipsește (PR3b)')
    expect(c.jurnal.numere).toBe(0)
  })
})
