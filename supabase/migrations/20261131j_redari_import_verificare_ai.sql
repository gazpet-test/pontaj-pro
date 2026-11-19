-- Version 20261131200000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261131j_redari_import_verificare_ai.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al
--   runnerului în aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 (docs/LIVRARE_L15_V2.md): garanția la aplicare = amprenta GLOBALĂ v2 a runnerului. Manifestul .l15.tsv îl generează coordonatorul pe clonă
--   (scripts/livrare_l15_manifest.sh); lista OBIECTELOR pe care trebuie să le conțină e în supabase/tests/20261131j_redari_import_verificare_ai.l15.obiecte.tsv
--   (verificată pe PGlite cu pașii reali ai runnerului: scripts/pglite/test_redari_import_ai_local.mjs). Migrarea e ADITIVĂ: nu înlocuiește nicio
--   funcție, politică sau drept existent; verifică pe amprentă (corp + proprietăți + drepturi) funcțiile existente pe care le cheamă.
-- 20261131j_redari_import_verificare_ai — Redări, importul TGZ, pasul 2: A DOUA OPINIE AI (Claude Sonnet 5.5 prin API) în previzualizare
--   (deciziile lui Răzvan, 19.11.2026). Verificarea AI marchează valori ciudate în tarla / nr_cadastral / poz_hg (posibilă coloană decalată); NU
--   blochează, NU scrie date de business, NU corectează: rezultatul ajunge doar în ecran (secțiunea „De verificat”), omul decide.
--   Pornirea e o procesare PLĂTITĂ: o pot porni doar owner-ul și utilizatorii cu un drept NOU, PE PROIECT (varianta A). Ce face:
--   * red_proiect_drepturi — lista utilizatorilor ERP cu drepturi PE PROIECT în Redări (până azi accesul era doar pe modul: fn_red_nivel /
--     user_module_access 'redari'; trg_red_proiect_utilizatori privește arendașii, nu conturile ERP). Un rând = (proiect, cont, drept); azi un singur
--     drept: 'import_verificare_ai'. NICIUN drept de scriere pentru rolurile aplicației: rândurile le scrie coordonatorul (postgres), cu „da”-ul lui
--     Răzvan, după aplicare (primul: Janeta pe LOT1). Fiecare acordare / retragere intră în red_jurnal (trg_red_jurnal, cu cine și când).
--   * fn_red_import_ai_poate(uuid) — SINGURA definiție a dreptului (L19): auth.uid() nenul ȘI proiectul există și e activ ȘI (owner SAU nivel
--     Redări admin/editor + rândul din red_proiect_drepturi). O cheamă ecranul (butonul), funcția edge (decizia, cu JWT-ul omului), RPC-ul de
--     rezervare și politica RLS a jurnalului.
--   * red_import_ai_jurnal — jurnalul apelurilor plătite (cine, când, proiect, fișier sha256, bucata, rânduri trimise, semnale, model, tokeni, cost
--     rezervat / final, stare, cod de eroare FĂRĂ valori). Citire: cine are dreptul pe proiect (RLS). Scriere: doar prin cele două RPC-uri.
--   * fn_red_import_ai_rezerva(...) — pasul atomic durabil DINAINTEA apelului plătit (L22, L01, L04): lock consultativ pe proiect, cheia de intenție
--     (UUID, aceeași la reluare; aceeași cheie + alt conținut = refuz), dreptul, plafoanele (apeluri / zi / proiect, cost / zi / proiect, reluări /
--     bucată de fișier / zi), rezervarea costului MAXIM (intrare ≤ octeți, ieșire = max_tokens). Identitatea = auth.uid() (L08), fără p_user.
--   * fn_red_import_ai_inchide(...) — închiderea rezervării cu CAS pe (id, token, stare 'rezervat'); EXECUTE doar service_role (funcția edge), ca
--     un utilizator să nu-și poată „închide” singur rezervările cu un cost mai mic. Costul final îl calculează SQL-ul din tokeni. Rezultat
--     necunoscut (timeout / 5xx / rețea) = stare 'necunoscut', costul rămâne cel rezervat (L22: tombstone, fără reluare automată).
-- Ce NU face: nu atinge tabelele / funcțiile / politicile existente (doar FK-uri spre red_proiecte și profiles și triggerul generic de jurnal pe
--   tabelul nou); nu acordă niciun drept cuiva (rândurile din red_proiect_drepturi = după aplicare, separat); nu creează secrete, cron, mail, SMS.
-- Identitatea: auth.uid() în fn_red_import_ai_poate / rezerva (L08); inchide = service_role, cu legătura id + token din rezervare (fără identitate
--   din parametri: rândul își păstrează user_id-ul scris la rezervare).
-- Ordinea lock-urilor la rulare (L06): rezerva = pg_advisory_xact_lock(proiect) → (citiri) → INSERT în red_import_ai_jurnal; inchide = UPDATE pe
--   rândul propriu (fără alte lock-uri). Niciun lock pe red_proiecte / profiles la rulare (doar citiri).
-- Lock-uri la aplicare (punct unic, NOWAIT): red_proiecte SHARE ROW EXCLUSIVE → profiles SHARE ROW EXCLUSIVE (cerute de FK-urile noi; nu opresc
--   citirile, opresc scrierile pe cele două tabele până la COMMIT). Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI.
-- GĂRZILE DE TIMP: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$), lock_timeout = 100 ms, bugetul lock-urilor 1 s.
-- Revenire: supabase/revenire/20261131j_redari_import_verificare_ai_ROLLBACK.sql (L14: refuză la ORICE rând în tabelele noi sau în red_jurnal pentru
--   red_proiect_drepturi — după primul drept acordat / primul apel, întoarcerea = migrare nouă). Probe: scripts/pglite/test_redari_import_ai_local.mjs.
DO $pre$
DECLARE v_plafon text; v_rau text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131j_redari_import_verificare_ai:' || txid_current() THEN
    RAISE EXCEPTION '20261131j: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261131j: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261131j: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261131j: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261131j: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tiparul 20261225a / 20261226a)
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261131j: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz (orice obiect cu numele noi, inclusiv alte semnături)
  IF to_regclass('public.red_proiect_drepturi') IS NOT NULL OR to_regclass('public.red_import_ai_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND p.proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide')) THEN
    RAISE EXCEPTION '20261131j: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite (tipurile exacte)
  SELECT string_agg(a.t || '.' || a.c, ', ') INTO v_rau
    FROM (VALUES ('red_proiecte', 'id', 'uuid'), ('red_proiecte', 'activ', 'boolean'), ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'),
                 ('red_jurnal', 'tabela', 'text'), ('red_jurnal', 'inregistrare_id', 'uuid')) a(t, c, tip)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = a.t AND ic.column_name = a.c AND ic.data_type = a.tip);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131j: coloane lipsa / alt tip: %', v_rau; END IF;
  -- PK-urile țintă ale FK-urilor
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.red_proiecte'::regclass AND contype = 'p' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.red_proiecte'::regclass AND attname = 'id')]::int2[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'p' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'id')]::int2[]) THEN
    RAISE EXCEPTION '20261131j: red_proiecte.id / profiles.id nu sunt cheie primara';
  END IF;
  -- funcțiile existente chemate (L15): corp fără CR + limbaj / DEFINER / volatilitate / search_path / owner / ACL — baseline-ul din 20261131c / 20261226a
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      ('public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae', 'sql', true, 's', '{"search_path=public, pg_temp"}', '{authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),
      ('public.fn_red_jurnal()', '41ab451b7fcb499a2284c9c82367069e', 'plpgsql', true, 'v', '{"search_path=public, pg_temp"}', '{postgres=X/postgres}'),
      ('auth.uid()', 'cdef18c69c4f4cbbced2eaf81e628b49', 'sql', false, 's', '', '{=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin,supabase_auth_admin=X/supabase_auth_admin}')
    ) a(semnatura, amprenta, limbaj, definer, volatil, config, acl)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile::text IS DISTINCT FROM a.volatil
      OR coalesce(p.proconfig::text, '') IS DISTINCT FROM a.config
      OR coalesce((SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)::text, '') IS DISTINCT FROM a.acl;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131j: functiile chemate nu au amprenta revizuita: %', v_rau; END IF;
  -- jurnalul generic: append-only, fără drept de scriere pentru rolurile aplicației (triggerul nou scrie în el ca DEFINER)
  IF to_regclass('public.red_jurnal') IS NULL
     OR has_table_privilege('authenticated', 'public.red_jurnal', 'INSERT') OR has_table_privilege('anon', 'public.red_jurnal', 'INSERT') THEN
    RAISE EXCEPTION '20261131j: red_jurnal lipseste sau e scriibil de rolurile aplicatiei';
  END IF;
  IF to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL OR to_regprocedure('pg_catalog.hashtextextended(text,bigint)') IS NULL THEN
    RAISE EXCEPTION '20261131j: gen_random_uuid / hashtextextended lipsesc din pg_catalog';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE') OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION '20261131j: anon/authenticated pot crea obiecte in public';
  END IF;
  IF auth.uid() IS NOT NULL OR nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
     OR nullif(current_setting('request.jwt.claim.sub', true), '') IS NOT NULL THEN
    RAISE EXCEPTION '20261131j: sesiunea de livrare are JWT / claims';
  END IF;
END $pre$;

-- ── punctul UNIC de blocare (L06): red_proiecte → profiles, SHARE ROW EXCLUSIVE (cerute de FK-urile noi), NOWAIT, bugetul 1 s de la prima încercare ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261131j: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000) USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261131j: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261131j: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── 1. Drepturile pe proiect ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.red_proiect_drepturi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  drept text NOT NULL CONSTRAINT red_proiect_drepturi_drept_ck CHECK (drept IN ('import_verificare_ai')),
  nota text CONSTRAINT red_proiect_drepturi_nota_ck CHECK (nota IS NULL OR length(nota) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_proiect_drepturi_unic UNIQUE (proiect_id, profile_id, drept)
);
COMMENT ON TABLE public.red_proiect_drepturi IS 'Redări: drepturile unui cont ERP PE PROIECT (în plus față de nivelul pe modul, fn_red_nivel). Azi: import_verificare_ai = poate porni verificarea AI plătită a importului TGZ (20261131j). Scrie doar coordonatorul (postgres), cu acordul lui Răzvan; retragerea = DELETE. Fiecare schimbare intră în red_jurnal (cine, când). Citire: contul propriu și adminii Redări.';
ALTER TABLE public.red_proiect_drepturi ENABLE ROW LEVEL SECURITY;
CREATE POLICY red_proiect_drepturi_sel ON public.red_proiect_drepturi FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND (profile_id = (SELECT auth.uid()) OR (SELECT public.fn_red_nivel()) = 'admin'));
REVOKE ALL ON public.red_proiect_drepturi FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_proiect_drepturi TO authenticated, service_role;
CREATE TRIGGER trg_red_jurnal AFTER INSERT OR UPDATE OR DELETE ON public.red_proiect_drepturi
  FOR EACH ROW EXECUTE FUNCTION public.fn_red_jurnal();

-- ─── 2. Dreptul: o singură definiție (L19) ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.fn_red_import_ai_poate(p_proiect uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = p_proiect AND pr.activ IS TRUE)
     AND (EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = auth.uid() AND pf.is_owner IS TRUE)
          OR (coalesce(public.fn_red_nivel() IN ('admin', 'editor'), false)
              AND EXISTS (SELECT 1 FROM public.red_proiect_drepturi d
                           WHERE d.proiect_id = p_proiect AND d.profile_id = auth.uid() AND d.drept = 'import_verificare_ai')))
$fn$;
COMMENT ON FUNCTION public.fn_red_import_ai_poate(uuid) IS 'Redări: true = contul curent (auth.uid()) poate porni verificarea AI plătită a importului pe proiect: owner, sau nivel Redări admin/editor + dreptul import_verificare_ai în red_proiect_drepturi; proiectul trebuie să existe și să fie activ. Întoarce mereu true / false, niciodată NULL (un cont fără nivel Redări = false). Fără parametru de identitate. Singura definiție (ecran, funcția edge, rezervare, RLS). 20261131j.';
REVOKE ALL ON FUNCTION public.fn_red_import_ai_poate(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_import_ai_poate(uuid) TO authenticated;

-- ─── 3. Jurnalul apelurilor plătite ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.red_import_ai_jurnal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cheie uuid NOT NULL CONSTRAINT red_import_ai_jurnal_cheie_unic UNIQUE,
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ziua date NOT NULL,
  fisier_sha256 text NOT NULL CONSTRAINT red_import_ai_jurnal_fisier_ck CHECK (fisier_sha256 ~ '^[0-9a-f]{64}$'),
  continut_sha256 text NOT NULL CONSTRAINT red_import_ai_jurnal_continut_ck CHECK (continut_sha256 ~ '^[0-9a-f]{64}$'),
  bucata integer NOT NULL,
  bucati integer NOT NULL,
  randuri integer NOT NULL CONSTRAINT red_import_ai_jurnal_randuri_ck CHECK (randuri BETWEEN 1 AND 300),
  octeti_intrare integer NOT NULL CONSTRAINT red_import_ai_jurnal_octeti_ck CHECK (octeti_intrare BETWEEN 1 AND 120000),
  max_iesire integer NOT NULL CONSTRAINT red_import_ai_jurnal_iesire_ck CHECK (max_iesire BETWEEN 1 AND 16000),
  model text NOT NULL CONSTRAINT red_import_ai_jurnal_model_ck CHECK (model = 'claude-sonnet-5-5'),
  cost_rezervat_usd numeric(12,6) NOT NULL CONSTRAINT red_import_ai_jurnal_rezervat_ck CHECK (cost_rezervat_usd > 0),
  lease_token uuid NOT NULL,
  stare text NOT NULL DEFAULT 'rezervat' CONSTRAINT red_import_ai_jurnal_stare_ck CHECK (stare IN ('rezervat', 'ok', 'eroare', 'necunoscut')),
  semnale integer CONSTRAINT red_import_ai_jurnal_semnale_ck CHECK (semnale IS NULL OR semnale >= 0),
  respinse integer CONSTRAINT red_import_ai_jurnal_respinse_ck CHECK (respinse IS NULL OR respinse >= 0),
  tokeni_in integer CONSTRAINT red_import_ai_jurnal_tin_ck CHECK (tokeni_in IS NULL OR tokeni_in >= 0),
  tokeni_out integer CONSTRAINT red_import_ai_jurnal_tout_ck CHECK (tokeni_out IS NULL OR tokeni_out >= 0),
  cost_usd numeric(12,6) CONSTRAINT red_import_ai_jurnal_cost_ck CHECK (cost_usd IS NULL OR cost_usd >= 0),
  eroare_cod text CONSTRAINT red_import_ai_jurnal_eroare_ck CHECK (eroare_cod IS NULL OR eroare_cod ~ '^[a-z0-9_]{1,40}$'),
  inchis_la timestamptz,
  CONSTRAINT red_import_ai_jurnal_bucata_ck CHECK (bucata >= 1 AND bucati BETWEEN 1 AND 100 AND bucata <= bucati),
  -- stările finale au închiderea; 'ok' are tokenii și semnalele; 'rezervat' nu are nimic din închidere
  CONSTRAINT red_import_ai_jurnal_inchidere_ck CHECK (
    (stare = 'rezervat' AND inchis_la IS NULL AND semnale IS NULL AND respinse IS NULL AND tokeni_in IS NULL AND tokeni_out IS NULL AND cost_usd IS NULL AND eroare_cod IS NULL)
    OR (stare = 'ok' AND inchis_la IS NOT NULL AND semnale IS NOT NULL AND respinse IS NOT NULL AND tokeni_in IS NOT NULL AND tokeni_out IS NOT NULL AND cost_usd IS NOT NULL AND eroare_cod IS NULL)
    OR (stare = 'eroare' AND inchis_la IS NOT NULL AND eroare_cod IS NOT NULL)
    OR (stare = 'necunoscut' AND inchis_la IS NOT NULL AND eroare_cod IS NOT NULL AND cost_usd IS NULL))
);
CREATE INDEX red_import_ai_jurnal_zi_idx ON public.red_import_ai_jurnal (proiect_id, ziua);
CREATE INDEX red_import_ai_jurnal_fisier_idx ON public.red_import_ai_jurnal (proiect_id, fisier_sha256, bucata, ziua);
COMMENT ON TABLE public.red_import_ai_jurnal IS 'Redări: jurnalul verificărilor AI plătite ale importului TGZ (20261131j): un rând = un apel (o bucată de rânduri), rezervat ÎNAINTE de apel (fn_red_import_ai_rezerva, cu costul maxim) și închis după (fn_red_import_ai_inchide, doar funcția edge). Fără valori din fișier: doar numere, hash-uri, coduri. Costul unei zile = suma costului final, sau a celui rezervat cât e necunoscut. Citire: cine are dreptul pe proiect.';
ALTER TABLE public.red_import_ai_jurnal ENABLE ROW LEVEL SECURITY;
CREATE POLICY red_import_ai_jurnal_sel ON public.red_import_ai_jurnal FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND public.fn_red_import_ai_poate(proiect_id));
REVOKE ALL ON public.red_import_ai_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_import_ai_jurnal TO authenticated, service_role;

-- ─── 4. Rezervarea (înaintea apelului plătit) ────────────────────────────────────────────────────────────────────────────────
-- Plafoane (L22, L20): ≤ 60 de apeluri / zi / proiect, ≤ 10 USD / zi / proiect (costul final sau, cât e necunoscut, cel rezervat), ≤ 2 apeluri / zi pe
-- aceeași bucată a aceluiași fișier; ≤ 300 de rânduri / apel. Ziua = Europe/Bucharest (L17). Tarif Sonnet 5.5: 2 USD / MTok intrare, 10 USD / MTok ieșire;
-- rezervarea = (octeți + 2000) × intrare + max_iesire × ieșire (tokenii ≤ octeții UTF-8 ai cererii: nu se subestimează).
-- Ordinea lock-urilor (L06): advisory(proiect) → INSERT în red_import_ai_jurnal (cheia unică). Fără alte lock-uri.
CREATE FUNCTION public.fn_red_import_ai_rezerva(p_cheie uuid, p_proiect uuid, p_fisier_sha256 text, p_continut_sha256 text, p_bucata integer, p_bucati integer,
                                                p_randuri integer, p_octeti integer, p_max_iesire integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_zi date; v_cost numeric(12,6); v_r public.red_import_ai_jurnal; v_n integer; v_suma numeric; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'cod', 'neautentificat'); END IF;
  IF p_cheie IS NULL OR p_proiect IS NULL OR p_fisier_sha256 IS NULL OR p_fisier_sha256 !~ '^[0-9a-f]{64}$'
     OR p_continut_sha256 IS NULL OR p_continut_sha256 !~ '^[0-9a-f]{64}$'
     OR p_bucati IS NULL OR p_bucati NOT BETWEEN 1 AND 100 OR p_bucata IS NULL OR p_bucata NOT BETWEEN 1 AND p_bucati
     OR p_randuri IS NULL OR p_randuri NOT BETWEEN 1 AND 300 OR p_octeti IS NULL OR p_octeti NOT BETWEEN 1 AND 120000
     OR p_max_iesire IS NULL OR p_max_iesire NOT BETWEEN 1 AND 16000 THEN
    RETURN jsonb_build_object('ok', false, 'cod', 'cerere_invalida');
  END IF;
  -- L01: lock înaintea oricărei verificări de drept / plafon / cheie
  PERFORM pg_advisory_xact_lock(hashtextextended('red_import_ai:' || p_proiect::text, 0));
  -- L04: aceeași cheie = aceeași intenție (alt cont / proiect / conținut = refuz); reluarea NU dă voie la un al doilea apel (nou = false)
  SELECT * INTO v_r FROM public.red_import_ai_jurnal j WHERE j.cheie = p_cheie;
  IF FOUND THEN
    IF v_r.user_id IS DISTINCT FROM v_uid OR v_r.proiect_id IS DISTINCT FROM p_proiect OR v_r.fisier_sha256 IS DISTINCT FROM p_fisier_sha256
       OR v_r.continut_sha256 IS DISTINCT FROM p_continut_sha256 OR v_r.bucata IS DISTINCT FROM p_bucata OR v_r.bucati IS DISTINCT FROM p_bucati
       OR v_r.randuri IS DISTINCT FROM p_randuri THEN
      RETURN jsonb_build_object('ok', false, 'cod', 'cheie_refolosita');
    END IF;
    RETURN jsonb_build_object('ok', true, 'nou', false, 'id', v_r.id, 'stare', v_r.stare);
  END IF;
  IF public.fn_red_import_ai_poate(p_proiect) IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'cod', 'fara_drept'); END IF;
  v_zi := (clock_timestamp() AT TIME ZONE 'Europe/Bucharest')::date;
  v_cost := round(((p_octeti + 2000) * 2.0 + p_max_iesire * 10.0) / 1000000.0, 6);
  SELECT count(*), coalesce(sum(coalesce(j.cost_usd, j.cost_rezervat_usd)), 0) INTO v_n, v_suma
    FROM public.red_import_ai_jurnal j WHERE j.proiect_id = p_proiect AND j.ziua = v_zi;
  IF v_n >= 60 THEN RETURN jsonb_build_object('ok', false, 'cod', 'plafon_apeluri_zi', 'limita', 60); END IF;
  IF v_suma + v_cost > 10 THEN RETURN jsonb_build_object('ok', false, 'cod', 'plafon_cost_zi', 'limita_usd', 10); END IF;
  SELECT count(*) INTO v_n FROM public.red_import_ai_jurnal j
   WHERE j.proiect_id = p_proiect AND j.fisier_sha256 = p_fisier_sha256 AND j.bucata = p_bucata AND j.ziua = v_zi;
  IF v_n >= 2 THEN RETURN jsonb_build_object('ok', false, 'cod', 'plafon_bucata_zi', 'limita', 2); END IF;
  INSERT INTO public.red_import_ai_jurnal (cheie, proiect_id, user_id, ziua, fisier_sha256, continut_sha256, bucata, bucati, randuri, octeti_intrare,
                                           max_iesire, model, cost_rezervat_usd, lease_token)
  VALUES (p_cheie, p_proiect, v_uid, v_zi, p_fisier_sha256, p_continut_sha256, p_bucata, p_bucati, p_randuri, p_octeti, p_max_iesire,
          'claude-sonnet-5-5', v_cost, gen_random_uuid())
  ON CONFLICT (cheie) DO NOTHING
  RETURNING * INTO v_r;
  IF v_r.id IS NULL THEN
    -- cheia a apărut între timp pe ALT proiect (alt lock consultativ): aceeași regulă ca mai sus
    SELECT * INTO v_r FROM public.red_import_ai_jurnal j WHERE j.cheie = p_cheie;
    IF v_r.user_id IS DISTINCT FROM v_uid OR v_r.proiect_id IS DISTINCT FROM p_proiect OR v_r.continut_sha256 IS DISTINCT FROM p_continut_sha256 THEN
      RETURN jsonb_build_object('ok', false, 'cod', 'cheie_refolosita');
    END IF;
    RETURN jsonb_build_object('ok', true, 'nou', false, 'id', v_r.id, 'stare', v_r.stare);
  END IF;
  RETURN jsonb_build_object('ok', true, 'nou', true, 'id', v_r.id, 'lease_token', v_r.lease_token, 'model', v_r.model,
                            'cost_rezervat_usd', v_r.cost_rezervat_usd, 'ziua', v_r.ziua);
END $fn$;
COMMENT ON FUNCTION public.fn_red_import_ai_rezerva(uuid, uuid, text, text, integer, integer, integer, integer, integer) IS 'Redări: rezervarea DURABILĂ a unui apel AI plătit (verificarea importului, 20261131j), ÎNAINTEA apelului: lock consultativ pe proiect, cheia de intenție (UUID; aceeași cheie + același conținut = rândul existent cu nou=false, deci FĂRĂ al doilea apel; alt conținut = cheie_refolosita), dreptul (fn_red_import_ai_poate), plafoanele (60 de apeluri și 10 USD / zi / proiect, 2 apeluri / zi / bucată de fișier), costul maxim rezervat. Refuzurile se întorc ca jsonb {ok:false, cod}, fără scriere. Identitatea = auth.uid().';
REVOKE ALL ON FUNCTION public.fn_red_import_ai_rezerva(uuid, uuid, text, text, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_import_ai_rezerva(uuid, uuid, text, text, integer, integer, integer, integer, integer) TO authenticated;

-- ─── 5. Închiderea (doar funcția edge, service_role) ─────────────────────────────────────────────────────────────────────────
-- CAS (L03): doar rândul cu ACEST id + token, încă 'rezervat'; costul final = tokeni_in × 2 + tokeni_out × 10 USD / MTok, calculat aici. 'necunoscut' =
-- costul rămâne cel rezervat (cost_usd NULL). Rezultat: true = închis acum; false = nimic schimbat (token greșit / deja închis / stare invalidă).
CREATE FUNCTION public.fn_red_import_ai_inchide(p_id uuid, p_token uuid, p_stare text, p_semnale integer, p_respinse integer, p_tokeni_in integer,
                                                p_tokeni_out integer, p_eroare_cod text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_id IS NULL OR p_token IS NULL OR p_stare IS NULL OR p_stare NOT IN ('ok', 'eroare', 'necunoscut')
     OR (p_eroare_cod IS NOT NULL AND p_eroare_cod !~ '^[a-z0-9_]{1,40}$')
     OR (p_stare = 'ok' AND (p_semnale IS NULL OR p_respinse IS NULL OR p_tokeni_in IS NULL OR p_tokeni_out IS NULL OR p_eroare_cod IS NOT NULL))
     OR (p_stare <> 'ok' AND p_eroare_cod IS NULL)
     OR p_semnale < 0 OR p_respinse < 0 OR p_tokeni_in < 0 OR p_tokeni_out < 0
     OR (p_tokeni_in IS NULL) IS DISTINCT FROM (p_tokeni_out IS NULL) THEN
    RETURN false;
  END IF;
  UPDATE public.red_import_ai_jurnal j
     SET stare = p_stare, inchis_la = clock_timestamp(), semnale = p_semnale, respinse = p_respinse,
         tokeni_in = CASE WHEN p_stare = 'necunoscut' THEN NULL ELSE p_tokeni_in END,
         tokeni_out = CASE WHEN p_stare = 'necunoscut' THEN NULL ELSE p_tokeni_out END,
         cost_usd = CASE WHEN p_stare <> 'necunoscut' AND p_tokeni_in IS NOT NULL THEN round((p_tokeni_in * 2.0 + p_tokeni_out * 10.0) / 1000000.0, 6) END,
         eroare_cod = p_eroare_cod
   WHERE j.id = p_id AND j.lease_token = p_token AND j.stare = 'rezervat';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $fn$;
COMMENT ON FUNCTION public.fn_red_import_ai_inchide(uuid, uuid, text, integer, integer, integer, integer, text) IS 'Redări: închiderea unei rezervări AI (20261131j), DOAR funcția edge (service_role): CAS pe id + lease_token + stare rezervat; ok = semnale + tokeni (costul final calculat aici), eroare = cod (+ tokeni dacă se cunosc), necunoscut = cod, costul rămâne cel rezervat. true = închis acum; false = nimic schimbat.';
REVOKE ALL ON FUNCTION public.fn_red_import_ai_inchide(uuid, uuid, text, integer, integer, integer, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_import_ai_inchide(uuid, uuid, text, integer, integer, integer, integer, text) TO service_role;

-- ─── 6. Postcondiții ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $post$
DECLARE v_rau text;
BEGIN
  -- corpurile noi (AMPRENTE-NOI 20261131j — aceleași constante în revenire) + proprietățile
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES
      -- >>> AMPRENTE-NOI 20261131j
      ('public.fn_red_import_ai_poate(uuid)', 'b20a13bf9179b76c00812b63362bf32f', 'sql', true, 's', 'boolean'),
      ('public.fn_red_import_ai_rezerva(uuid,uuid,text,text,integer,integer,integer,integer,integer)', '959e29666c0086ac713cbf3af4bc2318', 'plpgsql', true, 'v', 'jsonb'),
      ('public.fn_red_import_ai_inchide(uuid,uuid,text,integer,integer,integer,integer,text)', '33ac8ddf00565721662122fd7d71a3ef', 'plpgsql', true, 'v', 'boolean')
      -- <<< AMPRENTE-NOI 20261131j
    ) a(semnatura, amprenta, limbaj, definer, volatil, intoarce)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = a.limbaj)
      OR p.prosecdef IS DISTINCT FROM a.definer
      OR p.provolatile::text IS DISTINCT FROM a.volatil
      OR p.prorettype IS DISTINCT FROM a.intoarce::regtype::oid
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres';
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20261131j: postconditie: functiile (corp / proprietati) difera: %', v_rau; END IF;
  -- o singură variantă a fiecărei funcții noi
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide')) <> 3 THEN
    RAISE EXCEPTION '20261131j: postconditie: variante in plus ale functiilor noi';
  END IF;
  -- drepturile EXACTE pe funcții: poate / rezerva = authenticated; inchide = service_role; nimic pentru PUBLIC / anon
  SELECT string_agg(f, ';' ORDER BY f COLLATE "C") INTO v_rau FROM (
    SELECT p.proname || '=' || coalesce((SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(p.proacl::text[]) x)::text, '') AS f
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_red_import_ai_poate', 'fn_red_import_ai_rezerva', 'fn_red_import_ai_inchide')) z;
  IF v_rau IS DISTINCT FROM 'fn_red_import_ai_inchide={postgres=X/postgres,service_role=X/postgres};fn_red_import_ai_poate={authenticated=X/postgres,postgres=X/postgres};fn_red_import_ai_rezerva={authenticated=X/postgres,postgres=X/postgres}' THEN
    RAISE EXCEPTION '20261131j: postconditie: drepturile functiilor: %', v_rau;
  END IF;
  -- tabelele: RLS activ (fără FORCE), owner postgres, drepturile EXACTE (doar SELECT pentru authenticated / service_role), fără drepturi pe coloane
  SELECT string_agg(f, ';' ORDER BY f COLLATE "C") INTO v_rau FROM (
    SELECT c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' || pg_get_userbyid(c.relowner) || '|'
           || coalesce((SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(c.relacl::text[]) x)::text, '') AS f
      FROM pg_class c WHERE c.oid IN ('public.red_proiect_drepturi'::regclass, 'public.red_import_ai_jurnal'::regclass)) z;
  IF v_rau IS DISTINCT FROM 'red_import_ai_jurnal|true|false|postgres|{authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=r/postgres};'
                         || 'red_proiect_drepturi|true|false|postgres|{authenticated=r/postgres,postgres=arwdDxtm/postgres,service_role=r/postgres}'
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.red_proiect_drepturi'::regclass, 'public.red_import_ai_jurnal'::regclass)
                 AND a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261131j: postconditie: RLS / owner / drepturile tabelelor: %', v_rau;
  END IF;
  -- politicile EXACTE (doar SELECT pentru authenticated)
  SELECT string_agg(f, ';' ORDER BY f COLLATE "C") INTO v_rau FROM (
    SELECT polrelid::regclass::text || '.' || polname::text || '|' || polcmd::text || '|' || polpermissive::text || '|'
           || (SELECT string_agg(r::regrole::text, ',' ORDER BY r::regrole::text COLLATE "C") FROM unnest(polroles) r) || '|'
           || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') AS f
      FROM pg_policy WHERE polrelid IN ('public.red_proiect_drepturi'::regclass, 'public.red_import_ai_jurnal'::regclass)) z;
  IF v_rau IS DISTINCT FROM
       'red_import_ai_jurnal.red_import_ai_jurnal_sel|r|true|authenticated|((( SELECT auth.uid() AS uid) IS NOT NULL) AND fn_red_import_ai_poate(proiect_id))|;'
    || 'red_proiect_drepturi.red_proiect_drepturi_sel|r|true|authenticated|((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((profile_id = ( SELECT auth.uid() AS uid)) OR (( SELECT fn_red_nivel() AS fn_red_nivel) = ''admin''::text)))|' THEN
    RAISE EXCEPTION '20261131j: postconditie: politicile RLS: %', v_rau;
  END IF;
  -- triggerele: doar jurnalul generic pe red_proiect_drepturi (AFTER INSERT OR UPDATE OR DELETE pe rând), nimic pe jurnalul AI
  SELECT string_agg(f, ';' ORDER BY f COLLATE "C") INTO v_rau FROM (
    SELECT t.tgrelid::regclass::text || '.' || t.tgname::text || '=' || t.tgfoid::regprocedure::text || '/' || t.tgenabled::text || '/' || t.tgtype::text || '/'
           || coalesce(pg_get_expr(t.tgqual, t.tgrelid), '') || '/' || t.tgnargs::text AS f
      FROM pg_trigger t WHERE t.tgrelid IN ('public.red_proiect_drepturi'::regclass, 'public.red_import_ai_jurnal'::regclass) AND NOT t.tgisinternal) z;
  IF v_rau IS DISTINCT FROM 'red_proiect_drepturi.trg_red_jurnal=fn_red_jurnal()/O/29//0' THEN
    RAISE EXCEPTION '20261131j: postconditie: triggerele: %', v_rau;
  END IF;
  -- tabelele noi sunt goale (nimeni nu primește dreptul aici)
  IF EXISTS (SELECT 1 FROM public.red_proiect_drepturi) OR EXISTS (SELECT 1 FROM public.red_import_ai_jurnal) THEN
    RAISE EXCEPTION '20261131j: postconditie: tabelele noi nu sunt goale';
  END IF;
  -- fără sesiune: dreptul e fals, rezervarea refuză fără scriere
  IF public.fn_red_import_ai_poate(gen_random_uuid()) IS NOT FALSE
     OR public.fn_red_import_ai_rezerva(gen_random_uuid(), gen_random_uuid(), repeat('a', 64), repeat('b', 64), 1, 1, 1, 1, 1) ->> 'cod' IS DISTINCT FROM 'neautentificat'
     OR EXISTS (SELECT 1 FROM public.red_import_ai_jurnal) THEN
    RAISE EXCEPTION '20261131j: postconditie: fara sesiune, dreptul / rezervarea nu refuza';
  END IF;
  RAISE NOTICE '20261131j: sfarsit la % ms de la BEGIN; lock-uri tinute de % ms', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::bigint / 1000.0);
END $post$;
