# Varianta de BRANCH Supabase a scheletului baseline pre-E3 (supabase/tests/izometrie_e3_schelet_baseline.sql, generat din
# baseline_pre_e3.json): pe un branch Storage-ul e al platformei (owner / ACL / RLS / storage.foldername / supabase_storage_admin
# există și NU se ating — dacă diferă de prod, preflight-ul 0l o spune), dar politicile de prod de pe storage.objects /
# storage.buckets, stub-urile funcțiilor din ele și trigger-ele profiles (corpurile exacte) lipsesc → se creează aici.
# Utilizare: python3 baseline_branch.py <izometrie_e3_schelet_baseline.sql> <iesire.sql>
import re, sys
src = open(sys.argv[1], encoding='utf-8').read().replace('\r\n', '\n')
out = ["-- GENERAT de proba_pg17/baseline_branch.py — DOAR pe un branch Supabase de probă, NICIODATĂ pe prod",
       "SET client_min_messages = warning;",
       # politicile existente ale branch-ului pe Storage → scoase, ca mulțimea să fie exact cea de prod
       "DO $d$ DECLARE r record; BEGIN FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies",
       "  WHERE schemaname = 'storage' AND tablename IN ('objects', 'buckets') LOOP",
       "  EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename); END LOOP; END $d$;"]
sari = [r'^DO \$r\$ BEGIN IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = \'supabase_storage_admin\'\) THEN\n  CREATE ROLE[^\n]*\n',
        r'^GRANT USAGE ON SCHEMA storage TO supabase_storage_admin;[^\n]*\n',
        r'^CREATE OR REPLACE FUNCTION storage\.[^\n]*\n',
        r'^ALTER TABLE storage\.[^\n]*\n', r'^REVOKE [^\n]* ON TABLE storage\.[^\n]*\n', r'^GRANT [^\n]* ON TABLE storage\.[^\n]*\n']
n0 = len(src)
for t in sari:
    src, k = re.subn(t, '', src, flags=re.M)
    assert k > 0 or 'DO \\$r\\$' in t, t
src = re.sub(r'^CREATE FUNCTION public\.', 'CREATE OR REPLACE FUNCTION public.', src, flags=re.M)
src = re.sub(r'^CREATE TRIGGER (\w+) (.*? ON public\.profiles)', r'DROP TRIGGER IF EXISTS \1 ON public.profiles;\nCREATE TRIGGER \1 \2', src, flags=re.M)
assert 'storage.objects OWNER' not in src and src.count('CREATE POLICY') >= 100, 'filtrare incompletă'
out.append(src)
open(sys.argv[2], 'w', encoding='utf-8', newline='\n').write("\n".join(out) + "\n")
