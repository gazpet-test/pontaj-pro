// deno test supabase/functions/_shared/identitateFisier_test.ts — regula „deja în platformă” pentru fișierele extrase din
// arhive SEAP (worker + edge). Copilot conv. 3, NO-GO r1 pe #643: fără sha dovedit nu e „deja”.
import { strict as assert } from 'node:assert'
import { shaDovedit, stareIdentitate, adaugaDocument, alegeNume, pastreazaUrcat } from './identitateFisier.mjs'

const cheie = (n: unknown) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase()   // ca cheieNume din worker / edge
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64)
type RandMan = { stare: string; document_id: number | null; sha256: string }
const st = (docs: { id: number; nume_original: string }[], man: RandMan[] = []) => stareIdentitate(docs, shaDovedit(man), cheie)

Deno.test('shaDovedit: doar rândurile „urcat”; „deja_in_platforma” nu e dovadă, oricare ar fi ordinea; contradicția → fără dovadă', () => {
  const urcatA = { stare: 'urcat', document_id: 10, sha256: A }
  const dejaB = { stare: 'deja_in_platforma', document_id: 10, sha256: B }   // scris de bugul vechi: alt conținut, id-ul lui A
  assert.equal(shaDovedit([urcatA, dejaB]).get(10), A)
  assert.equal(shaDovedit([dejaB, urcatA]).get(10), A)
  assert.equal(shaDovedit([dejaB]).has(10), false)
  assert.equal(shaDovedit([urcatA, { stare: 'urcat', document_id: 10, sha256: B }]).get(10), null)
  assert.equal(shaDovedit([{ stare: 'eroare_urcare', document_id: null, sha256: C }]).size, 0)
})

Deno.test('alegeNume: aceeași mărime sau rând fără sha NU înseamnă „deja” — se urcă sub alt nume, nu se pierde', () => {
  // „Caiet.pdf” există (urcat de mână / rând vechi, fără sha în manifest): conținutul nou nu se poate dovedi identic
  assert.deepEqual(alegeNume(st([{ id: 10, nume_original: 'Caiet.pdf' }]), 'Caiet.pdf', 'Lot2', B), { nume: 'Lot2/Caiet.pdf' })
  // „X.PDF” există cu sha dovedit A; „x.pdf” are sha B → nume exact liber, cheie echivalentă cu alt conținut → se urcă
  assert.deepEqual(alegeNume(st([{ id: 11, nume_original: 'X.PDF' }], [{ stare: 'urcat', document_id: 11, sha256: A }]), 'x.pdf', 'DOC', B), { nume: 'x.pdf' })
})

Deno.test('alegeNume: același conținut dovedit → „deja”, pe nume exact, pe nume echivalent și pe numele prefixat (reluare)', () => {
  const s = st([{ id: 10, nume_original: 'Caiet.pdf' }, { id: 20, nume_original: 'Lot2/Caiet.pdf' }],
    [{ stare: 'urcat', document_id: 10, sha256: A }, { stare: 'urcat', document_id: 20, sha256: B }])
  assert.deepEqual(alegeNume(s, 'Caiet.pdf', 'Lot1', A), { deja: 10 })
  assert.deepEqual(alegeNume(s, 'CAIET.pdf', 'Lot1', A), { deja: 10 })
  assert.deepEqual(alegeNume(s, 'Caiet.pdf', 'Lot2', B), { deja: 20 }, 'reluarea Lot2 recunoaște propria urcare prefixată')
  assert.deepEqual(alegeNume(s, 'Caiet.pdf', 'Lot3', C), { nume: 'Lot3/Caiet.pdf' })
})

Deno.test('alegeNume: toți candidații pe aceeași cheie, nu doar ultimul (P2-1); toate numele ocupate → ultimul candidat, dublură nu pierdere', () => {
  const s = st([{ id: 1, nume_original: 'Anexa.pdf' }, { id: 2, nume_original: 'ANEXA.pdf' }],
    [{ stare: 'urcat', document_id: 1, sha256: A }, { stare: 'urcat', document_id: 2, sha256: B }])
  assert.deepEqual(alegeNume(s, 'anexa.pdf', 'DOC', A), { deja: 1 })
  assert.deepEqual(alegeNume(s, 'anexa.pdf', 'DOC', B), { deja: 2 })
  const plin = st([{ id: 1, nume_original: 'F.pdf' }, { id: 2, nume_original: 'P/F.pdf' }, { id: 3, nume_original: `P/${C.slice(0, 8)}_F.pdf` }])
  assert.deepEqual(alegeNume(plin, 'F.pdf', 'P', C), { nume: `P/${C.slice(0, 8)}_F.pdf` })
})

Deno.test('adaugaDocument: o urcare din aceeași rulare devine dovadă (al doilea fișier identic → „deja”)', () => {
  const s = st([])
  const a = alegeNume(s, 'Caiet.pdf', 'Lot1', A)
  assert.deepEqual(a, { nume: 'Caiet.pdf' })
  adaugaDocument(s, 'Caiet.pdf', 50, A)
  assert.deepEqual(alegeNume(s, 'Caiet.pdf', 'Lot2', A), { deja: 50 })
  assert.deepEqual(alegeNume(s, 'Caiet.pdf', 'Lot2', B), { nume: 'Lot2/Caiet.pdf' })
})

Deno.test('pastreazaUrcat: doar aceeași intrare (arhivă + cale) urcată ca același document', () => {
  const man = [{ stare: 'urcat', arhiva_cheie: 'doc.zip', cale: 'Caiet.pdf', document_id: 10 }]
  assert.equal(pastreazaUrcat(man, 'doc.zip', 'Caiet.pdf', 10), true)
  assert.equal(pastreazaUrcat(man, 'alt.zip', 'Caiet.pdf', 10), false)
  assert.equal(pastreazaUrcat(man, 'doc.zip', 'Caiet.pdf', 11), false)
  assert.equal(pastreazaUrcat([{ ...man[0], stare: 'deja_in_platforma' }], 'doc.zip', 'Caiet.pdf', 10), false)
})
