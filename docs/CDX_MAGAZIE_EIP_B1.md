# Magazie EIP B1 - livrare pentru review

## Fisiere

- `supabase/migrations/20261110a_magazie_eip_intrari.sql`
- `supabase/revenire/20261110a_magazie_eip_intrari_ROLLBACK.sql`
- `scripts/pg/test_magazie_eip.mjs`
- Prezentul raport.

Nu am rulat Git, nu am facut commit/push, nu am citit credente, nu am conectat o baza de date si nu am facut deploy. Cerinta initiala fara Git/DB prevaleaza asupra cererii de commit din finalul brief-ului. Niciun fisier UI modificat.

## Implementare si decizii

Catalog: 14 articole si 14 aliasuri LITIND, fara servicii. Pretul nu participa la identificare. Cautarea cu cod nu cade pe denumire daca acel cod lipseste. Fara cod, numai un alias explicit fara cod, egal dupa upper/btrim, poate produce potrivire; nu exista fuzzy sau deducere din catalog.

Stocul ramane in magazie_echipamente. Indexul unic acopera randurile active pe articol si marime; functia normalizeaza marimea prin upper/btrim, iar gol devine NULL. Pentru tipul unica refuza o marime nenula. Marimile numerice/litera nu au lista inchisa in B1, deoarece brief-ul nu furnizeaza nomenclatorul complet. Intrarea creeaza randul cu categorie eip si stare functional, conform UI existent.

Maparea initiala este o lista exacta CASE, numai pentru este_eip. Cantitatile, UM si denumirile legacy nu se modifica. Pentru un rand necunoscut, negativ sau cu total NULL, migrarea esueaza atomic. Denumirile complete ale celor sase randuri reale nu sunt disponibile in repo/brief; lista foloseste etichetele din brief si variante explicite SARDEGNA/SALOPETA IGNIFUGA. Trebuie comparate cu exportul exact inainte de aplicare. Nu am inventat ID-uri si nu am introdus LIKE. Harness-ul verifica sase randuri, maparea si suma 190, dar fixture-ul nu reprezinta un export din productie.

Jurnalul permite zero pentru migrarea unui stoc zero si pentru o corectie fara schimbare; negative numai la corectie. Cantitatile si preturile nefinite sunt refuzate. Pretul NULL este permis, lipsa pretului nefiind declarata eroare in brief. Motivele sunt obligatorii la corectie. UPDATE/DELETE/INSERT directe pe tabelele noi sunt revocate inclusiv de la service_role; numai SELECT este acordat. Proprietarul obiectelor pastreaza implicit drepturile administrative PostgreSQL. Nu exista trigger care sa pretinda ca poate bloca proprietarul sau un superuser.

Am adaugat eip_receptii: cheia cererii si raspunsul JSON initial se salveaza atomic pentru intreaga factura. Aceeasi cheie returneaza acelasi raspuns chiar daca payload-ul sau stocul ulterior difera. Cheia este globala; clientul trebuie sa genereze chei distincte intre receptii. eip_intrari.cheie_idempotenta ramane coloana optionala unica, rezervata; deduplicarea RPC nu este facuta per linie. Raspuns: {cheie,linii:[{intrare_id,echipament_id,cantitate}]}. Corectia intoarce {intrare_id,echipament_id,total,delta}.

RPC-urile de scriere folosesc acelasi advisory lock tranzactional si FOR UPDATE pe stoc. Serializarea globala este deliberata pentru volumul mic B1: elimina cursele de creare/idempotenta si ordinea inversa intre facturi cu mai multe articole. Reduce paralelismul, fara mecanisme bazate pe set_config. Corectia ia si SHARE ROW EXCLUSIVE pe inventarul angajatilor, astfel incat suma asignata nu se schimba pana la commit. Aceasta blocare poate intarzia temporar predarile legacy.

Toate cele trei functii expuse verifica regula exacta profiles: is_owner OR can_process_achizitii OR can_manage_stoc OR role=admin_logistica, pentru auth.uid() nenul. Helperul de drept nu este expus authenticated. SECURITY DEFINER are search_path fix. View-ul nou este security_invoker. RLS si privilegiile tabelelor legacy nu sunt modificate. Un trigger SECURITY INVOKER copiaza marimea din stoc la INSERT sau UPDATE OF echipament_id,marime pe inventar; nu schimba regulile de disponibilitate, predare sau retur si nu completeaza retroactiv istoricul. Functia trigger nu are EXECUTE pentru rolurile aplicatiei (executia trigger-ului foloseste privilegiul verificat la crearea lui).

Rollback-ul este tranzactional si fara CASCADE. Refuza daca exista intrari nemigrare, receptii sau marimi populate pe stoc/predari. Pe instalare curata elimina doar obiectele si coloanele B1; pastreaza toate randurile si cantitatile legacy. Dupa utilizare este necesar un plan de revenire care pastreaza istoricul, nu stergerea acestuia.

## Verificare

Harness-ul foloseste numai node stdlib si psql, cu sesiuni persistente si bariera reala pg_locks pentru concurenta. Accepta exclusiv PGURI pe localhost/127.0.0.1/::1, baza eip_b1_test_<sufix>, PG17 si proprietar nesuperuser. Refuza schema teste preexistenta. Nu creeaza/modifica roluri; authenticated, service_role si anon trebuie sa existe, iar proprietarul trebuie sa poata SET ROLE. Muta numai namespace-ul public/auth.uid in schema teste; corpurile functiilor sunt cele din migrare. La final inchide sesiunile concurente si sterge numai schema teste creata de el.

Scenarii scrise: invariant dupa operatii; migrare 190 buc; pastrarea datelor si politicilor legacy; rollback curat si refuz cu istoric; drepturile celor patru categorii si refuz fara drept; idempotenta secventiala/concurenta; factura multi-linie cu articol repetat; receptii concurente pe rand nou/existent; marimi separate; corectie sub asignat si motiv gol; delta negativa; vedere disponibil; refuz pe non-EIP; alias exact cu/fara cod; atomicitate la linie invalida; NaN/Infinity/negative; DML jurnal refuzat authenticated/service_role; detectarea derivei produse de scriere legacy.

In sandbox NU exista node, psql, postgres, docker, deno sau bun in PATH (Get-Command/where.exe). Nu am rulat harness-ul PG, verificarea de sintaxa Node, vitest sau API PostgREST. Nu exista rezultat PASS pe PG real. Verificarile locale sunt numai inspectia surselor si verificarile textuale PowerShell: ASCII OK pentru toate cele patru fisiere; cinci functii noi, patru tabele cu RLS; niciun apel set_config in migrare. Aceste verificari nu valideaza sintaxa sau comportamentul SQL/JS. Migrarea ramane nevalidata la executie si trebuie rulata cu harness-ul pe PG17 inainte de aplicare.

Comanda de verificare pe mediul local pregatit, de catre reviewer:

```text
node --check scripts/pg/test_magazie_eip.mjs
node scripts/pg/test_magazie_eip.mjs
```

PGURI trebuie configurat extern pentru baza izolata; nu este citit/afisat in aceasta livrare. Harness-ul creeaza un schelet, nu o clona completa: constrangerile si triggerele efective ale tabelelor legacy, compatibilitatea cu portile repo si accesul real PostgREST trebuie verificate separat.

## Riscuri ramase pentru B2

Invariantul global total = suma jurnal NU poate fi garantat impreuna cu pastrarea scrierilor directe legacy. B1 il garanteaza pentru tranzactiile RPC pornite din stare coerenta si refuza deriva existenta, fara sa o repare tacit. Un UPDATE direct ulterior poate produce din nou deriva. Inchiderea scrierilor directe si migrarea tuturor fluxurilor in B2 sunt necesare. Detectarea derivei blocheaza si corectia RPC; reconcilierea unui stoc deja divergent necesita un pas separat, revizuit, cu jurnal explicit.

Blocarea inventarului protejeaza verificarea corectiei pana la commit; nu previne o predare legacy excesiva dupa commit. B2 trebuie sa puna verificarea disponibilului si blocarea stocului in calea server a predarii. Copia marimii pe inventar este informativa; randurile istorice raman cu NULL.

Nu am verificat denumirile reale ale celor sase randuri, constrangerile reale categorie/um/stare sau ACL-urile implicite din Supabase. UI existent poate produce stocuri EIP noi fara articol_id pana la B2; acestea nu intra in v_eip_stoc. Proprietarul administrativ poate modifica jurnalul, asa cum poate modifica orice tabela pe care o detine; imutabilitatea B1 este impusa rolurilor aplicatiei prin ACL/RLS.
