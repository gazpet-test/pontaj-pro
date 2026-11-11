#!/usr/bin/env python3
"""Schema pg_dump; omite DOAR stub-ul explicit la comparatia finala 18a."""
import re
import sys
text = sys.stdin.read()
text = re.sub(r"^\\(?:un)?restrict .*\n", "", text, flags=re.M)
if sys.argv[1:] == ['omit-stub']:
    parts = re.split(r"(?=^--\n-- (?:Name: |PostgreSQL database dump complete))", text, flags=re.M)
    # Numele/categoria obiectului sunt din antetul pg_dump, nu regex pe cod SQL.
    # pg_dump scrie „fn_auth_token_hook(jsonb)” la FUNCTION și „FUNCTION fn_auth_token_hook(event jsonb)” la ACL.
    text = ''.join(part for part in parts if not re.match(
        r"--\n-- Name: (?:FUNCTION )?fn_auth_token_hook\((?:event )?jsonb\); Type: (?:FUNCTION|ACL);", part))
sys.stdout.write(text)
