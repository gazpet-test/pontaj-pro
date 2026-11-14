// Cazurile acțiunii „coada” (edge intrebari-tehnice-worker, logic.js coadaDePreluat) — UN SINGUR tabel, rulat de două ori (L19):
//   1. vitest (supabase/functions/intrebari-tehnice-worker/logic.test.js): logica edge-ului pe o bază falsă cu filtrele PostgREST;
//   2. proba locală PGlite (scripts/pglite/test_intrebari_coada_local.mjs): aceleași rânduri într-un Postgres real, cu
//      fn_intrebari_preia COPIATĂ din migrarea 20261131e — „coada” trebuie să spună „are ceva” ori de câte ori `preia` are de lucru.
// `asteptat` e scris de mână, din regulile lui fn_intrebari_preia (nu din codul testat). `marja: true` = singura abatere permisă:
// „coada” spune „are ceva” cu un minut mai devreme decât expirarea din BD (ceasul edge-ului), deci `preia` poate să nu facă nimic.
// Timpii: `min` = cu câte minute în urmă față de „acum”; `zi` = minute față de miezul nopții Europe/Bucharest (negativ = ieri).
// Date inventate, fără conținut.
const noua = { stare: 'noua' }
const lucru = min => ({ stare: 'in_lucru', min })
const azi = (rezultat = null, zi = 1) => ({ zi, rezultat })
const multe = (n, f) => Array.from({ length: n }, f)

export const CAZURI_COADA = [
  { nume: 'coada goală', intrebari: [], preluari: [], asteptat: false },
  { nume: 'doar întrebări închise (răspuns / eroare / de verificat)', intrebari: [{ stare: 'raspuns' }, { stare: 'eroare' }, { stare: 'de_verificat' }],
    preluari: [azi('raspuns'), azi('eroare')], asteptat: false },
  { nume: 'o întrebare nouă', intrebari: [noua], preluari: [], asteptat: true },
  { nume: 'o întrebare amânată (amânarea o readuce în „noua”, fără termen)', intrebari: [{ stare: 'noua' }], preluari: [azi('amanat')], asteptat: true },
  { nume: 'o întrebare în lucru de 10 minute (nescadentă pentru expirare)', intrebari: [lucru(10)], preluari: [azi()], asteptat: false },
  { nume: 'în lucru de 28 de minute (încă nescadentă, în afara marjei)', intrebari: [lucru(28)], preluari: [azi()], asteptat: false },
  { nume: 'în lucru de 29,5 minute: „coada” spune „are ceva” cu marja de 60 s', intrebari: [lucru(29.5)], preluari: [azi()], asteptat: true, marja: true },
  { nume: 'în lucru de 31 de minute → expirată, `preia` o închide', intrebari: [lucru(31)], preluari: [azi()], asteptat: true },
  { nume: 'plafon atins (40 azi) + o întrebare nouă → nimic de preluat', intrebari: [noua], preluari: multe(40, () => azi('raspuns')), asteptat: false },
  { nume: '39 azi + o întrebare nouă → se preia', intrebari: [noua], preluari: multe(39, () => azi('raspuns')), asteptat: true },
  { nume: '40 azi dintre care o amânare → 39 numărate, se preia', intrebari: [noua],
    preluari: [...multe(39, () => azi('eroare')), azi('amanat')], asteptat: true },
  { nume: 'preluările deschise (rezultat NULL) intră în plafon', intrebari: [noua, lucru(5)], preluari: multe(40, () => azi(null)), asteptat: false },
  { nume: 'plafon atins, dar o preluare expirată → `preia` o închide (expirarea e înaintea plafonului)', intrebari: [noua, lucru(45)],
    preluari: multe(40, () => azi('raspuns')), asteptat: true },
  { nume: '40 de preluări IERI (cu un minut înainte de miezul nopții local) nu intră în plafonul de azi', intrebari: [noua],
    preluari: multe(40, () => azi('raspuns', -1)), asteptat: true },
  { nume: '40 de preluări din primul minut al zilei locale intră în plafon', intrebari: [noua],
    preluari: multe(40, () => azi('raspuns', 0)), asteptat: false },
]
