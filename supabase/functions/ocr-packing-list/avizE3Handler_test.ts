import { strict as assert } from 'node:assert'
import { citesteAvizE3 } from './avizE3Handler.ts'
import { MAX_INPUT_E3, REZERVA_E3 } from './avizE3.ts'

type Opt = { owner?: boolean; user?: boolean; modul?: boolean; atribuire?: boolean; queryError?: boolean; refuzPlafon?: boolean; count?: number; timeout?: boolean; invalid?: boolean; usage?: boolean; refuzAI?: boolean; truncat?: boolean; settleError?: boolean; countEsuat?: boolean }
async function scenariu(o: Opt = {}) {
  const evenimente: string[] = []
  const decontari: unknown[] = []
  const corp = { tip: 'aviz_e3', proiect_id: 1, depozit_id: 2, sablon: 'aviz_teava', pdf_base64: btoa('%PDF-test') }
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
        assert.deepEqual(args, { p_cheie: 'izo_e3_ocr:1', p_suma: REZERVA_E3, p_plafon_implicit: 10, p_user: 'u' })
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
    assert.equal(payload.model, 'claude-haiku-5-5')
    assert.equal(payload.messages[0].content[0].source.data, corp.pdf_base64)
    if (String(url).endsWith('count_tokens')) return Promise.resolve(o.countEsuat ? new Response('x', { status: 503 }) : Response.json({ input_tokens: o.count ?? 1000 }))
    assert.equal(payload.max_tokens, 10400)
    if (o.timeout) return Promise.reject(new DOMException('timeout', 'TimeoutError'))
    return Promise.resolve(Response.json({
      stop_reason: o.refuzAI ? 'refusal' : o.truncat ? 'max_tokens' : 'end_turn',
      usage: o.usage === false ? undefined : { input_tokens: 1000, output_tokens: 100 },
      content: [{ type: 'thinking', thinking: 'ignorat' }, { type: 'text', text: o.invalid ? '{}' : JSON.stringify({ antet: {}, randuri: [{ serie: '001', pagina: 1 }] }) }],
    }))
  }
  try {
    const response = await citesteAvizE3(new Request('https://local.test', { method: 'POST', headers: { Authorization: 'Bearer caller' } }), corp,
      client(false) as unknown as Parameters<typeof citesteAvizE3>[2], client(true) as unknown as Parameters<typeof citesteAvizE3>[3], 'fake-test-key', {})
    return { status: response.status, body: await response.json(), evenimente, decontari }
  } finally { globalThis.fetch = original }
}

Deno.test('E3 handler: owner și gestionar+editor; numai caller JWT citește izometria, fără storage', async () => {
  for (const owner of [true, false]) {
    const r = await scenariu({ owner })
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.body), ['success', 'tip', 'sablon', 'antet', 'randuri', 'totaluri_tiparite', 'avertismente', 'model', 'cost_usd', 'plafon'])
    assert.equal(r.body.randuri[0].serie, '001')
    assert.ok(Math.abs(r.body.cost_usd - 0.00015) < 1e-12)
    assert.equal(r.decontari.length, 1)
    assert.ok(Math.abs(Number(r.decontari[0]) - 0.00015) < 1e-12)
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
  const r = await scenariu({ count: MAX_INPUT_E3 + 1 })
  assert.equal(r.status, 422)
  assert.equal(r.body.eroare, 'pdf_prea_multi_tokeni')
  assert.equal(r.evenimente.filter(e => e.startsWith('https:')).length, 1)
  assert.deepEqual(r.decontari, [0])
})
Deno.test('E3 handler: timeout/usage absent păstrează rezerva, fără retry', async () => {
  const r = await scenariu({ timeout: true })
  assert.equal(r.status, 502)
  assert.deepEqual(r.decontari, [null])
  assert.equal(r.evenimente.filter(e => e.endsWith('/messages')).length, 1)
  const s = await scenariu({ usage: false })
  assert.equal(s.status, 200)
  assert.equal(s.body.cost_usd, REZERVA_E3)
  assert.deepEqual(s.decontari, [null])
})
Deno.test('E3 handler: JSON invalid/refuz/trunchiere se decontează; eroarea decontării nu provoacă retry', async () => {
  for (const o of [{ invalid: true }, { refuzAI: true }, { truncat: true }]) {
    const r = await scenariu(o)
    assert.equal(r.status, 422)
    assert.equal(r.decontari.length, 1)
    assert.ok(Math.abs(Number(r.decontari[0]) - 0.00015) < 1e-12)
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
