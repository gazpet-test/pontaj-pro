# Employees PII - runda 5, 27.10.2026

Numai worktree. Fara commit/push, credentiale, BD existenta sau deploy.
SHA256 patch verificat integral:
`1a026b67962163730ab00e23c145e69440d38caae7285bc5900ecabe30125bb1`.
Aplicat cu git apply --whitespace=nowarn prin executabilul local Git; nicio alta comanda Git.
Instructiunea initiala No Git commit prevaleaza asupra finalului contradictoriu al brief-ului.
Migrarea 20261117a este NEAPLICATA; nu a fost editata o migrare aplicata.

## Defect -> fix -> test

- Oracol PIN/CNP/IBAN: trigger personal BEFORE UPDATE OF cele 10 coloane,
  refuz 42501 cu acelasi mesaj indiferent de valoare/no-op. INSERT ramane pe valori,
  inclusiv exceptia qr_pin_active=false; auth.uid NULL ramane exceptat explicit.
  Test: scripts/test_employees_pii_r5.sql corect/gresit/no-op CNP/IBAN, upsert
  ON CONFLICT DO UPDATE, UPDATE public legitim. Testul r4 no-op personal actualizat
  sa ceara refuz; no-op public ramane permis.
- Magazie: trigger separat pe cele doua marimi; O/P sau modul exact magazie
  editor/admin. Aceeasi verificare la INSERT non-NULL si transformarile altor triggere.
  Caz suplimentar descoperit: RLS O/W ar produce zero randuri pentru editor fara W.
  Politica UPDATE suplimentara permite O/P sau Magazie editor/admin, inclusiv P fara W;
  garda generala refuza schimbarea
  oricarui camp diferit de marimi pentru apelant fara O/W. INSERT pastreaza O/W existent,
  plus predicatul de marimi. Nu s-au acordat roluri sau intrari user_module_access.
  Test: r5 SQL editor/admin fara W scriu marimi, CNP/public refuzate;
  viewer si fara modul cu W refuzate; INSERT editor cu W permis.
- UPDATE OF nu vede transformarile NEW facute de alte triggere. Pastrate garzi finale
  generale NEW/OLD pentru personal si marimi, pe langa trigger-ele pe coloane.
  Test ordine: UPDATE public legitim trece, apoi trigger anterior care modifica IBAN
  la un UPDATE public este refuzat. Preflight rezerva tot intervalul de nume de la
  trg_employees_zz_pii_write in sus, inclusiv cele patru nume noi.
- Rollback: snapshot dupa apply pentru toate cele patru functii noi: definitie plus
  intregul pg_proc (owner, proconfig, ACL, proprietati); snapshot toate trigger-ele
  employees include definitie structurala/tgfoid/tgenabled/tgargs/WHEN. Egalitate stricta
  inaintea oricarui DROP. Politica noua are snapshot si restaurare verificata.
  Teste harness: corp RPC modificat, ACL RPC prin PUBLIC, proconfig garda modificat,
  plus cazurile de drift r4; apply -> rollback -> reapply pastrate.
- UI: dreptul de scriere se citeste explicit din profiles/user_module_access;
  erorile lasa read-only cu mesaj; generatia loadAll protejeaza rezultatele.
  Viewer nu poate edita inputul si callback-ul refuza scrierea directa.

Referinta PG17: https://www.postgresql.org/docs/17/sql-createtrigger.html, Notes.
Coloana prezenta in SET declanseaza UPDATE OF inclusiv SET x=x; modificarile
BEFORE trigger nu declanseaza automat trigger-ele pe coloane.

## Matrice actualizata

O=is_owner, P=can_access_personal_data, W=can_modify_employees, M=modul Magazie explicit.
SELECT personal direct/RETURNING personal direct ramane interzis tuturor authenticated.

| Apelant | Citire personal RPC | Citire marimi RPC | UPDATE personal non-marimi | UPDATE marimi | UPDATE public |
|---|---|---|---|---|---|
| O | da | da | da | da | da |
| P + W | da | da | da | da | da |
| P fara W/M editor | da | da | refuz la schimbare | da | refuz la schimbare |
| W fara P/M | nu | nu | refuz | refuz | da |
| M viewer + W | nu | da | refuz | refuz | da |
| M viewer fara W | nu | da | zero randuri RLS | zero randuri RLS | zero randuri RLS |
| M editor/admin fara P/W | nu | da | refuz | da | refuz la schimbare |
| M editor/admin + W fara P | nu | da | refuz | da | da |
| P + M editor/admin fara W | da | da | refuz la schimbare | da | refuz la schimbare |

INSERT: O/W necesar; valori personale cer O/P, marimi non-NULL cer O/P sau M editor/admin.
Pentru P fara W, accesul la marimi nu acorda modificari de CNP/public; vechiul test
cu zero randuri pentru CNP a fost actualizat la refuzul 42501 al garzii.
Marimile nu acorda drept de creare angajat sau de scriere a altor date.

## Verificari la DRY

- Inventar auth.uid NULL: sursele edge/api/worker versionate nu contin scriere directa
  personala employees. citeste-orice, ofertare-acoperire/core, ofertare-triere si
  hr-drive-import/hr-fise-import doar citesc employees. Cron-urile de conturi opereaza
  conturi/coada, nu personal employees. RPC fn_fost_angajat_leaga_extern nu mai copiaza
  telefon/email; fn_colaborare_externa_seteaza scrie doar campuri publice de acord.
  Scrierile SQL personale gasite in supabase/tests sunt fixture-uri de test.
  Importurile/ad-hoc postgres/service_role cu uid NULL raman exceptate, test r4 SQL.
  Sursele qr-utilaj-info, qr-alimentare-submit, qr-bon-comun-lookup lipsesc: NU putem
  certifica scrierile lor sau joburile pg_cron live. Acest audit necesita catalogul live
  si sursele deploy-ate la Claude; nu se declara inventar live complet.
- Privilegii efective extern: scripts/employees_pii_dry.sql pregatit, numai citire,
  has_table_privilege/has_any_column_privilege includ PUBLIC si roluri mostenite;
  query separat arata ACL tabel/coloane pe inchiderea recursiva a membership.
  Fixture are GRANT SELECT,INSERT,UPDATE authenticated plus USAGE secventa; RLS limiteaza
  INSERT/UPDATE O/W. Privilegiile live NU sunt cunoscute; verificarea ramane la DRY.
- Ordine triggere: testul are acum si UPDATE public legitim cu rowcount=1.
  Declaratia din brief despre live 27.10 este context furnizat, nu verificare cdx.

## Inventar payload-uri src revizuit r5

| Cale employees | Verdict |
|---|---|
| App.jsx schimbare santier | numai site_id |
| App.jsx toggleEmpActive/reactivare | active/termination_date; observatii_hr numai employeePersonalWrite |
| App.jsx saveEditEmp | iban numai employeePersonalWrite; rest public |
| App.jsx saveSalary scriere employees | email numai employeePersonalWrite; calcul taxe neatins |
| HR.jsx trei update-uri inline | are_autorizatii/functie/cod_cor publice |
| Logistica.jsx functii_extra | public |
| Logistica.jsx setPin/togglePin | gardate employeeFieldRead pe sursa RPC O/P |
| Magazie.jsx salveazaMasura | numai campul marimii, drept scriere explicit + employeeFieldRead |
| App.jsx addEmployee/import | numai public, fara coloane personale |
| HrAngajatNouWizard.jsx INSERT | personal intentionat; necesita O/P; RETURNING id,name |

Scanare src pentru toate formele from employees, inclusiv multilinii: niciun upsert
employees. Upsert hr_employees_private este alt tabel, gardat O/P; nu ocoleste trigger-ul.
Niciun UPDATE legitim non-P nu trimite implicit personal necitit. Testele client
executa payload-urile reale App, callback-urile Logistica si Magazie.

## L01-L25

| Regula | Respectare / dovada |
|---|---|
| L01 | Advisory si LOCK in migrare/rollback inainte de snapshot/drift; r5 nu introduce contoare/CAS nou. |
| L02 | Runner --single-transaction, fara DML HR la apply/rollback. |
| L03 | n/a |
| L04 | n/a |
| L05 | n/a |
| L06 | Ordine existenta advisory -> employees -> extern -> backup; garzile nu iau lock-uri pe alte tabele. |
| L07 | Garzi server UPDATE OF + finale; RLS Magazie limitat de garda; r5 SQL. |
| L08 | auth.uid; NULL exceptie ceruta explicit, teste r4 service_role/postgres. |
| L09 | module='magazie' exact, viewer exclus la scriere; r5 SQL/client. |
| L10 | Refuz identic PIN corect/gresit si CNP/IBAN no-op; date fictive; fara secrete. |
| L11 | n/a |
| L12 | n/a |
| L13 | n/a; fara parser nou sau regex in autorizare SQL. |
| L14 | Snapshot in tranzactie, drift verificat inainte DROP; harness apply/rollback/reapply. |
| L15 | objects_after cu definitie si pg_proc complet; all_triggers; teste drift corp/ACL/config; audit live callee neefectuat. |
| L16 | n/a |
| L17 | n/a |
| L18 | IS DISTINCT FROM / IS TRUE / EXISTS; erori verificare UI -> read-only cu mesaj. |
| L19 | helper employeeMarimiCanWrite; test matrice UI si verificare predicat SQL, matrice server r5. |
| L20 | Public legitim/no-op, editor fara W, INSERT, server NULL, refuzuri; r4/r5/order SQL. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a; paginarea existenta pastrata si retestata client. |
| L24 | Citirea dreptului UI in loadAll foloseste generatia existenta, invalidata la unmount. |
| L25 | 31 teste client PASS; SQL NOSUPERUSER/SET ROLE pregatit; rezultatele PG sunt raportate distinct mai jos. |

## Verificari cdx r5

PASS: 31/31 teste client (runda initiala + r4 + r5), bash -n harness,
livrare_validator.py: 31 instructiuni de nivel superior.
Comanda client: node --test scripts/test_employees_pii_client.mjs scripts/test_employees_pii_r4_client.mjs scripts/test_employees_pii_r5_client.mjs.
PG17: INCERCAT, BLOCAT in initdb/pg_ctl: CreateRestrictedToken error 87/3.
Comanda: PG_BIN=/c/Users/Public/pgsql/bin LOCALE=C UNIX_SOCKET_DIRECTORIES='' bash scripts/test_employees_pii.sh.
Artefact: .employees-pii-test.klqOp2RK. Nicio conexiune la o BD existenta.
SQL r4/r5/order, drift si apply/rollback/reapply NU sunt declarate trecute.

PASS build Vite 5.4.21: .tmp/build-r5.log.
PASS Vitest: 108 fisiere, 2620 teste; 1 fisier / 6 teste skipped: .tmp/vitest-r5.log.
Dependinte copiate in worktree din node_modules local al checkout-ului existent,
robocopy /E /XD .vite .cache; fara retea, fara editare manifest/lock, fara npm ci curat.
USERPROFILE/APPDATA/LOCALAPPDATA redirectate exclusiv in .tmp/profile pentru procesele Node.
Nu se mostenesc rezultatele r4 ca executii r5. PostgREST real si Deno nerulate.
Nu se declara GO de productie.
