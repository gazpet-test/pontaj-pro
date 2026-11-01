// deno test worker/ofertare/poarta_coada_test.ts — a doua barieră pe cozile AI (20261124a, 3A; review #908 r2: P1-03 per cost, P2-01 CAS)
import { assertEquals } from 'jsr:@std/assert@1'
import { cerereaTrecePoarta, gardaCheltuiala, NOTA_EROARE, NOTA_REFUZ } from './poarta_coada.ts'

type Rand = { activ: boolean; cerut_de: string | null; cerut_la: string } | null
// fake: un singur rând, filtrele .eq() ale UPDATE-ului se aplică pe el (CAS real), rpc programabil per apel
function fake(o: { rand?: Rand; eroareCitire?: boolean; eroareUpdate?: boolean; rpc?: Array<{ data: unknown; error: unknown } | 'arunca'>; inainteDeUpdate?: (r: Rand) => Rand }) {
  let rand: Rand = o.rand ?? null
  const j = { rpc: [] as unknown[], update: [] as Record<string, unknown>[], citiri: 0 }
  const rpcs = [...(o.rpc ?? [])]
  const supa = {
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { j.citiri++; return o.eroareCitire ? { data: null, error: { message: 'x' } } : { data: rand ? { ...rand } : null, error: null } } }) }),
      update: (v: Record<string, unknown>) => {
        const filtre: Record<string, unknown> = {}
        const exec = async () => {
          if (o.inainteDeUpdate) rand = o.inainteDeUpdate(rand)
          if (o.eroareUpdate) return { data: null, error: { message: 'x' } }
          const potrivit = !!rand && Object.entries(filtre).every(([k, val]) => k === 'licitatie_id' || (rand as any)[k] === val)
          if (potrivit) { j.update.push(v); rand = { ...(rand as any), ...v } }
          return { data: potrivit ? [{ licitatie_id: 7 }] : [], error: null }
        }
        const q: any = { eq: (k: string, val: unknown) => { filtre[k] = val; return q }, select: () => exec(), then: (a: any, b: any) => exec().then(a, b) }
        return q
      },
    }),
    rpc: async (_f: string, a: unknown) => {
      j.rpc.push(a)
      const r = rpcs.length ? rpcs.shift()! : { data: true, error: null }
      if (r === 'arunca') throw new Error('rețea')
      return r
    },
    get rand() { return rand },
  }
  return { supa, j }
}
const R = (cerut_de: string | null = 'u1', cerut_la = 'g1', activ = true) => ({ activ, cerut_de, cerut_la })

Deno.test('cerut_de care trece poarta → da + generația, fără scriere', async () => {
  const { supa, j } = fake({ rand: R() })
  assertEquals(await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7), { v: 'da', generatie: 'g1' })
  assertEquals(j.rpc, [{ p_licitatie_id: 7, p_uid: 'u1' }]); assertEquals(j.update, [])
})
Deno.test('poarta spune NU / cerut_de NULL / răspuns ne-boolean → refuz, cererea închisă cu notă (CAS pe aceeași generație)', async () => {
  for (const o of [{ rand: R('u2'), rpc: [{ data: false, error: null }] }, { rand: R(null) }, { rand: R(), rpc: [{ data: 'true', error: null }] }]) {
    const { supa, j } = fake(o)
    assertEquals((await cerereaTrecePoarta(supa, 'ofertare_clarificari_coada', 7)).v, 'refuz')
    assertEquals(j.update.length, 1); assertEquals(j.update[0].activ, false); assertEquals(j.update[0].nota, NOTA_REFUZ)
  }
})
Deno.test('P2-01: cererea înlocuită între citire și închidere (alt cerut_la) → „inlocuita”, rândul NOU nu se atinge', async () => {
  const { supa, j } = fake({ rand: R('u2'), rpc: [{ data: false, error: null }], inainteDeUpdate: () => R('owner', 'g2') })
  assertEquals((await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7)).v, 'inlocuita')
  assertEquals(j.update, []); assertEquals(supa.rand?.activ, true); assertEquals(supa.rand?.cerut_la, 'g2')
})
Deno.test('P2-01: UPDATE-ul de închidere cade → eroare (nu „refuz” fals)', async () => {
  const { supa } = fake({ rand: R('u2'), rpc: [{ data: false, error: null }], eroareUpdate: true })
  assertEquals((await cerereaTrecePoarta(supa, 'ofertare_ingest_coada', 7)).v, 'eroare')
})
Deno.test('generația cerută diferă de cea din rând → inlocuita, fără RPC', async () => {
  const { supa, j } = fake({ rand: R('u1', 'g2') })
  assertEquals((await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7, 'g1')).v, 'inlocuita'); assertEquals(j.rpc, [])
})
Deno.test('RPC / citire căzută → eroare, nimic scris', async () => {
  for (const o of [{ rand: R(), rpc: [{ data: null, error: { message: 'x' } }] }, { eroareCitire: true }, { rand: R(), rpc: ['arunca' as const] }]) {
    const { supa, j } = fake(o)
    assertEquals((await cerereaTrecePoarta(supa, 'ofertare_extragere_coada', 7)).v, 'eroare'); assertEquals(j.update, [])
  }
})
Deno.test('coadă inactivă / rând lipsă → refuz fără RPC', async () => {
  for (const rand of [R('u1', 'g1', false), null]) {
    const { supa, j } = fake({ rand })
    assertEquals((await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7)).v, 'refuz'); assertEquals(j.rpc, [])
  }
})
Deno.test('P1-03: garda întreabă poarta la FIECARE cost — revocarea între două felii oprește a doua', async () => {
  const { supa, j } = fake({ rand: R(), rpc: [{ data: true, error: null }, { data: false, error: null }] })
  const g = gardaCheltuiala(supa, 'ofertare_acoperire_coada', 7, 'g1', { pauza: async () => {} })
  assertEquals(await g(), true)    // felia 1
  assertEquals(await g(), false)   // revocat → felia 2 nu se mai plătește
  assertEquals(j.rpc.length, 2); assertEquals(supa.rand?.activ, false); assertEquals(supa.rand?.nota, NOTA_REFUZ)
})
Deno.test('garda: eroare persistentă → după reîncercări închide cererea (aceeași generație) cu NOTA_EROARE, false', async () => {
  const err = { data: null, error: { message: 'x' } }
  const { supa, j } = fake({ rand: R(), rpc: [err, err, err] })
  const g = gardaCheltuiala(supa, 'ofertare_clarificari_coada', 7, 'g1', { pauza: async () => {} })
  assertEquals(await g(), false); assertEquals(j.rpc.length, 3); assertEquals(supa.rand?.nota, NOTA_EROARE); assertEquals(supa.rand?.activ, false)
})
Deno.test('garda: eroare trecătoare apoi da → true, fără închidere', async () => {
  const { supa, j } = fake({ rand: R(), rpc: [{ data: null, error: { message: 'x' } }, { data: true, error: null }] })
  const g = gardaCheltuiala(supa, 'ofertare_ingest_coada', 7, 'g1', { pauza: async () => {} })
  assertEquals(await g(), true); assertEquals(j.update, [])
})
Deno.test('garda: cererea înlocuită (generație nouă) → false, rândul nou neatins', async () => {
  const { supa, j } = fake({ rand: R('owner', 'g2') })
  const g = gardaCheltuiala(supa, 'ofertare_acoperire_coada', 7, 'g1', { pauza: async () => {} })
  assertEquals(await g(), false); assertEquals(j.update, []); assertEquals(supa.rand?.activ, true)
})
