#!/usr/bin/env bash
# Runda 18 a runnerului (22.11.2026, plafonul EXTINS; docs/LIVRARE_L15_V2.md §9): biblioteca scripts/livrare_amprenta.sh, FARA PostgreSQL.
#   bash scripts/test_livrare_plafon_extins.sh          (Git Bash sau Linux; cere `date` GNU)
# Ce verifica (expected scris aici, de mana, din regula UE a orei de vara si din decizia proprietarului - L25):
#   * constantele: AG_PLAFON_MS = 5000 (neschimbat), AG_PLAFON_EXTINS_MS = 15000, fereastra 21:00:00-06:00:00 Europe/Bucharest;
#   * ag_plafon_ok: fara „extins” doar "" / 5000 (15000 refuzat, cu indicatia optiunii); cu „extins” DOAR 15000 ("" / 5000 / 14999 refuzate);
#   * ag_ora_bucuresti pe momente FIXE (epoch din `date -u -d`, independent de functie): iarna UTC+2, vara UTC+3, trecerile la ora de vara /
#     iarna din 2026 (29.03 / 25.10) si 2027 (28.03 / 31.10) exact la 01:00 UTC, momente la granitele ferestrei;
#   * ag_fereastra_in la granite: 20:59:59 afara, 21:00:00 in, 05:59:59 in, 06:00:00 afara, 00:00:00 in, 12:00:00 afara; forma invalida = 2;
#   * ag_fereastra_ok pe „acum” = acelasi verdict cu ag_fereastra_in(ag_ora_bucuresti) si mesajul PLAFON_EXTINS_FEREASTRA in afara ferestrei;
#   * ag_fereastra_sql: textul serverului poarta ACELEASI constante (fusul, granitele, plafonul), fara backslash, ASCII, operatori calificati;
#   * MUTANTI pe o copie a bibliotecii (fiecare inlocuire EXACT o data, altfel proba e nefunctionala): fara ora de vara; fereastra de la 20:00;
#     06:00:00 inclus; „extins” accepta orice valoare; ultima duminica din martie = mereu 31; granita orei de vara cu > in loc de >=;
#     OR -> AND in textul serverului; fusul schimbat in text — fiecare trebuie PRINS de verificarile de mai sus.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$ROOT/scripts/livrare_amprenta.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "ESEC: $*" >&2; exit 1; }

# momente fixe: "AAAA-LL-ZZ HH:MM:SS UTC" => ora Europe/Bucharest asteptata + in/afara ferestrei (scrise de mana)
MOMENTE='2026-01-15 20:30:00|22:30:00|in
2026-01-15 18:59:59|20:59:59|afara
2026-01-15 19:00:00|21:00:00|in
2026-01-15 03:59:59|05:59:59|in
2026-01-15 04:00:00|06:00:00|afara
2026-07-15 18:30:00|21:30:00|in
2026-07-15 17:59:59|20:59:59|afara
2026-07-15 02:59:59|05:59:59|in
2026-07-15 03:00:00|06:00:00|afara
2026-03-28 23:30:00|01:30:00|in
2026-03-29 00:59:59|02:59:59|in
2026-03-29 01:00:00|04:00:00|in
2026-10-25 00:59:59|03:59:59|in
2026-10-25 01:00:00|03:00:00|in
2026-11-22 12:00:00|14:00:00|afara
2027-03-28 00:59:59|02:59:59|in
2027-03-28 01:00:00|04:00:00|in
2027-10-31 00:59:59|03:59:59|in
2027-10-31 01:00:00|03:00:00|in
2025-12-31 22:00:00|00:00:00|in'

# verifica <biblioteca> — toate verificarile; iese cu 1 la prima abatere (mesajul pe stderr). Ruleaza intr-un subshell (sursa separata).
verifica() (
  . "$1"
  [ "$AG_PLAFON_MS" = 5000 ] || { echo "AG_PLAFON_MS = $AG_PLAFON_MS, asteptat 5000" >&2; exit 1; }
  [ "$AG_PLAFON_EXTINS_MS" = 15000 ] || { echo "AG_PLAFON_EXTINS_MS = $AG_PLAFON_EXTINS_MS, asteptat 15000" >&2; exit 1; }
  [ "$AG_FEREASTRA_DE" = 21:00:00 ] && [ "$AG_FEREASTRA_PANA" = 06:00:00 ] && [ "$AG_FEREASTRA_FUS" = Europe/Bucharest ] \
    || { echo "fereastra $AG_FEREASTRA_DE-$AG_FEREASTRA_PANA $AG_FEREASTRA_FUS, asteptat 21:00:00-06:00:00 Europe/Bucharest" >&2; exit 1; }
  # ag_plafon_ok
  ag_plafon_ok "" >/dev/null 2>&1 || { echo "ag_plafon_ok '' trebuie acceptat" >&2; exit 1; }
  ag_plafon_ok 5000 >/dev/null 2>&1 || { echo "ag_plafon_ok 5000 trebuie acceptat" >&2; exit 1; }
  rc=0; m="$(ag_plafon_ok 15000 2>&1)" || rc=$?
  [ "$rc" = 2 ] && [[ "$m" == *'cere optiunea explicita --plafon-extins'* ]] || { echo "ag_plafon_ok 15000 fara extins: cod $rc, '$m' (asteptat 2 + indicatia optiunii)" >&2; exit 1; }
  ag_plafon_ok 15000 extins >/dev/null 2>&1 || { echo "ag_plafon_ok 15000 extins trebuie acceptat" >&2; exit 1; }
  for v in "" 5000 14999 15001 2000; do
    ! ag_plafon_ok "$v" extins >/dev/null 2>&1 || { echo "ag_plafon_ok '$v' extins trebuie refuzat" >&2; exit 1; }
  done
  rc=0; m="$(ag_plafon_ok 5000 extins 2>&1)" || rc=$?
  [ "$rc" = 2 ] && [[ "$m" == *'--plafon-extins cere --plafon-tranzactie-ms 15000'* ]] || { echo "ag_plafon_ok 5000 extins: cod $rc, '$m'" >&2; exit 1; }
  # momentele fixe
  while IFS='|' read -r utc ora fer; do
    e="$(date -u -d "$utc" +%s)"
    h="$(ag_ora_bucuresti "$e")" || { echo "ag_ora_bucuresti @$e ($utc UTC) a esuat" >&2; exit 1; }
    [ "$h" = "$ora" ] || { echo "$utc UTC: ora Europe/Bucharest $h, asteptat $ora" >&2; exit 1; }
    if ag_fereastra_in "$h"; then f=in; else f=afara; fi
    [ "$f" = "$fer" ] || { echo "$utc UTC ($h): $f, asteptat $fer" >&2; exit 1; }
  done <<<"$MOMENTE"
  # granitele ferestrei direct pe ora
  for p in 20:59:59:afara 21:00:00:in 23:59:59:in 00:00:00:in 05:59:59:in 06:00:00:afara 12:00:00:afara; do
    h="${p%:*}"; fer="${p##*:}"
    if ag_fereastra_in "$h"; then f=in; else f=afara; fi
    [ "$f" = "$fer" ] || { echo "ag_fereastra_in $h: $f, asteptat $fer" >&2; exit 1; }
  done
  for h in "" 7:00:00 "21:00" 24:00:00 "21:00:00 " abc; do
    rc=0; ag_fereastra_in "$h" || rc=$?
    [ "$rc" = 2 ] || { echo "ag_fereastra_in '$h': cod $rc, asteptat 2 (forma invalida)" >&2; exit 1; }
  done
  ! ag_ora_bucuresti abc >/dev/null 2>&1 || { echo "ag_ora_bucuresti abc trebuie refuzat" >&2; exit 1; }
  # „acum”: ag_fereastra_ok = acelasi verdict
  h="$(ag_ora_bucuresti)"; rc=0; m="$(ag_fereastra_ok 2>&1)" || rc=$?
  if ag_fereastra_in "$h"; then
    [ "$rc" = 0 ] && [[ "$m" == *"plafon EXTINS 15000 ms"* ]] || { echo "ag_fereastra_ok la $h (in fereastra): cod $rc, '$m'" >&2; exit 1; }
  else
    [ "$rc" = 2 ] && [[ "$m" == *"PLAFON_EXTINS_FEREASTRA: ora Europe/Bucharest e "* ]] || { echo "ag_fereastra_ok la $h (afara): cod $rc, '$m'" >&2; exit 1; }
  fi
  # textul serverului
  s="$(ag_fereastra_sql 20990101a_proba)" || { echo "ag_fereastra_sql a esuat" >&2; exit 1; }
  for x in "AT TIME ZONE '$AG_FEREASTRA_FUS'" "OPERATOR(pg_catalog.>=) '$AG_FEREASTRA_DE'::pg_catalog.time OR v_ora OPERATOR(pg_catalog.<) '$AG_FEREASTRA_PANA'::pg_catalog.time" \
           "PLAFON_EXTINS_FEREASTRA" "plafonul extins ($AG_PLAFON_EXTINS_MS ms)" "pg_catalog.transaction_timestamp()" 'DO $plafon_fereastra$' "Livrare 20990101a_proba:"; do
    [[ "$s" == *"$x"* ]] || { echo "ag_fereastra_sql: lipseste $x" >&2; exit 1; }
  done
  [[ "$s" == *"AT TIME ZONE 'Europe/Bucharest'"* ]] || { echo "ag_fereastra_sql: fusul nu e Europe/Bucharest" >&2; exit 1; }
  ! printf '%s' "$s" | grep -q '\\' || { echo "ag_fereastra_sql: backslash" >&2; exit 1; }
  ! LC_ALL=C printf '%s' "$s" | grep -q '[^ -~]' || { echo "ag_fereastra_sql: caractere non-ASCII" >&2; exit 1; }
  ! ag_fereastra_sql 'rau;nume' >/dev/null 2>&1 || { echo "ag_fereastra_sql cu nume invalid trebuie refuzat" >&2; exit 1; }
)

verifica "$LIB" || fail 'biblioteca reala nu trece verificarile'
echo "PLX_LIB: constante (5000 / 15000, 21:00:00-06:00:00 Europe/Bucharest), ag_plafon_ok, $(grep -c . <<<"$MOMENTE") momente fixe (iarna / vara / trecerile 2026 + 2027), granitele ferestrei, acum ($(bash -c '. "$1"; ag_ora_bucuresti' _ "$LIB")), textul serverului"

# mutantii: pe o copie, fiecare inlocuire exact o data (separatorul campurilor e „~”: textele contin „|” si „||”)
n=0
while IFS='~' read -r et din in_; do
  n=$((n + 1)); M="$TMP/m$n.sh"
  [ "$(grep -cF -- "$din" "$LIB")" = 1 ] || fail "mutantul $n ($et): textul '$din' nu apare exact o data in biblioteca (proba nefunctionala)"
  python3 - "$LIB" "$M" "$din" "$in_" <<'PY'
import sys
lib, out, din, in_ = sys.argv[1:5]
t = open(lib, encoding="utf-8").read()
assert t.count(din) == 1
open(out, "w", encoding="utf-8", newline="\n").write(t.replace(din, in_))
PY
  cmp -s "$LIB" "$M" && fail "mutantul $n ($et) nu s-a aplicat"
  if verifica "$M" >"$TMP/m$n.log" 2>&1; then cat "$TMP/m$n.log"; fail "mutantul $n ($et) NU e prins"; fi
  echo "  mutant $n prins: $et -> $(tail -n 1 "$TMP/m$n.log")"
done <<'EOF'
fara ora de vara~of=2; if [ "$e" -ge "$dst0" ] && [ "$e" -lt "$dst1" ]; then of=3; fi~of=2
fereastra de la 20:00~AG_FEREASTRA_DE=21:00:00~AG_FEREASTRA_DE=20:00:00
06:00:00 inclus in fereastra~[[ "$1" < "$AG_FEREASTRA_PANA" ]]~{ [[ "$1" < "$AG_FEREASTRA_PANA" ]] || [ "$1" = "$AG_FEREASTRA_PANA" ]; }
extins accepta orice valoare~[ "$1" = "$AG_PLAFON_EXTINS_MS" ] || {~[ -n "$1" ] || {
ultima duminica din martie = mereu 31~lu_m=$((31 - $(date -u -d "$an-03-31" +%u) % 7))~lu_m=31
granita orei de vara cu > in loc de >=~[ "$e" -ge "$dst0" ]~[ "$e" -gt "$dst0" ]
OR -> AND in textul serverului~::pg_catalog.time OR v_ora OPERATOR~::pg_catalog.time AND v_ora OPERATOR
alt fus in textul serverului~AT TIME ZONE '$AG_FEREASTRA_FUS'~AT TIME ZONE 'Europe/Chisinau'
EOF
echo "PLX_MUTANTI: $n mutanti pe biblioteca, toti prinsi"
echo 'PASS test_livrare_plafon_extins'
