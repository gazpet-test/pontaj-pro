// Poarta joburilor pg_cron care trimit mailuri programate — #17 faza 3 (06.10.2026).
// Înainte: x-ingest-secret = INGEST_SECRET, scris în clar în cron.job și împărțit cu Apps Script-ul Gmail.
// Acum: cronul trimite x-intern-secret din Vault (INTERN_EDGE_SECRET, verificat de _shared/poartaIntern.ts), iar
// owner-ul logat poate porni manual (probă / ?dry=1). Orice altceva → refuz. Fail closed la orice eroare.
// Folosită de: reminder-rapoarte, probleme-parc-reminder, necesar-notificari (doar acțiunile de cron), upa-plafon-alerta.
import { esteApelIntern } from './poartaIntern.ts'

export type Apelant = 'cron' | 'owner'

// deno-lint-ignore no-explicit-any
export async function cronSauOwner(req: Request, sb: any): Promise<Apelant | null> {
  if (await esteApelIntern(req, sb)) return 'cron'
  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return null
    const { data: u } = await sb.auth.getUser(jwt)
    if (!u?.user) return null
    const { data: prof } = await sb.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle()
    return prof?.is_owner === true ? 'owner' : null
  } catch (_) {
    return null
  }
}
