#!/usr/bin/env bash
# Proba de COST cu DOUĂ sesiuni (20261131i, runda 4; condiția 1 din verdictul Jakarinos #1138 r3): cât timp O ALTĂ sesiune e blocată pe rândul global
# red_mail_setari (id = 1) și pe rândul de numerotare `M` din red_numere cât rulează crearea unui lot mare.
#   Sesiunea B (pornită prima, în fundal): un DO care încearcă la ~2 ms să ia cele două rânduri, fiecare încercare într-o subtranzacție anulată imediat
#     (lock-ul luat de B se eliberează pe loc — B nu ține nimic între încercări): setările cu `SELECT … FOR UPDATE NOWAIT`; numerotarea (r5) cu același
#     UPSERT ca RPC-ul (`INSERT … ON CONFLICT (cheie) DO UPDATE`) și lock_timeout 5 ms — vede ocupat și rândul `M` creat de A în tranzacția lui (pe o clonă
#     fără rândul M un SELECT nu l-ar vedea niciodată). Notează primul moment în care rândul e ocupat și primul moment în care se eliberează după aceea.
#     B se oprește singur după ce a văzut ambele rânduri ocupate și eliberate, sau la limita COST_B_LIMITA_S (implicit 300 s).
#   Sesiunea A: supabase/tests/20261131i_redari_mail_link_cost.sql (fixture sintetic, RPC-ul ca authenticated, verificarea, ROLLBACK) — raportul ei
#     „COST 20261131i: …”, cu duratele lock-urilor până la ultima instrucțiune înaintea ROLLBACK-ului.
#   Fără sleep ca barieră: dacă A ar termina înainte ca B să înceapă (imposibil în practică — fixture-ul lui A durează secunde), B nu vede ocuparea și
#     proba iese cu ESEC, nu cu un fals „OK”.
#   r5 (Jakarinos #1138 r4 P2): scriptul COMPARĂ EXPLICIT cu pragul (prag_ms, implicit 2000) duratele blocării văzute de B (setări ȘI numerotare) și
#     duratele raportate de A (rpc_ms, lock-urile până la sfârșitul tranzacției); orice durată peste prag, lipsă sau nenumerică = ESEC.
#     Ce măsoară B: de la prima încercare refuzată până la prima reușită după ea — intervalul real e cel mult cu o încercare (~2–7 ms) mai lung.
# DOAR PE CLONĂ (PostgreSQL 17, 20261131h + 20261131i aplicate): A ține lock-urile reale; totul e anulat la ROLLBACK (A) sau în subtranzacții (B), nimic
#   nu rămâne. A creează două triggere de măsurare pe red_mail_loturi / red_mail_mesaje în tranzacția ei: alte creări de loturi pe clonă așteaptă până la
#   ROLLBACK-ul lui A (nu le măsoară B).
# Rulare (din rădăcina repo-ului; conectarea prin PGHOST / PGPORT / PGUSER=postgres / PGDATABASE / pgpass, ca la celelalte probe pe clonă):
#   COST_CLONA=da bash supabase/tests/20261131i_redari_mail_link_cost_concurenta.sh [destinatari] [caractere] [tokenuri] [timeout] [prag_ms]
#   Ieșire: 0 = A a trecut (verdict OK) și B a văzut ambele rânduri ocupate și eliberate, fiecare durată ≤ prag_ms; 1 = altfel; 2 = folosire greșită.
# Testul mecanicii (psql fals, fără bază): src/redari/mailLinkCostConcurenta.test.js.
set -euo pipefail
if [ "${COST_CLONA:-}" != "da" ]; then echo "refuz: doar pe clona (COST_CLONA=da)" >&2; exit 2; fi
command -v psql >/dev/null || { echo "refuz: psql lipseste" >&2; exit 2; }
AICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="${1:-300}"; CAR="${2:-19000}"; TOK="${3:-20000}"; TMO="${4:-8s}"; PRAG="${5:-2000}"; LIM="${COST_B_LIMITA_S:-300}"
case "$LIM" in ''|*[!0-9]*) echo "refuz: COST_B_LIMITA_S nu e numar" >&2; exit 2;; esac
case "$PRAG" in ''|*[!0-9]*) echo "refuz: prag_ms nu e numar" >&2; exit 2;; esac
LUCRU="$(mktemp -d)"; trap 'rm -rf "$LUCRU"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -v limita="$LIM" -f - >"$LUCRU/b.log" 2>&1 <<'SQL_B' &
SELECT set_config('cost.limita_s', :'limita', false);
DO $b$
DECLARE t0 timestamptz := clock_timestamp(); s_ocupat timestamptz; s_liber timestamptz; m_ocupat timestamptz; m_liber timestamptz; incercari int := 0;
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
        -- același UPSERT ca numerotarea din RPC, cu lock_timeout scurt (local subtranzacției): rândul existent blocat de A SAU rândul nou, necomis, al lui A
        PERFORM set_config('lock_timeout', '5ms', true);
        INSERT INTO public.red_numere (cheie, ultimul) VALUES ('M', 0) ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul;
        RAISE EXCEPTION 'cost_b_liber';   -- anulează subtranzacția: scrierea și lock-ul lui B dispar imediat
      EXCEPTION
        WHEN lock_not_available THEN m_ocupat := coalesce(m_ocupat, clock_timestamp());
        WHEN raise_exception THEN IF m_ocupat IS NOT NULL THEN m_liber := clock_timestamp(); END IF;
      END;
    END IF;
    EXIT WHEN s_liber IS NOT NULL AND m_liber IS NOT NULL;
    PERFORM pg_sleep(0.002);
  END LOOP;
  RAISE NOTICE 'COST_B 20261131i: setari_blocat_ms=% numerotare_blocat_ms=% incercari=% verdict=%',
    coalesce(round(extract(epoch FROM s_liber - s_ocupat) * 1000)::text, 'nevazut'), coalesce(round(extract(epoch FROM m_liber - m_ocupat) * 1000)::text, 'nevazut'),
    incercari, CASE WHEN s_liber IS NOT NULL AND m_liber IS NOT NULL THEN 'VAZUT' ELSE 'ESEC' END;
END $b$;
SQL_B
B_PID=$!
REZ_A=0
psql -X -q -v ON_ERROR_STOP=1 -v clona=da -v destinatari="$DST" -v caractere="$CAR" -v tokenuri="$TOK" -v timeout="$TMO" -v prag_ms="$PRAG" \
  -f "$AICI/20261131i_redari_mail_link_cost.sql" >"$LUCRU/a.log" 2>&1 || REZ_A=$?
REZ_B=0; wait "$B_PID" || REZ_B=$?
echo "--- sesiunea A (exit $REZ_A)"; grep -E 'COST 20261131i|ERROR|EROARE' "$LUCRU/a.log" || tail -n 20 "$LUCRU/a.log"
echo "--- sesiunea B (exit $REZ_B)"; grep -E 'COST_B 20261131i|ERROR|EROARE' "$LUCRU/b.log" || tail -n 20 "$LUCRU/b.log"

# ── r5: comparația EXPLICITĂ cu pragul — fiecare durată numerică și ≤ PRAG, altfel ESEC ──
ESEC=0
LINIE_A="$(grep -E 'COST 20261131i: ' "$LUCRU/a.log" | tail -n 1 || true)"
LINIE_B="$(grep -E 'COST_B 20261131i: ' "$LUCRU/b.log" | tail -n 1 || true)"
camp() { if [[ " $1 " =~ [[:space:]]$2=([^[:space:]]+) ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi; }
sub_prag() {   # sub_prag <sesiune> <linie> <camp>
  local v; v="$(camp "$2" "$3")"
  case "$v" in
    ''|*[!0-9]*) echo "ESEC $1 $3=${v:-lipsa}: nu e o durata masurata"; ESEC=1 ;;
    *) if [ "$v" -le "$PRAG" ]; then echo "ok   $1 $3=$v <= prag $PRAG ms"; else echo "ESEC $1 $3=$v > prag $PRAG ms (DEPASIT)"; ESEC=1; fi ;;
  esac
}
echo "--- comparatia cu pragul ($PRAG ms)"
[ "$REZ_A" -eq 0 ] || { echo "ESEC A: psql a iesit cu $REZ_A"; ESEC=1; }
[ "$REZ_B" -eq 0 ] || { echo "ESEC B: psql a iesit cu $REZ_B"; ESEC=1; }
[ "$(camp "$LINIE_A" verdict)" = "OK" ] || { echo "ESEC A: verdict=$(camp "$LINIE_A" verdict)"; ESEC=1; }
[ "$(camp "$LINIE_B" verdict)" = "VAZUT" ] || { echo "ESEC B: verdict=$(camp "$LINIE_B" verdict) (ocuparea si eliberarea nu au fost vazute)"; ESEC=1; }
# >>> PRAG-A
sub_prag A "$LINIE_A" rpc_ms
sub_prag A "$LINIE_A" lock_setari_tranzactie_ms
sub_prag A "$LINIE_A" lock_numerotare_tranzactie_ms
# <<< PRAG-A
# >>> PRAG-B
sub_prag B "$LINIE_B" setari_blocat_ms
sub_prag B "$LINIE_B" numerotare_blocat_ms
# <<< PRAG-B
if [ "$ESEC" -eq 0 ]; then echo "REZULTAT: OK"; exit 0; fi
echo "REZULTAT: ESEC"; exit 1
