# Raportul zilnic — liniile pe proiectul șantierului (20261217a)

Tichet de integritate din review-ul 20261216a r5: liniile unui raport (`raport_lucrari`) puteau rămâne pe proiectul VECHI dacă șantierul era mutat în alt proiect chiar în timpul salvării.

## 1. Analiza (după 20261216a, aplicată pe 12.11.2026)

Salvarea (`fn_raport_zilnic_salveaza`, 20261208a), pe pași:

| pas | ce face | lock |
|---|---|---|
| 1 | advisory (șantier, zi); rândul raportului; **proiectul șantierului** | raport `FOR UPDATE`; șantier **fără lock** |
| 2 | forma liniilor, amprenta | — |
| 5 | activitățile / obiectele trebuie să fie ale proiectului de la pasul 1 | activități / obiecte `FOR SHARE` |
| 6 | antetul (INSERT … ON CONFLICT) → garda rezumatului (20261216a) | șantier `FOR SHARE` (abia acum) |
| 7 | liniile, cu proiectul de la pasul 1 | — |
| 8 | jurnalul → rezumatul refăcut pe conținutul final | — |

Mutarea șantierului (`UPDATE sites`, trigger 20261216a) ține rândul șantierului și încearcă, **NOWAIT**, doar rapoartele șantierului cu rezumat `automat` / `editat` compus pentru alt proiect.

O mutare comisă între pasul 1 și pasul 6 lasă liniile pe proiectul vechi, pe un raport al cărui șantier e deja în proiectul nou. Rezumatul e compus sub lock, deci pe proiectul nou, și scoate tocmai liniile acelea din text.

| cale | fereastra după 20261216a |
|---|---|
| RPC, raport **nou** | **deschisă**: mutarea nu are ce rând de raport să încerce |
| RPC, raport existent fără rezumat (`NULL` = salvat înainte de 20261216a) sau `de_recompus` | **deschisă**: mutarea nu încearcă raportul |
| RPC, raport existent cu rezumat `automat` / `editat` | închisă: mutarea dă peste raportul ținut `FOR UPDATE` → refuz 55P03, iar salvarea trece pe proiectul care rămâne al șantierului |
| scriere directă în `raport_lucrari` (postgres / service_role; authenticated cât 20261208b nu e aplicată) | **deschisă**: niciun lock |
| `raport_distributie_linii` (fără coloană de proiect) | pe RPC: consecventă (trigger-ul tronsonului din 20261027a citește proiectul după garda rezumatului, sub lock); pe calea directă: fără lock (rămâne de discutat, nu e cale a aplicației) |
| importuri | niciun script / edge din repo nu scrie în `raport_lucrari` |

Probe: harness-ul `T1` (înainte de migrare, defectul se reproduce: raport nou + raport existent fără rezumat) și `scripts/raport_linii_proiect_concurenta.sh --asteptat defect` (sesiuni reale, L1–L3).

## 2. Repararea: 20261217a (NEAPLICATĂ)

Un trigger `BEFORE INSERT OR UPDATE OF raport_id, proiect_id` pe `raport_lucrari` (`trg_raport_lucrari_zz_proiect` → `fn_raport_lucrari_proiect_garda`, SECURITY DEFINER, fără EXECUTE pentru nimeni). Pe orice cale:
- ia rândul raportului `FOR SHARE`, apoi rândul șantierului `FOR SHARE` (aceeași ordine ca garda rezumatului) și citește proiectul sub lock;
- linia trece doar dacă proiectul ei = acest proiect și dacă activitatea și obiectul ei sunt ale lui; altfel refuz 22023 („reîncarcă raportul și salvează din nou”) și nimic scris (antetul, liniile și jurnalul se anulează împreună).

**De ce nu în RPC**: corpul RPC-ului e amprentat în inventarul de acces 20261209a (aplicată) și în baseline-ul 20261216a; o versiune nouă ar face inventarul să mintă. Trigger-ul acoperă în plus căile directe (L07).

**Ce rămâne neschimbat**: salvarea normală (proiectul de la pasul 1 = cel de sub lock); liniile ISTORICE ale unui șantier mutat legitim (un UPDATE care nu mută linia nu e verificat); RPC-ul, datele, drepturile, politicile.

**Ce închide fereastra, pe fiecare cale (r3)**:

| cale | ce o închide | dovada |
|---|---|---|
| RPC, raport nou / existent fără rezumat | DOUĂ verificări, fiecare singură: comparația (proiectul liniei = cel citit la pasul 1, deci vechi) și verificarea activității (activitatea, validată la pasul 5 pe proiectul vechi și ținută FOR SHARE). Redundanță voită: RPC-ul pune mereu activitate pe linie | harness T2; PGlite M1 (fără comparație: refuz tot 22023, dar din verificarea activității), M11 (fără ambele: defectul revine); concurență L1 cu `--mutant fara_comparatie` (închis de activitate) și `--mutant fara_verificare` (defect) |
| RPC, raport existent cu rezumat | mutarea refuză NOWAIT (20261216a); salvarea trece și prin gardă (proiect = cel de sub lock) | concurență L4 |
| scriere directă | lock-ul `FOR SHARE` pe șantier (ambele verificări citesc proiectul de după mutare). DOAR comparația vede linia fără activitate / cu proiect NULL / proiectul schimbat pe o linie existentă; DOAR verificarea activității vede proiectul corect cu activitatea altui proiect | harness T4 (blocurile „doar comparatia” / „doar verificarea activitatii”); PGlite M1b, M3, M4, M7; concurență L3 (`fara_for_share`), L5 (`fara_comparatie`) |

Deci nicio verificare nu e de prisos: pe RPC se acoperă una pe alta, pe calea directă fiecare are cazuri pe care doar ea le vede.

**Concurența (L06)**: în RPC trigger-ul nu adaugă nicio așteptare (raportul și șantierul sunt deja ținute de aceeași tranzacție). Pe calea directă, o linie scrisă în timpul unei mutări așteaptă rândul șantierului, apoi citește proiectul nou și refuză. Mutarea nu așteaptă niciodată rapoarte (NOWAIT, 20261216a), deci nu se poate închide un ciclu. În REPEATABLE READ / SERIALIZABLE, un șantier mutat după imaginea tranzacției dă 40001.

**Limite**:
- o activitate sau un obiect mutat în alt proiect după validare (aplicația nu face asta azi): citite fără lock în trigger;
- schimbarea `site_id` a unui raport în timpul scrierii unei linii directe: oprită de `FOR SHARE` pe raport, dar nu se poate proba într-o singură sesiune (cheia străină pune oricum xmax).

## 3. Datele existente (doar citire)

`scripts/raport_linii_proiect_verifica_date.sql` numără liniile al căror proiect diferă de proiectul de azi al șantierului. Pentru că istoricul mutărilor nu se păstrează, separă:
- **probabil defect**: raport salvat DUPĂ un alt raport al aceluiași șantier cu liniile pe proiectul de azi;
- **rezumat pe alt proiect**: semnul cel mai direct, după 12.11.2026, cu rezumatul compus sub lock;
- **amestecate**, **activitate străină**, **distribuție cu tronson străin**.

Lista de rapoarte conține doar id-uri, zile, proiecte și ora salvării. Corecțiile, dacă e cazul: separat (preview → „da” Răzvan → apply).

## 4. Pașii coordonatorului (în ordine)

1. **Datele de azi (producție, doar citire)**:
   `psql -X -v ON_ERROR_STOP=1 -v sistem=<system_identifier producție> -h <host> -p <port> -U <user> -d postgres -f scripts/raport_linii_proiect_verifica_date.sql > linii_proiect_date.txt`
2. **Defectul pe clonă, înainte de migrare** (sesiuni reale). Întâi bariera singură (fără mutare, nimic comis, merge în ambele stări ale migrării):
   `PSQL=/c/Users/Public/pgsql/bin/psql.exe bash scripts/raport_linii_proiect_concurenta.sh --sistem <id clonă> --verifica-bariera -- -h <host clonă> -p <port> -U postgres -d postgres`
   Așteptat: un NOTICE `B0 BARIERA tine: salvarea (pid …) asteapta [transactionid …], blocata de control (pid …)`, apoi `BARIERA OK`, ieșire 0 (26 = bariera nu ține: proba nu are ce dovedi).
   Apoi proba: `… raport_linii_proiect_concurenta.sh --sistem <id clonă> --asteptat defect -- …`
   Așteptat: `OK … L0`, `OK … L1 DEFECT reprodus`, `OK … L2 DEFECT reprodus`, `OK … L3 DEFECT reprodus pe calea directa`, `OK … L4`, `TOATE SCENARIILE OK (--asteptat defect)`, ieșire 0.
   Fiecare rând începe cu starea lui: `OK` (rezultatul cerut), `CONTRAR` (fereastra s-a deschis, rezultatul e celălalt; ieșire 1) sau `PROBA_NEFUNCTIONALA` (bariera / mutarea nu a ținut, o sesiune a picat; ieșire 26, are prioritate — nimic din rulare nu e dovadă).
3. **Baseline-ul L15 (producție, READ ONLY)**:
   `psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -f scripts/raport_linii_proiect_amprente.sql > amprente_20261217a.txt`
   Coloana `linie_baseline` se copiază întreagă între `>>> BASELINE 20261217a` și `<<< BASELINE 20261217a` (în locul rândului `DE_COMPLETAT`); coloana `detaliu` intră în review. Același script pe clonă trebuie să dea identic (altfel clona nu e ca producția).
4. **Harness-ul pe clonă** (tranzacție anulată):
   `psql -X -v ON_ERROR_STOP=1 -h <host clonă> -p <port> -U postgres -d postgres -f scripts/test_executie_raport_linii_proiect.sql`
   Așteptat: T0, T1, TB, T2–T5, T6a/T6b (refuz confirmat), T6 (revenire), T6 (re-aplicare) OK.
5. **Aplicare pe clonă prin runner + concurența după**:
   `bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261217a_executie_raport_linii_proiect.sql --sha256 <sha256> --versiune 20261217120000 --tinta-db postgres --tinta-sistem <id clonă> --tinta-host <H> --tinta-port <P> --user postgres --plafon-tranzactie-ms 2000`
   Apoi `… raport_linii_proiect_concurenta.sh --sistem <id clonă> -- …` (așteptat: `OK` pe L0, L1, L2, L3, L5 `FEREASTRA INCHISA`, L4, `TOATE SCENARIILE OK (--asteptat inchis)`), apoi mutanții:
   `… --mutant fara_comparatie -- …` (L1 `FEREASTRA INCHISA de verificarea activitatii` + L5 `DEFECT reprodus`), `… --mutant fara_verificare -- …` (L1 `DEFECT reprodus`) și `… --mutant fara_for_share -- …` (L3 `DEFECT reprodus`); așteptat la fiecare: `MUTANT … PRINS`, ieșire 0.
   NOTICE-ul „20261217a: sfarsit la Y ms” trebuie să fie sub 1000 ms (peste 1500 ms nu se aplică).
6. **Producția**: aceeași comandă de runner (după review + „da” Răzvan). Revenirea: `supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql`, tot prin runner, cu `--versiune 20261217120001 --plafon-tranzactie-ms 2000`.

Notă pentru clonă: scenariile de concurență mută primul șantier cu proiect dus-întors, deci rezumatele automate ale rapoartelor lui reale de pe clonă devin `de_recompus` (ca la `raport_rezumat_concurenta.sh`). Rapoartele sintetice (2001-02-01 … 06) și activitățile sintetice se șterg la final.

## 5. Probe locale (fără bază reală)

- `node scripts/pglite/test_raport_linii_proiect_local.mjs` (după `npm install --no-save @electric-sql/pglite`): harness-ul real pe schema falsă + 20261216a, 12 mutanți (cu motivul căderii verificat: M1 pe motiv la T2, M1b pe rezultat la T4, M11 defectul la T2), scenariile de refuz ale migrării și ale revenirii, lock-ul pe șantier pe calea directă (cu mutantul lui și starea de azi), scriptul de date pe cazuri plantate.
- `npx vitest run src/raportLiniiProiectAmprente.test.js`: o singură definiție AMPRENTA_L15, blocul BASELINE, amprenta revenirii = corpul din migrare, scripturile doar citire, `bash -n` pe scriptul de concurență.

## Istoric

- 12.11.2026 — r1: analiza, 20261217a + revenire, harness, PGlite, concurență pe clonă, scriptul de date.
- 12.11.2026 — r2 (proba de concurență pe clonă, înainte de migrare: L1 / L2 / L4 „salvarea nu a asteptat la activitate”): bariera ținea (mutarea pornea doar după ce vedea salvarea în așteptare), dar r1 cerea ca salvarea să fi așteptat ≥ 1 s, iar controlul elibera activitatea la ~0,1 s după mutare; eroarea aruncată de probă anula apoi tranzacția salvării (de aici „liniile pe P-”). Acum: așteptarea e observată pe pid (`pg_blocking_pids` = pid-ul controlului, sesiuni cu `application_name`), durata nu mai e criteriu, proba nu mai anulează salvarea, L3 fără `pg_sleep` de ținere; trei stări pe rând (OK / CONTRAR / PROBA_NEFUNCTIONALA, ieșiri 0 / 1 / 26); modul `--verifica-bariera`. Scriptul de date: mesaj clar fără `-v sistem`. Migrarea și amprentele: neschimbate.
- 12.11.2026 — r3 (după migrare pe clonă: L4 „bariera nu a aparut”; mutantul `fara_comparatie` „SCAPAT”). (1) L4: defect al PROBEI, nu al migrării — observatorul sonda `pg_stat_activity` într-o singură tranzacție, iar PostgreSQL fixează lista sesiunilor la prima citire din tranzacție; salvarea, conectată după acea citire, n-a mai apărut, deși stătea chiar la lock-ul controlului (55P03 la 20 s, cât ținea controlul). Acum fiecare pas începe cu `pg_stat_clear_snapshot()` (și la mutarea în zbor din L3 / L5); la expirare se tipăresc sesiunile cu așteptarea și blocanții. Forma lui L4 rămâne: e corectă și după migrare. (2) `fara_comparatie`: pe calea RPC fereastra rămâne închisă de verificarea activității (jurnalul: „activitatea … nu e a proiectului șantierului raportului”) — mutantul nu putea fi prins pe L1. Scenariu nou L5 (scriere directă cu linia fără activitate, unde doar comparația vede), mutant nou `fara_verificare` (fără ambele verificări, L1 arată defectul), harness T4 cu blocurile „doar comparatia” / „doar verificarea activitatii”, PGlite M1 / M1b / M11. Migrarea și amprentele: neschimbate.
