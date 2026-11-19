// redari-import-verificare-ai — A DOUA OPINIE AI (Claude Sonnet 5.5) pe coloanele de identificare din previzualizarea importului TGZ (Redări, 19.11.2026).
// Fișa a–e (CLAUDE.md pct. 7; descrierea PR-ului): (a) citește valori din Excel-ul TGZ (conținut extern, poate fi ostil) — DOAR poz_hg / nr_cadastral /
// tarla + index; (b) NU scrie date de business: scrie doar jurnalul red_import_ai_jurnal prin RPC-urile 20261131j și întoarce semnalele ecranului;
// cheltuie bani (Anthropic) — cu plafoane în BD; (c) JWT-ul omului pentru drept + rezervare (auth.uid() în SQL); service_role DOAR pentru
// fn_red_import_ai_inchide (EXECUTE doar service_role), DUPĂ rezervare; (d) owner sau dreptul import_verificare_ai pe proiect (fn_red_import_ai_poate),
// verificat aici, nu doar ascunderea butonului; (e) fiecare pornire = apăsarea omului după costul estimat afișat; rezultatul nu schimbă nimic — omul decide.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeVerificare } from '../_shared/redariImportAiHandler.mjs';
import { SECRET_CHEIE_AI } from '../_shared/redariImportAi.mjs';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const raspuns = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return raspuns({ cod: 'metoda_nepermisa' }, 405);
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer[ \t]+/i, '');
    if (!jwt) return raspuns({ cod: 'neautentificat' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    let corp: unknown;
    try { corp = await req.json() } catch { return raspuns({ cod: 'cerere_invalida' }, 400) }
    const r = await raspundeVerificare({ jwt, corp }, {
      getUser: () => uc.auth.getUser(jwt),
      poate: (proiect: string) => uc.rpc('fn_red_import_ai_poate', { p_proiect: proiect }),
      cheieApi: () => Deno.env.get(SECRET_CHEIE_AI) || null,
      rezerva: (p: Record<string, unknown>) => uc.rpc('fn_red_import_ai_rezerva', p),
      // ── doar după rezervare: închiderea în jurnal (EXECUTE doar service_role; CAS pe id + token-ul rezervării) ──
      inchide: (p: Record<string, unknown>) => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
        .rpc('fn_red_import_ai_inchide', p),
      fetch: (u: string, i: RequestInit) => fetch(u, i),
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'eroare_neconfirmata' }, 503); }   // infrastructura ≠ cerere invalidă; fără detalii (pot conține valori)
});
