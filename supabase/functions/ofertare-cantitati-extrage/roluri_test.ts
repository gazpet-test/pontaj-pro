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
