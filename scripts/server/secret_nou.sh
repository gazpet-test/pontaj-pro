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
#      întors (nu după nume); valoarea merge prin pipe direct în fișier, creat exclusiv (O_EXCL), apoi ACL explicit (moștenire tăiată,
#      doar contul curent, SYSTEM, Administrators);
#   4. afișează doar „OK” (sau UUID-ul pentru reconciliere, dacă scrierea locală eșuează după creare). Niciodată valoarea.
# NU face: ștergere, rotire, citirea altor secrete, alt SQL.
# Risc rezidual (configurarea serverului, nu a scriptului): integritatea psql.exe / python.exe și ACL-ul directoarelor lor.
# Review Jakarinos 06.11.2026 r1 (NO-GO) → r2.
# ============================================================================
set -euo pipefail
NUME="${1:-}"
[[ $# -eq 1 && "$NUME" =~ ^[A-Z][A-Z0-9_]{1,58}_SECRET$ ]] || { echo "REFUZ: un singur argument, NUME_SECRET (litere mari, cifre, _ ; se termină în _SECRET)"; exit 2; }
DIR_WIN='C:\Users\Gazpet-Ai\.secrete'
FISIER_WIN="$DIR_WIN\\$(echo "$NUME" | tr 'A-Z' 'a-z').txt"
PY=("/c/Program Files/Python313/python.exe" -I -X utf8)
PSQL=(env -u PGPASSWORD -u PGOPTIONS -u PGSERVICE -u PSQLRC /c/Users/Public/pgsql/bin/psql.exe -X -w -q -At -v ON_ERROR_STOP=1
      -h aws-1-eu-central-1.pooler.supabase.com -p 5432 -U postgres.dxczwkbciseqniprspcu -d postgres)

VERIFICA_CALE='
import os, sys, stat
d, f = sys.argv[1], sys.argv[2]
os.makedirs(d, exist_ok=True)
for p in (r"C:\Users", r"C:\Users\Gazpet-Ai", d):
    st = os.lstat(p)
    if (getattr(st, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT) or os.path.islink(p):
        print("REFUZ: calea contine un symlink/junction:", p); sys.exit(3)
if os.path.normcase(os.path.realpath(d)) != os.path.normcase(d):
    print("REFUZ: directorul .secrete nu e pe calea asteptata"); sys.exit(3)
if os.path.lexists(f):
    print("REFUZ: fisierul local exista deja -", f, "- nu suprascriu"); sys.exit(3)
'
# stdin = o linie „uuid|valoare”; creează fișierul EXCLUSIV, scrie doar valoarea, taie moștenirea ACL; afișează doar UUID-ul la eroare
SCRIE_EXCLUSIV='
import os, re, subprocess, sys
f = sys.argv[1]
linie = sys.stdin.read().strip()
m = re.fullmatch(r"([0-9a-f-]{36})\|([0-9a-f]{64})", linie)
if not m:
    print("EROARE: raspuns neasteptat din Vault (nimic scris local)"); sys.exit(4)
uid, val = m.groups()
try:
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
except FileExistsError:
    print("EROARE: fisierul a aparut intre timp; secretul creat in Vault are id", uid, "- reconciliere manuala"); sys.exit(4)
with os.fdopen(fd, "w") as h:
    h.write(val + "\n")
u = os.environ.get("USERNAME", "")
r = subprocess.run(["icacls", f, "/inheritance:r", "/grant:r", u + ":F", "SYSTEM:F", "*S-1-5-32-544:F"], capture_output=True)
if r.returncode != 0:
    os.remove(f)
    print("EROARE: ACL-ul nu a putut fi setat; fisierul sters; secretul din Vault are id", uid, "- reconciliere manuala"); sys.exit(4)
print("OK: secret creat in Vault (id", uid + ") si scris in", f, "- 64 hex, ACL doar", u + "/SYSTEM/Administrators; valoarea nu se afiseaza")
'

"${PY[@]}" -c "$VERIFICA_CALE" "$DIR_WIN" "$FISIER_WIN" || exit 3
EXISTA=$("${PSQL[@]}" -v nume="$NUME" -c "SELECT count(*) FROM vault.secrets WHERE name = :'nume'" 2>&1) || { echo "EROARE: Vault inaccesibil"; exit 4; }
[[ "$EXISTA" == "0" ]] || { echo "REFUZ: secretul $NUME există deja în Vault — nu suprascriu"; exit 3; }

DESCR="creat cu scripts/server/secret_nou.sh la $(date -u +%Y-%m-%dT%H:%MZ)"
"${PSQL[@]}" -v nume="$NUME" -v descr="$DESCR" 2>/dev/null <<'SQL' | "${PY[@]}" -c "$SCRIE_EXCLUSIV" "$FISIER_WIN"
SELECT vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), :'nume', :'descr') AS id \gset
SELECT :'id' || '|' || decrypted_secret FROM vault.decrypted_secrets WHERE id = :'id'::uuid;
SQL
