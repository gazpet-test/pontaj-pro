# Livrarea migrării 20261226b — SMS Redări: șablonul cu „predare” (NEAPLICATĂ)

Decizia proprietarului (17.11.2026): terminologia „predare”. Textul SMS-ului fix devine:

> Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}

(„redare” → „predare”, restul identic). Versiunea rămâne **PROVIZORIE** (`provizoriu-2026-11-17`): textul nu e încă aprobat de beneficiar,
deci comutatorul Redări NU se pornește (`docs/sms/ACTIVARE_SMS_REDARI.md`). Acordul pentru PREGĂTIRE: 17.11.2026; aplicarea o face
coordonatorul, cu acordul proprietarului, **în aceeași fereastră cu 20261226a și cu publicarea #1117** (și a acestui PR: constanta JS).

## 1. Ce se schimbă, în aceeași livrare

| Unde | Ce |
|---|---|
| SQL `fn_sms_redari_sablon_model()` | textul nou |
| SQL `fn_sms_redari_sablon_versiune()` | `provizoriu-2026-11-17` |
| JS `src/sms/sablonRedari.js` | `SABLON_REDARI` (textul nou), `SABLON_REDARI_VERSIUNE` = `provizoriu-2026-11-17` |
| Testele | cazurile P1–P15 într-un singur tabel (`src/sms/sablonRedari.cazuri.js`), verificate în vitest (JS) și pe SQL-ul real în proba PGlite (paritatea JS ↔ SQL); `RedariSmsFereastra.test.jsx` cu textul nou |

Regulile NU se schimbă (`fn_sms_redari_sablon_aprobat` neatinsă): o versiune `provizoriu-*` trece doar pe proiectele `TEST-%` cu 1–5
destinatari. Ordinea publicării: migrarea și UI-ul împreună; între ele BD-ul refuză crearea lotului (textul afișat diferă de cel recalculat:
40001, fail-closed).

## 2. Lungimea GSM-7

+1 caracter. Pe cazurile de paritate: P1 140 (era 139), P2 / P11 / P13 / P14 134 (133), P3 139 (138); toate sub 160, deci **un singur
segment în aceleași condiții ca înainte**; P10 (numele UAT foarte lung) era deja peste 160 și rămâne „prea_lung” (199). Niciun caz nu trece
la două segmente din cauza literei în plus. Un text peste 160 rămâne, ca înainte, blocat de aplicație (nu se trimite pe două segmente).

## 3. Loturile existente și pasul de curățare (doar descris)

- Un lot creat înainte (`filtru.sablon_versiune = 'provizoriu-2026-11-03'`, text cu „redare”) e **refuzat** după migrare la aprobare, la
  fiecare rezervare și de cron (`fn_sms_redari_lot_motiv_la` → `sablon_neaprobat`; textul recalculat diferă oricum → `text_schimbat`).
  Nu pleacă niciun mesaj din el.
- Loturile Redări pot exista doar pe proiecte `TEST-%` (versiune provizorie). Cât un lot vechi rămâne „activ” (draft / aprobat /
  in_trimitere, sau coada_golita cu mesaje „necunoscut”) **ocupă UAT-ul** (un singur lot Redări activ pe UAT), deci nu se poate crea altul.
- **Pasul de curățare, după aplicare**: NOTICE-ul migrării listează loturile (`loturi Redari active cu alta versiune …: N (id stare; …)`);
  operatorul le anulează din SMS → Istoric, apoi le recreează din șablon. Un lot creat în cele câteva secunde ale aplicării poate primi
  versiunea veche: același refuz, aceeași anulare. Migrarea nu anulează nimic singură.

## 4. Lock-uri, durată

Niciun lock pe tabele: `CREATE OR REPLACE FUNCTION` ia doar rândul din `pg_proc`. `sms_loturi` / `sms_mesaje` doar citite (NOTICE-ul).
Fără bloc de lock: garda finală a runnerului afișează `LOCK_TINUT` „nedeclarat” (diagnostic, nu gardă). Tranzacția = cele două amprente
globale + câteva milisecunde.

## 5. Revenirea (`supabase/revenire/20261226b_sms_redari_sablon_predare_ROLLBACK.sql`, plafon 2000)

Corpurile EXACTE din 20261130c; starea exactă a migrării verificată înainte. Fără refuz pe date. Loturile create cu versiunea nouă devin
`sablon_neaprobat` (NOTICE-ul le numără; se anulează la fel). Se face ÎMPREUNĂ cu revenirea constantei JS.

## 6. Probe și comenzi

- Local, rulat: `node scripts/pglite/test_sms_sablon_predare_local.mjs` — PASS (validatorul real; aplicarea ca la livrare, manifestul =
  2 obiecte din `supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv`; paritatea JS ↔ SQL pe 15 cazuri; loturile vechi /
  noi / pe proiect real / text amestecat; revenire → reaplicare; 8 refuzuri ale migrării, 4 ale revenirii; 6 mutanți).
- `npx vitest run src/sms/sablonRedari.test.js src/sms/RedariSmsFereastra.test.jsx`.
- Coordonatorul, pe clonă și apoi pe țintă: aceiași pași ca `docs/redari/LIVRARE_20261226a_PREDARE_DECLARATIE.md` §6, cu numele
  `20261226b_sms_redari_sablon_predare`, versiunile `20261226120100` (migrarea) / `20261226120101` (revenirea), rădăcinile
  `--radacina 'public.fn_sms_redari_sablon_model()' --radacina 'public.fn_sms_redari_sablon_versiune()'`, iar diff-ul listei de obiecte
  pe `supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv` (2 obiecte, ambele `functie … schimbat`).
- Rezultatul așteptat la aplicare: cod 0; NOTICE `20261226b: loturi Redari active cu alta versiune decat provizoriu-2026-11-17: N (…)`
  (de consemnat și de curățat, §3); verificare: `SELECT public.fn_sms_redari_sablon_versiune();` → `provizoriu-2026-11-17`.
