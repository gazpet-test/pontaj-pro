#!/bin/sh
# run_pilot.sh — pornire pe Terra (ca root, prin SSH). Folderele de licitații au ACL doar pentru oamenii din birou;
# NU le schimbăm drepturile. Copiem documentația într-un staging al pilotului (citibil de uid 1000), rulăm, apoi ștergem copia.
# Folosire: sh run_pilot.sh "<folder licitație pe NAS>" [sarcina] [licitatie_id] [nr_anunt]
# Pentru source_pack: licitatie_id + nr_anunt sunt OBLIGATORII (identitatea pack-ului o dă omul/ERP-ul, nu modelul).
set -u
SRC="${1:?folderul licitației}"; TASK="${2:-lectura_licitatie}"; LIC_ID="${3:-}"; LIC_NR_ANUNT="${4:-}"
if [ "$TASK" = "source_pack" ] && [ -z "$LIC_ID" ]; then echo "ABORT: source_pack cere licitatie_id (arg 3) și nr_anunt (arg 4)"; exit 1; fi
D=/Volume1/docker/gazpet-claude-cli
DC=/Volume1/@apps/DockerEngine/dockerd/bin/docker-compose
[ -d "$SRC" ] || { echo "ABORT: nu există $SRC"; exit 1; }
if [ "$TASK" = "plansa_felii" ] && [ ! -f "$SRC/manifest.json" ]; then echo "ABORT: plansa_felii cere folderul pregătit, cu manifest.json"; exit 2; fi
command -v flock >/dev/null || { echo "ABORT: flock lipsește; nu se poate bloca pilotul"; exit 2; }
exec 9>"$D/.pilot.lock" || exit 2
flock -n 9 || { echo "ABORT: pilotul rulează deja (.pilot.lock); staging-ul existent rămâne intact"; exit 3; }
# Lock-ul rămâne deschis până după curățare. Nu ștergem niciodată rădăcina staging.
mkdir -p "$D/staging" || exit 2
ST="$D/staging/$(date +%Y%m%d_%H%M%S)_$$"
mkdir "$ST" || { echo "ABORT: staging unic nu poate fi creat"; exit 2; }
curata() { rm -rf -- "$ST"; }
trap curata EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
cp -r "$SRC"/. "$ST"/ && chown -R 1000:1000 "$ST" && chmod -R u+rX,go-rwx "$ST" || { echo "ABORT: pregătirea staging-ului a eșuat"; exit 2; }
echo "staging: $(find "$ST" -type f | wc -l) fișiere din $SRC"
cd "$D" && LIC_FOLDER="$ST" LIC_ID="$LIC_ID" LIC_NR_ANUNT="$LIC_NR_ANUNT" $DC -p gazpet-claude-cli run --rm claude-cli "$TASK"
COD=$?
echo "pilot terminat; curățare staging propriu; cod=$COD"
exit $COD
