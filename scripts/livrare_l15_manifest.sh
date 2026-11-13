#!/usr/bin/env bash
# ============================================================================
# L15 v2 (docs/LIVRARE_L15_V2.md): GENERAREA manifestului <NUME>.l15.tsv pe CLONA (PostgreSQL 17), pentru coordonator.
# Aplica migrarea EXACT in forma livrarii (fisierele runnerului cu --genereaza-in: prolog, lock consultativ, tinta, istoric,
# marcaj, copia protejata, inregistrarea; cu --plafon-tranzactie-ms forma „un mesaj” cu garda finala), cu pasii
# AMPRENTA_GLOBALA in modul TIPARIRE (scripts/livrare_amprenta.sh cu „-”): inainte tipareste GLOBAL, dupa tipareste
# diferenta (NOTICE L15_DIF, o linie pe obiect) — apoi ROLLBACK in locul COMMIT-ului: NIMIC comis. Mesajul are alt alias
# (manifest_l15_nu_e_livrare) => verificatorul livrarii nu-l poate confunda cu o livrare.
# Toate obiectele implicite (tipul rand + tabloul unui tabel nou, secventele identity / serial, indecsii, constrangerile,
# triggerele interne ale FK — si pe tabelul referit) apar ca randuri: nimic nu e „permis oricum”.
# Completitudine (L12): numarul de linii L15_DIF = numarul anuntat de server (L15_DIF_TOTAL), altfel refuz.
# Amprenta finala de pe clona = cea de pe productie DOAR daca obiectele atinse si contextul lor sunt identice (vezi
# documentul: nume de roluri, proprietari, ACL implicite, versiunea PostgreSQL); daca nu, runnerul REFUZA pe productie
# (nimic comis) — comparabilitatea e o problema operationala, nu de siguranta. Comparatia: citirea
# (scripts/amprenta_globala_citire.sh --lista) pe clona si pe productie, `diff` pe randurile atinse de manifest.
#
# Utilizare (parola din ~/.pgpass / PGPASSFILE; doar pe CLONA):
#   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/<NUME>.sql --versiune <AAAALLZZHHMMSS> \
#        --tinta-host <H> --tinta-port <P> --tinta-db <D> --tinta-sistem <system_identifier clona> --user <U> \
#        [--plafon-tranzactie-ms N] --iesire <dosar>/<NUME>.l15.tsv [--doar-genereaza <dosar_nou>]
# Coduri: 0 manifest scris | 1 aplicarea / tiparirea a esuat (nimic comis) | 2 argumente | 3 generare locala | 40 doar generat.
# ============================================================================
set -Eeuo pipefail
umask 077
refuz() { echo "REFUZ (nimic trimis): $2" >&2; exit "$1"; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MIG="" V="" H="" P="" D="" SIS="" U="" PLAFON_MS="" IES="" GEN=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || refuz 2 "optiunea $1 fara valoare"
  case "$1" in
    --migrare) MIG="$2" ;; --versiune) V="$2" ;; --tinta-host) H="$2" ;; --tinta-port) P="$2" ;; --tinta-db) D="$2" ;;
    --tinta-sistem) SIS="$2" ;; --user) U="$2" ;; --plafon-tranzactie-ms) PLAFON_MS="$2" ;; --iesire) IES="$2" ;;
    --doar-genereaza) GEN="$2" ;;
    *) refuz 2 "optiune nepermisa: $1" ;;
  esac
  shift 2
done
for v in PGPASSWORD PGOPTIONS PGDATABASE PSQLRC PGHOSTADDR PGTARGETSESSIONATTRS PGLOADBALANCEHOSTS PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGTZ PGDATESTYLE; do
  [ -z "${!v+x}" ] || refuz 2 "variabila $v e setata"
done
unset PGHOST PGPORT
[ -n "$MIG" ] && [ -f "$MIG" ] || refuz 2 "--migrare lipsa / inexistenta"
NUME="$(basename "$MIG" .sql)"
[[ "$NUME" =~ ^[0-9]{8}[a-z]?_[A-Za-z0-9_]+$ ]] || refuz 2 "nume de migrare invalid: $NUME"
[ -n "$IES" ] && [ "$(basename "$IES")" = "$NUME.l15.tsv" ] && [ ! -e "$IES" ] && [ -d "$(dirname "$IES")" ] \
  || refuz 2 "--iesire: fisier NOU numit $NUME.l15.tsv, intr-un dosar existent"
if [ -n "$GEN" ]; then [ ! -e "$GEN" ] && [ -d "$(dirname "$GEN")" ] || refuz 2 "--doar-genereaza: dosar NOU"; fi
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
W="$(mktemp -d)"; trap 'chmod -R u+w "$W" 2>/dev/null; rm -rf "$W"' EXIT
chmod 700 "$W"
PL=(); [ -z "$PLAFON_MS" ] || PL=(--plafon-tranzactie-ms "$PLAFON_MS")
rc=0
PSQL_BIN=/nu/se/foloseste bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" --versiune "$V" \
  --tinta-db "$D" --tinta-sistem "$SIS" --tinta-host "$H" --tinta-port "$P" --user "$U" ${PL[@]+"${PL[@]}"} \
  --genereaza-in "$W/g" >"$W/gen.log" 2>&1 || rc=$?
[ "$rc" = 40 ] || { cat "$W/gen.log" >&2; refuz 3 "runnerul nu a generat fisierele (cod $rc, asteptat 40)"; }
# shellcheck source=livrare_amprenta.sh
. "$ROOT/scripts/livrare_amprenta.sh"
T="$(ag_tag)"
ag_inainte "$T" - >"$W/2_ag_inainte.sql" || refuz 3 "pasul inainte (tiparire)"
ag_dupa "$T" - - >"$W/4_ag_dupa.sql" || refuz 3 "pasul dupa (tiparire)"
COPIE="$W/g/$NUME.sql"
if [ -n "$PLAFON_MS" ]; then
  # shellcheck source=livrare_mesaj.sh
  . "$ROOT/scripts/livrare_mesaj.sh"
  REST="$W/m_rest.sql"
  { cat "$W/g/1_pre.sql"; cat "$W/2_ag_inainte.sql"; } >"$REST"
  POZ="$(lm_octeti "$REST")"
  { cat "$COPIE"; lm_sep; cat "$W/g/3_inreg.sql"; cat "$W/4_ag_dupa.sql"; lm_timp "$NUME"; lm_fin "$NUME" "$PLAFON_MS" ROLLBACK; } >>"$REST" \
    || refuz 3 "restul mesajului"
  lm_mesaj "$W/g/0_prolog.sql" "$REST" "$W/m_mesaj.sql" "$NUME" "$POZ:$(lm_octeti "$COPIE"):$SHA" || refuz 3 "mesajul"
  TAG_M="lm_$(ag_tag)"
  if grep -qF "\$$TAG_M\$" "$W/m_mesaj.sql"; then refuz 3 "tag-ul mesajului apare in text"; fi
  { printf 'SELECT $%s$' "$TAG_M"; cat "$W/m_mesaj.sql"; printf '$%s$ AS manifest_l15_nu_e_livrare \\gexec\n' "$TAG_M"; } >"$W/5_mesaj.sql"
  cp -- "$W/g/00_sesiune.sql" "$W/g/9_reset.sql" "$W/"
  FISIERE=(00_sesiune.sql 5_mesaj.sql 9_reset.sql)
else
  printf 'BEGIN;\n' >"$W/0_begin.sql"; printf 'ROLLBACK;\n' >"$W/9_rollback.sql"
  cp -- "$W/g/0_prolog.sql" "$W/g/1_pre.sql" "$W/g/3_inreg.sql" "$COPIE" "$W/"
  FISIERE=(0_begin.sql 0_prolog.sql 1_pre.sql 2_ag_inainte.sql "$NUME.sql" 3_inreg.sql 4_ag_dupa.sql 9_rollback.sql)
fi
if [ -n "$GEN" ]; then
  mkdir -- "$GEN" && ( cd "$W" && cp -- "${FISIERE[@]}" "$GEN"/ ) || refuz 3 "--doar-genereaza: copierea"
  echo "✓ GENERAT (fara conexiune): $GEN ($(cd "$GEN" && ls | tr '\n' ' '))"
  exit 40
fi

ARGS=(); for f in "${FISIERE[@]}"; do ARGS+=(-f "$f"); done
export PGCLIENTENCODING=UTF8
rc=0
( cd "$W" && "${PSQL_BIN:-psql}" -X -q -v ON_ERROR_STOP=1 "${ARGS[@]}" -h "$H" -p "$P" -U "$U" -d "$D" ) >"$W/out.txt" 2>&1 || rc=$?
tr -d '\r' <"$W/out.txt" >"$W/out_lf.txt"
if [ "$rc" != 0 ]; then
  grep -E 'ERROR|FATAL|AMPRENTA_GLOBALA|PLAFON_|MESAJ_UNIC' "$W/out_lf.txt" | tail -n 8 >&2 || tail -n 8 "$W/out_lf.txt" >&2
  echo "✗ aplicarea pe clona a esuat (psql $rc) — nimic comis, manifest nescris" >&2; exit 1
fi
PFX='^(psql:[^ ]+: )?NOTICE:  '
G0="$(sed -nE "s/${PFX}AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32}) \(([0-9]+) randuri\).*/\2 \3/p" "$W/out_lf.txt")"
TOT="$(sed -nE "s/${PFX}L15_DIF_TOTAL ([0-9]+) GLOBAL_DUPA ([0-9a-f]{32}) \(([0-9]+) randuri\).*/\2 \3 \4/p" "$W/out_lf.txt")"
grep -E "${PFX}L15_DIF " "$W/out_lf.txt" | sed -E "s/${PFX}L15_DIF //" >"$W/linii.tsv" || true
read -r G0_MD5 G0_N <<<"$G0" || true
read -r N_ANUNT G1_MD5 G1_N <<<"$TOT" || true
N_LIN="$(grep -c . "$W/linii.tsv" || true)"
[[ "${G0_MD5:-}" =~ ^[0-9a-f]{32}$ ]] && [[ "${N_ANUNT:-}" =~ ^[0-9]+$ ]] && [ "$N_ANUNT" = "$N_LIN" ] \
  || { tail -n 20 "$W/out_lf.txt" >&2; echo "✗ diferenta INCOMPLETA: anuntat '${N_ANUNT:-?}', primite $N_LIN linii — manifest nescris" >&2; exit 1; }
grep -q "PLAFON_TIMP $NUME: garda trecuta" "$W/out_lf.txt" || [ -z "$PLAFON_MS" ] \
  || { echo "✗ garda finala nu a trecut — manifest nescris" >&2; exit 1; }
{
  printf '# L15 v2 - manifestul diferentelor pentru %s (AMPRENTA_GLOBALA v1); familie TAB eticheta TAB operatie TAB amprenta\n' "$NUME"
  printf '# generat pe clona cu scripts/livrare_l15_manifest.sh (ROLLBACK, nimic comis); migrarea sha256 %s\n' "$SHA"
  printf '# clona: GLOBAL inainte %s (%s randuri), dupa %s (%s randuri); %s obiecte\n' "$G0_MD5" "$G0_N" "$G1_MD5" "$G1_N" "$N_LIN"
  cat "$W/linii.tsv"
} >"$W/manifest.tsv"
ag_manifest_valid "$W/manifest.tsv" || refuz 3 "manifestul generat nu trece verificarea de format"
cp -- "$W/manifest.tsv" "$IES"
echo "--- timpi (ms de la BEGIN) ---"
grep -E "${PFX}(AMPRENTA_GLOBALA|L15_DIF_TOTAL|LIVRARE_TIMP|PLAFON_TIMP)" "$W/out_lf.txt" | sed -E "s/${PFX}//" || true
echo "✓ manifest scris: $IES ($N_LIN obiecte; sha256 $(sha256sum "$IES" | cut -d' ' -f1)); clona GLOBAL inainte $G0_MD5, dupa $G1_MD5; nimic comis"
