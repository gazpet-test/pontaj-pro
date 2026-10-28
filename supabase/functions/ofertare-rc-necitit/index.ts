// ofertare-rc-necitit — (a) escaladarea zilnică „răspuns de la autoritate necitit” (Răzvan 19.10.2026, „da d-a-b”, varianta A).
// Pornit DOAR de pg_cron (ofertare_rc_necitit, 3 rulări / zi) cu x-radar-secret, verificat prin Vault (fn_verifica_radar_secret) — cheia anon
// NU ajunge (verify_jwt nu e o poartă de rol, vezi PR #318).
// 1) apelează public.ofertare_alerta_rc_necitit(): notificări 'critical' în platformă (revendicare atomică pe zi + documente) și
//    REVENDICAREA atomică a mailului zilei pentru licitațiile cu ≤ 5 zile până la depunere (`mail: true`);
// 2) mail per licitație (decizia Răzvan 28.10.2026, varianta B): TO = responsabilul licitației, CC = owner-ul principal; fără responsabil /
//    fără email valid → TO = owner-ul principal + „FĂRĂ RESPONSABIL” (destinatari.ts). Adresele vin DOAR din BD (profiles, @gazpet.ro),
//    niciodată din conținutul documentelor. Mailul pleacă DOAR pentru
//    revendicările întoarse de funcție, după REVALIDAREA statusului chiar înainte de trimitere (review Copilot r1, P2: un document
//    procesat între timp nu mai primește mail); orice mail care nu pleacă (eroare de citire / revalidare / Resend, document procesat)
//    își ELIBEREAZĂ revendicarea (ofertare_alerta_rc_mail_elibereaza), ca rularea următoare să-l poată trimite (review r1, P1).
// Citește doar metadate (tip, status, nume fișier, termen) — NU textul documentelor. Nu pornește procesări, nu atinge bani sau drepturi.
// Erori de business → return, nu throw.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { destinatariLicitatie, emailValid, OWNER_PRINCIPAL, type Destinatari } from './destinatari.ts'

const FROM = 'PontajPRO <rapoarte@gazpet.ro>'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const unRand = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
const zi = (d: string) => d.split('-').reverse().join('.')

type Lic = { licitatie_id: number; nr_anunt: string | null; obiect: string; zile_necitit: number; zile_depunere: number; de_la: string; nr: number
  lista: string; doc_ids: number[]; mail: boolean; amprenta_mail: string | null; cheie_mail: string | null }

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
  // owner-ul principal: adresa trebuie să existe în BD pe un profil is_owner (nu e luată din cod ca destinatar „orb”)
  const { data: owners, error: eOwn } = await sb.from('profiles').select('email').eq('is_owner', true).not('email', 'is', null)
  if (eOwn) return await esec('owneri: ' + eOwn.message, deTrimis)
  const owner = (owners || []).map((o: any) => emailValid(o.email)).find((e: string | null) => e === OWNER_PRINCIPAL) ?? null
  if (!owner) return await esec('owner-ul principal nu e în profiles (is_owner, @gazpet.ro)', deTrimis)
  // responsabilii licitațiilor (ofertare_licitatii.responsabil_id → profiles)
  const { data: lics, error: eLic } = await sb.from('ofertare_licitatii').select('id, responsabil_id').in('id', deTrimis.map((l) => l.licitatie_id))
  if (eLic || !Array.isArray(lics)) return await esec('responsabili: ' + (eLic?.message || 'fără date'), deTrimis)
  const respIds = [...new Set(lics.map((x: any) => x.responsabil_id).filter(Boolean))]
  const { data: resps, error: eResp } = respIds.length
    ? await sb.from('profiles').select('id, name, email').in('id', respIds) : { data: [], error: null }
  if (eResp || !Array.isArray(resps)) return await esec('profil responsabil: ' + (eResp?.message || 'fără date'), deTrimis)
  const dest = new Map<number, Destinatari>()
  for (const l of deTrimis) {
    const rid = lics.find((x: any) => Number(x.id) === Number(l.licitatie_id))?.responsabil_id ?? null
    const p = rid ? (resps.find((x: any) => x.id === rid) ?? { name: null, email: null }) : null
    dest.set(l.licitatie_id, destinatariLicitatie(p, owner)!)
  }

  // review Copilot r4 (P1): câte UN mail per licitație, cu cheia de idempotență a ACELEI licitații ('rc-necitit-<licitație>-<zi>-<id maxim>',
  // calculată în SQL, stabilă la orice reîncercare) — confirmarea / eliberarea sunt tot per licitație, deci nu mai există un lot a cărui
  // cheie să se schimbe când doar o parte din licitații trebuie reîncercate
  const htmlLic = (l: Lic, d: Destinatari) => `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;background:#0D1117;color:#E6EDF3;border-radius:12px;overflow:hidden;border:1px solid #30363D">
    <div style="background:#B91C1C;padding:16px 24px;font-size:18px;font-weight:700;color:#fff">🚨 Răspuns de la autoritate NECITIT — ${esc(l.nr_anunt || 'licitația ' + l.licitatie_id)}</div>
    <div style="padding:20px 24px;font-size:13.5px;line-height:1.55">
      ${d.faraResponsabil
        ? `<div style="border:1px solid #F59E0B;border-radius:10px;padding:10px 14px;margin-bottom:12px;background:#1F1A0B;color:#FBBF24;font-weight:700">⚠ FĂRĂ RESPONSABIL — ${esc(d.motiv)}. Setează responsabilul în fișa licitației.</div>`
        : `<div style="color:#8B949E;font-size:12.5px;margin-bottom:10px">Responsabil: <b style="color:#E6EDF3">${esc(d.responsabil || '—')}</b></div>`}
      <div style="border:1px solid #7F1D1D;border-radius:10px;padding:12px 16px;margin-bottom:12px;background:#161B22">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px"><span style="color:#F87171">${l.zile_depunere <= 0 ? 'depunerea e AZI' : l.zile_depunere + (l.zile_depunere === 1 ? ' zi' : ' zile') + ' până la depunere'}</span></div>
        <div style="color:#8B949E;font-size:12.5px;margin-bottom:6px">${esc(l.obiect)}</div>
        <div style="font-size:13px">📄 ${l.nr} ${l.nr === 1 ? 'document necitit' : 'documente necitite'} din <b>${zi(l.de_la)}</b>${l.zile_necitit ? ` (${l.zile_necitit} ${l.zile_necitit === 1 ? 'zi' : 'zile'})` : ' (de azi)'}: ${esc(l.lista)}</div>
      </div>
      <div style="margin-top:8px"><a href="https://pontaj-pro-sooty.vercel.app" style="background:#238636;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide Ofertare</a></div>
      <div style="margin-top:14px;font-size:12px;color:#8B949E">Mail automat din PontajPRO · se repetă zilnic cât timp răspunsul e neprocesat și sunt ≤ 5 zile până la depunere. Procesarea o pornești din fișa licitației → Documentație (poarta pe cheltuială).</div>
    </div>
  </div>`

  const rezultate: Record<string, unknown>[] = []
  let trimise = 0
  for (const l of deTrimis) {
    const d = dest.get(l.licitatie_id)!
    let resp: Response | null = null, eroare: string | null = null
    try {
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json', 'Idempotency-Key': String(l.cheie_mail) },
        body: JSON.stringify({ from: FROM, to: d.to, ...(d.cc.length ? { cc: d.cc } : {}),
          subject: unRand(`🚨 RC necitit${d.faraResponsabil ? ' — FĂRĂ RESPONSABIL' : ''}: ${unRand(l.nr_anunt || l.licitatie_id)} — ${l.zile_depunere <= 0 ? 'depunere AZI' : l.zile_depunere + ' zile până la depunere'}`), html: htmlLic(l, d) }),
      })
    } catch (e) { eroare = 'transport: ' + String((e as Error)?.message || e).slice(0, 200) }
    if (!resp || resp.status >= 500) {
      // rezultat AMBIGUU: revendicarea rămâne „în curs”; rularea următoare (după 10 minute) o re-revendică și reîncearcă cu aceeași cheie
      rezultate.push({ licitatie_id: l.licitatie_id, rezultat: 'necunoscut', eroare: eroare ?? ('Resend ' + resp!.status) })
      continue
    }
    const txt = await resp.text()
    if (!resp.ok && resp.status !== 409) {
      const { data, error } = await sb.rpc('ofertare_alerta_rc_mail_elibereaza', { p_licitatie_id: l.licitatie_id, p_amprenta: l.amprenta_mail })
      rezultate.push({ licitatie_id: l.licitatie_id, rezultat: 'refuzat', eroare: 'Resend ' + resp.status + ': ' + txt.slice(0, 200), eliberat: !error && data === true })
      continue
    }
    // trimis (2xx, sau 409 = aceeași cheie deja folosită ⇒ deja trimis)
    const { data, error } = await sb.rpc('ofertare_alerta_rc_mail_confirma', { p_licitatie_id: l.licitatie_id, p_amprenta: l.amprenta_mail })
    trimise++
    rezultate.push({ licitatie_id: l.licitatie_id, rezultat: 'trimis', confirmat: !error && data === true, catre: d.to.length + d.cc.length, fara_responsabil: d.faraResponsabil })
  }
  return json({ ok: rezultate.every((x) => x.rezultat === 'trimis'), notificari, mail: trimise, rezultate,
    ...(neeliberateProcesate.length ? { revendicari_neeliberate: neeliberateProcesate } : {}) })
})
