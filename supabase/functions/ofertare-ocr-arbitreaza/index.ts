// ofertare-ocr-arbitreaza v1 (D3b, 14.10.2026; spec docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §3, §8) — arbitrajul Claude Sonnet 5 pe UN
// dezacord dintre cele două citiri OCR locale (LightOn / MinerU). DEPLOY cu verify_jwt = false: poarta e secretul din Vault.
//
// Cerere: POST { rulare_id, dezacord_id, item, imagine_b64 } cu antetul x-ocr-local-secret = Vault OCR_LOCAL_SECRET (64 hex).
//   item = obiectul dezacordului EXACT cum e în dezacorduri.jsonl (scripts/ocr_local compare); imagine_b64 = imaginea benzii.
// Legarea de BD, fără citire directă din tabele: (1) amprenta item-ului se recalculează aici (aceeași formulă ca compare.item_hash) și
//   trebuie să fie item.item_sha256; (2) fn_ofertare_ocr_scrie_arbitraj cere ca dezacord_id să fie al rulării ȘI să aibă exact acest
//   item_sha256 — deci citirile arătate modelului sunt cele din BD (scrise și verificate pe segmente la D3a); (3) sha256(imagine) =
//   item.image_sha256 (imaginea benzii din plan). Orice nepotrivire → 422 înainte de orice cost.
// Cost: rezervare în BD (fn_ofertare_ocr_cost_rezerva, sub plafonul rulării) ÎNAINTEA apelului plătit; decontare cu costul real
//   (fn_ofertare_ocr_scrie_arbitraj, care scrie și ai_usage_log). Eroare la apel → rezervarea rămâne deschisă (se abandonează după
//   15 min prin ofertare-ocr-scrie op rezervare_abandon) — nu se înregistrează nicio decizie.
// Răspuns: 200 { decizie: {id, item_sha256, decizie, text, motiv, e_cantitate, anomalie_separator, arbitru_model, prompt_versiune,
//   cost_usd}, arbitraj_id } (forma validată de reconcile.valid_decision) · 400 / 413 / 422 corp · 401 neautorizat · 402 plafon /
//   rulare nu e în citita · 409 decontat dar decizie neînregistrată · 502 API · 500 configurare.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN: citirile OCR ale unui document de licitație (text străin) și imaginea benzii — trimise modelului ca DATE
//      (JSON + promptul cere explicit să nu fie urmate ca instrucțiuni); ieșirea modelului e validată strict (schema §3), altfel needs_human;
//  (b) scrie DOAR prin fn_ofertare_ocr_cost_rezerva / fn_ofertare_ocr_scrie_arbitraj (rezervare, arbitraj append-only, ai_usage_log);
//      nu atinge ofertare_cantitati / text_extras, nu trimite mail, nu atinge drepturi; BANI: un apel Anthropic plătit, sub plafonul rulării;
//  (c) service_role: apelantul n-are cont Supabase; RPC-urile au EXECUTE doar service_role; nicio citire directă din tabele;
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
  return await arbitreaza(req, { sb, cheieAi, fetchApi: fetch })
})
