#!/usr/bin/env bash
export SEVENZIP=7z
# Generează fixture-urile (openssl + 7z) într-un director temporar și rulează testele seap.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/k.pem" -out "$D/c.pem" -days 1 -subj "/CN=test" 2>/dev/null
head -c 300 /dev/urandom > "$D/mic.bin"; head -c 3000000 /dev/urandom > "$D/mare.bin"
openssl cms -sign -nodetach -binary -in "$D/mic.bin" -signer "$D/c.pem" -inkey "$D/k.pem" -outform DER -out "$D/mic.p7s"
openssl cms -sign -nodetach -binary -stream -in "$D/mare.bin" -signer "$D/c.pem" -inkey "$D/k.pem" -outform DER -out "$D/mare_ber.p7s"
openssl cms -sign -nodetach -binary -in "$D/mare.bin" -signer "$D/c.pem" -inkey "$D/k.pem" -outform DER -out "$D/mare.p7s"
openssl cms -sign -binary -in "$D/mic.bin" -signer "$D/c.pem" -inkey "$D/k.pem" -outform DER -out "$D/detasat.p7s"
mkdir -p "$D/z/PT/pdf"; echo a > "$D/z/PT/pdf/a.pdf"; echo b > "$D/z/PT/b.txt"
(cd "$D/z" && 7z a -tzip -bd "$D/bun.zip" PT >/dev/null)
python3 - "$D/traversal.zip" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z: z.writestr('../../evil.txt', 'x'); z.writestr('ok.txt', 'y')
PY
if command -v rar >/dev/null; then head -c 400000 /dev/urandom > "$D/z/mare.bin"; (cd "$D/z" && rar a -v100k -idq "$D/multi.rar" mare.bin); fi
mkdir -p "$D/w"
LUCRU="$D/w" SEVENZIP=7z sh worker/ofertare/extractor/extractor.sh >/dev/null 2>&1 & EXT=$!
trap 'kill $EXT 2>/dev/null; rm -rf "$D"' EXIT
deno run --allow-read --allow-write="$D" --allow-env --allow-run=7z test-fixtures/seap_terra/seap_test.ts "$D"
bash test-fixtures/seap_terra/extractor_test.sh
