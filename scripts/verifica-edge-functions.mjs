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
// ATENȚIE, două lecții plătite cu alarme false de 43/43 pe 21.09.2026:
//
// 1. Endpointul `/functions/{slug}/body` din Management API NU întoarce sursa, ci
//    bundle-ul deployat (eszip). Sursa se ia doar cu `supabase functions download`.
//
// 2. Nici sursa descărcată nu e identică pe text cu fișierul nostru: la deploy trece
//    prin formatarea Deno. Același cod ajunge cu punct-și-virgulă adăugate și array-uri
//    desfăcute pe linii — 61 de linii în repo, 95 la descărcare, cod identic.
//    De aceea trecem AMBELE părți prin `deno fmt` înainte să comparăm. Comparăm ce face
//    codul, nu cum e scris.
//
// A treia capcană, minoră: un checkout pe Windows adaugă \r la fiecare linie și schimbă
// sha256 fără să schimbe o virgulă. `deno fmt` o rezolvă și pe asta.

import { readFile, writeFile, readdir, mkdir, rm, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileP = promisify(execFile)

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'dxczwkbciseqniprspcu'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const DIR = 'supabase/functions'
const COPIE = '.verificare-repo'
const TEMP = '.verificare-temp'   // fișiere de lucru pentru `deno fmt`   // copia intactă a repo-ului, ca CLI-ul să poată scrie peste original

if (!TOKEN) {
  console.error('Lipsește SUPABASE_ACCESS_TOKEN (Settings → Secrets → Actions, sau `gh secret set` de pe laptop).')
  process.exit(2)
}

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12)

// Formatare canonică: singurul teren pe care sursa noastră și cea publicată sunt comparabile.
//
// Se scrie într-un fișier temporar și se formatează pe loc. NU prin stdin: `execFile` nu are
// opțiunea `input` (aia e la `execFileSync`), iar `deno fmt -` rămâne blocat așteptând date
// care nu vin niciodată. M-a costat o rulare de 14 minute care nu s-a terminat.
let nrFmt = 0
async function fmt(text) {
  const f = join(TEMP, `f${nrFmt++}.ts`)
  await writeFile(f, text, 'utf8')
  await execFileP('deno', ['fmt', '--quiet', f], { timeout: 60_000 })
  const out = await readFile(f, 'utf8')
  await rm(f, { force: true })
  return out.replace(/\s+$/, '')
}

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
await rm(TEMP, { recursive: true, force: true })
await mkdir(COPIE, { recursive: true })
await mkdir(TEMP, { recursive: true })
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
    const [a, b] = await Promise.all([fmt(sursa), fmt(await readFile(join(DIR, slug, 'index.ts'), 'utf8'))])
    const rec = { slug, v: meta.version, repo: sha(a), live: sha(b) }
    const egale = a === b
    // Diagnostic: la prima diferenta arata exact unde si ce, ca sa nu ghicim de ce difera.
    if (!egale && process.env.VERIFICA_DEBUG && !diferite.length) {
      const [ra, rb] = [a.split('\n'), b.split('\n')]
      const i = ra.findIndex((l, k) => l !== rb[k])
      console.log(`\n--- diagnostic ${slug}: repo ${ra.length} linii, live ${rb.length} linii, prima diferență la linia ${i + 1}`)
      for (let k = Math.max(0, i - 2); k < Math.min(Math.max(ra.length, rb.length), i + 4); k++) {
        console.log(`  repo[${k + 1}] ${JSON.stringify(ra[k] ?? '<lipsește>')}`)
        console.log(`  live[${k + 1}] ${JSON.stringify(rb[k] ?? '<lipsește>')}`)
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
