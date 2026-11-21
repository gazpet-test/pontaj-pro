#!/usr/bin/env bash
# Proba de CONCURENȚĂ pentru 20270102a (Redări FAN: urmărirea automată) — DOAR pe o CLONĂ DE ARUNCAT, cu DOUĂ sesiuni psql reale (L25). PGlite are o
# singură conexiune: scenariile de aici NU sunt probate local; scriptul e NETESTAT pe PostgreSQL de autor (serverul de cod nu are psql) — îl rulează
# coordonatorul pe clonă, cu 20261212a, 20261227a, 20261228a ȘI 20270102a aplicate. NU are nevoie de date Redări (rulările nu ating red_fan_awb).
# Rulare din Git Bash, cu psql de Windows; conexiunea după `--` (parola din pgpass, niciodată pe linia de comandă):
#   PSQL=/c/Users/Public/pgsql/bin/psql.exe bash supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh --sistem <system_identifier clonă> \
#     -- -h <host clonă> -p <port> -U postgres -d postgres
# Garda țintei: system_identifier = --sistem, altfel refuz (22) înainte de orice scriere. 20270102a aplicată (23). Starea de pornire: red_fan_rulari GOALĂ
#   (24) — revenirea o cere goală, iar curățenia de aici o readuce așa (și jurnalul scris de probă se scoate, ULTIMUL, cu trigger-ul append-only oprit
#   doar în tranzacția curățeniei; verificat: zero rânduri red_jurnal noi și zero rulări).
# Identitatea sesiunilor: rolul service_role FĂRĂ JWT (ambele surse request.jwt.claim.* goale) = calea funcției edge a cronului (clasa B).
# Bariera: sesiunea A face apelul ÎNTR-O TRANZACȚIE DESCHISĂ, ia apoi un lock consultativ cu cheie UNICĂ pe rulare (semnalul „A e gata”) și ține
#   tranzacția 3 s (pg_sleep), apoi COMMIT. B pornește abia când pg_locks arată bariera acordată lui A; verdictul cere ca B să fi fost văzut ÎN
#   AȘTEPTARE de lock (pg_stat_activity.wait_event_type = 'Lock') cât A ținea. Codul FIECĂRUI proces psql se păstrează (wait PID, fără `|| true`).
#   B scrie R= (rezultatul) și E= (SQLSTATE, 00000 = fără eroare) pe linii separate.
# SCENARIILE și REZULTATELE AȘTEPTATE (docs/redari/FAN_URMARIRE_AUTOMATA.md §3, §4):
#   S1  două porniri de cron suprapuse: A = fn_red_fan_srv_rulare_incepe('cron') deschisă; B = același apel → B AȘTEAPTĂ (lock-ul consultativ al
#       rulărilor), apoi primește {"ocupat": true, "motiv": "rulare_in_curs"}; exact o rulare în red_fan_rulari.
#   S2  plafonul pe muchie: rularea din S1 cu apeluri = plafon − 1; A = fn_red_fan_srv_rulare_apel deschisă (ia ultimul apel); B = același apel →
#       B AȘTEAPTĂ (rândul rulării), apoi E=RD040; apeluri = plafon (niciun apel peste plafon).
#   S3  închiderea în timpul unui apel: A = fn_red_fan_srv_rulare_incheie(… 'oprita_plafon', 'rd040' …) deschisă; B = fn_red_fan_srv_rulare_apel →
#       B AȘTEAPTĂ (rândul rulării), apoi E=RD041; rularea e închisă, un singur eveniment urmarire_auto în red_jurnal.
# Ieșire: 0 = toate OK; 1 = un scenariu a picat; 2 = argumente; 3 = curățenia a picat (VIZIBIL); 22 = altă țintă; 23 = 20270102a neaplicată;
#   24 = starea de pornire nu e curată. Durata: ~15 s.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sistem) SISTEM="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "argument necunoscut: $1 (conexiunea vine după --)" >&2; exit 2 ;;
  esac
done
CONN=("$@")
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei> (numar)" >&2; exit 2; }
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || { echo "nu gasesc radacina repo-ului dupa calea scriptului" >&2; exit 2; }
cd "$RADACINA"
TMP="$(mktemp -d ./.concurenta_20270102a.XXXXXX)"
q() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" "$@" | tr -d '\r'; }
BAZA=$(( ($$ % 30000) * 65536 + (RANDOM % 4096) * 16 ))
ESEC=0; JURNAL0=""; PORNIT=0
rez() { if [ "$1" = ok ]; then echo "  OK  $2"; else echo "  NU  $2"; ESEC=1; fi; }

# ── garda țintei și starea de pornire (doar citiri) ──
[ "$(q -c 'SELECT system_identifier FROM pg_control_system()')" = "$SISTEM" ] || { echo "tinta nu e clona declarata (system_identifier)" >&2; exit 22; }
[ "$(q -c "SELECT to_regclass('public.red_fan_rulari') IS NOT NULL AND to_regprocedure('public.fn_red_fan_srv_rulare_incepe(text, uuid)') IS NOT NULL")" = t ] || { echo "20270102a nu e aplicata pe clona" >&2; exit 23; }
[ "$(q -c 'SELECT count(*) FROM public.red_fan_rulari')" = 0 ] || { echo "red_fan_rulari nu e goala la pornire" >&2; exit 24; }
JURNAL0="$(q -c 'SELECT coalesce(max(id), 0) FROM public.red_jurnal')"
PORNIT=1

curata() {
  cat > "$TMP/curata.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
DELETE FROM public.red_fan_rulari;
ALTER TABLE public.red_jurnal DISABLE TRIGGER trg_red_jurnal_imuabil;
DELETE FROM public.red_jurnal WHERE id > $JURNAL0;
ALTER TABLE public.red_jurnal ENABLE TRIGGER trg_red_jurnal_imuabil;
COMMIT;
SQL
  q -f "$TMP/curata.sql" > "$TMP/curata.out" 2>&1 || return 1
  [ "$(q -c "SELECT (SELECT count(*) FROM public.red_fan_rulari) = 0 AND (SELECT count(*) FROM public.red_jurnal WHERE id > $JURNAL0) = 0
              AND (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_red_jurnal_imuabil' AND tgrelid = 'public.red_jurnal'::regclass) = 'O'")" = t ]
}
la_iesire() {
  local c=$?
  if [ "$PORNIT" = 1 ]; then
    if curata; then echo "curatenie: OK (zero rulari, zero randuri red_jurnal noi, trigger-ul append-only activ)"; rm -rf "$TMP"
    else echo "CURATENIA A PICAT: vezi $TMP/curata.out" >&2; exit 3; fi
  fi
  exit "$c"
}
trap la_iesire EXIT

SRV="RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false) IS NOT NULL AS ok \\gset
SELECT set_config('request.jwt.claims', '', false) IS NOT NULL AS ok \\gset
SET ROLE service_role;"

# A: apelul în tranzacție deschisă + bariera; B: același tip de apel, cu R= / E=
sesiune_a() {   # $1 = eticheta, $2 = apelul SQL, $3 = cheia barierei
  cat > "$TMP/$1_a.sql" <<SQL
\\set ON_ERROR_STOP 1
$SRV
BEGIN;
$2;
SELECT pg_advisory_xact_lock($3);
SELECT pg_sleep(3);
COMMIT;
SQL
  q -f "$TMP/$1_a.sql" > "$TMP/$1_a.out" 2>&1
}
sesiune_b() {   # $1 = eticheta, $2 = apelul SQL (o singură coloană „r”)
  cat > "$TMP/$1_b.sql" <<SQL
\\set ON_ERROR_STOP 0
$SRV
SELECT pg_backend_pid() AS pid \\gset
\\o $TMP/$1_b.pid
\\qecho :pid
\\o
\\set r ''
$2 \\gset
\\echo R=:r
\\echo E=:SQLSTATE
SQL
  "$PSQL" -X -q -At "${CONN[@]}" -f "$TMP/$1_b.sql" 2>&1 | tr -d '\r' > "$TMP/$1_b.out"
}
asteapta_bariera() {   # $1 = cheia: A a făcut apelul și ține bariera
  local i
  for i in $(seq 1 100); do
    [ "$(q -c "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND ((classid::bigint << 32) | objid::bigint) = $1")" -ge 1 ] && return 0
    sleep 0.05
  done
  return 1
}
b_in_asteptare() {   # $1 = eticheta: pid-ul lui B apare în așteptare de lock cât A ține
  local i pid=""
  for i in $(seq 1 100); do
    [ -s "$TMP/$1_b.pid" ] && pid="$(tr -dc '0-9' < "$TMP/$1_b.pid")"
    if [ -n "$pid" ] && [ "$(q -c "SELECT count(*) FROM pg_stat_activity WHERE pid = $pid AND wait_event_type = 'Lock'")" = 1 ]; then return 0; fi
    sleep 0.05
  done
  return 1
}
scenariu() {   # $1 = eticheta, $2 = apelul A, $3 = apelul B
  local cheie=$((BAZA + ${#1})) pa pb ca cb astepta=0
  sesiune_a "$1" "$2" "$cheie" & pa=$!
  asteapta_bariera "$cheie" || { echo "  bariera $1 nu s-a ridicat" >&2; }
  sesiune_b "$1" "$3" & pb=$!
  b_in_asteptare "$1" && astepta=1
  if wait "$pa"; then ca=0; else ca=$?; fi
  if wait "$pb"; then cb=0; else cb=$?; fi
  echo "$ca $cb $astepta"
}

echo "S1: două porniri de cron suprapuse"
read -r CA CB AST < <(scenariu S1 "SELECT public.fn_red_fan_srv_rulare_incepe('cron', NULL)" "SELECT public.fn_red_fan_srv_rulare_incepe('cron', NULL)::text AS r")
RB="$(grep '^R=' "$TMP/S1_b.out" || true)"; EB="$(grep '^E=' "$TMP/S1_b.out" || true)"
N="$(q -c 'SELECT count(*) FROM public.red_fan_rulari')"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$AST" = 1 ] && [ "$EB" = "E=00000" ] && [[ "$RB" == *'"motiv": "rulare_in_curs"'* ]] && [ "$N" = 1 ] \
  && rez ok "S1 B a asteptat, apoi ocupat (rulare_in_curs); o singura rulare" || rez nu "S1 psql A=$CA B=$CB asteptare=$AST $RB $EB rulari=$N"
RUL="$(q -c "SELECT id FROM public.red_fan_rulari WHERE stare = 'in_curs'")"
PLAFON="$(q -c "SELECT plafon_apeluri FROM public.red_fan_rulari WHERE id = '$RUL'")"

echo "S2: plafonul pe muchie (ultimul apel disputat)"
q -c "UPDATE public.red_fan_rulari SET apeluri = plafon_apeluri - 1 WHERE id = '$RUL'" > /dev/null
read -r CA CB AST < <(scenariu S2 "SELECT public.fn_red_fan_srv_rulare_apel('$RUL')" "SELECT public.fn_red_fan_srv_rulare_apel('$RUL')::text AS r")
EB="$(grep '^E=' "$TMP/S2_b.out" || true)"
AP="$(q -c "SELECT apeluri FROM public.red_fan_rulari WHERE id = '$RUL'")"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$AST" = 1 ] && [ "$EB" = "E=RD040" ] && [ "$AP" = "$PLAFON" ] \
  && rez ok "S2 B a asteptat, apoi RD040; apeluri = plafon ($AP)" || rez nu "S2 psql A=$CA B=$CB asteptare=$AST $EB apeluri=$AP plafon=$PLAFON"

echo "S3: închiderea în timpul unui apel"
q -c "UPDATE public.red_fan_rulari SET apeluri = 0 WHERE id = '$RUL'" > /dev/null
read -r CA CB AST < <(scenariu S3 "SELECT public.fn_red_fan_srv_rulare_incheie('$RUL', 'oprita_plafon', 'rd040', 0, 0)" "SELECT public.fn_red_fan_srv_rulare_apel('$RUL')::text AS r")
EB="$(grep '^E=' "$TMP/S3_b.out" || true)"
ST="$(q -c "SELECT stare FROM public.red_fan_rulari WHERE id = '$RUL'")"
NJ="$(q -c "SELECT count(*) FROM public.red_jurnal WHERE id > $JURNAL0 AND date_noi ->> 'eveniment' = 'urmarire_auto'")"
[ "$CA" = 0 ] && [ "$CB" = 0 ] && [ "$AST" = 1 ] && [ "$EB" = "E=RD041" ] && [ "$ST" = oprita_plafon ] && [ "$NJ" = 1 ] \
  && rez ok "S3 B a asteptat, apoi RD041; rularea inchisa, un eveniment in jurnal" || rez nu "S3 psql A=$CA B=$CB asteptare=$AST $EB stare=$ST jurnal=$NJ"

[ "$ESEC" = 0 ] && echo "REZULTAT: toate scenariile au trecut" || echo "REZULTAT: cel putin un scenariu a picat"
exit "$ESEC"
