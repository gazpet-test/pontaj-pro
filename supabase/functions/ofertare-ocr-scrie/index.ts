// ofertare-ocr-scrie v1 (D3b, 14.10.2026; spec docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §6) — singura cale de scriere a serverului AI în
// tabelele pilotului OCR local: o listă ÎNCHISĂ de operații, fiecare = un RPC din migrarea 20261029b (EXECUTE doar service_role), cu
// exact parametrii lui. DEPLOY cu verify_jwt = false: poarta e secretul din Vault.
//
// Cerere:  POST { "op": "preia" | "plan" | "pagina" | "dezacord" | "comparatie_gata" | "stare" | "rezervare_abandon" | "heartbeat",
//                 "args": { …exact cheile operației, vezi _shared/ocrLocal.ts OPERATII… } } cu antetul x-ocr-local-secret.
// Răspuns: 200 { ok: true, rezultat } · 400 corp / operație · 401 neautorizat · 403 / 404 / 409 / 422 refuzul RPC-ului (mesajul lui) ·
//          413 corp prea mare · 500 configurare / eroare.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN: textul citit de modelele OCR locale din documente de licitație (date), plus planul / dezacordurile produse de
//      scripts/ocr_local — trecute ca parametri, nu interpretate aici; RPC-urile validează forma, starea rulării și proveniența;
//  (b) scrie DOAR prin RPC-urile din listă: rulări (preluare, plan, stare, marcaj), pagini / dezacorduri append-only, abandonul unei
//      rezervări de cost (după 15 min), heartbeat. Nu atinge ofertare_cantitati / text_extras, nu trimite mail, nu atinge drepturi;
//      nu emite linkuri (ofertare-pdf-link) și nu cheltuie (ofertare-ocr-arbitreaza);
//  (c) service_role: apelantul n-are cont Supabase; RPC-urile au EXECUTE doar service_role;
//  (d) cine pornește: doar deținătorul OCR_LOCAL_SECRET (fn_verifica_secret, fail closed); preluarea ia doar rulări cerute de un
//      utilizator autorizat (fn_ofertare_ocr_cerere);
//  (e) confirmare umană: pornirea (poarta pe cheltuială), needs_human, auditul eșantionului, promovarea (separat, cu „da”).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { apelDinCorp, citesteCorp, esteApelOcrLocal, mesajEroare, raspuns, statusDinEroare } from '../_shared/ocrLocal.ts'

const MAX_CORP = 2_000_000  // o pagină: text ≤ 200k + segmente ≤ 400k (CHECK-urile din BD), cu marjă de escapare JSON

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const url = Deno.env.get('SUPABASE_URL'), cheie = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !cheie) return raspuns(500, { error: 'Configurare lipsă' })
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })
  if (!(await esteApelOcrLocal(req, sb))) return raspuns(401, { error: 'Neautorizat' })

  const c = await citesteCorp(req, MAX_CORP)
  if (!c.ok) return raspuns(c.status, { error: c.error })
  const apel = apelDinCorp(c.corp)
  if (!apel.ok) return raspuns(400, { error: apel.error })
  const { data, error } = await sb.rpc(apel.fn, apel.args)
  if (error) return raspuns(statusDinEroare(error), { error: mesajEroare(error) })
  return raspuns(200, { ok: true, rezultat: data ?? null })
})
