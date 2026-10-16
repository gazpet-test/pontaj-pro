import { assertEquals } from 'jsr:@std/assert@1'
import { ancoreRand, inchideRanduri, masoara, tabele } from './cantAcoperire.ts'

// lista F3 pdftotext: articol pe linie + denumirea dedesubt + „Total=”; rândul de material repetă nr.
const F3 = '⟦PAGINA 1⟧\n001 RPCXA04 M.C. 626.400\nSAPATURA\n0.000 0 Total=\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n' +
  '003 SA11G1 [ 2] M 1160.000\nTEAVA PVC D= 90 MM\n0.000 0 Total=\n003 6701152 M 1160.000\n@TV HDPE80 DN 90X8.2\n0.003 3 Total=\n' +
  '⟦PAGINA 2⟧\n006 TRA02A40 TONA 0.575 TRANSPORTUL RUTIER 0.000 0 Total=\n'

Deno.test('B1: ancorele listei F3 (nr., cod, cantitate, UM, pagina); „Total=” după articol nu îl face total', () => {
  const a = ancoreRand(F3)
  assertEquals(a.map((x) => [x.nr, x.cod, x.cantitate, x.um, x.pagina]), [
    [1, 'RPCXA04', '626.400', 'mc', 1], [2, 'GD11A1', '174.000', 'mc', 1], [3, 'SA11G1', '1160.000', 'm', 1],
    [3, '6701152', '1160.000', 'm', 1], [6, 'TRA02A40', '0.575', 'tona', 2]])
})
Deno.test('B1: secvența nr. crt. — nr. repetat = același articol; 4 și 5 lipsă = goluri; reluarea de la 1 = tabel nou', () => {
  const t = F3 + '001 X1A1 M 10.000\n002 X1A2 M 5.000\n'
  const { tabele: tb, reluari_atipice } = tabele(ancoreRand(t))
  assertEquals(tb.map((x) => [x.nr_min, x.nr_max, x.goluri]), [[1, 6, [4, 5]], [1, 2, []]])
  assertEquals(reluari_atipice, 0)
  assertEquals(tabele(ancoreRand('005 A1B1 M 1.000\n003 A1B2 M 2.000\n')).reluari_atipice, 1)
})
Deno.test('B1: tabel markdown — cantitatea e tokenul singur în celulă (nu capitolul „82 M CUB”), ultima celulă fără „|”', () => {
  const t = '1 | TSA04B1 | 82 M CUB | 52,93800 | |\n2 | 00601B04 | 02 M | 264,69000\n4 | 2200068 PIETRIS | M.C. | 0.15\n'
  assertEquals(ancoreRand(t).map((x) => [x.nr, x.cod, x.cantitate, x.um]),
    [[1, 'TSA04B1', '52,93800', 'cub'], [2, '00601B04', '264,69000', 'm'], [4, '2200068', '0.15', 'mc']])
  assertEquals(tabele(ancoreRand(t)).tabele[0].goluri, [3])
  assertEquals(inchideRanduri('a | b | c\nx | y\n| d |'), 'a | b | c |\nx | y\n| d |')
})
Deno.test('B1: nu sunt ancore — proză, rând de total, rând fără UM, Dn-ul, separatorul de tabel', () => {
  const t = 'Lungimea totala este 3995 m\n| Total conducte | m | 120 |\n|---|---|---|\n7 Conducta DN 90\n8 | Manometru | 2 |\n'
  assertEquals(ancoreRand(t).length, 0)
})
Deno.test('B1: masoara — perechi cod+cantitate distincte (rândul de material cu aceeași cantitate e altă pereche)', () => {
  const m = masoara(F3 + '003 SA11G1 [ 2] M 1160.000\n')
  assertEquals([m.ancore, m.ancore_cu_cod, m.perechi_distincte, m.tabele, m.goluri], [6, 6, 5, 2, 2])
  assertEquals(m.dupa_pagina, { '1': 4, '2': 2 })
})
