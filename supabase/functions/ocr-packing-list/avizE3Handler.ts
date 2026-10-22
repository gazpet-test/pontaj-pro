import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { costApel, mesajRefuz, textRaspuns } from '../_shared/haiku55.ts'
import { faraGandire } from '../_shared/gandire.ts'
import { atribuireValidaE3, EroareE3, MAX_INPUT_E3, MAX_TOKENS_E3, MODEL_E3, normalizeazaE3, promptE3, REZERVA_E3, valideazaCerereE3 } from './avizE3.ts'

export async function citesteAvizE3(req: Request, body: Record<string, unknown>, caller: SupabaseClient, ledger: SupabaseClient, apiKey: string | undefined, cors: Record<string, string>) {
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
    const b = valideazaCerereE3(body)
    if (!req.headers.get('Authorization')?.startsWith('Bearer ')) return raspuns(403, { success: false, eroare: 'fara_drept' })
    const { data: auth, error: authError } = await caller.auth.getUser()
    const user = auth?.user
    if (authError || !user) return raspuns(403, { success: false, eroare: 'fara_drept' })
    // Toate citirile de drepturi sunt cu JWT-ul apelantului, inclusiv profiles: RLS rămâne activ.
    const { data: profile, error: pe } = await caller.from('profiles').select('is_owner').eq('id', user.id).maybeSingle()
    if (pe || !profile) return raspuns(403, { success: false, eroare: 'fara_drept' })
    if (profile.is_owner !== true) {
      const { data: acces, error: ae } = await caller.from('user_module_access').select('access_level').eq('profile_id', user.id).eq('module', 'magazie').in('access_level', ['editor', 'admin']).limit(1)
      if (ae || !acces?.length) return raspuns(403, { success: false, eroare: 'fara_drept' })
      const { data: atribuiri, error: ie } = await caller.from('izo_atribuiri').select('proiect_id,depozit_id,rol,activ,valabil_de,valabil_pana').eq('profile_id', user.id).eq('proiect_id', b.proiect_id).eq('depozit_id', b.depozit_id).eq('rol', 'gestionar').eq('activ', true)
      const azi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      if (ie || !atribuiri?.some(a => atribuireValidaE3(a, b.proiect_id, b.depozit_id, azi))) return raspuns(403, { success: false, eroare: 'fara_drept' })
    }
    if (!apiKey) return raspuns(503, { success: false, eroare: 'ai_neconfigurat' })
    const cheie = `izo_e3_ocr:${b.proiect_id}`
    const citestePlafon = async (luna?: string) => {
      let q = ledger.from('ai_plafon_lunar').select('cheie,luna,plafon_usd,consumat_usd,rezervat_usd').eq('cheie', cheie)
      q = luna ? q.eq('luna', luna) : q.order('luna', { ascending: false }).limit(1)
      const { data, error } = await q.maybeSingle()
      if (error) throw new EroareE3('plafon_indisponibil', 503)
      return data
    }
    const { data: id, error: re } = await ledger.rpc('fn_ai_plafon_rezerva', { p_cheie: cheie, p_suma: REZERVA_E3, p_plafon_implicit: 10, p_user: user.id })
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
      model: MODEL_E3, system: promptE3(b.sablon),
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.pdf_base64 } },
        { type: 'text', text: 'Citește documentul și propune valorile tipărite pentru verificare umană.' },
      ] }],
    }
    const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    // 8 MB nu limitează tokenii unui PDF. Endpoint gratuit, fără generare; lipsa numărării => fail closed.
    const count = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers, body: JSON.stringify({ ...payload, thinking: faraGandire(MODEL_E3) }), signal: AbortSignal.timeout(30000) })
    // Numărarea e gratuită: dacă pică, nu s-a cheltuit nimic → cost 0, rezerva se eliberează (Jak E9 r1 P2).
    if (!count.ok) { cost = 0; throw new EroareE3('numarare_indisponibila', 502) }
    const tokens = await count.json().then(j => j.input_tokens).catch(() => null)
    if (!Number.isSafeInteger(tokens) || tokens <= 0) { cost = 0; throw new EroareE3('numarare_indisponibila', 502) }
    if (tokens > MAX_INPUT_E3) { cost = 0; throw new EroareE3('pdf_prea_multi_tokeni') }
    cost = null
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ ...payload, max_tokens: MAX_TOKENS_E3, thinking: faraGandire(MODEL_E3) }), signal: AbortSignal.timeout(90000) })
    if (!r.ok) throw new EroareE3('apel_ai_esuat', 502)
    const result = await r.json()
    // Usage absent/incomplet => nu subraportăm costul ca zero. Rezerva rămâne consumată integral.
    if (Number.isSafeInteger(result.usage?.input_tokens) && result.usage.input_tokens >= 0 && Number.isSafeInteger(result.usage?.output_tokens) && result.usage.output_tokens >= 0) cost = costApel(MODEL_E3, result.usage)
    await deconteaza() // inclusiv la refuz, trunchiere sau JSON invalid: apelul a costat.
    if (result.stop_reason === 'max_tokens') throw new EroareE3('raspuns_ai_incomplet')
    if (mesajRefuz(result)) throw new EroareE3('refuz_ai')
    const propunere = normalizeazaE3(textRaspuns(result), b.sablon)
    const { data: rezervata, error: le } = await ledger.from('ai_plafon_rezervari').select('luna').eq('id', rezervare).single()
    if (le || !rezervata) throw new EroareE3('plafon_indisponibil', 503)
    return raspuns(200, { success: true, tip: 'aviz_e3', sablon: b.sablon, ...propunere, model: MODEL_E3, cost_usd: cost ?? REZERVA_E3, plafon: await citestePlafon(rezervata.luna) })
  } catch (e) {
    try { await deconteaza() } catch { return raspuns(503, { success: false, eroare: 'decontare_indisponibila' }) }
    return raspuns(e instanceof EroareE3 ? e.status : 502, { success: false, eroare: e instanceof EroareE3 ? e.cod : 'serviciu_indisponibil' })
  }
}
