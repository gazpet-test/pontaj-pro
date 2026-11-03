#!/usr/bin/env bash
# ============================================================================
# Concurență reală (două conexiuni) pe 20261130a_sms_mvp — EXCLUSIV pe un PostgreSQL 17 local de unică folosință.
# Nu atinge producția. DRY-ul (o singură tranzacție) nu poate testa două sesiuni; aici fiecare scenariu are o conexiune A care ține
# tranzacția deschisă (pg_sleep) și o conexiune B pornită între timp:
#   P  plafon: consum 199/200, două rezervări simultane pe DOUĂ loturi diferite (lock-ul pe lot nu le serializează, doar cel pe
#      setări) → în total maximum 200, niciun mesaj rezervat de două ori (Copilot r1 P3-03)
#   D1 DLR în tranzacția A, rezultatul trimiterii în B → B așteaptă lock-ul consultativ și aplică DLR-ul (Jakarinos r1 P2)
#   D2 rezultatul în A, DLR-ul în B → B așteaptă și găsește id-ul de la furnizor (Jakarinos r1 P2)
#   O  opt-out în A (owner), rezervarea în B → B așteaptă setările și NU rezervă numărul cu opt-out (Copilot r1 P2-02)
# Date: doar fictive (numere 0700…). Utilizare:
#   PG_BIN=/c/Users/Public/pgsql/bin bash scripts/test_sms_concurenta.sh            (Windows / Git Bash)
#   bash scripts/test_sms_concurenta.sh                                             (Linux, PG17 în /usr/lib/postgresql/17/bin)
#   MIGRARE=<copie mutantă .sql> … → același test pe o variantă (trebuie să pice)
# Ieșire: 0 = toate scenariile PASS · 1 = cel puțin un FAIL · 2 = mediu (PG lipsă / pornire eșuată).
# ============================================================================
set -uo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/17/bin}"
PORT="${PGPORT_TEST:-5982}"
MIGRARE="${MIGRARE:-$RADACINA/supabase/migrations/20261130a_sms_mvp.sql}"
SCHELET="$RADACINA/supabase/tests/20261130a_sms_mvp_schelet.sql"
EXE=""; [ -x "$PG_BIN/psql.exe" ] && EXE=".exe"
[ -x "$PG_BIN/initdb$EXE" ] || { echo "MEDIU: PG17 lipsă ($PG_BIN)" >&2; exit 2; }
LUCRU="$(mktemp -d)"
DATE_DIR="$LUCRU/pg"
OWNER='00000000-0000-0000-0000-0000000000a1'
CLAIM_OWNER="{\"sub\":\"$OWNER\",\"role\":\"authenticated\"}"
PSQL=("$PG_BIN/psql$EXE" -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres -d sms_conc)
export PGCLIENTENCODING=UTF8
cale_psql() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
opreste() { "$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; rm -rf "$LUCRU"; }
trap opreste EXIT

"$PG_BIN/initdb$EXE" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null 2>&1 || { echo "MEDIU: initdb" >&2; exit 2; }
"$PG_BIN/pg_ctl$EXE" -D "$DATE_DIR" -l "$LUCRU/pg.log" -w -t 30 start -o "-p $PORT -c listen_addresses=127.0.0.1" >/dev/null || { echo "MEDIU: pg_ctl start" >&2; exit 2; }
"$PG_BIN/psql$EXE" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "CREATE DATABASE sms_conc" >/dev/null || exit 2
"${PSQL[@]}" -f "$SCHELET" >/dev/null || { echo "MEDIU: schelet" >&2; exit 2; }
cat > "$LUCRU/aplica.sql" <<SQL
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.livrare_migrare', '20261130a_sms_mvp:' || txid_current(), true) IS NOT NULL;
\i $(cale_psql "$MIGRARE")
COMMIT;
SQL
"${PSQL[@]}" -f "$LUCRU/aplica.sql" >/dev/null || { echo "MEDIU: migrarea nu s-a aplicat" >&2; exit 2; }

q() { "${PSQL[@]}" -c "$1"; }
ca_owner() { printf "SELECT set_config('request.jwt.claims', '%s', true) IS NOT NULL;\nSET LOCAL ROLE authenticated;\n" "$CLAIM_OWNER"; }
ca_serviciu() { printf "SET LOCAL ROLE service_role;\n"; }
ver_setari() { q "SELECT versiune FROM public.sms_setari"; }
# lot_fictiv <text unic> <primul numar, 6 cifre> <cate> → id-ul lotului (draft, mesaje fictive +40700xxxxxx)
lot_fictiv() {
  q "DO \$\$ DECLARE v uuid; BEGIN
       INSERT INTO public.sms_loturi (categorie, text, nr_destinatari, segmente, cost_estimat_eur) VALUES ('intern', '$1', $3, 1, round($3 * 0.049, 3)) RETURNING id INTO v;
       INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
       SELECT v, '+40700' || lpad((g + $2)::text, 6, '0'), 'angajat', 'fictiv-' || g FROM generate_series(0, $3 - 1) g;
     END \$\$;" >/dev/null
  q "SELECT id FROM public.sms_loturi WHERE text = '$1'"
}
ca_owner_ruleaza() { { echo "BEGIN;"; ca_owner; echo "$1"; echo "COMMIT;"; } | "${PSQL[@]}" -f - | tail -n 1; }
ca_serviciu_ruleaza() { { echo "BEGIN;"; ca_serviciu; echo "$1"; echo "COMMIT;"; } | "${PSQL[@]}" -f - | tail -n 1; }
EROARE=0
rezultat() { if [ "$2" = "$3" ]; then echo "PASS $1 ($2)"; else echo "FAIL $1: obținut '$2', așteptat '$3'"; EROARE=1; fi; }

# --- pregătire: loturile P (205 mesaje) și P2 (5), aprobate de owner, trimiterea pornită, consum 199 din 200 -------------------
LOT_P="$(lot_fictiv 'Test concurenta P (fictiv)' 1 205)"
LOT_P2="$(lot_fictiv 'Test concurenta P2 (fictiv)' 200001 5)"
ca_owner_ruleaza "SELECT public.fn_sms_lot_aproba('$LOT_P', 1) IS NOT NULL;" >/dev/null
ca_owner_ruleaza "SELECT public.fn_sms_lot_aproba('$LOT_P2', 1) IS NOT NULL;" >/dev/null
ca_owner_ruleaza "SELECT public.fn_sms_setari_salveaza(false, 199, 1500, $(ver_setari)) IS NOT NULL;" >/dev/null
for _ in 1 2 3 4 5; do ca_serviciu_ruleaza "SELECT public.fn_sms_rezerva('$LOT_P', 50, 'simulator') IS NOT NULL;" >/dev/null; done
rezultat "P0 pregatire: consum 199" "$(q "SELECT count(*) FROM public.sms_mesaje WHERE rezervat_la IS NOT NULL")" "199"
ca_owner_ruleaza "SELECT public.fn_sms_setari_salveaza(false, 200, 1500, $(ver_setari)) IS NOT NULL;" >/dev/null

# --- P: două rezervări simultane la 199/200: A pe lotul P, B pe lotul P2 ------------------------------------------------------
{ echo "BEGIN;"; ca_serviciu; echo "SELECT jsonb_array_length(public.fn_sms_rezerva('$LOT_P', 5, 'simulator')->'mesaje');"; echo "SELECT pg_sleep(3);"; echo "COMMIT;"; } \
  | "${PSQL[@]}" -f - > "$LUCRU/P_A.out" 2>&1 &
PID_A=$!
sleep 1
{ echo "BEGIN;"; ca_serviciu; echo "SELECT jsonb_array_length(public.fn_sms_rezerva('$LOT_P2', 5, 'simulator')->'mesaje');"; echo "COMMIT;"; } \
  | "${PSQL[@]}" -f - > "$LUCRU/P_B.out" 2>&1
wait "$PID_A"
N_A="$(grep -E '^[0-9]+$' "$LUCRU/P_A.out" | head -n 1)"; N_B="$(grep -E '^[0-9]+$' "$LUCRU/P_B.out" | head -n 1)"
rezultat "P rezervate de A + B" "$(( ${N_A:-0} + ${N_B:-0} ))" "1"
rezultat "P total rezervat azi (plafon 200)" "$(q "SELECT count(*) FROM public.sms_mesaje WHERE rezervat_la IS NOT NULL")" "200"
rezultat "P niciun mesaj rezervat de doua ori (necunoscut = rezervat)" \
  "$(q "SELECT count(*) = count(DISTINCT id) AND count(*) = 200 FROM public.sms_mesaje WHERE stare = 'necunoscut'")" "t"

# --- D1 / D2: DLR și rezultatul trimiterii pentru același id, în două conexiuni ------------------------------------------------
M1="$(q "SELECT id FROM public.sms_mesaje WHERE lot_id = '$LOT_P' AND stare = 'necunoscut' ORDER BY id LIMIT 1")"
M2="$(q "SELECT id FROM public.sms_mesaje WHERE lot_id = '$LOT_P' AND stare = 'necunoscut' ORDER BY id OFFSET 1 LIMIT 1")"
{ echo "BEGIN;"; ca_serviciu; echo "SELECT public.fn_sms_dlr_aplica('simulator', 'sim-conc-1', true, now());"; echo "SELECT pg_sleep(3);"; echo "COMMIT;"; } \
  | "${PSQL[@]}" -f - > "$LUCRU/D1_A.out" 2>&1 &
PID_A=$!
sleep 1
R_B="$(ca_serviciu_ruleaza "SELECT public.fn_sms_rezultat('$M1', true, 'sim-conc-1', NULL, NULL);")"
wait "$PID_A"
rezultat "D1 rezultatul (B) a vazut DLR-ul din A" "$R_B" "trimis_livrat"
rezultat "D1 mesaj livrat" "$(q "SELECT stare FROM public.sms_mesaje WHERE id = '$M1'")" "livrat"
{ echo "BEGIN;"; ca_serviciu; echo "SELECT public.fn_sms_rezultat('$M2', true, 'sim-conc-2', NULL, NULL);"; echo "SELECT pg_sleep(3);"; echo "COMMIT;"; } \
  | "${PSQL[@]}" -f - > "$LUCRU/D2_A.out" 2>&1 &
PID_A=$!
sleep 1
R_B="$(ca_serviciu_ruleaza "SELECT public.fn_sms_dlr_aplica('simulator', 'sim-conc-2', true, now());")"
wait "$PID_A"
rezultat "D2 DLR-ul (B) a gasit id-ul scris de A" "$R_B" "aplicat"
rezultat "D2 mesaj livrat" "$(q "SELECT stare FROM public.sms_mesaje WHERE id = '$M2'")" "livrat"

# --- O: opt-out (owner, A) și rezervarea (B) ------------------------------------------------------------------------------
LOT_O="$(lot_fictiv 'Test concurenta O (fictiv)' 100001 3)"
ca_owner_ruleaza "SELECT public.fn_sms_lot_aproba('$LOT_O', 1) IS NOT NULL;" >/dev/null
ca_owner_ruleaza "SELECT public.fn_sms_setari_salveaza(false, 500, 1500, $(ver_setari)) IS NOT NULL;" >/dev/null
{ echo "BEGIN;"; ca_owner; echo "SELECT public.fn_sms_optout_seteaza('0700100002', true, 'concurenta') IS NOT NULL;"; echo "SELECT pg_sleep(3);"; echo "COMMIT;"; } \
  | "${PSQL[@]}" -f - > "$LUCRU/O_A.out" 2>&1 &
PID_A=$!
sleep 1
N_B="$(ca_serviciu_ruleaza "SELECT jsonb_array_length(public.fn_sms_rezerva('$LOT_O', 5, 'simulator')->'mesaje');")"
wait "$PID_A"
rezultat "O rezervate (fara numarul cu opt-out)" "$N_B" "2"
rezultat "O numarul cu opt-out nu pleaca" "$(q "SELECT stare || '/' || coalesce(cod_eroare, '') FROM public.sms_mesaje WHERE lot_id = '$LOT_O' AND telefon = '+40700100002'")" "anulat/optout"

[ "$EROARE" = 0 ] && echo "TOATE SCENARIILE PASS" || echo "CEL PUTIN UN SCENARIU FAIL"
exit "$EROARE"
