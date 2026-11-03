// sms-sold v1 (20261130d, 03.11.2026) — citește zilnic soldul SMSLink (mode=Credit) și îl scrie în BD. index.ts doar pornește serverul.
// De ce o funcție separată (nu o acțiune în sms-trimite): sms-trimite are verify_jwt=true și poate trimite SMS-uri plătite; cronul fără
//   JWT ar cere scoaterea lui din verificarea JWT. Aici suprafața e minimă: nu rezervă, nu trimite, nu atinge loturi sau mesaje.
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
// (a) Conținut EXTERN citit: răspunsul JSON al SMSLink la mode=Credit. Se păstrează DOAR `credit` (întreg ≥ 0) sau codul de eroare
//     (_shared/smsFurnizor.ts citesteSold): response_message nu se citește (eroarea 7 conține parola), răspunsul brut nu se loghează
//     și nu se salvează.
// (b) Ce scrie: DOAR rândul unic din public.sms_sold, prin RPC-ul fn_sold_sms_inregistreaza (SECURITY DEFINER; service_role are EXECUTE
//     doar pe el, fără drepturi pe tabelă). Fără mail, fără SMS, fără bani, fără drepturi. Alerta (sub prag / citire veche / eroare)
//     e calculată în BD (fn_sold_sms_stare) și afișată în Administrator → 🔔 Alerte (sursa „SMS · sold SMSLink”, doar owner) și în
//     panoul SMS (doar owner).
// (c) Identitate: service_role (singurul rol cu EXECUTE pe fn_sold_sms_inregistreaza); clientul cu JWT-ul utilizatorului doar pentru
//     fn_sms_nivel() la poarta owner-ului. Credențialele SMSLink stau în Edge Secrets (SMSLINK_CONNECTION_ID / SMSLINK_PASSWORD).
// (d) Cine pornește: pg_cron (jobul sms_sold_zilnic) cu x-intern-secret din Vault (_shared/poartaIntern.ts) SAU owner-ul (JWT verificat
//     cu auth.getUser + fn_sms_nivel() = 'owner' cerut CU JWT-ul lui). verify_jwt nu ajunge (cheia anon e un JWT valid, PR #318).
// r2 (#971): simulatorul nu scrie sold (P2-01); scrierea e CAS pe momentul de start al citirii (P2-04); răspunsul are `scris`.
// (e) Confirmare umană: niciuna necesară (citire la furnizor + scriere pe rândul propriu); reîncărcarea creditului o face Razvan în cont.
import { esteApelIntern } from '../_shared/poartaIntern.ts'
import { citesteSold, type Env, type Sold } from '../_shared/smsFurnizor.ts'

// deno-lint-ignore no-explicit-any
type Client = any
export type Deps = { sb: Client; sbUtilizator: (jwt: string) => Client; env: Env; fetch: typeof fetch; acum?: () => number }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Poarta: 'cron' (secret intern) | 'owner' (JWT + nivel owner din BD, cerut cu JWT-ul lui) | null. Orice eroare → null (fail closed). */
export async function poartaSold(req: Request, deps: Pick<Deps, 'sb' | 'sbUtilizator'>): Promise<'cron' | 'owner' | null> {
  if (await esteApelIntern(req, deps.sb)) return 'cron'
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return null
    const { data: u, error } = await deps.sb.auth.getUser(jwt)
    const uid = !error && typeof u?.user?.id === 'string' ? u.user.id : null
    if (!uid || !UUID.test(uid)) return null
    const { data: nivel, error: e2 } = await deps.sbUtilizator(jwt).rpc('fn_sms_nivel')
    return !e2 && nivel === 'owner' ? 'owner' : null
  } catch (_) {
    return null
  }
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'doar POST' })
  const apelant = await poartaSold(req, deps)
  if (!apelant) return json(401, { ok: false, error: 'neautorizat' })

  // cererea nu are parametri: corpul nu se citește. Momentul de START al citirii merge în BD (CAS, r2 P2-04): o citire începută mai
  // devreme și terminată mai târziu (cron + „Citește acum” în paralel) nu poate suprascrie rezultatul uneia începute ulterior.
  const inceput = new Date(deps.acum ? deps.acum() : Date.now()).toISOString()
  let s: Sold
  try { s = await citesteSold(deps.env, { fetch: deps.fetch }) } catch (_) { s = { ok: false, eroare: 'adaptor_exceptie' } }
  // r2 (P2-01, implicit): simulatorul nu are sold — nu se scrie nici „citire reușită”, nici eroare. r3 (Copilot r2 P2-01): se scrie DOAR
  // furnizorul curent (furnizor_ultim = simulator), ca panoul și Alertele să știe din BD, fără click, că soldul rămas e doar „ultimul cunoscut”.
  if ('simulator' in s) {
    const { error } = await deps.sb.rpc('fn_sold_sms_inregistreaza', { p_credit: null, p_eroare: null, p_inceput: inceput, p_furnizor: 'simulator' })
    if (error) {
      console.error('sms-sold: furnizor nescris', { cod: error.code ?? null })
      return json(500, { ok: false, error: 'scriere_bd' })
    }
    console.log('sms-sold', { apelant, furnizor: 'simulator' })
    return json(200, { ok: true, apelant, furnizor: 'simulator', sold: null })
  }
  const args = s.ok ? { p_credit: s.credit, p_eroare: null, p_inceput: inceput, p_furnizor: 'smslink' }
    : { p_credit: null, p_eroare: s.eroare, p_inceput: inceput, p_furnizor: 'smslink' }
  const { data, error } = await deps.sb.rpc('fn_sold_sms_inregistreaza', args)
  if (error) {
    console.error('sms-sold: sold nescris', { cod: error.code ?? null })
    return json(500, { ok: false, error: 'scriere_bd' })
  }
  const subPrag = typeof data?.sub_prag === 'boolean' ? data.sub_prag : null
  const scris = data?.scris === true
  console.log('sms-sold', { apelant, ok: s.ok, eroare: s.ok ? null : s.eroare, sub_prag: subPrag, scris })
  return json(200, { ok: s.ok, apelant, furnizor: 'smslink', ...(s.ok ? { credit: s.credit } : { eroare: s.eroare }), scris, prag: data?.prag ?? null, sub_prag: subPrag })
}
