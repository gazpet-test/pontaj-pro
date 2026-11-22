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
#   runda 16 (17.11.2026): cu amprenta globala plafonul e EXACT AG_PLAFON_MS (5000, scripts/livrare_amprenta.sh) => 2000 / 60000
#     = refuz 2, niciun apel psql; garda finala a mesajului L15 are LOCK_TINUT (diagnostic), cea fara L15 nu (octet cu octet ca main);
#     o migrare care cere alt plafon decat cel dat runnerului = refuz 3 (validatorul, PLAFON_DIFERIT), niciun apel psql.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# plafonul livrarilor L15 v2: din biblioteca runnerului (o singura definitie), nu copiat aici
PL="$(bash -c '. "$1"; printf %s "$AG_PLAFON_MS"' _ "$ROOT/scripts/livrare_amprenta.sh")"
[ "$PL" = 5000 ] || { echo "ESEC: AG_PLAFON_MS = '$PL', asteptat 5000 (decizia proprietarului 17.11.2026)" >&2; exit 1; }
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
  livreaza "$d" "$exp" --sha256 "$SHA" --plafon-tranzactie-ms "$PL" $opt
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
# runda 16: plafonul cu amprenta globala = exact AG_PLAFON_MS; plafonul vechi (2000) sau altul => refuz 2, niciun apel psql
for v in 2000 60000; do
  livreaza "$TMP/pl_$v" 2 --sha256 "$SHA" --plafon-tranzactie-ms "$v" --amprenta-globala "$AG" --diferente-globale "$MAN"
  [ ! -e "$TMP/pl_$v/apeluri" ] || fail "plafon $v cu L15: psql apelat"
  grep -qF "plafonul tranzactiei cu amprenta globala este $PL ms" "$TMP/pl_$v/runner.log" || { cat "$TMP/pl_$v/runner.log"; fail "plafon $v cu L15: mesajul"; }
done
# runda 16: o migrare care cere alt plafon decat cel dat runnerului => refuz 3 (validatorul), in ambele sensuri, niciun apel psql
for c in 2000:"$PL" "$PL":2000; do
  cere="${c%%:*}" da="${c##*:}"; d="$TMP/acord_$cere"; mkdir "$d"
  printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\n  IF (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout') IS DISTINCT FROM '%s/session' THEN RAISE EXCEPTION 'p'; END IF;\nEND \$g\$;\n" "$cere" >"$d/${NUME%_l15}_acord.sql"
  M2="$d/${NUME%_l15}_acord.sql"; rc=0
  FALS_DIR="$d" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$M2" --sha256 "$(sha256sum "$M2" | cut -d' ' -f1)" \
    --versiune 20990101000002 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 --plafon-tranzactie-ms "$da" >"$d/runner.log" 2>&1 || rc=$?
  [ "$rc" = 3 ] && [ ! -e "$d/apeluri" ] && grep -qF "PLAFON_DIFERIT: fișierul cere $cere ms" "$d/runner.log" || { cat "$d/runner.log"; fail "acord: cere $cere, dat $da: cod $rc"; }
done
echo "L15_FORMA_PLAFON_ACORD: cu L15 plafonul 2000 / 60000 => 2 (doar $PL); migrare care cere 2000 cu runnerul la $PL si invers => 3 (PLAFON_DIFERIT); niciun apel psql"
# runda 17 (verdictul PR #1115): (P1-1) comparatia plafonului in forma neverificabila = refuz 3 (PLAFON_FORMA), si cu forma buna intr-un
# comentariu; (P1-2) migrarea care cere plafon, cu runnerul FARA plafon (cu si fara L15) si cu generatorul de manifest fara plafon = refuz 3
# (PLAFON_LIPSA); niciun apel psql in niciun caz. Controlul: aceeasi migrare cu plafonul ei trece de validator (codul 0 al livrarii false).
CERE="$TMP/cere"; mkdir "$CERE"
M3="$CERE/${NUME%_l15}_cere.sql"
printf "DO \$g\$ DECLARE v_plafon text; BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\n  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';\n  IF v_plafon IS DISTINCT FROM '%s/session'\n     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n    RAISE EXCEPTION 'p %%', coalesce(v_plafon, 'lipsa'); END IF;\nEND \$g\$;\n" "$PL" "$PL" >"$M3"
livreaza_m() { # $1 dir, $2 cod, $3 migrarea, restul = optiuni
  local d="$1" exp="$2" m="$3" rc=0; shift 3; mkdir "$d"
  FALS_DIR="$d" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$m" --sha256 "$(sha256sum "$m" | cut -d' ' -f1)" \
    --versiune 20990101000003 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 "$@" >"$d/runner.log" 2>&1 || rc=$?
  [ "$rc" = "$exp" ] || { cat "$d/runner.log"; fail "$d: cod $rc, asteptat $exp"; }
}
cp "$MAN" "$CERE/$(basename "$M3" .sql).l15.tsv"
livreaza_m "$CERE/ok" 0 "$M3" --plafon-tranzactie-ms "$PL"
livreaza_m "$CERE/fara" 3 "$M3"
livreaza_m "$CERE/fara_l15" 3 "$M3" --amprenta-globala "$AG" --diferente-globale "$CERE/$(basename "$M3" .sql).l15.tsv"
for c in fara fara_l15; do
  [ ! -e "$CERE/$c/apeluri" ] && grep -qF 'PLAFON_LIPSA: fișierul cere plafonul tranzacției' "$CERE/$c/runner.log" \
    || { cat "$CERE/$c/runner.log"; fail "runner fara plafon ($c): asteptat PLAFON_LIPSA fara apel psql"; }
done
for v in "('2000' || '/session')" "/* '$PL/session' */ ('2000' || '/session')"; do
  k=$((${k:-0} + 1)); M4="$CERE/f$k/${NUME%_l15}_forma.sql"; mkdir "$CERE/f$k"
  sed "s#IS DISTINCT FROM '$PL/session'#IS DISTINCT FROM $v#" "$M3" >"$M4"
  ! cmp -s "$M3" "$M4" || fail "mutantul formei $k nu s-a aplicat"
  livreaza_m "$CERE/f$k/r" 3 "$M4" --plafon-tranzactie-ms "$PL"
  [ ! -e "$CERE/f$k/r/apeluri" ] && grep -qF 'PLAFON_FORMA' "$CERE/f$k/r/runner.log" \
    || { cat "$CERE/f$k/r/runner.log"; fail "forma neverificabila $k: asteptat PLAFON_FORMA fara apel psql"; }
done
mkdir "$CERE/gen"; rc=0
FALS_DIR="$CERE/gen" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_l15_manifest.sh" --migrare "$M3" --versiune 20990101000003 \
  --tinta-host 127.0.0.1 --tinta-port 1 --tinta-db forma_test --tinta-sistem 42 --user u --iesire "$CERE/gen/$(basename "$M3" .sql).l15.tsv" \
  >"$CERE/gen/gen.log" 2>&1 || rc=$?
[ "$rc" = 3 ] && [ ! -e "$CERE/gen/apeluri" ] && [ ! -e "$CERE/gen/$(basename "$M3" .sql).l15.tsv" ] && grep -qF 'PLAFON_LIPSA' "$CERE/gen/gen.log" \
  || { cat "$CERE/gen/gen.log"; fail "generatorul de manifest fara plafon: cod $rc, asteptat 3 (PLAFON_LIPSA, niciun apel psql)"; }
echo "L15_FORMA_PLAFON_R17: forma neverificabila (si cu forma buna in comentariu) => 3 PLAFON_FORMA; plafon omis (runner cu / fara L15, generatorul de manifest) => 3 PLAFON_LIPSA; niciun apel psql; controlul cu plafonul ei => 0"

# 2. Cu plafon: un mesaj; verificatorul independent cu --l15.
printf '%s  %s.sql\n%s  %s.l15.tsv\n' "$SHA" "$NUME" "$(sha256sum "$MAN" | cut -d' ' -f1)" "$NUME" >"$TMP/aprobare_ok"
P="$TMP/cu"; livreaza "$P" 0 --aprobare "$TMP/aprobare_ok" --plafon-tranzactie-ms "$PL" --amprenta-globala "$AG" --diferente-globale "$MAN"
LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$P/apeluri")"
[[ "$(printf '%s\n' "$LIV" | wc -l | tr -d ' ')" == 1 && "$LIV" == *" -f 00_sesiune.sql -f 5_mesaj.sql -f 9_reset.sql -h "* ]] || fail "cu plafon: apelul de livrare: $LIV"
N="${LIV%%:*}"
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" "$PL" --l15 "$AG" "$MAN" >"$P/mu.log" 2>&1 \
  || { cat "$P/mu.log"; fail 'cu plafon: mesajul nu trece verificatorul cu --l15'; }
grep -q 'L15 v2: amprenta globala inainte / dupa' "$P/mu.log" || fail 'cu plafon: verificatorul nu a facut verificarea L15'
grep -q 'AMPRENTA_GLOBALA înainte + copie + înregistrare + AMPRENTA_GLOBALA după = manifest' "$P/runner.log" || fail 'cu plafon: runnerul nu anunta pasii'
grep -q "manifest $NUME.l15.tsv sha256 .* = aprobat" "$P/runner.log" || { cat "$P/runner.log"; fail 'cu plafon: sha-ul manifestului nu e anuntat ca aprobat'; }
# runda 16: garda finala a mesajului L15 raporteaza si durata lock-urilor puternice (dupa PLAFON_TIMP, in acelasi DO)
grep -q "LOCK_TINUT $NUME: lock-urile puternice ale migrarii tinute" "$P/${N}_5_mesaj.sql" \
  && [ "$(grep -o 'PLAFON_TIMP\|LOCK_TINUT' "$P/${N}_5_mesaj.sql" | tr '\n' ' ')" = 'PLAFON_TIMP LOCK_TINUT LOCK_TINUT ' ] \
  || fail 'cu plafon: LOCK_TINUT lipseste din garda finala L15 (sau nu e dupa PLAFON_TIMP)'
# control: verificatorul chiar compara md5-ul si manifestul
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" "$PL" --l15 "$(printf e%.0s {1..32})" "$MAN" >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul accepta alt md5'
sed 's/creat/schimbat/' "$MAN" >"$TMP/alt.tsv"
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" "$PL" --l15 "$AG" "$TMP/alt.tsv" >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul accepta alt manifest'
# si fara --l15 mesajul ramane o livrare valida (verificarile de dinainte nu se schimba)
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/${N}_5_mesaj.sql" "$MIG" "$SHA" "$PL" >/dev/null || fail 'cu plafon: verificatorul vechi respinge mesajul L15'
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
  --plafon-tranzactie-ms "$PL" --amprenta-globala "$AG" --diferente-globale "$MAN" --genereaza-in "$G/f" >"$G/runner.log" 2>&1 || rc=$?
[ "$rc" = 40 ] && [ ! -e "$G/apeluri" ] || { cat "$G/runner.log"; fail "genereaza-in: cod $rc"; }
for f in 2_ag_inainte.sql 4_ag_dupa.sql 5_mesaj.sql "$NUME.l15.tsv"; do [ -f "$G/f/$f" ] || fail "genereaza-in: lipseste $f"; done
cmp -s "$G/f/$NUME.l15.tsv" "$MAN" || fail 'genereaza-in: copia manifestului difera'
echo 'L15_FORMA_GENEREAZA: 2_ag_inainte, 4_ag_dupa, 5_mesaj, copia manifestului; cod 40; niciun apel psql'

# 5. Fara optiunile noi: nicio urma a pasilor.
Z="$TMP/fara"; livreaza "$Z" 0 --sha256 "$SHA" --plafon-tranzactie-ms 2000
Y="$TMP/fara2"; livreaza "$Y" 0 --sha256 "$SHA"
! cat "$Z"/*_*.sql "$Y"/*_*.sql | grep -q 'ag_cat_\|ag_inainte_\|AMPRENTA_GLOBALA\|LOCK_TINUT\|lock_puternic_la' || fail 'fara optiuni: pasii L15 apar in fisierele trimise'
grep -q 'ag_cat_' "$P"/*_*.sql || fail 'proba nefunctionala: cautarea nu gaseste pasii nici cu optiunile'   # fara pipe: grep -q inchide teava devreme, iar pe Windows cat iese cu eroare (pipefail)
! grep -q 'AMPRENTA_GLOBALA\|L15' "$Z/runner.log" "$Y/runner.log" || fail 'fara optiuni: runnerul mentioneaza L15'
echo 'L15_FORMA_FARA: fara optiuni nicio urma a pasilor (cu si fara plafon)'

# 6. Runda 18 (22.11.2026, decizia proprietarului: plafonul EXTINS, docs/LIVRARE_L15_V2.md §9). Expected scris din cerere:
#   15000 fara --plafon-extins (cu L15) => 2 (doar 5000, ca azi); --plafon-extins cu 5000 => 2; --plafon-extins fara L15 => 2; de doua ori => 2;
#   cu flag + 15000 + L15: in afara ferestrei (ora Europe/Bucharest reala) => 2 PLAFON_EXTINS_FEREASTRA fara niciun apel psql, in fereastra =>
#   livrare (un mesaj) cu pasul DO $plafon_fereastra$ imediat dupa verificarea „un mesaj” (verificatorul cu --fereastra); --genereaza-in nu depinde
#   de ora (nicio conexiune) si produce 1a_fereastra.sql + mesajul cu pasul; validatorul: migrarea care cere 5000 cu flag + 15000 => 3
#   PLAFON_DIFERIT, migrarea care cere 15000 fara declaratia --plafon-extins => 3 PLAFON_EXTINS_DIFERIT, migrarea care declara flag-ul livrata
#   fara el => 3 PLAFON_EXTINS_DIFERIT; generatorul: --iesire (clona) FARA pasul ferestrei si fara verificarea orei, --compara-cu (proba pe
#   tinta) CU pasul si cu verificarea orei; fara flag: nicio urma „plafon_fereastra” in fisierele trimise pana acum.
PLX="$(bash -c '. "$1"; printf %s "$AG_PLAFON_EXTINS_MS"' _ "$ROOT/scripts/livrare_amprenta.sh")"
[ "$PLX" = 15000 ] || fail "AG_PLAFON_EXTINS_MS = '$PLX', asteptat 15000 (decizia proprietarului 22.11.2026)"
livreaza "$TMP/x_fara_flag" 2 --sha256 "$SHA" --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$MAN"
grep -qF "cere optiunea explicita --plafon-extins" "$TMP/x_fara_flag/runner.log" || { cat "$TMP/x_fara_flag/runner.log"; fail '15000 fara flag: mesajul'; }
livreaza "$TMP/x_flag_5000" 2 --sha256 "$SHA" --plafon-tranzactie-ms "$PL" --amprenta-globala "$AG" --diferente-globale "$MAN" --plafon-extins
grep -qF -- "--plafon-extins cere --plafon-tranzactie-ms $PLX" "$TMP/x_flag_5000/runner.log" || { cat "$TMP/x_flag_5000/runner.log"; fail 'flag + 5000: mesajul'; }
livreaza "$TMP/x_flag_gol" 2 --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$MAN" --plafon-extins
grep -qF -- "--plafon-extins cere --plafon-tranzactie-ms $PLX" "$TMP/x_flag_gol/runner.log" || { cat "$TMP/x_flag_gol/runner.log"; fail 'flag fara plafon: mesajul'; }
livreaza "$TMP/x_flag_fara_l15" 2 --sha256 "$SHA" --plafon-tranzactie-ms "$PLX" --plafon-extins
grep -qF "DOAR la livrările cu amprentă globală" "$TMP/x_flag_fara_l15/runner.log" || { cat "$TMP/x_flag_fara_l15/runner.log"; fail 'flag fara L15: mesajul'; }
livreaza "$TMP/x_flag_dublu" 2 --sha256 "$SHA" --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$MAN" --plafon-extins --plafon-extins
grep -qF "opțiunea --plafon-extins se dă o singură dată" "$TMP/x_flag_dublu/runner.log" || { cat "$TMP/x_flag_dublu/runner.log"; fail 'flag dublu: mesajul'; }
for d in x_fara_flag x_flag_5000 x_flag_gol x_flag_fara_l15 x_flag_dublu; do [ ! -e "$TMP/$d/apeluri" ] || fail "$d: psql apelat"; done
echo "L15_FORMA_PLX_ARG: $PLX fara --plafon-extins => 2 (doar $PL); flag cu $PL / fara plafon / fara L15 / de doua ori => 2; niciun apel psql"
# migrarea care cere plafonul extins si il declara in antet (forma validata: un literal, IS DISTINCT FROM, marcajul)
X="$TMP/extins"; mkdir "$X"
M5="$X/${NUME%_l15}_extins.sql"
{ printf -- "-- Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms %s --plafon-extins --amprenta-globala <md5> --diferente-globale ...\n" "$PLX"
  sed "s#'$PL/session'#'$PLX/session'#; s#'$PL:'#'$PLX:'#" "$M3"; } >"$M5"
[ "$(grep -c "$PLX" "$M5")" = 3 ] || fail "migrarea extinsa nu cere $PLX de 3 ori (antet, garda, marcaj)"
cp "$MAN" "$X/$(basename "$M5" .sql).l15.tsv"; MAN5="$X/$(basename "$M5" .sql).l15.tsv"
ORA="$(bash -c '. "$1"; ag_ora_bucuresti' _ "$ROOT/scripts/livrare_amprenta.sh")" || fail 'ora Europe/Bucharest nu se poate calcula local'
IN=0; bash -c '. "$1"; ag_fereastra_in "$2"' _ "$ROOT/scripts/livrare_amprenta.sh" "$ORA" && IN=1
if [ "$IN" = 1 ]; then
  livreaza_m "$X/liv" 0 "$M5" --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$MAN5" --plafon-extins
  LIV="$(grep -v 'reconc.sql\|control_0e.sql' "$X/liv/apeluri")"; N="${LIV%%:*}"
  [[ "$LIV" == *" -f 00_sesiune.sql -f 5_mesaj.sql -f 9_reset.sql -h "* ]] || fail "extins in fereastra: apelul de livrare: $LIV"
  python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$X/liv/${N}_5_mesaj.sql" "$M5" "$(sha256sum "$M5" | cut -d' ' -f1)" "$PLX" --fereastra --l15 "$AG" "$MAN5" >"$X/liv/mu.log" 2>&1 \
    || { cat "$X/liv/mu.log"; fail 'extins in fereastra: mesajul nu trece verificatorul cu --fereastra --l15'; }
  grep -q "plafon EXTINS ~$PLX ms" "$X/liv/runner.log" && grep -q "fereastra orară (server)" "$X/liv/runner.log" && grep -q "in fereastra" "$X/liv/runner.log" \
    || { cat "$X/liv/runner.log"; fail 'extins in fereastra: runnerul nu anunta plafonul extins / fereastra'; }
  grep -q "SET transaction_timeout = $PLX;" "$X/liv/${N}_00_sesiune.sql" || fail 'extins: 00_sesiune nu pune 15000'
  echo "L15_FORMA_PLX_FEREASTRA: ora $ORA in fereastra => livrare un mesaj cu DO plafon_fereastra dupa verificarea un mesaj; $(cat "$X/liv/mu.log")"
else
  livreaza_m "$X/liv" 2 "$M5" --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$MAN5" --plafon-extins
  [ ! -e "$X/liv/apeluri" ] && grep -qF "PLAFON_EXTINS_FEREASTRA: ora Europe/Bucharest e " "$X/liv/runner.log" && grep -qF "in afara ferestrei 21:00:00-06:00:00" "$X/liv/runner.log" \
    || { cat "$X/liv/runner.log"; fail 'extins in afara ferestrei: asteptat refuz 2 PLAFON_EXTINS_FEREASTRA fara apel psql'; }
  echo "L15_FORMA_PLX_FEREASTRA: ora $ORA in afara ferestrei => 2 PLAFON_EXTINS_FEREASTRA, niciun apel psql"
fi
# --genereaza-in: nu depinde de ora (nicio conexiune); 1a_fereastra.sql generat, mesajul cu pasul ferestrei primul dupa verificarea un mesaj
mkdir "$X/gen"; rc=0
FALS_DIR="$X/gen" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$M5" --sha256 "$(sha256sum "$M5" | cut -d' ' -f1)" \
  --versiune 20990101000004 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 \
  --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$MAN5" --plafon-extins --genereaza-in "$X/gen/f" >"$X/gen/runner.log" 2>&1 || rc=$?
[ "$rc" = 40 ] && [ ! -e "$X/gen/apeluri" ] || { cat "$X/gen/runner.log"; fail "extins --genereaza-in: cod $rc (asteptat 40, fara ora)"; }
[ -f "$X/gen/f/1a_fereastra.sql" ] && grep -qF 'DO $plafon_fereastra$' "$X/gen/f/1a_fereastra.sql" || fail 'extins --genereaza-in: 1a_fereastra.sql lipseste'
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$X/gen/f/5_mesaj.sql" "$M5" "$(sha256sum "$M5" | cut -d' ' -f1)" "$PLX" --fereastra --l15 "$AG" "$MAN5" >"$X/gen/mu.log" 2>&1 \
  || { cat "$X/gen/mu.log"; fail 'extins --genereaza-in: mesajul nu trece verificatorul cu --fereastra --l15'; }
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$X/gen/f/5_mesaj.sql" "$M5" "$(sha256sum "$M5" | cut -d' ' -f1)" "$PLX" --l15 "$AG" "$MAN5" >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul FARA --fereastra accepta mesajul cu pasul ferestrei'
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$P/$(grep -v 'reconc.sql\|control_0e.sql' "$P/apeluri" | cut -d: -f1)_5_mesaj.sql" "$MIG" "$SHA" "$PL" --fereastra --l15 "$AG" "$MAN" >/dev/null 2>&1 \
  || fail 'proba nefunctionala: verificatorul cu --fereastra accepta mesajul 5000 fara pasul ferestrei'
echo "L15_FORMA_PLX_GEN: --genereaza-in cu flag => 40 indiferent de ora, 1a_fereastra.sql + mesajul cu pasul ferestrei; verificatorul deosebeste cu / fara --fereastra"
# acordul validatorului (toate inainte de conexiune, prin --genereaza-in ca sa nu depinda de ora): 3, niciun apel psql
gen_m() { # $1 dir, $2 cod asteptat, $3 migrarea, $4 fragment, restul optiuni
  local d="$1" exp="$2" m="$3" frag="$4" rc=0; shift 4; mkdir "$d"
  FALS_DIR="$d" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$m" --sha256 "$(sha256sum "$m" | cut -d' ' -f1)" \
    --versiune 20990101000005 --tinta-db forma_test --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 "$@" --genereaza-in "$d/f" >"$d/runner.log" 2>&1 || rc=$?
  [ "$rc" = "$exp" ] && [ ! -e "$d/apeluri" ] && grep -qF "$frag" "$d/runner.log" || { cat "$d/runner.log"; fail "$d: cod $rc (asteptat $exp, '$frag')"; }
}
cp "$MAN" "$X/$(basename "$M3" .sql).l15.tsv"
gen_m "$X/acord_5000" 3 "$M3" 'PLAFON_DIFERIT: fișierul cere 5000 ms' --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$X/$(basename "$M3" .sql).l15.tsv" --plafon-extins
M7="$X/${NUME%_l15}_nedeclarat.sql"; sed '1d' "$M5" >"$M7"; cp "$MAN" "$X/$(basename "$M7" .sql).l15.tsv"
! grep -q -- '--plafon-extins' "$M7" && grep -q "'$PLX/session'" "$M7" || fail 'mutantul nedeclarat nu s-a construit'
gen_m "$X/acord_nedeclarat" 3 "$M7" 'PLAFON_EXTINS_DIFERIT: runnerul livrează cu plafonul EXTINS' --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$X/$(basename "$M7" .sql).l15.tsv" --plafon-extins
M8="$X/${NUME%_l15}_declarat5000.sql"; { head -n 1 "$M5"; cat "$M3"; } >"$M8"; cp "$MAN" "$X/$(basename "$M8" .sql).l15.tsv"
gen_m "$X/acord_declarat" 3 "$M8" 'PLAFON_DIFERIT: fișierul cere 15000 ms (antetul' --plafon-tranzactie-ms "$PL" --amprenta-globala "$AG" --diferente-globale "$X/$(basename "$M8" .sql).l15.tsv"
M9="$X/${NUME%_l15}_declaratfara.sql"; { printf -- '-- plafonul extins declarat: --plafon-extins (fara valoare in antet)\n'; cat "$M3"; } >"$M9"; cp "$MAN" "$X/$(basename "$M9" .sql).l15.tsv"
gen_m "$X/acord_declaratfara" 3 "$M9" 'PLAFON_EXTINS_DIFERIT: fișierul declară plafonul EXTINS' --plafon-tranzactie-ms "$PL" --amprenta-globala "$AG" --diferente-globale "$X/$(basename "$M9" .sql).l15.tsv"
gen_m "$X/acord_ok" 40 "$M5" 'GENERAT' --plafon-tranzactie-ms "$PLX" --amprenta-globala "$AG" --diferente-globale "$MAN5" --plafon-extins
echo "L15_FORMA_PLX_ACORD: cere $PL cu flag + $PLX => 3 PLAFON_DIFERIT; cere $PLX fara declaratie => 3 PLAFON_EXTINS_DIFERIT; declara flag-ul, livrata fara el => 3 (PLAFON_DIFERIT pe valoare / PLAFON_EXTINS_DIFERIT pe declaratie); controlul => 40"
# generatorul de manifest: --iesire fara pasul ferestrei si fara ora; --compara-cu cu pasul (si cu ora, cand se conecteaza)
gen_man() { # $1 dir, $2 cod asteptat, restul optiuni
  local d="$1" exp="$2" rc=0; shift 2; mkdir -p "$d"
  FALS_DIR="$d" PSQL_BIN="$TMP/psql_fals" bash "$ROOT/scripts/livrare_l15_manifest.sh" --migrare "$M5" --versiune 20990101000006 \
    --tinta-host 127.0.0.1 --tinta-port 1 --tinta-db forma_test --tinta-sistem 42 --user u "$@" >"$d/gen.log" 2>&1 || rc=$?
  [ "$rc" = "$exp" ] || { cat "$d/gen.log"; fail "$d: cod $rc (asteptat $exp)"; }
}
gen_man "$X/man_iesire" 40 --plafon-tranzactie-ms "$PLX" --plafon-extins --iesire "$X/man_iesire/$(basename "$M5" .sql).l15.tsv" --doar-genereaza "$X/man_iesire/f"
[ ! -e "$X/man_iesire/f/1a_fereastra.sql" ] && ! grep -q 'plafon_fereastra' "$X/man_iesire/f/5_mesaj.sql" || fail '--iesire (clona): pasul ferestrei NU trebuie sa apara'
gen_man "$X/man_cmp" 40 --plafon-tranzactie-ms "$PLX" --plafon-extins --compara-cu "$MAN5" --doar-genereaza "$X/man_cmp/f"
grep -qF 'DO $plafon_fereastra$' "$X/man_cmp/f/5_mesaj.sql" || fail '--compara-cu (proba pe tinta): pasul ferestrei lipseste din mesaj'
python3 - "$X/man_cmp/f/5_mesaj.sql" <<'PY' || fail '--compara-cu: pasul ferestrei nu e intre verificarea un mesaj si lock-ul consultativ'
import re, sys
t = open(sys.argv[1], encoding="utf-8").read()
a, b, c = t.find("DO $mesaj_unic$"), t.find("DO $plafon_fereastra$"), t.find("SELECT pg_advisory_xact_lock(")
sys.exit(0 if 0 < a < b < c else 1)
PY
gen_man "$X/man_iesire_fara" 2 --plafon-tranzactie-ms "$PLX" --iesire "$X/man_iesire_fara/$(basename "$M5" .sql).l15.tsv" --doar-genereaza "$X/man_iesire_fara/f"
grep -qF "cere optiunea explicita --plafon-extins" "$X/man_iesire_fara/gen.log" || { cat "$X/man_iesire_fara/gen.log"; fail 'generatorul: 15000 fara flag: mesajul'; }
if [ "$IN" = 0 ]; then
  gen_man "$X/man_cmp_ora" 2 --plafon-tranzactie-ms "$PLX" --plafon-extins --compara-cu "$MAN5"
  [ ! -e "$X/man_cmp_ora/apeluri" ] && grep -qF "PLAFON_EXTINS_FEREASTRA" "$X/man_cmp_ora/gen.log" || { cat "$X/man_cmp_ora/gen.log"; fail '--compara-cu in afara ferestrei: asteptat 2 fara psql'; }
  echo "L15_FORMA_PLX_MANIFEST: --iesire fara pasul ferestrei (clona); --compara-cu cu pasul intre verificarea un mesaj si lock; --compara-cu la ora $ORA => 2 PLAFON_EXTINS_FEREASTRA fara psql; $PLX fara flag => 2"
else
  echo "L15_FORMA_PLX_MANIFEST: --iesire fara pasul ferestrei (clona); --compara-cu cu pasul intre verificarea un mesaj si lock; $PLX fara flag => 2 (ora $ORA e in fereastra: refuzul orei al probei nu se poate arata acum)"
fi
# fara flag: nicio urma a ferestrei in nimic din ce s-a trimis pana acum (cu L15 la 5000, fara L15, fara plafon)
! cat "$P"/*_*.sql "$F"/*_*.sql "$Z"/*_*.sql "$Y"/*_*.sql | grep -q 'plafon_fereastra\|PLAFON_EXTINS\|Europe/Bucharest' || fail 'fara --plafon-extins: urme ale ferestrei in fisierele trimise'
echo 'L15_FORMA_PLX_FARA: fara --plafon-extins nicio urma a ferestrei (L15 la 5000, fara L15, fara plafon)'
echo 'PASS test_livrare_l15_forma'
