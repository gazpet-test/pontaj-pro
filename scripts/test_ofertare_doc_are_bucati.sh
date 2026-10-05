#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261013b_ofertare_doc_are_bucati_invoker. EXCLUSIV pe un PostgreSQL 17 local dedicat
# (implicit /tmp/pg_doc_bucati, 127.0.0.1:5973). Nu atinge producția.
#   0. schelet = starea live 05.10 (funcție SECDEF, ACL postgres+service_role, view security_invoker) → authenticated pică
#   1. fișierul fără runner → garda refuză
#   2. livrare prin scripts/livrare_migrare.sh (sha256 + gate 0e) → cod 0; authenticated citește view-ul,
#      rezultatul funcției e același ca înainte; anon refuzat; service_role merge
#   3. reaplicare → refuz (precondiția 0b vede SECURITY INVOKER)
#   4. revenire nearmată → refuz; armată → înapoi la SECDEF + ACL vechi, authenticated pică din nou
# Utilizare: bash scripts/test_ofertare_doc_are_bucati.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
DATE_DIR="${PGDATA_TEST:-/tmp/pg_doc_bucati}"
PORT="${PGPORT_TEST:-5973}"
BAZA=doc_bucati_test
NUME=20261013b_ofertare_doc_are_bucati_invoker
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
gate_0e() { local n; n="$("${PSQL[@]}" -d "$BAZA" -At -f "$RADACINA/scripts/control_0e.sql" | grep -c . || true)"; [ "$n" = 0 ] || esec "gate 0e: $n rânduri"; ok "gate 0e = 0 ($1)"; }
# ca <rol> <sql> → rezultatul sau ERR:<mesaj>
ca() { "${PSQL[@]}" -d "$BAZA" -At 2>&1 <<SQL | tail -1
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true) \g /dev/null
SET LOCAL ROLE $1;
$2;
ROLLBACK;
SQL
}

[ -x "$PG_BIN/initdb" ] || mediu "PG17 lipsă ($PG_BIN)"
if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null || true; fi
rm -rf "$DATE_DIR"; mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_doc_bucati.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null

# ── 0. schelet = starea live (corpul funcției identic, md5 9d50c502…) ──
CORP="$(printf '%s' 'CiAgU0VMRUNUIEVYSVNUUyAoCiAgICBTRUxFQ1QgMSBGUk9NIG9mZXJ0YXJlX2RvY3VtZW50ZV9hdHJpYnVpcmUgYgogICAgV0hFUkUgYi5saWNpdGF0aWVfaWQgPSBwX2xpY2l0YXRpZV9pZAogICAgICBBTkQgYi5pZCA8PiBwX2RvY19pZAogICAgICBBTkQgYi5udW1lX29yaWdpbmFsIH4gKCdeJyB8fCByZWdleHBfcmVwbGFjZShyZWdleHBfcmVwbGFjZShjb2FsZXNjZShwX251bWUsJycpLCAnXC5wZGYkJywgJycsICdpJyksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICcoWy5eJCorPygpXFtcXXt9fFxcLV0pJywgJ1xcXDEnLCAnZycpCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfHwgJyDigJQgcFxkK19wYWdbXGQtXStcLnBkZiQnKQogICk7Cg==' | base64 -d)"$'\n'   # $(…) taie newline-ul final al corpului — îl punem la loc (md5 identic cu live)
"${PSQL[@]}" -d "$BAZA" >/dev/null <<SQL
SET client_min_messages = warning;
CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.ofertare_documente_atribuire (id bigserial PRIMARY KEY, licitatie_id bigint, nume_original text, status_procesare text, text_extras text, relevanta_verificata_la timestamptz);
ALTER TABLE public.ofertare_documente_atribuire ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertare_documente_select ON public.ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.ofertare_documente_atribuire TO authenticated, service_role;
CREATE FUNCTION public.ofertare_doc_are_bucati(p_licitatie_id bigint, p_doc_id bigint, p_nume text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS \$corp\$$CORP\$corp\$;
REVOKE EXECUTE ON FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ofertare_doc_are_bucati(bigint, bigint, text) TO service_role;
CREATE VIEW public.v_ofertare_seap_completitudine WITH (security_invoker = on) AS
  SELECT d.licitatie_id, count(*) AS ignorate_neverificate FROM public.ofertare_documente_atribuire d
   WHERE d.status_procesare IN ('ignorat','eroare') AND d.text_extras IS NULL AND d.relevanta_verificata_la IS NULL
     AND NOT public.ofertare_doc_are_bucati(d.licitatie_id, d.id, d.nume_original)
   GROUP BY d.licitatie_id;
REVOKE ALL ON public.v_ofertare_seap_completitudine FROM PUBLIC, anon;
GRANT SELECT ON public.v_ofertare_seap_completitudine TO authenticated, service_role;
INSERT INTO public.ofertare_documente_atribuire (licitatie_id, nume_original, status_procesare) VALUES
  (93, 'PT mare.pdf', 'ignorat'), (93, 'PT mare — p1_pag1-40.pdf', 'procesat'), (93, 'Plansa scanata.pdf', 'ignorat'), (3, 'Alta.pdf', 'eroare');
CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
SQL
[ "$(q "SELECT md5(prosrc) FROM pg_proc WHERE proname='ofertare_doc_are_bucati'")" = 9d50c502093fdffb2485ce973a20abb9 ] || esec "schelet: md5 corp diferit de live"
[ "$(q "SELECT proacl::text FROM pg_proc WHERE proname='ofertare_doc_are_bucati'")" = '{postgres=X/postgres,service_role=X/postgres}' ] || esec "schelet: ACL diferit de live"
REF="$(ca service_role "SELECT string_agg(licitatie_id||':'||ignorate_neverificate, ',' ORDER BY licitatie_id) FROM v_ofertare_seap_completitudine")"
[ "$REF" = "3:1,93:1" ] || esec "schelet: rezultat de referință neașteptat ($REF)"
case "$(ca authenticated "SELECT count(*) FROM v_ofertare_seap_completitudine")" in *"permission denied for function ofertare_doc_are_bucati"*) ok "0. schelet: authenticated pică exact ca în producție";; *) esec "0. schelet: bug-ul nu se reproduce";; esac

# ── 1. fără runner ──
if "${PSQL[@]}" -d "$BAZA" -f "$MIGRARE" >/tmp/doc_bucati_1.out 2>&1; then esec "1. migrarea a mers fără runner"; fi
grep -q "garda de livrare" /tmp/doc_bucati_1.out || esec "1. alt motiv de refuz: $(tail -2 /tmp/doc_bucati_1.out)"
[ "$(q "SELECT prosecdef FROM pg_proc WHERE proname='ofertare_doc_are_bucati'")" = t ] || esec "1. starea s-a schimbat"
ok "1. fără runner → garda refuză, nimic schimbat"

# ── 2. livrare prin runner ──
SHA="$(sha256sum "$MIGRARE" | cut -d' ' -f1)"
SIS="$(q "SELECT system_identifier FROM pg_control_system()")"
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005150000 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/doc_bucati_runner.out 2>&1 || RC=$?
[ "$RC" = 0 ] || { tail -15 /tmp/doc_bucati_runner.out >&2; esec "2. runner cod $RC"; }
ok "2. runner: cod 0 (APLICAT + ÎNREGISTRAT, gate 0e în runner)"
gate_0e "după livrare"
R="$(ca authenticated "SELECT string_agg(licitatie_id||':'||ignorate_neverificate, ',' ORDER BY licitatie_id) FROM v_ofertare_seap_completitudine")"
[ "$R" = "$REF" ] || esec "2. authenticated: rezultat $R ≠ referința $REF"
ok "2. authenticated citește view-ul, rezultat identic cu referința ($R)"
case "$(ca anon "SELECT public.ofertare_doc_are_bucati(93, 1, 'PT mare.pdf')")" in *"permission denied"*) ok "2. anon refuzat";; *) esec "2. anon poate executa";; esac
[ "$(ca service_role "SELECT public.ofertare_doc_are_bucati(93, 1, 'PT mare.pdf')")" = t ] || esec "2. service_role: rezultat greșit"
ok "2. service_role (ingest-doc) neschimbat: true pe originalul spart"

# ── 3. reaplicare ──
RC=0; PSQL_BIN="$PG_BIN/psql" bash "$RADACINA/scripts/livrare_migrare.sh" --migrare "$MIGRARE" --sha256 "$SHA" --versiune 20261005150001 \
  --tinta-db "$BAZA" --tinta-sistem "$SIS" --tinta-host 127.0.0.1 --tinta-port "$PORT" --user postgres >/tmp/doc_bucati_runner2.out 2>&1 || RC=$?
[ "$RC" != 0 ] || esec "3. reaplicarea a trecut"
ok "3. reaplicare refuzată (cod $RC)"

# ── 4. revenire ──
if "${PSQL[@]}" -d "$BAZA" -1 -f "$ROLLBACK" >/tmp/doc_bucati_4.out 2>&1; then esec "4. revenirea nearmată a mers"; fi
grep -q "nearmată" /tmp/doc_bucati_4.out || esec "4. alt motiv: $(tail -2 /tmp/doc_bucati_4.out)"
ok "4. revenire nearmată → refuz"
"${PSQL[@]}" -d "$BAZA" >/dev/null <<SQL || esec "4. revenirea armată a eșuat"
BEGIN;
SELECT set_config('gazpet.revenire_20261013b', 'DOC_ARE_BUCATI_DEFINER:' || txid_current(), true) \g /dev/null
\i $ROLLBACK
COMMIT;
SQL
[ "$(q "SELECT prosecdef::text || proacl::text FROM pg_proc WHERE proname='ofertare_doc_are_bucati'")" = 'true{postgres=X/postgres,service_role=X/postgres}' ] || esec "4. starea nu e cea live"
case "$(ca authenticated "SELECT count(*) FROM v_ofertare_seap_completitudine")" in *"permission denied"*) ok "4. revenire armată → starea live (authenticated pică din nou)";; *) esec "4. revenirea n-a readus starea";; esac
echo "PASS"
