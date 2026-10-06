// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/felii_test.ts
// Rezumatul pe felii (Răcari, 06.10.2026): împărțire fără pierderi, la granița întrebărilor; combinarea feliilor.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cheieIntrebare, combinaFelii, imparteInFelii, MAX_FELIE, parteDinAi, type Parte } from './felii.ts'

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
Deno.test('combinaFelii: perechea ruptă la graniță se unește (rămâne cea cu răspuns), modificările dublate o dată, tip majoritar, termenul cel mai târziu', () => {
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
  assertEquals([c.tip, c.termen_nou, c.termene, c.data_document], ['raspuns_clarificare', '2026-10-27', ['2026-10-20', '2026-10-27'], '2026-10-06'])
  assertEquals(c.motive, ['raspuns_ai_taiat'])
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
