# E2a — inventarul suprafeței privilegiate (live, doar SELECT, 21.10.2026)

Cerut de review-ul Codex r2 pe PR #806 (P2-8): **evaluare, fără schimbări globale**. Singura schimbare făcută de migrare pe
un drept existent este `REVOKE TRUNCATE ON magazie_bucati FROM service_role` (revenirea îl redă).

Proiect `dxczwkbciseqniprspcu`, PostgreSQL 17.6. Interogarea e mai jos; cifrele sunt de la rularea din 21.10.2026.

| Ce | Rezultat | Impact pe registru |
|---|---|---|
| Funcții `SECURITY DEFINER` din `public` executabile de anon/authenticated | **148** (3 și de anon) | toate au `search_path` fixat (0 fără) |
| …dintre ele, care ating tabelele protejate (`magazie_bucati`, `executie_tevi`, `executie_pachete_lansare`, `logistica_depozite`, `executie_tronsoane`, `executie_bonuri_consum_linii`) | **1**: `fn_executie_swap_tevi_pozitie(p_id_a, p_id_b)` (owner postgres) | schimbă doar `poz_in_pachet` între două țevi din **același** pachet; nu atinge `pachet_id`, nu șterge — triggerele izo (DELETE / `UPDATE OF pachet_id`) nu sunt ocolite. Gărzile verifică rolul + marcajul, nu `current_user = postgres`, deci un DEFINER cu owner postgres nu trece de ele (testele T5m, 4c5). |
| Tabele cu INSERT/UPDATE/DELETE pentru anon | 299 | default privileges ale proiectului; RLS e activ pe toate tabelele (0 fără RLS) — pe tabelele izo anon nu are nimic (postcondiția 4) |
| Tabele cu drept TRIGGER pentru authenticated | 341 | `CREATE TRIGGER` cere și EXECUTE pe o funcție trigger + nu poate dezactiva triggerele izo (cere owner); triggerele izo sunt `ENABLE ALWAYS` și verificate la activare |
| Tabele cu TRUNCATE pentru service_role | 389 (înainte de migrare, inclusiv `magazie_bucati`) | `magazie_bucati`: revocat de migrare + trigger `BEFORE TRUNCATE`; tabelele registrului: fără drept + trigger |
| Tabele cu TRUNCATE pentru authenticated | 0 | — |
| Parametri pe roluri (`pg_db_role_setting`) | `authenticator`: `statement_timeout=8s`, `lock_timeout=8s`; anon 3s; authenticated 8s | o scriere din API care așteaptă lock-ul pe proiect (activare / import în curs) cade după 8s, cu eroare — fail-closed |

```sql
SELECT json_build_object(
 'definer_api_total', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
     AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'definer_atinge_tabele_protejate', (SELECT json_agg(p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
     AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
     AND p.prosrc ~* 'magazie_bucati|executie_tevi|executie_pachete_lansare|logistica_depozite|executie_tronsoane|executie_bonuri_consum_linii'),
 'tabele_truncate_service', (SELECT count(*) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
     AND has_table_privilege('service_role',c.oid,'TRUNCATE')),
 'tabele_fara_rls', (SELECT json_agg(c.relname) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT c.relrowsecurity));
```

**De reluat la livrare** (raportul de dry-run): aceeași interogare după migrare — `definer_atinge_tabele_protejate` nu
trebuie să crească fără o verificare a fiecărei funcții noi față de gărzile izo.
