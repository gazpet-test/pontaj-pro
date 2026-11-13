#!/usr/bin/env bash
# ============================================================================
# L15 v2 (docs/LIVRARE_L15_V2.md): manifestul <NUME>.l15.tsv - GENERAREA pe clona si PROBA cu ROLLBACK pe tinta.
# Aplica migrarea EXACT in forma livrarii (fisierele runnerului cu --genereaza-in: prolog, lock consultativ, tinta, istoric,
# marcaj, copia protejata, inregistrarea; cu --plafon-tranzactie-ms forma "un mesaj" cu garda finala), cu pasii
# AMPRENTA_GLOBALA v2 in modul TIPARIRE (scripts/livrare_amprenta.sh cu "-"): inainte tipareste GLOBAL + contextul, dupa
# tipareste diferenta (NOTICE L15_DIF, o linie pe obiect) si detaliul canonic al fiecarui rand (L15_DET) - apoi ROLLBACK in
# locul COMMIT-ului: NIMIC comis (DDL + istoric; valorile de secventa consumate si efectele externe NU se anuleaza la
# ROLLBACK). Mesajul are alt alias (manifest_l15_nu_e_livrare) => verificatorul livrarii nu-l poate confunda cu o livrare.
# Toate obiectele implicite (tipul rand + tabloul unui tabel nou, secventele identity / serial, indecsii, constrangerile,
# triggerele interne ale FK - si pe tabelul referit) apar ca randuri: nimic nu e "permis oricum".
# Completitudine (L12): numarul de linii L15_DIF (si L15_DET) = numarul anuntat de server (L15_DIF_TOTAL), altfel refuz.
#
# Doua moduri, EXACT unul:
#   --iesire <dosar>/<NUME>.l15.tsv    GENERAREA manifestului - DOAR pe CLONA. Antetul: versiunea amprentei (v2),
#                                      server_version_num, rolul, GLOBAL inainte / dupa. [--detalii <fisier nou>.l15.detalii.txt]:
#                                      pe langa manifest, detaliul canonic complet al fiecarui rand (JSON-ul al carui md5 e
#                                      amprenta; la "sters" cel de dinainte) - material de review, NU se versioneaza
#                                      (.gitignore; refuz in supabase/migrations/).
#   --compara-cu <manifest existent>   PROBA cu ROLLBACK pe TINTA (orice tinta, inclusiv productia - cu acordul owner-ului):
#                                      aceeasi forma, nu scrie nimic, compara diferenta obtinuta cu manifestul dat (liniile "#"
#                                      ignorate): IDENTIC (0) sau DOAR_AICI / DOAR_IN_MANIFEST / ALTA_AMPRENTA (6), + timpii.
#                                      [--amprenta-globala <md5>]: verifica si ca GLOBAL-ul dinainte e cel asteptat (altfel 6).
# Comparabilitatea clona <-> tinta NU se presupune: scripts/l15_compara_liste.sh --manifest pe citirile cu --lista ale
# amandurora, apoi proba --compara-cu pe tinta (docs/LIVRARE_L15_V2.md, sectiunile 5 si 7).
#
# Utilizare (parola din ~/.pgpass / PGPASSFILE):
#   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/<NUME>.sql --versiune <AAAALLZZHHMMSS> \
#        --tinta-host <H> --tinta-port <P> --tinta-db <D> --tinta-sistem <system_identifier> --user <U> [--plafon-tranzactie-ms N] \
#        ( --iesire <dosar>/<NUME>.l15.tsv [--detalii <fisier>.l15.detalii.txt] | --compara-cu <NUME>.l15.tsv [--amprenta-globala <md5>] ) \
#        [--doar-genereaza <dosar_nou>]
# Coduri: 0 manifest scris / IDENTIC | 1 aplicarea / tiparirea a esuat (nimic comis) | 2 argumente | 3 generare locala |
#   6 proba: diferenta != manifestul (sau GLOBAL inainte != cel asteptat) | 40 doar generat.
# ============================================================================
set -Eeuo pipefail
umask 077
refuz() { echo "REFUZ (nimic trimis): $2" >&2; exit "$1"; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MIG="" V="" H="" P="" D="" SIS="" U="" PLAFON_MS="" IES="" GEN="" DET="" CMP="" AG_ASTEPTAT=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || refuz 2 "optiunea $1 fara valoare"
  case "$1" in
    --migrare) MIG="$2" ;; --versiune) V="$2" ;; --tinta-host) H="$2" ;; --tinta-port) P="$2" ;; --tinta-db) D="$2" ;;
    --tinta-sistem) SIS="$2" ;; --user) U="$2" ;; --plafon-tranzactie-ms) PLAFON_MS="$2" ;; --iesire) IES="$2" ;;
    --doar-genereaza) GEN="$2" ;; --detalii) DET="$2" ;; --compara-cu) CMP="$2" ;; --amprenta-globala) AG_ASTEPTAT="$2" ;;
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
if [ -n "$IES" ] && [ -n "$CMP" ] || [ -z "$IES$CMP" ]; then refuz 2 "exact unul din --iesire (generare, pe clona) / --compara-cu (proba pe tinta)"; fi
if [ -n "$IES" ]; then
  [ "$(basename "$IES")" = "$NUME.l15.tsv" ] && [ ! -e "$IES" ] && [ -d "$(dirname "$IES")" ] \
    || refuz 2 "--iesire: fisier NOU numit $NUME.l15.tsv, intr-un dosar existent"
  [ -z "$AG_ASTEPTAT" ] || refuz 2 "--amprenta-globala se foloseste doar cu --compara-cu"
  if [ -n "$DET" ]; then
    [[ "$(basename "$DET")" == *.l15.detalii.txt ]] && [ ! -e "$DET" ] && [ -d "$(dirname "$DET")" ] \
      || refuz 2 "--detalii: fisier NOU <nume>.l15.detalii.txt (ignorat de git), intr-un dosar existent"
    case "$(cd "$(dirname "$DET")" && pwd -P)/" in */supabase/migrations/*) refuz 2 "--detalii: nu in supabase/migrations/ (detaliile nu se versioneaza)" ;; esac
  fi
else
  [ -z "$DET" ] || refuz 2 "--detalii se foloseste doar la generare (--iesire)"
  [ -z "$AG_ASTEPTAT" ] || [[ "$AG_ASTEPTAT" =~ ^[0-9a-f]{32}$ ]] || refuz 2 "--amprenta-globala: md5 (32 hex, litere mici)"
fi
if [ -n "$GEN" ]; then [ ! -e "$GEN" ] && [ -d "$(dirname "$GEN")" ] || refuz 2 "--doar-genereaza: dosar NOU"; fi
SHA="$(sha256sum "$MIG" | cut -d' ' -f1)"
W="$(mktemp -d)"; trap 'chmod -R u+w "$W" 2>/dev/null; rm -rf "$W"' EXIT
chmod 700 "$W"
# shellcheck source=livrare_amprenta.sh
. "$ROOT/scripts/livrare_amprenta.sh"
if [ -n "$CMP" ]; then
  ag_manifest_valid "$CMP" || refuz 2 "--compara-cu: manifestul dat nu are formatul corect"
  tr -d '\r' <"$CMP" | grep -v '^#' | grep -v '^$' | LC_ALL=C sort >"$W/manifest_dat.tsv" || true
fi
PL=(); [ -z "$PLAFON_MS" ] || PL=(--plafon-tranzactie-ms "$PLAFON_MS")
rc=0
PSQL_BIN=/nu/se/foloseste bash "$ROOT/scripts/livrare_migrare.sh" --migrare "$MIG" --sha256 "$SHA" --versiune "$V" \
  --tinta-db "$D" --tinta-sistem "$SIS" --tinta-host "$H" --tinta-port "$P" --user "$U" ${PL[@]+"${PL[@]}"} \
  --genereaza-in "$W/g" >"$W/gen.log" 2>&1 || rc=$?
[ "$rc" = 40 ] || { cat "$W/gen.log" >&2; refuz 3 "runnerul nu a generat fisierele (cod $rc, asteptat 40)"; }
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
  echo "[ok] GENERAT (fara conexiune): $GEN ($(cd "$GEN" && ls | tr '\n' ' '))"
  exit 40
fi

ARGS=(); for f in "${FISIERE[@]}"; do ARGS+=(-f "$f"); done
export PGCLIENTENCODING=UTF8
rc=0
( cd "$W" && "${PSQL_BIN:-psql}" -X -q -v ON_ERROR_STOP=1 "${ARGS[@]}" -h "$H" -p "$P" -U "$U" -d "$D" ) >"$W/out.txt" 2>&1 || rc=$?
tr -d '\r' <"$W/out.txt" >"$W/out_lf.txt"
if [ "$rc" != 0 ]; then
  grep -E 'ERROR|FATAL|AMPRENTA_GLOBALA|PLAFON_|MESAJ_UNIC' "$W/out_lf.txt" | tail -n 8 >&2 || tail -n 8 "$W/out_lf.txt" >&2
  echo "[x] aplicarea a esuat (psql $rc) - nimic comis, nimic scris" >&2; exit 1
fi
PFX='^(psql:[^ ]+: )?NOTICE:  '
G0="$(sed -nE "s/${PFX}AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32}) \(([0-9]+) randuri\).*/\2 \3/p" "$W/out_lf.txt")"
CTX="$(sed -nE "s/${PFX}AMPRENTA_GLOBALA_CONTEXT server_version_num ([0-9]+) rol (.+)$/\2 \3/p" "$W/out_lf.txt")"
TOT="$(sed -nE "s/${PFX}L15_DIF_TOTAL ([0-9]+) GLOBAL_DUPA ([0-9a-f]{32}) \(([0-9]+) randuri\).*/\2 \3 \4/p" "$W/out_lf.txt")"
grep -E "${PFX}L15_DIF " "$W/out_lf.txt" | sed -E "s/${PFX}L15_DIF //" >"$W/linii.tsv" || true
grep -E "${PFX}L15_DET " "$W/out_lf.txt" | sed -E "s/${PFX}L15_DET //" >"$W/detalii.tsv" || true
read -r G0_MD5 G0_N <<<"$G0" || true
read -r SVN ROL <<<"$CTX" || true
read -r N_ANUNT G1_MD5 G1_N <<<"$TOT" || true
N_LIN="$(grep -c . "$W/linii.tsv" || true)"
N_DET="$(grep -c . "$W/detalii.tsv" || true)"
[[ "${G0_MD5:-}" =~ ^[0-9a-f]{32}$ ]] && [[ "${N_ANUNT:-}" =~ ^[0-9]+$ ]] && [ "$N_ANUNT" = "$N_LIN" ] && [ "$N_ANUNT" = "$N_DET" ] \
  && [[ "${SVN:-}" =~ ^[0-9]+$ ]] && [ -n "${ROL:-}" ] \
  || { tail -n 20 "$W/out_lf.txt" >&2; echo "[x] diferenta INCOMPLETA: anuntat '${N_ANUNT:-?}', primite $N_LIN linii / $N_DET detalii (context '${CTX:-?}') - nimic scris" >&2; exit 1; }
grep -q "PLAFON_TIMP $NUME: garda trecuta" "$W/out_lf.txt" || [ -z "$PLAFON_MS" ] \
  || { echo "[x] garda finala nu a trecut - nimic scris" >&2; exit 1; }
timpi() {
  echo "--- timpi (ms de la BEGIN) ---"
  grep -E "${PFX}(AMPRENTA_GLOBALA|L15_DIF_TOTAL|LIVRARE_TIMP|PLAFON_TIMP)" "$W/out_lf.txt" | grep -v 'AMPRENTA_GLOBALA_CONTEXT' | sed -E "s/${PFX}//" || true
}

if [ -n "$CMP" ]; then
  # PROBA pe tinta: diferenta obtinuta vs manifestul dat (cheia = familie + eticheta; eticheta poate contine TAB)
  LC_ALL=C sort "$W/linii.tsv" >"$W/aici.tsv"
  awk -F'\t' '
    function cheie(   k, i) { k = $1; for (i = 2; i <= NF - 2; i++) k = k FS $i; return k }
    FILENAME == ARGV[1] {m[cheie()] = $(NF-1) FS $NF; next }
    { k = cheie(); v = $(NF-1) FS $NF
      if (!(k in m)) print "DOAR_AICI" FS $0
      else if (m[k] != v) print "ALTA_AMPRENTA" FS k FS "aici " v FS "manifest " m[k] }' "$W/manifest_dat.tsv" "$W/aici.tsv" >"$W/dif.txt"
  awk -F'\t' '
    function cheie(   k, i) { k = $1; for (i = 2; i <= NF - 2; i++) k = k FS $i; return k }
    FILENAME == ARGV[1] {a[cheie()] = 1; next }
    { if (!(cheie() in a)) print "DOAR_IN_MANIFEST" FS $0 }' "$W/aici.tsv" "$W/manifest_dat.tsv" >>"$W/dif.txt"
  timpi
  REZ=0
  echo "proba: GLOBAL inainte $G0_MD5 ($G0_N randuri), dupa $G1_MD5; server_version_num $SVN; rol $ROL; $N_LIN obiecte in diferenta, $(grep -c . "$W/manifest_dat.tsv" || true) in manifest"
  if [ -n "$AG_ASTEPTAT" ] && [ "$G0_MD5" != "$AG_ASTEPTAT" ]; then
    echo "[x] GLOBAL inainte $G0_MD5 != asteptat $AG_ASTEPTAT (catalogul nu mai e cel citit - recitire)"; REZ=6
  fi
  if [ -s "$W/dif.txt" ]; then
    LC_ALL=C sort "$W/dif.txt"
    echo "[x] DIFERIT de manifest ($(grep -c . "$W/dif.txt") linii) - nimic comis (ROLLBACK)"; REZ=6
  else
    echo "[ok] IDENTIC: diferenta pe tinta = manifestul $(basename "$CMP") - nimic comis (ROLLBACK)"
  fi
  exit "$REZ"
fi

{
  printf '# L15 v2 - manifestul diferentelor pentru %s (AMPRENTA_GLOBALA v2); familie TAB eticheta TAB operatie TAB amprenta\n' "$NUME"
  printf '# generat pe clona cu scripts/livrare_l15_manifest.sh (ROLLBACK, nimic comis); migrarea sha256 %s\n' "$SHA"
  printf '# clona: server_version_num %s, rol %s\n' "$SVN" "$ROL"
  printf '# clona: GLOBAL inainte %s (%s randuri), dupa %s (%s randuri); %s obiecte\n' "$G0_MD5" "$G0_N" "$G1_MD5" "$G1_N" "$N_LIN"
  cat "$W/linii.tsv"
} >"$W/manifest.tsv"
ag_manifest_valid "$W/manifest.tsv" || refuz 3 "manifestul generat nu trece verificarea de format"
cp -- "$W/manifest.tsv" "$IES"
if [ -n "$DET" ]; then
  {
    printf '# L15 v2 - detaliul canonic al randurilor din %s.l15.tsv (material de review, NU se versioneaza)\n' "$NUME"
    printf '# familie TAB eticheta TAB operatie TAB moment (dupa | inainte pentru sters) TAB detaliu (md5(detaliu) = amprenta)\n'
    cat "$W/detalii.tsv"
  } >"$DET"
fi
timpi
echo "[ok] manifest scris: $IES ($N_LIN obiecte; sha256 $(sha256sum "$IES" | cut -d' ' -f1)); clona GLOBAL inainte $G0_MD5, dupa $G1_MD5; server_version_num $SVN, rol $ROL$([ -z "$DET" ] || echo "; detalii: $DET"); nimic comis"
