import { strict as assert } from 'node:assert'
import { inventarValid, comparatieValida } from './validare.ts'
import { mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'

const dispozitie = { nr: null, tip: 'confirmare', rezumat: 'Se menține cerința.', citat: 'Se menține documentația.', loturi: [], trimite_la: null }
const complet = { dispozitii: [dispozitie], coada_deschisa: 'Solicitare neterminată', acoperit_tot: true }

Deno.test('inventar: anexă goală validă și coadă explicită acceptate', () => {
  assert.ok(inventarValid(complet))
  assert.ok(inventarValid({ dispozitii: [], coada_deschisa: null, acoperit_tot: true }))
})

Deno.test('inventar: câmpuri lipsă, tipuri greșite, dispoziții parțiale și acoperire incompletă respinse', () => {
  for (const k of Object.keys(complet)) {
    const j: any = { ...complet }; delete j[k]
    assert.equal(inventarValid(j), false, k)
    assert.equal(inventarValid({ ...complet, [k]: {} }), false, k)
  }
  for (const k of Object.keys(dispozitie)) {
    const x: any = { ...dispozitie }; delete x[k]
    assert.equal(inventarValid({ ...complet, dispozitii: [x] }), false, k)
    assert.equal(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, [k]: {} }] }), false, k)
  }
  for (const j of [{}, [], null, { ...complet, acoperit_tot: false }, { ...complet, acoperit_tot: 'true' },
    { ...complet, dispozitii: [null] }, { ...complet, dispozitii: [{ ...dispozitie, citat: ' ' }] }]) {
    assert.equal(inventarValid(j), false)
  }
})

Deno.test('inventar: gardurile reale păstrează coada și documentele citite la orice răspuns invalid', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  const start = src.indexOf('    if (d?.usage)', src.indexOf("if (actiune === 'inventar')"))
  const bloc = src.slice(start, src.indexOf('    const noi: any[] = []', start))
  const extrageJson = (txt: string) => { try { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null } catch { return null } }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const ruleaza = new AsyncFunction('ok', 'status', 'd', 'taiat', 'cost', 'json', 'mesajRefuz', 'textRaspuns',
    'extrageJson', 'inventarValid', 'db', 'MODEL', 'tin', 'tout', 'setId', bloc + '\nreturn { valid: true }')
  const raspuns = (j: unknown, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(j) }] })
  for (const [ok, d] of [[false, raspuns(complet)], [true, raspuns(complet, 'max_tokens')],
    [true, raspuns(complet, 'refusal')], [true, { content: [] }], [true, { content: [{ type: 'text', text: ' ' }] }],
    [true, raspuns({})], [true, raspuns({ dispozitii: [] })], [true, raspuns({ ...complet, acoperit_tot: false })],
    [true, raspuns({ ...complet, dispozitii: [{ tip: 'confirmare' }] })],
    [true, { content: [{ type: 'text', text: '{' }] }]] as const) {
    for (const usage of [undefined, { input_tokens: 100, output_tokens: 20 }]) {
      const loguri: any[] = []
      const cost = 100 * 2e-6 + 20 * 10e-6
      const r = await ruleaza(ok, 200, { ...d, usage }, 'stop_reason' in d && d.stop_reason === 'max_tokens', cost,
        (v: unknown) => v, mesajRefuz, textRaspuns, extrageJson, inventarValid,
        { from(t: string) { assert.equal(t, 'ai_usage_log'); return { insert(v: unknown) { loguri.push(v) } } } },
        'model-test', 100, 20, 1)
      assert.ok(r.error); assert.equal(loguri.length, usage ? 1 : 0)
      if (usage) { assert.equal(loguri[0].tokens_in, 100); assert.equal(loguri[0].cost_usd, cost) }
    }
  }
  for (const j of [complet, { dispozitii: [], coada_deschisa: null, acoperit_tot: true }]) {
    let scrieri = 0
    const r = await ruleaza(true, 200, { ...raspuns(j), usage: {} }, false, 0, (v: unknown) => v, mesajRefuz, textRaspuns,
      extrageJson, inventarValid, { from() { return { insert() { scrieri++ } } } }, 'model-test', 0, 0, 1)
    assert.equal(r.valid, true); assert.equal(scrieri, 1)
  }
})

Deno.test('inventar: nr null/text/număr finit acceptat; lipsă, infinit și tipuri greșite respinse', () => {
  for (const nr of [null, '7', 7, 0]) assert.ok(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, nr }] }))
  for (const nr of [undefined, NaN, Infinity, true, {}, []])
    assert.equal(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, nr }] }), false)
})

Deno.test('inventar: loturi null sau numerice acceptate (fals-negative, review)', () => {
  assert.ok(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, loturi: null }] }))
  assert.ok(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, loturi: [1, '2'] }] }))
  assert.equal(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, loturi: [{}] }] }), false)
})

const operatie = { disp_nr: 'd1', fel: 'modifica', cerinta_id: 1, text_nou: 'Termen 30 zile',
  tip: 'propunere', document_probant: null, cand_se_prezinta: null, citat: 'Termenul este de 30 zile.',
  motiv: 'Se prelungește termenul', incredere: 'ridicata', necesita_revizuire: false, loturi: [] }
const comparatie = { operatii: [operatie], neclare: [{ disp_nr: 'd2', de_ce: 'Confirmare' }] }

Deno.test('compara: structură completă sau liste goale acceptate; fiecare cheie rămâne obligatorie', () => {
  for (const j of [comparatie, { operatii: [], neclare: [] },
    { operatii: [{ ...operatie, fel: 'anuleaza', text_nou: null }], neclare: [] },
    { operatii: [{ ...operatie, fel: 'noua', cerinta_id: null, text_nou: 30, document_probant: 7 }], neclare: [] },
    { operatii: [], neclare: [{ disp_nr: 7, de_ce: null }] }]) assert.ok(comparatieValida(j))
  for (const k of Object.keys(comparatie)) {
    const j: any = structuredClone(comparatie); delete j[k]; assert.equal(comparatieValida(j), false, k)
    assert.equal(comparatieValida({ ...comparatie, [k]: {} }), false, k)
  }
  for (const lista of ['operatii', 'neclare'] as const) {
    for (const k of Object.keys(comparatie[lista][0])) {
      const j: any = structuredClone(comparatie); delete j[lista][0][k]
      assert.equal(comparatieValida(j), false, lista + '.' + k)
    }
    assert.equal(comparatieValida({ ...comparatie, [lista]: [null] }), false)
    assert.equal(comparatieValida({ ...comparatie, [lista]: [comparatie[lista][0], {}] }), false)
  }
  for (const patch of [{ fel: 'gresit' }, { citat: ' ' }, { cerinta_id: '1' }, { cerinta_id: null },
    { text_nou: null }, { text_nou: {} }, { loturi: [true] }, { necesita_revizuire: null }])
    assert.equal(comparatieValida({ ...comparatie, operatii: [{ ...operatie, ...patch }] }), false)
})

Deno.test('compara: gardurile reale blochează inclusiv max_tokens cu JSON valid înainte de marcarea dispozițiilor', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  const start = src.indexOf("    await db.from('ai_usage_log')", src.indexOf("if (actiune === 'compara')"))
  const bloc = src.slice(start, src.indexOf('    const idsEligibile', start))
  const normalizare = src.slice(src.indexOf('    let normalizareSchimbata'), src.indexOf('    const facute'))
    .replace(/: Record<string, string>|: any\[\]|: any/g, '')
  const startMarcare = src.indexOf('    const comparate = [...facute')
  const marcare = src.slice(startMarcare, src.indexOf('    // Fiecare', startMarcare))
    .replace(/: any/g, '')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const ruleaza = new AsyncFunction('ok', 'status', 'd', 'taiat', 'cost', 'json', 'mesajRefuz', 'textRaspuns',
    'extrageJson', 'comparatieValida', 'db', 'MODEL', 'tin', 'tout', 'setId', 'prop', 'set',
    'participareLicitatie', 'contextOperatii', 'motivOperatie', 'mesajLot', 'facute', 'lot', 'toate',
    normalizare + bloc + marcare + '\nreturn { valid: true, comparate, prop }')
  const raspuns = (j: unknown, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(j) }] })
  const gol = { operatii: [], neclare: [] }
  for (const [ok, d] of [[false, raspuns(gol)], [true, raspuns(gol, 'max_tokens')],
    [true, raspuns(gol, 'refusal')], [true, { content: [{ type: 'refusal', refusal: 'Refuz' }] }],
    [true, { content: [] }], [true, { content: [{ type: 'text', text: ' ' }] }],
    [true, { content: [{ type: 'text', text: '{' }] }], [true, raspuns({})],
    [true, raspuns({ operatii: [] })], [true, raspuns({ ...comparatie, operatii: [operatie, {}] })],
    [true, raspuns(gol)], [true, raspuns(comparatie)]] as const) {
    const loguri: any[] = []
    const prop = { dispozitii_comparate: ['veche'], operatii: [{ op_id: 'o1', cerinta_id: 1 }] }
    const copie = structuredClone(prop)
    const lot = [{ disp_id: 'd1', tip: 'efect_posibil' }, { disp_id: 'd2', tip: 'efect_posibil' }]
    const r = await ruleaza(ok, 500, d, 'stop_reason' in d && d.stop_reason === 'max_tokens', 1,
      (v: unknown) => v, mesajRefuz, textRaspuns,
      (txt: string) => { try { return JSON.parse(txt) } catch { return null } }, comparatieValida,
      { from(t: string) { assert.equal(t, 'ai_usage_log'); return { insert(v: unknown) { loguri.push(v) } } },
        rpc() { return { data: [{ cerinta_id: 1, amprenta: 'actuala' }] } } },
      'model-test', 100, 20, 1, prop, { licitatie_id: 1 }, () => ({ ok: true }), () => ({ peLoturi: false }),
      () => 'tinta_schimbata', (m: string) => m, new Set(['veche']), lot, lot)
    const valid = ok && 'stop_reason' in d && d.stop_reason === 'end_turn' &&
      comparatieValida(JSON.parse(d.content[0].text))
    assert.equal(r.valid === true, !!valid)
    if (!valid) assert.ok(r.error)
    assert.equal(loguri.length, 1)
    assert.deepEqual(prop, copie, 'normalizarea nu modifică propunerea originală')
    if (valid) {
      assert.deepEqual(r.comparate, ['veche', 'd1', 'd2'])
      assert.deepEqual(r.prop.operatii, [])
      assert.equal(r.prop.operatii_provenienta[0].motiv_provenienta, 'tinta_schimbata')
    } else assert.equal(r.comparate, undefined)
  }
})
