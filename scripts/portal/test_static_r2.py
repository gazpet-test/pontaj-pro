#!/usr/bin/env python3
"""Regresii portabilitate/snapshot; executia SQL ramane in harness-ul operatorului."""
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
class RevisionTests(unittest.TestCase):
    def normalize(self, text, mode):
        return subprocess.run([sys.executable,str(ROOT/'scripts/portal/snapshot_schema.py'),mode],input=text,
            text=True,capture_output=True,check=True).stdout
    def test_stub_is_only_intentional_schema_difference(self):
        head='-- dump header\n'
        handle='--\n-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres\n--\nCREATE FUNCTION preserved;\n\n'
        stub='--\n-- Name: fn_auth_token_hook(event jsonb); Type: FUNCTION; Schema: public; Owner: postgres\n--\nCREATE FUNCTION stub;\n\n'
        acl='--\n-- Name: FUNCTION fn_auth_token_hook(event jsonb); Type: ACL; Schema: public; Owner: postgres\n--\nGRANT EXECUTE;\n\n'
        footer='--\n-- PostgreSQL database dump complete\n--\n'
        self.assertEqual(self.normalize(head+handle+stub+acl+footer,'omit-stub'),head+handle+footer)
        self.assertEqual(self.normalize(head+handle+stub+acl+footer,'full'),head+handle+stub+acl+footer)
    def test_portable_fact_has_no_inventory(self):
        import re
        source=(ROOT/'docs/portal_angajat/fapte_prod/handle_new_user_27_10.sql').read_text(encoding='utf-8')
        self.assertNotRegex(source,r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
        self.assertNotRegex(source,r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
        self.assertEqual(source.count('CREATE OR REPLACE FUNCTION'),1)
if __name__=='__main__': unittest.main(verbosity=2)
