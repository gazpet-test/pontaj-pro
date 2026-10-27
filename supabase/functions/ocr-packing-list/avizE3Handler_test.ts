import { strict as assert } from 'node:assert'
import { citesteAvizE3 } from './avizE3Handler.ts'
import { MAX_INPUT_SONNET_E3, MAX_TOKENS_E3, REZERVA_E3, costMaximE3, limitaInputE3, rezervaE3 } from './avizE3.ts'
import { costApel } from '../_shared/haiku55.ts'
const SONNET = 'claude-sonnet-5-5'   // aviz_e3 citește mereu pe Sonnet 5.5 (decizia Răzvan 27.10.2026)
const COST = 1000 * 2 / 1e6 + 100 * 10 / 1e6   // usage-ul simulat la prețul Sonnet = 0,003 USD

type Opt = { model?: string; owner?: boolean; user?: boolean; modul?: boolean; atribuire?: boolean; queryError?: boolean; refuzPlafon?: boolean; count?: number; timeout?: boolean; invalid?: boolean; usage?: boolean; refuzAI?: boolean; truncat?: boolean; settleError?: boolean; countEsuat?: boolean; countAruncat?: boolean;
  deps?: import('./avizE3Handler.ts').DepsE3; intarziere?: number; ignoraSemnal?: boolean }
async function scenariu(o: Opt = {}) {
  const evenimente: string[] = []
  const decontari: unknown[] = []
  const corp = { model:o.model, tip: 'aviz_e3', proiect_id: 1, depozit_id: 2, sablon: 'aviz_teava', pdf_base64: btoa('%PDF-test') }
  const plafon = { cheie: 'izo_e3_ocr:1', luna: '2026-10-01', plafon_usd: 10, consumat_usd: 0, rezervat_usd: 0 }
  const client = (admin: boolean) => ({
    auth: { getUser: () => Promise.resolve({ data: { user: o.user === false ? null : { id: 'u' } }, error: null }) },
    from: (t: string) => {
      evenimente.push(`${admin ? 'ledger' : 'caller'}:${t}`)
      // Testul moare dacă se citește izometria/profilul cu service role.
      assert.equal(admin, t.startsWith('ai_plafon_'))
      const data = t === 'profiles' ? { is_owner: o.owner ?? true }
        : t === 'user_module_access' ? o.modul === false ? [] : [{ access_level: 'editor' }]
        : t === 'izo_atribuiri' ? o.atribuire === false ? [] : [{ proiect_id: 1, depozit_id: 2, rol: 'gestionar', activ: true, valabil_de: null, valabil_pana: null }]
        : t === 'ai_plafon_rezervari' ? { luna: plafon.luna } : plafon
      const result = { data, error: o.queryError && !admin ? { message: 'RLS' } : null }
      const q = {
        select: (_s: string) => q, eq: (_k: string, _v: unknown) => q, in: (_k: string, _v: unknown) => q,
        limit: (_n: number) => q, order: (_k: string, _v: unknown) => q,
        single: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
      return q
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      assert.equal(admin, true)
      evenimente.push(fn)
      if (fn === 'fn_ai_plafon_rezerva') {
        assert.deepEqual(args, { p_cheie: 'izo_e3_ocr:1', p_suma: rezervaE3(SONNET), p_plafon_implicit: 10, p_user: 'u' })
        return Promise.resolve(o.refuzPlafon ? { data: null, error: { code: 'P0001', message: 'plafon_depasit' } } : { data: 7, error: null })
      }
      decontari.push(args.p_cost_real)
      return Promise.resolve({ data: null, error: o.settleError ? { message: 'indisponibil' } : null })
    },
  })
  const original = globalThis.fetch
  globalThis.fetch = (url, init) => {
    evenimente.push(String(url))
    assert.ok(evenimente.indexOf('fn_ai_plafon_rezerva') < evenimente.length - 1)
    const payload = JSON.parse(String(init?.body))
    assert.equal(payload.model, SONNET)
    assert.equal(payload.messages[0].content[0].source.data, corp.pdf_base64)
    if (String(url).endsWith('count_tokens')) return o.countAruncat ? Promise.reject(new DOMException('timeout', 'TimeoutError')) : Promise.resolve(o.countEsuat ? new Response('x', { status: 503 }) : Response.json({ input_tokens: o.count ?? 1000 }))
    assert.equal(payload.max_tokens, 10400)
    if (o.timeout) return Promise.reject(new DOMException('timeout', 'TimeoutError'))
    const corpRaspuns = () => Response.json({
      stop_reason: o.refuzAI ? 'refusal' : o.truncat ? 'max_tokens' : 'end_turn',
      usage: o.usage === false ? undefined : { input_tokens: 1000, output_tokens: 100 },
      content: [{ type: 'thinking', thinking: 'ignorat' }, { type: 'text', text: o.invalid ? '{}' : JSON.stringify({ rotatie_grade:0, antet: {}, randuri: [{ serie: '001', pagina: 1 }] }) }],
    })
    if (o.intarziere === undefined) return Promise.resolve(corpRaspuns())
    // răspuns care sosește după `intarziere` ms; cu ignoraSemnal transportul nu respectă abort-ul (răspuns „târziu”)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(corpRaspuns()), o.intarziere)
      if (!o.ignoraSemnal) init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal!.reason) })
    })
  }
  try {
    const response = await citesteAvizE3(new Request('https://local.test', { method: 'POST', headers: { Authorization: 'Bearer caller' } }), corp,
      client(false) as unknown as Parameters<typeof citesteAvizE3>[2], client(true) as unknown as Parameters<typeof citesteAvizE3>[3], 'fake-test-key', {}, o.deps)
    return { status: response.status, body: await response.json(), evenimente, decontari }
  } finally { globalThis.fetch = original }
}

Deno.test('E3 handler: owner și gestionar+editor; numai caller JWT citește izometria, fără storage', async () => {
  for (const owner of [true, false]) {
    const r = await scenariu({ owner })
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.body), ['success', 'tip', 'sablon', 'antet', 'randuri', 'rotatie_grade', 'totaluri_tiparite', 'avertismente', 'model', 'cost_usd', 'plafon'])
    assert.equal(r.body.randuri[0].serie, '001')
    assert.ok(Math.abs(r.body.cost_usd - COST) < 1e-12)
    assert.equal(r.decontari.length, 1)
    assert.ok(Math.abs(Number(r.decontari[0]) - COST) < 1e-12)
    assert.equal(r.evenimente.includes('caller:izo_atribuiri'), !owner)
  }
})
Deno.test('E3 handler: fără drept/RLS => 403 înainte de rezervare și orice AI', async () => {
  for (const o of [{ user: false }, { queryError: true }, { owner: false, modul: false }, { owner: false, atribuire: false }]) {
    const r = await scenariu(o)
    assert.equal(r.status, 403)
    assert.deepEqual(r.body, { success: false, eroare: 'fara_drept' })
    assert.equal(r.evenimente.includes('fn_ai_plafon_rezerva'), false)
    assert.equal(r.evenimente.some(e => e.startsWith('https:')), false)
  }
})
Deno.test('E3 handler: plafon refuzat => 429 și zero apeluri AI/decontări', async () => {
  const r = await scenariu({ refuzPlafon: true })
  assert.equal(r.status, 429)
  assert.equal(r.body.eroare, 'plafon_depasit')
  assert.equal(r.body.plafon.cheie, 'izo_e3_ocr:1')
  assert.equal(r.evenimente.some(e => e.startsWith('https:')), false)
  assert.deepEqual(r.decontari, [])
})
Deno.test('E3 handler: numărare peste limită => fără generare, rezervă eliberată cu cost 0', async () => {
  const r = await scenariu({ count: MAX_INPUT_SONNET_E3 + 1 })
  assert.equal(r.status, 422)
  assert.equal(r.body.eroare, 'pdf_prea_multi_tokeni')
  assert.equal(r.evenimente.filter(e => e.startsWith('https:')).length, 1)   // doar numărarea gratuită, zero apeluri plătite
  assert.deepEqual(r.decontari, [0])
  // exact la limită: trece (limita e inclusivă)
  assert.equal((await scenariu({ count: MAX_INPUT_SONNET_E3 })).status, 200)
})
Deno.test('P1-01 r2: costul MAXIM Sonnet (costApel la plafoanele impuse) încape în rezerva de 0,20 USD', () => {
  assert.equal(limitaInputE3(SONNET), MAX_INPUT_SONNET_E3)
  assert.equal(MAX_TOKENS_E3, 10400)
  const max = costApel(SONNET, { input_tokens: limitaInputE3(SONNET), output_tokens: MAX_TOKENS_E3 })
  assert.equal(max, costMaximE3(SONNET))
  assert.ok(max <= rezervaE3(SONNET), `cost maxim ${max} > rezerva ${rezervaE3(SONNET)}`)
  // marja pentru o diferență numărare ↔ usage: cel puțin 2.000 de tokeni de intrare
  assert.ok(rezervaE3(SONNET) - max >= 2000 * 2 / 1e6 - 1e-12)
  // Haiku (izo-e3-ocr-local, rezerva din BD 0,05 USD, neatinsă) — tot sub rezervă
  assert.ok(costMaximE3('claude-haiku-5-5') <= REZERVA_E3)
})
Deno.test('P1-02 r2: termenul global — fără timp rămas, apelul plătit nu pornește (cost 0)', async () => {
  let t = 0
  // ceasul sare 121 s la numărare: rămân 135 - 121 - 15 = -1 s < minApel
  const r = await scenariu({ deps: { acum: () => t, transport: (u, i) => { if (String(u).endsWith('count_tokens')) t += 121000; return fetch(u, i) } } })
  assert.equal(r.status, 504)
  assert.equal(r.body.eroare, 'termen_depasit')
  assert.equal(r.evenimente.filter(e => e.endsWith('/messages')).length, 0)
  assert.deepEqual(r.decontari, [0])
})
Deno.test('P1-02 r2: timeout în timpul apelului => rezultat necunoscut (NULL), un singur apel, fără retry', async () => {
  const termene = { total: 300, marja: 50, minApel: 10, numarare: 100 }
  const r = await scenariu({ intarziere: 2000, deps: { termene } })
  assert.equal(r.status, 504)
  assert.equal(r.body.eroare, 'termen_depasit')
  assert.deepEqual(r.decontari, [null])
  assert.equal(r.evenimente.filter(e => e.endsWith('/messages')).length, 1)
})
Deno.test('P1-02 r2: răspuns sosit după termen (transportul ignoră abort-ul) nu e folosit', async () => {
  const termene = { total: 300, marja: 50, minApel: 10, numarare: 100 }
  const r = await scenariu({ intarziere: 600, ignoraSemnal: true, deps: { termene } })
  assert.equal(r.status, 504)
  assert.equal(r.body.randuri, undefined)
  assert.deepEqual(r.decontari, [null])
  // în termen: același răspuns e folosit
  const ok = await scenariu({ intarziere: 20, ignoraSemnal: true, deps: { termene } })
  assert.equal(ok.status, 200)
})
Deno.test('E3 handler: timeout/usage absent păstrează rezerva, fără retry', async () => {
  const r = await scenariu({ timeout: true })
  assert.equal(r.status, 504)
  assert.equal(r.body.eroare, 'termen_depasit')
  assert.deepEqual(r.decontari, [null])
  assert.equal(r.evenimente.filter(e => e.endsWith('/messages')).length, 1)
  const s = await scenariu({ usage: false })
  assert.equal(s.status, 200)
  assert.equal(s.body.cost_usd, rezervaE3(SONNET))
  assert.deepEqual(s.decontari, [null])
})
Deno.test('E3 handler: JSON invalid/refuz/trunchiere se decontează; eroarea decontării nu provoacă retry', async () => {
  for (const o of [{ invalid: true }, { refuzAI: true }, { truncat: true }]) {
    const r = await scenariu(o)
    assert.equal(r.status, 422)
    assert.equal(r.decontari.length, 1)
    assert.ok(Math.abs(Number(r.decontari[0]) - COST) < 1e-12)
  }
  const r = await scenariu({ settleError: true })
  assert.equal(r.status, 503)
  assert.equal(r.body.eroare, 'decontare_indisponibila')
  assert.equal(r.decontari.length, 1)
})
Deno.test('E3 handler: numărarea gratuită pică => fără generare, cost 0, plafon neconsumat (Jak E9 r1 P2)', async () => {
  const r = await scenariu({ countEsuat: true })
  assert.equal(r.status, 502)
  assert.equal(r.body.eroare, 'numarare_indisponibila')
  assert.equal(r.evenimente.filter(e => e.endsWith('/messages')).length, 0)
  assert.deepEqual(r.decontari, [0])
})
Deno.test('E3 handler: timeout / retea la numarare => cost 0 (Jak E9 r2 P2)', async () => {
  const r = await scenariu({ countAruncat: true })
  assert.equal(r.evenimente.filter(e => e.endsWith('/messages')).length, 0)
  assert.deepEqual(r.decontari, [0])
})
Deno.test('model invalid => 400 înainte de rezervare; sonnet rezervat și decontat la prețul lui', async () => {
  const invalid = await scenariu({ model:'opus' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.eroare, 'cerere_invalida')
  assert.deepEqual(invalid.evenimente, [])
  const sonnet = await scenariu({ model:'sonnet' })
  assert.equal(sonnet.status, 200)
  assert.equal(sonnet.body.model, 'claude-sonnet-5-5')
  assert.equal(sonnet.body.rotatie_grade, 0)
  assert.ok(Math.abs(sonnet.body.cost_usd - 0.003) < 1e-12)
  assert.deepEqual(sonnet.decontari, [sonnet.body.cost_usd])
  const faraUsage = await scenariu({ model:'sonnet', usage:false })
  assert.equal(faraUsage.body.cost_usd, 0.2)
  assert.deepEqual(faraUsage.decontari, [null])
})
