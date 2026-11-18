#!/usr/bin/env bash
# Proba de COST cu DOUĂ sesiuni (20261131i, runda 4; condiția 1 din verdictul Jakarinos #1138 r3): cât timp O ALTĂ sesiune e blocată pe rândul global
# red_mail_setari (id = 1) și pe rândul de numerotare `M` din red_numere cât rulează crearea unui lot mare.
#   Sesiunea B (pornită prima, în fundal): un DO care încearcă la ~2 ms `SELECT … FOR UPDATE NOWAIT` pe cele două rânduri, fiecare încercare într-o
#     subtranzacție anulată imediat (lock-ul luat de B se eliberează pe loc — B nu ține nimic între încercări); notează primul moment în care rândul e
#     ocupat și primul moment în care se eliberează după aceea. B se oprește singur după ce a văzut ambele rânduri ocupate și eliberate, sau la limita
#     COST_B_LIMITA_S (implicit 300 s) — fără să fi văzut ocuparea = ESEC raportat (proba nu se declară trecută din lipsă de material).
#   Sesiunea A: supabase/tests/20261131i_redari_mail_link_cost.sql (fixture sintetic, RPC-ul ca authenticated, ROLLBACK) — raportul ei „COST 20261131i: …”.
#   Fără sleep ca barieră: dacă A ar termina înainte ca B să înceapă (imposibil în practică — fixture-ul lui A durează secunde), B nu vede ocuparea și
#   proba iese cu ESEC, nu cu un fals „OK”.
# DOAR PE CLONĂ (PostgreSQL 17, 20261131h + 20261131i aplicate): A ține lock-urile reale; totul e anulat la ROLLBACK, nimic nu rămâne.
# Rulare (din rădăcina repo-ului; conectarea prin PGHOST / PGPORT / PGUSER=postgres / PGDATABASE / pgpass, ca la celelalte probe pe clonă):
#   COST_CLONA=da bash supabase/tests/20261131i_redari_mail_link_cost_concurenta.sh [destinatari] [caractere] [tokenuri] [timeout] [prag_ms]
#   Ieșire: 0 = A a trecut (verdict OK) și B a văzut ambele rânduri ocupate și eliberate; 1 = altfel; 2 = folosire greșită.
set -euo pipefail
if [ "${COST_CLONA:-}" != "da" ]; then echo "refuz: doar pe clona (COST_CLONA=da)" >&2; exit 2; fi
command -v psql >/dev/null || { echo "refuz: psql lipseste" >&2; exit 2; }
AICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="${1:-300}"; CAR="${2:-19000}"; TOK="${3:-20000}"; TMO="${4:-8s}"; PRAG="${5:-2000}"; LIM="${COST_B_LIMITA_S:-300}"
case "$LIM" in ''|*[!0-9]*) echo "refuz: COST_B_LIMITA_S nu e numar" >&2; exit 2;; esac
LUCRU="$(mktemp -d)"; trap 'rm -rf "$LUCRU"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -v limita="$LIM" -f - >"$LUCRU/b.log" 2>&1 <<'SQL_B' &
SELECT set_config('cost.limita_s', :'limita', false);
DO $b$
DECLARE t0 timestamptz := clock_timestamp(); s_ocupat timestamptz; s_liber timestamptz; m_ocupat timestamptz; m_liber timestamptz; m_exista boolean; incercari int := 0;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() > t0 + make_interval(secs => current_setting('cost.limita_s')::int);
    incercari := incercari + 1;
    IF s_liber IS NULL THEN
      BEGIN
        PERFORM 1 FROM public.red_mail_setari WHERE id = 1 FOR UPDATE NOWAIT;
        RAISE EXCEPTION 'cost_b_liber';   -- anulează subtranzacția: lock-ul lui B se eliberează imediat
      EXCEPTION
        WHEN lock_not_available THEN s_ocupat := coalesce(s_ocupat, clock_timestamp());
        WHEN raise_exception THEN IF s_ocupat IS NOT NULL THEN s_liber := clock_timestamp(); END IF;
      END;
    END IF;
    IF m_liber IS NULL THEN
      BEGIN
        PERFORM 1 FROM public.red_numere WHERE cheie = 'M' FOR UPDATE NOWAIT;
        m_exista := FOUND;
        RAISE EXCEPTION 'cost_b_liber';
      EXCEPTION
        WHEN lock_not_available THEN m_ocupat := coalesce(m_ocupat, clock_timestamp());
        WHEN raise_exception THEN IF m_ocupat IS NOT NULL THEN m_liber := clock_timestamp(); END IF;
      END;
    END IF;
    EXIT WHEN s_liber IS NOT NULL AND m_liber IS NOT NULL;
    PERFORM pg_sleep(0.002);
  END LOOP;
  RAISE NOTICE 'COST_B 20261131i: setari_blocat_ms=% numerotare_blocat_ms=% rand_M_vazut=% incercari=% verdict=%',
    coalesce(round(extract(epoch FROM s_liber - s_ocupat) * 1000)::text, 'nevazut'), coalesce(round(extract(epoch FROM m_liber - m_ocupat) * 1000)::text, 'nevazut'),
    coalesce(m_exista::text, 'necunoscut'), incercari, CASE WHEN s_liber IS NOT NULL AND m_liber IS NOT NULL THEN 'VAZUT' ELSE 'ESEC' END;
END $b$;
SQL_B
B_PID=$!
REZ_A=0
psql -X -q -v ON_ERROR_STOP=1 -v clona=da -v destinatari="$DST" -v caractere="$CAR" -v tokenuri="$TOK" -v timeout="$TMO" -v prag_ms="$PRAG" \
  -f "$AICI/20261131i_redari_mail_link_cost.sql" >"$LUCRU/a.log" 2>&1 || REZ_A=$?
REZ_B=0; wait "$B_PID" || REZ_B=$?
echo "--- sesiunea A (exit $REZ_A)"; grep -E 'COST 20261131i|ERROR|EROARE' "$LUCRU/a.log" || tail -n 20 "$LUCRU/a.log"
echo "--- sesiunea B (exit $REZ_B)"; grep -E 'COST_B 20261131i|ERROR|EROARE' "$LUCRU/b.log" || tail -n 20 "$LUCRU/b.log"
if [ "$REZ_A" -eq 0 ] && [ "$REZ_B" -eq 0 ] && grep -q 'COST 20261131i: .*verdict=OK' "$LUCRU/a.log" && grep -q 'COST_B 20261131i: .*verdict=VAZUT' "$LUCRU/b.log"; then
  echo "REZULTAT: OK"; exit 0
fi
echo "REZULTAT: ESEC"; exit 1
