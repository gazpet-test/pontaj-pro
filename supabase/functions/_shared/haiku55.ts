// Haiku 5.5 — ajutoare comune funcțiilor de modul (18.10.2026, trecerea Haiku 4.5 → Haiku 5.5). Sursa: skill-ul claude-api,
// Migrating to Claude Haiku 5.5. Pe Haiku 5.5: temperature/top_p/top_k ≠ implicit → 400, prefill (ultimul mesaj `assistant`) → 400,
// thinking cu budget_tokens → 400. Gândirea e PORNITĂ implicit (adaptive), deci răspunsul poate începe cu blocuri `thinking`:
// textul se citește DUPĂ TIP, niciodată content[0]. Clasificatoarele de siguranță pot refuza (HTTP 200, stop_reason 'refusal'),
// iar pe Haiku NU există fallback pe server. Tokenizerul nou numără ~30% mai mulți tokeni pentru același text.
export const HAIKU_55 = 'claude-haiku-5-5'

const MODELE_PARSARE = [HAIKU_55, 'claude-haiku-4-5', 'claude-sonnet-5-5']

// Override doar pentru modele cu gandire si pret cunoscute; lipsa variabilei e normala.
export function modelParsare(envValue: string | undefined): string {
  if (envValue !== undefined && MODELE_PARSARE.includes(envValue)) return envValue
  if (envValue !== undefined) console.warn('PARSE_CONTRACT_MODEL respins; folosim Haiku 5.5:', envValue)
  return HAIKU_55
}

type Pret = { in: number; out: number; prag?: number; peste?: { in: number; out: number } }
// $ / token. Haiku 5.5: 0,10 / 0,50 $ pe 1M cu promptul ≤ 100K tokeni, 0,50 / 2,50 peste; citire din cache 0,1x intrarea,
// scriere în cache (5 min) 1,25x. Haiku 4.5 rămâne în tabel: modelul se poate suprascrie din env (PARSE_CONTRACT_MODEL).
export const PRETURI_HAIKU: Record<string, Pret> = {
  [HAIKU_55]: { in: 0.10 / 1e6, out: 0.50 / 1e6, prag: 100_000, peste: { in: 0.50 / 1e6, out: 2.50 / 1e6 } },
  'claude-haiku-4-5': { in: 1 / 1e6, out: 5 / 1e6 },
  'claude-sonnet-5-5': { in: 2 / 1e6, out: 10 / 1e6 },
  'claude-haiku-4-5-20251001': { in: 1 / 1e6, out: 5 / 1e6 },
}

export type Usage = {
  input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number
} | null | undefined

// Costul unui apel din `usage`. Pragul de 100K se judecă pe tot promptul (intrare + cache). Model necunoscut → `rezerva`
// (dacă e dată), altfel prețul Haiku 4.5 (cel de până azi — nu subraportează).
export function costApel(model: string, u: Usage, rezerva?: { in: number; out: number }): number {
  const tin = u?.input_tokens || 0, tout = u?.output_tokens || 0
  const cr = u?.cache_read_input_tokens || 0, cw = u?.cache_creation_input_tokens || 0
  const p0: Pret = PRETURI_HAIKU[model] || rezerva || PRETURI_HAIKU['claude-haiku-4-5']
  const p = p0.prag !== undefined && p0.peste && tin + cr + cw > p0.prag ? p0.peste : p0
  return tin * p.in + cr * p.in * 0.1 + cw * p.in * 1.25 + tout * p.out
}

// Textul răspunsului: DOAR blocurile `text`, lipite (pe Haiku 5.5 pot veni întâi blocuri `thinking`).
export function textRaspuns(data: unknown): string {
  const c = (data as { content?: unknown })?.content
  return (Array.isArray(c) ? c : [])
    .filter((b: { type?: string }) => b?.type === 'text')
    .map((b: { text?: string }) => b.text || '').join('\n')
}

// Refuzul filtrului de siguranță → mesaj în română; null dacă nu e refuz. E eroare de BUSINESS: se scrie/întoarce, NU se aruncă.
export function mesajRefuz(data: unknown): string | null {
  const d = data as { stop_reason?: string; stop_details?: { category?: string | null } | null }
  if (d?.stop_reason !== 'refusal') return null
  const cat = d.stop_details?.category
  return `Modelul AI a refuzat cererea (filtru de siguranță${cat ? `, categoria ${cat}` : ''}). Nu se reîncearcă automat — verifică documentul.`
}

// Obiectul JSON dintr-un răspuns text: întâi tot textul (fără ```), apoi de la prima acoladă la ultima — prinde și o frază
// scrisă înainte/după JSON (fără prefill nu mai „forțăm” începutul cu `{`). null dacă nu iese un obiect.
// deno-lint-ignore no-explicit-any
export function jsonDinText(raw: string): any | null {
  const s = String(raw || '').replace(/```(json)?/gi, '').trim()
  const incearca = (t: string) => { try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null } catch (_) { return null } }
  const tot = incearca(s)
  if (tot) return tot
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  return a >= 0 && b > a ? incearca(s.slice(a, b + 1)) : null
}
