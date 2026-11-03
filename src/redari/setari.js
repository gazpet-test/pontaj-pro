/* setari.js — Redări faza 2, felia 1: câmpurile ecranelor UAT + Setări proiect, normalizare și validări (oglinda constrângerilor din
   20261126a / 20261127a). Fără React, fără Supabase — testabil cu vitest. Deciziile Răzvan 02.11.2026: link_afisare scos din adresa UAT,
   adresele UAT pe seria AU-0001, refuzul la PV B = motiv pe PV (felia PV). */

import { LINK_INFORMARE_REDARI } from './domeniuPublic.js'

export const MAX_TEXT_SCURT = 200
export const MAX_TELEFON = 40
export const MAX_TEXT_LUNG = 4000

// tip: 'text' | 'date' | 'ora' | 'tel' | 'email' | 'textarea'; span = coloane în grila de 2
export const CAMPURI_PROIECT = [
  { grup: 'Proiect de montaj (Execuție)', cheie: 'executie_proiect_id', eticheta: 'Proiect de montaj', tip: 'executie' },
  { grup: 'Texte (confirmate de Juridic)', cheie: 'link_informare_gdpr', eticheta: 'Informarea GDPR completă (HTTPS, opțional)', tip: 'url', span: 2, exemplu: LINK_INFORMARE_REDARI },
  { grup: 'Proiect', cheie: 'denumire', eticheta: 'Denumire', tip: 'text', span: 2 },
  { grup: 'Proiect', cheie: 'beneficiar', eticheta: 'Beneficiar', tip: 'text', span: 2 },
  { grup: 'Contract', cheie: 'contract_nr', eticheta: 'Nr. contract', tip: 'text' },
  { grup: 'Contract', cheie: 'contract_data', eticheta: 'Data contractului', tip: 'date' },
  { grup: 'Contract', cheie: 'imputernicire_nr', eticheta: 'Nr. împuternicire Transgaz', tip: 'text' },
  { grup: 'Contract', cheie: 'imputernicire_data', eticheta: 'Data împuternicirii', tip: 'date' },
  { grup: 'Reprezentanți', cheie: 'reprezentant_tgz_nume', eticheta: 'Reprezentant Transgaz', tip: 'text' },
  { grup: 'Reprezentanți', cheie: 'reprezentant_tgz_functie', eticheta: 'Funcția', tip: 'text' },
  { grup: 'Reprezentanți', cheie: 'reprezentant_tgz_telefon', eticheta: 'Telefon reprezentant Transgaz', tip: 'tel' },
  { grup: 'Reprezentanți', cheie: 'apm_nume', eticheta: 'Reprezentant A.P.M. (PV B / PV C)', tip: 'text' },
  { grup: 'Reprezentanți', cheie: 'reprezentant_gazpet_nume', eticheta: 'Reprezentant Gazpet (semnează)', tip: 'text' },
  { grup: 'Reprezentanți', cheie: 'reprezentant_gazpet_functie', eticheta: 'Funcția', tip: 'text' },
  { grup: 'Contact pe convocări', cheie: 'contact_nume', eticheta: 'Persoană de contact', tip: 'text' },
  { grup: 'Contact pe convocări', cheie: 'contact_telefon', eticheta: 'Telefon de contact', tip: 'tel' },
  { grup: 'Contact pe convocări', cheie: 'contact_email', eticheta: 'E-mail de contact', tip: 'email', span: 2 },
  { grup: 'Texte (confirmate de Juridic)', cheie: 'text_gdpr', eticheta: 'Informare GDPR (convocator + formular public)', tip: 'textarea', span: 2, obligatoriu: true, sensibil: true },
  { grup: 'Texte (confirmate de Juridic)', cheie: 'text_declaratie', eticheta: 'Declarația „nu particip — fără obiecții”', tip: 'textarea', span: 2, obligatoriu: true, sensibil: true },
]

export const CAMPURI_UAT = [
  { grup: 'UAT', cheie: 'nume', eticheta: 'Nume UAT', tip: 'text', obligatoriu: true },
  { grup: 'UAT', cheie: 'judet', eticheta: 'Județ', tip: 'text' },
  { grup: 'Primărie', cheie: 'primarie_adresa', eticheta: 'Adresa primăriei', tip: 'text', span: 2 },
  { grup: 'Primărie', cheie: 'primarie_email', eticheta: 'E-mail primărie', tip: 'email' },
  { grup: 'Primărie', cheie: 'primarie_telefon', eticheta: 'Telefon primărie', tip: 'tel' },
  { grup: 'Primărie', cheie: 'reprezentant_uat_nume', eticheta: 'Reprezentant nominalizat', tip: 'text' },
  { grup: 'Primărie', cheie: 'reprezentant_uat_functie', eticheta: 'Funcția', tip: 'text' },
  { grup: 'Primărie', cheie: 'reprezentant_uat_telefon', eticheta: 'Telefon reprezentant', tip: 'tel' },
  { grup: 'Primărie', cheie: 'termen_confirmare', eticheta: 'Termen de confirmare (înainte de ziua 1)', tip: 'date' },
  { grup: 'Sesiuni', cheie: 'sesiune_zi1', eticheta: 'Ziua 1', tip: 'date' },
  { grup: 'Sesiuni', cheie: 'program_zi1', eticheta: 'Program ziua 1', tip: 'text', exemplu: '09:00 – 16:00' },
  { grup: 'Sesiuni', cheie: 'sate_zi1', eticheta: 'Sate / tarlale ziua 1', tip: 'text', span: 2 },
  { grup: 'Sesiuni', cheie: 'sesiune_zi2', eticheta: 'Ziua 2', tip: 'date' },
  { grup: 'Sesiuni', cheie: 'program_zi2', eticheta: 'Program ziua 2', tip: 'text', exemplu: '09:00 – 19:00 (program prelungit)' },
  { grup: 'Sesiuni', cheie: 'sate_zi2', eticheta: 'Sate / tarlale ziua 2', tip: 'text', span: 2 },
  { grup: 'Sesiuni', cheie: 'sesiune_zi3', eticheta: 'Ziua 3', tip: 'date' },
  { grup: 'Sesiuni', cheie: 'program_zi3', eticheta: 'Program ziua 3', tip: 'text', exemplu: '09:00 – 16:00' },
  { grup: 'Sesiuni', cheie: 'sate_zi3', eticheta: 'Sate / tarlale ziua 3', tip: 'text', span: 2 },
  { grup: 'Afișare la primărie', cheie: 'afisare_data_start', eticheta: 'Afișare de la', tip: 'date' },
  { grup: 'Afișare la primărie', cheie: 'afisare_data_end', eticheta: 'Afișare până la', tip: 'date' },
  { grup: 'Afișare la primărie', cheie: 'afisare_ora', eticheta: 'Ora afișării (HH:MM)', tip: 'ora' },
  { grup: 'Afișare la primărie', cheie: 'afisare_reprezentant_gazpet', eticheta: 'Afișează din partea Gazpet', tip: 'text' },
  { grup: 'Afișare la primărie', cheie: 'afisare_pv_nr', eticheta: 'Nr. PV de afișare', tip: 'text' },
]

// Coloane citite din BD (select explicit, nu '*', ca un câmp nou din BD să nu ajungă nevăzut în formular)
export const COL_PROIECT = ['id', 'cod', 'activ', 'versiune', 'created_at', ...CAMPURI_PROIECT.map(c => c.cheie)].join(', ')
export const COL_UAT = ['id', 'proiect_id', 'uat3', 'adresa_nr', 'adresa_data', 'versiune', 'created_at', ...CAMPURI_UAT.map(c => c.cheie)].join(', ')

export const ZILE_SESIUNE = ['sesiune_zi1', 'sesiune_zi2', 'sesiune_zi3']
const RX_DATA = /^\d{4}-\d{2}-\d{2}$/
const RX_ORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const gol = (v) => v === null || v === undefined || String(v).trim() === ''
// 'AAAA-LL-ZZ' care există în calendar (JS normalizează 2026-02-30 la 2 martie; Postgres o respinge) — Jakarinos f2 r1 P3
export function dataValida(s) {
  if (!RX_DATA.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !isNaN(d) && d.toISOString().slice(0, 10) === s
}

/** Valoarea pentru BD: text tăiat la capete, '' → null; datele rămân 'AAAA-LL-ZZ'. */
export function normalizeazaValoare(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Obiectul de UPDATE: doar cheile din `campuri`, normalizate. */
export function normalizeaza(form, campuri) {
  const out = {}
  for (const c of campuri) {
    const v = normalizeazaValoare(form?.[c.cheie])
    out[c.cheie] = c.tip === 'executie' && v !== null && /^[1-9][0-9]*$/.test(v) ? Number(v) : v   // bigint → număr, nu text (Gemini f2b r1 P3)
  }
  return out
}

/** Cheile care diferă între rândul din BD și formularul normalizat (null ≡ ''). */
export function cheiSchimbate(vechi, nou, campuri) {
  return campuri.map(c => c.cheie).filter(k => normalizeazaValoare(vechi?.[k]) !== normalizeazaValoare(nou?.[k]))
}

function verificaFormat(c, v, erori) {
  if (gol(v)) { if (c.obligatoriu) erori.push(`${c.eticheta}: obligatoriu`); return }
  const s = String(v).trim()
  if (c.tip === 'date' && !dataValida(s)) erori.push(`${c.eticheta}: dată invalidă`)
  else if (c.tip === 'ora' && !RX_ORA.test(s)) erori.push(`${c.eticheta}: format HH:MM (00:00–23:59)`)
  else if (c.tip === 'email' && !RX_EMAIL.test(s)) erori.push(`${c.eticheta}: adresă de e-mail invalidă`)
  else if (c.tip === 'url' && (!s.startsWith('https://') || s.length > 300)) erori.push(`${c.eticheta}: începe cu https://, maximum 300 caractere`)
  else if (c.tip === 'executie' && (!/^[1-9][0-9]*$/.test(s) || !Number.isSafeInteger(Number(s)))) erori.push(`${c.eticheta}: identificator invalid`)   // executie_proiecte.id e bigint
  else if (c.tip === 'tel' && s.length > MAX_TELEFON) erori.push(`${c.eticheta}: maximum ${MAX_TELEFON} caractere`)
  else if (c.tip === 'textarea' && s.length > MAX_TEXT_LUNG) erori.push(`${c.eticheta}: maximum ${MAX_TEXT_LUNG} caractere`)
  else if ((c.tip === 'text') && s.length > MAX_TEXT_SCURT) erori.push(`${c.eticheta}: maximum ${MAX_TEXT_SCURT} caractere`)
}

/** Câmpurile pe care le-am schimbat ȘI pe care altcineva le-a schimbat între timp (baza = ce am citit, proaspat = rândul de acum). */
export function conflicteConcurente(baza, proaspat, schimbate) {
  return (schimbate || []).filter(k => normalizeazaValoare(baza?.[k]) !== normalizeazaValoare(proaspat?.[k]))
}

/** Datele contractului preluate din Execuție (Copilot f2b r1 P2-2): numărul fără sufixul „/zz.ll.aaaa”; data = data_contract din Execuție, altfel cea din sufix;
 *  `avertisment` când ambele există și diferă. Valorile null nu suprascriu ce are deja formularul (decide apelantul). */
export function contractDinExecutie(rand) {
  const nr = String(rand?.nr_contract ?? '').trim()
  const m = /^([^/]+)\/(\d{2})\.(\d{2})\.(\d{4})$/.exec(nr)
  const dinNr = m && dataValida(`${m[4]}-${m[3]}-${m[2]}`) ? `${m[4]}-${m[3]}-${m[2]}` : null
  const dataExec = normalizeazaValoare(rand?.data_contract)
  return {
    contract_nr: m ? m[1].trim() : (nr || null),
    contract_data: dataExec ?? dinNr,
    reprezentant_tgz_nume: normalizeazaValoare(rand?.coordonator_transgaz),
    avertisment: dataExec && dinNr && dataExec !== dinNr ? `Execuția are data contractului ${dataExec}, iar numărul contractului spune ${dinNr}` : null,
  }
}

// Planul de verificare a redărilor (A1 rev49, 03.11.2026), pct. 4.2 și 4.3: convocatorul se EXPEDIAZĂ prin recomandată cu AR și
// afișarea la primărie ÎNCEPE „cu cel puțin 10 zile înainte de prima zi de sesiune”. Zile calendaristice: planul nu spune „lucrătoare”.
// Constanta e singura sursă a termenului: avertisment în UAT, blocaj la adresa UAT (docx.js), data-limită la plicuri (plicuri.js).
export const TERMEN_CONVOCARE_ZILE = 10
const dataRo = (s) => String(s).split('-').reverse().join('.')

/** Data-limită 'AAAA-LL-ZZ' = ziua 1 minus TERMEN_CONVOCARE_ZILE zile calendaristice; null dacă ziua 1 lipsește sau e invalidă.
 *  Aritmetică pe data civilă (UTC la miezul nopții, fără fus orar și fără „azi”), deci aceeași în orice fus. */
export function dataLimitaConvocare(zi1) {
  const z = normalizeazaValoare(zi1)
  if (!z || !dataValida(z)) return null
  const d = new Date(z + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - TERMEN_CONVOCARE_ZILE)
  return d.toISOString().slice(0, 10)
}

/** Termenul afișării la primărie (plan pct. 4.3): `depasit` = afișarea începe DUPĂ data-limită. Fără ambele date nu se judecă. */
export function termenAfisare(uat) {
  const zi1 = normalizeazaValoare(uat?.sesiune_zi1), start = normalizeazaValoare(uat?.afisare_data_start)
  const limita = dataLimitaConvocare(zi1)
  return { zi1, start, limita, depasit: !!(limita && start && dataValida(start) && start > limita) }
}

/** Mesajul complet pentru un termen de afișare depășit (formularul UAT, adresa UAT). */
export function mesajTermenAfisare(t) {
  return `Afișarea la primărie începe pe ${dataRo(t.start)}, sub ${TERMEN_CONVOCARE_ZILE} zile înainte de ziua 1 (${dataRo(t.zi1)}): ` +
    `trebuie să înceapă cel târziu pe ${dataRo(t.limita)} (plan pct. 4.3)`
}

/** Avertismentele unui UAT: NU blochează salvarea (data afișării e un fapt, consemnat în PV de afișare); se confirmă la salvare. */
export function avertismenteUat(form) {
  const t = termenAfisare(form)
  return t.depasit ? [mesajTermenAfisare(t)] : []
}

/** Erorile unui UAT (în română), aceleași reguli ca CHECK-urile din BD: zile în ordine, termen înaintea zilei 1, afișare ordonată.
 *  Termenul de 10 zile NU e aici (nu are CHECK în BD): e avertisment, vezi avertismenteUat. */
export function valideazaUat(form) {
  const erori = []
  for (const c of CAMPURI_UAT) verificaFormat(c, form?.[c.cheie], erori)
  const [z1, z2, z3] = ZILE_SESIUNE.map(k => normalizeazaValoare(form?.[k]))
  if (z2 && !z1) erori.push('Ziua 2 cere ziua 1')
  if (z3 && !z2) erori.push('Ziua 3 cere ziua 2')
  if (z1 && z2 && !(z2 > z1)) erori.push('Ziua 2 trebuie să fie după ziua 1')
  if (z2 && z3 && !(z3 > z2)) erori.push('Ziua 3 trebuie să fie după ziua 2')
  ;[1, 2, 3].forEach(i => {
    const zi = normalizeazaValoare(form?.[`sesiune_zi${i}`]), prog = normalizeazaValoare(form?.[`program_zi${i}`])
    if (prog && !zi) erori.push(`Program ziua ${i} fără dată`)
  })
  const termen = normalizeazaValoare(form?.termen_confirmare)
  if (termen && z1 && !(termen < z1)) erori.push('Termenul de confirmare trebuie să fie înaintea zilei 1')
  const as = normalizeazaValoare(form?.afisare_data_start), ae = normalizeazaValoare(form?.afisare_data_end)
  if (as && ae && ae < as) erori.push('Afișarea se termină înainte să înceapă')
  return erori
}

/** Erorile proiectului (texte obligatorii, formate). */
export function valideazaProiect(form) {
  const erori = []
  for (const c of CAMPURI_PROIECT) verificaFormat(c, form?.[c.cheie], erori)
  return erori
}

/** Ce lipsește ca UAT-ul să poată primi convocatoare (zile + program); restul ține de proiect (motivBlocareConvocator). */
export function lipsuriUat(uat) {
  const l = []
  if (![1, 2, 3].some(i => !gol(uat?.[`sesiune_zi${i}`]) && !gol(uat?.[`program_zi${i}`]))) l.push('nicio zi de sesiune cu program')
  if (gol(uat?.reprezentant_uat_nume)) l.push('fără reprezentant nominalizat de primărie')
  const t = termenAfisare(uat)
  if (t.depasit) l.push(`afișarea începe după ${dataRo(t.limita)} (sub ${TERMEN_CONVOCARE_ZILE} zile înainte de ziua 1)`)
  return l
}

/** Rezumatul zilelor pentru tabel: „10.12 · 11.12 · 12.12” (fără an), '-' dacă nu există. */
export function rezumatZile(uat) {
  const z = ZILE_SESIUNE.map(k => uat?.[k]).filter(v => !gol(v)).map(v => { const [, l, d] = String(v).split('-'); return `${d}.${l}` })
  return z.length ? z.join(' · ') : '-'
}
