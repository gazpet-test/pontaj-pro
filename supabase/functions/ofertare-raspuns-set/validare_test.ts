import { strict as assert } from 'node:assert'
import { inventarValid } from './validare.ts'
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
  const start = src.indexOf('    if (!ok) return json', src.indexOf("if (actiune === 'inventar')"))
  const bloc = src.slice(start, src.indexOf('    const noi: any[] = []', start))
  const extrageJson = (txt: string) => { try { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null } catch { return null } }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const ruleaza = new AsyncFunction('ok', 'status', 'd', 'taiat', 'cost', 'json', 'mesajRefuz', 'textRaspuns',
    'extrageJson', 'inventarValid', 'db', 'MODEL', 'tin', 'tout', 'setId', bloc + '\nreturn { valid: true }')
  const raspuns = (j: unknown, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(j) }] })
  for (const [ok, d] of [[false, raspuns(complet)], [true, raspuns(complet, 'max_tokens')],
    [true, raspuns(complet, 'refusal')], [true, { content: [] }], [true, { content: [{ type: 'text', text: ' ' }] }],
    [true, raspuns({})], [true, raspuns({ dispozitii: [] })], [true, raspuns({ ...complet, acoperit_tot: false })],
    [true, raspuns({ ...complet, dispozitii: [{ tip: 'confirmare' }] })]] as const) {
    let scrieri = 0
    const r = await ruleaza(ok, 200, d, 'stop_reason' in d && d.stop_reason === 'max_tokens', 0,
      (v: unknown) => v, mesajRefuz, textRaspuns, extrageJson, inventarValid,
      { from() { scrieri++; throw Error('scriere') } }, 'model-test', 0, 0, 1)
    assert.ok(r.error); assert.equal(scrieri, 0)
  }
  for (const j of [complet, { dispozitii: [], coada_deschisa: null, acoperit_tot: true }]) {
    let scrieri = 0
    const r = await ruleaza(true, 200, raspuns(j), false, 0, (v: unknown) => v, mesajRefuz, textRaspuns,
      extrageJson, inventarValid, { from() { return { insert() { scrieri++ } } } }, 'model-test', 0, 0, 1)
    assert.equal(r.valid, true); assert.equal(scrieri, 1)
  }
})

Deno.test('inventar: loturi null sau numerice acceptate (fals-negative, review)', () => {
  assert.ok(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, loturi: null }] }))
  assert.ok(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, loturi: [1, '2'] }] }))
  assert.equal(inventarValid({ ...complet, dispozitii: [{ ...dispozitie, loturi: [{}] }] }), false)
})
