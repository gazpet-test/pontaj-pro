#!/usr/bin/env bash
# Runda 12 a runnerului (PR #1054 r3, Jakarinos r14 P2): forma mesajelor trimise de scripts/livrare_migrare.sh, FARA
# PostgreSQL (psql fals care copiaza fisierele primite si raspunde la reconciliere). Ruleaza in Git Bash sau Linux:
#   bash scripts/test_livrare_forma_fin.sh
# Ce verifica (expected scris aici, independent de runner):
#   cu --plafon-tranzactie-ms (runda 14, forma „un mesaj”): fisierele 00_sesiune (doar SET), 5_mesaj, 9_reset (doar
#     RESET), fara --single-transaction; 5_mesaj.sql = O interogare „SELECT $lm_..$<M>$lm_..$ \gexec”, iar M (tot ce e
#     intre BEGIN si COMMIT, inclusiv garda finala) e verificat octet cu octet de scripts/test_livrare_mesaj_unic.py fata
#     de artefactul original si sha-ul lui (+ un control: copia schimbata intr-un octet e respinsa) => intre BEGIN si
#     COMMIT nu exista drum client-server; --genereaza-in = fisierele, cod 40, niciun apel psql;
#   (r12-r13: 9_fin.sql = [garda; COMMIT] + [RESET]; inlocuit in runda 14 — garda e acum in mesajul intregii tranzactii)
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

MIG="$TMP/20990101a_forma_fin.sql"
printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\nEND \$g\$;\nCREATE TABLE public.t_forma (id integer);\n" >"$MIG"
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
livreaza() { # $1 directorul de captura, restul = optiuni suplimentare
  mkdir "$1"
  FALS_DIR="$1" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" \
    --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 "${@:2}" \
    >"$1/runner.log" 2>&1 || { cat "$1/runner.log"; fail "runnerul a iesit cu eroare (${*:2})"; }
}

# 1. Cu plafon (runda 14): SET de sesiune, apoi TOATA tranzactia intr-un mesaj (\gexec), apoi RESET.
P="$TMP/cu"; livreaza "$P" --plafon-tranzactie-ms 2000
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$P/apeluri")"
[[ "$(printf '%s\n' "$LIV" | wc -l | tr -d ' ')" == 1 ]] || fail "cu plafon: asteptam UN apel de livrare, am: $LIV"
[[ "$LIV" == *" -X -q -v ON_ERROR_STOP=1 -f 00_sesiune.sql -f 5_mesaj.sql -f 9_reset.sql -h "* ]] \
  || fail "cu plafon: ordinea / optiunile psql: $LIV"
[[ "$LIV" != *single-transaction* ]] || fail 'cu plafon: --single-transaction nu are voie sa apara (BEGIN / COMMIT sunt ale runnerului)'
N="${LIV%%:*}"
[[ "$(cat "$P/${N}_00_sesiune.sql")" == 'SET transaction_timeout = 2000;' ]] || fail "cu plafon: 00_sesiune.sql trebuie sa fie doar SET-ul de sesiune: $(cat "$P/${N}_00_sesiune.sql")"
[[ "$(cat "$P/${N}_9_reset.sql")" == 'RESET transaction_timeout;' ]] || fail 'cu plafon: 9_reset.sql trebuie sa fie doar RESET'
# psql: 5_mesaj.sql = O interogare + \gexec; serverul primeste M ca UN mesaj (verificat independent, octet cu octet).
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" 2000 >"$P/mesaj_unic.log" 2>&1 \
  || { cat "$P/mesaj_unic.log"; fail 'cu plafon: 5_mesaj.sql nu e forma un mesaj'; }
grep -q 'APLICAT + ÎNREGISTRAT confirmat' "$P/runner.log" || { cat "$P/runner.log"; fail 'cu plafon: reconcilierea'; }
grep -q '0 drumuri client-server' "$P/runner.log" || { cat "$P/runner.log"; fail 'cu plafon: runnerul nu anunta forma un mesaj'; }
# Control: verificatorul chiar prinde o abatere (un octet schimbat in copia din mesaj => felia copiei nu mai e aprobata).
python3 - "$P/${N}_5_mesaj.sql" "$P/mutant_5_mesaj.sql" <<'PY'
import sys
b = open(sys.argv[1], 'rb').read(); k = b.index(b'CREATE TABLE public.t_forma')
open(sys.argv[2], 'wb').write(b[:k] + b'CREATE TABLE public.t_formb' + b[k + 27:])
PY
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/mutant_5_mesaj.sql" "$MIG" "$SHA" 2000 >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul accepta un mesaj cu copia schimbata'
echo "FORMA_CU_PLAFON: 00_sesiune (SET) + 5_mesaj (O interogare + \\gexec) + 9_reset, fara --single-transaction; $(cat "$P/mesaj_unic.log")"

# 1b. --genereaza-in: fisierele livrarii, FARA nicio conexiune (cod 40) — folosit de scripts/portal/dry_prod_e1.sh.
G="$TMP/gen"; mkdir "$G"; rc=0
FALS_DIR="$G" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" \
  --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 \
  --plafon-tranzactie-ms 2000 --genereaza-in "$G/fisiere" >"$G/runner.log" 2>&1 || rc=$?
[[ "$rc" == 40 ]] || { cat "$G/runner.log"; fail "genereaza-in: cod $rc, asteptat 40"; }
[[ ! -e "$G/apeluri" ]] || fail "genereaza-in: psql a fost apelat: $(cat "$G/apeluri")"
for f in 00_sesiune.sql 0_prolog.sql 1_pre.sql 3_inreg.sql 5_mesaj.sql 9_reset.sql m_mesaj.sql 20990101a_forma_fin.sql; do
  [[ -f "$G/fisiere/$f" ]] || fail "genereaza-in: lipseste $f"
done
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$G/fisiere/5_mesaj.sql" "$MIG" "$SHA" 2000 >/dev/null || fail 'genereaza-in: 5_mesaj.sql'
rc=0; FALS_DIR="$G" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" \
  --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 \
  --plafon-tranzactie-ms 2000 --genereaza-in "$G/fisiere" >"$G/runner2.log" 2>&1 || rc=$?
[[ "$rc" == 2 ]] || { cat "$G/runner2.log"; fail "genereaza-in: dosar existent trebuia refuzat (2), cod $rc"; }
echo 'FORMA_GENEREAZA: --genereaza-in => fisierele (inclusiv 5_mesaj.sql verificat), cod 40, niciun apel psql; dosar existent => refuz 2'

# 2. Fara optiune: invocarea de dinainte, nimic despre plafon.
F="$TMP/fara"; livreaza "$F"
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$F/apeluri")"
[[ "$LIV" == *" -X -q -v ON_ERROR_STOP=1 --single-transaction -f 0_prolog.sql -f 1_pre.sql -f 20990101a_forma_fin.sql -f 3_inreg.sql -h "* ]] \
  || fail "fara: invocarea veche (--single-transaction, 4 fisiere): $LIV"
! ls "$F" | grep -q '_00_sesiune.sql\|_5_mesaj.sql\|_9_reset.sql\|_9_fin.sql' || fail 'fara: fisierele formei cu plafon trimise fara optiune'
# r13 (harness r15): datele testului (baza tinta, numele si continutul migrarii) NU au voie sa contina cuvintele cautate,
# altfel verificarea de mai jos raspunde la ele, nu la runner (r15 folosea --tinta-db plafon_test => fals pozitiv in 1_pre).
! printf '%s\n' forma_test "${MIG##*/}" | cat - "$MIG" | grep -qi 'transaction_timeout\|plafon' \
  || fail 'proba nefunctionala: datele testului contin cuvintele cautate'
# Control: aceeasi cautare pe fisierele trimise CU optiune le gaseste (deci cautarea chiar prinde mentiunile plafonului).
cat "$P"/*_*.sql | grep -qi 'transaction_timeout' && cat "$P"/*_*.sql | grep -qi 'plafon' \
  || fail 'proba nefunctionala: cautarea nu gaseste plafonul nici in fisierele trimise cu optiune'
! cat "$F"/*_*.sql | grep -qi 'transaction_timeout\|plafon' || { grep -il 'transaction_timeout\|plafon' "$F"/*_*.sql; fail 'fara: fisierele trimise mentioneaza plafonul'; }
echo 'FORMA_FARA: psql --single-transaction cu 0_prolog, 1_pre, copia, 3_inreg (ca inainte); nicio mentiune a plafonului'
echo 'PASS test_livrare_forma_fin: cu plafon TOATA tranzactia (BEGIN ... garda finala, COMMIT) intr-un singur mesaj, verificat octet cu octet; --genereaza-in fara conexiune; forma veche neschimbata (fara)'
