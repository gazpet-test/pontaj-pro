// Redări — „📧 Pregătește mailul” (decizia Răzvan 04.11.2026, migrarea 20261130f, edge function redari-coresp-mail). Logică pură, fără React.
// Regulile tari sunt în BD (RPC fn_red_coresp_mail_incepe: admin/editor, rând aprobat cu fișier, eTag neschimbat, @gazpet.ro, 60 s, 20/zi/proiect)
// și în edge (descărcare cu JWT-ul utilizatorului, eTag din antet = cel aprobat). Aici doar oglindim regulile, ca UI-ul să nu ofere un buton refuzat.
export { OFFICE, RX_EMAIL, RX_GAZPET, eEmailValid, eEmailGazpet, normEmail, construiesteMailIntern, subiectIntern, CAZURI_EMAIL } from '../../supabase/functions/_shared/redariCorespMail.mjs'
import { eEmailValid, eEmailGazpet } from '../../supabase/functions/_shared/redariCorespMail.mjs'

export const COL_MAIL_CORESP = 'id, intentie_id, corespondenta_id, proiect_id, fisier_id, versiune_confirmata, catre, cc, subiect, stare, reluari, resend_id, eroare, pregatit_de_nume, created_by, created_at, finalizat_la'
export const PLAFON_ZI_PROIECT = 20
export const FEREASTRA_SEC = 60

// De ce nu se poate pregăti mailul pe rândul ăsta (null = se poate). `fisierAprobat` = rândul din red_corespondenta_fisiere cu id = aprobat_fisier_id.
export function motivFaraMail(rand, { poateScrie, fisierAprobat } = {}) {
  if (!poateScrie) return 'Doar admin / editor pe Redări pregătesc mailul.'
  if (!rand || rand.stare !== 'aprobat' || !rand.aprobat_la) return 'Mailul se pregătește doar după aprobarea lui Răzvan.'
  if (!rand.aprobat_fisier_id) return 'Rândul nu are fișier „de trimis” aprobat.'
  if (!fisierAprobat) return 'Fișierul aprobat nu e în listă (reîncarcă).'
  if (!/\.pdf$/i.test(String(fisierAprobat.path || ''))) return 'Fișierul aprobat nu e PDF.'
  if (!eEmailGazpet(rand.expeditor_email)) return 'Completează „E-mail expeditor” (@gazpet.ro) în Editează (schimbarea cere o nouă aprobare).'
  if (!eEmailValid(rand.destinatar_email)) return 'Completează „E-mail instituție” în Editează (schimbarea cere o nouă aprobare).'
  if (!String(rand.mail_subiect || '').trim() || !String(rand.mail_text || '').trim()) return 'Completează subiectul și textul mailului în Editează (schimbarea cere o nouă aprobare).'
  return null
}

// Ultimul mail pregătit pentru rând. Lista vine din query ordonată created_at desc, id desc (nu sortăm în JS: vezi corespondentaFisiere.js).
export const ultimulMail = (mailuri, randId) => (mailuri || []).find(m => m.corespondenta_id === randId) || null

export const ETICHETE_STARE_MAIL = { in_curs: 'neconfirmat (în curs)', trimis: 'pregătit', eroare: 'eșuat', necunoscut: 'neconfirmat' }
export const etichetaStareMail = s => ETICHETE_STARE_MAIL[s] || String(s ?? '')

// r2 (J-P2-2 / C-P2-01): intenția durabilă. O intenție nouă = UUID nou + versiunea și fișierul aprobat VĂZUTE pe rând (J-P2-3, verificate în RPC).
export const intentieNoua = (rand, uuid = (globalThis.crypto?.randomUUID?.() ?? '')) => ({ intentie_id: uuid, versiune: rand?.versiune, fisier_id: rand?.aprobat_fisier_id })
// Starea butonului pe rând: `pending` = intenția din memorie a acestui ecran (rezultat ambiguu, poate fără rând în urmă), `ultim` = ultimul rând din urmă.
// neconfirmat → NU se pregătește automat alt mail: se oferă „Reia aceeași încercare” (aceeași intenție = aceeași cheie Resend) și, separat,
// „Pregătește încă un mail” (intenție nouă, cu confirmare „poate produce un duplicat”). Reluarea din urmă doar pentru autorul ei (RPC-ul o cere).
export function stareMailRand({ ultim, pending, profileId } = {}) {
  if (pending?.intentie_id) return { neconfirmat: true, reluare: { intentie_id: pending.intentie_id, versiune: pending.versiune, fisier_id: pending.fisier_id } }
  if (ultim && ['in_curs', 'necunoscut'].includes(ultim.stare)) {
    const alAutorului = !!profileId && ultim.created_by === profileId
    return { neconfirmat: true, reluare: alAutorului ? { intentie_id: ultim.intentie_id, versiune: ultim.versiune_confirmata, fisier_id: ultim.fisier_id } : null }
  }
  return { neconfirmat: false, reluare: null }
}

// Răspunsul edge-ului (sau eroarea invoke) → mesaj pentru echipă. `rez` = { data, error } din supabase.functions.invoke.
export async function mesajRezultatMail(rez) {
  const { data, error } = rez || {}
  let corp = data
  // FunctionsHttpError: corpul răspunsului e în error.context (Response)
  if (error?.context && typeof error.context.json === 'function') { try { corp = await error.context.json() } catch { corp = null } }
  if (!error && corp?.ok && corp.deja_trimis) return { ok: true, definitiv: true, text: 'Mailul acestei încercări fusese deja trimis; nu s-a retrimis nimic. Verifică inboxul expeditorului.' }
  if (!error && corp?.ok) return { ok: true, definitiv: true, text: `Mailul a fost pregătit și trimis intern la ${corp.catre} (CC ${corp.cc?.join(', ') || '-'}). Verifică inboxul și trimite-l tu.` }
  // r2 (J-P3-5 / C-P2-02): Resend a acceptat, dar urma nu s-a închis → NU retrimite
  if (corp?.resend_acceptat) return { ok: false, definitiv: true, resendAcceptat: true, text: 'Resend a confirmat mailul, dar înregistrarea nu s-a confirmat — NU retrimite; verifică inboxul expeditorului.' }
  const m = corp?.error || error?.message || 'Eroare necunoscută la pregătirea mailului.'
  // fără corp de la server (rețea) sau `necunoscut` = ambiguu: intenția rămâne pentru „Reia aceeași încercare”
  const necunoscut = !corp || !!corp.necunoscut
  return { ok: false, necunoscut, definitiv: !necunoscut, text: necunoscut ? `Rezultat neconfirmat — verifică inboxul expeditorului. (${m})` : m }
}
