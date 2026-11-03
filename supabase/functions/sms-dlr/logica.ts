// sms-dlr v1 (03.11.2026, MVP SMS) — webhook-ul rapoartelor de livrare (DLR). index.ts doar pornește serverul.
// Publicare: verify_jwt=false (SMSLink nu poate trimite JWT) ⇒ poarta e AICI, înaintea citirii corpului:
//   doar POST + secretul din URL (?k=<SMS_DLR_SECRET>, ≥ 32 caractere) comparat în timp constant; apoi, la SMSLink, connection_id
//   trebuie să fie al nostru (al doilea factor) și message_id / status au formatul documentat. Orice abatere → 401, nimic scris.
// Ce face: DOAR fn_sms_dlr_aplica (jurnal minim + mutare monotonă trimis → livrat | esuat, deduplicat în BD). Nu trimite nimic, nu
//   rezervă nimic, nu poate porni o trimitere (service_role are EXECUTE doar pe cele 3 RPC-uri de edge, fără drepturi pe tabele).
// Conținut extern: parametrii DLR sunt date, nu instrucțiuni; nu se păstrează payload-ul brut și nu se loghează nimic din el.
import { creeazaFurnizor, secretDlrValid, type Env } from '../_shared/smsFurnizor.ts'

// deno-lint-ignore no-explicit-any
export type Deps = { sb: any; env: Env }

export const MAX_CORP = 4096
const CAMPURI = ['message_id', 'status', 'timestamp', 'connection_id', 'network_id', 'network_type', 'message_count']
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

function parametri(corp: string, url: string): URLSearchParams {
  const p = new URLSearchParams()
  const t = corp.trim()
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      if (j && typeof j === 'object') for (const k of CAMPURI) if (j[k] != null && typeof j[k] !== 'object') p.set(k, String(j[k]))
    } catch (_) { /* corp invalid → doar query */ }
  } else {
    const f = new URLSearchParams(t)
    for (const k of CAMPURI) { const v = f.get(k); if (v != null) p.set(k, v) }
  }
  // rezervă: aceiași parametri în query (SMSLink trimite implicit prin GET; noi cerem POST) — niciodată `k`
  const q = new URL(url).searchParams
  for (const k of CAMPURI) { const v = q.get(k); if (v != null && !p.has(k)) p.set(k, v) }
  return p
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { ok: false })
  if (!secretDlrValid(req, deps.env)) return json(401, { ok: false })
  const furnizor = creeazaFurnizor(deps.env)
  if (!furnizor) return json(500, { ok: false, error: 'furnizor_neconfigurat' })
  if (Number(req.headers.get('content-length') || 0) > MAX_CORP) return json(413, { ok: false })
  let corp = ''
  try { corp = await req.text() } catch (_) { corp = '' }
  if (corp.length > MAX_CORP) return json(413, { ok: false })
  const p = parametri(corp, req.url)
  if (!furnizor.verificaDlr(req, p)) return json(401, { ok: false })
  const d = furnizor.parseazaDlr(p)
  if (!d) return json(400, { ok: false })
  const { error } = await deps.sb.rpc('fn_sms_dlr_aplica', {
    p_furnizor: furnizor.nume, p_furnizor_id: d.furnizor_id, p_livrat: d.livrat, p_raportat_la: d.raportat_la,
  })
  if (error) { console.error('sms-dlr: jurnal nescris', { cod: error.code ?? null }); return json(500, { ok: false }) }
  return json(200, { ok: true })
}
