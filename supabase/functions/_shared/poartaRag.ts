// Poarta rag-utilaj / rag-utilaj-embed — #17 faza 2 (05.10.2026, claude_context #1602), r2 după Copilot + Jakarinos.
// Înainte: secretul intern era scris direct în sursă, iar pe ramura JWT orice cont logat trecea (inclusiv pe
// process_queue = transcriere Claude plătită, și pe ask cu ai=true fără limită). Acum:
//   - cronul trimite x-intern-secret din Vault (INTERN_EDGE_SECRET, verificat de _shared/poartaIntern.ts);
//   - process_queue / process_pending: doar cronul sau owner-ul;
//   - ask fără AI (căutare în pasaje): owner sau oricine are modulul logistica (orice nivel);
//   - ask cu AI (cost Anthropic): owner sau logistica admin/editor — plus cota zilnică per utilizator în BD
//     (fn_rag_ask_rezerva, 50/zi), verificată în edge DUPĂ poarta de aici;
//   - ask_qr (pagina publică /q/:id) rămâne fără cont; cota atomică e în BD (fn_rag_qr_rezerva).
export type Decizie = { ok: true } | { ok: false; status: 401 | 403; error: string }
export type NivelModul = 'admin' | 'editor' | 'viewer' | null

export const ACTIUNI_MASINA = new Set(['process_queue', 'process_pending'])

// Cel mai înalt nivel dintr-o listă de rânduri user_module_access pe modulul logistica.
export function nivelMaxim(niveluri: (string | null | undefined)[]): NivelModul {
  if (niveluri.includes('admin')) return 'admin'
  if (niveluri.includes('editor')) return 'editor'
  if (niveluri.includes('viewer')) return 'viewer'
  return null
}

export function decideAcces(p: { intern: boolean; user: boolean; isOwner: boolean; nivelLogistica: NivelModul; action: string; ai?: boolean }): Decizie {
  if (p.intern) return { ok: true }
  if (!p.user) return { ok: false, status: 401, error: 'Neautorizat' }
  if (p.isOwner) return { ok: true }
  if (ACTIUNI_MASINA.has(p.action)) return { ok: false, status: 403, error: 'Doar cronul sau owner-ul pornesc procesarea cărților tehnice' }
  if (!p.nivelLogistica) return { ok: false, status: 403, error: 'Fără acces la modulul Logistică' }
  if (p.action === 'ask' && p.ai && p.nivelLogistica === 'viewer') {
    return { ok: false, status: 403, error: 'Răspunsul AI e disponibil doar pentru editor/admin Logistică — căutarea în pasaje merge' }
  }
  return { ok: true }
}
