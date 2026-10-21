# E2a — inventarul CITIRILOR registrului (acțiunea 6, Codex r4 · Jakarinos r6–r10)

Generat 21.10.2026 de sesiunea „Izometrie — programare”, pe producție (`dxczwkbciseqniprspcu`, PG 17.6), doar citiri din catalog. Partea de **scriere** e acoperită separat: N3 (`session_user = postgres` pe cele 4 intrări writer), allowlist-ul ACL și poarta de wrapper-e (inclusiv corpul `BEGIN ATOMIC`). Documentul de față acoperă ce lipsea: **căile de citire** care ar putea ocoli filtrarea (`magbuc_izo_client_sel` RESTRICTIVE + `fn_izo_citire`), fără să declanșeze vreun trigger de scriere.

## Ce poate ocoli filtrarea citirii

1. Un **view** fără `security_invoker`: rulează cu drepturile ownerului (postgres = BYPASSRLS pe Supabase), deci politicile RLS ale apelantului nu se mai aplică. Un **view materializat** copiază datele și nu are RLS.
2. O **funcție SECURITY DEFINER** care întoarce rânduri sau agregate din registru.
3. O **funcție INVOKER** care citește registrul, chemată dintr-o funcție DEFINER: rulează cu drepturile ownerului celei DEFINER.
4. O **funcție DEFINER cu SQL dinamic**, executabilă din API: poate citi orice tabel primit ca argument.

## Starea pe live (21.10.2026, înainte de 20261102a)

| Verificare | Rezultat | Concluzie |
|---|---|---|
| View-uri / view-uri materializate care depind (tranzitiv, `pg_depend` → `pg_rewrite`) de `magazie_bucati` | **0** | nicio cale de tip 1 |
| View-uri fără `security_invoker`, în orice schemă | 5: `pg_stat_statements_info`, `pg_stat_statements`, `vault.decrypted_secrets`, `hypopg_list_indexes`, `hypopg_hidden_indexes` | niciunul nu depinde de registru (extensii / vault) |
| View-uri fără `security_invoker` în `public` | 0 | — |
| Funcții (orice schemă non-sistem) al căror corp (`prosrc` + `pg_get_function_sqlbody`) atinge `magazie_bucati` / `izo_*` | **0** | nicio cale de tip 2 / 3 |
| Funcții care întorc tipul de rând `magazie_bucati` | 0 | — |
| Trigger-e pe `magazie_bucati` | 0 | (E2a adaugă doar trigger-ele `fn_izo_*` revizuite) |
| Politici RLS pe alte tabele care citesc `magazie_bucati` | 0 | — |
| Funcții DEFINER expuse (anon / authenticated) în `public` | 148 | niciuna nu atinge registrul (rândul de mai sus) |
| Funcții DEFINER cu SQL dinamic (`EXECUTE format/||`), orice schemă | 5, toate **neexpuse** (fără EXECUTE pentru anon / authenticated) | vezi mai jos |

### Cele 5 funcții DEFINER cu SQL dinamic (neexpuse)

| Funcție | Ce face dinamic | Poate citi registrul? |
|---|---|---|
| `_completare_goleste_camp(bigint,text,integer)` | `UPDATE public.executie_proiecte SET %I = NULL …`; câmpul e validat pe o listă fixă (`rte_employee_id`, `rts_employee_id`, `mp_employee_id`) | nu (tabel fix, identificator pe listă albă) |
| `fn_cont_inchide(uuid,text,text,integer)` | `UPDATE public.profiles SET <flaguri> = false`; flagurile vin din `fn_cont_flaguri()`, cu `%I` | nu (tabel fix) |
| `fn_cont_restaureaza_flaguri(uuid,jsonb)` | `UPDATE public.profiles SET …`; cheile sunt filtrate pe `fn_cont_flaguri()`, cu `%I` | nu (tabel fix) |
| `fn_conturi_inchideri_sweep()` | `UPDATE public.profiles SET <flaguri>`; rulează doar din pg_cron / identitate privilegiată | nu (tabel fix) |
| `fn_tichete_notif_on_insert()` (trigger) | `SELECT id FROM public.profiles WHERE %I = true`; coloana e derivată din `departament` (CHECK) | nu (tabel fix) |

Concluzie live: **nu există azi nicio cale de citire a registrului care să ocolească filtrarea.** Registrul e nou (20261102a), iar singurele funcții care îl ating sunt `fn_izo_*` din aceeași migrare, cu amprenta în COMMENT și porțile de mai jos.

## Porțile permanente (fn_izo_porti_lipsa, r11)

Activarea unui proiect (`fn_izo_seteaza_nivel` / `fn_izo_activeaza_si_importa`) e refuzată dacă apare ceva nou, nerevizuit:

- **(a)** un view / view materializat care depinde tranzitiv de `magazie_bucati`, `izo_proiect_config`, `izo_atribuiri`, `izo_importuri`, `magazie_bucati_evenimente` sau `magazie_bucati_miscari`, fără `security_invoker` (un view materializat e refuzat întotdeauna);
- **(b)** o funcție DEFINER din afara registrului (adică nu `public.fn_izo_*`), din orice schemă non-sistem, al cărei corp atinge tabelele registrului;
- **(c)** o funcție INVOKER care atinge tabelele registrului și e numită în corpul unei funcții DEFINER din afara registrului (citire tranzitivă);
- **(d)** o funcție DEFINER cu SQL dinamic executabilă din API (`public`, `graphql_public`, ca poarta 0e a runner-ului).

Teste: T13a–e în `supabase/tests/izometrie_e2a.test.sql`:
- view fără invoker, direct și tranzitiv;
- view cu invoker, acceptat;
- DEFINER care citește;
- INVOKER singur, acceptat;
- DEFINER care cheamă INVOKER-ul;
- DEFINER dinamic expus.

Toate sunt refuzate, cu excepția celor două cazuri acceptate. Porțile au fost verificate pe live: 0 obiecte prinse, deci activarea nu e blocată de starea existentă.

## Limitele (asumate, documentate)

- Porțile (b)–(d) citesc **textul** corpurilor. Un apel construit dinamic dintr-o funcție neexpusă, chemată de una expusă, nu e urmărit. Pe live, toate funcțiile dinamice lucrează pe tabele fixe (tabelul de mai sus). La orice funcție DEFINER nouă cu SQL dinamic, inventarul se refă.
- `fn_izo_*` din `public` sunt exceptate de la (b)–(d): sunt registrul însuși, revizuit, cu amprenta în COMMENT (revenirea o verifică). O funcție nouă cu prefixul `fn_izo_` intră doar prin review.
- Rolurile care pot face DDL (`postgres`, `supabase_admin`) pot oricând crea astfel de obiecte. Porțile sunt o frână la activare, nu o garanție (aceeași limită ca la PowPatroll, ctx P4). Detecția vine din amprentă și din reluarea inventarului.

## Interogările (reluare)

```sql
-- view-uri care depind tranzitiv de magazie_bucati
WITH RECURSIVE dep(oid) AS (
  SELECT 'public.magazie_bucati'::regclass::oid
  UNION SELECT r.ev_class FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN dep ON d.refobjid = dep.oid WHERE r.ev_class <> dep.oid)
SELECT oid::regclass FROM dep WHERE oid <> 'public.magazie_bucati'::regclass;
-- funcții care ating registrul (orice schemă non-sistem)
SELECT p.oid::regprocedure, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'
   AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '(magazie_bucati|izo_proiect_config|izo_atribuiri|izo_importuri)';
-- DEFINER cu SQL dinamic
SELECT p.oid::regprocedure, has_function_privilege('authenticated', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND p.prosecdef
   AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M\s+[^;]*(format|\|\|)';
```
