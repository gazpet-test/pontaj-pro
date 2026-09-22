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
// CUM COMPARĂM. Întâi CONȚINUTUL, apoi, doar dacă nu se poate, datele.
//
// Pe 21.09.2026 concluzia era „nu se poate compara codul": `/functions/{slug}/body` întoarce
// bundle-ul eszip, iar `supabase functions download` scoate sursa trecută prin formatarea Deno
// (alte ghilimele, punct-și-virgulă adăugate, array-uri desfăcute) — deci 43 din 43 „diferite".
//
// Concluzia era prea largă. Management API are `?include_files=true`, care întoarce FIȘIERELE
// SURSĂ aşa cum au fost urcate, fără nicio transformare (verificat 22.09.2026 pe cinci funcții
// de ofertare: patru identice caracter cu caracter cu repo-ul, a cincea diferită pe bună
// dreptate). Deci comparăm textul, iar datele rămân doar plasă de siguranță.
//
// DE CE CONTEAZĂ: metoda pe date dădea alarme false. Cele opt funcții aduse în repo pe
// 12.09.2026 (PR #245) n-au fost atinse la aducere, dar commit-ul e mai nou decât deploy-ul,
// deci apăreau lună de lună ca „producția rulează cod vechi". Un semafor care minte de patru
// ori din cinci nu mai e citit nici când spune adevărul.
//
// CE NU PRINDE, spus pe față:
//   · dacă `include_files` nu răspunde, funcția aia cade pe comparația de date, cu toate
//     limitele ei — marcată explicit în ieșire, ca să se vadă că verdictul e mai slab;
//   · normalizăm DOAR CRLF → LF și liniile goale finale; un spațiu în plus la capăt de
//     linie rămâne o diferență raportată, pentru că altfel s-ar putea ascunde o diferență
//     reală dintr-un literal de text (verificat cu un contraexemplu, 22.09.2026);
//   · dacă cineva deployează de pe o copie locală cu modificări necomise, conținutul live
//     diferă de repo și apare corect ca nepublicat — asta metoda pe date NU o prindea.

import { readdir, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileP = promisify(execFile)

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'dxczwkbciseqniprspcu'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const DIR = 'supabase/functions'

// Toleranță: fluxul normal e „deployez, apoi comit", deci commit-ul cade cu un minut-două
// după deploy fără ca producția să fie în urmă. Sub prag nu e semnal. Peste — la Domnești
// decalajul real a fost de trei zile, deci pragul nu îneacă niciodată cazul care contează.
const TOLERANTA_MIN = Number(process.env.TOLERANTA_MIN || 120)

if (!TOKEN) {
  console.error('Lipsește SUPABASE_ACCESS_TOKEN (Settings → Secrets → Actions, sau `gh secret set` de pe laptop).')
  process.exit(2)
}

const data = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

// Normalizare minimă de tot: DOAR CRLF → LF și liniile goale de la finalul fișierului.
// Atât și nimic mai mult.
//
// Prima variantă tăia și spațiile de la capătul FIECĂREI linii. Jakarinos a arătat pe
// 22.09.2026 de ce e greșit: un literal care conține `"A \n B"` cu spațiu înainte de
// newline devine, după tăiere, identic cu `"A\nB"` — două programe DIFERITE ies „identice".
// Într-o verificare de siguranță, falsul negativ („nu e nicio diferență") e exact eroarea
// care nu trebuie făcută: ascunde tocmai cazul pentru care există verificarea.
// Spațiul la capăt de linie în cod mort e un fals pozitiv inofensiv — se rezolvă cu un deploy.
const normalizeaza = t => String(t).replace(/\r\n/g, '\n').replace(/\n+$/, '')

// Sursa publicată, aşa cum a fost urcată. Întoarce Map(nume → conținut) sau null dacă
// endpointul nu o dă (atunci funcția aia cade pe comparația de date).
async function sursaPublicata(slug) {
  try {
    const resp = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${slug}?include_files=true`,
      { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (!resp.ok) return null
    const j = await resp.json()
    if (!Array.isArray(j?.files) || !j.files.length) return null
    return new Map(j.files.map(f => [f.name, f.content]))
  } catch { return null }
}

async function fisiereleDinRepo(slug) {
  const dir = join(DIR, slug)
  const out = new Map()
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (!f.isFile() || !/\.(ts|js|json|jsonc)$/.test(f.name)) continue
    out.set(f.name, await readFile(join(dir, f.name), 'utf8'))
  }
  return out
}

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

const difera = [], laZi = [], niciodataPublicate = [], faraIstoric = []
const inRepo = new Set()

for (const d of (await readdir(DIR, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!d.isDirectory()) continue
  const slug = d.name
  inRepo.add(slug)
  const meta = publicate.get(slug)
  if (!meta) { niciodataPublicate.push(slug); continue }

  const rec = { slug, v: meta.version, deploy: Number(meta.updated_at) }

  // ── calea bună: comparăm sursa ──
  const live = await sursaPublicata(slug)
  if (live) {
    const local = await fisiereleDinRepo(slug)
    const nume = [...new Set([...local.keys(), ...live.keys()])].sort()
    const diferite = nume.filter(n => normalizeaza(local.get(n) ?? '\u0000lipsă') !== normalizeaza(live.get(n) ?? '\u0000lipsă'))
    rec.metoda = 'continut'
    if (diferite.length) {
      rec.fisiere = diferite
      // prima linie diferită din entrypoint, ca să se vadă imediat despre ce e vorba
      const n = diferite.includes('index.ts') ? 'index.ts' : diferite[0]
      const a = normalizeaza(local.get(n) ?? '').split('\n'), b = normalizeaza(live.get(n) ?? '').split('\n')
      const i = a.findIndex((l, k) => l !== b[k])
      rec.primaLinie = i >= 0 ? { nr: i + 1, repo: (a[i] ?? '(lipsă)').trim().slice(0, 90), live: (b[i] ?? '(lipsă)').trim().slice(0, 90) } : null
      difera.push(rec)
    } else laZi.push(rec)
    continue
  }

  // ── plasa de siguranță: datele, ca înainte ──
  const commit = await ultimaModificare(slug)
  if (!commit) { faraIstoric.push(slug); continue }
  rec.metoda = 'date'
  rec.commit = Date.parse(commit)
  rec.intarziereMin = Math.round((rec.commit - rec.deploy) / 60000)
  ;(rec.intarziereMin > TOLERANTA_MIN ? difera : laZi).push(rec)
}

const zile = m => m >= 1440 ? `${Math.round(m / 1440)} zile` : m >= 60 ? `${Math.round(m / 60)} ore` : `${m} min`

console.log(`\nEdge functions din ${DIR}, față de proiectul ${PROJECT_REF}\n`)
const peContinut = laZi.filter(x => x.metoda === 'continut').length + difera.filter(x => x.metoda === 'continut').length
const peDate = laZi.length + difera.length - peContinut
console.log(`✅ la zi: ${laZi.length}   ·   verificate pe conținut: ${peContinut}` +
  (peDate ? `, pe date: ${peDate} (toleranță ${TOLERANTA_MIN} min)` : ''))

// Funcțiile căzute pe metoda veche se NUMESC, nu doar se numără: altfel un „la zi" obținut
// cu verdictul slab arată identic cu unul obținut pe conținut. Semnalat de Jakarinos.
const caz = laZi.filter(x => x.metoda === 'date')
if (caz.length) {
  console.log(`\n⚠️  verdict pe DATE (sursa publicată nu a putut fi citită) — mai slab: ${caz.map(x => x.slug).join(', ')}`)
}

if (difera.length) {
  difera.sort((a, b) => a.slug.localeCompare(b.slug))
  console.log(`\n❌ PRODUCȚIA NU RULEAZĂ CE E ÎN REPO (${difera.length}):`)
  for (const x of difera) {
    if (x.metoda === 'continut') {
      console.log(`  ${x.slug.padEnd(32)} v${String(x.v).padEnd(4)} diferă: ${x.fisiere.join(', ')}`)
      if (x.primaLinie) {
        console.log(`      prima diferență, linia ${x.primaLinie.nr}:`)
        console.log(`        repo: ${x.primaLinie.repo}`)
        console.log(`        live: ${x.primaLinie.live}`)
      }
    } else {
      console.log(`  ${x.slug.padEnd(32)} v${String(x.v).padEnd(4)} commit ${data(x.commit)} · deploy ${data(x.deploy)} · în urmă cu ${zile(x.intarziereMin)}   ⚠️ verdict pe DATE (sursa publicată nu a putut fi citită)`)
    }
  }
  console.log(`\n   Deploy:  supabase functions deploy <slug> --project-ref ${PROJECT_REF}`)
  console.log('   Verifică ÎNTÂI ce cere funcția: dacă versiunea din repo citește un secret nou')
  console.log('   din Edge Secrets, deploy-ul fără secretul pus rupe apelantul (vezi ofertare-rfq-inbox).')
}
if (niciodataPublicate.length) {
  console.log(`\n⚠️  în repo dar nepublicate niciodată (${niciodataPublicate.length}): ${niciodataPublicate.join(', ')}`)
}
if (faraIstoric.length) {
  console.log(`\n⚠️  fără sursă publicată și fără istoric git (${faraIstoric.length}): ${faraIstoric.join(', ')}`)
}

// Cele ~90 de funcții publicate dar lipsă din repo sunt experimente și unelte tmp vechi.
// Doar numărul, ca să nu îngroape ce contează.
const doarLive = [...publicate.keys()].filter(s => !inRepo.has(s))
if (doarLive.length) console.log(`\nℹ️  publicate dar lipsă din repo: ${doarLive.length} (experimente și unelte tmp vechi)`)

process.exit(difera.length ? 1 : 0)
