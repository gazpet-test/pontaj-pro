# Magazie EIP B1 - revizie NO-GO PR #870

Lucru direct pe branch-ul existent `cdx/20261023-180728-d5d95c-eip-b1`, cu commit nou si fara merge. Migrarea `20261110a_magazie_eip_intrari.sql` este NEAPLICATA si a fost rescrisa in loc. Nu exista alta migrare sau modificare UI. Sunt modificate numai migrarea, rollback-ul, harness-ul si acest raport.

## Cele sase puncte

1. **Idempotenta legata de continut.** `eip_receptii.continut_hash` pastreaza MD5 pe JSON normalizat: antetul folosit la persistare si liniile sortate. Se normalizeaza spatiile antetului, CUI uppercase, marimea uppercase/trim, datele si scara numericelor. Ordinea liniilor este ignorata in hash, dar pastrata in raspunsul initial. Duplicatele sunt pastrate. Data de intrare implicita ramane NULL in hash, pentru retry in alta zi. Cheie identica + hash identic returneaza raspunsul initial; hash diferit produce `eip_cheie_reutilizata`. Teste: factura A/K apoi B/K, modificare cantitate/pret, snapshot complet stoc/jurnal/receptii nemodificat, retry normalizat cu linii inversate, conflicte concurente.
2. **Marime obligatorie.** Intrarea si mutarea refuza NULL/gol/spatii pentru `numar` si `litera` cu `eip_marime_obligatorie`. Tipul `unica` accepta NULL si refuza marime concreta. Maparea istorica pastreaza NULL. Nu exista nomenclator inchis al marimilor. Teste pentru bocanci, litera, unica si atomicitatea refuzului.
3. **Mutare atomica.** `fn_eip_muta(bigint,bigint,text,numeric,text)` SECURITY DEFINER verifica dreptul comun, motivul si cantitatea finita > 0. Foloseste advisory lock `(20261110,1)`, blocheaza inventarul pentru suma asignata stabila si cele doua stocuri cu FOR UPDATE in ordine id crescatoare. Creeaza destinatia daca lipseste; valideaza jurnalul la ambele capete si refuza scaderea sub asignat. Scrie doua intrari `mutare`, cu semne opuse si acelasi motiv. Teste NULL->42, Weldstar->Steeler, conservarea totalului/jurnalului, refuz sub asignat, motiv gol, fara drept, marime/cantitate invalida, sursa inexistenta, aceeasi destinatie, deriva sursa/destinatie, concurenta pe destinatie noua si mutari inverse. Destinatia creata intr-un apel refuzat este anulata tranzactional.
4. **RLS jurnal/receptii.** SELECT pentru authenticated foloseste EXISTS pe profiles cu auth.uid() si regula `is_owner OR can_process_achizitii OR can_manage_stoc OR role='admin_logistica'`. Testele verifica toate cele patru drepturi si zero randuri pentru utilizator fara drept, profil lipsa sau uid lipsa. Fixture-ul profiles are RLS de citire a propriului profil. RLS/ACL legacy raman neschimbate.
5. **EXECUTE explicit.** Cele cinci functii cerute revoca PUBLIC, anon si service_role; helperul revoca si authenticated. Numai cele patru RPC de UI primesc EXECUTE authenticated. Testele simuleaza default privileges permisive, verifica ACL efectiv/PUBLIC si refuza apeluri reale ca anon/service_role chiar cu JWT owner. Rollback-ul elimina si fn_eip_muta.
6. **Rollback protejat de invariant.** Inainte de DROP, sub lock, verifica total = suma jurnal pentru stocurile mapate sau referite de jurnal. Deriva produce `eip_jurnal_divergent`. Testul corupe totalul imediat dupa migrare, verifica refuzul garzii si ruleaza fisierul rollback integral intr-o sesiune separata: datele si obiectele trebuie pastrate. Rollback-ul curat elimina toate functiile B1. Garda existenta contra stergerii istoricului operational este pastrata.

## Verificare efectuata la 23.10.2026

- `node --check scripts/pg/test_magazie_eip.mjs`: PASS.
- `git diff --check`: PASS.
- Rulare incercata cu PGURI local, baza `eip_b1_test_review870`: **FAIL dupa 0 probe: observer: ENOENT** (psql lipseste).
- PostgreSQL/psql si Docker nu sunt disponibile in PATH, directorul standard PostgreSQL nu exista, WSL nu este instalat. **NU am rulat testele pe PostgreSQL 17 real.** Nu exista rezultat PASS pentru SQL, RLS/ACL, concurenta sau rollback.
- Nu am conectat baza aplicatiei, nu am aplicat migrarea si nu am verificat PostgREST sau datele reale.

Harness-ul cere PG17, PGURI localhost/127.0.0.1/::1, baza `eip_b1_test_<sufix>`, proprietar nesuperuser si rolurile authenticated/service_role/anon existente, cu SET ROLE permis. Creeaza si elimina numai schema izolata `teste`; refuza una preexistenta. Foloseste corpurile SQL din migrare/rollback, cu namespace inlocuit, sesiuni psql persistente si bariere pg_locks. Pentru rulare pe mediul pregatit: configurati PGURI si executati `node scripts/pg/test_magazie_eip.mjs`.

## Limite pastrate

Migrarea necesita verificarea denumirilor exacte legacy, a constrangerilor/triggerelelor reale si a accesului PostgREST inainte de aplicare. Fixture-ul nu este export din productie. Scrierile legacy directe pot introduce deriva ulterior; RPC-urile o detecteaza, nu o repara tacit. Blocarea inventarului protejeaza mutarea/corectia pana la commit; predarea legacy excesiva ulterioara necesita protectia server planificata in B2. Proprietarul si superuserul pastreaza privilegiile administrative PostgreSQL. PR-ul ramane draft, fara merge; validarea PG17 si review-ul GO raman restante.
