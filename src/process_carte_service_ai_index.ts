// ════════════════════════════════════════════════════════════════════════════
// Edge Function: process_carte_service_ai (Etapa 12 E1, 22.05.2026)
// ════════════════════════════════════════════════════════════════════════════
// Procesează batch de „cărți service" (XLSX parsate client-side) și încearcă
// match cu utilajele din BD pentru import fișe service istorice.
//
// Strategie cost-optim:
//   1. Match DETERMINISTIC pentru fiecare file (zero AI):
//      a. serie_sasiu exact match
//      b. nr_inmat exact (normalizat)
//      c. cod_intern exact
//      d. normalized_key în service_import_ai_mappings (cache)
//   2. Dacă deterministic ratează → AI (Haiku 4.5) cu tools
//   3. Auto-match cu cel mai mare scor (Razvan decision 22.05.2026):
//      - confidence >= 0.85 → matched + scrie cache
//      - confidence 0.5-0.85 → matched (NU scrie cache, nu propagăm greșeli)
//      - confidence < 0.5 → unmatched
//   4. Dedup smart: (activ_id, data_fisei, tip) → flag is_duplicate
//   5. Log în service_import_ai_log pentru debug + tuning
//
// Input: max 30 files/call (client face chunking pentru 100+)
// Concurrency: 5 files paralel cu Promise.all batching
// Tools AI:
//   - search_active_logistica(query)
//   - lookup_mapping_cache(text_raw)
// ════════════════════════════════════════════════════════════════════════════

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_FILES_PER_CALL = 30
const MAX_TOOL_ITERATIONS = 3
const CONCURRENCY = 5
const CACHE_WRITE_THRESHOLD = 0.85
const MATCH_THRESHOLD = 0.50

// Pentru vision: file-uri mai mari + concurrency mai mic (cost + timeout)
const MAX_VISION_FILES_PER_CALL = 10
const MAX_VISION_FILE_SIZE_BYTES = 5 * 1024 * 1024  // 5 MB
const VISION_CONCURRENCY = 3

// Pricing Haiku 4.5 (per 1M tokens): $1 input, $5 output (pentru match)
const PRICE_HAIKU_INPUT = 1.0
const PRICE_HAIKU_OUTPUT = 5.0

// Pricing Sonnet 4.5 (per 1M tokens): $3 input, $15 output (pentru vision)
const PRICE_SONNET_INPUT = 3.0
const PRICE_SONNET_OUTPUT = 15.0

// Legacy alias (compatibilitate cod existent)
const PRICE_PER_M_INPUT = PRICE_HAIKU_INPUT
const PRICE_PER_M_OUTPUT = PRICE_HAIKU_OUTPUT

// ─── SYSTEM PROMPT ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = [
  'Ești un asistent AI pentru import fișe service în Gazpet ERP (compania Gazpet Instal SRL).',
  '',
  'CONTEXT: Primești date dintr-un XLSX „Carte Service" cu antetul unui utilaj și sarcina ta e să-l identifici în baza de date.',
  '',
  'STRATEGIE:',
  '1. Cheamă tool `lookup_mapping_cache` cu denumirea completă din Excel. Dacă găsește în cache → returnează activ_id-ul direct.',
  '2. Dacă cache miss, cheamă `search_active_logistica` cu 1-3 variante de query:',
  '   - prima: marca + model (ex: "HITACHI ZX 210")',
  '   - a doua dacă nr_inmat există: doar nr_inmat normalizat (ex: "UT 2379")',
  '   - a treia dacă tot nu găsești: model + an',
  '3. Evaluează rezultatele și returnează decizia FINALĂ ca text JSON strict:',
  '   {"activ_id": <number>, "confidence": <0.0-1.0>, "reason": "<scurt>"}',
  '   SAU dacă nimic plauzibil:',
  '   {"activ_id": null, "confidence": 0, "reason": "<de ce nu>"}',
  '',
  'CRITICI:',
  '- NU INVENTA activ_id. Folosește DOAR id-uri returnate de tool.',
  '- confidence > 0.85 doar dacă serie_sasiu/nr_inmat/model se potrivesc clar.',
  '- confidence 0.5-0.85 pentru match plauzibil (typo/sinonim cunoscut).',
  '- confidence < 0.5 pentru match speculativ → consider unmatched.',
  '',
  'SINONIME ȘI TYPO-URI FRECVENTE:',
  '- STIL → STILL → LINDE (grup KION, motostivuitoare; activ id=88 e LINDE)',
  '- ATC → ATLAS COPCO',
  '- Mercedes / MB / Mercedes-Benz → MERCEDES BENZ în BD',
  '- VW → VOLKSWAGEN',
  '- LIEBHER → LIEBHERR (typo frecvent)',
  '- ATENȚIE conflict prefix nr_inmat vs marcă: "Mercedes AXOR PH 22 VEO" ≠ "PH 22 CZZ" (VW T5). VERIFICĂ ÎNTOTDEAUNA marca compatibilă.',
  '',
  'PATTERN UTILAJE FRECVENTE:',
  '- EXCAVATOR: CAT, DOOSAN, HITACHI, JCB, KOMATSU, LIEBHERR, SUNWARD',
  '- COMPRESOR: ATLAS COPCO, KAESER, INGERSOLL RAND, COMPAIR',
  '- PWT (Tractor sudură): CAT, LIEBHERR, FIAT ALLIS',
  '- POMPĂ: ZIEGLER, BBA, HATZ, CAPRARI, MILENIUM, ANTOR, WEDA',
  '- VOLA: AHLMANN, CAT',
  '- LANSATOR: LIEBHERR, CAT',
  '',
  'RĂSPUNSUL FINAL TREBUIE SĂ FIE EXCLUSIV JSON-UL — fără markdown, fără explicații.',
].join('\n')

// ─── TOOLS DEFINITION ───────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'lookup_mapping_cache',
    description: 'Caută în cache-ul de mapping-uri rezolvate anterior (service_import_ai_mappings). Returnează activ_id dacă există match exact sau prin normalized_key. ÎNCEPE ÎNTOTDEAUNA cu acest tool.',
    input_schema: {
      type: 'object',
      properties: {
        text_raw: { type: 'string', description: 'Denumirea completă din Excel (ex: "EXCAVATOR HITACHI ZX 210 LC UT 2379")' }
      },
      required: ['text_raw']
    }
  },
  {
    name: 'search_active_logistica',
    description: 'Caută utilaje active în BD prin fuzzy match pe denumire+model+marca+nr_inmat+cod_intern. Returnează top 5 rezultate cu detalii.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query fuzzy (ex: "hitachi zx 210" sau "UT 2379" sau "AXOR")' }
      },
      required: ['query']
    }
  }
]

// ─── HELPERS ────────────────────────────────────────────────────────────────
function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 200)
}

function normalizePlate(s: string | null | undefined): string {
  if (!s) return ''
  return s.toUpperCase().replace(/[\s\-_.]+/g, '').replace(/[^A-Z0-9]/g, '')
}

function normalizeSasiu(s: string | null | undefined): string {
  if (!s) return ''
  return s.toUpperCase().replace(/[\s\-_.]+/g, '').replace(/[^A-Z0-9]/g, '')
}

interface UtilajRaw {
  denumire?: string | null
  model?: string | null
  nr_inmat?: string | null
  serie_sasiu?: string | null
  cod_intern?: string | null
}

interface FileInput {
  file_id: string
  filename?: string
  // Mod 'parsed' (default, fast path) - client a parsat XLSX:
  utilaj_raw?: UtilajRaw
  interventii?: Array<{
    tip: 'mentenanta' | 'reparatie'
    data_fisei: string
    locatie?: string | null
    ore_intrare?: number | null
    km_intrare?: number | null
    urm_ore?: number | null
    urm_km?: number | null
    urm_data?: string | null
    piese?: Array<{ denumire: string; cantitate?: string | null }>
    obs?: string | null
    titlu?: string | null
  }>
  // Mod 'vision' (NOU 22.05.2026) - client a trimis PDF/poză raw:
  source_type?: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  source_data?: string  // base64 (fără prefix data:...;base64,)
}

interface VisionExtractResult {
  utilaj_raw: UtilajRaw
  interventii: NonNullable<FileInput['interventii']>
  vision_input_tokens: number
  vision_output_tokens: number
  vision_duration_ms: number
  vision_error?: string
}

interface MatchResult {
  activ_id: number | null
  asset_summary: {
    id: number
    marca: string | null
    model: string | null
    nr_inmatriculare: string | null
    cod_intern: string | null
    serie_sasiu: string | null
  } | null
  match_method: string
  match_confidence: number
  ai_messages?: unknown
  ai_tools_used?: string[]
  ai_iterations?: number
  input_tokens?: number
  output_tokens?: number
  duration_ms?: number
}

// ─── DETERMINISTIC MATCHING ─────────────────────────────────────────────────
async function tryDeterministicMatch(
  utilaj: UtilajRaw,
  supabase: ReturnType<typeof createClient>
): Promise<MatchResult | null> {
  // 1. serie_sasiu exact
  if (utilaj.serie_sasiu) {
    const normSasiu = normalizeSasiu(utilaj.serie_sasiu)
    if (normSasiu.length >= 6) {
      const { data } = await supabase
        .from('logistica_active')
        .select('id, marca, model, nr_inmatriculare, cod_intern, serie_sasiu')
        .ilike('serie_sasiu', `%${utilaj.serie_sasiu.trim()}%`)
        .eq('vandut', false)
        .limit(1)
      if (data && data.length === 1) {
        const a = data[0]
        return {
          activ_id: Number(a.id),
          asset_summary: {
            id: Number(a.id),
            marca: (a.marca as string) || null,
            model: (a.model as string) || null,
            nr_inmatriculare: (a.nr_inmatriculare as string) || null,
            cod_intern: (a.cod_intern as string) || null,
            serie_sasiu: (a.serie_sasiu as string) || null,
          },
          match_method: 'serie_sasiu',
          match_confidence: 1.0,
        }
      }
    }
  }
  
  // 2. nr_inmat normalizat
  if (utilaj.nr_inmat) {
    const normInmat = normalizePlate(utilaj.nr_inmat)
    if (normInmat.length >= 4) {
      const { data } = await supabase
        .from('logistica_active')
        .select('id, marca, model, nr_inmatriculare, cod_intern, serie_sasiu')
        .ilike('nr_inmatriculare', `%${utilaj.nr_inmat.trim()}%`)
        .eq('vandut', false)
        .limit(5)
      
      // Verific normalizat (ignorând spații)
      const matches = (data || []).filter((r: Record<string, unknown>) => 
        normalizePlate(r.nr_inmatriculare as string) === normInmat
      )
      if (matches.length === 1) {
        const a = matches[0]
        return {
          activ_id: Number(a.id),
          asset_summary: {
            id: Number(a.id),
            marca: (a.marca as string) || null,
            model: (a.model as string) || null,
            nr_inmatriculare: (a.nr_inmatriculare as string) || null,
            cod_intern: (a.cod_intern as string) || null,
            serie_sasiu: (a.serie_sasiu as string) || null,
          },
          match_method: 'nr_inmat',
          match_confidence: 1.0,
        }
      }
    }
  }
  
  // 3. cod_intern exact
  if (utilaj.cod_intern) {
    const cod = utilaj.cod_intern.trim().toUpperCase()
    if (cod.length >= 3) {
      const { data } = await supabase
        .from('logistica_active')
        .select('id, marca, model, nr_inmatriculare, cod_intern, serie_sasiu')
        .ilike('cod_intern', cod)
        .eq('vandut', false)
        .limit(1)
      if (data && data.length === 1) {
        const a = data[0]
        return {
          activ_id: Number(a.id),
          asset_summary: {
            id: Number(a.id),
            marca: (a.marca as string) || null,
            model: (a.model as string) || null,
            nr_inmatriculare: (a.nr_inmatriculare as string) || null,
            cod_intern: (a.cod_intern as string) || null,
            serie_sasiu: (a.serie_sasiu as string) || null,
          },
          match_method: 'cod_intern',
          match_confidence: 1.0,
        }
      }
    }
  }
  
  // 4. Cache lookup (normalized_key)
  const denumire = utilaj.denumire || ''
  if (denumire) {
    const normKey = normalizeKey(denumire)
    if (normKey.length >= 5) {
      const { data: cacheHit } = await supabase
        .from('service_import_ai_mappings')
        .select('id, activ_id, confidence, used_count')
        .eq('normalized_key', normKey)
        .limit(1)
      
      if (cacheHit && cacheHit.length > 0) {
        const hit = cacheHit[0]
        // Fetch asset details
        const { data: a } = await supabase
          .from('logistica_active')
          .select('id, marca, model, nr_inmatriculare, cod_intern, serie_sasiu')
          .eq('id', hit.activ_id)
          .eq('vandut', false)
          .limit(1)
          .maybeSingle()
        
        if (a) {
          // Increment used_count
          await supabase
            .from('service_import_ai_mappings')
            .update({ used_count: Number(hit.used_count || 0) + 1, updated_at: new Date().toISOString() })
            .eq('id', hit.id)
          
          return {
            activ_id: Number(a.id),
            asset_summary: {
              id: Number(a.id),
              marca: (a.marca as string) || null,
              model: (a.model as string) || null,
              nr_inmatriculare: (a.nr_inmatriculare as string) || null,
              cod_intern: (a.cod_intern as string) || null,
              serie_sasiu: (a.serie_sasiu as string) || null,
            },
            match_method: 'cache_hit',
            match_confidence: Number(hit.confidence || 0.8),
          }
        }
      }
    }
  }
  
  return null
}

// ─── TOOL EXECUTION ─────────────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>
): Promise<unknown> {
  try {
    if (toolName === 'lookup_mapping_cache') {
      const textRaw = String(toolInput.text_raw || '').trim()
      if (!textRaw) return { error: 'text_raw gol', found: false }
      const normKey = normalizeKey(textRaw)
      
      const { data, error } = await supabase
        .from('service_import_ai_mappings')
        .select('id, activ_id, confidence, marca_excel, marca_bd, source')
        .eq('normalized_key', normKey)
        .limit(1)
      
      if (error) return { error: error.message, found: false }
      if (!data || data.length === 0) return { found: false, normalized_key: normKey }
      
      // Fetch asset details
      const hit = data[0]
      const { data: a } = await supabase
        .from('logistica_active')
        .select('id, marca, model, nr_inmatriculare, cod_intern')
        .eq('id', hit.activ_id)
        .eq('vandut', false)
        .maybeSingle()
      
      return {
        found: true,
        activ_id: hit.activ_id,
        confidence: hit.confidence,
        source: hit.source,
        asset: a ? {
          id: a.id,
          marca: a.marca,
          model: a.model,
          nr_inmatriculare: a.nr_inmatriculare,
          cod_intern: a.cod_intern,
        } : null
      }
    }
    
    if (toolName === 'search_active_logistica') {
      const q = String(toolInput.query || '').trim()
      if (!q) return { error: 'query gol', count: 0, results: [] }
      
      const { data, error } = await supabase
        .from('logistica_active')
        .select('id, cod_intern, nr_inmatriculare, marca, model, serie_sasiu, an_fabricatie, categorie_id')
        .or(`nr_inmatriculare.ilike.%${q}%,marca.ilike.%${q}%,model.ilike.%${q}%,serie_sasiu.ilike.%${q}%,cod_intern.ilike.%${q}%`)
        .eq('vandut', false)
        .limit(8)
      
      if (error) return { error: error.message, count: 0, results: [] }
      
      return {
        count: data?.length || 0,
        results: (data || []).map((a: Record<string, unknown>) => ({
          id: a.id,
          marca: a.marca,
          model: a.model,
          nr_inmatriculare: a.nr_inmatriculare,
          cod_intern: a.cod_intern,
          serie_sasiu: a.serie_sasiu,
          an_fabricatie: a.an_fabricatie,
        }))
      }
    }
    
    return { error: `Tool necunoscut: ${toolName}` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown tool error' }
  }
}

// ─── AI MATCH (cu tool loop) ────────────────────────────────────────────────
async function tryAiMatch(
  utilaj: UtilajRaw,
  apiKey: string,
  supabase: ReturnType<typeof createClient>
): Promise<MatchResult> {
  const startTime = Date.now()
  
  const userMessage = JSON.stringify({
    utilaj_raw: {
      denumire: utilaj.denumire || null,
      model: utilaj.model || null,
      nr_inmat: utilaj.nr_inmat || null,
      serie_sasiu: utilaj.serie_sasiu || null,
      cod_intern: utilaj.cod_intern || null,
    },
    instructiune: 'Identifică acest utilaj în BD. Returnează JSON strict: {"activ_id": number|null, "confidence": 0-1, "reason": string}'
  })
  
  const messages: Array<Record<string, unknown>> = [
    { role: 'user', content: userMessage }
  ]
  
  let totalInput = 0
  let totalOutput = 0
  const toolsUsed: string[] = []
  let iterations = 0
  let finalText = ''
  
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    iterations = iter + 1
    
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: messages,
      }),
    })
    
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Anthropic ${resp.status}: ${errText.substring(0, 300)}`)
    }
    
    const data = await resp.json()
    totalInput += data.usage?.input_tokens || 0
    totalOutput += data.usage?.output_tokens || 0
    
    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content })
      
      const toolResults = []
      for (const block of data.content) {
        if (block.type === 'tool_use') {
          toolsUsed.push(block.name)
          const result = await executeTool(block.name, block.input, supabase)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          })
        }
      }
      
      messages.push({ role: 'user', content: toolResults })
      continue
    }
    
    // Final text response
    const textBlock = data.content?.find((b: { type: string, text?: string }) => b.type === 'text')
    finalText = textBlock?.text || ''
    break
  }
  
  // Parse JSON response
  let parsed: { activ_id: number | null; confidence: number; reason?: string } = {
    activ_id: null,
    confidence: 0,
    reason: 'parse_failed'
  }
  try {
    // Strip markdown code blocks dacă există
    const cleaned = finalText.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim()
    parsed = JSON.parse(cleaned)
  } catch (_e) {
    // Try regex extract
    const match = finalText.match(/\{[\s\S]*"activ_id"[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch (_e2) { /* keep default */ }
    }
  }
  
  const duration = Date.now() - startTime
  
  // Fetch asset details dacă avem activ_id
  let assetSummary = null
  if (parsed.activ_id) {
    const { data: a } = await supabase
      .from('logistica_active')
      .select('id, marca, model, nr_inmatriculare, cod_intern, serie_sasiu')
      .eq('id', parsed.activ_id)
      .eq('vandut', false)
      .maybeSingle()
    if (a) {
      assetSummary = {
        id: Number(a.id),
        marca: (a.marca as string) || null,
        model: (a.model as string) || null,
        nr_inmatriculare: (a.nr_inmatriculare as string) || null,
        cod_intern: (a.cod_intern as string) || null,
        serie_sasiu: (a.serie_sasiu as string) || null,
      }
    } else {
      // AI a returnat id invalid - tratează ca unmatched
      parsed.activ_id = null
      parsed.confidence = 0
      parsed.reason = (parsed.reason || '') + ' [id invalid, asset nu există]'
    }
  }
  
  return {
    activ_id: parsed.activ_id,
    asset_summary: assetSummary,
    match_method: parsed.activ_id ? 'ai_resolved' : 'unmatched',
    match_confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
    ai_messages: messages,
    ai_tools_used: toolsUsed,
    ai_iterations: iterations,
    input_tokens: totalInput,
    output_tokens: totalOutput,
    duration_ms: duration,
  }
}

// ─── VISION EXTRACT (PDF/imagine → utilaj_raw + interventii) ────────────────
// Folosește Claude Sonnet 4.5 cu vision pentru cărți service vechi scanate.
// Cost: ~$0.02-0.05 per fișier (vs ~$0.005 Haiku match)
const VISION_SYSTEM_PROMPT = [
  'Ești un asistent AI pentru extragere date din „cărți service" utilaje (carnete istorice de mentenanță).',
  '',
  'PRIMEȘTI: o pagină scanată (PDF sau poză) cu informații despre un utilaj și intervențiile de service.',
  '',
  'EXTRAGI strict următoarele:',
  '1. ANTET UTILAJ:',
  '   - denumire: descrierea completă (ex: "EXCAVATOR HITACHI ZX 210 LC - 6 2020 UT 2379")',
  '   - model: model exact (ex: "ZX 210 LC-6")',
  '   - nr_inmat: număr de înmatriculare sau cod (ex: "UT 2379", "B 12 ABC")',
  '   - serie_sasiu: serie șasiu / VIN dacă apare',
  '   - cod_intern: cod intern Gazpet dacă apare (TST..., GZP...)',
  '',
  '2. LISTA INTERVENȚIILOR (fiecare rând în tabel):',
  '   - tip: "mentenanta" sau "reparatie" (deduci din context: schimb piese de uzură = mentenanță; defect/avarie = reparație)',
  '   - data_fisei: data intervenției în format YYYY-MM-DD',
  '   - locatie: locul service-ului dacă e specificat',
  '   - ore_intrare: ore funcționare la intrare (dacă e utilaj cu ore)',
  '   - km_intrare: km la intrare (dacă e vehicul cu km)',
  '   - urm_ore: ore la următoarea revizie',
  '   - urm_km: km la următoarea revizie',
  '   - urm_data: data următoare YYYY-MM-DD',
  '   - piese: array de {denumire, cantitate} pentru piesele schimbate',
  '   - obs: observații / diagnostic',
  '   - titlu: titlu scurt al intervenției (ex: "Schimb ulei + filtre 500h")',
  '',
  'REGULI STRICTE:',
  '- Returnează DOAR JSON valid, fără markdown, fără explicații text.',
  '- Folosește null pentru valori care nu apar în document. NU INVENTA.',
  '- Datele: format YYYY-MM-DD strict. Dacă apare "12.05.2024" → "2024-05-12".',
  '- Cantități în piese: păstrează exact ("1buc", "5L", "2.5 kg").',
  '- Dacă documentul nu pare a fi o carte service de utilaj, returnează: {"error": "not_a_service_book", "denumire": null, "interventii": []}',
  '',
  'STRUCTURA JSON DE OUTPUT:',
  '{',
  '  "utilaj_raw": {',
  '    "denumire": "...", "model": "...", "nr_inmat": "...", "serie_sasiu": null, "cod_intern": null',
  '  },',
  '  "interventii": [',
  '    {"tip": "mentenanta", "data_fisei": "2024-05-12", "locatie": "...", "ore_intrare": 1200, "km_intrare": null, "urm_ore": 1500, "urm_km": null, "urm_data": "2024-08-12", "piese": [{"denumire": "Filtru ulei", "cantitate": "1buc"}], "obs": "...", "titlu": "Schimb ulei 1200h"}',
  '  ]',
  '}',
].join('\n')

async function extractFromVision(
  file: FileInput,
  apiKey: string
): Promise<VisionExtractResult> {
  const startTime = Date.now()
  
  if (!file.source_type || !file.source_data) {
    return {
      utilaj_raw: { denumire: file.filename || 'unknown' },
      interventii: [],
      vision_input_tokens: 0,
      vision_output_tokens: 0,
      vision_duration_ms: 0,
      vision_error: 'source_type sau source_data lipsesc',
    }
  }
  
  // Verific size base64 (estimare: base64 = ~33% mai mult decât original)
  const estimatedBytes = (file.source_data.length * 3) / 4
  if (estimatedBytes > MAX_VISION_FILE_SIZE_BYTES) {
    return {
      utilaj_raw: { denumire: file.filename || 'unknown' },
      interventii: [],
      vision_input_tokens: 0,
      vision_output_tokens: 0,
      vision_duration_ms: 0,
      vision_error: `Fișier prea mare (${Math.round(estimatedBytes / 1024 / 1024)}MB > 5MB limit)`,
    }
  }
  
  // Construiesc content block: pentru PDF folosesc 'document', pentru imagini 'image'
  const isPdf = file.source_type === 'application/pdf'
  const contentBlock = isPdf
    ? {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: file.source_data,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.source_type,
          data: file.source_data,
        },
      }
  
  const messages = [
    {
      role: 'user',
      content: [
        contentBlock,
        {
          type: 'text',
          text: `Extrage datele din această carte service. Filename: ${file.filename || 'unknown'}. Returnează DOAR JSON-ul structurat.`,
        },
      ],
    },
  ]
  
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',  // Sonnet 4.5 - precis la vision
        max_tokens: 4096,
        system: VISION_SYSTEM_PROMPT,
        messages,
      }),
    })
    
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Vision API ${resp.status}: ${errText.substring(0, 300)}`)
    }
    
    const data = await resp.json()
    const inputTokens = data.usage?.input_tokens || 0
    const outputTokens = data.usage?.output_tokens || 0
    
    const textBlock = data.content?.find((b: { type: string, text?: string }) => b.type === 'text')
    let finalText = textBlock?.text || ''
    
    // Strip markdown code blocks dacă există
    finalText = finalText.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim()
    
    let parsed: { utilaj_raw?: UtilajRaw; interventii?: NonNullable<FileInput['interventii']>; error?: string }
    try {
      parsed = JSON.parse(finalText)
    } catch (_e) {
      const m = finalText.match(/\{[\s\S]*\}/)
      if (m) {
        try { parsed = JSON.parse(m[0]) }
        catch (_e2) { 
          throw new Error('Vision a returnat text invalid (nu JSON): ' + finalText.substring(0, 200))
        }
      } else {
        throw new Error('Vision a returnat text fără JSON: ' + finalText.substring(0, 200))
      }
    }
    
    if (parsed.error === 'not_a_service_book') {
      return {
        utilaj_raw: { denumire: file.filename || 'unknown' },
        interventii: [],
        vision_input_tokens: inputTokens,
        vision_output_tokens: outputTokens,
        vision_duration_ms: Date.now() - startTime,
        vision_error: 'Documentul nu pare a fi o carte service de utilaj',
      }
    }
    
    return {
      utilaj_raw: parsed.utilaj_raw || { denumire: file.filename || 'unknown' },
      interventii: Array.isArray(parsed.interventii) ? parsed.interventii : [],
      vision_input_tokens: inputTokens,
      vision_output_tokens: outputTokens,
      vision_duration_ms: Date.now() - startTime,
    }
    
  } catch (e) {
    return {
      utilaj_raw: { denumire: file.filename || 'unknown' },
      interventii: [],
      vision_input_tokens: 0,
      vision_output_tokens: 0,
      vision_duration_ms: Date.now() - startTime,
      vision_error: e instanceof Error ? e.message : 'Unknown vision error',
    }
  }
}

// ─── DEDUP CHECK ────────────────────────────────────────────────────────────
async function markDuplicates(
  activId: number,
  interventii: NonNullable<FileInput['interventii']>,
  supabase: ReturnType<typeof createClient>
): Promise<boolean[]> {
  if (!activId || interventii.length === 0) return interventii.map(() => false)
  
  // Fetch toate fișele existente pentru acest activ
  const { data: existing } = await supabase
    .from('logistica_service_fise')
    .select('data_fisei, tip')
    .eq('activ_id', activId)
  
  const existingSet = new Set(
    (existing || []).map(e => `${e.data_fisei}__${e.tip}`)
  )
  
  return interventii.map(i => existingSet.has(`${i.data_fisei}__${i.tip}`))
}

// ─── CACHE WRITE ────────────────────────────────────────────────────────────
async function writeCacheMapping(
  utilaj: UtilajRaw,
  activId: number,
  confidence: number,
  userId: string,
  supabase: ReturnType<typeof createClient>
) {
  const denumire = utilaj.denumire || ''
  if (!denumire) return
  const normKey = normalizeKey(denumire)
  if (normKey.length < 5) return
  
  // Fetch marca BD pentru cross-reference
  const { data: asset } = await supabase
    .from('logistica_active')
    .select('marca')
    .eq('id', activId)
    .maybeSingle()
  
  // Extract marca din Excel (primul cuvânt sau primele 2)
  const denumireParts = denumire.trim().split(/\s+/)
  const marcaExcel = denumireParts.slice(0, 2).join(' ').substring(0, 80)
  
  await supabase
    .from('service_import_ai_mappings')
    .upsert({
      text_raw: denumire.substring(0, 300),
      normalized_key: normKey,
      activ_id: activId,
      marca_excel: marcaExcel,
      marca_bd: (asset?.marca as string) || null,
      source: 'ai_resolved',
      confidence: Math.min(1, confidence),
      created_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'normalized_key', ignoreDuplicates: false })
}

// ─── LOG WRITE ──────────────────────────────────────────────────────────────
async function writeLog(
  entry: {
    request_id: string
    file_id: string
    utilaj_raw: UtilajRaw
    match: MatchResult
    fise_count: number
    is_duplicate_count: number
    user_id: string
    mode?: 'parsed' | 'vision'
    vision_input_tokens?: number
    vision_output_tokens?: number
    vision_duration_ms?: number
    vision_error?: string
  },
  supabase: ReturnType<typeof createClient>
) {
  try {
    await supabase.from('service_import_ai_log').insert({
      request_id: entry.request_id,
      file_id: entry.file_id,
      utilaj_raw: entry.utilaj_raw,
      match_method: entry.match.match_method,
      match_confidence: entry.match.match_confidence,
      matched_activ_id: entry.match.activ_id,
      ai_called: entry.match.match_method === 'ai_resolved' || entry.match.match_method === 'unmatched',
      ai_messages: entry.match.ai_messages || null,
      ai_tools_used: entry.match.ai_tools_used || null,
      ai_iterations: entry.match.ai_iterations || 0,
      input_tokens: entry.match.input_tokens || 0,
      output_tokens: entry.match.output_tokens || 0,
      duration_ms: entry.match.duration_ms || null,
      fise_count: entry.fise_count,
      is_duplicate_count: entry.is_duplicate_count,
      created_by: entry.user_id,
      // Vision fields (Etapa 12 E1.5)
      mode: entry.mode || 'parsed',
      vision_input_tokens: entry.vision_input_tokens || 0,
      vision_output_tokens: entry.vision_output_tokens || 0,
      vision_duration_ms: entry.vision_duration_ms || null,
      vision_error: entry.vision_error || null,
    })
  } catch (e) {
    console.error('[process_carte_service_ai] Log write failed:', e)
  }
}

// ─── PROCESS SINGLE FILE ────────────────────────────────────────────────────
async function processFile(
  file: FileInput,
  requestId: string,
  userId: string,
  apiKey: string,
  supabase: ReturnType<typeof createClient>
) {
  // Detect mode: vision (source_data prezent) sau parsed (utilaj_raw + interventii)
  const isVisionMode = !!(file.source_data && file.source_type)
  
  let utilaj: UtilajRaw
  let interventii: NonNullable<FileInput['interventii']>
  let visionExtract: VisionExtractResult | null = null
  
  if (isVisionMode) {
    // VISION MODE: AI Sonnet extrage utilaj + interventii din PDF/imagine
    visionExtract = await extractFromVision(file, apiKey)
    utilaj = visionExtract.utilaj_raw
    interventii = visionExtract.interventii
    
    // Dacă vision a eșuat sau n-a extras nimic util → unmatched fără AI match
    if (visionExtract.vision_error || !utilaj.denumire) {
      const errMatch: MatchResult = {
        activ_id: null,
        asset_summary: null,
        match_method: 'unmatched',
        match_confidence: 0,
        ai_iterations: 0,
        input_tokens: visionExtract.vision_input_tokens,
        output_tokens: visionExtract.vision_output_tokens,
        duration_ms: visionExtract.vision_duration_ms,
      }
      
      writeLog({
        request_id: requestId,
        file_id: file.file_id,
        utilaj_raw: utilaj,
        match: errMatch,
        fise_count: 0,
        is_duplicate_count: 0,
        user_id: userId,
        mode: 'vision',
        vision_input_tokens: visionExtract.vision_input_tokens,
        vision_output_tokens: visionExtract.vision_output_tokens,
        vision_duration_ms: visionExtract.vision_duration_ms,
        vision_error: visionExtract.vision_error,
      }, supabase).catch(e => console.error('[log] async write failed:', e))
      
      return {
        file_id: file.file_id,
        filename: file.filename || null,
        utilaj_raw: utilaj,
        status: 'unmatched' as const,
        activ_id: null,
        asset_summary: null,
        match_method: 'unmatched',
        match_confidence: 0,
        cache_written: false,
        mode: 'vision',
        vision_error: visionExtract.vision_error || 'denumire nu a putut fi extrasă',
        fise: [],
        stats: {
          total_fise: 0,
          duplicate_count: 0,
          ai_called: true,
          mode: 'vision',
          vision_input_tokens: visionExtract.vision_input_tokens,
          vision_output_tokens: visionExtract.vision_output_tokens,
          vision_duration_ms: visionExtract.vision_duration_ms,
          input_tokens: 0,
          output_tokens: 0,
          duration_ms: 0,
        }
      }
    }
  } else {
    // PARSED MODE (default): client a trimis JSON structurat
    utilaj = file.utilaj_raw || {}
    interventii = file.interventii || []
  }
  
  // ── De aici flow identic pentru ambele moduri ──
  
  // 1. Deterministic match
  let match = await tryDeterministicMatch(utilaj, supabase)
  
  // 2. AI fallback dacă e nevoie (Haiku pentru match)
  if (!match) {
    try {
      match = await tryAiMatch(utilaj, apiKey, supabase)
    } catch (e) {
      console.error(`[process_carte_service_ai] AI match failed for file ${file.file_id}:`, e)
      match = {
        activ_id: null,
        asset_summary: null,
        match_method: 'unmatched',
        match_confidence: 0,
        ai_iterations: 0,
        input_tokens: 0,
        output_tokens: 0,
      }
    }
  }
  
  // 3. Apply auto-match threshold
  const isMatched = match.activ_id !== null && match.match_confidence >= MATCH_THRESHOLD
  
  // 4. Dedup check pentru matched
  let duplicateFlags: boolean[] = interventii.map(() => false)
  if (isMatched && match.activ_id) {
    duplicateFlags = await markDuplicates(match.activ_id, interventii, supabase)
  }
  const duplicateCount = duplicateFlags.filter(d => d).length
  
  // 5. Cache write pentru high-confidence
  if (isMatched && 
      match.activ_id && 
      match.match_confidence >= CACHE_WRITE_THRESHOLD && 
      (match.match_method === 'ai_resolved')) {
    await writeCacheMapping(utilaj, match.activ_id, match.match_confidence, userId, supabase)
  }
  
  // 6. Build fise output (cu duplicate flags)
  const fise = interventii.map((i, idx) => ({
    activ_id: isMatched ? match!.activ_id : null,
    data_fisei: i.data_fisei,
    tip: i.tip,
    status: 'finalizat' as const,
    titlu: i.titlu || `${i.tip === 'mentenanta' ? 'Mentenanță' : 'Reparație'} ${i.data_fisei}`,
    locatie_service: i.locatie || null,
    ore_intrare: i.ore_intrare ?? null,
    ore_iesire: i.urm_ore ?? null,
    km_intrare: i.km_intrare ?? null,
    km_iesire: null,
    urmatoarea_ore: i.urm_ore ?? null,
    urmatoarea_km: i.urm_km ?? null,
    urmatoarea_data: i.urm_data || null,
    diagnostic_lucrari: (i.piese && i.piese.length > 0)
      ? 'Piese:\n' + i.piese.map(p => `- ${p.denumire}${p.cantitate ? ` (${p.cantitate})` : ''}`).join('\n')
      : null,
    observatii: i.obs || null,
    finalizat_at: i.data_fisei + 'T12:00:00Z',
    is_duplicate: duplicateFlags[idx],
  }))
  
  // 7. Log async (nu bloca răspunsul)
  writeLog({
    request_id: requestId,
    file_id: file.file_id,
    utilaj_raw: utilaj,
    match: match!,
    fise_count: interventii.length,
    is_duplicate_count: duplicateCount,
    user_id: userId,
    mode: isVisionMode ? 'vision' : 'parsed',
    vision_input_tokens: visionExtract?.vision_input_tokens || 0,
    vision_output_tokens: visionExtract?.vision_output_tokens || 0,
    vision_duration_ms: visionExtract?.vision_duration_ms,
  }, supabase).catch(e => console.error('[log] async write failed:', e))
  
  return {
    file_id: file.file_id,
    filename: file.filename || null,
    utilaj_raw: utilaj,
    status: isMatched ? 'matched' as const : 'unmatched' as const,
    activ_id: isMatched ? match!.activ_id : null,
    asset_summary: isMatched ? match!.asset_summary : null,
    match_method: match!.match_method,
    match_confidence: match!.match_confidence,
    cache_written: isMatched && match!.match_confidence >= CACHE_WRITE_THRESHOLD && match!.match_method === 'ai_resolved',
    mode: isVisionMode ? 'vision' : 'parsed',
    fise,
    stats: {
      total_fise: interventii.length,
      duplicate_count: duplicateCount,
      ai_called: match!.match_method === 'ai_resolved' || match!.match_method === 'unmatched',
      mode: isVisionMode ? 'vision' : 'parsed',
      vision_input_tokens: visionExtract?.vision_input_tokens || 0,
      vision_output_tokens: visionExtract?.vision_output_tokens || 0,
      vision_duration_ms: visionExtract?.vision_duration_ms || 0,
      input_tokens: match!.input_tokens || 0,
      output_tokens: match!.output_tokens || 0,
      duration_ms: match!.duration_ms || 0,
    }
  }
}

// ─── CONCURRENT BATCH ──────────────────────────────────────────────────────
async function processBatch<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  
  async function runWorker() {
    while (true) {
      const i = idx++
      if (i >= items.length) return
      try {
        results[i] = await worker(items[i])
      } catch (e) {
        console.error(`[batch] Worker error at index ${i}:`, e)
        results[i] = { error: e instanceof Error ? e.message : 'unknown' } as unknown as R
      }
    }
  }
  
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  )
  
  return results
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  
  const startTime = Date.now()
  
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    })
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey)
    
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid auth token' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    // Parse body
    let body: { files?: FileInput[]; request_id?: string }
    try { body = await req.json() }
    catch (_e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    const files = Array.isArray(body.files) ? body.files : []
    if (files.length === 0) {
      return new Response(JSON.stringify({ error: 'files array required and non-empty' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    if (files.length > MAX_FILES_PER_CALL) {
      return new Response(JSON.stringify({ 
        error: `Too many files. Max ${MAX_FILES_PER_CALL} per call. Use client-side chunking.` 
      }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    const requestId = body.request_id || crypto.randomUUID()
    
    // Validate each file (acceptă fie utilaj_raw+interventii fie source_data)
    let visionFileCount = 0
    for (const f of files) {
      if (!f.file_id || typeof f.file_id !== 'string') {
        return new Response(JSON.stringify({ error: 'each file must have file_id (string)' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
      
      const hasParsed = f.utilaj_raw && typeof f.utilaj_raw === 'object' && Array.isArray(f.interventii)
      const hasVision = f.source_data && typeof f.source_data === 'string' && f.source_type
      
      if (!hasParsed && !hasVision) {
        return new Response(JSON.stringify({ 
          error: `file ${f.file_id}: trebuie să aibă fie (utilaj_raw + interventii) fie (source_type + source_data)` 
        }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
      
      if (hasVision) {
        visionFileCount++
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
        if (!validTypes.includes(f.source_type as string)) {
          return new Response(JSON.stringify({ 
            error: `file ${f.file_id}: source_type invalid. Acceptate: ${validTypes.join(', ')}` 
          }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
        }
      }
    }
    
    // Vision are limită mai mică (cost + timeout)
    if (visionFileCount > MAX_VISION_FILES_PER_CALL) {
      return new Response(JSON.stringify({ 
        error: `Prea multe fișiere vision (${visionFileCount}). Max ${MAX_VISION_FILES_PER_CALL} per call. Folosește chunking client-side.` 
      }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }
    
    console.log(`[process_carte_service_ai] START req=${requestId} user=${user.email} files=${files.length} (vision=${visionFileCount})`)
    
    // Concurrency adaptiv: vision files au limit mai jos
    const effectiveConcurrency = visionFileCount > 0 ? VISION_CONCURRENCY : CONCURRENCY
    
    // Process with concurrency
    const results = await processBatch(
      files,
      (f) => processFile(f, requestId, user.id, apiKey, supabaseService),
      effectiveConcurrency
    )
    
    // Aggregate stats
    const totalVisionInput = results.reduce((sum, r) => sum + (r.stats?.vision_input_tokens || 0), 0)
    const totalVisionOutput = results.reduce((sum, r) => sum + (r.stats?.vision_output_tokens || 0), 0)
    const totalMatchInput = results.reduce((sum, r) => sum + (r.stats?.input_tokens || 0), 0)
    const totalMatchOutput = results.reduce((sum, r) => sum + (r.stats?.output_tokens || 0), 0)
    
    const stats = {
      request_id: requestId,
      total_files: files.length,
      vision_files: visionFileCount,
      parsed_files: files.length - visionFileCount,
      matched_count: results.filter(r => r.status === 'matched').length,
      unmatched_count: results.filter(r => r.status === 'unmatched').length,
      total_fise: results.reduce((sum, r) => sum + (r.stats?.total_fise || 0), 0),
      total_duplicates: results.reduce((sum, r) => sum + (r.stats?.duplicate_count || 0), 0),
      cache_hits: results.filter(r => r.match_method === 'cache_hit').length,
      deterministic_hits: results.filter(r => 
        r.match_method === 'serie_sasiu' || r.match_method === 'nr_inmat' || r.match_method === 'cod_intern'
      ).length,
      ai_calls: results.filter(r => r.stats?.ai_called).length,
      cache_writes: results.filter(r => r.cache_written).length,
      // Tokens separate
      vision_input_tokens: totalVisionInput,
      vision_output_tokens: totalVisionOutput,
      match_input_tokens: totalMatchInput,
      match_output_tokens: totalMatchOutput,
      // Backward compat (legacy field, suma tot)
      total_input_tokens: totalVisionInput + totalMatchInput,
      total_output_tokens: totalVisionOutput + totalMatchOutput,
      // Cost split
      cost_vision_usd: 
        (totalVisionInput / 1_000_000) * PRICE_SONNET_INPUT +
        (totalVisionOutput / 1_000_000) * PRICE_SONNET_OUTPUT,
      cost_match_usd:
        (totalMatchInput / 1_000_000) * PRICE_HAIKU_INPUT +
        (totalMatchOutput / 1_000_000) * PRICE_HAIKU_OUTPUT,
      estimated_cost_usd: 0,  // Computed below
      total_duration_ms: Date.now() - startTime,
    }
    
    stats.estimated_cost_usd = stats.cost_vision_usd + stats.cost_match_usd
    
    console.log(`[process_carte_service_ai] DONE req=${requestId} matched=${stats.matched_count}/${stats.total_files} vision=${visionFileCount} ai_match=${stats.ai_calls} cost=$${stats.estimated_cost_usd.toFixed(4)} (vision=$${stats.cost_vision_usd.toFixed(4)} match=$${stats.cost_match_usd.toFixed(4)}) duration=${stats.total_duration_ms}ms`)
    
    return new Response(JSON.stringify({
      request_id: requestId,
      results,
      stats,
    }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    
  } catch (e) {
    console.error('[process_carte_service_ai] Unhandled:', e)
    const errMsg = e instanceof Error ? e.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
