// ocr-packing-list v1 (20.06.2026) — extrage bucati materiale conducta din packing list / aviz / MTC scanat.
// Pattern identic parse-anexa-pdf. NU insereaza in BD — returneaza la UI pentru validare manuala (om confirma -> magazie_bucati).
// 14.10.2026 (securitate etapa 2, grup C): adusă în repo. Scoasă calea x-internal-secret (fallback literal compromis,
// niciun consumator intern găsit). Bucket-ul e FIX 'packing-lists' (singurul trimis de UI, ReceptieBucatiModal) — înainte
// venea din body și se putea citi orice fișier din orice bucket. Poarta pe profil rămâne identică (owner /
// can_process_achizitii / admin_logistica). Revenire: supabase/functions_retrase/revenire_grupc/ocr-packing-list.v21.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { faraGandire } from '../_shared/gandire.ts'
import { costApel, modelParsare, jsonDinText, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
// 18.10.2026: Haiku 4.5 → Haiku 5.5 (_shared/haiku55.ts) — gândire oprită explicit (pe 5.5 e pornită implicit), max_tokens
// 8000 → 10400 (tokenizer ~30% mai mare), cost pe prețul nou, textul doar din blocurile `text`, refuzul filtrului → 422 cu mesaj.
// PARSE_CONTRACT_MODEL se accepta doar din lista permisa; costul se calculeaza pe modelul ales.
const MODEL = modelParsare(Deno.env.get('PARSE_CONTRACT_MODEL'))
const MAX_MB = 15
const BUCKET = 'packing-lists'

const TIPURI = ['teava','tub_protectie','curba','teu','weldolet','flansa','flansa_oarba','capac_bombat','prezoane','piulite','robinet','fitinguri','imbinare_electroizolanta','godevil','altele']

const SYSTEM_PROMPT = `Esti asistent extragere date din PACKING LIST / AVIZE DE INSOTIRE / MTC pentru materiale de conducta gaz (Gazpet Instal SRL).
Documentul (poate fi scanat) contine o lista de materiale livrate de un furnizor: tevi, curbe, fitinguri, robinete, flanse, weldoleti etc., cu serii, sarje (heat number), dimensiuni, lungimi, cantitati.
Extrage TOATE liniile si raspunde DOAR cu JSON valid, fara text in jur:
{
  "header": {
    "furnizor": string|null,
    "producator": string|null,
    "nr_document": string|null,
    "data": "YYYY-MM-DD"|null,
    "standard": string|null,
    "grad_otel": string|null
  },
  "linii": [
    {
      "tip_material": unul din [${TIPURI.join(', ')}],
      "serie": string|null,
      "sarja": string|null,
      "dimensiune": string|null,
      "lungime_m": numar|null,
      "cantitate": numar,
      "greutate_kg": numar|null,
      "unghi_curba": numar|null,
      "grad_otel": string|null,
      "standard": string|null
    }
  ],
  "confidence": 0-100
}
Reguli: numere fara separatori de mii, zecimale cu punct. FIECARE teava/bucata cu serie proprie = o linie separata (NU grupa). Pentru curbe pune unghi_curba daca apare (45, 90 etc). dimensiune = diametru x perete (ex 508x8.0). Ignora randuri de TOTAL/subtotal. NU inventa date — daca un camp lipseste, null. DOAR JSON.`

function abToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  return btoa(binary)
}
function mediaType(path: string): string {
  const p = path.toLowerCase()
  if (p.endsWith('.pdf')) return 'application/pdf'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: CORS })

    const body = await req.json()
    const path = body.path || body.pdf_path
    const comanda_id = body.comanda_id ?? null
    if (!path) return new Response(JSON.stringify({ error: 'path obligatoriu' }), { status: 400, headers: CORS })
    if (body.bucket && body.bucket !== BUCKET) return new Response(JSON.stringify({ error: `bucket nepermis (doar ${BUCKET})` }), { status: 400, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // autorizare: Bearer + profil (achizitii/owner/admin_logistica)
    const authHeader = req.headers.get('Authorization') || ''
    let authorized = false
    if (authHeader.startsWith('Bearer ')) {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await supabaseUser.auth.getUser()
      if (user) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('is_owner, can_process_achizitii, role').eq('id', user.id).single()
        if (profile?.is_owner || profile?.can_process_achizitii || profile?.role === 'admin_logistica') authorized = true
      }
    }
    if (!authorized) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS })

    const { data: blob, error: dlError } = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (dlError || !blob) return new Response(JSON.stringify({ error: `Download failed: ${dlError?.message}` }), { status: 404, headers: CORS })

    const arrayBuffer = await blob.arrayBuffer()
    const sizeMb = arrayBuffer.byteLength / 1024 / 1024
    if (sizeMb > MAX_MB) return new Response(JSON.stringify({ error: `Fisier prea mare: ${sizeMb.toFixed(1)}MB (max ${MAX_MB}MB).` }), { status: 413, headers: CORS })

    const b64 = abToBase64(arrayBuffer)
    const mt = mediaType(path)
    const contentBlock = mt === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 10400, thinking: faraGandire(MODEL), system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [ contentBlock, { type: 'text', text: 'Extrage toate liniile din acest document de livrare.' } ] }]
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
        function_name: 'ocr-packing-list', model: MODEL,
        tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0,
        cost_usd: costApel(MODEL, u),
        ref_table: 'comenzi_furnizor', ref_id: comanda_id,
      })
    } catch (_) { /* nu blocheaza */ }

    // deno-lint-ignore no-explicit-any
    const parsed: any = jsonDinText(raw)
    if (!parsed) return new Response(JSON.stringify({ error: 'Parse failed', raw: raw.slice(0, 400) }), { status: 500, headers: CORS })

    const toNum = (v: any) => {
      if (v === null || v === undefined || v === '') return null
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
      return isFinite(n) ? n : null
    }
    const liniiRaw = Array.isArray(parsed.linii) ? parsed.linii : []
    const linii = liniiRaw.map((l: any) => ({
      tip_material: TIPURI.includes(l.tip_material) ? l.tip_material : 'altele',
      serie: l.serie ? String(l.serie).trim().slice(0, 80) : null,
      sarja: l.sarja ? String(l.sarja).trim().slice(0, 80) : null,
      dimensiune: l.dimensiune ? String(l.dimensiune).trim().slice(0, 60) : null,
      lungime_m: toNum(l.lungime_m),
      cantitate: toNum(l.cantitate) ?? 1,
      greutate_kg: toNum(l.greutate_kg),
      unghi_curba: toNum(l.unghi_curba),
      grad_otel: l.grad_otel ? String(l.grad_otel).trim().slice(0, 40) : (parsed.header?.grad_otel || null),
      standard: l.standard ? String(l.standard).trim().slice(0, 60) : (parsed.header?.standard || null),
    }))

    return new Response(JSON.stringify({
      success: true,
      header: parsed.header || {},
      linii,
      count: linii.length,
      confidence: parsed.confidence ?? 70,
    }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: CORS })
  }
})
