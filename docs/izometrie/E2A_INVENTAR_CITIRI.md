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
| Funcții DEFINER cu SQL dinamic (orice `EXECUTE`, r12), orice schemă | 6, toate în `public`, toate **neexpuse** (fără EXECUTE pentru anon / authenticated) | vezi mai jos (r11 vedea 5: `EXECUTE v_sql` scăpa filtrului `format/||`) |

### Cele 6 funcții DEFINER cu SQL dinamic (neexpuse; lista revizuită din poartă, cu md5(prosrc))

| Funcție | Ce face dinamic | Poate citi registrul? |
|---|---|---|
| `_completare_goleste_camp(bigint,text,integer)` | `UPDATE public.executie_proiecte SET %I = NULL …`; câmpul e validat pe o listă fixă (`rte_employee_id`, `rts_employee_id`, `mp_employee_id`) | nu (tabel fix, identificator pe listă albă) |
| `_completare_scrie_camp(bigint,text,text)` | `EXECUTE v_sql` = `UPDATE public.executie_proiecte SET %I = $1::<tip>`; câmpul validat pe o listă fixă de 15 coloane | nu (tabel fix, identificator pe listă albă) |
| `fn_cont_inchide(uuid,text,text,integer)` | `UPDATE public.profiles SET <flaguri> = false`; flagurile vin din `fn_cont_flaguri()`, cu `%I` | nu (tabel fix) |
| `fn_cont_restaureaza_flaguri(uuid,jsonb)` | `UPDATE public.profiles SET …`; cheile sunt filtrate pe `fn_cont_flaguri()`, cu `%I` | nu (tabel fix) |
| `fn_conturi_inchideri_sweep()` | `UPDATE public.profiles SET <flaguri>`; rulează doar din pg_cron / identitate privilegiată | nu (tabel fix) |
| `fn_tichete_notif_on_insert()` (trigger) | `SELECT id FROM public.profiles WHERE %I = true`; coloana e derivată din `departament` (CHECK) | nu (tabel fix) |

Concluzie live: **nu există azi nicio cale de citire a registrului care să ocolească filtrarea.** Registrul e nou (20261102a), iar singurele funcții care îl ating sunt `fn_izo_*` din aceeași migrare, cu amprenta în COMMENT și porțile de mai jos.

## Porțile permanente (fn_izo_porti_lipsa, r12 — închiderea tranzitivă)

r11 avea porți pe tipuri: view fără invoker, DEFINER care numește tabelele, un singur pas INVOKER, `EXECUTE format/||`. Jakarinos și Copilot (r11) au arătat ocoliri: lanțul DEFINER → INVOKER → INVOKER, un DEFINER care citește un view `security_invoker` al registrului, `EXECUTE p_sql` fără format. r12 le înlocuiește cu o **închidere până la punct fix**:

- **Sămânța:** cele 6 tabele ale registrului + orice funcție cu SQL dinamic (orice `EXECUTE`) din afara registrului și a listei revizuite. Lista revizuită conține cele 6 funcții de mai sus, cu semnătură și md5(prosrc).
- **Se adaugă repetat:**
  - view-urile și view-urile materializate care depind (`pg_depend` → `pg_rewrite`) de ceva din închidere, **inclusiv cele `security_invoker`**;
  - funcțiile din scheme non-sistem, în afara `public.fn_izo_*`, al căror corp **numește** ceva din închidere (`public`: numele simplu; alte scheme: `schema.nume`) sau care depind de el în catalog (corpuri `BEGIN ATOMIC`).
- **Refuz:** un view fără `security_invoker`, un view materializat sau o funcție `SECURITY DEFINER` în închidere.

Pe live (21.10.2026), închiderea are tabelul `magazie_bucati` și 18 funcții INVOKER cu SQL dinamic din schemele Supabase (realtime, storage, extensions). **Nicio funcție DEFINER**, deci activarea nu e blocată.

Teste în `supabase/tests/izometrie_e2a.test.sql`:
- **T13a–e** (r11): view fără invoker, direct și tranzitiv; DEFINER care citește; DEFINER → INVOKER; DEFINER dinamic.
- **T13f–h** (r12): lanțul DEFINER → INVOKER → INVOKER; DEFINER peste un view `security_invoker`; `EXECUTE p_sql` fără format; DEFINER → INVOKER dinamic.
- **Cazuri acceptate:** INVOKER singur, lanț INVOKER fără DEFINER, view invoker singur.

## Limitele (asumate, documentate)

- Închiderea citește **textul** corpurilor și dependențele din catalog. Un nume construit din bucăți (`'magazie_' || 'bucati'`) poate apărea doar într-o funcție cu `EXECUTE`, iar aceea e în sămânță: orice DEFINER care o numește e refuzat. Dacă se modifică o funcție dinamică revizuită, md5-ul se schimbă și activarea e refuzată până la un nou review.
- Funcțiile Supabase (realtime / storage / extensions) cu SQL dinamic sunt INVOKER și intră în sămânță. Dacă o actualizare a platformei adaugă un DEFINER care le numește, activarea e refuzată (fail-closed) până la review.
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
