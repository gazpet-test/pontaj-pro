// noutati-mail — trimite pe mail intrarile netrimise din platforma_noutati (Resend)
// Acces: header x-noutati-secret (= secretul NOUTATI_SECRET din Edge Secrets) SAU JWT de owner.
// 07.10.2026: secretul nu mai e in cod (era hardcodat, v8) — fail-closed daca lipseste din Edge Secrets.
// Erorile de business se scriu in raspuns (nu throw).
import { createClient } from 'npm:@supabase/supabase-js@2.39.0'

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'

// comparatie in timp constant (fara scurtcircuit pe primul caracter diferit)
function egal(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b)
  let d = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return d === 0
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-noutati-secret' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // autorizare: secretul din Edge Secrets (min. 24 caractere, altfel calea e inchisa) sau JWT de owner
  const SECRET = Deno.env.get('NOUTATI_SECRET') || ''
  const hdr = req.headers.get('x-noutati-secret') || ''
  let ok = SECRET.length >= 24 && hdr.length > 0 && egal(hdr, SECRET)
  if (!ok) {
    const jwt = (req.headers.get('authorization') || '').replace('Bearer ', '')
    if (jwt) {
      const { data: { user } } = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: 'Bearer ' + jwt } } }).auth.getUser()
      if (user) {
        const { data: p } = await sb.from('profiles').select('is_owner').eq('id', user.id).maybeSingle()
        ok = p?.is_owner === true
      }
    }
  }
  if (!ok) return json({ error: 'neautorizat' }, 401)

  const RESEND = Deno.env.get('RESEND_API_KEY')
  if (!RESEND) return json({ error: 'RESEND_API_KEY lipsa' })

  const { data: rows } = await sb.from('platforma_noutati').select('*').is('trimis_la', null).order('id')
  const rezultate: Record<string, string> = {}
  for (const r of (rows || [])) {
    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
        <div style="background:#1F6FEB;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">🆕 Noutăți în PontajPRO</div>
        <div style="padding:24px">
          <div style="font-size:16px;font-weight:700;margin-bottom:12px">${esc(r.titlu)}</div>
          <div style="font-size:14px;line-height:1.6;white-space:pre-line">${esc(r.descriere)}</div>
          <div style="margin-top:20px"><a href="https://pontaj-pro-sooty.vercel.app" style="background:#238636;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide platforma</a></div>
          <div style="margin-top:16px;font-size:12px;color:#8B949E">Mail automat din PontajPRO. Întrebări → Răzvan.</div>
        </div>
      </div>`
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: r.destinatari, subject: '🆕 PontajPRO: ' + r.titlu, html }),
    })
    const body = await resp.text()
    if (resp.ok) {
      await sb.from('platforma_noutati').update({ trimis_la: new Date().toISOString() }).eq('id', r.id)
      rezultate[r.id] = 'trimis'
    } else {
      rezultate[r.id] = 'eroare: ' + body.slice(0, 200)
    }
  }
  return json({ procesate: (rows || []).length, rezultate })
})
