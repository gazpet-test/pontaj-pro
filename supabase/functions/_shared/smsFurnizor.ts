// smsFurnizor.ts — adaptorul unic de SMS (MVP 03.11.2026; docs/sms/RAPORT_SMS_2026-11-03.md §3, RAPORT_SMSLINK_API_2026-11-03.md §2).
// Edge-urile (sms-trimite, sms-dlr) vorbesc DOAR cu interfața de aici; schimbarea furnizorului = o implementare nouă + un secret.
// Furnizorul se alege din secretul SMS_FURNIZOR: 'smslink' | 'simulator' (teste / CI: nu iese nimic în rețea). Altceva → null (fail closed).
// Secrete (doar nume; valorile stau în Edge Secrets, niciodată în cod / loguri): SMS_FURNIZOR, SMSLINK_CONNECTION_ID, SMSLINK_PASSWORD,
//   SMS_DLR_SECRET (≥ 32 caractere, în URL-ul DLR), opțional SMSLINK_SENDER (gol = număr scurt) și SMSLINK_TEST ('1' = răspuns simulat de SMSLink).
// Reguli: textul se re-normalizează aici (GSM-7, max 160) și orice abatere oprește trimiterea ÎNAINTE de rețea; din răspunsul SMSLink se
//   păstrează DOAR codul (response_message NU se citește: eroarea 7 conține parola); timeout după ce cererea a plecat = 'necunoscut',
//   fără retrimitere (idempotency nedocumentat → am plăti o dublură).
// r2 (Jakarinos r1 P1): SINGURA retrimitere = codul 16 SMSLink („eroare la trimitere”, documentat ca neplecat), explicit, max. 3 încercări;
//   orice cod nou / nedocumentat = 'necunoscut', fără reîncercare. Copilot r1 P3-01: `inainteDeApel` (ex. fereastra 08–20 la Redări) se
//   verifică imediat înaintea FIECĂREI cereri HTTP, inclusiv a reîncercărilor; fals → nu pleacă nimic, rezultat 'in_afara_orelor'.
import { verificaText, telefonNational, clasificaSmslink, egalTimpConstant, codSigur, SMSLINK_COD_REINCERCABIL } from './smsText.mjs'

export type Clasa = 'permanent' | 'config' | 'credit' | 'tranzitoriu' | 'necunoscut'
export type Rezultat =
  | { ok: true; furnizor_id: string; segmente: number }
  | { ok: false; clasa: Clasa; eroare: string; segmente: number }
export type Dlr = { furnizor_id: string; livrat: boolean; raportat_la: string | null }
export type Cerere = { to: string; text: string; ref: string; inainteDeApel?: () => boolean }
export interface Furnizor {
  nume: 'smslink' | 'simulator'
  trimite(c: Cerere): Promise<Rezultat>
  status(id: string): Promise<{ suportat: false }>
  verificaDlr(req: Request, p: URLSearchParams): boolean
  parseazaDlr(p: URLSearchParams): Dlr | null
}
export type Env = (k: string) => string | undefined
export type Optiuni = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }

export const SMSLINK_API = 'https://secure.smslink.ro/sms/gateway/communicate/json.php'
export const LUNGIME_MIN_SECRET_DLR = 32
export const EROARE_IN_AFARA_ORELOR = 'in_afara_orelor'
export const INCERCARI_COD_16 = 3
const EROARE_REINCERCABILA = `smslink_${SMSLINK_COD_REINCERCABIL}`

const dormi = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Validarea comună înaintea rețelei: număr mobil RO, text GSM-7 normalizat, max 160. */
function pregateste(c: Cerere): { ok: true; nat: string; text: string; segmente: number } | { ok: false; r: Rezultat } {
  const v = verificaText(c?.text)
  if (!v.ok || v.text !== c.text) return { ok: false, r: { ok: false, clasa: 'permanent', eroare: 'text_invalid', segmente: v.segmente } }
  const nat = telefonNational(c?.to)
  if (!nat) return { ok: false, r: { ok: false, clasa: 'permanent', eroare: 'telefon_invalid', segmente: v.segmente } }
  return { ok: true, nat, text: v.text, segmente: v.segmente }
}

/** Garda de dinaintea unui apel: lipsă = permis; fals sau excepție = nu pleacă (fail closed). */
function poatePleca(c: Cerere): boolean {
  if (!c.inainteDeApel) return true
  try { return c.inainteDeApel() === true } catch (_) { return false }
}

/** Secretul DLR din URL (?k=…), comparat în timp constant; doar POST. Secret neconfigurat / scurt → false. */
export function secretDlrValid(req: Request, env: Env): boolean {
  if (req.method !== 'POST') return false
  const secret = env('SMS_DLR_SECRET') ?? ''
  if (secret.length < LUNGIME_MIN_SECRET_DLR) return false
  let k = ''
  try { k = new URL(req.url).searchParams.get('k') ?? '' } catch (_) { return false }
  return egalTimpConstant(k, secret)
}

function dataDlr(ts: string | null): string | null {
  if (!ts || !/^[0-9]{9,11}$/.test(ts)) return null
  const d = new Date(Number(ts) * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function smslink(env: Env, o: Optiuni): Furnizor {
  const f = o.fetch ?? fetch
  const sleep = o.sleep ?? dormi
  const timeoutMs = o.timeoutMs ?? 20_000
  async function oData(nat: string, text: string, segmente: number): Promise<Rezultat> {
    const body: Record<string, unknown> = {
      connection_id: env('SMSLINK_CONNECTION_ID'),
      password: env('SMSLINK_PASSWORD'),
      to: nat,
      message: text,
      test: env('SMSLINK_TEST') === '1' ? 1 : 0,
    }
    const sender = (env('SMSLINK_SENDER') ?? '').trim()
    if (sender) body.sender = sender
    let r: Response
    try {
      r = await f(SMSLINK_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    } catch (_) {
      // cererea poate fi plecat: NU se retrimite
      return { ok: false, clasa: 'necunoscut', eroare: 'retea_timeout', segmente }
    }
    let j: Record<string, unknown> | null = null
    try { j = await r.json() } catch (_) { j = null }
    if (!j || typeof j !== 'object') return { ok: false, clasa: 'necunoscut', eroare: codSigur(`http_${r.status}`), segmente }
    if (j.response_type === 'MESSAGE' && j.message_id != null && /^[0-9]{1,20}$/.test(String(j.message_id))) {
      return { ok: true, furnizor_id: String(j.message_id), segmente }
    }
    if (j.response_type === 'ERROR') {
      // response_message NU se citește (eroarea 7 conține parola în clar); orice cod nedocumentat → necunoscut (clasificaSmslink)
      const cod = Number(j.response_id)
      if (!Number.isInteger(cod) || cod < 0 || cod > 999) return { ok: false, clasa: 'necunoscut', eroare: 'smslink_raspuns', segmente }
      return { ok: false, clasa: clasificaSmslink(cod), eroare: `smslink_${cod}`, segmente }
    }
    // răspuns neașteptat: poate a plecat
    return { ok: false, clasa: 'necunoscut', eroare: 'smslink_raspuns', segmente }
  }
  return {
    nume: 'smslink',
    async trimite(c) {
      const p = pregateste(c)
      if (!p.ok) return p.r
      if (!env('SMSLINK_CONNECTION_ID') || !env('SMSLINK_PASSWORD')) return { ok: false, clasa: 'config', eroare: 'smslink_neconfigurat', segmente: p.segmente }
      if (!poatePleca(c)) return { ok: false, clasa: 'permanent', eroare: EROARE_IN_AFARA_ORELOR, segmente: p.segmente }
      let rez = await oData(p.nat, p.text, p.segmente)
      // reîncercare DOAR pe codul 16 (SMS-ul nu a plecat), explicit, maximum INCERCARI_COD_16 cereri în total
      for (let i = 1; i < INCERCARI_COD_16 && !rez.ok && rez.eroare === EROARE_REINCERCABILA; i++) {
        await sleep(1000 * 2 ** (i - 1))
        if (!poatePleca(c)) return { ok: false, clasa: 'permanent', eroare: EROARE_IN_AFARA_ORELOR, segmente: p.segmente }
        rez = await oData(p.nat, p.text, p.segmente)
      }
      return rez
    },
    // SMSLink nu are interogare publică de stare: doar DLR prin webhook
    async status(_id) { return { suportat: false as const } },
    verificaDlr(req, p) {
      const cid = env('SMSLINK_CONNECTION_ID') ?? ''
      return secretDlrValid(req, env) && cid.length > 0 && egalTimpConstant(p.get('connection_id') ?? '', cid)
        && /^[0-9]{1,20}$/.test(p.get('message_id') ?? '') && /^[01]$/.test(p.get('status') ?? '')
    },
    parseazaDlr(p) {
      const id = p.get('message_id') ?? '', st = p.get('status') ?? ''
      if (!/^[0-9]{1,20}$/.test(id) || !/^[01]$/.test(st)) return null
      return { furnizor_id: id, livrat: st === '1', raportat_la: dataDlr(p.get('timestamp')) }
    },
  }
}

// Simulator (SMS_FURNIZOR=simulator): nu iese nimic în rețea. Rezultat determinist după ultima cifră a numărului (numere fictive 0700…):
//   …7 = respins permanent, …8 = timeout (necunoscut), …9 = eroare tranzitorie (fără reîncercare aici); restul = trimis, cu id 'sim-<uuid>'.
function simulator(env: Env): Furnizor {
  return {
    nume: 'simulator',
    async trimite(c) {
      const p = pregateste(c)
      if (!p.ok) return p.r
      if (!poatePleca(c)) return { ok: false, clasa: 'permanent', eroare: EROARE_IN_AFARA_ORELOR, segmente: p.segmente }
      const ultima = p.nat.slice(-1)
      if (ultima === '7') return { ok: false, clasa: 'permanent', eroare: 'sim_respins', segmente: p.segmente }
      if (ultima === '8') return { ok: false, clasa: 'necunoscut', eroare: 'sim_timeout', segmente: p.segmente }
      if (ultima === '9') return { ok: false, clasa: 'tranzitoriu', eroare: 'sim_tranzitoriu', segmente: p.segmente }
      return { ok: true, furnizor_id: `sim-${crypto.randomUUID()}`, segmente: p.segmente }
    },
    async status(_id) { return { suportat: false as const } },
    verificaDlr(req, p) {
      return secretDlrValid(req, env) && /^sim-[0-9a-f-]{36}$/.test(p.get('message_id') ?? '') && /^[01]$/.test(p.get('status') ?? '')
    },
    parseazaDlr(p) {
      const id = p.get('message_id') ?? '', st = p.get('status') ?? ''
      if (!/^sim-[0-9a-f-]{36}$/.test(id) || !/^[01]$/.test(st)) return null
      return { furnizor_id: id, livrat: st === '1', raportat_la: dataDlr(p.get('timestamp')) }
    },
  }
}

// ── Soldul (20261130d, 03.11.2026): mode=Credit, corp JSON cu connection_id + password (form-urlencoded → „Insufficient arguments”) ──
// Din răspuns se păstrează DOAR `credit` (întreg ≥ 0) sau codul de eroare: response_message NU se citește (eroarea 7 conține parola),
// iar răspunsul brut nu se loghează și nu se salvează. Nu trimite nimic, nu consumă credit.
// r2 (#971, Jakarinos P2 + Copilot P2-03 / P3-04 / P2-01): un HTTP non-2xx e eroare (http_<status>) chiar dacă JSON-ul are `credit`;
//   `response_type` e acceptat doar lipsă (forma documentată a mode=Credit: credit + timestamp) sau MESSAGE — altceva = smslink_raspuns;
//   corpul se citește cu plafon (MAX_RASPUNS_SOLD octeți); simulatorul NU are sold (nu se scrie nimic, nu e „citire reușită”).
export type Sold = { ok: true; credit: number } | { ok: false; eroare: string } | { ok: false; simulator: true }
export const SOLD_MAX = 10_000_000
export const MAX_RASPUNS_SOLD = 4096

/** Corpul unui răspuns ca text, citit cu plafon de octeți; peste plafon / fără corp lizibil → null. */
async function textLimitat(r: Response, max: number): Promise<string | null> {
  if (!r.body) return null
  const cititor = r.body.getReader()
  const bucati: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await cititor.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await cititor.cancel().catch(() => undefined); return null }
    bucati.push(value)
  }
  const tot = new Uint8Array(total)
  let poz = 0
  for (const b of bucati) { tot.set(b, poz); poz += b.byteLength }
  return new TextDecoder().decode(tot)
}

export async function citesteSold(env: Env, o: Optiuni = {}): Promise<Sold> {
  const nume = (env('SMS_FURNIZOR') ?? '').trim()
  if (nume === 'simulator') return { ok: false, simulator: true }
  if (nume !== 'smslink') return { ok: false, eroare: 'furnizor_neconfigurat' }
  if (!env('SMSLINK_CONNECTION_ID') || !env('SMSLINK_PASSWORD')) return { ok: false, eroare: 'smslink_neconfigurat' }
  const f = o.fetch ?? fetch
  let r: Response
  try {
    r = await f(`${SMSLINK_API}?mode=Credit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: env('SMSLINK_CONNECTION_ID'), password: env('SMSLINK_PASSWORD'), mode: 'Credit' }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
    })
  } catch (_) {
    return { ok: false, eroare: 'retea_timeout' }
  }
  if (!r.ok) { await r.body?.cancel().catch(() => undefined); return { ok: false, eroare: codSigur(`http_${r.status}`) } }
  let j: Record<string, unknown> | null = null
  try {
    const t = await textLimitat(r, MAX_RASPUNS_SOLD)
    const p = t === null ? null : JSON.parse(t)
    j = p && typeof p === 'object' && !Array.isArray(p) ? p : null
  } catch (_) { j = null }
  if (!j) return { ok: false, eroare: 'smslink_raspuns' }
  if (j.response_type === 'ERROR') {
    const cod = Number(j.response_id)
    return Number.isInteger(cod) && cod >= 0 && cod <= 999 ? { ok: false, eroare: `smslink_${cod}` } : { ok: false, eroare: 'smslink_raspuns' }
  }
  if (j.response_type !== undefined && j.response_type !== 'MESSAGE') return { ok: false, eroare: 'smslink_raspuns' }
  // `credit` = numărul de SMS-uri disponibile (număr sau text zecimal; fracțiunea se taie în jos, ca alerta să nu întârzie);
  // altă formă (lipsă, negativ, uriaș, text) = răspuns neașteptat, NU 0
  const brut = typeof j.credit === 'number' ? j.credit
    : typeof j.credit === 'string' && /^[0-9]{1,8}(\.[0-9]{1,4})?$/.test(j.credit.trim()) ? Number(j.credit.trim()) : NaN
  if (!Number.isFinite(brut) || brut < 0 || brut > SOLD_MAX) return { ok: false, eroare: 'smslink_raspuns' }
  return { ok: true, credit: Math.floor(brut) }
}

/** Furnizorul configurat sau null (SMS_FURNIZOR lipsă / necunoscut → nimic nu pleacă). */
export function creeazaFurnizor(env: Env, o: Optiuni = {}): Furnizor | null {
  const nume = (env('SMS_FURNIZOR') ?? '').trim()
  if (nume === 'smslink') return smslink(env, o)
  if (nume === 'simulator') return simulator(env)
  return null
}
