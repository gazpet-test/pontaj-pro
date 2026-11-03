// sms-trimite v1 (03.11.2026, MVP SMS) — trimite mesajele unui lot APROBAT de owner. index.ts doar pornește serverul.
// Poarta (în cod, ÎNAINTEA citirii corpului; verify_jwt nu ajunge — cheia anon e un JWT valid, lecția PR #318):
//   owner logat (JWT verificat cu auth.getUser + profiles.is_owner) SAU cronul intern (x-intern-secret = Vault INTERN_EDGE_SECRET),
//   prin _shared/poartaCron.ts. Altceva → 401, fără nicio citire / rezervare / trimitere.
// Ce face: în runde de câte 5 — fn_sms_rezerva (atomic în BD: lot aprobat, kill-switch, plafon zi / lună, opt-out, Redări doar autorizat
//   și 08–20) → adaptorul (_shared/smsFurnizor.ts, SMSLink sau simulator) → fn_sms_rezultat. Erorile de configurare / credit opresc
//   automat trimiterea (kill-switch în BD) și runda. Un rezultat nescris lasă mesajul `necunoscut` (NU se retrimite).
// r2 (Copilot r1 P3-01): la loturile Redări, fereastra 08–20 (ora României) se verifică și aici, imediat înaintea fiecărei cereri către
//   furnizor; la ieșirea din fereastră mesajul nu pleacă (eșuat cu codul in_afara_orelor) și trimiterea lotului se oprește.
// Identitate: clientul service_role, folosit DOAR pentru auth.getUser / profiles (poarta) și pentru cele 2 RPC-uri (service_role nu
//   are drepturi directe pe tabelele sms_*). Răspunsul și logurile au doar numere și coduri — niciun telefon, niciun text, niciun secret.
import { cronSauOwner } from '../_shared/poartaCron.ts'
import { creeazaFurnizor, EROARE_IN_AFARA_ORELOR, type Env, type Rezultat } from '../_shared/smsFurnizor.ts'
import { codSigur, inFereastraExterna } from '../_shared/smsText.mjs'

// deno-lint-ignore no-explicit-any
export type Deps = { sb: any; env: Env; fetch: typeof fetch; acum: () => number; sleep?: (ms: number) => Promise<void> }

// mesaje rezervate și trimise în paralel într-o rundă (SMSLink admite 50 de conexiuni / IP)
export const LOT_RUNDA = 5
// ≤ 300 de mesaje într-un apel; restul la următorul apel (butonul „Trimite” sau cronul)
export const MAX_RUNDE = 60
// sub limita de timp a funcției edge
export const BUGET_MS = 100_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type MesajRezervat = { id: string; telefon: string }

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { ok: false, error: 'doar POST' })
  const apelant = await cronSauOwner(req, deps.sb)
  if (!apelant) return json(401, { ok: false, error: 'neautorizat' })

  let body: Record<string, unknown> | null = null
  try { body = await req.json() } catch (_) { body = null }
  const lotId = body && typeof body.lot_id === 'string' ? body.lot_id : null
  if (lotId !== null && !UUID.test(lotId)) return json(400, { ok: false, error: 'lot_id invalid' })
  // owner-ul trimite un lot anume
  if (apelant === 'owner' && !lotId) return json(400, { ok: false, error: 'lot_id lipsă' })

  const furnizor = creeazaFurnizor(deps.env, { fetch: deps.fetch, sleep: deps.sleep })
  if (!furnizor) return json(500, { ok: false, error: 'furnizor_neconfigurat' })

  const start = deps.acum()
  const rez = { trimise: 0, esuate: 0, necunoscute: 0, runde: 0, motiv: 'max_runde' }
  for (let runda = 0; runda < MAX_RUNDE; runda++) {
    if (deps.acum() - start > BUGET_MS) { rez.motiv = 'timp'; break }
    const { data, error } = await deps.sb.rpc('fn_sms_rezerva', { p_lot_id: lotId, p_max: LOT_RUNDA, p_furnizor: furnizor.nume })
    if (error) { console.error('sms-trimite: rezervare refuzata', { cod: error.code ?? null }); rez.motiv = 'eroare_rezervare'; break }
    rez.runde++
    const mesaje: MesajRezervat[] = Array.isArray(data?.mesaje) ? data.mesaje : []
    if (!mesaje.length) { rez.motiv = typeof data?.motiv === 'string' ? data.motiv : 'gata'; break }
    const text = String(data?.text ?? '')
    // Redări (extern): fereastra 08–20 verificată imediat înaintea fiecărei cereri către furnizor, pe ceasul edge-ului
    const inainteDeApel = data?.categorie === 'redari' ? () => inFereastraExterna(deps.acum()) : undefined
    const rezultate: Rezultat[] = await Promise.all(mesaje.map(m =>
      furnizor.trimite({ to: String(m.telefon), text, ref: String(m.id), inainteDeApel })
        .catch((): Rezultat => ({ ok: false, clasa: 'necunoscut', eroare: 'adaptor_exceptie', segmente: 1 }))))
    let oprire: string | null = null
    for (let i = 0; i < mesaje.length; i++) {
      const r = rezultate[i]
      const args = r.ok
        ? { p_mesaj_id: mesaje[i].id, p_ok: true, p_furnizor_id: r.furnizor_id, p_cod_eroare: null, p_clasa: null }
        : { p_mesaj_id: mesaje[i].id, p_ok: false, p_furnizor_id: null, p_cod_eroare: codSigur(r.eroare), p_clasa: r.clasa }
      const { error: e2 } = await deps.sb.rpc('fn_sms_rezultat', args)
      if (e2) {
        // mesajul rămâne `necunoscut` în BD: nu se retrimite automat
        console.error('sms-trimite: rezultat nescris', { cod: e2.code ?? null })
        rez.necunoscute++
        continue
      }
      if (r.ok) rez.trimise++
      else if (r.clasa === 'necunoscut') rez.necunoscute++
      else rez.esuate++
      if (!r.ok && (r.clasa === 'config' || r.clasa === 'credit')) oprire = 'oprit_automat'
      if (!r.ok && r.eroare === EROARE_IN_AFARA_ORELOR && !oprire) oprire = EROARE_IN_AFARA_ORELOR
    }
    if (oprire) { rez.motiv = oprire; break }
  }
  return json(200, { ok: true, apelant, lot_id: lotId, furnizor: furnizor.nume, ...rez })
}
