import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const MAX = 2 * 1024 * 1024
export function mascheaza(value) {
  if (Array.isArray(value)) return value.map(mascheaza)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, /authorization|password|access_token|refresh_token|anon_key|service_role|secret/i.test(k) ? '[MASCAT]' : mascheaza(v)]))
  if (typeof value === 'string') return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [MASCAT]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT MASCAT]')
    .replace(/([?&](?:token|apikey|key|signature)=)[^&#\s]+/gi, '$1[MASCAT]')
  return value
}
// JSON mare = fragmente de octeți reconstituibile + index cu hash. Nu trunchiem rânduri.
export async function salveazaJson(dir, name, value) {
  await mkdir(dir, { recursive: true })
  const bytes = Buffer.from(JSON.stringify(mascheaza(value), null, 2))
  if (bytes.length <= MAX) { await writeFile(join(dir, `${name}.json`), bytes); return }
  const parts = []
  for (let i = 0; i < bytes.length; i += MAX) {
    const file = `${name}.${String(parts.length + 1).padStart(4, '0')}.part`
    await writeFile(join(dir, file), bytes.subarray(i, i + MAX)); parts.push(file)
  }
  await writeFile(join(dir, `${name}.index.json`), JSON.stringify({ encoding: 'utf8', concatenate_bytes: parts,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2))
}
export async function incarcaJson(dir, name) {
  try { return JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')) }
  catch (e) { if (e.code !== 'ENOENT') throw e }
  const index = JSON.parse(await readFile(join(dir, `${name}.index.json`), 'utf8'))
  if (index.concatenate_bytes.some(p => /[\\/]/.test(p))) throw new Error('Index de dovezi invalid')
  const bytes = Buffer.concat(await Promise.all(index.concatenate_bytes.map(p => readFile(join(dir, p)))))
  if (createHash('sha256').update(bytes).digest('hex') !== index.sha256) throw new Error('Hash dovezi diferit')
  return JSON.parse(bytes.toString('utf8'))
}
