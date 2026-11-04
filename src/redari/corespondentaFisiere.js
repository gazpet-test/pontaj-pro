// Redări — fișierele unei corespondențe (red_corespondenta_fisiere, migrarea 20261130e). Logică pură + citiri, fără React.
// Regulile tari sunt în BD (trigger + RLS + politica storage): calea în {proiect}/corespondenta/{cod}/, obiectul există în Storage,
// fișierele sunt imutabile, aprobarea cere id-ul ultimului `de_trimis`, `de_trimis` nu se mai urcă după trimis / anulat. Aici le oglindim pentru UI.
// Amprente: sha256 = DECLARAT de cel care a urcat (calculat în browser); storage_etag = amprenta serverului (metadata eTag, pusă de trigger).

export const ROLURI_FISIER = [
  { cod: 'de_trimis',        eticheta: 'De trimis (varianta finală)' },
  { cod: 'dovada_trimitere', eticheta: 'Dovada trimiterii' },
  { cod: 'raspuns',          eticheta: 'Răspuns primit' },
  { cod: 'altul',            eticheta: 'Altul' },
]
export const etichetaRolFisier = cod => ROLURI_FISIER.find(r => r.cod === cod)?.eticheta ?? String(cod ?? '')

export const COL_FISIER_CORESP = 'id, corespondenta_id, rol, path, nume_original, mime, marime, sha256, storage_etag, observatii, created_by, created_at'
export const MAX_FISIER_CORESP = 25 * 1024 * 1024   // = file_size_limit al bucket-ului `redari` și CHECK-ul din BD
export const ACCEPT_FISIER_CORESP = '.pdf,.docx,.jpg,.jpeg,.png'
const MIME_PE_EXT = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

const STARI_INCHISE = ['trimis', 'raspuns_primit', 'anulat']
// Ce roluri se pot urca pe un rând în starea lui (BD: `de_trimis` refuzat după trimis / răspuns / anulat).
export const roluriPermise = rand => ROLURI_FISIER.map(r => r.cod).filter(c => c !== 'de_trimis' || !STARI_INCHISE.includes(rand?.stare))

export const extensie = nume => { const m = /\.([A-Za-z0-9]+)$/.exec(String(nume || '')); return m ? m[1].toLowerCase() : '' }

// Validarea fișierului ales (înainte de upload / înregistrare). Întoarce lista de erori (goală = ok).
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
// 8 caractere hex aleatoare (Copilot r1 C-P3-02: două urcări în aceeași secundă, cu același conținut, au căi diferite)
export const aleator8 = () => Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('')

const RX_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const folderCoresp = (proiectCod, corespCod) => {
  for (const [v, n] of [[proiectCod, 'codul proiectului'], [corespCod, 'codul corespondenței']]) {
    if (!RX_SEGMENT.test(String(v ?? '')) || String(v).includes('..')) throw new Error(`Valoare invalidă pentru calea din storage (${n}): „${v ?? ''}”`)
  }
  return `${proiectCod}/corespondenta/${corespCod}`
}
// Calea în bucket: {proiect.cod}/corespondenta/{rand.cod}/{AAAAMMDD-HHmmss}-{sha8}-{aleator8}-{nume_slug}. Aceeași formă o verifică triggerul din BD.
export function caleFisierCoresp({ proiectCod, corespCod, sha256, nume, data = new Date(), aleator = aleator8() }) {
  const folder = folderCoresp(proiectCod, corespCod)
  if (!/^[0-9a-f]{64}$/.test(String(sha256 || ''))) throw new Error('Amprenta (sha256) fișierului lipsește.')
  if (!/^[0-9a-f]{8}$/.test(String(aleator))) throw new Error('Sufixul aleator al căii e invalid.')
  return `${folder}/${stampilaUtc(data)}-${sha256.slice(0, 8)}-${aleator}-${slugNume(nume)}`
}

export const sha8 = sha => String(sha || '').slice(0, 8)
export const numeDinCale = path => String(path || '').split('/').pop()

// sha256 hex al unui ArrayBuffer / Blob (WebCrypto, merge și în browser, și în Node ≥ 20)
export async function sha256Hex(dateOriBlob) {
  const buf = typeof dateOriBlob?.arrayBuffer === 'function' ? await dateOriBlob.arrayBuffer() : dateOriBlob
  const dig = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(dig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Jakarinos r1 J-P1-2: NU sortăm în JS (formatul timestamp-urilor din PostgREST nu se compară corect ca text).
// Ordinea vine din query (created_at desc, id desc — exact ordinea din trigger); helperii o păstrează.
export const fisierDeAprobat = fisiere => (fisiere || []).find(f => f.rol === 'de_trimis') || null
export const fisiereRand = (toate, randId) => (toate || []).filter(f => f.corespondenta_id === randId)

export const fmtMarime = n => !(n > 0) ? '-' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

// Jakarinos L23: fișierele proiectului, paginate KEYSET pe (created_at desc, id desc) — fără offset, fără plafon tăcut. Filtrul pe proiect prin
// embed !inner cu numele FK-ului (între cele două tabele sunt două FK-uri: fără nume, PostgREST ar refuza embed-ul ca ambiguu).
export const EMBED_PROIECT = 'red_corespondenta!red_corespondenta_fisiere_coresp_fk!inner(proiect_id)'
export async function citesteFisiereProiect(supabase, proiectId, { pagina = 500, esteCurent = () => true } = {}) {
  const tot = []
  let ultim = null
  for (let pas = 0; pas < 1000; pas++) {
    let q = supabase.from('red_corespondenta_fisiere').select(`${COL_FISIER_CORESP}, ${EMBED_PROIECT}`).eq('red_corespondenta.proiect_id', proiectId)
    if (ultim) q = q.or(`created_at.lt."${ultim.created_at}",and(created_at.eq."${ultim.created_at}",id.lt.${ultim.id})`)
    const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pagina)
    if (error) throw error
    if (!esteCurent()) return null
    for (const r of data || []) { const { red_corespondenta: _, ...f } = r; tot.push(f) }
    if (!data || data.length < pagina) return tot
    ultim = data[data.length - 1]
  }
  throw new Error('Prea multe fișiere de corespondență pentru afișare.')
}

// Obiectele din folderul unui rând (listare Storage paginată; folderul e imutabil — doar adăugări — deci offset-ul nu sare obiecte vechi).
export async function listeazaFolder(supabase, folder, { pagina = 100 } = {}) {
  const tot = []
  for (let offset = 0; offset < 100000; offset += pagina) {
    const { data, error } = await supabase.storage.from('redari').list(folder, { limit: pagina, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    tot.push(...(data || []).filter(o => o && o.id && o.name).map(o => ({ path: `${folder}/${o.name}`, nume: o.name, marime: o.metadata?.size ?? null, creat: o.created_at || null })))
    if (!data || data.length < pagina) return tot
  }
  throw new Error('Prea multe obiecte în folderul corespondenței.')
}
// Copilot r1 C-P2-01: obiecte urcate dar neînregistrate (orfane) = din folder, fără rând în tabel.
export const orfani = (obiecte, fisiere) => { const cunoscute = new Set((fisiere || []).map(f => f.path)); return (obiecte || []).filter(o => !cunoscute.has(o.path)) }
