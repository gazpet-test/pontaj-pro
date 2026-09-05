// meta-publish — modulul Marketing: ciorne AI + publicare pe pagina Facebook Gazpet Instal.
//
// Actiuni (POST JSON {actiune, ...}):
//   status                      → ce vede tokenul: pagina, urmaritori, Instagram legat
//   genereaza {postare_id}      → text propus de AI din rapoartele zilnice + descrierea publica a santierului
//   publica  {postare_id}       → urca pozele (published=false) + post pe /feed cu attached_media; salveaza id + permalink
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
- Fără „suntem mândri”, fără superlative; concret dar general: ce fel de lucrări s-au făcut, de ce contează pentru localitate.
- Încheie cu o propoziție scurtă despre echipă sau despre siguranță, fără a numi oameni.
Răspunde DOAR cu textul postării, fără titlu, fără ghilimele.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'fără autentificare' }, 401);

  const userClient = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'token invalid' }, 401);
  const db = createClient(SUPA_URL, SERVICE);

  const { data: prof } = await db.from('profiles').select('id, name, is_owner').eq('id', user.id).maybeSingle();
  const { data: apr } = await db.from('marketing_aprobatori').select('profile_id').eq('profile_id', user.id).maybeSingle();
  const poateAproba = !!prof?.is_owner || !!apr;

  let body: any = {};
  try { body = await req.json(); } catch { /* gol */ }
  const actiune = String(body.actiune || '');

  const { data: tok, error: et } = await db.rpc('marketing_meta_token');
  if (et || !tok) return json({ error: 'META_PAGE_TOKEN lipsă în Vault' }, 500);
  const TOKEN = tok as string;

  const graph = async (path: string, init?: RequestInit & { form?: Record<string, string> }) => {
    const url = `${GRAPH}/${path}`;
    let r: Response;
    if (init?.form) {
      const fd = new URLSearchParams({ ...init.form, access_token: TOKEN });
      r = await fetch(url, { method: 'POST', body: fd });
    } else {
      const sep = url.includes('?') ? '&' : '?';
      r = await fetch(`${url}${sep}access_token=${encodeURIComponent(TOKEN)}`, init);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j?.error?.message || `Graph ${r.status}`);
    return j;
  };

  // Pagina administrata (prima din /me/accounts); tokenul e system user → tasks include CREATE_CONTENT
  const pagina = async () => {
    const acc = await graph('me/accounts?fields=id,name,followers_count,instagram_business_account{id,username},tasks');
    const p = acc?.data?.[0];
    if (!p) throw new Error('tokenul nu vede nicio pagină');
    return p;
  };

  try {
    // ── STATUS ──
    if (actiune === 'status') {
      const p = await pagina();
      return json({ ok: true, pagina: p, poateAproba, user: prof?.name });
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
      await db.from('marketing_postari').update({ text_postare: text, ai_generat: true, updated_at: new Date().toISOString() }).eq('id', post.id);
      return json({ ok: true, text });
    }

    // ── PUBLICA ──
    if (actiune === 'publica') {
      if (!poateAproba) return json({ error: 'doar aprobatorii pot publica' }, 403);
      if (post.status !== 'aprobata') return json({ error: `postarea e „${post.status}”, trebuie aprobată întâi` }, 400);
      if (!(post.text_postare || '').trim()) return json({ error: 'textul e gol' }, 400);
      if (!mk?.postabil) return json({ error: 'șantierul nu e marcat postabil' }, 400);
      const p = await pagina();
      const photoIds: string[] = [];
      for (const path of (post.poze || []).slice(0, 10)) {
        const { data: su, error: es } = await db.storage.from(BUCKET).createSignedUrl(path, 900);
        if (es || !su?.signedUrl) throw new Error(`poza ${path}: ${es?.message || 'fără URL'}`);
        const ph = await graph(`${p.id}/photos`, { form: { url: su.signedUrl, published: 'false' } });
        photoIds.push(ph.id);
      }
      let postId: string;
      if (photoIds.length) {
        const form: Record<string, string> = { message: post.text_postare };
        photoIds.forEach((id, i) => { form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
        const fp = await graph(`${p.id}/feed`, { form });
        postId = fp.id;
      } else {
        const fp = await graph(`${p.id}/feed`, { form: { message: post.text_postare } });
        postId = fp.id;
      }
      let permalink = '';
      try { const pl = await graph(`${postId}?fields=permalink_url`); permalink = pl.permalink_url || ''; } catch { /* nu blocam */ }
      await db.from('marketing_postari').update({
        status: 'publicata', fb_post_id: postId, fb_permalink: permalink, fb_photo_ids: photoIds,
        publicat_de: user.id, publicat_la: new Date().toISOString(), eroare: null, updated_at: new Date().toISOString(),
      }).eq('id', post.id);
      return json({ ok: true, fb_post_id: postId, permalink, poze: photoIds.length });
    }

    return json({ error: `acțiune necunoscută: ${actiune}` }, 400);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    if (body.postare_id && actiune === 'publica') {
      await db.from('marketing_postari').update({ status: 'eroare', eroare: msg, updated_at: new Date().toISOString() }).eq('id', body.postare_id);
    }
    return json({ error: msg }, 500);
  }
});
