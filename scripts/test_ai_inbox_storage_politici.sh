#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261103c_ai_inbox_storage_politici (bucket ai-documente-inbox: INSERT în folderul propriu, SELECT / DELETE
# pentru cine a urcat / poate confirma rândul legat / owner, fără UPDATE; rândul din coadă legat la INSERT de fișierul celui care
# l-a urcat, nemodificabil după, un rând per fișier).
# DOAR PG17 local dedicat (implicit /tmp/pg_ai_inbox_storage, 127.0.0.1:5976). Nu atinge producția și nici un branch Supabase.
#   0. schelet (= structura din producție 21.10, cu gaura) → baza; gaura e reprodusă (contul fără drepturi vede toate cele 10
#      obiecte); suita pe baza fără migrare TREBUIE să cadă (discriminare); V. validatorul runnerului acceptă migrarea
#   1. gărzi (fiecare pe o copie; după refuz: nimic schimbat): fără marcaj; ai_inbox_obj_all altfel decât live; altă politică ce
#      numește bucket-ul; altă politică PERMISSIVE nelegată de un bucket (OR la nivel superior); bucket public; versionare;
#      rând deschis cu obiect urcat de alt cont; authenticated fără EXECUTE pe fn_ai_inbox_poate_confirma / fără SELECT pe
#      uploadat_de; indexul patch-ului există deja; RLS oprit pe storage.objects; rând ÎNCHIS („respins”) cu obiectul altuia;
#      cale dublă; cale în afara folderului celui care a urcat; storage.objects ținut de altă sesiune → lock_timeout, nimic
#      schimbat; 1p: o politică FOR ALL fără USING / WITH CHECK trece precondiția și NU dă acces (fals pozitiv documentat)
#   2. aplicare (ca runnerul: marcaj + --single-transaction) → suita; gaura închisă; celelalte politici storage identice
#   3. reaplicare → refuz PRECONDIȚIE (exactă, nu idempotentă), starea intactă → suita
#   4. revenire: nearmată → refuz; armare persistentă → refuz; stare modificată (politică / corpul funcției de legătură / indexul
#      fără UNIQUE / trigger dezactivat) → refuz; armată → exact politica veche (gaura revine), obiectele patch-ului scoase, datele
#      și celelalte politici neatinse; reaplicare → suita
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu.  PG_BIN se poate suprascrie (ex. pe Windows: /c/Users/Public/pgsql/bin).
# ============================================================================
set -Eeuo pipefail
export PGCLIENTENCODING=UTF8
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_ai_inbox_storage}"
PORT="${PGPORT_TEST:-5976}"
BAZA=ai_inbox_storage_test
NUME=20261103c_ai_inbox_storage_politici
MIGRARE_SURSA="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK_SURSA="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
SCHELET="$RADACINA/supabase/tests/ai_inbox_storage_politici_schelet.sql"
TESTE="$RADACINA/supabase/tests/ai_inbox_storage_politici.test.sql"
TMP="$(mktemp -d)"
# migrarea are garda de livrare: aici se armează ca runnerul (marcaj local, aceeași tranzacție)
MIGRARE="$TMP/migrare.sql"
{ echo "SELECT set_config('gazpet.livrare_migrare', '$NUME:' || txid_current(), true);"; cat "$MIGRARE_SURSA"; } > "$MIGRARE"
# revenirea: un singur string, ca în antet (BEGIN + armare + fișier + COMMIT)
GUC=gazpet.revenire_20261103c
TOKEN=REDESCHIDE_INBOX_STORAGE
grep -q "^-- harness-armare: $GUC $TOKEN" "$ROLLBACK_SURSA" || { echo "MEDIU: antetul harness-armare lipsește din revenire" >&2; exit 2; }
revenire() {   # $1 = armat (da/nu), $2 = baza
  { echo "BEGIN;"
    [ "$1" = da ] && echo "SELECT set_config('$GUC', '$TOKEN:' || txid_current(), true);"
    cat "$ROLLBACK_SURSA"; echo "COMMIT;"; } > "$TMP/revenire.sql"
  "${PSQL[@]}" -d "$2" -f "$TMP/revenire.sql"
}
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
EXE=""; SOCKET=(-c unix_socket_directories=/tmp); PY="${PYTHON:-python3}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe"; SOCKET=(); PY="${PYTHON:-python}" ;; esac
PSQL=("$PG_BIN/psql$EXE" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb$EXE" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"
ca_postgres "$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$DATE_DIR.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 ${SOCKET[*]}" >/dev/null || mediu "pg_ctl start"
trap 'ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; rm -rf "$TMP"; true' EXIT
# interogări prin fișier UTF-8 (argumentele din linia de comandă nu păstrează diacriticele / ghilimelele pe Windows)
qf() { printf '%s\n' "$2" > "$TMP/qf.sql"; "${PSQL[@]}" -d "$1" -At -f "$TMP/qf.sql"; }
copie() { "${PSQL[@]}" -d postgres -c "CREATE DATABASE $1 TEMPLATE $2"; }
# câte obiecte din coadă vede contul fără drepturi (a4) — 10 = gaura, 1 = doar nedecisul (limitarea a)
vede_a4() { qf "$1" "BEGIN; SET LOCAL \"request.jwt.claims\" = '{\"sub\":\"00000000-0000-0000-0000-0000000000a4\",\"role\":\"authenticated\"}'; SET LOCAL ROLE authenticated; SELECT count(*) FROM storage.objects WHERE bucket_id = 'ai-documente-inbox'; ROLLBACK;"; }
# starea politicilor bucket-ului: <nr ai_inbox_obj_*>:<are ai_inbox_obj_all>:<obiecte patch (index + 2 funcții + 2 trigger-e)>
stare() { qf "$1" "SELECT (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND starts_with(polname::text, 'ai_inbox_obj')) || ':' || (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'ai_inbox_obj_all') || ':' || ((to_regclass('public.idx_ai_inbox_fisier_path') IS NOT NULL)::int + (to_regprocedure('public.ai_inbox_fisier_imutabil()') IS NOT NULL)::int + (to_regprocedure('public.ai_inbox_fisier_legat()') IS NOT NULL)::int + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_ai_inbox_fisier_imutabil', 'trg_ai_inbox_fisier_legat')))"; }
# amprenta celorlalte politici storage (nu ale patch-ului) și a datelor
alte_politici() { qf "$1" "SELECT md5(string_agg(polname::text || '|' || polcmd::text || '|' || polpermissive::text || '|' || polroles::text || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' ORDER BY polname)) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND NOT starts_with(polname::text, 'ai_inbox_obj')"; }
date_() { qf "$1" "SELECT md5((SELECT string_agg(bucket_id || '/' || name || '/' || coalesce(owner_id, ''), ',' ORDER BY bucket_id, name) FROM storage.objects) || (SELECT string_agg(id || '/' || fisier_path || '/' || uploadat_de || '/' || coalesce(modul_tinta, ''), ',' ORDER BY id) FROM public.ai_documente_inbox))"; }
OUT="$TMP/out.txt"
suita() { "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1 && grep -q SUITA_OK "$OUT" || { cat "$OUT"; esec "suita ($1)"; }; grep -E 'OK T[0-9]' "$OUT" | sed "s/^.*NOTICE: *//; s/^/     [$1] /"; ok "suita ($1)"; }
refuza() {   # $1 = descriere, $2 = text așteptat în eroare, restul = comanda
  local d="$1" t="$2"; shift 2
  if "$@" >"$OUT" 2>&1; then cat "$OUT"; esec "$d: a trecut, trebuia refuz"; fi
  grep -q -- "$t" "$OUT" || { cat "$OUT"; esec "$d: refuz din alt motiv (aștept „$t”)"; }
}
garda() {    # $1 = cod, $2 = descriere, $3 = SQL care strică precondiția (pe o copie), $4 = text așteptat, $5 = starea după refuz
  local db="ai_inbox_g$1_test"
  copie "$db" "$BAZA"
  qf "$db" "$3" >/dev/null
  refuza "$1 $2" "$4" "${PSQL[@]}" -d "$db" --single-transaction -f "$MIGRARE"
  [ "$(stare "$db")" = "${5:-1:1:0}" ] || esec "$1 starea s-a schimbat deși precondiția a refuzat ($(stare "$db"))"
  ok "$1 $2 → refuz PRECONDIȚIE, nimic schimbat"
}

# 0. baza
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA"
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null
[ "$(stare "$BAZA")" = "1:1:0" ] || esec "0 schelet: starea politicilor nu e cea live"
[ "$(vede_a4 "$BAZA")" = 10 ] || esec "0 schelet: gaura nu e reprodusă (contul fără drepturi ar trebui să vadă 10 obiecte, vede $(vede_a4 "$BAZA"))"
if "${PSQL[@]}" -d "$BAZA" -f "$TESTE" >"$OUT" 2>&1; then esec "0 suita trece și fără migrare (nu discriminează)"; fi
grep -q 'ESEC TEST: T1' "$OUT" || { cat "$OUT"; esec "0 suita a căzut din alt motiv"; }
ok "0 schelet (structura din producție): gaura reprodusă (contul fără drepturi vede 10/10); suita cade pe T1 fără migrare"
POL0="$(alte_politici "$BAZA")"; DATE0="$(date_ "$BAZA")"

# V. validatorul runnerului (scripts/livrare_validator.py) acceptă migrarea
PYTHONIOENCODING=utf-8 "$PY" "$RADACINA/scripts/livrare_validator.py" "$MIGRARE_SURSA" >"$OUT" 2>&1 || { cat "$OUT"; esec "V validatorul runnerului refuză migrarea"; }
ok "V validatorul runnerului: $(cat "$OUT")"

# 1. gărzi
refuza "1a fără marcaj" 'garda de livrare (start)' "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE_SURSA"
[ "$(stare "$BAZA")" = "1:1:0" ] || esec "1a starea s-a schimbat fără marcaj"
ok "1a fără marcaj → refuz (garda de livrare), nimic schimbat"
garda 1b "ai_inbox_obj_all altfel decât live" \
  "ALTER POLICY ai_inbox_obj_all ON storage.objects USING (bucket_id = 'ai-documente-inbox' AND auth.uid() IS NOT NULL)" \
  'PRECONDIȚIE 20261103c: ai_inbox_obj_all nu e exact'
garda 1c "altă politică numește bucket-ul" \
  "CREATE POLICY inbox_anon ON storage.objects FOR SELECT TO anon USING (bucket_id = 'ai-documente-inbox')" \
  'pot atinge bucket-ul ai-documente-inbox (numesc bucket-ul sau nu sunt legate de alt bucket): inbox_anon'
garda 1d "altă politică PERMISSIVE cu OR la nivel superior" \
  "CREATE POLICY lax_templates ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'templates' OR owner_id = auth.uid()::text)" \
  'nu sunt legate de alt bucket): lax_templates'
garda 1e "bucket public" "UPDATE storage.buckets SET public = true WHERE id = 'ai-documente-inbox'" 'e public'
garda 1f "versionare activă" "UPDATE storage.buckets SET versioning_status = 'ENABLED' WHERE id = 'ai-documente-inbox'" 'are versionare'
garda 1g "rând deschis cu obiect urcat de alt cont" \
  "UPDATE storage.objects SET owner_id = '00000000-0000-0000-0000-0000000000a4' WHERE name = '00000000-0000-0000-0000-0000000000a1/1_ci.pdf'" \
  '1 rând(uri) din coadă (orice stare) au obiectul urcat de alt cont'
garda 1h "authenticated fără EXECUTE pe fn_ai_inbox_poate_confirma" \
  "REVOKE EXECUTE ON FUNCTION public.fn_ai_inbox_poate_confirma(text, bigint) FROM authenticated" \
  'lipsește fn_ai_inbox_poate_confirma(text,bigint)'
garda 1i "authenticated fără SELECT pe uploadat_de" \
  "REVOKE SELECT ON public.ai_documente_inbox FROM authenticated; GRANT SELECT (id, fisier_path, modul_tinta, entitate_id, status) ON public.ai_documente_inbox TO authenticated" \
  'authenticated nu are SELECT pe ai_documente_inbox.uploadat_de'
garda 1j "indexul patch-ului există deja" \
  "CREATE INDEX idx_ai_inbox_fisier_path ON public.ai_documente_inbox (fisier_path)" \
  'indexul / funcțiile / trigger-ele patch-ului există deja' 1:1:1
garda 1k "RLS oprit pe storage.objects" "ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY" 'RLS nu e activ pe storage.objects'
garda 1l "rând ÎNCHIS (respins) falsificat, cu calea cazierului HR" \
  "INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES ('00000000-0000-0000-0000-0000000000a2/7_hr.pdf', 'x.pdf', 'respins', '00000000-0000-0000-0000-0000000000a4')" \
  '1 rând(uri) din coadă (orice stare) au obiectul urcat de alt cont'
garda 1m "aceeași cale în două rânduri" \
  "INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES ('00000000-0000-0000-0000-0000000000a1/1_ci.pdf', 'CI.pdf', 'confirmat', '00000000-0000-0000-0000-0000000000a1')" \
  '1 rând(uri) din coadă repetă aceeași cale'
garda 1n "rând fără obiect cu calea în afara folderului propriu" \
  "INSERT INTO public.ai_documente_inbox (fisier_path, fisier_nume, status, uploadat_de) VALUES ('x/nu_exista.pdf', 'n.pdf', 'confirmat', '00000000-0000-0000-0000-0000000000a1')" \
  'au calea în afara folderului celui care a urcat'
# 1o. altă sesiune ține storage.objects (ex. o listare lungă): migrarea cade curat pe lock_timeout (5 s), nimic schimbat
copie ai_inbox_g1o_test "$BAZA"
"${PSQL[@]}" -d ai_inbox_g1o_test -c "BEGIN; LOCK TABLE storage.objects IN ACCESS SHARE MODE; SELECT pg_sleep(9); COMMIT;" >/dev/null 2>&1 &
BG=$!
for _ in $(seq 1 50); do
  [ "$(qf ai_inbox_g1o_test "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'objects' AND l.granted AND l.pid <> pg_backend_pid()")" -ge 1 ] && break
  sleep 0.2
done
refuza "1o lock ținut de altă sesiune" 'lock timeout' "${PSQL[@]}" -d ai_inbox_g1o_test --single-transaction -f "$MIGRARE"
wait "$BG" || true
[ "$(stare ai_inbox_g1o_test)" = "1:1:0" ] || esec "1o starea s-a schimbat deși migrarea a căzut pe lock_timeout"
ok "1o storage.objects ținut de altă sesiune → lock_timeout, nimic schimbat (lock-urile se iau înaintea precondițiilor)"
# 1p. fals pozitiv (Jakarinos P1 → P2): o politică FOR ALL fără USING / WITH CHECK nu dă acces → precondiția o ignoră, gaura rămâne închisă
copie ai_inbox_g1p_test "$BAZA"
qf ai_inbox_g1p_test "CREATE POLICY accidental ON storage.objects FOR ALL TO authenticated" >/dev/null
"${PSQL[@]}" -d ai_inbox_g1p_test --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "1p aplicare cu politica fără expresii"; }
[ "$(vede_a4 ai_inbox_g1p_test)" = 1 ] || esec "1p politica fără USING dă acces: contul fără drepturi vede $(vede_a4 ai_inbox_g1p_test) obiecte"
refuza "1p INSERT prin politica fără WITH CHECK" 'violates row-level security policy' qf ai_inbox_g1p_test "BEGIN; SET LOCAL \"request.jwt.claims\" = '{\"sub\":\"00000000-0000-0000-0000-0000000000a4\",\"role\":\"authenticated\"}'; SET LOCAL ROLE authenticated; INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('ai-documente-inbox', 'radacina.pdf', '00000000-0000-0000-0000-0000000000a4'); ROLLBACK;"
ok "1p politică FOR ALL fără USING / WITH CHECK: precondiția trece, dar nu dă nimic (vede 1 = nedecisul, INSERT refuzat)"

# 2. aplicare
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "2 aplicare"; }
[ "$(stare "$BAZA")" = "3:0:5" ] || esec "2 starea după aplicare: $(stare "$BAZA") (aștept 3:0:5)"
[ "$(vede_a4 "$BAZA")" = 1 ] || esec "2 gaura nu e închisă: contul fără drepturi vede $(vede_a4 "$BAZA") obiecte (aștept 1 — nedecisul)"
[ "$(alte_politici "$BAZA")" = "$POL0" ] || esec "2 celelalte politici storage s-au schimbat"
[ "$(date_ "$BAZA")" = "$DATE0" ] || esec "2 datele s-au schimbat"
ok "2 aplicare (pre + post trecute): gaura închisă (10 → 1), celelalte politici storage și datele identice"
suita "după 20261103c"

# 3. reaplicare
refuza "3 reaplicare" 'PRECONDIȚIE 20261103c: ai_inbox_obj_all nu e exact' "${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE"
[ "$(stare "$BAZA")" = "3:0:5" ] || esec "3 starea s-a schimbat la reaplicarea refuzată"
ok "3 reaplicare → refuz PRECONDIȚIE (exactă, nu idempotentă)"
suita "după reaplicarea refuzată"

# 4. revenire
refuza "4a nearmată" 'fără GO de execuție' revenire nu "$BAZA"
qf postgres "ALTER DATABASE $BAZA SET $GUC = 'x'" >/dev/null
refuza "4b armare persistentă" 'armat PERSISTENT' revenire da "$BAZA"
qf postgres "ALTER DATABASE $BAZA RESET $GUC" >/dev/null
rb_modificat() {   # $1 = cod, $2 = descriere, $3 = SQL care schimbă patch-ul pe o copie
  local db="ai_inbox_rb$1_test"
  copie "$db" "$BAZA"
  qf "$db" "$3" >/dev/null
  refuza "$1 $2" 'starea curentă nu e patch-ul 20261103c' revenire da "$db"
  [ "$(stare "$db")" = "3:0:5" ] || esec "$1 revenirea refuzată a scos totuși ceva ($(stare "$db"))"
}
rb_modificat 4c "politica SELECT modificată" "ALTER POLICY ai_inbox_obj_select ON storage.objects USING (bucket_id = 'ai-documente-inbox')"
rb_modificat 4e "corpul funcției de legătură modificat" "CREATE OR REPLACE FUNCTION public.ai_inbox_fisier_legat() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS \$f\$ BEGIN RETURN NEW; END \$f\$"
rb_modificat 4f "indexul fără UNIQUE" "DROP INDEX public.idx_ai_inbox_fisier_path; CREATE INDEX idx_ai_inbox_fisier_path ON public.ai_documente_inbox USING btree (fisier_path)"
rb_modificat 4g "trigger-ul de legătură dezactivat" "ALTER TABLE public.ai_documente_inbox DISABLE TRIGGER trg_ai_inbox_fisier_legat"
rb_modificat 4h "EXECUTE dat lui authenticated pe funcția imutabilă" "GRANT EXECUTE ON FUNCTION public.ai_inbox_fisier_imutabil() TO authenticated"
[ "$(stare "$BAZA")" = "3:0:5" ] || esec "4a–4h patch-ul s-a schimbat deși revenirea a refuzat"
ok "4a–4h revenire nearmată / armare persistentă / stare modificată (politică, corp funcție, index, trigger, ACL) → refuz, nimic scos"
revenire da "$BAZA" >"$OUT" 2>&1 || { cat "$OUT"; esec "4d revenire armată"; }
[ "$(stare "$BAZA")" = "1:1:0" ] || esec "4d starea după revenire: $(stare "$BAZA") (aștept 1:1:0)"
[ "$(qf "$BAZA" "SELECT polcmd::text || '|' || polroles::regrole[]::text || '|' || pg_get_expr(polqual, polrelid) || '|' || pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'ai_inbox_obj_all'")" \
  = "*|{authenticated}|(bucket_id = 'ai-documente-inbox'::text)|(bucket_id = 'ai-documente-inbox'::text)" ] || esec "4d ai_inbox_obj_all nu e exact cea live"
[ "$(vede_a4 "$BAZA")" = 10 ] || esec "4d revenirea n-a readus starea veche (contul fără drepturi vede $(vede_a4 "$BAZA"))"
[ "$(alte_politici "$BAZA")" = "$POL0" ] || esec "4d celelalte politici storage s-au schimbat"
[ "$(date_ "$BAZA")" = "$DATE0" ] || esec "4d datele s-au schimbat"
ok "4d revenire armată: exact ai_inbox_obj_all live (gaura revine — de aceea e fără GO), index / funcții / trigger-e scoase, date și alte politici neatinse"
"${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" >"$OUT" 2>&1 || { cat "$OUT"; esec "4 reaplicare după revenire"; }
suita "reaplicare după revenire"

echo "PASS test_ai_inbox_storage_politici"
