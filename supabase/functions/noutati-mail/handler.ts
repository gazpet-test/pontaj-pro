// noutati-mail â€” trimite pe mail intrarile netrimise din platforma_noutati (Resend)
// Acces: header x-noutati-secret (= secretul NOUTATI_SECRET din Edge Secrets) SAU JWT de owner.
// 07.10.2026: secretul nu mai e in cod (era hardcodat, v8) â€” fail-closed daca lipseste din Edge Secrets.
// Erorile de business se scriu in raspuns (nu throw).
import { authorized } from './auth.ts'

type Deps = { createClient: (...args: any[]) => any; env: (name: string) => string | undefined; fetcher: typeof fetch }

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function createHandler({ createClient, env, fetcher }: Deps) {
 return async (req: Request): Promise<Response> => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-noutati-secret' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'metoda_nepermisa' }, 405)
  const ok = await authorized(req, env('NOUTATI_SECRET'), async (jwt) => {
    const { data, error } = await createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: 'Bearer ' + jwt } },
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.getUser(jwt)
    if (error || !data?.user?.id) return false
    const { data: profile, error: profileError } = await createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)
      .from('profiles').select('is_owner').eq('id', data.user.id).maybeSingle()
    return !profileError && profile?.is_owner === true
  })
  if (!ok) return json({ error: 'neautorizat' }, 401)
  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)

  const RESEND = env('RESEND_API_KEY')
  if (!RESEND) return json({ error: 'configurare_mail_lipsa' }, 503)

  const { data: rows, error: readError } = await sb.from('platforma_noutati').select('*').is('trimis_la', null).order('id')
  if (readError) return json({ error: 'citire_coada_esuata' }, 503)
  const rezultate: Record<string, string> = {}
  for (const r of (rows || [])) {
    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
        <div style="background:#1F6FEB;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">ðŸ†• NoutÄƒÈ›i Ã®n PontajPRO</div>
        <div style="padding:24px">
          <div style="font-size:16px;font-weight:700;margin-bottom:12px">${esc(r.titlu)}</div>
          <div style="font-size:14px;line-height:1.6;white-space:pre-line">${esc(r.descriere)}</div>
          <div style="margin-top:20px"><a href="https://pontaj-pro-sooty.vercel.app" style="background:#238636;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide platforma</a></div>
          <div style="margin-top:16px;font-size:12px;color:#8B949E">Mail automat din PontajPRO. ÃŽntrebÄƒri â†’ RÄƒzvan.</div>
        </div>
      </div>`
    const resp = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: r.destinatari, subject: 'ðŸ†• PontajPRO: ' + r.titlu, html }),
    })
    await resp.text() // never return provider response bodies (may contain sensitive details)
    if (resp.ok) {
      const { error: updateError } = await sb.from('platforma_noutati').update({ trimis_la: new Date().toISOString() }).eq('id', r.id)
      rezultate[r.id] = updateError ? 'trimis_marcaj_esuat' : 'trimis'
    } else {
      rezultate[r.id] = 'eroare_furnizor_' + resp.status
    }
  }
  return json({ procesate: (rows || []).length, rezultate })
 }
}
