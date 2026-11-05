// F2: logică comună browser / edge. Intrările externe sunt numai date.
export const EXPEDITOR = 'redari@gazpet.ro'
// Decizia 05.11.2026: transportul real rămâne imposibil în această livrare.
export const TRANSPORT_REAL_ACTIV = false
export const LIMITA_LOT = 300
export const STARI_LOT = ['ciorna', 'aprobat', 'in_trimitere', 'blocat_integritate', 'incheiat']
export const STARI_MESAJ = ['in_coada', 'rezervat', 'in_apel', 'trimis', 'esuat_sigur', 'necunoscut', 'esuat_confirmat', 'anulat']
export function emailValid(v) {
  return typeof v === 'string' && v.length <= 254 && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(v)
}
export const textNormal = v => v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
export function antetValid(v, limita = 500) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= limita && !/[\x00-\x1f\x7f]/.test(v)
}
// Contract JS/SQL: chei ASCII fixe și întregi siguri; nu JSON general cu fracții/chei Unicode.
export function canonic(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonic).join(',') + ']'
  if (!v || typeof v !== 'object') throw new Error('forma_invalida')
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonic(v[k])).join(',') + '}'
}
export async function sha256(v) {
  const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}
export function formaMesaj(m) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.id) || !emailValid(m.catre) || !antetValid(m.subiect_final) || m.message_id !== `<${m.id}@gazpet.ro>`) throw new Error('antet_invalid')
  if (typeof m.corp_text_final !== 'string' || !m.corp_text_final.trim() || m.corp_text_final.length > 20000) throw new Error('corp_invalid')
  if (m.corp_html_final != null && (typeof m.corp_html_final !== 'string' || m.corp_html_final.length > 40000)) throw new Error('corp_invalid')
  const atasamente = m.atasament_path ? [{ nume: m.atasament_nume, mime: m.atasament_mime, marime: m.atasament_marime, sha256: m.atasament_sha256 }] : []
  if (atasamente.some(a => !antetValid(a.nume, 150) || a.mime !== 'application/pdf' || !Number.isSafeInteger(a.marime) || a.marime < 5 || a.marime > 10000000 || !/^[0-9a-f]{64}$/.test(a.sha256))) throw new Error('atasament_invalid')
  return { v: 1, mesaj_id: m.id, from: EXPEDITOR, to: m.catre.toLowerCase(), subiect: textNormal(m.subiect_final), message_id: m.message_id,
    in_reply_to: null, references: [], corp_text: textNormal(m.corp_text_final), corp_html: m.corp_html_final == null ? null : textNormal(m.corp_html_final), atasamente }
}
export const hashMesaj = async m => sha256(canonic(formaMesaj(m)))
export const hashLot = mesaje => sha256(canonic([...mesaje].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(m => m.mesaj_sha256)))
export function gardaTrimitere({ owner, setari, informare, lot, acum = Date.now() }) {
  if (owner !== true) return 'non_owner'
  if (!setari || setari.trimitere_oprita !== false) return 'trimitere_oprita'
  if (informare !== true) return 'informare_nepublicata'
  if (!lot || !['aprobat', 'in_trimitere'].includes(lot.stare) || !lot.aprobat_de) return 'lot_neaprobat'
  const aprobat = Date.parse(lot.aprobat_la)
  if (!Number.isFinite(aprobat) || acum >= aprobat + 7 * 86400000) return 'aprobare_expirata'
  if (!lot.lot_sha256 || lot.lot_sha256 !== lot.aprobat_lot_sha256) return 'lot_integritate'
  return null
}
export function rezultatSend(status, body, { apelEfectuat = true } = {}) {
  if (!apelEfectuat) return { stare: 'esuat_sigur', cod: 'apel_neefectuat' }
  if (status === 200 && /^[A-Za-z0-9_-]{1,64}$/.test(body?.id || '') && /^[A-Za-z0-9_-]{1,64}$/.test(body?.threadId || '')) return { stare: 'trimis', cod: 'acceptat_gmail', gmail_id: body.id, thread_id: body.threadId }
  const rate = body?.error?.errors?.some(e => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(e?.reason))
  if (status === 400 || (status === 403 && !rate)) return { stare: 'esuat_sigur', cod: 'refuz_gmail' }
  return { stare: 'necunoscut', cod: 'rezultat_ambiguu' }
}
const b64 = bytes => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const base64Text = s => b64(new TextEncoder().encode(s))
const linii64 = s => s.match(/.{1,76}/g)?.join('\r\n') || ''
// RFC2047: encoded-word <=75 octeți, fără tăiere în mijlocul unui caracter UTF-8.
const subiectMime = s => {
  const bucati = []; let bucata = ''
  for (const c of s) {
    if (new TextEncoder().encode(bucata + c).length > 42) { bucati.push(bucata); bucata = '' }
    bucata += c
  }
  if (bucata) bucati.push(bucata)
  return bucati.map(b => `=?UTF-8?B?${base64Text(b)}?=`).join('\r\n ')
}
/** Un To, fără CC/BCC; HTML-ul nu se randează în ERP. PDF-ul este verificat ca octeți. */
export async function compuneMime(m, atasament = null, delimitator = crypto.randomUUID()) {
  const f = formaMesaj(m)
  if (await hashMesaj(m) !== m.mesaj_sha256) throw new Error('snapshot_diferit')
  if (!/^[A-Za-z0-9-]{1,80}$/.test(delimitator)) throw new Error('delimitator_invalid')
  if (m.atasament_path && (!atasament || atasament.length !== m.atasament_marime || new TextDecoder().decode(atasament.subarray(0, 5)) !== '%PDF-' || await sha256(atasament) !== m.atasament_sha256)) throw new Error('atasament_diferit')
  const head = [`From: ${EXPEDITOR}`, `To: ${f.to}`, `Reply-To: ${EXPEDITOR}`, `Subject: ${subiectMime(f.subiect)}`, `Message-ID: ${f.message_id}`,
    'MIME-Version: 1.0', 'List-Unsubscribe: <mailto:redari@gazpet.ro?subject=dezabonare>', `X-Gazpet-Redari: ${m.id}; h=${m.mesaj_sha256}`, `Content-Type: multipart/mixed; boundary="${delimitator}"`]
  const parts = [`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${linii64(base64Text(f.corp_text))}`]
  if (f.corp_html !== null) throw new Error('html_neimplementat') // F2 folosește text simplu; nu producem două corpuri contradictorii.
  if (m.atasament_path) parts.push(`Content-Type: application/pdf\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(m.atasament_nume).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}\r\nContent-Transfer-Encoding: base64\r\n\r\n${linii64(b64(atasament))}`)
  return head.join('\r\n') + '\r\n\r\n' + parts.map(p => `--${delimitator}\r\n${p}\r\n`).join('') + `--${delimitator}--\r\n`
}
/** Transport injectat numai pentru probe. Nu repetă send niciodată la rezultat ambiguu. */
export async function proceseazaMesaj(m, deps) {
  if (!TRANSPORT_REAL_ACTIV) return { sarit: true, cod: 'transport_real_oprit' }
  if (m.stare !== 'rezervat') return { stare: m.stare, sarit: true }
  let raw
  try { raw = await compuneMime(m, m.atasament_path ? await deps.descarca(m.atasament_path) : null) }
  catch { return deps.rezultat(m, { stare: 'esuat_sigur', cod: 'snapshot_diferit' }) }
  if (await deps.incepe(m) !== true) return { sarit: true }
  let rezultat
  try {
    const res = await deps.send(raw)
    let body = null
    try { body = await res.json() } catch { /* 200 neinterpretabil = necunoscut */ }
    rezultat = rezultatSend(res.status, body)
  } catch { rezultat = rezultatSend(0, null) }
  // Retry doar persistarea rezultatului, cu aceleași argumente. Niciodată send.
  for (let i = 0; i < 3; i++) {
    try { return await deps.rezultat(m, rezultat) } catch { /* recitirea serverului va reconcilia in_apel */ }
  }
  return { stare: 'necunoscut', cod: 'persistare_neconfirmata' }
}
/** Primește candidatul complet decodat de cititor; nu acordă încredere antetului h=. */
export async function potrivesteSent(m, candidati) {
  if (!Array.isArray(candidati) || candidati.length !== 1) return false
  const c = candidati[0]
  if (c.messageIds?.length !== 1 || c.messageIds[0] !== m.message_id || c.to?.length !== 1 || c.to[0] !== m.catre || c.cc?.length || c.bcc?.length || c.subjects?.length !== 1 || c.subjects[0] !== m.subiect_final) return false
  if (!Number.isFinite(c.internalDate) || c.internalDate < Date.parse(m.apel_inceput_la) - 300000 || !Number.isFinite(Date.parse(m.apel_inceput_la))) return false
  try { return await hashMesaj({ ...c.snapshot, id: m.id }) === m.mesaj_sha256 } catch { return false }
}
