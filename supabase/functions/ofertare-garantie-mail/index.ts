// ofertare-garantie-mail — mailurile fluxului „Garanție de participare” (Răzvan 07.09.2026), prin Resend.
// Acțiuni (body.actiune, body.garantie_id):
//   cerere       → brokerului: cererea de ofertă pentru poliță (textul din platformă) + atașamente din bucketul ofertare (fișa de date, anunț…)
//   actualizare  → brokerului: perioada nouă de valabilitate după decalarea termenului de depunere
//   plata        → Marilena Tudorache + Mirela Popescu (cc responsabil): draft poliță + decont primă → de plătit
//   achitata     → responsabilului licitației: polița e achitată (OP atașat) → poate cere originalul
// Auth: JWT de utilizator (UI). verify_jwt=false pentru că validăm noi tokenul (getUser).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const APP = 'https://pontaj-pro-sooty.vercel.app';
const PLATA_TO = ['marilena.tudorache@gazpet.ro', 'mirela.popescu@gazpet.ro'];
const OFFICE = 'office@gazpet.ro';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const fmtZi = (d?: string | null) => d ? new Date(d).toLocaleDateString('ro-RO') : '—';
const fmtLei = (v?: number | null, m = 'RON') => v == null ? '—' : `${Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m}`;
const b64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ error: 'RESEND_API_KEY lipsă' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'fără autentificare' }, 401);
  const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: ud } = await uc.auth.getUser();
  if (!ud?.user) return json({ error: 'token invalid' }, 401);
  const { data: me } = await db.from('profiles').select('id, name, email').eq('id', ud.user.id).maybeSingle();
  const meNume = me?.name || ud.user.email || 'Gazpet Instal';
  const meMail = me?.email || ud.user.email || OFFICE;

  let body: any = {}; try { body = await req.json(); } catch { /* gol */ }
  const actiune = String(body.actiune || '');
  const gid = Number(body.garantie_id);
  if (!gid) return json({ error: 'garantie_id lipsă' }, 400);

  const { data: g } = await db.from('ofertare_garantii').select('*, broker:ofertare_brokeri(nume, email, contact), licitatie:ofertare_licitatii(id, nr_anunt, autoritate, obiect, termen_depunere, garantie_participare, responsabil_id, link_seap)').eq('id', gid).maybeSingle();
  if (!g) return json({ error: 'garanția nu există' }, 404);
  const l = g.licitatie || {};
  let resp: { name?: string; email?: string } | null = null;
  if (l.responsabil_id) { const { data } = await db.from('profiles').select('name, email').eq('id', l.responsabil_id).maybeSingle(); resp = data; }
  const titlu = `${l.nr_anunt} — ${l.autoritate}`;
  const linkFisa = `${APP}/ofertare`;

  // atașamente din storage (bucket ofertare) — Resend acceptă max ~40 MB per mail
  const atas = async (lista: { path: string; nume: string }[]) => {
    const out: { filename: string; content: string }[] = []; let total = 0; const sarite: string[] = [];
    for (const a of lista || []) {
      if (!a?.path) continue;
      const { data, error } = await db.storage.from('ofertare').download(a.path);
      if (error || !data) { sarite.push(a.nume || a.path); continue; }
      const buf = await data.arrayBuffer();
      if (total + buf.byteLength > 35 * 1024 * 1024) { sarite.push(a.nume || a.path); continue; }
      total += buf.byteLength;
      out.push({ filename: a.nume || a.path.split('/').pop() || 'fisier.pdf', content: b64(buf) });
    }
    return { out, sarite };
  };
  const trimite = async (to: string[], cc: string[], subject: string, html: string, attachments: { filename: string; content: string }[]) => {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to, cc: cc.length ? cc : undefined, reply_to: meMail, subject, html, attachments: attachments.length ? attachments : undefined }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j?.id || null;
  };
  const wrap = (inner: string) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:720px">${inner}` +
    `<p style="color:#8a99a8;font-size:12px;margin-top:18px">Mesaj generat din platforma Gazpet ERP · răspunsurile ajung la ${esc(meMail)}</p></div>`;
  const semnatura = `<p style="margin-top:14px">Cu stimă,<br><b>${esc(meNume)}</b><br>SC GAZPET INSTAL SRL · Ploiești, str. Fluturilor nr. 34 · Tel/Fax 0244 435005 · ${esc(OFFICE)}</p>`;
  const now = new Date().toISOString();

  try {
    if (actiune === 'cerere' || actiune === 'actualizare') {
      if (!g.broker?.email) return json({ error: 'garanția nu are broker cu e-mail' }, 400);
      const { out, sarite } = actiune === 'cerere' ? await atas(g.cerere_atasamente || []) : { out: [], sarite: [] };
      const subject = actiune === 'cerere'
        ? `Solicitare emitere Poliță garanție de participare — ${titlu}`
        : `Actualizare perioadă valabilitate poliță garanție de participare — ${titlu}`;
      const text = actiune === 'cerere' ? (g.cerere_text || '') :
        `Bună ziua,\n\nReferitor la solicitarea noastră pentru polița de garanție de participare la procedura ${l.nr_anunt} — ${l.autoritate} („${l.obiect}”): termenul de depunere a ofertelor a fost decalat la ${fmtZi(l.termen_depunere)}.\n\nAșadar perioada de valabilitate a poliței va fi: ${fmtZi(g.valabil_de)} – ${fmtZi(g.valabil_pana)} (${g.valabil_zile || '—'} zile de la data limită de depunere).\n\nVă rugăm să ne transmiteți draftul poliței actualizat și decontul pentru plata primei de asigurare.\n\nVă mulțumim.`;
      const html = wrap(`<div style="white-space:pre-wrap">${esc(text)}</div>${semnatura}`);
      const id = await trimite([g.broker.email], [OFFICE, meMail].filter((x, i, a) => a.indexOf(x) === i), subject, html, out);
      await db.from('ofertare_garantii').update(actiune === 'cerere' ? { cerere_trimisa_la: now, cerere_trimisa_de: ud.user.id, updated_at: now } : { actualizare_trimisa_la: now, updated_at: now }).eq('id', gid);
      return json({ ok: true, id, atasate: out.length, sarite });
    }

    if (actiune === 'plata') {
      const lista = [g.draft_path ? { path: g.draft_path, nume: `Draft polita ${l.nr_anunt}.pdf` } : null, g.decont_path ? { path: g.decont_path, nume: `Decont prima ${l.nr_anunt}.pdf` } : null].filter(Boolean) as any[];
      const { out, sarite } = await atas(lista);
      const html = wrap(
        `<h2 style="margin:0 0 6px;color:#0b4f8a">🛡️ Poliță garanție de participare — de plătit</h2>` +
        `<p style="margin:0 0 12px;font-size:15px"><b>${esc(l.obiect)}</b></p>` +
        `<table style="border-collapse:collapse;font-size:14px">` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Procedura</td><td><b>${esc(l.nr_anunt)}</b> · ${esc(l.autoritate)}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Valoarea garanției</td><td>${fmtLei(g.valoare, g.moneda)}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Primă de plătit (decont)</td><td style="font-size:16px"><b>${fmtLei(g.decont_valoare, g.moneda)}</b></td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Broker</td><td>${esc(g.broker?.nume || '—')}${g.broker?.contact ? ' · ' + esc(g.broker.contact) : ''}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Valabilitate poliță</td><td>${fmtZi(g.valabil_de)} – ${fmtZi(g.valabil_pana)}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Termen depunere ofertă</td><td><b>${fmtZi(l.termen_depunere)}</b></td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6b7b">Responsabil licitație</td><td>${esc(resp?.name || '— nesetat —')}</td></tr>` +
        `</table>` +
        `<p style="margin:14px 0 6px">Draftul poliței și decontul sunt atașate. După plată, vă rugăm să încărcați OP-ul în platformă și să bifați <b>„achitată”</b> — responsabilul primește automat vestea și cere originalul de la broker.</p>` +
        `<p style="margin:10px 0"><a href="${linkFisa}" style="background:#0b7a3b;color:#fff;padding:9px 16px;border-radius:7px;text-decoration:none;font-weight:700">Deschide licitația în platformă → tab Garanție</a></p>` +
        `<p style="margin:8px 0 0;color:#5a6b7b;font-size:13px">Trimis de ${esc(meNume)}.</p>`);
      const id = await trimite(PLATA_TO, [resp?.email, meMail].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i) as string[], `💳 De plătit: poliță garanție participare — ${titlu} (${fmtLei(g.decont_valoare, g.moneda)})`, html, out);
      await db.from('ofertare_garantii').update({ notificat_plata_la: now, updated_at: now }).eq('id', gid);
      return json({ ok: true, id, atasate: out.length, sarite });
    }

    if (actiune === 'achitata') {
      const to = resp?.email ? [resp.email] : [OFFICE];
      const { out, sarite } = await atas(g.op_path ? [{ path: g.op_path, nume: `OP prima polita ${l.nr_anunt}.pdf` }] : []);
      const html = wrap(
        `<h2 style="margin:0 0 6px;color:#0b7a3b">✅ Polița de garanție a fost achitată</h2>` +
        `<p style="margin:0 0 12px;font-size:15px"><b>${esc(l.obiect)}</b><br><span style="color:#5a6b7b">${esc(l.nr_anunt)} · ${esc(l.autoritate)}</span></p>` +
        `<p>Prima de <b>${fmtLei(g.decont_valoare, g.moneda)}</b> a fost plătită (OP atașat). Poți cere brokerului <b>${esc(g.broker?.nume || '')}</b>${g.broker?.email ? ` (<a href="mailto:${esc(g.broker.email)}">${esc(g.broker.email)}</a>)` : ''} <b>polița în original</b> — la depunere trebuie prezentată în original.</p>` +
        `<p>Termen depunere: <b>${fmtZi(l.termen_depunere)}</b>. Când vine originalul, încarcă-l în platformă (număr poliță + valoarea primei) și indicatorul „Garanție participare” devine verde.</p>` +
        `<p style="margin:10px 0"><a href="${linkFisa}" style="background:#0b4f8a;color:#fff;padding:9px 16px;border-radius:7px;text-decoration:none;font-weight:700">Deschide licitația → tab Garanție</a></p>`);
      const id = await trimite(to, [OFFICE, meMail].filter((x, i, a) => a.indexOf(x) === i), `✅ Poliță achitată — cere originalul: ${titlu}`, html, out);
      await db.from('ofertare_garantii').update({ notificat_achitata_la: now, updated_at: now }).eq('id', gid);
      return json({ ok: true, id, atasate: out.length, sarite, catre: to });
    }

    return json({ error: `acțiune necunoscută: ${actiune}` }, 400);
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 502);
  }
});
