# JAK-V2-07 — raport de implementare

Implementat conform `JAK_V2_07_FIX_SPEC.md`, exclusiv în fișiere locale. Fără git, fără acces la producție, fără aplicarea migrării.

- `supabase/migrations/20260928p_ofertare_rls_scriere_r_v2_07.sql`: înlocuiește politica ALL de pe licitații cu SELECT pentru autentificați, INSERT pentru Ofertare/owner, UPDATE pentru Ofertare/owner/Financiar și DELETE exclusiv owner. Triggerul `a00_ofertare_licitatii_scriere` compară rândurile prin JSONB, exceptând numai `contract_id` și `updated_at`; Financiar primește eroarea P0001 cerută pentru orice altă diferență. Excepția `session_user='postgres'` este păstrată exact conform specificației.
- Aceeași migrare înlocuiește cele **33 de politici pe 27 de tabele** din Anexa 1, cu numele și comenzile păstrate, rolurile `public` restrânse la `authenticated` și poarta `fn_are_acces_ofertare()`. Politicile SELECT separate și granturile pe tabele nu sunt modificate.
- `supabase/migrations/20260928p_ofertare_rls_scriere_r_v2_07_ROLLBACK.sql`: reface politicile weak și rolurile din anexă, elimină cele patru politici noi ale licitațiilor și triggerul/funcția, restaurează `ofertare_licitatii_all`. Ambele fișiere folosesc DROP IF EXISTS și sunt pregătite pentru rerulare; fiecare trebuie executat integral în tranzacția runnerului, fără commituri intermediare.
- `scripts/pg/test_jakv207_rls.mjs`: harness pentru PostgreSQL 16 real prin `psql`, cu SET ROLE authenticated și JWT pentru patru utilizatori. Include cele cinci scenarii cerute, INSERT neautorizat, DELETE refuzat pentru Ofertare și Financiar, modificarea câmpurilor sensibile de către Financiar, trecerea contractului la/din NULL, cascada, excepția postgres, verificarea catalogului/ACL, migrare de două ori, rollback de două ori și reaplicare.

Testul folosește **SET SESSION AUTHORIZATION către un rol fără superuser/BYPASSRLS înainte de SET ROLE**. Altfel o conexiune postgres ar ocoli garda Financiar și testul nu ar verifica situația reală. Fixture-ul include RLS pe profiles/user_module_access și un FK pentru contract. Este minimal: nu reproduce toate coloanele, trigger-ele și constrângerile producției.

Harness-ul acceptă exclusiv PGURI local, login postgres, bază goală `jakv207_test_<sufix>`, fără parametri URI care pot suprascrie destinația. Nu șterge/recreează baze. Fixture-ul, rolul temporar și execuțiile SQL sunt într-o tranzacție anulată la final; la eroare, închiderea conexiunii anulează tranzacția.

Verificări executate:

- `node --check scripts/pg/test_jakv207_rls.mjs` — PASS.
- Verificare statică Node a celor două SQL-uri — PASS: 33 de politici / 27 de tabele, nume, cmd, roluri, USING/WITH CHECK, DROP IF EXISTS și numărul politicilor SELECT.

Neexecutat: testul pe PostgreSQL 16 și orice apply, inclusiv local, conform instrucțiunii „fără apply” din specificație. Validarea SQL la runtime, integrarea cu trigger-ele existente și comparația cu definițiile LIVE rămân pentru Claude. Nu am rulat vitest; nu declar vreun rezultat vitest sau un incident spawn EPERM. Fișierul de referință `scripts/pg/test_jakv201_tranzitie.mjs` nu există în checkout; am folosit tiparul psql din `test_r9b_probe23.mjs`.

Observație: **FOR ALL participă și la SELECT**. Pe tabelele B fără politică SELECT separată, noua poartă restrânge și citirea. Am păstrat exact forma cerută în anexă, fără politici SELECT suplimentare. Citirea licitațiilor rămâne deschisă utilizatorilor autentificați.

Rămân de gated după confirmare de modul (RFQ↔achiziții, calibrări↔CTC, catalog partajat), neatinse în acest patch: `ofertare_rfq*`, `ofertare_oferte_furnizori`, `ofertare_oferte_deschidere`, `ofertare_calibrari`, `ofertare_calibrari_subcontractori`, `ofertare_brokeri`, `ofertare_preturi_materiale`, `ofertare_preturi_unitare`, `ofertare_normative`, `ofertare_norme_productivitate`, `ofertare_categorii_reguli`, `ofertare_experienta`, `ofertare_parteneri`, `ofertare_parteneri_documente`.
