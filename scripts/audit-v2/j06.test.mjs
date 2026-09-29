import { it } from './test-api.mjs'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { retete } from './retete.js'
import { contracte } from './contracte.js'
import { selecteazaFaze } from './costuri.js'
import { verificaRefuzServer } from './refuz.js'
import { caleSandbox } from './siguranta.js'
import { asertiune, verdictAsertiuni } from './asertiuni.js'
import { ruleaza } from './scenariu.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'))
const generat = retete(fixture)
it('J06: prefix din fixture, fără extensie către alte licitații sau pt/103', () => {
  assert.equal(caleSandbox('103/atribuire/a.pdf', fixture), '103/atribuire/a.pdf')
  for (const path of ['5/a', '104/a', 'pt/103/a', '103/%2f/a', '103/../a', '103/a\u0000']) assert.throws(() => caleSandbox(path, fixture))
  for (const id of [5, 104, '103', null]) assert.throws(() => caleSandbox('103/a', { licitatie_id: id }))
})
it('J06: fiecare fază are cost explicit, fazele AI sunt excluse inclusiv la --faza', () => {
  for (const [pas, c] of Object.entries(contracte)) {
    const cfg = generat.scenarii[pas]
    for (const n of c.faze) {
      assert.equal(typeof fixture.scenarii[pas].faze[n].cost_ai, 'boolean')
      assert.equal(cfg.faze[n].cost_ai, fixture.scenarii[pas].faze[n].cost_ai)
      if (cfg.faze[n].cost_ai) assert.deepEqual(selecteazaFaze(c, cfg, ['--faza', n]).selectate, [])
    }
    assert.ok(selecteazaFaze(c, cfg, []).selectate.every(n => cfg.faze[n].cost_ai === false))
  }
  assert.throws(() => selecteazaFaze(contracte['10_pachet'], generat.scenarii['10_pachet'], ['--faza', 'typo']))
})
it('J06: fixture are numai patru faze executabile; restul au motiv, fără selectori inventați', () => {
  const gata = []
  for (const [pas, c] of Object.entries(generat.scenarii)) for (const [n, p] of Object.entries(c.faze)) {
    if (p.actiuni.length) gata.push(`${pas}/${n}`)
    else assert.ok(p.motiv_indisponibil)
  }
  assert.deepEqual(gata, ['10_pachet/pachet_incomplet', '10_pachet/aprobare', '10_pachet/semnare_poarta', '11_depunere/status_depusa'])
  assert.equal(fixture.ground_truth_json, null)
})
it('J06: zero pachete înainte/după este verificabil; mutația unui rând vechi nu se ascunde', () => {
  const a = { tip: 'unchanged_set', tabela: 'p', la_esec: 'BYPASS' }
  const snap = rows => ({ tabele: { p: rows } })
  assert.equal(asertiune(a, snap([]), snap([])).trece, true)
  assert.equal(verdictAsertiuni([a], snap([]), snap([{ id: 1, stare: 'aprobat' }])).verdict, 'BYPASS')
  assert.equal(asertiune(a, snap([{ id: 1, v: 1 }, { id: 2 }]), snap([{ id: 1, v: 2 }, { id: 2 }])).trece, false)
  assert.equal(asertiune(a, snap([{ id: 1 }, { id: 2 }]), snap([{ id: 2 }, { id: 1 }])).trece, true)
  assert.throws(() => asertiune(a, snap([]), { tabele: {} }))
  assert.equal(asertiune({ ...a, tip: 'changed_set' }, snap([{ id: 1 }]), snap([{ id: 1 }])).trece, false)
})
it('J06: disabled nu este refuz server; J05 rămâne neschimbat la refuz', () => {
  for (const name of ['pachet_incomplet', 'aprobare', 'semnare_poarta']) {
    const p = generat.scenarii['10_pachet'].faze[name]
    assert.equal(p.verdict_succes, 'UI_ONLY')
    assert.ok(p.actiuni.every(a => a.tip === 'observa'))
    assert.ok(p.postconditii.some(a => a.tabela === 'ofertare_derogari_audit' && a.tip === 'unchanged_set'))
  }
})
it('J06: răspunsul vechi/altă licitație, 200, 403 și GET nu probează refuzul business', () => {
  const p = generat.scenarii['11_depunere'].faze.status_depusa
  const r = { metoda: 'PATCH', url: 'https://test.supabase.co/rest/v1/ofertare_licitatii?id=eq.103', status: 400, durata_ms: 10 }
  assert.equal(verificaRefuzServer(p.refuz_server, [r]), true)
  for (const bad of [{ ...r, status: 200 }, { ...r, status: 403 }, { ...r, metoda: 'GET' }, { ...r, durata_ms: null }, { ...r, url: r.url.replace('103', '5') }]) assert.equal(verificaRefuzServer(p.refuz_server, [bad]), false)
  assert.equal(verificaRefuzServer(p.refuz_server, []), false)
})
it('J06: refuzul cere stări și porți, nu existența unui rând', () => {
  const p = generat.scenarii['11_depunere'].faze.status_depusa
  assert.ok(p.postconditii.some(a => a.tip === 'unchanged_set' && a.tabela === 'ofertare_licitatii'))
  assert.ok(p.postconditii.some(a => a.asteptat?.lista_f3_nevalidate === 62))
  assert.ok(p.postconditii.some(a => a.tip === 'nonempty' && a.camp === 'blocaj'))
  assert.ok(p.preconditii.some(a => a.asteptat?.derogare_depunere === false))
})
it('J06: preview nu conectează BD/browser; AI apply implicit refuzat înainte de acces', async () => {
  let acces = 0
  const deps = { db: { from() { acces++; throw Error('Interzis') } }, conecteaza() { acces++; throw Error('Interzis') } }
  const exit = process.exitCode
  const dir = await mkdtemp(join(fileURLToPath(new URL('./', import.meta.url)), 'j06-test-'))
  try {
    const preview = await ruleaza('02_citire', ['--faza', 'citire_integrala'], deps)
    assert.equal(preview.preview, true)
    const r = await ruleaza('02_citire', ['--apply', '--faza', 'citire_integrala'], { ...deps, dir })
    assert.equal(r.verdict, 'UNDETERMINED'); assert.equal(acces, 0)
  } finally { process.exitCode = exit; await rm(dir, { recursive: true, force: true }) }
})
it('J06: selectorii activi sunt exact cei din sursele UI', async () => {
  const pt = await readFile(new URL('../../src/OfertarePropunere.jsx', import.meta.url), 'utf8')
  for (const n of ['pachet_incomplet', 'aprobare', 'semnare_poarta']) assert.ok(pt.includes(fixture.retete[`10_pachet/${n}`].selector.slice(5)))
  const ui = await readFile(new URL('../../src/OfertareLicitatii.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('📝 Detalii & decizie')); assert.ok(ui.includes("label:'Depusă'"))
  assert.ok(ui.includes('onClick={() => onStatus(l, s2)}'))
})

for (const mod of ['refuz', 'bypass', 'fara_cerere', 'audit_modificat', 'RLS', 'r5_schimbat', 'ui_only', 'ui_bypass']) it(`J06 runner: ${mod}`, async () => {
  const lic = { id: 103, nr_anunt: fixture.nr_anunt, status: 'in_lucru', derogare_depunere: false }
  const tabele = {
    ofertare_licitatii: [lic], ofertare_cerinte: [6607, 6656, 6552].map(id => ({ id, licitatie_id: 103 })),
    v_ofertare_cantitati_nevalidate: [{ licitatie_id: 103, lista_f3_nevalidate: mod === 'r5_schimbat' ? 61 : 62 }],
    v_ofertare_seap_completitudine: [{ licitatie_id: 103, blocaj: 'document incomplet' }], ofertare_derogari_audit: [],
  }
  const db = { from(table) {
    let rows = tabele[table] || []
    const result = data => ({ data: structuredClone(data), error: mod === 'RLS' && table === 'ofertare_derogari_audit' ? { code: '42501' } : null })
    const q = { select: () => q, order: column => {
      if (table.startsWith('v_')) assert.equal(column, 'licitatie_id')
      return q
    }, limit: () => q, eq: (k, v) => { rows = rows.filter(r => r[k] === v); return q },
    in: (k, v) => { rows = rows.filter(r => v.includes(r[k])); return q },
    not: k => { rows = rows.filter(r => r[k] != null); return q },
    maybeSingle: async () => result(rows[0] || null), range: async (a, b) => result(rows.slice(a, b + 1)) }
    return q
  } }
  const logs = []; let clicks = 0
  const driver = { evalueaza: async () => fixture.app_url, asteapta: async () => {}, captura: async () => {},
    observa: async () => ({ value: '103', disabled: mod !== 'ui_bypass' }),
    jurnal: () => logs, inchide() {}, async click(selector) {
      if (selector !== 'text=📮 Marchează Depusă') return
      clicks++
      if (mod === 'bypass') lic.status = 'depusa'
      if (mod === 'audit_modificat') tabele.ofertare_derogari_audit.push({ id: 1, licitatie_id: 103, actiune: 'depusa_pe_derogare' })
      if (mod !== 'fara_cerere') logs.push({ metoda: 'PATCH', url: 'https://mock.supabase.co/rest/v1/ofertare_licitatii?id=eq.103', status: mod === 'bypass' ? 200 : 400, durata_ms: 1 })
    } }
  const exit = process.exitCode
  const dir = await mkdtemp(join(fileURLToPath(new URL('./', import.meta.url)), 'j06-test-'))
  try {
    const ui = mod.startsWith('ui_')
    const r = await ruleaza(ui ? '10_pachet' : '11_depunere', ['--apply', '--faza', ui ? 'aprobare' : 'status_depusa'], { dir, db, conecteaza: async () => driver })
    assert.equal(r.verdict, mod === 'ui_only' ? 'UI_ONLY' : mod === 'refuz' ? 'MATCH' : ['bypass', 'audit_modificat', 'ui_bypass'].includes(mod) ? 'BYPASS' : 'UNDETERMINED')
    if (ui || ['RLS', 'r5_schimbat'].includes(mod)) assert.equal(clicks, 0)
    else assert.equal(clicks, 1)
    if (mod === 'refuz') assert.ok(r.faze[0].limita.includes('nu izolează'))
  } finally { process.exitCode = exit; await rm(dir, { recursive: true, force: true }) }
})
