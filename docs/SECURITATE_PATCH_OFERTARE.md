# Patch de securitate Ofertare — constatările (2) și (3), 20261003b

> **Stare: PREGĂTIT și testat local, runda 3 (răspuns la NO-GO-ul Copilot pe runda 2, §11). NEAPLICAT.** Nu s-a atins nimic în Supabase. Commit-ul îl face coordonatorul.
> **Aplicarea cere trei lucruri, în ordinea asta:** (1) excepția de securitate la freeze-ul Ofertare, acordată explicit de Răzvan pe domeniul exact al acestui patch (2 funcții, fără tabele sau date); (2) GO Copilot pe revizie, cu diff-ul și rezultatul testelor aduse efectiv în chat; (3) pașii din §7 (preview → confirmare → apply → verificare).
> Context: incidentul de expunere OPEN din `docs/SECURITATE_ADVISORS_2026-09-30.md` (branch `claude/erp-continuare-x4p5a7`), §0 punctele 2 și 3, §1. Ce s-a schimbat în runda 2: §10. În runda 3: §11 (secțiunile §4, §5, §7, §10.3 și §10.4 sunt actualizate; unde contrazic §10.1–§10.2, prevalează §11).

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
| `supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql` | Patch-ul. **Fără BEGIN/COMMIT; se livrează doar prin `scripts/livrare_migrare.sh`** (gestionar unic: marcaj + migrare + INSERT în `schema_migrations`, §7). Un singur bloc DO, cu **gardă de livrare la început și la final**. Precondiție pe **stări complete** (helper + alege + pereche, fiecare cu md5(prosrc) + atribute + ACL): live 29.09 \| patch \| oprire. Cele 2 funcții (poarta NULL-safe `IS NOT TRUE`), ACL explicit, apoi **postcondiția înainte de COMMIT**: starea = exact patch-ul. |
| `supabase/revenire/…_OPRIRE_CONTROLATA.sql` | **Nou (runda 3).** Păstrează corpurile patch-ului, retrage EXECUTE de la authenticated, anon, PUBLIC și service_role. Funcționalitatea se oprește, nu se redeschide. Pornește doar din patch. Armare proprie, legată de txid. Ieșirea = `_REPORNIRE.sql`. |
| `supabase/revenire/…_REPORNIRE.sql` | **Nou (runda 4).** Ieșirea din oprire: doar din „oprire”, reface GRANT-urile patch-ului, postcondiție = patch. Armare proprie, legată de txid. |
| `scripts/livrare_migrare.sh` | Traseul comun de livrare, copiat din #538 (`95be8d4`), neschimbat. |
| `supabase/revenire/…_ROLLBACK.sql` | **Mutat din `migrations/`.** ROLLBACK TEHNIC, redeschide bypass-ul; **artefact fără GO de execuție**. Fără BEGIN/COMMIT (gestionarul e operatorul), un singur bloc DO, armare legată de txid, refuz la armare persistentă, pornește din patch \| oprire \| live, postcondiție = live. |
| `supabase/revenire/README.md` | De ce nu le parcurge niciun runner, cum se execută, cine decide. |
| ~~`…_REVENIRE_OPERATIONALA.sql`~~ | **Șters** (runda 3): readucea pragul liber și rescrierea lui `respins_de_om` (NO-GO Copilot). Nu se păstrează nicăieri ca variantă executabilă. |
| `supabase/tests/sec_ofertare_porti.test.sql` | Schelet + copia LIVE (md5(prosrc) și atribute verificate) + fixture. Faze: `setup`, `gaura`, `patched`, `runda2`, **`runda3`** (VN1), **`oprire`**. `t.captureaza`/`t.pune` construiesc stări mixte din definiții reale. |
| `scripts/test_sec_ofertare.sh` | Harness-ul complet pe un cluster PG16 dedicat: static (pas 0), runner-e emulate, T1/T2, stări mixte, atribute, postcondiții, VG1/VG2. `MIG`/`RB`/`OPR`/`REP`/`TEST`/`PATCH_H`/`STATIC` pot fi suprascrise pentru mutanți. |

Alte fișiere `_ROLLBACK.sql` din `supabase/migrations/` (11, de ex. `20260928p_…_ROLLBACK.sql`) sunt o convenție preexistentă, în afara domeniului acestui patch; nu le-am mutat. Nici pe ele nu le parcurge vreun runner (aceeași verificare ca la pasul 0b), dar asta nu e verificat aici fișier cu fișier.

## 5. Teste — cum se rulează și ce au dat
`bash scripts/test_sec_ofertare.sh` (`KEEP=1` lasă clusterul pornit; `PGPORT=5491 PGBASE=/tmp/pg_x` pentru alt cluster). Identitățile sunt simulate ca în PostgREST: `SET ROLE authenticated|anon|service_role` plus `request.jwt.claims`. În schelet, default privileges dau EXECUTE lui anon pe funcțiile noi, ca în Supabase.

Secvența (runda 3) și rezultatul: §11.2. **Rezultat: `TOATE TESTELE AU TRECUT`, exit 0, 502 verificări OK** (runda 2: 344), rulat de două ori pe PG 16.13 (`127.0.0.1:5491`).

**Amprente md5(prosrc)** (textul literal al corpului; aceleași în PG16 și PG17, fiindcă PG stochează corpul așa cum e scris). Sunt valorile din tabelul stărilor, identic în toate fișierele:

| Stare | helper | alege | pereche | ACL alege/pereche | proconfig pereche |
|---|---|---|---|---|---|
| live 29.09 | `429d28e2…` | `56a7c6ddd1e342c77e7b34f4e08ecab1` | `edd4819c81844baafc7eeade838cbcff` | authenticated, postgres, service_role | `public, extensions, pg_temp` |
| **patch 20261003b (runda 3)** | `429d28e2…` | `51865b69766f6baa53def9a6e6c6232b` | `4d90bf90b4bbfd6aea944e734f6c9ed9` | authenticated, postgres, service_role | `public, pg_temp` |
| **oprire controlată** | `429d28e2…` | `51865b69…` (= patch) | `4d90bf90…` (= patch) | **doar postgres** | `public, pg_temp` |

Atributele comune tuturor stărilor (verificate explicit): SECURITY DEFINER, proprietar `postgres`, limbaj, volatilitate (helper `s`, celelalte `v`), STRICT/LEAKPROOF/PARALLEL/COST/ROWS implicite, semnătura cu nume și DEFAULT-uri, fără supraîncărcări (`n=1`), tipul întors.

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
1. **Preview read-only**, cu rezultatul arătat lui Răzvan. Interogarea de mai jos dă exact câmpurile pe care le compară fișierele (o linie per funcție):
   ```sql
   SELECT f.fn, md5(p.prosrc), p.prosecdef, l.lanname, p.provolatile, pg_get_userbyid(p.proowner), p.proconfig,
          pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
          (SELECT array_agg(a::text ORDER BY a::text COLLATE "C") FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a) AS acl,
          p.proisstrict, p.proleakproof, p.proparallel, p.procost, p.prorows,
          (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = f.nume) AS n
     FROM (VALUES ('acces','fn_are_acces_ofertare','public.fn_are_acces_ofertare()'),
                  ('alege','fn_ofertare_alege_acoperire','public.fn_ofertare_alege_acoperire(bigint)'),
                  ('pereche','ofertare_inventar_pereche','public.ofertare_inventar_pereche(bigint,text,integer,real)')) f(fn, nume, sig)
     LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig) LEFT JOIN pg_language l ON l.oid = p.prolang;
   SELECT to_regprocedure('extensions.similarity(text,text)') IS NOT NULL AS trgm_ok;
   SELECT module, access_level, count(*) FROM user_module_access WHERE module LIKE 'ofertare%' GROUP BY 1,2;
   SELECT setdatabase, setrole, c FROM pg_db_role_setting, unnest(setconfig) c WHERE lower(c) LIKE 'gazpet.%';  -- 0 rânduri
   ```
   Se așteaptă exact rândurile `live` din §5 (md5(prosrc), ACL, proconfig) și **`n = 1`** pe toate trei. `n` (lipsa supraîncărcărilor) **nu e în datele citite pe 30.09**: dacă iese altfel, migrarea refuză (fail-closed) și se decide înainte de apply. Rândurile `ofertare.<ceva>` se decid ca în runda 2 (drepturile nu se schimbă din acest patch).
2. **Confirmarea explicită a lui Răzvan**, plus delta pentru Copilot dacă starea s-a schimbat de la ultimul pack.
3. **Apply — traseul comun de livrare** (runda 4 a #538, aplicat identic aici): `scripts/livrare_migrare.sh`, copiat octet cu octet din #538 (commit `95be8d4`).
   ```bash
   bash scripts/livrare_migrare.sh supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql -- "$DB_URL"
   ```
   - **Un singur gestionar de tranzacție**: `psql -X -v ON_ERROR_STOP=1 --single-transaction` cu (1) marcajul `set_config('gazpet.livrare_migrare', '20261003b_sec_ofertare_porti_alege_inventar:' || txid_current(), true)`, (2) migrarea, (3) înregistrarea în `supabase_migrations.schema_migrations` (refuzată dacă numele e deja înregistrat). Orice eroare, inclusiv chiar la INSERT, anulează tot.
   - Migrarea **nu are BEGIN/COMMIT** și are **gardă la început și la final** (după postcondiții): cere marcajul legat de txid-ul curent. Fără runner, refuză: `psql -f` simplu, un simple query, `BEGIN; …; COMMIT;` trimis ca `execute_sql`, și `apply_migration` (harness, pas 3a).
   - **De ce nu `apply_migration`:** trimite SQL-ul la Management API (cod închis); nu se poate demonstra că execuția și înregistrarea sunt în aceeași tranzacție. Garda o face oricum să refuze (fail-closed).
   - Cere conexiune directă la BD (`$DB_URL` cu parolă); de unde se rulează decide Răzvan.
   - Harness: **T1** eroare după prima înlocuire de funcție → definițiile inițiale rămân, 0 înregistrări (din live și din oprire). **T3** eroare injectată chiar la INSERT (trigger BEFORE INSERT pe tabela emulată), după postcondiții și garda de final → stare inițială + 0 înregistrări. **Succes** → patch + exact o înregistrare, fără WARNING de tranzacție. **Reluarea** după succes → refuzată („deja înregistrată”), fără dublare, fără urme.
4. **Imediat după apply:** interogarea din pasul 1 trebuie să dea exact rândurile `patch` din §5, iar `schema_migrations` exact un rând pentru versiune. Un apply reușit le garantează deja (postcondiția și INSERT-ul sunt în aceeași tranzacție); verificarea e o confirmare read-only.
   - **Nicio listă de amprente nu se actualizează automat** cu ce se găsește după apply. Dacă ceva diferă, nu se „corectează” lista: se oprește, se compară, iar o amprentă nouă intră doar printr-un commit revizuit (Copilot + Răzvan).
   - Apoi `get_advisors` (security) și testul LIVE (Ctrl+Shift+R, utilizator cu modulul): „alege” în OfertareCerinte, alegere manuală în OfertareLicitatii, „Compară cu registrul” (respingerile rămân „✕ respinsă”). Urma `SEC-20261003b` în Postgres logs. Test negativ doar cu un cont existent; nu se creează conturi și nu se schimbă drepturi.
5. **Dacă un flux legitim s-a stricat: OPRIRE CONTROLATĂ** (`supabase/revenire/…_OPRIRE_CONTROLATA.sql`), cu acordul lui Răzvan, prin `execute_sql`, ca un singur string:
   ```sql
   BEGIN;
   SELECT set_config('gazpet.oprire_controlata_20261003b', 'OPRESTE_ALEGE_SI_PERECHE:' || txid_current(), true);
   <fișierul întreg>
   COMMIT;
   ```
   **Ieșirea din oprire = `…_REPORNIRE.sql`** (aceeași formă, comutator `gazpet.repornire_20261003b` = `'REPORNESTE_ALEGE_SI_PERECHE:' || txid_current()`): doar din starea „oprire”, reface GRANT-urile, postcondiție = patch. Migrarea nu se reia: runner-ul comun refuză o migrare deja înregistrată. Revenirile nu trec prin `apply_migration`: nu sunt migrări și nu trebuie înregistrate ca aplicate. **De confirmat de Răzvan**: CLAUDE.md pct. 3 spune „DDL prin apply_migration”; aici excepția e voită.
6. **ROLLBACK TEHNIC:** artefact fără GO de execuție. Folosirea cere cererea explicită a lui Răzvan plus o decizie și un review Copilot specifice. Execuția ar fi aceeași formă ca la pasul 5, cu `gazpet.rollback_tehnic_20261003b` = `'REDESCHIDE_BYPASS:' || txid_current()`.
7. **După apply:** un rând în jurnalul verdictelor (`COPILOT_HANDOFF.md` + `handoff_copilot`), apoi actualizarea incidentului în `SECURITATE_ADVISORS_2026-09-30.md`: (2) și (3) trec la „expunere închisă prin poartă” (constatarea (3) rămâne deschisă pe partea de matching, §10.4 pct. 3).

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
- **Comportamentul în PG 17.6:** testele au rulat pe PG 16.13. Amprentele sunt acum md5(prosrc) (textul literal al corpului, fără deparsare), iar atributele deparsate (`pg_get_function_arguments/result`) au dat aceleași valori ca în live (PG 17.6). Orice diferență oprește apply-ul **înainte de COMMIT** (postcondiția), nu după.
- **Cum trimit `apply_migration` / `execute_sql` textul:** neobservat direct. Harness-ul acoperă patru forme de runner (§7 pasul 3); cu runner-ul ca gestionar unic, o eroare oriunde (inclusiv la INSERT) nu lasă nimic comis și nimic înregistrat.
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

**Poziția după verdictul Copilot (runda 3):**
- **B e acceptabil doar pentru remedierea punctuală** (reducerea urgentă a bypass-ului), cu acceptarea explicită a limitei temporare de către Răzvan.
- **A (sau un istoric persistent echivalent) e OBLIGAȚIE pentru închiderea auditului**, nu „dacă mai vrem audit”. Rămâne în backlog ca precondiție de închidere, PR separat, după freeze.
- **`RAISE LOG` nu dovedește o schimbare comisă:** poate consemna o încercare dintr-o tranzacție anulată ulterior.
- **Rămân OPEN:** pierderea alegerii precedente, scrierile directe prin REST și concurența. GO-ul punctual nu certifică proveniența alegerilor.
- Nu e implementat nimic în acest patch.

### 10.4 Rezidual în afara patch-ului
Neschimbate de patch, cu PR-ul sau decizia care le ține:
1. **TRUNCATE pe `ofertare_inventar_ai`** (și `ofertare_acoperire`): `anon`/`authenticated` au privilegiul `D` (ACL live `arwdDxtm`), care ocolește RLS și poarta. Nu e accesibil prin PostgREST, dar la nivel SQL da (verificatorul, C11). Se rezolvă în **PR-ul separat P14** (TRUNCATE/ACL). **TRUNCATE rămâne precondiție pentru P2** (Copilot, runda 2). Nivelurile viewer/editor/admin și scrierile REST rămân în patch-uri distincte, cu domeniul limitat acceptat explicit.
2. **`auth.uid()` se sprijină pe GUC-uri:** în live citește întâi `request.jwt.claim.sub` (legacy), apoi `request.jwt.claims`. Cine poate seta GUC-uri la nivel SQL se poate da drept oricine, inclusiv owner-ul:
   - o sesiune directă `postgres` sau dashboard;
   - o funcție SECURITY DEFINER care își face singură `set_config`.

   Prin PostgREST nu se poate. În live nu există funcții care își pun singure claims (verificatorul, `pg_proc`; A11/B4). Patch-ul nu schimbă asta.
3. **Potriviri greșite și la 0.45.** Similaritatea trigram nu înțelege codurile:
   - ISO 14001 vs ISO 9001 = **0.574**; ANRE EDSB vs EDIB = **0.575** (textele verificatorului);
   - pe formulări aproape identice ajunge la 0.755 / 0.826 (măsurat local).

   „Acoperit” poate deci ascunde un gol real și la pragul din UI. Podeaua 0.45 doar împiedică apelantul să înrăutățească situația; **nu e dovadă semantică de satisfacere**.
   **Nu e doar o decizie de produs** (Copilot, runda 2): similaritatea care produce „acoperit” și ascunde obligații neconfirmate **contrazice Audit V2**. Nu blochează poarta (reducerea expunerii), dar **blochează declararea matching-ului drept corect și închiderea constatării (3) complete**. Remediul (potrivire exactă pe coduri sau confirmare umană pentru „acoperit”) e un patch separat.
4. **`access_level` ignorat** (P16): `viewer`, `editor` (afișat „👁 Vizualizare”) și `admin` scriu la fel, prin RPC și prin RLS. Un nivel „doar citire” real cere o schimbare în `fn_are_acces_ofertare` și în politici, adică o decizie separată.
5. **Cine are modulul poate scrie `ales`/`verdict` direct prin REST.** Patch-ul închide doar ocolirea prin RPC a celor fără modul. VE1 arată că un „acoperit” fabricat prin REST se vindecă la următoarea comparare, dar până atunci e vizibil.
6. *(minor, prin REST)* Vocabularul se compară exact: `Respins_de_om` (altă scriere, fără UI) se rescrie (verificatorul, E3).
7. **Rollback-ul tehnic** (`supabase/revenire/…_ROLLBACK.sql`) e **artefact fără GO de execuție**: existența lui și a comutatorului nu autorizează folosirea.
8. **Privilegiile SQL administrative** (sesiune `postgres`, dashboard) pot seta claims și ocoli orice poartă: limită de încredere. O cale API care ar permite falsificarea claims-urilor ar fi un bypass separat.

### 10.5 Ce n-am aplicat și de ce
- **Proveniența (pct. 2):** nimic implementat, conform sarcinii. Decizia e în §10.3.
- **Sub-module (pct. 4) și `access_level` (pct. 10):** comportamentul e neschimbat, conform sarcinii. Doar documentație, preview și teste care fixează comportamentul (VD4, P16).
- **Reziduale (pct. 11):** doar documentate (§10.4). TRUNCATE are PR-ul lui (P14).
- **md5 în PG17** pentru stările „patch” și „revenire”: nu se pot calcula local (doar PG16 disponibil). Listele albe sunt fail-closed, iar pasul 4 din §7 le confirmă la apply.

## 11. Runda 3 (30.09): răspuns la NO-GO Copilot
Verdictul integral: `docs/SECURITATE_PATCH_OFERTARE_VERDICT_COPILOT_R2.md`. Runda 3 include și verdictul Copilot pe #538 r3 (GO pe SQL, NO-GO pe runner-ul cu `BEGIN/COMMIT` în fișier) și traseul comun de livrare din #538 r4 (`95be8d4`).

### 11.1 Punct Copilot → schimbare → test → rezultat
| # | Punct Copilot | Schimbare | Test | Rezultat |
|---|---|---|---|---|
| 1 | Refuz pe NULL: `IF NOT helper` nu refuză un NULL | Ambele funcții: `IF public.fn_are_acces_ofertare() IS NOT TRUE THEN … 42501` | **VN1** (faza `runda3`): helper înlocuit într-o tranzacție anulată cu unul care întoarce NULL; uid cu modul, owner, fără modul → 42501 pe ambele; datele verificate înainte de ROLLBACK | ✅; **pică pe runda 2** |
| 2 | md5 nu acoperă proprietarul sau ACL-ul; PG16/PG17 | Amprenta = **md5(prosrc)** (text literal, calculat și direct din fișier, fără PG) + atribute explicite: SECURITY DEFINER, proconfig, proprietar, limbaj, volatilitate, STRICT/LEAKPROOF/PARALLEL/COST/ROWS, semnătura cu DEFAULT-uri, `n=1` (fără supraîncărcări), tipul întors, **ACL sortat** | pas 0d–0e (fișier = constante), pas 4 (după livrare = constante), pas 9 (ACL anon, ACL fără service_role, SECURITY INVOKER, alt proprietar, search_path, STABLE, COST, helper schimbat, supraîncărcare) | ✅; ACL, proprietar și supraîncărcarea **trec de runda 2** |
| 3 | Perechi, nu liste independente | Un singur tabel de **stări complete** (live \| patch \| oprire × helper/alege/pereche), identic octet cu octet în toate cele 4 fișiere. Migrarea: live \| patch \| oprire. Rollback: patch \| oprire \| live. Oprirea: patch. Repornirea: oprire. **Nicio stare mixtă acceptată** | pas 9: 6 stări mixte × 4 fișiere → refuz, fără urme | ✅; **runda 2 acceptă stările mixte** |
| 4 | Comparația rezultatului înainte de COMMIT | Postcondiție în fiecare fișier: starea = exact starea țintă, altfel RAISE | 6a corp schimbat, 6b CRLF, 7h oprire fără un REVOKE, 8a/8d fără GRANT, 11g corp live schimbat, 12b rollback fără GRANT | ✅; **runda 2 comite** corpul schimbat și CRLF |
| 5 | Revenirea operațională reintroduce pragul 0 și rescrierea `respins_de_om` | Șters `_REVENIRE_OPERATIONALA.sql`. Nou `_OPRIRE_CONTROLATA.sql`: corpurile rămân, EXECUTE retras (inclusiv de la service_role: 0 apeluri, poarta îl refuză oricum). Nou `_REPORNIRE.sql` (ieșirea din oprire) | faza `oprire`: toate identitățile primesc „permission denied”, `respins_de_om` neschimbat, golurile rămân la `p_prag=0`, nimic scris | ✅; revenirea rundei 2 **pică** faza `oprire` |
| 6 | Revenirile descoperite ca migrări | Mutate în `supabase/revenire/` + README; nicio referință din workflow-uri/scripturi, fără `config.toml`, fără `db push` | pas 0a–0b | ✅ |
| 7a | Un singur gestionar al tranzacției (runda 3 pe #538: COMMIT-ul din fișier comitea patch-ul înaintea înregistrării) | **Niciun fișier nu mai are BEGIN/COMMIT**; fiecare e un singur bloc DO. Migrarea se livrează doar prin `scripts/livrare_migrare.sh` (psql `--single-transaction`: marcaj + migrare + INSERT în `schema_migrations`), cu **gardă la început și la final** | 0c, 0f; 3a (psql -f, simple query, `BEGIN;…;COMMIT;` ca execute_sql/apply_migration → refuz); **T1** (eroare după prima înlocuire, din live și din oprire); **T3** (eroare chiar la INSERT, după postcondiții); succes = patch + 1 înregistrare; reluare → refuz, fără dublare | ✅; designul cu BEGIN/COMMIT în fișier **pică T3** (mutantul M1, §11.3) |
| 7b | Armarea legată de tranzacție; SET-ul de sesiune rămas după eșec | Revenirile cer `'<VALOARE>:' \|\| txid_current()`; refuz la armare persistentă (`lower()`); dezarmare la final | **T2** (Copilot) + T2b, T2c, T2d pe oprire și rollback; VG1; armare din altă tranzacție, fără txid, comutatorul altui fișier | ✅; **runda 2 pică T2d** (SET de sesiune înaintea tranzacției + eroare → reluarea trecea) |
| 8 | Proveniență, rezidualul 3, TRUNCATE, rollback tehnic | §10.3 și §10.4 rescrise pe poziția Copilot | — | documentat |

### 11.2 Harness (runda 3)
`PGPORT=5491 PGBASE=/tmp/pg_sec_of_r3 bash scripts/test_sec_ofertare.sh`, PG 16.13: **exit 0, 502 verificări OK, rulat de două ori.** Pașii: 0 static → 1 setup (copia live: md5(prosrc) + atribute = valorile citite din live) → 2 gaura → 3 T1 + runner-e neoficiale → 3b T3 → 4 livrare + reluare → 5 suitele → 6 postcondiții → 7 oprire (armare, VG1, T2*, postcondiție, suita `oprire`) → 8 din oprire (T1, postcondiție, repornire) → 9 stări mixte și atribute → 10 VG2 → 11 rollback tehnic (armare, VG1, T2*, postcondiție, gaura, vacuitate pe live, reluare fără efect) → 12 oprire → rollback din oprire → 13 final (jurnal, `schema_migrations` = o singură înregistrare).

### 11.3 Discriminare și mutanți
**Pe artefactele rundei 2 (`94909d6`)**, cu protocolul lor:

| Test nou | Runda 2 | Runda 3 |
|---|---|---|
| VN1 poarta NULL-safe | **PICĂ** | trece |
| Stări mixte (alege=live/pereche=patch și invers), migrare și rollback | **PICĂ** (acceptă) | trece |
| ACL anon pe alege (migrare, rollback) | **PICĂ** (acceptă) | trece |
| Alt proprietar pe alege | **PICĂ** (comis cu alt proprietar) | trece |
| Supraîncărcare nouă | **PICĂ** (acceptă) | trece |
| SECURITY INVOKER | trece (functiondef îl acoperea) | trece |
| Postcondiție: corp schimbat / CRLF | **PICĂ** (comis) | trece |
| T2 canonic (armare după BEGIN + eroare + ROLLBACK) | trece | trece |
| T2d (SET de sesiune înaintea tranzacției + eroare, reluare) | **PICĂ** (reluarea trece) | trece |
| Faza `oprire` după revenirea rundei | **PICĂ** | trece |
| Static: reveniri în afara `migrations/`, fără BEGIN/COMMIT | **PICĂ** | trece |

**Mutanți pe fișierele noi** (o protecție scoasă; primul pas care pică):
- **Migrare:**
  - BEGIN/COMMIT readăugate → 0c. Cu `STATIC=0`: refuzată de `livrare_migrare.sh` (T1). Cu runner-ul (c) din varianta intermediară: T3, patch comis fără înregistrare.
  - fără precondiție → 9, prima stare mixtă;
  - liste independente → 9, prima stare mixtă;
  - fără atribute fixe → 0e. Cu `STATIC=0`: 9 SECURITY INVOKER;
  - fără postcondiție → 6a;
  - fără GRANT → 8b;
  - fără garda de start → 0f;
  - fără garda de final → 0f. **Cu `STATIC=0` supraviețuiește:** garda de start o acoperă; cea de final prinde doar un `END;` la nivel de instrucțiune, pe care nu-l putem construi fără să cadă alt pas.
- **Rollback:**
  - fără verificarea persistentă → 11e VG1;
  - fără armare → 11a;
  - fără txid → 11b;
  - fără precondiție → 9;
  - fără postcondiție → 11g;
  - fără dezarmare → 11i;
  - BEGIN/COMMIT readăugate → 0c. **Cu `STATIC=0` supraviețuiește:** blocul DO unic rămâne atomic, deci doar verificarea statică impune gestionarul unic.
- **Oprire:**
  - fără verificarea persistentă → 7f;
  - fără armare → 7a;
  - fără txid → 7b;
  - fără precondiție → 7j;
  - fără postcondiție → 7h;
  - fără dezarmare → 12.
- **Repornire:** fără armare → 8c; fără precondiție → 8f; fără postcondiție → 8d.
- **Corp:** poarta `IF NOT` (liste actualizate, `PATCH_H` suprascris) → VN1.

### 11.4 Amprente noi (md5(prosrc))
- **patch:** alege `51865b69766f6baa53def9a6e6c6232b`, pereche `4d90bf90b4bbfd6aea944e734f6c9ed9`, ACL `{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}`.
- **oprire:** aceleași corpuri, ACL `{postgres=X/postgres}`.
- **helper:** neschimbat (`429d28e2a61fb24c8009d67050c16c85`).

Definiția exactă a helperului live, verificată local prin md5(prosrc) și md5(pg_get_functiondef):
```sql
CREATE OR REPLACE FUNCTION public.fn_are_acces_ofertare()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner)
    OR EXISTS (SELECT 1 FROM public.user_module_access uma
               WHERE uma.profile_id = auth.uid() AND uma.module = 'ofertare')
  );
$function$
```
**Nicio listă nu se actualizează automat** după apply (§7 pasul 4).

### 11.5 Deschis / de decis
- **Ieșirea din oprire** e `_REPORNIRE.sql`, nu reaplicarea migrării: runner-ul comun refuză o migrare deja înregistrată. E o abatere de la instrucțiunea inițială a rundei 3, de confirmat.
- **`n = 1`** (fără supraîncărcări) nu e în datele live citite: se confirmă în preview-ul din §7. Dacă diferă, migrarea refuză.
- **Revenirile prin `execute_sql`** (DDL în afara `apply_migration`, CLAUDE.md pct. 3): excepție voită, de confirmat de Răzvan.
- **Livrarea** cere `$DB_URL` cu parolă: decide Răzvan de unde se rulează.
