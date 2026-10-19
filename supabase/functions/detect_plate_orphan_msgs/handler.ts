// detect_plate_orphan_msgs v4 - 14.10.2026 (securitate etapa 2 grup A) — logica funcției (index.ts doar pornește serverul).
// v4: scos complet antetul intern de ocolire „MCP” (v3 îl compara cu un literal scris în cod, verify_jwt=false →
//     oricine îl știa pornea procesare AI plătită + UPDATE logistica_alimentari). Niciun consumator intern găsit
//     (cron, funcții/trigger-e BD, pg_net, alte edge, jurnale 48h). Poarta e acum în acces.ts: JWT-ul sesiunii +
//     owner SAU (rol admin_logistica ȘI modulul 'logistica'). Restul codului e identic cu v24, cu trei excepții:
//     un tip `any` (vezi mai jos) și dependențele injectate (Deps: client, cheia Anthropic, fetch), ca handler_test.ts
//     să poată verifica fără rețea că nimic nu se citește / nu se cheltuie înaintea porții.
//     Revenire: supabase/functions_retrase/revenire_grupa/detect_plate_orphan_msgs.v24.ts
// v5 - 18.10.2026: Haiku 4.5 → Haiku 5.5 (_shared/haiku55.ts): gândire oprită explicit (pe 5.5 e pornită implicit), max_tokens
//     400 → 600 (tokenizer ~30% mai mare), cost pe prețul nou (0,10 / 0,50 $ pe 1M), refuzul filtrului de siguranță tratat ca
//     parse_failed (același rând în BD), nu ca excepție.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { poartaPlate } from './acces.ts'
import { faraGandire } from '../_shared/gandire.ts'
import { costApel, HAIKU_55, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = HAIKU_55
const MAX_BATCH = 30
const WINDOW_HOURS = 96

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
  // v4: `any` în loc de ReturnType<typeof createClient> — tiparea supabase-js nouă pica `deno check` (TS2345); fără efect la rulare
  // deno-lint-ignore no-explicit-any
  supabaseService: any, path: string,
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
  doFetch: typeof fetch, apiKey: string, base64: string, contentType: string,
  supabaseService: Deps['supa'], msgId: number,
): Promise<{ text: string; tokensIn: number; tokensOut: number; refuz: string | null; stopReason: string | null }> {
  const resp = await doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 600, thinking: faraGandire(MODEL), system: PLATE_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
        { type: 'text', text: 'Identifica placuta auto din poza. Returneaza JSON.' }
      ]}],
    }),
  })
  // Inclusiv răspunsurile eșuate, refuzate sau trunchiate care raportează consum.
  try {
    const d = await resp.clone().json()
    if (resp.ok || d?.usage) {
      const u = d?.usage || {}
      await supabaseService.from('ai_usage_log').insert({
        function_name: 'detect_plate_orphan_msgs', model: MODEL,
        tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
        cost_usd: costApel(MODEL, u), ref_table: 'whatsapp_messages_processed', ref_id: msgId,
      })
    }
  } catch (_) { /* nu blocheaza */ }
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}`)
  const data = await resp.json()
  return {
    text: textRaspuns(data),
    tokensIn: data.usage?.input_tokens || 0,
    tokensOut: data.usage?.output_tokens || 0,
    refuz: mesajRefuz(data),
    stopReason: data.stop_reason || null,
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

// Dependențele injectate: în producție clientul service + cheia din env + fetch; în teste, simulări care numără.
// deno-lint-ignore no-explicit-any
export type Deps = { supa: any; API_KEY: string | undefined; fetch: typeof fetch }

export function depsReale(): Deps {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return { supa: createClient(supabaseUrl, supabaseServiceKey), API_KEY: Deno.env.get('ANTHROPIC_API_KEY'), fetch }
}

// faDeps = fabrica de dependențe, chemată LENEȘ: după OPTIONS și în interiorul try. Dacă inițializarea aruncă
// (env lipsă, client), OPTIONS rămâne 200, iar POST primește 500 JSON cu CORS (review Jakarinos r2, PR #707).
export async function handler(req: Request, faDeps: () => Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const deps = faDeps()
    const supabaseService = deps.supa

    // Poarta înaintea oricărei alte lucrări (și înaintea mesajelor despre configurare).
    const acces = await poartaPlate(req, supabaseService)
    if (!acces.ok) {
      return new Response(JSON.stringify({ error: acces.error }), {
        status: acces.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const anthropicKey = deps.API_KEY
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY missing' }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
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
    let totalTokensIn = 0, totalTokensOut = 0, costUsd = 0

    console.log(`[plate-detect] START user=${acces.userId} | orphans=${orphans.length}`)

    for (const msg of orphans) {
      const result: ResultItem = { msg_id: msg.id as number, placuta: null, confidence: 0 }

      try {
        const { base64, contentType } = await downloadPozaAsBase64(supabaseService, msg.photo_path as string)
        const visionRes = await callVision(deps.fetch, anthropicKey, base64, contentType, supabaseService, msg.id as number)
        totalTokensIn += visionRes.tokensIn
        totalTokensOut += visionRes.tokensOut
        // costul pe APEL: pragul de 100K tokeni al Haiku 5.5 se judecă pe fiecare prompt, nu pe totalul lotului
        costUsd += costApel(MODEL, { input_tokens: visionRes.tokensIn, output_tokens: visionRes.tokensOut })

        const incomplet = visionRes.stopReason === 'max_tokens'
        const parsed = incomplet || visionRes.refuz || !visionRes.text.trim() ? null : extractJson(visionRes.text)
        if (!parsed) {
          result.error = incomplet ? 'Raspuns AI incomplet (max_tokens); reincearca' : visionRes.refuz ? `refuz_ai: ${visionRes.refuz}` : 'parse_failed'
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
        const vehicleMatch = (vehicles || []).find((v: Record<string, unknown>) => {
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
    console.log(`[plate-detect] OK user=${acces.userId} | ${JSON.stringify(summary)} | $${costUsd.toFixed(5)}`)

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
}
