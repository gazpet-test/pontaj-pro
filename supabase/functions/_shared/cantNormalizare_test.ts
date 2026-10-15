import { assertEquals } from 'jsr:@std/assert@1'
import { materialNorm, normalizeazaRand, obiectCheie, paginaLa, randDinTablou, tipSiMasura, umNorm } from './cantNormalizare.ts'

Deno.test('UM: ml → m; M.C. → mc; BOC. → buc', () => {
  assertEquals([umNorm('ml'), umNorm('M'), umNorm('M.C.'), umNorm('BOC.'), umNorm('')], ['m', 'm', 'mc', 'buc', null])
})
Deno.test('material: listă închisă', () => {
  assertEquals(materialNorm('PEHD 100 SDR11'), 'PEHD')
  assertEquals(materialNorm(null, 'TEAVA PE100 SDR11 De 90'), 'PE100')
  assertEquals(materialNorm('TEAVA PVC NEPLASTIF'), 'PVC')
  assertEquals(materialNorm('nimic'), null)
})
Deno.test('obiect_cheie: fără diacritice și prefixe, cu numere și localitate', () => {
  assertEquals(obiectCheie('Loc. GHERGANI, str. Oraca, nr. 12'), 'ghergani oraca 12')
  assertEquals(obiectCheie('Obiectul 3 - Strada Ion Rănzopol'), '3 ion ranzopol')
})
Deno.test('tip / măsură: regula pe denumire câștigă la dezacord', () => {
  assertEquals(tipSiMasura('Branșament PE Dn 32', 'conducta', 'lungime', 'm'), { tip_lucrare: 'bransament', masura: 'lungime', dezacord: true })
  assertEquals(tipSiMasura('Tub de protectie OL', null, null, 'm'), { tip_lucrare: 'protectie', masura: 'lungime', dezacord: false })
  assertEquals(tipSiMasura('Proba de presiune conducta', 'conducta', 'lungime', 'm').masura, 'proba')
  assertEquals(tipSiMasura('TEAVA PVC ... D= 90 MM', 'alt', 'lungime', 'm').tip_lucrare, 'conducta')
})
Deno.test('pagina din markerul ⟦PAGINA n⟧ dinaintea offsetului', () => {
  const t = '⟦PAGINA 4⟧\nabc\n⟦PAGINA 5⟧\nxyz'
  assertEquals([paginaLa(t, 13), paginaLa(t, t.indexOf('xyz')), paginaLa('fara', 2)], [4, 5, null])
})
Deno.test('rândul Răcari F3 → observație dovedită, Dn 90, 570 m (convenția EN a listei)', async () => {
  const felie = '⟦PAGINA 12⟧\n003 SA11G1 [ 2] M 570.000\nTEAVA PVC NEPLASTIF.TIP G MONT.LA\nCONSTR.INDUSTR. IN CONDUCTE DE\nDISTRIBUTIE D= 90 MM\n'
  const r = randDinTablou([12, 'F3 obiect 4', null, 'SA11G1', 'TEAVA PVC NEPLASTIF.TIP G ... DISTRIBUTIE D= 90 MM', 'Str. Platanului', 'PVC', 'D= 90 MM',
    null, 'M', 570, 0, 0, 'conducta', 'lungime', '003 SA11G1 [ 2] M 570.000'])!
  const n = (await normalizeazaRand(r, { textDoc: felie, felie, felie_de_la: 0, conventie: 'en', lot_domeniu: 'toate', lot_nr: [],
    rol_sursa: 'f3', rol_decis_de: 'antet' }))!
  assertEquals([n.obs.pozitie_dovedita, n.obs.cantitate, n.obs.um_norm, n.obs.dn_mm, n.obs.dn_ambiguu, n.obs.material, n.obs.pagina],
    [true, 570, 'm', [90], false, 'PVC', 12])
  assertEquals(n.obs.cantitate_offset, felie.indexOf('570.000'))
  assertEquals(n.obs.obiect_cheie, 'platanului')
  // aceeași linie fără convenție: ambiguă, nedovedită, fără cantitate dovedită
  const m = (await normalizeazaRand(r, { textDoc: felie, felie, felie_de_la: 0, conventie: 'nedeterminata', lot_domeniu: 'toate', lot_nr: [],
    rol_sursa: 'f3', rol_decis_de: 'antet' }))!
  assertEquals([m.obs.pozitie_dovedita, m.obs.valoare_ambigua], [false, true])
})
Deno.test('modelul dă alt Dn decât codul → dn_ambiguu; rând fără citat → ignorat', async () => {
  const felie = 'Conducta PE100 De 110 200 m\n'
  const ctx = { textDoc: felie, felie, felie_de_la: 0, conventie: 'ro' as const, lot_domeniu: 'toate' as const, lot_nr: [], rol_sursa: 'cs', rol_decis_de: 'titlu' as const }
  const r = randDinTablou([1, null, null, null, 'Conducta PE100 De 110', null, 'PE100', 'Dn 90', null, 'm', 200, 0, 0, 'conducta', 'lungime', 'Conducta PE100 De 110 200 m'])!
  const n = (await normalizeazaRand(r, ctx))!
  assertEquals([n.obs.dn_mm, n.obs.dn_model, n.obs.dn_ambiguu], [[110], 90, true])
  const fara = randDinTablou([1, null, null, null, 'x', null, null, null, null, 'm', 1, 0, 0, null, null, null])!
  assertEquals(await normalizeazaRand(fara, ctx), null)
})
