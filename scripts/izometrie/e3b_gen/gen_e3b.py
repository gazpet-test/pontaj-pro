# Generator E3b, piesa A. Ieșirile supabase/ nu se editează manual.
# Fără importarea gen_e3.py: importul lui ar rescrie ieșirile LIVE.
import ast
import hashlib
import json
import re
from pathlib import Path

SP = Path(__file__).resolve().parent
R = SP.parents[2]
E2 = R / 'supabase/migrations/20261102a_izometrie_e2a_registru.sql'
E3 = R / 'supabase/migrations/20261103b_izometrie_e3_documente.sql'
e2, e3 = E2.read_text(encoding='utf-8'), E3.read_text(encoding='utf-8')


def bloc_functie(text, nume):
    """Blocul original, inclusiv semnătura/config; fără reformatări ale prosrc."""
    m = re.search(r'  CREATE (?:OR REPLACE )?FUNCTION public\.' + re.escape(nume) + r'\(', text)
    assert m, nume
    a = text.index('AS $f$', m.start())
    b = text.index('$f$;', a + len('AS $f$')) + len('$f$;')
    return text[m.start():b]


def prosrc(bloc):
    return bloc.split('AS $f$', 1)[1].rsplit('$f$;', 1)[0]


def md5(text):
    return hashlib.md5(text.encode('utf-8')).hexdigest()


def q(text):
    return "'" + text.replace("'", "''") + "'"


def arr(xs):
    return 'ARRAY[' + ', '.join(map(q, xs)) + ']::text[]'


# Citire numai a constantelor literale din sursa E3; niciun exec/import.
arbore = ast.parse((R / 'scripts/izometrie/e3_gen/gen_e3.py').read_text(encoding='utf-8'))
const = {}
for nod in arbore.body:
    if isinstance(nod, ast.Assign) and isinstance(nod.targets[0], ast.Name):
        try:
            const[nod.targets[0].id] = ast.literal_eval(nod.value)
        except (ValueError, TypeError):
            pass
C, EV, MIS = (const[k] for k in ('C', 'EV', 'MIS'))
TIPURI_E3 = const['TIPURI_E2A'] + ['intrare_lista_ambalare', 'receptie_pv']
IMPL_PRE = sorted(json.loads((R / 'scripts/izometrie/e3_gen/baseline_pre_e3.json').read_text(encoding='utf-8'))
                  ['implicite']['fn_izo_pre_e3'] + const['IMPL_E3'])
IMPL_E3B = []  # PIESA B/C/D: numai adaosuri revizuite (trigger-e / politici), niciodată captură la apply.

L_COMUN = ['serie', 'sarja', 'lot', 'perete_mm', 'diametru_mm', 'greutate_kg', 'dimensiune', 'grad_otel', 'standard', 'izolatie']
L_TEAVA = L_COMUN + ['lungime_aviz_mm', 'lungime_masurata_mm']
L_CURBA = L_COMUN + ['unghi_curba']
L_IDENT = ['serie', 'sarja', 'lot', 'lungime_aviz_mm', 'lungime_masurata_mm', 'unghi_curba']
D = ['lungime_mm', 'lungime_m', 'lungime_originala_m']
INS = C + ['id', 'uid', 'radacina_id', 'server_ver']
UPD = sorted(set(L_TEAVA + L_CURBA + D + ['stare', 'depozit_id', 'server_ver', 'updated_at']))
ROLURI = ['izo_cor_editor', 'izo_corectie_writer']
NOI = ['izo_corectii', 'izo_corectii_bucati', 'izo_documente_istoric']
VECHI = ['magazie_bucati', 'magazie_bucati_evenimente', 'magazie_bucati_miscari', 'izo_documente_intrare',
         'izo_importuri', 'izo_proiect_config', 'izo_atribuiri']
SECV = ['magazie_bucati_id_seq', 'izo_server_ver_seq', 'magazie_bucati_evenimente_id_seq', 'magazie_bucati_miscari_id_seq']

# Coloanele INSERT nu includ id-ul IDENTITY și coloanele deciziei. inainte/cale
# sunt acceptate ca NULL de viitoarea gardă, care le calculează (§3.3).
PROP = ['proiect_id', 'tip', 'bucata_id', 'document_intrare_id', 'inainte', 'dupa', 'ncr_ref', 'motiv',
        'stare', 'versiune', 'cale', 'propus_de', 'propus_rol', 'propus_la']
DIRECT = PROP + ['import_id']
DECIZIE = ['stare', 'versiune', 'decis_de', 'decis_rol', 'decis_la']
IST = ['document_id', 'versiune', 'salvat_de', 'salvat_rol', 'salvat_la', 'continut', 'hash', 'diff', 'baza']

# Matricea este sursa comună GRANT / poartă / verificări pe catalog.
# None = privilegiu pe tot tabelul, lista = numai acele coloane.
MATRICE = {}
def drept(rol, tabel, privilegiu, coloane=None):
    MATRICE[rol, tabel, privilegiu] = coloane

for t in NOI:
    drept('authenticated', t, 'SELECT')
for rol in ROLURI:
    for t in ['izo_corectii', 'izo_corectii_bucati', 'magazie_bucati', 'magazie_bucati_evenimente',
              'magazie_bucati_miscari', 'izo_documente_intrare']:
        drept(rol, t, 'SELECT')
drept('izo_cor_editor', 'izo_corectii', 'INSERT', PROP)
drept('izo_cor_editor', 'izo_corectii', 'UPDATE', DECIZIE + ['motiv_decizie'])
drept('izo_corectie_writer', 'izo_corectii', 'INSERT', DIRECT)
drept('izo_corectie_writer', 'izo_corectii', 'UPDATE', DECIZIE + ['eveniment_id', 'bucata_id'])
drept('izo_corectie_writer', 'izo_corectii_bucati', 'INSERT')
drept('izo_doc_editor', 'izo_documente_istoric', 'SELECT')
drept('izo_doc_editor', 'izo_documente_istoric', 'INSERT', IST)
drept('izo_corectie_writer', 'izo_importuri', 'SELECT')
drept('izo_corectie_writer', 'magazie_bucati', 'INSERT', INS)
drept('izo_corectie_writer', 'magazie_bucati', 'UPDATE', UPD)
for t in ['magazie_bucati_evenimente', 'magazie_bucati_miscari']:
    drept('izo_corectie_writer', t, 'INSERT')
drept('izo_corectie_writer', 'izo_documente_intrare', 'UPDATE', ['pv_nr', 'pv_nr_canon', 'pv_data', 'versiune', 'updated_at'])

FUNCTII = {}
def executa(fn, roluri):
    FUNCTII['public.' + fn] = roluri

for fn in ['fn_izo_jwt_rol()', 'fn_izo_uid()', 'fn_izo_porti_lipsa()', 'fn_izo_nivel(bigint)',
           'fn_izo_citire(bigint)', 'fn_izo_site_proiect(bigint)', 'fn_izo_tip_cod(integer)', 'fn_izo_tip_material(text)',
           'fn_izo_loc_valid(bigint, integer, bigint)', 'fn_izo_proiectie(jsonb, text[])', 'fn_izo_coloane_c()',
           'fn_izo_coloane_ev()', 'fn_izo_coloane_mis()', 'fn_izo_canon_serie(text)', 'fn_izo_doc_hash(bigint)',
           'fn_izo_coloane_corectabile(text)', 'fn_izo_coloane_identitate()']:
    executa(fn, ROLURI)
for fn in ['fn_izo_garda_scriitor()', 'fn_izo_blocheaza_locuri(bigint, integer[], bigint[])',
           'fn_izo_blocheaza_tabele()', 'fn_izo_lock_partajat(bigint[])', 'fn_izo_lock_proiect(bigint, boolean)']:
    executa(fn, ['izo_corectie_writer'])

# Infrastructură pentru D: blocurile vechi exacte + md5(prosrc). Piesa A înlocuiește
# numai poarta; celelalte sunt verificate, fără a le rescrie preventiv.
INLOCUIRI_D = {
    'fn_izo_garda_bucati': e3, 'fn_izo_garda_fapte': e3, 'fn_izo_doc_garda': e3,
    'fn_izo_porti_lipsa': e3, 'fn_izo_doc_salveaza': e3, 'fn_izo_import_storno': e2,
    'fn_izo_doc_anuleaza': e3, 'fn_izo_garda_receptie': e3, 'fn_izo_import_sold_initial': e2,
}
BLOCURI_VECHI = {n: bloc_functie(s, n) for n, s in INLOCUIRI_D.items()}
MD5_VECHI = {n: md5(prosrc(b)) for n, b in BLOCURI_VECHI.items()}
PORTI_BASELINE = {n: bloc_functie(s, n) for n, s in {
    'fn_izo_porti_definitii': e2, 'fn_izo_porti_e3_definitii': e3, 'fn_izo_porti_e3_lipsa': e3,
}.items()}
pre_md5 = []
for n, b in (BLOCURI_VECHI | PORTI_BASELINE).items():
    # Semnătura din catalog e luată separat, după nume unic (refuză overload).
    pre_md5.append("  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = %s) <> 1\n"
                   "     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = %s LIMIT 1) IS DISTINCT FROM %s THEN\n"
                   "    RAISE EXCEPTION 'Precondiție E3b: corpul %s diferă de migrarea LIVE';\n  END IF;" % (q(n), q(n), q(md5(prosrc(b))), n))
pl_veche = BLOCURI_VECHI['fn_izo_porti_lipsa']
pl_noua = pl_veche.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
assert pl_noua.count('    RETURN v;\n  END $f$;') == 1
pl_noua = pl_noua.replace('    RETURN v;\n  END $f$;',
                        '    v := v || public.fn_izo_porti_e3b_lipsa();\n    RETURN v;\n  END $f$;')

AMP = e3[e3.index('  -- <amprenta>'):e3.index('  -- </amprenta>') + len('  -- </amprenta>')]
# Refolosire textuală a verificării mulțimilor C / _ev / _mis, cu constantele LIVE.
coloane = e3[e3.index('  IF (SELECT array_agg(a.attname::text ORDER BY a.attname)'):e3.index('  -- preflight LIVE înainte de FK')]

politici, granturi, retrageri, revoke_coloane = [], [], [], []
def politica(nume, tabel, rol, cmd, expr):
    politici.append('  CREATE POLICY %s ON public.%s FOR %s TO %s%s%s;' %
                    (nume, tabel, cmd, rol, ' USING (' + expr + ')' if cmd in ('SELECT', 'UPDATE') else '',
                     ' WITH CHECK (' + expr + ')' if cmd in ('INSERT', 'UPDATE') else ''))
    retrageri.append('  DROP POLICY %s ON public.%s;' % (nume, tabel))
    for fn in sorted(set(re.findall(r'public\.(fn_izo_\w+)\(', expr))):
        sig = {'fn_izo_citire': 'bigint', 'fn_izo_nivel': 'bigint'}[fn]
        IMPL_E3B.append('policy|%s on public.%s|public.%s(%s)' % (nume, tabel, fn, sig))

for t in NOI:
    cond = {
        'izo_corectii': 'public.fn_izo_citire(proiect_id)',
        'izo_corectii_bucati': 'EXISTS (SELECT 1 FROM public.izo_corectii c WHERE c.id = corectie_id AND public.fn_izo_citire(c.proiect_id))',
        'izo_documente_istoric': 'EXISTS (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id = document_id AND public.fn_izo_citire(d.proiect_id))',
    }[t]
    politica(t + '_api_sel', t, 'authenticated', 'SELECT', 'auth.uid() IS NOT NULL AND ' + cond)
for (rol, t, p), cols in MATRICE.items():
    granturi.append('  GRANT %s%s ON public.%s TO %s;' % (p, ' (' + ', '.join(cols) + ')' if cols is not None else '', t, rol))
    if cols is not None:
        revoke_coloane.append('  REVOKE %s (%s) ON public.%s FROM %s;' % (p, ', '.join(cols), t, rol))
    if rol == 'authenticated':
        continue
    if t in NOI:
        expr = 'document_id IS NOT NULL' if t == 'izo_documente_istoric' else ('corectie_id IS NOT NULL' if t == 'izo_corectii_bucati' else 'proiect_id IS NOT NULL')
        nume = t + '_' + ('corectie' if rol == 'izo_corectie_writer' else 'coreditor' if rol == 'izo_cor_editor' else 'doceditor') + '_' + p.lower()
    else:
        prefix = {'magazie_bucati': 'magbuc_izo', 'magazie_bucati_evenimente': 'izo_ev', 'magazie_bucati_miscari': 'izo_mis',
                  'izo_documente_intrare': 'izo_doc', 'izo_importuri': 'izo_imp'}[t]
        nume = prefix + '_' + ('corectie' if rol == 'izo_corectie_writer' else 'coreditor') + '_' + {'SELECT':'sel','INSERT':'ins','UPDATE':'upd'}[p]
        expr = "provenienta = 'beneficiar'" if t == 'magazie_bucati' else 'proiect_id IS NOT NULL'
        if p in ('INSERT', 'UPDATE') and t != 'izo_documente_intrare':
            expr += " AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc','montaj')"
    politica(nume, t, rol, p, expr)

for fn, rs in FUNCTII.items():
    granturi.append('  GRANT EXECUTE ON FUNCTION %s TO %s;' % (fn, ', '.join(rs)))
granturi.append('  GRANT USAGE ON SEQUENCE ' + ', '.join('public.' + s for s in SECV) + ' TO izo_corectie_writer;')

# Verificăm fiecare celulă, inclusiv coloanele: has_table_privilege singur nu
# detectează un GRANT UPDATE(col) suplimentar. Poarta verifică și postcondițiile.
checks = []
for rol in ['anon', 'authenticated', 'service_role', 'izo_doc_editor'] + ROLURI:
    for t in NOI + VECHI:
        if rol not in ROLURI and t not in NOI:
            continue  # ACL-uri E2a/E3 existente, în afara piesei A.
        for p in ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES', 'DELETE', 'TRUNCATE', 'TRIGGER']:
            key = rol, t, p
            if p in ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']:
                expected = 'false' if key not in MATRICE else 'true' if MATRICE[key] is None else 'a.attname::text = ANY (' + arr(MATRICE[key]) + ')'
                cond = "EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.%s'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(%s, a.attrelid, a.attname, %s) IS DISTINCT FROM (%s))" % (t, q(rol), q(p), expected)
            else:
                cond = 'has_table_privilege(%s, %s, %s)' % (q(rol), q('public.' + t), q(p))
            checks.append("    IF %s THEN v := array_append(v, %s); END IF;" % (cond, q('ACL ' + rol + ' ' + t + ' ' + p)))
for rol in ROLURI:
    checks.append("    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relkind = 'S' AND has_sequence_privilege(%s, c.oid, 'USAGE') IS DISTINCT FROM (c.oid = ANY (%s::regclass[]))) THEN v := array_append(v, %s); END IF;" %
                  (q(rol), arr(['public.' + s for s in SECV] if rol == 'izo_corectie_writer' else []), q('USAGE secvențe ' + rol)))
for fn, rs in FUNCTII.items():
    for rol in ROLURI:
        checks.append("    IF has_function_privilege(%s, %s, 'EXECUTE') IS DISTINCT FROM %s THEN v := array_append(v, %s); END IF;" %
                      (q(rol), q(fn), 'true' if rol in rs else 'false', q('EXECUTE ' + rol + ' ' + fn)))

assert len(set(IMPL_E3B)) == len(IMPL_E3B)
IMPL_POST = sorted(IMPL_PRE + IMPL_E3B)
def verifica_impl(lista, etapa):
    return """  v_impl := %s;
  v_impl_rev := %s;
  IF v_impl IS DISTINCT FROM v_impl_rev THEN
    RAISE EXCEPTION 'E3b invocări implicite (%s): actual %% / așteptat %%', v_impl, v_impl_rev;
  END IF;""" % (const['IMPL_EXPR'], arr(lista), etapa)

def tip_check(ts):
    return 'CHECK ((tip = ANY (ARRAY[' + ', '.join(q(t) + '::text' for t in ts) + '])))'

replacements = {
    'AMPRENTA': AMP, 'PRE_MD5': '\n'.join(pre_md5), 'COLOANE': coloane,
    'TIP_CHECK_E3': q(tip_check(TIPURI_E3)), 'TIPURI_E3': ', '.join(map(q, TIPURI_E3)),
    'TIPURI_E3B': ', '.join(map(q, TIPURI_E3 + ['carantina_intrare', 'carantina_iesire', 'storno_partial'])),
    'L_TEAVA': arr(L_TEAVA), 'L_CURBA': arr(L_CURBA), 'L_IDENT': arr(L_IDENT),
    'POLITICI': '\n'.join(politici), 'GRANTURI': '\n'.join(granturi), 'CHECK_ACL': '\n'.join(checks),
    'PORTI_NOUA': pl_noua, 'PORTI_VECHE': pl_veche.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1),
    'IMPL_PRE': verifica_impl(IMPL_PRE, 'baseline înainte'),
    'IMPL_POST': verifica_impl(IMPL_POST, 'diferența autorizată înainte de ștampile'),
    'IMPL_DUPA': verifica_impl(IMPL_POST, 'după ștampile'),
    'DROP_POLITICI': '\n'.join(retrageri),
    'REVOKE_COLOANE': '\n'.join(revoke_coloane),
    'REVOKE_FUNCTII': '\n'.join('  REVOKE ALL ON FUNCTION %s FROM %s;' % (fn, ', '.join(rs)) for fn, rs in FUNCTII.items()),
    'GARDA': '', 'OPERATII': '', 'STORNO': '', 'ISTORIC': '',
}

def genereaza(tpl, destinatie):
    text = (SP / tpl).read_text(encoding='utf-8')
    for k, v in replacements.items():
        text = text.replace('@@' + k + '@@', v)
    assert '@@' not in text, re.findall(r'@@.*?@@', text)
    for tag in set(re.findall(r'\$[a-zA-Z_]*\$', text)):
        assert text.count(tag) % 2 == 0, tag
    with (R / destinatie).open('w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    return text


if __name__ == '__main__':
    mig = genereaza('e3b_tpl.sql', 'supabase/migrations/20261105a_izometrie_e3b_corectii.sql')
    rev = genereaza('e3b_rev_tpl.sql', 'supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql')
    print('ok E3b-A', len(mig.splitlines()), len(rev.splitlines()), 'implicit additions', len(IMPL_E3B))
