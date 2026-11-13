# Livrarea migrării 20261221a — vremea zilei din Vaisala Xweather (tabelul pasului zilnic)

**Stare: NEAPLICATĂ.** Pe producție se aplică **DOAR prin runnerul cu amprenta GLOBALĂ L15 v2**, cu plafonul de 2000 ms, după review și
„da”-ul owner-ului. Comenzile exacte (opțiuni, fișiere, coduri de ieșire) stau în `docs/LIVRARE_L15_V2.md`; aici e doar ce e specific
acestei migrări. Aplicarea migrării e prima parte a treptei II din `docs/METEO_XWEATHER_COTA.md`; pornirea pasului zilnic
(`XW_ZILNIC_ACTIV=1`) e o decizie separată, legată de cotă.

Ieșirile întregi (lista catalogului, lanțul, coloana „detaliu”, detaliile manifestului, jurnalele probelor) stau în jurnalul livrării, la
coordonator, și se dau recenzentului; nu se versionează. Amprenta GLOBALĂ a producției nu se scrie în repo (se schimbă zilnic): cea
folosită la aplicare e a recitirii din ziua livrării.

## 1. Citirea pe producție (13.11.2026) și acceptările

O singură fotografie, doar citire, cu uneltele de pe `main`, ca rolul de livrare, pe PostgreSQL 17.6. Rădăcinile: `auth.uid()`,
`public.fn_raport_santier_drept(bigint)`, `public.fn_executie_proiect_permis(bigint, boolean)`.

- Scriptul de amprente: **7 rânduri** — funcțiile de drept ale predicatului `fn_meteo_vede_site` (cele trei rădăcini + cele patru funcții
  de acces la proiecte pe care le cheamă). Sunt cele din blocul BASELINE al migrării, neschimbat.
- Lanțul citirii: aceleași 7 funcții; 4 sunt SECURITY DEFINER, toate cu `cale=sigura` (calea proprie `public, pg_temp`). Rolurile cu drept
  de creare în `public`: proprietarul schemei, rolul de livrare și superuserul platformei — niciun rol al aplicației.

**SEMNALE acceptate: EXECUTE dinamic 0 · vederi 0 · alt limbaj 0 · DEFINER acceptate 0.** Nimic de acceptat pe nume. Singura funcție
„de privit” e `auth.uid()` — a platformei (SQL, INVOKER, fără cale proprie): corpul cheamă doar funcții din `pg_catalog`, iar apelanții
din lanț sunt SECURITY DEFINER cu calea `public, pg_temp`, în care `pg_catalog` se caută implicit primul. E în BASELINE (corp, proprietar,
drepturi): schimbarea ei = refuz.

## 2. Manifestul

`supabase/migrations/20261221a_meteo_xweather_zilnic.l15.tsv` — **108 de obiecte**, toate `creat` (migrarea nu schimbă și nu șterge nimic
existent), generat pe clonă cu migrarea din repo (antetul lui poartă sha256-ul migrării; testul static le leagă). Revizuit pe detaliile
canonice:

- tabelul `meteo_zilnic_xweather` (27 de coloane): proprietarul = rolul de livrare; `authenticated` are doar SELECT, `service_role` SELECT
  și INSERT, `anon` nimic; RLS pornit, o politică de citire pentru `authenticated` prin `fn_meteo_vede_site(site_id)`; cheia primară
  (șantier, zi, versiune); cheia străină spre `sites`; 32 de CHECK; trei triggere proprii (la inserare; „nemodificabil” la UPDATE / DELETE;
  „nemodificabil” la TRUNCATE) și cele două triggere interne ale cheii străine; tipul rând și tipul tablou;
- vederea `v_meteo_zilnic_xweather` (ultima versiune a fiecărei zile; 28 de coloane), cu `security_invoker=on`: `authenticated` și
  `service_role` doar SELECT; regula ei, tipul rând și tipul tablou;
- trei funcții: `fn_meteo_vede_site(bigint)` — SECURITY DEFINER, calea `public, pg_temp`, EXECUTE doar pentru `authenticated` și
  proprietar; cele două funcții de trigger — doar proprietarul;
- pe `sites`: doar cele două triggere interne ale cheii străine (de aceea migrarea ia lock pe `sites`); nimic altceva de pe tabel nu se
  schimbă.

Manifestul a fost generat de două ori, pe două clone construite diferit: aceleași 108 rânduri.

## 3. Clona și probele

Clona: PostgreSQL 17.6, aceleași extensii relevante și aceeași localizare a bazei ca producția, schema exportată din producție,
identități sintetice, cele șase triggere de eveniment ale platformei identice cu ale producției. Pe ea **secțiunea scriptului de amprente,
lanțul, semnalele și contextul sunt identice cu ale producției**, iar plasa obiectelor de sistem e identică.

- Comparatorul clonă ↔ producție, cu manifestul: **`COMPARABIL`**. Liniile `DE_EXPLICAT` (27), nominal:
  - 15 privilegii implicite ale altor creatori — rolul de administrare al platformei în `cron`, `graphql`, `graphql_public`, `realtime` și
    rolul de administrare al autentificării în `auth` (câte trei: tabele, secvențe, funcții). Sunt ale platformei; migrarea creează totul
    direct, ca rolul de livrare, doar în `public`, și nu cheamă nicio funcție SECURITY DEFINER care creează obiecte;
  - 8 extensii — cinci există doar pe producție (`pg_cron`, `pg_net`, `supabase_vault`, `hypopg`, `index_advisor`: ale platformei), trei
    diferă doar prin proprietarul extensiei (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`). Migrarea nu folosește nicio funcție de extensie;
  - 4 scheme care există doar pe producție (`cron`, `graphql`, `pgbouncer`, `realtime`): ale platformei, neatinse de migrare.
- Restul diferențelor dintre liste (nimic care să existe doar pe clonă): obiectele schemelor platformei (clona are doar ce le trebuie
  probelor), proprietarii și drepturile unor funcții de extensie, și 26 de constrângeri CHECK din `public` a căror expresie are altă
  formă după export / restaurare (comparația e pe amprente — echivalența expresiilor nu e dovedită de ea). Niciuna nu e pe tabelul
  `sites` sau pe funcțiile din lanț; toate rândurile manifestului sunt `creat` și lipsesc din ambele liste.
- Proba „diferența obținută = manifestul” pe clonă: **`IDENTIC`**, nimic comis.
- Aplicare → revenire → reaplicare → revenire. **Aplicările**: prin runner, cu amprenta globală verificată înainte și după — de fiecare
  dată 108 diferențe = manifestul. **Revenirile**: prin runner, cu plafon, fără amprenta globală (fișierul de revenire nu are manifest);
  că au readus catalogul la starea dinainte s-a verificat separat, prin recitire — după fiecare revenire amprenta globală a clonei e cea
  dinainte. Timp la aplicare, pe clonă: verificarea „înainte” ≈ 0,4 s, lock-ul luat la ≈ 0,42 s, garda finală ≈ 0,82 s din plafonul de
  2 s; o probă a avut garda la 1,34 s (calculul de după a durat 0,9 s). Clona are altă arhitectură și mai puține obiecte: cifrele NU spun
  cât durează pe producție.
- **Schimbat după citire ⇒ refuz la «înainte»**, cu amprenta globală, înaintea verificării proprii a migrării și fără nicio schimbare:
  o funcție nouă din afara lanțului; un drept schimbat pe un tabel din afara lanțului. După refacere, amprenta globală e cea dinainte.
- **Lock-ul migrării** (`sites` în SHARE ROW EXCLUSIVE — fără așteptare, cu reîncercări până la 1 s de la BEGIN), cu o a doua sesiune:
  - un scriitor pe `sites` sau un lock de tip DDL, ținute peste termen: refuz `55P03` („BUGET_LOCK”) la ≈ 1,0 s, după 13 încercări,
    nimic aplicat;
  - un cititor pe `sites`, ținut tot timpul: migrarea NU e blocată — `IDENTIC`;
  - un scriitor eliberat înainte de termen (la ≈ 0,65 s): proba `IDENTIC`, garda la ≈ 1,1 s; prin runner: lock-ul luat la 0,68 s
    (6 încercări), aplicat, garda la ≈ 1,1 s.

  Cât ține migrarea lock-ul: de la luarea lui până la COMMIT. Pe clonă sunt ≈ 0,4 s între mesajul de luare a lock-ului și garda finală
  — o aproximare, nu durata exactă până la COMMIT (pe aceea o dă, la proba pe țintă, observatorul de lock-uri). În acest interval
  scrierile pe `sites` așteaptă; citirile trec.
- **Triggerele de eveniment ale platformei** (șase): patru pornesc doar la crearea / ștergerea unei extensii — migrarea nu creează și nu
  șterge extensii; două (`pgrst_ddl_watch`, `pgrst_drop_watch`) pornesc la orice comandă de schemă și fac un singur lucru:
  `NOTIFY pgrst, 'reload schema'`. Nu scriu în catalog. Notificarea e tranzacțională; verificat pe clonă, cu o sesiune care ascultă
  canalul: la proba cu ROLLBACK nicio notificare, la aplicare una, la revenire una. Deci proba cu ROLLBACK pe țintă nu trimite
  notificarea către serviciul REST; efectul ei asupra traficului rămâne așteptarea scrierilor pe `sites` cât e ținut lock-ul.

## 4. Ce rămâne

Cu acordul owner-ului, după criteriile din `docs/LIVRARE_L15_V2.md`: recitirea din ziua livrării (comparată și clasificată), trei probe
consecutive cu ROLLBACK pe țintă — toate `IDENTIC`, garda finală cel mult 1,5 s, verificarea „înainte” raportată separat, lock-ul în
jurnal (momentul, încercările, durata; proba tipărește doar rândurile runnerului, deci se păstrează ieșirea întreagă a sesiunii și se
pornește un observator doar-citire al lock-ului, legat de sesiunea livrării, nu de orice sesiune care ține același lock; un jurnal
incomplet = probă neacceptată) —, o recitire comparată imediat înaintea aplicării, apoi aplicarea. Durata lock-ului pe `sites` se
acceptă explicit pentru scrierile reale, iar în acel interval se verifică și că o citire obișnuită trece. La un refuz
„BUGET_LOCK”: se confirmă că n-a rămas nimic, se caută cine ținea tabelul, se reia manual și seria de trei reîncepe.

Separat de migrare, înaintea pornirii pasului zilnic: garda de cotă a pasului socotește azi 12 rulări pe zi ale vremii curente — se
aduce la programul real al cronului; `XW_ZILNIC_ACTIV=1` se pune doar când cota lunară o permite (`docs/METEO_XWEATHER_COTA.md`).
