// ofertare-seap-veghe - sta cu ochii pe anunturile SEAP ale licitatiilor in lucru,
// pana la termenul de depunere, si trage in platforma orice document APARUT NOU.
//
// De ce: autoritatile publica raspunsurile la clarificari si erratele ca fisiere
// atasate. API-ul public SEAP nu are endpoint de clarificari (toate variantele dau
// 404), dar lista de documente a anuntului se re-interogheaza - diferenta fata de
// ce avem in BD sunt exact documentele noi.
//
// Cum le aduce, in doua trepte:
// 1. ofertare-seap-import (edge) - rapid, dar bugetul lui se consuma pe octetii de
//    arhiva parcursi, deci la arhivele uriase nu ajunge la documentele de la coada;
// 2. /api/seap-import (Vercel) - parcurge arhiva integral, fara plafonul acela.
// Ce tot nu intra ramane pozitie de inventar cu marcajul /neincarcat/, ca sa nu fie
// raportat ca nou la fiecare rulare. Omul afla din clopotel.
//
// v2 (10.09.2026): documentele care arata a RASPUNS LA CLARIFICARI sau a ERATA se
// separa de restul si genereaza o notificare distincta, de tip warning, cu numele lor
// in titlu. Inainte, un raspuns al autoritatii care schimba o cerinta eliminatorie
// ajungea la om ca "3 documente noi", adica lipit de o plansa si de un formular.
//
// v3 (11.09.2026): doua schimbari cerute de Razvan.
// 1. MAIL, nu doar clopotel: raspunsurile si eratele pleaca prin Resend catre office@
//    si catre responsabilul licitatiei (ofertare_licitatii.responsabil_id - cel din
//    rubrica "pe scurt"). Documentele obisnuite NU genereaza mail: daca ar suna la
//    fiecare plansa, nimeni n-ar mai citi mailul cand chiar conteaza.
// 2. Secretul iese din sursa. Se verifica prin fn_verifica_secret contra Vault, care
//    accepta si valoarea precedenta cat tine fereastra de rotire. Tot aici a disparut
//    si valoarea de rezerva a lui SEAP_IMPORT_SECRET: scrisa in cod, ea facea ca
//    verificarea sa treaca chiar si cand variabila de mediu lipsea.
//
// notifications.modul are CHECK pe lista fixa de module - pentru ofertare valoarea
// corecta e 'Comercial'. Cu 'ofertare' insertul pica silentios.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SEAP = 'https://e-licitatie.ro/api-pub';
const IMPORT_SECRET = Deno.env.get('SEAP_IMPORT_SECRET') || '';
const VERCEL_IMPORT = 'https://pontaj-pro-sooty.vercel.app/api/seap-import';
const OFFICE = 'office@gazpet.ro';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-veghe-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SEAP_HDR: Record<string, string> = {
  'Referer': 'https://e-licitatie.ro/pub',
  'Origin': 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
const RUNDE_IMPORT = 4;
const estePlaceholder = (d: any) => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/');
// Numele sub care autoritatile publica raspunsurile si modificarile documentatiei.
const esteRaspuns = (n: string) => /clarific|r[aă]spuns|erat[aă]|errata|completare|modificare|addendum|notificare/i.test(n);
const esc = (s: string) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supa = createClient(SUPA_URL, SERVICE);

  const antet = req.headers.get('x-veghe-secret');
  let cuSecret = false;
  if (antet) {
    const { data: ok } = await supa.rpc('fn_verifica_secret', { p_nume: 'SEAP_VEGHE_SECRET', p_secret: antet });
    cuSecret = ok === true;
  }
  if (!cuSecret) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);
    if (jwt !== SERVICE) {
      const anon = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { data: u } = await anon.auth.getUser(jwt);
      if (!u?.user) return json({ error: 'unauthorized' }, 401);
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }

  // Licitatiile de vegheat: au anunt SEAP legat si termenul nu a trecut inca
  // (o zi de toleranta - documentele apar uneori chiar in ziua depunerii)
  let q = supa.from('ofertare_licitatii')
    .select('id, nr_anunt, obiect, c_notice_id, sys_notice_type_id, termen_depunere, created_by, responsabil_id, status')
    .not('c_notice_id', 'is', null);
  if (body?.licitatie_id) q = q.eq('id', Number(body.licitatie_id));
  else q = q.gte('termen_depunere', new Date(Date.now() - 86400000).toISOString());
  const { data: licitatii, error: eLic } = await q;
  if (eLic) return json({ error: eLic.message }, 500);

  const raport: any[] = [];

  for (const lic of licitatii || []) {
    const qs = `initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`;
    const laSeap: string[] = [];
    try {
      const r = await fetch(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?${qs}`, { headers: SEAP_HDR });
      if (!r.ok) { raport.push({ licitatie: lic.nr_anunt, eroare: `SEAP HTTP ${r.status}` }); continue; }
      const d = await r.json();
      for (const cheie of ['dfNoticeDocs', 'duaeDocs', 'decisionDocs', 'contractingStrategyDocs', 'exAnteDocs']) {
        for (const f of (d?.[cheie] || [])) {
          const n = String(f?.noticeDocumentName || '').replace(/\.p7s$/i, '');
          if (n) laSeap.push(n);
        }
      }
    } catch (e) {
      raport.push({ licitatie: lic.nr_anunt, eroare: String((e as Error)?.message || e) });
      continue;
    }

    const { data: aveam } = await supa.from('ofertare_documente_atribuire')
      .select('id, nume_original, fisier_path').eq('licitatie_id', lic.id);
    const cunoscute = new Set((aveam || []).map((d: any) => d.nume_original));
    const noi = [...new Set(laSeap)].filter((n) => !cunoscute.has(n));

    if (!noi.length) { raport.push({ licitatie: lic.nr_anunt, noi: 0 }); continue; }

    // treapta 1: importul rapid din Supabase
    for (let i = 0; i < RUNDE_IMPORT; i++) {
      try {
        const r = await fetch(`${SUPA_URL}/functions/v1/ofertare-seap-import`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ licitatie_id: lic.id }),
        });
        const rez = await r.json().catch(() => ({}));
        if (!rez?.continua) break;
      } catch (_) { break; }
    }

    // treapta 2: ce a ramas trece prin Vercel, unde arhiva se parcurge integral
    const { data: dupaEdge } = await supa.from('ofertare_documente_atribuire')
      .select('nume_original, fisier_path').eq('licitatie_id', lic.id);
    const urcateAcum = new Set((dupaEdge || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => d.nume_original));
    let vercel: string | null = null;
    if (noi.some((n) => !urcateAcum.has(n))) {
      if (!IMPORT_SECRET) {
        vercel = 'sarit: lipseste SEAP_IMPORT_SECRET din variabilele de mediu';
      } else {
        try {
          const r = await fetch(VERCEL_IMPORT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-import-secret': IMPORT_SECRET },
            body: JSON.stringify({ licitatie_id: lic.id }),
          });
          const rez = await r.json().catch(() => ({}));
          vercel = r.ok ? `adaugate ${rez.adaugate ?? 0}, completate ${rez.completate ?? 0}` : `HTTP ${r.status} ${rez.error || ''}`;
        } catch (e) {
          vercel = 'inaccesibil: ' + String((e as Error)?.message || e);
        }
      }
    }

    // Adevarul se citeste din BD: care dintre documentele NOI au acum fisier real
    const { data: acum } = await supa.from('ofertare_documente_atribuire')
      .select('nume_original, fisier_path').eq('licitatie_id', lic.id);
    const urcate = new Set((acum || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => d.nume_original));
    const toateCunoscute = new Set((acum || []).map((d: any) => d.nume_original));
    const auIntrat = noi.filter((n) => urcate.has(n));
    const ramase = noi.filter((n) => !urcate.has(n));

    for (const n of ramase) {
      if (toateCunoscute.has(n)) continue;
      const safe = n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
      await supa.from('ofertare_documente_atribuire').insert({
        licitatie_id: lic.id,
        fisier_path: `${lic.id}/atribuire/neincarcat/${safe}`,
        nume_original: n, tip: 'alta', status_procesare: 'ignorat', sursa: 'seap',
        eroare: 'Aparut nou in SEAP, dar nu a putut fi adus automat - urca-l din "Urca fisiere".',
      });
    }

    const { data: owners } = await supa.from('profiles').select('id').eq('is_owner', true);
    const catre = new Set<string>((owners || []).map((o: any) => o.id));
    if (lic.created_by) catre.add(lic.created_by);
    if (lic.responsabil_id) catre.add(lic.responsabil_id);
    const nume = (l: string[]) => l.slice(0, 4).join(', ') + (l.length > 4 ? ` (+${l.length - 4})` : '');

    // v2: raspunsurile autoritatii se anunta separat, ca sa nu se piarda printre planse.
    const raspunsuri = noi.filter(esteRaspuns);
    const restul = noi.filter((n) => !esteRaspuns(n));

    const mesaje: { type: string; title: string; message: string }[] = [];
    if (raspunsuri.length) {
      const parti = [`Autoritatea a publicat ${raspunsuri.length} document(e) care par raspuns la clarificari sau modificare a documentatiei: ${nume(raspunsuri)}.`];
      const intrate = raspunsuri.filter((n) => urcate.has(n));
      if (intrate.length < raspunsuri.length) parti.push('ATENTIE: nu toate au putut fi aduse automat - urca-le din "Urca fisiere".');
      parti.push('Citeste-le si treci intrebarea si raspunsul in Clarificari. Daca raspunsul schimba o cerinta, cerinta din registru trebuie actualizata.');
      mesaje.push({
        type: 'warning',
        title: `SEAP: RASPUNS de la autoritate la ${lic.nr_anunt}`,
        message: parti.join(' '),
      });
    }
    if (restul.length) {
      const parti: string[] = [];
      const intrate = restul.filter((n) => urcate.has(n));
      const lipsa = restul.filter((n) => !urcate.has(n));
      if (intrate.length) parti.push(`Aduse in platforma: ${nume(intrate)}.`);
      if (lipsa.length) parti.push(`Raman de urcat manual: ${nume(lipsa)}.`);
      mesaje.push({
        type: 'info',
        title: `SEAP: ${restul.length} document(e) nou(i) la ${lic.nr_anunt}`,
        message: parti.join(' '),
      });
    }

    for (const pid of catre) {
      for (const m of mesaje) {
        const { error: eN } = await supa.from('notifications').insert({
          profile_id: pid, type: m.type, modul: 'Comercial',
          title: m.title, message: m.message, link_to: '/ofertare',
        });
        if (eN) raport.push({ licitatie: lic.nr_anunt, notificare_esuata: eN.message });
      }
    }

    // v3: MAIL doar pentru raspunsuri si erate. Restul ramane in clopotel.
    let mail: string | null = null;
    if (raspunsuri.length) {
      const key = Deno.env.get('RESEND_API_KEY');
      if (!key) {
        mail = 'sarit: lipseste RESEND_API_KEY';
      } else {
        const to = [OFFICE];
        if (lic.responsabil_id) {
          const { data: resp } = await supa.from('profiles').select('email, name').eq('id', lic.responsabil_id).maybeSingle();
          if (resp?.email && !to.includes(resp.email)) to.push(resp.email);
        }
        const neaduse = raspunsuri.filter((n) => !urcate.has(n));
        const html = `
          <p>Autoritatea a publicat <b>${raspunsuri.length} document(e)</b> care par raspuns la clarificari sau modificare a documentatiei.</p>
          <p><b>Licitatie:</b> ${esc(lic.nr_anunt || '')} — ${esc(lic.obiect || '')}<br>
             <b>Termen depunere:</b> ${lic.termen_depunere ? new Date(lic.termen_depunere).toLocaleString('ro-RO') : '—'}</p>
          <p><b>Documente:</b></p><ul>${raspunsuri.map((n) => `<li>${esc(n)}${urcate.has(n) ? '' : ' <i>(nu a putut fi adus automat — urca-l din „Urca fisiere”)</i>'}</li>`).join('')}</ul>
          ${neaduse.length ? '<p><b>Atentie:</b> nu toate au intrat automat in platforma.</p>' : '<p>Toate au fost aduse automat in platforma.</p>'}
          <p>Citeste-le si treci intrebarea si raspunsul in <b>Clarificari</b>. Daca raspunsul schimba o cerinta, actualizeaza cerinta din registru.</p>
          <p><a href="https://pontaj-pro-sooty.vercel.app/ofertare">Deschide modulul Ofertare</a></p>`;
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'PontajPRO <rapoarte@gazpet.ro>', to,
              subject: `SEAP — raspuns de la autoritate: ${lic.nr_anunt}`, html,
            }),
          });
          mail = r.ok ? `trimis catre ${to.join(', ')}` : `esuat HTTP ${r.status}`;
        } catch (e) {
          mail = 'esuat: ' + String((e as Error)?.message || e);
        }
      }
    }

    raport.push({ licitatie: lic.nr_anunt, noi: noi.length, raspunsuri: raspunsuri.length, aduse: auIntrat.length, ramase: ramase.length, vercel, mail, nume: noi.slice(0, 10) });
  }

  return json({ verificate: (licitatii || []).length, raport });
});
