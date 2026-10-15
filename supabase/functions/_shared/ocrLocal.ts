// Poarta și logica comună a edge-urilor pilotului OCR local (D3b, 14.10.2026; spec docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §3, §6, §7):
// ofertare-pdf-link, ofertare-ocr-scrie, ofertare-ocr-arbitreaza. Apelantul e serverul AI (fără cont Supabase, fără service_role):
// identitatea lui e secretul dedicat OCR_LOCAL_SECRET din Vault (64 hex), verificat în BD prin fn_verifica_secret (acceptă și
// OCR_LOCAL_SECRET_VECHI pe durata unei rotiri). Orice abatere sau eroare → false (fail closed). Funcții pure, testate fără rețea.
export const ANTET_OCR = 'x-ocr-local-secret'
export const NUME_SECRET = 'OCR_LOCAL_SECRET'
const FORMAT_SECRET = /^[0-9a-f]{64}$/

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }

export async function esteApelOcrLocal(req: Request, supabase: RpcClient): Promise<boolean> {
  const antet = req.headers.get(ANTET_OCR) || ''
  if (!FORMAT_SECRET.test(antet)) return false
  try {
    const { data, error } = await supabase.rpc('fn_verifica_secret', { p_nume: NUME_SECRET, p_secret: antet })
    return !error && data === true
  } catch (_) {
    return false
  }
}

export function raspuns(status: number, corp: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corp), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

export const esteId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
export const esteObiect = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// Corpul citit ÎN FLUX cu limită de octeți: se oprește la depășire (un corp mare fără Content-Length nu se citește întreg — review
// Jakarinos r1 P2), apoi UTF-8 strict și JSON.
export async function citesteCorp(req: Request, maxOcteti: number): Promise<{ ok: true; corp: unknown } | { ok: false; status: number; error: string }> {
  const lung = Number(req.headers.get('content-length') || '0')
  if (!(lung >= 0) || lung > maxOcteti) return { ok: false, status: 413, error: 'Corp prea mare' }
  if (!req.body) return { ok: false, status: 400, error: 'Corp lipsă' }
  const cititor = req.body.getReader(); const bucati: Uint8Array[] = []; let n = 0
  for (;;) {
    const { done, value } = await cititor.read()
    if (done) break
    n += value.length
    if (n > maxOcteti) { try { await cititor.cancel() } catch (_) { /* fluxul se închide oricum */ } return { ok: false, status: 413, error: 'Corp prea mare' } }
    bucati.push(value)
  }
  const tot = new Uint8Array(n); let o = 0
  for (const b of bucati) { tot.set(b, o); o += b.length }
  try { return { ok: true, corp: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(tot)) } } catch (_) { return { ok: false, status: 400, error: 'Corp JSON invalid' } }
}

// Eroarea unui RPC (mesajele sunt ale noastre, RAISE din migrarea 20261029b) → cod HTTP. Fără detalii interne în afara mesajului.
export function statusDinEroare(e: unknown): number {
  const cod = esteObiect(e) ? String(e.code || '') : ''
  if (cod === '22023' || cod === '23514' || cod === '22P02') return 422
  if (cod === '55000' || cod === '23505') return 409
  if (cod === 'P0002') return 404
  if (cod === '42501') return 403
  return 500
}
export const mesajEroare = (e: unknown): string => (esteObiect(e) && typeof e.message === 'string' ? e.message.slice(0, 300) : 'Eroare internă')

// ── ofertare-ocr-scrie: lista ÎNCHISĂ de operații → RPC-ul și parametrii lui (exact acești parametri, toți prezenți; null permis
// doar unde e marcat). pdf_rezerva / pdf_final / cost_rezerva / scrie_arbitraj NU sunt aici: doar prin edge-urile lor.
type Op = { fn: string; arg: Record<string, string>; nule?: string[] }
export const OPERATII: Record<string, Op> = {
  preia: { fn: 'fn_ofertare_ocr_preia', arg: { protocol: 'p_protocol' } },
  plan: { fn: 'fn_ofertare_ocr_plan', arg: { rulare_id: 'p_rulare_id', plan: 'p_plan' } },
  pagina: {
    fn: 'fn_ofertare_ocr_scrie_pagina',
    arg: { rulare_id: 'p_rulare_id', document_id: 'p_document_id', pagina: 'p_pagina', banda: 'p_banda', cititor: 'p_cititor', text: 'p_text',
           stare: 'p_stare', model_rev: 'p_model_rev', raw_sha256: 'p_raw_sha256', image_sha256: 'p_image_sha256', garda: 'p_garda', segmente: 'p_segmente' },
    nule: ['banda', 'image_sha256', 'garda', 'segmente'],
  },
  dezacord: { fn: 'fn_ofertare_ocr_scrie_dezacord', arg: { rulare_id: 'p_rulare_id', dezacord: 'p_dezacord' } },
  comparatie_gata: { fn: 'fn_ofertare_ocr_comparatie_gata', arg: { rulare_id: 'p_rulare_id', nr: 'p_nr', sha256: 'p_sha256' } },
  stare: { fn: 'fn_ofertare_ocr_stare', arg: { rulare_id: 'p_rulare_id', stare: 'p_stare', motiv: 'p_motiv' }, nule: ['motiv'] },
  rezervare_abandon: { fn: 'fn_ofertare_ocr_rezervare_abandon', arg: { rezervare_id: 'p_rezervare_id' } },
  // needs_human FĂRĂ apel plătit (structura_tabele sau orice dezacord trimis direct la om) — migrarea 20261029c
  needs_human: { fn: 'fn_ofertare_ocr_arbitraj_om', arg: { rulare_id: 'p_rulare_id', dezacord_id: 'p_dezacord_id', item_sha256: 'p_item_sha256', motiv: 'p_motiv' } },
  heartbeat: { fn: 'fn_ofertare_ocr_heartbeat', arg: { ok: 'p_ok', mesaj: 'p_mesaj' } },
  // DOAR CITIRE (migrarea 20261029e, review r1 PR #700): starea confirmată din BD pentru reluarea clientului după o cădere
  // (planul / comparația / tranzițiile deja făcute) și rulările active (recuperarea unei preluări întrerupte)
  stare_rulare: { fn: 'fn_ofertare_ocr_rulare_stare', arg: { rulare_id: 'p_rulare_id' } },
  rulari_active: { fn: 'fn_ofertare_ocr_rulari_active', arg: {} },
}

export type Apel = { ok: true; fn: string; args: Record<string, unknown> } | { ok: false; error: string }
// Corpul: { "op": <din listă>, "args": { …exact cheile operației… } }. Tipurile fine le verifică RPC-ul (care e și poarta de stare).
export function apelDinCorp(corp: unknown): Apel {
  if (!esteObiect(corp) || Object.keys(corp).some((k) => k !== 'op' && k !== 'args')) return { ok: false, error: 'Corp invalid: {op, args}' }
  const op = typeof corp.op === 'string' && Object.hasOwn(OPERATII, corp.op) ? OPERATII[corp.op] : null
  if (!op) return { ok: false, error: 'Operație necunoscută' }
  if (!esteObiect(corp.args)) return { ok: false, error: 'args trebuie să fie obiect' }
  const a = corp.args, chei = Object.keys(op.arg)
  if (Object.keys(a).length !== chei.length || chei.some((k) => !Object.hasOwn(a, k))) return { ok: false, error: 'args: exact ' + chei.join(', ') }
  const args: Record<string, unknown> = {}
  for (const k of chei) {
    if (a[k] === null && !(op.nule || []).includes(k)) return { ok: false, error: `args.${k} nu poate fi null` }
    if (a[k] === undefined) return { ok: false, error: `args.${k} lipsește` }
    args[op.arg[k]] = a[k]
  }
  return { ok: true, fn: op.fn, args }
}

export async function sha256Hex(date: Uint8Array | string): Promise<string> {
  const b = typeof date === 'string' ? new TextEncoder().encode(date) : date
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b)))
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('')
}

// ── amprenta unui dezacord, IDENTICĂ cu scripts/ocr_local/compare.py item_hash: sha256 peste
// json.dumps({k: v pentru k ≠ item_sha256}, ensure_ascii=False, sort_keys=True) — separatori „, ” și „: ”, șirurile ca JSON.
// Doar tipurile pe care le produce compare.py (șir, bool, null, întreg, listă, obiect); orice altceva → excepție (fail closed).
// Folosită ca să lege CONTEXTUL trimis de pipeline de dezacordul din BD (review Copilot r2): item-ul întreg → amprenta = cea stocată.
export function canonic(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error('număr neîntreg în dezacord')
    return String(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonic).join(', ') + ']'
  if (esteObiect(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ': ' + canonic(v[k])).join(', ') + '}'
  throw new Error('tip nepermis în dezacord')
}

export async function amprentaDezacord(item: Record<string, unknown>): Promise<string> {
  const { item_sha256: _ignorat, ...rest } = item
  return await sha256Hex(canonic(rest))
}

// Imaginea benzii e PNG (scripts/ocr_local/plan.py): lățimea și înălțimea din IHDR, pentru limita de cost. null = nu e PNG valid.
export function dimensiuniPng(b: Uint8Array): { w: number; h: number } | null {
  const sem = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 33 || sem.some((x, i) => b[i] !== x) || String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), w = v.getUint32(16), h = v.getUint32(20)
  return w >= 1 && h >= 1 && w <= 20000 && h <= 20000 ? { w, h } : null
}

export function dinBase64(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) } catch (_) { return null }
}

// ── arbitrajul: costul și ieșirea strictă (spec §3) ──
// Limita de SUS a costului unui apel (review Copilot r1 / Jakarinos r1 P1): un token de text are cel puțin un octet UTF-8, deci
// tokenii de text ≤ octeții promptului + ai datelor; imaginea: formula documentată (lățime × înălțime / 750, imaginile mari doar
// se micșorează) dublată ca marjă; plus ambalajul mesajului; ieșirea ≤ max_tokens. Costul real nu poate depăși rezervarea decât dacă
// prețul sau tokenizarea se schimbă — caz tratat separat (decontare la rezervare, needs_human, rularea oprită, excesul în jurnal).
// Preturile oficiale pe model ($ / token; referinta Claude API, cache 06.10.2026 — laborator OCR 15.10): Sonnet 5 2 / 10 $ pe 1M,
// Haiku 5.5 0,10 / 0,50 $ pe 1M pana la 100K tokeni de intrare (0,50 / 2,50 peste). Inainte: 3 / 15 (pretul vechi, cost raportat ~50%
// peste cel real). Model necunoscut = exceptie (fail closed: nicio rezervare fara pret).
export const PRETURI: Record<string, { in: number; out: number; prag?: number; peste?: { in: number; out: number } }> = {
  'claude-sonnet-5': { in: 2 / 1e6, out: 10 / 1e6 },
  'claude-haiku-5-5': { in: 0.10 / 1e6, out: 0.50 / 1e6, prag: 100_000, peste: { in: 0.50 / 1e6, out: 2.50 / 1e6 } },
}
export const MAX_TOKENI_IESIRE = 1024
export const AMBALAJ_TOKENI = 300
export const rotunjesteSus = (x: number): number => Math.ceil(x * 1e4 - 1e-9) / 1e4
export const tokeniImagineMax = (w: number, h: number): number => 2 * Math.ceil((w * h) / 750)
function pret(model: string, tokIn: number): { in: number; out: number } {
  const p = PRETURI[model]
  if (!p) throw new Error('Model fara pret: ' + model)
  return p.prag !== undefined && p.peste && tokIn > p.prag ? p.peste : p
}
export function limitaCost(octetiText: number, w: number, h: number, model: string): number {
  const tin = octetiText + tokeniImagineMax(w, h) + AMBALAJ_TOKENI, p = pret(model, tin)
  return rotunjesteSus(tin * p.in + MAX_TOKENI_IESIRE * p.out)
}
export const costReal = (tokIn: number, tokOut: number, model: string): number => { const p = pret(model, tokIn); return rotunjesteSus(tokIn * p.in + tokOut * p.out) }
export const octeti = (s: string): number => new TextEncoder().encode(s).length

export type Decizie = { decizie: 'ales_lighton' | 'ales_mineru' | 'text_propus' | 'needs_human'; text: string; motiv: string; e_cantitate: boolean; anomalie_separator: boolean }
const CHEI_IESIRE = ['anomalie_separator', 'decizie', 'e_cantitate', 'motiv', 'text']

// Ieșirea modelului → decizia. EXACT un obiect JSON cu cele 5 chei (spații în jur permise, nimic altceva); orice abatere =
// needs_human cu motivul abaterii (spec §3: „orice altă formă = needs_human”). La ales_* textul e citirea aleasă (BD îl derivă
// oricum din citiri); la text_propus textul trebuie să fie nevid; la needs_human gol.
export function decizieDinIesire(txt: string, item: { citire_lighton?: unknown; citire_mineru?: unknown; e_cantitate?: unknown; anomalie_separator?: unknown }): Decizie {
  const om = (motiv: string): Decizie => ({ decizie: 'needs_human', text: '', motiv, e_cantitate: item.e_cantitate === true, anomalie_separator: item.anomalie_separator === true })
  const t = txt.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return om('iesire in afara schemei (nu e un obiect JSON)')
  let o: unknown
  try { o = JSON.parse(t) } catch (_) { return om('iesire in afara schemei (JSON invalid)') }
  if (!esteObiect(o) || Object.keys(o).sort().join(',') !== CHEI_IESIRE.join(',')) return om('iesire in afara schemei (chei)')
  if (typeof o.text !== 'string' || typeof o.motiv !== 'string' || typeof o.e_cantitate !== 'boolean' || typeof o.anomalie_separator !== 'boolean') return om('iesire in afara schemei (tipuri)')
  if (o.motiv.length > 200 || o.text.length > 50000) return om('iesire in afara schemei (lungime)')
  const baza = { motiv: o.motiv, e_cantitate: o.e_cantitate, anomalie_separator: o.anomalie_separator }
  switch (o.decizie) {
    case 'ales_lighton': return { decizie: 'ales_lighton', text: String(item.citire_lighton ?? ''), ...baza }
    case 'ales_mineru': return { decizie: 'ales_mineru', text: String(item.citire_mineru ?? ''), ...baza }
    case 'text_propus': return /\S/.test(o.text) ? { decizie: 'text_propus', text: o.text, ...baza } : om('text_propus gol')
    case 'needs_human': return { decizie: 'needs_human', text: '', ...baza }
    default: return om('iesire in afara schemei (decizie)')
  }
}
