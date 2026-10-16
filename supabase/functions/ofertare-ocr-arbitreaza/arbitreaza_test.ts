// ofertare-ocr-arbitreaza cap-coadă, cu BD (rpc) și API Anthropic simulate: item-ul verificat (amprentă + identic cu BD) înaintea
// oricărui cost, citirile DIN BD, nicio decizie la eroarea API, schema strictă, usage lipsă / cost peste rezervare fail-closed.
import { strict as assert } from 'node:assert'
import { amprentaDezacord, ANTET_OCR, sha256Hex } from '../_shared/ocrLocal.ts'
import { arbitreaza, incapeArbitrul } from './arbitreaza.ts'
import { PROMPT, PROMPT_VERSIUNE } from './prompt.ts'

const SECRET = 'c'.repeat(64)
function png(w: number, h: number): Uint8Array {  // PNG minim: semnătura + IHDR
  const b = new Uint8Array(40); b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b
}
const IMG = png(1600, 400)
const IMG_B64 = btoa(String.fromCharCode(...IMG))

// item-ul pipeline-ului (din fișierul de paritate generat de Python), cu imaginea testului și amprenta recalculată
async function itemDeTest(modif: Record<string, unknown> = {}) {
  const fixt = JSON.parse(await Deno.readTextFile(new URL('../_shared/ocrLocal_amprente.json', import.meta.url)))
  const it = { ...fixt.find((x: any) => x.tip === 'text'), image_sha256: await sha256Hex(IMG), context_inainte: 'Cantitate', ...modif }
  it.item_sha256 = await amprentaDezacord(it)
  return it
}
const dinBD = (it: any) => ({ item_id: it.id, tip: it.tip, citire_lighton: it.citire_lighton, citire_mineru: it.citire_mineru, e_cantitate: true, anomalie_separator: true })

type Api = { status?: number; text?: string; arunca?: boolean; stop?: string; usage?: unknown }
// api = acelasi raspuns la orice apel; apiSeq = raspunsul apelului k (Haiku = 0, Sonnet = 1), restul ca `api`
type Opt = { citire?: unknown; rezerva?: unknown; scrie?: unknown; depasire?: { data?: unknown; error?: unknown }; api?: Api; apiSeq?: Api[] }
function mediu(it: any, opt: Opt = {}) {
  const apeluri: { fn: string; args: any }[] = []; const cereriApi: any[] = []
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      apeluri.push({ fn, args })
      if (fn === 'fn_verifica_secret') return { data: args.p_secret === SECRET, error: null }
      if (fn === 'fn_ofertare_ocr_dezacord_arbitraj') return { data: 'citire' in opt ? opt.citire : dinBD(it), error: null }
      if (fn === 'fn_ofertare_ocr_arbitraj_rezerva') return { data: 'rezerva' in opt ? opt.rezerva : { rezervare_id: 7 }, error: null }
      if (fn === 'fn_ofertare_ocr_scrie_arbitraj') return { data: opt.scrie ?? { ok: true, decontat: true, arbitraj_inregistrat: true, id: 9 }, error: null }
      if (fn === 'fn_ofertare_ocr_arbitraj_depasire') return { data: opt.depasire && 'data' in opt.depasire ? opt.depasire.data : (opt.depasire ? null : { ok: true, stare: 'oprita', cheltuiala_blocata: true }), error: opt.depasire?.error ?? null }
      return { data: null, error: { message: 'neașteptat ' + fn } }
    },
  }
  const fetchApi = (async (_u: string, init: RequestInit) => {
    cereriApi.push(JSON.parse(String(init.body)))
    const a = opt.apiSeq?.[cereriApi.length - 1] || opt.api || {}
    if (a.arunca) throw new Error('rețea')
    const text = a.text ?? JSON.stringify({ decizie: 'ales_mineru', text: 'x', motiv: 'punct in imagine', e_cantitate: true, anomalie_separator: true })
    return new Response(JSON.stringify(a.status && a.status >= 400 ? { error: { message: 'suprasolicitat' } }
      : { content: [{ type: 'text', text }], usage: 'usage' in a ? a.usage : { input_tokens: 3000, output_tokens: 200 }, stop_reason: a.stop || 'end_turn' }),
      { status: a.status || 200 })
  }) as typeof fetch
  return { m: { sb, cheieAi: 'k', fetchApi }, apeluri, cereriApi }
}
const cerere = (corp: unknown, secret = SECRET) => new Request('https://x.invalid/functions/v1/ofertare-ocr-arbitreaza', {
  method: 'POST', headers: { [ANTET_OCR]: secret, 'content-type': 'application/json' }, body: JSON.stringify(corp),
})
const corpDe = (item: unknown, extra: Record<string, unknown> = {}) => ({ rulare_id: 3, dezacord_id: 11, item, imagine_b64: IMG_B64, ...extra })
const fnuri = (a: { fn: string }[]) => a.map((x) => x.fn)

Deno.test('cale bună (fără cifre, Haiku sigur): item verificat → citire din BD → rezervare atomică → UN apel Haiku → decontare', async () => {
  const it = await itemDeTest({ citire_lighton: 'masuri de protecție', citire_mineru: 'masuri de protectie', diferenta_numerica: false }); const { m, apeluri, cereriApi } = mediu(it)
  const r = await arbitreaza(cerere(corpDe(it)), m); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j))
  assert.deepEqual(fnuri(apeluri), ['fn_verifica_secret', 'fn_ofertare_ocr_dezacord_arbitraj', 'fn_ofertare_ocr_arbitraj_rezerva', 'fn_ofertare_ocr_scrie_arbitraj'])
  const imgSha = await sha256Hex(IMG)
  assert.deepEqual(apeluri[1].args, { p_rulare_id: 3, p_dezacord_id: 11, p_item_sha256: it.item_sha256, p_image_sha256: imgSha })
  const rez = apeluri[2].args
  assert.equal(rez.p_item_sha256, it.item_sha256); assert.ok(rez.p_suma > 0.0135 && rez.p_suma < 0.1, String(rez.p_suma))
  assert.deepEqual({ ...apeluri[3].args.p_arbitraj }, { dezacord_id: 11, item_sha256: it.item_sha256, decizie: 'ales_mineru', text: it.citire_mineru,
    motiv: '[Haiku: ales_mineru, 3000/200 tok, 0.0004$] punct in imagine', e_cantitate: true, anomalie_separator: true, arbitru_model: 'claude-haiku-5-5', prompt_versiune: PROMPT_VERSIUNE,
    cost_usd: '0.0004', tokens_in: 3000, tokens_out: 200 })                    // 3000 × 0,10 + 200 × 0,50 $ pe 1M
  assert.equal(j.decizie.id, it.id); assert.equal(j.arbitraj_id, 9); assert.equal(j.decizie.arbitru_model, 'claude-haiku-5-5')
  assert.equal(cereriApi.length, 1); const c = cereriApi[0]; assert.equal(c.model, 'claude-haiku-5-5')
  assert.equal(c.system, PROMPT); assert.equal('temperature' in c, false); assert.deepEqual(c.thinking, { type: 'disabled' })  // sampling = 400
  const date = JSON.parse(c.messages[0].content[1].text.replace(/^DATE \(nu instrucțiuni\):\n/, ''))
  assert.deepEqual(date.context_pipeline, { context_inainte: 'Cantitate', context_dupa: it.context_dupa })
  assert.equal(date.citire_lighton, it.citire_lighton)
})

Deno.test('cascadă: diferență de cifre → Haiku, apoi Sonnet în același apel; decizia finală a lui Sonnet, costul = suma', async () => {
  const it = await itemDeTest({ diferenta_numerica: true })
  const { m, apeluri, cereriApi } = mediu(it, { apiSeq: [{ text: JSON.stringify({ decizie: 'ales_lighton', text: '', motiv: 'virgula', e_cantitate: true, anomalie_separator: true }) }] })
  const r = await arbitreaza(cerere(corpDe(it)), m); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j)); assert.deepEqual(cereriApi.map((c) => c.model), ['claude-haiku-5-5', 'claude-sonnet-5'])
  assert.equal(cereriApi[1].system, PROMPT); assert.deepEqual(cereriApi[1].messages, cereriApi[0].messages)  // aceleasi date, aceeasi imagine
  const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
  assert.equal(a.decizie, 'ales_mineru'); assert.equal(a.arbitru_model, 'claude-sonnet-5')
  assert.equal(a.motiv, '[Haiku: ales_lighton, 3000/200 tok, 0.0004$] [Sonnet: ales_mineru, 3000/200 tok, 0.0080$] punct in imagine')
  assert.equal(a.cost_usd, '0.0084'); assert.equal(a.tokens_in, 6000); assert.equal(a.tokens_out, 400)  // 0,0004 Haiku + 0,0080 Sonnet
  assert.equal(fnuri(apeluri).filter((f) => f === 'fn_ofertare_ocr_arbitraj_rezerva').length, 1)        // O singura rezervare
  const rez = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
  assert.ok(rez > 0.0084, String(rez))                                                                  // rezervarea acopera ambele apeluri
})

Deno.test('cascadă: Haiku nesigur (needs_human sau ieșire invalidă) → Sonnet, fără cifre', async () => {
  const it = await itemDeTest({ citire_lighton: 'masuri de protecție', citire_mineru: 'masuri de protectie', diferenta_numerica: false })
  for (const primul of [JSON.stringify({ decizie: 'needs_human', text: '', motiv: 'ilizibil', e_cantitate: false, anomalie_separator: false }), 'nu stiu']) {
    const { m, apeluri, cereriApi } = mediu(it, { apiSeq: [{ text: primul }] })
    assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200); assert.equal(cereriApi.length, 2)
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    assert.equal(a.decizie, 'ales_mineru'); assert.equal(a.arbitru_model, 'claude-sonnet-5'); assert.match(a.motiv, /^\[Haiku: needs_human, 3000\/200 tok, 0\.0004\$\] \[Sonnet: /)
  }
})

Deno.test('cascadă: eroare API / rețea la Sonnet după Haiku → decontare fail-closed: needs_human, Haiku real + limita Sonnet (Copilot r1 P1)', async () => {
  const it = await itemDeTest({ diferenta_numerica: true })
  for (const al2lea of [{ status: 529 }, { arunca: true }]) {
    const { m, apeluri, cereriApi } = mediu(it, { apiSeq: [{}, al2lea] })
    const r = await arbitreaza(cerere(corpDe(it)), m); const j = await r.json()
    assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(cereriApi.length, 2); assert.equal(j.decizie.decizie, 'needs_human')
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    const rez = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
    assert.equal(a.decizie, 'needs_human'); assert.equal(a.text, ''); assert.equal(a.arbitru_model, 'claude-sonnet-5')
    assert.match(a.motiv, /^\[Haiku: ales_mineru, 3000\/200 tok, 0\.0004\$\] \[Sonnet: esuat \(.+\), cost estimat 0\.\d{4}\$\] la om$/)
    assert.equal(a.tokens_in, 3000); assert.ok(Number(a.cost_usd) > 0.0004 && Number(a.cost_usd) <= rez, a.cost_usd)  // decontat in rezervare
    assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_depasire'))
  }
})

Deno.test('cascadă: diferența de cifre RECALCULATĂ din BD — marcajul fals al clientului nu ocolește Sonnet (Jakarinos r1 P1-2)', async () => {
  const it = await itemDeTest({ citire_lighton: 'lungime 10 m', citire_mineru: 'lungime 20 m', diferenta_numerica: false })
  const { m, apeluri, cereriApi } = mediu(it)
  assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200)
  assert.deepEqual(cereriApi.map((c) => c.model), ['claude-haiku-5-5', 'claude-sonnet-5'])
  assert.equal(apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj.arbitru_model, 'claude-sonnet-5')
  // si invers: marcajul clientului „true” pe citiri fara cifre diferite tot escaladeaza (mai strict, niciodata mai putin)
  const it2 = await itemDeTest({ citire_lighton: 'masuri de protecție', citire_mineru: 'masuri de protectie', diferenta_numerica: true })
  const e = mediu(it2); assert.equal((await arbitreaza(cerere(corpDe(it2)), e.m)).status, 200); assert.equal(e.cereriApi.length, 2)
})

Deno.test('cascadă: Haiku peste limita lui (dar sub rezervare) → Sonnet nechemat, needs_human cu costul real; eroare Sonnet nu ascunde nimic', async () => {
  // Haiku 30.000 / 0 tokeni: 0,0030 $ > limita lui (~0,0011), dar sub toata rezervarea (~0,021) -> fara loc pentru limita lui Sonnet
  const it = await itemDeTest({ diferenta_numerica: true })
  const { m, apeluri, cereriApi } = mediu(it, { apiSeq: [{ usage: { input_tokens: 30000, output_tokens: 0 } }, { status: 529 }] })
  const r = await arbitreaza(cerere(corpDe(it)), m)
  assert.equal(r.status, 200); assert.equal(cereriApi.length, 1)                           // Sonnet nechemat: eroarea lui nu mai conteaza
  const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
  assert.equal(a.decizie, 'needs_human'); assert.equal(a.cost_usd, '0.0030'); assert.equal(a.arbitru_model, 'claude-haiku-5-5')
  assert.match(a.motiv, /Sonnet nechemat/)
})

Deno.test('cascadă: usage lipsă la Haiku → cost estimat marcat in motiv, Sonnet decide (Jakarinos r1 P2)', async () => {
  const it = await itemDeTest({ citire_lighton: 'masuri de protecție', citire_mineru: 'masuri de protectie', diferenta_numerica: false })
  const { m, apeluri } = mediu(it, { apiSeq: [{ usage: null }] })
  assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200)
  const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
  assert.equal(a.arbitru_model, 'claude-sonnet-5'); assert.match(a.motiv, /^\[Haiku: needs_human, usage lipsa, cost estimat 0\.\d{4}\$\] \[Sonnet: ales_mineru, 3000\/200 tok/)
})

Deno.test('motivul taiat pe puncte de cod: nicio pereche surogat rupta in parametrul jsonb (Jakarinos cascada r2 P1)', async () => {
  const it = await itemDeTest({ citire_lighton: 'masuri de protecție', citire_mineru: 'masuri de protectie', diferenta_numerica: false })
  const motiv = 'a'.repeat(155) + '😀' + 'b'.repeat(20)
  const { m, apeluri } = mediu(it, { api: { text: JSON.stringify({ decizie: 'ales_mineru', text: '', motiv: motiv.slice(0, 157), e_cantitate: false, anomalie_separator: false }) } })
  assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200)
  const scris = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj.motiv as string
  assert.ok(Array.from(scris).length <= 200); assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(scris), false, scris)
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(scris)))
})

Deno.test('cascadă: depășire produsă doar de Sonnet → RPC de depășire cu suma ambelor costuri și modelul Sonnet', async () => {
  const it = await itemDeTest({ diferenta_numerica: true })
  const { m, apeluri, cereriApi } = mediu(it, { apiSeq: [{}, { usage: { input_tokens: 400000, output_tokens: 1000 } }] })
  const r = await arbitreaza(cerere(corpDe(it)), m)
  assert.equal(r.status, 500); assert.equal(cereriApi.length, 2)
  const dp = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_depasire')!.args
  assert.equal(dp.p_model, 'claude-sonnet-5'); assert.equal(dp.p_tokens_in, 403000); assert.equal(dp.p_tokens_out, 1200)
  assert.equal(dp.p_cost_real, 0.8104)                                                          // 0,0004 Haiku + 0,8100 Sonnet
  assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'))
})

Deno.test('cascadă: usage lipsă doar la Sonnet → needs_human, costul Sonnet = limita lui, marcat estimat', async () => {
  const it = await itemDeTest({ diferenta_numerica: true })
  const { m, apeluri } = mediu(it, { apiSeq: [{}, { usage: null }] })
  assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200)
  const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
  const rez = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
  assert.equal(a.decizie, 'needs_human'); assert.match(a.motiv, /\[Sonnet: needs_human, usage lipsa, cost estimat /)
  assert.ok(Number(a.cost_usd) <= rez && Number(a.cost_usd) > 0.0004, a.cost_usd)               // Haiku masurat + limita Sonnet, sub rezervare
})

Deno.test('fără cost înaintea verificărilor (corp, secret, amprentă, context schimbat, imagine, refuzurile BD)', async () => {
  const it = await itemDeTest()
  const contextSchimbat = { ...it, context_inainte: 'alt loc din bandă' }                     // amprenta veche: refuz (Copilot / Jakarinos r2)
  const altItem = await itemDeTest({ citire_lighton: 'altceva' })                              // auto-consistent, dar nu e dezacordul din BD
  const cazuri: [string, Request, any, Opt, number][] = [
    ['secret greșit', cerere(corpDe(it), 'd'.repeat(64)), it, {}, 401],
    ['cheie în plus', cerere(corpDe(it, { alt: 1 })), it, {}, 400],
    ['doar amprenta, fără item', cerere({ rulare_id: 3, dezacord_id: 11, item_sha256: it.item_sha256, imagine_b64: IMG_B64 }), it, {}, 400],
    ['context schimbat după amprentă', cerere(corpDe(contextSchimbat)), it, {}, 422],
    ['număr zecimal în item', cerere(corpDe({ ...it, x: 1.5 })), it, {}, 422],
    ['context prea lung (amprentă corectă)', cerere(corpDe(await itemDeTest({ context_dupa: 'x'.repeat(2001) }))), it, {}, 422],
    ['item auto-consistent dar cu alte citiri decât BD', cerere(corpDe(altItem)), it, {}, 422],
    ['item cu alt id decât BD', cerere(corpDe(it)), it, { citire: { ...dinBD(it), item_id: 'p0001_b0_t9' } }, 422],
    ['nu e PNG', cerere(corpDe(it, { imagine_b64: btoa('%PDF-1.7 ' + 'x'.repeat(40)) })), it, {}, 422],
    ['base64 invalid', cerere(corpDe(it, { imagine_b64: 'a b' })), it, {}, 413],
    ['BD: dezacord străin', cerere(corpDe(it)), it, { citire: { refuz: 'dezacord' } }, 422],
    ['BD: imaginea nu e banda', cerere(corpDe(it)), it, { citire: { refuz: 'imagine' } }, 422],
    ['BD: structura_tabele', cerere(corpDe(it)), it, { citire: { refuz: 'tip' } }, 422],
    ['BD: deja arbitrat', cerere(corpDe(it)), it, { citire: { refuz: 'arbitrat' } }, 409],
    ['BD: rularea nu e în citita', cerere(corpDe(it)), it, { citire: { refuz: 'stare' } }, 402],
    ['rezervare: plafon', cerere(corpDe(it)), it, { rezerva: { refuz: 'plafon' } }, 402],
    ['rezervare: apel în zbor (cursă)', cerere(corpDe(it)), it, { rezerva: { refuz: 'in_zbor' } }, 409],
  ]
  for (const [nume, req, item, opt, cod] of cazuri) {
    const { m, apeluri, cereriApi } = mediu(item, opt)
    const r = await arbitreaza(req, m)
    assert.equal(r.status, cod, nume); assert.equal(cereriApi.length, 0, nume)
    assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'), nume)
    if (cod === 422 && /amprentă|context|zecimal/.test(nume)) assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_dezacord_arbitraj'), nume)
  }
})

Deno.test('imagine uriașă: limita de cost peste 1 USD → refuz fără rezervare', async () => {
  const mare = png(20000, 20000); const it = await itemDeTest({ image_sha256: await sha256Hex(mare) })
  const { m, apeluri, cereriApi } = mediu(it)
  const r = await arbitreaza(cerere(corpDe(it, { imagine_b64: btoa(String.fromCharCode(...mare)) })), m)
  assert.equal(r.status, 413); assert.equal(cereriApi.length, 0); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_rezerva'))
})

Deno.test('latură peste 8000 px (limita API): refuz fără rezervare și fără apel API (#712 Jakarinos P2)', async () => {
  const lat = png(9000, 400); const it = await itemDeTest({ image_sha256: await sha256Hex(lat) })
  const { m, apeluri, cereriApi } = mediu(it)
  const r = await arbitreaza(cerere(corpDe(it, { imagine_b64: btoa(String.fromCharCode(...lat)) })), m)
  assert.equal(r.status, 422); assert.equal((await r.json()).refuz, 'latura')
  assert.equal(cereriApi.length, 0); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_rezerva'))
})

Deno.test('banda_intreaga (bandă oprită de gardă): refuz fără rezervare, merge la om (Razvan 14.10)', async () => {
  const it = await itemDeTest({ tip: 'banda_intreaga' })
  const { m, apeluri, cereriApi } = mediu(it)
  const r = await arbitreaza(cerere(corpDe(it)), m)
  assert.equal(r.status, 422); assert.equal((await r.json()).refuz, 'banda')
  assert.equal(cereriApi.length, 0); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_rezerva'))
})

Deno.test('eroare API / rețea: 502, rezervarea rămâne deschisă, nicio decizie', async () => {
  const it = await itemDeTest()
  for (const api of [{ status: 529 }, { arunca: true }]) {
    const { m, apeluri } = mediu(it, { api })
    const r = await arbitreaza(cerere(corpDe(it)), m); const j = await r.json()
    assert.equal(r.status, 502); assert.equal(j.rezervare_id, 7); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'))
  }
})

Deno.test('ieșire în afara schemei / tăiată: decontat, needs_human', async () => {
  const it = await itemDeTest()
  for (const api of [{ text: 'Aleg MinerU.' }, { text: '{"decizie":"ales_mineru"}' }, { stop: 'max_tokens' }]) {
    const { m, apeluri } = mediu(it, { api })
    assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200)
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    assert.equal(a.decizie, 'needs_human'); assert.equal(a.text, ''); assert.equal(a.cost_usd, '0.0084')  // ambele apeluri, iesire invalida
  }
})

Deno.test('usage lipsă / invalid: decontare la TOATĂ rezervarea, needs_human', async () => {
  const it = await itemDeTest()
  for (const usage of [undefined, null, { input_tokens: 'x', output_tokens: 1 }, { input_tokens: -1, output_tokens: 1 }]) {
    const { m, apeluri } = mediu(it, { api: { usage } })
    assert.equal((await arbitreaza(cerere(corpDe(it)), m)).status, 200)
    const rez = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    assert.equal(a.decizie, 'needs_human'); assert.equal(a.cost_usd, rez.toFixed(4)); assert.equal(a.tokens_in, 0)
  }
})

Deno.test('cost real peste rezervare: UN RPC tranzacțional, verificat explicit; fără scrie_arbitraj', async () => {
  const it = await itemDeTest(); const usage = { input_tokens: 400000, output_tokens: 1000 }
  const ok = mediu(it, { api: { usage } })
  const r = await arbitreaza(cerere(corpDe(it)), ok.m); const j = await r.json()
  assert.equal(r.status, 500); assert.match(j.error, /cheltuiala blocată \(rularea: oprita\)/)
  const dp = ok.apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_depasire')!.args
  // Haiku a consumat deja peste toata rezervarea: Sonnet NU se mai cheama (Jakarinos r1 P1-1), depasirea se trateaza cu ce s-a consumat
  assert.deepEqual({ ...dp, p_cost_real: 0 }, { p_rezervare_id: 7, p_cost_real: 0, p_tokens_in: 400000, p_tokens_out: 1000, p_model: 'claude-haiku-5-5' })
  assert.equal(ok.cereriApi.length, 1)
  assert.ok(dp.p_cost_real > ok.apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma)
  assert.ok(!fnuri(ok.apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'))
  for (const depasire of [{ error: { message: 'refuz' } }, { data: { ok: true } }, { data: { ok: true, stare: 'citita', cheltuiala_blocata: false } }, { data: null }]) {  // eșec: răspunsul NU pretinde succes
    const e = mediu(it, { api: { usage }, depasire })
    const re = await arbitreaza(cerere(corpDe(it)), e.m); const je = await re.json()
    assert.equal(re.status, 500); assert.match(je.error, /EȘUAT/); assert.equal(je.rezervare_id, 7)
  }
})

Deno.test('decontat dar decizia respinsă de BD: 409, fără decizie în răspuns', async () => {
  const it = await itemDeTest()
  const { m } = mediu(it, { scrie: { ok: true, decontat: true, arbitraj_inregistrat: false, motiv: 'duplicate key' } })
  const r = await arbitreaza(cerere(corpDe(it)), m); const j = await r.json()
  assert.equal(r.status, 409); assert.equal(j.decizie, undefined); assert.equal(j.decontat, true)
})

Deno.test('bani in unitati de 0,0001 USD: exact la limita Sonnet incape, cu 0,0001 peste nu (Jakarinos cascada r3 P2)', () => {
  assert.equal(0.0011 + 0.0204 <= 0.0215, false)                // virgula mobila: comparatia veche ar fi refuzat escaladarea
  assert.equal(incapeArbitrul(0.0011, 0.0204, 0.0215), true)     // exact la limita
  assert.equal(incapeArbitrul(0.0012, 0.0204, 0.0215), false)    // 0,0001 peste
  assert.equal(incapeArbitrul(0, 0.0204, 0.0215), true)
})

// MODUL doar_haiku (laborator 16.10.2026): a doua trecere ieftina pe restantele fara cifre
Deno.test('doar_haiku: un singur apel Haiku, fără Sonnet chiar la needs_human; rezervarea = limita lui Haiku', async () => {
  const it = await itemDeTest({ citire_lighton: 'masuri de protecție', citire_mineru: 'masuri de protectie', diferenta_numerica: false })
  const nh = { text: JSON.stringify({ decizie: 'needs_human', text: '', motiv: 'nesigur', e_cantitate: false, anomalie_separator: false }) }
  const { m, apeluri, cereriApi } = mediu(it, { api: nh })
  const r = await arbitreaza(cerere(corpDe(it, { mod: 'doar_haiku' })), m); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(cereriApi.length, 1); assert.equal(cereriApi[0].model, 'claude-haiku-5-5')
  assert.equal(j.decizie.decizie, 'needs_human'); assert.equal(j.decizie.arbitru_model, 'claude-haiku-5-5')
  assert.ok(j.decizie.motiv.includes('[doar_haiku]'))
  const { m: m2, apeluri: a2 } = mediu(it, { api: nh })
  await arbitreaza(cerere(corpDe(it)), m2)  // cascada normala pe acelasi item: rezervare mai mare (include Sonnet)
  const sumaHaiku = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
  const sumaCascada = a2.find((x) => x.fn === 'fn_ofertare_ocr_arbitraj_rezerva')!.args.p_suma
  assert.ok(sumaHaiku > 0 && sumaHaiku < sumaCascada, `${sumaHaiku} < ${sumaCascada}`)
})

Deno.test('doar_haiku: refuz ÎNAINTEA rezervării dacă citirile din BD conțin vreo cifră (fără cost)', async () => {
  const it = await itemDeTest({ citire_lighton: 'lungime 10 m', citire_mineru: 'lungime 10 rn', diferenta_numerica: false })
  const { m, apeluri, cereriApi } = mediu(it)
  const r = await arbitreaza(cerere(corpDe(it, { mod: 'doar_haiku' })), m); const j = await r.json()
  assert.equal(r.status, 422); assert.equal(j.refuz, 'mod_cifre'); assert.equal(cereriApi.length, 0)
  assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_rezerva'))
})

Deno.test('doar_haiku: mod necunoscut sau chei în plus = 400, fără nicio citire din BD', async () => {
  const it = await itemDeTest({ citire_lighton: 'abc', citire_mineru: 'abd', diferenta_numerica: false })
  for (const extra of [{ mod: 'doar_sonnet' }, { mod: 'doar_haiku', alt: 1 }]) {
    const { m, apeluri } = mediu(it)
    const r = await arbitreaza(cerere(corpDe(it, extra)), m); assert.equal(r.status, 400); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_dezacord_arbitraj'))
  }
})

Deno.test('doar_haiku: cifre Unicode (², fullwidth, arabe) în citiri = refuz înaintea rezervării', async () => {
  for (const [a, b] of [['suprafata m²', 'suprafata m³'], ['lungime １２', 'lungime １３'], ['١٠ m', '٢٠ m']]) {
    const it = await itemDeTest({ citire_lighton: a, citire_mineru: b, diferenta_numerica: false })
    const { m, apeluri, cereriApi } = mediu(it)
    const r = await arbitreaza(cerere(corpDe(it, { mod: 'doar_haiku' })), m); const j = await r.json()
    assert.equal(r.status, 422, a); assert.equal(j.refuz, 'mod_cifre'); assert.equal(cereriApi.length, 0)
    assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_arbitraj_rezerva'))
  }
})

Deno.test('doar_haiku: text_propus cu cifre devine needs_human (nu se acceptă o cifră inventată pe calea ieftină)', async () => {
  const it = await itemDeTest({ citire_lighton: 'masuri de protectie', citire_mineru: 'masuri de protectle', diferenta_numerica: false })
  const tp = { text: JSON.stringify({ decizie: 'text_propus', text: 'masuri de protectie 12', motiv: 'corectat', e_cantitate: false, anomalie_separator: false }) }
  const { m, apeluri } = mediu(it, { api: tp })
  const r = await arbitreaza(cerere(corpDe(it, { mod: 'doar_haiku' })), m); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.decizie.decizie, 'needs_human'); assert.equal(j.decizie.text, '')
  assert.equal(apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj.decizie, 'needs_human')
})
