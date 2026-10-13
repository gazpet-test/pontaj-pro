// Integrare OLX Partner API (R6) — www.olx.ro/api/partner
// Acțiuni (JSON POST { actiune, ... }, cu JWT-ul userului SAU x-radar-secret (Claude)):
//   status | connect-url | categorii | orase | orase_sync | districte | publica | anunturi (lista din contul OLX) | leaga {pozitie_id, advert_id} | activeaza/dezactiveaza {advert_id, pozitie_id?} | actualizeaza {advert_id, patch, pozitie_id?}
// GET /callback?code=&state= -> schimbă codul în tokenuri și le salvează în olx_tokens
// Secrete: OLX_CLIENT_ID / OLX_CLIENT_SECRET — env SAU app_secrets (service_role only).
// verify_jwt = FALSE la deploy: callback-ul OAuth de la OLX si apelurile interne (x-radar-secret) vin fara JWT;
// autorizarea o face userAutorizat() in cod.
// v25 13.10.2026 (inventar securitate): sursa adusa in repo. Secretul x-radar NU mai e scris in cod (era compromis):
//   antetul se verifica in BD (fn_radar_secret_ok → sha256 vs Vault RADAR_SECRET, doar service_role).
//   Callback-ul OAuth cere `state` aleator, generat la connect-url (app_secrets OLX_OAUTH_STATE, 15 min, o singura folosire) —
//   inainte state era constant, deci oricine putea lega alt cont OLX la ERP.
// v13 14.09.2026: /api/partner/cities IGNORA q (intorcea mereu Bucuresti primul → „district_id: Valoare gresita"
//   la publicare). `orase` cauta acum in cache-ul local olx_orase (13.789 orase, umplut de `orase_sync`);
//   `districte` = sectoarele orasului; `publica` trimite si district_id cand exista.
// v10 03.09.2026 (+activeaza/dezactiveaza/actualizeaza; olx_get proxy read-only doar cu x-radar-secret) — fără external_url (OLX: 'Partner is not allowed to use external URL'); link formular rămâne în descriere.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { userAutorizat as userUi } from './acces.ts'

const OLX = 'https://www.olx.ro'
const FORM_URL = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/recrutare-aplica'
const SELF = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/olx-api'
const STATE_MIN = 15
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-radar-secret' } })
const html = (h: string, status = 200) => new Response(`<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:24px">${h}</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

const secretCache: Record<string, string> = {}
async function secret(name: string): Promise<string | undefined> {
  const env = Deno.env.get(name)
  if (env) return env
  if (secretCache[name]) return secretCache[name]
  const { data } = await svc().from('app_secrets').select('value').eq('key', name).maybeSingle()
  if (data?.value) secretCache[name] = data.value
  return data?.value
}

// apel intern (Claude / rutina): antetul x-radar-secret verificat in BD, fara valoare in cod
async function esteIntern(req: Request): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const { data, error } = await svc().rpc('fn_radar_secret_ok', { p_secret: s })
  return !error && data === true
}

// DOAR utilizatori (JWT): owner sau can_access_personal_data. Apelul intern (x-radar-secret) NU trece pe aici —
// el are voie doar la olx_get (Copilot r1 P1-1).
async function userAutorizat(req: Request): Promise<boolean> {
  if (req.headers.get('x-radar-secret')) return false
  const sb = svc()
  const uid = await userUi(req, sb, [])   // owner
  if (uid) return true
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return false
  const { data: u } = await sb.auth.getUser(jwt)
  if (!u?.user) return false
  const { data: p } = await sb.from('profiles').select('can_access_personal_data').eq('id', u.user.id).maybeSingle()
  return p?.can_access_personal_data === true
}

async function tokenValid(): Promise<string | null> {
  const sb = svc()
  const { data: t } = await sb.from('olx_tokens').select('*').eq('id', 1).maybeSingle()
  if (!t?.access_token) return null
  if (t.expires_at && new Date(t.expires_at).getTime() - Date.now() > 60_000) return t.access_token
  if (!t.refresh_token) return null
  const r = await fetch(`${OLX}/api/open/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: await secret('OLX_CLIENT_ID'), client_secret: await secret('OLX_CLIENT_SECRET'), refresh_token: t.refresh_token }),
  })
  if (!r.ok) return null
  const d = await r.json()
  await sb.from('olx_tokens').upsert({ id: 1, access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(), scope: d.scope || t.scope, updated_at: new Date().toISOString() })
  return d.access_token
}

const olxHeaders = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2.0', 'content-type': 'application/json' })

// Diacritice → ASCII, ca „Ploiești" si „Ploiesti" sa se gaseasca reciproc.
const fara = (s: string) => String(s || '').toLowerCase().replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't').trim()

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  const url = new URL(req.url)

  if (req.method === 'GET' && url.searchParams.get('code')) {
    // state aleator, o singura folosire, expira in STATE_MIN minute
    const sb = svc()
    const primit = url.searchParams.get('state') || ''
    const invalid = () => html('<h3>Cerere de conectare OLX invalidă sau expirată.</h3><p>Pornește din nou din HR → Recrutare → „Conectează OLX”.</p>', 400)
    if (!/^[0-9a-f]{48}$/.test(primit)) return invalid()
    // consum ATOMIC: doar callback-ul care șterge efectiv rândul cu exact acest state continuă (Copilot r1 P1-4)
    const { data: consumat, error: eSt } = await sb.from('app_secrets').delete().eq('key', 'OLX_OAUTH_STATE').like('value', `${primit}|%`).select('value')
    if (eSt || !consumat || consumat.length !== 1) return invalid()
    if (!(Number(String(consumat[0].value).split('|')[1]) > Date.now())) return invalid()
    const r = await fetch(`${OLX}/api/open/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: await secret('OLX_CLIENT_ID'), client_secret: await secret('OLX_CLIENT_SECRET'), code: url.searchParams.get('code'), scope: 'v2 read write', redirect_uri: SELF }),
    })
    const d = await r.json()
    if (!r.ok || !d.access_token) return html(`<h3>Eroare la conectarea OLX</h3><pre>${JSON.stringify(d).slice(0, 500).replace(/[<>&]/g, '')}</pre>`, 400)
    await sb.from('olx_tokens').upsert({ id: 1, access_token: d.access_token, refresh_token: d.refresh_token || null, expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(), scope: d.scope || null, updated_at: new Date().toISOString() })
    return html('<h3>✅ Contul OLX Business e conectat la ERP.</h3><p>Poți închide fereastra și revii în HR → Recrutare.</p>')
  }

  if (req.method !== 'POST') return json({ eroare: 'metoda invalida' }, 405)
  const body = await req.json().catch(() => ({}))
  const act = body.actiune
  if (req.headers.get('x-radar-secret')) {
    // apel intern: DOAR olx_get (proxy read-only), nimic altceva
    if (act !== 'olx_get' || !(await esteIntern(req))) return json({ eroare: 'neautorizat' }, 401)
  } else if (!(await userAutorizat(req))) return json({ eroare: 'neautorizat' }, 401)

  if (act === 'status') {
    const tok = await tokenValid()
    let cont = null
    if (tok) {
      const r = await fetch(`${OLX}/api/partner/users/me`, { headers: olxHeaders(tok) })
      if (r.ok) cont = (await r.json()).data
    }
    return json({ client_id_setat: !!(await secret('OLX_CLIENT_ID')), conectat: !!tok, cont })
  }

  if (act === 'connect-url') {
    const cid = await secret('OLX_CLIENT_ID')
    if (!cid) return json({ eroare: 'OLX_CLIENT_ID nu e setat (env sau app_secrets)' }, 400)
    const state = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('')
    const { error } = await svc().from('app_secrets').upsert({ key: 'OLX_OAUTH_STATE', value: `${state}|${Date.now() + STATE_MIN * 60_000}`, descriere: 'state OAuth OLX (o singura folosire, 15 min)', updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) return json({ eroare: 'nu pot pregati conectarea: ' + error.message }, 500)
    return json({ url: `${OLX}/oauth/authorize/?client_id=${cid}&response_type=code&state=${state}&scope=read+write+v2&redirect_uri=${encodeURIComponent(SELF)}` })
  }

  // Cautare in cache-ul local — nu are nevoie de token OLX.
  if (act === 'orase') {
    const sb = svc()
    const q = fara(body.q || 'Ploiesti')
    // Intai potrivirea exacta (Ploiesti), apoi cele care incep cu textul (Ploiestiori), apoi restul.
    const { data, error } = await sb.from('olx_orase').select('id, name, county, region_id').ilike('name', `%${q}%`).limit(60)
    if (error) return json({ eroare: error.message }, 400)
    const list = (data || []).sort((a: any, b: any) => {
      const ra = fara(a.name) === q ? 0 : fara(a.name).startsWith(q) ? 1 : 2
      const rb = fara(b.name) === q ? 0 : fara(b.name).startsWith(q) ? 1 : 2
      return ra - rb || String(a.name).localeCompare(String(b.name))
    })
    if (!list.length) {
      const { count } = await sb.from('olx_orase').select('id', { count: 'exact', head: true })
      if (!count) return json({ data: [], eroare: 'cache-ul de orase e gol — ruleaza actiunea orase_sync' })
    }
    return json({ data: list.slice(0, 20) })
  }

  const tok = await tokenValid()
  if (!tok) return json({ eroare: 'neconectat la OLX — folosește întâi „Conectează OLX”' }, 400)

  // Umple/actualizeaza cache-ul: OLX da doar limit/offset, ~14 pagini a 1000. Ruleaza rar (lista e stabila).
  if (act === 'orase_sync') {
    const sb = svc()
    let off = 0, total = 0
    for (let pagina = 0; pagina < 60; pagina++) {
      const r = await fetch(`${OLX}/api/partner/cities?limit=1000&offset=${off}`, { headers: olxHeaders(tok) })
      if (!r.ok) return json({ eroare: 'OLX cities ' + r.status, total }, r.status)
      const L = ((await r.json()).data) || []
      if (!L.length) break
      const rows = L.map((c: any) => ({ id: c.id, name: c.name, county: c.county || null, region_id: c.region_id || null, latitude: c.latitude ?? null, longitude: c.longitude ?? null, sincronizat_la: new Date().toISOString() }))
      const { error } = await sb.from('olx_orase').upsert(rows, { onConflict: 'id' })
      if (error) return json({ eroare: error.message, total }, 400)
      total += rows.length; off += 1000
    }
    return json({ ok: true, total })
  }

  if (act === 'districte') {
    const id = Number(body.city_id)
    if (!id) return json({ data: [] })
    const r = await fetch(`${OLX}/api/partner/cities/${id}/districts`, { headers: olxHeaders(tok) })
    if (!r.ok) return json({ data: [] })   // orasele fara sectoare raspund cu eroare/gol — nu e o problema
    const d = await r.json().catch(() => ({}))
    return json({ data: (d.data || []).map((x: any) => ({ id: x.id, name: x.name })) })
  }

  if (act === 'categorii') {
    const r = await fetch(`${OLX}/api/partner/categories/suggestions?q=${encodeURIComponent(body.q || 'inginer constructii')}`, { headers: olxHeaders(tok) })
    return json(await r.json(), r.status)
  }
  if (act === 'anunturi') {
    const r = await fetch(`${OLX}/api/partner/adverts?limit=${Number(body.limit) || 50}&offset=${Number(body.offset) || 0}`, { headers: olxHeaders(tok) })
    return json(await r.json(), r.status)
  }
  if (act === 'anunt') {
    const r = await fetch(`${OLX}/api/partner/adverts/${Number(body.advert_id)}`, { headers: olxHeaders(tok) })
    return json(await r.json(), r.status)
  }
  if (act === 'leaga') {
    const r = await fetch(`${OLX}/api/partner/adverts/${Number(body.advert_id)}`, { headers: olxHeaders(tok) })
    const d = await r.json()
    if (!r.ok) return json({ eroare: 'anunțul nu există în contul OLX', detalii: d }, r.status)
    const a = d.data || d
    const { error } = await svc().from('hr_recrutare_pozitii').update({ olx_advert_id: a.id, olx_url: a.url || null, olx_status: a.status || null, olx_publicat_la: a.created_at || new Date().toISOString() }).eq('id', body.pozitie_id)
    if (error) return json({ eroare: error.message }, 400)
    return json({ ok: true, advert: { id: a.id, title: a.title, status: a.status, url: a.url, valid_to: a.valid_to } })
  }

  if (act === 'activeaza' || act === 'dezactiveaza') {
    const id = Number(body.advert_id)
    const r = await fetch(`${OLX}/api/partner/adverts/${id}/commands`, { method: 'POST', headers: olxHeaders(tok), body: JSON.stringify(act === 'activeaza' ? { command: 'activate' } : { command: 'deactivate', is_success: false }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return json({ eroare: 'OLX a respins comanda', detalii: d }, r.status)
    const r2 = await fetch(`${OLX}/api/partner/adverts/${id}`, { headers: olxHeaders(tok) })
    const a = ((await r2.json()).data) || {}
    if (body.pozitie_id) await svc().from('hr_recrutare_pozitii').update({ olx_status: a.status || null, olx_url: a.url || null }).eq('id', body.pozitie_id)
    return json({ ok: true, advert: { id: a.id, status: a.status, url: a.url, valid_to: a.valid_to } })
  }

  if (act === 'actualizeaza') {
    const id = Number(body.advert_id)
    const r0 = await fetch(`${OLX}/api/partner/adverts/${id}`, { headers: olxHeaders(tok) })
    const cur = ((await r0.json()).data) || {}
    if (!cur.id) return json({ eroare: 'anunțul nu există' }, 404)
    const upd: Record<string, unknown> = {
      title: cur.title, description: cur.description, category_id: cur.category_id, advertiser_type: cur.advertiser_type || 'business',
      contact: cur.contact, location: { city_id: cur.location?.city_id, district_id: cur.location?.district_id || undefined }, attributes: (cur.attributes || []).map((a: any) => ({ code: a.code, value: a.value })),
      ...(cur.salary ? { salary: cur.salary } : {}), ...(body.patch || {}),
    }
    const r = await fetch(`${OLX}/api/partner/adverts/${id}`, { method: 'PUT', headers: olxHeaders(tok), body: JSON.stringify(upd) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return json({ eroare: 'OLX a respins actualizarea', detalii: d, trimis: upd }, r.status)
    const a = d.data || d
    if (body.pozitie_id) await svc().from('hr_recrutare_pozitii').update({ olx_status: a.status || null }).eq('id', body.pozitie_id)
    return json({ ok: true, advert: { id: a.id, status: a.status, salary: a.salary, url: a.url } })
  }

  if (act === 'olx_get') {
    if (!(await esteIntern(req))) return json({ eroare: 'doar intern' }, 403)
    const path = String(body.path || '')
    if (!path.startsWith('/api/partner/')) return json({ eroare: 'path invalid' }, 400)
    const r = await fetch(`${OLX}${path}`, { headers: olxHeaders(tok) })
    return json(await r.json().catch(() => ({})), r.status)
  }

  if (act === 'publica') {
    const sb = svc()
    const { data: poz } = await sb.from('hr_recrutare_pozitii').select('*').eq('id', body.pozitie_id).single()
    if (!poz) return json({ eroare: 'poziția nu există' }, 404)
    const titlu = (body.titlu || `Angajăm ${poz.denumire} — Gazpet Instal Ploiești`).slice(0, 150)
    const descriere = (body.descriere || `${poz.descriere || poz.denumire}\n\nGazpet Instal S.R.L. — constructor autorizat de conducte de gaze naturale (Transgaz, Romgaz, Conpet), Ploiești, Prahova. Echipă de 127+ angajați, proiecte în toată țara.\n\nAplică direct cu CV-ul în formularul nostru online — linkul se află în secțiunea de aplicare a acestui anunț sau pe pagina companiei. Datele tale sunt prelucrate conform GDPR (retenție 12 luni).`)
    if (descriere.length < 80) return json({ eroare: 'descrierea trebuie să aibă minim 80 de caractere' }, 400)
    const location: Record<string, number> = { city_id: Number(body.city_id) }
    if (body.district_id) location.district_id = Number(body.district_id)
    const advert: Record<string, unknown> = {
      title: titlu, description: descriere, category_id: Number(body.category_id), advertiser_type: 'business',
      contact: { name: body.contact_name || 'Gazpet Instal', phone: body.contact_phone || '0244435005' },
      location, attributes: body.attributes || [],
      ...(body.salary ? { salary: body.salary } : {}),
    }
    const r = await fetch(`${OLX}/api/partner/adverts`, { method: 'POST', headers: olxHeaders(tok), body: JSON.stringify(advert) })
    const d = await r.json()
    if (!r.ok) return json({ eroare: 'OLX a respins anunțul', detalii: d }, r.status)
    const a = d.data || d
    await sb.from('hr_recrutare_pozitii').update({ olx_advert_id: a.id || null, olx_url: a.url || null, olx_status: a.status || null, olx_publicat_la: new Date().toISOString() }).eq('id', poz.id)
    return json({ ok: true, advert: { id: a.id, status: a.status, url: a.url, valid_to: a.valid_to } })
  }

  return json({ eroare: 'acțiune necunoscută' }, 400)
})
