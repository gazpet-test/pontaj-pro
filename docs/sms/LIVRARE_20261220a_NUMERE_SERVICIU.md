# Livrarea migrării 20261220a — SMS: numere de serviciu (PR #1084)

**Stare: NEAPLICATĂ.** Pe producție se aplică **DOAR prin runnerul cu amprenta GLOBALĂ L15 v2**, cu plafonul de 2000 ms, după review
și „da”-ul owner-ului. **Aplicarea fără amprenta globală NU e acceptată.** Runnerul L15 v2 e pe
`main`; baseline-ul citit pe producție, acceptările și manifestul sunt în acest PR (pașii 1–4, secțiunea 6). Rămân pașii 5–8. Comenzile
exacte (opțiuni, fișiere, coduri de ieșire) stau în `docs/LIVRARE_L15_V2.md`; aici sunt doar pașii acestei migrări și ce e specific ei.
Nu se copiază comenzile de acolo.

## 1. Cine refuză ce

| Ce | Unde | Cum |
|---|---|---|
| Baseline necompletat / invalid / fără funcțiile schimbate sau FOLOSITE | migrarea (`amp_verifica`) | refuz |
| Starea de acces (închiderea calculată + tabelele) ≠ baseline, ÎNAINTE și DUPĂ (excepțiile „după”: cele trei din antet) | migrarea | refuz |
| Funcție SECURITY DEFINER din lanț **fără** `search_path` propriu | migrarea | refuz — **plasă minimă** (vezi 3) |
| Funcție din lanț într-un **limbaj neanalizabil** (altul decât sql / plpgsql; internal / c = frunze) | migrarea | refuz |
| **SQL dinamic** (`EXECUTE`) în corpul unei funcții din lanț | scriptul de amprente, secțiunea 2 | **SEMNAL** (r5), acceptat nominal |
| Nume din corpurile noi potrivite cu funcții din afara listei FOLOSITE (cu schema) | scriptul, secțiunea 2 | semnal |
| Vederi citite de lanț; funcții în alt limbaj decât sql / plpgsql | scriptul, secțiunea 2 | semnal |
| Orice schimbare de catalog între citire și aplicare (inclusiv ce cheamă o vedere, ținta unui SQL dinamic, un auxiliar al unei porți) | **runnerul**, amprenta GLOBALĂ | refuz la „înainte” |
| Orice diferență nedeclarată după migrare (față de manifestul `.l15.tsv`) | runnerul | refuz la „după” |

**Regula r5 (review r4, L20).** Migrarea NU mai refuză pe cuvântul `EXECUTE`: căutarea era lexicală și prindea și comentariile (un
`-- EXECUTE …` în poarta owner, cu baseline-ul regenerat corect, respingea migrarea, deși poarta nu se schimbase). SQL-ul dinamic din
lanț e **semnal** în `scripts/sms_numere_serviciu_amprente.sql` (secțiunea 2: `semnal_sql_dinamic_in_lant` + `sql_dinamic_care`, fiecare
funcție cu schema și semnătura). Semnalul e o **supra-aproximare** (prinde și comentariile / textul): un om îl examinează.

**Limitele migrării singure (teste documentate, nu defecte ascunse):** S39 — poarta owner cheamă printr-un `EXECUTE` un auxiliar pe care
închiderea nu-l vede; auxiliarul schimbat după citire ⇒ migrarea singură acceptă. S44 — același lucru printr-o vedere. Ambele le
refuză **runnerul**, la „înainte”, prin amprenta GLOBALĂ. Regula „auxiliarul unei porți schimbat după citire = refuz” e deci **a
runnerului**, nu a migrării; proba ei pe PostgreSQL 17 e pasul 4 de mai jos (al coordonatorului), **nu** un test PGlite al acestui PR.

## 2. Rădăcinile porților (pentru `--radacina` la citire)

Pornirea închiderii din script (secțiunea 1, sursa `pornire`), fiecare cu schema:

- `public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)` (varianta cu 4 parametri; cea cu 5 nu există înainte de aplicare)
- `public.fn_sms_lot_destinatari(uuid)`, `public.fn_sms_angajati_lista()`
- `auth.uid()`, `public.fn_sms_cere_nivel()`, `public.fn_sms_cere_owner()`, `public.fn_sms_lot_acces(uuid,text,public.sms_loturi,boolean)`
- `public.fn_sms_tel_normalizat(text)`, `public.fn_sms_text_valid(text)`, `public.fn_sms_text_verifica(text)`
- `public.fn_sms_test_coada(uuid)`, `public.fn_sms_test_coada_cere(uuid,integer)`, `public.fn_sms_test_coada_lock(uuid,boolean)`, `public.fn_sms_test_coada_max()`

plus funcțiile din politicile și triggerele tabelelor `sms_loturi` / `sms_mesaje`, așa cum le arată secțiunea 1 a scriptului în citirea
respectivă (după migrările din repo: `public.fn_sms_e_owner()`, `public.fn_sms_loturi_reguli()`, `public.fn_sms_mesaje_reguli()`). Dacă
secțiunea 1 arată alte funcții de politici / triggere, intră și ele.

**Forma rădăcinii la citire.** Unealta de citire primește rădăcina fără paranteze drepte, deci tipurile tablou se scriu cu numele lor
interne: crearea lotului se dă ca `fn_sms_lot_intern_creeaza(text,_text,_int4,boolean)` (cu schema în față). E aceeași funcție —
în ieșire apare cu semnătura obișnuită, `text[]` / `integer[]`.

## 3. Regula DEFINER (rezolvarea sigură a numelor)

Refuzul din migrare („DEFINER din lanț fără `search_path` propriu”) e doar o plasă minimă: **„are `search_path` propriu” NU dovedește
că numele se rezolvă sigur.** Pentru fiecare funcție SECURITY DEFINER din lanț, citirea coordonatorului aplică regula DEFINER din
`docs/LIVRARE_L15_V2.md`: cale proprie, `pg_temp` prezent explicit și **ULTIMUL**, nicio schemă din cale cu drept CREATE pentru roluri din
afara celor de încredere. O funcție `nesigura` = refuz, cu excepția acceptării explicite legate de md5-ul corpului, consemnată în PR-ul
de baseline.

## 4. Pașii coordonatorului (în ordine)

1. **Citirea pe producție, într-o SINGURĂ fotografie.** Scriptul de amprente al migrării + amprenta GLOBALĂ + semnalele pe rădăcinile
   porților, în aceeași tranzacție: `amprenta_globala_citire.sh` cu `--amprente-migrare scripts/sms_numere_serviciu_amprente.sql` și
   `--radacina …` pentru fiecare rădăcină din secțiunea 2 (restul opțiunilor: `docs/LIVRARE_L15_V2.md`). **Nu** se rulează scriptul de
   amprente separat: două citiri = două momente (un DDL între ele dă două baseline-uri din stări diferite). Fără DDL concurent.
   Din ieșire: secțiunea 2 a scriptului cu `refuz_definer_fara_search_path = 0`, `refuz_limbaj_neanalizabil = 0`, `folosite_lipsa = 0`;
   secțiunea 3 toate `t`; `linie_baseline` (secțiunea 1) pentru blocul BASELINE al migrării.
2. **PR-ul de baseline: acceptarea NOMINALĂ a semnalelor.** Blocul BASELINE completat (linie cu linie, în ordinea afișată) și o linie
   de acceptare pentru fiecare semnal, pe nume:
   - funcțiile omonime din afara listei FOLOSITE (`nume_care`, cu schema): de ce nu sunt apelate;
   - vederile citite de lanț (`vederi_care`) și auxiliarele lor (ce funcții cheamă fiecare vedere);
   - SQL-ul dinamic (`sql_dinamic_care`) și **țintele lui** (ce poate executa fiecare `EXECUTE`; un comentariu se consemnează ca atare);
   - funcțiile în alt limbaj (`limbaj_care`);
   - semnalele citirii L15 v2 (`LANT`, `INCREDERE`, DEFINER acceptate cu md5).
   Pentru fiecare se examinează: corpurile, proprietarii, drepturile (ACL), politicile, triggerele și configurația citită de porți.
3. **Manifestul** `supabase/migrations/20261220a_sms_numere_serviciu.l15.tsv`, generat pe o clonă **comparabilă** cu producția (verificarea
   de comparabilitate din `docs/LIVRARE_L15_V2.md`), cu migrarea care conține baseline-ul de la pasul 2; revizuit pe obiecte și pe
   valorile finale (detaliile canonice), nu doar pe hash-uri.
4. **Pe clonă, cu runnerul nou:** aplicare → revenire → reaplicare (plafon 2000 ms); proba cu două sesiuni
   (`scripts/sms_numere_serviciu_concurenta.mjs`, normal → `C1: OK`; `--mutant fara_lock` → `mutant PRINS`); proba **„auxiliarul unei
   porți schimbat după citire ⇒ refuz la «înainte»”** (ex.: o funcție chemată de poarta owner, schimbată după citire — runnerul trebuie
   să refuze cu amprenta globală înainte de orice schimbare).
5. **Proba cu ROLLBACK pe țintă**: manifestul obținut pe țintă = cel din repo (identic), timpul sub plafonul de 2000 ms cerut de migrare.
6. **Aplicarea pe producție prin runner**, cu GLOBAL verificat înainte și după, în aceeași tranzacție cu migrarea; după „da”-ul owner-ului.
7. După COMMIT: `NOTIFY pgrst, 'reload schema';`. Apoi probele REST cu un JWT real de cont de test, doar previzualizare: apelul VECHI
   `fn_sms_lot_intern_creeaza` cu 4 parametri și apelul NOU cu 5 (ambele 200, nimic creat); `p_numere_serviciu: [0]` → **HTTP 400 și
   SQLSTATE 22023**; `fn_sms_numere_serviciu_lista` → `{total, numere}`.
8. **Merge** (UI). Până atunci UI-ul publicat merge neschimbat.

## 5. Ce dovedesc testele acestui PR (și ce nu)

- `node scripts/pglite/test_sms_numere_serviciu_local.mjs` (PGlite = PostgreSQL 18 în memorie, fără concurență reală): comportamentul
  T1–T19, mutanții M1–M25, scenariile S1–S50 (refuzurile migrării și ale revenirii, semnalele scriptului, limitele S39 / S44), mutanții
  porții L1–L6.
- `src/smsNumereServiciuAmprente.test.js`: forma statică (blocurile identice, regulile din verificare, semnalele, antetul).
- **Nu** dovedesc: comportamentul runnerului L15 v2 (amprenta globală), PostgreSQL 17, concurența reală, PostgREST real — pașii 3–7.

## 6. Baseline-ul: citirea pe producție (13.11.2026), acceptările și probele pe clonă (pașii 1–4)

Ieșirile întregi (lista catalogului, lanțul, coloana „detaliu”, detaliile manifestului, jurnalele probelor) stau în jurnalul livrării, la
coordonator, și se dau recenzentului; nu se versionează. Aici e ce s-a constatat și ce s-a acceptat. Amprenta GLOBALĂ a producției nu se
scrie în repo (se schimbă zilnic): cea folosită la aplicare e a recitirii din ziua livrării.

### 6.1 Citirea (pasul 1)

O singură fotografie, doar citire, cu uneltele de pe `main`, ca rolul de livrare, pe PostgreSQL 17.6.

- Secțiunea 1: **53 de rânduri** = 41 de funcții + 12 rânduri ale tabelelor `sms_loturi` / `sms_mesaje` (drepturi, drepturi pe coloane,
  politici, RLS, secvențe, triggere). Sunt în blocul BASELINE, în ordinea afișată.
- Secțiunea 2: `refuz_definer_fara_search_path = 0`, `refuz_limbaj_neanalizabil = 0`, `folosite_lipsa = 0`. Secțiunea 3: toate `t`.
- Lanțul citirii: aceleași 41 de funcții; 25 sunt SECURITY DEFINER, toate cu `cale=sigura` (calea proprie `public, pg_temp`). Rolurile cu
  drept de creare în `public` (rândurile `INCREDERE`): proprietarul schemei, rolul de livrare și superuserul platformei — niciun rol al
  aplicației.

### 6.2 Acceptările nominale (pasul 2)

**SEMNALE acceptate: EXECUTE dinamic 0 · vederi 0 · alt limbaj 4 (cele două agregate `sum` ale extensiei de vectori și funcțiile lor de
tranziție) · DEFINER acceptate 0.**

| Semnal | Ce arată citirea | Acceptarea |
|---|---|---|
| `nume_care` | niciunul | nimic de acceptat: corpurile noi nu potrivesc nicio funcție din afara listei FOLOSITE |
| `vederi_care` | niciuna | nimic de acceptat: lanțul nu citește vederi |
| `sql_dinamic_care` | niciuna | nimic de acceptat: niciun `EXECUTE` în corpurile lanțului, nici în comentarii |
| `limbaj_care` | `extensions.sum(extensions.vector)`, `extensions.sum(extensions.halfvec)` (agregate), `extensions.vector_add(…)`, `extensions.halfvec_add(…)` (C) | acceptate, vezi mai jos |
| „INVOKER fără search_path (de privit)” | `auth.uid()` și cele patru de mai sus | acceptate, vezi mai jos |

- **Cele patru funcții ale extensiei de vectori** intră în lanț DOAR lexical: `fn_sms_consum_la(timestamptz)` și
  `fn_sms_test_consum_zi_la(uuid, timestamptz)` adună segmentele mesajelor cu `sum(m.segmente)`, iar închiderea potrivește numele `sum` cu
  orice funcție `sum` din afara `pg_catalog` (supra-aproximarea declarată); funcțiile de tranziție vin după ele, prin dependențe. Nu sunt
  apelate și nu pot fi: `segmente` e număr întreg (apelul se rezolvă la `pg_catalog.sum`), iar schema `extensions` nu e în calea proprie a
  celor două funcții (`public, pg_temp`). Sunt frunze (agregat / C, fără corp de analizat), ale platformei, cu drepturile obișnuite ale
  extensiei. Stau în BASELINE: schimbarea oricăreia = refuz.
- **`auth.uid()`** e funcția platformei (SQL, INVOKER, fără cale proprie). Corpul cheamă doar funcții din `pg_catalog`; apelanții din lanț
  sunt SECURITY DEFINER cu calea `public, pg_temp`, în care `pg_catalog` se caută implicit primul. Stă în BASELINE (corp, proprietar, drepturi).
- **Drepturile, din coloana „detaliu”:** `authenticated` are EXECUTE doar pe `fn_sms_angajati_lista()`, `fn_sms_e_owner()`,
  `fn_sms_lot_destinatari(uuid)` și `fn_sms_lot_intern_creeaza(…)`; `service_role` doar pe `fn_sms_rezerva(…)` și pe cele două funcții de
  cheie ale Redărilor; restul funcțiilor aplicației din lanț le poate chema doar proprietarul. PUBLIC / `anon` nu au drept pe nicio funcție
  a aplicației din lanț. Tabelele `sms_loturi` / `sms_mesaje`: RLS pornit, câte o politică de citire pentru `authenticated` prin
  `fn_sms_e_owner()`, `authenticated` are doar SELECT, câte un trigger de reguli (BEFORE INSERT OR UPDATE OR DELETE), fără drepturi pe
  coloane, fără secvențe.

### 6.3 Manifestul (pasul 3)

`supabase/migrations/20261220a_sms_numere_serviciu.l15.tsv` — **32 de obiecte**, generat pe clonă cu migrarea din acest PR (antetul lui
poartă sha256-ul migrării; testul static le leagă). Revizuit pe detaliile canonice:

- tabelul nou `sms_numere_serviciu`: proprietarul = rolul de livrare, **drepturi doar pentru proprietar** (nimic pentru `anon` /
  `authenticated` / `service_role`, cu toate privilegiile implicite ale schemei), RLS pornit, **nicio politică**; 11 coloane; cheia
  primară; trei CHECK (denumire, notă, telefon în forma `+407` + 8 cifre); două indexuri unice parțiale (denumirea fără majuscule,
  telefonul — doar pe rândurile active); secvența identității (drepturi doar pentru proprietar); tipul rând și tipul tablou; triggerul
  de reguli;
- funcțiile noi (crearea lotului cu 5 parametri, lista, administrarea, salvarea, dezactivarea): SECURITY DEFINER, calea
  `public, pg_temp`, EXECUTE doar pentru `authenticated` și proprietar; funcția triggerului: doar proprietarul;
- ce NU e creare: funcția de creare cu 4 parametri (ștearsă), `fn_sms_lot_destinatari(uuid)` (schimbată, aceleași drepturi) și
  constrângerea CHECK a tipului de destinatar de pe `sms_mesaje` (lărgită cu `serviciu`).

### 6.4 Clona și probele (pasul 4)

Clona: PostgreSQL 17.6, aceeași versiune a extensiei de vectori și aceeași localizare a bazei ca producția, schema exportată din
producție, identități sintetice. Pe ea, **secțiunea scriptului de amprente, lanțul, semnalele și contextul sunt identice cu ale producției**
(diferă doar numărul de mesaje de scanat din secțiunea 3, o dată de conținut), iar plasa obiectelor de sistem e identică.

- Comparatorul clonă ↔ producție, cu manifestul: **`COMPARABIL`**. Liniile `DE_EXPLICAT` (27), nominal:
  - 15 privilegii implicite ale altor creatori — rolul de administrare al platformei în `cron`, `graphql`, `graphql_public`, `realtime` și
    rolul de administrare al autentificării în `auth` (câte trei: tabele, secvențe, funcții). Sunt ale platformei; migrarea creează totul
    direct, ca rolul de livrare, doar în `public`, și nu cheamă nicio funcție SECURITY DEFINER care creează obiecte;
  - 8 extensii — cinci există doar pe producție (`pg_cron`, `pg_net`, `supabase_vault`, `hypopg`, `index_advisor`: ale platformei, clona
    are funcții de înlocuire unde probele au nevoie), trei diferă doar prin proprietarul extensiei (`pgcrypto`, `uuid-ossp`,
    `pg_stat_statements`). Corpurile noi nu cheamă nicio funcție de extensie (`nume_care` gol);
  - 4 scheme care există doar pe producție (`cron`, `graphql`, `pgbouncer`, `realtime`): ale platformei, neatinse de migrare.
- Restul diferențelor dintre liste (nimic care să existe doar pe clonă), pe grupuri: obiectele schemelor platformei (`auth`, `storage`,
  `realtime`, `net`, `vault`, `cron`: tabele, coloane, constrângeri, politici, triggere, publicații — clona are doar ce le trebuie
  probelor), proprietarii și drepturile unor funcții de extensie, și 26 de constrângeri CHECK din `public` a căror expresie are altă
  formă după export / restaurare (intervale desfăcute, ȘI-uri aplatizate; comparația e pe amprente — echivalența expresiilor nu e
  dovedită de ea, doar faptul că sunt pe alte tabele). Niciuna nu e pe tabelele sau funcțiile migrării: rândurile `schimbat` / `sters`
  din manifest au aceeași amprentă pe clonă și pe producție.
- Proba „diferența obținută = manifestul” pe clonă: **`IDENTIC`**, nimic comis.
- Aplicare → revenire → reaplicare → revenire. **Aplicările**: prin runner, cu amprenta globală verificată înainte și după — de
  fiecare dată 32 de diferențe = manifestul. **Revenirile**: prin runner, cu plafon, fără amprenta globală (fișierul de revenire nu are
  manifest); că au readus catalogul la starea dinainte s-a verificat separat, prin recitire — după fiecare revenire amprenta globală a
  clonei e cea dinainte. Timp la aplicare, pe clonă: verificarea „înainte” ≈ 0,4 s, lock-urile luate la ≈ 0,45 s, garda finală ≈ 0,9 s
  din plafonul de 2 s. Clona are altă arhitectură și mai puține obiecte: cifrele NU spun cât durează pe producție (asta o arată pasul 5).
- Proba cu două sesiuni (limita de 100 de numere active, după aplicare): `C1: OK`; cu mutantul fără lock: `mutant PRINS`.
- **Lock-urile migrării** (`sms_loturi` în SHARE UPDATE EXCLUSIVE, `sms_mesaje` în ACCESS EXCLUSIVE — fără așteptare, cu reîncercări
  până la 1 s de la BEGIN), cu o a doua sesiune care ține un lock incompatibil:
  - ținut peste termen — un lock de tip DDL pe `sms_loturi`; un **cititor** pe `sms_mesaje` (un SELECT într-o tranzacție deschisă); un
    scriitor pe `sms_mesaje`: de fiecare dată refuz `55P03` („BUGET_LOCK”) la ≈ 1,0 s de la BEGIN, după 12 încercări, nimic aplicat;
  - eliberat înainte de termen (la ≈ 0,65 s) — cititorul de pe `sms_mesaje`, apoi lock-ul de pe `sms_loturi`: proba „diferența =
    manifestul” `IDENTIC`, garda la ≈ 1,1 s; aceeași situație prin runner: lock-urile luate la 0,67 s (5 încercări), aplicat, garda la ≈ 1,1 s;
  - un scriitor obișnuit pe `sms_loturi`, ținut tot timpul: migrarea NU e blocată (lock-ul ei pe loturi oprește doar DDL-ul) — `IDENTIC`.

  Cât ține migrarea lock-urile: de la luarea lor până la COMMIT (pe clonă ≈ 0,45 s). În acest interval citirile și scrierile pe
  `sms_mesaje` așteaptă; pe `sms_loturi` așteaptă doar DDL-ul.
- **Triggerele de eveniment ale platformei** — șase pe producție; pe clonă sunt aceleași, cu funcțiile lor identice (eveniment,
  etichete, stare, corp), iar probele de mai sus au rulat cu ele active:
  - patru pornesc doar la crearea / ștergerea unei EXTENSII (`issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`
    la CREATE EXTENSION; `issue_graphql_placeholder` la DROP EXTENSION). Migrarea nu creează și nu șterge extensii: nu pornesc;
  - două pornesc la orice comandă de schemă: `pgrst_ddl_watch` (la sfârșitul comenzii) și `pgrst_drop_watch` (la ștergeri). Funcțiile
    lor (ale platformei, INVOKER, cu calea goală) fac un singur lucru: `NOTIFY pgrst, 'reload schema'` pentru comenzile pe tabele,
    funcții, triggere, tipuri și comentarii, în afara obiectelor temporare. Nu scriu în catalog și nu ating tabele — diferența obținută
    rămâne exact manifestul;
  - efectul extern e doar notificarea către serviciul REST, care își reîncarcă schema. Notificarea e tranzacțională; verificat pe
    clonă, cu o sesiune care ascultă canalul: la proba cu ROLLBACK **nicio** notificare, la aplicare una, la revenire una. Deci proba
    cu ROLLBACK pe țintă nu are efect extern, iar aplicarea are exact efectul cerut oricum de pasul 7.
- **Schimbat după citire ⇒ refuz la «înainte»**, în trei variante, de fiecare dată cu amprenta globală, înaintea verificării proprii a
  migrării și fără nicio schimbare: auxiliarul porții owner (`fn_sms_e_owner()`) cu alt corp; o funcție nouă, din afara lanțului (pe care
  migrarea singură n-ar vedea-o); un drept schimbat pe un tabel din afara lanțului. După refacere, amprenta globală e cea dinainte.

Pentru proba cu ROLLBACK pe țintă (pasul 5) rămân criteriile din `docs/LIVRARE_L15_V2.md` (același punct de acces și rol ca la
livrare, recitirea din ziua livrării cu clasificarea diferențelor, mai multe probe aprobate — inclusiv prima —, toate `IDENTIC`, garda
finală cel mult 1,5 s, verificarea „înainte” raportată separat). În plus, pentru această migrare, în jurnalul livrării se trec: momentul
la care au fost luate lock-urile și cât au fost ținute (până la ROLLBACK / COMMIT), numărul de încercări și verificarea că proba nu a
lăsat nimic în urmă (tabelul nou nu există, istoricul neschimbat, amprenta globală de după = cea dinainte). O singură probă `IDENTIC` nu
ajunge pentru aplicare.
