// ofertare-rc-necitit — (a) escaladarea zilnică „răspuns de la autoritate necitit” (Răzvan 19.10.2026, „da d-a-b”, varianta A).
// Pornit DOAR de pg_cron (ofertare_rc_necitit, 3 rulări / zi) cu x-radar-secret, verificat prin Vault (fn_verifica_radar_secret) — cheia anon
// NU ajunge (verify_jwt nu e o poartă de rol, vezi PR #318).
// 1) apelează public.ofertare_alerta_rc_necitit(): notificări 'critical' în platformă (revendicare atomică pe zi + documente) și
//    REVENDICAREA atomică a mailului zilei pentru licitațiile cu ≤ 5 zile până la depunere (`mail: true`);
// 2) mail către OWNER(I) — destinatari ficși din profiles.is_owner (@gazpet.ro), niciodată din conținutul documentelor — DOAR pentru
//    revendicările întoarse de funcție, după REVALIDAREA statusului chiar înainte de trimitere (review Copilot r1, P2: un document
//    procesat între timp nu mai primește mail); orice mail care nu pleacă (eroare de citire / revalidare / Resend, document procesat)
//    își ELIBEREAZĂ revendicarea (ofertare_alerta_rc_mail_elibereaza), ca rularea următoare să-l poată trimite (review r1, P1).
// Citește doar metadate (tip, status, nume fișier, termen) — NU textul documentelor. Nu pornește procesări, nu atinge bani sau drepturi.
// Erori de business → return, nu throw.
import { createClient } from 'npm:@supabase/supabase-js@2'

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const unRand = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
const zi = (d: string) => d.split('-').reverse().join('.')

type Lic = { licitatie_id: number; nr_anunt: string | null; obiect: string; zile_necitit: number; zile_depunere: number; de_la: string; nr: number
  lista: string; doc_ids: number[]; mail: boolean; amprenta_mail: string | null }

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const s = req.headers.get('x-radar-secret')
  if (!s) return json({ error: 'unauthorized' }, 401)
  const { data: okSecret, error: eSecret } = await sb.rpc('fn_verifica_radar_secret', { p_secret: s })
  if (eSecret || okSecret !== true) return json({ error: 'unauthorized' }, 401)

  const { data: rez, error: eRez } = await sb.rpc('ofertare_alerta_rc_necitit')
  if (eRez) return json({ ok: false, error: 'rpc: ' + eRez.message })
  const notificari = rez?.notificari ?? 0
  const revendicate: Lic[] = (rez?.licitatii || []).filter((l: Lic) => l.mail === true && l.amprenta_mail)
  if (!revendicate.length) return json({ ok: true, notificari, mail: 0, reason: 'nimic_de_trimis' })

  // eliberarea revendicărilor care nu pleacă — o eliberare eșuată se raportează (mailul zilei s-ar pierde)
  const elibereaza = async (ls: Lic[]) => {
    const esuate: number[] = []
    for (const l of ls) {
      const { data, error } = await sb.rpc('ofertare_alerta_rc_mail_elibereaza', { p_licitatie_id: l.licitatie_id, p_amprenta: l.amprenta_mail })
      if (error || data !== true) esuate.push(l.licitatie_id)
    }
    return esuate
  }
  const esec = async (motiv: string, ls: Lic[]) => {
    const neeliberate = await elibereaza(ls)
    return json({ ok: false, notificari, mail: 0, error: motiv, ...(neeliberate.length ? { revendicari_neeliberate: neeliberate } : {}) })
  }

  // revalidare chiar înainte de trimitere: rămân doar licitațiile care au ÎNCĂ cel puțin unul dintre documentele revendicate necitit
  // review Copilot r3 (P1): ACEEAȘI definiție a „necitit” ca selecția (status + proveniența 'ocr_local_neverificat' pe sha-ul curent),
  // prin RPC-ul comun — nu o a doua definiție în edge
  const ids = revendicate.flatMap((l) => l.doc_ids || [])
  const { data: docs, error: eDocs } = await sb.rpc('ofertare_alerta_rc_necitite_acum', { p_doc_ids: ids })
  if (eDocs || !Array.isArray(docs)) return await esec('revalidare: ' + (eDocs?.message || 'fără date'), revendicate)
  const necitite = docs
  // review Copilot r2 (P2): mailul descrie DOAR documentele încă necitite la revalidare (nr / listă / „din” / zile reconstruite), nu
  // snapshot-ul de la revendicare — un răspuns procesat între timp nu mai apare ca „necitit”
  const ziRo = (ts: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date(ts))
  const azi: string = rez?.azi ?? ziRo(new Date().toISOString())
  const zileIntre = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
  const deTrimis: Lic[] = []
  for (const l of revendicate) {
    const dl = necitite.filter((d: any) => (l.doc_ids || []).map(Number).includes(Number(d.id)))
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
    if (!dl.length) continue
    const deLa = dl.map((d: any) => ziRo(d.created_at)).sort()[0]
    deTrimis.push({ ...l, nr: dl.length, lista: dl.map((d: any) => String(d.nume_original || '#' + d.id).slice(0, 60)).join('; '), de_la: deLa, zile_necitit: zileIntre(deLa, azi) })
  }
  const procesateIntreTimp = revendicate.filter((l) => !deTrimis.some((x) => x.licitatie_id === l.licitatie_id))
  const neeliberateProcesate = procesateIntreTimp.length ? await elibereaza(procesateIntreTimp) : []
  if (!deTrimis.length) return json({ ok: true, notificari, mail: 0, reason: 'procesate_intre_timp', ...(neeliberateProcesate.length ? { revendicari_neeliberate: neeliberateProcesate } : {}) })

  const RESEND = Deno.env.get('RESEND_API_KEY')
  if (!RESEND) return await esec('RESEND_API_KEY lipsa', deTrimis)
  const { data: owners, error: eOwn } = await sb.from('profiles').select('email').eq('is_owner', true).not('email', 'is', null)
  if (eOwn) return await esec('owneri: ' + eOwn.message, deTrimis)
  const to = [...new Set((owners || []).map((o: any) => String(o.email).trim()).filter((e: string) => /^[^@\s]+@gazpet\.ro$/i.test(e)))]
  if (!to.length) return await esec('niciun owner cu email @gazpet.ro', deTrimis)

  const minZile = Math.min(...deTrimis.map((l) => l.zile_depunere))
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
    <div style="background:#B91C1C;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">🚨 Răspuns de la autoritate NECITIT — ${deTrimis.length} ${deTrimis.length === 1 ? 'licitație' : 'licitații'}</div>
    <div style="padding:20px 24px;font-size:13.5px;line-height:1.55">
      ${deTrimis.map((l) => `
        <div style="border:1px solid #7F1D1D;border-radius:10px;padding:12px 16px;margin-bottom:12px;background:#161B22">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(l.nr_anunt || 'licitația ' + l.licitatie_id)} — <span style="color:#F87171">${l.zile_depunere <= 0 ? 'depunerea e AZI' : l.zile_depunere + (l.zile_depunere === 1 ? ' zi' : ' zile') + ' până la depunere'}</span></div>
          <div style="color:#8B949E;font-size:12.5px;margin-bottom:6px">${esc(l.obiect)}</div>
          <div style="font-size:13px">📄 ${l.nr} ${l.nr === 1 ? 'document necitit' : 'documente necitite'} din <b>${zi(l.de_la)}</b>${l.zile_necitit ? ` (${l.zile_necitit} ${l.zile_necitit === 1 ? 'zi' : 'zile'})` : ' (de azi)'}: ${esc(l.lista)}</div>
        </div>`).join('')}
      <div style="margin-top:8px"><a href="https://pontaj-pro-sooty.vercel.app" style="background:#238636;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide Ofertare</a></div>
      <div style="margin-top:14px;font-size:12px;color:#8B949E">Mail automat din PontajPRO · se repetă zilnic cât timp răspunsul e neprocesat și sunt ≤ 5 zile până la depunere. Procesarea o pornești din fișa licitației → Documentație (poarta pe cheltuială).</div>
    </div>
  </div>`

  // review Copilot r2 (P1): cheie de idempotență la Resend = amprentele revendicate (aceeași zi + aceleași documente ⇒ același mail, oricâte
  // reîncercări); rezultat AMBIGUU (excepție de transport, 5xx) ⇒ revendicarea NU se eliberează (mailul poate fi plecat) — se raportează;
  // doar un refuz explicit (4xx, altul decât conflictul de idempotență) eliberează revendicarea, ca rularea următoare să-l trimită
  // r4: cheia include și documentele încă necitite trimise (conținutul final) — aceeași revendicare re-revendicată după un rezultat ambiguu
  // (amprenta „în curs” e aceeași în aceeași zi) cu același conținut ⇒ aceeași cheie ⇒ Resend nu trimite a doua oară
  const cheie = 'rc-necitit-' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(deTrimis.map((l) => `${l.amprenta_mail}#${l.nr}#${l.lista}`).sort().join('|'))))).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48)
  let resp: Response
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json', 'Idempotency-Key': cheie },
      body: JSON.stringify({ from: FROM, to,
        subject: unRand(`🚨 RC necitit: ${deTrimis.map((l) => unRand(l.nr_anunt || l.licitatie_id)).join(', ')} — ${minZile <= 0 ? 'depunere AZI' : minZile + ' zile până la depunere'}`), html }),
    })
  } catch (e) {
    return json({ ok: false, notificari, mail: null, rezultat: 'necunoscut', error: 'Resend (transport): ' + String((e as Error)?.message || e).slice(0, 200),
      nota: 'revendicarea rămâne „în curs”; după 10 minute rularea următoare o re-revendică și reîncearcă cu aceeași cheie de idempotență' })
  }
  const txt = await resp.text()
  if (resp.status >= 500) {
    return json({ ok: false, notificari, mail: null, rezultat: 'necunoscut', error: 'Resend ' + resp.status + ': ' + txt.slice(0, 200),
      nota: 'revendicarea rămâne (rezultat ambiguu)' })
  }
  if (!resp.ok && resp.status !== 409) return await esec('Resend ' + resp.status + ': ' + txt.slice(0, 200), deTrimis)
  // trimis (2xx, sau 409 = aceeași cheie deja folosită ⇒ deja trimis): revendicarea „în curs” devine „trimis” — altfel, după 10 minute,
  // o rulare ar putea-o re-revendica (inofensiv: aceeași cheie de idempotență), dar o raportăm
  const neconfirmate: number[] = []
  for (const l of deTrimis) {
    const { data, error } = await sb.rpc('ofertare_alerta_rc_mail_confirma', { p_licitatie_id: l.licitatie_id, p_amprenta: l.amprenta_mail })
    if (error || data !== true) neconfirmate.push(l.licitatie_id)
  }
  return json({ ok: true, notificari, mail: deTrimis.length, catre: to.length, ...(neeliberateProcesate.length ? { revendicari_neeliberate: neeliberateProcesate } : {}),
    ...(neconfirmate.length ? { revendicari_neconfirmate: neconfirmate } : {}) })
})
