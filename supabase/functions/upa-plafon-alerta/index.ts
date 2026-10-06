// upa-plafon-alerta — pe 25 ale lunii (09:00 RO), email la office@gazpet.ro dacă
// plafonul lunar de achiziții de la unități protejate (L448/2006, deductibil din
// taxa de handicap) NU e consumat. Plafonul nu se reportează — ce nu se consumă
// până la finalul lunii se pierde. Setari: logistica_setari (upa_*).
// ?dry=1 → doar raportează.
// v9 (06.10.2026, #17 faza 3, adus în repo de pe live v8): poarta = cronul cu x-intern-secret din Vault sau owner-ul
//   logat (_shared/poartaCron.ts), nu mai INGEST_SECRET; răspunsul fără dry (păstrat de pg_net) fără adrese de mail și
//   fără textul erorii Resend (acela merge în log).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const NO_REPLY = `<p style="color:#c0392b;font-size:13px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat de platformă, căsuța nu e citită de nimeni. Dacă ai o problemă, scrie-i lui Razvan.</p>`
const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await cronSauOwner(req, sb))) return json({ ok: false, error: 'neautorizat' }, 401)
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const { data: st } = await sb.from('logistica_setari').select('key, value').like('key', 'upa_%')
  // deno-lint-ignore no-explicit-any
  const set = Object.fromEntries((st || []).map((s: any) => [s.key, s.value]))
  if (set.upa_alerta_activa !== 'true') return json({ ok: true, skip: 'alerta_oprita' })

  const plafon = Number(set.upa_plafon_lunar || 0)
  if (!plafon) return json({ ok: true, skip: 'fara_plafon' })
  const emails = String(set.upa_alerta_emails || '').split(',').map((e: string) => e.trim()).filter(Boolean)
  if (!emails.length) return json({ ok: false, error: 'fara_destinatari' }, 500)

  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date())
  const luna = azi.slice(0, 7) + '-01'
  const ultimaZi = new Date(Number(azi.slice(0, 4)), Number(azi.slice(5, 7)), 0).getDate()
  const zileRamase = ultimaZi - Number(azi.slice(8, 10))

  const { data: ach } = await sb.from('upa_achizitii').select('valoare').eq('luna', luna)
  // deno-lint-ignore no-explicit-any
  const consumat = (ach || []).reduce((s: number, a: any) => s + Number(a.valoare || 0), 0)
  const ramas = Math.round((plafon - consumat) * 100) / 100
  if (ramas <= 0) return json({ ok: true, skip: 'plafon_consumat', consumat })

  const lunaTxt = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', month: 'long', year: 'numeric' }).format(new Date())
  const html = `<p>Salut!</p>` +
    `<p>Din plafonul lunar de <b>${lei(plafon)} lei</b> pentru achiziții de la <b>unități protejate autorizate</b> (deductibil din taxa de handicap), în ${lunaTxt} s-au consumat doar <b>${lei(consumat)} lei</b>.</p>` +
    `<p style="font-size:16px">⚠️ Mai sunt <b style="color:#c0392b">${lei(ramas)} lei</b> de consumat și <b>${zileRamase} zile</b> până la finalul lunii.</p>` +
    `<p>Plafonul <b>nu se reportează</b> — ce nu se facturează de la o unitate protejată până pe ${ultimaZi} se plătește integral la stat, fără nimic în schimb. Idei rapide: hârtie A4, papetărie, produse de curățenie, EIP, tipizate.</p>` +
    `<p>Evidența: <a href="https://pontaj-pro-sooty.vercel.app/administrativ">PontajPRO → Administrativ → Unități protejate</a> (acolo se și înregistrează facturile).</p>`

  if (dry) return json({ ok: true, dry: true, plafon, consumat, ramas, zileRamase, destinatari: emails })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to: emails,
      subject: `♿ Plafon unități protejate: mai sunt ${lei(ramas)} lei de consumat în ${lunaTxt}`, html: html + NO_REPLY }),
  })
  if (!res.ok) { console.error('resend', await res.text()); return json({ ok: false, error: 'resend' }, 500) }
  return json({ ok: true, nr_destinatari: emails.length, plafon, consumat, ramas })
})
