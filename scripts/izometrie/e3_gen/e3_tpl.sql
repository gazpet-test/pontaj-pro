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
--     storage.buckets (r5f; RLS-ul cerut explicit), mulțimea exactă de coloane (C) a registrului; r5g (#825) NO-GO: invocările
--     implicite ale fn_izo_* (orice obiect din catalog, în afara view-urilor și a funcțiilor, care cheamă una).
-- r5g (#825) NO-GO, în poarta E2a înlocuită aici (fn_izo_porti_lipsa): funcțiile fn_izo_* sunt ținte ale închiderii citirilor
--   (P1-C); invocarea implicită din catalog peste o funcție din închidere → refuz, în afara listei revizuite de pe prod (P1-D);
--   calea devine necunoscută doar la un comentariu lipit de o schemă a platformei (P2).
-- r5h (#825 r5g NO-GO): invocările implicite ale fn_izo_* FIXATE, nu ștampilate cum sunt găsite — precondiția 0m (lista pre-E3
--   revizuită, capturată de pe prod) și postcondiția P6 (lista post-E3 fixă, înainte și după ștampila E3) (Copilot P1); lista
--   albă a invocărilor implicite cu CORPUL funcției în amprentă (Jak P1); invocarea implicită a unui MUTATOR de cale (trigger /
--   DEFAULT … peste o funcție cu set_config / search_path) → refuz ca peste închidere, cu excepții precise (Jak P1). Orice
--   migrare ulterioară care schimbă aceste mulțimi (E3b, E4) re-ștampilează după procedura din design §17.
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
  v_impl text[]; v_impl_rev text[];
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
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_bucati()'::regprocedure)) IS DISTINCT FROM '@@MD5_GB_E2A@@'
     OR md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_izo_garda_fapte()'::regprocedure)) IS DISTINCT FROM '@@MD5_GF_E2A@@' THEN
    RAISE EXCEPTION 'Precondiție 0d: fn_izo_garda_bucati / fn_izo_garda_fapte nu au definiția 20261102a';
  END IF;
  -- mulțimea EXACTĂ de coloane a registrului = C ∪ {id, uid, radacina_id, server_ver, created_at, updated_at} ∪ generate
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
       WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '')
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(@@C_ARRAY@@ || ARRAY['id','uid','radacina_id','server_ver','created_at','updated_at']) x)
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '')
        IS DISTINCT FROM ARRAY['lungime_cm','serie_canon']
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati_evenimente'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(@@EV_ARRAY@@ || ARRAY['id','server_ver','ora_server']) x)
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
          WHERE a.attrelid = 'public.magazie_bucati_miscari'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(@@MIS_ARRAY@@ || ARRAY['id','server_ver']) x) THEN
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
     IS DISTINCT FROM '@@TIP_CHECK_E2A@@' THEN
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
  v_baza := @@BAZA_EXPR@@;
  v_baza_rev := '
@@BAZA_REV@@
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
  -- r5h (#825 r5g NO-GO, Copilot P1): invocările IMPLICITE ale fn_izo_* (trigger / politică / DEFAULT / CHECK / index / operator /
  -- cast …: orice obiect din catalog în afara view-urilor și a funcțiilor) = lista pre-E3 FIXĂ, capturată read-only de pe prod și
  -- revizuită (baseline_pre_e3.json, cheia „implicite”: 13 politici + 22 trigger-e E2a / 2c), sub lock-ul runner-ului, înainte de
  -- orice DDL: altfel un obiect nou apărut între review și apply (ex. un DEFAULT peste fn_izo_citire) ar intra în ștampila E3
  -- „cum e găsit” (TOFU) și ar fi binecuvântat de ea. Orice diferență → refuz, cu lista; baseline nou = captură nouă revizuită.
  v_impl := @@IMPL_EXPR@@;
  v_impl_rev := @@IMPL_PRE@@;
  SELECT string_agg(format('%s: %s', y.x, CASE WHEN y.x = ANY (v_impl) THEN 'în plus' ELSE 'lipsește' END), '; ' ORDER BY y.x COLLATE "C") INTO v_x
    FROM ((SELECT unnest(v_impl) EXCEPT SELECT unnest(v_impl_rev)) UNION (SELECT unnest(v_impl_rev) EXCEPT SELECT unnest(v_impl))) y(x);
  IF v_x IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0m: invocările implicite ale fn_izo_* diferă de lista pre-E3 revizuită (captură nouă + review): %', v_x;
  END IF;
  -- porțile E2a complete și amprenta de revenire consistentă înainte (o rulăm o dată, aici: ~8,5 s pe prod)
  v_lipsa := public.fn_izo_porti_lipsa();
  IF cardinality(v_lipsa) <> 0 THEN
    RAISE EXCEPTION 'Precondiție 0j: porțile E2a nu sunt complete: %', v_lipsa;
  END IF;
@@AMPRENTA@@
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
  ALTER TABLE public.magazie_bucati_evenimente ADD CONSTRAINT magazie_bucati_evenimente_tip_check CHECK (tip IN (@@TIPURI_E3@@));
  CREATE UNIQUE INDEX ux_magbuc_ev_doc_intrare ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'doc_intrare' AND tip IN ('intrare_aviz', 'intrare_lista_ambalare');
  CREATE UNIQUE INDEX ux_magbuc_ev_doc_pv ON public.magazie_bucati_evenimente (document_id)
    WHERE document_tip = 'doc_intrare' AND tip = 'receptie_pv';

  -- ── D. ajutătoare (owner postgres) ────────────────────────────────────────────────────────────────────
  -- constantele revizuite: C (coloanele comparate ale bucății), coloanele comparate ale evenimentului și ale mișcării
  CREATE FUNCTION public.fn_izo_coloane_c() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ SELECT @@C_ARRAY@@ $f$;
  CREATE FUNCTION public.fn_izo_coloane_ev() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ SELECT @@EV_ARRAY@@ $f$;
  CREATE FUNCTION public.fn_izo_coloane_mis() RETURNS text[]
    LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$ SELECT @@MIS_ARRAY@@ $f$;
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
@@GARDA_BUCATI_E3@@

@@GARDA_FAPTE_E3@@

  -- ── F2. poarta E2a: aceleași verificări, închiderea citirilor rapidă (semi-naivă; r5d §13.1) + poarta E3 la final ──
@@PORTI_LIPSA_E3@@

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
        WHERE (n.nspname, c.relname) IN (('storage', 'objects'), ('storage', 'buckets'))),
      -- r5g (#825) NO-GO P1-C / P1-D: invocările IMPLICITE ale funcțiilor fn_izo_* — orice obiect din catalog (trigger, politică,
      -- DEFAULT, CHECK, index, operator, cast, I/O de tip …) care cheamă una; view-urile / regulile (pg_rewrite) și funcțiile
      -- (pg_proc) intră în închiderea citirilor, prin țintele fn_izo_*. Mulțimea de la migrare e cea revizuită (trigger-ele și
      -- politicile E2a / 2c / E3); un obiect nou (ex. DEFAULT-ul unui tabel oarecare peste un cititor al documentelor) o schimbă
      (SELECT string_agg(x.d, ',' ORDER BY x.d COLLATE "C")
         FROM (SELECT DISTINCT format('%s → %s', pg_describe_object(d.classid, d.objid, d.objsubid), d.refobjid::regprocedure) d
                 FROM pg_depend d JOIN pg_proc q ON q.oid = d.refobjid
                WHERE d.refclassid = 'pg_proc'::regclass AND q.pronamespace = 'public'::regnamespace AND q.proname LIKE 'fn\_izo\_%'
                  AND d.classid NOT IN ('pg_rewrite'::regclass, 'pg_proc'::regclass)) x)))
  $f$;

  CREATE FUNCTION public.fn_izo_porti_e3_lipsa() RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v text[] := '{}'; r record;
  BEGIN
    IF public.fn_izo_porti_e3_definitii() IS DISTINCT FROM
       substring(obj_description('public.fn_izo_porti_e3_definitii()'::regprocedure, 'pg_proc') FROM '^porti_e3=([0-9a-f]{32})$') THEN
      v := array_append(v, 'definițiile E3 (indexuri / ACL pe tabele și coloane / politici / trigger-e / roluri / bucket / storage.objects / storage.buckets / invocările implicite ale fn_izo_*) diferă de amprenta de la migrare');
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
@@INTRARI@@

  -- ── J. drepturi, RLS, politici ────────────────────────────────────────────────────────────────────────
@@DREPTURI@@

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
@@OWNERI@@

  -- ── M. ștampilele: porțile E2a, porțile E3, amprenta de revenire E2a ──────────────────────────────────
  -- r5h (#825 r5g NO-GO, Copilot P1): ÎNAINTE de ștampila E3, mulțimea finală a invocărilor implicite ale fn_izo_* = lista
  -- post-E3 FIXĂ (pre-E3 revizuită ∪ cele 17 create chiar aici, IMPL_E3 în gen_e3.py) — ștampila descrie ce s-a revizuit, nu ce
  -- s-a găsit. Verificarea se repetă DUPĂ ștampilă (un obiect comis de altă sesiune între verificare și ștampilă ar intra în
  -- ștampilă; al doilea tur îl vede), iar postcondiția P1 (poarta completă) confirmă că ștampila scrisă = starea finală
@@VERIF_POST_INAINTE@@
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
@@VERIF_POST_DUPA@@

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
@@AMPRENTA@@
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
