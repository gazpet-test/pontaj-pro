import { createClient } from 'npm:@supabase/supabase-js@2';
import { timingSafeEqual } from 'node:crypto';
import { valideazaCitiri, AI_NOI } from './valideaza.ts';

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
  const secret = req.headers.get('x-retea-secret');
  if (!secret) return json({ error: 'Secret invalid' }, 401);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: asteptat, error: secretError } = await db.rpc('iot_secret_get', { p_name: 'RETEA_MON_SECRET' });
    if (secretError) return json({ error: 'Autentificare indisponibilă' }, 503);
    if (typeof asteptat !== 'string' || !asteptat || !await secretEgal(secret, asteptat)) return json({ error: 'Secret invalid' }, 401);

    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'JSON invalid' }, 400); }
    const valid = valideazaCitiri(body);
    if (!valid.ok) return json({ error: valid.error }, 400);

    const la = new Date().toISOString();
    const salvate: string[] = [];
    const necunoscute: string[] = [];
    for (const c of valid.citiri) {
      const valori = {
        online: c.online, latency_ms: c.latency_ms, cpu_temp: c.cpu_temp,
        hdd_max: c.hdd_max, cpu_load: c.cpu_load, uptime_s: c.uptime_s,
        disk_pct: c.disk_pct, ram_pct: c.ram_pct, raid_ok: c.raid_ok,
        gpu_temp: c.gpu_temp, gpu_w: c.gpu_w, gpu_util: c.gpu_util, vram_pct: c.vram_pct,
        ai_gemini_ramas_pct: c.ai_gemini_ramas_pct, ai_claude_ramas_pct: c.ai_claude_ramas_pct,
        ai_gemini_reset_s: c.ai_gemini_reset_s, ai_claude_reset_s: c.ai_claude_reset_s,
        ...Object.fromEntries(AI_NOI.map(k => [k, c[k]])),
      };
      // Filtre fixe pe (sursa='retea', extern_id): expeditorul nu poate alege/crea alt dispozitiv.
      const { data: disp, error: updateError } = await db.from('iot_dispozitive')
        .update({ ultima_citire: valori, citit_la: la })
        .eq('sursa', 'retea').eq('extern_id', c.extern_id).select('id').maybeSingle();
      if (updateError) return json({ error: 'Nu s-a putut salva ultima citire' }, 500);
      if (!disp) { necunoscute.push(c.extern_id); continue; } // dispozitiv inexistent: ignorat, nu creat
      const { error: insertError } = await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori, la });
      if (insertError) return json({ error: 'Ultima citire salvată, dar istoricul nu s-a putut salva' }, 500);
      salvate.push(c.extern_id);
    }
    return json({ ok: true, citit_la: la, salvate, necunoscute });
  } catch {
    // Nu expunem chei, răspunsuri Vault sau detalii interne în log/răspuns.
    return json({ error: 'Serviciu temporar indisponibil' }, 500);
  }
});
