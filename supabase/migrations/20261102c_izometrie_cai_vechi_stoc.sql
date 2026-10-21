-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102c — Izometrie: căile vechi la nivelul stoc (regresia de ștergere pe LOT 2). Decizia Razvan 21.10.2026: varianta A.
--
-- Problema: E2a (20261102a, „calea 3” din design §5.4) refuză din client, pe orice proiect cu nivel ≠ off, ștergerea
--   rândurilor de pachet (executie_tevi), ștergerea pachetelor și mutarea țevilor între pachete. Planul presupunea că LOT 2
--   n-are rânduri de pachet; are (pachetul 43_GAZ_CTG2_DWG_00001), iar ecranul vechi de izometrie nu mai poate corecta un rând.
-- Ce face: înlocuiește (CREATE OR REPLACE, același owner / ACL / search_path) cele 3 gărzi:
--   • fn_izo_refuz_delete_tevi   — DELETE pe executie_tevi;
--   • fn_izo_refuz_mutare_tevi   — UPDATE OF pachet_id pe executie_tevi;
--   • fn_izo_refuz_delete_pachet — DELETE pe executie_pachete_lansare (cu cascada pe țevi).
--   Refuzul rămâne DOAR (a) pe un proiect la nivelul montaj (E4a) sau (b) pentru un rând legat de o bucată din registru
--   (magazie_bucati.executie_teava_id, cu tip_cod setat). La nivelul stoc, rândurile nelegate se șterg / se mută ca înainte
--   de E2. Lock-ul partajat pe proiect + recitirea nivelului rămân (o trecere concurentă pe montaj e așteptată și văzută).
--   Arbitrul final al legăturii e FK-ul magazie_bucati.executie_teava_id → executie_tevi (NO ACTION), neschimbat.
-- Ce NU se schimbă (rămân blocate la stoc): pachet nou / mutat neconcordant cu proiectul tronsonului, mutarea pachetului între
--   proiecte / tronsoane, ștergerea / mutarea tronsoanelor, depozitele din registru, site-ul proiectului, bonurile cu bucăți
--   din registru, TRUNCATE.
-- Consecință acceptată (decizia A): importul Excel în modul REPLACE (ImportExcelIzometrie.jsx: DELETE apoi INSERT pe loturi)
--   redevine NEATOMIC pe LOT 2, ca înainte de E2 — un eșec la INSERT poate lăsa pachetul gol. Varianta atomică vine la E4a.
-- Amprentele: md5(prosrc) al funcțiilor fn_izo_* intră în ambele amprente E2a, deci se refac aici:
--   • porțile — COMMENT pe fn_izo_porti_definitii() (fn_izo_porti_lipsa() trebuie să rămână {});
--   • revenirea E2a — COMMENT pe magazie_bucati_evenimente (expresia <amprenta> copiată textual din 20261102a); valoarea de
--     dinainte se păstrează în comentariu (inainte_20261102c=…), pentru revenirea acestei migrări.
-- LIVRARE: doar prin scripts/livrare_migrare.sh. Revenire: supabase/revenire/20261102c_izometrie_cai_vechi_stoc_ROLLBACK.sql
-- (reface corpurile E2a, verifică md5-urile E2a și amprentele de dinainte).
-- Ce NU face: nicio dată modificată, niciun drept nou, nicio funcție nouă.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_lipsa text[];
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102c_izometrie_cai_vechi_stoc:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102c: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL OR to_regprocedure('public.fn_izo_porti_definitii()') IS NULL
     OR to_regclass('public.magazie_bucati_evenimente') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: registrul E2a (20261102a) nu e aplicat';
  END IF;
  -- cele 3 funcții: owner postgres, DEFINER, search_path fix, EXECUTE doar postgres, volatile
  IF (SELECT count(*) FROM pg_proc p JOIN (VALUES ('fn_izo_refuz_delete_tevi', 'b9903281aa585f48f0768b514713a0c3'), ('fn_izo_refuz_mutare_tevi', '898a6ace8fb4faa955e577632645ae50'), ('fn_izo_refuz_delete_pachet', 'e9729f3e1f3609262db5600cbfe76388')) x(nume, md5) ON p.proname = x.nume
       WHERE p.pronamespace = 'public'::regnamespace AND pg_get_function_identity_arguments(p.oid) = '' AND md5(p.prosrc) = x.md5
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND p.proacl::text = '{postgres=X/postgres}') <> 3
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('fn_izo_refuz_delete_tevi', 'fn_izo_refuz_mutare_tevi', 'fn_izo_refuz_delete_pachet')) <> 3 THEN
    RAISE EXCEPTION 'Precondiție 0c: gărzile căilor vechi nu au definiția E2a (deja aplicată sau modificate după 20261102a) — refuz';
  END IF;
  IF (SELECT count(*) FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgenabled = 'A'
       AND ((g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_mutare' AND g.tgfoid = 'public.fn_izo_refuz_mutare_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_pachete_lansare'::regclass AND g.tgname = 'trg_pachete_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_pachet()'::regprocedure))) <> 3 THEN
    RAISE EXCEPTION 'Precondiție 0d: trigger-ele căilor vechi lipsesc / nu sunt ENABLE ALWAYS / nu cheamă gărzile';
  END IF;
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN
    RAISE EXCEPTION 'Precondiție 0e: porțile E2a nu sunt complete înainte de migrare: %', v_lipsa;
  END IF;
  -- <amprenta> (expresie IDENTICĂ în migrare și în revenire — verificată textual de scripts/test_izometrie_e2a.sh)
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')), ',' ORDER BY c.relname, a.attnum)
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
          AND (c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari')
               OR (c.relname = 'magazie_bucati' AND a.attname IN ('tip_cod','uid','parinte_id','radacina_id','cod_bucata','capat_stanga',
                   'capat_dreapta','serie_canon','dezambiguare','lungime_aviz_mm','lungime_masurata_mm','lungime_mm','lungime_calculata',
                   'lungime_cm','perete_mm','diametru_mm','lot','aviz_intrare_id','nr_crt_aviz','bend_no','capat_marcaj','depozit_id',
                   'tronson_id','server_ver')))),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid IN ('public.izo_proiect_config'::regclass, 'public.izo_atribuiri'::regclass,
              'public.izo_importuri'::regclass, 'public.magazie_bucati_evenimente'::regclass, 'public.magazie_bucati_miscari'::regclass)
            OR (c.conrelid = 'public.magazie_bucati'::regclass AND (c.conname LIKE 'magazie\_bucati\_izo\_%' OR c.conname IN
                ('magazie_bucati_stare_check','magazie_bucati_locatie_tip_check','magazie_bucati_parinte_id_fkey',
                 'magazie_bucati_radacina_id_fkey','magazie_bucati_depozit_id_fkey','magazie_bucati_tronson_id_fkey')))),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname)
         FROM pg_policy p WHERE p.polname LIKE 'izo\_%' OR p.polname LIKE 'magbuc\_izo\_%'),
      (SELECT string_agg(format('%s:%s', pg_get_triggerdef(g.oid, false), g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE NOT g.tgisinternal AND (g.tgname LIKE 'trg\_izo\_%' OR g.tgname LIKE '%\_izo\_%')),
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname)
         FROM pg_class i WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
          AND (i.relname LIKE 'ux\_magbuc\_izo\_%' OR i.relname LIKE 'ix\_magbuc\_izo\_%' OR i.relname LIKE 'ux\_izo\_%'
               OR i.relname LIKE 'ix\_magbuc\_ev\_%' OR i.relname LIKE 'ix\_magbuc\_mis\_%')),
      (SELECT string_agg(format('%s(%s):%s:%s:%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc),
                                coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.provolatile), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
      (SELECT string_agg(format('%s:%s:%s:%s', c.relname, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                            'izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq',
                            'magazie_bucati_miscari_id_seq','magazie_bucati','magazie_bucati_id_seq')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', c.relname, format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcycle), ',' ORDER BY c.relname)
         FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq',
              'magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq')),
      (SELECT format('%s:%s:%s:%s:%s', r.rolinherit, r.rolcanlogin, r.rolbypassrls,
                     (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ','
                                       ORDER BY pg_get_userbyid(m.member)::text, m.admin_option, m.inherit_option, m.set_option)
                        FROM pg_auth_members m WHERE m.roleid = r.oid), r.rolsuper)
         FROM pg_roles r WHERE r.rolname = 'izo_registru_writer')))
    INTO v_amprenta;
  -- </amprenta>
  v_scrisa := substring(obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class') FROM 'amprenta=([0-9a-f]{32})');
  IF v_amprenta IS NULL OR v_amprenta IS DISTINCT FROM v_scrisa THEN
    RAISE EXCEPTION 'Precondiție 0f: amprenta de revenire E2a diferă de COMMENT (acum %, scrisă %) — ceva s-a schimbat după 20261102a', v_amprenta, v_scrisa;
  END IF;
  v_inainte := v_amprenta;

  -- ── gărzile căilor vechi (owner, ACL și search_path rămân: CREATE OR REPLACE) ─────────────────────────
  CREATE OR REPLACE FUNCTION public.fn_izo_refuz_delete_tevi() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v bigint[] := public.fn_izo_proiecte_pachet_blocat(OLD.pachet_id);
  BEGIN
    PERFORM public.fn_izo_lock_partajat(VARIADIC v);
    IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN
      -- 20261102c: la nivelul stoc, rândurile NELEGATE de registru se șterg din client (ca înainte de E2); la montaj, nu
      IF EXISTS (SELECT 1 FROM unnest(v) x WHERE public.fn_izo_nivel(x) = 'montaj') THEN
        RAISE EXCEPTION 'izo: rândurile de pachet ale unui proiect la nivelul montaj nu se șterg din client' USING ERRCODE = '42501';
      END IF;
      -- legătura cu registrul: mesajul clar aici; arbitrul final rămâne FK-ul magazie_bucati.executie_teava_id
      IF EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.executie_teava_id = OLD.id AND b.tip_cod IS NOT NULL) THEN
        RAISE EXCEPTION 'izo: rândul de pachet % e legat de o bucată din registru; nu se șterge din client', OLD.id USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END $f$;
  CREATE OR REPLACE FUNCTION public.fn_izo_refuz_mutare_tevi() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v bigint[];
  BEGIN
    IF NEW.pachet_id IS DISTINCT FROM OLD.pachet_id THEN
      -- părinții în ordinea id-urilor (doi mutători opuși nu se blochează circular)
      v := public.fn_izo_proiecte_pachet_blocat(least(OLD.pachet_id, NEW.pachet_id))
           || public.fn_izo_proiecte_pachet_blocat(greatest(OLD.pachet_id, NEW.pachet_id));
      PERFORM public.fn_izo_lock_partajat(VARIADIC v);
      IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN
        -- rândul FOR UPDATE înainte de verificarea legăturii (Copilot #823 P1): UPDATE-ul pe pachet_id ține doar
        -- NO KEY UPDATE, compatibil cu KEY SHARE-ul luat de FK-ul unei legări concurente (magazie_bucati.executie_teava_id);
        -- FOR UPDATE conflictează cu el → o legare în curs e așteptată și apoi văzută (snapshot nou), una ulterioară
        -- așteaptă mutarea. Legarea din registru (E4a) trebuie să blocheze rândul țevii FOR SHARE și să revalideze pachetul.
        PERFORM 1 FROM public.executie_tevi t WHERE t.id = OLD.id FOR UPDATE;
        -- 20261102c: refuz doar dinspre/spre un proiect la nivelul montaj sau pentru un rând legat de registru
        IF EXISTS (SELECT 1 FROM unnest(v) x WHERE public.fn_izo_nivel(x) = 'montaj') THEN
          RAISE EXCEPTION 'izo: țevile nu se mută între pachete dinspre/spre un proiect la nivelul montaj' USING ERRCODE = '42501';
        END IF;
        IF EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.executie_teava_id = OLD.id AND b.tip_cod IS NOT NULL) THEN
          RAISE EXCEPTION 'izo: rândul de pachet % e legat de o bucată din registru; nu se mută între pachete', OLD.id USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END $f$;
  CREATE OR REPLACE FUNCTION public.fn_izo_refuz_delete_pachet() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v bigint[] := array_remove(ARRAY[OLD.proiect_id, public.fn_izo_proiect_tronson_blocat(OLD.tronson_id)], NULL);
  BEGIN
    PERFORM public.fn_izo_lock_partajat(VARIADIC v);
    IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN
      -- 20261102c: la nivelul stoc pachetul fără rânduri legate de registru se șterge (cu țevile lui, prin cascadă)
      IF EXISTS (SELECT 1 FROM unnest(v) x WHERE public.fn_izo_nivel(x) = 'montaj') THEN
        RAISE EXCEPTION 'izo: pachetele unui proiect la nivelul montaj nu se șterg din client' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM public.executie_tevi t JOIN public.magazie_bucati b ON b.executie_teava_id = t.id
                  WHERE t.pachet_id = OLD.id AND b.tip_cod IS NOT NULL) THEN
        RAISE EXCEPTION 'izo: pachetul % are rânduri legate de registru; nu se șterge din client', OLD.id USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END $f$;

  -- ── postcondiții ──────────────────────────────────────────────────────────────────────────────────────
  -- cele 3 funcții: owner postgres, DEFINER, search_path fix, EXECUTE doar postgres, volatile
  IF (SELECT count(*) FROM pg_proc p JOIN (VALUES ('fn_izo_refuz_delete_tevi', '6bbf5cbcf144e2e2503f339b2e49f5ca'), ('fn_izo_refuz_mutare_tevi', 'f871d1a04053f78be8b21018d8bb5db7'), ('fn_izo_refuz_delete_pachet', '9b920ec26be971a54a2cd25dc4736698')) x(nume, md5) ON p.proname = x.nume
       WHERE p.pronamespace = 'public'::regnamespace AND pg_get_function_identity_arguments(p.oid) = '' AND md5(p.prosrc) = x.md5
         AND pg_get_userbyid(p.proowner) = 'postgres' AND p.prosecdef AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public, pg_temp'] AND p.proacl::text = '{postgres=X/postgres}') <> 3
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('fn_izo_refuz_delete_tevi', 'fn_izo_refuz_mutare_tevi', 'fn_izo_refuz_delete_pachet')) <> 3 THEN
    RAISE EXCEPTION 'Postcondiție P1: gărzile noi nu au definiția / owner-ul / ACL-ul așteptate';
  END IF;
  IF (SELECT count(*) FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgenabled = 'A'
       AND ((g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_tevi'::regclass AND g.tgname = 'trg_executie_tevi_izo_mutare' AND g.tgfoid = 'public.fn_izo_refuz_mutare_tevi()'::regprocedure)
         OR (g.tgrelid = 'public.executie_pachete_lansare'::regclass AND g.tgname = 'trg_pachete_izo_delete' AND g.tgfoid = 'public.fn_izo_refuz_delete_pachet()'::regprocedure))) <> 3 THEN
    RAISE EXCEPTION 'Postcondiție P2: trigger-ele căilor vechi s-au schimbat';
  END IF;
  -- amprenta porților, refăcută (md5(prosrc) al celor 3 funcții s-a schimbat); porțile trebuie să rămână complete
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN
    RAISE EXCEPTION 'Postcondiție P3: porțile nu sunt complete după migrare: %', v_lipsa;
  END IF;
  -- amprenta revenirii E2a, refăcută cu aceeași expresie; valoarea de dinainte rămâne în comentariu
  -- <amprenta> (expresie IDENTICĂ în migrare și în revenire — verificată textual de scripts/test_izometrie_e2a.sh)
  SELECT md5(concat_ws(' | ',
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                coalesce(pg_get_expr(d.adbin, d.adrelid), ''), coalesce(a.attacl::text, '')), ',' ORDER BY c.relname, a.attnum)
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
          AND (c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari')
               OR (c.relname = 'magazie_bucati' AND a.attname IN ('tip_cod','uid','parinte_id','radacina_id','cod_bucata','capat_stanga',
                   'capat_dreapta','serie_canon','dezambiguare','lungime_aviz_mm','lungime_masurata_mm','lungime_mm','lungime_calculata',
                   'lungime_cm','perete_mm','diametru_mm','lot','aviz_intrare_id','nr_crt_aviz','bend_no','capat_marcaj','depozit_id',
                   'tronson_id','server_ver')))),
      (SELECT string_agg(format('%s:%s', c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
         FROM pg_constraint c WHERE c.conrelid IN ('public.izo_proiect_config'::regclass, 'public.izo_atribuiri'::regclass,
              'public.izo_importuri'::regclass, 'public.magazie_bucati_evenimente'::regclass, 'public.magazie_bucati_miscari'::regclass)
            OR (c.conrelid = 'public.magazie_bucati'::regclass AND (c.conname LIKE 'magazie\_bucati\_izo\_%' OR c.conname IN
                ('magazie_bucati_stare_check','magazie_bucati_locatie_tip_check','magazie_bucati_parinte_id_fkey',
                 'magazie_bucati_radacina_id_fkey','magazie_bucati_depozit_id_fkey','magazie_bucati_tronson_id_fkey')))),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY (SELECT pc.relname FROM pg_class pc WHERE pc.oid = p.polrelid), p.polname)
         FROM pg_policy p WHERE p.polname LIKE 'izo\_%' OR p.polname LIKE 'magbuc\_izo\_%'),
      (SELECT string_agg(format('%s:%s', pg_get_triggerdef(g.oid, false), g.tgenabled), ',' ORDER BY g.tgname)
         FROM pg_trigger g WHERE NOT g.tgisinternal AND (g.tgname LIKE 'trg\_izo\_%' OR g.tgname LIKE '%\_izo\_%')),
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname)
         FROM pg_class i WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
          AND (i.relname LIKE 'ux\_magbuc\_izo\_%' OR i.relname LIKE 'ix\_magbuc\_izo\_%' OR i.relname LIKE 'ux\_izo\_%'
               OR i.relname LIKE 'ix\_magbuc\_ev\_%' OR i.relname LIKE 'ix\_magbuc\_mis\_%')),
      (SELECT string_agg(format('%s(%s):%s:%s:%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc),
                                coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.provolatile), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
      (SELECT string_agg(format('%s:%s:%s:%s', c.relname, coalesce(c.relacl::text, ''), c.relrowsecurity, c.relforcerowsecurity), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                            'izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq',
                            'magazie_bucati_miscari_id_seq','magazie_bucati','magazie_bucati_id_seq')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', c.relname, format_type(s.seqtypid, NULL), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcycle), ',' ORDER BY c.relname)
         FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq',
              'magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq')),
      (SELECT format('%s:%s:%s:%s:%s', r.rolinherit, r.rolcanlogin, r.rolbypassrls,
                     (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ','
                                       ORDER BY pg_get_userbyid(m.member)::text, m.admin_option, m.inherit_option, m.set_option)
                        FROM pg_auth_members m WHERE m.roleid = r.oid), r.rolsuper)
         FROM pg_roles r WHERE r.rolname = 'izo_registru_writer')))
    INTO v_amprenta;
  -- </amprenta>
  IF v_amprenta IS NULL OR v_amprenta !~ '^[0-9a-f]{32}$' OR v_amprenta = v_inainte THEN
    RAISE EXCEPTION 'Postcondiție P4: amprenta de revenire nu s-a putut reface (acum %, înainte %)', v_amprenta, v_inainte;
  END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',
    'Registrul de țeavă Transgaz (izometrie) — evenimente, doar adaug. Scris doar de funcțiile izo_registru_writer. 20261102a + 20261102c. amprenta='
    || v_amprenta || ' inainte_20261102c=' || v_inainte);

  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102c_izometrie_cai_vechi_stoc:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102c: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
