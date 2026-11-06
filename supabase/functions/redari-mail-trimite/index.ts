// Fișa a–e: (a) adrese / snapshoturi = date; (b) mail extern numai după aprobarea owner;
// (c) JWT-ul omului peste tot, fără service_role; (d) getUser + profiles.is_owner în RPC;
// (e) aprobare separată pe hash-ul fiecărui lot. Decizia 05.11: transport real OPRIT.
// Fără OAuth, Vault, cron sau secrete de trimitere în această livrare.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeTrimitere } from '../_shared/redariMailF2Handler.mjs';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const raspuns = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return raspuns({ cod: 'metoda_nepermisa' }, 405);
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer[ \t]+/i, '');
    if (!jwt) return raspuns({ cod: 'neautentificat' }, 401);
    const uc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const r = await raspundeTrimitere({ jwt, corp: await req.json() }, {
      getUser: () => uc.auth.getUser(jwt),
      owner: () => uc.rpc('fn_sms_e_owner'), // verifică profiles.is_owner pentru auth.uid(), fără uid din body
      lot: (id: string) => uc.from('red_mail_loturi').select('*').eq('id', id).maybeSingle(),
      setari: () => uc.from('red_mail_setari').select('trimitere_oprita').eq('id', 1).single(),
      informare: async (proiect: string) => {
        const { data, error } = await uc.from('red_proiecte').select('cod').eq('id', proiect).single();
        if (error) return { data: null, error: true };
        return uc.rpc('fn_red_informare_publicata', { p_cod: data.cod });
      },
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'cerere_neconfirmata' }, 400); }
});
