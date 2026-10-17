import { assert, assertEquals } from 'jsr:@std/assert@1'
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
    const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Conducta Dn 90 3.995 m', cantitate: 3995, um: 'm', conventie: conv })
    assertEquals([p.pozitie_dovedita, p.valoare_ambigua, p.motiv], [false, true, 'token_ambiguu'])
    assertEquals(p.citat_interval, [off, off + c.length - 1])
  }
})

Deno.test('§6.6: agregare cu convenție demonstrabilă (2.000,00 + 1.995,00); fără convenție → nedovedit', () => {
  const t = 'Str. A conducta Dn 90 2.000,00 m\nStr. B conducta Dn 90 1.995,00 m\n'
  const conv = conventieDocument(t).conventie
  assertEquals(conv, 'ro')
  const pa = pozitieDovedita({ felie: t, felie_de_la: 1000, citat: 'Str. A conducta Dn 90 2.000,00 m', cantitate: 2000, um: 'm', conventie: conv })
  const pb = pozitieDovedita({ felie: t, felie_de_la: 1000, citat: 'Str. B conducta Dn 90 1.995,00 m', cantitate: 1995, um: 'm', conventie: conv })
  assertEquals([pa.pozitie_dovedita, pb.pozitie_dovedita], [true, true])
  assertEquals(pa.cantitate_offset, 1000 + t.indexOf('2.000,00'))
  assertEquals(pb.cantitate_offset, 1000 + t.indexOf('1.995,00'))
  // aceleași valori fără zecimale și fără altă dovadă: „2.000” / „1.995” sunt ambigue → incomplet
  const u = 'Str. A conducta Dn 90 2.000 m\nStr. B conducta Dn 90 1.995 m\n'
  const cu = conventieDocument(u).conventie
  assertEquals(cu, 'nedeterminata')
  const qa = pozitieDovedita({ felie: u, felie_de_la: 0, citat: 'Str. A conducta Dn 90 2.000 m', cantitate: 2000, um: 'm', conventie: cu })
  assertEquals([qa.pozitie_dovedita, qa.valoare_ambigua], [false, true])
})

Deno.test('§6.6: cantitate fără dovadă numerică (sursa 100 m, modelul 1000 m) → nedovedită', () => {
  const t = 'Strada A conducta 100 m\n'
  const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Strada A conducta 100 m', cantitate: 1000, um: 'm', conventie: 'ro' })
  assertEquals([p.pozitie_dovedita, p.motiv], [false, 'cantitate_nedovedita'])
})

Deno.test('citat multiplu / negăsit / spații normalizate; offseturi absolute (spec: R1 / R2 pe aceeași linie)', () => {
  const t = 'R1 Strada A 100 m; R2 Strada A 100 m\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Strada A 100 m', cantitate: 100, um: 'm', conventie: 'ro' }).motiv, 'citat_multiplu')
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Strada B 100 m', cantitate: 100, um: 'm', conventie: 'ro' }).motiv, 'citat_negasit')
  const p1 = pozitieDovedita({ felie: t, felie_de_la: 50, citat: 'R1  Strada   A 100 m', cantitate: 100, um: 'm', conventie: 'ro' })
  const p2 = pozitieDovedita({ felie: t, felie_de_la: 50, citat: 'R2 Strada A 100 m', cantitate: 100, um: 'm', conventie: 'ro' })
  assertEquals([p1.pozitie_dovedita, p2.pozitie_dovedita], [true, true])
  assertEquals(p1.cantitate_offset, 50 + t.indexOf('100'))
  assertEquals(p2.cantitate_offset, 50 + t.lastIndexOf('100'))
  assertEquals(p1.rand_interval, [50, 50 + t.length - 1])
})

Deno.test('Răcari (formatul F3 eDevize): 570.000 cu convenția EN a listei = 570 m; fără convenție = ambiguu', () => {
  const t = '003 SA11G1 [ 2] M 570.000\nTEAVA PVC ... D= 90 MM\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '003 SA11G1 [ 2] M 570.000', cantitate: 570, um: 'm', conventie: 'en' }).pozitie_dovedita, true)
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '003 SA11G1 [ 2] M 570.000', cantitate: 570, um: 'm', conventie: 'nedeterminata' }).motiv, 'token_ambiguu')
})

// ── review r1 (Jakarinos / Copilot): reproducerile, ca teste ──
Deno.test('r1: un citat nu poate tăia un număr („Conducta 100” din „Conducta 1000 m”; „995 m” din „3.995 m”)', () => {
  const t = 'Conducta 1000 m\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Conducta 100', cantitate: 100, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
  const u = 'Retea 3.995 m\n'
  const p = pozitieDovedita({ felie: u, felie_de_la: 0, citat: '995 m', cantitate: 995, um: 'm', conventie: 'nedeterminata' })
  assertEquals([p.pozitie_dovedita, p.motiv], [false, 'cantitate_nedovedita'])
})
Deno.test('r1: tokenul trebuie să fie cantitatea CU UM-ul ei (nu diametrul, nu alt UM)', () => {
  const t = 'Conducta PEHD DN90 120 m\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Conducta PEHD DN90 120 m', cantitate: 90, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'Conducta PEHD DN90 120 m', cantitate: 120, um: 'm', conventie: 'ro' }).pozitie_dovedita, true)
  const k = 'Conducta 10 km\n'
  assertEquals(pozitieDovedita({ felie: k, felie_de_la: 0, citat: 'Conducta 10 km', cantitate: 10, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
  assertEquals(pozitieDovedita({ felie: k, felie_de_la: 0, citat: 'Conducta 10 km', cantitate: 10, um: null, conventie: 'ro' }).motiv, 'fara_um')
})
Deno.test('r1: UM din antetul coloanei unui tabel markdown („LUNGIME (m)”); F3 „M 570.000”', () => {
  const t = '| Nr | STRADA | DIAMETRU | LUNGIME (m) |\n|---|---|---|---|\n| 1 | ORACA | 90 | 52 |\n'
  const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: '| 1 | ORACA | 90 | 52 |', cantitate: 52, um: 'm', conventie: 'nedeterminata' })
  assertEquals([p.pozitie_dovedita, p.cantitate_offset], [true, t.indexOf('52')])
  // 90 e în coloana DIAMETRU, fără UM de lungime în antet → nu e cantitatea
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '| 1 | ORACA | 90 | 52 |', cantitate: 90, um: 'm', conventie: 'nedeterminata' }).pozitie_dovedita, false)
})
Deno.test('r1 (P2): separatorul de mii prin spațiu neîntrerupt / fin („3 995,00 m”)', () => {
  const t = 'lungime totala 3 995,00 m\n'
  const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: 'lungime totala 3 995,00 m', cantitate: 3995, um: 'm', conventie: 'nedeterminata' })
  assertEquals([p.pozitie_dovedita, p.cantitate_offset], [true, t.indexOf('3 995')])
  // spațiul obișnuit NU e separator de mii („Dn 90 120 m” nu devine 90120)
  assertEquals(pozitieDovedita({ felie: 'Dn 90 120 m', felie_de_la: 0, citat: 'Dn 90 120 m', cantitate: 90120, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
})

// ── review r2 (Jakarinos / Copilot): reproducerile, ca teste ──
Deno.test('r2: diametrul din denumire nu ia unitatea coloanei vecine („| Conducta DN90 | m | 120 |”)', () => {
  const t = '| Conducta DN90 | m | 120 |\n'
  const c = '| Conducta DN90 | m | 120 |'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: c, cantitate: 90, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
  const p = pozitieDovedita({ felie: t, felie_de_la: 0, citat: c, cantitate: 120, um: 'm', conventie: 'ro' })
  assertEquals([p.pozitie_dovedita, p.cantitate_offset], [true, t.indexOf('120')])
  // F3 eDevize: cantitatea singură în celulă, unitatea la capătul celulei dinainte
  const f = '**003 SA11G1** [2] M | 130.000 | | | TEAVA PVC D= 90 MM |\n'
  assertEquals(pozitieDovedita({ felie: f, felie_de_la: 0, citat: f.trim(), cantitate: 130, um: 'm', conventie: 'en' }).pozitie_dovedita, true)
  assertEquals(pozitieDovedita({ felie: f, felie_de_la: 0, citat: f.trim(), cantitate: 90, um: 'm', conventie: 'en' }).pozitie_dovedita, false)
})
Deno.test('r2: un număr tăiat la marginea feliei („100” din „1000”) nu e dovedit — tokenii din textul întreg', () => {
  const doc = 'x'.repeat(54985) + '\nConducta m 1000'
  const felie = doc.slice(0, 55000)
  assert(felie.endsWith('Conducta m 100'))
  const p = pozitieDovedita({ felie, felie_de_la: 0, citat: 'Conducta m 100', cantitate: 100, um: 'm', conventie: 'ro', text_doc: doc })
  assertEquals(p.pozitie_dovedita, false)
  // aceeași felie, la offset nenul în document: offseturile rămân absolute
  const d2 = 'abc\n' + 'Conducta m 1000 si\n'
  const q = pozitieDovedita({ felie: d2.slice(4), felie_de_la: 4, citat: 'Conducta m 1000', cantitate: 1000, um: 'm', conventie: 'ro', text_doc: d2 })
  assertEquals([q.pozitie_dovedita, q.cantitate_offset, q.citat_interval], [true, d2.indexOf('1000'), [4, 4 + 'Conducta m 1000'.length]])
})
Deno.test('r2 (P2): m2 / m3 / m² / m³ lângă cantitate și în antet', () => {
  assertEquals(pozitieDovedita({ felie: 'sapatura 120 m3\n', felie_de_la: 0, citat: 'sapatura 120 m3', cantitate: 120, um: 'mc', conventie: 'ro' }).pozitie_dovedita, true)
  assertEquals(pozitieDovedita({ felie: 'refacere 35 m²\n', felie_de_la: 0, citat: 'refacere 35 m²', cantitate: 35, um: 'mp', conventie: 'ro' }).pozitie_dovedita, true)
  const t = '| Lucrare | Cant. (m3) |\n|---|---|\n| sapatura | 120 |\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '| sapatura | 120 |', cantitate: 120, um: 'mc', conventie: 'ro' }).pozitie_dovedita, true)
})

// ── review r4 (Jakarinos): reproducerile, ca teste ──
Deno.test('r4: exponentul unei unități (m3 / m2) nu e cantitate; codurile cu cifre lipite (DN90, PE100) nu sunt tokeni', () => {
  const t = 'Conducta PE100 DN90: volum 120 m3\n'
  const c = 'Conducta PE100 DN90: volum 120 m3'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: c, cantitate: 3, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: c, cantitate: 100, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: c, cantitate: 120, um: 'mc', conventie: 'ro' }).pozitie_dovedita, true)
  const s = 'refacere 35 m2\n'
  assertEquals(pozitieDovedita({ felie: s, felie_de_la: 0, citat: 'refacere 35 m2', cantitate: 2, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
})
Deno.test('r4: prefixul de diametru recunoscut oricâte spații ar fi („Conducta DN     90” sub antetul „Denumire (m)”)', () => {
  const t = '| Denumire (m) | Cant |\n|---|---|\n| Conducta DN     90 | 120 |\n'
  assertEquals(pozitieDovedita({ felie: t, felie_de_la: 0, citat: '| Conducta DN     90 | 120 |', cantitate: 90, um: 'm', conventie: 'ro' }).pozitie_dovedita, false)
})

// antetul C6 real (Răcari 212, felia 7): „Consumuri” e coloana de cantitate; rândul de numerotare „0 | 1 | 2 …” se sare
const C6 = 'Nr. Crt. | Denumirea resursei materiale | U.M. | Consumuri cuprinse in oferta | Pret unitar (exclusiv TVA) RON\n0 | 1 | 2 | 3 | 4\n'
const dov = (t: string, citat: string, cantitate: number, um = 'm') =>
  pozitieDovedita({ felie: t, felie_de_la: 0, citat, cantitate, um, conventie: 'en' }).pozitie_dovedita
Deno.test('limită cunoscută (#754 r2): ultima celulă fără „|” NU se dovedește, nici sub antetul C6 real; nici contraexemplele Jakarinos r2', () => {
  assertEquals(dov(C6 + '30 | 7334280 TEAVA PE80 DN 90 | M | 120.00\n', '| M | 120.00', 120), false)
  assertEquals(dov(C6 + '2 | 2200068 PIETRIS | M.C. | 0.15\n', '| M.C. | 0.15', 0.15, 'mc'), false)
  // r2: alinierea după „|” inițial, antet pe două linii, „Cost pe unitate de cantitate” → toate nedovedite
  assertEquals(dov('Cod | Denumire | UM | Pret unitar | Cantitate\n| SA11G1 | TEAVA PE80 DN 90 | m | 50.00\n', '| m | 50.00', 50), false)
  assertEquals(dov('Cod | Denumire | UM | Pret pe unitate de\n | | | cantitate\nSA11G1 | TEAVA PE80 DN 90 | m | 50.00\n', '| m | 50.00', 50), false)
  assertEquals(dov('Cod | Denumire | UM | Cost pe unitate de cantitate\nSA11G1 | TEAVA PE80 DN 90 | m | 50.00\n', '| m | 50.00', 50), false)
  // celula închisă rămâne cum era: „| M | 120.00 |” sub antet → dovedită
  assertEquals(dov(C6 + '30 | 7334280 TEAVA PE80 DN 90 | M | 120.00 |\n', '| M | 120.00 |', 120), true)
})
Deno.test('review Jakarinos r1 (P1): prețul din ultima coloană nu devine cantitate; UM-ul nu vine de pe rândul următor', () => {
  // ultima coloană = „Pret unitar (lei/m)” → prețul 50 NU e dovedit ca 50 m
  const pret = '| Cod | Denumire | Cantitate | UM | Pret unitar (lei/m)\n|---|---|---|---|---|\n| SA11G1 | TEAVA PE80 DN 90 | 120 | m | 50.00\n'
  assertEquals(dov(pret, '| m | 50.00', 50), false)
  // UM „m” de pe rândul următor nu se atribuie cantității 120 (UM-ul ei e „kg”)
  const urm = '| Cod | UM | Cantitate\n| SA11G1 | kg | 120\n| m | 50\n'
  assertEquals(dov(urm, '| SA11G1 | kg | 120', 120), false)
  // aceeași fără newline în cale: „120 m” pe aceeași linie rămâne dovedit
  assertEquals(dov('Conducta PE 120 m\n', 'Conducta PE 120 m', 120), true)
})
