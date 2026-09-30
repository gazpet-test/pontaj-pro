# RLS Ofertare — prețuri, oferte furnizori și celelalte tabele deschise (DRAFT, NEAPLICAT)

Migrare: `supabase/migrations/20261004b_rls_ofertare_preturi_oferte.sql` · Revenire: `supabase/revenire/20261004b_rls_ofertare_preturi_oferte_ROLLBACK.sql`
Test: `node scripts/test_rls_ofertare.mjs` (PG17 local, 147 verificări) · Starea live reconstruită: `supabase/tests/rls_ofertare_live_state.sql`

## 1. De unde vine
- `docs/SECURITATE_MATRICE_ACCES_2026-09-30.md` §1.5 (rândurile `ofertare_preturi_*`, `ofertare_oferte_furnizori`, `ofertare_parteneri`, `_calibrari_subcontractori`, `oferta_materiale`, `probe_oferte`, `ofertare_oferte_deschidere`, `ofertare_rfq_*`), constatarea #6 și recomandarea §4 („`fn_are_acces_ofertare()` la citire ȘI scriere pe prețuri/oferte”).
- #537 (SEC Ofertare) acoperă doar cele 2 RPC-uri (`fn_ofertare_alege_acoperire`, `ofertare_inventar_pereche`) și spune explicit că nu atinge tabele/politici. Aici e partea de RLS + privilegii pe tabele. TRUNCATE pentru `authenticated` rămâne în P14 (TRUNCATE/default privileges).
- Inventar read-only pe live (30.09, `pg_policies`, `has_table_privilege`): pe toate cele 20 de tabele scrierea cere doar `auth.uid() IS NOT NULL` (sau `true` la citire), iar `anon` are ACL `arwdDxtm`. Pe restul tabelelor `ofertare_*` scrierea cere deja `fn_are_acces_ofertare()` și nu sunt în domeniu.

## 2. Helper
Se refolosește `public.fn_are_acces_ofertare()`. Amprenta verificată EXACT în precondiție (citită read-only pe live 30.09): proprietar `postgres`, `LANGUAGE sql`, `proconfig = {search_path=public, pg_temp}`, returnează `boolean` (nu set), `prokind = f`, 0 argumente / 0 implicite, semnătura `fn_are_acces_ofertare()` în `public`, SECURITY DEFINER, STABLE, md5(prosrc) `429d28e2a61fb24c8009d67050c16c85`, ACL = EXECUTE exact pentru `postgres`, `authenticated`, `service_role` (fără anon, fără PUBLIC), și **niciun alt `pg_proc` cu numele `fn_are_acces_ofertare` în nicio schemă** (un overload cu argumente implicite ar face apelul ambiguu/deturnabil). Regula: `auth.uid()` nenul ȘI (`profiles.is_owner` SAU rând `user_module_access.module = 'ofertare'` exact). Rolul singur nu ajunge. Nu s-a creat helper nou (`has_ofertare_access()` ar fi fost un duplicat). Migrarea refuză dacă amprenta helper-ului s-a schimbat.

## 3. Matricea tabelelor (azi → după)
Notație: Y = orice cont logat, M = modulul `ofertare` sau owner, anon = privilegiu de tabel.

| Tabel | Grup | Azi S / I / U / D | După S / I / U / D | anon azi → după |
|---|---|---|---|---|
| `ofertare_preturi_materiale` (~3860) | A | Y / Y / Y / Y | M / M / M / M | ALL → nimic |
| `ofertare_preturi_unitare` | A | Y / Y / Y / Y | M / M / M / M | ALL → nimic |
| `ofertare_oferte_furnizori` (~2400) | A | Y / Y / Y / Y (politici pe `public`) | M / M / M / M | ALL → nimic |
| `oferta_materiale` | A | `true` / Y / Y / Y | M / M / M / M | ALL → nimic |
| `probe_oferte` | A | `true` / Y / Y / Y | M / M / M / M | ALL → nimic |
| `ofertare_rfq`, `_rfq_destinatari`, `_rfq_materiale`, `_rfq_oferte`, `_rfq_preturi` | A | Y / Y / Y / Y | M / M / M / M | ALL → nimic |
| `ofertare_oferte_deschidere` | A | Y / Y / Y / Y | M / M / M / M | ALL → nimic |
| `ofertare_calibrari`, `ofertare_calibrari_subcontractori` (~165) | A | Y / Y / Y / Y | M / M / M / M | ALL → nimic |
| `ofertare_parteneri` (~43) | B | Y / Y / Y / Y | **Y** / M / M / M | ALL → nimic |
| `ofertare_norme_productivitate` | B | Y / Y / Y / Y | **Y** / M / M / M | ALL → nimic |
| `ofertare_brokeri`, `_categorii_reguli`, `_experienta`, `_normative`, `_radar` | **A** (runda 2) | Y / Y / Y / Y | M / M / M / M | ALL → nimic |

Grupul B (runda 2) = **doar** `ofertare_parteneri` și `ofertare_norme_productivitate`, singurele citite din ecrane din afara Ofertare (§4). `ofertare_brokeri`, `_categorii_reguli`, `_experienta`, `_normative`, `_radar` au trecut în A: re-scan `src/` + `supabase/functions/` + dependențe live (views/funcții) — cititorii lor din client sunt doar `OfertareLicitatii.jsx` și `OfertareGarantie.jsx` (importat doar din `OfertareLicitatii.jsx`, randat în `Ofertare.jsx` sub `/ofertare`); niciun view nu le folosește; singurele funcții care le citesc (`fn_subiect_total`, `fn_categorie_cantitate`) sunt SECURITY DEFINER (ocolesc RLS); edge-urile (`ofertare-radar-scan`, `ofertare-alerte-mail`, `ofertare-acoperire`) scriu cu `service_role`. **Ecrane la risc din mutarea în A: niciunul identificat.**

**Re-extinderea grupului B (citire pentru orice cont logat) e decizie de business a lui Răzvan**, nu tehnică: dacă un ecran din afara Ofertare are nevoie de unul din tabele, se decide explicit (tabel în B, sau ecranul cere modulul). Toate politicile noi sunt `TO authenticated` (cele vechi pe `public` dispar). `service_role` (edge-urile) ocolește RLS și nu e afectat.

## 4. Cine citește / scrie aceste tabele din client (scan `src/`, `supabase/functions/`)
| Loc | Tabel(e) | Operație | Ecran / rută | Efect după patch |
|---|---|---|---|---|
| `OfertareLicitatii.jsx`, `OfertareRFQ.jsx`, `OfertareParteneri.jsx`, `OfertareCerinte.jsx`, `OfertarePropunere.jsx`, `OfertareGarantie.jsx`, `Ofertare.jsx` (`probe_oferte`) | A + B | S/I/U/D | `/ofertare` (`requireModule="ofertare"`) | niciunul pentru cei cu modulul `ofertare` sau owner |
| `SedintePage.jsx:823` | `ofertare_parteneri` | doar S | `/sedinte` (fără modul) | niciunul (B păstrează citirea) |
| `GeneratorContractMontaj.jsx:427` (în Contracte comerciale / terți) | `ofertare_parteneri` | doar S | Contracte | niciunul (B) |
| `GraficPoarta.jsx:246` (Grafic lucrare) | `ofertare_norme_productivitate` | doar S | Grafic lucrare | niciunul (B). `ofertare_cantitati` nu e în domeniu |
| views `v_ofertare_dotari`, `v_ofertare_pt_stare` (`security_invoker=on`) | `ofertare_parteneri` | S | Ofertare | niciunul (B) |
| — (re-scan runda 2) | `ofertare_brokeri`, `_categorii_reguli`, `_experienta`, `_normative`, `_radar` | S/I/U/D | doar `/ofertare` (`OfertareLicitatii.jsx`, `OfertareGarantie.jsx`); `_categorii_reguli` fără cititor în client | niciunul (A) |
| edge `ofertare-rfq-import`, `ofertare-rfq-inbox`, `ofertare-radar-scan`, `ofertare-alerte-mail`, `ofertare-acoperire` | rfq*, radar, experienta, parteneri | S/I/U | cron / UI | niciunul: scriu cu `service_role` |

**Ecrane care s-ar strica: niciunul identificat.** Toate scrierile din client sunt în ecranele de sub `/ofertare`, iar citirile din afara Ofertare sunt doar pe tabele din grupul B.

**Utilizatori la risc (live 30.09):** în `user_module_access` există 9 rânduri `ofertare` și **zero** rânduri `ofertare.<sub-modul>`; 2 owneri. `hasModuleAccess` din `App.jsx` acceptă și `ofertare.*`, dar poarta cere `ofertare` exact — azi nu există astfel de conturi, deci nu pierde nimeni acces. De reverificat la apply (interogarea de la §6 pas 1). Un cont fără modul care folosea prin REST direct prețurile/ofertele (nu prin UI) pierde accesul — acesta e scopul.

## 5. Riscuri și limite
- **Citirea din grupul A dispare pentru cei fără modul**: dacă apare un ecran nou în afara Ofertare care citește prețuri/oferte, va primi 0 rânduri (nu eroare). Scanul de mai sus e pe `main` la 3c3187c.
- **`access_level` ignorat** (ca în #537, P16): viewer/editor/admin scriu la fel.
- **TRUNCATE/REFERENCES/TRIGGER/MAINTAIN pentru `authenticated`** rămân (TRUNCATE îl scoate F1). Pentru `anon` dispar toate 8 (REVOKE ALL), verificat explicit.
- **Default privileges** (`postgres` → `anon arwdDxtm` la tabele noi) nu se schimbă aici (P14): un tabel Ofertare nou va reveni cu anon ALL.
- **`ofertare_cantitati`**: rămâne în afara domeniului. Matricea recomandă M și la citire, dar `GraficPoarta.jsx` îl citește în afara Ofertare. **Constatare separată (propunerea din review):** în loc de citire Y pe tot tabelul, un view îngust sau un RPC doar cu coloanele de care are nevoie GraficPoarta (fără prețuri), iar tabelul trece în A. De decis de Răzvan, patch separat.
- **Compunere cu SEC F1 (#551, `20260930i`, TRUNCATE retras de la anon/authenticated)**: F1 nu lasă marcaj persistent (doar GUC-ul tranzacțional `gazpet.f1_sr_before` și rândul din `schema_migrations`). Discriminator folosit: TRUNCATE-ul lui `authenticated` pe cele 20 (patch-ul nu-l atinge): 20/20 = F1 neaplicat, 0/20 = F1 aplicat, altceva = refuz. Migrarea acceptă ambele stări anon (ALL = 8 privilegii / ALL fără TRUNCATE = 7), uniform pe toate 20 și coerent cu authenticated; orice altă stare (grant option, un tabel diferit, lipsă MAINTAIN etc.) = refuz. Rollback-ul dă `GRANT ALL` înainte de F1 și `GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN` după F1 — nu reintroduce niciodată TRUNCATE peste F1. Testat în ambele ordini.
- **authenticated**: amprenta (8 privilegii efective × 20 tabele + ACL brut + privilegii pe coloane) se salvează înainte în GUC-ul tranzacțional `gazpet.rls_ofertare_20261004b_auth` și se compară după; orice diferență anulează tot (și în rollback).
- **Coloane**: precondiția inventariază `pg_attribute.attacl` pe cele 20 (live 30.09: 0) și refuză dacă există vreun ACL pe coloană sau vreun privilegiu pentru PUBLIC; postcondiția cere anon fără privilegii pe coloane (`information_schema.column_privileges` + `has_any_column_privilege`).
- md5-ul setului de politici depinde de textul `pg_get_expr`; local (PG17) reconstrucția dă exact md5-ul citit pe live (`9784b08e…`), deci formatul coincide.

## 6. Apply (NU s-a făcut) și rollback
1. **Pre-check read-only** (execute_sql):
   ```sql
   SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd,
          coalesce(qual,''), coalesce(with_check,'')), E'\n' ORDER BY tablename, policyname),''))
   FROM pg_policies WHERE schemaname='public' AND tablename = ANY(ARRAY[ /* cele 20 din migrare */ ]);
   -- așteptat: 9784b08e2edf7f9c37b5e7873e6f0e04
   SELECT module, count(*) FROM user_module_access WHERE module LIKE 'ofertare%' GROUP BY 1; -- așteptat: doar 'ofertare'
   ```
2. GO Copilot pe diff + acordul explicit al lui Răzvan (e schimbare de drepturi, pct. 3 CLAUDE.md) + excepția la freeze-ul Ofertare.
3. `bash scripts/livrare_migrare.sh supabase/migrations/20261004b_rls_ofertare_preturi_oferte.sql …` (runner-ul din #537/#538; validatorul acceptă fișierul). Migrarea refuză fără gardă, pe live schimbat, pe ACL anon schimbat și a doua oară.
4. Verificare: md5 politici = `5a5ff33000684f9bd2bd62afbbe2ccbf` (runda 2; runda 1 era `59290db3…`); `has_table_privilege('anon', t, …)` = false pe toate 20; test manual în UI: Ofertare → RFQ / Licitații / Parteneri cu un cont cu modul; Ședințe și Contracte → lista parteneri cu un cont fără modul.
5. **Rollback** (redeschide expunerea, doar cu acordul lui Răzvan), într-o singură tranzacție:
   ```sql
   BEGIN;
   SELECT set_config('gazpet.revenire_20261004b', 'REVINE_RLS_OFERTARE:' || txid_current(), true);
   \i supabase/revenire/20261004b_rls_ofertare_preturi_oferte_ROLLBACK.sql
   COMMIT;
   ```
   Pornește doar din starea patch, reface exact cele 37 de politici citite pe 30.09 și ACL-ul anon (ALL fără F1, ALL fără TRUNCATE cu F1); postcondiție md5 = `9784b08e…`. Nu trece prin runner (validatorul îl refuză intenționat: nu are garda de livrare, are armare proprie, ca revenirile din #537).

## 7. Test
`node scripts/test_rls_ofertare.mjs` (ca root pornește serverul prin `runuser -u postgres`; `KEEP=1` păstrează clusterul). Rezultat: **147 trecute, 0 picate** (119 din runda 1, adaptate la grupurile noi, + 28 noi):
- starea live reconstruită are md5-ul citit pe live; azi un cont fără modul citește și scrie prețuri;
- gărzi: fără runner, alt nume, politică în plus, ACL anon schimbat, a doua livrare, rollback din live → refuz, fără efect;
- pe fiecare din cele 20 de tabele: anon `permission denied` la S/I/U/D; cont fără modul și cont cu doar `ofertare.rfq` → scriere refuzată, citire 0 rânduri (A) / permisă (B); cont cu modul și owner → S/I/U/D permise; claims fără `sub` → 0 rânduri; `service_role` neafectat;
- rollback armat → md5 live + anon ALL; re-livrare după rollback trece.
- runda 2 — refuz la: search_path schimbat, proprietar schimbat, EXECUTE anon, EXECUTE PUBLIC, VOLATILE, overload cu argument implicit în public, overload în altă schemă, ACL pe coloană (anon / authenticated), privilegiu PUBLIC pe tabel, anon cu grant option, anon fără TRUNCATE cu authenticated cu TRUNCATE (mixt), anon fără MAINTAIN; după patch: anon 8 privilegii false + fără coloane, authenticated identic;
- compunere F1 (F1 citit din `supabase/migrations/` dacă există, altfel `git show` din branch-ul #551; lipsă = test picat): rollback cu stare F1 ambiguă → refuz; #552 → F1 trece; rollback după F1 → anon fără TRUNCATE (discriminator), exact 7 privilegii, md5 live; F1 → #552 trece; rollback din nou fără TRUNCATE; post-F1 cu TRUNCATE anon pe un singur tabel → migrarea refuză.
