import { createClient } from 'npm:@supabase/supabase-js@2';
import { timingSafeEqual } from 'node:crypto';
import { valideazaCitire } from './valideaza.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Digest-uri de aceeași lungime, comparate în timp constant (inclusiv secrete cu lungimi diferite).
async function secretEgal(a: string, b: string) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return timingSafeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Doar POST' }), {
    status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' },
  });
  const secret = req.headers.get('x-terra-secret');
  if (!secret) return json({ error: 'Secret invalid' }, 401);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: asteptat, error: secretError } = await db.rpc('iot_secret_get', { p_name: 'TERRA_TEMP_SECRET' });
    if (secretError) return json({ error: 'Autentificare indisponibilă' }, 503);
    if (typeof asteptat !== 'string' || !asteptat || !await secretEgal(secret, asteptat)) return json({ error: 'Secret invalid' }, 401);

    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'JSON invalid' }, 400); }
    const valid = valideazaCitire(body);
    if (!valid.ok) return json({ error: valid.error }, 400);
    const la = new Date().toISOString();
    // Filtre fixe: expeditorul nu poate alege sau crea un alt dispozitiv.
    const { data: disp, error: updateError } = await db.from('iot_dispozitive')
      .update({ ultima_citire: valid.valori, citit_la: la })
      .eq('sursa', 'terra').eq('extern_id', 'terra').select('id').maybeSingle();
    if (updateError) return json({ error: 'Nu s-a putut salva ultima citire' }, 500);
    if (!disp) return json({ error: 'Dispozitivul Server Terra nu este configurat' }, 409);
    const { error: insertError } = await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori: valid.valori, la });
    if (insertError) return json({ error: 'Ultima citire salvată, dar istoricul nu s-a putut salva' }, 500);
    return json({ ok: true, citit_la: la });
  } catch {
    // Nu expunem chei, răspunsuri Vault sau detalii interne în log/răspuns.
    return json({ error: 'Serviciu temporar indisponibil' }, 500);
  }
});
