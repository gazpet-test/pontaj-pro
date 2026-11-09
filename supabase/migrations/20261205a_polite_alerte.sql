-- Version 20261205120000. Runner supplies one transaction (scripts/livrare_migrare.sh). NEAPLICAT.
-- 20261205a_polite_alerte — Polite CAR / GBE, etapa 1: o singura evidenta, propuneri citite la incarcare, alerte la expirare.
-- Variantele D1-D7 = A (propunerea din 09.11.2026); Razvan le confirma la merge, pana atunci PR draft si migrare NEAPLICATA.
-- Ce face:
--   1. contracte_polite (+ _acte): coloane noi moneda, perioada de executie, perioada de garantie, pdf_sha256, sursa, propunere_id;
--      tipul 'avans' (D4). Provenienta (sursa, pdf_sha256, propunere_id) o pune DOAR fn_polita_salveaza, in aceeasi tranzactie
--      (trigger BEFORE: marcajul confirmare_txid de pe propunere = txid_current()); pe orice alta cale e fortata 'manual'.
--   2. garantii.contract_polita_id (D1): randul din Registru legat de polita de pe contract. Campurile documentului (emitent, nr.,
--      valoare, moneda, emitere, expirare efectiva, tip, contract) se copiaza din polita la fiecare scriere (trigger BEFORE) si la
--      fiecare schimbare a politei / actelor ei (trigger AFTER) => nu se mai pot desparti. garantii are SELECT pe coloane (20261006b):
--      coloana noua primeste SELECT pentru authenticated.
--   3. polite_propuneri: propunerile citite (la incarcare = edge polita-citeste; tura de noapte si coada locala in etapele urmatoare),
--      stari in_citire / propus / confirmat / respins / eroare. Un rand NU e polita activa si nu da alerte.
--   4. fn_polite_scadente() + v_polite_scadente: SINGURA definitie a scadentei (pagina proiectului, Administrator -> Alerte, mail).
--      Expirarea efectiva = cea mai tarzie data din actele aditionale, altfel data politei (ca v_polite_alerte si ContracteTertiTab).
--      Pragurile: 60 / 30 / 15 zile, ziua expirarii ('0', pana la 6 zile dupa), apoi saptamanal 'r1', 'r2'... (D2) pana la prelungire
--      (act cu expirare mai tarzie => cheie noua) sau pana la inchidere (status <> 'activa').
--   5. Alertele: polite_alerte_destinatari (lista din Administrator, doar owner; D3: doar @gazpet.ro, si in BD), polite_alerte_config
--      (comutatorul, OPRIT la livrare; pornirea cere o rulare de proba in ultimele 24 h), polite_alerte_jurnal (dedup pe
--      polita + prag + expirare + destinatar; randurile 'proba' nu participa la dedup), RPC-urile, cronul zilnic polite_alerte_zilnic
--      -> edge polite-alerte-mail (antet x-intern-secret din Vault, ca 20261130d).
-- NU atinge: garantii_alerte() (owner-ul primeste in continuare alertele Registrului; datele coincid prin sincronizare), gbe_polite,
--   politicile RLS existente pe contracte_polite / garantii / storage, user_module_access.
-- Ordinea lock-urilor (L06), pe toate caile: polite_propuneri -> contracte_polite -> contracte_polite_acte -> garantii.
-- Revenire: supabase/revenire/20261205a_polite_alerte_ROLLBACK.sql. Test: scripts/test_polite_alerte.sh (PG17 local, chat).
-- Amprenta structurii: calculata la final si pastrata in COMMENT ON TABLE polite_alerte_config; revenirea o recalculeaza (aceeasi
--   interogare) si refuza la diferenta. Dupa DRY-ul pe clona, chat-ul poate fixa constanta in ambele fisiere.
DO $pre$
DECLARE r record; v_tip text; v_n integer; v_def text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261205a_polite_alerte:' || txid_current() THEN
    RAISE EXCEPTION '20261205a: garda start invalida';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION '20261205a: izolarea trebuie sa fie READ COMMITTED'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  -- 0a. coloanele de care depinde migrarea, cu tipurile acceptate
  FOR r IN SELECT * FROM (VALUES
      ('contracte_polite', 'id', 'integer|bigint'), ('contracte_polite', 'contract_id', 'integer|bigint'), ('contracte_polite', 'tip', 'text'),
      ('contracte_polite', 'asigurator', 'text'), ('contracte_polite', 'nr_polita', 'text'), ('contracte_polite', 'valoare_lei', 'numeric'),
      ('contracte_polite', 'data_emitere', 'date'), ('contracte_polite', 'data_expirare', 'date'), ('contracte_polite', 'status', 'text'),
      ('contracte_polite', 'pdf_path', 'text'), ('contracte_polite', 'observatii', 'text'),
      ('contracte_polite_acte', 'id', 'integer|bigint'), ('contracte_polite_acte', 'polita_id', 'integer|bigint'), ('contracte_polite_acte', 'nr_act', 'integer|smallint|bigint'),
      ('contracte_polite_acte', 'descriere', 'text'), ('contracte_polite_acte', 'valoare_noua_lei', 'numeric'), ('contracte_polite_acte', 'data_emitere', 'date'),
      ('contracte_polite_acte', 'data_expirare_noua', 'date'), ('contracte_polite_acte', 'pdf_path', 'text'),
      ('contracte_terti', 'id', 'integer|bigint'), ('contracte_terti', 'numar_contract', 'text'), ('contracte_terti', 'denumire', 'text'),
      ('contracte_terti', 'data_semnare', 'date'),
      ('garantii', 'id', 'bigint'), ('garantii', 'forma', 'text'), ('garantii', 'tip', 'text'), ('garantii', 'beneficiar', 'text'), ('garantii', 'lucrare', 'text'),
      ('garantii', 'emitent', 'text'), ('garantii', 'numar_document', 'text'), ('garantii', 'valoare', 'numeric'), ('garantii', 'moneda', 'text'),
      ('garantii', 'data_emitere', 'date'), ('garantii', 'data_expirare', 'date'), ('garantii', 'stare', 'text'), ('garantii', 'contract_terti_id', 'bigint'),
      ('garantii', 'sursa_document', 'text'), ('garantii', 'updated_at', 'timestamp with time zone'),
      ('executie_proiecte', 'id', 'integer|bigint'), ('executie_proiecte', 'nume', 'text'), ('executie_proiecte', 'contract_id', 'integer|bigint'),
      ('executie_proiecte', 'sef_santier_employee_id', 'integer|bigint'), ('executie_proiecte', 'mp_employee_id', 'integer|bigint'),
      ('profiles', 'id', 'uuid'), ('profiles', 'email', 'text'), ('profiles', 'is_owner', 'boolean'), ('profiles', 'employee_id', 'integer|bigint'),
      ('profiles', 'can_manage_contracts', 'boolean'),
      ('employees', 'id', 'integer|bigint'), ('employees', 'name', 'text'), ('employees', 'email', 'text'), ('employees', 'active', 'boolean'),
      ('notifications', 'profile_id', 'uuid'), ('notifications', 'type', 'text'), ('notifications', 'modul', 'text'), ('notifications', 'title', 'text'),
      ('notifications', 'message', 'text'), ('notifications', 'link_to', 'text')
    ) v(t, c, tipuri) LOOP
    v_tip := NULL;
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tip FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attname = r.c AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|')) OR (r.tipuri = 'numeric' AND v_tip LIKE 'numeric%')) THEN
      RAISE EXCEPTION '20261205a: %.% lipseste sau are tipul % (astept %)', r.t, r.c, coalesce(v_tip, '<lipsa>'), r.tipuri;
    END IF;
  END LOOP;
  -- 0b. obiectele noi nu exista (reaplicare / coliziune = refuz)
  IF to_regclass('public.polite_propuneri') IS NOT NULL OR to_regclass('public.polite_alerte_destinatari') IS NOT NULL
     OR to_regclass('public.polite_alerte_config') IS NOT NULL OR to_regclass('public.polite_alerte_jurnal') IS NOT NULL
     OR to_regclass('public.v_polite_scadente') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!'))
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.garantii'::regclass AND a.attname = 'contract_polita_id' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.contracte_polite'::regclass, 'public.contracte_polite_acte'::regclass) AND NOT a.attisdropped
                  AND a.attname IN ('moneda', 'executie_de_la', 'executie_pana_la', 'garantie_de_la', 'garantie_pana_la', 'pdf_sha256', 'sursa', 'propunere_id'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname LIKE 'trg!_polite!_%' ESCAPE '!' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '20261205a: obiectele noi (tabele polite_*, functii fn_polite_* / fn_polita_*, coloane, triggere trg_polite_*) exista deja';
  END IF;
  -- 0c. CHECK-ul pe contracte_polite.tip: exact unul, exact valorile de azi (se inlocuieste cu + 'avans')
  SELECT count(*), min(c.conname::text), min(pg_get_constraintdef(c.oid)) INTO v_n, v_tip, v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.contracte_polite'::regclass AND c.contype = 'c'
     AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.contracte_polite'::regclass AND a.attname = 'tip')]::smallint[];
  IF v_n <> 1 OR v_def IS DISTINCT FROM 'CHECK ((tip = ANY (ARRAY[''GBE''::text, ''CAR''::text, ''GPL''::text, ''altul''::text])))' THEN
    RAISE EXCEPTION '20261205a: CHECK-ul pe contracte_polite.tip nu e cel asteptat (gasite %: % = %)', v_n, coalesce(v_tip, '-'), coalesce(v_def, '-');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.contracte_polite'::regclass AND c.contype = 'c'
                   AND pg_get_constraintdef(c.oid) LIKE '%''activa''::text%') THEN
    RAISE EXCEPTION '20261205a: contracte_polite.status nu are CHECK-ul cu activa (scadentele urmaresc doar politele active)';
  END IF;
  -- 0d. garantii: tipul car permis (20261002e), forma polita_asigurare, RLS fara FORCE (triggerul de sincronizare e al owner-ului)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.garantii'::regclass AND c.conname = 'garantii_tip_check'
                   AND pg_get_constraintdef(c.oid) LIKE '%''car''::text%' AND pg_get_constraintdef(c.oid) LIKE '%''participare''::text%'
                   AND pg_get_constraintdef(c.oid) LIKE '%''avans''::text%') THEN
    RAISE EXCEPTION '20261205a: garantii_tip_check nu permite car / participare / avans (20261002e neaplicata?)';
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.garantii'::regclass)
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.garantii'::regclass)) <> 'postgres'
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.contracte_polite'::regclass)) <> 'postgres'
     OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.contracte_polite_acte'::regclass)) <> 'postgres' THEN
    RAISE EXCEPTION '20261205a: garantii are FORCE RLS sau tabelele nu sunt ale lui postgres';
  END IF;
  IF to_regprocedure('public.fn_poate_scrie_garantii()') IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.fn_poate_scrie_garantii()')) THEN
    RAISE EXCEPTION '20261205a: public.fn_poate_scrie_garantii() lipseste sau nu e SECURITY DEFINER (20261005b)';
  END IF;
  -- 0e. notificarile: modulele folosite
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c WHERE c.conrelid = 'public.notifications'::regclass AND c.conname = 'notifications_modul_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''Financiar''::text%' OR v_def NOT LIKE '%''Execuție''::text%' OR v_def NOT LIKE '%''Ofertare''::text%' THEN
    RAISE EXCEPTION '20261205a: notifications_modul_check nu permite Financiar / Execuție / Ofertare';
  END IF;
  -- 0f. storage: bucket-ul contractelor (PDF-ul propunerii il urca edge-ul polita-citeste, cu service_role)
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'contracte-terti') THEN
    RAISE EXCEPTION '20261205a: lipseste bucket-ul contracte-terti';
  END IF;
  -- 0g. pg_cron / pg_net / vault, ca 20261130d
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '20261205a: lipsesc pg_cron / pg_net / vault';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'polite_alerte_zilnic') THEN RAISE EXCEPTION '20261205a: jobul polite_alerte_zilnic exista deja'; END IF;
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT' THEN
    RAISE EXCEPTION '20261205a: cron.timezone = % (astept GMT)', coalesce(current_setting('cron.timezone', true), '<nesetat>');
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'INTERN_EDGE_SECRET' AND decrypted_secret ~ '^[0-9a-f]{64}$') <> 1 THEN
    RAISE EXCEPTION '20261205a: INTERN_EDGE_SECRET lipsa sau nu are formatul de 64 hex cerut de _shared/poartaIntern.ts';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname NOT IN ('net', 'pg_catalog', 'information_schema') AND p.prosrc ~ '(http_request_queue|_http_response)'
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('net', 'pg_catalog', 'information_schema')
               AND pg_get_viewdef(c.oid) ~ '(http_request_queue|_http_response)'
               AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))) THEN
    RAISE EXCEPTION '20261205a: un obiect accesibil anon/authenticated citeste coada pg_net';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261205a: anon/authenticated pot crea obiecte in public';
  END IF;
END $pre$;

-- ─── 1. contracte_polite / contracte_polite_acte: tipul avans, coloane noi ─────────────────────────────────────────────────────
DO $tip$
DECLARE v_vechi text;
BEGIN
  SELECT c.conname::text INTO v_vechi FROM pg_constraint c
   WHERE c.conrelid = 'public.contracte_polite'::regclass AND c.contype = 'c'
     AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.contracte_polite'::regclass AND a.attname = 'tip')]::smallint[];
  EXECUTE format('ALTER TABLE public.contracte_polite DROP CONSTRAINT %I', v_vechi);
  ALTER TABLE public.contracte_polite ADD CONSTRAINT contracte_polite_tip_check
    CHECK (tip = ANY (ARRAY['GBE'::text, 'CAR'::text, 'GPL'::text, 'avans'::text, 'altul'::text]));
  -- revenirea reface constrangerea veche cu numele ei (pastrat aici)
  EXECUTE format('COMMENT ON CONSTRAINT contracte_polite_tip_check ON public.contracte_polite IS %L', 'polite 20261205a; nume_vechi=' || v_vechi);
END $tip$;

ALTER TABLE public.contracte_polite
  ADD COLUMN moneda text NOT NULL DEFAULT 'RON',
  ADD COLUMN executie_de_la date,
  ADD COLUMN executie_pana_la date,
  ADD COLUMN garantie_de_la date,
  ADD COLUMN garantie_pana_la date,
  ADD COLUMN pdf_sha256 text,
  ADD COLUMN sursa text NOT NULL DEFAULT 'manual',
  ADD COLUMN propunere_id bigint;
ALTER TABLE public.contracte_polite
  ADD CONSTRAINT contracte_polite_moneda_check CHECK (moneda = ANY (ARRAY['RON'::text, 'EUR'::text])),
  ADD CONSTRAINT contracte_polite_sursa_check CHECK (sursa = ANY (ARRAY['manual'::text, 'citit'::text, 'tura_noapte'::text, 'coada_locala'::text])),
  ADD CONSTRAINT contracte_polite_sha_check CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT contracte_polite_executie_check CHECK (executie_de_la IS NULL OR executie_pana_la IS NULL OR executie_pana_la >= executie_de_la),
  ADD CONSTRAINT contracte_polite_garantie_check CHECK (garantie_de_la IS NULL OR garantie_pana_la IS NULL OR garantie_pana_la >= garantie_de_la),
  ADD CONSTRAINT contracte_polite_provenienta_check CHECK ((sursa = 'manual') = (propunere_id IS NULL));

ALTER TABLE public.contracte_polite_acte
  ADD COLUMN executie_de_la date,
  ADD COLUMN executie_pana_la date,
  ADD COLUMN garantie_de_la date,
  ADD COLUMN garantie_pana_la date,
  ADD COLUMN pdf_sha256 text,
  ADD COLUMN sursa text NOT NULL DEFAULT 'manual',
  ADD COLUMN propunere_id bigint;
ALTER TABLE public.contracte_polite_acte
  ADD CONSTRAINT contracte_polite_acte_sursa_check CHECK (sursa = ANY (ARRAY['manual'::text, 'citit'::text, 'tura_noapte'::text, 'coada_locala'::text])),
  ADD CONSTRAINT contracte_polite_acte_sha_check CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT contracte_polite_acte_executie_check CHECK (executie_de_la IS NULL OR executie_pana_la IS NULL OR executie_pana_la >= executie_de_la),
  ADD CONSTRAINT contracte_polite_acte_garantie_check CHECK (garantie_de_la IS NULL OR garantie_pana_la IS NULL OR garantie_pana_la >= garantie_de_la),
  ADD CONSTRAINT contracte_polite_acte_provenienta_check CHECK ((sursa = 'manual') = (propunere_id IS NULL));
COMMENT ON COLUMN public.contracte_polite.sursa IS 'Polite 20261205a: manual / citit / tura_noapte / coada_locala. O pune DOAR fn_polita_salveaza (trigger trg_polite_provenienta); imuabila.';
COMMENT ON COLUMN public.contracte_polite.pdf_sha256 IS 'Polite 20261205a: sha256 al PDF-ului citit (identitatea documentului, pentru dedup). Pus doar din propunere; NULL pe calea manuala.';

-- ─── 2. polite_propuneri ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.polite_propuneri (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stare text NOT NULL DEFAULT 'in_citire' CHECK (stare = ANY (ARRAY['in_citire'::text, 'propus'::text, 'confirmat'::text, 'respins'::text, 'eroare'::text])),
  sursa text NOT NULL CHECK (sursa = ANY (ARRAY['incarcare'::text, 'tura_noapte'::text, 'coada_locala'::text])),
  cititor text NOT NULL CHECK (cititor = ANY (ARRAY['platit'::text, 'local_dublu'::text])),
  sursa_detaliu text CHECK (sursa_detaliu IS NULL OR length(sursa_detaliu) <= 1000),
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_cale text NOT NULL,
  este_act boolean NOT NULL DEFAULT false,
  campuri jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(campuri) = 'object'),
  citiri jsonb CHECK (citiri IS NULL OR jsonb_typeof(citiri) = 'object'),
  dezacorduri jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(dezacorduri) = 'array'),
  contract_propus_id bigint REFERENCES public.contracte_terti(id) ON DELETE SET NULL,
  polita_baza_propusa_id bigint REFERENCES public.contracte_polite(id) ON DELETE SET NULL,
  model text CHECK (model IS NULL OR model ~ '^[a-z0-9.-]{1,60}$'),
  cost_usd numeric(10,6) CHECK (cost_usd IS NULL OR (cost_usd >= 0 AND cost_usd < 100)),
  eroare text CHECK (eroare IS NULL OR eroare ~ '^[a-z0-9_]{1,60}$'),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  confirmare_txid bigint,
  decis_de uuid,
  decis_la timestamptz,
  motiv_respingere text CHECK (motiv_respingere IS NULL OR length(motiv_respingere) <= 500),
  CONSTRAINT polite_propuneri_cale_check CHECK (pdf_cale = 'polite/propuneri/' || pdf_sha256 || '.pdf'),
  CONSTRAINT polite_propuneri_decizie_check CHECK ((stare = ANY (ARRAY['confirmat'::text, 'respins'::text])) = (decis_la IS NOT NULL AND decis_de IS NOT NULL)),
  CONSTRAINT polite_propuneri_eroare_check CHECK ((stare = 'eroare') = (eroare IS NOT NULL)),
  CONSTRAINT polite_propuneri_sha_cititor_key UNIQUE (pdf_sha256, cititor)
);
COMMENT ON TABLE public.polite_propuneri IS 'Polite 20261205a: propuneri citite din PDF-uri de polite / acte aditionale (continut EXTERN = date). Nu sunt polite active si nu dau alerte; devin polita doar prin fn_polita_salveaza (confirmarea omului). Scriere doar prin RPC-uri (edge cu service_role) sau de tura de noapte; citire pentru cine poate scrie polite.';
CREATE INDEX polite_propuneri_stare_idx ON public.polite_propuneri (stare, creat_la DESC);

ALTER TABLE public.contracte_polite ADD CONSTRAINT contracte_polite_propunere_fkey FOREIGN KEY (propunere_id) REFERENCES public.polite_propuneri(id) ON DELETE RESTRICT;
ALTER TABLE public.contracte_polite_acte ADD CONSTRAINT contracte_polite_acte_propunere_fkey FOREIGN KEY (propunere_id) REFERENCES public.polite_propuneri(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX contracte_polite_propunere_uidx ON public.contracte_polite (propunere_id) WHERE propunere_id IS NOT NULL;
CREATE UNIQUE INDEX contracte_polite_acte_propunere_uidx ON public.contracte_polite_acte (propunere_id) WHERE propunere_id IS NOT NULL;

-- ─── 3. garantii.contract_polita_id ──────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.garantii ADD COLUMN contract_polita_id bigint;
ALTER TABLE public.garantii ADD CONSTRAINT garantii_contract_polita_fkey FOREIGN KEY (contract_polita_id) REFERENCES public.contracte_polite(id) ON DELETE RESTRICT;
ALTER TABLE public.garantii ADD CONSTRAINT garantii_contract_polita_forma_check CHECK (contract_polita_id IS NULL OR forma = 'polita_asigurare');
CREATE UNIQUE INDEX garantii_contract_polita_uidx ON public.garantii (contract_polita_id) WHERE contract_polita_id IS NOT NULL;
COMMENT ON COLUMN public.garantii.contract_polita_id IS 'Polite 20261205a (D1): polita de pe contract (contracte_polite) a acestui rand din Registru. Cand e setata, emitentul, nr., valoarea, moneda, emiterea, expirarea efectiva, tipul si contractul se copiaza din polita (trg_polite_garantii_din_polita) si nu se pot desparti.';
GRANT SELECT (contract_polita_id) ON public.garantii TO authenticated;

-- ─── 4. Ajutoare (interne, fara EXECUTE pentru nimeni in afara de postgres) ───────────────────────────────────────────────────
CREATE FUNCTION public.fn_polite_norm_nr(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'))
$fn$;

CREATE FUNCTION public.fn_polite_text(p jsonb, p_cheie text, p_max integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE v text;
BEGIN
  IF p IS NULL OR NOT (p ? p_cheie) OR jsonb_typeof(p -> p_cheie) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p -> p_cheie) <> 'string' THEN RAISE EXCEPTION 'camp_invalid:%', p_cheie USING ERRCODE = '22023'; END IF;
  v := btrim(p ->> p_cheie);
  IF v = '' THEN RETURN NULL; END IF;
  IF length(v) > p_max THEN RAISE EXCEPTION 'camp_prea_lung:%', p_cheie USING ERRCODE = '22023'; END IF;
  RETURN v;
END $fn$;

CREATE FUNCTION public.fn_polite_data(p jsonb, p_cheie text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE v text; d date;
BEGIN
  v := public.fn_polite_text(p, p_cheie, 10);
  IF v IS NULL THEN RETURN NULL; END IF;
  IF v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'data_invalida:%', p_cheie USING ERRCODE = '22023'; END IF;
  BEGIN
    d := v::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'data_invalida:%', p_cheie USING ERRCODE = '22023';
  END;
  IF d < DATE '1990-01-01' OR d > DATE '2100-12-31' THEN RAISE EXCEPTION 'data_invalida:%', p_cheie USING ERRCODE = '22023'; END IF;
  RETURN d;
END $fn$;

CREATE FUNCTION public.fn_polite_suma(p jsonb, p_cheie text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE v text; n numeric;
BEGIN
  IF p IS NULL OR NOT (p ? p_cheie) OR jsonb_typeof(p -> p_cheie) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p -> p_cheie) NOT IN ('number', 'string') THEN RAISE EXCEPTION 'suma_invalida:%', p_cheie USING ERRCODE = '22023'; END IF;
  v := btrim(p ->> p_cheie);
  IF v = '' THEN RETURN NULL; END IF;
  -- doar punct zecimal, cel mult 2 zecimale: separatorii RO/EN se lamuresc in UI, nu aici (L17)
  IF v !~ '^[0-9]{1,11}([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'suma_invalida:%', p_cheie USING ERRCODE = '22023'; END IF;
  n := v::numeric;
  IF n <= 0 THEN RAISE EXCEPTION 'suma_invalida:%', p_cheie USING ERRCODE = '22023'; END IF;
  RETURN n;
END $fn$;

-- cine poate citi / confirma propuneri si salva polite prin RPC: owner, cine gestioneaza contracte (aceeasi regula ca politica de
-- storage pe contracte-terti, 20261024a) sau cine poate scrie garantii (20261005b)
CREATE FUNCTION public.fn_poate_scrie_polite() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_owner IS TRUE OR p.can_manage_contracts IS TRUE))
    OR public.fn_poate_scrie_garantii() IS TRUE)
$fn$;

CREATE FUNCTION public.fn_polite_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
$fn$;

-- ─── 5. Triggere: provenienta pe polite / acte, sincronizarea Registrului ───────────────────────────────────────────────────
CREATE FUNCTION public.fn_polite_provenienta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_p public.polite_propuneri%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.propunere_id IS NULL THEN
      NEW.sursa := 'manual'; NEW.pdf_sha256 := NULL;
    ELSE
      -- propunerea trebuie sa fie marcata de fn_polita_salveaza IN ACEEASI tranzactie
      SELECT * INTO v_p FROM public.polite_propuneri p WHERE p.id = NEW.propunere_id;
      IF NOT FOUND OR v_p.stare <> 'propus' OR v_p.confirmare_txid IS DISTINCT FROM txid_current() THEN
        RAISE EXCEPTION 'provenienta_invalida' USING ERRCODE = '42501';
      END IF;
      NEW.sursa := CASE v_p.sursa WHEN 'incarcare' THEN 'citit' WHEN 'tura_noapte' THEN 'tura_noapte' ELSE 'coada_locala' END;
      NEW.pdf_sha256 := v_p.pdf_sha256;
    END IF;
  ELSE
    NEW.propunere_id := OLD.propunere_id; NEW.sursa := OLD.sursa;
    NEW.pdf_sha256 := CASE WHEN NEW.pdf_path IS NOT DISTINCT FROM OLD.pdf_path THEN OLD.pdf_sha256 END;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_polite_provenienta BEFORE INSERT OR UPDATE ON public.contracte_polite
  FOR EACH ROW EXECUTE FUNCTION public.fn_polite_provenienta();
CREATE TRIGGER trg_polite_provenienta BEFORE INSERT OR UPDATE ON public.contracte_polite_acte
  FOR EACH ROW EXECUTE FUNCTION public.fn_polite_provenienta();

-- randul din Registru legat: campurile documentului vin din polita (sursa unica)
CREATE FUNCTION public.fn_polite_garantii_din_polita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_p record; v_exp date; v_val numeric;
BEGIN
  IF NEW.contract_polita_id IS NULL THEN RETURN NEW; END IF;
  SELECT cp.* INTO v_p FROM public.contracte_polite cp WHERE cp.id = NEW.contract_polita_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'polita_inexistenta' USING ERRCODE = '23503'; END IF;
  SELECT max(a.data_expirare_noua) INTO v_exp FROM public.contracte_polite_acte a WHERE a.polita_id = v_p.id;
  SELECT a.valoare_noua_lei INTO v_val FROM public.contracte_polite_acte a
   WHERE a.polita_id = v_p.id AND a.valoare_noua_lei IS NOT NULL ORDER BY a.nr_act DESC, a.id DESC LIMIT 1;
  NEW.emitent := coalesce(v_p.asigurator, NEW.emitent);
  NEW.numar_document := coalesce(v_p.nr_polita, NEW.numar_document);
  NEW.valoare := coalesce(v_val, v_p.valoare_lei, NEW.valoare);
  NEW.moneda := v_p.moneda;
  NEW.data_emitere := coalesce(v_p.data_emitere, NEW.data_emitere);
  NEW.data_expirare := coalesce(v_exp, v_p.data_expirare, NEW.data_expirare);
  NEW.tip := CASE v_p.tip WHEN 'GBE' THEN 'buna_executie' WHEN 'CAR' THEN 'car' WHEN 'GPL' THEN 'participare' WHEN 'avans' THEN 'avans' ELSE NEW.tip END;
  NEW.contract_terti_id := v_p.contract_id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_polite_garantii_din_polita BEFORE INSERT OR UPDATE ON public.garantii
  FOR EACH ROW WHEN (NEW.contract_polita_id IS NOT NULL) EXECUTE FUNCTION public.fn_polite_garantii_din_polita();

-- o schimbare pe polita / actele ei reimprospateaza randul legat (UPDATE => triggerul de mai sus recopiaza)
CREATE FUNCTION public.fn_polite_reimprospateaza_garantii() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'contracte_polite' THEN
    v_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_id := OLD.polita_id;
  ELSE
    v_id := NEW.polita_id;
    IF TG_OP = 'UPDATE' AND OLD.polita_id IS DISTINCT FROM NEW.polita_id THEN
      UPDATE public.garantii g SET updated_at = now() WHERE g.contract_polita_id = OLD.polita_id;
    END IF;
  END IF;
  UPDATE public.garantii g SET updated_at = now() WHERE g.contract_polita_id = v_id;
  RETURN NULL;
END $fn$;
CREATE TRIGGER trg_polite_reimprospateaza_garantii AFTER UPDATE ON public.contracte_polite
  FOR EACH ROW EXECUTE FUNCTION public.fn_polite_reimprospateaza_garantii();
CREATE TRIGGER trg_polite_reimprospateaza_garantii AFTER INSERT OR UPDATE OR DELETE ON public.contracte_polite_acte
  FOR EACH ROW EXECUTE FUNCTION public.fn_polite_reimprospateaza_garantii();

-- ─── 6. Scadentele: o singura definitie ─────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: din UI se vede doar ce poate vedea utilizatorul (RLS-ul tabelelor sursa); cron-ul o cheama prin functii DEFINER.
CREATE FUNCTION public.fn_polite_scadente(p_azi date DEFAULT NULL)
RETURNS TABLE(cheie text, sursa text, ref_id bigint, contract_id bigint, numar_contract text, contract_denumire text,
              proiect_id bigint, proiect_nume text, tip text, asigurator text, nr_polita text, valoare numeric, moneda text,
              data_expirare date, zile integer, prag text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  WITH azi AS (SELECT coalesce(p_azi, (now() AT TIME ZONE 'Europe/Bucharest')::date) AS d),
  x AS (
    SELECT 'contract'::text AS sursa, cp.id::bigint AS ref_id, cp.contract_id::bigint AS contract_id, cp.tip, cp.asigurator, cp.nr_polita,
           coalesce((SELECT a.valoare_noua_lei FROM public.contracte_polite_acte a WHERE a.polita_id = cp.id AND a.valoare_noua_lei IS NOT NULL
                      ORDER BY a.nr_act DESC, a.id DESC LIMIT 1), cp.valoare_lei) AS valoare,
           cp.moneda,
           coalesce((SELECT max(a.data_expirare_noua) FROM public.contracte_polite_acte a WHERE a.polita_id = cp.id), cp.data_expirare) AS data_expirare
      FROM public.contracte_polite cp
     WHERE cp.status = 'activa'
    UNION ALL
    SELECT 'registru'::text, g.id, g.contract_terti_id,
           CASE g.tip WHEN 'buna_executie' THEN 'GBE' WHEN 'car' THEN 'CAR' WHEN 'participare' THEN 'GPL' WHEN 'avans' THEN 'avans' ELSE 'altul' END,
           g.emitent, g.numar_document, g.valoare, g.moneda, g.data_expirare
      FROM public.garantii g
     WHERE g.forma = 'polita_asigurare' AND g.stare = 'activa' AND g.contract_polita_id IS NULL
  )
  SELECT x.sursa || ':' || x.ref_id, x.sursa, x.ref_id, x.contract_id, ct.numar_contract, ct.denumire, ep.id::bigint, ep.nume,
         x.tip, x.asigurator, x.nr_polita, x.valoare, x.moneda, x.data_expirare, (x.data_expirare - azi.d)::integer,
         CASE WHEN x.data_expirare IS NULL THEN NULL
              WHEN x.data_expirare - azi.d > 60 THEN NULL
              WHEN x.data_expirare - azi.d > 30 THEN '60'
              WHEN x.data_expirare - azi.d > 15 THEN '30'
              WHEN x.data_expirare - azi.d > 0 THEN '15'
              WHEN x.data_expirare - azi.d > -7 THEN '0'
              ELSE 'r' || ((azi.d - x.data_expirare) / 7)::text END
    FROM x CROSS JOIN azi
    LEFT JOIN public.contracte_terti ct ON ct.id = x.contract_id
    LEFT JOIN public.executie_proiecte ep ON ep.contract_id = x.contract_id
$fn$;
CREATE VIEW public.v_polite_scadente WITH (security_invoker = on) AS SELECT * FROM public.fn_polite_scadente(NULL);
COMMENT ON VIEW public.v_polite_scadente IS 'Polite 20261205a: scadentele politelor active (contract + Registru nelegat), din fn_polite_scadente (singura definitie). security_invoker. Sursa „Polite CAR / GBE” din Administrator -> Alerte si cartonasul de pe pagina proiectului.';

-- ─── 7. Alerte: destinatari, comutator, jurnal ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.polite_alerte_destinatari (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  departament text NOT NULL CHECK (departament = ANY (ARRAY['financiar'::text, 'executie'::text, 'ofertare'::text])),
  fel text NOT NULL CHECK (fel = ANY (ARRAY['adresa'::text, 'sef_santier'::text, 'manager_proiect'::text])),
  nume text CHECK (nume IS NULL OR length(btrim(nume)) BETWEEN 1 AND 120),
  email text,
  tipuri text[] NOT NULL DEFAULT ARRAY['GBE'::text, 'CAR'::text, 'GPL'::text, 'avans'::text, 'altul'::text],
  activ boolean NOT NULL DEFAULT true,
  observatii text CHECK (observatii IS NULL OR length(observatii) <= 500),
  creat_de uuid,
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT polite_dest_email_check CHECK (email IS NULL OR email ~ '^[a-z0-9._%+-]+@gazpet[.]ro$'),
  CONSTRAINT polite_dest_fel_check CHECK (fel = 'adresa' OR (departament = 'executie' AND email IS NULL)),
  CONSTRAINT polite_dest_tipuri_check CHECK (cardinality(tipuri) >= 1 AND tipuri <@ ARRAY['GBE'::text, 'CAR'::text, 'GPL'::text, 'avans'::text, 'altul'::text])
);
CREATE UNIQUE INDEX polite_dest_unic_uidx ON public.polite_alerte_destinatari (departament, fel, coalesce(email, 'nume:' || coalesce(nume, '')));
COMMENT ON TABLE public.polite_alerte_destinatari IS 'Polite 20261205a: destinatarii alertelor de expirare, pe departament (Administrator -> Alerte polite, doar owner). adresa = adresa fixa (doar @gazpet.ro, si in BD); sef_santier / manager_proiect = contul ERP al omului de pe proiectul contractului. Nicio adresa nu vine din continutul documentelor.';

CREATE FUNCTION public.fn_polite_dest_normalizeaza() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.email := nullif(lower(btrim(NEW.email)), '');
  NEW.nume := nullif(btrim(NEW.nume), '');
  IF TG_OP = 'INSERT' THEN
    NEW.creat_de := auth.uid(); NEW.creat_la := now();
  ELSE
    NEW.creat_de := OLD.creat_de; NEW.creat_la := OLD.creat_la;
  END IF;
  NEW.actualizat_la := now();
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_polite_dest_normalizeaza BEFORE INSERT OR UPDATE ON public.polite_alerte_destinatari
  FOR EACH ROW EXECUTE FUNCTION public.fn_polite_dest_normalizeaza();

CREATE TABLE public.polite_alerte_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  activ boolean NOT NULL DEFAULT false,
  schimbat_de uuid,
  schimbat_la timestamptz,
  proba_la timestamptz,
  proba_lot uuid
);
INSERT INTO public.polite_alerte_config (id, activ) VALUES (true, false);

CREATE TABLE public.polite_alerte_jurnal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cheie text NOT NULL CHECK (length(cheie) BETWEEN 1 AND 400),
  lot uuid NOT NULL,
  zi date NOT NULL,
  sursa text NOT NULL CHECK (sursa = ANY (ARRAY['contract'::text, 'registru'::text])),
  ref_id bigint NOT NULL,
  prag text NOT NULL CHECK (prag ~ '^(60|30|15|0|r[1-9][0-9]{0,3})$'),
  data_expirare date,
  departamente text[] NOT NULL CHECK (cardinality(departamente) >= 1 AND departamente <@ ARRAY['financiar'::text, 'executie'::text, 'ofertare'::text]),
  destinatar_email text CHECK (destinatar_email IS NULL OR destinatar_email ~ '^[a-z0-9._%+-]+@gazpet[.]ro$'),
  profile_id uuid,
  rand jsonb NOT NULL CHECK (jsonb_typeof(rand) = 'object'),
  stare text NOT NULL CHECK (stare = ANY (ARRAY['proba'::text, 'rezervat'::text, 'trimis'::text, 'necunoscut'::text, 'eroare'::text, 'fara_adresa'::text])),
  notificat boolean NOT NULL DEFAULT false,
  resend_id text CHECK (resend_id IS NULL OR resend_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  eroare text CHECK (eroare IS NULL OR eroare ~ '^[a-z0-9_]{1,60}$'),
  creat_la timestamptz NOT NULL DEFAULT now(),
  actualizat_la timestamptz,
  CONSTRAINT polite_jurnal_adresa_check CHECK (CASE stare WHEN 'fara_adresa' THEN destinatar_email IS NULL WHEN 'proba' THEN true ELSE destinatar_email IS NOT NULL END)
);
-- dedup: o singura alerta reala pe cheie (polita + prag + expirare + destinatar); randurile de proba nu blocheaza nimic
CREATE UNIQUE INDEX polite_jurnal_cheie_uidx ON public.polite_alerte_jurnal (cheie) WHERE stare <> 'proba';
CREATE INDEX polite_jurnal_creat_idx ON public.polite_alerte_jurnal (creat_la DESC);
COMMENT ON TABLE public.polite_alerte_jurnal IS 'Polite 20261205a: jurnalul alertelor (dedup + rularea de proba). rezervat -> trimis / necunoscut (timeout sau 5xx: fara retrimitere automata) / eroare; fara_adresa = un departament fara destinatar pe acea polita. Scris doar prin RPC-uri.';

-- ─── 8. RPC-urile ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 8a. calculul alertelor de azi, pe destinatar (intern; doar functiile DEFINER de mai jos il cheama)
CREATE FUNCTION public.fn_polite_alerte_calculeaza(p_azi date)
RETURNS TABLE(cheie text, sursa text, ref_id bigint, prag text, data_expirare date, departamente text[], destinatar_email text,
              profile_id uuid, rand jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH s AS (SELECT * FROM public.fn_polite_scadente(p_azi) WHERE prag IS NOT NULL),
  d AS (SELECT * FROM public.polite_alerte_destinatari WHERE activ),
  t AS (
    SELECT s.*, d.departament,
           CASE WHEN d.fel = 'adresa' THEN d.email
                ELSE (SELECT lower(pr.email) FROM public.profiles pr JOIN public.executie_proiecte ep ON ep.id = s.proiect_id
                       WHERE pr.employee_id = CASE d.fel WHEN 'sef_santier' THEN ep.sef_santier_employee_id ELSE ep.mp_employee_id END
                         AND lower(pr.email) ~ '^[a-z0-9._%+-]+@gazpet[.]ro$'
                       ORDER BY pr.id LIMIT 1) END AS em,
           d.fel
      FROM s JOIN d ON s.tip = ANY (d.tipuri)
  )
  SELECT CASE WHEN t.em IS NULL THEN t.cheie || '|' || t.prag || '|' || coalesce(t.data_expirare::text, '-') || '|fara:' || min(t.departament) || ':' || min(t.fel)
              ELSE t.cheie || '|' || t.prag || '|' || coalesce(t.data_expirare::text, '-') || '|' || t.em END,
         t.sursa, t.ref_id, t.prag, t.data_expirare, array_agg(DISTINCT t.departament ORDER BY t.departament), t.em,
         (SELECT pr.id FROM public.profiles pr WHERE lower(pr.email) = t.em ORDER BY pr.id LIMIT 1),
         jsonb_build_object('cheie', t.cheie, 'sursa', t.sursa, 'ref_id', t.ref_id, 'contract_id', t.contract_id, 'numar_contract', t.numar_contract,
                            'contract_denumire', t.contract_denumire, 'proiect_id', t.proiect_id, 'proiect_nume', t.proiect_nume, 'tip', t.tip,
                            'asigurator', t.asigurator, 'nr_polita', t.nr_polita, 'valoare', t.valoare, 'moneda', t.moneda,
                            'data_expirare', t.data_expirare, 'zile', t.zile, 'prag', t.prag)
    FROM t
   GROUP BY t.cheie, t.sursa, t.ref_id, t.prag, t.data_expirare, t.em, t.contract_id, t.numar_contract, t.contract_denumire, t.proiect_id,
            t.proiect_nume, t.tip, t.asigurator, t.nr_polita, t.valoare, t.moneda, t.zile,
            CASE WHEN t.em IS NULL THEN t.departament || ':' || t.fel END
$fn$;

-- 8b. rularea de proba (owner): scrie DOAR randuri 'proba' in jurnal (cine ce ar primi azi), nu trimite nimic
CREATE FUNCTION public.fn_polite_alerte_proba(p_azi date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_lot uuid := gen_random_uuid(); v_zi date := coalesce(p_azi, (now() AT TIME ZONE 'Europe/Bucharest')::date); v_n integer; v_m integer; v_f integer;
BEGIN
  IF NOT public.fn_polite_e_owner() THEN RAISE EXCEPTION 'doar_owner' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('polite_alerte_jurnal'));
  DELETE FROM public.polite_alerte_jurnal j WHERE j.stare = 'proba';
  INSERT INTO public.polite_alerte_jurnal (cheie, lot, zi, sursa, ref_id, prag, data_expirare, departamente, destinatar_email, profile_id, rand, stare)
  SELECT c.cheie, v_lot, v_zi, c.sursa, c.ref_id, c.prag, c.data_expirare, c.departamente, c.destinatar_email, c.profile_id, c.rand, 'proba'
    FROM public.fn_polite_alerte_calculeaza(v_zi) c
   WHERE NOT EXISTS (SELECT 1 FROM public.polite_alerte_jurnal j WHERE j.cheie = c.cheie AND j.stare <> 'proba');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT count(DISTINCT j.destinatar_email), count(*) FILTER (WHERE j.destinatar_email IS NULL) INTO v_m, v_f
    FROM public.polite_alerte_jurnal j WHERE j.lot = v_lot;
  -- momentul probei se tine pe comutator: si o proba fara niciun rand (nicio polita in prag) permite pornirea
  UPDATE public.polite_alerte_config c SET proba_la = now(), proba_lot = v_lot WHERE c.id;
  RETURN jsonb_build_object('lot', v_lot, 'zi', v_zi, 'randuri', v_n, 'destinatari', v_m, 'fara_adresa', v_f);
END $fn$;

-- 8c. comutatorul (owner): pornirea cere o rulare de proba in ultimele 24 h
CREATE FUNCTION public.fn_polite_alerte_porneste(p_activ boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public.polite_alerte_config%ROWTYPE;
BEGIN
  IF NOT public.fn_polite_e_owner() THEN RAISE EXCEPTION 'doar_owner' USING ERRCODE = '42501'; END IF;
  IF p_activ IS NULL THEN RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v FROM public.polite_alerte_config c WHERE c.id FOR UPDATE;
  IF p_activ AND v.proba_la IS NULL THEN
    RAISE EXCEPTION 'fara_proba' USING ERRCODE = 'P0001', HINT = 'Ruleaza intai proba (cine ce ar primi), apoi porneste alertele.';
  END IF;
  IF p_activ AND v.proba_la <= now() - interval '24 hours' THEN
    RAISE EXCEPTION 'proba_veche' USING ERRCODE = 'P0001', HINT = 'Proba are mai mult de 24 de ore: ruleaz-o din nou.';
  END IF;
  UPDATE public.polite_alerte_config c SET activ = p_activ, schimbat_de = auth.uid(), schimbat_la = now() WHERE c.id RETURNING * INTO v;
  RETURN jsonb_build_object('activ', v.activ, 'schimbat_la', v.schimbat_la);
END $fn$;

-- 8d. cronul (edge polite-alerte-mail, service_role): rezerva alertele de azi (L04: INSERT .. ON CONFLICT DO NOTHING RETURNING),
--     pune notificarile in aplicatie pentru randurile rezervate si le intoarce edge-ului; comutatorul oprit => nimic
CREATE FUNCTION public.fn_polite_alerte_rezerva(p_azi date DEFAULT NULL)
RETURNS TABLE(id bigint, cheie text, prag text, departamente text[], destinatar_email text, stare text, rand jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE v_lot uuid := gen_random_uuid(); v_zi date := coalesce(p_azi, (now() AT TIME ZONE 'Europe/Bucharest')::date);
BEGIN
  IF (SELECT c.activ FROM public.polite_alerte_config c WHERE c.id) IS NOT TRUE THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('polite_alerte_jurnal'));
  -- o rezervare ramasa (edge oprit intre rezervare si trimitere) devine „necunoscut”: NU se retrimite automat (L05)
  UPDATE public.polite_alerte_jurnal j SET stare = 'necunoscut', eroare = 'rezervare_veche', actualizat_la = now()
   WHERE j.stare = 'rezervat' AND j.creat_la < now() - interval '1 hour';
  -- o singura instructiune: rezervarea, notificarile in aplicatie (o notificare pe rand rezervat cu cont ERP, aceeasi cheie de dedup
  -- ca mailul) si randurile intoarse edge-ului
  RETURN QUERY
  WITH ins AS (
    INSERT INTO public.polite_alerte_jurnal AS j (cheie, lot, zi, sursa, ref_id, prag, data_expirare, departamente, destinatar_email, profile_id, rand, stare, notificat)
    SELECT c.cheie, v_lot, v_zi, c.sursa, c.ref_id, c.prag, c.data_expirare, c.departamente, c.destinatar_email, c.profile_id, c.rand,
           CASE WHEN c.destinatar_email IS NULL THEN 'fara_adresa' ELSE 'rezervat' END,
           c.destinatar_email IS NOT NULL AND c.profile_id IS NOT NULL
      FROM public.fn_polite_alerte_calculeaza(v_zi) c
    ON CONFLICT (cheie) WHERE stare <> 'proba' DO NOTHING
    RETURNING j.id, j.cheie, j.prag, j.departamente, j.destinatar_email, j.profile_id, j.stare, j.rand, j.notificat),
  notif AS (
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT r.profile_id, 'warning',
         CASE WHEN 'financiar' = ANY (r.departamente) THEN 'Financiar' WHEN 'executie' = ANY (r.departamente) THEN 'Execuție' ELSE 'Ofertare' END,
         left('Poliță ' || coalesce(r.rand->>'tip', '') || ' ' || coalesce(r.rand->>'nr_polita', 'fără număr') || ': ' ||
              CASE WHEN r.prag IN ('60', '30', '15') THEN 'expiră în ' || (r.rand->>'zile') || ' zile'
                   WHEN r.prag = '0' THEN CASE WHEN (r.rand->>'zile')::integer = 0 THEN 'expiră azi' ELSE 'a expirat' END
                   ELSE 'expirată de ' || (-(r.rand->>'zile')::integer) || ' zile, fără prelungire' END, 200),
         left(concat_ws(' · ', nullif(r.rand->>'asigurator', ''), CASE WHEN r.rand->>'numar_contract' IS NOT NULL THEN 'contract ' || (r.rand->>'numar_contract') END,
                        nullif(r.rand->>'proiect_nume', ''), 'valabilă până la ' || coalesce(to_char((r.rand->>'data_expirare')::date, 'DD.MM.YYYY'), '—'))
              || '. Încarcă actul adițional de prelungire (contract → Polițe) sau marchează polița închisă.', 1000),
         CASE WHEN 'financiar' = ANY (r.departamente) THEN '/financiar?tab=garantii'
              WHEN 'executie' = ANY (r.departamente) AND r.rand->>'proiect_id' IS NOT NULL THEN '/executie?proiect=' || (r.rand->>'proiect_id')
              ELSE '/administrativ' END
    FROM ins r WHERE r.notificat
  RETURNING 1)
  SELECT r.id, r.cheie, r.prag, r.departamente, r.destinatar_email, r.stare, r.rand FROM ins r ORDER BY r.id;
END $fn$;

-- 8e. edge-ul marcheaza rezultatul trimiterii (doar din 'rezervat'; CAS)
CREATE FUNCTION public.fn_polite_alerte_marcheaza(p_ids bigint[], p_stare text, p_resend_id text, p_eroare text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_stare IS NULL OR p_stare NOT IN ('trimis', 'necunoscut', 'eroare') OR p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500
     OR (p_stare = 'trimis') <> (p_eroare IS NULL) THEN
    RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.polite_alerte_jurnal j SET stare = p_stare, resend_id = p_resend_id, eroare = p_eroare, actualizat_la = now()
   WHERE j.id = ANY (p_ids) AND j.stare = 'rezervat';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

-- 8f. propunerile: rezervarea citirii platite (o singura citire pe document, L04 / L22), completarea, esecul
CREATE FUNCTION public.fn_polite_propunere_rezerva(p_sha text, p_user uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint; v_p public.polite_propuneri%ROWTYPE;
BEGIN
  IF p_sha IS NULL OR p_sha !~ '^[0-9a-f]{64}$' OR p_user IS NULL THEN RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.polite_propuneri AS p (stare, sursa, cititor, pdf_sha256, pdf_cale, creat_de)
  VALUES ('in_citire', 'incarcare', 'platit', p_sha, 'polite/propuneri/' || p_sha || '.pdf', p_user)
  ON CONFLICT ON CONSTRAINT polite_propuneri_sha_cititor_key DO NOTHING
  RETURNING p.id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('rezervat', true, 'id', v_id); END IF;
  SELECT * INTO v_p FROM public.polite_propuneri p WHERE p.pdf_sha256 = p_sha AND p.cititor = 'platit';
  RETURN jsonb_build_object('rezervat', false, 'id', v_p.id, 'stare', v_p.stare, 'creat_la', v_p.creat_la);
END $fn$;

CREATE FUNCTION public.fn_polite_propunere_completeaza(p_id bigint, p_campuri jsonb, p_dezacorduri jsonb, p_model text, p_cost numeric) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_nr text; v_data date; v_pol text; v_contract bigint; v_baza bigint; v_act boolean; v_n integer;
  c_chei CONSTANT text[] := ARRAY['tip', 'este_act_aditional', 'asigurator', 'nr_polita', 'nr_act', 'polita_baza_nr', 'suma', 'moneda', 'data_emitere',
    'executie_de_la', 'executie_pana_la', 'garantie_de_la', 'garantie_pana_la', 'valabila_pana_la', 'contract_nr', 'contract_data', 'lucrare',
    'beneficiar', 'dovezi'];
BEGIN
  IF p_campuri IS NULL OR jsonb_typeof(p_campuri) <> 'object' OR p_dezacorduri IS NULL OR jsonb_typeof(p_dezacorduri) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_campuri) k WHERE NOT (k = ANY (c_chei))) THEN
    RAISE EXCEPTION 'propunere_invalida' USING ERRCODE = '22023';
  END IF;
  v_act := coalesce((p_campuri->>'este_act_aditional')::boolean, false);
  v_nr := public.fn_polite_text(p_campuri, 'contract_nr', 100);
  v_data := public.fn_polite_data(p_campuri, 'contract_data');
  v_pol := public.fn_polite_text(p_campuri, CASE WHEN v_act THEN 'polita_baza_nr' ELSE 'nr_polita' END, 100);
  -- contractul propus: numarul (partea dinainte de „/”) egal dupa normalizare, data de semnare compatibila; exact unul, altfel nimic
  IF public.fn_polite_norm_nr(split_part(v_nr, '/', 1)) <> '' THEN
    SELECT count(*), min(ct.id) INTO v_n, v_contract FROM public.contracte_terti ct
     WHERE public.fn_polite_norm_nr(split_part(ct.numar_contract, '/', 1)) = public.fn_polite_norm_nr(split_part(v_nr, '/', 1))
       AND (v_data IS NULL OR ct.data_semnare IS NULL OR ct.data_semnare = v_data);
    IF v_n <> 1 THEN v_contract := NULL; END IF;
  END IF;
  -- polita de baza (la act) sau polita deja inregistrata (la polita noua): nr. egal dupa normalizare, exact una
  IF public.fn_polite_norm_nr(v_pol) <> '' THEN
    SELECT count(*), min(cp.id) INTO v_n, v_baza FROM public.contracte_polite cp WHERE public.fn_polite_norm_nr(cp.nr_polita) = public.fn_polite_norm_nr(v_pol);
    IF v_n <> 1 THEN v_baza := NULL; END IF;
  END IF;
  UPDATE public.polite_propuneri p SET stare = 'propus', campuri = p_campuri, dezacorduri = p_dezacorduri, este_act = v_act,
         contract_propus_id = v_contract, polita_baza_propusa_id = v_baza, model = p_model, cost_usd = p_cost
   WHERE p.id = p_id AND p.stare = 'in_citire';
  IF NOT FOUND THEN RAISE EXCEPTION 'propunere_schimbata' USING ERRCODE = 'P0001'; END IF;
  RETURN public.fn_polite_propunere_json(p_id);
END $fn$;

CREATE FUNCTION public.fn_polite_propunere_esec(p_id bigint, p_cod text, p_cost numeric) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_cod IS NULL OR p_cod !~ '^[a-z0-9_]{1,60}$' THEN RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023'; END IF;
  -- fara cost (esec inaintea apelului platit): randul se sterge, documentul se poate citi din nou;
  -- cu cost sau cost necunoscut (p_cost NULL dupa pornirea apelului): ramane „eroare”, fara reluare automata (L05)
  IF p_cost = 0 THEN
    DELETE FROM public.polite_propuneri p WHERE p.id = p_id AND p.stare = 'in_citire';
  ELSE
    UPDATE public.polite_propuneri p SET stare = 'eroare', eroare = p_cod, cost_usd = p_cost WHERE p.id = p_id AND p.stare = 'in_citire';
  END IF;
END $fn$;

-- propunerea ca JSON pentru UI (cu contractul / polita propuse, citite aici)
CREATE FUNCTION public.fn_polite_propunere_json(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object('id', p.id, 'stare', p.stare, 'sursa', p.sursa, 'cititor', p.cititor, 'pdf_cale', p.pdf_cale, 'pdf_sha256', p.pdf_sha256,
           'este_act', p.este_act, 'campuri', p.campuri, 'dezacorduri', p.dezacorduri, 'eroare', p.eroare, 'creat_la', p.creat_la,
           'contract_propus', CASE WHEN ct.id IS NOT NULL THEN jsonb_build_object('id', ct.id, 'numar_contract', ct.numar_contract, 'denumire', ct.denumire, 'data_semnare', ct.data_semnare) END,
           'polita_baza_propusa', CASE WHEN cp.id IS NOT NULL THEN jsonb_build_object('id', cp.id, 'tip', cp.tip, 'nr_polita', cp.nr_polita, 'contract_id', cp.contract_id) END,
           'polita_id', (SELECT x.id FROM public.contracte_polite x WHERE x.propunere_id = p.id),
           'act_id', (SELECT y.id FROM public.contracte_polite_acte y WHERE y.propunere_id = p.id))
    FROM public.polite_propuneri p
    LEFT JOIN public.contracte_terti ct ON ct.id = p.contract_propus_id
    LEFT JOIN public.contracte_polite cp ON cp.id = p.polita_baza_propusa_id
   WHERE p.id = p_id
$fn$;

-- 8g. salvarea confirmata de om (UI): polita noua / act aditional / rand de Registru, cu sau fara propunere, intr-o singura tranzactie (L02).
--     Ordinea lock-urilor: propunerea -> polita de baza -> (garantii prin INSERT). Fara propunere: provenienta 'manual'.
CREATE FUNCTION public.fn_polita_salveaza(p_propunere_id bigint, p_date jsonb, p_registru jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_p public.polite_propuneri%ROWTYPE; v_tinta text; v_tip text; v_moneda text; v_status text; v_contract bigint; v_baza bigint;
  v_id bigint; v_gid bigint; v_nr_act integer; v_cale text; v_emit date; v_exp date;
BEGIN
  IF NOT public.fn_poate_scrie_polite() THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE = '42501'; END IF;
  IF p_date IS NULL OR jsonb_typeof(p_date) <> 'object' OR (p_registru IS NOT NULL AND jsonb_typeof(p_registru) <> 'object') THEN
    RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023';
  END IF;
  v_tinta := public.fn_polite_text(p_date, 'tinta', 20);
  IF v_tinta IS NULL OR v_tinta NOT IN ('polita', 'act', 'registru') THEN RAISE EXCEPTION 'tinta_invalida' USING ERRCODE = '22023'; END IF;
  IF (v_tinta = 'registru' OR p_registru IS NOT NULL) AND public.fn_poate_scrie_garantii() IS NOT TRUE THEN
    RAISE EXCEPTION 'fara_drept_registru' USING ERRCODE = '42501';
  END IF;
  IF v_tinta = 'act' AND p_registru IS NOT NULL THEN RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023'; END IF;
  -- propunerea: blocata intai, trebuie sa fie inca „propus”; marcajul de tranzactie autorizeaza provenienta (trigger)
  IF p_propunere_id IS NOT NULL THEN
    SELECT * INTO v_p FROM public.polite_propuneri p WHERE p.id = p_propunere_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'propunere_inexistenta' USING ERRCODE = '22023'; END IF;
    IF v_p.stare <> 'propus' THEN RAISE EXCEPTION 'propunere_deja_decisa' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.polite_propuneri p SET confirmare_txid = txid_current() WHERE p.id = p_propunere_id;
    v_cale := v_p.pdf_cale;
  END IF;
  v_emit := public.fn_polite_data(p_date, 'data_emitere');
  IF v_tinta = 'act' THEN
    v_baza := (p_date->>'polita_id')::bigint;
    PERFORM 1 FROM public.contracte_polite cp WHERE cp.id = v_baza FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'polita_inexistenta' USING ERRCODE = '22023'; END IF;
    v_nr_act := (p_date->>'nr_act')::integer;
    IF v_nr_act IS NULL OR v_nr_act < 1 OR v_nr_act > 999 THEN RAISE EXCEPTION 'nr_act_invalid' USING ERRCODE = '22023'; END IF;
    v_exp := public.fn_polite_data(p_date, 'data_expirare_noua');
    INSERT INTO public.contracte_polite_acte (polita_id, nr_act, descriere, valoare_noua_lei, data_emitere, data_expirare_noua,
                                              executie_de_la, executie_pana_la, garantie_de_la, garantie_pana_la, pdf_path, propunere_id)
    VALUES (v_baza, v_nr_act, public.fn_polite_text(p_date, 'descriere', 300), public.fn_polite_suma(p_date, 'valoare'), v_emit, v_exp,
            public.fn_polite_data(p_date, 'executie_de_la'), public.fn_polite_data(p_date, 'executie_pana_la'),
            public.fn_polite_data(p_date, 'garantie_de_la'), public.fn_polite_data(p_date, 'garantie_pana_la'), v_cale, p_propunere_id)
    RETURNING id INTO v_id;
  ELSE
    v_tip := public.fn_polite_text(p_date, 'tip', 10);
    IF v_tip IS NULL OR v_tip NOT IN ('GBE', 'CAR', 'GPL', 'avans', 'altul') THEN RAISE EXCEPTION 'tip_invalid' USING ERRCODE = '22023'; END IF;
    v_moneda := coalesce(public.fn_polite_text(p_date, 'moneda', 3), 'RON');
    IF v_moneda NOT IN ('RON', 'EUR') THEN RAISE EXCEPTION 'moneda_invalida' USING ERRCODE = '22023'; END IF;
    v_exp := public.fn_polite_data(p_date, 'data_expirare');
    IF v_emit IS NOT NULL AND v_exp IS NOT NULL AND v_exp < v_emit THEN RAISE EXCEPTION 'expirare_inainte_de_emitere' USING ERRCODE = '22023'; END IF;
    IF v_tinta = 'polita' THEN
      v_contract := (p_date->>'contract_id')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.contracte_terti ct WHERE ct.id = v_contract) THEN RAISE EXCEPTION 'contract_inexistent' USING ERRCODE = '22023'; END IF;
      v_status := coalesce(public.fn_polite_text(p_date, 'status', 20), 'activa');
      INSERT INTO public.contracte_polite (contract_id, tip, asigurator, nr_polita, valoare_lei, moneda, data_emitere, data_expirare,
                                           executie_de_la, executie_pana_la, garantie_de_la, garantie_pana_la, status, observatii, pdf_path, propunere_id)
      VALUES (v_contract, v_tip, public.fn_polite_text(p_date, 'asigurator', 200), public.fn_polite_text(p_date, 'nr_polita', 100),
              public.fn_polite_suma(p_date, 'valoare'), v_moneda, v_emit, v_exp,
              public.fn_polite_data(p_date, 'executie_de_la'), public.fn_polite_data(p_date, 'executie_pana_la'),
              public.fn_polite_data(p_date, 'garantie_de_la'), public.fn_polite_data(p_date, 'garantie_pana_la'),
              v_status, public.fn_polite_text(p_date, 'observatii', 2000), v_cale, p_propunere_id)
      RETURNING id INTO v_id;
    END IF;
    -- Registrul: legat de polita noua (campurile documentului le copiaza triggerul) sau, fara contract, rand propriu (ca azi)
    IF p_registru IS NOT NULL OR v_tinta = 'registru' THEN
      -- aceleasi campuri obligatorii ca formularul „Polita existenta” (beneficiar, asigurator, nr., valoare); tipul „altul” nu are corespondent
      IF public.fn_polite_text(coalesce(p_registru, '{}'::jsonb), 'beneficiar', 300) IS NULL THEN RAISE EXCEPTION 'beneficiar_lipsa' USING ERRCODE = '22023'; END IF;
      IF public.fn_polite_text(p_date, 'asigurator', 200) IS NULL OR public.fn_polite_text(p_date, 'nr_polita', 100) IS NULL
         OR public.fn_polite_suma(p_date, 'valoare') IS NULL THEN
        RAISE EXCEPTION 'registru_incomplet' USING ERRCODE = '22023';
      END IF;
      IF v_tip = 'altul' THEN RAISE EXCEPTION 'tip_fara_registru' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.garantii (forma, tip, beneficiar, lucrare, contract_numar, contract_data, emitent, numar_document, valoare, moneda,
                                   data_emitere, data_expirare, stare, sursa_document, observatii, contract_polita_id)
      VALUES ('polita_asigurare',
              CASE v_tip WHEN 'GBE' THEN 'buna_executie' WHEN 'CAR' THEN 'car' WHEN 'GPL' THEN 'participare' ELSE 'avans' END,
              public.fn_polite_text(p_registru, 'beneficiar', 300), public.fn_polite_text(p_registru, 'lucrare', 300),
              public.fn_polite_text(p_registru, 'contract_numar', 100), public.fn_polite_data(p_registru, 'contract_data'),
              public.fn_polite_text(p_date, 'asigurator', 200), public.fn_polite_text(p_date, 'nr_polita', 100),
              public.fn_polite_suma(p_date, 'valoare'), v_moneda, v_emit, v_exp, 'activa', 'manual',
              public.fn_polite_text(p_date, 'observatii', 2000), v_id)
      RETURNING id INTO v_gid;
    END IF;
  END IF;
  IF p_propunere_id IS NOT NULL THEN
    UPDATE public.polite_propuneri p SET stare = 'confirmat', decis_de = auth.uid(), decis_la = now() WHERE p.id = p_propunere_id;
  END IF;
  RETURN jsonb_build_object('tinta', v_tinta, 'polita_id', CASE WHEN v_tinta = 'polita' THEN v_id END, 'act_id', CASE WHEN v_tinta = 'act' THEN v_id END,
                            'garantie_id', v_gid);
END $fn$;

CREATE FUNCTION public.fn_polita_propunere_respinge(p_id bigint, p_motiv text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_poate_scrie_polite() THEN RAISE EXCEPTION 'fara_drept' USING ERRCODE = '42501'; END IF;
  IF p_motiv IS NOT NULL AND length(p_motiv) > 500 THEN RAISE EXCEPTION 'argument_invalid' USING ERRCODE = '22023'; END IF;
  UPDATE public.polite_propuneri p SET stare = 'respins', decis_de = auth.uid(), decis_la = now(), motiv_respingere = nullif(btrim(p_motiv), '')
   WHERE p.id = p_id AND p.stare = 'propus';
  RETURN FOUND;
END $fn$;

-- ─── 9. ACL + RLS ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- privilegiile implicite Supabase dau ALL pe tabele / EXECUTE pe functii noi: se scot explicit, apoi exact cine trebuie
REVOKE ALL ON public.polite_propuneri, public.polite_alerte_destinatari, public.polite_alerte_config, public.polite_alerte_jurnal, public.v_polite_scadente
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.polite_propuneri_id_seq, public.polite_alerte_destinatari_id_seq, public.polite_alerte_jurnal_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.polite_propuneri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polite_alerte_destinatari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polite_alerte_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polite_alerte_jurnal ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.polite_propuneri TO authenticated, service_role;
CREATE POLICY polite_propuneri_sel ON public.polite_propuneri FOR SELECT TO authenticated USING ((SELECT public.fn_poate_scrie_polite()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polite_alerte_destinatari TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.polite_alerte_destinatari_id_seq TO authenticated;
CREATE POLICY polite_dest_sel ON public.polite_alerte_destinatari FOR SELECT TO authenticated USING ((SELECT public.fn_polite_e_owner()));
CREATE POLICY polite_dest_ins ON public.polite_alerte_destinatari FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_polite_e_owner()));
CREATE POLICY polite_dest_upd ON public.polite_alerte_destinatari FOR UPDATE TO authenticated USING ((SELECT public.fn_polite_e_owner())) WITH CHECK ((SELECT public.fn_polite_e_owner()));
CREATE POLICY polite_dest_del ON public.polite_alerte_destinatari FOR DELETE TO authenticated USING ((SELECT public.fn_polite_e_owner()));
GRANT SELECT ON public.polite_alerte_config, public.polite_alerte_jurnal TO authenticated;
CREATE POLICY polite_config_sel ON public.polite_alerte_config FOR SELECT TO authenticated USING ((SELECT public.fn_polite_e_owner()));
CREATE POLICY polite_jurnal_sel ON public.polite_alerte_jurnal FOR SELECT TO authenticated USING ((SELECT public.fn_polite_e_owner()));
GRANT SELECT ON public.v_polite_scadente TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_polite_norm_nr(text), public.fn_polite_text(jsonb, text, integer), public.fn_polite_data(jsonb, text),
  public.fn_polite_suma(jsonb, text), public.fn_poate_scrie_polite(), public.fn_polite_e_owner(), public.fn_polite_provenienta(),
  public.fn_polite_garantii_din_polita(), public.fn_polite_reimprospateaza_garantii(), public.fn_polite_scadente(date),
  public.fn_polite_dest_normalizeaza(), public.fn_polite_alerte_calculeaza(date), public.fn_polite_alerte_proba(date),
  public.fn_polite_alerte_porneste(boolean), public.fn_polite_alerte_rezerva(date), public.fn_polite_alerte_marcheaza(bigint[], text, text, text),
  public.fn_polite_propunere_rezerva(text, uuid), public.fn_polite_propunere_completeaza(bigint, jsonb, jsonb, text, numeric),
  public.fn_polite_propunere_esec(bigint, text, numeric), public.fn_polite_propunere_json(bigint), public.fn_polita_salveaza(bigint, jsonb, jsonb),
  public.fn_polita_propunere_respinge(bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_polite(), public.fn_polite_e_owner(), public.fn_polite_scadente(date), public.fn_polite_alerte_proba(date),
  public.fn_polite_alerte_porneste(boolean), public.fn_polita_salveaza(bigint, jsonb, jsonb), public.fn_polita_propunere_respinge(bigint, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_poate_scrie_polite(), public.fn_polite_scadente(date), public.fn_polite_alerte_rezerva(date),
  public.fn_polite_alerte_marcheaza(bigint[], text, text, text), public.fn_polite_propunere_rezerva(text, uuid),
  public.fn_polite_propunere_completeaza(bigint, jsonb, jsonb, text, numeric), public.fn_polite_propunere_esec(bigint, text, numeric),
  public.fn_polite_propunere_json(bigint)
  TO service_role;

-- ─── 10. Valorile initiale ale listei (destinatarii confirmati de Razvan 09.11.2026) ─────────────────────────────────────────
-- Adresele fixe se iau din BD: intai employees (adresa @gazpet.ro activa egala cu cea asteptata), apoi employees dupa nume (exact
-- unul, @gazpet.ro), apoi conturile ERP (profiles); negasita => rand FARA adresa + observatie (owner-ul o completeaza din Administrator).
DO $seed$
DECLARE r record; v_em text; v_n integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('financiar', 'Marilena Tudorache', 'marilena.tudorache@gazpet.ro', 'TUDORACHE MARILENA'),
      ('financiar', 'Mirela Popescu', 'mirela.popescu@gazpet.ro', 'POPESCU MIRELA'),
      ('ofertare', 'Cristina Dumitrescu', 'cristina.dumitrescu@gazpet.ro', 'DUMITRESCU CRISTINA')
    ) v(dep, nume, asteptat, nume_hr) LOOP
    v_em := NULL;
    SELECT min(lower(btrim(e.email))) INTO v_em FROM public.employees e WHERE e.active IS TRUE AND lower(btrim(e.email)) = r.asteptat;
    IF v_em IS NULL THEN
      SELECT count(*), min(lower(btrim(e.email))) INTO v_n, v_em FROM public.employees e
       WHERE e.active IS TRUE AND (upper(btrim(e.name)) = r.nume_hr OR upper(btrim(e.name)) LIKE r.nume_hr || ' %')
         AND lower(btrim(e.email)) ~ '^[a-z0-9._%+-]+@gazpet[.]ro$';
      IF v_n <> 1 THEN v_em := NULL; END IF;
    END IF;
    IF v_em IS NULL THEN
      SELECT min(lower(p.email)) INTO v_em FROM public.profiles p WHERE lower(p.email) = r.asteptat;
    END IF;
    INSERT INTO public.polite_alerte_destinatari (departament, fel, nume, email, observatii)
    VALUES (r.dep, 'adresa', r.nume, v_em, CASE WHEN v_em IS NULL THEN 'Adresa negăsită în fișa de angajat / contul ERP la instalare: de completat.' END);
    IF v_em IS NULL THEN RAISE NOTICE '20261205a: adresa pentru % (%) negasita — rand fara adresa', r.nume, r.dep; END IF;
  END LOOP;
  INSERT INTO public.polite_alerte_destinatari (departament, fel, nume) VALUES
    ('executie', 'sef_santier', 'Șeful de șantier al proiectului'),
    ('executie', 'manager_proiect', 'Managerul de proiect');
END $seed$;

-- ─── 11. Cronul zilnic (05:15 UTC = 07:15 ora Romaniei iarna / 08:15 vara); comanda pe un rand ────────────────────────────────
SELECT cron.schedule('polite_alerte_zilnic', '15 5 * * *', $cmd$SELECT net.http_post(url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/polite-alerte-mail', body := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')), timeout_milliseconds := 60000)$cmd$);

-- ─── 12. Postconditii + amprenta ────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_o oid; v_amprenta text;
  v_auth regprocedure[] := ARRAY['public.fn_poate_scrie_polite()', 'public.fn_polite_e_owner()', 'public.fn_polite_scadente(date)',
    'public.fn_polite_alerte_proba(date)', 'public.fn_polite_alerte_porneste(boolean)', 'public.fn_polita_salveaza(bigint,jsonb,jsonb)',
    'public.fn_polita_propunere_respinge(bigint,text)']::regprocedure[];
  v_srv regprocedure[] := ARRAY['public.fn_poate_scrie_polite()', 'public.fn_polite_scadente(date)', 'public.fn_polite_alerte_rezerva(date)',
    'public.fn_polite_alerte_marcheaza(bigint[],text,text,text)', 'public.fn_polite_propunere_rezerva(text,uuid)',
    'public.fn_polite_propunere_completeaza(bigint,jsonb,jsonb,text,numeric)', 'public.fn_polite_propunere_esec(bigint,text,numeric)',
    'public.fn_polite_propunere_json(bigint)']::regprocedure[];
BEGIN
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!')) <> 21
     OR to_regprocedure('public.fn_poate_scrie_polite()') IS NULL THEN
    RAISE EXCEPTION '20261205a: functiile noi nu sunt exact 21 + fn_poate_scrie_polite';
  END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!' OR p.proname = 'fn_poate_scrie_polite') LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_o AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(p.proowner) = 'postgres')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0)
       OR (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_o)
       OR has_function_privilege('anon', v_o, 'EXECUTE')
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o = ANY (v_auth::oid[]))
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o = ANY (v_srv::oid[])) THEN
      RAISE EXCEPTION '20261205a: functia % are setari / drepturi gresite', v_o::regprocedure;
    END IF;
  END LOOP;
  -- echivalentul local al portii permanente 0e pe functiile expuse lui authenticated
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = ANY (v_auth::oid[])
               AND lower(p.prosrc || ' ' || pg_get_function_arguments(p.oid)) ~ '(set_config|request[[:space:]]*[.][[:space:]]*jwt|[[:<:]]execute[[:>:]]|session[_[:space:]]+authorization|[[:<:]]role[[:>:]]|[[:<:]]u&)') THEN
    RAISE EXCEPTION '20261205a: o functie expusa contine o constructie interzisa de poarta 0e';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.polite_propuneri'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.polite_alerte_destinatari'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.polite_alerte_config'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.polite_alerte_jurnal'::regclass)
     OR (SELECT string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' ORDER BY tablename, policyname)
           FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('polite_propuneri', 'polite_alerte_destinatari', 'polite_alerte_config', 'polite_alerte_jurnal'))
        IS DISTINCT FROM 'polite_alerte_config.polite_config_sel:SELECT:authenticated polite_alerte_destinatari.polite_dest_del:DELETE:authenticated polite_alerte_destinatari.polite_dest_ins:INSERT:authenticated polite_alerte_destinatari.polite_dest_sel:SELECT:authenticated polite_alerte_destinatari.polite_dest_upd:UPDATE:authenticated polite_alerte_jurnal.polite_jurnal_sel:SELECT:authenticated polite_propuneri.polite_propuneri_sel:SELECT:authenticated' THEN
    RAISE EXCEPTION '20261205a: RLS / politicile tabelelor noi nu sunt exact cele asteptate';
  END IF;
  IF has_table_privilege('anon', 'public.polite_propuneri', 'SELECT') OR has_table_privilege('anon', 'public.polite_alerte_destinatari', 'SELECT')
     OR has_table_privilege('anon', 'public.polite_alerte_jurnal', 'SELECT') OR has_table_privilege('anon', 'public.polite_alerte_config', 'SELECT')
     OR has_table_privilege('anon', 'public.v_polite_scadente', 'SELECT')
     OR has_table_privilege('authenticated', 'public.polite_propuneri', 'INSERT') OR has_table_privilege('authenticated', 'public.polite_propuneri', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.polite_propuneri', 'DELETE')
     OR has_table_privilege('authenticated', 'public.polite_alerte_jurnal', 'INSERT') OR has_table_privilege('authenticated', 'public.polite_alerte_jurnal', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.polite_alerte_jurnal', 'DELETE')
     OR has_table_privilege('authenticated', 'public.polite_alerte_config', 'UPDATE') OR has_table_privilege('authenticated', 'public.polite_alerte_config', 'INSERT')
     OR has_table_privilege('service_role', 'public.polite_alerte_jurnal', 'SELECT') OR has_table_privilege('service_role', 'public.polite_propuneri', 'INSERT')
     OR has_table_privilege('service_role', 'public.polite_propuneri', 'UPDATE') OR has_table_privilege('service_role', 'public.polite_alerte_destinatari', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.garantii', 'contract_polita_id', 'SELECT')
     OR (SELECT reloptions FROM pg_class WHERE oid = 'public.v_polite_scadente'::regclass) IS DISTINCT FROM ARRAY['security_invoker=on']::text[] THEN
    RAISE EXCEPTION '20261205a: drepturile pe tabelele noi / vedere nu sunt exact cele asteptate';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname LIKE 'trg!_polite!_%' ESCAPE '!' AND NOT t.tgisinternal) <> 6 THEN
    RAISE EXCEPTION '20261205a: triggerele trg_polite_* nu sunt exact 6';
  END IF;
  IF (SELECT activ FROM public.polite_alerte_config WHERE id) IS NOT FALSE OR (SELECT count(*) FROM public.polite_alerte_destinatari) <> 5
     OR EXISTS (SELECT 1 FROM public.polite_alerte_jurnal) OR EXISTS (SELECT 1 FROM public.polite_propuneri) THEN
    RAISE EXCEPTION '20261205a: starea initiala nu e cea asteptata (comutator oprit, 5 destinatari, jurnal si propuneri goale)';
  END IF;
  IF current_setting('cron.timezone', true) IS DISTINCT FROM 'GMT' OR (SELECT count(*) FROM cron.job WHERE jobname = 'polite_alerte_zilnic') <> 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'polite_alerte_zilnic' AND schedule = '15 5 * * *' AND active AND username = 'postgres') THEN
    RAISE EXCEPTION '20261205a: jobul polite_alerte_zilnic nu e exact (GMT, program, activ, postgres)';
  END IF;
  -- AMPRENTA 20261205a (aceeasi interogare in revenire): structura obiectelor noi, fara date
  SELECT md5(concat_ws(E'\n',
    (SELECT string_agg(format('%s.%s:%s:%s:%s', a.attrelid::regclass, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-')), ';' ORDER BY a.attrelid::regclass::text, a.attnum)
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
    (SELECT string_agg(format('%s:%s:%s:%s:%s', r.relname, r.relkind, pg_get_userbyid(r.relowner), r.relrowsecurity, r.relforcerowsecurity), ';' ORDER BY r.relname)
       FROM pg_class r WHERE r.oid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass,
                                       'public.polite_alerte_jurnal'::regclass, 'public.v_polite_scadente'::regclass)),
    (SELECT string_agg(format('%s.%s:%s:%s', p.polrelid::regclass, p.polname, p.polcmd, coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')), ';' ORDER BY p.polrelid::regclass::text, p.polname)
       FROM pg_policy p WHERE p.polrelid IN ('public.polite_propuneri'::regclass, 'public.polite_alerte_destinatari'::regclass, 'public.polite_alerte_config'::regclass, 'public.polite_alerte_jurnal'::regclass)),
    (SELECT string_agg(format('%s.%s:%s:%s:%s', t.tgrelid::regclass, t.tgname, t.tgtype, t.tgfoid::regprocedure, t.tgenabled), ';' ORDER BY t.tgrelid::regclass::text, t.tgname)
       FROM pg_trigger t WHERE t.tgname LIKE 'trg!_polite!_%' ESCAPE '!' AND NOT t.tgisinternal),
    md5(replace(pg_get_viewdef('public.v_polite_scadente'::regclass), chr(13), '')),
    (SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', p.oid::regprocedure, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '-'),
                              pg_get_userbyid(p.proowner), coalesce((SELECT string_agg(x::text, ' ' ORDER BY x::text) FROM unnest(p.proacl) x), '-'),
                              md5(replace(p.prosrc, chr(13), ''))), ';' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND (p.proname LIKE 'fn!_polite!_%' ESCAPE '!' OR p.proname LIKE 'fn!_polita!_%' ESCAPE '!' OR p.proname = 'fn_poate_scrie_polite')),
    (SELECT string_agg(format('%s:%s:%s:%s:%s', j.jobname, j.schedule, md5(replace(j.command, chr(13), '')), j.active, j.username), ';' ORDER BY j.jobid)
       FROM cron.job j WHERE j.jobname = 'polite_alerte_zilnic'))) INTO v_amprenta;
  EXECUTE format('COMMENT ON TABLE public.polite_alerte_config IS %L', 'Polite 20261205a: comutatorul alertelor (activ = mail + notificari; OPRIT la livrare, il porneste doar owner-ul prin fn_polite_alerte_porneste, dupa o proba). amprenta=' || v_amprenta);
  RAISE NOTICE '20261205a amprenta %', v_amprenta;
END $post$;

DO $final$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261205a_polite_alerte:' || txid_current() THEN
    RAISE EXCEPTION '20261205a: garda final invalida — se anuleaza tot';
  END IF;
END $final$;
