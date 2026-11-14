# Livrarea migrării 20261220a — SMS: numere de serviciu (PR #1084)

**Stare: NEAPLICATĂ.** Regula migrării: pe producție se aplică **DOAR prin runnerul cu amprenta GLOBALĂ L15 v2**, cu plafonul de
2000 ms, după review și „da”-ul owner-ului. **Aplicarea fără amprenta globală NU e acceptată.**

**Excepție — o singură dată, doar pentru acest artefact: derogarea din secțiunea 7 („calea A”, 14.11.2026).** Pe producție calculul
amprentei globale nu încape în plafonul de 2000 ms cerut de migrare (măsurat, secțiunea 7.1). Verificarea globală se face de aceea
**în afara tranzacției**, cu două citiri lipite de aplicare, iar migrarea rulează prin același runner, pe calea simplă cu plafon.
Secțiunea 7 înlocuiește pașii 5–6 din secțiunea 4; pașii 1–4, 7 și 8 rămân. Nu e o relaxare generală a L15 v2.

Runnerul L15 v2 e pe `main`; baseline-ul citit pe producție, acceptările și manifestul sunt în acest PR (pașii 1–4, secțiunea 6).
Comenzile exacte (opțiuni, fișiere, coduri de ieșire) stau în `docs/LIVRARE_L15_V2.md`; aici sunt doar pașii acestei migrări și ce e
specific ei. Nu se copiază comenzile de acolo.

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
   *(Pentru acest artefact: înlocuit de secțiunea 7 — pe producție proba în această formă nu încape în plafon.)*
6. **Aplicarea pe producție prin runner**, cu GLOBAL verificat înainte și după, în aceeași tranzacție cu migrarea; după „da”-ul owner-ului.
   *(Pentru acest artefact: înlocuit de secțiunea 7 — verificarea globală în afara tranzacției, cu două citiri lipite de aplicare.)*
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
    cu ROLLBACK pe țintă nu trimite notificarea (efectul ei asupra traficului rămâne așteptarea pe lock-uri), iar aplicarea are exact
    efectul cerut oricum de pasul 7.
- **Schimbat după citire ⇒ refuz la «înainte»**, în trei variante, de fiecare dată cu amprenta globală, înaintea verificării proprii a
  migrării și fără nicio schimbare: auxiliarul porții owner (`fn_sms_e_owner()`) cu alt corp; o funcție nouă, din afara lanțului (pe care
  migrarea singură n-ar vedea-o); un drept schimbat pe un tabel din afara lanțului. După refacere, amprenta globală e cea dinainte.

Pentru proba cu ROLLBACK pe țintă (pasul 5) rămân criteriile din `docs/LIVRARE_L15_V2.md` (același punct de acces și rol ca la
livrare, recitirea din ziua livrării cu clasificarea diferențelor, mai multe probe aprobate — inclusiv prima —, toate `IDENTIC`, garda
finală cel mult 1,5 s, verificarea „înainte” raportată separat). În plus, pentru această migrare, în jurnalul livrării se trec: momentul
la care au fost luate lock-urile și cât au fost ținute (până la ROLLBACK / COMMIT), numărul de încercări și verificarea că proba nu a
lăsat nimic în urmă (tabelul nou nu există, istoricul neschimbat, amprenta globală de după = cea dinainte). O singură probă `IDENTIC` nu
ajunge pentru aplicare: se cer trei probe consecutive acceptate (prima rămâne în jurnal așa cum a ieșit), apoi o recitire comparată
și clasificată imediat înaintea aplicării. La un refuz „BUGET_LOCK”: se confirmă că tranzacția s-a încheiat și că n-a rămas nimic, se
caută cine ținea tabelele, se reia manual după eliberare și seria de trei reîncepe; refuzurile repetate cer altă fereastră, nu bugete
mai mari.

**Cum ajung lock-urile în jurnal.** Proba „diferența = manifestul” tipărește doar rândurile runnerului, nu și mesajele migrării
(momentul luării lock-urilor și numărul de încercări). De aceea, la proba pe țintă, coordonatorul păstrează ieșirea întreagă a sesiunii
și pornește alături un observator doar-citire al lock-urilor, legat de sesiunea livrării — nu de orice sesiune care ține același
lock — (când au fost văzute acordate și când au dispărut); un jurnal incomplet = probă neacceptată. Probat pe clonă:
lock-urile luate la ≈ 0,48 s de la BEGIN, o încercare, ținute ≈ 0,48 s până la ROLLBACK; la aplicare ≈ 0,44 s până la COMMIT.

## 7. Derogarea punctuală de la L15 v2 (14.11.2026): verificarea globală în afara tranzacției („calea A”)

**Ce derogă.** Antetul migrării și începutul acestui document spun „Aplicarea fără amprenta GLOBALĂ NU e acceptată”. Secțiunea de
față derogă **explicit** de la această interdicție, **doar pentru acest artefact** (migrarea cu sha256 `a290bf3c…94d5`, manifestul cu
sha256 `c1709506…6123`), cu acordul owner-ului și cu verdictul recenzentului (7.7). Fișierul migrării rămâne neschimbat (e fixat
prin sha256; un comentariu schimbat ar cere baseline, teste și review de la capăt). **Nu e o relaxare generală a L15 v2**: pentru
orice altă migrare regula rămâne, iar unealta se reface separat (7.8).

### 7.1 De ce: ce s-a măsurat pe producție
- Prima probă cu ROLLBACK pe producție, pe calea L15 v2, s-a oprit sigur: calculul amprentei globale „înainte” a durat 1.731 ms și
  s-a încheiat la 1.927 ms de la BEGIN; verificarea „înainte” a migrării a fost oprită de plafon. Nimic comis: observatorul nu a
  văzut niciun lock luat, tabelul nou nu există, istoricul are 0 rânduri, amprenta globală recitită e cea dinainte.
- Măsurat apoi doar-citire: calculul amprentei globale durează pe producție 2,26–2,34 s din unealta de citire (șase rulări, sesiune
  nouă și aceeași sesiune, fără diferență rece / cald) și ~1,7 s în tranzacție; pe clone, 0,4–0,5 s. Interogarea de amprente a
  migrării (cele 53 de rânduri): 146–167 ms pe producție, 35–40 ms pe clonă. Tot corpul migrării pe clonă: ~100 ms.
- Calea L15 v2 ar cere ~1,7 s („înainte”) + corpul + ~1,7 s („după”), iar migrarea cere exact plafonul `2000/session`. Nu încape.
- Lecția: timpul amprentei globale se măsoară **doar-citire pe țintă** înaintea oricărei probe. Pe clone a fost de ~4 ori mai mic.

### 7.2 Ce se face în loc
Aceeași migrare, același commit, același runner — pe calea simplă cu plafon (fără amprenta globală în tranzacție). În tranzacție rămân
**toate** verificările migrării: garda de start, cele 53 de rânduri de baseline „înainte” și „după”, lock-urile cu buget,
postcondițiile obiectelor noi, înregistrarea în istoric cu sha256, garda de timp; după COMMIT, controlul permanent al funcțiilor expuse.
Verificarea globală se mută în afară:
1. **Citirea din ziua livrării** (doar citire, o singură fotografie), comparată cu citirea revizuită: partea revizuită identică, iar
   **fiecare** rând diferit din lista globală e explicat în jurnal (lista clasificată).
2. **Fereastra**: fără alte livrări și fără DDL administrativ; fără trimiteri de SMS din ecranul vechi, fără administrarea numerelor și
   fără apeluri noi până la închiderea verificărilor (și pe durata unei eventuale reveniri). Înaintea probei și a aplicării, o
   verificare doar-citire refuză pornirea dacă există activitate SMS în ultimele 15 minute sau o altă sesiune pe tabelele SMS.
3. **O probă cu ROLLBACK pe producție, pe calea simplă** (o singură dată; cerută de recenzent): exact textul livrării (fișierele
   runnerului, aceeași bibliotecă a formei „un mesaj”), cu ROLLBACK în locul COMMIT-ului. Criterii: garda finală cel mult 1.500 ms;
   baseline-ul și postcondițiile trecute; lock-urile văzute de observator, cu apariție și dispariție; ieșirea întreagă păstrată; după
   ROLLBACK istoricul e gol și o citire nouă e identică rând cu rând cu cea dinainte. Proba nu dovedește manifestul unei aplicări
   comise. La eșec: stop, reconciliere, analiză — fără reîncercare automată.
4. **Aplicarea**, în aceeași fereastră, automat și cu refuz la orice abatere:
   - R1 = citire proaspătă; partea revizuită trebuie să fie identică, iar lista diferențelor față de citirea revizuită trebuie să fie
     **octet cu octet** cea clasificată la pasul 1 — altfel nu se trimite nimic;
   - runnerul, pe calea simplă cu plafonul de 2000 ms, cu observatorul de lock-uri alături;
   - la COMIS: R2 = citire proaspătă, pornită de la rădăcinile stării noi (crearea lotului are 5 parametri), și **verificatorul**:
     diferența dintre R1 și R2 trebuie să fie **exact mulțimea** din manifest — aceeași cheie (familie + etichetă), aceeași operație,
     aceeași amprentă finală; „schimbat” înseamnă amprente efectiv diferite. Numărul singur (32) nu ajunge.
5. **Citirile se validează întregi** înaintea comparației: ținta (baza și identificatorul sistemului), fotografia unică, validarea
   uneltei, cheile unice, numărul rândurilor și amprentele globală și pe familii **recalculate din rânduri**; contextul (versiunea
   serverului, rolul) egal între cele două; R2 mai nouă decât R1. O citire trunchiată, alterată sau de pe alt sistem e refuzată.
6. **Ce înseamnă fiecare rezultat:** neaplicat (confirmat de runner) = stop, nimic altceva. R2 sau verificatorul eșuate după COMMIT =
   **„aplicat, neverificat”**: migrarea NU se reia, se recitește manual. „Deja înregistrat” = această rulare nu a aplicat nimic; cele
   două fotografii nu dovedesc o aplicare. Diferență în plus (de pildă partiția zilnică a platformei apărută în fereastră) =
   verificatorul rămâne pe eroare; clasificarea și acceptarea se consemnează explicit, de om.
7. După verificarea curată: pașii 7 și 8 din secțiunea 4 (notificarea serviciului REST, probele REST, apoi merge-ul).

### 7.3 Ce se pierde față de L15 v2 (riscuri acceptate)
- **Refuzul atomic.** O diferență nedeclarată se vede după COMMIT (fereastra R1 → R2: zeci de secunde), nu înaintea lui; remediul
  devine revenirea, nu ROLLBACK-ul.
- **Atribuirea sub concurență.** Un DDL străin din fereastră apare ca diferență nedeclarată (se oprește și se clasifică).
- **Schimbarea temporară.** Ceva introdus și anulat între R1 și R2 nu se vede; egalitatea finală nu dovedește că n-a existat.
- **Revenirea repară doar ce prevede ea.** Nu anulează un drept dat de altcineva, efecte externe sau operații SMS deja executate și
  poate refuza dacă starea obiectelor a derivat. În acest caz nu se forțează și nu se șterge nimic: se raportează owner-ului.

Ce rămâne: migrarea e un script determinist; pe clonă (aceeași versiune de server, aceleași triggere de eveniment ale platformei,
aceleași 53 de rânduri de baseline) diferența globală a fost de fiecare dată exact manifestul, iar pe producție aceleași 53 de rânduri
sunt cerute de migrare în tranzacție, înainte și după.

### 7.4 Repetiția pe clonă (14.11.2026), cu uneltele finale
- **Proba simplă cu ROLLBACK:** garda finală la ≈ 0,1 s, lock-urile ținute ≈ 0,05 s, istoric gol, citirea de după identică.
- **Aplicarea:** COMIS, diferența R1 → R2 = exact manifestul (32 de rânduri); la fel după revenire și reaplicare.
- **Revenirea:** citirea de după = citirea dinaintea aplicării; istoricul revenirii rămâne consemnat (pe clonă se șterge doar ca
  migrarea să poată fi reaplicată).
- **Mutanții verificatorului** (20 din 20 refuzați cu codul așteptat): un rând scos din manifest (nedeclarat), un rând inventat
  (absent), amprenta finală greșită și operația greșită (altfel), „schimbat” pe o cheie neschimbată, cheie dublă în manifest;
  citire fără un rând, tăiată, fără rândul fotografiei, fără rândul validării sau cu validarea eșuată, cu o amprentă alterată de
  mână, cu o cheie dublă, de pe alt sistem, cu alt rol, cu o linie necunoscută; ordinea inversată; o citire validă cu un obiect
  străin în plus și una cu un obiect existent schimbat de altcineva.
- **Porțile dinaintea tranzacției:** obiecte apărute după clasificare ⇒ refuz, nimic trimis; o altă sesiune pe tabelele SMS ⇒ refuz
  înaintea citirii, nimic trimis.
- **Mutantul viu** (limitele S39 și S44 din secțiunea 1): o funcție auxiliară, o vedere și un drept pe alt tabel, schimbate între R1
  și tranzacție. Migrarea singură comite (cum e documentat), iar verificatorul le numește pe toate trei ca nedeclarate.
- **Găsit la repetiție și corectat înaintea producției:** citirea de după aplicare pornea de la rădăcina veche (crearea lotului cu 4
  parametri, ștearsă de migrare), deci unealta de citire o refuza, iar aplicarea rămânea „aplicat, neverificat”. Citirea de după
  pornește acum de la varianta cu 5 parametri și de la cele cinci funcții noi.

### 7.5 Uneltele coordonatorului (în afara repo-ului, fixate prin sha256)
Nu fac parte din livrare și nu rulează în tranzacție; se verifică înaintea producției față de aceste amprente:

| Unealtă | sha256 |
|---|---|
| wrapperul căii A (citire / probă / aplicare, cu jurnal) | `fbde4c8a198f92c6f43904700847387f2c0232d0c3d372c38619df8d35222dcf` |
| verificatorul celor două citiri față de manifest | `73aef96b95b246668da1a18be1c61e2c3d1e32467ad14ec50dd14059de9acb82` |
| observatorul doar-citire al lock-urilor | `1a2dcb15b5c0ae3e72a97c59d18b5970255ae93cb725264b437b32da97473da0` |
| scriptul de citire al migrării (rădăcinile „înainte” / „după”) | `abe19af34043cee3587f2c13be33efbb9d920bd088fa2bc36139b228341a2c0f` |
| verificarea ferestrei (doar citire) | `158a9e8e90cb91b4c57e8d1e4dca5ccfb782725ed6f8d892d71fbad7c9da3ae6` |

Uneltele de livrare din repo folosite de ele (runnerul, biblioteca formei „un mesaj”, unealta de citire, comparatorul, validatorul,
controlul funcțiilor expuse) trebuie să fie identice cu cele revizuite în PR-ul runnerului L15 v2; wrapperul refuză altfel.

### 7.6 Jurnalul livrării
Pentru fiecare rulare (citire, probă, aplicare): fișierele celor două citiri cu sha256-urile lor, lista clasificată, ieșirea întreagă
a sesiunii, observatorul, rezultatul verificatorului și lista diferențelor observate. La o diferență în plus: clasificarea fiecărui
rând și decizia owner-ului.

### 7.7 Acordul și verdictul
- **Owner-ul** a ales calea A pe 14.11.2026. Proba și aplicarea pe producție se fac doar cu „da”-ul lui explicit, pe manual.
- **Recenzentul**: derogarea acceptată exclusiv pentru acest artefact (commitul și cele două sha256 de mai sus), cu condițiile din
  7.2–7.3: fereastra fără altă activitate, o probă simplă cu ROLLBACK pe producție, repetiția pe clonă cu mutanții de mai sus,
  uneltele finale inspectate și fixate prin sha256.

### 7.8 În afara acestei derogări
`20261221a` (vremea zilei) are aceeași problemă de timp și rămâne neaplicată până la refacerea uneltei. Refacerea se proiectează și
se revizuiește separat: un filtru simplu pe rândurile de catalog scrise de tranzacția curentă nu poate înlocui amprenta globală
(rândurile șterse nu se mai văd, subtranzacțiile au identificatori proprii, deriva de dinainte a obiectelor neatinse rămâne nevăzută).
