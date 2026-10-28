// Un mail „RC necitit” pentru o licitație: trimitere Resend cu cheia de idempotență a zilei + rezolvarea revendicării (review #901 r1).
// Rezultate (fiecare cu tratarea ei a revendicării '<zi>|p|<lease>'):
//   'trimis'              — 2xx (inclusiv replay 2xx al aceleiași chei) + confirmare reușită → '<zi>|s'.
//                           Regula de tranziție (Copilot P1-01): dacă cheia zilei a fost acceptată deja de Resend (cu destinatarii de atunci),
//                           acea expediere RĂMÂNE expedierea zilei — nu se generează cheie nouă (ar ieși două mailuri în aceeași zi).
//   'trimis_neconfirmat'  — 2xx, dar confirmarea SQL a eșuat / a întors false (P1-02). NU se eliberează (după un succes real, eliberarea ar
//                           putea dubla mailul). Recuperarea: revendicarea rămâne „în curs”; după 10 minute rularea următoare o re-revendică
//                           (dacă documentele sunt încă necitite) și retrimite cu ACEEAȘI cheie → Resend face replay (2xx, fără mail nou) → confirmare.
//   'conflict'            — 409: cheia e deja folosită cu ALT conținut (ex. destinatarii vechi dinaintea deploy-ului / responsabil schimbat în
//                           aceeași zi) sau o cerere concurentă cu aceeași cheie. NU e succes: nu se confirmă, nu se eliberează (o eliberare
//                           ar produce 409 la nesfârșit sau, cu cheie nouă, dublură); revendicarea expiră natural la schimbarea zilei.
//   'necunoscut'          — transport căzut / 5xx: rezultat ambiguu, revendicarea rămâne „în curs” (reîncercare cu aceeași cheie).
//   'refuzat'             — alt 4xx (adresă / cerere invalidă): mailul sigur nu a plecat → revendicarea se ELIBEREAZĂ.
export type Rezultat = { licitatie_id: number; rezultat: 'trimis' | 'trimis_neconfirmat' | 'conflict' | 'necunoscut' | 'refuzat'
  eroare?: string; eliberat?: boolean; confirmat?: boolean }

export type Deps = {
  trimite: (cheie: string, payload: Record<string, unknown>) => Promise<{ status: number; text: string }>
  confirma: () => Promise<{ data: unknown; error: unknown }>
  elibereaza: () => Promise<{ data: unknown; error: unknown }>
}

export async function trimiteLicitatie(licitatie_id: number, cheie: string, payload: Record<string, unknown>, deps: Deps): Promise<Rezultat> {
  let r: { status: number; text: string }
  try { r = await deps.trimite(cheie, payload) } catch (e) {
    return { licitatie_id, rezultat: 'necunoscut', eroare: 'transport: ' + String((e as Error)?.message || e).slice(0, 200) }
  }
  if (r.status >= 500 || r.status === 408 || r.status === 429) return { licitatie_id, rezultat: 'necunoscut', eroare: 'Resend ' + r.status }
  if (r.status === 409) {
    let nume = ''
    try { nume = String(JSON.parse(r.text)?.name ?? '') } catch { /* corp ne-JSON */ }
    return { licitatie_id, rezultat: 'conflict', eroare: 'Resend 409' + (nume ? ' ' + nume : '') + ': ' + r.text.slice(0, 200) }
  }
  if (r.status < 200 || r.status >= 300) {
    const { data, error } = await deps.elibereaza()
    return { licitatie_id, rezultat: 'refuzat', eroare: 'Resend ' + r.status + ': ' + r.text.slice(0, 200), eliberat: !error && data === true }
  }
  const { data, error } = await deps.confirma()
  if (error || data !== true) return { licitatie_id, rezultat: 'trimis_neconfirmat', confirmat: false,
    eroare: 'confirmare: ' + (error ? String((error as any)?.message ?? error).slice(0, 200) : 'false (revendicarea nu mai e cea de la trimitere)') }
  return { licitatie_id, rezultat: 'trimis', confirmat: true }
}
