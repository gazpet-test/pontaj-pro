#!/usr/bin/env python3
"""Copie EXCLUSIV de harness a migrarii 18a. Artefactul de productie ramane neschimbat.

- lista alba PUBLIC de productie (21 de semnaturi revizuite) -> cele 21 de functii sintetice ale scheletului local;
- amprentele public si net -> literalii din --amprente (JSON {"public": {...}, "net": {...}}), citite de harness din
  clusterul efemer INAINTE de apply, ca un corp schimbat inainte de apply sa fie refuzat (Copilot r2 P1-02);
- lista ERP aprobata -> sha256 pe UUID-urile din --erp (fara --erp lista ramane goala: testul negativ).

Utilizare: prepare_fixture.py <sursa.sql> <destinatie.sql> --amprente <fisier.json> [--erp UUID ...]
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SIG_PUBLIC = re.compile(r"^public\.portal_fixture_public_[0-9]{2}\(\)$")
SIG_NET = re.compile(r"^net\.portal_fixture_net_[0-9]{2}\(\)$")
MD5 = re.compile(r"^[0-9a-f]{32}$")


def hold(message):
    raise SystemExit("HOLD: " + message)


def sql_literal(value):
    # Fara backslash (validatorul refuza backslash in literali obisnuiti); cheile si valorile sunt verificate mai sus.
    text = json.dumps(value, sort_keys=True, separators=(",", ":"))
    if "\\" in text or "'" in text:
        hold("amprente cu caractere nepermise")
    return "'" + text + "'::jsonb"


def replace_once(pattern, text, repl, what):
    if len(pattern.findall(text)) != 1:
        hold(f"marcaj {what}: trebuie exact o aparitie")
    return pattern.sub(repl, text, count=1)


parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("--amprente", type=Path, required=True)
parser.add_argument("--erp", nargs="*", default=[])
args = parser.parse_args()

text = args.source.read_text(encoding="utf-8").replace("\r\n", "\n")
amprente = json.loads(args.amprente.read_text(encoding="utf-8"))
public, net = amprente.get("public"), amprente.get("net")
if not isinstance(public, dict) or len(public) != 21 or not all(SIG_PUBLIC.match(k) and MD5.match(v) for k, v in public.items()):
    hold("amprentele public trebuie sa fie exact cele 21 de functii sintetice")
if not isinstance(net, dict) or len(net) != 12 or not all(SIG_NET.match(k) and MD5.match(v) for k, v in net.items()):
    hold("amprentele net trebuie sa fie exact cele 12 functii sintetice")
for value in args.erp:
    if not UUID.match(value):
        hold("UUID ERP invalid: " + value)

pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_public_aprobat\(\) RETURNS text\[\].*?\$fn\$\s*SELECT )(ARRAY\[.*?\]::text\[\])(;\s*\$fn\$;)", re.S)
matches = pattern.findall(text)
if len(matches) != 1 or matches[0][1].count("'public.") != 21:
    hold("lista alba PUBLIC din migrare nu are exact 21 de semnaturi; revizuieste fixture-ul")
signatures = ",".join("'" + s + "'" for s in sorted(public))
text = pattern.sub(lambda m: m.group(1) + "ARRAY[" + signatures + "]::text[]" + m.group(3), text)

hash_pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_public_md5\(\) RETURNS jsonb.*?AS \$hash\$).*?(\$hash\$;)", re.S)
text = replace_once(hash_pattern, text, lambda m: m.group(1) + "\n SELECT " + sql_literal(public) + ";\n" + m.group(2), "public md5")

net_pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_net_md5\(\) RETURNS jsonb.*?AS \$nethash\$).*?(\$nethash\$;)", re.S)
text = replace_once(net_pattern, text, lambda m: m.group(1) + "\n SELECT " + sql_literal(net) + ";\n" + m.group(2), "net md5")

# owner-ul functiilor net: pe prod supabase_admin; in clusterul efemer functiile sintetice net sunt ale lui postgres
owner_line = "c_net_owner CONSTANT text := 'supabase_admin';"
if text.count(owner_line) != 1:
    hold("marcaj owner net: trebuie exact o aparitie")
text = text.replace(owner_line, "c_net_owner CONSTANT text := 'postgres';")

erp_pattern = re.compile(r"(CREATE TEMP TABLE portal_erp_aprobat ON COMMIT DROP AS\nSELECT ARRAY\[).*?(\]::text\[\] AS lista;)", re.S)
hashes = ",".join("'" + hashlib.sha256(u.encode("utf-8")).hexdigest() + "'" for u in args.erp)
text = replace_once(erp_pattern, text, lambda m: m.group(1) + hashes + m.group(2), "lista ERP")

args.destination.write_text(text, encoding="utf-8", newline="\n")
print(f"FIXTURE ONLY: 21 public + 12 net sintetice cu amprente literale; ERP aprobate: {len(args.erp)}")
