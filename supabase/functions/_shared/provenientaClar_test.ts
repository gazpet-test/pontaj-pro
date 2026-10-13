// deno test --node-modules-dir=none -A supabase/functions/_shared/provenientaClar_test.ts
// 20261025a — filtreazaClarificari: citirea surselor peste plafonul PostgREST (Jakarinos r7 P2) + automat pe are_loturi.
import { deepStrictEqual as eq } from 'node:assert/strict'
import { filtreazaClarificari } from './provenientaClar.ts'
import { fakeSupa } from '../_test/fake_supa.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'

// plafonul PostgREST (max_rows 1000) simulat: orice citire întoarce cel mult 1000 de rânduri
function cuPlafon(supa: any) {
  const from = supa.from
  return { ...supa, from: (t: string) => {
    const b = from(t), then = b.then
    b.then = (ok: any, ko: any) => then((r: any) => ok({ ...r, data: Array.isArray(r.data) ? r.data.slice(0, 1000) : r.data }), ko)
    return b
  } }
}

Deno.test('filtreazaClarificari: 1001 cantități-sursă pe fara_loturi — citite complet, clarificarea rămâne', async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => 5000 + i)
  const { supa } = fakeSupa({
    ofertare_licitatii: [{ id: 3, stare_loturi: 'fara_loturi' }],
    ofertare_cantitati: ids.map((id) => ({ id, licitatie_id: 3, extras_de_ai: false })),
  })
  const db = cuPlafon(cuPoartaLot(supa, []).supa)
  const r = await filtreazaClarificari(db, [{ id: 1, licitatie_id: 3, origine: 'automat', surse_cantitati_ids: ids } as any])
  eq([r.ok, r.pastrate.length, r.excluse.length], [true, 1, 0])
})

Deno.test('filtreazaClarificari: automat pe are_loturi = exclus chiar cu surse eligibile (varianta B)', async () => {
  const { supa } = fakeSupa({
    ofertare_licitatii: [{ id: 102, stare_loturi: 'are_loturi' }],
    ofertare_licitatie_loturi: [{ licitatie_id: 102, nr: 2, participam: true }],
  })
  const r = await filtreazaClarificari(cuPoartaLot(supa, [10]).supa, [
    { id: 1, licitatie_id: 102, origine: 'automat', surse_document_ids: [10] } as any,
    { id: 2, licitatie_id: 102, origine: 'platforma', surse_document_ids: [10] } as any,
  ])
  eq([r.pastrate.map((q: any) => q.id), r.excluse.map((q: any) => q.motiv)], [[2], ['automat_pe_loturi']])
})
