#!/usr/bin/env bash
# ============================================================================
# secret_nou.sh <NUME_SECRET> — creează UN secret nou în Supabase Vault și îl scrie DOAR în fișierul local de pe serverul AI.
# Decizie Răzvan 06.11.2026: singura cale prin care Claude creează secrete fără aprobare manuală (regula din settings.local.json
# permite doar acest script). Valoarea nu apare niciodată pe ecran, în log sau în chat.
#
# Face exact atât:
#   1. numele: ^[A-Z][A-Z0-9_]{1,58}_SECRET$ — orice alt nume = refuz;
#   2. refuză dacă fișierul local există sau dacă secretul există în Vault (nu suprascrie, nu rotește — rotirea o face Răzvan);
#      directorul .secrete și calea lui nu pot fi symlink / junction;
#   3. O SINGURĂ conexiune: vault.create_secret(64 hex aleator generat în BD) cu numele ca variabilă psql, apoi citirea după UUID-ul
#      întors (nu după nume); valoarea merge prin pipe în Python, care creează fișierul GOL exclusiv (O_EXCL), îi restrânge și verifică
#      ACL-ul (moștenire tăiată: doar contul curent, SYSTEM, Administrators) și abia apoi scrie valoarea;
#   4. afișează doar „OK” (sau UUID-ul pentru reconciliere, la orice eșec după creare). Niciodată valoarea.
# NU face: ștergere, rotire, citirea altor secrete, alt SQL.
# Risc rezidual (configurarea serverului, nu a scriptului): integritatea psql.exe / python.exe și ACL-ul directoarelor lor.
# Risc ACCEPTAT de Răzvan (06.11.2026): .secrete moștenește citire pentru CodexSandboxUsers (Codex/cdx are nevoie); între crearea
#   fișierului gol și restrângerea ACL-ului, un proces al acelui grup poate deschide un handle păstrat după restrângere.
# Review Jakarinos 06.11.2026 r1–r3 (NO-GO) → r4.
# ============================================================================
set -euo pipefail
NUME="${1:-}"
[[ $# -eq 1 && "$NUME" =~ ^[A-Z][A-Z0-9_]{1,58}_SECRET$ ]] || { echo "REFUZ: un singur argument, NUME_SECRET (litere mari, cifre, _ ; se termină în _SECRET)"; exit 2; }
DIR_WIN='C:\Users\Gazpet-Ai\.secrete'
FISIER_WIN="$DIR_WIN\\$(echo "$NUME" | tr 'A-Z' 'a-z').txt"
PY=("/c/Program Files/Python313/python.exe" -I -X utf8)
PSQL=(env -u PGPASSWORD -u PGOPTIONS -u PGSERVICE -u PSQLRC /c/Users/Public/pgsql/bin/psql.exe -X -w -q -At -v ON_ERROR_STOP=1
      -h aws-1-eu-central-1.pooler.supabase.com -p 5432 -U postgres.dxczwkbciseqniprspcu -d postgres)
AICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

"${PY[@]}" "$AICI/secret_nou_cale.py" "$DIR_WIN" "$FISIER_WIN" || exit 3

# prin stdin, nu -c: psql interpolează :'nume' doar în SQL citit din fișier / stdin (review r2 P1)
EXISTA=$("${PSQL[@]}" -v nume="$NUME" 2>&1 <<'SQL'
SELECT count(*) FROM vault.secrets WHERE name = :'nume';
SQL
) || { echo "EROARE: Vault inaccesibil"; exit 4; }
[[ "$EXISTA" == "0" ]] || { echo "REFUZ: secretul $NUME există deja în Vault — nu suprascriu"; exit 3; }

DESCR="creat cu scripts/server/secret_nou.sh la $(date -u +%Y-%m-%dT%H:%MZ)"
"${PSQL[@]}" -v nume="$NUME" -v descr="$DESCR" 2>/dev/null <<'SQL' | "${PY[@]}" "$AICI/secret_nou_scrie.py" "$FISIER_WIN"
SELECT vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), :'nume', :'descr') AS id \gset
SELECT :'id' || '|' || decrypted_secret FROM vault.decrypted_secrets WHERE id = :'id'::uuid;
SQL
