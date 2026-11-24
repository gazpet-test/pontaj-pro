// ctc-autorizatie-fisier v2 (TKT-2026-0389) — link semnat de 60 s către scanul UNEI autorizații, pentru CTC (cartea tehnică), fără acces la
// modulul HR / Ofertare și fără să deschidă bucket-urile pentru CTC. Două ramuri, fiecare cu EXACT o cheie în corp:
//   * { autorizatie_id } — autorizația unui SUDOR (20261222b, neschimbată): RPC fn_ctc_autorizatie_fisier, bucket autorizatii. Dovada ținută
//     doar în dosarul personal nu se deschide de aici (RPC-ul o refuză generic, P0002 → 404);
//   * { ndt_document_id } — autorizația unei FIRME de control nedistructiv (20270111a): RPC fn_ctc_autorizatie_ndt_fisier (NULL → 404),
//     calea reverificată aici (parteneri/<firmă>/ndt/<nume>), bucket ofertare.
// NEDEPLOYATĂ (v2): o publică coordonatorul DUPĂ migrarea 20270111a (fără ea ramura NDT răspunde 503) și ÎNAINTE de merge
// (docs/ctc/AUTORIZATII_CARTE_TEHNICA.md). Deploy cu verify_jwt = true; poarta reală e verificarea din BD.
//
// Cerere:  POST { "autorizatie_id": <întreg> } SAU { "ndt_document_id": <întreg> } cu Authorization: Bearer <JWT-ul utilizatorului>.
// Răspuns: 200 { url, expira_in_sec } · 400 corp invalid (chei în plus / ambele / necunoscută) · 401 fără JWT · 403 fără CTC ·
//          404 inexistentă / fără scan / alt tip · 422 cale invalidă · 502 semnare eșuată · 503 migrarea neaplicată · 500 configurare / BD.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN citit: doar cheia din corp (validată strict) și calea fișierului din hr_autorizatii (scrisă de HR) / din
//      ofertare_parteneri_documente (scrisă de Ofertare, păzită de trigger-ul din BD), validată din nou aici înainte de semnare. Fișierul în
//      sine NU e citit aici;
//  (b) nu scrie nimic, nu trimite mailuri, nu atinge bani sau drepturi; emite doar un URL semnat de CITIRE, 60 s, pentru calea aprobată;
//  (c) identități: (1) RPC-urile rulează cu JWT-ul UTILIZATORULUI (cheia anon + Authorization), deci auth.uid() = utilizatorul și dreptul
//      (owner / modulul ctc) + tipul documentului se verifică în BD (L07, L08, L09); (2) service_role DOAR pentru createSignedUrl pe EXACT
//      calea întoarsă de RPC, în bucket-ul fix al ramurii — necesar fiindcă bucket-urile autorizatii / ofertare nu primesc politici pentru CTC;
//  (d) cine o poate porni: orice cont logat poate face cererea, dar fără CTC primește 403 din BD; cheia anon singură (fără sub) = 403;
//  (e) confirmare umană: nu e cazul (doar citirea unui document existent, de către contul cu drept).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { trateazaCerere } from '../_shared/ctcAutorizatieFisier.ts'

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

  // 1. dreptul + calea: în BD, CA UTILIZATORUL (auth.uid() din JWT-ul lui) — nu cu service_role
  const caUtilizator = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // 2. semnarea EXACT a căii aprobate de BD și reverificate (service_role doar aici)
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })
  const r = await trateazaCerere(corp, {
    rpc: (nume, argumente) => caUtilizator.rpc(nume, argumente),
    semneaza: (bucket, cale, secunde) => sb.storage.from(bucket).createSignedUrl(cale, secunde),
  })
  return raspuns(r.status, r.corp)
})
