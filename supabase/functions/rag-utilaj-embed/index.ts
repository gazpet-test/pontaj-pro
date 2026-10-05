// rag-utilaj-embed v2 — 05.10.2026 (#17 faza 2: adus în repo de pe live v10; secretul intern din Vault prin
//  x-intern-secret în locul valorii scrise în sursă; pe JWT doar owner-ul — e un worker de fundal, nu un ecran).
// v1 (20.07.2026): worker SLIM doar pentru embeddings rag_utilaje (gte-small) — separat de rag-utilaj
// pentru că bundle-ul cu pdf-lib + gte-small în același worker dă WORKER_RESOURCE_LIMIT.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { esteApelIntern } from '../_shared/poartaIntern.ts';
import { decideAcces } from '../_shared/poartaRag.ts';

// Globalul runtime-ului Supabase Edge (Supabase.ai.Session) — nu are tipuri publicate pentru deno check.
// deno-lint-ignore no-explicit-any
declare const Supabase: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const session = new Supabase.ai.Session('gte-small');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const intern = await esteApelIntern(req, supabase);
    let user = false, isOwner = false;
    if (!intern) {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } };
      if (u?.user) {
        user = true;
        const { data: prof } = await supabase.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle();
        isOwner = prof?.is_owner === true;
      }
    }
    const dec = decideAcces({ intern, user, isOwner, nivelLogistica: null, action: 'process_pending' });
    if (!dec.ok) return json(dec.status, { error: dec.error });

    const { data: pending, error } = await supabase
      .from('rag_utilaje').select('id, content')
      .is('embedding', null).limit(30);
    if (error) throw error;

    let processed = 0;
    for (const row of pending || []) {
      try {
        const emb = await session.run(row.content.slice(0, 1800), { mean_pool: true, normalize: true });
        await supabase.from('rag_utilaje').update({ embedding: JSON.stringify(emb) }).eq('id', row.id);
        processed++;
      } catch (e) {
        console.error(`embed fail id=${row.id}:`, e instanceof Error ? e.message : String(e));
      }
    }
    return json(200, { success: true, processed, batch: (pending || []).length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    console.error('rag-utilaj-embed error:', msg);
    return json(500, { error: msg });
  }
});
