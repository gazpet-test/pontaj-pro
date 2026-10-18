// parse-pccvi-faze v4 (11.06.2026) — v3 + include si randurile cu participare ISC fara cod FD
// (ex. receptia la terminarea lucrarilor) — cerinta Razvan: orice convocare ISC intra in checklist
// 14.10.2026 (securitate etapa 2, grup C): adusă în repo. Scoasă calea x-internal-secret (fallback literal compromis,
// niciun consumator intern găsit). Poarta: JWT + owner SAU modulul 'executie' (singurul ecran care o apelează e /executie).
// Restul codului e identic cu v24. Revenire: supabase/functions_retrase/revenire_grupc/parse-pccvi-faze.v24.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { faraGandire } from '../_shared/gandire.ts'
import { costApel, modelParsare, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { userAutorizat } from './acces.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
// 18.10.2026: Haiku 4.5 → Haiku 5.5 (_shared/haiku55.ts) — gândire oprită explicit (pe 5.5 e pornită implicit), max_tokens
// 6000 → 7800 (tokenizer ~30% mai mare), cost pe prețul nou, textul doar din blocurile `text`, refuzul filtrului → 422 cu mesaj.
// PARSE_CONTRACT_MODEL se accepta doar din lista permisa; costul se calculeaza pe modelul ales.
const MODEL = modelParsare(Deno.env.get('PARSE_CONTRACT_MODEL'))
const MAX_PDF_MB = 10

const SYSTEM_PROMPT = `Esti expert in documentatie tehnica de constructii din Romania (conducte gaze, Transgaz).
PDF-ul este un PCCVI / ITP (Plan de Control Calitate, Verificari si Incercari / Plan de Inspectii si Testari).
Extrage DOUA categorii de randuri:
1. FAZELE DETERMINANTE (FD): coloana "Cod"/"FD" marcata FD / X / DA / *; mentiuni "faza determinanta"; documentul incheiat este PVCFD/PVFD.
2. CONVOCARILE ISC fara cod FD: randuri unde ISC / I.S.C. / Inspectoratul de Stat in Constructii apare ca PARTICIPANT (tipic: receptia la terminarea lucrarilor) — chiar daca au cod H/W/S. Pentru acestea adauga in stadiu_fizic mentiunea "(cod H — convocare ISC, nu FD)" sau codul real.
ATENTIE: tabelele PCCVI au multe randuri de verificari obisnuite (R/S/W fara ISC) — pe acelea NU le extrage.
Raspunde DOAR cu JSON valid (fara virgule dupa ultimul element, fara comentarii, fara text inainte sau dupa):
{
  "faze": [
    {"nr_faza": string sau null, "denumire": string max 250, "stadiu_fizic": string sau null, "participanti": string sau null}
  ],
  "are_faze_determinante": boolean,
  "confidence": 0-100
}
Daca documentul nu contine nici FD, nici convocari ISC, intoarce faze:[] si are_faze_determinante:false. Nu inventa.`

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  return btoa(binary)
}

function robustJsonParse(raw: string): any {
  let s = String(raw).replace(/```json|```/g, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  try { return JSON.parse(s) } catch (_) { /* incearca fara virgule finale */ }
  s = s.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(s)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: CORS })

    const { proiect_id, pdf_path } = await req.json()
    if (!proiect_id || !pdf_path) return new Response(JSON.stringify({ error: 'proiect_id si pdf_path obligatorii' }), { status: 400, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (!(await userAutorizat(req, supabaseAdmin, ['executie']))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })
    }

    const { data: pdfBlob, error: dlError } = await supabaseAdmin.storage.from('executie-contracte').download(pdf_path)
    if (dlError || !pdfBlob) return new Response(JSON.stringify({ error: `PDF download failed: ${dlError?.message}` }), { status: 404, headers: CORS })

    const arrayBuffer = await pdfBlob.arrayBuffer()
    const sizeMb = arrayBuffer.byteLength / 1024 / 1024
    if (sizeMb > MAX_PDF_MB) return new Response(JSON.stringify({ error: `PDF prea mare: ${sizeMb.toFixed(1)}MB (max ${MAX_PDF_MB}MB)` }), { status: 413, headers: CORS })

    const base64Pdf = arrayBufferToBase64(arrayBuffer)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 7800, thinking: faraGandire(MODEL), system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
          { type: 'text', text: 'Extrage fazele determinante ISC si convocarile ISC din acest PCCVI/ITP.' }
        ]}]
      })
    })
    if (!r.ok) {
      const err = await r.text()
      return new Response(JSON.stringify({ error: `Anthropic ${r.status}: ${err.slice(0, 300)}` }), { status: 502, headers: CORS })
    }

    const result = await r.json()
    if (result.stop_reason === 'max_tokens') return new Response(JSON.stringify({ error: 'Raspuns AI incomplet (max_tokens); reincearca' }), { status: 422, headers: CORS })
    const refuz = mesajRefuz(result)
    if (refuz) return new Response(JSON.stringify({ error: refuz }), { status: 422, headers: CORS })
    const raw = textRaspuns(result)
    if (!raw.trim()) return new Response(JSON.stringify({ error: 'Raspuns AI fara text' }), { status: 422, headers: CORS })

    try {
      const u = result.usage || {}
      await supabaseAdmin.from('ai_usage_log').insert({
        function_name: 'parse-pccvi-faze', model: MODEL,
        tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
        cost_usd: costApel(MODEL, u),
        ref_table: 'executie_proiecte', ref_id: proiect_id,
      })
    } catch (_) { /* nu blocheaza */ }

    let parsed: any
    try { parsed = robustJsonParse(raw) }
    catch (pe: any) {
      console.error('Parse failed. RAW:', raw.slice(0, 1000))
      return new Response(JSON.stringify({ error: 'Parse failed: ' + pe.message, raw_inceput: raw.slice(0, 400) }), { status: 500, headers: CORS })
    }

    const faze = (Array.isArray(parsed?.faze) ? parsed.faze : [])
      .filter((f: any) => f && f.denumire && String(f.denumire).trim())
      .map((f: any, i: number) => {
        const rawNr = f.nr_faza
        const numNr = Number(rawNr)
        const isInt = rawNr !== null && rawNr !== undefined && rawNr !== '' && Number.isInteger(numNr)
        const prefix = (!isInt && rawNr !== null && rawNr !== undefined && String(rawNr).trim() !== '') ? `[${String(rawNr).trim().slice(0, 12)}] ` : ''
        return {
          proiect_id,
          nr_faza: isInt ? numNr : (i + 1),
          denumire: (prefix + String(f.denumire).trim()).slice(0, 250),
          stadiu_fizic: f.stadiu_fizic ? String(f.stadiu_fizic).trim().slice(0, 300) : null,
          participanti: f.participanti ? String(f.participanti).trim().slice(0, 300) : null,
          status: 'neplanificata',
          sursa: 'ai_pccvi',
        }
      })

    if (faze.length === 0) return new Response(JSON.stringify({ error: 'AI nu a gasit faze; fazele existente raman neschimbate' }), { status: 422, headers: CORS })

    await supabaseAdmin.from('executie_faze_determinante')
      .delete().eq('proiect_id', proiect_id).eq('sursa', 'ai_pccvi').eq('status', 'neplanificata')

    if (faze.length > 0) {
      const { error: insError } = await supabaseAdmin.from('executie_faze_determinante').insert(faze)
      if (insError) return new Response(JSON.stringify({ error: 'DB insert failed: ' + insError.message }), { status: 500, headers: CORS })
    }

    const { count } = await supabaseAdmin.from('executie_faze_determinante')
      .select('id', { count: 'exact', head: true }).eq('proiect_id', proiect_id).neq('status', 'anulata')
    await supabaseAdmin.from('executie_proiecte').update({
      doc_itp_ai_faze_det: count || 0,
      doc_itp_ai_confidence: Math.round(Number(parsed.confidence) || 70),
      isc_faza_determinanta: (count || 0) > 0 || parsed.are_faze_determinante === true,
    }).eq('id', proiect_id)

    return new Response(JSON.stringify({ success: true, proiect_id, extrase: faze.length, total_faze: count || 0, confidence: parsed.confidence ?? 70 }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: CORS })
  }
})
