# Registru DCC — PR1 (BD) — Implementation Plan (runda 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Baza de date a registrului DCC: configurarea (ghiduri, contracte, proiecte DCC), registrul pe trei niveluri (serii → documente / file / anexe → revizii), istoricul brut, structura de mesaje și legături (pregătită pentru etapa B), RPC-urile de alocare / revizie / anulare / „copiat” / „confirm că am trimis” cu idempotență legată de conținut, formatorul de cod și de nume de fișier în SQL cu paritate exactă în JS. O singură migrare L15 v2, **NEAPLICATĂ**, cu revenire, probe PGlite, test pe clona 176 și probă de concurență pe un cluster dispensabil.

**Architecture:** BD = sursa unică (L19). Tabele noi `dcc_*`, toate cu RLS și DOAR `SELECT` pentru `authenticated` (nicio scriere directă pentru `anon` / `authenticated` / `service_role`); toate scrierile prin RPC-uri `SECURITY DEFINER` care verifică explicit `auth.uid()`, sub-modulul `executie_dcc` + nivelul, accesul pe proiect (`fn_executie_proiect_permis`, 20261209a) și operația — printr-o SINGURĂ funcție de drept (`fn_dcc_drept`). **Conținutul se citește doar pe proiectul lui; numerotarea e a contractului** și e impusă de constrângeri + RPC-uri DEFINER care nu întorc rânduri ale altor proiecte ([D1]). Contorul seriei se ia sub `FOR UPDATE` pe rândul seriei; cheile de intenție stau într-un tabel propriu, cu hash-ul parametrilor normalizați. Invariantele (unicitatea codului pe contract, disjuncția seriilor, imuabilitatea textului înghețat, tranzițiile de transport, gărzile pe documentele anulate, interdicția de ștergere) sunt impuse de constrângeri și de triggere BEFORE, deci țin pe orice cale (L07). Formatorul de cod e o funcție SQL `IMMUTABLE` care primește formatul din ghid (jsonb validat); aceeași logică în `src/dcc/dccCod.js`, testată pe ACELAȘI tabel de cazuri scris de mână.

**Tech Stack:** PostgreSQL 17 (Supabase) + runnerul L15 v2 (`scripts/livrare_migrare.sh`, `docs/LIVRARE_L15_V2.md`); PGlite pentru proba locală (`scripts/pglite/`); psql pe clona 176 (coordonatorul) și pe un cluster PG17 dispensabil (concurența); vitest pentru formatorul JS. Fără librării noi, fără TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-23-registru-dcc-design.md` — **v2.3** (conținutul din `origin/main` 593f9ab6, PR #1177; în acest PR se corectează DOAR antetul, care scria „v2.1”). Executorii citesc ambele; unde planul fixează ceva ce specificația lasă deschis, e marcat **[DECIZIE Dn]** (secțiunea „Decizii de construcție”), iar abaterile de la text sunt în „Abateri declarate”.

## Runda 2 — unde se închide fiecare punct din verdictul Jakarinos pe r1 (`5f3d388a`, NO-GO)

| Punct r1 | Închis în | Test(e) noi |
|---|---|---|
| P1-1 D1 extindea citirea la tot contractul | [D1] rescrisă (citire strictă pe proiectul documentului) + „Modelul de acces” + politicile din Task 2–5 | `p7b_doua_proiecte_acelasi_contract`, `t_p7b_acelasi_contract`, mutantul `citire_pe_contract` |
| P1-2 disjuncția intervalelor doar în ghid | „Seriile efective: disjuncție și compatibilitatea ghidului” (Task 3) + lock-ul consultativ pe cheia FĂRĂ interval | `p_intervale_intre_ghiduri`, `p_ghid_incompatibil`, `C6_initializari_suprapuse`, `C6b_ghid_vs_initializare`, mutanții `advisory_cu_interval`, `fara_advisory_contract` |
| P1-3 unicitatea globală a textului codului | Abaterea 6 (unicitate pe CONTRACT) + regula de format completă (Task 1) | `p_cod_text_doua_contracte`, `p_cod_text_coliziune_ghiduri`, mutantul `cod_text_unic_global` |
| P1-4 operațiile pe documente anulate | Tabelul „Gărzile documentului anulat” (Task 3) — RPC după lock + trigger pe orice cale | `p4_operatii_dupa_anulare`, `C4b_anulare_vs_anexa`, mutantul `fila_pe_document_anulat` |
| P2-5 ordinea sarcinilor | Task-urile reordonate; fiecare task își livrează tabelele CU RLS + GRANT + protocolul de intenție deja existent; „Ce trece la fiecare commit” | `--pana-la tN` la fiecare commit |
| P2-6 sincronizarea C5 | C5 cu ordinea fixată și observatorul (Task 7) + reluarea după retragere | `C5_drept_retras_in_asteptare` (a, b), `p_reluare_dupa_retragere`, `t_p2_cheie` (extins) |
| P2-7 contracte de intrare / audit | „Formele rezultatelor”, „Regulile listelor”, câmpurile exacte la import, motivul anulării pe revizie și pe document, comenzile complete (Task 7) | `p_liste_revizii`, `p5_import_chei_refuzate`, `p4_motiv_anulare` |
| D5 `postgres` vs API fără JWT | [D5] rescrisă + matricea de identități | `p_d5_identitati`, `t_d5_identitati`, mutantul `server_fara_session_user` |
| Unicitatea globală nedeclarată / D1 nedeclarată | Abaterile 6–8 | — |
| Antetul specificației v2.1 / numele proprietarului | Antetul corectat la v2.3; în plan doar rolul („proprietarul”) | — |

## Global Constraints

- **Repo public:** nicio persoană, adresă de e-mail reală, cod de emitent / tematică real al altei firme decât cele deja publice în specificație (contract 30 / 43 / 29), niciun conținut de document. Testele folosesc DOAR date sintetice: beneficiari `BEN`, `ALT`, emitenți `AAA` (noi), `SUB` (subcontractor), tematici `TM1`, `TM2`, `TS`, tipuri `COR`, `RAP`, `DES`, `MOM`, adrese `dcc@exemplu.invalid`, uuid-uri `00000000-0000-4000-8000-0000000000NN`.
- **NEAPLICAT:** migrarea, revenirea și scriptul de catalog se livrează în PR, nerulate pe producție. Aplicarea (runner L15 v2 cu `--plafon-extins`), înscrierea sub-modulului în `app_modules`, orice drept în `user_module_access` și orice dată reală (ghidurile reale, contractele, importul istoric, inițializarea seriilor) = chat-ul, după GO Jakarinos pe head + „da”-ul proprietarului.
- **Niciun drept acordat de migrare** și niciun rând de date (nici în `app_modules`: catalogul e scriptul separat din Task 8).
- **Nicio trimitere posibilă în PR1:** `dcc_proiecte.trimitere_permisa` are `CHECK (trimitere_permisa = false)` și `casuta_id` are `CHECK (casuta_id IS NULL)`; stările `trimisa_erp` / `necunoscut` sunt în listă (structura pentru PR4) dar niciun RPC din PR1 nu le scrie și tabelul tranzițiilor din PR1 nu le permite. PR4 le relaxează printr-o migrare proprie.
- **Migrarea:** tiparul L15 v2 al `20270106a_executie_semnale.sql` (doar obiecte noi + chei străine spre `executie_proiecte`): garda de start (`current_user = postgres` + `gazpet.livrare_migrare` legat de `txid_current()`, fără armare persistentă, READ COMMITTED, PG ≥ 17, plafonul 15000/session + marcajul, tabela „înainte” a runnerului), dependențele verificate pe amprentă (md5 pe `prosrc` fără CR + DEFINER + `search_path` + owner + EXECUTE — aceleași constante ca 20270105a pentru `fn_executie_proiect_permis` / `fn_executie_acces_nerestrans`), coloanele citite verificate în catalog cu tipurile acceptate, refuz la reaplicare, setul de lock-uri din „Lock-urile migrării și ale revenirii” într-un punct unic NOWAIT cu bugetul de 1 s, postcondiții. Perimetrul Izometrie: migrarea NU modifică `executie_proiecte` (doar cheia străină a `dcc_proiecte`) — ca 20270106a, fără ritualul PRE / POST al porților; dacă review-ul îl cere, se adaugă ritualul din 20270105a.
- **Funcții:** RPC-urile și predicatele de drept = `SECURITY DEFINER SET search_path = public, pg_temp`, nume calificate cu schema, `REVOKE ALL … FROM PUBLIC, anon, service_role`, `GRANT EXECUTE` doar `authenticated` (RPC-urile UI) — predicatele interne (`fn_dcc_*_intern`, `fn_dcc_intentie_*`) fără niciun EXECUTE. Funcțiile pure (`fn_dcc_cod_text`, `fn_dcc_nume_fisier`, `fn_dcc_titlu_scurt`, `fn_dcc_format_valid`, `fn_dcc_tranzitie_permisa`, `fn_dcc_hash_parametri`) = `IMMUTABLE`, `SECURITY INVOKER`, EXECUTE pentru `authenticated` (CHECK-urile și triggerele le cheamă cu drepturile apelantului). `fn_dcc_server` = `SECURITY INVOKER` (ca `fn_rest_decontat_server`). **Funcțiile care citesc tabele existente (`profiles`, `user_module_access`, `executie_proiecte`, `executie_acces_proiect`) sunt `LANGUAGE plpgsql`**: corpul nu e analizat la `CREATE`, deci crearea nu ia lock-uri pe acele tabele (verificat în `$post$` pe `pg_locks`).
- **Tabele:** `ENABLE ROW LEVEL SECURITY`, politici DOAR `FOR SELECT TO authenticated`, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` urmat de `GRANT SELECT … TO authenticated` (excepții fără niciun GRANT pentru clienți în PR1: `dcc_intentii`, `dcc_casute`, `dcc_serii` — seria se citește prin `fn_dcc_serii_proiect`). Vederi `WITH (security_invoker = on)`. Fiecare tabel primește RLS + politici + GRANT în ACELAȘI task în care e creat.
- **Erorile** au un cod stabil la începutul mesajului (`DCC_<COD>: …`) și SQLSTATE fix (tabelul din Task 3); mesajele nu deosebesc „nu există” de „nu ai drept” (L09: fără oracol pe alte proiecte) și nu conțin niciodată id-uri, titluri sau proiecte ale altor documente.
- **Regulile `docs/paw/LECTII_REVIEW.md` (L01–L25)** se respectă și se raportează în PR (matricea „Respectarea L01–L25” de mai jos se completează cu fișier / linie / test la implementare).
- Fișierele noi `.mjs` fără shebang; fișierele SQL fără BOM; finalurile de linie păstrate (LF pentru fișierele noi).

## Review Focus

Cele 8 probe de acceptare din §10 al specificației, fiecare cu testul ei (PGlite = `scripts/pglite/test_executie_dcc_registru_local.mjs`, clonă = `supabase/tests/20270108a_executie_dcc_registru_dryrun.sql`, concurență = `supabase/tests/20270108a_executie_dcc_registru_concurenta.sh`):

| # | Proba (§10) | PGlite | Clonă 176 | Concurență (2 sesiuni) |
|---|---|---|---|---|
| 1 | Serie absentă → refuz; serie inițializată fără alocări + două alocări simultane → numere diferite, consecutive după prag | `p1_serie_absenta`, `p1_consecutive_secvential` | `t_p1_serie` | `C1_prima_alocare_simultana` |
| 2 | Aceeași cheie + aceiași parametri → același cod; parametri diferiți → eroare (alocare ȘI revizie) | `p2_cheie_aloca`, `p2_cheie_revizie`, `p_reluare_dupa_retragere` | `t_p2_cheie` | `C2_retry_dupa_timeout` |
| 3 | Revizie nouă de două ori în paralel → o singură Rev1 (chei diferite: Rev1 + Rev2) | `p3_revizii_secvential` | `t_p3_revizii` | `C3_revizii_simultane` |
| 4 | Anulare → numărul nu se refolosește; limitele intervalului → refuz, fără trecere în alt interval | `p4_anulare`, `p4_motiv_anulare`, `p4_operatii_dupa_anulare`, `p4_limite_interval` | `t_p4_anulare_limite` | `C4_anulare_vs_revizie`, `C4b_anulare_vs_anexa` |
| 5 | Import de două ori → nicio dublură în `dcc_istoric_aparitii` | `p5_import_idempotent`, `p5_import_chei_refuzate` | `t_p5_import` | — |
| 6 | „Confirm că am trimis” fără căsuță și fără Message-ID → „neverificat”, nicio valoare inventată | `p6_confirma_manual` | `t_p6_confirma` | — |
| 7 | Acces doar pe Lot 1 → nici citire, nici scriere pe Lot 2 (RPC + SELECT / INSERT / UPDATE / DELETE direct) — **și între două proiecte ale aceluiași contract** | `p7_acces_intre_contracte`, `p7b_doua_proiecte_acelasi_contract` | `t_p7_acces`, `t_p7b_acelasi_contract` | `C5_drept_retras_in_asteptare` |
| 8 | Două proiecte ERP pe același contract → nu pot aloca același cod | `p8_doua_proiecte_un_contract` | `t_p8_contract_comun` | `C1b_doua_proiecte_simultan` |

**Contraexemplele din verdictul r1, fiecare cu test (și cu mutantul care trebuie prins):**

| CE | Contraexemplu | PGlite | Clonă | Concurență | Mutant |
|---|---|---|---|---|---|
| CE1 | Utilizator restrâns la P1, P2 pe același contract → vedea documentele / istoricul / mesajele / snapshoturile P2 | `p7b_doua_proiecte_acelasi_contract` | `t_p7b_acelasi_contract` | — | `citire_pe_contract` |
| CE2 | P1 inițializează `SR1 = 100–199` din G1, P2 `SR2 = 150–249` din G2, aceeași cheie | `p_intervale_intre_ghiduri`, `p_ghid_incompatibil` | `t_p1_serie` (bloc 2) | `C6_initializari_suprapuse`, `C6b_ghid_vs_initializare` | `advisory_cu_interval`, `fara_disjunctie_serii`, `fara_advisory_contract` |
| CE3 | `BEN/30` și `ALT/30` produc același text de cod → al doilea refuzat | `p_cod_text_doua_contracte`, `p_cod_text_coliziune_ghiduri` | `t_p8_contract_comun` (bloc 2) | — | `cod_text_unic_global` |
| CE4 | Anexă / filă / copiat / confirmat pe document anulat | `p4_operatii_dupa_anulare` | `t_p4_anulare_limite` (bloc 3) | `C4b_anulare_vs_anexa` | `fila_pe_document_anulat`, `anexa_rpc_fara_stare` |
| CE5 | Revocarea comisă ÎNAINTEA primei verificări → C5 nu discriminează | — | — | `C5_drept_retras_in_asteptare` (ordinea fixată + observatorul) | `fara_reverificare` |
| CE6 | Reluarea unei intenții deja comise după retragerea dreptului | `p_reluare_dupa_retragere` | `t_p2_cheie` (bloc 3) | — | `reia_dupa_drept` |
| CE7 | Apel API fără JWT confundat cu sesiunea `postgres` | `p_d5_identitati` | `t_d5_identitati` | — | `server_fara_session_user` |

În plus, cerute explicit review-ului: (a) lanțul de idempotență (claim → lock → reverificare drept → scriere → rezultat) și ordinea lock-urilor (L01 / L04 / L06); (b) formatorul SQL ↔ JS pe tabelul comun de cazuri (L19); (c) revenirea: refuz cu date, aplicare → revenire → reaplicare (L14).

---

## Decizii de construcție (review-ul le poate întoarce înainte de cod)

- **[D1] Citirea conținutului e STRICT pe proiectul DCC al documentului; numerotarea e a contractului.** Specificația (§4.2) păstrează `proiect_dcc` ca asociere / acces; domeniul comun al numerotării nu dă acces comun la corespondență. Concret:
  - `dcc_documente`, `dcc_file`, `dcc_anexe`, `dcc_revizii`, `dcc_istoric_aparitii`, `dcc_mesaje`, `dcc_snapshoturi`, `dcc_snapshot_revizii`, `dcc_legaturi`, `v_dcc_registru` se citesc DOAR cu `fn_dcc_drept(<proiectul DCC al rândului>, 'citire')`. Fiecare dintre aceste tabele are `proiect_dcc_id` (direct sau prin document / mesaj / snapshot) — istoricul și mesajele primesc coloana `proiect_dcc_id` (Abaterea 7).
  - `dcc_proiecte` → `fn_dcc_drept(id, 'citire')`; `dcc_contracte` → vizibil doar dacă utilizatorul are `citire` pe un proiect DCC propriu al contractului (`fn_dcc_contract_vizibil`, folosit EXCLUSIV în politica `dcc_contracte`; `$post$` verifică textul tuturor politicilor); `dcc_ghiduri` / valori / intervale = configurație comună de codificare, `fn_dcc_are_modul()`.
  - `dcc_serii`: fără GRANT pentru clienți; se citește prin `fn_dcc_serii_proiect(p_proiect_dcc)` (DEFINER, `citire` pe proiect), care întoarce doar seriile contractului pe emitentul proiectului: cheia, intervalul, limitele, `prag_initial`, `ultimul_ocupat`, `urmatorul`, `epuizata`, `initializata_la` / `_prin`, `motiv_prag` — nicio coloană a altui proiect (seria nu are proiect).
  - **Cum rămâne alocarea corectă fără citirea altor proiecte:** RPC-urile de scriere sunt `SECURITY DEFINER` (owner `postgres`, deci RLS nu le filtrează): contorul e pe rândul seriei (contract), luat `FOR UPDATE`; unicitatea `(contract, emitent, tematică, tip, secvență)` și `(contract, cod_text, limba)` o impun constrângerile UNIQUE, care văd tot tabelul indiferent de RLS; disjuncția seriilor și compatibilitatea ghidului le verifică RPC-ul + triggerul pe toate seriile contractului. Apelantul primește înapoi doar ce a scris el.
  - **Ce află un utilizator despre celelalte proiecte ale aceluiași contract (divulgare minimă, declarată):** doar NUMERE de secvență ocupate — prin contor (`urmatorul`, inerent numerotării comune), prin `DCC_COD_OCUPAT` la alocarea manuală și prin pragurile de la inițializare (`DCC_PRAG_SUB_DOCUMENTE` / `DCC_PRAG_SUB_ISTORIC`, nivel `admin`). Niciodată titluri, revizii, stări, mesaje, id-uri sau proiectul care ocupă numărul; mesajele de eroare sunt testate să nu le conțină (`p7b`).
  - Testul `p7b_doua_proiecte_acelasi_contract` (și `t_p7b_acelasi_contract` pe clonă) are exact forma cerută: două proiecte pe același contract, utilizatorul autorizat doar pe unul.
- **[D2] `mod_alocare` stă pe `dcc_contracte`, fixat la creare și IMUABIL** (asumat explicit). Domeniul numerotării e contractul (§4.2); două proiecte ale aceluiași contract cu moduri diferite ar putea ocupa manual numere din contorul automat. Pe un contract `automat`, `fn_dcc_aloca_manual` refuză (`DCC_MOD_AUTOMAT`); pe un contract `manual`, `fn_dcc_aloca` / `fn_dcc_initializeaza_serie` refuză (`DCC_MOD_MANUAL`). Triggerul BEFORE UPDATE pe `dcc_contracte` refuză orice schimbare a `beneficiar` / `cod_contract` / `mod_alocare` pe orice cale, inclusiv `postgres` (`DCC_CONTRACT_IMUABIL`). **Schimbarea modului = operație a proprietarului, auditată, într-o migrare proprie** (nu în PR1): dezactivează explicit garda în tranzacția ei, scrie rândul de audit (vechi → nou, motiv, autor) și se aplică doar cu „da”-ul proprietarului. Costul asumat: Lot 4 (`manual`, §8.3) trece la `automat` doar prin acea operație.
- **[D3] Filele se declară la alocare.** `fn_dcc_aloca(…, p_nr_file)`: `NULL` = document fără planșe (Rev0 pe document); `N ≥ 1` = filele 1..N, fiecare cu Rev0 (fără revizie la nivel de document). Un document creat fără file nu primește file ulterior; unul cu file primește file noi prin `fn_dcc_fila_noua`. Pe un document anulat nu se creează nimic (gărzile din Task 3).
- **[D4] Limba Rev0 e parametru** (`p_limba`; `NULL` = `dcc_proiecte.limba_implicita`). Formatorul refuză dacă ghidul cere limba (în cod SAU în numele fișierului) și limba lipsește.
- **[D5] Calea serverului = sesiune `postgres` fără JWT; un apel API fără JWT NU e calea serverului.** `fn_dcc_server()` (INVOKER, ca `fn_rest_decontat_server`) = `auth.uid() IS NULL AND session_user = 'postgres' AND current_user = 'postgres'`. Distincția se face pe `session_user`: orice apel prin API intră ca `authenticator` (`session_user = 'authenticator'`) și schimbă rolul în `anon` / `authenticated` / `service_role`; în interiorul unui RPC DEFINER `current_user` devine `postgres`, dar `session_user` rămâne `authenticator`. Matricea (testată în `p_d5_identitati` / `t_d5_identitati`):

  | Identitatea | `session_user` / rol | `auth.uid()` | Rezultat |
  |---|---|---|---|
  | psql / runner ca `postgres`, fără GUC-uri JWT | `postgres` / `postgres` | NULL | calea serverului: DOAR configurare, import istoric, inițializarea seriilor; alocare / revizie / anulare / copiat / confirmat → 42501 `DCC_NEAUTENTIFICAT` |
  | API fără JWT (cheia anon) | `authenticator` / `anon` | NULL | fără EXECUTE pe nicio funcție `fn_dcc_*` → 42501 `permission denied` |
  | API cu rolul `authenticated`, fără `sub` (claims goale) | `authenticator` / `authenticated` | NULL | `fn_dcc_server()` fals (session_user) → 42501 `DCC_NEAUTENTIFICAT` pe orice RPC |
  | API `service_role` | `authenticator` / `service_role` | NULL | fără EXECUTE → 42501 |
  | API `authenticated` cu JWT | `authenticator` / `authenticated` | uuid | omul, cu dreptul lui |
  | sesiune `postgres` cu `request.jwt.claim.sub` setat | `postgres` / `postgres` | uuid | tratată ca omul respectiv (NU calea serverului) — superutilizatorul poate oricum orice; documentat, nu e o cale a aplicației |

  Autorul pe calea serverului = `NULL` + `actor = 'server'` / `*_prin = 'server'`.
- **[D6] Emitentul la alocare = emitentul proiectului DCC.** `p_emitent` rămâne în semnătură (ca în §4.2), dar trebuie să fie egal cu `dcc_proiecte.emitent` (altfel `DCC_EMITENT_STRAIN`). Înregistrarea documentelor subcontractorilor (emitent propriu) = după PR3, prin altă operație.
- **[D7] Anularea cere nivelul `admin`** pe sub-modul (sau owner) și motiv nevid (păstrat pe document ȘI pe fiecare revizie anulată); revizia nouă / fila / anexa / copiat / confirmat cer `scriere` (editor / admin).

## Abateri declarate față de textul specificației

1. `fn_dcc_aloca` / `fn_dcc_aloca_manual` primesc în plus `p_limba` și `p_nr_file` ([D3], [D4]); `fn_dcc_revizie_noua` primește `p_titlu` și `p_limba` (titlul reviziei e în §4.2; limba face parte din identitate).
2. `mod_alocare` pe contract, imuabil ([D2]; specificația îl pune pe `dcc_proiecte`).
3. Unicitatea cu tematica `NULL` se impune prin `UNIQUE NULLS NOT DISTINCT` (PG ≥ 15) în loc de un index parțial separat — aceeași garanție, o singură constrângere pentru minute și pentru restul; testul `p_mom_unicitate` o dovedește.
4. RPC-uri în plus față de lista din §4.2, necesare ca tabelele să poată fi scrise fără INSERT direct: `fn_dcc_ghid_creeaza`, `fn_dcc_contract_creeaza`, `fn_dcc_proiect_seteaza`, `fn_dcc_fila_noua`, `fn_dcc_anexa_noua`, `fn_dcc_istoric_importa` (proba 5 cere importul încă din PR1), plus citirea `fn_dcc_serii_proiect` ([D1]). Legarea aparițiilor de documente (`fn_dcc_istoric_leaga`) și verdictul DCC rămân în PR3 / B; coloanele există.
5. Variantele lingvistice ale aceleiași revizii: structura există (limba e în identitatea reviziei), dar niciun RPC din PR1 nu creează o a doua limbă pe aceeași revizie (§4.2: „dacă DCC le cere separat” — neconfirmat). Capacitate AMÂNATĂ, nu acoperită.
6. **Unicitatea textului codului: pe CONTRACT, nu globală** — `UNIQUE NULLS NOT DISTINCT (contract_id, cod_text, limba)` pe `dcc_revizii`. Specificația nu o cere explicit; e o plasă de siguranță pentru regula „nu se alocă același cod unor documente diferite” (§2) atunci când două versiuni de ghid ale aceluiași contract formatează diferit (ex. prefixul filei într-o versiune = prefixul anexei în alta). Unicitatea globală din r1 era greșită: formatul nu conține beneficiarul, deci `BEN/30` și `ALT/30` produc legitim același text (CE3). `limba` e în cheie pentru că la Lot 2 codul nu conține limba, iar variantele lingvistice ale aceleiași revizii au același cod.
7. **`proiect_dcc_id` pe `dcc_istoric_aparitii` și pe `dcc_mesaje`** ([D1]): istoricul se importă pe un proiect DCC (identitatea sursei e unică pe proiect), mesajele aparțin proiectului reviziilor lor (legătura cere același proiect). Maximul istoric pentru prag se calculează pe tot contractul, în RPC-ul DEFINER. Etapa B decide prin migrarea ei cum atribuie proiectul mesajelor citite din căsuță.
8. **Citirea strictă pe proiect** ([D1]) — specificația spune „acces prin `executie_dcc` și prin `fn_executie_proiect_permis(proiect, …)`”; planul o aplică pe proiectul fiecărui rând, cu divulgarea minimă a numerelor ocupate declarată la [D1].

## Modelul de acces și lock-urile (comune tuturor task-urilor)

### Ordinea globală a lock-urilor (L06), aceeași pe toate căile

| Pas | Obiect | Mod | Cine îl ia |
|---|---|---|---|
| 1 | rândul cheii în `dcc_intentii` | index unic, la INSERT (claim) | toate RPC-urile de scriere |
| 2 | `pg_advisory_xact_lock[_shared](hashtextextended('dcc_contract:' \|\| contract_id, 0))` | EXCLUSIV: `fn_dcc_proiect_seteaza` (creare / schimbare de ghid); PARTAJAT: `fn_dcc_initializeaza_serie`, `fn_dcc_aloca_manual` | config + inițializare |
| 3 | `dcc_proiecte` | `FOR SHARE` (proiectul apelului / al documentului); `FOR UPDATE` doar în `fn_dcc_proiect_seteaza` | toate |
| 4 | `pg_advisory_xact_lock(hashtextextended('dcc_cheie:' \|\| contract_id \|\| '\|' \|\| emitent \|\| '\|' \|\| coalesce(tematica, '-') \|\| '\|' \|\| tip, 0))` — cheia seriei FĂRĂ interval | exclusiv | `fn_dcc_initializeaza_serie`, `fn_dcc_aloca_manual`, triggerul BEFORE INSERT pe `dcc_serii` (reintrant) |
| 5 | `dcc_serii` | `FOR UPDATE` | `fn_dcc_aloca` |
| 6 | `dcc_documente` | `FOR UPDATE … ORDER BY id` | revizie / filă / anexă / anulare / copiat / confirmat |
| 7 | INSERT / UPDATE `dcc_documente`, `dcc_file`, `dcc_anexe`, `dcc_revizii`, `dcc_istoric_aparitii` | implicit | — |
| 8 | INSERT `dcc_snapshoturi`, `dcc_snapshot_revizii`, `dcc_mesaje`, `dcc_legaturi` | implicit | copiat / confirmat |
| 9 | UPDATE `dcc_intentii` (rezultatul) | implicit | toate |

Lock-uri implicite: cheile străine iau `FOR KEY SHARE` pe `dcc_contracte` / `dcc_proiecte` / `dcc_serii` / `dcc_documente` / `dcc_ghiduri` / `executie_proiecte` (compatibile cu `FOR SHARE` / `FOR UPDATE` ținute de aceeași tranzacție; nimeni nu ia `FOR UPDATE` pe `dcc_contracte` — rândul e imuabil). Triggerul de disjuncție a intervalelor ghidului blochează doar `dcc_ghiduri` (folosit numai de `fn_dcc_ghid_creeaza`, care nu ia alte lock-uri ale registrului). Lipsa ciclului: `fn_dcc_aloca` nu ia pașii 2 și 4; `fn_dcc_proiect_seteaza` nu ia pașii 4–6; inițializarea ia 2 (partajat) → 3 → 4 și nu ia 5–6. Testele `C6b` și `C1b` o exercită.

### Lock-urile migrării și ale revenirii (setul și ordinea)

- **Migrarea** (punct unic `$lock$`, după `$pre$`, înaintea oricărui DDL): runnerul ține deja `pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'))`. Migrarea ia `lock_timeout = 100ms` și bugetul de 1 s (ceasul pornit imediat înaintea primei încercări, verificat înaintea fiecărei încercări și după obținerea setului), fiecare încercare într-o subtranzacție:
  1. `LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT` — singurul tabel existent atins (cheia străină din `dcc_proiecte`; același mod pe care îl ia `ADD FOREIGN KEY`).
  Nimic altceva existent nu se blochează: funcțiile care citesc `profiles` / `user_module_access` / `executie_acces_proiect` sunt plpgsql (fără analiză la creare), vederea citește doar tabele `dcc_*`. **Postcondiția de lock-uri** în `$post$`: `pg_locks` al backend-ului curent (`pid = pg_backend_pid()`, `locktype = 'relation'`, baza curentă) conține doar relații `dcc_*` noi (+ indecșii / secvențele lor), `executie_proiecte` în `ShareRowExclusiveLock` (și moduri mai slabe) și catalogul sistem; orice altă relație = refuz (`L15_LOCK_NEDECLARAT`). Testat în PGlite prin mutantul `functie_sql_pe_profiles` (o funcție de drept în `LANGUAGE sql` → lock pe `profiles` → refuz).
- **Revenirea** (după gărzi și starea exactă din catalog, ÎNAINTEA verificării „fără date”), același buget / `lock_timeout`, NOWAIT, ACCESS EXCLUSIVE, în ordinea inversă a cheilor străine: `dcc_legaturi`, `dcc_snapshot_revizii`, `dcc_mesaje`, `dcc_snapshoturi`, `dcc_istoric_aparitii`, `dcc_revizii`, `dcc_anexe`, `dcc_file`, `dcc_documente`, `dcc_serii`, `dcc_intentii`, `dcc_proiecte`, `dcc_contracte`, `dcc_ghid_intervale`, `dcc_ghid_valori`, `dcc_ghiduri`, `dcc_casute`; apoi `executie_proiecte` în modul pe care îl cere eliminarea triggerelor RI ale cheii străine, luat EXPLICIT și NOWAIT ultimul. Modul exact se fixează în PGlite: testul `rev_lock_set` rulează revenirea și compară `pg_locks` de după DROP-uri cu setul declarat (orice lock nedeclarat = test picat), iar valoarea se scrie în antetul revenirii.

---

### Task 1: Formatorul de cod și de nume de fișier (JS + tabelul comun de cazuri)

**Files:**
- Create: `src/dcc/dccCod.js`
- Create: `src/dcc/dccCodCazuri.json` (tabelul de cazuri, valorile așteptate scrise de mână — L25)
- Test: `src/dcc/dccCod.test.js`

**Interfaces:**
- Formatul (în ghid, `dcc_ghiduri.format_cod` și `dcc_ghiduri.format_fisier`, jsonb): un tablou ordonat de segmente `{"camp": <c>, "prefix": <text>, "cifre": <int|null>}`, cu `camp` ∈ `contract | emitent | tematica | tip | secventa | fila | anexa | revizie | limba`. `prefix` = textul pus înaintea valorii (separatorul și eticheta: `"-"`, `".Rev"`, `"."`, `"-A"`), din alfabetul `[-._A-Za-z]{0,6}`; `cifre` = completare cu zerouri (obligatoriu 5 la `secventa`, 1..3 la `fila` / `anexa`, absent în rest). Reguli de validare (`formatValid` / `fn_dcc_format_valid`): fiecare câmp cel mult o dată; **`contract`, `emitent`, `tematica`, `tip`, `secventa`, `fila`, `anexa`, `revizie` obligatorii în ambele formate** (un câmp cu valoare NULL se omite oricum la formatare, deci prezența lui nu costă nimic, iar lipsa lui ar face două identități diferite să dea același text); `limba` opțional în cod (Lot 2), dar dacă lipsește din `format_cod` trebuie să fie în `format_fisier`; primul segment fără prefix; prefixele `fila` și `anexa` diferite între ele.
  Exemplul formei DCC Lot 1 (§2): `[{contract,""},{emitent,"-"},{tematica,"-"},{tip,"-"},{secventa,"-",5},{fila,"-",2},{anexa,"-A",2},{revizie,".Rev"},{limba,"."}]` → `30-AAA-TM1-COR-00045.Rev0.RO`.
- Componentele: `{contract, emitent, tematica|null, tip, secventa, fila|null, anexa|null, revizie, limba|null}`. Un segment al unui câmp opțional NULL (`tematica` la MOM, `fila`, `anexa`) se omite ÎMPREUNĂ cu prefixul lui; `limba` NULL cu segment `limba` în format = eroare `DCC_LIMBA_LIPSA`; obligatoriu NULL = `DCC_CAMP_LIPSA`; `secventa` ∉ 1..99999, `revizie` < 0, `fila` / `anexa` peste numărul de cifre = `DCC_VALOARE_INVALIDA`.
- `export function codDcc(format, comp) -> string` (aruncă `Error` cu codul de mai sus).
- `export function titluScurtDcc(titlu) -> string`: diacriticele românești (ă â î ș ş ț ţ și majusculele) → ASCII printr-o hartă EXPLICITĂ (aceeași în SQL, `translate()`), orice alt caracter din afara `[A-Za-z0-9]` → `_`, `_` repetate → unul, fără `_` la capete, tăiat la 60 de caractere (apoi fără `_` final); gol → `DCC_TITLU_SCURT_GOL`.
- `export function numeFisierDcc(formatFisier, comp, titluScurt, ext) -> string` = `codDcc(formatFisier, comp) + "_" + titluScurtDcc(titluScurt) + "." + ext`; `ext` ∈ `^[a-z0-9]{1,8}$` după `toLowerCase()`, altfel `DCC_EXTENSIE_INVALIDA`.
- `export function formatValid(format) -> boolean`.
- `dccCodCazuri.json`: `{ "formate": {"lot1": […], "lot2_cod": […], "lot2_fisier": […], "dde": […]}, "cazuri": [{ "id", "format", "comp", "titlu_scurt"?, "ext"?, "asteptat"?, "eroare"? }] }` — minim 30 de cazuri: Rev0 / Rev1 / Rev12, MOM fără tematică, filă, anexă, filă + anexă, Lot 2 cu limba doar în numele fișierului, forma DDE cu limba înaintea reviziei, secvențe 1 / 100 / 199 / 99999, diacritice + caractere speciale + titlu de 80 de caractere în titlul scurt, extensie cu majuscule, fiecare eroare de mai sus.

- [ ] **Step 1: Write the failing test** `src/dcc/dccCod.test.js`: pentru fiecare caz din `dccCodCazuri.json` — `asteptat` ⇒ `codDcc` / `numeFisierDcc` dau exact șirul; `eroare` ⇒ aruncă cu mesajul care începe cu codul. Plus: `formatValid` refuză câmp dublat, lipsa `revizie`, lipsa `fila`, lipsa `anexa`, lipsa `tematica`, `limba` lipsă în ambele formate, prefix `fila` = prefix `anexa`, prefix cu spațiu, primul segment cu prefix, `cifre` 4 la `secventa`.
- [ ] **Step 2: Run** `npx vitest run src/dcc` → FAIL (modulul nu există).
- [ ] **Step 3: Implement** `src/dcc/dccCod.js` (funcții pure, fără importuri).
- [ ] **Step 4: Run** `npx vitest run src/dcc` → PASS.
- [ ] **Step 5: Commit** `feat(executie): registru DCC — formatorul de cod si de nume de fisier (JS + cazuri)`.

### Ce trece la fiecare commit (Task 2–7)

Scriptul PGlite are blocuri etichetate cu task-ul lor (`t2_*`, `t3_*` …) și opțiunea `--pana-la tN` (rulează aplicarea secțiunilor migrării scrise până atunci + DOAR blocurile `t2 … tN`). Migrarea e scrisă în ordinea secțiunilor de mai jos, deci la fiecare commit fișierul e o migrare validă, mai mică. Fiecare tabel apare împreună cu RLS-ul, politicile și GRANT-urile lui, iar protocolul cheii de intenție există înaintea primului RPC de scriere.

| Commit | Secțiunile migrării | Trebuie să treacă |
|---|---|---|
| Task 2 | 0 gărzi + lock, 1 pure, 2 configurare (tabele + RLS + GRANT), 3 dreptul, 4 intenții, 5 RPC-urile de configurare | `npx vitest run src/dcc`; `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t2` |
| Task 3 | + 6 registrul (tabele + RLS + GRANT), 7 RPC-urile registrului, 8 vederea + `fn_dcc_serii_proiect` | `--pana-la t3` |
| Task 4 | + 9 istoricul + importul | `--pana-la t4` |
| Task 5 | + 10 mesaje / snapshoturi / legături, 11 copiat / confirmat | `--pana-la t5` |
| Task 6 | + 12 TRUNCATE + `$post$` (inclusiv postcondiția de lock-uri) | `--pana-la t6` |
| Task 7 | revenirea, manifestul obiectelor, dry-run, concurența | scriptul complet (fără `--pana-la`), `bash -n`, `libpg-query` |

### Task 2: Migrarea — gărzile, ajutătoarele pure, configurarea, dreptul, intențiile, RPC-urile de configurare (secțiunile 0–5)

**Files:**
- Create: `supabase/migrations/20270108a_executie_dcc_registru.sql` (numărul verificat liber pe toate branch-urile `origin` la 24.11.2026 — ultimul ocupat: 20270106a; se reverifică cu `git log --remotes=origin --name-only --format= -- "supabase/migrations/2027*"` înainte de commit)
- Create: `supabase/tests/20270108a_executie_dcc_registru_schelet.sql` (schema falsă tip Supabase: rolurile `anon` / `authenticated` / `service_role` BYPASSRLS / `authenticator` (NOINHERIT, cu `GRANT anon, authenticated, service_role TO authenticator`), `auth.uid()` din `request.jwt.claim.sub` apoi `request.jwt.claims`, `profiles(id uuid, is_owner, employee_id)`, `user_module_access(profile_id, module, access_level)`, `executie_proiecte(id bigint, …)`, plus lanțul 20261209a extras EXACT, cu amprentele egale constantelor din migrare — ca `20270106a_executie_semnale_schelet.sql`)
- Create: `scripts/pglite/test_executie_dcc_registru_local.mjs` (crește la fiecare task)

**Interfaces (secțiunile migrării, marcate `-- ─── N.` ca proba de concurență să le poată extrage):**

`-- ─── 0.` garda `$pre$` + lock-ul `$lock$` (setul din „Lock-urile migrării”).

`-- ─── 1. ajutătoare pure`
- `fn_dcc_format_valid(p jsonb) returns boolean` IMMUTABLE — regulile din Task 1.
- `fn_dcc_cod_text(p_format jsonb, p_contract text, p_emitent text, p_tematica text, p_tip text, p_secventa integer, p_fila integer, p_anexa integer, p_revizie integer, p_limba text) returns text` IMMUTABLE — oglinda exactă a `codDcc`; erorile cu aceleași coduri, SQLSTATE 22023.
- `fn_dcc_titlu_scurt(p_titlu text) returns text` IMMUTABLE — oglinda `titluScurtDcc` (`translate()` cu harta explicită, apoi `regexp_replace` cu clase POSIX ASCII; L13).
- `fn_dcc_nume_fisier(p_format jsonb, p_contract text, p_emitent text, p_tematica text, p_tip text, p_secventa integer, p_fila integer, p_anexa integer, p_revizie integer, p_limba text, p_titlu_scurt text, p_ext text) returns text` IMMUTABLE.
- `fn_dcc_hash_parametri(p_operatie text, p_parametri jsonb) returns text` IMMUTABLE — `encode(sha256(convert_to(jsonb_build_object('op', p_operatie, 'p', p_parametri)::text, 'UTF8')), 'hex')` (jsonb are ordinea cheilor canonică; `p_parametri` e deja normalizat, vezi „Normalizarea” din Task 3).
- `fn_dcc_tranzitie_permisa(p_vechi text, p_nou text) returns boolean` IMMUTABLE — tabelul TRANZIȚIILOR din Task 3 (singura definiție; CHECK-ul de stări e derivat din el, L20).

`-- ─── 2. configurarea` (fiecare tabel cu RLS, politica `FOR SELECT` din [D1], `REVOKE ALL` + `GRANT SELECT` în aceeași secțiune; politicile cheamă funcțiile din secțiunea 3 — PostgreSQL acceptă politica doar dacă funcția există, deci politicile secțiunii 2 se scriu la sfârșitul secțiunii 3)
- `dcc_casute(id, adresa text not null unique check (adresa = lower(adresa) AND adresa ~ '^[^@[:space:]]+@[^@[:space:]]+$'), tip text not null check in ('dedicata','personala'), proprietar uuid, stare_conectare text not null default 'neconectata' check in ('neconectata','conectata','revocata'), creat_de uuid, creat_la, check ((tip = 'personala') = (proprietar IS NOT NULL)))` — structura pentru PR4 / B, goală în v1; RLS activ, nicio politică, niciun GRANT, niciun RPC în PR1.
- `dcc_ghiduri(id bigint identity pk, cod text not null check (cod ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'), versiune int not null check (versiune >= 1), sursa text not null check (sursa ~ '[^[:space:]]'), format_cod jsonb not null check (fn_dcc_format_valid(format_cod)), format_fisier jsonb not null check (fn_dcc_format_valid(format_fisier)), creat_de uuid, creat_la timestamptz not null default now(), unique (cod, versiune))`.
- `dcc_ghid_valori(id, ghid_id bigint not null fk, categorie text not null check in ('emitent','tematica','tip','limba'), cod text not null, descriere text, fara_tematica boolean not null default false, activ boolean not null default true, unique (ghid_id, categorie, cod), check` pe formă: emitent `^[A-Z]{3}$`, tematica `^[A-Z0-9]{2,4}$`, tip `^[A-Z]{2,4}$`, limba `^(RO|EN|BI)$`; `check (fara_tematica = false OR categorie = 'tip')`)`.
- `dcc_ghid_intervale(id, ghid_id fk, interval text not null check (interval ~ '^(general|[A-Z]{1,4}[0-9]{1,3})$'), limita_inf int not null, limita_sup int not null, check (1 <= limita_inf AND limita_inf <= limita_sup AND limita_sup <= 99999), unique (ghid_id, interval))`. Disjuncția intervalelor aceluiași ghid: trigger BEFORE INSERT `trg_dcc_ghid_intervale_disjuncte` care ia `FOR UPDATE` pe rândul `dcc_ghiduri` părinte (L01) și refuză suprapunerea (23P01 `DCC_INTERVALE_SUPRAPUSE`). Fără `EXCLUDE` (ar cere `btree_gist`). Disjuncția ÎNTRE ghiduri e impusă pe seriile efective (Task 3).
- **Ghid înghețat:** triggere BEFORE UPDATE / DELETE pe `dcc_ghiduri`, `dcc_ghid_valori`, `dcc_ghid_intervale` → refuz (`DCC_GHID_IMUABIL`), cu o singură excepție: `dcc_ghid_valori.activ` poate trece `true → false`. Orice altă schimbare = versiune nouă (`fn_dcc_ghid_creeaza`).
- `dcc_contracte(id, beneficiar text not null check (beneficiar ~ '^[A-Z]{2,6}$'), cod_contract text not null check (cod_contract ~ '^[0-9]{2}$'), mod_alocare text not null check in ('automat','manual'), descriere text, creat_de uuid, creat_prin text not null check in ('om','server'), creat_la, unique (beneficiar, cod_contract))` — [D2]: trigger BEFORE UPDATE `trg_dcc_contracte_imuabil` refuză orice schimbare a `beneficiar` / `cod_contract` / `mod_alocare` (și pentru `postgres`); `descriere` nu are RPC de modificare în PR1; DELETE refuzat.
- `dcc_proiecte(id, contract_id bigint not null fk, executie_proiect_id bigint not null fk executie_proiecte(id), ghid_id bigint not null fk, emitent text not null, limba_implicita text check in ('RO','EN','BI'), adresa_dcc text check (adresa_dcc IS NULL OR adresa_dcc ~ '^[^@[:space:]]+@[^@[:space:]]+$'), cc_lista text[] not null default '{}', cc_implicit jsonb not null default '{}' check (jsonb_typeof(cc_implicit) = 'object'), antet_financiar text, plafon_atasamente_mb int not null default 15 check (plafon_atasamente_mb between 1 and 25), casuta_id bigint null fk dcc_casute check (casuta_id IS NULL), trimitere_permisa boolean not null default false check (trimitere_permisa = false), versiune int not null default 1, creat_de uuid, creat_la, actualizat_de uuid, actualizat_la, unique (executie_proiect_id, contract_id), unique (id, contract_id))` — `unique (id, contract_id)` servește cheile străine compuse. Trigger BEFORE INSERT / UPDATE: `emitent` ∈ valorile active `emitent` ale ghidului; ghidul compatibil cu seriile contractului (regula din Task 3, aceeași funcție `fn_dcc_ghid_compatibil_intern`; triggerul ia el însuși advisory-ul EXCLUSIV al contractului, reintrant în RPC, deci regula ține și pe o scriere directă ca `postgres`); `contract_id`, `executie_proiect_id`, `emitent` imuabile după ce există documente pe proiect; versiunea crește la orice UPDATE. DELETE refuzat.

`-- ─── 3. dreptul` (toate plpgsql; politicile secțiunii 2 la final)
- `fn_dcc_server() returns boolean` — INVOKER, [D5]: `auth.uid() IS NULL AND session_user = 'postgres' AND current_user = 'postgres'`; EXECUTE `authenticated`.
- `fn_dcc_e_owner() returns boolean` — STABLE DEFINER; `profiles.is_owner` al lui `auth.uid()` (fals la `auth.uid() IS NULL`).
- `fn_dcc_drept(p_proiect_dcc bigint, p_nivel text) returns boolean` — STABLE DEFINER, **singura definiție a dreptului** (L19): `auth.uid() IS NOT NULL` ∧ `p_nivel ∈ ('citire','scriere','admin')` ∧ există `dcc_proiecte d` cu `d.id = p_proiect_dcc` ∧ `fn_executie_proiect_permis(d.executie_proiect_id, p_nivel <> 'citire') IS TRUE` ∧ (owner ∨ `user_module_access` cu `module = 'executie_dcc'` și `access_level` ∈ {`viewer`,`editor`,`admin`} la citire, {`editor`,`admin`} la scriere, {`admin`} la admin). Accesul general `executie` NU dă nimic.
- `fn_dcc_contract_vizibil(p_contract bigint) returns boolean` — [D1], DOAR pentru politica `dcc_contracte`: `EXISTS (SELECT 1 FROM dcc_proiecte d WHERE d.contract_id = p_contract AND fn_dcc_drept(d.id, 'citire'))`.
- `fn_dcc_are_modul() returns boolean` — owner ∨ orice rând `executie_dcc` (citirea configurației comune: ghiduri, valori, intervale).
- Politicile secțiunii 2: ghiduri / valori / intervale → `fn_dcc_are_modul()`; `dcc_contracte` → `fn_dcc_contract_vizibil(id)`; `dcc_proiecte` → `fn_dcc_drept(id, 'citire')`.

`-- ─── 4. cheile de intenție` (comun tuturor RPC-urilor; L04 / L05)
- `dcc_intentii(cheie uuid pk, operatie text not null check in ('ghid_creeaza','contract_creeaza','proiect_seteaza','initializeaza_serie','aloca','aloca_manual','revizie_noua','fila_noua','anexa_noua','anuleaza','marcheaza_copiat','confirma_trimis_manual','istoric_importa'), parametri_hash text not null check (parametri_hash ~ '^[0-9a-f]{64}$'), autor uuid null, actor text not null check in ('om','server'), check ((actor = 'server') = (autor IS NULL)), rezultat jsonb null, creat_la timestamptz not null default now())` — RLS activ, nicio politică, niciun GRANT; UPDATE permis doar `rezultat NULL → valoare` în aceeași tranzacție (trigger: `OLD.rezultat IS NULL AND xmin` al rândului = tranzacția curentă); DELETE refuzat.
- `fn_dcc_intentie_reia(p_cheie uuid, p_operatie text, p_hash text) returns jsonb` — internă, fără EXECUTE: dacă există rândul cheii: același `operatie` + `parametri_hash` + același autor (`auth.uid()` sau `NULL` pe calea serverului, comparat cu `IS NOT DISTINCT FROM`) ⇒ întoarce `rezultat || '{"reluat": true}'`; altfel `DCC_CHEIE_ALTI_PARAMETRI` (22023; același mesaj pentru altă operație, alt hash, alt autor). Nu există ⇒ `NULL`.
- `fn_dcc_intentie_revendica(p_cheie, p_operatie, p_hash) returns jsonb` — internă: `INSERT … ON CONFLICT (cheie) DO NOTHING RETURNING`; dacă n-a inserat (cererea concurentă cu aceeași cheie a comis între timp — INSERT-ul a așteptat pe indexul unic) ⇒ `fn_dcc_intentie_reia`. Întoarce `NULL` când apelul curent deține cheia.
- `fn_dcc_intentie_incheie(p_cheie, p_rezultat jsonb)` — internă: `UPDATE … SET rezultat` (o dată). `p_rezultat` NU conține `reluat`; RPC-ul întoarce `p_rezultat || '{"reluat": false}'`.
- **Ordinea în fiecare RPC de scriere** (scrisă în comentariul fiecărui RPC): (1) `auth.uid()` nenul (sau calea serverului unde e permisă, [D5]); (2) normalizarea parametrilor și validarea formei (fără citiri de date); (3) hash-ul pe parametrii NORMALIZAȚI; (4) `fn_dcc_intentie_reia` — reconcilierea unei chei deja comise se face ÎNAINTEA dreptului (un retry după timeout află rezultatul chiar dacă dreptul s-a schimbat între timp; rezultatul e doar al autorului cheii; nimic nou nu se scrie, L05); (5) dreptul (`fn_dcc_drept` pe fiecare proiect atins); (6) `fn_dcc_intentie_revendica`; (7) lock-urile (ordinea globală); (8) **reverificarea dreptului și a stării după lock** (L01: drept, `stare` document, `stare_transport`, compatibilitatea ghidului); (9) scrierile; (10) `fn_dcc_intentie_incheie`; (11) `RETURN`. O excepție după (6) anulează tot, inclusiv claim-ul (o singură tranzacție).

`-- ─── 5. RPC-urile de configurare` (owner sau [D5]; formele rezultatelor în tabelul din Task 3)
- `fn_dcc_ghid_creeaza(p_ghid jsonb, p_cheie uuid) returns jsonb` — `p_ghid = {cod, versiune, sursa, format_cod, format_fisier, valori: [{categorie, cod, descriere, fara_tematica?}], intervale: [{interval, limita_inf, limita_sup}]}`; chei necunoscute (la orice nivel) = refuz 22023 `DCC_CHEI_NECUNOSCUTE`; `valori` și `intervale` nevide, fără dubluri pe identitate (`(categorie, cod)` / `interval`) — dublura = 22023 `DCC_LISTA_DUBLURI`; totul într-o tranzacție (L02).
- `fn_dcc_contract_creeaza(p_beneficiar text, p_cod_contract text, p_mod_alocare text, p_descriere text, p_cheie uuid) returns jsonb`.
- `fn_dcc_proiect_seteaza(p_executie_proiect bigint, p_contract bigint, p_ghid bigint, p_emitent text, p_limba_implicita text, p_adresa_dcc text, p_cc text[], p_cc_implicit jsonb, p_antet_financiar text, p_plafon_mb integer, p_versiune integer, p_cheie uuid) returns jsonb` — `p_versiune NULL` = creare; altfel UPDATE CAS `WHERE versiune = p_versiune` (0 rânduri = `DCC_CONFLICT_VERSIUNE`, 40001); advisory-ul EXCLUSIV al contractului (pasul 2) înainte de verificarea compatibilității ghidului; nu poate atinge `casuta_id` / `trimitere_permisa`.

- [ ] **Step 1: Failing tests** (PGlite, blocurile `t2_*`): aplicarea secțiunilor 0–5 prin pașii runnerului (ca `test_executie_semnale_local.mjs`: marcaj + plafon extins + pașii L15 v2 generați de `scripts/livrare_amprenta_gen.sh`); apoi:
  - `t2_config`: owner creează ghidul Lot 1 sintetic, contractul `BEN/30` automat, proiectul DCC pe P1; `editor` pe sub-modul → `fn_dcc_ghid_creeaza` = 42501; ghid cu intervale suprapuse (`SR1` 100–199 + `SR2` 150–250) → 23P01; ghid cu o valoare dublată → 22023 `DCC_LISTA_DUBLURI`; UPDATE direct ca `postgres` pe `dcc_ghiduri.format_cod` → `DCC_GHID_IMUABIL`; UPDATE direct ca `postgres` pe `dcc_contracte.mod_alocare` → `DCC_CONTRACT_IMUABIL`; `fn_dcc_proiect_seteaza` cu emitent din afara ghidului → 22023; CAS cu versiune veche → 40001; UPDATE direct `trimitere_permisa = true` ca `postgres` → 23514.
  - `t2_drept`: `fn_dcc_drept` adevărat / fals pe matricea: owner, `executie_dcc` viewer / editor / admin, doar `executie` admin (fals peste tot), cont restrâns pe alt proiect prin `executie_acces_proiect` (fals), fără JWT (fals), `anon` (fără EXECUTE).
  - `p_d5_identitati`: cele șase rânduri ale matricei [D5] (`SET SESSION AUTHORIZATION authenticator` + `SET ROLE anon | authenticated | service_role` pentru apelurile API simulate; verificat la fiecare pas `session_user`, `current_user`, `auth.uid()`): `fn_dcc_contract_creeaza` ca `postgres` fără JWT → ok, `actor = server`; ca `authenticator`/`authenticated` fără `sub` → 42501 `DCC_NEAUTENTIFICAT`; ca `anon` / `service_role` → 42501 `permission denied`; ca `postgres` cu `sub` al unui editor → 42501 (nu e owner).
  - `t2_intentie`: aceeași cheie + aceiași parametri pe `fn_dcc_contract_creeaza` → `reluat: true`, un singur contract; altă operație cu aceeași cheie → 22023.
- [ ] **Step 2: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t2` → FAIL (migrarea nu există).
- [ ] **Step 3: Write** secțiunile 0–5.
- [ ] **Step 4: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t2` → PASS.
- [ ] **Step 5: Commit** `feat(executie): registru DCC — dreptul, intentiile si configurarea (20270108a, NEAPLICATA)`.

### Task 3: Registrul — serii, documente, file, anexe, revizii și RPC-urile (secțiunile 6–8)

**Files:**
- Modify: `supabase/migrations/20270108a_executie_dcc_registru.sql`
- Modify: `scripts/pglite/test_executie_dcc_registru_local.mjs`

**Interfaces:**

`-- ─── 6. tabelele registrului` (cu RLS + politici [D1] + GRANT în secțiune)
- `dcc_serii(id, contract_id bigint not null fk, emitent text not null, tematica text null, tip text not null, interval text not null, ghid_id bigint not null fk (ghidul ale cărui limite s-au copiat), limita_inf int not null, limita_sup int not null, prag_initial int not null, ultimul_ocupat int not null, motiv_prag text not null check (motiv_prag ~ '[^[:space:]]'), max_istoric_la_init int null, initializata_de uuid, initializata_prin text not null check in ('om','server'), check ((initializata_prin = 'server') = (initializata_de IS NULL)), initializata_la timestamptz not null default now(), constraint dcc_serii_cheie_uq unique nulls not distinct (contract_id, emitent, tematica, tip, interval), check (1 <= limita_inf AND limita_inf <= limita_sup AND limita_sup <= 99999), check (prag_initial between limita_inf - 1 and limita_sup), check (ultimul_ocupat between prag_initial and limita_sup))`. RLS activ, nicio politică, niciun GRANT ([D1]). Trigger BEFORE INSERT `trg_dcc_serii_disjuncte`: ia advisory-ul cheii FĂRĂ interval (pasul 4, reintrant) și refuză dacă o altă serie a aceleiași chei `(contract, emitent, tematica, tip)` — din ORICE ghid — are `[limita_inf, limita_sup]` care se suprapune (23P01 `DCC_INTERVALE_SUPRAPUSE`). Trigger BEFORE UPDATE: doar `ultimul_ocupat` se schimbă și doar crescând (`DCC_SERIE_IMUABILA`); DELETE refuzat.
- **Seriile efective: disjuncție și compatibilitatea ghidului (P1-2).** Domeniul numerotării e cheia `(contract, emitent, tematica, tip)`; intervalele EFECTIVE sunt limitele copiate în seriile ei. Reguli:
  1. Două serii ale aceleiași chei au intervale disjuncte, indiferent de ghidul din care provin (triggerul de mai sus + aceeași verificare în `fn_dcc_initializeaza_serie` după lock-ul pasului 4 — cheia advisory NU conține intervalul, deci două inițializări concurente pe intervale diferite ale aceleiași chei se serializează; `C6`).
  2. `fn_dcc_ghid_compatibil_intern(p_contract, p_ghid) returns text` (internă, NULL = compatibil): ghidul G e compatibil cu contractul C dacă pentru FIECARE serie existentă S a lui C, intervalul cu numele `S.interval` din G fie lipsește, fie are exact `[S.limita_inf, S.limita_sup]`. Chemată de triggerul `dcc_proiecte` (creare / schimbare de ghid; `fn_dcc_proiect_seteaza` ține advisory-ul EXCLUSIV al contractului, inițializarea îl ține PARTAJAT — `C6b`) → `DCC_GHID_INCOMPATIBIL` (P0001, mesajul numește intervalul, nu proiectul).
  3. La alocare (`fn_dcc_aloca`) după lock-ul seriei: ghidul CURENT al proiectului trebuie să conțină `S.interval` cu aceleași limite (altfel `DCC_GHID_INCOMPATIBIL` / `DCC_INTERVAL_NECUNOSCUT`, P0001) — plasă pentru orice cale care ar fi ocolit regula 2.
  4. Inițializarea copiază limitele din ghidul proiectului și verifică regula 1 față de toate seriile cheii.
- `dcc_documente(id, contract_id bigint not null, proiect_dcc_id bigint not null, emitent text not null, tematica text null, tip text not null, secventa int not null check (secventa between 1 and 99999), interval text null, serie_id bigint null fk dcc_serii, mod text not null check in ('automat','manual'), titlu text not null check (titlu ~ '[^[:space:]]' AND length(titlu) <= 300), are_file boolean not null, stare text not null default 'activ' check in ('activ','anulat'), anulat_de uuid, anulat_la timestamptz, motiv_anulare text, creat_de uuid not null, creat_la, foreign key (proiect_dcc_id, contract_id) references dcc_proiecte (id, contract_id), unique (id, contract_id), unique (id, proiect_dcc_id), constraint dcc_documente_cod_uq unique nulls not distinct (contract_id, emitent, tematica, tip, secventa), check ((mod = 'automat') = (serie_id IS NOT NULL AND interval IS NOT NULL)), check ((stare = 'anulat') = (anulat_la IS NOT NULL)), check (anulat_la IS NULL OR (anulat_de IS NOT NULL AND motiv_anulare ~ '[^[:space:]]' AND length(motiv_anulare) <= 500)), check (anulat_la IS NOT NULL OR (anulat_de IS NULL AND motiv_anulare IS NULL)))`. **Unicitatea NU e parțială pe `stare`**: anularea nu eliberează numărul (§4.2, proba 4). Trigger BEFORE INSERT: seria (când există) are aceeași cheie (`IS NOT DISTINCT FROM` pe tematică) și `secventa` e în limitele ei. Trigger BEFORE UPDATE: doar `stare` `activ → anulat` + câmpurile anulării; tot restul imuabil. DELETE refuzat.
- `dcc_file(id, document_id bigint not null fk, fila int not null check (fila between 1 and 999), titlu text, creat_de uuid, creat_la, unique (document_id, fila))` — imuabil.
- `dcc_anexe(id, document_id bigint not null fk, numar int not null check (numar between 1 and 999), titlu text not null, creat_de, creat_la, unique (document_id, numar))` — imuabil.
- `dcc_revizii(id, contract_id bigint not null, document_id bigint not null, fila_id bigint null fk dcc_file, anexa_id bigint null fk dcc_anexe, revizie int not null check (revizie >= 0), limba text null check (limba IS NULL OR limba in ('RO','EN','BI')), titlu text, ghid_id bigint not null fk, cod_text text not null, nume_fisier_baza text not null, stare_transport text not null default 'rezervata' check in ('rezervata','pregatita','copiata_pentru_gmail','trimisa_manual_neverificata','trimisa_manual_confirmata','trimisa_erp','necunoscut','anulata'), anulata_de uuid, anulata_la timestamptz, anulata_prin text null check (anulata_prin IS NULL OR anulata_prin in ('revizie','document')), motiv_anulare text, nr_adresa_interna text, verdict text null check (verdict IS NULL OR verdict in ('validat','nevalidat','vizat','cod_respins','observatii','A','B','C','D','E')), verdict_mesaj_id bigint null, verdict_confirmat_de uuid, verdict_confirmat_la timestamptz, creat_de uuid not null, creat_la, actualizat_la, foreign key (document_id, contract_id) references dcc_documente (id, contract_id), constraint dcc_revizii_uq unique nulls not distinct (document_id, fila_id, anexa_id, revizie, limba), constraint dcc_revizii_cod_uq unique nulls not distinct (contract_id, cod_text, limba), check (num_nonnulls(fila_id, anexa_id) <= 1), check ((stare_transport = 'anulata') = (anulata_la IS NOT NULL)), check (anulata_la IS NULL OR (anulata_de IS NOT NULL AND anulata_prin IS NOT NULL AND motiv_anulare ~ '[^[:space:]]' AND length(motiv_anulare) <= 500)), check (anulata_la IS NOT NULL OR (anulata_de IS NULL AND anulata_prin IS NULL AND motiv_anulare IS NULL)), check (verdict IS NULL OR (verdict_mesaj_id IS NOT NULL AND verdict_confirmat_de IS NOT NULL)))` — **motivul anulării unei revizii stă pe revizie** (`motiv_anulare`, `anulata_de` / `_la` / `_prin`); la anularea documentului, fiecare revizie anulată în cascadă primește `anulata_prin = 'document'` și motivul documentului (P2-7). `contract_id` denormalizat (cheia străină compusă îl leagă de document; nu se poate desincroniza) pentru unicitatea textului pe contract (Abaterea 6). `nume_fisier_baza` = `fn_dcc_nume_fisier` fără `_<titlu>.<ext>` (rădăcina, înghețată). Trigger BEFORE INSERT: fila / anexa sunt ale documentului; pe un document `are_file` revizia are `fila_id` sau `anexa_id`; pe unul fără file, `fila_id IS NULL`. Trigger BEFORE UPDATE: `contract_id`, `document_id`, `fila_id`, `anexa_id`, `revizie`, `limba`, `ghid_id`, `cod_text`, `nume_fisier_baza`, `creat_*` imuabile; `stare_transport` doar prin `fn_dcc_tranzitie_permisa(OLD, NEW)`; câmpurile anulării doar împreună cu tranziția spre `anulata`; `verdict*` doar `NULL → valoare` (B). DELETE refuzat.
- Politicile [D1]: `dcc_documente` → `fn_dcc_drept(proiect_dcc_id, 'citire')`; `dcc_file` / `dcc_anexe` / `dcc_revizii` → `EXISTS (SELECT 1 FROM dcc_documente d WHERE d.id = document_id AND fn_dcc_drept(d.proiect_dcc_id, 'citire'))`.

**Gărzile documentului anulat (P1-4) — refuzul e și în RPC (după lock), și în trigger (orice cale):**

| Operația | RPC: după `dcc_documente FOR UPDATE` (pasul 8) | Trigger (orice cale, inclusiv `postgres`) |
|---|---|---|
| revizie nouă | `stare = 'anulat'` → P0001 `DCC_DOCUMENT_ANULAT` | BEFORE INSERT `dcc_revizii`: documentul `anulat` → `DCC_DOCUMENT_ANULAT` |
| filă nouă | idem | BEFORE INSERT `dcc_file`: documentul `anulat` sau `NOT are_file` → refuz |
| anexă nouă | idem | BEFORE INSERT `dcc_anexe`: documentul `anulat` → refuz |
| copiat | idem, pentru documentul FIECĂREI revizii | BEFORE UPDATE `dcc_revizii` spre `copiata_pentru_gmail` / `pregatita` / `trimisa_manual_neverificata`: documentul `anulat` → refuz |
| confirmat | idem | idem + BEFORE INSERT `dcc_legaturi` / `dcc_snapshot_revizii` cu `stare` `manual` pe revizie a unui document anulat → refuz |
| anulare revizie | documentul `anulat` → `DCC_DOCUMENT_ANULAT` | — (tranziția `anulata → anulata` nu e permisă) |

Excepția unică: tranziția `trimisa_manual_neverificata → trimisa_manual_confirmata` (dovada din B) rămâne permisă pe un document anulat — e istoric adevărat, nu o emisie nouă.

**Tabelul TRANZIȚIILOR (`fn_dcc_tranzitie_permisa`, PR1):**

| din \ în | pregatita | copiata_pentru_gmail | trimisa_manual_neverificata | trimisa_manual_confirmata | anulata |
|---|---|---|---|---|---|
| rezervata | da (PR2) | da | da | — | da |
| pregatita | — | da | da | — | da |
| copiata_pentru_gmail | — | da (re-copiere) | da | — | da |
| trimisa_manual_neverificata | — | — | — | da (B, doar cu dovadă) | — |
| restul | — | — | — | — | — |

`trimisa_erp` / `necunoscut` nu sunt ținte permise în PR1 (PR4 schimbă funcția). `trimisa_manual_neverificata → trimisa_manual_confirmata` e în tabel (structura B), dar triggerul o cere cu o legătură `confirmata` a unui mesaj cu `rfc_message_id` sau `gmail_message_id` (dovada) — niciun RPC din PR1 nu o face.

`-- ─── 7. RPC-urile registrului` (toate `returns jsonb`, EXECUTE `authenticated`)

| RPC | Nivel | Ce face / refuză |
|---|---|---|
| `fn_dcc_initializeaza_serie(p_proiect_dcc bigint, p_emitent text, p_tematica text, p_tip text, p_interval text, p_prag integer, p_motiv text, p_accept_sub_istoric boolean, p_cheie uuid)` | `admin` sau [D5] | Contractul = al proiectului; emitentul = al proiectului; tematica / tipul / intervalul în ghidul proiectului (valori active; `tip.fara_tematica` ⇔ `p_tematica IS NULL`); limitele copiate din `dcc_ghid_intervale`; lock-urile 2 (partajat) → 3 → 4; disjuncția față de TOATE seriile cheii (regula 1); `p_prag` ∈ [inf − 1, sup]; `p_prag` ≥ max(`secventa`) al documentelor existente pe cheie în interval, pe tot contractul (altfel `DCC_PRAG_SUB_DOCUMENTE`, valoarea în mesaj); dacă `p_prag` < max(`secventa`) din `dcc_istoric_aparitii` pe cheie în interval, pe tot contractul → `DCC_PRAG_SUB_ISTORIC` fără `p_accept_sub_istoric = true` (valoarea în mesaj și în `max_istoric_la_init`); a doua inițializare a aceleiași chei + interval cu altă cheie de intenție → `DCC_SERIE_EXISTA` (23505). Contract `manual` → `DCC_MOD_MANUAL`. |
| `fn_dcc_aloca(p_proiect_dcc bigint, p_emitent text, p_tematica text, p_tip text, p_interval text, p_titlu text, p_limba text, p_nr_file integer, p_cheie uuid)` | `scriere` | Contract `automat`; seria pe (contract, emitent, tematică, tip, interval) `FOR UPDATE`; lipsă → `DCC_SERIE_ABSENTA` (P0001; nu pornește de la 00001); regula 3 de compatibilitate; următorul = `ultimul_ocupat + 1` > `limita_sup` → `DCC_INTERVAL_EPUIZAT` (P0001; fără trecere în alt interval); INSERT document + (Rev0 SAU filele 1..N cu Rev0 fiecare) + `ultimul_ocupat = următorul`; `cod_text` / `nume_fisier_baza` din `fn_dcc_cod_text` / `fn_dcc_nume_fisier` cu formatele ghidului CURENT al proiectului; coliziune pe `dcc_revizii_cod_uq` → `DCC_COD_OCUPAT` (23505, fără detalii despre ocupant). |
| `fn_dcc_aloca_manual(p_proiect_dcc bigint, p_emitent text, p_tematica text, p_tip text, p_secventa integer, p_titlu text, p_limba text, p_nr_file integer, p_cheie uuid)` | `scriere` | Contract `manual` (altfel `DCC_MOD_AUTOMAT`); lock-urile 2 (partajat) → 3 → 4; seria inițializată pe cheie → `DCC_SERIE_AUTOMATA`; codul ocupat → `DCC_COD_OCUPAT` (23505, prins din `unique_violation` și re-ridicat curat, fără detalii despre ocupant). |
| `fn_dcc_revizie_noua(p_document bigint, p_fila bigint, p_anexa bigint, p_titlu text, p_limba text, p_cheie uuid)` | `scriere` pe proiectul documentului | Documentul `FOR UPDATE`; gărzile documentului anulat; ținta (document / filă / anexă) a documentului și compatibilă cu `are_file`; cel mult unul din `p_fila` / `p_anexa`; revizia = max(`revizie`) pe țintă (toate limbile, inclusiv revizii anulate) + 1; limba implicită = a ultimei revizii a țintei. `ultima_netrimisa` = avertisment, nu refuz. |
| `fn_dcc_fila_noua(p_document bigint, p_fila integer, p_titlu text, p_limba text, p_cheie uuid)` | `scriere` | Documentul `FOR UPDATE`; gărzile documentului anulat; doar pe `are_file`; `p_fila` liberă pe document (altfel 23505 `DCC_FILA_EXISTA`); fila + Rev0. |
| `fn_dcc_anexa_noua(p_document bigint, p_titlu text, p_limba text, p_cheie uuid)` | `scriere` | Documentul `FOR UPDATE`; gărzile documentului anulat; numărul = max + 1 sub lock; anexa + Rev0. |
| `fn_dcc_anuleaza(p_document bigint, p_revizie bigint, p_motiv text, p_cheie uuid)` | `admin` [D7] | Exact unul din `p_document` / `p_revizie` (altfel 22023); `p_motiv` trim nevid ≤ 500 (altfel 22023 `DCC_MOTIV_LIPSA`). Document: `stare = anulat` + `anulat_de` / `_la` / `motiv_anulare`; reviziile în `rezervata` / `pregatita` / `copiata_pentru_gmail` → `anulata` cu `anulata_prin = 'document'` + același motiv; cele trimise rămân cum sunt (istoric); seria NU scade. Revizie: documentul ei `FOR UPDATE`; documentul anulat → `DCC_DOCUMENT_ANULAT`; doar din `rezervata` / `pregatita` / `copiata_pentru_gmail` (altfel `DCC_TRANZITIE_NEPERMISA`); `anulata_prin = 'revizie'` + motivul; numărul reviziei rămâne ocupat. |

**Formele rezultatelor (toate RPC-urile; listele ordonate crescător după id, deci o reluare întoarce exact același obiect; `reluat` e mereu prezent):**

| RPC | Rezultatul (jsonb) |
|---|---|
| `fn_dcc_ghid_creeaza` | `{ghid_id, cod, versiune, valori: <număr>, intervale: <număr>, reluat}` |
| `fn_dcc_contract_creeaza` | `{contract_id, beneficiar, cod_contract, mod_alocare, reluat}` |
| `fn_dcc_proiect_seteaza` | `{proiect_dcc_id, versiune, creat: bool, reluat}` |
| `fn_dcc_initializeaza_serie` | `{serie_id, interval, limita_inf, limita_sup, prag, urmatorul, max_istoric: int\|null, reluat}` |
| `fn_dcc_aloca` / `fn_dcc_aloca_manual` | `{document_id, secventa, interval: text\|null, revizii: [{revizie_id, fila: int\|null, revizie: 0, limba, cod_text, nume_fisier_baza}], reluat}` |
| `fn_dcc_revizie_noua` | `{document_id, revizie_id, tinta: {tip: 'document'\|'fila'\|'anexa', fila: int\|null, anexa: int\|null}, revizie, limba, cod_text, nume_fisier_baza, ultima_netrimisa: bool, reluat}` |
| `fn_dcc_fila_noua` | `{document_id, fila_id, fila, revizie_id, cod_text, nume_fisier_baza, reluat}` |
| `fn_dcc_anexa_noua` | `{document_id, anexa_id, anexa, revizie_id, cod_text, nume_fisier_baza, reluat}` |
| `fn_dcc_anuleaza` | `{tinta: 'document'\|'revizie', document_id, revizie_id: int\|null, revizii_anulate: [id], revizii_pastrate: [{revizie_id, stare_transport}], reluat}` |
| `fn_dcc_marcheaza_copiat` | `{snapshot_id, hash, revizii: [{revizie_id, stare_anterioara, stare}], reluat}` |
| `fn_dcc_confirma_trimis_manual` | `{mesaj_id, legaturi: [id], revizii: [{revizie_id, stare_anterioara, stare}], reluat}` |
| `fn_dcc_istoric_importa` | `{inserate, identice, diferite: [{sursa, sursa_id, pozitie}], total, reluat}` (diferite ordonate după `(sursa, sursa_id, pozitie)`) |
| `fn_dcc_serii_proiect` (citire, `returns setof`) | `(serie_id, emitent, tematica, tip, interval, limita_inf, limita_sup, prag_initial, ultimul_ocupat, urmatorul, epuizata, initializata_la, initializata_prin, motiv_prag)` |

Orice RPC care creează revizii (alocare, revizie, filă, anexă) prinde `unique_violation` pe `dcc_revizii_cod_uq` și ridică `DCC_COD_OCUPAT` (23505), fără detalii despre ocupant. Erorile nu au formă de rezultat: sunt excepții cu codul `DCC_*` și SQLSTATE-ul din tabelul de mai jos.

**Normalizarea parametrilor (înaintea hash-ului) și regulile listelor:**
- Coduri (emitent, tematică, tip, interval, limbă, beneficiar): `upper(btrim())`; șir gol → NULL. Texte libere (titlu, motiv, subiect, căsuța declarată): `btrim()`; gol → NULL (și, unde e obligatoriu, refuz 22023). `p_cheie` NULL → 22023.
- **Listele de revizii** (`p_revizii bigint[]` la copiat / confirmat): NULL sau `cardinality = 0` → 22023 `DCC_LISTA_GOALA`; element NULL → 22023 `DCC_LISTA_INVALIDA`; **dubluri → 22023 `DCC_LISTA_DUBLURI`** (refuz, nu deduplicare tăcută); peste 50 de elemente → 22023 `DCC_LISTA_PREA_LUNGA` (plafonul Transmittal, §2); forma normalizată = sortată crescător (aceeași mulțime în altă ordine = aceeași intenție, același hash). Apoi, pe fiecare id: inexistent sau fără drept → 42501 `DCC_FARA_DREPT` (același mesaj); toate pe drept, dar din proiecte DCC diferite → 22023 `DCC_PROIECTE_AMESTECATE`.
- `p_cc` (configurare): `lower(btrim())`, fără goluri, dubluri = refuz, normalizat sortat. `p_snapshot` (copiat): obiect cu exact cheile `to, cc, subiect, corp, linkuri, manifest` (lipsă / în plus / `bcc` = 22023); `cc` normalizat ca `p_cc`; `linkuri` în ordinea dată (contează în corp); `manifest` sortat după `nume`, `nume` unic.
- `p_randuri` la import: vezi Task 4 (lista exactă).

`-- ─── 8. vederea registrului și citirea seriilor`
- `v_dcc_registru` (`security_invoker = on`): documentul + contractul (`beneficiar`, `cod_contract`) + ținta (filă / anexă) + ultima revizie pe țintă și limbă (`cod_text`, `stare_transport`, `verdict`) + numărul de apariții istorice legate. Fără coloane din alte module; RLS-ul tabelelor de bază o limitează la proiectele apelantului.
- `fn_dcc_serii_proiect(p_proiect_dcc bigint) returns setof record` (coloanele din tabelul rezultatelor) — STABLE DEFINER; `fn_dcc_drept(p_proiect_dcc, 'citire')` altfel 42501; doar seriile contractului proiectului pe emitentul proiectului.

**SQLSTATE și coduri (tabelul complet se pune în antetul migrării):** 42501 = `DCC_NEAUTENTIFICAT`, `DCC_FARA_DREPT` (același mesaj pentru id inexistent și id al altui proiect); 22023 = parametri invalizi, `DCC_CHEIE_ALTI_PARAMETRI`, `DCC_CHEI_NECUNOSCUTE`, `DCC_LISTA_GOALA`, `DCC_LISTA_INVALIDA`, `DCC_LISTA_DUBLURI`, `DCC_LISTA_PREA_LUNGA`, `DCC_PROIECTE_AMESTECATE`, `DCC_MOTIV_LIPSA`, `DCC_EMITENT_STRAIN`, valori în afara ghidului, erorile formatorului; P0001 = `DCC_SERIE_ABSENTA`, `DCC_INTERVAL_EPUIZAT`, `DCC_INTERVAL_NECUNOSCUT`, `DCC_GHID_INCOMPATIBIL`, `DCC_DOCUMENT_ANULAT`, `DCC_MOD_MANUAL` / `DCC_MOD_AUTOMAT`, `DCC_SERIE_AUTOMATA`, `DCC_PRAG_SUB_*`, `DCC_TRANZITIE_NEPERMISA`, `DCC_GHID_IMUABIL`, `DCC_CONTRACT_IMUABIL`, `DCC_SERIE_IMUABILA`; 23505 = `DCC_SERIE_EXISTA`, `DCC_COD_OCUPAT`, `DCC_FILA_EXISTA`; 23P01 = `DCC_INTERVALE_SUPRAPUSE`; 40001 = `DCC_CONFLICT_VERSIUNE`; 55P03 = lock ocupat la aplicarea migrării / revenirii.

- [ ] **Step 1: Failing tests** (PGlite, blocurile `t3_*`; valorile așteptate scrise de mână):
  - `p1_serie_absenta`: `fn_dcc_aloca` pe `TM1/COR/general` neinițializată → P0001 `DCC_SERIE_ABSENTA`, 0 rânduri în `dcc_documente`.
  - `p1_consecutive_secvential`: inițializare cu prag 44 → două alocări cu chei diferite → secvențe 45 și 46, coduri `30-AAA-TM1-COR-00045.Rev0.RO` / `…00046.Rev0.RO`; `ultimul_ocupat = 46`; rezultatul are exact forma din tabel.
  - `p2_cheie_aloca`: aceeași cheie + aceiași parametri (și cu `' tm1 '` netrimat — normalizat) → același obiect, `reluat: true`, tot 1 document; aceeași cheie + alt titlu → 22023 `DCC_CHEIE_ALTI_PARAMETRI`; aceeași cheie, alt utilizator → 22023; aceeași cheie, altă operație (`revizie_noua`) → 22023.
  - `p2_cheie_revizie`: la fel pe `fn_dcc_revizie_noua` (aceeași cheie → aceeași Rev1; alt titlu → 22023).
  - `p_reluare_dupa_retragere` (CE6): editorul E alocă cu cheia K (comis); owner-ul îi scoate `executie_dcc`; E reia K cu aceiași parametri → același rezultat, `reluat: true`, 0 rânduri noi în orice tabel `dcc_*`; E cu K + alt titlu → 22023; E cu o cheie nouă → 42501; alt utilizator cu K → 22023. Mutantul `reia_dupa_drept` (reconcilierea mutată după drept) → prima reluare dă 42501 → prins.
  - `p3_revizii_secvential`: două chei diferite → Rev1 și Rev2; nicio a doua Rev1 (`dcc_revizii_uq` dovedit și prin INSERT direct ca `postgres` → 23505).
  - `p4_anulare`: anularea documentului 45 → `stare = anulat`, Rev0 `anulata`; alocarea următoare → 46 (nu 45); `fn_dcc_aloca_manual` pe un contract manual cu un număr anulat → 23505 `DCC_COD_OCUPAT`; anularea unei revizii `trimisa_manual_neverificata` → P0001 `DCC_TRANZITIE_NEPERMISA`.
  - `p4_motiv_anulare` (P2-7): anularea unei revizii cu motivul M1 → `motiv_anulare = M1`, `anulata_prin = 'revizie'`, `anulata_de` = apelantul; anularea documentului cu M2 → documentul are M2 și fiecare revizie netrimisă are M2 + `anulata_prin = 'document'`; revizia anulată anterior își păstrează M1; motiv gol / doar spații → 22023 `DCC_MOTIV_LIPSA`; UPDATE direct ca `postgres` care pune `stare_transport = 'anulata'` fără motiv → 23514.
  - `p4_operatii_dupa_anulare` (CE4): pe un document cu file, anulat: `fn_dcc_revizie_noua`, `fn_dcc_fila_noua`, `fn_dcc_anexa_noua`, `fn_dcc_marcheaza_copiat` și `fn_dcc_confirma_trimis_manual` pe o revizie a lui (inclusiv una rămasă `trimisa_manual_neverificata`, pentru copiat) → P0001 `DCC_DOCUMENT_ANULAT`, 0 rânduri noi; INSERT direct ca `postgres` în `dcc_file`, `dcc_anexe`, `dcc_revizii` pe documentul anulat → refuz din trigger; UPDATE direct al unei revizii spre `copiata_pentru_gmail` → refuz. Mutanții `fila_pe_document_anulat` (trigger fără stare) și `anexa_rpc_fara_stare` (RPC fără verificarea după lock) → prinși.
  - `p4_limite_interval`: `SR1` (100–199) inițializat cu prag 99 → prima alocare 00100; prag 198 → 00199, apoi `DCC_INTERVAL_EPUIZAT`, iar `SR2` rămâne neatins (`ultimul_ocupat` neschimbat); `general` cu prag 99998 → 99999, apoi refuz; prag 200 pe `SR1` → 22023 (în afara intervalului); prag sub un document existent → `DCC_PRAG_SUB_DOCUMENTE`.
  - `p_intervale_intre_ghiduri` (CE2): contractul `BEN/30`; P1 cu ghidul G1 (`SR1` 100–199), P2 cu ghidul G2 (`SR2` 150–249), aceeași cheie `AAA/TS/DES`; inițializarea `SR1` din P1 → ok; inițializarea `SR2` din P2 → 23P01 `DCC_INTERVALE_SUPRAPUSE`, 0 serii noi; INSERT direct ca `postgres` al unei serii suprapuse → 23P01 (trigger). Pe o cheie diferită (`TM2`), `SR2` din G2 → ok (disjuncția e pe cheie). Mutantul `fara_disjunctie_serii` → prins.
  - `p_ghid_incompatibil` (CE2): cu `SR1` inițializat din G1 (100–199), `fn_dcc_proiect_seteaza` care mută P2 pe un ghid G3 cu `SR1` = 100–150 → P0001 `DCC_GHID_INCOMPATIBIL`, proiectul neschimbat; un ghid G4 fără `SR1` → acceptat, dar `fn_dcc_aloca` din P2 pe `SR1` → `DCC_INTERVAL_NECUNOSCUT`; un ghid G5 cu `SR1` = 100–199 → acceptat, alocarea din P2 pe `SR1` continuă seria.
  - `p8_doua_proiecte_un_contract`: P1 și P2 (proiecte Execuție diferite) cu `dcc_proiecte` pe același contract `BEN/30` → alocările alternate P1, P2, P1 dau 45, 46, 47 din aceeași serie; INSERT direct ca `postgres` al unui document cu codul 46 pe P2 → 23505.
  - `p_cod_text_doua_contracte` (CE3): contractele `BEN/30` și `ALT/30`, același format, aceeași cheie și același prag → ambele alocări reușesc cu `cod_text` IDENTIC (`30-AAA-TM1-COR-00045.Rev0.RO`), câte un document pe contract. Mutantul `cod_text_unic_global` → a doua pică pe 23505 → prins.
  - `p_cod_text_coliziune_ghiduri` (CE3): în același contract, documentul D (cu file, ghidul G1: prefixul filei `"-"`, al anexei `"-A"`) are fila 1 Rev0 = `…-00045-01.Rev0.RO`; proiectul trece pe G6 (aceleași intervale; prefixul anexei `"-"`, al filei `"-F"`); `fn_dcc_anexa_noua` pe ACELAȘI document D ar da anexei 1 textul `…-00045-01.Rev0.RO` → 23505 `DCC_COD_OCUPAT`, nimic scris (nici anexa, nici revizia). `formatValid` refuză oricum prefixele filei și anexei egale în ACELAȘI ghid.
  - `p_mom_unicitate`: tipul `MOM` (`fara_tematica`) → cod `30-AAA-MOM-00001.Rev0.RO`; alocare `MOM` cu tematică → 22023; două documente MOM cu aceeași secvență prin INSERT direct ca `postgres` → 23505 (NULLS NOT DISTINCT).
  - `p_file_anexe`: alocare cu `p_nr_file = 3` → 3 revizii Rev0 cu `-01` / `-02` / `-03`, nicio revizie fără filă; `fn_dcc_fila_noua` pe un document fără file → 22023; anexa 1 → `…-00045-A01.Rev0.RO`; revizie nouă pe anexă → `-A01.Rev1`, documentul rămâne la Rev0.
  - `p_ghid_nou`: proiectul mutat pe ghidul v2 (alt format, aceleași intervale) → reviziile existente își păstrează `cod_text`; revizia nouă folosește v2.
  - `p_paritate_formator`: `fn_dcc_cod_text` / `fn_dcc_nume_fisier` / `fn_dcc_titlu_scurt` / `fn_dcc_format_valid` pe TOATE cazurile din `src/dcc/dccCodCazuri.json` → aceleași șiruri / aceleași coduri de eroare; plus 500 de combinații generate determinist (semință fixă) comparate SQL ↔ JS (importul `src/dcc/dccCod.js` în scriptul Node).
- [ ] **Step 2: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t3` → FAIL pe blocurile noi.
- [ ] **Step 3: Write** secțiunile 6–8.
- [ ] **Step 4: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t3` → PASS; `npx vitest run src/dcc` → PASS.
- [ ] **Step 5: Commit** `feat(executie): registru DCC — serii, documente, revizii, gărzi la anulare`.

### Task 4: Istoricul brut și importul idempotent (secțiunea 9)

**Files:**
- Modify: migrarea, scriptul PGlite.

**Interfaces:**
- `dcc_istoric_aparitii(id, contract_id bigint not null, proiect_dcc_id bigint not null, foreign key (proiect_dcc_id, contract_id) references dcc_proiecte (id, contract_id), sursa text not null check in ('excel_registru','mail_trimis','mail_primit'), sursa_id text not null check (sursa_id ~ '[^[:space:]]' AND length(sursa_id) <= 300), pozitie int not null default 1 check (pozitie >= 1), lot_import text not null check (lot_import ~ '^[A-Za-z0-9_.-]{1,60}$'), valori_originale jsonb not null check (jsonb_typeof(valori_originale) = 'object'), cod_scris text check (cod_scris IS NULL OR length(cod_scris) <= 200), emitent text, tematica text, tip text, secventa int check (secventa IS NULL OR secventa between 1 and 99999), fila int check (fila IS NULL OR fila between 1 and 999), anexa int check (anexa IS NULL OR anexa between 1 and 999), revizie int null check (revizie IS NULL OR revizie >= 0), limba text check (limba IS NULL OR limba in ('RO','EN','BI')), probleme text[] not null default '{}' check (probleme <@ ARRAY['dublura','forma_nestandard','revizie_necunoscuta','tematica_gresita','cod_nerecunoscut','conflict']), continut_hash text not null check (continut_hash ~ '^[0-9a-f]{64}$'), document_id bigint null, revizie_id bigint null fk, foreign key (document_id, proiect_dcc_id) references dcc_documente (id, proiect_dcc_id), legat_de uuid, legat_la timestamptz, importat_de uuid, importat_prin text not null check in ('om','server'), importat_la, constraint dcc_istoric_sursa_uq unique (proiect_dcc_id, sursa, sursa_id, pozitie), check ((revizie IS NULL) = ('revizie_necunoscuta' = ANY(probleme)) OR cod_scris IS NULL))` — **revizia absentă = NULL („necunoscută”), niciodată 0**; identitatea sursei e unică pe PROIECT ([D1], Abaterea 7). `continut_hash` = sha256 pe forma canonică a rândului (toate câmpurile admise, cu valorile implicite completate; L16), pus de server. Politica: `fn_dcc_drept(proiect_dcc_id, 'citire')`. Trigger: UPDATE permis doar pe `document_id` / `revizie_id` / `legat_*` din `NULL` (legarea din PR3, documentul aceluiași proiect prin cheia compusă), restul imuabil; DELETE refuzat.
- `fn_dcc_istoric_importa(p_proiect_dcc bigint, p_lot text, p_randuri jsonb, p_cheie uuid) returns jsonb` — owner, `admin` pe proiect, sau [D5]; `contract_id` = al proiectului. **Câmpurile admise în fiecare rând (lista EXACTĂ; orice altă cheie = refuz pe tot lotul, nimic scris, 22023 `DCC_CHEI_NECUNOSCUTE`, L12):**

  | Cheia | Obligatorie | Tipul JSON / regula |
  |---|---|---|
  | `sursa` | da | șir ∈ `excel_registru`, `mail_trimis`, `mail_primit` |
  | `sursa_id` | da | șir nevid ≤ 300 |
  | `pozitie` | nu (implicit 1) | număr întreg ≥ 1 |
  | `valori_originale` | da | obiect |
  | `cod_scris` | nu | șir ≤ 200 sau `null` |
  | `emitent`, `tematica`, `tip`, `limba` | nu | șir conform formei din `dcc_ghid_valori` sau `null` |
  | `secventa` | nu | întreg 1..99999 sau `null` |
  | `fila`, `anexa` | nu | întreg 1..999 sau `null` |
  | `revizie` | nu | întreg ≥ 0 sau `null` (absent = `null`, NICIODATĂ 0) |
  | `probleme` | nu (implicit `[]`) | tablou de șiruri din lista CHECK, fără dubluri |

  **Refuzate explicit** (sunt puse de server sau aparțin legării din PR3): `id`, `contract_id`, `proiect_dcc_id`, `lot_import`, `continut_hash`, `document_id`, `revizie_id`, `legat_de`, `legat_la`, `importat_de`, `importat_prin`, `importat_la`. `p_randuri` = tablou nevid, maximum 5000 de rânduri; două rânduri cu aceeași identitate `(sursa, sursa_id, pozitie)` în ACELAȘI lot → 22023 `DCC_LOT_DUBLURI` (altfel `ON CONFLICT DO NOTHING` le-ar înghiți tăcut); forma normalizată pentru hash = rândurile canonice sortate după identitate. `INSERT … ON CONFLICT ON CONSTRAINT dcc_istoric_sursa_uq DO NOTHING`; pentru rândurile deja existente compară `continut_hash`: egal = `identice`, diferit = `diferite` (lista identităților, NU se suprascrie). Invariantul de contabilizare `inserate + identice + len(diferite) = total` e verificat în RPC înaintea `RETURN` (altfel excepție, nimic scris) și testat.

- [ ] **Step 1: Failing tests:**
  - `p5_import_idempotent`: lot de 6 rânduri sintetice (o dublură de număr cu titluri diferite pe două surse, o revizie absentă, o formă nestandard `_rev.2`, un rând fără cod) → `inserate 6`; același lot din nou (altă cheie de intenție) → `inserate 0, identice 6`, tot 6 rânduri; un rând cu aceeași identitate și alt conținut → `diferite` cu identitatea lui, rândul vechi neschimbat; rândul cu revizie absentă are `revizie IS NULL`; aceeași cheie de intenție + același lot (alt ordine a rândurilor) → `reluat: true`; UPDATE direct ca `postgres` pe `cod_scris` → refuz; inițializarea seriei sub maximul istoric → `DCC_PRAG_SUB_ISTORIC`, cu `p_accept_sub_istoric` → ok și `max_istoric_la_init` salvat; maximul istoric al unui ALT proiect al aceluiași contract contează la prag (numerotarea e a contractului), fără ca rândurile lui să fie vizibile.
  - `p5_import_chei_refuzate`: câte un lot pentru fiecare cheie refuzată din listă (`document_id`, `revizie_id`, `proiect_dcc_id`, `continut_hash`, `importat_de`, `legat_la` …) și pentru o cheie necunoscută → 22023, 0 rânduri noi; `revizie: "2"` (șir) → 22023; `pozitie: 1.5` → 22023; două rânduri cu aceeași identitate în lot → 22023 `DCC_LOT_DUBLURI`; 5001 rânduri → 22023. Mutanții `import_cu_chei_de_legare`, `on_conflict_do_update`, `revizie_absenta_zero` → prinși.
- [ ] **Step 2: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t4` → FAIL. **Step 3:** secțiunea 9. **Step 4:** același → PASS.
- [ ] **Step 5: Commit** `feat(executie): registru DCC — istoricul brut si importul idempotent`.

### Task 5: Mesaje, snapshoturi, legături; „Copiază pentru Gmail” și „Confirm că am trimis” (secțiunile 10–11)

**Files:**
- Modify: migrarea, scriptul PGlite.

**Interfaces:**
- `dcc_snapshoturi(id, contract_id bigint not null, proiect_dcc_id bigint not null, tip text not null check in ('copiat_gmail','aprobat_trimitere'), from_adresa text null, to_lista text[] not null, cc_lista text[] not null default '{}', subiect text not null check (subiect ~ '[^[:space:]]'), corp text not null, linkuri text[] not null default '{}', manifest jsonb not null default '[]', hash text not null check (hash ~ '^[0-9a-f]{64}$'), aprobat_de uuid not null, aprobat_la timestamptz not null default now(), foreign key (proiect_dcc_id, contract_id) references dcc_proiecte (id, contract_id), unique (id, proiect_dcc_id))` — fără BCC (nicio coloană); `manifest` = tablou de `{nume, marime, sha256}` validat (`sha256 ~ '^[0-9a-f]{64}$'`, `marime` întreg ≥ 0, `nume` nevid, unic); `hash` calculat de server pe forma canonică; imuabil (UPDATE / DELETE refuzate). Politica: `fn_dcc_drept(proiect_dcc_id, 'citire')`.
- `dcc_snapshot_revizii(snapshot_id bigint fk, revizie_id bigint fk, primary key (snapshot_id, revizie_id))` — trigger: revizia e a aceluiași proiect DCC ca snapshotul și documentul ei nu e anulat; imuabil. Politica: prin snapshot ȘI prin documentul reviziei (L09).
- `dcc_mesaje(id, contract_id bigint not null, proiect_dcc_id bigint not null, foreign key (proiect_dcc_id, contract_id) references dcc_proiecte (id, contract_id), directie text not null check in ('trimis','primit'), sursa text not null check in ('manual_declarat','erp','import_istoric','citire_casuta'), casuta_id bigint null fk dcc_casute, casuta_declarata text null, rfc_message_id text null, gmail_message_id text null, gmail_thread_id text null, in_reply_to text null, references_lista text[] null, subiect_original text null, subiect_normalizat text null, from_adresa text null, sender text null, reply_to text null, to_lista text[] null, cc_lista text[] null, data_mesaj timestamptz not null, manifest jsonb null, snapshot_id bigint null, foreign key (snapshot_id, proiect_dcc_id) references dcc_snapshoturi (id, proiect_dcc_id), dovezi_complete boolean not null, creat_de uuid, creat_la, check (gmail_thread_id IS NULL OR casuta_id IS NOT NULL), check (sursa <> 'manual_declarat' OR (rfc_message_id IS NULL AND gmail_message_id IS NULL AND gmail_thread_id IS NULL AND casuta_id IS NULL AND dovezi_complete = false AND casuta_declarata ~ '[^[:space:]]')), unique (directie, rfc_message_id), unique (casuta_id, gmail_message_id))` — **fără ID-uri inventate**; `proiect_dcc_id` (Abaterea 7). Imuabil în PR1 (B adaugă căile lui). Politica: `fn_dcc_drept(proiect_dcc_id, 'citire')`.
- `dcc_legaturi(id, mesaj_id bigint not null fk, revizie_id bigint not null fk, metoda text not null check in ('antet_rfc','thread','cod_subiect','cod_corp','tipar_re','manual','emitere_erp'), dovada jsonb not null default '{}', stare text not null check in ('propusa','confirmata','respinsa'), verdict_propus text null (aceeași listă ca `dcc_revizii.verdict`), autor uuid, creat_la, confirmat_de uuid, confirmat_la timestamptz, unique (mesaj_id, revizie_id), check (stare = 'propusa' OR confirmat_la IS NOT NULL))` — trigger: mesajul și documentul reviziei sunt ale ACELUIAȘI proiect DCC; o legătură nouă `manual` pe o revizie a unui document anulat → refuz. UPDATE: doar `stare` `propusa → confirmata | respinsa` + `confirmat_*` (B); DELETE refuzat. Politica: drept pe proiectul mesajului ȘI pe proiectul documentului reviziei.
- `fn_dcc_marcheaza_copiat(p_revizii bigint[], p_snapshot jsonb, p_cheie uuid) returns jsonb` — regulile listelor (Task 3); `scriere` pe proiectul FIECĂREI revizii (L09); toate din același proiect DCC; documentele `FOR UPDATE ORDER BY id`; gărzile documentului anulat; fiecare revizie trece prin `fn_dcc_tranzitie_permisa(stare, 'copiata_pentru_gmail')`; `p_snapshot` normalizat (Task 3; `to` = exact `[dcc_proiecte.adresa_dcc]`, altfel `DCC_TO_DIFERIT`; fiecare adresă din `cc` în `dcc_proiecte.cc_lista` ∪ valorile din `cc_implicit` — lista albă, altfel `DCC_CC_NEPERMIS`); scrie snapshotul (`tip = copiat_gmail`, `from_adresa NULL`) + `dcc_snapshot_revizii`.
- `fn_dcc_confirma_trimis_manual(p_revizii bigint[], p_trimis_la timestamptz, p_casuta_declarata text, p_subiect text, p_snapshot bigint, p_cheie uuid) returns jsonb` — aceleași reguli de listă / drept / proiect / lock / gărzi; `p_trimis_la` nenul, ≤ `now() + interval '5 minutes'` și ≥ `creat_la` al fiecărei revizii; `p_casuta_declarata` nevidă (text, nu FK — căsuța nu e conectată); `p_subiect` opțional; `p_snapshot` opțional, dar dacă e dat: același proiect, drept pe el, iar mulțimea reviziilor lui = exact `p_revizii` (altfel 22023 `DCC_SNAPSHOT_ALTE_REVIZII`); scrie UN `dcc_mesaje` (`directie trimis`, `sursa manual_declarat`, toate ID-urile NULL, `dovezi_complete false`, `proiect_dcc_id` = al reviziilor) + câte o `dcc_legaturi` (`metoda manual`, `stare confirmata`, `confirmat_de = auth.uid()`) + revizii → `trimisa_manual_neverificata`. O revizie deja trimisă → `DCC_TRANZITIE_NEPERMISA`.

- [ ] **Step 1: Failing tests:**
  - `p6_confirma_manual`: fără nicio căsuță în `dcc_casute`, „Confirm” pe Rev0 → `trimisa_manual_neverificata`; mesajul are `rfc_message_id`, `gmail_message_id`, `gmail_thread_id`, `casuta_id` NULL, `dovezi_complete = false`, `casuta_declarata` = textul dat; legătura `manual` / `confirmata`; a doua confirmare cu altă cheie → P0001; UPDATE direct ca `postgres` care pune un `rfc_message_id` pe mesajul manual → 23514; UPDATE direct `trimisa_manual_neverificata → trimisa_manual_confirmata` fără dovadă → refuz.
  - `p_copiat`: „copiat” de două ori → două snapshoturi, revizia rămâne `copiata_pentru_gmail`; CC din afara listei albe → 22023; cheia `bcc` în snapshot → 22023; UPDATE direct pe `dcc_snapshoturi.corp` ca `postgres` → refuz; `hash` = sha256 calculat independent în Node pe forma canonică documentată.
  - `p_liste_revizii` (P2-7), pe AMBELE RPC-uri: `NULL` și `'{}'` → `DCC_LISTA_GOALA`; `'{5,NULL}'` → `DCC_LISTA_INVALIDA`; `'{5,5}'` → `DCC_LISTA_DUBLURI`; 51 de elemente → `DCC_LISTA_PREA_LUNGA`; `'{7,5}'` și apoi `'{5,7}'` cu aceeași cheie → `reluat: true` (aceeași intenție); un id inexistent și un id al altui proiect → 42501 cu mesaj IDENTIC; revizii din două proiecte (ambele pe drept) → `DCC_PROIECTE_AMESTECATE`; snapshot cu alte revizii → `DCC_SNAPSHOT_ALTE_REVIZII`; în toate cazurile 0 rânduri noi.
  - `p_contracte_amestecate`: revizii din două contracte în același apel → 22023, nimic scris.
- [ ] **Step 2: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t5` → FAIL. **Step 3:** secțiunile 10–11. **Step 4:** același → PASS.
- [ ] **Step 5: Commit** `feat(executie): registru DCC — mesaje, snapshoturi, legaturi; copiat si confirmat manual`.

### Task 6: TRUNCATE, postcondițiile și accesul (secțiunea 12 + `$post$`)

**Files:**
- Modify: migrarea, scriptul PGlite.

**Interfaces:**
- Triggerele BEFORE TRUNCATE (statement) pe toate tabelele registrului → refuz (și pentru `postgres`; revenirea folosește `DROP`, nu `TRUNCATE`).
- `$post$`: fiecare tabel are RLS activ și EXACT politicile declarate (numele + textul `pg_get_expr` comparat cu constante; `fn_dcc_contract_vizibil` apare DOAR în politica `dcc_contracte`); `has_table_privilege` verificat PE RÂND pentru fiecare drept (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) și fiecare rol (`anon`, `authenticated`, `service_role`, `PUBLIC`); fiecare funcție nouă: `prosecdef` așteptat, `proconfig = {search_path=public, pg_temp}`, owner `postgres`, EXECUTE exact pe lista declarată (`anon` niciodată), limbajul așteptat (plpgsql pentru cele care citesc tabele existente); amprenta (md5 fără CR) a `fn_executie_proiect_permis` / `fn_executie_acces_nerestrans` neschimbată după; numărul exact de funcții `fn_dcc_%` (listă scrisă, nu prefix) și de triggere `trg_dcc_%` (cu `tgtype` / `tgnargs` / `tgqual IS NULL`); **postcondiția de lock-uri** (secțiunea „Lock-urile migrării”); nicio intrare nouă în `app_modules` / `user_module_access`.

- [ ] **Step 1: Failing tests:**
  - `p7_acces_intre_contracte`: contractele `BEN/30` (P1) și `BEN/43` (P2); utilizatorul `u_l1` = `executie_dcc` editor + restrâns prin `executie_acces_proiect` la P1. Ca `u_l1` (`SET LOCAL ROLE authenticated` + ambele surse JWT; verificat la fiecare pas `auth.uid()`, `current_user`, rol fără BYPASSRLS): SELECT pe fiecare tabel `dcc_*` cu GRANT și pe `v_dcc_registru` → 0 rânduri ale P2 (și rândurile P1 vizibile — contra-proba); `fn_dcc_serii_proiect(P2)` → 42501; `fn_dcc_aloca(p_proiect_dcc = P2)` → 42501; `fn_dcc_revizie_noua` / `fn_dcc_fila_noua` / `fn_dcc_anexa_noua` / `fn_dcc_anuleaza` / `fn_dcc_marcheaza_copiat` / `fn_dcc_confirma_trimis_manual` / `fn_dcc_istoric_importa` pe id-uri ale P2 → 42501 cu ACELAȘI mesaj ca pe un id inexistent; INSERT / UPDATE / DELETE / TRUNCATE direct pe fiecare tabel → 42501; `anon` → nimic (nici EXECUTE pe RPC-uri). Un utilizator cu doar `executie` admin (fără `executie_dcc`) → 0 rânduri peste tot, RPC-uri 42501. Owner → vede ambele.
  - `p7b_doua_proiecte_acelasi_contract` (CE1): P1 și P2 pe ACELAȘI contract `BEN/30`, fiecare cu documente, revizii, istoric importat, un snapshot copiat și un mesaj confirmat; `u_l1` autorizat doar pe P1. Ca `u_l1`: SELECT pe `dcc_documente`, `dcc_file`, `dcc_anexe`, `dcc_revizii`, `dcc_istoric_aparitii`, `dcc_mesaje`, `dcc_snapshoturi`, `dcc_snapshot_revizii`, `dcc_legaturi`, `v_dcc_registru` → EXACT rândurile P1 (numărate pe valori scrise de mână), 0 ale P2; `dcc_proiecte` → doar P1; `dcc_contracte` → `BEN/30` (contractul propriu); `fn_dcc_serii_proiect(P1)` → seria comună cu `ultimul_ocupat` care include alocările P2 (divulgarea declarată); `fn_dcc_aloca(P1)` după o alocare a P2 → numărul următor corect (alocarea fără citirea P2); pe contractul `manual` paralel, `fn_dcc_aloca_manual(P1)` pe numărul ocupat de P2 → `DCC_COD_OCUPAT`, iar mesajul NU conține id-ul, titlul sau proiectul documentului P2 (verificat pe text); `fn_dcc_revizie_noua` pe un document P2 → 42501 identic cu id inexistent; `fn_dcc_istoric_importa(P1)` cu aceeași identitate de sursă ca un rând P2 → `inserate 1` (nu `identice`: fără oracol pe istoricul P2). Mutantul `citire_pe_contract` (politica `dcc_documente` pe contract, ca în r1) → prins.
- [ ] **Step 2: Run** `node scripts/pglite/test_executie_dcc_registru_local.mjs --pana-la t6` → FAIL. **Step 3:** secțiunea 12 + `$post$`. **Step 4:** același → PASS.
- [ ] **Step 5: Commit** `feat(executie): registru DCC — TRUNCATE, postconditii, acces intre proiecte`.

### Task 7: Livrarea L15 v2 — revenirea, manifestul, refuzurile migrării, mutanții, proba pe clona 176, concurența

**Files:**
- Create: `supabase/revenire/20270108a_executie_dcc_registru_ROLLBACK.sql`
- Create: `supabase/tests/20270108a_executie_dcc_registru.l15.obiecte.tsv` (generat pe PGlite cu pașii reali ai runnerului: `--scrie-obiecte`)
- Create (pe clonă, de coordonator): `supabase/migrations/20270108a_executie_dcc_registru.l15.tsv` (`scripts/livrare_l15_manifest.sh`)
- Create: `supabase/tests/20270108a_executie_dcc_registru_dryrun.sql`
- Create: `supabase/tests/20270108a_executie_dcc_registru_concurenta.sh`
- Modify: scriptul PGlite (secțiunile 2–4 ale probei: refuzuri, revenire, mutanți)

**Interfaces:**
- **Revenirea** (L14): o tranzacție; garda de start ca la migrare (marcajul `20270108a_executie_dcc_registru_ROLLBACK:<txid>`, plafonul 2000); un singur bloc `DO`; ordinea: (1) gărzile + starea exactă din catalog pe DEFINIȚII (blocul DEFINITII generat: md5 pe corpuri, tipurile coloanelor, constrângerile, triggerele exacte cu `tgtype` / `tgnargs` / `tgqual IS NULL`, politicile) — altfel refuz; (2) lock-urile din „Lock-urile migrării și ale revenirii”, NOWAIT, în ordinea declarată, cu bugetul de 1 s; (3) sub lock: starea din nou, refuz dacă ORICE tabel `dcc_*` are rânduri (inclusiv `dcc_intentii`) — datele reale se scot printr-o decizie separată, nu prin revenire; `DROP` la tot ce s-a creat (vederea, tabelele în ordinea inversă a cheilor străine, funcțiile pe listă exactă cu `to_regprocedure`, fără cast `::regprocedure` în gardă; fără `CASCADE`); postcondiția: niciun obiect `dcc_` / `fn_dcc_` / `trg_dcc_` rămas, `fn_executie_proiect_permis` neschimbată, `pg_locks` = setul declarat.
- **Dry-run pe clonă** (`…_dryrun.sql`; rulat DUPĂ aplicarea prin runner, într-o tranzacție cu `ROLLBACK` la final, identități sintetice create în tranzacție — `auth.users` / `profiles` / `user_module_access` / `executie_proiecte` / `executie_acces_proiect` sintetice, ca `20270105a_executie_rest_decontat_dryrun.sql`): blocurile `t_p1_serie` (bloc 2: CE2), `t_p2_cheie` (bloc 3: CE6), `t_p3_revizii`, `t_p4_anulare_limite` (bloc 3: CE4), `t_p5_import`, `t_p6_confirma`, `t_p7_acces`, `t_p7b_acelasi_contract` (CE1), `t_p8_contract_comun` (bloc 2: CE3), `t_d5_identitati` (CE7; clona e PG17 local, rulat ca superutilizator, deci `SET SESSION AUTHORIZATION authenticator` e permis) — aceleași așteptări ca în PGlite (fiecare bloc = `DO` cu `RAISE NOTICE 't_… ok'` sau excepție; SQLSTATE și codul `DCC_` verificate exact), plus `t_regresie_rest_decontat`: `fn_rest_decontat_drept` și `fn_executie_proiect_permis` dau aceleași valori ca înainte pe identitățile sintetice (dacă 20270105a e aplicată pe clonă; altfel blocul scrie `n/a` explicit).
- **Concurența** (`…_concurenta.sh`, tiparul `20270106a_executie_semnale_concurenta.sh`: `DCC_CLUSTER_DISPENSABIL=da`, bază nouă creată și ștearsă (trap EXIT / INT / TERM), rolurile de cluster create doar dacă lipsesc și șterse la final, scheletul + secțiunile `-- ─── 1.` … `-- ─── 12.` extrase exact, FĂRĂ gărzile runnerului; barieră = sesiunea A într-un `coproc` psql cu marcaje `\warn <PAS> :SQLSTATE`; sesiunea B pornită în fundal cu `application_name = 'dcc_B_<scenariu>'`; **observatorul** (a treia conexiune, `q`) așteaptă `wait_event_type = 'Lock'` pe backend-ul lui B în `pg_stat_activity` (până la 30 s, altfel scenariul pică); fără `sleep` orb; codul de ieșire al fiecărui psql păstrat, fără `|| true`; `lock_timeout 10s` în B doar ca plasă):
  - `C1_prima_alocare_simultana`: seria inițializată cu prag 44, fără alocări; A: `BEGIN; SELECT fn_dcc_aloca(…cheie KA…)` (ține rândul seriei, necomis); B: `fn_dcc_aloca(…cheie KB…)` → observatorul: B în Lock; A `COMMIT` → A = 45, B = 46; `dcc_documente` = 2 rânduri, `ultimul_ocupat = 46`.
  - `C1b_doua_proiecte_simultan`: la fel, A pe proiectul DCC P1, B pe P2, același contract → 45 / 46, nicio eroare de unicitate.
  - `C2_retry_dupa_timeout`: (i) A: `BEGIN; fn_dcc_aloca(K)` necomis; B (același utilizator) reia cu K și aceiași parametri → observatorul: B în Lock (indexul unic al `dcc_intentii`); A `COMMIT` → B întoarce același `document_id` / `cod_text`, `reluat: true`; 1 document. (ii) aceeași schemă, B cu K și alt titlu → `DCC_CHEIE_ALTI_PARAMETRI` după COMMIT-ul lui A. (iii) A `ROLLBACK` (clientul „a căzut” înainte de commit) → B scrie el documentul, o singură dată.
  - `C3_revizii_simultane`: A: `BEGIN; fn_dcc_revizie_noua(doc, K1)` necomis; B: `fn_dcc_revizie_noua(doc, K2)` → B în Lock pe documentul `FOR UPDATE`; A `COMMIT` → A = Rev1, B = Rev2; cu aceeași cheie K1 în B → B = aceeași Rev1, `reluat: true`; niciodată două Rev1.
  - `C4_anulare_vs_revizie`: A: `BEGIN; fn_dcc_anuleaza(doc)` necomis; B: `fn_dcc_revizie_noua(doc)` → B în Lock; A `COMMIT` → B: P0001 `DCC_DOCUMENT_ANULAT`, nicio revizie nouă; alocarea următoare din serie nu refolosește numărul.
  - `C4b_anulare_vs_anexa` (CE4): la fel, B = `fn_dcc_anexa_noua(doc)` (și într-o a doua rundă `fn_dcc_fila_noua` pe un document cu file) → `DCC_DOCUMENT_ANULAT`, 0 anexe / file noi.
  - **`C5_drept_retras_in_asteptare` — ordinea FIXATĂ (P2-6, CE5):**
    1. A (editorul EA): `BEGIN; SELECT fn_dcc_aloca(P1, …, KA)` → marcajul A confirmă că ține rândul seriei, NECOMIS.
    2. B (editorul EB, alt utilizator) pornește `fn_dcc_aloca(P1, …, KB)` în fundal.
    3. Observatorul confirmă că backend-ul lui B e în `wait_event_type = 'Lock'` (deci B a trecut de pașii 1–6: autentificare, reconciliere, PRIMA verificare a dreptului, claim — și așteaptă la pasul 7, rândul seriei). Dacă B nu ajunge în Lock în 30 s, scenariul pică (nu continuă).
    4. Sesiunea C (owner-ul) revocă și COMITE: (a) varianta `C5a` — șterge rândul `executie_dcc` al lui EB; (b) varianta `C5b` — îl restrânge prin `executie_acces_proiect` pe alt proiect. Observatorul confirmă revocarea comisă (o citire nouă vede schimbarea) ȘI că B e încă în Lock.
    5. A `COMMIT`.
    6. B → 42501 `DCC_FARA_DREPT` (reverificarea de la pasul 8, cu instantaneu nou în READ COMMITTED); `dcc_documente` = 1 rând (al lui A); niciun rând `dcc_intentii` pentru KB (claim-ul anulat împreună cu tranzacția).
    Mutantul `fara_reverificare` (fără pasul 8) → B scrie al doilea document → scriptul cere rezultatul OPUS și îl obține. Dacă la pasul 3 B nu e în Lock, și mutantul ar refuza la prima verificare → de aceea pasul 3 e o condiție de oprire, nu un `sleep`.
  - `C6_initializari_suprapuse` (CE2): A: `BEGIN; fn_dcc_initializeaza_serie(P1, …, 'SR1' 100–199)` necomis; B: `fn_dcc_initializeaza_serie(P2, aceeași cheie, 'SR2' 150–249 din G2)` → B în Lock (advisory-ul cheii fără interval); A `COMMIT` → B: 23P01 `DCC_INTERVALE_SUPRAPUSE`, o singură serie. Mutantul `advisory_cu_interval` (cheia advisory cu intervalul, ca în r1, și fără triggerul de disjuncție) → B reușește → opus.
  - `C6b_ghid_vs_initializare` (CE2): A: `BEGIN; fn_dcc_initializeaza_serie(P1, 'SR1' 100–199)` necomis; B: `fn_dcc_proiect_seteaza(P2 → ghidul G3 cu SR1 = 100–150)` → B în Lock (advisory-ul exclusiv al contractului); A `COMMIT` → B: `DCC_GHID_INCOMPATIBIL`, P2 neschimbat. Mutantul `fara_advisory_contract` → B reușește → opus.
  - **Mutanți discriminatorii** (`DCC_MUTANT=…`; fiecare TREBUIE să dea rezultatul OPUS, altfel proba nu discriminează și scriptul iese cu 1): `fara_lock_serie` → C1: B pică pe 23505 sau ia același număr; `fara_reverificare` → C5: B scrie; `fara_claim` → C2 (i): două documente; `fara_lock_document` → C3: a doua revizie pică pe `dcc_revizii_uq` în loc să devină Rev2; `fara_stare_dupa_lock` → C4b: anexa se scrie; `advisory_cu_interval` → C6; `fara_advisory_contract` → C6b.
- **Proba PGlite, secțiunile 2–4** (ca `test_executie_semnale_local.mjs`): refuzurile migrării (fără marcaj, fără plafon / plafon greșit, fără amprenta globală, tabela „înainte” veche, `fn_executie_proiect_permis` cu alt corp → refuz, coloană lipsă în `executie_proiecte`, reaplicare, bugetul lock-ului depășit → 55P03 și nimic schimbat, lock nedeclarat → `L15_LOCK_NEDECLARAT`); revenirea (refuz cu un rând în `dcc_intentii`; refuz cu un trigger schimbat; `rev_lock_set`; aplicare → revenire → reaplicare curate); mutanții migrării (min. 35, fiecare prins la aplicare, la verificări sau de detectorul lui; lista în antetul scriptului): politica `USING (true)` pe `dcc_documente`, `citire_pe_contract`, `GRANT INSERT` pentru `authenticated`, `UNIQUE` parțial pe `stare = 'activ'`, `NULLS DISTINCT` pe documente, `cod_text_unic_global`, `fara_disjunctie_serii`, `advisory_cu_interval`, `fara_ghid_compatibil`, reconcilierea cheii fără comparația hash-ului, `reia_dupa_drept`, hash pe parametrii nenormalizați, lista de revizii deduplicată tăcut, `fn_dcc_drept` fără `fn_executie_proiect_permis`, nivelul `scriere` acceptând `viewer`, `server_fara_session_user`, alocarea care trece în intervalul următor, seria pornită de la 00001 când lipsește, `fila_pe_document_anulat`, `anexa_rpc_fara_stare`, anularea fără motiv pe revizie, `revizie_absenta_zero`, `on_conflict_do_update`, `import_cu_chei_de_legare`, importul cu identitate pe contract (nu pe proiect), mesajul manual cu Message-ID permis, CC fără lista albă, tranziția `trimisa_manual_neverificata → copiata_pentru_gmail` permisă, triggerul de imuabilitate pe `cod_text` scos, `mod_alocare` modificabil, `functie_sql_pe_profiles`, formatorul SQL cu `lpad` 4 la secvență, harta diacriticelor fără `ş`/`ţ` cu sedilă.

**Comenzile complete (parametrizate).** Variabilele (aceleași în toate comenzile):

```bash
MIG=20270108a_executie_dcc_registru
VERS=20270108120000        # versiunea migrării în schema_migrations
VERS_REV=20270108120001    # versiunea revenirii
H=<host clonă>  P=<port clonă>  SYS=<system_identifier clonă>    # pe clonă; pe producție: endpointul de scriere aprobat
GLOBAL=<md5 GLOBAL din citirea țintei: scripts/amprenta_globala_citire.sh … --lista>
SHA_MIG=$(sha256sum supabase/migrations/$MIG.sql | cut -d' ' -f1)
SHA_REV=$(sha256sum supabase/revenire/${MIG}_ROLLBACK.sql | cut -d' ' -f1)
```

1. Proba locală (redari@, fără BD): `node scripts/pglite/test_executie_dcc_registru_local.mjs` (completă, în fundal, timeout 3600000) / `--pana-la tN` / `--doar <bloc>` / `--doar-verificari`; generarea: `node scripts/pglite/test_executie_dcc_registru_local.mjs --scrie-obiecte` și `--scrie-definitii`.
2. Manifestul pe clonă (coordonatorul, în fereastra plafonului extins):
   ```bash
   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/$MIG.sql --versiune $VERS \
     --tinta-host $H --tinta-port $P --tinta-db postgres --tinta-sistem $SYS --user postgres \
     --plafon-tranzactie-ms 15000 --plafon-extins \
     --iesire supabase/migrations/$MIG.l15.tsv --detalii <dosar în afara repo-ului>/$MIG.l15.detalii.txt
   ```
   Așteptat: cod 0, manifestul scris.
3. Aplicarea pe clonă prin runner:
   ```bash
   bash scripts/livrare_migrare.sh --migrare supabase/migrations/$MIG.sql --sha256 $SHA_MIG --versiune $VERS \
     --tinta-db postgres --tinta-sistem $SYS --tinta-host $H --tinta-port $P --user postgres \
     --plafon-tranzactie-ms 15000 --plafon-extins \
     --amprenta-globala $GLOBAL --diferente-globale supabase/migrations/$MIG.l15.tsv
   ```
   Așteptat: cod 0 (APLICAT + ÎNREGISTRAT, poarta 0e trecută).
4. Dry-run: `psql -X -w -v ON_ERROR_STOP=1 -h $H -p $P -U postgres -d postgres -f supabase/tests/${MIG}_dryrun.sql` → cod 0, câte un `NOTICE t_… ok` pe fiecare bloc, `ROLLBACK` la final.
5. Revenirea pe clonă:
   ```bash
   bash scripts/livrare_migrare.sh --migrare supabase/revenire/${MIG}_ROLLBACK.sql --sha256 $SHA_REV --versiune $VERS_REV \
     --tinta-db postgres --tinta-sistem $SYS --tinta-host $H --tinta-port $P --user postgres \
     --plafon-tranzactie-ms 2000
   ```
   Așteptat: cod 0; apoi o citire: niciun obiect `dcc_` / `fn_dcc_` / `trg_dcc_`.
6. Reaplicarea pe clonă: DOAR pe clonă, istoricul celor două versiuni se șterge (ca în `20261226a_redari_predare_clona.sh`): `psql -X -w -v ON_ERROR_STOP=1 -h $H -p $P -U postgres -d postgres -c "DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('$VERS', '$VERS_REV')"`, apoi comanda 3 din nou (cod 0) și comanda 4 din nou (cod 0); la final revenirea (comanda 5) și ștergerea istoricului, ca clona să rămână ca înainte.
7. Concurența (cluster PG17 dispensabil, NU clona, NU producția):
   ```bash
   DCC_CLUSTER_DISPENSABIL=da PGHOST=<h> PGPORT=<p> PGUSER=postgres \
     bash supabase/tests/${MIG}_concurenta.sh dcc_conc_$(date +%Y%m%d%H%M)
   for m in fara_lock_serie fara_reverificare fara_claim fara_lock_document fara_stare_dupa_lock advisory_cu_interval fara_advisory_contract; do
     DCC_CLUSTER_DISPENSABIL=da DCC_MUTANT=$m PGHOST=<h> PGPORT=<p> PGUSER=postgres \
       bash supabase/tests/${MIG}_concurenta.sh dcc_mut_${m}_$(date +%Y%m%d%H%M) || exit 1
   done
   ```
   Așteptat: cod 0 la rularea normală și la fiecare mutant (scriptul iese 0 cu mutant doar dacă a obținut rezultatul opus).
8. Producția (DOAR chat-ul, după GO Jakarinos pe head + „da”-ul proprietarului): proba cu ROLLBACK pe țintă `bash scripts/livrare_l15_manifest.sh … (aceiași parametri ca la 2, cu endpointul producției) --compara-cu supabase/migrations/$MIG.l15.tsv --amprenta-globala $GLOBAL` → `IDENTIC` (0), apoi comanda 3 cu endpointul producției, în fereastra plafonului extins.

- [ ] **Step 1:** scrie revenirea + secțiunile 2–4 ale probei PGlite; rulează → FAIL acolo unde lipsesc blocurile.
- [ ] **Step 2:** completează; `node scripts/pglite/test_executie_dcc_registru_local.mjs` → PASS (toate secțiunile, toți mutanții prinși); rulat în fundal cu timeout lung; `--doar-verificari` pentru bucla scurtă.
- [ ] **Step 3:** `--scrie-obiecte` → `supabase/tests/20270108a_executie_dcc_registru.l15.obiecte.tsv`; `--scrie-definitii` → blocul DEFINITII din revenire; reverifică „inversez schimbarea = identic” pe fișierele generate.
- [ ] **Step 4:** scrie `…_dryrun.sql` și `…_concurenta.sh`; verifică sintaxa SQL cu `libpg-query` 17.8.2 (din scratchpad, fără BD), iar `concurenta.sh` cu `bash -n`; mecanica barierei și a observatorului (inclusiv oprirea la „B nu e în Lock”) se verifică cu un psql fals (ca la 20270105a), pentru că redari@ n-are psql pe BD.
- [ ] **Step 5 (coordonatorul, NU redari@):** comenzile 2–7 de mai sus, în ordine; rezultatele (SHA-ul head-ului, codurile de ieșire, ieșirile) în raportul chat-ului.
- [ ] **Step 6: Commit** `test(executie): registru DCC — revenire, manifest L15, dry-run clona, concurenta`.

### Task 8: Catalogul sub-modulului (date, NERULAT), PR draft, review

**Files:**
- Create: `scripts/executie_dcc_modul_catalog.sql` + `scripts/executie_dcc_modul_catalog_revenire.sql` — **NU e migrare**: un singur `INSERT INTO public.app_modules (key, parent_key, name, icon, description, is_active, show_on_homepage) VALUES ('executie_dcc', 'executie', 'Registru DCC', '✉️', '…', true, false)` cu preflight (cheia nu există; `parent_key` valid; coloanele verificate în catalog) și `RETURNING`; revenirea șterge rândul DOAR dacă nu există niciun `user_module_access` pe `executie_dcc`. Rulate de chat cu „da”-ul proprietarului, după aplicarea migrării (`psql -X -w -v ON_ERROR_STOP=1 -h <H> -p <P> -U postgres -d postgres -f scripts/executie_dcc_modul_catalog.sql`); nu acordă niciun drept.

- [ ] **Step 1:** `npx vitest run src/dcc` + `node scripts/pglite/test_executie_dcc_registru_local.mjs` + `npx vite build` (PR-ul conține `src/dcc/dccCod.js`) → toate verzi.
- [ ] **Step 2:** PR **draft** cu: lista fișierelor, comenzile rulate și ieșirile, matricea L01–L25 completată, deciziile [D1]–[D7] și abaterile 1–8, ce rămâne la coordonator (Step 5 din Task 7) și la proprietar (aplicarea, catalogul, drepturile, datele reale — PR3).
- [ ] **Step 3:** review Jakarinos pe diff (brief cu diff-ul efectiv, SHA-ul head-ului, fără date interne); P0 / P1 reparate înainte de cererea de merge. Merge-ul îl face chat-ul.

---

## Respectarea L01–L25 (de completat cu fișier / linie / test la implementare)

| Regula | Cum se respectă în PR1 |
|---|---|
| L01 | Contorul sub `FOR UPDATE` pe rândul seriei; revizii / file / anexe / anulări / copiat / confirmat sub `FOR UPDATE` pe document; inițializarea sub advisory pe cheia seriei FĂRĂ interval + advisory partajat pe contract; dreptul, starea documentului și compatibilitatea ghidului reverificate după lock (C5, C4b, C6, C6b). |
| L02 | Document + revizii + contor într-un RPC; snapshot + stări; mesaj + legături + stări; import pe lot; ghid + valori + intervale — câte o tranzacție. |
| L03 | n/a (fără lease / derivate). |
| L04 | `dcc_intentii`: cheie UUID per intenție, hash pe parametrii normalizați (listele sortate, dublurile refuzate) + operație + autor; claim `INSERT … ON CONFLICT DO NOTHING` + recitire; aceeași cheie + alt hash = eroare (p2, C2). |
| L05 | Reconcilierea cheii înaintea dreptului; retry-ul primește rezultatul comis, inclusiv după retragerea dreptului (`p_reluare_dupa_retragere`, C2 i / iii). UI-ul (PR2) păstrează cheia până la rezultat dovedit. |
| L06 | Ordinea globală din „Modelul de acces și lock-urile”, scrisă în comentariul fiecărui RPC; lock-urile implicite enumerate; setul migrării și al revenirii declarat și verificat pe `pg_locks`. |
| L07 | Fără GRANT de scriere; triggere BEFORE de imuabilitate / tranziții / disjuncție / document anulat / ștergere / TRUNCATE pe toate tabelele (și pentru `postgres`). |
| L08 | `auth.uid()` singura identitate; coloanele de autor / hash / `continut_hash` / `proiect_dcc_id` la import puse de server; calea serverului distinsă pe `session_user` ([D5], `p_d5_identitati`). |
| L09 | Dreptul pe proiectul FIECĂREI ținte (revizii din liste, documentul reviziei, snapshot, mesaj ↔ revizie din același proiect); citirea strictă pe proiect ([D1], p7b); mesaj generic, fără date ale ocupantului. |
| L10 | n/a (fără secrete în PR1; căsuța e structură goală). |
| L11 | n/a (fără extragere; importul primește valori deja citite, problemele sunt declarate de import). |
| L12 | Importul: lista exactă de câmpuri, lot invalid = refuz total, dublurile din lot refuzate; invariantul inserate + identice + diferite = total. Revizia absentă = NULL, nu 0. |
| L13 | Regex-urile CHECK ancorate `^…$`; clase POSIX; formatorul fără regex pe datele utilizatorului în afara titlului scurt (test pozitiv + negativ în cazuri). |
| L14 | O tranzacție + postcondiții; revenire cu LOCK (set declarat) înaintea verificării, refuz cu date, DROP complet; aplicare → revenire → reaplicare pe PGlite și pe clonă (comenzile 3–6). |
| L15 | Garda de start L15 v2, manifestul `.l15.tsv` generat pe clonă, lista obiectelor din PGlite, dependențele pe amprentă înainte și după, lock-urile pe `pg_locks`. |
| L16 | `UNIQUE NULLS NOT DISTINCT` pe cheia canonică completă (contract + emitent + tematică + tip + secvență), NEPARȚIAL (anularea nu eliberează); revizia pe (document, filă, anexă, revizie, limbă); `cod_text` unic pe contract; identitatea istoricului pe proiect; `continut_hash` pe toate câmpurile admise. |
| L17 | `now()` doar pentru momente; fără conversii de date calendaristice în PR1. |
| L18 | `IS NOT TRUE` / `IS DISTINCT FROM` în gărzi; `~ '[^[:space:]]'` pentru nevid; RPC-urile nu întorc „gol” la eroare; listele goale / NULL refuzate explicit. |
| L19 | `fn_dcc_drept` unic; `fn_dcc_tranzitie_permisa` unic; `fn_dcc_ghid_compatibil_intern` unic (trigger + RPC); formatorul SQL ↔ JS pe același tabel de cazuri + proprietate pe 500 de combinații. |
| L20 | Căile legitime testate (alocare, revizie, filă, anexă, anulare, copiat, confirmat, import, schimbare de ghid compatibil); CHECK-ul de stări derivat din tabelul tranzițiilor; anularea și refuzurile testate separat. |
| L21–L22 | n/a (fără AI). |
| L23 | n/a în PR1 (PR2: registrul se citește cu keyset). |
| L24 | n/a în PR1 (PR2). |
| L25 | Valorile așteptate scrise de mână; RLS / GRANT ca `authenticated` non-owner fără BYPASSRLS; concurență cu 2 sesiuni reale + barieră + observator + mutanți; regresia `fn_executie_proiect_permis` / `fn_rest_decontat_drept`. |

## Ordinea de livrare și ce rămâne la proprietar

PR1 = Task 1–8 într-un singur PR (o migrare). Aplicarea pe producție (runner L15 v2, fereastra plafonului extins), scriptul de catalog `executie_dcc`, acordarea sub-modulului, configurarea ghidurilor / contractelor / proiectelor DCC reale și importul istoric + inițializarea seriilor (PR3) = doar cu „da”-ul proprietarului, prin chat. Deciziile din §8 al specificației (forma `.Rev0`, căsuța, Lot 4, confirmările DCC, proiectul de TEST) nu blochează PR1; schimbarea modului de alocare al unui contract ([D2]) e o operație separată a proprietarului.
