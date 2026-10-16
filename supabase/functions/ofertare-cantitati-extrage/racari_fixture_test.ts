// TKT-0329 B (PR3): pipeline-ul determinist pe fixture-ul Răcari (lic. 15) — NU e golden (nu testează modelul, ci normalizarea și
// poziția dovedită pe rândurile reale din texte). Fixture: supabase/tests/fixtures/tkt0329_racari_text_fixture.json (din text_extras,
// sha-urile verificate cu BD la 15.10.2026; neverificat de om pe PDF).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { normalizeazaRand, randDinTablou } from '../_shared/cantNormalizare.ts'
import { pozitieDovedita } from '../_shared/cantNumar.ts'

const F = JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/tkt0329_racari_text_fixture.json', import.meta.url)))

Deno.test('Răcari F3: cele 16 rânduri Dn 90 din text, cu convenția EN a listei → dovedite, Dn 90, total 6.400 m', async () => {
  let total = 0
  for (const e of F.f3_dn90) {
    // val 2 (PR-A): în lista F3 pdftotext denumirea (cu „D= 90 MM”) e pe liniile de SUB rândul cantității — sursa se reface ca în text
    const felie = (e.rand_text as string).includes('|') ? e.rand_text as string : `${e.rand_text}
${e.denumire_text}
0.000 0 Total=`
    const r = randDinTablou([null, null, null, e.cod_articol_text, e.denumire_text, e.obiect, null, null, null, 'M', e.cantitate_text, 0, 0,
      'conducta', 'lungime', felie])!
    const n = (await normalizeazaRand(r, { textDoc: felie, felie, felie_de_la: 0, conventie: 'en', lot_domeniu: 'toate', lot_nr: [],
      rol_sursa: 'f3', rol_decis_de: 'antet' }))!
    assertEquals([n.obs.pozitie_dovedita, n.obs.um_norm, n.obs.cantitate], [true, 'm', e.cantitate], `obiect ${e.obiect}`)
    assert((n.obs.dn_mm as number[]).includes(90), `Dn 90 lipsă pe ${e.obiect}`)
    // offsetul în felie = offsetul fixture-ului relativ la începutul rândului
    assertEquals(n.obs.cantitate_offset, e.cantitate_offset - e.rand_interval[0])
    total += n.obs.cantitate as number
  }
  assertEquals([F.f3_dn90.length, total], [16, 6400])
})

Deno.test('Răcari F3 fără convenție: „570.000” e ambiguu (570 / 570.000) → nedovedit; „1160.000” (4 cifre întregi) e unic → dovedit', () => {
  const rez = F.f3_dn90.map((e: any) => {
    const p = pozitieDovedita({ felie: e.rand_text, felie_de_la: 0, citat: e.rand_text, cantitate: e.cantitate, um: 'm', conventie: 'nedeterminata' })
    return [e.cantitate_text, p.pozitie_dovedita, p.valoare_ambigua]
  })
  assertEquals(rez.filter((x: any) => x[1]).map((x: any) => x[0]), ['1160.000'])
  assertEquals(rez.filter((x: any) => x[2]).length, 15)
})

Deno.test('Răcari: valorile declarate rămân distincte, cu sursă (6.400 F3 vs 3.995 ATR / CS / Fișă) — fixture-ul nu împacă nimic', () => {
  assertEquals(F.sume.f3_dn90, 6400)
  assertEquals(F.sume.declarat_cs_fisa, 3995)
  assert(F.totaluri.some((t: any) => t.rol === 'atr' && t.valoare === 3995), 'totalul ATR declarat')
  assertEquals(F.exclus, [1624])
  assert(String(F.stare).includes('NEVERIFICAT'))
})
