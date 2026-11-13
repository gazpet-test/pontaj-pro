#!/usr/bin/env bash
# L15 v2 (13.11.2026, docs/LIVRARE_L15_V2.md): forma livrarii cu --amprenta-globala + --diferente-globale, FARA PostgreSQL
# (psql fals care copiaza fisierele primite si raspunde la reconciliere, ca scripts/test_livrare_forma_fin.sh).
#   bash scripts/test_livrare_l15_forma.sh          (Git Bash sau Linux; cere python3 pentru verificatorul mesajului)
# Ce verifica (expected scris aici, din cerere):
#   argumente: o optiune fara cealalta, md5 invalid, manifest cu alt nume, PGTZ / PGDATESTYLE din mediu => refuz 2, niciun
#     apel psql; manifest cu format gresit / backslash => refuz 3; --aprobare fara randul manifestului / cu alt sha => 3;
#   cu plafon: UN apel de livrare (00_sesiune, 5_mesaj, 9_reset), iar mesajul trece verificatorul independent CU --l15
#     (pasii inainte imediat inaintea copiei, dupa imediat dupa inregistrare, corpul = blocul AG_CATALOG v2, md5-ul aprobat,
#     manifestul exact); control: alt md5 / alt manifest dat verificatorului => respins;
#   fara plafon: psql --single-transaction cu 0_prolog, 1_pre, 2_ag_inainte, copia, 3_inreg, 4_ag_dupa (in ordinea asta);
#   --genereaza-in: si 2_ag_inainte.sql, 4_ag_dupa.sql si copia manifestului, cod 40, niciun apel psql;
#   fara optiunile noi: nicio urma a pasilor (nici „ag_”, nici AMPRENTA_GLOBALA) in fisierele trimise.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
fail() { echo "ESEC: $*" >&2; exit 1; }

cat >"$TMP/psql_fals" <<'EOF'
#!/usr/bin/env bash
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

NUME=20990101a_forma_l15
MIG="$TMP/$NUME.sql"
printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\nEND \$g\$;\nCREATE TABLE public.t_forma_l15 (id integer);\n" >"$MIG"
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
AG=0123456789abcdef0123456789abcdef
MAN="$TMP/$NUME.l15.tsv"
printf '# manifest de proba\nrelatie\trelatie public.t_forma_l15\tcreat\t%s\ncoloana\tcoloana public.t_forma_l15.id\tcreat\t%s\n' \
  "$(printf a%.0s {1..32})" "$(printf b%.0s {1..32})" >"$MAN"
livreaza() { # $1 directorul de captura, $2 codul asteptat, restul = optiuni suplimentare
  local d="$1" exp="$2" rc=0; shift 2
  mkdir "$d"
  FALS_DIR="$d" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" \
    --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 "$@" \
    >"$d/runner.log" 2>&1 || rc=$?
  [ "$rc" = "$exp" ] || { cat "$d/runner.log"; fail "cod $rc, asteptat $exp (optiuni: $*)"; }
}

# 1. Argumente: refuz 2 / 3, niciun apel psql.
i=0
while IFS='|' read -r exp mesaj opt; do
  i=$((i + 1)); d="$TMP/arg$i"
  # shellcheck disable=SC2086
  livreaza "$d" "$exp" --sha256 "$SHA" --plafon-tranzactie-ms 2000 $opt
  [ ! -e "$d/apeluri" ] || fail "argumente $i: psql apelat ($opt)"
  grep -qF "$mesaj" "$d/runner.log" || { cat "$d/runner.log"; fail "argumente $i: mesajul '$mesaj' lipseste"; }
done <<EOF
2|se folosesc ÎMPREUNĂ|--amprenta-globala $AG
2|se folosesc ÎMPREUNĂ|--diferente-globale $MAN
2|md5 (32 hex|--amprenta-globala ABC --diferente-globale $MAN
2|md5 (32 hex|--amprenta-globala ${AG^^} --diferente-globale $MAN
EOF
cp "$MAN" "$TMP/alt_nume.l15.tsv"
livreaza "$TMP/arg_nume" 2 --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$TMP/alt_nume.l15.tsv"
grep -qF "se numește $NUME.l15.tsv" "$TMP/arg_nume/runner.log" || fail 'manifest cu alt nume: mesaj'
for v in PGTZ PGDATESTYLE; do
  d="$TMP/arg_$v"; mkdir "$d"; rc=0
  env "$v=x" FALS_DIR="$d" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" \
    --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 \
    --amprenta-globala "$AG" --diferente-globale "$MAN" >"$d/runner.log" 2>&1 || rc=$?
  [ "$rc" = 2 ] && grep -qF "variabila $v e setată" "$d/runner.log" && [ ! -e "$d/apeluri" ] || { cat "$d/runner.log"; fail "$v din mediu: cod $rc"; }
done
mkdir "$TMP/rau"
for caz in format backslash; do
  f="$TMP/rau/$caz/$NUME.l15.tsv"; mkdir "$TMP/rau/$caz"
  case "$caz" in
    format) printf 'relatie\trelatie public.x\tcreat\tnu-e-md5\n' >"$f" ;;
    backslash) printf 'relatie\trelatie public.x\\y\tcreat\t%s\n' "$(printf c%.0s {1..32})" >"$f" ;;
  esac
  livreaza "$TMP/rau_$caz" 3 --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$f"
  [ ! -e "$TMP/rau_$caz/apeluri" ] || fail "manifest $caz: psql apelat"
done
printf '%s  %s.sql\n' "$SHA" "$NUME" >"$TMP/aprobare_fara"
livreaza "$TMP/apr_fara" 3 --aprobare "$TMP/aprobare_fara" --amprenta-globala "$AG" --diferente-globale "$MAN"
printf '%s  %s.sql\n%s  %s.l15.tsv\n' "$SHA" "$NUME" "$(printf d%.0s {1..64})" "$NUME" >"$TMP/aprobare_alt"
livreaza "$TMP/apr_alt" 3 --aprobare "$TMP/aprobare_alt" --amprenta-globala "$AG" --diferente-globale "$MAN"
echo 'L15_FORMA_ARG: o optiune fara cealalta, md5 invalid / cu majuscule, alt nume de manifest, PGTZ / PGDATESTYLE => 2; manifest cu format gresit / backslash, aprobare fara randul manifestului / cu alt sha => 3; niciun apel psql'

# 2. Cu plafon: un mesaj; verificatorul independent cu --l15.
printf '%s  %s.sql\n%s  %s.l15.tsv\n' "$SHA" "$NUME" "$(sha256sum "$MAN" | cut -d' ' -f1)" "$NUME" >"$TMP/aprobare_ok"
P="$TMP/cu"; livreaza "$P" 0 --aprobare "$TMP/aprobare_ok" --plafon-tranzactie-ms 2000 --amprenta-globala "$AG" --diferente-globale "$MAN"
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$P/apeluri")"
[[ "$(printf '%s\n' "$LIV" | wc -l | tr -d ' ')" == 1 && "$LIV" == *" -f 00_sesiune.sql -f 5_mesaj.sql -f 9_reset.sql -h "* ]] || fail "cu plafon: apelul de livrare: $LIV"
N="${LIV%%:*}"
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" 2000 --l15 "$AG" "$MAN" >"$P/mu.log" 2>&1 \
  || { cat "$P/mu.log"; fail 'cu plafon: mesajul nu trece verificatorul cu --l15'; }
grep -q 'L15 v2: amprenta globala inainte / dupa' "$P/mu.log" || fail 'cu plafon: verificatorul nu a facut verificarea L15'
grep -q 'AMPRENTA_GLOBALA înainte + copie + înregistrare + AMPRENTA_GLOBALA după = manifest' "$P/runner.log" || fail 'cu plafon: runnerul nu anunta pasii'
grep -q "manifest $NUME.l15.tsv sha256 .* = aprobat" "$P/runner.log" || { cat "$P/runner.log"; fail 'cu plafon: sha-ul manifestului nu e anuntat ca aprobat'; }
# control: verificatorul chiar compara md5-ul si manifestul
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" 2000 --l15 "$(printf e%.0s {1..32})" "$MAN" >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul accepta alt md5'
sed 's/creat/schimbat/' "$MAN" >"$TMP/alt.tsv"
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" 2000 --l15 "$AG" "$TMP/alt.tsv" >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul accepta alt manifest'
# si fara --l15 mesajul ramane o livrare valida (verificarile de dinainte nu se schimba)
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" 2000 >/dev/null || fail 'cu plafon: verificatorul vechi respinge mesajul L15'
echo "L15_FORMA_PLAFON: un mesaj; inainte imediat inaintea copiei, dupa imediat dupa inregistrare, corpul = blocul, md5 + manifest exacte; $(cat "$P/mu.log")"

# 3. Fara plafon: fisierele in --single-transaction, in ordine.
F="$TMP/fara_plafon"; livreaza "$F" 0 --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$MAN"
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$F/apeluri")"
[[ "$LIV" == *" -X -q -v ON_ERROR_STOP=1 --single-transaction -f 0_prolog.sql -f 1_pre.sql -f 2_ag_inainte.sql -f $NUME.sql -f 3_inreg.sql -f 4_ag_dupa.sql -h "* ]] \
  || fail "fara plafon: invocarea: $LIV"
N="${LIV%%:*}"
grep -q "IS DISTINCT FROM '$AG'" "$F/${N}_2_ag_inainte.sql" && grep -q "IS DISTINCT FROM '$AG'" "$F/${N}_4_ag_dupa.sql" || fail 'fara plafon: md5-ul aprobat lipseste din pasi'
grep -qF "$(sed -n 3p "$MAN")" "$F/${N}_4_ag_dupa.sql" || fail 'fara plafon: manifestul lipseste din pasul dupa'
echo 'L15_FORMA_FARA_PLAFON: --single-transaction cu 0_prolog, 1_pre, 2_ag_inainte, copia, 3_inreg, 4_ag_dupa'

# 4. --genereaza-in: fisierele noi, cod 40, niciun apel psql.
G="$TMP/gen"; mkdir "$G"; rc=0
FALS_DIR="$G" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" \
  --versiune 20990101000001 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 \
  --plafon-tranzactie-ms 2000 --amprenta-globala "$AG" --diferente-globale "$MAN" --genereaza-in "$G/f" >"$G/runner.log" 2>&1 || rc=$?
[ "$rc" = 40 ] && [ ! -e "$G/apeluri" ] || { cat "$G/runner.log"; fail "genereaza-in: cod $rc"; }
for f in 2_ag_inainte.sql 4_ag_dupa.sql 5_mesaj.sql "$NUME.l15.tsv"; do [ -f "$G/f/$f" ] || fail "genereaza-in: lipseste $f"; done
cmp -s "$G/f/$NUME.l15.tsv" "$MAN" || fail 'genereaza-in: copia manifestului difera'
echo 'L15_FORMA_GENEREAZA: 2_ag_inainte, 4_ag_dupa, 5_mesaj, copia manifestului; cod 40; niciun apel psql'

# 5. Fara optiunile noi: nicio urma a pasilor.
Z="$TMP/fara"; livreaza "$Z" 0 --sha256 "$SHA" --plafon-tranzactie-ms 2000
Y="$TMP/fara2"; livreaza "$Y" 0 --sha256 "$SHA"
! cat "$Z"/*_*.sql "$Y"/*_*.sql | grep -q 'ag_cat_\|ag_inainte_\|AMPRENTA_GLOBALA' || fail 'fara optiuni: pasii L15 apar in fisierele trimise'
cat "$P"/*_*.sql | grep -q 'ag_cat_' || fail 'proba nefunctionala: cautarea nu gaseste pasii nici cu optiunile'
! grep -q 'AMPRENTA_GLOBALA\|L15' "$Z/runner.log" "$Y/runner.log" || fail 'fara optiuni: runnerul mentioneaza L15'
echo 'L15_FORMA_FARA: fara optiuni nicio urma a pasilor (cu si fara plafon)'
echo 'PASS test_livrare_l15_forma'
