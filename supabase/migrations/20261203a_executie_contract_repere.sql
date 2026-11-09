-- Version 20261203120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261203a_executie_contract_repere — Execuție → proiect → „📜 Contract”: fișa contractului, reutilizabilă pe orice proiect (cererea lui Răzvan, 09.11.2026).
--
-- Ce face:
--   * Un tabel nou, executie_contract_repere: rândurile fișei de contract a unui proiect, pe 5 secțiuni:
--       clauza    — clauzele principale (rezumat + text esențial + sursa)
--       cale      — căile de prelungire a duratei de execuție (condiția, dovezile cerute, termenul de notificare, ce dă)
--       termen    — termenele de notificare și de răspuns (procedura de revendicare)
--       eveniment — registrul evenimentelor (data, notificat?, răspuns, stare, următorul termen, dovezi, putere)
--       sursa     — documentele de bază (unde stau)
--     Cheia rândului: (proiect_id, sectiune, cod), imuabilă. Arhivarea = activ false (nimic nu se șterge din aplicație).
--   * Scrierea din aplicație: DOAR prin fn_executie_contract_salveaza (SECURITY DEFINER): auth.uid() obligatoriu, drept de SCRIERE =
--     owner sau user_module_access 'executie' cu access_level 'admin'; lock consultativ pe proiect, apoi FOR UPDATE pe rând; CAS pe versiune;
--     cheie de idempotență per apăsare, ținută DURABIL în tabelul tehnic executie_contract_repere_chei (aceeași cheie + același conținut =
--     succesul de data trecută, chiar dacă rândul s-a modificat între timp; alt conținut / alt rând = eroare). Tabelul cheilor nu are niciun
--     drept din aplicație.
--     Nicio scriere directă (fără INSERT / UPDATE / DELETE pentru anon / authenticated / service_role).
--   * Citirea: owner sau user_module_access 'executie' (orice nivel), prin RLS. Dreptul e o singură funcție (fn_executie_contract_drept),
--     folosită de RLS, de RPC și de interfață.
--   * Proveniența (L08): modificat_de / modificat_la / versiune le pune trigger-ul, la orice INSERT / UPDATE (și la importul făcut ca postgres).
-- Ce NU face: nicio dată (fișa Lot 1 o încarcă chat-ul după „da”-ul lui Răzvan, cu SQL generat în afara repo-ului), niciun drept,
--   nicio atingere pe executie_proiecte sau pe alte tabele.
-- Ordinea lock-urilor (L06): advisory pe proiect (hashtextextended('executie_contract_repere:' || proiect_id, 0)) -> rândul FOR UPDATE ->
--   INSERT în executie_contract_repere_chei (FK spre rândul deja blocat). Importul (postgres) ia același advisory înainte de upsert și nu
--   atinge tabelul cheilor. Nimic altceva nu se blochează.
-- Revenire: supabase/revenire/20261203a_executie_contract_repere_ROLLBACK.sql. Test pe clonă: scripts/test_executie_contract_repere.sql.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261203a_executie_contract_repere:' || txid_current() THEN
    RAISE EXCEPTION '20261203a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261203a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- obiectele noi nu există (reaplicare = refuz)
  IF to_regclass('public.executie_contract_repere') IS NOT NULL OR to_regclass('public.executie_contract_repere_chei') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_contract\_%') THEN
    RAISE EXCEPTION '20261203a: obiectele exista deja (reaplicare)';
  END IF;
  -- dependențele, cu tipurile citite din migrări (executie_proiecte.id bigint; profiles.is_owner; user_module_access)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.executie_proiecte'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'bigint'
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_owner' AND data_type = 'boolean')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_module_access'
          AND column_name IN ('profile_id', 'module', 'access_level')) <> 3
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20261203a: dependentele (executie_proiecte.id bigint, profiles.is_owner, user_module_access, auth.uid) difera';
  END IF;
END $pre$;

-- ── tabelul ──────────────────────────────────────────────────────────────────────────────────────────────
-- Textele: NULL sau nevide (cel puțin un caracter care nu e spațiu), cu plafon de lungime.
CREATE TABLE public.executie_contract_repere (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  sectiune text NOT NULL CHECK (sectiune IN (
    -- SECTIUNI-START
    'clauza', 'cale', 'termen', 'eveniment', 'sursa'
    -- SECTIUNI-END
  )),
  cod text NOT NULL CHECK (cod ~ '^[A-Z]{1,3}[0-9]{1,4}$'),
  ordine integer NOT NULL DEFAULT 0 CHECK (ordine BETWEEN 0 AND 99999),
  titlu text NOT NULL CHECK (length(titlu) BETWEEN 1 AND 300 AND titlu ~ '[^[:space:]]'),
  clauze text CHECK (clauze IS NULL OR (length(clauze) <= 600 AND clauze ~ '[^[:space:]]')),
  continut text CHECK (continut IS NULL OR (length(continut) <= 6000 AND continut ~ '[^[:space:]]')),
  citat text CHECK (citat IS NULL OR (length(citat) <= 3000 AND citat ~ '[^[:space:]]')),
  conditie text CHECK (conditie IS NULL OR (length(conditie) <= 4000 AND conditie ~ '[^[:space:]]')),
  dovezi text CHECK (dovezi IS NULL OR (length(dovezi) <= 4000 AND dovezi ~ '[^[:space:]]')),
  dovezi_lipsa text CHECK (dovezi_lipsa IS NULL OR (length(dovezi_lipsa) <= 4000 AND dovezi_lipsa ~ '[^[:space:]]')),
  termen_text text CHECK (termen_text IS NULL OR (length(termen_text) <= 1500 AND termen_text ~ '[^[:space:]]')),
  efect text CHECK (efect IS NULL OR (length(efect) <= 1500 AND efect ~ '[^[:space:]]')),
  data_eveniment date,
  notificare text CHECK (notificare IS NULL OR (length(notificare) <= 1500 AND notificare ~ '[^[:space:]]')),
  raspuns text CHECK (raspuns IS NULL OR (length(raspuns) <= 1500 AND raspuns ~ '[^[:space:]]')),
  stare text CHECK (stare IS NULL OR stare IN (
    -- STARI-START
    'de_notificat', 'notificat', 'in_curs', 'asteapta_raspuns', 'decazut', 'inchis', 'risc', 'viitor'
    -- STARI-END
  )),
  termen_urmator date,
  termen_ce text CHECK (termen_ce IS NULL OR (length(termen_ce) <= 2000 AND termen_ce ~ '[^[:space:]]')),
  putere text CHECK (putere IS NULL OR putere IN (
    -- PUTERI-START
    'puternica', 'medie', 'slaba', 'nula'
    -- PUTERI-END
  )),
  sursa text CHECK (sursa IS NULL OR (length(sursa) <= 4000 AND sursa ~ '[^[:space:]]')),
  activ boolean NOT NULL DEFAULT true,
  versiune integer NOT NULL DEFAULT 1 CHECK (versiune > 0),
  modificat_de uuid,
  modificat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executie_contract_repere_cod_uq UNIQUE (proiect_id, sectiune, cod),
  -- starea, puterea și termenul următor au sens doar în registrul evenimentelor; un eveniment are mereu o stare
  CONSTRAINT executie_contract_repere_eveniment CHECK (
    (sectiune = 'eveniment' AND stare IS NOT NULL)
    OR (sectiune <> 'eveniment' AND stare IS NULL AND putere IS NULL AND termen_urmator IS NULL AND data_eveniment IS NULL
        AND notificare IS NULL AND raspuns IS NULL AND termen_ce IS NULL AND dovezi_lipsa IS NULL))
);
CREATE INDEX executie_contract_repere_proiect_idx ON public.executie_contract_repere (proiect_id, id);

-- ── jurnalul cheilor de salvare (idempotență DURABILĂ, L04/L05): fiecare salvare reușită lasă cheia ei, cu amprenta conținutului și rândul;
--    o reluare cu aceeași cheie întoarce succesul de data trecută chiar dacă rândul s-a modificat între timp cu altă cheie. Tabel tehnic intern:
--    fără niciun drept din aplicație (doar RPC-ul DEFINER îl citește / scrie); nu se șterge nimic din el.
CREATE TABLE public.executie_contract_repere_chei (
  cheie uuid PRIMARY KEY,
  proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id),
  rand_id bigint NOT NULL REFERENCES public.executie_contract_repere(id),
  amprenta text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{32}$'),
  versiune_dupa integer NOT NULL CHECK (versiune_dupa > 0),
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executie_contract_repere_chei_rand_idx ON public.executie_contract_repere_chei (rand_id);
COMMENT ON TABLE public.executie_contract_repere_chei IS
  'Execuție: cheile de idempotență ale salvărilor din fișa contractului (o cheie = o apăsare). Intern, scris doar de fn_executie_contract_salveaza. 20261203a.';
COMMENT ON TABLE public.executie_contract_repere IS
  'Execuție: fișa contractului unui proiect (clauze, căi de prelungire, termene, registrul evenimentelor, surse). Scriere DOAR prin fn_executie_contract_salveaza. 20261203a.';
COMMENT ON COLUMN public.executie_contract_repere.stare IS
  'Doar la evenimente: de_notificat / notificat / in_curs (eveniment continuu, actualizări la 30 de zile) / asteapta_raspuns / decazut / inchis / risc / viitor.';
COMMENT ON COLUMN public.executie_contract_repere.activ IS 'false = arhivat (ascuns implicit în aplicație). Nimic nu se șterge din aplicație.';

-- ── dreptul: O SINGURĂ definiție (RLS, RPC, interfață). Citire: owner sau orice nivel 'executie'; scriere: owner sau 'executie' admin ──
CREATE FUNCTION public.fn_executie_contract_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_scriere IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.executie_proiecte e WHERE e.id = p_proiect)
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR EXISTS (SELECT 1 FROM public.user_module_access u
                     WHERE u.profile_id = auth.uid() AND u.module = 'executie'
                       AND (u.access_level = 'admin' OR (p_scriere IS FALSE AND u.access_level IN ('viewer', 'editor')))))
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_contract_drept(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_contract_drept(bigint, boolean) TO authenticated, service_role;

-- ── proveniența și versiunea (L08, L16): le pune serverul pe orice cale; identitatea rândului e imuabilă ──
CREATE FUNCTION public.fn_executie_contract_provenienta() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.proiect_id, NEW.sectiune, NEW.cod) IS DISTINCT FROM (OLD.proiect_id, OLD.sectiune, OLD.cod) THEN
      RAISE EXCEPTION 'contract: proiectul, secțiunea și codul rândului nu se schimbă' USING ERRCODE = '23514';
    END IF;
    NEW.versiune := OLD.versiune + 1;
  ELSE
    NEW.versiune := 1;
  END IF;
  NEW.modificat_de := auth.uid();
  NEW.modificat_la := now();
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_contract_provenienta() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_executie_contract_provenienta BEFORE INSERT OR UPDATE ON public.executie_contract_repere
  FOR EACH ROW EXECUTE FUNCTION public.fn_executie_contract_provenienta();

-- ── RPC-ul de salvare (L01, L02, L04, L07, L08, L09, L18, L20) ──
-- p_id NULL = rând nou pe p_proiect; altfel modificarea rândului p_id (p_versiune = versiunea văzută de client, CAS).
-- p_date = TOATE câmpurile editabile (lista albă de mai jos; o cheie lipsă = NULL, o cheie necunoscută = refuz). sectiune și cod se iau
--   din p_date doar la rândul nou; la modificare trebuie să fie egale cu ale rândului.
-- Ordinea: identitate -> parametri -> lock consultativ pe proiect -> (modificare: FOR UPDATE pe rând) -> drept pe proiectul rândului ->
--   idempotență (jurnalul cheilor) -> CAS -> validare -> INSERT / UPDATE -> cheia în jurnal (aceeași tranzacție).
-- Rezultat: {ok, duplicat, rand} sau {ok:false, motiv:'conflict', rand} (rândul s-a schimbat între timp: clientul reîncarcă).
CREATE FUNCTION public.fn_executie_contract_salveaza(p_proiect bigint, p_id bigint, p_versiune integer, p_date jsonb, p_cheie uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_uid uuid := auth.uid();
  r public.executie_contract_repere;
  c public.executie_contract_repere_chei;
  v_amprenta text;
  k text;
  v_texte constant text[] := ARRAY['titlu', 'clauze', 'continut', 'citat', 'conditie', 'dovezi', 'dovezi_lipsa', 'termen_text', 'efect',
                                   'notificare', 'raspuns', 'termen_ce', 'sursa', 'sectiune', 'cod', 'stare', 'putere'];
  v_date_k constant text[] := ARRAY['data_eveniment', 'termen_urmator'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'contract: autentificare necesară' USING ERRCODE = '42501'; END IF;
  IF p_proiect IS NULL OR p_cheie IS NULL OR p_date IS NULL OR jsonb_typeof(p_date) <> 'object'
     OR (p_id IS NULL) <> (p_versiune IS NULL) THEN
    RAISE EXCEPTION 'contract: parametri lipsă' USING ERRCODE = '22023';
  END IF;
  -- lista albă a cheilor și tipurile lor (pași separați, fără să ne bazăm pe ordinea de evaluare a unui OR)
  FOR k IN SELECT jsonb_object_keys(p_date) LOOP
    IF NOT (k = ANY (v_texte) OR k = ANY (v_date_k) OR k IN ('ordine', 'activ')) THEN
      RAISE EXCEPTION 'contract: câmp necunoscut: %', left(k, 40) USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_date->k) = 'null' THEN CONTINUE; END IF;
    IF (k = ANY (v_texte) OR k = ANY (v_date_k)) AND jsonb_typeof(p_date->k) <> 'string' THEN
      RAISE EXCEPTION 'contract: câmpul % trebuie să fie text', k USING ERRCODE = '22023';
    END IF;
    IF k = ANY (v_date_k) AND (p_date->>k) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'contract: câmpul % trebuie să fie o dată AAAA-LL-ZZ', k USING ERRCODE = '22023';
    END IF;
    IF k = 'ordine' AND (jsonb_typeof(p_date->k) <> 'number' OR (p_date->>k) !~ '^[0-9]{1,5}$') THEN
      RAISE EXCEPTION 'contract: ordinea trebuie să fie un număr întreg între 0 și 99999' USING ERRCODE = '22023';
    END IF;
    IF k = 'activ' AND jsonb_typeof(p_date->k) <> 'boolean' THEN
      RAISE EXCEPTION 'contract: câmpul activ trebuie să fie true / false' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtextextended('executie_contract_repere:' || p_proiect, 0));
  IF p_id IS NOT NULL THEN
    SELECT * INTO r FROM public.executie_contract_repere WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR r.proiect_id IS DISTINCT FROM p_proiect OR NOT public.fn_executie_contract_drept(r.proiect_id, true) THEN
      RAISE EXCEPTION 'contract: rândul nu există sau nu ai drept de scriere pe fișa contractului' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.fn_executie_contract_drept(p_proiect, true) THEN
    RAISE EXCEPTION 'contract: proiectul nu există sau nu ai drept de scriere pe fișa contractului' USING ERRCODE = '42501';
  END IF;

  v_amprenta := md5(jsonb_build_object('proiect', p_proiect, 'id', p_id, 'versiune', p_versiune, 'date', p_date)::text);
  -- reluarea aceleiași apăsări (jurnalul cheilor, durabil): același conținut = succesul de data trecută, cu rândul așa cum e ACUM
  -- (și dacă între timp altcineva l-a modificat); alt conținut / alt proiect / alt rând = eroare
  SELECT * INTO c FROM public.executie_contract_repere_chei WHERE cheie = p_cheie;
  IF FOUND THEN
    IF c.amprenta = v_amprenta AND c.proiect_id = p_proiect AND (p_id IS NULL OR c.rand_id = p_id) THEN
      SELECT * INTO r FROM public.executie_contract_repere WHERE id = c.rand_id;
      RETURN jsonb_build_object('ok', true, 'duplicat', true, 'rand', to_jsonb(r));
    END IF;
    RAISE EXCEPTION 'contract: cheia apăsării a fost folosită pentru altă salvare' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.executie_contract_repere
                WHERE proiect_id = p_proiect AND sectiune = p_date->>'sectiune' AND cod = p_date->>'cod') THEN
      RAISE EXCEPTION 'contract: codul % există deja în această secțiune', left(coalesce(p_date->>'cod', ''), 10) USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.executie_contract_repere (proiect_id, sectiune, cod, ordine, titlu, clauze, continut, citat, conditie, dovezi, dovezi_lipsa,
      termen_text, efect, data_eveniment, notificare, raspuns, stare, termen_urmator, termen_ce, putere, sursa, activ)
    VALUES (p_proiect, p_date->>'sectiune', p_date->>'cod', coalesce((p_date->>'ordine')::integer, 0),
      nullif(btrim(coalesce(p_date->>'titlu', '')), ''), nullif(btrim(coalesce(p_date->>'clauze', '')), ''),
      nullif(btrim(coalesce(p_date->>'continut', '')), ''), nullif(btrim(coalesce(p_date->>'citat', '')), ''),
      nullif(btrim(coalesce(p_date->>'conditie', '')), ''), nullif(btrim(coalesce(p_date->>'dovezi', '')), ''),
      nullif(btrim(coalesce(p_date->>'dovezi_lipsa', '')), ''), nullif(btrim(coalesce(p_date->>'termen_text', '')), ''),
      nullif(btrim(coalesce(p_date->>'efect', '')), ''), (p_date->>'data_eveniment')::date,
      nullif(btrim(coalesce(p_date->>'notificare', '')), ''), nullif(btrim(coalesce(p_date->>'raspuns', '')), ''),
      p_date->>'stare', (p_date->>'termen_urmator')::date, nullif(btrim(coalesce(p_date->>'termen_ce', '')), ''),
      p_date->>'putere', nullif(btrim(coalesce(p_date->>'sursa', '')), ''), coalesce((p_date->>'activ')::boolean, true))
    RETURNING * INTO r;
    INSERT INTO public.executie_contract_repere_chei (cheie, proiect_id, rand_id, amprenta, versiune_dupa, creat_de)
    VALUES (p_cheie, p_proiect, r.id, v_amprenta, r.versiune, v_uid);
    RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(r));
  END IF;

  -- CAS: versiunea văzută de client
  IF r.versiune IS DISTINCT FROM p_versiune THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'rand', to_jsonb(r));
  END IF;
  IF (p_date ? 'sectiune' AND p_date->>'sectiune' IS DISTINCT FROM r.sectiune) OR (p_date ? 'cod' AND p_date->>'cod' IS DISTINCT FROM r.cod) THEN
    RAISE EXCEPTION 'contract: secțiunea și codul rândului nu se schimbă' USING ERRCODE = '22023';
  END IF;
  UPDATE public.executie_contract_repere SET
    ordine = coalesce((p_date->>'ordine')::integer, 0),
    titlu = nullif(btrim(coalesce(p_date->>'titlu', '')), ''),
    clauze = nullif(btrim(coalesce(p_date->>'clauze', '')), ''),
    continut = nullif(btrim(coalesce(p_date->>'continut', '')), ''),
    citat = nullif(btrim(coalesce(p_date->>'citat', '')), ''),
    conditie = nullif(btrim(coalesce(p_date->>'conditie', '')), ''),
    dovezi = nullif(btrim(coalesce(p_date->>'dovezi', '')), ''),
    dovezi_lipsa = nullif(btrim(coalesce(p_date->>'dovezi_lipsa', '')), ''),
    termen_text = nullif(btrim(coalesce(p_date->>'termen_text', '')), ''),
    efect = nullif(btrim(coalesce(p_date->>'efect', '')), ''),
    data_eveniment = (p_date->>'data_eveniment')::date,
    notificare = nullif(btrim(coalesce(p_date->>'notificare', '')), ''),
    raspuns = nullif(btrim(coalesce(p_date->>'raspuns', '')), ''),
    stare = p_date->>'stare',
    termen_urmator = (p_date->>'termen_urmator')::date,
    termen_ce = nullif(btrim(coalesce(p_date->>'termen_ce', '')), ''),
    putere = p_date->>'putere',
    sursa = nullif(btrim(coalesce(p_date->>'sursa', '')), ''),
    activ = coalesce((p_date->>'activ')::boolean, true)
  WHERE id = p_id
  RETURNING * INTO r;
  INSERT INTO public.executie_contract_repere_chei (cheie, proiect_id, rand_id, amprenta, versiune_dupa, creat_de)
  VALUES (p_cheie, p_proiect, r.id, v_amprenta, r.versiune, v_uid);
  RETURN jsonb_build_object('ok', true, 'duplicat', false, 'rand', to_jsonb(r));
END $f$;
REVOKE ALL ON FUNCTION public.fn_executie_contract_salveaza(bigint, bigint, integer, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_executie_contract_salveaza(bigint, bigint, integer, jsonb, uuid) TO authenticated;

-- ── RLS + privilegii: doar citire pentru aplicație (L07); scrierea trece numai prin RPC ──
ALTER TABLE public.executie_contract_repere ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_contract_repere FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_contract_repere TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.executie_contract_repere_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY executie_contract_repere_citire ON public.executie_contract_repere FOR SELECT TO authenticated
  USING (public.fn_executie_contract_drept(proiect_id, false));
-- tabelul cheilor: RLS fără nicio politică și fără niciun drept (doar RPC-ul DEFINER, ca proprietar, îl folosește)
ALTER TABLE public.executie_contract_repere_chei ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_contract_repere_chei FROM PUBLIC, anon, authenticated, service_role;

-- ── postcondiții ──
DO $post$
DECLARE v_rel oid := 'public.executie_contract_repere'::regclass;
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS NOT TRUE
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_contract_repere') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_contract_repere'
                     AND policyname = 'executie_contract_repere_citire' AND cmd = 'SELECT' AND roles = '{authenticated}' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION '20261203a post: RLS / politica tabelului';
  END IF;
  -- privilegiile efective: doar SELECT pentru authenticated / service_role, nimic pentru anon; nimic pe coloane / secvență
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
              WHERE has_table_privilege(r, v_rel, p))
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
                 WHERE has_sequence_privilege(r, pg_get_serial_sequence('public.executie_contract_repere', 'id'), 'USAGE,SELECT,UPDATE')) THEN
    RAISE EXCEPTION '20261203a post: privilegii pe tabel / secventa';
  END IF;
  -- funcțiile: DEFINER doar unde trebuie, search_path fix, EXECUTE doar unde trebuie
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_contract\_%'
                AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                     OR p.prosecdef IS DISTINCT FROM (p.proname IN ('fn_executie_contract_drept', 'fn_executie_contract_salveaza'))
                     OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname <> 'fn_executie_contract_provenienta')
                     OR has_function_privilege('service_role', p.oid, 'EXECUTE') IS DISTINCT FROM (p.proname = 'fn_executie_contract_drept')))
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_contract\_%') <> 3 THEN
    RAISE EXCEPTION '20261203a post: functii (definer / search_path / EXECUTE)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_rel AND tgname = 'trg_executie_contract_provenienta' AND tgenabled = 'O')
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = v_rel AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION '20261203a post: trigger-ul de proveniență';
  END IF;
  -- tabelul cheilor: RLS, zero politici, zero privilegii pentru rolurile aplicației (și pe coloane)
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.executie_contract_repere_chei'::regclass) IS NOT TRUE
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'executie_contract_repere_chei')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                 WHERE has_table_privilege(r, 'public.executie_contract_repere_chei'::regclass, p))
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.executie_contract_repere_chei'::regclass AND attnum > 0 AND attacl IS NOT NULL)
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.executie_contract_repere_chei'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '20261203a post: tabelul cheilor (RLS / politici / privilegii)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.executie_contract_repere) OR EXISTS (SELECT 1 FROM public.executie_contract_repere_chei) THEN
    RAISE EXCEPTION '20261203a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261203a_executie_contract_repere:' || txid_current() THEN
    RAISE EXCEPTION '20261203a: garda final invalida';
  END IF;
END $post$;
