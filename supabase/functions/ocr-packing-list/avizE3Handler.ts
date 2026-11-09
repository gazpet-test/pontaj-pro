import { utilizatorE3, verificaPoartaE3 } from '../_shared/izoE3Poarta.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { costApel, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { faraGandire } from '../_shared/gandire.ts'
import { EroareE3, MAX_TOKENS_E3, TERMENE_E3, limitaInputE3, normalizeazaE3, promptE3, rezervaE3, valideazaCerereE3, verificaSeriiE3 } from './avizE3.ts'

// Dependențe injectabile DOAR pentru teste (ceas, transport, termene); producția folosește Date.now / fetch / TERMENE_E3.
export type DepsE3 = { acum?: () => number; transport?: typeof fetch; termene?: typeof TERMENE_E3 }

export async function citesteAvizE3(req: Request, body: Record<string, unknown>, caller: SupabaseClient, ledger: SupabaseClient, apiKey: string | undefined, cors: Record<string, string>, deps: DepsE3 = {}) {
  const acum = deps.acum ?? Date.now, transport = deps.transport ?? fetch, T = deps.termene ?? TERMENE_E3
  const final = acum() + T.total   // termen GLOBAL al cererii, de la intrarea în handler (P1-02 r2)
  const ramasApel = () => final - T.marja - acum()
  const expirat = (e: unknown) => e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
  const raspuns = (status: number, data: Record<string, unknown>) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  let rezervare: number | null = null
  // 0 până imediat înaintea apelului plătit (numărarea e gratuită); null = cost necunoscut după pornirea generării (Jak E9 r2 P2)
  let cost: number | null = 0
  let decontareIncercata = false
  const deconteaza = async () => {
    if (rezervare === null || decontareIncercata) return
    decontareIncercata = true // Nicio reluare automată, nici la timeout.
    const { error } = await ledger.rpc('fn_ai_plafon_deconteaza', { p_id: rezervare, p_cost_real: cost })
    if (error) throw new EroareE3('decontare_indisponibila', 503)
  }
  try {
    if (req.method !== 'POST') return raspuns(405, { success: false, eroare: 'metoda_invalida' })
    const b = valideazaCerereE3(body), model = b.model, rezerva = rezervaE3(model)
    const user = { id: await utilizatorE3(req, caller) }
    await verificaPoartaE3(caller, user.id, b.proiect_id, b.depozit_id)
    if (!apiKey) return raspuns(503, { success: false, eroare: 'ai_neconfigurat' })
    const cheie = `izo_e3_ocr:${b.proiect_id}`
    const citestePlafon = async (luna?: string) => {
      let q = ledger.from('ai_plafon_lunar').select('cheie,luna,plafon_usd,consumat_usd,rezervat_usd').eq('cheie', cheie)
      q = luna ? q.eq('luna', luna) : q.order('luna', { ascending: false }).limit(1)
      const { data, error } = await q.maybeSingle()
      if (error) throw new EroareE3('plafon_indisponibil', 503)
      return data
    }
    const { data: id, error: re } = await ledger.rpc('fn_ai_plafon_rezerva', { p_cheie: cheie, p_suma: rezerva, p_plafon_implicit: 10, p_user: user.id })
    if (re) {
      if (re.code === 'P0001' && re.message.includes('plafon_depasit')) {
        let plafon = null
        try { plafon = JSON.parse(re.details) } catch { /* server mai vechi: citire explicită a lunii UTC */ }
        return raspuns(429, { success: false, eroare: 'plafon_depasit', plafon: plafon ?? await citestePlafon(new Date().toISOString().slice(0, 7) + '-01') })
      }
      return raspuns(503, { success: false, eroare: 'rezervare_indisponibila' })
    }
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new EroareE3('rezervare_indisponibila', 503)
    rezervare = Number(id)
    const payload = {
      model, system: promptE3(b.sablon),
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.pdf_base64 } },
        { type: 'text', text: 'Citește documentul și propune valorile tipărite pentru verificare umană.' },
      ] }],
    }
    const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    // 8 MB nu limitează tokenii unui PDF. Endpoint gratuit, fără generare; lipsa numărării => fail closed.
    const count = await transport('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers, body: JSON.stringify({ ...payload, thinking: faraGandire(model) }), signal: AbortSignal.timeout(Math.max(1, Math.min(T.numarare, ramasApel()))) })
    // Numărarea e gratuită: dacă pică, nu s-a cheltuit nimic → cost 0, rezerva se eliberează (Jak E9 r1 P2).
    if (!count.ok) { cost = 0; throw new EroareE3('numarare_indisponibila', 502) }
    const tokens = await count.json().then(j => j.input_tokens).catch(() => null)
    if (!Number.isSafeInteger(tokens) || tokens <= 0) { cost = 0; throw new EroareE3('numarare_indisponibila', 502) }
    // Plafonul de intrare e impus AICI, pe numărarea întregului corp (PDF/imagini + system), înainte de apelul plătit (P1-01 r2).
    if (tokens > limitaInputE3(model)) { cost = 0; throw new EroareE3('pdf_prea_multi_tokeni') }
    // Nu mai e timp pentru apel + marja de după el → apelul plătit nu pornește (cost 0, rezerva eliberată).
    const timpApel = ramasApel()
    if (timpApel < T.minApel) { cost = 0; throw new EroareE3('termen_depasit', 504) }
    cost = null
    let result
    const semnal = AbortSignal.timeout(timpApel)
    // Și antetul, și corpul răspunsului concurează cu termenul: un răspuns sosit după termen e abandonat, nu folosit
    // (chiar dacă transportul n-ar respecta semnalul).
    const cuTermen = <X>(p: Promise<X>) => Promise.race([p, new Promise<never>((_, nu) => {
      if (semnal.aborted) nu(semnal.reason); else semnal.addEventListener('abort', () => nu(semnal.reason), { once: true })
    })])
    try {
      const r = await cuTermen(transport('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...payload, max_tokens: MAX_TOKENS_E3, thinking: faraGandire(model) }), signal: semnal }))
      if (!r.ok) throw new EroareE3('apel_ai_esuat', 502)
      result = await cuTermen(r.json())
    } catch (e) { throw expirat(e) ? new EroareE3('termen_depasit', 504) : e }   // cost rămâne null = rezultat necunoscut
    // Usage absent/incomplet => nu subraportăm costul ca zero. Rezerva rămâne consumată integral.
    if (Number.isSafeInteger(result.usage?.input_tokens) && result.usage.input_tokens >= 0 && Number.isSafeInteger(result.usage?.output_tokens) && result.usage.output_tokens >= 0) cost = costApel(model, result.usage)
    await deconteaza() // inclusiv la refuz, trunchiere sau JSON invalid: apelul a costat.
    if (result.stop_reason === 'max_tokens') throw new EroareE3('raspuns_ai_incomplet')
    if (mesajRefuz(result)) throw new EroareE3('refuz_ai')
    const propunere = normalizeazaE3(textRaspuns(result), b.sablon)
    verificaSeriiE3(propunere, b.sablon)   // serie repetată / serie = șarjă → 422 serie_repetata, fără propunere
    const { data: rezervata, error: le } = await ledger.from('ai_plafon_rezervari').select('luna').eq('id', rezervare).single()
    if (le || !rezervata) throw new EroareE3('plafon_indisponibil', 503)
    return raspuns(200, { success: true, tip: 'aviz_e3', sablon: b.sablon, ...propunere, model, cost_usd: cost ?? rezerva, plafon: await citestePlafon(rezervata.luna) })
  } catch (e) {
    try { await deconteaza() } catch { return raspuns(503, { success: false, eroare: 'decontare_indisponibila' }) }
    return raspuns(e instanceof EroareE3 ? e.status : 502, { success: false, eroare: e instanceof EroareE3 ? e.cod : 'serviciu_indisponibil' })
  }
}
