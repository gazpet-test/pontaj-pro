-- Version 20261212120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000 --amprenta-globala <md5> --diferente-globale
--   supabase/migrations/20261212a_redari_fan_awb.l15.tsv (DOAR cu plafon ȘI cu amprenta globală L15 v2: fără pasul „înainte” al runnerului în
--   aceeași tranzacție, migrarea refuză în $pre$ — AMPRENTA_GLOBALA_LIPSA).
-- L15 v2: garanția la aplicare = amprenta GLOBALĂ a runnerului (docs/LIVRARE_L15_V2.md): orice derivă a oricărei funcții, politici, drept sau
--   trigger față de baseline-ul revizuit = refuz, nimic comis. Manifestul .l15.tsv îl generează coordonatorul pe clonă (scripts/livrare_l15_manifest.sh);
--   lista OBIECTELOR pe care trebuie să le conțină (familie, etichetă, operație — scrisă și verificată pe PGlite cu pașii reali ai runnerului) e în
--   supabase/tests/20261212a_redari_fan_awb.l15.obiecte.tsv. Pe lângă ea, migrarea verifică pe amprentă (corp + proprietăți, ÎNAINTE și DUPĂ)
--   singura poartă de drept existentă pe care o cheamă (fn_red_nivel) — listă scrisă, fără citirea corpurilor cu regex.
-- 20261212a_redari_fan_awb — FAN Courier: AWB-urile plicurilor Redări, cu aprobarea owner-ului înainte de orice cost. Proiectare:
--   docs/redari/FANCOURIER_INTEGRARE.md §3–§6. Scrisă de redari@ (06.11.2026), extinsă 17.11.2026 (transportul complet) și adusă la forma
--   livrării L15 v2 pe 17.11.2026 (runda 2 a PR #1118), fără acces la BD.
--
-- De ce tabel separat: red_plicuri.awb + data_expediere sunt legate prin CHECK și marchează „expediat” pe convocări (termenul de 10 zile).
--   Un AWB generat dar neridicat de curier nu e expediere → stă aici până la evenimentul FAN C0, confirmat de om.
-- Minimizare: tabelele NU păstrează numele / telefonul / adresa trimise la FAN și nici răspunsurile FAN brute (confirmarea poate conține numele
--   primitorului; motivul unui refuz FAN = doar numele câmpurilor dintr-o listă albă + un mesaj local, redariFan.mjs::motivRefuzFan), doar
--   hash-ul datelor (sha256 pe JSON canonic, redariFan.mjs::hashPlicFan) și stări.
--
-- Ce face (DOAR obiecte noi, nicio dată existentă atinsă, niciun drept pe tabele existente):
--   * red_fan_setari (un rând: plafonul lotului pilot, implicit 20 = LIMITA_LOT_PILOT_IMPLICITA, test de paritate);
--   * red_fan_loturi (marcajul TEST / real al lotului, decis de owner ÎNAINTE de prima aprobare; prima_aprobare_la / _de puse de BD la PRIMA
--     aprobare și imuabile, iar marcajul nu se mai schimbă după ele — și după o re-propunere, runda 2 P2; trigger BEFORE UPDATE / DELETE);
--   * red_fan_awb (un rând viu pe plic: stări, AWB, tarif, cheia solicitării, urmărirea propusă, versiunea urmăririi — CAS, runda 2);
--   * RPC-urile fn_red_fan_* (scrieri DOAR prin ele, fără GRANT INSERT / UPDATE / DELETE) + funcțiile interne fn_red_fan_e_owner, _suma,
--     _camp, _surse (amprenta SURSELOR unui plic, recalculată de claim în tranzacția rezervării, runda 2) și _loturi_garda (trigger-ul).
--   Un lot de TEST NU scrie expedierea pe plic (fără efect în registru, export și PV), doar în evidența FAN.
-- Identitatea = auth.uid() (L08); niciun parametru de utilizator. Coloanele de autor NU au cheie străină spre profiles (runda 2): o cheie
--   străină ar cere la aplicare un lock SHARE ROW EXCLUSIVE pe profiles (scrierile din toată aplicația oprite); autorul îl pune serverul.
-- Ordinea lock-urilor la rulare (L06), pe toate căile: red_loturi_plicuire FOR UPDATE → red_plicuri ORDER BY id FOR UPDATE → red_fan_awb
--   ORDER BY id FOR UPDATE → red_fan_loturi (rândul lotului). Căile care iau doar o parte din lanț îl iau în aceeași ordine (ex. rezultatele:
--   doar red_fan_awb). red_fan_setari se citește sub lock-ul lotului. Claim-ul CITEȘTE (fără lock) red_convocari / red_detinatori_contact
--   pentru amprenta surselor: o schimbare comisă după claim e „după rezervare” (datele trimise = cele aprobate și verificate la claim).
-- Lock-uri la aplicare (punct unic, NOWAIT, ordine FIXĂ: red_proiecte -> red_loturi_plicuire -> red_plicuri, toate SHARE ROW EXCLUSIVE, cerute de
--   cheile străine; docs/LIVRARE_L15_V2.md §9 „Bugetul de lock”): opresc DOAR scrierile în cele trei tabele Redări (nu citirile, nu FOR SHARE /
--   FOR UPDATE), până la COMMIT — inclusiv pasul „după” al runnerului. Bugetul = 1 s cu ceasul pornit IMEDIAT ÎNAINTEA PRIMEI ÎNCERCĂRI (nu la
--   BEGIN: pasul „înainte” al runnerului nu îl mai consumă), verificat înaintea fiecărei încercări și DUPĂ obținerea setului complet (și pe calea
--   fără coliziune: setul obținut după termen = refuz, nimic schimbat); fiecare încercare e o subtranzacție (un eșec eliberează lock-urile
--   parțiale înaintea pauzei). Inventarul lock-urilor IMPLICITE de după set: la blocul de lock.
-- GĂRZILE DE TIMP reale: plafonul tranzacției = 5000 ms pus de runner înainte de BEGIN (verificat în $pre$; validatorul runnerului cere ca
--   runnerul să dea exact plafonul de aici), lock_timeout = 100 ms, bugetul lock-urilor de 1 s și garda finală a runnerului. 5000 = plafonul
--   livrărilor cu amprenta globală L15 v2 (decizia proprietarului, 17.11.2026; docs/LIVRARE_L15_V2.md §9), de confirmat prin proba cu ROLLBACK.
-- Revenire: supabase/revenire/20261212a_redari_fan_awb_ROLLBACK.sql (prin runner, plafonul ei; refuză cu AWB-uri / loturi marcate / setări schimbate).
-- Probe: scripts/pglite/test_redari_fan_awb_local.mjs (PGlite, cu pașii reali L15 v2 ai runnerului: comportament, mutanți, refuzuri, revenire)
--   + supabase/tests/20261212a_redari_fan_doua_sesiuni.sh (DOUĂ sesiuni reale, pe clonă: claim concurent, contact schimbat, roluri, RLS).
DO $pre$
DECLARE v_plafon text; r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261212a_redari_fan_awb:' || txid_current() THEN
    RAISE EXCEPTION '20261212a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261212a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20261212a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261212a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '5000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '5000:' || txid_current() THEN
    RAISE EXCEPTION '20261212a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 5000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 5000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  -- L15 v2: pasul „înainte” al runnerului a rulat în ACEASTĂ tranzacție (tabelul lui temporar, cu tag aleator, CREAT de tranzacția curentă și
  -- blocat de ea; tiparul 20261225a). Fără --amprenta-globala / --diferente-globale (sau în afara runnerului) = refuz.
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20261212a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF to_regclass('public.red_fan_awb') IS NOT NULL OR to_regclass('public.red_fan_loturi') IS NOT NULL OR to_regclass('public.red_fan_setari') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') THEN
    RAISE EXCEPTION '20261212a: obiectele exista deja (reaplicare)';
  END IF;
  -- coloanele citite / scrise de funcții și de cheile străine, cu tipurile din migrările lor (20261126a, 20261129i)
  FOR r IN SELECT * FROM (VALUES
      ('profiles', 'id', '^uuid$'), ('profiles', 'is_owner', '^boolean$'),
      ('red_proiecte', 'id', '^uuid$'), ('red_proiecte', 'cod', '^text$'),
      ('red_loturi_plicuire', 'id', '^uuid$'), ('red_loturi_plicuire', 'proiect_id', '^uuid$'),
      ('red_plicuri', 'id', '^uuid$'), ('red_plicuri', 'proiect_id', '^uuid$'), ('red_plicuri', 'lot_id', '^uuid$'), ('red_plicuri', 'nr_plic', '^text$'),
      ('red_plicuri', 'destinatar_nume', '^text$'), ('red_plicuri', 'stare', '^text$'), ('red_plicuri', 'awb', '^text$'), ('red_plicuri', 'data_expediere', '^date$'),
      ('red_convocari', 'plic_id', '^uuid$'), ('red_convocari', 'detinator_id', '^uuid$'), ('red_convocari', 'stare', '^text$'),
      ('red_convocari', 'sters_la', '^timestamp with time zone$'),
      ('red_detinatori_contact', 'detinator_id', '^uuid$'), ('red_detinatori_contact', 'telefon', '^text$'), ('red_detinatori_contact', 'adresa_strada', '^text$'),
      ('red_detinatori_contact', 'adresa_sat', '^text$'), ('red_detinatori_contact', 'adresa_comuna', '^text$'), ('red_detinatori_contact', 'adresa_judet', '^text$'),
      ('red_detinatori_contact', 'cod_postal', '^text$')
    ) v(t, c, tip) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR v_tip !~ r.tip THEN
      RAISE EXCEPTION '20261212a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tip;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL
     OR (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('auth.uid()')) IS DISTINCT FROM 'uuid'::regtype::oid
     OR NOT pg_has_role('postgres', 'authenticated', 'USAGE') OR NOT pg_has_role('postgres', 'anon', 'USAGE') THEN
    RAISE EXCEPTION '20261212a: dependentele (auth.uid, rolurile aplicatiei) lipsesc sau difera';
  END IF;
END $pre$;

-- ── poarta de drept existentă chemată de politici / propunere (fn_red_nivel, 20261126a), cu amprenta corpului (fără CR) + proprietățile,
-- ÎNAINTE și DUPĂ. Garanția completă (orice altă funcție / politică / drept) e amprenta globală L15 v2 a runnerului.
CREATE FUNCTION pg_temp.lant_20261212a(p_moment text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $lant$
DECLARE v_rau text;
BEGIN
  SELECT string_agg(a.semnatura, ', ' ORDER BY a.semnatura) INTO v_rau
    FROM (VALUES ('public.fn_red_nivel()', '21db8e5d4b69b7f19e571a7087c361ae')) a(semnatura, amprenta)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
   WHERE p.oid IS NULL
      OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
      OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname = 'sql')
      OR p.prosecdef IS DISTINCT FROM true
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR p.prorettype IS DISTINCT FROM 'text'::regtype::oid
      OR p.provolatile IS DISTINCT FROM 's'
      OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_rau IS NOT NULL THEN
    RAISE EXCEPTION '20261212a: poarta de drept (%) difera de amprenta revizuita: %', p_moment, v_rau;
  END IF;
END $lant$;
DO $l15_inainte$ BEGIN PERFORM pg_temp.lant_20261212a('inainte'); END $l15_inainte$;

-- ── punctul UNIC de blocare (L06), după verificările de catalog. Ordinea FIXĂ (aceeași la fiecare încercare): red_proiecte, red_loturi_plicuire,
-- red_plicuri, toate SHARE ROW EXCLUSIVE (cheile străine ale tabelelor noi). Lock-urile IMPLICITE ale corpului, după set (inventarul complet):
--   (a) pe relațiile setului, deja ținute la fel de tare sau mai tare: cheile străine la CREATE TABLE (SHARE ROW EXCLUSIVE pe red_proiecte /
--       red_loturi_plicuire / red_plicuri) și ACCESS SHARE din validarea corpurilor sql (fn_red_fan_surse citește red_plicuri / red_proiecte);
--   (b) ÎN AFARA setului, doar ACCESS SHARE (intră în conflict doar cu ACCESS EXCLUSIVE: DDL, VACUUM FULL, LOCK): validarea la CREATE FUNCTION a
--       corpurilor LANGUAGE sql — fn_red_fan_e_owner pe profiles, fn_red_fan_surse pe red_convocari și red_detinatori_contact —, citirile
--       din postcondiții (catalog + tabelele noi) și cele ale amprentei poartei de drept (doar catalog). Corpurile plpgsql nu se analizează la
--       creare (fără lock-uri). Tabelele noi (creare, index, trigger, INSERT-ul rândului de setări) nu sunt vizibile altor sesiuni până la COMMIT.
--   Nicio cheie străină spre profiles (fără SHARE ROW EXCLUSIVE pe profiles). Nicio funcție creată nu rulează la aplicare.
--   Fiecare așteptare implicită e limitată de lock_timeout = 100 ms (apoi eroare, tranzacția anulată, nimic comis), ținând setul.
-- Momentul obținerii (gazpet.lock_puternic_la, µs de la epoch) îl citește garda finală a runnerului (LOCK_TINUT). ──
DO $lock$
DECLARE v_incercari integer := 0; v_t0 timestamptz := clock_timestamp(); v_buget constant interval := interval '1 second';
BEGIN
  LOOP
    IF clock_timestamp() >= v_t0 + v_buget THEN
      RAISE EXCEPTION '20261212a: BUGET_LOCK: % incercari, % ms de la prima incercare (bugetul lock-urilor e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
        v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), round(extract(epoch FROM clock_timestamp() - now()) * 1000)
        USING ERRCODE = '55P03';
    END IF;
    v_incercari := v_incercari + 1;
    BEGIN
      LOCK TABLE public.red_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_loturi_plicuire IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      LOCK TABLE public.red_plicuri IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
  IF clock_timestamp() >= v_t0 + v_buget THEN
    RAISE EXCEPTION '20261212a: BUGET_LOCK: lock-urile obtinute abia la % ms de la prima incercare (% incercari; bugetul e 1 s de la prima incercare; % ms de la BEGIN); nimic schimbat',
      round(extract(epoch FROM clock_timestamp() - v_t0) * 1000), v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000)
      USING ERRCODE = '55P03';
  END IF;
  PERFORM set_config('gazpet.lock_puternic_la', round(extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text, true);
  RAISE NOTICE '20261212a: lock la % ms de la BEGIN (% incercari, % ms de la prima incercare)', round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    v_incercari, round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $lock$;

-- ─── setările FAN (un singur rând) ───
CREATE TABLE public.red_fan_setari (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  limita_lot integer NOT NULL DEFAULT 20 CHECK (limita_lot BETWEEN 1 AND 2000),
  actualizat_de uuid,
  actualizat_la timestamptz,
  CONSTRAINT red_fan_setari_autor CHECK ((actualizat_de IS NULL) = (actualizat_la IS NULL))
);
INSERT INTO public.red_fan_setari (id) VALUES (true);
COMMENT ON TABLE public.red_fan_setari IS 'Redări FAN Courier: setări (plafonul lotului pilot). Un rând; scris doar prin fn_red_fan_setari_seteaza (owner).';

-- ─── loturile trimise prin FAN: marcajul de TEST, imuabil după PRIMA aprobare (istoric, nu după stările curente) ───
CREATE TABLE public.red_fan_loturi (
  lot_id uuid PRIMARY KEY REFERENCES public.red_loturi_plicuire(id),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  test boolean NOT NULL,
  marcat_de uuid NOT NULL,
  marcat_la timestamptz NOT NULL DEFAULT now(),
  prima_aprobare_la timestamptz,
  prima_aprobare_de uuid,
  CONSTRAINT red_fan_loturi_prima_aprobare CHECK ((prima_aprobare_la IS NULL) = (prima_aprobare_de IS NULL))
);
COMMENT ON TABLE public.red_fan_loturi IS 'Redări FAN Courier: decizia owner-ului „lot de TEST / lot real”, înainte de aprobare; imuabilă după PRIMA aprobare (prima_aprobare_la, pusă de fn_red_fan_aproba).';

-- gardă pe ORICE cale (L07): după prima aprobare nimic din rând nu se mai schimbă; marcajul nu se șterge
CREATE FUNCTION public.fn_red_fan_loturi_garda() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'redari fan: marcajul unui lot nu se sterge' USING ERRCODE = '42501'; END IF;
  IF NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.proiect_id IS DISTINCT FROM OLD.proiect_id
     OR (OLD.prima_aprobare_la IS NOT NULL AND (NEW.test IS DISTINCT FROM OLD.test OR NEW.prima_aprobare_la IS DISTINCT FROM OLD.prima_aprobare_la
         OR NEW.prima_aprobare_de IS DISTINCT FROM OLD.prima_aprobare_de OR NEW.marcat_de IS DISTINCT FROM OLD.marcat_de OR NEW.marcat_la IS DISTINCT FROM OLD.marcat_la)) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; marcajul de test nu se mai schimba' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_red_fan_loturi_garda BEFORE UPDATE OR DELETE ON public.red_fan_loturi FOR EACH ROW EXECUTE FUNCTION public.fn_red_fan_loturi_garda();

CREATE TABLE public.red_fan_awb (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proiect_id uuid NOT NULL REFERENCES public.red_proiecte(id),
  lot_id uuid NOT NULL REFERENCES public.red_loturi_plicuire(id),
  plic_id uuid NOT NULL REFERENCES public.red_plicuri(id),
  nr_plic text NOT NULL CHECK (nr_plic ~ '^PL-[A-Z]{3}-[0-9]{4}$'),
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus', 'aprobat', 'in_curs', 'generat', 'eroare', 'necunoscut', 'anulat', 'ridicat')),
  hash_date text NOT NULL CHECK (hash_date ~ '^[0-9a-f]{64}$'),
  tarif_estimat numeric(12,4) CHECK (tarif_estimat IS NULL OR tarif_estimat >= 0),
  awb text CHECK (awb IS NULL OR awb ~ '^[0-9]{6,20}$'),
  tarif numeric(12,4) CHECK (tarif IS NULL OR tarif >= 0),
  tva numeric(12,4) CHECK (tva IS NULL OR tva >= 0),
  -- o cheie per SOLICITARE către FAN (≤ 100 de rânduri împart aceeași cheie): pusă la claim, înainte de apelul plătit (L04/L22)
  cerere_id uuid,
  motiv text CHECK (motiv IS NULL OR length(motiv) <= 500),
  -- urmărirea (propuneri din răspunsurile FAN; ridicarea / AR-ul / returul le confirmă omul)
  urmarire_stare text NOT NULL DEFAULT 'neurmarit' CHECK (urmarire_stare IN ('neurmarit', 'fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')),
  ultim_eveniment text CHECK (ultim_eveniment IS NULL OR ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$'),
  ultim_eveniment_la timestamptz,
  ridicat_propus date,
  livrat_la timestamptz,
  -- motivul de retur PROPUS (aceleași coduri ca red_plicuri.retur, fără „decedat” / „altul”, care cer judecată umană)
  retur_propus text CHECK (retur_propus IS NULL OR retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta')),
  confirmare_stare text NOT NULL DEFAULT 'nesolicitata' CHECK (confirmare_stare IN ('nesolicitata', 'lipsa', 'primita_de_verificat', 'forma_necunoscuta')),
  urmarit_la timestamptz,
  -- versiunea urmăririi / confirmărilor (runda 2, L03): o scriere = +1; scrierea cere versiunea citită (CAS), altfel rândul e „depășit”
  versiune_urmarire integer NOT NULL DEFAULT 0 CHECK (versiune_urmarire >= 0),
  propus_de uuid NOT NULL DEFAULT auth.uid(),
  aprobat_de uuid,
  aprobat_la timestamptz,
  generat_la timestamptz,
  ridicat_la timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT red_fan_awb_aprobare CHECK (stare IN ('propus', 'eroare', 'anulat') OR (aprobat_de IS NOT NULL AND aprobat_la IS NOT NULL)),
  -- Jakarinos r1 P2 (L20): AWB doar în generat / ridicat (sau anulat după ștergerea din FAN); fără AWB în celelalte stări
  CONSTRAINT red_fan_awb_generat CHECK (
    (stare IN ('generat', 'ridicat') AND awb IS NOT NULL AND generat_la IS NOT NULL)
    OR (stare IN ('propus', 'aprobat', 'in_curs', 'eroare', 'necunoscut') AND awb IS NULL)
    OR stare = 'anulat'),
  CONSTRAINT red_fan_awb_ridicat CHECK ((stare = 'ridicat') = (ridicat_la IS NOT NULL) OR stare = 'anulat'),
  CONSTRAINT red_fan_awb_in_curs CHECK (stare NOT IN ('in_curs', 'necunoscut', 'generat', 'ridicat') OR cerere_id IS NOT NULL),
  CONSTRAINT red_fan_awb_urmarire CHECK (awb IS NOT NULL OR (urmarire_stare = 'neurmarit' AND confirmare_stare = 'nesolicitata'
    AND ultim_eveniment IS NULL AND ultim_eveniment_la IS NULL AND ridicat_propus IS NULL AND livrat_la IS NULL AND retur_propus IS NULL AND urmarit_la IS NULL))
);
-- un singur AWB „viu” pe plic (L16); AWB-ul FAN e unic
CREATE UNIQUE INDEX red_fan_awb_plic_viu_uq ON public.red_fan_awb (plic_id) WHERE stare NOT IN ('eroare', 'anulat');
CREATE UNIQUE INDEX red_fan_awb_awb_uq ON public.red_fan_awb (awb) WHERE awb IS NOT NULL;
CREATE INDEX red_fan_awb_lot_ix ON public.red_fan_awb (lot_id, id);
CREATE INDEX red_fan_awb_cerere_ix ON public.red_fan_awb (cerere_id) WHERE cerere_id IS NOT NULL;
COMMENT ON TABLE public.red_fan_awb IS 'Redări FAN Courier: AWB-uri pe plic, aprobate de owner înainte de cost; fără PII (doar hash-ul datelor trimise). Scrieri doar prin fn_red_fan_*.';

ALTER TABLE public.red_fan_setari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_loturi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.red_fan_awb ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.red_fan_setari, public.red_fan_loturi, public.red_fan_awb TO authenticated, service_role;
CREATE POLICY red_fan_setari_citire ON public.red_fan_setari FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_loturi_citire ON public.red_fan_loturi FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));
CREATE POLICY red_fan_awb_citire ON public.red_fan_awb FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.fn_red_nivel() IN ('admin', 'editor'));

CREATE FUNCTION public.fn_red_fan_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE);
$fn$;

-- Sumă de bani din răspunsul FAN: se păstrează exact sau deloc (L18: necunoscut, nu rotunjit în tăcere).
CREATE FUNCTION public.fn_red_fan_suma(p numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN p IS NOT NULL AND p >= 0 AND p < 100000000 AND p = round(p, 4) THEN p END;
$fn$;

-- Un câmp al textului canonic al surselor: NULL → „-”, altfel „<octeți UTF-8>:<valoare>” (redariFan.mjs::textSursePlic, paritate pe PGlite, L19).
CREATE FUNCTION public.fn_red_fan_camp(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN p IS NULL THEN '-' ELSE octet_length(p)::text || ':' || p END;
$fn$;

-- Amprenta SURSELOR unui plic (runda 2, „Bani”): sha256 pe textul canonic al câmpurilor brute din care se construiește expedierea — codul
-- proiectului, plicul (număr, destinatar, stare, lot) și, pentru FIECARE deținător distinct al convocărilor active, neșterse, din plic (după id
-- ca text, „C”), rândul de contact (are / nu are; telefon, adresa, cod poștal). Aceeași formă ca redariFan.mjs::textSursePlic (L19).
CREATE FUNCTION public.fn_red_fan_surse(p_plic_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT encode(sha256(convert_to('redari-fan-surse-v1' || public.fn_red_fan_camp(pr.cod) || public.fn_red_fan_camp(pl.nr_plic)
           || public.fn_red_fan_camp(pl.destinatar_nume) || public.fn_red_fan_camp(pl.stare) || public.fn_red_fan_camp(pl.lot_id::text)
           || coalesce((SELECT string_agg(public.fn_red_fan_camp(d.id) || CASE WHEN ct.detinator_id IS NULL THEN 'x' ELSE 'c' END
                  || public.fn_red_fan_camp(ct.telefon) || public.fn_red_fan_camp(ct.adresa_strada) || public.fn_red_fan_camp(ct.adresa_sat)
                  || public.fn_red_fan_camp(ct.adresa_comuna) || public.fn_red_fan_camp(ct.adresa_judet) || public.fn_red_fan_camp(ct.cod_postal),
                  '' ORDER BY d.id COLLATE "C")
                FROM (SELECT DISTINCT cv.detinator_id::text AS id FROM public.red_convocari cv
                       WHERE cv.plic_id = pl.id AND cv.stare = 'activ' AND cv.sters_la IS NULL) d
                LEFT JOIN public.red_detinatori_contact ct ON ct.detinator_id::text = d.id), ''), 'UTF8')), 'hex')
    FROM public.red_plicuri pl JOIN public.red_proiecte pr ON pr.id = pl.proiect_id
   WHERE pl.id = p_plic_id;
$fn$;

-- (0a) Plafonul lotului pilot (DOAR owner).
CREATE FUNCTION public.fn_red_fan_setari_seteaza(p_limita integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul schimba setarile' USING ERRCODE = '42501'; END IF;
  IF p_limita IS NULL OR p_limita < 1 OR p_limita > 2000 THEN RAISE EXCEPTION 'redari fan: plafon invalid (1..2000)' USING ERRCODE = '22023'; END IF;
  UPDATE public.red_fan_setari SET limita_lot = p_limita, actualizat_de = auth.uid(), actualizat_la = now() WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: randul de setari lipseste' USING ERRCODE = 'P0002'; END IF;
  RETURN p_limita;
END $fn$;

-- (0b) Marcajul lotului: TEST sau real (DOAR owner), înainte de PRIMA aprobare (istoric: prima_aprobare_la); după aceea e imuabil
-- (și trigger-ul îl păzește). Lock: lot FOR UPDATE → red_fan_loturi.
CREATE FUNCTION public.fn_red_fan_lot_marcheaza(p_lot_id uuid, p_test boolean) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_lot record; v_vechi record;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul marcheaza lotul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_test IS NULL THEN RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  SELECT id, proiect_id INTO v_lot FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF v_lot.id IS NULL THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT lot_id, test, prima_aprobare_la INTO v_vechi FROM public.red_fan_loturi WHERE lot_id = p_lot_id FOR UPDATE;
  IF v_vechi.lot_id IS NOT NULL AND v_vechi.test = p_test THEN RETURN p_test; END IF;   -- repetare = no-op
  IF v_vechi.prima_aprobare_la IS NOT NULL OR EXISTS (SELECT 1 FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat')) THEN
    RAISE EXCEPTION 'redari fan: lotul a fost aprobat o data; marcajul de test nu se mai schimba' USING ERRCODE = 'P0001'; END IF;
  IF v_vechi.lot_id IS NULL THEN
    INSERT INTO public.red_fan_loturi (lot_id, proiect_id, test, marcat_de) VALUES (p_lot_id, v_lot.proiect_id, p_test, auth.uid());
  ELSE
    UPDATE public.red_fan_loturi SET test = p_test, marcat_de = auth.uid(), marcat_la = now() WHERE lot_id = p_lot_id;
  END IF;
  RETURN p_test;
END $fn$;

-- (1) Propunere (admin/editor): un rând „propus” pe plic, cu hash-ul datelor și tariful estimat (opțional).
-- Re-propunerea unui rând „aprobat” (datele s-au schimbat după aprobare) îl readuce la „propus” și șterge aprobarea rândului (NU și
-- prima aprobare a lotului: marcajul rămâne imuabil). Lock: lot FOR UPDATE → plic FOR UPDATE → rândul viu al plicului FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_propune(p_plic_id uuid, p_hash text, p_tarif_estimat numeric) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic record; v_rand record; v_id uuid; v_lot uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN RAISE EXCEPTION 'redari fan: fara drept' USING ERRCODE = '42501'; END IF;
  IF p_plic_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR (p_tarif_estimat IS NOT NULL AND public.fn_red_fan_suma(p_tarif_estimat) IS NULL) THEN
    RAISE EXCEPTION 'redari fan: parametri invalizi' USING ERRCODE = '22023'; END IF;
  -- Jakarinos r2 P2 (L06): lotul se blochează ÎNAINTE de plic (ca în fn_red_fan_aproba); INSERT-ul ar lua altfel lock FK pe lot după plic
  SELECT lot_id INTO v_lot FROM public.red_plicuri WHERE id = p_plic_id;
  IF v_lot IS NOT NULL THEN PERFORM 1 FROM public.red_loturi_plicuire WHERE id = v_lot FOR UPDATE; END IF;
  SELECT id, proiect_id, lot_id, nr_plic, stare, data_expediere, awb INTO v_plic FROM public.red_plicuri WHERE id = p_plic_id FOR UPDATE;
  IF v_plic.id IS NULL THEN RAISE EXCEPTION 'redari fan: plic inexistent' USING ERRCODE = 'P0002'; END IF;
  IF v_plic.lot_id IS DISTINCT FROM v_lot THEN RAISE EXCEPTION 'redari fan: plicul s-a mutat intre loturi chiar acum; reincercati' USING ERRCODE = '55P03'; END IF;
  IF v_plic.stare <> 'activ' OR v_plic.data_expediere IS NOT NULL OR v_plic.awb IS NOT NULL OR v_plic.lot_id IS NULL THEN
    RAISE EXCEPTION 'redari fan: plicul nu e activ, neexpediat si intr-un lot' USING ERRCODE = 'P0001'; END IF;
  SELECT id, stare INTO v_rand FROM public.red_fan_awb WHERE plic_id = p_plic_id AND stare NOT IN ('eroare', 'anulat') FOR UPDATE;
  IF v_rand.id IS NOT NULL THEN
    IF v_rand.stare NOT IN ('propus', 'aprobat') THEN RAISE EXCEPTION 'redari fan: plicul are deja un AWB % (nu se re-propune)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_fan_awb SET stare = 'propus', hash_date = p_hash, tarif_estimat = p_tarif_estimat, propus_de = auth.uid(),
           aprobat_de = NULL, aprobat_la = NULL, updated_at = now() WHERE id = v_rand.id;
    RETURN v_rand.id;
  END IF;
  INSERT INTO public.red_fan_awb (proiect_id, lot_id, plic_id, nr_plic, hash_date, tarif_estimat)
    VALUES (v_plic.proiect_id, v_plic.lot_id, p_plic_id, v_plic.nr_plic, p_hash, p_tarif_estimat) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- (2) Aprobare (DOAR owner): lista exactă de rânduri + hash-uri văzute în ecran; orice diferență = refuz (L01/CAS).
-- Cere marcajul lotului (test / real) și respectă plafonul lotului pilot; pune prima_aprobare_la (o singură dată, imuabilă).
-- Lock: lot FOR UPDATE → plicuri ORDER BY id → rânduri ORDER BY id → red_fan_loturi.
CREATE FUNCTION public.fn_red_fan_aproba(p_lot_id uuid, p_ids uuid[], p_hashuri text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_deja integer; v_limita integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul aproba' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) > 2000
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'redari fan: lista invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN
    RAISE EXCEPTION 'redari fan: alege intai daca lotul e de TEST sau real' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  -- Jakarinos r1 P1: plicul trebuie să fie ÎNCĂ activ, neexpediat și în același lot (hash-ul datelor nu dovedește starea plicului)
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'propus' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN RAISE EXCEPTION 'redari fan: % din % randuri s-au schimbat de la previzualizare; reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- lotul pilot: plicurile deja aprobate / trimise din lot + cele de acum ≤ plafon
  SELECT count(*) INTO v_deja FROM public.red_fan_awb WHERE lot_id = p_lot_id AND stare NOT IN ('propus', 'eroare', 'anulat');
  SELECT limita_lot INTO v_limita FROM public.red_fan_setari WHERE id;
  IF v_limita IS NULL THEN RAISE EXCEPTION 'redari fan: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF v_deja + v_n > v_limita THEN
    RAISE EXCEPTION 'redari fan: lotul ar avea % plicuri aprobate, peste plafonul lotului pilot (%)', v_deja + v_n, v_limita USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'aprobat', aprobat_de = auth.uid(), aprobat_la = now(), updated_at = now() WHERE id = ANY(p_ids);
  UPDATE public.red_fan_loturi SET prima_aprobare_la = now(), prima_aprobare_de = auth.uid() WHERE lot_id = p_lot_id AND prima_aprobare_la IS NULL;
  RETURN v_n;
END $fn$;

-- (3) Claim înainte de UN apel plătit (DOAR owner, din funcția edge cu JWT-ul lui): ≤ 100 de rânduri aprobate → in_curs, O cheie nouă
-- pe solicitare (L04/L22). p_hashuri = hash-urile recalculate din datele CURENTE (≠ aprobate → refuz total); p_surse = amprenta SURSELOR
-- citite de funcția edge, RECALCULATĂ aici, în tranzacția rezervării (runda 2): o schimbare a contactelor între citire și claim = refuz total.
-- Un plic cu AWB (aici sau pe plic) nu ajunge aici: doar „aprobat” se rezervă, iar un singur rând viu pe plic (index unic).
-- Lock: lot FOR UPDATE → plicuri ORDER BY id FOR UPDATE → rânduri ORDER BY id FOR UPDATE (convocările / contactele doar citite).
CREATE FUNCTION public.fn_red_fan_claim_lot(p_lot_id uuid, p_ids uuid[], p_hashuri text[], p_surse text[]) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_cerere uuid := gen_random_uuid(); v_n integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul genereaza' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_ids IS NULL OR p_hashuri IS NULL OR p_surse IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 100
     OR cardinality(p_ids) <> cardinality(p_hashuri) OR cardinality(p_ids) <> cardinality(p_surse)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids) OR array_position(p_ids, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(p_surse) s WHERE s IS NULL OR s !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'redari fan: solicitare invalida (1..100 randuri distincte, cu hash si amprenta surselor)' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_loturi_plicuire WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: lot inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.red_fan_loturi WHERE lot_id = p_lot_id) THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id IN (SELECT plic_id FROM public.red_fan_awb WHERE id = ANY(p_ids)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.red_fan_awb WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;
  -- Jakarinos r1 P1: plicul anulat / expediat manual / mutat din lot după aprobare → nu se mai plătește un AWB
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_hashuri) AS t(id, h) ON t.id = a.id
    JOIN public.red_plicuri pl ON pl.id = a.plic_id
   WHERE a.lot_id = p_lot_id AND a.stare = 'aprobat' AND a.hash_date = t.h
     AND pl.stare = 'activ' AND pl.data_expediere IS NULL AND pl.awb IS NULL AND pl.lot_id = a.lot_id;
  IF v_n <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'redari fan: % din % randuri nu mai sunt aprobate cu aceleasi date (plic schimbat, anulat sau deja trimis)', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  -- runda 2: sursele (plicul + contactele tuturor deținătorilor lui), recalculate ACUM, = cele din care funcția edge a construit expedierea
  SELECT count(*) INTO v_n FROM public.red_fan_awb a JOIN unnest(p_ids, p_surse) AS t(id, s) ON t.id = a.id
   WHERE public.fn_red_fan_surse(a.plic_id) IS NOT DISTINCT FROM t.s;
  IF v_n <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'redari fan: datele de contact / plicul s-au schimbat la % din % randuri dupa citire; nimic rezervat, reincarca', cardinality(p_ids) - v_n, cardinality(p_ids) USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb SET stare = 'in_curs', cerere_id = v_cerere, motiv = NULL, updated_at = now() WHERE id = ANY(p_ids);
  RETURN v_cerere;
END $fn$;

-- (4) Rezultatele UNEI solicitări (DOAR owner), toate odată (L02): exact rândurile „in_curs” ale cheii, fiecare generat / eroare / necunoscut.
-- CAS pe cheie + stare: un rezultat vechi sau străin = refuz, nimic scris. 'necunoscut' NU se reîncearcă automat (L05): reconciliere.
-- Lock: rânduri ORDER BY id FOR UPDATE (subșir al ordinii L06).
CREATE FUNCTION public.fn_red_fan_rezultate(p_cerere uuid, p_rezultate jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Fără tabele temporare: într-o funcție DEFINER un tabel pg_temp cu același nume, creat dinainte de apelant, ar fi folosit în locul lui.
DECLARE v_asteptate integer; v_n integer; v_bune integer; v_dist integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_cerere IS NULL OR p_rezultate IS NULL OR jsonb_typeof(p_rezultate) <> 'array' OR jsonb_array_length(p_rezultate) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: rezultate invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE cerere_id = p_cerere ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_asteptate FROM public.red_fan_awb WHERE cerere_id = p_cerere AND stare = 'in_curs';
  SELECT count(*), count(*) FILTER (WHERE r.id IS NOT NULL AND r.stare IN ('generat', 'eroare', 'necunoscut')
           AND ((r.stare = 'generat' AND r.awb ~ '^[0-9]{6,20}$') OR (r.stare <> 'generat' AND r.awb IS NULL))
           AND (r.tarif IS NULL OR r.tarif >= 0) AND (r.tva IS NULL OR r.tva >= 0)), count(DISTINCT r.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: rezultat invalid' USING ERRCODE = '22023'; END IF;
  IF v_asteptate = 0 OR v_n <> v_asteptate OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rezultate) AS r(id uuid)
       LEFT JOIN public.red_fan_awb a ON a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs' WHERE a.id IS NULL) THEN
    RAISE EXCEPTION 'redari fan: rezultat vechi, partial sau cheie straina (CAS)' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET stare = r.stare, awb = r.awb, tarif = public.fn_red_fan_suma(r.tarif), tva = public.fn_red_fan_suma(r.tva), motiv = left(r.motiv, 500),
         generat_la = CASE WHEN r.stare = 'generat' THEN now() END, updated_at = now()
    FROM jsonb_to_recordset(p_rezultate) AS r(id uuid, stare text, awb text, tarif numeric, tva numeric, motiv text)
   WHERE a.id = r.id AND a.cerere_id = p_cerere AND a.stare = 'in_curs';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_asteptate THEN RAISE EXCEPTION 'redari fan: rezultat partial (CAS)' USING ERRCODE = 'P0001'; END IF;
  RETURN v_n;
END $fn$;

-- (5) Reconciliere (DOAR owner) — Jakarinos r1 P1 (L05): un claim al cărui rezultat nu s-a confirmat (in_curs rămas după pierderea
-- răspunsului, sau „necunoscut”) se închide DOAR după ce omul a verificat borderoul zilei în FAN (GET /reports/awb, după nr_plic):
-- p_awb găsit → generat; p_awb NULL + motivul verificării = „confirmat că nu există în FAN” → eroare (se poate re-propune).
-- Ecranul oferă confirmarea absenței DOAR când propunerea e „lipsa” (borderou citit complet, fiecare element interpretat — runda 2 P1).
-- Fără retry automat al generării. in_curs se reconciliază doar după 10 minute (să nu concureze cu o generare în desfășurare).
CREATE FUNCTION public.fn_red_fan_reconciliaza(p_id uuid, p_awb text, p_tarif numeric, p_tva numeric, p_motiv text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_rand record; v_stare text;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR (p_awb IS NOT NULL AND p_awb !~ '^[0-9]{6,20}$') OR (p_awb IS NULL AND coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'redari fan: reconciliere invalida (AWB valid sau motivul verificarii)' USING ERRCODE = '22023'; END IF;
  SELECT id, stare, updated_at INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  IF v_rand.id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  IF NOT (v_rand.stare = 'necunoscut' OR (v_rand.stare = 'in_curs' AND v_rand.updated_at < now() - interval '10 minutes')) THEN
    RAISE EXCEPTION 'redari fan: doar randurile necunoscute (sau in curs de peste 10 minute) se reconciliaza' USING ERRCODE = 'P0001'; END IF;
  v_stare := CASE WHEN p_awb IS NOT NULL THEN 'generat' ELSE 'eroare' END;
  UPDATE public.red_fan_awb SET stare = v_stare, awb = p_awb, tarif = public.fn_red_fan_suma(p_tarif), tva = public.fn_red_fan_suma(p_tva), motiv = left(p_motiv, 500),
         generat_la = CASE WHEN p_awb IS NOT NULL THEN now() END, updated_at = now()
   WHERE id = p_id;
  RETURN v_stare;
END $fn$;

-- (6) Ridicarea de către curier (eveniment FAN C0, CONFIRMAT de om), DOAR owner, atomic (L02): rândul FAN → ridicat ȘI, pentru un lot
-- REAL, plicul → awb + data_expediere (trigger-ele existente ale plicului propagă expedierea pe convocări). Un lot de TEST nu scrie pe plic.
-- p_data = data C0 în București, nu înainte de generare. Repetarea pe același AWB = no-op. Ordinea L06: plic FOR UPDATE → rând FOR UPDATE.
CREATE FUNCTION public.fn_red_fan_ridicat(p_id uuid, p_data date) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid; v_pl record; v_rand record; v_test boolean;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_data IS NULL OR p_data > (now() AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: data ridicarii invalida' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  SELECT id, stare, awb, data_expediere INTO v_pl FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  SELECT id, stare, awb, ridicat_la, generat_la, lot_id INTO v_rand FROM public.red_fan_awb WHERE id = p_id FOR UPDATE;
  SELECT test INTO v_test FROM public.red_fan_loturi WHERE lot_id = v_rand.lot_id;
  IF v_test IS NULL THEN RAISE EXCEPTION 'redari fan: lot nemarcat (test / real)' USING ERRCODE = 'P0001'; END IF;
  IF v_rand.stare = 'ridicat' AND (v_test OR v_pl.awb IS NOT DISTINCT FROM v_rand.awb) THEN RETURN; END IF;   -- C0 repetat
  IF v_rand.stare <> 'generat' THEN RAISE EXCEPTION 'redari fan: doar un AWB generat poate fi ridicat (stare %)', v_rand.stare USING ERRCODE = 'P0001'; END IF;
  IF p_data < (v_rand.generat_la AT TIME ZONE 'Europe/Bucharest')::date THEN RAISE EXCEPTION 'redari fan: ridicarea nu poate fi inainte de generarea AWB-ului' USING ERRCODE = '22023'; END IF;
  IF NOT v_test THEN
    IF v_pl.stare <> 'activ' OR v_pl.data_expediere IS NOT NULL OR v_pl.awb IS NOT NULL THEN
      RAISE EXCEPTION 'redari fan: plicul e anulat sau are deja o expediere inregistrata; verificare manuala' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.red_plicuri SET awb = v_rand.awb, data_expediere = p_data WHERE id = v_plic_id;
  END IF;
  UPDATE public.red_fan_awb SET stare = 'ridicat', ridicat_la = (p_data::timestamp AT TIME ZONE 'Europe/Bucharest'), updated_at = now() WHERE id = p_id;
END $fn$;

-- (7) Urmărirea (DOAR owner, din funcția edge): ≤ 100 de rânduri ale lotului, fiecare cu AWB-ul lui și VERSIUNEA de urmărire citită;
-- scrie DOAR câmpurile de urmărire (propuneri). Orice rând străin / AWB diferit / valoare în afara listei = refuz total. Runda 2 (L03):
-- un rând se scrie doar dacă versiunea e încă cea citită ȘI evenimentul nu e mai vechi decât cel scris; altfel e „depășit” (nescris,
-- numărat). Datele locale vin ca text „AAAA-LL-ZZ HH:MM:SS” (ora României, L17). Întoarce {scrise, depasite}. Lock: rânduri ORDER BY id.
CREATE FUNCTION public.fn_red_fan_urmarire(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE u.id IS NOT NULL AND u.awb ~ '^[0-9]{6,20}$' AND u.versiune IS NOT NULL AND u.versiune >= 0
           AND u.urmarire_stare IN ('fara_evenimente', 'in_tranzit', 'ridicat', 'livrat', 'retur', 'de_verificat')
           AND (u.ultim_eveniment IS NULL OR u.ultim_eveniment ~ '^[A-Z]{1,2}[0-9]{1,3}$')
           AND (u.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.livrat_la IS NULL OR u.livrat_la ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$')
           AND (u.ridicat_propus IS NULL OR u.ridicat_propus ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           AND (u.retur_propus IS NULL OR u.retur_propus IN ('destinatar_necunoscut', 'mutat', 'avizat_neridicat', 'refuz', 'adresa_incompleta'))), count(DISTINCT u.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, versiune integer, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: urmarire invalida' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT u.id FROM jsonb_to_recordset(p_randuri) AS u(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = u.id AND a.lot_id = p_lot_id AND a.awb = u.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET urmarire_stare = u.urmarire_stare, ultim_eveniment = u.ultim_eveniment,
         ultim_eveniment_la = (u.ultim_eveniment_la::timestamp AT TIME ZONE 'Europe/Bucharest'), ridicat_propus = u.ridicat_propus::date,
         livrat_la = (u.livrat_la::timestamp AT TIME ZONE 'Europe/Bucharest'), retur_propus = u.retur_propus, urmarit_la = now(), updated_at = now(),
         versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS u(id uuid, awb text, versiune integer, urmarire_stare text, ultim_eveniment text,
      ultim_eveniment_la text, ridicat_propus text, livrat_la text, retur_propus text)
   WHERE a.id = u.id AND a.versiune_urmarire = u.versiune
     AND (a.ultim_eveniment_la IS NULL OR u.ultim_eveniment_la IS NULL OR (u.ultim_eveniment_la::timestamp AT TIME ZONE 'Europe/Bucharest') >= a.ultim_eveniment_la);
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'depasite', v_n - v_scrise);
END $fn$;

-- (8) Confirmările de livrare (DOAR owner): doar starea (lipsă / primită — de verificat de om / formă necunoscută); răspunsul FAN nu se păstrează.
-- Aceeași versiune ca urmărirea (CAS, runda 2): un rând depășit nu se scrie. Întoarce {scrise, depasite}.
CREATE FUNCTION public.fn_red_fan_confirmari(p_lot_id uuid, p_randuri jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer; v_bune integer; v_dist integer; v_scrise integer;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_lot_id IS NULL OR p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  SELECT count(*), count(*) FILTER (WHERE c.id IS NOT NULL AND c.awb ~ '^[0-9]{6,20}$' AND c.versiune IS NOT NULL AND c.versiune >= 0
           AND c.confirmare_stare IN ('lipsa', 'primita_de_verificat', 'forma_necunoscuta')), count(DISTINCT c.id)
    INTO v_n, v_bune, v_dist FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, versiune integer, confirmare_stare text);
  IF v_n <> v_bune OR v_dist <> v_n THEN RAISE EXCEPTION 'redari fan: confirmari invalide' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.red_fan_awb WHERE id IN (SELECT c.id FROM jsonb_to_recordset(p_randuri) AS c(id uuid)) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text)
             LEFT JOIN public.red_fan_awb a ON a.id = c.id AND a.lot_id = p_lot_id AND a.awb = c.awb AND a.stare IN ('generat', 'ridicat')
             WHERE a.id IS NULL) THEN RAISE EXCEPTION 'redari fan: rand strain sau AWB diferit' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.red_fan_awb a SET confirmare_stare = c.confirmare_stare, urmarit_la = now(), updated_at = now(), versiune_urmarire = a.versiune_urmarire + 1
    FROM jsonb_to_recordset(p_randuri) AS c(id uuid, awb text, versiune integer, confirmare_stare text) WHERE a.id = c.id AND a.versiune_urmarire = c.versiune;
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  RETURN jsonb_build_object('scrise', v_scrise, 'depasite', v_n - v_scrise);
END $fn$;

-- (9) Anularea unui AWB neridicat (DOAR owner): după DELETE /awb confirmat de FAN (forma de succes recunoscută) sau verificarea omului în
-- selfAWB. Lock: plic → rând.
CREATE FUNCTION public.fn_red_fan_anulat(p_id uuid, p_awb text, p_motiv text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_plic_id uuid;
BEGIN
  IF NOT public.fn_red_fan_e_owner() THEN RAISE EXCEPTION 'redari fan: doar owner-ul' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_awb IS NULL OR p_awb !~ '^[0-9]{6,20}$' OR coalesce(left(p_motiv, 500), '') !~ '[^[:space:]]' THEN
    RAISE EXCEPTION 'redari fan: anulare invalida (AWB + motiv)' USING ERRCODE = '22023'; END IF;
  SELECT plic_id INTO v_plic_id FROM public.red_fan_awb WHERE id = p_id;
  IF v_plic_id IS NULL THEN RAISE EXCEPTION 'redari fan: rand inexistent' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.red_plicuri WHERE id = v_plic_id FOR UPDATE;
  UPDATE public.red_fan_awb SET stare = 'anulat', motiv = left(p_motiv, 500), updated_at = now() WHERE id = p_id AND stare = 'generat' AND awb = p_awb;
  IF NOT FOUND THEN RAISE EXCEPTION 'redari fan: doar un AWB generat, neridicat, se anuleaza (CAS)' USING ERRCODE = 'P0001'; END IF;
END $fn$;

-- drepturile pe funcții: totul retras, apoi EXECUTE pentru authenticated DOAR pe RPC-urile apelabile (interne: nimeni)
REVOKE ALL ON FUNCTION public.fn_red_fan_e_owner(), public.fn_red_fan_suma(numeric), public.fn_red_fan_camp(text), public.fn_red_fan_surse(uuid),
  public.fn_red_fan_loturi_garda(), public.fn_red_fan_setari_seteaza(integer), public.fn_red_fan_lot_marcheaza(uuid, boolean),
  public.fn_red_fan_propune(uuid, text, numeric), public.fn_red_fan_aproba(uuid, uuid[], text[]), public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[]),
  public.fn_red_fan_rezultate(uuid, jsonb), public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text), public.fn_red_fan_ridicat(uuid, date),
  public.fn_red_fan_urmarire(uuid, jsonb), public.fn_red_fan_confirmari(uuid, jsonb), public.fn_red_fan_anulat(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_fan_setari_seteaza(integer), public.fn_red_fan_lot_marcheaza(uuid, boolean),
  public.fn_red_fan_propune(uuid, text, numeric), public.fn_red_fan_aproba(uuid, uuid[], text[]), public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[]),
  public.fn_red_fan_rezultate(uuid, jsonb), public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text), public.fn_red_fan_ridicat(uuid, date),
  public.fn_red_fan_urmarire(uuid, jsonb), public.fn_red_fan_confirmari(uuid, jsonb), public.fn_red_fan_anulat(uuid, text, text) TO authenticated;

-- ── postcondiții ──
DO $post$
DECLARE r record; v_rau text;
BEGIN
  -- RLS activ (fără FORCE), proprietar postgres, câte o singură politică, exact cea de citire
  FOR r IN SELECT * FROM (VALUES ('red_fan_setari', 'red_fan_setari_citire'), ('red_fan_loturi', 'red_fan_loturi_citire'), ('red_fan_awb', 'red_fan_awb_citire')) v(t, pol) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || r.t)::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity
                     AND pg_get_userbyid(c.relowner) = 'postgres')
       OR (SELECT count(*) FROM pg_policy WHERE polrelid = ('public.' || r.t)::regclass) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = ('public.' || r.t)::regclass AND pol.polname = r.pol AND pol.polcmd = 'r'
                        AND pol.polpermissive AND pol.polroles = ARRAY['authenticated'::regrole::oid] AND pol.polwithcheck IS NULL
                        AND pg_get_expr(pol.polqual, pol.polrelid) = '((auth.uid() IS NOT NULL) AND (fn_red_nivel() = ANY (ARRAY[''admin''::text, ''editor''::text])))') THEN
      RAISE EXCEPTION '20261212a post: RLS / politica pe %', r.t;
    END IF;
  END LOOP;
  -- drepturile pe tabele, fiecare pe rând (cu o listă, has_table_privilege e adevărat dacă ORICARE există): doar SELECT pentru authenticated /
  -- service_role, nimic pentru anon; nimic pentru PUBLIC; niciun drept pe coloane
  SELECT string_agg(DISTINCT x.t || '/' || y.rol || '/' || z.drept, ', ') INTO v_rau
    FROM unnest(ARRAY['red_fan_setari', 'red_fan_loturi', 'red_fan_awb']) x(t), unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol),
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
   WHERE has_table_privilege(y.rol, ('public.' || x.t)::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon');
  IF v_rau IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['red_fan_setari', 'red_fan_loturi', 'red_fan_awb']) x(t) JOIN pg_class c ON c.oid = ('public.' || x.t)::regclass
                  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee = 0)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['red_fan_setari', 'red_fan_loturi', 'red_fan_awb']) x(t) JOIN pg_attribute a ON a.attrelid = ('public.' || x.t)::regclass
                 WHERE a.attnum > 0 AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '20261212a post: drepturi pe tabele (%)', coalesce(v_rau, 'PUBLIC / coloane');
  END IF;
  -- funcțiile: limbaj, DEFINER, search_path fix, proprietar, EXECUTE exact (anon / service_role / PUBLIC niciodată; authenticated doar RPC-urile)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_red_fan_e_owner()', 'sql', true, false), ('public.fn_red_fan_suma(numeric)', 'sql', false, false),
      ('public.fn_red_fan_camp(text)', 'sql', false, false), ('public.fn_red_fan_surse(uuid)', 'sql', false, false),
      ('public.fn_red_fan_loturi_garda()', 'plpgsql', false, false),
      ('public.fn_red_fan_setari_seteaza(integer)', 'plpgsql', true, true), ('public.fn_red_fan_lot_marcheaza(uuid, boolean)', 'plpgsql', true, true),
      ('public.fn_red_fan_propune(uuid, text, numeric)', 'plpgsql', true, true), ('public.fn_red_fan_aproba(uuid, uuid[], text[])', 'plpgsql', true, true),
      ('public.fn_red_fan_claim_lot(uuid, uuid[], text[], text[])', 'plpgsql', true, true), ('public.fn_red_fan_rezultate(uuid, jsonb)', 'plpgsql', true, true),
      ('public.fn_red_fan_reconciliaza(uuid, text, numeric, numeric, text)', 'plpgsql', true, true), ('public.fn_red_fan_ridicat(uuid, date)', 'plpgsql', true, true),
      ('public.fn_red_fan_urmarire(uuid, jsonb)', 'plpgsql', true, true), ('public.fn_red_fan_confirmari(uuid, jsonb)', 'plpgsql', true, true),
      ('public.fn_red_fan_anulat(uuid, text, text)', 'plpgsql', true, true)
    ) v(fn, limbaj, definer, exec_auth) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.oid = to_regprocedure(r.fn) AND l.lanname = r.limbaj AND p.prosecdef = r.definer
                      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner) = 'postgres'
                      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = r.exec_auth
                      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)) THEN
      RAISE EXCEPTION '20261212a post: functia % (limbaj / definer / search_path / owner / EXECUTE)', r.fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_red\_fan\_%') <> 16 THEN
    RAISE EXCEPTION '20261212a post: numarul functiilor fn_red_fan_* difera de 16';
  END IF;
  -- trigger-ul gărzii marcajului: forma exactă, activ, singurul de pe tabel (în afara celor interne de FK)
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.red_fan_loturi'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.red_fan_loturi'::regclass AND tg.tgname = 'trg_red_fan_loturi_garda'
                      AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_red_fan_loturi_garda()'::regprocedure
                      AND tg.tgtype = (1 | 2 | 8 | 16))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.red_fan_awb'::regclass, 'public.red_fan_setari'::regclass) AND NOT tgisinternal) THEN
    RAISE EXCEPTION '20261212a post: trigger-ele';
  END IF;
  IF (SELECT count(*) FROM public.red_fan_setari) <> 1 OR (SELECT limita_lot FROM public.red_fan_setari) <> 20 THEN RAISE EXCEPTION '20261212a: setarile implicite lipsesc'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_fan_awb) OR EXISTS (SELECT 1 FROM public.red_fan_loturi) THEN RAISE EXCEPTION '20261212a post: tabele noi cu randuri'; END IF;
END $post$;

-- L15: aceeași poartă DUPĂ schimbare, garda finală, timpul, apoi funcția pg_temp se șterge
DO $l15_dupa$ BEGIN
  PERFORM pg_temp.lant_20261212a('dupa');
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261212a_redari_fan_awb:' || txid_current() OR current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '20261212a: garda final invalida';
  END IF;
  RAISE NOTICE '20261212a: sfarsit la % ms de la BEGIN; lock-uri puternice tinute de % ms (pana la COMMIT se adauga pasul dupa al runnerului si garda: LOCK_TINUT)',
    round(extract(epoch FROM clock_timestamp() - now()) * 1000),
    round(extract(epoch FROM clock_timestamp()) * 1000 - current_setting('gazpet.lock_puternic_la')::numeric / 1000);
END $l15_dupa$;
DROP FUNCTION pg_temp.lant_20261212a(text);
