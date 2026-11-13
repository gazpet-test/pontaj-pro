#!/usr/bin/env bash
# L15 v2: testul scripts/l15_compara_liste.sh pe liste-fixture (fara PostgreSQL, fara python; Git Bash sau Linux).
#   bash scripts/test_l15_compara_liste.sh
# Expected scris aici, din cerere (docs/LIVRARE_L15_V2.md, sectiunile 5 si 7) - L25. Pentru fiecare regula: cazul care o
# incalca da codul de refuz, iar MUTANTUL (scriptul fara linia marcata "# M_<regula>") da 0 pe acelasi caz.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMP="$ROOT/scripts/l15_compara_liste.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "ESEC: $*" >&2; exit 1; }
T=$'\t'
h() { printf '%032d' "$1" | tr '0-9' 'abcdef0123'; }   # amprenta de proba: 32 hex, distincta pe numar
N=0

# citire <fisier> <randuri RAND (familie TAB eticheta TAB amprenta, cate unul pe linie)> [context] [extra: LANT / INCREDERE /
# SEMNALE] [sectiunea migrarii]
citire() {
  local f="$1" r="$2" ctx="${3:-170101 postgres postgres}" extra="${4:-}" mig="${5:-}" n sv cu su
  read -r sv cu su <<<"$ctx"
  n="$(printf '%s' "$r" | grep -c . || true)"
  {
    [ -z "$mig" ] || printf '=== scriptul de amprente al migrarii (x_amprente.sql), in aceeasi tranzactie ===\n%s\n=== sfarsit scriptul de amprente al migrarii ===\n' "$mig"
    printf 'TINTA\t-\t-\t1\t-\n'
    printf 'GLOBAL\t-\t-\t%s\t%s\n' "$(h 99)" "$n"
    printf 'FAMILIE\trelatie\t-\t%s\t1\n' "$(h 98)"
    printf 'VALIDARE\t-\t-\tok\t0\n'
    [ -z "$r" ] || printf '%s\n' "$r" | awk -F'\t' '{ e = $2; for (i = 3; i < NF; i++) e = e FS $i; print "RAND" FS $1 FS e FS $NF FS "-" }'
    printf 'CONTEXT\tserver_version_num\t-\t%s\t-\nCONTEXT\tcurrent_user\t-\t%s\t-\nCONTEXT\tsession_user\t-\t%s\t-\n' "$sv" "$cu" "$su"
    [ -z "$extra" ] || printf '%s\n' "$extra"
    printf 'FOTOGRAFIE\t-\t-\taceeasi\t-\n'
  } >"$f"
}
# ruleaza <script> <cod asteptat> <eticheta> args... (iesirea in $TMP/out)
ruleaza() {
  local s="$1" exp="$2" et="$3" rc=0; shift 3
  bash "$s" "$@" >"$TMP/out" 2>&1 || rc=$?
  [ "$rc" = "$exp" ] || { cat "$TMP/out"; fail "$et: cod $rc, asteptat $exp"; }
  N=$((N + 1))
}
# mutant <regula> => calea copiei fara linia marcata (exact una)
mutant() {
  local m="$TMP/mutant_$1.sh"
  [ "$(grep -c "# M_$1\$" "$CMP")" = 1 ] || fail "marcajul M_$1 nu apare exact o data"
  grep -v "# M_$1\$" "$CMP" >"$m"
  echo "$m"
}
# regula <nume> <cod refuz> <eticheta> args... : scriptul real refuza, mutantul nu
regula() {
  local r="$1" exp="$2" et="$3"; shift 3
  ruleaza "$CMP" "$exp" "$et" "$@"
  ruleaza "$(mutant "$r")" 0 "$et (mutant fara $r: trebuia sa treaca)" "$@"
}

R0="relatie${T}relatie public.sites${T}$(h 1)
functie${T}functie public.poarta(bigint)${T}$(h 2)
acl_implicit${T}acl_implicit postgres public f${T}$(h 3)
sesiune${T}sesiune search_path${T}$(h 4)
rol${T}rol anon${T}$(h 5)
relatie${T}relatie public.\"cu${T}tab\"${T}$(h 6)"
citire "$TMP/a" "$R0"; cp "$TMP/a" "$TMP/b"

echo '1. fara optiuni'
ruleaza "$CMP" 0 'identice' --a "$TMP/a" --b "$TMP/b"
grep -q 'IDENTICE (6 randuri)' "$TMP/out" || fail 'identice: mesaj'
citire "$TMP/b_minus" "$(printf '%s\n' "$R0" | grep -v poarta)"
regula DOAR_A 7 'rand doar in A' --a "$TMP/a" --b "$TMP/b_minus"
citire "$TMP/b_plus" "$R0
functie${T}functie public.noua()${T}$(h 7)"
regula DOAR_B 7 'rand doar in B' --a "$TMP/a" --b "$TMP/b_plus"
ruleaza "$CMP" 7 'doar in B (linia)' --a "$TMP/a" --b "$TMP/b_plus"
grep -qx "DOAR_B${T}functie${T}functie public.noua()${T}$(h 7)" "$TMP/out" || fail 'DOAR_B: linia'
citire "$TMP/b_alt" "$(printf '%s\n' "$R0" | sed "s/$(h 2)/$(h 8)/")"
regula DIFERA 7 'alta amprenta' --a "$TMP/a" --b "$TMP/b_alt"
ruleaza "$CMP" 7 'alta amprenta (linia)' --a "$TMP/a" --b "$TMP/b_alt"
grep -qx "DIFERA${T}functie${T}functie public.poarta(bigint)${T}$(h 2)${T}$(h 8)" "$TMP/out" || fail 'DIFERA: linia'
grep -q '^TOTAL DIFERA=1$' "$TMP/out" || fail 'DIFERA: totalul'
citire "$TMP/b_tab" "$(printf '%s\n' "$R0" | sed "s/$(h 6)/$(h 9)/")"
ruleaza "$CMP" 7 'eticheta cu TAB' --a "$TMP/a" --b "$TMP/b_tab"
grep -qx "DIFERA${T}relatie${T}relatie public.\"cu${T}tab\"${T}$(h 6)${T}$(h 9)" "$TMP/out" || fail 'eticheta cu TAB: cheia intreaga'
echo "   ok: identice 0; doar A / doar B / alta amprenta 7 (+ mutantii); eticheta cu TAB"

echo '2. intrari invalide (cod 2, fail-closed)'
citire "$TMP/r_lista" "$R0"; awk -F'\t' '$1 != "RAND" || $3 !~ /sites/' "$TMP/r_lista" >"$TMP/r_lista2"
ruleaza "$CMP" 2 'fara --lista (RAND < GLOBAL)' --a "$TMP/a" --b "$TMP/r_lista2"
{ cat "$TMP/a"; echo 'ceva necunoscut'; } >"$TMP/r_nec"
ruleaza "$CMP" 2 'linie nerecunoscuta' --a "$TMP/a" --b "$TMP/r_nec"
sed 's/^VALIDARE\t-\t-\tok\t0$/VALIDARE\t-\t-\tdubluri=1,invalide=0\t1/' "$TMP/a" >"$TMP/r_val"
ruleaza "$CMP" 2 'VALIDARE esuata' --a "$TMP/a" --b "$TMP/r_val"
grep -v '^FOTOGRAFIE' "$TMP/a" >"$TMP/r_fot"
ruleaza "$CMP" 2 'fara FOTOGRAFIE' --a "$TMP/a" --b "$TMP/r_fot"
grep -v '^CONTEXT.session_user' "$TMP/a" >"$TMP/r_ctx"
ruleaza "$CMP" 2 'CONTEXT incomplet' --a "$TMP/a" --b "$TMP/r_ctx"
citire "$TMP/r_dub" "$R0
relatie${T}relatie public.sites${T}$(h 7)"
ruleaza "$CMP" 2 'eticheta dubla' --a "$TMP/a" --b "$TMP/r_dub"
citire "$TMP/r_mig" "$R0" '' '' 'linie'; grep -v '^=== sfarsit' "$TMP/r_mig" >"$TMP/r_mig2"
ruleaza "$CMP" 2 'sectiunea migrarii neinchisa' --a "$TMP/a" --b "$TMP/r_mig2"
printf 'x\tx\tcreat\t%s\n' "$(h 1)" >"$TMP/m_ok.tsv"
ruleaza "$CMP" 2 '--manifest si --recitire' --a "$TMP/a" --b "$TMP/b" --manifest "$TMP/m_ok.tsv" --recitire
ruleaza "$CMP" 2 'fara --b' --a "$TMP/a"
echo "   ok: fara --lista, linie necunoscuta, VALIDARE, FOTOGRAFIE, CONTEXT, eticheta dubla, migrare neinchisa, argumente => 2"

echo '3. --manifest (A = clona, B = tinta)'
MAN="$TMP/20990101a_x.l15.tsv"
printf '# antet\nfunctie\tfunctie public.poarta(bigint)\tschimbat\t%s\nrelatie\trelatie public.noua\tcreat\t%s\nrelatie\trelatie public.sites\tsters\t-\n' \
  "$(h 11)" "$(h 12)" >"$MAN"
# B difera doar pe randuri neatinse de manifest: un rol (DE_EXPLICAT) si o relatie oarecare (o partitie)
citire "$TMP/m_b" "$(printf '%s\n' "$R0" | sed "s/$(h 5)/$(h 15)/")
relatie${T}relatie public.partitie_2099_01_01${T}$(h 16)"
ruleaza "$CMP" 0 'comparabil' --a "$TMP/a" --b "$TMP/m_b" --manifest "$MAN"
grep -qF '[ok] COMPARABIL' "$TMP/out" && grep -qx "DE_EXPLICAT${T}DIFERA${T}rol${T}rol anon${T}$(h 5)${T}$(h 15)" "$TMP/out" \
  || { cat "$TMP/out"; fail 'comparabil: mesaj / DE_EXPLICAT'; }
citire "$TMP/m_ctx" "$R0" '170102 postgres postgres'
regula R_CONTEXT 6 'CONTEXT diferit (versiune minora)' --a "$TMP/a" --b "$TMP/m_ctx" --manifest "$MAN"
citire "$TMP/m_ctx2" "$R0" '170101 postgres alt_rol'
ruleaza "$CMP" 6 'CONTEXT diferit (rol)' --a "$TMP/a" --b "$TMP/m_ctx2" --manifest "$MAN"
citire "$TMP/m_acl" "$(printf '%s\n' "$R0" | sed "s/$(h 3)/$(h 13)/")"
regula R_FAM 6 'acl_implicit diferit' --a "$TMP/a" --b "$TMP/m_acl" --manifest "$MAN"
citire "$TMP/m_ses" "$(printf '%s\n' "$R0" | sed "s/$(h 4)/$(h 14)/")"
ruleaza "$CMP" 6 'sesiune diferita' --a "$TMP/a" --b "$TMP/m_ses" --manifest "$MAN"
citire "$TMP/m_sch" "$(printf '%s\n' "$R0" | sed "s/$(h 2)/$(h 17)/")"
regula R_EXIST 6 'rand schimbat cu alta amprenta pe B' --a "$TMP/a" --b "$TMP/m_sch" --manifest "$MAN"
ruleaza "$CMP" 6 'rand schimbat cu alta amprenta pe B (linia)' --a "$TMP/a" --b "$TMP/m_sch" --manifest "$MAN"
grep -q "ALTA_AMPRENTA_INAINTE${T}schimbat${T}functie${T}functie public.poarta(bigint)${T}A $(h 2)${T}B $(h 17)" "$TMP/out" || { cat "$TMP/out"; fail 'schimbat: linia'; }
citire "$TMP/m_lip" "$(printf '%s\n' "$R0" | grep -v 'public.sites')"
regula R_EXIST 6 'rand sters lipsa pe B' --a "$TMP/a" --b "$TMP/m_lip" --manifest "$MAN"
ruleaza "$CMP" 6 'rand sters lipsa pe B (linia)' --a "$TMP/a" --b "$TMP/m_lip" --manifest "$MAN"
grep -q "LIPSA_INAINTE${T}sters${T}relatie${T}relatie public.sites${T}A $(h 1)${T}B -" "$TMP/out" || { cat "$TMP/out"; fail 'sters lipsa: linia'; }
citire "$TMP/m_cre" "$R0
relatie${T}relatie public.noua${T}$(h 12)"
regula R_CREAT 6 'rand creat care exista deja pe B' --a "$TMP/a" --b "$TMP/m_cre" --manifest "$MAN"
ruleaza "$CMP" 6 'rand creat care exista deja pe A' --a "$TMP/m_cre" --b "$TMP/a" --manifest "$MAN"
echo "   ok: COMPARABIL 0 (+ DE_EXPLICAT); CONTEXT, acl_implicit / sesiune, schimbat / sters, creat => 6 (+ mutantii)"

echo '4. --recitire (aceeasi baza, doua momente)'
EXTRA="LANT${T}f${T}functie public.poarta(bigint)${T}limbaj=plpgsql DEFINER md5=$(h 20) cale=sigura${T}-${T}-
INCREDERE${T}public${T}postgres${T}super${T}-${T}-
SEMNALE${T}0${T}1${T}0${T}0${T}0"
MIGOUT=' poarta | ok
--------+----
 x      | t'
citire "$TMP/ra" "$R0" '' "$EXTRA" "$MIGOUT"
citire "$TMP/rb" "$(printf '%s\n' "$R0" | sed "s/$(h 1)/$(h 21)/")
relatie${T}relatie public.partitie_2099_01_02${T}$(h 22)" '' "$EXTRA" "$MIGOUT"
ruleaza "$CMP" 0 'doar RAND difera' --a "$TMP/ra" --b "$TMP/rb" --recitire
grep -qF '[ok] partea revizuita IDENTICA; 2 randuri RAND difera' "$TMP/out" && grep -q "^DOAR_B${T}relatie${T}relatie public.partitie_2099_01_02" "$TMP/out" \
  || { cat "$TMP/out"; fail 'recitire: mesaj / lista'; }
citire "$TMP/rm" "$R0" '' "$EXTRA" "$(printf '%s\n' "$MIGOUT" | sed 's/| t/| f/')"
regula R_MIG 6 'iesirea scriptului migrarii difera' --a "$TMP/ra" --b "$TMP/rm" --recitire
citire "$TMP/rm0" "$R0" '' "$EXTRA"
ruleaza "$CMP" 6 'scriptul migrarii lipseste in B' --a "$TMP/ra" --b "$TMP/rm0" --recitire
citire "$TMP/rl" "$R0" '' "$(printf '%s\n' "$EXTRA" | sed 's/cale=sigura/cale=acceptata/')" "$MIGOUT"
regula R_REV 6 'LANT difera' --a "$TMP/ra" --b "$TMP/rl" --recitire
citire "$TMP/rs" "$R0" '' "$(printf '%s\n' "$EXTRA" | sed "s/^SEMNALE${T}0${T}1/SEMNALE${T}1${T}1/")" "$MIGOUT"
ruleaza "$CMP" 6 'SEMNALE difera' --a "$TMP/ra" --b "$TMP/rs" --recitire
citire "$TMP/ri" "$R0" '' "$EXTRA
INCREDERE${T}public${T}creator${T}optiune${T}-${T}-" "$MIGOUT"
ruleaza "$CMP" 6 'INCREDERE difera' --a "$TMP/ra" --b "$TMP/ri" --recitire
citire "$TMP/rc" "$R0" '170102 postgres postgres' "$EXTRA" "$MIGOUT"
ruleaza "$CMP" 6 'CONTEXT difera' --a "$TMP/ra" --b "$TMP/rc" --recitire
echo "   ok: doar RAND => 0 cu lista; scriptul migrarii / LANT / SEMNALE / INCREDERE / CONTEXT => 6 (+ mutantii)"
echo "PASS test_l15_compara_liste ($N rulari)"
