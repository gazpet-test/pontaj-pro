import { strict as assert } from 'node:assert'
import { documentEligibil, eligibilitateLicitatie, esteEligibil, mesajLot } from './eligibilLot.ts'

const client = (raspuns: unknown, eroare: unknown = null, arunca = false) => ({
  apeluri: [] as Array<[string, Record<string, unknown>]>,
  rpc(name: string, args: Record<string, unknown>) {
    this.apeluri.push([name, args])
    if (arunca) return Promise.reject(new Error('retea'))
    return Promise.resolve({ data: raspuns, error: eroare })
  },
})

Deno.test('documentEligibil: eligibil din RPC', async () => {
  const c = client({ eligibil: true, motiv: 'comun', licitatie_id: 102 })
  assert.deepEqual(await documentEligibil(c, 1247), { eligibil: true, motiv: 'comun', licitatie_id: 102 })
  assert.deepEqual(c.apeluri, [['fn_ofertare_document_eligibil', { p_document_id: 1247 }]])
})

Deno.test('documentEligibil: fail-closed la eroare, excepție, răspuns ciudat', async () => {
  for (const c of [client(null, { message: 'x' }), client(null, null, true), client({ eligibil: 'true', motiv: 'comun' }),
    client({ motiv: 'comun' }), client(null)]) {
    const r = await documentEligibil(c, 1)
    assert.equal(r.eligibil, false)
    assert.equal(r.motiv, 'eroare_poarta')
  }
})

Deno.test('documentEligibil: neeligibil păstrează motivul', async () => {
  const r = await documentEligibil(client({ eligibil: false, motiv: 'de_triat', licitatie_id: 102 }), 9)
  assert.deepEqual(r, { eligibil: false, motiv: 'de_triat', licitatie_id: 102 })
  assert.match(mesajLot(r.motiv), /nu e triat/)
})

Deno.test('eligibilitateLicitatie: hartă + lipsă = neeligibil', async () => {
  const { ok, harta } = await eligibilitateLicitatie(client([
    { document_id: 1, eligibil: true, motiv: 'comun' },
    { document_id: 2, eligibil: false, motiv: 'in_afara_loturilor' },
  ]), 102)
  assert.equal(ok, true)
  assert.equal(esteEligibil(harta, 1), true)
  assert.equal(esteEligibil(harta, 2), false)
  assert.equal(esteEligibil(harta, 3), false)
})

Deno.test('eligibilitateLicitatie: eroare = ok false, hartă goală', async () => {
  for (const c of [client(null, { message: 'x' }), client(null, null, true), client({ nu: 'lista' })]) {
    const { ok, harta } = await eligibilitateLicitatie(c, 102)
    assert.equal(ok, false)
    assert.equal(harta.size, 0)
  }
})

// ── helperii din review-ul Jakarinos (P1 #1–#3, P2 #8) ──
import { filtreazaDerivate, filtreazaDocumente, participareLicitatie } from './eligibilLot.ts'

// client cu builder paginat (ca supabase-js): rpc(...).order().range() → thenable
const clientPaginat = (n: number) => ({
  pagini: [] as Array<[number, number]>,
  rpc(_name: string, _args: Record<string, unknown>) {
    const self = this
    let a = 0, b = n
    const q: any = {
      order() { return q }, range(x: number, y: number) { a = x; b = y; self.pagini.push([x, y]); return q },
      then(res: any, rej: any) {
        const rows = Array.from({ length: Math.max(0, Math.min(n, b + 1) - a) }, (_, i) => ({ document_id: a + i + 1, eligibil: true, motiv: 'comun' }))
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      },
    }
    return q
  },
})

Deno.test('eligibilitateLicitatie: paginează peste 1000 (P2 #8)', async () => {
  const c = clientPaginat(2350)
  const { ok, harta } = await eligibilitateLicitatie(c, 102)
  assert.equal(ok, true)
  assert.equal(harta.size, 2350)
  assert.equal(esteEligibil(harta, 2350), true)
  assert.deepEqual(c.pagini, [[0, 999], [1000, 1999], [2000, 2999]])
})

const dbFals = (o: { stare?: string | null; loturi?: number[]; motive?: Record<number, string>; cadeRpc?: boolean; cadeFrom?: boolean }) => ({
  rpc(name: string, args: any) {
    if (o.cadeRpc) return Promise.resolve({ data: null, error: { message: 'x' } })
    const el = (id: number) => { const m = o.motive?.[id] ?? 'comun'; return { eligibil: ['comun', 'fara_loturi', 'lot_participam'].includes(m), motiv: m } }
    if (name === 'fn_ofertare_document_eligibil') return Promise.resolve({ data: { ...el(Number(args.p_document_id)), licitatie_id: 1 }, error: null })
    return Promise.resolve({ data: Object.keys(o.motive || {}).map(Number).concat([1, 2, 3]).map((id) => ({ document_id: id, ...el(id) })), error: null })
  },
  from(t: string) {
    const r = t === 'ofertare_licitatii' ? (o.stare === null ? null : { stare_loturi: o.stare ?? 'are_loturi' }) : (o.loturi ?? []).map((nr) => ({ nr }))
    const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: r, error: o.cadeFrom ? { message: 'x' } : null }),
      then: (res: any, rej: any) => Promise.resolve({ data: r, error: o.cadeFrom ? { message: 'x' } : null }).then(res, rej) }
    return q
  },
})

Deno.test('participareLicitatie: zero participări / neinițializat / eroare = blocat (P1 #2)', async () => {
  assert.equal((await participareLicitatie(dbFals({ stare: 'are_loturi', loturi: [] }), 1)).motiv, 'nicio_participare')
  assert.equal((await participareLicitatie(dbFals({ stare: 'neinitializat' }), 1)).ok, false)
  assert.equal((await participareLicitatie(dbFals({ cadeFrom: true }), 1)).motiv, 'eroare_poarta')
  assert.equal((await participareLicitatie(dbFals({ stare: null }), 1)).motiv, 'eroare_poarta')
  assert.deepEqual(await participareLicitatie(dbFals({ stare: 'are_loturi', loturi: [3, 2] }), 1), { ok: true, motiv: 'lot_participam', stare: 'are_loturi', participam: [2, 3] })
  assert.equal((await participareLicitatie(dbFals({ stare: 'fara_loturi' }), 1)).ok, true)
})

Deno.test('filtreazaDocumente: blocate separat, eroare = ok false și nimic eligibil', async () => {
  const r = await filtreazaDocumente(dbFals({ motive: { 7: 'de_triat' } }), [1, 7, null, 1])
  assert.equal(r.ok, true)
  assert.deepEqual([...r.eligibile], [1])
  assert.equal(r.blocate.get(7), 'de_triat')
  const e = await filtreazaDocumente(dbFals({ cadeRpc: true }), [1])
  assert.equal(e.ok, false)
  assert.equal(e.eligibile.size, 0)
})

Deno.test('filtreazaDerivate: document blocat, lot în afară, lot necunoscut (inclusiv rând vechi) ies', async () => {
  const cer = [
    { id: 1, sursa_document_id: 1, lot_domeniu: 'lista', lot_nr: [2] },
    { id: 2, sursa_document_id: 7, lot_domeniu: 'toate' },                 // document de triat
    { id: 3, sursa_document_id: 1, lot_domeniu: 'lista', lot_nr: [1] },    // lot fără participare
    { id: 4, sursa_document_id: 1, lot_domeniu: 'necunoscut' },
    { id: 5, sursa_document_id: null, lot: null },                          // rând vechi fără lot = necunoscut
    { id: 6, sursa_document_id: null, lot: 'Lot 3' },                       // rând vechi cu text = lista
    { id: 7, sursa_document_id: 99, lot_domeniu: 'toate' },                 // document din altă licitație = absent din hartă
  ]
  const r = await filtreazaDerivate(dbFals({ stare: 'are_loturi', loturi: [2, 3], motive: { 7: 'de_triat' } }), 102, cer)
  assert.equal(r.ok, true)
  assert.deepEqual(r.pastrate.map((c) => c.id), [1, 6])
  assert.deepEqual(r.excluse.map((c) => [c.id, c.motiv]), [[2, 'document_de_triat'], [3, 'lot_in_afara'], [4, 'lot_necunoscut'], [5, 'lot_necunoscut'], [7, 'document_neeligibil']])
  // fără loturi: doar documentul decide
  const f = await filtreazaDerivate(dbFals({ stare: 'fara_loturi', motive: { 7: 'de_triat' } }), 1, cer)
  assert.deepEqual(f.pastrate.map((c) => c.id), [1, 3, 4, 5, 6])
  // zero participări / poartă căzută = nimic
  assert.equal((await filtreazaDerivate(dbFals({ stare: 'are_loturi', loturi: [] }), 1, cer)).ok, false)
  assert.equal((await filtreazaDerivate(dbFals({ stare: 'fara_loturi', cadeRpc: true }), 1, cer)).ok, false)
})