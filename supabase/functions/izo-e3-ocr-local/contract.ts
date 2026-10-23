import { ANTET_COMUN, ANTET_SPECIFIC, EroareE3, type SablonE3 } from '../ocr-packing-list/avizE3.ts'
export const JWT_OPS = ['cere', 'stare', 'fallback']
export const WORKER_OPS = ['preia', 'link', 'arbitreaza', 'rezultat', 'heartbeat']
export const ERORI_LOCALE = ['structura_incerta', 'tabel_negasit', 'garda', 'prea_multe_dezacorduri', 'limita_randuri', 'pdf_invalid', 'multipagina', 'intern']
export const obiect = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function exact(v: unknown, chei: string[]): asserts v is Record<string, unknown> {
  if (!obiect(v) || Object.keys(v).length !== chei.length || !chei.every(k => Object.hasOwn(v, k))) throw new EroareE3('cerere_invalida', 400)
}
export function uuid(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) throw new EroareE3('cerere_invalida', 400)
}
export function rotatie(v: unknown) {
  if (typeof v !== 'number' || ![0, 90, 180, 270].includes(v)) throw new EroareE3('cerere_invalida', 400)
}
export function textScurt(v: unknown, max = 100): asserts v is string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new EroareE3('cerere_invalida', 400)
}
const CAMPURI = {
  aviz_teava: ['sarja', 'lot', 'specificatie', 'dimensiune', 'grad_otel', 'izolatie', 'lungime_doc', 'greutate_kg'],
  lista_curbe: ['sarja', 'item', 'diametru_mm', 'perete_mm', 'specificatie', 'unghi_doc', 'standard', 'dimensiuni_cm', 'net_kg', 'brut_kg'],
}
export type Celula = { rand: number; camp: string; lighton: string | null; mineru: string | null; sugestie: string | null }
export type Decizie = { rand: number; camp: string; valoare: string | null; sigur: boolean }
const frunza = (v: unknown) => v === null || typeof v === 'string' && v.length <= 4000
export function valideazaCelule(v: unknown, sablon: SablonE3): Celula[] {
  if (!Array.isArray(v) || !v.length || v.length > 120) throw new EroareE3('celule_invalide', 400)
  const set = new Set()
  for (const c of v) {
    exact(c, ['rand', 'camp', 'lighton', 'mineru', 'sugestie'])
    const lista = c.rand === 0 ? [...ANTET_COMUN, ...ANTET_SPECIFIC[sablon]] : CAMPURI[sablon]
    const key = `${c.rand}:${c.camp}`
    if (!Number.isInteger(c.rand) || Number(c.rand) < 0 || Number(c.rand) > 200 || typeof c.camp !== 'string' || !lista.includes(c.camp) ||
      set.has(key) || !frunza(c.lighton) || !frunza(c.mineru) || !frunza(c.sugestie) || c.lighton === c.mineru) throw new EroareE3('celule_invalide', 400)
    set.add(key)
  }
  return v as Celula[]
}
export function valideazaDecizii(v: unknown, cerute: Celula[]) {
  exact(v, ['celule'])
  if (!Array.isArray(v.celule) || v.celule.length !== cerute.length) throw new EroareE3('raspuns_ai_invalid')
  const set = new Set(cerute.map(c => `${c.rand}:${c.camp}`))
  for (const c of v.celule) {
    exact(c, ['rand', 'camp', 'valoare', 'sigur'])
    if (!Number.isInteger(c.rand) || typeof c.camp !== 'string' || !frunza(c.valoare) || typeof c.sigur !== 'boolean' || !set.delete(`${c.rand}:${c.camp}`)) throw new EroareE3('raspuns_ai_invalid')
  }
  return { arbitraj: 'ok', celule: v.celule as Decizie[] }
}
export function valideazaSursa(v: unknown) {
  exact(v, ['perspectiva', 'dezacorduri', 'secunde'])
  if (!['aplicata', 'nesigura', 'inutila'].includes(String(v.perspectiva)) || !Number.isInteger(v.dezacorduri) || Number(v.dezacorduri) < 0 || Number(v.dezacorduri) > 120 || typeof v.secunde !== 'number' || !Number.isFinite(v.secunde) || v.secunde < 0 || v.secunde > 3600) throw new EroareE3('cerere_invalida', 400)
  return v
}
