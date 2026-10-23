# E4a — pachetul de livrare (run_mig DRY → „da” → apply)

**APLICAT pe prod 23.10.2026** (v20261109120000, sha `a7f4e490…`, DRY r2 verde cu revenirea în aceeași tranzacție, runner cod 0, 0e = 0). Branch `izometrie/e4a` @ `3863bbf3` (r2). PR #869 (draft). GO-ul Copilot s-a dat pe `046f9946`. r2 schimbă un singur lucru: mecanismul de imuabilitate pentru PDF-urile din flux (vezi „r2” mai jos). Schimbarea merge la Copilot ca delta înainte de apply.

## r2 — de ce (DRY pe prod, 23.10)

DRY-ul r1 a picat la `ALTER TABLE storage.objects ENABLE ALWAYS TRIGGER`: pe Supabase, `storage.objects` aparține lui `supabase_storage_admin`, iar `postgres` nu e nici proprietar, nici superuser. Și `DROP TRIGGER` din rollback ar fi picat din același motiv. r2 scoate complet trigger-ul și funcția `fn_izo_flux_storage` și pune în loc două politici **RESTRICTIVE**, `izo_flux_pdf_imuabil_upd` și `izo_flux_pdf_imuabil_del` (`FOR UPDATE` / `FOR DELETE TO public`, predicatul read-only `fn_izo_flux_pdf_blocat(bucket,name)`). E același tip de obiect pe care E3 l-a creat deja pe prod ca postgres (`izo_doc_scan_*`). O politică restrictivă se combină prin AND cu politicile permisive existente ale bucket-ului, deci clienții anon/authenticated nu mai pot modifica sau șterge PDF-ul aprobat al unui pachet în flux. **Frontiera acceptată (Răzvan, varianta A, 23.10):** PDF-ul e imuabil **pentru clienți** (`anon` / `authenticated`). Rolurile care ocolesc RLS (`service_role`, `postgres` cu BYPASSRLS, proprietarul `supabase_storage_admin`) rămân în afara protecției, ca la toate bucket-urile; vechiul trigger le oprea și pe ele, dar pe Supabase nu se poate. Nu se adaugă dovadă de modificare (B) acum. În harness: test RLS ca authenticated, care arată că UPDATE/DELETE pe PDF-ul din flux dă 0 rânduri, iar obiectul de control se modifică (1 rând). Plus o probă statică: migrarea și revenirea nu au `ALTER TABLE storage.` și nici `TRIGGER … ON storage.`. În harness, postgres e superuser și n-ar vedea diferența de proprietar.

## Artefacte

| Fișier | sha256 (blob git, LF) | octeți |
|---|---|---|
| `supabase/migrations/20261109a_izometrie_e4a_flux.sql` | `a7f4e4903328b8a9878e0d52eb01af2997356990744c6780e317cdd176875bb7` | 126790 |
| `supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql` | `8b9f7c361204d178a981a75e03ab04d078fd93129a565939bc72f8dbb563915b` | 74940 |

Ambele fișiere sunt generate de `scripts/izometrie/e4_gen/gen_e4a.py`; regenerarea la `4b183b90` dă fișiere identice. Sha-ul se ia din blob (`git cat-file -p 4b183b90:<cale> | sha256sum`), nu din copia de lucru: pe Windows, cu `autocrlf`, copia de lucru are CRLF.

Runner: `scripts/livrare_migrare.sh`, la fel ca la E3b (`20261106a` → versiunea `20261106120000`). Propunere: `--nume 20261109a_izometrie_e4a_flux --versiune 20261109120000 --tinta-db postgres --tinta-sistem 7632885393857617092`, cu `--sha256` de mai sus. Migrarea refuză orice altă cale decât runner-ul: verifică marcajul `gazpet.livrare_migrare`, READ COMMITTED și `current_user = postgres`.

## Precondiții

Am verificat pe prod read-only azi, 23.10, în jur de ora 19:
- istoricul conține 2a, 2c, 3b și 6a (E3b), dar nu conține 20261109*;
- `fn_izo_porti_lipsa() || fn_izo_porti_e3_lipsa()` = `{}`;
- `magazie_bucati` legate (`tip_cod` și `executie_teava_id` NOT NULL) = 0, deci preflight-ul indexului unic trece;
- rolul `izo_montaj_writer` nu există; nici `izo_tronson_config` nu există.

Ce mai verifică migrarea singură:
- md5 pe corpurile LIVE ale `fn_izo_porti_lipsa`, `fn_izo_porti_e3b_definitii`, `fn_izo_porti_e3b_lipsa`, `fn_izo_garda_bucati`, `fn_izo_garda_fapte`;
- lista exactă a invocărilor implicite ale `fn_izo_*` (re-ștampilarea §17.4 E3_CONFIRMA_DESIGN, extinsă în generator);
- amprenta baseline (secvențe și rolul `izo_registru_writer`).

Ciorne deschise: nu sunt o precondiție a E4a. E4a nu atinge corecțiile E3b. Activarea fluxului pe un tronson cere rânduri legate, dar activarea e o operație separată și nu face parte din apply.

Lock-uri: `ACCESS EXCLUSIVE` pe `izo_proiect_config`, `executie_tronsoane`, `executie_pachete_lansare`, `executie_tevi`, `executie_pachete_documente` cât durează tranzacția (DDL scurt; rulează în afara orelor de lucru sau cu pagina Execuție închisă).

## Ce se schimbă pe prod

Date: niciuna. Migrarea nu are DML pe date. `INSERT INTO executie_pachete_documente` apare doar în corpul unei funcții.

- **Rol nou** `izo_montaj_writer` (NOLOGIN, NOINHERIT, NOBYPASSRLS), cu `GRANT izo_montaj_writer TO postgres WITH INHERIT FALSE, SET TRUE`, după modelul `izo_registru_writer` din E2a. Drepturile lui:
  - USAGE pe schema `public` și pe `izo_server_ver_seq`;
  - SELECT/UPDATE pe `magazie_bucati`, `executie_tevi`, `executie_pachete_lansare`, `izo_tronson_config`, prin politici RLS `TO izo_montaj_writer`.
  - CREATE pe `public` i se dă doar temporar, în timpul migrării, și i se retrage tot acolo.
- **Tabel nou** `izo_tronson_config`: flux per tronson (Q-E4-1 A), cu RLS. `authenticated` are doar SELECT; scrierea merge numai prin `fn_izo_seteaza_flux`, din sesiunea postgres.
- **Funcții noi (20):**
  - `fn_izo_flux_*` (garda, config_garda, pdf_blocat, pachet_lock / editabil / identitate / legatura / completeaza / dupa, admin, aprobare_admin);
  - `fn_izo_pachet_leaga` / `dezleaga` / `completeaza` / `aprobare_transgaz`;
  - `fn_izo_montaj_marcheaza`, `fn_izo_garda_montaj`, `fn_izo_seteaza_flux`;
  - `fn_izo_porti_e4_definitii` / `_lipsa`.
  - EXECUTE pentru `authenticated` au DOAR `fn_izo_pachet_leaga`, `fn_izo_pachet_dezleaga` și `fn_izo_pachet_completeaza` (aceasta din urmă rămâne ascunsă în UI până la E4b).
  - `fn_izo_flux_pdf_blocat(text,text)`: EXECUTE pentru anon/authenticated/service_role, pentru că predicatul politicilor RLS se evaluează cu rolul apelantului. E read-only (`STABLE`, fără scrieri și fără context).
  - `fn_izo_seteaza_flux` și `fn_izo_pachet_aprobare_transgaz` se execută doar de `postgres`. Helper-ele interne se execută doar de `izo_montaj_writer`; PUBLIC are `REVOKE ALL`.
- **Funcții înlocuite (3, cu restaurare exactă în rollback):** `fn_izo_porti_lipsa`, `fn_izo_garda_bucati` și `fn_izo_garda_fapte`, la care se adaugă termenul `izo_montaj_writer` în `v_aut`.
- **Trigger-e noi `a0_izo_flux_*` (ENABLE ALWAYS):** pe `executie_tronsoane`, `executie_tevi`, `executie_pachete_lansare` (BEFORE și AFTER), `executie_pachete_documente`, `izo_tronson_config`. Pe `storage.objects` nu se pune niciun trigger.
- **Politici noi pe `storage.objects` (r2):** `izo_flux_pdf_imuabil_upd` / `_del`, AS RESTRICTIVE, TO public.
  - Pe tronsoanele care NU sunt în flux, trigger-ele lasă totul ca azi.
- **Index unic parțial** `ux_magbuc_izo_teava` pe `magazie_bucati(executie_teava_id)`.
- **Comentariu** pe `magazie_bucati_evenimente`: amprenta E4a plus comentariul anterior. Rollback-ul îl restaurează.

## Ce NU atinge

- `app_modules` și `user_module_access`: neatinse. Q-E4-9 (cheie de modul și drepturi) așteaptă „da” separat. Codul doar CITEȘTE `user_module_access` (`module='executie.izometrie'`).
- Datele existente, corecțiile E3b, OCR (E9), Magazie EIP.
- Fluxul nu e activ pe niciun tronson după apply: `flux_montaj` e false implicit, iar activarea e un pas separat, din sesiunea postgres, cu „da”.

## Rollback

`20261109a_izometrie_e4a_flux_ROLLBACK.sql` șterge tot ce s-a creat (inclusiv rolul) și restaurează exact corpurile celor 3 funcții și comentariul. Harness-ul verifică restaurarea exactă, plus faptul că rollback-ul E3b trece și după rollback-ul E4a. Dacă după apply fluxul a fost deja activat pe vreun tronson, rollback-ul trebuie precedat de dezactivare. Altfel rândurile din `izo_tronson_config` se pierd odată cu tabelul.

## Împreună cu E4b sau separat

**Recomandat: A, separat, acum.** E4a are GO-ul Copilot. Migrarea E4b (`20261109b`) nu a trecut încă prin review și depinde de corpurile finale ale E4a (precondiții md5). Dacă E4a se aplică acum, E4b se generează pe baza deja aplicată. B (ambele odată) ar ține E4a în așteptare până la GO-ul E4b, probabil câteva zile.

Ordinea pentru #869: **întâi apply, apoi merge.** UI-ul nou citește `izo_tronson_config` și apelează RPC-urile E4a; un merge fără apply ar da erori în ecranul Izometrie.

## Dry-run sugerat (chat)

Runner-ul nu are flag de dry-run; ca la E3b: `BEGIN; <prolog runner>; \i migrare; SELECT fn_izo_porti_lipsa()||fn_izo_porti_e3_lipsa()||fn_izo_porti_e4_lipsa(); \i control_0e.sql; ROLLBACK;`. Rezultatul așteptat: porți `{}`, 0e = 0, fără erori. **r2: recomand să ruleze în același DRY și revenirea** (`\i` rollback după migrare, apoi `ROLLBACK`). Așa se verifică pe prod că `DROP POLICY … ON storage.objects` merge ca postgres. CREATE POLICY e dovedit de E3, DROP-ul nu a rulat niciodată pe prod.
