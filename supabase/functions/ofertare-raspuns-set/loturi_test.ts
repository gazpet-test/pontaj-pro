// deno test --node-modules-dir=none supabase/functions/ofertare-raspuns-set/loturi_test.ts
import { deepStrictEqual as eq } from 'node:assert/strict'
import { coadaIncompleta, domeniuAcoperit, filtreazaRegistru, lotOperatie, lotOperatieSelectie, provenientaCompleta, provenientaUnica, selectieSet, surseCoada, surseDispozitie, surseNoi, surseOperatie } from './loturi.ts'

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

Deno.test('proveniența cozii (review Jakarinos r5 P1 #1): coada A→B→C poartă toate documentele', () => {
  eq(surseCoada({}), [])
  eq(surseCoada({ coada_doc_id: 7 }), [7])                         // forma r4, un singur id
  eq(surseCoada({ coada_doc_ids: [7, 8], coada_doc_id: 9 }), [7, 8]) // forma nouă are prioritate
  const dinA = surseNoi(10, [])                                       // fragmentul A lasă coadă
  const dinB = surseNoi(11, surseCoada({ coada_doc_ids: dinA }))      // B lipește coada A și lasă coadă mai departe
  eq(dinB, [10, 11])
  eq(surseNoi(12, surseCoada({ coada_doc_ids: dinB })), [10, 11, 12])
  eq(surseNoi(12, []), [12])                                          // coadă omisă = doar documentul curent
})
Deno.test('surseDispozitie: doc_ids verificate integral; vechi fără doc_ids pe are_loturi = neverificabil', () => {
  eq(surseDispozitie({ doc_id: 11, doc_ids: [10, 11] }, true), [10, 11])
  eq(surseDispozitie({ doc_id: 11, doc_ids: [10, 10, 11] }, true), [10, 11])
  eq(surseDispozitie({ doc_id: 11, doc_ids: [10, 'x'] }, true), null) // id stricat = fail-closed
  eq(surseDispozitie({ doc_id: 11 }, true), null)                      // dispoziție veche pe are_loturi
  eq(surseDispozitie({ doc_id: 11 }, false), [11])                     // fara_loturi: ca înainte
  eq(surseDispozitie({}, false), null)
})
Deno.test('surseCoada r6 (Jakarinos r6 P1 #1): forma veche coada_doc_id pe are_loturi = neverificabilă; listă stricată = []', () => {
  eq(surseCoada({ coada_doc_id: 7 }, true), [])
  eq(surseCoada({ coada_doc_id: 7 }, false), [7])
  eq(surseCoada({ coada_doc_ids: [7, 8] }, true), [7, 8])
  eq(surseCoada({ coada_doc_ids: [7, 'x'] }, false), [])
})
Deno.test('operația (Jakarinos r6 P1 #2, varianta B): aplicabilă pe are_loturi doar cu O singură sursă', () => {
  eq(surseOperatie([11], null), [11])                 // noua / cerință manuală: sursa dispoziției
  eq(surseOperatie([11], 11), [11])                   // cerința-țintă din același document
  eq(surseOperatie([11], 10), [10, 11])               // țintă din alt document → două surse
  eq(surseOperatie([10, 11], null), [10, 11])         // coadă lipită A→B
  eq(surseOperatie(null, 11), null)                   // dispoziție fără proveniență
  eq([provenientaUnica([11]), provenientaUnica([10, 11]), provenientaUnica(null), provenientaUnica(undefined), provenientaUnica(['x'])], [true, false, false, false, false])
})
Deno.test('proveniență incompletă (Jakarinos r8 P1 #1): fallback-ul de pe fara_loturi nu certifică surse complete', () => {
  eq(coadaIncompleta({ coada_deschisa: 'x', coada_doc_id: 7 }), true)        // formă veche
  eq(coadaIncompleta({ coada_deschisa: 'x', coada_doc_ids: [7] }), false)
  eq(coadaIncompleta({ coada_deschisa: 'x', coada_doc_ids: [7], coada_incompleta: true }), true)   // moștenit
  eq(coadaIncompleta({}), false)
  eq(provenientaCompleta({ doc_id: 11 }), false)                               // dispoziție veche
  eq(provenientaCompleta({ doc_id: 11, doc_ids: [11] }), true)
  eq(provenientaCompleta({ doc_id: 11, doc_ids: [10, 11], surse_incomplete: true }), false)
  eq(surseDispozitie({ doc_id: 11, doc_ids: [11], surse_incomplete: true }, true), null)
  eq(surseDispozitie({ doc_id: 11, doc_ids: [11], surse_incomplete: true }, false), [11])
})
Deno.test('surseCoada r9 (Jakarinos r9 P1 #1): coada marcată incompletă nu intră la AI pe are_loturi', () => {
  eq(surseCoada({ coada_doc_ids: [11], coada_incompleta: true }, true), [])
  eq(surseCoada({ coada_doc_ids: [11], coada_incompleta: true }, false), [11])
})
Deno.test('domeniuAcoperit (Jakarinos r10 P1): operația pe lotul 2 nu atinge o cerință comună loturilor 1+2', () => {
  const L = (domeniu: string, loturi: number[] = []) => ({ domeniu, loturi }) as any
  eq(domeniuAcoperit(L('lista', [2]), L('toate'), [1, 2]), false)        // comună = toată participarea {1,2}
  eq(domeniuAcoperit(L('lista', [1, 2]), L('toate'), [1, 2]), true)
  eq(domeniuAcoperit(L('lista', [2]), L('lista', [2]), [1, 2]), true)
  eq(domeniuAcoperit(L('lista', [2]), L('lista', [1, 2]), [1, 2]), false)
  eq(domeniuAcoperit(L('lista', [2]), L('necunoscut'), [1, 2]), false)
  eq(domeniuAcoperit(L('lista', [2, 3]), L('lista', [3]), [2, 3]), true)
})