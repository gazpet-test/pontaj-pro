"""Build only the static E2 race fixture; no database access."""
import json
from pathlib import Path

names = ['E3B-C1-FIXTURE'] + [f'E2-{n:02}' for n in range(1, 61) if n not in range(14, 20)]
payload = {'motiv': 'fixture curse E2',
           'surse': [{'fisier': 'E2.xlsx', 'sha256': 'e' * 64}],
           'bucati': [dict(tip='teava', serie=name, sarja='E2-S', lungime_mm=12000,
                           perete_mm=8, stare='receptionat', depozit_id=11,
                           sursa=dict(fisier='E2.xlsx', foaie='F', rand=i))
                      for i, name in enumerate(names, 1)]}
sql = """-- Fixture separata E1/E2. Importul precede toate scrierile de registru.
BEGIN;
SELECT public.fn_izo_activeaza_si_importa(3,'E2-import',
  '%s'::jsonb,'fixture E2 activare si import');
SELECT set_config('izo.registru_tx','',true);
INSERT INTO public.izo_atribuiri(proiect_id,profile_id,rol,depozit_id,acordat_de,motiv) VALUES
 (3,'00000000-0000-0000-0000-000000000030','gestionar',11,'test','fixture E2'),
 (3,'00000000-0000-0000-0000-000000000117','manager_aprobator',NULL,'test','fixture E2');
INSERT INTO public.user_module_access(profile_id,module,access_level)
 VALUES('00000000-0000-0000-0000-000000000117','magazie','editor');
SET SESSION AUTHORIZATION authenticator;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000030","role":"authenticated"}',true);
SELECT public.fn_izo_cor_propune('pierdut',3,
 (SELECT id FROM public.magazie_bucati WHERE serie='E3B-C1-FIXTURE'),
 '{"cauza":"disparuta"}','fixture cursa E1');
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $end$ BEGIN RAISE NOTICE 'TESTE E3b-E2-FIXTURE: TOATE OK'; END $end$;
COMMIT;
""" % json.dumps(payload, separators=(',', ':'))
for n in range(14, 20):
    subset = [f'E2-{n:02}'] + ([f'E2-{n:02}b'] if n in (16, 17) else [])
    extra = dict(payload, bucati=[dict(payload['bucati'][0], serie=name,
                  sursa=dict(fisier='E2.xlsx', foaie='F', rand=i)) for i, name in enumerate(subset, 1)])
    sql += ("\nBEGIN;\nSELECT public.fn_izo_activeaza_si_importa(3,'E2-import-%02d','%s'::jsonb,'fixture E2 storno');\nCOMMIT;\n"
            % (n, json.dumps(extra, separators=(',', ':'))))
sql += "DO $end$ BEGIN RAISE NOTICE 'TESTE E3b-E2-IMPORTURI: TOATE OK'; END $end$;\n"
Path('supabase/tests/izometrie_e3b_cursa.sql').write_text(sql, encoding='utf-8', newline='\n')
