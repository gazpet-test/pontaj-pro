// redari-fan-awb — FAN Courier pentru plicurile Redări (transport real OPRIT în cod: TRANSPORT_REAL_ACTIV = false → 423).
// Fișa a–e (docs/redari/FANCOURIER_INTEGRARE.md §4): (a) răspunsurile FAN = date (afișate / propuneri, nimic ireversibil automat);
// (b) AWB-uri plătite doar după aprobarea owner-ului pe lot (fn_red_fan_aproba) și claim-ul atomic (fn_red_fan_claim_lot);
// (c) JWT-ul omului, FĂRĂ service_role; secretele FAN_SELFAWB_USERNAME / FAN_SELFAWB_PASSWORD / FAN_CLIENT_ID se citesc DOAR pe calea
// reală, după poarta owner și flag; (d) fn_sms_e_owner pe auth.uid(), în handler; (e) aprobare pe hash, fiecare apăsat = decizie umană.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeFan } from '../_shared/redariFanHandler.mjs';
import { citesteToate } from '../_shared/redariFanTransport.mjs';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const COL_FAN = 'id, plic_id, nr_plic, stare, hash_date, awb';
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
    let corp: unknown
    try { corp = await req.json() } catch { return raspuns({ cod: 'cerere_invalida' }, 400) }   // doar JSON-ul stricat = 400
    const r = await raspundeFan({ jwt, corp }, {
      getUser: () => uc.auth.getUser(jwt),
      owner: () => uc.rpc('fn_sms_e_owner'),
      lot: (id: string) => uc.from('red_loturi_plicuire').select('id, proiect_id, nr_lot').eq('id', id).maybeSingle(),
      // ── doar pe calea reală (după flag) ──
      secrete: () => ({ username: Deno.env.get('FAN_SELFAWB_USERNAME'), password: Deno.env.get('FAN_SELFAWB_PASSWORD'), clientId: Deno.env.get('FAN_CLIENT_ID') }),
      rpc: (nume: string, args: Record<string, unknown>) => uc.rpc(nume, args),
      randuriLot: (lotId: string) => citesteToate(() => uc.from('red_fan_awb').select(COL_FAN).eq('lot_id', lotId), [lotId]),
      proiect: (id: string) => uc.from('red_proiecte').select('id, cod').eq('id', id).maybeSingle(),
      datePlicuri: async (plicIds: string[]) => {
        // aceleași citiri ca ecranul (FanAwbPrevizualizare.jsx) → același contact, același corp, același hash (L19)
        const pl = await citesteToate((ids: string[]) => uc.from('red_plicuri').select('id, proiect_id, lot_id, nr_plic, destinatar_nume, stare').in('id', ids).eq('stare', 'activ'), plicIds);
        if (pl.error) return { error: pl.error };
        const cv = await citesteToate((ids: string[]) => uc.from('red_convocari').select('id, plic_id, detinator_id').in('plic_id', ids).eq('stare', 'activ').is('sters_la', null), plicIds);
        if (cv.error) return { error: cv.error };
        const det = [...new Set(cv.data.map((c: { detinator_id: string }) => c.detinator_id))];
        const ct = await citesteToate((ids: string[]) => uc.from('red_detinatori_contact').select('detinator_id, telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal').in('detinator_id', ids), det, 'detinator_id');
        if (ct.error) return { error: ct.error };
        return { data: { plicuri: pl.data, convocari: cv.data, contacte: ct.data } };
      },
      fetch: (url: string, init: RequestInit) => fetch(url, init),
      pauza: (ms: number) => new Promise<void>(res => setTimeout(res, ms)),
      subtle: crypto.subtle,
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'eroare_neconfirmata' }, 503); }   // Jakarinos r1 P2: infrastructura ≠ cerere invalidă
});
