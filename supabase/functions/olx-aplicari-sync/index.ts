// olx-aplicari-sync v1 (03.09.2026) — trage aplicările/mesajele din contul OLX (Partner API threads/messages)
// pentru anunțurile legate de poziții (hr_recrutare_pozitii.olx_advert_id) → candidat nou (sursa 'olx', sursa_id = thread_id)
// + CV-urile atașate în bucketul privat recrutare-cv + notă în hr_recrutare_interactiuni + mail Resend la candidat nou.
// Auth: x-radar-secret (cron pg_cron / Claude). Anti-dublură: olx_mesaje_procesate(message_id).
// Erori de business se scriu în BD + return, NU throw.
//
// ADUSĂ ÎN REPO 12.09.2026. SINGURA modificare față de sursa deployată: secretul nu mai e scris
// literal în cod, ci se verifică prin Vault (fn_verifica_radar_secret), care acceptă și valoarea
// precedentă cât ține fereastra de rotire. E a cincea funcție găsită cu același tipar — și prima
// din afara ofertării și a HR-ului: cine avea valoarea putea citi aplicările și CV-urile din OLX.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const OLX = 'https://www.olx.ro'
const DESTINATARI = ['razvan.trusu@gazpet.ro']
const svc = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function secret(name: string) {
  const env = Deno.env.get(name); if (env) return env
  const { data } = await svc().from('app_secrets').select('value').eq('key', name).maybeSingle()
  return data?.value as string | undefined
}
async function tokenValid(): Promise<string | null> {
  const sb = svc()
  const { data: t } = await sb.from('olx_tokens').select('*').eq('id', 1).maybeSingle()
  if (!t?.access_token) return null
  if (t.expires_at && new Date(t.expires_at).getTime() - Date.now() > 60_000) return t.access_token
  if (!t.refresh_token) return null
  const r = await fetch(`${OLX}/api/open/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: await secret('OLX_CLIENT_ID'), client_secret: await secret('OLX_CLIENT_SECRET'), refresh_token: t.refresh_token }) })
  if (!r.ok) return null
  const d = await r.json()
  await sb.from('olx_tokens').upsert({ id: 1, access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString(), scope: d.scope || t.scope, updated_at: new Date().toISOString() })
  return d.access_token
}
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2.0' })
async function get(tok: string, path: string) {
  const r = await fetch(`${OLX}${path}`, { headers: H(tok) })
  const d = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: d.data ?? d }
}

type Fis = { url: string, name?: string, mime?: string }
function fisiere(m: any): Fis[] {
  const out: Fis[] = []
  for (const k of ['cvs', 'attachments']) for (const a of (m[k] || [])) {
    if (!a) continue
    if (typeof a === 'string') out.push({ url: a })
    else if (a.url) out.push({ url: a.url, name: a.name || a.filename || a.original_name, mime: a.mime || a.content_type })
  }
  return out
}

async function notifica(nume: string, telefon: string, pozitie: string, text: string, cv: boolean) {
  const key = Deno.env.get('RESEND_API_KEY'); if (!key) return
  try {
    await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to: DESTINATARI, subject: `🧲 Aplicare OLX: ${nume} — ${pozitie}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c"><h2 style="margin:0 0 8px">Candidat nou din OLX</h2><p style="margin:0 0 4px"><b>${esc(nume)}</b> — ${esc(pozitie)}</p><p style="margin:0 0 4px">📞 ${esc(telefon || '—')} · CV: ${cv ? 'atașat în platformă' : 'lipsă'}</p>${text ? `<p style="margin:8px 0;color:#4a5a6a;white-space:pre-wrap">${esc(text)}</p>` : ''}<p style="margin:12px 0 0"><a href="https://pontaj-pro-sooty.vercel.app">HR → Recrutare</a></p><p style="color:#c0392b;font-size:12px;margin-top:14px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat.</p></div>` }) })
  } catch { /* nu blochează */ }
}

Deno.serve(async (req: Request) => {
  const sb = svc()

  // Secretul NU stă în sursă: repo-ul e public. Verificare prin RPC contra Vault.
  const sec = req.headers.get('x-radar-secret')
  if (!sec) return json({ eroare: 'neautorizat' }, 401)
  const { data: okSecret, error: eSecret } = await sb.rpc('fn_verifica_radar_secret', { p_secret: sec })
  if (eSecret || okSecret !== true) return json({ eroare: 'neautorizat' }, 401)

  const tok = await tokenValid()
  if (!tok) return json({ ok: false, eroare: 'neconectat la OLX' })

  const { data: poz } = await sb.from('hr_recrutare_pozitii').select('id, denumire, olx_advert_id').not('olx_advert_id', 'is', null).is('deleted_at', null)
  const pozByAd = new Map<number, { id: number, denumire: string }>()
  for (const p of poz || []) pozByAd.set(Number(p.olx_advert_id), { id: p.id, denumire: p.denumire })
  if (!pozByAd.size) return json({ ok: true, info: 'nicio poziție legată de OLX' })

  // toate thread-urile (paginat)
  const threads: any[] = []
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await get(tok, `/api/partner/threads?limit=50&offset=${offset}`)
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) break
    threads.push(...r.data)
    if (r.data.length < 50) break
  }
  const relevante = threads.filter(t => pozByAd.has(Number(t.advert_id)))

  const { data: gata } = await sb.from('olx_mesaje_procesate').select('message_id')
  const procesate = new Set((gata || []).map((x: any) => Number(x.message_id)))

  const rezumat = { threads: relevante.length, mesaje_noi: 0, candidati_noi: 0, cv_uri: 0, erori: [] as string[] }

  for (const t of relevante) {
    const p = pozByAd.get(Number(t.advert_id))!
    const rm = await get(tok, `/api/partner/threads/${t.id}/messages`)
    if (!rm.ok || !Array.isArray(rm.data)) { rezumat.erori.push(`thread ${t.id}: ${rm.status}`); continue }
    const noi = rm.data.filter((m: any) => m.type === 'received' && !procesate.has(Number(m.id))).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
    if (!noi.length) continue

    // candidatul thread-ului
    let { data: cand } = await sb.from('hr_recrutare_candidati').select('id, nume, telefon, fisier_path').eq('sursa', 'olx').eq('sursa_id', String(t.id)).is('deleted_at', null).maybeSingle()
    let candidatNou = false
    if (!cand) {
      let nume = ''
      const ru = await get(tok, `/api/partner/users/${t.interlocutor_id}`)
      if (ru.ok && ru.data?.name) nume = String(ru.data.name)
      if (!nume) nume = `Candidat OLX #${t.interlocutor_id}`
      const telefon = noi.map((m: any) => m.phone).find((x: string) => x) || ''
      const retentie = new Date(); retentie.setMonth(retentie.getMonth() + 12)
      const { data: ins, error } = await sb.from('hr_recrutare_candidati').insert({
        pozitie_id: p.id, nume: nume.slice(0, 120), telefon: telefon.slice(0, 30) || null,
        sursa: 'olx', sursa_id: String(t.id), data_aplicare: String(noi[0].created_at).slice(0, 10),
        status: 'nou', consimtamant_pastrare: true, data_retentie_pana: retentie.toISOString().slice(0, 10),
      }).select('id, nume, telefon, fisier_path').single()
      if (error) { rezumat.erori.push(`thread ${t.id}: ${error.message}`); continue }
      cand = ins; candidatNou = true; rezumat.candidati_noi++
    }

    let cvNou = false
    const texte: string[] = []
    for (const m of noi) {
      let nrFis = 0, err: string | null = null
      for (const f of fisiere(m)) {
        try {
          const rf = await fetch(f.url, { headers: H(tok) })
          if (!rf.ok) { const rf2 = await fetch(f.url); if (!rf2.ok) throw new Error(`download ${rf.status}`); var buf = new Uint8Array(await rf2.arrayBuffer()); var ctype = rf2.headers.get('content-type') || '' } else { var buf = new Uint8Array(await rf.arrayBuffer()); var ctype = rf.headers.get('content-type') || '' }
          const numeF = (f.name || f.url.split('?')[0].split('/').pop() || 'cv').slice(0, 150)
          const extM = numeF.match(/\.(pdf|docx?|jpe?g|png)$/i)
          const ext = extM ? extM[0].toLowerCase() : (ctype.includes('pdf') ? '.pdf' : ctype.includes('word') ? '.docx' : '.bin')
          const path = `olx/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`
          const { error: upErr } = await sb.storage.from('recrutare-cv').upload(path, buf, { contentType: f.mime || ctype || 'application/octet-stream' })
          if (upErr) throw upErr
          nrFis++; rezumat.cv_uri++
          if (!cand.fisier_path) {
            await sb.from('hr_recrutare_candidati').update({ fisier_path: path, fisier_nume: numeF.match(/\./) ? numeF : numeF + ext, fisier_size_bytes: buf.byteLength, fisier_mime: f.mime || ctype || null }).eq('id', cand.id)
            cand.fisier_path = path; cvNou = true
          } else {
            await sb.from('hr_recrutare_interactiuni').insert({ candidat_id: cand.id, tip: 'nota', canal: 'online', autor_nume: cand.nume, subiect: 'Fișier suplimentar din OLX', continut: `recrutare-cv/${path} (${numeF})` })
          }
        } catch (e) { err = String((e as Error).message || e).slice(0, 200); rezumat.erori.push(`msg ${m.id}: ${err}`) }
      }
      if (m.text) texte.push(String(m.text))
      if (m.phone && !cand.telefon) { await sb.from('hr_recrutare_candidati').update({ telefon: String(m.phone).slice(0, 30) }).eq('id', cand.id); cand.telefon = m.phone }
      await sb.from('olx_mesaje_procesate').upsert({ message_id: Number(m.id), thread_id: Number(t.id), advert_id: Number(t.advert_id), candidat_id: cand.id, tip: m.type, fisiere: nrFis, eroare: err })
      rezumat.mesaje_noi++
    }
    if (texte.length) await sb.from('hr_recrutare_interactiuni').insert({ candidat_id: cand.id, tip: 'nota', canal: 'online', autor_nume: cand.nume, subiect: candidatNou ? 'Mesaj de aplicare din OLX' : 'Mesaj nou din OLX', continut: texte.join('\n---\n').slice(0, 4000) })
    if (candidatNou || cvNou) await notifica(cand.nume, cand.telefon || '', p.denumire, texte.join('\n').slice(0, 1500), !!cand.fisier_path)
  }
  return json({ ok: true, ...rezumat })
})
