#!/usr/bin/env bash
# Test local PG16 pentru 20261115a: schelet minim prod-like, apply ca postgres NOSUPERUSER, verificări RLS, revenire.
# Rulat ca utilizatorul WSL postgres (initdb refuză root). Nu atinge prod.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN=/usr/lib/postgresql/16/bin
D=$(mktemp -d /tmp/t1115.XXXX); PORT=6488
$BIN/initdb -D "$D/data" -U supabase_admin --auth=trust >/dev/null
$BIN/pg_ctl -D "$D/data" -o "-p $PORT -k $D" -l "$D/log" -w start >/dev/null
trap '$BIN/pg_ctl -D "$D/data" -m fast -w stop >/dev/null 2>&1; rm -rf "$D"' EXIT
A=("$BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$D" -p $PORT -U supabase_admin -d postgres)
P=("$BIN/psql" -X -q -At -v ON_ERROR_STOP=1 -h "$D" -p $PORT -U postgres -d postgres)
"${A[@]}" <<'SQL'
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE BYPASSRLS;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
GRANT anon, authenticated TO postgres;
CREATE SCHEMA auth AUTHORIZATION postgres;
GRANT ALL ON SCHEMA public TO postgres;
SQL
"${P[@]}" <<'SQL'
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_owner boolean DEFAULT false);
CREATE TABLE public.user_module_access (id serial PRIMARY KEY, profile_id uuid, module text, access_level text);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY ps ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY us ON public.user_module_access FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.profiles, public.user_module_access TO authenticated;
CREATE TABLE public.magazie_inventar_angajat (id bigserial PRIMARY KEY, employee_id int, cantitate numeric);
ALTER TABLE public.magazie_inventar_angajat ENABLE ROW LEVEL SECURITY;
CREATE POLICY mia_select ON public.magazie_inventar_angajat FOR SELECT TO authenticated USING (true);
CREATE POLICY mia_insert ON public.magazie_inventar_angajat FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY mia_update ON public.magazie_inventar_angajat FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY mia_delete ON public.magazie_inventar_angajat FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TABLE public.hr_aprobatori (id int); CREATE TABLE public.hr_cereri_concediu (id int); CREATE TABLE public.hr_concediu_rute (id int);
ALTER TABLE public.hr_aprobatori ENABLE ROW LEVEL SECURITY; ALTER TABLE public.hr_cereri_concediu ENABLE ROW LEVEL SECURITY; ALTER TABLE public.hr_concediu_rute ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON public.hr_aprobatori, public.hr_cereri_concediu, public.hr_concediu_rute, public.magazie_inventar_angajat TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.magazie_inventar_angajat TO authenticated;
GRANT USAGE ON SEQUENCE public.magazie_inventar_angajat_id_seq TO authenticated;
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-00000000000a', false), ('00000000-0000-0000-0000-00000000000b', false),
  ('00000000-0000-0000-0000-00000000000c', false), ('00000000-0000-0000-0000-00000000000d', true);
INSERT INTO public.user_module_access(profile_id, module, access_level) VALUES
  ('00000000-0000-0000-0000-00000000000b', 'magazie', 'editor'), ('00000000-0000-0000-0000-00000000000c', 'hr', 'admin'),
  ('00000000-0000-0000-0000-00000000000c', 'magazie', 'viewer');
INSERT INTO public.magazie_inventar_angajat(employee_id, cantitate) SELECT g, 1 FROM generate_series(1, 5) g;
SQL
FP="SELECT md5(string_agg(polname::text||'|'||polcmd::text||'|'||polpermissive::text||'|'||polroles::regrole[]::text||'|'||coalesce(pg_get_expr(polqual,polrelid),'')||'|'||coalesce(pg_get_expr(polwithcheck,polrelid),''),';' ORDER BY polname)) FROM pg_policy WHERE polrelid='public.magazie_inventar_angajat'::regclass"
F0=$("${P[@]}" -c "$FP"); echo "amprenta locală înainte: $F0"
MIG=$(mktemp); sed "s/668a7e226edbe58202b35858ef0f2b96/$F0/" "$SRC/supabase/migrations/20261115a_sec_inventar_hr_anon.sql" > "$MIG"
REV=$(mktemp); sed "s/668a7e226edbe58202b35858ef0f2b96/$F0/" "$SRC/supabase/revenire/20261115a_sec_inventar_hr_anon_ROLLBACK.sql" > "$REV"
echo "== apply fără runner (trebuie refuzat)"
if "${P[@]}" -f "$MIG" 2>/dev/null; then echo "ESEC: aplicat fără marcaj"; exit 1; else echo "OK refuzat"; fi
echo "== apply cu marcajul runner-ului"
{ echo "BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261115a_sec_inventar_hr_anon:' || txid_current(), true) \\gset"; cat "$MIG"; echo "COMMIT;"; } | "${P[@]}" -f - >/dev/null
cnt() { "${P[@]}" -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$1', true); $2; ROLLBACK;" | grep -v '^$' | tail -1; }
S=$(cnt 00000000-0000-0000-0000-00000000000a "SELECT count(*) FROM public.magazie_inventar_angajat"); echo "fără modul vede: $S (așteptat 0)"; [ "$S" = 0 ]
S=$(cnt 00000000-0000-0000-0000-00000000000b "SELECT count(*) FROM public.magazie_inventar_angajat"); echo "magazie editor vede: $S (așteptat 5)"; [ "$S" = 5 ]
S=$(cnt 00000000-0000-0000-0000-00000000000c "SELECT count(*) FROM public.magazie_inventar_angajat"); echo "hr admin + magazie viewer vede: $S (așteptat 5)"; [ "$S" = 5 ]
S=$(cnt 00000000-0000-0000-0000-00000000000d "SELECT count(*) FROM public.magazie_inventar_angajat"); echo "owner vede: $S (așteptat 5)"; [ "$S" = 5 ]
S=$(cnt 00000000-0000-0000-0000-00000000000c "WITH u AS (UPDATE public.magazie_inventar_angajat SET cantitate=2 RETURNING 1) SELECT count(*) FROM u"); echo "hr/viewer modifică: $S (așteptat 0)"; [ "$S" = 0 ]
S=$(cnt 00000000-0000-0000-0000-00000000000a "WITH u AS (DELETE FROM public.magazie_inventar_angajat RETURNING 1) SELECT count(*) FROM u"); echo "fără modul șterge: $S (așteptat 0)"; [ "$S" = 0 ]
S=$(cnt 00000000-0000-0000-0000-00000000000b "WITH u AS (UPDATE public.magazie_inventar_angajat SET cantitate=2 RETURNING 1) SELECT count(*) FROM u"); echo "magazie editor modifică: $S (așteptat 5)"; [ "$S" = 5 ]
if "${P[@]}" -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',true); INSERT INTO public.magazie_inventar_angajat(employee_id,cantitate) VALUES(9,1); COMMIT;" 2>/dev/null; then echo "ESEC: hr/viewer a inserat"; exit 1; else echo "hr/viewer inserează: refuzat (OK)"; fi
G=$("${P[@]}" -c "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public'"); echo "granturi anon rămase: $G (așteptat 0)"; [ "$G" = 0 ]
echo "== reaplicare (trebuie refuzată de amprentă)"
if { echo "BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261115a_sec_inventar_hr_anon:' || txid_current(), true) \\gset"; cat "$MIG"; echo "COMMIT;"; } | "${P[@]}" -f - 2>/dev/null; then echo "ESEC: reaplicat"; exit 1; else echo "OK refuzat"; fi
echo "== revenire"
{ echo "BEGIN; SELECT set_config('gazpet.revenire_20261115a', 'SEC_20261115A_SCOATE:' || txid_current(), true) \\gset"; cat "$REV"; echo "COMMIT;"; } | "${P[@]}" -f - >/dev/null
F1=$("${P[@]}" -c "$FP"); echo "amprenta după revenire: $F1"; [ "$F1" = "$F0" ]
G=$("${P[@]}" -c "SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public'"); echo "tabele cu anon după revenire: $G (așteptat 4)"; [ "$G" = 4 ]
echo "PASS 20261115a: apply prin runner, RLS pe 4 profiluri, scriere restrânsă, anon revocat, reaplicare refuzată, revenire exactă"
