// deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/agregare_test.ts
// R5: adnotările pe diametre absente din tabel NU intră în total; posibila_dublura = avertisment, fără deduplicare.
// + IDENTITATEA RÂNDULUI de tabel (doc, pagină, tabel, Nr) în locul dedup-ului pe text/multiset (Copilot, runda 3) —
//   cazuri sintetice + fixture reală din planșa 470 (fixture_470.ts, z?_6 cu Nr + z?_7 cu lungimi).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { agregaTronsoane, identificaRanduri, MOTIV_DN_ABSENT, notaRestTransfer, nrRand } from './handler.ts'
import { AZI_470, feliiDin470 } from './fixture_470.ts'

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
  assertEquals(rest, { peDn: {}, global: 'Dn nestandard Dn60: 110 m' })
})
Deno.test('identitate (6b) fixture 470 fără coloana Nr (z?_6 lipsă) => nimic sigur, totul de verificat (nu 48.195 pe text)', () => {
  const r = identificaRanduri(feliiDin470().filter((f) => f.eticheta.endsWith('_7')), { doc: 470 })
  assertEquals(r.sigure.length, 0)
  assertEquals(r.faraIdentitate.length, 152)
  assert(r.faraIdentitate.every((t) => t._motiv.includes('mai multe benzi')))
})
