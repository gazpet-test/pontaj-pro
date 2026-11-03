// 20261130d (04.11.2026): filtrul de IP pe sms-dlr (observare implicit / blocare cu SMS_DLR_IP_STRICT=1) și soldul SMSLink
// (_shared/smsFurnizor.ts citesteSold, edge sms-sold, textul din panou, sursa din Administrator → Alerte). Fără rețea, fără Supabase.
import { describe, expect, it } from 'vitest'
import { handler as dlr, verificaIp, IP_SMSLINK, ANTET_IP } from '../../supabase/functions/sms-dlr/logica.ts'
import { handler as sold, poartaSold } from '../../supabase/functions/sms-sold/logica.ts'
import { citesteSold, SMSLINK_API, MAX_RASPUNS_SOLD } from '../../supabase/functions/_shared/smsFurnizor.ts'
import { textSold } from './smsLogica.js'
import { alerteSmsSold, momentAlertaSold, SURSE_ADMIN, areAccesSursa, incarcaSursaAdmin } from '../adminAlerte.js'

const SECRET_DLR = 'D'.repeat(40)
const SECRET_INTERN = '0123456789abcdef'.repeat(4)
const PAROLA = 'parola-de-test-fictiva'
const UID_O = '00000000-0000-4000-8000-0000000000a1'
const UID_U = '00000000-0000-4000-8000-0000000000a2'
// lista comunicată de SMSLink pe 03.11.2026, copiată din brief (sursă independentă de constanta din cod)
// r6: „acum” fixat în testele de UI (momentul alertei nu poate trece de el)
const ACUM_UI = Date.parse('2026-11-10T00:00:00Z')
const alerteUi = (st, acum = ACUM_UI) => alerteSmsSold(st, acum)
const momentUi = (st, acum = ACUM_UI) => momentAlertaSold(st, acum)
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
  it('IP din listă → procesat; în OBSERVARE jurnal „IP observat” (cu XFF pentru comparație), în STRICT nimic', async () => {
    for (const ip of LISTA_BRIEF) {
      const o = await rulareDlr({ 'cf-connecting-ip': ip, 'x-forwarded-for': `${ip}, 10.0.0.1` })
      expect(o.r.status).toBe(200)
      expect(o.sb.apeluri.map(([fn]) => fn)).toEqual(['fn_sms_dlr_aplica'])
      expect(o.avertismente).toEqual([['sms-dlr: IP observat', { ip, xff_prim: ip, motiv: 'ok', mod: 'observare' }]])
      const s = await rulareDlr({ 'cf-connecting-ip': ip }, { SMS_DLR_IP_STRICT: '1' })
      expect(s.r.status).toBe(200)
      expect(s.sb.apeluri).toHaveLength(1)
      expect(s.avertismente).toHaveLength(0)
    }
  })
  it('IP străin în OBSERVARE (implicit) → procesat + avertisment doar cu IP-ul validat, primul XFF și motivul', async () => {
    for (const env of [{}, { SMS_DLR_IP_STRICT: '0' }, { SMS_DLR_IP_STRICT: 'da' }]) {
      const { r, sb, avertismente } = await rulareDlr({ 'cf-connecting-ip': '203.0.113.9' }, env)
      expect(r.status).toBe(200)
      expect(sb.apeluri).toHaveLength(1)
      expect(avertismente).toEqual([['sms-dlr: IP in afara listei SMSLink', { ip: '203.0.113.9', xff_prim: null, motiv: 'ip_strain', mod: 'observare' }]])
    }
  })
  it('primul element XFF apare în jurnal doar dacă e IPv4 (altfel null), și nu decide nimic', async () => {
    const a = await rulareDlr({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': 'text <x>, 1.2.3.4' })
    expect(a.avertismente[0][1].xff_prim).toBeNull()
    const b = await rulareDlr({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': ' 146.70.213.194 ,10.0.0.1' })
    expect(b.avertismente[0][1]).toMatchObject({ ip: '203.0.113.9', xff_prim: '146.70.213.194', motiv: 'ip_strain' })
  })
  it('IP străin în STRICT (SMS_DLR_IP_STRICT=1) → 403, nimic scris', async () => {
    const { r, sb, avertismente } = await rulareDlr({ 'cf-connecting-ip': '146.70.213.196' }, { SMS_DLR_IP_STRICT: '1' })
    expect(r.status).toBe(403)
    expect(sb.apeluri).toHaveLength(0)
    expect(avertismente[0][1]).toEqual({ ip: '146.70.213.196', xff_prim: null, motiv: 'ip_strain', mod: 'blocare' })
  })
  it('antet lipsă: observare → procesat + avertisment antet_lipsa; strict → 403', async () => {
    const o = await rulareDlr({})
    expect(o.r.status).toBe(200)
    expect(o.avertismente[0][1]).toEqual({ ip: null, xff_prim: null, motiv: 'antet_lipsa', mod: 'observare' })
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
    expect(avertismente[0][1]).toEqual({ ip: null, xff_prim: null, motiv: 'ip_invalid', mod: 'observare' })
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
// fetch simulat cu Response REAL (status / ok / corp ca stream), ca la apelantul real
function fetchFals(raspuns) {
  const cereri = []
  const f = async (url, init) => {
    cereri.push({ url, init, body: JSON.parse(init.body) })
    if (raspuns instanceof Error) throw raspuns
    const corp = raspuns.text !== undefined ? raspuns.text : raspuns.json !== undefined ? JSON.stringify(raspuns.json) : null
    return new Response(corp, { status: raspuns.status ?? 200 })
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
  it('credit ca text zecimal → întreg tăiat în jos; 0 rămâne 0; response_type MESSAGE acceptat', async () => {
    expect(await citesteSold(envLink(), { fetch: fetchFals({ json: { credit: '149.90' } }) })).toEqual({ ok: true, credit: 149 })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ json: { credit: 0 } }) })).toEqual({ ok: true, credit: 0 })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ json: { response_type: 'MESSAGE', credit: 300 } }) })).toEqual({ ok: true, credit: 300 })
  })
  it('eroarea 7 (cu parola în response_message) → doar codul, parola nu apare nicăieri în rezultat', async () => {
    const r = await citesteSold(envLink(), { fetch: fetchFals({ json: { response_type: 'ERROR', response_id: 7, response_message: `Password '${PAROLA}' is not approved!` } }) })
    expect(r).toEqual({ ok: false, eroare: 'smslink_7' })
    expect(JSON.stringify(r)).not.toContain(PAROLA)
  })
  it('r2 (Jakarinos P2 / Copilot P2-03): HTTP non-2xx = eroare http_<status> chiar dacă JSON-ul are credit; response_type necunoscut = eroare', async () => {
    expect(await citesteSold(envLink(), { fetch: fetchFals({ status: 503, json: { response_type: 'UNKNOWN', credit: 1000 } }) })).toEqual({ ok: false, eroare: 'http_503' })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ status: 502, json: { credit: 500 } }) })).toEqual({ ok: false, eroare: 'http_502' })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ status: 200, json: { response_type: 'UNKNOWN', credit: 1000 } }) })).toEqual({ ok: false, eroare: 'smslink_raspuns' })
  })
  it('r2 (P3-04): corp peste MAX_RASPUNS_SOLD → eroare, nu se parsează', async () => {
    expect(MAX_RASPUNS_SOLD).toBe(4096)
    const mare = JSON.stringify({ credit: 999, umplutura: 'x'.repeat(5000) })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ text: mare }) })).toEqual({ ok: false, eroare: 'smslink_raspuns' })
  })
  it('răspunsuri neașteptate → eroare, NU credit 0 (lipsă, negativ, text, uriaș, non-JSON, listă, timeout)', async () => {
    for (const j of [{}, { credit: -5 }, { credit: 'mult' }, { credit: 1e9 }, { credit: null }, { response_type: 'ERROR', response_id: 'x' }, [1]]) {
      expect((await citesteSold(envLink(), { fetch: fetchFals({ json: j }) })).ok).toBe(false)
    }
    expect(await citesteSold(envLink(), { fetch: fetchFals({ text: 'nu e json' }) })).toEqual({ ok: false, eroare: 'smslink_raspuns' })
    expect(await citesteSold(envLink(), { fetch: fetchFals({ status: 502 }) })).toEqual({ ok: false, eroare: 'http_502' })
    expect(await citesteSold(envLink(), { fetch: fetchFals(new Error('timeout')) })).toEqual({ ok: false, eroare: 'retea_timeout' })
  })
  it('neconfigurat → eroare fără rețea; simulatorul nu are sold (r2 P2-01) și nu iese în rețea', async () => {
    const f = fetchFals({ json: { credit: 1 } })
    expect(await citesteSold(envLink({ SMSLINK_PASSWORD: undefined }), { fetch: f })).toEqual({ ok: false, eroare: 'smslink_neconfigurat' })
    expect(await citesteSold(k => (k === 'SMS_FURNIZOR' ? 'twilio' : undefined), { fetch: f })).toEqual({ ok: false, eroare: 'furnizor_neconfigurat' })
    expect(await citesteSold(k => (k === 'SMS_FURNIZOR' ? 'simulator' : undefined), { fetch: f })).toEqual({ ok: false, simulator: true })
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
        : { data: { credit: args.p_credit, prag: 150, sub_prag: args.p_credit != null && args.p_credit < 150, scris: true }, error: null }
      return { data: null, error: { code: '42883' } }
    },
    caUtilizator: jwt => ({ rpc: async fn => { apeluri.push(['utilizator:' + fn, jwt]); return fn === 'fn_sms_nivel' ? { data: nivel, error: null } : { data: null, error: { code: '42501' } } } }),
  }
}
const ACUM = Date.parse('2026-11-04T05:10:00Z')
const depsSold = (sb, o = {}) => ({ sb, sbUtilizator: sb.caUtilizator, env: envLink(o.env), fetch: o.fetch ?? fetchFals({ json: { credit: 120 } }), acum: () => ACUM })
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
  it('cronul → citește creditul și îl scrie cu momentul de START al citirii (CAS în BD, r2 P2-04)', async () => {
    const sb = sbSold()
    const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sb))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, apelant: 'cron', furnizor: 'smslink', credit: 120, scris: true, prag: 150, sub_prag: true })
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sold_sms_inregistreaza'))
      .toEqual([['fn_sold_sms_inregistreaza', { p_credit: 120, p_eroare: null, p_inceput: '2026-11-04T05:10:00.000Z', p_furnizor: 'smslink' }]])
  })
  it('r2/r3 P2-01: simulatorul → fără sold și fără eroare; se scrie DOAR furnizorul curent; { furnizor: simulator, sold: null }', async () => {
    const sb = sbSold(), f = fetchFals({ json: { credit: 1 } })
    const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sb, { env: { SMS_FURNIZOR: 'simulator' }, fetch: f }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, apelant: 'cron', furnizor: 'simulator', sold: null })
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sold_sms_inregistreaza'))
      .toEqual([['fn_sold_sms_inregistreaza', { p_credit: null, p_eroare: null, p_inceput: '2026-11-04T05:10:00.000Z', p_furnizor: 'simulator' }]])
    expect(f.cereri).toHaveLength(0)
    // furnizorul nescris → 500 (nu „ok”)
    const r2 = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sbSold({ eroareRpc: true }), { env: { SMS_FURNIZOR: 'simulator' } }))
    expect(r2.status).toBe(500)
  })
  it('r4 P3-01: SMS_FURNIZOR lipsă / necunoscut → nicio cerere spre SMSLink, furnizorul în BD = necunoscut (nu smslink), eroarea furnizor_neconfigurat', async () => {
    for (const valoare of [undefined, 'twilio']) {
      const sb = sbSold(), f = fetchFals({ json: { credit: 1 } })
      const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sb, { env: { SMS_FURNIZOR: valoare }, fetch: f }))
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ ok: false, furnizor: 'necunoscut', eroare: 'furnizor_neconfigurat' })
      expect(sb.apeluri.filter(([fn]) => fn === 'fn_sold_sms_inregistreaza'))
        .toEqual([['fn_sold_sms_inregistreaza', { p_credit: null, p_eroare: 'furnizor_neconfigurat', p_inceput: '2026-11-04T05:10:00.000Z', p_furnizor: 'necunoscut' }]])
      expect(f.cereri).toHaveLength(0)
    }
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
    expect(sb.apeluri.filter(([fn]) => fn === 'fn_sold_sms_inregistreaza'))
      .toEqual([['fn_sold_sms_inregistreaza', { p_credit: null, p_eroare: 'smslink_7', p_inceput: '2026-11-04T05:10:00.000Z', p_furnizor: 'smslink' }]])
  })
  it('RPC-ul de scriere eșuează → 500 (nu „ok”)', async () => {
    const r = await sold(postSold({ 'x-intern-secret': SECRET_INTERN }), depsSold(sbSold({ eroareRpc: true })))
    expect(r.status).toBe(500)
  })
})

// ── UI: textul din panou și alerta din Administrator ──────────────────────────────────────────────────────────────────────
describe('soldul în UI', () => {
  it('panoul owner-ului: „Sold SMSLink: N (la ZZ.LL HH:MM)” în ora României; vechi = „neactualizat”; simulator explicit', () => {
    expect(textSold({ credit: 842, citit_la: '2026-11-04T05:10:30Z' })).toBe('Sold SMSLink: 842 (la 04.11 07:10)')
    expect(textSold({ credit: 842, citit_la: '2026-11-04T05:10:30Z', citire_veche: true })).toBe('Sold SMSLink: 842 (la 04.11 07:10) · neactualizat')
    expect(textSold({ credit: null, citit_la: null })).toBe('Sold SMSLink: încă necitit')
    expect(textSold(null)).toBe('Sold SMSLink: —')
    expect(textSold(null, { simulator: true })).toBe('simulator — sold SMSLink necitit')
    expect(textSold({ simulator: true, credit: 120, citit_la: '2026-11-04T05:10:00Z', sub_prag: false })).toBe('simulator — sold SMSLink necitit (ultimul cunoscut: 120 la 04.11 07:10)')
  })
  it('Administrator → Alerte: sursa e doar a owner-ului; alerta apare doar când BD-ul spune alerta', () => {
    const s = SURSE_ADMIN.find(x => x.id === 'sms_sold')
    expect(s).toMatchObject({ ownerOnly: true, path: '/admin?tab=sms' })
    expect(areAccesSursa({ id: 'x', is_owner: false, module_access: ['admin_alerte', 'sms'] }, s)).toBe(false)
    expect(areAccesSursa({ id: 'o', is_owner: true, module_access: ['admin_alerte'] }, s)).toBe(true)
    expect(alerteUi({ credit: 900, alerta: false, prag: 150 })).toEqual([])
    expect(alerteUi(null)).toEqual([])
    const [sub] = alerteUi({ credit: 120, prag: 150, sub_prag: true, alerta: true, citit_la: '2026-11-04T05:10:00Z' })
    expect(sub).toMatchObject({ id: 'sms_sold:sold', priority: 'week' })
    expect(sub.title).toBe('Sold SMSLink sub prag (150): sold 120 SMS (la 04.11.2026, 07:10)')
    expect(alerteUi({ credit: 0, prag: 150, sub_prag: true, alerta: true })[0].priority).toBe('critical')
    expect(alerteUi({ credit: 500, prag: 150, eroare_dupa_citire: true, eroare: 'smslink_7', alerta: true })[0]).toMatchObject({ priority: 'missing', title: 'Soldul SMSLink nu s-a putut citi (smslink_7)' })
    expect(alerteUi({ credit: null, prag: 150, citire_veche: true, alerta: true })[0]).toMatchObject({ reference: 'Nicio citire reușită încă', title: 'Soldul SMSLink nu a fost citit încă' })
  })
  it('r2 P2-07: sub prag + vechi + eroare → O alertă cu TOATE motivele, „ultimul sold cunoscut”, ora = eroarea (mai nouă)', () => {
    const [a] = alerteUi({ credit: 120, prag: 150, sub_prag: true, citire_veche: true, eroare_dupa_citire: true, eroare: 'http_502',
      alerta: true, citit_la: '2026-10-30T05:10:00Z', eroare_la: '2026-11-04T05:10:00Z' })
    // r6 (Copilot r5 P2-02): soldul e neactualizat → titlul e eroarea, „sub prag” doar ca ultimul sold cunoscut, fără reîncărcare
    expect(a.title).toBe('Soldul SMSLink nu s-a putut citi (http_502)')
    expect(a.priority).toBe('missing')
    expect(a.impact).toContain('Ultimul sold cunoscut era sub prag (120 < 150)')
    expect(a.impact).not.toContain('Reîncarcă creditul')
    expect(a.impact).toContain('Ultima încercare a eșuat (http_502')
    expect(a.impact).toContain('05:10 UTC = 07:10 iarna / 08:10 vara')
    expect(a.timestamp).toBe('2026-11-04T05:10:00.000Z')
    expect(a.reference).toBe('Ultimul sold cunoscut 120 SMS (la 30.10.2026, 07:10)')
  })
  it('r6 P2-01 (scenariul Jakarinos): citire 01.11 05:10Z + eroare 04.11 05:10Z → momentul = 04.11 05:10Z, niciodată în viitor', () => {
    const st = { credit: 400, prag: 150, citire_veche: true, eroare_dupa_citire: true, eroare: 'http_502', alerta: true,
      citit_la: '2026-11-01T05:10:00Z', eroare_la: '2026-11-04T05:10:00Z', furnizor_ultim: 'smslink', furnizor_la: '2026-11-04T05:10:00Z' }
    const acum = Date.parse('2026-11-04T06:00:00Z')
    expect(momentAlertaSold(st, acum)).toBe('2026-11-04T05:10:00.000Z')
    expect(alerteSmsSold(st, acum)[0].timestamp).toBe('2026-11-04T05:10:00.000Z')
    // doar citire veche: citit_la + 36 h; dacă acel moment e încă în viitor, motivul nu e activ → nu trece de „acum”
    const veche = { citire_veche: true, citit_la: '2026-11-03T05:10:00Z', alerta: true }
    expect(momentAlertaSold(veche, Date.parse('2026-11-10T00:00:00Z'))).toBe('2026-11-04T17:10:00.000Z')
    expect(Date.parse(momentAlertaSold(veche, Date.parse('2026-11-04T06:00:00Z')))).toBeLessThanOrEqual(Date.parse('2026-11-04T06:00:00Z'))
    // monitorizare oprită: max(furnizor_la, citit_la) + 36 h, limitat la acum
    const op = { monitorizare_oprita: true, citire_veche: true, citit_la: '2026-11-01T05:10:00Z', furnizor_la: '2026-11-03T05:10:00Z', alerta: true }
    expect(momentAlertaSold(op, Date.parse('2026-11-10T00:00:00Z'))).toBe('2026-11-04T17:10:00.000Z')
    for (const acumT of [Date.parse('2026-11-04T06:00:00Z'), Date.parse('2026-11-02T00:00:00Z')]) {
      expect(Date.parse(momentAlertaSold(op, acumT))).toBeLessThanOrEqual(acumT)
    }
  })
  it('r6 P2-02: sold sub prag dar neactualizat (citire veche / eroare / monitorizare oprită) → nu critic, fără reîncărcare; actualizat → critic la 0', () => {
    const baza = { credit: 0, prag: 150, sub_prag: true, alerta: true, citit_la: '2026-11-01T05:10:00Z' }
    for (const extra of [{ citire_veche: true }, { eroare_dupa_citire: true, eroare: 'http_502', eroare_la: '2026-11-02T05:10:00Z' },
      { monitorizare_oprita: true, citire_veche: true, furnizor_la: '2026-11-02T05:10:00Z' }]) {
      const [a] = alerteUi({ ...baza, ...extra })
      expect(a.priority).toBe('missing')
      expect(a.impact).not.toContain('Reîncarcă creditul')
      expect(a.impact).toContain('Ultimul sold cunoscut era sub prag (0 < 150)')
      expect(a.title.startsWith('Sold SMSLink sub prag')).toBe(false)
    }
    const [activ] = alerteUi(baza)
    expect(activ).toMatchObject({ priority: 'critical', title: 'Sold SMSLink sub prag (150): sold 0 SMS (la 01.11.2026, 07:10)' })
    expect(activ.impact).toContain('Reîncarcă creditul')
  })
  it('r4 P2: simulator neconfirmat de 36 h (BD: simulator=false, monitorizare_oprita) → alertă „monitorizare oprită”, ora = max(furnizor_la, citit_la) + 36 h', () => {
    const [a] = alerteUi({ credit: 900, prag: 150, citire_veche: true, monitorizare_oprita: true, simulator: false, alerta: true,
      citit_la: '2026-10-20T05:10:00Z', furnizor_ultim: 'simulator', furnizor_la: '2026-10-25T05:10:00Z' })
    expect(a.title).toBe('Monitorizarea soldului SMSLink e oprită (niciun apel sms-sold de peste 36 de ore); ultimul sold cunoscut 900 SMS (la 20.10.2026, 08:10)')
    expect(a.timestamp).toBe('2026-10-26T17:10:00.000Z')
    expect(a.impact).toContain('Ultimul apel sms-sold: 25.10.2026, 07:10 (simulator)')
    expect(a.reference).toBe('Ultimul sold cunoscut 900 SMS (la 20.10.2026, 08:10)')
  })
  it('r5 P2-01: simulator expirat (BD: simulator=false, monitorizare_oprita, sub_prag pe soldul istoric) → nu e sold activ, nu cere reîncărcare', () => {
    const st = { credit: 120, prag: 150, sub_prag: true, citire_veche: true, monitorizare_oprita: true, simulator: false, alerta: true,
      citit_la: '2026-11-01T05:10:00Z', furnizor_ultim: 'simulator', furnizor_la: '2026-11-02T05:10:00Z' }
    const [a] = alerteUi(st)
    expect(a.title).toBe('Monitorizarea soldului SMSLink e oprită (niciun apel sms-sold de peste 36 de ore); ultimul sold cunoscut 120 SMS (la 01.11.2026, 07:10)')
    expect(a.priority).toBe('missing')
    expect(a.impact).not.toContain('Reîncarcă creditul')
    expect(a.impact).toContain('Ultimul sold cunoscut era sub prag (120 < 150)')
    expect(a.timestamp).toBe('2026-11-03T17:10:00.000Z')
    expect(textSold(st)).toBe('Sold SMSLink: monitorizare oprită (ultimul furnizor: simulator); ultimul sold cunoscut: 120 la 01.11 07:10')
    expect(textSold({ ...st, credit: null, citit_la: null })).toBe('Sold SMSLink: monitorizare oprită (ultimul furnizor: simulator); niciun sold cunoscut')
  })
  it('r5 P2-02 / Jakarinos P3: eroare veche (înaintea ultimului apel simulator) + monitorizare oprită → momentul = expirarea, nu eroarea veche', () => {
    // citire 01.11, eroare SMSLink 02.11, apeluri simulator până la 03.11, apoi cronul oprit
    const st = { credit: 500, prag: 150, citire_veche: true, monitorizare_oprita: true, eroare_dupa_citire: true, eroare: 'http_502', alerta: true,
      citit_la: '2026-11-01T05:10:00Z', eroare_la: '2026-11-02T05:10:00Z', furnizor_ultim: 'simulator', furnizor_la: '2026-11-03T05:10:00Z' }
    expect(momentUi(st)).toBe('2026-11-04T17:10:00.000Z')
    const [a] = alerteUi(st)
    expect(a.timestamp).toBe('2026-11-04T17:10:00.000Z')
    expect(a.title.startsWith('Monitorizarea soldului SMSLink e oprită')).toBe(true)
    // eroarea MAI NOUĂ decât expirarea câștigă
    expect(momentUi({ ...st, eroare_la: '2026-11-06T05:10:00Z' })).toBe('2026-11-06T05:10:00.000Z')
    // doar eroare (monitorizare activă) = momentul erorii
    expect(momentUi({ eroare_dupa_citire: true, eroare_la: '2026-11-04T06:00:00Z', citit_la: '2026-11-04T05:10:00Z' })).toBe('2026-11-04T06:00:00.000Z')
  })
  it('r5 P3-01: furnizor neconfigurat are prioritate în titlu chiar dacă ultimul sold cunoscut e sub prag', () => {
    const [a] = alerteUi({ credit: 100, prag: 150, sub_prag: true, eroare_dupa_citire: true, eroare: 'furnizor_neconfigurat', alerta: true,
      citit_la: '2026-11-03T05:10:00Z', eroare_la: '2026-11-04T05:10:00Z', furnizor_ultim: 'necunoscut', furnizor_neconfigurat: true })
    expect(a.title).toBe('SMS: furnizorul nu e configurat (SMS_FURNIZOR) — soldul SMSLink nu se citește')
    expect(a.priority).toBe('missing')
    expect(a.impact).not.toContain('Reîncarcă creditul')
    expect(a.reference).toBe('Ultimul sold cunoscut 100 SMS (la 03.11.2026, 07:10)')
  })
  it('r4 P3-01: furnizor neconfigurat → alertă de configurare (nu sold SMSLink activ); panoul spune „furnizor neconfigurat”', () => {
    const st = { credit: 500, prag: 150, citit_la: '2026-11-04T05:10:00Z', eroare: 'furnizor_neconfigurat', eroare_la: '2026-11-04T06:10:00Z',
      eroare_dupa_citire: true, alerta: true, furnizor_ultim: 'necunoscut', furnizor_neconfigurat: true, simulator: false }
    const [a] = alerteUi(st)
    expect(a.title).toBe('SMS: furnizorul nu e configurat (SMS_FURNIZOR) — soldul SMSLink nu se citește')
    expect(a.impact).toContain('SMS_FURNIZOR lipsește sau are o valoare necunoscută')
    expect(a.timestamp).toBe('2026-11-04T06:10:00.000Z')
    expect(textSold(st)).toBe('Sold SMSLink: furnizor neconfigurat (SMS_FURNIZOR) · ultimul cunoscut: 500 la 04.11 07:10')
  })
  it('r3 P3-01: cronul oprit (citire veche, fără eroare nouă) → ora alertei = citit_la + 36 h, nu ora ultimei citiri', () => {
    const [a] = alerteUi({ credit: 900, prag: 150, citire_veche: true, alerta: true, citit_la: '2026-10-25T05:10:00Z' })
    expect(a.timestamp).toBe('2026-10-26T17:10:00.000Z')
    expect(a.title).toBe('Soldul SMSLink nu a mai fost citit de peste 36 de ore')
    expect(a.reference).toBe('Ultimul sold cunoscut 900 SMS (la 25.10.2026, 07:10)')
  })
  it('r3 P2-01: comutare SMSLink → simulator, fără click: nici alertă (chiar dacă BD ar marca sub prag), iar panoul arată „ultimul cunoscut”', async () => {
    const randSim = { id: true, credit: 120, prag: 150, sub_prag: false, alerta: false, citire_veche: false, eroare_dupa_citire: false,
      citit_la: '2026-11-04T05:10:00Z', furnizor_ultim: 'simulator', furnizor_la: '2026-11-04T06:00:00Z', simulator: true }
    expect(alerteUi(randSim)).toEqual([])
    expect(alerteUi({ ...randSim, sub_prag: true, alerta: true })).toEqual([])
    const client = { from: () => { const q = { select: () => q, order: () => q, range: () => q, abortSignal: async () => ({ data: [randSim], error: null, count: 1 }) }; return q } }
    const r = await incarcaSursaAdmin(client, SURSE_ADMIN.find(x => x.id === 'sms_sold'), { id: 'o', is_owner: true, module_access: ['admin_alerte'] })
    expect(r).toMatchObject({ state: 'ok', rows: [] })
    expect(textSold(randSim)).toBe('simulator — sold SMSLink necitit (ultimul cunoscut: 120 la 04.11 07:10)')
  })
  it('sursa citește vederea v_sms_sold (fără rpc), cu proiecția explicită; 42501 din BD → „Acces insuficient”', async () => {
    const cereri = []
    const client = rand => ({ from: t => { const q = { select: (c, o) => { cereri.push([t, c, o]); return q }, order: () => q, range: () => q,
      abortSignal: async () => (rand instanceof Error ? { data: null, error: rand, count: null } : { data: [rand], error: null, count: 1 }) }; return q } })
    const owner = { id: 'o', is_owner: true, module_access: ['admin_alerte'] }
    const s = SURSE_ADMIN.find(x => x.id === 'sms_sold')
    const r = await incarcaSursaAdmin(client({ id: true, credit: 80, prag: 150, sub_prag: true, alerta: true, citit_la: '2026-11-04T05:10:00Z' }), s, owner)
    expect(r.state).toBe('ok')
    expect(r.rows.map(x => x.id)).toEqual(['sms_sold:sold'])
    expect(cereri[0]).toEqual(['v_sms_sold', 'id,credit,citit_la,eroare,eroare_la,prag,sub_prag,citire_veche,eroare_dupa_citire,alerta,furnizor_ultim,furnizor_la,simulator,monitorizare_oprita,furnizor_neconfigurat', { count: 'exact' }])
    const e = Object.assign(new Error('doar owner'), { code: '42501' })
    expect((await incarcaSursaAdmin(client(e), s, owner)).state).toBe('denied')
  })
})
