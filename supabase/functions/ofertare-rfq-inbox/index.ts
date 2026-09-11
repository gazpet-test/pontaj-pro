// ofertare-rfq-inbox v1 — primește ofertele sosite pe oferte@gazpet.ro.
// Apelat de Google Apps Script (trigger 10 min pe contul oferte@): pentru fiecare
// mail necitit cu „RFQ-##” în subiect trimite PDF-urile aici. Funcția: validează
// RFQ-ul → urcă PDF-ul în storage → creează oferta → pornește citirea AI.
// Auth: header x-inbox-secret.
//
// ADUSĂ ÎN REPO la 12.09.2026. Rula neversionată, cu secretul scris LITERAL în sursă
// (`const INBOX_SECRET = '...'`) și `verify_jwt: false` — al patrulea caz din același
// tipar, iar comentariul original spunea chiar „pattern radar/scorilos", deci a fost o
// practică repetată, nu o scăpare. Oricine avea valoarea putea urca PDF-uri în storage,
// crea rânduri în ofertare_rfq_oferte și declanșa apeluri AI plătite.
//
// ⚠️ ATENȚIE LA DEPLOY — fișierul ăsta NU e încă deployat, deliberat.
// Secretul e folosit ȘI de Google Apps Script-ul de pe contul oferte@gazpet.ro. Dacă se
// deployează versiunea asta fără ca `RFQ_INBOX_SECRET` să existe în Edge Secrets, se
// OPREȘTE primirea ofertelor de la furnizori. Ordinea corectă:
//   1. se pune o valoare nouă în Edge Secrets ca RFQ_INBOX_SECRET;
//   2. se actualizează antetul x-inbox-secret în Apps Script cu aceeași valoare;
//   3. abia apoi se deployează funcția asta.
// Vezi task #51 (rotirea secretelor).
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'ofertare';

Deno.serve(async (req: Request) => {
  // Secretul vine din Edge Secrets, nu din sursă: repo-ul e public.
  const asteptat = Deno.env.get('RFQ_INBOX_SECRET') || '';
  const primit = req.headers.get('x-inbox-secret') || '';
  if (!asteptat || primit !== asteptat) return new Response('nope', { status: 401 });

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    const { subiect, expeditor, fisier_nume, pdf_base64 } = await req.json();
    if (!pdf_base64 || !subiect) return fail('subiect sau pdf lipsă');

    const m = String(subiect).match(/RFQ[-\s]?(\d+)/i);
    if (!m) return fail('fără referință RFQ-## în subiect');
    const rfqId = Number(m[1]);
    const { data: rfq } = await supa.from('ofertare_rfq').select('id, status').eq('id', rfqId).single();
    if (!rfq) return fail(`RFQ-${rfqId} nu există în platformă`);

    const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
    if (bytes.length > 28_000_000) return fail('PDF prea mare');
    const safe = String(fisier_nume || 'oferta.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    const path = `rfq/${rfqId}/${Date.now()}_${safe}`;
    const { error: eUp } = await supa.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (eUp) return fail('storage: ' + eUp.message);

    // furnizor provizoriu din expeditor — AI-ul îl corectează din antetul ofertei
    const furnizor = String(expeditor || '').replace(/<.*$/, '').trim().slice(0, 200) || 'necunoscut (din mail)';
    const { data: of, error: eIns } = await supa.from('ofertare_rfq_oferte')
      .insert({ rfq_id: rfqId, furnizor, fisier_path: path }).select('id').single();
    if (eIns) return fail('insert: ' + eIns.message);

    if (rfq.status === 'draft' || rfq.status === 'trimisa') {
      await supa.from('ofertare_rfq').update({ status: 'oferte_primite', updated_at: new Date().toISOString() }).eq('id', rfqId);
    }

    // pornește citirea AI (fire-and-forget cu service role — trece de verify_jwt)
    let ai = 'pornit';
    try {
      const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ofertare-rfq-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ oferta_id: of.id }),
      });
      const j = await r.json();
      ai = j?.error ? 'eșuat: ' + j.error : `ok (${j?.preturi_gasite ?? '?'}/${j?.materiale ?? '?'} prețuri)`;
    } catch (e) { ai = 'eșuat: ' + String(e?.message || e); }

    return new Response(JSON.stringify({ ok: true, rfq_id: rfqId, oferta_id: of.id, import_ai: ai }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return fail('eroare: ' + String(e?.message || e));
  }
});
