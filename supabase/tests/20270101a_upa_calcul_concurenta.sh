#!/usr/bin/env bash
# Proba în DOUĂ sesiuni reale (20270101a, runda 3, P1-1 din review-ul PR #1154): închiderea calculului NU acceptă pontaj devenit incomplet
# între citirea calculului și reverificarea de după scriere.
#   Bariera (fără sleep ca barieră): un trigger de probă AFTER INSERT pe upa_calcul_lunar ia pg_advisory_xact_lock(4242). Sesiunea B ține
#     lock-ul 4242 (session-level) ÎNAINTE să pornească A, deci A se oprește exact după scrierea instantaneului și înaintea reverificării.
#     B așteaptă (condiție pe pg_locks, cu limită de 20 s) până când A stă la lock, șterge o zi de pontaj normală (autocommit = comisă),
#     apoi eliberează lock-ul. A continuă și reverificarea pe sursele de acum trebuie să refuze: SQLSTATE 40001, nimic scris.
#   Martorul: aceeași barieră, B NU schimbă nimic -> A închide luna (bariera singură nu produce refuzul).
#   Ziua ștearsă (angajatul 5, miercuri 14.10.2026) nu schimbă cifrele (o zi fără pontaj se numără la fel ca una pontată): fără reverificarea
#     completă, închiderea ar fi trecut (scenariul din review).
# DOAR pe un cluster PostgreSQL 17 DE UNICĂ FOLOSINȚĂ (nu pe producție, nu pe clona cu date): creează baza upa_conc_<aleator> (ștearsă la
#   final, în trap) și rolurile anon / authenticated / service_role / supabase_auth_admin DACĂ lipsesc (cele create aici se șterg la final).
#   Conectarea: PGHOST / PGPORT / PGUSER=postgres (superuser; migrarea cere current_user = postgres) / pgpass.
# Rulare (din rădăcina repo-ului): UPA_CONC_CLUSTER_DISPENSABIL=da bash supabase/tests/20270101a_upa_calcul_concurenta.sh
#   Ieșire: 0 = cursa refuzată cu 40001 și nimic scris, martorul închis; 1 = altfel; 2 = folosire greșită / mediu.
# Netestat local (redari@ nu are PostgreSQL); proba echivalentă într-o sesiune (aceeași schimbare injectată în același punct) e în
#   scripts/pglite/test_upa_calcul_local.mjs (secțiunea 3c + mutanții).
set -euo pipefail
if [ "${UPA_CONC_CLUSTER_DISPENSABIL:-}" != "da" ]; then echo "refuz: doar pe un cluster de unica folosinta (UPA_CONC_CLUSTER_DISPENSABIL=da)" >&2; exit 2; fi
command -v psql >/dev/null || { echo "refuz: psql lipseste" >&2; exit 2; }
RAD="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[ "${PGUSER:-}" = "postgres" ] || { echo "refuz: PGUSER trebuie sa fie postgres" >&2; exit 2; }
V="$(psql -X -At -d postgres -c 'SHOW server_version_num')"
[ "${V:-0}" -ge 170000 ] || { echo "refuz: cere PostgreSQL 17 (acum $V)" >&2; exit 2; }
DB="upa_conc_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
LUCRU="$(mktemp -d)"
ROLURI_NOI="$(psql -X -At -d postgres -c "SELECT string_agg(r, ' ') FROM unnest(ARRAY['anon','authenticated','service_role','supabase_auth_admin']) r WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)")"
curata() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
  for r in $ROLURI_NOI; do psql -X -q -d postgres -c "DROP ROLE IF EXISTS $r" >/dev/null 2>&1 || true; done
  rm -rf "$LUCRU"
}
trap curata EXIT INT TERM
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $DB" >/dev/null
P() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# ── baza: scheletele (ca proba PGlite), datele, 20261229a / b / c, 20270101a — fiecare ca prin runner (plafon, marcaje, pasul L15 „înainte”) ──
P -f "$RAD/supabase/tests/20261229a_administrativ_upa_alerta_schelet.sql" -f "$RAD/supabase/tests/20270101a_administrativ_upa_calcul_schelet.sql" >/dev/null
P >/dev/null <<'SQL_DATE'
INSERT INTO public.profiles (id, email, name, is_owner) VALUES ('00000000-0000-0000-0000-0000000a0001', 'owner@test.invalid', 'OWNER TEST', true);
INSERT INTO public.logistica_setari (key, value) VALUES ('upa_plafon_lunar', '7000'), ('upa_alerta_activa', 'false'), ('upa_alerta_emails', ''), ('upa_alerta_zi', '25');
INSERT INTO public.logistica_furnizori (id, nume, este_upa, activ, upa_valabil_pana) VALUES (1, 'UPA Unu SRL', true, true, '2040-01-01');
INSERT INTO public.employees (id, name, active, hire_date, procent_ocupare) SELECT g, 'ANGAJAT ' || g, true, DATE '2020-01-01', 100 FROM generate_series(1, 60) g;
INSERT INTO public.pontaj_records (employee_id, date)
SELECT e.id, d::date FROM public.employees e, generate_series(TIMESTAMP '2026-10-01', TIMESTAMP '2026-11-30', interval '1 day') d
 WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM public.calendar_days c WHERE c.date = d::date AND c.type = 'legal');
SQL_DATE
aplica() {   # aplica <nume> <fisier>
  local T; T="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  { echo "SET transaction_timeout = 5000;"
    echo "BEGIN ISOLATION LEVEL READ COMMITTED;"
    echo "SELECT set_config('gazpet.livrare_migrare', '$1:' || txid_current(), true);"
    echo "SELECT set_config('gazpet.plafon_tranzactie', '5000:' || txid_current(), true);"
    bash "$RAD/scripts/livrare_amprenta_gen.sh" inainte "$T" -
    cat "$RAD/$2"; echo; echo ";"
    echo "COMMIT;"; echo "SET transaction_timeout = 0;"
  } > "$LUCRU/$1.sql"
  P -f "$LUCRU/$1.sql" >/dev/null 2>"$LUCRU/$1.err" || { echo "ESEC: aplicarea $1"; tail -n 5 "$LUCRU/$1.err"; exit 1; }
}
aplica 20261229a_administrativ_upa_alerta supabase/migrations/20261229a_administrativ_upa_alerta.sql
aplica 20261229b_administrativ_upa_numar_factura supabase/migrations/20261229b_administrativ_upa_numar_factura.sql
aplica 20261229c_administrativ_upa_bucket supabase/migrations/20261229c_administrativ_upa_bucket.sql
aplica 20270101a_administrativ_upa_calcul supabase/migrations/20270101a_administrativ_upa_calcul.sql
# octombrie gata de închis (NMA 60, 0 angajați cu handicap); bariera de probă
P >/dev/null <<'SQL_PREG'
INSERT INTO public.upa_parametri (cheie, de_la, valoare, sursa, nota, setat_de) VALUES ('angajati_handicap', DATE '2026-10-01', 0, 'ecran', 'proba', '00000000-0000-0000-0000-0000000a0001');
CREATE FUNCTION public.t_bariera_upa() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN PERFORM pg_advisory_xact_lock(4242); RETURN NULL; END $t$;
CREATE TRIGGER t_bariera_upa AFTER INSERT ON public.upa_calcul_lunar FOR EACH ROW EXECUTE FUNCTION public.t_bariera_upa();
SQL_PREG
GATA="$(P -At -c "SELECT (public.fn_upa_calcul_la('2026-10-01', '2026-11-20') ->> 'poate_inchide')")"
AMP="$(P -At -c "SELECT public.fn_upa_calcul_la('2026-10-01', '2026-11-20') ->> 'amprenta'")"
[ "$GATA" = "true" ] && [[ "$AMP" =~ ^[0-9a-f]{32}$ ]] || { echo "ESEC: octombrie nu e gata de inchis ($GATA $AMP)"; exit 1; }

# ── o rulare: B ține bariera, A închide (în fundal), B așteaptă ca A să stea la barieră, face <schimbarea> (sau nimic), eliberează ──
asteapta() {   # asteapta <fd> <marcaj>: citește stderr-ul lui B până la marcaj; întoarce SQLSTATE-ul de după marcaj
  local linie
  while IFS= read -r -t 30 -u "$1" linie; do
    case "$linie" in "$2 "*) printf '%s' "${linie#"$2 "}"; return 0 ;; esac
  done
  echo "ESEC: marcajul $2 nu a venit" >&2; return 1
}
ruleaza() {   # ruleaza <eticheta> <SQL-ul lui B la barieră, sau gol>
  local et="$1" schimbare="$2" s rez_a=0
  coproc B { psql -X -q -d "$DB" -f - 2>&1 1>"$LUCRU/$et.b.out"; }
  local BIN="${B[1]}" BOUT="${B[0]}" BPID="$B_PID"
  printf '%s\n' "SELECT pg_advisory_lock(4242);" "\\warn B_LOCK :SQLSTATE" >&"$BIN"
  s="$(asteapta "$BOUT" B_LOCK)"; [ "$s" = "00000" ] || { echo "ESEC $et: B nu a luat bariera ($s)"; return 1; }
  psql -X -q -d "$DB" -v amp="$AMP" -f - >"$LUCRU/$et.a.out" 2>"$LUCRU/$et.a.err" <<'SQL_A' &
\set ON_ERROR_STOP 0
SELECT public.fn_upa_calcul_inchide_la(DATE '2026-10-01', DATE '2026-11-20', :'amp', '00000000-0000-0000-0000-0000000a0001'::uuid) ->> 'inchis' AS inchis \gset
\warn A_REZ :SQLSTATE inchis=:inchis
SQL_A
  local APID=$!
  # B: așteaptă ca A să stea la barieră (lock-ul 4242 cerut și neacordat) — condiție, nu timp
  printf '%s\n' "DO \$w\$ BEGIN FOR i IN 1..4000 LOOP EXIT WHEN EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.objid = 4242 AND NOT l.granted); PERFORM pg_sleep(0.005); END LOOP; IF NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.objid = 4242 AND NOT l.granted) THEN RAISE EXCEPTION 'bariera: A nu a ajuns'; END IF; END \$w\$;" \
    "\\warn B_A_LA_BARIERA :SQLSTATE" >&"$BIN"
  s="$(asteapta "$BOUT" B_A_LA_BARIERA)"; [ "$s" = "00000" ] || { echo "ESEC $et: A nu a ajuns la bariera ($s)"; kill "$APID" 2>/dev/null || true; return 1; }
  if [ -n "$schimbare" ]; then
    printf '%s\n' "$schimbare" "\\warn B_SCHIMBARE :SQLSTATE" >&"$BIN"
    s="$(asteapta "$BOUT" B_SCHIMBARE)"; [ "$s" = "00000" ] || { echo "ESEC $et: schimbarea lui B a picat ($s)"; return 1; }
  fi
  printf '%s\n' "SELECT pg_advisory_unlock(4242);" "\\warn B_ELIBERAT :SQLSTATE" "\\q" >&"$BIN"
  s="$(asteapta "$BOUT" B_ELIBERAT)"; [ "$s" = "00000" ] || { echo "ESEC $et: B nu a eliberat bariera ($s)"; return 1; }
  wait "$APID" || rez_a=$?
  wait "$BPID" 2>/dev/null || true
  [ "$rez_a" -eq 0 ] || { echo "ESEC $et: psql A a iesit cu $rez_a"; return 1; }
  grep -E '^A_REZ ' "$LUCRU/$et.a.err" | tail -n 1
}

ESEC=0
# 1. cursa: B șterge o zi pontată normal (comisă) cât A stă la barieră -> 40001, nimic scris
LINIE="$(ruleaza cursa "DELETE FROM public.pontaj_records WHERE employee_id = 5 AND date = DATE '2026-10-14';")" || ESEC=1
echo "cursa:  $LINIE"
case "$LINIE" in "A_REZ 40001 "*) ;; *) echo "ESEC cursa: asteptat SQLSTATE 40001"; ESEC=1 ;; esac
grep -q 'in timpul inchiderii' "$LUCRU/cursa.a.err" || { echo "ESEC cursa: mesajul reverificarii lipseste"; ESEC=1; }
N="$(P -At -c "SELECT (SELECT count(*) FROM public.upa_calcul_lunar) || '/' || (SELECT count(*) FROM public.upa_calcul_angajat)")"
[ "$N" = "0/0" ] || { echo "ESEC cursa: s-a scris ceva ($N)"; ESEC=1; }
# 2. martorul: ziua pusă la loc, B nu schimbă nimic -> A închide
P -c "INSERT INTO public.pontaj_records (employee_id, date) VALUES (5, DATE '2026-10-14')" >/dev/null
LINIE="$(ruleaza martor "")" || ESEC=1
echo "martor: $LINIE"
case "$LINIE" in "A_REZ 00000 inchis=true") ;; *) echo "ESEC martor: asteptat inchis=true"; ESEC=1 ;; esac
N="$(P -At -c "SELECT (SELECT count(*) FROM public.upa_calcul_lunar) || '/' || (SELECT count(*) FROM public.upa_calcul_angajat)")"
[ "$N" = "1/60" ] || { echo "ESEC martor: asteptat 1/60 ($N)"; ESEC=1; }
if [ "$ESEC" -eq 0 ]; then echo "REZULTAT: OK"; exit 0; fi
echo "REZULTAT: ESEC"; exit 1
