import { assertEquals } from 'jsr:@std/assert@1'
import { cheieSectiune, paginaAreMarcajAtr, rolDinTitlu, sectiuniRol } from './roluri.ts'

Deno.test('rolul din titlu / tip', () => {
  assertEquals(rolDinTitlu('Instructiuni_ofertanti_FisaDate_DF1279352.pdf', 'fisa_date').rol, 'fisa_date')
  assertEquals(rolDinTitlu('2. Caiet sarcini_Extindere Gaze Racari s.e..pdf', 'cs_volum').rol, 'cs')
  assertEquals(rolDinTitlu('Pth extindere gaze oras Racari-part.1 s.e. — p01_pag1-48.pdf', 'alta').rol, 'memoriu')
  assertEquals(rolDinTitlu('Raspuns consolidat nr. 1 Gaze Racari s.e..pdf', 'raspuns_clarificare').rol, 'raspuns')
  assertEquals(rolDinTitlu('C.U. EXTINDERE RETEA GAZE NATURALE s.e.pdf', 'alta').rol, 'alt')
})

Deno.test('marcajul ATR: titlu de rând sau ATR; NU un rând numerotat de borderou', () => {
  assertEquals(paginaAreMarcajAtr('BORDEROU\n1. Aviz tehnic de racordare emis de SC Distrigaz nr. 1\n2. Certificat de urbanism'), false)
  assertEquals(paginaAreMarcajAtr('DISTRIGAZ\nAVIZ TEHNIC DE RACORDARE\n1. Ca urmare a cererii'), true)
  assertEquals(paginaAreMarcajAtr('[PLANȘĂ: Tabel cu DATE TEHNICE DE RACORDARE - ORAS RACARI]'), true)
  assertEquals(paginaAreMarcajAtr('Alte informatii | ATR ORASUL RACARI PLAN 4'), true)
  assertEquals(paginaAreMarcajAtr('b) Anexa 1 la ATR nr. 13745233'), true)
})

Deno.test('secțiunile pe pagini: ATR doar pe paginile marcate, restul după titlu; comasare', () => {
  const t = '⟦PAGINA 1⟧\nBorderou\n1. Aviz tehnic de racordare emis de X\n⟦PAGINA 2⟧\nAVIZ TEHNIC DE RACORDARE\ntext\n'
    + '⟦PAGINA 3⟧\nMemoriu\n⟦PAGINA 4⟧\nmemoriu\n'
  const s = sectiuniRol(t, 'Pth extindere part.1', 'alta')
  assertEquals(s.map((x) => [x.rol, x.decis_de, x.pagini]), [['memoriu', 'titlu', [1, 1]], ['atr', 'marcaj', [2, 2]], ['memoriu', 'titlu', [3, 4]]])
  assertEquals(s.map((x) => cheieSectiune(x, false)), ['1-1', '2-2', '3-4'])
  assertEquals(t.slice(s[1].de, s[1].pana).startsWith('⟦PAGINA 2⟧'), true)
})

Deno.test('lista de cantități: rolul din antet (F3 / C6 / C9); fără antet = F3 după titlu', () => {
  const t = 'Formularul F3\nLista cu cantitatile de lucrari\n003 SA11G1 M 570.000\nFormular C6\nLista cuprinzand consumurile de resurse materiale\nteava 106.336\n'
  assertEquals(sectiuniRol(t, 'Liste', 'lista_cantitati').map((x) => [x.rol, x.decis_de]), [['f3', 'antet'], ['c6', 'antet']])
  assertEquals(sectiuniRol('003 SA11G1 M 570.000', 'Liste', 'lista_cantitati').map((x) => [x.rol, x.decis_de]), [['f3', 'titlu']])
})

Deno.test('r1: ordinea nu depinde de tipul documentului — F3 într-un cs_volum = f3; pagină ATR într-o listă fără antet = atr', () => {
  const f3 = 'Formularul F3\nLista cu cantitatile de lucrari\n003 SA11G1 M 570.000\n'
  assertEquals(sectiuniRol(f3, '2. Caiet sarcini', 'cs_volum').map((x) => [x.rol, x.decis_de]), [['f3', 'antet']])
  const atr = '⟦PAGINA 1⟧\n003 SA11G1 M 570.000\n⟦PAGINA 2⟧\nAVIZ TEHNIC DE RACORDARE\n'
  assertEquals(sectiuniRol(atr, 'Liste', 'lista_cantitati').map((x) => [x.rol, x.decis_de]), [['f3', 'titlu'], ['atr', 'marcaj']])
})

Deno.test('r2: antetul guvernează doar de la pagina lui; pagina ATR dinainte rămâne ATR (pe secțiune, nu global)', () => {
  const t = '⟦PAGINA 1⟧\nAVIZ TEHNIC DE RACORDARE\nstr. A 52 m\n⟦PAGINA 2⟧\nFormularul F3\nLista cu cantitatile de lucrari\n003 SA11G1 M 570.000\n'
  const s = sectiuniRol(t, 'Memoriu tehnic', 'alta')
  assertEquals(s.map((x) => [x.rol, x.decis_de]), [['atr', 'marcaj'], ['f3', 'antet']])
  assertEquals(t.slice(s[1].de, s[1].pana).startsWith('⟦PAGINA 2⟧'), true)
  // memoriu cu un F3 anexat la final: paginile memoriului rămân memoriu
  const m = '⟦PAGINA 1⟧\nMemoriu tehnic\n⟦PAGINA 2⟧\ntext\n⟦PAGINA 3⟧\nFormularul F3\n003 X M 10.000\n'
  assertEquals(sectiuniRol(m, 'Memoriu tehnic', 'alta').map((x) => [x.rol, x.pagini]), [['memoriu', [1, 2]], ['f3', [3, 3]]])
})

Deno.test('r3: memoriu → F3 → pagină ATR explicită: ATR-ul de după antet nu moștenește F3', () => {
  const t = '⟦PAGINA 1⟧\nMemoriu tehnic\n⟦PAGINA 2⟧\nFormularul F3\n003 X M 10.000\n⟦PAGINA 3⟧\nAVIZ TEHNIC DE RACORDARE\nstr. A 52 m\n⟦PAGINA 4⟧\n003 Y M 20.000\n'
  assertEquals(sectiuniRol(t, 'Memoriu tehnic', 'alta').map((x) => [x.rol, x.decis_de, x.pagini]),
    [['memoriu', 'titlu', [1, 1]], ['f3', 'antet', [2, 2]], ['atr', 'marcaj', [3, 3]], ['f3', 'antet', [4, 4]]])
})

Deno.test('B1 r3 (review #751 r2, P1-2): sectiuniRol recunoaște „Lista consumurilor …” la fel ca sectiuniLista (C6 / lista_alt, nu F3 din titlu)', () => {
  const c6 = sectiuniRol('⟦PAGINA 1⟧\nLista consumurilor de resurse materiale\n1 | 6701152 | M | 130.00\n', 'Liste de cantitati.pdf', 'lista_cantitati')
  assertEquals(c6.map((x) => [x.rol, x.decis_de]), [['c6', 'antet']])
  const c8 = sectiuniRol('⟦PAGINA 1⟧\nLista consumurilor de ore de functionare a utilajelor\n1 | 2509 | 3.0\n', 'Liste de cantitati.pdf', 'lista_cantitati')
  assertEquals(c8.map((x) => [x.rol, x.decis_de]), [['lista_alt', 'antet']])
})

Deno.test('B1 r5 (review r4, P1-2): sectiuniRol — mențiunea „Centralizatorul cheltuielilor” în text nu reclasifică pagina F3', () => {
  const t = '⟦PAGINA 1⟧\nFormular F3\n001 SA11G1 [ 2] M 10.000\n⟦PAGINA 2⟧\n002 SA11G1 [ 2] M 20.000\nValorile se regăsesc în Centralizatorul cheltuielilor pe obiect.\n'
  assertEquals([...new Set(sectiuniRol(t, 'Liste de cantitati.pdf', 'lista_cantitati').map((x) => x.rol))], ['f3'])
})
