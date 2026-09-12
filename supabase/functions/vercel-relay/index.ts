// Releu catre functiile server de pe Vercel (/api/*), cu SEAP_IMPORT_SECRET din secretele Supabase.
//
// De ce: cron-urile pg_cron aveau secretul scris in clar in comanda; cand valoarea s-a rotit
// (01.09.2026), importul HR din Drive a ramas cu 401 fara sa observe nimeni. De acum cron-ul
// cheama releul cu parola radar, iar releul pune antetul x-import-secret din env — valoarea
// sta intr-un singur loc (Supabase Edge Secrets) si nu mai apare in nicio comanda.
//
// POST { path: 'hr-drive-import', body: {...}, wait?: true }
//  - wait=false (implicit): porneste apelul si raspunde imediat 202 (pentru cron)
//  - wait=true: asteapta raspunsul Vercel si il intoarce (pentru rulari manuale / probe)
// 07.09.2026: + pdf-sparge (spargerea PDF-urilor mari din documentatia de atribuire)
//
// ADUSA IN REPO 12.09.2026. SINGURA modificare fata de sursa deployata: parola radar nu mai e
// scrisa literal in cod, ci se verifica prin Vault (fn_verifica_radar_secret), care accepta si
// valoarea precedenta cat tine fereastra de rotire. Ironia e ca exact functia asta a fost
// construita ca sa scoata un secret din comenzile cron — dar si-l tinea pe al ei in sursa.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BAZA = 'https://pontaj-pro-sooty.vercel.app/api/';
const PERMISE = new Set(['hr-drive-import', 'hr-fise-import', 'seap-import', 'plansa-felii', 'pdf-sparge']);

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'doar POST' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const primit = req.headers.get('x-radar-secret');
  if (!primit) return json({ error: 'unauthorized' }, 401);
  const { data: ok, error: eS } = await db.rpc('fn_verifica_radar_secret', { p_secret: primit });
  if (eS) return json({ error: 'verificare secret: ' + eS.message }, 500);
  if (ok !== true) return json({ error: 'unauthorized' }, 401);

  const secret = Deno.env.get('SEAP_IMPORT_SECRET');
  if (!secret) return json({ error: 'lipseste SEAP_IMPORT_SECRET din secretele Supabase' }, 500);

  let corp: any = {};
  try { corp = await req.json(); } catch (_) { /* gol */ }
  const path = String(corp?.path || '').replace(/^\/?api\//, '').replace(/[^a-z0-9-]/g, '');
  if (!PERMISE.has(path)) return json({ error: `path nepermis: ${path}` }, 400);

  const apel = fetch(BAZA + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-import-secret': secret },
    body: JSON.stringify(corp?.body ?? {}),
  });

  if (corp?.wait === true) {
    const r = await apel;
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
  }
  // fire-and-forget: rezultatul se vede in raspunsul Vercel (loguri), nu aici
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(apel.then((r) => r.text()).catch(() => {}));
  return json({ ok: true, pornit: path }, 202);
});
