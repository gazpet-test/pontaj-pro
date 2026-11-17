# Livrarea migrărilor — L15 v2: amprenta GLOBALĂ verificată de runner, înainte și după, în aceeași tranzacție

Versiune: AMPRENTA_GLOBALA **v2** (13.11.2026). Decizie: propunerea coordonatorului + ACCEPT CU CONDIȚII de la recenzent (6 condiții),
apoi runda 2 după review (grantorii ACL, regula DEFINER, schemele de sistem, comparabilitatea clonă ↔ țintă), runda 3 (obiectele
create în schemele de sistem prin familiile obișnuite, plasa pe funcțiile de la initdb, momentul fotografiei la recitire) și runda 4
(rândurile atașate după initdb unui părinte de la initdb, plasa independentă de build pe funcții + agregate și relații, detaliul
plasei, momentul înlocuit doar în antetul standard) și runda 5 (limita partițiilor de la initdb în plasa relațiilor, lista închisă a
coloanelor cataloagelor plasei, antetul standard identificat o singură dată).
Fișiere: blocul unic `scripts/amprenta_globala_v2.sql` (L19), pașii runnerului `scripts/livrare_amprenta.sh` (+ CLI `scripts/livrare_amprenta_gen.sh`),
runnerul `scripts/livrare_migrare.sh` (runda 15), citirea `scripts/amprenta_globala_citire.sh`, comparatorul de liste
`scripts/l15_compara_liste.sh`, manifestul și proba pe țintă `scripts/livrare_l15_manifest.sh`, proba pe producție
`scripts/portal/dry_prod_e1.sh`, verificatorul mesajului `scripts/test_livrare_mesaj_unic.py --l15`.

## 1. De ce

Regula L15 cere ca o migrare care adaugă o cale nouă de acces să verifice că porțile existente sunt, la aplicare, cele revizuite.
Până acum fiecare migrare își calcula singură „închiderea tranzitivă” a funcțiilor și o compara cu un BASELINE citit din producție.
Pe #1084 au fost trei runde cu același P1: o indirectare pe care închiderea nu o vede (poartă omisă → EXECUTE dinamic → vedere care
cheamă un auxiliar). Drumurile de indirectare sunt practic nemărginite; cataloagele în care stă cod executabil sau drepturi sunt o listă
finită. L15 v2 amprentează **toate** aceste cataloage și lasă runnerul să refuze orice derivă.

**Modelul de amenințare acceptat:** apărăm de DERIVĂ între starea citită și revizuită (baseline) și starea de la aplicare — altă migrare,
o schimbare din dashboard, platforma Supabase — nu de un atacator cu DDL pe producție (acela n-are nevoie de migrarea noastră) și nici de un
artefact aprobat rău-intenționat (artefactul trece prin review).

## 2. Ce acoperă amprenta (AMPRENTA_GLOBALA v2)

Un set de rânduri `(familie, eticheta, amprenta)`; `amprenta = md5(detaliu)`, `detaliu = jsonb_build_array(...)::text`.
`GLOBAL = md5` al setului ordonat `(familie, eticheta) COLLATE "C"`, fiecare rând codificat fără ambiguități ca
`len(familie):familie len(eticheta):eticheta amprenta`; plus numărul de rânduri și câte un md5 pe familie (diagnostic: la refuz se vede
CE familie diferă).

**Fiecare ACL** (schemă, relație, coloană, funcție, tip, limbaj, ACL implicit, bază, parametru, tablespace, FDW, server extern, obiect mare,
`acl_sistem`) se serializează ca `[beneficiar | null pentru PUBLIC, privilegiu, delegabil, grantor]`. Grantorul contează:
el are autoritatea de revocare (un `REVOKE` făcut de alt grantor nu scoate dreptul) și de el depind drepturile delegate mai departe.

**Perimetrul** (o singură definiție în bloc: CTE-ul `ag_per` — schema + pragul de OID — și câte un CTE de perimetru pe fiecare catalog cu
schemă, toate cu aceeași condiție; familiile nu au predicate proprii, L19): un obiect intră dacă **schema lui e în perimetru SAU schema e
de sistem (`pg_catalog`, `information_schema`) ȘI obiectul e creat după initdb** (`oid >= 16384`, constanta `FirstNormalObjectId`; OID-ul
doar filtrează, nu se serializează). Schemele din perimetru: toate, în afară de `pg_catalog`, `information_schema`, `pg_toast`, `pg_temp_N`,
`pg_toast_temp_N`. **Nicio schemă de platformă nu e exclusă** (`auth`, `storage`, `realtime`, `extensions`, `vault`, `cron`, `net`,
`graphql` …). Cataloagele fără schemă intră întregi; baza = doar baza curentă. Obiectele temporare (schemele temporare,
`relpersistence = t`) nu intră — nici cele ale migrării, nici cele ale runnerului.

**Rândurile atașate** (regulă definită O DATĂ în bloc: CTE-ul `ag_par`, L19). Un rând de catalog cu OID propriu legat de un părinte —
trigger, regulă, politică, constrângere (pe tabel sau pe domeniu), valoarea implicită a unei coloane (`pg_attrdef`), membrii `amop` /
`amproc` ai familiilor de operatori — intră dacă **părintele e în perimetru SAU (părintele e într-o schemă de sistem ȘI rândul atașat e
creat după initdb, `oid >= 16384`)**. `ag_par` dă fiecărui părinte posibil (relație, domeniu, familie de operatori) pragul rândurilor
atașate lui (0 dacă părintele e în perimetru, altfel 16384); toate familiile atașate folosesc doar forma „părintele prin `ag_par`, rândul
prin `oid >= prag`”. Coloanele nu au OID: ale unei relații din perimetru intră toate; ale unei relații de la initdb intră doar cele cu o
valoare implicită atașată după initdb (cu poziția calculată printre toate coloanele vii). **Moștenirea** (`pg_inherits`, fără OID):
perechea intră dacă ORICARE capăt e în perimetru (un tabel de la initdb care moștenește unul al aplicației schimbă ce întoarce tabelul
aplicației). Contraexemplul recenzentului din runda 3 — un trigger `BEFORE INSERT` creat după baseline pe
`information_schema.sql_features`, cu o funcție existentă — e acum văzut (familia `trigger`, plus plasa relațiilor).

**Schemele de sistem.** Un obiect creat în `pg_catalog` e găsit ÎNAINTEA celui din schema aplicației la orice apel necalificat, iar un
`GRANT` pe o funcție de sistem sau pe un tabel TOAST e tot un drept. Ce intră, exact:
- **(i) tot ce are OID propriu ≥ 16384 intră integral** — obiect cu schemă creat după initdb în `pg_catalog` / `information_schema`
  (funcții, relații cu coloanele, tipuri, operatori, clase / familii de operatori, colații, conversii, căutare text) SAU rând atașat după
  initdb unui părinte de la initdb (regula de mai sus) —, prin ACELEAȘI familii și ACELEAȘI expresii ca obiectele aplicației (`functie`,
  `relatie`, `coloana`, `trigger`, `constrangere` …), cu etichetele obișnuite (de ex. `functie l15_helper(boolean)`, `trigger
  information_schema.sql_features.l15_refuza`). Singura excepție: **statisticile extinse** (`pg_statistic_ext`) nu sunt familie nici
  pentru aplicație (doar planificatorul le folosește; nu schimbă rezultatul niciunei interogări) — pe tabelele de la initdb sunt numărate
  în plasa relațiilor. Runda 3 a desființat reprezentarea sumară separată (`sistem_adaugat`); runda 4 a închis rândurile atașate;
- **(ii) din obiectele de la initdb** (`oid < 16384`) intră, ca **PLASĂ** (familia `sistem_initdb`, CTE-ul `ag_plasa`: câte un rând pe
  obiect, din care se calculează un rând `[număr, md5]` pe plasă), într-o reprezentare **independentă de build**:
  - `sistem_initdb functii` — funcțiile + agregatele: identitatea (schema DUPĂ NUME, numele, tipurile argumentelor), kind, limbaj,
    proprietar, SECURITY DEFINER, STRICT, volatilitate, LEAKPROOF, PARALLEL, SETOF, rezultatul, VARIADIC, argumentele (toate tipurile,
    modurile, numele), `proconfig`, numărul argumentelor implicite + expresiile lor **deparsate** (`pg_get_expr`, doar unde există),
    md5(`prosrc`), `probin`, md5(corpul BEGIN ATOMIC **deparsat**, doar unde există), funcția suport, costul și `prorows`, numărul
    argumentelor, transformările (`protrftypes`), iar la agregate câmpurile din
    `pg_aggregate` (funcțiile de tranziție / finală / combinare / serializare și varianta „moving”, extra / modify, operatorul de sortare,
    tipurile și spațiul de stare, valorile inițiale — `CREATE OR REPLACE AGGREGATE` păstrează rândul din `pg_proc`). Celelalte câmpuri
    OID (limbaj, proprietar, tipuri, funcția suport, câmpurile agregatului) au la funcțiile de la initdb valori atribuite la compilare
    (sub 12000, aceleași pe aceeași versiune — verificat de proba PGlite); doar schema `information_schema` primește OID la initdb (depinde
    de câte colații importă initdb pe acel sistem), de aceea e scrisă după nume. Prinde de ex. `ALTER FUNCTION
    pg_catalog.quote_nullable(text) STRICT` și `CREATE OR REPLACE AGGREGATE pg_catalog.bool_and(boolean) (… INITCOND = 'true')`;
  - `sistem_initdb relatii` — relațiile din `pg_catalog` / `information_schema`: identitatea (schema.nume), kind, proprietar (după nume),
    persistență, `relnatts`, `relchecks`, RLS, FORCE RLS, replica identity, partiție + **limita partiției** (`relpartbound` în forma
    canonică, `pg_get_expr(relpartbound, oid)` — nu arborele brut, care conține poziții din textul sursă), `reloptions`, `relisshared`,
    `relispopulated`, tipul tabelului tipizat (`reloftype`, după nume), metoda de acces (`relam`) și tablespace-ul (`reltablespace`), după
    nume + **numărul rândurilor atașate**, calculat din cataloage: triggere, reguli, politici, constrângeri, valori implicite, indecși,
    moștenire (ca copil și ca părinte), statistici extinse, publicații. Prinde o schimbare PE LOC (de ex. `ENABLE ROW LEVEL SECURITY` pe un
    tabel de la initdb, fără obiect nou; contraexemplul rundei 4: o partiție de la initdb a unui tabel al aplicației, detașată și reatașată
    cu altă limită — perechea din `pg_inherits` rămâne aceeași, limita nu) și e plasa de siguranță pentru orice clasă de rând atașat
    scăpată de regula de mai sus (numărul se schimbă);
  - **lista închisă a coloanelor** (runda 5): fiecare coloană a cataloagelor din care se citesc plasele — `pg_class` (plasa relațiilor),
    `pg_proc` + `pg_aggregate` (plasa funcțiilor) — e ORI în plasă, ORI în lista de excluderi de mai jos, cu motivul. Lista stă o singură
    dată în `scripts/amprenta_globala_v2.sql` (marcajul `AG_PLASA_COLOANE v2`, comentarii, nu se rulează); testul PGlite cere ca mulțimea
    coloanelor catalogului real să fie exact reuniunea „în plasă” ∪ „exclusă”, fără rest și fără suprapunere (o coloană nouă într-o
    versiune viitoare a serverului pică testul până e clasificată), iar testul static, ca fiecare coloană „în plasă” să apară în ramura ei
    și nicio coloană exclusă să nu apară acolo ca valoare. **Excluderile, exact:**
    - `pg_class`: `oid` (identificatorul atribuit la initdb; relația e identificată după schema.nume); `relnamespace` (înlocuit de numele
      schemei); `reltype` (identificatorul tipului rând; tipurile de la initdb modificate pe loc = limita din (iii)); `reltoastrelid`
      (identificatorul relației TOAST, în `pg_toast`, limita 15); `relfilenode` (stocare: se schimbă la VACUUM FULL, TRUNCATE, CLUSTER,
      REINDEX); `relpages`, `reltuples`, `relallvisible`, `relallfrozen` (statistici, VACUUM / ANALYZE; ultima există de la PostgreSQL 18);
      `relfrozenxid`, `relminmxid` (întreținere: freeze); `relrewrite` (întreținere: nenul doar pe relația tranzitorie a unei rescrieri în
      curs); steagurile leneșe `relhasindex`, `relhasrules`, `relhastriggers`, `relhassubclass` (le stinge VACUUM — ar da refuz fals,
      L20; numărul indecșilor, regulilor, triggerelor, copiilor e în plasă); `relacl` (ACL-ul: familia `acl_sistem`, cu grantor);
    - `pg_proc`: `oid` (identificatorul; funcția e identificată după schema.nume(tipurile argumentelor)); `pronamespace` (înlocuit de numele
      schemei); `proacl` (ACL-ul: familia `acl_sistem`);
    - `pg_aggregate`: `aggfnoid` (cheia legăturii cu `pg_proc`; funcția e identificată în plasa funcțiilor).
    Câmpuri „doar de planificare” nu sunt excluse: `procost`, `prorows` intră (o schimbare a lor dă refuz conservator, recitire);
  - plus **ACL-urile explicite** (`acl_sistem`): proprietarul + ACL-ul celor trei scheme de sistem (`pg_catalog`, `information_schema`,
    `pg_toast`) și fiecare obiect din ele cu ACL **explicit** (`relacl` / `attacl` / `proacl` / `typacl` nenul), cu grantor; relațiile
    TOAST se etichetează după tabelul-părinte (numele lor conține un OID). Un obiect creat după initdb cu ACL explicit apare și aici
    (redundant); și `server_version_num` (familia `baza`);
- **(iii) ce NU intră, exact** — modificabile doar de superuserul platformei, nu doar cu versiunea serverului: **corpul vederilor de la
  initdb** (regula `_RETURN` a unei vederi de la initdb are OID < 16384; `CREATE OR REPLACE VIEW` o rescrie pe loc); **coloanele relațiilor
  de la initdb** dincolo de numărul lor (nume, tip, NOT NULL, stocare — de ex. o redenumire nu se vede; o valoare implicită nouă se vede);
  **tipurile, operatorii, clasele / familiile de operatori, colațiile, conversiile și configurațiile de căutare text de la initdb modificate
  PE LOC** (de ex. o mapare nouă într-o configurație de căutare de la initdb); **definiția statisticilor extinse** (pe tabelele de la
  initdb doar numărul lor, în plasă; nu sunt familie nici pentru aplicație); **comentariile** (pentru niciun obiect); tot `pg_toast` în
  afara ACL-urilor explicite (limita 15). Din `pg_class` / `pg_proc` / `pg_aggregate` ale obiectelor de la initdb lipsesc DOAR coloanele
  din lista de excluderi de la (ii). Limita 10.

**Detaliul plasei** (`scripts/amprenta_globala_citire.sh --lista --detalii-plasa <fișier nou>`): în ACEEAȘI fotografie, câte un rând pe
obiect de la initdb — `plasa TAB identitate TAB md5(campuri) TAB campuri` — din ACEEAȘI definiție (blocul `AG_PLASA v2` = începutul
blocului catalogului, până la `ag_plasa` inclusiv). Citirea verifică, înainte să scrie fișierul, că detaliul **reproduce** rândurile
`RAND sistem_initdb …`: md5 peste coloana `campuri`, în ordinea identității (`LC_ALL=C`), unite cu LF ⇒ `md5` din `[număr, "md5"]` =
amprenta rândului plasei (altfel cod 1, fișier nescris). Două detalii (clonă / țintă, sau înainte / după) se compară cu
`diff <(cut -f1-3 a.tsv) <(cut -f1-3 b.tsv)`: liniile diferite numesc obiectul, iar coloana `campuri` arată câmpul.

| Familie | Catalog | Câmpuri (pe lângă etichetă) |
|---|---|---|
| schema | pg_namespace | proprietar, ACL |
| relatie | pg_class (+ pg_index, pg_sequence, pg_partitioned_table, pg_foreign_table, pg_am, pg_tablespace, pg_depend la secvențe) | relkind, proprietar, ACL, RLS, FORCE, persistență, metoda de acces, reloptions, partiție (relispartition, relpartbound), replica identity, are TOAST, tablespace, tip tabel tipizat; vederi / vederi materializate: `pg_get_viewdef`; partiționate: cheia + partiția implicită; indecși: `pg_get_indexdef` (chei, opclass, colații, expresii, predicat, INCLUDE, NULLS NOT DISTINCT) + unic, PK, excludere, imediat, cluster, valid, ready, live, replident; secvențe: tip, start, increment, min, max, cache, cycle + **legătura cu coloana** (`pg_depend`: `a` = OWNED BY, `i` = identity — tabelul calificat și coloana); tabele externe: serverul + md5(opțiuni) |
| coloana | pg_attribute, pg_attrdef | poziția (rangul între coloanele vii), tip + typmod, colație, NOT NULL, identity, generată, valoarea implicită / expresia generată, ACL pe coloană, stocare, compresie, moștenire (local, inhcount), md5(opțiuni FDW) |
| constrangere | pg_constraint | TOATE (CHECK, PK, UNIQUE, FK, EXCLUDE, trigger, domeniu; NOT NULL pe PG18): tip, amânabil, amânat, validat, local, inhcount, NO INHERIT, `pg_get_constraintdef`, indexul |
| trigger | pg_trigger | TOATE, inclusiv cele **interne** (FK): intern, `tgenabled`, funcția, tipul, amânabil, amânat inițial, tabelul constrângerii, constrângerea, nr. argumente, `pg_get_triggerdef` (cele interne au în etichetă constrângerea + funcția + tipul, nu numele cu OID) |
| regula | pg_rewrite | tipul, **`ev_enabled`**, INSTEAD, `pg_get_ruledef` (regula `_RETURN` a vederilor = definiția vederii, deja în relatie) |
| politica | pg_policy | comanda, PERMISSIVE / RESTRICTIVE, rolurile (null = PUBLIC), USING, WITH CHECK |
| functie | pg_proc (+ pg_aggregate, pg_language) | kind, limbaj, proprietar, SECURITY DEFINER, volatilitate, STRICT, LEAKPROOF, PARALLEL, SETOF, cost, rows, VARIADIC, funcția suport, argumentele cu moduri, nume și **valori implicite**, rezultatul, `proconfig`, **`probin`**, md5(`prosrc`), md5(corpul BEGIN ATOMIC deparsat), transformările, ACL; agregate: toate funcțiile, operatorul de sortare, tipurile și valorile inițiale |
| tip | pg_type (+ pg_enum, pg_range) | TOATE tipurile din perimetru (de bază, compuse / rândul tabelelor, domenii, enum, range, multirange, tablouri): typtype, categorie, preferat, proprietar, ACL, lungime, byval, aliniere, stocare, delimitator, NOT NULL, tipul de bază + typmod, colație, valoarea implicită, funcțiile input / output / receive / send / typmodin / typmodout / analyze / subscript, elementul, relația; enum: etichetele în ordine; range: subtip, colație, opclass, canonical, subdiff, multirange |
| operator | pg_operator | proprietar, kind, merge, hash, rezultat, funcțiile code / rest / join, comutator, negator |
| familie_operatori, clasa_operatori, amop, amproc, metoda_acces | pg_opfamily, pg_opclass, pg_amop, pg_amproc, pg_am | proprietar; clasa: familia, tipul, implicită, tipul cheii; amop: scop, operator, familia de sortare, metoda; amproc: funcția; membrii = rânduri atașate familiei (regula `ag_par`: și cei adăugați după initdb la familiile de la initdb); pg_am: tip, handler (toate) |
| cast | pg_cast | TOATE: funcția, contextul, metoda |
| limbaj, transformare | pg_language, pg_transform | proprietar, PL, trusted, handler, inline, validator, ACL; transformările: funcțiile from / to |
| conversie, colatie | pg_conversion, pg_collation | proprietar, codificări, funcția, implicită; provider, determinist, collate, ctype, locale, ICU rules |
| ts_parser, ts_sablon, ts_dictionar, ts_config | pg_ts_parser, pg_ts_template, pg_ts_dict, pg_ts_config, pg_ts_config_map | funcțiile, șablonul, opțiunile, parserul, mapările |
| extensie | pg_extension | proprietar, schema, relocatable, versiunea, extconfig, extcondition |
| trigger_eveniment | pg_event_trigger | evenimentul, proprietar, funcția, starea, tag-urile |
| mostenire | pg_inherits | ordinea, detach pending; perechea intră dacă ORICARE capăt e în perimetru |
| acl_implicit | pg_default_acl | ACL-ul pe (rol, schemă, tip de obiect) |
| baza, parametru_acl, tablespace | pg_database (doar cea curentă), pg_parameter_acl, pg_tablespace | **`server_version_num`**, proprietar, codificare, locale / provider, template, allowconn, connlimit, ACL; ACL pe parametri; tablespace: proprietar, ACL, opțiuni |
| rol, membru, setare_rol | pg_roles, pg_auth_members, pg_db_role_setting | toate atributele (super, inherit, createrole, createdb, login, replication, bypassrls, connlimit, valid until) + rolconfig (valorile ca md5); membru: admin / inherit / set + grantor; setările pe rol / bază (valorile ca md5) |
| fdw, server_extern, mapare_utilizator | pg_foreign_data_wrapper, pg_foreign_server, pg_user_mappings | handler, validator, proprietar, ACL, tip, versiune; **opțiunile doar ca md5** (pot conține secrete) |
| publicatie, publicatie_tabel, publicatie_schema | pg_publication, pg_publication_rel, pg_publication_namespace | proprietar, all tables, operațiile, via root; filtrul de rânduri și coloanele; schemele |
| obiect_mare | pg_largeobject_metadata | **câte un rând pe obiect**, etichetat cu identificatorul lui (`loid` — numele public al obiectului mare; singura excepție declarată de la „fără OID-uri”): proprietar, ACL |
| eticheta_securitate | pg_seclabels | furnizorul, obiectul, eticheta |
| sistem_initdb | pg_proc + pg_aggregate, pg_class (+ numărul rândurilor atașate) — obiectele de la initdb din `pg_catalog` / `information_schema` (`oid < 16384`, complementul perimetrului) | DOUĂ rânduri (`functii`, `relatii`), fiecare `[număr, md5 peste câmpurile fiecărui obiect, în ordinea identității]`, calculate din CTE-ul `ag_plasa` (detaliul: `--detalii-plasa`); câmpurile: secțiunea 2, (ii) |
| acl_sistem | pg_namespace, pg_class, pg_attribute, pg_proc, pg_type — `pg_catalog`, `information_schema`, `pg_toast` | schemele: proprietar + ACL; obiectele cu ACL explicit: ACL-ul (cu grantor), la relații și funcții și proprietarul; TOAST după tabelul-părinte |
| sesiune | profilul sesiunii de livrare | `DateStyle`, `TimeZone`, `row_security`, `search_path`, `session_replication_role` (citite o dată, „înainte”) |

Obiectele create după initdb în `pg_catalog` / `information_schema` și rândurile atașate după initdb unui părinte de la initdb nu au
familie proprie: intră în familiile de mai sus (`functie`, `relatie`, `coloana`, `constrangere`, `trigger`, `regula`, `politica`,
`mostenire`, `tip`, `operator`, `familie_operatori`, `clasa_operatori`, `amop`, `amproc`, `colatie`, `conversie`, `ts_*`), cu aceleași
câmpuri. Familiile atașate (`constrangere`, `trigger`, `regula`, `politica`, valoarea implicită din `coloana`, `amop`, `amproc`) își iau
părintele prin `ag_par` (regula rândurilor atașate).

**NU intră:** statistici (`reltuples`, `relpages`, pg_statistic, contoare de vacuum / freeze), `relfilenode`, valoarea curentă a secvențelor,
datele din tabele, `attstattarget` / `attoptions` / `attmissingval`, `collversion`, statisticile extinse (ca familie; pe tabelele de la
initdb doar numărul lor, în plasă), `relhas*` (derivate, actualizate leneș), OID-urile (în afară de identificatorul obiectelor mari) și
numerele de coloană. Din `pg_depend` intră DOAR legătura secvențelor cu
coloanele; celelalte fapte care stau numai acolo (apartenența obiectelor la extensii, obiectele „pin”) nu sunt acoperite.

**Canonicalizare (condiția 2):** blocul se evaluează DOAR în contextul canonic — `search_path = pg_catalog, pg_temp`, `TimeZone = UTC`,
`DateStyle = ISO, YMD`, `IntervalStyle = postgres`, `extra_float_digits = 1`, `bytea_output = hex`, `quote_all_identifiers = off`,
`standard_conforming_strings = on`, `lc_monetary = C`; garda `ag_garda` refuză altfel (`AG_V2_CONTEXT_NECANONIC`). Runnerul le pune ca
`SET` pe funcția temporară (la ieșire revin singure: artefactul nu vede nicio schimbare de sesiune); citirea le pune `SET LOCAL`.
Cu `search_path` fixat, obiectele din `pg_catalog` apar **necalificate**, toate celelalte **calificate cu schema** (`reg*::text`,
`format_type`, `pg_get_*def`), iar constantele deparsate (date, intervale, numere, bani) nu depind de sesiunea apelantului.
Serializarea e JSON (nicio ambiguitate de separator, `null` ≠ `""`), listele ordonate `COLLATE "C"`, etichetele sunt unice (validat la
fiecare calcul: `AMPRENTA_GLOBALA_DUBLURA` = refuz).

**Versionare — regula:** orice schimbare a listei de familii, a câmpurilor sau a perimetrului făcută **DUPĂ ce o formă a intrat pe main** =
**altă versiune** (alt fișier, alt marcaj, alt cod de gardă), cu motiv: de atunci pot exista valori aprobate (manifeste, GLOBAL-uri din
jurnale) calculate cu ea, iar o formă schimbată sub același nume le-ar face incomparabile în tăcere. Rundele de review ale unui PR **nu**
sunt versiuni: formele lor n-au fost folosite niciodată la o livrare (nicio valoare aprobată nu există cu ele). Pentru acest PR: **v1** =
prima ciornă, respinsă la review, nefolosită; forma care intră pe main este **v2** — cea de după ultima rundă de review a acestui PR, iar
valorile calculate cu ciornele rundelor anterioare (de ex. probele coordonatorului pe clonă cu forma rundei 3) nu se folosesc ca baseline
(se recitesc). Schimbările față de v1:
- runda 2: grantorul în toate ACL-urile; dependențele OWNED BY / identity ale secvențelor; schemele de sistem (atunci: familia sumară
  `sistem_adaugat` + `acl_sistem`); `server_version_num` în `baza`; obiectele mari câte un rând;
- runda 3: perimetrul definit o dată (`ag_per` + CTE-urile de perimetru) și obiectele create după initdb în schemele de sistem prin
  familiile obișnuite (`sistem_adaugat` desființată); familia nouă `sistem_initdb` (plasa pe funcțiile de la initdb); `eticheta_securitate`
  urmează același perimetru. Lista: 45 de familii (`sistem_adaugat` ieșită, `sistem_initdb` intrată);
- runda 4: regula rândurilor atașate, definită o dată (`ag_par`), folosită de `constrangere`, `trigger`, `regula`, `politica`, `coloana`
  (valoarea implicită), `amop`, `amproc` (care înainte aveau propria condiție pe 16384); moștenirea pe pereche (oricare capăt);
  `sistem_initdb` are două rânduri (`functii` — reprezentare independentă de build, plus agregatele — și `relatii` — nou), calculate din
  CTE-ul `ag_plasa`, iar blocul `AG_PLASA v2` (începutul blocului catalogului) dă detaliul plasei în citire (`--detalii-plasa`). Lista de
  familii nu se schimbă (45). În citire: momentul fotografiei se înlocuiește doar în antetul standard (secțiunea 6);
- runda 5: plasa relațiilor primește limita partiției în forma canonică (`pg_get_expr(relpartbound, oid)`) și coloanele stabile care
  lipseau (`relisshared`, `relispopulated`, `reloftype`, `relam`, `reltablespace` — ultimele trei după nume); plasa funcțiilor primește
  `procost`, `prorows`, `pronargs`, `protrftypes`; lista închisă a coloanelor `pg_class` / `pg_proc` / `pg_aggregate` (în plasă sau
  excluse cu motiv, marcajul `AG_PLASA_COLOANE v2`, secțiunea 2 (ii)). Lista de familii nu se schimbă (45). În citire și în comparator:
  antetul standard se identifică o singură dată (prima apariție, secțiunea 6).
O excepție (de ex. o schemă de platformă care se schimbă singură) se face DOAR așa, explicit, ca reducere declarată a garanției.

**Optimizarea calculului (17.11.2026) NU e o versiune nouă.** Regula de mai sus privește CE se calculează (lista de familii, câmpurile,
perimetrul, serializarea); optimizarea schimbă doar CUM se calculează, cu aceleași rânduri și aceleași valori, octet cu octet (deci și
același GLOBAL): manifestele și GLOBAL-urile aprobate cu forma de dinainte rămân valabile, marcajul rămâne `AG_CATALOG v2`. Ce s-a
schimbat în bloc: (1) ACL-ul relațiilor, funcțiilor, tipurilor și al relațiilor de sistem cu ACL explicit se serializează **o dată pe
valoare distinctă** (`ag_acl`; intrarea ACL a fiecărui obiect e definită o dată, în `ag_acl_rel` / `ag_acl_fn` / `ag_acl_typ` /
`ag_acl_sis`, iar cheia e valoarea `aclitem[]` însăși, cu egalitatea exactă a tipului — beneficiar, grantor, drepturi —, nu textul ei);
(2) subinterogările pe tablourile de obicei nule (`attacl`, `attfdwoptions`, `reloptions`, `protrftypes`) rulează doar pe tabloul nenul
(pe null dădeau oricum null); (3) etichetele enum se agregă o dată pe tip (`ag_enum`), nu cu o parcurgere a lui `pg_enum` pe fiecare tip;
(4) detaliul (`d::text`) se serializează o dată pe rând. În runner, validările (rânduri valide, etichete unice) rămân textul de
dinainte: o trecere comună (etichete duble + GLOBAL dintr-o sortare) a fost încercată și retrasă la review (r1–r2), pentru că la limite
de resurse (memorie mică, limită de fișiere temporare) sortarea putea eșua înaintea refuzului rândului invalid sau al dublurii, cu alt
mesaj; md5-ul pe familii (doar diagnostic,
în mesaj) se calculează doar unde se tipărește. Dovada: `scripts/pglite/test_amprenta_paritate_calcul.mjs` (secțiunea 11) compară
forma nouă cu cea de dinainte, fixată pe commit (`a69ef186`, sha256 verificat), rând cu rând, în aceeași fotografie; aceleași cazuri
rulează pe clonă (proba coordonatorului). Dacă vreodată o optimizare ar schimba un singur detaliu, nu mai e optimizare: e v3.

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
8. **Fotografia citirii:** `REPEATABLE READ` dă o fotografie interogărilor explicite, nu tuturor citirilor interne de catalog (deparsarea
   `pg_get_*def`, cache-urile de catalog). Citirea (și generarea manifestului) se face **fără DDL concurent** — cerință de procedură. Un
   amestec de stări ar da cel mai probabil o valoare care nu se potrivește la livrare (refuz, recitire), dar asta nu e demonstrat.
9. **Opțiunile maparilor de utilizator** sunt vizibile doar proprietarului serverului (altfel `null`); parolele rolurilor nu intră;
   `pg_subscription` nu e citibil de `postgres` pe Supabase; etichetele de securitate cer un furnizor.
10. **Schemele de sistem, obiectele de la initdb:** se văd funcțiile + agregatele și relațiile lor, ca plasă (`sistem_initdb`, câmpurile
    din secțiunea 2, (ii)), ACL-ul lor explicit (`acl_sistem`), proprietarul celor trei scheme și `server_version_num`. NU se văd
    (secțiunea 2, (iii)): corpul vederilor de la initdb, coloanele relațiilor de la initdb dincolo de numărul lor, tipurile / operatorii /
    clasele / familiile de operatori / colațiile / conversiile / configurațiile de căutare text de la initdb modificate PE LOC,
    comentariile — un astfel de `ALTER`, făcut de superuserul platformei, nu se vede (proba PGlite o arată pe redenumirea unei coloane din
    `information_schema`). Cast-urile, metodele de acces, limbajele intră integral. Tot ce are OID propriu ≥ 16384 în aceste scheme
    (obiect creat după initdb SAU rând atașat după initdb unui părinte de la initdb) intră integral, prin familiile obișnuite (secțiunea 2,
    (i)); excepție: statisticile extinse (nu sunt familie).
11. **Coordonarea:** lock-ul consultativ al runnerului serializează DOAR livrările care trec prin el. Dashboard-ul Supabase, un `psql` direct
    sau platforma nu-l respectă: o schimbare a lor în timpul livrării apare ca diferență nedeclarată ⇒ refuz (nimic comis) — **în afara**
    ferestrei finale (pct. 5) și a schimbării urmate de revenire (pct. 6), care nu se văd.
12. **Platforma se schimbă singură** (partițiile ei zilnice) ⇒ GLOBAL se schimbă o dată pe zi fără nicio
    schimbare a porților. Consecința acceptată: refuz la „înainte” și recitirea în ziua livrării (secțiunea 7). GLOBAL **nu** se pune în
    repo ca valoare de durată.
13. **Refuzul nu anulează tot:** la refuz nu se comite nimic (DDL + înregistrarea în istoric, ROLLBACK), dar **valorile de secvență consumate
    și efectele externe** (ex. o notificare trimisă de cod rulat în tranzacție) nu se anulează la ROLLBACK. La fel la proba cu ROLLBACK.
14. **Tabelul temporar al pasului „înainte”** nu e o frontieră de privilegii față de artefact (rulează ca același rol). Tag-ul aleator
    evită coliziunile, iar md5-ul (GLOBAL-ul fotografiei, reverificat la „după”) prinde modificarea obișnuită a setului; un artefact
    ostil care l-ar căuta prin cataloage e în afara modelului (artefactul trece prin review).
15. **TOAST nu se verifică obiect cu obiect:** în rândul tabelului intră doar „are TOAST”, iar din `pg_toast` doar ACL-urile explicite
    (`acl_sistem`) — reducere declarată a perimetrului. **`reloptions` intră integral**, inclusiv setările de autovacuum: o astfel de
    schimbare, fără legătură cu drepturile, dă refuz conservator (recitire).

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
* **Fără opțiunile noi: comportament identic** (biblioteca nici nu se încarcă; liniile psql de dinainte, neschimbate) — dovedit octet cu
  octet față de main de `scripts/test_livrare_l15_paritate.sh`.

## 5. Manifestul diferențelor (`<NUME>.l15.tsv`, lângă migrare, revizuit în PR-ul ei) și comparabilitatea clonă ↔ țintă

O linie pe obiect, separate prin TAB: `familie  eticheta  operatie  amprenta` — `operatie` ∈ `creat` / `schimbat` / `sters`, `amprenta` =
md5-ul final (32 hex) sau `-` la `sters`. Liniile `#` și cele goale se ignoră. Fără wildcard-uri, fără „permis oricum”.
(Supabase CLI ignoră fișierele care nu sunt `*.sql` în `supabase/migrations/`; `.gitattributes` le fixează pe LF.)

**Generarea, DOAR pe clonă** (`scripts/livrare_l15_manifest.sh --iesire`): aplică migrarea exact în forma livrării (fișierele runnerului,
cu plafon — forma „un mesaj” cu garda finală), pașii în modul TIPĂRIRE, apoi **ROLLBACK** (nimic comis; alias `manifest_l15_nu_e_livrare`,
deci nu poate fi confundat cu o livrare). Verifică completitudinea (liniile = numărul anunțat de server). Antetul manifestului: versiunea
amprentei (v2), `server_version_num`, rolul, GLOBAL-ul clonei înainte / după.
`--detalii <fișier>.l15.detalii.txt`: pe lângă manifest, **detaliul canonic complet** al fiecărui rând (JSON-ul al cărui md5 e amprenta; la
`sters` cel de dinainte) — material pentru recenzent, **nu se versionează** (`.gitignore`; scriptul refuză un fișier de detalii în
`supabase/migrations/`). **Generarea hash-urilor nu e review:** recenzentul PR-ului de baseline verifică pe detalii obiectele, operațiile și
starea lor finală.
**Obiectele implicite apar toate** — proba PGlite o arată pe o migrare cu un tabel nou: tipul rând + tipul tablou, secvența identity (cu
legătura ei la coloană), indexul PK, constrângerile (PK, FK; pe PG18 și NOT NULL), cele 2 triggere interne ale FK pe tabelul nou și cele 2
de pe tabelul REFERIT (`creat`), politica, funcția; TOAST-ul stă în `pg_toast` (doar `are TOAST` în rândul tabelului, vezi limita 15).

**Comparabilitatea nu se presupune, se verifică.** Aceeași migrare poate da amprente finale diferite pe clonă și pe țintă dacă diferă
contextul: rolul care aplică, proprietarii, ACL-urile implicite, rolurile existente, rezolvarea numelor și tipurilor, colațiile,
extensiile, versiunea serverului (și cea minoră: deparsarea). Pentru obiectele **noi** comparația listelor dinainte nu poate spune nimic
(obiectele nu există încă) — de aceea există proba pe țintă.
1. Citirea (`scripts/amprenta_globala_citire.sh --lista`) tipărește și rândurile `CONTEXT` (în aceeași fotografie): `server_version_num`,
   `current_user`, `session_user`.
2. `scripts/l15_compara_liste.sh --a <citire clonă> --b <citire țintă> --manifest <NUME>.l15.tsv` ⇒ **`COMPARABIL`** (cod 0) doar dacă:
   rândurile `CONTEXT` sunt egale; familia `sesiune` e egală; privilegiile implicite ale **rolului de livrare** (rândurile
   `acl_implicit <current_user> …`) sunt egale; fiecare rând `schimbat` /
   `sters` din manifest există în ambele liste cu ACEEAȘI amprentă; fiecare rând `creat` lipsește din ambele. Altfel `NECOMPARABIL`
   (cod 6) cu lista. Diferențele din `extensie`, `colatie`, `limbaj`, `rol`, `membru`, `schema`, `sistem_initdb` (cu plasa independentă
   de build, rândurile `sistem_initdb` sunt de așteptat IDENTICE între clonă și țintă pe aceeași versiune de server; o diferență rămâne
   totuși `DE_EXPLICAT` și se explică NOMINAL, cu detaliul plasei: obiectul și câmpul, nu „alt build”) și privilegiile implicite ale ALTOR
   creatori (rolurile platformei, în schemele lor — o clonă fără schemele platformei nu le are) se tipăresc ca `DE_EXPLICAT` (nu schimbă
   codul; coordonatorul le explică în PR-ul de baseline). Dacă numele rolului de livrare nu e un identificator simplu, regula e cea
   strictă: orice rând `acl_implicit` diferit = `NECOMPARABIL`. Fără opțiuni scriptul doar listează diferențele (doar în A / doar în B /
   altă amprentă, pe familii; 0 / 7).
   **Cât acoperă regula privilegiilor implicite:** DOAR migrările care creează obiectele **direct**, ca rolul livrării (validatorul
   artefactului refuză `SET ROLE` la nivel superior, deci instrucțiunile de nivel superior rulează ca acel rol). Privilegiile implicite
   aplicate sunt ale rolului curent **la crearea obiectului**: un obiect creat de o funcție SECURITY DEFINER apelată de migrare are alt
   creator (proprietarul funcției) și alte privilegii implicite — pentru acest caz `COMPARABIL` **nu** spune nimic (de ex. ACL-urile
   implicite ale proprietarului diferă între clonă și țintă, comparatorul spune `COMPARABIL`, dar obiectul creat diferă). Cazul îl prind
   proba cu ROLLBACK pe țintă (`--compara-cu`, pasul 3, obligatorie) și verificarea „după” a runnerului (refuz, nimic comis).
3. **Proba cu ROLLBACK pe țintă** (`scripts/livrare_l15_manifest.sh --compara-cu <NUME>.l15.tsv [--amprenta-globala <md5>]`, în loc de
   `--iesire`): aceeași formă a livrării, nimic scris, diferența obținută pe țintă comparată cu manifestul ⇒ `IDENTIC` (0) sau lista
   `DOAR_AICI` / `DOAR_IN_MANIFEST` / `ALTA_AMPRENTA` (6), plus timpii; cu `--amprenta-globala` verifică și GLOBAL-ul dinainte. Se poate
   rula pe orice țintă, inclusiv producția, **cu acordul owner-ului** (ia aceleași lock-uri ca migrarea, apoi ROLLBACK; limita 13).

**Fail-closed:** dacă totuși diferă la livrare, runnerul refuză (`ALTFEL` / `NEDECLARAT`), nimic comis (DDL + istoric; limita 13).

## 6. Citirea coordonatorului (doar citire, pe producție) și regula DEFINER

`scripts/amprenta_globala_citire.sh` — O tranzacție `REPEATABLE READ READ ONLY`:
1. profilul sesiunii + ținta (db, system_identifier, `in_recovery = false`);
2. `--amprente-migrare scripts/<x>_amprente.sql`: **scriptul existent al migrării, nerescris** — rulează o copie din care se scot exact
   linia `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;` și linia `ROLLBACK;` (fiecare trebuie să apară exact o dată — toate
   scripturile `*_amprente.sql` existente au forma asta) ⇒ rulează în fotografia comună; ieșirea lui (format nealiniat, separator
   ` | `) e delimitată de liniile `=== scriptul de amprente al migrarii …` / `=== sfarsit scriptul de amprente al migrarii ===`.
   **Momentul fotografiei** (`now()` al tranzacției unice, în forma text a sesiunii) se tipărește O DATĂ, pe rândul `MOMENT` (în afara
   părții revizuite). În secțiunea scriptului migrării se înlocuiește cu marcajul fix `<momentul fotografiei>` **DOAR câmpul identificat
   al antetului standard**: rândul de date de imediat după linia exactă `baza | sistem | versiune | la` (formatul nealiniat al citirii),
   ultimul câmp, și numai dacă e EXACT momentul. **Antetul se identifică o singură dată** (runda 5): contează DOAR prima apariție a liniei
   exacte de antet din secțiunea migrării; o apariție ulterioară (un script care tipărește în date o linie identică cu antetul) e dată
   obișnuită — ea și rândul de după ea rămân cum sunt și se compară. Orice altă apariție a momentului rămâne și ea: în afara acelui câmp
   unic, o valoare reală egală întâmplător cu momentul nu devine marcaj, deci două valori reale diferite nu pot da secțiuni normalizate
   identice prin această înlocuire (testat: coliziunea în date și antetul repetat în date ⇒ `--recitire` 6). Antet absent sau în alt
   format ⇒ nimic nu se normalizează, iar `--recitire` arată diferența (partea sigură). Comparatorul folosește aceeași regulă (prima
   apariție) și refuză intrarea (cod 2) doar dacă momentul a rămas neînlocuit în acel câmp. **Forma de antet cerută scripturilor de
   amprente ale migrărilor viitoare**: antetul de sesiune se tipărește ÎNAINTEA oricărei alte ieșiri de date — prima interogare după `SET
   LOCAL search_path`, exact `SELECT current_database() AS baza, (SELECT system_identifier FROM pg_control_system()) AS sistem, version()
   AS versiune, now() AS la;` (un script care ar tipări altceva înainte cu aceleași nume de coloane și-ar normaliza alt rând; testul static
   verifică ordinea în cele existente). Scripturile existente au toate această formă (testul static verifică la fiecare că antetul
   e prima lui ieșire; scriptul unei migrări noi intră singur în verificare), **în afară de două**:
   `scripts/ofertare_inchidere_garda_amprente.sql` și `scripts/intrebari_cercetare_amprente.sql` tipăresc
   `to_char(statement_timestamp(), …)`, pe care mecanismul NU îl normalizează (sunt ale unor migrări deja livrate; o recitire cu ele arată
   momentul ca diferență, de explicat în jurnal). Formatul nealiniat e necesar: în cel aliniat lățimea coloanei depinde de lungimea
   momentului (zerourile finale ale fracțiunii de secundă nu se tipăresc), deci și antetul / separatorul s-ar schimba;
3. `GLOBAL` + rânduri + md5 pe familii + validarea (`--lista`: toate rândurile); rândurile `CONTEXT`; cu `--detalii-plasa <fișier nou>`
   (cere `--lista`) și detaliul plasei `sistem_initdb`, verificat față de rândurile `RAND` (secțiunea 2);
4. `--radacina 'schema.functie(argumente)' …`: lanțul porților (cel mai bun efort: lexical + `pg_depend`, prin vederi), rândurile `LANT`,
   `INCREDERE` și **SEMNALE** (`EXECUTE dinamic`, vederi citite, alt limbaj, DEFINER nesigure, DEFINER acceptate explicit);
5. verificarea că toate au rulat în aceeași tranzacție; ROLLBACK.

**Regula DEFINER.** „Are `search_path` propriu” **nu ajunge**: o cale fără `pg_temp` la final caută ÎNTÂI în schema temporară a
apelantului (pentru relații și tipuri), iar dreptul TEMP e acordat implicit lui PUBLIC — un tabel temporar cu același nume păcălește o
referință necalificată; la fel o schemă din cale în care altcineva are CREATE. Pentru fiecare funcție SECURITY DEFINER din lanț, citirea
clasifică valoarea PROPRIE a căii (din `proconfig`) ca `sigura` sau `nesigura: <motiv>`. E **`sigura`** DOAR dacă:
1. are `search_path` propriu;
2. fiecare element e analizabil fără dubiu (identificator simplu sau între ghilimele, fără virgule / ghilimele în nume) — altfel
   `nesigura: element neanalizabil` (fail-closed, L18);
3. nu conține `"$user"`;
4. `pg_temp` e prezent explicit, o singură dată, și e **ULTIMUL** element (deci `search_path=""` e `nesigura` pentru verificarea automată);
5. fiecare altă schemă din cale **există** și niciun rol în afara celor de încredere nu are CREATE pe ea (`has_schema_privilege` pe TOATE
   rolurile din `pg_roles`, deci cu apartenențe și PUBLIC). De încredere, implicit: superuserii, proprietarul schemei, rolul care face
   citirea; în plus doar rolurile date explicit cu `--rol-de-incredere <rol>` (repetabilă). Fiecare rol de încredere cu CREATE apare în
   ieșire ca `INCREDERE <schema> <rol> <super | proprietar | rolul citirii | optiune>`, ca să fie revizuit.

`nesigura` = **REFUZ** (cod 4), cu motivul pe rândul `LANT`. Singura ieșire: acceptarea explicită, legată de corpul exact —
`--definer-verificat '<functie(argumente)>=<md5>'` (repetabilă), unde md5 = `md5(jsonb [prosrc, proconfig])`, tipărit pe rândul `LANT` al
fiecărei funcții DEFINER. Înseamnă „un om a verificat că toate referințele din ACEST corp sunt calificate cu schema” și se consemnează în
PR-ul de baseline. Corp sau cale schimbate ⇒ md5 diferit ⇒ iar refuz. O acceptare pentru o funcție inexistentă, care nu e în lanț, nu e
DEFINER, e deja `sigura` sau are alt md5 = refuz (acceptările vechi nu rămân agățate).

Celelalte **semnale** (EXECUTE dinamic, vederi, alt limbaj) nu sunt refuz automat (verificarea lexicală `FOLOSITE` din #1084 respingea fals
`jsonb_build_object`): se examinează și se **acceptă explicit în PR-ul de baseline**, cu o linie:
`SEMNALE acceptate: EXECUTE dinamic N (funcțiile, motiv) · vederi N (care, ce cheamă) · alt limbaj N (care) · DEFINER acceptate N (care, md5)`.

## 7. Pașii coordonatorului

1. Migrarea anterioară e aplicată (baseline-ul unei migrări se citește **după** aplicarea celei dinainte: GLOBAL-ul include tot).
2. **Citirea pe producție**, fără DDL concurent: `amprenta_globala_citire.sh … --lista [--amprente-migrare …] --radacina … > citire_prod.txt`.
3. **Manifestul pe clonă** (clona adusă la starea producției): `livrare_l15_manifest.sh … --iesire supabase/migrations/<NUME>.l15.tsv
   --detalii <în afara repo-ului>/<NUME>.l15.detalii.txt`; apoi citirea clonei cu `--lista` (aceleași rădăcini) `> citire_clona.txt`.
4. `l15_compara_liste.sh --a citire_clona.txt --b citire_prod.txt --manifest supabase/migrations/<NUME>.l15.tsv` ⇒ **`COMPARABIL`**.
5. **PR de baseline** pentru review (câte unul pe migrare), cu:
   - manifestul (fișierul) + sha256-ul lui și al migrării;
   - detaliile revizuite (`--detalii`; date recenzentului, neversionate);
   - fotografia de după migrarea precedentă (citirea de la pasul 2, cu GLOBAL-ul ei și commitul uneltelor);
   - lanțul: rândurile `LANT`, linia `SEMNALE`, rândurile `INCREDERE`, acceptările DEFINER (cu md5) și acceptarea motivată a fiecărui
     semnal (secțiunea 6);
   - explicația **nominală** a fiecărei linii `DE_EXPLICAT`: privilegiile implicite ale altor creatori (care rol, ce schemă) și faptul că
     migrarea nu creează nimic sub ei (creare directă, fără SECURITY DEFINER care creează); fiecare diferență de extensii (care, ce
     versiune); fiecare diferență de scheme; fiecare rând `sistem_initdb` care diferă — **nominal**: citirile clonei și a țintei cu
     `--detalii-plasa`, apoi `diff <(cut -f1-3 clona.tsv) <(cut -f1-3 tinta.tsv)` dă obiectele, iar coloana `campuri` câmpul (un hash
     diferit singur nu dovedește cauza); ce lipsește din clonă (de ex. stub-uri, tabele ale platformei, politici absente);
   - diferențele rămase între liste, **grupate** (pe familii / scheme), fiecare grup cu motivul pentru care nu atinge traseul migrării;
   - proba integrală proprie pe clonă (cu concurență pe tabelele pe care migrarea le blochează) și criteriile de timp / concurență pentru
     proba pe țintă (pasul 7). Runda 17: concurența la aplicare are scriptul ei, `supabase/tests/l15_aplicare_concurenta.sh` (inventarul
     triggerelor / constrângerilor / politicilor + L0 / L1 / L2 / B1 / B2, secțiunea 9), iar regresiile locale o singură comandă,
     `bash scripts/test_livrare_l15_local_toate.sh` (ieșirea întreagă se păstrează în jurnal).
6. **În ziua livrării:** recitirea pe producție (aceleași opțiuni) + `l15_compara_liste.sh --a citire_prod.txt --b citire_ziua.txt
   --recitire` ⇒ partea revizuită (ieșirea scriptului de amprente al migrării — cu momentul fotografiei înlocuit —, `LANT`, `SEMNALE`,
   `INCREDERE`, `CONTEXT`) trebuie să fie **identică**. Coordonatorul consemnează în **jurnalul livrării**: fișierele celor două fotografii
   și sha256-urile lor, commitul uneltelor, rezultatul comparatorului (codul + ieșirea), **FIECARE** diferență rămasă (`RAND`) și de ce e o
   partiție zilnică a platformei. Orice altă diferență = review nou (PR de baseline nou). Codul 0 al comparatorului spune doar că partea
   revizuită e identică: **clasificarea diferențelor rămase o face omul**, nu comparatorul.
7. **Proba cu ROLLBACK pe țintă, obligatorie** înaintea primei aplicări a fiecărei migrări: `livrare_l15_manifest.sh … --compara-cu
   supabase/migrations/<NUME>.l15.tsv --amprenta-globala <GLOBAL din citire_ziua.txt>`, cu acordul owner-ului, **prin același punct de
   acces (pooler / endpoint) și cu același rol ca livrarea**. Criterii de acceptare (propuse de recenzent; criterii de lucru, nu garanții
   statistice):
   - `IDENTIC`, fără efecte persistente (nimic comis; limita 13);
   - garda finală (`PLAFON_TIMP`) cu **rezervă de cel puțin ~25 %** din plafon, adică **cel mult ~3.750 ms** din 5.000 (runda 16; înainte:
     1.500 din 2.000); dacă toate probele stau mult sub (de ex. ≤ 2.500 ms), plafonul se poate coborî printr-un PR (secțiunea 9);
   - pasul „înainte” măsurat separat (`AMPRENTA_GLOBALA inainte: … calcul N ms`): NU mai consumă bugetul de lock (ceasul lock-ului pornește
     la prima încercare, secțiunea 9 „Bugetul de lock”); lock-ul obținut în ≤ 1 s de la prima încercare (`… ms de la prima incercare`);
   - durata lock-urilor puternice (`LOCK_TINUT` + observatorul din altă sesiune, secțiunea 9 „Riscul”) consemnată și acceptată explicit
     în jurnal, mai ales la ACCESS EXCLUSIVE pe tabele folosite de aplicație;
   - variația pe câteva probe aprobate, **inclusiv prima rulare** (cache rece); o singură probă bună nu ajunge.
8. **Aplicarea:** runnerul cu `--amprenta-globala <GLOBAL din citire_ziua.txt>` + `--diferente-globale` (+ `--aprobare` cu ambele sha-uri).
9. Refuz la **„înainte”** (`AMPRENTA_GLOBALA_INAINTE`): catalogul s-a schimbat după recitire — compară md5-urile pe familii din mesaj cu
   `citire_ziua.txt`, recitește (pasul 6) și, dacă partea revizuită diferă, refă PR-ul de baseline. Refuz la **„după”**: lista spune exact
   ce diferă (`NEDECLARAT` / `ABSENT` / `ALTFEL`); analiză înainte de orice reîncercare.

GLOBAL **nu** se pune în repo ca valoare de durată: se schimbă zilnic din cauza platformei (limita 12). În repo stau manifestul și
acceptările; GLOBAL-ul folosit la aplicare e cel al recitirii din ziua livrării, consemnat în jurnalul ei.

## 8. Cum se scriu migrările de acum

* **Refuzul vine din runner**, nu din migrare: migrarea nu mai trebuie să-și calculeze singură o închidere „completă”.
* Lanțul (închiderea, detaliul funcțiilor) rămâne ca **VIZIBILITATE** pentru review (scriptul `*_amprente.sql` + SEMNALELE citirii).
* Rămâne **refuz**: o funcție SECURITY DEFINER din lanț cu cale **nesigură** (regula din secțiunea 6; în citire cod 4), în afară de
  acceptarea explicită legată de md5. Forma recomandată la funcțiile noi: `SET search_path = public, pg_temp` (sau schemele necesare, toate
  fără CREATE pentru alții, cu `pg_temp` ultima) și referințe calificate cu schema. Migrările care au deja garda o păstrează.
* Postcondițiile migrării (drepturi, RLS, corpuri) rămân: manifestul spune CE se schimbă, postcondițiile spun că e CORECT.

## 9. Plafonul tranzacției (timpul)

Cele două calcule sunt în timpul numărat (după BEGIN). Măsurat pe PGlite (PostgreSQL 18 compilat WASM, un singur fir, în memorie) cu un
catalog sintetic de **~1.500 funcții, ~300 tabele, ~50 vederi** (~7.400 rânduri în set): v2 **~200 ms pe calcul** (v1: ~175 ms). Pe aceeași
mașină, alternând v1 / v2 pe același catalog, v2 costă **~15–19% în plus**: cam jumătate grantorul (cerut, P1), cam jumătate cele două
familii noi. Pe o clonă de mărime reală coordonatorul a măsurat, cu v1, **~0,5 s pe calcul la ~26.000 de rânduri**, iar cu forma
rundei 2 ~510–550 ms pe calcul (garda finală a livrării `20261221a` la ~1.080 ms din 2.000); cifra reală o dă proba cu ROLLBACK pe țintă
(secțiunea 7, pasul 7) și `scripts/test_livrare_l15_v2.sh` (cazul f).
**Runda 3, pe PGlite, același catalog sintetic, 12 rulări alternate (mediane):** runda 2 ~152–156 ms; runda 3 fără plasă ~150–152 ms
(perimetrul nou nu crește timpul); plasa `sistem_initdb` singură ~10 ms (~3.400 de funcții de la initdb; cost **fix**, nu crește cu
aplicația); runda 3 completă ~160–163 ms, adică **+5–7% pe catalogul sintetic**. Pe producție (calcul de ~3,5 ori mai mare) costul fix
estimat e **≤ ~2%** din calcul, dacă PostgreSQL nativ nu e mai lent decât PGlite (de obicei e mai rapid) — de confirmat la proba pe țintă.
**Runda 4, pe PGlite, același catalog sintetic, 24 de rulări alternate (mediane):** runda 3 ~160 ms; runda 4 ~175 ms (**+9%**), din care:
regula rândurilor atașate (`ag_par`, crește cu aplicația) ~+3–5 ms (~2–3%, în trei serii de măsurători); plasa funcțiilor în forma
independentă de build, cu agregatele, ~12,4 ms față de ~9,5 ms (cost fix); plasa relațiilor ~5,5–7,7 ms (cost fix, ~340 de relații de la
initdb; numărarea rândurilor atașate prin căutări pe index, deci nu crește cu aplicația). Forma rândurilor atașate a fost aleasă după
plan: un filtru constant pe CTE strica estimarea și ducea la bucle imbricate (`ag_par` are o coloană pe tip de părinte). Ideea celor
două plase (schema după nume, corpul și implicitele deparsate; relațiile cu numărul rândurilor atașate) a fost verificată de coordonator
la mărimea reală, pe interogări de probă (aceeași valoare pe clonă și pe producție); forma finală din bloc (cu agregatele și detaliul)
se reverifică la citirea de baseline (rândurile `sistem_initdb` identice clonă ↔ țintă). Cifra reală a costului total o dă proba
cu ROLLBACK pe țintă (pasul 7) și `scripts/test_livrare_l15_v2.sh` (cazul f). Costul rundei 4 trece de pragul de ~2% pe catalogul
sintetic: **folosirea lui cere acordul coordonatorului** (variantele de reducere sunt în raportul rundei).
**Runda 5, pe PGlite, același catalog sintetic, de două ori câte 60 de rulări alternate r4 / r5 (mediane):** plasa singură (blocul
`AG_PLASA` + `SELECT` pe `ag_plasa`) ~17,2 → ~18,1 ms, adică **+0,8 ms** (cost fix: ~337 de relații și ~3.400 de funcții de la initdb,
nu crește cu aplicația); pe calculul complet diferența se pierde în zgomotul măsurătorii (+0,2 ms și +1,4 ms la două serii, mediane
~173 ms). Metoda de acces și tablespace-ul se iau prin `LEFT JOIN`, nu prin subinterogări pe fiecare rând (varianta cu subinterogări
costa încă ~0,3 ms). Cifra reală o dă tot proba cu ROLLBACK pe țintă.

**Optimizarea din 17.11.2026 (aceleași rânduri, secțiunea 2, „Versionare”).** Diagnosticul doar-citire de pe producție (raportul
coordonatorului din 17.11) a arătat că timpul e procesor pe server: ~1,29 s pe calcul (producția e de ~4,4 ori mai lentă pe un fir decât
clona), din care ACL-ul repetat pe fiecare rând ~250 ms. Prototipul cu optimizările 1, 3 și 5 a dat −21% pe producție (1.459 → 1.146 ms,
emularea pasului, o probă). Forma livrată, pe PGlite, catalogul sintetic (~7.400 de rânduri), 5 rulări alternate (mediane): blocul
~176 → ~122 ms (**−31%**), pașii „înainte” + „după” ~761 → ~658 ms (**−13%**). **Optimizarea singură NU aduce un calcul sub ~500 ms pe
producția actuală** (estimarea diagnosticului: ~0,95–1,1 s pe calcul, ~2,2–2,5 s pentru două calcule + diferență, peste plafonul de
2.000 ms); ce rămâne (deparsarea, serializarea cu md5, citirea cataloagelor) nu se poate scoate fără a schimba valorile. Decizia
(plafonul, instanța, o derogare) e a proprietarului. Cifrele reale le dă proba pe clonă (timpii pasului real al runnerului) și proba
cu ROLLBACK pe țintă.
**Încălzirea sesiunii înainte de BEGIN** (calculul rulat o dată într-o tranzacție separată, doar-citire, înaintea mesajului unic;
~215–285 ms câștigați doar la primul calcul pe un backend proaspăt) **nu e implementată**: n-ar slăbi comparația (rezultatul ei se
aruncă), dar schimbă forma livrării verificată de `scripts/test_livrare_mesaj_unic.py`, `scripts/test_livrare_l15_forma.sh` și
`scripts/portal/dry_prod_e1.sh` (încă un fișier psql în aceeași conexiune), iar câștigul depinde de pooler (backend-ul poate fi deja
cald). Rămâne propunere, cu review propriu.

### Plafonul livrărilor L15 v2: 5000 ms (runda 16, decizia proprietarului din 17.11.2026)

**Decizia.** Protocolul atomic rămâne neschimbat: cele două fotografii, comparația exactă cu manifestul, refuzul înainte de COMMIT,
`lock_timeout` pe încercare, garda amprentei globale din migrări. Se **ridică plafonul** tranzacției de aplicare și se **schimbă momentul**
de la care se numără secunda lock-urilor (mai jos). Dacă nici așa nu încape pe producție, se ia o instanță mai puternică — nu se trece la
auditul după COMMIT (varianta B a proiectării).

**Valoarea: 5000 ms**, o singură definiție: `AG_PLAFON_MS` în `scripts/livrare_amprenta.sh`. De ce, din cifrele măsurate pe 17.11.2026
(rapoartele coordonatorului: diagnosticul doar-citire, paritatea pe producție, probele pe clonă ale uscării):

| Componentă | Clonă (măsurat) | Producție |
|---|---:|---:|
| Interogarea amprentei, forma optimizată, backend cald | ~207 ms | **~855 ms** (măsurat) |
| Prima rulare pe un backend proaspăt | +~60 ms | **+~215–285 ms** (măsurat, forma de dinainte) |
| Pasul runnerului (tabel temporar, validări, diferența) | ~×1,5 față de interogare | estimat ×1,5 |
| Calculul „înainte” / „după” | ~310 / ~315 ms | ~1.200–1.300 ms fiecare (estimat) |
| Corpul migrării (uscarea: lock-uri, obiecte, sonda, postcondiții) | ~26 ms | ~50–150 ms (estimat) |
| **Tranzacția până la garda finală** | ~655–680 ms | **~2.500–2.800 ms** (estimat) |

Plafonul vechi (2000) nu încape nici în varianta optimistă (marjă zero). **5000** acoperă estimarea caldă cu ~45–50 % rezervă și lasă
~20–35 % și la rece (backend proaspăt; dacă prima rulare a formei noi e tot de ~2× mai lentă, ~3,7–4,2 s). **Valoarea e de confirmat prin
proba cu ROLLBACK pe producție** (secțiunea 7, pasul 7) **și se poate coborî după măsurătoare** — printr-un PR care schimbă constanta și
gărzile migrărilor neaplicate (nu printr-o opțiune de linie de comandă).

**Acordul runner ↔ validator ↔ gărzile migrării (nicio cale de nepotrivire tăcută):**
- runnerul (`scripts/livrare_migrare.sh`) și generatorul / proba manifestului (`scripts/livrare_l15_manifest.sh`): cu amprenta globală,
  `--plafon-tranzactie-ms` dat trebuie să fie EXACT `AG_PLAFON_MS` ⇒ altfel refuz 2, înainte de orice conexiune;
- validatorul (`scripts/livrare_validator.py --plafon-tranzactie-ms <N>`, forma folosită de runner): fiecare plafon CERUT de fișier —
  garda `'<D>/session'`, marcajul `'<D>:' || txid_current()`, antetul „`--plafon-tranzactie-ms <D>`” — trebuie să fie exact N ⇒ altfel
  refuz 3 (`PLAFON_DIFERIT`), înainte de orice conexiune; un fișier care citește `gazpet.plafon_tranzactie` fără marcajul în forma
  verificabilă = refuz (fail-closed). Deci o migrare care cere 2000 nu pleacă cu runnerul la 5000 și nici invers. Forma veche
  `--plafon-tranzactie` (fără valoare) rămâne doar pentru testele statice; runnerul nu o mai folosește;
- migrările neaplicate cu amprentă globală (`20261221a`, `20261225a`) cer `5000/session` + marcajul `5000:<txid>` în `$pre$` ⇒ un runner
  care ar da altă valoare e refuzat și în tranzacție (`PLAFON_TRANZACTIE lipsa`, nimic comis);
- fișierele de **revenire** se livrează fără amprentă globală și își păstrează plafonul lor (2000, ~75 ms pe clonă): validatorul cere
  `--plafon-tranzactie-ms 2000` pentru ele și refuză 5000;
- migrările **deja aplicate** pe producție nu se ating (cer în continuare valoarea lor; validatorul le acceptă exact cu ea). Consecință:
  `scripts/portal/dry_prod_e1.sh` în modul L15 (18a / 19a, aplicate pe 13.11, cer 2000) se oprește la generare.

Fără amprentă globală, plafonul rămâne parametrul runnerului (100..600000), cu același acord al validatorului.

**Runda 17 (verdictul Jakarinos pe #1115, cele două P1):**
- **Forma verificată STRUCTURAL, nu căutată în text.** Textul brut (și comentariile) doar refuză (o valoare diferită oriunde = `PLAFON_DIFERIT`);
  acceptarea cere ca **fiecare** citire și comparație a plafonului din codul executabil (nivelul superior + corpurile `$…$`, fără
  comentarii) să aibă forma acceptată și valoarea exactă N, altfel **`PLAFON_FORMA`**, refuz 3 înainte de conexiune. Forma acceptată:
  `SELECT setting || '/' || source INTO <v> FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';` (sau citirea între paranteze
  urmată direct de comparație), `<v>` declarată `text` și folosită doar în comparație sau în argumentele unui `RAISE`; comparațiile
  `IS DISTINCT FROM '<D>/session'` și `current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '<D>:' || txid_current()`
  (`pg_catalog.` opțional), fiecare un termen al disjuncției unui `IF … THEN RAISE EXCEPTION` (înainte `IF` / `OR`, după `OR` / `THEN`, fără
  paranteze deschise), cu **un singur** literal simplu. Refuzate (mutanți în `scripts/test_livrare_validator_plafon.py`, pe ambele migrări
  reale): exemplul recenzentului `('2000' || '/session')`, concatenarea fără paranteze, cast (`::text`, `CAST(… AS varchar(4))`), prefix `E'…'`,
  dollar-quote, literalul continuat pe linia următoare (`'2000/'` + `'session'`, și cu valoarea bună), forma bună doar într-un comentariu,
  `<>` în loc de `IS DISTINCT FROM`, `IF false AND …`, `… AND false`, `IF NOT (…)`, `RAISE NOTICE`, variabila suprascrisă / recitită,
  marcajul concatenat / fără `true` / scris de migrare (`set_config`), citirea `pg_settings` în altă formă. **Limita** (ca la garda de
  livrare): poziția gărzii (cod mort, funcție nechemată, o excepție prinsă) rămâne a review-ului artefactului; valoarea reală a plafonului
  o impun oricum prologul și garda finală ale runnerului.
- **Plafonul omis se vede local.** Runnerul fără `--plafon-tranzactie-ms` cheamă validatorul cu `--fara-plafon`: o migrare care **cere**
  plafon (un literal `'<D>/session'`, marcajul `'<D>:' || txid_current()`, numele `gazpet.plafon_tranzactie` sau `/session` oriunde în
  fișier — fail-closed) = **`PLAFON_LIPSA`**, refuz 3, **înainte de conexiune** (înainte refuza abia în `$pre$`, după pasul „înainte”). Același
  drum îl are generatorul de manifest (`livrare_l15_manifest.sh` generează prin runner). Migrările fără cerere de plafon trec ca înainte
  (în test: toate cele 459 din repo fără cerere dau același cod cu și fără `--fara-plafon`; cele 24 cu cerere sunt refuzate; `'0/default'`
  — garda care cere LIPSA plafonului — nu e o cerere). Fără nicio opțiune (testele statice) validatorul e neschimbat. Garda din `$pre$`
  rămâne (apărare în adâncime pentru o rulare în afara runnerului).

**Runda 18 (re-review-ul Jakarinos pe #1115, două P1 noi):**
- **Variabila plafonului după identitatea PostgreSQL, nu după token.** `v_plafon`, `V_PLAFON` și `"v_plafon"` sunt aceeași variabilă
  (neciat ⇒ litere mici, citat ⇒ exact). *Corectat în runda 19:* comparația rundei 18 era prin casefold și s-a folosit **și la acceptare**,
  deci afirmația „casefold produce doar refuzuri în plus” era falsă (`"V_PLAFON"`, alt identificator, era acceptat drept comparația gărzii;
  numele peste 63 de octeți nu erau trunchiate) — vezi runda 19. Forma acceptată devine: variabila declarată **o singură dată**, `<v> text;`, în **prima**
  secțiune `DECLARE` a corpului (blocul exterior), citită o dată, folosită doar în comparație sau în argumentele unei instrucțiuni care
  **începe** cu `RAISE`, fără `U&"…"` / `U&'…'` în același corp. Refuzate acum (`PLAFON_FORMA`, mutanți pe ambele migrări reale, fiecare
  aplicat exact o dată): mutantul recenzentului `"v_plafon" := 5000::text || chr(47) || 'session';`, `"V_PLAFON" :=`, `V_Plafon :=`,
  `SELECT … INTO "v_plafon"`, `EXECUTE … INTO "v_plafon"`, `FOR "v_plafon" IN …`, `GET DIAGNOSTICS "v_plafon" = …`, eticheta blocului
  (`<<b>>` … `b.v_plafon :=`), `ALIAS FOR` într-un bloc interior, redeclararea într-un bloc interior (umbrire), `U&"\0076_plafon" :=`,
  o etichetă `<<raise>>` înaintea atribuirii (vechea regulă „un RAISE mai devreme în instrucțiune” o accepta), variabila ca argument de
  apel; și un parametru de funcție cu același nume, cu citirea într-un bloc interior (comparația vedea parametrul). Controale acceptate:
  comparația și `coalesce(…)` din `RAISE` scrise cu `"v_plafon"` (aceleași litere); funcția cu declarația în blocul exterior.
- **`--fara-plafon` vede citirile explicite ale parametrului.** Pe lângă marcaj și `/session`, este cerere de plafon (refuz local
  `PLAFON_LIPSA`, înainte de conexiune) **orice citire** a lui `transaction_timeout` în codul executabil: `pg_settings` în orice formă în
  afara controlului de absență `( SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout' ) IS
  DISTINCT FROM '0/default'` (verificat structural, ca garda; și citit într-o variabilă), `current_setting('transaction_timeout' …)`,
  `SHOW transaction_timeout`, un literal care numește parametrul (`EXECUTE 'SHOW …'`, `format('SHOW %s', 'transaction_timeout')`),
  `pg_catalog."pg_settings"`, numele din bucăți (`'transaction' || '_timeout'`). Artefactul recenzentului (garda pe `pg_settings` comparată
  cu `'5000'`, fără `/session`) = `PLAFON_LIPSA`. **Scrierile nu sunt cereri** și trec fără plafon ca înainte (regulile vechi):
  `SET [LOCAL] transaction_timeout`, `RESET`, `ALTER … SET`, `CREATE FUNCTION … SET`, `set_config('transaction_timeout', …)`,
  `EXECUTE 'RESET transaction_timeout'`; comentariile nu sunt citiri. Compatibilitatea: niciun fișier din repo fără cerere nu menționează
  parametrul sau `pg_settings`, deci tot 459 cu același cod, 24 refuzate. Cu `--plafon-tranzactie-ms N` aceleași citiri erau deja refuzate
  (doar citirea exactă e permisă); refuzul poartă acum eticheta `PLAFON_FORMA` (test: artefactul recenzentului, `current_setting`, `SHOW`,
  `EXECUTE 'SHOW …'` cu plafonul 5000).
- **Limită declarată** (ca SQL-ul dinamic din runda 12): numele construit în server (`chr()`, `format` cu argument dinamic, `U&'…'` într-un
  corp, `current_setting(<variabilă>)`) nu se vede static; o asemenea cerere fără plafon e refuzată abia de garda din SQL a migrării, în
  tranzacție, nimic comis (comportamentul de dinainte de runda 17).

**Runda 19 (re-review-ul Jakarinos pe #1115, NO-GO P1-R3-1: identitatea identificatorilor):** două reguli separate, nu una „aproximativă”.
- **Acceptarea = identitatea EXACTĂ PostgreSQL** (declarația, citirea `INTO`, comparația gărzii, folosirea în `RAISE`): neciat ⇒ doar `A-Z`
  devin `a-z` (pe un server UTF-8 literele non-ASCII rămân neschimbate), citat ⇒ conținutul exact (`""` din interior = `"`), ambele
  **trunchiate la 63 de octeți UTF-8**, pe granița unui caracter (nu pe caractere). Niciodată casefold la acceptare.
- **Refuzul = conservator** (`PLAFON_FORMA`): variabila plafonului e un identificator simplu **necitat** `[A-Za-z_][A-Za-z0-9_]*` de cel mult
  63 de octeți; în corpul care o citește ea nu apare niciodată citată (nici `"v_plafon"`, identic) și niciun identificator nu depășește 63 de
  octeți; în **tot** fișierul (deci și parametrii funcției, blocurile exterioare, alte corpuri) niciun nume confundabil cu ea — același
  casefold / NFKC, același prefix de 63 de octeți — care nu e identic, niciun `U&"…"` / `U&'…'`, și nicio mențiune `variable_conflict` (cu
  `use_variable`, `setting` / `source` / `name` din forma acceptată ar putea fi variabile, nu coloanele `pg_settings`). Ceilalți identificatori
  citați rămân admiși (8 fișiere ale repo-ului au identificatori citați legitimi în corpul cu plafon, ex. `COLLATE "C"`; regula „niciun
  identificator citat” le-ar fi rupt). Cele două controale ale rundei 18 cu `"v_plafon"` (aceleași litere) devin refuzuri; nicio migrare / revenire din repo nu scrie
  variabila plafonului citat (inventarul e un test).
- **Tokenizerul** (toate modurile, și fără plafon): un cuvânt neciat cu o literă non-ASCII care, prin upper / lower / casefold / NFKC, dă o
  literă ASCII (`ı`, `ſ`, `ß`, ligaturile `ﬁ` / `ﬆ`, semnul Kelvin, literele „fullwidth”) = refuz: `.upper()` făcea din `publıc` cuvântul
  `PUBLIC` (forma verificată a lui `search_path` era acceptată, serverul ar fi setat altă schemă) și din `ınto` cuvântul `INTO`. Literele
  românești (`ă â î ș ț`) rămân permise.
- **`--fara-plafon`:** `set_config('transaction_timeout', …)` e recunoscut ca scriere doar pentru funcția exactă (`set_config` /
  `"set_config"`, necalificat sau `pg_catalog.`); `"SET_CONFIG"`, `public.set_config` = altă funcție ⇒ `PLAFON_LIPSA`.
- **Teste** (`scripts/test_livrare_validator_plafon.py`, secțiunea r19; pe 165798ed testul dă ESEC 37): reproducerea (a) octet cu octet,
  variantele ei (parametrul `"V_PLAFON"` cu garda pe variabila locală, parametrul `v_plafon` cu garda pe `"V_PLAFON"`), reproducerea (b) pe
  ambele migrări reale, numele de 63 de octeți prin numele lung necitat / citat, prefixul multi-octet (62 de octeți + `ţ` = 63 de caractere,
  64 de octeți), `"V_plafon"` / `"V_PLAFON"` în comparație, literele confuze, `variable_conflict`, `set_config`; controale acceptate:
  `V_PLAFON` / `V_Plafon` necitat (identic), variabila de 62 / 63 de octeți, un nume de 61 de octeți diferit, parametrul `v_plafon` umbrit,
  literele românești. Compatibilitatea 165798ed ↔ nou pe toate cele 483 de fișiere SQL, în toate modurile: 1.954 de rulări, 0 diferențe.

| PostgreSQL (server UTF-8) | identitatea | validatorul la acceptare | refuzul conservator |
|---|---|---|---|
| neciat ASCII (`V_Plafon`) | litere mici ASCII: `v_plafon` | identic (`ident_pg`) | — |
| citat (`"V_PLAFON"`) | exact: `V_PLAFON` ≠ `v_plafon` | nu e variabila | confundabil (casefold) ⇒ refuz oriunde în fișier |
| citat, aceleași litere (`"v_plafon"`) | `v_plafon` (identic) | identic | variabila nu se scrie citat ⇒ refuz în corpul ei |
| `""` în interior (`"a""b"`) | `a"b` | despachetat de tokenizer | — |
| `U&"…"` / `U&'…'` | decodificat în server | — | refuz (nivel superior: oricând; fișier cu variabila plafonului: oriunde) |
| > 63 de octeți (citat sau nu) | trunchiat la 63 de octeți, pe granița caracterului | identitatea trunchiată | variabila > 63 ⇒ refuz; în corpul ei orice nume > 63 ⇒ refuz; prefix de 63 egal ⇒ refuz oriunde |
| non-ASCII neciat (`v_ţintă`) | neschimbat (nu se pliază) | exact (din textul original, nu din `.upper()`) | literă confuză cu una ASCII (`ı`, `ſ`, `ß`, `ﬁ`, K) ⇒ refuz în tokenizer |

### Bugetul de lock (runda 16)

Înainte, secunda pentru lock-uri se număra **de la BEGIN** și includea pasul „înainte” al runnerului (~1,2–1,3 s pe producție): migrarea
ar fi refuzat cu `BUGET_LOCK` înaintea primei încercări (pe clonă s-a văzut forma refuzului, `0 incercari, 2172 ms de la BEGIN`). La meteo
termenul se verifica doar după o încercare eșuată, deci un lock liber putea fi obținut și după termen. Regula nouă, în ambele migrări
neaplicate și în **șablonul pentru migrările viitoare**:

1. **Ceasul pornește imediat înaintea primei încercări** (`v_t0 := clock_timestamp()` în blocul de lock), nu la BEGIN. Bugetul rămâne
   **1 s** (`v_buget`), separat de plafonul tranzacției.
2. **Termenul se verifică înaintea fiecărei încercări** (deci și înaintea reîncercărilor după o coliziune) **și după obținerea setului
   complet** — inclusiv pe calea **fără** coliziune: un set obținut după termen = `BUGET_LOCK`, nimic schimbat.
3. **Fiecare încercare e o subtranzacție** (`BEGIN … EXCEPTION WHEN lock_not_available`): eșecul unui lock anulează subtranzacția și
   eliberează lock-urile luate deja în ea, **înaintea** pauzei de 50 ms. Lock-urile sunt `NOWAIT` (`lock_timeout` = 100 ms rămâne pentru
   lock-urile implicite ale corpului).
4. **Ordinea e fixă și scrisă în migrare** (L06), aceeași la fiecare încercare: uscarea `executie_proiecte` → `executie_probe_tronsoane`
   (SHARE ROW EXCLUSIVE) → `storage.objects` (ACCESS EXCLUSIVE); meteo doar `sites` (SHARE ROW EXCLUSIVE).
   **Inventarul lock-urilor IMPLICITE de după set (runda 17, verdictul #1115 P2; și în comentariul blocului de lock al migrării):**
   - meteo: doar FK-ul la `CREATE TABLE` (SHARE ROW EXCLUSIVE pe `sites`, deja ținut) și citiri de catalog; funcțiile create nu rulează la
     aplicare;
   - uscare, (a) pe relațiile setului, ținute deja la fel de tare sau mai tare: FK-urile la `CREATE TABLE`, `CREATE POLICY` și citirile din
     postcondiții / sondă pe `storage.objects`;
   - uscare, (b) **în afara setului**, luate când `storage.objects` e deja ținut ACCESS EXCLUSIVE: `INSERT INTO storage.buckets` = ROW
     EXCLUSIVE pe `storage.buckets` și pe indecșii lui, verificarea de unicitate a cheii (poate aștepta o tranzacție concurentă care inserează
     același id) și **triggerele platformei pe `storage.buckets`** (inventariate pe țintă, pasul I al probei de mai jos); citirile (ACCESS
     SHARE) din postcondiții și din sondă pe `storage.buckets`, `profiles`, `user_module_access`, `executie_acces_proiect` și pe tabelele
     citite de lanțul `fn_executie_nod_drept` (acestea se ciocnesc doar cu ACCESS EXCLUSIVE: DDL, VACUUM FULL, LOCK);
   - fiecare așteptare implicită e limitată de `lock_timeout` = 100 ms (apoi eroare, tranzacția anulată, nimic comis), dar se face **ținând
     deja `storage.objects`**: o sesiune care blochează `storage.buckets` (SHARE sau mai tare) poate prelungi oprirea fișierelor cu ~100 ms
     pe așteptare înainte de refuz. `storage.buckets` **nu** intră în set (conținutul funcțional rămâne cel revizuit); refuzul curat e
     proba B1 de pe clonă (relația ținută) și B2 (runda 18: un `INSERT` necomis cu același id ⇒ așteptarea pe tranzacția concurentă la
     verificarea unicității).
   - **Completitudinea inventarului pe ținta reală rămâne de demonstrat** (runda 18, observația recenzentului): triggerele platformei pe
     `storage.buckets` și relațiile accesate de ele depind de catalogul țintei. Clona folosită are Storage stub, fără triggere: un inventar
     gol acolo nu dovedește inventarul producției. Pasul I se rulează (doar citire) și pe producție, înaintea probei cu ROLLBACK, iar orice
     trigger găsit se adaugă în inventarul de mai sus cu lock-urile lui.
   **Proba de concurență la aplicare** (doar pe clonă, cu migrarea NEAPLICATĂ; fiecare aplicare = proba cu ROLLBACK a generatorului de
   manifest, nimic comis): `supabase/tests/l15_aplicare_concurenta.sh --migrare uscare|meteo …` — I inventarul (triggere, constrângeri,
   politici pe `storage.buckets` / `storage.objects` / `sites`); L0 control `IDENTIC` cu 1 încercare; L1 relația principală ținută
   permanent ⇒ `BUGET_LOCK` la 900..1500 ms de la prima încercare, fără așteptare până la eliberare, și (uscare) un observator doar-citire care
   nu vede lock-urile parțiale ținute între încercări; L2 eliberare la ~400 ms după pasul „înainte” ⇒ `IDENTIC` cu ≥ 2 încercări, < 1000 ms;
   B1 (uscare) `storage.buckets` ținut SHARE ⇒ `lock timeout` la lock-ul implicit (nu `BUGET_LOCK`), fără așteptare până la eliberare;
   B2 (uscare, runda 18) altă sesiune cu `INSERT INTO storage.buckets` **necomis** cu id-ul `executie-uscare`, fără LOCK pe relație (ține doar
   ROW EXCLUSIVE, verificat la barieră) ⇒ `lock timeout` (100 ms) la verificarea unicității, nu `BUGET_LOCK`, fără așteptare până la
   ROLLBACK-ul ei, nimic comis. Runda 18 a mai reparat: conversiile `tgenabled::text` / `contype::text` / `polcmd::text` din inventar
   (`text || "char"` = „operator is not unique” pe PostgreSQL real), extragerea timpului din `BUGET_LOCK` pe mesajul REAL al fiecărei
   migrări (meteo: `BUGET_LOCK: sites ocupat; N incercari, …`; ambele forme verificate la pornire în fișierul migrării) și curățenia la
   eroare (trap-ul oprește și așteaptă H / observatorul și închide pe țintă backend-urile lor și ale probei; codul se păstrează).
   **Limita observatorului:** eșantionarea (~30 ms, 80 de eșantioane) e o dovadă, nu o demonstrație exhaustivă: un lock parțial mai scurt
   decât intervalul dintre eșantioane poate scăpa; absența lor între încercări rezultă din construcție (subtranzacția fiecărei încercări).
   **Bugetul pornește la prima încercare, probat pe PostgreSQL real** (runda 18, `scripts/test_livrare_l15_v2.sh` cazul p, cluster PG17
   efemer): blocul de lock REAL al uscării (setul înlocuit cu `public.sites`), livrarea ținută > 1 s la o barieră între pasul „înainte” și
   blocul de lock, apoi lock liber ⇒ APLICAT, `lock la >1000 ms de la BEGIN (1 incercari, <100 ms de la prima incercare)`; mutantul cu
   ceasul de la BEGIN (`v_t0 := now()`) ⇒ `BUGET_LOCK: 0 incercari`, NEAPLICAT (10).
   Scriptul de concurență e **netestat local** (serverul de cod nu are PostgreSQL); îl rulează coordonatorul.
5. **Măsurarea:** după obținere migrarea scrie momentul în `gazpet.lock_puternic_la` (µs de la epoch, `set_config(…, true)`) și tipărește
   `lock la X ms de la BEGIN (N incercari, Y ms de la prima incercare)`; la sfârșit, `lock-uri puternice tinute de Z ms`; garda finală a
   runnerului (doar pe calea cu amprentă globală) tipărește, după `PLAFON_TIMP`, **`LOCK_TINUT <nume>: lock-urile puternice ale migrarii
   tinute T ms pana la garda (de la obtinerea setului complet, …)`**. E diagnostic, nu gardă (valoarea vine din artefact; lipsă = mesajul
   „nedeclarat”). **Ce măsoară exact** (runda 17, observația recenzentului): intervalul de la obținerea SETULUI complet până la gardă; primele
   lock-uri ale setului sunt luate puțin mai devreme (în aceeași încercare), iar COMMIT-ul (neplafonat) și eliberarea reală NU sunt incluse.
   Eliberarea o dovedește **observatorul din altă sesiune** (mai jos), nu NOTICE-ul.

Șablonul (de copiat în migrările noi, cu numele și ordinea lor):

```sql
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '<NNNN>: BUGET_LOCK: % incercari, % ms de la prima incercare; nimic schimbat', v_incercari,
        round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE <a> IN <mod> MODE NOWAIT;   -- ordinea FIXĂ, documentată în antet
      LOCK TABLE <b> IN <mod> MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);               -- subtranzacția a eliberat deja lock-urile parțiale
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '<NNNN>: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare; nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '<NNNN>: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;
```

**Ce NU se schimbă — și ce nu se pretinde:** pasul „după” al runnerului (calculul global complet) rulează **după** corp și înregistrare,
**sub lock-urile puternice**, înaintea gărzii finale și a COMMIT-ului — asta e garanția atomică aleasă de proprietar. Recomandarea veche
„fără calcul global după lock-uri” **NU e îndeplinită literal**: la uscare `storage.objects` rămâne ACCESS EXCLUSIVE pe toată durata
calculului final. Runda 16 a mutat doar începutul bugetului de lock și a declarat costul; **nu** l-a eliminat. Reducerea lui e posibilă doar
prin optimizarea pasului final cu paritate completă (rânduri, detalii, refuzuri) sau printr-o instanță mai puternică; încălzirea sesiunii
înainte de BEGIN ar scurta prima fotografie, dar ajută puțin intervalul de blocare (fotografia finală e deja caldă). Blocul de lock rămâne
după verificările de catalog ale migrării.

### Riscul: lock-uri ținute mai mult

Separarea bugetelor **nu eliberează lock-uri**: lock-urile puternice se iau după pasul „înainte” și se țin **până la COMMIT**, adică peste
corpul migrării, pasul „după” (~1,2–1,3 s estimat pe producție), garda finală și COMMIT. Estimare pe producție: **~1,3–1,6 s** cu
lock-urile ținute (față de ~0,35 s pe clonă). **Este o EXTRAPOLARE, nu o măsurătoare** (runda 17): cele ~855 ms măsurate pe producție sunt
interogarea caldă, fără restul pasului runnerului; politicile și triggerele Storage reale pot adăuga cost. Oprirea fluxurilor de fișiere
reduce concurența, nu timpul calculului global. Cifra o dau proba cu ROLLBACK + observatorul extern (pragurile de GO, secțiunea 7).
- **Uscarea:** `storage.objects` în **ACCESS EXCLUSIVE** — în acest interval sunt oprite **toate** citirile și scrierile de fișiere din
  aplicație (orice bucket, nu doar cel nou): încărcări, descărcări, linkuri semnate. Plus SHARE ROW EXCLUSIVE pe `executie_proiecte` și
  `executie_probe_tronsoane` (opresc scrierile, nu citirile). De aplicat într-un moment liniștit (seara / dimineața devreme).
- **Meteo:** SHARE ROW EXCLUSIVE pe `sites` — oprește doar scrierile în `sites` (nu citirile, nu `FOR SHARE` / `FOR UPDATE`).
- O cerere a aplicației care așteaptă lock-ul nu pică singură (dacă nu are `lock_timeout`), ci întârzie cu durata de mai sus; cererile
  care țin deja lock-uri incompatibile fac migrarea să refuze curat (`BUGET_LOCK`, nimic schimbat).
- Plafonul mai mare înseamnă și că o livrare care se blochează în altă parte (nu la lock) poate ține tranzacția deschisă până la ~5 s
  înainte de refuz — fără lock-urile puternice dacă blocajul e înaintea lor.

**Cum se măsoară la proba pe producție (cu ROLLBACK, cu acordul owner-ului):** în jurnalul probei — `AMPRENTA_GLOBALA inainte: … calcul N ms,
la M ms de la BEGIN`, `<NNNN>: lock la X ms de la BEGIN (…, Y ms de la prima incercare)`, `sfarsit la … ; lock-uri puternice tinute de Z
ms`, `AMPRENTA_GLOBALA dupa: … calcul …`, `PLAFON_TIMP … garda trecuta la G ms`, `LOCK_TINUT … T ms`; **în paralel, un observator doar-citire
din altă sesiune** care, la ~50 ms, citește `pg_locks` + `pg_stat_activity` filtrat pe PID-ul livrării și pe relațiile blocate
(`storage.objects`, `executie_proiecte`, `executie_probe_tronsoane` / `sites`) și scrie momentul primei apariții a lock-ului puternic și al
dispariției lui (= eliberarea reală, după ROLLBACK / COMMIT) + câte sesiuni au așteptat (`wait_event_type = 'Lock'`). Comenzile exacte și
rezultatele așteptate le are coordonatorul în raportul rundei 16.

**Revenire:** PR-ul se poate retrage integral (runnerul, validatorul, biblioteca și cele două migrări neaplicate revin la forma de dinainte);
nicio migrare aplicată și nicio dată nu depind de el.

**Fișierele de revenire ale celor două migrări (`supabase/revenire/20261225a_…_ROLLBACK.sql`, `20261221a_…_ROLLBACK.sql`) — DE DECIS
înaintea aplicării reale (runda 17, observația recenzentului; nu le rescriem tacit).** Ele cer `2000/session` și se livrează **fără amprentă
globală**; validatorul le acceptă exact cu 2000 și le refuză cu 5000, iar runnerul refuză 2000 cu amprentă globală — deci nu există o cale
tăcută de nepotrivire. Dar acoperirea e ALTA decât la aplicarea L15: o revenire fără fotografii globale nu are comparația cu manifestul
(doar verificările ei de definiții și „fără date”); cele ~75 ms de pe clonă sunt ale acestei forme și **nu** dovedesc o revenire L15 pe
producție (cu două fotografii, 2000 nu ajunge, iar la uscare prima fotografie ar consuma și bugetul de lock încă numărat de la BEGIN în
revenire). Variante pentru proprietar: **A)** se acceptă explicit procedura de revenire fără amprentă globală (cum e azi, cu limitele de mai
sus); **B)** se pregătește separat (PR propriu, review, probe) o revenire compatibilă cu L15 — 5000, bugetul de lock la prima încercare,
manifestul ei. Recomandarea mea: A pentru prima aplicare (revenirea refuză oricum dacă au apărut date), B doar dacă se cere aceeași garanție
și la revenire.

**20261221a** cere acum exact `5000/session` (mai sus): calculul „înainte” NU mai consumă fereastra de lock, iar calculul „după” rulează sub
lock-ul ei pe `sites` (SHARE ROW EXCLUSIVE: oprește doar scrierile în `sites`, ~1,3–1,6 s estimat pe producție).

Varianta „pasul «înainte» separat, sub lock consultativ de sesiune” **NU e acceptată** ca soluție implicită: iese din mesajul verificat
prin `current_query()` și din plafon, iar fereastra „schimbare + revenire” (limita 6) crește. Rămâne doar ca idee, care ar cere review și
probe proprii.

## 10. 20261221a (pe main, NEAPLICATĂ) prin forma nouă

Migrarea își păstrează propria verificare L15 de dinainte (BASELINE-ul lipit în #1088) — rulează în interiorul pașilor noi.
**Runda 16 (17.11.2026) a schimbat fișierul** (doar gărzile de timp, nimic din obiectele create): plafonul cerut `5000/session` (era 2000) și
blocul de lock cu ceasul pornit la prima încercare + termenul verificat înainte și după (secțiunea 9; observația recenzentului — garda
verificată doar după un lock eșuat — e închisă). sha256-ul migrării s-a schimbat (`238daabc…`), deci antetul manifestului
`20261221a_meteo_xweather_zilnic.l15.tsv` a fost actualizat; rândurile lui nu depind de blocul de lock (un `DO` nu creează obiecte de
catalog), dar manifestul se **regenerează pe clonă** (pasul 2 de mai jos) înaintea PR-ului de baseline, iar rezultatul așteptat e identic
cu cel din repo (aceleași 108 rânduri, alt GLOBAL al clonei în antet).
**Proba integrală e OBLIGATORIE:** pe clonă, cu manifestul real și cu **concurență pe `sites`** (tabelul pe care migrarea îl blochează),
apoi proba cu ROLLBACK pe țintă.

```bash
# 1. citirea pe producție (o fotografie: scriptul ei de amprente + GLOBAL + lista + semnale), fără DDL concurent
bash scripts/amprenta_globala_citire.sh --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS> --user <U> --lista \
  --amprente-migrare scripts/meteo_xweather_amprente.sql \
  --radacina 'auth.uid()' --radacina 'public.fn_raport_santier_drept(bigint)' --radacina 'public.fn_executie_proiect_permis(bigint, boolean)' \
  > citire_prod_20261221a.txt
# 2. manifestul + detaliile, pe clonă (PG17, adusă la starea producției); apoi citirea clonei
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --versiune 20261221120000 \
  --tinta-host <clona> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS clona> --user <U> --plafon-tranzactie-ms 5000 \
  --iesire supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv --detalii <în afara repo-ului>/20261221a.l15.detalii.txt
bash scripts/amprenta_globala_citire.sh --tinta-host <clona> … --lista --amprente-migrare scripts/meteo_xweather_amprente.sql \
  --radacina … > citire_clona_20261221a.txt
# 3. comparabilitatea clonă <-> producție
bash scripts/l15_compara_liste.sh --a citire_clona_20261221a.txt --b citire_prod_20261221a.txt \
  --manifest supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv
# 4. aprobarea: ambele sha-uri (după PR-ul de baseline)
sha256sum supabase/migrations/20261221a_meteo_xweather_zilnic.sql supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv \
  | sed 's#supabase/migrations/##' > aprobare_20261221a.txt
# 5. în ziua livrării: recitirea + partea revizuită identică
bash scripts/amprenta_globala_citire.sh … (aceleași opțiuni ca la 1) > citire_ziua_20261221a.txt
bash scripts/l15_compara_liste.sh --a citire_prod_20261221a.txt --b citire_ziua_20261221a.txt --recitire
# 6. proba cu ROLLBACK pe țintă (obligatorie, cu acordul owner-ului)
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --versiune 20261221120000 \
  --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS> --user <U> --plafon-tranzactie-ms 5000 \
  --compara-cu supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv --amprenta-globala <GLOBAL din citire_ziua_20261221a.txt>
# 7. livrarea (forma „un mesaj”, plafon 5000 cerut de migrare = AG_PLAFON_MS)
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --aprobare aprobare_20261221a.txt \
  --versiune 20261221120000 --tinta-db postgres --tinta-sistem <SIS> --tinta-host <H> --tinta-port <P> --user <U> \
  --plafon-tranzactie-ms 5000 --amprenta-globala <GLOBAL din citire_ziua_20261221a.txt> \
  --diferente-globale supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv
```

## 11. Probe

| Probă | Unde | Cine |
|---|---|---|
| Blocul + pașii pe PGlite: garda; paritate citire ↔ runner; independența de sesiune; etichete unice; temporare / date / nextval / ANALYZE fără efect; **o schimbare minimă pe fiecare familie** (inclusiv obiecte noi în `pg_catalog` — funcție, tabel, operator — prinse de familiile lor; `sistem_initdb`: `quote_nullable … STRICT`; `acl_sistem`: GRANT / REVOKE pe funcții, relații, coloane, tipuri, schema de sistem, tabelul TOAST al unui catalog) + **mutantul** fiecărei familii; **r3:** contraexemplele recenzentului (auxiliar din `pg_catalog` cu DEFAULT schimbat și cu STRICT: poarta își schimbă rezultatul ⇒ GLOBAL diferă, familia `functie`), câte o schimbare minimă pe un tabel, o coloană, un tip și un operator create în `pg_catalog` (familiile lor), **mutantul perimetrului** (fără ramura „creat după initdb” ⇒ nimic prins), plasa pe `quote_nullable … STRICT` (poarta `false → true`, familia `sistem_initdb`) + mutantul plasei fără STRICT, volatilitate / DEFINER / `proconfig` / proprietar pe funcții de la initdb, limita declarată (ALTER pe o relație de la initdb nevăzut); secretele nu apar; contraexemplul vederii; manifestul scris de mână = diferența reală + detaliile (md5(detaliu) = amprenta) + contextul antetului; drumul bun; manifest cu rând lipsă / în plus / altă amprentă / altă operație; DDL nedeclarat; **regula DEFINER** (contraexemplul `pg_temp, public` chiar funcționează; fără `pg_temp` / dublu / `""`; `"$user"`; schemă inexistentă; CREATE direct / prin PUBLIC / prin apartenență; nume între ghilimele; `public, pg_temp` legitim; `--rol-de-incredere`; acceptarea cu md5 corect / greșit / după schimbarea căii / pentru funcție sigură, din afara lanțului, ne-DEFINER, inexistentă) cu **mutant pe fiecare regulă**; **grantorul** pe tabel și pe coloană (+ mutantul fără grantor); OWNED BY (+ mutant); obiectele mari (permutarea ACL); timpi. Nu se pot rula aici: o versiune minoră nouă (`server_version_num`), etichetele de securitate (fără furnizor) | `node scripts/pglite/test_amprenta_globala_local.mjs` | rulat la livrare (PASS) |
| **r4, pe PGlite:** contraexemplul recenzentului (trigger `BEFORE INSERT` pe `information_schema.sql_features` cu o funcție existentă: `INSERT` întoarce 1 → 0 rânduri ⇒ GLOBAL diferă, familiile `trigger` + `sistem_initdb`); câte un caz minim pe un părinte de la initdb pentru regulă, politică, constrângere pe tabel, constrângere pe domeniu (`information_schema.cardinal_number`), valoare implicită (poziția corectă printre coloane), `amop` / `amproc` pe o familie de la initdb, index nou, moștenire în ambele sensuri — cu poarta reală acolo unde există; **mutantul regulii** (`ag_par` fără ramura „rând atașat după initdb”) ⇒ familia nu se mai schimbă, pe FIECARE caz (indexul: mutantul perimetrului; moștenirea: mutantul fiecărui capăt); mutantul dublu (și fără plasa relațiilor) ⇒ GLOBAL identic, ca în r3; plasa relațiilor: RLS pe un tabel de la initdb ⇒ doar `sistem_initdb` (+ mutant), VACUUM + ANALYZE între citiri (cu `relhastriggers` stins) ⇒ GLOBAL identic; agregatele: `CREATE OR REPLACE AGGREGATE bool_and … INITCOND` (pg_proc identic, poarta null → true) ⇒ `sistem_initdb` (+ mutant); câmpurile OID ale plasei funcțiilor sub 12000 în afara schemei; detaliul plasei recalculat independent = rândurile plasei, două detalii diferite ⇒ exact obiectele schimbate; limita declarată (redenumirea unei coloane de la initdb nevăzută) | `node scripts/pglite/test_amprenta_globala_local.mjs` (secțiunile 11 și 13) | rulat la livrare (PASS) |
| **r5, pe PGlite:** contraexemplul recenzentului (`information_schema.sql_features` partiție a unui tabel al aplicației, reatașată cu altă limită: `INSERT … RETURNING` eroare → succes ⇒ GLOBAL diferă, doar `sistem_initdb`; **mutantul** plasei fără `relpartbound` ⇒ GLOBAL identic); detaliul plasei arată limita canonică (`FOR VALUES FROM (MINVALUE) TO ('ZZZ')`), fără arborele brut; verificări fără câmp nou: limita unei partiții a **aplicației** e deja în familia `relatie` (+ mutant), cheia de partiționare a părintelui (aplicație) cu o partiție de la initdb e în rândul `relatie` al părintelui; `ALTER FUNCTION … COST` pe o funcție de la initdb ⇒ `sistem_initdb` (+ mutant); **lista închisă**: coloanele `pg_class` / `pg_proc` / `pg_aggregate` ale catalogului real = „în plasă” ∪ „exclusă”, fără rest și fără suprapunere (34 = 17 + 17; 30 = 27 + 3; 22 = 21 + 1), cu mutanții listei (coloană neclasificată, clasificare dublă) | `node scripts/pglite/test_amprenta_globala_local.mjs` (secțiunea 14) | rulat la livrare (PASS) |
| **Optimizarea calculului (17.11.2026), pe PGlite:** forma nouă ↔ forma de dinainte (commit `a69ef186`, sha256 verificat), `FULL JOIN` pe (familie, etichetă) în aceeași interogare: 0 rânduri doar într-o parte, 0 cu amprentă / detaliu diferit, același GLOBAL — pe catalogul cu obiectele de probă, după **35 de schimbări** pe familiile atinse (relație, coloană, funcție, tip, `acl_sistem`) și pe câteva neatinse (fiecare schimbă GLOBAL-ul), și pe catalogul sintetic; verificări directe (ordinea enum, enum gol, `protrftypes`, ACL cu grantori diferiți); **14 mutanți** ai formei noi prinși de comparație (rând omis, câmp omis, grantor omis, schemă exclusă, regula rândurilor atașate eliminată, ACL nelegat pe funcții / relații de sistem, intrarea ACL fără `acldefault`, fiecare gardă inversată, ordinea / legătura enum); **pașii runnerului vechi ↔ nou: aceleași rezultate și aceleași mesaje** în 26 de cazuri (citire, aprobat, manifest bun / lipsă / altă amprentă, rânduri invalide și duble injectate înainte și după, integritatea fotografiei); validatorul izolat, vechi ↔ nou, la memorie mică și fără fișiere temporare (contraexemplele review r1–r2: rânduri invalide multe, aceeași etichetă de 2.000 de ori) — același refuz; planul (legăturile pe ACL = Hash Join); timpi orientativi. Cazurile 1–3 sunt UN fișier SQL (o tranzacție anulată), scris cu `--sql-clona` pentru proba pe PostgreSQL 17 real | `node scripts/pglite/test_amprenta_paritate_calcul.mjs` | rulat la livrare (PASS); pe clonă: coordonatorul |
| **Runda 16 (17.11.2026): plafonul 5000 + bugetul de lock.** Validatorul cu `--plafon-tranzactie-ms`: acordul pe cazuri minime (cere 5000 / runner 5000 = 0; plafonul vechi 2000 cu runnerul la 5000 și invers, garda și marcajul amestecate, antetul cu altă valoare, marcajul în formă neverificabilă = 1; fără nicio cerere = 0; valori invalide = 2) și pe **toate** migrările / revenirile din repo cu plafon declarat (trec cu plafonul lor, refuzate cu altul: fără refuz fals); runnerul: cu L15, 2000 / 60000 = 2; migrare care cere alt plafon = 3 (PLAFON_DIFERIT); LOCK_TINUT doar în garda L15 | `python3 scripts/test_livrare_validator_plafon.py`; `bash scripts/test_livrare_l15_forma.sh` | validatorul: rulat la livrare (PASS); forma: coordonatorul |
| **Runda 16, pe PGlite, pe migrările reale** (`20261225a`, `20261221a`): validatorul real (migrarea cu 5000 = 0, cu 2000 = refuz; revenirea cu 2000 = 0, cu 5000 = refuz; mutantul „plafonul vechi cerut cu runnerul nou”); aplicarea cu plafonul vechi pus de runner = `PLAFON_TRANZACTIE`; garda finală REALĂ a runnerului (`lm_fin … lock`) pe livrarea aprobată: `PLAFON_TIMP` (5000) + `LOCK_TINUT`; bugetul: un pas „înainte” de 1,05 s nu-l mai consumă; set obținut după termen fără coliziune = `BUGET_LOCK`; ocupat permanent = `BUGET_LOCK` la ~1 s; uscarea: eșec după primele două lock-uri ⇒ 0 lock-uri parțiale rămase, a doua încercare reușește; **mutanți**: fără niciun termen, fără termenul de după (calea fără coliziune), fără termenul de dinainte, ceasul de la BEGIN, primele lock-uri în afara subtranzacției — toți prinși; manifestul uscării generat = aceleași **252** de obiecte | `node scripts/pglite/test_executie_uscare_local.mjs`, `node scripts/pglite/test_meteo_xweather_local.mjs` | rulat la livrare (PASS) |
| **Runda 17 (verdictul #1115, două P1 + P2): validatorul structural și plafonul omis.** Pe ambele migrări reale, câte 24 de mutanți ai formei + 2 controale, fiecare aplicat exact o dată: cei 24 refuzați (`PLAFON_FORMA`; unul și de regula brută din runda 16; lista în §9), controalele acceptate (comentariu între tokeni, `pg_catalog.`); `--fara-plafon`: migrările reale = `PLAFON_LIPSA` (și cu cererea în formă neverificabilă), cazuri minime (fără cerere / `'0/default'` / mutantul r13 = 0; cerere în gardă / marcaj / comentariu = 1), **toate** fișierele din repo (24 cu cerere refuzate, 459 fără cerere cu același cod ca fără opțiune). **Dovada pe codul vechi:** aceleași cazuri pe validatorul head-ului revizuit (`dc8b4665`, cu `--validator`) ⇒ ESEC pe 46 de mutanți ai formei (23 pe migrare, acceptați de el cu 91 / 30 de instrucțiuni) și pe toate cazurile `--fara-plafon` (opțiune necunoscută; fără opțiune, cum îl chema runnerul vechi, acceptă ambele migrări) | `python3 scripts/test_livrare_validator_plafon.py` (vechiul: `git show dc8b4665:scripts/livrare_validator.py > /tmp/v.py; python3 scripts/test_livrare_validator_plafon.py --validator /tmp/v.py` ⇒ ESEC) | rulat la livrare (PASS; pe vechi ESEC, cum trebuie) |
| **Runda 17, PGlite pe migrările reale:** mutantul recenzentului (`('2000' \|\| '/session')`) = `PLAFON_FORMA`; runnerul fără plafon = `PLAFON_LIPSA`; `LOCK_TINUT` în forma nouă (ce măsoară exact); manifestul uscării = aceleași 252 de obiecte | `node scripts/pglite/test_executie_uscare_local.mjs`, `node scripts/pglite/test_meteo_xweather_local.mjs` | rulat la livrare (PASS) |
| **Runda 17, forma runnerului fără PostgreSQL:** forma neverificabilă (și cu forma bună într-un comentariu) = 3 `PLAFON_FORMA`; plafonul omis — runner cu / fără L15 și generatorul de manifest — = 3 `PLAFON_LIPSA`; niciun apel psql; controlul cu plafonul cerut = 0. `test_portal_e1.sh`: runnerul fără plafon pe 18a = refuz LOCAL (cod 3), nu în `$pre$` | `bash scripts/test_livrare_l15_forma.sh`; `bash scripts/test_portal_e1.sh` | coordonatorul (bash nu rulează în sesiunea de cod) |
| **Runda 17, concurența la aplicare (clonă, ROLLBACK):** I inventarul (triggere / constrângeri / politici pe `storage.buckets`, `storage.objects`, `sites`), L0 control, L1 ocupat permanent ⇒ `BUGET_LOCK` + observatorul lock-urilor parțiale, L2 eliberat înainte de termen ⇒ `IDENTIC`, B1 `storage.buckets` ținut ⇒ `lock timeout` curat | `bash supabase/tests/l15_aplicare_concurenta.sh --migrare uscare\|meteo …` | coordonatorul pe clonă (netestat local) |
| **Runda 18, validatorul (re-review #1115):** P1-1 — 13 mutanți ai variabilei plafonului pe ambele migrări reale (identificator citat / alte majuscule, INTO / EXECUTE INTO / FOR / GET DIAGNOSTICS citate, eticheta blocului, ALIAS, umbrire, `U&`, `<<raise>>`, argument de apel) = `PLAFON_FORMA` + parametrul umbrit; controalele cu `"v_plafon"` acceptate. P1-2 — citirile parametrului fără plafon (artefactul recenzentului, `current_setting`, `SHOW`, `EXECUTE 'SHOW …'`, `format`, nume din bucăți, `"pg_settings"`) = `PLAFON_LIPSA`; controlul de absență `'0/default'` (și în variabilă) și scrierile = acceptate; aceleași citiri cu plafonul 5000 = `PLAFON_FORMA`. Pe validatorul din e58dc330 aceleași cazuri = ESEC (33) | `python3 scripts/test_livrare_validator_plafon.py` (și `--validator <fișierul din e58dc330>`) | rulat la livrare (PASS; vechiul: ESEC 33) |
| **Runda 18, bugetul de la prima încercare (PG17 efemer):** cazul p — pasul „înainte” + barieră > 1 s, apoi lock liber ⇒ APLICAT cu `lock la >1000 ms de la BEGIN (1 incercari, <100 ms …)`; mutantul ceasului de la BEGIN ⇒ `BUGET_LOCK: 0 incercari`, 10 | `bash scripts/test_livrare_l15_v2.sh <slot>` (WSL, ca postgres) | coordonatorul |
| **Runda 18, concurența la aplicare:** conversiile `::text` din inventar, L1 meteo pe mesajul real, B2 coliziunea de unicitate pe bucket, curățenia la eroare (trap) | `bash supabase/tests/l15_aplicare_concurenta.sh --migrare uscare\|meteo …` | coordonatorul pe clonă (netestat local) |
| **Toate regresiile bash locale, o singură comandă** (runda 17): rulează în ordine validatorul, forma L15, paritatea cu `origin/main`, forma finală, cele două PGlite; tipărește PASS / ESEC pe fiecare și codul final | `bash scripts/test_livrare_l15_local_toate.sh [<ref>]` | coordonatorul |
| Comparatorul de liste: fără opțiuni, `--manifest`, `--recitire`, intrări invalide, eticheta cu TAB; mutant pe fiecare regulă; **r3:** două fotografii care diferă doar prin `MOMENT` ⇒ 0 (mutantul cu `MOMENT` în partea revizuită ⇒ 6), și secțiunea diferă ⇒ 6, `MOMENT` lipsă / dublu / neînlocuit ⇒ 2; citirea reală cu un psql simulat (momente de lungimi diferite) ⇒ secțiunea cu marcajul, `--recitire` 0; mutantul citirii fără înlocuire ⇒ refuz; **r4:** coliziunea (aceeași valoare și într-un rând de date ⇒ rămâne; două citiri în care ea diferă ⇒ 6; mutantul cu înlocuirea globală ⇒ 0), momentul în alt format și antetul în alt format ⇒ nenormalizate, 6; `--detalii-plasa`: detaliul scris și recalculat = `RAND`, alt obiect ⇒ diferența îl numește, detaliu nereproductibil ⇒ 1 (mutantul fără verificare ⇒ 0), fără `--lista` / fișier existent ⇒ 2, fără opțiune nimic în plus; **r5:** antetul repetat în date (a doua pereche antet + rând cu momentul ⇒ rândul rămâne, o singură înlocuire; două citiri în care el diferă ⇒ 6, diferența arătată), mutantul citirii (rearmarea la fiecare antet) ⇒ 0, mutantul comparatorului ⇒ 2 (refuz fals), cele 5 scripturi cu antet standard ⇒ `--recitire` 0 | `bash scripts/test_l15_compara_liste.sh` (doar bash; rulat și de vitest) | CI + livrare |
| Forma runnerului fără PostgreSQL: argumente, `--aprobare`, mesajul unic cu `--l15`, forma fără plafon, `--genereaza-in`, fără opțiuni | `bash scripts/test_livrare_l15_forma.sh` | coordonatorul (cere python3) |
| Paritatea căii vechi cu main: aceleași fișiere generate, octet cu octet, cu și fără plafon, cu `--aprobare` | `bash scripts/test_livrare_l15_paritate.sh [<ref>]` | coordonatorul (cere python3) |
| PostgreSQL 17 real: (a) contraexemplul vederii, (b) DDL concurent cu barieră (cu și fără plafon) + control, (c) manifest greșit, (d) drumul bun, (e) fără opțiuni, (f) timpi rece / cald, (g) `--compara-cu`, (h) `--detalii`, (i) DEFINER nesigur / acceptat, (j) grantorul prin runner, **(k) r3: două citiri reale consecutive cu `--amprente-migrare scripts/meteo_xweather_amprente.sql` ⇒ `--recitire` 0**, **(l) r4: triggerul recenzentului creat între două citiri reale ⇒ GLOBAL diferă (familia `trigger`), apoi RLS pe același tabel ⇒ `sistem_initdb`; (m) VACUUM + ANALYZE între două citiri ⇒ GLOBAL identic; (n) `--detalii-plasa` pe două citiri reale, înainte / după `quote_nullable … STRICT` ⇒ diferența = acea funcție**, **(o) r5: contraexemplul partiției între două citiri reale ⇒ GLOBAL diferă, doar `sistem_initdb`, detaliul = `information_schema.sql_features`; lista închisă pe catalogul PG17 (în plus doar `relallfrozen`, coloană PG18)** | `bash scripts/test_livrare_l15_v2.sh <slot>` (WSL, ca postgres) | coordonatorul pe clonă |
| Regresiile runnerului (neschimbate) | `test_livrare_forma_fin.sh`, `test_livrare_plafon.sh`, `test_portal_e1.sh` (PASS în mediul coordonatorului); `test_sec_rsvti.sh` = regresie **PARȚIALĂ** în mediul coordonatorului: verificarea statică a fluxurilor CI din harness e depășită pe main, iar pasul cu ceasul fix cere o bibliotecă lipsă (n-a rulat) — nu e PASS integral; problemele sunt preexistente, nereparate aici | coordonatorul |
| Static (CI): bloc ASCII fără backslash, marcaje v2, familii = document, **nicio serializare ACL fără grantor**, perimetrul de sistem, **r4:** regula rândurilor atașate definită o dată (`ag_par`) și folosită de exact cele 7 familii atașate, plasa (câmpurile, independența de build, rândurile din `ag_plasa`, blocul `AG_PLASA` = începutul catalogului), antetul standard același în citire și comparator, cele 5 scripturi cu antet standard / cele 2 fără, `--detalii-plasa`; **r5:** limita partiției în plasă în forma canonică, lista `AG_PLASA_COLOANE` (fiecare coloană „în plasă” apare în ramura ei, nicio coloană exclusă nu apare ca valoare, fiecare excludere numită în secțiunea 2 (ii)), antetul identificat o dată în citire și comparator (marcajele de mutant), antetul = prima ieșire în cele 5 scripturi; regula DEFINER în citire, opțiunile manifestului, marcajele de mutant, L15 în LECTII | `src/amprentaGlobalaL15v2.test.js` (vitest) | CI |
