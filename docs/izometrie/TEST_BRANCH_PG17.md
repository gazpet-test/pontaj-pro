# E2a + 20261102b — testul pe branch-ul Supabase (PG17, postgres NON-superuser): rezultatele brute

Ținta: branch Supabase creat de chat din dashboard (fără date), project_ref `bcdrieikeztgablqhfnp`, PostgreSQL 17.11, `postgres` fără SUPERUSER (CREATEROLE, BYPASSRLS). Conexiunea trece prin pooler-ul de sesiune. Parola stă în pgpass, copiat temporar (600), deci nu apare în comenzi sau în log-uri.

Pașii fiecărei rulări:
- **Scriptul:** scratchpad `test_branch.sh`. Blocurile 0–5 sunt descrise mai jos; scheletul de pe branch e cel din `supabase/tests/izometrie_e2a_schelet.sql`, cu ACL-ul `magazie_bucati` adus la forma de pe live.
- **Reluare:** reset_branch + schelet + curățarea rolurilor la nivel de cluster. Registrul e append-only, deci un test eșuat nu se poate curăța altfel.
- **PostgREST:** se apelează cu cheia anon publică a branch-ului.

Blocuri:
- **0** — ținta: system_identifier, PG17, non-superuser, schelet aplicat;
- **1** — livrarea prin runner (CREATE ROLE, GRANT … WITH SET, ALTER OWNER ca non-superuser) + porțile + amprenta PG17;
- **2** — revenirea armată (DROP ROLE ca non-superuser) → relivrare → aceeași amprentă;
- **3** — testele SQL E2a;
- **4** — conexiune proaspătă + un utilizator API REAL prin pooler;
- **5** — 20261102b + testele SQL ale bonurilor.

## r9 — head a6ef06c6 (21.10.2026)

Rulările anterioare:
- **r7 (5123303b):** la ALTER OWNER, `permission denied for function fn_izo_seteaza_nivel`. Postgres non-superuser nu mai poate da GRANT pe o funcție care nu-i aparține → reparat în r8: GRANT-ul îl dă owner-ul, sub SET LOCAL ROLE.
- **r8 (0c2d50fd):** `Postcondiție 1: alți membri decât postgres în izo_registru_writer`. PG16+ adaugă automat rândul ADMIN al creatorului (grantor supabase_admin) → reparat în r9.
- Prima rulare r9 a picat la T8i: `permission denied to set role "izo_test_admin"`. Creatorul are doar ADMIN pe rolul de test → reparat în 4faeb770.

Rularea completă r9:

```
85633d7d5685ad5215922e7ed9e9fe47c39b0765705a12a5c7d29ffa7ff63e4d  supabase/migrations/20261102a_izometrie_e2a_registru.sql
64a1dbc72c18703e34e35e1dfa55c8f9bfd991976e9f6bd561ffce813efb00eb  supabase/migrations/20261102b_bon_salvare_tranzactionala.sql
OK   0 țintă: branch bcdrieikeztgablqhfnp, PG17, postgres non-superuser, schelet aplicat
     MEMBRI|postgres|t|f|f
     MEMBRI|postgres|f|f|t
     OWNERI|fn_izo_activeaza_si_importa,fn_izo_import_sold_initial,fn_izo_import_storno,fn_izo_seteaza_nivel
OK   1 livrare prin runner pe PG17 (rol, membru WITH SET, ALTER OWNER), porți complete · amprenta PG17 = 78549424552b8327bf2aec4b7ca157b6
OK   2 revenire armată pe PG17 (DROP ROLE ca non-superuser) → totul scos, TRUNCATE refăcut · relivrare → aceeași amprentă
OK   3 teste SQL pe PG17: 153 verificări
OK   4 conexiune proaspătă: writer fără marcaj → garda · REPEATABLE READ → refuz · utilizator API real prin pooler + DEFINER postgres → atribuirea refuzată
OK   5 20261102b pe PG17: 21 verificări SQL · amprenta funcției 3a66e3336077693a80b9781a100002a7
PASS test_branch bcdrieikeztgablqhfnp — amprenta E2a PG17 78549424552b8327bf2aec4b7ca157b6 · fn_bon_salveaza 3a66e3336077693a80b9781a100002a7
```

PostgREST (cheia anon), r9:

```
RPC fn_izo_seteaza_nivel anon → HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for function fn_izo_seteaza_nivel"}
RPC fn_izo_import_sold_initial anon → HTTP 401 {"code":"42501",…,"message":"permission denied for function fn_izo_import_sold_initial"}
RPC fn_izo_import_storno anon → HTTP 401 {"code":"42501",…,"message":"permission denied for function fn_izo_import_storno"}
RPC fn_izo_activeaza_si_importa anon → HTTP 401 {"code":"42501",…,"message":"permission denied for function fn_izo_activeaza_si_importa"}
RPC fn_izo_porti_lipsa anon → HTTP 401 {"code":"42501",…,"message":"permission denied for function fn_izo_porti_lipsa"}
RPC fn_izo_lock_partajat anon → HTTP 401 {"code":"42501",…,"message":"permission denied for function fn_izo_lock_partajat"}
RPC fn_bon_salveaza anon → HTTP 401 {"code":"42501",…,"message":"permission denied for function fn_bon_salveaza"}
GET magazie_bucati anon → HTTP 200 []
PATCH magazie_bucati anon → HTTP 200 []
POST izo_atribuiri anon → HTTP 401 {"code":"42501",…,"hint":"Grant the required privileges to the current role with: GRANT INSERT ON public.iz…
POST izo_importuri anon → HTTP 401 {"code":"42501",…
POST izo_proiect_config anon → HTTP 401 {"code":"42501",…
POST magazie_bucati_evenimente anon → HTTP 401 {"code":"42501",…
observatii=anon scrise: 0
```

## r10 — head a98b1981 (21.10.2026)

Blocurile 0–3 au trecut din prima rulare. La blocul 4, prima încercare a dat `password authentication failed for user "izo_api_test"` și apoi `permission denied to set role "authenticated"`. Cauza: pooler-ul (Supavisor) ținea conexiuni ale rolului șters care avea același nume. Rolul API de test primește acum un nume nou la fiecare rulare. Blocurile 4–5 au fost reluate pe aceeași bază.

```
1087f6bfb9458f10a193d21e9118752126f67cf0fe0aa50fb72c6d53daefc1db  supabase/migrations/20261102a_izometrie_e2a_registru.sql
646087496e0a54bee1e109f04549b6c5375935ccadb141e3cb12d5f66fb22c68  supabase/migrations/20261102b_bon_salvare_tranzactionala.sql
OK   0 țintă: branch bcdrieikeztgablqhfnp, PG17, postgres non-superuser, schelet aplicat
     MEMBRI|postgres|t|f|f
     MEMBRI|postgres|f|f|t
     OWNERI|fn_izo_activeaza_si_importa,fn_izo_import_sold_initial,fn_izo_import_storno,fn_izo_seteaza_nivel
OK   1 livrare prin runner pe PG17 (rol, membru WITH SET, ALTER OWNER), porți complete · amprenta PG17 = 491007c5c51dc9b7b2d53661c06b6b9b
OK   2 revenire armată pe PG17 (DROP ROLE ca non-superuser) → totul scos, TRUNCATE refăcut · relivrare → aceeași amprentă
OK   3 teste SQL pe PG17: 154 verificări
OK   4 conexiune proaspătă: writer fără marcaj → garda · REPEATABLE READ → refuz · utilizator API real prin pooler + DEFINER postgres → atribuirea refuzată
OK   5 20261102b pe PG17: 28 verificări SQL · amprenta funcției 6a0dd7451636eaa710815d0c86e920f8
PASS test_branch bcdrieikeztgablqhfnp — amprenta E2a PG17 491007c5c51dc9b7b2d53661c06b6b9b · fn_bon_salveaza 6a0dd7451636eaa710815d0c86e920f8
```

PostgREST (cheia anon), r10: identic cu r9 pentru cele 7 RPC-uri și pentru tabele; în plus:

```
RPC fn_bon_linii_versiune anon → HTTP 404 {"code":"PGRST202",…}   (funcție de trigger, neapelabilă)
roluri izo: izo_registru_writer   (niciun rol de test rămas)
```

## r11 — de completat după retest

(r11: porțile de citire în 20261102a + bonurile pe RPC-uri DEFINER cu liniile închise pentru API. Amprenta E2a se schimbă; cea PG17 se fixează în `c_amprente` după retest.)
