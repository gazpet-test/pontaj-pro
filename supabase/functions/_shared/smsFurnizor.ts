// smsFurnizor.ts — adaptorul unic de SMS (MVP 03.11.2026; docs/sms/RAPORT_SMS_2026-11-03.md §3, RAPORT_SMSLINK_API_2026-11-03.md §2).
// Edge-urile (sms-trimite, sms-dlr) vorbesc DOAR cu interfața de aici; schimbarea furnizorului = o implementare nouă + un secret.
// Furnizorul se alege din secretul SMS_FURNIZOR: 'smslink' | 'simulator' (teste / CI: nu iese nimic în rețea). Altceva → null (fail closed).
// Secrete (doar nume; valorile stau în Edge Secrets, niciodată în cod / loguri): SMS_FURNIZOR, SMSLINK_CONNECTION_ID, SMSLINK_PASSWORD,
//   SMS_DLR_SECRET (≥ 32 caractere, în URL-ul DLR), opțional SMSLINK_SENDER (gol = număr scurt) și SMSLINK_TEST ('1' = răspuns simulat de SMSLink).
// Reguli: textul se re-normalizează aici (GSM-7, max 160) și orice abatere oprește trimiterea ÎNAINTE de rețea; din răspunsul SMSLink se
//   păstrează DOAR codul (response_message NU se citește: eroarea 7 conține parola); timeout după ce cererea a plecat = 'necunoscut',
//   fără retrimitere (idempotency nedocumentat → am plăti o dublură); doar eroarea 16 (tranzitorie) se reîncearcă, de max. 3 ori.
import { verificaText, telefonNational, clasificaSmslink, egalTimpConstant, codSigur } from './smsText.mjs'

export type Clasa = 'permanent' | 'config' | 'credit' | 'tranzitoriu' | 'necunoscut'
export type Rezultat =
  | { ok: true; furnizor_id: string; segmente: number }
  | { ok: false; clasa: Clasa; eroare: string; segmente: number }
export type Dlr = { furnizor_id: string; livrat: boolean; raportat_la: string | null }
export type Cerere = { to: string; text: string; ref: string }
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
const INCERCARI_TRANZITORIU = 3

const dormi = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Validarea comună înaintea rețelei: număr mobil RO, text GSM-7 normalizat, max 160. */
function pregateste(c: Cerere): { ok: true; nat: string; text: string; segmente: number } | { ok: false; r: Rezultat } {
  const v = verificaText(c?.text)
  if (!v.ok || v.text !== c.text) return { ok: false, r: { ok: false, clasa: 'permanent', eroare: 'text_invalid', segmente: v.segmente } }
  const nat = telefonNational(c?.to)
  if (!nat) return { ok: false, r: { ok: false, clasa: 'permanent', eroare: 'telefon_invalid', segmente: v.segmente } }
  return { ok: true, nat, text: v.text, segmente: v.segmente }
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
      return { ok: false, clasa: 'necunoscut', eroare: 'retea_timeout', segmente }   // cererea poate fi plecat: NU se retrimite
    }
    let j: Record<string, unknown> | null = null
    try { j = await r.json() } catch (_) { j = null }
    if (!j || typeof j !== 'object') return { ok: false, clasa: 'necunoscut', eroare: codSigur(`http_${r.status}`), segmente }
    if (j.response_type === 'MESSAGE' && j.message_id != null && /^[0-9]{1,20}$/.test(String(j.message_id))) {
      return { ok: true, furnizor_id: String(j.message_id), segmente }
    }
    if (j.response_type === 'ERROR') {
      const cod = Number(j.response_id)   // response_message NU se citește (eroarea 7 conține parola în clar)
      if (!Number.isInteger(cod) || cod < 0 || cod > 999) return { ok: false, clasa: 'necunoscut', eroare: 'smslink_raspuns', segmente }
      return { ok: false, clasa: clasificaSmslink(cod), eroare: `smslink_${cod}`, segmente }
    }
    return { ok: false, clasa: 'necunoscut', eroare: 'smslink_raspuns', segmente }   // răspuns neașteptat: poate a plecat
  }
  return {
    nume: 'smslink',
    async trimite(c) {
      const p = pregateste(c)
      if (!p.ok) return p.r
      if (!env('SMSLINK_CONNECTION_ID') || !env('SMSLINK_PASSWORD')) return { ok: false, clasa: 'config', eroare: 'smslink_neconfigurat', segmente: p.segmente }
      let rez = await oData(p.nat, p.text, p.segmente)
      for (let i = 1; i < INCERCARI_TRANZITORIU && !rez.ok && rez.clasa === 'tranzitoriu'; i++) {
        await sleep(1000 * 2 ** (i - 1))
        rez = await oData(p.nat, p.text, p.segmente)
      }
      return rez
    },
    async status(_id) { return { suportat: false as const } },   // SMSLink nu are interogare publică de stare: doar DLR prin webhook
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
//   …7 = respins permanent, …8 = timeout (necunoscut), …9 = eroare tranzitorie; restul = trimis, cu id 'sim-<uuid>'.
function simulator(env: Env): Furnizor {
  return {
    nume: 'simulator',
    async trimite(c) {
      const p = pregateste(c)
      if (!p.ok) return p.r
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

/** Furnizorul configurat sau null (SMS_FURNIZOR lipsă / necunoscut → nimic nu pleacă). */
export function creeazaFurnizor(env: Env, o: Optiuni = {}): Furnizor | null {
  const nume = (env('SMS_FURNIZOR') ?? '').trim()
  if (nume === 'smslink') return smslink(env, o)
  if (nume === 'simulator') return simulator(env)
  return null
}
