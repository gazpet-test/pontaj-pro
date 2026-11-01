// deno test worker/ofertare/poarta_coada_test.ts — a doua barieră pe cozile AI (20261124a, 3A)
import { assertEquals } from 'jsr:@std/assert@1'
import { cerereaTrecePoarta, NOTA_REFUZ } from './poarta_coada.ts'

function fake(o: { rand?: Record<string, unknown> | null; eroareCitire?: boolean; rpc?: { data: unknown; error: unknown } | 'arunca' }) {
  const j = { rpc: [] as unknown[], update: [] as Record<string, unknown>[] }
  const supa = {
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (o.eroareCitire ? { data: null, error: { message: 'x' } } : { data: o.rand ?? null, error: null }) }) }),
      update: (v: Record<string, unknown>) => ({ eq: async () => { j.update.push(v); return { error: null } } }),
    }),
    rpc: async (_f: string, a: unknown) => {
      j.rpc.push(a)
      if (o.rpc === 'arunca') throw new Error('rețea')
      return o.rpc ?? { data: true, error: null }
    },
  }
  return { supa, j }
}

Deno.test('cerut_de care trece poarta → da, fără nicio scriere', async () => {
  const { supa, j } = fake({ rand: { activ: true, cerut_de: 'u1' } })
  assertEquals(await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7), 'da')
  assertEquals(j.rpc, [{ p_licitatie_id: 7, p_uid: 'u1' }]); assertEquals(j.update, [])
})
Deno.test('poarta spune NU / cerut_de NULL → refuz, coada închisă cu notă', async () => {
  for (const o of [{ rand: { activ: true, cerut_de: 'u2' }, rpc: { data: false, error: null } }, { rand: { activ: true, cerut_de: null } }]) {
    const { supa, j } = fake(o)
    assertEquals(await cerereaTrecePoarta(supa, 'ofertare_clarificari_coada', 7), 'refuz')
    assertEquals(j.update.length, 1); assertEquals(j.update[0].activ, false); assertEquals(j.update[0].nota, NOTA_REFUZ)
  }
})
Deno.test('răspuns ne-boolean de la RPC → refuz (doar true trece)', async () => {
  const { supa } = fake({ rand: { activ: true, cerut_de: 'u1' }, rpc: { data: 'true', error: null } })
  assertEquals(await cerereaTrecePoarta(supa, 'ofertare_ingest_coada', 7), 'refuz')
})
Deno.test('RPC / citire căzută → eroare (nimic cheltuit, coada rămâne activă)', async () => {
  for (const o of [{ rand: { activ: true, cerut_de: 'u1' }, rpc: { data: null, error: { message: 'x' } } }, { eroareCitire: true },
                   { rand: { activ: true, cerut_de: 'u1' }, rpc: 'arunca' as const }]) {
    const { supa, j } = fake(o)
    assertEquals(await cerereaTrecePoarta(supa, 'ofertare_extragere_coada', 7), 'eroare'); assertEquals(j.update, [])
  }
})
Deno.test('coadă inactivă / rând lipsă → refuz fără RPC', async () => {
  for (const rand of [{ activ: false, cerut_de: 'u1' }, null]) {
    const { supa, j } = fake({ rand })
    assertEquals(await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7), 'refuz'); assertEquals(j.rpc, [])
  }
})
