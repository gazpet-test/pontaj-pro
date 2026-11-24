import { costApel, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { faraGandire } from '../_shared/gandire.ts'
import { EroareE3, MODEL_LOCAL_E3, limitaInputE3, rezervaE3 } from '../ocr-packing-list/avizE3.ts'
import { primul, rpc, stare, type Client, type Drept } from './rpc.ts'

type Opt = { client: Client; id: string; ramura: 'arbitraj' | 'fallback'; token: string | null; user: string | null; apiKey?: string;
  mesaj: (d: Drept) => Promise<Record<string, unknown>>; maxTokens: number;
  valida: (v: string, cost: number) => Promise<Record<string, unknown>>; transport?: typeof fetch; acum?: () => number }
export type Apel = { tip: 'raspuns'; rezultat: Record<string, unknown> } | { tip: 'stare'; rezultat: Awaited<ReturnType<typeof stare>> } | { tip: 'eroare'; cod: string }

// Modelul NU e parametru: ambele ramuri plătite (fallback după citirea locală, arbitrajul celulelor) citesc cu Sonnet 5.5
// (decizia Răzvan 24.11.2026). Costul maxim al unui apel = intrarea plafonată de numărare + max_tokens, la tariful Sonnet.
export const costMaximApelE3 = (maxTokens: number) => costApel(MODEL_LOCAL_E3, { input_tokens: limitaInputE3(MODEL_LOCAL_E3), output_tokens: maxTokens })
// Termenele apelului plătit, măsurate de la dreptul acordat de B1. Fallback: B1 închide ramura la drept + apel_s (120 s), iar
// inchide_fallback trebuie să ajungă înainte → bugetul = 120 s − 15 s marjă. Arbitraj: workerul așteaptă răspunsul 35 s.
// Sub minApel nu mai pornim apelul plătit (cost 0, esuat_inainte). Numărarea (gratuită) are cel mult 30 s.
export const TERMENE_PLATIT_E3 = Object.freeze({ fallback: { buget: 105000, minApel: 20000 }, arbitraj: { buget: 33000, minApel: 8000 }, numarare: 30000 })

// O singură cale de cheltuială. B1 deține dreptul, rezerva legată și decontarea.
export async function apelPlatitE3(o: Opt): Promise<Apel> {
  const acum = o.acum ?? Date.now, T = TERMENE_PLATIT_E3[o.ramura], termen = acum() + T.buget
  const ramas = () => termen - acum()
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
    // Suma rezervată vine din BD (ocr_local_config.rezerva_usd). Dacă nu acoperă costul maxim Sonnet (BD încă la 0,05, edge publicat
    // înaintea migrării 20270109a, sau migrarea revenită), refuzăm ÎNAINTE de orice apel: cost 0, rezerva eliberată (fail-closed).
    const { data: rz, error: rze } = await o.client.from('ai_plafon_rezervari').select('suma_rezervata').eq('id', rezervare).single()
    // numeric vine ca text din PostgREST; NULL / gol / text nenumeric = necunoscut (nu 0)
    const v = (rz as { suma_rezervata?: unknown } | null)?.suma_rezervata
    const suma = typeof v === 'number' || typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (rze || !Number.isFinite(suma)) throw new EroareE3('rezervare_indisponibila', 503)
    if (suma < costMaximApelE3(o.maxTokens)) throw new EroareE3('rezerva_insuficienta', 503)
    const payload = { ...await o.mesaj(d), model: MODEL_LOCAL_E3, thinking: faraGandire(MODEL_LOCAL_E3) }
    const headers = { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    const transport = o.transport ?? fetch
    let count: Response
    try { count = await transport('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.max(1, Math.min(TERMENE_PLATIT_E3.numarare, ramas()))) }) }
    catch { throw new EroareE3('numarare_indisponibila', 502) }
    const n = count.ok ? await count.json().then(j => j.input_tokens).catch(() => null) : null
    if (!Number.isSafeInteger(n) || n <= 0) throw new EroareE3('numarare_indisponibila', 502)
    if (n > limitaInputE3(MODEL_LOCAL_E3)) throw new EroareE3('pdf_prea_multi_tokeni')
    // Nu mai e timp pentru apel + marja de închidere: apelul plătit nu pornește (cost 0, rezerva eliberată).
    const timpApel = ramas()
    if (timpApel < T.minApel) throw new EroareE3('termen_depasit', 504)
    // Dacă ACK-ul se pierde nu trimitem fetch; nu încercăm avansul înapoi.
    trimis = true
    await faza('trimis')
    const response = await transport('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...payload, max_tokens: o.maxTokens }), signal: AbortSignal.timeout(timpApel) })
    if (!response.ok) throw new EroareE3('apel_ai_esuat', 502)
    const result = await response.json()
    const usage = result.usage
    const validUsage = usage && ['input_tokens', 'output_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0) &&
      ['cache_read_input_tokens', 'cache_creation_input_tokens'].every(k => usage[k] === undefined || Number.isSafeInteger(usage[k]) && usage[k] >= 0)
    const cost = validUsage ? costApel(MODEL_LOCAL_E3, usage) : null
    let validat: Record<string, unknown>
    try {
      if (result.stop_reason === 'max_tokens') throw new EroareE3('raspuns_ai_incomplet')
      if (mesajRefuz(result)) throw new EroareE3('refuz_ai')
      validat = await o.valida(textRaspuns(result), cost ?? rezervaE3(MODEL_LOCAL_E3))
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
