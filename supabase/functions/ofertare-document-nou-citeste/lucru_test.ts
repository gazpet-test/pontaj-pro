// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/lucru_test.ts
// Starea rezumatului pe felii (analiza.citire_noi_lucru): reluare, resetare la text schimbat, scriere compare-and-set.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { type Lucru, lucruPentru, scrieLucru, urmatoareaFelie } from './lucru.ts'

const cale = (r: any, c: string) => c.split(/->>?/).reduce((v: any, k) => (v == null ? undefined : v[k]), r)
function db(rand: any, inainteDeUpdate?: () => void) {
  let o = 0
  const from = () => {
    const f: ((r: any) => boolean)[] = []; let patch: any = null
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { f.push((r) => String(cale(r, c)) === String(v)); return b },
      is: (c: string, v: unknown) => { f.push((r) => (cale(r, c) ?? null) === v); return b },
      update: (p: any) => { patch = p; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(rand), error: null }),
      then: (ok: any, ko: any) => (async () => {
        if (patch && inainteDeUpdate && o++ === 0) inainteDeUpdate()
        const potriv = f.every((g) => g(rand))
        if (patch && potriv) Object.assign(rand, structuredClone(patch))
        return { data: potriv ? [{ id: rand.id }] : [], error: null }
      })().then(ok, ko),
    }
    return b
  }
  return { from }
}
const parte = { tip: 'raspuns_clarificare', rezumat: 'r', modificari: [], intrebari_raspunse: [], termen_nou: null, data_document: null, motive: [], tokens_in: 1, tokens_out: 1 }

Deno.test('lucruPentru: același text (sha + n) → se reia; alt text → stare nouă, fără părți', () => {
  const e = { rev: 'r1', sha: 'S', n: 3, inceput_la: 'T0', citit_de: 'u', parti: { '0': parte } }
  const a = lucruPentru(e, 'S', 3, 'T9', 'u')
  assert(a.reluat); assertEquals([a.lucru.inceput_la, urmatoareaFelie(a.lucru)], ['T0', 1])
  const b = lucruPentru(e, 'ALT', 3, 'T9', 'u')
  assert(!b.reluat); assertEquals([b.lucru.inceput_la, Object.keys(b.lucru.parti).length, urmatoareaFelie(b.lucru)], ['T9', 0, 0])
  assertEquals(lucruPentru(e, 'S', 4, 'T9', 'u').reluat, false)
  // tăieturi diferite (altă versiune a împărțirii) pe același text → stare nouă; aceleași tăieturi → reluare
  const cu = { ...e, la: '15000,29000' }
  assertEquals([lucruPentru(cu, 'S', 3, 'T9', 'u', '15000,29000').reluat, lucruPentru(cu, 'S', 3, 'T9', 'u', '14000,29000').reluat], [true, false])
  assertEquals(lucruPentru(e, 'S', 3, 'T9', 'u', '15000,29000').reluat, false)
  assertEquals(lucruPentru(null, 'S', 3, 'T9', 'u', '1,2').lucru.la, '1,2')
  assertEquals(urmatoareaFelie({ ...e, parti: { '0': parte, '1': parte, '2': parte } } as Lucru), -1)
})

Deno.test('scrieLucru: prima felie (rev null) se scrie și păstrează celelalte chei din analiza', async () => {
  const r: any = { id: 7, analiza: { citire_ai: { rev: 'A1' }, plansa: { ok: 1 } } }
  const nou: Lucru = { rev: 'L1', sha: 'S', n: 2, inceput_la: 'T0', citit_de: 'u', parti: { '0': parte as any } }
  const w = await scrieLucru(db(r), 7, null, nou)
  assert(w.scris)
  assertEquals([r.analiza.citire_noi_lucru.rev, r.analiza.plansa.ok, r.analiza.citire_ai.rev], ['L1', 1, 'A1'])
})

Deno.test('scrieLucru: alt apel a avansat între timp (rev schimbat) → conflict, nimic suprascris', async () => {
  const r: any = { id: 7, analiza: { citire_noi_lucru: { rev: 'L2', parti: { '0': parte, '1': parte } } } }
  const w = await scrieLucru(db(r), 7, 'L1', { rev: 'L9', sha: 'S', n: 3, inceput_la: 'T', citit_de: null, parti: {} })
  assert(!w.scris && w.conflict)
  assertEquals(r.analiza.citire_noi_lucru.rev, 'L2')
  // cursa exactă: alt apel scrie între recitire și UPDATE → CAS-ul pe rev nu potrivește, a doua recitire vede conflictul
  const r2: any = { id: 7, analiza: { citire_noi_lucru: { rev: 'L1', parti: {} } } }
  const w2 = await scrieLucru(db(r2, () => { r2.analiza = { citire_noi_lucru: { rev: 'LX', parti: { '0': parte } } } }), 7, 'L1',
    { rev: 'L9', sha: 'S', n: 3, inceput_la: 'T', citit_de: null, parti: {} })
  assert(!w2.scris && w2.conflict)
  assertEquals(r2.analiza.citire_noi_lucru.rev, 'LX')
})

Deno.test('scrieLucru: o scriere a serverului de planșe (citire_ai.rev) între recitire și UPDATE nu se pierde — se reface peste starea nouă', async () => {
  const r: any = { id: 7, analiza: { citire_ai: { rev: 'A1' } } }
  const w = await scrieLucru(db(r, () => { r.analiza = { citire_ai: { rev: 'A2' }, transfer_cantitati: { n: 2 } } }), 7, null,
    { rev: 'L1', sha: 'S', n: 2, inceput_la: 'T', citit_de: null, parti: {} })
  assert(w.scris)
  assertEquals([r.analiza.citire_ai.rev, r.analiza.transfer_cantitati.n, r.analiza.citire_noi_lucru.rev], ['A2', 2, 'L1'])
})
