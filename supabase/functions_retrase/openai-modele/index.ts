// openai-modele — utilitar temporar: listeaza modelele disponibile pe cheia din Edge Secrets.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

Deno.serve(async () => {
  const key = Deno.env.get('OPENAI_API_KEY') || ''
  if (!key) return new Response(JSON.stringify({ error: 'OPENAI_API_KEY lipseste' }), { headers: { 'Content-Type': 'application/json' } })
  const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` } })
  const d = await r.json()
  const ids = (d?.data || []).map((m: any) => m.id).sort()
  return new Response(JSON.stringify({ status: r.status, total: ids.length, ids, eroare: d?.error?.message || null }), { headers: { 'Content-Type': 'application/json' } })
})
