// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/scriere_test.ts
// R5, reparația rundei 1 (verificatorul BD, minor „ofertare-document-nou-citeste scrie `analiza` din instantaneul de dinainte de AI, fără
// CAS”): o citire de planșă / un transfer terminat între citirea documentului și scriere NU mai e suprascris (transfer_cantitati rămâne).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { scrieCitireNoi } from './scriere.ts'
import { amprentaText } from './sursa.ts'

const cale = (r: any, c: string) => c.split(/->>?/).reduce((v: any, k) => (v == null ? undefined : v[k]), r)
// client PostgREST simulat: select / update cu filtrele eq / is pe căi JSON; `inainteDeUpdate` = scrierea concurentă (o dată)
function db(rand: any, inainteDeUpdate?: () => void) {
  let o = 0
  const from = () => {
    let f: ((r: any) => boolean)[] = [], patch: any = null
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
const CITIRE = { tip: 'raspuns_clarificare', rezumat: 'R', modificari: [], intrebari_raspunse: [] }

Deno.test('reparația rundei 1: un transfer scris ÎNTRE citire și scriere nu se pierde — CAS pe citire_ai.rev, reconstruit peste starea nouă', async () => {
  const rand: any = { id: 470, status_procesare: 'procesat', text_extras: 'x', analiza: { plansa: { rezultat: 'ok' }, citire_ai: { rev: 'r1', gata: true } } }
  const concurent = () => { rand.analiza = { ...rand.analiza, transfer_cantitati: { id: 'T', stare: 'conflicte', n: 2 }, citire_ai: { ...rand.analiza.citire_ai, rev: 'r2' } } }
  const r = await scrieCitireNoi(db(rand, concurent), 470, CITIRE, 'PL.pdf')
  assert(r.scris)
  assertEquals(rand.analiza.transfer_cantitati, { id: 'T', stare: 'conflicte', n: 2 }, 'înregistrarea conflictelor rămâne')
  assertEquals([rand.analiza.citire_ai.rev, rand.analiza.citire_noi.tip, rand.analiza.plansa.rezultat], ['r2', 'raspuns_clarificare', 'ok'])
})
Deno.test('reparația rundei 1: document fără citire_ai (rev null) — scris o dată; conflict persistent => nimic scris, eroare explicită', async () => {
  const a: any = { id: 1, status_procesare: 'neprocesat', text_extras: null, analiza: null }
  const r = await scrieCitireNoi(db(a), 1, CITIRE, 'Raspuns.pdf')
  assert(r.scris)
  assertEquals([a.status_procesare, a.analiza.citire_noi.rezumat, /^DOCUMENT: Raspuns\.pdf/.test(a.text_extras)], ['procesat', 'R', true])
  // rev-ul se schimbă la FIECARE încercare (scriitor concurent continuu) => după 3 încercări: nescris, nimic suprascris
  const b: any = { id: 2, status_procesare: 'procesat', text_extras: 'x', analiza: { citire_ai: { rev: 'a' }, transfer_cantitati: { id: 'T' } } }
  let k = 0
  const mereu = { from: () => { const x: any = db(b, () => { b.analiza = { ...b.analiza, citire_ai: { rev: 'z' + k++ } } }).from(); return x } }
  const r2 = await scrieCitireNoi(mereu, 2, CITIRE, 'X.pdf')
  assertFalse(r2.scris)
  assertEquals([b.analiza.citire_noi, b.analiza.transfer_cantitati], [undefined, { id: 'T' }])
})

// Copilot conv. 3 (06.10, P2): sursa recitită / reprocesată în timpul apelului AI → nimic scris (stale), nu rezumat vechi peste text nou.
Deno.test('sursa neschimbată → scris; text schimbat între citire și scriere → stale, nimic scris', async () => {
  const baza = () => ({ id: 9, status_procesare: 'procesat', procesat_la: '2026-10-06T10:00:00+00:00', fisier_path: 'L/a.pdf', text_extras: 'TEXT V1', analiza: {} })
  const r1: any = baza()
  const am = { status: 'procesat', procesat_la: '2026-10-06T10:00:00+00:00', sha256: await amprentaText('TEXT V1'), fisier_path: 'L/a.pdf' }
  const ok = await scrieCitireNoi(db(r1), 9, CITIRE, 'a.pdf', am)
  assert(ok.scris && !ok.stale)
  const r2: any = { ...baza(), text_extras: 'TEXT V2 (recitit)' }
  const st = await scrieCitireNoi(db(r2), 9, CITIRE, 'a.pdf', am)
  assert(st.stale && !st.scris)
  assertEquals(r2.analiza, {}, 'rezumatul vechi NU s-a scris')
})
Deno.test('reprocesare pornită exact între recitire și UPDATE (procesat_la / stare noi) → UPDATE-ul condiționat nu potrivește, apoi stale', async () => {
  const r: any = { id: 9, status_procesare: 'procesat', procesat_la: 'T1', fisier_path: 'L/a.pdf', text_extras: 'TEXT', analiza: {} }
  const am = { status: 'procesat', procesat_la: 'T1', sha256: await amprentaText('TEXT'), fisier_path: 'L/a.pdf' }
  const res = await scrieCitireNoi(db(r, () => { r.status_procesare = 'in_lucru'; r.procesat_la = 'T2' }), 9, CITIRE, 'a.pdf', am)
  assert(!res.scris && res.stale)
  assertEquals(r.analiza, {})
})
Deno.test('fără amprentă (apel vechi) → comportamentul de dinainte, neschimbat', async () => {
  const r: any = { id: 9, status_procesare: 'procesat', text_extras: 'x', analiza: {} }
  const res = await scrieCitireNoi(db(r), 9, CITIRE, 'a.pdf')
  assert(res.scris && !res.stale)
})
