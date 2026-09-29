import { describe, it, afterEach, mock, stubEnv, restoreEnv } from './test-api.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { CDP, selecteazaTab } from './cdp.mjs'
import { actiuniUI, ruleaza, snapshot } from './scenariu.mjs'
import { caleSandbox, verificaSandbox } from './siguranta.js'
import { verificaPerechi } from './sandbox_storage_copy.mjs'
import { verdictAsertiuni } from './asertiuni.js'
import { VERIGI_AUXILIARE, eroriBlocante } from './rls.js'
import { contracte } from './contracte.js'
import { retete } from './retete.js'
import { ACTOR_TEST, completeazaDBSimulat, completeazaDriverSimulat, monitorSimulat } from './simulare-j06b.mjs'

afterEach(() => { restoreEnv(); mock.timers.reset() })

// Emulează renderer-ul blocat: mouseReleased NU răspunde până la handleJavaScriptDialog.
function browserMock(dialogs = []) {
  const listeners = {}; const calls = []; let release
  const emit = m => listeners.message({ data: JSON.stringify(m) })
  const reply = (m, result = {}) => emit({ id: m.id, result })
  const socket = {
    addEventListener: (name, handler) => { listeners[name] = handler },
    close: mock.fn(),
    send(raw) {
      const m = JSON.parse(raw); calls.push(m)
      if (m.method === 'Input.dispatchMouseEvent' && m.params.type === 'mouseReleased' && dialogs.length) {
        release = m
        emit({ method: 'Page.javascriptDialogOpening', params: dialogs.shift() })
      } else if (m.method === 'Page.handleJavaScriptDialog') {
        emit({ method: 'Page.javascriptDialogClosed', params: {} }); reply(m)
        if (dialogs.length) emit({ method: 'Page.javascriptDialogOpening', params: dialogs.shift() })
        else if (release) { const old = release; release = null; reply(old) }
      } else reply(m, m.method === 'Runtime.evaluate' ? { result: { value: { x: 1, y: 2 } } } : {})
    },
  }
  return { driver: new CDP(socket, 'app-1'), calls, emit }
}

describe('dialoguri CDP înainte de click', () => {
  it.each([undefined, false])('confirm implicit true și anulare explicită %s', async accept => {
    const m = browserMock([{ type: 'confirm', message: 'Aprobi?' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=Aprobă' }, { tip: 'confirma', accept }])
    assert.deepStrictEqual(m.calls.filter(c => c.method === 'Page.handleJavaScriptDialog').map(c => c.params), [{ accept: accept !== false }])
    assert.strictEqual(m.driver.pending.size, 0)
  })
  it.each([false, true])('prompt din rețetă/env=%s, fără răspuns sensibil în jurnal', async env => {
    stubEnv('AUDIT_TEST_PROMPT', 'pagina 17')
    const m = browserMock([{ type: 'prompt', message: 'Locator?' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=Verifică' },
      { tip: 'confirma', ...(env ? { prompt_env: 'AUDIT_TEST_PROMPT' } : { text: 'pagina 17' }) }])
    assert.deepStrictEqual(m.calls.find(c => c.method === 'Page.handleJavaScriptDialog').params, { accept: true, promptText: 'pagina 17' })
    assert.ok(!(JSON.stringify(m.driver.dialoguri())).includes('pagina 17'))
  })
  it('prompt lipsă în env refuzat înainte de click', async () => {
    stubEnv('AUDIT_TEST_PROMPT', undefined)
    const m = browserMock()
    await assert.rejects(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma', prompt_env: 'AUDIT_TEST_PROMPT' }]), e => e.message.includes('lipsește'))
    assert.strictEqual((m.calls).length, 0)
  })
  it('două dialoguri declarate după același click primesc răspunsurile în ordine', async () => {
    const m = browserMock([{ type: 'confirm', message: 'Continui?' }, { type: 'prompt', message: 'Locator?' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }, { tip: 'confirma', text: 'pagina 2' }])
    assert.deepStrictEqual(m.calls.filter(c => c.method === 'Page.handleJavaScriptDialog').map(c => c.params), [{ accept: true }, { accept: true, promptText: 'pagina 2' }])
    assert.strictEqual(m.driver.dialoguri().every(d => d.asteptat && d.raspuns === 'trimis'), true)
  })
  it('absența dialogului declarat are diagnostic propriu', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const m = browserMock()
    const pending = assert.rejects(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }]), e => e.message.includes('Dialogul din rețetă nu a apărut'))
    await new Promise(setImmediate)
    mock.timers.tick(15000)
    await pending
    assert.strictEqual(m.driver.pending.size, 0)
  })
  it.each(['alert', 'confirm', 'prompt'])('dialog neașteptat %s: închidere și text în dovezi, fără timeout', async type => {
    const m = browserMock([{ type, message: 'Mesaj neașteptat' }])
    await assert.rejects(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }]), e => e.message.includes('Mesaj neașteptat'))
    assert.partialDeepStrictEqual(m.driver.dialoguri()[0], { type, message: 'Mesaj neașteptat', asteptat: false, accept: false })
    assert.strictEqual(m.driver.pending.size, 0)
  })
  it('tip diferit față de rețetă și al doilea dialog sunt neașteptate', async () => {
    for (const dialogs of [[{ type: 'prompt', message: 'Alt tip' }],
      [{ type: 'confirm', message: 'Primul' }, { type: 'confirm', message: 'Al doilea' }]]) {
      const m = browserMock(dialogs)
      await assert.rejects(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }]), e => e.message.includes('Dialog neașteptat'))
    }
  })
  it('fiecare click are propria așteptare; confirmarea nu se reutilizează', async () => {
    const m = browserMock([{ type: 'confirm', message: 'Primul' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }, { tip: 'click', selector: 'text=Y' }])
    m.emit({ method: 'Page.javascriptDialogOpening', params: { type: 'alert', message: 'Tardiv' } })
    await assert.rejects(m.driver.asteapta('text=Z'), e => e.message.includes('Tardiv'))
  })
})

describe('clona 103 și țintele CDP', () => {
  it.each(['103/atribuire/a.pdf', '103/depus/final.pdf'])('acceptă %s', path => assert.strictEqual(caleSandbox(path), path))
  it.each(['103/', '103//a', '103/../5/a', '103/./a', '103/%2e%2e/a', '103/..\\a', '103/a?x=1',
    '103/a#x', '103/a\n', '104/a', '5/a', 'sandbox-v2/5/a'])('refuză %j', path => assert.throws(() => caleSandbox(path)))
  it('perechea reală este 5/... către 103/... cu aceeași cale relativă', () => {
    assert.doesNotThrow(() => verificaPerechi([{ cale_veche: '5/atribuire/a', cale_noua: '103/atribuire/a' }]))
    assert.throws(() => verificaPerechi([{ cale_veche: '5/atribuire/a', cale_noua: '103/atribuire/b' }]))
  })
  it.each([5, 104])('nici măcar alt sandbox %s nu autorizează scrieri', id => {
    assert.throws(() => verificaSandbox({ id, nr_anunt: 'SANDBOX-V2-X' }, { licitatie_id: id }), e => e.message.includes('REFUZ'))
  })
  const tabs = [
    { id: 'other', type: 'page', url: 'https://example.com' },
    { id: 'spoof', type: 'page', url: 'https://pontaj-pro-sooty.vercel.app.evil.test' },
    { id: 'worker', type: 'service_worker', url: 'https://pontaj-pro-sooty.vercel.app' },
    { id: 'app-1', type: 'page', url: 'https://pontaj-pro-sooty.vercel.app/ofertare' },
    { id: 'app-2', type: 'page', url: 'https://pontaj-pro-sooty.vercel.app/' },
  ]
  it('alege primul tab după origine și al doilea excluzând primul', () => {
    assert.strictEqual(selecteazaTab(tabs).id, 'app-1')
    assert.strictEqual(selecteazaTab(tabs, null, { excludeTarget: 'app-1' }).id, 'app-2')
    assert.strictEqual(selecteazaTab(tabs, 'app-2').id, 'app-2')
    assert.throws(() => selecteazaTab(tabs, 'app-1', { excludeTarget: 'app-1' }))
    assert.throws(() => selecteazaTab(tabs.slice(0, 3)))
    assert.throws(() => selecteazaTab([tabs[3]], null, { excludeTarget: 'app-1' }))
  })
})

const fixture = { actor_id: ACTOR_TEST, licitatie_id: 103, nr_anunt: 'SANDBOX-V2-DOMNESTI', cdp_port: 9333,
  cdp_target_id: null, cdp_target_id_2: null, app_url: 'https://pontaj-pro-sooty.vercel.app',
  cerinte: { D1: 6607, D6: 6656, D8: 6552, _nota: { D1: 'Doar documentație' } } }
function databaseMock(errors = {}, overrides = {}) {
  const tables = { ofertare_licitatii: [{ id: 103, nr_anunt: fixture.nr_anunt }],
    ofertare_cerinte: [6607, 6656, 6552].map(id => ({ id, licitatie_id: 103, versiune: 1 })), ...overrides }
  return { from(table) {
    let rows = tables[table] || []
    const result = data => ({ data, error: errors[table] ? { code: errors[table], message: 'Refuz mock' } : null })
    const q = { select: () => q, order: () => q, limit: () => q,
      eq: (key, value) => { if (typeof value === 'object') throw Error('ID invalid'); rows = rows.filter(r => r[key] === value); return q },
      in: (key, values) => { rows = rows.filter(r => values.includes(r[key])); return q },
      not: key => { rows = rows.filter(r => r[key] != null); return q },
      maybeSingle: async () => result(rows[0] || null), range: async (a, b) => result(rows.slice(a, b + 1)) }
    return q
  } }
}
const exists = { tip: 'exists', tabela: 'ofertare_cerinte', where: { id: 6607 }, asteptat: { versiune: 1 } }
const phase = postconditii => ({ actiuni: [{ tip: 'asteapta', selector: 'text=Gata' }], postconditii })
async function runMock(pas, config, db, connect) {
  const dir = await mkdtemp(join(fileURLToPath(new URL('./', import.meta.url)), 'p2-tmp-'))
  const exit = process.exitCode
  try {
    const path = join(dir, 'fixture.json')
    await writeFile(path, JSON.stringify({ ...fixture, scenarii: { [pas]: config } }))
    const result = await ruleaza(pas, ['--apply', '--allow-ai', '--fixture', path], {
      dir, serieDir: join(dir, 'serie'), db: completeazaDBSimulat(db), supraveghere: monitorSimulat(),
      conecteaza: async (...a) => completeazaDriverSimulat(await connect(...a)) })
    return { result,
      verdict: JSON.parse(await readFile(join(dir, 'verdict.json'), 'utf8')),
      dialogs: await readFile(join(dir, 'dialoguri-1.json'), 'utf8').catch(() => '[]') }
  } finally { process.exitCode = exit; await rm(dir, { recursive: true, force: true }) }
}
function driverMock(target = 'app-1') {
  return { target, evalueaza: async () => fixture.app_url, asteapta: mock.fn(), observa: async () => ({ value: '103' }),
    captura: async () => {}, jurnal: () => [], inchide: () => {} }
}

describe('RLS auxiliar: verigă nedeterminată, verificări independente continuate', () => {
  it.each(Object.entries(VERIGI_AUXILIARE))('%s afectează numai verigile %j', async (table, affected) => {
    const snap = await snapshot(databaseMock({ [table]: '42501' }), fixture, { tabele: [table] })
    assert.strictEqual((snap.lant.rezultate).length, 3) // _nota nu devine ID trimis la PostgREST.
    assert.deepStrictEqual(eroriBlocante(snap), [])
    assert.strictEqual(snap.tabele[table], undefined)
    for (const r of snap.lant.rezultate) for (const [v, link] of Object.entries(r.verigi)) {
      assert.strictEqual(!!link.eroriAuxiliare, affected.includes(Number(v)))
      if (affected.includes(Number(v))) assert.strictEqual(link.stare, 'nedeterminat')
    }
    const a = { tip: 'count', tabela: table, valoare: 0 }
    assert.partialDeepStrictEqual(verdictAsertiuni([a, exists], snap, snap), { verdict: 'UNDETERMINED', doarAuxiliare: true })
    assert.strictEqual(verdictAsertiuni([exists], snap, snap).verdict, 'MATCH')
    assert.strictEqual(verdictAsertiuni([a, { ...exists, asteptat: { versiune: 2 }, la_esec: 'BYPASS' }], snap, snap).verdict, 'BYPASS')
    assert.strictEqual(verdictAsertiuni([{ tip: 'chain', cerinta_id: 6607, veriga: affected[0], stare: 'ok' }], snap, snap).verdict, 'UNDETERMINED')
  })
  it('RLS într-o postcondiție nu oprește faza următoare', async () => {
    const d = driverMock()
    const r = await runMock('02_citire', { faze: {
      citire_integrala: phase([{ tip: 'count', tabela: 'ofertare_ingest_coada', valoare: 0 }, exists]),
      recitire_idempotenta: phase([exists]),
    } }, databaseMock({ ofertare_ingest_coada: '42501' }), async () => d)
    assert.strictEqual(r.result.eroare, undefined)
    assert.deepStrictEqual(r.verdict.faze.map(p => p.verdict), ['UNDETERMINED', 'MATCH'])
    assert.strictEqual(r.verdict.verdict, 'UNDETERMINED')
  })
  it('precondiție auxiliară necitită nu oprește verificările independente', async () => {
    const r = await runMock('02_citire', { preconditii: [{ tip: 'count', tabela: 'ofertare_ingest_coada', valoare: 0 }],
      faze: { citire_integrala: phase([exists]), recitire_idempotenta: phase([exists]) } },
    databaseMock({ ofertare_ingest_coada: '42501' }), async () => driverMock())
    assert.strictEqual((r.verdict.faze).length, 2)
    assert.strictEqual(r.verdict.verdict, 'UNDETERMINED')
  })
  it.each([false, true])('RLS nu ascunde un BYPASS observat în UI, în aceeași fază sau ulterior (%s)', async ulterior => {
    const aux = { tip: 'count', tabela: 'ofertare_ingest_coada', valoare: 0 }
    const failedUI = { actiuni: [{ tip: 'observa', selector: 'text=Aprobă', asteptat: { disabled: true }, la_esec: 'BYPASS' }],
      postconditii: [aux, exists] }
    const r = await runMock('02_citire', { faze: ulterior
      ? { citire_integrala: phase([aux]), recitire_idempotenta: failedUI }
      : { citire_integrala: failedUI, recitire_idempotenta: phase([exists]) } },
    databaseMock({ ofertare_ingest_coada: '42501' }), async () => ({ ...driverMock(), observa: async () => ({ disabled: false }) }))
    assert.strictEqual(r.verdict.verdict, 'BYPASS')
    assert.strictEqual((r.verdict.faze).length, ulterior ? 2 : 1)
  })
  it.each([['ofertare_ingest_coada', 'PGRST200'], ['ofertare_ingest_coada', 'PGRST301'], ['ofertare_cerinte', '42501']])
  ('eroarea %s/%s nu este ignorată', async (table, code) => {
    const connect = mock.fn()
    const r = await runMock('02_citire', { faze: {} }, databaseMock({ [table]: code }), connect)
    assert.strictEqual((connect).mock.callCount(), 0)
    assert.strictEqual(r.verdict.verdict, 'UNDETERMINED')
  })
  it('runner păstrează textul dialogului neașteptat și verdictul UNDETERMINED', async () => {
    const m = browserMock([{ type: 'confirm', message: 'Dialog de probă' }])
    const d = Object.assign(driverMock(), { click: m.driver.click.bind(m.driver), dialoguri: () => m.driver.dialoguri() })
    const r = await runMock('02_citire', { faze: { citire_integrala: {
      actiuni: [{ tip: 'click', selector: 'text=X' }], postconditii: [exists],
    } } }, databaseMock(), async () => d)
    assert.partialDeepStrictEqual(r.verdict, { verdict: 'UNDETERMINED', eroare: 'stare: 02_citire/citire_integrala: Dialog neașteptat (confirm): Dialog de probă' })
    assert.partialDeepStrictEqual(JSON.parse(r.dialogs)[0], { message: 'Dialog de probă', asteptat: false })
  })
})

describe('concurență 13–15', () => {
  it.each([
    ['13_concurenta_cerinta', 'ofertare_cerinte', 6656],
    ['14_concurenta_capitol', 'ofertare_pt_capitole', 58],
    ['15_concurenta_acoperire', 'ofertare_acoperire', 77],
  ])('%s păstrează obiectul explicit și deschide al doilea tab', async (pas, tabela, id) => {
    const name = contracte[pas].faze[0]
    const cfg = { obiect: { tabela, id }, faze: { [name]: { ...phase([exists]),
      pregatire: phase([]).actiuni, pregatire_2: phase([]).actiuni, actiuni_2: phase([]).actiuni } } }
    const generated = retete({ ...fixture, scenarii: { [pas]: cfg }, retete: { [`${pas}/${name}`]: { capitol_id: 999 } } })
    assert.deepStrictEqual(generated.scenarii[pas].obiect, { tabela, id })
    const connect = mock.fn(async (_port, _id, options) => driverMock(options.excludeTarget ? 'app-2' : 'app-1'))
    const r = await runMock(pas, cfg, databaseMock({}, {
      ofertare_pt_capitole: [{ id: 58, licitatie_id: 103 }], ofertare_acoperire: [{ id: 77, cerinta_id: 6656 }],
    }), connect)
    assert.strictEqual(r.verdict.verdict, 'MATCH')
    assert.deepStrictEqual(connect.mock.calls.map(c => c.arguments[2]), [
      { appUrl: fixture.app_url }, { appUrl: fixture.app_url, excludeTarget: 'app-1' },
    ])
  })
})
