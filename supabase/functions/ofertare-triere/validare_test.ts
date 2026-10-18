import { strict as assert } from 'node:assert'
import { triereValida } from './validare.ts'
import { mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'

const complet = {
  obiect: 'Rețea gaze', autoritate: 'Primăria', nr_anunt: null, termen_depunere: null,
  zile_clarificari: null, termen_raspuns_ac: null, amplasament: 'Ploiești', descriere: 'Distribuție',
  tip_lucrare_gaze: { tip: 'distributie', presiune: null, diametru: null, motiv: 'Obiectul contractului' },
  valoare_estimata: null, termen_executie: null, criteriu: 'Preț',
  experienta_similara: { cerinta: null, lucrari_acceptate: null }, cumul_functii_interzis: false,
  matrice_experti: [{ persoana: 'POP ION', rol: 'RTE', proiecte: 0, verificate: 0,
    proiecte_conditionate: 0, verificate_conditionate: 0, surse: 'Fără recomandări' }],
  roluri: [{ rol: 'RTE', rol_canonic: 'rte', natura_ceruta: 'distributie', exclude_transport: false,
    cerinte: 'RTE 8.4 D', autorizatie_ceruta: null, barem: null, documente: 'Atestat', propunere: null, motiv: 'Lipsă dovadă' }],
  atestari: null, atestari_firma: [{ cerinta: 'ET', document_firma_id: null }], sursa_finantare: null,
  garantie_participare: null, garantie_buna_executie: null, organizare_santier: null,
  liste_cantitati: null, grafic: null, laborator: null, alte_cerinte: [], clarificari_propuse: [],
  verdict: 'cu_clarificari', motiv_verdict: 'Lipsesc dovezi.', confidence: 80,
}

Deno.test('triere: structură completă, liste goale și null explicit acceptate', () => {
  assert.ok(triereValida(complet))
  assert.ok(triereValida({ ...complet, roluri: [], matrice_experti: [], atestari_firma: [] }))
})

Deno.test('triere: niciun câmp lipsă sau de tip greșit nu autorizează înlocuirea', () => {
  for (const k of Object.keys(complet)) {
    const j: any = { ...complet }; delete j[k]
    assert.equal(triereValida(j), false, k + ' lipsă')
    assert.equal(triereValida({ ...complet, [k]: {} }), false, k + ' tip greșit')
  }
  for (const k of ['roluri', 'matrice_experti', 'atestari_firma'] as const) {
    for (const field of Object.keys(complet[k][0])) {
      const j: any = structuredClone(complet); delete j[k][0][field]
      assert.equal(triereValida(j), false, k + '.' + field)
    }
  }
  for (const j of [{}, { verdict: 'mergem' }, null, [], { ...complet, verdict: 'da' },
    { ...complet, motiv_verdict: ' ' }, { ...complet, confidence: '80' }]) assert.equal(triereValida(j), false)
})

Deno.test('triere: barem complet acceptat; câmpuri imbricate parțiale sau de tip greșit respinse', () => {
  const barem = { minim: 1, unitate: 'proiecte', trepte: [{ de_la: 2, puncte: 5 }],
    bonus: { puncte: 2, conditie: 'Certificat' } }
  const cuBarem = (b: unknown) => ({ ...complet, roluri: [{ ...complet.roluri[0], barem: b }] })
  assert.ok(triereValida(cuBarem(barem)))
  for (const k of Object.keys(barem)) {
    const b: any = structuredClone(barem); delete b[k]
    assert.equal(triereValida(cuBarem(b)), false, k)
  }
  assert.equal(triereValida(cuBarem({ ...barem, trepte: [{ de_la: 2 }] })), false)
  assert.equal(triereValida(cuBarem({ ...barem, bonus: { puncte: 2 } })), false)
  for (const k of ['tip_lucrare_gaze', 'experienta_similara'] as const) {
    for (const field of Object.keys(complet[k])) {
      const j: any = structuredClone(complet); delete j[k][field]
      assert.equal(triereValida(j), false, k + '.' + field)
    }
  }
  for (const k of ['roluri', 'matrice_experti', 'atestari_firma', 'alte_cerinte', 'clarificari_propuse']) {
    assert.equal(triereValida({ ...complet, [k]: [null] }), false, k)
  }
})

// Execută gardurile reale din handler, fără importul serverului / SDK-ului și fără rețea.
Deno.test('triere: HTTP, max_tokens, refusal, text gol și JSON parțial se opresc înainte de prima scriere', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  const bloc = src.slice(src.indexOf('    if (!resp.ok)'), src.indexOf("    const verdict = ['mergem'"))
    .replace(/: any/g, '')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const ruleaza = new AsyncFunction('resp', 'data', 'fail', 'supabase', 'mesajRefuz', 'textRaspuns', 'triereValida',
    'PRICE_IN', 'PRICE_OUT', 'MODEL', 'lid', bloc + '\nreturn { valid: true }')
  const raspuns = (j: unknown, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'thinking', thinking: '...' },
    { type: 'text', text: JSON.stringify(j) }] })
  for (const [ok, data] of [[false, raspuns(complet)], [true, raspuns(complet, 'max_tokens')],
    [true, raspuns(complet, 'refusal')], [true, { content: [{ type: 'thinking' }] }],
    [true, { content: [{ type: 'text', text: '  ' }] }], [true, raspuns({ verdict: 'mergem' })],
    [true, raspuns({})]] as const) {
    let scrieri = 0
    const r = await ruleaza({ ok }, data, (error: string) => ({ error }), { from() { scrieri++; throw Error('scriere') } },
      mesajRefuz, textRaspuns, triereValida, 2e-6, 10e-6, 'model-test', 1)
    assert.ok(r.error); assert.equal(scrieri, 0)
  }
  let scrieri = 0
  const r = await ruleaza({ ok: true }, raspuns(complet), (error: string) => ({ error }),
    { from() { return { insert() { scrieri++ } } } }, mesajRefuz, textRaspuns, triereValida, 2e-6, 10e-6, 'model-test', 1)
  assert.equal(r.valid, true); assert.equal(scrieri, 1)
})

Deno.test('triere: număr în loc de text și null pe detaliile rolului acceptate (fals-negative, review)', () => {
  assert.ok(triereValida({ ...complet, zile_clarificari: 10, valoare_estimata: 1250000 }))
  assert.ok(triereValida({ ...complet, roluri: [{ ...complet.roluri[0], natura_ceruta: null, cerinte: null, documente: null, motiv: null }] }))
  assert.equal(triereValida({ ...complet, roluri: [{ ...complet.roluri[0], rol: null }] }), false)
  assert.equal(triereValida({ ...complet, roluri: [{ ...complet.roluri[0], rol: ' ' }] }), false)
})
