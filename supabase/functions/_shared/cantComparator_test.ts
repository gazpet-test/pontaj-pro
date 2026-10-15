import { assert, assertEquals } from 'jsr:@std/assert@1'
import { acoperirePereche, agrega, amprenta, calcul, canonic, cheieObs, compara, deduplica, type DocManifest, h2, type Obs, reprezentanti, verdict,
  PRAGURI_IMPLICITE } from './cantComparator.ts'

let nextId = 1
function o(p: Partial<Obs>): Obs {
  return { id: nextId++, document_id: 1, doc_sha256: 'a'.repeat(64), rol_sursa: 'f3', lot_domeniu: 'toate', lot_nr: [], pozitie_dovedita: true,
    valoare_ambigua: false, cantitate_offset: 100, tip_lucrare: 'conducta', masura: 'lungime', obiect_cheie: 'strada a', material: 'PE100',
    dn_mm: [90], dn_ambiguu: false, sdr: null, um_norm: 'm', cantitate: 100, e_total: false, e_subtotal: false, ...p }
}
function doc(p: Partial<DocManifest>): DocManifest {
  return { document_id: 1, sha256: 'a'.repeat(64), parte: 'F3', roluri: ['f3'], extragere: 'gata', extragere_id: 1, text_valid: true,
    completitudine: 'integral', sursa_partiala_acceptata: false, rol_nerezolvat: false, verificat_fara_lungimi: [], ...p }
}
const DOCS = [doc({}), doc({ document_id: 2, sha256: 'b'.repeat(64), parte: 'ATR', roluri: ['atr'] })]

// ── deduplicarea (spec §5.2, testele obligatorii) ──
Deno.test('dedup: un tabel tăiat între felii / același rând citat diferit în două felii → o observație (același offset, aceeași semantică)', () => {
  const r = deduplica([o({ cantitate_offset: 500 }), o({ cantitate_offset: 500 })])
  assertEquals([r.pozitii.length, r.pozitii[0].ids.length, r.conflicte.length], [1, 2, 0])
})
Deno.test('dedup: două rânduri identice pe linii diferite (offseturi diferite) → două observații, valorile se ADUNĂ (2 × 100 = 200)', () => {
  const { pe } = agrega([o({ cantitate_offset: 10 }), o({ cantitate_offset: 90 })], DOCS, [])
  const a = [...pe.get('f3')!.values()][0]
  assertEquals(a.val, 200)
})
Deno.test('dedup: două articole pe aceeași linie, citatul primului peste al doilea („R1 Strada A 100 m; R2” / „R2 Strada A 100 m”) → două poziții', () => {
  const t = 'R1 Strada A 100 m; R2 Strada A 100 m'
  const { pe } = agrega([o({ cantitate_offset: t.indexOf('100') }), o({ cantitate_offset: t.lastIndexOf('100') })], DOCS, [])
  assertEquals([...pe.get('f3')!.values()][0].val, 200)
})
Deno.test('dedup: rânduri identice care nu se pot localiza unic (nedovedite) → cheia incompletă, nu se adună', () => {
  const { pe } = agrega([o({ pozitie_dovedita: false, cantitate_offset: null }), o({ cantitate_offset: 30 })], DOCS, [])
  const a = [...pe.get('f3')!.values()][0]
  assert(a.incomplet !== null)
  assertEquals(a.val, 100)
})

// ── §6.6 PR4: conflictul semantic la același offset → conflict_sursa, inclusiv e_total / e_subtotal, independent de ordine ──
Deno.test('§6.6: același offset, metadate diferite (Dn / obiect / valoare / total vs detaliu) → conflict_sursa în ambele ordini', () => {
  const variante: Partial<Obs>[] = [{ dn_mm: [110] }, { obiect_cheie: 'strada b' }, { cantitate: 1000 }, { e_total: true }, { e_subtotal: true }]
  for (const v of variante) {
    for (const ordine of [0, 1]) {
      const x = o({ cantitate_offset: 700 }), y = o({ cantitate_offset: 700, ...v })
      const lista = ordine ? [y, x] : [x, y]
      const atr = o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5 })
      const { cmp } = compara([...lista, atr], DOCS, [])
      const f3atr = cmp.filter((c) => c.rol_a === 'f3' && c.rol_b === 'atr')
      assert(f3atr.some((c) => c.verdict === 'conflict_sursa'), `varianta ${JSON.stringify(v)} ordinea ${ordine}`)
      assert(!f3atr.some((c) => c.verdict === 'concordant' && c.cheie === cheieObs(x)), 'nicio variantă nu e aleasă')
    }
  }
})
Deno.test('§6.6: incomplet se propagă până la H2 (perechea nu e gata)', async () => {
  const obs = [o({ pozitie_dovedita: false, cantitate_offset: null }), o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5 })]
  const r = await calcul({ licitatie_id: 15, lot_domeniu: 'toate', lot_nr: [], extractor_id: 'x', docs: DOCS, obs, aliasuri: [], decizii: [] })
  const ac = r.calcul.acoperire['f3-atr']
  assertEquals(ac.stare, 'incomplet')
  assertEquals(h2(true, ac, r.cmp.filter((c) => c.rol_a === 'f3' && c.rol_b === 'atr') as any).stare, 'incomplet')
  assertEquals(r.calcul.stare, 'incomplet')
})
Deno.test('§6.6 PR3: agregare cu convenție demonstrabilă (2.000,00 + 1.995,00 = 3.995) vs ATR 3.995 → concordant', () => {
  const obs = [o({ cantitate_offset: 10, cantitate: 2000 }), o({ cantitate_offset: 60, cantitate: 1995 }),
    o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5, cantitate: 3995 })]
  const c = compara(obs, DOCS, []).cmp.find((x) => x.rol_a === 'f3' && x.rol_b === 'atr')!
  assertEquals([c.val_a, c.val_b, c.verdict], [3995, 3995, 'concordant'])
})

// ── agregarea per rol ──
Deno.test('agregare: doar măsura „lungime”, separat pe tip_lucrare; totalurile NU se adună cu detaliile (suma_vs_total)', () => {
  const obs = [o({ cantitate_offset: 1, cantitate: 100 }), o({ cantitate_offset: 2, cantitate: 50 }), o({ cantitate_offset: 3, masura: 'proba', cantitate: 999 }),
    o({ cantitate_offset: 4, tip_lucrare: 'bransament', cantitate: 10 }), o({ cantitate_offset: 5, e_total: true, cantitate: 160 })]
  const { pe } = agrega(obs, DOCS, [])
  const m = pe.get('f3')!
  const k = cheieObs(obs[0])!
  assertEquals([m.get(k)!.val, m.get(k + '#total')!.val, m.get(cheieObs(obs[3])!)!.val], [150, 160, 10])
  const svt = compara(obs, DOCS, []).cmp.find((c) => c.cheie === k + '#suma_vs_total')!
  assertEquals([svt.val_a, svt.val_b, svt.verdict], [150, 160, 'diferenta'])
})
Deno.test('agregare: aceeași cheie în două documente NECOMPLEMENTARE ale aceluiași rol → conflict_sursa; părțile p01 / p02 se adună', () => {
  const docs = [doc({}), doc({ document_id: 3, sha256: 'c'.repeat(64), parte: 'ALT F3' }), doc({ document_id: 4, sha256: 'd'.repeat(64), parte: 'F3' })]
  const nec = agrega([o({}), o({ document_id: 3, doc_sha256: 'c'.repeat(64) })], docs, []).pe.get('f3')!
  assertEquals([...nec.values()][0].conflict, true)
  const com = agrega([o({}), o({ document_id: 4, doc_sha256: 'd'.repeat(64) })], docs, []).pe.get('f3')!
  assertEquals([[...com.values()][0].conflict, [...com.values()][0].val], [false, 200])
})
Deno.test('cheia: Dn ambiguu / multiplu / lipsă → neasociat (nu se ghicește)', () => {
  for (const v of [{ dn_ambiguu: true }, { dn_mm: [90, 110] }, { dn_mm: [] }]) assertEquals(cheieObs(o(v)), null)
  const { cmp } = compara([o({ dn_mm: [] })], DOCS, [])
  assertEquals(cmp.map((c) => c.verdict), ['neasociat'])
})
Deno.test('aliasuri: reprezentantul = cea mai mică cheie din componentă, indiferent de ordine; lanțuri rezolvate', () => {
  const r1 = reprezentanti([{ id: 1, cheie_a: 'b', cheie_b: 'c' }, { id: 2, cheie_a: 'a', cheie_b: 'b' }])
  const r2 = reprezentanti([{ id: 2, cheie_a: 'a', cheie_b: 'b' }, { id: 1, cheie_a: 'b', cheie_b: 'c' }])
  assertEquals([r1('c'), r1('b'), r2('c'), r1('z')], ['a', 'a', 'a', 'z'])
})

// ── formule și praguri ──
Deno.test('verdict: formule, rotunjire 0,001, null → lipsa, 0 și 0 → concordant, prag H2 și „de semnalat”', () => {
  const A = (val: number | null) => ({ val, obs: [], incomplet: null, conflict: false, parti: new Set<string>() })
  assertEquals(verdict(A(null), A(5), PRAGURI_IMPLICITE).verdict, 'lipsa_a')
  assertEquals(verdict(A(5), undefined, PRAGURI_IMPLICITE).verdict, 'lipsa_b')
  assertEquals(verdict(A(0), A(0), PRAGURI_IMPLICITE).verdict, 'concordant')
  assertEquals(verdict(A(1000), A(1000.0004), PRAGURI_IMPLICITE).verdict, 'concordant')
  const v = verdict(A(6400), A(3995), PRAGURI_IMPLICITE)
  assertEquals([v.verdict, v.delta_abs, v.de_semnalat], ['diferenta', -2405, true])
  const mic = verdict(A(100), A(100.5), PRAGURI_IMPLICITE)    // 0,5 % și 0,5 m: diferență H2, dar nu „de semnalat”
  assertEquals([mic.verdict, mic.de_semnalat], ['diferenta', false])
})

// ── acoperirea pe perechi (§5.0) ──
Deno.test('acoperire: gata doar cu toate condițiile; fiecare lipsă e numită pe document', () => {
  const obs = [o({}), o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5 })]
  const { cmp } = compara(obs, DOCS, [])
  assertEquals(acoperirePereche('f3', 'atr', DOCS, obs, cmp).stare, 'gata')
  const cazuri: [Partial<DocManifest>, string][] = [[{ extragere: 'partial' }, 'extragere partial'], [{ text_valid: false }, 'text fără proveniență'],
    [{ completitudine: 'partial' }, 'text parțial'], [{ rol_nerezolvat: true }, 'rol nerezolvat']]
  for (const [p, motiv] of cazuri) {
    const ds = [doc({ ...p }), DOCS[1]]
    const a = acoperirePereche('f3', 'atr', ds, obs, cmp)
    assertEquals(a.stare, 'incomplet')
    assert(a.lipsuri.some((l) => l.motiv.startsWith(motiv)), motiv)
  }
  // un al doilea document F3 fără observații → incomplet până la „verificat fără lungimi” pe ACEL document
  const ds = [...DOCS, doc({ document_id: 5, sha256: 'e'.repeat(64), parte: 'F3' })]
  assertEquals(acoperirePereche('f3', 'atr', ds, obs, cmp).stare, 'incomplet')
  assertEquals(acoperirePereche('f3', 'atr', [...DOCS, doc({ document_id: 5, sha256: 'e'.repeat(64), parte: 'F3', verificat_fara_lungimi: ['f3'] })], obs, cmp).stare, 'gata')
  // fără nicio cheie comună → incomplet, niciodată „concordant”
  const fara = [o({}), o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5, obiect_cheie: 'alta strada' })]
  assertEquals(acoperirePereche('f3', 'atr', DOCS, fara, compara(fara, DOCS, []).cmp).lipsuri.some((l) => l.motiv === 'nicio cheie comună comparabilă'), true)
})
Deno.test('H2: fără calcul valid = necalculat (lipsa nu e „nu există”)', () => {
  assertEquals(h2(false, { stare: 'gata', lipsuri: [] }, []).stare, 'necalculat')
})

// ── amprenta ──
Deno.test('amprenta: canonică (ordinea cheilor nu contează); algoritmul / pragurile / extractorul o schimbă', async () => {
  assertEquals(canonic({ b: 1, a: [2, { d: 3, c: 4 }] }), canonic({ a: [2, { c: 4, d: 3 }], b: 1 }))
  const baza = { licitatie_id: 15, lot_domeniu: 'toate', lot_nr: [], extractor_id: 'x', docs: DOCS, obs: [o({})], aliasuri: [], decizii: [] }
  const a = await calcul(baza)
  const b = await calcul({ ...baza, extractor_id: 'y' })
  const c = await calcul({ ...baza, praguri: { ...PRAGURI_IMPLICITE, h2_rel: 0.01 } })
  assert(a.calcul.amprenta !== b.calcul.amprenta && a.calcul.amprenta !== c.calcul.amprenta)
  assertEquals(a.calcul.amprenta, (await calcul(baza)).calcul.amprenta)
  assertEquals(await amprenta({ x: 1 }), await amprenta({ x: 1 }))
})

// ── pipeline-ul pe fixture-ul Răcari (NU golden: valorile din text, potrivirea străzilor din fixture, neverificate de om) ──
Deno.test('Răcari (fixture din text): F3 6.400 vs ATR pe străzi; 3 străzi concordante, 13 diferențe', async () => {
  const F = JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/tkt0329_racari_text_fixture.json', import.meta.url)))
  const docs = [doc({ document_id: 212, sha256: 'f'.repeat(64), parte: 'Liste' }), doc({ document_id: 213, sha256: 'e'.repeat(64), parte: 'Liste' }),
    doc({ document_id: 214, sha256: 'd'.repeat(64), parte: 'Pth', roluri: ['atr'] })]
  const obs: Obs[] = []
  for (const e of F.f3_dn90) obs.push(o({ document_id: e.document_id, doc_sha256: e.document_id === 212 ? 'f'.repeat(64) : 'e'.repeat(64), rol_sursa: 'f3',
    cantitate_offset: e.cantitate_offset, obiect_cheie: e.obiect_cheie_propusa, material: 'PVC', cantitate: e.cantitate }))
  for (const a of F.atr_dn90) obs.push(o({ document_id: 214, doc_sha256: 'd'.repeat(64), rol_sursa: 'atr', cantitate_offset: a.cantitate_offset,
    obiect_cheie: String(a.strada).toLowerCase(), material: null, cantitate: a.cantitate }))
  // aliasurile = potrivirea propusă de fixture (în producție le confirmă omul)
  const cheie = (ob: string, mat: string | null) => ['toate', '', ob, 'conducta', mat ?? '', 90, 'm'].join('|')
  const aliasuri = F.potrivire_f3_atr.map((p: any, i: number) => {
    const f3 = F.f3_dn90.find((e: any) => e.obiect === p.f3_obiect)
    const [x, y] = [cheie(f3.obiect_cheie_propusa, 'PVC'), cheie(String(p.atr_strada).toLowerCase(), null)].sort()
    return { id: i + 1, cheie_a: x, cheie_b: y }
  })
  const { cmp } = compara(obs, docs, aliasuri)
  const pereche = cmp.filter((c) => c.rol_a === 'f3' && c.rol_b === 'atr')
  const sumaF3 = obs.filter((x) => x.rol_sursa === 'f3').reduce((s, x) => s + (x.cantitate ?? 0), 0)
  assertEquals(sumaF3, 6400)
  assertEquals(pereche.filter((c) => c.verdict === 'concordant').length, F.sume.egale_f3_atr)
  assertEquals(pereche.filter((c) => c.verdict === 'diferenta').length, 16 - F.sume.egale_f3_atr)
})

// ── review r1 (Copilot + Jakarinos): contraexemplele ca teste ──
Deno.test('r1: conflict semantic pe măsură (lungime vs montaj, același offset) → conflict_sursa, nu se pierde prin filtrul de relevanță', () => {
  for (const ordine of [0, 1]) {
    const v = [o({ cantitate_offset: 7 }), o({ cantitate_offset: 7, masura: 'montaj' })]
    if (ordine) v.reverse()
    const k = cheieObs(v[0])!
    assertEquals(agrega(v, DOCS, []).pe.get('f3')!.get(k)!.conflict, true)
    const atr = o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5 })
    const c = compara([...v, atr], DOCS, []).cmp.find((x) => x.cheie === k && x.rol_a === 'f3' && x.rol_b === 'atr')!
    assertEquals(c.verdict, 'conflict_sursa')
  }
})
Deno.test('r1: un total fără detalii → suma_vs_total emisă (lipsa_a); subtotalurile au și ele suma_vs_subtotal', () => {
  const t = o({ cantitate_offset: 3, cantitate: 500, e_total: true })
  const k = cheieObs(t)!
  const svt = compara([t], DOCS, []).cmp.find((c) => c.cheie === k + '#suma_vs_total')!
  assertEquals(svt.verdict, 'lipsa_a')
  const obs = [o({ cantitate_offset: 1, cantitate: 100 }), o({ cantitate_offset: 2, cantitate: 120, e_subtotal: true })]
  const svs = compara(obs, DOCS, []).cmp.find((c) => c.cheie === k + '#suma_vs_subtotal')!
  assertEquals([svs.verdict, svs.val_a, svs.val_b], ['diferenta', 100, 120])
})
Deno.test('r1: o lungime nedovedită FĂRĂ cheie (Dn lipsă) face perechea incompletă (nu dispare ca neasociată)', () => {
  const obs = [o({}), o({ id: 9001, pozitie_dovedita: false, cantitate_offset: null, dn_mm: [] }),
    o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5 })]
  const { cmp } = compara(obs, DOCS, [])
  assert(cmp.some((c) => c.cheie === 'nedovedit:9001' && c.verdict === 'incomplet'))
  const ac = acoperirePereche('f3', 'atr', DOCS, obs, cmp)
  assertEquals(ac.stare, 'incomplet')
  assert(ac.lipsuri.some((l) => l.motiv === 'chei incomplete'))
})
Deno.test('r1: acoperirea și agregarea folosesc același predicat (lungime în km contează; o „proba” în m nu acoperă documentul)', () => {
  const doarProba = [o({ masura: 'proba' }), o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5 })]
  const ac = acoperirePereche('f3', 'atr', DOCS, doarProba, compara(doarProba, DOCS, []).cmp)
  assert(ac.lipsuri.some((l) => l.document_id === 1 && l.motiv.startsWith('0 observații relevante')))
  const km = [o({ um_norm: 'km', cantitate: 1.2 }), o({ document_id: 2, doc_sha256: 'b'.repeat(64), rol_sursa: 'atr', cantitate_offset: 5, cantitate: 1200 })]
  const { cmp } = compara(km, DOCS, [])
  const c = cmp.find((x) => x.rol_a === 'f3' && x.rol_b === 'atr')!
  assertEquals([c.verdict, c.val_a, c.val_b], ['concordant', 1200, 1200])
  assertEquals(acoperirePereche('f3', 'atr', DOCS, km, cmp).stare, 'gata')
})
Deno.test('r1: SDR diferit la același offset → conflict_sursa', () => {
  const { conflicte } = deduplica([o({ cantitate_offset: 4, sdr: 11 }), o({ cantitate_offset: 4, sdr: 17.6 })])
  assertEquals(conflicte.length, 1)
})
Deno.test('r1: amprenta include toate intrările acoperirii (text_valid, completitudine, decizii umane pe document)', async () => {
  const baza = { licitatie_id: 15, lot_domeniu: 'toate', lot_nr: [], extractor_id: 'x', docs: DOCS, obs: [o({})], aliasuri: [], decizii: [] }
  const a = (await calcul(baza)).calcul.amprenta
  const variante: Partial<DocManifest>[] = [{ text_valid: false }, { completitudine: 'partial' }, { sursa_partiala_acceptata: true },
    { rol_nerezolvat: true }, { verificat_fara_lungimi: ['f3'] }]
  for (const v of variante) assert((await calcul({ ...baza, docs: [doc(v), DOCS[1]] })).calcul.amprenta !== a, JSON.stringify(v))
  // ordinea rolurilor / a deciziilor de pe document nu schimbă amprenta
  const r1 = await calcul({ ...baza, docs: [doc({ roluri: ['f3', 'cs'], verificat_fara_lungimi: ['cs', 'f3'] }), DOCS[1]] })
  const r2 = await calcul({ ...baza, docs: [doc({ roluri: ['cs', 'f3'], verificat_fara_lungimi: ['f3', 'cs'] }), DOCS[1]] })
  assertEquals(r1.calcul.amprenta, r2.calcul.amprenta)
})
Deno.test('r1: rotunjirea se face o singură dată, pe suma finală (0,0004 × 3 = 0,001, nu 0)', () => {
  const { pe } = agrega([1, 2, 3].map((i) => o({ cantitate_offset: i, cantitate: 0.0004 })), DOCS, [])
  assertEquals([...pe.get('f3')!.values()][0].val, 0.001)
})
