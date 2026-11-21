// redari-fan-awb — FAN Courier pentru plicurile Redări. ACTIVARE pentru Testul 1 (docs/redari/FAN_TEST1_PASI.md): TRANSPORT_REAL_ACTIV = true
// cu garda DOAR_PROIECTE_TEST = true în handler → calea reală DOAR pe un lot al unui proiect „TEST-…”, marcat TEST; restul 423.
// F1 (docs/redari/FAN_FLUX_OPERATOR_SPEC.md §7.3, §13 F1): butonul unic `trimite` + poarta „operator numit sau owner” (fn_red_fan_e_operator) pe
// toate acțiunile în afara căii detaliate `genereaza` (owner).
// Fișa a–e (docs/redari/FANCOURIER_INTEGRARE.md §4): (a) răspunsurile FAN = date (afișate / propuneri, nimic ireversibil automat);
// (b) AWB-uri plătite doar după aprobarea din comandă (sub plafonul zilei) sau a owner-ului, și claim-ul atomic;
// (c) JWT-ul omului pentru TOATE citirile și pentru COMENZI (clasa A); al DOILEA client, service_role (cheia de service_role, Edge Secret
// standard), e construit DOAR pentru RPC-urile clasei B (înscrierea rezultatelor externe: fn_red_fan_srv_*), DOAR după poarta omului, cu
// p_actor = user.id din JWT-ul verificat; cu el nu se citește și nu se scrie nimic direct pe tabele (fără GRANT; RPC-urile sunt DEFINER cu EXECUTE
// exclusiv service_role). Justificarea (CLAUDE.md pct. 7 (c)): singura alternativă ar fi EXECUTE authenticated pe înscriere, adică exact defectul
// „operatorul poate fabrica fapte ale curierului” (spec §7.3). Secretele FAN se citesc DOAR pe calea reală, după poartă, flag, garda „doar TEST” și,
// pe `trimite`, după RPC-ul comenzii; (d) fn_red_fan_e_operator / fn_sms_e_owner pe auth.uid(), în handler; (e) fiecare apăsat = decizie umană;
// peste plafonul zilei totul așteaptă aprobarea owner-ului.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { raspundeFan, transportPermis } from '../_shared/redariFanHandler.mjs';
import { citesteToate } from '../_shared/redariFanTransport.mjs';
import { citesteLotFan } from '../_shared/redariFan.mjs';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
// generat_la (runda 5 #1155): ziua generării = limita de jos a momentului posibil al evenimentelor de urmărire (redariFan.mjs::momentPosibilFan)
const COL_FAN = 'id, plic_id, nr_plic, stare, hash_date, awb, versiune_urmarire, intentie_cheie, motiv, generat_la';
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
    // clasa B: clientul service_role, construit LENEȘ (doar dacă o acțiune ajunge la înscrierea unui rezultat extern, deci după poarta omului)
    let sc: ReturnType<typeof createClient> | null = null;
    const server = () => sc ??= createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    let corp: unknown
    try { corp = await req.json() } catch { return raspuns({ cod: 'cerere_invalida' }, 400) }   // doar JSON-ul stricat = 400
    const r = await raspundeFan({ jwt, corp }, {
      getUser: () => uc.auth.getUser(jwt),
      owner: () => uc.rpc('fn_sms_e_owner'),
      // F1: operator numit SAU owner — o singură definiție, în BD (fn_red_fan_e_operator pe auth.uid())
      operator: () => uc.rpc('fn_red_fan_e_operator'),
      lot: (id: string) => uc.from('red_loturi_plicuire').select('id, proiect_id, nr_lot').eq('id', id).maybeSingle(),
      // garda „doar TEST” (după flag, ÎNAINTE de secrete): marcajul lotului, citit cu JWT-ul omului (RLS admin / editor Redări);
      // + alegerea oPOD a lotului (18.11.2026, migrarea 20261227a), recitită de generare și de `trimite`: intră în corp și în hash. Aceeași citire ca
      // ecranul (citesteLotFan, L19): fără coloana opod (migrarea neaplicată) rândul vine cu opod = null → toate acțiunile în afara generării și a
      // trimiterii merg ca înainte; generarea / trimiterea refuză (503), nimic trimis (Jakarinos #1135 r1 P1)
      fanLot: (id: string) => citesteLotFan((coloane: string) => uc.from('red_fan_loturi').select(coloane).eq('lot_id', id).maybeSingle(), 'lot_id, test, prima_aprobare_la'),
      // `trimite`, pasul 4: garda COMPLETĂ (cereMarcaj: true) pe marcajul recitit după RPC-ul comenzii — aceeași funcție ca în handler (L19)
      transportPermisDupaRpc: (x: { proiectCod: string | null, fanLot: unknown }) => transportPermis({ proiectCod: x.proiectCod, fanLot: x.fanLot, cereMarcaj: true }),
      // ── doar pe calea reală (după flag și garda „doar TEST”) ──
      secrete: () => ({ username: Deno.env.get('FAN_SELFAWB_USERNAME'), password: Deno.env.get('FAN_SELFAWB_PASSWORD'), clientId: Deno.env.get('FAN_CLIENT_ID') }),
      rpc: (nume: string, args: Record<string, unknown>) => uc.rpc(nume, args),
      // clasa B (fn_red_fan_srv_*): DOAR cu service_role, DOAR după poarta omului; p_actor îl pune transportul din user.id (JWT verificat)
      rpcServer: (nume: string, args: Record<string, unknown>) => server().rpc(nume, args),
      // `trimite` fără plic valid: intenția cu cheia EXACTĂ (Jakarinos #1136 r1 P1 — reconcilierea cheii înaintea oricărui rezultat terminal), JWT-ul omului
      intentie: (cheie: string) => uc.from('v_red_fan_intentii').select('cheie, lot_id, stare, lucru_pana_la, incheiata_la, rezultat, ramase, necunoscute, generate, de_aprobat').eq('cheie', cheie).maybeSingle(),
      randuriLot: (lotId: string) => citesteToate(() => uc.from('red_fan_awb').select(COL_FAN).eq('lot_id', lotId), [lotId]),
      proiect: (id: string) => uc.from('red_proiecte').select('id, cod').eq('id', id).maybeSingle(),
      // manifestul etichetelor: TOATE plicurile lotului (și cele anulate: un AWB viu pe un plic anulat se semnalează, nu se tipărește)
      plicuriLot: (lotId: string) => citesteToate((ids: string[]) => uc.from('red_plicuri').select('id, nr_plic, stare').in('lot_id', ids), [lotId]),
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
      acum: () => Date.now(),   // momentul procesării urmăririi (regula momentului posibil, runda 5 #1155)
      subtle: crypto.subtle,
    });
    return raspuns(r.body, r.status);
  } catch { return raspuns({ cod: 'eroare_neconfirmata' }, 503); }   // Jakarinos r1 P2: infrastructura ≠ cerere invalidă
});
