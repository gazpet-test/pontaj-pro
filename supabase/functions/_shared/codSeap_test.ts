// deno test supabase/functions/_shared/codSeap_test.ts — codul SEAP ca identitate în lista principală (audit #4 var. B,
// Răzvan 08.10.2026: L1 = A, N = A, M = A, S = B, P = A, 4 = A). Tabelul de decizie: docs/ofertare/AUDIT_MOTOR_IMPORT_2026-10-07.md.
import { strict as assert } from 'node:assert'
import {
  INDEX_COD_UNIC, ADOPTIE, codDin, ordineCod, numeVersiune, numeBaza, eGetAll, esteVolumRar, copiiDinManifest, inventarCod, adaugaRand,
  indexLista, coduriInstabile, decideSeap, verificabil, ALT_CONTINUT, rezolvaVerificare, tipMostenit, campuriCod, eDuplicatCod, adoptaCod, mutaCod, mutaPeIdentic,
  candidatiMutare,
} from './codSeap.mjs'
import { cheieRand as cheieRandCu, cheiSeap as cheiSeapCu, numeDesfacut, eArhivaP7m } from './semnaturaCms.mjs'
import { ghicesteTip, esteArhiva } from './tipDocument.mjs'

// aceeași cheie ca edge-ul de import și veghea (cheieNume + cheieRand / cheiSeap din semnaturaCms.mjs)
const cheieNume = (n: unknown) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase().replace(/[,()]/g, '').replace(/\s+/g, '')
const cheieRand = (n: unknown) => cheieRandCu(String(n ?? ''), cheieNume)
const chei = (n: string) => cheiSeapCu(n, cheieNume) as string[]
const P = (nr: number) => `CN1095546/${String(nr).padStart(5, '0')}`
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64)

// deno-lint-ignore no-explicit-any
type Any = any
let urmator = 500
const rand = (nume: string, cod: string | null = null, extra: Record<string, unknown> = {}): Any =>
  ({ id: urmator++, nume_original: nume, fisier_path: `3/atribuire/x_${nume}`, seap_cod: cod, tip: 'alta', size_bytes: 1000, ...extra })
// ca apelanții (edge + veghe): inventarul și lista știu cheile SEAP (echivalența .p7s ≡ document, „X (semnat).pdf”)
const inv0 = (randuri: Any[], man: Any[] = []): Any => inventarCod(randuri, { cheieRand, cheiSeap: chei, copii: copiiDinManifest(man, randuri) })
type Doc = { nume: string; cod: string }
const decide = (inv: Any, docs: Doc[], doc: Doc, o: Any = undefined): Any => decideSeap(inv, indexLista(docs, chei), doc, chei(doc.nume), o)
// decizia + inv.decise.add(cod), ca apelanții
const pas = (inv: Any, docs: Doc[], doc: Doc): Any => { const d = decide(inv, docs, doc); if (doc.cod) inv.decise.add(doc.cod); return d }

Deno.test('constante și codDin', () => {
  assert.equal(INDEX_COD_UNIC, 'ofertare_doc_seap_cod_unic')
  assert.equal(ADOPTIE, 'nume')   // decizia L1 = A
  assert.equal(codDin({ noticeDocumentCode: ' SCN1179379/00020 ' }), 'SCN1179379/00020')
  assert.equal(codDin({}), '')
  assert.equal(codDin(null), '')
})

Deno.test('numeVersiune (decizia N = A): codul înaintea extensiei, pe numele SEAP brut', () => {
  assert.equal(numeVersiune('Caiet de sarcini.pdf', 'CN1095546/00036'), 'Caiet de sarcini (CN1095546-00036).pdf')
  const c = 'SCN1179379/00020', s = 'SCN1179379-00020'
  assert.equal(numeVersiune('X.pdf.p7m', c), `X (${s}).pdf.p7m`)
  assert.equal(numeVersiune('X.pdf.p7s', c), `X (${s}).pdf.p7s`)
  assert.equal(numeVersiune('Doc.zip', c), `Doc (${s}).zip`)
  assert.equal(numeVersiune('X.rar.p7m', c), `X (${s}).rar.p7m`)
  assert.equal(numeVersiune('Caiet-LA PT.pdf 2', c), `Caiet-LA PT (${s}).pdf 2`)   // numărul pus de SEAP la coadă rămâne la coadă
  assert.equal(numeVersiune('Caiet .pdf', c), `Caiet (${s}).pdf`)                 // spațiul dinaintea extensiei
  assert.equal(numeVersiune('Doc.v2.pdf', c), `Doc.v2 (${s}).pdf`)
  assert.equal(numeVersiune('Document', c), `Document (${s})`)                     // fără extensie
  assert.equal(numeVersiune('Caiet.pdf', ''), 'Caiet.pdf')
  assert.equal(numeVersiune('Caiet.pdf', '  '), 'Caiet.pdf')
  for (const n of ['Caiet.pdf', 'X.pdf.p7m', 'Doc.zip', 'Document']) assert.ok(!numeVersiune(n, 'A/B//C').includes('/'), n)
  // desfacerea semnăturii pe numele versiunii dă același nume pe toate drumurile (placeholder veghe = rând import)
  assert.equal(numeDesfacut(numeVersiune('X.pdf.p7m', c)), `X (${s}) (semnat).pdf`)
  assert.equal(numeDesfacut(numeVersiune('X.pdf.p7s', c)), `X (${s}).pdf`)
  assert.equal(eArhivaP7m(numeVersiune('X.rar.p7m', c)), true)
  assert.equal(esteArhiva(numeVersiune('Doc.zip', c)), true)
})

Deno.test('sufixul de cod nu schimbă clasificarea și nici regulile de citire / poartă', () => {
  const corpus = ['Caiet de sarcini.pdf', 'Fisa de date a achizitiei.pdf', 'FISA_DATE_achizitie.pdf.p7s', 'Instructiuni_ofertanti.pdf',
    'Formulare.docx', 'DUAE.xml', 'Model de contract.pdf', 'Volumul 2 - Memoriu tehnic.pdf', 'Raspuns la solicitarea de clarificari nr 3.pdf',
    'Erata 1.pdf', 'Planse.zip', 'traseu.dwg', 'ceva.pdf', 'C1 Caiet de sarcini.pdf', '7. Detaliu montaj.pdf', '12. Detaliu montaj.pdf',
    'Plan de situatie.pdf', 'F3.pdf', 'F3_lista.pdf', 'F3 Lista.pdf', 'F4_ceva.pdf', 'C12_ceva.pdf', 'C5_ceva.pdf', 'C4.pdf', 'do_ceva.pdf',
    'Anexa 2.pdf', 'Formular 1.docx', 'RGZ_18_CS_Vol_II.pdf', '1_Plan_de_situatie.pdf', '3_ATR_Distrigaz.pdf', 'Liste fara preturi.pdf',
    '4. Breviar de calcul subtraversare.pdf', 'Documentatie consolidata.pdf', 'Caiet-LA PT.pdf 2']
  for (const n of corpus) {
    for (const cod of ['SCN1179379/00020', 'CN1095546/00036']) assert.equal(ghicesteTip(numeVersiune(n, cod)), ghicesteTip(n), `${n} + ${cod}`)
  }
  // ofertare_doc_de_citit (20260915): '\.pdf *\d*$' — și cu numărul SEAP de la coadă
  const deCitit = /\.pdf *\d*$/i
  for (const n of ['Caiet.pdf', 'Caiet-LA PT.pdf 2', 'X.pdf']) assert.equal(deCitit.test(numeVersiune(n, P(36))), deCitit.test(n), n)
})

Deno.test('ordineCod, esteVolumRar, copiiDinManifest', () => {
  assert.deepEqual(ordineCod('CN1095546/00060'), { prefix: 'CN1095546', nr: 60 })
  assert.deepEqual(ordineCod(' SCN1179379/00002 '), { prefix: 'SCN1179379', nr: 2 })
  for (const x of ['CN1095546', 'CN1095546/abc', '', null, undefined, '/00012']) assert.equal(ordineCod(x as Any), null, String(x))
  for (const n of ['Planse.part2.rar', 'Planse.part02-semnat.rar', 'X.part1.rar.p7m', 'X.PART3.RAR.p7s']) assert.equal(esteVolumRar(n), true, n)
  for (const n of ['Planse.rar', 'part2.pdf', 'X.part2.zip']) assert.equal(esteVolumRar(n), false, n)

  const sus = { id: 1, nume_original: 'Caiet.pdf' }, dlArh = { id: 2, nume_original: 'Anexa.pdf' }, copilZip = { id: 3, nume_original: 'Plansa 1.pdf' }
  const copilWorker = { id: 4, nume_original: 'Breviar.pdf' }, cuSlash = { id: 5, nume_original: 'Lot2/Caiet.pdf' }, faraMan = { id: 6, nume_original: 'F.pdf' }
  const man = [
    { stare: 'urcat', document_id: 1, arhiva_cheie: 'caiet.pdf', cale: 'Caiet.pdf' },            // edge, nivelul de sus: cheie = lower(cale)
    { stare: 'urcat', document_id: 2, arhiva_cheie: 'seap:downloadarchive', cale: 'Anexa.pdf' }, // rezerva DownloadArchive
    { stare: 'urcat', document_id: 3, arhiva_cheie: 'docs.zip', cale: 'Plansa 1.pdf' },          // copil ZIP inline (edge)
    { stare: 'urcat', document_id: 4, arhiva_cheie: 'planse.rar', cale: 'sub/Breviar.pdf' },     // copil drumul SEAP (worker)
    { stare: 'deja_in_platforma', document_id: 6, arhiva_cheie: 'altul.zip', cale: 'F.pdf' },    // legătura „deja” nu e dovadă
  ]
  const copii = copiiDinManifest(man, [sus, dlArh, copilZip, copilWorker, cuSlash, faraMan])
  assert.deepEqual([...copii].sort(), [3, 4, 5])
})

Deno.test('decideSeap: fără cod → regula pe nume de azi (regresie: cheiSeap ∩ rândurile reale neschimbat)', () => {
  const inv = inv0([rand('Caiet (semnat).pdf'), rand('Anexa 1.pdf'), rand('Semnatura.pdf.p7s')])
  for (const n of ['Caiet.pdf.p7m', 'Anexa (1).pdf', 'Semnatura.pdf.p7s', 'Nou.pdf']) assert.deepEqual(decide(inv, [], { nume: n, cod: '' }), { fel: 'fara_cod' }, n)
  // cheile de azi: „X.pdf.p7m” găsește „X (semnat).pdf”; „Anexa (1).pdf” = „Anexa 1.pdf”; rândul brut „.p7s” e găsit de numele SEAP .p7s
  const urcate = new Set([...inv.peCheie.keys()])
  assert.deepEqual(['Caiet.pdf.p7m', 'Anexa (1).pdf', 'Semnatura.pdf.p7s', 'Semnatura.pdf', 'Nou.pdf'].map((n) => chei(n).some((k) => urcate.has(k))),
    [true, true, true, false, false])
})

Deno.test('decideSeap: siguranța instabilă, cod dublu, cod deja pe un rând (orice nume), placeholder, nimic', () => {
  const arhiva = rand('Raspuns consolidat.rar', P(40)), getAll = rand('Raspuns 1.pdf', P(58), { fisier_path: '3/atribuire/raspunsuri/x' })
  const ph = rand('Placeholder.pdf', P(41), { fisier_path: '3/atribuire/neincarcat/Placeholder.pdf' })
  const inv = inv0([arhiva, getAll, ph])
  const docs = [{ nume: 'Alt nume.rar', cod: P(40) }, { nume: 'Raspuns.pdf', cod: P(58) }, { nume: 'Placeholder.pdf', cod: P(41) }, { nume: 'Nou.pdf', cod: P(42) }]
  assert.deepEqual(pas(inv, docs, docs[0]), { fel: 'sari', motiv: 'cod', rand: inv.coduri.get(P(40)) })
  assert.deepEqual(pas(inv, docs, docs[1]).motiv, 'cod')
  assert.deepEqual(pas(inv, docs, docs[2]), { fel: 'nou', nume: 'Placeholder.pdf' })   // codul doar pe un placeholder nu contează
  assert.deepEqual(pas(inv, docs, docs[3]), { fel: 'nou', nume: 'Nou.pdf' })
  assert.deepEqual(decide(inv, docs, docs[3]), { fel: 'sari', motiv: 'dublu' })        // același cod în două liste SEAP
  const inst = inv0([rand('Caiet.pdf')]); inst.instabile = true
  assert.deepEqual(decide(inst, [{ nume: 'Caiet.pdf', cod: P(1) }], { nume: 'Caiet.pdf', cod: P(1) }), { fel: 'fara_cod' })
})

Deno.test('decideSeap: adopție pe nume (L1 = A) doar pe rândul unic de nivel de sus, fără coduri concurente', () => {
  const caiet = rand('Caiet de sarcini.pdf'), semnat = rand('Formular (semnat).pdf')
  const inv = inv0([caiet, semnat])
  const docs = [{ nume: 'Caiet de sarcini.pdf', cod: P(10) }, { nume: 'Formular.pdf.p7m', cod: P(11) }]
  assert.deepEqual(decide(inv, docs, docs[0]), { fel: 'adopta', rand: inv.peCheie.get(cheieRand('Caiet de sarcini.pdf'))[0] })
  assert.equal(decide(inv, docs, docs[1]).rand.id, semnat.id)   // var. B: „X.pdf.p7m” adoptă „X (semnat).pdf”
  // „.part2.rar” cu un singur rând vechi → adopție (nu versiune)
  const vol = inv0([rand('Planse.part2.rar')])
  assert.equal(decide(vol, [{ nume: 'Planse.part2.rar', cod: P(3) }], { nume: 'Planse.part2.rar', cod: P(3) }).fel, 'adopta')
})

Deno.test('decideSeap 4 = A: ≥2 coduri pe nume sau ≥2 rânduri vechi → niciodată adopție pe nume, ci verificare pe conținut', () => {
  // lic. 100: două documente cu numele IDENTIC (/00013 și /00017), un singur rând vechi fără cod (#507)
  const N = 'Documentatie modificare si optimizare solutie gaze ianuarie 2025.pdf'
  const r507 = rand(N, null, { id: 507 })
  const docs = [{ nume: N, cod: 'CN1096532/00013' }, { nume: N, cod: 'CN1096532/00017' }]
  let inv = inv0([r507])
  const d1 = pas(inv, docs, docs[0])
  assert.equal(d1.fel, 'verifica'); assert.equal(d1.motiv, 'ambiguu')
  assert.equal(d1.nume, 'Documentatie modificare si optimizare solutie gaze ianuarie 2025 (CN1096532-00013).pdf')
  assert.deepEqual(d1.candidati.map((r: Any) => r.id), [507])
  assert.deepEqual(d1.dupa, { fel: 'frate', nume: d1.nume, rude: [507] })
  // conținut identic cu #507 → codul pe #507; al doilea devine frate (adus, nu pierdut)
  const r1 = rezolvaVerificare(d1, A, new Map([[507, A]]))
  assert.deepEqual(r1, { fel: 'adopta', rand: inv.peCheie.get(cheieRand(N))[0] })
  r1.rand.seap_cod = 'CN1096532/00013'; inv.coduri.set('CN1096532/00013', r1.rand)
  assert.deepEqual(pas(inv, docs, docs[1]), { fel: 'frate', nume: numeVersiune(N, 'CN1096532/00017'), rude: [507] })
  // conținut diferit de #507 (dovedit) → frate; al doilea se verifică și el pe #507
  inv = inv0([r507])
  const d1b = pas(inv, docs, docs[0])
  const f = rezolvaVerificare(d1b, B, new Map([[507, A]]))
  assert.equal(f.fel, 'frate')
  adaugaRand(inv, { id: 900, nume_original: f.nume, fisier_path: '3/atribuire/y', seap_cod: 'CN1096532/00013', dinRulare: true })
  const d2b = pas(inv, docs, docs[1])
  assert.equal(d2b.motiv, 'ambiguu')
  assert.deepEqual(rezolvaVerificare(d2b, A, new Map([[507, A]])).rand.id, 507)
  // sha-ul candidatului nu s-a putut obține → rămâne pe nume (status quo), nu se ghicește
  assert.deepEqual(rezolvaVerificare(d1b, B, new Map([[507, null]])), { fel: 'sari', motiv: 'ambiguu' })

  // două rânduri vechi pe aceeași cheie, un singur cod → tot verificare
  const dublu = inv0([rand('Anexa 1.pdf'), rand('Anexa (1).pdf')])
  const dd = decide(dublu, [{ nume: 'Anexa 1.pdf', cod: P(5) }], { nume: 'Anexa 1.pdf', cod: P(5) })
  assert.equal(dd.motiv, 'ambiguu'); assert.equal(dd.candidati.length, 2)
  // cod rival pe cheia rândului („Anexa (1).pdf” și „Anexa 1.pdf” listate cu coduri diferite)
  const rival = inv0([rand('Anexa 1.pdf')])
  const lr = [{ nume: 'Anexa (1).pdf', cod: P(6) }, { nume: 'Anexa 1.pdf', cod: P(7) }]
  assert.equal(decide(rival, lr, lr[1]).motiv, 'ambiguu')
})

Deno.test('decideSeap: semnătura „.p7s” a unui document listat și el = sărită; codul ei e rival → documentul vechi cere dovadă, în ORICE ordine', () => {
  const docs = [{ nume: 'Caiet.pdf', cod: P(1) }, { nume: 'Caiet.pdf.p7s', cod: P(2) }]
  const invers = [docs[1], docs[0]]
  // rândul documentului + rândul brut al semnăturii (dinainte de B): documentul se verifică pe conținut, semnătura se sare
  for (const ordine of [docs, invers]) {
    const doc = rand('Caiet.pdf'), sem = rand('Caiet.pdf.p7s')
    const inv = inv0([doc, sem])
    const r = ordine.map((d) => pas(inv, docs, d))
    const dd = r[ordine.indexOf(docs[0])], ds = r[ordine.indexOf(docs[1])]
    assert.deepEqual([dd.fel, dd.motiv, dd.candidati.map((x: Any) => x.id)], ['verifica', 'ambiguu', [doc.id]])
    assert.deepEqual(ds, { fel: 'sari', motiv: 'semnatura' })
    assert.equal(rezolvaVerificare(dd, A, new Map([[doc.id, A]])).rand.id, doc.id)   // același conținut → codul pe rândul documentului
  }
  // review PR-1 (P1): un singur rând vechi „Caiet.pdf” — poate ține conținutul semnăturii (adusă întâi, înainte); „Caiet.pdf” C20 e
  // revizuirea. Înainte, cu documentul primul în listă, C20 se adopta pe nume și revizuirea nu se mai aducea niciodată.
  const L = [{ nume: 'Caiet.pdf', cod: P(20) }, { nume: 'Caiet.pdf.p7s', cod: P(7) }]
  for (const ordine of [L, [L[1], L[0]]]) {
    const vechi = rand('Caiet.pdf')
    const inv = inv0([vechi])
    const r = ordine.map((d) => pas(inv, L, d))
    const dd = r[ordine.indexOf(L[0])]
    assert.deepEqual([dd.fel, dd.motiv], ['verifica', 'ambiguu'], 'niciodată adopție pe nume')
    assert.equal(rezolvaVerificare(dd, A, new Map([[vechi.id, B]])).fel, 'frate')   // alt conținut dovedit → revizuirea se aduce
    assert.deepEqual(r[ordine.indexOf(L[1])], { fel: 'sari', motiv: 'semnatura' })
  }
  // licitație nouă: documentul se aduce, semnătura lui nu devine rând (azi o sărea regula pe nume) — în ambele ordini
  for (const ordine of [docs, invers]) {
    const inv = inv0([])
    const r = ordine.map((d) => pas(inv, docs, d))
    assert.deepEqual(r[ordine.indexOf(docs[0])], { fel: 'nou', nume: 'Caiet.pdf' })
    assert.deepEqual(r[ordine.indexOf(docs[1])], { fel: 'sari', motiv: 'semnatura' })
  }
  // „.p7s” FĂRĂ documentul nesemnat în listă = chiar documentul (semnătură atașată) → adopție pe rândul lui desfăcut
  const singur = [{ nume: 'Formular.pdf.p7s', cod: P(3) }]
  const fr = rand('Formular.pdf')
  assert.deepEqual(decide(inv0([fr]), singur, singur[0]).rand.id, fr.id)
  assert.equal(decide(inv0([]), singur, singur[0]).fel, 'nou')
  // „.p7m” nu e semnătura lui „X.pdf” (var. B: „X (semnat).pdf” e alt document) — nu se sare
  const p7m = [{ nume: 'X.pdf', cod: P(4) }, { nume: 'X.pdf.p7m', cod: P(5) }]
  assert.deepEqual(decide(inv0([]), p7m, p7m[1]), { fel: 'nou', nume: 'X.pdf.p7m' })
})

Deno.test('decideSeap: versiune (S = B) doar când codul vechi a ieșit din listă, cu același prefix și număr mai mic', () => {
  const v5 = rand('Caiet.pdf', P(5), { tip: 'cs_volum' }), v10 = rand('Caiet.pdf', P(10), { tip: 'cs_volum' })
  const inv = inv0([v5, v10, rand('Caiet.pdf')])   // + un duplicat vechi fără cod: versiunea are prioritate
  const d = decide(inv, [{ nume: 'Caiet.pdf', cod: P(36) }], { nume: 'Caiet.pdf', cod: P(36) })
  assert.equal(d.fel, 'versiune')
  assert.equal(d.nume, 'Caiet (CN1095546-00036).pdf')
  assert.equal(d.inlocuit.id, v10.id)   // cel mai mare număr
  // R2 (r4): toți candidații, în aceeași ordine (numărul cel mai mare primul); `inlocuit` rămâne primul
  assert.deepEqual(d.inlocuiti.map((r: Any) => r.id), [v10.id, v5.id])
  assert.equal(d.inlocuiti[0], d.inlocuit)
  // revizia veghei (GetAll /00058, număr MAI MARE) nu face din originalul listat /00010 o „versiune nouă” (bugul designului 1)
  const ga = rand('Caiet.pdf', P(58), { fisier_path: '3/atribuire/raspunsuri/CN_Caiet.pdf' })
  const g = inv0([ga])
  assert.deepEqual(decide(g, [{ nume: 'Caiet.pdf', cod: P(10) }], { nume: 'Caiet.pdf', cod: P(10) }), { fel: 'frate', nume: numeVersiune('Caiet.pdf', P(10)), rude: [ga.id] })
  // + rândul vechi al originalului, fără cod → îl adoptă (nu frate)
  const g2 = inv0([ga, rand('Caiet.pdf')])
  assert.equal(decide(g2, [{ nume: 'Caiet.pdf', cod: P(10) }], { nume: 'Caiet.pdf', cod: P(10) }).fel, 'adopta')
  // codul vechi încă listat → frate; alt prefix sau cod neparsabil → frate
  const lst = inv0([rand('Caiet.pdf', P(5))])
  const both = [{ nume: 'Caiet.pdf', cod: P(5) }, { nume: 'Caiet.pdf', cod: P(36) }]
  assert.equal(decide(lst, both, both[1]).fel, 'frate')
  assert.equal(decide(inv0([rand('Caiet.pdf', 'SCN9/00001')]), [{ nume: 'Caiet.pdf', cod: P(36) }], { nume: 'Caiet.pdf', cod: P(36) }).fel, 'frate')
  assert.equal(decide(inv0([rand('Caiet.pdf', P(5))]), [{ nume: 'Caiet.pdf', cod: 'FARA-NUMAR' }], { nume: 'Caiet.pdf', cod: 'FARA-NUMAR' }).fel, 'frate')
  // volum RAR: nu se versionează și nu primește frate
  const vol = inv0([rand('Planse.part2.rar', P(5))])
  assert.deepEqual(decide(vol, [{ nume: 'Planse.part2.rar', cod: P(9) }], { nume: 'Planse.part2.rar', cod: P(9) }), { fel: 'sari', motiv: 'volum' })
  const volF = inv0([rand('Planse.part2.rar', P(5))])
  const lv = [{ nume: 'Planse.part2.rar', cod: P(5) }, { nume: 'Planse.part2.rar', cod: P(9) }]
  assert.deepEqual(decide(volF, lv, lv[1]), { fel: 'sari', motiv: 'volum' })
})

Deno.test('decideSeap: un rând GetAll (canalul de clarificări) nu e niciodată „înlocuit” de lista principală — nici după ce workerul i-a mutat calea', () => {
  // review PR-1: GetAll /00005 „Caiet de sarcini.pdf” + același nume în lista principală /00010 + rândul vechi fără cod. Înainte: versiune
  // falsă (insigna ♻ + mail „versiunea veche NU mai e în vigoare”) și rândul vechi rămânea fără cod.
  const getAll = (cale: string, meta: Any) => rand('Caiet de sarcini.pdf', P(5), { fisier_path: cale, seap_meta: meta })
  for (const ga of [
    getAll('3/atribuire/raspunsuri/CN_Caiet.pdf', { titlu: null, publicat: '2026-10-01', inlocuieste: null }),
    getAll('3/atribuire/lx9_Caiet_de_sarcini.pdf', { titlu: null, publicat: null, semnat: { nume: 'Caiet de sarcini.pdf.p7m' } }),   // desfăcut pe loc de worker
  ]) {
    assert.equal(eGetAll(ga), true)
    const l = [{ nume: 'Caiet de sarcini.pdf', cod: P(10) }]
    const vechi = rand('Caiet de sarcini.pdf')
    assert.deepEqual(decide(inv0([ga, vechi]), l, l[0]), { fel: 'adopta', rand: inv0([vechi]).peCheie.get(cheieRand('Caiet de sarcini.pdf'))[0] })
    const f = decide(inv0([ga]), l, l[0])
    assert.equal(f.fel, 'frate')                                          // fără rând vechi: alt document cu același nume, adus tăcut
  }
  assert.equal(eGetAll(rand('X.pdf', P(1), { seap_meta: { cod_sursa: 'lista', cod: P(1) } })), false)
  assert.equal(eGetAll(rand('X.pdf', null, { seap_meta: null })), false)
})

Deno.test('decideSeap: linia versiunilor / fraților — a doua republicare înlocuiește ULTIMA versiune; republicarea unui frate e versiune', () => {
  assert.equal(numeBaza('Caiet (CN1095546-00036).pdf', 'CN1095546/00036'), 'Caiet.pdf')
  assert.equal(numeBaza('X (CN1-00002) (semnat).pdf', 'CN1/00002'), 'X (semnat).pdf')
  assert.equal(numeBaza('Caiet.pdf', 'CN1/00002'), null)
  assert.equal(numeBaza('(CN1-00002).pdf', 'CN1/00002'), null)
  // original /00010 → versiune /00036 → republicat din nou /00050 (ambele vechi au ieșit din listă)
  const orig = rand('Caiet.pdf', P(10), { tip: 'cs_volum' }), v36 = rand(numeVersiune('Caiet.pdf', P(36)), P(36), { tip: 'cs_volum' })
  const l = [{ nume: 'Caiet.pdf', cod: P(50) }]
  const d = decide(inv0([orig, v36]), l, l[0])
  assert.deepEqual([d.fel, d.nume, d.inlocuit.id], ['versiune', 'Caiet (CN1095546-00050).pdf', v36.id])
  assert.equal((campuriCod(P(50), d) as Any).seap_meta.inlocuieste, 'Caiet (CN1095546-00036).pdf')
  // lic. 100: #507 cu /00013 + fratele /00017; fratele republicat ca /00025 (/00017 a ieșit) → versiune a FRATELUI, nu alt frate tăcut
  const N = 'Documentatie modificare.pdf', C = (n: number) => `CN1096532/${String(n).padStart(5, '0')}`
  const r507 = rand(N, C(13)), frate = rand(numeVersiune(N, C(17)), C(17))
  const l2 = [{ nume: N, cod: C(13) }, { nume: N, cod: C(25) }]
  const inv = inv0([r507, frate])
  assert.deepEqual(pas(inv, l2, l2[0]).motiv, 'cod')
  const v = pas(inv, l2, l2[1])
  assert.deepEqual([v.fel, v.inlocuit.id], ['versiune', frate.id])
  // .p7m: versiunea desfăcută „X (C) (semnat).pdf” e găsită de numele SEAP „X.pdf.p7m”
  const vs = rand('X (CN1095546-00004) (semnat).pdf', P(4))
  const l3 = [{ nume: 'X.pdf.p7m', cod: P(9) }]
  assert.equal(decide(inv0([vs]), l3, l3[0]).inlocuit.id, vs.id)
})

Deno.test('decideSeap: rândul real FĂRĂ cod sub numele cu cod (placeholder completat de mână) primește codul — nu versiune / frate la nesfârșit', () => {
  // review PR-1 (P1): versiunea peste 20 MB n-o aduce edge-ul; omul o urcă sub numele exact al poziției → rând real fără cod
  const vechi = rand('Planse.pdf', P(10)), N2 = numeVersiune('Planse.pdf', P(36))
  const l = [{ nume: 'Planse.pdf', cod: P(36) }]
  const urcat = rand(N2)
  assert.deepEqual(decide(inv0([vechi, urcat]), l, l[0]), { fel: 'adopta', motiv: 'nume_cod', rand: inv0([urcat]).peCheie.get(cheieRand(N2))[0] })
  // placeholder-ul (încă neadus) nu e rând real → tot versiune (se reîncearcă)
  const ph = rand(N2, null, { fisier_path: `3/atribuire/neincarcat/${N2}` })
  assert.equal(decide(inv0([vechi, ph]), l, l[0]).fel, 'versiune')
  // .p7m: numele poziției e „X (C).pdf.p7m”, desfăcut „X (C) (semnat).pdf” — ambele se recunosc
  const lp = [{ nume: 'X.pdf.p7m', cod: P(36) }]
  for (const n of [numeVersiune('X.pdf.p7m', P(36)), 'X (CN1095546-00036) (semnat).pdf']) {
    const r = rand(n)
    assert.equal(decide(inv0([rand('X (semnat).pdf', P(10)), r]), lp, lp[0]).rand.id, r.id, n)
  }
  // un copil de arhivă cu numele ăsta nu e luat
  const copil = rand(N2)
  assert.equal(decide(inv0([vechi, copil], [{ stare: 'urcat', document_id: copil.id, arhiva_cheie: 'planse.zip', cale: N2 }]), l, l[0]).fel, 'versiune')
})

Deno.test('verificabil: fără dovadă și fără mărime la toți candidații vechi → nu se descarcă; copiii merg oricum la frate', () => {
  const x = rand('X.pdf', null, { size_bytes: null }), y = rand('X .pdf', null, { size_bytes: 0 })
  const dec = { fel: 'verifica', motiv: 'ambiguu', candidati: [x, y] }
  assert.equal(verificabil(dec, () => false), false)
  assert.equal(verificabil(dec, (r: Any) => r.id === y.id), true)
  assert.equal(verificabil({ ...dec, candidati: [x, rand('Y.pdf')] }, () => false), true)   // mărime cunoscută
  assert.equal(verificabil({ ...dec, motiv: 'copil' }, () => false), true)
  assert.equal(verificabil({ fel: 'frate' }, () => false), true)
  // „altă mărime” e o nepotrivire dovedită, nu o potrivire
  assert.equal(rezolvaVerificare({ ...dec, dupa: { fel: 'frate' } }, A, new Map([[x.id, ALT_CONTINUT], [y.id, ALT_CONTINUT]])).fel, 'frate')
})

Deno.test('decideSeap: copil de arhivă / rând din rularea curentă fără cod → verificare pe conținut, apoi frate', () => {
  const copil = rand('Plansa 1.pdf')
  const inv = inv0([copil], [{ stare: 'urcat', document_id: copil.id, arhiva_cheie: 'planse.zip', cale: 'Plansa 1.pdf' }])
  const d = decide(inv, [{ nume: 'Plansa 1.pdf', cod: P(8) }], { nume: 'Plansa 1.pdf', cod: P(8) })
  assert.deepEqual([d.fel, d.motiv, d.candidati.map((r: Any) => r.id)], ['verifica', 'copil', [copil.id]])
  assert.equal(d.dupa.fel, 'frate')
  // același conținut dovedit → codul pe copil; fără dovadă / alt conținut → frate (o dublură, nu o pierdere)
  assert.equal(rezolvaVerificare(d, A, new Map([[copil.id, A]])).fel, 'adopta')
  assert.equal(rezolvaVerificare(d, A, new Map()).fel, 'frate')
  assert.equal(rezolvaVerificare(d, A, new Map([[copil.id, B]])).fel, 'frate')
  // rândul scris în rularea asta (copil ZIP inline) — idem
  const inv2 = inv0([])
  adaugaRand(inv2, { id: 77, nume_original: 'Anexa.pdf', fisier_path: '3/atribuire/z', seap_cod: null, dinRulare: true })
  const d2 = decide(inv2, [{ nume: 'Anexa.pdf', cod: P(9) }], { nume: 'Anexa.pdf', cod: P(9) })
  assert.deepEqual([d2.fel, d2.motiv], ['verifica', 'copil'])
  // în aceeași rulare, două intrări cu același nume și coduri diferite: prima păstrează numele, a doua devine frate
  const inv3 = inv0([])
  const l3 = [{ nume: 'X.pdf', cod: P(1) }, { nume: 'X.pdf', cod: P(2) }]
  assert.deepEqual(pas(inv3, l3, l3[0]), { fel: 'nou', nume: 'X.pdf' })
  adaugaRand(inv3, { id: 78, nume_original: 'X.pdf', fisier_path: '3/atribuire/x', seap_cod: P(1), dinRulare: true })
  assert.deepEqual(pas(inv3, l3, l3[1]), { fel: 'frate', nume: numeVersiune('X.pdf', P(2)), rude: [78] })
})

Deno.test('decideSeap: politicile de adopție (ADOPTIE) — niciuna / sha', () => {
  const inv = inv0([rand('Caiet.pdf')])
  const l = [{ nume: 'Caiet.pdf', cod: P(1) }]
  assert.deepEqual(decide(inv, l, l[0], { adoptie: 'niciuna' }), { fel: 'sari', motiv: 'nume' })
  const s = decide(inv, l, l[0], { adoptie: 'sha' })
  assert.deepEqual([s.fel, s.motiv, s.candidati.length], ['verifica', 'sha', 1])
  assert.deepEqual(rezolvaVerificare(s, A, new Map([[s.candidati[0].id, null]])), { fel: 'sari', motiv: 'ambiguu' })
})

Deno.test('coduriInstabile: doar fără niciun cod cunoscut și ≥3 nume pe rânduri cu coduri ieșite din listă FĂRĂ model de republicare', () => {
  const vechi = [rand('A.pdf', 'CN9/00011'), rand('B.pdf', 'CN9/00012'), rand('C.pdf', 'CN9/00013')]
  // codurile au alt prefix (schema SEAP schimbată) → toate ar deveni „frați” → siguranța sare
  const altPrefix = [{ nume: 'A.pdf', cod: 'SCN9/00001' }, { nume: 'B.pdf', cod: 'SCN9/00002' }, { nume: 'C.pdf', cod: 'SCN9/00003' }]
  const inv = inv0(vechi)
  assert.match(String(coduriInstabile(inv, indexLista(altPrefix, chei), altPrefix, chei)), /instabile/)
  // numere mai MICI decât codurile vechi sau neparsabile → la fel
  const maiMici = [{ nume: 'A.pdf', cod: 'CN9/00001' }, { nume: 'B.pdf', cod: 'CN9/00002' }, { nume: 'C.pdf', cod: 'CN9/00003' }]
  assert.match(String(coduriInstabile(inv, indexLista(maiMici, chei), maiMici, chei)), /instabile/)
  const fara = [{ nume: 'A.pdf', cod: 'X' }, { nume: 'B.pdf', cod: 'Y' }, { nume: 'C.pdf', cod: 'Z' }]
  assert.match(String(coduriInstabile(inv, indexLista(fara, chei), fara, chei)), /instabile/)
  // review PR-1: republicarea INTEGRALĂ legitimă (același prefix, numere mai mari, vechile au ieșit) NU sare — devin versiuni
  const repub = [{ nume: 'A.pdf', cod: 'CN9/00021' }, { nume: 'B.pdf', cod: 'CN9/00022' }, { nume: 'C.pdf', cod: 'CN9/00023' }]
  assert.equal(coduriInstabile(inv, indexLista(repub, chei), repub, chei), null)
  for (const d of repub) assert.equal(decide(inv0(vechi), repub, d).fel, 'versiune', d.nume)
  // un cod listat e cunoscut → stabil
  const cu = [...altPrefix, { nume: 'A.pdf', cod: 'CN9/00011' }]
  assert.equal(coduriInstabile(inv, indexLista(cu, chei), cu, chei), null)
  // sub 3 lovituri / sub 3 documente cu cod → stabil
  assert.equal(coduriInstabile(inv0(vechi.slice(0, 2)), indexLista(altPrefix, chei), altPrefix, chei), null)
  assert.equal(coduriInstabile(inv, indexLista(altPrefix.slice(0, 2), chei), altPrefix.slice(0, 2), chei), null)
  // rândurile canalului de clarificări (GetAll) au coduri legitim absente din listă → nu declanșează (și după mutarea căii de worker)
  const ga = vechi.map((r) => ({ ...r, id: r.id + 1000, fisier_path: '3/atribuire/raspunsuri/x' }))
  assert.equal(coduriInstabile(inv0(ga), indexLista(altPrefix, chei), altPrefix, chei), null)
  const gaMutat = vechi.map((r) => ({ ...r, id: r.id + 2000, fisier_path: '3/atribuire/lx_x.pdf', seap_meta: { publicat: null, semnat: {} } }))
  assert.equal(coduriInstabile(inv0(gaMutat), indexLista(altPrefix, chei), altPrefix, chei), null)
  // rânduri vechi FĂRĂ cod (prima rulare după deploy) → stabil
  assert.equal(coduriInstabile(inv0([rand('A.pdf'), rand('B.pdf'), rand('C.pdf')]), indexLista(altPrefix, chei), altPrefix, chei), null)
})

Deno.test('rezolvaVerificare: prima potrivire câștigă; desfăcut sau brut; nepotrivire dovedită pe toți → dupa', () => {
  const x = rand('X.pdf'), y = rand('X .pdf')
  const dec = { fel: 'verifica', motiv: 'ambiguu', nume: 'X (C).pdf', candidati: [x, y], dupa: { fel: 'frate', nume: 'X (C).pdf', rude: [x.id, y.id] } }
  assert.equal(rezolvaVerificare(dec, [A, B], new Map([[x.id, C], [y.id, B]])).rand.id, y.id)
  assert.equal(rezolvaVerificare(dec, A, new Map([[x.id, null], [y.id, A]])).rand.id, y.id)   // potrivirea bate necunoscutul
  assert.equal(rezolvaVerificare(dec, A, new Map([[x.id, B], [y.id, C]])).fel, 'frate')
  assert.deepEqual(rezolvaVerificare(dec, A, new Map([[x.id, B]])), { fel: 'sari', motiv: 'ambiguu' })
})

Deno.test('campuriCod / tipMostenit', () => {
  assert.deepEqual(campuriCod(P(1), { fel: 'nou', nume: 'X.pdf' }), { seap_cod: P(1), seap_meta: { cod_sursa: 'lista', cod: P(1) } })
  const inl = { id: 12, nume_original: 'Caiet.pdf', seap_cod: P(10), tip: 'cs_volum' }
  assert.deepEqual(campuriCod(P(36), { fel: 'versiune', nume: 'Caiet (C).pdf', inlocuit: inl }), {
    seap_cod: P(36), tip: 'cs_volum', aparut_ulterior: true,
    seap_meta: { cod_sursa: 'lista', cod: P(36), cod_anterior: P(10), inlocuieste: 'Caiet.pdf', inlocuieste_id: 12, de_anuntat: true },   // M = A: veghea o anunță
  })
  for (const t of ['alta', 'raspuns_clarificare', null]) {
    const c = campuriCod(P(36), { fel: 'versiune', inlocuit: { ...inl, tip: t } })
    assert.equal('tip' in c, false, String(t)); assert.equal(c.aparut_ulterior, true)
  }
  assert.equal('tip' in campuriCod(P(36), { fel: 'versiune', inlocuit: inl }, { esteArhiva: true }), false)   // arhiva = container
  assert.deepEqual(campuriCod(P(2), { fel: 'frate', nume: 'X (C).pdf', rude: [3, 4] }), { seap_cod: P(2), seap_meta: { cod_sursa: 'lista', cod: P(2), frate_cu: [3, 4] } })
  assert.deepEqual(campuriCod(P(2), { fel: 'fara_cod' }), {})
  assert.deepEqual(campuriCod('', { fel: 'nou' }), {})
  assert.equal(tipMostenit('lista_cantitati', false), 'lista_cantitati')
  assert.equal(tipMostenit('lista_cantitati', true), null)
  assert.equal(tipMostenit(undefined, false), null)
})

Deno.test('eDuplicatCod: indexul unic al codului, cu sau fără code 23505; alt index / nimic → false', () => {
  const msg = `duplicate key value violates unique constraint "${INDEX_COD_UNIC}"`
  assert.equal(eDuplicatCod({ code: '23505', message: msg }), true)
  assert.equal(eDuplicatCod({ message: msg }), true)                                    // fake-ul workerului: doar mesajul
  assert.equal(eDuplicatCod({ code: '23505', message: 'x', details: `Key (licitatie_id, seap_cod)=(3, X) already exists. ${INDEX_COD_UNIC}` }), true)
  assert.equal(eDuplicatCod({ code: '23505', message: 'duplicate key value violates unique constraint "ofertare_seap_manifest_pkey"' }), false)
  assert.equal(eDuplicatCod({ code: '42501', message: `permission denied ${INDEX_COD_UNIC}` }), false)
  assert.equal(eDuplicatCod(null), false)
})

// clientul simulat pentru adoptaCod: verifică filtrele UPDATE-ului condiționat
function fakeSupa(rezultat: Any) {
  const apel: Any = { filtre: [] as string[] }
  const b: Any = {
    update: (p: Any) => { apel.patch = p; return b },
    eq: (c: string, v: unknown) => { apel.filtre.push(`eq ${c}=${v}`); return b },
    is: (c: string, v: unknown) => { apel.filtre.push(`is ${c}=${v}`); return b },
    select: (c: string) => { apel.select = c; return typeof rezultat === 'function' ? rezultat() : Promise.resolve(rezultat) },
  }
  return { supa: { from: (t: string) => { apel.tabel = t; return b } }, apel }
}

Deno.test('adoptaCod: UPDATE condiționat (id + licitație + încă fără cod); adoptat / ocupat / duplicat / eroare; nu aruncă', async () => {
  const r = rand('Caiet.pdf'); const inv = inv0([r]); const ri = inv.peCheie.get(cheieRand('Caiet.pdf'))[0]
  const { supa, apel } = fakeSupa({ data: [{ id: r.id }], error: null })
  assert.equal(await adoptaCod(supa, 3, inv, ri, ` ${P(1)} `), 'adoptat')
  assert.deepEqual([apel.tabel, apel.patch, apel.filtre, apel.select], ['ofertare_documente_atribuire', { seap_cod: P(1) }, [`eq id=${r.id}`, 'eq licitatie_id=3', 'is seap_cod=null'], 'id'])
  assert.equal(ri.seap_cod, P(1)); assert.equal(inv.coduri.get(P(1)), ri)
  const r2 = rand('B.pdf'); const inv2 = inv0([r2]); const ri2 = inv2.peCheie.get(cheieRand('B.pdf'))[0]
  assert.equal(await adoptaCod(fakeSupa({ data: [], error: null }).supa, 3, inv2, ri2, P(2)), 'ocupat')
  assert.equal(ri2.seap_cod, null); assert.equal(inv2.coduri.size, 0)
  assert.equal(await adoptaCod(fakeSupa({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${INDEX_COD_UNIC}"` } }).supa, 3, inv2, ri2, P(2)), 'duplicat')
  assert.deepEqual(await adoptaCod(fakeSupa({ data: null, error: { code: '57014', message: 'timeout' } }).supa, 3, inv2, ri2, P(2)), { eroare: 'timeout' })
  assert.deepEqual(await adoptaCod(fakeSupa(() => Promise.reject(new Error('rețea'))).supa, 3, inv2, ri2, P(2)), { eroare: 'rețea' })
  assert.equal(inv2.coduri.size, 0)
})

Deno.test('mutaCod (F5): republicat identic — UPDATE condiționat pe codul VECHI; mutat / ocupat / duplicat / eroare; nu aruncă', async () => {
  // rândul înlocuit (versiunea) ține codul vechi; documentul listat are exact conținutul lui sub cod nou
  const r = rand('Caiet.pdf', P(10)); const inv = inv0([r]); const ri = inv.coduri.get(P(10))
  const { supa, apel } = fakeSupa({ data: [{ id: r.id }], error: null })
  assert.equal(await mutaCod(supa, 3, inv, ri, P(10), ` ${P(36)} `), 'mutat')
  assert.deepEqual([apel.tabel, apel.patch, apel.filtre, apel.select], ['ofertare_documente_atribuire', { seap_cod: P(36) }, [`eq id=${r.id}`, 'eq licitatie_id=3', `eq seap_cod=${P(10)}`], 'id'])
  assert.equal(ri.seap_cod, P(36)); assert.equal(inv.coduri.get(P(36)), ri); assert.equal(inv.coduri.has(P(10)), false)
  // după mutare, documentul listat (P36) e sărit pe cod, fără descărcare; codul vechi nu mai e al nimănui
  assert.deepEqual(decide(inv, [{ nume: 'Caiet.pdf', cod: P(36) }], { nume: 'Caiet.pdf', cod: P(36) }), { fel: 'sari', motiv: 'cod', rand: ri })
  // 0 rânduri: codul rândului s-a schimbat între timp (alt drum) → 'ocupat', inventarul neatins
  const r2 = rand('B.pdf', P(20)); const inv2 = inv0([r2]); const ri2 = inv2.coduri.get(P(20))
  assert.equal(await mutaCod(fakeSupa({ data: [], error: null }).supa, 3, inv2, ri2, P(20), P(21)), 'ocupat')
  assert.deepEqual([ri2.seap_cod, [...inv2.coduri.keys()]], [P(20), [P(20)]])
  assert.equal(await mutaCod(fakeSupa({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${INDEX_COD_UNIC}"` } }).supa, 3, inv2, ri2, P(20), P(21)), 'duplicat')
  assert.deepEqual(await mutaCod(fakeSupa({ data: null, error: { code: '57014', message: 'timeout' } }).supa, 3, inv2, ri2, P(20), P(21)), { eroare: 'timeout' })
  assert.deepEqual(await mutaCod(fakeSupa(() => Promise.reject(new Error('rețea'))).supa, 3, inv2, ri2, P(20), P(21)), { eroare: 'rețea' })
  assert.deepEqual([ri2.seap_cod, [...inv2.coduri.keys()]], [P(20), [P(20)]])
})

Deno.test('mutaPeIdentic (D1, F5 îngustat): doar înlocuitul FĂRĂ nume de cod și fără placeholder pe N2; versiunea / fratele / adoptatul pe N2 rămân pe codul lor', () => {
  // originalul (și adoptatul pe nume, L1 = A) → mutabil; cu placeholder pe N2 (veghea a anunțat deja) → nu (îl completează F1)
  const o = rand('Caiet.pdf', P(10)); const inv = inv0([o])
  const d = decide(inv, [{ nume: 'Caiet.pdf', cod: P(36) }], { nume: 'Caiet.pdf', cod: P(36) })
  assert.deepEqual([d.fel, d.inlocuit.id], ['versiune', o.id])
  assert.deepEqual([mutaPeIdentic(d.inlocuit, false), mutaPeIdentic(d.inlocuit, true)], [true, false])
  // linia versiunilor: înlocuitul e ultima versiune „Caiet (CN…-00036).pdf” → NU (codul e în numele ei; mutat, linia s-ar rupe)
  const v = rand('Caiet (CN1095546-00036).pdf', P(36)); const inv2 = inv0([rand('Caiet.pdf', P(10)), v])
  const d2 = decide(inv2, [{ nume: 'Caiet.pdf', cod: P(50) }], { nume: 'Caiet.pdf', cod: P(50) })
  assert.deepEqual([d2.fel, d2.inlocuit.id, mutaPeIdentic(d2.inlocuit, false)], ['versiune', v.id, false])
  // nume cu cod după desfacere, frate, rând adoptat pe N2 (motiv nume_cod) → nu; nume vechi / „(semnat)” fără cod în nume → da
  assert.equal(mutaPeIdentic(rand('X (CN1-00002) (semnat).pdf', 'CN1/00002'), false), false)
  assert.equal(mutaPeIdentic(rand('Planse (CN1095546-00036).pdf', P(36)), false), false)
  assert.equal(mutaPeIdentic(rand('Caiet (semnat).pdf', P(10)), false), true)
  assert.equal(mutaPeIdentic(rand('Caiet (CN1095546-00036).pdf', ` ${P(36)} `), false), false)   // codul tăiat, ca în inventar
})

Deno.test('candidatiMutare (R2, r4): fiecare înlocuit mutabil, în ordinea lui decideSeap; fără nume de cod, fără placeholder pe N2, fără ținte deja folosite', () => {
  // frați cu același nume, ambii FĂRĂ cod în nume (lic. 100: rânduri vechi adoptate prin dovadă de conținut), plus versiunea unuia
  const a = rand('Anexa 1.pdf', P(5)), b = rand('Anexa (1).pdf', P(6)), v = rand(numeVersiune('Anexa 1.pdf', P(7)), P(7))
  const l = [{ nume: 'Anexa 1.pdf', cod: P(20) }]
  const d = decide(inv0([a, b, v]), l, l[0])
  assert.deepEqual([d.fel, d.inlocuit.id, d.inlocuiti.map((r: Any) => r.id)], ['versiune', v.id, [v.id, b.id, a.id]])
  // versiunea cu nume de cod iese (linia versiunilor, D1); E1 (r5): fiind MAI NOUĂ (/7) decât frații (/5, /6), nici ei nu mai sunt
  // ținte — o republicare cu conținutul lor ar fi o revenire la un conținut vechi, anunțată ca versiune
  assert.deepEqual(candidatiMutare(d, false), [])
  // fără versiunea cu nume de cod: frații rămân, în ordine (R2)
  const d0 = decide(inv0([a, b]), l, l[0])
  assert.deepEqual(candidatiMutare(d0, false).map((r: Any) => r.id), [b.id, a.id])
  assert.deepEqual(candidatiMutare(d0, false, new Set([b.id])).map((r: Any) => r.id), [a.id])   // ținta deja folosită în rulare
  assert.deepEqual(candidatiMutare(d0, false, new Set([a.id, b.id])), [])
  assert.deepEqual(candidatiMutare(d0, true), [])                                                   // placeholder pe N2: F1, nu mutare
  // altă decizie → nimic; forma veche (doar `inlocuit`) → el, dacă e mutabil
  assert.deepEqual(candidatiMutare({ fel: 'frate', rude: [a.id] }, false), [])
  assert.deepEqual(candidatiMutare(null, false), [])
  assert.deepEqual(candidatiMutare({ fel: 'versiune', inlocuit: a }, false), [a])
  assert.deepEqual(candidatiMutare({ fel: 'versiune', inlocuit: v }, false), [])
})

Deno.test('E1 (r5, Jakarinos P1): revenirea la un conținut MAI VECHI se anunță — originalul cu o versiune mai nouă cu nume de cod nu e țintă de mutare', () => {
  // v1 „Caiet.pdf” /10 (conținut A), v2 „Caiet (CN…-00020).pdf” /20 (conținut B); SEAP republică /30 cu conținutul A
  const v1 = rand('Caiet.pdf', P(10)), v2 = rand(numeVersiune('Caiet.pdf', P(20)), P(20))
  const l = [{ nume: 'Caiet.pdf', cod: P(30) }]
  const d = decide(inv0([v1, v2]), l, l[0])
  assert.deepEqual([d.fel, d.inlocuit.id, d.inlocuiti.map((r: Any) => r.id)], ['versiune', v2.id, [v2.id, v1.id]])
  // capul liniei e v2 (nume de cod, D1 îl ține pe codul lui); v1 are un cap mai nou → nicio țintă: versiune anunțată (de_anuntat)
  assert.deepEqual(candidatiMutare(d, false), [])
  assert.equal((campuriCod(P(30), d) as Any).seap_meta.de_anuntat, true)
  // originalul FĂRĂ versiune mai nouă rămâne țintă (F5 neschimbat); la fel cu un cap mai VECHI decât el (număr mai mic)
  const o = rand('Plan.pdf', P(10))
  const dO = decide(inv0([o]), [{ nume: 'Plan.pdf', cod: P(30) }], { nume: 'Plan.pdf', cod: P(30) })
  assert.deepEqual(candidatiMutare(dO, false).map((r: Any) => r.id), [o.id])
  const vechi = rand(numeVersiune('Anexa.pdf', P(3)), P(3)), nou = rand('Anexa.pdf', P(12))
  const dV = decide(inv0([vechi, nou]), [{ nume: 'Anexa.pdf', cod: P(30) }], { nume: 'Anexa.pdf', cod: P(30) })
  assert.deepEqual(candidatiMutare(dV, false).map((r: Any) => r.id), [nou.id])
  // lic. 100 (frați FĂRĂ nume de cod, republicați integral identic): toți rămân ținte, ca la R2
  const f13 = rand('Doc.pdf', P(13)), f17 = rand('Doc.pdf', P(17))
  const dF = decide(inv0([f13, f17]), [{ nume: 'Doc.pdf', cod: P(25) }], { nume: 'Doc.pdf', cod: P(25) })
  assert.deepEqual(candidatiMutare(dF, false).map((r: Any) => r.id), [f17.id, f13.id])
})

Deno.test('R2 (r4): frați republicați integral IDENTIC — fiecare cod se mută pe rândul lui (nu pe înlocuit[0]), un rând = o singură țintă', async () => {
  // două rânduri cu același nume (#507 /00013 și #508 /00017, conținut diferit); SEAP le republică pe amândouă sub /00025 și /00026,
  // în ordinea inversă numerelor: /00025 are conținutul lui /00013 (care e inlocuiti[1], nu [0])
  const N = 'Documentatie modificare.pdf', C = (n: number) => `CN1096532/${String(n).padStart(5, '0')}`
  const r13 = rand(N, C(13)), r17 = rand(N, C(17))
  const continut = new Map<number, string>([[r13.id, A], [r17.id, B]])
  const l = [{ nume: N, cod: C(25) }, { nume: N, cod: C(26) }]
  const shaDoc = new Map<string, string>([[C(25), A], [C(26), B]])
  const inv = inv0([r13, r17]), folosite = new Set<number>(), mutate: [number, string][] = []
  for (const doc of l) {
    const d = pas(inv, l, doc)
    assert.equal(d.fel, 'versiune', doc.cod)
    // ca importul: dovada pe FIECARE candidat mutabil, prima potrivire câștigă
    const inl: Any = candidatiMutare(d, false, folosite).find((r: Any) => continut.get(r.id) === shaDoc.get(doc.cod))
    assert.ok(inl, doc.cod)
    folosite.add(inl.id)
    const { supa } = fakeSupa({ data: [{ id: inl.id }], error: null })
    assert.equal(await mutaCod(supa, 3, inv, inl, inl.seap_cod, doc.cod), 'mutat')
    mutate.push([inl.id, doc.cod])
  }
  assert.deepEqual(mutate, [[r13.id, C(25)], [r17.id, C(26)]])
  assert.deepEqual([inv.peId.get(r13.id).seap_cod, inv.peId.get(r17.id).seap_cod], [C(25), C(26)])
  // a doua rulare (BD după mutări): ambele coduri sărite pe cod, fără descărcare
  const inv2 = inv0([{ ...r13, seap_cod: C(25) }, { ...r17, seap_cod: C(26) }])
  for (const doc of l) assert.equal(pas(inv2, l, doc).motiv, 'cod')
  // fără R2 (doar înlocuit[0]): /00025 s-ar fi comparat doar cu /00017 → nepotrivire → versiune falsă + anunț
  const d0 = decide(inv0([rand(N, C(13)), rand(N, C(17))]), l, l[0])
  assert.equal(d0.inlocuit.seap_cod, C(17))
  // o mutare eșuată ('ocupat': rândul păstrează codul vechi în inventar) nu lasă al doilea document pe același rând
  const s13 = rand(N, C(13)), s17 = rand(N, C(17))
  const inv3 = inv0([s13, s17]), f3 = new Set<number>()
  const d1 = pas(inv3, l, l[0]), t1: Any = candidatiMutare(d1, false, f3).find((r: Any) => r.id === s13.id)
  f3.add(t1.id)
  assert.equal(await mutaCod(fakeSupa({ data: [], error: null }).supa, 3, inv3, t1, C(13), C(25)), 'ocupat')
  const d2 = pas(inv3, l, l[1])
  assert.deepEqual(d2.inlocuiti.map((r: Any) => r.id), [s17.id, s13.id])   // s13 e încă înlocuit posibil (cod vechi, ieșit din listă)
  assert.deepEqual(candidatiMutare(d2, false, f3).map((r: Any) => r.id), [s17.id])
})

Deno.test('inventarCod / indexLista: doar rândurile reale, coduri tăiate; lista pe cheia de nume', () => {
  const inv = inv0([rand('A.pdf', ' CN1/00001 '), rand('B.pdf', null, { fisier_path: '3/atribuire/neincarcat/B.pdf' }), rand('C.pdf', null, { fisier_path: null })])
  assert.deepEqual([...inv.coduri.keys()], ['CN1/00001'])
  assert.deepEqual([...inv.peCheie.keys()], ['a.pdf'])
  const l = indexLista([{ nume: 'Anexa (1).pdf', cod: 'X/1' }, { nume: 'Anexa 1.pdf', cod: ' X/2 ' }, { nume: 'Fara.pdf', cod: '' }], cheieRand)
  assert.deepEqual([...l.toate], ['X/1', 'X/2'])
  assert.deepEqual([...(l.peCheie.get('anexa1.pdf') ?? [])], ['X/1', 'X/2'])
  assert.equal(l.peCheie.has('fara.pdf'), false)
  // cu cheiSeap: „X.pdf.p7s” stă și pe „x.pdf” (rival cu „X.pdf”), iar „simple” ține doar documentele nesemnate .p7s
  const l2 = indexLista([{ nume: 'X.pdf', cod: 'C/1' }, { nume: 'X.pdf.p7s', cod: 'C/2' }, { nume: 'Y.pdf.p7s', cod: 'C/3' }], chei)
  assert.deepEqual([...(l2.peCheie.get('x.pdf') ?? [])], ['C/1', 'C/2'])
  assert.deepEqual([...(l2.peCheie.get('x.pdf.p7s') ?? [])], ['C/2'])
  assert.deepEqual([...l2.simple], ['x.pdf'])
  // un rând versiune / frate stă și pe cheia numelui SEAP (linia lui), cu id-ul în peId
  const iv = inv0([rand('Caiet (CN1095546-00036).pdf', P(36), { id: 4242 })])
  assert.deepEqual([...iv.peCheie.keys()].sort(), ['caiet.pdf', 'caietcn1095546-00036.pdf'])
  assert.equal(iv.peId.get(4242).seap_cod, P(36))
})

Deno.test('Jakarinos r7 (P1): doar CAPUL liniei poate fi înlocuit — original → versiune (încă listată) + cod nou cu același nume = FRATE, nu versiune a originalului', () => {
  // „Caiet.pdf” /10 → „Caiet (…00020).pdf” /20 (versiunea lui, cu seap_meta ca la import); SEAP păstrează /20 și adaugă /30
  const orig = rand('Caiet.pdf', P(10))
  const v20 = rand(numeVersiune('Caiet.pdf', P(20)), P(20), { seap_meta: { cod_sursa: 'lista', cod: P(20), cod_anterior: P(10), inlocuieste: 'Caiet.pdf', inlocuieste_id: orig.id } })
  const l = [{ nume: 'Caiet.pdf', cod: P(20) }, { nume: 'Caiet.pdf', cod: P(30) }]
  const inv = inv0([orig, v20])
  assert.equal(pas(inv, l, l[0]).motiv, 'cod')
  const d = pas(inv, l, l[1])
  assert.deepEqual([d.fel, d.nume], ['frate', 'Caiet (CN1095546-00030).pdf'])
  assert.equal((campuriCod(P(30), d) as Any).seap_meta.de_anuntat, undefined)   // fără anunț de „versiune”
  // capul /20 a ieșit din listă → versiune a CAPULUI (originalul înlocuit deja nu mai e candidat)
  const l2 = [{ nume: 'Caiet.pdf', cod: P(30) }]
  const d2 = decide(inv0([orig, v20]), l2, l2[0])
  assert.deepEqual([d2.fel, d2.inlocuit.id, d2.inlocuiti.map((r: Any) => r.id)], ['versiune', v20.id, [v20.id]])
  // doar cod_anterior (fără id) ajunge la fel
  const v20b = rand(numeVersiune('Caiet.pdf', P(20)), P(20), { seap_meta: { cod_anterior: P(10) } })
  assert.equal(decide(inv0([rand('Caiet.pdf', P(10)), v20b]), l, l[1]).fel, 'frate')
  // o versiune adusă în ACEEAȘI rulare (adaugaRand din import) marchează și ea înlocuitul
  const inv3 = inv0([orig])
  adaugaRand(inv3, { id: 990, nume_original: numeVersiune('Caiet.pdf', P(20)), fisier_path: '3/atribuire/v', seap_cod: P(20), dinRulare: true, inlocuieste_id: orig.id, cod_anterior: P(10) })
  assert.equal(decide(inv3, l, l[1]).fel, 'frate')
  // lic. 100 (frați fără relație de înlocuire): /13 ieșit din listă → versiune a lui /13, ca înainte
  const f13 = rand('Doc.pdf', P(13)), f17 = rand(numeVersiune('Doc.pdf', P(17)), P(17), { seap_meta: { cod_sursa: 'lista', cod: P(17), frate_cu: [f13.id] } })
  const l4 = [{ nume: 'Doc.pdf', cod: P(17) }, { nume: 'Doc.pdf', cod: P(25) }]
  const inv4 = inv0([f13, f17])
  pas(inv4, l4, l4[0])
  const d4 = pas(inv4, l4, l4[1])
  assert.deepEqual([d4.fel, d4.inlocuit.id], ['versiune', f13.id])
})
