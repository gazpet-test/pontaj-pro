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

// ── review Copilot B1 r7 ──
Deno.test('r8 (Copilot P1): rânduri ierarhice de LISTĂ („5.1 …”, „5.3 …”) → în inventar, cu golul ierarhic 5.2; liniile de prețuri nu sunt rânduri', () => {
  const r = inv('5.1 Conducta m 10\n5.3 Conducta m 20\n')
  assertEquals(r.map((x) => [x.nr, x.nr_id, x.stare]), [[5, '5.1', 'ancora'], [5, '5.3', 'ancora']])
  assertEquals(tabele(r).map((x) => x.goluri_ierarhice), [['5.2']])
  assertEquals(inv('5.1 1234567 Teava m 10\n5.2 SA11G1 Teava m 20\n').map((x) => x.nr_id), ['5.1', '5.2'])
  assertEquals(inv('003 SA11G1 [ 2] M 570.000\nTEAVA PVC 20.80 11856.00\n38.32 21842.40\n0.90 513.00\n1.5 m adancime\n').filter((x) => x.motiv !== 'posibila_continuare').map((x) => x.nr_id), ['003'])
})

// ── review Copilot / Gemini B1 r8 ──
Deno.test('r9: rânduri ierarhice de LISTĂ — UM + cantitate, cod de 4 cifre, rădăcină de 4 cifre, cod cu minuscule, cuvânt de o literă, paranteză', () => {
  const id = (t: string) => inv(t).map((x) => x.nr_id)
  assertEquals(id('5.1 m 10\n5.3 m 20\n'), ['5.1', '5.3'])
  assertEquals(tabele(inv('5.1 m 10\n5.3 m 20\n')).map((x) => x.goluri_ierarhice), [['5.2']])
  assertEquals(id('5.1 2509 Teava m 10\n5.3 2510 Teava m 20\n'), ['5.1', '5.3'])
  assertEquals(tabele(inv('1000.1 Conducta m 10\n1000.3 Conducta m 20\n')).map((x) => x.goluri_ierarhice), [['1000.2']])
  assertEquals(id('5.1 3A1iG1 Conducta m 10\n5.2 TRA01A Conducta m 10\n5.3 sa11g1 Conducta m 10\n'), ['5.1', '5.2', '5.3'])
  assertEquals(id('5.1 A se vedea m 10\n5.2 O conducta PEHD m 10\n5.3 (Conducta) m 10\n5.4 [2] SA11G1 m 10\n'), ['5.1', '5.2', '5.3', '5.4'])
  // rămân excluse: prețuri / zecimale și o măsură în text
  assertEquals(inv('003 SA11G1 [ 2] M 570.000\n213.76 65795.33\n0.90 513.00\n1.5 m adancime\n20.80 11856.00\n').filter((x) => x.motiv !== 'posibila_continuare').map((x) => x.nr_id), ['003'])
  // poziția „dupa” la ierarhic: codul de după nr. e găsit
  assertEquals(inv('5.1 SA11G1 Conducta m 10\n')[0].cod, 'SA11G1')
})

// ── review Copilot / Gemini B1 r9 ──
Deno.test('r10: recunoaștere STRUCTURALĂ — „5.1 - …”, „5.1: …”, „5.1 A1 …”, „5.1 m3 10”, „5.1 M 10” în inventar; prețurile excluse; „1.5 m adancime” = incert', () => {
  const id = (t: string) => inv(t).map((x) => x.nr_id)
  assertEquals(id('5.1 - Conducta PEHD m 10\n5.3 - Conducta PVC m 20\n'), ['5.1', '5.3'])
  assertEquals(tabele(inv('5.1 - Conducta PEHD m 10\n5.3 - Conducta PVC m 20\n')).map((x) => x.goluri_ierarhice), [['5.2']])
  assertEquals(id('5.1: Conducta m 10\n5.2 A1 Conducta m 10\n5.3 m3 10\n5.4 M 10\n'), ['5.1', '5.2', '5.3', '5.4'])
  // orice altă formă ierarhică cu conținut intră (cel puțin incert), nu dispare
  const s = inv('5.1 ~ ceva\n')
  assertEquals(s.map((x) => [x.nr_id, x.stare, x.motiv]), [['5.1', 'incert', 'posibila_continuare']])
  // liniile de prețuri (id urmat de un număr zecimal) rămân în afară; „1.5 m adancime” = incert în afara secvenței
  // r12: liniile numai numerice NU mai sunt excluse — intră ca incerte în afara secvenței
  assertEquals(inv('003 SA11G1 [ 2] M 570.000\n213.76 65795.33\n20.80 11856.00\n38.32 21842.40\n').filter((x) => x.motiv !== 'posibila_continuare').map((x) => x.nr_id), ['003'])
  const m = inv('003 SA11G1 [ 2] M 570.000\n1.5 m adancime\n')
  assertEquals(m.map((x) => [x.nr_id, x.motiv]), [['003', null], ['1.5', 'posibila_continuare']])
})

// ── review Copilot B1 r10 ──
Deno.test('r11 (Copilot P1/P2): „5.1 12,50 m” / „5.1 12.50 buc” rămân rânduri; rândul precedent nu le împrumută cantitatea; doar liniile NUMAI numerice sunt prețuri', () => {
  const r = inv('1 Conducta fara cantitate\n5.1 12,50 m\n5.3 Conducta m 20\n')
  assertEquals(r.map((x) => [x.nr_id, x.stare, x.cantitate, x.um]), [['1', 'incert', null, null], ['5.1', 'ancora', '12,50', 'm'], ['5.3', 'ancora', '20', 'm']])
  assertEquals(inv('5.1 12.50 buc\n').map((x) => [x.nr_id, x.stare, x.um]), [['5.1', 'ancora', 'buc']])
  // numai numere după id: în inventar ca incerte, în afara secvenței (r12)
  assertEquals(inv('003 SA11G1 [ 2] M 570.000\n213.76 65795.33\n20.80 11856.00 0.00\n38.32 21842.40\n').filter((x) => x.motiv !== 'posibila_continuare').map((x) => x.nr_id), ['003'])
})

// ── review Copilot B1 r11 ──
Deno.test('r12 (Copilot P1/P2): rândul ierarhic numai numeric („5.1 12,50”, „5.1 12,50 3”) NU dispare — incert posibila_continuare, tabel nedeterminat', () => {
  for (const t of ['5.1 12,50\n', '5.1 12,50 3\n']) {
    const r = inv(t)
    assertEquals(r.map((x) => [x.nr_id, x.stare, x.motiv]), [['5.1', 'incert', 'posibila_continuare']])
    assertEquals(tabele(r).map((x) => [x.secventa_nedeterminata, x.nr_incerte]), [[true, [5]]])
  }
})

// ── review Copilot B1 r12 ──
Deno.test('r13 (Copilot P1/P2): nr. crt. singur pe linie (OCR rupt după nr.) NU dispare — cu cantitatea pe linia următoare e rând normal', () => {
  const r = inv('1\nConducta m 10\n2 Conducta m 20\n')
  assertEquals(r.map((x) => [x.nr_id, x.stare, x.cantitate, x.um]), [['1', 'ancora', '10', 'm'], ['2', 'ancora', '20', 'm']])
  assertEquals(tabele(r).map((x) => [x.nr_min, x.nr_max, x.goluri, x.secventa_nedeterminata]), [[1, 2, [], false]])
  const h = inv('5.1\nConducta m 10\n5.3 Conducta m 20\n')
  assertEquals(h.map((x) => [x.nr_id, x.stare]), [['5.1', 'ancora'], ['5.3', 'ancora']])
  assertEquals(tabele(h)[0].goluri_ierarhice.length > 0, true)
  // fără cantitate recuperabilă: incert posibila_continuare, tabel nedeterminat
  const s = inv('1\n2 Conducta m 20\n3 Conducta m 30\n')
  assertEquals(s.map((x) => [x.nr_id, x.stare, x.motiv]), [['1', 'incert', 'posibila_continuare'], ['2', 'ancora', null], ['3', 'ancora', null]])
  assertEquals(tabele(s).some((x) => x.secventa_nedeterminata), true)
  assertEquals(inv('12.\nConducta m 10\n').map((x) => [x.nr_id, x.stare]), [['12', 'ancora']])
})

// ── review Copilot B1 r13 ──
Deno.test('r14 (Copilot P1/P2): reluarea ierarhică sub același părinte nu mai ascunde golul primei secvențe', () => {
  const tb = tabele(inv('5.1 Conducta m 10\n5.3 Teava m 20\n5.1 Beton m 30\n5.2 Nisip m 40\n5.3 Pietris m 50\n'))
  assertEquals(tb.map((x) => [x.randuri, x.goluri_ierarhice]), [[2, ['5.2']], [3, []]])
  // scădere sub același părinte fără reluare la 1–2 = reluare atipică
  const at = tabele(inv('5.1 A m 1\n5.2 B m 2\n5.3 C m 3\n5.4 D m 4\n5.3 E m 5\n5.5 F m 6\n'))
  assertEquals(at.map((x) => [x.randuri, x.reluari_atipice]), [[6, 1]])
  // pe niveluri: 5.1.1, 5.1.3, 5.1.1, 5.1.2 → al doilea tabel; golul 5.1.2 rămâne în primul
  const n = tabele(inv('5.1.1 A m 1\n5.1.3 B m 2\n5.1.1 C m 3\n5.1.2 D m 4\n'))
  assertEquals(n.map((x) => x.goluri_ierarhice), [['5.1.2'], []])
  // secvența normală (5.1, 5.2, 6.1, 6.2) rămâne un singur tabel fără semnale
  assertEquals(tabele(inv('5.1 A m 1\n5.2 B m 2\n6.1 C m 3\n6.2 D m 4\n')).map((x) => [x.randuri, x.reluari_atipice, x.goluri_ierarhice]), [[4, 0, []]])
})

// ── review Copilot B1 r14 ──
Deno.test('r15 (Copilot P1): rândul plat cu „:” sau cu separatorul lipit de text nu mai dispare; „1.5 …” / „10:30” nu devin rânduri', () => {
  for (const t of ['1: Conducta m 10\n2 Conducta m 20\n', '1)Conducta m 10\n2 Conducta m 20\n', '1:Conducta m 10\n2 Conducta m 20\n', '1.Conducta m 10\n2 Conducta m 20\n'])
    assertEquals(inv(t).map((x) => [x.nr_id, x.stare, x.cantitate]), [['1', 'ancora', '10'], ['2', 'ancora', '20']])
  assertEquals(inv('10:30 sedinta\n').length, 0)
  assertEquals(inv('**7**. Conducta m 10\n').map((x) => [x.nr_id, x.stare]), [['7', 'ancora']])
})

// ── review Copilot B1 r15 + Gemini B1 r14 ──
Deno.test('r16 (Copilot P1): ierarhicul cu separator lipit de text (5.2:Conducta, 5.2)Conducta, 5.2.Conducta) nu mai dispare', () => {
  for (const s of [':', ')', '.'])
    assertEquals(inv(`5.1 Conducta m 10\n5.2${s}Conducta m 20\n`).map((x) => [x.nr_id, x.stare]), [['5.1', 'ancora'], ['5.2', 'ancora']])
  // „1.5m” / „1.5 12” nu devin rânduri sigure
  assertEquals(inv('1.5m adancime\n').length, 0)
})
Deno.test('r16 (Gemini P2): reluarea ierarhică după alt capitol (5.1, 5.3, 6.1, 5.1, 5.2, 5.3) păstrează golul 5.2 al primului tabel', () => {
  const tb = tabele(inv('5.1 A m 1\n5.3 B m 2\n6.1 C m 3\n5.1 D m 4\n5.2 E m 5\n5.3 F m 6\n'))
  assertEquals(tb.map((x) => [x.randuri, x.goluri_ierarhice]), [[3, ['5.2']], [3, []]])
  // capitole succesive normale: un singur tabel
  assertEquals(tabele(inv('5.1 A m 1\n5.2 B m 2\n6.1 C m 3\n6.2 D m 4\n7.1 E m 5\n')).map((x) => [x.randuri, x.reluari_atipice, x.goluri_ierarhice]), [[5, 0, []]])
})

// ── review Copilot B1 r16 ──
Deno.test('r17 (Copilot P1): rândul de TABEL cu „1:” / „5.2:” sau cu prima celulă nestandard nu mai dispare', () => {
  assertEquals(inv('| 1: | Conducta | m | 10 |\n| 2 | Teava | m | 20 |\n').map((x) => [x.nr_id, x.stare]), [['1', 'ancora'], ['2', 'ancora']])
  assertEquals(inv('| 5.1 | Conducta | m | 10 |\n| 5.2: | Teava | m | 20 |\n').map((x) => [x.nr_id, x.stare]), [['5.1', 'ancora'], ['5.2', 'ancora']])
  // prima celulă „1 Conducta”: rând slab — cu cantitate e normal, fără e incert posibila_continuare
  assertEquals(inv('| 1 Conducta | m | 10 |\n| 2 | Teava | m | 20 |\n').map((x) => [x.nr_id, x.stare]), [['1', 'ancora'], ['2', 'ancora']])
  const s = inv('| 1 Conducta | | |\n| 2 | Teava | m | 20 |\n')
  assertEquals(s.map((x) => [x.nr_id, x.stare, x.motiv]), [['1', 'incert', 'posibila_continuare'], ['2', 'ancora', null]])
  assertEquals(tabele(s).some((x) => x.secventa_nedeterminata), true)
})
Deno.test('r17: rândul de LISTĂ cu coloane „|” doar la coadă (F3 212 / 213) intră ca rând de listă, cu cantitatea lui', () => {
  const r = inv('007 GD11A1 BUC. 1.000 LEGATURA | 0.000 | 0 Total=\n008 GD12A1 BUC. 1.000 LEGATURA CONDUCTEI NOI | 0.000 | 0 Total=\n009 RPGD13F1 [ 1] M 570.000 EFECTUAREA | 0.000 | 0 Total=\n')
  assertEquals(r.map((x) => [x.nr_id, x.stare, x.cantitate]), [['007', 'ancora', '1.000'], ['008', 'ancora', '1.000'], ['009', 'ancora', '570.000']])
  const c = inv('025 4123214 | BUC. | 3.000 | | NIPLU FONTA | 0.000 | 0 | Total=\n026 4117966 | BUC. | 4.000 | COT FONTA | 0.000 | 0 Total=\n')
  assertEquals(c.map((x) => [x.nr_id, x.stare]), [['025', 'ancora'], ['026', 'ancora']])
})

// ── review Copilot B1 r17 ──
Deno.test('r18 (Copilot P1): prima celulă cu text lipit de nr. („| 1Conducta |”, „| 5.1Conducta |”) nu mai dispare; continuarea unui număr nu e rând', () => {
  assertEquals(inv('| 1Conducta | m | 10 |\n| 2 | Teava | m | 20 |\n').map((x) => [x.nr_id, x.stare]), [['1', 'ancora'], ['2', 'ancora']])
  assertEquals(inv('| 5.1Conducta | m | 10 |\n| 5.2 | Teava | m | 20 |\n').map((x) => [x.nr_id, x.stare]), [['5.1', 'ancora'], ['5.2', 'ancora']])
  const s = inv('| 1Conducta | | |\n| 2 | Teava | m | 20 |\n')
  assertEquals(s.map((x) => [x.nr_id, x.motiv]), [['1', 'posibila_continuare'], ['2', null]])
  assertEquals(inv('| 12,50 | m | 10 |\n').length, 0)
  // „| 12345 |” rămâne ce era: rând C6 cu cod de resursă, fără nr. crt.
  assertEquals(inv('| 12345 | m | 10 |\n').map((x) => [x.nr, x.cod]), [[null, '12345']])
})
Deno.test('r19 (Gemini r17 P2): forma slabă de celulă nu mai înghite codul din prima celulă', () => {
  assertEquals(inv('| 1 SA11G1 Conducta | m | 10 |\n| 2 | SA11G2 | m | 20 |\n').map((x) => [x.nr_id, x.cod, x.stare]), [['1', 'SA11G1', 'ancora'], ['2', 'SA11G2', 'ancora']])
})
