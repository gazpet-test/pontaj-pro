// Adaptorul de SMS (supabase/functions/_shared/smsFurnizor.ts) — fără rețea: fetch simulat, env simulat, numere fictive 0700….
import { describe, expect, it } from 'vitest'
import { creeazaFurnizor, secretDlrValid, SMSLINK_API } from '../../supabase/functions/_shared/smsFurnizor.ts'

const SECRET = 'S'.repeat(40)
const PAROLA = 'parola-de-test-fictiva'
const envDe = (o = {}) => k => ({ SMS_FURNIZOR: 'smslink', SMSLINK_CONNECTION_ID: 'CONN-TEST', SMSLINK_PASSWORD: PAROLA, SMS_DLR_SECRET: SECRET, ...o })[k]
const nuDormi = async () => {}

// fetch simulat: înregistrează cererile, întoarce răspunsurile date pe rând (ultimul se repetă)
function fetchFals(raspunsuri) {
  const cereri = []
  const f = async (url, init) => {
    cereri.push({ url, init, body: JSON.parse(init.body) })
    const r = raspunsuri[Math.min(cereri.length - 1, raspunsuri.length - 1)]
    if (r instanceof Error) throw r
    return { status: r.status ?? 200, json: async () => { if (r.json === undefined) throw new Error('fara json'); return r.json } }
  }
  f.cereri = cereri
  return f
}

describe('creeazaFurnizor', () => {
  it('fără SMS_FURNIZOR sau cu valoare necunoscută → null (nimic nu pleacă)', () => {
    expect(creeazaFurnizor(() => undefined)).toBeNull()
    expect(creeazaFurnizor(k => (k === 'SMS_FURNIZOR' ? 'twilio' : undefined))).toBeNull()
    expect(creeazaFurnizor(envDe()).nume).toBe('smslink')
    expect(creeazaFurnizor(envDe({ SMS_FURNIZOR: 'simulator' })).nume).toBe('simulator')
  })
})

describe('SMSLink — trimite', () => {
  it('succes: POST JSON pe endpointul HTTPS, număr național, text GSM, test=0; id-ul ca text', async () => {
    const f = fetchFals([{ json: { response_type: 'MESSAGE', response_id: 1, message_id: 123456789012, receiver: '0700000001' } }])
    const r = await creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'Sedinta maine', ref: 'm1' })
    expect(r).toEqual({ ok: true, furnizor_id: '123456789012', segmente: 1 })
    expect(f.cereri).toHaveLength(1)
    expect(f.cereri[0].url).toBe(SMSLINK_API)
    expect(SMSLINK_API.startsWith('https://')).toBe(true)
    expect(f.cereri[0].init.method).toBe('POST')
    expect(f.cereri[0].body).toMatchObject({ connection_id: 'CONN-TEST', password: PAROLA, to: '0700000001', message: 'Sedinta maine', test: 0 })
    expect(f.cereri[0].body.sender).toBeUndefined()
  })
  it('SMSLINK_TEST=1 → test=1; SMSLINK_SENDER → sender', async () => {
    const f = fetchFals([{ json: { response_type: 'MESSAGE', message_id: 5 } }])
    await creeazaFurnizor(envDe({ SMSLINK_TEST: '1', SMSLINK_SENDER: 'GAZPET' }), { fetch: f }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })
    expect(f.cereri[0].body).toMatchObject({ test: 1, sender: 'GAZPET' })
  })
  it('eroarea 7 (parolă) → config, codul smslink_7; textul răspunsului (cu parola) nu apare nicăieri în rezultat', async () => {
    const f = fetchFals([{ json: { response_type: 'ERROR', response_id: 7, response_message: `Password '${PAROLA}' is not approved!` } }])
    const r = await creeazaFurnizor(envDe(), { fetch: f }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })
    expect(r).toEqual({ ok: false, clasa: 'config', eroare: 'smslink_7', segmente: 1 })
    expect(JSON.stringify(r)).not.toContain(PAROLA)
  })
  it('permanent (10) și credit (8) nu se reîncearcă', async () => {
    for (const [cod, clasa] of [[10, 'permanent'], [8, 'credit']]) {
      const f = fetchFals([{ json: { response_type: 'ERROR', response_id: cod } }])
      const r = await creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })
      expect(r).toMatchObject({ ok: false, clasa, eroare: `smslink_${cod}` })
      expect(f.cereri).toHaveLength(1)
    }
  })
  it('tranzitoriu (16): maximum 3 încercări, apoi eșec; succes la a doua încercare = trimis', async () => {
    const f = fetchFals([{ json: { response_type: 'ERROR', response_id: 16 } }])
    const r = await creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })
    expect(r).toMatchObject({ ok: false, clasa: 'tranzitoriu', eroare: 'smslink_16' })
    expect(f.cereri).toHaveLength(3)
    const g = fetchFals([{ json: { response_type: 'ERROR', response_id: 16 } }, { json: { response_type: 'MESSAGE', message_id: 77 } }])
    expect(await creeazaFurnizor(envDe(), { fetch: g, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })).toMatchObject({ ok: true, furnizor_id: '77' })
    expect(g.cereri).toHaveLength(2)
  })
  it('cod nou / nedocumentat (ex. 99) → necunoscut, O SINGURĂ cerere (Jakarinos r1 P1: fără retrimitere, risc de dublură)', async () => {
    for (const cod of [99, 0, 18]) {
      const f = fetchFals([{ json: { response_type: 'ERROR', response_id: cod } }, { json: { response_type: 'MESSAGE', message_id: 1 } }])
      const r = await creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })
      expect(r).toEqual({ ok: false, clasa: 'necunoscut', eroare: `smslink_${cod}`, segmente: 1 })
      expect(f.cereri).toHaveLength(1)
    }
  })
  it('16 apoi un cod necunoscut → se oprește imediat (doar 16 se reîncearcă)', async () => {
    const f = fetchFals([{ json: { response_type: 'ERROR', response_id: 16 } }, { json: { response_type: 'ERROR', response_id: 99 } }, { json: { response_type: 'MESSAGE', message_id: 3 } }])
    expect(await creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })).toMatchObject({ clasa: 'necunoscut', eroare: 'smslink_99' })
    expect(f.cereri).toHaveLength(2)
  })
  it('garda inainteDeApel (fereastra Redări): falsă → nicio cerere; devenită falsă între reîncercări → oprire', async () => {
    const f = fetchFals([{ json: { response_type: 'ERROR', response_id: 16 } }])
    const sl = creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi })
    expect(await sl.trimite({ to: '+40700000001', text: 'x', ref: 'r', inainteDeApel: () => false })).toMatchObject({ ok: false, clasa: 'permanent', eroare: 'in_afara_orelor' })
    expect(f.cereri).toHaveLength(0)
    let apeluri = 0
    expect(await sl.trimite({ to: '+40700000001', text: 'x', ref: 'r', inainteDeApel: () => ++apeluri === 1 })).toMatchObject({ eroare: 'in_afara_orelor' })
    expect(f.cereri).toHaveLength(1)
    expect(await sl.trimite({ to: '+40700000001', text: 'x', ref: 'r', inainteDeApel: () => { throw new Error('ceas') } })).toMatchObject({ eroare: 'in_afara_orelor' })
    expect(f.cereri).toHaveLength(1)
    const sim = creeazaFurnizor(envDe({ SMS_FURNIZOR: 'simulator' }))
    expect(await sim.trimite({ to: '+40700000001', text: 'x', ref: 'r', inainteDeApel: () => false })).toMatchObject({ eroare: 'in_afara_orelor' })
  })
  it('timeout / rețea după plecarea cererii → necunoscut, O SINGURĂ cerere (fără retrimitere)', async () => {
    const f = fetchFals([new Error('timeout')])
    const r = await creeazaFurnizor(envDe(), { fetch: f, sleep: nuDormi }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })
    expect(r).toEqual({ ok: false, clasa: 'necunoscut', eroare: 'retea_timeout', segmente: 1 })
    expect(f.cereri).toHaveLength(1)
  })
  it('răspuns fără JSON / neașteptat → necunoscut (codul http, nu textul)', async () => {
    const f = fetchFals([{ status: 502 }])
    expect(await creeazaFurnizor(envDe(), { fetch: f }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })).toMatchObject({ clasa: 'necunoscut', eroare: 'http_502' })
    const g = fetchFals([{ json: { response_type: 'MESSAGE' } }])
    expect(await creeazaFurnizor(envDe(), { fetch: g }).trimite({ to: '+40700000001', text: 'x', ref: 'r' })).toMatchObject({ clasa: 'necunoscut', eroare: 'smslink_raspuns' })
  })
  it('text nenormalizat / prea lung / număr invalid / conexiune neconfigurată → refuz ÎNAINTE de rețea', async () => {
    const f = fetchFals([{ json: { response_type: 'MESSAGE', message_id: 1 } }])
    const sl = creeazaFurnizor(envDe(), { fetch: f })
    expect(await sl.trimite({ to: '+40700000001', text: 'Ședință', ref: 'r' })).toMatchObject({ ok: false, clasa: 'permanent', eroare: 'text_invalid' })
    expect(await sl.trimite({ to: '+40700000001', text: 'a'.repeat(161), ref: 'r' })).toMatchObject({ eroare: 'text_invalid' })
    expect(await sl.trimite({ to: '0210000000', text: 'x', ref: 'r' })).toMatchObject({ eroare: 'telefon_invalid' })
    expect(await creeazaFurnizor(envDe({ SMSLINK_PASSWORD: '' }), { fetch: f }).trimite({ to: '+40700000001', text: 'x', ref: 'r' }))
      .toMatchObject({ clasa: 'config', eroare: 'smslink_neconfigurat' })
    expect(f.cereri).toHaveLength(0)
  })
  it('status: SMSLink nu are interogare publică de stare', async () => {
    expect(await creeazaFurnizor(envDe()).status('1')).toEqual({ suportat: false })
  })
})

describe('DLR', () => {
  const cerere = (k, metoda = 'POST') => new Request(`https://proiect.invalid/functions/v1/sms-dlr${k === null ? '' : `?k=${encodeURIComponent(k)}`}`, { method: metoda })
  it('secretul din URL: doar POST, comparat exact, secret configurat ≥ 32', () => {
    expect(secretDlrValid(cerere(SECRET), envDe())).toBe(true)
    expect(secretDlrValid(cerere(SECRET, 'GET'), envDe())).toBe(false)
    expect(secretDlrValid(cerere(SECRET + 'x'), envDe())).toBe(false)
    expect(secretDlrValid(cerere(null), envDe())).toBe(false)
    expect(secretDlrValid(cerere('scurt'), envDe({ SMS_DLR_SECRET: 'scurt' }))).toBe(false)
    expect(secretDlrValid(cerere(''), envDe({ SMS_DLR_SECRET: undefined }))).toBe(false)
  })
  it('SMSLink: connection_id al nostru + message_id numeric + status 0/1; parsare', () => {
    const sl = creeazaFurnizor(envDe())
    const p = new URLSearchParams({ message_id: '123456789012', status: '1', timestamp: '1762171200', connection_id: 'CONN-TEST' })
    expect(sl.verificaDlr(cerere(SECRET), p)).toBe(true)
    expect(sl.parseazaDlr(p)).toEqual({ furnizor_id: '123456789012', livrat: true, raportat_la: new Date(1762171200 * 1000).toISOString() })
    expect(sl.verificaDlr(cerere(SECRET), new URLSearchParams({ message_id: '1', status: '1', connection_id: 'ALTA' }))).toBe(false)
    expect(sl.verificaDlr(cerere(SECRET), new URLSearchParams({ message_id: '1', status: '1' }))).toBe(false)
    expect(sl.verificaDlr(cerere(SECRET), new URLSearchParams({ message_id: 'x1', status: '1', connection_id: 'CONN-TEST' }))).toBe(false)
    expect(sl.verificaDlr(cerere(SECRET), new URLSearchParams({ message_id: '1', status: '2', connection_id: 'CONN-TEST' }))).toBe(false)
    expect(sl.verificaDlr(cerere('gresit'), p)).toBe(false)
    expect(sl.parseazaDlr(new URLSearchParams({ message_id: '9', status: '0' }))).toEqual({ furnizor_id: '9', livrat: false, raportat_la: null })
  })
})

describe('simulator (fără rețea)', () => {
  const sim = creeazaFurnizor(envDe({ SMS_FURNIZOR: 'simulator' }))
  it('rezultate deterministe după ultima cifră; id sim-<uuid> compatibil cu BD', async () => {
    const ok = await sim.trimite({ to: '+40700000001', text: 'x', ref: 'r' })
    expect(ok.ok).toBe(true)
    expect(ok.furnizor_id).toMatch(/^sim-[0-9a-f-]{36}$/)
    expect(ok.furnizor_id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/)
    expect(await sim.trimite({ to: '+40700000007', text: 'x', ref: 'r' })).toMatchObject({ clasa: 'permanent' })
    expect(await sim.trimite({ to: '+40700000008', text: 'x', ref: 'r' })).toMatchObject({ clasa: 'necunoscut' })
    expect(await sim.trimite({ to: '+40700000009', text: 'x', ref: 'r' })).toMatchObject({ clasa: 'tranzitoriu' })
    expect(await sim.trimite({ to: '+40700000001', text: 'Ședință', ref: 'r' })).toMatchObject({ eroare: 'text_invalid' })
  })
  it('DLR simulat: același secret, id sim-…', () => {
    const p = new URLSearchParams({ message_id: 'sim-' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12), status: '0' })
    expect(sim.verificaDlr(new Request(`https://x.invalid/?k=${SECRET}`, { method: 'POST' }), p)).toBe(true)
    expect(sim.parseazaDlr(p)).toMatchObject({ livrat: false })
    expect(sim.verificaDlr(new Request(`https://x.invalid/?k=${SECRET}`, { method: 'POST' }), new URLSearchParams({ message_id: '123', status: '1' }))).toBe(false)
  })
})
