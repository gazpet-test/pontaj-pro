// detect_plate_orphan_msgs v3 - 26.05.2026
// v3: Bypass auth check when X-Internal-MCP-Bypass header is present
// (allows MCP/admin script invocation via pg_net for emergency lansare)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-mcp-bypass',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-haiku-4-5-20251001'
const MODEL_PRICING = { input: 1.0, output: 5.0 }
const MAX_BATCH = 30
const WINDOW_HOURS = 96
const ADMIN_BYPASS_SECRET = crypto.randomUUID() // <REDACTAT len 40> la copiere (14.10.2026): literalul din v24 nu intră în repo; valoarea aleatoare nu se potrivește niciodată

const PLATE_PROMPT = `Esti un OCR expert pentru identificarea plăcuțelor auto din Romania.
Analizeaza poza si extrage UNA SINGURA placuta auto vizibila (sau cod intern UT).

Format plăcuța România:
- 1-2 litere (județ: PH, B, IF, MS, CJ, etc.) + 2 cifre (sau 3) + 2-4 litere
- Exemplu: PH 21 LBO, B 123 ABC, MS 09 HUT
- IGNORĂ alte numere de pe poza (km, ore, totaluri, etc.)

Dacă pe poza apare plăcuța MAȘINII (spate auto): returnează plăcuța vizibilă.
Dacă pe poza apare bonul fiscal cu plăcuța scrisă manual la mijloc: returnează acea plăcuța.
Dacă există MAI MULTE poze - returnează DOAR cea mai clară plăcuța.
Dacă NU se vede clar nicio plăcuța: returnează null.

Format CODURI INTERNE Gazpet (utilaje fără placuta normală):
- UT001, UT123, TST00045 etc. - returnează exact formatul

Returneaza STRICT JSON valid:
{
  "placuta": "PH 21 LBO" SAU "UT123" SAU null,
  "placuta_raw": string brut SAU null,
  "sursa": "placuta_auto_spate" / "bon_handwritten" / "bon_print" / null,
  "confidence": numar 0-1,
  "notes": string scurt
}`

async function downloadPozaAsBase64(
  supabaseService: ReturnType<typeof createClient>, path: string,
): Promise<{ base64: string; contentType: string }> {
  const { data, error } = await supabaseService.storage
    .from('whatsapp-motorina-bonuri').download(path)
  if (error) throw new Error(`Storage: ${error.message}`)
  if (!data) throw new Error('No data')
  const buffer = await data.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  const base64 = btoa(binary)
  const ext = path.split('.').pop()?.toLowerCase() || 'jpg'
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  return { base64, contentType }
}

async function callVision(
  apiKey: string, base64: string, contentType: string
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 400, system: PLATE_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
        { type: 'text', text: 'Identifica placuta auto din poza. Returneaza JSON.' }
      ]}],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}`)
  const data = await resp.json()
  const textBlock = (data.content || []).find((b: { type: string; text?: string }) => b.type === 'text')
  return {
    text: textBlock?.text || '',
    tokensIn: data.usage?.input_tokens || 0,
    tokensOut: data.usage?.output_tokens || 0,
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw.trim()) }
  catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

function normalizePlate(p: string | null): string {
  if (!p) return ''
  return p.toUpperCase().replace(/[\s\-\.]+/g, '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const authHeader = req.headers.get('Authorization')
    const adminBypass = req.headers.get('X-Internal-MCP-Bypass')
    const isAdminBypass = adminBypass === ADMIN_BYPASS_SECRET

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY missing' }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey)

    if (!isAdminBypass) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
          status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        })
      }
      const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } }
      })
      const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(
        authHeader.replace('Bearer ', '')
      )
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: 'Invalid auth' }), {
          status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        })
      }
      const { data: profile } = await supabaseUser
        .from('profiles').select('is_owner, role').eq('id', user.id).maybeSingle()
      if (!profile?.is_owner && profile?.role !== 'admin_logistica') {
        return new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        })
      }
    }

    const { data: orphans, error: fetchErr } = await supabaseService
      .from('whatsapp_messages_processed')
      .select('id, msg_dt, autor, photo_path, caption_preview')
      .eq('status', 'pending_plate_detection')
      .is('plate_detected', null)
      .not('photo_path', 'is', null)
      .order('msg_dt', { ascending: false })
      .limit(MAX_BATCH)

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    if (!orphans || orphans.length === 0) {
      return new Response(JSON.stringify({
        success: true, summary: { total: 0, plates_detected: 0, matched: 0 },
        message: 'Niciun mesaj orfan de procesat'
      }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    const { data: vehicles } = await supabaseService
      .from('logistica_active')
      .select('id, nr_inmatriculare, cod_intern')
      .eq('vandut', false)
      .eq('deep_sleep', false)

    interface ResultItem {
      msg_id: number; placuta: string | null
      confidence: number; matched_alim_id?: number | null
      notes?: string; error?: string
    }
    const results: ResultItem[] = []
    let totalTokensIn = 0, totalTokensOut = 0

    console.log(`[plate-detect] START${isAdminBypass ? ' (admin-bypass)' : ''} | orphans=${orphans.length}`)

    for (const msg of orphans) {
      const result: ResultItem = { msg_id: msg.id as number, placuta: null, confidence: 0 }

      try {
        const { base64, contentType } = await downloadPozaAsBase64(supabaseService, msg.photo_path as string)
        const visionRes = await callVision(anthropicKey, base64, contentType)
        totalTokensIn += visionRes.tokensIn
        totalTokensOut += visionRes.tokensOut

        const parsed = extractJson(visionRes.text)
        if (!parsed) {
          result.error = 'parse_failed'
          await supabaseService.from('whatsapp_messages_processed')
            .update({ status: 'no_match', plate_detected: 'FAILED' })
            .eq('id', msg.id as number)
          results.push(result)
          continue
        }

        const placuta = parsed.placuta as string | null
        const confidence = Number(parsed.confidence || 0)
        result.placuta = placuta
        result.confidence = confidence
        result.notes = parsed.notes as string

        if (!placuta || confidence < 0.5) {
          await supabaseService.from('whatsapp_messages_processed')
            .update({ status: 'no_match', plate_detected: placuta || 'NONE', detection_confidence: confidence })
            .eq('id', msg.id as number)
          results.push(result)
          continue
        }

        const placNorm = normalizePlate(placuta)
        const vehicleMatch = (vehicles || []).find(v => {
          const vn = normalizePlate((v.nr_inmatriculare as string) || '')
          const cn = normalizePlate((v.cod_intern as string) || '')
          return vn === placNorm || cn === placNorm
        })

        if (!vehicleMatch) {
          await supabaseService.from('whatsapp_messages_processed')
            .update({ plate_detected: placuta, detection_confidence: confidence, status: 'no_match' })
            .eq('id', msg.id as number)
          result.notes = `Placuta ${placuta} nu există în BD vehicule`
          results.push(result)
          continue
        }

        const msgDt = new Date(msg.msg_dt as string)
        const dtStart = new Date(msgDt.getTime() - WINDOW_HOURS * 3600000).toISOString().slice(0, 10)
        const dtEnd = new Date(msgDt.getTime() + WINDOW_HOURS * 3600000).toISOString().slice(0, 10)

        const { data: alimMatches } = await supabaseService
          .from('logistica_alimentari')
          .select('id, data_alimentare')
          .eq('active_id', vehicleMatch.id as number)
          .is('site_id', null)
          .gte('data_alimentare', dtStart)
          .lte('data_alimentare', dtEnd)
          .order('data_alimentare', { ascending: false })
          .limit(1)

        if (!alimMatches || alimMatches.length === 0) {
          await supabaseService.from('whatsapp_messages_processed')
            .update({ plate_detected: placuta, detection_confidence: confidence, status: 'no_match' })
            .eq('id', msg.id as number)
          result.notes = `Placuta ${placuta} identificată dar nicio alimentare fără șantier în window`
          results.push(result)
          continue
        }

        const alimId = alimMatches[0].id as number

        await supabaseService.from('whatsapp_messages_processed')
          .update({ plate_detected: placuta, detection_confidence: confidence, status: 'matched', alimentare_id: alimId })
          .eq('id', msg.id as number)

        await supabaseService.from('logistica_alimentari')
          .update({
            whatsapp_caption: `(plate AI: ${placuta} conf=${confidence}) ${msg.caption_preview || ''}`.slice(0, 200),
            whatsapp_autor: msg.autor as string,
            whatsapp_msg_dt: msg.msg_dt as string,
            whatsapp_poza_path: msg.photo_path as string,
            sursa_alocare_santier: 'plate_ai_orphan',
            ocr_status: 'pending',
          })
          .eq('id', alimId)

        result.matched_alim_id = alimId
        results.push(result)
      } catch (e) {
        result.error = e instanceof Error ? e.message : 'unknown'
        console.error(`[plate-detect] FAIL msg #${msg.id}:`, result.error)
        results.push(result)
      }
    }

    const summary = {
      total: results.length,
      plates_detected: results.filter(r => r.placuta).length,
      matched: results.filter(r => r.matched_alim_id).length,
      errors: results.filter(r => r.error).length,
    }
    const costUsd = (totalTokensIn * MODEL_PRICING.input + totalTokensOut * MODEL_PRICING.output) / 1_000_000
    console.log(`[plate-detect] OK${isAdminBypass ? ' (admin)' : ''} | ${JSON.stringify(summary)} | $${costUsd.toFixed(5)}`)

    return new Response(JSON.stringify({
      success: true, summary, results,
      meta: { model: MODEL, tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost_usd: Number(costUsd.toFixed(5)) },
    }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('[plate-detect] Unhandled:', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }
})
