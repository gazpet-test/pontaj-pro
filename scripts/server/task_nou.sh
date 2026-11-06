#!/usr/bin/env bash
# ============================================================================
# task_nou.sh "<Nume> (Gazpet)" <script.py> <minute> — creează UN task nou în Task Scheduler pe serverul AI, care rulează un
# script Python la interval de minute. Decizie Răzvan 06.11.2026: singura cale prin care Claude creează task-uri fără aprobare
# manuală (regula din settings.local.json permite doar acest script).
#
# Face exact atât:
#   1. numele se termină în „ (Gazpet)” (litere/cifre/spații/._-); intervalul e 1–1439 minute (zecimal);
#   2. scriptul e un .py existent sub C:\Users\Public\ sau C:\ProgramData\Gazpet\, verificat pe calea REALĂ (fără junction / symlink
#      pe nicio componentă, fără UNC) ȘI identic byte cu byte cu un fișier din origin/main al repo-ului (cod revizuit + mergeuit);
#   3. refuză dacă task-ul există (nu suprascrie: fără /F, stdin din /dev/null — o confirmare de suprascriere eșuează);
#   4. programul rulat e DOAR C:\Program Files\Python313\pythonw.exe -I -B "<script>" (-I izolat: fără folderul scriptului în
#      sys.path și fără PYTHON* / site de utilizator — un modul străin pus lângă script nu se importă).
# NU face: ștergere, oprire, modificare de task-uri, alt program, alte argumente.
# Risc rezidual (configurarea serverului): scriptul poate fi modificat DUPĂ programare de cine are drept de scriere în director;
# C:\Users\Public permite Modify grupurilor INTERACTIVE/SERVICE/BATCH. Pentru task-uri sensibile: C:\ProgramData\Gazpet cu ACL strict.
# Review Jakarinos 06.11.2026 r1, r2 (NO-GO) → r3.
# ============================================================================
set -euo pipefail
NUME="${1:-}"; SCRIPT="${2:-}"; MIN="${3:-}"
REPO=/c/Users/Gazpet-Ai/gazpet-erp
[[ $# -eq 3 ]] || { echo "REFUZ: exact 3 argumente: \"<Nume> (Gazpet)\" <script.py> <minute>"; exit 2; }
[[ "$NUME" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{1,80}\ \(Gazpet\)$ ]] || { echo "REFUZ: numele trebuie să se termine în \" (Gazpet)\" (litere, cifre, spații, ._-)"; exit 2; }
[[ "$MIN" =~ ^[0-9]{1,4}$ ]] && (( 10#$MIN >= 1 && 10#$MIN <= 1439 )) || { echo "REFUZ: intervalul trebuie să fie 1–1439 minute"; exit 2; }
MIN=$((10#$MIN))
[[ "$SCRIPT" != *..* && "$SCRIPT" == *.py ]] || { echo "REFUZ: scriptul trebuie să fie un .py, fără „..”"; exit 2; }
WIN=$(cygpath -w "$SCRIPT" 2>/dev/null || true)

CALE_REALA='
import os, stat, sys
p = sys.argv[1]
if p.startswith("\\\\") or not os.path.isabs(p):
    print("REFUZ: cale UNC sau relativa"); sys.exit(2)
cur = os.path.splitdrive(p)[0] + "\\"
for parte in os.path.normpath(p).split("\\")[1:]:
    cur = os.path.join(cur, parte)
    try: st = os.lstat(cur)
    except FileNotFoundError: print("REFUZ: scriptul nu exista:", p); sys.exit(2)
    if (getattr(st, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT) or os.path.islink(cur):
        print("REFUZ: junction/symlink pe cale:", cur); sys.exit(2)
real = os.path.normcase(os.path.realpath(p))
if real != os.path.normcase(os.path.normpath(p)) or not (real.startswith("c:\\users\\public\\") or real.startswith("c:\\programdata\\gazpet\\")):
    print("REFUZ: scriptul trebuie sa fie (real) sub C:\\Users\\Public\\ sau C:\\ProgramData\\Gazpet\\"); sys.exit(2)
if not os.path.isfile(real):
    print("REFUZ: nu e fisier:", p); sys.exit(2)
'
"/c/Program Files/Python313/python.exe" -I -X utf8 -c "$CALE_REALA" "$WIN" || exit 2
[[ "$WIN" != *'"'* ]] || { echo "REFUZ: ghilimele în cale"; exit 2; }

# conținutul trebuie să fie exact un blob din origin/main (cod revizuit și mergeuit)
git -C "$REPO" fetch -q origin main 2>/dev/null || { echo "REFUZ: nu pot actualiza origin/main (sursa de încredere) — reîncearcă"; exit 4; }
BLOB=$(git -C "$REPO" hash-object --no-filters "$SCRIPT")
git -C "$REPO" ls-tree -r origin/main | awk '{print $3}' | grep -qx "$BLOB" \
  || { echo "REFUZ: conținutul scriptului nu e identic cu niciun fișier din origin/main (blob $BLOB) — copiază-l din main"; exit 2; }

export MSYS_NO_PATHCONV=1
SCHT=/c/Windows/System32/schtasks.exe
Q=$("$SCHT" /Query /TN "$NUME" 2>&1 </dev/null) && { echo "REFUZ: task-ul \"$NUME\" există deja — nu suprascriu"; exit 3; }
[[ "$Q" == *"cannot find"* || "$Q" == *"nu poate găsi"* || "$Q" == *"does not exist"* ]] || { echo "EROARE: nu pot verifica dacă task-ul există: ${Q:0:120}"; exit 4; }
"$SCHT" /Create /TN "$NUME" /SC MINUTE /MO "$MIN" /TR "\"C:\\Program Files\\Python313\\pythonw.exe\" -I -B \"$WIN\"" </dev/null >/dev/null
"$SCHT" /Query /TN "$NUME" </dev/null >/dev/null 2>&1 || { echo "EROARE: task-ul nu apare după creare"; exit 4; }
echo "OK: task \"$NUME\" creat — pythonw.exe -I -B $WIN la $MIN minute (blob $BLOB din origin/main)"
