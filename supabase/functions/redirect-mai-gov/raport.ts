// redirect-mai-gov — ce iese în răspunsul HTTP (#17 faza 2, 05.10.2026, claude_context #1602; r2 după Jakarinos P2).
// Răspunsul cronului rămâne în net._http_response (pg_net), deci NU are voie să conțină codul de login hub.mai.gov.ro,
// subiectul, adresele destinatarilor sau orice text venit de la Gmail / Resend / BD. Doar stări din lista fixă și
// numărători. Textul erorii (pentru diagnostic) rămâne doar în mai_gov_redirect_log.eroare, citit doar de owner.
export const STARI = ['dry', 'trimis', 'deja_trimis', 'eroare', 'eroare_db', 'eroare_resend', 'eroare_listare'] as const
export type Stare = typeof STARI[number]
export type Rand = { msg_id?: string; pass?: number; status: Stare; tip?: string }

const TIPURI = new Set(['cod', 'autentificare', 'rezervare', 'altul'])

export function randPublic(r: Rand): Rand {
  const out: Rand = { status: (STARI as readonly string[]).includes(r.status) ? r.status : 'eroare' }
  if (r.msg_id && /^[0-9a-f]{1,32}$/i.test(r.msg_id)) out.msg_id = r.msg_id
  if (Number.isInteger(r.pass)) out.pass = r.pass
  if (r.tip && TIPURI.has(r.tip)) out.tip = r.tip
  return out
}

export function raspunsPublic(p: { dry: boolean; polls: number; nrDestinatari: number; raport: Rand[] }) {
  return { ok: true, dry: p.dry, polls: p.polls, nr_destinatari: p.nrDestinatari, procesate: p.raport.length, raport: p.raport.map(randPublic) }
}
