// 20261130d (04.11.2026): filtrul de IP pe sms-dlr (observare implicit / blocare cu SMS_DLR_IP_STRICT=1) și soldul SMSLink
// (_shared/smsFurnizor.ts citesteSold, edge sms-sold, textul din panou, sursa din Administrator → Alerte). Fără rețea, fără Supabase.
import { describe, expect, it } from 'vitest'
import { handler as dlr, verificaIp, IP_SMSLINK, ANTET_IP } from '../../supabase/functions/sms-dlr/logica.ts'
import { handler as sold, poartaSold } from '../../supabase/functions/sms-sold/logica.ts'
import { citesteSold, SMSLINK_API } from '../../supabase/functions/_shared/smsFurnizor.ts'
import { textSold } from './smsLogica.js'
import { alerteSmsSold, SURSE_ADMIN, areAccesSursa, incarcaSursaAdmin } from '../adminAlerte.js'

const SECRET_DLR = 'D'.repeat(40)
const SECRET_INTERN = '0123456789abcdef'.repeat(4)
const PAROLA = 'parola-de-test-fictiva'
const UID_O = '00000000-0000-4000-8000-0000000000a1'
const UID_U = '00000000-0000-4000-8000-0000000000a2'
// lista comunicată de SMSLink pe 03.11.2026, copiată din brief (sursă independentă de constanta din cod)
const LISTA_BRIEF = ['146.70.213.194', '146.70.213.195', '146.70.213.200', '89.33.246.226', '89.33.246.227', '89.33.246.228', '89.33.246.234']

// ── sms-dlr: filtrul de IP ─────────────────────────────────────────────────────────────────────────────────────────────────
function sbDlr() {
  const apeluri = []
  return { apeluri, rpc: async (fn, args) => { apeluri.push([fn, args]); return { data: 'aplicat', error: null } } }
}
const envDlr = (o = {}) => k => ({ SMS_FURNIZOR: 'smslink', SMS_DLR_SECRET: SECRET_DLR, SMSLINK_CONNECTION_ID: 'CONN-TEST', ...o })[k]
const cerereDlr = (h = {}, k = SECRET_DLR) => new Request(`https://x.invalid/functions/v1/sms-dlr?k=${encodeURIComponent(k)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...h },
  body: new URLSearchParams({ message_id: '123', status: '1', connection_id: 'CONN-TEST' }).toString(),
})
function rulareDlr(h, env = {}, k) {
  const sb = sbDlr(), avertismente = []
  return dlr(cerereDlr(h, k), { sb, env: envDlr(env), avertizeaza: (m, c) => avertismente.push([m, c]) }).then(r => ({ r, sb, avertismente }))
}

describe('sms-dlr — filtrul de IP (a doua barieră după secret)', () => {
  it('lista din cod = exact cele 7 IP-uri comunicate de SMSLink; antetul folosit e cf-connecting-ip', () => {
    expect([...IP_SMSLINK].sort()).toEqual([...LISTA_BRIEF].sort())
    expect(ANTET_IP).toBe('cf-connecting-ip')
  })
  it('IP din listă → procesat, fără avertisment (în ambele moduri)', async () => {
    for (const env of [{}, { SMS_DLR_IP_STRICT: '1' }]) {
      for (const ip of LISTA_BRIEF) {
        const { r, sb, avertismente } = await rulareDlr({ 'cf-connecting-ip': ip }, env)
        expect(r.status).toBe(200)
        expect(sb.apeluri.map(([fn]) => fn)).toEqual(['fn_sms_dlr_aplica'])
        expect(avertismente).toHaveLength(0)
      }
    }
  })
  it('IP străin în OBSERVARE (implicit) → procesat + avertisment fără PII (doar IP-ul și motivul)', async () => {
    for (const env of [{}, { SMS_DLR_IP_STRICT: '0' }, { SMS_DLR_IP_STRICT: 'da' }]) {
      const { r, sb, avertismente } = await rulareDlr({ 'cf-connecting-ip': '203.0.113.9' }, env)
      expect(r.status).toBe(200)
      expect(sb.apeluri).toHaveLength(1)
      expect(avertismente).toEqual([['sms-dlr: IP in afara listei SMSLink', { ip: '203.0.113.9', motiv: 'ip_strain', mod: 'observare' }]])
    }
  })
  it('IP străin în STRICT (SMS_DLR_IP_STRICT=1) → 403, nimic scris', async () => {
    const { r, sb, avertismente } = await rulareDlr({ 'cf-connecting-ip': '146.70.213.196' }, { SMS_DLR_IP_STRICT: '1' })
    expect(r.status).toBe(403)
    expect(sb.apeluri).toHaveLength(0)
    expect(avertismente[0][1]).toEqual({ ip: '146.70.213.196', motiv: 'ip_strain', mod: 'blocare' })
  })
  it('antet lipsă: observare → procesat + avertisment antet_lipsa; strict → 403', async () => {
    const o = await rulareDlr({})
    expect(o.r.status).toBe(200)
    expect(o.avertismente[0][1]).toEqual({ ip: null, motiv: 'antet_lipsa', mod: 'observare' })
    const s = await rulareDlr({}, { SMS_DLR_IP_STRICT: '1' })
    expect(s.r.status).toBe(403)
    expect(s.sb.apeluri).toHaveLength(0)
  })
  it('x-forwarded-for NU deschide filtrul (îl poate scrie clientul): strict + XFF cu IP SMSLink, fără cf-connecting-ip → 403', async () => {
    const { r, sb } = await rulareDlr({ 'x-forwarded-for': '146.70.213.194, 10.0.0.1' }, { SMS_DLR_IP_STRICT: '1' })
    expect(r.status).toBe(403)
    expect(sb.apeluri).toHaveLength(0)
  })
  it('valoare care nu e IPv4 → motiv ip_invalid, IP-ul NU se loghează (poate fi orice text)', async () => {
    const { r, avertismente } = await rulareDlr({ 'cf-connecting-ip': '0700123456 <script>' })
    expect(r.status).toBe(200)
    expect(avertismente[0][1]).toEqual({ ip: null, motiv: 'ip_invalid', mod: 'observare' })
  })
  it('forma IPv6 mapată ::ffff:a.b.c.d e acceptată; zerourile în față / IPv6 pur nu', () => {
    const v = h => verificaIp(new Request('https://x.invalid/', { headers: { 'cf-connecting-ip': h } }))
    expect(v('::ffff:89.33.246.234')).toEqual({ permis: true, ip: '89.33.246.234', motiv: 'ok' })
    expect(v(' 89.33.246.226 ').permis).toBe(true)
    expect(v('089.33.246.226').motiv).toBe('ip_invalid')
    expect(v('2001:db8::1').motiv).toBe('ip_invalid')
    expect(v('89.33.246.2341').motiv).toBe('ip_invalid')
  })
  it('secretul rămâne prima poartă: secret greșit → 401 fără avertisment, chiar și din IP străin în strict', async () => {
    const { r, sb, avertismente } = await rulareDlr({ 'cf-connecting-ip': '203.0.113.9' }, { SMS_DLR_IP_STRICT: '1' }, 'gresit')
    expect(r.status).toBe(401)
    expect(sb.apeluri).toHaveLength(0)
    expect(avertismente).toHaveLength(0)
  })
  it('IP din listă NU ocolește connection_id-ul: connection_id străin → 401', async () => {
    const sb = sbDlr()
    const req = new Request(`https://x.invalid/functions/v1/sms-dlr?k=${SECRET_DLR}`, { method: 'POST', headers: { 'cf-connecting-ip': LISTA_BRIEF[0] },
      body: new URLSearchParams({ message_id: '1', status: '1', connection_id: 'ALTA' }).toString() })
    expect((await dlr(req, { sb, env: envDlr({ SMS_DLR_IP_STRICT: '1' }), avertizeaza: () => {} })).status).toBe(401)
    expect(sb.apeluri).toHaveLength(0)
  })
})

// ── citesteSold (mode=Credit) ──────────────────────────────────────────────────────────────────────────────────────────────
function fetchFals(raspuns) {
  const cereri = []
  const f = async (url, init) => {
    cereri.push({ url, init, body: JSON.parse(init.body) })
    if (raspuns instanceof Error) throw raspuns
    return { status: raspuns.status ?? 200, json: async () => { if (raspuns.json === undefined) throw new Error('fara json'); return raspuns.json } }
  }
  f.cereri = cereri
  return f
}
const envLink = (o = {}) => k => ({ SMS_FURNIZOR: 'smslink', SMSLINK_CONNECTION_ID: 'CONN-TEST', SMSLINK_PASSWORD: PAROLA, ...o })[k]

describe('citesteSold — mode=Credit, corp JSON, doar creditul sau codul', () => {
  it('cererea: POST JSON pe json.php?mode=Credit, cu connection_id + password în corp (nu în URL)', async () => {
    const f = fetchFals({ json: { credit: 1234, timestamp: 1762171200 } })
    expect(await citesteSold(envLink(), { fetch: f })).toEqual({ ok: true, credit: 1234 })
    expect(f.cereri).toHaveLength(1)
    expect(f.cereri[0].url).toBe(`${SMSLINK_API}?mode=Credit`)
    expect(f.cereri[0].url).not.toContain(PAROLA)
    expect(f.cereri[0].init.method).toBe('POST')
    expect(f.cereri[0].init.headers['Content-Type']).toBe('application/json')
    expect(f.cereri[0].body).toMatchObject({ connection_id: 'CONN-TEST', password: PAROLA })
  })
  it('credit ca text zecimal → întreg tăiat în jos; 0 rămâne 0', async () => {
    expect(await citesteSold(envLink(), { fetch: fetchFals({ json: { credit: '149.90' } }) })).toEqual({ ok: true, credit: 149 })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ json: { credit: 0 } }) })).toEqual({ ok: true, credit: 0 })
  })
  it('eroarea 7 (cu parola în response_message) → doar codul, parola nu apare nicăieri în rezultat', async () => {
    const r = await citesteSold(envLink(), { fetch: fetchFals({ json: { response_type: 'ERROR', response_id: 7, response_message: `Password '${PAROLA}' is not approved!` } }) })
    expect(r).toEqual({ ok: false, eroare: 'smslink_7' })
    expect(JSON.stringify(r)).not.toContain(PAROLA)
  })
  it('răspunsuri neașteptate → eroare, NU credit 0 (lipsă, negativ, text, uriaș, non-JSON, timeout)', async () => {
    for (const j of [{}, { credit: -5 }, { credit: 'mult' }, { credit: 1e9 }, { credit: null }, { response_type: 'ERROR', response_id: 'x' }]) {
      expect((await citesteSold(envLink(), { fetch: fetchFals({ json: j }) })).ok).toBe(false)
    }
    expect(await citesteSold(envLink(), { fetch: fetchFals({ status: 502 }) })).toEqual({ ok: false, eroare: 'http_502' })
    expect(await citesteSold(envLink(), { fetch: fetchFals(new Error('timeout')) })).toEqual({ ok: false, eroare: 'retea_timeout' })
  })
  it('neconfigurat → eroare fără rețea; simulatorul nu iese în rețea', async () => {
    const f = fetchFals({ json: { credit: 1 } })
    expect(await citesteSold(envLink({ SMSLINK_PASSWORD: undefined }), { fetch: f })).toEqual({ ok: false, eroare: 'smslink_neconfigurat' })
    expect(await citesteSold(k => (k === 'SMS_FURNIZOR' ? 'twilio' : undefined), { fetch: f })).toEqual({ ok: false, eroare: 'furnizor_neconfigurat' })
    expect((await citesteSold(k => (k === 'SMS_FURNIZOR' ? 'simulator' : undefined), { fetch: f })).ok).toBe(true)
    expect(f.cereri).toHaveLength(0)
  })
})

// ── edge sms-sold: poarta + scrierea prin RPC ──────────────────────────────────────────────────────────────────────────────
function sbSold({ user = null, nivel = null, eroareRpc = false } = {}) {
  const apeluri = []
  return {
    apeluri,
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) },
    rpc: async (fn, args) => {
      apeluri.push([fn, args])
      if (fn === 'fn_verifica_secret') return { data: args.p_secret === SECRET_INTERN, error: null }
      if (fn === 'fn_sold_sms_inregistreaza') return eroareRpc ? { data: null, error: { code: 'XX000' } }
        : { data: { credit: args.p_credit, prag: 150, sub_prag: args.p_credit != null && args.p_credit < 150 }, error: null }
      return { data: null, error: { code: '42883' } }
    },
    caUtilizator: jwt => ({ rpc: async fn => { apeluri.push(['utilizator:' + fn, jwt]); return fn === 'fn_sms_nivel' ? { data: nivel, error: null } : { data: null, error: { code: '42501' } } } }),
  }
}
const depsSold = (sb, o = {}) => ({ sb, sbUtilizator: sb.caUtilizator, env: envLink(o.env), fetch: o.fetch ?? fetchFals({ json: { credit: 120 } }) })
const postSold = (h = {}) => new Request('https://x.invalid/functions/v1/sms-sold', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: '{}' })
const nuAScris = sb => !sb.apeluri.some(([fn]) => fn === 'fn_sold_sms_inregistreaza')

describe('sms-sold — poarta (cron intern sau owner) și scrierea', () => {
  it('fără nimic / anon / non-owner (utilizator, test) / secret greșit → 401, furnizorul neapelat, nimic scris', async () => {
    const cazuri = [[{}, {}], [{ Authorization: 'Bearer eyJ.anon.x' }, {}], [{ Authorization: 'Bearer eyJ.u.x' }, { user: UID_U, nivel: 'utilizator' }],
      [{ Authorization: 'Bearer eyJ.t.x' }, { user: UID_U, nivel: 'test' }], [{ 'x-intern-secret': 'f'.repeat(64) }, {}], [{ Authorization: 'Bearer eyJ.o.x' }, { user: 'nu-uuid', nivel: 'owner' }]]
    for (const [h, o] of cazuri) {
      const sb = sbSold(o), f = fetchFals({ json: { credit: 1 } })
      expect((await sold(postSold(h), depsSold(sb, { fetch: f }))).status).toBe(401)
      expect(nuAScris(sb)).toBe(true)
      expect(f.cereri).toHaveLength(0)
    }
  })
  it('GET → 405; OPTIONS → CORS', async () => {
    const sb = sbSold()
    expect((await sold(new Request('https://x.invalid/', { method: 'GET' }), depsSold(sb))).status).toBe(405)
    expect((await sold(new Request('https://x.invalid/', { method: 'OPTIONS' }), depsSold(sb))).status).toBe(200)
  })
  it('cronul (x-intern-secret) → citește creditul și îl scrie prin fn_sold_sms_inregistreaza; sub prag raportat din BD', async () => {
    const sb = sbSold()
    const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sb))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, apelant: 'cron', credit: 120, prag: 150, sub_prag: true })
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sold_sms_inregistreaza')).toEqual([['fn_sold_sms_inregistreaza', { p_credit: 120, p_eroare: null }]])
  })
  it('owner-ul (nivelul cerut cu JWT-ul lui) → poate citi acum; nivelul nu se cere cu service_role', async () => {
    const sb = sbSold({ user: UID_O, nivel: 'owner' })
    expect(await poartaSold(postSold({ Authorization: 'Bearer eyJ.o.x' }), depsSold(sb))).toBe('owner')
    expect(sb.apeluri.find(([fn]) => fn === 'utilizator:fn_sms_nivel')[1]).toBe('eyJ.o.x')
    expect(sb.apeluri.some(([fn]) => fn === 'fn_sms_nivel')).toBe(false)
  })
  it('eroarea furnizorului (ex. 7, cu parola) → se scrie DOAR codul; răspunsul nu conține parola', async () => {
    const sb = sbSold()
    const f = fetchFals({ json: { response_type: 'ERROR', response_id: 7, response_message: `Password '${PAROLA}' is not approved!` } })
    const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sb, { fetch: f }))
    const corp = await r.text()
    expect(r.status).toBe(200)
    expect(JSON.parse(corp)).toMatchObject({ ok: false, eroare: 'smslink_7' })
    expect(corp).not.toContain(PAROLA)
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sold_sms_inregistreaza')).toEqual([['fn_sold_sms_inregistreaza', { p_credit: null, p_eroare: 'smslink_7' }]])
  })
  it('RPC-ul de scriere eșuează → 500 (nu „ok”)', async () => {
    const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sbSold({ eroareRpc: true })))
    expect(r.status).toBe(500)
  })
})

// ── UI: textul din panou și alerta din Administrator ──────────────────────────────────────────────────────────────────────
describe('soldul în UI', () => {
  it('panoul owner-ului: „Sold SMSLink: N (la ZZ.LL HH:MM)” în ora României', () => {
    expect(textSold({ credit: 842, citit_la: '2026-11-04T05:10:30Z' })).toBe('Sold SMSLink: 842 (la 04.11 07:10)')
    expect(textSold({ credit: null, citit_la: null })).toBe('Sold SMSLink: încă necitit')
    expect(textSold(null)).toBe('Sold SMSLink: —')
  })
  it('Administrator → Alerte: sursa e doar a owner-ului; alerta apare doar când BD-ul spune alerta', () => {
    const s = SURSE_ADMIN.find(x => x.id === 'sms_sold')
    expect(s).toMatchObject({ ownerOnly: true, path: '/admin?tab=sms' })
    expect(areAccesSursa({ id: 'x', is_owner: false, module_access: ['admin_alerte', 'sms'] }, s)).toBe(false)
    expect(areAccesSursa({ id: 'o', is_owner: true, module_access: ['admin_alerte'] }, s)).toBe(true)
    expect(alerteSmsSold({ credit: 900, alerta: false, prag: 150 })).toEqual([])
    expect(alerteSmsSold(null)).toEqual([])
    const [sub] = alerteSmsSold({ credit: 120, prag: 150, sub_prag: true, alerta: true, citit_la: '2026-11-04T05:10:00Z' })
    expect(sub).toMatchObject({ id: 'sms_sold:sub_prag', priority: 'week', title: 'Sold SMSLink sub prag: 120 SMS (prag 150)' })
    expect(alerteSmsSold({ credit: 0, prag: 150, sub_prag: true, alerta: true })[0].priority).toBe('critical')
    expect(alerteSmsSold({ credit: 500, prag: 150, eroare_dupa_citire: true, eroare: 'smslink_7', alerta: true })[0]).toMatchObject({ id: 'sms_sold:eroare', priority: 'missing' })
    expect(alerteSmsSold({ credit: null, prag: 150, citire_veche: true, alerta: true })[0]).toMatchObject({ id: 'sms_sold:veche', reference: 'Nicio citire reușită încă' })
  })
  it('sursa citește vederea v_sms_sold (fără rpc), cu proiecția explicită; 42501 din BD → „Acces insuficient”', async () => {
    const cereri = []
    const client = rand => ({ from: t => { const q = { select: (c, o) => { cereri.push([t, c, o]); return q }, order: () => q, range: () => q,
      abortSignal: async () => (rand instanceof Error ? { data: null, error: rand, count: null } : { data: [rand], error: null, count: 1 }) }; return q } })
    const owner = { id: 'o', is_owner: true, module_access: ['admin_alerte'] }
    const s = SURSE_ADMIN.find(x => x.id === 'sms_sold')
    const r = await incarcaSursaAdmin(client({ id: true, credit: 80, prag: 150, sub_prag: true, alerta: true, citit_la: '2026-11-04T05:10:00Z' }), s, owner)
    expect(r.state).toBe('ok')
    expect(r.rows.map(x => x.id)).toEqual(['sms_sold:sub_prag'])
    expect(cereri[0]).toEqual(['v_sms_sold', 'id,credit,citit_la,eroare,eroare_la,prag,sub_prag,citire_veche,eroare_dupa_citire,alerta', { count: 'exact' }])
    const e = Object.assign(new Error('doar owner'), { code: '42501' })
    expect((await incarcaSursaAdmin(client(e), s, owner)).state).toBe('denied')
  })
})
