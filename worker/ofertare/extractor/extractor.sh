#!/bin/sh
# Extractorul SEAP IZOLAT (24.09.2026, P0 Copilot): singurul loc unde rulează 7-Zip pe arhive venite din SEAP.
# Containerul lui NU are rețea, chei, .env, socket Docker sau alte foldere de pe NAS — vede doar /work
# (folderul de lucru comun cu workerul). Rulează ca utilizator neprivilegiat, cu FS read-only.
#
# Protocol pe fișiere (workerul scrie, extractorul răspunde) — într-un folder de job /work/<job>/:
#   in/<volume>     arhiva (sau volumele RAR, cu nume canonice)       ← worker
#   prima           numele primului volum din in/ (fără /)             ← worker
#   cerere = "l"    → listare.txt + listare.cod + listare.gata         ← extractor
#   cerere = "x"    → out/ + rezultat ("<cod>\n<motiv>")               ← extractor (doar după ce workerul a aprobat listarea)
# Politica (căi, număr, mărime declarată) o decide WORKERUL pe listare (verificaListare, testată);
# aici se impun limitele EFECTIVE, în timpul extragerii: spațiu, număr de fișiere, mărime/fișier, timp,
# plus legături simbolice și adâncime după extragere. Orice depășire = eșec, niciodată succes parțial.
set -u
W=${LUCRU:-/work}
Z=${SEVENZIP:-7zz}
MAX_KB=${MAX_KB:-6291456}            # 6 GB spațiu consumat
MAX_FIS=${MAX_FIS:-5000}             # fișiere + foldere create
MAX_FIS_BLK=${MAX_FIS_BLK:-4194304}  # 2 GB pe fișier (ulimit -f, blocuri de 512 B)
MAX_SEC=${MAX_SEC:-1200}             # 20 min
MAX_ADANC=${MAX_ADANC:-30}           # niveluri de foldere

scrie() { printf '%s\n%s\n' "$2" "$3" > "$1.tmp" && mv "$1.tmp" "$1"; }   # atomic: workerul nu citește jumătăți

prima_sigura() {  # numele vine de la worker, dar tot îl verificăm: fără căi, fără opțiuni
  p=$(cat "$1/prima" 2>/dev/null) || return 1
  case "$p" in ''|*/*|.*|-*) return 1;; esac
  [ -f "$1/in/$p" ] || return 1
  echo "$p"
}

lista() {
  j=$1
  if ! p=$(prima_sigura "$j"); then echo 2 > "$j/listare.cod"; : > "$j/listare.txt"; touch "$j/listare.gata"; return; fi
  ( cd "$j/in" && ulimit -t 120 && exec "$Z" l -slt -ba -- "$p" ) > "$j/listare.txt" 2> "$j/listare.err"
  echo $? > "$j/listare.cod"
  touch "$j/listare.gata"
}

peste_limite() {  # $1 job, $2 secunde scurse → motivul depășirii sau nimic
  kb=$(du -sk "$1/out" 2>/dev/null | cut -f1)
  n=$(find "$1/out" 2>/dev/null | wc -l)
  if [ "${kb:-0}" -gt "$MAX_KB" ]; then echo "LIMITĂ: spațiu consumat peste $MAX_KB KB"
  elif [ "$n" -gt "$MAX_FIS" ]; then echo "LIMITĂ: peste $MAX_FIS fișiere create"
  elif [ "$2" -gt "$MAX_SEC" ]; then echo "LIMITĂ: extragerea a depășit $MAX_SEC s"
  fi
}

extrage() {
  j=$1
  if ! p=$(prima_sigura "$j"); then scrie "$j/rezultat" 2 "cerere invalidă (numele volumului)"; return; fi
  mkdir -p "$j/out"
  ( cd "$j/in" && ulimit -f "$MAX_FIS_BLK" && exec "$Z" x -y -aou -bd -o../out -- "$p" ) > "$j/x.log" 2>&1 &
  pid=$!
  motiv=""; t=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1; t=$((t + 1))
    motiv=$(peste_limite "$j" "$t")
    if [ -n "$motiv" ]; then kill -KILL "$pid" 2>/dev/null; break; fi
  done
  wait "$pid"; cod=$?
  [ -z "$motiv" ] && motiv=$(peste_limite "$j" "$t")   # și după: o arhivă mică poate exploda sub o secundă
  if [ -z "$motiv" ] && [ "$cod" -ne 0 ]; then
    motiv="7z x cod $cod: $(tail -c 300 "$j/x.log" | tr '\n' ' ')"
    [ "$cod" -ge 128 ] && motiv="LIMITĂ: 7z oprit de semnal $((cod - 128)) (fișier peste $((MAX_FIS_BLK / 2097152)) GB?) — $motiv"
  fi
  if [ -z "$motiv" ] && [ -n "$(find "$j/out" -type l | head -n 1)" ]; then motiv="RESPINS: arhiva conține legături simbolice"; fi
  if [ -z "$motiv" ] && [ -n "$(find "$j/out" -mindepth "$MAX_ADANC" | head -n 1)" ]; then motiv="RESPINS: peste $MAX_ADANC niveluri de foldere"; fi
  if [ -n "$motiv" ]; then
    rm -rf "$j/out"                    # extragere parțială = nimic de urcat
    [ "$cod" -eq 0 ] && cod=3
    scrie "$j/rezultat" "$cod" "$motiv"
  else
    scrie "$j/rezultat" 0 "ok"
  fi
}

o_trecere() {
  for j in "$W"/*/; do
    j=${j%/}
    [ -f "$j/cerere" ] || continue
    case "$(cat "$j/cerere" 2>/dev/null)" in
      l) [ -f "$j/listare.gata" ] || lista "$j" ;;
      x) [ -f "$j/rezultat" ] || extrage "$j" ;;
    esac
  done
}

if [ "${O_DATA:-0}" = "1" ]; then o_trecere; exit 0; fi   # teste: o singură trecere
echo "[extractor] pornit: $W, limite ${MAX_KB} KB / ${MAX_FIS} fișiere / ${MAX_SEC} s"
while :; do o_trecere; sleep 2; done
