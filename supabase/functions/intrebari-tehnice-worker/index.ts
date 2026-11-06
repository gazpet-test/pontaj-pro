// intrebari-tehnice-worker v1 (05.11.2026, migrarea 20261105a) — canalul serverului AI către „❓ Întreabă echipa”.
// DEPLOY cu verify_jwt = false: poarta e secretul din Vault INTREBARI_WORKER_SECRET (64 hex), antetul x-intrebari-secret.
//
// Cereri (POST, JSON):
//   { "actiune": "preia" }  → 200 { intrebare: null } sau { intrebare: {id, incercare, titlu, intrebare, context, creat_la,
//                              atasamente: [{nume, mime, url}]} } — url = null dacă semnarea a eșuat (workerul NU răspunde atunci)
//   { "actiune": "raspunde", "id": n, "incercare": uuid, "raspuns_md": "...", "model": "...", "tokeni": {...},
//     "surse": [{id: "C1"|"W1", tip: "corpus"|"web", cale|url, titlu, extras}] }                             → 200 / 409
//   (v2, 06.11.2026: cere migrarea 20261131e — fn_intrebari_raspunde cu p_surse; deploy DUPĂ migrare)
//   { "actiune": "eroare",   "id": n, "incercare": uuid, "eroare": "..." }                                       → 200 / 409
//   { "actiune": "amana",    "id": n, "incercare": uuid }  — doar refuz CERT fără cost (429/529)                 → 200 / 409
// 409 = preluarea nu mai e cea curentă (expirată / finalizată): rezultatul întârziat nu închide altă preluare.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN: întrebările și atașamentele utilizatorilor trec prin edge spre worker — nu sunt interpretate aici;
//  (b) scrie DOAR răspunsul/eroarea pe rândul „în lucru” (fn_intrebari_raspunde) + notificarea autorului; emite URL-uri semnate de citire
//      (300 s) doar pentru atașamentele întrebării preluate; fără mail, bani sau drepturi;
//  (c) service_role: apelantul (serverul AI) n-are cont Supabase; RPC-urile și createSignedUrl îl cer;
//  (d) cine pornește: doar deținătorul INTREBARI_WORKER_SECRET (fn_verifica_secret, fail closed);
//  (e) confirmare umană: nu e cazul — răspunsul e informativ, ajunge doar la autor.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { citesteCorp, esteId, esteObiect, raspuns } from '../_shared/ocrLocal.ts'

const ANTET = 'x-intrebari-secret'
const NUME_SECRET = 'INTREBARI_WORKER_SECRET'
const BUCKET = 'intrebari-tehnice'
const VALABIL_SEC = 300
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CALE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/
// v2 (06.11.2026, migrarea 20261131e): răspunsul vine cu sursele citate. Aceeași listă fixă ca worker/intrebari-tehnice/cercetare.py
// și src/intrebariSurse.js (testul vitest „domenii identice”). O sursă web în afara listei sau o cale de corpus în afara docs/ se aruncă.
const DOMENII_OFICIALE = [
  'legislatie.just.ro', 'monitoruloficial.ro', 'iscir.ro', 'anre.ro', 'isc.gov.ro', 'igsu.ro',
  'transgaz.ro', 'anap.gov.ro', 'e-licitatie.ro', 'eur-lex.europa.eu', 'magazin.asro.ro',
]
const SURSE_MAX = 30

function urlOficial(x: unknown): boolean {
  if (typeof x !== 'string' || x.length > 500) return false
  let u: URL
  try { u = new URL(x) } catch (_) { return false }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false
  const h = u.hostname.toLowerCase().replace(/\.$/, '')
  return DOMENII_OFICIALE.some(d => h === d || h.endsWith('.' + d))
}

function curataSurse(x: unknown): Record<string, string>[] {
  if (!Array.isArray(x)) return []
  const out: Record<string, string>[] = []
  for (const s of x) {
    if (out.length >= SURSE_MAX) break
    if (!esteObiect(s) || typeof s.id !== 'string' || !/^[CW]\d{1,2}$/.test(s.id)) continue
    const titlu = String(s.titlu ?? '').slice(0, 300), extras = String(s.extras ?? '').slice(0, 1500)
    if (s.tip === 'web' && urlOficial(s.url)) out.push({ id: s.id, tip: 'web', url: String(s.url), titlu, extras })
    else if (s.tip === 'corpus' && typeof s.cale === 'string' && /^docs\/[A-Za-z0-9_\-./]{1,250}$/.test(s.cale) && !s.cale.includes('..'))
      out.push({ id: s.id, tip: 'corpus', cale: s.cale, titlu, extras })
  }
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const url = Deno.env.get('SUPABASE_URL'), cheie = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !cheie) return raspuns(500, { error: 'Configurare lipsă' })
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })

  const antet = req.headers.get(ANTET) || ''
  if (!/^[0-9a-f]{64}$/.test(antet)) return raspuns(401, { error: 'Neautorizat' })
  try {
    const { data, error } = await sb.rpc('fn_verifica_secret', { p_nume: NUME_SECRET, p_secret: antet })
    if (error || data !== true) return raspuns(401, { error: 'Neautorizat' })
  } catch (_) { return raspuns(401, { error: 'Neautorizat' }) }

  const c = await citesteCorp(req, 200_000)
  if (!c.ok) return raspuns(c.status, { error: c.error })
  const corp = c.corp
  if (!esteObiect(corp)) return raspuns(400, { error: 'Corp invalid' })

  if (corp.actiune === 'preia') {
    const { data, error } = await sb.rpc('fn_intrebari_preia')
    if (error) return raspuns(500, { error: 'Eroare internă' })
    if (!esteObiect(data)) return raspuns(200, { intrebare: null })
    const atasamente: { nume: string; mime: string; url: string | null }[] = []
    for (const a of (Array.isArray(data.atasamente) ? data.atasamente : [])) {
      const nume = esteObiect(a) ? String(a.nume || 'atașament').slice(0, 200) : 'atașament'
      let semnat: string | null = null
      if (esteObiect(a) && typeof a.path === 'string' && CALE.test(a.path)) {
        const { data: s, error: e } = await sb.storage.from(BUCKET).createSignedUrl(a.path, VALABIL_SEC)
        if (!e && s?.signedUrl) semnat = s.signedUrl
      }
      // atașament indisponibil = url null, nu omis: workerul refuză să răspundă pe documente incomplete (review P1-3)
      atasamente.push({ nume, mime: esteObiect(a) ? String(a.mime || '') : '', url: semnat })
    }
    return raspuns(200, { intrebare: { id: data.id, incercare: data.incercare, titlu: data.titlu, intrebare: data.intrebare, context: data.context ?? null,
                                       creat_la: data.creat_la, atasamente } })
  }

  if ((corp.actiune === 'raspunde' || corp.actiune === 'eroare' || corp.actiune === 'amana')
      && (!esteId(corp.id) || typeof corp.incercare !== 'string' || !UUID.test(corp.incercare))) {
    return raspuns(400, { error: 'id / incercare invalide' })
  }
  if (corp.actiune === 'amana') {
    const { data, error } = await sb.rpc('fn_intrebari_amana', { p_id: corp.id, p_incercare: corp.incercare })
    if (error) return raspuns(500, { error: 'Eroare internă' })
    return raspuns(data === true ? 200 : 409, { ok: data === true })
  }
  if (corp.actiune === 'raspunde' || corp.actiune === 'eroare') {
    const eRaspuns = corp.actiune === 'raspunde'
    const text = eRaspuns ? corp.raspuns_md : corp.eroare
    if (typeof text !== 'string' || !text.trim() || text.length > (eRaspuns ? 60000 : 500)) return raspuns(400, { error: 'Text invalid' })
    const tokeni = esteObiect(corp.tokeni) ? corp.tokeni : null
    const { data, error } = await sb.rpc('fn_intrebari_raspunde', {
      p_id: corp.id, p_incercare: corp.incercare, p_raspuns: eRaspuns ? text : null, p_model: typeof corp.model === 'string' ? corp.model : null,
      p_tokeni: tokeni, p_eroare: eRaspuns ? null : text, p_surse: eRaspuns ? curataSurse(corp.surse) : [],
    })
    if (error) return raspuns(500, { error: 'Eroare internă' })
    return raspuns(data === true ? 200 : 409, { ok: data === true })
  }

  return raspuns(400, { error: 'Acțiune necunoscută' })
})
