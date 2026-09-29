# Patch de securitate Ofertare — constatările (2) și (3), 20261003b

> **Stare: PREGĂTIT și testat local. NEAPLICAT.** Nu s-a atins nimic în Supabase (doar SELECT-uri read-only pe cataloage). Nu s-a făcut commit sau push.
> **Aplicarea cere trei lucruri, în ordinea asta:** (1) excepția de securitate la freeze-ul Ofertare, acordată explicit de Răzvan pe domeniul exact al acestui patch (2 funcții, fără tabele sau date); (2) GO Copilot pe revizie, cu diff-ul și rezultatul testelor aduse efectiv în chat; (3) pașii din §7 (preview → confirmare → apply → verificare).
> Context: incidentul de expunere OPEN din `docs/SECURITATE_ADVISORS_2026-09-30.md` (branch `claude/erp-continuare-x4p5a7`), §0 punctele 2 și 3, §1.

## 1. Pe scurt
| | Azi (live, 29.09) | După patch |
|---|---|---|
| `fn_ofertare_alege_acoperire(bigint)` | Singura poartă e `auth.uid() IS NOT NULL`. Funcția e SECURITY DEFINER, deci ocolește RLS. Orice cont logat schimbă dovada aleasă pe orice cerință din orice licitație, iar alegerea colegului se pierde. | Refuz `42501` fără uid și fără modulul Ofertare (`fn_are_acces_ofertare()`, aceeași regulă ca RLS-ul de scriere). Corpul funcției rămâne identic. `ales_de` = cine a ales. Alegerea înlocuită lasă o urmă în jurnalul Postgres. |
| `ofertare_inventar_pereche(bigint,text,integer,real)` | **Nicio poartă.** `p_prag` îl alege apelantul: cu 0 totul iese „acoperit” și golurile dispar. În folosire normală rescrie `respins_de_om`. | Refuz `42501` fără uid sau fără modul. Pragul e limitat la [0.30, 0.95], iar NULL devine 0.45. Nu mai atinge `confirmat_de_om`, `respins_de_om` și nici rândurile semnate de om (`verdict_de`). |

Semnăturile, tipurile întoarse și ACL-ul rămân aceleași. `anon` și `PUBLIC` nu au EXECUTE nici azi, iar ACL-ul e reafirmat explicit. Patch-ul nu atinge tabele, politici sau date.

## 2. Ce am verificat read-only în live (29.09, ~21:30 UTC)
- **Definiții:** am citit cu `pg_get_functiondef`. Amprentele md5 sunt `alege 6c9995646a6dbe6da995e48a3a885fc9`, `pereche 500263dacba2b44e0caa1cb07db88d6e` și `fn_are_acces_ofertare 6991b618d5fabbefdbd14684d335db48`. Serverul e PG 17.6. Copia locală din PG16 dă **exact** aceleași md5.
- **`fn_are_acces_ofertare()`** întoarce `auth.uid() IS NOT NULL AND (profiles.is_owner OR user_module_access.module='ofertare')`. **Nu citește `access_level`** (`admin`/`editor`/`viewer`).
- **ACL:** ambele funcții au `{postgres, service_role, authenticated}`, fără anon și fără PUBLIC. Owner-ul e `postgres`.
- **RLS:** pe `ofertare_acoperire`, `ofertare_inventar_ai` și `ofertare_cerinte`, SELECT cere `auth.uid() IS NOT NULL`, iar scrierea cere `fn_are_acces_ofertare()`. Pe `ofertare_acoperire` singurul trigger e `trg_ofertare_acoperire_titular` (BEFORE, pe `ales`), pe care patch-ul nu-l atinge. Indexul unic `ofertare_acoperire_o_aleasa_pe_pozitie` e cel pe care îl ocolesc cei „doi pași”.
- **Valorile reale ale `verdict`**, luate din definiție, din UI (`OfertareLicitatii.jsx` L2440–2524) și din edge `ofertare-inventar-ai`, care inserează fără verdict: `acoperit` și `lipsa_din_registru` vin de la mașină, `confirmat_de_om` și `respins_de_om` vin de la om. UI-ul pune mereu și `verdict_de` și `verdict_la` pe verdictele umane.
- **Apelanți, pe mai multe căi**, pentru că un grep gol nu dovedește că funcția nu se folosește:
  - repo: `OfertareCerinte.jsx` L224/L236 (`alegeAcoperireSigur`), `OfertareLicitatii.jsx` L2627 (alege) și L2410 (pereche, **fără `p_prag`**). Edge functions din repo: niciuna.
  - funcții din BD: nicio altă funcție nu le apelează. Joburi `pg_cron`: niciun job nu le apelează.
  - `pg_stat_statements` (resetat pe 07.08.2026): `fn_ofertare_alege_acoperire` are 5 apeluri, toate prin PostgREST, cu rolul `authenticated`. **Niciun apel ca `service_role` sau `postgres`.** Pentru `ofertare_inventar_pereche` nu există nicio intrare. Fie n-a fost apelată de la reset, fie intrarea a fost evacuată.
  - Ruta `/ofertare` din `App.jsx` cere `requireModule:'ofertare'`. Oricine ajunge pe ecranele respective are deja modulul sau e owner.
- **Istoric pentru alegeri:** nu există. `ofertare_acoperire_istoric` e un instantaneu pe revizie (`revizie_id`, `UNIQUE(revizie_id, cerinta_id)`), fără `ales`/`ales_de`, deci nu poate păstra cine alesese înainte. Din cauza asta: **limitare documentată, fără tabel nou** (§3.1).

## 3. Decizii
### 3.1 `fn_ofertare_alege_acoperire`
- **Poarta vine înainte de orice citire.** Fără modul primești 42501 chiar și pe un id inexistent, deci funcția nu mai poate fi folosită ca să afli ce id-uri există.
- **Proveniența:** `ales_de = auth.uid()` a rândului ales rămâne, cum era. Alegerea înlocuită (rândul și cine o făcuse) se pierdea fără urmă. Acum scrie `RAISE LOG 'SEC-20261003b alege_acoperire: cerinta=… pozitie=… ales=… inlocuit=… inlocuit_ales_de=… de=…'`. **Limitare:** jurnalul Postgres e volatil (retenția de loguri Supabase), deci nu ține loc de istoric. Un istoric durabil cere un tabel nou, adică schemă: decizie separată, în afara freeze-ului.
  - Am luat în calcul și varianta „lăsăm `ales_de` pe rândul scos” și am respins-o. `fn_ofertare_acoperire_reverifica_alese` tratează `ales_de IS NOT NULL` ca „ales de om” și ar începe să marcheze pentru reverificare și rânduri care nu mai sunt alese. Asta ar fi o schimbare de comportament.
- **Refuzul pe status nepotrivit (opțional): NU l-am adăugat.** Motivele:
  1. Ambele fluxuri UI scriu **întâi** rândul și abia **apoi** cheamă RPC-ul. `OfertareLicitatii.jsx` L2622–2628 face UPDATE sau INSERT, apoi RPC. `OfertareCerinte.jsx` L266–273 face INSERT, apoi `alegeAcoperireSigur`. Un refuz doar în RPC ar lăsa jumătăți de operație: un rând modificat, dar neales („Acoperirea s-a salvat, dar nu s-a marcat ca aleasă”), sau candidați orfani.
  2. Calea directă rămâne deschisă pentru cine are modulul: RLS-ul permite UPDATE pe `ales`, iar fallback-ul din `alegeAcoperireSigur` chiar îl folosește. Un refuz doar în RPC n-ar garanta nimic.
  3. Pe ce status să îngheți nu e o întrebare tehnică. Pachetul `aprobat`/`depus`? Licitația `depusa`/`castigata`/`pierduta`/`abandonata`? Se poate schimba dovada după depunere, pentru clarificări? Decide Răzvan.
  → Propunere separată: un trigger BEFORE UPDATE pe `ofertare_acoperire`, pe modelul `fn_ofertare_obiect_in_pachet_inghetat`, cu decizia pe status luată de Răzvan.

### 3.2 `ofertare_inventar_pereche`
- **Prag:** `greatest(0.30, least(coalesce(p_prag, 0.45), 0.95))`. NaN și +∞ devin 0.95, −∞ devine 0.30. Cele două capete sunt alese așa:
  - Limita de jos, 0.30, e sub implicitul din UI (0.45), dar destul de sus încât textele fără legătură (similaritate ≤ 0.12 în fixture) să rămână „lipsă”.
  - Limita de sus, 0.95, lasă să treacă doar textul identic. Un prag de 2 („nimic nu se regăsește”) ar fi inundat ecranul cu goluri false.
  - UI-ul nu trimite `p_prag`, deci nu se schimbă nimic pentru el.
- **Verdictele omului:** se sare peste un rând dacă `COALESCE(verdict,'') IN ('confirmat_de_om','respins_de_om')` **sau** dacă `verdict_de IS NOT NULL`. A doua condiție acoperă și rândurile semnate de om cu alt verdict, pe care UI-ul nu le produce, dar REST-ul direct da. Tot ea e condiția pe care se sprijinea indicatorul din incident („verdict uman suprascris”).
- `similarity` e calificat cu schema (`extensions.similarity`), așa că `search_path = public, pg_temp` (pct. 4). Precondiția verifică `extensions.similarity(text,text)`.
- Rularea scrie `RAISE LOG` cu pragul cerut, pragul aplicat, numărul de rânduri actualizate și cine a rulat.

### 3.3 Identitate (S-A)
Nicio ramură „`auth.uid() IS NULL` ⇒ sistem”. Fără uid, apelul primește 42501, oricine ar fi apelantul: `service_role`, `postgres` din SQL editor sau `authenticated` fără `sub`. Azi n-am găsit niciun apelant fără uid (§2). Dacă apare o nevoie de sistem, ea primește o funcție separată, cu identitate explicită, nu o excepție în poartă.

## 4. Fișiere (worktree `wt-sec-ofertare`, branch `claude/erp-continuare-x4p5a7-sec-ofertare`, din `origin/main`)
| Fișier | Rol |
|---|---|
| `supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql` | Patch-ul. Conține precondiții md5 (nu suprascrie o versiune neauditată; acceptă reaplicarea pe markerul `SEC-20261003b`), cele 2 funcții, ACL explicit și postcondiții (ACL, SECURITY DEFINER, search_path, poartă prezentă). |
| `…_ROLLBACK.sql` | **ROLLBACK TEHNIC: redeschide bypass-ul; doar la cererea explicită a lui Răzvan.** E un singur bloc DO, care nu face nimic fără `SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';` în aceeași sesiune. Readuce starea din 29.09 **byte cu byte** (verifică md5 în interior), apoi dezarmează comutatorul. |
| `…_REVENIRE_OPERATIONALA.sql` | Revenire care **păstrează poarta și ACL-ul** și readuce logica de business din 29.09. Ce se pierde e asumat în antet: pragul liber și rescrierea lui `respins_de_om` revin, dar numai pentru cine are modulul. |
| `supabase/tests/sec_ofertare_porti.test.sql` | Scheletul minim, copia LIVE a celor 3 funcții, ACL-ul live, politicile RLS live, fixture-ul și 4 faze: `setup`, `gaura`, `patched`, `operational`. |
| `scripts/test_sec_ofertare.sh` | Rulează toată secvența pe un cluster PG16 dedicat (`/tmp/pg_sec_ofertare`, `127.0.0.1:5441`). |

## 5. Teste — cum se rulează și ce au dat
`bash scripts/test_sec_ofertare.sh` (`KEEP=1` lasă clusterul pornit). Identitățile sunt simulate ca în PostgREST: `SET ROLE authenticated|anon|service_role` plus `request.jwt.claims`. În schelet, default privileges dau EXECUTE lui anon pe funcțiile noi, ca în Supabase. Dacă o migrare ar face DROP+CREATE în loc de CREATE OR REPLACE, testul P0 ar prinde-o.

**Secvența rulată** (29.09, PG 16.13): setup (copia LIVE, md5 = live) → gaura pe copia live → migrare → migrare a doua oară (idempotentă) → teste → rollback tehnic **nearmat** (refuzat, fără efect) → rollback tehnic armat (md5 = live) → teste care dovedesc gaura → suita patched **cade** pe starea live (testele nu trec „în gol”) → 3 precondiții negative (fiecare funcție modificată între timp duce la refuz, iar tranzacția se anulează fără urme) → reaplicare → teste → revenire operațională → teste pe poartă → reaplicare peste starea operațională → teste → urma din jurnal.

**Rezultat: `TOATE TESTELE AU TRECUT`, exit 0, 231 de verificări OK.**

| Cerință (Copilot / task) | Teste | Rezultat |
|---|---|---|
| Non-owner fără modul primește 42501 pe ambele, la apel direct | P2 (inclusiv Jilava, id inexistent, `p_prag=0`, apel implicit) + O1 | ✅ `42501 Nu ai acces la modulul Ofertare…` |
| Cu modulul Ofertare trece | P4, P6–P9 (alegere), P11–P14 (pereche) | ✅ |
| Owner trece | P5, P15, O2 | ✅ |
| anon nu are EXECUTE | P0 (ACL) + P1 (apel: `permission denied for function`) | ✅ |
| Fără uid / service_role / postgres primesc refuz (S-A) | P3 | ✅ 42501 |
| `p_prag=0` e limitat | P12 (0 și −5 → 0.30, golul rămâne), P13 (2 și NaN → 0.95), P14 (NULL → 0.45) | ✅ |
| `respins_de_om` și `confirmat_de_om` rămân neatinse | P11, P12 (inclusiv `respins_de_om` fără `verdict_de` și un rând semnat de om) | ✅ |
| Traseul legitim funcționează | P4 (butonul „alege”), P8 (OfertareCerinte: INSERT + RPC), P9 (OfertareLicitatii: UPDATE + RPC), P11 (pereche exact ca în UI: `(3, 4)`) | ✅ |
| Proveniența | P4/P5/P9 (`ales_de` = cine a ales), pasul 11 (jurnalul are `inlocuit=1001 inlocuit_ales_de=<coleg> de=<cine>`) | ✅ |
| Refuzurile nu lasă urme | P1–P3 și O1 (instantanee înainte/după identice, inclusiv `updated_at`) | ✅ |
| Rollback-ul tehnic reproduce gaura, reaplicarea o închide | G0–G5 după rollback (md5 = live; fără modul: alegere schimbată, `p_prag=0` cu 0 lipsuri, `respins_de_om` rescris), apoi suita P completă după reaplicare | ✅ |

Amprentele md5 după patch (PG16; cele din PG17 trebuie să iasă la fel, se verifică la apply): alege `1da7260d85e2441d93876c1c590d9f99`, pereche `4ed88708065da6e553646bb114514257`.

## 6. Risc de regresie
- **Utilizatorii legitimi:** risc mic.
  - Ecranele Ofertare cer deja modulul (`requireModule:'ofertare'`).
  - Fluxurile care scriu înainte de RPC trec deja prin RLS cu aceeași poartă.
  - Singurul flux care cheamă RPC-ul direct e „alege” din OfertareCerinte, iar tot acolo sunt doar utilizatori cu modul.
  - Mesajul de eroare (42501, HTTP 403) apare în UI prin `error.message`.
- **Apelanți fără uid:** în repo, `pg_cron` și `pg_stat_statements` nu apare niciunul. Totuși, **edge functions deployate nu au fost citite** (vezi §9). Dacă vreuna le cheamă cu `service_role`, primește 42501 și trebuie tratată cu identitate explicită, nu cu o excepție în poartă.
- **Schimbare de comportament în pereche:**
  - „Compară cu registrul” nu mai „anulează” o respingere. Înainte o anula din greșeală. De acum, anularea unei respingeri n-are cale în UI.
  - `p_prag` NULL dă 0.45. Înainte nu regăsea nimic, dar UI-ul nu trimite NULL.
- **`RAISE LOG`:** apare doar în jurnalul serverului, nu la client, și conține doar id-uri și uuid-uri.
- **Rezidual, neschimbat de patch:**
  1. `fn_are_acces_ofertare()` ignoră `access_level`, deci un „viewer” pe Ofertare trece (P16). La fel se întâmplă azi prin RLS.
  2. Cine are modulul poate scrie `ales`/`verdict` direct prin REST. Patch-ul închide doar ocolirea prin RPC a celor fără modul.
  3. `ofertare_acoperire` și `ofertare_inventar_ai` au TRUNCATE (`D`) pentru `anon` și `authenticated`, iar nicio cheie străină nu le blochează (catalog, 29.09). Asta e PR-ul separat TRUNCATE/ACL, pe care documentul de incident îl pune ca precondiție pentru P2. Nu am verificat dacă există o cale de a emite TRUNCATE ca `authenticated`.

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
   -- cine va trece poarta (doar numărători, pe nivel)
   SELECT access_level, count(*) FROM public.user_module_access WHERE module = 'ofertare' GROUP BY 1;
   -- verdicte umane care de acum rămân fixe (numărători)
   SELECT count(*) FILTER (WHERE verdict = 'respins_de_om') AS respinse, count(*) FILTER (WHERE verdict = 'confirmat_de_om') AS confirmate,
          count(*) FILTER (WHERE verdict_de IS NOT NULL AND verdict NOT IN ('respins_de_om','confirmat_de_om')) AS semnate_altfel
     FROM public.ofertare_inventar_ai;
   ```
   Dacă un md5 diferă, apply-ul **se oprește**. Migrarea oricum ar refuza, dar trebuie văzut ce s-a schimbat.
2. **Confirmarea explicită a lui Răzvan**, plus delta pentru Copilot dacă starea s-a schimbat de la ultimul pack.
3. **Apply:** `apply_migration` cu numele `20261003b_sec_ofertare_porti_alege_inventar` și fișierul **întreg** (o singură tranzacție; precondițiile și postcondițiile sunt în fișier).
4. **Verificare:**
   ```sql
   SELECT p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
          has_function_privilege('public', p.oid, 'EXECUTE') AS public_, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
          p.proconfig, position('SEC-20261003b' IN pg_get_functiondef(p.oid)) > 0 AS marker, md5(pg_get_functiondef(p.oid))
     FROM pg_proc p WHERE p.oid IN ('public.fn_ofertare_alege_acoperire(bigint)'::regprocedure,
                                    'public.ofertare_inventar_pereche(bigint,text,integer,real)'::regprocedure);
   ```
   Se așteaptă `anon=f`, `public_=f`, `auth=t`, `search_path=public, pg_temp`, `marker=t` și md5 egale cu cele din §5. Apoi `get_advisors` (security).
   Test LIVE cu Ctrl+Shift+R, făcut de un utilizator **cu** modulul Ofertare:
   - OfertareCerinte → „alege” pe un candidat;
   - OfertareLicitatii → Acoperire → alegere manuală;
   - „Verificare independentă” → „Compară cu registrul”: respingerile rămân „✕ respinsă”.
   Apoi urma `SEC-20261003b` în Postgres logs.
   Testul negativ live (cont fără modul) se face numai cu un cont existent. **Nu se creează conturi și nu se schimbă drepturi fără acordul lui Răzvan.**
5. **Revenire, dacă e nevoie:**
   - Fluxul legitim s-a stricat: `…_REVENIRE_OPERATIONALA.sql`, cu acordul lui Răzvan. Poarta rămâne.
   - `…_ROLLBACK.sql` e **ROLLBACK TEHNIC**. Redeschide bypass-ul, deci se folosește doar la cererea explicită a lui Răzvan, cu linia `SET gazpet.rollback_tehnic_20261003b = 'REDESCHIDE_BYPASS';` pusă înaintea fișierului în același apply.
6. **După apply:** un rând în jurnalul verdictelor (`COPILOT_HANDOFF.md` + `handoff_copilot`), apoi actualizarea incidentului în `SECURITATE_ADVISORS_2026-09-30.md`: (2) și (3) trec din „expunere actuală” în „închis”, cu data apply-ului.

## 8. Fișa pct. 7 (registru automatizări)
**Nu e cazul.** Patch-ul nu adaugă edge functions, cron, trigger, webhook sau secrete. Modifică două RPC-uri pe care le pornește omul din UI. Pe scurt, pentru context:
- (a) `pereche` citește `ofertare_inventar_ai`, adică ieșire AI generată dintr-un PDF extern.
- (b) Scrie `pereche_cerinta_id` și `verdict`, iar `alege` scrie `ales`/`ales_de`. Nu trimite mailuri și nu atinge bani sau drepturi.
- (c) Rulează SECURITY DEFINER ca `postgres` și ocolește RLS. De asta poarta e în funcție.
- (d) Le poate porni doar cineva cu uid și cu modulul Ofertare (sau owner). **Verificarea e de rol, nu `verify_jwt`.**
- (e) Nu există acțiuni ireversibile. Verdictele umane nu mai sunt atinse.

Regula tare a pct. 7 („citește conținut extern și scrie ⇒ poartă de rol”) e satisfăcută **abia după** patch. Azi `pereche` o încalcă.

## 9. Ce n-am putut verifica
- **Edge functions deployate:** regulile sarcinii permit doar SELECT pe cataloage, așa că nu le-am citit. Absența lor din repo, din `pg_cron` și din `pg_stat_statements` e un indiciu, nu o dovadă.
- **`pg_stat_statements`:** acoperă doar perioada de după 07.08.2026, iar intrările pot fi evacuate. Pentru `pereche` n-am găsit nimic.
- **Retenția jurnalelor Postgres în Supabase** (cât timp rămâne urma `RAISE LOG`): nu am verificat-o.
- **Comportamentul în PG 17.6:** testele au rulat pe PG 16.13. Copiile live au dat md5 identice în PG16, dar md5-urile de după patch se confirmă abia la apply.
- **Triggerul `trg_ofertare_acoperire_titular`:** nu e în schelet (patch-ul nu-l atinge). Comportamentul lui la „alege” e cel de azi.
- **Datele reale:** n-am rulat SELECT pe ele (doar cataloage). Indicatorii de exploatare din documentul de incident rămân cei din 29.09.
