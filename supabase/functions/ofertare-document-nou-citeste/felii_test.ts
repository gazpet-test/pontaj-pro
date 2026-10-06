// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/felii_test.ts
// Rezumatul pe felii (Răcari, 06.10.2026): împărțire fără pierderi, la granița întrebărilor; combinarea feliilor.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cheieIntrebare, combinaFelii, graniteSigure, imparteCuGranite, imparteInFelii, MAX_FELIE, parteDinAi, type Parte } from './felii.ts'

// Un „răspuns consolidat” ca la Răcari: 38 de perechi „Solicitarea nr. k” / „Răspuns solicitarea nr. k”, ~1.800 caractere fiecare.
function racari(nr = 38) {
  let t = '⟦PAGINA 1⟧\nORASUL RACARI\nRĂSPUNS CONSOLIDAT NR. 2\n\n'
  for (let k = 1; k <= nr; k++) {
    if (k % 2 === 0) t += `⟦PAGINA ${k / 2 + 1}⟧\n`
    t += `Solicitarea nr. ${k}:\n${'Întrebare despre devizul MM108, teava de protecție. '.repeat(18)}\n\nRăspuns solicitarea nr. ${k}:\n${'Se va oferta conform listei de cantități. '.repeat(14)}\n\n`
  }
  return t
}

Deno.test('Răcari (38 de perechi): felii ≤ MAX_FELIE, fără pierderi, fiecare felie (după prima) începe la o întrebare — perechile nu se rup', () => {
  const t = racari()
  const f = imparteInFelii(t)
  assert(f.length >= 3, `felii: ${f.length}`)
  assertEquals(f.join(''), t)
  for (const x of f) assert(x.length <= MAX_FELIE)
  for (const x of f.slice(1)) assert(/^Solicitarea nr\. \d+/.test(x), x.slice(0, 40))
  for (const x of f) {   // în fiecare felie: fiecare „Solicitarea nr. k” are și „Răspuns solicitarea nr. k”
    for (const m of x.matchAll(/^Solicitarea nr\. (\d+)/gm)) assert(x.includes(`Răspuns solicitarea nr. ${m[1]}:`), `perechea ${m[1]} ruptă`)
  }
  const g = imparteCuGranite(t)
  assertEquals([g.granite.length, graniteSigure(g.granite)], [f.length - 1, true])   // Răcari: toate tăieturile la întrebări → citire completă
  assertEquals(g.la, g.felii.slice(0, -1).map((_, k) => g.felii.slice(0, k + 1).join('').length))
})

// Copilot conv. 3 (NO-GO P1 pe d459447): întrebarea începe în PRIMA jumătate a ferestrei, răspunsul trece peste un ⟦PAGINA N⟧, iar în a
// doua jumătate nu mai e nicio întrebare. Înainte: tăietură la pagină, perechea ruptă, citirea „completă”. Acum: tăietura e la întrebare.
Deno.test('Copilot P1: întrebare în prima jumătate + răspuns peste un salt de pagină → tăietura cade la întrebare, perechea rămâne întreagă', () => {
  const t = 'Introducere. '.repeat(400) + '\nSolicitarea nr. 7:\nCe diametru are conducta?\n\nRăspuns solicitarea nr. 7:\n' + 'Diametrul este DN 110. '.repeat(250) +
    '\n⟦PAGINA 4⟧\n' + 'continuarea răspunsului 7. '.repeat(200) + '\n\nSolicitarea nr. 8:\nAlta?\nRăspuns solicitarea nr. 8:\nDa.\n'
  const q7 = t.indexOf('Solicitarea nr. 7')
  assert(q7 > MAX_FELIE / 5 && q7 < MAX_FELIE / 2, `poziția întrebării: ${q7}`)
  const g = imparteCuGranite(t)
  assertEquals(g.felii.join(''), t)
  assertEquals([g.granite[0], g.la[0]], ['intrebare', q7])
  assert(g.felii[1].includes('Ce diametru are conducta?') && g.felii[1].includes('continuarea răspunsului 7'), 'perechea 7 ruptă')
  assert(graniteSigure(g.granite))
})

Deno.test('o pereche mai lungă decât felia / text fără întrebări → tăietură la pagină sau rând, marcată nesigură (citire necompletă)', () => {
  const lunga = 'Solicitarea nr. 1:\nÎntrebare?\nRăspuns solicitarea nr. 1:\n' + Array.from({ length: 10 }, (_, k) => `⟦PAGINA ${k + 1}⟧\n${'răspuns lung. '.repeat(300)}`).join('\n')
  const g = imparteCuGranite(lunga)
  assertEquals(g.felii.join(''), lunga)
  assert(g.granite.length >= 2 && g.granite.every((x) => x === 'pagina'), g.granite.join(','))
  assertEquals(graniteSigure(g.granite), false)
  const fara = imparteCuGranite('fraza fără întrebări.\n'.repeat(2000))
  assert(fara.granite.length >= 2 && !graniteSigure(fara.granite))
  assertEquals(imparteCuGranite('scurt'), { felii: ['scurt'], granite: [], la: [] })   // o singură felie: nicio tăietură, nimic de marcat
})

Deno.test('granițe de întrebare: „Întrebare 3” / „Clarificare nr. 4” / „Cerere de clarificare 5”…; NU un rând care doar începe cu „Întrebare despre … MM108”', () => {
  for (const cap of ['Întrebare 3:', 'Intrebare nr. 3', 'Clarificare nr. 4', 'Cerere de clarificare 5', 'Solicitare 6', 'SOLICITAREA NR.12', 'Solicitarea de clarificare nr. 5', 'ÎNTREBAREA numărul 2']) {
    const t = 'a'.repeat(MAX_FELIE - 3000) + `\n${cap}\n` + 'b'.repeat(4000)
    const g = imparteCuGranite(t)
    assertEquals([g.granite[0], g.felii[1].startsWith(cap)], ['intrebare', true], cap)
  }
  for (const fals of ['Întrebare despre devizul MM108', 'Solicitarea ofertantului privind lotul 2', 'Clarificarea art. 5', 'Răspuns solicitarea nr. 9']) {
    const g = imparteCuGranite('a'.repeat(MAX_FELIE - 3000) + `\n${fals}\n` + 'b'.repeat(4000))
    assert(g.granite[0] !== 'intrebare', fals)
  }
})

Deno.test('fără marcaje de întrebare → taie la pagină; fără pagini → la rând gol; fără nimic → tăietură fixă — mereu fără pierderi', () => {
  const pag = Array.from({ length: 12 }, (_, k) => `⟦PAGINA ${k + 1}⟧\n${'text '.repeat(700)}`).join('\n')
  const fp = imparteInFelii(pag)
  assertEquals(fp.join(''), pag)
  for (const x of fp.slice(1)) assert(x.startsWith('⟦PAGINA '))
  const par = Array.from({ length: 30 }, () => 'paragraf '.repeat(250)).join('\n\n')
  const fr = imparteInFelii(par)
  assertEquals(fr.join(''), par)
  for (const x of fr) assert(x.length <= MAX_FELIE)
  const bloc = 'x'.repeat(MAX_FELIE * 2 + 5)
  const fb = imparteInFelii(bloc)
  assertEquals([fb.join('') === bloc, fb.length, fb[0].length], [true, 3, MAX_FELIE])
  assertEquals([imparteCuGranite(pag).granite[0], imparteCuGranite(par).granite[0], imparteCuGranite(bloc).granite], ['pagina', 'paragraf', ['fix', 'fix']])
  assertEquals(imparteInFelii('scurt'), ['scurt'])
  assertEquals(imparteInFelii(''), [''])
})

Deno.test('„Răspuns solicitarea nr. k” nu e punct de tăiere (rămâne lângă întrebarea lui)', () => {
  const t = 'a'.repeat(MAX_FELIE - 200) + '\nRăspuns solicitarea nr. 9:\n' + 'b'.repeat(500)
  const f = imparteInFelii(t)
  assertEquals(f.join(''), t)
  assert(!f.some((x) => x.startsWith('Răspuns solicitarea')))
})

const P = (o: Partial<Parte>): Parte => ({ tip: 'altul', rezumat: '', modificari: [], intrebari_raspunse: [], termen_nou: null, data_document: null, motive: [], tokens_in: 1, tokens_out: 2, ...o })
Deno.test('combinaFelii: perechea ruptă la graniță se unește (rămâne cea cu răspuns), modificările dublate o dată, tip majoritar, termene diferite → conflict', () => {
  const q = 'Vă rugăm să ne puneți la dispoziție fișele tehnice pentru țeavă.'
  const c = combinaFelii([
    P({ tip: 'raspuns_clarificare', rezumat: 'r1', intrebari_raspunse: [{ intrebare_originala: q, raspuns_original: '' }, { intrebare_originala: 'Alta?', raspuns_original: 'Da.' }],
      modificari: [{ ce_se_schimba: 'termen', unde: 'fișa de date' }], termen_nou: '2026-10-20', data_document: '2026-10-06' }),
    P({ tip: 'raspuns_clarificare', rezumat: 'r2', intrebari_raspunse: [{ intrebare_originala: q.toUpperCase(), raspuns_original: 'Atașăm fișele tehnice.' }],
      modificari: [{ ce_se_schimba: 'Termen', unde: 'Fișa de date' }], termen_nou: '2026-10-27', motive: ['raspuns_ai_taiat'] }),
    P({ tip: 'altul', rezumat: 'r3' }),
  ])
  assertEquals(c.intrebari_raspunse.length, 2)
  assertEquals(c.intrebari_raspunse[0].raspuns_original, 'Atașăm fișele tehnice.')
  assertEquals(c.modificari.length, 1)
  assertEquals([c.tip, c.termen_nou, c.termene, c.data_document],
    ['raspuns_clarificare', null, [{ data: '2026-10-20', felie: 1 }, { data: '2026-10-27', felie: 2 }], '2026-10-06'])
  assertEquals(c.motive, ['raspuns_ai_taiat', 'conflict_termen'])
  assertEquals([c.tokens_in, c.tokens_out, c.rezumate], [3, 6, ['r1', 'r2', 'r3']])
})

Deno.test('cheieIntrebare ignoră diacritice / majuscule / punctuație; întrebările fără text nu se unesc între ele', () => {
  assertEquals(cheieIntrebare({ intrebare_originala: 'Țeava, DN 324?' }), cheieIntrebare({ intrebare_originala: 'teava dn 324' }))
  const c = combinaFelii([P({ intrebari_raspunse: [{ raspuns_original: 'A' }, { raspuns_original: 'B' }] })])
  assertEquals(c.intrebari_raspunse.length, 2)
})

Deno.test('parteDinAi: normalizează lista / datele / tipul și marchează răspunsul AI tăiat (max_tokens)', () => {
  const p = parteDinAi({ tip: 'ciudat', rezumat_fragment: 'x', modificari: 'nu-i listă', termen_nou: '20.10.2026', data_document: '2026-10-06' }, 'max_tokens', 10, 20)
  assertEquals([p.tip, p.rezumat, p.modificari, p.termen_nou, p.data_document, p.motive], ['altul', 'x', [], null, '2026-10-06', ['raspuns_ai_taiat']])
  assertEquals(parteDinAi({ rezumat: 'întreg' }, 'end_turn', 0, 0).rezumat, 'întreg')
})

// Copilot conv. 3 (NO-GO P1 pe d459447): „prelungit la 30.10” într-o felie anterioară, „devansat la 25.10” într-una ulterioară.
// Maximul calendaristic ar fi dat 30.10 (greșit). Acum: niciun termen ales automat, ambele în ordinea documentului, conflict marcat.
Deno.test('termene: prelungire 30.10 apoi devansare 25.10 → termen_nou null + conflict_termen; același termen repetat → ales, fără conflict', () => {
  const c = combinaFelii([P({ termen_nou: '2026-10-30' }), P({}), P({ termen_nou: '2026-10-25' })])
  assertEquals([c.termen_nou, c.termene, c.motive], [null, [{ data: '2026-10-30', felie: 1 }, { data: '2026-10-25', felie: 3 }], ['conflict_termen']])
  const r = combinaFelii([P({ termen_nou: '2026-10-30' }), P({ termen_nou: '2026-10-30' })])
  assertEquals([r.termen_nou, r.termene.length, r.motive], ['2026-10-30', 2, []])
  assertEquals([combinaFelii([P({})]).termen_nou, combinaFelii([P({})]).termene], [null, []])
})
