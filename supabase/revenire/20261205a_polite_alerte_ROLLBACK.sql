-- Revenire 20261205a_polite_alerte. Runner: o tranzactie, GUC gazpet.revenire_20261205a = 'POLITE_SCOASE:'||txid_current().
-- Fail-closed (nimic schimbat) daca:
--   * obiectele nu mai sunt EXACT cele create de 20261205a: AMPRENTA (aceeasi interogare ca postconditia migrarii; blocul e copiat
--     identic, verificat de src/polite.test.js) comparata cu valoarea pastrata de migrare in COMMENT ON TABLE polite_alerte_config;
--   * exista DATE sau ISTORIC noi: o propunere citita, o alerta reala in jurnal (orice rand in afara de proba), comutatorul folosit
--     vreodata, lista de destinatari schimbata fata de valorile initiale, o polita / un act cu campurile noi completate (tip avans,
--     moneda EUR, perioade, sha256, provenienta citita), un rand din Registru legat de o polita de pe contract;
--   * alta vedere / functie depinde de obiectele noi.
-- Ce face: scoate cronul (cron.unschedule), vederea, triggerele, coloanele noi, tabelele noi, functiile noi; reface CHECK-ul vechi pe
--   contracte_polite.tip (numele lui vechi e pastrat de migrare in comentariul constrangerii). Lock-uri NOWAIT, in ordinea migrarii (L06).
-- Ordinea de retragere: intai edge-urile polite-alerte-mail si polita-citeste (sau UI-ul inapoi), apoi aceasta revenire.
DO $pre$
DECLARE v_amprenta text; v_pastrata text; v_n integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261205a', true) IS DISTINCT FROM 'POLITE_SCOASE:' || txid_current() THEN
    RAISE EXCEPTION '20261205a revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.polite_alerte_config') IS NULL OR to_regclass('public.polite_propuneri') IS NULL THEN
    RAISE EXCEPTION '20261205a revenire: migrarea 20261205a lipseste';
  END IF;
  LOCK TABLE public.polite_propuneri, public.contracte_polite, public.contracte_polite_acte, public.garantii,
             public.polite_alerte_destinatari, public.polite_alerte_config, public.polite_alerte_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
  --AMPRENTA_INCEPUT
  SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', a.attrelid::regclass, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-'),
                              coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(a.attacl) x), '-')), ';' ORDER BY a.attrelid::regclass::text, a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND (a.attrelid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass, 'public.polite_alerte_jurnal'::regclass)
             OR (a.attrelid = 'public.garantii'::regclass AND a.attname = 'contract_polita_id')
             OR (a.attrelid IN ('public.contracte_polite'::regclass, 'public.contracte_polite_acte'::regclass)
                 AND a.attname IN ('moneda', 'executie_de_la', 'executie_pana_la', 'garantie_de_la', 'garantie_pana_la', 'pdf_sha256', 'sursa', 'propunere_id')))),
    (SELECT string_agg(c.conrelid::regclass || '.' || c.conname || '=' || pg_get_constraintdef(c.oid), ';' ORDER BY c.conrelid::regclass::text, c.conname)
       FROM pg_constraint c WHERE c.conrelid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass, 'public.polite_alerte_jurnal'::regclass)
          OR (c.conrelid IN ('public.contracte_polite'::regclass, 'public.contracte_polite_acte'::regclass, 'public.garantii'::regclass)
              AND c.conname IN ('contracte_polite_tip_check', 'contracte_polite_moneda_check', 'contracte_polite_sursa_check',
                'contracte_polite_sha_check', 'contracte_polite_executie_check', 'contracte_polite_garantie_check', 'contracte_polite_provenienta_check',
                'contracte_polite_propunere_fkey', 'contracte_polite_acte_sursa_check', 'contracte_polite_acte_sha_check', 'contracte_polite_acte_executie_check',
                'contracte_polite_acte_garantie_check', 'contracte_polite_acte_provenienta_check', 'contracte_polite_acte_propunere_fkey',
                'garantii_contract_polita_fkey', 'garantii_contract_polita_forma_check'))),
    (SELECT string_agg(i.indexrelid::regclass || '=' || pg_get_indexdef(i.indexrelid), ';' ORDER BY i.indexrelid::regclass::text)
       FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE ic.relname IN ('polite_propuneri_stare_idx', 'contracte_polite_propunere_uidx', 'contracte_polite_acte_propunere_uidx', 'garantii_contract_polita_uidx',
                           'polite_dest_unic_uidx', 'polite_jurnal_cheie_uidx', 'polite_jurnal_creat_idx')),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', r.relname, r.relkind, pg_get_userbyid(r.relowner), r.relrowsecurity, r.relforcerowsecurity,
                              coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(r.relacl) x), '-'), coalesce(array_to_string(r.reloptions, ' '), '-')), ';' ORDER BY r.relname)
       FROM pg_class r WHERE r.oid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass,
                                       'public.polite_alerte_jurnal'::regclass, 'public.v_polite_scadente'::regclass, 'public.polite_propuneri_id_seq'::regclass,
                                       'public.polite_alerte_destinatari_id_seq'::regclass, 'public.polite_alerte_jurnal_id_seq'::regclass)),
    (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', p.polrelid::regclass, p.polname, p.polcmd, p.polpermissive,
                              (SELECT string_agg(rl::regrole::text, ',' ORDER BY rl::regrole::text) FROM unnest(p.polroles) rl),
                              coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ';' ORDER BY p.polrelid::regclass::text, p.polname)
       FROM pg_policy p WHERE p.polrelid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass, 'public.polite_alerte_jurnal'::regclass)),
    (SELECT string_agg(format('%s:%s:%s', pg_get_triggerdef(t.oid), t.tgfoid::regprocedure, t.tgenabled), ';' ORDER BY t.tgrelid::regclass::text, t.tgname)
       FROM pg_trigger t WHERE t.tgname LIKE 'trg!_polite!_%' ESCAPE '!' AND NOT t.tgisinternal),
    md5(replace(pg_get_viewdef('public.v_polite_scadente'::regclass), chr(13), '')),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', p.oid::regprocedure, p.prosecdef, p.provolatile, p.proisstrict, coalesce(array_to_string(p.proconfig, ','), '-'),
                              pg_get_userbyid(p.proowner), coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(p.proacl) x), '-'),
                              md5(replace(p.prosrc, chr(13), ''))), ';' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!' OR p.proname IN ('fn_poate_scrie_polite', 'fn_poate_scrie_garantii'))),
    (SELECT string_agg(format('%s:%s:%s:%s:%s', j.jobname, j.schedule, md5(replace(j.command, chr(13), '')), j.active, j.username), ';' ORDER BY j.jobid)
       FROM cron.job j WHERE j.jobname = 'polite_alerte_zilnic'))) INTO v_amprenta;
  --AMPRENTA_SFARSIT
  v_pastrata := substring(obj_description('public.polite_alerte_config'::regclass, 'pg_class') FROM 'amprenta=([0-9a-f]{32})$');
  IF v_pastrata IS NULL OR v_amprenta IS DISTINCT FROM v_pastrata THEN
    RAISE EXCEPTION '20261205a revenire: obiectele nu mai sunt exact cele din 20261205a (amprenta % <> pastrata %)', v_amprenta, coalesce(v_pastrata, '-');
  END IF;
  -- date / istoric noi = refuz
  IF EXISTS (SELECT 1 FROM public.polite_propuneri) THEN RAISE EXCEPTION '20261205a revenire: exista propuneri citite (date noi)'; END IF;
  IF EXISTS (SELECT 1 FROM public.polite_alerte_jurnal WHERE stare <> 'proba') THEN RAISE EXCEPTION '20261205a revenire: exista alerte reale in jurnal (istoric)'; END IF;
  IF (SELECT activ OR schimbat_la IS NOT NULL FROM public.polite_alerte_config WHERE id) IS NOT FALSE THEN
    RAISE EXCEPTION '20261205a revenire: comutatorul alertelor a fost folosit';
  END IF;
  SELECT count(*) INTO v_n FROM public.polite_alerte_destinatari d
   WHERE d.creat_de IS NULL AND d.actualizat_la = d.creat_la AND d.activ
     AND ((d.fel = 'adresa' AND d.departament IN ('financiar', 'ofertare'))
          OR (d.departament = 'executie' AND d.fel IN ('sef_santier', 'manager_proiect')))
     AND d.tipuri = ARRAY['GBE', 'CAR', 'GPL', 'avans', 'altul']::text[];
  IF v_n <> 5 OR (SELECT count(*) FROM public.polite_alerte_destinatari) <> 5 THEN
    RAISE EXCEPTION '20261205a revenire: lista de destinatari s-a schimbat fata de valorile initiale';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contracte_polite WHERE tip = 'avans' OR moneda <> 'RON' OR sursa <> 'manual' OR pdf_sha256 IS NOT NULL OR propunere_id IS NOT NULL
               OR executie_de_la IS NOT NULL OR executie_pana_la IS NOT NULL OR garantie_de_la IS NOT NULL OR garantie_pana_la IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.contracte_polite_acte WHERE sursa <> 'manual' OR pdf_sha256 IS NOT NULL OR propunere_id IS NOT NULL
               OR executie_de_la IS NOT NULL OR executie_pana_la IS NOT NULL OR garantie_de_la IS NOT NULL OR garantie_pana_la IS NOT NULL) THEN
    RAISE EXCEPTION '20261205a revenire: polite / acte cu campurile noi completate (date noi)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.garantii WHERE contract_polita_id IS NOT NULL) THEN
    RAISE EXCEPTION '20261205a revenire: randuri din Registru legate de polite de pe contract';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'polite_alerte_zilnic') <> 1 THEN RAISE EXCEPTION '20261205a revenire: jobul polite_alerte_zilnic lipseste sau e dublat'; END IF;
  -- nicio ALTA vedere / functie nu depinde de obiectele noi
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND w.ev_class <> 'public.v_polite_scadente'::regclass
                AND (d.refobjid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass,
                                    'public.polite_alerte_jurnal'::regclass, 'public.v_polite_scadente'::regclass)
                     OR d.refobjid IN (SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                                         AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!' OR p.proname = 'fn_poate_scrie_polite'))
                     -- r2 (Jakarinos r1 P1-2): doar perechile tabela + coloana create de 20261205a (garantii.moneda exista dinainte)
                     OR (d.refobjid, d.refobjsubid) IN (SELECT a.attrelid, a.attnum FROM pg_attribute a JOIN (VALUES
                            ('public.contracte_polite'::regclass, 'moneda'), ('public.contracte_polite'::regclass, 'executie_de_la'), ('public.contracte_polite'::regclass, 'executie_pana_la'),
                            ('public.contracte_polite'::regclass, 'garantie_de_la'), ('public.contracte_polite'::regclass, 'garantie_pana_la'), ('public.contracte_polite'::regclass, 'pdf_sha256'),
                            ('public.contracte_polite'::regclass, 'sursa'), ('public.contracte_polite'::regclass, 'propunere_id'),
                            ('public.contracte_polite_acte'::regclass, 'executie_de_la'), ('public.contracte_polite_acte'::regclass, 'executie_pana_la'),
                            ('public.contracte_polite_acte'::regclass, 'garantie_de_la'), ('public.contracte_polite_acte'::regclass, 'garantie_pana_la'),
                            ('public.contracte_polite_acte'::regclass, 'pdf_sha256'), ('public.contracte_polite_acte'::regclass, 'sursa'),
                            ('public.contracte_polite_acte'::regclass, 'propunere_id'), ('public.garantii'::regclass, 'contract_polita_id')) v(t, c)
                          ON a.attrelid = v.t AND a.attname = v.c AND NOT a.attisdropped))) THEN
    RAISE EXCEPTION '20261205a revenire: alta vedere depinde de obiectele 20261205a';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
               AND NOT (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!' OR p.proname = 'fn_poate_scrie_polite')
               AND p.prosrc ~ '(fn_polite_|fn_polita_|fn_poate_scrie_polite|polite_propuneri|polite_alerte_|v_polite_scadente|contract_polita_id)') THEN
    RAISE EXCEPTION '20261205a revenire: alta functie foloseste obiectele 20261205a';
  END IF;
END $pre$;

SELECT cron.unschedule('polite_alerte_zilnic');
DROP VIEW public.v_polite_scadente;
DROP TRIGGER trg_polite_provenienta ON public.contracte_polite;
DROP TRIGGER trg_polite_provenienta ON public.contracte_polite_acte;
DROP TRIGGER trg_polite_reimprospateaza_garantii ON public.contracte_polite;
DROP TRIGGER trg_polite_reimprospateaza_garantii ON public.contracte_polite_acte;
DROP TRIGGER trg_polite_garantii_din_polita ON public.garantii;
DROP TRIGGER trg_polite_dest_normalizeaza ON public.polite_alerte_destinatari;
ALTER TABLE public.garantii DROP COLUMN contract_polita_id;
ALTER TABLE public.contracte_polite DROP COLUMN propunere_id, DROP COLUMN sursa, DROP COLUMN pdf_sha256, DROP COLUMN garantie_pana_la,
  DROP COLUMN garantie_de_la, DROP COLUMN executie_pana_la, DROP COLUMN executie_de_la, DROP COLUMN moneda;
ALTER TABLE public.contracte_polite_acte DROP COLUMN propunere_id, DROP COLUMN sursa, DROP COLUMN pdf_sha256, DROP COLUMN garantie_pana_la,
  DROP COLUMN garantie_de_la, DROP COLUMN executie_pana_la, DROP COLUMN executie_de_la;
DROP TABLE public.polite_alerte_jurnal;
DROP TABLE public.polite_alerte_config;
DROP TABLE public.polite_alerte_destinatari;
DROP TABLE public.polite_propuneri;
DO $tip$
DECLARE v_vechi text;
BEGIN
  v_vechi := substring(obj_description((SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.contracte_polite'::regclass AND c.conname = 'contracte_polite_tip_check'), 'pg_constraint')
                       FROM 'nume_vechi=([A-Za-z0-9_]{1,63})$');
  IF v_vechi IS NULL THEN RAISE EXCEPTION '20261205a revenire: numele vechi al CHECK-ului pe tip lipseste'; END IF;
  -- nicio polita cu tipul avans (verificat mai sus, sub lock): CHECK-ul vechi se valideaza
  ALTER TABLE public.contracte_polite DROP CONSTRAINT contracte_polite_tip_check;
  EXECUTE format('ALTER TABLE public.contracte_polite ADD CONSTRAINT %I CHECK (tip = ANY (ARRAY[%L::text, %L::text, %L::text, %L::text]))',
                 v_vechi, 'GBE', 'CAR', 'GPL', 'altul');
END $tip$;
DROP FUNCTION public.fn_polita_propunere_respinge(bigint, text);
DROP FUNCTION public.fn_polita_salveaza(bigint, jsonb, jsonb);
DROP FUNCTION public.fn_polite_propunere_json(bigint);
DROP FUNCTION public.fn_polite_propunere_esec(bigint, text, numeric);
DROP FUNCTION public.fn_polite_propunere_completeaza(bigint, jsonb, jsonb, text, numeric);
DROP FUNCTION public.fn_polite_propunere_rezerva(text, uuid);
DROP FUNCTION public.fn_polite_alerte_reconciliaza();
DROP FUNCTION public.fn_polite_alerte_marcheaza(bigint[], text, text, text);
DROP FUNCTION public.fn_polite_alerte_rezerva(date);
DROP FUNCTION public.fn_polite_alerte_porneste(boolean);
DROP FUNCTION public.fn_polite_alerte_proba(date);
DROP FUNCTION public.fn_polite_alerte_calculeaza(date);
DROP FUNCTION public.fn_polite_dest_normalizeaza();
DROP FUNCTION public.fn_polite_scadente(date);
DROP FUNCTION public.fn_polite_reimprospateaza_garantii();
DROP FUNCTION public.fn_polite_garantii_din_polita();
DROP FUNCTION public.fn_polite_provenienta();
DROP FUNCTION public.fn_polite_e_owner();
DROP FUNCTION public.fn_poate_scrie_polite();
DROP FUNCTION public.fn_polite_suma(jsonb, text);
DROP FUNCTION public.fn_polite_data(jsonb, text);
DROP FUNCTION public.fn_polite_text(jsonb, text, integer);
DROP FUNCTION public.fn_polite_norm_nr(text);

DO $post$
DECLARE v_def text;
BEGIN
  IF to_regclass('public.polite_propuneri') IS NOT NULL OR to_regclass('public.polite_alerte_destinatari') IS NOT NULL
     OR to_regclass('public.polite_alerte_config') IS NOT NULL OR to_regclass('public.polite_alerte_jurnal') IS NOT NULL
     OR to_regclass('public.v_polite_scadente') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                  AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!' OR p.proname = 'fn_poate_scrie_polite'))
     -- r2 (Jakarinos r1 P1-2): pe tabela, doar coloanele create de 20261205a (garantii.moneda exista dinainte si ramane)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.contracte_polite'::regclass AND NOT a.attisdropped
                  AND a.attname IN ('moneda', 'executie_de_la', 'executie_pana_la', 'garantie_de_la', 'garantie_pana_la', 'pdf_sha256', 'sursa', 'propunere_id'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.contracte_polite_acte'::regclass AND NOT a.attisdropped
                  AND a.attname IN ('executie_de_la', 'executie_pana_la', 'garantie_de_la', 'garantie_pana_la', 'pdf_sha256', 'sursa', 'propunere_id'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.garantii'::regclass AND NOT a.attisdropped AND a.attname = 'contract_polita_id')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname LIKE 'trg!_polite!_%' ESCAPE '!' AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'polite_alerte_zilnic') THEN
    RAISE EXCEPTION '20261205a revenire: au ramas obiecte 20261205a';
  END IF;
  SELECT min(pg_get_constraintdef(c.oid)) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.contracte_polite'::regclass AND c.contype = 'c'
     AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.contracte_polite'::regclass AND a.attname = 'tip')]::smallint[];
  IF v_def IS DISTINCT FROM 'CHECK ((tip = ANY (ARRAY[''GBE''::text, ''CAR''::text, ''GPL''::text, ''altul''::text])))' THEN
    RAISE EXCEPTION '20261205a revenire: CHECK-ul vechi pe tip nu a fost refacut exact (%)', coalesce(v_def, '-');
  END IF;
  IF current_setting('gazpet.revenire_20261205a', true) IS DISTINCT FROM 'POLITE_SCOASE:' || txid_current() THEN
    RAISE EXCEPTION '20261205a revenire: garda final invalida';
  END IF;
END $post$;
