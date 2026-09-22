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
while true; do
  git -C /app fetch -q --depth 1 origin "$BRANCH" && git -C /app reset -q --hard "origin/$BRANCH"
  SHA="$(git -C /app rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "[entrypoint] pornesc workerul la commit $SHA ($BRANCH)"
  WORKER_GIT_SHA="$SHA" REPO_BRANCH="$BRANCH" deno run --allow-net --allow-env --allow-read=/app,/deno-dir --allow-write=/deno-dir --allow-run=git /app/worker/ofertare/main.ts
  echo "[entrypoint] workerul s-a oprit (cod $?), repornesc în 15 s"
  sleep 15
done
