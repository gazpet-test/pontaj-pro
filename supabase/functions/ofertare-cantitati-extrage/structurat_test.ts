import { assert, assertEquals } from 'jsr:@std/assert@1'
import { aplicaDecizii, type DepsStructurat, EXTRACTOR_ID, extractorCuContext, extrageStructurat, radacinaParte, sumaRezervata, TIPURI_ELIGIBILE } from './structurat.ts'
import { feliiCuPozitie, FELIE, SUPRAPUNERE } from './sectiuni.ts'
import { sha256Hex } from '../_shared/cantNormalizare.ts'
import { numarPagini, paginiInterval } from '../_shared/cantMasura.ts'

const TEXT_F3 = 'Formularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. Platanului\n= NR. SIMBOL ART. CANTITATE UM =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC ... DISTRIBUTIE D= 90 MM\n0.000 0 Total=\n'
const RAND = [null, null, null, 'SA11G1', 'TEAVA PVC ... DISTRIBUTIE D= 90 MM', 'Str. Platanului', 'PVC', 'D= 90 MM', null, 'M', '1160.000', 0, 0,
  'conducta', 'lungime', '003 SA11G1 [ 2] M 1160.000']
const ACUM = new Date(Date.now() + 3600e3).toISOString()
const DOC = { id: 212, nume_original: 'Liste de cantitati — p01_pag1-104.pdf', tip: 'lista_cantitati', text_extras: TEXT_F3, seap_meta: null, lot_stare: 'comun' }

type Opt = { cerere?: any; refuzRezerva?: string; aiEroare?: boolean; aiAruncă?: boolean; cache?: boolean; pesteRezervare?: boolean
  inLucru?: number | null; inLucruCerere?: number; docsDupa?: any[]; grupSchimbat?: boolean; refuzGrup?: string; decizii?: any[]; ultima?: any; feliiExistente?: boolean; raspuns?: string; docs?: any[]; nevalide?: number[]
  cereri?: Record<number, any>; feliiGata?: { gata: number; total: number }; refuzInchide?: string
  // TKT-0329 A (PR-extragere): fotografia surselor (plafonul) și RPC-urile comparației, simulate; docsFoto = documente DOAR în fotografie
  // (apărute între citirea documentelor și fotografie); eligibilitate = răspunsul deps.eligibilitateDocumente (lipsă = toate true)
  plafon?: number; cacheIds?: number[]; fotoLipsa?: boolean; docsFoto?: any[]; eligibilitate?: Map<number, boolean> | null }
// fotografia falsă a licitației: toate documentele rulării, cu paginile din marcaje; fără extrageri gata (comparația nu are felii de verificat)
async function fotoFalsa(docs: any[], plafon: number) {
  const documente = []
  for (const d of docs) documente.push({ id: d.id, tip: d.tip, nume_original: d.nume_original, revizie: '-', sha: await sha256Hex(d.text_extras ?? ''), pagini: numarPagini(d.text_extras),
    pagini_necitite: [], lot_stare: d.lot_stare, extragere_id: null, extractor_id: null, felii_distincte: 0, felii_sha: null, obs_sha: null, decizii_sha: 'd' })
  return { licitatie_id: 15, documente, document_loturi_sha: 'l', stare_loturi: 'fara_loturi', cantitati_sha: 'c', prag: 0.05, plafon, v: 'surse_v1', sha: 'sha-foto' }
}
function fals(opt: Opt = {}) {
  const apeluri: string[] = []
  const apeluriMasuratori: { fn: string; args: Record<string, unknown> }[] = []
  let obsScrise: any[] = []
  const toateObs: any[][] = []
  let aiApeluri = 0
  const argsGrup: any[] = []
  let nDoc = 0
  const extractori: string[] = []
  const deps: DepsStructurat = {
    rpc: async (fn, args) => {
      if (fn === 'fn_ofertare_cb_text_valid') return { data: (opt.nevalide || []).includes(Number(args.p_document_id)) ? {} : { tip: 'prov', id: 1 }, error: null }
      // RPC-urile comparației (20270112a) — separate de apelurile de muncă, ca listele `apeluri` din probele vechi să rămână exacte
      if (fn.startsWith('fn_ofertare_semnale_') || fn === 'fn_ofertare_masuratori_propune') {
        apeluriMasuratori.push({ fn, args })
        if (fn === 'fn_ofertare_semnale_fotografie') return opt.fotoLipsa ? { data: null, error: { message: 'PGRST202: funcția nu există' } } : { data: await fotoFalsa([...(opt.docs ?? [DOC]), ...(opt.docsFoto ?? [])], opt.plafon ?? 200), error: null }
        if (fn === 'fn_ofertare_masuratori_propune') return { data: { evaluare_id: 11, semnale: [], ignorate: [] }, error: null }
        if (fn === 'fn_ofertare_semnale_publica') return { data: { evaluare_id: 11, semnale: [], n: 0 }, error: null }
        return { data: [], error: null }
      }
      apeluri.push(fn.replace('fn_ofertare_cb_', '') + (fn.endsWith('inchide') ? ':' + args.p_stare : ''))
      switch (fn) {
        case 'fn_ofertare_cb_extragere_incepe_grup':
          argsGrup.push(args)
          if (opt.grupSchimbat) return { data: { refuz: 'grup_schimbat' }, error: null }
          if (opt.refuzGrup) return { data: { refuz: opt.refuzGrup }, error: null }
          extractori.push(String(args.p_extractor_id))
          if (opt.cache || (opt.cacheIds ?? []).includes(Number(args.p_document_id))) return { data: { ok: true, cache: true, extragere_id: 7 }, error: null }
          if (opt.inLucru !== undefined) return { data: { refuz: 'extragere_in_lucru' }, error: null }
          return { data: { ok: true, cache: false, extragere_id: 7 }, error: null }
        case 'fn_ofertare_cb_felie_incepe':
          return opt.feliiExistente ? { data: { refuz: 'munca_existenta', munca_id: 'm' + args.p_felie_nr }, error: null }
            : { data: { ok: true, felie_id: 70 + Number(args.p_felie_nr) }, error: null }
        case 'fn_ofertare_cb_rezerva': return { data: opt.refuzRezerva ? { refuz: opt.refuzRezerva } : { ok: true, rezervare_id: 900 }, error: null }
        case 'fn_ofertare_cb_deconteaza': return { data: { ok: true, peste_rezervare: !!opt.pesteRezervare }, error: null }
        case 'fn_ofertare_cb_extragere_inchide': return { data: opt.refuzInchide ? { refuz: opt.refuzInchide } : { ok: true }, error: null }
        case 'fn_ofertare_cb_obs_scrie': obsScrise = args.p_obs as any[]; toateObs.push(obsScrise); return { data: { ok: true }, error: null }
        default: return { data: { ok: true }, error: null }
      }
    },
    cerere: async (id: number) => opt.cereri && id in opt.cereri ? opt.cereri[id] : opt.cerere === undefined
      ? { id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] } : opt.cerere,
    documente: async () => { nDoc++; return nDoc > 1 && opt.docsDupa ? opt.docsDupa : (opt.docs ?? [DOC]) },
    deciziiRol: async () => opt.decizii ?? [],
    lotDocument: async (_l, ids) => new Map(ids.map((i) => [i, { domeniu: 'toate' as const, loturi: [] }])),
    extragereInLucru: async () => (opt.inLucru ? { id: opt.inLucru, cerere_id: opt.inLucruCerere ?? 5 } : null),
    ultimaIncercare: async () => opt.ultima ?? null,
    feliiGata: async () => opt.feliiGata ?? null,
    ai: async () => {
      aiApeluri++
      if (opt.aiAruncă) throw new TypeError('fetch failed')
      return opt.aiEroare ? { txt: '', inF: 0, outF: 0, eroare: 'timeout' } : { txt: opt.raspuns ?? JSON.stringify({ r: [RAND] }), inF: 1000, outF: 200 }
    },
    acum: () => 0,
    eligibilitateDocumente: async (_l, ids) => { eligibilitateCeruta.push(ids); return opt.eligibilitate === undefined ? new Map(ids.map((i) => [i, true])) : opt.eligibilitate },
  }
  const eligibilitateCeruta: number[][] = []
  return { deps, apeluri, apeluriMasuratori, eligibilitateCeruta, obs: () => obsScrise, prima: () => toateObs[0] || [], ai: () => aiApeluri, extractori, argsGrup }
}
const RULEAZA = (f: ReturnType<typeof fals>) => extrageStructurat(f.deps, { licitatie_id: 15, cerere_id: 5 })

// ─── TKT-0329 A, PR-extragere (Task 7): plafonul înaintea procesării, tipul `formular`, comparația după bucla documentelor ───
const paginaF3 = (n: number, umplutura = '') => `⟦PAGINA ${n}⟧\n003 SA11G1 [ 2] M 1160.000\nTEAVA PVC D= 90 MM${umplutura}\n0.000 0 Total=\n`
const docPagini = (id: number, pagini: number, umplutura = '', tip = 'lista_cantitati') =>
  ({ id, nume_original: `Lista ${id}.pdf`, tip, text_extras: 'Formularul F3\nLista cu cantitatile de lucrari\n' + Array.from({ length: pagini }, (_, i) => paginaF3(i + 1, umplutura)).join(''), seap_meta: null, lot_stare: 'comun' })
const fnM = (f: ReturnType<typeof fals>, nume: string) => f.apeluriMasuratori.filter((a) => a.fn === nume)

Deno.test('m_fara_ai: comparația rulează după bucla documentelor cu ZERO apeluri AI în plus; răspunsul poartă masuratori, plafon, peste_plafon', async () => {
  const f = fals()
  const r = await RULEAZA(f)
  assertEquals([f.ai(), r.status], [1, 200])
  // fotografia o dată pentru plafon (înaintea buclei) + o dată în comparație (după extragere); apoi propune → publică
  assertEquals(f.apeluriMasuratori.map((a) => a.fn), ['fn_ofertare_semnale_fotografie', 'fn_ofertare_semnale_fotografie', 'fn_ofertare_masuratori_propune', 'fn_ofertare_semnale_publica'])
  const b = r.body as any
  assertEquals([b.masuratori.ok, b.masuratori.evaluare_id, b.plafon, b.peste_plafon], [true, 11, { plafon: 200, plafon_atins: false }, []])
  // apelurile de muncă sunt EXACT cele de dinainte (drumul normal) — pasul nou nu schimbă extragerea
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
})

Deno.test('comparația rulează și la `oprit` (rezervare refuzată / plafon de bani), cu documentele neterminate în documente_necitite (starea din rulare)', async () => {
  const f = fals({ refuzRezerva: 'plafon' })
  const r = await RULEAZA(f)
  assertEquals(r.body.oprit, 'rezervare:plafon')
  assertEquals(fnM(f, 'fn_ofertare_masuratori_propune').length, 1)
  const p = fnM(f, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  assertEquals([p.documente_necitite, p.documente_necitite_stare], [[212], [{ document_id: 212, stare: 'esuat' }]])
  // oprit pe timp: extragerea rămâne în lucru → starea spune asta
  const g = fals({ docs: [DOC, { ...DOC, id: 213, nume_original: 'Alta.pdf' }] })
  g.deps.acum = (() => { let n = 0; return () => (n++ > 0 ? 10 ** 9 : 0) })()   // t0 = 0, apoi bugetul e depășit la prima felie
  const rg = await RULEAZA(g)
  assertEquals(rg.body.oprit, 'buget_timp')
  const pg = fnM(g, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  assertEquals(pg.documente_necitite_stare, [{ document_id: 212, stare: 'in_lucru:buget_timp' }, { document_id: 213, stare: 'neprocesat:buget_timp' }])
})

Deno.test('documente_necitite = doar documentele de tip extractibil fără extragere gata: planșa nu intră; documentul extractibil fără text intră (sarit:fara_text)', async () => {
  const f = fals({ docs: [DOC, { ...DOC, id: 300, tip: 'plansa', nume_original: 'Plan.pdf', text_extras: '[PLANSA: plan]' }, { ...DOC, id: 301, tip: 'alta', nume_original: 'Scan.pdf', text_extras: '' }] })
  const r = await RULEAZA(f)
  assertEquals(f.ai(), 1)
  assert((r.body as any).raport.some((x: any) => x.document_id === 301 && x.sarit === 'fara_text'))
  const p = fnM(f, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  // fotografia falsă n-are extrageri gata → 212 (extras în această rulare, dar fotografia falsă nu știe) și 301 (fără text) sunt necitite; 300 (planșă) nu
  assertEquals([p.documente_necitite, p.documente_necitite_stare], [[212, 301], [{ document_id: 212, stare: 'gata' }, { document_id: 301, stare: 'sarit:fara_text' }]])
  // eligibilitatea e cerută DUPĂ fotografie, pentru EXACT documentele ei (nu lista citită la început)
  assertEquals(f.eligibilitateCeruta, [[212, 300, 301]])
})

Deno.test('r1 P1: document apărut între citirea documentelor și fotografie → necitit (nu dispare); eligibilitatea picată → toate necitite, nota în raport', async () => {
  const f = fals({ docsFoto: [{ ...DOC, id: 999, tip: 'cs_volum', nume_original: 'Caiet nou.pdf', text_extras: '' }] })
  const r = await RULEAZA(f)
  const p = fnM(f, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  assertEquals([f.eligibilitateCeruta, p.documente_necitite], [[[212, 999]], [212, 999]])
  assertEquals(p.documente_necitite_stare.find((x: any) => x.document_id === 999), { document_id: 999, stare: 'fara_extragere_gata' })
  assertEquals((r.body as any).masuratori.ok, true)
  const g = fals({ docs: [DOC, { ...DOC, id: 300, tip: 'plansa', nume_original: 'Plan.pdf', text_extras: '[PLANSA: plan]' }], eligibilitate: null })
  const rg = await RULEAZA(g)
  const pg = fnM(g, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  assertEquals(pg.documente_necitite, [212, 300])
  assert(String((rg.body as any).masuratori.nota).includes('eligibilitatea documentelor nu a putut fi citită'))
  // fără dependența de eligibilitate (deps vechi): conservator, la fel ca citirea picată
  const h = fals({ docs: [DOC, { ...DOC, id: 300, tip: 'plansa', nume_original: 'Plan.pdf', text_extras: '[PLANSA: plan]' }] })
  delete (h.deps as Partial<DepsStructurat>).eligibilitateDocumente
  await RULEAZA(h)
  assertEquals((fnM(h, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any).documente_necitite, [212, 300])
})

Deno.test('fotografia indisponibilă (ex. migrarea neaplicată) = fail-closed: niciun RPC de muncă, niciun apel AI, raport cu eroarea', async () => {
  const f = fals({ fotoLipsa: true })
  const r = await RULEAZA(f)
  const b = r.body as any
  assertEquals([f.ai(), f.apeluri, b.ok, b.oprit, b.felii_apelate], [0, [], false, 'fotografie_indisponibila', 0])
  assert(String(b.masuratori.eroare).startsWith('fotografie: PGRST202'))
  assertEquals(f.apeluriMasuratori.map((a) => a.fn), ['fn_ofertare_semnale_fotografie'])
  // o fotografie cu formă străină ({ok: true}) e la fel de inutilizabilă
  const g = fals()
  const rpc0 = g.deps.rpc
  g.deps.rpc = async (fn, args) => fn === 'fn_ofertare_semnale_fotografie' ? { data: { ok: true }, error: null } : rpc0(fn, args)
  const rg = await RULEAZA(g)
  assertEquals([g.ai(), g.apeluri, (rg.body as any).oprit], [0, [], 'fotografie_indisponibila'])
})

Deno.test('m_formular: un document `formular` cu antet F3 intră în felii (înainte: sărit); fără secțiune cantitativă → sărit ca până acum', async () => {
  assert(TIPURI_ELIGIBILE.includes('formular') && !TIPURI_ELIGIBILE.includes('plansa'))
  const f = fals({ docs: [{ ...DOC, tip: 'formular', nume_original: 'Formulare ofertant.pdf' }] })
  await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri.filter((x) => x === 'felie_incepe').length], [1, 1])
  assertEquals(f.obs()[0]?.rol_sursa, 'f3')
  const g = fals({ docs: [{ ...DOC, tip: 'formular', nume_original: 'Formulare ofertant.pdf', text_extras: 'Formular nr. 1\nDeclaratie privind neincadrarea\n' }] })
  const rg = await RULEAZA(g)
  assertEquals([g.ai(), g.apeluri], [0, []])
  assert(JSON.stringify(rg.body.raport).includes('fara_sectiuni_cantitative'))
  // tipurile neeligibile (ex. plansa) rămân sărite
  const h = fals({ docs: [{ ...DOC, tip: 'plansa' }] })
  await RULEAZA(h)
  assertEquals([h.ai(), h.apeluri], [0, []])
})

Deno.test('m_plafon_aplicat: 3 documente × 100 pagini, plafon 200 → documentul 3 fără felie_incepe / rezervare / AI; paginile lui necitite; plafon_atins; peste_plafon', async () => {
  const docs = [docPagini(1, 100), docPagini(2, 100), docPagini(3, 100)]
  const f = fals({ docs })
  const r = await RULEAZA(f)
  const b = r.body as any
  assertEquals([f.ai(), f.apeluri.filter((x) => x === 'felie_incepe').length, f.apeluri.filter((x) => x === 'rezerva').length], [2, 2, 2])
  assertEquals(f.argsGrup.map((a) => a.p_document_id), [1, 2])
  assertEquals([b.plafon, b.peste_plafon], [{ plafon: 200, plafon_atins: true }, [{ document_id: 3, felii: [0] }]])
  assert(b.raport.some((x: any) => x.document_id === 3 && x.sarit === 'peste_plafon'))
  const p = fnM(f, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  assertEquals(p.pagini_necitite, [{ document_id: 3, pagini: Array.from({ length: 100 }, (_, i) => i + 1) }])
  assertEquals([p.plafon, p.plafon_atins], [200, true])
  // plafon 300: toate trei procesate
  const g = fals({ docs, plafon: 300 })
  await RULEAZA(g)
  assertEquals([g.ai(), g.argsGrup.length], [3, 3])
})

Deno.test('m_plafon_aplicat: o felie care traversează limita e exclusă ÎNTREAGĂ (nu se împarte); extragerea rămâne partial; paginile ei + cele de peste limită necitite', async () => {
  // 250 de pagini × ~300 caractere → două felii: [0, 55000) și [53000, …); a doua trece de pagina 200 → exclusă; prima e sub limită
  const d = docPagini(212, 250, ' ' + 'x'.repeat(240))
  const text = d.text_extras
  const felii = feliiCuPozitie(text)
  assertEquals(felii.length, 2)
  const pg0 = paginiInterval(text, felii[0].de, felii[0].de + felii[0].text.length), pg1 = paginiInterval(text, felii[1].de, felii[1].de + felii[1].text.length)
  assert(pg0.pagina_pana_la <= 200 && pg1.pagina_de_la <= 200 && pg1.pagina_pana_la === 250, JSON.stringify([pg0, pg1]))
  const f = fals({ docs: [d] })
  const r = await RULEAZA(f)
  const b = r.body as any
  assertEquals([f.ai(), f.apeluri.filter((x) => x === 'felie_incepe').length, b.peste_plafon], [1, 1, [{ document_id: 212, felii: [1] }]])
  assertEquals(f.argsGrup[0].p_felii_total, 2)
  assertEquals(f.apeluri.at(-1), 'extragere_inchide:partial')
  assert(b.raport.some((x: any) => x.document_id === 212 && x.felie === 1 && JSON.stringify(x.peste_plafon) === JSON.stringify([pg1.pagina_de_la, pg1.pagina_pana_la])))
  const p = fnM(f, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  const nec: number[] = p.pagini_necitite[0].pagini
  assertEquals([p.pagini_necitite[0].document_id, nec[0], nec.at(-1), nec.includes(pg1.pagina_de_la - 1), nec.includes(201)], [212, pg1.pagina_de_la, 250, false, true])
  // la plafon 250 ambele felii se procesează
  const g = fals({ docs: [d], plafon: 250 })
  await RULEAZA(g)
  assertEquals([g.ai(), g.apeluri.at(-1)], [2, 'extragere_inchide:gata'])
})

Deno.test('m_plafon_aplicat: documentul din cache (id mic) consumă plafonul — al doilea document NOU e exclus deși primul n-a costat nimic', async () => {
  const docs = [docPagini(5, 150), docPagini(9, 100)]
  const f = fals({ docs, cacheIds: [5] })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])   // doc 5 = cache (un singur RPC), doc 9 = sărit pe plafon
  assertEquals((r.body as any).peste_plafon, [{ document_id: 9, felii: [0] }])
  const p = fnM(f, 'fn_ofertare_masuratori_propune')[0].args.p_pagini as any
  assertEquals(p.pagini_necitite, [{ document_id: 9, pagini: Array.from({ length: 100 }, (_, i) => i + 1) }])
  // un document care nu e în fotografie (a apărut între timp) = 0 pagini permise, conservator
  const g = fals({ docs: [docPagini(1, 10)] })
  const rpc0 = g.deps.rpc
  g.deps.rpc = async (fn, args) => { const r = await rpc0(fn, args); return fn === 'fn_ofertare_semnale_fotografie' ? { data: { ...r.data, documente: [] }, error: null } : r }
  await RULEAZA(g)
  assertEquals([g.ai(), g.apeluri], [0, []])
})

Deno.test('fără cerere activă → 402, niciun RPC de muncă și niciun apel AI', async () => {
  for (const cerere of [null, { id: 5, licitatie_id: 15, scop: 'cant_extragere', stare: 'anulata', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] },
    { id: 5, licitatie_id: 99, scop: 'cant_extragere', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] },
    { id: 5, licitatie_id: 15, scop: 'audit_raspunsuri', stare: 'activa', valabil_pana: ACUM, lot_domeniu: 'toate', lot_nr: [] }]) {
    const f = fals({ cerere })
    const r = await RULEAZA(f)
    assertEquals([r.status, f.apeluri.length, f.ai()], [402, 0, 0])
  }
})

Deno.test('drumul normal: extragere → felie → rezervare → apel → decontare → observații → felie gata → extragere gata', async () => {
  const f = fals()
  const r = await RULEAZA(f)
  assertEquals(r.status, 200)
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
  const o = f.obs()[0]
  assertEquals([o.rol_sursa, o.rol_decis_de, o.cantitate, o.pozitie_dovedita, o.dn_mm, o.um_norm], ['f3', 'antet', 1160, true, [90], 'm'])
  assertEquals(o.cantitate_offset, TEXT_F3.indexOf('1160.000'))
  assert(f.extractori[0].startsWith(EXTRACTOR_ID + '@c-'))
})

Deno.test('cache: a doua extragere pe aceeași versiune = 0 apeluri AI', async () => {
  const f = fals({ cache: true })
  await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
})

Deno.test('plafonul refuză ÎNAINTEA apelului: felia „esuat”, oprire, extragerea închisă controlat (esuat)', async () => {
  const f = fals({ refuzRezerva: 'plafon' })
  const r = await RULEAZA(f)
  assertEquals(f.ai(), 0)
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'felie_inchide:esuat', 'extragere_inchide:esuat'])
  assertEquals(r.body.oprit, 'rezervare:plafon')
})

Deno.test('eroare SAU excepție la apel → rezervarea „necunoscuta” + felia „necunoscut”', async () => {
  for (const o of [{ aiEroare: true }, { aiAruncă: true }]) {
    const f = fals(o)
    await RULEAZA(f)
    assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'rezervare_necunoscuta', 'felie_inchide:necunoscut', 'extragere_inchide:esuat'])
  }
})

Deno.test('un rând nenormalizabil → felia „esuat”, fără observații (nu „gata” cu un candidat pierdut)', async () => {
  const f = fals({ raspuns: JSON.stringify({ r: [RAND, ['trunchiat']] }) })
  const r = await RULEAZA(f)
  assertEquals(f.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'felie_inchide:esuat', 'extragere_inchide:esuat'])
  assertEquals(f.obs(), [])
  // proba Răcari: raportul poartă mostre din rândurile pierdute (diagnoză)
  const er = (r.body as any).raport.find((x: any) => x.eroare)
  assertEquals([er.mostre.length, er.mostre[0]], [1, '["trunchiat"]'])
})
Deno.test('proba Răcari r2: orice rând nenormalizabil pierde felia, oricare ar fi UM-ul declarat (fără „irelevant” nedovedit); mostre ≤ 3, ≤ 240', async () => {
  const fara = (um: string | null) => [null, null, null, '2100402', 'CIMENT METALURGIC ' + 'X'.repeat(300), null, null, null, null, um, '77.50', 0, 0, 'alt', 'material', null]
  for (const um of ['KG', 'M.C.', 'RON', 'BUC.', 'm.liniar', 'N/A', 'M', null]) {
    const f = fals({ raspuns: JSON.stringify({ r: [RAND, fara(um), fara(um), fara(um), fara(um)] }) })
    const r = await RULEAZA(f)
    assertEquals(f.apeluri.slice(-2), ['felie_inchide:esuat', 'extragere_inchide:esuat'], String(um))
    const er = (r.body as any).raport.find((x: any) => x.eroare)
    assertEquals([er.eroare.startsWith('4 rânduri'), er.mostre.length, er.mostre.every((m: string) => m.length <= 240)], [true, 3, true], String(um))
  }
})
Deno.test('review r4 (P2): un rând neserializabil (imbricare adâncă) nu întrerupe închiderea feliei — esuat + mostra de rezervă', async () => {
  const f = fals({ raspuns: '{"r":[' + '['.repeat(10000) + '0' + ']'.repeat(10000) + ']}' })
  const r = await RULEAZA(f)
  assertEquals(f.apeluri.slice(-2), ['felie_inchide:esuat', 'extragere_inchide:esuat'])
  const er = (r.body as any).raport.find((x: any) => x.eroare)
  assert(er.mostre.length === 1 && er.mostre[0].length <= 240)
})
Deno.test('p3: rândul-OBIECT cu cheile exacte = rândul tablou; obiect cu cheie străină / tablou de 15 sau 17 elemente → pierde felia', async () => {
  const obiect = Object.fromEntries(['pagina', 'tabel', 'rand', 'cod_articol', 'denumire', 'obiect', 'material', 'dn_text', 'sdr', 'um', 'cantitate',
    'e_total', 'e_subtotal', 'tip_lucrare', 'masura', 'citat'].map((k, i) => [k, RAND[i]]))
  const a = fals({ raspuns: JSON.stringify({ r: [obiect] }) })
  await RULEAZA(a)
  assertEquals([a.apeluri.slice(-2), a.obs().length, a.obs()[0]?.cantitate], [['felie_inchide:gata', 'extragere_inchide:gata'], 1, 1160])
  // observația completă (inclusiv pozitie_dovedita, intervale, hash_rand) e identică cu cea din rândul tablou
  const t = fals({ raspuns: JSON.stringify({ r: [RAND] }) })
  await RULEAZA(t)
  assertEquals(a.obs(), t.obs())
  for (const rau of [{ ...obiect, ore: 3 }, RAND.slice(1), [...RAND, null]]) {
    const f = fals({ raspuns: JSON.stringify({ r: [RAND, rau] }) })
    await RULEAZA(f)
    assertEquals(f.apeluri.slice(-2), ['felie_inchide:esuat', 'extragere_inchide:esuat'], JSON.stringify(rau).slice(0, 40))
  }
})
Deno.test('review #757 r1 (P1): secțiunile lista_alt (C7 …) rămân extrase — eticheta euristică nu dovedește absența lungimilor', async () => {
  const text = 'Formularul F3\nLista cu cantitatile de lucrari\n= NR =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 1160.000\nTEAVA D= 90 MM\n0.000 0 Total=\n' +
    '⟦PAGINA 9⟧\nFORMULAR C7\nLista consumurilor cu mana de lucru\n1 | 102 BETONIST | om-ore | 6.740\n'
  const f = fals({ docs: [{ ...DOC, text_extras: text }] })
  await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri.filter((x) => x === 'felie_incepe').length], [2, 2])
})
Deno.test('review #757 r1 (P2): rând de listă > 300 caractere — citatul = ultimele ≤ 300 caractere continue până după cantitate → dovedit', async () => {
  const den = 'TEAVA PVC NEPLASTIF.TIP G MONT.LA CONSTR.INDUSTR. IN CONDUCTE DE DISTRIBUTIE '.repeat(4)
  const linie = `003 SA11G1 ${den}D= 90 MM [ 2] M 1160.000`
  const text = `Formularul F3\nLista cu cantitatile de lucrari\n= NR =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n${linie}\n0.000 0 Total=\n`
  assert(linie.length > 300)
  const citat = linie.slice(linie.length - 300)
  const rand = [null, null, null, 'SA11G1', 'TEAVA PVC D= 90 MM', 'Str. A', 'PVC', 'D= 90 MM', null, 'M', '1160.000', 0, 0, 'conducta', 'lungime', citat]
  const f = fals({ docs: [{ ...DOC, text_extras: text }], raspuns: JSON.stringify({ r: [rand] }) })
  await RULEAZA(f)
  assertEquals([f.obs()[0]?.pozitie_dovedita, f.obs()[0]?.cantitate], [true, 1160])
})
Deno.test('proba Răcari: răspuns neinterpretabil → mostra din textul modelului în raport; prompt p3, normalizator n7', async () => {
  const f = fals({ raspuns: 'nu e JSON' })
  const r = await RULEAZA(f)
  assertEquals((r.body as any).raport.find((x: any) => x.eroare)?.mostre, ['nu e JSON'])
  assert(EXTRACTOR_ID.includes('@p3@n7@f2'))
})

Deno.test('cost peste rezervare → oprire după felie; extragerea închisă controlat', async () => {
  const f = fals({ pesteRezervare: true })
  const r = await RULEAZA(f)
  assertEquals(r.body.oprit, 'cost_peste_rezervare (buget blocat)')
  assertEquals(f.apeluri.at(-1), 'extragere_inchide:gata')
})

Deno.test('preluarea unei extrageri rămase în lucru: felie gata = numărată; reluare autorizată (în zbor fără rezervare) = continuată', async () => {
  const a = fals({ inLucru: 41, feliiExistente: true, ultima: { id: 99, stare: 'gata', rezervare_id: 1 } })
  await RULEAZA(a)
  assertEquals([a.ai(), a.apeluri], [0, ['extragere_incepe_grup', 'felie_incepe', 'extragere_inchide:gata']])
  const b = fals({ inLucru: 41, feliiExistente: true, ultima: { id: 98, stare: 'in_zbor', rezervare_id: null } })
  await RULEAZA(b)
  assertEquals(b.apeluri, ['extragere_incepe_grup', 'felie_incepe', 'rezerva', 'deconteaza', 'obs_scrie', 'felie_inchide:gata', 'extragere_inchide:gata'])
  const c = fals({ inLucru: 41, feliiExistente: true, ultima: { id: 97, stare: 'necunoscut', rezervare_id: 3 } })
  const rc = await RULEAZA(c)
  assertEquals(c.ai(), 0)
  assert(JSON.stringify(rc.body.raport).includes('asteapta_om'))
  // r4: o felie care așteaptă omul lasă extragerea în lucru (fără închidere din contorul local)
  assert(!c.apeluri.some((x) => x.startsWith('extragere_inchide')))
})

Deno.test('convenția doar din părțile cu text VALID: o parte nevalidă nu dovedește convenția celeilalte', async () => {
  const p1 = { ...DOC, id: 1, nume_original: 'Lista — p01_pag1-10.pdf', text_extras: 'Formularul F3\nLista cu cantitatile de lucrari\n003 SA11G1 [ 2] M 570.000\n' }
  const p2 = { ...DOC, id: 2, nume_original: 'Lista — p02_pag11-20.pdf', text_extras: 'Formularul F3\nLista cu cantitatile de lucrari\n003 X M 1160.000\n' }
  const rand = [null, null, null, null, 'TEAVA', null, null, null, null, 'M', '570.000', 0, 0, 'conducta', 'lungime', '003 SA11G1 [ 2] M 570.000']
  const f = fals({ docs: [p1, p2], nevalide: [2], raspuns: JSON.stringify({ r: [rand] }) })
  await RULEAZA(f)
  assertEquals([f.prima()[0].pozitie_dovedita, f.prima()[0].valoare_ambigua], [false, true])
  assert(f.extractori[0].includes('@c-nedeterminata-'))
  const g = fals({ docs: [p1, p2], raspuns: JSON.stringify({ r: [rand] }) })
  await RULEAZA(g)
  assertEquals(g.prima()[0].pozitie_dovedita, true)
  assert(g.extractori[0].includes('@c-en-'))
})

Deno.test('identitatea extractorului depinde de context (convenție, manifestul grupului, decizii)', async () => {
  const a = await extractorCuContext('en', ['1:a', '2:b'], [])
  assertEquals(a, await extractorCuContext('en', ['2:b', '1:a'], []))
  assert(a !== await extractorCuContext('ro', ['1:a', '2:b'], []))
  assert(a !== await extractorCuContext('en', ['1:a', '2:c'], []))
  assert(a !== await extractorCuContext('en', ['1:a', '2:b'], [{ document_id: 1, doc_sha256: 'a', rol: 'atr', sectiune: '2-3', decizie: 'rol_confirmat' }]))
})

Deno.test('feliile cu offsetul din feliere (text repetat: a doua felie NU e plasată la prima apariție)', () => {
  const t = 'Formular F3\n' + 'aceeasi linie de text repetata\n'.repeat(5000)
  const f = feliiCuPozitie(t)
  assert(f.length > 1)
  assertEquals(f[1].de, FELIE - SUPRAPUNERE)
  for (const x of f) assertEquals(t.slice(x.de, x.de + x.text.length), x.text)
})

Deno.test('rezervarea = limită superioară: octeți × tarif intrare + ieșirea maximă', () => {
  assert(sumaRezervata('x'.repeat(55000)) >= 55000 * 0.25e-6 + 16000 * 2e-6)
  assert(sumaRezervata('ă'.repeat(1000)) > sumaRezervata('a'.repeat(1000)))   // diacriticele = 2 octeți
})

Deno.test('părțile aceluiași PDF au aceeași rădăcină; deciziile umane pe secțiune', () => {
  assertEquals(radacinaParte('Liste de cantitati fara valori _X — p02_pag105-176.pdf'), radacinaParte('Liste de cantitati fara valori _X — p01_pag1-104.pdf'))
  const s = [{ de: 0, pana: 10, pagini: [1, 1] as [number, number], rol: 'memoriu' as const, decis_de: 'titlu' as const },
    { de: 10, pana: 20, pagini: [2, 3] as [number, number], rol: 'alt' as const, decis_de: 'titlu' as const }]
  const r = aplicaDecizii(s, [{ rol: 'atr', sectiune: '2-3', decizie: 'rol_confirmat' }, { rol: 'memoriu', sectiune: '1-1', decizie: 'nu_e_sursa_cantitativa' }])
  assertEquals(r.map((x) => [x.rol, x.decis_de]), [[null, 'titlu'], ['atr', 'om']])
})

Deno.test('r2: preluarea doar pe ACEEAȘI cerere; pe altă cerere = refuz, fără apeluri', async () => {
  const f = fals({ inLucru: 41, inLucruCerere: 4, feliiExistente: true, ultima: { id: 98, stare: 'in_zbor', rezervare_id: null } })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
  assert(JSON.stringify(r.body.raport).includes('in_lucru_pe_alta_cerere'))
})
Deno.test('r2: rezervarea refuzată „felie” (alt worker a rezervat-o între timp) NU închide felia', async () => {
  const f = fals({ refuzRezerva: 'felie' })
  await RULEAZA(f)
  assertEquals(f.ai(), 0)
  assert(!f.apeluri.includes('felie_inchide:esuat'))
  // r3: conflict de muncă → extragerea NU se închide din contorul local (alt worker poate termina felia)
  assert(!f.apeluri.some((x) => x.startsWith('extragere_inchide')))
})
Deno.test('r3: grupul schimbat (verificat atomic în RPC-ul de grup) → tot grupul sărit, fără apeluri de muncă', async () => {
  const f = fals({ grupSchimbat: true })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
  assert(JSON.stringify(r.body.raport).includes('grup_schimbat'))
})
Deno.test('r6: deciziile de rol folosite trec în RPC-ul de grup; context_schimbat / grup_ocupat = sărit, fără apeluri de muncă', async () => {
  const sha = await (await import('../_shared/cantNormalizare.ts')).sha256Hex(TEXT_F3)
  const f = fals({ decizii: [{ id: 77, document_id: 212, doc_sha256: sha, rol: 'f3', sectiune: '*', decizie: 'rol_confirmat' },
    { id: 78, document_id: 999, doc_sha256: sha, rol: 'atr', sectiune: '*', decizie: 'rol_confirmat' }] })
  await RULEAZA(f)
  assertEquals(f.argsGrup[0].p_decizii, [77])
  for (const refuzGrup of ['context_schimbat', 'grup_ocupat', 'cerere_ocupata']) {
    const g = fals({ refuzGrup })
    const r = await RULEAZA(g)
    assertEquals([g.ai(), g.apeluri], [0, ['extragere_incepe_grup']])
    assert(JSON.stringify(r.body.raport).includes(refuzGrup))
  }
})

// 20.10.2026: extragere rămasă în lucru pe o cerere care nu mai e activă → închisă (partial / esuat) cu RPC-ul existent, ca omul s-o
// redeschidă pe cererea nouă; cererea veche activă / necitibilă sau felii în zbor → nimic închis
const CERERE_VECHE = (stare: string, valabil: string) => ({ id: 4, licitatie_id: 15, scop: 'cant_extragere', stare, valabil_pana: valabil, lot_domeniu: 'toate', lot_nr: [] })
const EXPIRAT = '2026-10-20T20:15:00Z'
Deno.test('cerere veche expirată + felii gata → extragerea închisă „partial”, fără niciun apel AI', async () => {
  const f = fals({ inLucru: 157, inLucruCerere: 4, cereri: { 4: CERERE_VECHE('activa', EXPIRAT) }, feliiGata: { gata: 19, total: 21 } })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup', 'extragere_inchide:partial']])
  const x = (r.body.raport as any[]).find((y) => y.extragere_id === 157)
  assertEquals([x.refuz, x.inchisa_cerere_inactiva], ['in_lucru_pe_alta_cerere', 'partial'])
})
Deno.test('cerere veche anulată + nicio felie gata → „esuat”; toate gata → „gata”', async () => {
  const a = fals({ inLucru: 157, inLucruCerere: 4, cereri: { 4: CERERE_VECHE('anulata', ACUM) }, feliiGata: { gata: 0, total: 21 } })
  await RULEAZA(a)
  assertEquals(a.apeluri, ['extragere_incepe_grup', 'extragere_inchide:esuat'])
  const b = fals({ inLucru: 157, inLucruCerere: 4, cereri: { 4: CERERE_VECHE('activa', EXPIRAT) }, feliiGata: { gata: 21, total: 21 } })
  await RULEAZA(b)
  assertEquals(b.apeluri, ['extragere_incepe_grup', 'extragere_inchide:gata'])
})
Deno.test('felii în zbor → RPC-ul refuză închiderea; raportat, nimic altceva', async () => {
  const f = fals({ inLucru: 157, inLucruCerere: 4, cereri: { 4: CERERE_VECHE('activa', EXPIRAT) }, feliiGata: { gata: 19, total: 21 }, refuzInchide: 'felii_in_zbor' })
  const r = await RULEAZA(f)
  assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup', 'extragere_inchide:partial']])
  assertEquals((r.body.raport as any[]).find((y) => y.extragere_id === 157).inchidere_refuzata, 'felii_in_zbor')
})
Deno.test('cerere veche încă activă, necitibilă, sau felii necitibile → NU se închide (refuzul de până acum)', async () => {
  for (const opt of [{ cereri: { 4: CERERE_VECHE('activa', ACUM) }, feliiGata: { gata: 1, total: 2 } },
    { cereri: { 4: null }, feliiGata: { gata: 1, total: 2 } },
    { cereri: { 4: CERERE_VECHE('activa', EXPIRAT) } }]) {
    const f = fals({ inLucru: 157, inLucruCerere: 4, ...opt })
    const r = await RULEAZA(f)
    assertEquals([f.ai(), f.apeluri], [0, ['extragere_incepe_grup']])
    assert(JSON.stringify(r.body.raport).includes('in_lucru_pe_alta_cerere'))
  }
})
Deno.test('review Gemini #813 r1 (P2): total 0 / invalid nu dă „gata” (esuat fără felii gata)', async () => {
  for (const total of [0, NaN]) {
    const f = fals({ inLucru: 157, inLucruCerere: 4, cereri: { 4: CERERE_VECHE('anulata', ACUM) }, feliiGata: { gata: 0, total } })
    await RULEAZA(f)
    assertEquals(f.apeluri, ['extragere_incepe_grup', 'extragere_inchide:esuat'], String(total))
  }
})
