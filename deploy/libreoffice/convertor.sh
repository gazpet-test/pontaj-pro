#!/bin/sh
# SCHIȚĂ — bucla convertorului. Intrare: /conv/in/<sha256>.<ext>; ieșire: /conv/out/<sha256>.pdf + <sha256>.json
# Nu știe nimic de Supabase: workerul Terra pune fișierul, citește rezultatul și verifică hash-urile.
set -u
IN=/conv/in; OUT=/conv/out; ERR=/conv/err
mkdir -p "$OUT" "$ERR" "$HOME"
proceseaza() {
  f="$1"; b="$(basename "$f")"; h="${b%.*}"
  # numele TREBUIE să fie hash-ul conținutului — altfel refuz (nu convertesc ce nu pot lega de original)
  real="$(sha256sum "$f" | cut -d' ' -f1)"
  if [ "$real" != "$h" ]; then echo '{"eroare":"hash nepotrivit"}' > "$ERR/$h.json"; rm -f "$f"; return; fi
  lucru="$(mktemp -d)"
  if timeout 180 soffice --headless --norestore --nolockcheck "-env:UserInstallation=file://$HOME/lo" \
       --convert-to pdf --outdir "$lucru" "$f" >/dev/null 2>&1 && [ -s "$lucru/$h.pdf" ]; then
    ph="$(sha256sum "$lucru/$h.pdf" | cut -d' ' -f1)"
    mv "$lucru/$h.pdf" "$OUT/$h.pdf.tmp" && mv "$OUT/$h.pdf.tmp" "$OUT/$h.pdf"
    printf '{"sha256_original":"%s","sha256_pdf":"%s","convertit_la":"%s"}\n' "$h" "$ph" "$(date -u +%FT%TZ)" > "$OUT/$h.json"
  else
    echo '{"eroare":"conversie esuata sau timeout"}' > "$ERR/$h.json"
  fi
  rm -rf "$lucru" "$f"
}
for f in "$IN"/*; do [ -f "$f" ] && proceseaza "$f"; done
inotifywait -m -e close_write -e moved_to --format '%w%f' "$IN" | while read -r f; do
  case "$f" in *.tmp) continue;; esac
  proceseaza "$f"
done
