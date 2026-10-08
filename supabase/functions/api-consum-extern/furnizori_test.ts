// deno test supabase/functions/api-consum-extern — fără rețea: fetch simulat.
import { assertEquals } from 'jsr:@std/assert@1'
import { citesteFirecrawl, alegeFurnizori, payloadUpsert, fereastraLunara, esteAnuala } from './furnizori.ts'

const URL_FC = 'https://api.firecrawl.dev/v2/team/credit-usage'
type Apel = { url: string; auth: string | null }
function mediu(raspuns: () => Response | Promise<Response>, env: Record<string, string> = { FIRECRAWL_API_KEY: 'fc-test-123' }, timeoutMs?: number) {
  const apeluri: Apel[] = []
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    apeluri.push({ url: String(url), auth: new Headers(init?.headers).get('Authorization') })
    return await raspuns()
  }) as typeof fetch
  return { m: { env: (k: string) => env[k], fetch: f, timeoutMs }, apeluri }
}

Deno.test('firecrawl: 200 → credite rămase/plan/consumate + perioada în zile UTC; cheia doar în antetul Bearer', async () => {
  const { m, apeluri } = mediu(() => new Response(JSON.stringify({ success: true, data: { remainingCredits: 2400, planCredits: 3000, billingPeriodStart: '2026-10-01T00:00:00Z', billingPeriodEnd: '2026-10-31T23:59:59Z' } }), { status: 200 }))
  const r = await citesteFirecrawl(m)
  assertEquals([r.furnizor, r.sursa, r.unitate, r.credite_plan, r.credite_ramase, r.credite_consumate, r.perioada_start, r.perioada_sfarsit, r.eroare],
    ['firecrawl', 'api', 'credite', 3000, 2400, 600, '2026-10-01', '2026-10-31', null])
  assertEquals(apeluri, [{ url: URL_FC, auth: 'Bearer fc-test-123' }])
  assertEquals(JSON.stringify(r.raspuns_brut).includes('fc-test-123'), false)
})

Deno.test('firecrawl: cheie lipsă → rând cu eroare, fără apel în rețea', async () => {
  const { m, apeluri } = mediu(() => new Response('{}'), {})
  const r = await citesteFirecrawl(m)
  assertEquals([r.eroare, r.credite_ramase, apeluri.length], ['FIRECRAWL_API_KEY lipsă din Edge Secrets', null, 0])
})

Deno.test('firecrawl: 404 { success:false, error } → eroare cu mesajul furnizorului, răspunsul păstrat', async () => {
  const { m } = mediu(() => new Response(JSON.stringify({ success: false, error: 'Could not find credit usage information' }), { status: 404 }))
  const r = await citesteFirecrawl(m)
  assertEquals(r.eroare, 'HTTP 404: Could not find credit usage information')
  assertEquals((r.raspuns_brut as any).success, false)
})

Deno.test('firecrawl: 500 fără JSON → eroare cu începutul textului; 200 fără remainingCredits → format schimbat', async () => {
  const a = await citesteFirecrawl(mediu(() => new Response('<html>Bad gateway</html>', { status: 502 })).m)
  assertEquals(a.eroare, 'HTTP 502: <html>Bad gateway</html>')
  const b = await citesteFirecrawl(mediu(() => new Response(JSON.stringify({ success: true, data: { credits: 5 } }), { status: 200 })).m)
  assertEquals([b.eroare, b.credite_ramase], ['răspuns fără data.remainingCredits (format schimbat?)', null])
})

Deno.test('firecrawl: rămase > plan (credite cumpărate în plus) → consumate necunoscut, nu negativ', async () => {
  const r = await citesteFirecrawl(mediu(() => new Response(JSON.stringify({ success: true, data: { remainingCredits: 5000, planCredits: 3000 } }), { status: 200 })).m)
  assertEquals([r.credite_ramase, r.credite_plan, r.credite_consumate, r.perioada_start, r.eroare], [5000, 3000, null, null, null])
})

Deno.test('firecrawl: timeout → eroare „timeout”, nu excepție', async () => {
  const lent = (async (_u: string | URL | Request, init?: RequestInit) => await new Promise<Response>((_, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })) as typeof fetch
  const r = await citesteFirecrawl({ env: () => 'fc-test', fetch: lent, timeoutMs: 50 })
  assertEquals(r.eroare, 'rețea: timeout 0.05 s')
})

Deno.test('alegeFurnizori: toate / nume (indiferent de majuscule) / necunoscut', () => {
  assertEquals(alegeFurnizori('toate'), ['firecrawl'])
  assertEquals(alegeFurnizori(undefined), ['firecrawl'])
  assertEquals(alegeFurnizori(' FireCrawl '), ['firecrawl'])
  assertEquals(alegeFurnizori('chatgpt'), [])
  assertEquals(alegeFurnizori('__proto__'), [])
  assertEquals(alegeFurnizori('constructor'), [])   // moștenite din Object.prototype: nu sunt furnizori (hasOwn)
  assertEquals(alegeFurnizori('toString'), [])
})

Deno.test('payloadUpsert: succesul scrie DOAR citirea bună, eroarea DOAR eroare + eroare_la (P0 #616 r1)', async () => {
  const bun = await citesteFirecrawl(mediu(() => new Response(JSON.stringify({ success: true, data: { remainingCredits: 2400, planCredits: 3000, billingPeriodStart: '2026-10-01T00:00:00Z', billingPeriodEnd: '2026-10-31T23:59:59Z' } }), { status: 200 })).m)
  const pb = payloadUpsert(bun, '2026-10-05', '2026-10-05T04:05:00.000Z')
  assertEquals(Object.keys(pb).sort(), ['citit_la', 'credite_consumate', 'credite_plan', 'credite_ramase', 'furnizor', 'perioada_sfarsit', 'perioada_start', 'raspuns_brut', 'sursa', 'unitate', 'zi'])
  assertEquals([pb.citit_la, pb.credite_ramase, pb.zi], ['2026-10-05T04:05:00.000Z', 2400, '2026-10-05'])
  const rau = await citesteFirecrawl(mediu(() => new Response('{"success":false,"error":"x"}', { status: 500 })).m)
  const pe = payloadUpsert(rau, '2026-10-05', '2026-10-05T13:00:00.000Z')
  assertEquals(Object.keys(pe).sort(), ['eroare', 'eroare_la', 'furnizor', 'sursa', 'unitate', 'zi'])
  assertEquals([pe.eroare, pe.eroare_la], ['HTTP 500: x', '2026-10-05T13:00:00.000Z'])
  // nicio cheie a citirii bune în payload-ul de eroare → la conflict PostgREST nu le atinge
  for (const k of ['citit_la', 'credite_plan', 'credite_ramase', 'credite_consumate', 'perioada_start', 'perioada_sfarsit', 'raspuns_brut']) assertEquals(k in pe, false)
})

// Plan facturat anual (Firecrawl Hobby, $190/an, 5.000 credite/LUNĂ): perioada scrisă = fereastra lunară curentă
const iso = (d: Date) => d.toISOString()
Deno.test('fereastraLunara: ancoră 01.10 20:17 UTC → ferestre lunare la aceeași zi+oră; înainte de ora resetului e încă luna trecută', () => {
  const anc = '2026-10-01T20:17:33Z'
  const f1 = fereastraLunara(anc, new Date('2026-10-08T04:05:00Z'))!
  assertEquals([iso(f1.start), iso(f1.sfarsit)], ['2026-10-01T20:17:33.000Z', '2026-11-01T20:17:33.000Z'])
  const f2 = fereastraLunara(anc, new Date('2026-11-01T19:00:00Z'))!        // 01.11 dar înainte de 20:17 → tot octombrie
  assertEquals([iso(f2.start), iso(f2.sfarsit)], ['2026-10-01T20:17:33.000Z', '2026-11-01T20:17:33.000Z'])
  const f3 = fereastraLunara(anc, new Date('2026-11-01T20:17:33Z'))!        // exact la reset → luna nouă
  assertEquals([iso(f3.start), iso(f3.sfarsit)], ['2026-11-01T20:17:33.000Z', '2026-12-01T20:17:33.000Z'])
  const f4 = fereastraLunara(anc, new Date('2026-12-20T00:00:00Z'))!        // trecerea de an
  assertEquals([iso(f4.start), iso(f4.sfarsit)], ['2026-12-01T20:17:33.000Z', '2027-01-01T20:17:33.000Z'])
})

Deno.test('fereastraLunara: ziua 31 → taiată la ultima zi a lunilor scurte, fără a sări peste o lună', () => {
  const anc = '2026-01-31T10:00:00Z'
  const feb = fereastraLunara(anc, new Date('2026-02-15T00:00:00Z'))!
  assertEquals([iso(feb.start), iso(feb.sfarsit)], ['2026-01-31T10:00:00.000Z', '2026-02-28T10:00:00.000Z'])
  const mar = fereastraLunara(anc, new Date('2026-03-01T00:00:00Z'))!       // 01.03 ≥ 28.02 10:00 → fereastra 28.02–31.03
  assertEquals([iso(mar.start), iso(mar.sfarsit)], ['2026-02-28T10:00:00.000Z', '2026-03-31T10:00:00.000Z'])
  const apr = fereastraLunara(anc, new Date('2026-04-30T12:00:00Z'))!
  assertEquals([iso(apr.start), iso(apr.sfarsit)], ['2026-04-30T10:00:00.000Z', '2026-05-31T10:00:00.000Z'])
  const bis = fereastraLunara(anc, new Date('2028-02-29T12:00:00Z'))!       // an bisect
  assertEquals([iso(bis.start), iso(bis.sfarsit)], ['2028-02-29T10:00:00.000Z', '2028-03-31T10:00:00.000Z'])
})

Deno.test('fereastraLunara: înainte de abonare → începe la ancoră; start invalid → null', () => {
  const f = fereastraLunara('2026-10-01T20:17:33Z', new Date('2026-10-01T21:00:00Z'))!
  assertEquals(iso(f.start), '2026-10-01T20:17:33.000Z')
  assertEquals(fereastraLunara('nu-e-data', new Date()), null)
  assertEquals(fereastraLunara(undefined, new Date()), null)
})

Deno.test('esteAnuala: un an → true; o lună (28–31 zile) → false; lipsă → false', () => {
  assertEquals(esteAnuala('2026-10-01T20:17:33Z', '2027-10-01T20:17:33Z'), true)
  assertEquals(esteAnuala('2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z'), false)
  assertEquals(esteAnuala('2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z'), false)
  assertEquals(esteAnuala(undefined, '2027-10-01T00:00:00Z'), false)
})

Deno.test('firecrawl: perioadă anuală în răspuns → perioada scrisă e luna curentă (planCredits e lunar)', async () => {
  const raspuns = () => new Response(JSON.stringify({ success: true, data: { remainingCredits: 3544, planCredits: 5000, billingPeriodStart: '2026-10-01T20:17:33Z', billingPeriodEnd: '2027-10-01T20:17:33Z' } }), { status: 200 })
  const { m } = mediu(raspuns)
  const r = await citesteFirecrawl({ ...m, acum: new Date('2026-10-08T04:05:00Z') })
  assertEquals([r.credite_plan, r.credite_ramase, r.credite_consumate, r.perioada_start, r.perioada_sfarsit, r.eroare], [5000, 3544, 1456, '2026-10-01', '2026-11-01', null])
  const r2 = await citesteFirecrawl({ ...mediu(raspuns).m, acum: new Date('2026-11-15T10:00:00Z') })
  assertEquals([r2.perioada_start, r2.perioada_sfarsit], ['2026-11-01', '2026-12-01'])
  assertEquals((r2.raspuns_brut as any).data.billingPeriodEnd, '2027-10-01T20:17:33Z')   // răspunsul brut rămâne neatins
})
