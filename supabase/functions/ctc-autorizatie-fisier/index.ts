// ctc-autorizatie-fisier v1 (TKT-2026-0389, 13.11.2026) — link semnat de 60 s către scanul UNEI autorizații de sudor, pentru CTC (cartea
// tehnică), fără acces la modulul HR și fără să deschidă bucket-ul autorizatii pentru CTC. NEDEPLOYATĂ: o deployează coordonatorul, după
// migrarea 20261222b (fără ea răspunde 503). Deploy cu verify_jwt = true (implicit); poarta reală e verificarea din BD de mai jos.
//
// Cerere:  POST { "autorizatie_id": <întreg> } cu Authorization: Bearer <JWT-ul utilizatorului> (supabase.functions.invoke din CTC).
// Răspuns: 200 { url, expira_in_sec } · 400 corp invalid · 401 fără JWT · 403 fără CTC · 404 inexistentă / fără scan / alt tip ·
//          422 cale invalidă · 502 semnare eșuată · 503 migrarea neaplicată · 500 configurare / BD.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN citit: doar `autorizatie_id` din corp (validat strict) și calea fișierului din hr_autorizatii (scrisă de HR, validată
//      de caleSigura înainte de semnare). Fișierul în sine NU e citit aici;
//  (b) nu scrie nimic, nu trimite mailuri, nu atinge bani sau drepturi; emite doar un URL semnat de CITIRE, 60 s, pentru calea aprobată;
//  (c) identități: (1) RPC-ul fn_ctc_autorizatie_fisier rulează cu JWT-ul UTILIZATORULUI (cheia anon + Authorization), deci auth.uid() =
//      utilizatorul și dreptul (owner / modulul ctc) + tipul autorizației (doar sudor, neștearsă) se verifică în BD (L07, L08, L09);
//      (2) service_role DOAR pentru createSignedUrl pe EXACT calea întoarsă de RPC — necesar fiindcă bucket-ul autorizatii nu primește nicio
//      politică pentru CTC (accesul la el rămâne cum e);
//  (d) cine o poate porni: orice cont logat poate face cererea, dar fără CTC primește 403 din BD; cheia anon singură (fără sub) = 403;
//  (e) confirmare umană: nu e cazul (doar citirea unui document existent, de către contul cu drept).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { caleSigura, statusDinEroareRpc, valideazaCerere } from '../_shared/ctcAutorizatieFisier.ts'

const BUCKET = 'autorizatii'
const VALABIL_SEC = 60
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function raspuns(status: number, corp: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corp), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const cheie = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !cheie) return raspuns(500, { error: 'Configurare lipsă' })

  const auth = req.headers.get('Authorization') || ''
  if (!/^Bearer\s+\S+$/i.test(auth)) return raspuns(401, { error: 'Neautorizat' })

  let corp: unknown
  try { corp = await req.json() } catch (_) { return raspuns(400, { error: 'Corp JSON invalid' }) }
  const cerere = valideazaCerere(corp)
  if (!cerere.ok) return raspuns(400, { error: cerere.error })

  // 1. dreptul + calea: în BD, CA UTILIZATORUL (auth.uid() din JWT-ul lui) — nu cu service_role
  const caUtilizator = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let cale: string | null = null
  try {
    const { data, error } = await caUtilizator.rpc('fn_ctc_autorizatie_fisier', { p_id: cerere.id })
    if (error) { const s = statusDinEroareRpc(error); return raspuns(s.status, { error: s.error }) }
    cale = caleSigura(data)
  } catch (_) {
    return raspuns(500, { error: 'Eroare internă' })
  }
  if (!cale) return raspuns(422, { error: 'Calea scanului e invalidă' })

  // 2. semnarea EXACT a căii aprobate de BD (service_role doar aici)
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: semnat, error: eroareSemnare } = await sb.storage.from(BUCKET).createSignedUrl(cale, VALABIL_SEC)
  if (eroareSemnare || !semnat?.signedUrl) return raspuns(502, { error: 'Scanul nu a putut fi semnat' })
  return raspuns(200, { url: semnat.signedUrl, expira_in_sec: VALABIL_SEC })
})
