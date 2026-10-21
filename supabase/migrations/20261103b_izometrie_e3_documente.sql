-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261103b — Izometrie E3: documentele de intrare (aviz țeavă / listă de ambalare curbe) → registru, cu PV și anulare.
-- Design: docs/izometrie/E3_CONFIRMA_DESIGN.md r5c (GO Copilot + Jakarinos, 21.10.2026); contractul RPC pentru UI:
-- C:\Users\Public\livrare\E3_CONTRACT_RPC.md. Peste 20261102a (registrul E2a) + 20261102c (căile vechi la stoc).
--
-- Ce creează:
--   • rolurile izo_doc_editor (draftul) și izo_receptie_writer (registrul E3), NOLOGIN NOINHERIT, membru doar postgres (SET);
--   • tabelele izo_documente_intrare / _randuri / _scanuri (RLS; citire = fn_izo_citire pe proiect; scriere doar prin funcții);
--   • FK-ul magazie_bucati.aviz_intrare_id → document, indexul (document, rând), indexurile de eveniment (intrare / PV);
--   • CHECK-ul tipurilor de eveniment + intrare_lista_ambalare / receptie_pv;
--   • intrările API: fn_izo_doc_salveaza / _verifica (owner izo_doc_editor), fn_izo_doc_confirma / _pv (owner
--     izo_receptie_writer); administrativ: fn_izo_doc_anuleaza (doar postgres);
--   • garda E3 (fn_izo_garda_receptie) integrată în predicatul de autorizare al gărzilor E2a (v_aut, fără RETURN timpuriu)
--     și în trigger-ul de imutabilitate al documentelor; contextul operației în izo.receptie_ctx;
--   • bucket-ul izo-documente (privat, PDF) cu politicile izo_doc_scan_ins / _sel / _del (fără UPDATE) și, r5f (#825 NO-GO,
--     P1-3), politicile RESTRICTIVE izo_doc_scan_r_* pe storage.objects: rândurile din izo-documente trec DOAR prin predicatele
--     E3 (fn_izo_scan_poate_*), UPDATE / mutarea în bucket interzise; celelalte bucket-uri (și bucket_id NULL) neatinse;
--     r5f (#825 NO-GO, a doua ușă): politicile RESTRICTIVE izo_doc_bucket_r_* pe storage.buckets — rândul bucket-ului
--     izo-documente nu se modifică (public / limite), nu se șterge și nu se (re)creează decât de rolurile cu BYPASSRLS;
--   • poarta E3 (fn_izo_porti_e3_lipsa / fn_izo_porti_e3_definitii, ștampilă proprie): indexuri, ACL pe tabele ȘI pe
--     coloane, roluri, trigger-ele (definiția completă, r5f), bucket, owner / RLS / FORCE / ACL pe storage.objects și
--     storage.buckets (r5f; RLS-ul cerut explicit), mulțimea exactă de coloane (C) a registrului.
-- r5f (#825 NO-GO, P1-3/P1-4): baseline-ul EXTERN de dinainte de E3 (Storage + trigger-ele profiles) se verifică la apply
--   (precondiția 0l) față de amprenta pre-E3 REVIZUITĂ (scripts/izometrie/e3_gen/baseline_pre_e3.json), nu se ștampilează cum e găsit.
-- Poarta E2a completă (fn_izo_porti_lipsa, ~8,5 s pe prod) rulează în confirmare / PV ÎNAINTEA lock-urilor; după lock-uri
--   și în salvare / verificare: amprenta E2a (fn_izo_porti_definitii = COMMENT, ~11 ms) + poarta E3.
-- Amprentele E2a (porți + revenire) se refac aici (gărzile E2a și funcțiile fn_izo_* noi intră în ele); valoarea de
--   revenire de dinainte rămâne în comentariu (inainte_20261103b=…), pentru revenirea acestei migrări.
-- Ce NU face: nicio dată existentă modificată (preflight: toate bucățile au aviz_intrare_id / nr_crt_aviz NULL), niciun
--   drept pentru oameni, nicio atribuire.
-- LIVRARE: doar prin scripts/livrare_migrare.sh. Revenire: supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql
--   (refuză dacă există ORICE fapt E3; după primul document, drumul e înainte, cu migrare revizuită).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE v_amprenta text; v_scrisa text; v_inainte text; v_lipsa text[]; v_x text; v_comentariu text; v_baza jsonb; v_baza_rev jsonb;
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103b_izometrie_e3_documente:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL OR to_regprocedure('public.fn_izo_garda_bucati()') IS NULL
     OR to_regprocedure('public.fn_izo_garda_fapte()') IS NULL OR to_regclass('public.magazie_bucati_evenimente') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: registrul E2a (20261102a) nu e aplicat';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('izo_doc_editor', 'izo_receptie_writer'))
     OR to_regclass('public.izo_documente_intrare') IS NOT NULL OR to_regclass('public.izo_documente_intrare_randuri') IS NOT NULL
     OR to_regclass('public.izo_documente_scanuri') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'fn\_izo\_doc\_%' OR proname LIKE 'fn\_izo\_porti\_e3\_%'))
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-documente') THEN
    RAISE EXCEPTION 'Precondiție 0c: obiecte E3 există deja (roluri / tabele / funcții / bucket)';
  END IF;
  -- gărzile E2a au exact definiția 20261102a (le înlocuim cu o variantă care integrează garda E3)
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_bucati()'::regprocedure)) IS DISTINCT FROM 'ab63fc079fcc07a03025c782c2ec891f'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_fapte()'::regprocedure)) IS DISTINCT FROM '5d8bc18846f9b20460a95bae25ef4cd9' THEN
    RAISE EXCEPTION 'Precondiție 0d: fn_izo_garda_bucati / fn_izo_garda_fapte nu au definiția 20261102a';
  END IF;
  -- mulțimea EXACTĂ de coloane a registrului = C ∪ {id, uid, radacina_id, server_ver, created_at, updated_at} ∪ generate
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
       WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '')
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['proiect_id', 'comanda_furnizor_id', 'tip_material_id', 'serie', 'sarja', 'dimensiune', 'grad_otel', 'standard', 'lungime_m', 'lungime_originala_m', 'greutate_kg', 'unghi_curba', 'cantitate', 'um', 'provenienta', 'izolatie', 'furnizor', 'producator', 'sursa_receptie', 'fara_packing_list', 'nr_document', 'data_receptie', 'mtc_path', 'stare', 'locatie_tip', 'locatie_site_id', 'executie_teava_id', 'atribute', 'observatii', 'receptionat_de', 'receptionat_la', 'created_by', 'tip_cod', 'parinte_id', 'cod_bucata', 'capat_stanga', 'capat_dreapta', 'dezambiguare', 'lungime_aviz_mm', 'lungime_masurata_mm', 'lungime_mm', 'lungime_calculata', 'perete_mm', 'diametru_mm', 'lot', 'aviz_intrare_id', 'nr_crt_aviz', 'bend_no', 'capat_marcaj', 'depozit_id', 'tronson_id']::text[] || ARRAY['id','uid','radacina_id','server_ver','created_at','updated_at']) x)
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '')
        IS DISTINCT FROM ARRAY['lungime_cm','serie_canon']
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['tip', 'proiect_id', 'document_tip', 'document_id', 'import_id', 'storno_de_eveniment_id', 'motiv', 'declarat_de', 'aplicat_de', 'aplicat_rol', 'ora_tableta', 'dispozitiv_id']::text[] || ARRAY['id','server_ver','ora_server']) x)
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY['eveniment_id', 'proiect_id', 'bucata_id', 'rol', 'stare_inainte', 'stare_dupa', 'din_loc', 'in_loc', 'lungime_mm', 'inainte', 'dupa']::text[] || ARRAY['id','server_ver']) x) THEN
    RAISE EXCEPTION 'Precondiție 0e: coloanele registrului (magazie_bucati / evenimente / mișcări) diferă de lista revizuită (C)';
  END IF;
  -- preflight LIVE înainte de FK-ul aviz_intrare_id (Copilot r4 P2-4): nicio bucată nu are deja document de intrare
  IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE aviz_intrare_id IS NOT NULL OR nr_crt_aviz IS NOT NULL) THEN
    RAISE EXCEPTION 'Precondiție 0f: există bucăți cu aviz_intrare_id / nr_crt_aviz completat (% rânduri) — FK-ul nu se poate adăuga fără decizie',
      (SELECT count(*) FROM public.magazie_bucati WHERE aviz_intrare_id IS NOT NULL OR nr_crt_aviz IS NOT NULL);
  END IF;
  -- unicitatea țevii / curbei = indexurile E2a, exact (§7.1)
  IF pg_get_indexdef('public.ux_magbuc_izo_radacina'::regclass) IS DISTINCT FROM
       'CREATE UNIQUE INDEX ux_magbuc_izo_radacina ON public.magazie_bucati USING btree (serie_canon, dezambiguare) NULLS NOT DISTINCT WHERE ((provenienta = ''beneficiar''::text) AND (tip_cod = ''teava''::text) AND (parinte_id IS NULL) AND (stare <> ''anulata''::text))'
     OR pg_get_indexdef('public.ux_magbuc_izo_curba'::regclass) IS DISTINCT FROM
       'CREATE UNIQUE INDEX ux_magbuc_izo_curba ON public.magazie_bucati USING btree (serie_canon, sarja, unghi_curba, cod_bucata) NULLS NOT DISTINCT WHERE ((provenienta = ''beneficiar''::text) AND (tip_cod = ''curba''::text) AND (stare <> ''anulata''::text))' THEN
    RAISE EXCEPTION 'Precondiție 0g: indexurile de unicitate ale registrului diferă de definiția E2a';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.magazie_bucati_evenimente'::regclass AND conname = 'magazie_bucati_evenimente_tip_check'))
     IS DISTINCT FROM 'CHECK ((tip = ANY (ARRAY[''sold_initial''::text, ''intrare_aviz''::text, ''gasit''::text, ''iesire_tranzit''::text, ''livrare''::text, ''retur_fizic''::text, ''confirmare_primire_depozit''::text, ''mutare_tronson''::text, ''taiere''::text, ''montaj''::text, ''demontaj''::text, ''deseu''::text, ''pierdut''::text, ''inventar_ajustare''::text, ''corectie''::text, ''corectie_radacina''::text, ''storno''::text])))' THEN
    RAISE EXCEPTION 'Precondiție 0h: CHECK-ul tipurilor de eveniment diferă de E2a';
  END IF;
  -- dependențele de autorizare / platformă
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'user_module_access' AND indexname = 'user_module_access_profile_id_module_key')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'prevent_role_escalation_trigger' AND tgenabled <> 'D')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only' AND tgenabled <> 'D')
     OR to_regprocedure('auth.role()') IS NULL OR to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'logistica_depozite' AND column_name = 'activ') THEN
    RAISE EXCEPTION 'Precondiție 0i: lipsește o dependență E3 (user_module_access unic / trigger-ele profiles / auth.role / storage / depozite.activ)';
  END IF;
  -- r5f (#825 NO-GO, P1-3/P1-4): baseline-ul EXTERN pre-E3 = amprenta REVIZUITĂ (capturată read-only de pe prod, în
  -- scripts/izometrie/e3_gen/baseline_pre_e3.json), nu starea găsită aici (fără TOFU): storage.objects / storage.buckets
  -- (owner, RLS, FORCE, ACL fără MAINTAIN, TOATE politicile) + trigger-ele profiles (definiția completă, starea) și funcțiile
  -- lor (owner, DEFINER, config, volatilitate, corp). Orice diferență → refuz, cu lista; baseline nou = captură nouă revizuită.
  v_baza := jsonb_build_object(
      'relatii', (SELECT coalesce(jsonb_object_agg(n.nspname || '.' || c.relname, md5(concat_ws(':', pg_get_userbyid(c.relowner), c.relrowsecurity,
                    c.relforcerowsecurity, (SELECT coalesce(string_agg(q.x, ',' ORDER BY q.x COLLATE "C"), '')
                      FROM (SELECT format('%s>%s:%s:%s', CASE WHEN a.grantor = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantor) END,
                                          CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type, a.is_grantable) AS x
                              FROM aclexplode(c.relacl) a WHERE a.privilege_type <> 'MAINTAIN') q)))), '{}')
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE (n.nspname, c.relname) IN (('storage', 'objects'), ('storage', 'buckets'))),
      'politici', (SELECT coalesce(jsonb_object_agg(n.nspname || '.' || c.relname || '.' || p.polname, md5(concat_ws(':', p.polcmd, p.polpermissive,
                     (SELECT string_agg(r.x, ',' ORDER BY r.x COLLATE "C")
                        FROM (SELECT CASE WHEN o = 0 THEN 'public' ELSE pg_get_userbyid(o) END AS x FROM unnest(p.polroles) o) r),
                     coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')))), '{}')
                     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE (n.nspname, c.relname) IN (('storage', 'objects'), ('storage', 'buckets'))),
      'triggere', (SELECT coalesce(jsonb_object_agg(n2.nspname || '.' || c2.relname || '.' || g.tgname,
                     md5(concat_ws(':', pg_get_triggerdef(g.oid, false), g.tgenabled))), '{}')
                     FROM pg_trigger g JOIN pg_class c2 ON c2.oid = g.tgrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace WHERE n2.nspname = 'public' AND c2.relname = 'profiles' AND g.tgname IN ('prevent_role_escalation_trigger', 'trg_profiles_campuri_owner_only')),
      'functii', (SELECT coalesce(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                    md5(concat_ws(':', pg_get_userbyid(p.proowner), p.prosecdef, coalesce(p.proconfig::text, ''), p.provolatile, md5(p.prosrc)))), '{}')
                    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE p.oid IN (SELECT g.tgfoid FROM pg_trigger g JOIN pg_class c2 ON c2.oid = g.tgrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
                                    WHERE n2.nspname = 'public' AND c2.relname = 'profiles' AND g.tgname IN ('prevent_role_escalation_trigger', 'trg_profiles_campuri_owner_only'))));
  v_baza_rev := '
    {
      "functii": {
        "public.fn_profiles_campuri_owner_only()": "62a2d9ea92c104946d0008b25a369dd6",
        "public.prevent_role_escalation()": "6cc283295b6cf8ab80d6fcd468922137"
      },
      "politici": {
        "storage.objects.Authenticated can delete documente-flota": "5f9297cc6274dcc7277c55fe1b6e42e2",
        "storage.objects.Authenticated can read documente-flota": "39047ab0bf0ea334aaf99661b25317c9",
        "storage.objects.Authenticated can update documente-flota": "f06faa0729e08714ad7c7fee2709fd1e",
        "storage.objects.Authenticated can upload documente-flota": "3974712202f7df33f19b6a8ab1cbd2b1",
        "storage.objects.Pontaj brut delete owner": "37577ce853870a5cce29dd48dbe676b4",
        "storage.objects.Pontaj brut insert authorized": "dd86ba37b01110315fce80449a5ae55c",
        "storage.objects.Pontaj brut select authorized": "689051a6c8d9f0647356fbb52c1775c7",
        "storage.objects.Pontaj net delete owner": "67f1c7aa8452a828e79aa7f6b4149c35",
        "storage.objects.Pontaj net insert authorized": "288824684f3a8fe279c6e43343cd5c41",
        "storage.objects.Pontaj net select authorized": "0b5733e6cdc3860690872df655936dd9",
        "storage.objects.Supliment hrana delete owner": "e001b1aa169f6409b2d1312360a0fe62",
        "storage.objects.Supliment hrana insert authorized": "1c6362c49451cda18205205e0e0119bc",
        "storage.objects.Supliment hrana select authorized": "acef98ecce0e7dcddd0e20489a54f14a",
        "storage.objects.ai_inbox_obj_all": "a9574d5dac3b0b33bcb36182703aa8d0",
        "storage.objects.autorizatii_delete": "8373e7dbea5230e3ba0b865cdba55f66",
        "storage.objects.autorizatii_read": "3b164f3bd8028356eafdc2d8e665829a",
        "storage.objects.autorizatii_write": "3f6831267eb966292336e7df810dd306",
        "storage.objects.avize_authenticated_insert": "5bcbf1c6da49f81eb6fdd1d53b11dcc6",
        "storage.objects.avize_authenticated_read": "a46edbf45465e1ab84bfbb8d03f6f339",
        "storage.objects.cf_storage_delete": "9b7817911ef56799514d80042ae92e95",
        "storage.objects.cf_storage_insert": "4278d9c807474fd2b0dcb08df1603621",
        "storage.objects.cf_storage_select": "81e1b7bf36fc1a99c089d9dafe3d3d0b",
        "storage.objects.chat_imagini_read": "672f8008070f86c16185858d6c865713",
        "storage.objects.chat_imagini_upload": "3788ba9c46d155771369818ebc72d21b",
        "storage.objects.contracte_comodat_delete": "e91090c8ca3ecc83b760dbfc35f067ad",
        "storage.objects.contracte_comodat_insert": "eaf9755d31d4e7d0ddb459f94f9ea4a2",
        "storage.objects.contracte_comodat_select": "eee304a60d84f6c4da7fb5adab5ad217",
        "storage.objects.contracte_comodat_update": "04f2bbedee03f9c80b5540de23b6493d",
        "storage.objects.contracte_terti_storage_delete": "1d2ea1ee68e40d959d26081616825e66",
        "storage.objects.contracte_terti_storage_insert": "c8cfde174404c6937865e9e702d9539f",
        "storage.objects.contracte_terti_storage_select": "28eb2477865f3dbe9e59c863d0ae078a",
        "storage.objects.contracte_terti_storage_update": "1c403b429f0f66bd77e958fea7e733b9",
        "storage.objects.ctc_storage_delete": "db4b71adc3e214f49e4ad9b00d13bccd",
        "storage.objects.ctc_storage_insert": "88a074bfc242f0238719692ac3184c58",
        "storage.objects.ctc_storage_select": "1dfa4fbcf6bcd547d87b257f6e5f4415",
        "storage.objects.ctc_storage_update": "f55b14f6376f46533082f5ca7568d723",
        "storage.objects.documente_firma_storage_delete": "977d7918e86aec27ed895339afa902f7",
        "storage.objects.documente_firma_storage_insert": "f67001f218467559016ab90865812e91",
        "storage.objects.documente_firma_storage_select": "e542ec7b3a27e9ec9c3c4e036b4587ca",
        "storage.objects.documente_firma_storage_update": "ec5fc6d3e404b72dc695de33599502c3",
        "storage.objects.documente_personal_delete": "58418bea0c6a556ee3fb2d8516b0d806",
        "storage.objects.documente_personal_insert": "f1f9ed8bacf1a20022b57d7826df9dfb",
        "storage.objects.documente_personal_select": "06a25984522e71b620d981af55b7531d",
        "storage.objects.documente_personal_update": "9bc598af29056edd4192c54b1c5d48ec",
        "storage.objects.documente_proiect_storage_read": "f3f6f1db042a2d5a0d948aa0bbdb5bc9",
        "storage.objects.edc_storage_delete": "9091b4991d963f57076ace9a218a5b64",
        "storage.objects.edc_storage_insert": "3af6ee07e25b8fa43a880a03619525fe",
        "storage.objects.edc_storage_select": "f51907d68adfae5aedcbfba361d53ccc",
        "storage.objects.edc_storage_update": "26419d886b0ed9d7047fb648656621e0",
        "storage.objects.executie_borderouri_delete": "0d10d7901ea2b5adda6f50e6323194f0",
        "storage.objects.executie_borderouri_insert": "b6bb00e6d8c7d8055026e01d60ad89f1",
        "storage.objects.executie_borderouri_select": "a7a4cc303cf82f1314608c21e296b0a8",
        "storage.objects.executie_borderouri_update": "95fec62464867485661f2dfb5940a219",
        "storage.objects.executie_pachete_pdf_delete": "3aa4ea03a7c05b220c1e64f7b6367f77",
        "storage.objects.executie_pachete_pdf_insert": "3a74dd917cc1cfd5b7ae1606fdc8f0db",
        "storage.objects.executie_pachete_pdf_select": "c5bf595022753fa684f2395d695d3ece",
        "storage.objects.executie_pachete_pdf_update": "42e276ff3a0fdd7a39552d0b8c0f0758",
        "storage.objects.facturi_storage_delete": "689a3ce408a407fe143c4530bb90c2f6",
        "storage.objects.facturi_storage_insert": "cc3f01faaeb97f19a0941e4ae250a482",
        "storage.objects.facturi_storage_select": "0b81cfbb9fb10081c97ec6c11918b14f",
        "storage.objects.facturi_storage_update": "db4c0f5506c25f00766f21672b3b068c",
        "storage.objects.hr_decizii_storage_insert": "50652fe76f28402e4f86a4d594f0beee",
        "storage.objects.hr_decizii_storage_select": "ee02dc9986cdfb8723d84a1a1cecef4f",
        "storage.objects.hr_semnaturi_delete": "44b88c693a730ac594b516820ed0384e",
        "storage.objects.hr_semnaturi_insert": "289e1a171db219d2e36e02bd32ed4cc3",
        "storage.objects.hr_semnaturi_select": "e33b7f5eb41eb7b8b3212c0921424eaa",
        "storage.objects.hr_semnaturi_self_insert": "43e28952b73f515a751fb222bb02e9a0",
        "storage.objects.hr_semnaturi_self_select": "45f07e72655a65d5147dd882db48a86b",
        "storage.objects.hr_semnaturi_update": "3ecdb91ee0a2c277588a63bf0e6ea6cb",
        "storage.objects.ofertare_storage_del": "628d7e7210b2e4526a4d1979783f92f9",
        "storage.objects.ofertare_storage_ins": "f616de6a0aba7da36f5ca05079b1c8c2",
        "storage.objects.ofertare_storage_sel": "06db92ceef336b1b3d9051b74d41a818",
        "storage.objects.ofertare_storage_upd": "4cb32c03ead06d6e7e186b97e3fb2051",
        "storage.objects.ordine_deplasare_delete": "1a718ab2417437d9e8684ad4a4c4dd7f",
        "storage.objects.ordine_deplasare_insert": "0414f0c8a072a2ce572546b66dfa6683",
        "storage.objects.ordine_deplasare_select": "337901cd700108cb690493041a27aa2b",
        "storage.objects.ordine_deplasare_update": "923c2b96bfecd7c7d4d23dc31563a55b",
        "storage.objects.pl_packing_del": "45942bf822bb02aaba56f0e83a5208aa",
        "storage.objects.pl_packing_ins": "61ea4c79cf4a86d522b8a636695d19a9",
        "storage.objects.pl_packing_sel": "4998e54b20eea1c85880ab7cb35d5ef2",
        "storage.objects.pl_packing_upd": "d9997b6f6dab73cf01e8ce13af4ebc9d",
        "storage.objects.probe_citiri_delete": "e739bbb6fe6b6309f75a376a0e013c07",
        "storage.objects.probe_citiri_insert": "02954b04ded38c8490497cac6ae5c985",
        "storage.objects.probe_citiri_select": "4f1e0304d7a5c4d36e455f2a2a7958f0",
        "storage.objects.productie_storage_rw": "1be29896c86a6067675f6da59c7210a5",
        "storage.objects.qr_bonuri_delete_owner": "784c03a727165d48cdf3661d6561d385",
        "storage.objects.qr_bonuri_insert_auth": "e509e95f76e5d92593b38f596814fd57",
        "storage.objects.qr_bonuri_select_auth": "eea3b5519d3c4083e43b5829592b804e",
        "storage.objects.rapoarte_obj_all": "62bd86c6c25f4900c0cc634be168c4a6",
        "storage.objects.recrutare_cv_select_hr": "b6f445862a8f1f12e20f0bf04fef919b",
        "storage.objects.sedinte_pdf_insert": "85d9ef466b6b52e15d25c5672979f576",
        "storage.objects.sedinte_pdf_select": "4779537c5f62676f987df37ed117e541",
        "storage.objects.sedinte_pdf_update": "befc0ad1ccced466ad091f5f5203468f",
        "storage.objects.service_fise_doc_delete": "153d56a69df3015e289b10e342078e55",
        "storage.objects.service_fise_doc_insert": "498ebe3d33e8ca0f3835e286e1124e63",
        "storage.objects.service_fise_doc_select": "215c1fc5f9a2ae499d3c3b6754f21eee",
        "storage.objects.service_fise_doc_update": "91356edbbcb368f696ee5f6f829ad769",
        "storage.objects.templates_delete": "c2177d3e36091cd59d5659552b999569",
        "storage.objects.templates_insert": "21f2ecfd93c0a3a51da84b920b3e27c2",
        "storage.objects.templates_select": "b402036773324d2c777eda07501a0a56",
        "storage.objects.templates_update": "7518c54632862144b956bc575ae83fe1",
        "storage.objects.tichete_storage_delete_own": "e9338ba592143158313cea0322021914",
        "storage.objects.tichete_storage_insert": "d40e5f14f909107e4e93d8e9d02688d4",
        "storage.objects.tichete_storage_select": "1a6c8c0c6089b50bbf5ad6cf072d3899",
        "storage.objects.tts_audio_inchis": "08a994c4a7d396a2d95e17ef265f70b4",
        "storage.objects.upa docs authenticated all": "6c01841a6c4ee32bc00013b19d4bed53",
        "storage.objects.whatsapp_bonuri_delete_owner_only": "89597ea8d4e2155fc6dc9cd873ed5cae",
        "storage.objects.whatsapp_bonuri_insert_owner_or_admin_logistica": "8fac387cb6b8957f722fb61bfb67429a",
        "storage.objects.whatsapp_bonuri_select_owner_or_admin_logistica": "a975ce8e7ded29d03b0166f1af977325",
        "storage.objects.whatsapp_bonuri_update_owner_or_admin_logistica": "52f4fc58ef0dfec338ec2f75a08d52e1"
      },
      "relatii": {
        "storage.buckets": "6e2ace025a5c2acef6f1e4c1f4d7e9de",
        "storage.objects": "6e2ace025a5c2acef6f1e4c1f4d7e9de"
      },
      "triggere": {
        "public.profiles.prevent_role_escalation_trigger": "fdf263e29e9c3ec0bf0a00fb53a410b6",
        "public.profiles.trg_profiles_campuri_owner_only": "0926bbf3c21b67a0eee65dea64992a08"
      }
    }
  '::jsonb;
  IF v_baza IS DISTINCT FROM v_baza_rev THEN
    SELECT string_agg(format('%s/%s: %s', d.k, d.cheie, d.stare), '; ' ORDER BY d.k, d.cheie) INTO v_x
      FROM (SELECT c.k, e.cheie, CASE WHEN NOT coalesce(v_baza -> c.k, '{}') ? e.cheie THEN 'lipsește'
                                      WHEN NOT coalesce(v_baza_rev -> c.k, '{}') ? e.cheie THEN 'în plus' ELSE 'diferă' END AS stare
              FROM unnest(ARRAY['relatii', 'politici', 'triggere', 'functii']) c(k),
                   LATERAL (SELECT jsonb_object_keys(coalesce(v_baza -> c.k, '{}')) UNION SELECT jsonb_object_keys(coalesce(v_baza_rev -> c.k, '{}'))) e(cheie)
             WHERE (v_baza -> c.k -> e.cheie) IS DISTINCT FROM (v_baza_rev -> c.k -> e.cheie)) d;
    RAISE EXCEPTION 'Precondiție 0l: baseline-ul Storage / profiles diferă de amprenta pre-E3 revizuită (captură nouă + review): %', coalesce(v_x, '?');
  END IF;
  -- porțile E2a complete și amprenta de revenire consistentă înainte (o rulăm o dată, aici: ~8,5 s pe prod)
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN
    RAISE EXCEPTION 'Precondiție 0j: porțile E2a nu sunt complete: %', v_lipsa;
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
    RAISE EXCEPTION 'Precondiție 0k: amprenta de revenire E2a diferă de COMMENT (acum %, scrisă %)', v_amprenta, v_scrisa;
  END IF;
  v_inainte := v_amprenta;
  v_comentariu := obj_description('public.magazie_bucati_evenimente'::regclass, 'pg_class');   -- refăcut exact de revenire

  -- ── A. rolurile ───────────────────────────────────────────────────────────────────────────────────────
  CREATE ROLE izo_doc_editor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  CREATE ROLE izo_receptie_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  GRANT izo_doc_editor TO postgres WITH INHERIT FALSE, SET TRUE;
  GRANT izo_receptie_writer TO postgres WITH INHERIT FALSE, SET TRUE;
  GRANT USAGE ON SCHEMA public TO izo_doc_editor, izo_receptie_writer;
  GRANT CREATE ON SCHEMA public TO izo_doc_editor, izo_receptie_writer;   -- doar pentru ALTER FUNCTION … OWNER; retras mai jos

  -- ── B. tabelele documentelor ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE public.izo_documente_intrare (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proiect_id    bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    depozit_id    integer NOT NULL REFERENCES public.logistica_depozite(id) ON DELETE RESTRICT,
    sablon        text NOT NULL CHECK (sablon IN ('aviz_teava', 'lista_ambalare_curbe')),
    furnizor      text NOT NULL CHECK (char_length(btrim(furnizor)) BETWEEN 1 AND 200),
    furnizor_canon text GENERATED ALWAYS AS (upper(regexp_replace(btrim(furnizor), '[[:space:]]+', ' ', 'g'))) STORED,
    furnizor_cif  text CHECK (furnizor_cif IS NULL OR char_length(furnizor_cif) <= 40),
    nr_document   text NOT NULL CHECK (char_length(btrim(nr_document)) BETWEEN 1 AND 80),
    nr_document_canon text GENERATED ALWAYS AS (upper(regexp_replace(nr_document, '[[:space:]]', '', 'g'))) STORED,
    data_document date NOT NULL,
    inlocuieste_document_id bigint UNIQUE REFERENCES public.izo_documente_intrare(id) ON DELETE RESTRICT,
    motiv_inlocuire text CHECK (motiv_inlocuire IS NULL OR char_length(btrim(motiv_inlocuire)) BETWEEN 3 AND 1000),
    cumparator text, transport_nr text, nume_proiect text, lot text, loc_livrare text, data_incarcare date, data_descarcare date, nr_camion text,
    factura text, importator text, destinatar text, referinta_client text, referinta_furnizor text, placa_camion_container text,
    total_m       numeric(12,3) CHECK (total_m IS NULL OR total_m >= 0),
    total_kg      numeric(12,1) CHECK (total_kg IS NULL OR total_kg >= 0),
    total_bucati  integer CHECK (total_bucati IS NULL OR total_bucati >= 0),
    total_pachete integer CHECK (total_pachete IS NULL OR total_pachete >= 0),
    total_net_kg  numeric(12,1) CHECK (total_net_kg IS NULL OR total_net_kg >= 0),
    total_brut_kg numeric(12,1) CHECK (total_brut_kg IS NULL OR total_brut_kg >= 0),
    observatii    text CHECK (observatii IS NULL OR char_length(observatii) <= 2000),
    stare         text NOT NULL DEFAULT 'draft' CHECK (stare IN ('draft', 'confirmat', 'anulat')),
    versiune      bigint NOT NULL DEFAULT 1 CHECK (versiune >= 1),
    hash_confirmat text CHECK (hash_confirmat IS NULL OR hash_confirmat ~ '^e3-doc-v1:[0-9a-f]{64}$'),
    avertismente  jsonb,
    confirmat_de  uuid, confirmat_la timestamptz,
    eveniment_intrare_id bigint UNIQUE REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    pv_nr         text CHECK (pv_nr IS NULL OR char_length(btrim(pv_nr)) BETWEEN 1 AND 80),
    pv_nr_canon   text, pv_data date, pv_pus_de uuid, pv_pus_la timestamptz,
    eveniment_pv_id bigint UNIQUE REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    anulat_de     uuid, anulat_de_rol text, anulat_la timestamptz,
    anulat_motiv  text CHECK (anulat_motiv IS NULL OR char_length(btrim(anulat_motiv)) BETWEEN 3 AND 1000),
    eveniment_storno_intrare_id bigint UNIQUE REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    eveniment_storno_pv_id      bigint UNIQUE REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    creat_de      uuid,
    creat_la      timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT izo_doc_inlocuieste_alt CHECK (inlocuieste_document_id IS DISTINCT FROM id),
    -- r5d §13.4: înlocuirea are motiv; identitatea / proiectul pot diferi
    CONSTRAINT izo_doc_inlocuire_cu_motiv CHECK ((inlocuieste_document_id IS NULL) = (motiv_inlocuire IS NULL)),
    CONSTRAINT izo_doc_draft_gol CHECK (stare <> 'draft' OR num_nonnulls(hash_confirmat, confirmat_la, eveniment_intrare_id, pv_nr, pv_data,
      pv_pus_la, eveniment_pv_id, anulat_de, anulat_de_rol, anulat_la, anulat_motiv, eveniment_storno_intrare_id, eveniment_storno_pv_id) = 0),
    CONSTRAINT izo_doc_confirmat_complet CHECK (stare <> 'confirmat' OR (hash_confirmat IS NOT NULL AND confirmat_la IS NOT NULL
      AND eveniment_intrare_id IS NOT NULL AND num_nonnulls(anulat_de, anulat_de_rol, anulat_la, anulat_motiv) = 0)),
    CONSTRAINT izo_doc_pv_tot_sau_nimic CHECK (num_nonnulls(pv_nr, pv_nr_canon, pv_data, pv_pus_la, eveniment_pv_id) IN (0, 5)),
    CONSTRAINT izo_doc_pv_dupa_intrare CHECK (eveniment_pv_id IS NULL OR eveniment_intrare_id IS NOT NULL),
    CONSTRAINT izo_doc_anulat_complet CHECK (stare <> 'anulat' OR (anulat_de_rol IS NOT NULL AND anulat_la IS NOT NULL AND anulat_motiv IS NOT NULL)),
    CONSTRAINT izo_doc_storno_intrare CHECK ((eveniment_storno_intrare_id IS NOT NULL) = (eveniment_intrare_id IS NOT NULL AND stare = 'anulat')),
    CONSTRAINT izo_doc_storno_pv CHECK ((eveniment_storno_pv_id IS NOT NULL) = (eveniment_pv_id IS NOT NULL AND stare = 'anulat'))
  );
  -- un singur document VIU per identitate; după anulare identitatea se eliberează (r4)
  CREATE UNIQUE INDEX ux_izo_doc_identitate ON public.izo_documente_intrare (furnizor_canon, nr_document_canon, data_document)
    WHERE stare <> 'anulat';
  CREATE INDEX ix_izo_doc_proiect ON public.izo_documente_intrare (proiect_id, id);

  CREATE TABLE public.izo_documente_intrare_randuri (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id   bigint NOT NULL REFERENCES public.izo_documente_intrare(id) ON DELETE RESTRICT,
    nr_crt        integer NOT NULL CHECK (nr_crt BETWEEN 1 AND 10000),
    serie         text NOT NULL CHECK (char_length(btrim(serie)) BETWEEN 1 AND 60),
    sarja         text CHECK (sarja IS NULL OR char_length(sarja) <= 60),
    lot           text CHECK (lot IS NULL OR char_length(lot) <= 60),
    specificatie  text CHECK (specificatie IS NULL OR char_length(specificatie) <= 300),
    dimensiune    text CHECK (dimensiune IS NULL OR char_length(dimensiune) <= 100),
    grad_otel     text CHECK (grad_otel IS NULL OR char_length(grad_otel) <= 40),
    standard      text CHECK (standard IS NULL OR char_length(standard) <= 100),
    izolatie      text CHECK (izolatie IS NULL OR izolatie IN ('neizolata', 'PEHD', 'GRP')),
    diametru_mm   integer CHECK (diametru_mm IS NULL OR diametru_mm BETWEEN 10 AND 2000),
    perete_mm     numeric(4,1) CHECK (perete_mm IS NULL OR perete_mm BETWEEN 3 AND 40),
    greutate_kg   numeric(10,1) CHECK (greutate_kg IS NULL OR greutate_kg >= 0),
    lungime_doc_mm      integer CHECK (lungime_doc_mm IS NULL OR lungime_doc_mm BETWEEN 1 AND 30000),
    lungime_masurata_mm integer CHECK (lungime_masurata_mm IS NULL OR lungime_masurata_mm BETWEEN 1 AND 30000),
    cod           text CHECK (cod IS NULL OR char_length(cod) <= 120),
    item          text CHECK (item IS NULL OR char_length(item) <= 60),
    unghi_doc     numeric(4,1) CHECK (unghi_doc IS NULL OR (unghi_doc > 0 AND unghi_doc <= 90)),
    unghi_masurat numeric(4,1) CHECK (unghi_masurat IS NULL OR (unghi_masurat > 0 AND unghi_masurat <= 90)),
    -- r5f (#825 NO-GO): 1 rând = 1 bucată (confirmarea naște exact una pe rând) → cantitatea e goală (= 1) sau 1
    cantitate     integer CONSTRAINT izo_doc_rand_o_bucata CHECK (cantitate IS NULL OR cantitate = 1),
    pachet_nr     text CHECK (pachet_nr IS NULL OR char_length(pachet_nr) <= 40),
    dimensiuni_cm text CHECK (dimensiuni_cm IS NULL OR char_length(dimensiuni_cm) <= 60),
    net_kg        numeric(10,1) CHECK (net_kg IS NULL OR net_kg >= 0),
    brut_kg       numeric(10,1) CHECK (brut_kg IS NULL OR brut_kg >= 0),
    decizie       text NOT NULL DEFAULT 'primit' CHECK (decizie IN ('primit', 'refuzat_la_receptie', 'primit_neconform')),
    motiv         text CHECK (motiv IS NULL OR char_length(motiv) <= 1000),
    observatie    text CHECK (observatie IS NULL OR char_length(observatie) <= 1000),
    bucata_id     bigint UNIQUE REFERENCES public.magazie_bucati(id) ON DELETE RESTRICT,
    CONSTRAINT izo_doc_rand_nr_unic UNIQUE (document_id, nr_crt),
    CONSTRAINT izo_doc_rand_refuzat_fara_bucata CHECK (decizie <> 'refuzat_la_receptie' OR bucata_id IS NULL)
  );

  CREATE TABLE public.izo_documente_scanuri (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id   bigint NOT NULL REFERENCES public.izo_documente_intrare(id) ON DELETE RESTRICT,
    cale          text NOT NULL UNIQUE CHECK (cale ~ '^[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'),
    sha256_original text NOT NULL CHECK (sha256_original ~ '^[0-9a-f]{64}$'),
    sha256_pdf    text NOT NULL CHECK (sha256_pdf ~ '^[0-9a-f]{64}$'),
    marime        bigint NOT NULL CHECK (marime BETWEEN 1 AND 10485760),
    mime          text NOT NULL CHECK (mime = 'application/pdf'),
    adaugat_la    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT izo_doc_scan_cale_document CHECK (split_part(cale, '/', 1) = document_id::text)
  );
  CREATE INDEX ix_izo_doc_scan_document ON public.izo_documente_scanuri (document_id);

  -- ── C. registrul: FK, index, tipuri de eveniment ──────────────────────────────────────────────────────
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_aviz_fkey
    FOREIGN KEY (aviz_intrare_id) REFERENCES public.izo_documente_intrare(id) ON DELETE RESTRICT;
  CREATE UNIQUE INDEX ux_magbuc_izo_aviz_rand ON public.magazie_bucati (aviz_intrare_id, nr_crt_aviz)
    WHERE aviz_intrare_id IS NOT NULL AND stare <> 'anulata';
  ALTER TABLE public.magazie_bucati_evenimente DROP CONSTRAINT magazie_bucati_evenimente_tip_check;
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN ('sold_initial', 'intrare_aviz', 'gasit', 'iesire_tranzit', 'livrare', 'retur_fizic', 'confirmare_primire_depozit', 'mutare_tronson', 'taiere', 'montaj', 'demontaj', 'deseu', 'pierdut', 'inventar_ajustare', 'corectie', 'corectie_radacina', 'storno', 'intrare_lista_ambalare', 'receptie_pv'));
  CREATE UNIQUE INDEX ux_magbuc_ev_doc_intrare ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'doc_intrare' AND tip IN ('intrare_aviz', 'intrare_lista_ambalare');
  CREATE UNIQUE INDEX ux_magbuc_ev_doc_pv ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'doc_intrare' AND tip = 'receptie_pv';

  -- ── D. ajutătoare (owner postgres) ────────────────────────────────────────────────────────────────────
  -- constantele revizuite: C (coloanele comparate ale bucății), coloanele comparate ale evenimentului și ale mișcării
  CREATE FUNCTION public.fn_izo_coloane_c() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ SELECT ARRAY['proiect_id', 'comanda_furnizor_id', 'tip_material_id', 'serie', 'sarja', 'dimensiune', 'grad_otel', 'standard', 'lungime_m', 'lungime_originala_m', 'greutate_kg', 'unghi_curba', 'cantitate', 'um', 'provenienta', 'izolatie', 'furnizor', 'producator', 'sursa_receptie', 'fara_packing_list', 'nr_document', 'data_receptie', 'mtc_path', 'stare', 'locatie_tip', 'locatie_site_id', 'executie_teava_id', 'atribute', 'observatii', 'receptionat_de', 'receptionat_la', 'created_by', 'tip_cod', 'parinte_id', 'cod_bucata', 'capat_stanga', 'capat_dreapta', 'dezambiguare', 'lungime_aviz_mm', 'lungime_masurata_mm', 'lungime_mm', 'lungime_calculata', 'perete_mm', 'diametru_mm', 'lot', 'aviz_intrare_id', 'nr_crt_aviz', 'bend_no', 'capat_marcaj', 'depozit_id', 'tronson_id']::text[] $f$;
  CREATE FUNCTION public.fn_izo_coloane_ev() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ SELECT ARRAY['tip', 'proiect_id', 'document_tip', 'document_id', 'import_id', 'storno_de_eveniment_id', 'motiv', 'declarat_de', 'aplicat_de', 'aplicat_rol', 'ora_tableta', 'dispozitiv_id']::text[] $f$;
  CREATE FUNCTION public.fn_izo_coloane_mis() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ SELECT ARRAY['eveniment_id', 'proiect_id', 'bucata_id', 'rol', 'stare_inainte', 'stare_dupa', 'din_loc', 'in_loc', 'lungime_mm', 'inainte', 'dupa']::text[] $f$;
  -- proiecția: exact cheile date, fiecare o dată, cu null JSON pentru lipsă / NULL
  CREATE FUNCTION public.fn_izo_proiectie(p jsonb, p_chei text[]) RETURNS jsonb
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT coalesce(jsonb_object_agg(k, coalesce(p -> k, 'null'::jsonb)), '{}'::jsonb) FROM unnest(p_chei) k
  $f$;
  CREATE FUNCTION public.fn_izo_jwt_rol() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT auth.role() $f$;
  CREATE FUNCTION public.fn_izo_canon_serie(p text) RETURNS text
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE upper(regexp_replace(p, '[[:space:]._/-]', '', 'g')) END
  $f$;

  -- autorizarea sub lock (§3.4): profil → acces modul → atribuire, toate FOR SHARE, condiția de drept în WHERE (EPQ)
  CREATE FUNCTION public.fn_izo_doc_autorizare_lock(p_proiect bigint, p_depozit integer) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid := auth.uid(); v_owner boolean;
  BEGIN
    IF v_uid IS NULL OR p_proiect IS NULL OR p_depozit IS NULL THEN RETURN false; END IF;
    SELECT p.is_owner INTO v_owner FROM public.profiles p WHERE p.id = v_uid FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_owner IS TRUE THEN RETURN true; END IF;
    PERFORM 1 FROM public.user_module_access u
      WHERE u.profile_id = v_uid AND u.module = 'magazie' AND u.access_level IN ('editor', 'admin') FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM 1 FROM public.izo_atribuiri a
      WHERE a.proiect_id = p_proiect AND a.profile_id = v_uid AND a.rol = 'gestionar' AND a.depozit_id = p_depozit AND a.activ
        AND current_date BETWEEN a.valabil_de AND coalesce(a.valabil_pana, current_date) FOR SHARE;
    RETURN FOUND;
  END $f$;

  -- Storage: existența obiectului; încărcarea / citirea / ștergerea (politicile bucket-ului izo-documente)
  CREATE FUNCTION public.fn_izo_scan_exista(p_cale text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'izo-documente' AND o.name = p_cale)
  $f$;
  CREATE FUNCTION public.fn_izo_scan_poate_incarca(p_name text) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d record;
  BEGIN
    IF p_name IS NULL OR p_name !~ '^[0-9]{1,18}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$' THEN RETURN false; END IF;
    SELECT x.id, x.proiect_id, x.depozit_id, x.stare INTO d FROM public.izo_documente_intrare x
     WHERE x.id = split_part(p_name, '/', 1)::bigint FOR SHARE;
    IF NOT FOUND OR d.stare <> 'draft' THEN RETURN false; END IF;
    RETURN public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id);
  END $f$;
  CREATE FUNCTION public.fn_izo_scan_poate_citi(p_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT p_name ~ '^[0-9]{1,18}/' AND EXISTS (SELECT 1 FROM public.izo_documente_intrare x
      WHERE x.id = split_part(p_name, '/', 1)::bigint AND public.fn_izo_citire(x.proiect_id))
  $f$;
  -- §6.1: un obiect din manifest nu se șterge NICIODATĂ; altfel doar pe draft, de cine e autorizat; documentul FOR SHARE
  -- (serializează ștergerea cu salvarea / confirmarea, care iau FOR UPDATE)
  CREATE FUNCTION public.fn_izo_scan_poate_sterge(p_name text) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d record;
  BEGIN
    IF p_name IS NULL OR p_name !~ '^[0-9]{1,18}/' THEN RETURN false; END IF;
    SELECT x.id, x.proiect_id, x.depozit_id, x.stare INTO d FROM public.izo_documente_intrare x
     WHERE x.id = split_part(p_name, '/', 1)::bigint FOR SHARE;
    IF NOT FOUND OR d.stare <> 'draft' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM public.izo_documente_scanuri s WHERE s.cale = p_name) THEN RETURN false; END IF;
    RETURN public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id);
  END $f$;

  -- hash-ul canonic e3-doc-v1 (§6): conținutul complet (antet, rânduri după nr_crt, manifestul după cale), fără versiune.
  -- r5f (#825 NO-GO): motiv_inlocuire intră în antet (câmp auditabil al înlocuirii); eticheta rămâne v1 — niciun hash v1
  -- nu a fost emis / persistat înainte (20261103b neaplicată nicăieri cu documente)
  CREATE FUNCTION public.fn_izo_doc_hash(p_doc bigint) RETURNS text
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT 'e3-doc-v1:' || encode(sha256(convert_to(jsonb_build_object(
      'v', 'e3-doc-v1',
      'antet', jsonb_build_object('proiect_id', d.proiect_id, 'depozit_id', d.depozit_id, 'sablon', d.sablon,
        'furnizor', d.furnizor, 'furnizor_canon', d.furnizor_canon, 'furnizor_cif', d.furnizor_cif, 'nr_document', d.nr_document,
        'nr_document_canon', d.nr_document_canon, 'data_document', d.data_document, 'inlocuieste_document_id', d.inlocuieste_document_id,
        'motiv_inlocuire', d.motiv_inlocuire, 'observatii', d.observatii),
      'aviz', jsonb_build_object('cumparator', d.cumparator, 'transport_nr', d.transport_nr, 'nume_proiect', d.nume_proiect, 'lot', d.lot,
        'loc_livrare', d.loc_livrare, 'data_incarcare', d.data_incarcare, 'data_descarcare', d.data_descarcare, 'nr_camion', d.nr_camion),
      'lista', jsonb_build_object('factura', d.factura, 'importator', d.importator, 'destinatar', d.destinatar,
        'referinta_client', d.referinta_client, 'referinta_furnizor', d.referinta_furnizor, 'placa_camion_container', d.placa_camion_container),
      'totaluri', jsonb_build_object('total_m', round(d.total_m, 3)::text, 'total_kg', round(d.total_kg, 1)::text, 'total_bucati', d.total_bucati,
        'total_pachete', d.total_pachete, 'total_net_kg', round(d.total_net_kg, 1)::text, 'total_brut_kg', round(d.total_brut_kg, 1)::text),
      'randuri', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'nr_crt', r.nr_crt, 'serie', r.serie, 'sarja', r.sarja, 'lot', r.lot, 'specificatie', r.specificatie, 'dimensiune', r.dimensiune,
          'grad_otel', r.grad_otel, 'standard', r.standard, 'izolatie', r.izolatie, 'diametru_mm', r.diametru_mm,
          'perete_mm', round(r.perete_mm, 1)::text, 'greutate_kg', round(r.greutate_kg, 1)::text,
          'lungime_doc_mm', r.lungime_doc_mm, 'lungime_masurata_mm', r.lungime_masurata_mm, 'cod', r.cod, 'item', r.item,
          'unghi_doc', round(r.unghi_doc, 1)::text, 'unghi_masurat', round(r.unghi_masurat, 1)::text, 'cantitate', r.cantitate,
          'pachet_nr', r.pachet_nr, 'dimensiuni_cm', r.dimensiuni_cm, 'net_kg', round(r.net_kg, 1)::text, 'brut_kg', round(r.brut_kg, 1)::text,
          'decizie', r.decizie, 'motiv', r.motiv, 'observatie', r.observatie) ORDER BY r.nr_crt), '[]'::jsonb)
        FROM public.izo_documente_intrare_randuri r WHERE r.document_id = d.id),
      'scanuri', (SELECT coalesce(jsonb_agg(jsonb_build_object('cale', s.cale, 'sha256_original', s.sha256_original,
          'sha256_pdf', s.sha256_pdf, 'marime', s.marime, 'mime', s.mime) ORDER BY s.cale), '[]'::jsonb)
        FROM public.izo_documente_scanuri s WHERE s.document_id = d.id)
    )::text, 'UTF8')), 'hex')
    FROM public.izo_documente_intrare d WHERE d.id = p_doc
  $f$;

  -- blocantele (§7): recalculate pe server, niciodată luate de la client; [{nr_crt, cod, mesaj}]
  CREATE FUNCTION public.fn_izo_doc_blocante(p_doc bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; b jsonb := '[]'::jsonb; r record; v_t record; v_teava boolean;
  BEGIN
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc;
    IF NOT FOUND THEN RETURN jsonb_build_array(jsonb_build_object('nr_crt', NULL, 'cod', 'document_inexistent', 'mesaj', 'documentul nu există')); END IF;
    v_teava := d.sablon = 'aviz_teava';
    IF NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri WHERE document_id = p_doc) THEN
      b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'fara_randuri', 'mesaj', 'documentul nu are rânduri');
    END IF;
    -- totalurile, cu rândurile refuzate incluse, pe valorile de DOCUMENT; r5f (#825 NO-GO): bucățile = numărul rândurilor
    -- (1 rând = 1 bucată, izo_doc_rand_o_bucata), același invariant ca nașterea din confirmare
    SELECT round(coalesce(sum(lungime_doc_mm), 0) / 1000.0, 3) AS m, round(coalesce(sum(greutate_kg), 0), 1) AS kg,
           count(*) AS buc, count(DISTINCT pachet_nr) AS pach,
           round(coalesce(sum(net_kg), 0), 1) AS net, round(coalesce(sum(brut_kg), 0), 1) AS brut
      INTO v_t FROM public.izo_documente_intrare_randuri WHERE document_id = p_doc;
    IF v_teava THEN
      IF d.total_m IS NULL OR round(d.total_m, 3) <> v_t.m THEN
        b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'total_m', 'mesaj', format('total m pe document %s ≠ suma rândurilor %s', d.total_m, v_t.m));
      END IF;
      IF d.total_kg IS NOT NULL AND round(d.total_kg, 1) <> v_t.kg THEN
        b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'total_kg', 'mesaj', format('total kg pe document %s ≠ suma rândurilor %s', d.total_kg, v_t.kg));
      END IF;
    ELSE
      IF d.total_bucati IS NULL OR d.total_bucati <> v_t.buc THEN
        b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'total_bucati', 'mesaj', format('total bucăți pe listă %s ≠ numărul rândurilor %s', d.total_bucati, v_t.buc));
      END IF;
      IF d.total_pachete IS NOT NULL AND d.total_pachete <> v_t.pach THEN
        b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'total_pachete', 'mesaj', format('total pachete pe listă %s ≠ pachetele rândurilor %s', d.total_pachete, v_t.pach));
      END IF;
      IF d.total_net_kg IS NOT NULL AND round(d.total_net_kg, 1) <> v_t.net THEN
        b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'total_net_kg', 'mesaj', format('total net pe listă %s ≠ suma rândurilor %s', d.total_net_kg, v_t.net));
      END IF;
      IF d.total_brut_kg IS NOT NULL AND round(d.total_brut_kg, 1) <> v_t.brut THEN
        b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'total_brut_kg', 'mesaj', format('total brut pe listă %s ≠ suma rândurilor %s', d.total_brut_kg, v_t.brut));
      END IF;
    END IF;
    -- r5f (#825 NO-GO): dublura = cheia indexului din registru — țeava pe serie (ux_magbuc_izo_radacina), curba pe serie + șarjă +
    -- unghiul efectiv (măsurat ?? document, cel scris în unghi_curba; ux_magbuc_izo_curba); cod_bucata e mereu 'AB' în E3
    FOR r IN SELECT x.*, public.fn_izo_canon_serie(x.serie) AS canon,
                    count(*) OVER (PARTITION BY public.fn_izo_canon_serie(x.serie), CASE WHEN v_teava THEN NULL ELSE x.sarja END,
                                                CASE WHEN v_teava THEN NULL ELSE coalesce(x.unghi_masurat, x.unghi_doc) END) AS dubluri
               FROM public.izo_documente_intrare_randuri x WHERE x.document_id = p_doc ORDER BY x.nr_crt LOOP
      IF r.canon IS NULL OR r.canon = '' THEN
        b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'serie_invalida', 'mesaj', 'seria e goală după canonizare');
      END IF;
      IF r.dubluri > 1 THEN
        b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'serie_dublura', 'mesaj', CASE WHEN v_teava
               THEN format('seria %s apare de mai multe ori în document', r.serie)
               ELSE format('curba %s / %s la %s° apare de mai multe ori în document', r.serie, r.sarja, coalesce(r.unghi_masurat, r.unghi_doc)) END);
      END IF;
      IF r.decizie <> 'primit' AND (r.motiv IS NULL OR char_length(btrim(r.motiv)) < 3) THEN
        b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'motiv_lipsa', 'mesaj', 'motivul e obligatoriu la refuz / neconformitate');
      END IF;
      IF v_teava AND r.lungime_doc_mm IS NULL THEN
        b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'lungime_lipsa', 'mesaj', 'lungimea de pe document lipsește');
      END IF;
      IF r.decizie <> 'refuzat_la_receptie' THEN
        IF r.perete_mm IS NULL THEN
          b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'perete_lipsa', 'mesaj', 'peretele lipsește');
        END IF;
        IF NOT v_teava AND coalesce(r.unghi_masurat, r.unghi_doc) IS NULL THEN
          b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'unghi_lipsa', 'mesaj', 'unghiul curbei lipsește');
        END IF;
        -- coliziunea cu registrul (aceeași interogare ca R1 c din import); arbitrul final rămâne indexul
        IF v_teava AND EXISTS (SELECT 1 FROM public.magazie_bucati m WHERE m.provenienta = 'beneficiar' AND m.tip_cod = 'teava'
                                AND m.parinte_id IS NULL AND m.stare <> 'anulata' AND m.serie_canon = r.canon AND m.dezambiguare IS NULL) THEN
          b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'serie_in_registru', 'mesaj', format('seria %s există deja ca țeavă în registru', r.serie));
        END IF;
        IF NOT v_teava AND EXISTS (SELECT 1 FROM public.magazie_bucati m WHERE m.provenienta = 'beneficiar' AND m.tip_cod = 'curba'
                                    AND m.stare <> 'anulata' AND m.serie_canon = r.canon AND m.sarja IS NOT DISTINCT FROM r.sarja
                                    AND m.unghi_curba IS NOT DISTINCT FROM coalesce(r.unghi_masurat, r.unghi_doc) AND m.cod_bucata = 'AB') THEN
          b := b || jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'curba_in_registru', 'mesaj', format('curba %s / %s există deja în registru', r.serie, r.sarja));
        END IF;
      END IF;
    END LOOP;
    -- manifestul: obiectele există
    FOR r IN SELECT s.cale FROM public.izo_documente_scanuri s WHERE s.document_id = p_doc AND NOT public.fn_izo_scan_exista(s.cale) LOOP
      b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'scan_lipsa', 'mesaj', format('scanul %s nu mai există în Storage', r.cale));
    END LOOP;
    -- legătura de înlocuire (r5b §12.2)
    IF d.inlocuieste_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare t
         WHERE t.id = d.inlocuieste_document_id AND t.stare = 'anulat' AND t.id <> d.id) THEN
      b := b || jsonb_build_object('nr_crt', NULL, 'cod', 'inlocuire_invalida', 'mesaj', 'documentul înlocuit nu există sau nu e anulat');
    END IF;
    RETURN b;
  END $f$;

  -- avertismentele (§7): toleranțe (strict peste prag), scan lipsă / dublat
  CREATE FUNCTION public.fn_izo_doc_avertismente(p_doc bigint) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT coalesce(jsonb_agg(a ORDER BY a->>'nr_crt' NULLS FIRST, a->>'cod'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'toleranta_lungime',
               'mesaj', format('măsurat %s mm față de %s mm pe document (peste ±10 mm)', r.lungime_masurata_mm, r.lungime_doc_mm)) a
        FROM public.izo_documente_intrare_randuri r
       WHERE r.document_id = p_doc AND abs(r.lungime_masurata_mm - r.lungime_doc_mm) > 10
      UNION ALL
      SELECT jsonb_build_object('nr_crt', r.nr_crt, 'cod', 'toleranta_unghi',
               'mesaj', format('măsurat %s° față de %s° pe listă (peste ±0,5°)', r.unghi_masurat, r.unghi_doc))
        FROM public.izo_documente_intrare_randuri r
       WHERE r.document_id = p_doc AND abs(r.unghi_masurat - r.unghi_doc) > 0.5
      UNION ALL
      SELECT jsonb_build_object('nr_crt', NULL, 'cod', 'fara_scan', 'mesaj', 'documentul nu are scan atașat')
       WHERE NOT EXISTS (SELECT 1 FROM public.izo_documente_scanuri s WHERE s.document_id = p_doc)
      UNION ALL
      SELECT jsonb_build_object('nr_crt', NULL, 'cod', 'scan_dublat', 'mesaj', format('același fișier (%s) e atașat de %s ori', s.sha256_original, count(*)))
        FROM public.izo_documente_scanuri s WHERE s.document_id = p_doc GROUP BY s.sha256_original HAVING count(*) > 1
    ) x
  $f$;

  -- bucata așteptată (§3.2 / r5): TOATE coloanele, din antet + rând; normalizată prin tipul magazie_bucati
  CREATE FUNCTION public.fn_izo_doc_bucata_asteptata(p_doc bigint, p_nr_crt integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; r public.izo_documente_intrare_randuri; v_tip text; v_teava boolean; v_lmm integer;
  BEGIN
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc;
    SELECT * INTO r FROM public.izo_documente_intrare_randuri WHERE document_id = p_doc AND nr_crt = p_nr_crt;
    IF d.id IS NULL OR r.id IS NULL THEN RETURN NULL; END IF;
    v_teava := d.sablon = 'aviz_teava';
    v_tip := CASE WHEN v_teava THEN 'teava' ELSE 'curba' END;
    v_lmm := CASE WHEN v_teava THEN coalesce(r.lungime_masurata_mm, r.lungime_doc_mm) END;
    RETURN to_jsonb(jsonb_populate_record(NULL::public.magazie_bucati,
      jsonb_build_object(
        'proiect_id', d.proiect_id, 'comanda_furnizor_id', NULL, 'tip_material_id', public.fn_izo_tip_material(v_tip),
        'serie', r.serie, 'sarja', r.sarja, 'dimensiune', r.dimensiune, 'grad_otel', r.grad_otel, 'standard', r.standard,
        'lungime_m', CASE WHEN v_teava THEN v_lmm / 1000.0 END, 'lungime_originala_m', CASE WHEN v_teava THEN v_lmm / 1000.0 END,
        'greutate_kg', r.greutate_kg, 'unghi_curba', CASE WHEN NOT v_teava THEN coalesce(r.unghi_masurat, r.unghi_doc) END,
        'cantitate', 1, 'um', CASE WHEN v_teava THEN 'm' ELSE 'buc' END, 'provenienta', 'beneficiar', 'izolatie', r.izolatie,
        'furnizor', d.furnizor, 'producator', NULL, 'sursa_receptie', CASE WHEN v_teava THEN 'aviz' ELSE 'packing_list' END,
        'fara_packing_list', false, 'nr_document', d.nr_document, 'data_receptie', d.data_document, 'mtc_path', NULL)
      || jsonb_build_object(
        'stare', CASE r.decizie WHEN 'primit' THEN 'sosit' ELSE 'carantina' END, 'locatie_tip', 'depozit',
        'locatie_site_id', public.fn_izo_site_proiect(d.proiect_id), 'executie_teava_id', NULL,
        'atribute', jsonb_strip_nulls(jsonb_build_object('sursa', 'e3', 'document_id', d.id, 'cod', r.cod, 'item', r.item,
            'specificatie', r.specificatie, 'pachet_nr', r.pachet_nr, 'dimensiuni_cm', r.dimensiuni_cm, 'net_kg', r.net_kg,
            'brut_kg', r.brut_kg, 'unghi_doc', r.unghi_doc, 'unghi_masurat', r.unghi_masurat, 'decizie', r.decizie, 'motiv', r.motiv)),
        'observatii', r.observatie, 'receptionat_de', NULL, 'receptionat_la', NULL, 'created_by', public.fn_izo_uid(),
        'tip_cod', v_tip, 'parinte_id', NULL, 'cod_bucata', 'AB', 'capat_stanga', 'A', 'capat_dreapta', 'B', 'dezambiguare', NULL,
        'lungime_aviz_mm', CASE WHEN v_teava THEN r.lungime_doc_mm END, 'lungime_masurata_mm', CASE WHEN v_teava THEN r.lungime_masurata_mm END,
        'lungime_mm', v_lmm, 'lungime_calculata', false, 'perete_mm', r.perete_mm, 'diametru_mm', r.diametru_mm, 'lot', r.lot,
        'aviz_intrare_id', d.id, 'nr_crt_aviz', r.nr_crt, 'bend_no', NULL, 'capat_marcaj', NULL, 'depozit_id', d.depozit_id,
        'tronson_id', NULL)));
  END $f$;

  -- evenimentul așteptat (r5b §12.3): rândul complet, fără id / server_ver / ora_server
  CREATE FUNCTION public.fn_izo_eveniment_asteptat(p_op text, p_doc bigint, p_storno_de bigint, p_arg text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare;
  BEGIN
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN to_jsonb(jsonb_populate_record(NULL::public.magazie_bucati_evenimente, jsonb_build_object(
      'tip', CASE p_op WHEN 'confirma' THEN CASE d.sablon WHEN 'aviz_teava' THEN 'intrare_aviz' ELSE 'intrare_lista_ambalare' END
                       WHEN 'pv' THEN 'receptie_pv' WHEN 'anulare' THEN 'storno' END,
      'proiect_id', d.proiect_id, 'document_tip', 'doc_intrare', 'document_id', d.id::text, 'import_id', NULL,
      'storno_de_eveniment_id', CASE WHEN p_op = 'anulare' THEN p_storno_de END,
      'motiv', CASE p_op WHEN 'confirma' THEN p_arg
                         WHEN 'pv' THEN 'PV ' || split_part(p_arg, '|', 1) || ' / ' || split_part(p_arg, '|', 2)
                         WHEN 'anulare' THEN p_arg END,
      'declarat_de', NULL, 'aplicat_de', public.fn_izo_uid(), 'aplicat_rol', session_user, 'ora_tableta', NULL, 'dispozitiv_id', NULL)));
  END $f$;

  -- mișcarea așteptată (r5b §12.3): rândul complet, fără id / server_ver
  CREATE FUNCTION public.fn_izo_miscare_asteptata(p_eveniment bigint, p_bucata bigint, p_rol text, p_inainte text, p_dupa text,
                                                   p_in_loc jsonb, p_lungime integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT to_jsonb(jsonb_populate_record(NULL::public.magazie_bucati_miscari, jsonb_build_object(
      'eveniment_id', p_eveniment, 'proiect_id', (SELECT e.proiect_id FROM public.magazie_bucati_evenimente e WHERE e.id = p_eveniment),
      'bucata_id', p_bucata, 'rol', p_rol, 'stare_inainte', p_inainte, 'stare_dupa', p_dupa, 'din_loc', NULL, 'in_loc', p_in_loc,
      'lungime_mm', p_lungime, 'inainte', NULL, 'dupa', NULL)))
  $f$;

  -- marcajul = contextul operației (scris DOAR aici; neexpus; owner izo_receptie_writer, mai jos)
  CREATE FUNCTION public.fn_izo_receptie_marcheaza(p_op text, p_doc bigint, p_proiect bigint, p_depozit integer, p_versiune bigint, p_arg text)
    RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF p_op NOT IN ('confirma', 'pv', 'anulare', 'anulare_draft') OR p_doc IS NULL OR p_proiect IS NULL OR p_depozit IS NULL OR p_versiune IS NULL THEN
      RAISE EXCEPTION 'izo E3: context de operație invalid' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('izo.receptie_ctx',
      txid_current()::text || '|' || p_op || '|' || p_doc || '|' || p_proiect || '|' || p_depozit || '|' || p_versiune || '|' || coalesce(p_arg, ''), true);
  END $f$;

  -- ── E. garda E3 (contextul operației, §3.2) ───────────────────────────────────────────────────────────
  CREATE FUNCTION public.fn_izo_garda_receptie(p_tabel text, p_op text, p_old jsonb, p_new jsonb) RETURNS boolean
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    m text[]; v_op text; v_doc bigint; v_proiect bigint; v_depozit integer; v_ver bigint; v_arg text;
    d public.izo_documente_intrare; v_tip_intrare text; v_ev_intrare bigint; v_ev_pv bigint; v_st_intrare bigint; v_st_pv bigint;
    v_b public.magazie_bucati; v_r public.izo_documente_intrare_randuri; v_exp jsonb; v_storno_de bigint; v_permise text[];
    c_gen_buc constant text[] := ARRAY['serie_canon', 'lungime_cm'];
    c_gen_doc constant text[] := ARRAY['furnizor_canon', 'nr_document_canon'];
  BEGIN
    IF current_user <> 'izo_receptie_writer' THEN
      RAISE EXCEPTION 'izo E3: garda recepției e doar pentru izo_receptie_writer' USING ERRCODE = '42501';
    END IF;
    m := regexp_match(coalesce(current_setting('izo.receptie_ctx', true), ''),
                      '^([0-9]+)\|(confirma|pv|anulare|anulare_draft)\|([0-9]+)\|([0-9]+)\|([0-9]+)\|([0-9]+)\|(.*)$');
    IF m IS NULL OR m[1] <> txid_current()::text THEN
      RAISE EXCEPTION 'izo E3: %.% fără contextul operației (marcaj lipsă sau din altă tranzacție)', p_tabel, p_op USING ERRCODE = '42501';
    END IF;
    v_op := m[2]; v_doc := m[3]::bigint; v_proiect := m[4]::bigint; v_depozit := m[5]::integer; v_ver := m[6]::bigint; v_arg := m[7];
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = v_doc;
    IF NOT FOUND OR d.proiect_id <> v_proiect OR d.depozit_id <> v_depozit THEN
      RAISE EXCEPTION 'izo E3: documentul contextului nu bate (document / proiect / depozit)' USING ERRCODE = '42501';
    END IF;
    v_tip_intrare := CASE d.sablon WHEN 'aviz_teava' THEN 'intrare_aviz' ELSE 'intrare_lista_ambalare' END;
    -- evenimentele documentului, identificate prin indexurile unice parțiale (nu prin FK-urile antetului, scrise la final)
    SELECT e.id INTO v_ev_intrare FROM public.magazie_bucati_evenimente e
     WHERE e.document_tip = 'doc_intrare' AND e.document_id = v_doc::text AND e.tip = v_tip_intrare AND e.proiect_id = v_proiect;
    SELECT e.id INTO v_ev_pv FROM public.magazie_bucati_evenimente e
     WHERE e.document_tip = 'doc_intrare' AND e.document_id = v_doc::text AND e.tip = 'receptie_pv' AND e.proiect_id = v_proiect;
    IF v_ev_intrare IS NOT NULL THEN
      SELECT e.id INTO v_st_intrare FROM public.magazie_bucati_evenimente e WHERE e.storno_de_eveniment_id = v_ev_intrare;
    END IF;
    IF v_ev_pv IS NOT NULL THEN
      SELECT e.id INTO v_st_pv FROM public.magazie_bucati_evenimente e WHERE e.storno_de_eveniment_id = v_ev_pv;
    END IF;
    -- pe registru și pe rânduri: antetul încă nemodificat (se scrie ultimul), în starea cerută de operație
    IF p_tabel <> 'izo_documente_intrare' THEN
      IF d.versiune <> v_ver
         OR (v_op = 'confirma' AND d.stare <> 'draft')
         OR (v_op = 'pv' AND (d.stare <> 'confirmat' OR d.eveniment_pv_id IS NOT NULL))
         OR (v_op = 'anulare' AND d.stare <> 'confirmat')
         OR v_op = 'anulare_draft' THEN
        RAISE EXCEPTION 'izo E3: %.% nu e permisă în starea documentului (% / v%, context % / v%)', p_tabel, p_op, d.stare, d.versiune, v_op, v_ver
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF p_tabel = 'magazie_bucati_evenimente' AND p_op = 'INSERT' THEN
      IF v_op = 'confirma' THEN
        IF v_ev_intrare IS NOT NULL OR v_arg IS DISTINCT FROM public.fn_izo_doc_hash(v_doc) THEN
          RAISE EXCEPTION 'izo E3: evenimentul de intrare există deja sau hash-ul nu bate' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'pv' THEN
        IF v_ev_intrare IS NULL OR v_ev_pv IS NOT NULL THEN
          RAISE EXCEPTION 'izo E3: PV fără intrare sau PV deja pus' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'anulare' THEN
        -- ordinea inversării: PV-ul întâi (dacă există și nu e stornat), apoi intrarea
        v_storno_de := CASE WHEN v_ev_pv IS NOT NULL AND v_st_pv IS NULL THEN v_ev_pv
                            WHEN v_ev_intrare IS NOT NULL AND v_st_intrare IS NULL THEN v_ev_intrare END;
        IF v_storno_de IS NULL THEN RAISE EXCEPTION 'izo E3: nimic de stornat pe document' USING ERRCODE = '42501'; END IF;
      END IF;
      v_exp := public.fn_izo_eveniment_asteptat(v_op, v_doc, v_storno_de, v_arg);
      IF public.fn_izo_proiectie(p_new, public.fn_izo_coloane_ev()) IS DISTINCT FROM public.fn_izo_proiectie(v_exp, public.fn_izo_coloane_ev()) THEN
        RAISE EXCEPTION 'izo E3: evenimentul diferă de cel așteptat pentru % pe documentul %', v_op, v_doc USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'magazie_bucati' AND p_op = 'INSERT' THEN
      IF v_op <> 'confirma' THEN RAISE EXCEPTION 'izo E3: bucăți noi doar la confirmare' USING ERRCODE = '42501'; END IF;
      SELECT * INTO v_r FROM public.izo_documente_intrare_randuri WHERE document_id = v_doc AND nr_crt = (p_new ->> 'nr_crt_aviz')::integer;
      IF NOT FOUND OR v_r.decizie NOT IN ('primit', 'primit_neconform') OR v_r.bucata_id IS NOT NULL THEN
        RAISE EXCEPTION 'izo E3: rândul % al documentului % nu primește bucată', p_new ->> 'nr_crt_aviz', v_doc USING ERRCODE = '42501';
      END IF;
      IF (p_new ->> 'radacina_id') IS DISTINCT FROM (p_new ->> 'id') OR (p_new ->> 'uid') IS NULL OR (p_new ->> 'server_ver') IS NULL THEN
        RAISE EXCEPTION 'izo E3: bucata nu e rădăcină completă (radacina_id = id, uid, server_ver)' USING ERRCODE = '42501';
      END IF;
      v_exp := public.fn_izo_doc_bucata_asteptata(v_doc, v_r.nr_crt);
      IF public.fn_izo_proiectie(p_new, public.fn_izo_coloane_c()) IS DISTINCT FROM public.fn_izo_proiectie(v_exp, public.fn_izo_coloane_c()) THEN
        RAISE EXCEPTION 'izo E3: bucata rândului % diferă de documentul confirmat', v_r.nr_crt USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'magazie_bucati' AND p_op = 'UPDATE' THEN
      IF v_op NOT IN ('pv', 'anulare') THEN RAISE EXCEPTION 'izo E3: UPDATE pe bucăți doar la PV / anulare' USING ERRCODE = '42501'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri x WHERE x.document_id = v_doc AND x.bucata_id = (p_old ->> 'id')::bigint
                      AND (v_op <> 'pv' OR x.decizie = 'primit'))
         OR (p_new ->> 'proiect_id') IS DISTINCT FROM v_proiect::text
         OR (p_new - c_gen_buc - 'stare' - 'server_ver' - 'updated_at') IS DISTINCT FROM (p_old - c_gen_buc - 'stare' - 'server_ver' - 'updated_at')
         OR (p_new ->> 'server_ver') IS NULL THEN
        RAISE EXCEPTION 'izo E3: UPDATE pe o bucată străină documentului sau pe alte coloane decât starea' USING ERRCODE = '42501';
      END IF;
      IF NOT ((v_op = 'pv' AND p_old ->> 'stare' = 'sosit' AND p_new ->> 'stare' = 'receptionat')
           OR (v_op = 'anulare' AND v_st_pv IS NOT NULL AND v_st_intrare IS NULL AND p_old ->> 'stare' = 'receptionat' AND p_new ->> 'stare' = 'sosit')
           OR (v_op = 'anulare' AND v_st_intrare IS NOT NULL AND p_old ->> 'stare' IN ('sosit', 'carantina') AND p_new ->> 'stare' = 'anulata')) THEN
        RAISE EXCEPTION 'izo E3: tranziția % → % nu e permisă la %', p_old ->> 'stare', p_new ->> 'stare', v_op USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'magazie_bucati_miscari' AND p_op = 'INSERT' THEN
      SELECT * INTO v_b FROM public.magazie_bucati WHERE id = (p_new ->> 'bucata_id')::bigint;
      IF NOT FOUND OR v_b.aviz_intrare_id IS DISTINCT FROM v_doc
         OR NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri x WHERE x.document_id = v_doc AND x.nr_crt = v_b.nr_crt_aviz
                         AND (x.bucata_id IS NULL OR x.bucata_id = v_b.id)) THEN
        RAISE EXCEPTION 'izo E3: mișcarea e pe o bucată străină documentului %', v_doc USING ERRCODE = '42501';
      END IF;
      IF v_op = 'confirma' THEN
        v_exp := public.fn_izo_miscare_asteptata(v_ev_intrare, v_b.id, 'nascut', NULL, v_b.stare,
                   jsonb_build_object('tip', 'depozit', 'depozit_id', v_depozit), v_b.lungime_mm);
      ELSIF v_op = 'pv' THEN
        IF v_b.stare <> 'receptionat' OR NOT EXISTS (SELECT 1 FROM public.izo_documente_intrare_randuri x
             WHERE x.document_id = v_doc AND x.bucata_id = v_b.id AND x.decizie = 'primit') THEN
          RAISE EXCEPTION 'izo E3: mișcarea PV e pe o bucată din afara mulțimii PV' USING ERRCODE = '42501';
        END IF;
        v_exp := public.fn_izo_miscare_asteptata(v_ev_pv, v_b.id, 'stare', 'sosit', 'receptionat', NULL, NULL);
      ELSIF v_op = 'anulare' AND v_st_pv IS NOT NULL AND v_st_intrare IS NULL AND (p_new ->> 'eveniment_id')::bigint = v_st_pv THEN
        v_exp := public.fn_izo_miscare_asteptata(v_st_pv, v_b.id, 'stare', 'receptionat', 'sosit', NULL, NULL);
      ELSIF v_op = 'anulare' AND v_st_intrare IS NOT NULL AND (p_new ->> 'eveniment_id')::bigint = v_st_intrare THEN
        v_exp := public.fn_izo_miscare_asteptata(v_st_intrare, v_b.id, 'anulat', v_b.stare, 'anulata', NULL, NULL);
      ELSE
        RAISE EXCEPTION 'izo E3: mișcare pe un eveniment care nu e al operației % pe documentul %', v_op, v_doc USING ERRCODE = '42501';
      END IF;
      IF v_exp IS NULL OR public.fn_izo_proiectie(p_new, public.fn_izo_coloane_mis()) IS DISTINCT FROM public.fn_izo_proiectie(v_exp, public.fn_izo_coloane_mis()) THEN
        RAISE EXCEPTION 'izo E3: mișcarea diferă de cea așteptată (%, bucata %)', v_op, v_b.id USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'izo_documente_intrare_randuri' AND p_op = 'UPDATE' THEN
      IF v_op <> 'confirma' OR (p_old ->> 'document_id')::bigint <> v_doc OR (p_old ->> 'bucata_id') IS NOT NULL OR (p_new ->> 'bucata_id') IS NULL
         OR (p_new - 'bucata_id') IS DISTINCT FROM (p_old - 'bucata_id')
         OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.id = (p_new ->> 'bucata_id')::bigint
                         AND b.aviz_intrare_id = v_doc AND b.nr_crt_aviz = (p_old ->> 'nr_crt')::integer) THEN
        RAISE EXCEPTION 'izo E3: rândul % primește doar bucata lui, la confirmare', p_old ->> 'nr_crt' USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    IF p_tabel = 'izo_documente_intrare' AND p_op = 'UPDATE' THEN
      IF (p_old ->> 'id')::bigint <> v_doc OR (p_old ->> 'versiune')::bigint <> v_ver OR (p_new ->> 'versiune')::bigint <> v_ver + 1 THEN
        RAISE EXCEPTION 'izo E3: antetul se scrie doar cu versiunea contextului + 1' USING ERRCODE = '42501';
      END IF;
      IF v_op = 'confirma' THEN
        v_permise := ARRAY['stare', 'versiune', 'updated_at', 'hash_confirmat', 'avertismente', 'confirmat_de', 'confirmat_la', 'eveniment_intrare_id'];
        IF p_old ->> 'stare' <> 'draft' OR p_new ->> 'stare' <> 'confirmat' OR p_new ->> 'hash_confirmat' IS DISTINCT FROM v_arg
           OR v_ev_intrare IS NULL OR (p_new ->> 'eveniment_intrare_id')::bigint IS DISTINCT FROM v_ev_intrare
           OR (p_new ->> 'confirmat_de') IS DISTINCT FROM public.fn_izo_uid()::text OR (p_new ->> 'confirmat_la') IS NULL THEN
          RAISE EXCEPTION 'izo E3: confirmarea antetului nu bate cu contextul / evenimentul de intrare' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'pv' THEN
        v_permise := ARRAY['versiune', 'updated_at', 'pv_nr', 'pv_nr_canon', 'pv_data', 'pv_pus_de', 'pv_pus_la', 'eveniment_pv_id'];
        IF p_old ->> 'stare' <> 'confirmat' OR p_new ->> 'stare' <> 'confirmat' OR (p_old ->> 'eveniment_pv_id') IS NOT NULL
           OR p_new ->> 'pv_nr_canon' IS DISTINCT FROM split_part(v_arg, '|', 1) OR p_new ->> 'pv_data' IS DISTINCT FROM split_part(v_arg, '|', 2)
           OR v_ev_pv IS NULL OR (p_new ->> 'eveniment_pv_id')::bigint IS DISTINCT FROM v_ev_pv
           OR (p_new ->> 'pv_pus_de') IS DISTINCT FROM public.fn_izo_uid()::text OR (p_new ->> 'pv_pus_la') IS NULL THEN
          RAISE EXCEPTION 'izo E3: PV-ul antetului nu bate cu contextul / evenimentul PV' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'anulare' THEN
        v_permise := ARRAY['stare', 'versiune', 'updated_at', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv', 'eveniment_storno_intrare_id', 'eveniment_storno_pv_id'];
        IF p_old ->> 'stare' <> 'confirmat' OR p_new ->> 'stare' <> 'anulat' OR p_new ->> 'anulat_motiv' IS DISTINCT FROM v_arg
           OR (p_new ->> 'anulat_de') IS DISTINCT FROM public.fn_izo_uid()::text
           OR p_new ->> 'anulat_de_rol' IS DISTINCT FROM session_user::text OR (p_new ->> 'anulat_la') IS NULL
           OR v_st_intrare IS NULL OR (p_new ->> 'eveniment_storno_intrare_id')::bigint IS DISTINCT FROM v_st_intrare
           OR (v_ev_pv IS NOT NULL AND v_st_pv IS NULL)
           OR (p_new ->> 'eveniment_storno_pv_id')::bigint IS DISTINCT FROM v_st_pv THEN
          RAISE EXCEPTION 'izo E3: anularea antetului nu bate cu storno-urile scrise' USING ERRCODE = '42501';
        END IF;
      ELSIF v_op = 'anulare_draft' THEN
        v_permise := ARRAY['stare', 'versiune', 'updated_at', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv'];
        IF p_old ->> 'stare' <> 'draft' OR p_new ->> 'stare' <> 'anulat' OR p_new ->> 'anulat_motiv' IS DISTINCT FROM v_arg
           OR (p_new ->> 'anulat_de') IS DISTINCT FROM public.fn_izo_uid()::text
           OR p_new ->> 'anulat_de_rol' IS DISTINCT FROM session_user::text OR (p_new ->> 'anulat_la') IS NULL THEN
          RAISE EXCEPTION 'izo E3: anularea draftului nu bate cu contextul' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF (p_new - c_gen_doc - v_permise) IS DISTINCT FROM (p_old - c_gen_doc - v_permise) THEN
        RAISE EXCEPTION 'izo E3: antetul se modifică doar pe coloanele operației %', v_op USING ERRCODE = '42501';
      END IF;
      RETURN true;
    END IF;

    RAISE EXCEPTION 'izo E3: %.% nu e permisă în contextul %', p_tabel, p_op, v_op USING ERRCODE = '42501';
  END $f$;

  -- ── F. gărzile E2a cu predicatul de autorizare v_aut (r4 §3.2: fără RETURN timpuriu; restul E2a neschimbat) ──
  CREATE OR REPLACE FUNCTION public.fn_izo_garda_bucati() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_old boolean := false;
    v_new boolean := false;
    v_p bigint;
    v_aut boolean;
  BEGIN
    -- E3 (20261103b): predicatul de autorizare, calculat o singură dată — scriitorul E2a cu marcaj SAU scriitorul E3 în
    -- contextul operației (true sau excepție); fără RETURN timpuriu: verificările E2a de mai jos se aplică tuturor
    v_aut := public.fn_izo_garda_scriitor();
    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
      v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
                                            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
    -- (1) rândurile registrului sunt protejate PERMANENT: refuz imediat, fără lock (altfel un UPDATE al clientului, care
    --     ține deja rândul, ar aștepta lock-ul advisory al unui storno care așteaptă rândul → blocaj circular)
    IF ((TG_OP <> 'INSERT' AND OLD.tip_cod IS NOT NULL) OR (TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL))
       AND v_aut IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: bucățile beneficiar ale unui proiect cu registru (nivel ≠ off) se scriu doar prin funcțiile registrului'
        USING ERRCODE = '42501';
    END IF;
    -- (2) beneficiar în afara registrului: lock PARTAJAT pe proiectele OLD/NEW (crescător; cere READ COMMITTED — sub
    --     REPEATABLE READ o activare comisă între timp n-ar fi văzută), apoi nivelul, citit cu snapshot nou
    IF (TG_OP <> 'INSERT' AND OLD.provenienta = 'beneficiar') OR (TG_OP <> 'DELETE' AND NEW.provenienta = 'beneficiar') THEN
      IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'izo: scrierile care ating registrul cer READ COMMITTED (acum %)', current_setting('transaction_isolation')
          USING ERRCODE = '25001';
      END IF;
      FOR v_p IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP <> 'INSERT' AND OLD.provenienta = 'beneficiar' THEN OLD.proiect_id END,
                                                       CASE WHEN TG_OP <> 'DELETE' AND NEW.provenienta = 'beneficiar' THEN NEW.proiect_id END]) x
                  WHERE x IS NOT NULL ORDER BY 1 LOOP
        PERFORM pg_advisory_xact_lock_shared(73010, v_p::integer);
      END LOOP;
    END IF;
    IF TG_OP <> 'INSERT' AND (OLD.tip_cod IS NOT NULL OR OLD.provenienta = 'beneficiar') THEN
      v_old := OLD.tip_cod IS NOT NULL OR public.fn_izo_nivel(OLD.proiect_id) <> 'off';
    END IF;
    IF TG_OP <> 'DELETE' AND (NEW.tip_cod IS NOT NULL OR NEW.provenienta = 'beneficiar') THEN
      v_new := NEW.tip_cod IS NOT NULL OR public.fn_izo_nivel(NEW.proiect_id) <> 'off';
    END IF;
    IF v_old OR v_new THEN
      IF v_aut IS NOT TRUE THEN
        RAISE EXCEPTION 'izo: bucățile beneficiar ale unui proiect cu registru (nivel ≠ off) se scriu doar prin funcțiile registrului'
          USING ERRCODE = '42501';
      END IF;
      IF TG_OP <> 'DELETE' AND NEW.stare IN ('rezervata','consumata') THEN
        RAISE EXCEPTION 'izo: starea % e interzisă pe bucățile registrului (rezervările stau în izo_rezervari; consumul = montata/taiata)', NEW.stare
          USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'izo: bucățile registrului nu se șterg (anulare = storno)' USING ERRCODE = '42501';
      END IF;
      -- un rând de registru nu stă niciodată pe un proiect off (nici scris de writer) — review #806 A
      IF TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL AND public.fn_izo_nivel(NEW.proiect_id) = 'off' THEN
        RAISE EXCEPTION 'izo: rândurile registrului cer proiect cu nivel ≠ off (proiectul %)', NEW.proiect_id USING ERRCODE = '42501';
      END IF;
    END IF;
    -- tip_cod e copie controlată de server: trebuie să bată cu tip_material_id
    IF TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL AND NEW.tip_cod IS DISTINCT FROM public.fn_izo_tip_cod(NEW.tip_material_id) THEN
      RAISE EXCEPTION 'izo: tip_cod % nu bate cu tip_material_id %', NEW.tip_cod, NEW.tip_material_id USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $f$;

  CREATE OR REPLACE FUNCTION public.fn_izo_garda_fapte() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_aut boolean;
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'izo: TRUNCATE pe % e refuzat (registru doar-adaug)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'izo: DELETE pe % e refuzat (registru doar-adaug; anulare = storno)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('magazie_bucati_evenimente','magazie_bucati_miscari') THEN
      RAISE EXCEPTION 'izo: UPDATE pe % e refuzat (registru doar-adaug)', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    -- E3 (20261103b): predicatul de autorizare, calculat o singură dată — scriitorul E2a cu marcaj SAU scriitorul E3 în
    -- contextul operației (true sau excepție); fără RETURN timpuriu: verificările E2a de mai jos se aplică tuturor
    v_aut := public.fn_izo_garda_scriitor();
    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
      v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
                                            to_jsonb(NEW));
    END IF;
    IF v_aut IS NOT TRUE THEN
      RAISE EXCEPTION 'izo: % se scrie doar prin funcțiile registrului', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $f$;

  -- ── F2. poarta E2a: aceleași verificări, închiderea citirilor rapidă (semi-naivă; r5d §13.1) + poarta E3 la final ──
  CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v text[] := '{}'; r record;
  BEGIN
    -- triggerele: există și sunt ENABLE ALWAYS ('A' — trag și sub session_replication_role = replica)
    FOR r IN SELECT x.tabel, x.trg, g.tgenabled
               FROM (VALUES ('magazie_bucati','trg_magbuc_izo_garda'), ('magazie_bucati','trg_magbuc_izo_truncate'),
                            ('magazie_bucati_evenimente','trg_izo_ev_garda'), ('magazie_bucati_evenimente','trg_izo_ev_truncate'),
                            ('magazie_bucati_miscari','trg_izo_mis_garda'), ('magazie_bucati_miscari','trg_izo_mis_truncate'),
                            ('izo_importuri','trg_izo_imp_garda'), ('izo_importuri','trg_izo_imp_truncate'),
                            ('izo_proiect_config','trg_izo_cfg_garda'), ('izo_proiect_config','trg_izo_cfg_truncate'),
                            ('izo_atribuiri','trg_izo_atr_garda'), ('izo_atribuiri','trg_izo_atr_truncate'),
                            ('executie_tevi','trg_executie_tevi_izo_delete'), ('executie_tevi','trg_executie_tevi_izo_mutare'),
                            ('executie_pachete_lansare','trg_pachete_izo_delete'), ('executie_pachete_lansare','trg_pachete_izo_mutare'),
                            ('executie_tronsoane','trg_tronsoane_izo_mutare'), ('logistica_depozite','trg_depozite_izo_mutare'),
                            ('executie_proiecte','trg_proiecte_izo_site'),
                            ('executie_tevi','trg_executie_tevi_izo_truncate'), ('executie_pachete_lansare','trg_pachete_izo_truncate'),
                            ('executie_bonuri_consum_linii','trg_bon_linii_izo_bucata')) x(tabel, trg)
               LEFT JOIN pg_trigger g ON g.tgname = x.trg AND g.tgrelid = to_regclass('public.' || x.tabel) AND NOT g.tgisinternal
    LOOP
      IF r.tgenabled IS DISTINCT FROM 'A' THEN v := array_append(v, format('trigger %s.%s (%s)', r.tabel, r.trg, coalesce(r.tgenabled::text, 'lipsă'))); END IF;
    END LOOP;
    -- RLS activ pe tabelele registrului și pe magazie_bucati
    FOR r IN SELECT t.n, c.relrowsecurity FROM unnest(ARRAY['magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri',
                      'magazie_bucati_evenimente','magazie_bucati_miscari']) t(n) LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.n)
    LOOP
      IF r.relrowsecurity IS NOT TRUE THEN v := array_append(v, format('RLS inactiv pe %s', r.n)); END IF;
    END LOOP;
    -- politicile RESTRICTIVE ale clientului pe magazie_bucati
    IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'public.magazie_bucati'::regclass AND NOT p.polpermissive
          AND p.polname IN ('magbuc_izo_client_sel','magbuc_izo_client_ins','magbuc_izo_client_upd','magbuc_izo_client_del')) <> 4 THEN
      v := array_append(v, 'politicile RESTRICTIVE magbuc_izo_client_*');
    END IF;
    -- rolul scriitor: fără BYPASSRLS/LOGIN/SUPERUSER/INHERIT; singurul membru = postgres; niciun rol API nu-l poate prelua
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izo_registru_writer' AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit) THEN
      v := array_append(v, 'rolul izo_registru_writer (lipsă sau BYPASSRLS/LOGIN/SUPERUSER/INHERIT)');
    -- membri: doar postgres (PG16+: CREATE ROLE de către un non-superuser adaugă automat un rând ADMIN fără SET/INHERIT,
    -- grantor = superuser-ul de bootstrap — pe Supabase supabase_admin; găsit de testul pe branch PG17); SET da, INHERIT nu
    ELSIF EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.member <> 'postgres'::regrole)
       OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.member = 'postgres'::regrole AND m.set_option)
       OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole AND m.inherit_option)
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) a(n)
                   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a.n) AND pg_has_role(a.n, 'izo_registru_writer', 'MEMBER')) THEN
      v := array_append(v, 'membrii rolului izo_registru_writer');
    END IF;
    -- ACL: clientul nu scrie tabelele registrului și nu execută funcțiile writer-ului
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari']) t(n),
                             unnest(ARRAY['anon','authenticated','service_role']) a(n), unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p(n)
                WHERE to_regclass('public.' || t.n) IS NULL OR has_table_privilege(a.n, 'public.' || t.n, p.n)) THEN
      v := array_append(v, 'ACL de scriere pe tabelele registrului');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) a(n)
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_izo_seteaza_nivel','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_activeaza_si_importa')
                  AND has_function_privilege(a.n, p.oid, 'EXECUTE')) THEN
      v := array_append(v, 'EXECUTE din API pe funcțiile registrului');
    END IF;
    -- allowlist pe ACL (invariantul principal, Copilot r6 c): intrările writer-ului se execută DOAR de owner și postgres
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.pronamespace = 'public'::regnamespace
                  AND p.proname IN ('fn_izo_seteaza_nivel','fn_izo_import_sold_initial','fn_izo_import_storno','fn_izo_activeaza_si_importa')
                  AND a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) NOT IN ('izo_registru_writer','postgres'))) THEN
      v := array_append(v, 'EXECUTE pe funcțiile registrului pentru alt rol decât writer / postgres (allowlist)');
    END IF;
    -- wrapper-e (plasă de siguranță peste allowlist): o funcție cu alt owner decât writer-ul sau un view / o regulă care cheamă funcțiile registrului ar
    -- deveni o cale nouă spre ele (Codex r5 6) — acceptate doar după review, cu actualizarea acestei porți
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner <> 'izo_registru_writer'::regrole
                AND p.oid <> 'public.fn_izo_porti_lipsa()'::regprocedure   -- poarta însăși le numește în verificarea ACL
                -- corpul complet: prosrc (plpgsql / sql clasic) + corpul BEGIN ATOMIC (prosrc gol, corpul în prosqlbody) — review r7
                AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), ''))
                    ~* 'fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)')   -- fără majuscule (N3)
       OR EXISTS (SELECT 1 FROM pg_rewrite rw WHERE pg_get_ruledef(rw.oid) ~* 'fn_izo_(seteaza_nivel|import_sold_initial|import_storno|activeaza_si_importa)') THEN
      v := array_append(v, 'o funcție / un view din afara writer-ului cheamă funcțiile registrului (wrapper nerevizuit)');
    END IF;
    -- CITIRILE (acțiunea 6, Codex r4 / Jakarinos r6–r10): filtrarea citirii (RLS restrictiv + fn_izo_citire) se poate ocoli
    -- fără niciun trigger de scriere printr-un view cu drepturile ownerului sau printr-o funcție DEFINER care întoarce rânduri.
    -- Inventarul de pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): 0 view-uri, 0 funcții care ating
    -- magazie_bucati, 5 DEFINER cu SQL dinamic pe tabele fixe (profiles / executie_proiecte), neexpuse. Porțile de mai jos
    -- refuză activarea dacă apare ceva nou, nerevizuit (r11: porți pe tipuri; r12: închiderea tranzitivă de mai jos):
    -- r12 (Jakarinos + Copilot r11): ÎNCHIDEREA TRANZITIVĂ a tot ce poate citi registrul, până la punct fix:
    --   sămânța = tabelele registrului + funcțiile cu SQL dinamic (pot citi orice tabel) din afara listei revizuite;
    --   se adaugă repetat: view-urile / view-urile materializate care depind (pg_depend → pg_rewrite) de ceva din închidere
    --   (inclusiv cele security_invoker — un DEFINER care le citește le ocolește RLS-ul), și funcțiile (orice schemă
    --   non-sistem, în afara public.fn_izo_*) al căror corp NUMEȘTE ceva din închidere (în public: numele simplu; în alte
    --   scheme: schema.nume) sau depind de el în catalog (corpuri BEGIN ATOMIC).
    -- Refuz dacă în închidere apare: un view fără security_invoker, un view materializat sau o funcție SECURITY DEFINER.
    -- Funcțiile DEFINER cu SQL dinamic din afara listei revizuite sunt refuzate oricum (citesc orice, fără să numească).
    DECLARE
      c_rel oid[]; c_fn oid[] := '{}'; v_marime int := -1; v_iter int := 0; c_mut oid[] := '{}';
      -- funcțiile DEFINER cu SQL dinamic revizuite pe live (docs/izometrie/E2A_INVENTAR_CITIRI.md, 21.10.2026): tabele fixe
      -- (executie_proiecte / profiles), identificatori pe listă albă. Amprenta excepției = md5(prosrc | proconfig | owner |
      -- proacl | prosecdef) (Jakarinos r12): orice schimbare de corp, search_path, owner sau drepturi cere review
      c_dinamice_revizuite text[] := ARRAY[
        '_completare_goleste_camp(bigint,text,integer)=888fde4d4e7fbea6889835dd96c2225d',
        '_completare_scrie_camp(bigint,text,text)=77d7b091a049ccc86b47d078957db39f',
        'fn_cont_inchide(uuid,text,text,integer)=c4a6ca93a52ca8a97aa90f168debf30e',
        'fn_cont_restaureaza_flaguri(uuid,jsonb)=ecd803a2dda6b734ea92ebaf10564397',
        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',
        'fn_tichete_notif_on_insert()=1ffa41a8750b6d48d721d9e2a00b3f54'];
      -- limitele unui identificator, inclusiv citat („"teste".f()”), fără \m / \M (ghilimelele nu sunt caractere de cuvânt)
      c_st constant text := '(^|[^[:alnum:]_$"])"?';
      c_dr constant text := '"?($|[^[:alnum:]_$])';
      -- schemele platformei Supabase: obiectele lor din închidere (funcții INVOKER cu SQL dinamic: realtime.cast, storage.search…)
      -- se potrivesc necalificat DOAR când schema e în search_path-ul funcției; ale noastre (orice altă schemă) se potrivesc
      -- necalificat ÎNTOTDEAUNA — conservator, fals-pozitivele sunt acceptate (Copilot r12 P1)
      c_scheme_platforma constant text[] := ARRAY['auth','storage','realtime','extensions','graphql','graphql_public','vault','net',
                                                  'supabase_functions','supabase_migrations','pgbouncer','pgsodium','pgsodium_masks','cron'];
      -- r5d (20261103b): aceeași semantică, evaluare SEMI-NAIVĂ — fiecare element nou al închiderii se caută o singură dată,
      -- cu alternanța numelor din frontieră (r5f: pe bucăți mărginite, nu o singură expresie); corpurile se citesc o dată
      k_oid oid[]; k_corp text[]; k_cale text[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
      -- r5f (#825 NO-GO): tiparele frontierei, pe bucăți: a_x = alternanța (≤ ~4000 de caractere), a_s = schema de platformă
      -- căreia i se aplică (NULL = oricărei funcții)
      a_s text[]; a_x text[];
      k_i int; k_n int; k_s text; k_s2 text; k_adanc oid[] := '{}';
    BEGIN
      SELECT array_agg(c.oid) INTO c_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
      -- funcțiile cu SQL dinamic (orice EXECUTE), în afara registrului și a listei revizuite: în închidere de la început
      SELECT coalesce(array_agg(p.oid), '{}') INTO c_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
         AND (p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '')) ~* '\mexecute\M'
         AND format('%s=%s', p.oid::regprocedure::text, md5(p.prosrc || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner)
                                                           || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text))
             <> ALL (c_dinamice_revizuite);
      -- corpurile candidate (orice schemă non-sistem, în afara public.fn_izo_*), o singură dată; calea fixată în proconfig
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
      FOR k_i IN 1 .. cardinality(k_corp) LOOP
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
      IF EXISTS (SELECT 1 FROM pg_class vw WHERE vw.oid = ANY (c_rel)   -- alias ≠ variabila v
                  AND (vw.relkind = 'm' OR (vw.relkind = 'v' AND NOT coalesce(vw.reloptions && ARRAY['security_invoker=true','security_invoker=on','security_invoker=1'], false)))) THEN
        v := array_append(v, 'un view / view materializat citește registrul fără security_invoker (citire nerevizuită)');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = ANY (c_fn) AND p.prosecdef) THEN
        v := array_append(v, 'o funcție DEFINER din afara registrului poate citi registrul — direct, prin view sau tranzitiv (citire nerevizuită)');
      END IF;
    END;
    -- writer-ul are exact ce-i trebuie (un GRANT retras ar lăsa activarea admisă și importul nefuncțional)
    -- câte un privilegiu pe rând: has_table_privilege(…, 'A,B') e adevărat dacă există ORICARE (Codex r4 8)
    IF EXISTS (SELECT 1 FROM (VALUES ('magazie_bucati','SELECT'), ('magazie_bucati','INSERT'), ('magazie_bucati','UPDATE'),
                                     ('magazie_bucati_evenimente','SELECT'), ('magazie_bucati_evenimente','INSERT'),
                                     ('magazie_bucati_miscari','SELECT'), ('magazie_bucati_miscari','INSERT'),
                                     ('izo_importuri','SELECT'), ('izo_importuri','INSERT'), ('izo_importuri','UPDATE'),
                                     ('izo_proiect_config','SELECT'), ('izo_proiect_config','INSERT'), ('izo_proiect_config','UPDATE'),
                                     ('izo_atribuiri','SELECT')) d(t, pr)
                WHERE NOT has_table_privilege('izo_registru_writer', 'public.' || d.t, d.pr))
       OR NOT (true
            AND has_sequence_privilege('izo_registru_writer', 'public.izo_server_ver_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_evenimente_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.magazie_bucati_miscari_id_seq', 'USAGE')
            AND has_sequence_privilege('izo_registru_writer', 'public.izo_importuri_id_seq', 'USAGE')) THEN
      v := array_append(v, 'drepturile writer-ului (tabele / secvențe) incomplete');
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) a(n) WHERE has_table_privilege(a.n, 'public.magazie_bucati', 'TRUNCATE')) THEN
      v := array_append(v, 'TRUNCATE pe magazie_bucati pentru un rol API');
    END IF;
    -- definițiile (nu doar numele): amprenta curentă = cea fixată la migrare (review #806 r2)
    IF public.fn_izo_porti_definitii() IS DISTINCT FROM
       substring(obj_description('public.fn_izo_porti_definitii()'::regprocedure, 'pg_proc') FROM '^porti=([0-9a-f]{32})$') THEN
      v := array_append(v, 'definițiile porților diferă de amprenta de la migrare (trigger / politică / funcție / ACL modificat)');
    END IF;
    -- E3 (20261103b): poarta documentelor de intrare, chemată de aici, ca orice activare / import E2a s-o includă (r5d §13.1)
    v := v || public.fn_izo_porti_e3_lipsa();
    RETURN v;
  END $f$;

  -- ── G. trigger-ul documentelor (imutabilitate + scriitorii permiși) ───────────────────────────────────
  CREATE FUNCTION public.fn_izo_doc_garda() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_doc public.izo_documente_intrare; v_doc_id bigint;
    c_neschimbate constant text[] := ARRAY['id', 'proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire', 'creat_de', 'creat_la'];
    c_confirmare constant text[] := ARRAY['stare', 'hash_confirmat', 'avertismente', 'confirmat_de', 'confirmat_la', 'eveniment_intrare_id',
      'pv_nr', 'pv_nr_canon', 'pv_data', 'pv_pus_de', 'pv_pus_la', 'eveniment_pv_id', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv',
      'eveniment_storno_intrare_id', 'eveniment_storno_pv_id'];
    c_anulare constant text[] := ARRAY['stare', 'versiune', 'updated_at', 'anulat_de', 'anulat_de_rol', 'anulat_la', 'anulat_motiv'];
    c_gen_doc constant text[] := ARRAY['furnizor_canon', 'nr_document_canon'];
  BEGIN
    IF TG_OP = 'TRUNCATE' THEN
      RAISE EXCEPTION 'izo E3: TRUNCATE pe % e refuzat' , TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    v_doc_id := CASE WHEN TG_TABLE_NAME = 'izo_documente_intrare' THEN coalesce(NEW.id, OLD.id)
                     ELSE coalesce((to_jsonb(NEW) ->> 'document_id')::bigint, (to_jsonb(OLD) ->> 'document_id')::bigint) END;
    -- scriitorul registrului: doar ce acceptă garda E3, în contextul operației
    IF current_user = 'izo_receptie_writer' THEN
      PERFORM public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    -- editorul draftului: doar pe documente draft, versiunea +1, coloanele confirmării / PV / anulării neatinse
    IF current_user = 'izo_doc_editor' THEN
      IF TG_TABLE_NAME = 'izo_documente_intrare' THEN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'izo E3: antetul unui document nu se șterge (un draft abandonat se anulează)' USING ERRCODE = '42501';
        ELSIF TG_OP = 'INSERT' THEN
          IF NEW.stare <> 'draft' OR NEW.versiune <> 1 OR NEW.creat_de IS DISTINCT FROM public.fn_izo_uid()
             OR (public.fn_izo_proiectie(to_jsonb(NEW), array_remove(c_confirmare, 'stare')) <> public.fn_izo_proiectie('{}'::jsonb, array_remove(c_confirmare, 'stare'))) THEN
            RAISE EXCEPTION 'izo E3: un document nou e draft, versiunea 1, fără confirmare / PV / anulare' USING ERRCODE = '42501';
          END IF;
        ELSIF OLD.stare = 'draft' AND NEW.stare = 'anulat' THEN
          -- r5d §13.3: gestionarul își anulează ciorna — DOAR antetul, DOAR coloanele anulării, autorul = utilizatorul curent
          IF NEW.versiune <> OLD.versiune + 1 OR NEW.anulat_de IS DISTINCT FROM public.fn_izo_uid() OR NEW.anulat_de IS NULL
             OR NEW.anulat_de_rol IS DISTINCT FROM session_user::text OR NEW.anulat_la IS NULL OR NEW.anulat_motiv IS NULL
             OR (to_jsonb(NEW) - c_anulare - c_gen_doc) IS DISTINCT FROM (to_jsonb(OLD) - c_anulare - c_gen_doc) THEN
            RAISE EXCEPTION 'izo E3: anularea ciornei schimbă doar starea, versiunea (+1) și coloanele anulării, cu autorul curent' USING ERRCODE = '42501';
          END IF;
        ELSE
          IF OLD.stare <> 'draft' OR NEW.stare <> 'draft' OR NEW.versiune <> OLD.versiune + 1
             OR public.fn_izo_proiectie(to_jsonb(NEW), c_neschimbate || c_confirmare) IS DISTINCT FROM public.fn_izo_proiectie(to_jsonb(OLD), c_neschimbate || c_confirmare) THEN
            RAISE EXCEPTION 'izo E3: draftul se editează doar cu versiunea +1, fără a schimba proiectul / depozitul / șablonul / înlocuirea / confirmarea'
              USING ERRCODE = '42501';
          END IF;
        END IF;
      ELSE
        SELECT * INTO v_doc FROM public.izo_documente_intrare WHERE id = v_doc_id;
        IF NOT FOUND OR v_doc.stare <> 'draft' OR TG_OP = 'UPDATE'
           OR (TG_TABLE_NAME = 'izo_documente_intrare_randuri' AND TG_OP = 'INSERT' AND (to_jsonb(NEW) ->> 'bucata_id') IS NOT NULL) THEN
          RAISE EXCEPTION 'izo E3: rândurile / scanurile se schimbă doar pe un draft (înlocuire, fără UPDATE)' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'izo E3: documentele de intrare se scriu doar prin funcțiile E3 (rolul curent %)', current_user USING ERRCODE = '42501';
  END $f$;
  CREATE TRIGGER trg_izo_doc_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_documente_intrare
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_doc_garda();
  CREATE TRIGGER trg_izo_doc_rand_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_documente_intrare_randuri
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_doc_garda();
  CREATE TRIGGER trg_izo_doc_scan_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_documente_scanuri
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_doc_garda();
  CREATE TRIGGER trg_izo_doc_truncate BEFORE TRUNCATE ON public.izo_documente_intrare
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_doc_garda();
  CREATE TRIGGER trg_izo_doc_rand_truncate BEFORE TRUNCATE ON public.izo_documente_intrare_randuri
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_doc_garda();
  CREATE TRIGGER trg_izo_doc_scan_truncate BEFORE TRUNCATE ON public.izo_documente_scanuri
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_doc_garda();
  ALTER TABLE public.izo_documente_intrare ENABLE ALWAYS TRIGGER trg_izo_doc_garda;
  ALTER TABLE public.izo_documente_intrare_randuri ENABLE ALWAYS TRIGGER trg_izo_doc_rand_garda;
  ALTER TABLE public.izo_documente_scanuri ENABLE ALWAYS TRIGGER trg_izo_doc_scan_garda;
  ALTER TABLE public.izo_documente_intrare ENABLE ALWAYS TRIGGER trg_izo_doc_truncate;
  ALTER TABLE public.izo_documente_intrare_randuri ENABLE ALWAYS TRIGGER trg_izo_doc_rand_truncate;
  ALTER TABLE public.izo_documente_scanuri ENABLE ALWAYS TRIGGER trg_izo_doc_scan_truncate;

  -- ── H. porțile E3 (definițiile + lista lipsurilor; ștampilă proprie) ──────────────────────────────────
  CREATE FUNCTION public.fn_izo_porti_e3_definitii() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT md5(concat_ws(' | ',
      (SELECT string_agg(pg_get_indexdef(i.oid), ',' ORDER BY i.relname) FROM pg_class i
        WHERE i.relkind = 'i' AND i.relnamespace = 'public'::regnamespace
          AND i.relname IN ('ux_magbuc_ev_doc_intrare', 'ux_magbuc_ev_doc_pv', 'ux_izo_doc_identitate', 'ux_magbuc_izo_aviz_rand',
                            'ux_magbuc_izo_radacina', 'ux_magbuc_izo_frunza', 'ux_magbuc_izo_curba')),
      (SELECT string_agg(format('%s:%s:%s:%s:%s', c.relname, pg_get_userbyid(c.relowner), coalesce(c.relacl::text, ''), c.relrowsecurity,
                                c.relforcerowsecurity), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_documente_intrare', 'izo_documente_intrare_randuri', 'izo_documente_scanuri', 'magazie_bucati',
                            'magazie_bucati_evenimente', 'magazie_bucati_miscari', 'magazie_bucati_id_seq', 'izo_server_ver_seq')),
      -- privilegiile pe COLOANE (Jak r5c, cerința 2): relacl nu le vede
      (SELECT string_agg(format('%s.%s:%s:%s', c.relname, a.attname, coalesce(a.attacl::text, ''), a.attgenerated), ',' ORDER BY c.relname, a.attname)
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
          AND c.relname IN ('izo_documente_intrare', 'izo_documente_intrare_randuri', 'izo_documente_scanuri', 'magazie_bucati',
                            'magazie_bucati_evenimente', 'magazie_bucati_miscari')),
      (SELECT string_agg(format('%s.%s:%s', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid)), ',' ORDER BY c.conrelid::regclass::text, c.conname)
         FROM pg_constraint c WHERE c.conrelid IN ('public.izo_documente_intrare'::regclass, 'public.izo_documente_intrare_randuri'::regclass,
              'public.izo_documente_scanuri'::regclass, 'public.magazie_bucati_evenimente'::regclass)
            OR (c.conrelid = 'public.magazie_bucati'::regclass AND c.conname = 'magazie_bucati_izo_aviz_fkey')),
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s:%s', p.polrelid::regclass, p.polname, p.polcmd, p.polpermissive,
                                (SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')),
                         ',' ORDER BY p.polrelid::regclass::text, p.polname)
         FROM pg_policy p WHERE p.polrelid IN ('public.izo_documente_intrare'::regclass, 'public.izo_documente_intrare_randuri'::regclass,
              'public.izo_documente_scanuri'::regclass)
            -- r5f (#825 NO-GO, P1-3; coordonat cu chat 21.10): pe storage.objects / storage.buckets doar politicile E3 (izo_doc_*),
            -- exact. Stratul RESTRICTIV face ca nicio politică a altui modul (permisivă sau restrictivă, cu orice nume) să nu poată
            -- deschide izo-documente, deci politicile Storage ale altor module (ex. 20261103c, ai-documente-inbox) NU intră în
            -- ștampilă și nu o înroșesc. Ce poate slăbi stratul — RLS / FORCE / owner / ACL pe cele două tabele — e mai jos.
            OR (p.polrelid IN ('storage.objects'::regclass, 'storage.buckets'::regclass) AND p.polname LIKE 'izo\_doc\_%')),
      -- r5f (#825 NO-GO, P1-4): definiția COMPLETĂ (pg_get_triggerdef: momentul, evenimentele, UPDATE OF, WHEN, argumentele,
      -- funcția) + starea; un trigger recreat cu WHEN / UPDATE OF schimbă ștampila
      (SELECT string_agg(format('%s.%s:%s:%s', g.tgrelid::regclass, g.tgname, pg_get_triggerdef(g.oid, false), g.tgenabled), ','
                         ORDER BY g.tgrelid::regclass::text, g.tgname)
         FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgrelid IN ('public.izo_documente_intrare'::regclass,
              'public.izo_documente_intrare_randuri'::regclass, 'public.izo_documente_scanuri'::regclass, 'public.profiles'::regclass)
              AND (g.tgrelid <> 'public.profiles'::regclass OR g.tgname IN ('prevent_role_escalation_trigger', 'trg_profiles_campuri_owner_only'))),
      (SELECT string_agg(format('%s:%s:%s:%s:%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef, coalesce(p.proconfig::text, ''), md5(p.prosrc)),
                         ',' ORDER BY p.oid::regprocedure::text)
         FROM pg_proc p WHERE p.oid IN (SELECT g.tgfoid FROM pg_trigger g WHERE g.tgrelid = 'public.profiles'::regclass
                                         AND g.tgname IN ('prevent_role_escalation_trigger', 'trg_profiles_campuri_owner_only'))),
      (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s:%s', r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
                                (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ','
                                                   ORDER BY pg_get_userbyid(m.member)::text, m.admin_option, m.inherit_option, m.set_option)
                                   FROM pg_auth_members m WHERE m.roleid = r.oid)), ',' ORDER BY r.rolname)
         FROM pg_roles r WHERE r.rolname IN ('izo_doc_editor', 'izo_receptie_writer')),
      (SELECT string_agg(format('%s:%s:%s:%s', b.id, b.public, b.file_size_limit, coalesce(b.allowed_mime_types::text, '')), ',')
         FROM storage.buckets b WHERE b.id = 'izo-documente'),
      -- r5f (#825 NO-GO, P1-3): storage.objects / storage.buckets — owner, RLS, FORCE, ACL (un DISABLE RLS / GRANT nou schimbă ștampila)
      (SELECT string_agg(format('%s.%s:%s:%s:%s:%s', n.nspname, c.relname, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity,
                                coalesce(c.relacl::text, '')), ',' ORDER BY c.relname)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE (n.nspname, c.relname) IN (('storage', 'objects'), ('storage', 'buckets')))))
  $f$;

  CREATE FUNCTION public.fn_izo_porti_e3_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v text[] := '{}'; r record;
  BEGIN
    IF public.fn_izo_porti_e3_definitii() IS DISTINCT FROM
       substring(obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure, 'pg_proc') FROM '^porti_e3=([0-9a-f]{32})$') THEN
      v := array_append(v, 'definițiile E3 (indexuri / ACL pe tabele și coloane / politici / trigger-e / roluri / bucket / storage.objects / storage.buckets) diferă de amprenta de la migrare');
    END IF;
    -- r5f (#825 NO-GO, P1-3): Storage, cerut explicit (nu doar prin ștampilă): RLS activ pe storage.objects, bucket-ul privat,
    -- cele 5 politici RESTRICTIVE ale bucket-ului la locul lor
    IF (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'objects') IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'izo-documente' AND b.public IS FALSE)
       OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'storage' AND c.relname = 'objects' AND NOT p.polpermissive
              AND p.polname IN ('izo_doc_scan_r_toti', 'izo_doc_scan_r_sel', 'izo_doc_scan_r_ins', 'izo_doc_scan_r_del', 'izo_doc_scan_r_upd')) <> 5 THEN
      v := array_append(v, 'Storage: RLS pe storage.objects / bucket-ul izo-documente privat / politicile RESTRICTIVE izo_doc_scan_r_*');
    END IF;
    -- r5f (#825 NO-GO, a doua ușă): rândul bucket-ului, cerut explicit — RLS activ pe storage.buckets și cele 3 politici
    -- RESTRICTIVE izo_doc_bucket_r_* (fără INSERT / UPDATE / DELETE pe rândul izo-documente) la locul lor
    IF (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'storage' AND c.relname = 'buckets') IS NOT TRUE
       OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'storage' AND c.relname = 'buckets' AND NOT p.polpermissive
              AND p.polname IN ('izo_doc_bucket_r_ins', 'izo_doc_bucket_r_upd', 'izo_doc_bucket_r_del')) <> 3 THEN
      v := array_append(v, 'Storage: RLS pe storage.buckets / politicile RESTRICTIVE izo_doc_bucket_r_* pe rândul bucket-ului izo-documente');
    END IF;
    -- rolurile: fără LOGIN / SUPERUSER / BYPASSRLS / INHERIT / CREATEROLE / CREATEDB; membru doar postgres (SET, fără INHERIT);
    -- (PG16+: rândul ADMIN automat al creatorului nesuperuser e acceptat, ca la E2a); rolurile nu sunt membre în alt rol
    FOR r IN SELECT n FROM unnest(ARRAY['izo_doc_editor', 'izo_receptie_writer']) n LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.n AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit
                      AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
         OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.n::regrole AND m.member <> 'postgres'::regrole)
         OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.n::regrole AND m.member = 'postgres'::regrole AND m.set_option)
         OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.n::regrole AND m.inherit_option)
         OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.n::regrole)
         OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'authenticator']) a(x)
                     WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = a.x) AND pg_has_role(a.x, r.n, 'MEMBER')) THEN
        v := array_append(v, format('rolul %s (atribute / membri)', r.n));
      END IF;
    END LOOP;
    -- trigger-ele documentelor ENABLE ALWAYS; RLS activ
    IF (SELECT count(*) FROM pg_trigger WHERE tgenabled = 'A' AND tgname IN ('trg_izo_doc_garda', 'trg_izo_doc_rand_garda', 'trg_izo_doc_scan_garda',
          'trg_izo_doc_truncate', 'trg_izo_doc_rand_truncate', 'trg_izo_doc_scan_truncate')) <> 6
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['izo_documente_intrare', 'izo_documente_intrare_randuri', 'izo_documente_scanuri']) t(n)
                   LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.n) WHERE c.relrowsecurity IS NOT TRUE) THEN
      v := array_append(v, 'trigger-ele / RLS pe tabelele documentelor');
    END IF;
    -- mulțimea exactă de coloane (C) și privilegiile pe coloane ale scriitorului E3
    IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
         WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '')
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(public.fn_izo_coloane_c() || ARRAY['id', 'uid', 'radacina_id', 'server_ver', 'created_at', 'updated_at']) x)
       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege('izo_receptie_writer', 'public.magazie_bucati', a.attname, 'INSERT')
                       IS DISTINCT FROM (a.attname::text = ANY (public.fn_izo_coloane_c() || ARRAY['id', 'uid', 'radacina_id', 'server_ver'])))
       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege('izo_receptie_writer', 'public.magazie_bucati', a.attname, 'UPDATE')
                       IS DISTINCT FROM (a.attname::text IN ('stare', 'server_ver', 'updated_at')))
       OR has_table_privilege('izo_receptie_writer', 'public.magazie_bucati', 'DELETE')
       OR has_table_privilege('izo_doc_editor', 'public.magazie_bucati', 'INSERT') OR has_table_privilege('izo_doc_editor', 'public.magazie_bucati', 'UPDATE')
       OR has_table_privilege('izo_doc_editor', 'public.magazie_bucati_evenimente', 'INSERT')
       OR has_table_privilege('izo_doc_editor', 'public.magazie_bucati_miscari', 'INSERT')
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['izo_proiect_config', 'izo_importuri', 'izo_atribuiri']) t(n), unnest(ARRAY['izo_doc_editor', 'izo_receptie_writer']) rl(x)
                   WHERE has_table_privilege(rl.x, 'public.' || t.n, 'INSERT') OR has_table_privilege(rl.x, 'public.' || t.n, 'UPDATE')) THEN
      v := array_append(v, 'coloanele registrului (C) sau privilegiile pe coloane ale rolurilor E3');
    END IF;
    -- API-ul nu scrie direct documentele; nu execută funcțiile interne E3
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_documente_intrare', 'izo_documente_intrare_randuri', 'izo_documente_scanuri']) t(n),
                             unnest(ARRAY['anon', 'authenticated', 'service_role']) a(x), unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(y)
                WHERE has_table_privilege(a.x, 'public.' || t.n, p.y))
       OR EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon', 'authenticated', 'service_role']) a(x)
                   WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege(a.x, p.oid, 'EXECUTE')
                     AND p.proname IN ('fn_izo_doc_anuleaza', 'fn_izo_receptie_marcheaza', 'fn_izo_garda_receptie', 'fn_izo_doc_autorizare_lock',
                                       'fn_izo_doc_bucata_asteptata', 'fn_izo_eveniment_asteptat', 'fn_izo_miscare_asteptata', 'fn_izo_scan_exista',
                                       'fn_izo_doc_hash', 'fn_izo_doc_blocante', 'fn_izo_doc_avertismente', 'fn_izo_jwt_rol'))
       OR EXISTS (SELECT 1 FROM pg_proc p, unnest(ARRAY['anon', 'service_role']) a(x)
                   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_doc\_%' AND has_function_privilege(a.x, p.oid, 'EXECUTE')) THEN
      v := array_append(v, 'ACL: API-ul poate scrie documentele sau executa funcțiile interne E3');
    END IF;
    RETURN v;
  END $f$;

  -- verificările comune ale intrărilor API (§3.3 + r5d §13.2): lock-ul „schemă” (cheia runner-ului de migrări, PARTAJAT,
  -- ținut până la commit) ÎNAINTEA oricărui alt lock, apoi identitatea din gateway, contextul gol și poarta COMPLETĂ (E2a + E3,
  -- ≈ 0,4 s), într-o instrucțiune separată (READ COMMITTED: snapshot nou, după lock)
  CREATE FUNCTION public.fn_izo_doc_api_verifica() RETURNS uuid
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; v_lipsa text[];
  BEGIN
    -- r5f (#825 NO-GO): READ COMMITTED impus, nu presupus — mecanismul E2a (fn_izo_lock_partajat / garda pe bucăți), aici,
    -- înaintea oricărui lock: sub REPEATABLE READ / SERIALIZABLE poarta de după lock-ul „schemă” ar citi cataloagele pe
    -- snapshot-ul de dinainte de lock. Acoperă salveaza / verifica / anuleaza_draft / confirma / pv (anuleaza o are separat)
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'izo E3: intrările E3 cer READ COMMITTED (acum %)', current_setting('transaction_isolation') USING ERRCODE = '25001';
    END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF session_user IS DISTINCT FROM 'authenticator' OR public.fn_izo_jwt_rol() IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION 'izo E3: intrările se cheamă doar din API, ca utilizator autentificat' USING ERRCODE = '42501';
    END IF;
    v_uid := public.fn_izo_uid();
    IF v_uid IS NULL THEN RAISE EXCEPTION 'izo E3: utilizator neautentificat' USING ERRCODE = '42501'; END IF;
    IF coalesce(current_setting('izo.receptie_ctx', true), '') <> '' THEN
      RAISE EXCEPTION 'izo E3: o altă operație E3 rulează deja în această tranzacție' USING ERRCODE = '42501';
    END IF;
    v_lipsa := public.fn_izo_porti_lipsa();   -- include și poarta E3
    IF cardinality(v_lipsa) <> 0 THEN
      RAISE EXCEPTION 'izo E3: porțile registrului nu sunt complete: %', v_lipsa USING ERRCODE = '42501';
    END IF;
    RETURN v_uid;
  END $f$;

  -- ── I. intrările API ─────────────────────────────────────────────────────────────────────────────────

  -- salvarea draftului (§5, r5d): creare / editare, CAS pe versiune, rândurile și (opțional) manifestul înlocuite integral
  CREATE FUNCTION public.fn_izo_doc_salveaza(p_doc_id bigint, p_versiune bigint, p_antet jsonb, p_randuri jsonb, p_scanuri jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; d public.izo_documente_intrare; v_k text; v_x jsonb; v_tp bigint; v_td integer;
    c_antet constant text[] := ARRAY['furnizor', 'furnizor_cif', 'nr_document', 'data_document', 'cumparator', 'transport_nr', 'nume_proiect', 'lot', 'loc_livrare', 'data_incarcare', 'data_descarcare', 'nr_camion', 'factura', 'importator', 'destinatar', 'referinta_client', 'referinta_furnizor', 'placa_camion_container', 'total_m', 'total_kg', 'total_bucati', 'total_pachete', 'total_net_kg', 'total_brut_kg', 'observatii'];
    c_creare constant text[] := ARRAY['proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire'];
    c_rand constant text[] := ARRAY['nr_crt', 'serie', 'sarja', 'lot', 'specificatie', 'dimensiune', 'grad_otel', 'standard', 'izolatie', 'diametru_mm', 'perete_mm', 'greutate_kg', 'lungime_doc_mm', 'lungime_masurata_mm', 'cod', 'item', 'unghi_doc', 'unghi_masurat', 'cantitate', 'pachet_nr', 'dimensiuni_cm', 'net_kg', 'brut_kg', 'decizie', 'motiv', 'observatie'];
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
      INSERT INTO public.izo_documente_intrare (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, furnizor, furnizor_cif, nr_document, data_document, cumparator, transport_nr, nume_proiect, lot, loc_livrare, data_incarcare, data_descarcare, nr_camion, factura, importator, destinatar, referinta_client, referinta_furnizor, placa_camion_container, total_m, total_kg, total_bucati, total_pachete, total_net_kg, total_brut_kg, observatii)
      VALUES ((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, p_antet ->> 'sablon',
              (p_antet ->> 'inlocuieste_document_id')::bigint, p_antet ->> 'motiv_inlocuire', v_uid, p_antet ->> 'furnizor', p_antet ->> 'furnizor_cif', p_antet ->> 'nr_document', (p_antet ->> 'data_document')::date, p_antet ->> 'cumparator', p_antet ->> 'transport_nr', p_antet ->> 'nume_proiect', p_antet ->> 'lot', p_antet ->> 'loc_livrare', (p_antet ->> 'data_incarcare')::date, (p_antet ->> 'data_descarcare')::date, p_antet ->> 'nr_camion', p_antet ->> 'factura', p_antet ->> 'importator', p_antet ->> 'destinatar', p_antet ->> 'referinta_client', p_antet ->> 'referinta_furnizor', p_antet ->> 'placa_camion_container', (p_antet ->> 'total_m')::numeric, (p_antet ->> 'total_kg')::numeric, (p_antet ->> 'total_bucati')::integer, (p_antet ->> 'total_pachete')::integer, (p_antet ->> 'total_net_kg')::numeric, (p_antet ->> 'total_brut_kg')::numeric, p_antet ->> 'observatii')
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
        furnizor = p_antet ->> 'furnizor',
        furnizor_cif = p_antet ->> 'furnizor_cif',
        nr_document = p_antet ->> 'nr_document',
        data_document = (p_antet ->> 'data_document')::date,
        cumparator = p_antet ->> 'cumparator',
        transport_nr = p_antet ->> 'transport_nr',
        nume_proiect = p_antet ->> 'nume_proiect',
        lot = p_antet ->> 'lot',
        loc_livrare = p_antet ->> 'loc_livrare',
        data_incarcare = (p_antet ->> 'data_incarcare')::date,
        data_descarcare = (p_antet ->> 'data_descarcare')::date,
        nr_camion = p_antet ->> 'nr_camion',
        factura = p_antet ->> 'factura',
        importator = p_antet ->> 'importator',
        destinatar = p_antet ->> 'destinatar',
        referinta_client = p_antet ->> 'referinta_client',
        referinta_furnizor = p_antet ->> 'referinta_furnizor',
        placa_camion_container = p_antet ->> 'placa_camion_container',
        total_m = (p_antet ->> 'total_m')::numeric,
        total_kg = (p_antet ->> 'total_kg')::numeric,
        total_bucati = (p_antet ->> 'total_bucati')::integer,
        total_pachete = (p_antet ->> 'total_pachete')::integer,
        total_net_kg = (p_antet ->> 'total_net_kg')::numeric,
        total_brut_kg = (p_antet ->> 'total_brut_kg')::numeric,
        observatii = p_antet ->> 'observatii',
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
    INSERT INTO public.izo_documente_intrare_randuri (document_id, nr_crt, serie, sarja, lot, specificatie, dimensiune, grad_otel, standard, izolatie, diametru_mm, perete_mm, greutate_kg, lungime_doc_mm, lungime_masurata_mm, cod, item, unghi_doc, unghi_masurat, cantitate, pachet_nr, dimensiuni_cm, net_kg, brut_kg, decizie, motiv, observatie)
    SELECT d.id, (x ->> 'nr_crt')::integer, x ->> 'serie', x ->> 'sarja', x ->> 'lot', x ->> 'specificatie', x ->> 'dimensiune', x ->> 'grad_otel', x ->> 'standard', x ->> 'izolatie', (x ->> 'diametru_mm')::integer, (x ->> 'perete_mm')::numeric, (x ->> 'greutate_kg')::numeric, (x ->> 'lungime_doc_mm')::integer, (x ->> 'lungime_masurata_mm')::integer, x ->> 'cod', x ->> 'item', (x ->> 'unghi_doc')::numeric, (x ->> 'unghi_masurat')::numeric, (x ->> 'cantitate')::integer, x ->> 'pachet_nr', x ->> 'dimensiuni_cm', (x ->> 'net_kg')::numeric, (x ->> 'brut_kg')::numeric, coalesce(x ->> 'decizie', 'primit'), x ->> 'motiv', x ->> 'observatie' FROM jsonb_array_elements(p_randuri) x;
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
        INSERT INTO public.magazie_bucati /*C*/ (id, uid, radacina_id, server_ver, proiect_id, comanda_furnizor_id, tip_material_id, serie, sarja, dimensiune, grad_otel, standard, lungime_m, lungime_originala_m, greutate_kg, unghi_curba, cantitate, um, provenienta, izolatie, furnizor, producator, sursa_receptie, fara_packing_list, nr_document, data_receptie, mtc_path, stare, locatie_tip, locatie_site_id, executie_teava_id, atribute, observatii, receptionat_de, receptionat_la, created_by, tip_cod, parinte_id, cod_bucata, capat_stanga, capat_dreapta, dezambiguare, lungime_aviz_mm, lungime_masurata_mm, lungime_mm, lungime_calculata, perete_mm, diametru_mm, lot, aviz_intrare_id, nr_crt_aviz, bend_no, capat_marcaj, depozit_id, tronson_id)
        SELECT v_id, gen_random_uuid(), v_id, nextval('public.izo_server_ver_seq'), x.proiect_id, x.comanda_furnizor_id, x.tip_material_id, x.serie, x.sarja, x.dimensiune, x.grad_otel, x.standard, x.lungime_m, x.lungime_originala_m, x.greutate_kg, x.unghi_curba, x.cantitate, x.um, x.provenienta, x.izolatie, x.furnizor, x.producator, x.sursa_receptie, x.fara_packing_list, x.nr_document, x.data_receptie, x.mtc_path, x.stare, x.locatie_tip, x.locatie_site_id, x.executie_teava_id, x.atribute, x.observatii, x.receptionat_de, x.receptionat_la, x.created_by, x.tip_cod, x.parinte_id, x.cod_bucata, x.capat_stanga, x.capat_dreapta, x.dezambiguare, x.lungime_aviz_mm, x.lungime_masurata_mm, x.lungime_mm, x.lungime_calculata, x.perete_mm, x.diametru_mm, x.lot, x.aviz_intrare_id, x.nr_crt_aviz, x.bend_no, x.capat_marcaj, x.depozit_id, x.tronson_id
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


  -- ── J. drepturi, RLS, politici ────────────────────────────────────────────────────────────────────────
  -- tabelele documentelor: API doar SELECT (filtrat de RLS); scriu doar rolurile E3, pe coloanele operațiilor (§3.5)
  REVOKE ALL ON TABLE public.izo_documente_intrare, public.izo_documente_intrare_randuri, public.izo_documente_scanuri FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON TABLE public.izo_documente_intrare, public.izo_documente_intrare_randuri, public.izo_documente_scanuri TO authenticated, izo_doc_editor, izo_receptie_writer;
  GRANT INSERT (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, furnizor, furnizor_cif, nr_document, data_document, cumparator, transport_nr, nume_proiect, lot, loc_livrare, data_incarcare, data_descarcare, nr_camion, factura, importator, destinatar, referinta_client, referinta_furnizor, placa_camion_container, total_m, total_kg, total_bucati, total_pachete, total_net_kg, total_brut_kg, observatii) ON public.izo_documente_intrare TO izo_doc_editor;
  GRANT UPDATE (furnizor, furnizor_cif, nr_document, data_document, cumparator, transport_nr, nume_proiect, lot, loc_livrare, data_incarcare, data_descarcare, nr_camion, factura, importator, destinatar, referinta_client, referinta_furnizor, placa_camion_container, total_m, total_kg, total_bucati, total_pachete, total_net_kg, total_brut_kg, observatii, versiune, updated_at, stare, anulat_de, anulat_de_rol, anulat_la, anulat_motiv) ON public.izo_documente_intrare TO izo_doc_editor;
  GRANT UPDATE (stare, versiune, updated_at, hash_confirmat, avertismente, confirmat_de, confirmat_la, eveniment_intrare_id, pv_nr, pv_nr_canon,
                pv_data, pv_pus_de, pv_pus_la, eveniment_pv_id, anulat_de, anulat_de_rol, anulat_la, anulat_motiv, eveniment_storno_intrare_id,
                eveniment_storno_pv_id) ON public.izo_documente_intrare TO izo_receptie_writer;
  GRANT INSERT (document_id, nr_crt, serie, sarja, lot, specificatie, dimensiune, grad_otel, standard, izolatie, diametru_mm, perete_mm, greutate_kg, lungime_doc_mm, lungime_masurata_mm, cod, item, unghi_doc, unghi_masurat, cantitate, pachet_nr, dimensiuni_cm, net_kg, brut_kg, decizie, motiv, observatie), DELETE ON public.izo_documente_intrare_randuri TO izo_doc_editor;
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
  GRANT INSERT (id, uid, radacina_id, server_ver, proiect_id, comanda_furnizor_id, tip_material_id, serie, sarja, dimensiune, grad_otel, standard, lungime_m, lungime_originala_m, greutate_kg, unghi_curba, cantitate, um, provenienta, izolatie, furnizor, producator, sursa_receptie, fara_packing_list, nr_document, data_receptie, mtc_path, stare, locatie_tip, locatie_site_id, executie_teava_id, atribute, observatii, receptionat_de, receptionat_la, created_by, tip_cod, parinte_id, cod_bucata, capat_stanga, capat_dreapta, dezambiguare, lungime_aviz_mm, lungime_masurata_mm, lungime_mm, lungime_calculata, perete_mm, diametru_mm, lot, aviz_intrare_id, nr_crt_aviz, bend_no, capat_marcaj, depozit_id, tronson_id) ON public.magazie_bucati TO izo_receptie_writer;
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
  REVOKE ALL ON FUNCTION public.fn_izo_coloane_c(), public.fn_izo_coloane_ev(), public.fn_izo_coloane_mis(), public.fn_izo_proiectie(jsonb, text[]), public.fn_izo_jwt_rol(), public.fn_izo_canon_serie(text), public.fn_izo_doc_autorizare_lock(bigint, integer), public.fn_izo_scan_exista(text), public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text), public.fn_izo_doc_hash(bigint), public.fn_izo_doc_blocante(bigint), public.fn_izo_doc_avertismente(bigint), public.fn_izo_doc_bucata_asteptata(bigint, integer), public.fn_izo_eveniment_asteptat(text, bigint, bigint, text), public.fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer), public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text), public.fn_izo_garda_receptie(text, text, jsonb, jsonb), public.fn_izo_doc_garda(), public.fn_izo_porti_e3_definitii(), public.fn_izo_porti_e3_lipsa(), public.fn_izo_doc_api_verifica(), public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint), public.fn_izo_doc_anuleaza_draft(bigint, bigint, text), public.fn_izo_doc_confirma(bigint, bigint, text), public.fn_izo_doc_pv(bigint, bigint, text, date), public.fn_izo_doc_anuleaza(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
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
    public.fn_izo_site_proiect(bigint), public.fn_izo_tip_material(text) TO izo_receptie_writer;

  -- ── K. Storage: bucket-ul izo-documente, politicile permisive (fără UPDATE) + stratul RESTRICTIV (r5f) ─────────
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('izo-documente', 'izo-documente', false, 10485760, ARRAY['application/pdf']);
  CREATE POLICY izo_doc_scan_ins ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'izo-documente' AND public.fn_izo_scan_poate_incarca(name));
  CREATE POLICY izo_doc_scan_sel ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'izo-documente' AND public.fn_izo_scan_poate_citi(name));
  CREATE POLICY izo_doc_scan_del ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'izo-documente' AND public.fn_izo_scan_poate_sterge(name));
  -- r5f (#825 NO-GO, P1-3): stratul RESTRICTIV — o politică permisivă generală (existentă sau adăugată) nu mai deschide
  -- bucket-ul. Rândurile cu bucket_id ≠ 'izo-documente' (inclusiv NULL: IS DISTINCT FROM) trec neatinse prin toate cinci.
  -- (1) oricine nu are drepturile lui authenticated: nimic din bucket (fără funcții E3 în predicat: anon nu are EXECUTE pe
  --     fn_izo_scan_poate_*, iar EXECUTE se verifică la inițializarea planului — altfel ar cădea și pe alte bucket-uri);
  CREATE POLICY izo_doc_scan_r_toti ON storage.objects AS RESTRICTIVE FOR ALL TO public
    USING (bucket_id IS DISTINCT FROM 'izo-documente' OR pg_has_role(current_user, 'authenticated', 'USAGE'))
    WITH CHECK (bucket_id IS DISTINCT FROM 'izo-documente' OR pg_has_role(current_user, 'authenticated', 'USAGE'));
  -- (2) authenticated: SELECT / INSERT / DELETE doar prin predicatele E3;
  CREATE POLICY izo_doc_scan_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
    USING (bucket_id IS DISTINCT FROM 'izo-documente' OR public.fn_izo_scan_poate_citi(name));
  CREATE POLICY izo_doc_scan_r_ins ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (bucket_id IS DISTINCT FROM 'izo-documente' OR public.fn_izo_scan_poate_incarca(name));
  CREATE POLICY izo_doc_scan_r_del ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
    USING (bucket_id IS DISTINCT FROM 'izo-documente' OR public.fn_izo_scan_poate_sterge(name));
  -- (3) UPDATE interzis total pe bucket, pentru toți: USING (rândul vechi) și WITH CHECK (rândul nou — și mutarea ÎN bucket)
  CREATE POLICY izo_doc_scan_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
    USING (bucket_id IS DISTINCT FROM 'izo-documente') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-documente');
  -- r5f (#825 NO-GO, a doua ușă): rândul bucket-ului din storage.buckets. O permisivă (existentă sau adăugată) pe buckets nu
  -- face bucket-ul public (endpoint-ul public Storage nu consultă RLS), nu-l șterge și nu-l recreează: INSERT / UPDATE /
  -- DELETE pe rândul izo-documente interzise pentru toți (administrarea rămâne la rolurile cu BYPASSRLS); WITH CHECK oprește
  -- și mutarea altui bucket PE id-ul izo-documente. Celelalte bucket-uri trec neatinse. Fără SELECT: rândul nu e secret.
  CREATE POLICY izo_doc_bucket_r_ins ON storage.buckets AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (id IS DISTINCT FROM 'izo-documente');
  CREATE POLICY izo_doc_bucket_r_upd ON storage.buckets AS RESTRICTIVE FOR UPDATE TO public
    USING (id IS DISTINCT FROM 'izo-documente') WITH CHECK (id IS DISTINCT FROM 'izo-documente');
  CREATE POLICY izo_doc_bucket_r_del ON storage.buckets AS RESTRICTIVE FOR DELETE TO public
    USING (id IS DISTINCT FROM 'izo-documente');

  -- ── L. owner-ii intrărilor + EXECUTE (dat de owner, prin SET ROLE: postgres nu e superuser pe Supabase) ─
  ALTER FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text) OWNER TO izo_receptie_writer;
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
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Livrare 20261103b: rolul nu a revenit la postgres după GRANT'; END IF;

  -- ── M. ștampilele: porțile E2a, porțile E3, amprenta de revenire E2a ──────────────────────────────────
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());

  -- ── postcondiții ──────────────────────────────────────────────────────────────────────────────────────
  -- P5 (r5f, #825 NO-GO): owner-ii intrărilor au EXECUTE pe EXACT semnăturile lanțului de lock-uri pe care îl cheamă (ACL-ul
  -- ștampilat mai sus e cel găsit — un GRANT lipsă n-ar fi văzut de poartă, doar de prima confirmare); fn_izo_lock_partajat
  -- are o singură semnătură (VARIADIC bigint[]), deci apelul explicit nu poate fi umbrit de un overload
  SELECT string_agg(format('%s → %s', r.rol, r.fn), '; ' ORDER BY r.rol, r.fn) INTO v_x
    FROM (VALUES ('izo_receptie_writer', 'public.fn_izo_lock_partajat(bigint[])'), ('izo_receptie_writer', 'public.fn_izo_lock_proiect(bigint, boolean)'),
                 ('izo_receptie_writer', 'public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[])'), ('izo_receptie_writer', 'public.fn_izo_blocheaza_tabele()'),
                 ('izo_receptie_writer', 'pg_catalog.pg_advisory_xact_lock_shared(integer, integer)'),
                 ('izo_receptie_writer', 'pg_catalog.pg_advisory_xact_lock(integer, integer)'),
                 ('izo_receptie_writer', 'pg_catalog.pg_advisory_xact_lock_shared(bigint)'),
                 ('izo_doc_editor', 'pg_catalog.pg_advisory_xact_lock_shared(bigint)')) r(rol, fn)
   WHERE NOT has_function_privilege(r.rol, r.fn, 'EXECUTE');
  IF v_x IS NOT NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_izo_lock_partajat') <> 1 THEN
    RAISE EXCEPTION 'Postcondiție P5: EXECUTE lipsă pe lanțul de lock-uri al intrărilor E3 (%) sau fn_izo_lock_partajat are overload-uri', coalesce(v_x, '-');
  END IF;
  v_lipsa := public.fn_izo_porti_lipsa();   -- include poarta E3
  IF cardinality(v_lipsa) <> 0 THEN
    RAISE EXCEPTION 'Postcondiție P1: porțile nu sunt complete după E3: %', v_lipsa;
  END IF;
  -- lista coloanelor din INSERT-ul confirmării = C ∪ {id, uid, radacina_id, server_ver} (aceeași constantă, r5c)
  v_x := substring((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_doc_confirma(bigint, bigint, text)'::regprocedure)
                   FROM 'INSERT INTO public\.magazie_bucati /\*C\*/ \(([^)]*)\)');
  IF v_x IS NULL OR (SELECT array_agg(btrim(x) ORDER BY btrim(x)) FROM unnest(string_to_array(v_x, ',')) x)
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(public.fn_izo_coloane_c() || ARRAY['id', 'uid', 'radacina_id', 'server_ver']) x) THEN
    RAISE EXCEPTION 'Postcondiție P2: coloanele INSERT-ului din confirmare diferă de C';
  END IF;
  IF pg_get_indexdef('public.ux_magbuc_ev_doc_intrare'::regclass) IS DISTINCT FROM
       'CREATE UNIQUE INDEX ux_magbuc_ev_doc_intrare ON public.magazie_bucati_evenimente USING btree (document_id) WHERE ((document_tip = ''doc_intrare''::text) AND (tip = ANY (ARRAY[''intrare_aviz''::text, ''intrare_lista_ambalare''::text])))'
     OR pg_get_indexdef('public.ux_magbuc_ev_doc_pv'::regclass) IS DISTINCT FROM
       'CREATE UNIQUE INDEX ux_magbuc_ev_doc_pv ON public.magazie_bucati_evenimente USING btree (document_id) WHERE ((document_tip = ''doc_intrare''::text) AND (tip = ''receptie_pv''::text))' THEN
    RAISE EXCEPTION 'Postcondiție P3: indexurile de eveniment diferă de design (§2)';
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
  IF v_amprenta IS NULL OR v_amprenta = v_inainte THEN
    RAISE EXCEPTION 'Postcondiție P4: amprenta de revenire nu s-a putut reface (acum %, înainte %)', v_amprenta, v_inainte;
  END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',
    'Registrul de țeavă Transgaz (izometrie) — evenimente, doar adaug. Scris doar de funcțiile registrului (E2a) și E3 (20261103b). amprenta='
    || v_amprenta || ' inainte_20261103b=' || v_inainte || ' ‖ anterior: ' || v_comentariu);

  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103b_izometrie_e3_documente:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261103b: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
