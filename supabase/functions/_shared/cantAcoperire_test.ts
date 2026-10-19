import { assert, assertEquals } from 'jsr:@std/assert@1'
import { inventarRanduri, masoara, tabele } from './cantAcoperire.ts'

const inv = (t: string) => inventarRanduri(t)
const sumar = (t: string) => inv(t).map((x) => [x.nr, x.stare, x.cod, x.cantitate, x.um])

// lista F3 pdftotext: articol pe linie + denumirea dedesubt + „Total=”; rândul de material repetă nr.
const F3 = '⟦PAGINA 1⟧\n001 RPCXA04 M.C. 626.400\nSAPATURA\n0.000 0 Total=\n002 GD11A1 [ 1] M.C. 174.000\nDRENAJ\n0.000 0 Total=\n' +
  '003 SA11G1 [ 2] M 1160.000\nTEAVA PVC D= 90 MM\n0.000 0 Total=\n003 6701152 M 1160.000\n@TV HDPE80 DN 90X8.\n2 COD 64000115\n0.003 3 Total=\n' +
  '⟦PAGINA 2⟧\n006 TRA02A40 TONA 0.575 TRANSPORTUL RUTIER 0.000 0 Total=\n'

Deno.test('B1: inventarul listei F3 (nr., cod după poziție, cantitate, UM, pagina); „2 COD …” = incert posibila_continuare; offset în original', () => {
  const toate = inv(F3)
  assertEquals(toate.filter((x) => x.motiv === 'posibila_continuare').map((x) => [x.nr, x.linie, x.stare]), [[2, 13, 'incert']])
  const r = toate.filter((x) => x.motiv !== 'posibila_continuare')
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
  assertEquals([m.randuri, m.ancore, m.incerte, m.perechi_distincte, m.tabele], [7, 5, 2, 5, 1])
  assert(m.goluri === 2) // 4, 5
})

// ── review Jakarinos #751 r2 ──
Deno.test('r3 (P1-1): rând de listă fără cod, cu UM necunoscută → INCERT (nu dispare); „2 COD …” sub „003 …” → incert posibila_continuare, în afara secvenței', () => {
  assertEquals(sumar('1 Conducta m 10\n2 Adeziv GRAME 12\n'), [[1, 'ancora', null, '10', 'm'], [2, 'incert', null, null, null]])
  assertEquals(inv('1 Conducta m 10\n2 Adeziv GRAME 12\n')[1].motiv, 'lista_fara_cod_sau_cantitate')
  // nr. care nu continuă secvența (nici ultimul, nici următorul, nici 1) = continuare de denumire
  const c = inv('003 SA11G1 [ 2] M 10.000\nTEAVA\n2 COD 64000115\n7 FIRE DE 1,5\n')
  assertEquals(c.map((x) => [x.nr, x.motiv]), [[3, null], [2, 'posibila_continuare'], [7, 'posibila_continuare']])
  assertEquals(tabele(c).map((x) => [x.nr_min, x.nr_max, x.goluri]), [[3, 3, []]])
})
Deno.test('r3 (P1-3): reluarea de la 1 separă tabelul și când fragmentul anterior n-avea poziția 1 („8, 10” apoi „1 … 9” → golul 9 rămâne)', () => {
  const rd = ['| 8 | A | m | 1 |', '| 10 | B | m | 2 |', ...Array.from({ length: 9 }, (_, k) => `| ${k + 1} | X | m | ${k + 1} |`)].join('\n') + '\n'
  assertEquals(tabele(inv(rd)).map((x) => [x.nr_min, x.nr_max, x.goluri]), [[8, 10, [9]], [1, 9, []]])
})
Deno.test('r3 (P2-4): separatorul de mii prin spațiu în listă (pe linie sau pe linia următoare) → incert, nu „1 m”', () => {
  assertEquals(inv('1 RPC01 Conducta m 1 234,50\n').map((x) => [x.stare, x.motiv]), [['incert', 'separator_mii_spatiu']])
  assertEquals(inv('1 RPC01 Conducta\nm 1 234,50\n').map((x) => [x.stare, x.motiv]), [['incert', 'separator_mii_spatiu']])
})
Deno.test('r3 (corpus): „HDPE80 312UNI” nu e separator de mii; continuarea de denumire între rânduri de tabel nu e rând (nici reluare de la 1)', () => {
  assertEquals(inv('003 6701152 M 130.000 @TV HDPE80 312UNI7611.7615 PN10 DN 90X8.2 COD 64000115 0.003 0 Total=\n').map((x) => x.stare), ['ancora'])
  const t = '| 16 | 00602G04 | 02 BUCATA | 9,00000 | |\nSUDURA CAP LA CAP\n1 IMBIN.(DOP/CAPAT FLANSA) D= 90 MM\n| 17 | ACE01B3 | 82 BUCATA | 3,00000 | |\n'
  assertEquals(inv(t).map((x) => [x.nr, x.motiv]), [[16, null], [1, 'posibila_continuare'], [17, null]])
  assertEquals(tabele(inv(t)).map((x) => x.goluri), [[]])
})
Deno.test('r3 (P2-5): un rând C6 nu împrumută cantitatea articolului următor (rând de tabel cu cod)', () => {
  assertEquals(sumar('| 2001455 | Adeziv | GRAME | 12 |\n| 2001456 | Conducta | m | 15 |\n'),
    [[null, 'incert', '2001455', null, null], [null, 'ancora', '2001456', '15', 'm']])
})
Deno.test('r3 (P2-6): numerotarea ierarhică păstrează identificatorul; „5.1, 5.3” → golul 5.2', () => {
  const r = inv('| 5 | Proiectare | | |\n| 5.1 | Tema | m | 1 |\n| 5.3 | Studiu | m | 2 |\n| 6 | Altele | m | 3 |\n')
  assertEquals(r.map((x) => [x.nr, x.nr_id]), [[5, '5'], [5, '5.1'], [5, '5.3'], [6, '6']])
  assertEquals(tabele(r).map((x) => [x.goluri, x.goluri_ierarhice]), [[[], ['5.2']]])
  assertEquals(masoara('| 5.1 | Tema | m | 1 |\n| 5.3 | Studiu | m | 2 |\n').goluri, 1)
})

// ── review Jakarinos B1 r3 ──
Deno.test('r4 (P1-1): tabel → listă peste pagină — rândurile de listă rămân în inventar (incerte); „8,10 / 1 incert, 2…9” păstrează golul 9', () => {
  const t = '| 1 | Conducta | m | 10 |\n⟦PAGINA 2⟧\n2 Adeziv GRAME 12\n3 Vopsea GRAME 20\n'
  assertEquals(inv(t).map((x) => [x.nr, x.stare]), [[1, 'ancora'], [2, 'incert'], [3, 'incert']])
  const u = ['| 8 | A | m | 1 |', '| 10 | B | m | 2 |', '1 Adeziv GRAME 3', ...Array.from({ length: 8 }, (_, k) => `| ${k + 2} | X | m | ${k + 2} |`)].join('\n') + '\n'
  const tb = tabele(inv(u))
  assertEquals(tb.map((x) => [x.nr_min, x.nr_max, x.goluri]), [[8, 10, [9]], [2, 9, []]])
})
Deno.test('r4 (P1-2): secvența sau zerourile nu mai elimină rânduri („1 / 3 / 4”, „001 / 2 / 3”) — toate în inventar', () => {
  assertEquals(inv('1 Conducta m 10\n3 Adeziv GRAME 12\n4 Vopsea GRAME 20\n').length, 3)
  assertEquals(inv('001 Conducta m 10\n2 Adeziv GRAME 12\n3 Vopsea GRAME 20\n').length, 3)
})
Deno.test('r4 (P2-4): ierarhia pe trei niveluri — „5.1.1, 5.3.1” → golul 5.2', () => {
  const tb = tabele(inv('| 5.1.1 | A | m | 1 |\n| 5.3.1 | B | m | 2 |\n'))
  assertEquals(tb.map((x) => x.goluri_ierarhice), [['5.2']])
})

// ── review Jakarinos B1 r4 ──
Deno.test('r5 (P1-1): rândurile „posibila_continuare” marchează tabelul ca secvență NEDETERMINATĂ (golul nu mai poate dispărea tăcut)', () => {
  const a = tabele(inv('1 Conducta m 10\n3 Adeziv GRAME 12\n4 Vopsea GRAME 20\n'))
  assertEquals(a.map((x) => [x.nr_min, x.nr_max, x.secventa_nedeterminata, x.nr_incerte]), [[1, 1, true, [3, 4]]])
  const rd = ['| 8 | A | m | 1 |', '| 10 | B | m | 2 |', '1 Adeziv GRAME 3', '2 Vopsea GRAME 4', ...Array.from({ length: 7 }, (_, k) => `| ${k + 3} | X | m | ${k + 3} |`)].join('\n') + '\n'
  const b = tabele(inv(rd))
  assert(b[0].secventa_nedeterminata)
  assertEquals(masoara(rd).tabele_nedeterminate >= 1, true)
  // fără rânduri ambigue: secvența e determinată
  assertEquals(tabele(inv('| 1 | A | m | 1 |\n| 2 | B | m | 2 |\n')).map((x) => x.secventa_nedeterminata), [false])
})

// ── review Jakarinos B1 r5 ──
Deno.test('r6 (P1-1 / P2-3): incertitudinea de la graniță trece și la tabelul NOU, cu numerele ei; și înaintea primului tabel', () => {
  const t = '| 8 | A | m | 1 |\n| 9 | B | m | 2 |\n| 10 | C | m | 3 |\n1 Adeziv GRAME 3\n| 2 | D | m | 4 |\n| 3 | E | m | 5 |\n'
  assertEquals(tabele(inv(t)).map((x) => [x.nr_min, x.nr_max, x.secventa_nedeterminata, x.nr_incerte]), [[8, 10, true, [1]], [2, 3, true, [1]]])
  const u = '| 2001456 | Teava | m | 10 |\n1 Adeziv GRAME 3\n| 2 | D | m | 4 |\n'
  assertEquals(tabele(inv(u)).map((x) => [x.secventa_nedeterminata, x.nr_incerte]), [[true, [1]]])
  // un rând de secvență între ele închide „pendinte”: tabelul următor nu mai e afectat
  const v = '| 1 | A | m | 1 |\n| 2 | B | m | 2 |\n7 Adeziv GRAME 3\n| 3 | C | m | 3 |\n| 1 | D | m | 4 |\n| 2 | E | m | 5 |\n'
  assertEquals(tabele(inv(v)).map((x) => x.secventa_nedeterminata), [true, false])
})

// ── review Copilot / Gemini B1 r6 ──
Deno.test('r7 (Copilot P1): incertitudinea de la FINAL, fără niciun rând numerotat sigur după ea → tabel sintetic nedeterminat (nu [])', () => {
  const t = '| 2001456 | Teava | m | 10 |\n1 Adeziv GRAME 3\n3 Vopsea GRAME 4\n'
  assertEquals(tabele(inv(t)).map((x) => [x.randuri, x.secventa_nedeterminata, x.nr_incerte, x.nr_min, x.nr_max]), [[0, true, [1, 3], 1, 3]])
  assertEquals(masoara(t).tabele_nedeterminate, 1)
})
Deno.test('r7 (Gemini P2): după rânduri incerte, o scădere la 3 pornește un tabel NOU (nedeterminat) — golul 4 nu mai e acoperit de tabelul vechi', () => {
  const t = ['| 1 | A | m | 1 |', '| 4 | X | m | 1 |', '| 8 | B | m | 2 |', '| 9 | C | m | 3 |', '| 10 | D | m | 4 |',
    '1 Articol nou GRAME 5', '2 Alt articol GRAME 6', '| 3 | E | m | 7 |', '| 5 | F | m | 8 |'].join('\n') + '\n'
  const tb = tabele(inv(t))
  assertEquals(tb.map((x) => [x.nr_min, x.nr_max, x.goluri, x.secventa_nedeterminata]), [[1, 10, [2, 3, 5, 6, 7], true], [3, 5, [4], true]])
})
