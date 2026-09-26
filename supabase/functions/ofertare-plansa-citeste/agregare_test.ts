// deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/agregare_test.ts
// R5: adnotările pe diametre absente din tabel NU intră în total; posibila_dublura = avertisment, fără deduplicare.
// + IDENTITATEA RÂNDULUI de tabel (doc, pagină, tabel, Nr) în locul dedup-ului pe text/multiset (Copilot, runda 3) —
//   cazuri sintetice + fixture reală din planșa 470 (fixture_470.ts, z?_6 cu Nr + z?_7 cu lungimi).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { agregaTronsoane, identificaRanduri, MOTIV_AFARA_NR, MOTIV_COLOANA_NR, MOTIV_COLOANA_NR_FARA_GEOM, MOTIV_DN_ABSENT, notaRestTransfer, nrRand } from './handler.ts'
import { AZI_470, feliiDin470, RANDURI_Z6 } from './fixture_470.ts'

const total = (l: any[]) => l.reduce((s, t) => s + t.lungime_m, 0)

Deno.test('R5 caz 470: adnotare Dn250 1370 = rând tabel Dn200 1370 → fără dublare + posibila_dublura', () => {
  const r = agregaTronsoane([
    { sursa: 'tabel', diametru_mm: 200, material: 'PE', lungime_m: 1370, de_la: 'Nod 7', la: 'Nod 8' },
    { sursa: 'tabel', diametru_mm: 110, material: 'PE', lungime_m: 500, de_la: 'Nod 8', la: 'Nod 9' },
    { sursa: 'adnotare', diametru_mm: 250, material: 'PE', lungime_m: 1370, _zona: 'r1c2' },
  ])
  assertEquals(total(r.pentruCantitati), 1870)
  assert(r.pentruCantitati.every((t) => t.sursa === 'tabel'))
  assertEquals(r.avertismenteDublura.length, 1)
  assertEquals(r.avertismenteDublura[0].tip, 'posibila_dublura')
  assertEquals(r.avertismenteDublura[0].rand_tabel.diametru_mm, 200)
  assertEquals(r.avertismenteDublura[0].rand_tabel.index, 0)
  assertEquals(r.adnotariDiametruAbsent.length, 1)
  assertEquals(r.adnotariDiametruAbsent[0].motiv, MOTIV_DN_ABSENT)
})

Deno.test('R5: adnotare pe Dn absent fără pereche → nu intră în total, rămâne observație', () => {
  const r = agregaTronsoane([
    { sursa: 'tabel', diametru_mm: 200, material: 'PE', lungime_m: 1370 },
    { sursa: 'adnotare', diametru_mm: 63, material: 'PE', lungime_m: 245, _zona: 'r2c1' },
  ])
  assertEquals(total(r.pentruCantitati), 1370)
  assertEquals(r.avertismenteDublura.length, 0)
  assertEquals(r.adnotariDiametruAbsent.map((t) => [t.diametru_mm, t.lungime_m, t.motiv]), [[63, 245, MOTIV_DN_ABSENT]])
  assertEquals(r.adnotariNeconfirmate.length, 1)
})

Deno.test('R5: fără tabel, adnotările rămân sursa cantităților', () => {
  const r = agregaTronsoane([{ sursa: 'adnotare', diametru_mm: 110, lungime_m: 300 }])
  assertEquals(total(r.pentruCantitati), 300)
  assertEquals(r.adnotariDiametruAbsent.length, 0)
})

// ---- 25.09.2026 (Copilot, runda 3): IDENTITATEA RÂNDULUI, nu textul ----
// Tabel ca în planșa 470, variantă compactă: Nr + capete + Dn + lungime în aceeași felie.
const COL = ['Nr crt', 'Strada', 'Str. De la', 'Str. Pana la', 'Dn ales (mm)', 'Debit mc/h', 'Lungime Km']
const R = (nr: string, o: any = {}) => ({ 'Nr crt': nr, 'Strada': 'C-tin Brancoveanu', 'Str. De la': 'Florenta Albu', 'Str. Pana la': 'CT',
  'Dn ales (mm)': '40', 'Debit mc/h': '20', 'Lungime Km': '0,300', ...o })
const T = (o: any = {}) => ({ de_la: 'Florenta Albu', la: 'CT', lungime_m: 300, diametru_mm: 40, debit_mch: 20, zona: 'C-tin Brancoveanu', sursa: 'tabel', material: null, ...o })
const felieTab = (eticheta: string, randuri: any[], tronsoane: any[], coloane = COL) => ({ eticheta, tabele: [{ denumire: 'Dimensionare', coloane, randuri }], tronsoane })
const L = (x: any[]) => x.reduce((s: number, t: any) => s + t.lungime_m, 0)

Deno.test('identitate (1): Nr 37/40/41 cu text IDENTIC în aceeași felie rămân 3 rânduri distincte', () => {
  const r = identificaRanduri([felieTab('z2_7', [R('37'), R('40'), R('41')], [T(), T(), T()])], { doc: 470 })
  assertEquals(r.sigure.map((t) => t._nr), ['37', '40', '41'])
  assertEquals(r.total_sigur_m, 900)
  assertEquals([r.faraIdentitate.length, r.conflicte.length, r.total_de_verificat_m], [0, 0, 0])
  assert(r.sigure.every((t) => t._identitate_tip === 'nr' && /^doc 470\|p1\|.*\|nr \d+$/.test(t._identitate)), r.sigure[0]._identitate)
})
Deno.test('identitate (1b): Nr în felia din stânga (z2_6), lungimea în dreapta (z2_7) — împerechere pe ordine + câmp comun => 37/40/41 distincte', () => {
  // rândurile Nr 36–42 din 470 (z2_6 idx 4–10 / z2_7 idx 4–10): vecinii diferiți fixează decalajul (δ = 0, unic)
  const C6 = ['Nr crt', 'Strada', 'Str. De la', 'Str. Pana la'], C7 = ['Strada', 'Str. De la', 'Str. Pana la', 'Dn ales (mm)', 'Debit mc/h', 'Lungime Km']
  const rr: [string, string, string, string, string, string, number][] = [
    ['36', 'Florenta Albu', 'Aurel Vlaicu', 'C-tin Brancoveanu', '110', '0,110', 110], ['37', 'C-tin Brancoveanu', 'Florenta Albu', 'CT', '40', '0,300', 300],
    ['38', 'C-tin Brancoveanu', 'Florenta Albu', 'CT', '40', '0,320', 320], ['39', 'Florenta Albu', 'C-tin Brancoveanu', 'Cuza Voda', '110', '0,110', 110],
    ['40', 'C-tin Brancoveanu', 'Florenta Albu', 'CT', '40', '0,300', 300], ['41', 'C-tin Brancoveanu', 'Florenta Albu', 'CT', '40', '0,300', 300],
    ['42', 'Florenta Albu', 'Cuza Voda', 'Mihai Viteazu', '90', '0,110', 110]]
  const r6 = rr.map(([nr, st, dl, pl]) => ({ 'Nr crt': nr, 'Strada': st, 'Str. De la': dl, 'Str. Pana la': pl }))
  const r7 = rr.map(([, st, dl, pl, dn, l]) => ({ 'Strada': st, 'Str. De la': dl, 'Str. Pana la': pl, 'Dn ales (mm)': dn, 'Debit mc/h': '20', 'Lungime Km': l }))
  const t7 = rr.map(([, st, dl, pl, dn, , L]) => T({ de_la: dl, la: pl, zona: st, diametru_mm: Number(dn), lungime_m: L }))
  const r = identificaRanduri([felieTab('z2_6', r6, [], C6), felieTab('z2_7', r7, t7, C7)], { doc: 470 })
  assertEquals(r.sigure.map((t) => [t._nr, t.lungime_m]), rr.map(([nr, , , , , , L]) => [nr, L]))
  assertEquals(r.total_sigur_m, 1550)
  assertEquals(r.sigure.filter((t) => t.lungime_m === 300).map((t) => t._nr), ['37', '40', '41'])
  assertEquals(r.perechi.map((p) => [p.a, p.b, p.delta, p.prin]), [['z2_6', 'z2_7', 0, 'câmp comun + ordine']])
  // aceleași rânduri, dar DOAR cele 4 identice ca text (37, 38, 40, 41 fără vecini): decalajul nu mai e unic => de verificat
  const id4 = [1, 2, 4, 5]
  const r4 = identificaRanduri([felieTab('z2_6', id4.map((i) => r6[i]), [], C6), felieTab('z2_7', id4.map((i) => r7[i]), id4.map((i) => t7[i]), C7)], { doc: 470 })
  assertEquals([r4.sigure.length, r4.faraIdentitate.length], [0, 4])
  assert(r4.faraIdentitate.every((t) => t._motiv.startsWith('Nr în felia vecină')), r4.faraIdentitate[0]._motiv)
})
Deno.test('identitate (2): ACELAȘI rând (același Nr) văzut în două felii suprapuse se numără o dată', () => {
  const r = identificaRanduri([
    felieTab('z1_7', [R('36', { 'Lungime Km': '0,110', 'Dn ales (mm)': '110' }), R('37')], [T({ lungime_m: 110, diametru_mm: 110 }), T()]),
    felieTab('z2_7', [R('37'), R('38', { 'Lungime Km': '0,320' })], [T(), T({ lungime_m: 320 })]),
  ], { doc: 470 })
  assertEquals(r.sigure.map((t) => t._nr), ['36', '37', '38'])
  assertEquals(r.sigure.find((t) => t._nr === '37')._observatii, ['z1_7', 'z2_7'])
  assertEquals(r.total_sigur_m, 110 + 300 + 320)
})
Deno.test('identitate (3): contraexemplul Copilot — rândul 37 în felia A, rândul 40 în felia B, text identic => 2 (nu 1)', () => {
  const r = identificaRanduri([felieTab('z1_7', [R('37')], [T()]), felieTab('z2_7', [R('40')], [T()])], { doc: 470 })
  assertEquals(r.sigure.length, 2)
  assertEquals(r.total_sigur_m, 600)
})
Deno.test('identitate (4): conflict — același Nr cu L diferit în două felii => raportat, NU în total_sigur, fără alegere automată', () => {
  const r = identificaRanduri([
    felieTab('z1_7', [R('36', { 'Lungime Km': '0,110' }), R('37')], [T({ lungime_m: 110 }), T()]),
    felieTab('z2_7', [R('37', { 'Lungime Km': '0,330' })], [T({ lungime_m: 330 })]),
  ], { doc: 470 })
  assertEquals(r.sigure.map((t) => t._nr), ['36'])
  assertEquals(r.total_sigur_m, 110)
  assertEquals(r.conflicte.length, 1)
  const k = r.conflicte[0]
  assertEquals(k.nr, '37')
  assert(k.motiv.startsWith('lungime'), k.motiv)
  assertEquals(k.variante.map((v: any) => [v.lungime_m, v.zone]), [[300, ['z1_7']], [330, ['z2_7']]])
  assertEquals(r.total_de_verificat_m, 330, 'plafon de verificat = varianta maximă, în afara totalului sigur')
  // agregarea nu-l promovează în cantități
  const a = agregaTronsoane([...r.sigure, ...r.adnotari], { tabelNesigur: r.conflicte.flatMap((c: any) => c.variante.map((v: any) => ({ ...v, sursa: 'tabel' }))) })
  assertEquals(L(a.pentruCantitati), 110)
})
Deno.test('identitate (4b): conflict pe Dn (același Nr, L egal) => conflict; Q lipsă într-o lectură nu e conflict', () => {
  const r = identificaRanduri([
    felieTab('z1_7', [R('37')], [T()]),
    felieTab('z2_7', [R('37', { 'Dn ales (mm)': '63' })], [T({ diametru_mm: 63 })]),
    felieTab('z3_7', [R('38', { 'Debit mc/h': '' })], [T({ debit_mch: null })]),
    felieTab('z4_7', [R('38')], [T()]),
  ], { doc: 470 })
  assertEquals(r.conflicte.map((c: any) => [c.nr, c.motiv.split(' ')[0]]), [['37', 'diametru']])
  assertEquals(r.sigure.map((t) => [t._nr, t.debit_mch]), [['38', 20]])
})
Deno.test('identitate (5): rânduri fără identitate sigură => de_verificat cu totalul separat (nu dispar, nu se contopesc pe text)', () => {
  const C6 = ['Nr crt', 'Strada', 'Str. De la', 'Str. Pana la'], C7 = ['Strada', 'Str. De la', 'Str. Pana la', 'Dn ales (mm)', 'Debit mc/h', 'Lungime Km']
  const r7 = (strada: string) => ({ 'Strada': strada, 'Str. De la': 'Florenta Albu', 'Str. Pana la': 'CT', 'Dn ales (mm)': '40', 'Debit mc/h': '20', 'Lungime Km': '0,300' })
  const r = identificaRanduri([
    // a) tronson „din tabel” fără tabel transcris în felie
    { eticheta: 'z1_1', tabele: [], tronsoane: [T()] },
    // b) Nr în felia vecină, dar câmpul comun e CONTRAZIS (Strada diferită) => împerechere nesigură
    felieTab('z2_6', [{ 'Nr crt': '5', 'Strada': 'Liliacului', 'Str. De la': 'Florenta Albu', 'Str. Pana la': 'CT' }], [], C6),
    felieTab('z2_7', [r7('Crinului')], [T({ zona: 'Crinului' })], C7),
    // c) Nr ilizibil pe rând
    felieTab('z3_7', [R('?')], [T()]),
    // d) împerechere ambiguă: trei rânduri identice în felia cu Nr și trei în felia cu L => decalajele 0 și ±1 sunt toate valide
    felieTab('z4_6', [1, 2, 3].map((i) => ({ 'Nr crt': String(70 + i), 'Strada': 'Macului', 'Str. De la': 'Florenta Albu', 'Str. Pana la': 'CT' })), [], C6),
    felieTab('z4_7', [r7('Macului'), r7('Macului'), r7('Macului')], [T({ zona: 'Macului' }), T({ zona: 'Macului' }), T({ zona: 'Macului' })], C7),
  ], { doc: 470 })
  assertEquals(r.sigure.length, 0)
  assertEquals(r.faraIdentitate.length, 6, 'fiecare lectură rămâne, separat')
  assertEquals(r.total_de_verificat_m, 1800)
  assertEquals(r.total_sigur_m, 0)
  const m = r.faraIdentitate.map((t) => t._motiv)
  assert(m[0].includes('fără tabel transcris'), m[0])
  assert(m.some((x) => x.startsWith('Nr în felia vecină')), m.join(' | '))
  assert(m.some((x) => x.startsWith('Nr lipsă sau ilizibil')), m.join(' | '))
  // „există tabel” => o adnotare NU devine sursa cantităților când rândurile de tabel sunt doar „de verificat”
  const a = agregaTronsoane([{ sursa: 'adnotare', diametru_mm: 40, lungime_m: 999 }], { tabelNesigur: r.faraIdentitate })
  assertEquals(a.pentruCantitati.length, 0)
  assertEquals(a.adnotariNeconfirmate.length, 1)
})
Deno.test('identitate (5b): tronson cu valori diferite de rândul din tabel (aceeași felie) => de verificat', () => {
  const r = identificaRanduri([felieTab('z1_7', [R('37'), R('38', { 'Lungime Km': '0,320' })], [T(), T({ lungime_m: 330 })])], { doc: 1 })
  assertEquals(r.sigure.map((t) => t._nr), ['37'])
  assertEquals(r.faraIdentitate.map((t) => [t.lungime_m, t._motiv.split(' ')[0]]), [[330, 'valorile']])
})
Deno.test('identitate: tabel FĂRĂ Nr într-o singură bandă, văzut întreg în 2 felii vecine (cazul 130) => poziția e identitatea, o singură dată', () => {
  const C = ['Localitate', 'Tronson - Plecare', 'Tronson - Sosire', 'Lung. Trs. Km', 'Dn-ul de ales mm (ext)']
  const rd = (sos: string, l: string, dn: string) => ({ 'Localitate': 'Oltenita', 'Tronson - Plecare': 'A', 'Tronson - Sosire': sos, 'Lung. Trs. Km': l, 'Dn-ul de ales mm (ext)': dn })
  const tr = (sos: string, L: number, dn: number) => ({ de_la: 'A', la: sos, lungime_m: L, diametru_mm: dn, sursa: 'tabel' })
  // a doua lectură a transcris diferit capătul rândului 2 (ca la 130: „Limita UAT Spantov” vs „Limita Intravilan”) — L/Dn identice
  const A = felieTab('z1_4', [rd('B', '0,37', '250'), rd('C', '4,8', '250'), rd('D', '0,645', '160')], [tr('B', 370, 250), tr('C', 4800, 250), tr('D', 645, 160)], C)
  const B = felieTab('z1_5', [rd('B', '0,37', '250'), rd('X', '4,8', '250'), rd('D', '0,645', '160')], [tr('B', 370, 250), tr('X', 4800, 250), tr('D', 645, 160)], C)
  const r = identificaRanduri([A, B], { doc: 130 })
  assertEquals(r.sigure.length, 3, 'nu 4 (dedup-ul pe text număra de două ori rândul transcris diferit)')
  assertEquals(r.total_sigur_m, 5815)
  assert(r.sigure.every((t) => t._identitate_tip === 'pozitie'))
  assertEquals(r.perechi.map((p) => [p.prin, p.diferente_text]), [['valori L/Dn/Q', 1]])
  // același tabel fără Nr pe DOUĂ benzi (suprapunere verticală posibilă) => de verificat, nu poziție
  const r2 = identificaRanduri([A, felieTab('z2_4', [rd('D', '0,645', '160')], [tr('D', 645, 160)], C)], { doc: 130 })
  assertEquals([r2.sigure.length, r2.faraIdentitate.length], [0, 4])
  assert(r2.faraIdentitate[0]._motiv.includes('mai multe benzi'), r2.faraIdentitate[0]._motiv)
})
Deno.test('identitate: același Nr sub două tabele cu antete diferite pe aceeași pagină => de verificat (tabel neidentificat sigur)', () => {
  const r = identificaRanduri([felieTab('z1_7', [R('5')], [T()]), felieTab('z3_7', [{ 'Nr': '5', 'De la': 'Florenta Albu', 'La': 'CT', 'Dn': '40', 'L (km)': '0,300' }], [T()], ['Nr', 'De la', 'La', 'Dn', 'L (km)'])], { doc: 1 })
  assertEquals([r.sigure.length, r.faraIdentitate.length], [0, 2])
  assert(r.faraIdentitate[0]._motiv.includes('antete diferite'), r.faraIdentitate[0]._motiv)
})
Deno.test('identitate: adnotările NU primesc multiset — aceeași adnotare de 3 ori în aceeași felie rămâne una (R5 neschimbat)', () => {
  const adn = { de_la: 'x', la: 'y', lungime_m: 270, diametru_mm: 63, zona: 'Floroaica', sursa: 'adnotare' }
  const r = identificaRanduri([{ eticheta: 'z3_2', tronsoane: [adn, adn, adn] }, { eticheta: 'z4_2', tronsoane: [adn] }], { doc: 470 })
  assertEquals(r.adnotari.length, 1)
  assertEquals(r.sigure.length + r.faraIdentitate.length, 0)
  // fără tabel adnotările rămân sursa cantităților (ca înainte)
  assertEquals(L(agregaTronsoane(r.adnotari).pentruCantitati), 270)
})
Deno.test('nrRand: normalizare Nr (spații, punct final, zerouri) și valori care nu sunt numere de rând', () => {
  assertEquals(['37', ' 37. ', '037', '12a', 'x', '', '6\'', '1-2'].map(nrRand), ['37', '37', '37', '12a', null, null, null, null])
})

// ---- (6) fixture reală 470: z?_6 (Nr) + z?_7 (L) ----
Deno.test('identitate (6) fixture 470: 133 rânduri, toate cu identitate sigură prin Nr => total_sigur 48.905 m; Nr 57 Dn60 => regula nestandard', () => {
  const r = identificaRanduri(feliiDin470(), { doc: 470 })
  assertEquals(r.observatii_tabel, 37 + 52 + 52 + 11, '152 de lecturi de rânduri cu lungime (z?_7)')
  assertEquals(r.sigure.length, 133)
  assertEquals(r.prin, { nr: 133, pozitie: 0 })
  assertEquals(r.sigure.map((t) => Number(t._nr)).sort((a, b) => a - b), Array.from({ length: 133 }, (_, i) => i + 1))
  assertEquals([r.faraIdentitate.length, r.conflicte.length, r.total_de_verificat_m], [0, 0, 0])
  assertEquals(r.total_sigur_m, 48905)
  // împerecherile: câte una pe bandă, decalaj 0 (inclusiv „Str. Pana la” tăiat de margine în z1_6 și „...” în z4_6)
  assertEquals(r.perechi.map((p) => `${p.a}+${p.b}:${p.delta}`), ['z1_6+z1_7:0', 'z2_6+z2_7:0', 'z3_6+z3_7:0', 'z4_6+z4_7:0'])
  // suprapunerea verticală: Nr 32–37, 78–83, 123–129 văzute în două benzi => o dată
  assertEquals(r.sigure.find((t) => t._nr === '37')._observatii, ['z1_7', 'z2_7'])
  assertEquals(r.sigure.filter((t) => t._observatii.length === 2).length, 6 + 6 + 7)
  // Nr 37, 40, 41 (text identic) = 3 rânduri
  assertEquals(r.sigure.filter((t) => t.lungime_m === 300 && t.diametru_mm === 40 && /brancoveanu/i.test(t.zona)).map((t) => t._nr), ['37', '40', '41'])
  // Nr 57: Crinului → Rozelor, Dn60, 110 m — identitate sigură, dar Dn nestandard => scos din cantități (regula existentă)
  const n57 = r.sigure.find((t) => t._nr === '57')
  assertEquals([n57.de_la, n57.la, n57.diametru_mm, n57.lungime_m], ['Crinului', 'Rozelor', 60, 110])
  const a = agregaTronsoane([...r.sigure, ...r.adnotari])
  const DN = new Set([40, 63, 90, 110, 125, 200])                // ca DN_STANDARD din handler, pe Dn-urile planșei
  const pc = a.pentruCantitati.filter((t: any) => DN.has(t.diametru_mm))
  const peDn = pc.reduce((m: Record<string, number>, t: any) => { m[`Dn${t.diametru_mm}`] = (m[`Dn${t.diametru_mm}`] || 0) + t.lungime_m; return m }, {})
  assertEquals(peDn.Dn40, AZI_470.Dn40 + 600, 'Dn40 = 13.140 + 600 (Nr 40, 41)')
  for (const dn of ['Dn200', 'Dn125', 'Dn110', 'Dn90', 'Dn63']) assertEquals(peDn[dn], AZI_470[dn], dn)
  assertEquals([pc.length, L(pc)], [132, 48795])
  assertEquals(a.pentruCantitati.filter((t: any) => !DN.has(t.diametru_mm)).map((t: any) => [t._nr, t.diametru_mm, t.lungime_m]), [['57', 60, 110]])
  const rest = notaRestTransfer(r, a.pentruCantitati.filter((t: any) => !DN.has(t.diametru_mm)))
  assertEquals(rest, { peDnMat: {}, global: 'Dn nestandard Dn60: 110 m' })
})
Deno.test('identitate (6b) fixture 470 fără coloana Nr (z?_6 lipsă) => nimic sigur, totul de verificat (nu 48.195 pe text)', () => {
  const r = identificaRanduri(feliiDin470().filter((f) => f.eticheta.endsWith('_7')), { doc: 470 })
  assertEquals(r.sigure.length, 0)
  assertEquals(r.faraIdentitate.length, 152)
  assert(r.faraIdentitate.every((t) => t._motiv.includes('mai multe benzi')))
})

// ---- 26.09.2026 — runda 4 (verificator runda 3): teste adversariale devenite regresie. Fiecare pică pe a800d38. ----
// Principiul: niciodată pierdere sau umflare TĂCUTĂ; ce nu e sigur merge la „de verificat”, cu total separat și motiv.
const C6 = ['Nr crt', 'Strada', 'Str. De la', 'Str. Pana la'], C7 = ['Strada', 'Str. De la', 'Str. Pana la', 'Dn ales (mm)', 'Debit mc/h', 'Lungime Km']
type Rd = [string, string, number]                       // [Nr, Strada, L]
const r6 = (xs: Rd[]) => xs.map(([nr, st]) => ({ 'Nr crt': nr, 'Strada': st, 'Str. De la': 'N' + nr, 'Str. Pana la': 'N' + (Number(nr) + 1) }))
const r7 = (xs: Rd[]) => xs.map(([nr, st, L]) => ({ 'Strada': st, 'Str. De la': 'N' + nr, 'Str. Pana la': 'N' + (Number(nr) + 1), 'Dn ales (mm)': '63', 'Debit mc/h': '10', 'Lungime Km': String(L / 1000).replace('.', ',') }))
const t7 = (xs: Rd[]) => xs.map(([nr, st, L]) => ({ de_la: 'N' + nr, la: 'N' + (Number(nr) + 1), zona: st, lungime_m: L, diametru_mm: 63, debit_mch: 10, sursa: 'tabel' }))
const RR: Rd[] = [['1', 'Alba', 100], ['2', 'Bega', 200], ['3', 'Cerna', 300], ['4', 'Dunarea', 400], ['5', 'Enisala', 500]]

Deno.test('runda 4 BLOCANT (sintetic): rândul de margine văzut DOAR în felia cu lungimi (nu și în cea cu Nr) nu primește poziție — nu se numără de două ori', () => {
  // banda 1: z1_6 are Nr 1–3, z1_7 are rândurile 1–4 (rândul 4 tăiat de marginea de jos în z1_6); banda 2: Nr 3–5 cu lungimi
  const b1n = RR.slice(0, 3), b1l = RR.slice(0, 4), b2 = RR.slice(2, 5)
  const r = identificaRanduri([felieTab('z1_6', r6(b1n), [], C6), felieTab('z1_7', r7(b1l), t7(b1l), C7), felieTab('z2_6', r6(b2), [], C6), felieTab('z2_7', r7(b2), t7(b2), C7)], { doc: 1 })
  assertEquals(r.sigure.map((t) => t._nr).sort(), ['1', '2', '3', '4', '5'])
  assertEquals(r.total_sigur_m, 1500, 'a800d38: 6 rânduri / 1.900 m (rândul 4 o dată prin „poz z1_7#4” și o dată prin Nr 4)')
  assertEquals(r.prin.pozitie, 0)
  assertEquals(r.faraIdentitate.map((t) => [t._zona, t.lungime_m, t._motiv]), [['z1_7', 400, MOTIV_AFARA_NR]])
  assertEquals(r.total_de_verificat_m, 400)
  // numărul diferit de rânduri la δ=0 e semnalat pe pereche
  assertEquals(r.perechi.map((p) => [p.a, p.b, p.delta, p.randuri, p.neimperecheate]), [['z1_6', 'z1_7', 0, [3, 4], [0, 1]], ['z2_6', 'z2_7', 0, [3, 3], [0, 0]]])
})
Deno.test('runda 4 BLOCANT (fixture 470): z1_7 transcrie în plus Nr 38 la marginea de jos / z2_7 transcrie în plus Nr 31 la marginea de sus => tot 133 / 48.905 m, rândul în plus la de verificat', () => {
  // jos: rândul Nr 38 (tăiat în z1_6) apare în plus la baza lui z1_7; banda 2 îl are cu Nr
  const f = feliiDin470()
  const z17 = f.find((x) => x.eticheta === 'z1_7')!, z27 = f.find((x) => x.eticheta === 'z2_7')!, z26 = f.find((x) => x.eticheta === 'z2_6')!
  const k = z26.tabele[0].randuri.findIndex((x: any) => x['Nr crt'] === '38')
  ;(z17.tabele[0].randuri as any[]).push(structuredClone(z27.tabele[0].randuri[k])); (z17 as any).tronsoane.push(structuredClone((z27 as any).tronsoane[k]))
  const r = identificaRanduri(f, { doc: 470 })
  assertEquals([r.sigure.length, r.total_sigur_m, r.conflicte.length], [133, 48905, 0], 'a800d38: 134 / 49.225 m, 0 de verificat')
  assertEquals(r.faraIdentitate.map((t) => [t._zona, t.lungime_m, t._motiv]), [['z1_7', 320, MOTIV_AFARA_NR]])
  assertEquals(r.nrFaraLungime, [])
  // sus: rândul Nr 31 (din banda 1) apare în plus la vârful lui z2_7; z2_6 nu-l are => δ = 1
  const g = feliiDin470()
  const a17 = g.find((x) => x.eticheta === 'z1_7')!, a16 = g.find((x) => x.eticheta === 'z1_6')!, a27 = g.find((x) => x.eticheta === 'z2_7')!
  const k2 = a16.tabele[0].randuri.findIndex((x: any) => x['Nr crt'] === '31')
  ;(a27.tabele[0].randuri as any[]).unshift(structuredClone(a17.tabele[0].randuri[k2])); (a27 as any).tronsoane.unshift(structuredClone((a17 as any).tronsoane[k2]))
  const r2 = identificaRanduri(g, { doc: 470 })
  assertEquals([r2.sigure.length, r2.total_sigur_m, r2.conflicte.length], [133, 48905, 0], 'a800d38: 134 / 49.205 m, 0 de verificat')
  assertEquals(r2.faraIdentitate.length, 1)
  assertEquals([r2.faraIdentitate[0]._zona, r2.faraIdentitate[0].lungime_m, r2.faraIdentitate[0]._motiv], ['z2_7', (a17 as any).tronsoane[k2].lungime_m, MOTIV_AFARA_NR])
  assertEquals(r2.perechi.find((p) => p.a === 'z2_6')!.neimperecheate, [0, 1])
})
Deno.test('runda 4 (C): două tabele cu antete identice în ACEEAȘI felie, Nr 1–2 fiecare, valori egale => nu se contopesc (de verificat)', () => {
  const f = { eticheta: 'z2_3', tabele: [{ denumire: 'Sat A', coloane: COL, randuri: [R('1', { Strada: 'Liliacului' }), R('2', { Strada: 'Liliacului' })] },
    { denumire: 'Sat B', coloane: COL, randuri: [R('1', { Strada: 'Macului' }), R('2', { Strada: 'Macului' })] }],
    tronsoane: [T({ zona: 'Liliacului' }), T({ zona: 'Liliacului' }), T({ zona: 'Macului' }), T({ zona: 'Macului' })] }
  const r = identificaRanduri([f], { doc: 1 })
  assertEquals([r.sigure.length, r.total_sigur_m], [0, 0], 'a800d38: 2 rânduri / 600 m (2 rânduri reale pierdute tăcut)')
  assertEquals([r.faraIdentitate.length, r.total_de_verificat_m], [4, 1200])
  assert(r.faraIdentitate.every((t) => /^Nr [12] repetat — tabel neidentificat sigur \(de două ori în z2_3\)$/.test(t._motiv)), r.faraIdentitate[0]._motiv)
})
Deno.test('runda 4 (C2): numerotare reluată în ACELAȘI tabel (Sat A: 1, 2; Sat B: 1, 2) => de verificat, nu 2 rânduri', () => {
  const f = felieTab('z2_3', [R('1', { Strada: 'Liliacului' }), R('2', { Strada: 'Liliacului' }), R('1', { Strada: 'Macului' }), R('2', { Strada: 'Macului' })],
    [T({ zona: 'Liliacului' }), T({ zona: 'Liliacului' }), T({ zona: 'Macului' }), T({ zona: 'Macului' })])
  const r = identificaRanduri([f], { doc: 1 })
  assertEquals([r.sigure.length, r.faraIdentitate.length, r.total_de_verificat_m], [0, 4, 1200], 'a800d38: 2 sigure / 600 m')
  assert(r.faraIdentitate.every((t) => t._motiv.includes('repetat')), r.faraIdentitate[0]._motiv)
})
Deno.test('runda 4 (B): același tabel/Nr în benzi NEVECINE (z1_2 și z3_5 nu se pot suprapune) => de verificat', () => {
  const t = [R('1'), R('2'), R('3')]
  const r = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z3_5', t, [T(), T(), T()])], { doc: 1 })
  assertEquals([r.sigure.length, r.faraIdentitate.length, r.total_de_verificat_m], [0, 6, 1800], 'a800d38: 3 rânduri / 900 m')
  assert(r.faraIdentitate[0]._motiv.includes('în z1_2 și z3_5, felii care nu se suprapun'), r.faraIdentitate[0]._motiv)
  // control: benzi VECINE (z1_2 / z2_2) = suprapunerea verticală => același rând, o dată (ca la 470)
  const v = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z2_2', t, [T(), T(), T()])], { doc: 1 })
  assertEquals([v.sigure.length, v.total_sigur_m, v.faraIdentitate.length], [3, 900, 0])
})
Deno.test('runda 4 (D): două tabele FĂRĂ Nr cu antete identice în aceeași felie => indexul tabelului în cheia de poziție (4 rânduri, 950 m)', () => {
  const C = ['Localitate', 'Tronson - Plecare', 'Tronson - Sosire', 'Lung. Trs. Km', 'Dn-ul de ales mm (ext)']
  const rd = (loc: string, sos: string, l: string, dn: string) => ({ 'Localitate': loc, 'Tronson - Plecare': 'A', 'Tronson - Sosire': sos, 'Lung. Trs. Km': l, 'Dn-ul de ales mm (ext)': dn })
  const tr = (loc: string, sos: string, L: number, dn: number) => ({ de_la: 'A', la: sos, lungime_m: L, diametru_mm: dn, zona: loc, sursa: 'tabel' })
  const f = { eticheta: 'z1_2', tabele: [
    { denumire: 'Calcul Sat X', coloane: C, randuri: [rd('X', 'B', '0,3', '40'), rd('X', 'C', '0,2', '63')] },
    { denumire: 'Calcul Sat Y', coloane: C, randuri: [rd('Y', 'B', '0,3', '40'), rd('Y', 'D', '0,15', '63')] }],
    tronsoane: [tr('X', 'B', 300, 40), tr('X', 'C', 200, 63), tr('Y', 'B', 300, 40), tr('Y', 'D', 150, 63)] }
  const r = identificaRanduri([f], { doc: 1 })
  assertEquals([r.sigure.length, r.total_sigur_m, r.conflicte.length, r.faraIdentitate.length], [4, 950, 0, 0], 'a800d38: 1 sigur (300 m) + conflict 200/150, 300 m pierduți')
  assertEquals(r.sigure.map((t) => t._identitate.split('|').pop()), ['poz z1_2.t1#1', 'poz z1_2.t1#2', 'poz z1_2.t2#1', 'poz z1_2.t2#2'])
  // același tabel transcris de DOUĂ ori în aceeași felie (aceleași rânduri) => posibilă dublură => de verificat, nu 2×
  const d = { eticheta: 'z1_2', tabele: [f.tabele[0], structuredClone(f.tabele[0])], tronsoane: [f.tronsoane[0], f.tronsoane[1], f.tronsoane[0], f.tronsoane[1]] }
  const r2 = identificaRanduri([d], { doc: 1 })
  assertEquals([r2.sigure.length, r2.faraIdentitate.length, r2.total_de_verificat_m], [0, 4, 1000])
  assert(r2.faraIdentitate[0]._motiv.includes('posibilă transcriere dublă'), r2.faraIdentitate[0]._motiv)
})
Deno.test('runda 4 (text): același Nr în benzi vecine, dar Strada diferită (două tabele cu antete identice) => nu se contopește', () => {
  const r = identificaRanduri([
    felieTab('z1_3', [R('1', { Strada: 'Liliacului' }), R('2', { Strada: 'Liliacului' })], [T({ zona: 'Liliacului' }), T({ zona: 'Liliacului' })]),
    felieTab('z2_3', [R('1', { Strada: 'Macului' }), R('2', { Strada: 'Macului' })], [T({ zona: 'Macului' }), T({ zona: 'Macului' })]),
  ], { doc: 1 })
  assertEquals([r.sigure.length, r.faraIdentitate.length, r.total_de_verificat_m], [0, 4, 1200], 'a800d38: 2 rânduri / 600 m')
  assert(r.faraIdentitate[0]._motiv.startsWith('Nr 1 citit cu text diferit între felii (strada: „Liliacului” în z1_3 / „Macului” în z2_3)'), r.faraIdentitate[0]._motiv)
  // diferențele de transcriere (spații, cratimă, text tăiat marcat „...”) NU sunt text contrazis
  const s = identificaRanduri([
    felieTab('z1_3', [R('1', { Strada: 'C-tin Brancoveanu', 'Str. Pana la': 'Limita intra...' })], [T()]),
    felieTab('z2_3', [R('1', { Strada: 'Ctin  Brâncoveanu', 'Str. Pana la': 'Limita intravilan' })], [T()]),
  ], { doc: 1 })
  assertEquals([s.sigure.length, s.faraIdentitate.length], [1, 0])
})
Deno.test('runda 4: Nr ilizibil în felia cu Nr, rândul împerecheat din felia cu lungimi => de verificat (nu poziție)', () => {
  const b = RR.slice(0, 3)
  const n6 = r6(b); n6[1]['Nr crt'] = '?'
  const r = identificaRanduri([felieTab('z1_6', n6, [], C6), felieTab('z1_7', r7(b), t7(b), C7)], { doc: 1 })
  assertEquals(r.sigure.map((t) => t._nr), ['1', '3'])
  assertEquals(r.faraIdentitate.map((t) => [t.lungime_m, t._motiv]), [[200, 'Nr lipsă sau ilizibil pe rând (în felia vecină, împerecheată)']], 'a800d38: „poz z1_7#2” sigur')
})
Deno.test('runda 4: Nr fără nicio lungime (felia cu L a pierdut rândul de margine, nicio bandă nu-l vede) => semnalat, nu dispare tăcut', () => {
  const r = identificaRanduri([felieTab('z1_6', r6(RR.slice(0, 4)), [], C6), felieTab('z1_7', r7(RR.slice(0, 3)), t7(RR.slice(0, 3)), C7)], { doc: 1 })
  assertEquals([r.sigure.length, r.total_sigur_m, r.faraIdentitate.length], [3, 600, 0])
  assertEquals(r.nrFaraLungime, [{ nr: '4', zona: 'z1_6' }])
  assertEquals(r.perechi[0].neimperecheate, [1, 0])
})

// ---- 26.09.2026 — runda 5 (verificator runda 4): teste adversariale devenite regresie. Fiecare pică pe a9fe186. ----
// BLOCANT: fix-ul din runda 4 (`grupCuNr`) vedea doar fragmentele împerecheate REUȘIT. Când felia cu Nr din banda 1 lipsește sau
// are antete transcrise altfel, cele 37 de rânduri din z1_7 primeau „poz z1_7.t1#k”, iar Nr 32–37 (suprapunerea cu banda 2,
// 1.200 m) se numărau încă o dată prin Nr: 139 de rânduri / 50.105 m sigur, 0 de verificat, fără niciun semnal.
// Runda 6: geometria reală a tăietorului (api/plansa-felii.js): latura 1.600, suprapunere 12% => pas 1.408;
// left = min(c·pas, max(0, W − latura)), top la fel (c, r 0-based) — ultima coloană/bandă e FIXATĂ la marginea planșei.
const PAS = Math.floor(1600 * (1 - 0.12)), LAT = 1600
function geomTaiere(W: number, H: number, pagina = 1) {
  const zone_geom: Record<string, number[]> = {}
  for (let r = 0; r < Math.ceil(H / PAS); r++) for (let c = 0; c < Math.ceil(W / PAS); c++) {
    const left = Math.min(c * PAS, Math.max(0, W - LAT)), top = Math.min(r * PAS, Math.max(0, H - LAT))
    zone_geom[`${r + 1}_${c + 1}`] = [left, top, Math.min(LAT, W - left), Math.min(LAT, H - top), 0]
  }
  return { zone_geom, surse_geom: [{ pagina }] }
}
const PLANSA470 = { zone_geom: { '1_6': [7040, 0, 1600, 1600, 0], '1_7': [7762, 0, 1600, 1600, 0], '2_6': [7040, 1408, 1600, 1600, 0], '2_7': [7762, 1408, 1600, 1600, 0],
  '3_6': [7040, 2816, 1600, 1600, 0], '3_7': [7762, 2816, 1600, 1600, 0], '4_6': [7040, 4224, 1600, 1600, 0], '4_7': [7762, 4224, 1600, 1600, 0] }, surse_geom: [{ pagina: 1 }] }
const REDENUMIT: Record<string, string> = { 'Strada': 'Denumire strada', 'Str. De la': 'De la strada', 'Str. Pana la': 'Pana la strada' }
const V470: [string, (f: any[]) => void][] = [
  ['V1: z1_6 fără tabel transcris (fără eroare)', (f) => { f.find((x) => x.eticheta === 'z1_6').tabele = [] }],
  ['V2: z1_6 cu antete transcrise altfel (nicio coloană comună cu z1_7)', (f) => {
    const t = f.find((x) => x.eticheta === 'z1_6').tabele[0]
    t.coloane = ['Nr crt', 'Nod plecare', 'Nod sosire', 'Localitate', 'Denumire strada', 'De la strada', 'Pana la strada']
    t.randuri = RANDURI_Z6.z1_6.map(([nr, st, dl, pl]) => ({ 'Nr crt': nr, 'Denumire strada': st, 'De la strada': dl, 'Pana la strada': pl }))
  }],
  ['V3: z1_6 căzută (eroare)', (f) => { f.find((x) => x.eticheta === 'z1_6').eroare = 'timeout' }],
  ['V4: z1_7 cu antete transcrise altfel, z1_6 normal', (f) => {
    const t = f.find((x) => x.eticheta === 'z1_7').tabele[0]
    t.coloane = t.coloane.map((c: string) => REDENUMIT[c] || c)
    t.randuri = t.randuri.map((rw: any) => Object.fromEntries(Object.entries(rw).map(([k, v]) => [REDENUMIT[k] || k, v])))
  }],
]
for (const [nume, mut] of V470) {
  Deno.test(`runda 5 BLOCANT (fixture 470) ${nume} => z1_7 la „de verificat”, fără dublarea Nr 32–37 (a9fe186: 139 / 50.105 m sigur)`, () => {
    const f: any[] = feliiDin470(); mut(f)
    const r = identificaRanduri(f, { doc: 470, plansa: PLANSA470 })
    assertEquals([r.sigure.length, r.total_sigur_m, r.prin.pozitie], [102, 24235, 0], 'a9fe186: 139 / 50.105 m, 37 prin poziție')
    assertEquals([r.faraIdentitate.length, r.total_de_verificat_m, r.conflicte.length], [37, 25870, 0])
    assert(r.faraIdentitate.every((t) => t._zona === 'z1_7' && t._motiv === MOTIV_COLOANA_NR), r.faraIdentitate[0]._motiv)
    // benzile 2–4 rămân pe Nr (Nr 32–133), iar sigur + de verificat − suprapunerea Nr 32–37 (1.200 m) = totalul de referință
    assertEquals(r.sigure.map((t) => Number(t._nr)).sort((a, b) => a - b), Array.from({ length: 102 }, (_, i) => i + 32))
    assertEquals(+(r.total_sigur_m + r.total_de_verificat_m - 1200).toFixed(1), 48905)
  })
}
Deno.test('runda 5 BLOCANT (sintetic): tabel pe 3 coloane de felii (Nr în z?_5, L în z?_7), banda 1 fără mijloc => z1_7 de verificat; tabelul fără Nr din z1_2 rămâne pe poziție', () => {
  // banda 2: z2_5 (Nr) — z2_6 (Strada ↔ Pana la) — z2_7 (L) împerecheate în lanț; banda 1: z1_6 netranscrisă. Fragmentul cu Nr e la 2
  // coloane de z1_7 (proba verificatorului, |Δc| ≤ 1 față de fragmentul cu Nr, nu-l prinde); coloana 7 e însă a tabelului cu Nr (z2_7).
  const C5 = ['Nr crt', 'Sat', 'Strada'], C6x = ['Strada', 'Str. De la', 'Str. Pana la'], C7x = ['Str. Pana la', 'Dn ales (mm)', 'Debit mc/h', 'Lungime Km']
  const f5 = (xs: Rd[]) => xs.map(([nr, st]) => ({ 'Nr crt': nr, 'Sat': 'S', 'Strada': st }))
  const f6 = (xs: Rd[]) => xs.map(([nr, st]) => ({ 'Strada': st, 'Str. De la': 'N' + nr, 'Str. Pana la': 'N' + (Number(nr) + 1) }))
  const f7 = (xs: Rd[]) => xs.map(([nr, , L]) => ({ 'Str. Pana la': 'N' + (Number(nr) + 1), 'Dn ales (mm)': '63', 'Debit mc/h': '10', 'Lungime Km': String(L / 1000).replace('.', ',') }))
  const b1 = RR.slice(0, 4), b2 = RR.slice(2, 5)
  const CX = ['Localitate', 'Tronson - Plecare', 'Tronson - Sosire', 'Lung. Trs. Km', 'Dn-ul de ales mm (ext)']
  const control = { eticheta: 'z1_2', tabele: [{ denumire: 'Calcul X', coloane: CX, randuri: [
    { 'Localitate': 'X', 'Tronson - Plecare': 'A', 'Tronson - Sosire': 'B', 'Lung. Trs. Km': '0,3', 'Dn-ul de ales mm (ext)': '40' },
    { 'Localitate': 'X', 'Tronson - Plecare': 'B', 'Tronson - Sosire': 'C', 'Lung. Trs. Km': '0,2', 'Dn-ul de ales mm (ext)': '63' }] }],
    tronsoane: [{ de_la: 'A', la: 'B', lungime_m: 300, diametru_mm: 40, zona: 'X', sursa: 'tabel' }, { de_la: 'B', la: 'C', lungime_m: 200, diametru_mm: 63, zona: 'X', sursa: 'tabel' }] }
  const felii = [control, felieTab('z1_5', f5(b1), [], C5), felieTab('z1_7', f7(b1), t7(b1), C7x),
    felieTab('z2_5', f5(b2), [], C5), felieTab('z2_6', f6(b2), [], C6x), felieTab('z2_7', f7(b2), t7(b2), C7x)]
  // runda 6: cu geometria reală a tăietorului (W = 9.362, ca 470: coloana 7 nu atinge coloana 5)
  const r = identificaRanduri(felii, { doc: 1, plansa: geomTaiere(9362, 3200) })
  assertEquals(r.perechi.map((p) => `${p.a}+${p.b}:${p.delta}`), ['z2_5+z2_6:0', 'z2_6+z2_7:0'])
  assertEquals(r.sigure.map((t) => t._nr ?? t._identitate.split('|').pop()), ['3', '4', '5', 'poz z1_2.t1#1', 'poz z1_2.t1#2'])
  assertEquals(r.total_sigur_m, 1700, 'a9fe186 (și proba |Δc| ≤ 1): 2.700 m — Nr 3 și 4 numărate o dată prin poziție (z1_7) și o dată prin Nr (banda 2)')
  assertEquals(r.faraIdentitate.map((t) => [t._zona, t.lungime_m, t._motiv]), b1.map(([, , L]) => ['z1_7', L, MOTIV_COLOANA_NR]))
  assertEquals(r.total_de_verificat_m, 1000)
  // runda 6: FĂRĂ geometrie suprapunerea nu se poate exclude => poziția e interzisă pe toată pagina tabelului cu Nr (și z1_2)
  const f = identificaRanduri(felii, { doc: 1 })
  assertEquals(f.sigure.map((t) => t._nr), ['3', '4', '5'])
  assertEquals(f.faraIdentitate.map((t) => [t._zona, t.lungime_m, t._motiv]),
    [['z1_2', 300, MOTIV_COLOANA_NR_FARA_GEOM], ['z1_2', 200, MOTIV_COLOANA_NR_FARA_GEOM], ...b1.map(([, , L]) => ['z1_7', L, MOTIV_COLOANA_NR_FARA_GEOM])])
  assertEquals([f.total_sigur_m, f.total_de_verificat_m], [1200, 1500])
})

// ---- 26.09.2026 — runda 6 (verificator runda 5, MAJOR): vecinătatea feliilor pe GEOMETRIA REALĂ, nu pe indicii din etichetă ----
// Tăietorul fixează ultima coloană la marginea planșei; la W mod pas < 0,272·pas felia `_N+1` acoperă și `_N-1` (|Δc| = 2), deci
// regula pe etichetă ±1 (f1274a1) nu vedea suprapunerea: fâșia de lungimi din felia fixată primea „poz …” și se număra a doua oară.
// Fiecare test de mai jos pică pe f1274a1 (verificat pe copie), mai puțin controalele marcate.
// zone_geom al planșei 470, din BD (SELECT 26.09: analiza->'plansa'->'zone_geom', W 9.362 × H 6.623, 35 de zone)
const ZONE_GEOM_470: Record<string, number[]> = {
  '1_1': [0, 0, 1600, 1600, 0], '1_2': [1408, 0, 1600, 1600, 0], '1_3': [2816, 0, 1600, 1600, 0], '1_4': [4224, 0, 1600, 1600, 0], '1_5': [5632, 0, 1600, 1600, 0], '1_6': [7040, 0, 1600, 1600, 0], '1_7': [7762, 0, 1600, 1600, 0],
  '2_1': [0, 1408, 1600, 1600, 0], '2_2': [1408, 1408, 1600, 1600, 0], '2_3': [2816, 1408, 1600, 1600, 0], '2_4': [4224, 1408, 1600, 1600, 0], '2_5': [5632, 1408, 1600, 1600, 0], '2_6': [7040, 1408, 1600, 1600, 0], '2_7': [7762, 1408, 1600, 1600, 0],
  '3_1': [0, 2816, 1600, 1600, 0], '3_2': [1408, 2816, 1600, 1600, 0], '3_3': [2816, 2816, 1600, 1600, 0], '3_4': [4224, 2816, 1600, 1600, 0], '3_5': [5632, 2816, 1600, 1600, 0], '3_6': [7040, 2816, 1600, 1600, 0], '3_7': [7762, 2816, 1600, 1600, 0],
  '4_1': [0, 4224, 1600, 1600, 0], '4_2': [1408, 4224, 1600, 1600, 0], '4_3': [2816, 4224, 1600, 1600, 0], '4_4': [4224, 4224, 1600, 1600, 0], '4_5': [5632, 4224, 1600, 1600, 0], '4_6': [7040, 4224, 1600, 1600, 0], '4_7': [7762, 4224, 1600, 1600, 0],
  '5_1': [0, 5023, 1600, 1600, 0], '5_2': [1408, 5023, 1600, 1600, 0], '5_3': [2816, 5023, 1600, 1600, 0], '5_4': [4224, 5023, 1600, 1600, 0], '5_5': [5632, 5023, 1600, 1600, 0], '5_6': [7040, 5023, 1600, 1600, 0], '5_7': [7762, 5023, 1600, 1600, 0],
}
// tabel cu Nr în z1_4 (Nr, Strada, Dn, L); felia fixată z1_6 vede doar fâșia de lungimi (W = 7.340: z1_6 = [5.740, 7.340], z1_4 = [4.224, 5.824])
const RG: [string, string, string, number][] = [['1', 'Florilor', '63', 300], ['2', 'Salcamilor', '63', 250], ['3', 'Viilor', '40', 200], ['4', 'Plopilor', '40', 150], ['5', 'Morii', '63', 100]]
const CG = ['Nr crt', 'Strada', 'Dn (mm)', 'Lungime (m)']
const tabG = (et: string, xs: typeof RG) => felieTab(et, xs.map(([nr, st, dn, L]) => ({ 'Nr crt': nr, 'Strada': st, 'Dn (mm)': dn, 'Lungime (m)': String(L) })),
  xs.map(([, st, dn, L]) => ({ de_la: st, lungime_m: L, diametru_mm: Number(dn), sursa: 'tabel' })), CG)
const fasieG = (et: string, xs: typeof RG) => felieTab(et, xs.map(([, , , L]) => ({ 'Lungime (m)': String(L) })), xs.map(([, , , L]) => ({ lungime_m: L, sursa: 'tabel' })), ['Lungime (m)'])

Deno.test('runda 6: geomTaiere reproduce exact zone_geom din BD (470) și coloana fixată de la W = 7.340 / 7.140', () => {
  assertEquals(geomTaiere(9362, 6623).zone_geom, ZONE_GEOM_470)
  assertEquals([geomTaiere(7340, 1600).zone_geom['1_6'], geomTaiere(7140, 1600).zone_geom['1_5'], geomTaiere(7140, 1600).zone_geom['1_6']],
    [[5740, 0, 1600, 1600, 0], [5540, 0, 1600, 1600, 0], [5540, 0, 1600, 1600, 0]])
})
Deno.test('runda 6 MAJOR (GEOM-1): coloana fixată z1_6 acoperă z1_4 (|Δc| = 2), z1_5 fără tabel => rândul văzut în ambele se numără O DATĂ', () => {
  const b = RG.slice(0, 3)
  for (const [nume, z15] of [['z1_5 netranscrisă', felieTab('z1_5', [], [])], ['z1_5 căzută', { eticheta: 'z1_5', eroare: 'timeout' }]] as const) {
    const r = identificaRanduri([tabG('z1_4', b), z15, fasieG('z1_6', b)], { doc: 1, plansa: geomTaiere(7340, 1600) })
    assertEquals([r.sigure.length, r.total_sigur_m, r.prin.pozitie], [3, 750, 0], `${nume} — f1274a1: 6 rânduri / 1.500 m, 3 prin poziție`)
    assertEquals([r.faraIdentitate.length, r.conflicte.length, r.total_de_verificat_m], [0, 0, 0])
    assertEquals(r.perechi.map((p) => `${p.a}+${p.b}:${p.delta}`), ['z1_4+z1_6:0'], 'împerecherea urmează geometria, nu eticheta c+1')
    assertEquals(r.sigure.map((t) => [t._nr, t._observatii]), [['1', ['z1_4', 'z1_6']], ['2', ['z1_4', 'z1_6']], ['3', ['z1_4', 'z1_6']]])
  }
  // fără geometrie (tăiere veche): suprapunerea nu se poate exclude => fâșia la „de verificat”, niciodată 1.500 m sigur
  const f = identificaRanduri([tabG('z1_4', b), felieTab('z1_5', [], []), fasieG('z1_6', b)], { doc: 1 })
  assertEquals([f.total_sigur_m, f.total_de_verificat_m], [750, 750])
  assert(f.faraIdentitate.every((t) => t._zona === 'z1_6' && t._motiv === MOTIV_COLOANA_NR_FARA_GEOM), f.faraIdentitate[0]._motiv)
  // control (trece și pe f1274a1): z1_5 transcrie fâșia (Dn + L) => lanțul z1_4–z1_5–z1_6, tot 750 m
  const z15 = felieTab('z1_5', b.map(([, , dn, L]) => ({ 'Dn (mm)': dn, 'Lungime (m)': String(L) })), b.map(([, , dn, L]) => ({ lungime_m: L, diametru_mm: Number(dn), sursa: 'tabel' })), ['Dn (mm)', 'Lungime (m)'])
  const c = identificaRanduri([tabG('z1_4', b), z15, fasieG('z1_6', b)], { doc: 1, plansa: geomTaiere(7340, 1600) })
  assertEquals([c.total_sigur_m, c.total_de_verificat_m], [750, 0])
})
Deno.test('runda 6 MAJOR: fâșia din coloana fixată nu se poate împerechea (tabelul cu Nr e în banda vecină) => poziția interzisă pe geometrie, fără dublare', () => {
  // banda 1: z1_4 / z1_5 netranscrise, z1_6 (fixată) vede fâșia de lungimi a rândurilor 1–4; banda 2: z2_4 are Nr 3–5 (3, 4 = suprapunerea verticală)
  const r = identificaRanduri([felieTab('z1_4', [], []), felieTab('z1_5', [], []), fasieG('z1_6', RG.slice(0, 4)), tabG('z2_4', RG.slice(2, 5))],
    { doc: 1, plansa: geomTaiere(7340, 3000) })
  assertEquals(r.sigure.map((t) => t._nr), ['3', '4', '5'])
  assertEquals([r.total_sigur_m, r.prin.pozitie], [450, 0], 'f1274a1: 7 rânduri / 1.350 m, 4 prin poziție — Nr 3 și 4 o dată prin „poz z1_6” și o dată prin Nr')
  assertEquals(r.faraIdentitate.map((t) => [t._zona, t.lungime_m, t._motiv]), RG.slice(0, 4).map(([, , , L]) => ['z1_6', L, MOTIV_COLOANA_NR]))
  assertEquals(r.total_de_verificat_m, 900)
  // control (trece și pe f1274a1): fâșia într-o coloană care NU atinge tabelul cu Nr (z1_1 = [0, 1.600]) rămâne pe poziție
  const c = identificaRanduri([fasieG('z1_1', RG.slice(0, 2)), tabG('z2_4', RG.slice(2, 5))], { doc: 1, plansa: geomTaiere(7340, 3000) })
  assertEquals([c.sigure.length, c.prin.pozitie, c.faraIdentitate.length], [5, 2, 0])
})
Deno.test('runda 6 MAJOR: „Nr repetat” pe geometrie — banda fixată z3_2 atinge z1_2 (|Δr| = 2) => același rând; felii „vecine” în etichetă dar despărțite => de verificat', () => {
  // H = 3.000: benzile 2 și 3 sunt fixate la top 1.400, deci z3_2 = [1.400, 3.000] atinge z1_2 = [0, 1.600]; tabelul (Nr 1–3) stă în fâșia comună
  const t = [R('1'), R('2'), R('3')]
  const g = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z3_2', t, [T(), T(), T()])], { doc: 1, plansa: geomTaiere(4000, 3000) })
  assertEquals([g.sigure.length, g.total_sigur_m, g.faraIdentitate.length], [3, 900, 0], 'f1274a1: 0 sigure, 1.800 m de verificat („felii care nu se suprapun”)')
  assertEquals(g.sigure[0]._observatii, ['z1_2', 'z3_2'])
  // fără geometrie: eticheta |Δr| = 2 => de verificat (conservator, nu umflare)
  const e = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z3_2', t, [T(), T(), T()])], { doc: 1 })
  assertEquals([e.sigure.length, e.total_de_verificat_m], [0, 1800])
  // z1_2 / z1_3 vecine în etichetă, dar geometria le desparte (500 px între ele) => nu se împerechează, același Nr => de verificat
  const dep = { zone_geom: { '1_2': [0, 0, 1000, 1000, 0], '1_3': [1500, 0, 1000, 1000, 0] }, surse_geom: [{ pagina: 1 }] }
  const d = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z1_3', t, [T(), T(), T()])], { doc: 1, plansa: dep })
  assertEquals([d.sigure.length, d.faraIdentitate.length, d.total_de_verificat_m, d.perechi.length], [0, 6, 1800, 0], 'f1274a1: 3 / 900 m sigur (eticheta c, c+1)')
  assert(d.faraIdentitate[0]._motiv.includes('în z1_2 și z1_3, felii care nu se suprapun'), d.faraIdentitate[0]._motiv)
  // control (trece și pe f1274a1): aceleași felii, geometria standard (se suprapun 192 px) => 3 / 900 m
  const s = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z1_3', t, [T(), T(), T()])], { doc: 1, plansa: geomTaiere(4000, 3000) })
  assertEquals([s.sigure.length, s.total_sigur_m], [3, 900])
  // „se ating” cu toleranță mică (TOL_GEOM_PX): 1 px între felii = vecine (control, trece și pe f1274a1)
  const at = { zone_geom: { '1_2': [0, 0, 1000, 1000, 0], '1_3': [1001, 0, 1000, 1000, 0] }, surse_geom: [{ pagina: 1 }] }
  const a = identificaRanduri([felieTab('z1_2', t, [T(), T(), T()]), felieTab('z1_3', t, [T(), T(), T()])], { doc: 1, plansa: at })
  assertEquals([a.sigure.length, a.total_sigur_m, a.faraIdentitate.length], [3, 900, 0])
})
Deno.test('runda 6: fixture 470 cu zone_geom REAL din BD — neschimbat: 133 rânduri prin Nr, 48.905 m sigur, 0 de verificat, aceleași 4 perechi (control, trece și pe f1274a1)', () => {
  const r = identificaRanduri(feliiDin470(), { doc: 470, plansa: { zone_geom: ZONE_GEOM_470, surse_geom: [{ pagina: 1, latime: 9362, inaltime: 6623, dpi: 200, latime_pt: 3370, inaltime_pt: 2384 }] } })
  assertEquals([r.sigure.length, r.total_sigur_m, r.prin.nr, r.prin.pozitie], [133, 48905, 133, 0])
  assertEquals([r.faraIdentitate.length, r.conflicte.length, r.total_de_verificat_m, r.nrFaraLungime.length], [0, 0, 0, 0])
  assertEquals(r.perechi.map((p) => `${p.a}+${p.b}:${p.delta}`), ['z1_6+z1_7:0', 'z2_6+z2_7:0', 'z3_6+z3_7:0', 'z4_6+z4_7:0'])
  assertEquals(r.sigure.filter((t) => t._observatii.length === 2).length, 19)
})
