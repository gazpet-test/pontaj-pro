// Recitirea valului 1 (docs/ofertare/RECITIRE_VAL1_PROCEDURA.md v5): funcțiile PURE ale procedurii — whitelist-ul, bugetul cu
// rezervare persistentă, marcajele brute stricte, asamblarea, raportul vechi / nou. Fără rețea, fără BD (testate în lib_test.ts).
import { conventieDocument, type Conventie, tokeniNumerici, umLanga, valoareInDocument } from '../../supabase/functions/_shared/cantNumar.ts'

// ── documentele (§2): whitelist-ul, ordinea de citire (212 și 213 întâi), grupurile de părți (convenția numerică) ──
export const WHITELIST = [137, 138, 139, 165, 166, 167, 168, 169, 170, 171, 212, 213, 434, 1288, 1289, 1290, 1291, 1292, 1293, 1294] as const
export const ORDINE: number[] = [212, 213, ...WHITELIST.filter((x) => x !== 212 && x !== 213)]
export const radacinaParte = (nume: string) => nume.replace(/\s+—\s+p\d{2}_pag\d+-\d+\.pdf$/i, '').trim()   // ca în structurat.ts

// ── bugetul (§3): rezervare 0,53 USD înaintea FIECĂRUI apel; costul se confirmă doar din BD ──
export const PLAFON_USD = 1.00
export const REZERVARE_APEL_USD = 0.53   // context 1M × 0,50 $/M (treapta de sus) + 12 000 × 2,50 $/M = 0,50 + 0,03
export type Apel = {
  nr: number; document_id: number; de_la: number; felie: number
  stare: 'rezervat' | 'confirmat' | 'neconfirmat'   // rezervat = trimis, încă neconfirmat în BD; neconfirmat = oprire, rezervarea rămâne
  rezervat_usd: number; cost_usd: number | null; staging_id: number | null
}
export type Registru = { t0: string; plafon_usd: number; apeluri: Apel[]; oprit: string | null }
const cent = (x: number) => Math.round(x * 1e6) / 1e6
// validarea SEMANTICĂ a registrului persistent (orice abatere → oprire): plafonul = constanta, rezervările = 0,53, costurile finite,
// 0 ≤ cost ≤ rezervare (peste rezervare = limita superioară încălcată), stări cunoscute, id-uri unice
export function registruValid(r: Registru & { usage_ids?: unknown; ultim_staging_id?: unknown }): string | null {
  if (typeof r.t0 !== 'string' || Number.isNaN(Date.parse(r.t0))) return 't0 invalid'
  if (r.plafon_usd !== PLAFON_USD) return `plafon_usd ${r.plafon_usd} ≠ ${PLAFON_USD}`
  if (!Array.isArray(r.apeluri)) return 'apeluri lipsă'
  const nrs = new Set<number>()
  for (const a of r.apeluri) {
    if (!Number.isInteger(a.nr) || nrs.has(a.nr)) return `apel cu nr invalid / dublat (${a.nr})`
    nrs.add(a.nr)
    if (!['rezervat', 'confirmat', 'neconfirmat'].includes(a.stare)) return `apel ${a.nr}: stare invalidă`
    if (a.rezervat_usd !== REZERVARE_APEL_USD) return `apel ${a.nr}: rezervare ${a.rezervat_usd} ≠ ${REZERVARE_APEL_USD}`
    if (a.stare === 'confirmat' && !(typeof a.cost_usd === 'number' && Number.isFinite(a.cost_usd) && a.cost_usd >= 0 && a.cost_usd <= REZERVARE_APEL_USD)) {
      return `apel ${a.nr}: cost confirmat invalid (${a.cost_usd})`
    }
    if (a.stare !== 'confirmat' && a.cost_usd !== null) return `apel ${a.nr}: cost pe un apel neconfirmat`
  }
  if (!Array.isArray(r.usage_ids) || r.usage_ids.some((x) => !Number.isInteger(x)) || new Set(r.usage_ids as number[]).size !== r.usage_ids.length) return 'usage_ids invalide'
  if (!Number.isInteger(r.ultim_staging_id) || (r.ultim_staging_id as number) < 0) return 'ultim_staging_id invalid'
  return null
}
// consumul socotit: costul confirmat + rezervarea întreagă pentru tot ce nu e confirmat
export function consum(r: Registru): number {
  return cent(r.apeluri.reduce((s, a) => s + (a.stare === 'confirmat' ? (a.cost_usd ?? 0) : a.rezervat_usd), 0))
}
export function poatePorni(r: Registru): { ok: boolean; motiv?: string } {
  if (r.oprit) return { ok: false, motiv: `rulare oprită: ${r.oprit}` }
  if (r.apeluri.some((a) => a.stare !== 'confirmat')) return { ok: false, motiv: 'un apel anterior nu e confirmat în BD' }
  // plafonul e CONSTANTA aprobată, nu valoarea din fișier (registrul e contabilitate, nu autoritate)
  if (r.plafon_usd !== PLAFON_USD) return { ok: false, motiv: `registru cu plafon ${r.plafon_usd} ≠ ${PLAFON_USD} aprobat` }
  if (cent(consum(r) + REZERVARE_APEL_USD) > PLAFON_USD) return { ok: false, motiv: `plafon: ${consum(r)} + ${REZERVARE_APEL_USD} > ${PLAFON_USD}` }
  return { ok: true }
}

// ── marcajele (§4): brute, stricte; renumerotare N → N + offset ──
const RE_MARCAJ = /⟦PAGINA (\d+)⟧/g
export const marcajeBrute = (t: string) => [...t.matchAll(RE_MARCAJ)].map((m) => Number(m[1]))
// felia [de_la..pana_la] (1-based, inclusiv, numerotare LOCALĂ a PDF-ului, ca în laborator) trebuie să aibă EXACT marcajele
// de_la..pana_la, o dată fiecare, în ordine — fără nicio reparare, nici la felia de 1 pagină (procedura §4). Altfel → null.
export function normalizeazaFelie(t: string, de_la: number, pana_la: number): string | null {
  const m = marcajeBrute(t)
  const asteptat = Array.from({ length: pana_la - de_la + 1 }, (_, i) => de_la + i)
  return m.length === asteptat.length && m.every((x, i) => x === asteptat[i]) ? t : null
}
export type Felie = { id: number; de_la: number; pana_la: number; text: string }
// acoperirea EXACTĂ 1..pagini, fără goluri / suprapuneri (feliile date sunt cele alese, una per interval)
export function acoperire(felii: Felie[], pagini: number): string | null {
  const s = [...felii].sort((a, b) => a.de_la - b.de_la)
  let urm = 1
  for (const f of s) {
    if (f.de_la !== urm) return f.de_la < urm ? `suprapunere la pagina ${f.de_la}` : `gol: paginile ${urm}-${f.de_la - 1}`
    if (f.pana_la < f.de_la) return `interval invalid ${f.de_la}-${f.pana_la}`
    urm = f.pana_la + 1
  }
  return urm === pagini + 1 ? null : urm <= pagini ? `gol: paginile ${urm}-${pagini}` : `peste numărul de pagini (${pagini})`
}
// asamblarea ca în ingest (textNou += felie + '\n'; trim), cu marcajele mutate cu pagina_offset
export function asambleaza(felii: Felie[], offset: number): string {
  return [...felii].sort((a, b) => a.de_la - b.de_la)
    .map((f) => f.text.replace(RE_MARCAJ, (_m, n) => `⟦PAGINA ${Number(n) + offset}⟧`) + '\n').join('').trim()
}
export async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ── raportul (§4) ──
export type Cantitate = { pagina: number | null; poz: number; token: string; valoare: number }
function paginaLa(t: string, poz: number): number | null {
  let p: number | null = null
  for (const m of t.matchAll(RE_MARCAJ)) { if ((m.index ?? 0) > poz) break; p = Number(m[1]) }
  return p
}
// cantitățile în metri: token cu valoare unică în convenția grupului + UM „m” alăturat / din antetul coloanei (ca în PR3)
export function cantitatiM(t: string, c: Conventie): Cantitate[] {
  const out: Cantitate[] = []
  for (const k of tokeniNumerici(t)) {
    const v = valoareInDocument(k.text, c)
    if (typeof v !== 'number') continue
    if (!umLanga(t, k.de_la, k.pana_la).has('m')) continue
    out.push({ pagina: paginaLa(t, k.de_la), poz: k.de_la, token: k.text, valoare: v })
  }
  return out
}
export type Raport = {
  pagini_asteptate: [number, number]; marcaje_brute: number[]; pagini_marcate: number; pagini_inventate: number[]; pagini_lipsa: number[]
  cantitati_m: number; suma_m: number; lungime: number
}
export function raport(t: string, offset: number, pagini: number, c: Conventie): Raport {
  const m = marcajeBrute(t)
  const lo = offset + 1, hi = offset + pagini
  const vazute = new Map<number, number>()
  for (const x of m) vazute.set(x, (vazute.get(x) ?? 0) + 1)
  const inventate = [...new Set(m.filter((x) => x < lo || x > hi || (vazute.get(x) ?? 0) > 1))].sort((a, b) => a - b)
  const lipsa: number[] = []
  for (let p = lo; p <= hi; p++) if (!vazute.has(p)) lipsa.push(p)
  const q = cantitatiM(t, c)
  return { pagini_asteptate: [lo, hi], marcaje_brute: m, pagini_marcate: [...vazute.keys()].filter((x) => x >= lo && x <= hi).length,
    pagini_inventate: inventate, pagini_lipsa: lipsa, cantitati_m: q.length, suma_m: Math.round(q.reduce((s, x) => s + x.valoare, 0) * 1000) / 1000,
    lungime: t.length }
}
// convenția pe GRUPUL de părți (212 + 213 împreună), pe textele date
export const conventieGrup = (texte: string[]) => conventieDocument(texte).conventie
// diferențele de cantități (primele n), pentru verificarea umană în PDF: perechi pe pagină, în ordinea apariției
export function diferente(vechi: string, nou: string, c: Conventie, n = 20): { pagina: number | null; vechi: number[]; nou: number[] }[] {
  const pe = (t: string) => { const m = new Map<number | null, number[]>(); for (const q of cantitatiM(t, c)) m.set(q.pagina, [...(m.get(q.pagina) ?? []), q.valoare]); return m }
  const a = pe(vechi), b = pe(nou)
  const pag = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (x ?? 0) - (y ?? 0))
  const out: { pagina: number | null; vechi: number[]; nou: number[] }[] = []
  for (const p of pag) {
    const va = a.get(p) ?? [], vb = b.get(p) ?? []
    if (JSON.stringify(va) !== JSON.stringify(vb)) out.push({ pagina: p, vechi: va, nou: vb })
    if (out.length >= n) break
  }
  return out
}
// criteriile (§4): integritatea (obligatorie) și calitatea (cantitati_m nou ≥ vechi)
export function criterii(rn: Raport, rv: Raport, integritateFelii: string | null): { integritate_ok: boolean; calitate_ok: boolean; motive: string[] } {
  const motive: string[] = []
  if (integritateFelii) motive.push(integritateFelii)
  if (rn.pagini_inventate.length) motive.push(`pagini inventate: ${rn.pagini_inventate.join(',')}`)
  if (rn.pagini_lipsa.length) motive.push(`pagini lipsă: ${rn.pagini_lipsa.join(',')}`)
  const integritate_ok = motive.length === 0
  const calitate_ok = rn.cantitati_m >= rv.cantitati_m
  if (!calitate_ok) motive.push(`cantitati_m ${rn.cantitati_m} < ${rv.cantitati_m} (vechi)`)
  return { integritate_ok, calitate_ok, motive }
}
