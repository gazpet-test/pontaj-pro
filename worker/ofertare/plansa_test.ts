// deno test -A --node-modules-dir=none worker/ofertare/plansa_test.ts — coada de planșe (#142), fără rețea și fără AI.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { corpRunda, motivAnulare, clasifica, proceseazaPlansa, fetchCuTimeout, PLAFON_IMPLICIT_USD, REZERVA_RUNDA_USD } from './plansa.ts'

const JOB = { id: 7, doc_id: 470, licitatie_id: 95, claim_token: 'tok1', mod: 'citeste', taiat_la: 't1', cale_felii: 'c1', cost_usd: 0, runde: 0, jurnal: [], incercari: 1, max_incercari: 3, cerut_de: 'u1', plafon_usd: null }
const docCu = (ca: any = null, p: any = {}) => ({ id: 470, licitatie_id: 95, analiza: { plansa: { taiat_la: 't1', cale_felii: 'c1', ...p }, ...(ca ? { citire_ai: ca } : {}) } })

// Supabase simulat: coada (un rând), documentul, notificările; UPDATE condiționat pe luat_de + stare='lucru'.
function fakeSupa(o: { job?: any; doc?: any; rpcErr?: any; pierdeLeaseLa?: number; costZi?: number } = {}) {
  const st = { job: o.job ? { ...o.job, stare: 'lucru', luat_de: 'w1' } : null, doc: o.doc, notif: [] as any[], updates: 0 }
  return {
    st,
    rpc: async (n: string, _a: any) => n === 'ofertare_plansa_cost_zi' ? { data: o.costZi ?? 0, error: null } : o.rpcErr ? { data: null, error: o.rpcErr } : { data: st.job ? [{ ...st.job }] : [], error: null },
    from: (t: string) => {
      if (t === 'notifications') return { insert: async (r: any) => { st.notif.push(r); return { error: null } } }
      if (t === 'ofertare_documente_atribuire') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: st.doc }) }) }) }
      // ofertare_plansa_coada
      return {
        update: (patch: any) => {
          const conds: Record<string, unknown> = {}
          const q: any = {
            eq: (k: string, v: unknown) => { conds[k] = v; return q },
            select: async () => {
              st.updates++
              if (o.pierdeLeaseLa && st.updates >= o.pierdeLeaseLa) st.job.claim_token = 'alt'
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
