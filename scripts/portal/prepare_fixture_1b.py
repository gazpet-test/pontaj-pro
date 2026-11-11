#!/usr/bin/env python3
"""Copie EXCLUSIV de harness a migrarii 19a: ancorele revizuite din productie (PORTAL_1B_ANCORE) se inlocuiesc cu
ancorele clusterului efemer, citite de harness INAINTE de apply cu scripts/portal/ancore_1b.sql. Artefactul de productie
ramane neschimbat. Utilizare: prepare_fixture_1b.py <sursa.sql> <destinatie.sql> --ancore <fisier.json>"""
from pathlib import Path
import argparse
import json
import re

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("--ancore", type=Path, required=True)
args = parser.parse_args()

text = args.source.read_text(encoding="utf-8").replace("\r\n", "\n")
ancore = json.loads(args.ancore.read_text(encoding="utf-8"))
if not isinstance(ancore, dict) or set(ancore) != {"functii", "triggere"} or not ancore["functii"] or not ancore["triggere"]:
    raise SystemExit("HOLD: ancorele fixture-ului trebuie sa aiba functii si triggere")
literal = json.dumps(ancore, sort_keys=True, separators=(",", ":"))
if "\\" in literal:
    raise SystemExit("HOLD: ancore cu backslash (validatorul refuza backslash in literali)")
literal = literal.replace("'", "''")
pattern = re.compile(r"(CREATE TEMP TABLE portal_1b_ancore_revizuit ON COMMIT DROP AS\nSELECT )'.*?'::jsonb( AS v; -- PORTAL_1B_ANCORE\n)", re.S)
if len(pattern.findall(text)) != 1:
    raise SystemExit("HOLD: marcajul PORTAL_1B_ANCORE trebuie sa apara exact o data")
text = pattern.sub(lambda m: m.group(1) + "'" + literal + "'::jsonb" + m.group(2), text)
args.destination.write_text(text, encoding="utf-8", newline="\n")
print(f"FIXTURE ONLY: ancore 1b ale clusterului efemer ({len(ancore['functii'])} functii, {len(ancore['triggere'])} triggere)")
