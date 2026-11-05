// intrebari-tehnice-worker v1 (05.11.2026, migrarea 20261105a) — canalul serverului AI către „❓ Întreabă echipa”.
// DEPLOY cu verify_jwt = false: poarta e secretul din Vault INTREBARI_WORKER_SECRET (64 hex), antetul x-intrebari-secret.
//
// Cereri (POST, JSON):
//   { "actiune": "preia" }                                          → 200 { intrebare: null } sau { intrebare: {id, titlu, intrebare,
//                                                                       context, creat_la, atasamente: [{nume, mime, url}]} } (URL 5 min)
//   { "actiune": "raspunde", "id": n, "raspuns_md": "...", "model": "...", "tokeni": {...} }   → 200 { ok }
//   { "actiune": "eroare",   "id": n, "eroare": "..." }                                       → 200 { ok }
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
const CALE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/

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
    const atasamente: { nume: string; mime: string; url: string }[] = []
    for (const a of (Array.isArray(data.atasamente) ? data.atasamente : [])) {
      if (!esteObiect(a) || typeof a.path !== 'string' || !CALE.test(a.path)) continue
      const { data: s, error: e } = await sb.storage.from(BUCKET).createSignedUrl(a.path, VALABIL_SEC)
      if (e || !s?.signedUrl) continue
      atasamente.push({ nume: String(a.nume || '').slice(0, 200), mime: String(a.mime || ''), url: s.signedUrl })
    }
    return raspuns(200, { intrebare: { id: data.id, titlu: data.titlu, intrebare: data.intrebare, context: data.context ?? null,
                                       creat_la: data.creat_la, atasamente } })
  }

  if (corp.actiune === 'raspunde' || corp.actiune === 'eroare') {
    if (!esteId(corp.id)) return raspuns(400, { error: 'id invalid' })
    const eRaspuns = corp.actiune === 'raspunde'
    const text = eRaspuns ? corp.raspuns_md : corp.eroare
    if (typeof text !== 'string' || !text.trim() || text.length > (eRaspuns ? 60000 : 500)) return raspuns(400, { error: 'Text invalid' })
    const tokeni = esteObiect(corp.tokeni) ? corp.tokeni : null
    const { data, error } = await sb.rpc('fn_intrebari_raspunde', {
      p_id: corp.id, p_raspuns: eRaspuns ? text : null, p_model: typeof corp.model === 'string' ? corp.model : null,
      p_tokeni: tokeni, p_eroare: eRaspuns ? null : text,
    })
    if (error) return raspuns(500, { error: 'Eroare internă' })
    return raspuns(data === true ? 200 : 409, { ok: data === true })
  }

  return raspuns(400, { error: 'Acțiune necunoscută' })
})
