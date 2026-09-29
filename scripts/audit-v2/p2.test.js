import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

// Emulează renderer-ul blocat: mouseReleased NU răspunde până la handleJavaScriptDialog.
function browserMock(dialogs = []) {
  const listeners = {}; const calls = []; let release
  const emit = m => listeners.message({ data: JSON.stringify(m) })
  const reply = (m, result = {}) => emit({ id: m.id, result })
  const socket = {
    addEventListener: (name, handler) => { listeners[name] = handler },
    close: vi.fn(),
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
    expect(m.calls.filter(c => c.method === 'Page.handleJavaScriptDialog').map(c => c.params))
      .toEqual([{ accept: accept !== false }])
    expect(m.driver.pending.size).toBe(0)
  })
  it.each([false, true])('prompt din rețetă/env=%s, fără răspuns sensibil în jurnal', async env => {
    vi.stubEnv('AUDIT_TEST_PROMPT', 'pagina 17')
    const m = browserMock([{ type: 'prompt', message: 'Locator?' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=Verifică' },
      { tip: 'confirma', ...(env ? { prompt_env: 'AUDIT_TEST_PROMPT' } : { text: 'pagina 17' }) }])
    expect(m.calls.find(c => c.method === 'Page.handleJavaScriptDialog').params).toEqual({ accept: true, promptText: 'pagina 17' })
    expect(JSON.stringify(m.driver.dialoguri())).not.toContain('pagina 17')
  })
  it('prompt lipsă în env refuzat înainte de click', async () => {
    vi.stubEnv('AUDIT_TEST_PROMPT', undefined)
    const m = browserMock()
    await expect(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma', prompt_env: 'AUDIT_TEST_PROMPT' }])).rejects.toThrow('lipsește')
    expect(m.calls).toHaveLength(0)
  })
  it('două dialoguri declarate după același click primesc răspunsurile în ordine', async () => {
    const m = browserMock([{ type: 'confirm', message: 'Continui?' }, { type: 'prompt', message: 'Locator?' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }, { tip: 'confirma', text: 'pagina 2' }])
    expect(m.calls.filter(c => c.method === 'Page.handleJavaScriptDialog').map(c => c.params))
      .toEqual([{ accept: true }, { accept: true, promptText: 'pagina 2' }])
    expect(m.driver.dialoguri().every(d => d.asteptat && d.raspuns === 'trimis')).toBe(true)
  })
  it('absența dialogului declarat are diagnostic propriu', async () => {
    vi.useFakeTimers()
    const m = browserMock()
    const pending = expect(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }]))
      .rejects.toThrow('Dialogul din rețetă nu a apărut')
    await vi.advanceTimersByTimeAsync(15000)
    await pending
    expect(m.driver.pending.size).toBe(0)
  })
  it.each(['alert', 'confirm', 'prompt'])('dialog neașteptat %s: închidere și text în dovezi, fără timeout', async type => {
    const m = browserMock([{ type, message: 'Mesaj neașteptat' }])
    await expect(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }])).rejects.toThrow('Mesaj neașteptat')
    expect(m.driver.dialoguri()[0]).toMatchObject({ type, message: 'Mesaj neașteptat', asteptat: false, accept: false })
    expect(m.driver.pending.size).toBe(0)
  })
  it('tip diferit față de rețetă și al doilea dialog sunt neașteptate', async () => {
    for (const dialogs of [[{ type: 'prompt', message: 'Alt tip' }],
      [{ type: 'confirm', message: 'Primul' }, { type: 'confirm', message: 'Al doilea' }]]) {
      const m = browserMock(dialogs)
      await expect(actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }])).rejects.toThrow('Dialog neașteptat')
    }
  })
  it('fiecare click are propria așteptare; confirmarea nu se reutilizează', async () => {
    const m = browserMock([{ type: 'confirm', message: 'Primul' }])
    await actiuniUI(m.driver, [{ tip: 'click', selector: 'text=X' }, { tip: 'confirma' }, { tip: 'click', selector: 'text=Y' }])
    m.emit({ method: 'Page.javascriptDialogOpening', params: { type: 'alert', message: 'Tardiv' } })
    await expect(m.driver.asteapta('text=Z')).rejects.toThrow('Tardiv')
  })
})

describe('clona 103 și țintele CDP', () => {
  it.each(['103/atribuire/a.pdf', '103/depus/final.pdf'])('acceptă %s', path => expect(caleSandbox(path)).toBe(path))
  it.each(['103/', '103//a', '103/../5/a', '103/./a', '103/%2e%2e/a', '103/..\\a', '103/a?x=1',
    '103/a#x', '103/a\n', '104/a', '5/a', 'sandbox-v2/5/a'])('refuză %j', path => expect(() => caleSandbox(path)).toThrow())
  it('perechea reală este 5/... către 103/... cu aceeași cale relativă', () => {
    expect(() => verificaPerechi([{ cale_veche: '5/atribuire/a', cale_noua: '103/atribuire/a' }])).not.toThrow()
    expect(() => verificaPerechi([{ cale_veche: '5/atribuire/a', cale_noua: '103/atribuire/b' }])).toThrow()
  })
  it.each([5, 104])('nici măcar alt sandbox %s nu autorizează scrieri', id => {
    expect(() => verificaSandbox({ id, nr_anunt: 'SANDBOX-V2-X' }, { licitatie_id: id })).toThrow('REFUZ')
  })
  const tabs = [
    { id: 'other', type: 'page', url: 'https://example.com' },
    { id: 'spoof', type: 'page', url: 'https://pontaj-pro-sooty.vercel.app.evil.test' },
    { id: 'worker', type: 'service_worker', url: 'https://pontaj-pro-sooty.vercel.app' },
    { id: 'app-1', type: 'page', url: 'https://pontaj-pro-sooty.vercel.app/ofertare' },
    { id: 'app-2', type: 'page', url: 'https://pontaj-pro-sooty.vercel.app/' },
  ]
  it('alege primul tab după origine și al doilea excluzând primul', () => {
    expect(selecteazaTab(tabs).id).toBe('app-1')
    expect(selecteazaTab(tabs, null, { excludeTarget: 'app-1' }).id).toBe('app-2')
    expect(selecteazaTab(tabs, 'app-2').id).toBe('app-2')
    expect(() => selecteazaTab(tabs, 'app-1', { excludeTarget: 'app-1' })).toThrow()
    expect(() => selecteazaTab(tabs.slice(0, 3))).toThrow()
    expect(() => selecteazaTab([tabs[3]], null, { excludeTarget: 'app-1' })).toThrow()
  })
})

const fixture = { licitatie_id: 103, nr_anunt: 'SANDBOX-V2-DOMNESTI', cdp_port: 9333,
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
    const result = await ruleaza(pas, ['--apply', '--fixture', path], { dir, db, conecteaza: connect })
    return { result,
      verdict: JSON.parse(await readFile(join(dir, 'verdict.json'), 'utf8')),
      dialogs: await readFile(join(dir, 'dialoguri-1.json'), 'utf8').catch(() => '[]') }
  } finally { process.exitCode = exit; await rm(dir, { recursive: true, force: true }) }
}
function driverMock(target = 'app-1') {
  return { target, evalueaza: async () => fixture.app_url, asteapta: vi.fn(), observa: async () => ({ value: '103' }),
    captura: async () => {}, jurnal: () => [], inchide: () => {} }
}

describe('RLS auxiliar: verigă nedeterminată, verificări independente continuate', () => {
  it.each(Object.entries(VERIGI_AUXILIARE))('%s afectează numai verigile %j', async (table, affected) => {
    const snap = await snapshot(databaseMock({ [table]: '42501' }), fixture, { tabele: [table] })
    expect(snap.lant.rezultate).toHaveLength(3) // _nota nu devine ID trimis la PostgREST.
    expect(eroriBlocante(snap)).toEqual([])
    expect(snap.tabele[table]).toBeUndefined()
    for (const r of snap.lant.rezultate) for (const [v, link] of Object.entries(r.verigi)) {
      expect(!!link.eroriAuxiliare).toBe(affected.includes(Number(v)))
      if (affected.includes(Number(v))) expect(link.stare).toBe('nedeterminat')
    }
    const a = { tip: 'count', tabela: table, valoare: 0 }
    expect(verdictAsertiuni([a, exists], snap, snap)).toMatchObject({ verdict: 'UNDETERMINED', doarAuxiliare: true })
    expect(verdictAsertiuni([exists], snap, snap).verdict).toBe('MATCH')
    expect(verdictAsertiuni([a, { ...exists, asteptat: { versiune: 2 }, la_esec: 'BYPASS' }], snap, snap).verdict).toBe('BYPASS')
    expect(verdictAsertiuni([{ tip: 'chain', cerinta_id: 6607, veriga: affected[0], stare: 'ok' }], snap, snap).verdict).toBe('UNDETERMINED')
  })
  it('RLS într-o postcondiție nu oprește faza următoare', async () => {
    const d = driverMock()
    const r = await runMock('02_citire', { faze: {
      citire_integrala: phase([{ tip: 'count', tabela: 'ofertare_ingest_coada', valoare: 0 }, exists]),
      recitire_idempotenta: phase([exists]),
    } }, databaseMock({ ofertare_ingest_coada: '42501' }), async () => d)
    expect(r.result.eroare).toBeUndefined()
    expect(r.verdict.faze.map(p => p.verdict)).toEqual(['UNDETERMINED', 'MATCH'])
    expect(r.verdict.verdict).toBe('UNDETERMINED')
  })
  it('precondiție auxiliară necitită nu oprește verificările independente', async () => {
    const r = await runMock('02_citire', { preconditii: [{ tip: 'count', tabela: 'ofertare_ingest_coada', valoare: 0 }],
      faze: { citire_integrala: phase([exists]), recitire_idempotenta: phase([exists]) } },
    databaseMock({ ofertare_ingest_coada: '42501' }), async () => driverMock())
    expect(r.verdict.faze).toHaveLength(2)
    expect(r.verdict.verdict).toBe('UNDETERMINED')
  })
  it.each([false, true])('RLS nu ascunde un BYPASS observat în UI, în aceeași fază sau ulterior (%s)', async ulterior => {
    const aux = { tip: 'count', tabela: 'ofertare_ingest_coada', valoare: 0 }
    const failedUI = { actiuni: [{ tip: 'observa', selector: 'text=Aprobă', asteptat: { disabled: true }, la_esec: 'BYPASS' }],
      postconditii: [aux, exists] }
    const r = await runMock('02_citire', { faze: ulterior
      ? { citire_integrala: phase([aux]), recitire_idempotenta: failedUI }
      : { citire_integrala: failedUI, recitire_idempotenta: phase([exists]) } },
    databaseMock({ ofertare_ingest_coada: '42501' }), async () => ({ ...driverMock(), observa: async () => ({ disabled: false }) }))
    expect(r.verdict.verdict).toBe('BYPASS')
    expect(r.verdict.faze).toHaveLength(ulterior ? 2 : 1)
  })
  it.each([['ofertare_ingest_coada', 'PGRST200'], ['ofertare_ingest_coada', 'PGRST301'], ['ofertare_cerinte', '42501']])
  ('eroarea %s/%s nu este ignorată', async (table, code) => {
    const connect = vi.fn()
    const r = await runMock('02_citire', { faze: {} }, databaseMock({ [table]: code }), connect)
    expect(connect).not.toHaveBeenCalled()
    expect(r.verdict.verdict).toBe('UNDETERMINED')
  })
  it('runner păstrează textul dialogului neașteptat și verdictul UNDETERMINED', async () => {
    const m = browserMock([{ type: 'confirm', message: 'Dialog de probă' }])
    const d = Object.assign(driverMock(), { click: m.driver.click.bind(m.driver), dialoguri: () => m.driver.dialoguri() })
    const r = await runMock('02_citire', { faze: { citire_integrala: {
      actiuni: [{ tip: 'click', selector: 'text=X' }], postconditii: [exists],
    } } }, databaseMock(), async () => d)
    expect(r.verdict).toMatchObject({ verdict: 'UNDETERMINED', eroare: 'Dialog neașteptat (confirm): Dialog de probă' })
    expect(JSON.parse(r.dialogs)[0]).toMatchObject({ message: 'Dialog de probă', asteptat: false })
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
    expect(generated.scenarii[pas].obiect).toEqual({ tabela, id })
    const connect = vi.fn(async (_port, _id, options) => driverMock(options.excludeTarget ? 'app-2' : 'app-1'))
    const r = await runMock(pas, cfg, databaseMock({}, {
      ofertare_pt_capitole: [{ id: 58, licitatie_id: 103 }], ofertare_acoperire: [{ id: 77, cerinta_id: 6656 }],
    }), connect)
    expect(r.verdict.verdict).toBe('MATCH')
    expect(connect.mock.calls.map(c => c[2])).toEqual([
      { appUrl: fixture.app_url }, { appUrl: fixture.app_url, excludeTarget: 'app-1' },
    ])
  })
})
