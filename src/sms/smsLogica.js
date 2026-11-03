// Logica pură a ecranului 📱 SMS (fără React, fără Supabase) — testată în smsLogica.test.js.
// Regulile de text / telefon / cost vin din modulul comun cu edge-ul (supabase/functions/_shared/smsText.mjs), oglindit în BD
// (fn_sms_text_final, fn_sms_tel_normalizat). Sursa de adevăr rămâne BD-ul: previzualizarea finală o face RPC-ul, nu UI-ul.
export { verificaText, costEstimat, mascheazaTelefon, normalizeazaTelefon, MAX_GSM, TARIF_EUR } from '../../supabase/functions/_shared/smsText.mjs'
import { verificaText } from '../../supabase/functions/_shared/smsText.mjs'

export const STARI_LOT = {
  draft: ['Draft — așteaptă aprobarea', '#946B20'],
  aprobat: ['Aprobat — gata de trimis', '#24778B'],
  in_trimitere: ['În trimitere', '#24778B'],
  trimis: ['Trimis', '#38765A'],
  anulat: ['Anulat', '#617282'],
}
export const STARI_MESAJ = {
  in_coada: 'în coadă', necunoscut: 'necunoscut (fără confirmare)', trimis: 'trimis', livrat: 'livrat', esuat: 'eșuat', anulat: 'anulat',
}
// Motivul cu care se oprește o trimitere (fn_sms_rezerva / sms-trimite) → text pentru Razvan
export const MOTIVE_TRIMITERE = {
  gata: 'Toate mesajele lotului au fost predate furnizorului.',
  ok: 'Runda s-a încheiat; mai sunt mesaje — apasă din nou „Trimite”.',
  kill_switch: 'Trimiterea e OPRITĂ (kill-switch). Pornește-o din Setări.',
  plafon_zi: 'S-a atins plafonul zilnic. Restul pleacă după ce îl mărești sau mâine.',
  plafon_luna: 'S-a atins plafonul lunar.',
  redari_neautorizat: 'Redări: autorizarea scrisă Transgaz nu e setată — nu pleacă nimic.',
  in_afara_orelor: 'Redări: SMS-urile externe pleacă doar între 08:00 și 20:00.',
  oprit_automat: 'Furnizorul a refuzat conexiunea sau creditul: trimiterea s-a oprit automat. Verifică contul SMSLink și secretele.',
  timp: 'Runda a atins limita de timp; apasă din nou „Trimite” pentru rest.',
  max_runde: 'Runda maximă (300 de mesaje) s-a încheiat; apasă din nou „Trimite” pentru rest.',
  fara_lot: 'Niciun lot aprobat de trimis.',
  lot_trimis: 'Lotul e deja trimis.',
  lot_anulat: 'Lotul e anulat.',
  lot_draft: 'Lotul nu e aprobat.',
  eroare_rezervare: 'Rezervarea în BD a fost refuzată — reîncarcă și verifică starea lotului.',
}
export const motivTrimitere = m => MOTIVE_TRIMITERE[m] || `Oprit: ${m || 'motiv necunoscut'}.`

/** Contorul de sub câmpul de text: „43/160 caractere GSM-7 · 1 SMS” + avertismente. */
export function contorText(text) {
  const v = verificaText(text)
  const avertismente = []
  if (v.motiv === 'caractere_nepermise') avertismente.push(`Caractere care nu există în GSM-7: ${v.nepermise.join(' ')} — scoate-le.`)
  if (v.motiv === 'prea_lung') avertismente.push(`Peste 160 de caractere (${v.lungime}). În MVP un lot are un singur SMS (fără concatenare).`)
  if (v.text && v.text !== String(text ?? '').trim()) avertismente.push('Textul se normalizează automat (diacritice, ghilimele, rânduri noi, spații) — vezi „Textul trimis”.')
  return { ...v, eticheta: `${v.lungime}/160 caractere GSM-7 · ${v.segmente || 0} SMS`, avertismente }
}

/** Destinatarii aleși în UI → argumentele RPC-ului fn_sms_lot_intern_creeaza. */
export function argumenteIntern(mod, { departamente = [], selectati = [] } = {}) {
  if (mod === 'departament') return { p_departamente: departamente.length ? departamente : ['__niciunul__'], p_angajati: null }
  if (mod === 'selectie') return { p_departamente: null, p_angajati: selectati.length ? selectati.map(Number) : [-1] }
  return { p_departamente: null, p_angajati: null }
}

export function departamente(lista) {
  return [...new Set((lista || []).map(a => a.departament).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ro'))
}

export function filtreazaAngajati(lista, { departament = '', cauta = '' } = {}) {
  const q = cauta.trim().toLowerCase()
  return (lista || []).filter(a => (!departament || a.departament === departament) && (!q || String(a.nume || '').toLowerCase().includes(q)))
}

/** Câte zile ține un lot la plafonul zilnic (informativ în previzualizare). */
export function zileLaPlafon(nr, plafonZi) {
  const n = Number(nr) || 0, p = Number(plafonZi) || 0
  if (!n) return 0
  return p > 0 ? Math.ceil(n / p) : Infinity
}

export const poateAproba = lot => lot?.stare === 'draft'
export const poateTrimite = (lot, panou) => (lot?.stare === 'aprobat' || lot?.stare === 'in_trimitere') && panou?.kill_switch === false
export const poateAnula = lot => ['draft', 'aprobat', 'in_trimitere'].includes(lot?.stare)

/** Redări: de ce e blocat butonul (null = se poate crea un lot). */
export function motivBlocareRedari(panou) {
  if (!panou) return 'Se verifică setările SMS…'
  if (panou.redari_autorizat !== true) return 'Așteaptă autorizarea scrisă Transgaz'
  return null
}

/** Formularul de autorizare Redări: nr. + dată (nu în viitor) + bifa de confirmare. Întoarce lista de probleme. */
export function valideazaAutorizare({ nr, data, confirmat }, azi) {
  const p = []
  if (!String(nr ?? '').trim()) p.push('Numărul autorizării scrise Transgaz e obligatoriu.')
  else if (String(nr).trim().length > 100) p.push('Numărul autorizării are maximum 100 de caractere.')
  if (!data) p.push('Data autorizării e obligatorie.')
  else if (azi && data > azi) p.push('Data autorizării nu poate fi în viitor.')
  if (!confirmat) p.push('Bifează că ai autorizarea scrisă (sub-împuternicit, art. 28 GDPR).')
  return p
}

/** Plafoanele din Setări: întregi, 0–5000 / zi, 0–50000 / lună, zi ≤ lună (ca în BD). */
export function valideazaPlafoane(zi, luna) {
  const z = Number(zi), l = Number(luna)
  if (!Number.isInteger(z) || !Number.isInteger(l)) return 'Plafoanele sunt numere întregi.'
  if (z < 0 || z > 5000) return 'Plafonul zilnic e între 0 și 5000.'
  if (l < 0 || l > 50000) return 'Plafonul lunar e între 0 și 50000.'
  if (z > l) return 'Plafonul zilnic nu poate depăși plafonul lunar.'
  return null
}

export const fmtEur = n => `${(Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} EUR`
export const fmtData = v => (v ? new Date(v).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }) : '—')
