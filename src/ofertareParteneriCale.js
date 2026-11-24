// Calea fișierelor documentelor de partener (Ofertare → Parteneri; TKT-2026-0389, migrarea 20270111a).
// ACEEAȘI regulă ca garda din BD (fn_ofertare_doc_cale_garda): ecranul verifică înainte de upload, ca să nu rămână fișiere urcate și respinse
// la salvare. Paritatea cu BD (L19): tabelul comun supabase/tests/20270111a_ctc_autorizatii_ndt_cazuri_cale.json, rulat în
// src/ctcAutorizatiiNdt.test.js (aici) și în scripts/pglite/test_ctc_autorizatii_ndt_local.mjs (trigger-ul real).
//   * documentele NDT: parteneri/<partener_id>/ndt/<timp>_<nume>; celelalte categorii: parteneri/<partener_id>/<timp>_<nume> (ca înainte);
//   * nicio cale goală, cu backslash, „%”, caractere de control sau segment „.” / „..”; o categorie non-NDT nu poate sta sub un dosar ndt/.
export const CATEGORIE_NDT = 'autorizatie_ndt'
export const MESAJ_CATEGORIE_NOUA = 'Pentru categoria nouă, încărcați din nou fișierul (se mută în dosarul potrivit)'

// diacriticele combinate U+0300–U+036F (după NFD), ca înainte; construite din coduri (fără secvențe de escape în sursă)
const DIACRITICE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')
// numele fișierului: doar [A-Za-z0-9._-], cel mult 120 de caractere (neschimbat față de ecranul vechi)
export const sanitize = n => String(n || 'fisier').normalize('NFD').replace(DIACRITICE, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)

const BACKSLASH = String.fromCharCode(92)
// [[:space:]] din PostgreSQL (ASCII): spațiu, tab, LF, VT, FF, CR
const ALB = new Set([32, 9, 10, 11, 12, 13])
// [[:cntrl:]]: ASCII 0–31 și 127; în plus 128–159 (C1), refuzate și ele aici (mai strict decât BD, doar în ecran)
const eControl = c => c < 32 || c === 127 || (c >= 128 && c <= 159)
const idValid = pid => Number.isSafeInteger(Number(pid)) && Number(pid) > 0 && String(Number(pid)) === String(pid).trim()

// calea nouă pentru un fișier urcat acum (timp = Date.now() al apelantului)
export function caleNoua(pid, categorie, numeFisier, timp) {
  const nume = `${timp}_${sanitize(numeFisier)}`
  return categorie === CATEGORIE_NDT ? `parteneri/${Number(pid)}/ndt/${nume}` : `parteneri/${Number(pid)}/${nume}`
}

// regula gărzii din BD, pe un rând (cale, partener, categorie); null = fără fișier = permis
export function caleValida(cale, pid, categorie) {
  if (cale == null) return true
  if (typeof cale !== 'string') return false
  let areText = false
  for (let i = 0; i < cale.length; i++) {
    const c = cale.charCodeAt(i)
    if (eControl(c)) return false
    if (!ALB.has(c)) areText = true
  }
  if (!areText || cale.includes(BACKSLASH) || cale.includes('%')) return false
  if (cale.split('/').some(s => s === '.' || s === '..')) return false
  if (categorie === CATEGORIE_NDT) {
    if (!idValid(pid)) return false
    return new RegExp('^parteneri/' + Number(pid) + '/ndt/[^/]+$').test(cale)
  }
  return !('/' + cale).includes('/ndt/')
}

// Salvarea unui document: ce cale primește rândul și dacă se urcă un fișier.
//   * cu fișier nou: calea nouă (subdosarul după categorie), verificată ÎNAINTE de upload;
//   * fără fișier nou: calea veche, dacă e încă validă pentru categoria aleasă (de ex. alta → autorizatie_ndt cu fișier = blocat, cu mesaj);
//   * un document fără fișier își schimbă liber categoria.
export function pregatesteSalvare({ d, categorie, file, pid, timp }) {
  if (file) {
    const cale = caleNoua(pid, categorie, file.name, timp)
    if (!caleValida(cale, pid, categorie)) return { eroare: 'Fișierul nu poate fi încărcat cu acest nume (calea nu e permisă).' }
    return { cale, urca: true }
  }
  const veche = d?.fisier_path || null
  if (veche && !caleValida(veche, pid, categorie)) return { eroare: MESAJ_CATEGORIE_NOUA }
  return { cale: veche, urca: false }
}

// eșec CERT al scrierii (L05): eroare 4xx de la server sau 0 rânduri scrise; o eroare de rețea / 5xx = rezultat necunoscut (fișierul nou rămâne)
export const esecCert = ({ error, data, status }) => (error ? (Number(status) >= 400 && Number(status) < 500) : !data?.length)
