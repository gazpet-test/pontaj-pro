#!/bin/bash
# jak_acte.sh — Jakarinos (Codex) pe verificarea saptamanala a actelor aditionale, DOAR prin lansatorul unic run_paw (16.10.2026).
# Inlocuieste run_jak_acte.sh de pe laptop (codex exec --sandbox workspace-write): aici Codex ruleaza read-only, din run_paw.
# Pe serverul AI se porneste cu Git Bash pe cale absoluta (`bash` simplu = WSL):
#   "C:\Program Files\Git\bin\bash.exe" <repo>/scripts/acte_aditionale/jak_acte.sh <AAAA-LL-ZZ> [--doar-brief]
# Ce face:
#   1. verifica folderul rularii <BAZA>/<data> (lista.tsv + erp.md); lista doar cu antet -> "Nimic nou", NU porneste Jakarinos;
#   2. scrie brief-ul (TEMA_ACTE.md + folderul rularii) in C:\Users\Public\paw-data\brief\acte_<data>_<HHMM>.md;
#   3. run_paw.cmd jak <brief> C:\Users\Public\paw-data\out\acte_<data>_<HHMM>.log  (blocant; timeout-ul e al lansatorului);
#   4. ultima linie PAW_GATA -> exit 0; PAW_EROARE -> exit 5; fara marker -> exit 6. Limita Codex -> <folder>/limita.flag.
# Raportul (RAPORT_ACTE.md) il scrie Claude din log, dupa verificare - scriptul nu-l scrie.
# --doar-brief: scrie brief-ul si afiseaza comanda, fara sa porneasca run_paw (pentru test).
# Coduri: 0 ok / nimic nou | 1 argumente | 3 lipseste lista.tsv sau erp.md | 4 deja ruleaza | 5 PAW_EROARE | 6 fara marker
set -u
RUN_PAW='C:\ProgramData\Gazpet\Paw\bin\run_paw.cmd'      # fix: nu se suprascrie din mediu
BAZA="${ACTE_BAZA:-/c/Users/Public/paw/acte}"              # suprascris doar de teste
BRIEF_DIR="${PAW_BRIEF_DIR:-/c/Users/Public/paw-data/brief}" # run_paw refuza oricum brief-uri din afara paw-data\brief
OUT_DIR="/c/Users/Public/paw-data/out"
AICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

D="${1:-}"; MOD="${2:-}"
[[ "$D" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "folosire: jak_acte.sh <AAAA-LL-ZZ> [--doar-brief]"; exit 1; }
[ -z "$MOD" ] || [ "$MOD" = "--doar-brief" ] || { echo "argument necunoscut: $MOD"; exit 1; }
F="$BAZA/$D"
[ -f "$F/lista.tsv" ] || { echo "LIPSESTE $F/lista.tsv - ruleaza intai scan_acte.ps1"; exit 3; }
if [ "$(grep -cv '^[[:space:]]*$' "$F/lista.tsv")" -le 1 ]; then echo "Nimic nou pe NAS saptamana asta - Jakarinos nu porneste."; exit 0; fi
[ -f "$F/erp.md" ] || { echo "LIPSESTE $F/erp.md - Claude ruleaza intai export_erp.sql"; exit 3; }
[ -f "$AICI/TEMA_ACTE.md" ] || { echo "LIPSESTE TEMA_ACTE.md langa script"; exit 3; }

ORA="$(date +%H%M)"
mkdir -p "$BRIEF_DIR"
BRIEF="$BRIEF_DIR/acte_${D}_${ORA}.md"
{
  cat "$AICI/TEMA_ACTE.md"
  printf '\n## Rularea de azi\n- Folderul rularii: `%s`\n- Data: %s\n- Citesti doar din acest folder; nu scrii nimic. Raspunsul tau = continutul pentru RAPORT_ACTE.md.\n' "$(cygpath -w "$F")" "$D"
} > "$BRIEF"
BRIEF_W="$(cygpath -w "$BRIEF")"
OUT_W="$(cygpath -w "$OUT_DIR")\\acte_${D}_${ORA}.log"
echo "brief: $BRIEF_W"
echo "comanda: $RUN_PAW jak $BRIEF_W $OUT_W"
[ "$MOD" = "--doar-brief" ] && exit 0

# o singura rulare odata (mkdir e atomic); blocaj mai vechi de 2 ore = ramas de la o rulare picata
L="$F/.jak_ruleaza"
if ! mkdir "$L" 2>/dev/null; then
  if [ $(( $(date +%s) - $(stat -c %Y "$L") )) -lt 7200 ]; then echo "deja ruleaza (blocaj $L)"; exit 4; fi
  rmdir "$L" 2>/dev/null; mkdir "$L" || { echo "nu pot lua blocajul $L"; exit 4; }
fi
trap 'rmdir "$L" 2>/dev/null' EXIT
rm -f "$F/limita.flag"
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "$RUN_PAW" jak "$BRIEF_W" "$OUT_W"
LOG="$(cygpath -u "$OUT_W")"
[ -f "$LOG" ] || { echo "run_paw nu a scris $OUT_W"; exit 6; }
ULTIMA="$(grep -v '^[[:space:]]*$' "$LOG" | tail -n 1)"
if tail -n 40 "$LOG" | grep -qiE 'usage limit|rate.?limit|too many requests|quota|try again (at|in)|\b429\b'; then
  echo "$OUT_W $(date '+%F %T')" > "$F/limita.flag"; echo "LIMITA Codex -> $F/limita.flag (Claude il anunta pe Razvan)"
fi
case "$ULTIMA" in
  PAW_GATA*)   echo "gata: $ULTIMA -> log $OUT_W"; exit 0 ;;
  PAW_EROARE*) echo "eroare: $ULTIMA -> log $OUT_W"; exit 5 ;;
  *)           echo "fara marker PAW_GATA/PAW_EROARE in $OUT_W"; exit 6 ;;
esac
