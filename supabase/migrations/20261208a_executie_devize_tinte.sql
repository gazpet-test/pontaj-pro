-- Version 20261208120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261208a_executie_devize_tinte — Execuție: raportul zilnic legat de devize (decizia lui Răzvan, 10.11.2026: 1A 2A 3A 4A 5A).
--
-- Ce face:
--   * proiect_unitati + obiect_cod (obiectul din deviz, ex. „0001” = TRONSON 1), nod_cod (nodul din executie_noduri_suduri),
--     plan_start / plan_final (perioada din graficul de referință, pentru alerta „în urmă”). Un obiect / nod = cel mult o unitate pe proiect.
--   * proiect_activitati + principala (lista scurtă din raport), factor_um (multiplicator suplimentar, implicit 1: UM-ul fiecărui articol
--     se convertește automat în UM-ul activității — în devizele Lot 1 același prefix are „M.C.” și „100 MC.”, deci un factor unic ar greși),
--     sursa_executat ('raport' / 'schema_nod': la unitățile cu nod, sudurile se iau din schema nodului), baza_deviz
--     ('oferta' = doar contractul inițial / 'revizuita' = contract + acte adiționale), dn_min / dn_max (sudurile din schemă pe DN).
--   * executie_tinte_setari: pragul alertei „în urmă” (implicit 15 puncte procentuale) și „fără raport de N zile” (implicit 7; gol = oprit).
--   * v_executie_tinte (security_invoker): pe fiecare (obiect, activitate) din deviz / executat / rest / % / % plan și alertele.
--     Calculul stă într-un singur loc (fn_executie_tinte_calcul, L19); ecranul, telefonul și exportul citesc vederea.
--   * fn_executie_tinte_nod: sudurile din schema nodului pe (unitate, activitate): total + în ziua cerută (contorul din telefon).
--   * fn_raport_zilnic_citeste / fn_raport_zilnic_salveaza: raportul zilnic (antetul + liniile pe mai multe obiecte) citit dintr-un singur
--     instantaneu și salvat ÎNTR-O SINGURĂ tranzacție (L02), cu versiune monotonă (CAS, L01) și cheie per intenție în jurnalul
--     raport_zilnic_salvari (L04 / L05: reluarea aceleiași intenții nu se reaplică nici după ce altcineva a salvat între timp).
--     Versiunea stă pe rândul raportului (rapoarte_zilnice.versiune_salvare), incrementată de trigger la ORICE scriere a antetului.
--     RPC-ul verifică dreptul pe șantier. Retragerea scrierii directe în raport_lucrari e pasul 2, separat: 20261208b (după deploy).
--   * Garda pe configurarea țintelor (5A): coloanele noi (și codurile / UM / activ ale unei activități principale) le schimbă doar
--     owner-ul sau executie editor / admin (trigger BEFORE pe OLD/NEW, ca PATCH-ul direct să n-o ocolească).
-- Drepturile (O SINGURĂ definiție, fn_executie_tinte_drept):
--   citire = owner, user_module_access 'executie' (orice nivel) sau șef de șantier (profile_sites valid pe un șantier al proiectului);
--   configurare = owner sau 'executie' editor / admin. Liniile raportului: owner sau profile_sites valid pe șantierul raportului
--   (fn_raport_santier_drept, aceeași regulă ca lista de șantiere din /m).
-- Ce NU face: nicio dată (setul standard de activități și legarea obiectelor Lot 1 sunt SQL separat, NERULAT), niciun drept acordat,
--   nicio atingere pe executie_grafic_* (legarea plan_start / plan_final de grafic e un pas ulterior), pe izo_* sau pe rapoarte_zilnice.
-- Dependențe: 20261201a (executie_noduri_suduri) aplicată.
-- Ordinea lock-urilor (L06), scrisă și în RPC: advisory (șantier, zi) -> rapoarte_zilnice (FOR UPDATE, rândul raportului) -> proiect_activitati
--   (FOR SHARE, ORDER BY id) -> proiect_unitati (FOR SHARE, ORDER BY id) -> raport_lucrari (DELETE + INSERT; FK = KEY SHARE pe aceleași rânduri)
--   -> raport_zilnic_salvari (INSERT).
--   Trigger-ele de gardă nu blochează nimic; calculul doar citește.
-- Revenire: supabase/revenire/20261208a_executie_devize_tinte_ROLLBACK.sql. Test pe clonă: scripts/test_executie_devize_tinte.sql.
DO $pre$
DECLARE r record; v_tip text; v_scala integer;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261208a_executie_devize_tinte:' || txid_current() THEN
    RAISE EXCEPTION '20261208a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261208a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_tinte_setari') IS NOT NULL OR to_regclass('public.v_executie_tinte') IS NOT NULL
     OR to_regclass('public.raport_zilnic_salvari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice' AND column_name = 'versiune_salvare')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rapoarte_zilnice'::regclass AND tgname = 'trg_raport_zilnic_versiune')
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati', 'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie', 'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_zilnic_citeste', 'fn_raport_zilnic_salveaza', 'fn_raport_zilnic_versiune']::name[]))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND ((table_name = 'proiect_unitati' AND column_name IN ('obiect_cod', 'nod_cod', 'plan_start', 'plan_final'))
                      OR (table_name = 'proiect_activitati' AND column_name IN ('principala', 'factor_um', 'sursa_executat', 'baza_deviz', 'dn_min', 'dn_max')))) THEN
    RAISE EXCEPTION '20261208a: obiectele exista deja (reaplicare)';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regclass('public.executie_noduri_suduri') IS NULL
     OR to_regprocedure('public.fn_executie_nod_drept(bigint, boolean)') IS NULL THEN
    RAISE EXCEPTION '20261208a: dependentele auth.uid / 20261201a (executie_noduri_suduri) lipsesc';
  END IF;
  -- coloanele folosite, cu tipurile acceptate (citite din cod și din migrările 20261027a / 20261201a; ce diferă oprește migrarea)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id', 'bigint'),
      ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
      ('user_module_access', 'profile_id', 'uuid'), ('user_module_access', 'module', 'text|character varying'), ('user_module_access', 'access_level', 'text|character varying'),
      ('sites', 'id', 'integer|bigint'), ('sites', 'proiect_id', 'integer|bigint'),
      ('profile_sites', 'profile_id', 'uuid'), ('profile_sites', 'site_id', 'integer|bigint'), ('profile_sites', 'valid_until', 'date'),
      ('rapoarte_zilnice', 'id', 'bigint'), ('rapoarte_zilnice', 'site_id', 'integer|bigint'), ('rapoarte_zilnice', 'data', 'date'),
      ('proiect_unitati', 'id', 'bigint'), ('proiect_unitati', 'proiect_id', 'integer|bigint'), ('proiect_unitati', 'tip', 'text|character varying'),
      ('proiect_unitati', 'cod', 'text|character varying'), ('proiect_unitati', 'nume', 'text|character varying'), ('proiect_unitati', 'ordine', 'integer|bigint|smallint|numeric'),
      ('proiect_unitati', 'activ', 'boolean'),
      ('proiect_activitati', 'id', 'integer|bigint'), ('proiect_activitati', 'proiect_id', 'integer|bigint'), ('proiect_activitati', 'nume', 'text|character varying'),
      ('proiect_activitati', 'um', 'text|character varying'), ('proiect_activitati', 'coduri_deviz', 'text|character varying'), ('proiect_activitati', 'tip_raportare', 'text|character varying'),
      ('proiect_activitati', 'ordine', 'integer|bigint|smallint|numeric'), ('proiect_activitati', 'activ', 'boolean'),
      ('proiect_articole', 'proiect_id', 'integer|bigint'), ('proiect_articole', 'obiect_cod', 'text|character varying'), ('proiect_articole', 'cod', 'text|character varying'),
      ('proiect_articole', 'cantitate', 'numeric|double precision'), ('proiect_articole', 'sursa', 'text|character varying'),
      ('raport_lucrari', 'raport_id', 'bigint'), ('raport_lucrari', 'proiect_id', 'integer|bigint'),
      ('raport_lucrari', 'activitate_id', 'integer|bigint'), ('raport_lucrari', 'unitate_id', 'bigint'),
      ('raport_lucrari', 'cantitate', 'numeric|double precision')
    ) v(t, c, tipuri) LOOP
    SELECT data_type, numeric_scale INTO v_tip, v_scala FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261208a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
    -- cantitatea liniilor: zecimalele trimise (cel mult 3) nu se rotunjesc în tăcere
    IF r.t = 'raport_lucrari' AND r.c = 'cantitate' AND v_tip = 'numeric' AND v_scala IS NOT NULL AND v_scala < 3 THEN
      RAISE EXCEPTION '20261208a: raport_lucrari.cantitate are % zecimale (RPC-ul accepta 3)', v_scala;
    END IF;
  END LOOP;
  -- mai multe obiecte pe raport: niciun UNIQUE pe raport_lucrari care să nu includă unitatea (ex. raport + activitate)
  IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.raport_lucrari'::regclass AND i.indisunique
               AND (i.indexprs IS NOT NULL OR i.indpred IS NOT NULL
                    OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::smallint[])
                                    AND a.attname IN ('id', 'unitate_id')))) THEN
    RAISE EXCEPTION '20261208a: raport_lucrari are un UNIQUE fara unitate (mai multe obiecte pe raport ar fi refuzate)';
  END IF;
  -- RPC-ul (owner postgres) scrie liniile; antetul rămâne scris cu aceleași câmpuri ca din telefon (lista albă ANTET din RPC)
  IF NOT has_table_privilege('postgres', 'public.raport_lucrari', 'INSERT') OR NOT has_table_privilege('postgres', 'public.raport_lucrari', 'DELETE')
     OR NOT has_table_privilege('postgres', 'public.rapoarte_zilnice', 'INSERT') OR NOT has_table_privilege('postgres', 'public.rapoarte_zilnice', 'UPDATE') THEN
    RAISE EXCEPTION '20261208a: postgres nu poate scrie raport_lucrari / rapoarte_zilnice';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
        AND column_name IN ('sef_santier', 'lucrari_efectuate', 'utilaje_snapshot', 'personal_snapshot', 'masini', 'probleme', 'subcontractori',
                            'aprovizionare', 'plan_maine', 'poze', 'meteo', 'distributie_antet', 'created_by', 'updated_at')) <> 14 THEN
    RAISE EXCEPTION '20261208a: rapoarte_zilnice nu are toate coloanele antetului scris din telefon';
  END IF;
  -- ținta lui ON CONFLICT: un UNIQUE exact pe (site_id, data), ca upsert-ul de azi din telefon
  -- (valid, gata și IMEDIAT: un UNIQUE DEFERRABLE sau un index invalid nu poate fi arbitru pentru ON CONFLICT — review r2 P2-4)
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.rapoarte_zilnice'::regclass AND i.indisunique AND i.indpred IS NULL
                   AND i.indisvalid AND i.indisready AND i.indimmediate
                   AND i.indexprs IS NULL AND i.indnkeyatts = 2
                   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                         WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::smallint[])) = ARRAY['data', 'site_id']) THEN
    RAISE EXCEPTION '20261208a: rapoarte_zilnice nu are UNIQUE (site_id, data)';
  END IF;
  -- cheia compusă a vederii (unitate * 1e8 + activitate) rămâne exactă în JavaScript (< 2^53)
  IF (SELECT coalesce(max(id), 0) FROM public.proiect_activitati) >= 100000000 OR (SELECT coalesce(max(id), 0) FROM public.proiect_unitati) >= 90000000 THEN
    RAISE EXCEPTION '20261208a: id-urile depasesc plaja cheii compuse a vederii';
  END IF;
END $pre$;

-- ── coloanele noi (constrângeri cu nume explicite, diferite de cele automate de coloană) ──
ALTER TABLE public.proiect_unitati
  ADD COLUMN obiect_cod text,
  ADD COLUMN nod_cod text,
  ADD COLUMN plan_start date,
  ADD COLUMN plan_final date,
  ADD CONSTRAINT proiect_unitati_tinta_obiect_ck CHECK (obiect_cod IS NULL OR obiect_cod ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$'),
  ADD CONSTRAINT proiect_unitati_tinta_nod_ck CHECK (nod_cod IS NULL OR nod_cod ~ '^[A-Z0-9][A-Z0-9-]{1,59}$'),
  ADD CONSTRAINT proiect_unitati_tinta_plan_ck CHECK ((plan_start IS NULL) = (plan_final IS NULL)
    AND (plan_start IS NULL OR (plan_final >= plan_start AND plan_start >= DATE '2000-01-01' AND plan_final <= DATE '2100-12-31')));
CREATE UNIQUE INDEX proiect_unitati_tinta_obiect_uq ON public.proiect_unitati (proiect_id, obiect_cod) WHERE obiect_cod IS NOT NULL;
CREATE UNIQUE INDEX proiect_unitati_tinta_nod_uq ON public.proiect_unitati (proiect_id, nod_cod) WHERE nod_cod IS NOT NULL;
COMMENT ON COLUMN public.proiect_unitati.obiect_cod IS 'Obiectul din deviz (proiect_articole.obiect_cod, ex. 0001 = TRONSON 1). Ținta = articolele obiectului. 20261208a.';
COMMENT ON COLUMN public.proiect_unitati.nod_cod IS 'Nodul de cuplare (executie_noduri_suduri.nod_cod): sudurile activităților „schema_nod” se iau din schemă. 20261208a.';
COMMENT ON COLUMN public.proiect_unitati.plan_start IS 'Perioada planificată (graficul de referință), pentru alerta „în urmă” (liniar între start și final). 20261208a.';

ALTER TABLE public.proiect_activitati
  ADD COLUMN principala boolean NOT NULL DEFAULT false,
  ADD COLUMN factor_um numeric NOT NULL DEFAULT 1,
  ADD COLUMN sursa_executat text NOT NULL DEFAULT 'raport',
  ADD COLUMN baza_deviz text NOT NULL DEFAULT 'revizuita',
  ADD COLUMN dn_min integer,
  ADD COLUMN dn_max integer,
  ADD CONSTRAINT proiect_activitati_tinta_factor_ck CHECK (factor_um > 0 AND factor_um <= 1000000 AND factor_um = round(factor_um, 6)),
  ADD CONSTRAINT proiect_activitati_tinta_sursa_ck CHECK (sursa_executat IN ('raport', 'schema_nod')),
  ADD CONSTRAINT proiect_activitati_tinta_baza_ck CHECK (baza_deviz IN ('oferta', 'revizuita')),
  ADD CONSTRAINT proiect_activitati_tinta_dn_ck CHECK ((dn_min IS NULL OR dn_min BETWEEN 1 AND 3000) AND (dn_max IS NULL OR dn_max BETWEEN 1 AND 3000)
    AND (dn_min IS NULL OR dn_max IS NULL OR dn_min <= dn_max));
COMMENT ON COLUMN public.proiect_activitati.principala IS 'Apare în lista scurtă a raportului zilnic, pe obiectele unde are țintă. 20261208a.';
COMMENT ON COLUMN public.proiect_activitati.factor_um IS 'Multiplicator suplimentar (implicit 1), DUPĂ conversia automată a UM-ului fiecărui articol în UM-ul activității (HM = 100 m, 100 MC = 100 mc). 20261208a.';
COMMENT ON COLUMN public.proiect_activitati.sursa_executat IS 'raport = ce scrie șeful de șantier; schema_nod = la unitățile cu nod_cod sudurile vin din schema nodului (fără dublă raportare), în rest din raport. 20261208a.';
COMMENT ON COLUMN public.proiect_activitati.baza_deviz IS 'oferta = doar contractul inițial (ex. radiografiile = numărul de suduri pe DN); revizuita = contract + acte adiționale. 20261208a.';
COMMENT ON COLUMN public.proiect_activitati.dn_min IS 'Sudurile din schema nodului numărate la această activitate: dn_min <= DN <= dn_max (gol = fără limită). 20261208a.';

-- ── setările alertelor, pe proiect ──
CREATE TABLE public.executie_tinte_setari (
  proiect_id bigint PRIMARY KEY REFERENCES public.executie_proiecte(id),
  prag_in_urma_pp numeric NOT NULL DEFAULT 15,
  zile_fara_raport integer DEFAULT 7,
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_tinte_setari_prag_ck CHECK (prag_in_urma_pp BETWEEN 1 AND 100 AND prag_in_urma_pp = round(prag_in_urma_pp, 1)),
  CONSTRAINT executie_tinte_setari_zile_ck CHECK (zile_fara_raport IS NULL OR zile_fara_raport BETWEEN 1 AND 90)
);
COMMENT ON TABLE public.executie_tinte_setari IS
  'Execuție: pragurile alertelor din v_executie_tinte (în urmă: puncte procentuale; fără raport: zile, gol = oprit). Fără rând = 15 pp / 7 zile. 20261208a.';

-- ── dreptul: O SINGURĂ definiție (vedere, RPC-uri, trigger-e, politici). Execuția are drepturi pe modul; șeful de șantier pe șantier ──
CREATE FUNCTION public.fn_executie_tinte_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'configurare')
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_nivel = 'citire' AND u.access_level = 'viewer')))
         OR (p_nivel = 'citire' AND EXISTS (
               SELECT 1 FROM public.profile_sites ps JOIN public.sites s ON s.id = ps.site_id
                WHERE ps.profile_id = auth.uid() AND s.proiect_id = p_proiect
                  AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date))))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_drept(bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_tinte_drept(bigint, text) TO authenticated;

-- raportul zilnic al unui șantier: owner sau profile_sites valid (lista de șantiere din /m)
CREATE FUNCTION public.fn_raport_santier_drept(p_site bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_site IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.profile_sites ps WHERE ps.profile_id = auth.uid() AND ps.site_id = p_site
                      AND (ps.valid_until IS NULL OR ps.valid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date)))
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_santier_drept(bigint) FROM PUBLIC, anon, authenticated, service_role;

-- ── garda pe configurarea țintelor (5A, L07): trigger BEFORE pe OLD/NEW; calea server fără JWT (postgres) e permisă (seed-ul chat-ului) ──
CREATE FUNCTION public.fn_executie_tinte_garda_cere(p_proiecte bigint[]) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    -- doar o sesiune directă a lui postgres (psql / runner); o funcție DEFINER apelată prin API fără JWT are session_user = authenticator
    IF session_user = 'postgres' AND current_user = 'postgres' THEN RETURN; END IF;
    RAISE EXCEPTION 'tinte: configurarea țintelor cere autentificare' USING ERRCODE = '42501';
  END IF;
  FOREACH v IN ARRAY p_proiecte LOOP
    IF NOT public.fn_executie_tinte_drept(v, 'configurare') THEN
      RAISE EXCEPTION 'tinte: țintele (activități principale, obiecte din deviz, perioade de plan) le configurează Execuție editor / admin' USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_garda_cere(bigint[]) FROM PUBLIC, anon, service_role;
-- EXECUTE pentru authenticated: o cheamă trigger-ele, în numele utilizatorului (doar verifică dreptul apelantului; nu întoarce date)
GRANT EXECUTE ON FUNCTION public.fn_executie_tinte_garda_cere(bigint[]) TO authenticated;

CREATE FUNCTION public.fn_executie_tinte_garda_activitati() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_cfg_old boolean := false; v_cfg_new boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_cfg_old := (OLD.principala, OLD.factor_um, OLD.sursa_executat, OLD.baza_deviz, OLD.dn_min, OLD.dn_max)
                 IS DISTINCT FROM (false, 1::numeric, 'raport'::text, 'revizuita'::text, NULL::integer, NULL::integer);
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_cfg_new := (NEW.principala, NEW.factor_um, NEW.sursa_executat, NEW.baza_deviz, NEW.dn_min, NEW.dn_max)
                 IS DISTINCT FROM (false, 1::numeric, 'raport'::text, 'revizuita'::text, NULL::integer, NULL::integer);
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_cfg_new THEN PERFORM public.fn_executie_tinte_garda_cere(ARRAY[NEW.proiect_id::bigint]); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF v_cfg_old THEN PERFORM public.fn_executie_tinte_garda_cere(ARRAY[OLD.proiect_id::bigint]); END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: coloanele țintei sau, pe o activitate cu configurare, ce schimbă ținta (proiect, coduri, UM, tip, activ)
  IF (NEW.principala, NEW.factor_um, NEW.sursa_executat, NEW.baza_deviz, NEW.dn_min, NEW.dn_max)
       IS DISTINCT FROM (OLD.principala, OLD.factor_um, OLD.sursa_executat, OLD.baza_deviz, OLD.dn_min, OLD.dn_max)
     OR ((v_cfg_old OR v_cfg_new)
         AND (NEW.proiect_id, NEW.coduri_deviz, NEW.um, NEW.tip_raportare, NEW.activ)
             IS DISTINCT FROM (OLD.proiect_id, OLD.coduri_deviz, OLD.um, OLD.tip_raportare, OLD.activ)) THEN
    PERFORM public.fn_executie_tinte_garda_cere(ARRAY[OLD.proiect_id::bigint, NEW.proiect_id::bigint]);
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_garda_activitati() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_tinte_garda_activitati BEFORE INSERT OR UPDATE OR DELETE ON public.proiect_activitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_tinte_garda_activitati();

CREATE FUNCTION public.fn_executie_tinte_garda_unitati() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_cfg_old boolean := false; v_cfg_new boolean := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_cfg_old := OLD.obiect_cod IS NOT NULL OR OLD.nod_cod IS NOT NULL OR OLD.plan_start IS NOT NULL OR OLD.plan_final IS NOT NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_cfg_new := NEW.obiect_cod IS NOT NULL OR NEW.nod_cod IS NOT NULL OR NEW.plan_start IS NOT NULL OR NEW.plan_final IS NOT NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_cfg_new THEN PERFORM public.fn_executie_tinte_garda_cere(ARRAY[NEW.proiect_id::bigint]); END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF v_cfg_old THEN PERFORM public.fn_executie_tinte_garda_cere(ARRAY[OLD.proiect_id::bigint]); END IF;
    RETURN OLD;
  END IF;
  IF (NEW.obiect_cod, NEW.nod_cod, NEW.plan_start, NEW.plan_final) IS DISTINCT FROM (OLD.obiect_cod, OLD.nod_cod, OLD.plan_start, OLD.plan_final)
     OR ((v_cfg_old OR v_cfg_new) AND (NEW.proiect_id, NEW.activ) IS DISTINCT FROM (OLD.proiect_id, OLD.activ)) THEN
    PERFORM public.fn_executie_tinte_garda_cere(ARRAY[OLD.proiect_id::bigint, NEW.proiect_id::bigint]);
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_garda_unitati() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_tinte_garda_unitati BEFORE INSERT OR UPDATE OR DELETE ON public.proiect_unitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_tinte_garda_unitati();

-- ── setări: proveniența o pune serverul (L08), proiectul nu se schimbă; RLS pe același drept ──
CREATE FUNCTION public.fn_executie_tinte_setari_prov() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.proiect_id IS DISTINCT FROM OLD.proiect_id THEN
    RAISE EXCEPTION 'tinte: proiectul setărilor nu se schimbă' USING ERRCODE = '23514';
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_setari_prov() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_tinte_setari_prov BEFORE INSERT OR UPDATE ON public.executie_tinte_setari
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_tinte_setari_prov();
ALTER TABLE public.executie_tinte_setari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_tinte_setari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.executie_tinte_setari TO authenticated;
GRANT SELECT ON public.executie_tinte_setari TO service_role;
CREATE POLICY executie_tinte_setari_citire ON public.executie_tinte_setari FOR SELECT TO authenticated
  USING (public.fn_executie_tinte_drept(proiect_id, 'citire'));
CREATE POLICY executie_tinte_setari_adauga ON public.executie_tinte_setari FOR INSERT TO authenticated
  WITH CHECK (public.fn_executie_tinte_drept(proiect_id, 'configurare'));
CREATE POLICY executie_tinte_setari_modifica ON public.executie_tinte_setari FOR UPDATE TO authenticated
  USING (public.fn_executie_tinte_drept(proiect_id, 'configurare')) WITH CHECK (public.fn_executie_tinte_drept(proiect_id, 'configurare'));
CREATE POLICY executie_tinte_setari_sterge ON public.executie_tinte_setari FOR DELETE TO authenticated
  USING (public.fn_executie_tinte_drept(proiect_id, 'configurare'));

-- ── cheia rândului din vedere: unitate × 1e8 + activitate (0 = fără); peste plajă = eroare, nu cheie dublă ──
CREATE FUNCTION public.fn_executie_tinte_cheie(p_unitate bigint, p_activitate bigint) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
BEGIN
  IF coalesce(p_unitate, 0) NOT BETWEEN 0 AND 89999999 OR coalesce(p_activitate, 0) NOT BETWEEN 0 AND 99999999 THEN
    RAISE EXCEPTION 'tinte: id în afara plajei cheii vederii (unitate %, activitate %)', p_unitate, p_activitate USING ERRCODE = '22003';
  END IF;
  RETURN coalesce(p_unitate, 0) * 100000000 + coalesce(p_activitate, 0);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_cheie(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- ── sudurile din schema nodului, pe (unitate cu nod, activitate „schema_nod”), după DN ──
-- „sudată” = aceeași listă ca EXECUTATE din src/nodCuplareLogica.js (testul de paritate citește blocul de mai jos).
-- activitate_id NULL = sudate care nu cad pe nicio activitate „schema_nod” a proiectului (DN lipsă sau fără activitate pe DN).
CREATE FUNCTION public.fn_executie_tinte_nod(p_proiect bigint, p_data date)
RETURNS TABLE (unitate_id bigint, activitate_id bigint, sudate_total integer, sudate_zi integer, ultima_sudare date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
#variable_conflict use_column
BEGIN
  IF NOT public.fn_executie_tinte_drept(p_proiect, 'citire') THEN
    RAISE EXCEPTION 'tinte: proiectul nu există sau nu ai drept de citire' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH u AS (SELECT pu.id::bigint AS id, pu.nod_cod FROM public.proiect_unitati pu WHERE pu.proiect_id = p_proiect AND pu.nod_cod IS NOT NULL),
  a AS (SELECT pa.id::bigint AS id, pa.dn_min, pa.dn_max FROM public.proiect_activitati pa
         WHERE pa.proiect_id = p_proiect AND pa.sursa_executat = 'schema_nod'),
  s AS (SELECT u.id AS uid, ns.id AS sid, ns.dn, ns.data_sudare
          FROM u JOIN public.executie_noduri_suduri ns ON ns.proiect_id = p_proiect AND ns.nod_cod = u.nod_cod
         WHERE ns.stare IN (
           -- EXECUTATE-START
           'sudat', 'ndt', 'acceptat', 'reparat'
           -- EXECUTATE-END
         )),
  m AS (SELECT s.uid, a.id AS aid, s.sid, s.data_sudare FROM s JOIN a
          ON (a.dn_min IS NULL OR s.dn >= a.dn_min) AND (a.dn_max IS NULL OR s.dn <= a.dn_max)),
  ult AS (SELECT s.uid, max(s.data_sudare) AS ultima FROM s GROUP BY s.uid)
  SELECT u.id, a.id, count(m.sid)::integer,
         CASE WHEN p_data IS NULL THEN NULL ELSE (count(m.sid) FILTER (WHERE m.data_sudare = p_data))::integer END,
         ult.ultima
    FROM u CROSS JOIN a
    LEFT JOIN m ON m.uid = u.id AND m.aid = a.id
    LEFT JOIN ult ON ult.uid = u.id
   GROUP BY u.id, a.id, ult.ultima
  UNION ALL
  SELECT s.uid, NULL::bigint, count(*)::integer,
         CASE WHEN p_data IS NULL THEN NULL ELSE (count(*) FILTER (WHERE s.data_sudare = p_data))::integer END,
         max(ult.ultima)
    FROM s LEFT JOIN ult ON ult.uid = s.uid
   WHERE NOT EXISTS (SELECT 1 FROM m WHERE m.sid = s.sid)
   GROUP BY s.uid;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_nod(bigint, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_tinte_nod(bigint, date) TO authenticated;

-- ── conversia UM: articolul din deviz -> UM-ul activității (din teren). Lista albă de UM-uri (punctele și spațiile nu contează):
-- lungime M / ML / HM (100 m) / KM / 100 M; volum MC / M3 / 100 MC / 1000 MC; suprafață MP / M2 / 100 MP / HA; BUC / 100 BUC; KG / T / TO / 100 KG.
-- Aceeași bază = raportul multiplilor; UM nerecunoscute dar identice = 1; altfel NULL (articolul nu se adună: „date incomplete”, L12).
CREATE FUNCTION public.fn_executie_tinte_conversie(p_um_articol text, p_um_activitate text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE
  a text := upper(regexp_replace(coalesce(p_um_articol, ''), '[[:space:].]', '', 'g'));
  t text := upper(regexp_replace(coalesce(p_um_activitate, ''), '[[:space:].]', '', 'g'));
  ma numeric; ba text; mt numeric; bt text;
BEGIN
  SELECT v.m, v.b INTO ma, ba FROM (VALUES
    -- UM-START
    ('M', 1, 'M'), ('ML', 1, 'M'), ('HM', 100, 'M'), ('KM', 1000, 'M'), ('100M', 100, 'M'),
    ('MC', 1, 'MC'), ('M3', 1, 'MC'), ('100MC', 100, 'MC'), ('1000MC', 1000, 'MC'),
    ('MP', 1, 'MP'), ('M2', 1, 'MP'), ('100MP', 100, 'MP'), ('HA', 10000, 'MP'),
    ('BUC', 1, 'BUC'), ('100BUC', 100, 'BUC'), ('KG', 1, 'KG'), ('T', 1000, 'KG'), ('TO', 1000, 'KG'), ('100KG', 100, 'KG')
    -- UM-END
  ) v(u, m, b) WHERE v.u = a;
  SELECT v.m, v.b INTO mt, bt FROM (VALUES
    ('M', 1, 'M'), ('ML', 1, 'M'), ('HM', 100, 'M'), ('KM', 1000, 'M'), ('100M', 100, 'M'),
    ('MC', 1, 'MC'), ('M3', 1, 'MC'), ('100MC', 100, 'MC'), ('1000MC', 1000, 'MC'),
    ('MP', 1, 'MP'), ('M2', 1, 'MP'), ('100MP', 100, 'MP'), ('HA', 10000, 'MP'),
    ('BUC', 1, 'BUC'), ('100BUC', 100, 'BUC'), ('KG', 1, 'KG'), ('T', 1000, 'KG'), ('TO', 1000, 'KG'), ('100KG', 100, 'KG')
  ) v(u, m, b) WHERE v.u = t;
  IF ba IS NOT NULL AND bt IS NOT NULL THEN RETURN CASE WHEN ba = bt THEN ma / mt END; END IF;
  IF ba IS NULL AND bt IS NULL AND a = t THEN RETURN 1; END IF;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_conversie(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── calculul țintelor: UN singur loc (L19). Pentru fiecare proiect pe care apelantul îl poate citi. ──
-- Rânduri: (unitate, activitate) cu articole potrivite în deviz sau cu executat > 0; plus „fără obiect” (linii fără unitate,
-- unitate_id NULL) și „nealocat” (sudate din schemă fără activitate, activitate_id NULL) — nimic nu dispare tacit (L12).
CREATE FUNCTION public.fn_executie_tinte_calcul()
RETURNS TABLE (
  id bigint, proiect_id bigint,
  unitate_id bigint, unitate_cod text, unitate_nume text, unitate_tip text, unitate_ordine numeric, unitate_activa boolean,
  obiect_cod text, nod_cod text, plan_start date, plan_final date,
  activitate_id bigint, activitate_nume text, um text, activitate_ordine numeric, activitate_activa boolean, principala boolean,
  tip_raportare text, sursa_executat text, baza_deviz text, factor_um numeric, coduri_deviz text, dn_min integer, dn_max integer,
  articole integer, articole_incomplete integer,
  din_deviz numeric, executat numeric, executat_sursa text, raport_ignorat numeric,
  rest numeric, peste_deviz numeric, pct_executat numeric, pct_plan numeric, ultima_raportare date,
  alerta_peste_deviz boolean, alerta_in_urma boolean, alerta_fara_raport boolean, alerta_fara_tinta boolean,
  alerta_fara_obiect boolean, alerta_nealocat boolean, alerta_incomplet boolean, alerte text[],
  prag_in_urma_pp numeric, zile_fara_raport integer, calculat_la date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
#variable_conflict use_column
DECLARE v_p bigint; v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'tinte: autentificare necesară' USING ERRCODE = '42501'; END IF;
  FOR v_p IN SELECT e.id FROM public.executie_proiecte e ORDER BY e.id LOOP
    CONTINUE WHEN NOT public.fn_executie_tinte_drept(v_p, 'citire');
    RETURN QUERY
    WITH st AS (SELECT coalesce((SELECT s.prag_in_urma_pp FROM public.executie_tinte_setari s WHERE s.proiect_id = v_p), 15::numeric) AS prag,
                       CASE WHEN EXISTS (SELECT 1 FROM public.executie_tinte_setari s WHERE s.proiect_id = v_p)
                            THEN (SELECT s.zile_fara_raport FROM public.executie_tinte_setari s WHERE s.proiect_id = v_p) ELSE 7 END AS zile),
    u AS (SELECT pu.id::bigint AS id, pu.cod, pu.nume, pu.tip, pu.ordine::numeric AS ordine, pu.activ IS NOT FALSE AS activ,
                 pu.obiect_cod, pu.nod_cod, pu.plan_start, pu.plan_final
            FROM public.proiect_unitati pu WHERE pu.proiect_id = v_p),
    a AS (SELECT pa.id::bigint AS id, pa.nume, pa.um, pa.ordine::numeric AS ordine, pa.activ IS NOT FALSE AS activ, pa.principala,
                 coalesce(pa.tip_raportare, 'cantitate') AS tip, pa.sursa_executat, pa.baza_deviz, pa.factor_um, pa.coduri_deviz, pa.dn_min, pa.dn_max,
                 ARRAY(SELECT DISTINCT upper(btrim(x)) FROM unnest(string_to_array(coalesce(pa.coduri_deviz, ''), ',')) x
                        WHERE btrim(x) <> '') AS prefixe
            FROM public.proiect_activitati pa WHERE pa.proiect_id = v_p),
    -- din deviz: articolele obiectului (sursă pe listă albă) al căror cod începe cu unul din prefixe (un articol se numără o dată),
    -- fiecare convertit din UM-ul lui în UM-ul activității; fără cantitate sau cu UM incompatibil = nu se adună, se numără ca incomplet
    dev AS (SELECT u.id AS uid, a.id AS aid, count(*)::integer AS articole,
                   (count(*) FILTER (WHERE art.cantitate IS NULL OR cv.f IS NULL))::integer AS fara_cant, sum(art.cantitate::numeric * cv.f) AS suma
              FROM u JOIN a ON cardinality(a.prefixe) > 0
              JOIN public.proiect_articole art ON art.proiect_id = v_p AND art.obiect_cod = u.obiect_cod
                   AND (art.sursa = 'contract_initial' OR (a.baza_deviz = 'revizuita' AND art.sursa = 'act_aditional'))
                   AND EXISTS (SELECT 1 FROM unnest(a.prefixe) px WHERE left(upper(coalesce(art.cod, '')), length(px)) = px)
              CROSS JOIN LATERAL (SELECT public.fn_executie_tinte_conversie(art.um, a.um) AS f) cv
             WHERE u.obiect_cod IS NOT NULL
             GROUP BY u.id, a.id),
    -- executat din rapoarte: activitatea dă proiectul; o unitate din alt proiect (date vechi) cade la „fără obiect”
    rap AS (SELECT CASE WHEN rl.unitate_id::bigint IN (SELECT u.id FROM u) THEN rl.unitate_id::bigint END AS uid,
                   rl.activitate_id::bigint AS aid, sum(rl.cantitate::numeric) AS suma, max(rz.data) AS ultima
              FROM public.raport_lucrari rl
              JOIN a ON a.id = rl.activitate_id::bigint
              JOIN public.rapoarte_zilnice rz ON rz.id = rl.raport_id
             GROUP BY 1, 2),
    nod AS (SELECT n.unitate_id AS uid, n.activitate_id AS aid, n.sudate_total AS total, n.ultima_sudare AS ultima
              FROM public.fn_executie_tinte_nod(v_p, NULL) n),
    ult AS (SELECT z.uid, max(z.d) AS ultima
              FROM (SELECT rap.uid, rap.ultima AS d FROM rap UNION ALL SELECT nod.uid, nod.ultima FROM nod) z
             WHERE z.uid IS NOT NULL GROUP BY z.uid),
    per AS (SELECT dev.uid, dev.aid FROM dev
            UNION SELECT rap.uid, rap.aid FROM rap
            UNION SELECT nod.uid, nod.aid FROM nod WHERE nod.total > 0),
    b AS (
      SELECT per.uid, per.aid, u.cod AS u_cod, u.nume AS u_nume, u.tip AS u_tip, u.ordine AS u_ordine, u.activ AS u_activ,
             u.obiect_cod, u.nod_cod, u.plan_start, u.plan_final,
             a.nume AS a_nume, a.um, a.ordine AS a_ordine, a.activ AS a_activ, a.principala, a.tip, a.sursa_executat, a.baza_deviz,
             a.factor_um, a.coduri_deviz, a.dn_min, a.dn_max,
             coalesce(dev.articole, 0) AS articole, coalesce(dev.fara_cant, 0) AS fara_cant,
             CASE WHEN dev.uid IS NULL OR dev.suma IS NULL THEN NULL ELSE round(dev.suma * a.factor_um, 3) END AS din_deviz,
             (per.aid IS NULL OR (a.sursa_executat = 'schema_nod' AND u.nod_cod IS NOT NULL)) AS din_schema,
             coalesce(rap.suma, 0) AS rap_suma, coalesce(nod.total, 0) AS nod_total, ult.ultima,
             (a.tip = 'bifa') AS bifa
        FROM per
        LEFT JOIN u ON u.id = per.uid
        LEFT JOIN a ON a.id = per.aid
        LEFT JOIN dev ON dev.uid = per.uid AND dev.aid = per.aid
        LEFT JOIN rap ON rap.uid IS NOT DISTINCT FROM per.uid AND rap.aid = per.aid
        LEFT JOIN nod ON nod.uid IS NOT DISTINCT FROM per.uid AND nod.aid IS NOT DISTINCT FROM per.aid
        LEFT JOIN ult ON ult.uid = per.uid),
    c AS (
      SELECT b.*,
             CASE WHEN b.din_schema THEN b.nod_total::numeric ELSE b.rap_suma END AS executat,
             CASE WHEN b.din_schema AND b.aid IS NOT NULL THEN b.rap_suma ELSE 0::numeric END AS raport_ignorat,
             CASE WHEN b.plan_start IS NULL THEN NULL
                  WHEN v_azi < b.plan_start THEN 0::numeric
                  WHEN v_azi >= b.plan_final THEN 100::numeric
                  ELSE round((v_azi - b.plan_start + 1)::numeric / (b.plan_final - b.plan_start + 1) * 100, 1) END AS pct_plan
        FROM b),
    d AS (
      SELECT c.*,
             CASE WHEN c.bifa OR c.din_deviz IS NULL THEN NULL ELSE greatest(c.din_deviz - c.executat, 0) END AS rest,
             CASE WHEN c.bifa OR c.din_deviz IS NULL THEN NULL ELSE greatest(c.executat - c.din_deviz, 0) END AS peste,
             CASE WHEN c.aid IS NULL OR c.uid IS NULL THEN NULL
                  WHEN c.bifa THEN CASE WHEN c.executat > 0 THEN 100::numeric ELSE 0::numeric END
                  WHEN c.din_deviz > 0 THEN round(c.executat / c.din_deviz * 100, 1) ELSE NULL END AS pct_exec
        FROM c),
    e AS (
      SELECT d.*,
             (NOT d.bifa AND d.din_deviz > 0 AND d.executat > d.din_deviz) IS TRUE AS al_peste,
             (d.pct_plan IS NOT NULL AND d.pct_exec IS NOT NULL AND d.pct_plan - d.pct_exec > st.prag) IS TRUE AS al_urma,
             (st.zile IS NOT NULL AND d.uid IS NOT NULL AND d.aid IS NOT NULL AND d.u_activ AND d.a_activ
              AND (d.din_deviz > 0 OR d.bifa) AND (d.pct_exec IS NULL OR d.pct_exec < 100)
              AND ((d.plan_start IS NOT NULL AND v_azi BETWEEN d.plan_start AND d.plan_final) OR (d.plan_start IS NULL AND d.ultima IS NOT NULL))
              AND greatest(d.ultima, d.plan_start - 1) <= v_azi - st.zile) IS TRUE AS al_fara_raport,
             (d.uid IS NOT NULL AND d.aid IS NOT NULL AND d.executat > 0 AND (d.din_deviz IS NULL OR d.din_deviz = 0)) IS TRUE AS al_fara_tinta,
             (d.uid IS NULL AND d.executat > 0) IS TRUE AS al_fara_obiect,
             (d.aid IS NULL AND d.executat > 0) IS TRUE AS al_nealocat,
             (d.fara_cant > 0 OR d.raport_ignorat > 0) IS TRUE AS al_incomplet,
             st.prag, st.zile
        FROM d CROSS JOIN st)
    SELECT public.fn_executie_tinte_cheie(e.uid, e.aid), v_p,
           e.uid, e.u_cod::text, e.u_nume::text, e.u_tip::text, e.u_ordine, e.u_activ,
           e.obiect_cod, e.nod_cod, e.plan_start, e.plan_final,
           e.aid, e.a_nume::text, e.um::text, e.a_ordine, e.a_activ, e.principala,
           e.tip::text, e.sursa_executat, e.baza_deviz, e.factor_um, e.coduri_deviz::text, e.dn_min, e.dn_max,
           e.articole, e.fara_cant,
           e.din_deviz, e.executat, CASE WHEN e.din_schema THEN 'schema_nod' ELSE 'raport' END, e.raport_ignorat,
           e.rest, e.peste, e.pct_exec, e.pct_plan, e.ultima,
           e.al_peste, e.al_urma, e.al_fara_raport, e.al_fara_tinta, e.al_fara_obiect, e.al_nealocat, e.al_incomplet,
           array_remove(ARRAY[CASE WHEN e.al_peste THEN 'peste_deviz' END, CASE WHEN e.al_urma THEN 'in_urma' END,
                              CASE WHEN e.al_fara_raport THEN 'fara_raport' END, CASE WHEN e.al_fara_tinta THEN 'fara_tinta' END,
                              CASE WHEN e.al_fara_obiect THEN 'fara_obiect' END, CASE WHEN e.al_nealocat THEN 'nealocat' END,
                              CASE WHEN e.al_incomplet THEN 'incomplet' END], NULL),
           e.prag, e.zile, v_azi
      FROM e;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_tinte_calcul() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_tinte_calcul() TO authenticated;

CREATE VIEW public.v_executie_tinte WITH (security_invoker = on) AS
  SELECT t.* FROM public.fn_executie_tinte_calcul() t;
COMMENT ON VIEW public.v_executie_tinte IS
  'Execuție: deviz vs executat pe (obiect, activitate), cu alertele. Doar proiectele pe care apelantul le poate citi (fn_executie_tinte_drept). 20261208a.';
REVOKE ALL ON public.v_executie_tinte FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_executie_tinte TO authenticated;

-- ── liniile raportului zilnic: amprenta canonică (o singură formulă pentru tabel și pentru setul trimis, L19) ──
-- p = [{activitate_id, unitate_id, cantitate}]; cantitatea fără zerourile de la final (1.50 = 1.5)
CREATE FUNCTION public.fn_raport_lucrari_amprenta_linii(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT md5(coalesce((SELECT string_agg(x.activitate_id::text || ':' || coalesce(x.unitate_id::text, '-') || ':' || trim_scale(x.cantitate)::text, ';'
                                          ORDER BY x.activitate_id, x.unitate_id NULLS FIRST, x.cantitate)
                         FROM jsonb_to_recordset(coalesce(p, '[]'::jsonb)) AS x(activitate_id bigint, unitate_id bigint, cantitate numeric)), ''))
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_lucrari_amprenta_linii(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_raport_lucrari_json(p_raport_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT coalesce(jsonb_agg(jsonb_build_object('activitate_id', l.activitate_id::bigint, 'unitate_id', l.unitate_id::bigint,
                                               'cantitate', l.cantitate::numeric)
                            ORDER BY l.activitate_id, l.unitate_id NULLS FIRST, l.cantitate), '[]'::jsonb)
    FROM public.raport_lucrari l WHERE l.raport_id = p_raport_id
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_lucrari_json(bigint) FROM PUBLIC, anon, authenticated, service_role;

-- ── jurnalul salvărilor raportului zilnic: versiune monotonă pe raport + cheie durabilă per intenție (L01 / L04 / L05) ──
-- Un rând = o salvare reușită (antet + linii, în aceeași tranzacție). Doar RPC-ul scrie; clienții nu au niciun drept pe tabel.
CREATE TABLE public.raport_zilnic_salvari (
  cheie uuid PRIMARY KEY,
  raport_id bigint NOT NULL REFERENCES public.rapoarte_zilnice(id) ON DELETE CASCADE,
  versiune integer NOT NULL,
  amprenta text NOT NULL,
  profile_id uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raport_zilnic_salvari_versiune_ck CHECK (versiune > 0),
  CONSTRAINT raport_zilnic_salvari_amprenta_ck CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  CONSTRAINT raport_zilnic_salvari_versiune_uq UNIQUE (raport_id, versiune)
);
COMMENT ON TABLE public.raport_zilnic_salvari IS
  'Raportul zilnic: o salvare reușită prin fn_raport_zilnic_salveaza (versiunea raportului + cheia intenției + amprenta conținutului). 20261208a.';
ALTER TABLE public.raport_zilnic_salvari ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raport_zilnic_salvari FROM PUBLIC, anon, authenticated, service_role;

-- ── versiunea raportului = pe rândul lui, incrementată de un trigger la ORICE scriere (RPC, telefonul vechi, alte module): orice cale
--    care schimbă antetul intră în CAS (review r2 P1-1). Valoarea o pune serverul, nu clientul (L08). ──
ALTER TABLE public.rapoarte_zilnice ADD COLUMN versiune_salvare integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.rapoarte_zilnice.versiune_salvare IS
  'Versiunea raportului: +1 la fiecare INSERT / UPDATE (trigger trg_raport_zilnic_versiune); CAS-ul din fn_raport_zilnic_salveaza. 20261208a.';
CREATE FUNCTION public.fn_raport_zilnic_versiune() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  NEW.versiune_salvare := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.versiune_salvare + 1 END;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_zilnic_versiune() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_raport_zilnic_versiune BEFORE INSERT OR UPDATE ON public.rapoarte_zilnice
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_zilnic_versiune();

-- citirea raportului unei zile: antetul, liniile și versiunea, din același instantaneu (funcție STABLE = instantaneul apelului)
CREATE FUNCTION public.fn_raport_zilnic_citeste(p_site bigint, p_data date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE r public.rapoarte_zilnice;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'raport: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_site IS NULL OR p_data IS NULL THEN RAISE EXCEPTION 'raport: parametri lipsă' USING ERRCODE = '22023'; END IF;
  IF NOT public.fn_raport_santier_drept(p_site) THEN
    RAISE EXCEPTION 'raport: nu ai drept pe șantier' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.rapoarte_zilnice z WHERE z.site_id = p_site AND z.data = p_data;
  IF NOT FOUND THEN RETURN jsonb_build_object('raport', NULL, 'versiune', 0, 'linii', '[]'::jsonb); END IF;
  RETURN jsonb_build_object('raport', to_jsonb(r),
    'versiune', r.versiune_salvare,
    'linii', public.fn_raport_lucrari_json(r.id));
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_zilnic_citeste(bigint, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_raport_zilnic_citeste(bigint, date) TO authenticated;

-- ── salvarea raportului zilnic: ANTETUL și LINIILE într-o singură tranzacție (L02), CAS pe versiune (L01), cheie per intenție (L04 / L05) ──
-- Ordinea lock-urilor (L06): advisory (șantier, zi) -> rapoarte_zilnice FOR UPDATE -> proiect_activitati FOR SHARE (ORDER BY id) ->
--   proiect_unitati FOR SHARE (ORDER BY id) -> rapoarte_zilnice (upsert pe același rând) -> raport_lucrari (DELETE + INSERT) -> raport_zilnic_salvari.
-- p_antet: doar câmpurile din lista albă (cele scrise de telefon); un câmp lipsă rămâne neschimbat la editare. p_linii NULL = liniile nu se ating.
-- p_versiune: versiunea citită (raport nou = 0). p_cheie: o cheie per intenție, refolosită la reîncercare cu ACELAȘI conținut.
-- Rezultat: {ok, duplicat, raport_id, versiune} sau {ok:false, motiv:'conflict', raport_id, versiune} (altcineva a salvat între timp: reîncarcă).
CREATE FUNCTION public.fn_raport_zilnic_salveaza(p_site bigint, p_data date, p_antet jsonb, p_linii jsonb, p_versiune integer, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_proiect bigint; v_raport bigint; v_ver integer; v_ver_rand integer; v_nou integer; v_amp text; v_s public.raport_zilnic_salvari;
  e jsonb; v_aid bigint; v_unit bigint; v_cant numeric;
  v_canon jsonb; v_chei text[] := ARRAY[]::text[];
  v_act_ids bigint[] := ARRAY[]::bigint[]; v_unit_ids bigint[] := ARRAY[]::bigint[];
  v_tip text; v_sursa text; v_nod text; v_n integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'raport: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_site IS NULL OR p_data IS NULL OR p_cheie IS NULL OR p_versiune IS NULL OR p_versiune < 0
     OR p_antet IS NULL OR jsonb_typeof(p_antet) IS DISTINCT FROM 'object'
     OR (p_linii IS NOT NULL AND (jsonb_typeof(p_linii) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linii) > 500)) THEN
    RAISE EXCEPTION 'raport: parametri invalizi' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_antet) k WHERE k NOT IN (
       -- ANTET-START
       'sef_santier', 'lucrari_efectuate', 'utilaje_snapshot', 'personal_snapshot', 'masini', 'probleme', 'subcontractori',
       'aprovizionare', 'plan_maine', 'poze', 'meteo', 'distributie_antet'
       -- ANTET-END
     )) THEN
    RAISE EXCEPTION 'raport: antetul are un câmp nepermis' USING ERRCODE = '22023';
  END IF;
  IF NOT public.fn_raport_santier_drept(p_site) THEN RAISE EXCEPTION 'raport: nu ai drept pe șantier' USING ERRCODE = '42501'; END IF;
  -- 1. serializarea pe (șantier, zi), și pentru raportul care încă nu există; apoi rândul raportului
  PERFORM pg_advisory_xact_lock(hashtextextended('gazpet.raport_zilnic:' || p_site::text || ':' || p_data::text, 0));
  SELECT r.id, r.versiune_salvare INTO v_raport, v_ver_rand FROM public.rapoarte_zilnice r WHERE r.site_id = p_site AND r.data = p_data FOR UPDATE;
  SELECT s.proiect_id::bigint INTO v_proiect FROM public.sites s WHERE s.id = p_site;
  -- 2. forma liniilor: exact cheile cunoscute, numere JSON (L17), cantitate > 0 cu cel mult 3 zecimale; forma canonică
  IF p_linii IS NOT NULL THEN
    IF jsonb_array_length(p_linii) > 0 AND v_proiect IS NULL THEN
      RAISE EXCEPTION 'raport: șantierul nu e legat de un proiect' USING ERRCODE = '22023';
    END IF;
    v_canon := '[]'::jsonb;
    FOR e IN SELECT x FROM jsonb_array_elements(p_linii) x LOOP
      IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'raport: linie invalidă' USING ERRCODE = '22023'; END IF;
      IF NOT (e ?& ARRAY['activitate_id', 'unitate_id', 'cantitate'])
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('activitate_id', 'unitate_id', 'cantitate')) THEN
        RAISE EXCEPTION 'raport: linie cu alte câmpuri decât activitate_id / unitate_id / cantitate' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(e->'activitate_id') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'cantitate') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e->'unitate_id') NOT IN ('number', 'null') THEN
        RAISE EXCEPTION 'raport: activitate_id / unitate_id / cantitate trebuie să fie numere' USING ERRCODE = '22023';
      END IF;
      IF (e->>'activitate_id')::numeric <> trunc((e->>'activitate_id')::numeric) OR (e->>'activitate_id')::numeric NOT BETWEEN 1 AND 9223372036854775807
         OR (jsonb_typeof(e->'unitate_id') = 'number' AND ((e->>'unitate_id')::numeric <> trunc((e->>'unitate_id')::numeric)
                                                           OR (e->>'unitate_id')::numeric NOT BETWEEN 1 AND 9223372036854775807)) THEN
        RAISE EXCEPTION 'raport: id invalid' USING ERRCODE = '22023';
      END IF;
      v_aid := (e->>'activitate_id')::bigint;
      v_unit := CASE WHEN jsonb_typeof(e->'unitate_id') = 'number' THEN (e->>'unitate_id')::bigint END;
      v_cant := (e->>'cantitate')::numeric;
      IF v_cant <= 0 OR v_cant > 10000000 OR v_cant <> round(v_cant, 3) THEN
        RAISE EXCEPTION 'raport: cantitatea trebuie să fie > 0, cel mult 10.000.000, cu cel mult 3 zecimale' USING ERRCODE = '22023';
      END IF;
      IF (v_aid::text || ':' || coalesce(v_unit::text, '-')) = ANY (v_chei) THEN
        RAISE EXCEPTION 'raport: aceeași activitate apare de două ori pe același obiect' USING ERRCODE = '22023';
      END IF;
      v_chei := v_chei || (v_aid::text || ':' || coalesce(v_unit::text, '-'));
      v_act_ids := v_act_ids || v_aid;
      IF v_unit IS NOT NULL THEN v_unit_ids := v_unit_ids || v_unit; END IF;
      v_canon := v_canon || jsonb_build_array(jsonb_build_object('activitate_id', v_aid, 'unitate_id', v_unit, 'cantitate', v_cant));
    END LOOP;
  END IF;
  v_amp := md5(jsonb_build_object('site', p_site, 'data', p_data, 'antet', p_antet,
                                  'linii', CASE WHEN v_canon IS NULL THEN NULL ELSE public.fn_raport_lucrari_amprenta_linii(v_canon) END)::text);
  -- 3. reluarea aceleiași intenții: aceeași cheie + același conținut = rezultatul de atunci, FĂRĂ a reaplica (și dacă între timp
  --    altcineva a salvat altceva); aceeași cheie cu alt conținut = eroare
  SELECT * INTO v_s FROM public.raport_zilnic_salvari s WHERE s.cheie = p_cheie;
  IF FOUND THEN
    IF v_s.amprenta = v_amp AND v_s.raport_id IS NOT DISTINCT FROM v_raport THEN
      -- versiune_curenta: dacă diferă de versiune, altcineva a salvat după această intenție (clientul nu mai continuă scrierile ei)
      RETURN jsonb_build_object('ok', true, 'duplicat', true, 'raport_id', v_s.raport_id, 'versiune', v_s.versiune,
                                'versiune_curenta', coalesce(v_ver_rand, 0));
    END IF;
    RAISE EXCEPTION 'raport: cheia salvării a fost folosită pentru alt conținut' USING ERRCODE = '22023';
  END IF;
  -- 4. CAS: versiunea văzută de client (raport inexistent = 0); o scriere directă a antetului (orice cale) a schimbat-o deja
  v_ver := coalesce(v_ver_rand, 0);
  IF v_ver <> p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'raport_id', v_raport, 'versiune', v_ver);
  END IF;
  -- 5. activitățile și unitățile atinse: ale proiectului șantierului (L09), blocate în ordinea id-ului (L06)
  IF v_canon IS NOT NULL THEN
    PERFORM 1 FROM public.proiect_activitati pa WHERE pa.id::bigint = ANY (v_act_ids) ORDER BY pa.id FOR SHARE;
    PERFORM 1 FROM public.proiect_unitati pu WHERE pu.id::bigint = ANY (v_unit_ids) ORDER BY pu.id FOR SHARE;
    FOR e IN SELECT x FROM jsonb_array_elements(v_canon) x LOOP
      v_aid := (e->>'activitate_id')::bigint;
      v_unit := CASE WHEN jsonb_typeof(e->'unitate_id') = 'number' THEN (e->>'unitate_id')::bigint END;
      SELECT coalesce(pa.tip_raportare, 'cantitate'), pa.sursa_executat INTO v_tip, v_sursa
        FROM public.proiect_activitati pa WHERE pa.id::bigint = v_aid AND pa.proiect_id::bigint = v_proiect;
      IF NOT FOUND THEN RAISE EXCEPTION 'raport: activitatea % nu e a proiectului raportului', v_aid USING ERRCODE = '22023'; END IF;
      v_nod := NULL;
      IF v_unit IS NOT NULL THEN
        SELECT pu.nod_cod INTO v_nod FROM public.proiect_unitati pu WHERE pu.id = v_unit AND pu.proiect_id::bigint = v_proiect;
        IF NOT FOUND THEN RAISE EXCEPTION 'raport: obiectul % nu e al proiectului raportului', v_unit USING ERRCODE = '22023'; END IF;
      END IF;
      IF v_tip = 'bifa' AND (e->>'cantitate')::numeric <> 1 THEN
        RAISE EXCEPTION 'raport: o activitate cu bifă se raportează cu 1' USING ERRCODE = '22023';
      END IF;
      IF v_sursa = 'schema_nod' AND v_nod IS NOT NULL THEN
        RAISE EXCEPTION 'raport: sudurile nodului se iau din schema nodului, nu din raport' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  -- 6. antetul (aceleași câmpuri ca până acum din telefon; autorul și ora le pune serverul, L08)
  INSERT INTO public.rapoarte_zilnice AS t (site_id, data, sef_santier, lucrari_efectuate, utilaje_snapshot, personal_snapshot, masini, probleme,
                                           subcontractori, aprovizionare, plan_maine, poze, meteo, distributie_antet, created_by, updated_at)
  SELECT p_site, p_data, x.sef_santier, x.lucrari_efectuate, x.utilaje_snapshot, x.personal_snapshot, x.masini, x.probleme,
         x.subcontractori, x.aprovizionare, x.plan_maine, x.poze, x.meteo, x.distributie_antet, v_uid, now()
    FROM jsonb_populate_record(NULL::public.rapoarte_zilnice, p_antet) x
  ON CONFLICT (site_id, data) DO UPDATE SET
    sef_santier = CASE WHEN p_antet ? 'sef_santier' THEN EXCLUDED.sef_santier ELSE t.sef_santier END,
    lucrari_efectuate = CASE WHEN p_antet ? 'lucrari_efectuate' THEN EXCLUDED.lucrari_efectuate ELSE t.lucrari_efectuate END,
    utilaje_snapshot = CASE WHEN p_antet ? 'utilaje_snapshot' THEN EXCLUDED.utilaje_snapshot ELSE t.utilaje_snapshot END,
    personal_snapshot = CASE WHEN p_antet ? 'personal_snapshot' THEN EXCLUDED.personal_snapshot ELSE t.personal_snapshot END,
    masini = CASE WHEN p_antet ? 'masini' THEN EXCLUDED.masini ELSE t.masini END,
    probleme = CASE WHEN p_antet ? 'probleme' THEN EXCLUDED.probleme ELSE t.probleme END,
    subcontractori = CASE WHEN p_antet ? 'subcontractori' THEN EXCLUDED.subcontractori ELSE t.subcontractori END,
    aprovizionare = CASE WHEN p_antet ? 'aprovizionare' THEN EXCLUDED.aprovizionare ELSE t.aprovizionare END,
    plan_maine = CASE WHEN p_antet ? 'plan_maine' THEN EXCLUDED.plan_maine ELSE t.plan_maine END,
    poze = CASE WHEN p_antet ? 'poze' THEN EXCLUDED.poze ELSE t.poze END,
    meteo = CASE WHEN p_antet ? 'meteo' THEN EXCLUDED.meteo ELSE t.meteo END,
    distributie_antet = CASE WHEN p_antet ? 'distributie_antet' THEN EXCLUDED.distributie_antet ELSE t.distributie_antet END,
    created_by = EXCLUDED.created_by, updated_at = EXCLUDED.updated_at
  RETURNING t.id, t.versiune_salvare INTO v_raport, v_nou;
  -- 7. liniile: înlocuire (proiectul liniei = proiectul șantierului, pus de server, L08)
  IF v_canon IS NOT NULL THEN
    DELETE FROM public.raport_lucrari WHERE raport_id = v_raport;
    INSERT INTO public.raport_lucrari (raport_id, proiect_id, activitate_id, unitate_id, cantitate)
    SELECT v_raport, v_proiect, x.activitate_id, x.unitate_id, x.cantitate
      FROM jsonb_to_recordset(v_canon) AS x(activitate_id bigint, unitate_id bigint, cantitate numeric);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> jsonb_array_length(v_canon)
       OR public.fn_raport_lucrari_amprenta_linii(public.fn_raport_lucrari_json(v_raport)) IS DISTINCT FROM public.fn_raport_lucrari_amprenta_linii(v_canon) THEN
      RAISE EXCEPTION 'raport: liniile scrise nu corespund setului trimis' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- 8. jurnalul: versiunea nouă (din trigger) + cheia intenției (UNIQUE pe versiune = o a doua scriere cu aceeași versiune e refuzată, nu pierdută)
  INSERT INTO public.raport_zilnic_salvari (cheie, raport_id, versiune, amprenta, profile_id) VALUES (p_cheie, v_raport, v_nou, v_amp, v_uid);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'raport_id', v_raport, 'versiune', v_nou);
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, integer, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, integer, uuid) TO authenticated;

-- ── postcondiții ──
DO $post$
DECLARE v_set oid := 'public.executie_tinte_setari'::regclass; v_jur oid := 'public.raport_zilnic_salvari'::regclass;
  v_fn name[] := ARRAY['fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_garda_activitati',
    'fn_executie_tinte_garda_unitati', 'fn_executie_tinte_setari_prov', 'fn_executie_tinte_cheie', 'fn_executie_tinte_nod', 'fn_executie_tinte_conversie',
    'fn_executie_tinte_calcul', 'fn_raport_lucrari_amprenta_linii', 'fn_raport_lucrari_json', 'fn_raport_zilnic_citeste', 'fn_raport_zilnic_salveaza', 'fn_raport_zilnic_versiune']::name[];
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_set) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_tinte_setari') <> 4
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_tinte_setari' AND roles = '{authenticated}'
           AND permissive = 'PERMISSIVE' AND policyname IN ('executie_tinte_setari_citire', 'executie_tinte_setari_adauga',
                                                            'executie_tinte_setari_modifica', 'executie_tinte_setari_sterge')) <> 4
     OR (SELECT relrowsecurity FROM pg_class WHERE oid = v_jur) IS NOT TRUE
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'raport_zilnic_salvari') THEN
    RAISE EXCEPTION '20261208a post: RLS / politicile setarilor si ale jurnalului';
  END IF;
  IF has_table_privilege('anon', v_set, 'SELECT') OR has_table_privilege('anon', v_set, 'INSERT')
     OR NOT has_table_privilege('authenticated', v_set, 'SELECT') OR NOT has_table_privilege('authenticated', v_set, 'INSERT')
     OR NOT has_table_privilege('authenticated', v_set, 'UPDATE') OR NOT has_table_privilege('authenticated', v_set, 'DELETE')
     OR has_table_privilege('authenticated', v_set, 'TRUNCATE') OR has_table_privilege('service_role', v_set, 'INSERT')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                 WHERE has_table_privilege(r, v_jur, p))
     OR has_table_privilege('anon', 'public.v_executie_tinte', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.v_executie_tinte', 'SELECT')
     OR has_table_privilege('service_role', 'public.v_executie_tinte', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_executie_tinte'::regclass AND 'security_invoker=on' = ANY (reloptions)) THEN
    RAISE EXCEPTION '20261208a post: privilegii pe setari / jurnal / vedere';
  END IF;
  -- funcțiile: search_path fix; DEFINER doar unde trebuie; EXECUTE doar pentru authenticated la cele apelabile din aplicație
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = ANY (v_fn)
                AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                     OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_tinte_drept', 'fn_raport_santier_drept', 'fn_executie_tinte_nod',
                                                                    'fn_executie_tinte_calcul', 'fn_raport_zilnic_citeste', 'fn_raport_zilnic_salveaza'))
                     OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                        IS DISTINCT FROM (p.proname IN ('fn_executie_tinte_drept', 'fn_executie_tinte_garda_cere', 'fn_executie_tinte_nod',
                                                        'fn_executie_tinte_calcul', 'fn_raport_zilnic_citeste', 'fn_raport_zilnic_salveaza'))))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY (v_fn)) <> 15 THEN
    RAISE EXCEPTION '20261208a post: functii (definer / search_path / EXECUTE)';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND (tgrelid, tgname) IN (
        ('public.proiect_activitati'::regclass, 'trg_executie_tinte_garda_activitati'),
        ('public.proiect_unitati'::regclass, 'trg_executie_tinte_garda_unitati'),
        ('public.executie_tinte_setari'::regclass, 'trg_executie_tinte_setari_prov'),
        ('public.rapoarte_zilnice'::regclass, 'trg_raport_zilnic_versiune'))) <> 4 THEN
    RAISE EXCEPTION '20261208a post: trigger-ele';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_tinte_setari) OR EXISTS (SELECT 1 FROM public.raport_zilnic_salvari)
     OR EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE versiune_salvare <> 0)
     OR EXISTS (SELECT 1 FROM public.proiect_unitati WHERE obiect_cod IS NOT NULL OR nod_cod IS NOT NULL OR plan_start IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.proiect_activitati WHERE principala OR factor_um <> 1 OR sursa_executat <> 'raport' OR baza_deviz <> 'revizuita'
                                                           OR dn_min IS NOT NULL OR dn_max IS NOT NULL) THEN
    RAISE EXCEPTION '20261208a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261208a_executie_devize_tinte:' || txid_current() THEN
    RAISE EXCEPTION '20261208a: garda final invalida';
  END IF;
END $post$;
