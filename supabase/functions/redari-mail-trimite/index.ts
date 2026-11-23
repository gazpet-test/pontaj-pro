// redari-mail-trimite — trimiterea unui lot e-mail aprobat, din redari@gazpet.ro (Gmail API, scopul `trimitere`). F2b, 18.11.2026.
// Fișa a–e (docs/redari/PLAN_EMAIL_REDARI.md §2.4): (a) adresele / snapshoturile din BD = date; (b) trimite mail extern din redari@ DOAR pe un lot
// aprobat de owner pe hash, scrie doar red_mail_mesaje prin RPC-urile F2 (rezervă → apel_incepe → rezultat); (c) JWT-ul omului pentru tot ce e BD;
// service_role DOAR pentru RPC-ul de citire a refresh token-ului din Vault (fn_red_mail_secret_citeste, EXECUTE doar service_role, p_apelant =
// uid-ul din getUser), apelat DUPĂ toate gărzile; secretele clientului OAuth se citesc doar în wrapperul gmailHttp.mjs, la refresh; (d) owner
// (getUser + fn_sms_e_owner); garda DOAR_PROIECTE_TEST (proiectul lotului „TEST-…”, citit din bază) înaintea oricărui secret / apel; (e) fiecare
// apăsare = decizie umană pe un lot aprobat; rezultatul ambiguu rămâne `necunoscut` până la reconciliere (fără retrimitere).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeTrimitere, SECRET_TRIMITERE } from '../_shared/redariMailF2Handler.mjs';
import { creeazaGmailHttp } from '../_shared/gmailHttp.mjs';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const COL_LOT = 'id, proiect_id, uat_id, stare, versiune, lot_sha256, aprobat_lot_sha256, aprobat_de, aprobat_la';
const COL_SETARI = 'trimitere_oprita, extern_permis, doar_proiecte_test, trimitere_conectata_la, trimitere_casuta, pauza_pana, versiune';
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
    const r = await raspundeTrimitere({ jwt, corp }, {
      getUser: () => uc.auth.getUser(jwt),
      owner: () => uc.rpc('fn_sms_e_owner'),
      lot: (id: string) => uc.from('red_mail_loturi').select(COL_LOT).eq('id', id).maybeSingle(),
      proiect: (id: string) => uc.from('red_proiecte').select('id, cod').eq('id', id).maybeSingle(),
      setari: () => uc.from('red_mail_setari').select(COL_SETARI).eq('id', 1).single(),
      informare: async (proiect: string) => {
        const { data, error } = await uc.from('red_proiecte').select('cod').eq('id', proiect).single();
        if (error) return { data: null, error: true };
        return uc.rpc('fn_red_informare_publicata', { p_cod: data.cod });
      },
      // ── doar după toate gărzile de mai sus ──
      secret: (apelant: string) => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
        .rpc('fn_red_mail_secret_citeste', { p_nume: SECRET_TRIMITERE, p_apelant: apelant, p_motiv: 'trimitere' }),
      http: () => creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env: (n: string) => Deno.env.get(n), fetch: (u: string, i: RequestInit) => fetch(u, i) }),
      opreste: () => uc.rpc('fn_red_mail_f2_setari', { p_oprit: true, p_extern: false, p_versiune: null }),
      rezerva: (lot: string) => uc.rpc('fn_red_mail_rezerva', { p_lot: lot }),
      incepe: (mesaj: string, token: string) => uc.rpc('fn_red_mail_apel_incepe', { p_mesaj: mesaj, p_token: token }),
      rezultat: (mesaj: string, token: string, stare: string, gmailId: string | null, threadId: string | null) =>
        uc.rpc('fn_red_mail_rezultat', { p_mesaj: mesaj, p_token: token, p_stare: stare, p_gmail_id: gmailId, p_thread_id: threadId }),
      // recitirea stării mesajului (JWT-ul omului, RLS) după o persistare neconfirmată — doar citire, fără conținut
      mesaj: (id: string) => uc.from('red_mail_mesaje').select('id, stare, eroare_cod').eq('id', id).maybeSingle(),
      descarca: async (cale: string) => {
        const { data, error } = await uc.storage.from('redari').download(cale);
        if (error || !data) throw new Error('atasament_indisponibil');
        return new Uint8Array(await data.arrayBuffer());
      },
      pauza: (ms: number) => new Promise<void>(res => setTimeout(res, ms)),
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'eroare_neconfirmata' }, 503); }   // infrastructura ≠ cerere invalidă
});
