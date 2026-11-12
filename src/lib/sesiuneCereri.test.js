// src/lib/sesiuneCereri.js — fără sesiune interfața nu trimite cereri către tabele; polling-ul se oprește la sesiune expirată
// și repornește când revine. Clientul Supabase e cel REAL (supabase-js), doar fetch-ul de rețea e înlocuit cu un spion (L25: cererile
// pleacă exact ca la apelantul real: antetele le pune supabase-js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { creeazaFetchCuSesiune, eCerereFaraSesiune, eEroareSesiune, pornestePolling, optiuniClient, RPC_PUBLICE, COD_FARA_SESIUNE } from './sesiuneCereri.js'

vi.mock('./supabase.js', () => ({ supabase: {} }))   // HomeScada importă clientul principal; testul îi dă clientul lui
const { COUNT_DEFS } = await import('../HomeScada.jsx')

const URL_B = 'https://proiect-test.supabase.co'
const ANON = 'cheie-publica-de-test'
const JWT_USER = 'eyJhbGciOiJIUzI1NiJ9.utilizator.semnatura'
const raspunsOk = () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } })
function client(spion, headers) {
  return createClient(URL_B, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: creeazaFetchCuSesiune(ANON, spion), ...(headers ? { headers } : {}) },
  })
}
const cereriRest = (spion) => spion.mock.calls.filter(([u]) => String(u?.url || u).includes('/rest/v1/'))

describe('garda: fără sesiune, nicio cerere către tabele', () => {
  it('select / count / insert / update / delete / rpc nepublic: ZERO cereri, răspuns 401 FARA_SESIUNE fără excepție', async () => {
    const spion = vi.fn(async () => raspunsOk())
    const sb = client(spion)
    const rez = await Promise.all([
      sb.from('tichete').select('id', { count: 'exact', head: true }),
      sb.from('notifications').select('id').eq('profile_id', 'x').limit(30),
      sb.from('v_chat_list').select('*'),
      sb.from('comenzi_furnizor_aprobari').select('id').eq('status', 'in_asteptare'),
      sb.from('employees').insert({ name: 'X' }),
      sb.from('notifications').update({ read_at: 'acum' }).eq('id', 1),
      sb.from('notifications').delete().eq('id', 1),
      sb.rpc('fn_oarecare', { a: 1 }),
    ])
    expect(cereriRest(spion)).toHaveLength(0)
    for (const r of rez) { expect(r.status).toBe(401); expect(r.error?.code).toBe(COD_FARA_SESIUNE); expect(eEroareSesiune(r.error, r.status)).toBe(true) }
  })
  it('contoarele paginii principale (HomeScada): zero cereri fără sesiune, fiecare dă „—” (count null)', async () => {
    const spion = vi.fn(async () => raspunsOk())
    const sb = client(spion)
    const defs = Object.values(COUNT_DEFS)
    expect(defs.length).toBeGreaterThan(5)
    const rez = await Promise.allSettled(defs.map(d => d.q(sb)))
    expect(cereriRest(spion)).toHaveLength(0)
    for (const r of rez) expect(r.status === 'fulfilled' && r.value.error ? null : 'cifra').toBeNull()
  })
  it('RPC-urile paginilor publice pleacă fără sesiune (RSVP, formularul și informarea Redări)', async () => {
    const spion = vi.fn(async () => new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const sb = client(spion)
    for (const f of RPC_PUBLICE) await sb.rpc(f, {})
    expect(cereriRest(spion).map(([u]) => new URL(String(u?.url || u)).pathname)).toEqual(RPC_PUBLICE.map(f => '/rest/v1/rpc/' + f))
  })
  it('autentificarea, fișierele și funcțiile edge nu sunt atinse de gardă', async () => {
    const spion = vi.fn(async () => new Response('{}', { status: 400, headers: { 'Content-Type': 'application/json' } }))
    const sb = client(spion)
    await sb.auth.signInWithPassword({ email: 'a@b.ro', password: 'x' })
    await sb.storage.from('b').list('')
    await sb.functions.invoke('f', { body: {} })
    const cai = spion.mock.calls.map(([u]) => new URL(String(u?.url || u)).pathname)
    expect(cai.some(p => p.startsWith('/auth/v1/'))).toBe(true)
    expect(cai.some(p => p.startsWith('/storage/v1/'))).toBe(true)
    expect(cai.some(p => p.startsWith('/functions/v1/'))).toBe(true)
  })
  it('cu tokenul unui utilizator, cererea pleacă neschimbată (antetul pus de supabase-js)', async () => {
    const spion = vi.fn(async () => raspunsOk())
    const sb = client(spion, { Authorization: `Bearer ${JWT_USER}` })
    const r = await sb.from('tichete').select('id')
    expect(r.error).toBeNull()
    const [[u, init]] = cereriRest(spion)
    expect(new URL(String(u)).pathname).toBe('/rest/v1/tichete')
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${JWT_USER}`)
  })
  it('eCerereFaraSesiune: antet lipsă / cheia publică = fără sesiune; alt token = cu sesiune; în afara /rest/v1/ = nu se atinge', () => {
    expect(eCerereFaraSesiune(`${URL_B}/rest/v1/tichete`, { headers: {} }, ANON)).toBe(true)
    expect(eCerereFaraSesiune(`${URL_B}/rest/v1/tichete`, { headers: { authorization: `Bearer ${ANON}` } }, ANON)).toBe(true)
    expect(eCerereFaraSesiune(`${URL_B}/rest/v1/tichete`, { headers: new Headers({ Authorization: `Bearer ${JWT_USER}` }) }, ANON)).toBe(false)
    expect(eCerereFaraSesiune(`${URL_B}/rest/v1/rpc/fn_red_formular_public?x=1`, { headers: {} }, ANON)).toBe(false)
    expect(eCerereFaraSesiune(`${URL_B}/rest/v1/rpc/fn_red_formular_public_altceva`, { headers: {} }, ANON)).toBe(true)
    expect(eCerereFaraSesiune(`${URL_B}/auth/v1/token`, { headers: {} }, ANON)).toBe(false)
    expect(eCerereFaraSesiune(`${URL_B}/storage/v1/object/b/x`, { headers: {} }, ANON)).toBe(false)
  })
  it('eEroareSesiune: 401 / 403 și codurile de JWT; nu și alte erori', () => {
    expect(eEroareSesiune(null, 401)).toBe(true)
    expect(eEroareSesiune(null, 403)).toBe(true)
    expect(eEroareSesiune({ code: 'PGRST301' }, 400)).toBe(true)
    expect(eEroareSesiune({ code: '23505' }, 409)).toBe(false)
    expect(eEroareSesiune(null, 200)).toBe(false)
    expect(eEroareSesiune({ message: 'Failed to fetch' }, 0)).toBe(false)
  })
})

describe('polling: oprit fără sesiune, repornit când revine sesiunea', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const asteaptaPromisiuni = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  function authFals() {
    let cb = null
    const s = { unsubscribe: vi.fn(() => { cb = null }) }
    return { auth: { onAuthStateChange: (f) => { cb = f; return { data: { subscription: s } } } }, emite: (ev, ses) => cb && cb(ev, ses), s }
  }

  it('sesiunea EXPIRĂ în timpul polling-ului: supabase-js trece pe cheia publică -> cererea e blocată -> polling-ul se oprește (zero cereri după)', async () => {
    const spion = vi.fn(async () => raspunsOk())
    const f = creeazaFetchCuSesiune(ANON, spion)
    let tok = JWT_USER     // ce pune supabase-js în antet: tokenul cât e sesiune, cheia publică după expirare
    const apel = vi.fn(async () => { const r = await f(`${URL_B}/rest/v1/notifications?select=id`, { headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, error: r.ok ? null : await r.json() } })
    const A = authFals()
    const opreste = pornestePolling(apel, 30000, { client: A })
    await asteaptaPromisiuni()
    await vi.advanceTimersByTimeAsync(30000)
    expect(spion).toHaveBeenCalledTimes(2)
    tok = ANON                                   // sesiunea a expirat, reîmprospătarea a picat
    await vi.advanceTimersByTimeAsync(30000)
    expect(apel).toHaveBeenCalledTimes(3)
    expect(spion).toHaveBeenCalledTimes(2)       // a treia NU a plecat
    await vi.advanceTimersByTimeAsync(30000 * 10)
    expect(apel).toHaveBeenCalledTimes(3)        // oprit: fără buclă
    // sesiunea revine (reîmprospătare reușită) -> repornește imediat
    tok = JWT_USER
    A.emite('TOKEN_REFRESHED', { access_token: JWT_USER })
    await asteaptaPromisiuni()
    expect(spion).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(30000)
    expect(spion).toHaveBeenCalledTimes(4)
    opreste()
    expect(A.s.unsubscribe).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30000 * 5)
    expect(apel).toHaveBeenCalledTimes(5)        // demontat: nimic după (1 + 1 + 1 blocat + 1 la revenire + 1)
    expect(spion).toHaveBeenCalledTimes(4)
  })
  it('un răspuns 401 / 403 de la server oprește polling-ul; SIGNED_OUT îl ține oprit (fără repornire la TOKEN_REFRESHED fără sesiune)', async () => {
    let status = 200
    const apel = vi.fn(async () => ({ status, error: status === 200 ? null : { code: '42501' } }))
    const A = authFals()
    const opreste = pornestePolling(apel, 1000, { client: A })
    await asteaptaPromisiuni()
    status = 403
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(apel).toHaveBeenCalledTimes(2)
    A.emite('SIGNED_OUT', null)
    A.emite('TOKEN_REFRESHED', null)
    await vi.advanceTimersByTimeAsync(5000)
    expect(apel).toHaveBeenCalledTimes(2)
    opreste()
  })
  it('o cerere blocată ORIUNDE (alt modul) oprește și polling-urile pornite', async () => {
    const apel = vi.fn(async () => ({ status: 200, error: null }))
    const opreste = pornestePolling(apel, 1000, { client: authFals() })
    await asteaptaPromisiuni()
    await creeazaFetchCuSesiune(ANON, vi.fn())(`${URL_B}/rest/v1/stocuri`, { headers: {} })
    await vi.advanceTimersByTimeAsync(10000)
    expect(apel).toHaveBeenCalledTimes(1)
    opreste()
  })
  it('erorile obișnuite (rețea, 500) NU opresc polling-ul', async () => {
    const apel = vi.fn(async () => ({ status: 500, error: { message: 'x' } }))
    const opreste = pornestePolling(apel, 1000, { client: authFals() })
    await asteaptaPromisiuni()
    await vi.advanceTimersByTimeAsync(3000)
    expect(apel).toHaveBeenCalledTimes(4)
    opreste()
  })
})

describe('locurile din interfață', () => {
  const c = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
  it('clientul principal și TOȚI clienții locali din module primesc garda', () => {
    expect(c('lib/supabase.js')).toContain('createClient(supabaseUrl, supabaseAnonKey, optiuniClient(supabaseAnonKey))')
    for (const f of ['CitesteOricePanel', 'Executie', 'HrAngajatNouWizard', 'ProiectNouWizard', 'TabTronsoane', 'TabSituatiiPlata', 'TabSantiere', 'TabDocumenteNAS']) {
      const t = c(f + '.jsx')
      expect(t, f).toContain('optiuniClient(import.meta.env.VITE_SUPABASE_ANON_KEY)')
      expect(t.split('createClient(').length - 1, f).toBe(1)
    }
  })
  it('polling-urile numite folosesc pornestePolling (clopoțelul, tichetele mele, mesajul companiei, „De aprobat”, chat-ul)', () => {
    const app = c('App.jsx')
    expect(app.split('pornestePolling(').length - 1).toBe(3)
    expect(app).not.toMatch(/setInterval\(loadNotifs/)
    expect(c('DeAprobatButton.jsx')).toContain('pornestePolling(load, 60000, { client: supabase })')
    expect(c('InternalChat.jsx')).toContain('pornestePolling(loadChats, 60000, { client: supabase, imediat: false })')
    expect(c('InternalChat.jsx')).toContain('if (eEroareSesiune(error, status)) return { error, status }')
  })
  it('optiuniClient dă exact fetch-ul cu gardă', () => {
    expect(typeof optiuniClient(ANON).global.fetch).toBe('function')
  })
})
