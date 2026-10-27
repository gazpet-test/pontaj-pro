# Employees PII - runda 4, 27.10.2026

Raport istoric r4. Pentru starea curenta vezi [raportul r5](EMPLOYEES_PII_R5_RAPORT.md).

Numai worktree; fara commit/push, credentiale, BD externa sau deploy.
Commit de baza, citit din ref local: `89b296f2ed9f6f07b25e1c608c97011dcf9c0e60`.
Nu exista commit nou: interdictia explicita prevaleaza asupra cererii contradictorii din brief.
SHA256 baza verificat: `80c5e3c0cc27086d02ba95f7e9d61c64a6ae86b2790d84a05de4bd58f6ace80b`.
Comanda reusita: `& 'C:\Program Files\Git\cmd\git.exe' apply --whitespace=nowarn C:\Users\Public\livrare\pii_895_r4_base.patch`.
Incercarea initiala `git apply` a esuat deoarece git lipsea din PATH. Nicio alta comanda git.

## Schimbari

- P1-01: migrarea NEAPLICATA `supabase/migrations/20261117a_employees_pii.sql`:
  `fn_employees_pii_write_guard` SECURITY DEFINER, search_path fix, EXECUTE revocat
  PUBLIC/anon/authenticated/service_role. BEFORE INSERT/UPDATE verifica cele 12
  coloane personale; UPDATE compara ROW NEW/OLD IS DISTINCT FROM. Refuz 42501,
  mesaj romanesc ASCII (UTF8 normal, fara U&). auth.uid NULL pastreaza calea server,
  explicit ceruta in brief. RLS de scriere employees ramane O OR W.
- Contradictie in brief: qr_pin_active este NOT NULL DEFAULT false; INSERT literal
  cu orice personal non-NULL ar refuza si INSERT fara personal. Am cerut clarificare.
  Implementarea permite false implicit/explicit la INSERT, pentru scenariul pozitiv
  cerut; true si celelalte 11 coloane non-NULL sunt refuzate. UPDATE true->false cere
  drept personal. Aceasta exceptie este o interpretare declarata, nu o aprobare primita.
- P1-02, decizia Razvan A: RPC-ul extern insereaza mereu telefon=NULL,email=NULL.
  Testul de paritate compara intregul corp istoric, exceptand exact aceste valori.
  Legarea explicita pastreaza contactele manuale existente; poarta de rol,
  idempotenta, observatiile si mesajele istorice sunt pastrate. Migrarea istorica intacta.
- SELECT extern ramane deliberat deschis oricarui authenticated: registru de contacte
  de colaborare, completate manual de HR cu acordul persoanei (decizie explicita Razvan).
  INSERT/UPDATE extern devin owner sau can_modify_employees. Fara DELETE nou.
  Preflight: exact trei politici, rol authenticated, permisive; SELECT qual uid nenul,
  UPDATE qual si with_check uid nenul; INSERT qual NULL, with_check uid nenul.
  Baseline din brief si schelet repo; NU interogare live. Brief: 25 randuri, 0 legate.
- UI `src/HrPersonalExtern.jsx`: contacte editabile prin esteOwner OR poateLega
  (prop-ul existent O OR W din HR.jsx). Modifier fara isAdmin poate edita contacte.
  Altii vad mesaj "Doar citire". Dreptul existent canEdit pentru autorizatii separat.
  Scrieri directe inventariate: adaugare/editare/dezlegare in acest fisier.
  HrFostiAngajati foloseste RPC pentru transfer; HrRecomandari/OfertareOrganigrama
  doar citesc extern. HR.jsx nu este modificat suplimentar in r4.
- Rollback `supabase/revenire/20261117a_employees_pii_ROLLBACK.sql`: refuza drift
  ACL tabel/coloane (inclusiv PUBLIC/rol intermediar), membership tranzitiv,
  politici employees/extern, definitie/ACL/owner/trigger nou. Restaureaza exact
  politicile si RPC-ul din snapshot protejat; verifica egalitatea dupa restaurare.
  Sterge triggerul/functia noua. Fara modificari ale datelor HR la apply/rollback.

## Ordine triggere

trg_employees_zz_pii_write este ultimul BEFORE ROW INSERT/UPDATE: verifica NEW final,
inainte de AFTER audit/ciclu. Preflight interogheaza pg_trigger, emite lista ordonata
in NOTICE si refuza un BEFORE ROW I/U ulterior sau omonim. Test nou: un BEFORE
anterior modifica iban cand clientul schimba functie; poarta trebuie sa refuze.
Cele 13 nume din sursele repo (nu confirmare live):
trg_employees_00_cont_revocat, trg_employees_0_protectie (DELETE),
trg_employees_audit_del (DELETE), trg_employees_audit_ins (AFTER),
trg_employees_colab_ext_lock, trg_employees_colab_ext_lock_ins,
trg_employees_colab_ext_protectie_ins, trg_employees_colab_ext_protectie_upd,
trg_employees_persoana_lock, trg_employees_termination_notify,
trg_employees_zz_ciclu_cont (AFTER), trg_employees_zz_colab_ext (AFTER),
trg_employees_zz_colab_ext_ins (AFTER). Trigger-ele AFTER sunt in alta faza;
ordinea alfabetica intre faze nu influenteaza poarta BEFORE.

## Matrice acces

O=is_owner, P=can_access_personal_data, W=can_modify_employees,
M=intrare explicita Magazie viewer/editor/admin. *=indiferent.
Citire personal numai prin RPC; SELECT/RETURNING personal direct este refuzat
tuturor authenticated, inclusiv owner. Scrierea marimilor este personala.

| O | P | W | M | Citire personal | Citire marimi | Scriere personal | Scriere publica | Copiere contacte extern / legare |
|---|---|---|---|---|---|---|---|---|
| 1 | * | * | * | da | da | da | da | niciodata / da |
| 0 | 1 | 1 | * | da | da | da | da | niciodata / da |
| 0 | 1 | 0 | * | da | da | nu | nu | niciodata / nu |
| 0 | 0 | 1 | 0 | nu | nu | nu | da | niciodata / da |
| 0 | 0 | 1 | 1 | nu | da | nu | da | niciodata / da |
| 0 | 0 | 0 | 0 | nu | nu | nu | nu | niciodata / nu |
| 0 | 0 | 0 | 1 | nu | da | nu | nu | niciodata / nu |

SELECT extern: da pe toate randurile. INSERT/UPDATE extern: O OR W.
Statistica live comunicata 27.10, neinterogata de cdx: owner+personal 2,
modifier+personal 4, modifier fara personal 2, fara flaguri 28. Magazie necunoscut.

## Edge / cron

Scanare statica: supabase/functions/citeste-orice/index.ts:216,
ofertare-acoperire/core.ts:260, ofertare-triere/index.ts:159 si
api/hr-drive-import.js:105, hr-fise-import.js:58 citesc employees, nu scriu personal.
hr-extrage-ci extrage CI in alte obiecte, nu UPDATE employees.
Sursele qr-utilaj-info, qr-alimentare-submit, qr-bon-comun-lookup lipsesc: identitatea
si scrierile lor NU pot fi confirmate. PIN-urile src/Logistica.jsx folosesc JWT uman,
deci cer P/O. Cron-urile versionate nu contin scrieri personale directe employees;
sweep-ul conturi ruleaza ca postgres si opereaza conturi/coada. Inventarul static nu
este inventar pg_cron live. auth.uid NULL ramane exceptat; un edge cu JWT uman nu.

## Verificari cdx

Mediu: Windows, Node 24.20.0, PG17.6 nativ, Git Bash OSTYPE cygwin.
Client: `& 'C:\Program Files\nodejs\node.exe' --test scripts/test_employees_pii_client.mjs`
PASS 27/27, inclusiv rerulare dupa editarea harness-ului.

Comanda exacta harness PowerShell:
```powershell
$env:PATH='C:\Users\Public\shim;C:\Program Files\nodejs;C:\Program Files\Git\bin;C:\Program Files\Git\usr\bin;'+$env:PATH
$env:LOCALE='C'
$env:UNIX_SOCKET_DIRECTORIES=''
$env:PG_BIN='/c/Users/Public/pgsql/bin'
& 'C:\Program Files\Git\bin\bash.exe' scripts/test_employees_pii.sh
```
PATH contine python3 public shim catre Python313. Socket gol nu trimite -c socket.
Harness PG17: INCERCAT, FARA PASS. pg_ctl esueaza CreateRestrictedToken 87/3.
Incercarea diagnostica de startup postgres direct a pornit serverul local, dar
pg_isready nu a obtinut conexiune la 127.0.0.1:5997 in sandbox; server oprit prin
cleanup. Loguri .employees-pii-test.FTcjI1Wg/{postgres,start,stop}.log.
Nu s-a folosit o BD existenta, nici credentiale; numai clustere fictive in worktree.
Diagnosticul --single din .tmp nu este echivalent: bypass RLS chiar cu SET ROLE;
rezultatele lui NU sunt folosite ca dovada de securitate sau harness PASS.

Teste SQL noi in scripts/test_employees_pii_r4.sql si _trigger_order.sql:
toate 12 INSERT/UPDATE personale, INSERT public, UPDATE public/no-op,
service_role/postgres NULL uid; extern SELECT/UPDATE/INSERT pe matrice.
Harness extins: preflight politici/ordine, drift PUBLIC tabel/coloana, rol intermediar,
membership, trigger/politici, restaurare exacta politici/functie/ACL si reapply.
Fixture nu reproduce intregul lant live de triggere. SQL runtime ramane de validat.

Build/Vitest: PASS, detaliile si comenzile sunt mai jos.
PostgREST real/Deno: nerulate. Nu au fost furnizate loguri de chat pentru r4;
nicio executie externa nu este atribuita cdx. Rezultatele comunicate ulterior de
chat vor fi marcate "rulat de chat, nu de cdx". Fara GO de productie.

## L01-L25

| Regula | Dovada / limita |
|---|---|
| L01 | Migrare/rollback: advisory -> employees -> extern -> backup inainte de drift; lock/idempotenta RPC istoric pastrate, test paritate client. |
| L02 | Runner --single-transaction; modificari schema/ACL/politici atomice; fara DML HR la apply. |
| L03 | n/a |
| L04 | n/a; idempotenta RPC veche pastrata, test SQL. |
| L05 | n/a |
| L06 | Ordine lock in migrare/rollback; trigger nou citeste profil fara lock alte tabele; RPC conserva ordinea istorica. |
| L07 | Trigger server pentru PATCH/INSERT direct + RLS extern; SELECT extern deliberat aprobat. Testele SQL scrise, runtime blocat. |
| L08 | auth.uid in trigger/RLS; NULL server permis explicit in brief; fn_identitate_om istoric pastrat. |
| L09 | Exceptia Magazie verifica module='magazie' explicit in RPC; teste existente pastrate. |
| L10 | Fara credentiale/secrete citite; date fictive; mesaj trigger fara valori personale. |
| L11 | n/a |
| L12 | n/a pentru r4; helperul existent refuza rezultat partial, client PASS. |
| L13 | Paritate corp/hash istoric; regex doar in teste, nu in autorizare SQL. |
| L14 | Snapshot protejat, drift verificat inainte de restore; scenariu apply/rollback/reapply in harness, runtime blocat. |
| L15 | Preflight politici/metadate externe si ordine pg_trigger; snapshot ACL/membership/trigger; audit complet callee live neefectuat. |
| L16 | n/a |
| L17 | n/a |
| L18 | IS DISTINCT FROM / IS TRUE / EXISTS; UI separa contacte de autorizatii; fara fail-open la PII. |
| L19 | Predicate O OR P si O OR W conforme; paritate corp RPC testata; cazuri SQL matriciale scrise. |
| L20 | Negative si legitime: public/no-op/server/owner/HR; exceptia INSERT false explicita. SQL runtime blocat. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a r4; paginarea RPC existenta are teste client PASS. |
| L24 | n/a r4; nu s-a adaugat load async; limitele legacy nu sunt declarate reparate. |
| L25 | Client 27/27 real; SQL SET ROLE authenticated/service_role, postgres NOSUPERUSER; nu substituim diagnosticul single-user pentru RLS real. |

Referinte pentru regulile aplicabile din tabel: migrarea
`supabase/migrations/20261117a_employees_pii.sql:11` (L01/L02/L06),
`:66` (L14/L15), `:135` (L07/L08/L10/L18/L19/L20), `:270` (L07/L19),
`:320` (L14/L15); rollback
`supabase/revenire/20261117a_employees_pii_ROLLBACK.sql:12` (L01/L06/L14),
`:27` (L14/L15), `:37` (restaurare politici), `:69` (eliminare obiecte noi).
UI `src/HrPersonalExtern.jsx:78` si `:155` (L18/L19).
Testele de paritate/hash/idempotenta sunt in `scripts/test_employees_pii_client.mjs`
si `scripts/test_employees_pii.sql` (L01/L04/L06/L13/L19/L25);
`scripts/test_employees_pii_r4.sql` si `scripts/test_employees_pii_trigger_order.sql`
acopera L07/L08/L20; `scripts/test_employees_pii_r4_client.mjs` acopera L18/L19/L25.

## Rezultate finale r4

- PASS client: 27/27 existente + 1 test nou de acces contacte = 28/28.
  Comanda: `& 'C:\Program Files\nodejs\node.exe' --test scripts/test_employees_pii_client.mjs scripts/test_employees_pii_r4_client.mjs`.
  Log: `.tmp/client-r4.log`. O rerulare intermediara a detectat citire cp1252 intr-un
  script de editare; functia a fost restaurata din sursa istorica UTF8 si toate
  citirile acelui script au encoding explicit. Paritatea completa este din nou verde.
- PASS `node --check src/employeesPersonal.js`, `bash -n scripts/test_employees_pii.sh`.
- PASS validator livrare: 25 instructiuni de nivel superior.
  Comanda: `$env:PYTHONIOENCODING='utf-8'; & 'C:\Program Files\Python313\python.exe' scripts/livrare_validator.py supabase/migrations/20261117a_employees_pii.sql`.
  Prima executie esuase numai la afisarea mesajului romanesc in consola cp1252.
- PASS build Vite 5.4.21 si Vitest 2.1.9: 108 fisiere passed, 1 skipped;
  2620 teste passed, 6 skipped. Loguri `.tmp/build-r4.log`, `.tmp/vitest-r4.log`.
  Dependinte copiate din node_modules al checkout-ului local existent, exclusiv in
  node_modules din worktree (robocopy /E, fara .vite/.cache); fara npm ci/retea sau
  modificari package.json/package-lock.json. Nu este prezentat drept npm ci curat.
  Primele executii au esuat uv_os_homedir ENOMEM; rerularea de mai jos a trecut.

Comenzi PowerShell pentru build si Vitest (procese separate, acelasi mediu local):
```powershell
$env:USERPROFILE=Join-Path (Get-Location) '.tmp\profile'
$env:APPDATA=$env:USERPROFILE
$env:LOCALAPPDATA=$env:USERPROFILE
New-Item -ItemType Directory -Force $env:USERPROFILE | Out-Null
& 'C:\Program Files\nodejs\node.exe' node_modules/vite/bin/vite.js build
& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run
```

PG17 administrativ suplimentar: PASS apply -> rollback -> reapply, cele 7 cazuri
de drift (PUBLIC tabel/coloana, intermediar, membership, coloana authenticated,
politica externa, trigger dezactivat), plus triggerul nou cu cele 12 coloane,
public/no-op/server/owner/HR si transformarea NEW intr-un trigger anterior.
Comanda diagnostica: `& 'C:\Program Files\Python313\python.exe' .tmp/r4_ddl.py`.
Log: `.tmp/r4-ddl.log`, marker `PASS DDL smoke + 7 rollback drift (fara RLS)`.
Ruleaza PG17.6 --single pe cluster nou LOCALE=C din worktree, fara socket/retea.
Copia de intrare a literaliilor este codificata pentru terminalul --single -j,
pastrand prosrc (preflight hash exact trece); artefactele livrate nu sunt convertite.
Acest test a gasit coliziunea recordului PL/pgSQL `a` cu aliasul pg_auth_members;
aliasul rollback este acum membership_row. Scenariul pozitiv si drift membership
au fost rerulate dupa corectie. Snapshotul portii include acum toate triggerele
employees si metadatele/ACL/RLS/owner extern, refuzand si asemenea drift.

Limita: --single ocoleste RLS. Rezultatele administrative/trigger NU dovedesc
politicile RLS, calea authenticated reala sau gate-ul permanent 0e din runner.
Harness-ul complet prin psql ramane BLOCAT de mediul sandbox; nu exista PASS total
PG17/PostgREST. Startup-ul direct a fost numai diagnostic si a fost eliminat din
harness; varianta livrata pastreaza pg_ctl si regula socket gol din baza.
Auditul live al celor 13 triggere, callee si joburi ramane la Claude.

Toate comentariile/adaugarile noi sunt romana ASCII; literalii UTF8 istorici din
RPC si textele JSX existente sunt pastrate pentru cerinta de identitate exacta.
Fara U& in migrarea livrata (fixture-ul istoric foloseste codificarea preexistenta).
Nu se declara GO de productie. Exceptia INSERT qr_pin_active=false necesita
confirmarea interpretarii; intrebarea asincrona nu a primit raspuns pana la acest raport.
