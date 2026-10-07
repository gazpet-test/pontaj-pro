// tts-google v1 — 07.10.2026 (cerere Răzvan): text → MP3 cu vocea ro-RO-Chirp3-HD-Aoede (Google Cloud Text-to-Speech).
// Folosit de ecranul „🎙 Mesaj vocal” (/mesaj-vocal) și de butoanele „🔊 Ascultă”.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) Conținut extern citit: textul trimis de utilizator (poate fi lipit din mail/chat/tichet). Doar se SONORIZEAZĂ:
//      nu e interpretat ca instrucțiune, nu pornește nicio altă acțiune.
//  (b) Ce scrie: tts_cota_lunara (prin fn_tts_rezerva / fn_tts_restituie), tts_cache, bucket-ul privat tts-audio,
//      ai_usage_log. Nu trimite mailuri, nu atinge bani din ERP, nu atinge drepturi. Costul extern (Google) e ținut sub
//      free tier de plafonul lunar din BD (950.000 caractere, constantă în funcție).
//  (c) Identitate: service_role, DOAR după poarta de mai jos — e nevoie de el pentru funcțiile de cotă (EXECUTE doar
//      service_role), pentru bucket-ul fără politici și pentru URL-ul semnat.
//  (d) Cine o poate porni: JWT de utilizator real (auth.getUser) + rol: owner SAU cheia de modul 'mesaj_vocal'
//      (acordată doar de Răzvan). Cheia anon / un JWT fără utilizator ⇒ 401; cont fără modul ⇒ 403.
//  (e) Confirmare umană: nu e nevoie (nu trimite nimic în afară; mesajul vocal îl trimite omul, manual).
// Secret: GOOGLE_TTS_API_KEY (Edge Secrets; cheie Google „Gazpet ERP TTS” restricționată doar la Cloud Text-to-Speech API).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decideAccesTts, normalizeazaText, numarCaractere, imparteText, cheieCache, VOCI, VOCE_IMPLICITA, MAX_CARACTERE, MODUL } from '../_shared/ttsLogica.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_TTS_API_KEY = Deno.env.get('GOOGLE_TTS_API_KEY') || ''
const BUCKET = 'tts-audio'
const PLAFON = 950000
const URL_SEC = 3600

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function sintetizeaza(text: string, voce: string): Promise<Uint8Array> {
  const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_TTS_API_KEY },
    body: JSON.stringify({ input: { text }, voice: { languageCode: 'ro-RO', name: voce }, audioConfig: { audioEncoding: 'MP3' } }),
  })
  if (!r.ok) {
    const det = (await r.text()).slice(0, 300)
    throw new Error(`Google TTS ${r.status}: ${det}`)
  }
  const { audioContent } = await r.json()
  const bin = atob(String(audioContent || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Doar POST' })
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    // ═══ Poarta ═══
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = jwt ? await supabase.auth.getUser(jwt) : { data: { user: null } }
    let isOwner = false, areModul = false
    if (u?.user) {
      const [{ data: prof }, { data: acc }] = await Promise.all([
        supabase.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle(),
        supabase.from('user_module_access').select('module').eq('profile_id', u.user.id).eq('module', MODUL).limit(1),
      ])
      isOwner = prof?.is_owner === true
      areModul = (acc || []).length > 0
    }
    const dec = decideAccesTts({ user: !!u?.user, isOwner, areModul })
    if (!dec.ok) return json(dec.status, { error: dec.error })

    // ═══ Cererea ═══
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { return json(400, { error: 'Corp JSON invalid' }) }
    const text = normalizeazaText(body.text)
    const voce = String(body.voce || VOCE_IMPLICITA)
    if (!text) return json(400, { error: 'Textul e gol' })
    if (!VOCI.has(voce)) return json(400, { error: 'Voce nepermisă' })
    const caractere = numarCaractere(text)
    if (caractere > MAX_CARACTERE) return json(400, { error: `Textul are ${caractere} caractere; maximum ${MAX_CARACTERE} pe mesaj` })
    if (!GOOGLE_TTS_API_KEY) return json(500, { error: 'GOOGLE_TTS_API_KEY lipsește din Edge Secrets' })

    // ═══ Cache: același text + aceeași voce ⇒ același MP3, fără cost ═══
    const cheie = await cheieCache(voce, text)
    const cale = `${cheie}.mp3`
    const { data: din } = await supabase.from('tts_cache').select('cheie, folosiri').eq('cheie', cheie).maybeSingle()
    if (din) {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(cale, URL_SEC)
      if (s?.signedUrl) {
        await supabase.from('tts_cache').update({ folosiri: (din.folosiri || 1) + 1, ultima_folosire: new Date().toISOString() }).eq('cheie', cheie)
        return json(200, { url: s.signedUrl, din_cache: true, caractere: 0, voce })
      }
      // rândul există dar fișierul nu ⇒ se regenerează mai jos (și se suprascrie rândul)
    }

    // ═══ Cota lunară (atomic, în BD): peste plafon nu se cheamă Google ═══
    const { data: rest, error: cotaErr } = await supabase.rpc('fn_tts_rezerva', { p_caractere: caractere })
    if (cotaErr) return json(500, { error: 'Nu am putut verifica plafonul lunar' })
    if (rest === null || rest === undefined) {
      return json(429, { error: `Plafonul lunar de voce (${PLAFON.toLocaleString('ro-RO')} caractere) s-a atins. Revine la începutul lunii viitoare.` })
    }

    // ═══ Google ═══
    let audio: Uint8Array
    try {
      const bucati = imparteText(text)
      const parti: Uint8Array[] = []
      for (const b of bucati) parti.push(await sintetizeaza(b, voce))
      const total = parti.reduce((s, p) => s + p.length, 0)
      audio = new Uint8Array(total)
      let o = 0
      for (const p of parti) { audio.set(p, o); o += p.length }
    } catch (e) {
      try { await supabase.rpc('fn_tts_restituie', { p_caractere: caractere }) } catch (_) { /* rămâne numărat: conservator */ }
      console.error('tts-google:', (e as Error).message)
      return json(502, { error: 'Serviciul de voce Google n-a răspuns. Încearcă din nou.' })
    }

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(cale, audio, { contentType: 'audio/mpeg', upsert: true })
    if (upErr) return json(500, { error: 'Nu am putut salva fișierul audio' })
    await supabase.from('tts_cache').upsert({ cheie, voce, caractere, cale, creat_de: u!.user!.id, ultima_folosire: new Date().toISOString() })
    try {
      // cost_usd = 0: sub plafonul nostru suntem în free tier-ul Chirp 3 HD (1M caractere/lună)
      await supabase.from('ai_usage_log').insert({ function_name: 'tts-google', model: voce, tokens_in: caractere, tokens_out: 0, cost_usd: 0, ref_table: 'tts_cache', ref_id: null })
    } catch (_) { /* jurnalul de cost nu blochează */ }
    const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(cale, URL_SEC)
    if (!s?.signedUrl) return json(500, { error: 'Nu am putut crea linkul audio' })
    return json(200, { url: s.signedUrl, din_cache: false, caractere, ramase: rest, voce })
  } catch (e) {
    console.error('tts-google:', (e as Error).message)
    return json(500, { error: 'Eroare internă' })
  }
})
