#!/bin/sh
# run_pilot.sh — pornire pe Terra (ca root, prin SSH). Folderele de licitații au ACL doar pentru oamenii din birou;
# NU le schimbăm drepturile. Copiem documentația într-un staging al pilotului (citibil de uid 1000), rulăm, apoi ștergem copia.
# Folosire: sh run_pilot.sh "<folder licitație pe NAS>" [sarcina] [licitatie_id] [nr_anunt]
# Pentru source_pack: licitatie_id + nr_anunt sunt OBLIGATORII (identitatea pack-ului o dă omul/ERP-ul, nu modelul).
set -u
SRC="${1:?folderul licitației}"; TASK="${2:-lectura_licitatie}"; LIC_ID="${3:-}"; LIC_NR_ANUNT="${4:-}"
if [ "$TASK" = "source_pack" ] && [ -z "$LIC_ID" ]; then echo "ABORT: source_pack cere licitatie_id (arg 3) și nr_anunt (arg 4)"; exit 1; fi
D=/Volume1/docker/gazpet-claude-cli; ST="$D/staging"
DC=/Volume1/@apps/DockerEngine/dockerd/bin/docker-compose
[ -d "$SRC" ] || { echo "ABORT: nu există $SRC"; exit 1; }
rm -rf "$ST" && mkdir -p "$ST" && cp -r "$SRC"/. "$ST"/ && chown -R 1000:1000 "$ST" && chmod -R u+rX,go-rwx "$ST"
echo "staging: $(find "$ST" -type f | wc -l) fișiere din $SRC"
cd "$D" && LIC_FOLDER="$ST" LIC_ID="$LIC_ID" LIC_NR_ANUNT="$LIC_NR_ANUNT" $DC -p gazpet-claude-cli run --rm claude-cli "$TASK"
COD=$?
rm -rf "$ST"; echo "staging șters; cod=$COD"
exit $COD
