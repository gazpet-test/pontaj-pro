// redariImportAiHandler.mjs — handler testabil pentru funcția edge redari-import-verificare-ai (Redări, import TGZ pasul 2, 19.11.2026), fără rețea implicită.
// ORDINEA, probată de teste: autentificare (getUser) → cererea (validaCerere: doar cele 3 câmpuri + index) → dreptul pe proiect (RPC
// fn_red_import_ai_poate cu JWT-ul OMULUI — decizia nu e a service_role; verify_jwt singur nu ajunge, PR #318) → cheia API prezentă → REZERVAREA
// durabilă (fn_red_import_ai_rezerva, JWT-ul omului: drept + plafoane + cheie de intenție) → abia apoi apelul plătit → închiderea în jurnal
// (fn_red_import_ai_inchide, service_role, CAS pe id + token). Orice refuz de dinainte = NICIUN apel către Anthropic, nicio rezervare consumată.
// Erorile de business se scriu în jurnal (stare eroare / necunoscut + cod) și se ÎNTORC (nu se aruncă). Nimic din valori nu se loghează.
// Rezultat ambiguu (rețea / timeout / 5xx / corp ilizibil / usage lipsă) = `necunoscut`: costul rămâne cel rezervat, fără reluare automată (L05, L22).
import { MODEL_AI, URL_ANTHROPIC, VERSIUNE_API, TIMEOUT_AI_MS, MAX_OCTETI_CERERE, validaCerere, construiesteCerere, valideazaRaspuns, tokeniDinUsage, costFinal, amprentaContinut } from './redariImportAi.mjs'

const STATUS_REFUZ = { neautentificat: 401, cerere_invalida: 400, fara_drept: 403, cheie_refolosita: 409, plafon_apeluri_zi: 429, plafon_cost_zi: 429, plafon_bucata_zi: 429 }

export async function raspundeVerificare({ jwt, corp }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  // L18: autentificarea indisponibilă (5xx / rețea / fără status) ≠ token invalid
  if (user?.error) return Number.isInteger(user.error.status) && user.error.status >= 400 && user.error.status < 500 ? out(401, 'neautentificat') : out(503, 'autentificare_neconfirmata')
  if (!user?.data?.user?.id) return out(401, 'neautentificat')
  const v = validaCerere(corp)
  if (!v.ok) return out(400, v.cod, { detaliu: v.detaliu })
  const c = v.cerere
  // dreptul pe proiect, cu identitatea apelantului (auth.uid() în SQL); eroare ≠ „nu ai drept” (L18)
  const p = await deps.poate(c.proiect_id)
  if (p?.error) return out(503, 'autorizare_neconfirmata')
  if (p?.data !== true) return out(403, 'fara_drept')
  let cheieApi
  try { cheieApi = deps.cheieApi() } catch { cheieApi = null }
  if (typeof cheieApi !== 'string' || !cheieApi) return out(503, 'ai_neconfigurat')   // înaintea rezervării: nu se consumă plafonul degeaba
  const cerere = construiesteCerere(c.randuri)
  if (cerere.octeti > MAX_OCTETI_CERERE) return out(400, 'cerere_invalida', { detaliu: 'prea_mare' })   // nu se taie (L21); ecranul împarte bucata
  const continut = await amprentaContinut(c.randuri)
  const r = await deps.rezerva({ p_cheie: c.cheie, p_proiect: c.proiect_id, p_fisier_sha256: c.fisier_sha256, p_continut_sha256: continut,
    p_bucata: c.bucata, p_bucati: c.bucati, p_randuri: c.randuri.length, p_octeti: cerere.octeti, p_max_iesire: cerere.corp.max_tokens })
  if (r?.error) return out(503, 'rezervare_neconfirmata')   // poate fi scrisă sau nu: reluarea cu ACEEAȘI cheie lămurește (nou = false)
  const rez = r?.data
  if (rez?.ok !== true) {
    const cod = typeof rez?.cod === 'string' && Object.hasOwn(STATUS_REFUZ, rez.cod) ? rez.cod : 'rezervare_refuzata'
    return out(STATUS_REFUZ[cod] ?? 503, cod, rez?.limita != null ? { limita: rez.limita } : rez?.limita_usd != null ? { limita_usd: rez.limita_usd } : {})
  }
  // aceeași cheie deja rezervată (reluare / alt tab): NICIUN al doilea apel — starea o dă jurnalul
  if (rez.nou !== true) return out(409, 'cerere_deja_procesata', { stare: typeof rez.stare === 'string' ? rez.stare : null })
  const inchide = async (stare, cod, extra = {}) => {
    try {
      const w = await deps.inchide({ p_id: rez.id, p_token: rez.lease_token, p_stare: stare, p_semnale: extra.semnale ?? null, p_respinse: extra.respinse ?? null,
        p_tokeni_in: extra.tin ?? null, p_tokeni_out: extra.tout ?? null, p_eroare_cod: cod })
      return !w?.error && w?.data === true
    } catch { return false }
  }
  if (rez.model !== MODEL_AI || typeof rez.lease_token !== 'string') {
    await inchide('eroare', 'rezervare_diferita', { tin: 0, tout: 0 })
    return out(503, 'rezervare_diferita')
  }
  // ── apelul plătit ──
  let raspuns
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const ceas = ctrl ? setTimeout(() => ctrl.abort(), deps.timeoutMs ?? TIMEOUT_AI_MS) : null
  try {
    raspuns = await deps.fetch(URL_ANTHROPIC, { method: 'POST', signal: ctrl?.signal,
      headers: { 'x-api-key': cheieApi, 'anthropic-version': VERSIUNE_API, 'content-type': 'application/json' }, body: cerere.text })
  } catch {
    if (ceas) clearTimeout(ceas)
    const j = await inchide('necunoscut', 'ai_retea')
    return out(502, 'ai_necunoscut', { jurnal_confirmat: j })
  }
  let d = null, corpCitit = true
  try { d = await raspuns.json() } catch { corpCitit = false }
  if (ceas) clearTimeout(ceas)
  const st = Number(raspuns?.status)
  if (!raspuns?.ok) {
    // 4xx = refuz determinist al API-ului (nu se taxează); 5xx / alt status = necunoscut (L05)
    if (st >= 400 && st < 500) {
      const cod = st === 429 ? 'ai_ocupat' : st === 401 || st === 403 ? 'ai_cheie_respinsa' : 'ai_cerere_respinsa'
      const j = await inchide('eroare', cod, { tin: 0, tout: 0 })
      return out(502, cod, { jurnal_confirmat: j })
    }
    const j = await inchide('necunoscut', 'ai_http_' + (Number.isInteger(st) && st > 0 && st < 1000 ? st : 'necunoscut'))
    return out(502, 'ai_necunoscut', { jurnal_confirmat: j })
  }
  if (!corpCitit) { const j = await inchide('necunoscut', 'ai_corp_ilizibil'); return out(502, 'ai_necunoscut', { jurnal_confirmat: j }) }
  const tok = tokeniDinUsage(d?.usage)
  const val = valideazaRaspuns(d, c.randuri)
  if (!tok) {
    // costul nu se cunoaște: rezervarea rămâne costul (L22); rezultatul valid se arată totuși (e doar o opinie), marcat
    const j = await inchide('necunoscut', 'ai_usage_lipsa')
    if (!val.ok) return out(502, val.cod, { jurnal_confirmat: j })
    return out(200, 'ok', { semnale: val.semnale, respinse: val.respinse, cost_usd: null, jurnal_confirmat: j, cost_necunoscut: true })
  }
  if (!val.ok) {
    const j = await inchide('eroare', val.cod, { tin: tok.tin, tout: tok.tout })
    return out(502, val.cod, { cost_usd: costFinal(tok.tin, tok.tout), jurnal_confirmat: j })
  }
  const j = await inchide('ok', null, { semnale: val.semnale.length, respinse: val.respinse, tin: tok.tin, tout: tok.tout })
  return out(200, 'ok', { semnale: val.semnale, respinse: val.respinse, cost_usd: costFinal(tok.tin, tok.tout), jurnal_confirmat: j })
}
