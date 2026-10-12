#!/usr/bin/env node
// Test taieLaPagina (Faza 0, 12.10.2026) — rulare: node --experimental-strip-types scripts/test_taie_pagina.mjs
import { taieLaPagina } from '../supabase/functions/ofertare-ingest-doc/taie_pagina.ts'
import assert from 'node:assert/strict'
const pagina = (n, len) => `⟦PAGINA ${n}⟧\n` + 'x'.repeat(len)
let ok = 0
const t = (nume, f) => { f(); ok++; console.log('  ✔', nume) }

t('sub limită: neatins', () => {
  const r = taieLaPagina(pagina(1, 50) + '\n' + pagina(2, 50), 1000)
  assert.equal(r.taiat, false); assert.deepEqual(r.paginiScoase, [])
})
t('taie la pagina întreagă: pagina care călărește limita iese cu toate următoarele', () => {
  const txt = [1, 2, 3, 4, 5].map((n) => pagina(n, 100)).join('\n')
  const lim = txt.indexOf('⟦PAGINA 4⟧') + 40            // pagina 4 începe înainte de limită dar nu încape
  const r = taieLaPagina(txt, lim, 8)
  assert.equal(r.taiat, true)
  assert.deepEqual(r.paginiScoase, [4, 5, 6, 7, 8])      // 6-8: citite în ultima felie dar fără text în șir -> ultimaPagina le acoperă
  assert.equal(r.primaScoasa, 4)
  assert.ok(r.text.length <= lim); assert.ok(r.text.endsWith('x')); assert.ok(!r.text.includes('⟦PAGINA 4⟧'))
  assert.ok(r.text.includes('⟦PAGINA 3⟧'))
})
t('limita exact la început de pagină: pagina aceea iese', () => {
  const txt = [1, 2, 3].map((n) => pagina(n, 100)).join('\n')
  const lim = txt.indexOf('⟦PAGINA 3⟧')
  const r = taieLaPagina(txt, lim, 3)
  assert.deepEqual(r.paginiScoase, [3]); assert.ok(!r.text.includes('⟦PAGINA 3⟧'))
})
t('marcaj-interval ⟦PAGINA 3-5⟧: toate paginile din interval ies', () => {
  const txt = pagina(1, 100) + '\n⟦PAGINA 2-4⟧\n' + 'y'.repeat(500)
  const r = taieLaPagina(txt, 200, 4)
  assert.deepEqual(r.paginiScoase, [2, 3, 4])
})
t('fără marcaje: tăiere simplă, nimic de raportat', () => {
  const r = taieLaPagina('z'.repeat(500), 100)
  assert.equal(r.text.length, 100); assert.deepEqual(r.paginiScoase, []); assert.equal(r.primaScoasa, null)
})
t('prima pagină singură depășește: se taie simplu, pagina marcată necitită', () => {
  const r = taieLaPagina(pagina(7, 900) + '\n' + pagina(8, 50), 300, 8)
  assert.equal(r.text.length, 300); assert.deepEqual(r.paginiScoase, [7]); assert.equal(r.primaScoasa, 7)
})
t('cazul real 769: ultima felie trece plafonul, nicio pagină nu dispare fără să fie raportată', () => {
  const MAX = 900_000, REZ = 300
  const baza = Array.from({ length: 300 }, (_, i) => pagina(i + 1, 2900)).join('\n')   // ~870k
  const felie = Array.from({ length: 60 }, (_, i) => pagina(301 + i, 2900)).join('\n')  // încă ~174k -> trece de plafon
  const r = taieLaPagina(baza + '\n' + felie, MAX - REZ, 360)
  assert.ok(r.text.length <= MAX - REZ)
  const pastrate = [...r.text.matchAll(/⟦PAGINA (\d+)⟧/g)].map((m) => Number(m[1]))
  const toate = [...new Set([...pastrate, ...r.paginiScoase])].sort((a, b) => a - b)
  assert.deepEqual(toate, Array.from({ length: 360 }, (_, i) => i + 1))              // acoperire completă: păstrate ∪ scoase = 1..360
  assert.equal(pastrate.filter((p) => r.paginiScoase.includes(p)).length, 0)         // disjuncte
  assert.equal(pastrate[pastrate.length - 1] + 1, r.primaScoasa)
})
console.log(`\n${ok} teste OK`)
