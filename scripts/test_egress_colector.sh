#!/usr/bin/env bash
# ============================================================================
# Harness local — scripts/egress_colector (colectorul contoarelor oficiale) scriind prin psql într-un PG17 LOCAL dedicat,
# peste structura reală: schelet + 20260930e + 20261002a + 20261030a (= starea live după 14.10.2026). Nu atinge producția,
# nu deschide browserul (citirea paginii e simulată din Python; parserul are testele lui în unittest).
# Director de lucru NOU (mktemp sub $TMPDIR, prefix egress_colector_harness.*, cu marker), 127.0.0.1:5977.
#   0. baza = schelet + cele trei migrări (marcaj de livrare + --single-transaction, ca runnerul)
#   1. `stare` pe tabela goală → „0 citiri”
#   2. capăt-la-capăt Python → psql → BD: o citire cu TEXT OSTIL în rânduri ($$, ', \i, \gexec, DROP, :'DBNAME' / :USER —
#      variabile psql PREDEFINITE: dacă psql ar interpola în literal, md5-ul ar diferi) → un rând; valorile, sursa
#      'dashboard', textul ostil păstrat identic (md5) în raspuns_brut, ca date; tabela încă există
#   3. a doua rulare → al doilea rând (un rând per rulare); `stare` vede 2 citiri + ultima
#   4. egress_detector() vede citirea oficială (oficial_citit_la) și NU emite „colector oprit”
#   5. eroarea BD urcă: aceeași scriere pe o bază fără tabelă → EroareScriere, nimic scris
#   6. testele Python (unittest) trec
# Ieșire: 0 = PASS · 1 = eșec · 2 = mediu.  PG_BIN / PYTHON / PGPORT_TEST (Windows: PG_BIN=/c/Users/Public/pgsql/bin).
# ============================================================================
set -Eeuo pipefail
export PGCLIENTENCODING=UTF8
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${PGPORT_TEST:-5977}"
BAZA=egress_colector_test
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
EXE=""; SOCKET=(-c unix_socket_directories=/tmp); PY="${PYTHON:-python3}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe"; SOCKET=(); PY="${PYTHON:-python}" ;; esac
PSQL=("$PG_BIN/psql$EXE" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb$EXE" ] || mediu "PG17 lipsă ($PG_BIN)"
command -v "$PY" >/dev/null || mediu "python lipsă ($PY)"

PREFIX_TMP="$(cd "${TMPDIR:-/tmp}" && pwd -P)" || mediu "TMPDIR inaccesibil"
LUCRU="$(mktemp -d "$PREFIX_TMP/egress_colector_harness.XXXXXXXX")" || mediu "mktemp"
LUCRU="$(cd "$LUCRU" && pwd -P)"
MARKER="$LUCRU/.marker_egress_colector_harness"
printf 'egress_colector_harness %s\n' "$$" > "$MARKER"
DATE_DIR="$LUCRU/pgdata"; OUT="$LUCRU/out"
director_al_meu() {
  case "$LUCRU" in "$PREFIX_TMP"/egress_colector_harness.*) ;; *) return 1 ;; esac
  case "$LUCRU" in *..*) return 1 ;; esac
  [ "$(cd "$LUCRU" 2>/dev/null && pwd -P)" = "$LUCRU" ] && [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "egress_colector_harness $$" ]
}
curata() {
  if ! director_al_meu; then echo "REFUZ curățare: $LUCRU nu e directorul acestui harness" >&2; return 0; fi
  if [ -f "$DATE_DIR/postmaster.pid" ]; then ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; fi
  rm -rf -- "$LUCRU"
}
trap 'curata; true' EXIT
director_al_meu || esec "directorul de lucru nu trece propria verificare"
ca_postgres "$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --no-locale >/dev/null || mediu initdb
ca_postgres "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$LUCRU/pg.log" -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c timezone=UTC ${SOCKET[*]}" >/dev/null || mediu "pg_ctl start (portul $PORT ocupat?)"
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
aplica() {  # $1 = numele migrării; copie LF (checkout Windows cu autocrlf ⇒ CRLF ar schimba amprentele md5(prosrc))
  tr -d '\r' < "$RADACINA/supabase/migrations/$1.sql" > "$LUCRU/$1.sql"
  "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$1:' || txid_current(), true);" \
    -f "$LUCRU/$1.sql" >"$OUT" 2>&1 || { cat "$OUT"; esec "0 migrarea $1 nu se aplică"; }
}

# 0. baza = live (schelet + 20260930e + 20261002a + 20261030a)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$RADACINA/supabase/tests/monitor_egress_schelet.sql" >/dev/null
for m in 20260930e_monitor_egress 20261002a_monitor_egress_fix 20261030a_egress_contoare_oficiale; do aplica "$m"; done
[ "$(q "SELECT to_regclass('public.supabase_usage_oficial') IS NOT NULL")" = t ] || esec "0 tabela lipsește"
ok "0 baza: schelet + 20260930e + 20261002a + 20261030a"

PG_ARGS=(--psql "$PG_BIN/psql$EXE" --pg-host 127.0.0.1 --pg-port "$PORT" --pg-user postgres --pg-db "$BAZA" --pg-sslmode disable)
cli() { PYTHONPATH="$RADACINA/scripts" "$PY" -B -m egress_colector --dir "$LUCRU/colector" "$@"; }
# scrierea prin bd.scrie (exact codul folosit de `scrie`), cu citirea paginii simulată
scrie_py() {  # $1 = baza
  PYTHONPATH="$RADACINA/scripts" "$PY" -B - "$PG_BIN/psql$EXE" "$PORT" "$1" <<'PY'
import hashlib, sys
from datetime import date, datetime, timezone
from egress_colector import bd as B, parsare as P
psql, port, baza = sys.argv[1:4]
OSTIL = "4.615 / 250 GB $$; DROP TABLE public.supabase_usage_oficial; -- ' \" \\i C:/rau.sql :'v' :v :'DBNAME' :USER :{?USER} \\gexec $egr_$ $q$ \u201e\u0219\u201d\n\tCOMMIT;"
azi = datetime.now(timezone.utc).date()
s = date(azi.year, azi.month, 7)
if azi < s:
    s = date(azi.year - 1, 12, 7) if azi.month == 1 else date(azi.year, azi.month - 1, 7)
c = P.Citire(4615000000, 78000000, 14586000000, s, P.plus_o_luna(s), valori={},
             randuri={'egress': OSTIL, 'cached_egress': '0.078 / 250 GB (<1%)', 'storage_size': '14.586 / 100 GB (15%)',
                      'ciclu': OSTIL},
             cote={'egress': 250 * 10**9, 'cached_egress': 250 * 10**9, 'storage_size': 100 * 10**9}, zecimal='.')
citit_la = datetime.now(timezone.utc).replace(microsecond=0)
try:
    id_, ts = B.scrie(c, citit_la, psql=psql, pg={'host': '127.0.0.1', 'port': port, 'user': 'postgres', 'db': baza, 'sslmode': 'disable'})
except B.EroareScriere as e:
    print('EROARE_SCRIERE', e)
    sys.exit(3)
print('SCRIS', id_, ts)
print('OSTIL_MD5', hashlib.md5(OSTIL.encode('utf-8')).hexdigest())
PY
}

# 1. stare pe tabela goală
cli stare "${PG_ARGS[@]}" >"$OUT" 2>&1 || { cat "$OUT"; esec "1 stare"; }
grep -q '0 citiri' "$OUT" || { cat "$OUT"; esec "1 stare nu arată 0 citiri"; }
ok "1 stare pe tabela goală → 0 citiri (tranzacție READ ONLY)"

# 2. capăt-la-capăt cu text ostil
scrie_py "$BAZA" >"$OUT" 2>&1 || { cat "$OUT"; esec "2 scrierea"; }
grep -q '^SCRIS [0-9]' "$OUT" || { cat "$OUT"; esec "2 fără SCRIS"; }
[ "$(q "SELECT count(*) FROM supabase_usage_oficial")" = 1 ] || esec "2 nu e exact un rând"
[ "$(q "SELECT egress_bytes || '|' || cached_egress_bytes || '|' || storage_size_bytes || '|' || sursa || '|' || extract(day FROM ciclu_start) || '|' || (ciclu_sfarsit = (ciclu_start + interval '1 month')::date) FROM supabase_usage_oficial")" \
  = "4615000000|78000000|14586000000|dashboard|7|true" ] || esec "2 valorile scrise diferă: $(q "SELECT row_to_json(u) FROM supabase_usage_oficial u")"
ASTEPTAT="$(sed -n 's/^OSTIL_MD5 //p' "$OUT")"
GASIT="$(q "SELECT md5(raspuns_brut->'randuri'->>'Egress') FROM supabase_usage_oficial")"
[[ "$ASTEPTAT" =~ ^[0-9a-f]{32}$ ]] && [ "$GASIT" = "$ASTEPTAT" ] || esec "2 textul ostil nu s-a păstrat identic (md5 $GASIT ≠ $ASTEPTAT)"
[ "$(q "SELECT (raspuns_brut->'randuri'->>'ciclu') = (raspuns_brut->'randuri'->>'Egress') AND raspuns_brut->>'colector' = 'scripts/egress_colector' FROM supabase_usage_oficial")" = t ] \
  || esec "2 raspuns_brut incomplet"
[ "$(q "SELECT count(*) FROM pg_class WHERE relname = 'supabase_usage_oficial'")" = 1 ] || esec "2 tabela a dispărut"
ok "2 un rând scris (valori, sursa 'dashboard', ciclu 07→07); textul ostil păstrat identic ca date, nimic executat"

# 3. a doua rulare + stare
scrie_py "$BAZA" >"$OUT" 2>&1 || { cat "$OUT"; esec "3 a doua scriere"; }
[ "$(q "SELECT count(*) FROM supabase_usage_oficial")" = 2 ] || esec "3 nu sunt 2 rânduri"
cli stare "${PG_ARGS[@]}" >"$OUT" 2>&1 || { cat "$OUT"; esec "3 stare"; }
grep -q '2 citiri' "$OUT" && grep -q 'egress 4.615 GB, cached 0.078 GB, storage 14.586 GB' "$OUT" || { cat "$OUT"; esec "3 stare nu arată citirile"; }
ok "3 a doua rulare → al doilea rând; stare: 2 citiri + ultima"

# 4. detectorul vede citirea oficială și nu emite „colector oprit”
R="$(q "SELECT (egress_detector()->>'oficial_citit_la') IS NOT NULL")"
[ "$R" = t ] || esec "4 detectorul nu vede citirea oficială"
[ "$(q "SELECT count(*) FROM storage_egress_alerte WHERE tip = 'colector_oprit'")" = 0 ] || esec "4 alertă colector_oprit cu citire proaspătă"
ok "4 egress_detector() vede citirea (oficial_citit_la), fără alertă „colector oprit”"

# 5. eroarea BD urcă (baza fără tabelă) — nimic scris
"${PSQL[@]}" -d postgres -c "CREATE DATABASE fara_tabela" >/dev/null
if scrie_py fara_tabela >"$OUT" 2>&1; then cat "$OUT"; esec "5 scrierea pe o bază fără tabelă a trecut"; fi
grep -q 'EROARE_SCRIERE psql a esuat' "$OUT" && grep -q 'supabase_usage_oficial' "$OUT" || { cat "$OUT"; esec "5 eroarea nu a urcat clar"; }
ok "5 eroare BD → EroareScriere cu mesajul psql (fără rând parțial)"

# 6. unittest
( cd "$RADACINA/scripts" && PYTHONPATH=. "$PY" -B -m unittest egress_colector.test_egress_colector ) >"$OUT" 2>&1 || { tail -30 "$OUT"; esec "6 unittest"; }
ok "6 unittest: $(grep -o 'Ran [0-9]* tests' "$OUT")"
echo "PASS"
