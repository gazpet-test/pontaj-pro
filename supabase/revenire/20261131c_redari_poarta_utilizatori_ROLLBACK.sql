-- DOAR FISIER. Runner: BEGIN; marcaj cu txid; acest fisier; COMMIT. Codul client se revine impreuna cu SQL.
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true)
    IS DISTINCT FROM '20261131c_redari_poarta_utilizatori_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '31c rollback: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure)
    IS DISTINCT FROM 'bd01044b09be4a2849e3a85831fc22af' THEN
    RAISE EXCEPTION '31c rollback: RPC schimbat dupa livrare; refuz suprascriere';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text,text)'::regprocedure
    AND NOT prosecdef AND pg_get_userbyid(proowner) = 'postgres' AND proconfig = ARRAY['search_path=public, pg_temp']::text[]
    AND md5(prosrc) = 'dd56a8227b0e9bfab9c7c2ca2ca57b02'
    AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(proacl::text[]) a) = ARRAY['authenticated=X/postgres','postgres=X/postgres']) THEN
    RAISE EXCEPTION '31c rollback: RPC 4 argumente schimbat';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_leaga(uuid,text,text,text)'::regprocedure
    AND NOT prosecdef AND pg_get_userbyid(proowner) = 'postgres' AND proconfig = ARRAY['search_path=public, pg_temp']::text[]
    AND md5(prosrc) = 'e2f2c12a4ec0b23c20a0be4d5ce19075'
    AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(proacl::text[]) a) = ARRAY['authenticated=X/postgres','postgres=X/postgres']) THEN
    RAISE EXCEPTION '31c rollback: RPC legare schimbat';
  END IF;
  -- L14: lock INAINTE de verificarea datelor / istoricului, aceeasi ordine ca 30m.
  LOCK TABLE public.red_convocari IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_detinatori IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('fn_red_proiect_utilizatori_garda()', 'trg_red_proiect_utilizatori', 'public.red_proiecte', '713d175aeecb280350ce53dec520f45e'),
    ('fn_red_convocari_utilizatori_garda()', 'trg_red_convocari_h_utilizatori', 'public.red_convocari', '25d8bacd42dff87315904e5833175114'),
    ('fn_red_detinatori_calitate_utilizatori_garda()', 'trg_red_detinatori_calitate_utilizatori', 'public.red_detinatori', '0cb7660327cd7b280512c5ae39dc343f')
  ) b(fn, tr, tab, hash) LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || b.fn)
    LEFT JOIN pg_trigger t ON t.tgrelid = b.tab::regclass AND t.tgname = b.tr
  WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM b.hash OR p.prosecdef IS NOT TRUE
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
    OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres' OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
    OR t.tgfoid IS DISTINCT FROM p.oid OR t.tgenabled IS DISTINCT FROM 'O' OR t.tgtype IS DISTINCT FROM (CASE WHEN b.tab = 'public.red_detinatori' THEN 19 ELSE 23 END)::smallint OR t.tgqual IS NOT NULL OR t.tgnargs <> 0 OR encode(t.tgargs,'hex') <> '' OR t.tgattr::text <> '') THEN
    RAISE EXCEPTION '31c rollback: triggere schimbate dupa livrare; refuz suprascriere';
  END IF;
  IF EXISTS (SELECT 1 FROM public.red_convocari WHERE calitate_document IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_convocari' AND date_noi->>'calitate_document' IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_proiecte WHERE convocare_utilizatori_aprobata IS NOT FALSE
      OR convocare_utilizatori_aprobata_de IS NOT NULL OR convocare_utilizatori_aprobata_la IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE tabela = 'red_proiecte'
      AND (date_noi->>'convocare_utilizatori_aprobata' = 'true' OR date_noi->>'convocare_utilizatori_aprobata_de' IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.red_convocari c JOIN public.red_detinatori d ON d.id = c.detinator_id
      WHERE d.calitate IN ('utilizator','arendas')) THEN
    RAISE EXCEPTION '31c rollback REFUZAT: exista configurare / istoric / convocari de utilizatori' USING ERRCODE = '55000';
  END IF;
END $rev$;
CREATE OR REPLACE FUNCTION public.fn_red_convocare_rezerva(p_detinator_id uuid, p_numar_nou_confirmat boolean DEFAULT false, p_canal text DEFAULT 'posta')
RETURNS TABLE (convocare_id uuid, nr_document text, parcela_id uuid, uat_id uuid, proiect_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
#variable_conflict error
DECLARE v_proiect_cheie uuid; v_proiect uuid; v_parcela uuid; v_uat uuid; v_uat3 text; v_tronson integer; v_calitate text; v_lipsa text[] := '{}';
  v_existente text; v_nr text; v_id uuid; pr record; u record;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de rezervare a convocarii' USING ERRCODE = '42501';
  END IF;
  IF p_detinator_id IS NULL OR p_numar_nou_confirmat IS NULL OR p_canal IS NULL THEN RAISE EXCEPTION 'redari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  -- canalele pe care UI-ul le generează cu număr C (generarea în masă: doar 'posta'; calea individuală: alegerea din modal, fără 'telefon')
  IF p_canal NOT IN ('posta', 'sms', 'email', 'afisare') THEN RAISE EXCEPTION 'redari: canal invalid (%)', p_canal USING ERRCODE = '22023'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'redari: rezervarea convocarii doar in READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  -- (2) doar cheia lock-ului; starea se verifica DUPA lock
  SELECT p.proiect_id INTO v_proiect_cheie FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id WHERE d.id = p_detinator_id;
  IF v_proiect_cheie IS NULL THEN RAISE EXCEPTION 'redari: detinator inexistent' USING ERRCODE = 'P0002'; END IF;
  -- (3)
  PERFORM pg_advisory_xact_lock(hashtextextended('red_convocare_posta:' || v_proiect_cheie::text || ':' || p_detinator_id::text, 0));
  -- (4) sub lock: deținător + parcelă ACTIVE, blocate FOR SHARE (o ștergere logică / mutare concurentă e așteptată și recitită)
  SELECT p.id, p.proiect_id, p.uat_id, p.tronson, d.calitate INTO v_parcela, v_proiect, v_uat, v_tronson, v_calitate
    FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id
   WHERE d.id = p_detinator_id AND d.sters_la IS NULL AND p.sters_la IS NULL
     FOR SHARE OF d, p;
  IF v_uat IS NULL THEN RAISE EXCEPTION 'redari: detinatorul sau parcela au fost sterse' USING ERRCODE = 'P0002'; END IF;
  -- r5 P2-03: cheia lock-ului trebuie să fie a proiectului recitit sub lock (altfel două tranzacții ar putea bloca chei diferite)
  IF v_proiect IS DISTINCT FROM v_proiect_cheie THEN
    RAISE EXCEPTION 'redari: detinatorul a fost mutat in alt proiect intre timp; reincercati' USING ERRCODE = 'RD003';
  END IF;
  SELECT * INTO u FROM public.red_uat x WHERE x.id = v_uat AND x.proiect_id = v_proiect;
  SELECT * INTO pr FROM public.red_proiecte x WHERE x.id = v_proiect;
  IF u.id IS NULL OR pr.id IS NULL THEN RAISE EXCEPTION 'redari: proiect / UAT inaccesibil' USING ERRCODE = 'P0002'; END IF;
  v_uat3 := u.uat3;
  IF v_calitate = 'neidentificat' THEN v_lipsa := array_append(v_lipsa, 'detinator neidentificat (afisare la Primarie)'); END IF;
  IF btrim(coalesce(pr.contract_nr, '')) = '' OR pr.contract_data IS NULL THEN v_lipsa := array_append(v_lipsa, 'proiect fara nr./data contract'); END IF;
  IF btrim(coalesce(pr.imputernicire_nr, '')) = '' OR pr.imputernicire_data IS NULL THEN v_lipsa := array_append(v_lipsa, 'proiect fara nr./data imputernicire Transgaz'); END IF;
  IF NOT ((u.sesiune_zi1 IS NOT NULL AND btrim(coalesce(u.program_zi1, '')) <> '') OR (u.sesiune_zi2 IS NOT NULL AND btrim(coalesce(u.program_zi2, '')) <> '')
          OR (u.sesiune_zi3 IS NOT NULL AND btrim(coalesce(u.program_zi3, '')) <> '')) THEN v_lipsa := array_append(v_lipsa, 'UAT fara zi de sesiune cu program'); END IF;
  -- D3 (#991): șablonul tipărește numele, telefonul și e-mailul de contact + telefonul TGZ → fiecare obligatoriu (ca motivBlocareConvocator)
  IF btrim(coalesce(pr.contact_nume, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara persoana de contact Gazpet'); END IF;
  IF btrim(coalesce(pr.contact_telefon, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara telefonul de contact Gazpet'); END IF;
  IF btrim(coalesce(pr.contact_email, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara e-mailul de contact Gazpet'); END IF;
  IF btrim(coalesce(pr.text_gdpr, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara text GDPR'); END IF;
  IF btrim(coalesce(pr.reprezentant_tgz_nume, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara reprezentant TGZ'); END IF;
  IF btrim(coalesce(pr.reprezentant_tgz_telefon, '')) = '' THEN v_lipsa := array_append(v_lipsa, 'proiect fara telefonul reprezentantului TGZ'); END IF;
  IF cardinality(v_lipsa) > 0 THEN
    RAISE EXCEPTION 'redari: convocatorul nu se poate rezerva: %', array_to_string(v_lipsa, '; ') USING ERRCODE = 'RD002';
  END IF;
  -- (5) decizia pe EXISTS (prinde și convocările fără nr_document); agregarea doar pentru mesaj
  -- pe ACELAȘI canal (lotul și calea individuală pe poștă se exclud reciproc); excepția explicită = p_numar_nou_confirmat (bifa din modal)
  IF NOT p_numar_nou_confirmat AND EXISTS (SELECT 1 FROM public.red_convocari c WHERE c.detinator_id = p_detinator_id AND c.canal = p_canal
                                             AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL) THEN
    SELECT string_agg(coalesce(c.nr_document, '(fara numar)'), ', ' ORDER BY c.created_at, c.id) INTO v_existente FROM public.red_convocari c
     WHERE c.detinator_id = p_detinator_id AND c.canal = p_canal AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL;
    RAISE EXCEPTION 'redari: detinatorul are deja convocare % neexpediata (%)', p_canal, v_existente USING ERRCODE = 'RD001';
  END IF;
  -- (6) numărul + rândul; triggerele (garda rezervării, garda de plic pe persoană, legături, jurnal) și RLS-ul se aplică utilizatorului.
  -- r8: INSERT-ul (și numărul C) sunt autorizate de instrucțiunea STATICĂ SET LOCAL de mai jos (pe Supabase, postgres nu e superuser: clauza SET a
  -- funcției pe un GUC placeholder e refuzată la CREATE). SET LOCAL ține până la sfârșitul tranzacției, deci se anulează explicit imediat după INSERT.
  SET LOCAL gazpet.convocare_rezerva = 'activ';
  v_nr := public.fn_red_numar_document('C', v_uat3, v_tronson);
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (p_detinator_id, p_canal, v_nr) RETURNING id INTO v_id;
  SET LOCAL gazpet.convocare_rezerva = 'inactiv';
  -- r5 P1-01: identitatea folosită de server (clientul o compară cu documentul pe care îl generează)
  RETURN QUERY SELECT v_id, v_nr, v_parcela, v_uat, v_proiect;
END $fn$;
DROP FUNCTION public.fn_red_convocare_leaga(uuid,text,text,text);
DROP FUNCTION public.fn_red_convocare_rezerva(uuid,boolean,text,text);
DROP TRIGGER trg_red_detinatori_calitate_utilizatori ON public.red_detinatori;
DROP FUNCTION public.fn_red_detinatori_calitate_utilizatori_garda();
DROP TRIGGER trg_red_convocari_h_utilizatori ON public.red_convocari;
DROP FUNCTION public.fn_red_convocari_utilizatori_garda();
DROP TRIGGER trg_red_proiect_utilizatori ON public.red_proiecte;
DROP FUNCTION public.fn_red_proiect_utilizatori_garda();
ALTER TABLE public.red_convocari DROP COLUMN calitate_document;
ALTER TABLE public.red_proiecte DROP COLUMN convocare_utilizatori_aprobata,
  DROP COLUMN convocare_utilizatori_aprobata_de, DROP COLUMN convocare_utilizatori_aprobata_la;
DO $post$
BEGIN
  IF to_regprocedure('public.fn_red_convocare_leaga(uuid,text,text,text)') IS NOT NULL
    OR to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text,text)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_convocari'::regclass AND attname = 'calitate_document' AND NOT attisdropped)
    OR to_regprocedure('public.fn_red_detinatori_calitate_utilizatori_garda()') IS NOT NULL
    OR to_regprocedure('public.fn_red_convocari_utilizatori_garda()') IS NOT NULL
    OR to_regprocedure('public.fn_red_proiect_utilizatori_garda()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass
      AND attname IN ('convocare_utilizatori_aprobata','convocare_utilizatori_aprobata_de','convocare_utilizatori_aprobata_la') AND NOT attisdropped)
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure) IS DISTINCT FROM 'fbb7d6f96294c93a965fc97a930cd3c2' THEN
    RAISE EXCEPTION '31c rollback: postconditii';
  END IF;
END $post$;
