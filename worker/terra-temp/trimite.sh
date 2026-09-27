#!/bin/sh
# Terra -> IoT, o singură încercare per rulare. POSIX sh, fără jq/python.
set -u
umask 077
LC_ALL=C
export LC_ALL
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

SECRET_FILE=/root/.terra_temp_secret
URL_FILE=/root/.terra_temp_url
LOG_FILE=/var/log/terra-temp.log

log_error() {
  if [ -f "$LOG_FILE" ]; then
    size=$(wc -c < "$LOG_FILE")
    if [ "$size" -ge 100000 ]; then mv -f "$LOG_FILE" "$LOG_FILE.1"; fi
  fi
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG_FILE"
  printf '%s\n' "$1" >&2
}

if [ ! -f "$SECRET_FILE" ] || [ -L "$SECRET_FILE" ] || [ "$(stat -c '%a' "$SECRET_FILE" 2>/dev/null)" != 600 ]; then
  log_error 'Secret absent sau permisiuni diferite de 600 (symlink interzis).'
  exit 1
fi
secret=$(cat "$SECRET_FILE")
# Un secret este o singură linie fără caractere de control (previne injectarea de headere).
if [ -z "$secret" ] || printf '%s' "$secret" | LC_ALL=C grep -q '[[:cntrl:]]'; then
  log_error 'Format invalid pentru secret.'
  exit 1
fi
if [ ! -r "$URL_FILE" ]; then log_error 'Fișierul URL lipsește.'; exit 1; fi
url=$(cat "$URL_FILE")
case "$url" in
  https://*/functions/v1/iot-terra) ;;
  *) log_error 'URL invalid: necesar endpoint HTTPS /functions/v1/iot-terra.'; exit 1 ;;
esac

tmp=$(mktemp -d /tmp/terra-temp.XXXXXXXX) || { log_error 'Nu pot crea directorul temporar.'; exit 1; }
cleanup() {
  rm -f "$tmp/headers" "$tmp/body"
  rmdir "$tmp"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM
printf 'x-terra-secret: %s\nContent-Type: application/json\n' "$secret" > "$tmp/headers"
unset secret

# Doar temperaturi valide numeric; senzorii absenți/defecți sunt omiși.
temp_grade() {
  awk -v divisor="$2" 'NR == 1 && $1 ~ /^-?[0-9]+([.][0-9]+)?$/ {
    v = $1 / divisor; if (v >= -20 && v <= 120) printf "%.3f", v
  }' "$1" 2>/dev/null
}
ambient=
cpu=
for zone in /sys/class/thermal/thermal_zone*; do
  [ -r "$zone/type" ] && [ -r "$zone/temp" ] || continue
  type=$(cat "$zone/type")
  case "$type" in
    acpitz|x86_pkg_temp)
      t=$(temp_grade "$zone/temp" 1000)
      [ -n "$t" ] || continue
      # Mai multe zone de același tip: păstrăm maximul.
      if [ "$type" = acpitz ]; then
        ambient=$(awk -v a="$ambient" -v b="$t" 'BEGIN { print (a == "" || b > a ? b : a) }')
      else
        cpu=$(awk -v a="$cpu" -v b="$t" 'BEGIN { print (a == "" || b > a ? b : a) }')
      fi ;;
  esac
done
nvme=
for hw in /sys/class/hwmon/hwmon*; do
  [ -r "$hw/name" ] || continue
  [ "$(cat "$hw/name")" = nvme ] || continue
  for input in "$hw"/temp*_input; do
    [ -r "$input" ] || continue
    t=$(temp_grade "$input" 1000)
    [ -n "$t" ] || continue
    nvme="${nvme}${nvme:+,}${t}"
  done
done
discuri=
n=0
for dev in /dev/sd?; do
  [ -b "$dev" ] || continue
  [ "$n" -lt 16 ] || break
  # smartctl poate întoarce un cod nenul și când raportul conține temperatura.
  t=$(smartctl -A "$dev" 2>/dev/null | awk '$2 == "Temperature_Celsius" && $10 ~ /^-?[0-9]+([.][0-9]+)?$/ {
    if ($10 >= -20 && $10 <= 120) { print $10; exit }
  }')
  [ -n "$t" ] || continue
  discuri="${discuri}${discuri:+,}{\"dev\":\"${dev}\",\"temp\":${t}}"
  n=$((n + 1))
done
uptime=$(awk '$1 ~ /^[0-9]+([.][0-9]+)?$/ { printf "%.0f", int($1); exit }' /proc/uptime 2>/dev/null)
{
  printf '{"nvme":[%s],"discuri":[%s]' "$nvme" "$discuri"
  [ -z "$ambient" ] || printf ',"ambient":%s' "$ambient"
  [ -z "$cpu" ] || printf ',"cpu":%s' "$cpu"
  [ -z "$uptime" ] || printf ',"uptime_s":%s' "$uptime"
  printf '}\n'
} > "$tmp/body"

# Secretul apare numai în fișierul 600, niciodată în argv sau în log.
status=$(curl --disable --silent --output /dev/null --write-out '%{http_code}' --max-time 20 \
  --proto '=https' --request POST --header "@$tmp/headers" --data-binary "@$tmp/body" "$url")
rc=$?
if [ "$rc" -ne 0 ]; then log_error "Trimitere eșuată: curl cod $rc."; exit 1; fi
case "$status" in
  2??) exit 0 ;;
  *) log_error "Trimitere eșuată: HTTP $status."; exit 1 ;;
esac
