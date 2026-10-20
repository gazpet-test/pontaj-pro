-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261102a — Izometrie E2a: registrul de țeavă Transgaz (LOT 2) — rol scriitor, gardă, registru doar-adaug,
--             extinderea magazie_bucati, config/atribuiri, importul soldului inițial (funcție, fără date)
-- Spec: docs/izometrie/E2_PLAN.md (plan r3, GO Copilot + Gemini) + design IZOMETRIE_DESIGN_v2.md v2.3 §1.2–§1.3, §5.4.
--
-- Ce face:
--   A. rolul izo_registru_writer (NOLOGIN NOINHERIT, fără BYPASSRLS). Doar postgres e membru (WITH SET, fără INHERIT),
--      necesar la ALTER FUNCTION … OWNER TO. Writer-ul nu deține tabele/secvențe/schema; CREATE pe public îl primește
--      doar pe durata ALTER OWNER și îl pierde în aceeași tranzacție.
--   B. tabele noi: izo_proiect_config (nivel off/stoc/montaj), izo_atribuiri, izo_importuri (idempotența importului),
--      magazie_bucati_evenimente + magazie_bucati_miscari (registrul, DOAR adaug: UPDATE/DELETE/TRUNCATE refuzate),
--      secvența globală izo_server_ver_seq. ACL explicit (default privileges de pe live dau arwdxt/rwU).
--   C. magazie_bucati: coloane noi (tip_cod, uid, arbore, serie_canon, lungimi în mm, perete, depozit, tronson, …),
--      CHECK-urile stare/locatie_tip extinse DOAR pentru beneficiar, indexuri UNIQUE strict parțiale pe beneficiar
--      (rădăcina pe serie_canon, frunzele pe serie+șarjă+lungime la cm, curbele pe serie+șarjă+unghi+cod).
--   D. garda: trigger INVOKER pe magazie_bucati și pe tabelele izo cu fapte — pe beneficiar cu proiect la nivel ≠ off
--      cere current_user = izo_registru_writer ȘI marcajul izo.registru_tx = txid_current(); politici RESTRICTIVE
--      pentru anon/authenticated; politici PERMISSIVE TO izo_registru_writer (fără BYPASSRLS).
--   E. căile vechi închise la nivelul stoc: DELETE pe executie_tevi (calea 3), bucată beneficiar pe bon (calea 9).
--      Calea 13 (din_stoc pe transport): Q-E2-1 = C, fără trigger (nu atinge magazie_bucati).
--   F. funcțiile registrului (owner izo_registru_writer, EXECUTE doar postgres): fn_izo_seteaza_nivel,
--      fn_izo_import_sold_initial, fn_izo_import_storno. Ajutătoare (owner postgres): fn_izo_nivel, fn_izo_acces,
--      fn_izo_citire, fn_izo_proiecte_protejate, gărzile.
-- Ce NU face: nicio dată (soldul inițial și activarea nivelului se aplică separat, de sesiunea de chat, după „da”-ul lui
--   Răzvan — CLAUDE.md pct. 3), niciun drept pentru oameni (Cioc Janeta: separat, cu „da”), nicio atingere pe LOT 1
--   (nivel off ⇒ neschimbat). Toate proiectele rămân off după migrare.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261102a_izometrie_e2a_registru_ROLLBACK.sql. Harness: scripts/test_izometrie_e2a.sh.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $migrare$
DECLARE
  v_amprenta text;
  v_n int;
BEGIN
  -- ── garda de livrare (start) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102a_izometrie_e2a_registru:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);

  -- ── precondiții ───────────────────────────────────────────────────────────────────────────────────────
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izo_registru_writer')
     OR to_regclass('public.izo_proiect_config') IS NOT NULL OR to_regclass('public.izo_atribuiri') IS NOT NULL
     OR to_regclass('public.izo_importuri') IS NOT NULL OR to_regclass('public.magazie_bucati_evenimente') IS NOT NULL
     OR to_regclass('public.magazie_bucati_miscari') IS NOT NULL OR to_regclass('public.izo_server_ver_seq') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'magazie_bucati' AND column_name = 'tip_cod') THEN
    RAISE EXCEPTION 'Precondiție 0b: obiectele izo există deja (rol, tabele, funcții fn_izo_* sau coloana magazie_bucati.tip_cod)';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.magazie_bucati'::regclass AND conname = 'magazie_bucati_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''sosit''::text, ''receptionat''::text, ''rezervata''::text, ''montata''::text, ''consumata''::text, ''retur''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.magazie_bucati'::regclass AND conname = 'magazie_bucati_locatie_tip_check')
       IS DISTINCT FROM 'CHECK ((locatie_tip = ANY (ARRAY[''sediu''::text, ''proiect''::text])))' THEN
    RAISE EXCEPTION 'Precondiție 0c: CHECK-urile stare/locatie_tip de pe magazie_bucati diferă de forma live (20.10.2026)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_tronsoane' AND column_name = 'id' AND data_type = 'bigint')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_tronsoane' AND column_name = 'proiect_id' AND data_type = 'bigint')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'logistica_depozite' AND column_name = 'id' AND data_type = 'integer')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'logistica_depozite' AND column_name = 'site_id' AND data_type = 'integer')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_proiecte' AND column_name = 'site_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_pachete_lansare' AND column_name = 'proiect_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_tevi' AND column_name = 'pachet_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'executie_bonuri_consum_linii' AND column_name = 'magazie_bucata_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'magazie_tipuri_material' AND column_name = 'cheie')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access' AND column_name = 'access_level')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean') THEN
    RAISE EXCEPTION 'Precondiție 0d: lipsește o coloană de care depinde E2a (tronsoane/depozite/proiecte/pachete/țevi/bonuri/tipuri/acces/profiles)';
  END IF;
  IF has_schema_privilege('authenticated', 'public', 'CREATE') OR has_schema_privilege('anon', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Precondiție 0e: anon/authenticated au CREATE pe schema public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.magazie_tipuri_material WHERE cheie = 'teava')
     OR NOT EXISTS (SELECT 1 FROM public.magazie_tipuri_material WHERE cheie = 'curba') THEN
    RAISE EXCEPTION 'Precondiție 0f: magazie_tipuri_material n-are cheile teava/curba';
  END IF;

  -- ── A. rolul scriitor ─────────────────────────────────────────────────────────────────────────────────
  CREATE ROLE izo_registru_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  -- PG16+: creatorul non-superuser primește automat ADMIN (fără SET/INHERIT); SET e necesar la ALTER FUNCTION … OWNER TO
  GRANT izo_registru_writer TO postgres WITH INHERIT FALSE, SET TRUE;
  GRANT USAGE ON SCHEMA public TO izo_registru_writer;

  CREATE SEQUENCE public.izo_server_ver_seq AS bigint;
  REVOKE ALL ON SEQUENCE public.izo_server_ver_seq FROM PUBLIC, anon, authenticated, service_role;
  GRANT USAGE ON SEQUENCE public.izo_server_ver_seq TO izo_registru_writer;

  -- ── B. tabele noi ─────────────────────────────────────────────────────────────────────────────────────
  CREATE TABLE public.izo_proiect_config (
    proiect_id        bigint PRIMARY KEY REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    nivel_izo         text NOT NULL DEFAULT 'off' CHECK (nivel_izo IN ('off','stoc','montaj')),
    toleranta_mm      integer NOT NULL DEFAULT 20 CHECK (toleranta_mm BETWEEN 0 AND 100),
    prag_rest_mm      integer NOT NULL DEFAULT 500 CHECK (prag_rest_mm BETWEEN 0 AND 13000),
    lungime_max_mm    integer NOT NULL DEFAULT 13000 CHECK (lungime_max_mm BETWEEN 1000 AND 30000),
    eticheta_rest_fisa  text NOT NULL DEFAULT 'DEPOZIT' CHECK (char_length(eticheta_rest_fisa) BETWEEN 1 AND 30),
    eticheta_deseu_fisa text NOT NULL DEFAULT 'DEPOZIT' CHECK (char_length(eticheta_deseu_fisa) BETWEEN 1 AND 30),
    format_sudura     text NOT NULL DEFAULT 'TR' CHECK (format_sudura IN ('TR','T')),
    conventie_sufixe  text[] NOT NULL DEFAULT '{}' CHECK (array_position(conventie_sufixe, NULL) IS NULL AND cardinality(conventie_sufixe) <= 50),
    conventie_sursa   text CHECK (conventie_sursa IS NULL OR char_length(conventie_sursa) <= 500),
    prag_km_gps_m     integer NOT NULL DEFAULT 50 CHECK (prag_km_gps_m BETWEEN 1 AND 1000),
    nivel_motiv       text CHECK (nivel_motiv IS NULL OR char_length(nivel_motiv) <= 500),
    nivel_schimbat_la timestamptz,
    nivel_schimbat_de text,
    server_ver        bigint NOT NULL
  );

  CREATE TABLE public.izo_atribuiri (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proiect_id   bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    profile_id   uuid NOT NULL,
    rol          text NOT NULL CHECK (rol IN ('inginer_izometrie','manager_aprobator','inlocuitor_aprobator','gestionar','rts_rte')),
    depozit_id   integer REFERENCES public.logistica_depozite(id) ON DELETE RESTRICT,
    valabil_de   date NOT NULL DEFAULT current_date,
    valabil_pana date,
    activ        boolean NOT NULL DEFAULT true,
    acordat_de   text NOT NULL CHECK (char_length(acordat_de) BETWEEN 1 AND 200),
    motiv        text NOT NULL CHECK (char_length(motiv) BETWEEN 3 AND 500),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK ((rol = 'gestionar') = (depozit_id IS NOT NULL)),
    CHECK (valabil_pana IS NULL OR valabil_pana >= valabil_de)
  );
  CREATE UNIQUE INDEX ux_izo_atribuiri_activ ON public.izo_atribuiri (proiect_id, profile_id, rol, coalesce(depozit_id, 0)) WHERE activ;

  CREATE TABLE public.magazie_bucati_evenimente (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tip         text NOT NULL CHECK (tip IN ('sold_initial','intrare_aviz','gasit','iesire_tranzit','livrare','retur_fizic',
                                             'confirmare_primire_depozit','mutare_tronson','taiere','montaj','demontaj','deseu',
                                             'pierdut','inventar_ajustare','corectie','corectie_radacina','storno')),
    proiect_id  bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    document_tip text CHECK (document_tip IS NULL OR char_length(document_tip) <= 50),
    document_id  text CHECK (document_id IS NULL OR char_length(document_id) <= 200),
    import_id    text CHECK (import_id IS NULL OR char_length(import_id) <= 80),
    storno_de_eveniment_id bigint UNIQUE REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    motiv        text CHECK (motiv IS NULL OR char_length(motiv) BETWEEN 3 AND 1000),
    declarat_de  uuid,
    aplicat_de   uuid,
    aplicat_rol  text NOT NULL DEFAULT session_user,
    ora_server   timestamptz NOT NULL DEFAULT now(),
    ora_tableta  timestamptz,
    dispozitiv_id text CHECK (dispozitiv_id IS NULL OR char_length(dispozitiv_id) <= 100),
    server_ver   bigint NOT NULL,
    CHECK ((tip = 'storno') = (storno_de_eveniment_id IS NOT NULL)),
    CHECK (tip NOT IN ('storno','corectie','corectie_radacina','deseu','pierdut','gasit','inventar_ajustare') OR motiv IS NOT NULL)
  );
  CREATE INDEX ix_magbuc_ev_proiect ON public.magazie_bucati_evenimente (proiect_id, id);

  CREATE TABLE public.magazie_bucati_miscari (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    eveniment_id bigint NOT NULL REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    proiect_id   bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    bucata_id    bigint NOT NULL REFERENCES public.magazie_bucati(id) ON DELETE RESTRICT,
    rol          text NOT NULL CHECK (rol IN ('nascut','consumat','mutat','montat','demontat','stare','corectat','anulat')),
    stare_inainte text,
    stare_dupa    text,
    din_loc      jsonb,
    in_loc       jsonb,
    lungime_mm   integer,
    inainte      jsonb,
    dupa         jsonb,
    server_ver   bigint NOT NULL
  );
  CREATE INDEX ix_magbuc_mis_bucata ON public.magazie_bucati_miscari (bucata_id, eveniment_id);
  CREATE INDEX ix_magbuc_mis_eveniment ON public.magazie_bucati_miscari (eveniment_id);

  CREATE TABLE public.izo_importuri (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proiect_id     bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
    import_id      text NOT NULL CHECK (import_id ~ '^[A-Za-z0-9_.:-]{3,80}$'),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    surse          jsonb NOT NULL CHECK (jsonb_typeof(surse) = 'array' AND jsonb_array_length(surse) BETWEEN 1 AND 20),
    eveniment_id   bigint REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    stornat_eveniment_id bigint REFERENCES public.magazie_bucati_evenimente(id) ON DELETE RESTRICT,
    rezultat       jsonb,
    stare          text NOT NULL DEFAULT 'aplicat' CHECK (stare IN ('aplicat','stornat')),
    creat_rol      text NOT NULL DEFAULT session_user,
    creat_la       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (proiect_id, import_id),
    CHECK ((stare = 'stornat') = (stornat_eveniment_id IS NOT NULL))
  );

  -- ── C. magazie_bucati: coloane noi + CHECK-uri doar pentru beneficiar ─────────────────────────────────
  ALTER TABLE public.magazie_bucati
    ADD COLUMN tip_cod text,
    ADD COLUMN uid uuid,
    ADD COLUMN parinte_id bigint REFERENCES public.magazie_bucati(id) ON DELETE RESTRICT,
    ADD COLUMN radacina_id bigint REFERENCES public.magazie_bucati(id) ON DELETE RESTRICT,
    ADD COLUMN cod_bucata text,
    ADD COLUMN capat_stanga text,
    ADD COLUMN capat_dreapta text,
    ADD COLUMN serie_canon text GENERATED ALWAYS AS (CASE WHEN serie IS NULL THEN NULL ELSE upper(regexp_replace(serie, '[[:space:]._/-]', '', 'g')) END) STORED,
    ADD COLUMN dezambiguare text,
    ADD COLUMN lungime_aviz_mm integer,
    ADD COLUMN lungime_masurata_mm integer,
    ADD COLUMN lungime_mm integer,
    ADD COLUMN lungime_calculata boolean NOT NULL DEFAULT false,
    ADD COLUMN lungime_cm integer GENERATED ALWAYS AS (CASE WHEN lungime_mm IS NULL THEN NULL ELSE round(lungime_mm / 10.0)::integer END) STORED,
    ADD COLUMN perete_mm numeric(4,1),
    ADD COLUMN diametru_mm integer,
    ADD COLUMN lot text,
    ADD COLUMN aviz_intrare_id bigint,
    ADD COLUMN nr_crt_aviz integer,
    ADD COLUMN bend_no text,
    ADD COLUMN capat_marcaj text,
    ADD COLUMN depozit_id integer REFERENCES public.logistica_depozite(id) ON DELETE RESTRICT,
    ADD COLUMN tronson_id bigint REFERENCES public.executie_tronsoane(id) ON DELETE RESTRICT,
    ADD COLUMN server_ver bigint;
  ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_stare_check;
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_stare_check CHECK (
    stare = ANY (ARRAY['sosit','receptionat','rezervata','montata','consumata','retur'])
    OR (provenienta = 'beneficiar' AND stare = ANY (ARRAY['in_tranzit','pe_tronson','rest_nereutilizabil','taiata','deseu','pierduta','anulata'])));
  ALTER TABLE public.magazie_bucati DROP CONSTRAINT magazie_bucati_locatie_tip_check;
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_locatie_tip_check CHECK (
    locatie_tip = ANY (ARRAY['sediu','proiect'])
    OR (provenienta = 'beneficiar' AND locatie_tip = ANY (ARRAY['depozit','tronson'])));
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_tip_cod_check CHECK (tip_cod IS NULL OR tip_cod IN ('teava','curba','alt'));
  -- un rând al registrului (tip_cod setat) e complet: beneficiar, cu arbore, uid, server_ver, perete (țeavă/curbă) și lungime (țeavă)
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_registru_check CHECK (
    tip_cod IS NULL OR (provenienta = 'beneficiar' AND proiect_id IS NOT NULL AND radacina_id IS NOT NULL AND uid IS NOT NULL
                        AND server_ver IS NOT NULL AND cod_bucata IS NOT NULL
                        AND (tip_cod = 'alt' OR perete_mm IS NOT NULL)
                        AND (tip_cod <> 'teava' OR lungime_mm IS NOT NULL)));
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_radacina_check CHECK (
    radacina_id IS NULL OR ((parinte_id IS NULL) = (radacina_id = id)));
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_valori_check CHECK (
    (lungime_mm IS NULL OR lungime_mm BETWEEN 1 AND 30000)
    AND (lungime_aviz_mm IS NULL OR lungime_aviz_mm BETWEEN 1 AND 30000)
    AND (lungime_masurata_mm IS NULL OR lungime_masurata_mm BETWEEN 1 AND 30000)
    AND (perete_mm IS NULL OR perete_mm BETWEEN 3 AND 40)
    AND (diametru_mm IS NULL OR diametru_mm BETWEEN 10 AND 2000)
    AND (capat_marcaj IS NULL OR capat_marcaj IN ('A','B'))
    AND (cod_bucata IS NULL OR cod_bucata ~ '^[A-Z][0-9]?[A-Z][0-9]?$')
    AND (dezambiguare IS NULL OR char_length(dezambiguare) BETWEEN 1 AND 20)
    AND (bend_no IS NULL OR char_length(bend_no) BETWEEN 1 AND 40));
  ALTER TABLE public.magazie_bucati ADD CONSTRAINT magazie_bucati_izo_loc_check CHECK (
    (locatie_tip IS DISTINCT FROM 'depozit' OR depozit_id IS NOT NULL)
    AND (locatie_tip IS DISTINCT FROM 'tronson' OR tronson_id IS NOT NULL));

  -- indexuri strict parțiale pe beneficiar (rândurile gazpet nu intră în niciunul) [R8, R9]
  CREATE UNIQUE INDEX ux_magbuc_izo_radacina ON public.magazie_bucati (serie_canon, dezambiguare) NULLS NOT DISTINCT
    WHERE provenienta = 'beneficiar' AND tip_cod = 'teava' AND parinte_id IS NULL AND stare <> 'anulata';
  CREATE UNIQUE INDEX ux_magbuc_izo_frunza ON public.magazie_bucati (serie_canon, dezambiguare, sarja, lungime_cm) NULLS NOT DISTINCT
    WHERE provenienta = 'beneficiar' AND tip_cod = 'teava' AND stare NOT IN ('taiata','anulata');
  CREATE UNIQUE INDEX ux_magbuc_izo_curba ON public.magazie_bucati (serie_canon, sarja, unghi_curba, cod_bucata) NULLS NOT DISTINCT
    WHERE provenienta = 'beneficiar' AND tip_cod = 'curba' AND stare <> 'anulata';
  CREATE UNIQUE INDEX ux_magbuc_izo_cod ON public.magazie_bucati (radacina_id, cod_bucata)
    WHERE provenienta = 'beneficiar' AND tip_cod IS NOT NULL AND stare <> 'anulata';
  CREATE UNIQUE INDEX ux_magbuc_izo_uid ON public.magazie_bucati (uid) WHERE uid IS NOT NULL;
  CREATE INDEX ix_magbuc_izo_depozit ON public.magazie_bucati (depozit_id) WHERE depozit_id IS NOT NULL;
  CREATE INDEX ix_magbuc_izo_tronson ON public.magazie_bucati (tronson_id) WHERE tronson_id IS NOT NULL;
  CREATE INDEX ix_magbuc_izo_radacina ON public.magazie_bucati (radacina_id) WHERE radacina_id IS NOT NULL;

  -- ── D1. funcții ajutătoare (owner postgres) ───────────────────────────────────────────────────────────
  -- utilizatorul curent (din JWT) pentru funcțiile writer-ului, care n-au drept pe schema auth
  CREATE FUNCTION public.fn_izo_uid() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT auth.uid()
  $f$;

  -- nivelul izo al proiectului; lipsa rândului = off. DEFINER: rezultatul nu depinde de ce vede apelantul.
  CREATE FUNCTION public.fn_izo_nivel(p_proiect bigint) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT coalesce((SELECT c.nivel_izo FROM public.izo_proiect_config c WHERE c.proiect_id = p_proiect), 'off')
  $f$;

  -- dreptul unui utilizator pe un proiect: owner, sau cheia exactă de modul cu nivel minim + (opțional) atribuirea activă
  CREATE FUNCTION public.fn_izo_acces(p_proiect bigint, p_cheie text, p_nivel_minim text, p_rol text DEFAULT NULL) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT auth.uid() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner)
      OR (EXISTS (SELECT 1 FROM public.user_module_access u
                   WHERE u.profile_id = auth.uid() AND u.module = p_cheie
                     AND (CASE u.access_level WHEN 'admin' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END)
                         >= (CASE p_nivel_minim WHEN 'admin' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 99 END))
          AND (p_rol IS NULL OR EXISTS (SELECT 1 FROM public.izo_atribuiri a
                                         WHERE a.proiect_id = p_proiect AND a.profile_id = auth.uid() AND a.rol = p_rol AND a.activ
                                           AND current_date BETWEEN a.valabil_de AND coalesce(a.valabil_pana, current_date)))))
  $f$;

  -- citirea datelor izo ale unui proiect: owner, atribuire activă, sau acces la magazie/executie
  CREATE FUNCTION public.fn_izo_citire(p_proiect bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT auth.uid() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner)
      OR EXISTS (SELECT 1 FROM public.izo_atribuiri a WHERE a.proiect_id = p_proiect AND a.profile_id = auth.uid() AND a.activ)
      OR EXISTS (SELECT 1 FROM public.user_module_access u WHERE u.profile_id = auth.uid() AND u.module IN ('magazie','executie')))
  $f$;

  -- proiectele cu nivel ≠ off (pentru avertizările din UI: bonuri, transporturi); nu expune altceva
  CREATE FUNCTION public.fn_izo_proiecte_protejate() RETURNS TABLE (proiect_id bigint, site_id integer, nivel_izo text)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT c.proiect_id, p.site_id, c.nivel_izo FROM public.izo_proiect_config c JOIN public.executie_proiecte p ON p.id = c.proiect_id
     WHERE c.nivel_izo <> 'off'
  $f$;

  -- bucată beneficiar a unui proiect protejat? (pentru calea 9; citește ca postgres)
  CREATE FUNCTION public.fn_izo_bucata_protejata(p_bucata bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT EXISTS (SELECT 1 FROM public.magazie_bucati b WHERE b.id = p_bucata AND b.provenienta = 'beneficiar'
                    AND public.fn_izo_nivel(b.proiect_id) <> 'off')
  $f$;

  -- tip_cod din tip_material_id (copie controlată de server, R11) și validarea locului pe proiect — pentru writer
  CREATE FUNCTION public.fn_izo_tip_cod(p_tip_material integer) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT CASE t.cheie WHEN 'teava' THEN 'teava' WHEN 'curba' THEN 'curba' ELSE 'alt' END
      FROM public.magazie_tipuri_material t WHERE t.id = p_tip_material
  $f$;
  CREATE FUNCTION public.fn_izo_tip_material(p_cheie text) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT t.id FROM public.magazie_tipuri_material t WHERE t.cheie = p_cheie ORDER BY t.id LIMIT 1
  $f$;
  CREATE FUNCTION public.fn_izo_loc_valid(p_proiect bigint, p_depozit integer, p_tronson bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT (p_depozit IS NULL OR EXISTS (SELECT 1 FROM public.logistica_depozite d JOIN public.executie_proiecte p ON p.site_id = d.site_id
                                          WHERE d.id = p_depozit AND p.id = p_proiect AND d.activ))
       AND (p_tronson IS NULL OR EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = p_tronson AND t.proiect_id = p_proiect))
  $f$;
  CREATE FUNCTION public.fn_izo_site_proiect(p_proiect bigint) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT p.site_id FROM public.executie_proiecte p WHERE p.id = p_proiect
  $f$;
  CREATE FUNCTION public.fn_izo_proiect_pachet(p_pachet bigint) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
    SELECT coalesce(p.proiect_id, t.proiect_id) FROM public.executie_pachete_lansare p
      LEFT JOIN public.executie_tronsoane t ON t.id = p.tronson_id WHERE p.id = p_pachet
  $f$;

  -- ── D2. garda (INVOKER: verifică rolul curent și marcajul tranzacției) ───────────────────────────────
  CREATE FUNCTION public.fn_izo_garda_scriitor() RETURNS boolean
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $f$
    SELECT current_user = 'izo_registru_writer' AND current_setting('izo.registru_tx', true) = txid_current()::text
  $f$;

  CREATE FUNCTION public.fn_izo_garda_bucati() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_old boolean := TG_OP <> 'INSERT' AND OLD.provenienta = 'beneficiar' AND public.fn_izo_nivel(OLD.proiect_id) <> 'off';
    v_new boolean := TG_OP <> 'DELETE' AND NEW.provenienta = 'beneficiar' AND public.fn_izo_nivel(NEW.proiect_id) <> 'off';
  BEGIN
    IF v_old OR v_new THEN
      IF NOT public.fn_izo_garda_scriitor() THEN
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
    END IF;
    -- tip_cod e copie controlată de server: trebuie să bată cu tip_material_id
    IF TG_OP <> 'DELETE' AND NEW.tip_cod IS NOT NULL AND NEW.tip_cod IS DISTINCT FROM public.fn_izo_tip_cod(NEW.tip_material_id) THEN
      RAISE EXCEPTION 'izo: tip_cod % nu bate cu tip_material_id %', NEW.tip_cod, NEW.tip_material_id USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER trg_magbuc_izo_garda BEFORE INSERT OR UPDATE OR DELETE ON public.magazie_bucati
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_garda_bucati();

  CREATE FUNCTION public.fn_izo_garda_truncate_bucati() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) THEN
      RAISE EXCEPTION 'izo: TRUNCATE pe magazie_bucati e refuzat cât există bucăți ale registrului' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END $f$;
  CREATE TRIGGER trg_magbuc_izo_truncate BEFORE TRUNCATE ON public.magazie_bucati
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_garda_truncate_bucati();

  -- registrul și tabelele cu fapte: INSERT doar prin writer + marcaj; UPDATE doar pe izo_importuri / izo_proiect_config
  -- (prin writer); DELETE / TRUNCATE niciodată
  CREATE FUNCTION public.fn_izo_garda_fapte() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
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
    IF NOT public.fn_izo_garda_scriitor() THEN
      RAISE EXCEPTION 'izo: % se scrie doar prin funcțiile registrului', TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER trg_izo_ev_garda BEFORE INSERT OR UPDATE OR DELETE ON public.magazie_bucati_evenimente
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_ev_truncate BEFORE TRUNCATE ON public.magazie_bucati_evenimente
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_mis_garda BEFORE INSERT OR UPDATE OR DELETE ON public.magazie_bucati_miscari
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_mis_truncate BEFORE TRUNCATE ON public.magazie_bucati_miscari
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_imp_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_importuri
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_imp_truncate BEFORE TRUNCATE ON public.izo_importuri
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_cfg_garda BEFORE INSERT OR UPDATE OR DELETE ON public.izo_proiect_config
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_garda_fapte();
  CREATE TRIGGER trg_izo_cfg_truncate BEFORE TRUNCATE ON public.izo_proiect_config
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_izo_garda_fapte();

  -- ── E. căile vechi închise la nivelul stoc ────────────────────────────────────────────────────────────
  -- calea 3: DELETE din client pe executie_tevi a unui proiect cu nivel ≠ off (import REPLACE, ștergeri din editor)
  CREATE FUNCTION public.fn_izo_refuz_delete_tevi() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF public.fn_izo_nivel(public.fn_izo_proiect_pachet(OLD.pachet_id)) <> 'off' AND NOT public.fn_izo_garda_scriitor() THEN
      RAISE EXCEPTION 'izo: rândurile de pachet ale unui proiect cu registru (nivel ≠ off) nu se șterg din client' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END $f$;
  CREATE TRIGGER trg_executie_tevi_izo_delete BEFORE DELETE ON public.executie_tevi
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_refuz_delete_tevi();
  -- la ștergerea pachetului, cascada pe țevi rulează după ce pachetul a dispărut: garda se pune și pe pachet
  CREATE FUNCTION public.fn_izo_refuz_delete_pachet() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF public.fn_izo_nivel(public.fn_izo_proiect_pachet(OLD.id)) <> 'off' AND NOT public.fn_izo_garda_scriitor() THEN
      RAISE EXCEPTION 'izo: pachetele unui proiect cu registru (nivel ≠ off) nu se șterg din client' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END $f$;
  CREATE TRIGGER trg_pachete_izo_delete BEFORE DELETE ON public.executie_pachete_lansare
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_refuz_delete_pachet();
  -- calea 9: bucată beneficiar a unui proiect protejat pe un bon de consum
  CREATE FUNCTION public.fn_izo_refuz_bon_bucata() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $f$
  BEGIN
    IF NEW.magazie_bucata_id IS NOT NULL AND public.fn_izo_bucata_protejata(NEW.magazie_bucata_id) THEN
      RAISE EXCEPTION 'izo: bucata % e țeavă Transgaz din registru; nu intră pe bon de consum (montajul se declară din modulul de țeavă)', NEW.magazie_bucata_id
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER trg_bon_linii_izo_bucata BEFORE INSERT OR UPDATE OF magazie_bucata_id ON public.executie_bonuri_consum_linii
    FOR EACH ROW EXECUTE FUNCTION public.fn_izo_refuz_bon_bucata();

  -- ── F. funcțiile registrului (owner izo_registru_writer; prima instrucțiune pune marcajul) ────────────
  -- nivelul izo: off → stoc doar cu porțile instalate; stoc → off doar fără bucăți în registru; montaj = E4a (refuzat)
  CREATE FUNCTION public.fn_izo_seteaza_nivel(p_proiect bigint, p_nivel text, p_motiv text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_vechi text;
  BEGIN
    PERFORM set_config('izo.registru_tx', txid_current()::text, true);
    IF p_nivel NOT IN ('off','stoc','montaj') THEN RAISE EXCEPTION 'izo: nivel necunoscut %', p_nivel; END IF;
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'izo: motivul e obligatoriu'; END IF;
    IF p_nivel = 'montaj' THEN RAISE EXCEPTION 'izo: nivelul montaj cere porțile din E4a (neinstalate)'; END IF;
    -- proiectul inexistent îl refuză FK-ul izo_proiect_config → executie_proiecte (writer-ul n-are SELECT pe proiecte)
    SELECT nivel_izo INTO v_vechi FROM public.izo_proiect_config WHERE proiect_id = p_proiect FOR UPDATE;
    v_vechi := coalesce(v_vechi, 'off');
    IF v_vechi = p_nivel THEN RETURN v_vechi; END IF;
    IF p_nivel = 'off' AND EXISTS (SELECT 1 FROM public.magazie_bucati WHERE proiect_id = p_proiect AND tip_cod IS NOT NULL AND stare <> 'anulata') THEN
      RAISE EXCEPTION 'izo: proiectul % are bucăți în registru; nivelul nu coboară la off (fereastră fără gardă)', p_proiect;
    END IF;
    -- activarea pornește cu 0 bucăți beneficiar în afara registrului [R6]: altfel ar rămâne bucăți neurmărite sub gardă
    IF v_vechi = 'off' AND p_nivel = 'stoc' AND EXISTS (SELECT 1 FROM public.magazie_bucati
         WHERE proiect_id = p_proiect AND provenienta = 'beneficiar' AND tip_cod IS NULL) THEN
      RAISE EXCEPTION 'izo: proiectul % are bucăți beneficiar în afara registrului; activarea stoc cere 0 (se importă sau se mută întâi)', p_proiect;
    END IF;
    INSERT INTO public.izo_proiect_config (proiect_id, nivel_izo, nivel_motiv, nivel_schimbat_la, nivel_schimbat_de, server_ver)
    VALUES (p_proiect, p_nivel, btrim(p_motiv), now(), session_user, nextval('public.izo_server_ver_seq'))
    ON CONFLICT (proiect_id) DO UPDATE SET nivel_izo = EXCLUDED.nivel_izo, nivel_motiv = EXCLUDED.nivel_motiv,
      nivel_schimbat_la = EXCLUDED.nivel_schimbat_la, nivel_schimbat_de = EXCLUDED.nivel_schimbat_de, server_ver = EXCLUDED.server_ver;
    RETURN p_nivel;
  END $f$;

  -- importul soldului inițial: idempotent în BD pe (proiect, import_id) + sha256(payload); un eveniment sold_initial
  CREATE FUNCTION public.fn_izo_import_sold_initial(p_proiect bigint, p_import_id text, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE
    v_sha text; v_imp_id bigint; v_exist record; v_ev bigint; v_b jsonb; v_id bigint; v_tip text; v_tipmat integer;
    v_stare text; v_loctip text; v_dep integer; v_tr bigint; v_lmm integer; v_n int := 0; v_nt int := 0; v_nc int := 0;
    v_metri numeric := 0; v_site integer; v_serie text; v_canon text; v_sarja text; v_cm integer; v_unghi numeric;
    v_pe_dep jsonb := '{}'::jsonb; v_pe_tr int := 0; v_rez jsonb; v_izol text;
  BEGIN
    PERFORM set_config('izo.registru_tx', txid_current()::text, true);
    IF public.fn_izo_nivel(p_proiect) <> 'stoc' THEN
      RAISE EXCEPTION 'izo: importul cere proiectul % la nivelul stoc (activat înainte, în aceeași tranzacție)', p_proiect;
    END IF;
    IF p_import_id IS NULL OR p_import_id !~ '^[A-Za-z0-9_.:-]{3,80}$' THEN RAISE EXCEPTION 'izo: import_id invalid'; END IF;
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR jsonb_typeof(p_payload->'surse') <> 'array'
       OR jsonb_typeof(p_payload->'bucati') <> 'array' OR jsonb_array_length(p_payload->'bucati') = 0
       OR jsonb_array_length(p_payload->'surse') = 0 THEN
      RAISE EXCEPTION 'izo: payload invalid (cere obiect cu surse[] și bucati[] nevide)';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'surse') s
                WHERE coalesce(s->>'sha256', '') !~ '^[0-9a-f]{64}$' OR coalesce(s->>'fisier', '') = '') THEN
      RAISE EXCEPTION 'izo: fiecare sursă cere fisier + sha256 (R13)';
    END IF;
    v_sha := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

    -- idempotența în BD [R3]: același (proiect, import_id) + același hash → rezultatul anterior; alt hash → conflict
    INSERT INTO public.izo_importuri (proiect_id, import_id, payload_sha256, surse)
    VALUES (p_proiect, p_import_id, v_sha, p_payload->'surse')
    ON CONFLICT (proiect_id, import_id) DO NOTHING
    RETURNING id INTO v_imp_id;
    IF v_imp_id IS NULL THEN
      SELECT * INTO v_exist FROM public.izo_importuri WHERE proiect_id = p_proiect AND import_id = p_import_id;
      IF v_exist.payload_sha256 = v_sha THEN
        RETURN coalesce(v_exist.rezultat, '{}'::jsonb) || jsonb_build_object('duplicat', true, 'stare', v_exist.stare);
      END IF;
      RAISE EXCEPTION 'izo: conflict — import_id % există deja cu alt conținut (sha256 %, primit %)', p_import_id, v_exist.payload_sha256, v_sha
        USING ERRCODE = '23505';
    END IF;

    v_site := public.fn_izo_site_proiect(p_proiect);
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, import_id, motiv, aplicat_de, server_ver)
    VALUES ('sold_initial', p_proiect, 'import', p_import_id, p_import_id, coalesce(p_payload->>'motiv', 'Sold inițial din Exceluri'),
            public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;

    FOR v_b IN SELECT * FROM jsonb_array_elements(p_payload->'bucati') LOOP
      v_n := v_n + 1;
      v_tip := v_b->>'tip';
      IF v_tip NOT IN ('teava','curba') THEN RAISE EXCEPTION 'izo: rândul %: tip % (cere teava/curba)', v_n, v_tip; END IF;
      IF jsonb_typeof(v_b->'sursa') <> 'object' OR coalesce(v_b->'sursa'->>'fisier','') = '' OR coalesce(v_b->'sursa'->>'foaie','') = ''
         OR coalesce(v_b->'sursa'->>'rand','') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'izo: rândul %: lipsește sursa (fisier, foaie, rand) — R13', v_n;
      END IF;
      v_serie := btrim(v_b->>'serie');
      v_sarja := nullif(btrim(coalesce(v_b->>'sarja', '')), '');
      IF v_serie IS NULL OR v_serie = '' OR v_sarja IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): serie și șarjă obligatorii', v_n, v_b->'sursa'; END IF;
      IF (v_b->>'perete_mm') IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): perete lipsă (D2#3)', v_n, v_serie; END IF;
      v_stare := v_b->>'stare';
      IF v_stare NOT IN ('sosit','receptionat','pe_tronson') THEN RAISE EXCEPTION 'izo: rândul % (%): stare % la sold inițial', v_n, v_serie, v_stare; END IF;
      v_dep := (v_b->>'depozit_id')::integer;
      v_tr := (v_b->>'tronson_id')::bigint;
      IF v_stare = 'pe_tronson' THEN
        IF v_tr IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): pe_tronson fără tronson_id', v_n, v_serie; END IF;
        v_loctip := 'tronson';
      ELSE
        IF v_dep IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): fără depozit_id', v_n, v_serie; END IF;
        v_loctip := 'depozit';
      END IF;
      IF NOT public.fn_izo_loc_valid(p_proiect, v_dep, v_tr) THEN
        RAISE EXCEPTION 'izo: rândul % (%): depozitul % / tronsonul % nu țin de proiectul %', v_n, v_serie, v_dep, v_tr, p_proiect;
      END IF;
      v_tipmat := public.fn_izo_tip_material(v_tip);
      v_canon := upper(regexp_replace(v_serie, '[[:space:]._/-]', '', 'g'));
      v_izol := coalesce(v_b->>'izolatie', 'neizolata');
      IF v_tip = 'teava' THEN
        v_lmm := (v_b->>'lungime_mm')::integer;
        IF v_lmm IS NULL THEN RAISE EXCEPTION 'izo: rândul % (%): lungime lipsă', v_n, v_serie; END IF;
        v_cm := round(v_lmm / 10.0)::integer;
        -- R1 (c): a doua rădăcină cu aceeași serie canonică = conflict (fără dezambiguare la import)
        IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE provenienta = 'beneficiar' AND tip_cod = 'teava' AND parinte_id IS NULL
                    AND stare <> 'anulata' AND serie_canon = v_canon AND dezambiguare IS NULL) THEN
          RAISE EXCEPTION 'izo: rândul % : seria % (canonic %) există deja ca țeavă (R1 c) — de decis în preview', v_n, v_serie, v_canon USING ERRCODE = '23505';
        END IF;
        v_nt := v_nt + 1; v_metri := v_metri + v_lmm / 1000.0;
      ELSE
        v_lmm := NULL;
        v_unghi := (v_b->>'unghi_curba')::numeric;
        IF v_unghi IS NULL OR v_unghi <= 0 OR v_unghi > 90 THEN RAISE EXCEPTION 'izo: rândul % (%): unghi de curbă invalid', v_n, v_serie; END IF;
        IF EXISTS (SELECT 1 FROM public.magazie_bucati WHERE provenienta = 'beneficiar' AND tip_cod = 'curba' AND stare <> 'anulata'
                    AND serie_canon = v_canon AND sarja = v_sarja AND unghi_curba = v_unghi AND cod_bucata = 'AB') THEN
          RAISE EXCEPTION 'izo: rândul %: curba % / % / %° există deja — coliziune de decis explicit', v_n, v_serie, v_sarja, v_unghi USING ERRCODE = '23505';
        END IF;
        v_nc := v_nc + 1;
      END IF;

      v_id := nextval(pg_get_serial_sequence('public.magazie_bucati', 'id'));
      INSERT INTO public.magazie_bucati (
        id, proiect_id, tip_material_id, tip_cod, uid, parinte_id, radacina_id, cod_bucata, capat_stanga, capat_dreapta,
        serie, sarja, dimensiune, grad_otel, standard, izolatie, producator, furnizor,
        lungime_m, lungime_originala_m, lungime_aviz_mm, lungime_mm, perete_mm, diametru_mm, unghi_curba, greutate_kg,
        cantitate, um, provenienta, sursa_receptie, nr_document, data_receptie, stare, locatie_tip, locatie_site_id,
        depozit_id, tronson_id, lot, atribute, server_ver, observatii)
      VALUES (
        v_id, p_proiect, v_tipmat, v_tip, gen_random_uuid(), NULL, v_id, 'AB', 'A', 'B',
        v_serie, v_sarja, v_b->>'dimensiune', v_b->>'grad_otel', v_b->>'standard', v_izol, v_b->>'producator', v_b->>'furnizor',
        CASE WHEN v_lmm IS NULL THEN NULL ELSE v_lmm / 1000.0 END, CASE WHEN v_lmm IS NULL THEN NULL ELSE v_lmm / 1000.0 END,
        v_lmm, v_lmm, (v_b->>'perete_mm')::numeric, (v_b->>'diametru_mm')::integer, CASE WHEN v_tip = 'curba' THEN v_unghi END,
        (v_b->>'greutate_kg')::numeric,
        1, CASE WHEN v_tip = 'teava' THEN 'm' ELSE 'buc' END, 'beneficiar', 'aviz', v_b->>'nr_aviz', (v_b->>'data_aviz')::date,
        v_stare, v_loctip, v_site, v_dep, v_tr, v_b->>'lot',
        jsonb_strip_nulls(jsonb_build_object('sursa', v_b->'sursa', 'import_id', p_import_id, 'aviz_iesire', v_b->'aviz_iesire',
                                             'pv_receptie', v_b->'pv_receptie', 'nrcd', v_b->'nrcd', 'gestiune', v_b->'gestiune',
                                             'dt_os', v_b->'dt_os', 'descriere', v_b->'descriere', 'izolatie_text', v_b->'izolatie_text')),
        nextval('public.izo_server_ver_seq'), v_b->>'observatii');
      INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_dupa, in_loc, lungime_mm, server_ver)
      VALUES (v_ev, p_proiect, v_id, 'nascut', v_stare,
              jsonb_strip_nulls(jsonb_build_object('tip', v_loctip, 'depozit_id', v_dep, 'tronson_id', v_tr)), v_lmm,
              nextval('public.izo_server_ver_seq'));
      IF v_loctip = 'depozit' THEN
        v_pe_dep := jsonb_set(v_pe_dep, ARRAY[v_dep::text], to_jsonb(coalesce((v_pe_dep->>v_dep::text)::int, 0) + 1));
      ELSE
        v_pe_tr := v_pe_tr + 1;
      END IF;
    END LOOP;

    v_rez := jsonb_build_object('import_id', p_import_id, 'eveniment_id', v_ev, 'bucati', v_n, 'tevi', v_nt, 'curbe', v_nc,
                                'metri_tevi', round(v_metri, 2), 'pe_depozit', v_pe_dep, 'pe_tronson', v_pe_tr, 'payload_sha256', v_sha);
    UPDATE public.izo_importuri SET eveniment_id = v_ev, rezultat = v_rez WHERE id = v_imp_id;
    RETURN v_rez || jsonb_build_object('duplicat', false);
  END $f$;

  -- storno pe tot importul: fail-closed dacă vreo bucată are vreun eveniment ulterior [R4]
  CREATE FUNCTION public.fn_izo_import_storno(p_proiect bigint, p_import_id text, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_imp record; v_ev bigint; v_n int; v_alt int;
  BEGIN
    PERFORM set_config('izo.registru_tx', txid_current()::text, true);
    IF p_motiv IS NULL OR char_length(btrim(p_motiv)) < 3 THEN RAISE EXCEPTION 'izo: motivul e obligatoriu'; END IF;
    SELECT * INTO v_imp FROM public.izo_importuri WHERE proiect_id = p_proiect AND import_id = p_import_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo: importul % nu există pe proiectul %', p_import_id, p_proiect; END IF;
    IF v_imp.stare <> 'aplicat' THEN RAISE EXCEPTION 'izo: importul % e deja %', p_import_id, v_imp.stare; END IF;
    PERFORM 1 FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id = b.id
      WHERE m.eveniment_id = v_imp.eveniment_id FOR UPDATE OF b;
    SELECT count(*) INTO v_alt FROM public.magazie_bucati_miscari m2
     WHERE m2.bucata_id IN (SELECT m.bucata_id FROM public.magazie_bucati_miscari m WHERE m.eveniment_id = v_imp.eveniment_id)
       AND m2.eveniment_id <> v_imp.eveniment_id;
    IF v_alt > 0 THEN
      RAISE EXCEPTION 'izo: storno refuzat — % mișcări ulterioare pe bucățile importului % (stornează întâi lanțul, explicit)', v_alt, p_import_id;
    END IF;
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, import_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
    VALUES ('storno', p_proiect, 'import', p_import_id, p_import_id, v_imp.eveniment_id, btrim(p_motiv), public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_ev, p_proiect, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id = b.id AND m.eveniment_id = v_imp.eveniment_id;
    UPDATE public.magazie_bucati b SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
      FROM public.magazie_bucati_miscari m WHERE m.bucata_id = b.id AND m.eveniment_id = v_imp.eveniment_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE public.izo_importuri SET stare = 'stornat', stornat_eveniment_id = v_ev WHERE id = v_imp.id;
    RETURN jsonb_build_object('import_id', p_import_id, 'storno_eveniment_id', v_ev, 'bucati_anulate', v_n);
  END $f$;

  -- ── G. drepturi (explicite; nimic din default privileges) ────────────────────────────────────────────
  -- funcțiile: nimic pentru PUBLIC; ajutătoarele de citire pentru cine le folosește în politici/UI
  REVOKE ALL ON FUNCTION public.fn_izo_nivel(bigint), public.fn_izo_acces(bigint, text, text, text), public.fn_izo_citire(bigint),
    public.fn_izo_proiecte_protejate(), public.fn_izo_bucata_protejata(bigint), public.fn_izo_tip_cod(integer),
    public.fn_izo_tip_material(text), public.fn_izo_loc_valid(bigint, integer, bigint), public.fn_izo_site_proiect(bigint),
    public.fn_izo_proiect_pachet(bigint), public.fn_izo_uid(), public.fn_izo_garda_scriitor(), public.fn_izo_garda_bucati(),
    public.fn_izo_garda_truncate_bucati(), public.fn_izo_garda_fapte(), public.fn_izo_refuz_delete_tevi(), public.fn_izo_refuz_delete_pachet(),
    public.fn_izo_refuz_bon_bucata(), public.fn_izo_seteaza_nivel(bigint, text, text),
    public.fn_izo_import_sold_initial(bigint, text, jsonb), public.fn_izo_import_storno(bigint, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_nivel(bigint), public.fn_izo_garda_scriitor(), public.fn_izo_bucata_protejata(bigint),
    public.fn_izo_proiect_pachet(bigint), public.fn_izo_tip_cod(integer)
    TO anon, authenticated, service_role, izo_registru_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_citire(bigint), public.fn_izo_proiecte_protejate() TO authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_izo_acces(bigint, text, text, text), public.fn_izo_tip_material(text),
    public.fn_izo_loc_valid(bigint, integer, bigint), public.fn_izo_site_proiect(bigint), public.fn_izo_uid() TO izo_registru_writer;

  -- tabelele noi: anon nimic; authenticated doar SELECT (filtrat de RLS); service_role doar SELECT; writer ce scrie
  REVOKE ALL ON TABLE public.izo_proiect_config, public.izo_atribuiri, public.izo_importuri,
    public.magazie_bucati_evenimente, public.magazie_bucati_miscari FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON SEQUENCE public.izo_atribuiri_id_seq, public.izo_importuri_id_seq, public.magazie_bucati_evenimente_id_seq,
    public.magazie_bucati_miscari_id_seq FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON TABLE public.izo_proiect_config, public.izo_atribuiri, public.izo_importuri,
    public.magazie_bucati_evenimente, public.magazie_bucati_miscari TO authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.izo_proiect_config, public.izo_importuri TO izo_registru_writer;
  GRANT SELECT, INSERT ON TABLE public.magazie_bucati_evenimente, public.magazie_bucati_miscari TO izo_registru_writer;
  GRANT SELECT ON TABLE public.izo_atribuiri TO izo_registru_writer;
  GRANT USAGE ON SEQUENCE public.izo_importuri_id_seq, public.magazie_bucati_evenimente_id_seq,
    public.magazie_bucati_miscari_id_seq TO izo_registru_writer;
  -- magazie_bucati (existent): writer citește/scrie beneficiar; secvența id prin nextval explicit (radacina_id = id)
  GRANT SELECT, INSERT, UPDATE ON TABLE public.magazie_bucati TO izo_registru_writer;
  EXECUTE format('GRANT USAGE ON SEQUENCE %s TO izo_registru_writer', pg_get_serial_sequence('public.magazie_bucati', 'id'));

  -- ── H. RLS ────────────────────────────────────────────────────────────────────────────────────────────
  ALTER TABLE public.izo_proiect_config ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_atribuiri ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_importuri ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.magazie_bucati_evenimente ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.magazie_bucati_miscari ENABLE ROW LEVEL SECURITY;
  -- client: citire pe proiect
  CREATE POLICY izo_cfg_sel ON public.izo_proiect_config FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_atr_sel ON public.izo_atribuiri FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_imp_sel ON public.izo_importuri FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_ev_sel ON public.magazie_bucati_evenimente FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_mis_sel ON public.magazie_bucati_miscari FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  -- writer (fără BYPASSRLS): politici permisive proprii [R7]
  CREATE POLICY izo_cfg_writer ON public.izo_proiect_config FOR ALL TO izo_registru_writer USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_atr_writer ON public.izo_atribuiri FOR SELECT TO izo_registru_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_imp_writer ON public.izo_importuri FOR ALL TO izo_registru_writer USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_ev_writer_sel ON public.magazie_bucati_evenimente FOR SELECT TO izo_registru_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_ev_writer_ins ON public.magazie_bucati_evenimente FOR INSERT TO izo_registru_writer WITH CHECK (public.fn_izo_nivel(proiect_id) <> 'off');
  CREATE POLICY izo_mis_writer_sel ON public.magazie_bucati_miscari FOR SELECT TO izo_registru_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_mis_writer_ins ON public.magazie_bucati_miscari FOR INSERT TO izo_registru_writer WITH CHECK (public.fn_izo_nivel(proiect_id) <> 'off');
  -- magazie_bucati: RESTRICTIVE pentru client (beneficiar pe proiect cu registru = doar citire) + permisive pentru writer
  CREATE POLICY magbuc_izo_client_ins ON public.magazie_bucati AS RESTRICTIVE FOR INSERT TO anon, authenticated
    WITH CHECK (NOT (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off'));
  CREATE POLICY magbuc_izo_client_upd ON public.magazie_bucati AS RESTRICTIVE FOR UPDATE TO anon, authenticated
    USING (NOT (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off'))
    WITH CHECK (NOT (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off'));
  CREATE POLICY magbuc_izo_client_del ON public.magazie_bucati AS RESTRICTIVE FOR DELETE TO anon, authenticated
    USING (NOT (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off'));
  CREATE POLICY magbuc_izo_writer_sel ON public.magazie_bucati FOR SELECT TO izo_registru_writer USING (provenienta = 'beneficiar');
  CREATE POLICY magbuc_izo_writer_ins ON public.magazie_bucati FOR INSERT TO izo_registru_writer
    WITH CHECK (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off');
  CREATE POLICY magbuc_izo_writer_upd ON public.magazie_bucati FOR UPDATE TO izo_registru_writer
    USING (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off')
    WITH CHECK (provenienta = 'beneficiar' AND public.fn_izo_nivel(proiect_id) <> 'off');

  -- ── I. ownerul funcțiilor registrului (lista albă) — CREATE pe public doar pe durata ALTER OWNER ─────
  GRANT CREATE ON SCHEMA public TO izo_registru_writer;
  ALTER FUNCTION public.fn_izo_seteaza_nivel(bigint, text, text) OWNER TO izo_registru_writer;
  ALTER FUNCTION public.fn_izo_import_sold_initial(bigint, text, jsonb) OWNER TO izo_registru_writer;
  ALTER FUNCTION public.fn_izo_import_storno(bigint, text, text) OWNER TO izo_registru_writer;
  REVOKE CREATE ON SCHEMA public FROM izo_registru_writer;
  -- ALTER OWNER păstrează ACL-ul: owner-ul nou are EXECUTE implicit; postgres primește explicit
  REVOKE ALL ON FUNCTION public.fn_izo_seteaza_nivel(bigint, text, text), public.fn_izo_import_sold_initial(bigint, text, jsonb),
    public.fn_izo_import_storno(bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_seteaza_nivel(bigint, text, text), public.fn_izo_import_sold_initial(bigint, text, jsonb),
    public.fn_izo_import_storno(bigint, text, text) TO postgres;

  -- ── postcondiții ──────────────────────────────────────────────────────────────────────────────────────
  -- P1 granița rolului [R7]: doar postgres e membru; nimeni din API nu poate SET/INHERIT
  IF (SELECT array_agg(pg_get_userbyid(m.member)::text ORDER BY pg_get_userbyid(m.member)::text) FROM pg_auth_members m WHERE m.roleid = 'izo_registru_writer'::regrole)
       IS DISTINCT FROM ARRAY['postgres']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 1: alți membri decât postgres în izo_registru_writer';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) r(n)
              WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.n)
                AND (pg_has_role(r.n, 'izo_registru_writer', 'MEMBER') OR pg_has_role(r.n, 'izo_registru_writer', 'USAGE'))) THEN
    RAISE EXCEPTION 'Postcondiție 1b: un rol API poate prelua izo_registru_writer';
  END IF;
  IF (SELECT rolbypassrls OR rolcanlogin OR rolsuper OR rolinherit FROM pg_roles WHERE rolname = 'izo_registru_writer') THEN
    RAISE EXCEPTION 'Postcondiție 1c: izo_registru_writer are BYPASSRLS/LOGIN/SUPERUSER/INHERIT';
  END IF;
  -- P2 writer-ul nu deține nimic în afara listei albe și nu are CREATE pe public
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = 'izo_registru_writer'::regrole)
     OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = 'izo_registru_writer'::regrole)
     OR has_schema_privilege('izo_registru_writer', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Postcondiție 2: izo_registru_writer deține tabele/secvențe/scheme sau are CREATE pe public';
  END IF;
  IF (SELECT array_agg(format('%s.%s(%s)', p.pronamespace::regnamespace, p.proname, pg_get_function_identity_arguments(p.oid)) ORDER BY p.proname)
        FROM pg_proc p WHERE p.proowner = 'izo_registru_writer'::regrole)
       IS DISTINCT FROM ARRAY['public.fn_izo_import_sold_initial(p_proiect bigint, p_import_id text, p_payload jsonb)',
                              'public.fn_izo_import_storno(p_proiect bigint, p_import_id text, p_motiv text)',
                              'public.fn_izo_seteaza_nivel(p_proiect bigint, p_nivel text, p_motiv text)']::text[] THEN
    RAISE EXCEPTION 'Postcondiție 2b: funcțiile cu owner izo_registru_writer ≠ lista albă';
  END IF;
  -- P3 toate funcțiile izo: search_path fixat; cele ale writer-ului DEFINER; niciuna executabilă de anon/authenticated
  --    în afara listei (nivel, garda, citire, protejate, bucată protejată, pachet, tip_cod)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%'
                AND NOT coalesce(p.proconfig @> ARRAY['search_path=public, pg_temp'], false)) THEN
    RAISE EXCEPTION 'Postcondiție 3: o funcție fn_izo_* fără search_path fixat';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner = 'izo_registru_writer'::regrole
              AND (NOT p.prosecdef OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   OR has_function_privilege('service_role', p.oid, 'EXECUTE') OR p.prosrc ~* '\mEXECUTE\M\s+[^;]*(format|\|\|)')) THEN
    RAISE EXCEPTION 'Postcondiție 3b: o funcție a registrului nu e DEFINER, e executabilă din API sau are SQL dinamic';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%'
                AND p.proname NOT IN ('fn_izo_nivel','fn_izo_garda_scriitor','fn_izo_citire','fn_izo_proiecte_protejate',
                                      'fn_izo_bucata_protejata','fn_izo_proiect_pachet','fn_izo_tip_cod')
                AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'Postcondiție 3c: o funcție izo internă e executabilă de anon/authenticated';
  END IF;
  -- P4 tabelele noi: RLS activ; anon nimic; authenticated / service_role doar SELECT; secvențe închise
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari']) t(n)
              WHERE NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t.n)::regclass)
                 OR EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)
                             WHERE has_table_privilege('anon', 'public.' || t.n, p.n))
                 OR EXISTS (SELECT 1 FROM unnest(ARRAY['authenticated','service_role']) r(n), unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(n)
                             WHERE has_table_privilege(r.n, 'public.' || t.n, p.n))) THEN
    RAISE EXCEPTION 'Postcondiție 4: RLS inactiv sau drepturi de scriere pentru anon/authenticated/service_role pe tabelele izo';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq','magazie_bucati_miscari_id_seq']) s(n),
                          unnest(ARRAY['anon','authenticated','service_role']) r(n), unnest(ARRAY['USAGE','SELECT','UPDATE']) p(n)
              WHERE has_sequence_privilege(r.n, 'public.' || s.n, p.n)) THEN
    RAISE EXCEPTION 'Postcondiție 4b: anon/authenticated/service_role au drepturi pe secvențele izo';
  END IF;
  -- P5 garda instalată + toate proiectele off + rândurile existente neatinse
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_magbuc_izo_garda','trg_magbuc_izo_truncate','trg_izo_ev_garda',
        'trg_izo_ev_truncate','trg_izo_mis_garda','trg_izo_mis_truncate','trg_izo_imp_garda','trg_izo_imp_truncate','trg_izo_cfg_garda',
        'trg_izo_cfg_truncate','trg_executie_tevi_izo_delete','trg_pachete_izo_delete','trg_bon_linii_izo_bucata')) <> 13 THEN
    RAISE EXCEPTION 'Postcondiție 5: lipsește un trigger izo';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'magazie_bucati' AND policyname LIKE 'magbuc\_izo\_client\_%' AND permissive = 'RESTRICTIVE') <> 3 THEN
    RAISE EXCEPTION 'Postcondiție 5b: politicile RESTRICTIVE de pe magazie_bucati lipsesc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.izo_proiect_config) OR EXISTS (SELECT 1 FROM public.magazie_bucati WHERE tip_cod IS NOT NULL) THEN
    RAISE EXCEPTION 'Postcondiție 5c: migrarea trebuie să lase toate proiectele off și registrul gol';
  END IF;

  -- ── J. amprenta obiectelor izo (aceeași expresie ca în revenire) ─────────────────────────────────────
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
      (SELECT string_agg(format('%s(%s):%s:%s:%s:%s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner), p.prosecdef, md5(p.prosrc),
                                coalesce(p.proacl::text, '')), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_izo\_%'),
      (SELECT string_agg(format('%s:%s', c.relname, coalesce(c.relacl::text, '')), ',' ORDER BY c.relname)
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari',
                            'izo_server_ver_seq','izo_atribuiri_id_seq','izo_importuri_id_seq','magazie_bucati_evenimente_id_seq',
                            'magazie_bucati_miscari_id_seq','magazie_bucati')),
      (SELECT format('%s:%s:%s:%s:%s', r.rolinherit, r.rolcanlogin, r.rolbypassrls,
                     (SELECT string_agg(format('%s:%s:%s:%s', pg_get_userbyid(m.member), m.admin_option, m.inherit_option, m.set_option), ',' ORDER BY pg_get_userbyid(m.member)::text)
                        FROM pg_auth_members m WHERE m.roleid = r.oid), r.rolsuper)
         FROM pg_roles r WHERE r.rolname = 'izo_registru_writer')))
    INTO v_amprenta;
  -- </amprenta>
  IF v_amprenta IS NULL OR v_amprenta !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Postcondiție 9: amprenta nu s-a putut calcula';
  END IF;
  EXECUTE format('COMMENT ON TABLE public.magazie_bucati_evenimente IS %L',
    'Registrul de țeavă Transgaz (izometrie) — evenimente, doar adaug. Scris doar de funcțiile izo_registru_writer. 20261102a. amprenta=' || v_amprenta);

  -- ── garda de livrare (final) ──────────────────────────────────────────────────────────────────────────
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261102a_izometrie_e2a_registru:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261102a: garda de livrare (final) — tranzacție/runner invalid';
  END IF;
END
$migrare$;
