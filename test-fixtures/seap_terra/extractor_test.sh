#!/usr/bin/env bash
# Teste negative pentru extractorul izolat (worker/ofertare/extractor/extractor.sh), rulat local cu 7z (p7zip).
# Arhive malițioase / stricate: zip-bomb, prea multe fișiere, fișier prea mare, symlink, cale greșită, arhivă trunchiată.
set -uo pipefail
cd "$(dirname "$0")/../.."
X=$PWD/worker/ofertare/extractor/extractor.sh
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
ok=0; fail=0
t() { if [ "$2" = "1" ]; then ok=$((ok+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1 — $3"; fi; }
job() {  # $1 nume job, $2 arhivă (cale), $3 prima (opțional)
  mkdir -p "$D/w/$1/in"; cp "$2" "$D/w/$1/in/"; echo "${3:-$(basename "$2")}" > "$D/w/$1/prima"
}
ruleaza() { LUCRU=$D/w SEVENZIP=7z O_DATA=1 "$@" sh "$X"; }
cere() { echo "$2" > "$D/w/$1/cerere"; }
rez() { head -n 1 "$D/w/$1/rezultat" 2>/dev/null; }
motiv() { tail -n +2 "$D/w/$1/rezultat" 2>/dev/null; }

mkdir -p "$D/src/PT"; echo a > "$D/src/PT/a.pdf"; echo b > "$D/src/PT/b.txt"
(cd "$D/src" && 7z a -tzip -bd "$D/bun.zip" PT >/dev/null)
head -c 20000000 /dev/zero > "$D/src/zero.bin"; (cd "$D/src" && 7z a -tzip -bd "$D/bomba.zip" zero.bin >/dev/null)
mkdir -p "$D/src/multe"; for i in $(seq 1 30); do echo $i > "$D/src/multe/f$i.txt"; done
(cd "$D/src" && 7z a -tzip -bd "$D/multe.zip" multe >/dev/null)
head -c 1000000 /dev/urandom > "$D/src/mare.bin"; (cd "$D/src" && 7z a -tzip -bd "$D/mare.zip" mare.bin >/dev/null)
mkdir -p "$D/src/sl"; ln -s /etc/passwd "$D/src/sl/parola"; (cd "$D/src" && zip -qry "$D/symlink.zip" sl)
mkdir -p "$D/src/slr"; echo x > "$D/src/slr/a.txt"; ln -s a.txt "$D/src/slr/leg"; (cd "$D/src" && zip -qry "$D/symrel.zip" slr)
head -c $(( $(stat -c %s "$D/mare.zip") / 2 )) "$D/mare.zip" > "$D/trunchiat.zip"

# 1. listare + extragere normală
job bun "$D/bun.zip"; cere bun l; ruleaza env
t "E01 listare normală: cod 0 + intrări" "$([ "$(cat $D/w/bun/listare.cod)" = 0 ] && grep -q 'Path = PT/a.pdf' $D/w/bun/listare.txt && echo 1)" "$(cat $D/w/bun/listare.err)"
cere bun x; ruleaza env
t "E02 extragere normală: rezultat 0, fișierele în out/" "$([ "$(rez bun)" = 0 ] && [ -f $D/w/bun/out/PT/a.pdf ] && echo 1)" "$(motiv bun)"

# 2. zip-bomb: limita de spațiu în timpul extragerii (1 MB aici)
job bomba "$D/bomba.zip"; cere bomba x; ruleaza env MAX_KB=1024
t "E03 zip-bomb → LIMITĂ spațiu, out/ șters" "$([ "$(rez bomba)" != 0 ] && motiv bomba | grep -q 'LIMITĂ: spațiu' && [ ! -d $D/w/bomba/out ] && echo 1)" "$(rez bomba) $(motiv bomba)"

# 3. prea multe fișiere
job multe "$D/multe.zip"; cere multe x; ruleaza env MAX_FIS=10
t "E04 prea multe fișiere → LIMITĂ" "$([ "$(rez multe)" != 0 ] && motiv multe | grep -q 'fișiere create' && echo 1)" "$(motiv multe)"

# 4. un fișier peste limita pe fișier (ulimit -f: 100 blocuri = 50 KB)
job mare "$D/mare.zip"; cere mare x; ruleaza env MAX_FIS_BLK=100
t "E05 fișier peste limita pe fișier → eșec, nu succes parțial" "$([ "$(rez mare)" != 0 ] && [ ! -d $D/w/mare/out ] && echo 1)" "$(rez mare) $(motiv mare)"

# 5. legătură simbolică în arhivă
job sl "$D/symlink.zip"; cere sl x; ruleaza env
t "E06 symlink absolut → eșec (7z îl refuză), nimic de urcat" "$([ "$(rez sl)" != 0 ] && [ ! -d $D/w/sl/out ] && echo 1)" "$(motiv sl)"
job slr "$D/symrel.zip"; cere slr x; ruleaza env
t "E06b symlink relativ (7z îl creează) → RESPINS de extractor" "$([ "$(rez slr)" != 0 ] && motiv slr | grep -q 'RESPINS: arhiva conține legături' && [ ! -d $D/w/slr/out ] && echo 1)" "$(rez slr) $(motiv slr)"

# 6. nume de volum cu cale / opțiune
job rau "$D/bun.zip" "../bun.zip"; cere rau x; ruleaza env
t "E07 prima cu cale → cerere invalidă" "$([ "$(rez rau)" = 2 ] && echo 1)" "$(motiv rau)"
job opt "$D/bun.zip" "-bun.zip"; cere opt l; ruleaza env
t "E08 prima ca opțiune (-x) → listare refuzată" "$([ "$(cat $D/w/opt/listare.cod)" = 2 ] && echo 1)"

# 7. arhivă trunchiată
job tr "$D/trunchiat.zip"; cere tr x; ruleaza env
t "E09 arhivă trunchiată → eșec explicit" "$([ "$(rez tr)" != 0 ] && [ -n "$(motiv tr)" ] && echo 1)" "$(motiv tr)"

# 8. jobul terminat nu se reia
before=$(stat -c %Y "$D/w/bun/rezultat"); sleep 1; ruleaza env
t "E10 job cu rezultat nu se reprocesează" "$([ "$(stat -c %Y $D/w/bun/rezultat)" = "$before" ] && echo 1)"

echo "TOTAL $ok/$((ok+fail))"
[ "$fail" = 0 ]
