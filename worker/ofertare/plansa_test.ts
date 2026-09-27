// deno test -A --node-modules-dir=none worker/ofertare/plansa_test.ts — coada de planșe (#142), fără rețea și fără AI.
import { ok as assert, deepStrictEqual as assertEquals } from 'node:assert/strict'
import { corpRunda, motivAnulare, clasifica, proceseazaPlansa, fetchCuTimeout, PLAFON_IMPLICIT_USD, REZERVA_RUNDA_USD } from './plansa.ts'

const JOB = { id: 7, doc_id: 470, licitatie_id: 95, claim_token: 'tok1', mod: 'citeste', taiat_la: 't1', cale_felii: 'c1', cost_usd: 0, runde: 0, jurnal: [], incercari: 1, max_incercari: 3, cerut_de: 'u1', plafon_usd: null }
const docCu = (ca: any = null, p: any = {}) => ({ id: 470, licitatie_id: 95, analiza: { plansa: { taiat_la: 't1', cale_felii: 'c1', ...p }, ...(ca ? { citire_ai: ca } : {}) } })

// RPC-ul simulat execută verificare + inserare fără await între ele (secțiune serială, comună joburilor concurente).
function fakeSupa(o: { job?: any; doc?: any; rpcErr?: any; pierdeLeaseLa?: number; costZi?: number;
  buget?: { rows: any[]; costZi: number }; manifest?: any[]; manifestError?: any; regularizareError?: boolean;
  laRezervare?: (st: any, id: number) => void } = {}) {
  const st = { job: o.job ? { ...o.job, stare: 'lucru', luat_de: 'w1' } : null, doc: o.doc, notif: [] as any[], updates: 0 }
  const buget = o.buget ?? { rows: [] as any[], costZi: o.costZi ?? 0 }
  if (st.job?.cost_usd) buget.rows.push({ id: buget.rows.length + 1, job_id: st.job.id, cost_usd: st.job.cost_usd, stare: 'regularizat' })
  const sumaJob = () => buget.rows.filter(r => r.job_id === st.job.id).reduce((s, r) => s + (r.cost_usd ?? r.rezervat_usd), 0)
  const verificaLease = () => {
    st.updates++
    if (o.pierdeLeaseLa && st.updates >= o.pierdeLeaseLa) st.job.claim_token = 'alt'
  }
  return {
    st, buget,
    rpc: async (n: string, a: any) => {
      if (o.rpcErr) return { data: null, error: o.rpcErr }
      if (n === 'ofertare_plansa_coada_ia') return { data: st.job ? [{ ...st.job }] : [], error: null }
      if (n === 'ofertare_plansa_rezerva') {
        verificaLease()
        let motiv: string | undefined
        if (st.job.stare !== 'lucru' || st.job.claim_token !== a.p_claim_token) motiv = 'lease'
        else if (sumaJob() + a.p_suma > (st.job.plafon_usd ?? 10)) motiv = 'plafon job'
        else if (buget.costZi + buget.rows.reduce((s, r) => s + (r.cost_usd ?? r.rezervat_usd), 0) + a.p_suma > a.p_plafon_zi) motiv = 'plafon pe zi'
        if (motiv) return { data: { ok: false, motiv }, error: null }
        const id = buget.rows.length + 1
        buget.rows.push({ id, job_id: a.p_job_id, claim_token: a.p_claim_token, rezervat_usd: a.p_suma, cost_usd: null, stare: 'rezervat' })
        st.job.cost_usd = sumaJob()
        o.laRezervare?.(st, id)
        return { data: { ok: true, rezervare_id: id }, error: null }
      }
      if (n === 'ofertare_plansa_regularizeaza') {
        if (o.regularizareError) return { data: null, error: { message: 'indisponibil' } }
        const r = buget.rows.find(r => r.id === a.p_rezervare_id && r.claim_token === a.p_claim_token)
        if (!r) return { data: { ok: false, motiv: 'lease' }, error: null }
        if (r.stare === 'rezervat') {
          r.cost_usd = a.p_cert ? a.p_cost : Math.max(a.p_cost ?? 0, r.rezervat_usd)
          r.stare = a.p_cert ? 'regularizat' : 'incert'
        }
        st.job.cost_usd = sumaJob()
        return { data: { ok: true, cost_usd: st.job.cost_usd }, error: null }
      }
      throw new Error(`RPC neașteptat: ${n}`)
    },
    from: (t: string) => {
      if (t === 'notifications') return { insert: async (r: any) => { st.notif.push(r); return { error: null } } }
      if (t === 'ofertare_documente_atribuire') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: st.doc }) }) }) }
      if (t === 'ofertare_seap_manifest') return { select: () => ({ eq: (k: string, v: any) => {
        assertEquals([k, v], ['document_id', st.job.doc_id])
        return { eq: async (k: string, v: any) => {
          assertEquals([k, v], ['stare', 'deja_in_platforma'])
          return { data: o.manifest ?? [], error: o.manifestError }
        } }
      } }) }
      // ofertare_plansa_coada
      return {
        update: (patch: any) => {
          const conds: Record<string, unknown> = {}
          const q: any = {
            eq: (k: string, v: unknown) => { conds[k] = v; return q },
            select: async () => {
              verificaLease()
              const potriveste = st.job && Object.entries(conds).every(([k, v]) => st.job[k] === v)
              if (!potriveste) return { data: [], error: null }
              Object.assign(st.job, patch)
              return { data: [{ id: st.job.id }], error: null }
            },
          }
          return q
        },
      }
    },
  }
}

const raspunsuri = (lista: Array<[number, any]>) => {
  const apeluri: any[] = []
  const handler = async (req: Request) => {
    apeluri.push(await req.json())
    const [s, b] = lista.shift() ?? [200, { continua: false, sumar: { erori: 0 } }]
    if (s === -1) return new Response('nu e json', { status: 200 })
    return new Response(JSON.stringify(b), { status: s })
  }
  return { handler, apeluri }
}
const deps = (supabase: any, handler: any) => ({ supabase, handler, depsHandler: { SERVICE: 'svc' }, worker: 'w1', sleep: async () => {} })

Deno.test('corpRunda: citire nouă doar fără citire pe tăierea jobului; altfel continua (niciodată de_la:0 peste o citire existentă)', () => {
  assertEquals(corpRunda(JOB, docCu()).de_la, 0)
  assertEquals(corpRunda(JOB, docCu({ taiat_la: 'vechi' })).de_la, 0)
  assertEquals(corpRunda(JOB, docCu({ taiat_la: 't1' })).mod, 'continua')
  assertEquals(corpRunda(JOB, docCu({ taiat_la: 't1' }), { deLa: 8 }).de_la, 8)
  assertEquals(corpRunda({ ...JOB, mod: 'continua' }, docCu()).mod, 'continua')
  const r = corpRunda({ ...JOB, mod: 'reia_erori' }, docCu({ taiat_la: 't1' }), { sari: ['z1'] })
  assertEquals([r.mod, r.sari], ['reia_erori', ['z1']])
})

Deno.test('motivAnulare: retăiere / felii schimbate / necitibilă / document șters', () => {
  assertEquals(motivAnulare(JOB, docCu()), null)
  assert(motivAnulare(JOB, docCu(null, { taiat_la: 't2' }))?.includes('retăiată'))
  assert(motivAnulare(JOB, docCu(null, { cale_felii: 'c2' }))?.includes('feliile'))
  assert(motivAnulare(JOB, docCu(null, { citibila: false }))?.includes('necitibilă'))
  assert(motivAnulare(JOB, null)?.includes('nu mai există'))
})

Deno.test('clasifica: 409 cu in_lucru = alt tab; 409 fără = anulat; 5xx/429 = furnizor; 4xx = business', () => {
  assertEquals(clasifica(200, { continua: false }), 'ok')
  assertEquals(clasifica(200, {}), 'invalid')
  assertEquals(clasifica(200, { error: 'x', continua: false }), 'invalid')
  assertEquals(clasifica(409, { in_lucru: ['z1'] }), 'alt_tab')
  assertEquals(clasifica(409, { error: 'altă tăiere' }), 'anulat')
  assertEquals(clasifica(529, {}), 'furnizor')
  assertEquals(clasifica(429, {}), 'furnizor')
  assertEquals(clasifica(403, {}), 'business')
})

Deno.test('flux complet: două runde, apoi gata + notificare; a doua rundă e continua, nu de_la:0', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu() })
  const h = raspunsuri([[200, { continua: true, de_la_urmator: 4, cost_usd: 0.5, citite_acum: 4 }], [200, { continua: false, cost_usd: 0.3, sumar: { erori: 0, tronsoane_gasite: 5 } }]])
  s.st.doc = docCu()
  const hWrap = async (req: Request, x: any) => { const r = await h.handler(req); s.st.doc = docCu({ taiat_la: 't1' }); return r }
  assertEquals(await proceseazaPlansa(deps(s, hWrap)), true)
  assertEquals(h.apeluri[0].de_la, 0)
  assertEquals(h.apeluri[1].de_la, 4)
  assertEquals(s.st.job.stare, 'gata')
  assertEquals(s.st.job.runde, 2)
  assertEquals(Number(s.st.job.cost_usd.toFixed(2)), 0.8)
  assertEquals(s.st.notif.length, 1)
})

Deno.test('409 alt tab: pauză și reluare pe continua, fără cost suplimentar', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu({ taiat_la: 't1' }) })
  const h = raspunsuri([[409, { in_lucru: ['z2'], cost_usd: 0 }], [200, { continua: false, sumar: { erori: 1 } }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.map(a => a.mod), ['continua', 'continua'])
  assertEquals(s.st.job.stare, 'partial')
})

Deno.test('plafon: peste plafon nu se mai face niciun apel AI', async () => {
  const s = fakeSupa({ job: { ...JOB, cost_usd: PLAFON_IMPLICIT_USD - REZERVA_RUNDA_USD + 0.01 }, doc: docCu() })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 0)
  assertEquals(s.st.job.stare, 'oprit_plafon')
})

Deno.test('retăiere după înscriere: anulat, zero AI', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu(null, { taiat_la: 't2' }) })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 0)
  assertEquals(s.st.job.stare, 'anulat')
})

Deno.test('lease pierdut după prima rundă: workerul se oprește, fără alt apel AI', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu(), pierdeLeaseLa: 2 })
  const h = raspunsuri([[200, { continua: true, de_la_urmator: 4, cost_usd: 0.5 }], [200, { continua: false }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 1)
})

Deno.test('eroare de furnizor: înapoi în așteptare cu backoff; la ultima încercare = eroare', async () => {
  const s1 = fakeSupa({ job: JOB, doc: docCu() })
  await proceseazaPlansa(deps(s1, raspunsuri([[529, { error: 'overloaded' }]]).handler))
  assertEquals(s1.st.job.stare, 'asteapta')
  assert(new Date(s1.st.job.urmatoarea_la).getTime() > Date.now())
  const s2 = fakeSupa({ job: { ...JOB, incercari: 3 }, doc: docCu() })
  await proceseazaPlansa(deps(s2, raspunsuri([[529, { error: 'overloaded' }]]).handler))
  assertEquals(s2.st.job.stare, 'eroare')
})

Deno.test('migrarea neaplicată (RPC lipsă): nimic de făcut, fără excepție', async () => {
  const s = fakeSupa({ rpcErr: { code: 'PGRST202', message: 'Could not find the function' } })
  assertEquals(await proceseazaPlansa(deps(s, raspunsuri([]).handler)), false)
})

// ---- Copilot #494 (27.09): reproducerile lui, acum regresii ----
Deno.test('plafon job: 9,90 consumat + rezervarea rundei > 10 → oprit_plafon ÎNAINTE de apel (nu 10,40 și gata)', async () => {
  assertEquals(PLAFON_IMPLICIT_USD, 10)
  const s = fakeSupa({ job: { ...JOB, cost_usd: 9.9 }, doc: docCu() })
  const h = raspunsuri([[200, { continua: false, cost_usd: 0.5, sumar: { erori: 0 } }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 0)
  assertEquals(s.st.job.stare, 'oprit_plafon')
})

Deno.test('plafon pe zi: 38 consumați azi de alte joburi + rezervarea > 40 → zero AI', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu(), costZi: 38 })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 0)
  assertEquals(s.st.job.stare, 'oprit_plafon')
  assert(String(s.st.job.eroare).includes('pe zi'))
})

Deno.test('200 cu {error} / JSON invalid → eroare, nu gata', async () => {
  for (const r of [[200, { error: 'boom' }], [-1, null]] as any[]) {
    const s = fakeSupa({ job: JOB, doc: docCu() })
    await proceseazaPlansa(deps(s, raspunsuri([r]).handler))
    assertEquals(s.st.job.stare, 'eroare')
    assertEquals(s.st.notif[0].type, 'warning')
  }
})

Deno.test('MAX_RUNDE atins cu continua=true → partial cu motiv, nu gata', async () => {
  const s = fakeSupa({ job: { ...JOB, mod: 'continua', plafon_usd: 1000 }, doc: docCu({ taiat_la: 't1' }) })
  const lista: any[] = Array.from({ length: 30 }, () => [200, { continua: true, cost_usd: 0, sumar: { erori: 0 } }])
  await proceseazaPlansa({ ...deps(s, raspunsuri(lista).handler), plafonZiUsd: 1e6 })
  assertEquals(s.st.job.stare, 'partial')
  assert(String(s.st.job.eroare).includes('runde'))
})

Deno.test('lipirea necesară eșuează (500) → partial, nu gata', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu({ taiat_la: 't1' }) })
  const h = raspunsuri([[200, { continua: false, lipire_necesara: 2, sumar: { erori: 0 } }], [500, { error: 'lipire' }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 2)
  assertEquals(s.st.job.stare, 'partial')
})

Deno.test('retăiere în pauza 409 → anulat, fără al doilea apel (nu de_la:0 pe t2)', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu({ taiat_la: 't1' }) })
  const h = raspunsuri([[409, { in_lucru: ['z1'] }], [200, { continua: false }]])
  const sleep = async () => { s.st.doc = docCu(null, { taiat_la: 't2' }) }
  await proceseazaPlansa({ ...deps(s, h.handler), sleep })
  assertEquals(h.apeluri.length, 1)
  assertEquals(s.st.job.stare, 'anulat')
})

Deno.test('document mutat pe altă licitație → anulat, zero AI', async () => {
  const s = fakeSupa({ job: JOB, doc: { ...docCu(), licitatie_id: 96 } })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 0)
  assertEquals(s.st.job.stare, 'anulat')
})

Deno.test('execuție veche cu același nume de worker, după re-claim (alt token) → nu scrie nimic', async () => {
  // după claim, jobul e preluat din nou (alt token), chiar de un worker tot „w1” — execuția noastră are tok1
  const s = fakeSupa({ job: JOB, doc: docCu(), pierdeLeaseLa: 1 })
  const h = raspunsuri([[200, { continua: false, sumar: { erori: 0 } }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(h.apeluri.length, 0, 'rezervarea de buget nu se poate scrie => stop înainte de AI')
  assertEquals(s.st.job.stare, 'lucru')
})

Deno.test('fetchCuTimeout: signal-ul apelantului nu anulează timeoutul', async () => {
  let vazut: AbortSignal | undefined
  const f = fetchCuTimeout((async (_u: any, i: any) => { vazut = i.signal; return new Response('') }) as any, 20)
  await f('x', { signal: new AbortController().signal })
  await new Promise(r => setTimeout(r, 60))
  assert(vazut?.aborted, 'timeoutul trebuie să se aplice și cu signal existent')
})

// ---- Copilot #494 runda 3: registru atomic + cost incert + identitate ----
Deno.test('două joburi concurente: 36 + 3 + 3 → exact o rezervare și un apel AI', async () => {
  const buget = { rows: [] as any[], costZi: 36 }
  const s1 = fakeSupa({ job: JOB, doc: docCu(), buget })
  const s2 = fakeSupa({ job: { ...JOB, id: 8 }, doc: docCu(), buget })
  const h = raspunsuri([[200, { continua: false, cost_usd: 3, sumar: { erori: 0 } }]])
  await Promise.all([proceseazaPlansa(deps(s1, h.handler)), proceseazaPlansa(deps(s2, h.handler))])
  assertEquals(h.apeluri.length, 1)
  assertEquals(buget.rows.length, 1)
  assertEquals([s1.st.job.stare, s2.st.job.stare].sort(), ['gata', 'oprit_plafon'])
})

Deno.test('excepție după cheltuială: incert ≥ rezervare; retry păstrează costul și respectă plafonul', async () => {
  const s = fakeSupa({ job: { ...JOB, plafon_usd: 5 }, doc: docCu() })
  let apeluri = 0
  const handler = async () => { apeluri++; throw new Error('conexiune ruptă după plata AI') }
  await proceseazaPlansa(deps(s, handler))
  assertEquals(s.buget.rows[0].stare, 'incert')
  assert(s.buget.rows[0].cost_usd >= REZERVA_RUNDA_USD)
  assertEquals(s.st.job.cost_usd, 3)
  assertEquals(s.st.job.stare, 'asteapta')
  Object.assign(s.st.job, { stare: 'lucru', claim_token: 'tok2', incercari: 2 })
  await proceseazaPlansa(deps(s, handler))
  assertEquals(apeluri, 1)
  assertEquals(s.st.job.stare, 'oprit_plafon')
  assertEquals(s.st.job.cost_usd, 3)
})

Deno.test('cost absent/null/string/negativ și JSON invalid: incert; cost numeric zero: regularizat', async () => {
  for (const cost of [undefined, null, '0', -1, 0]) {
    const s = fakeSupa({ job: JOB, doc: docCu() })
    await proceseazaPlansa(deps(s, raspunsuri([[200, { continua: false, cost_usd: cost, sumar: { erori: 0 } }]]).handler))
    assertEquals(s.buget.rows[0].stare, cost === 0 ? 'regularizat' : 'incert')
    assertEquals(s.st.job.cost_usd, cost === 0 ? 0 : 3)
  }
  const s = fakeSupa({ job: JOB, doc: docCu() })
  await proceseazaPlansa(deps(s, raspunsuri([[-1, null]]).handler))
  assertEquals(s.buget.rows[0].stare, 'incert')
  assertEquals(s.st.job.cost_usd, 3)
})

Deno.test('lipire: 200 JSON invalid / fără perechi / error / excepție → partial; contract valid → gata', async () => {
  for (const [status, body, final] of [
    [-1, null, 'partial'], [200, {}, 'partial'], [200, { perechi: '2' }, 'partial'],
    [200, { perechi: 2, error: 'eșec', cost_usd: 0.2 }, 'partial'],
    [200, { perechi: 0, cost_usd: 0 }, 'gata'], [599, null, 'partial'],
  ] as Array<[number, any, string]>) {
    const s = fakeSupa({ job: JOB, doc: docCu() })
    const h = raspunsuri([[200, { continua: false, cost_usd: 0.5, lipire_necesara: 2, sumar: { erori: 0 } }], [status, body]])
    const handler = async (req: Request) => {
      if (h.apeluri.length === 1 && status === 599) throw new Error('căzut după plata lipirii')
      return await h.handler(req)
    }
    await proceseazaPlansa(deps(s, handler))
    assertEquals(s.st.job.stare, final)
    assertEquals(s.buget.rows[1].stare, typeof body?.cost_usd === 'number' ? 'regularizat' : 'incert')
    assertEquals(s.st.job.cost_usd, 0.5 + (body?.cost_usd ?? 1))
  }
})

Deno.test('fisier_path schimbat → anulat, zero AI și zero rezervări', async () => {
  const s = fakeSupa({ job: { ...JOB, fisier_path: 'vechi.pdf' }, doc: { ...docCu(), fisier_path: 'nou.pdf' } })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(s.st.job.stare, 'anulat')
  assertEquals(s.st.job.motiv_anulare, 'fișierul s-a schimbat după înscriere')
  assertEquals([h.apeluri.length, s.buget.rows.length], [0, 0])
})

Deno.test('manifest: A+B sau doar B → anulat; doar A (inclusiv duplicate) → acceptat; lipsă hash valid → jurnal neverificata', async () => {
  for (const [hashuri, final, neverificata] of [
    [['b'.repeat(64)], 'anulat', false], [['b'.repeat(64), 'A'.repeat(64)], 'anulat', false],
    [['a'.repeat(64)], 'gata', false], [['a'.repeat(64), 'A'.repeat(64), 'invalid'], 'gata', false],
    [[], 'gata', true], [[null, '', 'invalid'], 'gata', true],
  ] as Array<[any[], string, boolean]>) {
    const s = fakeSupa({ job: { ...JOB, doc_sha256: 'a'.repeat(64) }, doc: docCu(), manifest: hashuri.map(sha256 => ({ sha256 })) })
    const h = raspunsuri([[200, { continua: false, cost_usd: 0, sumar: { erori: 0 } }]])
    await proceseazaPlansa(deps(s, h.handler))
    assertEquals(s.st.job.stare, final)
    assertEquals(h.apeluri.length, final === 'anulat' ? 0 : 1)
    if (final === 'anulat') {
      assertEquals(s.buget.rows.length, 0)
      assertEquals(s.st.job.motiv_anulare, hashuri.length > 1
        ? 'identitate contradictorie în manifest — de rezolvat înainte de citire' : 'fișierul s-a schimbat după înscriere')
    }
    assertEquals(s.st.job.jurnal.some((r: any) => r.identitate === 'neverificata'), neverificata)
  }
})

// ---- Copilot #494 runda 4: fereastra rezervării + contractul răspunsului final ----
Deno.test('retăiere în RPC-ul de rezervare: anulat, zero apeluri, rezervare regularizată cost 0 cert', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu(), laRezervare: st => { st.doc = docCu(null, { taiat_la: 't2' }) } })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals([s.st.job.stare, h.apeluri.length, s.st.job.cost_usd], ['anulat', 0, 0])
  assertEquals(s.buget.rows.map(r => [r.stare, r.cost_usd]), [['regularizat', 0]])
})

Deno.test('manifest schimbat în rezervare: recitit înainte de AI, anulare cu cost 0', async () => {
  const manifest = [{ sha256: 'a'.repeat(64) }]
  const s = fakeSupa({ job: { ...JOB, doc_sha256: 'a'.repeat(64) }, doc: docCu(), manifest,
    laRezervare: () => { manifest.push({ sha256: 'b'.repeat(64) }) } })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals([s.st.job.stare, h.apeluri.length, s.st.job.cost_usd], ['anulat', 0, 0])
  assertEquals(manifest.length, 2, 'nu șterge istoricul manifestului')
  assertEquals(s.buget.rows[0].stare, 'regularizat')
})

Deno.test('retăiere în rezervarea lipirii: fără apel de lipire, costul citirii păstrat', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu(), laRezervare: (st, id) => {
    if (id === 2) st.doc = docCu(null, { cale_felii: 'c2' })
  } })
  const h = raspunsuri([[200, { continua: false, cost_usd: 0.5, lipire_necesara: 1, sumar: { erori: 0 } }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals([s.st.job.stare, h.apeluri.length, s.st.job.cost_usd], ['anulat', 1, 0.5])
  assertEquals(s.buget.rows.map(r => [r.stare, r.cost_usd]), [['regularizat', 0.5], ['regularizat', 0]])
})

Deno.test('sumar intermediar urmat de răspuns final fără sumar obiect → partial, fără rezultat vechi sau lipire', async () => {
  for (const sumar of [undefined, null, [], 'invalid', 1]) {
    const vechi = { erori: 0, tronsoane_gasite: 99 }
    const s = fakeSupa({ job: JOB, doc: docCu() })
    const h = raspunsuri([[200, { continua: true, cost_usd: 0, sumar: vechi }],
      [200, { continua: false, cost_usd: 0, lipire_necesara: 1, sumar }]])
    await proceseazaPlansa(deps(s, h.handler))
    assertEquals([s.st.job.stare, s.st.job.eroare, s.st.job.rezultat], ['partial', 'răspuns final fără sumar', null])
    assertEquals(h.apeluri.length, 2)
    assertEquals(s.st.job.jurnal.filter((r: any) => r.status)[0].sumar, vechi)
  }
})

Deno.test('sumarul final înlocuiește sumarul intermediar; asteptat prezent în toate modurile și la lipire', async () => {
  const job = { ...JOB, fisier_path: 'original.pdf' }
  const asteptat = { licitatie_id: job.licitatie_id, fisier_path: job.fisier_path, taiat_la: job.taiat_la, cale_felii: job.cale_felii }
  for (const body of [corpRunda(job, docCu()), corpRunda(job, docCu({ taiat_la: 't1' })),
    corpRunda(job, docCu({ taiat_la: 't1' }), { deLa: 4 }),
    corpRunda({ ...job, mod: 'continua' }, docCu()), corpRunda({ ...job, mod: 'reia_erori' }, docCu())])
    assertEquals(body.asteptat, asteptat)
  const s = fakeSupa({ job, doc: { ...docCu(), fisier_path: job.fisier_path } })
  const h = raspunsuri([[200, { continua: true, cost_usd: 0, sumar: { erori: 2 } }],
    [200, { continua: false, cost_usd: 0.5, lipire_necesara: 1, sumar: { erori: 0, tronsoane_gasite: 5 } }],
    [200, { perechi: 1, cost_usd: 0.2 }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(s.st.job.stare, 'gata')
  assertEquals(s.st.job.rezultat.tronsoane, 5)
  assertEquals(h.apeluri.length, 3)
  for (const body of h.apeluri) assertEquals(body.asteptat, asteptat)
})

Deno.test('409 retăiere din handler la citire sau lipire → anulat, cost 0 regularizat pentru apelul refuzat', async () => {
  for (const lipire of [false, true]) {
    const s = fakeSupa({ job: JOB, doc: docCu() })
    const lista: Array<[number, any]> = lipire
      ? [[200, { continua: false, cost_usd: 0.5, lipire_necesara: 1, sumar: { erori: 0 } }]] : []
    lista.push([409, { error: 'Documentul nu mai corespunde jobului — anulat', cost_usd: 0 }])
    const h = raspunsuri(lista)
    await proceseazaPlansa(deps(s, h.handler))
    assertEquals(s.st.job.stare, 'anulat')
    assertEquals(s.st.job.cost_usd, lipire ? 0.5 : 0)
    assertEquals(s.buget.rows.at(-1).stare, 'regularizat')
  }
})

Deno.test('manifest indisponibil → eroare, zero AI (nu e echivalent cu lipsa hash-urilor)', async () => {
  for (const doc_sha256 of [null, 'a'.repeat(64)]) {
    const s = fakeSupa({ job: { ...JOB, doc_sha256 }, doc: docCu(), manifestError: { message: 'indisponibil' } })
    const h = raspunsuri([])
    await proceseazaPlansa(deps(s, h.handler))
    assertEquals(s.st.job.stare, 'eroare')
    assertEquals([h.apeluri.length, s.buget.rows.length], [0, 0])
  }
})

// #494 r5: manifestul se verifică și fără hash înghețat în job.
Deno.test('job cu hash NULL: manifest A/B → anulat; un singur hash valid → gata, identitate neverificata', async () => {
  for (const hashuri of [[], ['invalid'], ['a'.repeat(64)], ['a'.repeat(64), 'A'.repeat(64), 'invalid'],
    ['a'.repeat(64), 'b'.repeat(64)]]) {
    const contradictoriu = hashuri.includes('b'.repeat(64))
    const s = fakeSupa({ job: { ...JOB, doc_sha256: null }, doc: docCu(), manifest: hashuri.map(sha256 => ({ sha256 })) })
    const h = raspunsuri([[200, { continua: false, cost_usd: 0, sumar: { erori: 0 } }]])
    await proceseazaPlansa(deps(s, h.handler))
    assertEquals(s.st.job.stare, contradictoriu ? 'anulat' : 'gata')
    assertEquals([h.apeluri.length, s.buget.rows.length], contradictoriu ? [0, 0] : [1, 1])
    if (contradictoriu) assertEquals(s.st.job.motiv_anulare, 'identitate contradictorie în manifest — de rezolvat înainte de citire')
    assert(s.st.job.jurnal.some((r: any) => r.identitate === 'neverificata'))
    assertEquals(s.st.job.doc_sha256, null)
  }
})

Deno.test('job cu hash NULL: contradicție apărută în rezervare → anulat înainte de AI, cost 0', async () => {
  const manifest = [{ sha256: 'a'.repeat(64) }]
  const s = fakeSupa({ job: { ...JOB, doc_sha256: null }, doc: docCu(), manifest,
    laRezervare: () => { manifest.push({ sha256: 'b'.repeat(64) }) } })
  const h = raspunsuri([])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals([s.st.job.stare, h.apeluri.length, s.st.job.cost_usd], ['anulat', 0, 0])
  assertEquals(s.buget.rows.map(r => [r.stare, r.cost_usd]), [['regularizat', 0]])
})

Deno.test('regularizare indisponibilă → stop; rezervarea și costul cozii nu sunt suprascrise cu zero', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu(), regularizareError: true })
  const h = raspunsuri([[200, { continua: true, cost_usd: 0.5 }]])
  await proceseazaPlansa(deps(s, h.handler))
  assertEquals(s.st.job.stare, 'eroare')
  assertEquals(h.apeluri.length, 1)
  assertEquals(s.buget.rows[0].stare, 'rezervat')
  assertEquals(s.st.job.cost_usd, 3)
})

Deno.test('răspuns din claim vechi: regularizează costul propriu, fără suprascrierea noului job', async () => {
  const s = fakeSupa({ job: JOB, doc: docCu() })
  const h = raspunsuri([[200, { continua: true, cost_usd: 0.5 }]])
  await proceseazaPlansa(deps(s, async (req: Request) => {
    s.st.job.claim_token = 'nou'
    s.buget.rows.push({ id: 2, job_id: JOB.id, claim_token: 'nou', rezervat_usd: 3, cost_usd: null, stare: 'rezervat' })
    return await h.handler(req)
  }))
  assertEquals(h.apeluri.length, 1)
  assertEquals(s.st.job.stare, 'lucru')
  assertEquals(s.st.job.claim_token, 'nou')
  assertEquals(s.st.job.cost_usd, 3.5)
})
