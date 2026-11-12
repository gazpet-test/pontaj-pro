#!/usr/bin/env bash
# Portal E1 r21: schemele expuse de API-ul REST (PostgREST) al proiectului, citite din raspunsul API-ului, DOAR CITIRE.
# Setarea nu se poate citi din baza pe Supabase (porti_citire.sql J = 0 randuri: vine din configurarea proiectului), deci
# se intreaba API-ul: o cerere GET cu un profil de schema inexistent primeste eroarea PGRST106, care listeaza schemele
# expuse. Nu scrie nimic, nu foloseste date, nu afiseaza cheia.
#
# Utilizare (coordonatorul, la fiecare proba / livrare 18a-19a):
#   SUPABASE_URL=<adresa proiectului> SUPABASE_ANON_KEY=<cheia publica> bash scripts/portal/scheme_expuse.sh
#   bash scripts/portal/scheme_expuse.sh --raspuns <fisier.json>   # doar interpretarea unui raspuns salvat
#   bash scripts/portal/scheme_expuse.sh --test                    # interpretarea pe raspunsuri-exemplu
# Cod: 0 = net NU e expusa (lista tiparita); 1 = net e expusa (poarta portalului trebuie considerata rosie);
#      2 = raspuns nerecunoscut / fara lista = NECUNOSCUT (nu e „OK”); 3 = parametri lipsa.
set -Eeuo pipefail

PROFIL_SONDA='portal_e1_sonda_inexistenta'

interpreteaza() { # $1 = textul raspunsului; tipareste lista, intoarce codul
  local t="$1" lista=''
  # PostgREST 12: "The schema must be one of the following: a, b"; PostgREST 13+: hint "... exposed: a, b"
  lista="$(printf '%s' "$t" | tr -d '\r\n' | sed -nE 's/.*"code" *: *"PGRST106".*(one of the following|schemas are exposed) *: *([a-z0-9_, ]*)".*/\2/p')"
  if [ -z "$lista" ]; then
    lista="$(printf '%s' "$t" | tr -d '\r\n' | sed -nE 's/.*(one of the following|schemas are exposed) *: *([a-z0-9_, ]*)".*"code" *: *"PGRST106".*/\2/p')"
  fi
  lista="$(printf '%s' "$lista" | tr -d ' ')"
  if [ -z "$lista" ]; then echo 'NECUNOSCUT: raspunsul nu are lista schemelor (PGRST106)'; return 2; fi
  echo "scheme expuse: $lista"
  if printf '%s\n' "$lista" | tr ',' '\n' | grep -qx 'net'; then echo 'ROSU: schema net e expusa prin API'; return 1; fi
  echo 'OK: net nu e expusa prin API'
  return 0
}

if [ "${1:-}" = --test ]; then
  e=0
  v12='{"code":"PGRST106","details":null,"hint":null,"message":"The schema must be one of the following: public, graphql_public"}'
  v13='{"code":"PGRST106","details":null,"hint":"Only the following schemas are exposed: public, graphql_public","message":"Invalid schema: portal_e1_sonda_inexistenta"}'
  vnet='{"code":"PGRST106","details":null,"hint":null,"message":"The schema must be one of the following: public, net"}'
  vnetwork='{"code":"PGRST106","details":null,"hint":null,"message":"The schema must be one of the following: public, network"}'
  valt='{"code":"PGRST301","details":null,"hint":null,"message":"JWT expired"}'
  for caz in "v12:0" "v13:0" "vnet:1" "vnetwork:0" "valt:2"; do
    n="${caz%%:*}"; asteptat="${caz##*:}"; rc=0
    interpreteaza "${!n}" >/dev/null || rc=$?
    if [ "$rc" = "$asteptat" ]; then echo "OK   $n -> $rc"; else echo "PICA $n -> $rc (asteptat $asteptat)"; e=1; fi
  done
  [ "$e" = 0 ] && echo 'SCHEME_EXPUSE_TEST: OK' || echo 'SCHEME_EXPUSE_TEST: PICAT'
  exit "$e"
fi
if [ "${1:-}" = --raspuns ]; then
  [ -f "${2:-}" ] || { echo 'lipseste fisierul raspunsului' >&2; exit 3; }
  rc=0; interpreteaza "$(cat "$2")" || rc=$?; exit "$rc"
fi
[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ] || { echo 'cerut SUPABASE_URL si SUPABASE_ANON_KEY in mediu' >&2; exit 3; }
case "$SUPABASE_URL" in https://*) ;; *) echo 'SUPABASE_URL trebuie sa inceapa cu https://' >&2; exit 3 ;; esac
# Cheia trece doar prin antete citite dintr-un fisier temporar (nu apare in linia de comanda a procesului).
H="$(mktemp)"; trap 'rm -f "$H"' EXIT
printf 'apikey: %s\nAuthorization: Bearer %s\nAccept-Profile: %s\n' "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" "$PROFIL_SONDA" >"$H"
R="$(curl -sS --max-time 20 -H @"$H" "${SUPABASE_URL%/}/rest/v1/portal_e1_sonda?limit=1" 2>&1)" || { echo "NECUNOSCUT: cererea a esuat" >&2; exit 2; }
rc=0; interpreteaza "$R" || rc=$?; exit "$rc"
