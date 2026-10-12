// deno test -A supabase/functions/ofertare-e0-autofill/poarta_e0_test.ts
import { deepStrictEqual as eq, ok } from 'node:assert/strict'
import { caleE0Valida, poartaE0 } from './poarta_e0.ts'
import { fakeSupa } from '../_test/fake_supa.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'

const BUN = 'e0/1760270000000_k3j9xq_Fisa_de_date_CN1234567.pdf'

Deno.test('E0: doar forma generată de formularul E0 trece', () => {
  ok(caleE0Valida(BUN))
  ok(caleE0Valida('e0/1760270000000__a.pdf'))           // random base36 poate ieși gol
  for (const rau of ['95/PL1.pdf', '/e0/1760270000000_ab_x.pdf', 'e0/../95/PL1.pdf', 'e0/1760270000000_ab_x/../../95/a.pdf',
    'e0\\1760270000000_ab_x.pdf', 'e0/1760270000000_ab_%2e%2e.pdf', 'e0/1760270000000_ab_a b.pdf', 'E0/1760270000000_ab_x.pdf',
    'e0/1760270000000_ab_x.pdf\n', 'e0/abc_ab_x.pdf', 'e0/1760270000000_ab_', 'e0//1760270000000_ab_x.pdf', '', null, 12, {}])
    ok(!caleE0Valida(rau), String(rau))
})

Deno.test('E0: path de document de atribuire (în afara e0/) → refuz, fără citiri și fără poartă', async () => {
  const { supa, n } = fakeSupa({ ofertare_documente_atribuire: [{ id: 7, fisier_path: '95/PL1.pdf' }] })
  const p = cuPoartaLot(supa, [7], { motive: { 7: 'in_afara_loturilor' } })
  ok(/path invalid/.test((await poartaE0(p.supa, '95/PL1.pdf'))!))
  eq(n.citiri.length, 0); eq(p.apeluri.length, 0)
})

Deno.test('E0: upload E0 obișnuit (fără rând în documente) → trece', async () => {
  const { supa } = fakeSupa({ ofertare_documente_atribuire: [{ id: 7, fisier_path: '95/PL1.pdf' }] })
  const p = cuPoartaLot(supa, [7])
  eq(await poartaE0(p.supa, BUN), null)
  eq(p.apeluri.length, 0)
})

Deno.test('E0: cale E0 care e și document neeligibil → refuz pe loturi', async () => {
  const { supa } = fakeSupa({ ofertare_documente_atribuire: [{ id: 8, fisier_path: BUN }] })
  const p = cuPoartaLot(supa, [8], { motive: { 8: 'de_triat' } })
  ok(/Blocat pe loturi: documentul nu e triat/.test((await poartaE0(p.supa, BUN))!))
  eq(p.apeluri.map((a) => a.args.p_document_id), [8])
})

Deno.test('E0: cale E0 care e document eligibil → trece', async () => {
  const { supa } = fakeSupa({ ofertare_documente_atribuire: [{ id: 8, fisier_path: BUN }] })
  const p = cuPoartaLot(supa, [8], { motive: { 8: 'lot_participam' } })
  eq(await poartaE0(p.supa, BUN), null)
})

Deno.test('E0: poarta cade → fail-closed', async () => {
  const { supa } = fakeSupa({ ofertare_documente_atribuire: [{ id: 8, fisier_path: BUN }] })
  const p = cuPoartaLot(supa, [8], { cade: true })
  ok(/nu a răspuns/.test((await poartaE0(p.supa, BUN))!))
})

Deno.test('E0: căutarea în documente dă eroare → fail-closed', async () => {
  const db = { rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => { const b: any = { select: () => b, eq: () => b, limit: () => Promise.resolve({ data: null, error: { message: 'x' } }) }; return b } }
  ok(/nu a răspuns/.test((await poartaE0(db, BUN))!))
})
