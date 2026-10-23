# E4b — pachetul de livrare (run_mig DRY → „da” → apply)

Branch `izometrie/e4b` @ `ea7bb3a4`, PR #872 (draft). Pornește de la E4a, aplicat pe prod pe 23.10.

Review Copilot: r1 NO-GO (P0 0, 6 P1). Delta r1 (`5a4ee79b → 6709535e`): GO, P0 0, P1 0. După delta, singura schimbare e normalizarea LF a șabloanelor; migrarea generată a rămas identică.

## Artefacte

| Fișier | sha256 (blob git, LF) | octeți |
|---|---|---|
| `supabase/migrations/20261109b_izometrie_e4b_teren.sql` | `a912a2db94a89c9bccaa7c3018a16037d7931502b73074b54eeb890659e76821` | 342689 |
| `supabase/revenire/20261109b_izometrie_e4b_teren_ROLLBACK.sql` | `81aee4ff506a5747f4058c2b1179262cbeaa371e536216a9b5d55d02661c4c09` | 87207 |

Fișierele sunt generate de `scripts/izometrie/e4_gen/gen_e4b.py`. Sha-ul se ia din blob, nu din copia de lucru (CRLF pe Windows).

Runner: `scripts/livrare_migrare.sh`, ca la E3b / E4a. Propunere: `--nume 20261109b_izometrie_e4b_teren --versiune 20261109140000 --tinta-db postgres --tinta-sistem 7632885393857617092`. Versiunea e cea din harness. Migrarea refuză orice altă cale decât runner-ul.

## Precondiții

Verificate pe prod read-only, 23.10, ~22:10:
- istoricul are 2a, 2c, 3b, 6a, 9a; nu există `20261109b`;
- `fn_izo_porti_lipsa()` = `{}`;
- nu există `izo_fronturi` și nici rolul `izo_teren_editor`;
- 0 tronsoane în flux (`izo_tronson_config` gol);
- toate cele 6 precondiții md5 ale migrării se potrivesc cu prod: `fn_izo_porti_lipsa`, `fn_izo_garda_montaj`, `fn_izo_flux_admin`, `fn_izo_porti_e4_lipsa`, `fn_izo_depozit_in_registru`, `fn_izo_flux_aprobare_admin`.

## Testat local

Harness PG16 `scripts/test_izometrie_e4b.sh` în două moduri, ambele PASS:
- **prodlike (implicit):** bootstrap `supabase_admin`; `postgres` NOSUPERUSER CREATEROLE BYPASSRLS; tabelele publice ale lui `postgres`; `storage.*` al lui `supabase_storage_admin`. Livrarea și revenirea trec prin runner ca `postgres`. Modul acesta a prins o eroare reală, acum reparată: CREATE TRIGGER pe `izo_suduri` cerea EXECUTE pe funcția de gardă a writer-ului.
- **vechi:** `postgres` superuser.

Ambele moduri acoperă:
- poarta `{}` și control_0e = 0;
- snapshot, push idempotent, conflicte, identitate, rezervări, aprobare, respingere, tăieri, suduri, patru ochi, limita de rată, normalizarea SQL;
- reaplicarea refuzată și rollback-ul exact.

Pe lângă harness: teste Python pe generator, teste Node (coadă 23, birou 15, normalizare 29) și `vite build`.

## Ce se schimbă pe prod

Fără date: migrarea nu are DML pe date existente.

- **Rol nou** `izo_teren_editor` (NOLOGIN, model `izo_montaj_writer`). Funcțiile de teren sunt ale lui, cele de birou ale `izo_montaj_writer`, conform matricei §9.4. `postgres` primește cele două roluri doar WITH INHERIT FALSE, SET TRUE.
- **14 tabele noi**, toate cu RLS și `REVOKE ALL` pentru PUBLIC / anon / authenticated / service_role, plus politici pe roluri: `izo_fronturi`, `izo_dispozitive`, `izo_preverificari`, `izo_declaratii`, `izo_bucati_declarate`, `izo_rezervari`, `izo_operatii`, `izo_declaratii_versiuni`, `izo_declaratii_gps`, `izo_sync_incercari`, `izo_rata_apeluri`, `izo_aprobari`, `izo_suduri`, `izo_suduri_capete`.
- **3 view-uri** `security_invoker`: `v_izo_alerte`, `v_izo_carantina_sync`, `v_izo_rezervari_active`.
- **59 de funcții** E4b, dintre care 5 corpuri E4a / E3 înlocuite, cu precondiție md5 și restaurare exactă la rollback: `fn_izo_garda_montaj`, `fn_izo_flux_admin`, `fn_izo_porti_e4_lipsa`, `fn_izo_depozit_in_registru`, `fn_izo_flux_aprobare_admin`. Poarta `fn_izo_porti_lipsa` e re-ștampilată conform §17.4.
- **EXECUTE pentru `authenticated`** (API-ul tabletei și al biroului; dreptul se verifică în corp, pe profil, modul și atribuire):
  - tabletă: `fn_izo_sync_push`, `fn_izo_teren_instantaneu`, `fn_izo_teren_pregateste`, `fn_izo_teren_praguri`;
  - birou: `fn_izo_aprobare_lot`, `fn_izo_aproba`, `fn_izo_respinge`, `fn_izo_revizie_cere`, `fn_izo_serie_lamureste`, `fn_izo_iesire_tronson`, `fn_izo_front_elibereaza`, `fn_izo_tranzitie_confirma`, `fn_izo_fisa_verifica`;
  - `fn_izo_gps_citeste`: date private, doar pentru rolurile permise în corp.
- **Pe tabele existente** (fără date):
  - SELECT / INSERT pe coloane listate, cu politici `TO` rolurile noi, pe `magazie_bucati`, `magazie_bucati_evenimente`, `magazie_bucati_miscari`, `executie_proiecte`, `executie_tronsoane`, `logistica_depozite`, `izo_tronson_config`;
  - un index unic parțial `ux_magbuc_ev_decl` pe `magazie_bucati_evenimente(document_id, tip)`, pentru documentele `izo_declaratie`;
  - comentarii-amprentă pe `magazie_bucati_evenimente` și `izo_rata_apeluri`.
- **Fără** trigger-e, ALTER sau politici pe `storage.*`.

## Ce NU atinge

- `app_modules` / `user_module_access` (Q-E4-9 rămâne pe „da” separat). Codul doar citește `user_module_access` (`executie.izometrie`) și `izo_atribuiri`.
- Fluxul nu pornește singur: tableta și aprobarea funcționează doar pe tronsoanele cu `flux_montaj` activ, iar activarea e un pas separat, făcut din sesiunea postgres, cu „da”.
- E9 / OCR, Magazie EIP, datele existente.

## Rollback

`20261109b_izometrie_e4b_teren_ROLLBACK.sql`:
- șterge obiectele E4b; funcțiile rolurilor noi le șterge cu `SET LOCAL ROLE <proprietar>`;
- restaurează exact cele 5 corpuri și comentariile;
- revocă doar drepturile pe care le-a adăugat chiar E4b (le notează la apply);
- refuză să ruleze dacă există date operaționale E4b.

Harness-ul (ambele moduri) verifică restaurarea exactă.

## Ordinea

1. DRY pe prod: `BEGIN` + prologul runner-ului, apoi migrarea, porțile și `control_0e`, apoi **revenirea în aceeași tranzacție**, apoi `ROLLBACK`, ca la E4a r2.
2. „Da”-ul lui Răzvan pe rezultat, apoi apply prin runner și verificarea de după.
3. Merge #872 **după** apply: UI-ul apelează RPC-urile E4b; un merge fără apply ar arăta erori în cele trei taburi noi, dar nu afectează restul paginii Izometrie.
