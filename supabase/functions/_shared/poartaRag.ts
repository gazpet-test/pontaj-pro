// Poarta rag-utilaj / rag-utilaj-embed — #17 faza 2 (05.10.2026, claude_context #1602).
// Înainte: secretul intern era scris direct în sursă, iar pe ramura JWT orice cont logat trecea (inclusiv pe
// process_queue = transcriere Claude plătită, și pe ask cu ai=true fără limită). Acum:
//   - cronul trimite x-intern-secret din Vault (INTERN_EDGE_SECRET, verificat de _shared/poartaIntern.ts);
//   - process_queue / process_pending: doar cronul sau owner-ul;
//   - ask (fișa utilajului din Logistică): owner sau cine are modulul logistica în user_module_access (orice nivel);
//   - ask_qr (pagina publică /q/:id) rămâne fără cont, dar cu limită zilnică „întâi notez, apoi număr”.
export type Decizie = { ok: true } | { ok: false; status: 401 | 403; error: string }

export const ACTIUNI_MASINA = new Set(['process_queue', 'process_pending'])

export function decideAcces(p: { intern: boolean; user: boolean; isOwner: boolean; areLogistica: boolean; action: string }): Decizie {
  if (p.intern) return { ok: true }
  if (!p.user) return { ok: false, status: 401, error: 'Neautorizat' }
  if (p.isOwner) return { ok: true }
  if (ACTIUNI_MASINA.has(p.action)) return { ok: false, status: 403, error: 'Doar cronul sau owner-ul pornesc procesarea cărților tehnice' }
  if (p.areLogistica) return { ok: true }
  return { ok: false, status: 403, error: 'Fără acces la modulul Logistică' }
}

// Limita QR fără cursă count-then-insert: rândul cererii se scrie ÎNAINTE de numărare, deci două cereri simultane
// se văd una pe alta. Numărul include cererea curentă; peste limită → refuz (rândul rămâne, numără ca încercare).
export function pesteLimita(cntActiv: number | null, cntGlobal: number | null, limActiv: number, limGlobal: number): boolean {
  return (cntActiv ?? Infinity) > limActiv || (cntGlobal ?? Infinity) > limGlobal
}
