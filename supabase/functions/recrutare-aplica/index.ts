// Formular public de aplicare Gazpet Instal — destinația linkului din anunțurile OLX/eJobs.
// GET -> pagina HTML cu pozițiile deschise; POST (multipart) -> candidat nou + CV în bucketul privat recrutare-cv.
// v2: notificare pe mail (Resend) la fiecare aplicare nouă.
// v4 (07.09.2026): fix — răspunsul ajungea la browser ca text/plain (candidatul vedea codul HTML + diacritice stricate);
//   headerul se pune acum prin obiect Headers explicit. + contact direct HR (WhatsApp/e-mail) pe pagină și Natalia la notificări.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const DESTINATARI = ['razvan.trusu@gazpet.ro', 'natalia.udrea@gazpet.ro']
const HR_TEL = '+40 722 146 845'
const HR_MAIL = 'natalia.udrea@gazpet.ro'
const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, accept', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const jsonResp = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: new Headers({ ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) })
const htmlResp = (body: string, status = 200) => new Response(body, { status, headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }) })

const ipHits = new Map<string, { n: number, t: number }>()
function rateLimited(ip: string) {
  const now = Date.now()
  const h = ipHits.get(ip)
  if (!h || now - h.t > 3600_000) { ipHits.set(ip, { n: 1, t: now }); return false }
  h.n++
  return h.n > 10
}

function pagina(pozitii: { id: number, denumire: string, descriere: string | null }[], mesaj = '') {
  const opts = pozitii.map(p => `<option value="${p.id}">${esc(p.denumire)}</option>`).join('')
  const descs = pozitii.map(p => `<div class="desc" data-poz="${p.id}" hidden>${esc(p.descriere || '')}</div>`).join('')
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aplică la Gazpet Instal</title><style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px;color:#1a2733}
.card{max-width:560px;margin:24px auto;background:#fff;border-radius:12px;box-shadow:0 2px 14px #0002;padding:28px}
h1{font-size:21px;margin:0 0 4px;color:#0b4f8a}.sub{color:#5a6b7b;font-size:13px;margin-bottom:18px}
label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px;color:#3a4a5a;text-transform:uppercase;letter-spacing:.3px}
input,select,textarea{width:100%;padding:10px 12px;border:1px solid #cdd6de;border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff}
.desc{font-size:13px;background:#eef5fb;border:1px solid #cfe3f5;border-radius:8px;padding:10px 12px;color:#28425c;margin-top:8px;white-space:pre-wrap}
.gdpr{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#5a6b7b;margin-top:14px}.gdpr input{width:auto;margin-top:2px}
button{margin-top:18px;width:100%;padding:13px;background:#0b7a3b;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer}
button:disabled{opacity:.6}.ok{background:#e7f7ec;border:1px solid #b2e2c3;color:#186a34;padding:12px;border-radius:8px;font-size:14px;margin-bottom:14px}
.err{background:#fdeeee;border:1px solid #f2c2c2;color:#a33;padding:12px;border-radius:8px;font-size:14px;margin-bottom:14px}
.contact{background:#fff8e6;border:1px solid #f1dfa6;border-radius:8px;padding:10px 12px;font-size:13px;color:#5a4a1a;margin-top:16px}
.contact a{color:#0b4f8a;font-weight:700;text-decoration:none}
.foot{text-align:center;font-size:11px;color:#8a99a8;margin-top:16px}
</style></head><body><div class="card">
<h1>GAZPET INSTAL S.R.L.</h1><div class="sub">Construcții conducte gaze naturale · Ploiești, Prahova</div>
${mesaj}
${pozitii.length ? `<form method="post" enctype="multipart/form-data" onsubmit="document.getElementById('b').disabled=true">
<label>Postul pentru care aplici / Position</label><select name="pozitie_id" id="poz" required onchange="document.querySelectorAll('.desc').forEach(d=>d.hidden=d.dataset.poz!==this.value)">${opts}</select>
${descs}
<label>Nume și prenume / Full name *</label><input name="nume" required maxlength="120">
<label>Telefon / Phone *</label><input name="telefon" required maxlength="30">
<label>E-mail</label><input name="email" type="email" maxlength="120">
<label>Localitatea / City</label><input name="oras" maxlength="80">
<label>Mesaj / experiență pe scurt / Short message</label><textarea name="mesaj" rows="3" maxlength="2000"></textarea>
<label>CV (PDF sau Word, max 10 MB)</label><input name="cv" type="file" accept=".pdf,.doc,.docx,.jpg,.png" required>
<div class="gdpr"><input type="checkbox" name="gdpr" required id="g"><label for="g" style="text-transform:none;font-weight:400;margin:0">Sunt de acord ca Gazpet Instal S.R.L. să îmi prelucreze datele personale și CV-ul în scop de recrutare, cu păstrare timp de 12 luni de la ultima interacțiune, conform GDPR. Pot cere oricând ștergerea datelor la office@gazpet.ro. / I agree that Gazpet Instal S.R.L. processes my personal data and CV for recruitment purposes (12-month retention, GDPR).</label></div>
<button id="b" type="submit">Trimite aplicația / Apply</button>
</form><script>document.querySelectorAll('.desc').forEach(d=>d.hidden=d.dataset.poz!==document.getElementById('poz').value)</script>` : '<div class="desc">Momentan nu sunt posturi deschise. Revino curând!</div>'}
<div class="contact">📲 Preferi direct? Trimite CV-ul pe WhatsApp la <a href="https://wa.me/40722146845">${HR_TEL}</a> sau pe e-mail la <a href="mailto:${HR_MAIL}">${HR_MAIL}</a>. Te sunăm noi.</div>
<div class="foot">gazpet.ro · datele sunt transmise securizat și vizibile doar echipei de recrutare</div>
</div></body></html>`
}

async function notifica(nume: string, telefon: string, email: string | null, oras: string | null, pozitie: string, mesaj: string) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'PontajPRO <rapoarte@gazpet.ro>', to: DESTINATARI,
        subject: `🧲 Aplicare nouă: ${nume} — ${pozitie}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c">` +
          `<h2 style="margin:0 0 8px">Candidat nou în Recrutare</h2>` +
          `<p style="margin:0 0 4px"><b>${esc(nume)}</b> — ${esc(pozitie)}</p>` +
          `<p style="margin:0 0 4px">📞 ${esc(telefon)}${email ? ' · ✉️ ' + esc(email) : ''}${oras ? ' · ' + esc(oras) : ''}</p>` +
          (mesaj ? `<p style="margin:8px 0;color:#4a5a6a;white-space:pre-wrap">${esc(mesaj)}</p>` : '') +
          `<p style="margin:12px 0 0"><a href="https://pontaj-pro-sooty.vercel.app">HR → Recrutare (CV-ul e atașat candidatului)</a></p>` +
          `<p style="color:#c0392b;font-size:12px;margin-top:14px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat.</p></div>`,
      }),
    })
  } catch { /* notificarea nu blochează aplicarea */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  // v5: pagina publică e pe Vercel (/aplica) — Supabase rescrie HTML-ul funcțiilor în text/plain; aici răspundem JSON când e cerut
  const vreaJson = new URL(req.url).searchParams.get('format') === 'json' || (req.headers.get('accept') || '').includes('application/json')
  const supa = sb()
  const { data: pozitii } = await supa.from('hr_recrutare_pozitii')
    .select('id, denumire, descriere').eq('status', 'deschisa').is('deleted_at', null).order('id')

  if (req.method === 'GET') return vreaJson ? jsonResp({ ok: true, pozitii: pozitii || [] }) : htmlResp(pagina(pozitii || []))

  if (req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'necunoscut'
    if (rateLimited(ip)) return vreaJson ? jsonResp({ error: 'Prea multe aplicații de la această adresă. Încearcă mai târziu.' }, 429) : htmlResp(pagina(pozitii || [], '<div class="err">Prea multe aplicații de la această adresă. Încearcă mai târziu.</div>'), 429)
    try {
      const form = await req.formData()
      const nume = String(form.get('nume') || '').trim().slice(0, 120)
      const telefon = String(form.get('telefon') || '').trim().slice(0, 30)
      const email = String(form.get('email') || '').trim().slice(0, 120) || null
      const oras = String(form.get('oras') || '').trim().slice(0, 80) || null
      const mesaj = String(form.get('mesaj') || '').trim().slice(0, 2000)
      const pozitieId = parseInt(String(form.get('pozitie_id') || ''), 10)
      const gdpr = form.get('gdpr') != null
      const cv = form.get('cv') as File | null
      const poz = (pozitii || []).find(p => p.id === pozitieId)
      if (!nume || !telefon || !gdpr || !cv || !poz) {
        return vreaJson ? jsonResp({ error: 'Completează câmpurile obligatorii (nume, telefon, CV, acord GDPR).' }, 400) : htmlResp(pagina(pozitii || [], '<div class="err">Completează câmpurile obligatorii (nume, telefon, CV, acord GDPR).</div>'), 400)
      }
      if (cv.size > 10 * 1024 * 1024) {
        return vreaJson ? jsonResp({ error: 'CV-ul depășește 10 MB.' }, 400) : htmlResp(pagina(pozitii || [], '<div class="err">CV-ul depășește 10 MB.</div>'), 400)
      }
      const extMatch = (cv.name || '').match(/\.(pdf|docx?|jpe?g|png)$/i)
      const ext = extMatch ? extMatch[0].toLowerCase() : '.pdf'
      const path = `aplicari/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`
      const { error: upErr } = await supa.storage.from('recrutare-cv')
        .upload(path, new Uint8Array(await cv.arrayBuffer()), { contentType: cv.type || 'application/pdf' })
      if (upErr) throw upErr
      const retentie = new Date(); retentie.setMonth(retentie.getMonth() + 12)
      const { data: cand, error: insErr } = await supa.from('hr_recrutare_candidati').insert({
        pozitie_id: pozitieId, nume, email, telefon, oras,
        sursa: 'formular_olx', data_aplicare: new Date().toISOString().slice(0, 10),
        fisier_path: path, fisier_nume: (cv.name || 'cv').slice(0, 150), fisier_size_bytes: cv.size,
        fisier_mime: cv.type || 'application/pdf',
        status: 'nou', consimtamant_pastrare: true,
        data_retentie_pana: retentie.toISOString().slice(0, 10),
      }).select('id').single()
      if (insErr) throw insErr
      if (mesaj) {
        await supa.from('hr_recrutare_interactiuni').insert({
          candidat_id: cand.id, tip: 'nota', canal: 'online', autor_nume: nume,
          subiect: 'Mesaj din formularul de aplicare', continut: mesaj,
        })
      }
      await notifica(nume, telefon, email, oras, poz.denumire, mesaj)
      if (vreaJson) return jsonResp({ ok: true, candidat_id: cand.id })
      return htmlResp(pagina(pozitii || [], '<div class="ok">✅ Aplicația a fost trimisă. Îți mulțumim! Te contactăm în cel mai scurt timp. / Your application was sent — thank you!</div>'))
    } catch (e) {
      const err = String((e as Error).message || e).slice(0, 200)
      if (vreaJson) return jsonResp({ error: 'A apărut o eroare la trimitere. Reîncearcă sau scrie la office@gazpet.ro. (' + err + ')' }, 500)
      return htmlResp(pagina(pozitii || [], `<div class="err">A apărut o eroare la trimitere. Reîncearcă sau scrie la office@gazpet.ro. (${esc(err)})</div>`), 500)
    }
  }
  return new Response('metoda invalida', { status: 405 })
})
