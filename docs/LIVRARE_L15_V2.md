# Livrarea migrărilor — L15 v2: amprenta GLOBALĂ verificată de runner, înainte și după, în aceeași tranzacție

Versiune: AMPRENTA_GLOBALA **v2** (13.11.2026). Decizie: propunerea coordonatorului + ACCEPT CU CONDIȚII de la recenzent (6 condiții),
apoi runda 2 după review (grantorii ACL, regula DEFINER, schemele de sistem, comparabilitatea clonă ↔ țintă) și runda 3 (obiectele
create în schemele de sistem prin familiile obișnuite, plasa pe funcțiile de la initdb, momentul fotografiei la recitire).
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

**Schemele de sistem.** Un obiect creat în `pg_catalog` e găsit ÎNAINTEA celui din schema aplicației la orice apel necalificat, iar un
`GRANT` pe o funcție de sistem sau pe un tabel TOAST e tot un drept. Ce intră, exact:
- **obiectele create după initdb** în `pg_catalog` / `information_schema` (funcții, relații cu coloanele, constrângerile, triggerele,
  regulile, politicile și moștenirea lor, tipuri, operatori, clase / familii de operatori, colații, conversii, căutare text): **integral**,
  prin ACELEAȘI familii și ACELEAȘI expresii ca obiectele aplicației (`functie`, `relatie`, `coloana`, `tip`, `operator` …). Runda 3 a
  desființat reprezentarea lor sumară separată (`sistem_adaugat`, care omitea de ex. argumentele implicite și STRICT — contraexemplul
  recenzentului: o poartă care cheamă un auxiliar din `pg_catalog` își schimba rezultatul cu GLOBAL identic). Eticheta lor e cea obișnuită,
  necalificată (de ex. `functie l15_helper(boolean)`), pentru că `pg_catalog` e pe calea canonică;
- **funcțiile de la initdb** (`oid < 16384`), **agregat**: familia `sistem_initdb`, UN rând `[număr, md5]` peste câmpurile BRUTE din
  `pg_proc` care le hotărăsc comportamentul — identitatea (schema, numele, tipurile argumentelor), kind, limbaj, proprietar, SECURITY
  DEFINER, STRICT, volatilitate, LEAKPROOF, PARALLEL, SETOF, rezultatul, VARIADIC, argumentele (toate tipurile, modurile, numele),
  `proconfig`, numărul și expresiile argumentelor implicite, md5(`prosrc`), `probin`, md5(corpul BEGIN ATOMIC), funcția suport —, fără
  funcții de deparsare, ordonat (schema, nume `COLLATE "C"`, tipurile argumentelor). Prinde de ex. `ALTER FUNCTION
  pg_catalog.quote_nullable(text) STRICT` (contraexemplul recenzentului). La refuz arată doar „funcțiile de la initdb diferă”, nu care:
  diagnosticul se face cu o interogare pe `pg_proc` (comparat cu o clonă de aceeași versiune). Pe aceeași bază (înainte / după, citire /
  recitire) rândul e stabil; între clonă și țintă poate diferi (câmpurile brute conțin OID-uri ale obiectelor create la initdb prin SQL —
  `information_schema`, `plpgsql` — și depind de versiunea exactă), deci apare la diferențele rămase din PR-ul de baseline, nu în manifest;
- **ACL-urile explicite** (`acl_sistem`): proprietarul + ACL-ul celor trei scheme de sistem (`pg_catalog`, `information_schema`,
  `pg_toast`) și fiecare obiect din ele cu ACL **explicit** (`relacl` / `attacl` / `proacl` / `typacl` nenul), cu grantor; relațiile
  TOAST se etichetează după tabelul-părinte (numele lor conține un OID). Un obiect creat după initdb cu ACL explicit apare și aici (redundant);
- `server_version_num` (familia `baza`).

**Ce NU intră, exact:** definițiile celorlalte obiecte de la initdb — relații, coloane, constrângeri, tipuri, operatori, clase / familii de
operatori, colații, conversii, căutare text din `pg_catalog` / `information_schema` (și tot `pg_toast`, în afara ACL-urilor explicite).
Sunt metadate modificabile prin DDL (de superuserul platformei), nu doar cu versiunea serverului: un `ALTER` pe ele nu se vede (limita 10).

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
| familie_operatori, clasa_operatori, amop, amproc, metoda_acces | pg_opfamily, pg_opclass, pg_amop, pg_amproc, pg_am | proprietar; clasa: familia, tipul, implicită, tipul cheii; amop: scop, operator, familia de sortare, metoda; amproc: funcția; membrii adăugați de extensii la familiile sistemului (oid ≥ 16384) intră și ei; pg_am: tip, handler (toate) |
| cast | pg_cast | TOATE: funcția, contextul, metoda |
| limbaj, transformare | pg_language, pg_transform | proprietar, PL, trusted, handler, inline, validator, ACL; transformările: funcțiile from / to |
| conversie, colatie | pg_conversion, pg_collation | proprietar, codificări, funcția, implicită; provider, determinist, collate, ctype, locale, ICU rules |
| ts_parser, ts_sablon, ts_dictionar, ts_config | pg_ts_parser, pg_ts_template, pg_ts_dict, pg_ts_config, pg_ts_config_map | funcțiile, șablonul, opțiunile, parserul, mapările |
| extensie | pg_extension | proprietar, schema, relocatable, versiunea, extconfig, extcondition |
| trigger_eveniment | pg_event_trigger | evenimentul, proprietar, funcția, starea, tag-urile |
| mostenire | pg_inherits | ordinea, detach pending |
| acl_implicit | pg_default_acl | ACL-ul pe (rol, schemă, tip de obiect) |
| baza, parametru_acl, tablespace | pg_database (doar cea curentă), pg_parameter_acl, pg_tablespace | **`server_version_num`**, proprietar, codificare, locale / provider, template, allowconn, connlimit, ACL; ACL pe parametri; tablespace: proprietar, ACL, opțiuni |
| rol, membru, setare_rol | pg_roles, pg_auth_members, pg_db_role_setting | toate atributele (super, inherit, createrole, createdb, login, replication, bypassrls, connlimit, valid until) + rolconfig (valorile ca md5); membru: admin / inherit / set + grantor; setările pe rol / bază (valorile ca md5) |
| fdw, server_extern, mapare_utilizator | pg_foreign_data_wrapper, pg_foreign_server, pg_user_mappings | handler, validator, proprietar, ACL, tip, versiune; **opțiunile doar ca md5** (pot conține secrete) |
| publicatie, publicatie_tabel, publicatie_schema | pg_publication, pg_publication_rel, pg_publication_namespace | proprietar, all tables, operațiile, via root; filtrul de rânduri și coloanele; schemele |
| obiect_mare | pg_largeobject_metadata | **câte un rând pe obiect**, etichetat cu identificatorul lui (`loid` — numele public al obiectului mare; singura excepție declarată de la „fără OID-uri”): proprietar, ACL |
| eticheta_securitate | pg_seclabels | furnizorul, obiectul, eticheta |
| sistem_initdb | pg_proc — funcțiile de la initdb din `pg_catalog` / `information_schema` (`oid < 16384`, complementul perimetrului) | UN rând: numărul + md5 peste câmpurile brute (identitate, kind, limbaj, proprietar, DEFINER, STRICT, volatilitate, LEAKPROOF, PARALLEL, SETOF, rezultat, VARIADIC, argumente cu tipuri / moduri / nume, `proconfig`, argumentele implicite, md5(`prosrc`), `probin`, md5(BEGIN ATOMIC), funcția suport) |
| acl_sistem | pg_namespace, pg_class, pg_attribute, pg_proc, pg_type — `pg_catalog`, `information_schema`, `pg_toast` | schemele: proprietar + ACL; obiectele cu ACL explicit: ACL-ul (cu grantor), la relații și funcții și proprietarul; TOAST după tabelul-părinte |

Obiectele create după initdb în `pg_catalog` / `information_schema` nu au familie proprie: intră în familiile de mai sus (`functie`,
`relatie`, `coloana`, `constrangere`, `trigger`, `regula`, `politica`, `mostenire`, `tip`, `operator`, `familie_operatori`,
`clasa_operatori`, `amop`, `amproc`, `colatie`, `conversie`, `ts_*`), cu aceleași câmpuri.
| sesiune | profilul sesiunii de livrare | `DateStyle`, `TimeZone`, `row_security`, `search_path`, `session_replication_role` (citite o dată, „înainte”) |

**NU intră:** statistici (`reltuples`, `relpages`, pg_statistic, contoare de vacuum / freeze), `relfilenode`, valoarea curentă a secvențelor,
datele din tabele, `attstattarget` / `attoptions` / `attmissingval`, `collversion`, statisticile extinse, `relhas*` (derivate, actualizate
leneș), OID-urile (în afară de identificatorul obiectelor mari) și numerele de coloană. Din `pg_depend` intră DOAR legătura secvențelor cu
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
prima ciornă, respinsă la review, nefolosită; forma care intră pe main este **v2** — cea de după runda 3, iar valorile calculate cu ciornele
rundelor 1–2 (de ex. probele coordonatorului pe clonă) nu se folosesc ca baseline (se recitesc). Schimbările față de v1:
- runda 2: grantorul în toate ACL-urile; dependențele OWNED BY / identity ale secvențelor; schemele de sistem (atunci: familia sumară
  `sistem_adaugat` + `acl_sistem`); `server_version_num` în `baza`; obiectele mari câte un rând;
- runda 3: perimetrul definit o dată (`ag_per` + CTE-urile de perimetru) și obiectele create după initdb în schemele de sistem prin
  familiile obișnuite (`sistem_adaugat` desființată); familia nouă `sistem_initdb` (plasa pe funcțiile de la initdb); `eticheta_securitate`
  urmează același perimetru. Lista: 45 de familii (`sistem_adaugat` ieșită, `sistem_initdb` intrată).
O excepție (de ex. o schemă de platformă care se schimbă singură) se face DOAR așa, explicit, ca reducere declarată a garanției.

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
10. **Schemele de sistem, obiectele de la initdb:** se văd doar funcțiile lor, agregat (`sistem_initdb`), ACL-ul lor explicit
    (`acl_sistem`), proprietarul celor trei scheme și `server_version_num`. Definițiile relațiilor, coloanelor, constrângerilor, tipurilor,
    operatorilor, claselor / familiilor de operatori, colațiilor, conversiilor și configurațiilor de căutare text de la initdb NU intră:
    un `ALTER` pe ele făcut de superuserul platformei nu se vede (proba PGlite o arată pe o coloană din `information_schema`).
    Cast-urile, metodele de acces, limbajele intră integral. Obiectele create după initdb în aceste scheme intră integral (secțiunea 2).
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
   (cod 6) cu lista. Diferențele din `extensie`, `colatie`, `limbaj`, `rol`, `membru`, `schema` și privilegiile implicite ale ALTOR
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
   cele 6 scripturi `*_amprente.sql` existente au forma asta) ⇒ rulează în fotografia comună; ieșirea lui (format nealiniat, separator
   ` | `) e delimitată de liniile `=== scriptul de amprente al migrarii …` / `=== sfarsit scriptul de amprente al migrarii ===`.
   **Momentul fotografiei** (`now()` al tranzacției unice, în forma text a sesiunii) se tipărește O DATĂ, pe rândul `MOMENT` (în afara
   părții revizuite), iar în secțiunea scriptului migrării EXACT acel șir e înlocuit cu marcajul fix `<momentul fotografiei>` (scripturile
   existente, nerescrise, tipăresc `now()` în antet; fără înlocuire două citiri fără niciun DDL difereau). Nimic altceva nu se normalizează:
   un alt timestamp din detaliile obiectelor rămâne cum e. Formatul nealiniat e necesar: în cel aliniat lățimea coloanei depinde de
   lungimea momentului (zerourile finale ale fracțiunii de secundă nu se tipăresc), deci și antetul / separatorul s-ar schimba;
3. `GLOBAL` + rânduri + md5 pe familii + validarea (`--lista`: toate rândurile); rândurile `CONTEXT`;
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
     versiune); fiecare diferență de scheme; ce lipsește din clonă (de ex. stub-uri, tabele ale platformei, politici absente);
   - diferențele rămase între liste, **grupate** (pe familii / scheme), fiecare grup cu motivul pentru care nu atinge traseul migrării;
   - proba integrală proprie pe clonă (cu concurență pe tabelele pe care migrarea le blochează) și criteriile de timp / concurență pentru
     proba pe țintă (pasul 7).
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
   - garda finală (`PLAFON_TIMP`) **cel mult 1.500 ms**, adică minimum 500 ms rămași din plafonul de 2.000 ms;
   - pasul „înainte” măsurat separat (`AMPRENTA_GLOBALA inainte: … calcul N ms`); dacă se apropie de **700 ms**, fereastra de reîncercări
     rămasă migrării (~300 ms din bugetul ei de lock) se acceptă **explicit**, în jurnal;
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

**Recomandare:** pentru livrările cu amprentă globală plafonul rămâne parametrul runnerului; 2000 ms ajunge doar dacă proba pe țintă arată
`PLAFON_TIMP` ≤ ~1.500 ms (marjă pentru rețea și lock-uri). **20261221a** cere exact `2000/session` (nu se schimbă): calculul „înainte”
consumă din fereastra ei de lock (`BUGET_LOCK` = 1 s de la BEGIN), iar calculul „după” rulează sub lock-ul ei pe `sites` (SHARE ROW
EXCLUSIVE: oprește scurt doar scrierile în `sites`).

Varianta „pasul «înainte» separat, sub lock consultativ de sesiune” **NU e acceptată** ca soluție implicită: iese din mesajul verificat
prin `current_query()` și din plafon, iar fereastra „schimbare + revenire” (limita 6) crește. Rămâne doar ca idee, care ar cere review și
probe proprii.

## 10. 20261221a (pe main, NEAPLICATĂ, fișier fixat) prin forma nouă — fără a modifica fișierul

Migrarea își păstrează propria verificare L15 de dinainte (BASELINE-ul lipit în #1088) — rulează în interiorul pașilor noi.
**Proba integrală e OBLIGATORIE:** pe clonă, cu manifestul real și cu **concurență pe `sites`** (tabelul pe care migrarea îl blochează),
apoi proba cu ROLLBACK pe țintă. Observația recenzentului, de consemnat: garda de timp a lock-ului din migrare se verifică doar **după un
lock eșuat** — dacă lock-ul e liber, poate fi obținut și după pragul de o secundă; proba pe țintă arată unde cade efectiv.

```bash
# 1. citirea pe producție (o fotografie: scriptul ei de amprente + GLOBAL + lista + semnale), fără DDL concurent
bash scripts/amprenta_globala_citire.sh --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS> --user <U> --lista \
  --amprente-migrare scripts/meteo_xweather_amprente.sql \
  --radacina 'auth.uid()' --radacina 'public.fn_raport_santier_drept(bigint)' --radacina 'public.fn_executie_proiect_permis(bigint, boolean)' \
  > citire_prod_20261221a.txt
# 2. manifestul + detaliile, pe clonă (PG17, adusă la starea producției); apoi citirea clonei
bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --versiune 20261221120000 \
  --tinta-host <clona> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS clona> --user <U> --plafon-tranzactie-ms 2000 \
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
  --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS> --user <U> --plafon-tranzactie-ms 2000 \
  --compara-cu supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv --amprenta-globala <GLOBAL din citire_ziua_20261221a.txt>
# 7. livrarea (forma „un mesaj”, plafon 2000 cerut de migrare)
bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261221a_meteo_xweather_zilnic.sql --aprobare aprobare_20261221a.txt \
  --versiune 20261221120000 --tinta-db postgres --tinta-sistem <SIS> --tinta-host <H> --tinta-port <P> --user <U> \
  --plafon-tranzactie-ms 2000 --amprenta-globala <GLOBAL din citire_ziua_20261221a.txt> \
  --diferente-globale supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv
```

## 11. Probe

| Probă | Unde | Cine |
|---|---|---|
| Blocul + pașii pe PGlite: garda; paritate citire ↔ runner; independența de sesiune; etichete unice; temporare / date / nextval / ANALYZE fără efect; **o schimbare minimă pe fiecare familie** (inclusiv obiecte noi în `pg_catalog` — funcție, tabel, operator — prinse de familiile lor; `sistem_initdb`: `quote_nullable … STRICT`; `acl_sistem`: GRANT / REVOKE pe funcții, relații, coloane, tipuri, schema de sistem, tabelul TOAST al unui catalog) + **mutantul** fiecărei familii; **r3:** contraexemplele recenzentului (auxiliar din `pg_catalog` cu DEFAULT schimbat și cu STRICT: poarta își schimbă rezultatul ⇒ GLOBAL diferă, familia `functie`), câte o schimbare minimă pe un tabel, o coloană, un tip și un operator create în `pg_catalog` (familiile lor), **mutantul perimetrului** (fără ramura „creat după initdb” ⇒ nimic prins), plasa pe `quote_nullable … STRICT` (poarta `false → true`, familia `sistem_initdb`) + mutantul plasei fără STRICT, volatilitate / DEFINER / `proconfig` / proprietar pe funcții de la initdb, limita declarată (ALTER pe o relație de la initdb nevăzut); secretele nu apar; contraexemplul vederii; manifestul scris de mână = diferența reală + detaliile (md5(detaliu) = amprenta) + contextul antetului; drumul bun; manifest cu rând lipsă / în plus / altă amprentă / altă operație; DDL nedeclarat; **regula DEFINER** (contraexemplul `pg_temp, public` chiar funcționează; fără `pg_temp` / dublu / `""`; `"$user"`; schemă inexistentă; CREATE direct / prin PUBLIC / prin apartenență; nume între ghilimele; `public, pg_temp` legitim; `--rol-de-incredere`; acceptarea cu md5 corect / greșit / după schimbarea căii / pentru funcție sigură, din afara lanțului, ne-DEFINER, inexistentă) cu **mutant pe fiecare regulă**; **grantorul** pe tabel și pe coloană (+ mutantul fără grantor); OWNED BY (+ mutant); obiectele mari (permutarea ACL); timpi. Nu se pot rula aici: o versiune minoră nouă (`server_version_num`), etichetele de securitate (fără furnizor) | `node scripts/pglite/test_amprenta_globala_local.mjs` | rulat la livrare (PASS) |
| Comparatorul de liste: fără opțiuni, `--manifest`, `--recitire`, intrări invalide, eticheta cu TAB; mutant pe fiecare regulă; **r3:** două fotografii care diferă doar prin `MOMENT` ⇒ 0 (mutantul cu `MOMENT` în partea revizuită ⇒ 6), și secțiunea diferă ⇒ 6, `MOMENT` lipsă / dublu / neînlocuit ⇒ 2; citirea reală cu un psql simulat (momente de lungimi diferite) ⇒ secțiunea cu marcajul, `--recitire` 0; mutantul citirii fără înlocuire ⇒ refuz | `bash scripts/test_l15_compara_liste.sh` (doar bash; rulat și de vitest) | CI + livrare |
| Forma runnerului fără PostgreSQL: argumente, `--aprobare`, mesajul unic cu `--l15`, forma fără plafon, `--genereaza-in`, fără opțiuni | `bash scripts/test_livrare_l15_forma.sh` | coordonatorul (cere python3) |
| Paritatea căii vechi cu main: aceleași fișiere generate, octet cu octet, cu și fără plafon, cu `--aprobare` | `bash scripts/test_livrare_l15_paritate.sh [<ref>]` | coordonatorul (cere python3) |
| PostgreSQL 17 real: (a) contraexemplul vederii, (b) DDL concurent cu barieră (cu și fără plafon) + control, (c) manifest greșit, (d) drumul bun, (e) fără opțiuni, (f) timpi rece / cald, (g) `--compara-cu`, (h) `--detalii`, (i) DEFINER nesigur / acceptat, (j) grantorul prin runner, **(k) r3: două citiri reale consecutive cu `--amprente-migrare scripts/meteo_xweather_amprente.sql` ⇒ `--recitire` 0** | `bash scripts/test_livrare_l15_v2.sh <slot>` (WSL, ca postgres) | coordonatorul pe clonă |
| Regresiile runnerului (neschimbate) | `test_livrare_forma_fin.sh`, `test_livrare_plafon.sh`, `test_portal_e1.sh` (PASS în mediul coordonatorului); `test_sec_rsvti.sh` = regresie **PARȚIALĂ** în mediul coordonatorului: verificarea statică a fluxurilor CI din harness e depășită pe main, iar pasul cu ceasul fix cere o bibliotecă lipsă (n-a rulat) — nu e PASS integral; problemele sunt preexistente, nereparate aici | coordonatorul |
| Static (CI): bloc ASCII fără backslash, marcaje v2, familii = document, **nicio serializare ACL fără grantor**, perimetrul de sistem, regula DEFINER în citire, opțiunile manifestului, marcajele de mutant, L15 în LECTII | `src/amprentaGlobalaL15v2.test.js` (vitest) | CI |
