-- 20261128a: legătura opțională Redări → Execuție, linkul informării GDPR și RPC-ul de rezervare atomică a numărului adresei UAT.
-- LIVRARE: scripts/livrare_migrare.sh într-o singură tranzacție; fără date, politici sau GRANT-uri noi.
-- DRY în aceeași tranzacție cu migrarea, apoi ROLLBACK; apply numai după GO + DRY verde.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261128a_redari_legatura_executie:' || txid_current() THEN
    RAISE EXCEPTION '20261128a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261128a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_proiecte') IS NULL OR to_regclass('public.red_uat') IS NULL OR to_regclass('public.executie_proiecte') IS NULL THEN
    RAISE EXCEPTION '20261128a: lipsesc tabelele preconditie';
  END IF;
  -- Ordine fixă înaintea verificărilor: proiecte, UAT; ALTER păstrează lock-urile până la finalul tranzacției.
  LOCK TABLE public.red_proiecte, public.red_uat IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_proiecte'
               AND column_name IN ('executie_proiect_id', 'link_informare_gdpr')) THEN
    RAISE EXCEPTION '20261128a: coloanele exista deja';
  END IF;
  IF to_regprocedure('public.fn_red_adresa_uat_rezerva(uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION '20261128a: fn_red_adresa_uat_rezerva exista deja'; END IF;
  IF to_regprocedure('public.fn_red_numar_document(text,text,integer)') IS NULL THEN RAISE EXCEPTION '20261128a: lipseste fn_red_numar_document'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_constraint c ON c.conrelid = a.attrelid AND c.contype = 'p'
                 WHERE a.attrelid = 'public.executie_proiecte'::regclass AND a.attname = 'id' AND NOT a.attisdropped
                   AND a.atttypid = 'bigint'::regtype AND c.conkey = ARRAY[a.attnum]::smallint[]) THEN
    RAISE EXCEPTION '20261128a: executie_proiecte necesita PK id bigint';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_proiecte'::regclass AND tgname = 'trg_red_versiune'
        AND tgenabled = 'O' AND NOT tgisinternal) <> 1 THEN RAISE EXCEPTION '20261128a: lipseste trigger versiune 20261127a'; END IF;
  -- Coloanele sunt noi și nullable: toate valorile existente sunt NULL; FK/CHECK/UNIQUE nu cer backfill.
  IF (SELECT md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('red_uat', 'red_proiecte')) IS DISTINCT FROM '5522f827069f68dfedd4b0a0c4c83e1d' THEN
    RAISE EXCEPTION '20261128a: politicile difera de baseline';
  END IF;
END $pre$;

ALTER TABLE public.red_proiecte
  ADD COLUMN executie_proiect_id bigint CONSTRAINT red_proiecte_executie_fk REFERENCES public.executie_proiecte(id),
  ADD COLUMN link_informare_gdpr text CONSTRAINT red_proiecte_link_gdpr_ck
    CHECK (link_informare_gdpr IS NULL OR (left(link_informare_gdpr, 8) = 'https://' AND length(link_informare_gdpr) <= 300));
CREATE UNIQUE INDEX red_proiecte_executie_uq ON public.red_proiecte (executie_proiect_id) WHERE executie_proiect_id IS NOT NULL;
COMMENT ON COLUMN public.red_proiecte.executie_proiect_id IS 'Proiectul de montaj din Execuție; un montaj are cel mult un proiect Redări. Datele contractului rămân copii locale.';
COMMENT ON COLUMN public.red_proiecte.link_informare_gdpr IS 'Link HTTPS la informarea GDPR completă; NULL = propoziția se omite din document.';

-- ─── RPC: rezervarea atomică a numărului adresei UAT (Copilot f2b r1 P2-1) ────────────────────────────────────────────
-- Numărul AU se rezervă ȘI se scrie pe red_uat în aceeași tranzacție, ÎNAINTE de generarea documentului: un eșec ulterior
-- (șablon, upload) lasă numărul pe UAT, iar reluarea se face pe același număr („Regenerează”). Idempotent: dacă adresa_nr
-- există deja, întoarce rândul fără să consume alt număr. Ordinea lock-urilor: red_uat FOR UPDATE → red_numere (în fn_red_numar_document).
CREATE FUNCTION public.fn_red_adresa_uat_rezerva(p_uat_id uuid, p_versiune integer) RETURNS public.red_uat
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uat public.red_uat; v_nr text;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') <> 'admin' THEN
    RAISE EXCEPTION 'redari: doar administratorul rezerva numarul adresei UAT' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_uat FROM public.red_uat u WHERE u.id = p_uat_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari: UAT inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_uat.adresa_nr IS NOT NULL THEN RETURN v_uat; END IF;
  IF p_versiune IS NULL OR v_uat.versiune IS DISTINCT FROM p_versiune THEN
    RAISE EXCEPTION 'redari: UAT-ul a fost modificat intre timp (versiunea curenta %)', v_uat.versiune;
  END IF;
  v_nr := public.fn_red_numar_document('AU', NULL, NULL);
  UPDATE public.red_uat SET adresa_nr = v_nr, adresa_data = (now() AT TIME ZONE 'Europe/Bucharest')::date
   WHERE id = p_uat_id AND adresa_nr IS NULL
   RETURNING * INTO v_uat;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari: rezervarea adresei nu s-a scris'; END IF;
  RETURN v_uat;
END $fn$;
COMMENT ON FUNCTION public.fn_red_adresa_uat_rezerva(uuid, integer) IS 'Redări: rezervă numărul AU și îl scrie pe red_uat (adresa_nr, adresa_data) atomic, doar admin, CAS pe versiune, idempotent dacă adresa_nr există. Apelat din UI înaintea generării adresei (20261128a).';
REVOKE EXECUTE ON FUNCTION public.fn_red_adresa_uat_rezerva(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_red_adresa_uat_rezerva(uuid, integer) TO authenticated;

DO $post$
DECLARE v_col smallint;
BEGIN
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND NOT attisdropped AND NOT attnotnull
        AND ((attname = 'executie_proiect_id' AND atttypid = 'bigint'::regtype) OR (attname = 'link_informare_gdpr' AND atttypid = 'text'::regtype))) <> 2 THEN
    RAISE EXCEPTION '20261128a post: coloane lipsa/incompatibile';
  END IF;
  SELECT attnum INTO v_col FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND attname = 'executie_proiect_id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attname = 'id'
      WHERE c.conrelid = 'public.red_proiecte'::regclass AND c.conname = 'red_proiecte_executie_fk' AND c.contype = 'f' AND c.convalidated
        AND c.confrelid = 'public.executie_proiecte'::regclass AND c.conkey = ARRAY[v_col]::smallint[] AND c.confkey = ARRAY[a.attnum]::smallint[])
     OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = 'public.red_proiecte_executie_uq'::regclass AND i.indisunique AND i.indisvalid
        AND i.indnkeyatts = 1 AND i.indkey[0] = v_col AND pg_get_expr(i.indpred, i.indrelid) = '(executie_proiect_id IS NOT NULL)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_proiecte'::regclass AND conname = 'red_proiecte_link_gdpr_ck' AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION '20261128a post: FK/index/CHECK lipsa';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_red_adresa_uat_rezerva(uuid,integer)'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_proc, unnest(proconfig) c WHERE oid = 'public.fn_red_adresa_uat_rezerva(uuid,integer)'::regprocedure AND c = 'search_path=public, pg_temp')
     OR has_function_privilege('anon', 'public.fn_red_adresa_uat_rezerva(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_red_adresa_uat_rezerva(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261128a post: fn_red_adresa_uat_rezerva (secdef / search_path / drepturi)';
  END IF;
  IF (SELECT md5(string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('red_uat', 'red_proiecte')) IS DISTINCT FROM '5522f827069f68dfedd4b0a0c4c83e1d' THEN
    RAISE EXCEPTION '20261128a post: politici schimbate';
  END IF;
END $post$;
