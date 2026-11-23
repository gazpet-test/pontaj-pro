// F2b (18.11.2026): trimiterea din redari@ — testele JS ale gărzilor și ale ordinii lor (fără rețea, fără BD):
//  * garda „doar TEST” în funcția edge: un lot al unui proiect REAL e refuzat (423) ÎNAINTE de secret, de refresh și de orice apel; mutanții
//    (garda scoasă / flag-ul oprit / proiectul „test-” cu minuscule) sunt prinși; paritatea cu garda FAN (aceeași convenție TEST-);
//  * wrapperul HTTP cu listă închisă: orice metodă / cale / gazdă / grant_type / scop în afara listei = refuz fără fetch; secretele clientului
//    doar în wrapper; modulul de trimitere nu poate cere schimbul codului sau revocarea;
//  * OAuth: state generat / consumat o singură dată (prin RPC), căsuța greșită / scope diferit / id_token invalid → revocare + nimic salvat;
//    id_token validat local pe o cheie RSA generată în test (semnătură bună / rea, aud, exp, email, hd);
//  * MIME: diacritice în subiect / corp, atașament PDF, un singur To; comutatoarele oprite: comportament neschimbat (409 înaintea secretului);
//  * runda 2 (Jakarinos #1134): id_token malformat („A.A.A”, base64 / JSON stricat) = refuz controlat + revocarea grantului + eveniment, fără excepție;
//    rezultatul RPC-ului de persistare diferit de `true` = neconfirmat: oprire, recitirea stării din server, nimic contorizat „trimis”, un singur send;
//  * dovada pe main: handlerul de pe main (git show) refuză lotul de TEST cu 423 transport_real_oprit; cel nou îl lasă să treacă până la secret.
import { describe, it, expect, vi, afterAll } from 'vitest'
import { webcrypto } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { raspundeTrimitere, SECRET_TRIMITERE } from '../../supabase/functions/_shared/redariMailF2Handler.mjs'
import { raspundeOauth } from '../../supabase/functions/_shared/redariMailOauthHandler.mjs'
import { creeazaGmailHttp, GAZDA_GMAIL, GAZDA_OAUTH, GAZDA_JWKS, MAPARE_SCOPURI } from '../../supabase/functions/_shared/gmailHttp.mjs'
import { scopuriCanonice, scopuriExacte, valideazaIdToken, urlAutorizare, genereazaState, sha256Hex, REDIRECT_URI_TRIMITERE } from '../../supabase/functions/_shared/gmailOauthTrimitere.mjs'
import { reimprospateaza, base64Url } from '../../supabase/functions/_shared/gmailTrimitere.mjs'
import { esteProiectTest as esteProiectTestFan, PREFIX_PROIECT_TEST as PREFIX_FAN } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST, PREFIX_PROIECT_TEST, esteProiectTest, transportPermis, hashMesaj, compuneMime, gardaTrimitere } from './mailLoturi.js'
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })

const id = '00000000-0000-4000-8000-000000000001', uid = '00000000-0000-4000-8000-0000000000aa'
const lot = () => ({ id, proiect_id: id, uat_id: id, stare: 'aprobat', versiune: 2, aprobat_de: uid, aprobat_la: new Date().toISOString(), lot_sha256: 'a'.repeat(64), aprobat_lot_sha256: 'a'.repeat(64) })
const mesaj = () => ({ id, lot_id: id, catre: 'coleg.fictiv@gazpet.ro', subiect_final: 'Convocare fictivă — Țară', corp_text_final: 'Bună ziua,\nText fictiv cu ă î ș ț.', corp_html_final: null, message_id: `<${id}@gazpet.ro>`, stare: 'rezervat', lease_token: 'tok-1' })
const ENV = { REDARI_GMAIL_TRIMITERE_CLIENT_ID: 'client-fictiv.apps', REDARI_GMAIL_TRIMITERE_CLIENT_SECRET: 'secret-fictiv' }
const env = n => ENV[n]
const raspuns = (status, body) => ({ status, ok: status < 300, json: async () => body })
const SETARI_OK = { trimitere_oprita: false, extern_permis: false, doar_proiecte_test: true, trimitere_conectata_la: '2026-11-18T10:00:00Z', trimitere_casuta: 'redari@gazpet.ro', pauza_pana: null, versiune: 5 }

/** dependențele handlerului de trimitere, toate spioni; proiectul = TEST implicit */
function deps(o = {}) {
  const fetchSpy = vi.fn(async (url, init) => {
    if (url === GAZDA_OAUTH + '/token') return raspuns(200, { access_token: 'at-fictiv', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email', token_type: 'Bearer' })
    if (url === GAZDA_GMAIL + '/gmail/v1/users/me/messages/send') return raspuns(200, { id: 'gm-1', threadId: 'th-1' })
    return raspuns(404, {})
  })
  const d = {
    getUser: vi.fn(async () => ({ data: { user: { id: uid } } })), owner: vi.fn(async () => ({ data: true })),
    lot: vi.fn(async () => ({ data: lot() })), proiect: vi.fn(async () => ({ data: { id, cod: 'TEST-RAZVAN' } })),
    setari: vi.fn(async () => ({ data: { ...SETARI_OK } })), informare: vi.fn(async () => ({ data: true })),
    secret: vi.fn(async () => ({ data: 'refresh-fictiv' })),
    http: vi.fn(() => creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env, fetch: fetchSpy })),
    opreste: vi.fn(async () => ({ data: true })),
    rezerva: vi.fn(), incepe: vi.fn(async () => ({ data: true })), rezultat: vi.fn(async () => ({ data: true })),
    descarca: vi.fn(), pauza: vi.fn(async () => {}), fetchSpy,
  }
  let n = 0
  d.rezerva.mockImplementation(async () => { n++; if (n === 1) { const m = mesaj(); m.mesaj_sha256 = await hashMesaj(m); return { data: [m] } } return { data: [] } })
  return Object.assign(d, o)
}
const dupaSecret = d => [d.secret, d.http, d.fetchSpy, d.rezerva, d.incepe, d.rezultat, d.descarca]
const nimicDupaSecret = d => { for (const f of dupaSecret(d)) expect(f).not.toHaveBeenCalled() }

describe('F2b: garda „doar TEST” înaintea secretelor și a rețelei', () => {
  it('flag-urile din cod: transport pornit, doar proiecte TEST', () => { expect(TRANSPORT_REAL_ACTIV).toBe(true); expect(DOAR_PROIECTE_TEST).toBe(true); expect(PREFIX_PROIECT_TEST).toBe('TEST-') })
  it.each([[null], [undefined], [''], ['test-razvan'], ['LOT1-REAL'], [' TEST-X'], ['TEST']])('proiectul %j e real: 423 transport_real_doar_test, fără secret / refresh / rezervare', async cod => {
    const d = deps({ proiect: vi.fn(async () => ({ data: cod === null ? null : { id, cod } })) })
    const r = await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)
    expect(r.status).toBe(423); expect(r.body.cod).toBe('transport_real_doar_test'); expect(r.body.motiv).toContain('TEST-')
    nimicDupaSecret(d); expect(d.setari).not.toHaveBeenCalled()
  })
  it('citirea proiectului eșuată nu e „proiect real”: 503, nimic după', async () => {
    const d = deps({ proiect: vi.fn(async () => ({ error: { message: 'x' } })) })
    expect((await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)).status).toBe(503); nimicDupaSecret(d)
  })
  it('proiectul TEST trece garda și ajunge la secret → refresh → rezervare → send → rezultat, în această ordine', async () => {
    const d = deps()
    const r = await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ cod: 'rulat', trimise: 1, esuate: 0, necunoscute: 0, rezervate: 1 })
    expect(d.secret).toHaveBeenCalledWith(uid)
    const ordine = [d.proiect, d.setari, d.secret, d.rezerva, d.incepe, d.rezultat].map(f => f.mock.invocationCallOrder[0])
    expect([...ordine].sort((a, b) => a - b)).toEqual(ordine)
    // refresh-ul ÎNAINTEA primei rezervări (nimic in_apel fără token); send-ul după apel_incepe
    expect(d.fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(d.rezerva.mock.invocationCallOrder[0])
    expect(d.fetchSpy.mock.calls[0][0]).toBe(GAZDA_OAUTH + '/token'); expect(d.fetchSpy.mock.calls[1][0]).toBe(GAZDA_GMAIL + '/gmail/v1/users/me/messages/send')
    expect(d.fetchSpy.mock.invocationCallOrder[1]).toBeGreaterThan(d.incepe.mock.invocationCallOrder[0])
    expect(d.rezultat).toHaveBeenCalledWith(id, 'tok-1', 'trimis', 'gm-1', 'th-1')
    // corpul Gmail: raw base64url al MIME-ului; antetul Authorization cu tokenul de acces, client_secret nicăieri
    const send = d.fetchSpy.mock.calls[1][1]
    expect(send.headers.Authorization).toBe('Bearer at-fictiv'); expect(JSON.parse(send.body).raw).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.stringify(d.fetchSpy.mock.calls[1])).not.toContain('secret-fictiv')
    const token = d.fetchSpy.mock.calls[0][1].body
    expect(token).toContain('grant_type=refresh_token'); expect(token).toContain('client_id=client-fictiv.apps'); expect(token).toContain('refresh_token=refresh-fictiv')
  })
  it('paritate cu garda FAN: aceeași convenție TEST- pe același tabel de cazuri', () => {
    expect(PREFIX_PROIECT_TEST).toBe(PREFIX_FAN)
    for (const cod of ['TEST-RAZVAN', 'TEST-', 'test-razvan', 'LOT1', '', null, undefined, ' TEST-A', 'TEST']) expect(esteProiectTest(cod)).toBe(esteProiectTestFan(cod))
  })
  it('transportPermis: aceeași decizie ca în ecran', () => {
    expect(transportPermis({ proiectCod: 'TEST-RAZVAN' })).toEqual({ ok: true, cod: null, motiv: '' })
    expect(transportPermis({ proiectCod: 'LOT1' }).cod).toBe('transport_real_doar_test')
    expect(transportPermis({ proiectCod: 'TEST-RAZVAN', transportActiv: false }).cod).toBe('transport_real_oprit')
    expect(transportPermis({ proiectCod: 'LOT1', doarTest: false }).ok).toBe(true)
  })
})

describe('F2b: comutatoarele oprite — comportament neschimbat, 409 înaintea secretului', () => {
  it.each([
    [{ trimitere_oprita: true }, 'trimitere_oprita'], [{ trimitere_conectata_la: null }, 'casuta_neconectata'], [null, 'trimitere_oprita'],
  ])('setări %j → %s', async (s, cod) => {
    const d = deps({ setari: vi.fn(async () => ({ data: s ? { ...SETARI_OK, ...s } : null })) })
    const r = await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)
    expect(r).toEqual({ status: 409, body: { cod, trimise: 0 } }); nimicDupaSecret(d)
  })
  it('informare nepublicată / lot neaprobat / expirat / hash diferit → 409, nimic după', async () => {
    for (const [o, cod] of [[{ informare: vi.fn(async () => ({ data: false })) }, 'informare_nepublicata'],
      [{ lot: vi.fn(async () => ({ data: { ...lot(), stare: 'ciorna' } })) }, 'lot_neaprobat'],
      [{ lot: vi.fn(async () => ({ data: { ...lot(), aprobat_la: '2026-11-01T00:00:00Z' } })) }, 'aprobare_expirata'],
      [{ lot: vi.fn(async () => ({ data: { ...lot(), aprobat_lot_sha256: 'b'.repeat(64) } })) }, 'lot_integritate']]) {
      const d = deps(o)
      expect((await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: id } }, d)).body.cod).toBe(cod); nimicDupaSecret(d)
    }
  })
  it('identitatea: fără JWT 401; getUser 5xx 503; non-owner 403; uid / rol din corp ignorate; lot invizibil 404', async () => {
    let d = deps(); expect((await raspundeTrimitere({ jwt: '', corp: { lot_id: id } }, d)).status).toBe(401); expect(d.getUser).not.toHaveBeenCalled()
    d = deps({ getUser: vi.fn(async () => ({ error: { status: 503 } })) }); expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).status).toBe(503)
    d = deps({ getUser: vi.fn(async () => ({ error: { status: 401 } })) }); expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).status).toBe(401)
    d = deps({ owner: vi.fn(async () => ({ data: false })) }); expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id, is_owner: true, uid } }, d)).status).toBe(403); expect(d.lot).not.toHaveBeenCalled()
    d = deps({ lot: vi.fn(async () => ({ data: null })) }); expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).status).toBe(404); expect(d.proiect).not.toHaveBeenCalled()
  })
  it('secretul lipsă (căsuța neconectată în BD) → 409; RPC-ul secretului eșuat → 503; fără refresh', async () => {
    let d = deps({ secret: vi.fn(async () => ({ data: null })) })
    expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).body.cod).toBe('casuta_neconectata'); expect(d.fetchSpy).not.toHaveBeenCalled()
    d = deps({ secret: vi.fn(async () => ({ error: { message: 'x' } })) })
    expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).status).toBe(503); expect(d.fetchSpy).not.toHaveBeenCalled()
  })
  it('refresh respins (invalid_grant) ÎNAINTEA rezervării: trimiterea se oprește din BD, 409, nicio rezervare', async () => {
    const d = deps(); d.fetchSpy.mockImplementation(async () => raspuns(400, { error: 'invalid_grant' }))
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.body.cod).toBe('token_respins'); expect(r.status).toBe(409); expect(d.opreste).toHaveBeenCalledTimes(1); expect(d.rezerva).not.toHaveBeenCalled()
  })
  it('refresh cu scope diferit → oprire + 409; refresh 5xx → 503 fără oprire; nicio rezervare', async () => {
    let d = deps(); d.fetchSpy.mockImplementation(async () => raspuns(200, { access_token: 'x', scope: 'https://www.googleapis.com/auth/gmail.modify openid email' }))
    expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).body.cod).toBe('scope_diferit'); expect(d.opreste).toHaveBeenCalled(); expect(d.rezerva).not.toHaveBeenCalled()
    d = deps(); d.fetchSpy.mockImplementation(async () => raspuns(503, {}))
    expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d))).toMatchObject({ status: 503, body: { cod: 'token_neconfirmat' } }); expect(d.opreste).not.toHaveBeenCalled()
  })
  it('rezultat ambiguu (5xx la send) = necunoscut, bucla se oprește, niciun al doilea send', async () => {
    const d = deps(); d.fetchSpy.mockImplementation(async url => url.endsWith('/token') ? raspuns(200, { access_token: 'at', scope: 'https://www.googleapis.com/auth/gmail.send openid email' }) : raspuns(502, {}))
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.body).toMatchObject({ cod: 'rezultat_ambiguu', necunoscute: 1, trimise: 0 })
    expect(d.fetchSpy.mock.calls.filter(c => c[0].endsWith('/send')).length).toBe(1); expect(d.rezultat).toHaveBeenCalledWith(id, 'tok-1', 'necunoscut', null, null)
    expect(d.rezerva).toHaveBeenCalledTimes(1)
  })
  it('apel_incepe false (CAS pierdut / oprire între timp): niciun send', async () => {
    const d = deps({ incepe: vi.fn(async () => ({ data: false })) })
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.body.sarite).toBe(1); expect(d.fetchSpy.mock.calls.some(c => c[0].endsWith('/send'))).toBe(false)
  })
  // runda 2 (Jakarinos #1134 P2): rezultatul RPC-ului de persistare diferit de `true` = NECONFIRMAT
  it.each([[{ data: false }], [{ data: null }], [{ data: 'true' }], [{}]])('persistarea cu răspunsul RPC %j: NU e trimis, oprire, recitirea stării, un singur send, fără a doua rezervare', async w => {
    const d = deps({ rezultat: vi.fn(async () => w), mesaj: vi.fn(async () => ({ data: { id, stare: 'necunoscut', eroare_cod: 'lease_expirat' } })) })
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ cod: 'persistare_neconfirmata', trimise: 0, esuate: 0, necunoscute: 0, neconfirmate: 1, rezervate: 1, mesaj_id: id, stare_server: 'necunoscut', rezultat_send: 'trimis' })
    expect(d.fetchSpy.mock.calls.filter(c => c[0].endsWith('/send')).length).toBe(1)
    expect(d.rezultat).toHaveBeenCalledTimes(1); expect(d.rezerva).toHaveBeenCalledTimes(1); expect(d.mesaj).toHaveBeenCalledWith(id); expect(d.pauza).not.toHaveBeenCalled()
  })
  it('persistarea neconfirmată cu recitirea eșuată / lipsă: stare_server = necitita, tot neconfirmat', async () => {
    let d = deps({ rezultat: vi.fn(async () => ({ data: false })), mesaj: vi.fn(async () => ({ error: { message: 'x' } })) })
    expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).body).toMatchObject({ cod: 'persistare_neconfirmata', neconfirmate: 1, trimise: 0, stare_server: 'necitita' })
    d = deps({ rezultat: vi.fn(async () => ({ data: false })) }); delete d.mesaj
    expect((await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)).body).toMatchObject({ cod: 'persistare_neconfirmata', neconfirmate: 1, trimise: 0, stare_server: 'necitita' })
  })
  it('persistarea care aruncă de 3 ori (RPC cu eroare): neconfirmat fără rezultatul send-ului, un singur send, recitire', async () => {
    const d = deps({ rezultat: vi.fn(async () => ({ error: { message: 'x' } })), mesaj: vi.fn(async () => ({ data: { id, stare: 'in_apel' } })) })
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.body).toMatchObject({ cod: 'persistare_neconfirmata', necunoscute: 0, trimise: 0, neconfirmate: 1, stare_server: 'in_apel', rezultat_send: null })
    expect(d.rezultat).toHaveBeenCalledTimes(3); expect(d.fetchSpy.mock.calls.filter(c => c[0].endsWith('/send')).length).toBe(1)
  })
  it('o excepție în afara persistării (apel_incepe aruncă): rezultat_neconfirmat, niciun send, recitire', async () => {
    const d = deps({ incepe: vi.fn(async () => { throw new Error('retea') }), mesaj: vi.fn(async () => ({ data: { id, stare: 'rezervat' } })) })
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.body).toMatchObject({ cod: 'rezultat_neconfirmat', necunoscute: 1, trimise: 0, stare_server: 'rezervat' }); expect(d.fetchSpy.mock.calls.some(c => c[0].endsWith('/send'))).toBe(false)
  })
  it('esuat_sigur (snapshot diferit, fără send) cu persistarea neconfirmată: tot neconfirmat, nu „eșuat”', async () => {
    const d = deps({ rezultat: vi.fn(async () => ({ data: false })), mesaj: vi.fn(async () => ({ data: { id, stare: 'rezervat' } })) })
    d.rezerva.mockReset(); let n = 0
    d.rezerva.mockImplementation(async () => { n++; if (n === 1) { const m = mesaj(); m.mesaj_sha256 = 'b'.repeat(64); return { data: [m] } } return { data: [] } })
    const r = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.body).toMatchObject({ cod: 'persistare_neconfirmata', esuate: 0, neconfirmate: 1, rezultat_send: 'esuat_sigur' }); expect(d.fetchSpy.mock.calls.some(c => c[0].endsWith('/send'))).toBe(false)
  })
})

describe('F2b: wrapperul HTTP cu listă închisă', () => {
  const f = () => vi.fn(async () => raspuns(200, {}))
  it('modul / scop necunoscute sau nepotrivite → refuz la creare', () => {
    expect(() => creeazaGmailHttp({ modul: 'gmailCitire', scop: 'trimitere', env, fetch: f() })).toThrow('metoda_nepermisa')
    expect(() => creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'citire', env, fetch: f() })).toThrow('metoda_nepermisa')
    expect(() => creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'golire', env, fetch: f() })).toThrow('metoda_nepermisa')
  })
  it('trimiterea: doar POST users/me/messages/send; restul refuzat FĂRĂ fetch', async () => {
    const fs = f(), h = creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env, fetch: fs })
    for (const [m, c] of [['GET', '/gmail/v1/users/me/profile'], ['GET', '/gmail/v1/users/me/messages'], ['POST', '/gmail/v1/users/me/messages/x/trash'], ['POST', '/gmail/v1/users/me/drafts'], ['DELETE', '/gmail/v1/users/me/messages/x'], ['POST', '/gmail/v1/users/me/messages/send/'], ['GET', '/gmail/v1/users/me/messages/send']])
      expect(() => h.gmail(m, c, { accessToken: 'at' })).toThrow('metoda_nepermisa')
    expect(() => h.gmail('POST', '/gmail/v1/users/me/messages/send', {})).toThrow('metoda_nepermisa')
    expect(fs).not.toHaveBeenCalled()
    await h.gmail('POST', '/gmail/v1/users/me/messages/send', { accessToken: 'at', body: '{}' })
    expect(fs).toHaveBeenCalledWith(GAZDA_GMAIL + '/gmail/v1/users/me/messages/send', expect.objectContaining({ method: 'POST' }))
  })
  it('OAuth: trimiterea nu poate schimba codul, revoca sau citi JWKS; conectarea nu poate face refresh', async () => {
    const fs = f(), t = creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env, fetch: fs }), o = creeazaGmailHttp({ modul: 'gmailOauth', scop: 'trimitere', env, fetch: fs })
    expect(() => t.token({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'u' })).toThrow('metoda_nepermisa')
    expect(() => t.revoca('x')).toThrow('metoda_nepermisa'); expect(() => t.jwks()).toThrow('metoda_nepermisa')
    expect(() => o.token({ grant_type: 'refresh_token', refresh_token: 'r' })).toThrow('metoda_nepermisa')
    expect(() => o.token({ grant_type: 'client_credentials' })).toThrow('metoda_nepermisa')
    expect(() => o.gmail('GET', '/gmail/v1/users/me/profile', { accessToken: 'a' })).toThrow('metoda_nepermisa')
    expect(fs).not.toHaveBeenCalled()
  })
  it('client_id / client_secret vin DOAR din mapare (env), nu din parametri; lipsa lor = client_neconfigurat fără fetch', async () => {
    const fs = f(), o = creeazaGmailHttp({ modul: 'gmailOauth', scop: 'trimitere', env, fetch: fs })
    expect(() => o.token({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'u', client_id: 'altul' })).toThrow('metoda_nepermisa')
    await o.token({ grant_type: 'authorization_code', code: 'cod-1', redirect_uri: REDIRECT_URI_TRIMITERE })
    const body = fs.mock.calls[0][1].body
    expect(body).toContain('client_id=client-fictiv.apps'); expect(body).toContain('client_secret=secret-fictiv'); expect(body).toContain('code=cod-1')
    const gol = creeazaGmailHttp({ modul: 'gmailOauth', scop: 'trimitere', env: () => undefined, fetch: f() })
    expect(() => gol.token({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'u' })).toThrow('client_neconfigurat')
    expect(MAPARE_SCOPURI.trimitere.vault).toBe(SECRET_TRIMITERE)
  })
  it('refresh: 4xx = token_respins, scope în plus = scope_diferit, 5xx / rețea = token_neconfirmat', async () => {
    const cu = r => creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env, fetch: vi.fn(async () => r) })
    expect(await reimprospateaza(cu(raspuns(400, { error: 'invalid_grant' })), 'r')).toEqual({ ok: false, cod: 'token_respins' })
    expect(await reimprospateaza(cu(raspuns(200, { access_token: 'a', scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify openid email' })), 'r')).toEqual({ ok: false, cod: 'scope_diferit' })
    expect(await reimprospateaza(cu(raspuns(200, { access_token: 'a' })), 'r')).toEqual({ ok: false, cod: 'scope_diferit' })
    expect(await reimprospateaza(cu(raspuns(500, {})), 'r')).toEqual({ ok: false, cod: 'token_neconfirmat' })
    expect(await reimprospateaza(creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env, fetch: vi.fn(async () => { throw new Error('retea') }) }), 'r')).toEqual({ ok: false, cod: 'token_neconfirmat' })
    expect(await reimprospateaza(cu(raspuns(200, { access_token: 'a', scope: 'email https://www.googleapis.com/auth/gmail.send openid' })), 'r')).toEqual({ ok: true, accessToken: 'a' })
  })
  it('base64url fără padding', () => { expect(base64Url(new TextEncoder().encode('ab?'))).toBe('YWI_'); expect(base64Url(new Uint8Array([251, 255]))).toBe('-_8') })
})

// ── id_token-uri semnate cu o cheie RSA generată în test ──
const b64u = b => Buffer.from(b).toString('base64url')
async function cheie() {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', k.publicKey)
  return { k, jwks: { keys: [{ kty: 'RSA', kid: 'k1', use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }] } }
}
async function idToken(k, corp, antet = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const date = b64u(JSON.stringify(antet)) + '.' + b64u(JSON.stringify(corp))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k.privateKey, new TextEncoder().encode(date))
  return date + '.' + b64u(new Uint8Array(sig))
}
const ACUM = Date.parse('2026-11-18T10:00:00Z'), SEC = Math.floor(ACUM / 1000)
const corpOk = () => ({ iss: 'https://accounts.google.com', aud: 'client-fictiv.apps', exp: SEC + 3600, iat: SEC - 5, email: 'redari@gazpet.ro', email_verified: true, hd: 'gazpet.ro', sub: '1' })

describe('F2b: OAuth — scope-uri canonice, id_token validat local, state consumat o dată, revocare la nepotrivire', () => {
  it('seturile canonice: echivalențele din lista închisă; altceva rămâne diferit; câmp absent = false', () => {
    expect(scopuriCanonice('openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send')).toEqual(['email', 'gmail.send', 'openid'])
    expect(scopuriExacte('email openid https://www.googleapis.com/auth/gmail.send', ['gmail.send', 'openid', 'email'])).toBe(true)
    expect(scopuriExacte('email openid https://www.googleapis.com/auth/gmail.send profile', ['gmail.send', 'openid', 'email'])).toBe(false)
    expect(scopuriExacte('email openid', ['gmail.send', 'openid', 'email'])).toBe(false)
    expect(scopuriExacte(undefined, ['gmail.send'])).toBe(false); expect(scopuriExacte('https://mail.google.com/', ['gmail.send'])).toBe(false)
  })
  it('URL-ul de autorizare: offline, consent, fără include_granted_scopes, redirect-ul fix; state-ul = 64 hex', () => {
    const state = genereazaState(); expect(state).toMatch(/^[0-9a-f]{64}$/)
    const u = new URL(urlAutorizare({ clientId: 'c', state, scope: MAPARE_SCOPURI.trimitere.scope_cerut, casuta: 'redari@gazpet.ro' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: 'c', redirect_uri: REDIRECT_URI_TRIMITERE, response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', login_hint: 'redari@gazpet.ro', hd: 'gazpet.ro', state })
    expect(() => urlAutorizare({ clientId: 'c', state: 'scurt', scope: 'x', casuta: 'y' })).toThrow('cerere_invalida')
  })
  it('id_token: semnătura bună trece; fiecare abatere are codul ei', async () => {
    const { k, jwks } = await cheie()
    const o = { jwks: async () => jwks, clientId: 'client-fictiv.apps', casuta: 'redari@gazpet.ro', acum: ACUM }
    expect(await valideazaIdToken(await idToken(k, corpOk()), o)).toEqual({ ok: true, email: 'redari@gazpet.ro', hd: 'gazpet.ro' })
    const cazuri = [[{ email: 'altcineva@gazpet.ro' }, 'casuta_gresita'], [{ email: 'Redari@gazpet.ro' }, 'casuta_gresita'], [{ hd: 'alt.ro' }, 'id_token_hd'], [{ email_verified: false }, 'id_token_neverificat'],
      [{ aud: 'alt-client' }, 'id_token_aud'], [{ iss: 'https://evil.invalid' }, 'id_token_iss'], [{ exp: SEC - 1 }, 'id_token_exp'], [{ iat: SEC + 900 }, 'id_token_iat'], [{ iat: SEC - 3600 }, 'id_token_iat']]
    for (const [p, cod] of cazuri) expect((await valideazaIdToken(await idToken(k, { ...corpOk(), ...p }), o)).cod).toBe(cod)
    // semnătură cu altă cheie / token alterat / alg none / kid necunoscut / JWKS indisponibil
    const { k: k2 } = await cheie()
    expect((await valideazaIdToken(await idToken(k2, corpOk()), o)).cod).toBe('id_token_semnatura')
    const bun = await idToken(k, corpOk()); const [h, c, s] = bun.split('.')
    expect((await valideazaIdToken(h + '.' + b64u(JSON.stringify({ ...corpOk(), email: 'x@gazpet.ro' })) + '.' + s, o)).cod).toBe('id_token_semnatura')
    expect((await valideazaIdToken(await idToken(k, corpOk(), { alg: 'none', kid: 'k1' }), o)).cod).toBe('id_token_alg')
    expect((await valideazaIdToken(await idToken(k, corpOk(), { alg: 'RS256', kid: 'k9' }), o)).cod).toBe('id_token_cheie')
    expect((await valideazaIdToken(bun, { ...o, jwks: async () => { throw new Error('x') } })).cod).toBe('jwks_indisponibil')
    expect((await valideazaIdToken(undefined, o)).cod).toBe('id_token_lipsa'); expect((await valideazaIdToken('a.b', o)).cod).toBe('id_token_forma')
    void c
  })
  // runda 2 (Jakarinos #1134 P2): id_token malformat = refuz CONTROLAT (id_token_forma), niciodată excepție
  it.each([['A.A.A'], ['A.A.' + 'x'.repeat(10)], ['!!.!!.!!'], ['QQ.QQ.QQ'], [b64u('nu e json') + '.' + b64u('{}') + '.QUJD'], [b64u('[]') + '.' + b64u('{}') + '.QUJD'], [b64u('{}') + '.' + b64u('{"a":1}') + '.A'], ['..'], ['a.b.c.d'], ['']])(
    'id_token malformat %j → id_token_forma, fără excepție', async tk => {
    const { jwks } = await cheie()
    const o = { jwks: async () => jwks, clientId: 'client-fictiv.apps', casuta: 'redari@gazpet.ro', acum: ACUM }
    const r = await valideazaIdToken(tk, o)
    expect(r.ok).toBe(false); expect(['id_token_forma', 'id_token_lipsa']).toContain(r.cod)
  })
  it('antet / corp decodabile dar fără alg sau semnătură stricată: codurile lor, fără excepție', async () => {
    const { k, jwks } = await cheie()
    const o = { jwks: async () => jwks, clientId: 'client-fictiv.apps', casuta: 'redari@gazpet.ro', acum: ACUM }
    expect((await valideazaIdToken(b64u('{"alg":"RS256","kid":"k1"}') + '.' + b64u(JSON.stringify(corpOk())) + '.AAAA', o)).cod).toBe('id_token_semnatura')
    expect((await valideazaIdToken(b64u('{"alg":"HS256","kid":"k1"}') + '.' + b64u(JSON.stringify(corpOk())) + '.AAAA', o)).cod).toBe('id_token_alg')
    const bun = await idToken(k, corpOk()); expect((await valideazaIdToken(bun, o)).ok).toBe(true)
  })
  /** dependențele handlerului OAuth; Google e simulat prin fetch */
  async function depsOauth(tokenBody, o = {}) {
    const { k, jwks } = await cheie()
    const t = { access_token: 'at', refresh_token: 'rt-fictiv', expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email', token_type: 'Bearer', id_token: await idToken(k, corpOk()), ...tokenBody }
    const fetchSpy = vi.fn(async url => url === GAZDA_OAUTH + '/token' ? raspuns(200, t) : url === GAZDA_JWKS + '/oauth2/v3/certs' ? raspuns(200, jwks) : url === GAZDA_OAUTH + '/revoke' ? raspuns(200, {}) : raspuns(404, {}))
    const consumate = new Set()
    return Object.assign({
      getUser: vi.fn(async () => ({ data: { user: { id: uid } } })), owner: vi.fn(async () => ({ data: true })),
      stateStart: vi.fn(async () => ({ data: 'uuid-state' })),
      stateConsuma: vi.fn(async sha => { if (consumate.has(sha)) return { error: { cod: 'state_invalid' } }; consumate.add(sha); return { data: 'trimitere' } }),
      eveniment: vi.fn(async () => ({ data: null })), secretSeteaza: vi.fn(async () => ({ data: true })), secretCiteste: vi.fn(async () => ({ data: 'rt-fictiv' })),
      env, fetch: fetchSpy, fetchSpy, getRandomValues: v => crypto.getRandomValues(v), subtle: crypto.subtle, acum: () => ACUM,
    }, o)
  }
  const stateBun = 'f'.repeat(64)
  it('start: doar owner, doar scopul trimitere; state-ul în BD ca sha256, URL-ul cu state-ul în clar', async () => {
    const d = await depsOauth()
    const r = await raspundeOauth({ jwt: 'f', corp: { actiune: 'start', scop: 'trimitere' } }, d)
    expect(r.status).toBe(200); const u = new URL(r.body.url); const st = u.searchParams.get('state')
    expect(st).toMatch(/^[0-9a-f]{64}$/); expect(d.stateStart).toHaveBeenCalledWith('trimitere', await sha256Hex(st)); expect(d.fetchSpy).not.toHaveBeenCalled()
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'start', scop: 'citire' } }, d)).status).toBe(400)
    const n = await depsOauth({}, { owner: vi.fn(async () => ({ data: false })) })
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'start', scop: 'trimitere' } }, n)).status).toBe(403); expect(n.stateStart).not.toHaveBeenCalled()
  })
  it('callback: state-ul consumat ÎNAINTE de schimbul codului; a doua încercare = state_invalid fără apel; salvarea cu uid-ul din getUser', async () => {
    const d = await depsOauth()
    const r = await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv', state: stateBun } }, d)
    expect(r).toEqual({ status: 200, body: { cod: 'conectat', casuta: 'redari@gazpet.ro' } })
    expect(d.stateConsuma.mock.invocationCallOrder[0]).toBeLessThan(d.fetchSpy.mock.invocationCallOrder[0])
    expect(d.secretSeteaza).toHaveBeenCalledWith('rt-fictiv', uid, 'redari@gazpet.ro')
    expect(d.fetchSpy.mock.calls[0][1].body).toContain(`redirect_uri=${encodeURIComponent(REDIRECT_URI_TRIMITERE)}`)
    const apeluri = d.fetchSpy.mock.calls.length
    const r2 = await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv', state: stateBun } }, d)
    expect(r2).toEqual({ status: 409, body: { cod: 'state_invalid' } }); expect(d.fetchSpy.mock.calls.length).toBe(apeluri); expect(d.secretSeteaza).toHaveBeenCalledTimes(1)
  })
  it.each([
    [{ idTokenEmail: 'altcineva@gazpet.ro' }, 'casuta_gresita'],
    [{ scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify openid email' }, 'scope_diferit'],
    [{ scope: undefined }, 'scope_diferit'], [{ refresh_token: undefined }, 'fara_refresh_token'], [{ id_token: undefined }, 'id_token_lipsa'],
  ])('callback cu răspuns nepotrivit %j → %s: revocare la Google, eveniment, NIMIC salvat', async (p, cod) => {
    const { idTokenEmail, ...rest } = p
    const d = await depsOauth(rest)
    if (idTokenEmail) {
      const { k, jwks } = await cheie()
      const t = { access_token: 'at', refresh_token: 'rt-strain', scope: 'https://www.googleapis.com/auth/gmail.send openid email', id_token: await idToken(k, { ...corpOk(), email: idTokenEmail }) }
      d.fetch = d.fetchSpy = vi.fn(async url => url === GAZDA_OAUTH + '/token' ? raspuns(200, t) : url === GAZDA_JWKS + '/oauth2/v3/certs' ? raspuns(200, jwks) : raspuns(200, {}))
    }
    const r = await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv-4/0Ab', state: stateBun } }, d)
    expect(r.status).toBe(409); expect(r.body.cod).toBe(cod)
    expect(d.secretSeteaza).not.toHaveBeenCalled()
    const revocari = d.fetchSpy.mock.calls.filter(c => c[0] === GAZDA_OAUTH + '/revoke')
    expect(revocari.length).toBeGreaterThanOrEqual(1); expect(revocari.every(c => /^token=/.test(c[1].body))).toBe(true)
    expect(d.eveniment).toHaveBeenCalledWith('oauth_respins', cod)
  })
  it.each([['A.A.A'], ['!!.!!.!!'], ['QQ.QQ.QQ'], [123], [{ x: 1 }], [b64u('[1]') + '.' + b64u('{}') + '.QUJD']])(
    'callback cu id_token malformat %j (runda 2): 409 id_token_forma, grantul REVOCAT (refresh + access), eveniment, nimic salvat, fără excepție', async tk => {
    const d = await depsOauth({ id_token: tk })
    const r = await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv-4/0Ab', state: stateBun } }, d)
    expect(r).toEqual({ status: 409, body: { cod: tk === 123 || typeof tk === 'object' ? 'id_token_lipsa' : 'id_token_forma' } })
    expect(d.secretSeteaza).not.toHaveBeenCalled()
    const revocari = d.fetchSpy.mock.calls.filter(c => c[0] === GAZDA_OAUTH + '/revoke').map(c => c[1].body).sort()
    expect(revocari).toEqual(['token=at', 'token=rt-fictiv'])
    expect(d.eveniment).toHaveBeenCalledWith('oauth_respins', r.body.cod)
  })
  it('callback: dacă verificarea ar arunca totuși (subtle stricat), grantul se revocă și refuzul e controlat', async () => {
    const d = await depsOauth({}, { subtle: { importKey: async () => { throw new Error('crypto indisponibil') }, verify: async () => { throw new Error('x') } } })
    const r = await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv-4/0Ab', state: stateBun } }, d)
    expect(r.status).toBe(409); expect(r.body.cod).toBe('id_token_semnatura')
    expect(d.fetchSpy.mock.calls.filter(c => c[0] === GAZDA_OAUTH + '/revoke').length).toBe(2); expect(d.secretSeteaza).not.toHaveBeenCalled()
  })
  it('callback: schimbul eșuat (4xx Google) → 502, eveniment, nimic salvat; salvarea eșuată → revocare + 503', async () => {
    let d = await depsOauth(); d.fetch = d.fetchSpy = vi.fn(async () => raspuns(400, { error: 'invalid_grant' }))
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv-4/0Ab', state: stateBun } }, d))).toEqual({ status: 502, body: { cod: 'schimb_esuat' } }); expect(d.secretSeteaza).not.toHaveBeenCalled()
    expect(d.eveniment).toHaveBeenCalledWith('oauth_respins', 'schimb_esuat')
    d = await depsOauth({}, { secretSeteaza: vi.fn(async () => ({ error: { message: 'x' } })) })
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv-4/0Ab', state: stateBun } }, d)).status).toBe(503)
    expect(d.fetchSpy.mock.calls.filter(c => c[0] === GAZDA_OAUTH + '/revoke').length).toBe(2)
  })
  it('callback: forma cererii (state scurt, cod lipsă) → 400 fără consum', async () => {
    const d = await depsOauth()
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod-fictiv-4/0Ab', state: 'abc' } }, d)).status).toBe(400)
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', state: stateBun } }, d)).status).toBe(400)
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'scurt', state: stateBun } }, d)).status).toBe(400)
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'callback', code: 'cod cu spatiu si <html>', state: stateBun } }, d)).status).toBe(400)
    expect(d.stateConsuma).not.toHaveBeenCalled()
  })
  it('revoca: revocarea la Google + golirea secretului cu uid-ul din getUser; non-owner 403', async () => {
    const d = await depsOauth()
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'revoca' } }, d))).toEqual({ status: 200, body: { cod: 'revocat' } })
    expect(d.secretCiteste).toHaveBeenCalledWith(uid, 'revocare'); expect(d.fetchSpy.mock.calls[0][0]).toBe(GAZDA_OAUTH + '/revoke'); expect(d.fetchSpy.mock.calls[0][1].body).toBe('token=rt-fictiv')
    expect(d.secretSeteaza).toHaveBeenCalledWith('', uid, null)
    const n = await depsOauth({}, { owner: vi.fn(async () => ({ data: false })) })
    expect((await raspundeOauth({ jwt: 'f', corp: { actiune: 'revoca' } }, n)).status).toBe(403); expect(n.secretCiteste).not.toHaveBeenCalled()
  })
})

describe('F2b: MIME cu diacritice și atașament; garda JS cere căsuța conectată', () => {
  it('subiectul și corpul cu diacritice sunt codate (RFC 2047 / base64); un singur To; atașamentul PDF e parte separată', async () => {
    const m = { ...mesaj(), atasament_path: 'FICTIV/convocator.pdf', atasament_nume: 'Convocator ș.pdf', atasament_mime: 'application/pdf', atasament_marime: 9, atasament_sha256: '' }
    const pdf = new TextEncoder().encode('%PDF-1.4x'); m.atasament_sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pdf)), b => b.toString(16).padStart(2, '0')).join('')
    m.mesaj_sha256 = await hashMesaj(m)
    const mime = await compuneMime(m, pdf)
    expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?/m); expect(mime).not.toMatch(/Țară/); expect(mime.match(/^To:/gm)).toHaveLength(1); expect(mime).not.toMatch(/^(Cc|Bcc):/m)
    expect(mime).toContain('Content-Type: application/pdf'); expect(mime).toContain("filename*=UTF-8''Convocator%20%C8%99.pdf")
    expect(mime).toMatch(/^From: redari@gazpet.ro$/m); expect(mime).toMatch(/^To: coleg.fictiv@gazpet.ro$/m)
    // corpul base64 decodat conține diacriticele intacte
    const corp = mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, '')
    expect(Buffer.from(corp, 'base64').toString('utf8')).toBe('Bună ziua,\nText fictiv cu ă î ș ț.')
    expect(/^[\x00-\x7f]*$/.test(mime)).toBe(true)
  })
  it('gardaTrimitere: fără trimitere_conectata_la → casuta_neconectata (după oprire, înaintea informării)', () => {
    const baza = { owner: true, informare: true, lot: lot(), setari: { ...SETARI_OK } }
    expect(gardaTrimitere(baza)).toBe(null)
    expect(gardaTrimitere({ ...baza, setari: { ...SETARI_OK, trimitere_conectata_la: null } })).toBe('casuta_neconectata')
    expect(gardaTrimitere({ ...baza, setari: { ...SETARI_OK, trimitere_conectata_la: null, trimitere_oprita: true } })).toBe('trimitere_oprita')
    expect(gardaTrimitere({ ...baza, informare: false, setari: { ...SETARI_OK, trimitere_conectata_la: null } })).toBe('casuta_neconectata')
  })
})

// ── MUTANȚI pe handler (copii cu mutația într-un folder temporar) + DOVADA PE MAIN (sursele de pe origin/main prin git show) ──
const CAI = { 'redariMailF2Handler.mjs': 'supabase/functions/_shared/redariMailF2Handler.mjs', 'redariMailF2.mjs': 'supabase/functions/_shared/redariMailF2.mjs', 'gmailTrimitere.mjs': 'supabase/functions/_shared/gmailTrimitere.mjs', 'gmailOauthTrimitere.mjs': 'supabase/functions/_shared/gmailOauthTrimitere.mjs' }
const SURSE = Object.fromEntries(Object.entries(CAI).map(([n, c]) => [n, readFileSync(c, 'utf8').replace(/\r\n/g, '\n')]))   // checkout CRLF (Windows) = aceleași surse
const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
async function incarca(mutatie, surse = SURSE) {
  const dir = mkdtempSync(join(TMP, 'mail_mutant_')); foldere.push(dir)
  for (const [nume, text] of Object.entries(surse)) {
    let t = text
    if (mutatie && mutatie.fisier === nume) {
      if (t.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${nume}: ${mutatie.din}`)
      t = t.replace(mutatie.din, mutatie.in)
    }
    writeFileSync(join(dir, nume), t)
  }
  return import(pathToFileURL(join(dir, 'redariMailF2Handler.mjs')).href + `?v=${Date.now()}${Math.random()}`)
}
describe('F2b: mutanți pe garda „doar TEST” (fiecare TREBUIE prins) și dovada pe main', () => {
  it.each([
    ['garda scoasă din handler', { fisier: 'redariMailF2Handler.mjs', din: '  if (DOAR_PROIECTE_TEST) {', in: '  if (false) {' }],
    ['flag-ul DOAR_PROIECTE_TEST oprit', { fisier: 'redariMailF2.mjs', din: 'export const DOAR_PROIECTE_TEST = true', in: 'export const DOAR_PROIECTE_TEST = false' }],
    ['prefixul comparat fără majuscule', { fisier: 'redariMailF2.mjs', din: "export const esteProiectTest = cod => typeof cod === 'string' && cod.startsWith(PREFIX_PROIECT_TEST)", in: "export const esteProiectTest = cod => typeof cod === 'string' && cod.toUpperCase().startsWith(PREFIX_PROIECT_TEST)" }],
    ['garda după secret (ordinea inversată)', { fisier: 'redariMailF2Handler.mjs', din: "  const sec = await deps.secret(uid)\n", in: "  const sec = await deps.secret(uid)\n  if (DOAR_PROIECTE_TEST) { const pr = await deps.proiect(l.data.proiect_id); if (!transportPermis({ proiectCod: pr?.data?.cod }).ok) return out(423, 'transport_real_doar_test') }\n" }],
  ])('MUTANT %s', async (nume, mutatie) => {
    let mod = await incarca(mutatie)
    if (nume.includes('ordinea')) { mod = await incarca({ fisier: 'redariMailF2Handler.mjs', din: '  if (DOAR_PROIECTE_TEST) {\n    // garda', in: '  if (false) {\n    // garda' }, { ...SURSE, 'redariMailF2Handler.mjs': SURSE['redariMailF2Handler.mjs'].replace(mutatie.din, mutatie.in) }) }
    const d = deps({ proiect: vi.fn(async () => ({ data: { id, cod: nume.includes('majuscule') ? 'test-razvan' : 'LOT1-REAL' } })) })
    const r = await mod.raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    const prins = r.body.cod !== 'transport_real_doar_test' || d.secret.mock.calls.length > 0
    expect(prins).toBe(true)   // mutantul chiar schimbă comportamentul (altfel testul de mai sus n-ar păzi nimic)
  })
  it('DOVADA ISTORICĂ: handlerul de pe main dinaintea F2b (SHA fix 8e6a3152) refuza lotul de TEST cu 423 transport_real_oprit (fără secret); cel nou îl trimite', async () => {
    // SHA fix, nu origin/main: după îmbinarea F2b (#1134) main are transportul pornit, iar dovada ar fi apărut „trecută” printr-un return fără verificare
    let vechi
    try { vechi = Object.fromEntries(['redariMailF2Handler.mjs', 'redariMailF2.mjs'].map(n => [n, execFileSync('git', ['show', `8e6a3152:${CAI[n]}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })])) } catch { vechi = null }
    if (!vechi) return   // fără istoric local (CI cu clonă superficială): se sare, nu se simulează
    expect(vechi['redariMailF2.mjs']).toContain('TRANSPORT_REAL_ACTIV = false')   // SHA-ul e chiar cel dinaintea pornirii transportului
    const mod = await incarca(null, { ...SURSE, ...vechi })   // handlerul vechi își importă vecinii: lipsesc din `vechi`, se iau din sursele curente
    const d = deps()
    const r = await mod.raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, d)
    expect(r.status).toBe(423); expect(r.body.cod).toBe('transport_real_oprit'); expect(d.secret).not.toHaveBeenCalled()
    const nou = await raspundeTrimitere({ jwt: 'f', corp: { lot_id: id } }, deps())
    expect(nou.body).toMatchObject({ cod: 'rulat', trimise: 1 })
  })
})
