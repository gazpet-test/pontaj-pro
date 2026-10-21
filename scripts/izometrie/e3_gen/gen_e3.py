# Generatorul migrării 20261103b (E3), al revenirii și al helper-ului de test diferențial.
# Sursele sunt șabloanele de lângă el (e3_tpl.sql, e3_rev_tpl.sql); fișierele din supabase/ sunt IEȘIRI — nu se editează de mână.
# Utilizare (din orice director): python scripts/izometrie/e3_gen/gen_e3.py   apoi harness-ul: scripts/test_izometrie_e3.sh
# r5f (#825 NO-GO, P1-3/P1-4): baseline-ul extern pre-E3 (baseline_pre_e3.json) se reîmprospătează DOAR cu review:
#   python gen_e3.py --captura                    → SQL-ul capturii (doar SELECT pe cataloage), rulat read-only pe prod;
#   python gen_e3.py --din-captura <rezultat>     → baseline_pre_e3.json (diff-ul se revizuiește), apoi gen_e3.py normal.
# Generarea scrie și supabase/tests/izometrie_e3_schelet_baseline.sql (scheletul local care reproduce exact baseline-ul).
import hashlib, json, os, re, sys
SP = os.path.dirname(os.path.abspath(__file__)).replace(os.sep, '/') + '/'
R = os.path.abspath(os.path.join(SP, '..', '..', '..')).replace(os.sep, '/') + '/'
e2a = open(R + 'supabase/migrations/20261102a_izometrie_e2a_registru.sql', encoding='utf-8').read()
tpl = open(SP + 'e3_tpl.sql', encoding='utf-8').read()

def bloc_functie(semn):
    i = e2a.index('  CREATE FUNCTION public.%s' % semn)
    j = e2a.index('END $f$;', i) + len('END $f$;')
    return e2a[i:j]

def prosrc(bloc):
    i = bloc.index('AS $f$') + len('AS $f$'); j = bloc.rindex('$f$')
    return bloc[i:j]

def md5(t): return hashlib.md5(t.encode('utf-8')).hexdigest()

amp_i = e2a.index('  -- <amprenta>'); amp_j = e2a.index('  -- </amprenta>') + len('  -- </amprenta>')
AMPRENTA = e2a[amp_i:amp_j]

# ── r5f (#825 NO-GO, P1-3/P1-4): baseline-ul EXTERN de dinainte de E3, verificat la apply (preflight 0l) față de amprenta
# pre-E3 REVIZUITĂ din baseline_pre_e3.json (capturată read-only de pe prod), nu ștampilat cum e găsit (fără TOFU).
# Aceeași expresie: în migrare (v_baza) și în captură (python gen_e3.py --captura → SQL de rulat read-only pe prod).
# Forma e stabilă PG16 ↔ PG17: nume (nu oid-uri), pg_get_expr / pg_get_triggerdef, ACL-ul explodat fără MAINTAIN (doar
# PG17), colaționare "C", rolul 0 = public.
REL_EXT = "(n.nspname, c.relname) IN (('storage', 'objects'), ('storage', 'buckets'))"
TRG_PROFILES = ("n2.nspname = 'public' AND c2.relname = 'profiles' AND g.tgname IN ('prevent_role_escalation_trigger', "
                "'trg_profiles_campuri_owner_only')")
BAZA_EXPR = r"""jsonb_build_object(
      'relatii', (SELECT coalesce(jsonb_object_agg(n.nspname || '.' || c.relname, md5(concat_ws(':', pg_get_userbyid(c.relowner), c.relrowsecurity,
                    c.relforcerowsecurity, (SELECT coalesce(string_agg(q.x, ',' ORDER BY q.x COLLATE "C"), '')
                      FROM (SELECT format('%s>%s:%s:%s', CASE WHEN a.grantor = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantor) END,
                                          CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type, a.is_grantable) AS x
                              FROM aclexplode(c.relacl) a WHERE a.privilege_type <> 'MAINTAIN') q)))), '{}')
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE @@REL_EXT@@),
      'politici', (SELECT coalesce(jsonb_object_agg(n.nspname || '.' || c.relname || '.' || p.polname, md5(concat_ws(':', p.polcmd, p.polpermissive,
                     (SELECT string_agg(r.x, ',' ORDER BY r.x COLLATE "C")
                        FROM (SELECT CASE WHEN o = 0 THEN 'public' ELSE pg_get_userbyid(o) END AS x FROM unnest(p.polroles) o) r),
                     coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')))), '{}')
                     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE @@REL_EXT@@),
      'triggere', (SELECT coalesce(jsonb_object_agg(n2.nspname || '.' || c2.relname || '.' || g.tgname,
                     md5(concat_ws(':', pg_get_triggerdef(g.oid, false), g.tgenabled))), '{}')
                     FROM pg_trigger g JOIN pg_class c2 ON c2.oid = g.tgrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace WHERE @@TRG_PROFILES@@),
      'functii', (SELECT coalesce(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                    md5(concat_ws(':', pg_get_userbyid(p.proowner), p.prosecdef, coalesce(p.proconfig::text, ''), p.provolatile, md5(p.prosrc)))), '{}')
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE p.oid IN (SELECT g.tgfoid FROM pg_trigger g JOIN pg_class c2 ON c2.oid = g.tgrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
                                    WHERE @@TRG_PROFILES@@)))""".replace('@@REL_EXT@@', REL_EXT).replace('@@TRG_PROFILES@@', TRG_PROFILES)
# funcțiile din expresiile politicilor Storage (pentru stub-urile scheletului local; doar semnătura și tipul rezultatului)
REFERINTE = [('public', 'fn_executie_pachete_acces'), ('public', 'poate_edita_documente_firma'), ('public', 'my_employee_id'),
             ('public', 'fn_is_app_owner'), ('public', 'fn_facturi_pdf_acces'), ('public', 'fn_hr_decizii_storage_poate'),
             ('public', 'fn_are_acces_ofertare'), ('public', 'fn_ofertare_obiect_in_pachet_inghetat'), ('storage', 'foldername')]
CAPTURA_SQL = r"""-- captura baseline-ului pre-E3 (READ-ONLY, doar cataloage) — rezultatul (fără „umplutura”) devine baseline_pre_e3.json
SELECT jsonb_build_object(
  'capturat_la', now(), 'server_version', current_setting('server_version'),
  'md5_prod', @@BAZA_EXPR@@,
  'relatii', (SELECT jsonb_agg(jsonb_build_object('rel', n.nspname || '.' || c.relname, 'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity,
      'force', c.relforcerowsecurity, 'acl', (SELECT coalesce(jsonb_agg(jsonb_build_array(
          CASE WHEN a.grantor = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantor) END, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          a.privilege_type, a.is_grantable)), '[]') FROM aclexplode(c.relacl) a WHERE a.privilege_type <> 'MAINTAIN')) ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE @@REL_EXT@@),
  'politici', (SELECT jsonb_agg(jsonb_build_object('rel', n.nspname || '.' || c.relname, 'nume', p.polname, 'cmd', p.polcmd::text, 'permisiva', p.polpermissive,
      'roluri', (SELECT jsonb_agg(CASE WHEN o = 0 THEN 'public' ELSE pg_get_userbyid(o) END) FROM unnest(p.polroles) o),
      'qual', pg_get_expr(p.polqual, p.polrelid), 'wc', pg_get_expr(p.polwithcheck, p.polrelid)) ORDER BY c.relname, p.polname COLLATE "C")
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE @@REL_EXT@@),
  'triggere', (SELECT jsonb_agg(jsonb_build_object('rel', n2.nspname || '.' || c2.relname, 'nume', g.tgname, 'def', pg_get_triggerdef(g.oid, false),
      'enabled', g.tgenabled::text) ORDER BY g.tgname)
      FROM pg_trigger g JOIN pg_class c2 ON c2.oid = g.tgrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace WHERE @@TRG_PROFILES@@),
  'functii', (SELECT jsonb_agg(jsonb_build_object('schema', n.nspname, 'nume', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'rezultat', pg_get_function_result(p.oid), 'owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'config', p.proconfig::text,
      'volatil', p.provolatile::text, 'limbaj', l.lanname, 'prosrc', p.prosrc,
      'acl', (SELECT coalesce(jsonb_agg(jsonb_build_array(CASE WHEN a.grantor = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantor) END,
          CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type, a.is_grantable)), '[]')
          FROM aclexplode(p.proacl) a)) ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid IN (SELECT g.tgfoid FROM pg_trigger g JOIN pg_class c2 ON c2.oid = g.tgrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
                      WHERE @@TRG_PROFILES@@)),
  'referinte', (SELECT jsonb_agg(jsonb_build_object('schema', n.nspname, 'nume', p.proname, 'args', pg_get_function_arguments(p.oid),
      'rezultat', pg_get_function_result(p.oid)) ORDER BY n.nspname, p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE (n.nspname, p.proname) IN (@@REFERINTE@@)),
  'umplutura', repeat('.', 150000)) AS captura;
""".replace('@@BAZA_EXPR@@', BAZA_EXPR).replace('@@REL_EXT@@', REL_EXT).replace('@@TRG_PROFILES@@', TRG_PROFILES).replace(
    '@@REFERINTE@@', ", ".join("('%s', '%s')" % x for x in REFERINTE))
if '--captura' in sys.argv:
    sys.stdout.reconfigure(encoding='utf-8'); print(CAPTURA_SQL); sys.exit(0)
if '--din-captura' in sys.argv:
    # rezultatul capturii (ieșirea MCP execute_sql salvată, rândul [{"captura": …}] sau obiectul direct, ex. psql -At) →
    # baseline_pre_e3.json; md5-urile se reverifică la generare (assert-ul de mai jos), apoi diff-ul JSON se revizuiește în git
    def extrage(t):
        try: o = json.loads(t)
        except ValueError: o = None
        if isinstance(o, dict) and 'result' in o: return extrage(o['result'])
        if isinstance(o, dict) and 'md5_prod' in o: return o
        if isinstance(o, list) and len(o) == 1 and 'captura' in o[0]:
            c = o[0]['captura']; return json.loads(c) if isinstance(c, str) else c
        return extrage(t[t.index('[{'):t.rindex('}]') + 2])
    cap = extrage(open(sys.argv[sys.argv.index('--din-captura') + 1], encoding='utf-8').read())
    assert set(cap.pop('umplutura', '.')) == {'.'}
    cap = {'_despre': ['Baseline-ul EXTERN pre-E3 (Storage + trigger-ele profiles), capturat READ-ONLY de pe prod (dxczwkbciseqniprspcu) cu',
                       'python scripts/izometrie/e3_gen/gen_e3.py --captura, extras cu --din-captura <fișier>. REVIZUIT: orice schimbare pe prod =>',
                       'captură nouă, diff revizuit în git, apoi gen_e3.py (constanta preflight-ului 0l + scheletul izometrie_e3_schelet_baseline.sql).',
                       'r5f (#825 NO-GO, P1-3/P1-4).'],
           **{k: cap[k] for k in ['capturat_la', 'server_version', 'md5_prod', 'relatii', 'triggere', 'functii', 'referinte', 'politici']}}
    open(SP + 'baseline_pre_e3.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(cap, ensure_ascii=False, indent=1) + '\n')
    print('baseline_pre_e3.json:', len(cap['politici']), 'politici, capturat', cap['capturat_la']); sys.exit(0)

# ── constantele ──
C = ['proiect_id', 'comanda_furnizor_id', 'tip_material_id', 'serie', 'sarja', 'dimensiune', 'grad_otel', 'standard', 'lungime_m',
     'lungime_originala_m', 'greutate_kg', 'unghi_curba', 'cantitate', 'um', 'provenienta', 'izolatie', 'furnizor', 'producator',
     'sursa_receptie', 'fara_packing_list', 'nr_document', 'data_receptie', 'mtc_path', 'stare', 'locatie_tip', 'locatie_site_id',
     'executie_teava_id', 'atribute', 'observatii', 'receptionat_de', 'receptionat_la', 'created_by', 'tip_cod', 'parinte_id',
     'cod_bucata', 'capat_stanga', 'capat_dreapta', 'dezambiguare', 'lungime_aviz_mm', 'lungime_masurata_mm', 'lungime_mm',
     'lungime_calculata', 'perete_mm', 'diametru_mm', 'lot', 'aviz_intrare_id', 'nr_crt_aviz', 'bend_no', 'capat_marcaj',
     'depozit_id', 'tronson_id']
assert len(C) == 51 and len(set(C)) == 51
EV = ['tip', 'proiect_id', 'document_tip', 'document_id', 'import_id', 'storno_de_eveniment_id', 'motiv', 'declarat_de', 'aplicat_de',
      'aplicat_rol', 'ora_tableta', 'dispozitiv_id']
MIS = ['eveniment_id', 'proiect_id', 'bucata_id', 'rol', 'stare_inainte', 'stare_dupa', 'din_loc', 'in_loc', 'lungime_mm', 'inainte', 'dupa']
arr = lambda xs: "ARRAY[" + ", ".join("'%s'" % x for x in xs) + "]::text[]"

TIPURI_E2A = ['sold_initial', 'intrare_aviz', 'gasit', 'iesire_tranzit', 'livrare', 'retur_fizic', 'confirmare_primire_depozit',
              'mutare_tronson', 'taiere', 'montaj', 'demontaj', 'deseu', 'pierdut', 'inventar_ajustare', 'corectie', 'corectie_radacina', 'storno']
TIP_CHECK_E2A = "CHECK ((tip = ANY (ARRAY[" + ", ".join("'%s'::text" % t for t in TIPURI_E2A) + "])))"
TIPURI_E3 = TIPURI_E2A + ['intrare_lista_ambalare', 'receptie_pv']

# ── antet / rânduri / scanuri: cheile API și tipurile ──
ANTET = [('furnizor', 'text'), ('furnizor_cif', 'text'), ('nr_document', 'text'), ('data_document', 'date'), ('cumparator', 'text'),
         ('transport_nr', 'text'), ('nume_proiect', 'text'), ('lot', 'text'), ('loc_livrare', 'text'), ('data_incarcare', 'date'),
         ('data_descarcare', 'date'), ('nr_camion', 'text'), ('factura', 'text'), ('importator', 'text'), ('destinatar', 'text'),
         ('referinta_client', 'text'), ('referinta_furnizor', 'text'), ('placa_camion_container', 'text'), ('total_m', 'numeric'),
         ('total_kg', 'numeric'), ('total_bucati', 'integer'), ('total_pachete', 'integer'), ('total_net_kg', 'numeric'),
         ('total_brut_kg', 'numeric'), ('observatii', 'text')]
RAND = [('nr_crt', 'integer'), ('serie', 'text'), ('sarja', 'text'), ('lot', 'text'), ('specificatie', 'text'), ('dimensiune', 'text'),
        ('grad_otel', 'text'), ('standard', 'text'), ('izolatie', 'text'), ('diametru_mm', 'integer'), ('perete_mm', 'numeric'),
        ('greutate_kg', 'numeric'), ('lungime_doc_mm', 'integer'), ('lungime_masurata_mm', 'integer'), ('cod', 'text'), ('item', 'text'),
        ('unghi_doc', 'numeric'), ('unghi_masurat', 'numeric'), ('cantitate', 'integer'), ('pachet_nr', 'text'),
        ('dimensiuni_cm', 'text'), ('net_kg', 'numeric'), ('brut_kg', 'numeric'), ('decizie', 'text'), ('motiv', 'text'),
        ('observatie', 'text')]
SCAN = [('cale', 'text'), ('sha256_original', 'text'), ('sha256_pdf', 'text'), ('marime', 'bigint'), ('mime', 'text')]
val = lambda src, k, t: ("(%s ->> '%s')::%s" % (src, k, t)) if t != 'text' else ("%s ->> '%s'" % (src, k))
CHEI_ANTET = ", ".join("'%s'" % k for k, _ in ANTET)
CHEI_RAND = ", ".join("'%s'" % k for k, _ in RAND)
ANTET_COLS = ", ".join(k for k, _ in ANTET)
ANTET_VALS = ", ".join(val('p_antet', k, t) for k, t in ANTET)
ANTET_SET = ",\n        ".join("%s = %s" % (k, val('p_antet', k, t)) for k, t in ANTET)
RAND_COLS = ", ".join(k for k, _ in RAND)
RAND_VALS = ", ".join(("coalesce(x ->> 'decizie', 'primit')" if k == 'decizie' else val('x', k, t)) for k, t in RAND)

INTRARI = r"""
  -- salvarea draftului (§5, r5d): creare / editare, CAS pe versiune, rândurile și (opțional) manifestul înlocuite integral
  CREATE FUNCTION public.fn_izo_doc_salveaza(p_doc_id bigint, p_versiune bigint, p_antet jsonb, p_randuri jsonb, p_scanuri jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; d public.izo_documente_intrare; v_k text; v_x jsonb; v_tp bigint; v_td integer;
    c_antet constant text[] := ARRAY[@@CHEI_ANTET@@];
    c_creare constant text[] := ARRAY['proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire'];
    c_rand constant text[] := ARRAY[@@CHEI_RAND@@];
    c_scan constant text[] := ARRAY['cale', 'sha256_original', 'sha256_pdf', 'marime', 'mime'];
  BEGIN
    v_uid := public.fn_izo_doc_api_verifica();
    IF jsonb_typeof(p_antet) IS DISTINCT FROM 'object' OR jsonb_typeof(p_randuri) IS DISTINCT FROM 'array'
       OR (p_scanuri IS NOT NULL AND jsonb_typeof(p_scanuri) IS DISTINCT FROM 'array') THEN
      RAISE EXCEPTION 'izo E3: p_antet trebuie să fie obiect, p_randuri listă, p_scanuri listă sau null' USING ERRCODE = '22023';
    END IF;
    SELECT k INTO v_k FROM jsonb_object_keys(p_antet) k WHERE k <> ALL (c_antet || c_creare) LIMIT 1;
    IF v_k IS NOT NULL THEN RAISE EXCEPTION 'izo E3: cheie necunoscută în antet: %', v_k USING ERRCODE = '22023'; END IF;
    FOR v_x IN SELECT x FROM jsonb_array_elements(p_randuri) x LOOP
      IF jsonb_typeof(v_x) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'izo E3: un rând nu e obiect' USING ERRCODE = '22023'; END IF;
      SELECT k INTO v_k FROM jsonb_object_keys(v_x) k WHERE k <> ALL (c_rand) LIMIT 1;
      IF v_k IS NOT NULL THEN RAISE EXCEPTION 'izo E3: cheie necunoscută în rând: %', v_k USING ERRCODE = '22023'; END IF;
      -- r5f (#825 NO-GO): 1 rând = 1 bucată — confirmarea naște exact una pe rând; cantitatea e goală (= 1) sau 1 (și CHECK pe tabel)
      IF v_x ->> 'cantitate' IS NOT NULL AND (v_x ->> 'cantitate')::numeric IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'izo E3: rândul %: cantitatea e %; un rând = o bucată (cantitate 1 sau goală) — fiecare bucată pe rândul ei, cu seria ei',
          v_x ->> 'nr_crt', v_x ->> 'cantitate' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF p_scanuri IS NOT NULL THEN
      FOR v_x IN SELECT x FROM jsonb_array_elements(p_scanuri) x LOOP
        IF jsonb_typeof(v_x) IS DISTINCT FROM 'object'
           OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_x) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(c_scan) k) THEN
          RAISE EXCEPTION 'izo E3: un scan din manifest are exact cheile cale, sha256_original, sha256_pdf, marime, mime' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    IF p_doc_id IS NULL THEN
      IF p_versiune IS NOT NULL THEN RAISE EXCEPTION 'izo E3: la creare p_versiune e NULL' USING ERRCODE = '22023'; END IF;
      IF NOT public.fn_izo_doc_autorizare_lock((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer) THEN
        RAISE EXCEPTION 'izo E3: nu ești gestionar pe acest proiect și depozit' USING ERRCODE = '42501';
      END IF;
      IF coalesce(public.fn_izo_nivel((p_antet ->> 'proiect_id')::bigint), 'off') NOT IN ('stoc', 'montaj') THEN
        RAISE EXCEPTION 'izo E3: proiectul nu are registrul de țeavă activ' USING ERRCODE = '42501';
      END IF;
      IF NOT public.fn_izo_loc_valid((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, NULL) THEN
        RAISE EXCEPTION 'izo E3: depozitul nu e activ sau nu e pe site-ul proiectului' USING ERRCODE = '23514';
      END IF;
      -- r5f (#825 NO-GO): ținta înlocuirii se verifică și se autorizează ÎNAINTEA INSERT-ului — altfel FK-ul (23503) / UNIQUE-ul
      -- (23505) de pe inlocuieste_document_id ar spune dacă un document inaccesibil există sau e deja înlocuit (oracle între
      -- proiecte). „Nu există” și „există, dar nu e al tău” dau același mesaj; UNIQUE-ul rămâne arbitrul, după autorizare
      IF p_antet ->> 'inlocuieste_document_id' IS NOT NULL THEN
        SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
         WHERE t.id = (p_antet ->> 'inlocuieste_document_id')::bigint AND t.stare = 'anulat' FOR SHARE;
        IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
          RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
        END IF;
      END IF;
      INSERT INTO public.izo_documente_intrare (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, @@ANTET_COLS@@)
      VALUES ((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, p_antet ->> 'sablon',
              (p_antet ->> 'inlocuieste_document_id')::bigint, p_antet ->> 'motiv_inlocuire', v_uid, @@ANTET_VALS@@)
      RETURNING * INTO d;
    ELSE
      SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
      IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
        RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
      END IF;
      IF d.stare <> 'draft' THEN RAISE EXCEPTION 'izo E3: documentul e %; se editează doar ciornele', d.stare USING ERRCODE = '42501'; END IF;
      IF p_versiune IS DISTINCT FROM d.versiune THEN
        RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %) — reîncarcă', d.versiune, p_versiune USING ERRCODE = '40001';
      END IF;
      IF (p_antet ? 'proiect_id' AND (p_antet ->> 'proiect_id')::bigint IS DISTINCT FROM d.proiect_id)
         OR (p_antet ? 'depozit_id' AND (p_antet ->> 'depozit_id')::integer IS DISTINCT FROM d.depozit_id)
         OR (p_antet ? 'sablon' AND p_antet ->> 'sablon' IS DISTINCT FROM d.sablon)
         OR (p_antet ? 'inlocuieste_document_id' AND (p_antet ->> 'inlocuieste_document_id')::bigint IS DISTINCT FROM d.inlocuieste_document_id)
         OR (p_antet ? 'motiv_inlocuire' AND p_antet ->> 'motiv_inlocuire' IS DISTINCT FROM d.motiv_inlocuire) THEN
        RAISE EXCEPTION 'izo E3: proiectul / depozitul / șablonul / înlocuirea nu se schimbă după creare (document nou)' USING ERRCODE = '22023';
      END IF;
      UPDATE public.izo_documente_intrare SET
        @@ANTET_SET@@,
        versiune = versiune + 1, updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
    END IF;
    -- înlocuirea (r5d §13.4 + r5e): ținta există, e anulată (finală), nu e documentul curent, iar utilizatorul e autorizat și pe
    -- proiectul / depozitul ȚINTEI (gestionar acolo sau owner); revalidată sub lock la fiecare salvare. Mesaj generic: nu
    -- dezvăluie dacă ținta există pe un proiect inaccesibil
    IF d.inlocuieste_document_id IS NOT NULL THEN
      SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
       WHERE t.id = d.inlocuieste_document_id AND t.stare = 'anulat' AND t.id <> d.id FOR SHARE;
      IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
        RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
      END IF;
    END IF;
    DELETE FROM public.izo_documente_intrare_randuri WHERE document_id = d.id;
    INSERT INTO public.izo_documente_intrare_randuri (document_id, @@RAND_COLS@@)
    SELECT d.id, @@RAND_VALS@@ FROM jsonb_array_elements(p_randuri) x;
    IF p_scanuri IS NOT NULL THEN
      DELETE FROM public.izo_documente_scanuri WHERE document_id = d.id;
      INSERT INTO public.izo_documente_scanuri (document_id, cale, sha256_original, sha256_pdf, marime, mime)
      SELECT d.id, x ->> 'cale', x ->> 'sha256_original', x ->> 'sha256_pdf', (x ->> 'marime')::bigint, x ->> 'mime' FROM jsonb_array_elements(p_scanuri) x;
      IF EXISTS (SELECT 1 FROM public.izo_documente_scanuri s WHERE s.document_id = d.id AND NOT public.fn_izo_scan_exista(s.cale)) THEN
        RAISE EXCEPTION 'izo E3: un scan din manifest nu există în Storage (încarcă-l întâi)' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'hash', public.fn_izo_doc_hash(d.id));
  END $f$;

  -- verificarea (doar citire): hash + versiune (cele pe care confirma le cere înapoi), blocante, avertismente
  CREATE FUNCTION public.fn_izo_doc_verifica(p_doc_id bigint) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_bloc jsonb;
  BEGIN
    PERFORM public.fn_izo_doc_api_verifica();
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id;
    IF NOT FOUND OR NOT public.fn_izo_citire(d.proiect_id) THEN
      RAISE EXCEPTION 'izo E3: documentul nu există sau nu ai acces la proiect' USING ERRCODE = '42501';
    END IF;
    v_bloc := CASE WHEN d.stare = 'draft' THEN public.fn_izo_doc_blocante(d.id) ELSE '[]'::jsonb END;
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'stare', d.stare, 'hash', public.fn_izo_doc_hash(d.id),
                              'ok', d.stare = 'draft' AND jsonb_array_length(v_bloc) = 0, 'blocante', v_bloc,
                              'avertismente', public.fn_izo_doc_avertismente(d.id));
  END $f$;

  -- anularea ciornei de către gestionar (r5d §13.3): doar antetul; registrul neatins
  CREATE FUNCTION public.fn_izo_doc_anuleaza_draft(p_doc_id bigint, p_versiune bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; d public.izo_documente_intrare; v_motiv text := btrim(p_motiv);
  BEGIN
    v_uid := public.fn_izo_doc_api_verifica();
    IF v_motiv IS NULL OR char_length(v_motiv) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'izo E3: motivul anulării e obligatoriu (3–1000 de caractere)' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
      RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
    END IF;
    IF d.stare <> 'draft' THEN
      RAISE EXCEPTION 'izo E3: documentul e %; pe calea asta se anulează doar ciornele (un document confirmat se anulează administrativ)', d.stare
        USING ERRCODE = '42501';
    END IF;
    IF p_versiune IS DISTINCT FROM d.versiune THEN
      RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %)', d.versiune, p_versiune USING ERRCODE = '40001';
    END IF;
    UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = v_uid, anulat_de_rol = session_user, anulat_la = now(),
           anulat_motiv = v_motiv, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'stare', d.stare);
  END $f$;

  -- confirmarea (§7): §4 pașii 1–8, apoi DML-ul static, totul sau nimic
  CREATE FUNCTION public.fn_izo_doc_confirma(p_doc_id bigint, p_versiune bigint, p_hash text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_bloc jsonb; v_avert jsonb; v_ev bigint; v_id bigint; r record; v_n integer; v_m integer;
    v_bucati bigint[] := '{}'; v_tp bigint; v_td integer;
  BEGIN
    PERFORM public.fn_izo_doc_api_verifica();
    IF p_doc_id IS NULL OR p_versiune IS NULL OR p_hash IS NULL THEN
      RAISE EXCEPTION 'izo E3: documentul, versiunea și hash-ul (din verificare) sunt obligatorii' USING ERRCODE = '22023';
    END IF;
    -- 1. documentul
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    -- 2. autorizarea, sub lock
    IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
      RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
    END IF;
    IF d.stare = 'confirmat' THEN
      IF d.hash_confirmat = p_hash THEN   -- retry după un răspuns pierdut: același conținut, fără scrieri
        RETURN jsonb_build_object('document_id', d.id, 'eveniment_id', d.eveniment_intrare_id,
          'bucati', (SELECT coalesce(jsonb_agg(x.bucata_id ORDER BY x.nr_crt), '[]'::jsonb) FROM public.izo_documente_intrare_randuri x
                      WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL),
          'avertismente', coalesce(d.avertismente, '[]'::jsonb), 'versiune', d.versiune, 'idempotent', true);
      END IF;
      RAISE EXCEPTION 'izo E3: documentul e deja confirmat cu alt conținut' USING ERRCODE = '23505';
    END IF;
    IF d.stare <> 'draft' THEN RAISE EXCEPTION 'izo E3: documentul e %', d.stare USING ERRCODE = '42501'; END IF;
    -- 3–4. locurile, tabelele, advisory-ul partajat pe proiect (r5f, #825 NO-GO: semnătura explicită VARIADIC bigint[] = cea din
    -- GRANT; un overload scalar fn_izo_lock_partajat(bigint) nu mai poate umbri apelul)
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(VARIADIC ARRAY[d.proiect_id]);
    -- 6. revalidarea pe starea comisă
    IF d.versiune <> p_versiune OR public.fn_izo_doc_hash(d.id) IS DISTINCT FROM p_hash THEN
      RAISE EXCEPTION 'izo E3: documentul s-a schimbat de la verificare (versiunea %, trimisă %) — verifică din nou', d.versiune, p_versiune
        USING ERRCODE = '40001';
    END IF;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') THEN
      RAISE EXCEPTION 'izo E3: proiectul nu are registrul de țeavă activ' USING ERRCODE = '42501';
    END IF;
    IF d.depozit_id IS NULL OR NOT public.fn_izo_loc_valid(d.proiect_id, d.depozit_id, NULL) THEN
      RAISE EXCEPTION 'izo E3: depozitul nu e activ sau nu e pe site-ul proiectului' USING ERRCODE = '23514';
    END IF;
    IF d.inlocuieste_document_id IS NOT NULL THEN
      SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
       WHERE t.id = d.inlocuieste_document_id AND t.stare = 'anulat' AND t.id <> d.id FOR SHARE;
      IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
        RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
      END IF;
    END IF;
    -- 7. blocantele (recalculate: totaluri, motive, valori, serii, coliziuni, scanuri) și avertismentele
    v_bloc := public.fn_izo_doc_blocante(d.id);
    IF jsonb_array_length(v_bloc) > 0 THEN
      RAISE EXCEPTION 'izo E3: documentul are blocante: %', v_bloc USING ERRCODE = '23514';
    END IF;
    v_avert := public.fn_izo_doc_avertismente(d.id);
    -- 8. marcajul (contextul operației), apoi doar DML static
    PERFORM public.fn_izo_receptie_marcheaza('confirma', d.id, d.proiect_id, d.depozit_id, d.versiune, p_hash);
    BEGIN
      INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, motiv, aplicat_de, server_ver)
      VALUES (CASE d.sablon WHEN 'aviz_teava' THEN 'intrare_aviz' ELSE 'intrare_lista_ambalare' END, d.proiect_id, 'doc_intrare',
              d.id::text, p_hash, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
      RETURNING id INTO v_ev;
      FOR r IN SELECT x.id, x.nr_crt FROM public.izo_documente_intrare_randuri x
                WHERE x.document_id = d.id AND x.decizie IN ('primit', 'primit_neconform') ORDER BY x.nr_crt LOOP
        v_id := nextval('public.magazie_bucati_id_seq');
        INSERT INTO public.magazie_bucati /*C*/ (@@INSERT_COLS@@)
        SELECT @@INSERT_VALS@@
          FROM jsonb_populate_record(NULL::public.magazie_bucati, public.fn_izo_doc_bucata_asteptata(d.id, r.nr_crt)) x;
        INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_dupa, in_loc, lungime_mm, server_ver)
        SELECT v_ev, d.proiect_id, b.id, 'nascut', b.stare, jsonb_build_object('tip', 'depozit', 'depozit_id', d.depozit_id), b.lungime_mm,
               nextval('public.izo_server_ver_seq')
          FROM public.magazie_bucati b WHERE b.id = v_id;
        UPDATE public.izo_documente_intrare_randuri SET bucata_id = v_id WHERE id = r.id;
        v_bucati := v_bucati || v_id;
      END LOOP;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'izo E3: o serie din document a fost înregistrată între timp de alt document (sau există deja în registru): %', SQLERRM
        USING ERRCODE = '23505';
    END;
    -- reconcilierea, înainte de RETURN
    SELECT count(*) INTO v_n FROM public.magazie_bucati_miscari WHERE eveniment_id = v_ev AND rol = 'nascut';
    SELECT count(*) INTO v_m FROM public.izo_documente_intrare_randuri WHERE document_id = d.id AND decizie IN ('primit', 'primit_neconform');
    -- r5f (#825 NO-GO): și pe cantități — suma cantităților primite (goală = 1) = bucățile născute
    IF v_n <> v_m OR cardinality(v_bucati) <> v_m
       OR (SELECT coalesce(sum(coalesce(cantitate, 1)), 0) FROM public.izo_documente_intrare_randuri
            WHERE document_id = d.id AND decizie IN ('primit', 'primit_neconform')) <> v_m
       OR (SELECT count(*) FROM public.izo_documente_intrare_randuri WHERE document_id = d.id AND bucata_id IS NOT NULL) <> v_m THEN
      RAISE EXCEPTION 'izo E3: reconcilierea confirmării a eșuat (mișcări %, rânduri primite %)', v_n, v_m;
    END IF;
    UPDATE public.izo_documente_intrare SET stare = 'confirmat', hash_confirmat = p_hash, avertismente = v_avert,
           confirmat_de = public.fn_izo_uid(), confirmat_la = now(), eveniment_intrare_id = v_ev, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'eveniment_id', v_ev, 'bucati', to_jsonb(v_bucati), 'avertismente', v_avert,
                              'versiune', d.versiune, 'idempotent', false);
  END $f$;

  -- PV-ul (§8): mulțimea așteptată = TOATE rândurile primit; fiecare bucată verificată, fără filtrare prealabilă
  CREATE FUNCTION public.fn_izo_doc_pv(p_doc_id bigint, p_versiune bigint, p_pv_nr text, p_pv_data date) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_canon text; v_ev bigint; v_set bigint[]; v_upd bigint[]; v_err jsonb; v_tip text;
  BEGIN
    PERFORM public.fn_izo_doc_api_verifica();
    IF p_doc_id IS NULL OR p_versiune IS NULL OR p_pv_data IS NULL OR p_pv_nr IS NULL OR char_length(btrim(p_pv_nr)) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'izo E3: documentul, versiunea, numărul și data PV-ului sunt obligatorii' USING ERRCODE = '22023';
    END IF;
    v_canon := upper(regexp_replace(btrim(p_pv_nr), '[[:space:]]+', ' ', 'g'));
    IF position('|' IN v_canon) > 0 THEN RAISE EXCEPTION 'izo E3: numărul PV-ului nu poate conține „|”' USING ERRCODE = '22023'; END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
      RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
    END IF;
    IF d.stare <> 'confirmat' THEN RAISE EXCEPTION 'izo E3: PV-ul se pune doar pe un document confirmat (e %)', d.stare USING ERRCODE = '42501'; END IF;
    IF d.eveniment_pv_id IS NOT NULL THEN
      IF d.pv_nr_canon = v_canon AND d.pv_data = p_pv_data THEN
        RETURN jsonb_build_object('document_id', d.id, 'eveniment_pv_id', d.eveniment_pv_id,
          'bucati_receptionate', (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id = d.eveniment_pv_id),
          'avertismente', '[]'::jsonb, 'versiune', d.versiune, 'idempotent', true);
      END IF;
      RAISE EXCEPTION 'izo E3: documentul are deja PV-ul % / %', d.pv_nr, d.pv_data USING ERRCODE = '23505';
    END IF;
    IF d.versiune <> p_versiune THEN
      RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %)', d.versiune, p_versiune USING ERRCODE = '40001';
    END IF;
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(VARIADIC ARRAY[d.proiect_id]);   -- r5f (#825 NO-GO): semnătura din GRANT, explicit
    PERFORM 1 FROM public.magazie_bucati b
      WHERE b.id IN (SELECT x.bucata_id FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL)
      ORDER BY b.id FOR UPDATE;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') OR NOT public.fn_izo_loc_valid(d.proiect_id, d.depozit_id, NULL) THEN
      RAISE EXCEPTION 'izo E3: registrul nu e activ pe proiect sau depozitul nu mai e valid' USING ERRCODE = '42501';
    END IF;
    v_tip := CASE d.sablon WHEN 'aviz_teava' THEN 'teava' ELSE 'curba' END;
    SELECT coalesce(jsonb_agg(jsonb_build_object('nr_crt', x.nr_crt, 'bucata_id', x.bucata_id, 'motiv',
             CASE WHEN x.bucata_id IS NULL THEN 'rândul n-are bucată — document corupt'
                  WHEN b.id IS NULL THEN 'bucata nu mai există'
                  WHEN b.aviz_intrare_id IS DISTINCT FROM d.id OR b.nr_crt_aviz IS DISTINCT FROM x.nr_crt OR b.proiect_id IS DISTINCT FROM d.proiect_id
                       OR b.tip_cod IS DISTINCT FROM v_tip THEN 'bucata nu mai aparține rândului / documentului'
                  WHEN b.stare <> 'sosit' THEN 'starea e ' || b.stare
                  ELSE 'nu mai e în depozitul documentului' END) ORDER BY x.nr_crt), '[]'::jsonb)
      INTO v_err
      FROM public.izo_documente_intrare_randuri x LEFT JOIN public.magazie_bucati b ON b.id = x.bucata_id
     WHERE x.document_id = d.id AND x.decizie = 'primit'
       AND (x.bucata_id IS NULL OR b.id IS NULL OR b.aviz_intrare_id IS DISTINCT FROM d.id OR b.nr_crt_aviz IS DISTINCT FROM x.nr_crt
            OR b.proiect_id IS DISTINCT FROM d.proiect_id OR b.tip_cod IS DISTINCT FROM v_tip OR b.stare <> 'sosit'
            OR b.depozit_id IS DISTINCT FROM d.depozit_id OR b.tronson_id IS NOT NULL);
    IF jsonb_array_length(v_err) > 0 THEN
      RAISE EXCEPTION 'izo E3: bucăți ieșite / modificate înainte de PV — decizie: %', v_err USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(array_agg(x.bucata_id ORDER BY x.bucata_id), '{}') INTO v_set
      FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.decizie = 'primit';
    PERFORM public.fn_izo_receptie_marcheaza('pv', d.id, d.proiect_id, d.depozit_id, d.versiune, v_canon || '|' || p_pv_data::text);
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, motiv, aplicat_de, server_ver)
    VALUES ('receptie_pv', d.proiect_id, 'doc_intrare', d.id::text, 'PV ' || v_canon || ' / ' || p_pv_data::text, public.fn_izo_uid(),
            nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;
    WITH u AS (UPDATE public.magazie_bucati SET stare = 'receptionat', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
                WHERE id = ANY (v_set) AND stare = 'sosit' RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_upd FROM u;
    IF v_upd IS DISTINCT FROM v_set THEN RAISE EXCEPTION 'izo E3: reconcilierea PV-ului a eșuat (% față de %)', cardinality(v_upd), cardinality(v_set); END IF;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_ev, d.proiect_id, x, 'stare', 'sosit', 'receptionat', nextval('public.izo_server_ver_seq') FROM unnest(v_upd) x;
    UPDATE public.izo_documente_intrare SET pv_nr = btrim(p_pv_nr), pv_nr_canon = v_canon, pv_data = p_pv_data, pv_pus_de = public.fn_izo_uid(),
           pv_pus_la = now(), eveniment_pv_id = v_ev, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'eveniment_pv_id', v_ev, 'bucati_receptionate', cardinality(v_upd),
      'avertismente', CASE WHEN cardinality(v_upd) = 0
                           THEN jsonb_build_array(jsonb_build_object('nr_crt', NULL, 'cod', 'pv_fara_bucati', 'mesaj', 'niciun rând primit conform'))
                           ELSE '[]'::jsonb END,
      'versiune', d.versiune, 'idempotent', false);
  END $f$;

  -- anularea administrativă (§9.1; doar postgres): ciorna → doar antetul; confirmatul → storno PV, apoi storno intrare
  CREATE FUNCTION public.fn_izo_doc_anuleaza(p_doc_id bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_motiv text := btrim(p_motiv); v_lipsa text[]; v_toate bigint[]; v_pv bigint[];
    v_st_pv bigint; v_st_i bigint; v_n integer;
  BEGIN
    IF session_user IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'izo E3: anularea administrativă se cheamă doar dintr-o sesiune postgres directă (session_user = %)', session_user
        USING ERRCODE = '42501';
    END IF;
    -- r5f (#825 NO-GO): READ COMMITTED impus, ca în E2a (fn_izo_lock_partajat / garda pe bucăți), înaintea oricărui lock — și pe
    -- ramura ciornei, care nu trece prin fn_izo_lock_proiect; poarta de după lock-ul „schemă” cere snapshot nou
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'izo E3: intrările E3 cer READ COMMITTED (acum %)', current_setting('transaction_isolation') USING ERRCODE = '25001';
    END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF coalesce(current_setting('izo.receptie_ctx', true), '') <> '' THEN
      RAISE EXCEPTION 'izo E3: o altă operație E3 rulează deja în această tranzacție' USING ERRCODE = '42501';
    END IF;
    v_lipsa := public.fn_izo_porti_lipsa();
    IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'izo E3: porțile registrului nu sunt complete: %', v_lipsa USING ERRCODE = '42501'; END IF;
    IF v_motiv IS NULL OR char_length(v_motiv) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'izo E3: motivul anulării e obligatoriu (3–1000 de caractere)' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF d.stare = 'anulat' THEN RAISE EXCEPTION 'izo E3: documentul e deja anulat' USING ERRCODE = '23505'; END IF;
    IF d.stare = 'draft' THEN
      PERFORM public.fn_izo_receptie_marcheaza('anulare_draft', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
      UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
             anulat_motiv = v_motiv, versiune = versiune + 1, updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
      RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', false, 'versiune', d.versiune);
    END IF;
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_proiect(d.proiect_id, true);
    SELECT coalesce(array_agg(x.bucata_id ORDER BY x.bucata_id), '{}') INTO v_toate
      FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL;
    PERFORM 1 FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id FOR UPDATE;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') THEN
      RAISE EXCEPTION 'izo E3: proiectul e off — anularea unui document confirmat cere întâi reactivarea' USING ERRCODE = '42501';
    END IF;
    -- fail-closed: nicio mișcare în afară de nașterea din intrare și PV-ul documentului
    SELECT count(*) INTO v_n FROM public.magazie_bucati_miscari m
     WHERE m.bucata_id = ANY (v_toate) AND m.eveniment_id <> d.eveniment_intrare_id AND m.eveniment_id IS DISTINCT FROM d.eveniment_pv_id;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'izo E3: anulare refuzată — % mișcări ulterioare pe bucățile documentului (stornează întâi lanțul, explicit)', v_n
        USING ERRCODE = '23514';
    END IF;
    PERFORM public.fn_izo_receptie_marcheaza('anulare', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
    IF d.eveniment_pv_id IS NOT NULL THEN
      INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
      VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_pv_id, v_motiv, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
      RETURNING id INTO v_st_pv;
      SELECT coalesce(array_agg(m.bucata_id ORDER BY m.bucata_id), '{}') INTO v_pv FROM public.magazie_bucati_miscari m WHERE m.eveniment_id = d.eveniment_pv_id;
      INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
      SELECT v_st_pv, d.proiect_id, x, 'stare', 'receptionat', 'sosit', nextval('public.izo_server_ver_seq') FROM unnest(v_pv) x;
      UPDATE public.magazie_bucati SET stare = 'sosit', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
       WHERE id = ANY (v_pv) AND stare = 'receptionat';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> cardinality(v_pv) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului PV a eșuat'; END IF;
    END IF;
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
    VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_intrare_id, v_motiv, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_st_i;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_st_i, d.proiect_id, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id;
    UPDATE public.magazie_bucati SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now() WHERE id = ANY (v_toate);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_toate) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului intrării a eșuat'; END IF;
    UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
           anulat_motiv = v_motiv, eveniment_storno_intrare_id = v_st_i, eveniment_storno_pv_id = v_st_pv, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', true, 'storno_intrare_id', v_st_i, 'storno_pv_id', v_st_pv,
                              'bucati_anulate', cardinality(v_toate), 'versiune', d.versiune);
  END $f$;
"""

DOC_TAB = "public.izo_documente_intrare, public.izo_documente_intrare_randuri, public.izo_documente_scanuri"
FUNC_INTERNE = ["fn_izo_coloane_c()", "fn_izo_coloane_ev()", "fn_izo_coloane_mis()", "fn_izo_proiectie(jsonb, text[])", "fn_izo_jwt_rol()",
                "fn_izo_canon_serie(text)", "fn_izo_doc_autorizare_lock(bigint, integer)", "fn_izo_scan_exista(text)",
                "fn_izo_scan_poate_incarca(text)", "fn_izo_scan_poate_citi(text)", "fn_izo_scan_poate_sterge(text)", "fn_izo_doc_hash(bigint)",
                "fn_izo_doc_blocante(bigint)", "fn_izo_doc_avertismente(bigint)", "fn_izo_doc_bucata_asteptata(bigint, integer)",
                "fn_izo_eveniment_asteptat(text, bigint, bigint, text)",
                "fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer)",
                "fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text)", "fn_izo_garda_receptie(text, text, jsonb, jsonb)",
                "fn_izo_doc_garda()", "fn_izo_porti_e3_definitii()", "fn_izo_porti_e3_lipsa()", "fn_izo_doc_api_verifica()",
                "fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb)", "fn_izo_doc_verifica(bigint)",
                "fn_izo_doc_anuleaza_draft(bigint, bigint, text)", "fn_izo_doc_confirma(bigint, bigint, text)",
                "fn_izo_doc_pv(bigint, bigint, text, date)", "fn_izo_doc_anuleaza(bigint, text)"]
pf = lambda xs: ", ".join("public." + x for x in xs)
DREPTURI = """  -- tabelele documentelor: API doar SELECT (filtrat de RLS); scriu doar rolurile E3, pe coloanele operațiilor (§3.5)
  REVOKE ALL ON TABLE %(T)s FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON TABLE %(T)s TO authenticated, izo_doc_editor, izo_receptie_writer;
  GRANT INSERT (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, %(AC)s) ON public.izo_documente_intrare TO izo_doc_editor;
  GRANT UPDATE (%(AC)s, versiune, updated_at, stare, anulat_de, anulat_de_rol, anulat_la, anulat_motiv) ON public.izo_documente_intrare TO izo_doc_editor;
  GRANT UPDATE (stare, versiune, updated_at, hash_confirmat, avertismente, confirmat_de, confirmat_la, eveniment_intrare_id, pv_nr, pv_nr_canon,
                pv_data, pv_pus_de, pv_pus_la, eveniment_pv_id, anulat_de, anulat_de_rol, anulat_la, anulat_motiv, eveniment_storno_intrare_id,
                eveniment_storno_pv_id) ON public.izo_documente_intrare TO izo_receptie_writer;
  GRANT INSERT (document_id, %(RC)s), DELETE ON public.izo_documente_intrare_randuri TO izo_doc_editor;
  GRANT UPDATE (bucata_id) ON public.izo_documente_intrare_randuri TO izo_receptie_writer;
  GRANT INSERT (document_id, cale, sha256_original, sha256_pdf, marime, mime), DELETE ON public.izo_documente_scanuri TO izo_doc_editor;
  ALTER TABLE public.izo_documente_intrare ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_documente_intrare_randuri ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_documente_scanuri ENABLE ROW LEVEL SECURITY;
  CREATE POLICY izo_doc_api_sel ON public.izo_documente_intrare FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_doc_rand_api_sel ON public.izo_documente_intrare_randuri FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id = document_id));
  CREATE POLICY izo_doc_scan_api_sel ON public.izo_documente_scanuri FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id = document_id));
  -- rolurile E3: acces pe rând larg; restricția reală e în trigger-ul documentelor + gardă (§3.5)
  CREATE POLICY izo_doc_editor_sel ON public.izo_documente_intrare FOR SELECT TO izo_doc_editor USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_editor_ins ON public.izo_documente_intrare FOR INSERT TO izo_doc_editor WITH CHECK (stare = 'draft');
  CREATE POLICY izo_doc_editor_upd ON public.izo_documente_intrare FOR UPDATE TO izo_doc_editor
    USING (proiect_id IS NOT NULL) WITH CHECK (stare IN ('draft', 'anulat'));
  CREATE POLICY izo_doc_writer_sel ON public.izo_documente_intrare FOR SELECT TO izo_receptie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_writer_upd ON public.izo_documente_intrare FOR UPDATE TO izo_receptie_writer
    USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_editor_sel ON public.izo_documente_intrare_randuri FOR SELECT TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_editor_ins ON public.izo_documente_intrare_randuri FOR INSERT TO izo_doc_editor WITH CHECK (bucata_id IS NULL);
  CREATE POLICY izo_doc_rand_editor_del ON public.izo_documente_intrare_randuri FOR DELETE TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_writer_sel ON public.izo_documente_intrare_randuri FOR SELECT TO izo_receptie_writer USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_writer_upd ON public.izo_documente_intrare_randuri FOR UPDATE TO izo_receptie_writer
    USING (document_id IS NOT NULL) WITH CHECK (bucata_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_editor_sel ON public.izo_documente_scanuri FOR SELECT TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_editor_ins ON public.izo_documente_scanuri FOR INSERT TO izo_doc_editor WITH CHECK (document_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_editor_del ON public.izo_documente_scanuri FOR DELETE TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_writer_sel ON public.izo_documente_scanuri FOR SELECT TO izo_receptie_writer USING (document_id IS NOT NULL);
  -- registrul, pentru rolurile E3 (politici permisive noi; cele RESTRICTIVE E2a pentru anon / authenticated rămân)
  GRANT SELECT ON TABLE public.magazie_bucati TO izo_doc_editor, izo_receptie_writer;
  GRANT INSERT (%(CC)s) ON public.magazie_bucati TO izo_receptie_writer;
  GRANT UPDATE (stare, server_ver, updated_at) ON public.magazie_bucati TO izo_receptie_writer;
  GRANT SELECT, INSERT ON TABLE public.magazie_bucati_evenimente, public.magazie_bucati_miscari TO izo_receptie_writer;
  GRANT USAGE ON SEQUENCE public.magazie_bucati_id_seq, public.izo_server_ver_seq, public.magazie_bucati_evenimente_id_seq,
    public.magazie_bucati_miscari_id_seq TO izo_receptie_writer;
  CREATE POLICY magbuc_izo_doceditor_sel ON public.magazie_bucati FOR SELECT TO izo_doc_editor USING (provenienta = 'beneficiar' AND tip_cod IS NOT NULL);
  CREATE POLICY magbuc_izo_receptie_sel ON public.magazie_bucati FOR SELECT TO izo_receptie_writer USING (provenienta = 'beneficiar');
  CREATE POLICY magbuc_izo_receptie_ins ON public.magazie_bucati FOR INSERT TO izo_receptie_writer
    WITH CHECK (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  CREATE POLICY magbuc_izo_receptie_upd ON public.magazie_bucati FOR UPDATE TO izo_receptie_writer
    USING (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'))
    WITH CHECK (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  CREATE POLICY izo_ev_receptie_sel ON public.magazie_bucati_evenimente FOR SELECT TO izo_receptie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_ev_receptie_ins ON public.magazie_bucati_evenimente FOR INSERT TO izo_receptie_writer
    WITH CHECK (coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  CREATE POLICY izo_mis_receptie_sel ON public.magazie_bucati_miscari FOR SELECT TO izo_receptie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_mis_receptie_ins ON public.magazie_bucati_miscari FOR INSERT TO izo_receptie_writer
    WITH CHECK (coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  -- funcțiile: nimic implicit (default privileges ar da EXECUTE la anon / authenticated / service_role)
  REVOKE ALL ON FUNCTION %(FI)s FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_c(), public.fn_izo_coloane_ev(), public.fn_izo_coloane_mis(), public.fn_izo_proiectie(jsonb, text[]),
    public.fn_izo_jwt_rol(), public.fn_izo_canon_serie(text), public.fn_izo_doc_autorizare_lock(bigint, integer), public.fn_izo_scan_exista(text),
    public.fn_izo_doc_hash(bigint), public.fn_izo_doc_blocante(bigint), public.fn_izo_doc_avertismente(bigint), public.fn_izo_doc_api_verifica()
    TO izo_doc_editor, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_bucata_asteptata(bigint, integer), public.fn_izo_eveniment_asteptat(text, bigint, bigint, text),
    public.fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer), public.fn_izo_garda_receptie(text, text, jsonb, jsonb)
    TO izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text) TO authenticated;
  -- funcțiile E2a chemate de rolurile E3 (matricea §3.5, apelurile tranzitive)
  GRANT EXECUTE ON FUNCTION public.fn_izo_nivel(bigint), public.fn_izo_uid(), public.fn_izo_porti_lipsa(), public.fn_izo_loc_valid(bigint, integer, bigint),
    public.fn_izo_citire(bigint) TO izo_doc_editor, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]), public.fn_izo_blocheaza_tabele(), public.fn_izo_lock_partajat(bigint[]),
    public.fn_izo_lock_proiect(bigint, boolean), public.fn_izo_porti_definitii(), public.fn_izo_garda_scriitor(), public.fn_izo_tip_cod(integer),
    public.fn_izo_site_proiect(bigint), public.fn_izo_tip_material(text) TO izo_receptie_writer;""" % {
    'T': DOC_TAB, 'AC': ANTET_COLS, 'RC': RAND_COLS, 'CC': ", ".join(['id', 'uid', 'radacina_id', 'server_ver'] + C), 'FI': pf(FUNC_INTERNE)}

OWNERI = """  ALTER FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_confirma(bigint, bigint, text) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_pv(bigint, bigint, text, date) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_anuleaza(bigint, text) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb) OWNER TO izo_doc_editor;
  ALTER FUNCTION public.fn_izo_doc_verifica(bigint) OWNER TO izo_doc_editor;
  ALTER FUNCTION public.fn_izo_doc_anuleaza_draft(bigint, bigint, text) OWNER TO izo_doc_editor;
  REVOKE CREATE ON SCHEMA public FROM izo_doc_editor, izo_receptie_writer;
  -- ALTER OWNER mută ACL-ul pe owner-ul nou; GRANT-urile le dă owner-ul (postgres nu e superuser pe Supabase)
  SET LOCAL ROLE izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text), public.fn_izo_doc_confirma(bigint, bigint, text),
    public.fn_izo_doc_pv(bigint, bigint, text, date), public.fn_izo_doc_anuleaza(bigint, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_confirma(bigint, bigint, text), public.fn_izo_doc_pv(bigint, bigint, text, date) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text) TO postgres;
  RESET ROLE;
  SET LOCAL ROLE izo_doc_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint),
    public.fn_izo_doc_anuleaza_draft(bigint, bigint, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint),
    public.fn_izo_doc_anuleaza_draft(bigint, bigint, text) TO authenticated;
  RESET ROLE;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Livrare 20261103b: rolul nu a revenit la postgres după GRANT'; END IF;"""

# ── gărzile E2a → varianta cu v_aut ──
GB = bloc_functie('fn_izo_garda_bucati() RETURNS trigger')
GF = bloc_functie('fn_izo_garda_fapte() RETURNS trigger')
V_AUT = """    -- E3 (20261103b): predicatul de autorizare, calculat o singură dată — scriitorul E2a cu marcaj SAU scriitorul E3 în
    -- contextul operației (true sau excepție); fără RETURN timpuriu: verificările E2a de mai jos se aplică tuturor
    v_aut := public.fn_izo_garda_scriitor();
    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
      v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
                                            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
"""
gb = GB.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
assert gb.count('    v_p bigint;\n') == 1
gb = gb.replace('    v_p bigint;\n', '    v_p bigint;\n    v_aut boolean;\n')
k = gb.index('  BEGIN\n') + len('  BEGIN\n')
gb = gb[:k] + V_AUT + gb[k:]
assert gb.count('public.fn_izo_garda_scriitor() IS NOT TRUE') == 2
gb = gb.replace('public.fn_izo_garda_scriitor() IS NOT TRUE', 'v_aut IS NOT TRUE')
gf = GF.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
assert gf.count('  BEGIN\n') == 1
gf = gf.replace('  BEGIN\n', '  DECLARE v_aut boolean;\n  BEGIN\n')
old = "    IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN\n"
assert gf.count(old) == 1
gf = gf.replace(old, V_AUT.replace("CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END", "to_jsonb(NEW)") + "    IF v_aut IS NOT TRUE THEN\n")

# ── poarta E2a → închiderea rapidă + poarta E3 ──
PL = bloc_functie('fn_izo_porti_lipsa() RETURNS text[]')
pl = PL.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
a = pl.index("      c_scheme_platforma constant text[] := ARRAY['auth'")
a = pl.index("    BEGIN\n", a)
b = pl.index("      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;\n")
b = b + len("      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;\n")
SEED_FN = pl[pl.index("      -- funcțiile cu SQL dinamic (orice EXECUTE)", a):pl.index("      -- r15 (Jakarinos + Copilot r14): funcțiile „mutator”", a)]
# r5f (#825): sămânța E3 = cele 6 tabele E2a + tabelele documentelor, ca instrucțiune SEPARATĂ (un singur loc): testul
# diferențial o scoate din copia de test (teste.inchidere_noua = aceeași sămânță ca E2a, deci echivalența rămâne dovedită),
# iar teste.inchidere_noua_e3 = textul exact din migrare
SAMANTA_E3 = r"""      -- r5f (#825): + tabelele documentelor E3 — RLS cu citire prin fn_izo_citire, ca registrul (design §13.2): un DEFINER /
      -- un view fără security_invoker / un lanț din afara fn_izo_* care ajunge la ele e refuzat la fel. Funcțiile E3 legitime
      -- (fn_izo_doc_* / fn_izo_scan_*, owner izo_doc_editor / izo_receptie_writer / postgres) sunt fn_izo_*: în afara
      -- închiderii, ca la E2a, și acoperite de ștampila E2a (fn_izo_porti_definitii: owner, corp, config, ACL)
      c_rel := c_rel || ARRAY(SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('izo_documente_intrare','izo_documente_intrare_randuri','izo_documente_scanuri'));
      -- r5g (#825) NO-GO P1-C: + TOATE funcțiile public.fn_izo_* ca ȚINTE (nu candidați): cititorii INVOKER ai documentelor
      -- (owner postgres) și DEFINER-ele interne citesc ce RLS-ul ascunde; un DEFINER / view / lanț din afara fn_izo_* care le
      -- cheamă (după nume, BEGIN ATOMIC, view, operator / cast / agregat) intră în închidere, ca un cititor direct. După
      -- propagare ele ies din c_fn (mai jos): sunt API-ul revizuit, sub ștampila E2a. Invocările lor implicite din catalog
      -- (trigger / politică / DEFAULT / CHECK …) sunt fixate de ștampila E3 (fn_izo_porti_e3_definitii)
      c_fn := c_fn || ARRAY(SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%');
"""
RAPID = r"""      -- r5d (20261103b): aceeași semantică, evaluare SEMI-NAIVĂ — fiecare element nou al închiderii se caută o singură dată,
      -- cu alternanța numelor din frontieră (r5f: pe bucăți mărginite, nu o singură expresie); corpurile se citesc o dată
      k_oid oid[]; k_corp text[]; k_cale text[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
      -- r5f (#825 NO-GO): tiparele frontierei, pe bucăți: a_x = alternanța (≤ ~4000 de caractere), a_s = schema de platformă
      -- căreia i se aplică (NULL = oricărei funcții)
      a_s text[]; a_x text[];
      k_i int; k_n int; k_s text; k_s2 text; k_adanc oid[] := '{}';
      -- r5g (#825) NO-GO P2: o schemă a platformei urmată (după ghilimele / spații / un punct opțional) de deschiderea unui
      -- comentariu — singura formă în care un comentariu rupe apelul ei calificat
      k_com text := c_st || '(' || array_to_string(c_scheme_platforma, '|') || ')"?[[:space:]]*(\.[[:space:]]*)?(/\*|--)';
      -- r5g (#825) NO-GO P1-D: invocările implicite revizuite, de pe prod (citite 22.10.2026: singurele obiecte din catalog care cheamă
      -- funcții din închiderea de pe prod). Amprenta = md5(tip | identitate | funcția | owner | SECURITY DEFINER | proconfig):
      -- obiectul și ce cheamă, cu drepturile funcției; corpul NU (funcția de platformă e deja tratată ca cititor oarecare —
      -- e în închidere — iar corpul ei se schimbă la upgrade-urile Supabase). Altă funcție / alt owner / DEFINER → refuz
      c_implicite_revizuite constant text[] := ARRAY[
        'event trigger issue_pg_graphql_access=@@AMPR_GRAPHQL@@',
        'event trigger issue_pg_net_access=@@AMPR_NET@@',
        'trigger tr_check_filters on realtime.subscription=@@AMPR_REALTIME@@'];
    BEGIN
      SELECT array_agg(c.oid) INTO c_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
@@SEED_FN@@@@SAMANTA_E3@@      -- corpurile candidate (orice schemă non-sistem, în afara public.fn_izo_*), o singură dată; calea fixată în proconfig
      -- (NULL = necunoscută: funcția moștenește calea apelantului)
      SELECT coalesce(array_agg(p.oid ORDER BY p.oid), '{}'),
             coalesce(array_agg(p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') ORDER BY p.oid), '{}'),
             coalesce(array_agg((SELECT array_to_string(string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ','), ',')
                                   FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) ORDER BY p.oid), '{}')
        INTO k_oid, k_corp, k_cale
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%');
      -- r5f (#825 NO-GO): un comentariu între schemă și nume („storage/**/.f()”, „storage -- x⏎.f()”) ascunde forma calificată —
      -- contează la schemele platformei, unde necalificatul cere calea. Corpului i se adaugă o copie fără comentarii (blocurile
      -- imbricate din interior spre exterior, până la punct fix; apoi „--” până la capăt de rând). Copia doar ADAUGĂ potriviri
      -- (originalul rămâne): un „/*” sau „--” dintr-un șir taie din copie, nu din original. Cel mult 20 de niveluri (fiecare nivel
      -- = o trecere peste tot corpul — fără plafon, mii de comentarii imbricate ar ține poarta minute întregi): mai adânc → corpul
      -- nu se poate citi sigur, intră în sămânță ca SQL-ul dinamic (k_adanc, mai jos)
      -- r5g (#825, Copilot P1): copia nu înțelege literalii — un „--” / „/*” dintr-un șir taie din copie chiar apelul ascuns
      -- de comentariu („x := '--'; PERFORM storage /* c */ . f();”), iar originalul nu-l are calificat. Fail-closed, fără
      -- tokenizer: calea devine NECUNOSCUTĂ (NULL, în ambele bucle) și numele schemei se potrivesc în corp necalificat.
      -- r5g (#825) NO-GO P2: nu la orice „/*” / „--” (pe prod: 192 de corpuri, 162 DEFINER — un comentariu + „CAST(” /
      -- „send” / „search” ar fi înroșit poarta), ci doar când o schemă a platformei e urmată de deschiderea unui comentariu
      -- (k_com), pe ORIGINAL: comentariul care rupe apelul apare textual acolo, deci un literal nu-l poate ascunde; pe prod: 0
      -- corpuri. La celelalte scheme necalificatul se potrivește oricum, deci forma calificată ruptă nu ascunde nimic
      FOR k_i IN 1 .. cardinality(k_corp) LOOP
        IF k_corp[k_i] ~* k_com THEN k_cale[k_i] := NULL; END IF;
        k_s := k_corp[k_i]; k_n := 0;
        LOOP
          k_s2 := regexp_replace(k_s, '/\*([^*/]|\*+[^*/]|/+[^*/])*\*+/', ' ', 'g');
          EXIT WHEN k_s2 = k_s;
          k_s := k_s2; k_n := k_n + 1;
          IF k_n >= 20 THEN k_adanc := k_adanc || k_oid[k_i]; EXIT; END IF;
        END LOOP;
        k_s := regexp_replace(k_s, '--[^\n]*', ' ', 'g');
        IF k_s <> k_corp[k_i] THEN k_corp[k_i] := k_corp[k_i] || ' ' || k_s; END IF;
      END LOOP;
      -- r5f (#825 NO-GO): în sămânță și funcțiile care pot citi un tabel FĂRĂ să-i scrie numele și fără EXECUTE — identificatori
      -- U&"…" (escape-uri Unicode), SQL dat ca text (query/table/schema/database_to_xml, ts_stat / ts_rewrite, crosstab /
      -- connectby, dblink), fișierele / paginile tabelelor (pg_read_[binary_]file, lo_import, get_raw_page); ca SQL-ul
      -- dinamic: un DEFINER care le conține (sau le cheamă) e refuzat. Mai strict decât E2a, care le lasă verzi. Tot aici:
      -- corpurile cu comentarii imbricate peste plafon (k_adanc)
      c_fn := c_fn || ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.oid <> ALL (c_fn)
                              AND (k.oid = ANY (k_adanc)
                                   OR k.corp ~* ('u&"|\m(query|table|schema|database)_to_xml|\mts_(stat|rewrite)\M|\m(crosstab|connectby|dblink)'
                                                 || '|\mpg_read_(binary_)?file\M|\mlo_import\M|\mget_raw_page\M')));
      -- mutatorii de cale (r15): sămânța = corp cu set_config / search_path; propagați până la punct fix
      SELECT coalesce(array_agg(k.oid), '{}') INTO c_mut FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.corp ~* '(set_config|search_path)';
      f_mut := c_mut; v_iter := 0;
      WHILE cardinality(f_mut) > 0 AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        -- r5f (#825 NO-GO): tiparele pe BUCĂȚI de ~4000 de caractere, nu o singură alternanță: cu ~1000 de nume lungi în
        -- frontieră, motorul de regex refuză („invalid memory alloc request size” / „regular expression is too complex”) —
        -- poarta ar da eroare unde E2a răspunde (testul „frontieră largă”), iar compilarea crește pătratic. Fiecare nume dă două
        -- alternative: calificat (s = NULL, oricui) și necalificat (s = NULL în afara platformei; s = schema platformei: doar
        -- dacă e în calea fixată a funcției sau calea e nefixată).
        -- r5f (#825 NO-GO, P1): și SCHEMA se escapează (nsx), ca numele: o schemă construită („x)(?=x)y(x”) ar închide grupul
        -- comun și ar face bucata (deci toate numele ei) imposibil de potrivit — verde fals; nsp (brut) rămâne doar pentru s
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nsx,
                          regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut)),
             y AS (SELECT NULL::text s, t.nsx || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume f FROM t
                   UNION ALL SELECT CASE WHEN t.nsp = ANY (c_scheme_platforma) THEN t.nsp END, t.nume FROM t)
        SELECT coalesce(array_agg(z.s), '{}'), coalesce(array_agg(c_st || '(' || z.alt || ')' || c_dr), '{}') INTO a_s, a_x
          FROM (SELECT y2.s, string_agg(y2.f, '|') alt
                  FROM (SELECT y.s, y.f, (sum(length(y.f) + 1) OVER (PARTITION BY y.s ORDER BY y.f ROWS UNBOUNDED PRECEDING) - 1) / 4000 b FROM y) y2
                 GROUP BY y2.s, y2.b) z;
        -- bucata în exterior (LATERAL … OFFSET 0: nu se aplatizează), corpurile în interior — fiecare tipar se compilează o dată;
        -- CASE fixează ordinea: întâi filtrele ieftine, regex-ul ultimul (planificatorul l-ar evalua primul)
        n_mut := ARRAY(SELECT DISTINCT m.oid FROM unnest(a_s, a_x) p(s, x)
                         CROSS JOIN LATERAL (SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale)
                                              WHERE CASE WHEN k.oid = ANY (c_mut) THEN false
                                                         WHEN p.s IS NULL OR k.cale IS NULL OR p.s = ANY (string_to_array(k.cale, ',')) THEN k.corp ~* p.x
                                                         ELSE false END OFFSET 0) m);
        c_mut := c_mut || n_mut; f_mut := n_mut;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'propagarea mutatorilor de cale nu converge (citire nerevizuită)'); END IF;
      -- închiderea: frontiera = elementele adăugate în iterația precedentă (view-urile noi intră în frontiera aceleiași iterații,
      -- ca în E2a, unde sunt adăugate înaintea funcțiilor)
      f_rel := c_rel; f_fn := c_fn; v_iter := 0;
      WHILE (cardinality(f_rel) > 0 OR cardinality(f_fn) > 0) AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        n_rel := ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                        WHERE d.classid = 'pg_rewrite'::regclass
                          AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                               OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))
                          AND rw.ev_class <> ALL (c_rel));
        c_rel := c_rel || n_rel; f_rel := f_rel || n_rel;
        -- r5f (#825 NO-GO): aceleași bucăți de tipare ca la mutatori, cu schema escapată (P1; vezi mai sus)
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nsx,
                          regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (f_rel)
                   UNION
                   SELECT n2.nspname::text, regexp_replace(n2.nspname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'),
                          regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_fn)),
             y AS (SELECT NULL::text s, t.nsx || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume f FROM t
                   UNION ALL SELECT CASE WHEN t.nsp = ANY (c_scheme_platforma) THEN t.nsp END, t.nume FROM t)
        SELECT coalesce(array_agg(z.s), '{}'), coalesce(array_agg(c_st || '(' || z.alt || ')' || c_dr), '{}') INTO a_s, a_x
          FROM (SELECT y2.s, string_agg(y2.f, '|') alt
                  FROM (SELECT y.s, y.f, (sum(length(y.f) + 1) OVER (PARTITION BY y.s ORDER BY y.f ROWS UNBOUNDED PRECEDING) - 1) / 4000 b FROM y) y2
                 GROUP BY y2.s, y2.b) z;
        -- schemele platformei: necalificat doar dacă schema e în calea funcției; calea e necunoscută dacă nu e fixată SAU dacă
        -- funcția e mutator (r15)
        n_fn := ARRAY(SELECT DISTINCT m.oid FROM unnest(a_s, a_x) p(s, x)
                        CROSS JOIN LATERAL (SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale)
                                             WHERE CASE WHEN k.oid = ANY (c_fn) THEN false
                                                        WHEN p.s IS NULL OR k.oid = ANY (c_mut) OR k.cale IS NULL OR p.s = ANY (string_to_array(k.cale, ','))
                                                          THEN k.corp ~* p.x
                                                        ELSE false END OFFSET 0) m);
        -- sau depind de ceva din frontieră în catalog (BEGIN ATOMIC)
        n_fn := n_fn || ARRAY(SELECT k.oid FROM unnest(k_oid) k(oid) WHERE k.oid <> ALL (c_fn) AND k.oid <> ALL (n_fn)
                                AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = k.oid
                                               AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                                                    OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))));
        c_fn := c_fn || n_fn;
        f_rel := n_rel; f_fn := n_fn;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
      -- r5f (#825 NO-GO, P1): un element al închiderii (sau mutator) al cărui nume nu se poate căuta sigur în corpuri → refuz:
      -- schemă cu caractere speciale de regex (E2a dă eroare pe ea, deci rămâne închisă — poarta nouă refuză la fel, nu dă
      -- verde) sau ghilimele în schemă / nume (în corp apar dublate, „"x""y"” — nicio expresie nu le găsește; în E2a: verde fals)
      IF EXISTS (SELECT 1 FROM (SELECT c.relname::text nume, c.relnamespace ns FROM pg_class c WHERE c.oid = ANY (c_rel)
                                UNION ALL SELECT q.proname::text, q.pronamespace FROM pg_proc q WHERE q.oid = ANY (c_fn || c_mut)) o
                  JOIN pg_namespace n2 ON n2.oid = o.ns
                 WHERE n2.nspname ~ '[.^$*+?()\[\]{}|\\"]' OR o.nume ~ '"') THEN
        v := array_append(v, 'un nume din închiderea citirilor nu se poate căuta sigur în corpuri (schemă cu caractere speciale de regex / nume cu ghilimele) (citire nerevizuită)');
      END IF;
      -- r5g (#825, Jak P1): invocarea IMPLICITĂ cheamă o funcție fără să-i scrie numele — operatorul (oprcode / oprrest /
      -- oprjoin: „OPERATOR(s.#!#) x”, infix / prefix), cast-ul (castfunc: „x::tip”), agregatul (aggtransfn / aggfinalfn /
      -- aggcombinefn / aggserialfn / aggdeserialfn / aggmtransfn / aggminvtransfn / aggmfinalfn; agregatul e prolang
      -- internal, deci nu e candidat și numele lui nu se caută); corpurile ne-ATOMIC n-au nici dependențe în catalog. Nu se
      -- propagă (forma infix nu se poate căuta sigur în corpuri): funcția-suport în închidere sau mutator de cale → refuz
      -- explicit, oricine ar folosi operatorul / cast-ul / agregatul (fals-pozitive acceptate). Pe prod: 0 (suportul din afara
      -- pg_catalog e doar C, în extensions — niciodată candidat). Celelalte obiecte din catalog: regula P1-D, mai jos
      FOR k_s IN SELECT x.d FROM (
          SELECT format('operator %s → %s', o.oid::regoperator, f.f::regprocedure) d
            FROM pg_operator o CROSS JOIN LATERAL unnest(ARRAY[o.oprcode::oid, o.oprrest::oid, o.oprjoin::oid]) f(f)
           WHERE f.f = ANY (c_fn || c_mut)
          UNION
          SELECT format('cast (%s AS %s) → %s', c.castsource::regtype, c.casttarget::regtype, c.castfunc::regprocedure)
            FROM pg_cast c WHERE c.castfunc = ANY (c_fn || c_mut)
          UNION
          SELECT format('agregat %s → %s', a.aggfnoid::regprocedure, f.f::regprocedure)
            FROM pg_aggregate a CROSS JOIN LATERAL unnest(ARRAY[a.aggtransfn::oid, a.aggfinalfn::oid, a.aggcombinefn::oid, a.aggserialfn::oid,
                                                                a.aggdeserialfn::oid, a.aggmtransfn::oid, a.aggminvtransfn::oid, a.aggmfinalfn::oid]) f(f)
           WHERE f.f = ANY (c_fn || c_mut)) x
        ORDER BY x.d COLLATE "C"
      LOOP
        v := array_append(v, 'invocare implicită neanalizată: ' || k_s || ' (funcție-suport din închiderea citirilor sau mutator de cale) (citire nerevizuită)');
      END LOOP;
      -- r5g (#825) NO-GO P1-C: țintele fn_izo_* ies din c_fn după propagare (API-ul revizuit, sub ștampila E2a; un DEFINER
      -- fn_izo_* nu e „DEFINER din afara registrului”). Fără sămânța E3 c_fn nu conține fn_izo_* (nici candidați, nici
      -- SQL dinamic), deci aici nu schimbă nimic
      c_fn := ARRAY(SELECT x.f FROM unnest(c_fn) x(f) JOIN pg_proc q ON q.oid = x.f
                     WHERE NOT (q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'));
      -- r5g (#825) NO-GO P1-D: invocarea implicită prin EXPRESII DIN CATALOG — CHECK pe domeniu / tabel, DEFAULT, coloană
      -- generată, expresie de index, trigger (și event trigger), politică, statistici, I/O de tip, clasă de operatori …: un
      -- DEFINER care scrie / convertește / sortează le pornește fără să numească funcția. Orice rând pg_depend spre o funcție
      -- din închidere al cărui obiect nu e propagat mai sus (view / regulă: pg_rewrite; funcție: pg_proc — candidații prin
      -- propagare, agregatele prin regula de deasupra; operator / cast: regula de deasupra) → refuz explicit, cu obiectul numit,
      -- în afara listei revizuite (c_implicite_revizuite). Doar c_fn, nu și mutatorii: pe prod cei 35 (orice set_config /
      -- search_path în corp) au 12 trigger-e și 2 funcții de event trigger — invocarea lor implicită rămâne întrebare deschisă
      FOR k_s IN SELECT x.d FROM (
          SELECT DISTINCT format('%s → %s', pg_describe_object(d.classid, d.objid, d.objsubid), d.refobjid::regprocedure) d
            FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid JOIN pg_namespace n2 ON n2.oid = q.pronamespace
                 CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) o
           WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (c_fn)
             AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass, 'pg_operator'::regclass, 'pg_cast'::regclass)
             AND format('%s %s=%s', o.type, o.identity,
                        md5(concat_ws('|', o.type, o.identity, format('%I.%I(%s)', n2.nspname, q.proname, pg_get_function_identity_arguments(q.oid)),
                                      pg_get_userbyid(q.proowner), q.prosecdef::text, coalesce(q.proconfig::text, ''))))
                 <> ALL (c_implicite_revizuite)) x
        ORDER BY x.d COLLATE "C"
      LOOP
        v := array_append(v, 'invocare implicită neanalizată: ' || k_s || ' (obiect din catalog care cheamă o funcție din închiderea citirilor) (citire nerevizuită)');
      END LOOP;
""".replace('@@SAMANTA_E3@@', SAMANTA_E3).replace('@@SEED_FN@@', SEED_FN)
# r5g (#825) NO-GO P1-D: amprentele invocărilor implicite revizuite de pe prod (citite read-only 22.10.2026 din pg_trigger /
# pg_proc): aceeași formulă ca în poartă — md5(tip | identitate | funcția | owner | SECURITY DEFINER | proconfig)
def ampr_impl(tip, identitate, functia, owner, secdef, config):
    return md5('|'.join([tip, identitate, functia, owner, secdef, config]))
AMPR_IMPL = {
    '@@AMPR_GRAPHQL@@': ampr_impl('event trigger', 'issue_pg_graphql_access', 'extensions.grant_pg_graphql_access()', 'supabase_admin', 'false', '{"search_path=\\"\\""}'),
    '@@AMPR_NET@@': ampr_impl('event trigger', 'issue_pg_net_access', 'extensions.grant_pg_net_access()', 'supabase_admin', 'false', '{"search_path=\\"\\""}'),
    '@@AMPR_REALTIME@@': ampr_impl('trigger', 'tr_check_filters on realtime.subscription', 'realtime.subscription_check_filters()', 'supabase_realtime_admin', 'false', '')}
for k_, v_ in AMPR_IMPL.items():
    assert RAPID.count(k_) == 1
    RAPID = RAPID.replace(k_, v_)
pl = pl[:a] + RAPID + pl[b:]
fin = "    RETURN v;\n  END $f$;"
assert pl.count(fin) == 1
pl = pl.replace(fin, """    -- E3 (20261103b): poarta documentelor de intrare, chemată de aici, ca orice activare / import E2a s-o includă (r5d §13.1)
    v := v || public.fn_izo_porti_e3_lipsa();
""" + fin)

INSERT_COLS = ", ".join(['id', 'uid', 'radacina_id', 'server_ver'] + C)
INSERT_VALS = ", ".join(["v_id", "gen_random_uuid()", "v_id", "nextval('public.izo_server_ver_seq')"] + ["x." + c for c in C])
INTRARI = (INTRARI.replace('@@CHEI_ANTET@@', CHEI_ANTET).replace('@@CHEI_RAND@@', CHEI_RAND).replace('@@ANTET_COLS@@', ANTET_COLS)
           .replace('@@ANTET_VALS@@', ANTET_VALS).replace('@@ANTET_SET@@', ANTET_SET).replace('@@RAND_COLS@@', RAND_COLS)
           .replace('@@RAND_VALS@@', RAND_VALS).replace('@@INSERT_COLS@@', INSERT_COLS).replace('@@INSERT_VALS@@', INSERT_VALS))

# ── r5f (#825 NO-GO, P1-3/P1-4): amprenta pre-E3 revizuită (din baseline_pre_e3.json) → constanta preflight-ului 0l și
# scheletul local generat (izometrie_e3_schelet_baseline.sql) care o reproduce exact ──
BAZA = json.load(open(SP + 'baseline_pre_e3.json', encoding='utf-8'))
b = lambda x: 't' if x else 'f'   # concat_ws / format pe boolean = ieșirea tipului ('t' / 'f')
md5_rev = {
    'relatii': {r['rel']: md5(':'.join([r['owner'], b(r['rls']), b(r['force']),
                                        ','.join(sorted('%s>%s:%s:%s' % (g, e, p, b(o)) for g, e, p, o in r['acl']))]))
                for r in BAZA['relatii']},
    'politici': {'%s.%s' % (p['rel'], p['nume']): md5(':'.join([p['cmd'], b(p['permisiva']), ','.join(sorted(p['roluri'])),
                                                                p['qual'] or '', p['wc'] or ''])) for p in BAZA['politici']},
    'triggere': {'%s.%s' % (t['rel'], t['nume']): md5(t['def'] + ':' + t['enabled']) for t in BAZA['triggere']},
    'functii': {'%s.%s(%s)' % (f['schema'], f['nume'], f['args']): md5(':'.join([f['owner'], b(f['secdef']), f['config'] or '', f['volatil'],
                                                                                 md5(f['prosrc'])])) for f in BAZA['functii']}}
# formatarea de aici = expresia SQL rulată pe prod (BAZA_EXPR): altfel captura și constanta nu descriu același lucru
assert md5_rev == BAZA['md5_prod'], [(k, x) for k in md5_rev for x in set(md5_rev[k]) | set(BAZA['md5_prod'][k])
                                     if md5_rev[k].get(x) != BAZA['md5_prod'][k].get(x)]
BAZA_REV = "\n".join('    ' + l for l in json.dumps(md5_rev, indent=2, sort_keys=True, ensure_ascii=False).replace("'", "''").splitlines())

ident = lambda s: '"%s"' % s.replace('"', '""')
CMD = {'r': 'SELECT', 'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE', '*': 'ALL'}
sch = ["-- GENERAT de scripts/izometrie/e3_gen/gen_e3.py din baseline_pre_e3.json (capturat de pe prod %s, PG %s) — NU se editează"
       % (BAZA['capturat_la'][:10], BAZA['server_version']),
       "-- de mână. r5f (#825 NO-GO, P1-3/P1-4): reproduce EXACT baseline-ul extern pre-E3 verificat de preflight-ul 0l al migrării",
       "-- 20261103b: owner / RLS / FORCE / ACL pe storage.objects și storage.buckets (fără MAINTAIN, doar PG17), TOATE politicile lor",
       "-- (expresiile exacte; funcțiile din ele = stub-uri cu semnătura de pe prod), trigger-ele profiles prevent_role_escalation_trigger /",
       "-- trg_profiles_campuri_owner_only cu corpurile EXACTE ale funcțiilor. Inclus din izometrie_e3_schelet.sql (\\ir).",
       "DO $r$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN",
       "  CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT; END IF; END $r$;",
       "GRANT USAGE ON SCHEMA storage TO supabase_storage_admin;   -- verificările FK rulează ca owner-ul tabelului",
       "-- coloanele profiles citite de politicile Storage și de corpurile trigger-elor (tipurile din expresiile deparsate)",
       "ALTER TABLE public.profiles " + ", ".join("ADD COLUMN IF NOT EXISTS %s %s" % c for c in [
           ('role', 'text'), ('can_access_pontaj_brut', 'boolean'), ('can_access_personal_data', 'boolean'), ('can_manage_contracts', 'boolean'),
           ('can_access_ctc', 'boolean'), ('department', 'text'), ('employee_id', 'bigint'), ('email', 'text'),
           ('can_use_document_scanner', 'boolean'), ('can_create_comenzi', 'boolean'), ('can_process_achizitii', 'boolean'),
           ('receive_tichete_logistica', 'boolean'), ('receive_tichete_hr', 'boolean'), ('receive_tichete_administrativ', 'boolean'),
           ('receive_tichete_it', 'boolean'), ('receive_tichete_comercial', 'boolean'), ('receive_tichete_financiar', 'boolean'),
           ('receive_bonuri_consum', 'boolean'), ('whatsapp_tier', 'text')]) + ";",
       "-- stub-urile funcțiilor din expresiile politicilor (deparsarea depinde doar de semnătură și de tipul rezultatului)"]
for f in BAZA['referinte']:
    sch.append("CREATE OR REPLACE FUNCTION %s.%s(%s) RETURNS %s LANGUAGE sql STABLE AS $s$ SELECT NULL::%s $s$;"
               % (f['schema'], f['nume'], f['args'], f['rezultat'], f['rezultat']))
for f in BAZA['functii']:
    assert '$corp$' not in f['prosrc'] and f['limbaj'] == 'plpgsql' and f['rezultat'] == 'trigger' and f['volatil'] == 'v'
    m = re.fullmatch(r'\{"search_path=([a-z_, ]+)"\}', f['config'] or '')
    assert m, f['config']
    sch.append("CREATE FUNCTION %s.%s(%s) RETURNS trigger LANGUAGE plpgsql%s SET search_path = %s AS $corp$%s$corp$;"
               % (f['schema'], f['nume'], f['args'], ' SECURITY DEFINER' if f['secdef'] else '', m.group(1), f['prosrc']))
    sch.append("ALTER FUNCTION %s.%s(%s) OWNER TO %s;" % (f['schema'], f['nume'], f['args'], f['owner']))
    # ACL-ul ca pe prod (acolo EXECUTE nu e la PUBLIC; altfel gate-ul 0e le vede ca gadget-uri expuse)
    assert all(g == f['owner'] and p == 'EXECUTE' and not o for g, _, p, o in f['acl'])
    sch.append("REVOKE ALL ON FUNCTION %s.%s(%s) FROM PUBLIC;" % (f['schema'], f['nume'], f['args']))
    for _, e, _, _ in f['acl']:
        sch.append("GRANT EXECUTE ON FUNCTION %s.%s(%s) TO %s;" % (f['schema'], f['nume'], f['args'], e))
for t in BAZA['triggere']:
    assert t['def'].startswith('CREATE TRIGGER ') and t['enabled'] in 'OADR'
    sch.append(t['def'] + ';')
    if t['enabled'] != 'O':
        sch.append("ALTER TABLE %s %s TRIGGER %s;" % (t['rel'], {'A': 'ENABLE ALWAYS', 'D': 'DISABLE', 'R': 'ENABLE REPLICA'}[t['enabled']], ident(t['nume'])))
sch.append("-- owner, RLS / FORCE, ACL (grantor = owner, ca pe prod)")
for r in BAZA['relatii']:
    assert all(g == r['owner'] for g, _, _, _ in r['acl'])
    sch.append("ALTER TABLE %s OWNER TO %s;" % (r['rel'], r['owner']))
    sch.append("REVOKE ALL ON TABLE %s FROM PUBLIC, %s;" % (r['rel'], ", ".join(sorted({e for _, e, _, _ in r['acl'] if e != 'PUBLIC'}))))
    for (e, o) in sorted({(e, o) for _, e, _, o in r['acl']}):
        sch.append("GRANT %s ON TABLE %s TO %s%s;" % (", ".join(p for _, e2, p, o2 in r['acl'] if (e2, o2) == (e, o)), r['rel'],
                                                     'PUBLIC' if e == 'PUBLIC' else e, ' WITH GRANT OPTION' if o else ''))
    sch.append("ALTER TABLE %s %s ROW LEVEL SECURITY;" % (r['rel'], 'ENABLE' if r['rls'] else 'DISABLE'))
    sch.append("ALTER TABLE %s %s ROW LEVEL SECURITY;" % (r['rel'], 'FORCE' if r['force'] else 'NO FORCE'))
sch.append("-- politicile (%d), exact ca pe prod" % len(BAZA['politici']))
for p in BAZA['politici']:
    sch.append("CREATE POLICY %s ON %s AS %s FOR %s TO %s%s%s;" % (
        ident(p['nume']), p['rel'], 'PERMISSIVE' if p['permisiva'] else 'RESTRICTIVE', CMD[p['cmd']],
        ", ".join('public' if x == 'public' else ident(x) for x in p['roluri']),
        (" USING (%s)" % p['qual']) if p['qual'] is not None else '', (" WITH CHECK (%s)" % p['wc']) if p['wc'] is not None else ''))
open(R + 'supabase/tests/izometrie_e3_schelet_baseline.sql', 'w', encoding='utf-8', newline='\n').write("\n".join(sch) + "\n")

mig = (tpl.replace('@@C_ARRAY@@', arr(C)).replace('@@EV_ARRAY@@', arr(EV)).replace('@@MIS_ARRAY@@', arr(MIS))
          .replace('@@MD5_GB_E2A@@', md5(prosrc(GB))).replace('@@MD5_GF_E2A@@', md5(prosrc(GF)))
          .replace('@@TIP_CHECK_E2A@@', TIP_CHECK_E2A.replace("'", "''")).replace('@@TIPURI_E3@@', ", ".join("'%s'" % t for t in TIPURI_E3))
          .replace('@@AMPRENTA@@', AMPRENTA).replace('@@GARDA_BUCATI_E3@@', gb).replace('@@GARDA_FAPTE_E3@@', gf)
          .replace('@@PORTI_LIPSA_E3@@', pl).replace('@@INTRARI@@', INTRARI).replace('@@DREPTURI@@', DREPTURI).replace('@@OWNERI@@', OWNERI)
          .replace('@@BAZA_EXPR@@', BAZA_EXPR).replace('@@BAZA_REV@@', BAZA_REV))
assert '@@' not in mig, re.findall('@@[A-Z_0-9]+@@', mig)
open(R + 'supabase/migrations/20261103b_izometrie_e3_documente.sql', 'w', encoding='utf-8', newline='\n').write(mig)

# ── revenirea ──
rev = open(SP + 'e3_rev_tpl.sql', encoding='utf-8').read()
rev = (rev.replace('@@AMPRENTA@@', AMPRENTA)
          .replace('@@GARDA_BUCATI_E2A@@', GB.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
          .replace('@@GARDA_FAPTE_E2A@@', GF.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
          .replace('@@PORTI_LIPSA_E2A@@', PL.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
          .replace('@@MD5_GB_E2A@@', md5(prosrc(GB))).replace('@@MD5_GF_E2A@@', md5(prosrc(GF))).replace('@@MD5_PL_E2A@@', md5(prosrc(PL)))
          .replace('@@TIPURI_E2A@@', ", ".join("'%s'" % t for t in TIPURI_E2A)).replace('@@FI@@', pf(FUNC_INTERNE)))
assert '@@' not in rev, re.findall('@@[A-Z_0-9]+@@', rev)
open(R + 'supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql', 'w', encoding='utf-8', newline='\n').write(rev)

# ── testul diferențial: închiderea veche (E2a, exact) și cea nouă (exact textul din migrare), ca funcții INVOKER de test ──
def bloc_inchidere(text):
    i = text.index("    DECLARE\n      c_rel oid[]; c_fn oid[] := '{}'")
    j = text.index("\n    END;\n", i)
    corp = text[i:j]
    k = corp.rindex("      IF EXISTS (SELECT 1 FROM pg_class vw WHERE vw.oid = ANY (c_rel)")
    return corp[:k] + "      o_rel := c_rel; o_fn := c_fn; o_mut := c_mut; o_mesaje := v;\n    END;\n"
def functie_test(nume, text):
    return ("CREATE FUNCTION teste.%s(OUT o_rel oid[], OUT o_fn oid[], OUT o_mut oid[], OUT o_mesaje text[])\n"
            "  LANGUAGE plpgsql STABLE AS $t$\nDECLARE v text[] := '{}';\nBEGIN\n%s\nEND $t$;\n") % (nume, bloc_inchidere(text))
# r5f (#825): sămânța E3 (SAMANTA_E3) apare o singură dată în poartă și în migrare; inchidere_noua = textul din migrare FĂRĂ
# ea (aceeași sămânță ca E2a: diferențialul compară algoritmul pe aceeași intrare), inchidere_noua_e3 = textul exact din migrare
assert pl.count(SAMANTA_E3) == 1 and mig.count(SAMANTA_E3) == 1 and PL.count(SAMANTA_E3) == 0
helper = ("-- Generat de gen_e3.py: închiderea citirilor din poarta E2a (20261102a, exact) și din poarta E3 (20261103b), ca funcții de\n"
          "-- test INVOKER (doar în baza *_test), pentru testul diferențial din scripts/test_izometrie_e3.sh. inchidere_noua = textul\n"
          "-- din migrare fără sămânța E3 (tabelele documentelor — aceeași sămânță ca E2a), inchidere_noua_e3 = textul exact (r5f #825).\n"
          + functie_test('inchidere_veche', PL) + "\n" + functie_test('inchidere_noua', pl.replace(SAMANTA_E3, ''))
          + "\n" + functie_test('inchidere_noua_e3', pl))
open(R + 'supabase/tests/izometrie_e3_inchidere.sql', 'w', encoding='utf-8', newline='\n').write(helper)
print('ok', len(mig.splitlines()), len(rev.splitlines()))
