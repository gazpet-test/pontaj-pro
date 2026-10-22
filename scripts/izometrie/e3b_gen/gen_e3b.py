# Generator E3b, piesele A+B+C1+C2+D1. Ieșirile supabase/ nu se editează manual.
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


def ddl_exact(bloc):
    # Copia EXACTĂ, în clar, a corpului LIVE (ca gen_e3.py): reviewerii o citesc și o compară; md5-ul se verifică la generare
    return bloc


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

# Semnături fixe, revizuite: folosite și la ACL/revenire; niciun inventar capturat la apply.
FN_B = {
    'fn_izo_cor_chei(text, text, text)': ROLURI,
    'fn_izo_cor_autorizare_lock(bigint, text, integer)': ROLURI,
    'fn_izo_cor_cerut_de_valid(bigint, uuid)': ['izo_corectie_writer'],
    'fn_izo_cor_bucata_lock(bigint, bigint)': ['izo_cor_editor'],
    'fn_izo_cor_doc_lock(bigint, bigint)': ['izo_cor_editor'],
    'fn_izo_cor_deschise(bigint[])': ['izo_registru_writer', 'izo_receptie_writer'],
    'fn_izo_cor_api_verifica()': ROLURI,
    'fn_izo_cor_adm_verifica()': ['izo_corectie_writer'],
    'fn_izo_cor_marcheaza(bigint)': ['izo_corectie_writer'],
    'fn_izo_cor_loc(public.magazie_bucati)': ROLURI,
    'fn_izo_cor_tinta_iesire(public.magazie_bucati)': ROLURI,
    'fn_izo_cor_valori(public.magazie_bucati)': ROLURI,
    'fn_izo_cor_valideaza(public.izo_corectii)': ROLURI,
    'fn_izo_cor_inainte(public.izo_corectii)': ROLURI,
    'fn_izo_cor_eveniment_asteptat(public.izo_corectii)': ['izo_corectie_writer'],
    'fn_izo_cor_bucata_dupa(public.izo_corectii, public.magazie_bucati)': ['izo_corectie_writer'],
    'fn_izo_cor_bucata_noua(public.izo_corectii)': ['izo_corectie_writer'],
    'fn_izo_cor_miscare_asteptata(public.izo_corectii, public.magazie_bucati)': ['izo_corectie_writer'],
    'fn_izo_garda_corectie(text, text, jsonb, jsonb)': ['izo_corectie_writer'],
    'fn_izo_cor_garda()': [],  # declanșare implicită, fără EXECUTE pentru API / writeri
}
FN_C1 = {
    'fn_izo_cor_propune(text, bigint, bigint, jsonb, text)': 'izo_cor_editor',
    'fn_izo_cor_retrage(bigint, bigint, text)': 'izo_cor_editor',
    'fn_izo_cor_respinge(bigint, bigint, text)': 'izo_cor_editor',
    'fn_izo_cor_verifica(bigint, text, bigint, bigint, jsonb)': 'izo_cor_editor',
    'fn_izo_cor_aproba(bigint, bigint)': 'izo_corectie_writer',
}
FN_C2 = {
    'fn_izo_cor_camp(bigint, bigint, jsonb, text)': 'izo_corectie_writer',
    'fn_izo_cor_pv(bigint, bigint, text, date, text)': 'izo_corectie_writer',
}
FN_D1 = {'fn_izo_cor_storno_import(bigint, text, bigint[], text, uuid)': 'izo_corectie_writer'}
FN_B.update({
    'fn_izo_lant_blocant(bigint[], bigint[])': ['izo_corectie_writer'],
    'fn_izo_doc_instantaneu(bigint)': ['izo_doc_editor'],
    'fn_izo_doc_diff(jsonb, jsonb)': ['izo_doc_editor'],
    'fn_izo_doc_ist_garda()': [],
})
FN_OPERATII = FN_C1 | FN_C2 | FN_D1
for fn in FN_OPERATII:
    executa(fn, ['postgres'] if fn in FN_D1 else ['authenticated'])
for fn, roluri in FN_B.items():
    executa(fn, roluri)
for tabel in ['izo_corectii', 'izo_corectii_bucati']:
    for trigger in ['trg_izo_cor_garda', 'trg_izo_cor_truncate']:
        IMPL_E3B.append('trigger|%s on public.%s|public.fn_izo_cor_garda()' % (trigger, tabel))

for trigger in ['trg_izo_doc_ist_garda', 'trg_izo_doc_ist_truncate']:
    IMPL_E3B.append('trigger|%s on public.izo_documente_istoric|public.fn_izo_doc_ist_garda()' % trigger)

# Blocurile LIVE exacte + md5(prosrc). B înlocuiește cele trei gărzi și poarta.
# Celelalte corpuri E3 sunt doar verificate; rescrierile de operații rămân pentru D.
INLOCUIRI_D = {
    'fn_izo_garda_bucati': e3, 'fn_izo_garda_fapte': e3, 'fn_izo_doc_garda': e3,
    'fn_izo_porti_lipsa': e3, 'fn_izo_doc_salveaza': e3,
    'fn_izo_doc_anuleaza': e3, 'fn_izo_garda_receptie': e3,
}
BLOCURI_VECHI = {n: bloc_functie(s, n) for n, s in INLOCUIRI_D.items()}
MD5_VECHI = {n: md5(prosrc(b)) for n, b in BLOCURI_VECHI.items()}

INLOCUIRI_B = ['fn_izo_garda_bucati', 'fn_izo_garda_fapte', 'fn_izo_doc_garda']
garzi_noi, garzi_vechi = [], []
for n in INLOCUIRI_B:
    vechi = BLOCURI_VECHI[n]
    nou = vechi.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
    if n == 'fn_izo_doc_garda':
        punct = "    RAISE EXCEPTION 'izo E3: documentele de intrare se scriu doar prin funcțiile E3"
        poz = nou.index(punct)
        adaos = """    IF current_user = 'izo_corectie_writer' THEN
      PERFORM public.fn_izo_garda_corectie(TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
      RETURN NEW;
    END IF;
"""
    else:
        punct = '    END IF;'
        poz = nou.index(punct, nou.index("    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer'")) + len(punct) + 1
        adaos = """    IF v_aut IS NOT TRUE AND current_user = 'izo_corectie_writer' THEN
      v_aut := public.fn_izo_garda_corectie(TG_TABLE_NAME, TG_OP,
        CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
"""
    nou = nou[:poz] + adaos + nou[poz:]
    assert prosrc(nou).replace(adaos, '', 1) == prosrc(vechi), n
    garzi_noi.append(nou)
    garzi_vechi.append(vechi.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
    garzi_vechi.append("  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.%s()'::regprocedure) IS DISTINCT FROM %s THEN\n"
                       "    RAISE EXCEPTION 'E3b: restaurarea exactă %s a eșuat'; END IF;" % (n, q(MD5_VECHI[n]), n))
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
    if rs and fn != 'public.fn_izo_cor_marcheaza(bigint)' and fn[7:] not in FN_OPERATII:  # EXECUTE implicit al owner-ului, fără GRANT ca postgres
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
    for rol in (['anon', 'authenticated', 'service_role', 'izo_registru_writer', 'izo_receptie_writer', 'izo_doc_editor'] + ROLURI if fn[7:] in FN_B or fn[7:] in FN_OPERATII else ROLURI):
        checks.append("    IF has_function_privilege(%s, %s, 'EXECUTE') IS DISTINCT FROM %s THEN v := array_append(v, %s); END IF;" %
                      (q(rol), q(fn), 'true' if rol in rs or (fn[7:] in FN_OPERATII and rol == FN_OPERATII[fn[7:]]) else 'false', q('EXECUTE ' + rol + ' ' + fn)))

for signature in FN_B:
    name = signature.split('(')[0]
    owner = 'izo_corectie_writer' if name == 'fn_izo_cor_marcheaza' else 'postgres'
    definer = name in {'fn_izo_cor_autorizare_lock', 'fn_izo_cor_cerut_de_valid', 'fn_izo_cor_bucata_lock',
                      'fn_izo_cor_doc_lock', 'fn_izo_cor_deschise', 'fn_izo_lant_blocant'}
    checks.append("    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=%s) <> 1"
                  " OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=%s::regprocedure AND proowner=%s::regrole"
                  " AND prosecdef=%s AND proconfig=ARRAY['search_path=public, pg_temp'])"
                  " THEN v := array_append(v,%s); END IF;" %
                  (q(name), q('public.' + signature), q(owner), str(definer).lower(), q('définition ' + name)))

# C1/C2: ștampilă + celulele owner/DEFINER, fără invocări implicite noi.
for signature, owner in FN_OPERATII.items():
    checks.append("    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=%s::regprocedure AND proowner=%s::regrole AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']) THEN v := array_append(v,%s); END IF;" % (q('public.'+signature), q(owner), q('définition '+signature)))

OWNERI = []
for signature, owner in FN_OPERATII.items():
    OWNERI.extend([
        '  GRANT CREATE ON SCHEMA public TO %s;' % owner,
        '  ALTER FUNCTION public.%s OWNER TO %s;' % (signature, owner),
        '  REVOKE CREATE ON SCHEMA public FROM %s;' % owner,
        '  SET LOCAL ROLE %s;' % owner,
        '  REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role;' % signature,
        '  GRANT EXECUTE ON FUNCTION public.%s TO %s;' % (signature, 'postgres' if signature in FN_D1 else 'authenticated'),
        '  RESET ROLE;',
    ])
operatii = (SP / 'e3b_operatii_tpl.sql').read_text(encoding='utf-8-sig')
operatii += '\n' + (SP / 'e3b_d1_tpl.sql').read_text(encoding='utf-8')
for key, value in {
    'COLLISION_PRED': "AND b.provenienta='beneficiar' AND b.tip_cod=v_after.tip_cod AND b.stare<>'anulata'\n          AND b.serie_canon=public.fn_izo_canon_serie(v_after.serie)\n          AND ((b.tip_cod='teava' AND b.dezambiguare IS NOT DISTINCT FROM v_after.dezambiguare\n            AND (b.parinte_id IS NULL OR (b.stare<>'taiata' AND b.sarja IS NOT DISTINCT FROM v_after.sarja\n              AND b.lungime_cm IS NOT DISTINCT FROM round(v_after.lungime_mm/10.0)::integer)))\n          OR (b.tip_cod='curba' AND b.sarja IS NOT DISTINCT FROM v_after.sarja AND b.unghi_curba IS NOT DISTINCT FROM v_after.unghi_curba\n            AND b.cod_bucata IS NOT DISTINCT FROM v_after.cod_bucata))",
    # server_ver NOT NULL pe evenimente / mișcări: explicit, ca în E3 (20261103b)
    'EV_COLS': ', '.join(EV + ['server_ver']), 'EV_VALUES': ', '.join(['v_event.'+c for c in EV] + ["nextval('public.izo_server_ver_seq')"]),
    'MIS_COLS': ', '.join(MIS + ['server_ver']), 'MIS_VALUES': ', '.join(['v_move.'+c for c in MIS] + ["nextval('public.izo_server_ver_seq')"]),
    'INS_COLS': ', '.join(INS), 'INS_VALUES': ', '.join('v_after.'+c for c in INS),
    'UPDATE_VALUES': ', '.join(c+'=v_after.'+c for c in UPD if c not in ['server_ver','updated_at']),
}.items():
    operatii = operatii.replace('@@'+key+'@@', value)
operatii += '\n' + '\n'.join(OWNERI)

# D1: canonical object extracted verbatim from the LIVE hash, never reformat it.
hash_bloc = bloc_functie(e3, 'fn_izo_doc_hash')
hash_src = prosrc(hash_bloc)
obj = hash_src.split("convert_to(", 1)[1].split(")::text, 'UTF8'", 1)[0] + ')'
instantaneu = "  CREATE FUNCTION public.fn_izo_doc_instantaneu(p_doc bigint) RETURNS jsonb\n    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$\n    SELECT " + obj + "\n    FROM public.izo_documente_intrare d WHERE d.id = p_doc\n  $f$;"
assert obj + "::text, 'UTF8'" in hash_src
canonical_check = "  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_doc_hash(bigint)'::regprocedure) IS DISTINCT FROM " + q(md5(hash_src)) + " OR position(" + q(obj) + " IN (SELECT prosrc FROM pg_proc WHERE oid='public.fn_izo_doc_instantaneu(bigint)'::regprocedure))=0 THEN RAISE EXCEPTION 'E3b: hash LIVE / instantaneu canonic diferit'; END IF;"
salveaza_veche = BLOCURI_VECHI['fn_izo_doc_salveaza']
istoric_insert = """    INSERT INTO public.izo_documente_istoric(document_id,versiune,salvat_de,salvat_rol,continut,hash,diff,baza)
    SELECT d.id,d.versiune,v_uid,session_user,public.fn_izo_doc_instantaneu(d.id),public.fn_izo_doc_hash(d.id),
      public.fn_izo_doc_diff((SELECT ist.continut FROM public.izo_documente_istoric ist WHERE ist.document_id=d.id ORDER BY ist.versiune DESC LIMIT 1),public.fn_izo_doc_instantaneu(d.id)),
      NOT EXISTS(SELECT 1 FROM public.izo_documente_istoric ist WHERE ist.document_id=d.id);
"""
salveaza_noua = salveaza_veche.replace('  CREATE FUNCTION','  CREATE OR REPLACE FUNCTION',1)
salveaza_noua = salveaza_noua.replace("    RETURN jsonb_build_object('document_id', d.id", istoric_insert + "    RETURN jsonb_build_object('istoric_versiune', d.versiune, 'document_id', d.id",1)
def ca_editor(bloc):
    return ('  GRANT CREATE ON SCHEMA public TO izo_doc_editor;\n  SET LOCAL ROLE izo_doc_editor;\n' + bloc +
            '\n  RESET ROLE;\n  REVOKE CREATE ON SCHEMA public FROM izo_doc_editor;')
garzi_vechi.append(ca_editor(salveaza_veche.replace('  CREATE FUNCTION','  CREATE OR REPLACE FUNCTION',1)))
garzi_vechi.append("  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname='fn_izo_doc_salveaza' AND pronamespace='public'::regnamespace) IS DISTINCT FROM " + q(MD5_VECHI['fn_izo_doc_salveaza']) + " THEN RAISE EXCEPTION 'E3b: restaurare salvare diferita'; END IF;")

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
    'PORTI_NOUA': ddl_exact(pl_noua),
    'PORTI_VECHE': ddl_exact(pl_veche.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)) +
        "\n  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_izo_porti_lipsa()'::regprocedure) IS DISTINCT FROM " +
        q(MD5_VECHI['fn_izo_porti_lipsa']) + " THEN RAISE EXCEPTION 'E3b: restaurarea porții diferă'; END IF;",
    'IMPL_PRE': verifica_impl(IMPL_PRE, 'baseline înainte'),
    'IMPL_POST': verifica_impl(IMPL_POST, 'diferența autorizată înainte de ștampile'),
    'IMPL_DUPA': verifica_impl(IMPL_POST, 'după ștampile'),
    'DROP_POLITICI': '\n'.join(retrageri),
    'REVOKE_COLOANE': '\n'.join(revoke_coloane),
    'REVOKE_FUNCTII': '\n'.join('  REVOKE ALL ON FUNCTION %s FROM %s;' % (fn, ', '.join(rs)) for fn, rs in FUNCTII.items()
                              if rs and fn != 'public.fn_izo_cor_marcheaza(bigint)' and fn[7:] not in FN_OPERATII),
    'GARZI_NOI': '\n'.join(garzi_noi), 'GARZI_VECHI': '\n'.join(garzi_vechi),
    'NUME_FN_B': arr([fn.split('(')[0] for fn in list(FN_B) + list(FN_OPERATII) + ['fn_izo_doc_salveaza']]),
    'ACL_GARDA': '\n'.join('  REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role;\n%s'
                          % (fn, ("  GRANT CREATE ON SCHEMA public TO izo_corectie_writer;\n"
                                  "  ALTER FUNCTION public.%s OWNER TO izo_corectie_writer;\n"
                                  "  REVOKE CREATE ON SCHEMA public FROM izo_corectie_writer;" % fn)
                             if fn.startswith('fn_izo_cor_marcheaza(') else '  ALTER FUNCTION public.%s OWNER TO postgres;' % fn)
                          for fn in FN_B),
    'DROP_GARDA': '\n'.join(('  SET LOCAL ROLE izo_corectie_writer;\n  DROP FUNCTION public.%s;\n  RESET ROLE;' % fn)
                           if fn.startswith('fn_izo_cor_marcheaza(') else '  DROP FUNCTION public.%s;' % fn for fn in reversed(FN_B)),
    'DROP_OPERATII': '\n'.join('  SET LOCAL ROLE %s;\n  DROP FUNCTION public.%s;\n  RESET ROLE;' % (owner, fn) for fn, owner in reversed(list(FN_OPERATII.items()))),
    'GARDA': '', 'OPERATII': operatii, 'STORNO': '', 'ISTORIC': instantaneu + '\n' + ca_editor(salveaza_noua) + '\n' + canonical_check,
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
    mig = genereaza('e3b_tpl.sql', 'supabase/migrations/20261106a_izometrie_e3b_corectii.sql')
    rev = genereaza('e3b_rev_tpl.sql', 'supabase/revenire/20261106a_izometrie_e3b_corectii_ROLLBACK.sql')
    print('ok E3b-A+B+C1+C2+D1', len(mig.splitlines()), len(rev.splitlines()), 'implicit additions', len(IMPL_E3B))
