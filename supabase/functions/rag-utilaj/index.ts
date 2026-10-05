// rag-utilaj v6 — 05.10.2026 (#17 faza 2: adus în repo de pe live v14; poarta din _shared/poartaRag.ts — secretul intern din Vault
//  prin x-intern-secret, rol pe ramura JWT; r2: cotele QR și AI rezervate atomic în BD — fn_rag_qr_rezerva / fn_rag_ask_rezerva). v5 (19.07.2026): ask_qr — acces public
//  pagina QR /q/:id, răspuns în ROMÂNĂ, 30/zi/utilaj + 200/zi global via rag_qr_log; v4: pdf-lib lazy.
// Actions: process_queue / process_pending (cron sau owner) / ask (owner sau modul logistica; ai=true doar editor/admin, 50/zi) / ask_qr (public, activ valid + cotă atomică)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { esteApelIntern } from '../_shared/poartaIntern.ts';
import { decideAcces, nivelMaxim, type NivelModul } from '../_shared/poartaRag.ts';

// Globalul runtime-ului Supabase Edge (Supabase.ai.Session) — nu are tipuri publicate pentru deno check.
// deno-lint-ignore no-explicit-any
declare const Supabase: any;

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BATCH_PAGES = 5;
const MAX_BATCHES_PER_RUN = 4;
const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let aiSession: unknown = null;
async function embed(text: string): Promise<number[]> {
  if (!aiSession) aiSession = new Supabase.ai.Session('gte-small');
  const result = await (aiSession as { run: (t: string, o: Record<string, boolean>) => Promise<number[]> })
    .run(text.slice(0, 1800), { mean_pool: true, normalize: true });
  return result as number[];
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    return String(o.message || o.error || o.msg || JSON.stringify(e)).slice(0, 500);
  }
  return String(e);
}

function slugKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function chunkText(t: string): string[] {
  const clean = t.replace(/\s+/g, ' ').trim();
  if (clean.length <= CHUNK_SIZE + 200) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    out.push(clean.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return out;
}

function b64(u8: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH) as unknown as number[]);
  return btoa(s);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function transcribeBatch(pdfB64: string, startPage: number, pageCount: number): Promise<Array<{ pagina: number; text: string }>> {
  const prompt = `Acesta este un fragment dintr-o carte tehnică de utilaj industrial (paginile ${startPage}–${startPage + pageCount - 1} din documentul original, numerotare absolută). Transcrie TOT textul lizibil de pe FIECARE pagină (fă OCR dacă e scanat), păstrând limba originală (germană/engleză/română). Include: valori tehnice, tabele (redate ca text simplu), avertismente, denumiri piese, coduri. Ignoră elementele pur grafice. Răspunde DOAR cu JSON valid, fără alt text: [{\"pagina\": <nr absolut începând de la ${startPage}>, \"text\": \"<textul paginii>\"}]. Pagină goală sau doar imagine → text \"\".`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
        { type: 'text', text: prompt },
      ] }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  let raw = (data.content?.find((b: { type: string }) => b.type === 'text')?.text || '').trim();
  raw = raw.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((e) => e && typeof e.pagina === 'number' && typeof e.text === 'string');
  } catch (_e) { /* fallback */ }
  return raw ? [{ pagina: startPage, text: raw }] : [];
}

// căutare + (opțional) răspuns AI — comun pt ask și ask_qr
// deno-lint-ignore no-explicit-any
async function searchAndAnswer(supabase: any, question: string, modelKey: string | null, withAi: boolean) {
  const qEmb = await embed(question);
  const { data: matches, error: mErr } = await supabase.rpc('match_carte_utilaj', {
    query_embedding: JSON.stringify(qEmb), match_count: 6, filter_model_key: modelKey,
  });
  if (mErr) throw mErr;
  if (!matches || matches.length === 0) return { answer: null, sources: [] };
  let answer: string | null = null;
  if (withAi) {
    const context = matches.map((m: { sursa: string; referinta: string | null; content: string }, i: number) => `[${i + 1}] ${m.sursa} ${m.referinta || ''}:\n${m.content}`).join('\n\n');
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 700,
        system: 'Ești mecanic-șef expert în utilaje industriale (compresoare, boostere). Răspunzi DOAR pe baza extraselor din cartea tehnică furnizate, cu citarea paginii (ex: conform pag. 12). Extrasele pot fi în germană/engleză — răspunde în ROMÂNĂ, tradu ce citezi. Dacă extrasele nu conțin răspunsul, spui clar. Concis, pe înțelesul unui mecanic pe teren.',
        messages: [{ role: 'user', content: `Extrase din cartea tehnică:\n\n${context}\n\nÎntrebare: ${question}` }],
      }),
    });
    const aiData = await aiRes.json();
    answer = aiData.content?.find((b: { type: string }) => b.type === 'text')?.text || null;
  }
  return {
    answer,
    sources: matches.map((m: { sursa: string; referinta: string | null; content: string; document_id: number; similarity: number }) => ({
      sursa: m.sursa, referinta: m.referinta, content: m.content, document_id: m.document_id, similarity: Math.round(m.similarity * 100) / 100,
    })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const action = body.action;

    // ═══ ask_qr — PUBLIC (pagina QR /q/:id, mecanici fără cont) ═══
    // Platforma a validat deja un JWT (anon e suficient). Auth real: activ valid + limită zilnică.
    if (action === 'ask_qr') {
      const activeId = Number(body.active_id);
      const question = String(body.question || '').trim().slice(0, 300);
      if (!activeId || !question) return json(400, { error: 'active_id și question necesare' });

      const { data: activ } = await supabase.from('logistica_active')
        .select('id, marca, model, vandut').eq('id', activeId).maybeSingle();
      if (!activ || activ.vandut) return json(404, { error: 'Utilaj inexistent' });

      // #17 F2 r2: cota (30/zi pe utilaj, 200/zi global, ziua RO) se rezervă ATOMIC în BD — peste limită nu se scrie nimic.
      const { data: logId, error: cotaErr } = await supabase.rpc('fn_rag_qr_rezerva', { p_active_id: activeId, p_question: question });
      if (cotaErr) return json(500, { error: 'Nu am putut verifica limita zilnică' });
      if (logId === null || logId === undefined) {
        return json(429, { error: 'Limita zilnică de întrebări a fost atinsă. Încearcă mâine sau întreabă biroul.' });
      }

      const modelKey = slugKey(`${activ.marca || ''} ${activ.model || ''}`) || `ACTIV-${activeId}`;
      const result = await searchAndAnswer(supabase, question, modelKey, true); // AI mereu — răspuns în română
      await supabase.from('rag_qr_log').update({ answered: result.sources.length > 0 }).eq('id', logId);
      return json(200, { success: true, ...result });
    }

    // r3 (Jakarinos): întrebarea se validează ÎNAINTE de poartă și de cota AI — o cerere invalidă nu consumă cotă.
    if (action === 'ask' && !String(body.question || '').trim()) return json(400, { error: 'question necesară' });

    // ═══ Poarta (#17 F2): cronul cu secretul din Vault, altfel JWT de utilizator + rol ═══
    const intern = await esteApelIntern(req, supabase);
    let user = false, isOwner = false, nivelLogistica: NivelModul = null, userId: string | null = null;
    if (!intern) {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } };
      if (u?.user) {
        user = true;
        userId = u.user.id;
        const [{ data: prof }, { data: acc }] = await Promise.all([
          supabase.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle(),
          supabase.from('user_module_access').select('access_level').eq('profile_id', u.user.id).eq('module', 'logistica'),
        ]);
        isOwner = prof?.is_owner === true;
        nivelLogistica = nivelMaxim((acc || []).map((r: { access_level: string | null }) => r.access_level));
      }
    }
    const cuAi = action === 'ask' && !!body.ai;
    const dec = decideAcces({ intern, user, isOwner, nivelLogistica, action: String(action || ''), ai: cuAi });
    if (!dec.ok) return json(dec.status, { error: dec.error });
    // Cota AI per utilizator (50/zi, atomic în BD) — și pentru owner, ca plasă de siguranță la cost.
    if (cuAi && userId) {
      const { data: liber, error: cotaErr } = await supabase.rpc('fn_rag_ask_rezerva', { p_profile_id: userId });
      if (cotaErr) return json(500, { error: 'Nu am putut verifica limita zilnică AI' });
      if (liber !== true) return json(429, { error: 'Ai atins limita zilnică de răspunsuri AI (50). Căutarea în pasaje merge în continuare.' });
    }

    // ═══ process_queue ═══
    if (action === 'process_queue') {
      const { PDFDocument } = await import('npm:pdf-lib@1.17.1'); // LAZY — doar aici
      const { data: items, error: qErr } = await supabase
        .from('rag_ingest_queue').select('*')
        .in('status', ['pending', 'processing'])
        .eq('tip', 'carte_utilaj')
        .order('id').limit(1);
      if (qErr) throw qErr;
      if (!items || items.length === 0) return json(200, { success: true, idle: true });
      const item = items[0];
      let step = 'claim';

      try {
        await supabase.from('rag_ingest_queue').update({ status: 'processing' }).eq('id', item.id);

        step = 'doc_select';
        const { data: doc, error: dErr } = await supabase
          .from('logistica_documente')
          .select('id, numar_document, observatii, active_id')
          .eq('id', item.document_id).single();
        if (dErr) throw dErr;

        step = 'activ_select';
        let activ: { marca?: string; model?: string } | null = null;
        if (item.active_id) {
          const { data: a } = await supabase.from('logistica_active').select('marca, model').eq('id', item.active_id).maybeSingle();
          activ = a;
        }
        const modelKey = slugKey(`${activ?.marca || ''} ${activ?.model || ''}`) || `ACTIV-${item.active_id}`;
        const sursa = [doc.numar_document, (doc.observatii || '').slice(0, 90)].filter(Boolean).join(' — ') || item.pdf_path;

        step = 'storage_download';
        const { data: blob, error: sErr } = await supabase.storage.from(item.bucket).download(item.pdf_path);
        if (sErr) throw sErr;
        step = 'pdf_load';
        const pdfBytes = new Uint8Array(await blob.arrayBuffer());
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const totalPages = pdfDoc.getPageCount();

        let page = item.next_page;
        let batches = 0;
        let inserted = 0;
        while (page <= totalPages && batches < MAX_BATCHES_PER_RUN) {
          step = `batch_p${page}`;
          const count = Math.min(BATCH_PAGES, totalPages - page + 1);
          const sub = await PDFDocument.create();
          const idx = Array.from({ length: count }, (_, i) => page - 1 + i);
          const copied = await sub.copyPages(pdfDoc, idx);
          copied.forEach((p) => sub.addPage(p));
          const subB64 = b64(await sub.save());

          const entries = await transcribeBatch(subB64, page, count);
          const rows: Array<Record<string, unknown>> = [];
          for (const e of entries) {
            const chunks = chunkText(e.text || '');
            chunks.forEach((c, ci) => rows.push({
              model_key: modelKey, active_id: item.active_id, document_id: item.document_id,
              sursa, referinta: `pag. ${e.pagina}${ci > 0 ? ' (cont.)' : ''}`, content: c,
            }));
          }
          if (rows.length > 0) {
            const { error: insErr } = await supabase.from('rag_utilaje').insert(rows);
            if (insErr) throw insErr;
            inserted += rows.length;
          }
          page += count;
          batches++;
          await supabase.from('rag_ingest_queue').update({ next_page: page }).eq('id', item.id);
        }

        const finished = page > totalPages;
        await supabase.from('rag_ingest_queue').update(
          finished ? { status: 'done', processed_at: new Date().toISOString(), error: null } : { status: 'processing' }
        ).eq('id', item.id);

        return json(200, { success: true, queue_id: item.id, document_id: item.document_id, model_key: modelKey, total_pages: totalPages, next_page: page, finished, chunks_inserted: inserted });
      } catch (e) {
        const msg = `[${step}] ${errMsg(e)}`;
        console.error('process_queue fail:', msg);
        const attempts = (item.attempts || 0) + 1;
        await supabase.from('rag_ingest_queue').update({
          attempts, error: msg.slice(0, 500), status: attempts >= 3 ? 'error' : 'pending',
        }).eq('id', item.id);
        return json(200, { success: false, queue_id: item.id, error: msg });
      }
    }

    // ═══ process_pending ═══
    if (action === 'process_pending') {
      const { data: pending, error } = await supabase
        .from('rag_utilaje').select('id, content')
        .is('embedding', null).limit(EMBED_BATCH);
      if (error) throw error;
      let processed = 0;
      for (const row of pending || []) {
        try {
          const emb = await embed(row.content);
          await supabase.from('rag_utilaje').update({ embedding: JSON.stringify(emb) }).eq('id', row.id);
          processed++;
        } catch (e) { console.error(`embed fail id=${row.id}:`, errMsg(e)); }
      }
      return json(200, { success: true, processed });
    }

    // ═══ ask (fișa utilajului din Logistică — owner sau modul logistica; AI doar editor/admin + cotă) ═══
    if (action === 'ask') {
      const { question, model_key, ai } = body;
      if (!question) return json(400, { error: 'question necesară' });
      const result = await searchAndAnswer(supabase, String(question).slice(0, 500), model_key || null, !!ai);
      return json(200, { success: true, ...result });
    }

    return json(400, { error: 'action invalid' });
  } catch (e) {
    const msg = errMsg(e);
    console.error('rag-utilaj error:', msg);
    return json(500, { error: msg });
  }
});
