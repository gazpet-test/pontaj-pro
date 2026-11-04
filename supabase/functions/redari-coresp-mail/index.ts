// redari-coresp-mail — Redări → Corespondență: „📧 Pregătește mailul” (deciziile lui Răzvan 04.11.2026, migrarea 20261130f).
// POST { corespondenta_id } → un mail INTERN către expeditorul rândului (@gazpet.ro), CC office@gazpet.ro, cu adresa instituției, subiectul și
// textul gata scrise + PDF-ul APROBAT atașat. Expeditorul le copiază într-un mail NOU și îl trimite el. Platforma NU trimite nimic în afara firmei.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7)
// (a) Conținut EXTERN citit: câmpurile scrise de editori pe rând (destinatar, destinatar_email, mail_subiect, mail_text) și PDF-ul urcat de ei.
//     Toate se tratează ca DATE: textul e escapat HTML (escHtml), adresa instituției apare doar ca text (fără mailto / linkuri generate de noi),
//     subiectul intern e un singur rând (CR/LF scoase), PDF-ul se atașează ca octeți (nu se interpretează). Nu se urmează nimic din conținut.
// (b) Ce scrie / trimite: UN mail prin Resend, DOAR către expeditor_email (@gazpet.ro, verificat în BD — CHECK + RPC — și aici) cu CC office@gazpet.ro;
//     un rând în red_corespondenta_mailuri (in_curs la început, închis trimis / eroare / necunoscut). Nu atinge bani, drepturi sau alte tabele.
// (c) Identitate: JWT-ul UTILIZATORULUI pe tot drumul (RPC-uri SECURITY DEFINER cu auth.uid() din JWT; descărcarea din bucket-ul `redari` prin
//     politica red_storage_sel = admin/editor). FĂRĂ service_role. Secrete: RESEND_API_KEY (+ SUPABASE_URL / SUPABASE_ANON_KEY standard).
// (d) Cine o poate porni: verify_jwt=false (validăm noi tokenul cu getUser — cheia anon e și ea un JWT valid, PR #318), apoi POARTA DE ROL în BD:
//     fn_red_coresp_mail_incepe cere fn_red_nivel() IN ('admin','editor'); viewer / fără Redări / anon → 403.
// (e) Confirmare umană: aprobarea owner-ului pe rând (stare `aprobat`, legată de fișierul exact + eTag; orice schimbare a câmpurilor mailului
//     face aprobarea să cadă) + click-ul unui admin/editor. Fereastră 60 s pe rând, plafon 20 încercări / zi / proiect (în RPC, sub blocare).
//
// Erorile de business se scriu în urmă (fn_red_coresp_mail_inchide) și se întorc ca răspuns — NU throw (anti-bug: throw în try + update în catch).
// Resend primește Idempotency-Key = id-ul încercării (L04). Timeout / 5xx / rețea după trimitere = NECUNOSCUT (L05): rândul rămâne „necunoscut”,
// nu se reîncearcă automat; utilizatorul verifică inboxul înainte de un nou click.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { construiesteMailIntern, eEmailGazpet, normEtag, ePdf, OFFICE } from '../_shared/redariCorespMail.mjs';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PDF = 25 * 1024 * 1024;   // = file_size_limit al bucket-ului redari și CHECK-ul din red_corespondenta_fisiere
const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const numeAtasament = (nume: unknown, path: string) => {
  const baza = String(nume || path.split('/').pop() || 'document.pdf').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 150).trim() || 'document.pdf';
  return /\.pdf$/i.test(baza) ? baza : `${baza}.pdf`;
};
// mesajele RPC-ului („redari: …”) → text pentru UI; erorile neașteptate nu se trimit brut (L10)
const mesajRpc = (e: { message?: string } | null) => {
  const m = String(e?.message || '');
  return /^redari: /.test(m) ? m.replace(/^redari: /, '').slice(0, 300) : 'pregătirea mailului a eșuat (eroare internă)';
};

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
    const cid = String(body?.corespondenta_id || '');
    if (!RX_UUID.test(cid)) return json({ error: 'corespondenta_id lipsă sau invalid' }, 400);

    // 1. Poarta + încercarea (un singur pas atomic în BD, cu JWT-ul utilizatorului): drept, aprobare, fișier, eTag, 60 s, plafon → rând in_curs
    const { data: p, error: eInc } = await uc.rpc('fn_red_coresp_mail_incepe', { p_corespondenta_id: cid });
    if (eInc) {
      const st = eInc.code === '42501' ? 403 : eInc.code === 'P0002' ? 404 : eInc.code === '23514' ? 409 : 500;
      return json({ error: mesajRpc(eInc) }, st);
    }
    const mailId = String(p?.mail_id || '');
    // închiderea încercării proprii; întoarce mesajul de eroare (sau null) — fără throw
    const inchide = async (stare: 'trimis' | 'eroare' | 'necunoscut', resendId: string | null, eroare: string | null) => {
      const { error } = await uc.rpc('fn_red_coresp_mail_inchide', { p_mail_id: mailId, p_stare: stare, p_resend_id: resendId, p_eroare: eroare ? eroare.slice(0, 500) : null });
      return error ? mesajRpc(error) : null;
    };
    const esec = async (motiv: string, status = 409) => { const eI = await inchide('eroare', null, motiv); return json({ error: motiv, mail_id: mailId, avertisment: eI }, status); };

    // 2. Destinatarul mailului intern: obligatoriu @gazpet.ro (a doua verificare, după CHECK + RPC)
    const catre = String(p?.expeditor_email || '').trim().toLowerCase();
    if (!eEmailGazpet(catre)) return await esec('expeditorul nu are o adresă @gazpet.ro; nu se trimite nimic');
    const fis = p?.fisier || {};
    const path = String(fis.path || '');
    if (!path || !/\.pdf$/i.test(path)) return await esec('fișierul aprobat nu e PDF');

    // 3. PDF-ul aprobat, descărcat cu JWT-ul UTILIZATORULUI (politica storage red_storage_sel = admin/editor), cu eTag-ul din ACELAȘI răspuns
    //    comparat cu eTag-ul aprobat (RPC-ul l-a verificat deja în storage.objects; aici prindem o rescriere între RPC și descărcare).
    const url = `${SUPA_URL}/storage/v1/object/authenticated/redari/${path.split('/').map(encodeURIComponent).join('/')}`;
    let r: Response;
    try { r = await fetch(url, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON }, signal: AbortSignal.timeout(30000) }); }
    catch { return await esec('descărcarea PDF-ului aprobat a eșuat (rețea / timeout)', 502); }
    if (!r.ok) { await r.body?.cancel(); return await esec(`descărcarea PDF-ului aprobat a fost refuzată (${r.status})`, r.status === 404 ? 409 : 502); }
    const etagAntet = normEtag(r.headers.get('etag'));
    if (!etagAntet || etagAntet !== normEtag(fis.etag)) { await r.body?.cancel(); return await esec('PDF-ul din Storage nu mai are amprenta aprobată (eTag diferit sau lipsă); nu se trimite nimic'); }
    const lung = Number(r.headers.get('content-length'));
    if (Number.isFinite(lung) && lung > MAX_PDF) { await r.body?.cancel(); return await esec('PDF-ul depășește 25 MB'); }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PDF) return await esec('PDF-ul descărcat e gol sau depășește 25 MB');
    if (!ePdf(bytes)) return await esec('fișierul aprobat nu e un PDF valid');

    // 4. Mailul intern (modul partajat cu UI-ul / testele); câmpurile vin din BD (RPC), nu din cerere
    const m = construiesteMailIntern({
      cod: p.cod, proiectCod: p.proiect_cod, destinatar: p.destinatar, destinatarEmail: p.destinatar_email, mailSubiect: p.mail_subiect, mailText: p.mail_text,
      expeditorEmail: catre, fisierNume: numeAtasament(fis.nume_original, path), fisierEtag: fis.etag, aprobatLa: p.aprobat_la, aprobatDeNume: p.aprobat_de_nume,
      pregatitDeNume: p.pregatit_de_nume || ud.user.email,
    }) as any;
    if (m.erori) return await esec(m.erori.join(' '));
    if (m.catre !== catre || m.cc.some((e: string) => e !== OFFICE)) return await esec('destinatarii mailului intern nu sunt cei așteptați');

    // 5. Trimiterea (Resend), cu cheie de idempotență = încercarea
    let rr: Response;
    try {
      rr = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `redari-coresp-mail/${mailId}` },
        body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to: [m.catre], cc: m.cc.length ? m.cc : undefined, reply_to: ud.user.email || OFFICE,
          subject: m.subiect, html: m.html, text: m.text, attachments: [{ filename: numeAtasament(fis.nume_original, path), content: b64(bytes) }] }),
      });
    } catch {
      const eI = await inchide('necunoscut', null, 'Resend: rețea / timeout — nu se știe dacă mailul a plecat');
      return json({ error: 'Nu se știe dacă mailul a plecat (rețea / timeout). Verifică inboxul expeditorului înainte să apeși din nou.', necunoscut: true, mail_id: mailId, avertisment: eI }, 502);
    }
    const j: any = await rr.json().catch(() => ({}));
    if (rr.ok && j?.id) {
      const eI = await inchide('trimis', String(j.id), null);
      return json({ ok: true, mail_id: mailId, resend_id: j.id, catre: m.catre, cc: m.cc, avertisment: eI });
    }
    if (rr.ok || rr.status >= 500 || rr.status === 429 || rr.status === 409) {
      const eI = await inchide('necunoscut', null, `Resend ${rr.status}: rezultat neconfirmat`);
      return json({ error: `Nu se știe dacă mailul a plecat (Resend ${rr.status}). Verifică inboxul expeditorului înainte să apeși din nou.`, necunoscut: true, mail_id: mailId, avertisment: eI }, 502);
    }
    return await esec(`Resend a refuzat mailul (${rr.status}): ${String(j?.message || j?.name || '').slice(0, 200)}`, 502);
  } catch (_e) {
    // neașteptat: fără scriere în BD din catch (anti-bug worker killed); încercarea rămâne in_curs = neconfirmată în UI
    return json({ error: 'eroare internă la pregătirea mailului; verifică inboxul înainte să reîncerci', necunoscut: true }, 500);
  }
});
