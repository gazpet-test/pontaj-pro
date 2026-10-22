import { EroareE3, type SablonE3 } from '../ocr-packing-list/avizE3.ts'

export type ContextCerere = {
  id: string; creat_de: string; proiect_id: number; depozit_id: number; sablon: SablonE3;
  drept_platit_de: 'arbitraj' | 'fallback' | null; apel_faza: string | null;
  apel_raspuns: Record<string, unknown> | null; rezervare_id: number | null; cost_usd: number | null;
}
// Port de integrare explicit, NU SELECT care ar încălca ACL-ul B1.
// B1 revocă orice SELECT și stare nu expune proiect/depozit/apel_raspuns.
// Până la completarea contractului de citire, rutele care cer context refuză
// închis. Nu consumăm dreptul plătit pentru a descoperi contextul.
export type CitesteContext = (id: string, user: string | null, token: string | null) => Promise<ContextCerere | null>
export const contextIndisponibil: CitesteContext = () => Promise.reject(new EroareE3('contract_context_lipsa', 503))
