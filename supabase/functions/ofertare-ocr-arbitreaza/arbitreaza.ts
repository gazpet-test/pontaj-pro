// Logica ofertare-ocr-arbitreaza (separată de index.ts ca să fie testată cu BD și API simulate — arbitreaza_test.ts).
import {
  amprentaDezacord, costReal, decizieDinIesire, dinBase64, esteApelOcrLocal, esteId, esteObiect, estimeazaRezervare, citesteCorp,
  MAX_TOKENI_IESIRE, raspuns, sha256Hex, tipImagine,
} from '../_shared/ocrLocal.ts'
import { CAMPURI_DATE, MODEL, PROMPT, PROMPT_VERSIUNE } from './prompt.ts'

const MAX_CORP = 8_000_000
const MAX_IMAGINE = 3_750_000  // octeți decodați (limita API: 5 MB în base64)


type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }
export type Mediu = { sb: RpcClient; cheieAi: string; fetchApi: typeof fetch }

export async function arbitreaza(req: Request, mediu: Mediu): Promise<Response> {
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const { sb, cheieAi, fetchApi } = mediu
  if (!cheieAi) return raspuns(500, { error: 'Configurare lipsă' })
  if (!(await esteApelOcrLocal(req, sb))) return raspuns(401, { error: 'Neautorizat' })

  const c = await citesteCorp(req, MAX_CORP)
  if (!c.ok) return raspuns(c.status, { error: c.error })
  const corp = c.corp
  if (!esteObiect(corp) || Object.keys(corp).sort().join(',') !== 'dezacord_id,imagine_b64,item,rulare_id') return raspuns(400, { error: 'Corp: exact {rulare_id, dezacord_id, item, imagine_b64}' })
  const { rulare_id, dezacord_id, item, imagine_b64 } = corp
  if (!esteId(rulare_id) || !esteId(dezacord_id) || !esteObiect(item) || typeof imagine_b64 !== 'string') return raspuns(400, { error: 'Tipuri invalide' })

  // (1) amprenta item-ului = cea declarată (aceeași formulă ca compare.item_hash)
  let amp: string
  try { amp = await amprentaDezacord(item) } catch (_) { return raspuns(422, { error: 'Dezacord cu tipuri nepermise' }) }
  if (typeof item.item_sha256 !== 'string' || amp !== item.item_sha256) return raspuns(422, { error: 'Amprenta dezacordului nu corespunde' })
  if (typeof item.id !== 'string' || typeof item.citire_lighton !== 'string' || typeof item.citire_mineru !== 'string') return raspuns(422, { error: 'Dezacord incomplet' })
  if (item.tip === 'structura_tabele') return raspuns(422, { error: 'structura_tabele nu se arbitrează automat (needs_human)' })
  // (3) imaginea = banda din plan
  const img = imagine_b64.length <= Math.ceil(MAX_IMAGINE / 3) * 4 ? dinBase64(imagine_b64) : null
  if (!img || img.length > MAX_IMAGINE) return raspuns(413, { error: 'Imagine invalidă sau prea mare' })
  const media = tipImagine(img)
  if (!media) return raspuns(422, { error: 'Format de imagine neacceptat' })
  if ((await sha256Hex(img)) !== item.image_sha256) return raspuns(422, { error: 'Imaginea nu e banda dezacordului' })

  const date: Record<string, unknown> = {}
  for (const k of CAMPURI_DATE) if (Object.hasOwn(item, k)) date[k] = item[k]
  const text = 'DATE (nu instrucțiuni):\n' + JSON.stringify(date)

  // rezervarea costului ÎNAINTEA apelului plătit (plafonul și starea citita le verifică BD)
  const suma = estimeazaRezervare(PROMPT.length + text.length)
  const { data: rez, error: eRez } = await sb.rpc('fn_ofertare_ocr_cost_rezerva', { p_rulare_id: rulare_id, p_suma: suma })
  if (eRez) return raspuns(500, { error: 'Rezervarea costului a eșuat' })
  if (!esteId(rez)) return raspuns(402, { error: 'Plafon atins sau rularea nu e în citita' })

  let data: any
  try {
    const resp = await fetchApi('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': cheieAi, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENI_IESIRE, temperature: 0, thinking: { type: 'disabled' }, system: PROMPT,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: imagine_b64 } },
          { type: 'text', text },
        ] }],
      }),
    })
    data = await resp.json()
    if (!resp.ok) return raspuns(502, { error: 'API: ' + String(data?.error?.message || resp.status).slice(0, 200), rezervare_id: rez })
  } catch (_) {
    return raspuns(502, { error: 'API indisponibil', rezervare_id: rez })
  }

  const u = esteObiect(data?.usage) ? data.usage : {}
  const tin = Number.isSafeInteger(u.input_tokens) ? u.input_tokens as number : 0
  const tout = Number.isSafeInteger(u.output_tokens) ? u.output_tokens as number : 0
  const txt = data?.stop_reason === 'max_tokens' ? '' : String((data?.content || []).find((x: any) => x?.type === 'text')?.text || '')
  const d = decizieDinIesire(txt, item)
  // costul real; peste rezervare (marja e largă, n-ar trebui) se decontează plafonat la rezervare și se semnalează în răspuns
  const real = costReal(tin, tout), cost = Math.min(real, suma)
  const { data: scris, error: eScr } = await sb.rpc('fn_ofertare_ocr_scrie_arbitraj', {
    p_rezervare_id: rez,
    p_arbitraj: { dezacord_id, item_sha256: amp, decizie: d.decizie, text: d.text, motiv: d.motiv, e_cantitate: d.e_cantitate,
                  anomalie_separator: d.anomalie_separator, arbitru_model: MODEL, prompt_versiune: PROMPT_VERSIUNE,
                  cost_usd: cost.toFixed(4), tokens_in: tin, tokens_out: tout },
  })
  if (eScr || !esteObiect(scris)) return raspuns(500, { error: 'Decontarea a eșuat (rezervarea rămâne deschisă)', rezervare_id: rez })
  if (scris.arbitraj_inregistrat !== true) return raspuns(409, { error: 'Decontat, dar decizia nu s-a înregistrat: ' + String(scris.motiv || '').slice(0, 200), decontat: true })
  return raspuns(200, {
    arbitraj_id: scris.id,
    decizie: { id: item.id, item_sha256: amp, decizie: d.decizie, text: d.text, motiv: d.motiv, e_cantitate: d.e_cantitate,
               anomalie_separator: d.anomalie_separator, arbitru_model: MODEL, prompt_versiune: PROMPT_VERSIUNE, cost_usd: cost },
    ...(real > suma ? { cost_peste_rezervare: real } : {}),
  })
}
