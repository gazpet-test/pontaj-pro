// tts-google v1 r2 — 07.10.2026 (cerere Răzvan): text → MP3 cu vocea ro-RO-Chirp3-HD-Aoede (Google Cloud Text-to-Speech).
// Folosit de ecranul „🎙 Mesaj vocal” (/mesaj-vocal). r2 (Jakarinos J13-1..4, Copilot P12-1): rezervare per bucată,
// fără restituire, poarta cu identitatea utilizatorului înaintea oricărui client service_role.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) Conținut extern citit: textul trimis de utilizator (poate fi lipit din mail/chat/tichet). Doar se SONORIZEAZĂ:
//      nu e interpretat ca instrucțiune, nu pornește nicio altă acțiune.
//  (b) Ce scrie: tts_cota_lunara (prin fn_tts_rezerva, câte o rezervare înaintea fiecărei bucăți trimise la Google, fără
//      restituire), tts_cache, bucket-ul privat tts-audio (închis pentru orice rol supus RLS),
//      ai_usage_log. Nu trimite mailuri, nu atinge bani din ERP, nu atinge drepturi. Costul extern (Google) e ținut sub
//      free tier de plafonul lunar din BD (950.000 caractere, constantă în funcție).
//  (c) Identitate: poarta rulează cu clientul UTILIZATORULUI (cheia anon + JWT-ul lui): auth.getUser + fn_tts_poate()
//      pe auth.uid(). Clientul service_role se creează DOAR după poartă — e nevoie de el pentru fn_tts_rezerva (EXECUTE
//      doar service_role), pentru bucket-ul închis și pentru URL-ul semnat.
//  (d) Cine o poate porni: JWT de utilizator real + rol: owner SAU cheia de modul 'mesaj_vocal' (acordată doar de
//      Răzvan). Cheia anon / un JWT fără utilizator ⇒ 401; cont fără modul ⇒ 403.
//  (e) Confirmare umană: nu e nevoie (nu trimite nimic în afară; mesajul vocal îl trimite omul, manual).
// Secret: GOOGLE_TTS_API_KEY (Edge Secrets; cheie Google „Gazpet ERP TTS” restricționată doar la Cloud Text-to-Speech API).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decideAccesTts, normalizeazaText, numarCaractere, imparteText, cheieCache, genereazaPeBucati, VOCI, VOCE_IMPLICITA, MAX_CARACTERE } from '../_shared/ttsLogica.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
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
  try {
    // ═══ Poarta, cu identitatea utilizatorului (fără service_role) ═══
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    let user = false, poate = false, userId: string | null = null
    if (jwt) {
      const cl = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } })
      const { data: u } = await cl.auth.getUser(jwt)
      if (u?.user) {
        user = true
        userId = u.user.id
        const { data: ok, error } = await cl.rpc('fn_tts_poate')
        poate = !error && ok === true
      }
    }
    const dec = decideAccesTts({ user, isOwner: false, areModul: poate })
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

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)   // DOAR după poartă

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

    // ═══ Google, bucată cu bucată; fiecare bucată se rezervă în BD înainte să plece (fără restituire) ═══
    const rez = await genereazaPeBucati(imparteText(text), async (n) => {
      const { data, error } = await supabase.rpc('fn_tts_rezerva', { p_caractere: n })
      if (error) throw new Error('rezervare: ' + error.message)
      return data === null || data === undefined ? null : Number(data)
    }, (b) => sintetizeaza(b, voce))
    if (!rez.ok) {
      if (rez.rezervate > 0) {
        try { await supabase.from('ai_usage_log').insert({ function_name: 'tts-google', model: voce, tokens_in: rez.rezervate, tokens_out: 0, cost_usd: 0, ref_table: 'tts_cache', ref_id: null }) } catch (_) { /* jurnal */ }
      }
      if (rez.motiv === 'plafon') {
        return json(429, { error: `Plafonul lunar de voce (${PLAFON.toLocaleString('ro-RO')} caractere) s-a atins. Revine la începutul lunii viitoare.` })
      }
      console.error('tts-google:', rez.eroare)
      return json(502, { error: 'Serviciul de voce Google n-a răspuns. Încearcă din nou.' })
    }

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(cale, rez.audio, { contentType: 'audio/mpeg', upsert: true })
    if (upErr) return json(500, { error: 'Nu am putut salva fișierul audio' })
    await supabase.from('tts_cache').upsert({ cheie, voce, caractere, cale, creat_de: userId, ultima_folosire: new Date().toISOString() })
    try {
      // cost_usd = 0: sub plafonul nostru suntem în free tier-ul Chirp 3 HD (1M caractere/lună)
      await supabase.from('ai_usage_log').insert({ function_name: 'tts-google', model: voce, tokens_in: rez.rezervate, tokens_out: 0, cost_usd: 0, ref_table: 'tts_cache', ref_id: null })
    } catch (_) { /* jurnalul de cost nu blochează */ }
    const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(cale, URL_SEC)
    if (!s?.signedUrl) return json(500, { error: 'Nu am putut crea linkul audio' })
    return json(200, { url: s.signedUrl, din_cache: false, caractere: rez.rezervate, ramase: rez.rest, voce })
  } catch (e) {
    console.error('tts-google:', (e as Error).message)
    return json(500, { error: 'Eroare internă' })
  }
})
