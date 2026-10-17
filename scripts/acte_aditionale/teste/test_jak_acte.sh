#!/bin/bash
# Test jak_acte.sh fara run_paw: doar argumente, "nimic nou", fisiere lipsa si --doar-brief, pe directoare temporare.
# Rulare (Git Bash): "C:\Program Files\Git\bin\bash.exe" scripts/acte_aditionale/teste/test_jak_acte.sh
set -u
S="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/jak_acte.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export ACTE_BAZA="$T/acte" PAW_BRIEF_DIR="$T/brief"
E=0
ok() { if [ "$1" = "$2" ]; then echo "  OK   $3"; else echo "  ESEC $3 (astept $2, am $1)"; E=$((E+1)); fi; }

bash "$S" >/dev/null; ok $? 1 "fara argument -> 1"
bash "$S" 16.10.2026 >/dev/null; ok $? 1 "data in alt format -> 1"
bash "$S" 2026-10-16 --scrie >/dev/null; ok $? 1 "argument necunoscut -> 1"
bash "$S" 2026-10-16 >/dev/null; ok $? 3 "lipseste lista.tsv -> 3"

F="$ACTE_BAZA/2026-10-16"; mkdir -p "$F"
printf 'id\tcod\tfisier_local\tcale_nas\tkb\tmodificat\tmotiv\r\n' > "$F/lista.tsv"
O="$(bash "$S" 2026-10-16)"; ok $? 0 "lista doar cu antet -> 0"
case "$O" in *"Nimic nou"*) ok 1 1 "mesaj Nimic nou";; *) ok 0 1 "mesaj Nimic nou";; esac
[ -d "$PAW_BRIEF_DIR" ]; ok $? 1 "nimic nou -> niciun brief scris"

printf '1\tUNU\tC:\\x\\a.pdf\t\\\\nas\\a.pdf\t1\t2026-10-16\tNOU\r\n' >> "$F/lista.tsv"
bash "$S" 2026-10-16 >/dev/null; ok $? 3 "lipseste erp.md -> 3"

echo '# ERP' > "$F/erp.md"
O="$(bash "$S" 2026-10-16 --doar-brief)"; ok $? 0 "--doar-brief -> 0"
B="$(ls "$PAW_BRIEF_DIR"/acte_2026-10-16_*.md 2>/dev/null | head -1)"
[ -n "$B" ]; ok $? 0 "brief scris in PAW_BRIEF_DIR"
grep -q 'Jakarinos — verificarea' "$B"; ok $? 0 "brief contine TEMA_ACTE.md"
grep -q 'Folderul rularii' "$B"; ok $? 0 "brief contine folderul rularii"
case "$O" in *'C:\ProgramData\Gazpet\Paw\bin\run_paw.cmd jak '*'paw-data\out\acte_2026-10-16_'*) ok 1 1 "comanda prin run_paw jak, iesire in paw-data\\out";; *) ok 0 1 "comanda prin run_paw jak";; esac
[ ! -e "$F/.jak_ruleaza" ]; ok $? 0 "--doar-brief nu ia blocajul"

[ $E -eq 0 ] && { echo "TOATE TESTELE TREC"; exit 0; } || { echo "ESECURI: $E"; exit 1; }
