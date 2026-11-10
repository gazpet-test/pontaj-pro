// citeste-orice / potrivire.ts — r6 (PR #1050, migrarea 20261209a): candidații de potrivire pe proiect vin din BD, doar proiectele
// permise contului care a urcat documentul. Client Supabase simulat (fără rețea, fără secrete). Rulare:
//   deno test -A --node-modules-dir=none supabase/functions/citeste-orice/potrivire_test.ts
import { strict as assert } from 'node:assert'
import { bestMatch, functieLipsa, PARAM_CANDIDATI, potrivesteProiect, proiecteCandidat, RPC_CANDIDATI } from './potrivire.ts'

// Proiectele de probă. Indiciul AI „Prunisor Jupa” potrivește PERFECT proiectul 30 (ascuns lui B) și slab proiectul 10.
const P10 = { id: 10, nume: 'Conducta Domnesti Ploiesti', cod_intern: 'DOM-01' }
const P20 = { id: 20, nume: 'Racord Brazi Nord', cod_intern: 'BRZ-02' }
const P30 = { id: 30, nume: 'Conducta Prunisor Jupa', cod_intern: 'PRJ-30' }
const TOATE = [P10, P20, P30]
const B = '00000000-0000-4000-8000-0000000000b0'

type Apel = { tip: 'rpc' | 'from', fn?: string, args?: Record<string, unknown>, tabel?: string, sel?: string, eq?: [string, unknown] }
function client(rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown, error: any }>) {
  const apeluri: Apel[] = []
  return {
    apeluri,
    rpc: (fn: string, args: Record<string, unknown>) => { apeluri.push({ tip: 'rpc', fn, args }); return rpc(fn, args) },
    from: (tabel: string) => ({
      select: (sel: string) => ({
        eq: (col: string, val: unknown) => {
          apeluri.push({ tip: 'from', tabel, sel, eq: [col, val] })
          return Promise.resolve({ data: tabel === 'executie_proiecte' && col === 'activ' && val === true ? TOATE : [], error: null })
        },
      }),
    }),
  }
}
// BD-ul simulat: B e restrâns pe 10 + 20; ceilalți (și NULL) văd tot
const bdCuMigrare = client(async (_fn, args) => ({ data: args[PARAM_CANDIDATI] === B ? [P10, P20] : TOATE, error: null }))

Deno.test('cont restrâns: proiectul ascuns NU e candidat, deci indiciul care îl potrivește perfect nu dă nicio potrivire (rândul rămâne fără proiect)', async () => {
  // martor: fără restricție (lista de azi), același indiciu ar potrivi proiectul 30
  assert.equal(bestMatch('Prunisor Jupa', TOATE, ['nume', 'cod_intern'], true)?.id, 30)
  const c = client(async (_fn, args) => ({ data: args[PARAM_CANDIDATI] === B ? [P10, P20] : TOATE, error: null }))
  const r = await potrivesteProiect(c, B, 'Prunisor Jupa')
  assert.deepEqual(r, { ok: true, potrivire: null, sursa: 'bd' })
  assert.deepEqual(c.apeluri, [{ tip: 'rpc', fn: 'fn_executie_acces_candidati', args: { p_profile: B } }])   // fără citirea tuturor proiectelor
})

Deno.test('cont restrâns: potrivirea pe un proiect permis merge ca înainte (același scor)', async () => {
  const r = await potrivesteProiect(bdCuMigrare, B, 'ordin incepere Domnesti Ploiesti')
  assert.deepEqual(r, { ok: true, potrivire: bestMatch('ordin incepere Domnesti Ploiesti', TOATE, ['nume', 'cod_intern'], true), sursa: 'bd' })
  assert.equal(r.ok && r.potrivire?.id, 10)
})

Deno.test('cont nerestrâns / rând fără cont: candidații din BD sunt toți, potrivirea e cea de azi', async () => {
  const c = client(async () => ({ data: TOATE, error: null }))
  const r = await potrivesteProiect(c, null, 'Prunisor Jupa')
  assert.deepEqual(r, { ok: true, potrivire: { id: 30, conf: 100 }, sursa: 'bd' })
  assert.deepEqual(c.apeluri[0], { tip: 'rpc', fn: 'fn_executie_acces_candidati', args: { p_profile: null } })   // NULL trimis explicit
})

Deno.test('migrarea neaplicată (funcția lipsește din API, PGRST202 pe numele ei): EXACT interogarea de azi', async () => {
  const c = client(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_executie_acces_candidati(p_profile) in the schema cache' } }))
  const r = await proiecteCandidat(c, B)
  assert.deepEqual(r, { ok: true, proiecte: TOATE, sursa: 'compat' })
  assert.deepEqual(c.apeluri[1], { tip: 'from', tabel: 'executie_proiecte', sel: 'id,nume,cod_intern', eq: ['activ', true] })
})

Deno.test('orice altă eroare NU e „funcție lipsă”: refuz (rândul trece în eroare), fără să citească toate proiectele (L18)', async () => {
  const erori: any[] = [
    { code: '42501', message: 'permission denied for function fn_executie_acces_candidati' },   // drept retras
    { code: 'PGRST202', message: 'Could not find the function public.alta_functie(x) in the schema cache' },   // alt nume
    { code: '57014', message: 'canceling statement due to statement timeout' },
    { code: '', message: 'FetchError: network' },
    { code: 'PGRST301', message: 'JWT expired' },
  ]
  for (const e of erori) {
    const c = client(async () => ({ data: null, error: e }))
    const r = await potrivesteProiect(c, B, 'Prunisor Jupa')
    assert.equal(r.ok, false, JSON.stringify(e))
    assert.equal(c.apeluri.filter(a => a.tip === 'from').length, 0, JSON.stringify(e))
  }
  // excepție aruncată de client (rețea) = același refuz
  const c = client(() => Promise.reject(new Error('conexiune închisă')))
  assert.equal((await potrivesteProiect(c, B, 'Prunisor Jupa')).ok, false)
  assert.equal(c.apeluri.filter(a => a.tip === 'from').length, 0)
})

Deno.test('răspuns invalid din BD = refuz, nu „toate” (formă [{id, nume, cod_intern}])', async () => {
  for (const data of [null, {}, 'x', [{ id: '30', nume: 'x' }], [{ id: 0 }], [{ id: 1.5 }], [null], [P10, { nume: 'fara id' }]]) {
    const c = client(async () => ({ data, error: null }))
    assert.equal((await proiecteCandidat(c, B)).ok, false, JSON.stringify(data))
  }
  // listă goală = niciun candidat (cont restrâns pe proiecte inactive): nu e eroare, nu e „toate”
  const g = client(async () => ({ data: [], error: null }))
  assert.deepEqual(await potrivesteProiect(g, B, 'Prunisor Jupa'), { ok: true, potrivire: null, sursa: 'bd' })
})

Deno.test('functieLipsa: doar PGRST202 cu numele funcției', () => {
  assert.equal(functieLipsa({ code: 'PGRST202', message: 'Could not find the function public.fn_executie_acces_candidati(p_profile) in the schema cache' }), true)
  assert.equal(functieLipsa({ code: '42883', message: 'function public.fn_executie_acces_candidati(uuid) does not exist' }), false)
  assert.equal(functieLipsa(null), false)
})

// Semnătura chemată de edge = cea din migrare (nume, parametru, tip întors, EXECUTE doar service_role): o greșeală de nume / parametru
// ar da PGRST202 și ar trece TĂCUT pe calea de compatibilitate (toate proiectele). Sursa independentă e textul migrării, nu potrivire.ts.
Deno.test('semnătura RPC = cea din migrarea 20261209a (altfel calea de compatibilitate ar ascunde greșeala)', async () => {
  const mig = (await Deno.readTextFile(new URL('../../migrations/20261209a_executie_acces_proiect.sql', import.meta.url))).replace(/\r/g, '')
  assert.equal(RPC_CANDIDATI, 'fn_executie_acces_candidati')
  assert.equal(PARAM_CANDIDATI, 'p_profile')
  assert.ok(mig.includes(`CREATE FUNCTION public.${RPC_CANDIDATI}(${PARAM_CANDIDATI} uuid) RETURNS jsonb\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$`))
  const granturi = mig.split('\n').filter(l => /^(GRANT|REVOKE) /.test(l) && l.includes(`public.${RPC_CANDIDATI}(`))
  assert.deepEqual(granturi, [
    `REVOKE ALL ON FUNCTION public.${RPC_CANDIDATI}(uuid) FROM PUBLIC, anon, authenticated, service_role;`,
    `GRANT EXECUTE ON FUNCTION public.${RPC_CANDIDATI}(uuid) TO service_role;`,
  ])
})

// index.ts nu mai citește direct lista proiectelor (singura cale = potrivesteProiect, cu contul care a URCAT rândul)
Deno.test('index.ts: potrivirea pe proiect trece doar prin candidații contului care a urcat', async () => {
  const idx = (await Deno.readTextFile(new URL('./index.ts', import.meta.url))).replace(/\r/g, '')
  assert.ok(!idx.includes(`from('executie_proiecte')`), 'index.ts citește direct executie_proiecte')
  assert.ok(idx.includes(`await potrivesteProiect(supabase, row.uploadat_de ?? null, parsed.entitate_hint)`))
  assert.ok(idx.includes(`if (!p.ok) return await eroare(p.err)`))
})
