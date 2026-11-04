-- Revenire 20261130j_redari_mail_f1_schema. Runner: o tranzacție, GUC gazpet.revenire_20261130j = 'REDARI_MAIL_F1_SCHEMA_SCOS:' || txid_current().
-- Cere ÎNTÂI revenirea lui 20261130k (regulile). NU șterge date reale: REFUZĂ dacă oricare tabel red_mail_* are alte rânduri decât cele 3
-- rânduri inițiale NEATINSE (setari id = 1, fluxurile inbox redari@ / redari-test@ cu valorile implicite, versiune 1), dacă există obiecte
-- sub redari/mail/, valori în red_proiecte.retentie_mail_pana sau rânduri red_mail_* în red_jurnal (jurnalul e append-only: nu se șterge).
-- Restaurează textual: fn_red_jurnal (corpul baseline, md5 27479409…), red_jurnal_sel (20261130g), red_storage_sel / _ins (20261126a),
-- red_storage_coresp_sel (20261130e); scoate coloana red_proiecte.retentie_mail_pana și cele 9 tabele; verifică starea finală cu
-- fn_red_mail_verifica_baza('inainte'), apoi scoate și verificatorul.
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130j', true) IS DISTINCT FROM 'REDARI_MAIL_F1_SCHEMA_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130j revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_mail_primite') IS NULL OR to_regprocedure('public.fn_red_mail_verifica_baza(text)') IS NULL THEN
    RAISE EXCEPTION '20261130j revenire: migrarea lipseste';
  END IF;
  IF to_regprocedure('public.fn_red_mail_are_legatura_juridica(uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^fn_red_mail_' AND proname <> 'fn_red_mail_verifica_baza') THEN
    RAISE EXCEPTION '20261130j revenire: intai revenirea 20261130k (regulile)';
  END IF;
  -- Jak #987 P1-3 (L01 / L06): blocările ÎNAINTEA verificărilor „fără date”, ținute până la commit. ACCESS EXCLUSIVE = modul cerut oricum de
  -- DROP COLUMN / ALTER POLICY / DROP TABLE. storage.objects blocat oprește și upload-urile service_role (ocolesc RLS, dar nu blocările).
  -- Ordinea unică red_mail F1: red_proiecte → red_raspunsuri (neatins aici) → red_jurnal → storage.objects → red_mail_* (alfabetic).
  LOCK TABLE public.red_proiecte IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_jurnal IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.red_mail_adrese_propuse, public.red_mail_dedup, public.red_mail_evenimente, public.red_mail_flux, public.red_mail_oauth_state,
             public.red_mail_obiecte, public.red_mail_primite, public.red_mail_raspuns_sursa, public.red_mail_setari IN ACCESS EXCLUSIVE MODE;
  -- nicio dată reală: doar rândurile inițiale, neatinse
  IF EXISTS (SELECT 1 FROM public.red_mail_primite) OR EXISTS (SELECT 1 FROM public.red_mail_obiecte) OR EXISTS (SELECT 1 FROM public.red_mail_dedup)
     OR EXISTS (SELECT 1 FROM public.red_mail_evenimente) OR EXISTS (SELECT 1 FROM public.red_mail_raspuns_sursa) OR EXISTS (SELECT 1 FROM public.red_mail_adrese_propuse)
     OR EXISTS (SELECT 1 FROM public.red_mail_oauth_state)
     OR (SELECT count(*) FROM public.red_mail_setari) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.red_mail_setari WHERE id = 1 AND NOT citire_activa AND NOT retentie_activa AND NOT golire_gmail_activa
                     AND ultima_eroare_cod IS NULL AND retentie_lease_token IS NULL AND versiune = 1)
     OR (SELECT count(*) FROM public.red_mail_flux) <> 2
     OR (SELECT count(*) FROM public.red_mail_flux WHERE flux = 'inbox' AND casuta IN ('redari@gazpet.ro', 'redari-test@gazpet.ro') AND NOT activ
           AND mod_cursor = 'neinitializat' AND history_id IS NULL AND data_start IS NULL AND lease_token IS NULL AND ultima_eroare_cod IS NULL AND versiune = 1) <> 2
     OR EXISTS (SELECT 1 FROM public.red_proiecte WHERE retentie_mail_pana IS NOT NULL)
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'redari' AND left(name, 5) = 'mail/')
     OR EXISTS (SELECT 1 FROM public.red_jurnal WHERE left(tabela, 9) = 'red_mail_') THEN
    RAISE EXCEPTION '20261130j revenire REFUZATA: exista date red_mail_* / obiecte mail/ / termene / jurnal — nu se sterg date reale' USING ERRCODE = '55000';
  END IF;
END $rev$;

-- Storage și jurnalul: textul de dinainte, exact
ALTER POLICY red_storage_sel ON storage.objects USING (((bucket_id = 'redari'::text) AND (public.fn_red_nivel() = ANY (ARRAY['admin'::text, 'editor'::text]))));
ALTER POLICY red_storage_ins ON storage.objects WITH CHECK (((bucket_id = 'redari'::text) AND (public.fn_red_nivel() = ANY (ARRAY['admin'::text, 'editor'::text]))));
ALTER POLICY red_storage_coresp_sel ON storage.objects USING (((bucket_id = 'redari'::text) AND ((storage.foldername(name))[2] = 'corespondenta'::text)
  AND (public.fn_red_nivel() = 'viewer'::text) AND (EXISTS ( SELECT 1 FROM public.red_corespondenta_fisiere f WHERE (f.path = objects.name)))));
ALTER POLICY red_jurnal_sel ON public.red_jurnal USING (((( SELECT public.fn_red_nivel() AS fn_red_nivel) IS NOT NULL)
  AND ((tabela <> ALL (ARRAY['red_detinatori_contact'::text, 'red_raspunsuri_meta'::text])) OR (( SELECT public.fn_red_nivel() AS fn_red_nivel) = ANY (ARRAY['admin'::text, 'editor'::text])))));
CREATE OR REPLACE FUNCTION public.fn_red_jurnal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vechi jsonb; v_noi jsonb; v_id uuid; v_hash_noi jsonb; v_hash_vechi jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_vechi := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_noi := to_jsonb(NEW); END IF;
  -- actualizările care schimbă doar updated_at nu se jurnalizează
  IF TG_OP = 'UPDATE' AND (v_vechi - 'updated_at') = (v_noi - 'updated_at') THEN
    RETURN NULL;
  END IF;
  -- mascare: valoarea (admin) nu intră în jurnal — doar faptul că e setată
  IF TG_TABLE_NAME = 'red_parcele' THEN
    IF v_vechi IS NOT NULL THEN v_vechi := (v_vechi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_vechi ->> 'valoare_lei') IS NOT NULL); END IF;
    IF v_noi IS NOT NULL THEN v_noi := (v_noi - 'valoare_lei') || jsonb_build_object('valoare_lei_setata', (v_noi ->> 'valoare_lei') IS NOT NULL); END IF;
  -- PII: pe contact / meta jurnalul primește DOAR numele câmpurilor schimbate („modificat”), niciodată valorile și nici hash-uri (reversibile prin dicționar)
  ELSIF TG_TABLE_NAME IN ('red_detinatori_contact', 'red_raspunsuri_meta') THEN
    SELECT jsonb_object_agg(e.k, 'modificat') INTO v_hash_noi
      FROM jsonb_each_text(coalesce(v_noi, '{}'::jsonb) - 'updated_at' - 'detinator_id' - 'raspuns_id') e(k, v)
     WHERE e.v IS NOT NULL AND (v_vechi IS NULL OR (v_vechi ->> e.k) IS DISTINCT FROM e.v);
    SELECT jsonb_object_agg(e.k, 'modificat') INTO v_hash_vechi
      FROM jsonb_each_text(coalesce(v_vechi, '{}'::jsonb) - 'updated_at' - 'detinator_id' - 'raspuns_id') e(k, v)
     WHERE e.v IS NOT NULL AND (v_noi IS NULL OR (v_noi ->> e.k) IS DISTINCT FROM e.v);
    v_noi := CASE WHEN v_noi IS NULL THEN NULL ELSE coalesce(v_hash_noi, '{}'::jsonb) END;
    v_vechi := CASE WHEN v_vechi IS NULL THEN NULL ELSE coalesce(v_hash_vechi, '{}'::jsonb) END;
  END IF;
  v_id := coalesce(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id', to_jsonb(NEW) ->> 'detinator_id', to_jsonb(OLD) ->> 'detinator_id',
                   to_jsonb(NEW) ->> 'raspuns_id', to_jsonb(OLD) ->> 'raspuns_id')::uuid;
  INSERT INTO public.red_jurnal (tabela, inregistrare_id, actiune, date_vechi, date_noi, user_id, user_email)
  VALUES (TG_TABLE_NAME, v_id, lower(TG_OP), v_vechi, v_noi, auth.uid(), auth.jwt() ->> 'email');
  RETURN NULL;
END $function$;

-- Tabelele (rânduri inițiale doar, verificat mai sus) și coloana red_proiecte; ordinea respectă FK-urile, fără CASCADE
DROP TABLE public.red_mail_raspuns_sursa;
DROP TABLE public.red_mail_adrese_propuse;
DROP TABLE public.red_mail_evenimente;
DROP TABLE public.red_mail_obiecte;
DROP TABLE public.red_mail_dedup;
DROP TABLE public.red_mail_oauth_state;
DROP TABLE public.red_mail_primite;
DROP TABLE public.red_mail_flux;
DROP TABLE public.red_mail_setari;
ALTER TABLE public.red_proiecte DROP COLUMN retentie_mail_pana;

DO $fin$
BEGIN
  PERFORM public.fn_red_mail_verifica_baza('inainte');
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname ~ '^red_mail_')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte' AND column_name = 'retentie_mail_pana') THEN
    RAISE EXCEPTION '20261130j revenire: stare finala gresita';
  END IF;
END $fin$;
DROP FUNCTION public.fn_red_mail_verifica_baza(text);
DO $fin2$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^fn_red_mail_') THEN RAISE EXCEPTION '20261130j revenire: functii fn_red_mail_* ramase'; END IF;
  RAISE NOTICE '20261130j revenire: schema red_mail_* scoasa; jurnalul, red_jurnal_sel si politicile storage readuse la textul de dinainte';
END $fin2$;
