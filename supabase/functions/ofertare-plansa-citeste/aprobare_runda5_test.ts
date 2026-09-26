// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-plansa-citeste/aprobare_runda5_test.ts
// R5 runda 5 (verificatorul condițiilor 1–2 ale lui Copilot, 26.09.2026):
//  MAJOR 1 — rândul INVALIDAT (ieșit din rețea) nu mai dispare după o recitire a planșei: transferul îi păstrează prefixul, iar
//            poarta graficului îl ține în lipsă (lanțul transfer → grafic, pe rândul 2 real al lic. 3 trecut pe „ml”);
//  MAJOR 2 — plasa finală (`plasaAprobare`) măsoară față de valoarea APROBATĂ (istoric), deci și pașii mici cumulați ies din „validat”;
//  minor   — plasa e acoperită de teste: o ramură (simulată sau reală) care schimbă relevant un atribut al unui rând VALIDAT fără
//            status => „diferenta” + prefixul regulii.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { plasaAprobare, referinteAprobare, treciInCantitati } from './handler.ts'
import { aplicaRegulaAprobare } from './invalidare.js'
import { controlCantitatiGrafic, esteInvalidat } from '../../../src/ofertareCantitatiAprobare.js'

// fals Supabase cu tabele separate: ofertare_cantitati (select/eq) și ofertare_cantitati_istoric (select/in/order); rpc = transferul
function supaFals(cantitati: any[], istoric: any[] | 'eroare' | 'lipsa' = []) {
  const apeluri: any[] = [], citiriIstoric: any[] = []
  const supa = {
    from: (t: string) => {
      if (t === 'ofertare_cantitati_istoric') {
        if (istoric === 'lipsa') throw new Error('relation "ofertare_cantitati_istoric" does not exist')
        const b: any = { select: () => b, in: (_c: string, ids: unknown[]) => { citiriIstoric.push(ids); return b }, order: () => b,
          then: (ok: any, ko: any) => Promise.resolve(istoric === 'eroare'
            ? { data: null, error: { code: 'PGRST205', message: 'tabel lipsă' } } : { data: istoric, error: null }).then(ok, ko) }
        return b
      }
      const b: any = { select: () => b, eq: () => b, then: (ok: any, ko: any) => Promise.resolve({ data: cantitati, error: null }).then(ok, ko) }
      return b
    },
    rpc: (nume: string, a: any) => { apeluri.push({ nume, ...a }); return Promise.resolve({ data: { ok: true, adaugate: 0, actualizate: a.p_randuri.length }, error: null }) },
  }
  return { supa, apeluri, citiriIstoric }
}
const DOC = { id: 11, licitatie_id: 3, nume_original: 'PL1.1.pdf' }
const tr = (dn: number, l: number) => [{ diametru_mm: dn, material: 'PE100 SDR11', lungime_m: l, de_la: 'A', la: 'B' }]
// rândul 2 REAL al lic. 3 (validat, SELECT 26.09.2026)
const R2 = { id: 2, licitatie_id: 3, obiect: 'Magistrala', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn180 — extravilan Mănăstirea→Coconi',
  um: 'm', cantitate: 1100, cantitate_plansa: 2210, specificatii: 'PE100 SDR11', sursa: 'PT partea scrisă (memoriu)', tip_sursa: 'memoriu', cod_articol: null,
  status: 'validat', diferenta_nota: 'Memoriu 1.100 m vs planșa 1.1 2.210 m (+1.110 m, pe 2 tronsoane citite din tabel).', updated_at: '2026-09-15T15:19:53.008+00:00' }
const R1 = { id: 1, licitatie_id: 3, categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn250 — tronsoane magistrală', um: 'm', cantitate: 23630,
  cantitate_plansa: 34465, status: 'validat', sursa: 'PT partea scrisă (memoriu)', tip_sursa: 'memoriu' }
const aplica = (rows: any[], ops: any[]) => rows.map((r) => { const o = ops.find((x: any) => x.op === 'update' && x.id === r.id); return o ? { ...r, ...o.patch } : r })

Deno.test('MAJOR 1 (lanțul transfer → grafic): rândul 2 VALIDAT trecut pe „ml” (invalidat) + recitirea planșei => prefixul rămâne, poarta îl ține în lipsă', async () => {
  const ml = { ...R2, um: 'ml', ...aplicaRegulaAprobare(R2, { um: 'ml' }).patch }
  assert(esteInvalidat(ml) && ml.status === 'diferenta')
  const f = supaFals([R1, ml])
  await treciInCantitati(f.supa, DOC, tr(180, 2210), '1.1', 'R5')
  const ops = f.apeluri[0].p_randuri
  const o = ops.find((x: any) => x.id === 2)
  assert(o, 'rândul „ml” e candidat la transfer (eConducta)')
  assert(o.patch.diferenta_nota.startsWith('Rândul era VALIDAT — aprobarea veche (cantitate 1.100 m, cifra din planșă 2.210 m, ultima scriere 2026-09-15 15:19) nu mai e valabilă: s-a schimbat unitatea de măsură („m” → „ml”).'),
    `prefixul s-a pierdut: ${o.patch.diferenta_nota}`)
  assert(/planșa 1\.1/i.test(o.patch.diferenta_nota), 'nota recitirii e și ea acolo')
  const dupa = aplica([R1, ml], ops)
  const c = controlCantitatiGrafic(dupa, 'memoriu')
  assertEquals(c.stare, 'block', `grafic „cant” după transfer: ${c.stare} | lipsa: ${JSON.stringify(c.lipsa)}`)
  assertEquals(c.lista.map((x: any) => [x.id, x.motiv]), [[2, 'invalidat, ieșit din rețea']])
})

Deno.test('MAJOR 2 + minor (plasa, capăt la capăt): cifra din planșă 1.000 aprobată → 1.000,9 (sub prag) → recitire 1.001,5 => „diferenta” doar prin plasă, față de valoarea din istoric', async () => {
  const aprobat = { ...R2, cantitate: 1000, cantitate_plansa: 1000, diferenta_nota: null }
  const acum = { ...aprobat, cantitate_plansa: 1000.9 }
  const ist = [{ id: 1, cantitate_id: 2, motiv: 'validat', valori_vechi: { ...aprobat, status: 'extras' }, valori_noi: aprobat },
    { id: 2, cantitate_id: 2, motiv: 'modificat_sub_prag', valori_vechi: aprobat }]
  const f = supaFals([acum], ist)
  await treciInCantitati(f.supa, DOC, tr(180, 1001.5), '1.1', 'R5')
  assertEquals(f.citiriIstoric, [[2]], 'istoricul se citește doar pentru rândurile validate')
  const [o] = f.apeluri[0].p_randuri
  assertEquals([o.patch.cantitate_plansa, o.patch.status], [1001.5, 'diferenta'])
  assert(o.patch.diferenta_nota.startsWith('Rândul era VALIDAT — aprobarea veche (cantitate 1.000 m, cifra din planșă 1.000 m, ultima scriere 2026-09-15 15:19) nu mai e valabilă: s-a schimbat cifra din planșă (1.000 m → 1.001,5 m).'), o.patch.diferenta_nota)
  // control: fără istoric (tabel lipsă / eroare) => comparația cu rândul de acum, validarea rămâne (comportamentul de dinainte), fără excepții
  for (const mod of ['lipsa', 'eroare'] as const) {
    const g = supaFals([acum], mod)
    await treciInCantitati(g.supa, DOC, tr(180, 1001.5), '1.1', 'R5')
    assertEquals(g.apeluri[0].p_randuri[0].patch.status, undefined, mod)
  }
})

Deno.test('minor (plasa, ramură simulată): patch fără status care schimbă relevant un atribut al unui rând VALIDAT => „diferenta” + prefixul', () => {
  const ops: any[] = [{ op: 'update', id: 2, patch: { specificatii: 'PE80 SDR17', diferenta_nota: 'nota ramurii' } },
    { op: 'update', id: 1, patch: { diferenta_nota: 'doar notă' } }, { op: 'insert', row: { denumire: 'x' } }]
  plasaAprobare(ops, [R1, R2])
  assertEquals(ops[0].patch.status, 'diferenta')
  assert((ops[0].patch.diferenta_nota as string).startsWith('Rândul era VALIDAT — aprobarea veche (cantitate 1.100 m, cifra din planșă 2.210 m'), ops[0].patch.diferenta_nota as string)
  assert((ops[0].patch.diferenta_nota as string).includes('s-a schimbat materialul PE100 → PE100/PE80; SDR 11 → 11/17') && (ops[0].patch.diferenta_nota as string).endsWith('nota ramurii'))
  assertEquals((ops[1].patch as any).status, undefined, 'doar notă => validarea rămâne')
  // cu referința din istoric: cifra de acum 2.210,6 (sub prag), ramura scrie 2.211,2 (față de acum 0,6 m; față de aprobat 1,2 m)
  const ops2: any[] = [{ op: 'update', id: 2, patch: { cantitate_plansa: 2211.2 } }]
  plasaAprobare(ops2, [{ ...R2, cantitate_plansa: 2210.6 }], new Map([[2, R2]]))
  assertEquals((ops2[0].patch as any).status, 'diferenta')
  const ops3: any[] = [{ op: 'update', id: 2, patch: { cantitate_plansa: 2211.2 } }]
  plasaAprobare(ops3, [{ ...R2, cantitate_plansa: 2210.6 }])
  assertEquals((ops3[0].patch as any).status, undefined, 'fără referință: comparația cu rândul de acum (sub prag)')
})

Deno.test('referinteAprobare: fără id-uri nu citește; eroare / tabel lipsă / rânduri străine => Map gol', async () => {
  const f = supaFals([], [{ id: 1, licitatie_id: 3, denumire: 'nu e eveniment' }])
  assertEquals((await referinteAprobare(f.supa, [])).size, 0)
  assertEquals(f.citiriIstoric.length, 0)
  assertEquals((await referinteAprobare(f.supa, [2])).size, 0)
  assertEquals((await referinteAprobare(supaFals([], 'eroare').supa, [2])).size, 0)
  assertEquals((await referinteAprobare(supaFals([], 'lipsa').supa, [2])).size, 0)
  assertFalse((await referinteAprobare(supaFals([], [{ id: 3, cantitate_id: 2, motiv: 'validat', valori_noi: R2 }]).supa, [2])).size === 0)
})
