# Pasul 0b al probei E3b (sursat de proba_e3b.sh și de valideaza_local_pg16.sh): replicile EXACTE de prod ale funcțiilor de
# platformă de pe lista albă r5h, puse pe țintă ÎNAINTEA oricărei migrări, apoi verificarea amprentelor tuturor excepțiilor.
# Cere de la apelant: PSQL (array), q(), esec(), ok(), $1 = directorul generat de replici_branch.py.
# Regula: o funcție-replică prezentă pe țintă cu alt corp / alt SECURITY / alt config → CREATE OR REPLACE cu forma de prod;
# dacă rolul curent nu poate (funcția e a supabase_admin / supabase_realtime_admin și postgres nu e membru) → oprire cu diagnostic
# (nu se ocolește). După: fiecare replică = prod (altfel oprire); celelalte excepții DIFERIT = avertisment (corpul lor nu e capturat;
# dacă obiectul intră în închiderea citirilor, poarta E3 îl refuză la pasul 1 și o spune).
pas0_replici() {
  local dir="$1" fn ret md5p ownp secp cfgp fis cur n_rep=0 n_ok=0 n_abs=0 linie
  [ -s "$dir/manifest.tsv" ] && [ -s "$dir/verifica.sql" ] || esec "0b manifest / verifica lipsă în $dir"
  while IFS=$'\t' read -r fn ret md5p ownp secp cfgp fis; do
    [ -n "$fn" ] || continue
    cur="$(q "SELECT md5(prosrc || '|' || coalesce(prosqlbody::text, '')) || ' ' || pg_get_userbyid(proowner) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text, '-')
              FROM pg_proc WHERE oid = to_regprocedure('$fn')")"
    if [ -z "$cur" ]; then
      echo "     replica $fn: ABSENTĂ pe țintă (obiectul de platformă lipsește — nimic de amprentat, nu se creează)"; n_abs=$((n_abs + 1)); continue
    fi
    if [ "$cur" = "$md5p $ownp $secp $cfgp" ]; then
      echo "     replica $fn: deja exactă (md5_corp $md5p, owner $ownp)"; n_ok=$((n_ok + 1)); continue
    fi
    echo "     replica $fn: pe țintă [$cur] ≠ prod [$md5p $ownp $secp $cfgp] → CREATE OR REPLACE cu corpul de prod"
    if ! "${PSQL[@]}" --single-transaction -f "$dir/$fis" >/tmp/izo_e3b_replica.out 2>&1; then
      tail -3 /tmp/izo_e3b_replica.out >&2
      echo "     diagnostic: current_user=$(q "SELECT current_user"); owner pe țintă=$(q "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = to_regprocedure('$fn')");" \
           "membru al owner-ului: $(q "SELECT pg_has_role(current_user, proowner, 'MEMBER') FROM pg_proc WHERE oid = to_regprocedure('$fn')")" >&2
      esec "0b replica $fn nu se poate pune ca $(q "SELECT current_user") (fișierul: $dir/$fis) — aplic-o pe branch cu un rol care e owner-ul funcției, apoi re-rulează proba"
    fi
    cur="$(q "SELECT md5(prosrc || '|' || coalesce(prosqlbody::text, '')) || ' ' || pg_get_userbyid(proowner) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text, '-')
              FROM pg_proc WHERE oid = to_regprocedure('$fn')")"
    [ "$cur" = "$md5p $ownp $secp $cfgp" ] || esec "0b replica $fn după CREATE OR REPLACE: [$cur] ≠ prod [$md5p $ownp $secp $cfgp] (owner-ul nu se schimbă prin replică)"
    n_rep=$((n_rep + 1))
  done < "$dir/manifest.tsv"
  # md5-ul fiecărui corp replicat, citit înapoi de pe țintă
  while IFS=$'\t' read -r fn _ _ _ _ _ _; do
    [ -n "$fn" ] || continue
    echo "     md5 corp $fn pe țintă: $(q "SELECT 'md5(prosrc)=' || md5(prosrc) || ' md5_corp=' || md5(prosrc || '|' || coalesce(prosqlbody::text, '')) FROM pg_proc WHERE oid = to_regprocedure('$fn')")"
  done < "$dir/manifest.tsv"
  # amprentele tuturor excepțiilor de pe lista albă (formula porții), pe țintă vs prod
  "${PSQL[@]}" -At -F ' | ' -f "$dir/verifica.sql" > /tmp/izo_e3b_verifica.out || esec "0b verifica.sql"
  sed 's/^/     lista albă: /' /tmp/izo_e3b_verifica.out
  while IFS= read -r linie; do
    case "$linie" in
      DIFERIT*) fn="$(echo "$linie" | cut -d'|' -f4 | sed 's/^ *//; s/ *$//')"
                if grep -qF "$fn"$'\t' "$dir/manifest.tsv"; then esec "0b replica rămasă diferită: $linie"; fi
                echo "     AVERTISMENT: excepție cu altă amprentă decât pe prod, corp necapturat (dacă intră în închidere, pasul 1 o refuză): $linie" ;;
    esac
  done < /tmp/izo_e3b_verifica.out
  ok "0b replici de platformă: $n_rep puse, $n_ok deja exacte, $n_abs absente; lista albă: $(grep -c '^OK' /tmp/izo_e3b_verifica.out) OK, $(grep -c '^DIFERIT' /tmp/izo_e3b_verifica.out) DIFERIT, $(grep -c '^ABSENT' /tmp/izo_e3b_verifica.out) ABSENT"
}
