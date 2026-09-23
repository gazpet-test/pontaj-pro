#!/bin/sh
# Pornește workerul din repo (clonat în /app) și îl repornește când apare un commit nou pe ramură.
set -u
REPO_URL="${REPO_URL:-https://github.com/gazpet-test/pontaj-pro.git}"
BRANCH="${REPO_BRANCH:-main}"
if [ ! -d /app/.git ]; then
  echo "[entrypoint] clonez $REPO_URL ($BRANCH)"
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" /app || { echo "[entrypoint] clonarea a picat"; sleep 60; exit 1; }
fi
git config --global --add safe.directory /app
OPRIRE=0
trap 'OPRIRE=1; [ -n "$COPIL" ] && kill -TERM "$COPIL" 2>/dev/null' TERM INT
while true; do
  # clona e single-branch (clone -b): origin/<altă ramură> nu există după schimbarea REPO_BRANCH → folosim FETCH_HEAD
  git -C /app fetch -q --depth 1 origin "$BRANCH" && git -C /app reset -q --hard FETCH_HEAD
  SHA="$(git -C /app rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "[entrypoint] pornesc workerul la commit $SHA ($BRANCH)"
  # sh e PID 1 și nu transmite SIGTERM copilului (docker stop ar aștepta 10 s și ar da kill): îl transmitem noi
  WORKER_GIT_SHA="$SHA" REPO_BRANCH="$BRANCH" deno run --allow-net --allow-env --allow-read=/app,/deno-dir,/tmp,/packs --allow-write=/deno-dir,/tmp,/packs --allow-run=git,pdftotext,pdfinfo /app/worker/ofertare/main.ts &
  COPIL=$!
  wait "$COPIL"; COD=$?
  # la SIGTERM primul wait se întrerupe imediat (cod 143) cât timp copilul încă termină felia curentă;
  # al doilea wait chiar așteaptă ieșirea lui — altfel sh (PID 1) iese și containerul omoară workerul mid-apel
  if [ "$OPRIRE" = "1" ]; then wait "$COPIL"; COD=$?; echo "[entrypoint] oprit la cerere (cod $COD)"; exit 0; fi
  echo "[entrypoint] workerul s-a oprit (cod $COD), repornesc în 15 s"
  sleep 15
done
