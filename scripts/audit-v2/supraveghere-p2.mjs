import { createHash } from 'node:crypto'
import { caleSandbox } from './siguranta.js'
import { incident } from './politica-p2.js'

export const canonical = v => JSON.stringify(normalize(v))
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])]))
  return v
}
export const hash = v => createHash('sha256').update(canonical(v)).digest('hex')
export async function verificaActor(db, actorId) {
  if (!actorId) throw new Error('fixture: actor_id fix lipsește')
  const { data, error } = await db.auth.getUser()
  if (error || data?.user?.id !== actorId) throw incident('BYPASS', 'permisiune: JWT nu aparține actorului fix')
  const profile = await db.from('profiles').select('id,is_owner').eq('id', actorId).maybeSingle()
  if (profile.error || !profile.data || typeof profile.data.is_owner !== 'boolean') throw new Error('permisiune: profiles.is_owner nu poate fi verificat cu JWT non-owner')
  if (profile.data.is_owner) throw Object.assign(new Error('permisiune: actor owner; identitatea nu se schimbă'), { verdict: 'BLOCKED_BY_ROLE' })
  return { id: actorId, is_owner: false }
}

// storage.objects se citește brut; list() singur nu dovedește identitatea obiectului.
export async function snapshotStorage(db) {
  const objects = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.schema('storage').from('objects').select('id,bucket_id,name,updated_at,metadata')
      .like('name', '103/%').order('id').range(offset, offset + 499)
    if (error) throw new Error(`permisiune: SELECT storage.objects sub 103/ refuzat (${error.code}); fără substituire prin list()`)
    for (const row of data) {
      caleSandbox(row.name)
      const etag = row.metadata?.eTag ?? row.metadata?.etag
      const size = row.metadata?.size
      if (!row.id || !row.updated_at || !etag || !Number.isSafeInteger(size)) throw new Error('artifact: storage.objects fără id/updated_at/eTag/size')
      const file = await db.storage.from(row.bucket_id).download(row.name)
      if (file.error) throw new Error(`permisiune: download Storage indisponibil pentru ${row.id}`)
      const bytes = Buffer.from(await file.data.arrayBuffer())
      if (bytes.length !== size) throw new Error(`stare: size Storage diferit la ${row.id}`)
      objects.push({ ...row, eTag: etag, size, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    if (data.length < 500) return objects
  }
}

// Providerul trebuie să observe TOATE tabelele și efectele triggerelor, inclusiv
// rânduri invizibile JWT-ului prin RLS. Nu pretindem că SELECT-urile locale fac asta.
// Endpointul server read-only nu este disponibil în această sarcină; fail closed.
export async function citesteSupraveghere(provider, actor) {
  if (!provider) throw new Error('endpoint: lipsește supravegherea completă BD/Storage (inclusiv alte licitații și efecte de trigger); NO-RUN live')
  const result = await provider({ actor_id: actor.id, licitatie_id: 103 })
  if (result?.complete !== true || result.actor_id !== actor.id || !result.inventory_id || !result.tables || !Array.isArray(result.storage))
    throw new Error('artifact: inventar BD/Storage incomplet sau actor diferit')
  if (result.guard?.active !== true || result.guard.licitatie_id !== 103 || result.guard.actor_id !== actor.id)
    throw new Error('endpoint: lipsește garda server activă pentru DB/Storage și efecte de trigger, actor fix, scope 103')
  for (const rows of [...Object.values(result.tables), result.storage]) {
    if (!Array.isArray(rows)) throw new Error('artifact: inventar fără rânduri complete')
    const ids = new Set()
    for (const row of rows) {
      if (row.id == null || !Number.isSafeInteger(row.licitatie_id) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('artifact: inventar fără id/scope/amprentă integrală de rând')
      if (ids.has(String(row.id))) throw new Error('artifact: identitate duplicată în inventar')
      ids.add(String(row.id))
    }
  }
  return result
}
function delta(a, b) {
  const old = new Map(a.map(r => [String(r.id), r])); const now = new Map(b.map(r => [String(r.id), r]))
  return { added: b.filter(r => !old.has(String(r.id))), removed: a.filter(r => !now.has(String(r.id))),
    updated: b.filter(r => old.has(String(r.id)) && canonical(old.get(String(r.id))) !== canonical(r)).map(r => ({ before: old.get(String(r.id)), after: r })) }
}
export function diffSnapshot(before, after) {
  const changes = {}
  for (const table of new Set([...Object.keys(before.tabele), ...Object.keys(after.tabele)])) {
    if (!before.tabele[table] || !after.tabele[table]) throw new Error(`artifact: SELECT absent pentru diff ${table}`)
    // View-urile agregate nu au id.
    changes[table] = delta(before.tabele[table].map((r, i) => ({ ...r, id: r.id ?? r.licitatie_id ?? i })), after.tabele[table].map((r, i) => ({ ...r, id: r.id ?? r.licitatie_id ?? i })))
  }
  const global = { tables: {}, storage: delta(before.supraveghere.storage, after.supraveghere.storage) }
  if (before.supraveghere.inventory_id !== after.supraveghere.inventory_id) throw new Error('artifact: inventarul supravegherii s-a schimbat')
  for (const table of new Set([...Object.keys(before.supraveghere.tables), ...Object.keys(after.supraveghere.tables)])) {
    if (!before.supraveghere.tables[table] || !after.supraveghere.tables[table]) throw new Error(`artifact: tabel absent din supraveghere ${table}`)
    global.tables[table] = delta(before.supraveghere.tables[table], after.supraveghere.tables[table])
  }
  return { tables: changes, storage: delta(before.storage, after.storage), global }
}
const affected = d => [...d.added, ...d.removed, ...d.updated.flatMap(r => [r.before, r.after])]
export function verificaDiff(diff, phase) {
  for (const d of [...Object.values(diff.global.tables), diff.global.storage])
    if (affected(d).some(r => r.licitatie_id !== 103)) throw incident('OUT_OF_SCOPE', 'Scriere observată în afara licitației 103')
  for (const [table, d] of [...Object.entries(diff.tables), ...Object.entries(diff.global.tables)])
    if (affected(d).length && !phase.expected_tables.includes(table)) throw incident('BYPASS', `Scriere neașteptată în ${table}`)
  for (const row of [...affected(diff.storage), ...affected(diff.global.storage)]) {
    try { caleSandbox(row.name) } catch { throw incident('OUT_OF_SCOPE', 'Obiect Storage în afara 103/') }
    if (!phase.expected_storage.includes(`${row.bucket_id}/${row.name}`)) throw incident('BYPASS', 'Scriere Storage neașteptată')
  }
}
export function postconditiiBrute(snapshot) {
  return { actor: snapshot.actor, R5: { select: snapshot.tabele.v_ofertare_cantitati_nevalidate,
    functie: 'public.ofertare_r5_blocaj_sursa(103)', verdict: 'UNDETERMINED',
    motiv: 'permisiune: funcția SQL nu este apelată prin clientul SELECT-only; Claude verifică separat SQL admin read-only',
    rezultat_claude: null, artifact_claude: null },
  R12: snapshot.tabele.v_ofertare_seap_completitudine, J05: snapshot.tabele.ofertare_derogari_audit }
}
