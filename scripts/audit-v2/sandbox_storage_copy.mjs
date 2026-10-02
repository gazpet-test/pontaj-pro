import { clientDinEnv } from './verifica_lant.mjs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { caleSandbox, verificaSandbox } from './siguranta.js'
import { citesteLicitatia } from './verifica_lant.mjs'
import { salveazaJson } from './dovezi.mjs'

export function verificaPerechi(pairs, fixture = { licitatie_id: 103 }) {
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Lista de perechi este goală')
  const paths = new Set()
  for (const p of pairs) {
    caleSandbox(p.cale_noua, fixture)
    if (typeof p.cale_veche !== 'string' || !p.cale_veche.startsWith('5/') || /\\|%|[?#]|(^|\/)\.\.?($|\/)/.test(p.cale_veche)
      || p.cale_noua !== `${fixture.licitatie_id}/${p.cale_veche.slice(2)}`) throw new Error('Pereche invalidă: doar 5/... → 103/...')
    if (paths.has(p.cale_noua)) throw new Error('Destinație duplicată')
    paths.add(p.cale_noua)
  }
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function copiazaStorage(db, pairs, fixture, save) {
  verificaPerechi(pairs, fixture)
  verificaSandbox(await citesteLicitatia(db, fixture.licitatie_id), fixture)
  const bucket = db.storage.from('ofertare'); const manifest = []
  for (const p of pairs) {
    // Hashul sursei se citește înainte de copy; o schimbare concurentă nu produce MATCH fals.
    const original = await bucket.download(p.cale_veche)
    if (original.error) throw new Error('Nu se poate citi obiectul sursă')
    const sourceBytes = Buffer.from(await original.data.arrayBuffer())
    const row = { ...p, sursa_sha256: digest(sourceBytes), bytes: sourceBytes.length, stare: 'inceput', la: new Date().toISOString() }
    manifest.push(row); await save(manifest)
    const copied = await bucket.copy(p.cale_veche, p.cale_noua)
    if (copied.error) { row.stare = 'copy_refuzat'; await save(manifest); throw new Error('Copy refuzat; destinația existentă nu se suprascrie') }
    row.stare = 'copiat'; await save(manifest)
    const back = await bucket.download(p.cale_noua)
    if (back.error) { row.stare = 'readback_esuat'; await save(manifest); throw new Error('Read-back eșuat') }
    const bytes = Buffer.from(await back.data.arrayBuffer()); row.sha256 = digest(bytes)
    row.stare = row.sha256 === row.sursa_sha256 && bytes.length === row.bytes ? 'identic' : 'diferit'
    await save(manifest)
    if (row.stare !== 'identic') throw new Error('SHA-256 sursă/destinație diferit; oprire fără ștergeri automate')
  }
  return manifest
}
async function main() {
  const args = process.argv.slice(2)
  const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback
  const pairsFile = option('--pairs', null)
  if (!pairsFile) throw new Error('Utilizare: --pairs perechi.json [--fixture fixture.json] [--apply] [--out manifest.json]')
  const pairs = JSON.parse(await readFile(pairsFile, 'utf8')); verificaPerechi(pairs)
  if (!args.includes('--apply') || args.includes('--dry-run')) { console.log(JSON.stringify({ mod: 'dry-run', bucket: 'ofertare', pairs }, null, 2)); return }
  const fixture = JSON.parse(await readFile(option('--fixture', 'scripts/audit-v2/fixture.json'), 'utf8'))
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) throw new Error('SUPABASE_URL și SUPABASE_KEY necesare în env')
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const out = option('--out', 'docs/AUDIT_OFERTARE_V2/dovezi/storage/manifest.json')
  await copiazaStorage(db, pairs, fixture, rows => salveazaJson(dirname(out), basename(out, '.json'), rows))
  console.log('Copiere terminată; manifestul local conține hashurile sursei și destinației.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
