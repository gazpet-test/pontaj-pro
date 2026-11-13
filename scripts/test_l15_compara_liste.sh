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
# SEMNALE] [sectiunea migrarii] [momentul fotografiei: randul MOMENT, tiparit cand exista sectiunea migrarii]
citire() {
  local f="$1" r="$2" ctx="${3:-170101 postgres postgres}" extra="${4:-}" mig="${5:-}" mom="${6:-2026-11-13 08:00:00.5+00}" n sv cu su
  read -r sv cu su <<<"$ctx"
  n="$(printf '%s' "$r" | grep -c . || true)"
  {
    printf 'TINTA\t-\t-\t1\t-\n'
    [ -z "$mig" ] || printf 'MOMENT\t-\t-\t%s\t-\n' "$mom"
    [ -z "$mig" ] || printf '=== scriptul de amprente al migrarii (x_amprente.sql), in aceeasi tranzactie ===\n%s\n=== sfarsit scriptul de amprente al migrarii ===\n' "$mig"
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
# privilegiile implicite ale ALTUI creator decat rolul de livrare (un rol al platformei, alta schema): nu hotarasc drepturile
# obiectelor create de livrare => COMPARABIL, linia apare ca DE_EXPLICAT (caz real: clona fara schemele platformei)
citire "$TMP/m_acl_alt" "$R0
acl_implicit${T}acl_implicit alt_creator alta_schema f${T}$(h 18)"
ruleaza "$CMP" 0 'acl_implicit al altui creator' --a "$TMP/a" --b "$TMP/m_acl_alt" --manifest "$MAN"
grep -qF '[ok] COMPARABIL' "$TMP/out" && grep -qx "DE_EXPLICAT${T}DOAR_B${T}acl_implicit${T}acl_implicit alt_creator alta_schema f${T}$(h 18)" "$TMP/out" \
  || { cat "$TMP/out"; fail 'acl_implicit al altui creator: COMPARABIL + DE_EXPLICAT'; }
# rolul de livrare in ALTA schema ramane refuz (tot el creeaza obiectele)
citire "$TMP/m_acl_sch" "$R0
acl_implicit${T}acl_implicit postgres alta_schema f${T}$(h 19)"
ruleaza "$CMP" 6 'acl_implicit al rolului de livrare, alta schema' --a "$TMP/a" --b "$TMP/m_acl_sch" --manifest "$MAN"
# un creator al carui nume doar INCEPE cu numele rolului de livrare nu e rolul de livrare
citire "$TMP/m_acl_pre" "$R0
acl_implicit${T}acl_implicit postgres_alt public f${T}$(h 20)"
ruleaza "$CMP" 0 'creator cu nume care incepe cu rolul de livrare' --a "$TMP/a" --b "$TMP/m_acl_pre" --manifest "$MAN"
# rol de livrare cu nume ne-simplu => regula stricta (fail-closed): orice acl_implicit diferit = NECOMPARABIL
citire "$TMP/a_q" "$R0" '170101 Rol-Mare Rol-Mare'
citire "$TMP/m_acl_q" "$R0
acl_implicit${T}acl_implicit alt_creator alta_schema f${T}$(h 18)" '170101 Rol-Mare Rol-Mare'
ruleaza "$CMP" 6 'rol de livrare cu nume ne-simplu: regula stricta' --a "$TMP/a_q" --b "$TMP/m_acl_q" --manifest "$MAN"
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

echo '5. MOMENT: momentul fotografiei e in afara partii revizuite (r3, P2)'
# sectiunea migrarii asa cum o lasa citirea: momentul inlocuit cu marcajul fix
MIGM=' baza | la
 postgres | <momentul fotografiei>
(1 row)'
citire "$TMP/ma" "$R0" '' "$EXTRA" "$MIGM" '2026-11-13 20:12:16.123456+00'
citire "$TMP/mb" "$R0" '' "$EXTRA" "$MIGM" '2026-11-14 07:00:01.5+00'
ruleaza "$CMP" 0 'doua fotografii care difera doar prin MOMENT' --a "$TMP/ma" --b "$TMP/mb" --recitire
grep -qF '[ok] partea revizuita IDENTICA; 0 randuri RAND difera' "$TMP/out" || { cat "$TMP/out"; fail 'MOMENT: mesajul'; }
# MUTANT: comparatorul care pune MOMENT in partea revizuita => refuzul fals din runda 2 (6)
MM="$TMP/mutant_MOMENT_rev.sh"
sed 's/{ nm++; mom = \$4;/{ print > (p ".rev"); nm++; mom = $4;/' "$CMP" >"$MM"
! cmp -s "$MM" "$CMP" || fail 'mutantul MOMENT nu a schimbat comparatorul'
ruleaza "$MM" 6 'mutant: MOMENT in partea revizuita' --a "$TMP/ma" --b "$TMP/mb" --recitire
citire "$TMP/mc" "$R0" '' "$EXTRA" "$(printf '%s\n' "$MIGM" | sed 's/postgres |/alta_baza |/')" '2026-11-14 07:00:01.5+00'
ruleaza "$CMP" 6 'MOMENT diferit SI sectiunea migrarii diferita' --a "$TMP/ma" --b "$TMP/mc" --recitire
grep -v '^MOMENT' "$TMP/ma" >"$TMP/m_fara"
ruleaza "$CMP" 2 'sectiunea migrarii fara MOMENT' --a "$TMP/m_fara" --b "$TMP/mb" --recitire
{ grep '^MOMENT' "$TMP/ma"; cat "$TMP/ma"; } >"$TMP/m_dublu"
ruleaza "$CMP" 2 'doua randuri MOMENT' --a "$TMP/m_dublu" --b "$TMP/mb" --recitire
citire "$TMP/m_brut" "$R0" '' "$EXTRA" "$(printf '%s\n' "$MIGM" | sed 's/<momentul fotografiei>/2026-11-13 20:12:16.123456+00/')" '2026-11-13 20:12:16.123456+00'
ruleaza "$CMP" 2 'momentul neinlocuit in sectiunea migrarii' --a "$TMP/m_brut" --b "$TMP/mb" --recitire
echo "   ok: doar MOMENT difera => 0 (mutantul cu MOMENT revizuit => 6); si sectiunea difera => 6; MOMENT lipsa / dublu / neinlocuit => 2"

echo '6. citirea cu psql simulat: momentul inlocuit EXACT in sectiunea scriptului migrarii'
FP="$TMP/psql_simulat"
cat >"$FP" <<'EOF'
#!/usr/bin/env bash
# psql simulat: iesirea unei citiri --lista --amprente-migrare (formatul nealiniat al sectiunii), momentul din SIM_MOMENT
grep -qF "\\pset fieldsep ' | '" citire.sql || { echo 'citire.sql fara formatul nealiniat al sectiunii migrarii' >&2; exit 3; }
grep -qF "SELECT 'MOMENT', '-', '-', pg_catalog.now()::pg_catalog.text, '-'" citire.sql || { echo 'citire.sql fara MOMENT' >&2; exit 3; }
m="$SIM_MOMENT"; h=0123456789abcdef0123456789abcdef
printf 'TINTA\t-\t-\t1\t-\n'
printf 'MOMENT\t-\t-\t%s\t-\n' "$m"
printf '%s\n' '=== scriptul de amprente al migrarii (meteo_xweather_amprente.sql), in aceeasi tranzactie ===' \
  'baza | sistem | versiune | la' "postgres | 1 | PostgreSQL 17 | $m" '(1 row)' '' "${SIM_MIG:-eticheta | amprenta}" \
  '=== sfarsit scriptul de amprente al migrarii ==='
printf 'GLOBAL\t-\t-\t%s\t1\nFAMILIE\trelatie\t-\t%s\t1\nVALIDARE\t-\t-\tok\t0\n' "$h" "$h"
printf 'RAND\trelatie\trelatie public.sites\t%s\t-\n' "$h"
printf 'CONTEXT\tserver_version_num\t-\t170101\t-\nCONTEXT\tcurrent_user\t-\tpostgres\t-\nCONTEXT\tsession_user\t-\tpostgres\t-\n'
printf 'FOTOGRAFIE\t-\t-\taceeasi\t-\n'
EOF
chmod +x "$FP"
# o copie a citirii fara inlocuire (MUTANT), in aceeasi asezare de fisiere (scripts/ + biblioteca + blocul)
mkdir -p "$TMP/mutcit/scripts"
cp "$ROOT/scripts/livrare_amprenta.sh" "$ROOT/scripts/amprenta_globala_v2.sql" "$TMP/mutcit/scripts/"
[ "$(grep -c '# M_CIT_MOMENT$' "$ROOT/scripts/amprenta_globala_citire.sh")" = 1 ] || fail 'marcajul M_CIT_MOMENT nu apare exact o data'
grep -v '# M_CIT_MOMENT$' "$ROOT/scripts/amprenta_globala_citire.sh" >"$TMP/mutcit/scripts/amprenta_globala_citire.sh"
cit() { # <script> <iesire> <moment> [sectiune] => codul citirii
  local rc=0
  PSQL_BIN="$FP" SIM_MOMENT="$3" SIM_MIG="${4:-}" bash "$1" --tinta-host h --tinta-port 5432 --tinta-db postgres --tinta-sistem 1 \
    --user postgres --lista --amprente-migrare "$ROOT/scripts/meteo_xweather_amprente.sql" >"$2" 2>"$2.err" || rc=$?
  [ "$rc" = 0 ] || { cat "$2" "$2.err"; fail "citirea simulata: cod $rc"; }
}
C1='2026-11-13 20:12:16.123456+00'; C2='2026-11-13 20:12:17.12+00'
cit "$ROOT/scripts/amprenta_globala_citire.sh" "$TMP/c1" "$C1"
cit "$ROOT/scripts/amprenta_globala_citire.sh" "$TMP/c2" "$C2"
grep -qx "postgres | 1 | PostgreSQL 17 | <momentul fotografiei>" "$TMP/c1" && grep -qx "MOMENT${T}-${T}-${T}${C1}${T}-" "$TMP/c1" \
  && [ "$(grep -cF "$C1" "$TMP/c1")" = 1 ] || { cat "$TMP/c1"; fail 'citirea: momentul nu e inlocuit exact o data in sectiune / MOMENT lipsa'; }
grep -q 'inlocuit in sectiunea scriptului migrarii de 1 ori' "$TMP/c1.err" || { cat "$TMP/c1.err"; fail 'citirea: numarul inlocuirilor'; }
ruleaza "$CMP" 0 'doua citiri fara DDL (momente de lungimi diferite)' --a "$TMP/c1" --b "$TMP/c2" --recitire
cit "$ROOT/scripts/amprenta_globala_citire.sh" "$TMP/c3" "$C2" 'eticheta | alta_amprenta'
ruleaza "$CMP" 6 'a doua citire cu alta iesire a scriptului migrarii' --a "$TMP/c1" --b "$TMP/c3" --recitire
cit "$TMP/mutcit/scripts/amprenta_globala_citire.sh" "$TMP/m1" "$C1"
cit "$TMP/mutcit/scripts/amprenta_globala_citire.sh" "$TMP/m2" "$C2"
ruleaza "$CMP" 2 'mutant: citirea fara inlocuire => intrare refuzata' --a "$TMP/m1" --b "$TMP/m2" --recitire
grep -q 'momentul fotografiei apare neinlocuit' "$TMP/out" || { cat "$TMP/out"; fail 'mutantul citirii: motivul'; }
echo "   ok: citire reala x2 => 0; alta iesire a scriptului => 6; MUTANT fara inlocuire => 2 (refuz)"
echo "PASS test_l15_compara_liste ($N rulari)"
