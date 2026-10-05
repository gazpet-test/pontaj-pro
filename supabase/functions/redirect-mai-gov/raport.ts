// redirect-mai-gov — ce iese în răspunsul HTTP (#17 faza 2, 05.10.2026, claude_context #1602).
// Răspunsul cronului rămâne în net._http_response (pg_net), deci NU are voie să conțină codul de login hub.mai.gov.ro,
// subiectul compus (care poartă codul), adresele destinatarilor sau textul mesajului. Doar stări și numărători.
export type Rand = { msg_id?: string; pass?: number; status: string; tip?: string; detaliu?: string }

const DETALIU_MAX = 200
// Detaliile de eroare vin de la Gmail / Resend / BD; tai adresele de mail, orice secvență de 4–10 cifre (formatul
// codurilor) și lungimea.
export const curataDetaliu = (s: unknown) => String(s ?? '')
  .replace(/[^\s@<>"',;]+@[^\s@<>"',;]+/g, '<email>').replace(/\d{4,10}/g, '####').slice(0, DETALIU_MAX)

export function randPublic(r: Rand): Rand {
  const out: Rand = { status: r.status }
  if (r.msg_id) out.msg_id = r.msg_id
  if (r.pass !== undefined) out.pass = r.pass
  if (r.tip) out.tip = r.tip
  if (r.detaliu) out.detaliu = curataDetaliu(r.detaliu)
  return out
}

export function raspunsPublic(p: { dry: boolean; polls: number; nrDestinatari: number; raport: Rand[] }) {
  return { ok: true, dry: p.dry, polls: p.polls, nr_destinatari: p.nrDestinatari, procesate: p.raport.length, raport: p.raport.map(randPublic) }
}
