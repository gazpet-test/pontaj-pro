// deno test --node-modules-dir=none supabase/functions/ofertare-raspuns-set/loturi_test.ts
import { deepStrictEqual as eq } from 'node:assert/strict'
import { filtreazaRegistru, lotOperatie, lotOperatieSelectie, selectieSet } from './loturi.ts'

const ids = (r: any) => (r.ok ? r.eligibile.map((c: any) => c.id) : r)

Deno.test('raspuns-set: lotul „1” prinde cerința „1,2,3” (mulțimi de întregi), „12” NU prinde „1”', () => {
  const cer = [{ id: 1, lot: '1,2,3' }, { id: 2, lot: '12' }, { id: 3, lot: 'Lot 1' }, { id: 4, lot: 'toate' }]
  eq(ids(filtreazaRegistru(cer, '1')), [1, 3, 4])
  eq(ids(filtreazaRegistru(cer, '12')), [2, 4])
  eq(ids(filtreazaRegistru(cer, 'Lot 2')), [1, 4])
})
Deno.test('raspuns-set: cerința „necunoscut” nu e eligibilă automat — intră marcată de revizuit', () => {
  const cer = [{ id: 1, lot: 'toate', lot_domeniu: 'necunoscut', lot_nr: null }, { id: 2, lot: null }, { id: 3, lot: 'vezi CS' },
    { id: 4, lot: '1', lot_domeniu: 'lista', lot_nr: [2] }]
  const r = filtreazaRegistru(cer, '1')
  if (!r.ok) throw new Error(r.eroare)
  eq(r.eligibile.map((c) => c.id), [1, 2, 3])          // 4: coloanele noi ([2]) au prioritate peste textul vechi „1”
  eq([...r.lotNecunoscut], [1, 2, 3])
  eq(r.excluse, 1)
})
Deno.test('raspuns-set: set fără lot / „toate” = comportamentul vechi (tot registrul, nimic marcat)', () => {
  const cer = [{ id: 1, lot: '12' }, { id: 2, lot: null }, { id: 3, lot_domeniu: 'necunoscut' }]
  for (const s of [null, '', '  ', 'toate']) {
    const r = filtreazaRegistru(cer, s)
    if (!r.ok) throw new Error(r.eroare)
    eq([r.eligibile.length, r.lotNecunoscut.size], [3, 0])
  }
})
Deno.test('raspuns-set: lot de set neinterpretabil = refuz (fail-closed), nu tot registrul', () => {
  eq(selectieSet('lotul mare').ok, false)
  eq(filtreazaRegistru([{ id: 1, lot: '1' }], '1-99').ok, false)
  eq(selectieSet('Lot 1, Lot 2'), { ok: true, selectie: [1, 2] })
})
Deno.test('raspuns-set: lotul operației — canonic din set, altfel din dispoziție; neinterpretabil rămâne brut', () => {
  eq(lotOperatie('Lot 2', ['5']), { lot: '2', lot_domeniu: 'lista', lot_nr: [2] })
  eq(lotOperatie(null, ['Lot 1', '3']), { lot: '1,3', lot_domeniu: 'lista', lot_nr: [1, 3] })
  eq(lotOperatie(null, []), { lot: null, lot_domeniu: null, lot_nr: null })
  eq(lotOperatie('', ['toate']), { lot: 'toate', lot_domeniu: 'toate', lot_nr: null })
  eq(lotOperatie(null, ['zona nord']), { lot: 'zona nord', lot_domeniu: 'necunoscut', lot_nr: null })
})

Deno.test('lotOperatieSelectie (review Jakarinos r4 P1 #1): dispoziția pe lotul ei din selecție, nu toată selecția', () => {
  eq(lotOperatieSelectie([1, 2], null, ['2']).lot, '2')            // participăm 1+2, dispoziția e pe 2
  eq(lotOperatieSelectie([1, 2], null, ['2', '3']).lot, '2')       // 3 nu e în selecție
  eq(lotOperatieSelectie([1, 2], null, []).lot, '1,2')             // generală → toată selecția
  eq(lotOperatieSelectie([2], '2', ['toate']).lot, '2')
  eq(lotOperatieSelectie(null, null, ['2']).lot, '2')              // fără selecție: regula veche
  eq(lotOperatieSelectie(null, '3', ['2']).lot, '3')
})