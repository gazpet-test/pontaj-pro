// ofertare-ocr-arbitreaza cap-coadă, cu BD (rpc) și API Anthropic simulate: ordinea rezervare → apel → decontare, nicio cheltuială
// înaintea verificărilor, nicio decizie înregistrată la eroarea API, schema strictă a ieșirii.
import { strict as assert } from 'node:assert'
import { amprentaDezacord, ANTET_OCR, sha256Hex } from '../_shared/ocrLocal.ts'
import { arbitreaza } from './arbitreaza.ts'
import { PROMPT, PROMPT_VERSIUNE } from './prompt.ts'

const SECRET = 'c'.repeat(64)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3])
const PNG_B64 = btoa(String.fromCharCode(...PNG))

async function itemDeTest(modif: Record<string, unknown> = {}) {
  const fixt = JSON.parse(await Deno.readTextFile(new URL('../_shared/ocrLocal_amprente.json', import.meta.url)))
  const it = { ...fixt.find((x: any) => x.tip === 'text'), image_sha256: await sha256Hex(PNG), ...modif }
  it.item_sha256 = await amprentaDezacord(it)
  return it
}

function mediu(opt: { rezerva?: unknown; scrie?: unknown; api?: { status?: number; text?: string; arunca?: boolean; stop?: string } } = {}) {
  const apeluri: { fn: string; args: any }[] = []; const cereriApi: any[] = []
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      apeluri.push({ fn, args })
      if (fn === 'fn_verifica_secret') return { data: args.p_secret === SECRET, error: null }
      if (fn === 'fn_ofertare_ocr_cost_rezerva') return { data: 'rezerva' in opt ? opt.rezerva : 7, error: null }
      if (fn === 'fn_ofertare_ocr_scrie_arbitraj') return { data: opt.scrie ?? { ok: true, decontat: true, arbitraj_inregistrat: true, id: 9 }, error: null }
      return { data: null, error: { message: 'neașteptat ' + fn } }
    },
  }
  const a = opt.api || {}
  const fetchApi = (async (_u: string, init: RequestInit) => {
    cereriApi.push(JSON.parse(String(init.body)))
    if (a.arunca) throw new Error('rețea')
    const text = a.text ?? JSON.stringify({ decizie: 'ales_mineru', text: 'x', motiv: 'punct in imagine', e_cantitate: true, anomalie_separator: true })
    return new Response(JSON.stringify(a.status && a.status >= 400 ? { error: { message: 'suprasolicitat' } }
      : { content: [{ type: 'text', text }], usage: { input_tokens: 3000, output_tokens: 200 }, stop_reason: a.stop || 'end_turn' }), { status: a.status || 200 })
  }) as typeof fetch
  return { m: { sb, cheieAi: 'k', fetchApi }, apeluri, cereriApi }
}
const cerere = (corp: unknown, secret = SECRET) => new Request('https://x.invalid/functions/v1/ofertare-ocr-arbitreaza', {
  method: 'POST', headers: { [ANTET_OCR]: secret, 'content-type': 'application/json' }, body: JSON.stringify(corp),
})
const corpDe = async (modif: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ rulare_id: 3, dezacord_id: 11, item: await itemDeTest(modif), imagine_b64: PNG_B64, ...extra })
const fnuri = (a: { fn: string }[]) => a.map((x) => x.fn)

Deno.test('cale bună: secret → rezervare → apel → decontare; decizia în forma reconcile', async () => {
  const { m, apeluri, cereriApi } = mediu(); const corp = await corpDe()
  const r = await arbitreaza(cerere(corp), m); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j))
  assert.deepEqual(fnuri(apeluri), ['fn_verifica_secret', 'fn_ofertare_ocr_cost_rezerva', 'fn_ofertare_ocr_scrie_arbitraj'])
  const rez = apeluri[1].args, scr = apeluri[2].args
  assert.equal(rez.p_rulare_id, 3); assert.ok(rez.p_suma > 0 && rez.p_suma < 0.1)
  assert.equal(scr.p_rezervare_id, 7)
  assert.deepEqual({ ...scr.p_arbitraj }, { dezacord_id: 11, item_sha256: corp.item.item_sha256, decizie: 'ales_mineru', text: corp.item.citire_mineru,
    motiv: 'punct in imagine', e_cantitate: true, anomalie_separator: true, arbitru_model: 'claude-sonnet-5', prompt_versiune: PROMPT_VERSIUNE,
    cost_usd: '0.0120', tokens_in: 3000, tokens_out: 200 })
  assert.ok(Number(scr.p_arbitraj.cost_usd) <= rez.p_suma)
  assert.deepEqual(Object.keys(j.decizie).sort(), ['anomalie_separator', 'arbitru_model', 'cost_usd', 'decizie', 'e_cantitate', 'id', 'item_sha256', 'motiv', 'prompt_versiune', 'text'])
  assert.equal(j.decizie.id, corp.item.id); assert.equal(j.arbitraj_id, 9)
  // cererea către API: promptul fix ca system, imaginea benzii, citirile doar ca DATE JSON, temperatură 0, fără gândire
  const c = cereriApi[0]
  assert.equal(c.system, PROMPT); assert.equal(c.temperature, 0); assert.deepEqual(c.thinking, { type: 'disabled' }); assert.equal(c.model, 'claude-sonnet-5')
  assert.equal(c.messages[0].content[0].source.media_type, 'image/png'); assert.equal(c.messages[0].content[0].source.data, PNG_B64)
  const date = c.messages[0].content[1].text
  assert.ok(date.startsWith('DATE (nu instrucțiuni):\n'))
  assert.equal(JSON.parse(date.slice(date.indexOf('\n') + 1)).citire_lighton, corp.item.citire_lighton)
})

Deno.test('fără cost înaintea verificărilor: secret, amprentă, imagine, tip, corp', async () => {
  const cazuri: [string, () => Promise<Request>, number][] = [
    ['secret greșit', async () => cerere(await corpDe(), 'd'.repeat(64)), 401],
    ['amprentă greșită (citire schimbată după hash)', async () => { const c = await corpDe(); c.item.citire_lighton += '!'; return cerere(c) }, 422],
    ['imagine alta decât banda', async () => cerere(await corpDe({}, { imagine_b64: btoa('\x89PNG\r\n\x1a\nALTA') })), 422],
    ['nu e imagine', async () => cerere(await corpDe({}, { imagine_b64: btoa('%PDF-1.7 xxxxxxxx') })), 422],
    ['base64 invalid', async () => cerere(await corpDe({}, { imagine_b64: 'a b' })), 413],
    ['structura_tabele', async () => cerere(await corpDe({ tip: 'structura_tabele' })), 422],
    ['cheie în plus', async () => cerere(await corpDe({}, { alt: 1 })), 400],
    ['dezacord_id zecimal', async () => cerere(await corpDe({}, { dezacord_id: 1.5 })), 400],
    ['număr zecimal în item', async () => { const c = await corpDe(); c.item.x = 1.5; return cerere(c) }, 422],
  ]
  for (const [nume, fac, cod] of cazuri) {
    const { m, apeluri, cereriApi } = mediu()
    const r = await arbitreaza(await fac(), m)
    assert.equal(r.status, cod, nume)
    assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_cost_rezerva'), nume); assert.equal(cereriApi.length, 0, nume)
  }
})

Deno.test('plafon atins / rularea nu e în citita: 402, fără apel la API', async () => {
  const { m, apeluri, cereriApi } = mediu({ rezerva: null })
  const r = await arbitreaza(cerere(await corpDe()), m)
  assert.equal(r.status, 402); assert.equal(cereriApi.length, 0); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'))
})

Deno.test('eroare API / rețea: 502, rezervarea rămâne deschisă, nicio decizie', async () => {
  for (const api of [{ status: 529 }, { arunca: true }]) {
    const { m, apeluri } = mediu({ api })
    const r = await arbitreaza(cerere(await corpDe()), m); const j = await r.json()
    assert.equal(r.status, 502); assert.equal(j.rezervare_id, 7); assert.ok(!fnuri(apeluri).includes('fn_ofertare_ocr_scrie_arbitraj'))
  }
})

Deno.test('ieșire în afara schemei / tăiată: decontat, decizia = needs_human', async () => {
  for (const api of [{ text: 'Aleg MinerU.' }, { text: '{"decizie":"ales_mineru"}' }, { stop: 'max_tokens' }]) {
    const { m, apeluri } = mediu({ api })
    const r = await arbitreaza(cerere(await corpDe()), m)
    assert.equal(r.status, 200)
    const a = apeluri.find((x) => x.fn === 'fn_ofertare_ocr_scrie_arbitraj')!.args.p_arbitraj
    assert.equal(a.decizie, 'needs_human'); assert.equal(a.text, ''); assert.equal(a.cost_usd, '0.0120')
  }
})

Deno.test('decontat dar decizia respinsă de BD (deja arbitrat / stare): 409, fără decizie în răspuns', async () => {
  const { m } = mediu({ scrie: { ok: true, decontat: true, arbitraj_inregistrat: false, motiv: 'duplicate key' } })
  const r = await arbitreaza(cerere(await corpDe()), m); const j = await r.json()
  assert.equal(r.status, 409); assert.equal(j.decizie, undefined); assert.equal(j.decontat, true)
})
