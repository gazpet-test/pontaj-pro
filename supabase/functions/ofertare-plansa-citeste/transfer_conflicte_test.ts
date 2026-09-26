// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-plansa-citeste/transfer_conflicte_test.ts
// R5 sarcina 2 (Copilot, închiderea R4/R5, condiția 2a): conflictele transferului persistate pe document — „nimic scris ≠ nicio
// problemă”. Funcții pure: conflicteTransfer (handler.ts) + inregistrareTransfer / deschis (transfer_conflicte.ts).
// Fixture-le „reale” = citire_ai.sumar al documentelor 470 / 471 / 130 / 1035 (SELECT 26.09.2026, doar câmpurile folosite).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { conflicteTransfer, inregistrareDinTransfer } from './handler.ts'
import { deschis, inregistrareTransfer, MAX_ISTORIC } from './transfer_conflicte.ts'

// doc 470 (lic. 95), sumar din producție (26.09.2026): Dn60 nestandard 110 m + 3 adnotări pe Dn absent (1.770 m)
const SUMAR_470 = { erori: 0, validat: false, cantitati: { ambigue: [], total_m: 48195, adaugate: 6, actualizate: 0, pe_diametre: { Dn40: 13140, Dn63: 9670, Dn90: 4545, Dn110: 780, Dn125: 2275, Dn200: 17785 } },
  zone_cazute: [], nestandard_m: 110, diametre_nestandard: [60],
  adnotari_diametru_absent: [{ la: '22', zona: 'z3_1', de_la: 'Nod 11', motiv: 'diametru absent din tabel — de verificat', lungime_m: 480, diametru_mm: 48 },
    { zona: 'z3_1', de_la: 'Nod 69', motiv: 'diametru absent din tabel — de verificat', lungime_m: 880, diametru_mm: 48 },
    { zona: 'z4_2', motiv: 'diametru absent din tabel — de verificat', lungime_m: 410, diametru_mm: 56 }] }
const SUMAR_471 = { erori: 0, validat: false, cantitati: { ambigue: [], adaugate: 0, actualizate: 0, pe_diametre: {} }, zone_cazute: [], adnotari_diametru_absent: [] }
const SUMAR_130 = { erori: 0, cantitati: { ambigue: [], total_m: 41920, adaugate: 0, actualizate: 4, pe_diametre: { Dn160: 5245, Dn180: 2210, Dn250: 34465 } } }

Deno.test('sarcina 2: documentele reale — 470 are 2 conflicte nerezolvate (Dn60 nestandard, adnotări pe Dn absent); 471 / 130 niciunul', () => {
  const c470 = conflicteTransfer(SUMAR_470.cantitati, SUMAR_470)
  assertEquals(c470.map((x) => x.tip), ['dn_nestandard', 'adnotari_dn_absent'])
  assertEquals(c470[0].text, 'Dn nestandard Dn60: 110 m — NU intră în cantități (de verificat Dn-ul pe planșă)')
  assertEquals(c470[1].text, '3 adnotări pe Dn absent din tabel (1.770 m; Dn48, Dn56) — observații, NU intră în cantități')
  assertEquals(conflicteTransfer(SUMAR_471.cantitati, SUMAR_471), [])
  assertEquals(conflicteTransfer(SUMAR_130.cantitati, SUMAR_130), [])
})

Deno.test('sarcina 2: conflicteTransfer — ambigue, „doar de verificat” (fără dublura „ambiguu”), TOTAL multiplu, identitate, Nr lipsă (>6), fără lungime, fără Dn', () => {
  const c = {
    adaugate: 0, actualizate: 0,
    ambigue: [{ dn: 110, material: 'PE', metri: 500, de_verificat: '1 rând Dn110 PE fără identitate sigură (90 m)', pozitii: [{ id: 31, denumire: 'Țeavă PE100 Dn110 — sat A' }, { id: 32, denumire: 'Țeavă PE100 Dn110 — sat B' }] },
      { dn: 110, material: null, metri: 590, motiv: 'mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă', grupuri: [{ dn: 110, material: 'PE', metri: 500 }, { dn: 110, material: 'OL', metri: 90 }], pozitii: [{ id: 5, denumire: 'Dn110' }] }],
    doar_de_verificat: [{ dn: 90, material: 'PE', pozitie_id: null, actiune: 'fara_pozitie' }, { dn: 63, material: null, pozitie_id: null, actiune: 'ambiguu' }, { dn: null, material: null, pozitie_id: null, actiune: 'fara_dn' }],
    totaluri_multiple: [{ id: 7, denumire: 'TOTAL Conducta' }, { id: 8, denumire: 'TOTAL rețea' }],
  }
  const s = { randuri_fara_identitate_n: 2, conflicte: [{ nr: '2', variante: [] }], total_de_verificat_m: 580,
    nr_lipsa: Array.from({ length: 8 }, (_, i) => ({ pagina: 1, interval: [1, 60], lipsesc: String(10 + i), n: 1 })),
    nr_fara_lungime: [{ nr: '50', zona: 'z2_6', dn: 40 }], nr_fara_lungime_n: 1, tronsoane_fara_dn_n: 1, tronsoane_fara_dn_m: 300 }
  const x = conflicteTransfer(c, s)
  assertEquals(x.map((y) => y.tip), ['ambiguu', 'ambiguu', 'de_verificat', 'de_verificat', 'total_ambiguu', 'identitate', 'nr_lipsa', 'nr_lipsa', 'nr_lipsa', 'nr_lipsa', 'nr_lipsa', 'nr_lipsa', 'nr_lipsa', 'nr_fara_lungime', 'fara_dn'])
  assertEquals(x[0].text, 'Dn110 PE 500 m NESCRIS (pozițiile #31, #32): ambiguu între mai multe poziții — decide omul; de verificat: 1 rând Dn110 PE fără identitate sigură (90 m)')
  assertEquals(x[1].text, 'Dn110 PE 500 m + Dn110 OL 90 m NESCRIS (pozițiile #5): mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă')
  // Dn-urile doar „de verificat” n-au metri: marcate fara_cantitate, nu „0 m”
  assertEquals([x[2].fara_cantitate, x[2].metri, x[2].text], [true, null, 'Dn90 PE: doar rânduri de verificat, nicio cifră sigură — nicio poziție în cantități'])
  assertEquals(x[4].text, '2 rânduri TOTAL în cantități (#7, #8): totalul planșei a mers doar pe #7; celelalte au rămas neatinse — care e totalul rețelei decide omul')
  assertEquals(x[12].text, 'încă 2 tabele cu secvența Nr incompletă (metri necunoscuți)')
  assert(x.filter((y) => y.tip === 'nr_lipsa' || y.tip === 'nr_fara_lungime').every((y) => y.fara_cantitate === true && y.metri == null))
  assertEquals(conflicteTransfer({ eroare: 'transfer: răspuns neașteptat' }, {}).map((y) => y.tip), ['transfer_eroare'])
  assertEquals(conflicteTransfer({ amanat: '1 felie n-a putut fi citită' }, {}).map((y) => y.tip), ['transfer_amanat'])
  assertEquals(conflicteTransfer(null, null), [])
})

const rec = (prev: any, c: any, s: any, id: string) => inregistrareDinTransfer(prev, c, s, { id, rulare: 'R-' + id, citire: 'C', plansa: 'Planșa 1', la: '2026-09-26T10:00:00.000Z' })
Deno.test('sarcina 2: închiderea — recitire FĂRĂ conflicte închide explicit (urma rămâne în `anterior` + `istoric`); confirmarea veche nu acoperă o recitire nouă CU conflicte', () => {
  const a = rec(null, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 110, material: 'PE', metri: 500, pozitii: [{ id: 31 }, { id: 32 }] }] }, {}, 'A')
  assertEquals([a.stare, a.n, deschis(a), a.confirmat_la], ['conflicte', 1, true, null])
  // recitire curată => închis prin recitire, conflictele vechi recuperabile
  const b = rec(a, { adaugate: 0, actualizate: 1, ambigue: [] }, {}, 'B')
  assertEquals([b.stare, b.n, deschis(b), b.inchis_prin, b.inchide], ['fara_conflicte', 0, false, 'recitire_fara_conflicte', 'A'])
  assertEquals(b.anterior.conflicte, a.conflicte)
  assertEquals(b.istoric.map((h: any) => [h.id, h.stare, h.n]), [['A', 'conflicte', 1]])
  // confirmare umană (scrisă în BD de ofertare_transfer_conflicte_confirma) => închis; o recitire nouă CU conflicte e o înregistrare nouă, deschisă
  const aConf = { ...a, confirmat_de: 'u1', confirmat_la: '2026-09-26T11:00:00Z', confirmare_nota: 'verificat pe planșă, pozițiile sunt pe loturi diferite' }
  assertFalse(deschis(aConf))
  const c = rec(aConf, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 110, material: 'PE', metri: 500 }] }, {}, 'C')
  assertEquals([c.stare, deschis(c), c.confirmat_la], ['conflicte', true, null])
  assertEquals([c.istoric[0].confirmat_de, c.istoric[0].confirmare_nota], ['u1', aConf.confirmare_nota])
  // recitire curată după o confirmare: nu „închide” nimic (nu era deschis), dar confirmarea rămâne în istoric
  const d = rec(aConf, { adaugate: 0, actualizate: 0, ambigue: [] }, {}, 'D')
  assertEquals([d.stare, 'inchis_prin' in d, d.istoric[0].confirmat_la], ['fara_conflicte', false, '2026-09-26T11:00:00Z'])
})

Deno.test('sarcina 2: transferul căzut / amânat NU șterge conflictele anterioare — e el însuși deschis („neefectuat”), cele vechi în `anterior`', () => {
  const a = rec(null, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 63, material: null, metri: 200 }] }, {}, 'A')
  const e = rec(a, { eroare: 'transfer: două scrieri pe rândul TOTAL (id 4)' }, {}, 'E')
  assertEquals([e.stare, deschis(e), e.conflicte[0].tip], ['neefectuat', true, 'transfer_eroare'])
  assertEquals(e.anterior.conflicte[0].tip, 'ambiguu')
  const am = rec(e, { amanat: '2 felii n-au putut fi citite' }, { nr_lipsa: [{ pagina: 1, interval: [1, 9], lipsesc: '4', n: 1 }] }, 'M')
  assertEquals([am.stare, am.n, am.conflicte.map((x: any) => x.tip)], ['neefectuat', 2, ['transfer_amanat', 'nr_lipsa']])
  // lanțul nu crește: `anterior` fără propriul `anterior`; istoricul plafonat
  assertFalse('anterior' in am.anterior)
  let r: any = null
  for (let i = 0; i < 15; i++) r = rec(r, { adaugate: 0, actualizate: 0, ambigue: [] }, {}, `X${i}`)
  assertEquals(r.istoric.length, MAX_ISTORIC)
  assertEquals(r.istoric[0].id, 'X13')
})

Deno.test('sarcina 2: plafonul listei — 45 de conflicte => n = 45, lista 40, „trunchiat” (nu se pierde numărul)', () => {
  const r = inregistrareTransfer(null, { conflicte: Array.from({ length: 45 }, (_, i) => ({ tip: 'ambiguu', text: String(i) })), id: 'Z', la: 'x', cod: 'c' })
  assertEquals([r.n, r.conflicte.length, r.trunchiat, deschis(r)], [45, 40, true, true])
})
