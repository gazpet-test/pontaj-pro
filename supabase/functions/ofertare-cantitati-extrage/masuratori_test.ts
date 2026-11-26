// TKT-0329 A, PR-extragere (Task 7): pasul de comparație `comparaSurse` cu dependențe FALSE (RPC-urile serverului simulate). Zero apeluri AI
// (DepsMasuratori nu are `ai`), nicio reîncercare, orice eroare = raport cu `eroare`. Paritatea regulii numerice JS / SQL pe tabelul comun
// supabase/tests/20270112a_cazuri_numar.json.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { sha256Hex } from '../_shared/cantNormalizare.ts'
import { type Context, type FelieServita, type Fotografie, type FotoDocument, numarPagini } from '../_shared/cantMasura.ts'
import { interpretari, tokeniNumerici, valoareInDocument } from '../_shared/cantNumar.ts'
import { comparaSurse, type DepsMasuratori, LIMITA_FELII, type ParametriComparatie } from './masuratori.ts'

const F3 = '⟦PAGINA 1⟧\nFormularul F3\nLista cu cantitatile de lucrari\nObiect 3 Str. A\n= NR. SIMBOL ART. CANTITATE UM =\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n003 SA11G1 [ 2] M 6.400\nTEAVA PE100 DN160\n0.000 0 Total=\n'
const ATR = '⟦PAGINA 1⟧\nAVIZ TEHNIC DE RACORDARE\nconducta Dn 160, in lungime totala de 3.995 m\n'
type DocFals = { id: number; tip: string; nume: string; text: string; extragere_id: number | null; felii_distincte?: number; decizii?: Context['decizii']; pagini_necitite?: number[] }
const shaDecizii = (d: Context['decizii']) => sha256Hex(d.map((z) => `${z.id}|${z.rol ?? ''}|${z.sectiune ?? ''}|${z.decizie}`).join(';'))
async function fotografie(docs: DocFals[], plafon = 200): Promise<Fotografie> {
  const documente: FotoDocument[] = []
  for (const d of docs) {
    documente.push({ id: d.id, tip: d.tip, nume_original: d.nume, revizie: '-', sha: await sha256Hex(d.text), pagini: numarPagini(d.text), pagini_necitite: d.pagini_necitite ?? [],
      lot_stare: 'comun', extragere_id: d.extragere_id, extractor_id: d.extragere_id ? 'x@p@n@f' : null, felii_distincte: d.extragere_id ? (d.felii_distincte ?? 1) : 0,
      felii_sha: d.extragere_id ? 'fs' : null, obs_sha: d.extragere_id ? 'os' : null, decizii_sha: await shaDecizii(d.decizii ?? []) })
  }
  const f = { licitatie_id: 900001, documente, document_loturi_sha: 'dl', stare_loturi: 'fara_loturi', cantitati_sha: 'cs', prag: 0.05, plafon, v: 'surse_v1' }
  return { ...f, sha: await sha256Hex(JSON.stringify(f)) }
}
const obs = (text: string, cant: string, id = 1, felie_nr = 0) => ({ id, felie_nr, pozitie_dovedita: true, cantitate_offset: text.indexOf(cant), hash_rand: 'h' + id, e_total: false, e_subtotal: false })
const felieS = (document_id: number, extragere_id: number, text: string, x: Partial<FelieServita> = {}): FelieServita =>
  ({ document_id, extragere_id, felie_nr: 0, incercare: 1, incercari: 1, de_la: 0, pana_la: text.length, stare: 'gata', obs_numar: (x.obs ?? []).length, obs_atribuibile: true, obs: [], ...x })

type Opt = { docs: DocFals[]; felii?: FelieServita[]; plafon?: number; limita?: number; propuneDepasita?: boolean; publicaRefuz?: string; semnale?: unknown[]
  aruncaLa?: string; eroareLa?: string; contextRefuz?: boolean; contextText?: (d: DocFals) => string; contextNume?: string; feliiLipsa?: boolean; feliiDezordonate?: boolean
  fotoStricata?: unknown; propuneRaspuns?: unknown; publicaRaspuns?: unknown; feliiStraine?: boolean }
async function fals(opt: Opt) {
  const foto = await fotografie(opt.docs, opt.plafon)
  const apeluri: { fn: string; args: Record<string, unknown> }[] = []
  const toate = [...(opt.felii ?? [])].sort((a, b) => a.extragere_id - b.extragere_id || a.felie_nr - b.felie_nr)
  if (opt.feliiLipsa) toate.pop()
  const deps: DepsMasuratori = {
    rpc: async (fn, args) => {
      apeluri.push({ fn, args })
      if (opt.aruncaLa === fn) throw new TypeError('fetch failed')
      if (opt.eroareLa === fn) return { data: null, error: { message: 'PGRST202 funcția lipsește' } }
      switch (fn) {
        case 'fn_ofertare_semnale_fotografie': return { data: opt.fotoStricata !== undefined ? opt.fotoStricata : foto, error: null }
        case 'fn_ofertare_semnale_context': {
          if (opt.contextRefuz) return { data: { refuz: 'fotografie_schimbata' }, error: null }
          const d = opt.docs.find((x) => x.id === Number(args.p_document_id))!
          const text = opt.contextText ? opt.contextText(d) : d.text
          return { data: { document_id: d.id, text_extras: text, nume_original: opt.contextNume ?? d.nume, tip: d.tip, sha: await sha256Hex(text), decizii: d.decizii ?? [], decizii_sha: await shaDecizii(d.decizii ?? []) }, error: null }
        }
        case 'fn_ofertare_semnale_felii': {
          const ex = new Set((args.p_extrageri as number[]).map(Number))
          const dE = args.p_dupa_extragere == null ? -1 : Number(args.p_dupa_extragere), dF = args.p_dupa_felie == null ? -1 : Number(args.p_dupa_felie)
          let r = toate.filter((f) => ex.has(f.extragere_id) && (f.extragere_id > dE || (f.extragere_id === dE && f.felie_nr > dF)))
          r = r.slice(0, Math.min(Number(args.p_limita) || 200, 200))
          if (opt.feliiDezordonate && r.length > 1) r = [r[1], r[0], ...r.slice(2)]
          if (opt.feliiStraine && r.length) r = [{ ...r[0], extragere_id: 99 }, ...r.slice(1)]
          return { data: r, error: null }
        }
        case 'fn_ofertare_masuratori_propune': return { data: opt.propuneRaspuns !== undefined ? opt.propuneRaspuns : opt.propuneDepasita ? { refuz: 'evaluare_depasita', sha_acum: 'alt' } : { evaluare_id: 11, semnale: [{ id: 1, identitate: 'i' }], ignorate: [] }, error: null }
        case 'fn_ofertare_semnale_publica': {
          if (opt.publicaRaspuns !== undefined) return { data: opt.publicaRaspuns, error: null }
          const semnale = opt.semnale ?? [{ id: 1, identitate: 'i', verdict: 'diferenta', motiv: 'A 6400 m, B 3995 m', a: 6400, b: 3995, clarificare: 'creata' }]
          return { data: opt.publicaRefuz ? { refuz: opt.publicaRefuz } : { evaluare_id: 11, semnale, n: semnale.length }, error: null }
        }
        default: return { data: null, error: { message: 'RPC necunoscut ' + fn } }
      }
    },
  }
  const fn = (nume: string) => apeluri.filter((a) => a.fn === nume)
  return { deps, foto, apeluri, fn, propune: () => fn('fn_ofertare_masuratori_propune')[0]?.args, publica: () => fn('fn_ofertare_semnale_publica')[0]?.args }
}
// tipurile extractibile (ca TIPURI_ELIGIBILE din structurat.ts)
const TIPURI = ['lista_cantitati', 'formular', 'cs_volum', 'fisa_date', 'alta', 'raspuns_clarificare']
const RULEAZA = (f: Awaited<ReturnType<typeof fals>>, p: Partial<ParametriComparatie> = {}) =>
  comparaSurse(f.deps, { licitatie_id: 900001, cerere_id: 5, stareExtrageri: new Map(), paginiPestePlafon: [], tipuriEligibile: TIPURI, ...p })
const DOC_F3: DocFals = { id: 1, tip: 'formular', nume: 'Formulare.pdf', text: F3, extragere_id: 7 }
const DOC_ATR: DocFals = { id: 2, tip: 'alta', nume: 'ATR.pdf', text: ATR, extragere_id: 8 }
const FELII_TICHET = () => [felieS(1, 7, F3, { obs: [obs(F3, '174.000', 1), obs(F3, '6.400', 2)] }), felieS(2, 8, ATR, { obs: [obs(ATR, '3.995', 3)] })]

Deno.test('m_cazul_tichetului: fotografia + extragerile gata → context pe fiecare document citit, feliile, propune cu p_pagini fără necitite, publica cu evaluare_id și tokenul din propune', async () => {
  const f = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET() })
  const r = await RULEAZA(f)
  assertEquals(r.ok, true, JSON.stringify(r))
  assertEquals(f.apeluri.map((a) => a.fn), ['fn_ofertare_semnale_fotografie', 'fn_ofertare_semnale_context', 'fn_ofertare_semnale_context', 'fn_ofertare_semnale_felii', 'fn_ofertare_semnale_felii',
    'fn_ofertare_masuratori_propune', 'fn_ofertare_semnale_publica'])
  // contextul e cerut pe sha-ul fotografiei, câte un document pe apel
  assertEquals(f.fn('fn_ofertare_semnale_context').map((a) => [a.args.p_licitatie_id, a.args.p_fotografie_sha, a.args.p_document_id]), [[900001, f.foto.sha, 1], [900001, f.foto.sha, 2]])
  assertEquals(f.fn('fn_ofertare_semnale_felii')[0].args, { p_licitatie_id: 900001, p_extrageri: [7, 8], p_dupa_extragere: null, p_dupa_felie: null, p_limita: LIMITA_FELII })
  const p = f.propune()!
  assertEquals([p.p_licitatie_id, p.p_fotografie], [900001, f.foto])
  assertMatch(String(p.p_token), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assertEquals(p.p_pagini, { plafon: 200, plafon_atins: false, documente_necitite: [], documente_necitite_stare: [], pagini_necitite: [], felii_incomplete: [] })
  assertEquals(f.publica(), { p_licitatie_id: 900001, p_evaluare_id: 11, p_token: p.p_token })
  assertEquals([r.evaluare_id, r.rezumat?.diferente, r.semnale?.length, r.felii, r.fotografie_sha], [11, 1, 1, 2, f.foto.sha])
})

Deno.test('m_revizie_in_timpul_rularii: propune → evaluare_depasita → publica NU e chemată, raportul o spune', async () => {
  const f = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), propuneDepasita: true })
  const r = await RULEAZA(f)
  assertEquals([r.ok, r.evaluare_depasita, f.fn('fn_ofertare_semnale_publica').length, f.fn('fn_ofertare_masuratori_propune').length], [false, true, 0, 1])
  // și la publica: refuzul = raport, fără a doua încercare
  const g = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), publicaRefuz: 'evaluare_depasita' })
  const rg = await RULEAZA(g)
  assertEquals([rg.ok, rg.evaluare_depasita, g.fn('fn_ofertare_semnale_publica').length], [false, true, 1])
  const h = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), publicaRefuz: 'evaluare_necunoscuta' })
  const rh = await RULEAZA(h)
  assertEquals([rh.ok, rh.eroare, h.fn('fn_ofertare_semnale_publica').length], [false, 'publica: evaluare_necunoscuta', 1])
})

Deno.test('m_fara_reincercare: rpc aruncă sau întoarce eroare → raport cu eroare, UN singur apel al acelui RPC, nimic după el', async () => {
  for (const la of ['fn_ofertare_semnale_fotografie', 'fn_ofertare_semnale_context', 'fn_ofertare_semnale_felii', 'fn_ofertare_masuratori_propune', 'fn_ofertare_semnale_publica']) {
    for (const mod of ['aruncaLa', 'eroareLa'] as const) {
      const f = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), [mod]: la })
      const r = await RULEAZA(f)
      assertEquals(r.ok, false, la + ' ' + mod)
      assert(typeof r.eroare === 'string' && r.eroare.length > 0, la + ' ' + mod)
      assertEquals(f.fn(la).length, 1, la + ' ' + mod)
      assertEquals(f.apeluri[f.apeluri.length - 1].fn, la, la + ' ' + mod + ': ultimul apel e cel picat')
    }
  }
  // fotografia cu formă străină ({ok: true}) = eroare, nimic propus
  const g = await fals({ docs: [DOC_F3], fotoStricata: { ok: true } })
  const rg = await RULEAZA(g)
  assertEquals([rg.ok, rg.eroare, g.apeluri.length], [false, 'fotografie: răspuns fără forma fotografiei', 1])
})

Deno.test('m_extragere_intrerupta / m_cost_necunoscut: document fără extragere gata (in_lucru / partial) → documente_necitite cu starea din rulare; comparația tot rulează; fără context / felii pe el', async () => {
  const atrNecitit: DocFals = { ...DOC_ATR, extragere_id: null }
  const f = await fals({ docs: [DOC_F3, atrNecitit], felii: [FELII_TICHET()[0]] })
  const r = await RULEAZA(f, { stareExtrageri: new Map([[2, 'in_lucru (se preia la rularea următoare)']]) })
  assertEquals(r.ok, true)
  const p = f.propune()!.p_pagini as Record<string, unknown>
  assertEquals([p.documente_necitite, p.documente_necitite_stare], [[2], [{ document_id: 2, stare: 'in_lucru (se preia la rularea următoare)' }]])
  // contextul se cere pentru FIECARE document din fotografie (și cel necitit: deciziile lui decid dacă e „necitit”), feliile doar pentru extrageri
  assertEquals(f.fn('fn_ofertare_semnale_context').map((a) => a.args.p_document_id), [1, 2])
  assertEquals(f.fn('fn_ofertare_semnale_felii')[0].args.p_extrageri, [7])
  assertEquals(f.fn('fn_ofertare_semnale_publica').length, 1)
  // cost necunoscut (felie necunoscut → extragere partial, fără autoritativă): la fel, o singură propunere, nicio reîncercare
  const g = await fals({ docs: [DOC_F3, atrNecitit], felii: [FELII_TICHET()[0]] })
  await RULEAZA(g, { stareExtrageri: new Map([[2, 'partial']]) })
  assertEquals([(g.propune()!.p_pagini as any).documente_necitite_stare, g.fn('fn_ofertare_masuratori_propune').length], [[{ document_id: 2, stare: 'partial' }], 1])
  // niciun document cu extragere: context pe fiecare, fără felii, dar propune + publica rulează (toate măsurile → document necitit, decis de server)
  const h = await fals({ docs: [{ ...DOC_F3, extragere_id: null }, atrNecitit] })
  const rh = await RULEAZA(h)
  assertEquals([rh.ok, h.apeluri.map((a) => a.fn)], [true, ['fn_ofertare_semnale_fotografie', 'fn_ofertare_semnale_context', 'fn_ofertare_semnale_context', 'fn_ofertare_masuratori_propune', 'fn_ofertare_semnale_publica']])
  assertEquals((h.propune()!.p_pagini as any).documente_necitite, [1, 2])
  // decizia 15 / abaterea (g): o planșă fără extragere NU e „necitită” (tipul din fotografie nu e extractibil); un document extractibil FĂRĂ
  // text (pagini 0) ESTE
  const plansa: DocFals = { id: 3, tip: 'plansa', nume: 'Plan.pdf', text: '[PLANSA: plan de situatie]', extragere_id: null }
  const faraText: DocFals = { id: 4, tip: 'alta', nume: 'Scan.pdf', text: '', extragere_id: null }
  const k = await fals({ docs: [DOC_F3, DOC_ATR, plansa, faraText], felii: FELII_TICHET() })
  await RULEAZA(k, { stareExtrageri: new Map([[4, 'sarit:fara_text']]) })
  const pk = k.propune()!.p_pagini as any
  assertEquals([pk.documente_necitite, pk.documente_necitite_stare], [[4], [{ document_id: 4, stare: 'sarit:fara_text' }]])
  assertEquals(k.fn('fn_ofertare_semnale_context').map((a) => a.args.p_document_id), [1, 2, 3, 4])
  // fără tipurile extractibile: conservator, toate documentele fără extragere sunt necitite
  const k2 = await fals({ docs: [DOC_F3, DOC_ATR, plansa, faraText], felii: FELII_TICHET() })
  await RULEAZA(k2, { tipuriEligibile: undefined })
  assertEquals((k2.propune()!.p_pagini as any).documente_necitite, [3, 4])
})

Deno.test('r1–r3 P1: „necitit” DOAR din date legate de fotografie — orice document extractibil fără extragere e necitit; îl scoate numai decizia omului nu_e_sursa_cantitativa pe „*” (în decizii_sha); lotul / versiunea nu exclud nimic', async () => {
  const aparut: DocFals = { id: 5, tip: 'cs_volum', nume: 'Caiet nou.pdf', text: '', extragere_id: null }
  const plansa: DocFals = { id: 3, tip: 'plansa', nume: 'Plan.pdf', text: '[PLANSA]', extragere_id: null }
  // document apărut (în fotografie, fără extragere, de tip extractibil) → necitit; contextul e cerut pentru EXACT documentele fotografiei
  const a = await fals({ docs: [DOC_F3, DOC_ATR, plansa, aparut], felii: FELII_TICHET() })
  const ra = await RULEAZA(a)
  assertEquals([ra.ok, a.fn('fn_ofertare_semnale_context').map((x) => x.args.p_document_id)], [true, [1, 2, 3, 5]])
  assertEquals((a.propune()!.p_pagini as any).documente_necitite, [5])
  // decizia omului „nu e sursă cantitativă” pe tot documentul → nu mai e necitit (decizia intră în decizii_sha, deci în fotografie)
  const scos: DocFals = { ...aparut, decizii: [{ id: 9, rol: null, sectiune: '*', decizie: 'nu_e_sursa_cantitativa' }] }
  const b = await fals({ docs: [DOC_F3, DOC_ATR, plansa, scos], felii: FELII_TICHET() })
  await RULEAZA(b)
  assertEquals((b.propune()!.p_pagini as any).documente_necitite, [])
  assert(a.foto.documente[3].decizii_sha !== b.foto.documente[3].decizii_sha && a.foto.sha !== b.foto.sha)
  // decizia doar pe o secțiune („1-2”) sau rol_confirmat → documentul rămâne necitit
  for (const dec of [{ id: 9, rol: null, sectiune: '1-2', decizie: 'nu_e_sursa_cantitativa' }, { id: 9, rol: 'atr', sectiune: '*', decizie: 'rol_confirmat' }]) {
    const c = await fals({ docs: [DOC_F3, DOC_ATR, plansa, { ...aparut, decizii: [dec] }], felii: FELII_TICHET() })
    await RULEAZA(c)
    assertEquals((c.propune()!.p_pagini as any).documente_necitite, [5], JSON.stringify(dec))
  }
  // o versiune veche / un document al altui lot (informații care NU sunt în fotografie) rămân necitite până la decizia omului — conservator
  const vechi: DocFals = { id: 6, tip: 'alta', nume: 'ATR v1.pdf', text: 'vechi', extragere_id: null }
  const d = await fals({ docs: [DOC_F3, DOC_ATR, vechi, aparut], felii: FELII_TICHET() })
  await RULEAZA(d)
  assertEquals((d.propune()!.p_pagini as any).documente_necitite, [5, 6])
  // decizia venită pe alt sha (context cu decizii_sha diferit de fotografie) → context_nepotrivit, nimic propus
  const e = await fals({ docs: [DOC_F3, DOC_ATR, scos], felii: FELII_TICHET() })
  const rpc0 = e.deps.rpc
  e.deps.rpc = async (fn, args) => { const r = await rpc0(fn, args); return fn === 'fn_ofertare_semnale_context' && Number(args.p_document_id) === 5 ? { data: { ...r.data, decizii_sha: 'alt' }, error: null } : r }
  const re = await RULEAZA(e)
  assertEquals([re.ok, re.eroare, e.fn('fn_ofertare_masuratori_propune').length], [false, 'context_nepotrivit', 0])
})

Deno.test('r1 P2 / r2 P2: răspunsul publicării / propunerii se verifică pe TIP (fără conversii) — formă străină = eroare explicită, nu succes', async () => {
  for (const rau of [{}, [], null, 'x', { evaluare_id: 12, semnale: [], n: 0 }, { evaluare_id: 11 }, { evaluare_id: 11, semnale: [{}], n: 0 }, { evaluare_id: 11, semnale: 'x', n: 1 },
    { evaluare_id: 11, semnale: [], n: null }, { evaluare_id: 11, semnale: [], n: false }, { evaluare_id: 11, semnale: [], n: '' }, { evaluare_id: 11, semnale: [], n: [] }, { evaluare_id: 11, semnale: [], n: '0' },
    { evaluare_id: 11, semnale: [{}], n: 1.0000001 }, { evaluare_id: '11', semnale: [], n: 0 }, { evaluare_id: 11.5, semnale: [], n: 0 }, { evaluare_id: true, semnale: [], n: 0 }, { evaluare_id: 0, semnale: [], n: 0 }]) {
    const f = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), publicaRaspuns: rau })
    const r = await RULEAZA(f)
    assertEquals([r.ok, r.eroare, r.semnale, f.fn('fn_ofertare_semnale_publica').length], [false, 'publica: răspuns neconform', undefined, 1], JSON.stringify(rau))
    assert(String(r.detalii).includes('necunoscută'), JSON.stringify(rau))
  }
  for (const rau of [{}, [], null, { evaluare_id: 11 }, { evaluare_id: 11, semnale: [] }, { evaluare_id: 'x', semnale: [], ignorate: [] },
    { evaluare_id: null, semnale: [], ignorate: [] }, { evaluare_id: 0, semnale: [], ignorate: [] }, { evaluare_id: '11', semnale: [], ignorate: [] }, { evaluare_id: 1.5, semnale: [], ignorate: [] },
    { evaluare_id: -3, semnale: [], ignorate: [] }, { evaluare_id: true, semnale: [], ignorate: [] }, { evaluare_id: 11, semnale: null, ignorate: [] }]) {
    const f = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), propuneRaspuns: rau })
    const r = await RULEAZA(f)
    assertEquals([r.ok, r.eroare, f.fn('fn_ofertare_semnale_publica').length], [false, 'propune: răspuns neconform', 0], JSON.stringify(rau))
  }
  // contractul respectat: ok, cu rezumatul din semnalele publicate
  const g = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), semnale: [{ verdict: 'in_regula' }, { verdict: 'diferenta' }] })
  const rg = await RULEAZA(g)
  assertEquals([rg.ok, rg.rezumat?.total, rg.rezumat?.diferente, rg.rezumat?.in_regula], [true, 2, 1, 1])
  // felii ale unei extrageri care nu e în fotografie → felii_straine, nimic propus
  const h = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), feliiStraine: true })
  const rh = await RULEAZA(h)
  assertEquals([rh.ok, rh.eroare, h.fn('fn_ofertare_masuratori_propune').length], [false, 'felii_straine', 0])
})

const SAPTE = () => {
  const felii: FelieServita[] = []
  for (let i = 0; i < 4; i++) felii.push(felieS(1, 7, F3, { felie_nr: i, obs: [obs(F3, '174.000', 10 + i, i), obs(F3, '6.400', 20 + i, i)] }))
  for (let i = 0; i < 3; i++) felii.push(felieS(2, 8, ATR, { felie_nr: i, obs: [obs(ATR, '3.995', 30 + i, i)] }))
  return felii
}
Deno.test('m_felii_paginate: 7 felii logice, limita 3 → 4 apeluri (3 + 3 + 1 + gol), toate în completitudine; deficitul din ultima pagină ajunge în felii_incomplete', async () => {
  const felii = SAPTE()
  felii[6] = felieS(2, 8, ATR, { felie_nr: 2, obs: [] })   // atr fără observații: text liber → nimic
  felii[3] = felieS(1, 7, F3, { felie_nr: 3, obs: [obs(F3, '6.400', 23, 3)] })   // f3 cu un rând omis → deficit (în a doua pagină de rezultate)
  const f = await fals({ docs: [{ ...DOC_F3, felii_distincte: 4 }, { ...DOC_ATR, felii_distincte: 3 }], felii })
  const r = await RULEAZA(f, { limita_felii: 3 })
  assertEquals(r.ok, true)
  const ap = f.fn('fn_ofertare_semnale_felii').map((a) => [a.args.p_dupa_extragere, a.args.p_dupa_felie, a.args.p_limita])
  assertEquals(ap, [[null, null, 3], [7, 2, 3], [8, 1, 3], [8, 2, 3]])
  assertEquals(r.felii, 7)
  assertEquals((f.propune()!.p_pagini as any).felii_incomplete, [{ extragere_id: 7, felie_nr: 3, motiv: 'deficit' }])
  // deficit în ULTIMA pagină (felia 7 = extragerea 8, felie_nr 2) → tot raportat
  const g = await fals({ docs: [{ ...DOC_F3, felii_distincte: 4 }, { ...DOC_ATR, felii_distincte: 3 }], felii: [...SAPTE().slice(0, 6), felieS(2, 8, ATR, { felie_nr: 2, incercari: 2, obs_numar: 1, obs_atribuibile: false })] })
  await RULEAZA(g, { limita_felii: 3 })
  assertEquals((g.propune()!.p_pagini as any).felii_incomplete, [{ extragere_id: 8, felie_nr: 2, motiv: 'observatii_neatribuibile' }])
})

Deno.test('m_felii_paginate: o felie lipsă (Σ felii_distincte 7, primite 6) → eroare felii_trunchiate, propune NU e chemată; rânduri în dezordine → eroare, la fel', async () => {
  const f = await fals({ docs: [{ ...DOC_F3, felii_distincte: 4 }, { ...DOC_ATR, felii_distincte: 3 }], felii: SAPTE(), feliiLipsa: true })
  const r = await RULEAZA(f, { limita_felii: 3 })
  assertEquals([r.ok, r.eroare, f.fn('fn_ofertare_masuratori_propune').length], [false, 'felii_trunchiate', 0])
  const g = await fals({ docs: [{ ...DOC_F3, felii_distincte: 4 }, { ...DOC_ATR, felii_distincte: 3 }], felii: SAPTE(), feliiDezordonate: true })
  const rg = await RULEAZA(g, { limita_felii: 3 })
  assertEquals([rg.ok, rg.eroare, g.fn('fn_ofertare_masuratori_propune').length], [false, 'felii_ordine', 0])
  // mai multe felii decât spune fotografia = tot trunchiere (numărul trebuie să fie EXACT)
  const h = await fals({ docs: [{ ...DOC_F3, felii_distincte: 3 }, { ...DOC_ATR, felii_distincte: 3 }], felii: SAPTE() })
  assertEquals((await RULEAZA(h)).eroare, 'felii_trunchiate')
})

Deno.test('m_context_legat: fotografie_schimbata / text cu alt sha / nume diferit → eroare context_nepotrivit, nimic propus', async () => {
  for (const o of [{ contextRefuz: true }, { contextText: (d: DocFals) => d.text + ' ' }, { contextNume: 'Alt nume.pdf' }]) {
    const f = await fals({ docs: [DOC_F3, DOC_ATR], felii: FELII_TICHET(), ...o })
    const r = await RULEAZA(f)
    assertEquals([r.ok, r.eroare, f.fn('fn_ofertare_semnale_felii').length, f.fn('fn_ofertare_masuratori_propune').length], [false, 'context_nepotrivit', 0, 0], JSON.stringify(Object.keys(o)))
  }
})

Deno.test('m_decizie_schimbata: aceeași extragere veche F3 (ancore, zero observații): fără decizie → deficit; cu decizia atr pe același text → fotografie nouă, context nou, fără deficit', async () => {
  const a = await fals({ docs: [DOC_F3], felii: [felieS(1, 7, F3, {})] })
  await RULEAZA(a)
  assertEquals((a.propune()!.p_pagini as any).felii_incomplete, [{ extragere_id: 7, felie_nr: 0, motiv: 'deficit' }])
  const b = await fals({ docs: [{ ...DOC_F3, decizii: [{ id: 5, rol: 'atr', sectiune: '*', decizie: 'rol_confirmat' }] }], felii: [felieS(1, 7, F3, {})] })
  await RULEAZA(b)
  assert(a.foto.sha !== b.foto.sha && a.foto.documente[0].decizii_sha !== b.foto.documente[0].decizii_sha)
  assertEquals((b.propune()!.p_pagini as any).felii_incomplete, [])
  assertEquals(b.fn('fn_ofertare_semnale_context')[0].args.p_fotografie_sha, b.foto.sha)
})

Deno.test('m_deficit_b1 / m_deficit_cache: felia f3 cu deficit (text + observații din fn_ofertare_semnale_felii) → felii_incomplete; a doua rulare (cache, fără AI) → aceeași listă', async () => {
  const felii = () => [felieS(1, 7, F3, { obs: [obs(F3, '6.400', 2)] })]
  const a = await fals({ docs: [DOC_F3], felii: felii() })
  const b = await fals({ docs: [DOC_F3], felii: felii() })
  await RULEAZA(a); await RULEAZA(b)
  assertEquals((a.propune()!.p_pagini as any).felii_incomplete, [{ extragere_id: 7, felie_nr: 0, motiv: 'deficit' }])
  assertEquals(a.propune()!.p_pagini, b.propune()!.p_pagini)
})

Deno.test('m_neatribuibile_f3 / _atr / _cache / _ordine (r7 P1): felia reluată (incercari 2, obs_atribuibile false, obs []) → observatii_neatribuibile în p_pagini, în F3 și în ATR, și din cache, și în ultima pagină keyset', async () => {
  const neatr = (doc: number, ex: number, text: string, nr = 0) => felieS(doc, ex, text, { felie_nr: nr, incercari: 2, obs_numar: 2, obs_atribuibile: false })
  const f3 = await fals({ docs: [DOC_F3, DOC_ATR], felii: [neatr(1, 7, F3), FELII_TICHET()[1]] })
  await RULEAZA(f3)
  assertEquals((f3.propune()!.p_pagini as any).felii_incomplete, [{ extragere_id: 7, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
  const atr = await fals({ docs: [DOC_F3, DOC_ATR], felii: [FELII_TICHET()[0], neatr(2, 8, ATR)] })
  await RULEAZA(atr)
  assertEquals((atr.propune()!.p_pagini as any).felii_incomplete, [{ extragere_id: 8, felie_nr: 0, motiv: 'observatii_neatribuibile' }])
  const cache = await fals({ docs: [DOC_F3, DOC_ATR], felii: [FELII_TICHET()[0], neatr(2, 8, ATR)] })
  await RULEAZA(cache)
  assertEquals(cache.propune()!.p_pagini, atr.propune()!.p_pagini)
  const ordine = await fals({ docs: [{ ...DOC_F3, felii_distincte: 4 }, { ...DOC_ATR, felii_distincte: 3 }], felii: [...SAPTE().slice(0, 6), neatr(2, 8, ATR, 2)] })
  await RULEAZA(ordine, { limita_felii: 3 })
  assertEquals([(ordine.propune()!.p_pagini as any).felii_incomplete, ordine.fn('fn_ofertare_semnale_felii').length], [[{ extragere_id: 8, felie_nr: 2, motiv: 'observatii_neatribuibile' }], 4])
})

Deno.test('m_fara_ai: DepsMasuratori nu are `ai` (compilare); plafonul din fotografie și paginile peste plafon din rulare intră în inventar', async () => {
  const d: DepsMasuratori = { rpc: async () => ({ data: null, error: null }) }
  // @ts-expect-error — un pas de comparație cu apel AI nu compilează
  const _rau: DepsMasuratori = { rpc: d.rpc, ai: async () => ({ txt: '' }) }
  const f = await fals({ docs: [DOC_F3, { ...DOC_ATR, text: ATR + '⟦PAGINA 2⟧\nx\n⟦PAGINA 3⟧\ny\n' }], felii: FELII_TICHET(), plafon: 3 })
  await RULEAZA(f, { paginiPestePlafon: [{ document_id: 2, pagini: [2, 3] }] })
  const p = f.propune()!.p_pagini as any
  // doc 1 = 1 pagină, doc 2 = 3 pagini, plafon 3 → ultima permisă a lui 2 = 2; peste limită: 3; din rulare: 2, 3 → [2, 3]
  assertEquals([p.plafon, p.plafon_atins, p.pagini_necitite], [3, true, [{ document_id: 2, pagini: [2, 3] }]])
})

// paritate_numar (L19): cantNumar (convenția documentului, pentru extragere) NU decide măsurători — regula spec §3.3 e în SQL
// (fn_ofertare_numar_ro). Testul dovedește că cele două nu se contrazic pe tabelul comun: unde SQL dă valoare, TS dă aceeași sau „ambigua”;
// unde SQL dă motiv (ambiguu / nu e număr), TS nu dă o valoare DIFERITĂ de interpretarea unică a tokenului.
Deno.test('paritate_numar: cazurile din 20270112a_cazuri_numar.json prin cantNumar.valoareInDocument(tok, ro)', async () => {
  const caz = JSON.parse(await Deno.readTextFile(new URL('../../tests/20270112a_cazuri_numar.json', import.meta.url)))
  const decod = (t: string) => t.replace(/\{(NBSP|NNBSP|THSP)\}/g, (_m, k) => String.fromCharCode(caz._marcaje['{' + k + '}'][0]))
  assert(caz.cazuri.length >= 20)
  let valori = 0, motive = 0
  for (const c of caz.cazuri) {
    const text = decod(c.text)
    // tokenul așa cum ajunge în pipeline: tokeniNumerici (scoate spațiile de mii); textul trebuie să fie UN token întreg, altfel nu e număr
    const toks = tokeniNumerici(text)
    const tok = toks.length === 1 && toks[0].de_la === 0 && toks[0].pana_la === text.length ? toks[0].text : null
    const ts = tok === null ? null : valoareInDocument(tok, 'ro')
    if (c.valoare !== undefined) {
      valori++
      assert(ts === 'ambigua' || ts === Number(c.valoare), `${c.text}: SQL ${c.valoare}, TS ${String(ts)}`)
    } else {
      motive++
      if (typeof ts === 'number') {
        const unice = interpretari(tok as string)
        assertEquals(unice, [ts], `${c.text}: SQL ${c.motiv}, TS ${ts} nu e interpretarea unică`)
      }
    }
  }
  assert(valori >= 12 && motive >= 8)
  // documentat: „1.23” e ambiguu pentru SQL (format_numeric_ambiguu), iar TS îl citește 1.23 ca singura interpretare — de aceea valoarea
  // unei măsurători vine DOAR din SQL, iar cantNumar rămâne la extragere
  assertEquals(valoareInDocument('1.23', 'ro'), 1.23)
  assertEquals(caz.cazuri.find((c: any) => c.text === '1.23').motiv, 'format_numeric_ambiguu')
})
