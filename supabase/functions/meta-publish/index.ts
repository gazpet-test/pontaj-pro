// meta-publish — modulul Marketing: ciorne AI + publicare pe pagina Facebook Gazpet Instal.
//
// Actiuni (POST JSON {actiune, ...}):
//   status                      → ce vede tokenul: pagina, urmaritori, Instagram legat
//   genereaza {postare_id}      → text propus de AI din rapoartele zilnice + descrierea publica a santierului
//   publica  {postare_id}       → urca pozele (published=false) + post pe /feed cu attached_media; salveaza id + permalink
//   publica_programate          → (doar cron, antet x-marketing-secret din Vault) publica postarile aprobate cu programat_la <= now
//   analiza                     → statistici pe postarile publicate (reach/reactii/comentarii/distribuiri) + agregare zi/ora
//
// Autentificare: JWT-ul userului (verify_jwt). Pentru `publica` userul trebuie sa fie owner sau in
// marketing_aprobatori, iar postarea in status 'aprobata'. Tokenul Meta vine din Vault prin RPC
// marketing_meta_token() (doar service_role). Erorile de business se scriu in postare (status 'eroare'),
// nu se arunca (regula edge fn: throw in try + update in catch = worker killed).
import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v22.0';
const BUCKET = 'rapoarte-zilnice';
const MODEL = 'claude-sonnet-5';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `Ești responsabilul de comunicare al Gazpet Instal SRL (Ploiești), firmă de construcții conducte de gaze:
rețele de distribuție PEHD, conducte de transport oțel pentru Transgaz, stații, probe de presiune.
Scrii postări pentru pagina de Facebook a firmei, în română, ton cald și profesionist, fără emfază.
REGULI STRICTE:
- 60–110 cuvinte, 2–3 paragrafe scurte, apoi 3–5 hashtag-uri pe ultimul rând.
- NU pomeni valori de contract, prețuri, clauze, penalități, termene contractuale, nume de persoane, plăcuțe de mașini.
- FĂRĂ CIFRE (decizie Răzvan 05.09.2026): nu scrie metri, bucăți, număr de branșamente, procente, date; vorbește la general („s-a montat conductă pe un nou tronson”, „au ajuns materialele pentru branșamente”). Excepție: doar dacă INDICAȚIILE autorului cer explicit o cifră.
- Beneficiarul se menționează doar dacă e în descrierea publică a șantierului; altfel spui „beneficiarul”.
- MESAJ DE FOND (Răzvan 05.09.2026): când lucrarea e pentru operatori naționali (Transgaz, Conpet, Romgaz, Depogaz) sau obiective de înmagazinare/tratare gaze, leagă natural lucrarea de contribuția la independența și securitatea energetică a României și la un viitor mai bun pentru comunități (ex. „lucrăm zi de zi pentru a oferi României independență energetică”). O singură frază de acest fel per postare, formulată diferit de fiecare dată, fără patos.
- Fără „suntem mândri”, fără superlative; concret dar general: ce fel de lucrări s-au făcut, de ce contează pentru localitate.
- Încheie cu o propoziție scurtă despre echipă sau despre siguranță, fără a numi oameni.
- Ultimul rând înainte de hashtag-uri, ÎNTOTDEAUNA: un îndemn scurt și natural să urmărească pagina, variat de la o postare la alta (ex. „Urmărește pagina Gazpet Instal pentru noutăți de pe șantiere.”).
Răspunde DOAR cu textul postării, fără titlu, fără ghilimele.`;

// Textul pentru distribuirea de pe profilul vechi „Gazpet Instal” (profil personal, se retrage treptat → pagina nouă)
const PROMPT_DISTRIBUIRE = `Scrie în română un text de 25–45 de cuvinte care însoțește distribuirea unei postări de pe PAGINA oficială Gazpet Instal,
pusă de pe vechiul PROFIL personal „Gazpet Instal”. Scop: oamenii să dea „Urmărește” paginii noi; spune calm că acest profil se va retrage treptat
și că noutățile de pe șantiere vor apărea doar pe pagină. Ton prietenos, fără cifre, fără emoji-uri multe (max 1). Variază formularea. Răspunde DOAR cu textul.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db = createClient(SUPA_URL, SERVICE);
  let body: any = {};
  try { body = await req.json(); } catch { /* gol */ }
  const actiune = String(body.actiune || '');

  // Mod CRON (verify_jwt=false la gateway): antetul x-marketing-secret trebuie sa fie egal cu secretul din Vault.
  // Altfel e nevoie de JWT-ul unui user (ca inainte). Secretul nu sta nici in repo, nici in cron.job.
  const secretAntet = req.headers.get('x-marketing-secret') || '';
  let cronMode = false;
  if (secretAntet) {
    const { data: cs } = await db.rpc('marketing_cron_secret');
    cronMode = !!cs && cs === secretAntet;
    if (!cronMode) return json({ error: 'secret cron invalid' }, 401);
  }
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let user: { id: string } | null = null;
  if (!cronMode) {
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const userClient = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data } = await userClient.auth.getUser();
    user = data?.user ?? null;
    if (!user) return json({ error: 'token invalid' }, 401);
  }

  const { data: prof } = user ? await db.from('profiles').select('id, name, is_owner').eq('id', user.id).maybeSingle() : { data: null };
  const { data: apr } = user ? await db.from('marketing_aprobatori').select('profile_id').eq('profile_id', user.id).maybeSingle() : { data: null };
  const poateAproba = cronMode || !!prof?.is_owner || !!apr;

  const { data: tok, error: et } = await db.rpc('marketing_meta_token');
  if (et || !tok) return json({ error: 'META_PAGE_TOKEN lipsă în Vault' }, 500);
  const TOKEN = tok as string;

  // `tok` = tokenul cu care se face apelul: implicit system user; pentru actiuni PE pagina (poze
  // nepublicate, feed) Meta cere PAGE access token — eroarea (#200) „Unpublished posts must be
  // posted to a page as the page itself" (05.09.2026). Page token-ul vine din me/accounts.
  const graph = async (path: string, init?: RequestInit & { form?: Record<string, string>; tok?: string }) => {
    const url = `${GRAPH}/${path}`;
    const t = init?.tok || TOKEN;
    let r: Response;
    if (init?.form) {
      const fd = new URLSearchParams({ ...init.form, access_token: t });
      r = await fetch(url, { method: 'POST', body: fd });
    } else {
      const sep = url.includes('?') ? '&' : '?';
      r = await fetch(`${url}${sep}access_token=${encodeURIComponent(t)}`, init);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j?.error?.message || `Graph ${r.status}`);
    return j;
  };

  // Pagina administrata (prima din /me/accounts); tokenul e system user → tasks include CREATE_CONTENT
  const pagina = async () => {
    const acc = await graph('me/accounts?fields=id,name,link,followers_count,instagram_business_account{id,username},tasks,access_token');
    const p = acc?.data?.[0];
    if (!p) throw new Error('tokenul nu vede nicio pagină');
    return p;
  };

  try {
    // ── STATUS ──
    if (actiune === 'status') {
      const { access_token: _t, ...p } = await pagina();
      return json({ ok: true, pagina: p, poateAproba, user: prof?.name });
    }

    // ── PUBLICA_PROGRAMATE (cron) ── postarile aprobate cu ora programata trecuta; erorile raman pe postare
    if (actiune === 'publica_programate') {
      if (!cronMode && !prof?.is_owner) return json({ error: 'doar cron/owner' }, 403);
      const { data: scad } = await db.from('marketing_postari').select('*').eq('status', 'aprobata')
        .not('programat_la', 'is', null).lte('programat_la', new Date().toISOString()).order('programat_la');
      const rez: any[] = [];
      for (const ps of scad || []) {
        // blocare anti-dublu: scoatem programarea inainte de a incepe (un tick paralel n-o mai vede)
        const { data: lock } = await db.from('marketing_postari').update({ programat_la: null }).eq('id', ps.id).eq('status', 'aprobata').not('programat_la', 'is', null).select('id');
        if (!lock?.length) continue;
        try {
          const { data: mks } = await db.from('marketing_santiere').select('postabil').eq('site_id', ps.site_id).maybeSingle();
          if (!mks?.postabil) throw new Error('șantierul nu mai e postabil');
          if (!(ps.text_postare || '').trim()) throw new Error('textul e gol');
          const r = await publicaPost(ps, ps.programat_de || ps.aprobat_de);
          rez.push({ id: ps.id, ok: true, ...r });
        } catch (e) {
          const msg = (e as Error)?.message || String(e);
          await db.from('marketing_postari').update({ status: 'eroare', eroare: `programată: ${msg}`, updated_at: new Date().toISOString() }).eq('id', ps.id);
          rez.push({ id: ps.id, ok: false, eroare: msg });
        }
      }
      return json({ ok: true, publicate: rez });
    }

    // ── ANALIZA ── reimprospateaza statisticile postarilor publicate (max 50) + agregare zi/ora (Europe/Bucharest)
    if (actiune === 'analiza') {
      const p = await pagina();
      const PT = p.access_token as string;
      const { data: pubs } = await db.from('marketing_postari').select('id, fb_post_id, publicat_la, site_id, fb_reach, fb_impresii, fb_reactii, fb_comentarii, fb_distribuiri, fb_stats_la')
        .eq('status', 'publicata').not('fb_post_id', 'is', null).order('publicat_la', { ascending: false }).limit(50);
      const out: any[] = [];
      for (const ps of pubs || []) {
        let st = { fb_reach: ps.fb_reach, fb_impresii: ps.fb_impresii, fb_reactii: ps.fb_reactii, fb_comentarii: ps.fb_comentarii, fb_distribuiri: ps.fb_distribuiri };
        const vechi = !ps.fb_stats_la || (Date.now() - new Date(ps.fb_stats_la).getTime()) > 6 * 3600e3;
        if (vechi || body.forta) {
          try {
            const f = await graph(`${ps.fb_post_id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares,insights.metric(post_impressions,post_impressions_unique)`, { tok: PT });
            const ins: Record<string, number> = {};
            for (const m of f.insights?.data || []) ins[m.name] = Number(m.values?.[0]?.value ?? 0);
            st = {
              fb_reach: ins.post_impressions_unique ?? null, fb_impresii: ins.post_impressions ?? null,
              fb_reactii: f.reactions?.summary?.total_count ?? 0, fb_comentarii: f.comments?.summary?.total_count ?? 0, fb_distribuiri: f.shares?.count ?? 0,
            };
            await db.from('marketing_postari').update({ ...st, fb_stats_la: new Date().toISOString() }).eq('id', ps.id);
          } catch { /* pastram ce aveam */ }
        }
        out.push({ id: ps.id, site_id: ps.site_id, publicat_la: ps.publicat_la, ...st });
      }
      // agregare: zi a saptamanii (0=Luni) x interval orar, dupa ora Romaniei
      const agg: Record<string, { n: number; reach: number; engaj: number }> = {};
      for (const o of out) {
        const d = new Date(o.publicat_la);
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(d);
        const wd = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.find(x => x.type === 'weekday')?.value || 'Mon');
        const h = Number(parts.find(x => x.type === 'hour')?.value || 0) % 24;
        const slot = h < 7 ? 'noapte' : h < 11 ? 'dimineata' : h < 15 ? 'pranz' : h < 19 ? 'dupa-amiaza' : 'seara';
        const k = `${wd}|${slot}`;
        agg[k] ||= { n: 0, reach: 0, engaj: 0 };
        agg[k].n++; agg[k].reach += o.fb_reach || 0; agg[k].engaj += (o.fb_reactii || 0) + (o.fb_comentarii || 0) + (o.fb_distribuiri || 0);
      }
      return json({ ok: true, postari: out, agregare: agg, urmaritori: p.followers_count ?? null });
    }

    if (!body.postare_id) return json({ error: 'postare_id lipsă' }, 400);
    const { data: post } = await db.from('marketing_postari').select('*').eq('id', body.postare_id).maybeSingle();
    if (!post) return json({ error: 'postarea nu există' }, 404);
    const { data: site } = await db.from('sites').select('id, name, beneficiar_principal').eq('id', post.site_id).maybeSingle();
    const { data: mk } = await db.from('marketing_santiere').select('*').eq('site_id', post.site_id).maybeSingle();

    // ── GENEREAZA (AI) ──
    if (actiune === 'genereaza') {
      const KEY = Deno.env.get('ANTHROPIC_API_KEY');
      if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500);
      const { data: rap } = await db.from('rapoarte_zilnice').select('data, lucrari_efectuate, plan_maine, subcontractori')
        .in('id', (post.raport_ids || []).length ? post.raport_ids : [-1]).order('data');
      const lucrari = (rap || []).map(r => `— ${r.data}: ${(r.lucrari_efectuate || '').trim() || '(fără text, doar poze)'}`).join('\n');
      const userMsg = `ȘANTIER: ${site?.name || '?'}
DESCRIERE PUBLICĂ (ce avem voie să spunem): ${mk?.descriere_publica || '(nu e completată — rămâi general: „rețea/conductă de gaze”)'}
RESTRICȚII: ${mk?.restrictii || '—'}
HASHTAG-URI PREFERATE: ${mk?.hashtaguri || '#GazpetInstal #gazenaturale #constructii'}
NUMĂR POZE ATAȘATE: ${(post.poze || []).length}
INDICAȚII DE LA AUTOR: ${body.indicatii || '—'}
RAPOARTE ZILNICE FOLOSITE:
${lucrari || '(niciun raport selectat — scrie despre progresul general al lucrării)'}`;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 600, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMsg }] }),
      });
      const j = await r.json();
      if (!r.ok) return json({ error: j?.error?.message || 'eroare AI' }, 500);
      const text = (j.content || []).map((c: any) => c.text || '').join('').trim();
      let textDistribuire = post.text_distribuire || '';
      try {
        const r2 = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, max_tokens: 200, system: PROMPT_DISTRIBUIRE, messages: [{ role: 'user', content: `Postarea distribuită:\n${text}` }] }),
        });
        const j2 = await r2.json();
        if (r2.ok) textDistribuire = (j2.content || []).map((c: any) => c.text || '').join('').trim() || textDistribuire;
      } catch { /* textul de distribuire e opțional */ }
      // Link-ul paginii noi la finalul textului de distribuire (Răzvan 05.09.2026)
      try { const pg = await pagina(); if (pg.link && textDistribuire && !textDistribuire.includes(pg.link)) textDistribuire = `${textDistribuire}\n${pg.link}`; } catch { /* fără link */ }
      await db.from('marketing_postari').update({ text_postare: text, text_distribuire: textDistribuire, ai_generat: true, updated_at: new Date().toISOString() }).eq('id', post.id);
      return json({ ok: true, text, text_distribuire: textDistribuire });
    }

    // ── PUBLICA ──
    if (actiune === 'publica') {
      if (!poateAproba) return json({ error: 'doar aprobatorii pot publica' }, 403);
      if (post.status !== 'aprobata') return json({ error: `postarea e „${post.status}”, trebuie aprobată întâi` }, 400);
      if (!(post.text_postare || '').trim()) return json({ error: 'textul e gol' }, 400);
      if (!mk?.postabil) return json({ error: 'șantierul nu e marcat postabil' }, 400);
      const r = await publicaPost(post, user?.id ?? post.aprobat_de);
      return json({ ok: true, ...r });
    }

    return json({ error: `acțiune necunoscută: ${actiune}` }, 400);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    if (body.postare_id && actiune === 'publica') {
      await db.from('marketing_postari').update({ status: 'eroare', eroare: msg, programat_la: null, updated_at: new Date().toISOString() }).eq('id', body.postare_id);
    }
    return json({ error: msg }, 500);
  }

  // Publicarea propriu-zisa (folosita de `publica` manual si de `publica_programate` din cron)
  async function publicaPost(post: any, deCine: string | null) {
    const p = await pagina();
    const PT = p.access_token as string;  // page token
    if (!PT) throw new Error('Meta nu a returnat tokenul paginii (me/accounts.access_token)');
    const photoIds: string[] = [];
    for (const path of (post.poze || []).slice(0, 10)) {
      const { data: su, error: es } = await db.storage.from(BUCKET).createSignedUrl(path, 900);
      if (es || !su?.signedUrl) throw new Error(`poza ${path}: ${es?.message || 'fără URL'}`);
      const ph = await graph(`${p.id}/photos`, { form: { url: su.signedUrl, published: 'false' }, tok: PT });
      photoIds.push(ph.id);
    }
    const form: Record<string, string> = { message: post.text_postare };
    photoIds.forEach((id, i) => { form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const fp = await graph(`${p.id}/feed`, { form, tok: PT });
    const postId: string = fp.id;
    let permalink = '';
    try { const pl = await graph(`${postId}?fields=permalink_url`, { tok: PT }); permalink = pl.permalink_url || ''; } catch { /* nu blocam */ }
    await db.from('marketing_postari').update({
      status: 'publicata', fb_post_id: postId, fb_permalink: permalink, fb_photo_ids: photoIds, programat_la: null,
      publicat_de: deCine, publicat_la: new Date().toISOString(), eroare: null, updated_at: new Date().toISOString(),
    }).eq('id', post.id);
    return { fb_post_id: postId, permalink, poze: photoIds.length };
  }

});
