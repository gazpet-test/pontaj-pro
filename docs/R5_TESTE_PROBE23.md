# R9b — probele de acceptare 2 și 3

Script: `scripts/pg/test_r9b_probe23.mjs`. Node ESM, fără dependențe npm noi;
folosește procese `psql` distincte pe **PostgreSQL 16 real**, nu PGlite.

## Rulare

Pe o instanță PostgreSQL 16 locală dedicată testelor, cu `psql` în PATH și un
utilizator SQL superuser (necesar pentru fixture și roluri):

```powershell
$env:PGURI = 'postgres://postgres@localhost:5432/r9b'
node scripts/pg/test_r9b_probe23.mjs
```

Autentificarea trebuie configurată local, de exemplu prin fișierul pgpass.
Scriptul nu cere interactiv parola. **Șterge și recreează baza din PGURI**;
acceptă numai localhost/127.0.0.1/::1 și numele `r9b` sau `r9b_test_<sufix>`
(litere mici, cifre, underscore), fără parametri URI. Nu folosi o bază cu date utile.
Nu utilizează `DROP ... FORCE`. Baza rezultată rămâne disponibilă pentru inspecție.
Rolurile anon/authenticated/service_role sunt create numai dacă lipsesc și rămân
în instanța de test; atributele rolurilor deja existente nu sunt alterate.

Fixture-ul sintetic pornește de la schema din `scripts/pglite/test_r9b_decisive.mjs`.
`auth.uid()` citește `request.jwt.claims`; apelurile umane rulează ca
`authenticated`, cu identități owner/responsabil/fără acces Ofertare.
Se aplică integral, fără rescriere, migrarea prerequisite
`R5_MIGRARE_PROPUSA_aprobare_istoric.sql` (istoric, helpers și triggere), apoi
`R5_MIGRARE_1b_prag_exact.sql` și `R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql`.
Ciornele sunt create prin generatorul real instalat de migrare. Fiecare test are
o licitație proprie; notificarea inițială a generatorului intră în baseline.

## Acoperire

| Test | Verificare |
|---|---|
| 2a | A citește tokenul; B schimbă cantitatea și comite; aceeași sesiune A primește refuzul „s-au schimbat”, fără decizie salvată. |
| 2b | A reconfirmă în tranzacție și pune `de_trimis`; exportul inițial include ciorna. B comite schimbarea F3 cât A ține lock-ul. După COMMIT A, starea este `schimbata`, exportul ridică explicit eroare. |
| 2c | A reconfirmă și ține tranzacția deschisă; reconfirmarea B pe același token așteaptă lock-ul. Ambele reușesc, istoricul păstrează exact cele două decizii cu autorii și notele distincte, starea finală este `ok`. |
| 2d | Editarea textului de către B așteaptă lock-ul lui A. După commit, textul editat rămâne salvat, reconfirmarea dispare, istoricul rămâne, statusul revine din `de_trimis` în `propunere`, starea devine `necesita_review`. |
| 3a | Ciornă reconfirmată `ok`: RPC-ul raportează zero și nu adaugă notificări. |
| 3b | Schimbare relevantă: scrierea F3 nu notifică singură; RPC-ul adaugă exact un rând pentru responsabil, cu `/ofertare` și mesaj intern. Textul și statusul clarificării rămân intacte. |
| 3c | Al doilea apel pentru aceeași bază nu adaugă nimic și nu modifică marcajul. |
| 3d | A doua schimbare produce alt token și exact încă o notificare cu ID distinct. |
| 3e | Utilizator fără acces: exact `{"error":"fără acces"}`, zero rânduri noi și baza intactă. Apelul ulterior al ownerului emite notificarea restantă. |
| 3f | Ciornă retrasă, cu bază schimbată și încă nenotificată: zero notificări. |

Ordinea concurentă se bazează pe confirmarea terminării comenzilor și pe
`pg_blocking_pids` + `pg_stat_activity.wait_event_type = 'Lock'`, nu pe presupunerea
că un sleep a fost suficient. Sunt verificate PID-uri distincte pentru procese și
backenduri. Timeout-ul, deadlock-ul sau eroarea SQL înseamnă FAIL; nu se repetă
automat operația. Un eșec nu împiedică rularea celorlalte probe independente.

Se afișează PASS/FAIL per test și totalul; orice FAIL (inclusiv setup) produce exit 1.
Testele notificării verifică efectele SQL și lipsa tranziției la `trimisa`; fixture-ul
local nu include servicii externe și nu constituie audit al canalelor externe din producție.

La redactare: `psql` indisponibil în PATH și `PGURI` nesetat; probele PostgreSQL
nu au fost executate. Validarea sintactică locală: `node --check scripts/pg/test_r9b_probe23.mjs`.
