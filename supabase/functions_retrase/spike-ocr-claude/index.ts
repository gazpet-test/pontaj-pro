// spike-ocr-claude v1 (11.08.2026) — TEMPORAR, pentru testul A/B/C Import Documente
// Transcrie o imagine de pagina scanata cu claude-sonnet-5, strict, fara corecturi.
// Se sterge dupa spike (sau ramane ca baza pentru ramura scan-narativ Claude).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = 'claude-sonnet-5'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Content-Type': 'application/json' }

const PROMPT = `Transcrie EXACT textul din aceasta pagina scanata (deviz/document tehnic romanesc).
Reguli STRICTE:
- Transcrie caracter cu caracter ce VEZI. NU corecta, NU completa, NU interpreta.
- Indicativele de articole (ex. TSA05C1) si toate numerele se copiaza intocmai, chiar daca par gresite.
- Pastreaza structura pe linii (o linie de text = o linie in output).
- Caracter ilizibil = ? (semnul intrebarii).
- Fara comentarii, fara markdown, fara introducere: DOAR textul transcris.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { b64, mime } = await req.json()
    if (!b64) return new Response(JSON.stringify({ error: 'b64 required' }), { status: 400, headers: CORS })
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 4000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: b64 } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return new Response(JSON.stringify({ error: data.error?.message || resp.status }), { status: 200, headers: CORS })
    const text = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    // logare cost in ai_usage_log (acelasi tipar ca citeste-orice)
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const u = data.usage || {}
      await sb.from('ai_usage_log').insert({ function_name: 'spike-ocr-claude', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * 3 / 1e6 + (u.output_tokens || 0) * 15 / 1e6, ref_table: 'spike', ref_id: null })
    } catch (_) {}
    return new Response(JSON.stringify({ ok: true, text, usage: data.usage }), { headers: CORS })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 200, headers: CORS })
  }
})
