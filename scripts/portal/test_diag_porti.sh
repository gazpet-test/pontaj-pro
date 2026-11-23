#!/usr/bin/env bash
# Portal E1 r19: dry_prod_e1.sh --diagnostic-porti, capat-la-capat FARA nicio conexiune (--doar-genereaza, cod 40; psql
# inexistent: orice apel ar pica). Ruleaza din Git Bash sau Linux / WSL:  bash scripts/portal/test_diag_porti.sh
#   1. diagnostic: mesajul generat e acceptat de verificatorul diagnosticului si REFUZAT de cel al livrarii; copia taiata
#      nu mai are postconditia; mesajul nu are COMMIT de nivel superior si nici inregistrare;
#   2. modul normal (--doar-18a) neschimbat: mesajul e acceptat de verificatorul livrarii si refuzat de cel al diagnosticului;
#   3. un taietor stricat (taie si pasul 4 / nu taie nimic) sau un bloc de diagnostic cu scriere, puse intr-o copie a
#      scripturilor => dry_prod refuza cu 3 INAINTE de conexiune (verificarea locala il prinde);
#   4. --doar-genereaza intr-un dosar existent => refuz 2.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
fail() { echo "ESEC: $*" >&2; exit 1; }
M18="$ROOT/supabase/migrations/20261118a_portal_teren_identitate.sql"
SHA18="$(sha256sum "$M18" | cut -d' ' -f1)"
TINTA=(--tinta-host 127.0.0.1 --tinta-port 1 --tinta-db forma_test --tinta-sistem 42 --user postgres)
dry() { # $1 radacina, $2 dosarul de iesire, restul = optiuni; tipareste codul
  local rc=0
  PSQL_BIN="$TMP/psql_inexistent" bash "$1/scripts/portal/dry_prod_e1.sh" "${TINTA[@]}" --doar-genereaza "$2" "${@:3}" \
    >"$2.log" 2>&1 || rc=$?
  echo "$rc"
}

# 1. diagnostic
rc="$(dry "$ROOT" "$TMP/diag" --diagnostic-porti)"
[[ "$rc" == 40 ]] || { cat "$TMP/diag.log"; fail "diagnostic: cod $rc, asteptat 40"; }
for f in 00_sesiune.sql 5_mesaj.sql 9_reset.sql m_mesaj.sql diag_18a.sql; do [[ -f "$TMP/diag/$f" ]] || fail "diagnostic: lipseste $f"; done
python3 "$ROOT/scripts/portal/test_diag_porti_mesaj.py" "$TMP/diag/5_mesaj.sql" "$M18" "$SHA18" 2000 "$ROOT/scripts/portal/diag_porti.sql" \
  >"$TMP/diag_verif.log" || fail 'diagnostic: verificatorul diagnosticului a refuzat mesajul generat'
! python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$TMP/diag/5_mesaj.sql" "$M18" "$SHA18" 2000 ROLLBACK >/dev/null 2>&1 \
  || fail 'diagnostic: verificatorul livrarii a acceptat mesajul de diagnostic'
! grep -q PORTAL_POSTCONDITION_FAILED "$TMP/diag/diag_18a.sql" || fail 'diagnostic: copia taiata are postconditia'
grep -q 'AS diagnostic_porti_nu_e_livrare \\gexec$' "$TMP/diag/5_mesaj.sql" || fail 'diagnostic: aliasul'
grep -q 'verificatorul livrarii REFUZA mesajul' "$TMP/diag.log" || fail 'diagnostic: lipseste confirmarea refuzului livrarii'
[[ "$(cat "$TMP/diag/00_sesiune.sql")" == 'SET transaction_timeout = 2000;' ]] || fail 'diagnostic: plafonul de sesiune'
[[ ! -e "$TMP/psql_inexistent" ]] || fail 'diagnostic: psql a fost creat / apelat'
echo "DIAG_GENEREAZA: --diagnostic-porti --doar-genereaza => cod 40, fara conexiune; $(cat "$TMP/diag_verif.log")"

# 2. modul normal, neschimbat
rc="$(dry "$ROOT" "$TMP/norm" --doar-18a)"
[[ "$rc" == 40 ]] || { cat "$TMP/norm.log"; fail "normal: cod $rc, asteptat 40"; }
python3 "$ROOT/scripts/test_livrare_mesaj_unic.py" "$TMP/norm/5_mesaj.sql" "$M18" "$SHA18" 2000 ROLLBACK >/dev/null \
  || fail 'normal: verificatorul livrarii a refuzat proba normala'
! python3 "$ROOT/scripts/portal/test_diag_porti_mesaj.py" "$TMP/norm/5_mesaj.sql" "$M18" "$SHA18" 2000 "$ROOT/scripts/portal/diag_porti.sql" >/dev/null 2>&1 \
  || fail 'normal: verificatorul diagnosticului a acceptat proba normala'
echo 'DIAG_NORMAL: proba normala --doar-18a => acceptata de verificatorul livrarii, refuzata de cel al diagnosticului'

# 3. piese stricate intr-o copie a scripturilor => refuz 3 inainte de conexiune
mutant() { # $1 eticheta, $2 fisierul inlocuit (relativ la scripts/portal), $3 continutul
  local R="$TMP/rad_$1" rc
  mkdir -p "$R/supabase/migrations"; cp -r "$ROOT/scripts" "$R/"
  cp -- "$M18" "$ROOT/supabase/migrations/20261119a_portal_teren_provisioning.sql" "$R/supabase/migrations/"
  printf '%s' "$3" >"$R/scripts/portal/$2"
  rc="$(dry "$R" "$TMP/mut_$1" --diagnostic-porti)"
  [[ "$rc" == 3 ]] && grep -q 'verificarea locala a mesajului de diagnostic' "$TMP/mut_$1.log" \
    || { cat "$TMP/mut_$1.log"; fail "mutant $1: cod $rc, asteptat 3 (verificarea locala)"; }
  [[ ! -e "$TMP/mut_$1" ]] || fail "mutant $1: a generat totusi"
}
mutant taie_pasul_4 diag_porti_taie.py 'import sys
b = open(sys.argv[1], "rb").read()
open(sys.argv[2], "xb").write(b[:b.index(b"  -- 4. clasificarea")] + b[b.index(b"END $critic$;"):])
'
mutant nu_taie diag_porti_taie.py 'import sys
open(sys.argv[2], "xb").write(open(sys.argv[1], "rb").read())
'
mutant bloc_scrie diag_porti.sql "$(sed 's/  v_lista := public.fn_portal_porti_lipsa();/  v_lista := public.fn_portal_porti_lipsa(); DELETE FROM public.conturi_tip;/' "$ROOT/scripts/portal/diag_porti.sql")
"
# bloc_scrie: dovada ca mutantul chiar e altul (altfel cazul ar fi trecut din alt motiv)
grep -q 'DELETE FROM public.conturi_tip' "$TMP/rad_bloc_scrie/scripts/portal/diag_porti.sql" || fail 'mutant bloc_scrie nefunctional'
echo 'DIAG_MUTANTI: taietor care taie si pasul 4 / care nu taie / bloc cu DELETE => refuz 3 inainte de conexiune'

# 4. dosar existent
rc="$(dry "$ROOT" "$TMP/diag" --diagnostic-porti)"
[[ "$rc" == 2 ]] || fail "dosar existent: cod $rc, asteptat 2"
echo 'DIAG_TEST OK'
