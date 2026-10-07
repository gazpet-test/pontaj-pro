// deno test supabase/functions/ofertare-seap-import/placeholder_test.ts — completarea placeholder-ului o singură dată (audit #2)
import { strict as assert } from 'node:assert'
import { scrieDocument } from './placeholder.ts'

type Rand = Record<string, unknown>
function fake(randuri: Rand[]) {
  let next = 100
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
          if (r) Object.assign(r, patch)
          return { data: r ? [{ id: r.id }] : [], error: null }
        })() : b,
        maybeSingle: async () => { const r = { id: next++, ...patch }; randuri.push(r); return { data: { id: r.id }, error: null } },
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
