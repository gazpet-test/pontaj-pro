#!/usr/bin/env node
// Spune ce edge functions au fost modificate în repo DUPĂ ultimul lor deploy.
//
// De ce există: pe 18.09.2026 `ofertare-acoperire` avea în main filtrul de titular activ și
// fix-ul DUAE, dar producția rula o versiune mai veche. Trei zile motorul a propus la licitații
// oameni cu contract închis, fără ca nimic să semnaleze diferența.
//
// Rulare:  SUPABASE_ACCESS_TOKEN=sbp_... node scripts/verifica-edge-functions.mjs
// Ieșire:  cod 1 dacă vreo funcție are modificări nepublicate, 0 altfel.
//
// DE CE NU COMPARĂM CODUL. Patru încercări pe 21.09.2026, toate cu „43 din 43 diferite":
//   1. `/functions/{slug}/body` din Management API întoarce bundle-ul eszip, nu sursa.
//   2. `supabase functions download` despachetează bundle-ul, dar sursa iese trecută prin
//      formatarea Deno: alte ghilimele, punct-și-virgulă adăugate, array-uri desfăcute.
//   3. `deno fmt` pe ambele părți aliniază ghilimelele și punctul-și-virgula, dar NU și
//      array-urile: formatarea păstrează desfacerea scrisă de autor și adaugă virgulă la final.
//      Nu există o formă canonică la care să ajungă ambele.
//   4. Concluzia: transformarea de la deploy nu e reversibilă la un text comparabil.
//
// Data commit-ului față de data deploy-ului răspunde exact la întrebarea care ne interesa —
// „s-a publicat ce e în main?" — fără niciun artefact de formatare, dintr-o singură cerere.
//
// CE NU PRINDE, spus pe față:
//   · o modificare doar de comentariu apare ca „nepublicată" (fals pozitiv, inofensiv);
//   · dacă cineva deployează de pe o copie locală cu modificări necomise, aici pare la zi.
// Pentru amândouă, semnalul rămâne util: spune unde să te uiți, nu ce să crezi.

import { readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileP = promisify(execFile)

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'dxczwkbciseqniprspcu'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const DIR = 'supabase/functions'

if (!TOKEN) {
  console.error('Lipsește SUPABASE_ACCESS_TOKEN (Settings → Secrets → Actions, sau `gh secret set` de pe laptop).')
  process.exit(2)
}

const data = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

// Data ultimei modificări din git a fișierului funcției. NU ora fișierului de pe disc:
// checkout-ul din CI le pune pe toate la ora clonării.
async function ultimaModificare(slug) {
  const { stdout } = await execFileP('git',
    ['log', '-1', '--format=%cI', '--', join(DIR, slug, 'index.ts')], { maxBuffer: 1 << 20 })
  return stdout.trim() || null
}

const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})
if (!r.ok) {
  console.error(`Nu pot lista funcțiile publicate: HTTP ${r.status} ${await r.text().catch(() => '')}`)
  process.exit(2)
}
const publicate = new Map((await r.json()).map(f => [f.slug, f]))

const nepublicate = [], laZi = [], niciodataPublicate = [], faraIstoric = []
const inRepo = new Set()

for (const d of (await readdir(DIR, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!d.isDirectory()) continue
  const slug = d.name
  inRepo.add(slug)
  const meta = publicate.get(slug)
  if (!meta) { niciodataPublicate.push(slug); continue }
  const commit = await ultimaModificare(slug)
  if (!commit) { faraIstoric.push(slug); continue }
  const rec = { slug, v: meta.version, commit: Date.parse(commit), deploy: Number(meta.updated_at) }
  ;(rec.commit > rec.deploy ? nepublicate : laZi).push(rec)
}

const linie = x => `  ${x.slug.padEnd(32)} v${String(x.v).padEnd(4)} commit ${data(x.commit)} · deploy ${data(x.deploy)}`

console.log(`\nEdge functions din ${DIR}, față de proiectul ${PROJECT_REF}\n`)
console.log(`✅ publicate după ultima modificare: ${laZi.length}`)

if (nepublicate.length) {
  nepublicate.sort((a, b) => a.commit - b.commit)
  console.log(`\n❌ MODIFICATE ÎN REPO DUPĂ ULTIMUL DEPLOY (${nepublicate.length}) — producția rulează cod vechi:`)
  nepublicate.forEach(x => console.log(linie(x)))
  console.log(`\n   Deploy:  supabase functions deploy <slug> --project-ref ${PROJECT_REF}`)
  console.log('   Dacă modificarea era doar un comentariu, un deploy o liniștește oricum.')
}
if (niciodataPublicate.length) {
  console.log(`\n⚠️  în repo dar nepublicate niciodată (${niciodataPublicate.length}): ${niciodataPublicate.join(', ')}`)
}
if (faraIstoric.length) {
  console.log(`\n⚠️  fără istoric git (${faraIstoric.length}): ${faraIstoric.join(', ')} — clonă superficială?`)
}

// Cele ~90 de funcții publicate dar lipsă din repo sunt experimente și unelte tmp vechi.
// Doar numărul, ca să nu îngroape ce contează.
const doarLive = [...publicate.keys()].filter(s => !inRepo.has(s))
if (doarLive.length) console.log(`\nℹ️  publicate dar lipsă din repo: ${doarLive.length} (experimente și unelte tmp vechi)`)

process.exit(nepublicate.length ? 1 : 0)
