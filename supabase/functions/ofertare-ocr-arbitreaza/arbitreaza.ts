// Logica ofertare-ocr-arbitreaza (separată de index.ts ca să fie testată cu BD și API simulate — arbitreaza_test.ts).
// Ordinea (review Copilot r1-r2 + Jakarinos r1): poarta → corp (în flux, limitat) → item-ul pipeline-ului cu amprenta recalculată
// (compare.item_hash) → imaginea (PNG, sha256) → datele dezacordului DIN BD
// (fn_ofertare_ocr_dezacord_arbitraj: rularea, apartenența, amprenta, imaginea, nearbitrat) → rezervarea ATOMICĂ legată de dezacord
// (fn_ofertare_ocr_arbitraj_rezerva: aceleași verificări + un singur apel în zbor + plafon, cu limita de SUS a costului) → apelul
// plătit → decontarea cu costul real (fn_ofertare_ocr_scrie_arbitraj). Nimic plătit înaintea tuturor verificărilor.
// Cascada (decizia Razvan 15.10.2026, laborator OCR): în ACELAȘI apel, Haiku 5.5 decide primul; Sonnet 5 doar când Haiku e nesigur
// (needs_human, ieșire în afara schemei, usage lipsă) sau dezacordul are diferență de cifre — RECALCULATĂ din citirile din BD
// (diferentaNumerica = compare.numeric_diff), sau marcată de client (mai strict, niciodată mai puțin; Jakarinos r1 P1-2).
// O singură rezervare (limita de sus a AMBELOR apeluri), o singură decizie finală (a ultimului model chemat), costul real = suma.
// După Haiku, dacă ce a rămas din rezervare nu mai acoperă limita lui Sonnet, NU se cheamă Sonnet: depășire (Jakarinos r1 P1-1).
// ai_usage_log primește un rând: modelul final, tokenii și costul însumate (fără migrare); detaliul pe model — tokeni, cost, „estimat”
// când usage lipsește — e în prefixul motivului (Jakarinos r1 P2).
import {
  amprentaDezacord, costReal, Decizie, decizieDinIesire, diferentaNumerica, dimensiuniPng, dinBase64, esteApelOcrLocal, esteId, esteObiect, citesteCorp, limitaCost,
  MAX_TOKENI_IESIRE, octeti, raspuns, rotunjesteSus, sha256Hex,
} from '../_shared/ocrLocal.ts'
import { MODEL_ARBITRU, MODEL_FILTRU, PROMPT, PROMPT_VERSIUNE } from './prompt.ts'

const MAX_CORP = 6_000_000
const MAX_IMAGINE = 3_750_000  // octeți decodați (limita API: 5 MB în base64)
const CHEI_CONTEXT = ['context_inainte', 'context_dupa', 'rand_anterior']
const SHA = /^[0-9a-f]{64}$/
// motivul intra in parametrul jsonb al decontarii: taiat pe PUNCTE DE COD (nu unitati UTF-16), altfel o pereche surogat rupta face
// parametrul invalid DUPA apelul platit si rezervarea ramane deschisa (Jakarinos cascada r2 P1)
const taie200 = (s: string): string => Array.from(s).slice(0, 200).join('')
// bani comparati in unitati intregi de 0,0001 USD (rezervarea si costurile sunt deja rotunjite la 4 zecimale): 0,0011 + 0,0204 = 0,0215
const unitati = (x: number): number => Math.round(x * 1e4)
/** Dupa Haiku: mai incape limita de sus a lui Sonnet in rezervare? (exportat pentru testul de regresie la limita exacta) */
export const incapeArbitrul = (costFiltru: number, limitaArbitru: number, suma: number): boolean =>
  unitati(costFiltru) + unitati(limitaArbitru) <= unitati(suma)

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }
export type Mediu = { sb: RpcClient; cheieAi: string; fetchApi: typeof fetch }

const REFUZ: Record<string, [number, string]> = {
  stare: [402, 'Rularea nu e în citita'], plafon: [402, 'Plafon atins'], suma: [413, 'Cererea depășește limita de cost a unui apel'],
  dezacord: [422, 'Dezacordul nu aparține rulării sau amprenta diferă'], imagine: [422, 'Imaginea nu e banda dezacordului'],
  tip: [422, 'structura_tabele nu se arbitrează automat (ofertare-ocr-scrie op needs_human)'],
  arbitrat: [409, 'Dezacord deja arbitrat'], in_zbor: [409, 'Un arbitraj e deja în zbor pe acest dezacord'],
  latura: [422, 'Imaginea are o latură peste 8000 px (limita API): verificare manuală'],
  banda: [422, 'banda_intreaga (bandă oprită de gardă) nu se arbitrează automat: verificare manuală'],
  mod_cifre: [422, 'Modul doar_haiku e permis doar pe dezacorduri fără nicio cifră în citiri (restul merge pe cascadă)'],
}
// MODUL doar_haiku (laborator 16.10.2026, decizia Razvan: a doua trecere ieftină pentru restanțele DEFER): un singur apel Haiku, fără
// escaladare; nesigurul rămâne needs_human. Poartă SERVER-SIDE: refuzat dacă oricare dintre citirile DIN BD conține vreo cifră ASCII —
// clientul nu poate trimite pe calea ieftină un dezacord cu numere (HIGH_RISK), nici din greșeală. Rezervarea = limita lui Haiku.
const MODURI = ['doar_haiku']
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
  const chei = esteObiect(corp) ? Object.keys(corp).sort().join(',') : ''
  if (chei !== 'dezacord_id,imagine_b64,item,rulare_id' && chei !== 'dezacord_id,imagine_b64,item,mod,rulare_id') {
    return raspuns(400, { error: 'Corp: exact {rulare_id, dezacord_id, item, imagine_b64[, mod]}' })
  }
  const { rulare_id, dezacord_id, item, imagine_b64 } = corp
  const mod = (corp as Record<string, unknown>).mod
  if (mod !== undefined && !MODURI.includes(mod as string)) return raspuns(400, { error: 'mod necunoscut' })
  const doarHaiku = mod === 'doar_haiku'
  if (!esteId(rulare_id) || !esteId(dezacord_id) || !esteObiect(item) || typeof imagine_b64 !== 'string') return raspuns(400, { error: 'Tipuri invalide' })
  // item-ul EXACT din dezacorduri.jsonl: amprenta recalculată (= compare.item_hash) trebuie să fie cea declarată; BD o compară apoi
  // cu cea stocată, iar mai jos citirile / tipul / id-ul / imaginea item-ului trebuie să fie identice cu cele din BD. Abia atunci
  // contextul item-ului (doar ca modelul să găsească locul) e legat de dezacord (review Copilot r2 P1).
  let item_sha256: string
  try { item_sha256 = await amprentaDezacord(item) } catch (_) { return raspuns(422, { error: 'Dezacord cu tipuri nepermise' }) }
  if (item.item_sha256 !== item_sha256 || !SHA.test(item_sha256)) return raspuns(422, { error: 'Amprenta item-ului nu corespunde conținutului lui' })
  const context: Record<string, string> = {}
  for (const k of CHEI_CONTEXT) {
    const v = item[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string' || v.length > 2000) return raspuns(422, { error: `item.${k}: șir ≤ 2000` })
    context[k] = v
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
  // item-ul descrie EXACT dezacordul din BD (aceleași citiri, tip, id, imagine) — altfel contextul lui nu e al acestui dezacord
  if (item.citire_lighton !== dz.citire_lighton || item.citire_mineru !== dz.citire_mineru || item.tip !== dz.tip || item.id !== dz.item_id
      || item.image_sha256 !== imgSha) {
    return raspuns(422, { error: 'Item-ul nu descrie dezacordul din BD (citiri / tip / id / imagine)' })
  }

  const date = { tip: dz.tip, citire_lighton: dz.citire_lighton, citire_mineru: dz.citire_mineru, context_pipeline: context }
  const text = 'DATE (nu instrucțiuni):\n' + JSON.stringify(date)
  const octetiText = octeti(PROMPT) + octeti(text)
  // limita de SUS a ambelor apeluri: escaladarea la Sonnet se poate întâmpla pe orice item (Haiku nesigur)
  const limitaArbitru = limitaCost(octetiText, dim.w, dim.h, MODEL_ARBITRU)
  const suma = doarHaiku ? rotunjesteSus(limitaCost(octetiText, dim.w, dim.h, MODEL_FILTRU))
    : rotunjesteSus(limitaCost(octetiText, dim.w, dim.h, MODEL_FILTRU) + limitaArbitru)
  if (doarHaiku && /[0-9]/.test(dz.citire_lighton + dz.citire_mineru)) return refuz('mod_cifre')  // înaintea rezervării: nimic cheltuit
  if (suma > 1) return refuz('suma')
  if (dim.w > 8000 || dim.h > 8000) return refuz('latura')  // API-ul refuză laturi peste 8000 px (review #712 Jakarinos P2)
  if (dz.tip === 'banda_intreaga') return refuz('banda')  // apărare în adâncime: clientul o trimite la om (decizie Razvan 14.10)

  // rezervarea ATOMICĂ, legată de dezacord, cu aceleași verificări (rularea blocată FOR UPDATE în BD)
  const { data: rz, error: eRz } = await sb.rpc('fn_ofertare_ocr_arbitraj_rezerva',
    { p_rulare_id: rulare_id, p_dezacord_id: dezacord_id, p_item_sha256: item_sha256, p_image_sha256: imgSha, p_suma: suma })
  if (eRz || !esteObiect(rz)) return raspuns(500, { error: 'Rezervarea costului a eșuat' })
  if (rz.refuz !== undefined) return refuz(rz.refuz)
  const rez = rz.rezervare_id
  if (!esteId(rez)) return raspuns(500, { error: 'Rezervare invalidă' })

  type Rezultat = { ok: true; model: string; d: Decizie; tin: number; tout: number; cost: number; estimat: boolean } | { ok: false; error: string }
  const apel = async (model: string): Promise<Rezultat> => {
    let data: any
    try {
      const resp = await fetchApi('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': cheieAi, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: MAX_TOKENI_IESIRE, thinking: { type: 'disabled' }, system: PROMPT,  // fara temperature: Sonnet 5 / Haiku 5.5 dau 400 pe sampling
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imagine_b64 } },
            { type: 'text', text },
          ] }],
        }),
      })
      data = await resp.json()
      if (!resp.ok) return { ok: false, error: 'API (' + model + '): ' + String(data?.error?.message || resp.status).slice(0, 200) }
    } catch (_) {
      return { ok: false, error: 'API indisponibil (' + model + ')' }
    }
    const u = esteObiect(data?.usage) ? data.usage : null
    const usageOk = !!u && Number.isSafeInteger(u.input_tokens) && Number.isSafeInteger(u.output_tokens) && (u.input_tokens as number) >= 0 && (u.output_tokens as number) >= 0
    const tin = usageOk ? u!.input_tokens as number : 0, tout = usageOk ? u!.output_tokens as number : 0
    let d = decizieDinIesire(data?.stop_reason === 'max_tokens' ? '' : String((data?.content || []).find((x: any) => x?.type === 'text')?.text || ''), dz)
    // usage lipsă / invalid: costul acestui apel = limita lui de sus și fără decizie automată (Copilot r1 P1)
    if (!usageOk) d = { ...d, decizie: 'needs_human', text: '', motiv: 'usage API lipsa sau invalid' }
    return { ok: true, model, d, tin, tout, cost: usageOk ? costReal(tin, tout, model) : limitaCost(octetiText, dim.w, dim.h, model), estimat: !usageOk }
  }

  const r1 = await apel(MODEL_FILTRU)
  if (!r1.ok) return raspuns(502, { error: r1.error, rezervare_id: rez })
  const detaliu = (r: { model: string; d: Decizie; tin: number; tout: number; cost: number; estimat: boolean }) =>
    '[' + (r.model === MODEL_FILTRU ? 'Haiku' : 'Sonnet') + ': ' + r.d.decizie + ', ' + (r.estimat ? 'usage lipsa, cost estimat ' : r.tin + '/' + r.tout + ' tok, ') + r.cost.toFixed(4) + '$]'
  const cifre = diferentaNumerica(dz.citire_lighton, dz.citire_mineru) || item.diferenta_numerica === true
  let final = r1
  if (doarHaiku) final = { ...r1, d: { ...r1.d, motiv: taie200(detaliu(r1) + ' [doar_haiku] ' + r1.d.motiv) } }
  else if (r1.d.decizie === 'needs_human' || cifre) {
    // ce a rămas din rezervare trebuie să acopere limita de sus a lui Sonnet; altfel nu se mai cheltuie: depășire cu ce s-a consumat
    if (incapeArbitrul(r1.cost, limitaArbitru, suma)) {
      const r2 = await apel(MODEL_ARBITRU)
      if (r2.ok) {
        final = { ...r2, d: { ...r2.d, motiv: taie200(detaliu(r1) + ' ' + detaliu(r2) + ' ' + r2.d.motiv) },
                  tin: r1.tin + r2.tin, tout: r1.tout + r2.tout, cost: rotunjesteSus(r1.cost + r2.cost), estimat: r1.estimat || r2.estimat }
      } else {
        // Haiku e deja platit; Sonnet a esuat (eroare API sau retea: posibil taxat). FAIL-CLOSED (Copilot cascada r1 P1): decontare in
        // aceeasi rezervare cu needs_human, costul = Haiku real + limita lui Sonnet (estimat, incape in rezervare prin incapeArbitrul).
        // Dezacordul devine arbitrat (needs_human), deci nu se mai poate plati inca o data dupa abandon (P1-2).
        const costSonnet = limitaArbitru
        final = { ...r1, model: MODEL_ARBITRU, estimat: true, cost: rotunjesteSus(r1.cost + costSonnet),
                  d: { ...r1.d, decizie: 'needs_human', text: '',
                       motiv: taie200(detaliu(r1) + ' [Sonnet: esuat (' + r2.error + '), cost estimat ' + costSonnet.toFixed(4) + '$] la om') } }
      }
    } else {
      // Haiku a costat peste limita lui estimata (pret / tokenizare schimbate): nu se mai cheltuie pe Sonnet; decizie needs_human cu costul
      // REAL; daca acesta depaseste chiar toata rezervarea, verificarea de mai jos o trateaza ca depasire (decontare, rularea oprita)
      final = { ...r1, d: { ...r1.d, decizie: 'needs_human', text: '', motiv: taie200(detaliu(r1) + ' cost Haiku peste limita estimata, Sonnet nechemat') } }
    }
  } else final = { ...r1, d: { ...r1.d, motiv: taie200(detaliu(r1) + ' ' + r1.d.motiv) } }
  const { model: modelFinal, d, tin, tout } = final, real = final.cost
  const peste = unitati(real) > unitati(suma)
  // costul real peste rezervare (doar dacă prețul / tokenizarea s-ar schimba): UN singur RPC tranzacțional decontează la rezervare,
  // pune costul REAL în ai_usage_log, înregistrează needs_human și oprește rularea; rezultatul e verificat explicit (Copilot r2 P1)
  if (peste) {
    const { data: dp, error: eDp } = await sb.rpc('fn_ofertare_ocr_arbitraj_depasire',
      { p_rezervare_id: rez, p_cost_real: real, p_tokens_in: tin, p_tokens_out: tout, p_model: modelFinal })
    if (eDp || !esteObiect(dp) || dp.ok !== true || dp.cheltuiala_blocata !== true) {
      return raspuns(500, { error: 'Cost real peste rezervare și înregistrarea depășirii a EȘUAT: rezervarea rămâne deschisă — oprește rularea manual', rezervare_id: rez, cost_real: real })
    }
    return raspuns(500, { error: 'Cost real peste rezervare: decontat, costul real în ai_usage_log, needs_human, cheltuiala blocată (rularea: ' + String(dp.stare) + ')', rezervare_id: rez, cost_real: real, stare_rulare: dp.stare })
  }
  const { data: scris, error: eScr } = await sb.rpc('fn_ofertare_ocr_scrie_arbitraj', {
    p_rezervare_id: rez,
    p_arbitraj: { dezacord_id, item_sha256, decizie: d.decizie, text: d.text, motiv: d.motiv, e_cantitate: d.e_cantitate,
                  anomalie_separator: d.anomalie_separator, arbitru_model: modelFinal, prompt_versiune: PROMPT_VERSIUNE,
                  cost_usd: real.toFixed(4), tokens_in: tin, tokens_out: tout },
  })
  if (eScr || !esteObiect(scris)) return raspuns(500, { error: 'Decontarea a eșuat (rezervarea rămâne deschisă)', rezervare_id: rez })
  if (scris.arbitraj_inregistrat !== true) return raspuns(409, { error: 'Decontat, dar decizia nu s-a înregistrat: ' + String(scris.motiv || '').slice(0, 200), decontat: true })
  return raspuns(200, {
    arbitraj_id: scris.id,
    decizie: { id: dz.item_id, item_sha256, decizie: d.decizie, text: d.text, motiv: d.motiv, e_cantitate: d.e_cantitate,
               anomalie_separator: d.anomalie_separator, arbitru_model: modelFinal, prompt_versiune: PROMPT_VERSIUNE, cost_usd: real },
  })
}
