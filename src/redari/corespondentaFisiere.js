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

// Jakarinos L23 + r2 J-P2-1 / C-P2-02: citire KEYSET pe (created_at desc, id desc) — fără offset; se oprește DOAR la pagina GOALĂ (nu la „mai puțin
// decât pagina”: PostgREST poate plafona răspunsul sub limita cerută, db-max-rows). `fabrica()` = query-ul filtrat (select + eq), fără ordine / limită.
export async function citesteFisiereKeyset(fabrica, { pagina = 500, esteCurent = () => true, maxPasi = 2000 } = {}) {
  const tot = [], vazute = new Set()
  let ultim = null
  for (let pas = 0; pas < maxPasi; pas++) {
    let q = fabrica()
    if (ultim) q = q.or(`created_at.lt."${ultim.created_at}",and(created_at.eq."${ultim.created_at}",id.lt.${ultim.id})`)
    const { data, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pagina)
    if (error) throw error
    if (!esteCurent()) return null
    if (!data?.length) return tot
    for (const r of data) { if (vazute.has(r.id)) continue; vazute.add(r.id); const { red_corespondenta: _, ...f } = r; tot.push(f) }
    ultim = data[data.length - 1]
  }
  throw new Error('Prea multe fișiere de corespondență pentru afișare.')
}
// Filtrul pe proiect prin embed !inner cu numele FK-ului (între cele două tabele sunt două FK-uri: fără nume, PostgREST ar refuza embed-ul ca ambiguu).
export const EMBED_PROIECT = 'red_corespondenta!red_corespondenta_fisiere_coresp_fk!inner(proiect_id)'
export const citesteFisiereProiect = (supabase, proiectId, opt) =>
  citesteFisiereKeyset(() => supabase.from('red_corespondenta_fisiere').select(`${COL_FISIER_CORESP}, ${EMBED_PROIECT}`).eq('red_corespondenta.proiect_id', proiectId), opt)
export const citesteFisiereRand = (supabase, randId, opt) =>
  citesteFisiereKeyset(() => supabase.from('red_corespondenta_fisiere').select(COL_FISIER_CORESP).eq('corespondenta_id', randId), opt)

// Obiectele din folderul unui rând (listare Storage, singura paginare oferită e offset). Folderul e doar-adăugări, dar o listare paralelă poate
// dubla / sări rânduri: deduplicăm după cale și marcăm `incompleta` când apar dubluri sau s-a atins plafonul de pagini.
export async function listeazaFolder(supabase, folder, { pagina = 100, maxPasi = 1000 } = {}) {
  const pePath = new Map()
  let incompleta = false
  for (let pas = 0, offset = 0; ; pas++, offset += pagina) {
    if (pas >= maxPasi) { incompleta = true; break }
    const { data, error } = await supabase.storage.from('redari').list(folder, { limit: pagina, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    if (!data?.length) break
    for (const o of data) {
      if (!o?.id || !o.name) continue   // „foldere” virtuale
      const path = `${folder}/${o.name}`
      if (pePath.has(path)) { incompleta = true; continue }
      pePath.set(path, { path, nume: o.name, marime: o.metadata?.size ?? null, creat: o.created_at || null })
    }
  }
  return { lista: [...pePath.values()], incompleta }
}
export const orfani = (obiecte, fisiere) => { const cunoscute = new Set((fisiere || []).map(f => f.path)); return (obiecte || []).filter(o => !cunoscute.has(o.path)) }

// Copilot r1 C-P2-01 + r2 J-P2-1: orfanii unui rând = obiecte din folder fără rând în tabel. Căile înregistrate se citesc keyset (fără plafon), iar fiecare
// candidat e verificat încă o dată după `path` înainte de afișare. Întoarce { lista, incompleta } sau null dacă între timp citirea a expirat.
export async function gasesteOrfani(supabase, { folder, randId, esteCurent = () => true }) {
  const { lista: obiecte, incompleta: listaIncompleta } = await listeazaFolder(supabase, folder)
  if (!esteCurent()) return null
  const inregistrate = await citesteFisiereRand(supabase, randId, { esteCurent })
  if (inregistrate === null) return null
  let incompleta = listaIncompleta
  const lista = []
  for (const o of orfani(obiecte, inregistrate)) {
    const { data, error } = await supabase.from('red_corespondenta_fisiere').select('id').eq('path', o.path).limit(1)
    if (!esteCurent()) return null
    if (error) { incompleta = true; continue }
    if (!data?.length) lista.push(o)
  }
  return { lista, incompleta }
}

// ── Urcarea cu rezultat ambiguu (Jakarinos r2 J-P2-2 / Copilot C-P2-01) ───────────────────────────────────────────────────────────────────
// Supabase Storage la upload pe o cheie existentă (upsert false): 409 / „already exists” / „Duplicate” (ca în docx.js)
export const eExistaDeja = e => !!e && (String(e.statusCode ?? e.status ?? '') === '409' || /already exists|duplicate/i.test(`${e.message || ''} ${e.error || ''}`))
// Ambiguu = nu știm dacă obiectul a ajuns: rețea / timeout / 5xx / fără cod. Un 4xx clar (400/401/403/413/415…) e refuz sigur.
export function eAmbigua(e) {
  if (!e) return false
  const st = Number(e.statusCode ?? e.status)
  if (Number.isFinite(st) && st > 0) return st >= 500 || st === 408 || st === 429
  return true
}
// Obiectul există la calea exactă? true / false / null (necunoscut)
export async function existaObiect(supabase, path) {
  const i = path.lastIndexOf('/'), folder = path.slice(0, i), nume = path.slice(i + 1)
  try {
    const { data, error } = await supabase.storage.from('redari').list(folder, { limit: 100, offset: 0, search: nume })
    if (error) return null
    return (data || []).some(o => o?.id && o.name === nume)
  } catch { return null }
}
// Pune obiectul la `path` fără suprascriere. 'urcat' | 'exista' (deja acolo: o încercare anterioară a ajuns) | 'neconfirmat'; aruncă la refuz sigur.
// Calea e unică pe încercare (sufix aleator) și se refolosește DOAR pentru același fișier ales, deci „exista” = încercarea noastră anterioară.
export async function asiguraObiect(supabase, path, fisier, contentType) {
  let err = null
  try {
    const { error } = await supabase.storage.from('redari').upload(path, fisier, { upsert: false, contentType })
    if (!error) return 'urcat'
    err = error
  } catch (e) { err = e }
  if (eExistaDeja(err)) return 'exista'
  if (!eAmbigua(err)) throw err
  return (await existaObiect(supabase, path)) === true ? 'exista' : 'neconfirmat'
}

// Copilot r2 C-P2-03: INSERT + reconciliere pe payload-ul SEMANTIC imutabil (corespondenta_id, rol, sha256 declarat, path). La eroare / rezultat necunoscut
// citește rândul după `path`: identic → 'ok'; există cu alte atribute → 'conflict' (nu ok); lipsește și BD-ul a refuzat clar → aruncă; altfel 'neconfirmat'.
export const CAMPURI_SEMANTICE = ['corespondenta_id', 'rol', 'sha256', 'path']
export async function reconciliazaInregistrare(supabase, payload) {
  let eIns = null
  try {
    const { error } = await supabase.from('red_corespondenta_fisiere').insert(payload).select('id')
    if (!error) return { rez: 'ok' }
    eIns = error
  } catch (e) { eIns = e }
  let rand = null, citit = false
  try {
    const { data, error } = await supabase.from('red_corespondenta_fisiere').select('id, corespondenta_id, rol, sha256, path').eq('path', payload.path).limit(1)
    if (!error) { citit = true; rand = data?.[0] || null }
  } catch { /* necunoscut */ }
  if (rand) return CAMPURI_SEMANTICE.every(k => rand[k] === payload[k]) ? { rez: 'ok' } : { rez: 'conflict', rand }
  if (citit && eIns?.code) throw eIns
  return { rez: 'neconfirmat', eroare: eIns }
}
