# Livrarea migrărilor — L15 v2: amprenta GLOBALĂ verificată de runner, înainte și după, în aceeași tranzacție

Versiune: AMPRENTA_GLOBALA **v1** (13.11.2026). Decizie: propunerea coordonatorului + ACCEPT CU CONDIȚII de la recenzent (6 condiții).
Fișiere: blocul unic `scripts/amprenta_globala_v1.sql` (L19), pașii runnerului `scripts/livrare_amprenta.sh` (+ CLI `scripts/livrare_amprenta_gen.sh`),
runnerul `scripts/livrare_migrare.sh` (runda 15), citirea `scripts/amprenta_globala_citire.sh`, manifestul `scripts/livrare_l15_manifest.sh`,
proba pe producție `scripts/portal/dry_prod_e1.sh`, verificatorul mesajului `scripts/test_livrare_mesaj_unic.py --l15`.

## 1. De ce

Regula L15 cere ca o migrare care adaugă o cale nouă de acces să verifice că porțile existente sunt, la aplicare, cele revizuite.
Până acum fiecare migrare își calcula singură „închiderea tranzitivă” a funcțiilor și o compara cu un BASELINE citit din producție.
Pe #1084 au fost trei runde cu același P1: o indirectare pe care închiderea nu o vede (poartă omisă → EXECUTE dinamic → vedere care
cheamă un auxiliar). Drumurile de indirectare sunt practic nemărginite; cataloagele în care stă cod executabil sau drepturi sunt o listă
finită. L15 v2 amprentează **toate** aceste cataloage și lasă runnerul să refuze orice derivă.

**Modelul de amenințare acceptat:** apărăm de DERIVĂ între starea citită și revizuită (baseline) și starea de la aplicare — altă migrare,
o schimbare din dashboard, platforma Supabase — nu de un atacator cu DDL pe producție (acela n-are nevoie de migrarea noastră) și nici de un
artefact aprobat rău-intenționat (artefactul trece prin review).

## 2. Ce acoperă amprenta (AMPRENTA_GLOBALA v1)

Un set de rânduri `(familie, eticheta, amprenta)`; `amprenta = md5(detaliu)`, `detaliu = jsonb_build_array(...)::text`.
`GLOBAL = md5` al setului ordonat `(familie, eticheta) COLLATE "C"`, fiecare rând codificat fără ambiguități ca
`len(familie):familie len(eticheta):eticheta amprenta`; plus numărul de rânduri și câte un md5 pe familie (diagnostic: la refuz se vede
CE familie diferă).

**Perimetrul:** toate schemele, în afară de `pg_catalog`, `information_schema`, `pg_toast`, `pg_temp_N`, `pg_toast_temp_N`. **Nicio schemă de
platformă nu e exclusă** (`auth`, `storage`, `realtime`, `extensions`, `vault`, `cron`, `net`, `graphql` …). Cataloagele fără schemă intră
întregi; baza = doar baza curentă. Obiectele temporare (schemele temporare, `relpersistence = t`) nu intră — nici cele ale migrării, nici
cele ale runnerului.

| Familie | Catalog | Câmpuri (pe lângă etichetă) |
|---|---|---|
| schema | pg_namespace | proprietar, ACL |
| relatie | pg_class (+ pg_index, pg_sequence, pg_partitioned_table, pg_foreign_table, pg_am, pg_tablespace) | relkind, proprietar, ACL, RLS, FORCE, persistență, metoda de acces, reloptions, partiție (relispartition, relpartbound), replica identity, are TOAST, tablespace, tip tabel tipizat; vederi / vederi materializate: `pg_get_viewdef`; partiționate: cheia + partiția implicită; indecși: `pg_get_indexdef` (chei, opclass, colații, expresii, predicat, INCLUDE, NULLS NOT DISTINCT) + unic, PK, excludere, imediat, cluster, valid, ready, live, replident; secvențe: tip, start, increment, min, max, cache, cycle; tabele externe: serverul + md5(opțiuni) |
| coloana | pg_attribute, pg_attrdef | poziția (rangul între coloanele vii), tip + typmod, colație, NOT NULL, identity, generată, valoarea implicită / expresia generată, ACL pe coloană, stocare, compresie, moștenire (local, inhcount), md5(opțiuni FDW) |
| constrangere | pg_constraint | TOATE (CHECK, PK, UNIQUE, FK, EXCLUDE, trigger, domeniu; NOT NULL pe PG18): tip, amânabil, amânat, validat, local, inhcount, NO INHERIT, `pg_get_constraintdef`, indexul |
| trigger | pg_trigger | TOATE, inclusiv cele **interne** (FK): intern, `tgenabled`, funcția, tipul, amânabil, amânat inițial, tabelul constrângerii, constrângerea, nr. argumente, `pg_get_triggerdef` (cele interne au în etichetă constrângerea + funcția + tipul, nu numele cu OID) |
| regula | pg_rewrite | tipul, **`ev_enabled`**, INSTEAD, `pg_get_ruledef` (regula `_RETURN` a vederilor = definiția vederii, deja în relatie) |
| politica | pg_policy | comanda, PERMISSIVE / RESTRICTIVE, rolurile (null = PUBLIC), USING, WITH CHECK |
| functie | pg_proc (+ pg_aggregate, pg_language) | kind, limbaj, proprietar, SECURITY DEFINER, volatilitate, STRICT, LEAKPROOF, PARALLEL, SETOF, cost, rows, VARIADIC, funcția suport, argumentele cu moduri, nume și **valori implicite**, rezultatul, `proconfig`, **`probin`**, md5(`prosrc`), md5(corpul BEGIN ATOMIC deparsat), transformările, ACL; agregate: toate funcțiile, operatorul de sortare, tipurile și valorile inițiale |
| tip | pg_type (+ pg_enum, pg_range) | TOATE tipurile din perimetru (de bază, compuse / rândul tabelelor, domenii, enum, range, multirange, tablouri): typtype, categorie, preferat, proprietar, ACL, lungime, byval, aliniere, stocare, delimitator, NOT NULL, tipul de bază + typmod, colație, valoarea implicită, funcțiile input / output / receive / send / typmodin / typmodout / analyze / subscript, elementul, relația; enum: etichetele în ordine; range: subtip, colație, opclass, canonical, subdiff, multirange |
| operator | pg_operator | proprietar, kind, merge, hash, rezultat, funcțiile code / rest / join, comutator, negator |
| familie_operatori, clasa_operatori, amop, amproc, metoda_acces | pg_opfamily, pg_opclass, pg_amop, pg_amproc, pg_am | proprietar; clasa: familia, tipul, implicită, tipul cheii; amop: scop, operator, familia de sortare, metoda; amproc: funcția; membrii adăugați de extensii la familiile sistemului (oid ≥ 16384) intră și ei; pg_am: tip, handler (toate) |
| cast | pg_cast | TOATE: funcția, contextul, metoda |
| limbaj, transformare | pg_language, pg_transform | proprietar, PL, trusted, handler, inline, validator, ACL; transformările: funcțiile from / to |
| conversie, colatie | pg_conversion, pg_collation | proprietar, codificări, funcția, implicită; provider, determinist, collate, ctype, locale, ICU rules |
| ts_parser, ts_sablon, ts_dictionar, ts_config | pg_ts_parser, pg_ts_template, pg_ts_dict, pg_ts_config, pg_ts_config_map | funcțiile, șablonul, opțiunile, parserul, mapările |
| extensie | pg_extension | proprietar, schema, relocatable, versiunea, extconfig, extcondition |
| trigger_eveniment | pg_event_trigger | evenimentul, proprietar, funcția, starea, tag-urile |
| mostenire | pg_inherits | ordinea, detach pending |
| acl_implicit | pg_default_acl | ACL-ul pe (rol, schemă, tip de obiect) |
| baza, parametru_acl, tablespace | pg_database (doar cea curentă), pg_parameter_acl, pg_tablespace | proprietar, codificare, locale / provider, template, allowconn, connlimit, ACL; ACL pe parametri; tablespace: proprietar, ACL, opțiuni |
| rol, membru, setare_rol | pg_roles, pg_auth_members, pg_db_role_setting | toate atributele (super, inherit, createrole, createdb, login, replication, bypassrls, connlimit, valid until) + rolconfig (valorile ca md5); membru: admin / inherit / set + grantor; setările pe rol / bază (valorile ca md5) |
| fdw, server_extern, mapare_utilizator | pg_foreign_data_wrapper, pg_foreign_server, pg_user_mappings | handler, validator, proprietar, ACL, tip, versiune; **opțiunile doar ca md5** (pot conține secrete) |
| publicatie, publicatie_tabel, publicatie_schema | pg_publication, pg_publication_rel, pg_publication_namespace | proprietar, all tables, operațiile, via root; filtrul de rânduri și coloanele; schemele |
| obiect_mare | pg_largeobject_metadata | agregat: numărul + (proprietar, ACL) ordonate, fără OID-uri |
| eticheta_securitate | pg_seclabels | furnizorul, obiectul, eticheta |
| sesiune | profilul sesiunii de livrare | `DateStyle`, `TimeZone`, `row_security`, `search_path`, `session_replication_role` (citite o dată, „înainte”) |

**NU intră:** statistici (`reltuples`, `relpages`, pg_statistic, contoare de vacuum / freeze), `relfilenode`, valoarea curentă a secvențelor,
datele din tabele, `attstattarget` / `attoptions` / `attmissingval`, `collversion`, statisticile extinse, `relhas*` (derivate, actualizate
leneș), OID-urile și numerele de coloană.

**Canonicalizare (condiția 2):** blocul se evaluează DOAR în contextul canonic — `search_path = pg_catalog, pg_temp`, `TimeZone = UTC`,
`DateStyle = ISO, YMD`, `IntervalStyle = postgres`, `extra_float_digits = 1`, `bytea_output = hex`, `quote_all_identifiers = off`,
`standard_conforming_strings = on`, `lc_monetary = C`; garda `ag_garda` refuză altfel (`AG_V1_CONTEXT_NECANONIC`). Runnerul le pune ca
`SET` pe funcția temporară (la ieșire revin singure: artefactul nu vede nicio schimbare de sesiune); citirea le pune `SET LOCAL`.
Cu `search_path` fixat, obiectele din `pg_catalog` apar **necalificate**, toate celelalte **calificate cu schema** (`reg*::text`,
`format_type`, `pg_get_*def`), iar constantele deparsate (date, intervale, numere, bani) nu depind de sesiunea apelantului.
Serializarea e JSON (nicio ambiguitate de separator, `null` ≠ `""`), listele ordonate `COLLATE "C"`, etichetele sunt unice (validat la
fiecare calcul: `AMPRENTA_GLOBALA_DUBLURA` = refuz).

**Versionare:** orice schimbare a listei de familii, a câmpurilor sau a perimetrului = **v2** (alt marcaj, alt fișier), cu motiv. O excepție
(de ex. o schemă de platformă care se schimbă singură) se face DOAR așa, explicit, ca reducere declarată a garanției.

## 3. Ce NU acoperă (limite declarate)

1. **Date care schimbă rezultatul unei porți:** rândurile din tabelele de drepturi, de alocare și de configurare citite de porți
   (proprietarul, accesul pe module, alocările pe șantier / proiect, plafoanele). Schimbarea lor legitimă e normală; protecția lor ține
   de autorizarea DML. Dacă o regulă de business stă într-un tabel de configurare și contează pentru o migrare, migrarea o verifică
   explicit (rând + valoare) în gărzile ei.
2. **GUC-urile sesiunilor PostgREST:** familia `sesiune` e profilul sesiunii de LIVRARE; configurația sesiunilor API e acoperită doar prin
   setările persistente (`setare_rol`, `rol.rolconfig`), nu prin valorile efective ale fiecărei cereri.
3. **Biblioteci C:** intră doar `probin` (numele) și metadatele extensiei; înlocuirea binarului fără schimbarea lor nu se vede.
4. **Trecerea timpului** (ex. `valid_until` în date) și serviciile externe / JWT-urile.
5. **DDL necoordonat comis după verificarea „după” și înainte de COMMIT.** În forma „un mesaj” fereastra conține doar `lm_timp`, garda
   finală și COMMIT-ul (0 drumuri client↔server; timpul ei apare în NOTICE-urile `AMPRENTA_GLOBALA dupa` → `PLAFON_TIMP`). Fără plafon,
   COMMIT-ul vine într-un mesaj separat al psql (un drum client↔server în plus).
6. **O schimbare urmată de revenire între cele două calcule** nu se vede: diferența de seturi nu e jurnal DDL.
7. **Codul care rulează în COMMIT** (triggere / constrângeri amânabile preexistente care reamână) — aceeași limită ca la plafon (runda 13).
8. **Deparsarea citește cache-ul de catalog** (ultima stare comisă), nu fotografia MVCC: un DDL comis chiar în timpul unui calcul poate
   amesteca stări ⇒ setul nu se potrivește ⇒ refuz / recitire (niciodată o acceptare greșită).
9. **Opțiunile maparilor de utilizator** sunt vizibile doar proprietarului serverului (altfel `null`); parolele rolurilor nu intră;
   `pg_subscription` nu e citibil de `postgres` pe Supabase; obiectele mari intră doar agregat; etichetele de securitate cer un furnizor.
10. **Codul din `pg_catalog`** (funcțiile sistemului) nu intră; cast-urile, metodele de acces, limbajele intră integral.
11. **Coordonarea:** lock-ul consultativ al runnerului serializează DOAR livrările care trec prin el. Dashboard-ul Supabase, un `psql` direct
    sau platforma nu-l respectă: o schimbare a lor în timpul livrării apare ca diferență nedeclarată ⇒ refuz (nimic comis), nu ca acceptare.
12. **Platforma se schimbă singură** (ex. partițiile zilnice Realtime): consecința acceptată e un refuz la „înainte” și recitirea baseline-ului.
13. Un **artefact aprobat rău-intenționat** nu e în model (artefactul trece prin review); obiectele pasului au tag aleator, iar „după”
    reverifică întâi că fotografia de dinainte are încă GLOBAL-ul aprobat.

## 4. Runnerul (runda 15)

```
--amprenta-globala <md5>  --diferente-globale supabase/migrations/<NUME>.l15.tsv     (DOAR împreună; una fără cealaltă = refuz 2)
```

În tranzacția livrării, generate de runner (nu din artefact), cu tag aleator `<T>`:

| Pas | Unde | Ce face |
|---|---|---|
| `2_ag_inainte.sql` | după `1_pre` (lock consultativ, țintă, istoric, marcaj), înaintea copiei | `pg_temp.ag_cat_<T>()` (blocul + GUC-urile canonice pe funcție), `ag_ses_<T>` (profilul sesiunii), `ag_inainte_<T>()`: setul calculat **o dată** (`CREATE TEMP TABLE … AS`), validat, `GLOBAL` = aprobat altfel `AMPRENTA_GLOBALA_INAINTE` (cu md5 pe familii) — nimic schimbat |
| `4_ag_dupa.sql` | după `3_inreg`, înaintea `lm_timp` și a gărzii finale | fotografia de dinainte încă = aprobat; setul recalculat **o dată**; diferența (FULL JOIN pe familie + etichetă, `IS DISTINCT FROM`) = **exact** manifestul, altfel `AMPRENTA_GLOBALA_DUPA` cu lista (`NEDECLARAT` / `ABSENT` / `ALTFEL`); apoi DROP pe obiectele temporare ale pasului |

* Cu `--plafon-tranzactie-ms`: ambii pași sunt în **mesajul unic** (verificat prin `current_query()`: lungime + sha256 al restului ⇒ și
  pașii sunt octet cu octet cei generați). Fără plafon: fișiere `-f` în `--single-transaction`, în aceeași ordine.
* Manifestul: copie protejată (400), format verificat local (refuz 3), numele trebuie să fie `<NUME>.l15.tsv`; cu `--aprobare`, fișierul de
  aprobare trebuie să aibă și rândul `<sha256>  <NUME>.l15.tsv` (formatul `sha256sum`), altfel refuz 3; sha256-ul lui e tipărit mereu.
* `PGTZ` / `PGDATESTYLE` din mediu = refuz 2 (profilul sesiunii trebuie să fie al rolului, ca la citire).
* `--genereaza-in` include pașii și copia manifestului; `scripts/portal/dry_prod_e1.sh` primește
  `--amprenta-globala-18a/-19a` + `--diferente-globale-18a/-19a` și construiește proba cu ROLLBACK în aceeași formă.
* Validatorul artefactului nu se schimbă: pașii nu sunt în artefact, iar artefactul nu le poate numi obiectele (tag aleator). Orice
  `DISCARD TEMP` / DROP al lor face pasul „după” să eșueze ⇒ refuz.
* **Fără opțiunile noi: comportament identic** (biblioteca nici nu se încarcă; liniile psql de dinainte, neschimbate).

## 5. Manifestul diferențelor (`<NUME>.l15.tsv`, lângă migrare, revizuit în PR-ul ei)

O linie pe obiect, separate prin TAB: `familie  eticheta  operatie  amprenta` — `operatie` ∈ `creat` / `schimbat` / `sters`, `amprenta` =
md5-ul final (32 hex) sau `-` la `sters`. Liniile `#` și cele goale se ignoră. Fără wildcard-uri, fără „permis oricum”.
(Supabase CLI ignoră fișierele care nu sunt `*.sql` în `supabase/migrations/`; `.gitattributes` le fixează pe LF.)

**Generarea, pe clonă** (`scripts/livrare_l15_manifest.sh`): aplică migrarea exact în forma livrării (fișierele runnerului, cu plafon —
forma „un mesaj” cu garda finală), pașii în modul TIPĂRIRE, apoi **ROLLBACK** (nimic comis; alias `manifest_l15_nu_e_livrare`, deci nu
poate fi confundat cu o livrare). Verifică completitudinea (liniile = numărul anunțat de server).
**Obiectele implicite apar toate** — proba PGlite o arată pe o migrare cu un tabel nou: tipul rând + tipul tablou, secvența identity,
indexul PK, constrângerile (PK, FK; pe PG18 și NOT NULL), cele 2 triggere interne ale FK pe tabelul nou și cele 2 de pe tabelul REFERIT
(`creat`), politica, funcția; TOAST-ul stă în `pg_toast` (exclus), dar apare ca `are TOAST` în rândul tabelului.

**Comparabilitatea clonă ↔ producție.** Amprenta finală e aceeași doar dacă obiectele atinse și contextul lor sunt identice: numele
rolurilor, proprietarii, ACL-urile implicite (`pg_default_acl`), apartenențele, versiunea majoră PostgreSQL (deparsarea), extensiile
referite. Blocul nu folosește OID-uri, numere de coloană (o clonă din `pg_dump` pierde coloanele șterse — rangul le ignoră) sau numele cu
OID ale triggerelor interne. Verificarea: `amprenta_globala_citire.sh --lista` pe clonă și pe producție, apoi `diff` pe rândurile pe care
le atinge manifestul (și pe `acl_implicit`, `rol`, `membru`). Ideal clona are exact GLOBAL-ul producției (antetul manifestului îl
tipărește). **Fail-closed:** dacă totuși diferă, runnerul refuză pe producție (`ALTFEL`), nimic comis — e o problemă operațională, nu de
siguranță.

## 6. Citirea coordonatorului (doar citire, pe producție)

`scripts/amprenta_globala_citire.sh` — O tranzacție `REPEATABLE READ READ ONLY`:
1. profilul sesiunii + ținta (db, system_identifier, `in_recovery = false`);
2. `--amprente-migrare scripts/<x>_amprente.sql`: **scriptul existent al migrării, nerescris** — rulează o copie din care se scot exact
   linia `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;` și linia `ROLLBACK;` (fiecare trebuie să apară exact o dată — toate
   cele 6 scripturi `*_amprente.sql` existente au forma asta) ⇒ rulează în fotografia comună;
3. `GLOBAL` + rânduri + md5 pe familii + validarea (`--lista`: toate rândurile);
4. `--radacina 'schema.functie(argumente)' …`: lanțul porților (cel mai bun efort: lexical + `pg_depend`, prin vederi) și rândul
   **SEMNALE**: funcții cu EXECUTE dinamic, vederi citite, funcții în alt limbaj decât sql / plpgsql, funcții SECURITY DEFINER fără
   `search_path` propriu — **acestea din urmă = REFUZ** (cod 4, nu se face baseline);
5. verificarea că toate au rulat în aceeași tranzacție; ROLLBACK.

**Semnalele > 0 nu mai sunt refuz automat în migrare** (verificarea lexicală `FOLOSITE` din #1084 respingea fals `jsonb_build_object`):
se examinează și se **acceptă explicit în PR-ul de baseline**, cu o linie:
`SEMNALE acceptate: EXECUTE dinamic N (funcțiile, motiv) · vederi N (care, ce cheamă) · alt limbaj N (care)`.

## 7. Pașii coordonatorului

1. Migrarea anterioară e aplicată (baseline-ul unei migrări se citește **după** aplicarea celei dinainte: GLOBAL-ul include tot).
2. **Citire pe producție:** `amprenta_globala_citire.sh … [--amprente-migrare …] [--radacina …] [--lista] > citire.txt`.
3. **Manifest pe clonă** (clona adusă la starea producției): `livrare_l15_manifest.sh … --iesire supabase/migrations/<NUME>.l15.tsv`;
   compară GLOBAL-ul clonei (antetul manifestului) cu cel din producție; dacă diferă, `--lista` pe amândouă și `diff` (secțiunea 5).
4. **PR de baseline:** GLOBAL-ul (o linie), manifestul (fișierul), linia SEMNALE acceptate, sha256-urile (migrare + manifest).
5. **Proba cu ROLLBACK** (opțional, cu owner-ul): `dry_prod_e1.sh` / forma generică prin `--genereaza-in`.
6. **Aplicarea:** runnerul cu `--amprenta-globala` + `--diferente-globale` (+ `--aprobare` cu ambele sha-uri).
7. Refuz la **„înainte”** (`AMPRENTA_GLOBALA_INAINTE`): catalogul s-a schimbat după citire — compară md5-urile pe familii din mesaj cu
   `citire.txt`, recitește (pasul 2) și refă PR-ul de baseline. Refuz la **„după”**: lista spune exact ce diferă; analiză înainte de orice.

## 8. Cum se scriu migrările de acum

* **Refuzul vine din runner**, nu din migrare: migrarea nu mai trebuie să-și calculeze singură o închidere „completă”.
* Lanțul (închiderea, detaliul funcțiilor) rămâne ca **VIZIBILITATE** pentru review (scriptul `*_amprente.sql` + SEMNALELE citirii).
* Rămâne **refuz**: o funcție SECURITY DEFINER din lanț fără `search_path` propriu (în citire cod 4, iar migrările care au deja garda o păstrează).
* Postcondițiile migrării (drepturi, RLS, corpuri) rămân: manifestul spune CE se schimbă, postcondițiile spun că e CORECT.

## 9. Plafonul tranzacției (timpul)

Cele două calcule sunt în timpul numărat (după BEGIN). Măsurat pe PGlite (PostgreSQL 18 compilat WASM, un singur fir, în memorie) cu un
catalog sintetic de **~1.500 funcții, ~300 tabele, ~50 vederi** (7.151 rânduri în set): **~175 ms pe calcul** (înainte 173–177 ms, după 175 ms;
cache rece și cald la fel, catalogul fiind în memorie). PostgreSQL nativ e de regulă mai rapid decât WASM, dar producția are mai multe
scheme de platformă (auth, storage, realtime, extensions, graphql, vault …) ⇒ **estimare: 100–400 ms pe calcul, 200–800 ms pentru
ambele**. Cifra reală o dă `scripts/test_livrare_l15_v2.sh` (cazul f, rece = server repornit, cald = a doua livrare) și, pe producție,
NOTICE-urile `AMPRENTA_GLOBALA inainte/dupa: … calcul X ms` din proba cu ROLLBACK.

**Recomandare:** pentru livrările cu amprentă globală plafonul rămâne parametrul runnerului; 2000 ms ajunge dacă proba arată
`PLAFON_TIMP` ≤ ~1.500 ms (marjă pentru rețea și lock-uri). **20261221a** cere exact `2000/session` (nu se schimbă): calculul „înainte”
consumă din fereastra ei de lock (`BUGET_LOCK` = 1 s de la BEGIN), iar calculul „după” rulează sub lock-ul ei pe `sites` (SHARE ROW
EXCLUSIVE: oprește scurt doar scrierile în `sites`). Dacă proba pe clonă arată că 2000 ms nu ajung, **propunerea (neimplementată —
decizia coordonatorului)**: calculul „înainte” ca pas SEPARAT, în aceeași conexiune, sub același lock consultativ ținut la nivel de
sesiune (`pg_advisory_lock`), cu tabelul temporar păstrat între tranzacții; „după” rămâne în mesaj. Ce se schimbă la garanție: pasul
„înainte” iese din mesajul verificat prin `current_query()` și din plafon; un DDL comis între cele două tranzacții apare oricum în
diferența de „după” (refuz), dar fereastra „schimbare + revenire” (limita 6) devine mai lungă.

## 10. 20261221a (pe main, NEAPLICATĂ, fișier fixat) prin forma nouă — fără a modifica fișierul

Migrarea își păstrează propria verificare L15 v1 (BASELINE-ul lipit în #1088) — rulează în interiorul pașilor noi.

```bash
# 1. citire pe producție (o fotografie: scriptul ei de amprente + GLOBAL + semnale)
bash scripts/amprenta_globala_citire.sh --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS> --user <U> \
  --amprente-migrare scripts/meteo_xweather_amprente.sql \
  --radacina 'auth.uid()' --radacina 'public.fn_raport_santier_drept(bigint)' --radacina 'public.fn_executie_proiect_permis(bigint, boolean)' \
  > citire_20261221a.txt
# 2. manifestul, pe clonă (PG17, adusă la starea producției)
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --versiune 20261221120000 \
  --tinta-host <clona> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS clona> --user <U> --plafon-tranzactie-ms 2000 \
  --iesire supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv
# 3. aprobarea: ambele sha-uri
sha256sum supabase/migrations/20261221a_meteo_xweather_zilnic.sql supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv \
  | sed 's#supabase/migrations/##' > aprobare_20261221a.txt
# 4. livrarea (forma „un mesaj”, plafon 2000 cerut de migrare)
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --aprobare aprobare_20261221a.txt \
  --versiune 20261221120000 --tinta-db postgres --tinta-sistem <SIS> --tinta-host <H> --tinta-port <P> --user <U> \
  --plafon-tranzactie-ms 2000 --amprenta-globala <GLOBAL din citire_20261221a.txt> \
  --diferente-globale supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv
```

## 11. Probe

| Probă | Unde | Cine |
|---|---|---|
| Blocul + pașii pe PGlite: garda; paritate citire ↔ runner; independența de sesiune; etichete unice; temporare / date / nextval / ANALYZE fără efect; **o schimbare minimă pe fiecare familie** (44 de schimbări + profilul sesiunii; toate familiile în afară de `eticheta_securitate`, fără furnizor în PGlite) + **mutantul** fiecărei familii; secretele nu apar; contraexemplul vederii; manifestul scris de mână = diferența reală; drumul bun; manifest cu rând lipsă / în plus / altă amprentă / altă operație; DDL nedeclarat; timpi | `node scripts/pglite/test_amprenta_globala_local.mjs` | rulat la livrare (PASS) |
| Forma runnerului fără PostgreSQL: argumente, `--aprobare`, mesajul unic cu `--l15`, forma fără plafon, `--genereaza-in`, fără opțiuni | `bash scripts/test_livrare_l15_forma.sh` | coordonatorul (cere python3) |
| PostgreSQL 17 real: (a) contraexemplul, (b) DDL concurent cu barieră (cu și fără plafon) + control, (c) manifest greșit, (d) drumul bun, (e) fără opțiuni, (f) timpi rece / cald | `bash scripts/test_livrare_l15_v2.sh <slot>` (WSL, ca postgres) | coordonatorul pe clonă |
| Regresiile runnerului (neschimbate) | `test_livrare_forma_fin.sh`, `test_livrare_plafon.sh`, `test_portal_e1.sh`, `test_sec_rsvti.sh` | coordonatorul |
| Static (CI): bloc ASCII fără backslash, marcaje, familii = document, nimic statistic, perimetrul, L15 în LECTII | `src/amprentaGlobalaL15v2.test.js` (vitest) | CI |
