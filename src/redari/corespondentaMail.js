// Redări — „📧 Pregătește mailul” (decizia Răzvan 04.11.2026, migrarea 20261130f, edge function redari-coresp-mail). Logică pură, fără React.
// Regulile tari sunt în BD (RPC fn_red_coresp_mail_incepe: admin/editor, rând aprobat cu fișier, eTag neschimbat, @gazpet.ro, 60 s, 20/zi/proiect)
// și în edge (descărcare cu JWT-ul utilizatorului, eTag din antet = cel aprobat). Aici doar oglindim regulile, ca UI-ul să nu ofere un buton refuzat.
export { OFFICE, RX_EMAIL, RX_GAZPET, eEmailValid, eEmailGazpet, normEmail, construiesteMailIntern, subiectIntern, CAZURI_EMAIL, MESAJ_INCERT, AVERTISMENT_URMA } from '../../supabase/functions/_shared/redariCorespMail.mjs'
import { eEmailValid, eEmailGazpet, MESAJ_INCERT, AVERTISMENT_URMA } from '../../supabase/functions/_shared/redariCorespMail.mjs'

export const COL_MAIL_CORESP = 'id, corespondenta_id, proiect_id, fisier_id, versiune_confirmata, catre, cc, subiect, stare, resend_id, eroare, pregatit_de_nume, created_by, created_at, finalizat_la'
export const PLAFON_ZI_PROIECT = 20
export const FEREASTRA_SEC = 60

// De ce nu se poate pregăti mailul pe rândul ăsta (null = se poate). `fisierAprobat` = rândul din red_corespondenta_fisiere cu id = aprobat_fisier_id.
// `istoricCitit` = false când citirea urmei mailurilor a eșuat (Copilot r2 P2-04): fără istoric nu știm dacă tocmai s-a pregătit un mail → butonul rămâne oprit.
export const MESAJ_FARA_ISTORIC = 'Nu am putut citi istoricul mailurilor — reîncarcă.'
export function motivFaraMail(rand, { poateScrie, fisierAprobat, istoricCitit = true } = {}) {
  if (!poateScrie) return 'Doar admin / editor pe Redări pregătesc mailul.'
  if (!istoricCitit) return MESAJ_FARA_ISTORIC
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

// Răspunsul edge-ului (sau eroarea invoke) → mesaj pentru echipă. `rez` = { data, error } din supabase.functions.invoke.
// DECIZIE 04.11.2026, aprobat de Răzvan (varianta A), risc acceptat: mail intern dublu. Rezultat INCERT (rețea / timeout / 5xx / eroare RPC netransparentă /
// închidere neconfirmată / răspuns fără corp) → mesajul standard MESAJ_INCERT; refuzurile de business clare (42501 / 23514 / P0002 / 400) → afișate ca atare.
export async function mesajRezultatMail(rez) {
  const { data, error } = rez || {}
  let corp = data
  // FunctionsHttpError: corpul răspunsului e în error.context (Response)
  if (error?.context && typeof error.context.json === 'function') { try { corp = await error.context.json() } catch { corp = null } }
  if (!error && corp?.ok) return { ok: true, incert: false, text: `Mailul a fost pregătit și trimis intern la ${corp.catre} (CC ${corp.cc?.join(', ') || '-'}). Verifică inboxul și trimite-l tu.` }
  if (!corp || corp.incert || !corp.error) return { ok: false, incert: true, text: MESAJ_INCERT }
  // r4 (J-P3-01 / C-P3-02): refuz sigur („nimic trimis”), dar închiderea urmei neconfirmată → avertisment SEPARAT
  return { ok: false, incert: false, text: String(corp.error), ...(corp.urma_inchisa === false ? { avertisment: AVERTISMENT_URMA } : {}) }
}
