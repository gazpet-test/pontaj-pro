// Edge sms-trimite / sms-dlr (logica.ts) cu dependențe simulate: fără rețea, fără Supabase, numere fictive 0700….
// Verifică poarta (anon / non-owner / fără secret → 401 ÎNAINTE de orice rezervare sau trimitere), fluxul rezervă → trimite → rezultat,
// oprirea automată și DLR-ul (doar fn_sms_dlr_aplica, niciodată o trimitere).
import { describe, expect, it } from 'vitest'
import { handler as trimite, LOT_RUNDA } from '../../supabase/functions/sms-trimite/logica.ts'
import { handler as dlr, citesteCorpLimitat } from '../../supabase/functions/sms-dlr/logica.ts'

const LOT = '11111111-2222-4333-8444-555555555555'
const SECRET_DLR = 'D'.repeat(40)
const SECRET_INTERN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'

// client fals: auth.getUser, profiles.is_owner, rpc (fn_verifica_secret, fn_sms_rezerva, fn_sms_rezultat, fn_sms_dlr_aplica)
function clientFals({ user = null, owner = false, rezervari = [], eroareRezultat = false } = {}) {
  const apeluri = []
  let r = 0
  return {
    apeluri,
    auth: { getUser: async () => { apeluri.push(['getUser']); return { data: { user: user ? { id: user } : null }, error: null } } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: user ? { is_owner: owner } : null, error: null }) }) }) }),
    rpc: async (fn, args) => {
      apeluri.push([fn, args])
      if (fn === 'fn_verifica_secret') return { data: args.p_secret === SECRET_INTERN, error: null }
      if (fn === 'fn_sms_rezerva') return { data: rezervari[r++] ?? { motiv: 'gata', mesaje: [] }, error: null }
      if (fn === 'fn_sms_rezultat') return eroareRezultat ? { data: null, error: { code: 'XX000' } } : { data: 'trimis', error: null }
      if (fn === 'fn_sms_dlr_aplica') return { data: 'aplicat', error: null }
      return { data: null, error: { code: '42883' } }
    },
  }
}
const envSim = (o = {}) => k => ({ SMS_FURNIZOR: 'simulator', SMS_DLR_SECRET: SECRET_DLR, SMSLINK_CONNECTION_ID: 'CONN-TEST', ...o })[k]
const fetchInterzis = async () => { throw new Error('rețea interzisă în test') }
const deps = (sb, o = {}) => ({ sb, env: envSim(o.env), fetch: o.fetch ?? fetchInterzis, acum: () => 0, sleep: async () => {} })
const post = (body, h = {}) => new Request('https://x.invalid/functions/v1/sms-trimite', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) })
const mesaj = (id, tel) => ({ id, telefon: tel, segmente: 1 })

describe('sms-trimite — poarta', () => {
  it('fără JWT / cheia anon (fără utilizator) → 401, nicio rezervare', async () => {
    for (const h of [{}, { Authorization: 'Bearer eyJ.anon.x' }]) {
      const sb = clientFals()
      const r = await trimite(post({ lot_id: LOT }, h), deps(sb))
      expect(r.status).toBe(401)
      expect(sb.apeluri.some(([fn]) => fn === 'fn_sms_rezerva')).toBe(false)
    }
  })
  it('cont logat care nu e owner → 401', async () => {
    const sb = clientFals({ user: 'u1', owner: false })
    expect((await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.u.x' }), deps(sb))).status).toBe(401)
    expect(sb.apeluri.some(([fn]) => fn === 'fn_sms_rezerva')).toBe(false)
  })
  it('secret intern greșit → 401; GET → 405; OPTIONS → CORS', async () => {
    const sb = clientFals()
    expect((await trimite(post({}, { 'x-intern-secret': 'f'.repeat(64) }), deps(sb))).status).toBe(401)
    expect((await trimite(new Request('https://x.invalid/', { method: 'GET' }), deps(sb))).status).toBe(405)
    expect((await trimite(new Request('https://x.invalid/', { method: 'OPTIONS' }), deps(sb))).headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })
  it('owner fără lot_id / cu lot_id invalid → 400; furnizor neconfigurat → 500 (fără rezervare)', async () => {
    const sb = clientFals({ user: 'o1', owner: true })
    const auth = { Authorization: 'Bearer eyJ.o.x' }
    expect((await trimite(post({}, auth), deps(sb))).status).toBe(400)
    expect((await trimite(post({ lot_id: "x'; drop" }, auth), deps(sb))).status).toBe(400)
    expect((await trimite(post({ lot_id: LOT }, auth), deps(sb, { env: { SMS_FURNIZOR: undefined } }))).status).toBe(500)
    expect(sb.apeluri.some(([fn]) => fn === 'fn_sms_rezerva')).toBe(false)
  })
})

describe('sms-trimite — flux', () => {
  it('owner: rezervă câte LOT_RUNDA, trimite prin simulator, scrie rezultatele; se oprește la motivul din BD', async () => {
    const sb = clientFals({ user: 'o1', owner: true, rezervari: [
      { motiv: 'ok', text: 'Test fictiv', mesaje: [mesaj('m1', '+40700000001'), mesaj('m2', '+40700000007'), mesaj('m3', '+40700000008')] },
      { motiv: 'plafon_zi', mesaje: [] },
    ] })
    const r = await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), deps(sb))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j).toMatchObject({ ok: true, apelant: 'owner', trimise: 1, esuate: 1, necunoscute: 1, motiv: 'plafon_zi', furnizor: 'simulator' })
    const rez = sb.apeluri.filter(([fn]) => fn === 'fn_sms_rezerva')
    expect(rez[0][1]).toEqual({ p_lot_id: LOT, p_max: LOT_RUNDA, p_furnizor: 'simulator' })
    const scrise = sb.apeluri.filter(([fn]) => fn === 'fn_sms_rezultat').map(([, a]) => a)
    expect(scrise).toHaveLength(3)
    expect(scrise[0]).toMatchObject({ p_mesaj_id: 'm1', p_ok: true, p_cod_eroare: null })
    expect(scrise[0].p_furnizor_id).toMatch(/^sim-/)
    expect(scrise[1]).toMatchObject({ p_mesaj_id: 'm2', p_ok: false, p_clasa: 'permanent', p_cod_eroare: 'sim_respins' })
    expect(scrise[2]).toMatchObject({ p_mesaj_id: 'm3', p_ok: false, p_clasa: 'necunoscut', p_cod_eroare: 'sim_timeout' })
    // răspunsul nu conține telefoane
    expect(JSON.stringify(j)).not.toContain('+4070')
  })
  it('kill-switch în BD → nimic trimis, motivul întors', async () => {
    const sb = clientFals({ user: 'o1', owner: true, rezervari: [{ motiv: 'kill_switch', mesaje: [] }] })
    const j = await (await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), deps(sb))).json()
    expect(j).toMatchObject({ trimise: 0, motiv: 'kill_switch' })
    expect(sb.apeluri.some(([fn]) => fn === 'fn_sms_rezultat')).toBe(false)
  })
  it('eroare de configurare SMSLink (parola) → oprire automată după rundă, fără a doua rezervare', async () => {
    const f = async () => ({ status: 200, json: async () => ({ response_type: 'ERROR', response_id: 7, response_message: "Password 'fictiva' is not approved!" }) })
    const sb = clientFals({ user: 'o1', owner: true, rezervari: [
      { motiv: 'ok', text: 'Test fictiv', mesaje: [mesaj('m1', '+40700000001')] },
      { motiv: 'ok', text: 'Test fictiv', mesaje: [mesaj('m2', '+40700000002')] },
    ] })
    const env = { SMS_FURNIZOR: 'smslink', SMSLINK_PASSWORD: 'fictiva' }
    const j = await (await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), deps(sb, { env, fetch: f }))).json()
    expect(j).toMatchObject({ esuate: 1, motiv: 'oprit_automat', runde: 1 })
    const scris = sb.apeluri.find(([fn]) => fn === 'fn_sms_rezultat')[1]
    expect(scris).toMatchObject({ p_clasa: 'config', p_cod_eroare: 'smslink_7' })
    expect(JSON.stringify(sb.apeluri)).not.toContain('is not approved')
  })
  it('rezultat nescris în BD → numărat necunoscut (mesajul rămâne necunoscut, nu se retrimite)', async () => {
    const sb = clientFals({ user: 'o1', owner: true, eroareRezultat: true, rezervari: [{ motiv: 'ok', text: 'Test', mesaje: [mesaj('m1', '+40700000001')] }] })
    const j = await (await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), deps(sb))).json()
    expect(j).toMatchObject({ trimise: 0, necunoscute: 1 })
  })
  it('cronul intern (x-intern-secret valid) poate porni fără lot_id', async () => {
    const sb = clientFals({ rezervari: [{ motiv: 'fara_lot', mesaje: [] }] })
    const j = await (await trimite(post({}, { 'x-intern-secret': SECRET_INTERN }), deps(sb))).json()
    expect(j).toMatchObject({ ok: true, apelant: 'cron', motiv: 'fara_lot' })
    expect(sb.apeluri.find(([fn]) => fn === 'fn_sms_rezerva')[1].p_lot_id).toBeNull()
  })
  it('Redări după 20:00 (ora României): nicio cerere la SMSLink, mesajele eșuate cu in_afara_orelor, lotul oprit (Copilot r1 P3-01)', async () => {
    let cereri = 0
    const f = async () => { cereri++; return { status: 200, json: async () => ({ response_type: 'MESSAGE', message_id: 1 }) } }
    const sb = clientFals({ user: 'o1', owner: true, rezervari: [
      { motiv: 'ok', categorie: 'redari', text: 'Test fictiv', mesaje: [mesaj('m1', '+40700000001'), mesaj('m2', '+40700000002')] },
      { motiv: 'ok', categorie: 'redari', text: 'Test fictiv', mesaje: [mesaj('m3', '+40700000003')] },
    ] })
    const d = { ...deps(sb, { env: { SMS_FURNIZOR: 'smslink', SMSLINK_PASSWORD: 'fictiva' }, fetch: f }), acum: () => Date.parse('2026-11-03T18:30:00Z') }
    const j = await (await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), d)).json()
    expect(cereri).toBe(0)
    expect(j).toMatchObject({ trimise: 0, esuate: 2, motiv: 'in_afara_orelor', runde: 1 })
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sms_rezultat').map(([, a]) => a.p_cod_eroare)).toEqual(['in_afara_orelor', 'in_afara_orelor'])
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sms_rezerva')).toHaveLength(1)
  })
  it('Redări la 19:59 → pleacă; lotul intern nu are fereastră', async () => {
    let cereri = 0
    const f = async () => { cereri++; return { status: 200, json: async () => ({ response_type: 'MESSAGE', message_id: cereri }) } }
    const sb = clientFals({ user: 'o1', owner: true, rezervari: [{ motiv: 'ok', categorie: 'redari', text: 'Test', mesaje: [mesaj('m1', '+40700000001')] }] })
    const d = { ...deps(sb, { env: { SMS_FURNIZOR: 'smslink', SMSLINK_PASSWORD: 'fictiva' }, fetch: f }), acum: () => Date.parse('2026-11-03T17:59:00Z') }
    expect(await (await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), d)).json()).toMatchObject({ trimise: 1 })
    const sb2 = clientFals({ user: 'o1', owner: true, rezervari: [{ motiv: 'ok', categorie: 'intern', text: 'Test', mesaje: [mesaj('m1', '+40700000001')] }] })
    const d2 = { ...deps(sb2, { env: { SMS_FURNIZOR: 'smslink', SMSLINK_PASSWORD: 'fictiva' }, fetch: f }), acum: () => Date.parse('2026-11-03T22:00:00Z') }
    expect(await (await trimite(post({ lot_id: LOT }, { Authorization: 'Bearer eyJ.o.x' }), d2)).json()).toMatchObject({ trimise: 1 })
    expect(cereri).toBe(2)
  })
})

describe('sms-dlr', () => {
  const url = (k, q = '') => `https://x.invalid/functions/v1/sms-dlr?k=${encodeURIComponent(k)}${q}`
  const form = (o) => new URLSearchParams(o).toString()
  const envLink = { SMS_FURNIZOR: 'smslink' }
  it('GET → 405; secret greșit / lipsă → 401; nimic scris', async () => {
    const sb = clientFals()
    expect((await dlr(new Request(url(SECRET_DLR), { method: 'GET' }), deps(sb, { env: envLink }))).status).toBe(405)
    expect((await dlr(new Request(url('gresit'), { method: 'POST', body: form({ message_id: '1', status: '1', connection_id: 'CONN-TEST' }) }), deps(sb, { env: envLink }))).status).toBe(401)
    expect((await dlr(new Request('https://x.invalid/functions/v1/sms-dlr', { method: 'POST', body: form({ message_id: '1', status: '1' }) }), deps(sb, { env: envLink }))).status).toBe(401)
    expect(sb.apeluri).toHaveLength(0)
  })
  it('connection_id străin → 401; corp prea mare → 413', async () => {
    const sb = clientFals()
    expect((await dlr(new Request(url(SECRET_DLR), { method: 'POST', body: form({ message_id: '1', status: '1', connection_id: 'ALTA' }) }), deps(sb, { env: envLink }))).status).toBe(401)
    expect((await dlr(new Request(url(SECRET_DLR), { method: 'POST', body: 'x'.repeat(5000) }), deps(sb, { env: envLink }))).status).toBe(413)
    expect(sb.apeluri).toHaveLength(0)
  })
  it('corp chunked FĂRĂ Content-Length: citit cu limită de octeți — peste MAX_CORP → 413, sub → procesat (Gemini r1 P3-2)', async () => {
    const flux = (bucati) => new ReadableStream({ start(c) { for (const b of bucati) c.enqueue(new TextEncoder().encode(b)); c.close() } })
    const cerere = (bucati) => new Request(url(SECRET_DLR), { method: 'POST', body: flux(bucati), duplex: 'half' })
    expect(cerere(['a']).headers.get('content-length')).toBeNull()
    const sb = clientFals()
    expect((await dlr(cerere(Array(5).fill('x'.repeat(1000))), deps(sb, { env: envLink }))).status).toBe(413)
    expect(sb.apeluri).toHaveLength(0)
    expect(await citesteCorpLimitat(cerere(['ab', 'cd']), 3)).toBeNull()
    expect(await citesteCorpLimitat(cerere(['ab', 'cd']), 4)).toBe('abcd')
    expect((await dlr(cerere(['message_id=77&sta', 'tus=1&connection_id=CONN-TEST']), deps(sb, { env: envLink }))).status).toBe(200)
    expect(sb.apeluri).toEqual([['fn_sms_dlr_aplica', { p_furnizor: 'smslink', p_furnizor_id: '77', p_livrat: true, p_raportat_la: null }]])
  })
  it('DLR valid (form POST) → doar fn_sms_dlr_aplica, 200; niciodată rezervare / trimitere', async () => {
    const sb = clientFals()
    const r = await dlr(new Request(url(SECRET_DLR), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ message_id: '123456789', status: '0', timestamp: '1762171200', connection_id: 'CONN-TEST', delivery_report: 'raport brut' }) }), deps(sb, { env: envLink }))
    expect(r.status).toBe(200)
    expect(sb.apeluri).toEqual([['fn_sms_dlr_aplica', { p_furnizor: 'smslink', p_furnizor_id: '123456789', p_livrat: false, p_raportat_la: new Date(1762171200 * 1000).toISOString() }]])
  })
  it('rezervă: parametrii în query string (fără k), sau corp JSON', async () => {
    const sb = clientFals()
    expect((await dlr(new Request(url(SECRET_DLR, '&message_id=55&status=1&connection_id=CONN-TEST'), { method: 'POST' }), deps(sb, { env: envLink }))).status).toBe(200)
    expect((await dlr(new Request(url(SECRET_DLR), { method: 'POST', body: JSON.stringify({ message_id: 56, status: 1, connection_id: 'CONN-TEST' }) }), deps(sb, { env: envLink }))).status).toBe(200)
    expect(sb.apeluri.map(([fn, a]) => [fn, a.p_furnizor_id, a.p_livrat])).toEqual([['fn_sms_dlr_aplica', '55', true], ['fn_sms_dlr_aplica', '56', true]])
  })
  it('parametri invalizi → 401 (verificarea formatului e parte din poartă)', async () => {
    const sb = clientFals()
    expect((await dlr(new Request(url(SECRET_DLR), { method: 'POST', body: form({ message_id: '1; drop', status: '1', connection_id: 'CONN-TEST' }) }), deps(sb, { env: envLink }))).status).toBe(401)
    expect(sb.apeluri).toHaveLength(0)
  })
})
