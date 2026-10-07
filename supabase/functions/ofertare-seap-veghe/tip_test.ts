// deno test supabase/functions/ofertare-seap-veghe/tip_test.ts — tipul documentelor aduse de veghe (audit #12 + review PR-C)
import { strict as assert } from 'node:assert'
import { tipRaspuns } from './tip.ts'

Deno.test('anti-bug Răcari: caietul revizuit moștenește tipul, oricare ar fi titlul canalului', () => {
  assert.equal(tipRaspuns('Caiet de sarcini.pdf', 'cs_volum', true), 'cs_volum')
  assert.equal(tipRaspuns('Lista cantitati.xlsx', 'lista_cantitati', true), 'lista_cantitati')
})

Deno.test('#12: document nou (fără înlocuit) ia tipul din numele fișierului, nu din canal', () => {
  assert.equal(tipRaspuns('Caiet de sarcini revizuit.pdf', undefined, true), 'cs_volum')
  assert.equal(tipRaspuns('Fisa de date.pdf', null, true), 'fisa_date')
  assert.equal(tipRaspuns('Raspuns clarificari 3.pdf', undefined, false), 'raspuns_clarificare')
})

Deno.test('„alta” din clasificator nu decide: anexa din răspunsul consolidat rămâne răspuns', () => {
  assert.equal(tipRaspuns('Anexa 1.pdf', undefined, true), 'raspuns_clarificare')
  assert.equal(tipRaspuns('Anexa 1.pdf', undefined, false), 'alta')
  assert.equal(tipRaspuns('Document.pdf', 'alta', true), 'alta', 'nedecis → exact regula veche (tipul înlocuit)')
})

Deno.test('arhiva: regula veche (tipul înlocuit oricare, apoi canalul)', () => {
  assert.equal(tipRaspuns('Raspuns.zip', 'alta', true), 'alta')
  assert.equal(tipRaspuns('Raspuns.zip', undefined, true), 'raspuns_clarificare')
  assert.equal(tipRaspuns('Caiet.rar', undefined, false), 'alta')
})
