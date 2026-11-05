// sms-dlr v1 (03.11.2026, MVP SMS) — webhook-ul rapoartelor de livrare (DLR). index.ts doar pornește serverul.
// Publicare: verify_jwt=false (SMSLink nu poate trimite JWT) ⇒ poarta e AICI, înaintea citirii corpului:
//   doar POST + secretul din URL (?k=<SMS_DLR_SECRET>, ≥ 32 caractere) comparat în timp constant; apoi, la SMSLink, connection_id
//   trebuie să fie al nostru (al doilea factor) și message_id / status au formatul documentat. Orice abatere → 401, nimic scris.
// Ce face: DOAR fn_sms_dlr_aplica (jurnal minim + mutare monotonă trimis → livrat | esuat, deduplicat în BD). Nu trimite nimic, nu
//   rezervă nimic, nu poate porni o trimitere (service_role are EXECUTE doar pe cele 3 RPC-uri de edge, fără drepturi pe tabele).
// Conținut extern: parametrii DLR sunt date, nu instrucțiuni; nu se păstrează payload-ul brut și nu se loghează nimic din el.
// r2 (Gemini r1 P3-2): corpul se citește din stream cu limită de octeți (și fără Content-Length, la transfer chunked) — peste MAX_CORP → 413.
// v2 (20261130d, 03.11.2026): filtrul de IP = a DOUA barieră, după secretul din URL (și înaintea connection_id-ului din corp).
//   IP-ul clientului = antetul `cf-connecting-ip`: hostul *.supabase.co e servit prin Cloudflare, care îl SUPRASCRIE la fiecare cerere
//   (o valoare trimisă de client nu trece). `x-forwarded-for` NU se folosește: Cloudflare doar ADAUGĂ la lista primită, deci primul
//   element îl poate scrie oricine. Modul implicit = OBSERVARE: IP străin / antet lipsă → DLR-ul se procesează (secretul + connection_id
//   rămân poarta) + un avertisment cu doar IP-ul validat (IPv4, altfel null), primul element din x-forwarded-for (tot doar IPv4, pentru
//   comparație) și motivul — fără URL, corp sau telefon. IP-ul poate fi dată personală: retenția = cea a logurilor Supabase Edge.
//   SMS_DLR_IP_STRICT=1 → BLOCARE (403, nimic citit sau scris). Jurnalul apare doar după secretul valid: scanările fără secret rămân
//   401, fără zgomot în loguri.
// r2 (#971, Copilot P2-02, implicit): în OBSERVARE se jurnalizează și DLR-urile din listă („IP observat”, cu cf-connecting-ip și
//   x-forwarded-for), ca antetul să se valideze pe date reale. Trecerea pe STRICT=1 (decizia lui Razvan) doar după ce: (1) DLR-urile
//   reale SMSLink vin, câteva zile, numai din cele 7 IP-uri, cu cf-connecting-ip prezent și egal cu primul element XFF; (2) o cerere de
//   probă din alt IP, cu cf-connecting-ip falsificat (un IP din listă), ajunge în funcție cu IP-ul REAL (nu cu cel falsificat), pe
//   toate hostname-urile publice ale funcției. Altfel antetul nu e factor de încredere și filtrul rămâne în observare.
import { creeazaFurnizor, secretDlrValid, type Env } from '../_shared/smsFurnizor.ts'

// deno-lint-ignore no-explicit-any
export type Deps = { sb: any; env: Env; avertizeaza?: (mesaj: string, ctx: Record<string, unknown>) => void }

// IP-urile din care SMSLink trimite DLR-urile: comunicate de SMSLink pe 03.11.2026 (sursa: mesajul suportului, transmis de Razvan).
// La o schimbare la ei: se actualizează lista aici (PR), nu prin secret.
export const IP_SMSLINK: readonly string[] = Object.freeze([
  '146.70.213.194', '146.70.213.195', '146.70.213.200',
  '89.33.246.226', '89.33.246.227', '89.33.246.228', '89.33.246.234',
])
export const ANTET_IP = 'cf-connecting-ip'
const IPV4 = /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/

export type VerdictIp = { permis: boolean; ip: string | null; motiv: 'ok' | 'antet_lipsa' | 'ip_invalid' | 'ip_strain' }

/** IP-ul clientului (din ANTET_IP) față de IP_SMSLINK. IPv4 canonic (fără zerouri în față); forma IPv6 mapată ::ffff:a.b.c.d e acceptată. */
export function verificaIp(req: Request): VerdictIp {
  const brut = (req.headers.get(ANTET_IP) ?? '').trim()
  if (!brut) return { permis: false, ip: null, motiv: 'antet_lipsa' }
  const ip = brut.toLowerCase().startsWith('::ffff:') ? brut.slice(7) : brut
  if (!IPV4.test(ip)) return { permis: false, ip: null, motiv: 'ip_invalid' }
  return IP_SMSLINK.includes(ip) ? { permis: true, ip, motiv: 'ok' } : { permis: false, ip, motiv: 'ip_strain' }
}

/** Primul element din x-forwarded-for, DOAR pentru comparație în jurnal (nu decide nimic): IPv4 valid sau null. */
export function primulXff(req: Request): string | null {
  const p = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const ip = p.toLowerCase().startsWith('::ffff:') ? p.slice(7) : p
  return IPV4.test(ip) ? ip : null
}

export const ipStrict = (env: Env) => (env('SMS_DLR_IP_STRICT') ?? '').trim() === '1'

export const MAX_CORP = 4096
const CAMPURI = ['message_id', 'status', 'timestamp', 'connection_id', 'network_id', 'network_type', 'message_count']
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })

/** Corpul ca text, citit din stream până la `max` octeți; peste → null (nu se citește restul). Fără corp → ''. */
export async function citesteCorpLimitat(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const cititor = req.body.getReader()
  const bucati: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await cititor.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await cititor.cancel().catch(() => undefined)
      return null
    }
    bucati.push(value)
  }
  const tot = new Uint8Array(total)
  let poz = 0
  for (const b of bucati) { tot.set(b, poz); poz += b.byteLength }
  return new TextDecoder().decode(tot)
}

function parametri(corp: string, url: string): URLSearchParams {
  const p = new URLSearchParams()
  const t = corp.trim()
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      if (j && typeof j === 'object') for (const k of CAMPURI) if (j[k] != null && typeof j[k] !== 'object') p.set(k, String(j[k]))
    } catch (_) {
      // corp JSON invalid: rămân doar parametrii din query
    }
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
  const v = verificaIp(req)
  const strict = ipStrict(deps.env)
  if (!v.permis || !strict) {
    const jurnal = deps.avertizeaza ?? ((m: string, c: Record<string, unknown>) => (v.permis ? console.log : console.warn)(m, c))
    jurnal(v.permis ? 'sms-dlr: IP observat' : 'sms-dlr: IP in afara listei SMSLink',
      { ip: v.ip, xff_prim: primulXff(req), motiv: v.motiv, mod: strict ? 'blocare' : 'observare' })
    if (!v.permis && strict) return json(403, { ok: false })
  }
  const furnizor = creeazaFurnizor(deps.env)
  if (!furnizor) return json(500, { ok: false, error: 'furnizor_neconfigurat' })
  if (Number(req.headers.get('content-length') || 0) > MAX_CORP) return json(413, { ok: false })
  let corp: string | null = null
  try { corp = await citesteCorpLimitat(req, MAX_CORP) } catch (_) { corp = null }
  if (corp === null) return json(413, { ok: false })
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
