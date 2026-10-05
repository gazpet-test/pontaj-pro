// api-consum-extern/furnizori.ts — citirea consumului de la furnizorii cu API (logică pură, testată în furnizori_test.ts).
// Fiecare furnizor întoarce un RÂND (RandConsum); erorile (cheie lipsă, HTTP ≠ 200, JSON neașteptat, timeout) se întorc tot
// ca rând, cu `eroare` completată — nu se aruncă (anti-bug edge: throw = worker killed intermitent). payloadUpsert alege
// coloanele care se scriu: citirea bună SAU eroarea, niciodată amândouă.
// Valul 1 (05.10.2026): firecrawl. Valul 2 (anthropic, supabase, github_actions, resend, vercel, sentry, openai) se adaugă
// aici, câte un handler, după ce fiecare endpoint e verificat pe documentația furnizorului.

export type RandConsum = {
  furnizor: string
  sursa: 'api'
  unitate: 'credite' | 'usd' | 'minute' | 'mailuri' | 'gb' | 'procent' | 'apeluri'
  credite_plan: number | null
  credite_ramase: number | null
  credite_consumate: number | null
  perioada_start: string | null
  perioada_sfarsit: string | null
  raspuns_brut: unknown
  eroare: string | null
}

export type Mediu = { env: (k: string) => string | undefined; fetch: typeof fetch; timeoutMs?: number }

const TIMEOUT_MS = 10_000
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
// Perioada de facturare vine ca ISO UTC („2025-01-31T23:59:59Z”): ziua se ia din data UTC, nu pe ora României
// (altfel sfârșitul perioadei ar sări în ziua următoare).
const ziIso = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const scurt = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s)

async function cuTimeout(m: Mediu, url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), m.timeoutMs ?? TIMEOUT_MS)
  try { return await m.fetch(url, { ...init, signal: ac.signal }) } finally { clearTimeout(t) }
}

const randGol = (furnizor: string, unitate: RandConsum['unitate']): RandConsum => ({
  furnizor, sursa: 'api', unitate, credite_plan: null, credite_ramase: null, credite_consumate: null,
  perioada_start: null, perioada_sfarsit: null, raspuns_brut: null, eroare: null,
})

// Firecrawl — GET https://api.firecrawl.dev/v2/team/credit-usage (verificat pe docs.firecrawl.dev, 05.10.2026):
// 200 { success: true, data: { remainingCredits, planCredits, billingPeriodStart, billingPeriodEnd } }
// 404/500 { success: false, error }. Istoricul (/historical) e lunar — consumul zilnic iese din citirile zilnice.
export async function citesteFirecrawl(m: Mediu): Promise<RandConsum> {
  const r = randGol('firecrawl', 'credite')
  const cheie = m.env('FIRECRAWL_API_KEY')
  if (!cheie) return { ...r, eroare: 'FIRECRAWL_API_KEY lipsă din Edge Secrets' }
  let resp: Response
  try {
    resp = await cuTimeout(m, 'https://api.firecrawl.dev/v2/team/credit-usage', { headers: { Authorization: `Bearer ${cheie}` } })
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? `timeout ${(m.timeoutMs ?? TIMEOUT_MS) / 1000} s` : String((e as Error)?.message ?? e)
    return { ...r, eroare: scurt(`rețea: ${msg}`) }
  }
  const text = await resp.text().catch(() => '')
  let j: any = null
  try { j = JSON.parse(text) } catch { /* mai jos */ }
  if (!resp.ok || !j || j.success !== true) {
    const motiv = j?.error ? String(j.error) : text ? scurt(text, 200) : 'fără corp'
    return { ...r, raspuns_brut: j ?? (text ? { text: scurt(text, 500) } : null), eroare: scurt(`HTTP ${resp.status}: ${motiv}`) }
  }
  const d = j.data ?? {}
  const plan = num(d.planCredits), ramase = num(d.remainingCredits)
  if (ramase == null) return { ...r, raspuns_brut: j, eroare: 'răspuns fără data.remainingCredits (format schimbat?)' }
  return {
    ...r,
    credite_plan: plan,
    credite_ramase: ramase,
    credite_consumate: plan != null && plan >= ramase ? plan - ramase : null,
    perioada_start: ziIso(d.billingPeriodStart),
    perioada_sfarsit: ziIso(d.billingPeriodEnd),
    raspuns_brut: j,
  }
}

// Ce se scrie în public.api_consum_extern pentru rândul zilei (upsert pe furnizor+zi). PostgREST actualizează la conflict
// DOAR coloanele din obiect, deci: succesul scrie numai citirea bună (citit_la, credite_*, perioada_*, raspuns_brut), iar
// eroarea numai eroare + eroare_la — o eroare de după-amiază nu mai șterge citirea bună de dimineață și nici invers
// (Copilot P0, #616 r1). Cheile lipsă din obiect nu sunt atinse la UPDATE.
export function payloadUpsert(r: RandConsum, zi: string, acum: string): Record<string, unknown> {
  const baza = { furnizor: r.furnizor, sursa: r.sursa, unitate: r.unitate, zi }
  if (r.eroare) return { ...baza, eroare: r.eroare, eroare_la: acum }
  return {
    ...baza, citit_la: acum,
    credite_plan: r.credite_plan, credite_ramase: r.credite_ramase, credite_consumate: r.credite_consumate,
    perioada_start: r.perioada_start, perioada_sfarsit: r.perioada_sfarsit, raspuns_brut: r.raspuns_brut,
  }
}

export const FURNIZORI: Record<string, (m: Mediu) => Promise<RandConsum>> = {
  firecrawl: citesteFirecrawl,
}

// 'toate' sau un nume din FURNIZORI; orice altceva → listă goală (cererea se refuză în index.ts)
export function alegeFurnizori(cerut: unknown): string[] {
  const c = typeof cerut === 'string' ? cerut.trim().toLowerCase() : 'toate'
  if (c === '' || c === 'toate') return Object.keys(FURNIZORI)
  return Object.hasOwn(FURNIZORI, c) ? [c] : []   // hasOwn: „constructor”, „toString” … (moștenite) nu sunt furnizori
}
