// ofertare-e0-autofill v3 (26.08.2026) — E0: citește fișa de date / anunțul și
// precompletează formularul de licitație. v3: CORS complet cu x-client-info
// (supabase-js îl trimite la functions.invoke; fără el preflight-ul pică din
// browser). v2: numele fișierului ca semnal pt nr_anunt. AI propune, omul confirmă.
//
// ADUSĂ ÎN REPO la 12.09.2026, fără nicio modificare de cod: rula neversionată,
// ca 105 din cele 129 de funcții. Nu poți face code review pe ce nu vezi.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ofertare'
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const MAX_BYTES = 28_000_000

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const PROMPT = `Ești asistentul de ofertare al unei firme românești de construcții conducte gaze (Gazpet Instal). Primești FIȘA DE DATE sau ANUNȚUL DE PARTICIPARE al unei achiziții publice (SEAP/SICAP) și extragi datele de înregistrare a licitației.

REGULI:
- Extragi DOAR ce se vede. Ce nu apare nicăieri = null. NU inventa.
- nr_anunt: numărul ANUNȚULUI SEAP — forma CN......., DF......., SCN......., PC....... etc. Exporturile SEAP adesea NU îl conțin în text, dar apare în NUMELE FIȘIERULUI (ți-l dau mai jos) — folosește-l de acolo. Dacă nu există nici acolo, pune numărul de referință al procedurii (ex: 14056826|2026|RGZ...). Nu le combina.
- termen_depunere: data limită de depunere a ofertelor, cu ora dacă apare. Format ISO: YYYY-MM-DDTHH:MM (sau YYYY-MM-DD). Fișa de date de multe ori NU o conține (e în anunț) — atunci null, nu ghici.
- valoare_estimata: valoarea estimată TOTALĂ (sau a lotului dacă documentul e pe un singur lot), număr simplu fără separatori. moneda: RON sau EUR.
- garantie_participare: cuantumul + forma acceptată, text scurt (ex: \"45.000 lei, SGB sau virament\"). Dacă scrie explicit că nu se solicită: \"Nu se solicită\".
- criteriu: criteriul de atribuire (ex: \"prețul cel mai scăzut\").
- loturi: dacă achiziția e pe loturi, [{\"lot\": \"1\", \"denumire\": \"...\"}], altfel [].
- obiect: denumirea contractului, concis (max 200 caractere).

Răspunde EXCLUSIV JSON, fără markdown:
{
  \"nr_anunt\": \"<text sau null>\",
  \"autoritate\": \"<denumirea autorității contractante sau null>\",
  \"obiect\": \"<text sau null>\",
  \"valoare_estimata\": <număr sau null>,
  \"moneda\": \"RON\"|\"EUR\"|null,
  \"termen_depunere\": \"<ISO sau null>\",
  \"criteriu\": \"<text sau null>\",
  \"garantie_participare\": \"<text sau null>\",
  \"loturi\": [],
  \"confidence\": <0-100>
}`

function fileToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { path, fisier_nume } = await req.json()
    if (!path || typeof path !== 'string' || path.includes('..')) return fail('path lipsă sau invalid')

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(path)
    if (dlErr || !blob) return fail('Nu am găsit fișierul încărcat: ' + (dlErr?.message || path))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > MAX_BYTES) return fail(`PDF-ul are ${(bytes.length / 1e6).toFixed(1)} MB — prea mare pentru citire directă. Încarcă doar fișa de date (nu toată arhiva).`)
    const b64 = fileToBase64(bytes)

    const text = PROMPT + (fisier_nume ? `\n\nNumele fișierului încărcat (semnal pentru nr_anunt — ex. DF/CN/SCN + cifre): \"${String(fisier_nume).slice(0, 200)}\"` : '')
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1200,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text },
        ] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-e0-autofill', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT, ref_table: 'ofertare_licitatii', ref_id: null })
    } catch (_) {}

    let parsed: any
    try {
      const txt = data.content?.find((c: any) => c.type === 'text')?.text || '{}'
      parsed = JSON.parse(txt.replace(/```json?|```/g, '').trim())
    } catch (_) { return fail('AI a răspuns într-un format neașteptat.') }

    const isoOk = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(s)
    const out = {
      nr_anunt: typeof parsed.nr_anunt === 'string' && parsed.nr_anunt.trim() ? parsed.nr_anunt.trim() : null,
      autoritate: typeof parsed.autoritate === 'string' && parsed.autoritate.trim() ? parsed.autoritate.trim() : null,
      obiect: typeof parsed.obiect === 'string' && parsed.obiect.trim() ? parsed.obiect.trim() : null,
      valoare_estimata: Number.isFinite(parsed.valoare_estimata) && parsed.valoare_estimata > 0 ? parsed.valoare_estimata : null,
      moneda: ['RON', 'EUR'].includes(parsed.moneda) ? parsed.moneda : null,
      termen_depunere: isoOk(parsed.termen_depunere) ? parsed.termen_depunere : null,
      criteriu: typeof parsed.criteriu === 'string' && parsed.criteriu.trim() ? parsed.criteriu.trim() : null,
      garantie_participare: typeof parsed.garantie_participare === 'string' && parsed.garantie_participare.trim() ? parsed.garantie_participare.trim() : null,
      loturi: Array.isArray(parsed.loturi) ? parsed.loturi.slice(0, 20) : [],
      confidence: Math.max(0, Math.min(100, parsed.confidence || 0)),
    }
    return new Response(JSON.stringify({ ok: true, ...out }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neașteptată: ' + String(e?.message || e))
  }
})
