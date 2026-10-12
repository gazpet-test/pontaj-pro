// deno test --node-modules-dir=none supabase/functions/_shared/lot_test.ts
// parseLot = oglinda fn_ofertare_parse_lot (20261024b). CAZURI_SQL e exportat ca lista să poată fi comparată și direct
// cu SQL-ul pe un PG local (rezultatele de mai jos au fost obținute din SQL, nu scrise de mână).
import { deepStrictEqual as eq } from 'node:assert/strict'
import { coloaneLot, eligibilaPeLot, lotDinNumeFisier, lotRand, parseLot, type Lot } from './lot.ts'

const L = (...n: number[]): Lot => ({ domeniu: 'lista', loturi: n })
const T: Lot = { domeniu: 'toate', loturi: [] }
const N: Lot = { domeniu: 'necunoscut', loturi: [] }
const sir = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export const CAZURI_SQL: [string | null, Lot][] = [
  // gol / NULL = necunoscut, NU toate
  [null, N], ['', N], ['   ', N], ['\t', N], ['\n', N],
  // „toate” doar explicit (după btrim pe spațiu + lower)
  ['toate', T], ['TOATE', T], ['  Toate  ', T], ['toate loturile', T], ['all', T], ['ALL', T], ['toate cele', T],
  ['toate\t', N], ['\ttoate', N], ['toate  loturile', N], ['pentru toate loturile', N], ['toate lotur', N],
  // numere simple și forme cu „lot”
  ['2', L(2)], ['Lot 12', L(12)], ['LOT2', L(2)], ['lot 1', L(1)], ['Lotul 3', L(3)], ['LOTUL 3', L(3)],
  ['loturi 4', L(4)], ['007', L(7)], ['999', L(999)], ['1000', N], ['12a', N], ['a12', N], ['nr. 2', N],
  // liste
  ['1,2,3', L(1, 2, 3)], ['1, 2, 3', L(1, 2, 3)], ['Lot 1, Lot 2', L(1, 2)], ['3,1,2,1', L(1, 2, 3)],
  ['1;2', L(1, 2)], ['1 / 2', L(1, 2)], ['1 2', L(1, 2)], ['1,,2', L(1, 2)], [',1,', L(1)], ['1,', L(1)],
  ['loturile 1 și 3', L(1, 3)], ['loturile 1 si 3', L(1, 3)], ['LOTURILE 1 ȘI 3', L(1, 3)], ['1 and 2', L(1, 2)],
  ['lot 1 si lot 2', L(1, 2)], ['1 și 2 și 3', L(1, 2, 3)], ['1și2', N], ['1 sau 2', N],
  // intervale: cel mult 50 de loturi; 0 / invers = necunoscut
  ['1-3', L(1, 2, 3)], ['1 - 3', L(1, 2, 3)], ['Lot 2-4', L(2, 3, 4)], ['3-3', L(3)], ['1-3,7', L(1, 2, 3, 7)],
  ['1-50', L(...sir(1, 50))], ['1-51', N], ['100-149', L(...sir(100, 149))], ['100-150', N],
  ['3-1', N], ['0-2', N], ['0', N], ['lot 0', N], ['1,0', N], ['1--3', N], ['1-2-3', N], ['-1', N],
  // text liber = necunoscut
  ['comun', N], ['Lotul 1 (Ploiești)', N], ['lot unic', N], ['n/a', N], ['null', N], ['–', N], ['1–3', N],
  // motorul: btrim doar spațiu, \s fără NBSP, lower caracter cu caracter
  ['\tLot 2\n', L(2)], ['1 2', N], ['1 2', L(1, 2)], ['LOTURİ 5', L(5)], ['plot 2', N],
]

Deno.test('parseLot: toate cazurile comparate cu fn_ofertare_parse_lot', () => {
  for (const [intrare, asteptat] of CAZURI_SQL) eq(parseLot(intrare), asteptat, JSON.stringify(intrare))
})
Deno.test('parseLot: „Lot 12” → [12] (bug-ul vechi /LOT\\s*(\\d)/ dădea 1)', () => {
  eq(parseLot('Lot 12'), L(12)); eq(parseLot(undefined), N)
})

Deno.test('eligibilaPeLot: lista / toate / necunoscut, selecție null = fără filtru', () => {
  eq(eligibilaPeLot(L(1), [1, 2, 3]), true)
  eq(eligibilaPeLot(L(1, 2, 3), [1]), true)
  eq(eligibilaPeLot(L(12), [1]), false)
  eq(eligibilaPeLot(L(1), [12]), false)
  eq(eligibilaPeLot(T, [4]), true)
  eq(eligibilaPeLot(N, [1]), false)          // necunoscut ≠ toate
  eq(eligibilaPeLot(N, null), true)          // fără filtru: comportamentul vechi
  eq(eligibilaPeLot(L(2), []), false)
})

Deno.test('lotRand: coloanele noi au prioritate, rândurile vechi se parsează din `lot`', () => {
  eq(lotRand({ lot_domeniu: 'lista', lot_nr: [3, 1, 3], lot: 'toate' }), L(1, 3))
  eq(lotRand({ lot_domeniu: 'necunoscut', lot_nr: null, lot: 'toate' }), N)
  eq(lotRand({ lot_domeniu: 'toate', lot_nr: null, lot: '2' }), T)
  eq(lotRand({ lot_domeniu: 'lista', lot_nr: [], lot: '2' }), N)
  eq(lotRand({ lot_domeniu: null, lot: '1,2' }), L(1, 2))
  eq(lotRand({ lot: null }), N)
})

Deno.test('lotDinNumeFisier: fragmentele „lot N” din numele fișierului', () => {
  eq(lotDinNumeFisier('Caiet de sarcini LOT 12.pdf'), { ...L(12), brut: 'LOT 12' })
  eq(lotDinNumeFisier('CS_Lot2_vol1.pdf'), { ...L(2), brut: 'Lot2' })
  eq(lotDinNumeFisier('Lista cantitati lot_1-3.xlsx'), { ...L(1, 2, 3), brut: 'lot 1-3' })
  eq(lotDinNumeFisier('Lot 1 si Lot 3 - clarificari.pdf'), { ...L(1, 3), brut: 'Lot 1 si Lot 3' })
  eq(lotDinNumeFisier('Lotul 2 - 2024.pdf').loturi, [2])
  eq(lotDinNumeFisier('Fisa de date.pdf'), { ...N, brut: null })
  eq(lotDinNumeFisier('Pilot2 plan.pdf'), { ...N, brut: null })
  eq(lotDinNumeFisier('LOT 1234.pdf'), { ...N, brut: null })
  eq(lotDinNumeFisier('Lot 0.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier(null), { ...N, brut: null })
})

Deno.test('coloaneLot: coerent cu CHECK-ul (lista ⇒ lot_nr nevid; altfel NULL)', () => {
  eq(coloaneLot(L(2, 3), 'model', 'Lot 2, 3'), { lot_domeniu: 'lista', lot_nr: [2, 3], lot_sursa: 'model', lot_brut: 'Lot 2, 3' })
  eq(coloaneLot(T, 'model', 'toate'), { lot_domeniu: 'toate', lot_nr: null, lot_sursa: 'model', lot_brut: 'toate' })
  eq(coloaneLot(N, 'nume_fisier', null), { lot_domeniu: 'necunoscut', lot_nr: null, lot_sursa: 'nume_fisier', lot_brut: null })
  eq(coloaneLot({ domeniu: 'lista', loturi: [] }, 'model', 'x').lot_domeniu, 'necunoscut')
})

Deno.test('lotDinNumeFisier: expresia întreagă (review Jakarinos P2 #7), legătură neînțeleasă = necunoscut', () => {
  eq(lotDinNumeFisier('Cantitati loturile 1 si 2.xlsx'), { ...L(1, 2), brut: 'loturile 1 si 2' })
  eq(lotDinNumeFisier('Lot 1, 2 și 4 - liste.pdf').loturi, [1, 2, 4])
  eq(lotDinNumeFisier('Lot 1+2.pdf'), { ...N, brut: 'Lot 1+2' })
  eq(lotDinNumeFisier('Lot 1 sau 2.pdf'), { ...N, brut: 'Lot 1 sau 2' })
  eq(lotDinNumeFisier('Lot 2 si Lot 1-3.pdf').loturi, [1, 2, 3])
  eq(lotDinNumeFisier('Lot 2 si Lot 0.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier('Lot 3 2024.pdf').loturi, [3])
})

Deno.test('lotDinNumeFisier r2 (review Jakarinos r2 P2 #7): underscore, liniuță lungă, „sau” între fragmente', () => {
  eq(lotDinNumeFisier('Loturile_1_si_2.pdf').loturi, [1, 2])
  eq(lotDinNumeFisier('Lot 1–3.pdf').loturi, [1, 2, 3])
  eq(lotDinNumeFisier('Lot 1—2.pdf').loturi, [1, 2])
  eq(lotDinNumeFisier('Lot 1 sau Lot 2.pdf'), { ...N, brut: 'Lot 1 sau Lot 2' })
  eq(lotDinNumeFisier('Lot 1 & Lot 2.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier('lot.2 si lot:3.pdf').loturi, [2, 3])
  eq(lotDinNumeFisier('Lotul 2 - 2024.pdf').loturi, [2])
})

Deno.test('lotDinNumeFisier r3 (review Jakarinos r3 P2 #4): legătura refuzată dintre fragmente = necunoscut', () => {
  eq(lotDinNumeFisier('Lot 1 sau anexa Lot 2.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier('Lot 1 + anexa Lot 2.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier('Lot 1 & anexa Lot 2.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier('Lot 1 or annex Lot 2.pdf').domeniu, 'necunoscut')
  eq(lotDinNumeFisier('Lot 1 anexa Lot 2.pdf').loturi, [1, 2])          // fără legătură refuzată: reuniune, ca înainte
  eq(lotDinNumeFisier('Lot 1 - clarificari - Lot 3.pdf').loturi, [1, 3])
})
