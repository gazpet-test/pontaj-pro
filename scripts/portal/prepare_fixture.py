#!/usr/bin/env python3
"""Copie EXCLUSIV de harness: baseline PUBLIC sintetic, nu inventar productie."""
from pathlib import Path
import sys

source, destination = map(Path, sys.argv[1:])
text = source.read_text(encoding="utf-8")
marker = "ARRAY[]::text[] /* PORTAL_PUBLIC_REVIEWED_SIGNATURES */"
if text.count(marker) != 1:
    raise SystemExit("HOLD: baseline changed; review harness fixture before running")
signatures = [f"'public.portal_fixture_public_{i:02d}()'" for i in range(1, 22)]
text = text.replace(marker, "ARRAY[" + ",".join(signatures) + "]::text[]")
destination.write_text(text, encoding="utf-8", newline="\n")
print("FIXTURE ONLY: 21 synthetic PUBLIC signatures; production baseline still HOLD")
