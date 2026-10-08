// deno test supabase/functions/_shared/paginat_test.ts — inventarele pe pagini (audit Jakarinos #21)
import { strict as assert } from 'node:assert'
import { toatePaginile } from './paginat.mjs'

const sursa = (n: number, eroareLa = -1, plafon = 1000) => {
  const cereri: [number, number][] = []
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }))
  const fa = async (de: number, la: number) => {
    cereri.push([de, la])
    if (cereri.length - 1 === eroareLa) return { data: null, error: { message: 'pica' } }
    return { data: rows.slice(de, Math.min(la + 1, de + plafon)), error: null }   // plafonul serverului (max_rows) pe cerere
  }
  return { fa, cereri }
}

Deno.test('toatePaginile: 2500 de rânduri → toate; sfârșitul e pagina goală, nu cea scurtă', async () => {
  const a = sursa(2500)
  const r = await toatePaginile(a.fa)
  assert.deepEqual([r.error, r.data?.length, a.cereri], [null, 2500, [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]])
  assert.deepEqual(r.data?.map((x: any) => x.id), Array.from({ length: 2500 }, (_, i) => i + 1), 'fără găuri, fără dubluri')
  const b = sursa(7)
  assert.deepEqual([(await toatePaginile(b.fa)).data?.length, b.cereri], [7, [[0, 999], [7, 1006]]])
  const c = sursa(0)
  assert.deepEqual([(await toatePaginile(c.fa)).data, c.cereri.length], [[], 1])
})

Deno.test('toatePaginile: plafonul serverului MAI MIC decât pagina (max_rows 500) → nicio gaură', async () => {
  const a = sursa(1200, -1, 500)
  const r = await toatePaginile(a.fa)
  assert.deepEqual(r.data?.map((x: any) => x.id), Array.from({ length: 1200 }, (_, i) => i + 1))
  assert.deepEqual(a.cereri, [[0, 999], [500, 1499], [1000, 1999], [1200, 2199]])
})

Deno.test('toatePaginile: un apelant care ignoră intervalul (întoarce mai mult decât a cerut) → eroare, nu dubluri', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: i }))
  const r = await toatePaginile(async () => ({ data: rows, error: null }), 10)
  assert.equal(r.data, null)
  assert.match(String(r.error?.message), /intervalul a fost ignorat/)
})

Deno.test('toatePaginile: o eroare pe orice pagină → eroare, nu listă parțială; plafonul de pagini → eroare', async () => {
  const a = sursa(2500, 1)
  assert.deepEqual(await toatePaginile(a.fa), { data: null, error: { message: 'pica' } })
  const b = sursa(50)
  const r = await toatePaginile(b.fa, 10, 3)
  assert.equal(r.data, null)
  assert.match(String(r.error?.message), /cel puțin 30 rânduri în 3 pagini/)
  assert.match(String((await toatePaginile(async () => ({ data: null, error: null }))).error?.message), /fără rânduri/)
})

Deno.test('copia din api/ e identică byte cu byte', async () => {
  const a = await Deno.readFile(new URL('./paginat.mjs', import.meta.url))
  const b = await Deno.readFile(new URL('../../../api/_paginat.js', import.meta.url))
  assert.ok(a.length === b.length && a.every((x, i) => x === b[i]))
})
