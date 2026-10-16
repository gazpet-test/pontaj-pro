#!/usr/bin/env bash
# ============================================================================
# Harness SQL local — 20261031d_ofertare_buget_admin (plafonul AI setat și de admin Ofertare, ≤ 5 USD; owner ≤ 100; jurnal pe rol).
# PostgreSQL 16 local dedicat (/tmp/pg_ba, 127.0.0.1:5451). Nu atinge producția.
# Bază: scheletul loturi + 20261024b + schelet extra + 20261031a + 20261031b, apoi 20261031d. Acoperă: garda de livrare · owner ≤ 100 ·
# admin ≤ 5 (nou și mărire) · admin refuzat > 5 · admin refuzat pe plafonul > 5 al owner-ului (și în jos) · editor Ofertare refuzat ·
# fără modul refuzat · anon refuzat · jurnalul cu rolul · deblocarea rămâne la owner · drepturile helper-ului · revenire (nearmată /
# refuzată cu acțiuni de admin / armată pe o bază fără acțiuni de admin) + reaplicare.
# Utilizare: bash scripts/test_ofertare_buget_admin.sh [--opreste]   Ieșire: 0 PASS · 1 eșec · 2 mediu
# ============================================================================
set -Eeuo pipefail
RADACINA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DATE_DIR=/tmp/pg_ba; PORT=5451; BAZA=ofertare_loturi_test
LOTURI="$RADACINA/supabase/migrations/20261024b_ofertare_loturi_mvp.sql"
SCHELET="$RADACINA/supabase/tests/ofertare_loturi_mvp_schelet.sql"
EXTRA="$RADACINA/supabase/tests/ofertare_cantitati_b_schelet_extra.sql"
MIG_A="$RADACINA/supabase/migrations/20261031a_ofertare_cantitati_b.sql"
MIG_B="$RADACINA/supabase/migrations/20261031b_ofertare_text_scrie_cas.sql"
NUME=20261031d_ofertare_buget_admin
MIGRARE="$RADACINA/supabase/migrations/$NUME.sql"
ROLLBACK="$RADACINA/supabase/revenire/${NUME}_ROLLBACK.sql"
OPRESTE=0; [ "${1:-}" = --opreste ] && OPRESTE=1
esec()  { echo "ESEC: $*" >&2; exit 1; }
mediu() { echo "MEDIU: $*" >&2; exit 2; }
ok()    { echo "OK   $*"; }
ca_postgres() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$(printf '%q ' "$@")"; else "$@"; fi; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U postgres)
[ -x "$PG_BIN/initdb" ] || mediu "PG lipsă ($PG_BIN)"
if [ -e "$DATE_DIR" ]; then
  [ -f "$DATE_DIR/.fixture_ba" ] || mediu "$DATE_DIR există și nu e fixture — nu îl șterg"
  [ -f "$DATE_DIR/postmaster.pid" ] && { ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1 || true; }
  rm -rf "$DATE_DIR"
fi
mkdir -p "$DATE_DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DATE_DIR"
ca_postgres "$PG_BIN/initdb" -D "$DATE_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null || mediu initdb
touch "$DATE_DIR/.fixture_ba"
ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -l /tmp/pg_ba.log -w -t 30 start \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" >/dev/null || mediu "pg_ctl start"
trap '[ $OPRESTE = 1 ] && ca_postgres "$PG_BIN/pg_ctl" -D "$DATE_DIR" -m fast -w stop >/dev/null 2>&1; true' EXIT
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$SCHELET" >/dev/null || esec "schelet"
livreaza_nume() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.livrare_migrare', '$1:' || txid_current(), true);" -f "$2" 2>&1; }
livreaza_nume 20261024b_ofertare_loturi_mvp "$LOTURI" >/dev/null || esec "migrarea de bază 20261024b"
"${PSQL[@]}" -d "$BAZA" -f "$EXTRA" >/dev/null || esec "schelet extra"
livreaza_nume 20261031a_ofertare_cantitati_b "$MIG_A" >/dev/null || esec "20261031a: $(livreaza_nume 20261031a_ofertare_cantitati_b "$MIG_A" | tail -3)"
livreaza_nume 20261031b_ofertare_text_scrie_cas "$MIG_B" >/dev/null || esec "20261031b"

# owner, editor (responsabil 102), editor fără responsabilitate, admin Ofertare, fără modul — din schelet
OWNER=00000000-0000-4000-8000-000000000121; RESP=00000000-0000-4000-8000-000000000043; EDIT=00000000-0000-4000-8000-000000000007
ADMIN=00000000-0000-4000-8000-000000000008; FARA=00000000-0000-4000-8000-000000000099
q() { "${PSQL[@]}" -d "$BAZA" -Atc "$1"; }
ca() {
  local claims
  if [ "$2" = - ]; then claims="{\"role\":\"$1\"}"; else claims="{\"sub\":\"$2\",\"role\":\"$1\"}"; fi
  "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE $1;" \
    -c "SELECT set_config('request.jwt.claims', '$claims', true);" -c "$3" -c "COMMIT;" 2>&1 | grep -v '^BEGIN$\|^SET$\|^COMMIT$' | tail -"${CA_LINII:-1}"
}
asteapta() { [ "$2" = "$3" ] || esec "$1: așteptat «$3», primit «$2»"; ok "$1"; }
refuz() { local o; o="$(CA_LINII=50 ca "$2" "$3" "$4" || true)"; grep -q "$5" <<<"$o" || esec "$1 trebuia refuzat ($5), primit: $o"; ok "refuz: $1"; }
livreaza() { livreaza_nume "$NUME" "$MIGRARE"; }
revenire() { "${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261031d', 'BUGET_ADMIN_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK" 2>&1; }
seteaza() { ca authenticated "$1" "SELECT public.fn_ofertare_cb_buget_seteaza($2,'cant_extragere',$3)->>'rol'"; }
plafon() { q "SELECT plafon_usd FROM public.ofertare_ai_buget WHERE licitatie_id=$1 AND scop='cant_extragere'"; }

# un rând de jurnal vechi (owner, înainte de 31d) — trebuie să primească rol = owner
ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(3,'audit_raspunsuri',2)" >/dev/null
refuz "admin înainte de 31d" authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',1)" 'Doar owner-ul'

# ── livrare ──
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$MIGRARE" 2>&1 || true)"; grep -q 'garda start invalida' <<<"$o" || esec "fără gardă: $o"; ok "refuz: livrare fără gardă"
livreaza >/dev/null || esec "livrare: $(livreaza | tail -3)"; ok "livrare 20261031d"
o="$(livreaza || true)"; grep -q 'deja aplicata' <<<"$o" || esec "relivrare: $o"; ok "refuz: relivrare"
asteapta "jurnalul vechi = owner; amprenta reîmprospătată" "$(q "SELECT string_agg(rol, ',') FROM public.ofertare_ai_buget_jurnal")|$(q "SELECT (obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class') LIKE '%20261031d%amprenta=' || public.fn_ofertare_cb_amprenta())::text")" "owner|true"

# ── drepturi ──
asteapta "helper-ul este_admin nu e apelabil din API" "$(q "SELECT (has_function_privilege('anon','public.fn_ofertare_cb_este_admin()','EXECUTE') OR has_function_privilege('authenticated','public.fn_ofertare_cb_este_admin()','EXECUTE') OR has_function_privilege('service_role','public.fn_ofertare_cb_este_admin()','EXECUTE'))::text")" false
asteapta "buget_seteaza: authenticated da, anon nu" "$(q "SELECT has_function_privilege('authenticated','public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)','EXECUTE')::text || has_function_privilege('anon','public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)','EXECUTE')::text")" truefalse
refuz "anon" anon - "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',1)" 'permission denied'
refuz "editor Ofertare (responsabil) fără admin" authenticated "$RESP" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',1)" 'Doar owner-ul sau un admin Ofertare'
refuz "editor Ofertare fără responsabilitate" authenticated "$EDIT" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',1)" 'Doar owner-ul sau un admin Ofertare'
refuz "utilizator fără modul" authenticated "$FARA" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',1)" 'Doar owner-ul sau un admin Ofertare'

# ── owner ≤ 100 ──
asteapta "owner: 100 acceptat" "$(seteaza "$OWNER" 4 100)|$(plafon 4)" "owner|100.00"
refuz "owner > 100" authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(4,'cant_extragere',100.01)" 'Scop sau plafon invalid'

# ── admin ≤ 5 ──
asteapta "admin: plafon nou 3,50" "$(seteaza "$ADMIN" 102 3.50)|$(plafon 102)" "admin|3.50"
asteapta "admin: mărire până la 5,00" "$(seteaza "$ADMIN" 102 5)|$(plafon 102)" "admin|5.00"
refuz "admin > 5 (5,01)" authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',5.01)" 'cel mult la 5,00 USD'
refuz "admin > 5 pe licitație fără plafon" authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(3,'cant_extragere',20)" 'cel mult la 5,00 USD'
asteapta "refuzul nu a creat rândul bugetului" "$(q "SELECT count(*) FROM public.ofertare_ai_buget WHERE licitatie_id=3 AND scop='cant_extragere'")" 0
asteapta "admin: scădere 5 → 2" "$(seteaza "$ADMIN" 102 2)|$(plafon 102)" "admin|2.00"

# ── plafonul > 5 al owner-ului: adminul nu-l atinge (nici în sus, nici în jos) ──
refuz "admin pe plafonul 100 al owner-ului (în jos, 4)" authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(4,'cant_extragere',4)" 'peste limita adminului'
asteapta "plafonul owner-ului neschimbat" "$(plafon 4)" "100.00"
seteaza "$OWNER" 4 5 >/dev/null
asteapta "după ce owner-ul coboară la 5, adminul îl poate seta" "$(seteaza "$ADMIN" 4 4)|$(plafon 4)" "admin|4.00"

# ── jurnalul ──
asteapta "jurnalul: cine / rol / vechi → nou" "$(q "SELECT string_agg(rol || ':' || (de = '$ADMIN')::text || ':' || coalesce(plafon_vechi::text, '-') || '>' || plafon_nou, ' ' ORDER BY id) FROM public.ofertare_ai_buget_jurnal WHERE licitatie_id IN (102, 4)")" \
  "owner:false:100.00>100.00 admin:true:3.50>3.50 admin:true:3.50>5.00 admin:true:5.00>2.00 owner:false:100.00>5.00 admin:true:5.00>4.00"
refuz "authenticated nu scrie direct în jurnal" authenticated "$OWNER" "UPDATE public.ofertare_ai_buget_jurnal SET rol='owner'" 'permission denied'
# review r1 (P2): imuabilitatea dovedită pe trigger, ca postgres (fără barierea de drepturi)
o="$(q "UPDATE public.ofertare_ai_buget_jurnal SET rol = 'owner' WHERE rol = 'admin'" 2>&1 || true)"; grep -q 'coloane imuabile' <<<"$o" || esec "trigger imuabil pe rol: $o"; ok "refuz: triggerul de imuabilitate acoperă coloana rol (postgres)"
o="$(q "DELETE FROM public.ofertare_ai_buget_jurnal WHERE rol = 'admin'" 2>&1 || true)"; grep -q 'nu se șterg' <<<"$o" || esec "trigger imuabil DELETE: $o"; ok "refuz: rândurile jurnalului nu se șterg (postgres)"
o="$(q "INSERT INTO public.ofertare_ai_buget_jurnal (licitatie_id, scop, actiune, plafon_nou, consum, de, rol) VALUES (4,'cant_extragere','plafon',1,0,'$ADMIN','alt')" 2>&1 || true)"
grep -q 'ofertare_ai_buget_jurnal_rol_check' <<<"$o" || esec "CHECK pe rol: $o"; ok "refuz: rol în afara listei (CHECK)"

# ── deblocarea rămâne la owner ──
q "UPDATE public.ofertare_ai_buget SET blocat = true, blocat_motiv = 'test' WHERE licitatie_id = 102 AND scop = 'cant_extragere'" >/dev/null
refuz "adminul nu deblochează" authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_deblocheaza(102,'cant_extragere')" 'Doar owner-ul deblochează'
asteapta "owner-ul deblochează, jurnal cu rol owner" "$(ca authenticated "$OWNER" "SELECT public.fn_ofertare_cb_buget_deblocheaza(102,'cant_extragere')->>'ok'")|$(q "SELECT rol FROM public.ofertare_ai_buget_jurnal WHERE actiune='deblocare' ORDER BY id DESC LIMIT 1")" "true|owner"

# ── concurență (review r1, P2): două sesiuni reale; prima ține tranzacția deschisă 3 s după apel ──
tx_bg() {  # $1 uid, $2 sql, $3 fișierul de ieșire — apelul + pg_sleep(3) + COMMIT, în fundal
  "${PSQL[@]}" -d "$BAZA" -At -c "SET SESSION AUTHORIZATION authenticator;" -c "BEGIN;" -c "SET LOCAL ROLE authenticated;" \
    -c "SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', true);" -c "$2" -c "SELECT pg_sleep(3);" -c "COMMIT;" >"$3" 2>&1 &
}
q "INSERT INTO public.ofertare_licitatii(id, nr_anunt) VALUES (5, 'X5'), (6, 'X6'), (7, 'X7')" >/dev/null
# owner pune 50 și ține tranzacția; adminul cere 4 în paralel → așteaptă lock-ul rândului, apoi vede 50 > 5 → refuzat
tx_bg "$OWNER" "SELECT public.fn_ofertare_cb_buget_seteaza(5,'cant_extragere',50)" /tmp/ba_t1.out; sleep 0.8
o="$(CA_LINII=20 ca authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(5,'cant_extragere',4)" || true)"; wait
grep -q 'peste limita adminului' <<<"$o" || esec "owner întâi, admin concurent: $o"
asteapta "concurență owner(50) întâi → adminul așteaptă și e refuzat; plafonul rămâne 50" "$(plafon 5)" "50.00"
# adminul pune 4 și ține; owner-ul cere 50 în paralel → așteaptă, apoi reușește (owner-ul nu e limitat)
tx_bg "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(6,'cant_extragere',4)" /tmp/ba_t2.out; sleep 0.8
asteapta "concurență admin(4) întâi → owner-ul așteaptă și pune 50" "$(seteaza "$OWNER" 6 50; wait)|$(plafon 6)" "owner|50.00"
# doi admini în paralel (5 și 3) → amândoi reușesc pe rând, plafonul final ≤ 5, două rânduri de jurnal admin
tx_bg "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(7,'cant_extragere',5)" /tmp/ba_t3.out; sleep 0.8
seteaza "$ADMIN" 7 3 >/dev/null; wait
asteapta "concurență admin/admin → final ≤ 5, ambele în jurnal" "$(plafon 7)|$(q "SELECT count(*) FROM public.ofertare_ai_buget_jurnal WHERE licitatie_id=7 AND rol='admin'")" "3.00|2"

# ── revenire ──
# amprenta: o schimbare de drepturi pe helper după aplicare → revenirea refuză; drepturile puse la loc → revenirea trece de amprentă
q "GRANT EXECUTE ON FUNCTION public.fn_ofertare_cb_este_admin() TO authenticated" >/dev/null
o="$(revenire || true)"; grep -q 'amprenta difera' <<<"$o" || esec "drift amprentă: $o"; ok "refuz: revenire după schimbarea drepturilor helper-ului (amprenta)"
q "REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cb_este_admin() FROM authenticated" >/dev/null
o="$("${PSQL[@]}" -d "$BAZA" --single-transaction -f "$ROLLBACK" 2>&1 || true)"; grep -q 'garda start invalida' <<<"$o" || esec "revenire nearmată: $o"; ok "refuz: revenire nearmată"
o="$(revenire || true)"; grep -q 'actiuni de admin' <<<"$o" || esec "revenire cu acțiuni de admin: $o"; ok "refuz: revenire când jurnalul are acțiuni de admin"
# revenirea armată pe o bază nouă, fără acțiuni de admin
"${PSQL[@]}" -d postgres -c "DROP DATABASE $BAZA" >/dev/null
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $BAZA" >/dev/null
# rolurile (anon / authenticated / service_role / authenticator) sunt ale clusterului și există deja: scheletul rulează mai departe
"$PG_BIN/psql" -X -q -v ON_ERROR_STOP=0 -h 127.0.0.1 -p "$PORT" -U postgres -d "$BAZA" -f "$SCHELET" >/dev/null 2>&1
livreaza_nume 20261024b_ofertare_loturi_mvp "$LOTURI" >/dev/null
"${PSQL[@]}" -d "$BAZA" -f "$EXTRA" >/dev/null
livreaza_nume 20261031a_ofertare_cantitati_b "$MIG_A" >/dev/null
livreaza_nume 20261031b_ofertare_text_scrie_cas "$MIG_B" >/dev/null
DEF_31A=$(q "SELECT md5(pg_get_functiondef('public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)'::regprocedure))")
livreaza >/dev/null || esec "livrare (a doua bază)"
seteaza "$OWNER" 102 7 >/dev/null
J0=$(q "SELECT count(*) FROM public.ofertare_ai_buget_jurnal")
# concurență (review r1, P1): revenirea ține lock-ul pe jurnal (SHARE) 3 s înainte de COMMIT; un admin care cere plafonul în
# paralel așteaptă și apoi EȘUEAZĂ (coloana / funcția s-au schimbat) — nicio acțiune de admin nu rămâne după revenire
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261031d', 'BUGET_ADMIN_REVENIRE:' || txid_current(), true);" \
  -f "$ROLLBACK" -c "SELECT pg_sleep(3);" >/tmp/ba_rev.out 2>&1 &
sleep 0.8
o="$(CA_LINII=20 ca authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',2)" || true)"; wait
grep -qi 'error' <<<"$o" || esec "adminul concurent cu revenirea trebuia să eșueze: $o"
grep -qi 'error' /tmp/ba_rev.out && esec "revenirea concurentă: $(cat /tmp/ba_rev.out)"
asteapta "concurență revenire întâi → adminul eșuează, jurnalul fără rând nou, plafonul 7" "$(q "SELECT count(*) FROM public.ofertare_ai_buget_jurnal")|$(plafon 102)" "$J0|7.00"
asteapta "după revenire: corpul din 31a, fără helper, fără coloana rol, plafonul păstrat, amprenta în comentariu" \
  "$(q "SELECT (md5(pg_get_functiondef('public.fn_ofertare_cb_buget_seteaza(bigint,text,numeric)'::regprocedure)) = '$DEF_31A')::text || ',' || (to_regprocedure('public.fn_ofertare_cb_este_admin()') IS NULL)::text || ',' || (NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.ofertare_ai_buget_jurnal'::regclass AND attname='rol' AND NOT attisdropped))::text || ',' || (SELECT plafon_usd FROM public.ofertare_ai_buget WHERE licitatie_id=102 AND scop='cant_extragere') || ',' || (obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class') LIKE '%amprenta=' || public.fn_ofertare_cb_amprenta())::text")" \
  "true,true,true,7.00,true"
refuz "după revenire adminul e iar refuzat" authenticated "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(102,'cant_extragere',1)" 'Doar owner-ul setează'
livreaza >/dev/null || esec "reaplicare după revenire: $(livreaza | tail -3)"
# ordinea reveririlor (review r1): 31b revenit înaintea lui 31d → eticheta amprentei spune ce e aplicat de fapt
ROLLBACK_B="$RADACINA/supabase/revenire/20261031b_ofertare_text_scrie_cas_ROLLBACK.sql"
"${PSQL[@]}" -d "$BAZA" --single-transaction -c "SELECT set_config('gazpet.revenire_20261031b', 'TEXT_SCRIE_CAS_REVENIRE:' || txid_current(), true);" -f "$ROLLBACK_B" >/dev/null 2>&1 \
  || esec "revenirea 31b după 31d"
revenire >/dev/null || esec "revenirea 31d după 31b: $(revenire | tail -3)"
asteapta "31b apoi 31d revenite: eticheta „(20261031a)”, amprenta corectă" "$(q "SELECT (obj_description('public.ofertare_analiza_versiuni'::regclass, 'pg_class') LIKE 'TKT-0329 B (20261031a). Imuabil. amprenta=' || public.fn_ofertare_cb_amprenta())::text")" true
livreaza_nume 20261031b_ofertare_text_scrie_cas "$MIG_B" >/dev/null || esec "reaplicare 31b"
livreaza >/dev/null || esec "reaplicare 31d după 31b: $(livreaza | tail -3)"
# concurență (review r1, P1): o acțiune de admin în curs ÎNAINTEA revenirii → revenirea așteaptă commit-ul ei, o vede și refuză
asteapta "înainte: niciun rând de admin în jurnal" "$(q "SELECT count(*) FROM public.ofertare_ai_buget_jurnal WHERE rol='admin'")" 0
tx_bg "$ADMIN" "SELECT public.fn_ofertare_cb_buget_seteaza(4,'cant_extragere',2)" /tmp/ba_t4.out; sleep 0.8
o="$(revenire || true)"; wait
grep -q 'actiuni de admin' <<<"$o" || esec "revenire cu un admin concurent: $o"; ok "refuz: revenirea vede acțiunea de admin comisă în timp ce aștepta lock-ul"
asteapta "reaplicare: adminul setează din nou ≤ 5" "$(seteaza "$OWNER" 102 5 >/dev/null; seteaza "$ADMIN" 102 1)" admin
echo PASS
