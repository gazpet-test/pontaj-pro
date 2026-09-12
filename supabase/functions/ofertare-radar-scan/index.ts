// Radar licitatii SEAP — scan zilnic anunturi de participare + gap-analysis AI
// Auth: header x-radar-secret (cron) SAU Authorization Bearer JWT valid (UI)
// v7 (03.09): noDia/deHtml robuste la campuri ne-string din SEAP
// v8 (03.09): regula echivalentei in scoring — gazele = "retele de fluide"/complexitate superioara (cerut de Razvan pe cazul Domnesti)
//
// ADUSA IN REPO la 12.09.2026. Rula neversionata, ca 105 din cele 129 de functii.
// SINGURA modificare fata de sursa deployata: secretul x-radar-secret NU mai e scris
// literal in cod. Era `const RADAR_SECRET = '...'` — exact valoarea care a stat luni de
// zile in repo-ul public — iar functia are verify_jwt=false, deci oricine citise repo-ul
// o putea chema: scan SEAP, extragere de detalii si apeluri AI platite, la discretie.
// Acelasi tipar era si in ofertare-verificare-finala (reparat pe 11.09).
// Verificarea trece acum prin Vault (fn_verifica_radar_secret), care accepta si valoarea
// precedenta cat tine fereastra de rotire, ca sa nu pice cron-urile toate deodata.
// SECRETUL RAMANE DE ROTIT — scoaterea literalului nu e revocare (task #51).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SEAP = 'https://e-licitatie.ro/api-pub';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SEAP_HDR: Record<string, string> = {
  'Content-Type': 'application/json',
  'Referer': 'https://e-licitatie.ro/pub/notices/contract-notices/list/1/0',
  'Origin': 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
const CPV_OK = ['45231', '45232', '45333', '65210', '65200'];
const KEYWORDS = [
  'gaze naturale', 'gaz metan', 'distributie gaze', 'transport gaze', 'retea de gaze', 'retele de gaze',
  'conducta de gaz', 'conducte de gaz', 'bransament gaz', 'bransamente gaz', 'statie de reglare', 'srm ',
  'alimentare cu apa', 'retea de apa', 'retele de apa', 'canalizare', 'aductiune', 'apa uzata', 'gospodarie de apa',
];
const EXCLUDE = [
  ' lea ', 'lea 0,4', '0,4 kv', '0.4 kv', '20 kv', '110 kv', 'linii electrice', 'linie electrica',
  'retele electrice', 'retea electrica', 'electricitate', 'iluminat public', 'post de transformare',
  'posturi de transformare', 'anvelopat', 'fibra optica', '45231400', '45231600', '45231500',
];

const noDia = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const deHtml = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Secretul NU sta in sursa: repo-ul e public. Verificare prin RPC contra Vault.
async function secretOk(req: Request, supa: any): Promise<boolean> {
  const s = req.headers.get('x-radar-secret');
  if (!s) return false;
  const { data, error } = await supa.rpc('fn_verifica_radar_secret', { p_secret: s });
  return !error && data === true;
}

async function seapFetch(url: string, body?: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: SEAP_HDR,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) return { err: `HTTP ${res.status}` };
    return { data: await res.json() };
  } catch (e) {
    return { err: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function esteRelevant(titlu: string, cpv: string): boolean {
  const t = ' ' + noDia(titlu) + ' ' + noDia(cpv) + ' ';
  if (KEYWORDS.some((k) => t.includes(k))) return true;
  if (EXCLUDE.some((k) => t.includes(k))) return false;
  if (t.includes('bransament')) return true;
  return CPV_OK.some((p) => String(cpv ?? '').trim().startsWith(p));
}

function detectSeg(autoritate: string, titlu: string, cpv: string): string {
  const t = noDia(String(autoritate ?? '') + ' ' + String(titlu ?? '') + ' ' + String(cpv ?? ''));
  if (t.includes('transgaz')) return 'transgaz';
  if (t.includes('romgaz')) return 'romgaz';
  if (t.includes('conpet')) return 'conpet';
  if (/gaze|gaz metan|bransament/.test(t)) return 'distributie';
  return 'altele';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (!(await secretOk(req, supa))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: u } = await anon.auth.getUser(jwt);
    if (!u?.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let zile = 2, maxDetalii = 8, cuScor = true;
  try {
    const b = await req.json();
    if (b?.zile) zile = Math.min(Number(b.zile) || 2, 14);
    if (b?.maxDetalii != null) maxDetalii = Math.min(Number(b.maxDetalii) || 8, 15);
    if (b?.scor === false) cuScor = false;
  } catch (_) { /* body gol e ok */ }

  const { data: logRow } = await supa.from('ofertare_radar_scan_log').insert({}).select('id').single();
  const logId = logRow?.id;
  const rezumat = { anunturi_vazute: 0, anunturi_noi: 0, relevante_noi: 0, scorate: 0, erori: [] as string[] };

  try {
    const start = new Date(Date.now() - zile * 86400000).toISOString();
    const toate: any[] = [];
    for (let pg = 0; pg < 10; pg++) {
      const { data, err } = await seapFetch(`${SEAP}/NoticeCommon/GetCNoticeList/`, {
        sysNoticeTypeIds: [], sortProperties: [], pageSize: 100, pageIndex: pg, startPublicationDate: start,
      });
      if (err) { rezumat.erori.push(`lista pg${pg}: ${err}`); break; }
      const items = data?.items || [];
      toate.push(...items);
      if (toate.length >= (data?.total || 0) || items.length === 0) break;
    }
    rezumat.anunturi_vazute = toate.length;

    const byNo = new Map<string, any>();
    for (const it of toate) if (it?.noticeNo && !byNo.has(it.noticeNo)) byNo.set(it.noticeNo, it);
    const numere = [...byNo.keys()];
    const existente = new Set<string>();
    for (let i = 0; i < numere.length; i += 200) {
      const { data: ex } = await supa.from('ofertare_radar').select('nr_seap').in('nr_seap', numere.slice(i, i + 200));
      (ex || []).forEach((r: any) => existente.add(r.nr_seap));
    }

    const noi = [...byNo.values()].filter((it) => !existente.has(it.noticeNo)).map((it) => ({
      nr_seap: it.noticeNo,
      c_notice_id: it.cNoticeId,
      notice_id: it.noticeId,
      sys_notice_type_id: it.sysNoticeTypeId,
      titlu: it.contractTitle,
      autoritate: it.contractingAuthorityNameAndFN,
      tip_contract: it.sysAcquisitionContractType?.text || null,
      tip_procedura: it.sysProcedureType?.text || null,
      cpv: it.cpvCodeAndName,
      valoare_lei: it.estimatedValueRon ?? null,
      data_publicare: it.noticeStateDate,
      termen_depunere: it.minTenderReceiptDeadline,
      are_loturi: !!it.hasLots,
      stare_procedura: it.sysProcedureState?.text || null,
      link: `https://e-licitatie.ro/pub/notices/c-notice/v2/view/${it.cNoticeId}`,
      relevant: esteRelevant(it.contractTitle, it.cpvCodeAndName),
      segment: detectSeg(it.contractingAuthorityNameAndFN, it.contractTitle, it.cpvCodeAndName),
    }));
    for (let i = 0; i < noi.length; i += 100) {
      const { error } = await supa.from('ofertare_radar').insert(noi.slice(i, i + 100));
      if (error) rezumat.erori.push(`insert: ${error.message}`);
    }
    rezumat.anunturi_noi = noi.length;
    rezumat.relevante_noi = noi.filter((n) => n.relevant).length;

    const { data: deExtras } = await supa.from('ofertare_radar')
      .select('id, nr_seap, c_notice_id, sys_notice_type_id, titlu, autoritate, cpv, valoare_lei, termen_depunere, tip_procedura, are_loturi, scor_potrivire')
      .eq('relevant', true).eq('detalii_extrase', false).eq('status', 'nou')
      .order('termen_depunere', { ascending: true }).limit(maxDetalii);

    for (const r of deExtras || []) {
      const qs = `initNoticeId=${r.c_notice_id}&sysNoticeTypeId=${r.sys_notice_type_id}`;
      const [s3, s4, fl] = [
        await seapFetch(`${SEAP}/NoticeCommon/GetSection3View/?${qs}`),
        await seapFetch(`${SEAP}/NoticeCommon/GetSection4View/?${qs}`),
        await seapFetch(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?${qs}`),
      ];
      const parti: string[] = [];
      if (s3.data) {
        const d = s3.data;
        if (d.tpCriteriaQAStandardMin) parti.push('CERINTE CAPACITATE TEHNICA:\n' + deHtml(d.tpCriteriaQAStandardMin));
        if (d.efCriteriaMin) parti.push('CERINTE ECONOMICO-FINANCIARE:\n' + deHtml(d.efCriteriaMin));
        if (d.mandatoryProfesionalQualif) parti.push('CALIFICARE PROFESIONALA:\n' + deHtml(d.mandatoryProfesionalQualif));
        if (d.depositsAndWarranties) parti.push('GARANTII:\n' + deHtml(d.depositsAndWarranties));
      } else if (s3.err) rezumat.erori.push(`${r.nr_seap} s3: ${s3.err}`);
      if (s4.data) {
        const d4 = s4.data;
        if (d4.sysCriteria?.text) parti.push('CRITERIU ATRIBUIRE: ' + deHtml(d4.sysCriteria.text));
        if (Array.isArray(d4.criteriaDefinitionList) && d4.criteriaDefinitionList.length) {
          parti.push('FACTORI: ' + d4.criteriaDefinitionList.map((c: any) => `${deHtml(c?.name)} ${deHtml(c?.weight)}%`).join('; '));
        }
      }
      const rawDocs = fl.data ? [...(fl.data.dfNoticeDocs || []), ...(fl.data.duaeDocs || [])] : [];
      const docs = rawDocs.length
        ? rawDocs.slice(0, 60).map((f: any) => ({ nume: f.noticeDocumentName || null, cod: f.noticeDocumentCode || null, url: f.noticeDocumentUrl || null }))
        : null;
      // detalii_extrase = true doar daca CHIAR am extras ceva. Altfel randul ramane pe
      // false si se reincearca la scanul urmator: filtrul urmatoarei scanari e
      // `detalii_extrase = false`, deci un true pus dupa un fetch esuat scotea anuntul
      // definitiv din flux (vazut in productie — vezi comentariul de la reincercari).
      const areContinut = parti.length > 0 || (docs?.length || 0) > 0;
      if (!areContinut) rezumat.erori.push(`${r.nr_seap}: fara continut extras — ramane de reincercat`);
      await supa.from('ofertare_radar').update({
        sectiune3_text: parti.join('\n\n').slice(0, 30000) || null,
        documente: docs,
        detalii_extrase: areContinut,
        actualizat_la: new Date().toISOString(),
      }).eq('id', r.id);
      r._sectiune = parti.join('\n\n');
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const deScorat = (deExtras || []).filter((r: any) => r.scor_potrivire == null);

    // REINCERCARI — anunturi ramase fara scor din rulari trecute.
    // Verificat in date la 11.09.2026: 12 anunturi relevante aveau detalii_extrase = true
    // si scor_potrivire NULL, deci nu mai intrau niciodata in scoring (filtrul de mai sus
    // cere detalii_extrase = false), iar alerte-mail trimite doar la scor >= 50. Rezultatul:
    // anunturi deschise, de pana la 58 mil. lei, invizibile in fluxul automat.
    // Cauza dominanta: raspunsul AI se taia la max_tokens, JSON-ul ramanea nedeschis si
    // parserul intorcea null (motiv_scor pastra textul brut — de acolo s-a vazut).
    // Se reiau doar cele inca deschise si maxim 5 pe rulare, ca sa ramana cost marginit.
    if (cuScor) {
      const { data: ramase } = await supa.from('ofertare_radar')
        .select('id, nr_seap, titlu, autoritate, cpv, valoare_lei, termen_depunere, tip_procedura, are_loturi, scor_potrivire, sectiune3_text')
        .eq('relevant', true).eq('detalii_extrase', true).is('scor_potrivire', null)
        .gte('termen_depunere', new Date().toISOString())
        .order('termen_depunere', { ascending: true }).limit(5);
      const deja = new Set((deScorat || []).map((r: any) => r.id));
      for (const r of (ramase || [])) {
        if (deja.has(r.id)) continue;
        (r as any)._sectiune = r.sectiune3_text || '';
        deScorat.push(r as any);
      }
    }
    if (cuScor && apiKey && deScorat.length) {
      const { data: exp } = await supa.from('ofertare_experienta')
        .select('denumire, valoare_lei, tip_pv').eq('activ', true)
        .order('valoare_lei', { ascending: false }).limit(8);
      const expTxt = (exp || []).map((e: any) => `- ${e.denumire} (${Math.round((e.valoare_lei || 0) / 1000)} mii lei, ${e.tip_pv || ''})`).join('\n');
      const profil = `PROFIL GAZPET INSTAL SRL (Ploiesti, ~130 angajati):\n` +
        `- Executa conducte de gaze naturale: TRANSPORT (lucrari la Transgaz, otel, pana la 63 bar) si DISTRIBUTIE (PE + OL, Delgaz/Distrigaz/primarii, inclusiv PNRR/AFM "sisteme inteligente").\n` +
        `- Bransamente, SRM/SRMP, subtraversari (inclusiv CF/drumuri prin foraj orizontal dirijat cu partener autorizat AFER), probe, PIF.\n` +
        `- Autorizatii: ANRE montaj+exploatare gaze, sudori autorizati ISCIR PE+OL, RTE gaze, ISO 9001/14001/45001. Laborator NDT prin parteneri.\n` +
        `- Poate lucrari de apa/canalizare ca profil secundar (retele edilitare).\n` +
        `- Zona de confort valorica: 1 - 40 mil. lei/contract. Poate intra in asocieri (inclusiv ca lider). Istoric: Prahova, Sibiu, Bacau, Neamt, Vrancea, Mures, Buzau, Dambovita.\n` +
        `EXPERIENTA SIMILARA (top, receptionate):\n${expTxt}`;
      for (const r of deScorat) {
        const anunt = `ANUNT SEAP ${r.nr_seap}\nTitlu: ${r.titlu}\nAutoritate: ${r.autoritate}\nCPV: ${r.cpv}\nValoare estimata: ${r.valoare_lei} lei\nTermen depunere: ${r.termen_depunere}\nProcedura: ${r.tip_procedura}${r.are_loturi ? ' (pe loturi)' : ''}\n\n${(r._sectiune || '(sectiunea III indisponibila — scoreaza doar pe metadate)').slice(0, 9000)}`;
        try {
          const ai = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1600,
              system: 'Esti analistul de licitatii al unui constructor roman de conducte de gaze naturale. Evaluezi cat de potrivit e un anunt SEAP pentru firma. REGULA CRITICA la experienta similara: citeste INTAI definitia exacta a "lucrarilor similare" din cerinte. Multe fise de date accepta explicit "retele de fluide", "retele tehnice edilitare", "conducte" generic sau "lucrari similare din punct de vedere al complexitatii" — conductele de gaze naturale (transport pana la 63 bar / distributie) SE INCADREAZA in aceste definitii si sunt superioare tehnologic retelelor de apa/canalizare, deci firma SE CALIFICA: NU penaliza lipsa referintelor de apa in acest caz. Penalizeaza doar cand definitia cere strict si limitativ apa/canalizare. Daca definitia nu apare in textul primit, scrie la lipsuri "de verificat in fisa de date definitia exacta a experientei similare — gazele pot fi acceptate ca retele de fluide/complexitate" in loc sa presupui ca nu se accepta. Raspunzi DOAR cu JSON valid: {"scor": 0-100, "motiv": "1-2 fraze in romana", "lipsuri": ["cerinte pe care firma probabil NU le acopera"]}. Ghid scor: 90-100 = exact profilul (conducte gaze, valoare 1-40 mil., cerinte acoperite de experienta); 70-89 = potrivit, cu efort de calificare rezonabil (inclusiv apa/canal cu definitie larga a similaritatii); 40-69 = adiacent (cerinte grele sau valoare nepotrivita); sub 40 = nepotrivit. La "lipsuri" fii concret, dar maxim 4 intrari, fiecare sub 140 de caractere — raspunsul TREBUIE sa incapa intreg, altfel JSON-ul se taie si scorul se pierde.',
              messages: [{ role: 'user', content: profil + '\n\n---\n\n' + anunt }],
            }),
          });
          const aj = await ai.json();
          const txt = aj?.content?.[0]?.text || '';
          if (!txt) rezumat.erori.push(`${r.nr_seap} ai: raspuns gol${aj?.error?.message ? ' — ' + aj.error.message : ''}`);
          let scor = null, motiv = txt.slice(0, 500), lipsuri = null;
          try {
            const m = txt.match(/\{[\s\S]*\}/);
            if (m) { const p = JSON.parse(m[0]); scor = p.scor ?? null; motiv = p.motiv || motiv; lipsuri = p.lipsuri || null; }
          } catch (_) { /* pastram textul brut in motiv */ }
          if (scor == null && txt) {
            // Salvare din raspuns taiat: cand JSON-ul nu s-a inchis (max_tokens), scorul si
            // motivul sunt oricum primele campuri scrise, deci se pot citi direct.
            const mS = txt.match(/"scor"\s*:\s*(\d{1,3})/);
            if (mS) {
              const n = Number(mS[1]);
              if (n >= 0 && n <= 100) scor = n;
              const mM = txt.match(/"motiv"\s*:\s*"((?:[^"\\]|\\.)*)"/);
              if (mM) { try { motiv = JSON.parse('"' + mM[1] + '"').slice(0, 500); } catch (_) { /* ramane brut */ } }
              rezumat.erori.push(`${r.nr_seap} ai: JSON incomplet (${aj?.stop_reason || '?'}) — scor recuperat din text`);
            }
          }
          if (scor == null) rezumat.erori.push(`${r.nr_seap} ai: fara scor in raspuns (stop=${aj?.stop_reason || '?'})`);
          await supa.from('ofertare_radar').update({ scor_potrivire: scor, motiv_scor: motiv, lipsuri, actualizat_la: new Date().toISOString() }).eq('id', r.id);
          if (scor != null) rezumat.scorate++;
        } catch (e) {
          rezumat.erori.push(`${r.nr_seap} ai: ${String(e?.message || e)}`);
        }
      }
    }
  } catch (e) {
    rezumat.erori.push('fatal: ' + String(e?.message || e));
  }

  if (logId) {
    await supa.from('ofertare_radar_scan_log').update({
      terminat_la: new Date().toISOString(),
      anunturi_vazute: rezumat.anunturi_vazute,
      anunturi_noi: rezumat.anunturi_noi,
      relevante_noi: rezumat.relevante_noi,
      scorate: rezumat.scorate,
      eroare: rezumat.erori.length ? rezumat.erori.join(' | ').slice(0, 2000) : null,
    }).eq('id', logId);
  }
  return new Response(JSON.stringify(rezumat), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
