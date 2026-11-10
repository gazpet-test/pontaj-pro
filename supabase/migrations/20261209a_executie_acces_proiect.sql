-- Version 20261209120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261209a_executie_acces_proiect — Execuție: acces pe PROIECT (decizia lui Răzvan, 10.11.2026). Un șef de șantier vede și scrie în Execuție
-- doar proiectele lui (ex. Lot 1 + Lot 2), lista se extinde ulterior.
--
-- Regula (o singură definiție, L19):
--   * cont FĂRĂ niciun rând în executie_acces_proiect = ca azi (vede / scrie ce îi dă modulul);
--   * cont CU cel puțin un rând = doar proiectele listate; nivel 'viewer' = doar citire pe acel proiect, 'editor' = citire + scriere
--     (în limita dreptului pe modul: un 'editor' pe proiect cu modulul 'viewer' tot nu scrie);
--   * owner (profiles.is_owner) = tot, indiferent de rânduri.
--   Funcțiile: fn_executie_acces_nerestrans() (cont fără restricție sau owner), fn_executie_acces_lista(scriere) (proiectele permise),
--   fn_executie_proiect_permis(proiect, scriere) = nerestrans OR proiect în listă. Politicile folosesc primele două în forma
--   „(SELECT …)” (o evaluare pe interogare, nu pe rând); permis() e aceeași regulă, pentru RPC-uri, trigger-e și UI.
--
-- Ce face:
--   1. Tabel nou executie_acces_proiect (profile_id, proiect_id, nivel, acordat_de, acordat_la), PK (profile_id, proiect_id).
--      Scrierea DOAR prin fn_executie_acces_proiect_seteaza (owner, lista completă a unui cont, CAS pe lista văzută, lock pe cont).
--      Citire: owner tot, ceilalți doar rândurile proprii. FK pe proiect = RESTRICT: ștergerea proiectului nu poate goli tacit
--      lista unui cont (lista goală = „vede tot”).
--   2. Tabelele vechi ale Execuției (create direct în BD, politicile lor nu sunt în repo): pe fiecare, 4 politici RESTRICTIVE
--      (se adună cu AND peste ce există, fără să le atingă) + un trigger BEFORE INSERT/UPDATE/DELETE care refuză scrierea pe un proiect
--      nepermis pe ORICE cale (REST direct, RPC SECURITY DEFINER vechi — fn_bon_salveaza / fn_bon_preia / fn_completare_aplica /
--      fn_probe_completeaza_executie — și reparentarea unui rând pe alt proiect). Lista: v_tabele / v_copii de mai jos.
--   3. Tabelele noi (20261201a–20261208a) au deja o funcție de drept folosită de RLS, RPC-uri și Storage: i se adaugă condiția de
--      proiect (CREATE OR REPLACE, aceeași semnătură, același owner / ACL). Amprentele vechi sunt verificate înainte (L15):
--        fn_executie_nod_drept      (20261201a) 144649bae9a218b41b7e6df90cba5d9e — noduri_suduri, noduri_constructii, probe pe tronsoane, bucket noduri-scheme
--        fn_executie_contract_drept (20261203a) 85a131c3aa59813b1a8cb8535c53e703 — contract_repere + evenimente
--        fn_executie_grafic_drept   (20261204a) 1dbaedfd117f7234a6e30fdaf856ac7b — graficul importat
--        fn_executie_tinte_drept    (20261208a) bda0b6c3e01a5a039732b2713df8ebab — v_executie_tinte, setări, trigger-ele de țintă
-- Ce NU face: nicio dată (niciun cont nu e restrâns după migrare: comportamentul rămâne exact cel de azi până când owner-ul bifează),
--   niciun drept pe modul, nimic pe Izometrie (izo_* are atribuirea ei pe proiect), pe rapoartele zilnice (raport_lucrari / rapoarte_zilnice,
--   pe șantier), pe modulele vecine (comenzi, logistică, facturi, polițe) și pe bucket-urile vechi (executie-contracte etc.).
--   Lista completă acoperit / neacoperit e în descrierea PR-ului.
-- Calea server fără JWT (cron, chat-ul prin psql, edge cu service_role): restricția e pe CONT; fără auth.uid() trigger-ul nu se amestecă
--   (comportamentul de azi), iar service_role are BYPASSRLS ca și până acum.
-- Ordinea lock-urilor (L06): RPC-ul de setare ia (1) lock consultativ pe cont, (2) FOR KEY SHARE pe rândul profilului, (3) rândurile contului
--   din executie_acces_proiect (DELETE apoi INSERT … ON CONFLICT, ORDER BY proiect_id). Trigger-ele de gardă nu blochează nimic.
-- DEPENDENȚĂ: se aplică DUPĂ 20261201a, 20261203a, 20261204a, 20261208a (verificat mai jos). Revenirile acelor migrări (sau preflight-urile
--   20261202a / 20261207a, dacă nu sunt încă aplicate) verifică amprenta veche a lui fn_executie_nod_drept: întâi revenirea ACESTEIA.
-- Revenire: supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql. Test pe clonă: scripts/test_executie_acces_proiect.sql.
DO $pre$
DECLARE
  r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261209a_executie_acces_proiect:' || txid_current() THEN
    RAISE EXCEPTION '20261209a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261209a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.executie_acces_proiect') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis'))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'executie\_acces\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_executie_acces_garda') THEN
    RAISE EXCEPTION '20261209a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele de bază
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'uuid'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype IN ('p', 'u')
                     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION '20261209a: dependentele (executie_proiecte.id bigint, profiles.id uuid unic, profiles.is_owner, user_module_access, auth.uid) difera';
  END IF;
  -- L15: funcțiile de drept ale tabelelor noi, exact cum le-au lăsat migrările lor (corp fără CR, DEFINER, search_path, owner, EXECUTE)
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '144649bae9a218b41b7e6df90cba5d9e', true),
               ('public.fn_executie_contract_drept(bigint, boolean)', '85a131c3aa59813b1a8cb8535c53e703', true),
               ('public.fn_executie_grafic_drept(bigint)', '1dbaedfd117f7234a6e30fdaf856ac7b', true),
               ('public.fn_executie_tinte_drept(bigint, text)', 'bda0b6c3e01a5a039732b2713df8ebab', false)) a(semnatura, amprenta, cu_service)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL
                 OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
                 OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
                 OR p.prosecdef IS NOT TRUE
                 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR p.prorettype IS DISTINCT FROM 'boolean'::regtype::oid
                 OR p.provolatile IS DISTINCT FROM 's'
                 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                 OR has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_service) THEN
    RAISE EXCEPTION '20261209a: functiile de drept (20261201a / 20261203a / 20261204a / 20261208a) lipsesc sau difera de amprenta revizuita: aplica-le intai / verifica';
  END IF;
  -- tabelele vechi acoperite: există, tabel obișnuit, coloana de proiect întreagă, RLS PORNIT (o politică RESTRICTIVE pe un tabel fără RLS
  -- nu face nimic — refuz în loc de o restricție falsă, L07)
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id'), ('executie_tronsoane', 'proiect_id'), ('executie_documente_contract', 'proiect_id'),
      ('executie_acte_aditionale', 'proiect_id'), ('executie_ordine_sistare', 'proiect_id'), ('executie_ordine_detectate', 'proiect_id'),
      ('executie_completari_propuse', 'proiect_id'), ('executie_faze_determinante', 'proiect_id'), ('executie_probe_presiune', 'proiect_id'),
      ('executie_situatii_plata', 'proiect_id'), ('executie_bonuri_consum', 'proiect_id'), ('executie_alocari_personal', 'proiect_id'),
      ('executie_ture', 'proiect_id'), ('executie_tura_subcontractori', 'proiect_id'), ('executie_tura_activitati', 'proiect_id'),
      ('executie_tura_naveta', 'proiect_id'), ('proiect_unitati', 'proiect_id'), ('proiect_activitati', 'proiect_id'),
      ('proiect_articole', 'proiect_id'),
      ('executie_situatii_plata_linii', 'sl_id'), ('executie_sl_ajustari', 'sl_id'), ('executie_bonuri_consum_linii', 'bon_id')) t(tabel, coloana)
  LOOP
    IF to_regclass('public.' || r.tabel) IS NULL
       OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.' || r.tabel)) IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION '20261209a: tabelul % lipseste sau nu e tabel obisnuit', r.tabel;
    END IF;
    SELECT format_type(atttypid, atttypmod) INTO v_tip FROM pg_attribute
     WHERE attrelid = to_regclass('public.' || r.tabel) AND attname = r.coloana AND attnum > 0 AND NOT attisdropped;
    IF v_tip IS NULL OR v_tip NOT IN ('bigint', 'integer') THEN
      RAISE EXCEPTION '20261209a: %.% lipseste sau nu e intreg (%)', r.tabel, r.coloana, coalesce(v_tip, 'lipsa');
    END IF;
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || r.tabel)) IS NOT TRUE THEN
      RAISE EXCEPTION '20261209a: % nu are RLS pornit (restrictia ar fi falsa)', r.tabel;
    END IF;
  END LOOP;
  -- părinții copiilor: id întreg + proiect_id întreg
  IF coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_situatii_plata'::regclass AND attname = 'id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer')
     OR coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_bonuri_consum'::regclass AND attname = 'id' AND NOT attisdropped), '') NOT IN ('bigint', 'integer') THEN
    RAISE EXCEPTION '20261209a: id-ul situatiilor de plata / bonurilor nu e intreg';
  END IF;
  -- vederile citite de Execuție: trebuie să citească drept utilizatorul (security_invoker), altfel ocolesc politicile (L07).
  -- Una care lipsește nu oprește migrarea (NOTICE); una „definer” o oprește.
  FOR r IN SELECT v.nume, c.oid, c.reloptions FROM unnest(ARRAY['v_executie_dashboard', 'v_executie_alocari', 'v_executie_alocari_conflicte',
                                                               'v_sl_fara_factura', 'v_contract_efecte_acte', 'v_executie_tinte']) v(nume)
                                     LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || v.nume)
  LOOP
    IF r.oid IS NULL THEN
      RAISE NOTICE '20261209a: vederea % nu exista (nimic de verificat)', r.nume;
    ELSIF NOT EXISTS (SELECT 1 FROM unnest(coalesce(r.reloptions, '{}'::text[])) o
                       WHERE lower(o) IN ('security_invoker=on', 'security_invoker=true', 'security_invoker=1', 'security_invoker=yes')) THEN
      RAISE EXCEPTION '20261209a: vederea % nu e security_invoker: ar arata tuturor toate proiectele', r.nume;
    END IF;
  END LOOP;
  -- informativ, pentru dry-run: alte vederi care citesc direct tabelele acoperite și NU sunt security_invoker (de verificat de om)
  FOR r IN SELECT DISTINCT vc.relname AS vedere
             FROM pg_rewrite rw JOIN pg_class vc ON vc.oid = rw.ev_class AND vc.relkind IN ('v', 'm')
             JOIN pg_namespace vn ON vn.oid = vc.relnamespace AND vn.nspname = 'public'
             JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass
             JOIN pg_class tc ON tc.oid = d.refobjid AND tc.relnamespace = 'public'::regnamespace
            WHERE tc.relname IN ('executie_proiecte', 'executie_tronsoane', 'executie_documente_contract', 'executie_acte_aditionale',
                                 'executie_ordine_sistare', 'executie_ordine_detectate', 'executie_completari_propuse', 'executie_faze_determinante',
                                 'executie_probe_presiune', 'executie_situatii_plata', 'executie_bonuri_consum', 'executie_alocari_personal',
                                 'executie_ture', 'executie_tura_subcontractori', 'executie_tura_activitati', 'executie_tura_naveta',
                                 'proiect_unitati', 'proiect_activitati', 'proiect_articole', 'executie_situatii_plata_linii',
                                 'executie_sl_ajustari', 'executie_bonuri_consum_linii')
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(vc.reloptions, '{}'::text[])) o
                               WHERE lower(o) IN ('security_invoker=on', 'security_invoker=true', 'security_invoker=1', 'security_invoker=yes'))
            ORDER BY 1
  LOOP
    RAISE NOTICE '20261209a: vedere fara security_invoker peste tabele acoperite (de verificat): %', r.vedere;
  END LOOP;
END $pre$;

-- ── 1. tabelul ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.executie_acces_proiect (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id) ON DELETE RESTRICT,
  nivel text NOT NULL DEFAULT 'editor',
  acordat_de uuid,
  acordat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_acces_proiect_pk PRIMARY KEY (profile_id, proiect_id),
  CONSTRAINT executie_acces_proiect_nivel_ck CHECK (nivel IN ('viewer', 'editor'))
);
CREATE INDEX executie_acces_proiect_proiect_idx ON public.executie_acces_proiect (proiect_id);
COMMENT ON TABLE public.executie_acces_proiect IS
  'Execuție: proiectele unui cont restrâns. Cont fără rânduri = vede tot ce îi dă modulul; cu rânduri = doar acestea; owner = tot. '
  'Se scrie DOAR prin fn_executie_acces_proiect_seteaza (owner). 20261209a.';
COMMENT ON COLUMN public.executie_acces_proiect.nivel IS 'viewer = doar citire pe proiect; editor = citire + scriere (în limita dreptului pe modulul executie).';

-- proveniența (L08): acordat_de / acordat_la le pune serverul; identitatea rândului e imuabilă
CREATE FUNCTION public.fn_executie_acces_proiect_prov() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.profile_id, NEW.proiect_id) IS DISTINCT FROM (OLD.profile_id, OLD.proiect_id) THEN
    RAISE EXCEPTION 'acces proiect: contul și proiectul rândului nu se schimbă' USING ERRCODE = '23514';
  END IF;
  NEW.acordat_de := auth.uid();
  NEW.acordat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_proiect_prov() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_acces_proiect_prov BEFORE INSERT OR UPDATE ON public.executie_acces_proiect
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_proiect_prov();

-- ── 2. regula: O SINGURĂ definiție (L19) ──────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_executie_acces_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
$f$;
-- adevărat = apelantul NU e restrâns pe proiect (owner sau cont fără niciun rând). Fără auth.uid() = fals (L08).
CREATE FUNCTION public.fn_executie_acces_nerestrans() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a WHERE a.profile_id = auth.uid()))
$f$;
-- proiectele listate pentru apelant (scriere = doar cele 'editor'); gol = niciunul (NU „toate”: „toate” e doar nerestrans())
CREATE FUNCTION public.fn_executie_acces_lista(p_scriere boolean) RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(array_agg(a.proiect_id ORDER BY a.proiect_id), '{}'::bigint[])
    FROM public.executie_acces_proiect a
   WHERE auth.uid() IS NOT NULL AND p_scriere IS NOT NULL AND a.profile_id = auth.uid()
     AND (p_scriere IS FALSE OR a.nivel = 'editor')
$f$;
-- regula pe un proiect: pentru RPC-uri, trigger-e, funcțiile de drept și UI
CREATE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_scriere IS NOT NULL
    AND (public.fn_executie_acces_nerestrans()
         OR (p_proiect IS NOT NULL AND p_proiect = ANY (public.fn_executie_acces_lista(p_scriere))))
$f$;
-- copiii fără proiect_id: proiectul vine din părinte (citit ca proprietar, ca să nu depindă de politicile părintelui)
CREATE FUNCTION public.fn_executie_acces_sl_permis(p_sl bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_proiect_permis((SELECT s.proiect_id::bigint FROM public.executie_situatii_plata s WHERE s.id = p_sl), p_scriere)
$f$;
CREATE FUNCTION public.fn_executie_acces_bon_permis(p_bon bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT public.fn_executie_proiect_permis((SELECT b.proiect_id::bigint FROM public.executie_bonuri_consum b WHERE b.id = p_bon), p_scriere)
$f$;
-- EXECUTE: authenticated (politicile se evaluează în numele apelantului; UI-ul întreabă permis()); nimic pentru anon
REVOKE ALL ON FUNCTION public.fn_executie_acces_e_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_nerestrans() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_lista(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_proiect_permis(bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_sl_permis(bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_bon_permis(bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_e_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_nerestrans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_proiect_permis(bigint, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_sl_permis(bigint, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_bon_permis(bigint, boolean) TO authenticated;

-- RLS pe tabelul nou: owner vede tot, ceilalți doar rândurile proprii (ca UI-ul să știe ce i s-a dat); fără scriere directă (L07)
ALTER TABLE public.executie_acces_proiect ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_acces_proiect FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_acces_proiect TO authenticated, service_role;
CREATE POLICY executie_acces_proiect_citire ON public.executie_acces_proiect FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (profile_id = (SELECT auth.uid()) OR (SELECT public.fn_executie_acces_e_owner())));

-- ── 3. setarea (owner): lista COMPLETĂ a unui cont, într-un singur pas (L01, L02, L03, L04, L08, L18) ─────────────
-- p_lista = [{"proiect_id": <id>, "nivel": "viewer"|"editor"}, …]: validată strict, fără dubluri, 1..500 elemente.
-- Canonicul: aceeași formă, sortată după proiect_id. Folosit pentru CAS (lista văzută de owner) și pentru idempotență.
CREATE FUNCTION public.fn_executie_acces_canon(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE e jsonb; v_ids bigint[] := ARRAY[]::bigint[]; v_out jsonb := '[]'::jsonb; v_id bigint;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN
    RAISE EXCEPTION 'acces proiect: lista trebuie să fie un tablou' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p) > 500 THEN RAISE EXCEPTION 'acces proiect: cel mult 500 de proiecte' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p) x LOOP
    -- pași separați: tipul, cheile, apoi valorile (fără să ne bazăm pe ordinea de evaluare a unui OR)
    IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'acces proiect: element invalid' USING ERRCODE = '22023'; END IF;
    IF NOT (e ?& ARRAY['proiect_id', 'nivel']) OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('proiect_id', 'nivel')) THEN
      RAISE EXCEPTION 'acces proiect: elementul cere exact proiect_id și nivel' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(e->'proiect_id') <> 'number' OR (e->>'proiect_id') !~ '^[1-9][0-9]{0,17}$'
       OR jsonb_typeof(e->'nivel') <> 'string' OR (e->>'nivel') NOT IN ('viewer', 'editor') THEN
      RAISE EXCEPTION 'acces proiect: proiect_id întreg pozitiv și nivel viewer / editor' USING ERRCODE = '22023';
    END IF;
    v_id := (e->>'proiect_id')::bigint;
    IF v_id = ANY (v_ids) THEN RAISE EXCEPTION 'acces proiect: proiectul % apare de două ori', v_id USING ERRCODE = '22023'; END IF;
    v_ids := v_ids || v_id;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', (x->>'proiect_id')::bigint, 'nivel', x->>'nivel') ORDER BY (x->>'proiect_id')::bigint), '[]'::jsonb)
    INTO v_out FROM jsonb_array_elements(p) x;
  RETURN v_out;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_canon(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Rezultat: {ok:true, duplicat, lista} sau {ok:false, motiv:'conflict', lista} (lista s-a schimbat între timp: UI-ul reîncarcă).
-- p_restrans = false scoate restricția (șterge toate rândurile contului = „vede tot”): doar explicit, cu p_lista = [].
-- p_restrans = true cu listă goală = REFUZ (ar însemna „vede tot” pe tăcute, L18).
CREATE FUNCTION public.fn_executie_acces_proiect_seteaza(p_profile uuid, p_restrans boolean, p_lista jsonb, p_lista_veche jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_tinta jsonb; v_veche jsonb; v_curent jsonb;
  v_lipsa bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'acces proiect: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF NOT public.fn_executie_acces_e_owner() THEN
    RAISE EXCEPTION 'acces proiect: doar owner-ul stabilește proiectele unui cont' USING ERRCODE = '42501';
  END IF;
  IF p_profile IS NULL OR p_restrans IS NULL THEN RAISE EXCEPTION 'acces proiect: parametri lipsă' USING ERRCODE = '22023'; END IF;
  -- validarea înaintea lock-urilor (nu ține nimic blocat pe o cerere greșită)
  v_tinta := public.fn_executie_acces_canon(p_lista);
  v_veche := public.fn_executie_acces_canon(p_lista_veche);
  IF p_restrans AND jsonb_array_length(v_tinta) = 0 THEN
    RAISE EXCEPTION 'acces proiect: lista goală ar da acces la TOATE proiectele; pentru asta folosește „scoate restricția”' USING ERRCODE = '22023';
  END IF;
  IF NOT p_restrans AND jsonb_array_length(v_tinta) <> 0 THEN
    RAISE EXCEPTION 'acces proiect: „scoate restricția” nu primește proiecte' USING ERRCODE = '22023';
  END IF;
  -- (1) lock pe cont, (2) rândul profilului (nu dispare în timpul scrierii), (3) rândurile contului
  PERFORM pg_advisory_xact_lock(hashtextextended('executie_acces_proiect:' || p_profile::text, 0));
  -- rândul altui modul (profiles): KEY SHARE (același lock pe care l-ar lua FK-ul la INSERT), NOWAIT: ocupat = 55P03, nimic scris
  SELECT p.is_owner INTO v_owner FROM public.profiles p WHERE p.id = p_profile FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'acces proiect: contul nu există' USING ERRCODE = '22023'; END IF;
  IF v_owner IS TRUE AND p_restrans THEN
    RAISE EXCEPTION 'acces proiect: un owner vede oricum toate proiectele' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_lipsa FROM (SELECT (e->>'proiect_id')::bigint AS x FROM jsonb_array_elements(v_tinta) e) t
   WHERE NOT EXISTS (SELECT 1 FROM public.executie_proiecte ep WHERE ep.id = t.x) LIMIT 1;
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'acces proiect: proiectul % nu există', v_lipsa USING ERRCODE = '22023'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', a.proiect_id, 'nivel', a.nivel) ORDER BY a.proiect_id), '[]'::jsonb)
    INTO v_curent FROM public.executie_acces_proiect a WHERE a.profile_id = p_profile;
  -- idempotență (L04): starea cerută există deja = succesul de data trecută (și la reluarea aceleiași cereri)
  IF v_curent = v_tinta THEN
    RETURN jsonb_build_object('ok', true, 'duplicat', true, 'lista', v_curent);
  END IF;
  -- CAS (L01/L03): owner-ul a pornit de la altă listă decât cea de acum = conflict, nu suprascriere
  IF v_curent IS DISTINCT FROM v_veche THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'lista', v_curent);
  END IF;

  DELETE FROM public.executie_acces_proiect a
   WHERE a.profile_id = p_profile
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_tinta) e WHERE (e->>'proiect_id')::bigint = a.proiect_id);
  INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel)
  SELECT p_profile, (e->>'proiect_id')::bigint, e->>'nivel' FROM jsonb_array_elements(v_tinta) e ORDER BY (e->>'proiect_id')::bigint
  ON CONFLICT (profile_id, proiect_id) DO UPDATE SET nivel = EXCLUDED.nivel
   WHERE public.executie_acces_proiect.nivel IS DISTINCT FROM EXCLUDED.nivel;

  SELECT coalesce(jsonb_agg(jsonb_build_object('proiect_id', a.proiect_id, 'nivel', a.nivel) ORDER BY a.proiect_id), '[]'::jsonb)
    INTO v_curent FROM public.executie_acces_proiect a WHERE a.profile_id = p_profile;
  IF v_curent IS DISTINCT FROM v_tinta THEN
    RAISE EXCEPTION 'acces proiect: scrierea nu a dat lista cerută' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'lista', v_curent);
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_proiect_seteaza(uuid, boolean, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_acces_proiect_seteaza(uuid, boolean, jsonb, jsonb) TO authenticated;

-- ── 4. garda de scriere pe tabelele vechi: trigger BEFORE pe OLD / NEW (L07) ──────────────────────────────────
-- Argumentul trigger-ului = numele coloanei de proiect. UPDATE verifică ȘI proiectul vechi, ȘI pe cel nou (mutarea pe alt proiect).
CREATE FUNCTION public.fn_executie_acces_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_vechi bigint; v_nou bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    -- calea server (fără JWT): comportamentul de azi; restricția e pe cont
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_NARGS <> 1 THEN RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_vechi := (to_jsonb(OLD) ->> TG_ARGV[0])::bigint;
    IF NOT public.fn_executie_proiect_permis(v_vechi, true) THEN
      RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_nou := (to_jsonb(NEW) ->> TG_ARGV[0])::bigint;
    IF NOT public.fn_executie_proiect_permis(v_nou, true) THEN
      RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $f$;
-- copiii: părintele se citește prin funcțiile DEFINER de mai sus (argumentul: 'sl' sau 'bon' + coloana)
CREATE FUNCTION public.fn_executie_acces_garda_copil() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_parinte bigint; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_NARGS <> 2 OR TG_ARGV[0] NOT IN ('sl', 'bon') THEN RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_parinte := (to_jsonb(OLD) ->> TG_ARGV[1])::bigint;
    v_ok := CASE TG_ARGV[0] WHEN 'sl' THEN public.fn_executie_acces_sl_permis(v_parinte, true)
                            ELSE public.fn_executie_acces_bon_permis(v_parinte, true) END;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501'; END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    v_parinte := (to_jsonb(NEW) ->> TG_ARGV[1])::bigint;
    v_ok := CASE TG_ARGV[0] WHEN 'sl' THEN public.fn_executie_acces_sl_permis(v_parinte, true)
                            ELSE public.fn_executie_acces_bon_permis(v_parinte, true) END;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'Execuție: nu ai drept de scriere pe acest proiect' USING ERRCODE = '42501'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_acces_garda() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_executie_acces_garda_copil() FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. politicile RESTRICTIVE + trigger-ele, pe lista fixă (aceeași ca în preflight; postcondiția le numără) ──────────────
-- Forma „(SELECT …)” = o singură evaluare pe interogare (initplan), nu pe rând.
DO $pol$
DECLARE r record; v_cit text; v_scr text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('executie_proiecte', 'id'), ('executie_tronsoane', 'proiect_id'), ('executie_documente_contract', 'proiect_id'),
      ('executie_acte_aditionale', 'proiect_id'), ('executie_ordine_sistare', 'proiect_id'), ('executie_ordine_detectate', 'proiect_id'),
      ('executie_completari_propuse', 'proiect_id'), ('executie_faze_determinante', 'proiect_id'), ('executie_probe_presiune', 'proiect_id'),
      ('executie_situatii_plata', 'proiect_id'), ('executie_bonuri_consum', 'proiect_id'), ('executie_alocari_personal', 'proiect_id'),
      ('executie_ture', 'proiect_id'), ('executie_tura_subcontractori', 'proiect_id'), ('executie_tura_activitati', 'proiect_id'),
      ('executie_tura_naveta', 'proiect_id'), ('proiect_unitati', 'proiect_id'), ('proiect_activitati', 'proiect_id'),
      ('proiect_articole', 'proiect_id')) t(tabel, coloana)
  LOOP
    v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I = ANY ((SELECT public.fn_executie_acces_lista(false))::bigint[])', r.coloana);
    v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I = ANY ((SELECT public.fn_executie_acces_lista(true))::bigint[])', r.coloana);
    EXECUTE format('CREATE POLICY executie_acces_citire ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', r.tabel, v_cit);
    EXECUTE format('CREATE POLICY executie_acces_adauga ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.tabel, v_scr);
    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tabel, v_scr, v_scr);
    EXECUTE format('CREATE POLICY executie_acces_sterge ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.tabel, v_scr);
    EXECUTE format('CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda(%L)',
                   r.tabel, r.coloana);
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('executie_situatii_plata_linii', 'sl', 'sl_id'), ('executie_sl_ajustari', 'sl', 'sl_id'),
      ('executie_bonuri_consum_linii', 'bon', 'bon_id')) t(tabel, parinte, coloana)
  LOOP
    v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_%s_permis(%I, false)', r.parinte, r.coloana);
    v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_%s_permis(%I, true)', r.parinte, r.coloana);
    EXECUTE format('CREATE POLICY executie_acces_citire ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', r.tabel, v_cit);
    EXECUTE format('CREATE POLICY executie_acces_adauga ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.tabel, v_scr);
    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tabel, v_scr, v_scr);
    EXECUTE format('CREATE POLICY executie_acces_sterge ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.tabel, v_scr);
    EXECUTE format('CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda_copil(%L, %L)',
                   r.tabel, r.parinte, r.coloana);
  END LOOP;
END $pol$;

-- ── 6. funcțiile de drept ale tabelelor noi: aceeași regulă de modul + condiția de proiect (CREATE OR REPLACE păstrează owner / ACL) ──
CREATE OR REPLACE FUNCTION public.fn_executie_nod_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level IN ('editor', 'admin') OR (p_scriere IS FALSE AND u.access_level = 'viewer'))))
    AND public.fn_executie_proiect_permis(p_proiect, p_scriere)
$f$;
CREATE OR REPLACE FUNCTION public.fn_executie_contract_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level = 'admin' OR (p_scriere IS FALSE AND u.access_level IN ('viewer', 'editor')))))
    AND public.fn_executie_proiect_permis(p_proiect, p_scriere)
$f$;
CREATE OR REPLACE FUNCTION public.fn_executie_grafic_drept(p_proiect bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')))
    AND public.fn_executie_proiect_permis(p_proiect, false)
$f$;
CREATE OR REPLACE FUNCTION public.fn_executie_tinte_drept(p_proiect bigint, p_nivel text) RETURNS boolean
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
    AND public.fn_executie_proiect_permis(p_proiect, p_nivel = 'configurare')
$f$;

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid := 'public.executie_acces_proiect'::regclass; r record;
BEGIN
  -- tabelul nou: RLS, o politică de citire, doar SELECT pentru authenticated / service_role
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_acces_proiect') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_acces_proiect'
                     AND policyname = 'executie_acces_proiect_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION '20261209a post: RLS / politica tabelului nou';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) rl, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pv
              WHERE has_table_privilege(rl, v_rel, pv))
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261209a post: privilegii pe tabelul nou';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_rel AND tgname = 'trg_executie_acces_proiect_prov' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '20261209a post: trigger-ul de proveniență';
  END IF;
  -- funcțiile noi: exact 11, DEFINER doar unde trebuie, search_path fix, EXECUTE doar unde trebuie
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')) <> 11
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND (p.proname LIKE 'fn\_executie\_acces\_%' OR p.proname = 'fn_executie_proiect_permis')
                   AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_acces_e_owner', 'fn_executie_acces_nerestrans', 'fn_executie_acces_lista',
                                                                       'fn_executie_proiect_permis', 'fn_executie_acces_sl_permis', 'fn_executie_acces_bon_permis',
                                                                       'fn_executie_acces_proiect_seteaza'))
                        OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                        OR has_function_privilege('anon', p.oid, 'EXECUTE')
                        OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                        OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM
                           (p.proname NOT IN ('fn_executie_acces_proiect_prov', 'fn_executie_acces_canon', 'fn_executie_acces_garda', 'fn_executie_acces_garda_copil')))) THEN
    RAISE EXCEPTION '20261209a post: functii noi (definer / search_path / EXECUTE)';
  END IF;
  -- tabelele acoperite: 4 politici RESTRICTIVE pentru authenticated + trigger-ul activ, cu argumentele lui
  FOR r IN SELECT t.*, CASE WHEN t.parinte IS NULL THEN encode(convert_to(t.coloana, 'UTF8'), 'hex') || '00'
                            ELSE encode(convert_to(t.parinte, 'UTF8'), 'hex') || '00' || encode(convert_to(t.coloana, 'UTF8'), 'hex') || '00' END AS args_hex
             FROM (VALUES
      ('executie_proiecte', 'id', 1, NULL), ('executie_tronsoane', 'proiect_id', 1, NULL), ('executie_documente_contract', 'proiect_id', 1, NULL),
      ('executie_acte_aditionale', 'proiect_id', 1, NULL), ('executie_ordine_sistare', 'proiect_id', 1, NULL), ('executie_ordine_detectate', 'proiect_id', 1, NULL),
      ('executie_completari_propuse', 'proiect_id', 1, NULL), ('executie_faze_determinante', 'proiect_id', 1, NULL), ('executie_probe_presiune', 'proiect_id', 1, NULL),
      ('executie_situatii_plata', 'proiect_id', 1, NULL), ('executie_bonuri_consum', 'proiect_id', 1, NULL), ('executie_alocari_personal', 'proiect_id', 1, NULL),
      ('executie_ture', 'proiect_id', 1, NULL), ('executie_tura_subcontractori', 'proiect_id', 1, NULL), ('executie_tura_activitati', 'proiect_id', 1, NULL),
      ('executie_tura_naveta', 'proiect_id', 1, NULL), ('proiect_unitati', 'proiect_id', 1, NULL), ('proiect_activitati', 'proiect_id', 1, NULL),
      ('proiect_articole', 'proiect_id', 1, NULL),
      ('executie_situatii_plata_linii', 'sl_id', 2, 'sl'), ('executie_sl_ajustari', 'sl_id', 2, 'sl'),
      ('executie_bonuri_consum_linii', 'bon_id', 2, 'bon')) t(tabel, coloana, nargs, parinte)
  LOOP
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tabel AND policyname LIKE 'executie\_acces\_%') <> 4
       OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = r.tabel AND policyname LIKE 'executie\_acces\_%'
            AND permissive = 'RESTRICTIVE' AND roles = '{authenticated}'
            AND ((policyname = 'executie_acces_citire' AND cmd = 'SELECT' AND qual LIKE '%fn_executie_acces_nerestrans()%' AND qual LIKE '%false)%' AND with_check IS NULL)
              OR (policyname = 'executie_acces_adauga' AND cmd = 'INSERT' AND qual IS NULL AND with_check LIKE '%fn_executie_acces_nerestrans()%' AND with_check LIKE '%true)%')
              OR (policyname = 'executie_acces_modifica' AND cmd = 'UPDATE' AND qual LIKE '%true)%' AND with_check LIKE '%true)%')
              OR (policyname = 'executie_acces_sterge' AND cmd = 'DELETE' AND qual LIKE '%true)%' AND with_check IS NULL))) <> 4
       OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = to_regclass('public.' || r.tabel) AND tg.tgname = 'trg_executie_acces_garda'
                       AND tg.tgenabled = 'O' AND tg.tgnargs = r.nargs AND tg.tgqual IS NULL
                       AND tg.tgfoid = CASE r.nargs WHEN 1 THEN 'public.fn_executie_acces_garda()'::regprocedure
                                                    ELSE 'public.fn_executie_acces_garda_copil()'::regprocedure END
                       AND tg.tgtype = (1 | 2 | 4 | 8 | 16)   -- ROW, BEFORE, INSERT, DELETE, UPDATE
                       AND encode(tg.tgargs, 'hex') = r.args_hex) THEN
      RAISE EXCEPTION '20261209a post: politicile / trigger-ul pe %', r.tabel;
    END IF;
  END LOOP;
  -- funcțiile de drept: corpul nou revizuit (amprentă fără CR) + aceleași proprietăți și ACL ca înainte
  IF EXISTS (SELECT 1 FROM (VALUES
               ('public.fn_executie_nod_drept(bigint, boolean)', '1f0faa030d0459412aafb6e1a024beff', true),
               ('public.fn_executie_contract_drept(bigint, boolean)', 'f3c3dc6add32d563682494e804864e99', true),
               ('public.fn_executie_grafic_drept(bigint)', '5df5d4ecce38a81472fc4f17cf410b97', true),
               ('public.fn_executie_tinte_drept(bigint, text)', '9bc9c10212d8f0a7ca5ad94e0220c7c2', false)) a(semnatura, amprenta, cu_service)
              LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
              WHERE p.oid IS NULL
                 OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
                 OR p.prosecdef IS NOT TRUE
                 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                 OR p.provolatile IS DISTINCT FROM 's'
                 OR pg_get_userbyid(p.proowner) IS DISTINCT FROM current_user
                 OR has_function_privilege('anon', p.oid, 'EXECUTE')
                 OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_service) THEN
    RAISE EXCEPTION '20261209a post: functiile de drept (corp / proprietati / EXECUTE)';
  END IF;
  -- nicio dată: niciun cont nu e restrâns după migrare
  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261209a_executie_acces_proiect:' || txid_current() THEN
    RAISE EXCEPTION '20261209a: garda final invalida';
  END IF;
END $post$;
