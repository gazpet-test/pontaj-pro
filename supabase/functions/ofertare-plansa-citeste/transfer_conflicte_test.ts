// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-plansa-citeste/transfer_conflicte_test.ts
// R5 sarcina 2 (Copilot, închiderea R4/R5, condiția 2a): conflictele transferului persistate pe document — „nimic scris ≠ nicio
// problemă”. Funcții pure: conflicteTransfer (handler.ts) + inregistrareTransfer / deschis (transfer_conflicte.ts).
// Fixture-le „reale” = citire_ai.sumar al documentelor 470 / 471 / 130 / 1035 (SELECT 26.09.2026, doar câmpurile folosite).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1'
import { conflicteTransfer, inregistrareDinTransfer } from './handler.ts'
import { acoperit, confirmareValida, deschis, EVALUARE_PARTIALA, formaCorupta, inregistrareLegacy, inregistrarePrecedenta, inregistrareTransfer, MAX_ISTORIC, restantePeTip, stareCitireNeterminata, stareLegacy } from './transfer_conflicte.ts'

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
  // reparația rundei 1: ancorele (ce trebuie să acopere o recitire ca să închidă conflictul)
  assertEquals([x[0].ancore, x[2].ancore, x[4].ancore, x[13].ancore], [{ dn: [110], pozitii: true }, { dn: [90], pozitii: true }, { pozitii: true }, { zone: ['z2_6'] }])
  assertEquals(x[0].text, 'Dn110 PE 500 m NESCRIS (pozițiile #31, #32): ambiguu între mai multe poziții — decide omul; de verificat: 1 rând Dn110 PE fără identitate sigură (90 m)')
  assertEquals(x[1].text, 'Dn110 PE 500 m + Dn110 OL 90 m NESCRIS (pozițiile #5): mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă')
  // Dn-urile doar „de verificat” n-au metri: marcate fara_cantitate, nu „0 m”
  assertEquals([x[2].fara_cantitate, x[2].metri, x[2].text], [true, null, 'Dn90 PE: doar rânduri de verificat, nicio cifră sigură — nicio poziție în cantități'])
  // ADDENDUM 2 Copilot (e): nicio valoare nouă aleasă automat pe vreun TOTAL
  assertEquals(x[4].text, '2 rânduri TOTAL în cantități (#7, #8): totalul planșei NU s-a scris pe niciunul — valorile și aprobările lor rămân neatinse; care e totalul rețelei decide Răzvan (A/B/C), apoi recitire sau confirmare')
  assertEquals(x[12].text, 'încă 2 tabele cu secvența Nr incompletă (metri necunoscuți)')
  assert(x.filter((y) => y.tip === 'nr_lipsa' || y.tip === 'nr_fara_lungime').every((y) => y.fara_cantitate === true && y.metri == null))
  assertEquals(conflicteTransfer({ eroare: 'transfer: răspuns neașteptat' }, {}).map((y) => y.tip), ['transfer_eroare'])
  assertEquals(conflicteTransfer({ amanat: '1 felie n-a putut fi citită' }, {}).map((y) => y.tip), ['transfer_amanat'])
  assertEquals(conflicteTransfer(null, null), [])
})

// acoperirea unei recitiri complete a zonei z1_1 cu Dn-urile date (cantitățile evaluate)
const acop = (dn: number[], o: any = {}) => ({ complet: true, zone: ['z1_1'], dn, cantitati_evaluate: true, ...o })
const rec = (prev: any, c: any, s: any, id: string, acoperire: any = null) => inregistrareDinTransfer(prev, c, s, { id, rulare: 'R-' + id, citire: 'C', plansa: 'Planșa 1', la: '2026-09-26T10:00:00.000Z', acoperire })
const U = '00000000-0000-4000-8000-000000000121'
const conf = (r: any, o: any = {}) => ({ ...r, confirmat_de: U, confirmat_la: '2026-09-26T11:00:00Z', confirmare_nota: 'verificat pe planșă, pozițiile sunt pe loturi diferite', confirmare_tip: 'rezolvat', confirmat_token: r.id, ...o })
Deno.test('sarcina 2 + reparația rundei 1: închiderea — recitirea FĂRĂ conflicte închide DOAR ce a ACOPERIT (urma în `anterior` + `istoric`); confirmarea veche nu acoperă o recitire nouă CU conflicte', () => {
  const a = rec(null, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 110, material: 'PE', metri: 500, pozitii: [{ id: 31 }, { id: 32 }] }] }, {}, 'A', acop([110]))
  assertEquals([a.stare, a.n, deschis(a), a.confirmat_la], ['conflicte', 1, true, null])
  // recitire curată care a VĂZUT Dn110 și a evaluat pozițiile => închis prin recitire, conflictele vechi recuperabile
  const b = rec(a, { adaugate: 0, actualizate: 1, ambigue: [], evaluat: true }, {}, 'B', acop([110, 160]))
  assertEquals([b.stare, b.n, deschis(b), b.inchis_prin, b.inchide, b.inchise_la_recitire], ['fara_conflicte', 0, false, 'recitire_fara_conflicte', 'A', 1])
  assertEquals(b.anterior.conflicte, a.conflicte)
  assertEquals(b.istoric.map((h: any) => [h.id, h.stare, h.n]), [['A', 'conflicte', 1]])
  // confirmare umană VALIDĂ (scrisă în BD de ofertare_transfer_conflicte_confirma) => închis; o recitire nouă CU conflicte e o înregistrare nouă, deschisă
  const aConf = conf(a)
  assertFalse(deschis(aConf))
  const c = rec(aConf, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 110, material: 'PE', metri: 500 }] }, {}, 'C', acop([110]))
  assertEquals([c.stare, deschis(c), c.confirmat_la], ['conflicte', true, null])
  assertEquals([c.istoric[0].confirmat_de, c.istoric[0].confirmare_nota, c.istoric[0].confirmare_tip], [U, aConf.confirmare_nota, 'rezolvat'])
  // recitire curată după o confirmare: nu „închide” nimic (nu era deschis) și nu poartă nimic, dar confirmarea rămâne în istoric
  const d = rec(aConf, { adaugate: 0, actualizate: 0, ambigue: [] }, {}, 'D', null)
  assertEquals([d.stare, 'inchis_prin' in d, d.istoric[0].confirmat_la], ['fara_conflicte', false, '2026-09-26T11:00:00Z'])
})

Deno.test('ADDENDUM 2 Copilot, testul 3: recitirea PARȚIALĂ / GOLITĂ de rândul problematic NU rezolvă conflictul (purtat „nerezolvat_la_recitire”)', () => {
  const a = rec(null, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 110, material: 'PE', metri: 500, pozitii: [{ id: 31 }, { id: 32 }] }] },
    { diametre_nestandard: [60], nestandard_m: 110, adnotari_diametru_absent: [{ diametru_mm: 48, lungime_m: 480, zona: 'z3_1' }] }, 'A', acop([110, 60, 48]))
  assertEquals(a.conflicte.map((c: any) => c.tip), ['ambiguu', 'dn_nestandard', 'adnotari_dn_absent'])
  const curat = { adaugate: 0, actualizate: 1, ambigue: [], evaluat: true }
  // (1) recitirea „fără conflicte” care NU mai vede Dn110 / Dn60 / Dn48 (golită de rândurile problematice) => toate purtate, DESCHIS
  const b = rec(a, curat, {}, 'B', acop([160], { zone: ['z1_1', 'z3_1'] }))
  assertEquals([b.stare, deschis(b), b.n, b.conflicte.map((c: any) => c.tip_initial)], ['conflicte', true, 3, ['ambiguu', 'dn_nestandard', 'adnotari_dn_absent']])
  assert(b.conflicte.every((c: any) => c.tip === 'nerezolvat_la_recitire' && c.din === 'A'))
  // (2) recitirea INCOMPLETĂ (zone căzute) — nimic acoperit, chiar dacă vede Dn-urile
  const c = rec(a, curat, {}, 'C', acop([110, 60, 48], { complet: false }))
  assertEquals([c.stare, c.n], ['conflicte', 3])
  // (3) recitirea care vede Dn110 și Dn60, dar NU zona z3_1 a adnotărilor => doar adnotările rămân purtate
  const d = rec(a, curat, {}, 'D', acop([110, 60, 48]))
  assertEquals([d.stare, d.conflicte.map((x: any) => x.tip_initial), d.inchise_la_recitire], ['conflicte', ['adnotari_dn_absent'], 2])
  // (4) rezultat GOL (nicio zonă citită / nicio observație) nu închide nici un conflict fără ancore (transfer căzut)
  const e = rec(null, { eroare: 'x' }, {}, 'E', null)
  assertEquals(rec(e, curat, {}, 'F', acop([], { zone: [] })).stare, 'conflicte')
  assertEquals(rec(e, curat, {}, 'F2', acop([])).stare, 'conflicte', 'zone citite complet, dar niciun Dn observat (planșă goală / ilizibilă)')
  assertEquals(rec(e, curat, {}, 'G', acop([160])).stare, 'fara_conflicte')
  // (5) purtarea nu cuibărește: o a doua recitire neacoperitoare păstrează textul și originea
  const f = rec(b, curat, {}, 'H', acop([160]))
  assertEquals(f.conflicte.map((x: any) => [x.tip, x.din]), b.conflicte.map((x: any) => [x.tip, x.din]))
  // (6) acoperirea completă a tuturor ancorelor + niciun conflict nou => închis
  const g = rec(b, curat, {}, 'I', acop([110, 60, 48], { zone: ['z1_1', 'z3_1'] }))
  assertEquals([g.stare, g.inchis_prin, g.inchise_la_recitire], ['fara_conflicte', 'recitire_fara_conflicte', 3])
  assert(acoperit({ tip: 'x', text: '' }, acop([1])) && !acoperit({ tip: 'x', text: '' }, null))
})

Deno.test('reparația rundei 1: confirmarea contează DOAR validă — autor uuid, moment ISO, tip rezolvat / excepție, notă minimă, legată de înregistrarea exactă', () => {
  const a = rec(null, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 110, material: 'PE', metri: 500 }] }, {}, 'A')
  assert(confirmareValida(conf(a)) && !deschis(conf(a)))
  assert(confirmareValida(conf(a, { confirmare_tip: 'exceptie', confirmare_nota: 'nu afectează oferta: pozițiile sunt în F3' })))
  for (const [ce, o] of [['confirmat_la „nu-e-data”', { confirmat_la: 'nu-e-data' }], ['luna 13', { confirmat_la: '2026-13-45T00:00:00Z' }],
    ['confirmat_de ne-uuid', { confirmat_de: 'owner' }], ['notă scurtă', { confirmare_nota: 'ok' }], ['fără tip', { confirmare_tip: null }],
    ['tip necunoscut', { confirmare_tip: 'vazut' }], ['excepție cu notă sub 20', { confirmare_tip: 'exceptie', confirmare_nota: 'nu contează' }],
    ['alt token (conflictul altei rulări)', { confirmat_token: 'B' }], ['fără token', { confirmat_token: null }]] as [string, any][]) {
    assertFalse(confirmareValida(conf(a, o)), ce)
    assert(deschis(conf(a, o)), ce)
  }
  // o stare necunoscută (sau lipsă) e DESCHISĂ — fail-closed
  assert(deschis({ id: 'X', stare: 'ciudat' }) && deschis({ id: 'X' }) && !deschis({ id: 'X', stare: 'fara_conflicte' }))
})

Deno.test('reparația rundei 1 (MAJOR jurnale legacy): jurnalul codului VECHI fără marcajele R5 NU e „fără conflicte” — legacy_partial DESCHIS; conflictele lui convertite, nu pierdute', () => {
  // doc 130 (lic. 3) și 471 (lic. 95): jurnale reale ale edge v25 — 0 conflicte numărate, dar nici identitate / Nr / TOTAL multiplu evaluate
  for (const [nume, S] of [['130', SUMAR_130], ['471', SUMAR_471]] as [string, any][]) {
    const st = stareLegacy(S.cantitati, S, conflicteTransfer(S.cantitati, S))
    assertEquals([st.stare, st.conflicte.map((c) => c.tip)], ['legacy_partial', ['evaluare_partiala']], nume)
  }
  // doc 470: conflictele numărate + evaluarea parțială
  const s470 = stareLegacy(SUMAR_470.cantitati, SUMAR_470, conflicteTransfer(SUMAR_470.cantitati, SUMAR_470))
  assertEquals([s470.stare, restantePeTip(s470.conflicte)], ['conflicte', { dn_nestandard: 1, adnotari_dn_absent: 1, evaluare_partiala: 1 }])
  // cu marcajele R5 (codul nou) și fără conflicte => fără conflicte
  const nou = { ...SUMAR_130, identitate_randuri: { lecturi_tabel: 3 }, randuri_fara_identitate_n: 0 }
  assertEquals(stareLegacy(nou.cantitati, nou, []).stare, 'fara_conflicte')
  assertEquals(stareLegacy({ in_ce: 1 }, {}, []).stare, 'necunoscut')
  // conversia: doar jurnal vechi nelegat; nu peste o înregistrare, nu în curs, nu legat
  const l130 = inregistrareLegacy({ citire_ai: { sumar: SUMAR_130, transfer: { la: '2026-09-15T15:19:53Z' } } }, conflicteTransfer)!
  assertEquals([l130.stare, l130.n, deschis(l130), l130.sursa, l130.la], ['legacy_partial', 1, true, 'legacy', '2026-09-15T15:19:53Z'])
  assertEquals(inregistrareLegacy({ transfer_cantitati: { id: 'x' }, citire_ai: { sumar: SUMAR_130 } }, conflicteTransfer), null)
  assertEquals(inregistrareLegacy({ citire_ai: { sumar: { cantitati: { in_curs: true } } } }, conflicteTransfer), null)
  assertEquals(inregistrareLegacy({ citire_ai: { sumar: { cantitati: { adaugate: 0, inregistrare_id: 'r' } } } }, conflicteTransfer), null)
  // conflictele legacy 470 au ancore => o recitire nouă parțială nu le șterge
  const l470 = inregistrareLegacy({ citire_ai: { sumar: SUMAR_470 } }, conflicteTransfer)!
  const dupa = rec(l470, { adaugate: 0, actualizate: 0, ambigue: [], evaluat: true }, {}, 'N', acop([40, 63], { zone: ['z1_1'] }))
  assertEquals([dupa.stare, dupa.conflicte.map((c: any) => c.tip_initial)], ['conflicte', ['dn_nestandard', 'adnotari_dn_absent']])
  // evaluarea parțială (fără ancore) se închide de o recitire completă NEGOALĂ a codului nou
  assertEquals(rec(l130, { adaugate: 0, actualizate: 0, ambigue: [], evaluat: true }, {}, 'M', acop([160, 180, 250])).stare, 'fara_conflicte')
  // … dar NU de o recitire GOALĂ (docs 471–475 reale: planșe fără nicio observație, ilizibile) — rămâne pentru omul care decide (✋)
  const l471 = inregistrareLegacy({ citire_ai: { sumar: SUMAR_471 } }, conflicteTransfer)!
  const gol = rec(l471, { adaugate: 0, actualizate: 0, ambigue: [], pe_diametre: {} }, {}, 'G', acop([]))
  assertEquals([gol.stare, gol.conflicte.map((c: any) => c.tip_initial)], ['conflicte', ['evaluare_partiala']])
})

Deno.test('reparația rundei 1 (minor „identitate incertă”): comasările neconfirmate și perechile neîmperecheate sunt CONFLICTE (nu doar avertismente)', () => {
  const x = conflicteTransfer({ adaugate: 0, actualizate: 0, ambigue: [] }, {
    comasari_neconfirmate: [{ a: 'z1_4', b: 'z1_5', nr: '1–18', randuri: 18, axa: 'orizontal' }],
    perechi_neimperecheate: [{ a: 'z2_6', b: 'z2_7', neimperecheate: [1, 0] }] })
  assertEquals(x.map((c) => [c.tip, c.ancore]), [['identitate_incerta', { zone: ['z1_4', 'z1_5'] }], ['identitate_incerta', { zone: ['z2_6', 'z2_7'] }]])
  assert(x[0].text.includes('două tabele identice numărate o singură dată'), x[0].text)
})

Deno.test('sarcina 2: transferul căzut / amânat NU șterge conflictele anterioare — e el însuși deschis („neefectuat”) și le POARTĂ (reparația rundei 1), cele vechi și în `anterior`', () => {
  const a = rec(null, { adaugate: 0, actualizate: 0, ambigue: [{ dn: 63, material: null, metri: 200 }] }, {}, 'A', acop([63]))
  const e = rec(a, { eroare: 'transfer: două scrieri pe rândul TOTAL (id 4)' }, {}, 'E', acop([63], { complet: false }))
  assertEquals([e.stare, deschis(e), e.conflicte.map((c: any) => c.tip)], ['neefectuat', true, ['transfer_eroare', 'nerezolvat_la_recitire']])
  assertEquals(e.anterior.conflicte[0].tip, 'ambiguu')
  const am = rec(e, { amanat: '2 felii n-au putut fi citite' }, { nr_lipsa: [{ pagina: 1, interval: [1, 9], lipsesc: '4', n: 1, zone: ['z1_1'] }], zone_cazute: ['z2_1'] }, 'M', null)
  assertEquals([am.stare, am.n, am.conflicte.map((x: any) => x.tip)], ['neefectuat', 4, ['transfer_amanat', 'nr_lipsa', 'nerezolvat_la_recitire', 'nerezolvat_la_recitire']])
  assertEquals(am.conflicte[0].ancore, { zone: ['z2_1'] })
  // lanțul nu crește: `anterior` fără propriul `anterior`; istoricul plafonat
  assertFalse('anterior' in am.anterior)
  let r: any = null
  for (let i = 0; i < 15; i++) r = rec(r, { adaugate: 0, actualizate: 0, ambigue: [] }, {}, `X${i}`, acop([1]))
  assertEquals(r.istoric.length, MAX_ISTORIC)
  assertEquals(r.istoric[0].id, 'X13')
})

Deno.test('sarcina 2: plafonul listei — 45 de conflicte => n = 45, lista 40, „trunchiat” (nu se pierde numărul)', () => {
  const r = inregistrareTransfer(null, { conflicte: Array.from({ length: 45 }, (_, i) => ({ tip: 'ambiguu', text: String(i) })), id: 'Z', la: 'x', cod: 'c' })
  assertEquals([r.n, r.conflicte.length, r.trunchiat, deschis(r)], [45, 40, true, true])
})

// ── REPARAȚIA RUNDEI 2 (verificatorul UI, V-C4): corupția de TIP a cheilor serverului — aceleași reguli ca ofertare_transfer_stare (SQL) ──
Deno.test('reparația rundei 2: forma coruptă (array / text) => înregistrare „necunoscut” DESCHISĂ, nu „nicio înregistrare”; închisă doar de o citire completă și negoală', () => {
  // cele 3 forme ale verificatorului (V-C4) + citire_ai = text; controalele: obiect / null / absent
  assertEquals(formaCorupta({ transfer_cantitati: [{ stare: 'conflicte', n: 3 }], citire_ai: { sumar: {} } }), 'transfer_cantitati de tip array')
  assertEquals(formaCorupta({ citire_ai: { gata: true, sumar: { cantitati: 'EROARE: transfer întrerupt' } } }), 'cantitati nu e obiect')
  assertEquals(formaCorupta({ citire_ai: { gata: true, sumar: 'corupt' } }), 'sumar nu e obiect')
  assertEquals(formaCorupta({ citire_ai: 'x' }), 'citire_ai nu e obiect')
  assertEquals(formaCorupta({ transfer_cantitati: null, citire_ai: { sumar: {} } }), null)
  assertEquals(formaCorupta({ transfer_cantitati: { id: 'r1' }, citire_ai: { sumar: { cantitati: 'x' } } }), null)   // jurnal corupt, dar înregistrarea e sursa de adevăr
  assertEquals(formaCorupta({ citire_ai: { sumar: SUMAR_130 } }), null)
  const arr = { transfer_cantitati: [{ stare: 'conflicte', n: 3 }], citire_ai: { sumar: {} } }
  const p = inregistrarePrecedenta(arr, conflicteTransfer)!
  assertEquals([p.stare, p.n, p.conflicte[0].tip, deschis(p)], ['necunoscut', 1, 'necunoscut', true])
  assert(/corupt \(transfer_cantitati de tip array\)/.test(p.conflicte[0].text))
  // înainte: `transfer_cantitati ?? legacy` lua array-ul ca atare, iar inregistrareTransfer îl ignora => orice citire, chiar goală, „fără conflicte”
  const goala = inregistrareTransfer(p, { conflicte: [], id: 'n1', la: '2026-09-26T12:00:00Z', cod: 'c', acoperire: { complet: true, zone: [], dn: [], cantitati_evaluate: false } })
  assertEquals([goala.stare, goala.n, goala.conflicte[0].tip, goala.conflicte[0].tip_initial], ['conflicte', 1, 'nerezolvat_la_recitire', 'necunoscut'])
  const partiala = inregistrareTransfer(p, { conflicte: [], id: 'n2', la: '2026-09-26T12:00:00Z', cod: 'c', acoperire: { complet: false, zone: ['z1_1'], dn: [110], cantitati_evaluate: true } })
  assertEquals(partiala.stare, 'conflicte')
  const completa = inregistrareTransfer(p, { conflicte: [], id: 'n3', la: '2026-09-26T12:00:00Z', cod: 'c', acoperire: { complet: true, zone: ['z1_1'], dn: [110], cantitati_evaluate: true } })
  assertEquals([completa.stare, completa.inchis_prin], ['fara_conflicte', 'recitire_fara_conflicte'])
  // înregistrarea-obiect rămâne precedenta (neschimbat)
  const ob = { id: 'r1', stare: 'fara_conflicte', n: 0, conflicte: [] }
  assertEquals(inregistrarePrecedenta({ transfer_cantitati: ob, citire_ai: { sumar: { cantitati: 'x' } } }, conflicteTransfer), ob)
  assertEquals(inregistrarePrecedenta({ citire_ai: { sumar: {} } }, conflicteTransfer), null)
})

Deno.test('runda 9 (M12 + ADDENDUM 3, 3): citirea NETERMINATĂ fără înregistrare = deschisă (oglinda SQL); jurnalul vechi = „verificare indisponibilă”', () => {
  // o rundă a edge-ului publicat (v25): citire_ai rescris, sumar fără `cantitati`, gata = false, fără transfer_cantitati
  assertEquals(stareCitireNeterminata({ citire_ai: { gata: false, rulare: 'v25', sumar: { felii_citite: 3 } } }), { stare: 'citire_neterminata', n: 1, restante: [{ tip: 'citire_neterminata', n: 1 }] })
  assertEquals(stareCitireNeterminata({ citire_ai: { gata: true, sumar: SUMAR_470 } }), null)
  assertEquals(stareCitireNeterminata({ transfer_cantitati: { id: 'r1', stare: 'conflicte' }, citire_ai: { gata: false } }), null)   // înregistrarea = sursa de adevăr
  assertEquals(stareCitireNeterminata({ transfer_cantitati: 'x', citire_ai: { gata: false } }), null)   // corupt => „necunoscut”, altă regulă
  // conversia din handler NU poartă starea (o citire completă a codului nou reevaluează tot) — jurnalul fără cantități nu produce înregistrare legacy
  assertEquals(inregistrareLegacy({ citire_ai: { gata: false, sumar: { felii_citite: 3 } } }, conflicteTransfer), null)
  assert(/^verificare indisponibilă: /.test(EVALUARE_PARTIALA.text) && /nici o contradicție a documentației nu e dovedită/.test(EVALUARE_PARTIALA.text))
})
