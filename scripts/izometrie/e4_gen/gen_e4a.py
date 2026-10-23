"""E4a-1: outputs are generated; LIVE inputs are read only. No database/network."""
import hashlib
import re
import runpy
import sys
from pathlib import Path

SP = Path(__file__).resolve().parent
R = SP.parents[2]
sys.path.insert(0, str(R / 'scripts/izometrie/e3b_gen'))
# gen_e3b only writes under __main__; reuse its reviewed fixed inventory and fingerprint.
B = runpy.run_path(str(R / 'scripts/izometrie/e3b_gen/gen_e3b.py'), run_name='e4_baseline')
q, arr, block, src = (B[k] for k in ('q', 'arr', 'bloc_functie', 'prosrc'))
live = (R / 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql').read_text(encoding='utf-8')
old = block(live, 'fn_izo_porti_lipsa')
assert old.count('    RETURN v;\n  END $f$;') == 1
new = old.replace('    RETURN v;\n  END $f$;', '    v := v || public.fn_izo_porti_e4_lipsa();\n    RETURN v;\n  END $f$;')
implicit = [
    'policy|izo_tronson_config_api_sel on public.izo_tronson_config|public.fn_izo_citire(bigint)',
    'trigger|a0_izo_flux_config on public.izo_tronson_config|public.fn_izo_flux_config_garda()',
    'trigger|a0_izo_flux_tevi on public.executie_tevi|public.fn_izo_flux_garda()',
    'trigger|a0_izo_flux_pachete on public.executie_pachete_lansare|public.fn_izo_flux_garda()',
    'trigger|a0_izo_flux_pachete_dupa on public.executie_pachete_lansare|public.fn_izo_flux_pachet_dupa()',
    'trigger|a0_izo_flux_documente on public.executie_pachete_documente|public.fn_izo_flux_garda()',
    'trigger|a0_izo_flux_tronsoane on public.executie_tronsoane|public.fn_izo_flux_garda()',
    'trigger|a0_izo_flux_storage on storage.objects|public.fn_izo_flux_storage()',
]

def inventory(xs):
    return "v_impl := %s;\n  IF v_impl IS DISTINCT FROM %s THEN RAISE EXCEPTION 'E4a inventar implicit diferit: %%',v_impl; END IF;" % (B['const']['IMPL_EXPR'], arr(sorted(xs)))

pre = []
for name in ('fn_izo_porti_lipsa', 'fn_izo_porti_e3b_definitii', 'fn_izo_porti_e3b_lipsa'):
    body = block(live, name)
    pre.append("IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=%s) <> 1 OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=%s LIMIT 1) IS DISTINCT FROM %s THEN RAISE EXCEPTION 'E4a baseline body: %s'; END IF;" % (q(name), q(name), q(hashlib.md5(src(body).encode()).hexdigest()), name))

values = {
    'PRE_MD5': '\n  '.join(pre), 'IMPL_PRE': inventory(B['IMPL_POST']),
    'IMPL_POST': inventory(B['IMPL_POST'] + implicit), 'AMPRENTA': B['AMP'],
    'PORTI_NEW': new, 'PORTI_OLD': old,
    'OLD_MD5': q(hashlib.md5(src(old).encode()).hexdigest()),
}

def generate(template, dest):
    result = (SP / template).read_text(encoding='utf-8')
    for key, val in values.items():
        result = result.replace('@@' + key + '@@', val)
    assert '@@' not in result
    for tag in set(re.findall(r'\$[A-Za-z_]*\$', result)):
        assert result.count(tag) % 2 == 0, tag
    (R / dest).write_text(result, encoding='utf-8', newline='\n')

if __name__ == '__main__':
    generate('e4a_tpl.sql', 'supabase/migrations/20261109a_izometrie_e4a_flux.sql')
    generate('e4a_rev_tpl.sql', 'supabase/revenire/20261109a_izometrie_e4a_flux_ROLLBACK.sql')
    print('E4a generated; fixed implicit additions:', len(implicit))
