-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261103b_izometrie_e3_documente_ROLLBACK — NU e migrare. Scoate E3 și reface EXACT starea de dinainte (gărzile E2a,
-- poarta E2a, CHECK-ul tipurilor, ACL-urile, ștampilele, COMMENT-ul de revenire — verificat prin amprentă).
-- Refuză dacă există ORICE fapt E3 (document, eveniment doc_intrare / intrare_lista_ambalare / receptie_pv, bucată cu
-- aviz_intrare_id, obiect în bucket-ul izo-documente): registrul e doar-adaug, deci după primul fapt drumul e ÎNAINTE, cu
-- migrare corectivă revizuită. Rulează ÎNAINTEA oricărei reveniri E2a / 20261102c.
-- Procedura (un singur string):
--   BEGIN;
--   SELECT set_config('gazpet.revenire_20261103b', 'IZO_E3_SCOATE:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
--   apoi: DELETE FROM supabase_migrations.schema_migrations WHERE name = '20261103b_izometrie_e3_documente';
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $revenire$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_comentariu text; v_lipsa text[];
BEGIN
  IF current_setting('gazpet.revenire_20261103b', true) IS DISTINCT FROM 'IZO_E3_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261103b: nearmată (gazpet.revenire_20261103b legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261103b: rulează ca postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.izo_documente_intrare') IS NULL THEN RAISE EXCEPTION 'Revenire 20261103b: E3 nu e aplicată'; END IF;
  -- fapte E3 → refuz
  IF EXISTS (SELECT 1 FROM public.izo_documente_intrare) OR EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri)
     OR EXISTS (SELECT 1 FROM public.izo_documente_scanuri)
     OR EXISTS (SELECT 1 FROM public.magazie_bucati_evenimente WHERE document_tip = 'doc_intrare' OR tip IN ('intrare_lista_ambalare', 'receptie_pv'))
     OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE aviz_intrare_id IS NOT NULL OR nr_crt_aviz IS NOT NULL)
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'izo-documente') THEN
    RAISE EXCEPTION 'Revenire 20261103b: există date reale E3 (documente / evenimente / bucăți / scanuri) — refuz; corecția se face înainte, cu migrare revizuită';
  END IF;
  -- amprenta consistentă cu ce a scris migrarea
@@AMPRENTA@@
  v_comentariu := obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class');
  v_scrisa := substring(v_comentariu FROM 'amprenta=([0-9a-f]{32})');
  v_inainte := substring(v_comentariu FROM 'inainte_20261103b=([0-9a-f]{32})');
  IF v_amprenta IS NULL OR v_amprenta IS DISTINCT FROM v_scrisa OR v_inainte IS NULL OR position(' ‖ anterior: ' IN v_comentariu) = 0 THEN
    RAISE EXCEPTION 'Revenire 20261103b: amprenta diferă de COMMENT (acum %, scrisă %) — ceva s-a schimbat după migrare; refuz', v_amprenta, v_scrisa;
  END IF;

  -- Storage
  DROP POLICY izo_doc_scan_ins ON storage.objects;
  DROP POLICY izo_doc_scan_sel ON storage.objects;
  DROP POLICY izo_doc_scan_del ON storage.objects;
  -- Supabase blochează DELETE direct din storage.* (storage.protect_delete); ocolirea oficială, locală tranzacției, DOAR aici:
  -- bucket-ul e verificat gol mai sus (nicio obiect în izo-documente), deci nu rămân fișiere orfane (găsit pe branch-ul PG17)
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.buckets WHERE id = 'izo-documente';
  PERFORM set_config('storage.allow_delete_query', 'false', true);
  -- registrul: politicile, drepturile rolurilor E3 (REVOKE pe tabel retrage și drepturile pe coloane)
  DROP POLICY magbuc_izo_doceditor_sel ON public.magazie_bucati;
  DROP POLICY magbuc_izo_receptie_sel ON public.magazie_bucati;
  DROP POLICY magbuc_izo_receptie_ins ON public.magazie_bucati;
  DROP POLICY magbuc_izo_receptie_upd ON public.magazie_bucati;
  DROP POLICY izo_ev_receptie_sel ON public.magazie_bucati_evenimente;
  DROP POLICY izo_ev_receptie_ins ON public.magazie_bucati_evenimente;
  DROP POLICY izo_mis_receptie_sel ON public.magazie_bucati_miscari;
  DROP POLICY izo_mis_receptie_ins ON public.magazie_bucati_miscari;
  REVOKE ALL ON TABLE public.magazie_bucati, public.magazie_bucati_evenimente, public.magazie_bucati_miscari FROM izo_doc_editor, izo_receptie_writer;
  REVOKE ALL ON SEQUENCE public.magazie_bucati_id_seq, public.izo_server_ver_seq, public.magazie_bucati_evenimente_id_seq,
    public.magazie_bucati_miscari_id_seq FROM izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_nivel(bigint), public.fn_izo_uid(), public.fn_izo_porti_lipsa(), public.fn_izo_loc_valid(bigint, integer, bigint),
    public.fn_izo_citire(bigint), public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]), public.fn_izo_blocheaza_tabele(),
    public.fn_izo_lock_partajat(bigint[]), public.fn_izo_lock_proiect(bigint, boolean), public.fn_izo_porti_definitii(),
    public.fn_izo_garda_scriitor(), public.fn_izo_tip_cod(integer), public.fn_izo_site_proiect(bigint), public.fn_izo_tip_material(text)
    FROM izo_doc_editor, izo_receptie_writer;
  -- gărzile E2a și poarta E2a: definițiile 20261102a, exact
@@GARDA_BUCATI_E2A@@

@@GARDA_FAPTE_E2A@@

@@PORTI_LIPSA_E2A@@
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_bucati()'::regprocedure)) IS DISTINCT FROM '@@MD5_GB_E2A@@'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_fapte()'::regprocedure)) IS DISTINCT FROM '@@MD5_GF_E2A@@'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_porti_lipsa()'::regprocedure)) IS DISTINCT FROM '@@MD5_PL_E2A@@' THEN
    RAISE EXCEPTION 'Revenire 20261103b: corpurile refăcute nu au md5-ul E2a';
  END IF;
  -- tabelele / indexurile / FK-ul / CHECK-ul
  DROP TABLE public.izo_documente_scanuri;
  DROP TABLE public.izo_documente_intrare_randuri;
  ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_izo_aviz_fkey;
  DROP INDEX public.ux_magbuc_izo_aviz_rand;
  DROP TABLE public.izo_documente_intrare;
  DROP INDEX public.ux_magbuc_ev_doc_intrare;
  DROP INDEX public.ux_magbuc_ev_doc_pv;
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magazie_bucati_evenimente_tip_check;
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN (@@TIPURI_E2A@@));
  -- funcțiile E3 (cele ale rolurilor le scoate owner-ul)
  SET LOCAL ROLE izo_receptie_writer;
  DROP FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text), public.fn_izo_doc_confirma(bigint, bigint, text),
    public.fn_izo_doc_pv(bigint, bigint, text, date), public.fn_izo_doc_anuleaza(bigint, text);
  RESET ROLE;
  SET LOCAL ROLE izo_doc_editor;
  DROP FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint),
    public.fn_izo_doc_anuleaza_draft(bigint, bigint, text);
  RESET ROLE;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261103b: rolul nu a revenit la postgres'; END IF;
  DROP FUNCTION public.fn_izo_coloane_c(), public.fn_izo_coloane_ev(), public.fn_izo_coloane_mis(), public.fn_izo_proiectie(jsonb, text[]),
    public.fn_izo_jwt_rol(), public.fn_izo_canon_serie(text), public.fn_izo_doc_autorizare_lock(bigint, integer), public.fn_izo_scan_exista(text),
    public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text), public.fn_izo_doc_hash(bigint),
    public.fn_izo_doc_blocante(bigint), public.fn_izo_doc_avertismente(bigint), public.fn_izo_doc_bucata_asteptata(bigint, integer),
    public.fn_izo_eveniment_asteptat(text, bigint, bigint, text), public.fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer),
    public.fn_izo_garda_receptie(text, text, jsonb, jsonb), public.fn_izo_doc_garda(), public.fn_izo_porti_e3_definitii(),
    public.fn_izo_porti_e3_lipsa(), public.fn_izo_doc_api_verifica();
  -- rolurile
  REVOKE ALL ON SCHEMA public FROM izo_doc_editor, izo_receptie_writer;
  DROP ROLE izo_doc_editor;
  DROP ROLE izo_receptie_writer;
  -- ștampila porților E2a și COMMENT-ul de revenire, la valorile de dinainte
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'Revenire 20261103b: porțile E2a nu sunt complete după revenire: %', v_lipsa; END IF;
@@AMPRENTA@@
  IF v_amprenta IS DISTINCT FROM v_inainte THEN
    RAISE EXCEPTION 'Revenire 20261103b: amprenta după revenire (%) ≠ cea de dinainte de E3 (%) — baseline nerefăcut', v_amprenta, v_inainte;
  END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L', substring(v_comentariu FROM position(' ‖ anterior: ' IN v_comentariu) + 13));
  RAISE NOTICE 'Revenire 20261103b: E3 scoasă; amprenta = cea de dinainte (%)', v_amprenta;
END
$revenire$;
