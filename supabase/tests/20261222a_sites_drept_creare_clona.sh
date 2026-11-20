#!/usr/bin/env bash
# Proba pe CLONA PG17 a migrării 20261222a_sites_drept_creare (runda 2, Jakarinos NO-GO pe e4277115): baseline L15 → concurență → aplicare →
# comportament → revenire → reaplicare, cu RUNNER-ul oficial (scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000) și DOUĂ sesiuni psql reale
# cu barieră explicită (fără sleep). O rulează coordonatorul (chat-ul). NU pe producție.
#
# CE ATINGE (exact, DOAR pe clonă — scriptul refuză dacă system_identifier-ul conectat nu e cel dat în CLONA_SISTEM):
#   * schema: aplică migrarea (o dată), o revine, o reaplică (prin runner, cu istoricul în supabase_migrations.schema_migrations; între revenire și
#     reaplicare șterge rândurile de istoric ale versiunilor 20261222120000 / 20261222120001 — DOAR pe clonă, cu CLONA_ISTORIC_STERGE=da);
#   * date de probă, cu prefixul „TEST 20261222A”: un proiect, șantierele create prin RPC, rândul de drept santiere_creare al contului TITULAR_ID;
#     șterse la final (trap EXIT / INT / TERM). Pașii de comportament fără concurență rulează în tranzacții ANULATE (ROLLBACK).
#   * fișiere: un folder temporar (mktemp -d) cu baseline-ul, copiile completate ale migrării / revenirii și jurnalele; șters la final.
#   * NIMIC altceva: niciun mail, niciun apel extern, niciun cont nou; conturile OWNER_ID / TITULAR_ID trebuie să existe pe clonă.
#
# CERE: bash ≥ 4 (coproc), psql ≥ 13 (\warn; recomandat 17), sha256sum, awk; conectare ca `postgres` (migrarea cere current_user = postgres),
#   parola din ~/.pgpass / PGPASSFILE (niciodată pe linia de comandă).
# RULARE (din rădăcina repo-ului, pe branch-ul PR-ului):
#   CLONA_SISTEM=<system_identifier al clonei> CLONA_ISTORIC_STERGE=da OWNER_ID=<uuid owner> TITULAR_ID=<uuid cont NErestrâns, executie editor>
#   PGHOST=<clona> PGPORT=<port> PGUSER=postgres PGDATABASE=postgres bash supabase/tests/20261222a_sites_drept_creare_clona.sh
#   (id-urile conturilor NU intră în repo, în PR sau în rapoarte publice.)
# IEȘIRE: 0 = toate așteptările se țin + curățenia a reușit; 1 = cel puțin o așteptare nu se ține; 2 = refuz / folosire greșită.
#
# PAȘI (așteptările scrise de mână, independent de cod):
#   P0 precondiții: PG ≥ 17, postgres, clona confirmată, migrarea NEaplicată, conturile (owner; titular nerestrâns cu executie editor / admin).
#   P1 baseline L15 (runda 6: BASELINE-ul e lipit în migrare din citirea de producție): scripts/sites_drept_creare_amprente.sql (READ ONLY) pe
#      clonă → coloana linie_baseline TREBUIE să fie identică cu blocul BASELINE din migrare (altfel clona nu e ca producția: refuz, exit 2);
#      migrarea se aplică EXACT cum e în repo (doar fără CR). Controalele ordinii din RPC: EXACT cheia străină executie_proiecte_site_id_fkey
#      (nedeferabilă), triggerul de proiect automat, 0 șantiere cu 2 proiecte, corpul triggerului 22f95c1e…; triggerele lui executie_proiecte se
#      afișează pentru review.
#   P2 concurență migrare: A ține ROW EXCLUSIVE pe sites (BEGIN; LOCK … ROW EXCLUSIVE) → runner-ul aplică → 10 (NEAPLICAT) cu BUGET_LOCK /
#      55P03 în ~1 s; RPC-ul nu există. A: ROLLBACK.
#   P3 aplicarea prin runner → 0 (APLICAT + ÎNREGISTRAT); corpul triggerului = cel nou (constanta AMPRENTA-CORP auto din migrare).
#   P4 comportament (tranzacție anulată): titular fără drept → 42501; INSERT direct al titularului → 42501; cu drept: proiect nou → RPC →
#      un șantier, legat în ambele sensuri (cheia străină reală, triggerele reale ale lui executie_proiecte), FĂRĂ proiect automat, coloanele
#      administrative implicite (fără coordonate); al doilea apel → același șantier, creat = false; owner fără proiect → ok + proiectul automat
#      creat de trigger (calea de azi); proiect inexistent → P0002.
#   P5 concurență RPC: proiect de probă + dreptul titularului (comise). A: BEGIN; RPC(proiect) → ține proiectul FOR UPDATE. B: același RPC cu
#      lock_timeout 1 s → 55P03. A: COMMIT. B din nou → creat = false, același șantier. Exact 1 șantier pe proiect, 1 proiect pe șantier.
#   P6 revenirea cu dreptul acordat → 10 + „dreptul santiere_creare e acordat”; dreptul se retrage (DELETE pe rândul de probă).
#   P6b (runda 3) deriva după aplicare: GRANT EXECUTE către service_role / către PUBLIC / ALTER … STRICT → revenirea → 10 + „starea nu e cea din
#      20261222a (pasul 1, functia)”, RPC-ul și cheia rămân; deriva se reface (REVOKE / CALLED ON NULL INPUT) și ACL-ul + strict revin exact.
#   P7 concurență revenire: A: BEGIN; INSERT dreptul (necomis: FOR KEY SHARE pe cheie) → revenirea → 10 cu BUGET_LOCK. A: ROLLBACK.
#   P8 revenirea → 0; RPC-ul și cheia lipsesc; corpul triggerului = 22f95c1e… (cel de azi); baseline-ul L15 recalculat = cel din P1; șantierul
#      din P5 rămâne, legat de proiect.
#   P9 reaplicarea (istoricul clonei curățat) → 0; P4 din nou.
set -u
set -o pipefail

refuz() { echo "refuz: $*" >&2; exit 2; }
[ "${CLONA_ISTORIC_STERGE:-}" = "da" ] || refuz "scriptul aplică / revine / reaplică pe CLONĂ și șterge istoricul versiunilor 20261222120000/1 acolo; pune CLONA_ISTORIC_STERGE=da"
for v in CLONA_SISTEM OWNER_ID TITULAR_ID PGHOST PGPORT PGDATABASE; do [ -n "${!v:-}" ] || refuz "lipsește $v"; done
[ "${PGUSER:-}" = "postgres" ] || refuz "PGUSER trebuie să fie postgres"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
[[ "$OWNER_ID" =~ $UUID_RE ]] && [[ "$TITULAR_ID" =~ $UUID_RE ]] || refuz "OWNER_ID / TITULAR_ID trebuie să fie uuid-uri (litere mici)"
[[ "$CLONA_SISTEM" =~ ^[0-9]{10,25}$ ]] || refuz "CLONA_SISTEM trebuie să fie system_identifier-ul numeric al clonei"
RADACINA="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$RADACINA/supabase/migrations/20261222a_sites_drept_creare.sql"
REV="$RADACINA/supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql"
AMP="$RADACINA/scripts/sites_drept_creare_amprente.sql"
RUNNER="$RADACINA/scripts/livrare_migrare.sh"
for f in "$MIG" "$REV" "$AMP" "$RUNNER"; do [ -r "$f" ] || refuz "lipsește $f"; done
VERS_CLIENT="$(psql --version 2>/dev/null | sed -n 's/^psql (PostgreSQL) \([0-9]*\).*/\1/p')"
[ -n "$VERS_CLIENT" ] && [ "$VERS_CLIENT" -ge 13 ] || refuz "psql >= 13 (\\warn); găsit: $(psql --version 2>&1)"

PS=(psql -X -q -w -v ON_ERROR_STOP=1)
q() { "${PS[@]}" -tAc "$1"; }

# ── P0 precondiții (doar citire) ──
PRE="$(q "SELECT current_setting('server_version_num')::int >= 170000, current_user = 'postgres', (SELECT system_identifier::text FROM pg_control_system()),
  to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') IS NULL AND NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare'),
  EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER_ID' AND is_owner IS TRUE),
  EXISTS (SELECT 1 FROM public.profiles WHERE id = '$TITULAR_ID' AND is_owner IS NOT TRUE)
   AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$TITULAR_ID' AND module = 'executie' AND access_level IN ('editor', 'admin'))
   AND NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect WHERE profile_id = '$TITULAR_ID')
   AND NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$TITULAR_ID' AND module = 'santiere_creare')")" \
  || refuz "nu mă pot conecta (PGHOST / PGPORT / PGDATABASE / pgpass)"
IFS='|' read -r P_VER P_PG P_SIS P_NEAPL P_OWN P_TIT <<< "$PRE"
[ "$P_VER" = t ] || refuz "serverul nu e PostgreSQL >= 17"
[ "$P_PG" = t ] || refuz "current_user nu e postgres"
[ "$P_SIS" = "$CLONA_SISTEM" ] || refuz "system_identifier conectat ($P_SIS) diferă de CLONA_SISTEM: nu e clona confirmată"
[ "$P_NEAPL" = t ] || refuz "migrarea pare deja aplicată pe clonă (RPC-ul sau cheia există)"
[ "$P_OWN" = t ] || refuz "OWNER_ID nu e un profil owner pe clonă"
[ "$P_TIT" = t ] || refuz "TITULAR_ID trebuie: profil non-owner, executie editor / admin, NErestrâns (fără executie_acces_proiect), fără santiere_creare"

D="$(mktemp -d -t sites_drept_creare_clona_XXXXXX)"
A_OUT="$D/A.stdout.log"; A_ERR="$D/A.stderr.log"; : > "$A_ERR"
A_DESCHIS=0; esec=0; A_FD_IN=''; A_FD_OUT=''; A_PID_C=''; DERIVA_DESCHISA=0
curatenie() {
  local cod=$?
  trap - EXIT INT TERM
  if [ "$A_DESCHIS" = 1 ]; then { printf '%s\n' 'ROLLBACK;' '\q' >&"$A_FD_IN"; } 2>/dev/null || true; wait "$A_PID_C" 2>/dev/null || true; fi
  # P6b întrerupt: deriva de probă (drept / STRICT pe RPC) se reface pe clonă
  if [ "$DERIVA_DESCHISA" = 1 ]; then
    "${PS[@]}" -c "DO \$\$ BEGIN IF to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') IS NOT NULL THEN
      REVOKE EXECUTE ON FUNCTION public.fn_sites_creeaza(text, bigint, text) FROM service_role, PUBLIC;
      ALTER FUNCTION public.fn_sites_creeaza(text, bigint, text) CALLED ON NULL INPUT; END IF; END \$\$;" > /dev/null 2>&1 \
      && echo "  OK  curățenie: deriva P6b refăcută" || { echo "  NU  curățenie: deriva P6b (drept / STRICT pe fn_sites_creeaza) de refăcut manual"; cod=1; }
  fi
  # datele de probă (doar cele cu prefixul și contul de probă)
  "${PS[@]}" -c "BEGIN;
    DELETE FROM public.user_module_access WHERE profile_id = '$TITULAR_ID' AND module = 'santiere_creare';
    UPDATE public.executie_proiecte SET site_id = NULL WHERE nume LIKE 'TEST 20261222A%';
    DELETE FROM public.sites WHERE name LIKE 'TEST 20261222A%';
    DELETE FROM public.executie_proiecte WHERE nume LIKE 'TEST 20261222A%';
    COMMIT;" > /dev/null 2>&1 && echo "  OK  curățenie: datele de probă TEST 20261222A" || { echo "  NU  curățenie: datele de probă (de șters manual, prefix TEST 20261222A)"; cod=1; }
  if [ "$cod" != 0 ] || [ "$esec" != 0 ]; then echo "── jurnalul sesiunii A (ultimele 30 de linii) ──"; tail -n 30 "$A_ERR" 2>/dev/null; fi
  rm -rf "$D"
  if [ "$cod" = 0 ] && [ "$esec" != 0 ]; then cod=1; fi
  exit "$cod"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ok() { if [ "$1" = 0 ]; then echo "  OK  $2"; else echo "  NU  $2"; esec=$((esec + 1)); fi; }
egal() { if [ "$1" = "$2" ]; then echo "  OK  $3 → $1"; else echo "  NU  $3 → $1 (aștepta $2)"; esec=$((esec + 1)); fi; }
jwt() { printf "SET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true), set_config('request.jwt.claim.sub', '%s', true);\n" "$1" "$1"; }

# ── sesiunea A: psql ținut deschis (coproc); marcaj `\warn <PAS> :SQLSTATE` după fiecare pas ──
deschideA() { coproc A { psql -X -q -w -v ON_ERROR_STOP=0 -f - 2>&1 1>"$A_OUT"; }; A_FD_IN="${A[1]}"; A_FD_OUT="${A[0]}"; A_PID_C="$A_PID"; A_DESCHIS=1; }
pasA() {
  local marcaj="$1" linie; shift
  printf '%s\n' "$@" "\\warn $marcaj :SQLSTATE" >&"$A_FD_IN"
  A_STARE=''
  while IFS= read -r -t 60 -u "$A_FD_OUT" linie; do
    printf '%s\n' "$linie" >> "$A_ERR"
    case "$linie" in "$marcaj "*) A_STARE="${linie#"$marcaj" }"; return 0;; esac
  done
  echo "  NU  sesiunea A nu a confirmat pasul $marcaj"; esec=$((esec + 1)); A_STARE='FARA_RASPUNS'; return 1
}
inchideA() { printf '%s\n' '\q' >&"$A_FD_IN"; wait "$A_PID_C" 2>/dev/null || true; A_DESCHIS=0; }
# sesiunea B: un psql sincron; întoarce SQLSTATE-ul ultimei instrucțiuni (00000 = reușit) în B_STARE și ieșirea în B_OUT
pasB() {
  B_OUT="$(printf '%s\n' "$@" '\echo B_STARE :SQLSTATE' | psql -X -q -w -v ON_ERROR_STOP=0 -tA -f - 2>&1)"
  B_STARE="$(printf '%s\n' "$B_OUT" | sed -n 's/^B_STARE //p' | tail -n 1)"
}

# runner: <fișier> <versiune> → cod de ieșire în R_COD, ieșirea în R_OUT
livreaza() {
  local f="$1" v="$2" sha
  sha="$(sha256sum "$f" | cut -d' ' -f1)"
  R_OUT="$(bash "$RUNNER" --migrare "$f" --sha256 "$sha" --versiune "$v" --tinta-db "$PGDATABASE" --tinta-sistem "$CLONA_SISTEM" \
             --tinta-host "$PGHOST" --tinta-port "$PGPORT" --user postgres --plafon-tranzactie-ms 2000 2>&1)"; R_COD=$?
}

# ── P1 baseline L15 + controalele ordinii din RPC ──
echo "P1 baseline L15 (READ ONLY) și presupunerile ordinii din RPC"
SECT="$D/sectiune.sql"
{ echo "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = public, pg_temp;"
  tr -d '\r' < "$AMP" | awk '/^WITH RECURSIVE$/{p=1} p{print} /^  FROM amp_calc c ORDER BY c.eticheta COLLATE "C";$/{exit}'
  echo "ROLLBACK;"; } > "$SECT"
baseline_linii() { "${PS[@]}" -tA -F $'\x1f' -f "$SECT" | awk -F $'\x1f' 'NF >= 3 {print $3}'; }
baseline_linii > "$D/baseline.txt"
NB="$(grep -c . "$D/baseline.txt")"
ok "$([ "$NB" -ge 10 ] && grep -q "'functie fn_auto_create_executie_proiect()'" "$D/baseline.txt" && grep -q "'tabel sites | triggere'" "$D/baseline.txt"; echo $?)" "baseline: $NB linii, cu triggerul de proiect automat"
# runda 6: migrarea se aplică EXACT cum e în repo (BASELINE-ul lipit din producție); clona trebuie să aibă același baseline
MIGB="$D/migrare/20261222a_sites_drept_creare.sql"; mkdir -p "$D/migrare" "$D/revenire"
tr -d '\r' < "$MIG" > "$MIGB"
awk '/^-- >>> BASELINE 20261222a/{p=1} /^-- <<< BASELINE 20261222a/{p=0} p && (/^    \(/ || /^  , \(/)' "$MIGB" > "$D/baseline_migrare.txt"
ok "$([ "$(grep -c . "$D/baseline_migrare.txt")" -ge 10 ] && ! grep -q 'DE_COMPLETAT' "$D/baseline_migrare.txt"; echo $?)" "migrarea are blocul BASELINE lipit ($(grep -c . "$D/baseline_migrare.txt") linii)"
if ! cmp -s "$D/baseline_migrare.txt" "$D/baseline.txt"; then
  echo "  ── diferențe (< migrare = producție, > clona) ──"; diff "$D/baseline_migrare.txt" "$D/baseline.txt" | head -n 40
  refuz "baseline-ul clonei diferă de BASELINE-ul revizuit din producție (blocul din migrare): clona nu e ca producția, nu aplic"
fi
echo "  OK  baseline-ul clonei = BASELINE-ul din migrare (producție, 20.11.2026)"
REVC="$D/revenire/20261222a_sites_drept_creare_ROLLBACK.sql"; tr -d '\r' < "$REV" > "$REVC"
AUTO_AZI="22f95c1e3f15cde32a1d2c11e3259089"
AUTO_NOU="$(awk '/-- AMPRENTA-CORP auto/{getline; if (match($0, /corp_md5=[0-9a-f]+/)) print substr($0, RSTART + 9, RLENGTH - 9); exit}' "$MIGB")"
ok "$([[ "$AUTO_NOU" =~ ^[0-9a-f]{32}$ ]] && [ "$AUTO_NOU" != "$AUTO_AZI" ]; echo $?)" "constanta corpului nou al triggerului din migrare: $AUTO_NOU"
md5_auto() { q "SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_auto_create_executie_proiect()')"; }
CTRL="$(q "SELECT (SELECT count(*) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.executie_proiecte'::regclass AND c.contype = 'f' AND a.attname = 'site_id'),
  EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.executie_proiecte'::regclass AND c.contype = 'f' AND c.conname = 'executie_proiecte_site_id_fkey'
    AND c.confrelid = 'public.sites'::regclass AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (site_id) REFERENCES sites(id)'
    AND NOT c.condeferrable AND NOT c.condeferred AND c.convalidated),
  (SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid = 'public.sites'::regclass AND tg.tgname = 'tr_auto_create_executie_proiect'
    AND tg.tgfoid = to_regprocedure('public.fn_auto_create_executie_proiect()') AND tg.tgtype = 5 AND tg.tgenabled = 'O' AND tg.tgnargs = 0 AND tg.tgqual IS NULL),
  (SELECT count(*) FROM (SELECT site_id FROM public.executie_proiecte WHERE site_id IS NOT NULL GROUP BY site_id HAVING count(*) > 1) d),
  (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.fn_auto_create_executie_proiect()'))")"
egal "$CTRL" "1|t|1|0|$AUTO_AZI" "chei străine site_id | cheia exactă (nedeferabilă) | trigger | șantiere cu 2 proiecte | corpul triggerului (de azi)"
echo "  ── triggerele lui executie_proiecte (rulează la UPDATE site_id din RPC; de citit în review) ──"
q "SELECT '     ' || tgname || ' | ' || tgfoid::regprocedure || ' | ' || tgenabled FROM pg_trigger WHERE tgrelid = 'public.executie_proiecte'::regclass AND NOT tgisinternal ORDER BY tgname"

# ── P2 concurență: migrarea cu sites ocupat ──
echo "P2 migrarea cu sites ținut de altă sesiune (ROW EXCLUSIVE)"
deschideA
pasA A_LOCK 'BEGIN;' 'LOCK TABLE public.sites IN ROW EXCLUSIVE MODE;'
egal "$A_STARE" "00000" "A ține sites ROW EXCLUSIVE"
livreaza "$MIGB" 20261222120000
egal "$R_COD" "10" "aplicarea sub lock: NEAPLICAT confirmat"
ok "$(printf '%s' "$R_OUT" | grep -q 'BUGET_LOCK'; echo $?)" "motivul: BUGET_LOCK (55P03), nimic schimbat"
egal "$(q "SELECT to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') IS NULL")" "t" "RPC-ul nu există"
pasA A_RB 'ROLLBACK;'; inchideA

# ── P3 aplicarea ──
echo "P3 aplicarea prin runner (plafon 2000)"
livreaza "$MIGB" 20261222120000
egal "$R_COD" "0" "APLICAT + ÎNREGISTRAT"; [ "$R_COD" = 0 ] || { printf '%s\n' "$R_OUT" | tail -n 15; exit 1; }
egal "$(md5_auto)" "$AUTO_NOU" "corpul triggerului de proiect automat după aplicare (condiția sites.proiect_id)"

# ── P4 comportament (tranzacție anulată; marcaje PROBA_OK / PROBA_NU) ──
comportament() {
  local et="$1" out
  out="$("${PS[@]}" -v ON_ERROR_STOP=0 -tA -v owner="$OWNER_ID" -v tit="$TITULAR_ID" -f - 2>&1 <<'SQL'
BEGIN;
INSERT INTO public.executie_proiecte (nume, cod_intern, activ) VALUES ('TEST 20261222A P4', 'TEST_20261222A_P4_' || txid_current(), true) RETURNING id AS proiect \gset
SELECT count(*) AS p0 FROM public.executie_proiecte \gset
SAVEPOINT s1;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'tit', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'tit', true) \gset
SELECT public.fn_sites_creeaza('TEST 20261222A fara drept', :proiect, NULL);
\echo PROBA_STARE fara_drept :SQLSTATE
ROLLBACK TO SAVEPOINT s1;
SAVEPOINT s2;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'tit', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'tit', true) \gset
INSERT INTO public.sites (name, active) VALUES ('TEST 20261222A direct', true);
\echo PROBA_STARE insert_direct :SQLSTATE
ROLLBACK TO SAVEPOINT s2;
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES (:'tit', 'santiere_creare', 'editor');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'tit', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'tit', true) \gset
SELECT (r->>'site_id') AS s1, (r->>'creat') AS c1 FROM (SELECT public.fn_sites_creeaza('TEST 20261222A santier', :proiect, 'TEST') AS r) x \gset
SELECT (r->>'site_id') AS s2, (r->>'creat') AS c2 FROM (SELECT public.fn_sites_creeaza('TEST 20261222A santier', :proiect, 'TEST') AS r) x \gset
RESET ROLE;
SELECT (SELECT count(*) FROM public.executie_proiecte WHERE site_id = :s1) = 1
   AND (SELECT site_id FROM public.executie_proiecte WHERE id = :proiect) = :s1
   AND (SELECT count(*) FROM public.executie_proiecte) = :p0
   AND :'c1' = 'true' AND :'c2' = 'false' AND :'s2' = :'s1' AS legat \gset
\echo PROBA_BOOL legat_fara_proiect_automat_idempotent :legat
SELECT proiect_id = :proiect AND contract_id IS NULL AND tip_locatie = 'santier' AND lat IS NULL AND lng IS NULL AND aliases = '{}'::text[]
   AND denumire_qr IS NULL AND este_inchiriat IS FALSE AND active IS TRUE AND beneficiar_principal = 'TEST' AS implicite FROM public.sites WHERE id = :s1 \gset
\echo PROBA_BOOL coloane_implicite :implicite
SAVEPOINT s3;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'tit', true) \gset
SELECT public.fn_sites_creeaza('TEST 20261222A inexistent', -1, NULL);
\echo PROBA_STARE proiect_inexistent :SQLSTATE
ROLLBACK TO SAVEPOINT s3;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true), set_config('request.jwt.claim.sub', :'owner', true) \gset
SELECT (r->>'creat') AS co, (r->>'site_id') AS so FROM (SELECT public.fn_sites_creeaza('TEST 20261222A owner', NULL, NULL) AS r) x \gset
\echo PROBA_TEXT owner_fara_proiect :co
RESET ROLE;
SELECT count(*) = 1 AS auto FROM public.executie_proiecte WHERE site_id = :so \gset
\echo PROBA_BOOL owner_proiect_automat :auto
ROLLBACK;
SQL
)"
  printf '%s\n' "$out" > "$D/P4_$et.log"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_STARE fara_drept //p')" "42501" "$et titular fără drept"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_STARE insert_direct //p')" "42501" "$et INSERT direct al titularului (UI veche + drept: refuz, nu fals succes)"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_BOOL legat_fara_proiect_automat_idempotent //p')" "t" "$et RPC: legat în ambele sensuri, fără proiect automat, idempotent"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_BOOL coloane_implicite //p')" "t" "$et coloanele administrative implicite (fără coordonate / contract)"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_STARE proiect_inexistent //p')" "P0002" "$et proiect inexistent"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_TEXT owner_fara_proiect //p')" "true" "$et owner, fără proiect"
  egal "$(printf '%s\n' "$out" | sed -n 's/^PROBA_BOOL owner_proiect_automat //p')" "t" "$et owner, fără proiect: proiectul automat creat de trigger (calea de azi)"
}
echo "P4 comportament (tranzacție anulată)"
comportament P4

# ── P5 concurență RPC pe același proiect ──
echo "P5 două apeluri RPC pe același proiect (barieră pe lock-ul proiectului)"
PROIECT="$(q "INSERT INTO public.executie_proiecte (nume, cod_intern, activ) VALUES ('TEST 20261222A P5', 'TEST_20261222A_P5_' || txid_current(), true) RETURNING id")"
q "INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('$TITULAR_ID', 'santiere_creare', 'editor')" > /dev/null
deschideA
pasA A_RPC 'BEGIN;' "$(jwt "$TITULAR_ID")" "SELECT public.fn_sites_creeaza('TEST 20261222A P5', $PROIECT, NULL);"
egal "$A_STARE" "00000" "A: RPC executat, proiectul ținut FOR UPDATE"
pasB 'BEGIN;' "SET LOCAL lock_timeout = '1s';" "$(jwt "$TITULAR_ID")" "SELECT public.fn_sites_creeaza('TEST 20261222A P5', $PROIECT, NULL);"
egal "$B_STARE" "55P03" "B: același proiect, așteaptă lock-ul lui A"
pasA A_COMMIT 'COMMIT;'; egal "$A_STARE" "00000" "A: COMMIT"; inchideA
pasB 'BEGIN;' "$(jwt "$TITULAR_ID")" "SELECT (r->>'creat') || ':' || (r->>'site_id') FROM (SELECT public.fn_sites_creeaza('TEST 20261222A P5', $PROIECT, NULL) AS r) x;" 'COMMIT;'
SITE_A="$(q "SELECT site_id FROM public.executie_proiecte WHERE id = $PROIECT")"
egal "$(printf '%s\n' "$B_OUT" | grep -E '^(true|false):' | tail -n 1)" "false:$SITE_A" "B din nou: același șantier, creat = false"
egal "$(q "SELECT (SELECT count(*) FROM public.sites WHERE proiect_id = $PROIECT) || '|' || (SELECT count(*) FROM public.executie_proiecte WHERE site_id = $SITE_A)")" "1|1" "un șantier pe proiect, un proiect pe șantier"

# ── P6 revenirea cu dreptul acordat ──
echo "P6 revenirea cu dreptul acordat"
livreaza "$REVC" 20261222120001
egal "$R_COD" "10" "revenirea refuzată (NEAPLICAT)"
ok "$(printf '%s' "$R_OUT" | grep -q 'dreptul santiere_creare e acordat'; echo $?)" "motivul: dreptul e acordat"
q "DELETE FROM public.user_module_access WHERE profile_id = '$TITULAR_ID' AND module = 'santiere_creare'" > /dev/null

# ── P6b deriva după aplicare (runda 3, Jakarinos r2 P2-2): un drept / o proprietate în plus față de detaliul „după” = revenirea refuză ──
echo "P6b deriva după aplicare: revenirea refuză, apoi starea se reface"
FN="public.fn_sites_creeaza(text, bigint, text)"
for d in "GRANT EXECUTE ON FUNCTION $FN TO service_role|REVOKE EXECUTE ON FUNCTION $FN FROM service_role" \
         "GRANT EXECUTE ON FUNCTION $FN TO PUBLIC|REVOKE EXECUTE ON FUNCTION $FN FROM PUBLIC" \
         "ALTER FUNCTION $FN STRICT|ALTER FUNCTION $FN CALLED ON NULL INPUT"; do
  STRICA="${d%%|*}"; REFACE="${d#*|}"
  DERIVA_DESCHISA=1; q "$STRICA" > /dev/null
  livreaza "$REVC" 20261222120001
  egal "$R_COD" "10" "revenirea cu deriva „$STRICA”: NEAPLICAT"
  ok "$(printf '%s' "$R_OUT" | grep -q 'starea nu e cea din 20261222a (pasul 1, functia)'; echo $?)" "motivul: starea nu e cea din 20261222a (functia)"
  egal "$(q "SELECT to_regprocedure('$FN') IS NOT NULL AND EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare')")" "t" "nimic schimbat (RPC-ul și cheia rămân)"
  q "$REFACE" > /dev/null; DERIVA_DESCHISA=0
done
egal "$(q "SELECT coalesce(string_agg(pg_get_userbyid(e.grantee) || ':' || e.privilege_type || CASE WHEN e.is_grantable THEN '*' ELSE '' END, ', ' ORDER BY pg_get_userbyid(e.grantee) COLLATE \"C\"), '-') || '|' || p.proisstrict
             FROM pg_proc p LEFT JOIN LATERAL aclexplode(p.proacl) e ON true WHERE p.oid = '$FN'::regprocedure GROUP BY p.proisstrict")" \
     "authenticated:EXECUTE, postgres:EXECUTE|false" "starea de după migrare refăcută (P8 revine pe ea)"

# ── P7 concurență: revenirea cu o acordare în curs ──
echo "P7 revenirea în timp ce altă sesiune acordă dreptul (necomis)"
deschideA
pasA A_ACORDA 'BEGIN;' "INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('$TITULAR_ID', 'santiere_creare', 'editor');"
egal "$A_STARE" "00000" "A: acordarea necomisă ține cheia (FOR KEY SHARE)"
livreaza "$REVC" 20261222120001
egal "$R_COD" "10" "revenirea sub lock: NEAPLICAT"
ok "$(printf '%s' "$R_OUT" | grep -q 'BUGET_LOCK'; echo $?)" "motivul: BUGET_LOCK pe cheie"
pasA A_RB 'ROLLBACK;'; inchideA

# ── P8 revenirea ──
echo "P8 revenirea"
livreaza "$REVC" 20261222120001
egal "$R_COD" "0" "revenirea APLICATĂ"
egal "$(q "SELECT to_regprocedure('public.fn_sites_creeaza(text, bigint, text)') IS NULL AND NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = 'santiere_creare')")" "t" "RPC-ul și cheia lipsesc"
egal "$(md5_auto)" "$AUTO_AZI" "corpul triggerului de proiect automat readus (cel de azi)"
baseline_linii > "$D/baseline_dupa.txt"
ok "$(cmp -s "$D/baseline.txt" "$D/baseline_dupa.txt"; echo $?)" "amprenta L15 după revenire = baseline-ul din P1"
egal "$(q "SELECT count(*) FROM public.sites s JOIN public.executie_proiecte e ON e.id = s.proiect_id AND e.site_id = s.id WHERE s.id = $SITE_A")" "1" "șantierul din P5 rămâne, legat de proiect"

# ── P9 reaplicarea ──
echo "P9 reaplicarea (istoricul clonei curățat pentru cele două versiuni)"
q "DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261222120000', '20261222120001')" > /dev/null
livreaza "$MIGB" 20261222120000
egal "$R_COD" "0" "reaplicarea APLICATĂ"
comportament P9

echo
[ "$esec" = 0 ] && echo "TOTUL OK" || echo "EȘEC: $esec verificări picate"
