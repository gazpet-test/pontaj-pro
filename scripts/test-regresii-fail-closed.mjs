// Offline, fără dependențe: Node 24. Rulează și testele Deno de talon printr-un adaptor minim.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import * as guards from '../supabase/functions/_shared/structuraExtrageri.ts'
import * as haiku from '../supabase/functions/_shared/haiku55.ts'
import * as gandire from '../supabase/functions/_shared/gandire.ts'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('jsr:')) return { url: 'offline:' + specifier, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.startsWith('offline:')) return next(url, context)
    const source = url.includes('@std/assert')
      ? `import a from 'node:assert/strict'; export const assert = a; export const assertEquals = a.deepStrictEqual;`
      : `export function createClient() { throw new Error('Client real interzis în test'); }`
    return { format: 'module', source, shortCircuit: true }
  },
})
globalThis.Deno = { test, env: { get: () => undefined } }
await import('../supabase/functions/extract-talon-ai/handler_test.ts')
await import('../supabase/functions/extract-talon-ai/acces_test.ts')

test('recomandări: null permis, pachet integral sau refuz', () => {
  const letter = { nume_persoana: 'POPESCU ION', rol: null, beneficiar: null, obiect_lucrare: null }
  assert.equal(guards.recomandariValide([letter, { ...letter, rol: 'RTE' }]), true)
  assert.equal(guards.recomandariValide(Array.from({ length: 26 }, () => letter)), true)
  for (const bad of [null, [], {}, { rol: 'RTE' }, { nume_persoana: '' }]) {
    assert.equal(guards.recomandariValide([letter, bad]), false)
  }
})
test('contract/talon: numai câmpuri utile, nu metadate sau obiecte goale', () => {
  for (const bad of [{}, [], null, { confidence: 95 }, { marca: null }, { denumire: ' ' }]) {
    assert.equal(guards.contractUtil(bad), false)
    assert.equal(guards.talonUtil(bad), false)
  }
  assert.equal(guards.contractUtil({ numar_contract: 123, denumire: null }), true)
  assert.equal(guards.contractUtil({ clauze: { plata: '30 zile' } }), true)
  assert.equal(guards.contractUtil({ clauze: { plata: null } }), false)
  assert.equal(guards.talonUtil({ an_fabricatie: 2020, serie_sasiu: null }), true)
})
test('clasificare: tip plus informație extrasă; campuri={} și modul=null permise', () => {
  for (const bad of [{}, { tip_document: 'altul' }, { titlu_scurt: 'Act' },
    { tip_document: 'altul', campuri: { cnp: null } }]) assert.equal(guards.clasificareUtila(bad), false)
  assert.equal(guards.clasificareUtila({ modul: null, tip_document: 'altul', titlu_scurt: 'Document ilizibil', campuri: {} }), true)
  assert.equal(guards.clasificareUtila({ tip_document: 'aviz', date_document: { numar: 123 } }), true)
})
test('autorizație: descrierea singură nu definește propunerea; null și răspunsul negativ sunt permise', () => {
  const valid = { este_autorizatie: true, tip_cod: null, autorizatie_existenta_id: null, incredere: 70, citat: 'Certificat profesional' }
  assert.equal(guards.propunereValida({ ce_este: 'autorizatie' }), false)
  assert.equal(guards.propunereValida(valid), true)
  assert.equal(guards.propunereValida({ ...valid, este_autorizatie: false, ce_este: 'CV' }), true)
  for (const key of ['este_autorizatie', 'tip_cod', 'autorizatie_existenta_id', 'incredere']) {
    const incomplete = { ...valid }; delete incomplete[key]
    assert.equal(guards.propunereValida(incomplete), false)
  }
})
test('faze: lista goală doar cu absență explicită; niciodată listă parțial validă', () => {
  assert.equal(guards.fazeValide({ faze: [], are_faze_determinante: false, confidence: 95 }), true)
  for (const bad of [{}, { faze: [] }, { faze: [], are_faze_determinante: true },
    { faze: [{ denumire: 'Recepție' }, {}] }]) assert.equal(guards.fazeValide(bad), false)
  assert.equal(guards.fazeValide({ faze: [{ denumire: 'Recepție' }] }), true)
})
test('RAG: acoperire exactă, pagini absolute, pagini goale explicite', () => {
  const pages = Array.from({ length: 5 }, (_, i) => ({ pagina: 6 + i, text: i === 1 ? '' : 'Text' }))
  assert.equal(guards.lotPaginiValid(pages, 6, 5), true)
  for (const bad of [pages.slice(0, 1), [...pages.slice(0, 4), pages[0]],
    [...pages.slice(0, 4), { pagina: 11, text: 'Text' }],
    [...pages.slice(0, 4), { pagina: 10 }]]) assert.equal(guards.lotPaginiValid(bad, 6, 5), false)
})

// Executăm funcțiile reale cu dependențe simulate; niciun client real, fetch sau DB.
function loadFunction(path, name, globals = {}) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
  let handler
  const context = vm.createContext({ ...guards, ...haiku, ...gandire, Response, console, btoa,
    Deno: { serve(fn) { handler = fn }, env: { get() { return 'offline-test' } } }, ...globals })
  const result = vm.runInContext(stripTypeScriptTypes(source) + (name ? `\n;${name}` : ''), context)
  return name ? result : handler
}
test('service AI: max_tokens/refusal/gol nu pot asocia sau alimenta cache-ul', async () => {
  for (const [stop_reason, text] of [['max_tokens', '{"activ_id":7,"confidence":0.99}'],
    ['refusal', '{"activ_id":7,"confidence":0.99}'], ['end_turn', '   '], ['end_turn', 'null']]) {
    let reads = 0
    const match = loadFunction('src/process_carte_service_ai_index.ts', 'tryAiMatch', {
      fetch: async () => new Response(JSON.stringify({ stop_reason, content: [{ type: 'text', text }] })),
    })
    const result = await match({ denumire: 'Utilaj' }, 'test', { from() { reads++; throw new Error('DB interzis') } })
    assert.equal(result.activ_id, null)
    assert.equal(result.match_confidence, 0)
    assert.equal(result.match_method, 'unmatched')
    assert.equal(reads, 0)
  }
})
test('RAG real: lot incomplet respins înainte de indexare; răspuns tăiat marcat', async () => {
  const response = { stop_reason: 'end_turn', content: [{ type: 'text', text: '[{"pagina":1,"text":"Text"}]' }] }
  const globals = { fetch: async () => new Response(JSON.stringify(response)),
    Supabase: { ai: { Session: class { async run() { return [1] } } } } }
  const supa = { from: () => ({ insert: async () => ({}) }), rpc: async () => ({ data: [
    { sursa: 'Manual', content: 'Text', document_id: 1, referinta: 'pag. 1', similarity: 1 },
  ] }) }
  const transcribe = loadFunction('supabase/functions/rag-utilaj/index.ts', 'transcribeBatch', globals)
  assert.match((await transcribe('', 1, 5, supa, 1)).refuz, /toate paginile/)
  response.stop_reason = 'max_tokens'; response.content[0].text = 'Răspuns parțial'
  const answer = loadFunction('supabase/functions/rag-utilaj/index.ts', 'searchAndAnswer', globals)
  const result = await answer(supa, 'Întrebare', null, true)
  assert.equal(result.incomplet, true)
  assert.match(result.answer, /Răspuns parțial[\s\S]*Răspuns incomplet/)
})

async function runExtraction(path, answer, stop_reason = 'end_turn', httpStatus = 200) {
  const writes = []
  const tables = {
    profiles: [{ is_owner: true }],
    hr_recomandari: [{ id: 1, employee_id: 2, fisier_path: 'a.pdf', fisier_mime: 'application/pdf', emp: { name: 'POPESCU ION' } }],
    hr_documente_personale: [{ id: 1, employee_id: 2, fisier_path: 'a.pdf', emp: { name: 'POPESCU ION' } }],
    hr_autorizatii_tipuri: [{ id: 1, cod: 'RTE', denumire: 'RTE' }],
    contracte_terti: [{ id: 1, denumire: 'Contract existent' }],
    ai_documente_inbox: [{ id: 1, fisier_path: 'a.pdf', fisier_nume: 'a.pdf', status: 'clasificat', payload_ai: { vechi: true } }],
  }
  const supa = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    storage: { from: () => ({ download: async () => ({ data: new Blob(['PDF']) }) }) },
    from(table) {
      let single = false, write = false
      const q = {}
      for (const method of ['select', 'eq', 'is', 'order', 'neq', 'or', 'limit']) q[method] = () => q
      for (const method of ['single', 'maybeSingle']) q[method] = () => { single = true; return q }
      for (const method of ['update', 'insert', 'delete']) q[method] = row => {
        write = true; writes.push({ table, method, row }); return q
      }
      q.then = (resolve, reject) => Promise.resolve({ data: write ? null :
        (single ? tables[table]?.[0] ?? null : tables[table] ?? []), error: null, count: 0 }).then(resolve, reject)
      return q
    },
  }
  const handler = loadFunction(path, null, {
    createClient: () => supa, esteApelIntern: async () => true, userAutorizat: async () => true,
    fetch: async () => new Response(JSON.stringify({ stop_reason,
      content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] }), { status: httpStatus }),
  })
  const result = await handler(new Request('http://offline/', { method: 'POST',
    headers: { Authorization: 'Bearer offline-test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ recomandare_id: 1, document_id: 1, contract_id: 1, proiect_id: 1, inbox_id: 1, pdf_path: 'a.pdf' }),
  }))
  return { result, body: await result.json(), writes: writes.filter(w => w.table !== 'ai_usage_log') }
}
test('handler recomandări: păstrează scrisoarea cu rol null, refuză integral lista parțial invalidă', async () => {
  const letter = { nume_persoana: 'POPESCU ION', rol: null, beneficiar: null, obiect_lucrare: null }
  const valid = await runExtraction('supabase/functions/hr-recomandare-citeste/index.ts', { recomandari: [letter, letter] })
  assert.equal(valid.body.ok, true)
  assert.equal(valid.body.gasite_in_fisier, 2)
  assert.equal(valid.writes.find(w => w.method === 'insert').row.length, 1)
  const invalid = await runExtraction('supabase/functions/hr-recomandare-citeste/index.ts', { recomandari: [letter, {}] })
  assert.equal(invalid.body.ok, false)
  assert.equal(invalid.writes.length, 0)
})
test('handler contract: Rezultat: {} nu suprascrie clauzele; numărul numeric este util', async () => {
  const bad = await runExtraction('supabase/functions/parse-contract-pdf/index.ts', 'Rezultat: {}')
  assert.equal(bad.result.status, 422)
  assert.equal(bad.writes.length, 0)
  const good = await runExtraction('supabase/functions/parse-contract-pdf/index.ts', { numar_contract: 123, denumire: null })
  assert.equal(good.body.success, true)
  assert.equal(good.writes[0].row.numar_contract, 123)
})
test('handler autorizație: descrierea sau HTTP eșuat nu retrag propunerea', async () => {
  for (const httpStatus of [200, 500]) {
    const bad = await runExtraction('supabase/functions/hr-autorizatie-citeste/index.ts', { ce_este: 'autorizatie' }, 'end_turn', httpStatus)
    assert.equal(bad.body.ok, false)
    assert.equal(bad.writes.length, 0)
  }
  const good = await runExtraction('supabase/functions/hr-autorizatie-citeste/index.ts', {
    este_autorizatie: false, tip_cod: null, autorizatie_existenta_id: null, incredere: 95, ce_este: 'CV', citat: 'Curriculum vitae',
  })
  assert.equal(good.body.ok, true)
  assert.equal(good.writes.find(w => w.method === 'insert').row.actiune, 'nimic')
})
test('handler PCCVI: absența explicită acceptată, max_tokens/refusal/gol refuzate fără ștergeri', async () => {
  const answer = { faze: [], are_faze_determinante: false, confidence: 95 }
  const good = await runExtraction('supabase/functions/parse-pccvi-faze/index.ts', answer)
  assert.equal(good.body.success, true)
  assert.equal(good.body.extrase, 0)
  for (const [stop, value] of [['max_tokens', answer], ['refusal', answer], ['end_turn', ' '], ['end_turn', '{}']]) {
    const bad = await runExtraction('supabase/functions/parse-pccvi-faze/index.ts', value, stop)
    assert.equal(bad.writes.length, 0)
    assert.ok(bad.body.error)
  }
})
test('handler citeste-orice: {} păstrează payload-ul; campuri={} cu titlu și număr numeric se acceptă', async () => {
  const bad = await runExtraction('supabase/functions/citeste-orice/index.ts', {})
  assert.ok(bad.body.error)
  assert.ok(bad.writes.every(w => !('payload_ai' in w.row)))
  const good = await runExtraction('supabase/functions/citeste-orice/index.ts', {
    modul: null, tip_document: 'altul', titlu_scurt: 'Document contractual', campuri: {},
    date_document: { numar: 123, valoare_totala: 1234.56 },
  })
  assert.equal(good.body.ok, true)
  const payload = good.writes[0].row.payload_ai
  assert.equal(payload.date_document.numar, '123')
  assert.equal(payload.date_document.valoare_totala, 1234.56)
})
