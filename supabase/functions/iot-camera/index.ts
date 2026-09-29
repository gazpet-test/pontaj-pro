// iot-camera — poze ONVIF de la camerele QNAP (Terra le ia prin snapshot.cgi și le împinge aici) → Storage + iot_dispozitive/iot_citiri
//
// Actiuni (POST JSON {actiune}):
//   push (x-camera-secret Terra) {extern_id, nume, jpg_base64} → upload Storage (upsert, un singur fișier per cameră) + upsert iot_dispozitive/iot_citiri
//   poza (JWT orice user autentificat) {extern_id} → URL semnat (5 min) pentru ultima poză + vârsta ei
//
// Nu există relay cloud pentru aceste camere (QNAP local, myQNAPcloud dezactivat) — Terra împinge periodic (~2 min),
// pagina cere doar ultima poză cunoscută. Vezi claude_docs handoff_cladire pentru arhitectură completă.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { timingSafeEqual } from 'node:crypto';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-camera-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const BUCKET = 'cladire-camere';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Digest-uri de aceeași lungime, comparate în timp constant.
async function secretEgal(a: string, b: string) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return timingSafeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Doar POST' }, 405);
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch { return json({ error: 'JSON invalid' }, 400); }
  const actiune = String(body.actiune || '');

  try {
    // ── PUSH (Terra, secret dedicat, timing-safe) ──
    if (actiune === 'push') {
      const secret = req.headers.get('x-camera-secret') || '';
      const { data: asteptat, error: secretError } = await db.rpc('iot_secret_get', { p_name: 'CAMERA_SNAP_SECRET' });
      if (secretError) return json({ error: 'Autentificare indisponibilă' }, 503);
      if (typeof asteptat !== 'string' || !asteptat || !secret || !await secretEgal(secret, asteptat)) return json({ error: 'Secret invalid' }, 401);

      const externId = String(body.extern_id || ''), nume = String(body.nume || externId);
      if (!externId || !body.jpg_base64) return json({ error: 'extern_id și jpg_base64 obligatorii' }, 400);
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(body.jpg_base64), c => c.charCodeAt(0)); } catch { return json({ error: 'jpg_base64 invalid' }, 400); }
      if (bytes.length < 100) return json({ error: 'poză prea mică, refuzată' }, 400);

      const path = `snapshot_${externId.replace(/\./g, '_')}.jpg`;
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (upErr) return json({ error: 'Nu s-a putut salva poza: ' + upErr.message }, 500);

      const la = new Date().toISOString();
      const { data: disp, error: dispErr } = await db.from('iot_dispozitive').upsert({
        sursa: 'qnap_cam', extern_id: externId, nume, meta: { path },
        ultima_citire: { path, ok: true }, citit_la: la,
      }, { onConflict: 'sursa,extern_id' }).select('id').single();
      if (dispErr || !disp) return json({ error: 'Poza salvată, dar dispozitivul nu s-a putut actualiza' }, 500);
      await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori: { ok: true }, la }); // fără poza — doar marker de prezență
      return json({ ok: true, path });
    }

    // ── POZA (orice user autentificat — la fel ca restul paginii Clădire) ──
    if (actiune === 'poza') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!jwt) return json({ error: 'fără autentificare' }, 401);
      const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data: udata } = await uc.auth.getUser();
      if (!udata?.user) return json({ error: 'token invalid' }, 401);

      const externId = String(body.extern_id || '');
      if (!externId) return json({ error: 'extern_id obligatoriu' }, 400);
      const { data: disp } = await db.from('iot_dispozitive').select('meta, citit_la').eq('sursa', 'qnap_cam').eq('extern_id', externId).eq('activ', true).maybeSingle();
      if (!disp?.meta?.path) return json({ error: 'camera necunoscută sau fără poză încă' }, 404);
      const { data: signed, error: signErr } = await db.storage.from(BUCKET).createSignedUrl(disp.meta.path, 300);
      if (signErr || !signed?.signedUrl) return json({ error: 'nu s-a putut genera link-ul' }, 500);
      return json({ ok: true, url: signed.signedUrl, la: disp.citit_la });
    }

    return json({ error: `acțiune necunoscută: ${actiune}` }, 400);
  } catch (e) {
    return json({ error: (e as Error)?.message || 'Serviciu temporar indisponibil' }, 500);
  }
});
