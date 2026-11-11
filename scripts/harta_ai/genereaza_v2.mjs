#!/usr/bin/env node
// Harta AI — generează varianta standalone (un singur HTML, cu JSON-ul inclus) din harta.json.
// Folosire:  node scripts/harta_ai/genereaza_v2.mjs <harta.json> <iesire.html>
// Datele NU stau în repo (repo public): harta.json se ține într-un folder privat, în afara repo-ului.
// Refuză generarea dacă validarea găsește erori — inclusiv orice șir care arată a valoare de secret, telefon sau CNP.
// Fără librării noi: esbuild vine deja cu vite (devDependency existentă).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { valideazaHarta } from '../../src/hartaAILogica.js'
import { construiesteHtml } from './html.mjs'

const [intrare, iesire] = process.argv.slice(2)
if (!intrare || !iesire) {
  console.error('Folosire: node scripts/harta_ai/genereaza_v2.mjs <harta.json> <iesire.html>')
  process.exit(2)
}
const aici = dirname(fileURLToPath(import.meta.url))
const radacina = resolve(aici, '..', '..')

let date
try {
  date = JSON.parse(readFileSync(intrare, 'utf8').replace(/^﻿/, ''))
} catch (e) {
  console.error(`EROARE: ${intrare} nu e JSON valid: ${e.message}`)
  process.exit(1)
}
const { erori, avertismente } = valideazaHarta(date)
for (const a of avertismente) console.warn(`avertisment: ${a}`)
if (erori.length) {
  for (const e of erori) console.error(`eroare: ${e}`)
  console.error(`EROARE: ${erori.length} erori, nu generez.`)
  process.exit(1)
}

const rez = await build({
  entryPoints: [resolve(aici, 'standalone.jsx')],
  absWorkingDir: radacina,
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
})
const cod = rez.outputFiles[0].text
writeFileSync(iesire, construiesteHtml(date, cod), 'utf8')
const n = Array.isArray(date.noduri) ? date.noduri.length : 0
const l = Array.isArray(date.legaturi) ? date.legaturi.length : 0
console.log(`GATA: ${iesire} (${n} noduri, ${l} legături, ${avertismente.length} avertismente, ${(cod.length / 1024).toFixed(0)} KB cod)`)
