#!/bin/sh
# run_pilot.sh — pornire pe Terra (ca root, prin SSH). Folderele de licitații au ACL doar pentru oamenii din birou;
# NU le schimbăm drepturile. Copiem documentația într-un staging al pilotului (citibil de uid 1000), rulăm, apoi ștergem copia.
# Folosire: sh run_pilot.sh "<folder licitație pe NAS>" [sarcina]
set -u
SRC="${1:?folderul licitației}"; TASK="${2:-lectura_licitatie}"
D=/Volume1/docker/gazpet-claude-cli; ST="$D/staging"
DC=/Volume1/@apps/DockerEngine/dockerd/bin/docker-compose
[ -d "$SRC" ] || { echo "ABORT: nu există $SRC"; exit 1; }
rm -rf "$ST" && mkdir -p "$ST" && cp -r "$SRC"/. "$ST"/ && chown -R 1000:1000 "$ST" && chmod -R u+rX,go-rwx "$ST"
echo "staging: $(find "$ST" -type f | wc -l) fișiere din $SRC"
cd "$D" && LIC_FOLDER="$ST" $DC -p gazpet-claude-cli run --rm claude-cli "$TASK"
COD=$?
rm -rf "$ST"; echo "staging șters; cod=$COD"
exit $COD
