// deno test supabase/functions/ofertare-seap-import/placeholder_test.ts — completarea placeholder-ului o singură dată (audit #2)
// + codul SEAP deja pe alt rând = „deja prezent” (audit #4 var. B, indexul unic ofertare_doc_seap_cod_unic)
import { strict as assert } from 'node:assert'
import { scrieDocument } from './placeholder.ts'

type Rand = Record<string, unknown>
// Ca Postgres: indexul unic parțial (licitatie_id, seap_cod) respinge un cod deja ținut de ALT rând (UPDATE sau INSERT).
// `eroareInsert` forțează o altă eroare la INSERT (ex. 23505 pe alt index).
const DUPLICAT = { code: '23505', message: 'duplicate key value violates unique constraint "ofertare_doc_seap_cod_unic"' }
function fake(randuri: Rand[], eroareInsert: Record<string, unknown> | null = null) {
  let next = 100
  const ocupat = (patch: Rand, id: unknown) => patch.seap_cod != null && randuri.some(x => x.id !== id && x.seap_cod === patch.seap_cod)
  const supa = {
    from: () => {
      let op = '', patch: Rand = {}, id: unknown = null, doarPlaceholder = false
      const b: Record<string, unknown> = {
        update: (p: Rand) => { op = 'update'; patch = p; return b },
        insert: (p: Rand) => { op = 'insert'; patch = p; return b },
        eq: (_c: string, v: unknown) => { id = v; return b },
        or: (expr: string) => { assert.equal(expr, 'fisier_path.is.null,fisier_path.like.%/neincarcat/%'); doarPlaceholder = true; return b },
        select: () => op === 'update' ? (async () => {
          const r = randuri.find(x => x.id === id && (!doarPlaceholder || !x.fisier_path || String(x.fisier_path).includes('/neincarcat/')))
          if (r && ocupat(patch, r.id)) return { data: null, error: DUPLICAT }
          if (r) Object.assign(r, patch)
          return { data: r ? [{ id: r.id }] : [], error: null }
        })() : b,
        maybeSingle: async () => {
          if (eroareInsert) return { data: null, error: eroareInsert }
          if (ocupat(patch, null)) return { data: null, error: DUPLICAT }
          const r = { id: next++, ...patch }; randuri.push(r); return { data: { id: r.id }, error: null }
        },
      }
      return b
    },
  }
  return supa
}

Deno.test('placeholder: prima scriere îl completează, a doua (aceeași cheie, alt fișier) devine rând nou', async () => {
  const randuri: Rand[] = [{ id: 40, nume_original: 'Anexa 1.pdf', fisier_path: '3/atribuire/neincarcat/Anexa_1.pdf' }]
  const ph = new Map([['anexa1.pdf', 40]])
  const supa = fake(randuri)
  const a = await scrieDocument(supa, { nume_original: 'Anexa (1).pdf', fisier_path: '3/atribuire/x_a' }, 'anexa1.pdf', ph)
  const b = await scrieDocument(supa, { nume_original: 'Anexa 1.pdf', fisier_path: '3/atribuire/x_b' }, 'anexa1.pdf', ph)
  assert.deepEqual([a, b], [{ id: 40, completat: true }, { id: 100, completat: false }])
  assert.deepEqual(randuri.map(r => [r.id, r.fisier_path]), [[40, '3/atribuire/x_a'], [100, '3/atribuire/x_b']])
  assert.equal(ph.size, 0)
})

Deno.test('placeholder completat între timp de alt drum → nu se suprascrie, rând nou', async () => {
  const randuri: Rand[] = [{ id: 41, nume_original: 'F.pdf', fisier_path: '3/atribuire/de_la_worker_F.pdf' }]
  const r = await scrieDocument(fake(randuri), { nume_original: 'F.pdf', fisier_path: '3/atribuire/edge_F.pdf' }, 'f.pdf', new Map([['f.pdf', 41]]))
  assert.deepEqual(r, { id: 100, completat: false })
  assert.equal(randuri[0].fisier_path, '3/atribuire/de_la_worker_F.pdf', 'rândul celuilalt drum rămâne neatins')
})

Deno.test('cod SEAP deja pe alt rând, la INSERT → { duplicat }, niciun rând nou', async () => {
  const randuri: Rand[] = [{ id: 7, nume_original: 'Raspuns.pdf', fisier_path: '3/atribuire/raspunsuri/x', seap_cod: 'CN1/00058' }]
  const r = await scrieDocument(fake(randuri), { nume_original: 'Caiet.pdf', fisier_path: '3/atribuire/c', seap_cod: 'CN1/00058' }, 'caiet.pdf', new Map())
  assert.deepEqual(r, { id: null, completat: false, duplicat: true })
  assert.equal(randuri.length, 1)
})

Deno.test('cod SEAP deja pe alt rând, la completarea placeholder-ului → { duplicat }, placeholder-ul neatins, cheia consumată', async () => {
  const randuri: Rand[] = [
    { id: 40, nume_original: 'Caiet.pdf', fisier_path: '3/atribuire/neincarcat/Caiet.pdf', seap_cod: null },
    { id: 41, nume_original: 'Caiet (adus de worker).pdf', fisier_path: '3/atribuire/w', seap_cod: 'CN1/00010' },
  ]
  const ph = new Map([['caiet.pdf', 40]])
  const r = await scrieDocument(fake(randuri), { nume_original: 'Caiet.pdf', fisier_path: '3/atribuire/edge', seap_cod: 'CN1/00010' }, 'caiet.pdf', ph)
  assert.deepEqual(r, { id: null, completat: false, duplicat: true })
  assert.deepEqual(randuri[0], { id: 40, nume_original: 'Caiet.pdf', fisier_path: '3/atribuire/neincarcat/Caiet.pdf', seap_cod: null })
  assert.equal(ph.size, 0)
  assert.equal(randuri.length, 2)
})

Deno.test('23505 pe ALT index (sau altă eroare) rămâne eroare, nu „deja prezent”', async () => {
  const alt = { code: '23505', message: 'duplicate key value violates unique constraint "ofertare_documente_atribuire_pkey"' }
  const r = await scrieDocument(fake([], alt), { nume_original: 'X.pdf', fisier_path: '3/atribuire/x' }, 'x.pdf', new Map())
  assert.deepEqual(r, { id: null, completat: false, eroare: alt.message })
  const r2 = await scrieDocument(fake([], { code: '23514', message: 'tip invalid' }), { nume_original: 'X.pdf', fisier_path: '3/atribuire/x' }, 'x.pdf', new Map())
  assert.deepEqual(r2, { id: null, completat: false, eroare: 'tip invalid' })
})

Deno.test('cod nou (liber) → scris normal, cu codul, fără cheia duplicat în rezultat', async () => {
  const randuri: Rand[] = [{ id: 7, nume_original: 'A.pdf', fisier_path: '3/atribuire/a', seap_cod: 'CN1/00001' }]
  const r = await scrieDocument(fake(randuri), { nume_original: 'B.pdf', fisier_path: '3/atribuire/b', seap_cod: 'CN1/00002' }, 'b.pdf', new Map())
  assert.deepEqual(r, { id: 100, completat: false })
  assert.equal(randuri[1].seap_cod, 'CN1/00002')
})
