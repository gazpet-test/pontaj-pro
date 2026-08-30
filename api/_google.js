// Acces la Google Drive cu un cont de serviciu, fara librarie externa.
//
// Google cere un „JWT bearer": construim un token semnat cu cheia privata a contului
// de serviciu si il schimbam pe un access_token. Sunt vreo 30 de linii cu `crypto` din
// Node, deci nu merita adaugata dependinta googleapis (care trage zeci de megabytes
// intr-o functie serverless si ne-ar incetini fiecare pornire la rece).
//
// Cheia sta in variabila de mediu GOOGLE_SA_JSON, exact continutul fisierului .json
// descarcat din Google Cloud. Nu ajunge niciodata in cod si nici in baza de date.
import { createSign } from 'node:crypto'

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'  // doar citire, nimic altceva

function b64url(x) {
  return Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let tokenCache = { valoare: null, expira: 0 }

/** Access token pentru contul de serviciu. Se refoloseste cat e valabil. */
export async function tokenGoogle() {
  if (tokenCache.valoare && Date.now() < tokenCache.expira - 60_000) return tokenCache.valoare

  const brut = process.env.GOOGLE_SA_JSON
  if (!brut) throw new Error('lipseste GOOGLE_SA_JSON din variabilele Vercel')
  let sa
  try {
    sa = JSON.parse(brut)
  } catch {
    throw new Error('GOOGLE_SA_JSON nu e JSON valid — verifica daca s-a lipit tot fisierul')
  }
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SA_JSON nu are client_email / private_key')

  const acum = Math.floor(Date.now() / 1000)
  const antet = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const pretentii = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: acum,
    exp: acum + 3600,
  }))
  const semnatura = createSign('RSA-SHA256').update(`${antet}.${pretentii}`).sign(sa.private_key)
  const jwt = `${antet}.${pretentii}.${b64url(semnatura)}`

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const j = await r.json()
  if (!r.ok || !j.access_token) {
    throw new Error(`Google a refuzat cheia: ${j.error_description || j.error || r.status}`)
  }
  tokenCache = { valoare: j.access_token, expira: Date.now() + (j.expires_in || 3600) * 1000 }
  return j.access_token
}

const CAMPURI = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)'

/** Continutul direct al unui folder (fisiere si subfoldere), cu paginare. */
export async function listeazaFolder(token, folderId) {
  const out = []
  let pageToken = ''
  do {
    const u = new URL('https://www.googleapis.com/drive/v3/files')
    u.searchParams.set('q', `'${folderId}' in parents and trashed = false`)
    u.searchParams.set('fields', CAMPURI)
    u.searchParams.set('pageSize', '1000')
    u.searchParams.set('supportsAllDrives', 'true')
    u.searchParams.set('includeItemsFromAllDrives', 'true')
    if (pageToken) u.searchParams.set('pageToken', pageToken)

    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
    const j = await r.json()
    if (!r.ok) throw new Error(`Drive list ${folderId}: ${j?.error?.message || r.status}`)
    out.push(...(j.files || []))
    pageToken = j.nextPageToken || ''
  } while (pageToken)
  return out
}

export const E_FOLDER = (f) => f.mimeType === 'application/vnd.google-apps.folder'

/**
 * Toate fisierele dintr-un dosar, inclusiv din subfoldere.
 * Dosarele de pe Drive nu sunt plate — de exemplu KUSHWAHA SHRIRAM are cinci
 * subfoldere, iar fara coborare s-ar pierde tot ce e in ele.
 */
export async function fisiereRecursiv(token, folderId, adancime = 0) {
  if (adancime > 5) return []
  const copii = await listeazaFolder(token, folderId)
  const fisiere = copii.filter((f) => !E_FOLDER(f))
  for (const sub of copii.filter(E_FOLDER)) {
    fisiere.push(...await fisiereRecursiv(token, sub.id, adancime + 1))
  }
  return fisiere
}

// Documentele native Google (Docs/Sheets) nu se pot descarca direct — se exporta.
const EXPORT_NATIV = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
}

/** Descarca un fisier. Intoarce { buf, mime, extensie }. */
export async function descarcaFisier(token, fisier) {
  const nativ = EXPORT_NATIV[fisier.mimeType]
  const u = nativ
    ? new URL(`https://www.googleapis.com/drive/v3/files/${fisier.id}/export`)
    : new URL(`https://www.googleapis.com/drive/v3/files/${fisier.id}`)
  if (nativ) u.searchParams.set('mimeType', nativ)
  else u.searchParams.set('alt', 'media')
  u.searchParams.set('supportsAllDrives', 'true')

  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`Drive download ${fisier.id}: ${r.status} ${t.slice(0, 120)}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  const mime = nativ || fisier.mimeType || 'application/octet-stream'
  const dinNume = (fisier.name || '').includes('.') ? fisier.name.split('.').pop().toLowerCase() : ''
  const extensie = nativ ? 'pdf' : (dinNume || 'bin')
  return { buf, mime, extensie }
}
