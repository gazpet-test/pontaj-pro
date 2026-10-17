// deno test supabase/functions/ofertare-cantitati-extrage/poarta_admin_test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { type BugetPoarta, type CererePoarta, motivRefuzAdmin, PLAFON_ADMIN_USD } from './poarta_admin.ts'

const ACUM = Date.parse('2026-10-17T12:00:00Z')
const C = { id: 7, licitatie_id: 95, scop: 'cant_extragere', stare: 'activa', valabil_pana: '2026-10-18T12:00:00Z' }
const B = { plafon_usd: 5, blocat: false }
const baza = { este_admin: true, licitatie_id: 95, cerere_id: 7, cerere: C as CererePoarta, buget: B as BugetPoarta, acum: ACUM }

Deno.test('poarta admin: plafonul adminului e 5 USD (identic cu 20261031d)', () => { assertEquals(PLAFON_ADMIN_USD, 5) })
Deno.test('poarta admin: toate condițiile îndeplinite -> trece', () => {
  assertEquals(motivRefuzAdmin(baza), null)
  assertEquals(motivRefuzAdmin({ ...baza, buget: { plafon_usd: '4.99', blocat: false } }), null)
  assertEquals(motivRefuzAdmin({ ...baza, cerere: { ...C, id: '7', licitatie_id: '95' } }), null)   // bigint venit ca text
})
Deno.test('poarta admin: nu e admin -> refuz, orice altceva ar fi', () => {
  assertEquals(motivRefuzAdmin({ ...baza, este_admin: false }), 'nu_e_admin')
})
Deno.test('poarta admin: cererea — lipsă, alt id, altă licitație, alt scop, inactivă, expirată, dată invalidă', () => {
  const cazuri: Partial<typeof baza>[] = [
    { cerere: null }, { cerere_id: 8 }, { cerere_id: 0 }, { cerere: { ...C, licitatie_id: 96 } }, { cerere: { ...C, scop: 'audit_raspunsuri' } },
    { cerere: { ...C, stare: 'consumata' } }, { cerere: { ...C, stare: 'anulata' } }, { cerere: { ...C, valabil_pana: '2026-10-17T12:00:00Z' } },
    { cerere: { ...C, valabil_pana: 'nu-e-data' } },
  ]
  for (const x of cazuri) assertEquals(motivRefuzAdmin({ ...baza, ...x }), 'cerere', JSON.stringify(x))
})
Deno.test('poarta admin: bugetul — lipsă / neinterpretabil, peste 5, blocat', () => {
  const lipsa: BugetPoarta[] = [null, { plafon_usd: null, blocat: false }, { plafon_usd: '', blocat: false }, { plafon_usd: 'abc', blocat: false }]
  for (const b of lipsa) assertEquals(motivRefuzAdmin({ ...baza, buget: b }), 'buget_lipsa', JSON.stringify(b))
  for (const p of [5.01, '5.01', 100]) assertEquals(motivRefuzAdmin({ ...baza, buget: { plafon_usd: p, blocat: false } }), 'plafon_peste_admin')
  // plafon > 5 ȘI blocat: motivul e plafonul (oricum refuz)
  assertEquals(motivRefuzAdmin({ ...baza, buget: { plafon_usd: 50, blocat: true } }), 'plafon_peste_admin')
  for (const bl of [true, null]) assertEquals(motivRefuzAdmin({ ...baza, buget: { plafon_usd: 5, blocat: bl } }), 'buget_blocat')
})
