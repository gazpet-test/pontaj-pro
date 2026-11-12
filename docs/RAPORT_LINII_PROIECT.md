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
| `raport_distributie_linii` (fără coloană de proiect) | pe RPC: consecventă (trigger-ul tronsonului din 20261027a citește proiectul după garda rezumatului, sub lock); pe calea directă (postgres / service_role / scripturi): **deschisă**, aceeași fereastră — trigger-ul tronsonului citește proiectul fără lock (r4, review P1-2: se închide aici) |
| importuri | niciun script / edge din repo nu scrie în `raport_lucrari` |

Probe: harness-ul `T1` (înainte de migrare, defectul se reproduce: raport nou + raport existent fără rezumat) și `scripts/raport_linii_proiect_concurenta.sh --asteptat defect` (sesiuni reale, L1–L3, L5, L5c, L7).

## 2. Repararea: 20261217a (NEAPLICATĂ)

Două trigger-e BEFORE, SECURITY DEFINER, fără EXECUTE pentru nimeni, pe orice cale:
- `trg_raport_lucrari_zz_proiect` (`INSERT OR UPDATE OF raport_id, proiect_id` pe `raport_lucrari`) → `fn_raport_lucrari_proiect_garda`: linia trece doar dacă proiectul ei = proiectul șantierului citit sub lock și dacă activitatea și obiectul ei sunt ale lui;
- (r4) `trg_raport_distributie_zz_proiect` (`INSERT OR UPDATE OF raport_id, unitate_id` pe `raport_distributie_linii`) → `fn_raport_distributie_proiect_garda`: rândul cu tronson trece doar dacă tronsonul e al proiectului șantierului citit sub lock (rândul fără tronson nu depinde de proiect: neatins, fără lock). Trigger-ul vechi al tronsonului (20261027a) rămâne cum e și rulează înainte, fără lock.

Protocolul comun (o singură instrucțiune pe rând): rândul raportului, apoi rândul șantierului lui, `FOR SHARE … SKIP LOCKED` (aceeași ordine ca garda rezumatului, ținute până la COMMIT), proiectul citit sub lock. Rezultatul:
- **ocupat** (raportul se salvează / șantierul se mută / antetul se editează chiar acum de altă tranzacție): refuz **55P03** „raportul se salvează sau șantierul lui se mută chiar acum; reîncearcă peste câteva secunde (nimic salvat)”;
- **alt proiect**: refuz **22023** „… reîncarcă raportul și salvează din nou” (r4: aceeași formulare și pentru activitate / obiect / tronson — ce s-a întâmplat și ce are omul de făcut);
- în ambele cazuri nimic scris (antetul, liniile, distribuția și jurnalul se anulează împreună).

**De ce nu în RPC / în trigger-ul vechi**: corpul RPC-ului e amprentat în inventarul de acces 20261209a (aplicată) și în baseline-ul 20261216a; o versiune nouă ar face inventarul să mintă. Trigger-ele noi acoperă în plus căile directe (L07), iar nicio funcție existentă nu se schimbă.

**Ce rămâne neschimbat**: salvarea normală (proiectul de la pasul 1 = cel de sub lock; raportul și șantierul sunt deja ale salvării, deci `SKIP LOCKED` le ia mereu); liniile / rândurile ISTORICE ale unui șantier mutat legitim (un UPDATE care nu mută rândul nu e verificat); RPC-ul, datele, drepturile, politicile.

**De ce gărzile NU așteaptă niciodată (r4, review P1-1)**. În r3 garda aștepta rândul raportului. PostgreSQL blochează rândul modificat ÎNAINTEA trigger-elor BEFORE UPDATE, deci un `UPDATE` direct care schimba `proiect_id` pe o linie ținea linia și aștepta raportul, ținut `FOR UPDATE` de o salvare; salvarea ajungea la `DELETE`-ul liniilor și aștepta aceeași linie: ciclu (40P01), iar victima putea fi salvarea de pe telefon. Trigger-ul nu are cum să știe ce rânduri ține deja tranzacția celui care scrie (poate le-a luat în instrucțiuni anterioare), deci singura regulă sigură e: **nicio așteptare în gărzi**. `SKIP LOCKED` (nu `NOWAIT`): același efect — nu intră în coada lock-ului —, dar fără un bloc `EXCEPTION` (o sub-tranzacție pe fiecare linie) și cu mesajul nostru.

| cale concurentă cu o salvare care ține raportul | r3 | r4 | proba |
|---|---|---|---|
| `UPDATE` direct pe o linie a raportului, cu `proiect_id` / `raport_id` schimbat | linia ținută + așteaptă raportul → **deadlock** cu `DELETE`-ul salvării | refuz 55P03 imediat, linia eliberată, salvarea trece | concurență L6u; mutantul `cu_asteptare` reproduce 40P01 |
| `UPDATE` direct pe tronsonul unui rând de distribuție al raportului | (fără gardă: fereastră) | refuz 55P03 imediat, salvarea trece | concurență L8; `cu_asteptare` = 40P01 |
| `INSERT` direct al unei linii | aștepta salvarea (fără ciclu într-o singură instrucțiune, dar posibil cu linii ținute din instrucțiuni anterioare) | refuz 55P03 imediat | concurență L6i |
| `DELETE` direct al unei linii | niciun trigger al nostru, nicio așteptare în gardă | la fel: trece, salvarea îl așteaptă cât e necomis | concurență L6d |
| scriere directă în timpul unei mutări în zbor | aștepta șantierul, apoi refuz 22023 | refuz 55P03 imediat | concurență L3, L5, L7 |

Ce rămâne în afara gărzilor (la fel ca înainte de 20261217a, nu e cale a aplicației): o tranzacție directă care ține linii și apoi scrie DIRECT antetul raportului (`UPDATE rapoarte_zilnice`) poate intra în deadlock cu o salvare; PostgreSQL o rezolvă cu 40P01.

**Ce închide fereastra, pe fiecare cale (r3)**:

| cale | ce o închide | dovada |
|---|---|---|
| RPC, raport nou / existent fără rezumat | DOUĂ verificări, fiecare singură: comparația (proiectul liniei = cel citit la pasul 1, deci vechi) și verificarea activității (activitatea, validată la pasul 5 pe proiectul vechi și ținută FOR SHARE). Redundanță voită: RPC-ul pune mereu activitate pe linie | harness T2; PGlite M1 (fără comparație: refuz tot 22023, dar din verificarea activității), M11 (fără ambele: defectul revine); concurență L1 cu `--mutant fara_comparatie` (închis de activitate) și `--mutant fara_verificare` (defect) |
| RPC, raport existent cu rezumat | mutarea refuză NOWAIT (20261216a); salvarea trece și prin gardă (proiect = cel de sub lock) | concurență L4 |
| scriere directă, în timpul mutării | lock-ul pe șantier: ocupat de mutare = refuz 55P03 fără așteptare | concurență L3 (`fara_for_share`: trece cu proiectul vechi), L5, L7 (`distributie_fara_lock`) |
| scriere directă, după mutare | ambele verificări citesc proiectul nou. DOAR comparația vede linia fără activitate / cu proiect NULL / proiectul schimbat pe o linie existentă; DOAR verificarea activității vede proiectul corect cu activitatea altui proiect | harness T4 (blocurile „doar comparatia” / „doar verificarea activitatii”); PGlite M1b, M3, M4, M7; concurență L5c (`fara_comparatie`) |
| distribuție, calea directă | aceeași instrucțiune de lock; tronsonul altui proiect = 22023 | harness T4d (garda singură, trigger-ul vechi oprit într-un savepoint); PGlite M12–M15, S19d/e; concurență L7 |

Deci nicio verificare nu e de prisos: pe RPC se acoperă una pe alta, pe calea directă fiecare are cazuri pe care doar ea le vede.

**Concurența (L06)**: în RPC trigger-ele nu adaugă nicio așteptare (raportul și șantierul sunt deja ținute de aceeași tranzacție). Pe calea directă, gărzile nu așteaptă nimic (vezi tabelul r4). Mutarea nu așteaptă niciodată rapoarte (NOWAIT, 20261216a). În REPEATABLE READ / SERIALIZABLE, un șantier mutat după imaginea tranzacției dă 40001.

**Costul (r4, review P2)**: o singură instrucțiune pe rând (r3: până la patru, două cu lock). Pe rândurile care urmează primului, lock-urile sunt deja ale tranzacției (fără scriere nouă pe pagină). Măsurat local (PGlite, WASM — proporția, nu timpul de pe clonă), salvarea prin RPC cu 50 / 200 / 500 de linii, mediana din 5:

| varianta | 50 | 200 | 500 |
|---|---|---|---|
| fără migrare | 7 ms | 22 ms | 70 ms |
| garda oprită (migrarea aplicată) | 7 ms | 24 ms | 74 ms |
| garda r3 | 7 ms | 26 ms | 81 ms |
| garda r4 | 7 ms | 25 ms | 79 ms |

Garda adaugă ~10–15% la 500 de linii (~15 µs pe linie); r4 e la fel de ieftină ca r3 sau puțin sub. Nu am făcut o citire a șantierului „pe instrucțiune”: un cache între rânduri ar trebui ținut în afara trigger-ului (GUC / tabel temporar) și s-ar învechi dacă aceeași tranzacție mută șantierul între două rânduri; un trigger pe instrucțiune cu tabele de tranziție nu se poate lega de `UPDATE OF <coloane>` și ar verifica DUPĂ ce rândurile sunt scrise — o schimbare mai mare, nejustificată de cifre. Pe clonă, cifrele reale: `scripts/raport_linii_proiect_cost.sql` (pasul 5b).

**Limite**:
- o activitate sau un obiect mutat în alt proiect după validare (aplicația nu face asta azi): citite fără lock în trigger;
- schimbarea `site_id` a unui raport în timpul scrierii unei linii directe: oprită de lock-ul pe raport, dar nu se poate proba într-o singură sesiune (cheia străină pune oricum xmax);
- refuzul „ocupat” e și pentru scrierile directe care se suprapun cu o simplă editare a antetului: reîncercarea trece (căile directe nu sunt ale aplicației).

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
   Așteptat (r4): `OK … L0`, `OK … L1 DEFECT reprodus`, `OK … L2 DEFECT reprodus`, `OK … L3 DEFECT reprodus pe calea directa`, `OK … L5 DEFECT …`, `OK … L7 DEFECT …` (distribuția), `OK … L5c DEFECT …`, rândul `L6 / L8: sarite fara migrare`, `OK … L4`, `TOATE SCENARIILE OK (--asteptat defect)`, ieșire 0.
   Fiecare rând începe cu starea lui: `OK` (rezultatul cerut), `CONTRAR` (fereastra s-a deschis, rezultatul e celălalt; ieșire 1) sau `PROBA_NEFUNCTIONALA` (bariera / mutarea nu a ținut, o sesiune a picat; ieșire 26, are prioritate — nimic din rulare nu e dovadă).
3. **Baseline-ul L15 (producție, READ ONLY)** — r4: DE RERULAT, tabelul distribuției a intrat în amprentă:
   `psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -f scripts/raport_linii_proiect_amprente.sql > amprente_20261217a.txt`
   Cele 47 de rânduri lipite pe 12.11.2026 trebuie să iasă IDENTIC (testul vitest le ține amprenta). Rândurile noi (`DE_COMPLETAT` în migrare = refuz): `functie fn_raport_distributie_unitate_check()` și cele șase `tabel raport_distributie_linii | acl / acl coloane / politici / rls / secvente / triggere`. Coloana `linie_baseline` se copiază întreagă între `>>> BASELINE 20261217a` și `<<< BASELINE 20261217a`; dacă scriptul arată și alte etichete noi (o funcție din politicile / triggerele distribuției pe care schema de test nu o are), intră și ele, iar `NOI` din test se completează. Coloana `detaliu` intră în review. Același script pe clonă trebuie să dea identic (altfel clona nu e ca producția).
4. **Harness-ul pe clonă** (tranzacție anulată):
   `psql -X -v ON_ERROR_STOP=1 -h <host clonă> -p <port> -U postgres -d postgres -f scripts/test_executie_raport_linii_proiect.sql`
   Așteptat: T0, T1, TB, T2–T4, T4d (r4: distribuția; trigger-ul vechi al tronsonului e oprit doar într-un savepoint anulat), T5, T6a/T6b (refuz confirmat), T6 (revenire), T6 (re-aplicare) OK.
5. **Aplicare pe clonă prin runner + concurența după**:
   `bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261217a_executie_raport_linii_proiect.sql --sha256 <sha256> --versiune 20261217120000 --tinta-db postgres --tinta-sistem <id clonă> --tinta-host <H> --tinta-port <P> --user postgres --plafon-tranzactie-ms 2000`
   Apoi `… raport_linii_proiect_concurenta.sh --sistem <id clonă> -- …`. Așteptat (r4), în ordine: `OK` pe L0, L1, L2, L3 / L5 / L7 (`FEREASTRA INCHISA … refuz 55P03 fara asteptare`), L5c (`comparatia refuza 22023`), L6u / L6i / L8 (`FARA CICLU: scrierea directa refuzata imediat 55P03`), L6d (`FARA CICLU: scrierea directa trecuta fara asteptare`), L4, apoi `TOATE SCENARIILE OK (--asteptat inchis)`. Niciun `40P01` în jurnal.
   Mutanții (fiecare: `MUTANT … PRINS`, ieșire 0): `--mutant fara_comparatie` (L1 `FEREASTRA INCHISA de verificarea activitatii` + L5c `DEFECT reprodus`), `--mutant fara_verificare` (L1 `DEFECT`), `--mutant fara_for_share` (L3 `DEFECT`), **`--mutant cu_asteptare`** (r4: L6u și L8 `DEADLOCK reprodus (40P01)` — forma r3, care aștepta), **`--mutant distributie_fara_lock`** (r4: L7 `DEFECT`).
   NOTICE-ul „20261217a: sfarsit la Y ms” trebuie să fie sub 1000 ms (peste 1500 ms nu se aplică).
5b. **Costul salvărilor mari (r4, clonă, tranzacție anulată)** — ÎNAINTE de pasul 5 și DUPĂ el, pe aceeași clonă:
   înainte: `psql -X -v ON_ERROR_STOP=1 -v sistem=<id clonă> -h <host clonă> -p <port> -U postgres -d postgres -f scripts/raport_linii_proiect_cost.sql`
   după: aceeași comandă (garda r4), apoi cu `-v varianta=r3` (corpul r3 pus în tranzacția anulată) și `-v varianta=fara_garda` (trigger-ul liniilor oprit în tranzacția anulată; ține un lock pe `raport_lucrari` câteva secunde).
   Tipărește `COST 50 / 200 / 500 linii: min / median / max ms`. De urmărit: r4 față de „fără migrare” la 500 de linii (local: +13%).
6. **Producția**: aceeași comandă de runner (după review + „da” Răzvan). Revenirea: `supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql`, tot prin runner, cu `--versiune 20261217120001 --plafon-tranzactie-ms 2000`.

Notă pentru clonă: scenariile de concurență mută primul șantier cu proiect dus-întors, deci rezumatele automate ale rapoartelor lui reale de pe clonă devin `de_recompus` (ca la `raport_rezumat_concurenta.sh`). Rapoartele sintetice (2001-02-01 … 12), activitățile sintetice și tronsoanele sintetice TLPC1 / TLPC2 se șterg la final.

**Notă pentru owner (fără cod în acest PR)**: amprenta arată că rolul nelogat (`anon`) are azi `SELECT / REFERENCES / TRIGGER` pe `raport_lucrari` și `SELECT / UPDATE / USAGE` pe secvența ei (`raport_lucrari_id_seq`). Sunt drepturile EXISTENTE, înghețate de baseline ca să nu se schimbe pe ascuns — nu le introduce acest PR. Politicile tabelului nu dau acces la rânduri fără cont. Le scoate curățenia generală a drepturilor contului nelogat (separat, cu „da”-ul lui Răzvan); după ea, baseline-ul se reface.

## 5. Probe locale (fără bază reală)

- `node scripts/pglite/test_raport_linii_proiect_local.mjs` (după `npm install --no-save @electric-sql/pglite`): harness-ul real pe schema falsă + 20261216a, 17 mutanți (cu motivul căderii verificat: M1 pe motiv la T2, M1b pe rezultat la T4, M11 defectul la T2; r4: M12–M15 distribuția, M17 revenirea), scenariile de refuz ale migrării (r4: și pe tabelul distribuției: politică, drept pe coloană, trigger-ul vechi oprit, trigger după gardă) și ale revenirii (pe ambele funcții), lock-ul pe șantier pe calea directă (liniile + distribuția, cu mutantul și starea de azi), costul (S21) și scriptul de cost pe altă țintă (S22), scriptul de date pe cazuri plantate. PGlite are o singură sesiune: refuzul „ocupat” și deadlock-ul le probează doar concurența.
- `npx vitest run src/raportLiniiProiectAmprente.test.js`: o singură definiție AMPRENTA_L15, blocul BASELINE (cele 47 de valori neschimbate, doar etichetele noi `DE_COMPLETAT`), amprenta revenirii = corpul fiecărei funcții din migrare, aceeași instrucțiune de lock fără așteptare în ambele gărzi (L19), mesajele, scripturile coordonatorului, `bash -n` + mutanții concurenței pe textul real al migrării.

## Istoric

- 12.11.2026 — r1: analiza, 20261217a + revenire, harness, PGlite, concurență pe clonă, scriptul de date.
- 12.11.2026 — r2 (proba de concurență pe clonă, înainte de migrare: L1 / L2 / L4 „salvarea nu a asteptat la activitate”): bariera ținea (mutarea pornea doar după ce vedea salvarea în așteptare), dar r1 cerea ca salvarea să fi așteptat ≥ 1 s, iar controlul elibera activitatea la ~0,1 s după mutare; eroarea aruncată de probă anula apoi tranzacția salvării (de aici „liniile pe P-”). Acum: așteptarea e observată pe pid (`pg_blocking_pids` = pid-ul controlului, sesiuni cu `application_name`), durata nu mai e criteriu, proba nu mai anulează salvarea, L3 fără `pg_sleep` de ținere; trei stări pe rând (OK / CONTRAR / PROBA_NEFUNCTIONALA, ieșiri 0 / 1 / 26); modul `--verifica-bariera`. Scriptul de date: mesaj clar fără `-v sistem`. Migrarea și amprentele: neschimbate.
- 12.11.2026 — r3 (după migrare pe clonă: L4 „bariera nu a aparut”; mutantul `fara_comparatie` „SCAPAT”). (1) L4: defect al PROBEI, nu al migrării — observatorul sonda `pg_stat_activity` într-o singură tranzacție, iar PostgreSQL fixează lista sesiunilor la prima citire din tranzacție; salvarea, conectată după acea citire, n-a mai apărut, deși stătea chiar la lock-ul controlului (55P03 la 20 s, cât ținea controlul). Acum fiecare pas începe cu `pg_stat_clear_snapshot()` (și la mutarea în zbor din L3 / L5); la expirare se tipăresc sesiunile cu așteptarea și blocanții. Forma lui L4 rămâne: e corectă și după migrare. (2) `fara_comparatie`: pe calea RPC fereastra rămâne închisă de verificarea activității (jurnalul: „activitatea … nu e a proiectului șantierului raportului”) — mutantul nu putea fi prins pe L1. Scenariu nou L5 (scriere directă cu linia fără activitate, unde doar comparația vede), mutant nou `fara_verificare` (fără ambele verificări, L1 arată defectul), harness T4 cu blocurile „doar comparatia” / „doar verificarea activitatii”, PGlite M1 / M1b / M11. Migrarea și amprentele: neschimbate.
- 12.11.2026 — r4 (review: merge NO-GO, aplicare NO-GO; 2 × P1, 2 × P2). (P1-1) Deadlock posibil între un UPDATE direct al unei linii și salvarea RPC (PostgreSQL blochează linia înaintea trigger-ului, garda aștepta raportul, salvarea aștepta linia): gărzile nu mai așteaptă nimic — `FOR SHARE … SKIP LOCKED`, refuz 55P03 „reîncearcă” (cod distinct de 22023); analiza pentru INSERT / DELETE direct; scenarii noi L6u / L6i / L6d / L8 + mutantul `cu_asteptare` (40P01). (P1-2) Distribuția pe calea directă: garda nouă `fn_raport_distributie_proiect_garda` cu același protocol, harness T4d, PGlite M12–M15 / S19d-e, concurență L7 + mutantul `distributie_fara_lock`; tabelul distribuției în amprentă (cele 47 de valori rămân, etichetele noi `DE_COMPLETAT`). L3 / L5 cer acum refuzul fără așteptare; „doar comparația” s-a mutat în L5c (după mutare). (P2) Costul: o instrucțiune pe rând, scriptul de măsurare `scripts/raport_linii_proiect_cost.sql`, cifrele locale de mai sus; mesajele pentru activitate / obiect / tronson spun ce are omul de făcut. Nota pentru owner despre drepturile `anon` existente.
