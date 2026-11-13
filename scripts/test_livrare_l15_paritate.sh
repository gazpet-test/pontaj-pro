#!/usr/bin/env bash
# L15 v2: PARITATEA caii vechi a runnerului. Fara optiunile noi (--amprenta-globala / --diferente-globale), runnerul de pe
# acest branch genereaza EXACT aceleasi fisiere ca runnerul de pe <ref> (implicit origin/main), octet cu octet.
#   bash scripts/test_livrare_l15_paritate.sh [<ref>]       (Git Bash sau Linux; cere git, tar, python3 pentru validator)
# Cum: `git archive <ref> scripts` intr-un dosar temporar; ambele runnere ruleaza cu --genereaza-in (fara conexiune, cod 40)
# pe ACEEASI migrare de proba, cu ACELEASI argumente, in formele: --sha256 fara plafon, --sha256 cu --plafon-tranzactie-ms,
# --aprobare cu plafon; apoi dosarele se compara fisier cu fisier (lista + continut, cmp).
# Aleatorul: runnerul ia tag-urile (reg_<16 hex> din inregistrare, lm_<16 hex> al mesajului) din `od -An -N8 -tx1
# /dev/urandom`, iar sha256-ul restului mesajului depinde de ele. NU se normalizeaza nimic: testul pune in PATH un `od` de
# proba care intoarce mereu aceiasi 8 octeti (0123456789abcdef) => ambele generari sunt deterministe; testul verifica si
# ca tag-urile fixe chiar apar (altfel `od`-ul de proba n-a fost folosit si comparatia n-ar dovedi nimic).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-origin/main}"
fail() { echo "ESEC: $*" >&2; exit 1; }
git -C "$ROOT" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || fail "ref inexistent: $REF"
TMP="$(mktemp -d)"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
mkdir "$TMP/ref" "$TMP/bin" "$TMP/gen"
git -C "$ROOT" archive "$REF" scripts | tar -x -C "$TMP/ref"
[ -f "$TMP/ref/scripts/livrare_migrare.sh" ] || fail "$REF nu are scripts/livrare_migrare.sh"
printf '#!/usr/bin/env bash\necho " 01 23 45 67 89 ab cd ef"\n' >"$TMP/bin/od"; chmod +x "$TMP/bin/od"

NUME=20990101a_paritate_l15
MIG="$TMP/$NUME.sql"
printf "DO \$g\$ BEGIN\n  IF current_setting('gazpet.livrare_migrare', true) IS NULL THEN RAISE EXCEPTION 'x'; END IF;\nEND \$g\$;\nCREATE TABLE public.t_paritate (id integer, nume text);\n" >"$MIG"
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
printf '%s  %s.sql\n' "$SHA" "$NUME" >"$TMP/aprobare.txt"
genereaza() { # $1 arborele (ref | nou), $2 forma, restul = argumentele formei
  local arb="$1" forma="$2" s rc=0; shift 2
  s="$ROOT/scripts/livrare_migrare.sh"; [ "$arb" = nou ] || s="$TMP/ref/scripts/livrare_migrare.sh"
  PATH="$TMP/bin:$PATH" PSQL_BIN=/nu/se/foloseste bash "$s" --migrare "$MIG" --versiune 20990101000001 --tinta-db paritate \
    --tinta-sistem 42 --tinta-host 127.0.0.1 --tinta-port 1 --user postgres "$@" --genereaza-in "$TMP/gen/${forma}_$arb" \
    >"$TMP/gen/${forma}_$arb.log" 2>&1 || rc=$?
  [ "$rc" = 40 ] || { cat "$TMP/gen/${forma}_$arb.log"; fail "$forma ($arb): cod $rc, asteptat 40"; }
}
compara() { # $1 forma
  local a="$TMP/gen/$1_ref" b="$TMP/gen/$1_nou" f
  [ "$(cd "$a" && ls | LC_ALL=C sort)" = "$(cd "$b" && ls | LC_ALL=C sort)" ] \
    || fail "$1: alte fisiere: ref [$(cd "$a" && ls | tr '\n' ' ')] nou [$(cd "$b" && ls | tr '\n' ' ')]"
  for f in "$a"/*; do cmp -s "$f" "$b/$(basename "$f")" || fail "$1: $(basename "$f") difera (diff $f $b/$(basename "$f"))"; done
  grep -q 'reg_0123456789abcdef' "$b/3_inreg.sql" || fail "$1: tag-ul fix lipseste (od-ul de proba nefolosit)"
  ! grep -rqE 'ag_cat_|ag_inainte_|AMPRENTA_GLOBALA' "$b" || fail "$1: pasii L15 apar fara optiuni"
  echo "  $1: $(cd "$b" && ls | wc -l | tr -d ' ') fisiere identice octet cu octet ($(cd "$b" && ls | tr '\n' ' '))"
}
for arb in ref nou; do
  genereaza "$arb" fara_plafon --sha256 "$SHA"
  genereaza "$arb" plafon --sha256 "$SHA" --plafon-tranzactie-ms 2000
  genereaza "$arb" aprobare --aprobare "$TMP/aprobare.txt" --plafon-tranzactie-ms 2000
done
echo "paritate $REF ($(git -C "$ROOT" rev-parse --short "$REF")) <-> arborele de lucru:"
compara fara_plafon
compara plafon
compara aprobare
grep -q 'lm_0123456789abcdef' "$TMP/gen/plafon_nou/5_mesaj.sql" || fail 'plafon: tag-ul fix al mesajului lipseste'
echo "PASS test_livrare_l15_paritate"
