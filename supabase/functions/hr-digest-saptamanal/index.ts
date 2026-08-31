// hr-digest-saptamanal — luni dimineata, un singur mail catre HR cu ce lipseste:
// fise de aptitudini, autorizatii care expira sau au expirat, documente neincadrate.
//
// De ce mail si nu notificari: notificarile curg zilnic si se ingroapa. Cifrele astea
// se misca incet — o data pe saptamana, toate la un loc, e exact cat sa se si actioneze.
//
// Chemat de pg_cron (job `hr_digest_saptamanal`, luni 05:30 UTC = 08:30 vara la noi).
// AUTENTIFICARE: antet propriu, ca la ofertare-radar — secretul sta si in cron.job,
// care oricum e vizibil doar din baza. De mutat pe env cand se face curatenia
// secretelor (claude_context id 955).
import { createClient } from 'npm:@supabase/supabase-js@2';

const PAROLA = 'gz-hr-digest-2026-mNb4Xp';
const DESTINATARI = ['natalia.udrea@gazpet.ro', 'marilena.tudorache@gazpet.ro', 'razvan.trusu@gazpet.ro'];

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req: Request) => {
  const dinEnv = Deno.env.get('HR_DIGEST_SECRET');
  const antet = req.headers.get('x-hr-secret') || '';
  if (antet !== PAROLA && !(dinEnv && antet === dinEnv)) return json({ error: 'unauthorized' }, 401);

  // ?test=1 — mailul pleaca doar la Razvan, cu subiect marcat. Pentru verificari, fara sa
  // primeasca Natalia un raport din senin inainte sa i se explice ce e.
  const test = new URL(req.url).searchParams.get('test') === '1';
  const catre = test ? ['razvan.trusu@gazpet.ro'] : DESTINATARI;

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'lipsa_RESEND_API_KEY' }, 500);

  const azi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(new Date());
  const in45 = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  const acum7 = new Date(Date.now() - 7 * 864e5).toISOString();

  // Toate citirile, in paralel. Fiecare e mica; impreuna dau tot tabloul.
  const [fise, expira, expirate, neclas, aduse] = await Promise.all([
    // 1. angajati activi fara fisa de aptitudini (tipul AVIZ_MEDICAL, redenumit in UI)
    supa.from('hr_autorizatii')
      .select('id, employees!inner(name, active), hr_autorizatii_tipuri!inner(cod)')
      .is('deleted_at', null).is('fisier_path', null)
      .eq('hr_autorizatii_tipuri.cod', 'AVIZ_MEDICAL').eq('employees.active', true),
    // 2. autorizatii care expira in urmatoarele 45 de zile (oricare tip, fara medicale)
    supa.from('hr_autorizatii')
      .select('numar_autorizatie, data_expirare, employees!inner(name, active), hr_autorizatii_tipuri!inner(cod, denumire)')
      .is('deleted_at', null).eq('employees.active', true)
      .gte('data_expirare', azi).lte('data_expirare', in45)
      .neq('hr_autorizatii_tipuri.cod', 'AVIZ_MEDICAL')
      .order('data_expirare'),
    // 3. deja expirate, la oameni activi (fara medicale — alea au sectiunea lor)
    supa.from('hr_autorizatii')
      .select('data_expirare, employees!inner(name, active), hr_autorizatii_tipuri!inner(cod, denumire)')
      .is('deleted_at', null).eq('employees.active', true)
      .lt('data_expirare', azi)
      .neq('hr_autorizatii_tipuri.cod', 'AVIZ_MEDICAL')
      .order('data_expirare'),
    // 4. documente ramase neincadrate
    supa.from('hr_documente_personale')
      .select('id, hr_documente_personale_tipuri!inner(cod)', { count: 'exact', head: true })
      .eq('activ', true).is('deleted_at', null)
      .eq('hr_documente_personale_tipuri.cod', 'neclasificat'),
    // 5. cate documente au intrat saptamana trecuta prin import
    supa.from('hr_documente_personale')
      .select('id', { count: 'exact', head: true })
      .eq('activ', true).is('deleted_at', null)
      .not('drive_file_id', 'is', null).gte('uploadat_la', acum7),
  ]);

  const fiseLipsa = (fise.data || []).map((r: any) => r.employees.name).sort();
  const rE = (expira.data || []) as any[];
  const rX = (expirate.data || []) as any[];

  const lista = (nume: string[], max = 12) =>
    nume.slice(0, max).map((n) => `<li>${esc(n)}</li>`).join('') +
    (nume.length > max ? `<li><i>… și încă ${nume.length - max}</i></li>` : '');

  const randuriExpira = rE.map((r) =>
    `<tr><td style="padding:4px 10px 4px 0">${esc(r.employees.name)}</td>` +
    `<td style="padding:4px 10px 4px 0">${esc(r.hr_autorizatii_tipuri.denumire)}</td>` +
    `<td style="padding:4px 10px 4px 0">${esc(r.numar_autorizatie || '—')}</td>` +
    `<td style="padding:4px 0"><b>${esc(r.data_expirare)}</b></td></tr>`).join('');

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:640px">` +
    `<h2 style="margin:0 0 4px">Situația dosarelor de personal</h2>` +
    `<p style="margin:0 0 18px;color:#5a6975">Raport automat de luni, ${esc(azi)}. Cifrele sunt din platformă, la zi.</p>` +

    (rX.length ? `<h3 style="color:#a32a21;margin:18px 0 6px">🔴 Autorizații EXPIRATE la oameni activi: ${rX.length}</h3>` +
      `<ul style="margin:0 0 6px">${lista(rX.map((r) => `${r.employees.name} — ${r.hr_autorizatii_tipuri.denumire} (din ${r.data_expirare})`))}</ul>` : '') +

    (rE.length ? `<h3 style="margin:18px 0 6px">⏳ Expiră în următoarele 45 de zile: ${rE.length}</h3>` +
      `<table style="border-collapse:collapse;font-size:13px">${randuriExpira}</table>` : '') +

    `<h3 style="margin:18px 0 6px">🩺 Fără fișă de aptitudini în platformă: ${fiseLipsa.length} angajați activi</h3>` +
    (fiseLipsa.length ? `<ul style="margin:0 0 6px">${lista(fiseLipsa)}</ul>` : '<p style="margin:0">Toate sunt la zi. 🎉</p>') +

    `<h3 style="margin:18px 0 6px">📄 Documente rămase neîncadrate: ${neclas.count ?? '—'}</h3>` +
    `<p style="margin:0 0 6px;color:#5a6975">Se văd în HR → Documente, filtrul „Neclasificat".</p>` +

    `<h3 style="margin:18px 0 6px">📥 Intrate automat săptămâna trecută: ${aduse.count ?? 0} documente</h3>` +

    `<p style="margin:18px 0 0"><a href="https://pontaj-pro-sooty.vercel.app/hr">Deschide modulul HR</a></p>` +
    `<p style="color:#c0392b;font-size:12px;margin-top:16px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat, căsuța nu e citită. Întrebări: Razvan sau office@gazpet.ro.</p>` +
    `</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'PontajPRO <rapoarte@gazpet.ro>',
      to: catre,
      subject: `${test ? '[TEST] ' : ''}📋 HR săptămânal — ${rX.length ? rX.length + ' expirate, ' : ''}${fiseLipsa.length} fără fișă medicală, ${neclas.count ?? '?'} neîncadrate`,
      html,
    }),
  });
  if (!res.ok) return json({ ok: false, error: 'resend', detaliu: (await res.text()).slice(0, 300) }, 500);

  return json({
    ok: true, azi,
    expirate: rX.length, expira_45_zile: rE.length,
    fara_fisa_aptitudini: fiseLipsa.length,
    neclasificate: neclas.count, aduse_saptamana: aduse.count,
    destinatari: catre, test,
  });
});
