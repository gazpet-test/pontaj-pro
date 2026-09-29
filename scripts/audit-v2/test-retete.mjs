import assert from 'node:assert/strict'
import { retete, PARAMETRI_EXEMPLU } from './retete.js'

const gol = { licitatie_id: null, cerinte: { D1: null, D6: null, D8: null } }
const original = JSON.stringify(gol)
const r0 = retete(gol)
assert.equal(JSON.stringify(gol), original, 'generatorul nu modifică fixture-ul apelantului')
assert.ok(r0.retete_neconfigurate.length > 40)
assert.ok(Object.values(r0.scenarii).every(s => Object.values(s.faze).every(p => !p.actiuni.length)))
assert.ok(Object.values(PARAMETRI_EXEMPLU).every(p => Object.values(p).every(v => v === null)))

const f = { licitatie_id: 103, nr_anunt: 'SANDBOX-V2-TEST', cerinte: { D1: 101, D6: 102, D8: 103 },
  retete: { '11_depunere/fara_dovada_SEAP': { pachet_id: 50, fisiere_finale: ['/tmp/final.pdf'],
    finale_selector: 'css=input[type="file"][multiple]', depune_selector: 'text=Înregistrează depunerea' } } }
const r = retete(f)
const p = r.scenarii['11_depunere'].faze.fara_dovada_SEAP
assert.equal(p.actiuni[1].tip, 'observa')
assert.equal(p.actiuni[1].asteptat.disabled, true)
assert.equal(p.postconditii[1].where.pachet_id, 50)
assert.equal(p.postconditii[1].valoare, 0)
assert.equal(r.scenarii['11_depunere'].preconditii[0].where.id, 103)
assert.ok(r.scenarii['11_depunere'].faze.derogare_non_owner.motiv_indisponibil.includes('Nu există control UI'))

const personalizat = { actiuni: [{ tip: 'asteapta', selector: 'text=probă' }], postconditii: [{ tip: 'count', tabela: 'ofertare_cerinte', valoare: 0 }] }
f.scenarii = { '03_cerinte': { preconditii: [], faze: { extragere: personalizat } } }
assert.deepEqual(retete(f).scenarii['03_cerinte'].faze.extragere, personalizat)
assert.equal(retete({ ...f, licitatie_id: 5 }).scenarii['11_depunere'].faze.fara_dovada_SEAP.actiuni.length, 0)
console.log('retete: 12 aserțiuni locale trecute, fără browser/BD')
