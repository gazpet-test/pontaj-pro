#!/usr/bin/env bash
# Runda 19 a runnerului (verdictul Jakarinos pe PR #1169, r2; docs/LIVRARE_L15_V2.md §9 „Plafonul extins”): garda UNICA a plafonului extins
# (ag_plafon_garda din scripts/livrare_amprenta.sh) pe TOATE caile, FARA PostgreSQL (psql fals care inregistreaza apelurile) si FARA sa
# depinda de ora reala (ceas fals: un `date` pus primul in PATH care inlocuieste DOAR momentul curent, `date -u +%s`; restul merge la `date`-ul
# real; pe server ramane oricum verificarea 1a_fereastra.sql, pe ceasul serverului).
#   bash scripts/test_livrare_plafon_garda.sh          (Git Bash sau Linux; cere `date` GNU si python3)
# Expected scris aici, din cerere (L25): cu --plafon-extins, pe ORICE cale care se conecteaza si pe ORICE tinta (doi identificatori de sistem
# diferiti - garda nu-l citeste, deci nici o tinta „de productie” nu e tratata altfel), la 12:00 Europe/Bucharest = refuz 2
# PLAFON_EXTINS_FEREASTRA, INAINTE de conexiune (niciun apel psql, nimic scris), iar la 23:00 calea ajunge la psql cu pasul DO $plafon_fereastra$
# intre verificarea „un mesaj” si lock-ul consultativ:
#   runnerul: livrarea (cu --sha256 si cu --aprobare) => 2 ziua / 0 noaptea; --genereaza-in (fara conexiune) => 40 si ziua;
#   generatorul de manifest: --iesire, --iesire --detalii, --compara-cu, --compara-cu --amprenta-globala => 2 ziua / psql apelat noaptea;
#     --doar-genereaza (fara conexiune) cu --iesire si cu --compara-cu => 40 si ziua, ambele cu pasul ferestrei in mesaj; niciun mod sau
#     ambele moduri => 2 (argumente), niciun apel psql.
# MUTANTI pe o copie a scripturilor (fiecare inlocuire EXACT o data, altfel proba e nefunctionala), fiecare trebuie PRINS: garda fara ora;
#   generatorul scuteste iar --iesire (runda 18); generatorul fara pasul ferestrei la --iesire (runda 18); generatorul cheama garda ca
#   neconectat; runnerul cheama garda ca neconectat; runnerul inapoi pe ag_plafon_ok (fara fereastra).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
fail() { echo "ESEC: $*" >&2; exit 1; }
PLX="$(bash -c '. "$1"; printf %s "$AG_PLAFON_EXTINS_MS"' _ "$ROOT/scripts/livrare_amprenta.sh")"
[ "$PLX" = 15000 ] || fail "AG_PLAFON_EXTINS_MS = '$PLX', asteptat 15000 (decizia proprietarului 22.11.2026)"

# psql fals (ca in scripts/test_livrare_l15_forma.sh): copiaza fisierele primite, raspunde la reconciliere
cat >"$TMP/psql_fals" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
n=$(( $(cat "$FALS_DIR/n" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$FALS_DIR/n"
a=""; for x in "$@"; do a="$a ${x##*/}"; case "$x" in *.sql) cp -- "$x" "$FALS_DIR/${n}_${x##*/}" ;; esac; done
echo "$n:$a" >>"$FALS_DIR/apeluri"
case "$a" in
  *reconc.sql*) if [ -e "$FALS_DIR/livrat" ]; then echo "garda_test|$FALS_SIS||false|1|1"; else echo "garda_test|$FALS_SIS||false|0|0"; fi ;;
  *control_0e.sql*) : ;;
  *) touch "$FALS_DIR/livrat" ;;
esac
EOF
chmod +x "$TMP/psql_fals"
# ceasul fals: DOAR `date -u +%s` (momentul curent, singurul folosit de ag_ora_bucuresti fara argument) intoarce FALS_ACUM
FALS_DATE_REAL="$(command -v date)"; export FALS_DATE_REAL
mkdir "$TMP/ceas"
cat >"$TMP/ceas/date" <<'EOF'
#!/usr/bin/env bash
if [ "$#" = 2 ] && [ "$1" = -u ] && [ "$2" = +%s ]; then printf '%s\n' "$FALS_ACUM"; exit 0; fi
exec "$FALS_DATE_REAL" "$@"
EOF
chmod +x "$TMP/ceas/date"
ZI="$(date -u -d '2026-11-23 10:00:00' +%s)"       # 12:00:00 Europe/Bucharest (iarna, UTC+2) - in afara ferestrei
NOAPTE="$(date -u -d '2026-11-23 21:00:00' +%s)"   # 23:00:00 Europe/Bucharest - in fereastra
for p in "$ZI:12:00:00" "$NOAPTE:23:00:00"; do
  h="$(PATH="$TMP/ceas:$PATH" FALS_ACUM="${p%%:*}" bash -c '. "$1"; ag_ora_bucuresti' _ "$ROOT/scripts/livrare_amprenta.sh")"
  [ "$h" = "${p#*:}" ] || fail "ceasul fals: @${p%%:*} da $h, asteptat ${p#*:} (proba nefunctionala)"
done

# migrarea care cere plafonul extins si il declara in antet (forma validata, ca in test_livrare_l15_forma.sh) + manifestul ei
NUME=20990101a_garda_plx
MIG="$TMP/$NUME.sql"
{ printf -- "-- Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms %s --plafon-extins --amprenta-globala <md5> --diferente-globale ...\n" "$PLX"
  printf "DO \$g\$ DECLARE v_plafon text; BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\n  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';\n  IF v_plafon IS DISTINCT FROM '%s/session'\n     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '%s:' || txid_current() THEN\n    RAISE EXCEPTION 'p %%', coalesce(v_plafon, 'lipsa'); END IF;\nEND \$g\$;\n" "$PLX" "$PLX"
} >"$MIG"
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
AG=0123456789abcdef0123456789abcdef
MAN="$TMP/$NUME.l15.tsv"
printf '# manifest de proba\nrelatie\trelatie public.t_garda_plx\tcreat\t%s\n' "$(printf a%.0s {1..32})" >"$MAN"
printf '%s  %s.sql\n%s  %s.l15.tsv\n' "$SHA" "$NUME" "$(sha256sum "$MAN" | cut -d' ' -f1)" "$NUME" >"$TMP/aprobare"

# verifica <radacina> <identificatori...> — toate scenariile pe scripturile din <radacina>/scripts; iese cu 1 la prima abatere (mesaj pe stderr)
verifica() (
  R="$1"; shift
  n=0; V="$(mktemp -d "$TMP/v.XXXXXX")"   # dosar propriu fiecarei rulari (subshell-urile au acelasi $$)
  ruleaza() { # $1 ceas, $2 cod asteptat, $3 runner|gen, $4 identificatorul tintei, restul optiuni („@D@” = dosarul scenariului, apoi in $D)
    local acum="$1" exp="$2" cine="$3" sis="$4" rc=0 x o=(); shift 4
    n=$((n + 1)); D="$V/$n"; mkdir "$D" || return 1
    for x in "$@"; do o+=("${x//@D@/$D}"); done; set -- "${o[@]}"
    if [ "$cine" = runner ]; then
      PATH="$TMP/ceas:$PATH" FALS_ACUM="$acum" FALS_DIR="$D" FALS_SIS="$sis" PSQL_BIN="$TMP/psql_fals" bash "$R/scripts/livrare_migrare.sh" --migrare "$MIG" \
        --versiune 20990101000007 --tinta-db garda_test --tinta-sistem "$sis" --tinta-host 127.0.0.1 --tinta-port 1 \
        --plafon-tranzactie-ms "$PLX" --plafon-extins "$@" >"$D/log" 2>&1 || rc=$?
    else
      PATH="$TMP/ceas:$PATH" FALS_ACUM="$acum" FALS_DIR="$D" FALS_SIS="$sis" PSQL_BIN="$TMP/psql_fals" bash "$R/scripts/livrare_l15_manifest.sh" --migrare "$MIG" \
        --versiune 20990101000007 --tinta-host 127.0.0.1 --tinta-port 1 --tinta-db garda_test --tinta-sistem "$sis" --user u \
        --plafon-tranzactie-ms "$PLX" --plafon-extins "$@" >"$D/log" 2>&1 || rc=$?
    fi
    [ "$rc" = "$exp" ] || { tail -n 5 "$D/log" >&2; echo "$cine $* (tinta $sis): cod $rc, asteptat $exp" >&2; return 1; }
  }
  # refuzul orei: cod 2, mesajul, NICIUN apel psql, nimic scris in afara dosarului scenariului
  refuz_ora() { ruleaza "$ZI" 2 "$@" || return 1
    [ ! -e "$D/apeluri" ] || { echo "$1 ${*:3} (tinta $2): psql apelat in afara ferestrei" >&2; return 1; }
    grep -qF 'PLAFON_EXTINS_FEREASTRA: ora Europe/Bucharest e 12:00:00' "$D/log" || { tail -n 5 "$D/log" >&2; echo "$1 ${*:3}: lipseste PLAFON_EXTINS_FEREASTRA" >&2; return 1; }
  }
  # pasul ferestrei intre verificarea „un mesaj” si lock-ul consultativ, exact o data
  cu_pas() { python3 - "$1" <<'PY' || { echo "$1: pasul ferestrei lipseste / nu e intre verificarea un mesaj si lock" >&2; return 1; }
import sys
t = open(sys.argv[1], encoding="utf-8").read()
a, b, c = t.find("DO $mesaj_unic$"), t.find("DO $plafon_fereastra$"), t.find("SELECT pg_advisory_xact_lock(")
sys.exit(0 if 0 < a < b < c and t.count("DO $plafon_fereastra$") == 1 else 1)
PY
  }
  for sis in "$@"; do
    # --- runnerul: livrarea (sha256 / aprobare) ---
    refuz_ora runner "$sis" --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$MAN" || exit 1
    refuz_ora runner "$sis" --aprobare "$TMP/aprobare" --amprenta-globala "$AG" --diferente-globale "$MAN" || exit 1
    ruleaza "$NOAPTE" 0 runner "$sis" --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$MAN" || exit 1
    m="$(grep -v 'reconc.sql\|control_0e.sql' "$D/apeluri" | cut -d: -f1)"
    [ -n "$m" ] && cu_pas "$D/${m}_5_mesaj.sql" || { echo "runner noaptea (tinta $sis): mesajul fara pasul ferestrei" >&2; exit 1; }
    grep -qF 'in fereastra 21:00:00-06:00:00' "$D/log" || { echo "runner noaptea: fereastra neanuntata" >&2; exit 1; }
    # --- runnerul: --genereaza-in (fara conexiune) => 40 si ziua ---
    ruleaza "$ZI" 40 runner "$sis" --sha256 "$SHA" --amprenta-globala "$AG" --diferente-globale "$MAN" --genereaza-in "@D@/f" || exit 1
    [ ! -e "$D/apeluri" ] && cu_pas "$D/f/5_mesaj.sql" || { echo "runner --genereaza-in: psql apelat sau mesaj fara pas" >&2; exit 1; }
    # --- generatorul: fiecare mod conectat, ziua => 2 inainte de conexiune ---
    refuz_ora gen "$sis" --iesire "@D@/$NUME.l15.tsv" || exit 1
    [ ! -e "$D/$NUME.l15.tsv" ] || { echo "gen --iesire ziua: manifest scris" >&2; exit 1; }
    refuz_ora gen "$sis" --iesire "@D@/$NUME.l15.tsv" --detalii "@D@/d.l15.detalii.txt" || exit 1
    [ ! -e "$D/$NUME.l15.tsv" ] && [ ! -e "$D/d.l15.detalii.txt" ] || { echo "gen --iesire --detalii ziua: fisiere scrise" >&2; exit 1; }
    refuz_ora gen "$sis" --compara-cu "$MAN" || exit 1
    refuz_ora gen "$sis" --compara-cu "$MAN" --amprenta-globala "$AG" || exit 1
    # --- generatorul: noaptea ajunge la psql (psql-ul fals nu tipareste diferenta => 1 „INCOMPLETA”), cu pasul ferestrei ---
    for mod in iesire compara-cu; do
      if [ "$mod" = iesire ]; then a=(--iesire "@D@/$NUME.l15.tsv"); else a=(--compara-cu "$MAN"); fi
      ruleaza "$NOAPTE" 1 gen "$sis" "${a[@]}" || exit 1
      [[ "$(cat "$D/apeluri")" == "1: "*" -f 00_sesiune.sql -f 5_mesaj.sql -f 9_reset.sql -h 127.0.0.1 -p 1 "* ]] \
        || { cat "$D/apeluri" >&2; echo "gen --$mod noaptea: apelul psql (asteptat UN apel, mesajul unic)" >&2; exit 1; }
      cu_pas "$D/1_5_mesaj.sql" || exit 1
      grep -qF 'diferenta INCOMPLETA' "$D/log" || { tail -n 5 "$D/log" >&2; echo "gen --$mod noaptea: nu a ajuns la citirea diferentei" >&2; exit 1; }
      # --doar-genereaza (fara conexiune): 40 si ziua, mesajul cu pasul ferestrei in AMBELE moduri
      if [ "$mod" = iesire ]; then a=(--iesire "@D@/$NUME.l15.tsv"); fi
      ruleaza "$ZI" 40 gen "$sis" "${a[@]}" --doar-genereaza "@D@/f" || exit 1
      [ ! -e "$D/apeluri" ] && cu_pas "$D/f/5_mesaj.sql" || { echo "gen --$mod --doar-genereaza: psql apelat sau mesaj fara pas" >&2; exit 1; }
    done
    # --- generatorul: niciun mod / ambele moduri => 2 (argumente), niciun apel psql ---
    ruleaza "$NOAPTE" 2 gen "$sis" || exit 1; [ ! -e "$D/apeluri" ] || exit 1
    ruleaza "$NOAPTE" 2 gen "$sis" --iesire "@D@/$NUME.l15.tsv" --compara-cu "$MAN" || exit 1; [ ! -e "$D/apeluri" ] || exit 1
  done
  echo "ok ($n scenarii)"
)

# identificatori de tinta diferiti: garda nu-l citeste (o tinta „de productie” nu e tratata altfel decat o clona)
r="$(verifica "$ROOT" 42 7000000000000000001)" || fail 'scripturile reale nu trec scenariile'
echo "PLX_GARDA: runner (livrare cu sha256 / aprobare, --genereaza-in) + generator (--iesire, --iesire --detalii, --compara-cu, --compara-cu --amprenta-globala, --doar-genereaza in ambele moduri, niciun mod / ambele) pe 2 tinte: ziua => 2 PLAFON_EXTINS_FEREASTRA fara psql, noaptea => psql cu pasul ferestrei; fara conexiune => 40 cu pasul; $r"

# mutantii: copia scripturilor folosite de cele doua cai, o inlocuire EXACT o data (separatorul campurilor e „~”)
FIS="livrare_migrare.sh livrare_l15_manifest.sh livrare_amprenta.sh livrare_mesaj.sh livrare_validator.py control_0e.sql amprenta_globala_v2.sql"
k=0
while IFS='~' read -r et fis din in_; do
  k=$((k + 1)); MR="$TMP/m$k"; mkdir -p "$MR/scripts"
  for f in $FIS; do cp -- "$ROOT/scripts/$f" "$MR/scripts/"; done
  [ "$(grep -cF -- "$din" "$ROOT/scripts/$fis")" = 1 ] || fail "mutantul $k ($et): textul '$din' nu apare exact o data in $fis (proba nefunctionala)"
  python3 - "$ROOT/scripts/$fis" "$MR/scripts/$fis" "$din" "$in_" <<'PY'
import sys
src, out, din, in_ = sys.argv[1:5]
t = open(src, encoding="utf-8").read()
assert t.count(din) == 1
open(out, "w", encoding="utf-8", newline="\n").write(t.replace(din, in_))
PY
  cmp -s "$ROOT/scripts/$fis" "$MR/scripts/$fis" && fail "mutantul $k ($et) nu s-a aplicat"
  if verifica "$MR" 42 >"$TMP/m$k.log" 2>&1; then cat "$TMP/m$k.log"; fail "mutantul $k ($et) NU e prins"; fi
  echo "  mutant $k prins: $et -> $(tail -n 1 "$TMP/m$k.log")"
done <<'EOF'
garda fara ora (biblioteca)~livrare_amprenta.sh~[ "$2" = 1 ] && [ "$3" = 1 ] || return 0   # M_GARDA_CONECTAT~return 0   # M_GARDA_CONECTAT
generatorul scuteste iar --iesire (runda 18)~livrare_l15_manifest.sh~CONECTAT=1; [ -z "$GEN" ] || CONECTAT=0~CONECTAT=1; [ -n "$CMP" ] && [ -z "$GEN" ] || CONECTAT=0
generatorul fara pasul ferestrei la --iesire (runda 18)~livrare_l15_manifest.sh~{ [ "$EXTINS" = 0 ] || cat "$W/g/1a_fereastra.sql"; cat~{ if [ "$EXTINS" = 1 ] && [ -n "$CMP" ]; then cat "$W/g/1a_fereastra.sql"; fi; cat
generatorul cheama garda ca neconectat~livrare_l15_manifest.sh~ag_plafon_garda "$PLAFON_MS" "$EXTINS" "$CONECTAT"~ag_plafon_garda "$PLAFON_MS" "$EXTINS" 0
runnerul cheama garda ca neconectat~livrare_migrare.sh~CONECTAT=1; [ -z "$GENEREAZA" ] || CONECTAT=0~CONECTAT=0
runnerul inapoi pe ag_plafon_ok (fara fereastra)~livrare_migrare.sh~ag_plafon_garda "$PLAFON_MS" "$EXTINS" "$CONECTAT"~ag_plafon_ok "$PLAFON_MS" $([ "$EXTINS" = 0 ] || echo extins)
EOF
echo "PLX_GARDA_MUTANTI: $k mutanti pe runner / generator / biblioteca, toti prinsi"
echo 'PASS test_livrare_plafon_garda'
