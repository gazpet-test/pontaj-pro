#!/usr/bin/env node
// Poarta pe cheltuială (20261124a): o SINGURĂ regulă, în SQL (fn_ofertare_poate_cheltui), apelată prin _shared/poartaCheltuiala.ts.
// (Până la #908 erau două copii poarta.ts identice; deploy-ul prin workflow împachetează ../_shared, deci copiile au fost scoase.)
// Verifică: (1) copiile vechi nu reapar; (2) fiecare funcție cu poartă pe cheltuială importă helperul comun; (3) nicio funcție ofertare-*
// nu mai compară de mână responsabil_id cu apelantul (regula veche, fără responsabil 2 și fără „numit de”).
// Rulare: node scripts/verifica-poarta-identica.mjs  (cod 1 la orice abatere)
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const F = 'supabase/functions'
const CU_POARTA = ['ofertare-acoperire', 'ofertare-cerinte', 'ofertare-clarificari-propune', 'ofertare-clauze-formulare', 'ofertare-genereaza-capitol',
  'ofertare-ingest-doc', 'ofertare-organigrama-spec', 'ofertare-rfq-import', 'ofertare-cantitati-extrage', 'ofertare-plansa-citeste', 'ofertare-document-nou-citeste']
const MANUAL = /responsabil_id\s*===|===\s*\w+\??\.responsabil_id|responsabilId\s*===/
let rau = 0
const eroare = (m) => { console.error('❌ ' + m); rau++ }

for (const d of ['ofertare-plansa-citeste', 'ofertare-cantitati-extrage']) if (existsSync(join(F, d, 'poarta.ts'))) eroare(`${d}/poarta.ts a reapărut — folosește _shared/poartaCheltuiala.ts`)
const tsDin = (d) => readdirSync(join(F, d)).filter((f) => f.endsWith('.ts') && !f.endsWith('_test.ts')).map((f) => join(F, d, f))
for (const d of CU_POARTA) {
  if (!tsDin(d).some((p) => readFileSync(p, 'utf8').includes("from '../_shared/poartaCheltuiala.ts'"))) eroare(`${d} nu importă _shared/poartaCheltuiala.ts`)
}
for (const d of readdirSync(F).filter((x) => x.startsWith('ofertare-'))) {
  for (const p of tsDin(d)) {
    readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (MANUAL.test(l) && !l.trim().startsWith('//')) eroare(`${p}:${i + 1} compară de mână responsabilul: ${l.trim().slice(0, 120)}`) })
  }
}
// (4) #908 r4 (review r3 Jakarinos P1-01): nicio funcție cu poartă nu mai lasă cheia de serviciu / un secret tehnic să cheltuie „liber”
const SERVICIU_LIBER = /service_role'\)\s*return null|SERVICE_ROLE_KEY'\)\s*\|\|\s*rol\s*===\s*'service_role'\)\s*return null|fn_verifica_radar_secret/
for (const d of CU_POARTA) {
  for (const p of tsDin(d)) {
    readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (SERVICIU_LIBER.test(l) && !l.trim().startsWith('//')) eroare(`${p}:${i + 1} cale de serviciu fără poartă: ${l.trim().slice(0, 120)}`) })
  }
}
// planșe: prin HTTP cheia de serviciu nu e valabilă (handler-ul primește SERVICE = ''); workerul NAS cheamă handler-ul în proces, cu poarta
if (!/handler\(req, \{ \.\.\.depsReale\(\), SERVICE: '' \}\)/.test(readFileSync(join(F, 'ofertare-plansa-citeste', 'index.ts'), 'utf8')))
  eroare('ofertare-plansa-citeste/index.ts nu mai golește SERVICE pentru apelurile HTTP')
if (!readFileSync('worker/ofertare/plansa.ts', 'utf8').includes("from '../../supabase/functions/_shared/poartaCheltuiala.ts'")) eroare('worker/ofertare/plansa.ts nu mai întreabă poarta pe cheltuială')
if (rau) process.exit(1)
console.log(`✅ poarta unică pe cheltuială: ${CU_POARTA.length} funcții pe _shared/poartaCheltuiala.ts, nicio comparație manuală`)
