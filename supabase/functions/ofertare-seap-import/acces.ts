// acces.ts — cine poate porni importul SEAP (ofertare-seap-import). Separat de index.ts ca să fie testabil (acces_test.ts).
//
// Audit Jakarinos 07.10.2026 (#19, CLAUDE.md pct. 7d): un JWT de utilizator valid NU e suficient — funcția lucrează apoi
// cu service_role (sare peste RLS: urcă în Storage, scrie documente, șterge orfani). Înainte, orice cont logat în ERP putea
// porni importul pentru orice licitație. Acum:
//   - x-radar-secret valid (rutine; verificat contra Vault)   → permis, ca înainte
//   - Bearer <service_role> (veghea, apel intern)              → permis, ca înainte
//   - Bearer <JWT de utilizator>                               → doar cu acces la modulul Ofertare (fn_are_acces_ofertare,
//                                                               poarta comună ../_shared/poartaOfertare.ts, ca în api/)
import { poartaOfertare, type DepsPoartaOfertare } from '../_shared/poartaOfertare.ts'

export async function autorizeaza(req: Request, secretOk: () => Promise<boolean>, service: string | undefined, deps: DepsPoartaOfertare = {}): Promise<Response | null> {
  if (await secretOk()) return null
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || '')?.[1]
  if (jwt && service && jwt === service) return null
  return await poartaOfertare(req, deps)
}
