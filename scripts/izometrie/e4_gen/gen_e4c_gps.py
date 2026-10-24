"""E4c GPS: offline generator; E4a/E4b and their outputs are read-only inputs."""
import hashlib
import re
import runpy
from pathlib import Path

SP = Path(__file__).resolve().parent
B = runpy.run_path(str(SP / 'gen_e4b.py'), run_name='e4c_baseline')
R, q, arr, block, src = (B[k] for k in ('R', 'q', 'arr', 'block', 'src'))
LIVE = (R / 'supabase/migrations/20261109b_izometrie_e4b_teren.sql').read_text(encoding='utf8')
# E4b's gate headers use one space; the shared extractor expects two. Only
# normalize headers, never whitespace inside a LIVE function body.
LIVE = re.sub(r'(?m)^ (?=CREATE (?:OR REPLACE )?FUNCTION public\.)', '  ', LIVE)
old_guard = block(LIVE, 'fn_izo_teren_imuabil')
old_gate = block(LIVE, 'fn_izo_porti_e4b_definitii')
old_seq_gate = block(LIVE, 'fn_izo_porti_e4_lipsa')
seq_anchor = "'public.izo_server_ver_seq'::regclass,"
assert old_seq_gate.count(seq_anchor) == 1
new_seq_gate = old_seq_gate.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1).replace(
    seq_anchor, "'public.izo_gps_stergeri_id_seq'::regclass," + seq_anchor)
exception = """BEGIN
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='izo_declaratii_gps' AND TG_OP='DELETE' THEN
 IF current_user='izo_montaj_writer'
  AND current_setting('izo.gps_curata_ctx',true) = concat_ws('|',txid_current(),OLD.declaratie_id,OLD.versiune)
  AND EXISTS(SELECT 1 FROM public.izo_declaratii d WHERE d.id=OLD.declaratie_id
   AND d.stare IN ('aprobata','respinsa','stearsa')
   AND CASE WHEN d.stare='stearsa' THEN d.updated_at ELSE d.decis_la END < now()-interval '60 days')
 THEN RETURN OLD; END IF;
 END IF;
 """
assert old_guard.count('BEGIN ') == 1
new_guard = old_guard.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1).replace('BEGIN ', exception, 1)
# Extend the reviewed E4b fingerprint: all table/column/policy/trigger/index lists,
# plus the identity sequence. Function bodies/ACLs already include every fn_izo_*.
assert "'izo_declaratii_gps'" in old_gate
new_gate = old_gate.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1).replace(
    "'izo_declaratii_gps'", "'izo_declaratii_gps','izo_gps_stergeri'").replace(
    "'izo_server_ver_seq','magazie_bucati_id_seq'", "'izo_gps_stergeri_id_seq','izo_server_ver_seq','magazie_bucati_id_seq'")
assert new_gate != old_gate
pre = list(B['implicit'])
post = pre + [f'trigger|a0_izo_gps_jurnal_{op} on public.izo_gps_stergeri|public.fn_izo_teren_imuabil()'
              for op in ('update', 'delete', 'truncate')]
post.append('trigger|a0_izo_gps_jurnal_insert on public.izo_gps_stergeri|public.fn_izo_gps_jurnal_ins()')

def inventory(items):
    return "v_impl := %s; IF v_impl IS DISTINCT FROM %s THEN RAISE EXCEPTION 'E4c inventar implicit: %%',v_impl; END IF;" % (
        B['A']['B']['const']['IMPL_EXPR'], arr(sorted(items)))

def md5(body):
    return q(hashlib.md5(src(body).encode('utf8')).hexdigest())

stamps = [('porti', ''), ('e3', '_e3'), ('e3b', '_e3b'), ('e4', '_e4'), ('e4b', '_e4b')]
values = {
    'GUARD_NEW': new_guard, 'GUARD_OLD': old_guard.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1),
    'GUARD_MD5': md5(old_guard), 'GUARD_NEW_MD5': md5(new_guard),
    'GATE_NEW': new_gate, 'GATE_OLD': old_gate.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1),
    'GATE_MD5': md5(old_gate), 'GATE_NEW_MD5': md5(new_gate),
    'SEQ_GATE_NEW': new_seq_gate, 'SEQ_GATE_OLD': old_seq_gate.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1),
    'SEQ_GATE_MD5': md5(old_seq_gate), 'SEQ_GATE_NEW_MD5': md5(new_seq_gate),
    'IMPL_PRE': inventory(pre), 'IMPL_POST': inventory(post), 'AMPRENTA': B['A']['B']['AMP'],
    'SAVE_STAMPS': ',\n'.join(f"'{key}',obj_description('public.fn_izo_porti{suffix}_definitii()'::regprocedure,'pg_proc')" for key, suffix in stamps),
    'RESTAMP': '\n'.join(f"EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti{suffix}_definitii() IS %L','porti{suffix}='||public.fn_izo_porti{suffix}_definitii());" for key, suffix in stamps),
    'RESTORE_STAMPS': '\n'.join(f"EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti{suffix}_definitii() IS %L',v_meta->>'{key}');" for key, suffix in stamps),
}
OUTPUTS = [('e4c_gps_tpl.sql', 'supabase/migrations/20261111a_izometrie_gps_curatare.sql'),
           ('e4c_gps_rev_tpl.sql', 'supabase/revenire/20261111a_izometrie_gps_curatare_ROLLBACK.sql')]

def render(template):
    result = (SP / template).read_text(encoding='utf8')
    for key, value in values.items():
        result = result.replace('@@' + key + '@@', value)
    assert '@@' not in result
    for tag in set(re.findall(r'\$[A-Za-z_]*\$', result)):
        assert result.count(tag) % 2 == 0, tag
    return result

if __name__ == '__main__':
    for template, dest in OUTPUTS:
        (R / dest).write_text(render(template), encoding='utf8', newline='\n')
    print('E4c GPS generated: migration + rollback; baseline untouched')
