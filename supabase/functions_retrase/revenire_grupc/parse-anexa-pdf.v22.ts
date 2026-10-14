// parse-anexa-pdf v2 (11.06.2026) — + logare cost în ai_usage_log
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const MODEL = Deno.env.get('PARSE_CONTRACT_MODEL') || 'claude-haiku-4-5-20251001'
const MAX_PDF_MB = 10
// REDACTAT la copiere (14.10.2026): v22 avea aici un fallback literal compromis. Fără env, calea internă nu se potrivește niciodată.
const INTERNAL_SECRET = Deno.env.get('INTERNAL_TRIGGER_SECRET') || crypto.randomUUID()
const PRICE_IN = 1 / 1e6, PRICE_OUT = 5 / 1e6

const SYSTEM_PROMPT = `Esti asistent extragere date din anexe de pret la contracte comerciale romanesti (Gazpet Instal SRL).
PDF-ul contine o ANEXA DE PRET: lista de articole/lucrari cu cantitati si preturi unitare (tabel).
Extrage TOATE liniile si raspunde DOAR cu JSON valid:
{
  "linii": [
    {"pozitie": numar sau null, "denumire": string max 300 char, "unitate_masura": string scurt (ml/buc/mp/kg/ore etc) sau null, "cantitate": numar sau null, "pret_unitar": numar sau null}
  ],
  "moneda_detectata": "RON"|"EUR"|null,
  "confidence": 0-100
}
Reguli: numere fara separatori de mii, zecimale cu punct. Ignora randurile de TOTAL/subtotal/TVA. Nu inventa linii. DOAR JSON, fara text in jur.`

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

    const { contract_id, pdf_path } = await req.json()
    if (!contract_id || !pdf_path) return new Response(JSON.stringify({ error: 'contract_id si pdf_path obligatorii' }), { status: 400, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization') || ''
    const internalSecret = req.headers.get('x-internal-secret') || ''
    let authorized = internalSecret === INTERNAL_SECRET
    if (!authorized && authHeader.startsWith('Bearer ')) {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await supabaseUser.auth.getUser()
      if (user) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('is_owner, can_manage_contracts').eq('id', user.id).single()
        if (profile?.is_owner || profile?.can_manage_contracts) authorized = true
      }
    }
    if (!authorized) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })

    const { data: pdfBlob, error: dlError } = await supabaseAdmin.storage.from('contracte-terti').download(pdf_path)
    if (dlError || !pdfBlob) return new Response(JSON.stringify({ error: `PDF download failed: ${dlError?.message}` }), { status: 404, headers: CORS })

    const arrayBuffer = await pdfBlob.arrayBuffer()
    const sizeMb = arrayBuffer.byteLength / 1024 / 1024
    if (sizeMb > MAX_PDF_MB) return new Response(JSON.stringify({ error: `PDF prea mare: ${sizeMb.toFixed(1)}MB (max ${MAX_PDF_MB}MB).` }), { status: 413, headers: CORS })

    const base64Pdf = arrayBufferToBase64(arrayBuffer)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: 'Extrage toate liniile anexei de pret.' }
        ]}]
      })
    })
    if (!r.ok) {
      const err = await r.text()
      return new Response(JSON.stringify({ error: `Anthropic ${r.status}: ${err.slice(0, 300)}` }), { status: 502, headers: CORS })
    }

    const result = await r.json()

    // CONTORIZARE COST
    try {
      const u = result.usage || {}
      await supabaseAdmin.from('ai_usage_log').insert({
        function_name: 'parse-anexa-pdf', model: MODEL,
        tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
        cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT,
        ref_table: 'contracte_terti', ref_id: contract_id,
      })
    } catch (_) { /* nu blocheaza */ }

    const raw = result.content?.[0]?.text || '{}'
    let parsed: any
    try { parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim()) }
    catch { return new Response(JSON.stringify({ error: 'Parse failed', raw: raw.slice(0, 300) }), { status: 500, headers: CORS }) }

    const toNum = (v: any) => {
      if (v === null || v === undefined || v === '') return null
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
      return isFinite(n) ? n : null
    }

    const linii = Array.isArray(parsed.linii) ? parsed.linii : []
    const rows = linii
      .filter((l: any) => l && l.denumire && String(l.denumire).trim())
      .map((l: any, i: number) => {
        const cant = toNum(l.cantitate) ?? 0
        const pret = toNum(l.pret_unitar) ?? 0
        const rawPoz = toNum(l.pozitie)
        return {
          contract_id,
          pozitie: (rawPoz !== null && Number.isInteger(rawPoz)) ? rawPoz : (i + 1),
          denumire: String(l.denumire).trim().slice(0, 300),
          unitate_masura: l.unitate_masura ? String(l.unitate_masura).trim().slice(0, 20) : null,
          cantitate: cant,
          pret_unitar: pret,
          valoare_totala: Math.round(cant * pret * 100) / 100,
          activa: true,
          observatii: 'Import AI din anexa PDF',
        }
      })

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'AI nu a gasit linii in PDF', confidence: parsed.confidence ?? 0 }), { status: 422, headers: CORS })
    }

    const { error: insError } = await supabaseAdmin.from('contracte_linii').insert(rows)
    if (insError) return new Response(JSON.stringify({ error: 'DB insert failed: ' + insError.message }), { status: 500, headers: CORS })

    return new Response(JSON.stringify({
      success: true, contract_id, inserted: rows.length,
      moneda_detectata: parsed.moneda_detectata ?? null,
      confidence: parsed.confidence ?? 70,
      total_anexa: Math.round(rows.reduce((s: number, x: any) => s + x.valoare_totala, 0) * 100) / 100,
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: CORS })
  }
})
