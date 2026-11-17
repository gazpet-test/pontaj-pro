#!/usr/bin/env bash
# Proba pe CLONĂ pentru 20261226a (Redări: declarația „predare” + opțiunea retrasă), runda 2 a review-ului #1119 — DOAR pe CLONĂ, cu migrarea
# NEAPLICATĂ. NETESTAT de autor (serverul de cod nu are acces la nicio bază): îl rulează coordonatorul. Completează PGlite (o singură
# conexiune, schelet) cu: roluri și politici REALE, runnerul real, DOUĂ sesiuni în timpul aplicării, rândurile + jurnalul + revenirea pe date.
# Rulare (Git Bash; parola din pgpass, niciodată pe linia de comandă):
#   PSQL=<calea psql> EDITOR=<uuid profil cu redari = editor pe clonă> \
#   bash supabase/tests/20261226a_redari_predare_clona.sh --sistem <system_identifier clonă> --host <H> --port <P> --user postgres --db postgres \
#     --manifest <manifestul regenerat pe clonă>/20261226a_redari_predare_declaratie.l15.tsv --amprenta-globala <GLOBAL al clonei>
#   (OWNER=<uuid>, implicit 00000000-0000-4000-8000-000000000001: profilul sintetic is_owner al clonei, ca la 20261225a)
# GĂRZI (înainte de orice scriere): system_identifier = --sistem (22); migrarea neaplicată și fără istoric 20261226120000 / 20261226120001 (23);
#   OWNER is_owner și EDITOR cu redari = editor (24); niciun rest al unei rulări anterioare (id-urile sintetice / codurile TEST-PREDARE-SINT-%) (25).
# DATELE: SINTETICE, fără date personale („Persoana Sintetica …”, UAT „Sinteticeni” / ZZQ), comise (sesiunile trebuie să le vadă) și șterse
#   la final (trap), ca postgres, într-o tranzacție, cu triggerele USER ale tabelelor Redări atinse dezactivate DOAR în acea tranzacție (jurnalul
#   e append-only și pentru postgres). Tokenurile deținătorilor sintetici (generate de trigger) stau doar în dosarul temporar al scriptului.
#   Istoricul schema_migrations al celor două versiuni (aplicarea + revenirea scriptului) se șterge la final, ca în probele coordonatorului.
#   Contorul red_rate_limit 'ip:necunoscut' (comun, expiră singur) NU se șterge; cheile 't:…' ale tokenurilor sintetice da.
# PAȘII și REZULTATELE AȘTEPTATE (fiecare verificare tipărește OK / NU; codurile de ieșire ale sesiunilor se păstrează, wait PID — L25):
#   S0 pregătirea (postgres, fără JWT, comis): P1, P2 cu DEFAULT-ul (VECHI); PA creat cu VECHI și schimbat ÎNAINTE de migrare VECHI -> NOU
#      fără JWT (contraexemplul a); PC cu text personalizat; UAT + parcelă + 3 deținători pe P1; un răspuns ISTORIC cu opțiunea retrasă (D2).
#   S1 sesiunea B (anon, ca PostgREST) cheamă fn_red_raspuns_public(D1, 'nu_particip_cu_obiectii') și ține tranzacția deschisă 4 s
#      → B întoarce {ok: true} (regula VECHE: RPC-ul a rulat înainte de migrare); B iese cu 0 după COMMIT; răspunsul lui rămâne (ca înainte de
#      migrare: „un răspuns inserat concurent înainte de COMMIT trece pe regula veche”).
#   S2 sesiunea C (anon) pornește înaintea aplicării, așteaptă (pg_locks) ca aplicarea să țină ACCESS EXCLUSIVE pe red_proiecte, apoi citește
#      formularul public (fn_red_formular_public, D3) → C AȘTEAPTĂ până la COMMIT-ul aplicării (nu dă eroare) și primește declarația NOUĂ;
#      C iese cu 0. (Dacă C vede declarația VECHE, înseamnă că instantaneul a fost luat înaintea așteptării: corect pentru utilizator, dar de
#      raportat; o altă eroare = NU.)
#   S3 aplicarea A prin RUNNER (livrare_migrare.sh, plafon 5000, amprenta globală + manifestul), cât B ține tranzacția deschisă și C așteaptă:
#      cod 0; „20261226a: lock la … (1 incercari, …)” — B nu ține nimic pe red_proiecte, deci nu oprește lock-ul; „declaratia: 2 proiecte
#      schimbate (… -1 v2; … -2 v2), 1 cu text personalizat neatinse; marcajul executiei …: livrare:20261226a_redari_predare_declaratie:<txid>”
#      (doar P1 și P2: PA are deja textul nou); APLICAT + ÎNREGISTRAT.
#   S4 după aplicare (doar citire + scrieri pe rolurile reale, comise ca la PostgREST):
#      rândurile: P1 / P2 = NOU, versiunea 2; PA = NOU, versiunea 2 (neatins de migrare); PC = text personalizat, versiunea 1; DEFAULT = NOU;
#      jurnalul: exact 2 rânduri cu marcajul execuției (P1, P2), user_id NULL, același marcaj; niciunul pe PA / PC;
#      anon prin RPC: opțiunea retrasă → {ok:false, motiv:'optiune_invalida'}, nimic scris; o opțiune necunoscută → același răspuns;
#        constatare_teren cu text → {ok:true};
#      authenticated EDITOR: INSERT cu opțiunea retrasă → 23514; INSERT constatare_teren → OK; UPDATE pe răspunsul istoric (obiecțiile) → OK,
#        opțiunea rămâne nu_particip_cu_obiectii; UPDATE al răspunsului constatare CĂTRE opțiunea retrasă → 23514;
#      authenticated OWNER: INSERT cu opțiunea retrasă → 23514; service_role: INSERT cu opțiunea retrasă (canal email) → 23514;
#      anon / authenticated: SELECT fn_red_optiune_retrasa(...) → 42501.
#   S5 contraexemplul (b) + salvarea unui om: PB creat DUPĂ aplicare cu VECHI explicit și schimbat apoi fără JWT la NOU (postgres); OWNER
#      redenumește P2 (versiunea 3).
#   S6 revenirea prin RUNNER (plafon 2000, fără amprentă globală): cod 0; „revenire: executia livrare:20261226a_redari_predare_declaratie:<txid>:
#      1 proiecte readuse la declaratia veche (… -1 v3); 1 proiecte ale executiei salvate intre timp, neatinse; N proiecte raman cu textul nou”;
#      P1 = VECHI (rândul lui de jurnal poartă marcajul revenirii …_ROLLBACK:<txid>); P2 (salvat de om), PA (contraexemplul a), PB
#      (contraexemplul b) = NOU, neatinse; PC neschimbat; DEFAULT = VECHI; fn_red_optiune_retrasa absentă.
#   S7 curățenia (trap, și la eroare): datele sintetice, jurnalul lor, cheile de token, istoricul celor două versiuni; nicio sesiune rămasă.
# Ieșire: 0 = toate OK; 1 = o verificare a picat; 2 = argumente; 22 = altă țintă; 23 = migrarea aplicată / istoric existent; 24 = owner /
#   editor lipsă; 25 = resturi ale unei rulări anterioare.
set -euo pipefail
PSQL="${PSQL:-psql}"
export PGCLIENTENCODING=UTF8
SISTEM="" H="" P="" U="" D="" MAN="" AG=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || { echo "optiunea $1 fara valoare" >&2; exit 2; }
  case "$1" in
    --sistem) SISTEM="$2" ;; --host) H="$2" ;; --port) P="$2" ;; --user) U="$2" ;; --db) D="$2" ;;
    --manifest) MAN="$2" ;; --amprenta-globala) AG="$2" ;;
    *) echo "argument necunoscut: $1" >&2; exit 2 ;;
  esac
  shift 2
done
[[ "$SISTEM" =~ ^[0-9]+$ ]] || { echo "lipseste --sistem <system_identifier al clonei>" >&2; exit 2; }
[ -n "$H" ] && [ -n "$P" ] && [ -n "$U" ] && [ -n "$D" ] || { echo "lipsesc --host / --port / --user / --db" >&2; exit 2; }
[ -f "$MAN" ] || { echo "lipseste --manifest <fisier .l15.tsv regenerat pe clona>" >&2; exit 2; }
[[ "$AG" =~ ^[0-9a-f]{32}$ ]] || { echo "lipseste --amprenta-globala <md5 al clonei>" >&2; exit 2; }
OWNER="${OWNER:-00000000-0000-4000-8000-000000000001}"
EDITOR="${EDITOR:-}"
[[ "$OWNER" =~ ^[0-9a-f-]{36}$ ]] || { echo "OWNER invalid" >&2; exit 2; }
[[ "$EDITOR" =~ ^[0-9a-f-]{36}$ ]] || { echo "EDITOR=<uuid> lipsa (profil sintetic cu redari = editor pe clona)" >&2; exit 2; }
MAN="$(cd "$(dirname "$MAN")" && pwd)/$(basename "$MAN")"
cd "$(dirname "$0")/../.."
MIG=supabase/migrations/20261226a_redari_predare_declaratie.sql
REV=supabase/revenire/20261226a_redari_predare_declaratie_ROLLBACK.sql
NUME_MIG=20261226a_redari_predare_declaratie; NUME_REV=20261226a_redari_predare_declaratie_ROLLBACK
VERS_MIG=20261226120000; VERS_REV=20261226120001
SHA_MIG="$(sha256sum "$MIG" | cut -d' ' -f1)"; SHA_REV="$(sha256sum "$REV" | cut -d' ' -f1)"
VECHI='Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.'
NOU='Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, electronic.'
CONN=(-h "$H" -p "$P" -U "$U" -d "$D")
TMP="$(mktemp -d ./.clona_20261226a.XXXXXX)"
APP_A=proba_predare_a; APP_B=proba_predare_b; APP_C=proba_predare_c
# id-urile sintetice (fixe; garda 25 cere să nu existe)
PR1=5e5e0000-0000-4000-8000-000000000001; PR2=5e5e0000-0000-4000-8000-000000000002; PRA=5e5e0000-0000-4000-8000-00000000000a
PRB=5e5e0000-0000-4000-8000-00000000000b; PRC=5e5e0000-0000-4000-8000-00000000000c
UAT=5e5e0000-0000-4000-8000-000000000101; PARC=5e5e0000-0000-4000-8000-000000000201
D1=5e5e0000-0000-4000-8000-000000000301; D2=5e5e0000-0000-4000-8000-000000000302; D3=5e5e0000-0000-4000-8000-000000000303
R_OLD=5e5e0000-0000-4000-8000-000000000401
IDS="'$PR1','$PR2','$PRA','$PRB','$PRC','$UAT','$PARC','$D1','$D2','$D3','$R_OLD'"
PIDS=(); TINTA_OK=0; APLICAT=0; REVENIT=0; ESEC=0
# SQL-ul pleacă pe stdin, nu ca argument (-c): pe Windows (Git Bash -> psql.exe) argumentele cu diacritice sunt trecute prin pagina de cod a
# sistemului și ajung alterate, deci comparațiile cu textele VECHI / NOU dădeau „ALT” deși rândurile erau corecte (prima rulare pe clonă).
q() { printf '%s\n' "$1" | "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f -; }
qf() { "$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$1"; }
ok() { if [ "$1" = "$2" ]; then echo "  OK  $3"; else echo "  NU  $3: obtinut [$1], asteptat [$2]"; ESEC=1; fi; }
okre() { if printf '%s' "$1" | grep -Eq -- "$2"; then echo "  OK  $3"; else echo "  NU  $3: [$(printf '%s' "$1" | head -c 400)] nu se potriveste cu /$2/"; ESEC=1; fi; }
gata_pid() { local p r=(); for p in "${PIDS[@]+"${PIDS[@]}"}"; do [ "$p" = "$1" ] || r+=("$p"); done; PIDS=("${r[@]+"${r[@]}"}"); }
curatenie() {
  local rc=$?
  for p in "${PIDS[@]+"${PIDS[@]}"}"; do kill "$p" 2>/dev/null || true; done
  if [ "$TINTA_OK" = 1 ]; then
    q "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name IN ('$APP_A', '$APP_B', '$APP_C') AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
    for p in "${PIDS[@]+"${PIDS[@]}"}"; do wait "$p" 2>/dev/null || true; done
    if [ "$APLICAT" = 1 ] && [ "$REVENIT" = 0 ]; then
      echo "ATENTIE: migrarea a ramas APLICATA pe clona (revenirea n-a reusit): datele sintetice raman pentru analiza; revenirea + curatenia manual" >&2
    else
      cat >"$TMP/curata.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
ALTER TABLE public.red_jurnal DISABLE TRIGGER USER; ALTER TABLE public.red_raspunsuri_meta DISABLE TRIGGER USER;
ALTER TABLE public.red_raspunsuri DISABLE TRIGGER USER; ALTER TABLE public.red_detinatori_token DISABLE TRIGGER USER;
ALTER TABLE public.red_detinatori DISABLE TRIGGER USER; ALTER TABLE public.red_parcele DISABLE TRIGGER USER;
ALTER TABLE public.red_uat DISABLE TRIGGER USER; ALTER TABLE public.red_proiecte DISABLE TRIGGER USER;
CREATE TEMP TABLE z_rasp ON COMMIT DROP AS SELECT id FROM public.red_raspunsuri WHERE detinator_id IN ('$D1', '$D2', '$D3');
DELETE FROM public.red_rate_limit WHERE cheie IN (SELECT 't:' || encode(sha256(convert_to(t.token_raspuns, 'UTF8')), 'hex') FROM public.red_detinatori_token t
                                                   WHERE t.detinator_id IN ('$D1', '$D2', '$D3'));
DELETE FROM public.red_jurnal WHERE inregistrare_id IN ($IDS) OR inregistrare_id IN (SELECT id FROM z_rasp);
DELETE FROM public.red_raspunsuri_meta WHERE raspuns_id IN (SELECT id FROM z_rasp);
DELETE FROM public.red_raspunsuri WHERE id IN (SELECT id FROM z_rasp);
DELETE FROM public.red_detinatori_token WHERE detinator_id IN ('$D1', '$D2', '$D3');
DELETE FROM public.red_detinatori WHERE id IN ('$D1', '$D2', '$D3');
DELETE FROM public.red_parcele WHERE id = '$PARC';
DELETE FROM public.red_uat WHERE id = '$UAT';
DELETE FROM public.red_proiecte WHERE id IN ('$PR1', '$PR2', '$PRA', '$PRB', '$PRC');
ALTER TABLE public.red_proiecte ENABLE TRIGGER USER; ALTER TABLE public.red_uat ENABLE TRIGGER USER;
ALTER TABLE public.red_parcele ENABLE TRIGGER USER; ALTER TABLE public.red_detinatori ENABLE TRIGGER USER;
ALTER TABLE public.red_detinatori_token ENABLE TRIGGER USER; ALTER TABLE public.red_raspunsuri ENABLE TRIGGER USER;
ALTER TABLE public.red_raspunsuri_meta ENABLE TRIGGER USER; ALTER TABLE public.red_jurnal ENABLE TRIGGER USER;
DELETE FROM supabase_migrations.schema_migrations WHERE (version, name) IN (('$VERS_MIG', '$NUME_MIG'), ('$VERS_REV', '$NUME_REV'));
COMMIT;
SQL
      if qf "$TMP/curata.sql" >/dev/null; then echo "curatenie: datele sintetice, jurnalul lor si istoricul $VERS_MIG / $VERS_REV sterse"
      else echo "ATENTIE: curatenia a picat; de sters manual pe clona id-urile 5e5e0000-… si istoricul $VERS_MIG / $VERS_REV" >&2; fi
    fi
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap curatenie EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── gărzile ──
REAL="$(q "SELECT system_identifier FROM pg_control_system()")"
[ "$REAL" = "$SISTEM" ] || { echo "REFUZ: system_identifier al bazei ($REAL) <> --sistem ($SISTEM)" >&2; exit 22; }
[ "$(q "SELECT to_regprocedure('public.fn_red_optiune_retrasa(text)') IS NULL
          AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('$VERS_MIG', '$VERS_REV') OR name IN ('$NUME_MIG', '$NUME_REV'))")" = t ] \
  || { echo "REFUZ: 20261226a pare aplicata sau are istoric pe clona (proba cere migrarea NEAPLICATA)" >&2; exit 23; }
[ "$(q "SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$OWNER' AND is_owner IS TRUE)
          AND EXISTS (SELECT 1 FROM public.user_module_access WHERE profile_id = '$EDITOR' AND module = 'redari' AND access_level = 'editor')
          AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '$EDITOR' AND is_owner IS TRUE)")" = t ] \
  || { echo "REFUZ: OWNER ($OWNER, is_owner) sau EDITOR ($EDITOR, redari = editor, ne-owner) lipsesc de pe clona" >&2; exit 24; }
TINTA_OK=1
[ "$(q "SELECT NOT EXISTS (SELECT 1 FROM public.red_proiecte WHERE id IN ($IDS) OR cod LIKE 'TEST-PREDARE-SINT-%')
          AND NOT EXISTS (SELECT 1 FROM public.red_detinatori WHERE id IN ($IDS))")" = t ] \
  || { TINTA_OK=0; echo "REFUZ: resturi ale unei rulari anterioare (id-uri 5e5e0000-… / TEST-PREDARE-SINT-%): curatati intai" >&2; exit 25; }
OID_PR="$(q "SELECT 'public.red_proiecte'::regclass::oid")"

# ── S0 pregătirea (postgres, fără JWT, comis) ──
echo "S0 pregatirea datelor sintetice"
cat >"$TMP/s0.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.red_proiecte (id, cod, denumire) VALUES ('$PR1', 'TEST-PREDARE-SINT-1', 'Proba sintetica 1'),
  ('$PR2', 'TEST-PREDARE-SINT-2', 'Proba sintetica 2'), ('$PRA', 'TEST-PREDARE-SINT-A', 'Contraexemplul a');
INSERT INTO public.red_proiecte (id, cod, denumire, text_declaratie) VALUES ('$PRC', 'TEST-PREDARE-SINT-C', 'Text propriu', 'Text personalizat (proba sintetica).');
-- contraexemplul (a): VECHI -> NOU fără JWT, ÎNAINTE de migrare
UPDATE public.red_proiecte SET text_declaratie = '$NOU' WHERE id = '$PRA';
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, program_zi1) VALUES ('$UAT', '$PR1', 'Sinteticeni', 'ZZQ', current_date + 10, '09:00-15:00');
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('$PARC', '$PR1', '$UAT', 'ZZQ-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume, nume_normalizat, calitate) VALUES
  ('$D1', '$PARC', 'Persoana Sintetica Unu', 'PERSOANA SINTETICA UNU', 'proprietar'),
  ('$D2', '$PARC', 'Persoana Sintetica Doi', 'PERSOANA SINTETICA DOI', 'proprietar'),
  ('$D3', '$PARC', 'Persoana Sintetica Trei', 'PERSOANA SINTETICA TREI', 'proprietar');
-- răspunsul ISTORIC cu opțiunea retrasă (regula veche), pe D2
INSERT INTO public.red_raspunsuri (id, detinator_id, canal, optiune, obiectii_text) VALUES ('$R_OLD', '$D2', 'telefon', 'nu_particip_cu_obiectii', 'Obiectie sintetica veche');
COMMIT;
SQL
qf "$TMP/s0.sql" >/dev/null
tok() { q "SELECT token_raspuns FROM public.red_detinatori_token WHERE detinator_id = '$1'"; }
TOK1="$(tok "$D1")"; TOK3="$(tok "$D3")"
[[ "$TOK1" =~ ^[A-Za-z0-9_-]{43}$ ]] && [[ "$TOK3" =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo "tokenurile sintetice lipsesc" >&2; exit 1; }
ok "$(q "SELECT string_agg(cod || '=' || CASE text_declaratie WHEN '$VECHI' THEN 'VECHI' WHEN '$NOU' THEN 'NOU' ELSE 'ALT' END || '/v' || versiune, ' ' ORDER BY cod)
           FROM public.red_proiecte WHERE id IN ($IDS)")" \
   "TEST-PREDARE-SINT-1=VECHI/v1 TEST-PREDARE-SINT-2=VECHI/v1 TEST-PREDARE-SINT-A=NOU/v2 TEST-PREDARE-SINT-C=ALT/v1" "S0 starea de pornire"

# ── S1 / S2 / S3: B (răspuns public în curs), C (formularul cât e ținut lock-ul), A (aplicarea prin runner) ──
echo "S1-S3 aplicarea prin runner cu doua sesiuni concurente"
cat >"$TMP/b.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_B';
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) AS _c \\gset
SELECT 'B_RPC ' || public.fn_red_raspuns_public('$TOK1', 'nu_particip_cu_obiectii', NULL, 'Obiectie sintetica in curs', NULL, 'proba-clona')::text;
SELECT pg_sleep(4);
COMMIT;
SQL
cat >"$TMP/c.sql" <<SQL
\\set ON_ERROR_STOP 1
SET application_name = '$APP_C';
DO \$c\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
  LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks l WHERE l.relation = $OID_PR AND l.mode = 'AccessExclusiveLock' AND l.granted AND l.pid <> pg_backend_pid());
    IF clock_timestamp() > t0 + interval '60 seconds' THEN RAISE EXCEPTION 'C: lock-ul aplicarii pe red_proiecte nu a aparut in 60 s'; END IF;
    PERFORM pg_sleep(0.002);
  END LOOP; END \$c\$;
SELECT set_config('proba.t0', clock_timestamp()::text, false) AS _t \\gset
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) AS _c \\gset
SELECT 'C_FORMULAR ' || CASE public.fn_red_formular_public('$TOK3') ->> 'text_declaratie' WHEN '$NOU' THEN 'NOU' WHEN '$VECHI' THEN 'VECHI' ELSE 'ALT' END;
COMMIT;
SELECT 'C_ASTEPTAT_MS ' || round(extract(epoch FROM clock_timestamp() - current_setting('proba.t0')::timestamptz) * 1000);
SQL
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/c.sql" >"$TMP/c.log" 2>&1 &
PID_C=$!; PIDS+=("$PID_C")
"$PSQL" -X -q -At -v ON_ERROR_STOP=1 "${CONN[@]}" -f "$TMP/b.sql" >"$TMP/b.log" 2>&1 &
PID_B=$!; PIDS+=("$PID_B")
# bariera: B a terminat RPC-ul și ține tranzacția (pg_sleep), C așteaptă lock-ul
q "DO \$b\$ DECLARE i int := 0; BEGIN
     LOOP
       PERFORM pg_stat_clear_snapshot();
       EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_B' AND state = 'active' AND query LIKE 'SELECT pg_sleep(4)%')
             AND EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '$APP_C' AND state = 'active');
       PERFORM pg_sleep(0.02); i := i + 1;
       IF i > 500 THEN RAISE EXCEPTION 'bariera: B (RPC + tranzactie deschisa) sau C (asteptarea) nu au aparut'; END IF;
     END LOOP; END \$b\$;" >/dev/null
RC_A=0
PGAPPNAME="$APP_A" PSQL_BIN="$PSQL" bash scripts/livrare_migrare.sh --migrare "$MIG" --sha256 "$SHA_MIG" --versiune "$VERS_MIG" \
  --tinta-db "$D" --tinta-sistem "$SISTEM" --tinta-host "$H" --tinta-port "$P" --user "$U" --plafon-tranzactie-ms 5000 \
  --amprenta-globala "$AG" --diferente-globale "$MAN" >"$TMP/a.log" 2>&1 || RC_A=$?
[ "$RC_A" = 0 ] && APLICAT=1
RC_B=0; wait "$PID_B" || RC_B=$?; gata_pid "$PID_B"
RC_C=0; wait "$PID_C" || RC_C=$?; gata_pid "$PID_C"
ok "$RC_A" 0 "S3 aplicarea prin runner: cod 0"
[ "$RC_A" = 0 ] || sed 's/^/     a| /' "$TMP/a.log"
okre "$(cat "$TMP/a.log")" '20261226a: lock la [0-9]+ ms de la BEGIN \(1 incercari' "S3 lock-ul obtinut la prima incercare (B nu tine red_proiecte)"
okre "$(cat "$TMP/a.log")" 'declaratia: 2 proiecte schimbate \(id cod versiune: [^)]*TEST-PREDARE-SINT-1 v2; [^)]*TEST-PREDARE-SINT-2 v2\), [0-9]+ cu text personalizat neatinse; marcajul executiei in red_jurnal\.user_email: livrare:20261226a_redari_predare_declaratie:[0-9]+' "S3 NOTICE-ul evidentei (doar P1, P2; marcajul)"
okre "$(cat "$TMP/a.log")" 'APLICAT \+ ÎNREGISTRAT' "S3 aplicat + inregistrat"
ok "$RC_B" 0 "S1 sesiunea B: cod 0"
okre "$(cat "$TMP/b.log")" 'B_RPC \{"ok": true' "S1 B: RPC-ul inceput inainte de migrare a primit {ok: true} (regula veche)"
ok "$(q "SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = '$D1' AND optiune = 'nu_particip_cu_obiectii'")" 1 "S1 raspunsul lui B (regula veche) a ramas, comis dupa aplicare"
ok "$RC_C" 0 "S2 sesiunea C: cod 0 (a asteptat, fara eroare)"
[ "$RC_C" = 0 ] || sed 's/^/     c| /' "$TMP/c.log"
okre "$(cat "$TMP/c.log")" 'C_FORMULAR NOU' "S2 C: formularul citit dupa COMMIT arata declaratia NOUA"
echo "     C a asteptat: $(grep -o 'C_ASTEPTAT_MS [0-9]*' "$TMP/c.log" || echo '?') (citirea pornita cat aplicarea tinea lock-ul)"
[ "$APLICAT" = 1 ] || { echo "aplicarea a picat: restul pasilor nu au sens" >&2; exit 1; }

# ── S4 după aplicare ──
echo "S4 dupa aplicare: randurile, jurnalul, rolurile reale"
ok "$(q "SELECT string_agg(cod || '=' || CASE text_declaratie WHEN '$VECHI' THEN 'VECHI' WHEN '$NOU' THEN 'NOU' ELSE 'ALT' END || '/v' || versiune, ' ' ORDER BY cod)
           FROM public.red_proiecte WHERE id IN ($IDS)")" \
   "TEST-PREDARE-SINT-1=NOU/v2 TEST-PREDARE-SINT-2=NOU/v2 TEST-PREDARE-SINT-A=NOU/v2 TEST-PREDARE-SINT-C=ALT/v1" "S4 randurile"
ok "$(q "SELECT pg_get_expr(d.adbin, d.adrelid) = quote_literal('$NOU') || '::text' FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie'")" t "S4 DEFAULT-ul = NOU"
ok "$(q "SELECT count(*) || '/' || count(DISTINCT user_email) || '/' || count(*) FILTER (WHERE user_id IS NULL) || '/' || string_agg(CASE inregistrare_id WHEN '$PR1' THEN 'P1' WHEN '$PR2' THEN 'P2' ELSE 'ALT' END, ',' ORDER BY inregistrare_id)
           FROM public.red_jurnal WHERE tabela = 'red_proiecte' AND inregistrare_id IN ($IDS) AND user_email ~ '^livrare:20261226a_redari_predare_declaratie:[0-9]+\$'")" \
   "2/1/2/P1,P2" "S4 jurnalul: 2 randuri cu acelasi marcaj al executiei, fara utilizator, doar P1 si P2"
# un apel ca rolul real (PostgREST): ROLE + claims în ambele surse; tipărește „OK <valoare>” sau „ERR <SQLSTATE>”
N_APEL=0
ca() {
  local rol="$1" uid="$2" sql="$3" claims f rc=0 out
  N_APEL=$((N_APEL + 1)); f="$TMP/apel_$N_APEL.sql"
  if [ "$uid" = - ]; then claims="{\"role\":\"$rol\"}"; else claims="{\"sub\":\"$uid\",\"role\":\"$rol\"}"; fi
  {
    printf '%s\n' '\set ON_ERROR_STOP 1' 'BEGIN;' "SET LOCAL ROLE $rol;"
    printf '%s\n' "SELECT set_config('request.jwt.claims', '$claims', true) AS _c, set_config('request.jwt.claim.sub', '$([ "$uid" = - ] || printf '%s' "$uid")', true) AS _s \\gset"
    printf '%s\n' "$sql" 'COMMIT;'
  } >"$f"
  out="$("$PSQL" -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "${CONN[@]}" -f "$f" 2>"$f.err")" || rc=$?
  if [ "$rc" = 0 ]; then printf 'OK %s' "$out"; else printf 'ERR %s' "$(grep -oE 'ERROR:  [0-9A-Z]{5}' "$f.err" | head -n 1 | cut -c9-)"; fi
}
N3="$(q "SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = '$D3'")"
ok "$(ca anon - "SELECT public.fn_red_raspuns_public('$TOK3', 'nu_particip_cu_obiectii', NULL, 'x', NULL, 'proba') ->> 'motiv';")" "OK optiune_invalida" "S4 anon RPC: optiunea retrasa -> optiune_invalida"
ok "$(ca anon - "SELECT public.fn_red_raspuns_public('$TOK3', 'xyz', NULL, 'x', NULL, 'proba') ->> 'motiv';")" "OK optiune_invalida" "S4 anon RPC: optiune necunoscuta -> acelasi refuz (fara oracol)"
ok "$(q "SELECT count(*) FROM public.red_raspunsuri WHERE detinator_id = '$D3'")" "$N3" "S4 anon RPC: nimic scris la refuz"
ok "$(ca anon - "SELECT public.fn_red_raspuns_public('$TOK3', 'constatare_teren', NULL, 'Cer constatare (sintetic)', NULL, 'proba') ->> 'ok';")" "OK true" "S4 anon RPC: constatare_teren -> ok (calea legitima)"
ok "$(ca authenticated "$EDITOR" "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'telefon', 'nu_particip_cu_obiectii', 'x') RETURNING optiune;")" "ERR 23514" "S4 editor: INSERT cu optiunea retrasa -> 23514"
ok "$(ca authenticated "$EDITOR" "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'telefon', 'constatare_teren', 'Constatare sintetica') RETURNING optiune;")" "OK constatare_teren" "S4 editor: INSERT constatare_teren -> OK"
ok "$(ca authenticated "$EDITOR" "UPDATE public.red_raspunsuri SET obiectii_text = 'Obiectie sintetica corectata' WHERE id = '$R_OLD' RETURNING optiune;")" "OK nu_particip_cu_obiectii" "S4 editor: corectarea raspunsului istoric -> OK, optiunea ramane"
ok "$(ca authenticated "$EDITOR" "UPDATE public.red_raspunsuri SET optiune = 'nu_particip_cu_obiectii' WHERE id = (SELECT id FROM public.red_raspunsuri WHERE detinator_id = '$D3' AND canal = 'telefon' ORDER BY seq DESC LIMIT 1) RETURNING optiune;")" "ERR 23514" "S4 editor: UPDATE catre optiunea retrasa -> 23514"
ok "$(ca authenticated "$OWNER" "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'scris', 'nu_particip_cu_obiectii', 'x') RETURNING optiune;")" "ERR 23514" "S4 owner: INSERT cu optiunea retrasa -> 23514"
ok "$(ca service_role - "INSERT INTO public.red_raspunsuri (detinator_id, canal, optiune, obiectii_text) VALUES ('$D3', 'email', 'nu_particip_cu_obiectii', 'x') RETURNING optiune;")" "ERR 23514" "S4 service_role: INSERT cu optiunea retrasa (canal email) -> 23514"
ok "$(ca anon - "SELECT public.fn_red_optiune_retrasa('particip');")" "ERR 42501" "S4 anon: fn_red_optiune_retrasa -> 42501"
ok "$(ca authenticated "$OWNER" "SELECT public.fn_red_optiune_retrasa('particip');")" "ERR 42501" "S4 authenticated: fn_red_optiune_retrasa -> 42501"

# ── S5 contraexemplul (b) + salvarea unui om ──
echo "S5 contraexemplul (b) si salvarea unui om"
cat >"$TMP/s5.sql" <<SQL
\\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.red_proiecte (id, cod, denumire, text_declaratie) VALUES ('$PRB', 'TEST-PREDARE-SINT-B', 'Contraexemplul b', '$VECHI');
UPDATE public.red_proiecte SET text_declaratie = '$NOU' WHERE id = '$PRB';
COMMIT;
SQL
qf "$TMP/s5.sql" >/dev/null
ok "$(ca authenticated "$OWNER" "UPDATE public.red_proiecte SET denumire = 'Redenumit de om (sintetic)' WHERE id = '$PR2' RETURNING versiune;")" "OK 3" "S5 owner redenumeste P2 (versiunea 3)"

# ── S6 revenirea prin runner ──
echo "S6 revenirea prin runner"
RC_R=0
PGAPPNAME="$APP_A" PSQL_BIN="$PSQL" bash scripts/livrare_migrare.sh --migrare "$REV" --sha256 "$SHA_REV" --versiune "$VERS_REV" \
  --tinta-db "$D" --tinta-sistem "$SISTEM" --tinta-host "$H" --tinta-port "$P" --user "$U" --plafon-tranzactie-ms 2000 >"$TMP/r.log" 2>&1 || RC_R=$?
[ "$RC_R" = 0 ] && REVENIT=1
ok "$RC_R" 0 "S6 revenirea prin runner: cod 0"
[ "$RC_R" = 0 ] || sed 's/^/     r| /' "$TMP/r.log"
okre "$(cat "$TMP/r.log")" 'revenire: executia livrare:20261226a_redari_predare_declaratie:[0-9]+: 1 proiecte readuse la declaratia veche \(id cod versiune: [^)]*TEST-PREDARE-SINT-1 v3\); 1 proiecte ale executiei salvate intre timp, neatinse; [0-9]+ proiecte raman cu textul nou' "S6 NOTICE-ul revenirii"
ok "$(q "SELECT string_agg(cod || '=' || CASE text_declaratie WHEN '$VECHI' THEN 'VECHI' WHEN '$NOU' THEN 'NOU' ELSE 'ALT' END, ' ' ORDER BY cod)
           FROM public.red_proiecte WHERE id IN ($IDS)")" \
   "TEST-PREDARE-SINT-1=VECHI TEST-PREDARE-SINT-2=NOU TEST-PREDARE-SINT-A=NOU TEST-PREDARE-SINT-B=NOU TEST-PREDARE-SINT-C=ALT" \
   "S6 P1 readus; P2 (salvat de om), A si B (contraexemplele) neatinse; C neschimbat"
ok "$(q "SELECT user_id IS NULL AND user_email ~ '^livrare:20261226a_redari_predare_declaratie_ROLLBACK:[0-9]+\$' FROM public.red_jurnal
          WHERE tabela = 'red_proiecte' AND inregistrare_id = '$PR1' ORDER BY id DESC LIMIT 1")" t "S6 randul de jurnal al revenirii pe P1 poarta marcajul ei"
ok "$(q "SELECT to_regprocedure('public.fn_red_optiune_retrasa(text)') IS NULL AND (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = 'public.red_proiecte'::regclass AND a.attname = 'text_declaratie') = quote_literal('$VECHI') || '::text'")" t "S6 functia noua scoasa, DEFAULT-ul = VECHI"
ok "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('$APP_A', '$APP_B', '$APP_C')")" 0 "S7 nicio sesiune a probei ramasa"

[ "$ESEC" = 0 ] && echo "PASS: proba pe clona 20261226a" || echo "ESEC: cel putin o verificare a picat (vezi NU mai sus)"
exit "$ESEC"
