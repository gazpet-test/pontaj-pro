// parse-contract-proiect v1 — citeste un PDF de contract EXECUTIE si returneaza datele extrase.
// Diferenta fata de parse-contract-pdf (care lucreaza pe contracte_terti): NU scrie nimic in BD.
// Wizardul „Proiect nou" primeste JSON-ul si pre-completeaza formularul; Razvan verifica inainte
// de salvare. Asa evitam anti-bug-ul „extractia AI suprascrie campuri completate manual".
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const MODEL = Deno.env.get('PARSE_CONTRACT_MODEL') || 'claude-haiku-4-5-20251001'
const MAX_PDF_MB = 10
const BUCKETS_PERMISE = new Set(['executie-contracte'])
const PRICE_IN = 1 / 1e6, PRICE_OUT = 5 / 1e6

const SYSTEM_PROMPT = `Esti asistent de extragere date din contracte de executie lucrari (constructii conducte gaze) pentru Gazpet Instal SRL, care e ANTREPRENORUL/EXECUTANTUL.
Extrage din PDF si raspunde DOAR cu JSON valid:
{
  "nume": string - denumirea lucrarii/obiectivului asa cum apare in contract, max 200 char, sau null,
  "nr_contract": string sau null,
  "data_contract": "YYYY-MM-DD" sau null (data semnarii),
  "beneficiar": string sau null (achizitorul care semneaza contractul, ex. Transgaz SA),
  "beneficiar_final": string sau null (beneficiarul final, daca difera de achizitor),
  "valoare_lei": numar sau null (valoarea contractului FARA TVA, doar daca e exprimata in RON),
  "valoare_eur": numar sau null (doar daca e exprimata in EUR),
  "data_start": "YYYY-MM-DD" sau null (data de incepere a lucrarilor, daca e mentionata explicit),
  "data_termen": "YYYY-MM-DD" sau null (DOAR data limita de finalizare a lucrarilor; NU data licitatiei, NU data ofertei),
  "durata_contract_luni": numar sau null (durata de executie in LUNI; daca e in zile, imparte la 30 si rotunjeste),
  "penalitati_zi_pct": numar sau null (procent penalitati intarziere pe zi, ex. 0.05),
  "garantie_buna_exec_pct": numar sau null (procent garantie de buna executie, ex. 10),
  "confidence": 0-100
}
Reguli: null pentru orice camp care nu apare explicit in document — NU ghici. Date in format ISO.
Valori numerice fara separatori de mii si fara simbol moneda. Raspunde DOAR cu JSON.`

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  return btoa(binary)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: CORS })

    const { pdf_path, bucket } = await req.json()
    const buck = bucket || 'executie-contracte'
    if (!pdf_path) return new Response(JSON.stringify({ error: 'pdf_path obligatoriu' }), { status: 400, headers: CORS })
    if (!BUCKETS_PERMISE.has(buck)) return new Response(JSON.stringify({ error: 'Bucket nepermis: ' + buck }), { status: 400, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Auth: doar owner / can_manage_contracts (wizardul e vizibil doar lor)
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await supabaseUser.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })
    const { data: profile } = await supabaseAdmin.from('profiles').select('is_owner, can_manage_contracts').eq('id', user.id).single()
    if (!profile?.is_owner && !profile?.can_manage_contracts)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })

    const { data: pdfBlob, error: dlError } = await supabaseAdmin.storage.from(buck).download(pdf_path)
    if (dlError || !pdfBlob) return new Response(JSON.stringify({ error: `PDF download failed: ${dlError?.message}` }), { status: 404, headers: CORS })

    const arrayBuffer = await pdfBlob.arrayBuffer()
    const sizeMb = arrayBuffer.byteLength / 1024 / 1024
    if (sizeMb > MAX_PDF_MB)
      return new Response(JSON.stringify({ error: `PDF prea mare: ${sizeMb.toFixed(1)}MB (max ${MAX_PDF_MB}MB). Comprima PDF-ul.` }), { status: 413, headers: CORS })

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2000, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arrayBufferToBase64(arrayBuffer) } },
          { type: 'text', text: 'Extrage datele contractului de executie.' }
        ]}]
      })
    })
    if (!r.ok) {
      const err = await r.text()
      console.error('Anthropic error:', r.status, err)
      return new Response(JSON.stringify({ error: `Anthropic ${r.status}: ${err.slice(0, 300)}` }), { status: 502, headers: CORS })
    }
    const result = await r.json()

    try {
      const u = result.usage || {}
      await supabaseAdmin.from('ai_usage_log').insert({
        function_name: 'parse-contract-proiect', model: MODEL,
        tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
        cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT,
        ref_table: 'executie_proiecte', ref_id: null,
      })
    } catch (_) { /* contorizarea nu blocheaza raspunsul */ }

    const raw = result.content?.[0]?.text || '{}'
    let parsed: any
    try { parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim()) }
    catch { return new Response(JSON.stringify({ error: 'Parse failed', raw: raw.slice(0, 300) }), { status: 500, headers: CORS }) }

    const toNum = (v: any) => {
      if (v === null || v === undefined || v === '') return null
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(/[^0-9.,-]/g, '').replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    parsed.valoare_lei = toNum(parsed.valoare_lei)
    parsed.valoare_eur = toNum(parsed.valoare_eur)
    parsed.durata_contract_luni = parsed.durata_contract_luni ? Math.round(toNum(parsed.durata_contract_luni) || 0) || null : null
    parsed.penalitati_zi_pct = toNum(parsed.penalitati_zi_pct)
    parsed.garantie_buna_exec_pct = toNum(parsed.garantie_buna_exec_pct)
    if (typeof parsed.confidence !== 'number') parsed.confidence = 70

    return new Response(JSON.stringify({ success: true, extras: parsed, confidence: parsed.confidence }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    console.error('Unhandled:', e)
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: CORS })
  }
})
