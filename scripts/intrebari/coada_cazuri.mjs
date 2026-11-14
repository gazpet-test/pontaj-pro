// Cazurile acțiunii „coada” (edge intrebari-tehnice-worker, logic.js coadaDePreluat) — UN SINGUR tabel, rulat de două ori (L19):
//   1. vitest (supabase/functions/intrebari-tehnice-worker/logic.test.js): logica edge-ului pe o bază falsă care evaluează
//      filtrul `or=` trimis spre PostgREST;
//   2. proba locală PGlite (scripts/pglite/test_intrebari_coada_local.mjs): aceleași rânduri într-un Postgres real, cu
//      fn_intrebari_preia COPIATĂ din migrarea 20261131e.
// r3 (15.11.2026, review PR #1104): „coada” NU are niciun ceas, nicio marjă și niciun prag: „are ceva” = există o întrebare în
// starea 'noua' SAU 'in_lucru' (indiferent de vechime). Fără plafon și fără dată. Rândurile din `preluari` rămân în cazuri doar ca
// să arate că plafonul nu schimbă răspunsul „coada” (dar schimbă ce face `preia`).
// `asteptat` = răspunsul „coada”, `preia` = are fn_intrebari_preia ceva de făcut (preia o întrebare SAU închide una expirată) —
// AMÂNDOUĂ scrise de mână, din regulile funcției (nu din codul testat). Regula verificată pe fiecare caz: niciodată
// `asteptat: false` cu `preia: true`. `asteptat: true` cu `preia: false` e permis (plafon atins, întrebare „în lucru” încă
// neexpirată): costă doar o listă de nume — exact fluxul de dinainte de „coada”.
// Timpii: `min` = cu câte minute în urmă față de ceasul BD; `zi` = minute față de miezul nopții Europe/Bucharest (negativ = ieri);
// `ceas` = cu câte secunde e ceasul edge-ului înaintea (+) / în urma (−) ceasului BD (implicit 0) — r3: nu mai are niciun efect,
// cazurile cu `ceas` arată tocmai asta. Date inventate, fără conținut.
const noua = { stare: 'noua' }
const lucru = min => ({ stare: 'in_lucru', min })
const azi = (rezultat = null, zi = 1) => ({ zi, rezultat })
const multe = (n, f) => Array.from({ length: n }, f)
const S = 1 / 60   // o secundă, în minute

export const CAZURI_COADA = [
  { nume: 'coada goală', intrebari: [], preluari: [], asteptat: false, preia: false },
  { nume: 'doar întrebări închise (răspuns / eroare / de verificat)', intrebari: [{ stare: 'raspuns' }, { stare: 'eroare' }, { stare: 'de_verificat' }],
    preluari: [azi('raspuns'), azi('eroare')], asteptat: false, preia: false },
  { nume: 'o întrebare nouă', intrebari: [noua], preluari: [], asteptat: true, preia: true },
  { nume: 'o întrebare amânată (amânarea o readuce în „noua”, fără termen)', intrebari: [noua], preluari: [azi('amanat')], asteptat: true, preia: true },
  { nume: 'în lucru de 1 secundă → „are ceva” (`preia` încă nimic)', intrebari: [lucru(S)], preluari: [azi()], asteptat: true, preia: false },
  { nume: 'în lucru de 10 minute → „are ceva” (`preia` încă nimic)', intrebari: [lucru(10)], preluari: [azi()], asteptat: true, preia: false },
  { nume: 'în lucru de exact 30 de minute → „are ceva” (`preia`: comparație strictă, încă nimic)', intrebari: [lucru(30)], preluari: [azi()],
    asteptat: true, preia: false },
  { nume: 'în lucru de 30 min + 1 s → expirată, `preia` o închide', intrebari: [lucru(30 + S)], preluari: [azi()], asteptat: true, preia: true },
  { nume: 'în lucru de 31 de minute → expirată, `preia` o închide', intrebari: [lucru(31)], preluari: [azi()], asteptat: true, preia: true },
  { nume: 'ceasuri diferite: expirată de 1 s, ceasul edge-ului cu 61 s în urmă → „are ceva” (cazul din review r2)', intrebari: [lucru(30 + S)],
    preluari: [azi()], ceas: -61, asteptat: true, preia: true },
  { nume: 'ceasuri diferite: expirată de 1 s, ceasul edge-ului cu 10 minute în urmă → „are ceva”', intrebari: [lucru(30 + S)], preluari: [],
    ceas: -600, asteptat: true, preia: true },
  { nume: 'ceasuri diferite: în lucru de 1 secundă, ceasul edge-ului cu 2 ore înainte → „are ceva”, `preia` încă nimic', intrebari: [lucru(S)],
    preluari: [], ceas: 7200, asteptat: true, preia: false },
  { nume: 'ceasuri diferite: coada goală, ceasul edge-ului cu 2 ore în urmă → „goală”', intrebari: [], preluari: [], ceas: -7200,
    asteptat: false, preia: false },
  { nume: 'plafon atins (40 azi) + o întrebare nouă → „are ceva” (preia refuză, ca înainte de „coada”)', intrebari: [noua],
    preluari: multe(40, () => azi('raspuns')), asteptat: true, preia: false },
  { nume: 'plafon atins + doar o întrebare în lucru de 5 minute → „are ceva”, `preia` nimic', intrebari: [lucru(5)],
    preluari: multe(40, () => azi('raspuns')), asteptat: true, preia: false },
  { nume: 'plafon atins + o preluare expirată → `preia` o închide (expirarea e înaintea plafonului)', intrebari: [noua, lucru(45)],
    preluari: multe(40, () => azi('raspuns')), asteptat: true, preia: true },
  { nume: 'preluările deschise (rezultat NULL) în plafon + o întrebare nouă → „are ceva”, preia refuză', intrebari: [noua, lucru(5)],
    preluari: multe(40, () => azi(null)), asteptat: true, preia: false },
  { nume: '40 de preluări IERI (un minut înainte de miezul nopții local) + o întrebare nouă → se preia', intrebari: [noua],
    preluari: multe(40, () => azi('raspuns', -1)), asteptat: true, preia: true },
  { nume: '40 de preluări din primul minut al zilei locale + o întrebare nouă → „are ceva”, preia refuză', intrebari: [noua],
    preluari: multe(40, () => azi('raspuns', 0)), asteptat: true, preia: false },
  { nume: '39 azi + o întrebare nouă → se preia', intrebari: [noua], preluari: multe(39, () => azi('raspuns')), asteptat: true, preia: true },
  { nume: 'închise + o întrebare în lucru de 2 minute → „are ceva”', intrebari: [{ stare: 'raspuns' }, { stare: 'eroare' }, lucru(2)],
    preluari: [], asteptat: true, preia: false },
]
