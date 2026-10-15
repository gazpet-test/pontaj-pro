import { assertEquals } from 'jsr:@std/assert@1'
import { conventieDocument, interpretari, pozitieDovedita, valoareInDocument } from './cantNumar.ts'

Deno.test('interpretari: unic vs ambiguu', () => {
  assertEquals(interpretari('3.995,00'), [3995])
  assertEquals(interpretari('3.995').sort(), [3.995, 3995].sort())
  assertEquals(interpretari('470.000').sort(), [470, 470000].sort())
  assertEquals(interpretari('1160.000'), [1160])
  assertEquals(interpretari('16.00'), [16])
  assertEquals(interpretari('2,5'), [2.5])
  assertEquals(interpretari('3995'), [3995])
  assertEquals(interpretari('1,234.56'), [1234.56])
})

Deno.test('convenția: doar dovezile tari; 1–2 zecimale nu sunt dovadă', () => {
  assertEquals(conventieDocument('lungime totală de 3.995,00 m; cap. 3.1; 2,5 m').conventie, 'ro')
  assertEquals(conventieDocument('003 SA11G1 M 1160.000; 0.00; 2,5').conventie, 'en')
  assertEquals(conventieDocument('003 SA11G1 M 470.000; 16.00; 2,5').conventie, 'nedeterminata')
  assertEquals(conventieDocument('data 15.10.2026, 12.5 m').conventie, 'nedeterminata')
  // listă împărțită în două PDF-uri: convenția pe toate părțile
  assertEquals(conventieDocument(['p01: 1160.000', 'p02: 470.000']).conventie, 'en')
})

Deno.test('§6.6: convenții contradictorii în același document → ambiguitate păstrată, în ambele ordini', () => {
  const a = 'Sectiunea A: 1.234,56 lei\n', b = 'Sectiunea B: 1,234.56 lei\n', c = 'Conducta Dn 90 3.995 m\n'
  for (const t of [a + b + c, b + a + c, c + b + a]) {
    const conv = conventieDocument(t).conventie
    assertEquals(conv, 'contradictorie')
    assertEquals(valoareInDocument('3.995', conv), 'ambigua')
    const off = t.indexOf(c)
    const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Conducta Dn 90 3.995 m', cantitate: 3995, conventie: conv })
    assertEquals([p.pozitie_dovedita, p.valoare_ambigua, p.motiv], [false, true, 'token_ambiguu'])
    assertEquals(p.citat_interval, [off, off + c.length - 1])
  }
})

Deno.test('§6.6: agregare cu convenție demonstrabilă (2.000,00 + 1.995,00); fără convenție → nedovedit', () => {
  const t = 'Str. A conducta Dn 90 2.000,00 m\nStr. B conducta Dn 90 1.995,00 m\n'
  const conv = conventieDocument(t).conventie
  assertEquals(conv, 'ro')
  const pa = pozitieDovedita({ felie: t, felie_de_la: 1000, citat: 'Str. A conducta Dn 90 2.000,00 m', cantitate: 2000, conventie: conv })
  const pb = pozitieDovedita({ felie: t, felie_de_la: 1000, citat: 'Str. B conducta Dn 90 1.995,00 m', cantitate: 1995, conventie: conv })
  assertEquals([pa.pozitie_dovedita, pb.pozitie_dovedita], [true, true])
  assertEquals(pa.cantitate_offset, 1000 + t.indexOf('2.000,00'))
  assertEquals(pb.cantitate_offset, 1000 + t.indexOf('1.995,00'))
  // aceleași valori fără zecimale și fără altă dovadă: „2.000” / „1.995” sunt ambigue → incomplet
  const u = 'Str. A conducta Dn 90 2.000 m\nStr. B conducta Dn 90 1.995 m\n'
  const cu = conventieDocument(u).conventie
  assertEquals(cu, 'nedeterminata')
  const qa = pozitieDovedita({ felie: u, felie_de_la: 0, citat: 'Str. A conducta Dn 90 2.000 m', cantitate: 2000, conventie: cu })
  assertEquals([qa.pozitie_dovedita, qa.valoare_ambigua], [false, true])
})

Deno.test('§6.6: cantitate fără dovadă numerică (sursa 100 m, modelul 1000 m) → nedovedită', () => {
  const t = 'Strada A conducta 100 m\n'
  const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Strada A conducta 100 m', cantitate: 1000, conventie: 'ro' })
  assertEquals([p.pozitie_dovedita, p.motiv], [false, 'cantitate_nedovedita'])
})

Deno.test('citat multiplu / negăsit / spații normalizate; offseturi absolute (spec: R1 / R2 pe aceeași linie)', () => {
  const t = 'R1 Strada A 100 m; R2 Strada A 100 m\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Strada A 100 m', cantitate: 100, conventie: 'ro' }).motiv, 'citat_multiplu')
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Strada B 100 m', cantitate: 100, conventie: 'ro' }).motiv, 'citat_negasit')
  const p1 = pozitieDovedita({ felie: t, felie_de_la: 50, citat: 'R1  Strada   A 100 m', cantitate: 100, conventie: 'ro' })
  const p2 = pozitieDovedita({ felie: t, felie_de_la: 50, citat: 'R2 Strada A 100 m', cantitate: 100, conventie: 'ro' })
  assertEquals([p1.pozitie_dovedita, p2.pozitie_dovedita], [true, true])
  assertEquals(p1.cantitate_offset, 50 + t.indexOf('100'))
  assertEquals(p2.cantitate_offset, 50 + t.lastIndexOf('100'))
  assertEquals(p1.rand_interval, [50, 50 + t.length - 1])
})

Deno.test('Răcari (formatul F3 eDevize): 570.000 cu convenția EN a listei = 570 m; fără convenție = ambiguu', () => {
  const t = '003 SA11G1 [ 2] M 570.000\nTEAVA PVC ... D= 90 MM\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '003 SA11G1 [ 2] M 570.000', cantitate: 570, conventie: 'en' }).pozitie_dovedita, true)
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '003 SA11G1 [ 2] M 570.000', cantitate: 570, conventie: 'nedeterminata' }).motiv, 'token_ambiguu')
})
