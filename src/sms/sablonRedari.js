// Redări › 📱 SMS proprietari — șablonul fix (decizia lui Razvan, 03.11.2026): reamintirea sesiunii + răspunsul online în același mesaj.
// Operatorul alege UAT-ul; textul se completează singur din Setări UAT (nume, zilele de sesiune, programul) și Setări proiect (telefonul).
// Oglinda SQL: public.fn_sms_redari_sablon_model() + fn_sms_redari_sablon_calc(...) din 20261130c_sms_redari_sablon; BD-ul recalculează
// textul la creare și refuză lotul dacă diferă de cel afișat. Cazurile de paritate sunt aceleași în sablonRedari.test.js și în DRY (TEST2).
// Modul pur: fără React, fără Supabase.
import { verificaText } from '../../supabase/functions/_shared/smsText.mjs'

// Textul PROVIZORIU, singura sursă din UI; se înlocuiește după formularea Juridicului (și, în aceeași livrare, fn_sms_redari_sablon_model).
export const SABLON_REDARI = 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'

const RX_DATA = /^\d{4}-\d{2}-\d{2}$/
// ora de început la începutul programului: HH:MM sau H:MM (și cu punct), urmată de altceva decât o cifră; „24:00” sau „9” nu trec
const RX_ORA = /^(2[0-3]|[01]?[0-9])[:.]([0-5][0-9])([^0-9]|$)/
// telefonul de contact: doar cifre, spații, + ( ) . / -, între 6 și 15 cifre
const RX_TEL = /^[-0-9+ ()./]{6,40}$/

const faraSpatiiCapete = s => String(s ?? '').replace(/^[ \t]+|[ \t]+$/g, '')

/** Ziua de azi la București, 'AAAA-LL-ZZ' (nu UTC, nu offset fix). */
export function aziBucuresti(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Ora de început din „09:00 – 16:00” → '09:00'; fără oră validă la început → null. */
export function oraStart(program) {
  const m = RX_ORA.exec(String(program ?? '').replace(/^[ \t]+/, ''))
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** Telefonul de contact curățat la capete, sau null dacă lipsește / nu arată a număr de telefon. */
export function telefonContact(t) {
  const s = faraSpatiiCapete(t)
  if (!RX_TEL.test(s)) return null
  const cifre = s.replace(/[^0-9]/g, '').length
  return cifre >= 6 && cifre <= 15 ? s : null
}

/** Prima zi de sesiune de azi încolo (ziua de azi contează), în ordinea datelor: { nr: 1..3, zi: 'AAAA-LL-ZZ' } sau null. */
export function ziSesiune(uat, azi) {
  const zile = [1, 2, 3].map(nr => ({ nr, zi: faraSpatiiCapete(uat?.[`sesiune_zi${nr}`]) }))
    .filter(z => RX_DATA.test(z.zi) && z.zi >= azi)
    .sort((a, b) => (a.zi < b.zi ? -1 : a.zi > b.zi ? 1 : a.nr - b.nr))
  return zile[0] || null
}

const zzll = zi => `${zi.slice(8, 10)}.${zi.slice(5, 7)}`

export const MESAJ_LIPSA = {
  uat_nume: 'numele UAT-ului (Redări → UAT → Setări UAT)',
  zi_sesiune: 'o zi de sesiune de azi încolo (Ziua 1 / 2 / 3 în Setări UAT)',
  program_zi: 'ora de început (HH:MM) în programul zilei de sesiune (Setări UAT)',
  telefon_contact: 'telefonul de contact Gazpet al proiectului (Setări proiect → Contact pe convocări)',
}

/**
 * completeazaSablon({ uat, proiect, azi }) → { ok, text, lungime, ramase, lipsuri: [{ cod, mesaj }], motiv, zi, ziNr, ora }
 *  - {COMUNA} = uat.nume; {ZI} = prima zi de sesiune >= azi (ZZ.LL); {ORA} = începutul programului acelei zile; {TEL} = proiect.contact_telefon
 *  - lipsește ceva → ok = false, text = null, lipsuri spune exact ce
 *  - textul trece prin verificaText (GSM-7, fără diacritice, max 160): peste 160 → ok = false, motiv 'prea_lung', lungimea reală
 */
export function completeazaSablon({ uat, proiect, azi }) {
  const lipsuri = []
  const comuna = faraSpatiiCapete(uat?.nume)
  if (!comuna) lipsuri.push('uat_nume')
  const z = RX_DATA.test(String(azi ?? '')) ? ziSesiune(uat, azi) : null
  if (!z) lipsuri.push('zi_sesiune')
  const program = z ? uat?.[`program_zi${z.nr}`] : null
  const ora = z ? oraStart(program) : null
  if (z && !ora) lipsuri.push('program_zi')
  const tel = telefonContact(proiect?.contact_telefon)
  if (!tel) lipsuri.push('telefon_contact')
  const baza = { zi: z?.zi ?? null, ziNr: z?.nr ?? null, ora, lipsuri: lipsuri.map(cod => ({ cod, mesaj: cod === 'program_zi' && z ? `${MESAJ_LIPSA.program_zi}: ziua ${z.nr} (${zzll(z.zi)})` : MESAJ_LIPSA[cod] })) }
  if (lipsuri.length) return { ...baza, ok: false, text: null, lungime: 0, ramase: null, motiv: 'lipsuri' }
  // replaceAll cu funcție: fără tiparele „$&” din înlocuire; toate aparițiile, în aceeași ordine ca replace() din SQL
  const brut = SABLON_REDARI.replaceAll('{COMUNA}', () => comuna).replaceAll('{ZI}', () => zzll(z.zi))
    .replaceAll('{ORA}', () => ora).replaceAll('{TEL}', () => tel)
  const v = verificaText(brut)
  return { ...baza, ok: v.ok, text: v.text, lungime: v.lungime, ramase: v.ramase, nepermise: v.nepermise, motiv: v.motiv }
}
