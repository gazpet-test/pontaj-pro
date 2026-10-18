// parse-contract-pdf v8 — v7 + NU suprascrie campurile deja completate manual (12.06.2026)
// Motivatie: la atasare PDF pe contract pre-completat, AI-ul suprascria date corecte cu typo-uri
// din document (ex. 1513/27.11.2024 vs 2025) sau halucinatii (data licitatiei ca data_termen,
// "8 luni" citit ca 8 zile). Acum AI-ul COMPLETEAZA doar golurile; campurile ne-NULL raman intacte.
// 14.10.2026 (securitate etapa 2, grup C): adusă în repo. Scoasă calea x-internal-secret (fallback literal compromis,
// niciun consumator intern găsit). Poarta pe profil rămâne identică (doar owner).
// Revenire: supabase/functions_retrase/revenire_grupc/parse-contract-pdf.v28.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { faraGandire } from '../_shared/gandire.ts'
import { costApel, HAIKU_55, jsonDinText, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// 18.10.2026: Haiku 4.5 → Haiku 5.5 (_shared/haiku55.ts) — gândire oprită explicit (pe 5.5 e pornită implicit), max_tokens
// 2000 → 2600 (tokenizer ~30% mai mare), cost pe prețul nou, textul doar din blocurile `text`, refuzul filtrului → 422 cu mesaj.
// ATENȚIE: dacă secretul PARSE_CONTRACT_MODEL e setat (ex. pe Haiku 4.5), el câștigă — costul se calculează pe modelul real.
const MODEL = Deno.env.get('PARSE_CONTRACT_MODEL') || HAIKU_55
const MAX_PDF_MB = 10

const SYSTEM_PROMPT = `Esti asistent extragere date din contracte comerciale romanesti pentru Gazpet Instal SRL.
Extrage din PDF si raspunde DOAR cu JSON valid:
{
  "denumire": string scurt max 200 char,
  "numar_contract": string sau null,
  "beneficiar_nume": string sau null,
  "valoare_lei": numar sau null (DOAR RON explicit),
  "valoare_eur": numar sau null (DOAR EUR explicit),
  "data_semnare": "YYYY-MM-DD" sau null,
  "termen_executie_zile": numar sau null (DOAR daca termenul e exprimat in ZILE; daca e in LUNI, converteste: 1 luna = 30 zile),
  "data_termen": "YYYY-MM-DD" sau null (DOAR data limita de finalizare a lucrarilor; NU data licitatiei, NU data ofertei),
  "clauze": {"penalitati":str|null,"garantii":str|null,"plata":str|null,"reziliere":str|null,"observatii":str|null},
  "confidence": 0-100
}
Reguli: null pentru campuri lipsa. Date ISO. Valori numerice fara separatori. DOAR JSON.`

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

    const body = await req.json()
    const { contract_id, pdf_path } = body
    if (!contract_id || !pdf_path) return new Response(JSON.stringify({ error: 'contract_id si pdf_path obligatorii' }), { status: 400, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const authHeader = req.headers.get('Authorization') || ''
    let authorized = false

    if (authHeader.startsWith('Bearer ')) {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await supabaseUser.auth.getUser()
      if (user) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('is_owner').eq('id', user.id).single()
        if (profile?.is_owner) authorized = true
      }
    }
    if (!authorized) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })

    const { data: pdfBlob, error: dlError } = await supabaseAdmin.storage.from('contracte-terti').download(pdf_path)
    if (dlError || !pdfBlob) return new Response(JSON.stringify({ error: `PDF download failed: ${dlError?.message}` }), { status: 404, headers: CORS })

    const arrayBuffer = await pdfBlob.arrayBuffer()
    const sizeMb = arrayBuffer.byteLength / 1024 / 1024
    console.log(`PDF: ${pdf_path}, ${sizeMb.toFixed(1)}MB`)

    if (sizeMb > MAX_PDF_MB) {
      return new Response(JSON.stringify({
        error: `PDF prea mare: ${sizeMb.toFixed(1)}MB (max ${MAX_PDF_MB}MB). Comprima PDF-ul.`,
        size_mb: sizeMb.toFixed(1)
      }), { status: 413, headers: CORS })
    }

    const base64Pdf = arrayBufferToBase64(arrayBuffer)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2600, thinking: faraGandire(MODEL), system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: 'Extrage datele contractului.' }
        ]}]
      })
    })

    if (!r.ok) {
      const err = await r.text()
      console.error('Anthropic error:', r.status, err)
      return new Response(JSON.stringify({ error: `Anthropic ${r.status}: ${err.slice(0,300)}` }), { status: 502, headers: CORS })
    }

    const result = await r.json()

    // CONTORIZARE COST (v7)
    try {
      const u = result.usage || {}
      await supabaseAdmin.from('ai_usage_log').insert({
        function_name: 'parse-contract-pdf', model: MODEL,
        tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
        cost_usd: costApel(MODEL, u),
        ref_table: 'contracte_terti', ref_id: contract_id,
      })
    } catch (_) { /* nu blocheaza */ }

    const refuz = mesajRefuz(result)
    if (refuz) return new Response(JSON.stringify({ error: refuz }), { status: 422, headers: CORS })
    const raw = textRaspuns(result) || '{}'
    // deno-lint-ignore no-explicit-any
    const parsed: any = jsonDinText(raw)
    if (!parsed) return new Response(JSON.stringify({ error: 'Parse failed', raw: raw.slice(0,300) }), { status: 500, headers: CORS })

    if (typeof parsed.confidence !== 'number') parsed.confidence = 70
    const toNum = (v: any) => typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, '')) || null
    parsed.valoare_lei = parsed.valoare_lei ? toNum(parsed.valoare_lei) : null
    parsed.valoare_eur = parsed.valoare_eur ? toNum(parsed.valoare_eur) : null
    parsed.termen_executie_zile = parsed.termen_executie_zile ? parseInt(String(parsed.termen_executie_zile)) || null : null

    // v8: citim ce e DEJA completat in BD — AI-ul umple DOAR golurile, nu suprascrie
    const { data: existing, error: exError } = await supabaseAdmin.from('contracte_terti')
      .select('denumire, numar_contract, valoare_lei, valoare_eur, data_semnare, termen_executie_zile, data_termen')
      .eq('id', contract_id).single()
    if (exError || !existing) return new Response(JSON.stringify({ error: 'Contract inexistent: ' + (exError?.message || contract_id) }), { status: 404, headers: CORS })

    const isEmpty = (v: any) => v === null || v === undefined || v === ''
    const updates: any = { ai_extracted_at: new Date().toISOString(), ai_clauze_jsonb: parsed }
    const completate: string[] = []
    const protejate: string[] = []
    const trySet = (field: string, val: any) => {
      if (val === null || val === undefined || val === '') return
      if (!isEmpty((existing as any)[field])) { protejate.push(field); return }
      updates[field] = val
      completate.push(field)
    }
    trySet('denumire', parsed.denumire)
    trySet('numar_contract', parsed.numar_contract)
    trySet('valoare_lei', parsed.valoare_lei)
    trySet('valoare_eur', parsed.valoare_eur)
    trySet('data_semnare', parsed.data_semnare)
    trySet('termen_executie_zile', parsed.termen_executie_zile)
    trySet('data_termen', parsed.data_termen)

    const { error: upError } = await supabaseAdmin.from('contracte_terti').update(updates).eq('id', contract_id)
    if (upError) {
      console.error('Update error:', upError)
      return new Response(JSON.stringify({ error: 'DB update failed: ' + upError.message, extracted: parsed }), { status: 500, headers: CORS })
    }

    console.log(`Contract ${contract_id}: completate=[${completate.join(',')}] protejate=[${protejate.join(',')}]`)
    return new Response(JSON.stringify({
      success: true, contract_id, confidence: parsed.confidence, extracted: parsed,
      campuri_completate: completate,
      campuri_protejate: protejate,  // erau deja completate manual — NU au fost suprascrise
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    console.error('Unhandled:', e)
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: CORS })
  }
})
