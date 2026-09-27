// deno test -A --node-modules-dir=none worker/ofertare/plansa_test.ts — coada de planșe (#142), fără rețea și fără AI.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { corpRunda, motivAnulare, clasifica, proceseazaPlansa, PLAFON_IMPLICIT_USD } from './plansa.ts'

const JOB = { id: 7, doc_id: 470, mod: 'citeste', taiat_la: 't1', cale_felii: 'c1', cost_usd: 0, runde: 0, jurnal: [], incercari: 1, max_incercari: 3, cerut_de: 'u1', plafon_usd: null }
const docCu = (ca: any = null, p: any = {}) => ({ id: 470, licitatie_id: 95, analiza: { plansa: { taiat_la: 't1', cale_felii: 'c1', ...p }, ...(ca ? { citire_ai: ca } : {}) } })

// Supabase simulat: coada (un rând), documentul, notificările; UPDATE condiționat pe luat_de + stare='lucru'.
function fakeSupa(o: { job?: any; doc?: any; rpcErr?: any; pierdeLeaseLa?: number } = {}) {
  const st = { job: o.job ? { ...o.job, stare: 'lucru', luat_de: 'w1' } : null, doc: o.doc, notif: [] as any[], updates: 0 }
  return {
    st,
    rpc: async (_n: string, _a: any) => o.rpcErr ? { data: null, error: o.rpcErr } : { data: st.job ? [st.job] : [], error: null },
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
              if (o.pierdeLeaseLa && st.updates >= o.pierdeLeaseLa) st.job.luat_de = 'alt'
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
  assertEquals(clasifica(200, {}), 'ok')
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
  const s = fakeSupa({ job: { ...JOB, cost_usd: PLAFON_IMPLICIT_USD }, doc: docCu() })
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
  const s = fakeSupa({ job: JOB, doc: docCu(), pierdeLeaseLa: 1 })
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
