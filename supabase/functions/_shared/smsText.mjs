// smsText.mjs — regulile textului și ale numărului pentru SMS (MVP 03.11.2026), comune UI (src/sms/) + edge (smsFurnizor.ts).
// Oglinda SQL: public.fn_sms_text_final / fn_sms_text_verifica / fn_sms_tel_normalizat (migrarea 20261130a_sms_mvp) — ACEEAȘI tabelă
// de transliterare și aceleași seturi GSM-7; cazurile de test sunt identice în src/sms/smsText.test.js și în DRY-ul SQL (TEST3).
// Fără dependențe, fără rețea, fără Deno/DOM: se importă din Node (vitest), din browser (Vite) și din Deno.

export const MAX_GSM = 160            // MVP: un singur SMS (concatenarea oprită; SMSLink întoarce eroarea 12 peste 160)
export const PAS_CONCATENAT = 152     // SMSLink taxează un SMS concatenat la fiecare 152 de caractere
export const TARIF_EUR = 0.049        // decizia lui Razvan (03.11.2026): 0,049 EUR / SMS, tranșa 1–1.000 / lună

// ș ş Ș Ş ț ţ Ț Ţ ă Ă â Â î Î | „ ” “ « » " | ’ ‘ ‚ ` ´ | – — | CR LF TAB NBSP  (31 → 31, poziție cu poziție)
const DIN = 'șşȘŞțţȚŢăĂâÂîÎ„”“«»"’‘‚`´–—\r\n\t '
const IN = "ssSSttTTaAaAiI'''''''''''--    "
const HARTA = new Map(Array.from(DIN).map((c, i) => [c, IN[i]]))

// GSM 03.38: setul de bază (fără LF / CR / ESC și fără ghilimele duble — le înlocuim; SMSLink le numără dublu) + extensia (2 caractere)
export const GSM_BAZA = "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
export const GSM_EXT = '^{}[~]|\\€'
const BAZA = new Set(Array.from(GSM_BAZA))
const EXT = new Set(Array.from(GSM_EXT))

/** Textul exact care pleacă: fără diacritice, ghilimele → apostrof, liniuțe → -, rând nou / tab → spațiu, spații comprimate. */
export function textFinal(t) {
  const tr = Array.from(String(t ?? ''), c => HARTA.get(c) ?? c).join('')
  return tr.replaceAll('…', '...').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '')
}

/** Lungimea în unități GSM-7 (caracterele din extensie = 2). Numără pe puncte de cod, ca length() din PostgreSQL. */
export function lungimeGsm(t) {
  let n = 0
  for (const c of Array.from(String(t ?? ''))) n += EXT.has(c) ? 2 : 1
  return n
}

export function segmente(lungime) {
  if (!lungime) return 0
  return lungime <= MAX_GSM ? 1 : Math.ceil(lungime / PAS_CONCATENAT)
}

/** Caracterele care nu există în GSM-7 (unice, în ordinea apariției). */
export function nepermise(t) {
  return [...new Set(Array.from(String(t ?? '')).filter(c => !BAZA.has(c) && !EXT.has(c)))]
}

/** Previzualizarea completă a unui text: ce pleacă, câte caractere, câte SMS-uri, ce e greșit. */
export function verificaText(t) {
  const text = textFinal(t)
  const lungime = lungimeGsm(text)
  const gresite = nepermise(text)
  let motiv = null
  if (!text) motiv = 'gol'
  else if (gresite.length) motiv = 'caractere_nepermise'
  else if (lungime > MAX_GSM) motiv = 'prea_lung'
  return { text, lungime, segmente: segmente(lungime), nepermise: gresite, ok: motiv === null, motiv, ramase: MAX_GSM - lungime }
}

/** Cost estimat în EUR (fără TVA), rotunjit la 3 zecimale ca în BD. */
export function costEstimat(nrDestinatari, seg = 1) {
  const n = Number(nrDestinatari) || 0
  return Math.round(n * (Number(seg) || 0) * TARIF_EUR * 1000) / 1000
}

/** Mobil RO → E.164 (+407xxxxxxxx); acceptă 07…, 7…, 407…, +407…, 00407…, cu spații / - . / : ; ( ). Altceva → null. */
export function normalizeazaTelefon(s) {
  const t = String(s ?? '').replace(/[ \-./:;()\t ]/g, '')
  if (/^\+407[0-9]{8}$/.test(t)) return t
  if (/^00407[0-9]{8}$/.test(t)) return '+' + t.slice(2)
  if (/^407[0-9]{8}$/.test(t)) return '+' + t
  if (/^07[0-9]{8}$/.test(t)) return '+4' + t
  if (/^7[0-9]{8}$/.test(t)) return '+40' + t
  return null
}

/** +407xxxxxxxx → 07xxxxxxxx (formatul recomandat de SMSLink). Altceva → null. */
export function telefonNational(e164) {
  return /^\+407[0-9]{8}$/.test(String(e164 ?? '')) ? '0' + String(e164).slice(3) : null
}

/** Pentru ecran: 07** *** 123 (ca fn_sms_angajati_lista). */
export function mascheazaTelefon(s) {
  const t = normalizeazaTelefon(s)
  return t ? '07** *** ' + t.slice(-3) : null
}

// Codurile de eroare SMSLink (response_id la response_type = ERROR), docs/sms/RAPORT_SMSLINK_API_2026-11-03.md §2
const SMSLINK_PERMANENT = new Set([1, 9, 10, 11, 12, 13, 14, 15, 17])   // respins, fără reîncercare
const SMSLINK_CONFIG = new Set([2, 3, 4, 5, 6, 7])                       // cont / parolă / IP: oprește coada + alertă
/** permanent | config | credit | tranzitoriu (16 și orice cod nou = tranzitoriu: reîncercare limitată). */
export function clasificaSmslink(cod) {
  const n = Number(cod)
  if (SMSLINK_PERMANENT.has(n)) return 'permanent'
  if (SMSLINK_CONFIG.has(n)) return 'config'
  if (n === 8) return 'credit'
  return 'tranzitoriu'
}

/** Comparație în timp constant (nu se oprește la primul caracter diferit). Gol → false (fail closed). */
export function egalTimpConstant(a, b) {
  const x = new TextEncoder().encode(String(a ?? ''))
  const y = new TextEncoder().encode(String(b ?? ''))
  const n = Math.max(x.length, y.length)
  let dif = x.length ^ y.length
  for (let i = 0; i < n; i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return dif === 0 && y.length > 0
}

/** Cod de eroare de salvat în BD: doar [a-z0-9_]{1,40} (niciodată textul furnizorului — eroarea 7 SMSLink conține parola). */
export function codSigur(s) {
  const c = String(s ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
  return /^[a-z0-9_]{1,40}$/.test(c) ? c : 'eroare'
}
