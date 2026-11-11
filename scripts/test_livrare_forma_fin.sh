#!/usr/bin/env bash
# Runda 12 a runnerului (PR #1054 r3, Jakarinos r14 P2): forma mesajelor trimise de scripts/livrare_migrare.sh, FARA
# PostgreSQL (psql fals care copiaza fisierele primite si raspunde la reconciliere). Ruleaza in Git Bash sau Linux:
#   bash scripts/test_livrare_forma_fin.sh
# Ce verifica (expected scris aici, independent de runner):
#   cu --plafon-tranzactie-ms: ordinea fisierelor (00_sesiune, 0_prolog, 1_pre, copia, 3_inreg, 9_fin), fara
#     --single-transaction; 9_fin.sql se imparte (ca psql: „;” in afara $tag$ trimite, „\;” continua) in EXACT doua
#     mesaje: [SET CONSTRAINTS ALL IMMEDIATE; SET LOCAL search_path = pg_catalog, pg_temp; DO garda; COMMIT] si
#     [RESET transaction_timeout] => intre garda si COMMIT nu exista drum client-server;
#   fara optiune: exact invocarea de dinainte (psql --single-transaction cu 0_prolog, 1_pre, copia, 3_inreg), niciun
#     00_sesiune / 9_fin si nicio mentiune transaction_timeout in fisierele trimise.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
fail() { echo "ESEC: $*" >&2; exit 1; }

cat >"$TMP/psql_fals" <<'EOF'
#!/usr/bin/env bash
# psql fals: noteaza argumentele (o linie pe apel), copiaza fiecare fisier .sql primit ca <apel>_<nume>, raspunde la
# reconciliere (0 randuri inainte de livrare, perechea exacta dupa) si la gate-ul 0e (nimic expus).
set -euo pipefail
n=$(( $(cat "$FALS_DIR/n" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$FALS_DIR/n"
a=""; for x in "$@"; do a="$a ${x##*/}"; case "$x" in *.sql) cp -- "$x" "$FALS_DIR/${n}_${x##*/}" ;; esac; done
echo "$n:$a" >>"$FALS_DIR/apeluri"
case "$a" in
  *reconc.sql*) if [ -e "$FALS_DIR/livrat" ]; then echo 'forma_test|42||false|1|1'; else echo 'forma_test|42||false|0|0'; fi ;;
  *control_0e.sql*) : ;;
  *) touch "$FALS_DIR/livrat" ;;
esac
EOF
chmod +x "$TMP/psql_fals"

# Imparte un fisier psql in mesajele trimise serverului: „;” in afara unui $tag$ termina mesajul, „\;” il continua
# (devine „;” in mesaj); comentariile „--” in afara $tag$ se ignora. Fiecare mesaj pe O linie (spatiile albe comprimate
# la un singur spatiu), mesajele separate prin linia „@@”.
mesaje() {
  awk '
    { linie = $0 "\n"; i = 1; n = length(linie)
      while (i <= n) {
        rest = substr(linie, i)
        if (tag == "" && substr(rest, 1, 2) == "--") { buf = buf "\n"; break }
        if (match(rest, /^\$[A-Za-z_]*\$/)) {
          t = substr(rest, 1, RLENGTH); if (tag == "") tag = t; else if (t == tag) tag = ""
          buf = buf t; i += RLENGTH; continue
        }
        c = substr(rest, 1, 1)
        if (tag == "" && c == "\\" && substr(rest, 2, 1) == ";") { buf = buf ";"; i += 2; continue }
        if (tag == "" && c == ";") { curata(); print buf; print "@@"; buf = ""; i++; continue }
        buf = buf c; i++
      }
    }
    function curata() { gsub(/[ \t\n]+/, " ", buf); gsub(/^ | $/, "", buf) }
    END { curata(); if (buf != "") { print "NETERMINAT: " buf; print "@@" } }' "$1"
}

MIG="$TMP/20990101a_forma_fin.sql"
printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\nEND \$g\$;\nCREATE TABLE public.t_forma (id integer);\n" >"$MIG"
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
livreaza() { # $1 directorul de captura, restul = optiuni suplimentare
  mkdir "$1"
  FALS_DIR="$1" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" \
    --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 "${@:2}" \
    >"$1/runner.log" 2>&1 || { cat "$1/runner.log"; fail "runnerul a iesit cu eroare (${*:2})"; }
}

# 1. Cu plafon.
P="$TMP/cu"; livreaza "$P" --plafon-tranzactie-ms 2000
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$P/apeluri")"
[[ "$(printf '%s\n' "$LIV" | wc -l | tr -d ' ')" == 1 ]] || fail "cu plafon: asteptam UN apel de livrare, am: $LIV"
[[ "$LIV" == *" -X -q -v ON_ERROR_STOP=1 -f 00_sesiune.sql -f 0_prolog.sql -f 1_pre.sql -f 20990101a_forma_fin.sql -f 3_inreg.sql -f 9_fin.sql -h "* ]] \
  || fail "cu plafon: ordinea / optiunile psql: $LIV"
[[ "$LIV" != *single-transaction* ]] || fail 'cu plafon: --single-transaction nu are voie sa apara (BEGIN / COMMIT sunt ale runnerului)'
N="${LIV%%:*}"
FIN="$P/${N}_9_fin.sql"; [[ -f "$FIN" ]] || fail 'cu plafon: 9_fin.sql nu a fost trimis'
mesaje "$FIN" >"$P/mesaje"
! grep -q '^NETERMINAT' "$P/mesaje" || fail "cu plafon: 9_fin.sql are text dupa ultimul „;”: $(cat "$P/mesaje")"
[[ "$(grep -c '^@@$' "$P/mesaje")" == 2 ]] || { cat "$P/mesaje"; fail 'cu plafon: 9_fin.sql trebuie sa fie EXACT 2 mesaje'; }
M1="$(awk '/^@@$/ { exit } { print }' "$P/mesaje")"
M2="$(awk 'f && !/^@@$/ { print } /^@@$/ { f++ }' "$P/mesaje")"
[[ "$M2" == 'RESET transaction_timeout' ]] || fail "cu plafon: al doilea mesaj trebuie sa fie doar RESET, e: $M2"
[[ "$M1" == 'SET CONSTRAINTS ALL IMMEDIATE ;'* ]] || fail "cu plafon: mesajul final trebuie sa inceapa cu SET CONSTRAINTS ALL IMMEDIATE: ${M1:0:80}"
[[ "$M1" == *'; COMMIT' ]] || fail "cu plafon: mesajul final trebuie sa se termine cu COMMIT: ...${M1: -80}"
poz() { local x="${M1%%"$1"*}"; [[ "$x" != "$M1" ]] || fail "cu plafon: lipseste „$1” din mesajul final"; echo "${#x}"; }
p1="$(poz 'SET CONSTRAINTS ALL IMMEDIATE')"; p2="$(poz 'SET LOCAL search_path = pg_catalog, pg_temp')"
p3="$(poz 'PLAFON_CURSOR')"; p4="$(poz 'PLAFON_SCHIMBAT')"; p5="$(poz 'PLAFON_DEPASIT')"; p6="$(poz '; COMMIT')"
(( p1 < p2 && p2 < p3 && p3 < p4 && p4 < p5 && p5 < p6 )) \
  || fail "cu plafon: ordinea in mesajul final (constrangeri $p1, search_path $p2, cursor $p3, valoare $p4, timp $p5, COMMIT $p6)"
[[ "$(grep -o '; COMMIT' <<<"$M1" | wc -l | tr -d ' ')" == 1 ]] || fail 'cu plafon: o singura instructiune COMMIT in mesajul final'
grep -q "pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp() > interval '2000 milliseconds'" <<<"$M1" \
  || fail 'cu plafon: garda trebuie sa masoare cu ceasul serverului de la BEGIN'
grep -q 'APLICAT + ÎNREGISTRAT confirmat' "$P/runner.log" || { cat "$P/runner.log"; fail 'cu plafon: reconcilierea'; }
echo 'FORMA_CU_PLAFON: 00_sesiune, 0_prolog, 1_pre, copia, 3_inreg, 9_fin fara --single-transaction; 9_fin = 2 mesaje: [SET CONSTRAINTS ALL IMMEDIATE; SET LOCAL search_path = pg_catalog, pg_temp; garda (cursor, valoare, timp de la BEGIN); COMMIT] + [RESET]'

# 2. Fara optiune: invocarea de dinainte, nimic despre plafon.
F="$TMP/fara"; livreaza "$F"
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$F/apeluri")"
[[ "$LIV" == *" -X -q -v ON_ERROR_STOP=1 --single-transaction -f 0_prolog.sql -f 1_pre.sql -f 20990101a_forma_fin.sql -f 3_inreg.sql -h "* ]] \
  || fail "fara: invocarea veche (--single-transaction, 4 fisiere): $LIV"
! ls "$F" | grep -q '_00_sesiune.sql\|_9_fin.sql' || fail 'fara: 00_sesiune / 9_fin trimise fara optiune'
# r13 (harness r15): datele testului (baza tinta, numele si continutul migrarii) NU au voie sa contina cuvintele cautate,
# altfel verificarea de mai jos raspunde la ele, nu la runner (r15 folosea --tinta-db plafon_test => fals pozitiv in 1_pre).
! printf '%s\n' forma_test "${MIG##*/}" | cat - "$MIG" | grep -qi 'transaction_timeout\|plafon' \
  || fail 'proba nefunctionala: datele testului contin cuvintele cautate'
# Control: aceeasi cautare pe fisierele trimise CU optiune le gaseste (deci cautarea chiar prinde mentiunile plafonului).
cat "$P"/*_*.sql | grep -qi 'transaction_timeout' && cat "$P"/*_*.sql | grep -qi 'plafon' \
  || fail 'proba nefunctionala: cautarea nu gaseste plafonul nici in fisierele trimise cu optiune'
! cat "$F"/*_*.sql | grep -qi 'transaction_timeout\|plafon' || { grep -il 'transaction_timeout\|plafon' "$F"/*_*.sql; fail 'fara: fisierele trimise mentioneaza plafonul'; }
echo 'FORMA_FARA: psql --single-transaction cu 0_prolog, 1_pre, copia, 3_inreg (ca inainte); nicio mentiune a plafonului'
echo 'PASS test_livrare_forma_fin: garda finala si COMMIT intr-un singur mesaj (cu plafon); forma veche neschimbata (fara)'
