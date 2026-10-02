import assert from 'node:assert/strict'
import { retete, PARAMETRI_EXEMPLU } from './retete.js'
const gol = { licitatie_id: null, cerinte: { D1: null, D6: null, D8: null } }
const original = JSON.stringify(gol)
const r = retete(gol)
assert.equal(JSON.stringify(gol), original)
assert.ok(r.retete_neconfigurate.length > 40)
assert.ok(Object.values(r.scenarii).every(s => Object.values(s.faze).every(p => !p.actiuni.length)))
assert.ok(Object.values(PARAMETRI_EXEMPLU).every(p => Object.values(p).every(v => v === null)))
const fixture = { licitatie_id: 103, nr_anunt: 'SANDBOX-V2-TEST', cerinte: {}, retete: {
  '10_pachet/aprobare': { selector: 'text=🔏 Aprobă pachetul' },
} }
const p = retete(fixture).scenarii['10_pachet'].faze.aprobare
assert.equal(p.verdict_succes, 'UI_ONLY')
assert.equal(p.actiuni[0].tip, 'observa')
assert.equal(p.cost_ai, false)
assert.equal(retete({ ...fixture, licitatie_id: 5 }).scenarii['10_pachet'].faze.aprobare.actiuni.length, 0)
console.log('retete: 8 aserțiuni locale trecute, fără browser/BD')
