#!/usr/bin/env bash
# Runda 14 a runnerului (portal r18): psql de CONTROL pentru probele cu plafon (DOAR teste: scripts/test_livrare_plafon.sh,
# scripts/test_portal_e1.sh). Se pune ca PSQL_BIN; inlocuieste DOAR argumentul „-f .../5_mesaj.sql” (forma un mesaj)
# dupa CONTROL_MOD, restul apelurilor (pre-verificare, SET, RESET, reconciliere, gate 0e) trec neschimbate la
# $CONTROL_PG_BIN/psql. M = mesajul tranzactiei, scos din „SELECT $lm_..$<M>$lm_..$ AS livrare_mesaj_unic \gexec”.
#   instructiuni        M fara verificarea „un mesaj”, trimis ca fisier (psql -f => instructiune cu instructiune):
#                       forma de dinainte de runda 14 (controlul de latenta)
#   instructiuni_verif  M NESCHIMBAT, trimis instructiune cu instructiune => verificarea trebuie sa refuze (MESAJ_UNIC)
#   despartit_pauza     ca „instructiuni” + „\! sleep 1” chiar inaintea lui COMMIT (pauza client intre garda si COMMIT,
#                       forma r11)
#   pauza_in_mesaj      „SELECT pg_catalog.pg_sleep(1);” inserat in M inaintea lui COMMIT, tot UN mesaj => textul nu mai
#                       e cel generat => MESAJ_UNIC, refuz inaintea lock-urilor
#   fara_amanate        M fara „SET CONSTRAINTS ALL IMMEDIATE;” si fara verificare, tot UN mesaj (controlul r12)
#   r4c                 M fara blocul PLAFON_AMANABIL al garzii si fara verificare, tot UN mesaj (controlul r13)
# Marcajul $CONTROL_DIR/control_<mod> = transformarea s-a aplicat EXACT o data; altfel cod 7 (proba nefunctionala:
# psql nu porneste, iar controlul pica din motivul gresit, vizibil).
set -euo pipefail
mod="${CONTROL_MOD:?CONTROL_MOD}"; dir="${CONTROL_DIR:?CONTROL_DIR}"; bin="${CONTROL_PG_BIN:?CONTROL_PG_BIN}"
fara_verif() { # $1 -> $2: scoate blocul DO $mesaj_unic$ (exact unul)
  awk '/^DO \$mesaj_unic\$ BEGIN$/ { s = 1; n++ } !s { print } s && /^END \$mesaj_unic\$;$/ { s = 0 }
       END { exit (n == 1 && !s ? 0 : 7) }' "$1" >"$2"
}
inainte_de_commit() { # $1 linia de inserat, $2 -> $3: inaintea liniei „COMMIT;” (exact una)
  # ENVIRON, nu -v: awk -v interpreteaza escape-urile („\!” ar deveni „!”)
  CTL_LINIE="$1" awk '/^COMMIT;$/ { print ENVIRON["CTL_LINIE"]; n++ } { print } END { exit (n == 1 ? 0 : 7) }' "$2" >"$3"
}
trimite_un_mesaj() { # $1 tag, $2 M -> $3 fisierul psql (aceeasi forma ca scripts/livrare_mesaj.sh lm_trimite)
  { printf 'SELECT $%s$' "$1"; cat "$2"; printf '$%s$ AS livrare_mesaj_unic \\gexec\n' "$1"; } >"$3"
}
a=()
while [ $# -gt 0 ]; do
  if [ "$1" = -f ] && [[ "${2:-}" == */5_mesaj.sql ]]; then
    m="$dir/ctl_m_$$.sql"; m2="$dir/ctl_m2_$$.sql"; m3="$dir/ctl_m3_$$.sql"; f="$dir/ctl_5_mesaj_$$.sql"
    tag="$(sed -n '1s/^SELECT \$\(lm_[0-9a-f]\{16\}\)\$.*$/\1/p' "$2")"
    [[ "$tag" =~ ^lm_[0-9a-f]{16}$ ]] || exit 7
    [[ "$(tail -n 1 "$2")" == "\$$tag\$ AS livrare_mesaj_unic \\gexec" ]] || exit 7
    sed -e "1s/^SELECT \\\$$tag\\\$//" -e '$d' "$2" >"$m"
    [[ "$(head -n 1 "$m")" == 'BEGIN;' ]] || exit 7
    case "$mod" in
      instructiuni) fara_verif "$m" "$m2"; a+=(-f "$m2") ;;
      instructiuni_verif) a+=(-f "$m") ;;
      despartit_pauza) fara_verif "$m" "$m2"; inainte_de_commit '\! sleep 1' "$m2" "$m3"; a+=(-f "$m3") ;;
      pauza_in_mesaj) inainte_de_commit 'SELECT pg_catalog.pg_sleep(1);' "$m" "$m2"; trimite_un_mesaj "$tag" "$m2" "$f"; a+=(-f "$f") ;;
      fara_amanate)
        fara_verif "$m" "$m2"
        [[ "$(grep -c '^SET CONSTRAINTS ALL IMMEDIATE;$' "$m2")" == 1 ]] || exit 7
        grep -v '^SET CONSTRAINTS ALL IMMEDIATE;$' "$m2" >"$m3"; trimite_un_mesaj "$tag" "$m3" "$f"; a+=(-f "$f") ;;
      r4c)
        fara_verif "$m" "$m2"
        awk '/^  IF pg_catalog\.age\(pg_catalog\.xid\(/ { sar = 1; n++ }
             !sar { print }
             sar && /v_amanabile; END IF;$/ { sar = 0 }
             END { exit (n == 1 && !sar ? 0 : 7) }' "$m2" >"$m3"
        if grep -q 'PLAFON_AMANABIL\|pg_trigger\|pg_constraint' "$m3"; then exit 7; fi
        trimite_un_mesaj "$tag" "$m3" "$f"; a+=(-f "$f") ;;
      *) exit 7 ;;
    esac
    touch "$dir/control_$mod"
    shift 2; continue
  fi
  a+=("$1"); shift
done
exec "$bin/psql" "${a[@]}"
