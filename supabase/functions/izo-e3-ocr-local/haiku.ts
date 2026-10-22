import { costApel, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { faraGandire } from '../_shared/gandire.ts'
import { EroareE3, MAX_INPUT_E3, MODEL_E3, REZERVA_E3 } from '../ocr-packing-list/avizE3.ts'
import { primul, rpc, stare, type Client, type Drept } from './rpc.ts'

type Opt = { client: Client; id: string; ramura: 'arbitraj' | 'fallback'; token: string | null; user: string | null; apiKey?: string;
  mesaj: (d: Drept) => Promise<Record<string, unknown>>; maxTokens: number;
  valida: (v: string, cost: number) => Promise<Record<string, unknown>>; transport?: typeof fetch }
export type Apel = { tip: 'raspuns'; rezultat: Record<string, unknown> } | { tip: 'stare'; rezultat: Awaited<ReturnType<typeof stare>> } | { tip: 'eroare'; cod: string }

// O singură cale de cheltuială. B1 deține dreptul, rezerva legată și decontarea.
export async function apelPlatitE3(o: Opt): Promise<Apel> {
  const d = primul<Drept>(await rpc(o.client, 'drept_platit', { p_id: o.id, p_ramura: o.ramura, p_token: o.token, p_user: o.user }))
  if (!d.acordat) return { tip: 'stare', rezultat: await stare(o.client, o.id, d.user) }
  let rezervare: number | null = null, trimis = false, raspunsSalvat = false
  const faza = (p_faza: string, p_raspuns: Record<string, unknown> | null = null, p_cost: number | null = null) => rpc(o.client, 'apel_faza', { p_id: o.id, p_faza, p_rezervare: rezervare, p_raspuns, p_cost })
  try {
    if (!o.apiKey) throw new EroareE3('ai_neconfigurat', 503)
    const r = primul<{ acordat: boolean; rezervare_id: number; status: string }>(await rpc(o.client, 'rezerva_apel', { p_id: o.id }))
    if (!r.acordat) return { tip: 'eroare', cod: r.status === 'plafon_depasit' ? 'plafon_depasit' : 'deja_consumat' }
    rezervare = Number(r.rezervare_id)
    if (!Number.isSafeInteger(rezervare) || rezervare <= 0) throw new EroareE3('rezervare_indisponibila', 503)
    const payload = { ...await o.mesaj(d), model: MODEL_E3, thinking: faraGandire(MODEL_E3) }
    const headers = { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    const transport = o.transport ?? fetch
    let count: Response
    try { count = await transport('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) }) }
    catch { throw new EroareE3('numarare_indisponibila', 502) }
    const n = count.ok ? await count.json().then(j => j.input_tokens).catch(() => null) : null
    if (!Number.isSafeInteger(n) || n <= 0) throw new EroareE3('numarare_indisponibila', 502)
    if (n > MAX_INPUT_E3) throw new EroareE3('pdf_prea_multi_tokeni')
    // Dacă ACK-ul se pierde nu trimitem fetch; nu încercăm avansul înapoi.
    trimis = true
    await faza('trimis')
    const response = await transport('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...payload, max_tokens: o.maxTokens }), signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new EroareE3('apel_ai_esuat', 502)
    const result = await response.json()
    const usage = result.usage
    const validUsage = usage && ['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0) &&
      ['cache_read_input_tokens', 'cache_creation_input_tokens'].every(k => usage[k] === undefined || Number.isSafeInteger(usage[k]) && usage[k] >= 0)
    const cost = validUsage ? costApel(MODEL_E3, usage) : null
    let validat: Record<string, unknown>
    try {
      if (result.stop_reason === 'max_tokens') throw new EroareE3('raspuns_ai_incomplet')
      if (mesajRefuz(result)) throw new EroareE3('refuz_ai')
      validat = await o.valida(textRaspuns(result), cost ?? REZERVA_E3)
    } catch (e) { validat = { invalid: true, motiv: e instanceof EroareE3 ? e.cod : 'raspuns_ai_invalid' } }
    await faza('raspuns', validat)
    raspunsSalvat = true
    // Usage lipsă: esuat_dupa nu poate urma după raspuns. Păstrăm răspunsul;
    // recuperarea B1 îl decontează conservator cu NULL, fără nou apel.
    if (cost === null) return { tip: 'eroare', cod: 'in_curs' }
    await faza('decontat', null, cost)
    return validat.invalid === true ? { tip: 'eroare', cod: String(validat.motiv) } : { tip: 'raspuns', rezultat: validat }
  } catch (e) {
    // După răspuns persistat, recovery B1 poate restitui rezultatul; nu îl anulăm.
    if (!raspunsSalvat) {
      try { await faza(trimis ? 'esuat_dupa' : 'esuat_inainte') }
      catch { return { tip: 'eroare', cod: 'in_curs' } }
    } else return { tip: 'eroare', cod: 'in_curs' }
    return { tip: 'eroare', cod: e instanceof EroareE3 ? e.cod : 'apel_ai_esuat' }
  }
}
