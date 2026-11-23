// redari-mail-oauth — conectarea / revocarea căsuței redari@gazpet.ro pentru TRIMITERE (scopul `trimitere`, gmail.send + openid email).
// Fișa a–e (docs/redari/PLAN_EMAIL_REDARI.md §2.3): (a) răspunsurile Google (code, state, token, id_token) = DATE; (b) un secret în Vault
// (prin RPC), rândul red_mail_oauth_state, un eveniment; nu trimite mail; (c) JWT-ul omului pentru state / evenimente; service_role DOAR
// pentru RPC-urile de Vault (fn_red_mail_secret_seteaza / _citeste, EXECUTE doar service_role, p_apelant = uid-ul din getUser, re-verificat
// owner în BD), după poarta owner din handler; (d) doar owner (getUser + fn_sms_e_owner), state consumat atomic; (e) fiecare conectare = clic al
// owner-ului, logat la Google ca redari@. Se publică cu verify_jwt = true (callback-ul vine din pagina ERP cu JWT, nu direct de la Google).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeOauth } from '../_shared/redariMailOauthHandler.mjs';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const SECRET_TRIMITERE = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN';
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
    // clientul service_role se creează DOAR când handlerul ajunge la Vault (după poarta owner și consumul state-ului)
    const svc = () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    let corp: unknown;
    try { corp = await req.json() } catch { return raspuns({ cod: 'cerere_invalida' }, 400) }
    const r = await raspundeOauth({ jwt, corp }, {
      getUser: () => uc.auth.getUser(jwt),
      owner: () => uc.rpc('fn_sms_e_owner'),
      stateStart: (scop: string, sha: string) => uc.rpc('fn_red_mail_oauth_start', { p_scop: scop, p_state_sha256: sha }),
      stateConsuma: async (sha: string) => {
        const { data, error } = await uc.rpc('fn_red_mail_oauth_consuma', { p_state_sha256: sha });
        if (error) return { error: { cod: /state_invalid/.test(error.message || '') ? 'state_invalid' : 'state_neconfirmat' } };
        return { data };
      },
      eveniment: (tip: string, cod: string) => uc.rpc('fn_red_mail_oauth_eveniment', { p_tip: tip, p_cod: cod }),
      secretSeteaza: (valoare: string, apelant: string, casuta: string | null) =>
        svc().rpc('fn_red_mail_secret_seteaza', { p_nume: SECRET_TRIMITERE, p_valoare: valoare, p_apelant: apelant, p_casuta: casuta }),
      secretCiteste: (apelant: string, motiv: string) => svc().rpc('fn_red_mail_secret_citeste', { p_nume: SECRET_TRIMITERE, p_apelant: apelant, p_motiv: motiv }),
      env: (nume: string) => Deno.env.get(nume),
      fetch: (u: string, init: RequestInit) => fetch(u, init),
      getRandomValues: (v: Uint8Array) => crypto.getRandomValues(v),
      subtle: crypto.subtle,
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'eroare_neconfirmata' }, 503); }
});
