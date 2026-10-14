// ofertare-ocr-arbitreaza v1 (D3b, 14.10.2026; spec docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §3, §8) — arbitrajul Claude Sonnet 5 pe UN
// dezacord dintre cele două citiri OCR locale (LightOn / MinerU). DEPLOY cu verify_jwt = false: poarta e secretul din Vault.
//
// Cerere: POST { rulare_id, dezacord_id, item_sha256, imagine_b64, context } cu antetul x-ocr-local-secret = Vault OCR_LOCAL_SECRET.
//   item_sha256 = amprenta dezacordului (dezacorduri.jsonl); imagine_b64 = imaginea PNG a benzii; context = {context_inainte?,
//   context_dupa?, rand_anterior?} (șiruri ≤ 2000, din pipeline, doar ca modelul să găsească locul).
// Legarea de BD (migrarea 20261029c, review Copilot r1 + Jakarinos r1): citirile, tipul și item_id vin DIN BD
//   (fn_ofertare_ocr_dezacord_arbitraj), după ce BD verifică rularea (citita), apartenența, amprenta și imaginea (sha256 = image_sha256
//   al dezacordului); rezervarea (fn_ofertare_ocr_arbitraj_rezerva) repetă verificările ATOMIC, cere dezacordul nearbitrat și fără alt
//   apel în zbor, și rezervă limita de SUS a costului — totul înaintea apelului plătit.
// Cost: decontare cu costul real (fn_ofertare_ocr_scrie_arbitraj, scrie și ai_usage_log). Eroare API → rezervarea rămâne deschisă
//   (abandon după 15 min prin ofertare-ocr-scrie op rezervare_abandon), nicio decizie. usage lipsă → decontare la toată rezervarea,
//   needs_human. Cost real peste rezervare (doar la schimbare de preț) → decontare la rezervare, excesul în ai_usage_log, rularea oprită.
// Răspuns: 200 { decizie: {id, item_sha256, decizie, text, motiv, e_cantitate, anomalie_separator, arbitru_model, prompt_versiune,
//   cost_usd}, arbitraj_id } (forma validată de reconcile.valid_decision) · 400 / 413 / 422 corp sau refuz BD · 401 neautorizat ·
//   402 plafon / rularea nu e în citita · 409 arbitrat / în zbor / decizie neînregistrată · 502 API · 500.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN: citirile OCR ale unui document de licitație (text străin, luat din BD) și imaginea benzii — trimise modelului ca DATE
//      (JSON + promptul cere explicit să nu fie urmate ca instrucțiuni); ieșirea modelului e validată strict (schema §3), altfel needs_human;
//  (b) scrie DOAR prin fn_ofertare_ocr_arbitraj_rezerva / fn_ofertare_ocr_scrie_arbitraj (rezervare, arbitraj append-only, ai_usage_log),
//      plus, doar la cost peste rezervare: un rând de exces în ai_usage_log și oprirea rulării (fn_ofertare_ocr_stare);
//      nu atinge ofertare_cantitati / text_extras, nu trimite mail, nu atinge drepturi; BANI: un apel Anthropic plătit, sub plafonul rulării;
//  (c) service_role: apelantul n-are cont Supabase; RPC-urile au EXECUTE doar service_role; nicio citire directă din tabelele OCR;
//  (d) cine pornește: doar deținătorul OCR_LOCAL_SECRET (verificat în BD, fail closed); rularea însăși e pornită de un utilizator
//      autorizat (fn_ofertare_ocr_cerere, poarta pe cheltuială) și există doar în starea citita;
//  (e) confirmare umană: needs_human, eșantionul de audit (fn_ofertare_ocr_esantion / _verifica), promovarea (separat, cu „da”).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { raspuns } from '../_shared/ocrLocal.ts'
import { arbitreaza } from './arbitreaza.ts'

Deno.serve(async (req: Request) => {
  const url = Deno.env.get('SUPABASE_URL'), cheie = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), cheieAi = Deno.env.get('ANTHROPIC_API_KEY')
  if (!url || !cheie || !cheieAi) return raspuns(500, { error: 'Configurare lipsă' })
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })
  const jurnalExces = async (rand: Record<string, unknown>) => { await sb.from('ai_usage_log').insert(rand) }
  return await arbitreaza(req, { sb, cheieAi, fetchApi: fetch, jurnalExces })
})
