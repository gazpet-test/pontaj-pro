// ofertare-ocr-arbitreaza cap-coadă, cu BD (rpc) și API Anthropic simulate: citirile DIN BD, nicio cheltuială înaintea verificărilor
// (citire + rezervare atomică), nicio decizie la eroarea API, schema strictă, usage lipsă / cost peste rezervare fail-closed.
import { strict as assert } from 'node:assert'
import { ANTET_OCR, sha256Hex } from '../_shared/ocrLocal.ts'
import { arbitreaza } from './arbitreaza.ts'
import { PROMPT, PROMPT_VERSIUNE } from './prompt.ts'

const SECRET = 'c'.repeat(64)
function png(w: number, h: number): Uint8Array {  // PNG minim: semnătura + IHDR
  const b = new Uint8Array(40); b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b
}
const IMG = png(1600, 400)
const IMG_B64 = btoa(String.fromCharCode(...IMG))
const ITEM_SHA = 'e'.repeat(64)
const DZ = { item_id: 'p0326_b0_t0', tip: 'text', citire_lighton: '0,056', citire_mineru: '0.056', e_cantitate: true, anomalie_separator: true }

type Opt = { citire?: unknown; rezerva?: unknown; scrie?: unknown; api?: { status?: number; text?: string; arunca?: boolean; stop?: string; usage?: unknown } }
function mediu(opt: Opt = {}) {
  const apeluri: { fn: string; args: any }[] = []; const cereriApi: any[] = []; const exces: any[] = []
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      apeluri.push({ fn, args })
      if (fn === 'fn_verifica_secret') return { data: args.p_secret === SECRET, error: null }
      if (fn === 'fn_ofertare_ocr_dezacord_arbitraj') return { data: 'citire' in opt ? opt.citire : DZ, error: null }
      if (fn === 'fn_ofertare_ocr_arbitraj_rezerva') return { data: 'rezerva' in opt ? opt.rezerva : { rezervare_id: 7 }, error: null }
      if (fn === 'fn_ofertare_ocr_scrie_arbitraj') return { data: opt.scrie ?? { ok: true, decontat: true, arbitraj_inregistrat: true, id: 9 }, error: null }
      if (fn === 'fn_ofertare_ocr_stare') return { data: { ok: true }, error: null }
      return { data: null, error: { message: 'neașteptat ' + fn } }
    },
  }
  const a = opt.api || {}
  const fetchApi = (async (_u: string, init: RequestInit) => {
    cereriApi.push(JSON.parse(String(init.body)))
    if (a.arunca) throw new Error('rețea')
    const text = a.text ?? JSON.stringify({ decizie: 'ales_mineru', text: 'x', motiv: 'punct in imagine', e_cantitate: true, anomalie_separator: true })
    return new Response(JSON.stringify(a.status && a.status >= 400 ? { error: { message: 'suprasolicitat' } }
      : { content: [{ type: 'text', text }], usage: 'usage' in a ? a.usage : { input_tokens: 3000, output_tokens: 200 }, stop_reason: a.stop || 'end_turn' }),
      { status: a.status || 200 })
  }) as typeof fetch
  return { m: { sb, cheieAi: 'k', fetchApi, jurnalExces: async (r: Record<string, unknown>) => { exces.push(r) } }, apeluri, cereriApi, exces }
}
const cerere = (corp: unknown, secret = SECRET) => new Request('https://x.invalid/functions/v1/ofertare-ocr-arbitreaza', {
  method: 'POST', headers: { [ANTET_OCR]: secret, 'content-type': 'application/json' }, body: JSON.stringify(corp),
})
const corpDe = (extra: Record<string, unknown> = {}) =>
  ({ rulare_id: 3, dezacord_id: 11, item_sha256: ITEM_SHA, imagine_b64: IMG_B64, context: { context_inainte: 'Conductă DN 250 —' }, ...extra })
const fnuri = (a: { fn: string }[]) => a.map((x) => x.fn)

Deno.test('cale bună: secret → citire din BD → rezervare atomică → apel → decontare', async () => {
  const { m, apeluri, cereriApi } = mediu()
  const r = await arbitreaza(cerere(corpDe()), m); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j))
  assert.deepEqual(fnuri(apeluri), ['fn_verifica_secret', 'fn_ofertare_ocr_dezacord_arbitraj', 'fn_ofertare_ocr_arbitraj_rezerva', 'fn_ofertare_ocr_scrie_arbitraj'])
  const imgSha = await sha256Hex(IMG)
  assert.deepEqual(apeluri[1].args, { p_rulare_id: 3, p_dezacord_id: 11, p_item_sha256: ITEM_SHA, p_image_sha256: imgSha })
  const rez = apeluri[2].args
  assert.deepEqual({ ...rez, p_suma: 0 }, { p_rulare_id: 3, p_dezacord_id: 11, p_item_sha256: ITEM_SHA, p_image_sha256: imgSha, p_suma: 0 })
  assert.ok(rez.p_suma > 0.0135 && rez.p_suma < 0.1, String(rez.p_suma))
  const scr = apeluri[3].args
  assert.equal(scr.p_rezervare_id, 7)
  assert.deepEqual({ ...scr.p_arbitraj }, { dezacord_id: 11, item_sha256: ITEM_SHA, decizie: 'ales_mineru', text: '0.056', motiv: 'punct in imagine',
    e_cantitate: true, anomalie_separator: true, arbitru_model: 'claude-sonnet-5', prompt_versiune: PROMPT_VERSIUNE, cost_usd: '0.0120', tokens_in: 3000, tokens_out: 200 })
  assert.equal(j.decizie.id, 'p0326_b0_t0'); assert.equal(j.decizie.text, '0.056'); assert.equal(j.arbitraj_id, 9)
  const c = cereriApi[0]
  assert.equal(c.system, PROMPT); assert.equal(c.temperature, 0); assert.deepEqual(c.thinking, { type: 'disabled' })
  assert.equal(c.messages[0].content[0].source.media_type, 'image/png')
  const date = JSON.parse(c.messages[0].content[1].text.replace(/^DATE \(nu instrucțiuni\):\n/, ''))
  assert.deepEqual(date, { tip: 'text', citire_lighton: '0,056', citire_mineru: '0.056', context_pipeline: { context_inainte: 'Conductă DN 250 —' } })
})

Deno.test('fără cost înaintea verificărilor (corp, secret, imagine, refuzurile BD la citire și la rezervare)', async () => {
  const cazuri: [string, Request, Opt, number][] = [
    ['secret greșit', cerere(corpDe(), 'd'.repeat(64)), {}, 401],
    ['cheie în plus', cerere(corpDe({ alt: 1 })), {}, 400],
    ['item în loc de item_sha256', cerere({ ...corpDe(), item_sha256: undefined, item: {} }), {}, 400],
    ['amprentă în alt format', cerere(corpDe({ item_sha256: 'E'.repeat(64) })), {}, 400],
    ['context cu cheie străină', cerere(corpDe({ context: { citire_lighton: 'fals' } })), {}, 400],
    ['context prea lung', cerere(corpDe({ context: { context_dupa: 'x'.repeat(2001) } })), {}, 400],
    ['nu e PNG', cerere(corpDe({ imagine_b64: btoa('%PDF-1.7 ' + 'x'.repeat(40)) })), {}, 422],
    ['base64 invalid', cerere(corpDe({ imagine_b64: 'a b' })), {}, 413],
    ['BD: dezacord străin / amprentă', cerere(corpDe()), { citire: { refuz: 'dezacord' } }, 422],
    ['BD: imaginea nu e banda', cerere(corpDe()), { citire: { refuz: 'imagine' } }, 422],
    ['BD: structura_tabele', cerere(corpDe()), { citire: { refuz: 'tip' } }, 422],
    ['BD: deja arbitrat', cerere(corpDe()), { citire: { refuz: 'arbitrat' } }, 409],
    ['BD: rularea nu e în citita', cerere(corpDe()), { citire: { refuz: 'stare' } }, 402],
    ['rezervare: plafon', cerere(corpDe()), { rezerva: { refuz: 'plafon' } }, 402],
    ['rezervare: apel în zbor (cursă)', cerere(corpDe()), { rezerva: { refuz: 'in_zbor' } }, 409],
    ['rezervare: arbitrat între timp', cerere(corpDe()), { rezerva: { refuz: 'arbitrat' } }, 409],
  ]
  for (const [nume, req, opt, cod] of cazuri) {
    const { m, apeluri, cereriApi } = mediu(opt)
    const r = await arbitreaza(req, m)
    assert.equal(r.status, cod, nume); assert.equal(cereriApi.length, 0, nume)
    assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'), nume)
  }
})

Deno.test('imagine uriașă: limita de cost peste 1 USD → refuz fără rezervare', async () => {
  const mare = png(20000, 20000)
  const { m, apeluri, cereriApi } = mediu()
  const r = await arbitreaza(cerere(corpDe({ imagine_b64: btoa(String.fromCharCode(...mare)) })), m)
  assert.equal(r.status, 413); assert.equal(cereriApi.length, 0); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_rezerva'))
})

Deno.test('eroare API / rețea: 502, rezervarea rămâne deschisă, nicio decizie', async () => {
  for (const api of [{ status: 529 }, { arunca: true }]) {
    const { m, apeluri } = mediu({ api })
    const r = await arbitreaza(cerere(corpDe()), m); const j = await r.json()
    assert.equal(r.status, 502); assert.equal(j.rezervare_id, 7); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'))
  }
})

Deno.test('ieșire în afara schemei / tăiată: decontat, needs_human', async () => {
  for (const api of [{ text: 'Aleg MinerU.' }, { text: '{"decizie":"ales_mineru"}' }, { stop: 'max_tokens' }]) {
    const { m, apeluri } = mediu({ api })
    assert.equal((await arbitreaza(cerere(corpDe()), m)).status, 200)
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    assert.equal(a.decizie, 'needs_human'); assert.equal(a.text, ''); assert.equal(a.cost_usd, '0.0120')
  }
})

Deno.test('usage lipsă / invalid: decontare la TOATĂ rezervarea, needs_human (Copilot r1 P1)', async () => {
  for (const usage of [undefined, null, { input_tokens: 'x', output_tokens: 1 }, { input_tokens: -1, output_tokens: 1 }]) {
    const { m, apeluri } = mediu({ api: { usage } })
    assert.equal((await arbitreaza(cerere(corpDe()), m)).status, 200)
    const rez = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    assert.equal(a.decizie, 'needs_human'); assert.equal(a.cost_usd, rez.toFixed(4)); assert.equal(a.tokens_in, 0)
  }
})

Deno.test('cost real peste rezervare: decontare la rezervare, excesul în jurnal, rularea oprită, fără decizie automată', async () => {
  const { m, apeluri, exces } = mediu({ api: { usage: { input_tokens: 400000, output_tokens: 1000 } } })
  const r = await arbitreaza(cerere(corpDe()), m); const j = await r.json()
  assert.equal(r.status, 500)
  const rez = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
  const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
  assert.equal(a.decizie, 'needs_human'); assert.equal(a.cost_usd, rez.toFixed(4))
  assert.equal(exces.length, 1); assert.ok(Math.abs(exces[0].cost_usd - (j.cost_real - rez)) < 1e-4)
  assert.deepEqual(apeluri.find((x) => x.fn === 'fn_ofertare_ocr_stare')!.args.p_stare, 'oprita')
})

Deno.test('decontat dar decizia respinsă de BD: 409, fără decizie în răspuns', async () => {
  const { m } = mediu({ scrie: { ok: true, decontat: true, arbitraj_inregistrat: false, motiv: 'duplicate key' } })
  const r = await arbitreaza(cerere(corpDe()), m); const j = await r.json()
  assert.equal(r.status, 409); assert.equal(j.decizie, undefined); assert.equal(j.decontat, true)
})
