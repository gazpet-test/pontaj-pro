#!/bin/sh
# Terra -> IoT (iot-retea): sondează dispozitivele de rețea (ping + temp QNAP) și trimite un lot de citiri.
# POSIX sh, o singură încercare per rulare. Fără jq/python.
set -u
umask 077
LC_ALL=C; export LC_ALL
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH

SECRET_FILE=/root/.retea_mon_secret
URL_FILE=/root/.retea_mon_url
CONF_FILE=/root/retea-mon/tinte.conf
NAS_PW_FILE=/root/.nas_pw
LOG_FILE=/var/log/retea-mon.log

log_error() {
  if [ -f "$LOG_FILE" ]; then
    size=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "${size:-0}" -ge 100000 ]; then mv -f "$LOG_FILE" "$LOG_FILE.1"; fi
  fi
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG_FILE" 2>/dev/null
  printf '%s\n' "$1" >&2
}

# secretul: o singură linie, fără caractere de control
if [ ! -r "$SECRET_FILE" ] || [ -L "$SECRET_FILE" ] || [ "$(stat -c '%a' "$SECRET_FILE" 2>/dev/null)" != 600 ]; then
  log_error 'Secret absent sau permisiuni != 600.'; exit 1
fi
secret=$(cat "$SECRET_FILE")
if [ -z "$secret" ] || printf '%s' "$secret" | LC_ALL=C grep -q '[[:cntrl:]]'; then
  log_error 'Format invalid pentru secret.'; exit 1
fi
if [ ! -r "$URL_FILE" ]; then log_error 'Fișierul URL lipsește.'; exit 1; fi
url=$(cat "$URL_FILE")
case "$url" in https://*/functions/v1/iot-retea) ;; *) log_error 'URL invalid.'; exit 1 ;; esac
if [ ! -r "$CONF_FILE" ]; then log_error 'tinte.conf lipsește.'; exit 1; fi

# Un întreg pozitiv dintr-un text de forma "40 C/104 F" (prima valoare numerică).
prima_temp() { awk '{ for(i=1;i<=NF;i++) if ($i ~ /^-?[0-9]+$/) { print $i; exit } }'; }

citiri=""
# Fiecare linie din conf: <extern_id> <ip> <tip>  (# = comentariu)
while IFS=' ' read -r extern_id ip tip _rest; do
  case "$extern_id" in ''|\#*) continue ;; esac
  [ -n "$ip" ] || continue

  online=false; latency=""
  rez=$(ping -c1 -W2 "$ip" 2>/dev/null)
  if [ $? -eq 0 ]; then
    online=true
    latency=$(printf '%s\n' "$rez" | sed -n 's/.*time=\([0-9.]*\).*/\1/p' | head -1)
  fi

  extra=""
  if [ "$online" = true ] && [ "$tip" = qnap ] && [ -r "$NAS_PW_FILE" ]; then
    # -n: ssh NU citește din stdin (altfel înghite liniile rămase din conf în bucla while-read).
    SSHP="sshpass -f $NAS_PW_FILE ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=no admin@$ip"
    st=$($SSHP "getsysinfo systmp" 2>/dev/null | prima_temp)
    hn=$($SSHP "getsysinfo hdnum" 2>/dev/null | prima_temp)
    hdmax=""
    if [ -n "${hn:-}" ]; then
      i=1
      while [ "$i" -le "$hn" ] && [ "$i" -le 16 ]; do
        ht=$($SSHP "getsysinfo hdtmp $i" 2>/dev/null | prima_temp)
        if [ -n "${ht:-}" ]; then
          if [ -z "$hdmax" ] || [ "$ht" -gt "$hdmax" ]; then hdmax="$ht"; fi
        fi
        i=$((i + 1))
      done
    fi
    [ -n "${st:-}" ] && extra="${extra},\"cpu_temp\":${st}"
    [ -n "${hdmax:-}" ] && extra="${extra},\"hdd_max\":${hdmax}"
  fi

  lat_json=""
  [ -n "${latency:-}" ] && lat_json=",\"latency_ms\":${latency}"
  citiri="${citiri}${citiri:+,}{\"extern_id\":\"${extern_id}\",\"online\":${online}${lat_json}${extra}}"
done < "$CONF_FILE"

if [ -z "$citiri" ]; then log_error 'Nicio țintă în conf.'; exit 1; fi

tmp=$(mktemp -d /tmp/retea-mon.XXXXXXXX) || { log_error 'Nu pot crea tmp.'; exit 1; }
cleanup() { rm -f "$tmp/headers" "$tmp/body"; rmdir "$tmp"; }
trap cleanup 0
trap 'exit 1' HUP INT TERM
printf 'x-retea-secret: %s\nContent-Type: application/json\n' "$secret" > "$tmp/headers"
unset secret
printf '{"citiri":[%s]}\n' "$citiri" > "$tmp/body"

status=$(curl --disable --silent --output /dev/null --write-out '%{http_code}' --max-time 25 \
  --proto '=https' --request POST --header "@$tmp/headers" --data-binary "@$tmp/body" "$url")
rc=$?
if [ "$rc" -ne 0 ]; then log_error "Trimitere eșuată: curl cod $rc."; exit 1; fi
case "$status" in 2??) exit 0 ;; *) log_error "Trimitere eșuată: HTTP $status."; exit 1 ;; esac
