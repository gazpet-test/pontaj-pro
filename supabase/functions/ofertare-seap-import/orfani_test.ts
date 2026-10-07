// deno test supabase/functions/ofertare-seap-import/orfani_test.ts — curățenia orfanilor din Storage (audit Jakarinos 07.10, #1 P0)
import { strict as assert } from 'node:assert'
import { curataOrfani, VARSTA_MINIMA_ORFAN_MS } from './orfani.ts'

const ACUM = Date.parse('2026-10-07T18:00:00Z')
const vechi = new Date(ACUM - VARSTA_MINIMA_ORFAN_MS - 60_000).toISOString()
const proaspat = new Date(ACUM - 30_000).toISOString()

type Opt = { obiecte: Record<string, unknown>[]; randuri: string[]; eroareSelect?: number; eroareLista?: boolean; fararDate?: boolean }
function fake(o: Opt) {
  const sterse: string[][] = [], pagini: [number, number][] = []
  const supa = {
    storage: { from: () => ({
      list: async () => o.eroareLista ? { data: null, error: { message: 'lista' } } : { data: o.obiecte, error: null },
      remove: async (c: string[]) => { sterse.push(c); return { error: null } },
    }) },
    from: (t: string) => {
      assert.equal(t, 'ofertare_documente_atribuire')
      const b = {
        select: () => b, eq: () => b, order: () => b,
        range: async (de: number, la: number) => {
          pagini.push([de, la])
          if (o.eroareSelect !== undefined && pagini.length - 1 === o.eroareSelect) return { data: null, error: { message: 'select' } }
          return { data: o.randuri.slice(de, la + 1).map(fisier_path => ({ fisier_path })), error: null }
        },
      }
      return b
    },
  }
  return { supa, sterse, pagini }
}
const ob = (name: string, created_at: string = vechi) => ({ name, id: `id-${name}`, created_at })

Deno.test('orfani: șterge doar obiectul vechi fără rând; folderele și obiectele referite rămân', async () => {
  const f = fake({ obiecte: [ob('a.pdf'), ob('orfan.pdf'), { name: 'raspunsuri', id: null }], randuri: ['7/atribuire/a.pdf'] })
  assert.deepEqual(await curataOrfani(f.supa, 7, ACUM), ['7/atribuire/orfan.pdf'])
  assert.deepEqual(f.sterse, [['7/atribuire/orfan.pdf']])
})

Deno.test('orfani P0: SELECT-ul din BD eșuează → nu se șterge NIMIC (înainte: totul)', async () => {
  const f = fake({ obiecte: [ob('a.pdf'), ob('b.pdf')], randuri: ['7/atribuire/a.pdf'], eroareSelect: 0 })
  assert.deepEqual(await curataOrfani(f.supa, 7, ACUM), [])
  assert.deepEqual(f.sterse, [])
})

Deno.test('orfani: obiect urcat chiar acum de alt drum (fără rând încă) sau fără dată → nu se șterge', async () => {
  const f = fake({ obiecte: [ob('in-curs.pdf', proaspat), { name: 'fara-data.pdf', id: 'id-fara-data' }, ob('vechi.pdf')], randuri: [] })
  assert.deepEqual(await curataOrfani(f.supa, 7, ACUM), ['7/atribuire/vechi.pdf'])
})

Deno.test('orfani: inventarul BD se citește pe pagini; o pagină eșuată = nimic șters', async () => {
  const randuri = Array.from({ length: 1500 }, (_, i) => `7/atribuire/f${i}.pdf`)
  const obiecte = [ob('f1499.pdf'), ob('orfan.pdf')]   // f1499 e pe a doua pagină: fără paginare ar fi fost „orfan”
  const f = fake({ obiecte, randuri })
  assert.deepEqual(await curataOrfani(f.supa, 7, ACUM), ['7/atribuire/orfan.pdf'])
  assert.deepEqual(f.pagini, [[0, 999], [1000, 1999]])
  const g = fake({ obiecte, randuri, eroareSelect: 1 })
  assert.deepEqual(await curataOrfani(g.supa, 7, ACUM), [])
  assert.deepEqual(g.sterse, [])
})

Deno.test('orfani: listarea Storage eșuează → nimic', async () => {
  const f = fake({ obiecte: [ob('x.pdf')], randuri: [], eroareLista: true })
  assert.deepEqual(await curataOrfani(f.supa, 7, ACUM), [])
  assert.deepEqual(f.pagini, [])
})
