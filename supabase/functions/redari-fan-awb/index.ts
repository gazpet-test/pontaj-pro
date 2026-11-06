// redari-fan-awb — FAN Courier pentru plicurile Redări (SCHELET, transport real OPRIT în cod).
// Fișa a–e (docs/redari/FANCOURIER_INTEGRARE.md §4): (a) răspunsurile FAN = date; (b) AWB-uri plătite / comenzi curier doar după
// aprobarea owner-ului pe lot; (c) JWT-ul omului, fără service_role; secretele FAN_SELFAWB_USERNAME / FAN_SELFAWB_PASSWORD /
// FAN_CLIENT_ID se citesc DOAR pe calea reală (inexistentă în schelet); (d) fn_sms_e_owner pe auth.uid(); (e) aprobare pe hash.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeFan } from '../_shared/redariFanHandler.mjs';
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
    const r = await raspundeFan({ jwt, corp: await req.json() }, {
      getUser: () => uc.auth.getUser(jwt),
      owner: () => uc.rpc('fn_sms_e_owner'),
      lot: (id: string) => uc.from('red_loturi_plicuire').select('id, proiect_id, nr_lot').eq('id', id).maybeSingle(),
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'cerere_neconfirmata' }, 400); }
});
