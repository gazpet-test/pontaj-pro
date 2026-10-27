#!/usr/bin/env python3
"""Copie EXCLUSIV de harness: inlocuieste lista alba PUBLIC de productie (21 de semnaturi revizuite) cu 21 de functii
sintetice create de scheletul local. Artefactul de productie ramane neschimbat."""
from pathlib import Path
import re
import sys

source, destination = map(Path, sys.argv[1:])
text = source.read_text(encoding="utf-8")
pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_public_aprobat\(\) RETURNS text\[\].*?\$fn\$\s*SELECT )(ARRAY\[.*?\]::text\[\])(;\s*\$fn\$;)", re.S)
matches = pattern.findall(text)
if len(matches) != 1 or matches[0][1].count("'public.") != 21:
    raise SystemExit("HOLD: lista alba PUBLIC din migrare nu are exact 21 de semnaturi; revizuieste fixture-ul")
signatures = [f"'public.portal_fixture_public_{i:02d}()'" for i in range(1, 22)]
text = pattern.sub(lambda m: m.group(1) + "ARRAY[" + ",".join(signatures) + "]::text[]" + m.group(3), text)
hash_pattern = re.compile(r"(CREATE FUNCTION public\.fn_portal_public_md5\(\) RETURNS jsonb.*?AS \$hash\$).*?(\$hash\$;)", re.S)
if len(hash_pattern.findall(text)) != 1:
    raise SystemExit("HOLD: expected one reviewed hash baseline")
text = hash_pattern.sub(lambda m: m.group(1) + "\n SELECT jsonb_object_agg(s,md5(pg_get_functiondef(to_regprocedure(s)))) FROM unnest(public.fn_portal_public_aprobat()) s;\n" + m.group(2), text)
destination.write_text(text, encoding="utf-8", newline="\n")
print("FIXTURE ONLY: 21 synthetic PUBLIC signatures in place of the reviewed production list")
