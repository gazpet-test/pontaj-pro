// redari-fan-urmarire — urmărirea AUTOMATĂ a AWB-urilor FAN ale plicurilor Redări (decizia owner-ului, 21.11.2026; migrarea 20270102a,
// docs/redari/FAN_URMARIRE_AUTOMATA.md). Logica: _shared/redariFanUrmarireAuto.mjs (aceeași urmărire ca butonul, urmaresteLot, L19).
// Poarta, ÎNAINTEA oricărei citiri: cronSauOwner (x-intern-secret = Vault INTERN_EDGE_SECRET, verificat în BD prin fn_verifica_secret, SAU
// JWT-ul owner-ului logat); verify_jwt rămâne pornit la publicare (cronul trimite și JWT-ul anon din Vault, ca jobul 29), dar NU ajunge
// (cheia anon e un JWT valid): fără secret și fără owner = 401, nimic citit, nimic chemat la curier. Corpul cererii e IGNORAT (nicio
// intrare din afară nu schimbă ce face rularea, L08). Identitatea: service_role (fără om la cron; RLS-ul tabelelor FAN cere un om admin /
// editor), folosit DOAR pentru poartă și pentru RPC-urile clasei B din lista închisă RPC_RULARE. Secrete (doar nume): SUPABASE_SERVICE_ROLE_KEY,
// FAN_SELFAWB_USERNAME, FAN_SELFAWB_PASSWORD, FAN_CLIENT_ID (Edge Secrets, aceleași ca redari-fan-awb), INTERN_EDGE_SECRET (Vault).
// Răspunsul (păstrat de pg_net) are doar numere și coduri: fără AWB-uri, fără nume, fără texte ale curierului.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'
import { ruleazaUrmarireAuto } from '../_shared/redariFanUrmarireAuto.mjs'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ cod: 'metoda_nepermisa' }, 405)
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const cine = await cronSauOwner(req, sb)
    if (!cine) return json({ cod: 'neautorizat' }, 401)
    let actor: string | null = null
    if (cine === 'owner') {
      // id-ul owner-ului pentru jurnalul rulării (BD-ul îl reverifică: profiles.is_owner); eroare = 401, nimic pornit
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer[ \t]+/i, '')
      const { data, error } = await sb.auth.getUser(jwt)
      if (error || !data?.user?.id) return json({ cod: 'neautorizat' }, 401)
      actor = data.user.id
    }
    const r = await ruleazaUrmarireAuto({ sursa: cine, actor }, {
      rpcServer: (nume: string, args: Record<string, unknown>) => sb.rpc(nume, args),
      secrete: () => ({ username: Deno.env.get('FAN_SELFAWB_USERNAME'), password: Deno.env.get('FAN_SELFAWB_PASSWORD'), clientId: Deno.env.get('FAN_CLIENT_ID') }),
      fetch: (url: string, init: RequestInit) => fetch(url, init),
      pauza: (ms: number) => new Promise<void>(res => setTimeout(res, ms)),
      acum: () => Date.now(),
    })
    return json(r.body, r.status)
  } catch {
    console.error('redari-fan-urmarire: eroare neasteptata')
    return json({ cod: 'eroare_neconfirmata' }, 503)
  }
})
