// ═══════════════════════════════════════════════════════════════════════════
// redirect-mai-gov — 25.08.2026 · v9 05.10.2026 (#17 faza 2, adus în repo de pe live v8)
// ───────────────────────────────────────────────────────────────────────────
// Mailurile de la hub.mai.gov.ro (coduri de autentificare + confirmări de
// rezervare pentru înregistrările de emigranți) vin pe razvan.trusu@gazpet.ro,
// dar de ele au nevoie Natalia și Marilena.
//
// De ce NU prin redirecționarea nativă Gmail: Gmail cere ca fiecare adresă de
// destinație să confirme printr-un cod, iar ele nu-s pe Google (domeniul are MX
// pe Google, dar cutiile lor sunt rutate spre serverul local) — mailul de
// confirmare se pierde prin filtre. Platforma citește direct prin Gmail API
// (același refresh token ca import-evogps-gmail) și retrimite prin Resend,
// semnat DKIM pe gazpet.ro.
//
// Codul din 6 cifre e scos din corp și pus ÎN SUBIECTUL mailului retrimis, ca
// să se vadă direct în notificarea de pe telefon. Codurile expiră în 2 minute.
//
// v9 (#17 F2, claude_context #1602):
//   - poarta: cronul cu x-intern-secret din Vault (INTERN_EDGE_SECRET) sau owner-ul logat — nu mai INGEST_SECRET,
//     care stă și în Apps Script-ul Gmail;
//   - răspunsul HTTP NU mai conține codul, subiectul, destinatarii sau textul (pg_net îl păstrează în
//     net._http_response) — vezi raport.ts;
//   - codul NU se mai scrie în mai_gov_redirect_log (expiră în 2 minute, nu are valoare de audit);
//   - dry=1 respectă comutatorul mai_gov_redirect_activ (înainte îl ocolea).
//
// Idempotență: unique pe gmail_msg_id în mai_gov_redirect_log. Se scrie rândul
// ÎNAINTE de trimitere; dacă rândul există deja, mesajul se sare.
//
// Latență: cron-ul pornește funcția o dată pe minut, iar funcția verifică de
// POLLS ori la interval de PAUSE_MS în interiorul aceleiași invocări → ~10s.
//
// Apel:  POST  x-intern-secret: <Vault INTERN_EDGE_SECRET>   (sau JWT de owner)
//        ?dry=1     → doar raportează stări, nu trimite, nu scrie în jurnal
//        ?polls=N   → câte verificări într-o invocare (default 6)
//        ?minute=N  → cât de vechi poate fi mesajul (default 30)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { esteApelIntern } from '../_shared/poartaIntern.ts'
import { raspunsPublic, type Rand } from './raport.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const GMAIL_CLIENT_ID = (Deno.env.get('GMAIL_CLIENT_ID') ?? '').trim()
const GMAIL_CLIENT_SECRET = (Deno.env.get('GMAIL_CLIENT_SECRET') ?? '').trim()
const GMAIL_REFRESH_TOKEN = (Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '').trim()
const RESEND_API_KEY = (Deno.env.get('RESEND_API_KEY') ?? '').trim()

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const NO_REPLY = `<p style="color:#c0392b;font-size:12px;margin-top:18px">⚠️ <b>Nu răspunde la acest email</b> — e retrimis automat de platformă din căsuța lui Răzvan. Dacă e o problemă cu redirecționarea, scrie-i lui Răzvan.</p>`

// ── Gmail REST ─────────────────────────────────────────────────────────────
async function gmailToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  })
  const j = await res.json()
  if (!res.ok || !j.access_token) throw new Error('OAuth Gmail: ' + (j.error || res.status))
  return j.access_token
}

const gFetch = (token: string, path: string) =>
  fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return new TextDecoder('utf-8').decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

function findBody(payload: any, mime: string): string | null {
  if (!payload) return null
  if (payload.mimeType === mime && payload.body?.data) return b64urlDecode(payload.body.data)
  for (const p of payload.parts || []) { const r = findBody(p, mime); if (r) return r }
  return null
}

const hdr = (headers: any[], name: string) =>
  (headers || []).find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

// ── Clasificare + extragere cod ────────────────────────────────────────────
function clasifica(subiect: string, corp: string) {
  const s = (subiect || '').toLowerCase()
  const cod = (corp.match(/este\s*:?\s*(\d{4,10})/i) || [])[1] || null
  let tip = 'altul'
  if (/cod\s+autentificare/.test(s) || cod) tip = 'cod'
  else if (/autentificare/.test(s)) tip = 'autentificare'
  else if (/rezervare/.test(s)) tip = 'rezervare'
  return { tip, cod: tip === 'cod' ? cod : null }
}

const esc = (s: string) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function compune(tip: string, cod: string | null, subiect: string, corp: string, primitLa: Date) {
  const ora = new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(primitLa)

  const subject = cod
    ? `🔐 Cod hub.mai.gov.ro: ${cod}`
    : `📬 ${subiect || 'Mesaj de la hub.mai.gov.ro'}`

  const capCod = cod
    ? `<p style="margin:0 0 6px;font-size:13px;color:#555">Cod de autentificare hub.mai.gov.ro — primit la <b>${ora}</b>, expiră în ~2 minute:</p>
       <div style="font-size:38px;font-weight:800;letter-spacing:7px;font-family:monospace;background:#f4f6f8;border:2px solid #d0d7de;border-radius:10px;padding:14px 20px;display:inline-block">${esc(cod)}</div>`
    : `<p style="margin:0 0 6px;font-size:13px;color:#555">Mesaj primit de la hub.mai.gov.ro la <b>${ora}</b>:</p>
       <p style="font-size:16px;font-weight:700">${esc(subiect)}</p>`

  const html = capCod +
    `<div style="margin-top:18px;padding-top:12px;border-top:1px solid #e1e4e8">
       <p style="font-size:11px;color:#888;margin:0 0 6px">Textul original al mesajului:</p>
       <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;color:#444;margin:0">${esc((corp || '').slice(0, 4000))}</pre>
     </div>` + NO_REPLY

  return { subject, html }
}

// ── Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Poarta: cronul (secret din Vault) sau owner-ul logat (probă manuală)
  if (!(await esteApelIntern(req, sb))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
    if (!u?.user) return json({ ok: false, error: 'neautorizat' }, 401)
    const { data: prof } = await sb.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle()
    if (prof?.is_owner !== true) return json({ ok: false, error: 'doar owner-ul' }, 403)
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const polls = dry ? 1 : Math.min(10, Math.max(1, Number(url.searchParams.get('polls') || 6)))
  const maxAgeMin = Math.min(1440, Math.max(1, Number(url.searchParams.get('minute') || 30)))
  const PAUSE_MS = 9000

  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    return json({ ok: false, error: 'gmail_not_configured' }, 500)
  }
  if (!RESEND_API_KEY) return json({ ok: false, error: 'resend_not_configured' }, 500)

  const { data: setari } = await sb.from('settings').select('key, value')
    .in('key', ['mai_gov_redirect_activ', 'mai_gov_redirect_emails', 'mai_gov_redirect_from'])
  const set = Object.fromEntries((setari || []).map((s: any) => [s.key, s.value]))

  // v9: comutatorul se respectă și la dry=1
  if (set.mai_gov_redirect_activ !== 'true') {
    return json({ ok: true, skip: 'redirect_oprit' })
  }
  const emails = String(set.mai_gov_redirect_emails || '').split(',').map((e: string) => e.trim()).filter(Boolean)
  if (!emails.length) return json({ ok: false, error: 'fara_destinatari' }, 500)
  const senderFilter = String(set.mai_gov_redirect_from || 'hub.mai.gov.ro').trim()

  const raport: Rand[] = []
  let token: string
  try { token = await gmailToken() } catch (_e) { return json({ ok: false, error: 'oauth' }, 500) }

  for (let pass = 0; pass < polls; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, PAUSE_MS))

    try {
      const q = encodeURIComponent(`from:${senderFilter} newer_than:1d`)
      const listRes = await gFetch(token, `messages?q=${q}&maxResults=15`)
      const listJson = await listRes.json()
      const messages = listJson.messages || []
      if (!messages.length) continue

      // Doar mesajele deja cunoscute se sar fără a le mai citi din Gmail.
      const ids = messages.map((m: any) => m.id)
      const { data: cunoscute } = await sb.from('mai_gov_redirect_log')
        .select('gmail_msg_id').in('gmail_msg_id', ids)
      const vazute = new Set((cunoscute || []).map((r: any) => r.gmail_msg_id))
      const noi = messages.filter((m: any) => !vazute.has(m.id))
      if (!noi.length) continue

      for (const m of noi) {
        try {
          const msg = await (await gFetch(token, `messages/${m.id}?format=full`)).json()
          const primitLa = new Date(Number(msg.internalDate || Date.now()))
          const vechimeMin = (Date.now() - primitLa.getTime()) / 60000
          if (vechimeMin > maxAgeMin) continue  // mesaj vechi — codul oricum a expirat

          const headers = msg.payload?.headers || []
          const subiect = hdr(headers, 'Subject')
          const expeditor = hdr(headers, 'From')
          const corp = findBody(msg.payload, 'text/plain')
            || (findBody(msg.payload, 'text/html') || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            || msg.snippet || ''
          const { tip, cod } = clasifica(subiect, corp)
          const { subject, html } = compune(tip, cod, subiect, corp, primitLa)

          if (dry) { raport.push({ msg_id: m.id, status: 'dry', tip }); continue }

          // Rezervă mesajul ÎNAINTE de trimitere — dacă rândul există deja,
          // altă invocare l-a luat și noi ne oprim aici. Codul NU se scrie în jurnal (v9).
          const { data: rez, error: rezErr } = await sb.from('mai_gov_redirect_log')
            .upsert({
              gmail_msg_id: m.id, primit_la: primitLa.toISOString(), expeditor,
              subiect, tip, cod: null, destinatari: emails, status: 'in_lucru',
            }, { onConflict: 'gmail_msg_id', ignoreDuplicates: true })
            .select('id')
          if (rezErr) { raport.push({ msg_id: m.id, status: 'eroare_db', detaliu: rezErr.message }); continue }
          if (!rez || !rez.length) { raport.push({ msg_id: m.id, status: 'deja_trimis' }); continue }

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: FROM, to: emails, subject, html }),
          })

          if (!res.ok) {
            const detaliu = (await res.text()).slice(0, 500)
            await sb.from('mai_gov_redirect_log').update({ status: 'eroare', eroare: detaliu }).eq('id', rez[0].id)
            raport.push({ msg_id: m.id, status: 'eroare_resend', detaliu })
          } else {
            await sb.from('mai_gov_redirect_log')
              .update({ status: 'trimis', trimis_la: new Date().toISOString() }).eq('id', rez[0].id)
            raport.push({ msg_id: m.id, status: 'trimis', tip })
          }
        } catch (e) {
          // Erorile de business se scriu și se raportează, NU se aruncă
          // (throw în try + update în catch omoară worker-ul intermitent).
          raport.push({ msg_id: m.id, status: 'eroare', detaliu: String((e as Error).message || e) })
        }
      }
    } catch (e) {
      raport.push({ pass, status: 'eroare_listare', detaliu: String((e as Error).message || e) })
    }
  }

  return json(raspunsPublic({ dry, polls, nrDestinatari: emails.length, raport }))
})
