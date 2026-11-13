# Livrarea migrării 20261220a — SMS: numere de serviciu (PR #1084)

**Stare: NEAPLICATĂ.** Pe producție se aplică **DOAR prin runnerul cu amprenta GLOBALĂ L15 v2**, cu plafonul de 2000 ms, după review
și „da”-ul owner-ului. **Aplicarea fără amprenta globală NU e acceptată.** `20261220a` așteaptă ca PR-ul runnerului L15 v2 să fie pe
`main`. Comenzile exacte (opțiuni, fișiere, coduri de ieșire) stau în `docs/LIVRARE_L15_V2.md` (PR-ul runnerului, în lucru — opțiunile
se pot schimba); aici sunt doar pașii acestei migrări și ce e specific ei. Nu se copiază comenzile de acolo.

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
