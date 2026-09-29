import { createClient } from '@supabase/supabase-js'
import { incarcaLantProbator } from '../../src/ofertareLantProbatorDate.js'
import { compuneNouaVerigi, tabelText } from './lant.js'
import { pathToFileURL } from 'node:url'

export function clientDinEnv(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.AUDIT_ACCESS_TOKEN) throw new Error('Necesare SUPABASE_URL, SUPABASE_ANON_KEY și AUDIT_ACCESS_TOKEN (JWT utilizator) în env; nu le afișați.')
  // Audit read-only cu JWT-ul persoanei, nu cu service_role: RLS rămâne parte a probei.
  let payload
  try { payload = JSON.parse(Buffer.from(env.AUDIT_ACCESS_TOKEN.split('.')[1], 'base64url').toString()) } catch { throw new Error('JWT invalid') }
  if (payload.role !== 'authenticated') throw new Error('Verificatorul cere JWT authenticated')
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${env.AUDIT_ACCESS_TOKEN}` } } })
}
export async function citesteTabel(db, table, column, value, order = 'id') {
  const rows = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from(table).select('*').eq(column, value).order(order).range(offset, offset + 499)
    if (error) throw Object.assign(new Error(`${table}: ${error.code || 'citire eșuată'}`), { code: error.code })
    rows.push(...data)
    if (data.length < 500) return rows
  }
}
export async function citesteLicitatia(db, id) {
  const { data, error } = await db.from('ofertare_licitatii').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`ofertare_licitatii: ${error.code || 'eroare'}`)
  return data
}
export async function citesteDupaIds(db, table, column, ids) {
  const rows = []; const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select('*').in(column, unique.slice(i, i + 100)).order('id').range(offset, offset + 499)
      if (error) throw new Error(`${table}: ${error.code || 'citire eșuată'}`)
      rows.push(...data); if (data.length < 500) break
    }
  }
  return rows
}
export async function verificaLant(db, licId, ids) {
  const erori = {}; const shared = {}
  const safe = async (key, work, fallback) => {
    try { shared[key] = await work() } catch { erori[key] = 'Citire indisponibilă; nu înseamnă absență'; shared[key] = fallback }
  }
  await Promise.all([
    safe('licitatie', () => citesteLicitatia(db, licId), null),
    safe('manifest', () => citesteTabel(db, 'ofertare_seap_manifest', 'licitatie_id', licId), []),
    safe('anexe', () => citesteTabel(db, 'ofertare_pt_anexe_asteptate', 'licitatie_id', licId), []),
    safe('toateCerintele', () => citesteTabel(db, 'ofertare_cerinte', 'licitatie_id', licId), []),
  ])
  if (erori.toateCerintele) erori.istoric = erori.toateCerintele
  const rezultate = []; const randuri = []
  for (const id of ids) {
    const date = await incarcaLantProbator(db, licId, id)
    date.erori = { ...date.erori, ...erori }
    try { date.puncte = await citesteTabel(db, 'ofertare_clarificari_puncte', 'cerinta_id', id) }
    catch { date.erori.puncte = 'Citire indisponibilă' }
    // R17 selectează descrieri; completăm fișierele numai prin SELECT separat, fără embed-uri noi.
    for (const a of date.acoperiri) {
      for (const [key, table, field] of [['autorizatie', 'hr_autorizatii', 'autorizatie_id'], ['doc_firma', 'documente_firma', 'doc_firma_id'],
        ['studii', 'hr_documente_personale', 'document_personal_id'], ['recomandare', 'hr_recomandari', 'recomandare_id'], ['experienta', 'ofertare_experienta', 'experienta_id']]) {
        if (a[field] == null) continue
        try { a[key] = { ...a[key], ...(await citesteTabel(db, table, 'id', a[field]))[0] } }
        catch { date.erori.fisiereAcoperire = 'Citire fișier indisponibilă' }
      }
    }
    const input = { ...date, ...shared }; randuri.push(input); rezultate.push(compuneNouaVerigi(input))
  }
  return { licitatie_id: licId, citit_la: new Date().toISOString(), rezultate, randuri, erori }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [lic, ...ids] = process.argv.slice(2).map(Number)
    if (!Number.isSafeInteger(lic) || lic < 1 || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Utilizare: node verifica_lant.mjs LIC_ID CERINTA_ID ...')
    const r = await verificaLant(clientDinEnv(), lic, ids)
    console.log(JSON.stringify(r, null, 2)); console.error(tabelText(r.rezultate))
    if (r.randuri.some(d => Object.keys(d.erori).length)) process.exitCode = 2
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
