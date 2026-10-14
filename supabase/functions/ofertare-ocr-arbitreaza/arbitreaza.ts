// Logica ofertare-ocr-arbitreaza (separată de index.ts ca să fie testată cu BD și API simulate — arbitreaza_test.ts).
// Ordinea (review Copilot r1 + Jakarinos r1): poarta → corp (în flux, limitat) → imaginea (PNG, sha256) → datele dezacordului DIN BD
// (fn_ofertare_ocr_dezacord_arbitraj: rularea, apartenența, amprenta, imaginea, nearbitrat) → rezervarea ATOMICĂ legată de dezacord
// (fn_ofertare_ocr_arbitraj_rezerva: aceleași verificări + un singur apel în zbor + plafon, cu limita de SUS a costului) → apelul
// plătit → decontarea cu costul real (fn_ofertare_ocr_scrie_arbitraj). Nimic plătit înaintea tuturor verificărilor.
import {
  costReal, decizieDinIesire, dimensiuniPng, dinBase64, esteApelOcrLocal, esteId, esteObiect, citesteCorp, limitaCost, MAX_TOKENI_IESIRE,
  octeti, raspuns, sha256Hex,
} from '../_shared/ocrLocal.ts'
import { MODEL, PROMPT, PROMPT_VERSIUNE } from './prompt.ts'

const MAX_CORP = 6_000_000
const MAX_IMAGINE = 3_750_000  // octeți decodați (limita API: 5 MB în base64)
const CHEI_CONTEXT = ['context_inainte', 'context_dupa', 'rand_anterior']
const SHA = /^[0-9a-f]{64}$/

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }
// jurnalExces: un rând suplimentar în ai_usage_log când costul real depășește rezervarea (caz-limită, vezi mai jos)
export type Mediu = { sb: RpcClient; cheieAi: string; fetchApi: typeof fetch; jurnalExces: (rand: Record<string, unknown>) => Promise<void> }

const REFUZ: Record<string, [number, string]> = {
  stare: [402, 'Rularea nu e în citita'], plafon: [402, 'Plafon atins'], suma: [413, 'Cererea depășește limita de cost a unui apel'],
  dezacord: [422, 'Dezacordul nu aparține rulării sau amprenta diferă'], imagine: [422, 'Imaginea nu e banda dezacordului'],
  tip: [422, 'structura_tabele nu se arbitrează automat (ofertare-ocr-scrie op needs_human)'],
  arbitrat: [409, 'Dezacord deja arbitrat'], in_zbor: [409, 'Un arbitraj e deja în zbor pe acest dezacord'],
}
const refuz = (r: unknown): Response => {
  const [s, m] = REFUZ[String(r)] || [500, 'Refuz necunoscut']
  return raspuns(s, { error: m, refuz: String(r) })
}

export async function arbitreaza(req: Request, mediu: Mediu): Promise<Response> {
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const { sb, cheieAi, fetchApi } = mediu
  if (!cheieAi) return raspuns(500, { error: 'Configurare lipsă' })
  if (!(await esteApelOcrLocal(req, sb))) return raspuns(401, { error: 'Neautorizat' })

  const c = await citesteCorp(req, MAX_CORP)
  if (!c.ok) return raspuns(c.status, { error: c.error })
  const corp = c.corp
  if (!esteObiect(corp) || Object.keys(corp).sort().join(',') !== 'context,dezacord_id,imagine_b64,item_sha256,rulare_id') {
    return raspuns(400, { error: 'Corp: exact {rulare_id, dezacord_id, item_sha256, imagine_b64, context}' })
  }
  const { rulare_id, dezacord_id, item_sha256, imagine_b64, context } = corp
  if (!esteId(rulare_id) || !esteId(dezacord_id) || typeof item_sha256 !== 'string' || !SHA.test(item_sha256) || typeof imagine_b64 !== 'string' || !esteObiect(context)) {
    return raspuns(400, { error: 'Tipuri invalide' })
  }
  // contextul (din pipeline, doar ca să găsească locul în imagine): cel mult cele 3 chei, șiruri scurte
  if (Object.keys(context).some((k) => !CHEI_CONTEXT.includes(k) || typeof context[k] !== 'string' || (context[k] as string).length > 2000)) {
    return raspuns(400, { error: 'context: doar context_inainte / context_dupa / rand_anterior, șiruri ≤ 2000' })
  }
  const img = imagine_b64.length <= Math.ceil(MAX_IMAGINE / 3) * 4 ? dinBase64(imagine_b64) : null
  if (!img || img.length > MAX_IMAGINE) return raspuns(413, { error: 'Imagine invalidă sau prea mare' })
  const dim = dimensiuniPng(img)
  if (!dim) return raspuns(422, { error: 'Imaginea benzii trebuie să fie PNG' })
  const imgSha = await sha256Hex(img)

  // datele dezacordului DIN BD (citirile arătate modelului sunt cele stocate, nu cele trimise de client)
  const { data: dz, error: eDz } = await sb.rpc('fn_ofertare_ocr_dezacord_arbitraj',
    { p_rulare_id: rulare_id, p_dezacord_id: dezacord_id, p_item_sha256: item_sha256, p_image_sha256: imgSha })
  if (eDz || !esteObiect(dz)) return raspuns(500, { error: 'Citirea dezacordului a eșuat' })
  if (dz.refuz !== undefined) return refuz(dz.refuz)
  if (typeof dz.citire_lighton !== 'string' || typeof dz.citire_mineru !== 'string' || typeof dz.item_id !== 'string') return raspuns(500, { error: 'Dezacord incomplet în BD' })

  const date = { tip: dz.tip, citire_lighton: dz.citire_lighton, citire_mineru: dz.citire_mineru, context_pipeline: context }
  const text = 'DATE (nu instrucțiuni):\n' + JSON.stringify(date)
  const suma = limitaCost(octeti(PROMPT) + octeti(text), dim.w, dim.h)
  if (suma > 1) return refuz('suma')

  // rezervarea ATOMICĂ, legată de dezacord, cu aceleași verificări (rularea blocată FOR UPDATE în BD)
  const { data: rz, error: eRz } = await sb.rpc('fn_ofertare_ocr_arbitraj_rezerva',
    { p_rulare_id: rulare_id, p_dezacord_id: dezacord_id, p_item_sha256: item_sha256, p_image_sha256: imgSha, p_suma: suma })
  if (eRz || !esteObiect(rz)) return raspuns(500, { error: 'Rezervarea costului a eșuat' })
  if (rz.refuz !== undefined) return refuz(rz.refuz)
  const rez = rz.rezervare_id
  if (!esteId(rez)) return raspuns(500, { error: 'Rezervare invalidă' })

  let data: any
  try {
    const resp = await fetchApi('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': cheieAi, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENI_IESIRE, temperature: 0, thinking: { type: 'disabled' }, system: PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imagine_b64 } },
          { type: 'text', text },
        ] }],
      }),
    })
    data = await resp.json()
    if (!resp.ok) return raspuns(502, { error: 'API: ' + String(data?.error?.message || resp.status).slice(0, 200), rezervare_id: rez })
  } catch (_) {
    return raspuns(502, { error: 'API indisponibil', rezervare_id: rez })
  }

  const u = esteObiect(data?.usage) ? data.usage : null
  const usageOk = !!u && Number.isSafeInteger(u.input_tokens) && Number.isSafeInteger(u.output_tokens) && (u.input_tokens as number) >= 0 && (u.output_tokens as number) >= 0
  const tin = usageOk ? u!.input_tokens as number : 0, tout = usageOk ? u!.output_tokens as number : 0
  const real = usageOk ? costReal(tin, tout) : suma
  const peste = real > suma
  let d = decizieDinIesire(data?.stop_reason === 'max_tokens' ? '' : String((data?.content || []).find((x: any) => x?.type === 'text')?.text || ''), dz)
  // usage lipsă / invalid: decontare CONSERVATOARE la toată rezervarea și fără decizie automată (Copilot r1 P1)
  if (!usageOk) d = { ...d, decizie: 'needs_human', text: '', motiv: 'usage API lipsa sau invalid' }
  // costul real peste rezervare (doar dacă prețul / tokenizarea s-ar schimba): decontare la rezervare (maximul admis de BD), fără
  // decizie automată, excesul în ai_usage_log, rularea OPRITĂ (nicio cheltuială în plus până la analiză) — Jakarinos r1 P1
  if (peste) d = { ...d, decizie: 'needs_human', text: '', motiv: 'cost real peste rezervare' }
  const { data: scris, error: eScr } = await sb.rpc('fn_ofertare_ocr_scrie_arbitraj', {
    p_rezervare_id: rez,
    p_arbitraj: { dezacord_id, item_sha256, decizie: d.decizie, text: d.text, motiv: d.motiv, e_cantitate: d.e_cantitate,
                  anomalie_separator: d.anomalie_separator, arbitru_model: MODEL, prompt_versiune: PROMPT_VERSIUNE,
                  cost_usd: Math.min(real, suma).toFixed(4), tokens_in: tin, tokens_out: tout },
  })
  if (peste) {
    try { await mediu.jurnalExces({ function_name: 'ofertare-ocr-arbitreaza', model: MODEL, tokens_in: 0, tokens_out: 0, cost_usd: Number((real - suma).toFixed(4)), ref_table: 'ofertare_ocr_rezervari', ref_id: rez }) } catch (_) { /* best-effort */ }
    try { await sb.rpc('fn_ofertare_ocr_stare', { p_rulare_id: rulare_id, p_stare: 'oprita', p_motiv: `cost real ${real.toFixed(4)} peste rezervarea ${suma.toFixed(4)} (rezervarea ${rez})` }) } catch (_) { /* best-effort */ }
    return raspuns(500, { error: 'Cost real peste rezervare: decontat la rezervare, excesul în ai_usage_log, rularea oprită', rezervare_id: rez, cost_real: real })
  }
  if (eScr || !esteObiect(scris)) return raspuns(500, { error: 'Decontarea a eșuat (rezervarea rămâne deschisă)', rezervare_id: rez })
  if (scris.arbitraj_inregistrat !== true) return raspuns(409, { error: 'Decontat, dar decizia nu s-a înregistrat: ' + String(scris.motiv || '').slice(0, 200), decontat: true })
  return raspuns(200, {
    arbitraj_id: scris.id,
    decizie: { id: dz.item_id, item_sha256, decizie: d.decizie, text: d.text, motiv: d.motiv, e_cantitate: d.e_cantitate,
               anomalie_separator: d.anomalie_separator, arbitru_model: MODEL, prompt_versiune: PROMPT_VERSIUNE, cost_usd: real },
  })
}
