// deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/agregare_test.ts
// R5: adnotările pe diametre absente din tabel NU intră în total; posibila_dublura = avertisment, fără deduplicare.
// + deduplicarea tronsoanelor pe MULTISET (maximul aparițiilor pe felie) — fixture din planșa 470 (fixture_470.ts).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { agregaTronsoane, MOTIV_DN_ABSENT, tronsoaneUnice } from './handler.ts'
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

// ---- 25.09.2026: deduplicare pe MULTISET (bug planșa 470, felia z2_7) ----

const rand = (o: any = {}) => ({ de_la: 'Florenta Albu', la: 'CT', lungime_m: 300, diametru_mm: 40, debit_mch: 20, zona: 'C-tin Brancoveanu', sursa: 'tabel', ...o })
const peDn = (l: any[]) => l.reduce((m: Record<string, number>, t: any) => { if (t.diametru_mm) m[`Dn${t.diametru_mm}`] = (m[`Dn${t.diametru_mm}`] || 0) + t.lungime_m; return m }, {})

Deno.test('multiset: aceeași cheie în două felii care se suprapun -> numărată o dată', () => {
  const u = tronsoaneUnice([{ eticheta: 'z1_7', tronsoane: [rand()] }, { eticheta: 'z2_7', tronsoane: [rand()] }])
  assertEquals(u.length, 1)
})
Deno.test('multiset: 3 rânduri identice în ACEEAȘI felie + 1 în felia vecină -> 3 (maximul pe felie), nu 1 și nu 4', () => {
  const u = tronsoaneUnice([{ eticheta: 'z1_7', tronsoane: [rand()] }, { eticheta: 'z2_7', tronsoane: [rand(), rand({ lungime_m: 320 }), rand(), rand()] }])
  assertEquals(u.filter((t) => t.lungime_m === 300).length, 3)
  assertEquals(u.filter((t) => t.lungime_m === 320).length, 1)
  assertEquals(total(u), 1220)
})
Deno.test('multiset: text normalizat (diacritice/spații/majuscule) și „4.800” = aceeași cheie; lungime lipsă/0 sărită', () => {
  const u = tronsoaneUnice([
    { eticheta: 'z1_1', tronsoane: [rand({ zona: 'C-tin Brâncoveanu', lungime_m: '4.800' }), rand({ lungime_m: null }), rand({ lungime_m: 0 })] },
    { eticheta: 'z1_2', tronsoane: [rand({ zona: 'c-tin  BRANCOVEANU', lungime_m: 4800 })] },
  ])
  assertEquals(u.map((t) => t.lungime_m), [4800])
})
Deno.test('multiset + R5: adnotarea pe Dn absent rămâne în afara totalului; posibila_dublura se păstrează (±1%)', () => {
  const u = tronsoaneUnice([{ eticheta: 'z1_1', tronsoane: [rand(), rand(), { sursa: 'adnotare', diametru_mm: 250, lungime_m: 301, _zona: 'z1_1' }] }])
  const r = agregaTronsoane(u)
  assertEquals(total(r.pentruCantitati), 600, 'cele 2 rânduri de tabel identice rămân 2; adnotarea Dn250 nu intră')
  assertEquals(r.adnotariDiametruAbsent.map((t: any) => t.motiv), [MOTIV_DN_ABSENT])
  assertEquals(r.avertismenteDublura.length, 1)
  assertEquals(r.avertismenteDublura[0].tip, 'posibila_dublura')
})
Deno.test('fixture 470 (z1_7..z4_7): Dn40 = azi + 600 m (Nr 37, 40, 41 din z2_7); restul Dn-urilor neschimbate', () => {
  const u = tronsoaneUnice(feliiDin470())
  const r = agregaTronsoane(u)
  const DN = new Set([40, 63, 90, 110, 125, 200])                // Dn60 (nestandard) nu intră în cantități — ca în handler
  const pc = r.pentruCantitati.filter((t: any) => DN.has(t.diametru_mm))
  const nou = peDn(pc)
  assertEquals(nou.Dn40, AZI_470.Dn40 + 600)
  for (const dn of ['Dn200', 'Dn125', 'Dn110', 'Dn90', 'Dn63']) assertEquals(nou[dn], AZI_470[dn], dn)
  assertEquals(total(pc), 48195 + 600)
  assertEquals(pc.length, 130 + 2)
  assertEquals(pc.filter((t: any) => t.diametru_mm === 40).length, 54 + 2)
  // rândul triplat e acum de 3 ori; suprapunerea z1_7/z2_7 și z2_7/z3_7 nu dublează nimic
  assertEquals(u.filter((t: any) => t.lungime_m === 300 && t.diametru_mm === 40 && /brancoveanu/i.test(t.zona)).length, 3)
})
