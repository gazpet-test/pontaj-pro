// deno test --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/agregare_test.ts
// R5: adnotările pe diametre absente din tabel NU intră în total; posibila_dublura = avertisment, fără deduplicare.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { agregaTronsoane, MOTIV_DN_ABSENT } from './handler.ts'

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
