"""Contract checks only; NEVER substitutes for the PG16 harness."""
from pathlib import Path
import re
import hashlib
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
m = root/'supabase/migrations/20261120a_izometrie_aviz_iesire.sql'
r = root/'supabase/revenire/20261120a_izometrie_aviz_iesire_ROLLBACK.sql'
sql, rev = m.read_text(encoding='utf-8'), r.read_text(encoding='utf-8')
amps = re.findall(r'-- <amprenta>\n(.*?)-- </amprenta>', sql+rev, re.S)
assert len(amps) == 3 and len(set(amps)) == 1, 'fingerprints differ'
assert sql.count('-- <serii_start>') == sql.count('-- </serii_start>') == 1
assert sql.index('-- <serii_start>') < sql.index('CREATE TABLE public.izo_avize_iesire')
assert 'fn_izo_aviz_semnatura_permisa' not in sql and 'fn_izo_aviz_fereastra_semnatura' not in sql
assert 'hr-semnaturi' not in sql
assert not re.search(r'(ALTER|GRANT|CREATE TRIGGER)\b[^;]*storage\.objects', sql, re.I)
funcs = re.findall(r'CREATE FUNCTION public\.(fn_izo_\w+)\(.*?AS \$f\$(.*?)\$f\$;', sql, re.S)
assert len(funcs) == 4, len(funcs)
for name, body in funcs:
    assert not re.search(r'\b(set_config|execute)\b|request\.jwt',body,re.I), name
    if name == 'fn_izo_iesire_cu_aviz':
        assert body.index('pg_advisory_xact_lock(') < body.index('SELECT a.* INTO v_old') < body.index('UPDATE public.izo_avize_serii') < body.index('v_r:=public.fn_izo_aviz_iesire_intern')
    if name == 'fn_izo_aviz_anuleaza':
        assert 'magazie_bucati_evenimente' not in body
assert rev.index('LOCK TABLE') < rev.index('IF EXISTS(SELECT 1 FROM public.izo_avize_iesire)')
tests = (root/'supabase/tests/izometrie_aviz.test.sql').read_text(encoding='utf-8')
assert 'IZO_AVIZ_TEST_END' in tests
assert not re.search(r'\b(GRANT|REVOKE)\b',tests,re.I)
for path in [m,r]:
    for tag in set(re.findall(r'\$[A-Za-z_]*\$',path.read_text(encoding='utf-8'))):
        assert path.read_text(encoding='utf-8').count(tag)%2 == 0, tag
# Optional byte-for-byte confirmation against the input copy, without Git.
if len(sys.argv)>1:
    base = Path(sys.argv[1])
    for original in base.rglob('*'):
        if original.is_file():
            rel = original.relative_to(base)
            assert (root/rel).read_bytes() == original.read_bytes(), f'baseline changed: {rel}'
    print('PASS baseline: all files from aviz_base byte-identical')
bash = Path('C:/Program Files/Git/bin/bash.exe')
if bash.exists():
    for rel in ['scripts/test_izometrie_aviz.sh','scripts/izometrie/aviz/concurenta.sh','scripts/izometrie/aviz/harness_wsl.sh']:
        subprocess.run([str(bash),'-n',rel],cwd=root,check=True)
    print('PASS bash -n: all three scripts')
print('PASS static AVIZ: same fingerprint, one seed block, lock order, API bodies, storage scope, test marker')
print('PG16 runtime: NOT RUN by this checker')
for path in [m,r]:
    print(path.name+': '+hashlib.sha256(path.read_bytes()).hexdigest())
