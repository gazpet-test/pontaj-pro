// extract_external_bon v3 - 26.05.2026 PM (DUPA explicatia Razvan despre card swap)
// PATTERN NOU: Cand cifrele AI bon match cu alta alimentare existenta pe ALT vehicul:
//   - V1/V2 (gresit): SKIP - tratat ca duplicat
//   - V3 (corect): CARD SWAP detected -> CREEZ alimentare pe vehicul real + LEG cu alimentarea fantoma
// Pentru audit ANAF: vehiculul fizic alimentat poate fi diferit de cel de pe card (factura).

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
const ADMIN_BYPASS_SECRET = crypto.randomUUID() // <REDACTAT len 40> la copiere (14.10.2026): literalul din v24 nu intră în repo; valoarea aleatoare nu se potrivește niciodată
const CARD_SWAP_WINDOW_DAYS = 3

const BON_PROMPT = `Esti un OCR expert pentru bonuri fiscale de combustibil din Romania.
Analizeaza poza bonului fiscal si extrage TOATE cifrele importante.

CAUT URMATOARELE INFORMATII:
1. STATIA: numele complet (ex: "Rompetrol AZALIS Filiasi Dolj", "OMV Bucuresti", "MOL Cluj")
2. TIP CARBURANT: motorina/benzina/gpl/electric (generic, NU brand)
3. CANTITATE LITRI: numeric exact (ex: 45.0199)
4. PRET PER LITRU: numeric (ex: 9.53)
5. PRET TOTAL: numeric in LEI - NU TVA
6. DATA si ORA: format DD-MM-YYYY HH:MM
7. NUMAR BON FISCAL

SANITY CHECKS:
- pret_total ~= pret_per_litru * cantitate_litri (toleranta 1%)
- pret_per_litru intre 5 si 15 RON/L
- data NU este in viitor (max 2026)
- cantitate intre 5 si 500 litri

Daca poza NU este un bon fiscal: returneaza is_bon: false.

Returneaza STRICT JSON valid:
{
  "is_bon": true/false,
  "statie": string SAU null,
  "brand_statie": "Rompetrol" | "OMV" | "Petrom" | "MOL" | "Lukoil" | "Socar" | "alt" | null,
  "tip_carburant": "motorina" | "benzina" | "gpl" | "electric" | null,
  "produs_brand": string,
  "cantitate_litri": numeric SAU null,
  "pret_per_litru": numeric SAU null,
  "pret_total": numeric SAU null,
  "data": string "YYYY-MM-DD" SAU null,
  "ora": string "HH:MM" SAU null,
  "numar_bon": string SAU null,
  "confidence": numar 0-1,
  "sanity_ok": true/false,
  "notes": string scurt cu observatii
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
      model: MODEL, max_tokens: 800, system: BON_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
        { type: 'text', text: 'Extrage cifrele din bon. Returneaza JSON.' }
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

    const { data: candidates, error: fetchErr } = await supabaseService
      .from('whatsapp_messages_processed')
      .select('id, msg_dt, autor, plate_detected, detection_confidence, photo_path, caption_preview')
      .eq('status', 'no_match')
      .not('plate_detected', 'is', null)
      .not('plate_detected', 'in', '(FAILED,NONE)')
      .not('photo_path', 'is', null)
      .order('msg_dt', { ascending: false })
      .limit(MAX_BATCH)

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({
        success: true, summary: { total: 0, alim_created: 0 },
        message: 'Niciun candidat de procesat'
      }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    const { data: vehicles } = await supabaseService
      .from('logistica_active')
      .select('id, nr_inmatriculare, cod_intern, tip_carburant')
      .eq('vandut', false)
      .eq('deep_sleep', false)

    interface ResultItem {
      msg_id: number
      placuta: string | null
      vehicul_id?: number
      alim_created_id?: number
      cifre_extrase?: Record<string, unknown>
      brand_statie?: string
      notes?: string
      error?: string
      card_swap_with?: number
      card_swap_placuta?: string
    }
    const results: ResultItem[] = []
    let totalTokensIn = 0, totalTokensOut = 0

    console.log(`[extract-bon v3] START${isAdminBypass ? ' (admin)' : ''} | candidates=${candidates.length}`)

    for (const msg of candidates) {
      const result: ResultItem = { msg_id: msg.id as number, placuta: msg.plate_detected as string }

      try {
        const placNorm = normalizePlate(msg.plate_detected as string)
        const vehicleMatch = (vehicles || []).find(v => {
          const vn = normalizePlate((v.nr_inmatriculare as string) || '')
          const cn = normalizePlate((v.cod_intern as string) || '')
          return vn === placNorm || cn === placNorm
        })

        if (!vehicleMatch) {
          result.notes = 'Vehicul nu exista in BD (skip)'
          await supabaseService.from('whatsapp_messages_processed')
            .update({ status: 'no_match' })
            .eq('id', msg.id as number)
          results.push(result)
          continue
        }
        result.vehicul_id = vehicleMatch.id as number

        const { base64, contentType } = await downloadPozaAsBase64(supabaseService, msg.photo_path as string)
        const visionRes = await callVision(anthropicKey, base64, contentType)
        totalTokensIn += visionRes.tokensIn
        totalTokensOut += visionRes.tokensOut

        const parsed = extractJson(visionRes.text)
        if (!parsed) {
          result.error = 'parse_failed'
          results.push(result)
          continue
        }

        result.cifre_extrase = parsed

        if (!parsed.is_bon || !parsed.cantitate_litri || !parsed.pret_total) {
          result.notes = `Vision: ${parsed.is_bon ? 'cifre lipsa' : 'NU e bon fiscal'} - ${parsed.notes || ''}`
          results.push(result)
          continue
        }

        const visionCarb = (parsed.tip_carburant as string || '').toLowerCase()
        const vehiculCarb = ((vehicleMatch.tip_carburant as string) || '').toLowerCase()
        if (visionCarb && vehiculCarb && visionCarb !== vehiculCarb) {
          result.notes = `Carburant mismatch: bon ${visionCarb} vs vehicul ${vehiculCarb} - SKIP (posibila frauda)`
          await supabaseService.from('whatsapp_messages_processed')
            .update({ status: 'no_match' })
            .eq('id', msg.id as number)
          results.push(result)
          continue
        }

        const dataAlim = (parsed.data as string) || (msg.msg_dt as string).slice(0, 10)
        const cantitate = Number(parsed.cantitate_litri)
        const pretTotal = Number(parsed.pret_total)

        // 5A. Check duplicate REAL pe ACELASI vehicul + data exacta
        const { data: dupCheck } = await supabaseService
          .from('logistica_alimentari')
          .select('id, cantitate_litri, pret_total')
          .eq('active_id', vehicleMatch.id as number)
          .eq('data_alimentare', dataAlim)
          .limit(5)

        const isDuplicate = (dupCheck || []).some(d =>
          Math.abs(Number(d.cantitate_litri) - cantitate) < 0.5
          && Math.abs(Number(d.pret_total) - pretTotal) < 1
        )
        if (isDuplicate) {
          result.notes = `Duplicat real (acelasi vehicul + data)`
          await supabaseService.from('whatsapp_messages_processed')
            .update({ status: 'no_match' })
            .eq('id', msg.id as number)
          results.push(result)
          continue
        }

        // 5B. NOU v3: Detect CARD SWAP - cifre identice pe ALT vehicul (factura Rompetrol fantoma)
        const dateMinus = new Date(new Date(dataAlim).getTime() - CARD_SWAP_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
        const datePlus = new Date(new Date(dataAlim).getTime() + CARD_SWAP_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)

        const { data: cardCheck } = await supabaseService
          .from('logistica_alimentari')
          .select('id, active_id, cantitate_litri, pret_total, data_alimentare, is_card_swap, active:logistica_active(nr_inmatriculare)')
          .gte('data_alimentare', dateMinus)
          .lte('data_alimentare', datePlus)
          .gte('cantitate_litri', cantitate - 0.5)
          .lte('cantitate_litri', cantitate + 0.5)
          .gte('pret_total', pretTotal - 1.5)
          .lte('pret_total', pretTotal + 1.5)
          .neq('active_id', vehicleMatch.id as number)
          .eq('is_card_swap', false)  // doar alimentari care nu sunt deja marcate
          .limit(3)

        let cardSwapPair: { id: number; placuta: string } | null = null
        if (cardCheck && cardCheck.length > 0) {
          const dup = cardCheck[0]
          const dupActive = dup.active as { nr_inmatriculare?: string } | undefined
          cardSwapPair = {
            id: dup.id as number,
            placuta: dupActive?.nr_inmatriculare || 'unknown'
          }
          result.card_swap_with = cardSwapPair.id
          result.card_swap_placuta = cardSwapPair.placuta
        }

        // 6. INSERT alimentare noua
        const brandStatie = (parsed.brand_statie as string) || 'Necunoscut'
        result.brand_statie = brandStatie

        const placutaFizica = msg.plate_detected as string

        const observatii = cardSwapPair
          ? `🔴 CARD SWAP detectat automat - Cardul de motorină al ${cardSwapPair.placuta} a fost folosit pentru alimentarea FIZICĂ a ${placutaFizica}.\nDovadă: foto WhatsApp ${msg.autor} (${(msg.msg_dt as string).slice(0,16)}).\nIMPLICAȚII ANAF: factura pe ${cardSwapPair.placuta} = alimentare FANTOMĂ. Vehicul fizic alimentat: ${placutaFizica}.\nPereche: alim #${cardSwapPair.id}.`
          : `⚠️ NECESITA CONFIRMARE MANUALA - Alimentare creata automat din poza WhatsApp orfana (${brandStatie}). Detectata placuta prin AI: ${placutaFizica}. Confidence Vision plate: ${msg.detection_confidence}. Cifre extrase prin Vision OCR cu confidence: ${parsed.confidence}.`

        const { data: newAlim, error: insErr } = await supabaseService
          .from('logistica_alimentari')
          .insert({
            active_id: vehicleMatch.id as number,
            data_alimentare: dataAlim,
            cantitate_litri: cantitate,
            pret_total: pretTotal,
            pret_per_litru: Number(parsed.pret_per_litru) || (pretTotal / cantitate),
            statie_combustibil: (parsed.statie as string) || `${brandStatie} (necunoscut)`,
            numar_factura: (parsed.numar_bon as string) || null,
            whatsapp_caption: cardSwapPair
              ? `[CARD SWAP - card ${cardSwapPair.placuta} folosit pentru alimentat ${placutaFizica}] ${brandStatie} | ${parsed.produs_brand || ''}`.slice(0, 200)
              : `[extract_external_bon v3] Brand: ${brandStatie} | ${parsed.produs_brand || ''}`.slice(0, 200),
            whatsapp_autor: msg.autor as string,
            whatsapp_msg_dt: msg.msg_dt as string,
            whatsapp_poza_path: msg.photo_path as string,
            sursa_alocare_santier: 'whatsapp_external_pending',
            ocr_status: 'pending',
            ocr_tip_dovada: cardSwapPair ? 'bon_external_ai_card_swap' : 'bon_external_ai',
            ocr_data: parsed,
            ocr_validated_at: new Date().toISOString(),
            is_card_swap: !!cardSwapPair,
            card_swap_with: cardSwapPair?.id || null,
            observatii,
          })
          .select('id')
          .single()

        if (insErr || !newAlim) {
          result.error = `INSERT failed: ${insErr?.message || 'unknown'}`
          results.push(result)
          continue
        }

        result.alim_created_id = newAlim.id as number

        // 6B. Daca e card swap: UPDATE si alimentarea fantoma (cea cu cardul) sa fie marcata
        if (cardSwapPair) {
          await supabaseService
            .from('logistica_alimentari')
            .update({
              is_card_swap: true,
              card_swap_with: newAlim.id as number,
              observatii: `🔴 CARD SWAP - Cardul ${cardSwapPair.placuta} folosit pentru alt vehicul fizic.\nAlimentarea FIZICĂ pe ${placutaFizica} - vezi alim #${newAlim.id}.\nDovadă: foto WhatsApp ${msg.autor}.\nIMPLICAȚII ANAF: acest record = alimentare card-FANTOMĂ. Vehicul ${cardSwapPair.placuta} NU a primit motorina.`
            })
            .eq('id', cardSwapPair.id)
        }

        // 7. Update mesaj WhatsApp
        await supabaseService.from('whatsapp_messages_processed')
          .update({
            status: 'matched',
            alimentare_id: newAlim.id as number
          })
          .eq('id', msg.id as number)

        results.push(result)
      } catch (e) {
        result.error = e instanceof Error ? e.message : 'unknown'
        console.error(`[extract-bon v3] FAIL msg #${msg.id}:`, result.error)
        results.push(result)
      }
    }

    const summary = {
      total: results.length,
      alim_created: results.filter(r => r.alim_created_id).length,
      card_swaps_detected: results.filter(r => r.card_swap_with).length,
      real_duplicates: results.filter(r => r.notes?.includes('Duplicat real')).length,
      carb_mismatch: results.filter(r => r.notes?.includes('Carburant mismatch')).length,
      not_bon: results.filter(r => r.notes?.includes('NU e bon')).length,
      errors: results.filter(r => r.error).length,
    }
    const costUsd = (totalTokensIn * MODEL_PRICING.input + totalTokensOut * MODEL_PRICING.output) / 1_000_000
    console.log(`[extract-bon v3] OK${isAdminBypass ? ' (admin)' : ''} | ${JSON.stringify(summary)} | $${costUsd.toFixed(5)}`)

    return new Response(JSON.stringify({
      success: true, summary, results,
      meta: { model: MODEL, version: 'v3', tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost_usd: Number(costUsd.toFixed(5)) },
    }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('[extract-bon v3] Unhandled:', e)
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }
})
