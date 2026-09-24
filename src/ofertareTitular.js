// Z2 / TKT-2026-0275 (Silviu): „cerința 16 se referă la SOCIETATE, iar «Cine poate acoperi» arată
// persoanele". Cine trebuie să dețină dovada — firma (operatorul economic) sau o persoană
// nominalizată — se citește din textul cerinței, determinist. Nu decide acoperirea; doar ordonează
// sursele din panou și avertizează. „Am găsit autorizația firmei" ≠ „cerință acoperită" (Copilot):
// titularul, domeniul și valabilitatea rămân de verificat de om.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Un rol de personal în text → dovada e a unei persoane (șeful de șantier cu EGD, RTE, sudorul…).
// EGD/PGD/EGIU/PGIU sunt autorizări ANRE pe PERSOANĂ (instalatori), spre deosebire de EDSB/PDSB (pe firmă).
const RX_PERSOANA = /\b(sef(ul)? de santier|manager(ul)? de (proiect|contract)|responsabil\w* tehnic|\brte\b|expert\w*|\be[1-9]\b|instalator\w*|sudor\w*|diriginte|inginer\w*|personal(ul)? (cheie|propus|nominalizat|de specialitate)|persoan[ae] (nominalizat|desemnat)|echip\w* (de )?(autorizat|instalator|sudor)|\b(egd|pgd|egiu|pgiu)\b)/
// Autorizări care se emit pe SOCIETATE (ANRE: EDSB/PDSB/EDIB/PDIB/ET/PT…), certificate de firmă.
const RX_AUT_FIRMA = /\b(edsb|pdsb|edib|pdib|edsb\w*|et[ -]?\d|pt[ -]?\d)\b|autorizati\w* (anre )?(de )?tip (edsb|pdsb|edib|pdib)|certificat\w* (iso|de atestare a firmei)|\biso ?(9001|14001|45001)\b/
const RX_OPERATOR = /\b(ofertantul|operatorul economic|operatorului economic|societatea|firma|ofertant(ul)? trebuie|detinerea)\b/

// Formulare negativă („nu se solicită", „nu este necesară") → nu inventăm o obligație (Copilot, 24.09).
const RX_NEGATIV = /\bnu (se )?(solicita|cere|impune)|\bnu (este|e) (necesar|obligatori|solicitat)|nu se aplica/

// Cui i se adresează obligația (ținta cerinței, nu candidatul concret):
// 'operator_economic' | 'persoana_fizica' | null (nedeterminat). Simplul cuvânt „ANRE” nu decide nimic.
export function titularVizat(text) {
  const t = norm(text)
  if (!t.trim() || RX_NEGATIV.test(t)) return null
  if (RX_PERSOANA.test(t)) return 'persoana_fizica'
  if (RX_AUT_FIRMA.test(t) || (RX_OPERATOR.test(t) && /autoriza|certificat|atestat/.test(t))) return 'operator_economic'
  return null
}

// Ordinea surselor în „Cine poate acoperi" când ținta e operatorul economic: documentele firmei întâi,
// apoi partenerii (un asociat/subcontractant e tot operator economic), abia apoi persoanele.
// Dacă Gazpet nu are dovada, NU se caută automat o autorizație personală ca substitut.
export const ORDINE_SURSE_FIRMA = ['firma', 'partener', 'experienta', 'autorizatie', 'recomandare', 'studii', 'vechime']
export function ordoneazaPeTitular(candidati, titular) {
  if (titular !== 'operator_economic') return candidati
  const rang = (s) => { const i = ORDINE_SURSE_FIRMA.indexOf(s); return i < 0 ? 99 : i }
  return [...(candidati || [])].sort((a, b) => rang(a.sursa) - rang(b.sursa))
}

// Sursele din „Cine poate acoperi" care sunt ale unei PERSOANE (atestat, recomandare, diplomă, vechime).
export const SURSE_PERSOANA = new Set(['autorizatie', 'recomandare', 'studii', 'vechime'])

// Ținta efectivă: decizia omului (salvată pe cerință) bate deducerea automată din text.
// `decizie` = rândul din ofertare_cerinte_titular sau null. 'nedeterminat' salvat de om rămâne null.
export function titularEfectiv(text, decizie) {
  if (decizie?.tip_titular) return decizie.tip_titular === 'nedeterminat' ? null : decizie.tip_titular
  return titularVizat(text)
}

// Regula de rutare (Copilot, 24.09): când obligația e a operatorului economic, o autorizație personală
// NU e substitut — „Alege" e blocat pe candidații-persoană. Omul schimbă ținta dacă deducerea e greșită.
// → { ok: true } sau { ok: false, motiv }
export function permiteAlegerea(cand, titular) {
  if (titular === 'operator_economic' && SURSE_PERSOANA.has(cand?.sursa)) {
    return { ok: false, motiv: 'Obligația e a operatorului economic: atestatul unei persoane nu ține loc de autorizarea firmei. Dacă ținta e greșită, schimb-o mai sus.' }
  }
  return { ok: true }
}
