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
  const felie = '⟦PAGINA 12⟧\n003 SA11G1 [ 2] M 570.000\nTEAVA PVC NEPLASTIF.TIP G MONT.LA\nCONSTR.INDUSTR. IN CONDUCTE DE\nDISTRIBUTIE D= 90 MM\n0.000 0 Total=\n'
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

Deno.test('r1: hash_rand păstrează diferențele semantice (total vs detaliu; Dn) și e stabil pe același rând', async () => {
  const felie = 'Conducta PE100 De 110 200 m\n'
  const ctx = { textDoc: felie, felie, felie_de_la: 0, conventie: 'ro' as const, lot_domeniu: 'toate' as const, lot_nr: [], rol_sursa: 'cs', rol_decis_de: 'titlu' as const }
  const baza = [1, null, null, null, 'Conducta PE100 De 110', 'Str. A', 'PE100', 'De 110', null, 'm', 200, 0, 0, 'conducta', 'lungime', 'Conducta PE100 De 110 200 m']
  const a = (await normalizeazaRand(randDinTablou(baza)!, ctx))!
  const a2 = (await normalizeazaRand(randDinTablou(baza)!, ctx))!
  const tot = baza.slice(); tot[11] = 1
  const b = (await normalizeazaRand(randDinTablou(tot)!, ctx))!
  const alt = baza.slice(); alt[5] = 'Str. B'
  const c = (await normalizeazaRand(randDinTablou(alt)!, ctx))!
  assertEquals(a.obs.hash_rand, a2.obs.hash_rand)
  assertEquals(new Set([a.obs.hash_rand, b.obs.hash_rand, c.obs.hash_rand]).size, 3)
})
Deno.test('r1: mai multe Dn propuse de model → dn_ambiguu, dn_model null', async () => {
  const felie = 'Conducta PEHD DN90 120 m\n'
  const ctx = { textDoc: felie, felie, felie_de_la: 0, conventie: 'ro' as const, lot_domeniu: 'toate' as const, lot_nr: [], rol_sursa: 'cs', rol_decis_de: 'titlu' as const }
  const n = (await normalizeazaRand(randDinTablou([1, null, null, null, 'Conducta PEHD DN90', null, null, 'Dn 90/110', null, 'm', 120, 0, 0, 'conducta', 'lungime', 'Conducta PEHD DN90 120 m'])!, ctx))!
  assertEquals([n.obs.dn_mm, n.obs.dn_model, n.obs.dn_ambiguu], [[90], null, true])
})

// ── val 2, PR-A: dovada pe rând (codul pe linia cantității, Dn-ul în blocul rândului) ──
const F3 = '⟦PAGINA 3⟧\n001 SA11D1 [ 2] M 300.000\nTEAVA PVC ... DE DISTRIBUTIE D= 63 MM\n0.000 0 Total=\n' +
  '002 SA11H1 [ 2] M 120.000\nTEAVA PVC ... DE DISTRIBUTIE D= 110 MM\n0.000 0 Total=\n'
const ctxF3 = { textDoc: F3, felie: F3, felie_de_la: 0, conventie: 'en' as const, lot_domeniu: 'toate' as const, lot_nr: [], rol_sursa: 'f3', rol_decis_de: 'antet' as const }
const randF3 = (cod: string | null, den: string, cant: number, citat: string) =>
  randDinTablou([3, null, null, cod, den, 'Str. A', 'PVC', null, null, 'M', cant, 0, 0, 'conducta', 'lungime', citat])!

Deno.test('PR-A: rândurile corecte rămân dovedite (Dn 63 cu 300, Dn 110 cu 120)', async () => {
  const a = (await normalizeazaRand(randF3('SA11D1', 'TEAVA PVC D= 63 MM', 300, '001 SA11D1 [ 2] M 300.000'), ctxF3))!
  const b = (await normalizeazaRand(randF3('SA11H1', 'TEAVA PVC D= 110 MM', 120, '002 SA11H1 [ 2] M 120.000'), ctxF3))!
  assertEquals([a.obs.pozitie_dovedita, a.obs.dn_mm, a.obs.dn_ambiguu], [true, [63], false])
  assertEquals([b.obs.pozitie_dovedita, b.obs.dn_mm, b.obs.dn_ambiguu], [true, [110], false])
})
Deno.test('PR-A: riscul DN63/DN110 — denumirea Dn 110 lipită de cantitatea rândului Dn 63 → nedovedit (dn_alt_rand)', async () => {
  const n = (await normalizeazaRand(randF3(null, 'TEAVA PVC D= 110 MM', 300, '001 SA11D1 [ 2] M 300.000'), ctxF3))!
  assertEquals([n.obs.pozitie_dovedita, n.obs.dn_mm], [false, [110]])
  assertEquals(n.note.includes('pozitie:dn_alt_rand'), true)
})
Deno.test('PR-A: codul de articol al altui rând → nedovedit (cod_alt_rand); un „cod” fără cifre nu se verifică', async () => {
  const n = (await normalizeazaRand(randF3('SA11H1', 'TEAVA PVC D= 63 MM', 300, '001 SA11D1 [ 2] M 300.000'), ctxF3))!
  assertEquals([n.obs.pozitie_dovedita, n.note.includes('pozitie:cod_alt_rand')], [false, true])
  const m = (await normalizeazaRand(randF3('a)', 'TEAVA PVC D= 63 MM', 300, '001 SA11D1 [ 2] M 300.000'), ctxF3))!
  assertEquals(m.obs.pozitie_dovedita, true)
})
Deno.test('PR-A: blocul rândului se oprește la ancora următoare și nu urcă deasupra (denumirea de sus = alt rând)', async () => {
  // continuarea Dn 110 e sub rândul 002; rândul 001 nu „vede” Dn 110 (se oprește la ancora 002)
  const t = '001 SA11D1 [ 2] M 300.000\n002 SA11H1 [ 2] M 120.000\nTEAVA PVC D= 110 MM\n'
  const ctx = { ...ctxF3, textDoc: t, felie: t }
  const n = (await normalizeazaRand(randF3('SA11D1', 'TEAVA PVC D= 110 MM', 300, '001 SA11D1 [ 2] M 300.000'), ctx))!
  assertEquals([n.obs.pozitie_dovedita, n.note.includes('pozitie:dn_alt_rand')], [false, true])
  // denumirea DEASUPRA cantității: nu e găsită (fail-closed)
  const sus = 'TEAVA PVC D= 63 MM\n001 SA11D1 [ 2] M 300.000\n'
  const s = (await normalizeazaRand(randF3('SA11D1', 'TEAVA PVC D= 63 MM', 300, '001 SA11D1 [ 2] M 300.000'), { ...ctxF3, textDoc: sus, felie: sus }))!
  assertEquals(s.obs.pozitie_dovedita, false)
})
Deno.test('PR-A: rândul de tabel markdown = linia lui; un Dn în plus pe rând → dn_ambiguu, dovedit', async () => {
  const t = '| Nr | Denumire | UM | Cant |\n|---|---|---|---|\n| 1 | Conducta PE100 De 90 | m | 120 | racord De 63 |\n| 2 | Conducta PE100 De 110 | m | 80 |\n'
  const ctx = { ...ctxF3, textDoc: t, felie: t, conventie: 'ro' as const, rol_sursa: 'cs' }
  const n = (await normalizeazaRand(randDinTablou([1, null, null, null, 'Conducta PE100 De 90', null, 'PE100', null, null, 'm', 120, 0, 0,
    'conducta', 'lungime', '| 1 | Conducta PE100 De 90 | m | 120 |'])!, ctx))!
  assertEquals([n.obs.pozitie_dovedita, n.obs.dn_mm, n.obs.dn_ambiguu], [true, [90], true])
})

// ── review Jakarinos r1 (P1): delimitare pozitivă a blocului + codul ca identificator întreg ──
Deno.test('PR-A r2: denumirea DEASUPRA cantității — denumirea de dedesubt e a articolului următor → nedovedit (cu și fără UM pe 002)', async () => {
  for (const urm of ['002 SA11H1 M 120.000', '002 SA11H1 120.000']) {
    const t = `TEAVA PVC DN63\n001 SA11D1 M 300.000\nTEAVA PVC DN110\n${urm}\n`
    const n = (await normalizeazaRand(randF3('SA11D1', 'TEAVA PVC DN110', 300, '001 SA11D1 M 300.000'), { ...ctxF3, textDoc: t, felie: t }))!
    assertEquals([n.obs.pozitie_dovedita, n.note.includes('pozitie:dn_alt_rand')], [false, true], urm)
  }
})
Deno.test('PR-A r2: continuarea fără linia „Total=” a articolului (sfârșit de text, linie goală, pagină nouă) → doar linia → nedovedit', async () => {
  for (const coada of ['', '\n\n003 X', '\n⟦PAGINA 4⟧\n0.000 0 Total=']) {
    const t = `001 SA11D1 [ 2] M 300.000\nTEAVA PVC D= 63 MM${coada}`
    const n = (await normalizeazaRand(randF3('SA11D1', 'TEAVA PVC D= 63 MM', 300, '001 SA11D1 [ 2] M 300.000'), { ...ctxF3, textDoc: t, felie: t }))!
    assertEquals(n.obs.pozitie_dovedita, false, JSON.stringify(coada))
  }
})
Deno.test('PR-A r2: codul ca identificator întreg — SA11G1 ≠ SA11G10; „SA11G1M” nu se fabrică din „SA11G1 M”; cod cu spații → nedovedit', async () => {
  const t = '001 SA11G10 [ 2] M 300.000\nTEAVA PVC D= 63 MM\n0.000 0 Total=\n'
  const a = (await normalizeazaRand(randF3('SA11G1', 'TEAVA PVC D= 63 MM', 300, '001 SA11G10 [ 2] M 300.000'), { ...ctxF3, textDoc: t, felie: t }))!
  assertEquals([a.obs.pozitie_dovedita, a.note.includes('pozitie:cod_alt_rand')], [false, true])
  const u = '001 SA11G1 M 300.000\nTEAVA PVC D= 63 MM\n0.000 0 Total=\n'
  const b = (await normalizeazaRand(randF3('SA11G1M', 'TEAVA PVC D= 63 MM', 300, '001 SA11G1 M 300.000'), { ...ctxF3, textDoc: u, felie: u }))!
  assertEquals(b.obs.pozitie_dovedita, false)
  const c = (await normalizeazaRand(randF3('SA11 G1', 'TEAVA PVC D= 63 MM', 300, '001 SA11G1 M 300.000'), { ...ctxF3, textDoc: u, felie: u }))!
  assertEquals(c.obs.pozitie_dovedita, false)
  const d = (await normalizeazaRand(randF3('**SA11G1**', 'TEAVA PVC D= 63 MM', 300, '001 SA11G1 M 300.000'), { ...ctxF3, textDoc: u, felie: u }))!
  assertEquals(d.obs.pozitie_dovedita, true)
})
