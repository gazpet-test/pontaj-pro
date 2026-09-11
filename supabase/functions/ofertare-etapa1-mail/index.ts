// ofertare-etapa1-mail — „Etapa 1 gata” către echipa de ofertare + raport zilnic intern (Răzvan 07.09.2026, varianta C)
// Acțiuni (body.actiune):
//   etapa1        {licitatie_id}  auth JWT user  → mail Resend către echipa Ofertare: rezumat (documente, registru, acoperire, clarificări, termen)
//                                                  + SARCINI NOMINALE (goluri / dovezi roșii / certificate de reemis) către responsabil; salvat în ofertare_mailuri
//   previzualizare {licitatie_id} auth JWT user  → același HTML, fără trimitere
//   raport_zilnic  (cron 04:30 UTC, x-radar-secret) → pentru fiecare licitație activă: ce s-a mișcat ieri (documente, acoperiri, răspunsuri, clarificări)
//                                                  → ofertare_raport_zilnic (citit de Claude în rutina zilnică) + reminder mail echipei cu 5 zile înainte de depunere (o dată)
// Colegii primesc mail DOAR la Etapa 1 și la reminder; răspunsurile lor vin în platformă (ofertare_acoperire.raspuns_coleg, tichete), nu pe mail.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Secretul NU mai sta in sursa: repo-ul e public. Verificare prin RPC contra Vault; functia
// accepta si valoarea precedenta cat tine fereastra de rotire, ca sa nu pice cron-urile deodata.
async function secretOk(req: Request): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.rpc('fn_verifica_radar_secret', { p_secret: s })
  return !error && data === true
}


const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-radar-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const APP = 'https://pontaj-pro-sooty.vercel.app';
const OFFICE = 'office@gazpet.ro';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const fmtZi = (d?: string | null) => d ? new Date(d).toLocaleDateString('ro-RO') : '—';
const zileDeLa = (d?: string | null) => d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = Deno.env.get('RESEND_API_KEY');
  let body: any = {}; try { body = await req.json(); } catch { /* gol */ }
  const actiune = String(body.actiune || 'etapa1');

  // auth: cron cu secret sau utilizator cu JWT
  let userId: string | null = null; let meNume = 'Platforma Gazpet'; let meMail = OFFICE;
  if ((await secretOk(req))) { /* cron */ }
  else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: ud } = await uc.auth.getUser();
    if (!ud?.user) return json({ error: 'token invalid' }, 401);
    userId = ud.user.id;
    const { data: me } = await db.from('profiles').select('name, email').eq('id', userId).maybeSingle();
    meNume = me?.name || ud.user.email || meNume; meMail = me?.email || ud.user.email || OFFICE;
  }

  // echipa Ofertare = acces explicit la modul + ownerii
  const echipa = async () => {
    const { data: uma } = await db.from('user_module_access').select('profile_id').eq('module', 'ofertare');
    const ids = (uma || []).map((x: any) => x.profile_id).filter(Boolean);
    const { data: ps } = await db.from('profiles').select('id, name, email, is_owner').or(`is_owner.eq.true${ids.length ? `,id.in.(${ids.join(',')})` : ''}`);
    return (ps || []).filter((p: any) => p.email);
  };

  // starea completă a unei licitații (pentru Etapa 1 și pentru raportul zilnic)
  const stare = async (lid: number) => {
    const [{ data: l }, { data: docs }, { data: cer }, { data: cl }, { data: g }] = await Promise.all([
      db.from('ofertare_licitatii').select('id, nr_anunt, autoritate, obiect, termen_depunere, valoare_estimata, moneda, garantie_participare, responsabil_id, status, decizie_go').eq('id', lid).maybeSingle(),
      db.from('ofertare_documente_atribuire').select('id, nume_original, tip, status_procesare, pagini, eroare, created_at').eq('licitatie_id', lid),
      db.from('ofertare_cerinte').select('id, tip, text_cerinta, sursa_sectiune, confirmata_de, document_probant').eq('licitatie_id', lid).is('inlocuita_de', null),
      db.from('ofertare_clarificari').select('id, nr, status, origine, raspuns, citita_la, intrebare, updated_at').eq('licitatie_id', lid),
      db.from('ofertare_garantii').select('status, valoare, moneda').eq('licitatie_id', lid).neq('status', 'anulata').order('id', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!l) return null;
    const cIds = (cer || []).map((c: any) => c.id);
    const { data: ac } = cIds.length ? await db.from('ofertare_acoperire').select('cerinta_id, status, valabil_la_depunere, tichet_id, raspuns_coleg, raspuns_la, updated_at, doc_firma:documente_firma(tip, se_reemite, data_valabilitate)').in('cerinta_id', cIds) : { data: [] };
    const acMap: Record<number, any> = {}; (ac || []).forEach((a: any) => { acMap[a.cerinta_id] = a; });
    let resp: any = null;
    if (l.responsabil_id) { const { data } = await db.from('profiles').select('id, name, email').eq('id', l.responsabil_id).maybeSingle(); resp = data; }
    const pdf = (docs || []).filter((d: any) => /\.pdf$/i.test(d.nume_original || ''));
    const nr = (arr: any[], f: (x: any) => boolean) => arr.filter(f).length;
    const termen = l.termen_depunere; const zile = zileDeLa(termen);
    const elim = (cer || []).filter((c: any) => c.tip === 'eliminatorie');
    const sarcini: { tip: string; cerinta: any; a: any }[] = [];
    let neevaluate = 0;
    for (const c of cer || []) {
      const a = acMap[c.id];
      if (!a) { neevaluate++; continue; }   // fără rând de acoperire = încă nerulat „Propune acoperire”, nu sarcină pentru colegi
      if (a.status === 'gol') sarcini.push({ tip: 'gol', cerinta: c, a });
      else if (a.doc_firma?.se_reemite) { if (termen && (zile ?? 99) <= 10 && !(a.doc_firma.data_valabilitate && new Date(a.doc_firma.data_valabilitate) >= new Date(termen.slice(0, 10)))) sarcini.push({ tip: 'reemis', cerinta: c, a }); }
      else if (a.valabil_la_depunere === false) sarcini.push({ tip: 'rosu', cerinta: c, a });
    }
    return {
      l, resp, termen, zile, sarcini, neevaluate, garantie: g,
      docs: { total: (docs || []).length, pdf: pdf.length, procesate: nr(pdf, d => d.status_procesare === 'procesat'), in_lucru: nr(pdf, d => ['neprocesat', 'in_lucru'].includes(d.status_procesare)), erori: nr(pdf, d => d.status_procesare === 'eroare'),
        sparte: nr(docs || [], d => /spart .*în \d+ bucăți/i.test(d.eroare || '')), formulare: nr(docs || [], d => /\.(xml|docx?|xlsx?)$/i.test(d.nume_original || '')), pagini: (docs || []).reduce((s: number, d: any) => s + (d.pagini || 0), 0) },
      cerinte: { total: (cer || []).length, eliminatorii: elim.length, propunere: nr(cer || [], c => c.tip === 'propunere'), neconfirmate: nr(cer || [], c => !c.confirmata_de) },
      neevaluate_n: neevaluate,
      acoperire: { acoperite: nr(ac || [], a => a.status === 'acoperit'), partener: nr(ac || [], a => a.status === 'acoperit_partener'), goluri: sarcini.filter(s => s.tip === 'gol').length, rosii: sarcini.filter(s => s.tip === 'rosu').length, reemis: sarcini.filter(s => s.tip === 'reemis').length,
        elim_neacoperite: elim.filter((c: any) => !['acoperit', 'acoperit_partener'].includes(acMap[c.id]?.status)).length, raspunsuri: nr(ac || [], a => !!a.raspuns_coleg) },
      clarificari: { total: (cl || []).length, de_trimis: nr(cl || [], x => x.status === 'de_trimis'), trimise: nr(cl || [], x => x.status === 'trimisa'), raspunse: nr(cl || [], x => !!x.raspuns), manuale: nr(cl || [], x => x.origine === 'manual'), necitite: nr(cl || [], x => x.origine === 'manual' && !x.citita_la) },
      _docs: docs || [], _ac: ac || [], _cl: cl || [],
    };
  };

  const htmlEtapa1 = (s: any, echipaL: any[]) => {
    const { l, resp, docs, cerinte, acoperire, clarificari, sarcini, zile, garantie } = s;
    const td = (k: string, v: string) => `<tr><td style="padding:3px 12px 3px 0;color:#5a6b7b;white-space:nowrap">${k}</td><td>${v}</td></tr>`;
    const lista = (tip: string, titlu: string, culoare: string) => {
      const items = sarcini.filter((x: any) => x.tip === tip);
      if (!items.length) return '';
      const rest = items.length > 40 ? `<p style="color:#5a6b7b;font-size:13px">… și încă ${items.length - 40} în platformă.</p>` : '';
      return `<h3 style="margin:14px 0 4px;color:${culoare};font-size:14px">${titlu} (${items.length})</h3><ol style="margin:0;padding-left:20px">` +
        items.slice(0, 40).map((x: any) => `<li style="margin:3px 0"><span style="color:#5a6b7b">${esc(x.cerinta.sursa_sectiune || '')}${x.cerinta.tip === 'eliminatorie' ? ' · <b style="color:#c0392b">ELIMINATORIE</b>' : ''}</span><br>${esc(x.cerinta.text_cerinta)}${x.cerinta.document_probant ? `<br><i style="color:#5a6b7b">dovadă: ${esc(x.cerinta.document_probant)}</i>` : ''}${x.a?.doc_firma?.tip ? `<br><i style="color:#5a6b7b">document firmă: ${esc(x.a.doc_firma.tip)} (valabil până ${fmtZi(x.a.doc_firma.data_valabilitate)})</i>` : ''}</li>`).join('') + '</ol>' + rest;
    };
    const cine = resp ? `<b>${esc(resp.name)}</b>` : `<b style="color:#c0392b">— responsabil nesetat — (se alege din fișa licitației)</b>`;
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:820px">` +
      `<h2 style="margin:0 0 4px;color:#0b4f8a">📑 Etapa 1 încheiată — ${esc(l.nr_anunt)} · ${esc(l.autoritate)}</h2>` +
      `<p style="margin:0 0 12px;font-size:15px"><b>${esc(l.obiect)}</b></p>` +
      `<p style="margin:0 0 10px">Platforma a citit toată documentația de atribuire, a extras registrul de cerințe și a confruntat cerințele cu autorizațiile și documentele firmei. Mai jos e situația și <b>ce are fiecare de făcut</b>. Răspunsurile și dovezile se pun <b>în platformă</b> (fișa licitației → Cerințe & acoperire), nu pe mail.</p>` +
      `<table style="border-collapse:collapse;font-size:14px;margin-bottom:8px">` +
      td('Termen depunere', `<b>${fmtZi(s.termen)}</b>${zile != null ? ` · <b style="color:${zile <= 7 ? '#c0392b' : '#1a232c'}">${zile} zile</b>` : ''}`) +
      td('Responsabil licitație', cine) +
      td('Documentație', `${docs.pdf} PDF-uri, ${docs.procesate} citite (${docs.pagini} pagini)${docs.sparte ? `, ${docs.sparte} sparte în bucăți` : ''}${docs.formulare ? `, ${docs.formulare} formulare (DUAE/xml/docx — se completează la depunere)` : ''}${docs.erori ? `, <b style="color:#c0392b">${docs.erori} cu erori</b>` : ''}`) +
      td('Registru cerințe', `${cerinte.total} cerințe: <b>${cerinte.eliminatorii} eliminatorii</b>, ${cerinte.propunere} de propunere${cerinte.neconfirmate ? ` · <span style="color:#b7791f">${cerinte.neconfirmate} neconfirmate de om</span>` : ''}`) +
      td('Acoperire', `${acoperire.acoperite} acoperite, ${acoperire.partener} prin partener, <b style="color:${acoperire.goluri ? '#c0392b' : '#0b7a3b'}">${acoperire.goluri} goluri</b>, <b style="color:${acoperire.rosii ? '#c0392b' : '#0b7a3b'}">${acoperire.rosii} dovezi care expiră înainte de depunere</b>${acoperire.reemis ? `, <b style="color:#b7791f">${acoperire.reemis} certificate de reemis (30 zile)</b>` : ''}${acoperire.elim_neacoperite ? ` · <b style="color:#c0392b">eliminatorii neacoperite: ${acoperire.elim_neacoperite}</b>` : ''}${s.neevaluate ? ` · <span style="color:#5a6b7b">${s.neevaluate} neevaluate încă (se rulează „Propune acoperire”)</span>` : ''}`) +
      td('Clarificări', `${clarificari.total} (${clarificari.de_trimis} de trimis, ${clarificari.trimise} trimise, ${clarificari.raspunse} răspunse)`) +
      td('Garanție participare', `${esc(l.garantie_participare || '—')}${garantie ? ` · poliță: <b>${esc(garantie.status)}</b>` : ' · <span style="color:#b7791f">cerere de poliță nepornită</span>'}`) +
      `</table>` +
      (sarcini.length ? `<h2 style="margin:16px 0 4px;font-size:16px">✅ Sarcini — ${cine}</h2>` : `<p style="color:#0b7a3b"><b>Nu sunt goluri sau dovezi roșii.</b></p>`) +
      lista('gol', '🚫 Goluri — cerințe fără dovadă (de găsit documentul, partener sau clarificare)', '#c0392b') +
      lista('rosu', '🔴 Dovezi care expiră înainte de depunere — de reînnoit', '#c0392b') +
      lista('reemis', '🔄 Certificate de 30 zile — de cerut proaspete (constatator, atestare fiscală, cazier)', '#b7791f') +
      `<p style="margin:14px 0 4px"><a href="${APP}/ofertare" style="background:#0b4f8a;color:#fff;padding:9px 16px;border-radius:7px;text-decoration:none;font-weight:700">Deschide licitația în platformă</a></p>` +
      `<p style="color:#5a6b7b;font-size:12px;margin-top:14px">Trimis de ${esc(meNume)} din Gazpet ERP către: ${echipaL.map((p: any) => esc(p.name)).join(', ')}. Răspunsurile pe mail nu ajung în platformă.</p></div>`;
  };

  const trimite = async (to: string[], cc: string[], subject: string, html: string) => {
    if (!key) throw new Error('RESEND_API_KEY lipsă');
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'PontajPRO <rapoarte@gazpet.ro>', to, cc: cc.length ? cc : undefined, reply_to: meMail, subject, html }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j?.id || null;
  };

  try {
    if (actiune === 'etapa1' || actiune === 'previzualizare') {
      const lid = Number(body.licitatie_id); if (!lid) return json({ error: 'licitatie_id lipsă' }, 400);
      const s = await stare(lid); if (!s) return json({ error: 'licitația nu există' }, 404);
      const team = await echipa();
      const html = htmlEtapa1(s, team);
      if (actiune === 'previzualizare') return json({ ok: true, html, rezumat: { docs: s.docs, cerinte: s.cerinte, acoperire: s.acoperire, clarificari: s.clarificari, sarcini: s.sarcini.length, neevaluate: s.neevaluate, responsabil: s.resp?.name || null }, destinatari: team.map((p: any) => p.email) });
      // responsabilul în TO, restul echipei în CC
      const to = s.resp?.email ? [s.resp.email] : team.map((p: any) => p.email);
      const cc = team.map((p: any) => p.email).filter((e: string) => !to.includes(e));
      const subject = `📑 Etapa 1 gata — ${s.l.nr_anunt} ${s.l.autoritate}: ${s.sarcini.length} sarcini, depunere ${fmtZi(s.termen)}`;
      const id = await trimite(to, cc, subject, html);
      await db.from('ofertare_mailuri').insert({ licitatie_id: lid, tip: 'etapa1', destinatari: [...to, ...cc], subiect: subject, corp_html: html, trimis_de: userId, resend_id: id,
        rezumat: { docs: s.docs, cerinte: s.cerinte, acoperire: s.acoperire, clarificari: s.clarificari, sarcini: s.sarcini.length, neevaluate: s.neevaluate, responsabil: s.resp?.name || null } });
      return json({ ok: true, id, to, cc, sarcini: s.sarcini.length });
    }

    if (actiune === 'raport_zilnic') {
      const { data: active } = await db.from('ofertare_licitatii').select('id').not('status', 'in', '(castigata,pierduta,abandonata,ignorata)');
      const ieri = new Date(Date.now() - 86400000).toISOString();
      const team = await echipa();
      const out: any[] = [];
      for (const r of active || []) {
        const s = await stare(r.id); if (!s) continue;
        const noi = {
          documente_noi: s._docs.filter((d: any) => d.created_at >= ieri).length,
          acoperiri_modificate: s._ac.filter((a: any) => a.updated_at >= ieri).length,
          raspunsuri_colegi_noi: s._ac.filter((a: any) => a.raspuns_la && a.raspuns_la >= ieri).length,
          clarificari_raspunse: s._cl.filter((c: any) => c.raspuns && c.updated_at >= ieri).length,
        };
        const rez: any = { termen: s.termen, zile: s.zile, responsabil: s.resp?.name || null, docs: s.docs, cerinte: s.cerinte, acoperire: s.acoperire, neevaluate: s.neevaluate, clarificari: s.clarificari, garantie: s.garantie?.status || null, sarcini: s.sarcini.length, ieri: noi };
        const text = `${s.l.nr_anunt} ${s.l.autoritate} — termen ${fmtZi(s.termen)} (${s.zile ?? '—'} zile), responsabil ${s.resp?.name || 'NESETAT'}. Ieri: ${noi.documente_noi} documente noi, ${noi.acoperiri_modificate} acoperiri modificate, ${noi.raspunsuri_colegi_noi} răspunsuri colegi, ${noi.clarificari_raspunse} clarificări răspunse. Acum: ${s.docs.in_lucru} PDF neprocesate, ${s.docs.erori} erori, ${s.cerinte.neconfirmate} cerințe neconfirmate, ${s.neevaluate} neevaluate, ${s.acoperire.goluri} goluri, ${s.acoperire.rosii} roșii, ${s.acoperire.reemis} de reemis, elim. neacoperite ${s.acoperire.elim_neacoperite}, clarificări ${s.clarificari.de_trimis} de trimis / ${s.clarificari.necitite} necitite, garanție ${s.garantie?.status || 'nepornită'}.`;
        await db.from('ofertare_raport_zilnic').upsert({ data: new Date().toISOString().slice(0, 10), licitatie_id: r.id, rezumat: rez, text }, { onConflict: 'data,licitatie_id' });
        // reminder echipă cu 5 zile înainte de depunere — o singură dată
        let reminder = false;
        if (s.zile != null && s.zile <= 5 && s.zile >= 0 && ['go', 'in_lucru', 'analiza'].includes(s.l.status)) {
          const { data: deja } = await db.from('ofertare_mailuri').select('id').eq('licitatie_id', r.id).eq('tip', 'reminder_depunere').limit(1);
          if (!deja?.length && team.length) {
            const html = htmlEtapa1(s, team).replace('📑 Etapa 1 încheiată', `⏰ ${s.zile} zile până la depunere`);
            const to = s.resp?.email ? [s.resp.email] : team.map((p: any) => p.email);
            const cc = team.map((p: any) => p.email).filter((e: string) => !to.includes(e));
            const subject = `⏰ ${s.zile} zile până la depunere — ${s.l.nr_anunt} ${s.l.autoritate}: ${s.sarcini.length} sarcini deschise`;
            try { const id = await trimite(to, cc, subject, html); await db.from('ofertare_mailuri').insert({ licitatie_id: r.id, tip: 'reminder_depunere', destinatari: [...to, ...cc], subiect: subject, corp_html: html, resend_id: id, rezumat: rez }); reminder = true; } catch (e) { rez.reminder_eroare = (e as Error).message; }
          }
        }
        out.push({ licitatie_id: r.id, nr: s.l.nr_anunt, zile: s.zile, sarcini: s.sarcini.length, neevaluate: s.neevaluate, reminder });
      }
      return json({ ok: true, n: out.length, licitatii: out });
    }
    return json({ error: `acțiune necunoscută: ${actiune}` }, 400);
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 502);
  }
});
