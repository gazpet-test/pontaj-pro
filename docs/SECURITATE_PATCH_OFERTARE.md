# Patch de securitate Ofertare — constatările (2) și (3), 20261003b

> **Stare: PREGĂTIT și testat local, runda 2 (corecturile verificatorului adversarial, verdict CU_CORECȚII, poarta corectă). NEAPLICAT.** Nu s-a atins nimic în Supabase (doar SELECT-uri read-only pe cataloage). Commit-ul îl face coordonatorul.
> **Aplicarea cere trei lucruri, în ordinea asta:** (1) excepția de securitate la freeze-ul Ofertare, acordată explicit de Răzvan pe domeniul exact al acestui patch (2 funcții, fără tabele sau date); (2) GO Copilot pe revizie, cu diff-ul și rezultatul testelor aduse efectiv în chat; (3) pașii din §7 (preview → confirmare → apply → verificare).
> Context: incidentul de expunere OPEN din `docs/SECURITATE_ADVISORS_2026-09-30.md` (branch `claude/erp-continuare-x4p5a7`), §0 punctele 2 și 3, §1. Ce s-a schimbat în runda 2: §10.

## 1. Pe scurt
| | Azi (live, 29.09) | După patch |
|---|---|---|
| `fn_ofertare_alege_acoperire(bigint)` | Singura poartă e `auth.uid() IS NOT NULL`. Funcția e SECURITY DEFINER, deci ocolește RLS. Orice cont logat schimbă dovada aleasă pe orice cerință din orice licitație, iar alegerea colegului se pierde. | Refuz `42501` fără uid și fără modulul Ofertare (`fn_are_acces_ofertare()`, aceeași regulă ca RLS-ul de scriere). Corpul funcției rămâne identic. `ales_de` = cine a ales. Alegerea înlocuită lasă o urmă în jurnalul Postgres (limitele ei și decizia pe istoric: §10.3). |
| `ofertare_inventar_pereche(bigint,text,integer,real)` | **Nicio poartă.** `p_prag` îl alege apelantul: cu 0 totul iese „acoperit” și golurile dispar. În folosire normală rescrie `respins_de_om`. | Refuz `42501` fără uid sau fără modul. Pragul e limitat la **[0.45, 0.95]** (podeaua = implicitul din UI), iar NULL devine 0.45. Nu mai atinge `confirmat_de_om` și `respins_de_om` (vocabularul uman). Un verdict de mașină se recalculează ca azi, chiar dacă are `verdict_de`. |

Semnăturile, tipurile întoarse și ACL-ul rămân aceleași. `anon` și `PUBLIC` nu au EXECUTE nici azi, iar ACL-ul e reafirmat explicit. Patch-ul nu atinge tabele, politici sau date.

## 2. Ce am verificat read-only în live (29.09, ~21:30 UTC)
- **Definiții:** am citit cu `pg_get_functiondef`. Amprentele md5 sunt `alege 6c9995646a6dbe6da995e48a3a885fc9`, `pereche 500263dacba2b44e0caa1cb07db88d6e` și `fn_are_acces_ofertare 6991b618d5fabbefdbd14684d335db48`. Serverul e PG 17.6. Copia locală din PG16 dă **exact** aceleași md5.
- **`fn_are_acces_ofertare()`** întoarce `auth.uid() IS NOT NULL AND (profiles.is_owner OR user_module_access.module='ofertare')`.
  - **Nu citește `access_level`** deloc. Nu e vorba doar de `viewer`, nivel pe care UI-ul nici nu-l oferă. Nivelul `editor`, pe care ecranul de acces îl afișează ca **„👁 Vizualizare (editor)”** (`App.jsx` L7274), scrie la fel ca `admin`.
  - Cere `module = 'ofertare'` **exact**. Sub-modulele `ofertare.*` nu trec.
- **ACL:** ambele funcții au `{postgres, service_role, authenticated}`, fără anon și fără PUBLIC. Owner-ul e `postgres`.
- **RLS:** pe `ofertare_acoperire`, `ofertare_inventar_ai` și `ofertare_cerinte`, SELECT cere `auth.uid() IS NOT NULL`, iar scrierea cere `fn_are_acces_ofertare()`. Pe `ofertare_acoperire` singurul trigger e `trg_ofertare_acoperire_titular` (BEFORE, pe `ales`), pe care patch-ul nu-l atinge. Indexul unic `ofertare_acoperire_o_aleasa_pe_pozitie` e cel pe care îl ocolesc cei „doi pași”.
- **Valorile reale ale `verdict`** le-am luat din definiție, din UI (`OfertareLicitatii.jsx` L2420–2524) și din edge `ofertare-inventar-ai`, care inserează fără verdict:
  - `acoperit` și `lipsa_din_registru` vin de la mașină;
  - `confirmat_de_om` și `respins_de_om` vin de la om.
  - UI-ul scrie `verdict_de: profile?.id || null` (L2426, L2444, L2453, L2458). **Un verdict uman poate deci să nu aibă `verdict_de`**, când profilul lipsește.
  - UI-ul consideră „decis” un rând **doar după vocabular** (L2511: `decis = verdict === 'confirmat_de_om' || verdict === 'respins_de_om'`).
- **Apelanți, pe mai multe căi**, pentru că un grep gol nu dovedește că funcția nu se folosește:
  - repo: `OfertareCerinte.jsx` L224/L236 (`alegeAcoperireSigur`), `OfertareLicitatii.jsx` L2627 (alege) și L2410 (pereche, **fără `p_prag`**). Edge functions din repo: niciuna.
  - funcții din BD: nicio altă funcție nu le apelează. Joburi `pg_cron`: niciun job nu le apelează.
  - `pg_stat_statements` (resetat pe 07.08.2026): `fn_ofertare_alege_acoperire` are 5 apeluri, toate prin PostgREST, cu rolul `authenticated`. **Niciun apel ca `service_role` sau `postgres`.** Pentru `ofertare_inventar_pereche` nu există nicio intrare. Fie n-a fost apelată de la reset, fie intrarea a fost evacuată.
  - Ruta `/ofertare` (`App.jsx` L8597) cere `requireModule="ofertare"`, verificat de `hasModuleAccess` (L112). **Corectură în runda 2:** `hasModuleAccess` acceptă și orice sub-modul `ofertare.*` (`m.startsWith('ofertare.')`), pe când poarta și RLS-ul de scriere cer `module = 'ofertare'` exact. Deci **nu e adevărat că oricine ajunge pe ecran are modulul**.
    - Un cont cu doar `ofertare.<ceva>` vede ecranele. Scrierile directe îi sunt deja refuzate de RLS, azi.
    - Până acum trecea doar prin cele 2 RPC-uri. După patch primește 42501 și acolo (testul VD4).
    - Ecranul de acces din UI oferă numai cheia `ofertare` (L7252). Asemenea rânduri pot apărea doar pe altă cale, iar preview-ul din §7 le numără.
- **Istoric pentru alegeri:** nu există. `ofertare_acoperire_istoric` e un instantaneu pe revizie (`revizie_id`, `UNIQUE(revizie_id, cerinta_id)`), fără `ales`/`ales_de`, deci nu poate păstra cine alesese înainte. Decizia e deschisă: §10.3.

## 3. Decizii
### 3.1 `fn_ofertare_alege_acoperire`
- **Poarta vine înainte de orice citire.** Fără modul primești 42501 chiar și pe un id inexistent, deci funcția nu mai poate fi folosită ca să afli ce id-uri există.
- **Proveniența:** `ales_de = auth.uid()` al rândului ales rămâne, cum era. Alegerea înlocuită (rândul și cine o făcuse) se pierdea fără urmă. Acum rămâne doar în jurnalul Postgres: `RAISE LOG 'SEC-20261003b alege_acoperire: cerinta=… pozitie=… ales=… inlocuit=… inlocuit_ales_de=… de=…'`. Jurnalul **nu ține loc de istoric** (limitele sunt în §10.3). Tabel de istoric sau acceptarea limitei: **DECIZIE pentru Copilot + Răzvan, §10.3**. Runda 2 nu implementează nimic aici.
  - Am luat în calcul și varianta „lăsăm `ales_de` pe rândul scos” și am respins-o. `fn_ofertare_acoperire_reverifica_alese` tratează `ales_de IS NOT NULL` ca „ales de om” și ar începe să marcheze pentru reverificare și rânduri care nu mai sunt alese. Asta ar fi o schimbare de comportament.
- **Refuzul pe status nepotrivit (opțional): NU l-am adăugat.** Motivele:
  1. Ambele fluxuri UI scriu **întâi** rândul și abia **apoi** cheamă RPC-ul. `OfertareLicitatii.jsx` L2622–2628 face UPDATE sau INSERT, apoi RPC. `OfertareCerinte.jsx` L266–273 face INSERT, apoi `alegeAcoperireSigur`. Un refuz doar în RPC ar lăsa jumătăți de operație: un rând modificat, dar neales („Acoperirea s-a salvat, dar nu s-a marcat ca aleasă”), sau candidați orfani.
  2. Calea directă rămâne deschisă pentru cine are modulul: RLS-ul permite UPDATE pe `ales`, iar fallback-ul din `alegeAcoperireSigur` chiar îl folosește. Un refuz doar în RPC n-ar garanta nimic.
  3. Pe ce status să îngheți nu e o întrebare tehnică. Pachetul `aprobat`/`depus`? Licitația `depusa`/`castigata`/`pierduta`/`abandonata`? Se poate schimba dovada după depunere, pentru clarificări? Decide Răzvan.
  → Propunere separată: un trigger BEFORE UPDATE pe `ofertare_acoperire`, pe modelul `fn_ofertare_obiect_in_pachet_inghetat`, cu decizia pe status luată de Răzvan.

### 3.2 `ofertare_inventar_pereche`
- **Prag:** `greatest(0.45, least(coalesce(p_prag, 0.45), 0.95))`. NaN și +∞ devin 0.95, −∞ devine 0.45.
  - **Podeaua 0.45 (runda 2) este chiar implicitul din UI.** Apelantul poate cere o potrivire mai strictă, care arată mai multe goluri, dar niciodată una mai laxă.
  - Podeaua 0.30 din v1 era calibrată pe texte fără legătură (similaritate ≤ 0.17). Obligațiile reale din același domeniu stau însă la 0.33–0.38: ISO 45001 vs 9001 = 0.375, diriginte ISC vs RTE = 0.362, garanție de participare vs de bună execuție = 0.333. Cu `p_prag` 0 sau 0.30, golurile acestea dispăreau.
  - Limita de sus, 0.95, lasă să treacă doar textul (aproape) identic. Un prag de 2 („nimic nu se regăsește”) ar fi inundat ecranul cu goluri false.
  - UI-ul nu trimite `p_prag`, deci pentru el nu se schimbă nimic.
- **Verdictele omului (runda 2):** se sare peste un rând **numai** dacă `COALESCE(verdict,'') IN ('confirmat_de_om','respins_de_om')`, adică exact vocabularul pe care UI-ul îl tratează ca decizie (L2511).
  - `verdict_de` **nu mai contează**. Clauza `verdict_de IS NULL` din v1 îngheța rânduri fabricate prin PATCH REST: un „acoperit” pus peste un gol real, cu `verdict_de` al altcuiva (VE1), sau un verdict golit (VE2). Live-ul le recalcula.
  - Acum un verdict de mașină se recalculează ca înainte, iar `verdict_de`/`verdict_la` rămân cum erau.
  - Verdictele umane scrise de UI fără `verdict_de` sunt protejate de vocabular (VD6).
- `similarity` e calificat cu schema (`extensions.similarity`), așa că `search_path = public, pg_temp` (pct. 4). Precondiția verifică `extensions.similarity(text,text)`.
- Rularea scrie `RAISE LOG` cu pragul cerut, pragul aplicat, numărul de rânduri actualizate și cine a rulat.

### 3.3 Identitate (S-A)
Nicio ramură „`auth.uid() IS NULL` ⇒ sistem”. Fără uid, apelul primește 42501, oricine ar fi apelantul: `service_role`, `postgres` din SQL editor sau `authenticated` fără `sub`. Azi n-am găsit niciun apelant fără uid (§2). Dacă apare o nevoie de sistem, ea primește o funcție separată, cu identitate explicită, nu o excepție în poartă.

## 4. Fișiere (worktree `wt-sec-ofertare`, branch `claude/erp-continuare-x4p5a7-sec-ofertare`, din `origin/main`)
| Fișier | Rol |
|---|---|
| `supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql` | Patch-ul, `BEGIN`/`COMMIT` explicit. Conține **precondiții pe listă albă md5**, per funcție: starea live, starea patch-ului, starea revenirii operaționale. Nu mai acceptă orice corp care poartă markerul `SEC-20261003b`. Urmează cele 2 funcții, ACL explicit și postcondiții (ACL, SECURITY DEFINER, search_path, poartă prezentă). |
| `…_ROLLBACK.sql` | **ROLLBACK TEHNIC: redeschide bypass-ul; doar la cererea explicită a lui Răzvan.** `BEGIN`/`COMMIT` plus un bloc DO. Refuză în trei cazuri: (a) armare persistentă în `pg_db_role_setting`, oricum ar fi scris numele; (b) lipsește `SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';` în sesiunea apply-ului; (c) starea curentă nu e patch, revenire sau live. Readuce starea din 29.09 **byte cu byte** (verifică md5 în interior), apoi dezarmează comutatorul. |
| `…_REVENIRE_OPERATIONALA.sql` | Revenire care **păstrează poarta și ACL-ul** și readuce logica de business din 29.09. **NU e „fără gaură”**: pentru cei CU modul revin pragul liber și rescrierea lui `respins_de_om`. `BEGIN`/`COMMIT`. **Armare proprie**, doar pe tranzacție: `SET LOCAL gazpet.revenire_operationala_20261003b = 'PASTREAZA_POARTA';`. Refuză armarea persistentă. Se aplică **doar din starea patch-ului** (md5). |
| `supabase/tests/sec_ofertare_porti.test.sql` | Scheletul minim, copia LIVE a celor 3 funcții, ACL-ul live, politicile RLS live și fixture-ul. În runda 2 fixture-ul a primit licitația 40 (goluri reale 0.33–0.38 și un `confirmat_de_om` fără `verdict_de`) și un utilizator cu sub-modul. Faze: `setup`, `gaura`, `patched`, **`runda2`** (VD4 VD5 VD6 VE1 VE2, rulabile și câte unul cu `-v doar=`) și `operational`. |
| `scripts/test_sec_ofertare.sh` | Rulează toată secvența pe un cluster PG16 dedicat (implicit `/tmp/pg_sec_ofertare`, `127.0.0.1:5441`; `PGPORT`/`PGBASE` configurabile). Conține testele la nivel de fișier: VG1 (armare persistentă), VG2 (versiune ulterioară cu marker), VG3 (revenire armată și precondiție). Aplicările „ca apply_migration” trimit linia de armare și fișierul într-un singur query. `MIG`/`RB`/`OP`/`TEST` pot fi suprascrise, pentru analiza de mutanți pe fișiere. |

## 5. Teste — cum se rulează și ce au dat
`bash scripts/test_sec_ofertare.sh` (`KEEP=1` lasă clusterul pornit; `PGPORT=5461 PGBASE=/tmp/pg_x` pentru alt cluster). Identitățile sunt simulate ca în PostgREST: `SET ROLE authenticated|anon|service_role` plus `request.jwt.claims`. În schelet, default privileges dau EXECUTE lui anon pe funcțiile noi, ca în Supabase. Dacă o migrare ar face DROP+CREATE în loc de CREATE OR REPLACE, testul P0 ar prinde-o.

**Secvența rulată** (runda 2, 30.09, PG 16.13, `127.0.0.1:5461`):
1. listele albe din fișiere = md5-urile din harness;
2. setup (copia LIVE, md5 = live) → gaura pe copia live;
3. migrare, cu md5 = cel din listele albe → migrare a doua oară (idempotentă) → suitele `patched` + `runda2`;
4. rollback tehnic **nearmat** (refuzat);
5. **VG1**: armare persistentă prin ALTER DATABASE și ALTER ROLE (și cu nume cu majuscule), pe rollback și pe revenire. Refuzată de fiecare dată, fără urme;
6. rollback tehnic armat, ca apply_migration (md5 = live, comutatorul dezarmat în sesiune) → gaura → suita `patched` **cade** pe live → `runda2` test cu test pe live;
7. 3 precondiții negative, plus **VG3** (revenirea din starea live e refuzată);
8. reaplicare → teste;
9. **VG2**: versiuni ulterioare cu marker, pe alege și pe pereche. Migrarea, revenirea și rollback-ul refuză, iar versiunea ulterioară rămâne intactă;
10. revenire operațională: **VG3** nearmată / `SET LOCAL` în afara tranzacției / armată cu altă valoare (toate refuzate) → armată (md5 = cel din listele albe, armarea nu trece de COMMIT) → teste pe poartă → **VG3** a doua oară (refuzată);
11. reaplicare peste starea operațională → teste → urma din jurnal (pragul cerut 0 și 0.3 → aplicat 0.45).

**Rezultat: `TOATE TESTELE AU TRECUT`, exit 0, 344 de verificări OK** (v1: 231).

| Cerință (Copilot / task / verificator) | Teste | Rezultat |
|---|---|---|
| Non-owner fără modul primește 42501 pe ambele, la apel direct | P2 (inclusiv Jilava, id inexistent, `p_prag=0`, apel implicit) + O1 | ✅ `42501 Nu ai acces la modulul Ofertare…` |
| Cu modulul Ofertare trece | P4, P6–P9 (alegere), P11–P14 (pereche) | ✅ |
| Owner trece | P5, P15, O2 | ✅ |
| anon nu are EXECUTE | P0 (ACL) + P1 (apel: `permission denied for function`) | ✅ |
| Fără uid / service_role / postgres primesc refuz (S-A) | P3 | ✅ 42501 |
| `p_prag` e limitat | P12 (0 și −5 → 0.45, golul rămâne), P13 (2 și NaN → 0.95), P14 (NULL → 0.45), **VD5** (0, 0.30, 0.44 pe goluri reale 0.33–0.38 → rămân goluri) | ✅ |
| `respins_de_om` și `confirmat_de_om` rămân neatinse | P11, P12, **VD6** (`confirmat_de_om` fără `verdict_de`, text identic cu o cerință) | ✅ |
| Verdictul de mașină cu `verdict_de` nu se îngheață | P11 rând 7 (perechea falsă 102, sim. 0.17, dispare), **VE1**, **VE2** | ✅ |
| Sub-modul `ofertare.*`: comportament fixat (refuz, ca RLS) | **VD4** | ✅ 42501 |
| `access_level` ignorat (rezidual, documentat) | P16: `viewer` și `editor` („👁 Vizualizare”) trec și scriu | ✅ (rezidual) |
| Traseul legitim funcționează | P4 (butonul „alege”), P8 (OfertareCerinte: INSERT + RPC), P9 (OfertareLicitatii: UPDATE + RPC), P11 (pereche exact ca în UI: `(2, 5)`) | ✅ |
| Proveniența | P4/P5/P9 (`ales_de` = cine a ales), pasul 11 (jurnalul are `inlocuit=1001 inlocuit_ales_de=<coleg> de=<cine>`) | ✅ |
| Refuzurile nu lasă urme | P1–P3, O1, VD4 (instantanee înainte/după identice, inclusiv `updated_at`), VG1–VG3 (md5 neschimbat) | ✅ |
| Rollback-ul tehnic reproduce gaura, reaplicarea o închide | G0–G5 după rollback, apoi suitele P + runda 2 complete după reaplicare | ✅ |
| Armare persistentă refuzată | **VG1** (ALTER DATABASE / ALTER ROLE, nume cu majuscule; rollback și revenire) | ✅ |
| Versiune ulterioară cu marker nesuprascrisă | **VG2** (alege și pereche; migrare, revenire, rollback) | ✅ |
| Revenirea: armată explicit, doar din starea patch-ului | **VG3** (nearmată, `SET LOCAL` rătăcit, altă valoare, din live, peste versiune ulterioară, a doua oară) | ✅ |

**Amprente md5 (PG16).** Acestea sunt valorile din listele albe. Cele din PG17 se verifică la apply (§7, pasul 4).

| Stare | alege | pereche |
|---|---|---|
| live 29.09 (identic în PG17.6) | `6c9995646a6dbe6da995e48a3a885fc9` | `500263dacba2b44e0caa1cb07db88d6e` |
| **patch 20261003b, runda 2** | `1da7260d85e2441d93876c1c590d9f99` (neschimbat față de v1) | `9cf65390fb07c4f84e508a511f8dbd9f` (v1: `4ed88708…`, nu e în listă) |
| revenire operațională | `d1a1a2a45cf57046cf7c26dc981c310f` | `770c29d8066d3003fc0355fc93e7f3fb` |

## 6. Risc de regresie
- **Utilizatorii legitimi:** risc mic.
  - Fluxurile care scriu înainte de RPC trec deja prin RLS cu aceeași poartă. Cine nu trece RLS-ul azi nu poate duce la capăt nici fluxul, cu sau fără patch.
  - Singurul flux care cheamă RPC-ul direct, fără scriere înainte, e „alege” din OfertareCerinte pe un candidat existent. Aici se schimbă ceva pentru conturile care văd ecranul fără modulul exact: **sub-modul `ofertare.*`** (§2). Azi reușeau, după patch primesc 42501. Preview-ul din §7 arată dacă există asemenea conturi.
  - Mesajul de eroare (42501, HTTP 403) apare în UI prin `error.message`.
- **Apelanți fără uid:** în repo, `pg_cron` și `pg_stat_statements` nu apare niciunul. Totuși, **edge functions deployate nu au fost citite** (vezi §9). Dacă vreuna le cheamă cu `service_role`, primește 42501 și trebuie tratată cu identitate explicită, nu cu o excepție în poartă.
- **Schimbare de comportament în pereche:**
  - „Compară cu registrul” nu mai „anulează” o respingere. Înainte o anula din greșeală. De acum, anularea unei respingeri n-are cale în UI.
  - `p_prag` NULL dă 0.45. Înainte nu regăsea nimic, dar UI-ul nu trimite NULL.
  - Un `p_prag` sub 0.45 e ridicat la 0.45. UI-ul nu trimite prag, deci nu se vede nimic.
- **`RAISE LOG`:** apare doar în jurnalul serverului, nu la client, și conține doar id-uri și uuid-uri.
- **Rezidual, neschimbat de patch:** §10.4.

## 7. Pașii de apply (după excepția de freeze, GO Copilot și acordul lui Răzvan)
1. **Preview read-only**, cu rezultatul arătat lui Răzvan:
   ```sql
   SELECT md5(pg_get_functiondef('public.fn_are_acces_ofertare()'::regprocedure)) = '6991b618d5fabbefdbd14684d335db48' AS acces_ok,
          md5(pg_get_functiondef('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure)) = '6c9995646a6dbe6da995e48a3a885fc9' AS alege_ok,
          md5(pg_get_functiondef('public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure)) = '500263dacba2b44e0caa1cb07db88d6e' AS pereche_ok,
          to_regprocedure('extensions.similarity(text,text)') IS NOT NULL AS trgm_ok;
   -- cine le-a apelat de la resetul statisticilor (pe rol)
   SELECT r.rolname, s.calls FROM extensions.pg_stat_statements s JOIN pg_roles r ON r.oid = s.userid
    WHERE s.query ILIKE '%fn_ofertare_alege_acoperire%' OR s.query ILIKE '%ofertare_inventar_pereche%';
   -- cine va trece poarta: module = 'ofertare' trece (ORICE access_level, inclusiv „editor” = „👁 Vizualizare”);
   -- 'ofertare.<ceva>' vede ecranul, dar e refuzat (azi deja de RLS la scrieri; după patch și la cele 2 RPC-uri)
   SELECT module, access_level, count(*) FROM user_module_access WHERE module LIKE 'ofertare%' GROUP BY 1,2;
   -- verdicte umane care de acum rămân fixe + verdicte de mașină cu verdict_de (se recalculează ca azi)
   SELECT count(*) FILTER (WHERE verdict = 'respins_de_om') AS respinse, count(*) FILTER (WHERE verdict = 'confirmat_de_om') AS confirmate,
          count(*) FILTER (WHERE verdict IN ('respins_de_om','confirmat_de_om') AND verdict_de IS NULL) AS umane_fara_verdict_de,
          count(*) FILTER (WHERE verdict_de IS NOT NULL AND verdict IS DISTINCT FROM 'respins_de_om' AND verdict IS DISTINCT FROM 'confirmat_de_om') AS masina_cu_verdict_de
     FROM public.ofertare_inventar_ai;
   -- nicio armare persistentă a comutatoarelor de revenire (trebuie 0 rânduri)
   SELECT setdatabase, setrole, c FROM pg_db_role_setting, unnest(setconfig) c WHERE lower(c) LIKE 'gazpet.%';
   ```
   Dacă un md5 diferă, apply-ul **se oprește**. Migrarea oricum ar refuza, dar trebuie văzut ce s-a schimbat.
   Dacă interogarea pe module arată rânduri `ofertare.<ceva>`, se decide **înainte** de apply: fie acceptăm refuzul, fie Răzvan acordă explicit `ofertare` (CLAUDE.md pct. 3). Drepturile nu se schimbă din acest patch.
2. **Confirmarea explicită a lui Răzvan**, plus delta pentru Copilot dacă starea s-a schimbat de la ultimul pack.
3. **Apply:** `apply_migration` cu numele `20261003b_sec_ofertare_porti_alege_inventar` și fișierul **întreg**. `BEGIN`/`COMMIT` sunt în fișier, la fel precondițiile și postcondițiile.
4. **Verificare:**
   ```sql
   SELECT p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
          has_function_privilege('public', p.oid, 'EXECUTE') AS public_, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
          p.proconfig, position('SEC-20261003b' IN pg_get_functiondef(p.oid)) > 0 AS marker, md5(pg_get_functiondef(p.oid))
     FROM pg_proc p WHERE p.oid IN ('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure,
                                    'public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure);
   ```
   - Se așteaptă: `anon=f`, `public_=f`, `auth=t`, `search_path=public, pg_temp`, `marker=t`.
   - md5 trebuie să fie **alege `1da7260d85e2441d93876c1c590d9f99`, pereche `9cf65390fb07c4f84e508a511f8dbd9f`**.
   - **Dacă în PG17 md5-urile ies altfel, oprește-te aici, înainte să fie nevoie de o revenire.** Listele albe (migrare, revenire, rollback) și `PATCH_MD5` din harness se actualizează într-un commit revizuit.
   - Până atunci revenirea, rollback-ul și reaplicarea **refuză**. E fail-closed: nu strică nimic, dar le blochează.
   - Apoi `get_advisors` (security).
   - Test LIVE cu Ctrl+Shift+R, făcut de un utilizator **cu** modulul Ofertare:
     - OfertareCerinte → „alege” pe un candidat;
     - OfertareLicitatii → Acoperire → alegere manuală;
     - „Verificare independentă” → „Compară cu registrul”: respingerile rămân „✕ respinsă”.
   - Apoi urma `SEC-20261003b` în Postgres logs.
   - Testul negativ live (cont fără modul) se face numai cu un cont existent. **Nu se creează conturi și nu se schimbă drepturi fără acordul lui Răzvan.**
5. **Revenire, dacă e nevoie:** ambele fișiere refuză dacă preview-ul de armare persistentă din pasul 1 are rânduri.
   - **Fluxul legitim s-a stricat:** `…_REVENIRE_OPERATIONALA.sql`, cu acordul lui Răzvan. În același `apply_migration`, prima linie e `SET LOCAL gazpet.revenire_operationala_20261003b = 'PASTREAZA_POARTA';`, urmată de fișierul întreg.
     - Harness-ul simulează exact trimiterea ca un singur query. Dacă linia ajunge totuși în afara tranzacției, revenirea refuză (fail-closed) și linia se mută imediat după `BEGIN;`.
     - Merge **doar din starea patch-ului**. Poarta rămâne, dar pentru cei cu modul revin pragul liber și rescrierea lui `respins_de_om`.
   - **ROLLBACK TEHNIC** (`…_ROLLBACK.sql`): redeschide bypass-ul. Se folosește doar la cererea explicită a lui Răzvan, cu linia `SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';` pusă înaintea fișierului în același apply.
6. **După apply:** un rând în jurnalul verdictelor (`COPILOT_HANDOFF.md` + `handoff_copilot`), apoi actualizarea incidentului în `SECURITATE_ADVISORS_2026-09-30.md`: (2) și (3) trec din „expunere actuală” în „închis”, cu data apply-ului.

## 8. Fișa pct. 7 (registru automatizări)
**Nu e cazul.** Patch-ul nu adaugă edge functions, cron, trigger, webhook sau secrete. Modifică două RPC-uri pe care le pornește omul din UI. Pe scurt, pentru context:
- (a) `pereche` citește `ofertare_inventar_ai`, adică ieșire AI generată dintr-un PDF extern.
- (b) Scrie `pereche_cerinta_id` și `verdict`, iar `alege` scrie `ales`/`ales_de`. Nu trimite mailuri și nu atinge bani sau drepturi.
- (c) Rulează SECURITY DEFINER ca `postgres` și ocolește RLS. De asta poarta e în funcție.
- (d) Le poate porni doar cineva cu uid și cu modulul `ofertare` exact (sau owner). **Verificarea e de rol, nu `verify_jwt`.** Nivelul `access_level` nu contează (§10.4).
- (e) Nu există acțiuni ireversibile. Verdictele umane nu mai sunt atinse.

Regula tare a pct. 7 („citește conținut extern și scrie ⇒ poartă de rol”) e satisfăcută **abia după** patch. Azi `pereche` o încalcă.

## 9. Ce n-am putut verifica
- **Edge functions deployate:** regulile sarcinii permit doar SELECT pe cataloage, așa că nu le-am citit. Absența lor din repo, din `pg_cron` și din `pg_stat_statements` e un indiciu, nu o dovadă.
- **`pg_stat_statements`:** acoperă doar perioada de după 07.08.2026, iar intrările pot fi evacuate. Pentru `pereche` n-am găsit nimic.
- **Retenția jurnalelor Postgres în Supabase:** cât timp rămâne urma `RAISE LOG` n-am verificat exact. Depinde de plan și e de ordinul zilelor.
- **Comportamentul în PG 17.6:** testele au rulat pe PG 16.13. Copiile live au dat md5 identice în PG16. md5-urile stărilor „patch” și „revenire” (listele albe) se confirmă abia la apply, cu fail-closed dacă diferă (§7, pasul 4).
- **Cum trimite `apply_migration` textul:** l-am simulat ca un singur query (`psql -c`), în care `SET LOCAL` pus înaintea `BEGIN;` rămâne în tranzacție. N-am putut observa direct implementarea Supabase. Dacă diferă, revenirea refuză (fail-closed).
- **Triggerul `trg_ofertare_acoperire_titular`:** nu e în scheletul din repo (patch-ul nu-l atinge). Suita verificatorului, cu triggerul live inclus, trece pe runda 2 (§10.2 D).
- **Datele reale:** n-am rulat SELECT pe ele (doar cataloage). Nici pe `user_module_access`: numărătoarea pe sub-module se face în preview (§7). Indicatorii de exploatare din documentul de incident rămân cei din 29.09.

## 10. Runda 2 (30.09): corecturile verificatorului
Verificatorul adversarial a dat **CU_CORECȚII**: poarta e corectă. Suita lui (`sec_ofertare_adv.sql`, 60 de verificări, plus 17 mutanți) a găsit problemele de mai jos. Testele lui D4, D5, D6, E1, E2 sunt integrate în faza `runda2` ca **VD4, VD5, VD6, VE1, VE2**. Testele G1, G2, G3 sunt în harness ca **VG1, VG2, VG3**. Prefixul V evită coliziunea cu G0–G5 din faza `gaura`.

### 10.1 Constatare → schimbare → test
| # | Constatare (gravitate) | Schimbare | Test |
|---|---|---|---|
| 1 | **MEDIU.** Podeaua 0.30 a pragului lasă să dispară goluri reale (0.33–0.38: ISO 45001/9001, diriginte ISC/RTE, garanție participare/bună execuție). | `v_prag := greatest(0.45, least(coalesce(p_prag, 0.45), 0.95))`. Semnătura e aceeași. Podeaua = implicitul din UI. | **VD5** (fixture licitația 40, `p_prag` 0 / 0.30 / 0.44 → golurile rămân). P12 relabelat la 0.45. Log: cerut 0 / 0.3 → aplicat 0.45. |
| 2 | Proveniența alegerii înlocuite există doar în `RAISE LOG`. | **Nimic implementat** (conform sarcinii). DECIZIE pentru Copilot + Răzvan, cu limitele. | §10.3 |
| 3 | **SCĂZUT.** Clauza `verdict_de IS NULL` îngheață rânduri fabricate prin PATCH REST (`verdict='acoperit'`, `verdict_de=<owner>`). | Protecție doar pe vocabularul uman: `COALESCE(verdict,'') NOT IN ('confirmat_de_om','respins_de_om')`. Clauza pe `verdict_de` a fost scoasă. | **VE1**, **VE2**. P11 rândul 7 ajustat: perechea falsă se recalculează, iar P11 întoarce `(2, 5)`. |
| 4 | Sub-module: `App.jsx` L112 acceptă `ofertare.*`, poarta cere `module='ofertare'`. | **Comportament neschimbat.** Interogarea `module, access_level` cu `LIKE 'ofertare%'` e adăugată în preview (§7). Afirmația „oricine ajunge pe ecran are modulul” e corectată (§2, §6). | **VD4** (fixează refuzul; pe live trecea) |
| 5 | Rollback armat persistent: `ALTER DATABASE/ROLE … SET gazpet.rollback_tehnic_20261003b` îl arma permanent. | Rollback-ul refuză dacă `pg_db_role_setting` are vreo intrare `gazpet.rollback_tehnic_20261003b=`. Comparația ignoră majusculele, pentru că și numele GUC le ignoră. Aceeași regulă e pusă și pe comutatorul revenirii. | **VG1** (ALTER DATABASE, cu și fără linia SET; ALTER ROLE cu nume `"GAZPET.Rollback_Tehnic_…"`; revenire) |
| 6 | Precondiția de reaplicare accepta orice corp cu markerul `SEC-20261003b`. | Listă albă md5 per funcție: live, revenire operațională, patch (runda 2). v1 nu e în listă: n-a fost aplicat în live. Harness-ul verifică listele față de md5-urile reale. | **VG2** (versiune ulterioară cu marker, pe alege și pe pereche → refuz, versiunea rămâne) |
| 7 | Revenirea operațională nu era armată și nu verifica starea. Textul din `_ROLLBACK.sql:25` („revenire fără gaură”) era inexact. | Armare proprie `SET LOCAL gazpet.revenire_operationala_20261003b = 'PASTREAZA_POARTA'`, dezarmată la final. Precondiție md5: doar din starea patch-ului. Textul corectat în mesaj și în antete: revenirea păstrează poarta, dar nu e „fără gaură” pentru cei cu modul. | **VG3** (nearmată, `SET LOCAL` în afara tranzacției, altă valoare, din live, peste versiune ulterioară, a doua oară; armarea nu trece de COMMIT) |
| 8 | Fixture-ul n-avea `confirmat_de_om` fără `verdict_de`, deși UI-ul îl produce (`OfertareLicitatii.jsx` L2426/L2444). | Rândul 44: `confirmat_de_om`, `verdict_de` NULL, `verdict_la` în viitor, text identic cu cerința 403. | **VD6** |
| 9 | Lipsea `BEGIN`/`COMMIT` explicit. | Adăugat în migrare, rollback și revenire, ca în 20260928j. | Tot harness-ul (fișierele se aplică fără `psql -1`) |
| 10 | `access_level` ignorat de `fn_are_acces_ofertare`. Nivelul „editor” apare în UI ca „Vizualizare” (`App.jsx` L7274). | **Doar documentat.** Nota și testul P16 corectate: nu e doar `viewer`. | **P16** (viewer și editor trec și chiar scriu) |
| 11 | Rezidual în afara patch-ului. | Documentat: TRUNCATE (P14), `auth.uid()` pe GUC-uri, potriviri greșite și la 0.45. | §10.4 |
| + | *(în plus, aceeași clasă ca 6/7)* Rollback-ul tehnic suprascria orice stare. | Precondiție md5 și pe rollback: pornește doar din patch, revenire sau live. | VG2 („rollback-ul tehnic armat, peste alege ulterioară”) |

### 10.2 Testele noi discriminează (rulat pe 30.09, PG16)
**A. Testele SQL noi, câte unul (`-v doar=`).** Pe ce stare pică:
| Stare | VD4 | VD5 | VD6 | VE1 | VE2 |
|---|---|---|---|---|---|
| live 29.09 | **PICĂ** | **PICĂ** | trece | trece | trece |
| v1 (`924b376`) | trece | **PICĂ** | trece | **PICĂ** | **PICĂ** |
| **v2 (runda 2)** | trece | trece | trece | trece | trece |
| mutant v2: podea 0.30 | trece | **PICĂ** | trece | trece | trece |
| mutant v2: `verdict_de IS NULL` readăugat | trece | trece | trece | **PICĂ** | **PICĂ** |
| mutant v2: `confirmat_de_om` scos din vocabular | trece | trece | **PICĂ** | trece | trece |

Unde un test „trece” pe live sau pe v1, starea aceea era corectă pe punctul respectiv:
- VD6 trece pe live și pe v1: amândouă protejau `confirmat_de_om`.
- VE1 și VE2 trec pe live: live-ul recalcula verdictele de mașină.
- VD4 trece pe v1: v1 avea deja poarta.
Pe acestea le discriminează mutanții. Harness-ul verifică la fiecare rulare rezultatul pe live, test cu test (pasul 6).

**B. Mutanți ai funcțiilor v2.** Primul test care îi prinde, pe suita `patched` | `runda2`:
- podea 0.30: **supraviețuiește** suitei `patched` (exact gaura găsită de verificator), prins de **VD5**;
- podea 0 / prag liber: P12 | VD5;
- fără plafon: P13;
- fără `coalesce`: P14;
- filtrul v1 cu `verdict_de`: P11 | VE1;
- fără `confirmat_de_om`: P11 | VD6;
- fără `respins_de_om`: P11;
- pereche / alege fără poarta de modul: P2 | VD4;
- alege fără proveniență: P4.

**Toți 11 prinși.**

**C. Fișierele v1** (`924b376`), pe scenariile verificatorului:
- VG1 **pică**: rollback-ul v1 redeschide bypass-ul fără linia SET, armat din `pg_db_role_setting`.
- VG2 **pică**: migrarea v1 suprascrie tacit versiunea ulterioară cu marker.
- VG3 **pică** de două ori: revenirea v1 rulează nearmată peste versiunea ulterioară și rulează din starea live.

**Mutanți pe fișierele v2** (fiecare scoate exact o protecție; harness-ul complet trebuie să pice exact la pasul care o țintește):
| Mutant | Unde pică harness-ul |
|---|---|
| rollback fără verificarea persistentă | VG1 ALTER DATABASE, fără linia SET |
| rollback cu nume comparat case-sensitive | VG1 ALTER ROLE `"GAZPET.Rollback_…"` |
| migrarea acceptă markerul (v1) | VG2 migrarea peste alege ulterioară |
| revenire fără armare | VG3 revenirea NEARMATĂ |
| revenire fără precondiția de stare | VG3 revenirea armată, din starea LIVE |
| revenire fără verificarea persistentă | VG1 revenirea, ALTER DATABASE + SET LOCAL |
| rollback fără precondiția de stare | VG2 rollback-ul peste alege ulterioară |

**Toți 7 prinși.**

**D. Suita verificatorului pe v2.** Rulează pe schelet extins: `auth.uid()` live, triggerul `trg_ofertare_acoperire_titular`, triggerele anti-escaladare, ACL-ul de tabel live și roluri străine. Cele 3 aserțiuni „CONSTATARE” (D5, E1, E2) au fost inversate la comportamentul corectat. Rezultat: **60 de verificări OK**.

### 10.3 DECIZIE pentru Copilot + Răzvan: proveniența alegerii înlocuite
**Azi (și după patch):** `fn_ofertare_alege_acoperire` scoate alegerea veche (`ales=false, ales_de=NULL`). Cine alesese înainte se pierde din BD. Rămâne doar linia `RAISE LOG … inlocuit=… inlocuit_ales_de=… de=…`.

Limitele jurnalului, ca să fie clar ce **nu** garantează:
- **se păstrează doar câteva zile** (retenția de loguri a planului Supabase; valoarea exactă neverificată), apoi dispare;
- **nu e tranzacțional**: linia se scrie în momentul `RAISE`. Dacă tranzacția se anulează după aceea, jurnalul arată o înlocuire care n-a avut loc. Invers, nu există o legătură atomică între rând și urmă;
- nu se vede din aplicație și nu se poate interoga cu SQL. Cere acces la logurile din dashboard;
- acoperă doar calea RPC. Cine are modulul poate schimba `ales` direct prin REST (fallback-ul din `alegeAcoperireSigur`), fără nicio urmă.

**Variante:**
- **A. Tabel de istoric**, append-only: `cerinta_id, pozitie_id, ales_id, inlocuit_id, inlocuit_ales_de, de, la`. Ar fi scris de un trigger AFTER UPDATE OF `ales` pe `ofertare_acoperire`, ca să prindă și calea REST, nu doar RPC-ul.
  - Pro: durabil, tranzacțional, interogabil.
  - Contra: schemă nouă (tabel + RLS + GRANT + politici, pct. 4), deci excepție de freeze separată și propria revizie Copilot. Nu intră în acest patch (2 funcții).
- **B. Acceptarea limitei:** rămâne `RAISE LOG`, documentat. Se revine la A când apare o nevoie de audit (dispută pe o dovadă aleasă, clarificări după depunere).

**Propunerea mea:** B acum, ca patch-ul să rămână în domeniul excepției de freeze. A ca PR separat, după freeze, dacă Răzvan vrea audit pe alegeri. **Hotărăsc Răzvan și Copilot. Nu e implementat nimic.**

### 10.4 Rezidual în afara patch-ului
Neschimbate de patch, cu PR-ul sau decizia care le ține:
1. **TRUNCATE pe `ofertare_inventar_ai`** (și `ofertare_acoperire`): `anon`/`authenticated` au privilegiul `D` (ACL live `arwdDxtm`), care ocolește RLS și poarta. Nu e accesibil prin PostgREST, dar la nivel SQL da (verificatorul, C11). Se rezolvă în **PR-ul separat P14** (TRUNCATE/ACL), pe care documentul de incident îl pune ca precondiție.
2. **`auth.uid()` se sprijină pe GUC-uri:** în live citește întâi `request.jwt.claim.sub` (legacy), apoi `request.jwt.claims`. Cine poate seta GUC-uri la nivel SQL se poate da drept oricine, inclusiv owner-ul:
   - o sesiune directă `postgres` sau dashboard;
   - o funcție SECURITY DEFINER care își face singură `set_config`.

   Prin PostgREST nu se poate. În live nu există funcții care își pun singure claims (verificatorul, `pg_proc`; A11/B4). Patch-ul nu schimbă asta.
3. **Potriviri greșite și la 0.45.** Similaritatea trigram nu înțelege codurile:
   - ISO 14001 vs ISO 9001 = **0.574**; ANRE EDSB vs EDIB = **0.575** (textele verificatorului);
   - pe formulări aproape identice ajunge la 0.755 / 0.826 (măsurat local).

   „Acoperit” poate deci ascunde un gol real și la pragul din UI. Podeaua 0.45 doar împiedică apelantul să înrăutățească situația. Remediul e o decizie de produs, în afara patch-ului: potrivire exactă pe coduri (ISO nnnnn, tip ANRE EDIB/EDSB/PDSB…) sau confirmare umană pentru „acoperit”.
4. **`access_level` ignorat** (P16): `viewer`, `editor` (afișat „👁 Vizualizare”) și `admin` scriu la fel, prin RPC și prin RLS. Un nivel „doar citire” real cere o schimbare în `fn_are_acces_ofertare` și în politici, adică o decizie separată.
5. **Cine are modulul poate scrie `ales`/`verdict` direct prin REST.** Patch-ul închide doar ocolirea prin RPC a celor fără modul. VE1 arată că un „acoperit” fabricat prin REST se vindecă la următoarea comparare, dar până atunci e vizibil.
6. *(minor, prin REST)* Vocabularul se compară exact: `Respins_de_om` (altă scriere, fără UI) se rescrie (verificatorul, E3).

### 10.5 Ce n-am aplicat și de ce
- **Proveniența (pct. 2):** nimic implementat, conform sarcinii. Decizia e în §10.3.
- **Sub-module (pct. 4) și `access_level` (pct. 10):** comportamentul e neschimbat, conform sarcinii. Doar documentație, preview și teste care fixează comportamentul (VD4, P16).
- **Reziduale (pct. 11):** doar documentate (§10.4). TRUNCATE are PR-ul lui (P14).
- **md5 în PG17** pentru stările „patch” și „revenire”: nu se pot calcula local (doar PG16 disponibil). Listele albe sunt fail-closed, iar pasul 4 din §7 le confirmă la apply.
