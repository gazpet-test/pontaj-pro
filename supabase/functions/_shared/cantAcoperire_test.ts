import { assert, assertEquals } from 'jsr:@std/assert@1'
import { inventarRanduri, masoara, tabele } from './cantAcoperire.ts'

const inv = (t: string) => inventarRanduri(t)
const sumar = (t: string) => inv(t).map((x) => [x.nr, x.stare, x.cod, x.cantitate, x.um])

// lista F3 pdftotext: articol pe linie + denumirea dedesubt + „Total=”; rândul de material repetă nr.
const F3 = '⟦PAGINA 1⟧\n001 RPCXA04 M.C. 626.400\nSAPATURA\n0.000 0 Total=\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n' +
  '003 SA11G1 [ 2] M 1160.000\nTEAVA PVC D= 90 MM\n0.000 0 Total=\n003 6701152 M 1160.000\n@TV HDPE80 DN 90X8.\n2 COD 64000115\n0.003 3 Total=\n' +
  '⟦PAGINA 2⟧\n006 TRA02A40 TONA 0.575 TRANSPORTUL RUTIER 0.000 0 Total=\n'

Deno.test('B1: inventarul listei F3 (nr., cod după poziție, cantitate, UM, pagina); continuarea „2 COD …” nu e rând; offset în original', () => {
  const r = inv(F3)
  assertEquals(r.map((x) => [x.nr, x.stare, x.cod, x.cantitate, x.um, x.pagina]), [
    [1, 'ancora', 'RPCXA04', '626.400', 'mc', 1], [2, 'ancora', 'GD11A1', '174.000', 'mc', 1], [3, 'ancora', 'SA11G1', '1160.000', 'm', 1],
    [3, 'ancora', '6701152', '1160.000', 'm', 1], [6, 'ancora', 'TRA02A40', '0.575', 'tona', 2]])
  for (const x of r) assertEquals(F3.slice(x.offset).split('\n')[0].slice(0, 3), String(x.nr).padStart(3, '0'))
  assertEquals(r.map((x) => x.linie), [2, 5, 8, 11, 16])
})
Deno.test('review r1 (P1-1): o cantitate întreagă de 5+ cifre nu mai e confundată cu codul', () => {
  assertEquals(sumar('| 1 | Conducta | m | 12000 |\n'), [[1, 'ancora', null, '12000', 'm']])
})
Deno.test('review r1 (P1-2/3): UM în afara listei, separator de mii prin spațiu → rândul rămâne în inventar (ancoră sau incert)', () => {
  assertEquals(sumar('33 | 6200573 | LITRU | 157,200 |\n')[0].slice(0, 2), [33, 'ancora'])
  assertEquals(sumar('21 | 2000001 Energie electrica | kwh | 12.418 |\n')[0].slice(0, 2), [21, 'ancora'])
  assertEquals(sumar('5 | 2000002 | GRAME | 12 |\n')[0].slice(0, 2), [5, 'incert'])
  const mii = inv('| 1 | Sapatura | mc | 1 234,50 |\n')
  assertEquals([mii.length, mii[0].stare, mii[0].motiv], [1, 'incert', 'separator_mii_spatiu'])
})
Deno.test('review r1 (P1-4): rândul împărțit pe linii — cantitatea / UM de pe linia următoare; altfel incert, nu pierdut', () => {
  assertEquals(sumar('1 RPC01 Conducta PEHD\nm 120,000\n'), [[1, 'ancora', 'RPC01', '120,000', 'm']])
  assertEquals(sumar('| 1 | Conducta | m |\n| | | 120,000 |\n')[0].slice(0, 2), [1, 'incert'])
})
Deno.test('review r1 (P1-5): „total” în denumirea unui articol numerotat NU îl scoate; subtotalul nenumerotat nu e rând', () => {
  assertEquals(sumar('| 1 | Robinet cu pasaj total | buc | 2 |\n| Subtotal | m | 120 |\n'), [[1, 'ancora', null, '2', 'buc']])
})
Deno.test('review r1 (P1-6): schimbarea formatului nu separă tabelul (golul rămâne); suprapunerea de pagină nu dă gol fals; reluarea de la 1 = tabel nou', () => {
  const g = tabele(inv('1 RPC01 Sapatura mc 10\n3 | Conducta | m | 20 |\n'))
  assertEquals(g.map((x) => [x.nr_min, x.nr_max, x.goluri]), [[1, 3, [2]]])
  const s = tabele(inv('| 8 | A | m | 1 |\n| 9 | B | m | 2 |\n⟦PAGINA 2⟧\n| 8 | A | m | 1 |\n| 10 | C | m | 3 |\n'))
  assertEquals(s.map((x) => [x.goluri, x.reluari_atipice, x.pozitii]), [[[], 1, 3]])
  const d = tabele(inv('| 1 | A | m | 1 |\n| 2 | B | m | 2 |\n| 1 | C | m | 3 |\n| 2 | D | m | 4 |\n'))
  assertEquals(d.length, 2)
})
Deno.test('B1: tabel — cantitatea e tokenul singur în celulă (și cu bold), nu capitolul „82 M CUB”; numerotarea coloanelor nu e rând', () => {
  const t = 'Nr | Cod | UM | Cant\n0 | 1 | 2 | 3\n1 | TSA04B1 | 82 M CUB | **52,93800** |\n2 | 00601B04 | 02 M | 264,69000\n'
  assertEquals(sumar(t), [[1, 'ancora', 'TSA04B1', '52,93800', 'cub'], [2, 'ancora', '00601B04', '264,69000', 'm']])
})
Deno.test('review r1: tabel C6 FĂRĂ coloană de numerotare (doar cod) → rânduri în inventar cu nr. null, în afara secvenței', () => {
  const t = '| 2001456 | Teava PEHD PE 100 SDR 11 D=63x5.8 mm | m | 1420.50 |\n| 2001457 | Cot PE | GRAME | 3 |\n| Total | RON | 99 |\n'
  assertEquals(sumar(t), [[null, 'ancora', '2001456', '1420.50', 'm'], [null, 'incert', '2001457', null, null]])
  assertEquals(tabele(inv(t)).length, 0)
  // numerotarea coloanelor cu 3 celule („1 | 2 | 3”) nu e rând
  assertEquals(inv('1 | 2 | 3\n').length, 0)
})
Deno.test('B1: rândurile de pe aceeași poziție (material sub articol) — poziții distincte vs. rânduri', () => {
  const tb = tabele(inv('| 1 | A1B1 | m | 1 |\n| 1 | 6701152 | m | 1 |\n| 2 | A1B2 | m | 2 |\n'))
  assertEquals(tb.map((x) => [x.randuri, x.pozitii, x.goluri]), [[3, 2, []]])
})
Deno.test('B1: masoara — rânduri / ancore / incerte / perechi cod+cantitate distincte', () => {
  const m = masoara(F3 + '| 7 | X1A7 | GRAME | 3 |\n')
  assertEquals([m.randuri, m.ancore, m.incerte, m.perechi_distincte, m.tabele], [6, 5, 1, 5, 1])
  assert(m.goluri === 2) // 4, 5
})
