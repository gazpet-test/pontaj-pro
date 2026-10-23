# E4a — pachetul de livrare (run_mig DRY → „da” → apply)

Branch `izometrie/e4a` @ `4b183b90` (conținut identic cu `046f9946`, la care s-a dat GO-ul Copilot; după el vin doar commit-ul de normalizare LF și acest document). PR #869 (draft).

## Artefacte

| Fișier | sha256 (blob git, LF) | octeți |
|---|---|---|
| `supabase/migrations/20261109a_izometrie_e4a_flux.sql` | `43ee46b59327ec04c26b4824764eb3ef5a62ca1a3033e99d8117c64736d2be24` | 125674 |
| `supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql` | `09ff62fcadedd5792d26c1c81e63c3baf16ad77a8ba440003931e93aa5581f70` | 74710 |

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
  - `fn_izo_flux_*` (garda, config_garda, storage, pachet_lock / editabil / identitate / legatura / completeaza / dupa, admin, aprobare_admin);
  - `fn_izo_pachet_leaga` / `dezleaga` / `completeaza` / `aprobare_transgaz`;
  - `fn_izo_montaj_marcheaza`, `fn_izo_garda_montaj`, `fn_izo_seteaza_flux`;
  - `fn_izo_porti_e4_definitii` / `_lipsa`.
  - EXECUTE pentru `authenticated` au DOAR `fn_izo_pachet_leaga`, `fn_izo_pachet_dezleaga` și `fn_izo_pachet_completeaza` (aceasta din urmă rămâne ascunsă în UI până la E4b).
  - `fn_izo_seteaza_flux` și `fn_izo_pachet_aprobare_transgaz` se execută doar de `postgres`. Helper-ele interne se execută doar de `izo_montaj_writer`; PUBLIC are `REVOKE ALL`.
- **Funcții înlocuite (3, cu restaurare exactă în rollback):** `fn_izo_porti_lipsa`, `fn_izo_garda_bucati` și `fn_izo_garda_fapte`, la care se adaugă termenul `izo_montaj_writer` în `v_aut`.
- **Trigger-e noi `a0_izo_flux_*` (ENABLE ALWAYS):**
  - pe `executie_tronsoane`, `executie_tevi`, `executie_pachete_lansare` (BEFORE și AFTER), `executie_pachete_documente`, `izo_tronson_config`;
  - **pe `storage.objects`** (BEFORE UPDATE/DELETE): face PDF-urile pachetelor în flux imuabile.
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

Runner-ul nu are flag de dry-run; ca la E3b: `BEGIN; <prolog runner>; \i migrare; SELECT fn_izo_porti_lipsa()||fn_izo_porti_e3_lipsa()||fn_izo_porti_e4_lipsa(); \i control_0e.sql; ROLLBACK;`. Rezultatul așteptat: porți `{}`, 0e = 0, fără erori.
