// test-gemini-argon — probă de capacitate/cost pentru Gemini 4 Argon (`gemini-4-argon`), 15.10.2026.
// NU e flux de producție: nu scrie nimic în tabelele de business, doar întoarce răspunsul modelului
// + tokenii + costul calculat și lasă un rând în ai_usage_log. Planul de test: docs/teste/GEMINI_ARGON_PLAN.md.
//
// Body: { task: 'text'|'imagine'|'pdf', input: { prompt, cale?, date_b64?, mime? }, thinking?: 'low'|'medium'|'high',
//         max_output?: n, model?: 'argon'|'sonnet-5'|'haiku-5-5'|'gpt-5-mini' }
//   model ≠ 'argon' = COMPARATOR, permis doar pe task 'text' (setul „test de inteligență” din plan rulează identic
//   pe Argon și pe modelele noastre). thinking se traduce în effort (Claude) / reasoning.effort (OpenAI).
//   - text    → input.prompt (≤ MAX_PROMPT caractere), fără fișier
//   - imagine → input.prompt + (input.cale SAU input.date_b64 + input.mime image/png|jpeg|webp)
//   - pdf     → input.prompt + (input.cale SAU input.date_b64), mime application/pdf
//   input.cale = calea unui fișier din bucket-ul `ofertare` care este DOCUMENT DE ATRIBUIRE (documentație SEAP
//   publică, rând în ofertare_documente_atribuire.fisier_path). Orice altă cale e refuzată — nu se trimit la
//   Google documente interne, oferte proprii, date de personal.
//
// Prețuri Argon (ai.google.dev/gemini-api/docs/pricing, verificat 15.10.2026), USD / 1M tokeni, Standard:
//   până la 30.11.2026: intrare $2, ieșire (inclusiv gândire) $10, intrare din cache implicit $0,10
//   de la 01.12.2026:   intrare $4, ieșire $20, cache $0,20.   Fără free tier. Fără praguri pe lungimea contextului.
// Comparatori (USD/1M, in/out): claude-sonnet-5 2/10, claude-haiku-5-5 0,10/0,50 (≤100k intrare; plafonul MAX_PROMPT
//   ține sub prag), gpt-5-mini 0,25/2 — aceleași valori ca _shared/ocrLocal.ts și ofertare-cantitati-extrage.
//
// Particularități API (docs Gemini 4 Argon): temperature/top_p/top_k se ignoră (nu le trimitem);
// thinkingLevel doar low|medium|high (MINIMAL sau thinkingBudget = HTTP 400); max_output acoperă gândire + răspuns;
// cererile grele pot dura minute → timeout propriu sub pragul gateway-ului (~150s).
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN citit: promptul trimis de owner + documente de atribuire SEAP publice din bucket-ul `ofertare`
//      (text scris de autorități contractante). Răspunsul modelului e DATE, nu se execută nimic din el.
//  (b) ce scrie: DOAR un rând în ai_usage_log (cost). Nu trimite mail, nu atinge bani, drepturi sau tabele de business.
//      Trimite conținutul spre Google (API plătit: Google NU folosește prompturile la antrenare — Gemini API Terms,
//      secțiunea Paid Services; le loghează limitat pentru abuz).
//  (c) identitate: service_role — necesar pentru citirea storage-ului `ofertare` și insertul în ai_usage_log;
//      folosit DOAR după poarta de rol de mai jos, pe căi validate.
//  (d) cine o pornește: verify_jwt=true la deploy + verificare de ROL în cod: JWT de UTILIZATOR validat prin
//      auth.getUser și profiles.is_owner = true. Cheia anon (JWT fără user) și service_role → 401. Restul → 403.
//  (e) confirmare umană: fiecare apel e pornit manual de owner (cost plătit, plafonat: MAX_PROMPT, MAX_FISIER,
//      MAX_OUTPUT). Nu există cron/trigger. Chei (doar numele): GEMINI_API_KEY_Argon; pentru comparatori ANTHROPIC_API_KEY, OPENAI_API_KEY (existente).
// Erorile de business se ÎNTORC ca JSON, nu se aruncă.
import { createClient } from 'npm:@supabase/supabase-js@2'

export const MODEL = 'gemini-4-argon'
export const TASKURI = ['text', 'imagine', 'pdf'] as const
export const NIVELE = ['low', 'medium', 'high'] as const
export const MAX_PROMPT = 60_000          // caractere (~15k tokeni)
export const MAX_FISIER = 4 * 1024 * 1024 // octeți decodați (imagine sau PDF)
export const MAX_OUTPUT = 16_384          // plafon dur gândire + răspuns
export const OUTPUT_IMPLICIT = 8_192
export const TIMEOUT_MS = 120_000
export const COMPARATORI = {
  'sonnet-5':   { id: 'claude-sonnet-5',  furnizor: 'anthropic', in: 2 / 1e6,    out: 10 / 1e6 },
  'haiku-5-5':  { id: 'claude-haiku-5-5', furnizor: 'anthropic', in: 0.10 / 1e6, out: 0.50 / 1e6 },
  'gpt-5-mini': { id: 'gpt-5-mini',       furnizor: 'openai',    in: 0.25 / 1e6, out: 2 / 1e6 },
} as const
type Comparator = keyof typeof COMPARATORI
const BUCKET = 'ofertare'
const MIME_IMAGINE = ['image/png', 'image/jpeg', 'image/webp']

// Tarif după data apelului (prețul se dublează la 1.12.2026).
export function tarif(acum: Date = new Date()): { in: number; out: number; cache: number } {
  return acum < new Date('2026-12-01T00:00:00Z')
    ? { in: 2 / 1e6, out: 10 / 1e6, cache: 0.10 / 1e6 }
    : { in: 4 / 1e6, out: 20 / 1e6, cache: 0.20 / 1e6 }
}
export function cost(u: { prompt: number; cached: number; candidates: number; thoughts: number }, acum?: Date): number {
  const t = tarif(acum)
  const v = Math.max(0, u.prompt - u.cached) * t.in + u.cached * t.cache + (u.candidates + u.thoughts) * t.out
  return Math.round(v * 1e6) / 1e6
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

export type Deps = {
  db: any
  getUser: (jwt: string) => Promise<string | null>
  fetch: typeof fetch
  cheie: string                      // GEMINI_API_KEY_Argon
  chei?: { A?: string; O?: string }  // doar pentru comparatori
  acum?: () => Date
}
export function depsReale(): Deps {
  const URL_ = Deno.env.get('SUPABASE_URL')!
  return {
    db: createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    fetch,
    cheie: Deno.env.get('GEMINI_API_KEY_Argon') || '',
    chei: { A: Deno.env.get('ANTHROPIC_API_KEY') || '', O: Deno.env.get('OPENAI_API_KEY') || '' },
    getUser: async (jwt) => {
      const uc = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
      const { data } = await uc.auth.getUser()
      return data?.user?.id || null
    },
  }
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
}
// mărimea decodată a unui base64, fără a-l decoda
const octetiB64 = (s: string) => Math.floor(s.replace(/=+$/, '').length * 3 / 4)
const caleSigura = (c: string) => c.length > 0 && c.length < 500 && !c.includes('..') && !c.startsWith('/') && !c.includes('\\')

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'doar POST' }, 405)

  // --- poarta de ROL (înainte de orice citire de body, storage sau apel plătit) ---
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer(\s+|$)/i, '').trim()
  if (!jwt) return json({ error: 'fără autentificare' }, 401)
  const uid = await deps.getUser(jwt).catch(() => null)
  if (!uid) return json({ error: 'token invalid (e nevoie de sesiune de utilizator)' }, 401)
  const { data: prof } = await deps.db.from('profiles').select('is_owner').eq('id', uid).maybeSingle()
  if (prof?.is_owner !== true) return json({ error: 'doar ownerul poate rula proba Argon (apel plătit)' }, 403)

  // --- validarea intrării ---
  let body: any = null
  try { body = await req.json() } catch { /* mai jos */ }
  if (!body || typeof body !== 'object') return json({ error: 'body JSON lipsă' }, 400)
  const task = String(body.task)
  if (!(TASKURI as readonly string[]).includes(task)) return json({ error: `task necunoscut; permise: ${TASKURI.join(', ')}` }, 400)
  const input = body.input || {}
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  if (!prompt.trim()) return json({ error: 'input.prompt lipsă' }, 400)
  if (prompt.length > MAX_PROMPT) return json({ error: `input.prompt peste ${MAX_PROMPT} caractere` }, 413)
  const thinking = body.thinking === undefined ? 'low' : String(body.thinking)
  if (!(NIVELE as readonly string[]).includes(thinking)) return json({ error: `thinking permis: ${NIVELE.join(', ')}` }, 400)
  const maxOut = body.max_output === undefined ? OUTPUT_IMPLICIT : Math.floor(Number(body.max_output))
  if (!Number.isFinite(maxOut) || maxOut < 256 || maxOut > MAX_OUTPUT) return json({ error: `max_output între 256 și ${MAX_OUTPUT}` }, 400)

  const modelCerut = body.model === undefined ? 'argon' : String(body.model)
  const comp: Comparator | null = modelCerut === 'argon' ? null
    : Object.prototype.hasOwnProperty.call(COMPARATORI, modelCerut) ? modelCerut as Comparator : null
  if (modelCerut !== 'argon' && !comp) return json({ error: `model permis: argon, ${Object.keys(COMPARATORI).join(', ')}` }, 400)
  if (comp && task !== 'text') return json({ error: 'comparatorii rulează doar task-ul text' }, 400)
  if (!comp && !deps.cheie) return json({ error: 'GEMINI_API_KEY_Argon lipsă din secretele funcției' }, 500)
  if (comp) {
    const c = COMPARATORI[comp]
    const k = c.furnizor === 'anthropic' ? deps.chei?.A : deps.chei?.O
    if (!k) return json({ error: (c.furnizor === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY') + ' lipsă din secretele funcției' }, 500)
    return await comparator(deps, comp, k, prompt, thinking, maxOut)
  }

  const parts: any[] = []
  let sursa: string | null = null
  if (task !== 'text') {
    const mimeAsteptat = task === 'pdf' ? ['application/pdf'] : MIME_IMAGINE
    let date = ''
    let mime = ''
    if (typeof input.cale === 'string' && input.cale) {
      if (input.date_b64) return json({ error: 'dă fie input.cale, fie input.date_b64, nu ambele' }, 400)
      const cale = input.cale
      if (!caleSigura(cale)) return json({ error: 'cale invalidă' }, 400)
      // Doar documente de atribuire (SEAP, publice). Calea trebuie să existe exact în registru.
      const { data: doc } = await deps.db.from('ofertare_documente_atribuire').select('id, fisier_path').eq('fisier_path', cale).maybeSingle()
      if (!doc) return json({ error: 'calea nu e un document de atribuire public (ofertare_documente_atribuire)' }, 403)
      const { data: blob, error: dlErr } = await deps.db.storage.from(BUCKET).download(cale)
      if (dlErr || !blob) return json({ error: 'descărcare: ' + (dlErr?.message || 'lipsă') }, 502)
      if (blob.size > MAX_FISIER) return json({ error: `fișier peste ${MAX_FISIER} octeți` }, 413)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      mime = task === 'pdf' ? 'application/pdf'
        : /\.png$/i.test(cale) ? 'image/png' : /\.webp$/i.test(cale) ? 'image/webp' : /\.jpe?g$/i.test(cale) ? 'image/jpeg' : ''
      date = b64(bytes)
      sursa = `ofertare_documente_atribuire#${doc.id}`
    } else if (typeof input.date_b64 === 'string' && input.date_b64) {
      if (octetiB64(input.date_b64) > MAX_FISIER) return json({ error: `fișier peste ${MAX_FISIER} octeți` }, 413)
      mime = task === 'pdf' ? 'application/pdf' : String(input.mime || '')
      date = input.date_b64
      sursa = 'payload_test'
    } else {
      return json({ error: `task ${task} cere input.cale sau input.date_b64` }, 400)
    }
    if (!mimeAsteptat.includes(mime)) return json({ error: `tip fișier nepermis pentru ${task}: ${mime || 'necunoscut'}` }, 400)
    parts.push({ inlineData: { mimeType: mime, data: date } })
  }
  parts.push({ text: prompt })

  // --- apelul plătit ---
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let d: any = null
  let status = 0
  try {
    // cheia în antet, nu în URL (URL-urile ajung în loguri)
    const r = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.cheie },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: maxOut, thinkingConfig: { thinkingLevel: thinking } },
      }),
    })
    status = r.status
    d = await r.json().catch(() => null)
  } catch (e) {
    clearTimeout(timer)
    const motiv = (e as Error)?.name === 'AbortError' ? `timeout ${TIMEOUT_MS / 1000}s` : 'rețea: ' + String((e as Error)?.message || e).slice(0, 200)
    return json({ ok: false, error: 'Gemini: ' + motiv, durata_ms: Date.now() - t0 })
  }
  clearTimeout(timer)
  const durata = Date.now() - t0
  if (status < 200 || status >= 300) {
    return json({ ok: false, error: 'Gemini: ' + String(d?.error?.message || status).slice(0, 300), http: status, durata_ms: durata })
  }

  const c = d?.candidates?.[0]
  const text = (c?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join('')
  const um = d?.usageMetadata || {}
  const usage = {
    prompt: Number(um.promptTokenCount) || 0,
    cached: Number(um.cachedContentTokenCount) || 0,
    candidates: Number(um.candidatesTokenCount) || 0,
    thoughts: Number(um.thoughtsTokenCount) || 0,
  }
  const costUsd = cost(usage, deps.acum ? deps.acum() : undefined)

  // jurnalul de cost; o eroare aici nu ascunde rezultatul deja plătit
  let jurnal = true
  try {
    const { error } = await deps.db.from('ai_usage_log').insert({
      function_name: 'test-gemini-argon', model: MODEL,
      tokens_in: usage.prompt, tokens_out: usage.candidates + usage.thoughts, cost_usd: costUsd,
    })
    if (error) jurnal = false
  } catch { jurnal = false }

  return json({
    ok: true, model: MODEL, task, thinking, sursa,
    text, finish: c?.finishReason || null,
    usage, cost_usd: costUsd, durata_ms: durata, jurnalizat: jurnal,
  })
}

// --- comparatori (doar text): aceeași întrebare, alt model, același format de răspuns ---
async function comparator(deps: Deps, comp: Comparator, cheie: string, prompt: string, thinking: string, maxOut: number): Promise<Response> {
  const c = COMPARATORI[comp]
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let d: any = null
  let status = 0
  try {
    const r = c.furnizor === 'anthropic'
      ? await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': cheie, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        // gândire adaptivă (implicită pe Sonnet 5 / Haiku 5.5), adâncimea prin effort = același nivel ca la Argon
        body: JSON.stringify({ model: c.id, max_tokens: maxOut, thinking: { type: 'adaptive' }, output_config: { effort: thinking },
          messages: [{ role: 'user', content: prompt }] }),
      })
      : await deps.fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: ctl.signal,
        headers: { authorization: `Bearer ${cheie}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: c.id, input: prompt, reasoning: { effort: thinking }, max_output_tokens: maxOut }),
      })
    status = r.status
    d = await r.json().catch(() => null)
  } catch (e) {
    clearTimeout(timer)
    const motiv = (e as Error)?.name === 'AbortError' ? `timeout ${TIMEOUT_MS / 1000}s` : 'rețea: ' + String((e as Error)?.message || e).slice(0, 200)
    return json({ ok: false, model: c.id, error: motiv, durata_ms: Date.now() - t0 })
  }
  clearTimeout(timer)
  const durata = Date.now() - t0
  if (status < 200 || status >= 300) {
    return json({ ok: false, model: c.id, error: String(d?.error?.message || status).slice(0, 300), http: status, durata_ms: durata })
  }
  let text = '', tin = 0, tout = 0, finish: string | null = null
  if (c.furnizor === 'anthropic') {
    text = (d?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    tin = Number(d?.usage?.input_tokens) || 0; tout = Number(d?.usage?.output_tokens) || 0; finish = d?.stop_reason || null
  } else {
    text = d?.output_text || (d?.output || []).flatMap((o: any) => (o?.content || []).map((x: any) => x?.text || '')).join('')
    tin = Number(d?.usage?.input_tokens) || 0; tout = Number(d?.usage?.output_tokens) || 0
    finish = d?.status === 'incomplete' ? (d?.incomplete_details?.reason || 'incomplete') : (d?.status || null)
  }
  const costUsd = Math.round((tin * c.in + tout * c.out) * 1e6) / 1e6
  let jurnal = true
  try {
    const { error } = await deps.db.from('ai_usage_log').insert({
      function_name: 'test-gemini-argon', model: c.id, tokens_in: tin, tokens_out: tout, cost_usd: costUsd,
    })
    if (error) jurnal = false
  } catch { jurnal = false }
  return json({ ok: true, model: c.id, task: 'text', thinking, sursa: null, text, finish,
    usage: { prompt: tin, cached: 0, candidates: tout, thoughts: 0 }, cost_usd: costUsd, durata_ms: durata, jurnalizat: jurnal })
}
