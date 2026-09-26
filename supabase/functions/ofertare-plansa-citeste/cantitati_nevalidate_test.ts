// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-plansa-citeste/cantitati_nevalidate_test.ts
// R5 (Copilot 25.09.2026): la RECITIREA unei planșe, rândurile scrise de transferul anterior (extrase, nevalidate)
// nu mai sunt tratate ca memoriu: fără „confirmă" fals, fără „Memoriu X m" pe o cifră care e tot din planșă.
// Fixture = rândurile REALE 1751–1756 ale lic. 95 (SELECT pe ofertare_cantitati, 25.09.2026).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { randDinPlansa, treciInCantitati } from './handler.ts'

const SURSA = 'Planșa 1 — tabel de dimensionare, citit automat din scanare'
const rand = (id: number, dn: number, m: number, extra: any = {}) => ({ id, licitatie_id: 95, denumire: `Conductă distribuție gaze Dn${dn}`, categorie: 'Conducte și montaj',
  um: 'm', cantitate: m, cantitate_plansa: m, status: 'extras', sursa: SURSA, tip_sursa: null, ...extra })
const LIC95 = () => [rand(1751, 200, 17785), rand(1752, 125, 2275), rand(1753, 110, 780), rand(1754, 90, 4545), rand(1755, 63, 9670), rand(1756, 40, 13140)]

function supaFals(existente: any[]) {
  const apeluri: any[] = []
  let select = ''
  const supa = {
    from: (_t: string) => {
      const b: any = { select: (s: string) => { select = s; return b }, eq: () => b,
        then: (ok: any, ko: any) => Promise.resolve({ data: existente, error: null }).then(ok, ko) }
      return b
    },
    rpc: (nume: string, a: any) => { apeluri.push({ nume, ...a }); return Promise.resolve({ data: { ok: true, adaugate: 0, actualizate: a.p_randuri.length }, error: null }) },
  }
  return { supa, apeluri, select: () => select }
}
// tronsoane din recitire: câte un tronson PE pe diametru, cu lungimile date
const tr = (m: Record<number, number>) => Object.entries(m).map(([dn, l]) => ({ diametru_mm: Number(dn), material: 'PE', lungime_m: l, de_la: 'A', la: 'B' }))
const DOC = { id: 470, licitatie_id: 95, nume_original: 'PL1.pdf' }

Deno.test('randDinPlansa: sursa de transfer sau tip_sursa=plansa = din planșă; memoriu nu', () => {
  assert(randDinPlansa({ sursa: SURSA }))
  assert(randDinPlansa({ tip_sursa: 'plansa', sursa: 'x' }))
  assertFalse(randDinPlansa({ tip_sursa: 'memoriu', sursa: 'Memoriu tehnic, pag. 4' }))
  assertFalse(randDinPlansa(null))
})

Deno.test('R5: recitire cu aceleași cifre pe 1752–1755 => NU „confirmă", status neschimbat', async () => {
  const f = supaFals(LIC95())
  await treciInCantitati(f.supa, DOC, tr({ 125: 2275, 110: 780, 90: 4545, 63: 9670 }), '1', 'R2')
  assert(/\bsursa\b/.test(f.select()) && /\btip_sursa\b/.test(f.select()), 'select-ul citește sursa și tip_sursa')
  const ops = f.apeluri[0].p_randuri
  assertEquals(ops.map((o: any) => o.id), [1752, 1753, 1754, 1755])
  for (const o of ops) {
    assertFalse(/confirmă/.test(o.patch.diferenta_nota), `fals „confirmă" pe ${o.id}: ${o.patch.diferenta_nota}`)
    assertFalse(/^Memoriu/.test(o.patch.diferenta_nota))
    assert(/nu confirmare din memoriu/.test(o.patch.diferenta_nota))
    assertEquals(o.patch.status, undefined, 'statusul rămâne extras (nevalidat), nu devine altceva')
  }
})

Deno.test('R5: Dn40 recitit 13.740 (dedup multiset) vs 13.140 în rând => „citirea anterioară", nu „Memoriu"; status diferenta', async () => {
  const f = supaFals(LIC95())
  await treciInCantitati(f.supa, DOC, tr({ 40: 13740 }), '1', 'R2')
  const [o] = f.apeluri[0].p_randuri
  assertEquals(o.id, 1756)
  assertEquals(o.patch.cantitate_plansa, 13740)
  assert(/citirea anterioară/.test(o.patch.diferenta_nota), o.patch.diferenta_nota)
  assertFalse(/Memoriu 13/.test(o.patch.diferenta_nota))
  assertEquals(o.patch.status, 'diferenta')
})

Deno.test('R5: un rând VALIDAT de om nu primește status nou (regula veche păstrată)', async () => {
  const f = supaFals(LIC95().map((r) => r.id === 1756 ? { ...r, status: 'validat' } : r))
  await treciInCantitati(f.supa, DOC, tr({ 40: 13740 }), '1', 'R2')
  assertEquals(f.apeluri[0].p_randuri[0].patch.status, undefined)
})

Deno.test('regula veche neschimbată pentru memoriu: „confirmă" doar când memoriul chiar are cifra', async () => {
  const mem = [{ id: 1, licitatie_id: 95, denumire: 'Țeavă PE100 SDR11 Dn110', categorie: 'Conducte și montaj', um: 'm', cantitate: 500, status: 'extras', sursa: 'Memoriu tehnic', tip_sursa: 'memoriu' }]
  const f1 = supaFals(structuredClone(mem))
  await treciInCantitati(f1.supa, DOC, tr({ 110: 500 }), '1', 'R')
  assertEquals(f1.apeluri[0].p_randuri[0].patch.diferenta_nota, 'Planșa 1 confirmă: 500 m.')
  const f2 = supaFals(structuredClone(mem))
  await treciInCantitati(f2.supa, DOC, tr({ 110: 620 }), '1', 'R')
  assert(/^Memoriu 500 m vs planșa 1 620 m/.test(f2.apeluri[0].p_randuri[0].patch.diferenta_nota))
  assertEquals(f2.apeluri[0].p_randuri[0].patch.status, 'diferenta')
})
