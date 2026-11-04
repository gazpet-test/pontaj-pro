// redari-coresp-mail — Redări → Corespondență: „📧 Pregătește mailul” (deciziile lui Răzvan 04.11.2026, migrarea 20261130f; r2 după review r1).
// POST { corespondenta_id, intentie_id, versiune, fisier_id } → un mail INTERN către expeditorul rândului (@gazpet.ro), CC office@gazpet.ro, cu adresa
// instituției, subiectul și textul gata scrise + PDF-ul APROBAT atașat. Expeditorul le copiază într-un mail NOU și îl trimite el.
// Platforma NU trimite nimic în afara firmei. Fluxul (logică pură, testată în vitest) e în ../_shared/redariCorespMail.mjs → pregatesteMailIntern;
// aici doar autentificarea, clientul utilizatorului, descărcarea din Storage și apelul Resend.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7)
// (a) Conținut EXTERN citit: câmpurile scrise de editori pe rând (destinatar, destinatar_email, mail_subiect, mail_text) și PDF-ul urcat de ei.
//     Toate se tratează ca DATE: textul e escapat HTML (escHtml), adresa instituției apare doar ca text (fără mailto / linkuri generate de noi),
//     subiectul intern e un singur rând (CR/LF scoase), PDF-ul se atașează ca octeți (verificat %PDF-). Nu se urmează nimic din conținut.
// (b) Ce scrie / trimite: UN mail prin Resend, DOAR către expeditor_email (@gazpet.ro, verificat în BD — CHECK + RPC — și aici) cu CC office@gazpet.ro,
//     reply_to = adresa utilizatorului doar dacă e @gazpet.ro, altfel office@; un rând de intenție în red_corespondenta_mailuri. Nu atinge bani / drepturi.
// (c) Identitate: JWT-ul UTILIZATORULUI pe tot drumul (RPC-uri SECURITY DEFINER cu auth.uid() din JWT; descărcarea din bucket-ul `redari` prin
//     politica red_storage_sel = admin/editor). FĂRĂ service_role. Secrete: RESEND_API_KEY (+ SUPABASE_URL / SUPABASE_ANON_KEY standard).
// (d) Cine o poate porni: verify_jwt=false (validăm noi tokenul cu getUser — cheia anon e și ea un JWT valid, PR #318), apoi POARTA DE ROL în BD:
//     fn_red_coresp_mail_incepe cere fn_red_nivel() IN ('admin','editor'); viewer / fără Redări / anon → 403.
// (e) Confirmare umană: aprobarea owner-ului pe rând (legată de fișierul exact + eTag; orice schimbare a câmpurilor mailului o face să cadă) + click-ul
//     unui admin/editor care confirmă versiunea și fișierul VĂZUTE (RPC le compară sub lock). Intenție nouă: 60 s / rând (orice stare), 20 / zi / proiect.
//     Resend: Idempotency-Key = intentie_id (aceeași la „Reia aceeași încercare”). Un rezultat necunoscut nu se retrimite automat.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { pregatesteMailIntern } from '../_shared/redariCorespMail.mjs';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'doar POST' }, 405);
  try {
    const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) return json({ error: 'RESEND_API_KEY lipsă' }, 500);

    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const uc = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ud } = await uc.auth.getUser(jwt);
    if (!ud?.user) return json({ error: 'token invalid' }, 401);   // cheia anon nu are utilizator → 401

    let body: any = {}; try { body = await req.json(); } catch { /* gol */ }
    const rez = await pregatesteMailIntern(
      { corespondenta_id: body?.corespondenta_id, intentie_id: body?.intentie_id, versiune: body?.versiune, fisier_id: body?.fisier_id, userEmail: ud.user.email },
      {
        rpc: (nume: string, arg: Record<string, unknown>) => uc.rpc(nume, arg),
        // descărcarea cu JWT-ul UTILIZATORULUI (politica storage red_storage_sel); antetul ETag al aceluiași răspuns se compară cu cel aprobat
        descarca: (path: string) => fetch(`${SUPA_URL}/storage/v1/object/authenticated/redari/${path.split('/').map(encodeURIComponent).join('/')}`,
          { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON }, signal: AbortSignal.timeout(30000) }),
        trimiteResend: (corp: unknown, cheie: string) => fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': cheie },
          body: JSON.stringify(corp),
        }),
        b64,
      });
    return json(rez.body, rez.status);
  } catch (_e) {
    // neașteptat: fără scriere în BD din catch (anti-bug worker killed); intenția rămâne in_curs = neconfirmată în UI
    return json({ error: 'eroare internă la pregătirea mailului; verifică inboxul înainte să reiei', necunoscut: true }, 500);
  }
});
