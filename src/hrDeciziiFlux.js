// ════════════════════════════════════════════════════════════════
// Registrul deciziilor HR — apelurile comune (spec docs/HR/GENERATOR_DECIZII_SPEC.md §3.5–3.9, §4, PR3).
// Drepturile le decide DOAR serverul (fn_hr_decizii_poate); UI-ul doar ascunde butoane.
// Fișierele merg în bucket-ul privat `hr-decizii`, pe calea <serie>/<an>/<id>/(generat|semnat)_<Date.now()>.pdf.
// ════════════════════════════════════════════════════════════════
import { supabase } from './lib/supabase.js'
import { renderDeciziePdf, fisierPdf, sha256Hex } from './hrDeciziiDoc.js'
import { CALE_FISIER_RE, paginareKeyset, aziBucuresti } from './hrDeciziiUtil.js'

export const BUCKET = 'hr-decizii'

/** Mesajul unei erori Supabase/RPC, fără prefixe tehnice. */
export const mesajEroare = e => String(e?.message || e?.error_description || e || 'eroare necunoscută').replace(/^.*?ERROR:\s*/, '')

export async function rpc(nume, args) {
  const { data, error } = await supabase.rpc(nume, args)
  if (error) throw new Error(mesajEroare(error))
  return data
}

/** Drepturile utilizatorului curent pe acțiunile globale, într-un singur tur (fail-closed: eroare → false). */
export async function drepturi(actiuni) {
  const rez = await Promise.all(actiuni.map(a => supabase.rpc('fn_hr_decizii_poate', { p_actiune: a }).then(r => r.data === true, () => false)))
  return Object.fromEntries(actiuni.map((a, i) => [a, rez[i]]))
}

/**
 * Toate rândurile unei interogări, pe chei (paginareKeyset, J11-1/P11-2): plafonul REST nu mai trunchiază în tăcere.
 * fabrica: () => supabase.from(...).select(... cu id ...) plus filtre, FĂRĂ order — ordinea de afișare se face în client.
 */
export const toateRandurile = (fabrica, pas = 1000) => paginareKeyset((ultim, n) => {
  let q = fabrica()
  if (ultim != null) q = q.gt('id', ultim)
  return q.order('id', { ascending: true }).limit(n).then(r => r.error ? { error: new Error(mesajEroare(r.error)) } : r)
}, pas)

export const caleFisier = (d, numeFisier) => {
  if (!CALE_FISIER_RE.test(numeFisier)) throw new Error('nume de fișier nepermis: ' + numeFisier)
  return `${d.serie}/${d.an}/${d.id}/${numeFisier}`
}

/**
 * Urcă un PDF; un obiect deja existent pe ACEEAȘI cale (retry după un răspuns pierdut) nu e eroare (VA34).
 * Calea conține Date.now(), deci un fișier nou nu poate nimeri peste altul.
 */
export async function urcaPdf(path, file) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: 'application/pdf', cacheControl: '3600' })
  if (error && !/exist|duplicate|409/i.test(`${error.message} ${error.statusCode || ''}`)) throw new Error('Încărcarea a eșuat: ' + mesajEroare(error))
}

export async function urlSemnat(path, sec = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, sec)
  if (error) throw new Error(mesajEroare(error))
  return data.signedUrl
}

/** Deschide un PDF din bucket într-un tab nou (pe telefon: vizualizatorul sistemului). */
export async function deschidePdf(path) {
  const w = window.open('', '_blank')
  try {
    const url = await urlSemnat(path)
    if (w) w.location.href = url; else window.location.href = url
  } catch (e) { if (w) w.close(); throw e }
}

/**
 * PDF-ul generat al unei decizii emise din platformă: randat din `continut` la fontul înghețat (snapshot.font_pt),
 * urcat ca generat_<ts>.pdf și înregistrat cu fn_hr_decizie_seteaza_pdf. `stare` păstrează fișierul și calea între
 * reîncercări (hash-ul unui PDF recompus ar ieși altul). Un document care depășește pagina aruncă eroare și NU se urcă.
 */
export async function inregistreazaPdfGenerat(d, stare = {}) {
  if (d.pdf_path) return d.pdf_path
  if (!d.continut) throw new Error('Decizia nu are conținut generat')
  if (!stare.file) {
    const blob = await renderDeciziePdf(d.continut, d.snapshot, { cod_verificare: d.cod_verificare })
    stare.file = fisierPdf(blob, `generat_${Date.now()}.pdf`)
    stare.path = caleFisier(d, stare.file.name)
    stare.sha = await sha256Hex(stare.file)
  }
  await urcaPdf(stare.path, stare.file)
  await rpc('fn_hr_decizie_seteaza_pdf', { p_id: d.id, p_path: stare.path, p_sha256: stare.sha })
  return stare.path
}

export const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) }))

export const fmtData = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ro-RO') : '—'
/** Ziua de business, Europe/Bucharest (J11-2). */
export const azi = () => aziBucuresti()

/** „Nume Prenume" din „NUME PRENUME" (employees.name = familie + prenume). */
export const numeAfis = n => String(n || '').toLowerCase().replace(/(^|[\s-])\S/g, s => s.toUpperCase())

export const STARI = {
  draft: { t: 'draft', c: '#8B949E' },
  emisa: { t: 'nesemnată', c: '#D29922' },
  semnata: { t: 'semnată', c: '#2EA043' },
  anulata: { t: 'anulată', c: '#6E7681' },
  inlocuita: { t: 'înlocuită', c: '#A371F7' },
  revocata: { t: 'revocată', c: '#F85149' },
}
