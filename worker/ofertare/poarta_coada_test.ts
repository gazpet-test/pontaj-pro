// deno test worker/ofertare/poarta_coada_test.ts — a doua barieră pe cozile AI (20261124a, 3A; review #908 r2: P1-03 per cost, P2-01 CAS;
// r3: Copilot P2-01 cerut_de în CAS, P2-02 reconfirmare după RPC, P2-03 închiderea după erori verificată; Jakarinos P2-01 scrierile pe coadă)
import { assertEquals } from 'jsr:@std/assert@1'
import { cerereaTrecePoarta, gardaCheltuiala, NOTA_EROARE, NOTA_REFUZ, scrieCas, scrieCuReincercare } from './poarta_coada.ts'

type Rand = { activ: boolean; cerut_de: string | null; cerut_la: string; nota?: string; [k: string]: unknown } | null
// fake: un singur rând; filtrele .eq()/.is() ale UPDATE-ului se aplică pe el (CAS real); rpc programabil per apel, cu cârlig
// (dupaRpc) care poate schimba rândul ÎN TIMPUL RPC-ului (înlocuire / oprire concurentă)
function fake(o: { rand?: Rand; eroareCitire?: boolean; eroareUpdate?: boolean; rpc?: Array<{ data: unknown; error: unknown } | 'arunca'>;
  inainteDeUpdate?: (r: Rand) => Rand; dupaRpc?: (r: Rand) => Rand; eroriUpdate?: number }) {
  let rand: Rand = o.rand ?? null
  const j = { rpc: [] as unknown[], update: [] as Record<string, unknown>[], citiri: 0, incercariUpdate: 0 }
  let eroriRamase = o.eroriUpdate ?? 0
  const rpcs = [...(o.rpc ?? [])]
  const supa = {
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { j.citiri++; return o.eroareCitire ? { data: null, error: { message: 'x' } } : { data: rand ? { ...rand } : null, error: null } } }) }),
      update: (v: Record<string, unknown>) => {
        const filtre: Array<[string, unknown]> = []
        const exec = async () => {
          if (o.inainteDeUpdate) rand = o.inainteDeUpdate(rand)
          j.incercariUpdate++
          if (o.eroareUpdate) return { data: null, error: { message: 'x' } }
          if (eroriRamase > 0) { eroriRamase--; return { data: null, error: { message: 'x' } } }
          const potrivit = !!rand && filtre.every(([k, val]) => k === 'licitatie_id' || ((rand as any)[k] ?? null) === val)
          if (potrivit) { j.update.push(v); rand = { ...(rand as any), ...v } }
          return { data: potrivit ? [{ licitatie_id: 7 }] : [], error: null }
        }
        const q: any = { eq: (k: string, val: unknown) => { filtre.push([k, val]); return q }, is: (k: string, val: unknown) => { filtre.push([k, val]); return q },
          select: () => exec(), then: (a: any, b: any) => exec().then(a, b) }
        return q
      },
    }),
    rpc: async (_f: string, a: unknown) => {
      j.rpc.push(a)
      const r = rpcs.length ? rpcs.shift()! : { data: true, error: null }
      if (o.dupaRpc) rand = o.dupaRpc(rand)
      if (r === 'arunca') throw new Error('rețea')
      return r
    },
    get rand() { return rand },
  }
  return { supa, j }
}
const R = (cerut_de: string | null = 'u1', cerut_la = 'g1', activ = true) => ({ activ, cerut_de, cerut_la })
const C = (cerut_de: string | null = 'u1', cerut_la = 'g1') => ({ cerut_de, cerut_la })
const fara = { pauza: async () => {}, log: () => {} }

Deno.test('cerut_de care trece poarta → da + cererea (cerut_la + cerut_de), fără scriere', async () => {
  const { supa, j } = fake({ rand: R() })
  assertEquals(await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7), { v: 'da', cerere: C() })
  assertEquals(j.rpc, [{ p_licitatie_id: 7, p_uid: 'u1' }]); assertEquals(j.update, [])
})
Deno.test('poarta spune NU / cerut_de NULL / răspuns ne-boolean → refuz, cererea închisă cu notă (CAS pe aceeași cerere)', async () => {
  for (const o of [{ rand: R('u2'), rpc: [{ data: false, error: null }] }, { rand: R(null) }, { rand: R(), rpc: [{ data: 'true', error: null }] }]) {
    const { supa, j } = fake(o)
    assertEquals((await cerereaTrecePoarta(supa, 'ofertare_clarificari_coada', 7)).v, 'refuz')
    assertEquals(j.update.length, 1); assertEquals(j.update[0].activ, false); assertEquals(j.update[0].nota, NOTA_REFUZ)
  }
})
Deno.test('r2 P2-01: cererea înlocuită între citire și închidere (alt cerut_la) → „inlocuita”, rândul NOU nu se atinge', async () => {
  const { supa, j } = fake({ rand: R('u2'), rpc: [{ data: false, error: null }], inainteDeUpdate: () => R('owner', 'g2') })
  assertEquals((await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7)).v, 'inlocuita')
  assertEquals(j.update, []); assertEquals(supa.rand?.activ, true); assertEquals(supa.rand?.cerut_la, 'g2')
})
Deno.test('r3 Copilot P2-01: aceeași cerut_la, alt cerut_de → închiderea la refuz NU atinge cererea nouă', async () => {
  const { supa, j } = fake({ rand: R('u2'), rpc: [{ data: false, error: null }], inainteDeUpdate: () => R('owner', 'g1') })
  assertEquals((await cerereaTrecePoarta(supa, 'ofertare_acoperire_coada', 7)).v, 'inlocuita')
  assertEquals(j.update, []); assertEquals(supa.rand?.activ, true); assertEquals(supa.rand?.cerut_de, 'owner')
})
Deno.test('r3 Copilot P2-02: RPC spune DA, dar în timpul lui cererea e înlocuită / oprită → NU „da”', async () => {
  const a = fake({ rand: R('u1'), dupaRpc: () => R('owner', 'g2') })
  assertEquals((await cerereaTrecePoarta(a.supa, 'ofertare_acoperire_coada', 7)).v, 'inlocuita'); assertEquals(a.j.update, [])
  const b = fake({ rand: R('u1'), dupaRpc: (r) => ({ ...(r as any), activ: false }) })
  assertEquals((await cerereaTrecePoarta(b.supa, 'ofertare_acoperire_coada', 7)).v, 'refuz'); assertEquals(b.j.update, [])
  const c = fake({ rand: R('u1'), dupaRpc: () => R('u2', 'g1') })   // același cerut_la, alt cerut_de
  assertEquals((await cerereaTrecePoarta(c.supa, 'ofertare_acoperire_coada', 7)).v, 'inlocuita')
})
Deno.test('r2 P2-01: UPDATE-ul de închidere cade → eroare (nu „refuz” fals)', async () => {
  const { supa } = fake({ rand: R('u2'), rpc: [{ data: false, error: null }], eroareUpdate: true })
  assertEquals((await cerereaTrecePoarta(supa, 'ofertare_ingest_coada', 7)).v, 'eroare')
})
Deno.test('cererea dată diferă de cea din rând → inlocuita, fără RPC; rând oprit → refuz, fără RPC', async () => {
  const a = fake({ rand: R('u1', 'g2') })
  assertEquals((await cerereaTrecePoarta(a.supa, 'ofertare_acoperire_coada', 7, C('u1', 'g1'))).v, 'inlocuita'); assertEquals(a.j.rpc, [])
  const b = fake({ rand: R('u1', 'g1', false) })
  assertEquals((await cerereaTrecePoarta(b.supa, 'ofertare_acoperire_coada', 7, C('u1', 'g1'))).v, 'refuz'); assertEquals(b.j.rpc, [])
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
  const g = gardaCheltuiala(supa, 'ofertare_acoperire_coada', 7, C(), fara)
  assertEquals(await g(), true)    // felia 1
  assertEquals(await g(), false)   // revocat → felia 2 nu se mai plătește
  assertEquals(j.rpc.length, 2); assertEquals(supa.rand?.activ, false); assertEquals(supa.rand?.nota, NOTA_REFUZ)
})
Deno.test('garda: eroare persistentă → după reîncercări închide cererea (aceeași cerere) cu NOTA_EROARE, false', async () => {
  const err = { data: null, error: { message: 'x' } }
  const { supa, j } = fake({ rand: R(), rpc: [err, err, err] })
  const g = gardaCheltuiala(supa, 'ofertare_clarificari_coada', 7, C(), fara)
  assertEquals(await g(), false); assertEquals(j.rpc.length, 3); assertEquals(supa.rand?.nota, NOTA_EROARE); assertEquals(supa.rand?.activ, false)
})
Deno.test('r3 Copilot P2-03: închiderea după erori eșuează → false + semnalat (nu „închis” tăcut)', async () => {
  const err = { data: null, error: { message: 'x' } }
  const loguri: string[] = []
  const { supa } = fake({ rand: R(), rpc: [err, err, err], eroareUpdate: true })
  const g = gardaCheltuiala(supa, 'ofertare_ingest_coada', 7, C(), { pauza: async () => {}, log: (m) => loguri.push(m) })
  assertEquals(await g(), false); assertEquals(supa.rand?.activ, true); assertEquals(loguri.length, 1)
})
Deno.test('garda: eroare trecătoare apoi da → true, fără închidere', async () => {
  const { supa, j } = fake({ rand: R(), rpc: [{ data: null, error: { message: 'x' } }, { data: true, error: null }] })
  const g = gardaCheltuiala(supa, 'ofertare_ingest_coada', 7, C(), fara)
  assertEquals(await g(), true); assertEquals(j.update, [])
})
Deno.test('garda: cererea înlocuită (cerere nouă) → false, rândul nou neatins', async () => {
  const { supa, j } = fake({ rand: R('owner', 'g2') })
  const g = gardaCheltuiala(supa, 'ofertare_acoperire_coada', 7, C(), fara)
  assertEquals(await g(), false); assertEquals(j.update, []); assertEquals(supa.rand?.activ, true)
})
Deno.test('r3 Jakarinos P2-01: garda.scrie (progres + închiderea finală) e CAS — rezultatul rulării vechi nu închide cererea nouă', async () => {
  // g1 pornește, între timp ownerul pune g2; finalizarea lui g1 nu trebuie să atingă g2
  const { supa, j } = fake({ rand: R('u1', 'g1') })
  const g = gardaCheltuiala(supa, 'ofertare_clarificari_coada', 7, C('u1', 'g1'), fara)
  assertEquals(await g.scrie({ ultimul_tick: 't1' }), 'ok')
  const b = fake({ rand: R('owner', 'g2') })
  const gVechi = gardaCheltuiala(b.supa, 'ofertare_clarificari_coada', 7, C('u1', 'g1'), fara)
  assertEquals(await gVechi.scrie({ activ: false, nota: 'rezultat vechi' }), 'inlocuita')
  assertEquals(b.j.update, []); assertEquals(b.supa.rand?.activ, true); assertEquals(b.supa.rand?.nota, undefined)
  assertEquals(j.update, [{ ultimul_tick: 't1' }])
})
Deno.test('scrieCas: cerere fără cerut_de folosește IS NULL; eroare de scriere → „eroare”', async () => {
  const a = fake({ rand: R(null) })
  assertEquals(await scrieCas(a.supa, 'ofertare_ingest_coada', 7, C(null), { ultimul_tick: 'x' }), 'ok')
  const b = fake({ rand: R(), eroareUpdate: true })
  assertEquals(await scrieCas(b.supa, 'ofertare_ingest_coada', 7, C(), { ultimul_tick: 'x' }), 'eroare')
})
// r5 (review r5 Jakarinos P1-01 / Copilot P1-01): rezultatul unui apel DEJA PLĂTIT se persistă reîncercând ACEEAȘI scriere — funcția nu
// întoarce controlul buclei (care ar plăti din nou pasul) până nu e „ok” sau „stop”; nu există rezultatul „reia”
Deno.test('r5: AI reușit + scrierea progresului eșuează de 4 ori → aceeași scriere reîncercată până la ok, fără alt apel', async () => {
  const { supa, j } = fake({ rand: R(), eroriUpdate: 4 })
  const pauze: number[] = []
  const r = await scrieCuReincercare(supa, 'ofertare_extragere_coada', 7, C(), { poz: 3, cerinte_noi: 5 }, { oprire: () => false, pauza: async (ms) => { pauze.push(ms) } })
  assertEquals(r, 'ok'); assertEquals(j.incercariUpdate, 5); assertEquals(j.update, [{ poz: 3, cerinte_noi: 5 }]); assertEquals(j.rpc, []); assertEquals(j.citiri, 0)
  assertEquals(pauze, [30_000, 60_000, 90_000, 120_000])
})
Deno.test('r5: scriere eșuată persistent + worker oprit → „stop” (nu „reia”), fără alt apel; cererea înlocuită → „stop”, rândul nou neatins', async () => {
  let n = 0
  const a = fake({ rand: R(), eroareUpdate: true })
  assertEquals(await scrieCuReincercare(a.supa, 'ofertare_extragere_coada', 7, C(), { poz: 3 }, { oprire: () => ++n >= 3, pauza: async () => {} }), 'stop')
  assertEquals(a.j.incercariUpdate, 3); assertEquals(a.j.rpc, [])
  const b = fake({ rand: R('owner', 'g2') })
  assertEquals(await scrieCuReincercare(b.supa, 'ofertare_extragere_coada', 7, C(), { poz: 3 }, { oprire: () => false, pauza: async () => {} }), 'stop')
  assertEquals(b.j.update, []); assertEquals(b.supa.rand?.cerut_la, 'g2')
})// r6 (review r6 Jakarinos P1-01): aceeași persistare pe acoperire / clarificări / ingest — garda.scrie reîncearcă ACEEAȘI scriere (nu o
// abandonează, ceea ce ar lăsa cererea activă și preluarea următoare ar plăti din nou); 'eroare' doar dacă workerul se oprește între timp
Deno.test('r6: garda.scrie — închiderea finală eșuează de 2 ori → reîncercată până la ok, cererea închisă, fără apel RPC / AI', async () => {
  const { supa, j } = fake({ rand: R(), eroriUpdate: 2 })
  const g = gardaCheltuiala(supa, 'ofertare_clarificari_coada', 7, C(), fara)
  assertEquals(await g.scrie({ activ: false, nota: 'gata' }), 'ok')
  assertEquals(j.incercariUpdate, 3); assertEquals(supa.rand?.activ, false); assertEquals(supa.rand?.nota, 'gata'); assertEquals(j.rpc, [])
})
Deno.test('r6: garda.scrie — eșec persistent + worker oprit → „eroare” (rularea se oprește), cererea neatinsă; înlocuită → „inlocuita”', async () => {
  let n = 0
  const a = fake({ rand: R(), eroareUpdate: true })
  const g = gardaCheltuiala(a.supa, 'ofertare_acoperire_coada', 7, C(), { ...fara, oprire: () => ++n >= 2 })
  assertEquals(await g.scrie({ ultimul_tick: 't' }), 'eroare'); assertEquals(a.supa.rand?.activ, true); assertEquals(a.j.rpc, [])
  const b = fake({ rand: R('owner', 'g2') })
  assertEquals(await gardaCheltuiala(b.supa, 'ofertare_acoperire_coada', 7, C(), fara).scrie({ activ: false }), 'inlocuita'); assertEquals(b.supa.rand?.activ, true)
})