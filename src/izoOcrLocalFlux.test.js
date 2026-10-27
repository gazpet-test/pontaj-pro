import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { citesteLocal, costEticheta, descrieSursaOCR, esteNoapteOCR } from './izoOcrLocalFlux.js'

const propunere = { success:true, tip:'aviz_e3', sablon:'aviz_teava', antet:{}, randuri:[{ serie:'001' }], model:'ocr_local:lighton+mineru', cost_usd:0 }
const ok = raspuns => ({ data:raspuns, error:null })
const refuz = (status, eroare, extra = {}) => ({ data:null, error:{ context:{ status, json:async () => ({ success:false, eroare, ...extra }) } } })
const ceruta = () => ok({ success:true, cerere_id:'id', termen_local:new Date(Date.now() + 90000).toISOString() })
const gata = () => ok({ success:true, stare:'gata', rezultat:propunere })
const start = (invoke, extra = {}) => citesteLocal({ pdf_base64:'JVBERi0=', proiect_id:7, depozit_id:3, sablon:'aviz_teava', actual:() => true, invoke, ...extra })
const operatii = invoke => invoke.mock.calls.map(([, { body }]) => body.op)
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T09:00:00Z')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('E9 — flux local fără efecte asupra formularului', () => {
  it('gata rapid și backoff pentru gata întârziat; rezultat normalizat neschimbat', async () => {
    for (const intarziat of [false, true]) {
      const invoke = vi.fn().mockResolvedValueOnce(ceruta())
      if (intarziat) invoke.mockResolvedValueOnce(ok({ success:true, stare:'preluata' }))
      invoke.mockResolvedValueOnce(gata())
      const p = start(invoke)
      await flush(); await vi.advanceTimersByTimeAsync(intarziat ? 3750 : 1500)
      expect(await p).toEqual({ raspuns:propunere })
      expect(operatii(invoke)).toEqual(intarziat ? ['cere', 'stare', 'stare'] : ['cere', 'stare'])
    }
  })
  it.each(['structura_incerta', 'multipagina', 'timeout'])('%s → exact un fallback, niciun pilot direct', async eroare => {
    const invoke = vi.fn().mockResolvedValueOnce(ceruta())
      .mockResolvedValueOnce(ok({ success:true, stare:'esuata', eroare }))
      .mockResolvedValueOnce(ok({ ...propunere, sursa:{ ramura:'haiku' } }))
    const p = start(invoke)
    await vi.advanceTimersByTimeAsync(1500)
    expect((await p).raspuns.sursa.ramura).toBe('haiku')
    expect(operatii(invoke)).toEqual(['cere', 'stare', 'fallback'])
    expect(invoke.mock.calls[2][1].body).toEqual({ op:'fallback', cerere_id:'id' })
  })
  it.each(['in_curs', 'pierdut'])('fallback %s → recuperează prin stare fără al doilea fallback', async mod => {
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockResolvedValueOnce(ok({ success:true, stare:'expirata' }))
    if (mod === 'in_curs') invoke.mockResolvedValueOnce(refuz(409, 'in_curs'))
    else invoke.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    invoke.mockResolvedValueOnce(ok({ success:true, stare:'fallback', termen_fallback:new Date(Date.now() + 121500).toISOString() }))
      .mockResolvedValueOnce(gata())
    const p = start(invoke)
    await vi.advanceTimersByTimeAsync(5250)
    expect(await p).toEqual({ raspuns:propunere })
    expect(operatii(invoke).filter(x => x === 'fallback')).toHaveLength(1)
  })
  it.each([409, 429])('cere %i → indică Haiku direct fără încă un apel local', async status => {
    const invoke = vi.fn().mockResolvedValue(refuz(status, status === 429 ? 'limita_orara' : 'local_indisponibil'))
    expect(await start(invoke)).toMatchObject({ haiku:true })
    expect(operatii(invoke)).toEqual(['cere'])
  })
  it.each(['noapte', 'oprit', 'eroare', 'pornire'])('heartbeat %s → rezervă automată', async stare => {
    expect(await start(vi.fn().mockResolvedValue(refuz(409, stare)))).toMatchObject({ haiku:true, motiv:stare })
  })
  it.each([400, 403, 413, 422])('cere %i → eroare fără Haiku automat', async status => {
    const invoke = vi.fn().mockResolvedValue(refuz(status, 'pdf_invalid'))
    await expect(start(invoke)).rejects.toMatchObject({ status })
    expect(operatii(invoke)).toEqual(['cere'])
  })
  it.each(['document', 'proiect', 'depozit', 'sablon', 'fisier', 'revizie'])('schimbare %s → abandon inclusiv răspuns tardiv, fără fallback', async () => {
    let actual = true, rezolva
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockImplementationOnce(() => new Promise(resolve => { rezolva = resolve }))
    const p = start(invoke, { actual:() => actual })
    await vi.advanceTimersByTimeAsync(1500)
    actual = false
    await vi.advanceTimersByTimeAsync(250)
    expect(await p).toEqual({ abandonat:true })
    rezolva(ok({ success:true, stare:'expirata' }))
    await vi.advanceTimersByTimeAsync(10000)
    expect(operatii(invoke)).toEqual(['cere', 'stare'])
  })
  it('context schimbat în timpul cere → niciun fallback', async () => {
    let actual = true, rezolva
    const invoke = vi.fn(() => new Promise(resolve => { rezolva = resolve }))
    const p = start(invoke, { actual:() => actual })
    actual = false; rezolva(refuz(409, 'noapte'))
    expect(await p).toEqual({ abandonat:true })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('plafon epuizat la fallback → eroare, fără ocolire prin pilot', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockResolvedValueOnce(ok({ success:true, stare:'expirata' }))
      .mockResolvedValueOnce(refuz(429, 'plafon_depasit'))
    const p = start(invoke), verificare = expect(p).rejects.toMatchObject({ status:429, raspuns:{ eroare:'plafon_depasit' } })
    await vi.advanceTimersByTimeAsync(1500); await verificare
    expect(operatii(invoke)).toEqual(['cere', 'stare', 'fallback'])
  })
  it('deadline local +5s → stare autoritativă și un fallback; răspuns blocat ignorat', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(ok({ success:true, stare:'expirata' })).mockResolvedValueOnce(ok(propunere))
    const p = start(invoke)
    await vi.advanceTimersByTimeAsync(95000)
    expect(await p).toEqual({ raspuns:propunere })
    expect(operatii(invoke)).toEqual(['cere', 'stare', 'stare', 'fallback'])
  })
  it('deadline fallback +5s → numai stare și eșec, niciun nou apel plătit', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockResolvedValueOnce(ok({ success:true, stare:'expirata' }))
      .mockResolvedValueOnce(refuz(409, 'in_curs')).mockResolvedValue(ok({ success:true, stare:'fallback' }))
    const p = start(invoke), verificare = expect(p).rejects.toMatchObject({ raspuns:{ eroare:'termen_depasit' } })
    await vi.advanceTimersByTimeAsync(127000); await verificare
    expect(operatii(invoke).filter(x => x === 'fallback')).toHaveLength(1)
  })
  it('drept plătit deja consumat sau apel_pierdut → fără încă un apel', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockResolvedValueOnce(ok({ success:true, stare:'esuata', ramura:'haiku', eroare:'apel_pierdut' }))
    const p = start(invoke), verificare = expect(p).rejects.toMatchObject({ raspuns:{ eroare:'apel_pierdut' } })
    await vi.advanceTimersByTimeAsync(1500); await verificare
    expect(operatii(invoke)).toEqual(['cere', 'stare'])
  })
  it('nu cunoaște aplicaAI/salveaza: returnează doar propunerea, fără mutații', async () => {
    const aplicaAI = vi.fn(), salveaza = vi.fn(), ed = { antet:{}, randuri:[] }
    const invoke = vi.fn().mockResolvedValueOnce(ceruta()).mockResolvedValueOnce(gata())
    const p = start(invoke, { ed, aplicaAI, salveaza })
    await vi.advanceTimersByTimeAsync(1500); await p
    expect(ed).toEqual({ antet:{}, randuri:[] }); expect(aplicaAI).not.toHaveBeenCalled(); expect(salveaza).not.toHaveBeenCalled()
  })
})

it.each([
  ['2026-10-23T18:59:59Z', false], ['2026-10-23T19:00:00Z', true],
  ['2026-10-24T02:59:59Z', true], ['2026-10-24T03:00:00Z', false],
  ['2026-10-26T19:59:59Z', false], ['2026-10-26T20:00:00Z', true],
  ['2026-10-27T03:59:59Z', true], ['2026-10-27T04:00:00Z', false],
])('fereastra Europe/Bucharest inclusiv DST: %s', (ora, noapte) => expect(esteNoapteOCR(new Date(ora))).toBe(noapte))

it('noaptea nu trimite cere, merge direct la pilot', async () => {
  vi.setSystemTime(new Date('2026-10-23T20:00:00Z'))
  const invoke = vi.fn()
  expect(await start(invoke)).toEqual({ haiku:true, motiv:'noapte' }); expect(invoke).not.toHaveBeenCalled()
})
it('afișează cele trei proveniențe din contractul B2', () => {
  expect(descrieSursaOCR(propunere)).toBe('Local LightOn+MinerU')
  expect(descrieSursaOCR({ ...propunere, model:'ocr_local:lighton+mineru+claude-haiku-5-5', sursa:{ dezacorduri:3 } })).toBe('Local + Haiku pe 3 celule')
  expect(descrieSursaOCR({ sursa:{ ramura:'haiku' } })).toBe('Haiku (fallback local)')
  // 27.10.2026: citirea directă aviz_e3 e pe Sonnet 5.5 — automat (UI pune ramura 'sonnet') sau „Recitește direct cu Sonnet”
  expect(descrieSursaOCR({ sursa:{ ramura:'sonnet' }, model:'claude-sonnet-5-5' })).toBe('Sonnet (citire directă, automat)')
  expect(descrieSursaOCR({ model:'claude-sonnet-5-5' })).toBe('Sonnet (citire directă)')
  // P2 r2: costul afișat spune al cui e
  expect(costEticheta({ sursa:{ ramura:'haiku' }, model:'claude-haiku-5-5' })).toBe('Haiku, fallback local')
  expect(costEticheta({ sursa:{ ramura:'sonnet' }, model:'claude-sonnet-5-5' })).toBe('Sonnet, citire directă')
  expect(costEticheta({ model:'ocr_local:lighton+mineru+claude-haiku-5-5' })).toBe('Haiku, arbitraj local')
  expect(costEticheta({ model:'ocr_local:lighton+mineru' })).toBe('local')
})
it('503 cu răspuns JSON de la edge la cere → Haiku direct; eroare de transport fără status → fără Haiku (Copilot B4 P1)', async () => {
    const a = vi.fn(async () => refuz(503, 'storage_indisponibil'))
    expect(await start(a)).toMatchObject({ haiku:true, motiv:'storage_indisponibil' })
    expect(operatii(a)).toEqual(['cere'])
    const c = vi.fn(async () => refuz(503, 'serviciu_indisponibil'))
    const rc = await start(c).catch(e => ({ eroare:e }))
    expect(rc.haiku).not.toBe(true)
    const b = vi.fn(async () => ({ data:null, error:{ message:'Failed to fetch' } }))
    const r = await start(b).catch(e => ({ eroare:e }))
    expect(r.haiku).not.toBe(true)
    expect(operatii(b)).toEqual(['cere'])
  })
