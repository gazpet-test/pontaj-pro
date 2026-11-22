-- Version 20270105130000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20270105b_executie_proiect_configurare.l15.tsv (DOAR cu plafonul EXTINS — decizia proprietarului 22.11.2026, ca 20270105a:
--   pe producție cele două fotografii L15 singure iau ~3 s; --plafon-extins cere fereastra orară, docs/LIVRARE_L15_V2.md §9 — ȘI cu amprenta
--   globală L15 v2; manifestul se generează pe clonă). Lista OBIECTELOR revizuită: supabase/tests/20270105b_executie_proiect_configurare.l15.obiecte.tsv.
-- 20270105b_executie_proiect_configurare — Execuție: poarta proiectului NOU „în configurare” (decizia owner-ului, 21.11.2026; plan Task 2).
--   „În configurare” = executie_proiecte.configurare_completa_la IS NULL (coloanele vin din 20270105a). Un proiect iese din configurare doar
--   când are oferta financiară încărcată (rânduri contract_initial active, fn_rest_decontat_are_oferta) — sau, prin excepție, când owner-ul o
--   declară cu un motiv scris (jurnalizat). Poarta NU blochează pontajul, rapoartele sau logistica: doar trecerea de stare și (din 20270105a, prin
--   lipsa bazei) confirmarea situațiilor. Proiectele existente nu se modifică (apar în v_executie_rest_decontat_lipsuri ca fara_oferta).
-- Ce face:
--   * fn_executie_proiect_configurare_completa(p_proiect, p_motiv): owner / MP / sub-modul editor (fn_rest_decontat_drept 'confirmare'); cu ofertă →
--     configurare_completa_la = now(); fără ofertă → doar owner-ul, cu motiv nevid, scris în configurare_exceptie_motiv; idempotent (a doua chemare
--     = {deja: true}, nimic scris).
--   * executie_proiect_configurare_jurnal: o înregistrare pe fiecare declarare (cine, când, cu / fără excepție, motivul, câte rânduri de ofertă erau);
--     doar RPC-ul scrie, clienții citesc cu dreptul de citire al proiectului.
--   * garda BEFORE INSERT OR UPDATE OF configurare_completa_la / configurare_exceptie_motiv pe executie_proiecte (L07): coloanele poartei se
--     schimbă doar prin RPC (marcajul static al tranzacției, ca în 20270105a) sau de server; un PATCH direct prin API e refuzat, iar un proiect
--     NOU nu poate fi creat direct cu configurarea declarată (r2, review #1158: INSERT acoperit). Marcaj LIPSĂ (NULL, sesiune nouă) = refuz.
--   * RPC-ul reverifică dreptul DUPĂ lock-ul pe proiect (L01).
-- Ce NU face: nicio dată, niciun drept acordat, nu atinge politicile existente ale executie_proiecte.
-- Dependențe: 20270105a aplicată (coloanele, fn_rest_decontat_drept, fn_rest_decontat_are_oferta — corpurile verificate prin md5); porțile Izometrie
--   (20261230a): trigger-ul pe executie_proiecte e o atingere „posibilă” a perimetrului E4b → ritualul PRE / ștampile / POST, ca în 20270105a.
-- Ordinea lock-urilor (L06): migrarea: executie_proiecte (ACCESS EXCLUSIVE). RPC-ul: advisory (proiect, aceeași cheie ca RPC-urile din 20270105a)
--   -> executie_proiecte FOR UPDATE -> UPDATE -> INSERT jurnal.
-- GĂRZILE DE TIMP: plafonul tranzacției = 15000 ms (plafonul EXTINS, --plafon-extins, doar în fereastra 21:00–06:00 Europe/Bucharest) pus de
--   runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, garda finală.
-- Revenire: supabase/revenire/20270105b_executie_proiect_configurare_ROLLBACK.sql. Probe: scripts/pglite/test_executie_rest_decontat_local.mjs,
--   supabase/tests/20270105b_executie_proiect_configurare_dryrun.sql.
DO $pre$
DECLARE v_plafon text; v_tip text; r record; v_x text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105b_executie_proiect_configurare:' || txid_current() THEN
    RAISE EXCEPTION '20270105b: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270105b: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270105b: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270105b: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20270105b: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270105b: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- dependența de 20270105a: coloanele poartei și funcțiile de drept / ofertă, cu corpurile revizuite (md5 pe prosrc fără CR, DEFINER, owner)
  IF to_regclass('public.executie_proiecte') IS NULL OR to_regclass('public.profiles') IS NULL OR to_regclass('public.proiect_articole') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.fn_rest_decontat_drept(bigint, text)') IS NULL
     OR to_regprocedure('public.fn_rest_decontat_are_oferta(bigint)') IS NULL OR to_regprocedure('public.fn_rest_decontat_server()') IS NULL THEN
    RAISE EXCEPTION '20270105b: 20270105a (fn_rest_decontat_drept / are_oferta / server) sau tabelele existente lipsesc';
  END IF;
  SELECT string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef::text || ':' || pg_get_userbyid(p.proowner), ';' ORDER BY p.proname) INTO v_x
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_rest_decontat_drept', 'fn_rest_decontat_are_oferta', 'fn_rest_decontat_server');
  IF v_x IS DISTINCT FROM 'fn_rest_decontat_are_oferta=62c2b3021e3d7e7a827e864b8c337924:true:postgres;fn_rest_decontat_drept=c1e493134dfd4882b1bc69b09b5b49ea:true:postgres;fn_rest_decontat_server=8de3a77b9c3984544a84b9ee3dfdd219:false:postgres' THEN
    RAISE EXCEPTION '20270105b: functiile din 20270105a au alt corp / proprietar decat cel revizuit: %', v_x;
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL OR to_regprocedure('public.fn_izo_porti_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e3_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e3b_definitii()') IS NULL
     OR to_regprocedure('public.fn_izo_porti_e4_definitii()') IS NULL OR to_regprocedure('public.fn_izo_porti_e4b_definitii()') IS NULL THEN
    RAISE EXCEPTION '20270105b: portile Izometrie (20261230a) lipsesc';
  END IF;
  -- IZO PRE
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105b: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
  -- reaplicare = refuz
  IF to_regclass('public.executie_proiect_configurare_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_rest_decontat_configurare_garda', 'trg_rest_decontat_configurare_jurnal_garda')) THEN
    RAISE EXCEPTION '20270105b: obiectele exista deja (reaplicare)';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'configurare_completa_la', 'timestamp with time zone'),
      ('executie_proiecte', 'configurare_exceptie_motiv', 'text'), ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
      ('proiect_articole', 'proiect_id', 'integer|bigint'), ('proiect_articole', 'sursa', 'text|character varying'), ('proiect_articole', 'activ', 'boolean')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20270105b: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('postgres', 'public.executie_proiecte', 'UPDATE') THEN RAISE EXCEPTION '20270105b: postgres nu poate scrie executie_proiecte'; END IF;
  IF EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.configurare_completa_la IS NOT NULL OR e.configurare_exceptie_motiv IS NOT NULL) THEN
    RAISE EXCEPTION '20270105b: exista deja proiecte cu configurarea declarata (coloanele din 20270105a trebuie sa fie goale la aplicare)';
  END IF;
END $pre$;

DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20270105b: BUGET_LOCK: executie_proiecte ocupat; % incercari, % ms de la prima incercare (bugetul e 1 s; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20270105b: BUGET_LOCK: lock-ul obtinut abia la % ms de la prima incercare (% incercari; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20270105b: lock la % ms de la BEGIN (% incercari)', round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari;
END $lock$;

-- ─── 1. jurnalul declarărilor (append-only; scris doar de RPC) ───────────────────────────────────────────────────────────────
CREATE TABLE public.executie_proiect_configurare_jurnal (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  profile_id uuid NOT NULL,
  la timestamptz NOT NULL DEFAULT now(),
  cu_exceptie boolean NOT NULL,
  motiv text,
  oferta_randuri integer NOT NULL,
  CONSTRAINT executie_proiect_configurare_jurnal_motiv_ck CHECK (cu_exceptie = (motiv IS NOT NULL) AND (motiv IS NULL OR (motiv ~ '[^[:space:]]' AND length(motiv) <= 2000))),
  CONSTRAINT executie_proiect_configurare_jurnal_randuri_ck CHECK (oferta_randuri >= 0 AND (cu_exceptie OR oferta_randuri > 0))
);
CREATE INDEX executie_proiect_configurare_jurnal_proiect_ix ON public.executie_proiect_configurare_jurnal (proiect_id, la);
COMMENT ON TABLE public.executie_proiect_configurare_jurnal IS
  'Execuție (20270105b): fiecare declarare „configurare completă” a unui proiect (cine, când, cu excepția owner-ului și motivul ei, câte rânduri de ofertă erau). Scris doar de fn_executie_proiect_configurare_completa.';

-- ─── 2. gărzile (L07): coloanele poartei doar prin RPC / server (și la INSERT: un proiect nou nu se naște „configurat”); jurnalul append-only ──
-- Marcajul LIPSĂ (NULL, sesiune nouă) = refuz, ca și marcajul gol (L18).
CREATE FUNCTION public.fn_executie_proiect_configurare_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE
  v_rpc boolean := coalesce(current_setting('gazpet.rest_decontat_scriitor', true), '') = 'fn_executie_proiect_configurare_completa';
  v_server boolean := public.fn_rest_decontat_server() IS TRUE;
BEGIN
  IF TG_TABLE_NAME = 'executie_proiect_configurare_jurnal' THEN
    IF TG_OP <> 'INSERT' AND NOT v_server THEN
      RAISE EXCEPTION 'configurare: jurnalul declararilor nu se modifica si nu se sterge' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' AND (v_rpc OR v_server) IS NOT TRUE THEN
      RAISE EXCEPTION 'configurare: jurnalul se scrie doar prin fn_executie_proiect_configurare_completa' USING ERRCODE = '42501';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- INSERT: proiectul nou se naște „în configurare” (ambele coloane NULL); doar serverul poate scrie altfel (RPC-ul nu creează proiecte)
  IF TG_OP = 'INSERT' THEN
    IF (NEW.configurare_completa_la IS NOT NULL OR NEW.configurare_exceptie_motiv IS NOT NULL) AND NOT v_server THEN
      RAISE EXCEPTION 'configurare: un proiect nou se creeaza „in configurare”; starea se declara doar prin fn_executie_proiect_configurare_completa' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.configurare_completa_la, NEW.configurare_exceptie_motiv) IS DISTINCT FROM (OLD.configurare_completa_la, OLD.configurare_exceptie_motiv)
     AND (v_rpc OR v_server) IS NOT TRUE THEN
    RAISE EXCEPTION 'configurare: starea „in configurare” a proiectului se schimba doar prin fn_executie_proiect_configurare_completa' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_proiect_configurare_garda() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_rest_decontat_configurare_garda BEFORE INSERT OR UPDATE OF configurare_completa_la, configurare_exceptie_motiv ON public.executie_proiecte
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proiect_configurare_garda();
CREATE TRIGGER trg_rest_decontat_configurare_jurnal_garda BEFORE INSERT OR UPDATE OR DELETE ON public.executie_proiect_configurare_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_proiect_configurare_garda();
ALTER TABLE public.executie_proiect_configurare_jurnal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_proiect_configurare_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_proiect_configurare_jurnal TO authenticated;
CREATE POLICY executie_proiect_configurare_jurnal_citire ON public.executie_proiect_configurare_jurnal FOR SELECT TO authenticated
  USING (public.fn_rest_decontat_drept(proiect_id, 'citire'));
REVOKE ALL ON SEQUENCE public.executie_proiect_configurare_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. RPC-ul poartei ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Rezultat: {ok, deja, proiect_id, configurare_completa_la, exceptie, motiv}. Refuzuri: 42501 (fără drept / proiect inexistent), P0001 fara_oferta
-- (MP / editor pe proiect fără ofertă), 22023 (owner fără motiv pe proiect fără ofertă).
CREATE FUNCTION public.fn_executie_proiect_configurare_completa(p_proiect bigint, p_motiv text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_e public.executie_proiecte; v_oferta boolean; v_owner boolean; v_motiv text; v_n integer; v_randuri integer; v_acum timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'configurare: autentificare necesara' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR (p_motiv IS NOT NULL AND length(p_motiv) > 2000) THEN RAISE EXCEPTION 'configurare: parametri invalizi' USING ERRCODE = '22023'; END IF;
  IF NOT public.fn_rest_decontat_drept(p_proiect, 'confirmare') THEN
    RAISE EXCEPTION 'configurare: proiectul nu exista sau nu ai drept sa-i declari configurarea' USING ERRCODE = '42501';
  END IF;
  -- lock-uri (L06): advisory pe proiect (aceeasi cheie ca RPC-urile de confirmare) -> proiectul FOR UPDATE
  PERFORM pg_advisory_xact_lock(hashtextextended('gazpet.rest_decontat:' || p_proiect::text, 0));
  SELECT * INTO v_e FROM public.executie_proiecte e WHERE e.id = p_proiect FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'configurare: proiectul nu exista sau nu ai drept sa-i declari configurarea' USING ERRCODE = '42501'; END IF;
  -- L01: dreptul se REVERIFICĂ după lock (MP-ul / lista schimbate cât apelul aștepta lock-ul = refuz)
  IF NOT public.fn_rest_decontat_drept(p_proiect, 'confirmare') THEN
    RAISE EXCEPTION 'configurare: proiectul nu exista sau nu ai drept sa-i declari configurarea' USING ERRCODE = '42501';
  END IF;
  IF v_e.configurare_completa_la IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'deja', true, 'proiect_id', p_proiect, 'configurare_completa_la', v_e.configurare_completa_la,
                              'exceptie', v_e.configurare_exceptie_motiv IS NOT NULL, 'motiv', v_e.configurare_exceptie_motiv);
  END IF;
  v_oferta := public.fn_rest_decontat_are_oferta(p_proiect);
  SELECT count(*)::integer INTO v_randuri FROM public.proiect_articole a WHERE a.proiect_id::bigint = p_proiect AND a.sursa = 'contract_initial' AND a.activ;
  v_owner := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.is_owner IS TRUE);
  v_motiv := nullif(btrim(regexp_replace(coalesce(p_motiv, ''), '[[:space:]]+', ' ', 'g')), '');
  IF NOT v_oferta AND NOT (v_owner AND v_motiv IS NOT NULL) THEN
    IF v_owner THEN RAISE EXCEPTION 'configurare: proiectul nu are oferta financiara; exceptia owner-ului cere un motiv scris' USING ERRCODE = '22023'; END IF;
    RAISE EXCEPTION 'configurare: proiectul nu are oferta financiara incarcata (fara_oferta); doar owner-ul poate declara configurarea completa, cu motiv' USING ERRCODE = 'P0001';
  END IF;
  IF v_oferta THEN v_motiv := NULL; END IF;
  SET LOCAL gazpet.rest_decontat_scriitor = 'fn_executie_proiect_configurare_completa';
  UPDATE public.executie_proiecte SET configurare_completa_la = v_acum, configurare_exceptie_motiv = v_motiv WHERE id = p_proiect AND configurare_completa_la IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'configurare: proiectul nu s-a putut actualiza' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.executie_proiect_configurare_jurnal (proiect_id, profile_id, la, cu_exceptie, motiv, oferta_randuri)
  VALUES (p_proiect, v_uid, v_acum, NOT v_oferta, v_motiv, v_randuri);
  SET LOCAL gazpet.rest_decontat_scriitor = '';
  RETURN jsonb_build_object('ok', true, 'deja', false, 'proiect_id', p_proiect, 'configurare_completa_la', v_acum, 'exceptie', NOT v_oferta, 'motiv', v_motiv);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_proiect_configurare_completa(bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_proiect_configurare_completa(bigint, text) TO authenticated;

-- ─── 4. Postcondiții + ștampilele porților + POST ─────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_amp text; v_jur oid := 'public.executie_proiect_configurare_jurnal'::regclass;
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_jur) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_proiect_configurare_jurnal') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_proiect_configurare_jurnal' AND policyname = 'executie_proiect_configurare_jurnal_citire'
           AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE') <> 1 THEN
    RAISE EXCEPTION '20270105b post: RLS / politica jurnalului';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'service_role']) r(n), unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(n) WHERE has_table_privilege(r.n, v_jur, p.n))
     OR NOT has_table_privilege('authenticated', v_jur, 'SELECT') OR has_table_privilege('authenticated', v_jur, 'INSERT') OR has_table_privilege('authenticated', v_jur, 'UPDATE')
     OR has_table_privilege('authenticated', v_jur, 'DELETE') OR has_table_privilege('authenticated', v_jur, 'TRUNCATE')
     OR has_sequence_privilege('authenticated', 'public.executie_proiect_configurare_jurnal_id_seq', 'USAGE') OR has_sequence_privilege('anon', 'public.executie_proiect_configurare_jurnal_id_seq', 'USAGE') THEN
    RAISE EXCEPTION '20270105b post: privilegii pe jurnal / secventa';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%') <> 2
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_executie_proiect_configurare_garda', 'fn_executie_proiect_configurare_completa')
                 AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) <> 'postgres'
                      OR p.prosecdef IS DISTINCT FROM (p.proname = 'fn_executie_proiect_configurare_completa')
                      OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                      OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_proiect_configurare_completa')
                      OR p.provolatile <> 'v')) THEN
    RAISE EXCEPTION '20270105b post: functii (numar / definer / search_path / owner / EXECUTE)';
  END IF;
  -- trigger-ele exacte: pe executie_proiecte BEFORE INSERT OR UPDATE OF cele doua coloane (tgtype 23 = ROW + BEFORE + INSERT + UPDATE); pe jurnal BEFORE INSERT/UPDATE/DELETE (31)
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.executie_proiecte'::regclass AND t.tgname = 'trg_rest_decontat_configurare_garda'
        AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgfoid = 'public.fn_executie_proiect_configurare_garda()'::regprocedure AND t.tgtype = 23 AND t.tgqual IS NULL AND t.tgnargs = 0
        AND t.tgattr::text = (SELECT string_agg(a.attnum::text, ' ' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = 'public.executie_proiecte'::regclass
                                 AND a.attname IN ('configurare_completa_la', 'configurare_exceptie_motiv'))) <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = v_jur AND t.tgname = 'trg_rest_decontat_configurare_jurnal_garda' AND NOT t.tgisinternal AND t.tgenabled = 'O'
           AND t.tgfoid = 'public.fn_executie_proiect_configurare_garda()'::regprocedure AND t.tgtype = 31 AND t.tgqual IS NULL AND t.tgnargs = 0) <> 1 THEN
    RAISE EXCEPTION '20270105b post: trigger-ele';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_proiect_configurare_jurnal) OR EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.configurare_completa_la IS NOT NULL) THEN
    RAISE EXCEPTION '20270105b post: migrarea nu scrie date';
  END IF;
  -- AMPRENTA_20270105b_INCEPUT (blocul e IDENTIC în migrare și în revenire; proba PGlite compară textul)
  SELECT string_agg(x.l, chr(10) ORDER BY x.l COLLATE "C") INTO v_amp FROM (
    SELECT 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull || ' def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           || ' id=' || a.attidentity::text || ' gen=' || a.attgenerated::text || ' acl=' || coalesce(a.attacl::text, '-') AS l
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.executie_proiect_configurare_jurnal'::regclass AND NOT a.attisdropped AND a.attnum > 0
    UNION ALL
    SELECT 'tab rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity || ' acl=' || coalesce(c.relacl::text, '-') || ' own=' || pg_get_userbyid(c.relowner)
      FROM pg_class c WHERE c.oid = 'public.executie_proiect_configurare_jurnal'::regclass
    UNION ALL
    SELECT 'con ' || k.conname || ' ' || k.contype::text || ' val=' || k.convalidated || ' defer=' || k.condeferrable || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k WHERE k.conrelid = 'public.executie_proiect_configurare_jurnal'::regclass AND k.contype <> 'n'
    UNION ALL
    SELECT 'idx ' || pg_get_indexdef(i.indexrelid) || ' valid=' || i.indisvalid FROM pg_index i WHERE i.indrelid = 'public.executie_proiect_configurare_jurnal'::regclass
    UNION ALL
    SELECT 'trg ' || pg_get_triggerdef(t.oid) || ' en=' || t.tgenabled::text
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_rest_decontat_configurare_garda', 'trg_rest_decontat_configurare_jurnal_garda')
    UNION ALL
    SELECT 'pol ' || p.polname || ' ' || p.polcmd::text || ' perm=' || p.polpermissive
           || ' roles=' || coalesce((SELECT string_agg(pg_get_userbyid(r), ',' ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r), 'PUBLIC')
           || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-') || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
      FROM pg_policy p WHERE p.polrelid = 'public.executie_proiect_configurare_jurnal'::regclass
    UNION ALL
    SELECT 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid) || ' ' || l.lanname
           || ' kind=' || p.prokind::text || ' def=' || p.prosecdef || ' vol=' || p.provolatile::text || ' strict=' || p.proisstrict || ' leak=' || p.proleakproof
           || ' par=' || p.proparallel::text || ' cfg=' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' own=' || pg_get_userbyid(p.proowner)
           || ' acl=' || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (
                SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || ':' || e.privilege_type
                       || CASE WHEN e.is_grantable THEN '*' ELSE '' END AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
           || ' src=' || md5(replace(p.prosrc, chr(13), ''))
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_executie\_proiect\_configurare\_%'
  ) x;
  -- AMPRENTA_20270105b_SFARSIT
  IF md5(coalesce(v_amp, '')) IS DISTINCT FROM 'ca93c57f57fe5c0d0f8e6e4a9fdae92e' THEN
    RAISE NOTICE 'AMPRENTA_20270105b_TEXT %', v_amp;
    RAISE EXCEPTION '20270105b post: AMPRENTA obiectelor % (asteptat ca93c57f57fe5c0d0f8e6e4a9fdae92e)', md5(coalesce(v_amp, ''));
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (trigger-ul pe executie_proiecte: atingere posibilă a perimetrului E4b)
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270105b post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270105b_executie_proiect_configurare:' || txid_current() THEN
    RAISE EXCEPTION '20270105b: garda final invalida';
  END IF;
  RAISE NOTICE '20270105b: sfarsit la % ms de la BEGIN; lock-ul tinut de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $post$;
