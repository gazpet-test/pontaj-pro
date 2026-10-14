// rag-normative v2 — 09.06.2026
// Embeddings cu gte-small (built-in Supabase AI, GRATUIT)
// Actions: process_pending (embeddings pt randuri noi), ask (întrebare → search → Haiku), ingest
// INTERNAL_SECRET protejează apelurile pg_net; JWT pentru apeluri frontend

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INTERNAL_SECRET = crypto.randomUUID(); // <REDACTAT len 24> la copiere (14.10.2026): literalul din v22 nu intră în repo; valoarea aleatoare nu se potrivește niciodată

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const session = new Supabase.ai.Session('gte-small');

async function embed(text: string): Promise<number[]> {
  const result = await session.run(text.slice(0, 1800), { mean_pool: true, normalize: true });
  return result as number[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const action = body.action;

    // Auth: fie x-internal-secret (pg_net), fie JWT user valid
    const internalSecret = req.headers.get('x-internal-secret');
    const isInternal = internalSecret === INTERNAL_SECRET;
    if (!isInternal) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Neautorizat' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (!user) {
        return new Response(JSON.stringify({ error: 'Token invalid' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ═══ process_pending: embeddings pentru randuri cu embedding NULL ═══
    if (action === 'process_pending') {
      const { data: pending, error } = await supabase
        .from('rag_normative').select('id, content')
        .is('embedding', null).limit(30);
      if (error) throw error;

      let processed = 0;
      for (const row of pending || []) {
        try {
          const emb = await embed(row.content);
          await supabase.from('rag_normative')
            .update({ embedding: JSON.stringify(emb) }).eq('id', row.id);
          processed++;
        } catch (e) { console.error(`embed fail id=${row.id}:`, e); }
      }
      return new Response(JSON.stringify({ success: true, processed, remaining_check: (pending||[]).length }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // ═══ ask: întrebare → similarity search → Haiku cu citate ═══
    if (action === 'ask') {
      const { question, sursa } = body;
      if (!question) {
        return new Response(JSON.stringify({ error: 'question necesară' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }

      const qEmb = await embed(question);
      const { data: matches, error: searchErr } = await supabase.rpc('match_normative', {
        query_embedding: JSON.stringify(qEmb),
        match_count: 4,
        filter_sursa: sursa || null,
      });
      if (searchErr) throw searchErr;

      if (!matches || matches.length === 0) {
        return new Response(JSON.stringify({ success: true, answer: 'Nu am găsit prevederi relevante.', sources: [] }), {
          headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }

      const context = matches.map((m: any, i: number) =>
        `[${i+1}] ${m.sursa} ${m.referinta || ''}:\n${m.content}`
      ).join('\n\n');

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          system: 'Ești expert în normative tehnice românești pentru gaze naturale. Răspunzi DOAR pe baza extraselor furnizate. Citezi articolul exact (ex: conform Art. 75 din NTPEE 2018). Dacă extrasele nu conțin răspunsul, spui clar. Concis, în română.',
          messages: [{ role: 'user', content: `Extrase:\n\n${context}\n\nÎntrebare: ${question}` }]
        })
      });

      const aiData = await aiRes.json();
      const answer = aiData.content?.[0]?.text || 'Eroare generare răspuns';

      // Salvez raspunsul pentru verificare din SQL (test mode)
      if (body.save_test) {
        await supabase.from('rag_test_log').insert({ question, answer, sources: matches });
      }

      return new Response(JSON.stringify({
        success: true, answer,
        sources: matches.map((m: any) => ({ referinta: m.referinta, similarity: Math.round(m.similarity*100)/100 }))
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'action invalid' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    console.error('rag-normative error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
