import { strict as assert } from 'node:assert'
import { recomandariValide, propunereValida, fazeValide } from './structuraExtrageri.ts'

Deno.test('recomandari: doar numele nu ajunge; rol null permis daca exista beneficiar/lucrare', () => {
  assert.equal(recomandariValide([{ nume_persoana: 'Ion Popescu' }]), false)
  assert.equal(recomandariValide([{ nume_persoana: 'Ion Popescu', rol: null, beneficiar: null, obiect_lucrare: null }]), false)
  assert.ok(recomandariValide([{ nume_persoana: 'Ion Popescu', rol: null, beneficiar: 'Distrigaz', obiect_lucrare: null }]))
  assert.equal(recomandariValide([{ nume_persoana: 'A', rol: 'RTE' }, { nume_persoana: ' ', rol: 'RTE' }]), false)
  assert.equal(recomandariValide([]), false)
})

Deno.test('propunere: chei omise = null; descrierea singura nu ajunge', () => {
  assert.ok(propunereValida({ este_autorizatie: false, incredere: 90, ce_este: 'adeverinta' }))
  assert.equal(propunereValida({ ce_este: 'autorizatie' }), false)
  assert.equal(propunereValida({ este_autorizatie: true, incredere: 90, ce_este: 'x', autorizatie_existenta_id: -1 }), false)
})

Deno.test('faze: lista goala doar cu absenta explicita', () => {
  assert.ok(fazeValide({ faze: [], are_faze_determinante: false }))
  assert.equal(fazeValide({ faze: [] }), false)
  assert.equal(fazeValide({ faze: [{ denumire: 'FD1' }, {}], are_faze_determinante: true }), false)
})
