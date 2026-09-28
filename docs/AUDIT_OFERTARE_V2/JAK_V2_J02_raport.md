# JAK V2 J02 — JAK-V2-03

Implementare locală conform `C:\Users\Public\spec_v2_j02.md`. Fără git, acces la producție, secrete sau modificări ale datelor reale.

## Modificări

- `supabase/migrations/20260929a_gate_depunere_pachet_jakv203.sql`: păstrează funcția existentă și adaugă, la intrarea în `depusa` fără derogare, existența unui pachet al aceleiași licitații în starea `depus` și minimum o cerință activă (`inlocuita_de IS NULL AND duplicat_al IS NULL`). Refuzurile noi folosesc `P0001`. Triggerul devine `BEFORE INSERT OR UPDATE`; condițiile folosesc explicit `TG_OP`.
- `supabase/migrations/20260929a_gate_depunere_pachet_jakv203_ROLLBACK.sql`: reface funcția și triggerul `BEFORE UPDATE` anterioare. Fișierul `20260928n` este un patch, nu definiția completă: sursa exactă este `20260928f` + patch-ul porții din `20260928m` + `20260928n`.
- `scripts/pg/test_jakv203_gate_depusa.mjs`: harness PostgreSQL 16, fără dependențe npm, limitat la baze locale goale `jakv203_test_*`. Fixture-ul, rolul temporar și migrările rulează într-o tranzacție încheiată cu `ROLLBACK`. Nu șterge/recreează baze existente.
- `.github/workflows/ofertare-regresie.yml`: după JAK-V2-07, creează `jakv203_test_ci` și rulează noul harness în jobul `postgres`.

`SECURITY DEFINER`, `search_path`, helperul owner, regulile anterioare R06/R07/R5 și politicile rămân păstrate. R5 se verifică inclusiv cu derogare. Nu sunt modificate alte funcții de producție; stub-ul R5 este schimbat numai temporar în fixture pentru testul de regresie.

## Audit derogare

Căutarea `ofertare_evenimente` / `audit` / tabele de evenimente în migrările repository-ului și fișierele SQL din `docs` nu a identificat un tabel potrivit. Nu este creat un tabel nou. Audit = doar `RAISE NOTICE` + coloana existentă `derogare_depunere`.

NOTICE include licitația, `auth.uid()`, `session_user`, operația și flag-ul; este emis după controlul R5, numai la intrarea în `depusa` cu derogare. NOTICE nu constituie un jurnal durabil în BD. Semantica existentă a flag-ului autorizat anterior este păstrată.

## Teste

**Executate local:**

- `node --check scripts/pg/test_jakv203_gate_depusa.mjs` — PASS.
- Comparație statică Node: rollback-ul coincide cu definiția reconstruită din `f → m → n`; după eliminarea strict a adăugirilor JAK-V2-03, funcția nouă coincide cu aceeași definiție. Declarațiile triggerelor și ordinea pașilor CI sunt corecte — PASS. Aceasta nu validează execuția SQL.
- Lansarea harness-ului fără `PGURI` este refuzată de verificarea configurației. Cu URI local dedicat de test, lansarea `psql` returnează `EPERM`; `psql` nu este disponibil în PATH, iar PostgreSQL/Docker nu au fost găsite prin verificările locale efectuate. Nu s-a executat SQL.

**Acoperire implementată în harness, încă NEEXECUTATĂ pe PostgreSQL:**

- Faza A aplică SQL-ul istoric real și demonstrează `UPDATE depusa` fără pachet/cu zero cerințe și `INSERT depusa` direct.
- Faza B verifică toate cazurile obligatorii: lipsă pachet, pachet doar aprobat, zero cerințe active, depunere validă, derogare non-owner (`42501`), derogare owner, INSERT direct și cerință neconfirmată.
- Suplimentar: numai cerințe înlocuite/duplicate, dovezi neverificate/reverificare cerută/neutilizabile, valabilitate la limitele de 90 zile și ziua depunerii pentru documente reemise, `nu_se_aplica`, owner fără flag, identitate API fără `auth.uid()`, INSERT cu derogare neautorizată, modificări fără tranziție și R5 inclusiv cu derogare/INSERT.
- Sesiunile simulate au `session_user` diferit de `postgres`, pentru a nu trece fals testele de autorizare prin excepția administrativă.
- Verifică NOTICE-urile, ACL/securitate, helperul nemodificat, triggerul, aplicarea repetată, rollback-ul exact prin `pg_get_functiondef`/`pg_get_triggerdef`, repetarea bypass-urilor după rollback și rerularea întregii matrice după reaplicare.

## Ce rămâne de validat

Claude/CI trebuie să ruleze harness-ul pe PostgreSQL 16 real, cu o bază locală goală creată înainte și `PGURI=postgres://postgres@localhost:5432/jakv203_test_<sufix>`. Rezultatul PostgreSQL nu este declarat PASS. Fixture-ul minimal nu reproduce toate politicile/triggerele producției și nu validează calea PostgREST.

Nu am rulat CI, aplicat migrarea în producție sau creat PR draft; lucrul a rămas exclusiv local, fără git, conform restricțiilor sarcinii.
