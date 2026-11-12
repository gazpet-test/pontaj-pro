#!/usr/bin/env bash
# Portal E1 r21: schemele expuse de API-ul REST (PostgREST) al proiectului, citite din raspunsul API-ului, DOAR CITIRE.
# Setarea nu se poate citi din baza pe Supabase (porti_citire.sql J = 0 randuri: vine din configurarea proiectului), deci
# se intreaba API-ul: o cerere GET cu un profil de schema inexistent primeste eroarea PGRST106, care listeaza schemele
# expuse. Nu scrie nimic, nu foloseste date, nu afiseaza cheia.
#
# Utilizare (coordonatorul, la fiecare proba / livrare 18a-19a):
#   SUPABASE_URL=<adresa proiectului> SUPABASE_ANON_KEY=<cheia publica> bash scripts/portal/scheme_expuse.sh
#   ... scheme_expuse.sh --tinta-host <host> --user <utilizator>   # r22: API-ul trebuie sa fie AL TINTEI bazei de date
#   bash scripts/portal/scheme_expuse.sh --raspuns <fisier.json>   # doar interpretarea unui raspuns salvat
#   bash scripts/portal/scheme_expuse.sh --test                    # interpretarea + legarea pe exemple
# r22 (Jakarinos r21 P2): dry_prod_e1.sh si livrare_e1.sh il apeleaza OBLIGATORIU cu --tinta-host / --user, inainte de
# orice conexiune la baza. Legarea API <-> tinta: referinta proiectului (20 de litere / cifre) din utilizatorul pooler-ului
# (postgres.<ref>) sau din host-ul direct (db.<ref>.supabase.co) => SUPABASE_URL trebuie sa fie EXACT https://<ref>.supabase.co.
# Fara referinta in host / utilizator (cluster local de proba) se accepta DOAR un API pe 127.0.0.1 / localhost (http);
# altfel refuz 3 (nu se poate dovedi ca API-ul intrebat e al bazei tinta). Referinta si cheia nu se tiparesc.
# Cod: 0 = net NU e expusa (lista tiparita); 1 = net e expusa (poarta portalului trebuie considerata rosie);
#      2 = raspuns nerecunoscut / fara lista = NECUNOSCUT (nu e „OK”); 3 = parametri lipsa / API nelegat de tinta.
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

# r22: $1 = host-ul tintei, $2 = utilizatorul, $3 = URL-ul API-ului. Tipareste motivul refuzului; 0 = legat, 3 = nu.
leaga() {
  local h="$1" u="$2" url="${3%/}" ref=''
  if [[ "$u" =~ ^postgres\.([a-z0-9]{20})$ ]]; then ref="${BASH_REMATCH[1]}"
  elif [[ "$h" =~ ^db\.([a-z0-9]{20})\.supabase\.co$ ]]; then ref="${BASH_REMATCH[1]}"
  fi
  if [ -n "$ref" ]; then
    [ "$url" = "https://$ref.supabase.co" ] && return 0
    echo 'REFUZ: SUPABASE_URL nu e API-ul proiectului bazei tinta (cerut https://<referinta din utilizator / host>.supabase.co)'
    return 3
  fi
  [[ "$url" =~ ^http://(127[.]0[.]0[.]1|localhost):[0-9]{1,5}$ ]] && return 0
  echo 'REFUZ: tinta fara referinta de proiect in utilizator / host: doar un API local (http://127.0.0.1:<port>) e acceptat'
  return 3
}

if [ "${1:-}" = --test ]; then
  e=0
  R='abcdefghijklmnopqrst'
  for caz in "pooler|aws-0-eu.pooler.supabase.com|postgres.$R|https://$R.supabase.co|0" \
             "pooler_slash|aws-0-eu.pooler.supabase.com|postgres.$R|https://$R.supabase.co/|0" \
             "direct|db.$R.supabase.co|postgres|https://$R.supabase.co|0" \
             "alt_proiect|aws-0-eu.pooler.supabase.com|postgres.$R|https://zzzzzzzzzzzzzzzzzzzz.supabase.co|3" \
             "http_pe_prod|aws-0-eu.pooler.supabase.com|postgres.$R|http://$R.supabase.co|3" \
             "local_pe_prod|aws-0-eu.pooler.supabase.com|postgres.$R|http://127.0.0.1:8000|3" \
             "local|127.0.0.1|postgres|http://127.0.0.1:8000|0" \
             "local_fara_ref_dar_https|10.0.0.5|postgres|https://$R.supabase.co|3" \
             "local_alt_host|127.0.0.1|postgres|http://192.168.1.2:8000|3" \
             "subdomeniu_fals|aws-0-eu.pooler.supabase.com|postgres.$R|https://$R.supabase.co.exemplu.invalid|3"; do
    IFS='|' read -r n h u url asteptat <<<"$caz"
    rc=0; leaga "$h" "$u" "$url" >/dev/null || rc=$?
    if [ "$rc" = "$asteptat" ]; then echo "OK   leaga $n -> $rc"; else echo "PICA leaga $n -> $rc (asteptat $asteptat)"; e=1; fi
  done
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
T_HOST='' T_USER='' LEGAT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tinta-host) [ $# -ge 2 ] || { echo 'optiunea --tinta-host fara valoare' >&2; exit 3; }; T_HOST="$2"; shift 2 ;;
    --user) [ $# -ge 2 ] || { echo 'optiunea --user fara valoare' >&2; exit 3; }; T_USER="$2"; shift 2 ;;
    *) echo "optiune nepermisa: $1" >&2; exit 3 ;;
  esac
done
[ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ] || { echo 'cerut SUPABASE_URL si SUPABASE_ANON_KEY in mediu' >&2; exit 3; }
if [ -n "$T_HOST" ] || [ -n "$T_USER" ]; then
  [ -n "$T_HOST" ] && [ -n "$T_USER" ] || { echo 'cerut --tinta-host SI --user' >&2; exit 3; }
  rc=0; leaga "$T_HOST" "$T_USER" "$SUPABASE_URL" >&2 || rc=$?
  [ "$rc" = 0 ] || exit 3
  LEGAT=1
else
  case "$SUPABASE_URL" in https://*) ;; *) echo 'SUPABASE_URL trebuie sa inceapa cu https://' >&2; exit 3 ;; esac
fi
if [ "$LEGAT" = 1 ]; then echo 'API legat de tinta (referinta proiectului din utilizator / host, sau API local de proba)'; fi
# Cheia trece doar prin antete citite dintr-un fisier temporar (nu apare in linia de comanda a procesului).
H="$(mktemp)"; trap 'rm -f "$H"' EXIT
printf 'apikey: %s\nAuthorization: Bearer %s\nAccept-Profile: %s\n' "$SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY" "$PROFIL_SONDA" >"$H"
R="$(curl -sS --max-time 20 -H @"$H" "${SUPABASE_URL%/}/rest/v1/portal_e1_sonda?limit=1" 2>&1)" || { echo "NECUNOSCUT: cererea a esuat" >&2; exit 2; }
rc=0; interpreteaza "$R" || rc=$?; exit "$rc"
