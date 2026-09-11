// ofertare-clarificare-citeste — Răzvan 07.09.2026: clarificările încărcate MANUAL (PDF depus de un coleg
// direct în SEAP) sunt citite de platformă cu AI: extrage întrebarea pe scurt + rezumat, marchează
// citita_la / citita_rezumat pe ofertare_clarificari, ca să se vadă că platforma „a luat cunoștință”.
// Auth: JWT de utilizator (functions.invoke). Erori de business → return {error}, nu throw.
import { createClient } from 'npm:@supabase/supabase-js@2'

// Secretul NU mai sta in sursa: repo-ul e public. Verificare prin RPC contra Vault; functia
// accepta si valoarea precedenta cat tine fereastra de rotire, ca sa nu pice cron-urile deodata.
async function secretOk(req: Request): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.rpc('fn_verifica_radar_secret', { p_secret: s })
  return !error && data === true
}


const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
const MODEL = 'claude-haiku-4-5-20251001'
const PRICE_IN = 1 / 1e6, PRICE_OUT = 5 / 1e6
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })
const b64 = (bytes: Uint8Array) => { let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(bin) }

const PROMPT = `Acesta este un document de clarificare depus de ofertantul GAZPET INSTAL SRL către o autoritate contractantă, într-o licitație publică românească (SEAP). Citește-l integral și răspunde EXCLUSIV cu JSON:
{"intrebare": "<textul întrebării/solicitării, formulat scurt (1-3 propoziții), la persoana întâi plural, ca în adresă>",
 "rezumat": "<2-4 propoziții: ce se cere, pe ce bază din documentație, ce impact are asupra ofertei>",
 "nr_intrebari": <câte întrebări distincte conține>,
 "referinte": ["<documente/articole/formulare invocate, ex. F3, HG 907/2016, Anexa 1>"],
 "data_document": "<AAAA-LL-ZZ sau null>"}`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Auth: JWT de utilizator (UI) SAU secretul intern (Claude/rutina) — același pattern ca olx-api / fisier-intern
  if (!(await secretOk(req))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'fără autentificare' }, 401)
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: u } = await uc.auth.getUser()
    if (!u?.user) return json({ error: 'token invalid' }, 401)
  }
  const KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!KEY) return json({ error: 'ANTHROPIC_API_KEY lipsă' }, 500)

  let body: any = {}; try { body = await req.json() } catch { /* gol */ }
  const id = Number(body.clarificare_id)
  if (!id) return json({ error: 'clarificare_id lipsă' }, 400)
  const { data: row } = await db.from('ofertare_clarificari').select('*').eq('id', id).maybeSingle()
  if (!row) return json({ error: 'clarificarea nu există' }, 404)
  if (!row.fisier_path) return json({ error: 'clarificarea nu are PDF atașat' }, 400)

  const { data: blob, error: dlErr } = await db.storage.from('ofertare').download(row.fisier_path)
  if (dlErr || !blob) return json({ error: 'download PDF: ' + (dlErr?.message || 'lipsă') })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length > 25_000_000) return json({ error: 'PDF prea mare (>25 MB)' })

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(bytes) } },
      { type: 'text', text: PROMPT } ] }] }),
  })
  const data = await resp.json()
  if (!resp.ok) return json({ error: 'Claude: ' + (data.error?.message || resp.status) })
  const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  let j: any = null
  try { const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/); j = m ? JSON.parse(m[0]) : null } catch { /* mai jos */ }
  if (!j) return json({ error: 'răspuns AI neinterpretabil', brut: txt.slice(0, 300) })

  try { await db.from('ai_usage_log').insert({ function_name: 'ofertare-clarificare-citeste', model: MODEL, tokens_in: data.usage?.input_tokens || 0, tokens_out: data.usage?.output_tokens || 0, cost_usd: (data.usage?.input_tokens || 0) * PRICE_IN + (data.usage?.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_clarificari', ref_id: id }) } catch { /* ignorăm */ }

  const placeholder = /^\(clarificare depusă extern/i.test(row.intrebare || '') || !(row.intrebare || '').trim()
  const rezumat = [j.rezumat, j.nr_intrebari > 1 ? `Conține ${j.nr_intrebari} întrebări.` : null, Array.isArray(j.referinte) && j.referinte.length ? 'Referințe: ' + j.referinte.join(', ') + '.' : null].filter(Boolean).join(' ')
  const upd: any = { citita_la: new Date().toISOString(), citita_rezumat: rezumat.slice(0, 2000), origine: 'manual' }
  if (placeholder && j.intrebare) upd.intrebare = String(j.intrebare).slice(0, 4000)
  if (!row.sursa || row.sursa === 'extern') upd.sursa = 'extern — PDF depus în SEAP' + (j.data_document ? ` (${j.data_document})` : '')
  const { error: upErr } = await db.from('ofertare_clarificari').update(upd).eq('id', id)
  if (upErr) return json({ error: 'update: ' + upErr.message })
  return json({ ok: true, id, intrebare: upd.intrebare || row.intrebare, rezumat: upd.citita_rezumat })
})
