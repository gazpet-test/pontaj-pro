// Redări — fișierele unei corespondențe (red_corespondenta_fisiere, migrarea 20261130e). Logică pură, fără React / Supabase.
// Regulile tari sunt în BD (trigger + RLS + politica storage): calea în {proiect}/corespondenta/{cod}/, obiectul există în Storage,
// fișierele sunt imutabile, aprobarea reține ultimul `de_trimis`, `de_trimis` nu se mai urcă după trimis / anulat. Aici le oglindim pentru UI.

export const ROLURI_FISIER = [
  { cod: 'de_trimis',        eticheta: 'De trimis (varianta finală)' },
  { cod: 'dovada_trimitere', eticheta: 'Dovada trimiterii' },
  { cod: 'raspuns',          eticheta: 'Răspuns primit' },
  { cod: 'altul',            eticheta: 'Altul' },
]
export const etichetaRolFisier = cod => ROLURI_FISIER.find(r => r.cod === cod)?.eticheta ?? String(cod ?? '')

export const COL_FISIER_CORESP = 'id, corespondenta_id, rol, path, nume_original, mime, marime, sha256, observatii, created_by, created_at'
export const MAX_FISIER_CORESP = 25 * 1024 * 1024   // = file_size_limit al bucket-ului `redari` și CHECK-ul din BD
export const ACCEPT_FISIER_CORESP = '.pdf,.docx,.jpg,.jpeg,.png'
const MIME_PE_EXT = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

const STARI_INCHISE = ['trimis', 'raspuns_primit', 'anulat']
// Ce roluri se pot urca pe un rând în starea lui (BD: `de_trimis` refuzat după trimis / răspuns / anulat).
export const roluriPermise = rand => ROLURI_FISIER.map(r => r.cod).filter(c => c !== 'de_trimis' || !STARI_INCHISE.includes(rand?.stare))

export const extensie = nume => { const m = /\.([A-Za-z0-9]+)$/.exec(String(nume || '')); return m ? m[1].toLowerCase() : '' }

// Validarea fișierului ales (înainte de upload). Întoarce lista de erori (goală = ok).
export function valideazaFisierCoresp(fisier) {
  if (!fisier) return ['Alege un fișier.']
  const erori = []
  if (!MIME_PE_EXT[extensie(fisier.name)]) erori.push('Sunt acceptate doar PDF, DOCX, JPG și PNG.')
  if (!(fisier.size > 0)) erori.push('Fișierul e gol.')
  else if (fisier.size > MAX_FISIER_CORESP) erori.push('Fișierul depășește 25 MB.')
  return erori
}
export const mimeFisier = fisier => MIME_PE_EXT[extensie(fisier?.name)] || fisier?.type || 'application/octet-stream'

// Numele original → bucată sigură pentru cale (fără diacritice, litere mici, [a-z0-9-], max 60) + extensia în litere mici.
export function slugNume(nume) {
  const ext = extensie(nume)
  const baza = String(nume || '').replace(/\.[A-Za-z0-9]+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return `${baza || 'fisier'}${ext ? '.' + ext : ''}`
}

// AAAAMMDD-HHmmss în UTC (determinist; ordinea reală o dă created_at din BD)
export const stampilaUtc = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

const RX_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// Calea în bucket: {proiect.cod}/corespondenta/{rand.cod}/{AAAAMMDD-HHmmss}-{sha8}-{nume_slug}. Aceeași formă o verifică triggerul din BD.
export function caleFisierCoresp({ proiectCod, corespCod, sha256, nume, data = new Date() }) {
  for (const [v, n] of [[proiectCod, 'codul proiectului'], [corespCod, 'codul corespondenței']]) {
    if (!RX_SEGMENT.test(String(v ?? '')) || String(v).includes('..')) throw new Error(`Valoare invalidă pentru calea din storage (${n}): „${v ?? ''}”`)
  }
  if (!/^[0-9a-f]{64}$/.test(String(sha256 || ''))) throw new Error('Amprenta (sha256) fișierului lipsește.')
  return `${proiectCod}/corespondenta/${corespCod}/${stampilaUtc(data)}-${sha256.slice(0, 8)}-${slugNume(nume)}`
}

export const sha8 = sha => String(sha || '').slice(0, 8)

// sha256 hex al unui ArrayBuffer / Blob (WebCrypto, merge și în browser, și în Node ≥ 20)
export async function sha256Hex(dateOriBlob) {
  const buf = typeof dateOriBlob?.arrayBuffer === 'function' ? await dateOriBlob.arrayBuffer() : dateOriBlob
  const dig = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(dig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Ultimul fișier `de_trimis` (created_at desc, id desc) — același pe care îl va reține BD-ul la aprobare.
export function fisierDeAprobat(fisiere) {
  return (fisiere || []).filter(f => f.rol === 'de_trimis')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))[0] || null
}

// Fișierele unui rând, cele mai noi primele.
export const fisiereRand = (toate, randId) => (toate || []).filter(f => f.corespondenta_id === randId)
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))

export const fmtMarime = n => !(n > 0) ? '-' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
