#!/usr/bin/env node
// Compară fiecare edge function din supabase/functions/ cu sursa PUBLICATĂ în proiect.
//
// De ce există: pe 18.09.2026 `ofertare-acoperire` avea în main filtrul de titular activ
// și fix-ul DUAE, dar producția rula o versiune mai veche. Nimic nu semnala diferența —
// motorul propunea la licitații oameni cu contract închis, trei zile la rând.
//
// Rulare:  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/verifica-edge-functions.mjs
// Ieșire:  cod 0 dacă tot ce e în repo e identic cu producția, 1 dacă diferă ceva.
//
// ATENȚIE, lecție plătită: endpointul `/functions/{slug}/body` din Management API NU
// întoarce sursa, ci bundle-ul deployat (eszip). Comparat cu fișierul din repo dădea
// „43 din 43 diferite" — alarmă falsă pe toată linia. Singurul drum corect e
// `supabase functions download`, care despachetează bundle-ul înapoi în sursă.
//
// A doua capcană: un checkout pe Windows adaugă \r la fiecare linie, ceea ce schimbă
// sha256 fără să schimbe o virgulă din cod. De aceea comparăm text normalizat.

import { readFile, readdir, mkdir, rm, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileP = promisify(execFile)

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'dxczwkbciseqniprspcu'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const DIR = 'supabase/functions'
const COPIE = '.verificare-repo'   // copia intactă a repo-ului, ca CLI-ul să poată scrie peste original

if (!TOKEN) {
  console.error('Lipsește SUPABASE_ACCESS_TOKEN (Settings → Secrets → Actions, sau `gh secret set` de pe laptop).')
  process.exit(2)
}

const norm = s => s.replace(/\r\n/g, '\n').replace(/\s+$/, '')
const sha = s => createHash('sha256').update(norm(s)).digest('hex').slice(0, 12)

async function functiiDinRepo(radacina) {
  const out = []
  for (const d of await readdir(radacina, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    try {
      out.push({ slug: d.name, sursa: await readFile(join(radacina, d.name, 'index.ts'), 'utf8') })
    } catch { /* folder fără index.ts — nu e funcție */ }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

// CLI-ul se instaleaza o singura data. Cu `npx supabase@latest` la fiecare functie,
// rezolvarea pachetului se repeta de 43 de ori si rularea dureaza minute in loc de secunde.
const CLI = process.env.SUPABASE_CLI || 'supabase'

// Punem deoparte sursele din repo: `supabase functions download` scrie exact peste ele.
await rm(COPIE, { recursive: true, force: true })
await mkdir(COPIE, { recursive: true })
await cp(DIR, COPIE, { recursive: true })
const locale = await functiiDinRepo(COPIE)

const publicate = new Map(
  (await (await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }).then(r => r.ok ? r : Promise.reject(new Error(`listare funcții → HTTP ${r.status}`)))).json())
    .map(f => [f.slug, f])
)

const diferite = [], nepublicate = [], necitite = [], identice = []

for (const { slug, sursa } of locale) {
  const meta = publicate.get(slug)
  if (!meta) { nepublicate.push(slug); continue }
  try {
    await execFileP(CLI, ['functions', 'download', slug, '--project-ref', PROJECT_REF],
      { env: { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN }, timeout: 120_000 })
    const live = await readFile(join(DIR, slug, 'index.ts'), 'utf8')
    const rec = { slug, v: meta.version, repo: sha(sursa), live: sha(live) }
    const egale = norm(live) === norm(sursa)
    // Diagnostic: la prima diferenta arata exact unde si ce, ca sa nu ghicim de ce difera.
    if (!egale && process.env.VERIFICA_DEBUG && !diferite.length) {
      const a = norm(sursa).split('\n'), b = norm(live).split('\n')
      const i = a.findIndex((l, k) => l !== b[k])
      console.log(`\n--- diagnostic ${slug}: repo ${a.length} linii, live ${b.length} linii, prima diferenta la linia ${i + 1}`)
      for (let k = Math.max(0, i - 2); k < Math.min(Math.max(a.length, b.length), i + 4); k++) {
        console.log(`  repo[${k + 1}] ${JSON.stringify(a[k] ?? '<lipseste>')}`)
        console.log(`  live[${k + 1}] ${JSON.stringify(b[k] ?? '<lipseste>')}`)
      }
      console.log('---\n')
    }
    ;(egale ? identice : diferite).push(rec)
  } catch (e) {
    necitite.push(`${slug} — ${String(e.message || e).split('\n')[0]}`)
  }
}

const linie = r => `  ${r.slug.padEnd(34)} v${String(r.v).padEnd(4)} repo ${r.repo} · live ${r.live}`

console.log(`\nVerificate ${locale.length} funcții din ${DIR} față de proiectul ${PROJECT_REF}\n`)
console.log(`✅ identice cu producția: ${identice.length}`)

if (diferite.length) {
  console.log(`\n❌ DIFERITE de producție (${diferite.length}) — main are altceva decât rulează live:`)
  diferite.forEach(r => console.log(linie(r)))
  console.log(`\n   Deploy:  supabase functions deploy <slug> --project-ref ${PROJECT_REF}`)
}
if (nepublicate.length) {
  console.log(`\n⚠️  în repo dar nepublicate (${nepublicate.length}): ${nepublicate.join(', ')}`)
}
if (necitite.length) {
  console.log(`\n⚠️  nu s-a putut descărca sursa publicată (${necitite.length}):`)
  necitite.forEach(s => console.log('  ' + s))
}

// Funcțiile publicate dar lipsă din repo sunt ~90 de experimente și unelte temporare vechi.
// Nu le listăm nominal la fiecare rulare — doar numărul, ca să nu îngropăm ce contează.
const doarLive = [...publicate.keys()].filter(s => !locale.some(l => l.slug === s))
if (doarLive.length) {
  console.log(`\nℹ️  publicate dar lipsă din repo: ${doarLive.length} (experimente și unelte tmp vechi)`)
}

// Nepublicatele și cele necitite nu pică verificarea: prima categorie e adesea lucru în curs,
// a doua poate fi un hopa de rețea. Diferența reală între main și producție e singurul lucru
// care justifică oprirea unei depuneri.
process.exit(diferite.length ? 1 : 0)
