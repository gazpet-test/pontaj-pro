#!/usr/bin/env node
// Compară fiecare edge function din supabase/functions/ cu ce e PUBLICAT în proiect.
//
// De ce există: pe 18.09.2026 `ofertare-acoperire` avea în main filtrul de titular activ
// și fix-ul DUAE, dar producția rula o versiune mai veche. Nimic nu semnala diferența —
// motorul propunea la licitații oameni cu contract închis, trei zile la rând.
//
// Rulare:  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/verifica-edge-functions.mjs
// Ieșire:  cod 0 dacă tot ce e în repo e identic cu producția, 1 dacă diferă ceva.
//
// Atenție la CRLF: un checkout pe Windows adaugă \r la fiecare linie, ceea ce schimbă
// sha256 fără să schimbe o virgulă din cod. De aceea comparăm text normalizat.

import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'dxczwkbciseqniprspcu'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const DIR = 'supabase/functions'
const API = 'https://api.supabase.com/v1'

if (!TOKEN) {
  console.error('Lipsește SUPABASE_ACCESS_TOKEN. Pe laptop: supabase login, apoi ia tokenul din ~/.supabase.')
  process.exit(2)
}

const norm = s => s.replace(/\r\n/g, '\n').replace(/\s+$/, '')
const sha = s => createHash('sha256').update(norm(s)).digest('hex').slice(0, 12)

async function api(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} ${await r.text().catch(() => '')}`)
  return r
}

// Funcțiile din repo: un folder cu index.ts = o funcție.
const locale = []
for (const d of await readdir(DIR, { withFileTypes: true })) {
  if (!d.isDirectory()) continue
  try {
    locale.push({ slug: d.name, sursa: await readFile(join(DIR, d.name, 'index.ts'), 'utf8') })
  } catch { /* folder fără index.ts — nu e funcție */ }
}

const publicate = new Map(
  (await (await api(`/projects/${PROJECT_REF}/functions`)).json()).map(f => [f.slug, f])
)

const diferite = [], nepublicate = [], necitite = [], identice = []

for (const { slug, sursa } of locale.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const meta = publicate.get(slug)
  if (!meta) { nepublicate.push(slug); continue }
  let live
  try {
    live = await (await api(`/projects/${PROJECT_REF}/functions/${slug}/body`)).text()
  } catch (e) {
    necitite.push(`${slug} — ${e.message}`)
    continue
  }
  const rec = { slug, v: meta.version, repo: sha(sursa), live: sha(live) }
  ;(norm(live) === norm(sursa) ? identice : diferite).push(rec)
}

const linie = r => `  ${r.slug.padEnd(34)} v${String(r.v).padEnd(4)} repo ${r.repo} · live ${r.live}`

console.log(`\nVerificate ${locale.length} funcții din ${DIR} față de proiectul ${PROJECT_REF}\n`)
console.log(`✅ identice cu producția: ${identice.length}`)

if (diferite.length) {
  console.log(`\n❌ DIFERITE de producție (${diferite.length}) — main are altceva decât rulează live:`)
  diferite.forEach(r => console.log(linie(r)))
  console.log('\n   Deploy:  supabase functions deploy <slug> --project-ref ' + PROJECT_REF)
}
if (nepublicate.length) {
  console.log(`\n⚠️  în repo dar nepublicate (${nepublicate.length}): ${nepublicate.join(', ')}`)
}
if (necitite.length) {
  console.log(`\n⚠️  nu s-a putut citi sursa publicată (${necitite.length}):`)
  necitite.forEach(s => console.log('  ' + s))
}

const doarLive = [...publicate.keys()].filter(s => !locale.some(l => l.slug === s))
if (doarLive.length) {
  console.log(`\nℹ️  publicate dar lipsă din repo (${doarLive.length}): ${doarLive.join(', ')}`)
}

// Nepublicatele și cele necitite nu pică verificarea: prima categorie e adesea lucru în curs,
// a doua poate fi un hopa de API. Diferența reală între main și producție e singurul lucru
// care justifică oprirea unei depuneri.
process.exit(diferite.length ? 1 : 0)
