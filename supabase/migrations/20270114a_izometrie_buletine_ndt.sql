-- Version 20270114120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   PLAFONUL EXTINS (15000 ms, doar în fereastra 21:00–06:00 Europe/Bucharest, docs/LIVRARE_L15_V2.md §9) — decizia proprietarului 27.11.2026:
--   proba cu ROLLBACK pe producție a depășit plafonul standard de 5000 ms (amprenta globală ~1,2 s pe producție față de 0,3 s pe clonă).
--   supabase/migrations/20270114a_izometrie_buletine_ndt.l15.tsv (manifestul îl generează coordonatorul pe clonă, docs/LIVRARE_L15_V2.md §5).
-- 20270114a_izometrie_buletine_ndt — Izometrie: arhiva buletinelor NDT pe suduri (PR1a din docs/izometrie/BULETINE_NDT_SPEC.md, §4, §21 R1–R11).
-- Ce face:
--   * Tabele NOI, prefix sud_ (NU izo_: porțile Izometrie amprentează obiectele izo / executie existente, iar revenirile lor caută tipare izo_):
--     sud_metode_proiect (metodele NDT obligatorii pe proiect, D10), sud_buletine (antetul + PDF-ul + amprenta + starea),
--     sud_buletin_randuri (rândurile anexei, cheia sudurii calculată de SERVER), sud_suduri_eliminate (cupon / tăiere, R4),
--     sud_export_deblocari (deblocarea exportului de către MP, D11), sud_exporturi (fotografia surselor la export, R6).
--   * NICIO coloană nouă și NICIUN FK spre tabelele existente (executie_proiecte / executie_tronsoane / executie_pachete_lansare sunt în perimetrul
--     porților Izometrie E2a–E4b); existența proiectului / tronsonului / pachetului o verifică funcțiile de scriere, sub lock pe rândul părinte.
--   * Bucket privat izo-ndt (PDF-urile buletinelor), cale <proiect_id>/<tronson_id>/<nume>. Politici PERMISIVE (citire, încărcare cu
--     owner_id = auth.uid(), ștergerea propriului fișier NEÎNREGISTRAT) + politici RESTRICTIVE pe același bucket (tiparul izo_aviz_pdf_r_* de pe
--     producție, 20261120a: _sel / _ins / _del TO authenticated, _upd TO PUBLIC, _anon FOR ALL TO anon — cele cu funcții NU se aplică lui anon,
--     care nu are EXECUTE pe fn_sud_drept: dreptul se verifică la pornirea interogării, deci ar pica orice citire anonimă din storage).
--     Rămân valabile oricât de largă ar fi altă politică permisivă; UPDATE interzis; fișierul înregistrat într-un buletin nu se mai șterge din client.
--   * Dreptul (R9), O SINGURĂ definiție: fn_sud_drept(proiect, nivel), nivel ∈ citire / export / scriere (alt nivel / NULL = fals, niciodată NULL).
--     scriere = owner SAU managerul proiectului (profiles.employee_id = executie_proiecte.mp_employee_id) cu fn_executie_proiect_permis(proiect, true);
--     export (înregistrarea unui export COMPLET, ca exportul de azi) = scriere SAU accesul existent de scriere pe pachete
--       (fn_executie_pachete_acces(true)) cu fn_executie_proiect_permis(proiect, true);
--     citire = owner SAU accesul existent de citire pe pachete (fn_executie_pachete_acces(false)) cu fn_executie_proiect_permis(proiect, false).
--     Exportul INCOMPLET cere deblocarea MP-ului (nivel scriere). Nimic acordat de migrare.
--   * Scrierile DOAR prin funcții SECURITY DEFINER care verifică dreptul în corp (auth.uid() obligatoriu); clienții au doar SELECT pe tabele.
--     Autorul, momentele, cheia sudurii, versiunea le pune serverul.
--   * fn_sud_cod_normalizeaza: aceeași regulă ca fn_izo_sudura_normalizeaza (E4b, mod legacy) și src/lib/izoSudura.js — R final = refacere, alte
--     litere = sufix (D18). Copie, nu apel: funcția E4b nu e executabilă de postgres (proprietar dedicat). Paritatea: setul comun
--     src/lib/izoSudura.cazuri.json rulat pe ambele în proba PGlite.
-- Unicitate (R1): tronson + metodă + număr (trim, majuscule) + data, între buletinele neanulate și neforțate; a doua încărcare a aceleiași chei cere
--   motiv (două laboratoare cu același număr). Amprenta SHA-256 declarată de client: unică pe proiect între buletinele neanulate (comoditate
--   împotriva dublurilor, NU proveniență: serverul nu poate citi conținutul obiectului din Storage).
-- Conținut extern: rândurile vin dintr-o citire AI a unui scan (laborator terț) confirmată de MP; serverul le tratează ca date (validare de tip,
--   lungimi, plafon de 2000 rânduri), nu execută nimic din ele.
-- Concurență: fiecare funcție de scriere ia rândul părintelui (tronson / pachet / buletin) FOR UPDATE înaintea verificărilor de unicitate;
--   confirmarea cere versiunea citită (CAS).
-- Revenire: supabase/revenire/20270114a_izometrie_buletine_ndt_ROLLBACK.sql (refuză dacă există date sau obiecte în bucket).
-- Probe: scripts/pglite/test_izometrie_buletine_ndt_local.mjs.
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270114a_izometrie_buletine_ndt:' || txid_current() THEN
    RAISE EXCEPTION '20270114a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270114a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270114a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270114a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20270114a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270114a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.executie_proiecte') IS NULL OR to_regclass('public.executie_tronsoane') IS NULL
     OR to_regclass('public.executie_pachete_lansare') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20270114a: dependente lipsa (executie_proiecte, executie_tronsoane, executie_pachete_lansare, profiles, storage, auth.uid)';
  END IF;
  -- coloanele citite, cu tipurile din producție (citite de chat pe 27.11.2026)
  IF EXISTS (SELECT 1 FROM (VALUES ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'mp_employee_id', 'integer'),
                                   ('executie_tronsoane', 'id', 'bigint'), ('executie_tronsoane', 'proiect_id', 'bigint'), ('executie_tronsoane', 'cod', 'text'),
                                   ('executie_pachete_lansare', 'id', 'bigint'), ('executie_pachete_lansare', 'proiect_id', 'bigint'),
                                   ('executie_pachete_lansare', 'tronson_id', 'bigint'),
                                   ('profiles', 'id', 'uuid'), ('profiles', 'is_owner', 'boolean'), ('profiles', 'employee_id', 'bigint')) c(t, col, tip)
              WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.t
                                  AND i.column_name = c.col AND i.data_type = c.tip)) THEN
    RAISE EXCEPTION '20270114a: coloanele citite nu au tipurile asteptate';
  END IF;
  -- predicatele de acces existente = TOT lanțul chemat de fn_sud_drept (L15: corp + callee tranzitive), cu corpurile revizuite (md5 pe prosrc fără
  -- CR): fn_executie_proiect_permis și callee-urile lui = aceleași constante ca 20270108a (20261209a); fn_executie_pachete_acces = corpul din
  -- 20261029a (citit de chat pe producție 27.11.2026). Plus limbajul, DEFINER, calea, proprietarul, volatilitatea, tipul întors și EXECUTE-ul clienților.
  IF EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155', true, true, 'boolean'),
          ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1', true, true, 'boolean'),
          ('public.fn_executie_acces_nerestrans_cont(uuid)', '9a07e0089139e54ba5c6a0cfaaf093cc', false, false, 'boolean'),
          ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b', true, false, 'bigint[]'),
          ('public.fn_executie_acces_lista_cont(uuid, boolean)', 'e7cf9b852002a1c1cbe781772c33bf0c', false, false, 'bigint[]'),
          ('public.fn_executie_pachete_acces(boolean)', 'c7ea33f39d888cb40d065ff4d02dd7b1', true, true, 'boolean')) a(semnatura, amprenta, definer, cu_auth, tip)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prolang IS DISTINCT FROM (SELECT l.oid FROM pg_language l WHERE l.lanname = 'sql')
           OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR p.provolatile IS DISTINCT FROM 's' OR p.prorettype IS DISTINCT FROM to_regtype(a.tip)::oid
           OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
           OR has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE') IS DISTINCT FROM a.cu_auth) THEN
    RAISE EXCEPTION '20270114a: lantul de drept (fn_executie_proiect_permis + callee 20261209a, fn_executie_pachete_acces 20261029a) lipseste sau nu e cel revizuit';
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL THEN RAISE EXCEPTION '20270114a: portile Izometrie (fn_izo_porti_lipsa) lipsesc'; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270114a: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
  -- reaplicare / coliziune de nume
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'sud\_%')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-ndt')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\_ndt\_%') THEN
    RAISE EXCEPTION '20270114a: obiecte sud_ / fn_sud_ / bucket izo-ndt exista deja (reaplicare)';
  END IF;
END $pre$;

-- ─────────── tabele ───────────
CREATE TABLE public.sud_metode_proiect (
  proiect_id bigint PRIMARY KEY,
  metode text[] NOT NULL CHECK (metode <@ ARRAY['PM', 'PA-UT', 'UT']::text[] AND cardinality(metode) <= 3),
  actualizat_de uuid NOT NULL,
  actualizat_la timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sud_buletine (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  metoda text NOT NULL CHECK (metoda IN ('PM', 'PA-UT', 'UT', 'PT', 'RT', 'VT', 'ALTA')),
  numar text NOT NULL CHECK (btrim(numar) <> '' AND length(numar) <= 60),
  numar_cheie text NOT NULL,
  data_buletin date NOT NULL,
  firma_citita text CHECK (length(firma_citita) <= 200),
  fisier_path text NOT NULL CHECK (length(fisier_path) <= 500),
  fisier_nume text CHECK (length(fisier_nume) <= 300),
  fisier_sha256 text NOT NULL CHECK (fisier_sha256 ~ '^[0-9a-f]{64}$'),
  citiri jsonb,
  stare text NOT NULL DEFAULT 'ciorna' CHECK (stare IN ('ciorna', 'confirmat', 'anulat')),
  fortat_motiv text CHECK (fortat_motiv IS NULL OR length(btrim(fortat_motiv)) >= 3),
  versiune integer NOT NULL DEFAULT 1,
  incarcat_de uuid NOT NULL,
  incarcat_la timestamptz NOT NULL DEFAULT now(),
  confirmat_de uuid,
  confirmat_la timestamptz,
  anulat_de uuid,
  anulat_la timestamptz,
  anulat_motiv text,
  CONSTRAINT sud_buletine_stare_ck CHECK (
    (stare = 'ciorna' AND confirmat_la IS NULL AND anulat_la IS NULL)
    OR (stare = 'confirmat' AND confirmat_la IS NOT NULL AND confirmat_de IS NOT NULL AND anulat_la IS NULL)
    OR (stare = 'anulat' AND anulat_la IS NOT NULL AND anulat_de IS NOT NULL AND length(btrim(anulat_motiv)) >= 3))
);
CREATE UNIQUE INDEX sud_buletine_cheie_uq ON public.sud_buletine (tronson_id, metoda, numar_cheie, data_buletin)
  WHERE stare <> 'anulat' AND fortat_motiv IS NULL;
CREATE UNIQUE INDEX sud_buletine_fisier_uq ON public.sud_buletine (proiect_id, fisier_sha256) WHERE stare <> 'anulat';
CREATE INDEX sud_buletine_tronson_ix ON public.sud_buletine (tronson_id, stare);

CREATE TABLE public.sud_buletin_randuri (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buletin_id bigint NOT NULL REFERENCES public.sud_buletine(id),
  ordine integer NOT NULL,
  cod_raw text NOT NULL CHECK (length(cod_raw) <= 80),
  stare_cod text NOT NULL CHECK (stare_cod IN ('ok', 'nepotrivit')),
  motiv_cod text,
  tronson_nr integer,
  nr integer,
  sufix text NOT NULL DEFAULT '',
  refacuta boolean NOT NULL DEFAULT false,
  cheie text,
  rezultat text NOT NULL CHECK (rezultat IN ('acceptat', 'respins')),
  data_inspectie date,
  ind_start numeric, ind_end numeric, ind_lungime numeric, ind_inaltime numeric, ind_adancime numeric,
  observatii text CHECK (length(observatii) <= 500),
  CONSTRAINT sud_buletin_randuri_cheie_ck CHECK ((stare_cod = 'ok') = (cheie IS NOT NULL AND tronson_nr IS NOT NULL AND nr IS NOT NULL)),
  UNIQUE (buletin_id, ordine)
);
CREATE INDEX sud_buletin_randuri_cheie_ix ON public.sud_buletin_randuri (cheie);

CREATE TABLE public.sud_suduri_eliminate (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  cheie text NOT NULL,
  motiv text NOT NULL CHECK (length(btrim(motiv)) >= 3),
  inlocuita_de text[] NOT NULL DEFAULT '{}',
  activ boolean NOT NULL DEFAULT true,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  retras_de uuid, retras_la timestamptz, retras_motiv text,
  CONSTRAINT sud_suduri_eliminate_retras_ck CHECK (activ OR (retras_la IS NOT NULL AND retras_de IS NOT NULL AND length(btrim(retras_motiv)) >= 3))
);
CREATE UNIQUE INDEX sud_suduri_eliminate_uq ON public.sud_suduri_eliminate (tronson_id, cheie) WHERE activ;

CREATE TABLE public.sud_export_deblocari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  pachet_id bigint NOT NULL,
  tip text NOT NULL CHECK (tip IN ('izo', 'inventar')),
  motiv text NOT NULL CHECK (length(btrim(motiv)) >= 5),
  lipsuri jsonb NOT NULL CHECK (jsonb_typeof(lipsuri) = 'array' AND jsonb_array_length(lipsuri) > 0),
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  folosit_la timestamptz
);

CREATE TABLE public.sud_exporturi (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  pachet_id bigint NOT NULL,
  tip text NOT NULL CHECK (tip IN ('izo', 'inventar')),
  fotografie jsonb NOT NULL CHECK (jsonb_typeof(fotografie) = 'object'),
  incomplet boolean NOT NULL,
  deblocare_id bigint REFERENCES public.sud_export_deblocari(id),
  fisier_path text CHECK (length(fisier_path) <= 500),
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sud_exporturi_deblocare_ck CHECK (incomplet = (deblocare_id IS NOT NULL))
);
CREATE UNIQUE INDEX sud_exporturi_deblocare_uq ON public.sud_exporturi (deblocare_id) WHERE deblocare_id IS NOT NULL;
CREATE INDEX sud_exporturi_pachet_ix ON public.sud_exporturi (pachet_id, creat_la DESC);

-- ─────────── dreptul (O SINGURĂ definiție, R9) ───────────
CREATE FUNCTION public.fn_sud_drept(p_proiect bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_nivel IN ('citire', 'export', 'scriere') AND (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
    OR (p_nivel IN ('scriere', 'export')
        AND EXISTS (SELECT 1 FROM public.profiles p JOIN public.executie_proiecte e ON e.id = p_proiect
                     WHERE p.id = auth.uid() AND p.employee_id IS NOT NULL AND e.mp_employee_id IS NOT NULL
                       AND p.employee_id::bigint = e.mp_employee_id::bigint)
        AND public.fn_executie_proiect_permis(p_proiect, true))
    OR (p_nivel = 'export' AND public.fn_executie_pachete_acces(true) AND public.fn_executie_proiect_permis(p_proiect, true))
    OR (p_nivel = 'citire' AND public.fn_executie_pachete_acces(false) AND public.fn_executie_proiect_permis(p_proiect, false))
  ), false)
$f$;

-- normalizatorul (copie a regulii legacy din fn_izo_sudura_normalizeaza / src/lib/izoSudura.js; cheia în forma ERP-ului: T<tronson>S<nr><sufix>)
CREATE FUNCTION public.fn_sud_cod_normalizeaza(p_raw text, p_tronson integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE v_s text; v_m text[]; v_t integer; v_nr integer; v_suf text := ''; v_ref boolean := false;
BEGIN
  v_s := btrim(regexp_replace(regexp_replace(upper(btrim(coalesce(p_raw, ''))), '^(?:GAZPET\s+INSTAL|GAZPET)\s+', ''), '\s+', ' ', 'g'));
  IF v_s = '' THEN RETURN jsonb_build_object('stare', 'nepotrivit', 'motiv', 'gol'); END IF;
  v_m := regexp_match(v_s, '^T(?:R)?\s*-?\s*([0-9]{1,3})\s*-?\s*S\s*-?\s*([0-9]{1,5})\s*((?:/\s*)?[A-Z]{1,2}[0-9]?)?$');
  IF v_m IS NOT NULL THEN v_t := v_m[1]::integer; v_nr := v_m[2]::integer; v_suf := coalesce(v_m[3], '');
  ELSE
    v_m := regexp_match(v_s, '^(?:S\s*-?\s*)?([0-9]{1,5})\s*((?:/\s*)?[A-Z]{1,2}[0-9]?)?$');
    IF v_m IS NULL THEN RETURN jsonb_build_object('stare', 'nepotrivit', 'motiv', 'format'); END IF;
    IF p_tronson IS NULL THEN RETURN jsonb_build_object('stare', 'nepotrivit', 'motiv', 'fara_tronson'); END IF;
    v_t := p_tronson; v_nr := v_m[1]::integer; v_suf := coalesce(v_m[2], '');
  END IF;
  IF v_t <= 0 THEN RETURN jsonb_build_object('stare', 'nepotrivit', 'motiv', 'tronson'); END IF;
  IF v_nr <= 0 THEN RETURN jsonb_build_object('stare', 'nepotrivit', 'motiv', 'numar'); END IF;
  v_suf := regexp_replace(v_suf, '\s', '', 'g');
  IF right(v_suf, 1) = 'R' THEN v_ref := true; v_suf := regexp_replace(left(v_suf, length(v_suf) - 1), '/$', ''); END IF;
  IF p_tronson IS NOT NULL AND v_t <> p_tronson THEN
    RETURN jsonb_build_object('stare', 'nepotrivit', 'motiv', 'alt_tronson', 'tronson', v_t, 'nr', v_nr, 'sufix', v_suf, 'refacuta', v_ref);
  END IF;
  RETURN jsonb_build_object('stare', 'ok', 'motiv', NULL, 'tronson', v_t, 'nr', v_nr, 'sufix', v_suf, 'refacuta', v_ref,
                            'cheie', 'T' || v_t || 'S' || v_nr || v_suf);
END $f$;

-- numărul tronsonului din codul lui (T12 / TR12 / tr1 FOD / TR 1 FOD); NULL dacă nu se poate citi
CREATE FUNCTION public.fn_sud_tronson_nr(p_cod text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT (regexp_match(upper(coalesce(p_cod, '')), '^\s*T(?:R)?\s*([0-9]{1,3})(?:\s|$)'))[1]::integer
$f$;

-- ─────────── scrieri (DEFINER, dreptul verificat în corp) ───────────
CREATE FUNCTION public.fn_sud_metode_seteaza(p_proiect bigint, p_metode text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.executie_proiecte WHERE id = p_proiect FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sud: proiect inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(p_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF p_metode IS NULL OR NOT (p_metode <@ ARRAY['PM', 'PA-UT', 'UT']::text[]) THEN RAISE EXCEPTION 'sud: metode invalide' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sud_metode_proiect (proiect_id, metode, actualizat_de)
  VALUES (p_proiect, (SELECT coalesce(array_agg(DISTINCT m ORDER BY m), '{}') FROM unnest(p_metode) m), auth.uid())
  ON CONFLICT (proiect_id) DO UPDATE SET metode = EXCLUDED.metode, actualizat_de = EXCLUDED.actualizat_de, actualizat_la = now();
END $f$;

CREATE FUNCTION public.fn_sud_buletin_incarca(p_tronson bigint, p_metoda text, p_numar text, p_data date, p_firma text,
  p_fisier_path text, p_fisier_nume text, p_sha256 text, p_citiri jsonb, p_forteaza_motiv text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_id bigint; v_cheie text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id INTO v_proiect FROM public.executie_tronsoane WHERE id = p_tronson FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: tronson inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF p_data IS NULL OR p_data > current_date + 1 OR p_data < date '2000-01-01' THEN RAISE EXCEPTION 'sud: data buletinului invalida' USING ERRCODE = '22023'; END IF;
  IF p_citiri IS NOT NULL AND (jsonb_typeof(p_citiri) <> 'object' OR octet_length(p_citiri::text) > 2000000) THEN
    RAISE EXCEPTION 'sud: citirile AI au alt format sau sunt prea mari' USING ERRCODE = '22023';
  END IF;
  -- fișierul: în bucket-ul izo-ndt, sub calea proiectului și a tronsonului, încărcat de același utilizator (owner_id = coloana pe care
  -- politicile de încărcare o impun = auth.uid(); aceeași în politica de ștergere a orfanului)
  IF p_fisier_path IS NULL OR p_fisier_path !~ ('^' || v_proiect || '/' || p_tronson || '/[^/]+$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'izo-ndt' AND o.name = p_fisier_path AND o.owner_id = auth.uid()::text
                      AND o.created_at > now() - interval '1 hour') THEN
    -- fereastra de timp (Jak r2 P1, cursa înregistrare ↔ ștergerea orfanului): un fișier se înregistrează doar în prima oră de la încărcare,
    -- iar ca orfan se poate șterge doar după 2 ore (politicile sud_ndt_sterge_orfan / sud_ndt_r_del) — cele două nu se pot suprapune
    RAISE EXCEPTION 'sud: fisierul nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora (reincarca-l)' USING ERRCODE = '22023';
  END IF;
  -- valorile: refuz explicit (22023), nu CHECK-ul tabelului și nicio tăiere
  IF p_metoda IS NULL OR p_metoda NOT IN ('PM', 'PA-UT', 'UT', 'PT', 'RT', 'VT', 'ALTA') THEN RAISE EXCEPTION 'sud: metoda invalida' USING ERRCODE = '22023'; END IF;
  IF btrim(coalesce(p_numar, '')) = '' OR length(p_numar) > 60 OR length(p_firma) > 200 OR length(p_fisier_nume) > 300
     OR length(p_forteaza_motiv) > 500 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sud: numar / firma / nume fisier / motiv / amprenta invalide sau prea lungi' USING ERRCODE = '22023';
  END IF;
  v_cheie := upper(regexp_replace(btrim(coalesce(p_numar, '')), '\s+', '', 'g'));
  SELECT id INTO v_id FROM public.sud_buletine WHERE proiect_id = v_proiect AND fisier_sha256 = p_sha256 AND stare <> 'anulat' LIMIT 1;
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: fisier_deja_incarcat:%', v_id USING ERRCODE = '23505'; END IF;
  IF nullif(btrim(coalesce(p_forteaza_motiv, '')), '') IS NULL THEN
    -- aceeași regulă ca indexul sud_buletine_cheie_uq (§22): cheia o ocupă doar buletinele neanulate și NEFORȚATE
    SELECT id INTO v_id FROM public.sud_buletine WHERE tronson_id = p_tronson AND metoda = p_metoda AND numar_cheie = v_cheie
       AND data_buletin = p_data AND stare <> 'anulat' AND fortat_motiv IS NULL LIMIT 1;
    IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: buletin_deja_incarcat:%', v_id USING ERRCODE = '23505'; END IF;
  END IF;
  INSERT INTO public.sud_buletine (proiect_id, tronson_id, metoda, numar, numar_cheie, data_buletin, firma_citita, fisier_path, fisier_nume,
                                   fisier_sha256, citiri, fortat_motiv, incarcat_de)
  VALUES (v_proiect, p_tronson, p_metoda, btrim(p_numar), v_cheie, p_data, nullif(btrim(p_firma), ''), p_fisier_path, p_fisier_nume,
          p_sha256, p_citiri, nullif(btrim(coalesce(p_forteaza_motiv, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

CREATE FUNCTION public.fn_sud_buletin_confirma(p_id bigint, p_versiune integer, p_randuri jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE b public.sud_buletine%ROWTYPE; v_tnr integer; r jsonb; v_n jsonb; v_i integer := 0; v_rez text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.sud_buletine WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sud: buletin inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(b.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF b.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: buletinul nu e ciorna (%)', b.stare USING ERRCODE = '55000'; END IF;
  IF p_versiune IS DISTINCT FROM b.versiune THEN RAISE EXCEPTION 'sud: buletinul s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  IF p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) = 0 OR jsonb_array_length(p_randuri) > 2000 THEN
    RAISE EXCEPTION 'sud: randurile lipsesc sau sunt peste 2000' USING ERRCODE = '22023';
  END IF;
  SELECT public.fn_sud_tronson_nr(t.cod) INTO v_tnr FROM public.executie_tronsoane t WHERE t.id = b.tronson_id;
  FOR r IN SELECT x FROM jsonb_array_elements(p_randuri) x LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(r) <> 'object' THEN RAISE EXCEPTION 'sud: randul % nu e obiect', v_i USING ERRCODE = '22023'; END IF;
    -- tipurile câmpurilor (conținut extern: nicio coerciție tăcută, nicio trunchiere; peste limită = refuz, L21)
    IF jsonb_typeof(r->'cod_raw') IS DISTINCT FROM 'string' OR length(r->>'cod_raw') > 80
       OR jsonb_typeof(r->'rezultat') IS DISTINCT FROM 'string'
       OR coalesce(jsonb_typeof(r->'data_inspectie'), 'null') NOT IN ('string', 'null')
       OR (jsonb_typeof(r->'data_inspectie') = 'string' AND r->>'data_inspectie' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
       OR coalesce(jsonb_typeof(r->'observatii'), 'null') NOT IN ('string', 'null') OR length(r->>'observatii') > 500
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['start_mm', 'end_mm', 'lungime_mm', 'inaltime_mm', 'adancime_mm']) k
                   WHERE coalesce(jsonb_typeof(r->k), 'null') NOT IN ('number', 'null')) THEN
      RAISE EXCEPTION 'sud: randul % are campuri de alt tip sau prea lungi (cod_raw text <= 80, data AAAA-LL-ZZ, indicatii numere, observatii <= 500)', v_i
        USING ERRCODE = '22023';
    END IF;
    v_rez := lower(btrim(r->>'rezultat'));
    v_rez := CASE WHEN v_rez IN ('acceptat', 'accepted', 'admis') THEN 'acceptat' WHEN v_rez IN ('respins', 'rejected') THEN 'respins' END;
    IF v_rez IS NULL THEN RAISE EXCEPTION 'sud: randul % are rezultat necunoscut', v_i USING ERRCODE = '22023'; END IF;
    v_n := public.fn_sud_cod_normalizeaza(r->>'cod_raw', v_tnr);
    INSERT INTO public.sud_buletin_randuri (buletin_id, ordine, cod_raw, stare_cod, motiv_cod, tronson_nr, nr, sufix, refacuta, cheie, rezultat,
                                            data_inspectie, ind_start, ind_end, ind_lungime, ind_inaltime, ind_adancime, observatii)
    VALUES (b.id, v_i, r->>'cod_raw', v_n->>'stare', v_n->>'motiv',
            CASE WHEN v_n->>'stare' = 'ok' THEN (v_n->>'tronson')::integer END, CASE WHEN v_n->>'stare' = 'ok' THEN (v_n->>'nr')::integer END,
            coalesce(v_n->>'sufix', ''), coalesce((v_n->>'refacuta')::boolean, false), v_n->>'cheie', v_rez,
            (r->>'data_inspectie')::date, (r->>'start_mm')::numeric, (r->>'end_mm')::numeric, (r->>'lungime_mm')::numeric,
            (r->>'inaltime_mm')::numeric, (r->>'adancime_mm')::numeric, r->>'observatii');
  END LOOP;
  UPDATE public.sud_buletine SET stare = 'confirmat', confirmat_de = auth.uid(), confirmat_la = now(), versiune = versiune + 1 WHERE id = b.id;
  RETURN v_i;
END $f$;

CREATE FUNCTION public.fn_sud_buletin_anuleaza(p_id bigint, p_motiv text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE b public.sud_buletine%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.sud_buletine WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sud: buletin inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(b.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF b.stare = 'anulat' THEN RAISE EXCEPTION 'sud: buletinul e deja anulat' USING ERRCODE = '55000'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 3 THEN RAISE EXCEPTION 'sud: motivul anularii e obligatoriu' USING ERRCODE = '22023'; END IF;
  UPDATE public.sud_buletine SET stare = 'anulat', anulat_de = auth.uid(), anulat_la = now(), anulat_motiv = btrim(p_motiv), versiune = versiune + 1
   WHERE id = b.id;
END $f$;

CREATE FUNCTION public.fn_sud_sudura_elimina(p_tronson bigint, p_cod text, p_motiv text, p_inlocuita_de text[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_tnr integer; v_n jsonb; v_id bigint; v_inl text[] := '{}'; x text; v_x jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id, public.fn_sud_tronson_nr(cod) INTO v_proiect, v_tnr FROM public.executie_tronsoane WHERE id = p_tronson FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: tronson inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 3 THEN RAISE EXCEPTION 'sud: motivul e obligatoriu' USING ERRCODE = '22023'; END IF;
  v_n := public.fn_sud_cod_normalizeaza(p_cod, v_tnr);
  IF v_n->>'stare' <> 'ok' OR (v_n->>'refacuta')::boolean THEN RAISE EXCEPTION 'sud: codul sudurii nu e valid pe acest tronson' USING ERRCODE = '22023'; END IF;
  FOREACH x IN ARRAY coalesce(p_inlocuita_de, '{}') LOOP
    v_x := public.fn_sud_cod_normalizeaza(x, v_tnr);
    IF v_x->>'stare' <> 'ok' THEN RAISE EXCEPTION 'sud: sudura de inlocuire % nu e valida', x USING ERRCODE = '22023'; END IF;
    v_inl := v_inl || (v_x->>'cheie');
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.sud_suduri_eliminate WHERE tronson_id = p_tronson AND cheie = v_n->>'cheie' AND activ) THEN
    RAISE EXCEPTION 'sud: sudura e deja marcata eliminata' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.sud_suduri_eliminate (proiect_id, tronson_id, cheie, motiv, inlocuita_de, creat_de)
  VALUES (v_proiect, p_tronson, v_n->>'cheie', btrim(p_motiv), v_inl, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

CREATE FUNCTION public.fn_sud_sudura_eliminare_retrage(p_id bigint, p_motiv text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE e public.sud_suduri_eliminate%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.sud_suduri_eliminate WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT e.activ THEN RAISE EXCEPTION 'sud: marcaj inexistent sau deja retras' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(e.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 3 THEN RAISE EXCEPTION 'sud: motivul e obligatoriu' USING ERRCODE = '22023'; END IF;
  UPDATE public.sud_suduri_eliminate SET activ = false, retras_de = auth.uid(), retras_la = now(), retras_motiv = btrim(p_motiv) WHERE id = e.id;
END $f$;

CREATE FUNCTION public.fn_sud_export_deblocheaza(p_pachet bigint, p_tip text, p_motiv text, p_lipsuri jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id INTO v_proiect FROM public.executie_pachete_lansare WHERE id = p_pachet FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: pachet inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect deblocheaza exportul' USING ERRCODE = '42501'; END IF;
  IF p_tip NOT IN ('izo', 'inventar') THEN RAISE EXCEPTION 'sud: tip export invalid' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 5 THEN RAISE EXCEPTION 'sud: motivul deblocarii e obligatoriu' USING ERRCODE = '22023'; END IF;
  IF p_lipsuri IS NULL OR jsonb_typeof(p_lipsuri) <> 'array' OR jsonb_array_length(p_lipsuri) = 0 OR octet_length(p_lipsuri::text) > 500000 THEN
    RAISE EXCEPTION 'sud: lista lipsurilor e obligatorie' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sud_export_deblocari (proiect_id, pachet_id, tip, motiv, lipsuri, creat_de)
  VALUES (v_proiect, p_pachet, p_tip, btrim(p_motiv), p_lipsuri, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Fotografia (R6, §22): {buletine: [{id, versiune}], eliminate: [cheie], metode: [metoda], lipsuri_blocante: [..], avertismente: [..] opțional}.
-- Serverul o compară cu starea CURENTĂ, sub lock pe pachet: buletinele = EXACT mulțimea buletinelor confirmate ale tronsonului pachetului, cu
-- versiunea lor (unul în plus, lipsă, anulat, ciornă, al altui tronson / proiect sau cu altă versiune = diferență); eliminatele = setul activ
-- al tronsonului; metodele = cele obligatorii ale proiectului. Diferență = 40001 (sursele s-au schimbat: reîncarcă fereastra), nimic scris.
-- Lipsurile NU le poate recalcula serverul în PR1a (regulile lor vin cu PR2): exportul complet cere lipsuri_blocante = []; cel incomplet cere
-- deblocarea MP-ului pentru EXACT acele lipsuri (a lui, nefolosită, de cel mult o oră, același pachet și tip), consumată doar la înregistrare.
-- Ordinea lock-urilor (L06): pachetul FOR UPDATE → deblocarea FOR UPDATE; sursele doar citite (o schimbare după verificare = „export depășit”, R6).
CREATE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_tronson bigint; v_id bigint; d public.sud_export_deblocari%ROWTYPE; v_rau text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id, tronson_id INTO v_proiect, v_tronson FROM public.executie_pachete_lansare WHERE id = p_pachet FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: pachet inexistent' USING ERRCODE = '22023'; END IF;
  IF p_tip IS NULL OR p_tip NOT IN ('izo', 'inventar') THEN RAISE EXCEPTION 'sud: tip export invalid' USING ERRCODE = '22023'; END IF;
  IF p_fotografie IS NULL OR jsonb_typeof(p_fotografie) <> 'object' OR octet_length(p_fotografie::text) > 2000000
     OR jsonb_typeof(p_fotografie->'buletine') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'eliminate') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_fotografie->'metode') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'lipsuri_blocante') IS DISTINCT FROM 'array'
     OR coalesce(jsonb_typeof(p_fotografie->'avertismente'), 'array') <> 'array' OR length(p_fisier_path) > 500 THEN
    RAISE EXCEPTION 'sud: fotografia exportului e incompleta (buletine, eliminate, metode, lipsuri_blocante)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'buletine') e
              WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'versiune') IS DISTINCT FROM 'number'
                 OR e->>'id' !~ '^[0-9]{1,18}$' OR e->>'versiune' !~ '^[0-9]{1,9}$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'eliminate') e WHERE jsonb_typeof(e) <> 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'metode') e WHERE jsonb_typeof(e) <> 'string') THEN
    RAISE EXCEPTION 'sud: elementele fotografiei au alt tip (buletine {id, versiune} intregi, eliminate / metode text)' USING ERRCODE = '22023';
  END IF;
  IF p_deblocare_id IS NULL THEN
    -- exportul complet: oricine are dreptul de export (ca exportul de azi), doar fără lipsuri blocante
    IF public.fn_sud_drept(v_proiect, 'export') IS NOT TRUE THEN RAISE EXCEPTION 'sud: fara drept de export pe proiect' USING ERRCODE = '42501'; END IF;
    IF jsonb_array_length(p_fotografie->'lipsuri_blocante') > 0 THEN
      RAISE EXCEPTION 'sud: exportul are lipsuri blocante; cere deblocarea managerului de proiect' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
    SELECT * INTO d FROM public.sud_export_deblocari WHERE id = p_deblocare_id FOR UPDATE;
    IF NOT FOUND OR d.pachet_id <> p_pachet OR d.tip <> p_tip OR d.creat_de <> auth.uid() OR d.folosit_la IS NOT NULL
       OR d.creat_la < now() - interval '1 hour' OR d.lipsuri IS DISTINCT FROM p_fotografie->'lipsuri_blocante' THEN
      RAISE EXCEPTION 'sud: deblocarea nu e valabila pentru acest export' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- sursele: aceleași ca acum (mulțimi întregi, cu dublurile numărate)
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_rau FROM (
    SELECT 'buletine' AS x
     WHERE (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT (e->>'id') || ':' || (e->>'versiune') AS k
                                                                    FROM jsonb_array_elements(p_fotografie->'buletine') e) fb)
           IS DISTINCT FROM
           (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT b.id::text || ':' || b.versiune::text AS k FROM public.sud_buletine b
                                                                   WHERE b.tronson_id = v_tronson AND b.proiect_id = v_proiect AND b.stare = 'confirmat') sb)
    UNION ALL
    SELECT 'eliminate' WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'eliminate') x)
      IS DISTINCT FROM (SELECT coalesce(array_agg(cheie ORDER BY cheie), '{}') FROM public.sud_suduri_eliminate WHERE tronson_id = v_tronson AND activ)
    UNION ALL
    SELECT 'metode' WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'metode') x)
      IS DISTINCT FROM coalesce((SELECT metode FROM public.sud_metode_proiect WHERE proiect_id = v_proiect), '{}')
  ) z;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: sursele s-au schimbat intre verificare si export (%); reincarca fereastra', v_rau USING ERRCODE = '40001'; END IF;
  IF p_deblocare_id IS NOT NULL THEN UPDATE public.sud_export_deblocari SET folosit_la = now() WHERE id = d.id; END IF;
  INSERT INTO public.sud_exporturi (proiect_id, pachet_id, tip, fotografie, incomplet, deblocare_id, fisier_path, creat_de)
  VALUES (v_proiect, p_pachet, p_tip, p_fotografie, p_deblocare_id IS NOT NULL, p_deblocare_id, p_fisier_path, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- ─────────── drepturi pe obiecte ───────────
ALTER TABLE public.sud_metode_proiect ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_buletine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_buletin_randuri ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_suduri_eliminate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_export_deblocari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_exporturi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sud_metode_proiect, public.sud_buletine, public.sud_buletin_randuri, public.sud_suduri_eliminate,
              public.sud_export_deblocari, public.sud_exporturi FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sud_metode_proiect, public.sud_buletine, public.sud_buletin_randuri, public.sud_suduri_eliminate,
              public.sud_export_deblocari, public.sud_exporturi TO authenticated, service_role;
-- secvențele de identitate primesc ALL din privilegiile implicite: clienții nu le folosesc (scrierile sunt ale funcțiilor DEFINER)
REVOKE ALL ON SEQUENCE public.sud_buletine_id_seq, public.sud_buletin_randuri_id_seq, public.sud_suduri_eliminate_id_seq,
              public.sud_export_deblocari_id_seq, public.sud_exporturi_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY sud_metode_proiect_citire ON public.sud_metode_proiect FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_buletine_citire ON public.sud_buletine FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_buletin_randuri_citire ON public.sud_buletin_randuri FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.id = buletin_id));
CREATE POLICY sud_suduri_eliminate_citire ON public.sud_suduri_eliminate FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_export_deblocari_citire ON public.sud_export_deblocari FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_exporturi_citire ON public.sud_exporturi FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));

REVOKE ALL ON FUNCTION public.fn_sud_drept(bigint, text), public.fn_sud_cod_normalizeaza(text, integer), public.fn_sud_tronson_nr(text),
  public.fn_sud_metode_seteaza(bigint, text[]),
  public.fn_sud_buletin_incarca(bigint, text, text, date, text, text, text, text, jsonb, text), public.fn_sud_buletin_confirma(bigint, integer, jsonb),
  public.fn_sud_buletin_anuleaza(bigint, text), public.fn_sud_sudura_elimina(bigint, text, text, text[]),
  public.fn_sud_sudura_eliminare_retrage(bigint, text), public.fn_sud_export_deblocheaza(bigint, text, text, jsonb),
  public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sud_drept(bigint, text), public.fn_sud_cod_normalizeaza(text, integer), public.fn_sud_tronson_nr(text),
  public.fn_sud_metode_seteaza(bigint, text[]),
  public.fn_sud_buletin_incarca(bigint, text, text, date, text, text, text, text, jsonb, text), public.fn_sud_buletin_confirma(bigint, integer, jsonb),
  public.fn_sud_buletin_anuleaza(bigint, text), public.fn_sud_sudura_elimina(bigint, text, text, text[]),
  public.fn_sud_sudura_eliminare_retrage(bigint, text), public.fn_sud_export_deblocheaza(bigint, text, text, jsonb),
  public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text) TO authenticated;

-- ─────────── Storage: bucket privat izo-ndt ───────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('izo-ndt', 'izo-ndt', false, 52428800, ARRAY['application/pdf']);
CREATE POLICY sud_ndt_citire ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'izo-ndt' AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
         AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')));
CREATE POLICY sud_ndt_incarcare ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'izo-ndt' AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$' AND owner_id = (SELECT auth.uid())::text
              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint
                            AND t.proiect_id = split_part(name, '/', 1)::bigint)
              AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'scriere')));
-- ștergerea propriului fișier, doar cât NU e înregistrat într-un buletin (orfanul unei încărcări refuzate; buletinele anulate țin fișierul).
-- Cere și dreptul de CITIRE pe proiect: verificarea „neînregistrat” citește sud_buletine sub RLS-ul apelantului, care vede buletinele
-- proiectului doar cu citire; fără ea, un buletin nevăzut ar lăsa fișierul înregistrat să pară orfan.
CREATE POLICY sud_ndt_sterge_orfan ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'izo-ndt' AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$' AND owner_id = (SELECT auth.uid())::text
         AND created_at < now() - interval '2 hours'
         AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire'))
         AND NOT EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.fisier_path = objects.name));
-- RESTRICTIVE (tiparul izo_aviz_pdf_r_*, 20261120a): pe bucket-ul izo-ndt rămân valabile oricât de largă ar fi altă politică permisivă.
-- _sel / _ins / _del cheamă funcții și tabele fără drept pentru anon → TO authenticated; anon e oprit pe bucket de _anon (FOR ALL).
CREATE POLICY sud_ndt_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id IS DISTINCT FROM 'izo-ndt' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
         AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')));
CREATE POLICY sud_ndt_r_ins ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id IS DISTINCT FROM 'izo-ndt' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
              AND owner_id = auth.uid()::text AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'scriere')
              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint
                            AND t.proiect_id = split_part(name, '/', 1)::bigint)));
CREATE POLICY sud_ndt_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (bucket_id IS DISTINCT FROM 'izo-ndt') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-ndt');
CREATE POLICY sud_ndt_r_del ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id IS DISTINCT FROM 'izo-ndt' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
         AND owner_id = auth.uid()::text AND created_at < now() - interval '2 hours'
         AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')
         AND NOT EXISTS (SELECT 1 FROM public.sud_buletine b WHERE b.fisier_path = objects.name)));
CREATE POLICY sud_ndt_r_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id IS DISTINCT FROM 'izo-ndt') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-ndt');

-- ─────────── postcondiții ───────────
DO $post$
DECLARE v_rau text;
BEGIN
  -- tabelele: RLS activ, doar SELECT pentru authenticated / service_role, nimic pentru anon / PUBLIC
  SELECT string_agg(c.relname || ':' || coalesce(a.d, '-'), '; ') INTO v_rau
    FROM pg_class c LEFT JOIN LATERAL (
      SELECT string_agg(x.d, ',' ORDER BY x.d) d FROM (
        SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || '=' || e.privilege_type AS d
          FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee <> c.relowner) x) a ON true
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%'
     AND (NOT c.relrowsecurity OR c.relforcerowsecurity OR a.d IS DISTINCT FROM 'authenticated=SELECT,service_role=SELECT');
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a post: drepturile tabelelor sud_: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%') <> 6 THEN
    RAISE EXCEPTION '20270114a post: numarul tabelelor sud_';
  END IF;
  -- secvențele sud_: exact cele 5 de identitate, fără niciun drept în afara proprietarului
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_rau FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%'
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) e WHERE e.grantee <> c.relowner);
  IF v_rau IS NOT NULL
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%') <> 5 THEN
    RAISE EXCEPTION '20270114a post: secventele sud_ (numar sau drepturi): %', coalesce(v_rau, 'numar');
  END IF;
  -- funcțiile: DEFINER doar cele de drept și scriere, cale sigură, fără EXECUTE pentru anon / PUBLIC
  SELECT string_agg(p.proname, ', ') INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%'
     AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) <> 'postgres'
          OR p.prosecdef <> (p.proname NOT IN ('fn_sud_cod_normalizeaza', 'fn_sud_tronson_nr'))
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
                      WHERE e.grantee = 0 OR e.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'service_role'))));
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270114a post: functiile fn_sud_: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 11 THEN
    RAISE EXCEPTION '20270114a post: numarul functiilor fn_sud_';
  END IF;
  -- bucket-ul privat + EXACT cele 8 politici sud_ndt_ cu comanda, felul (permisivă / RESTRICTIVĂ) și rolurile lor
  SELECT string_agg(coalesce(a.n, p.polname::text), ', ' ORDER BY coalesce(a.n, p.polname::text)) INTO v_rau
    FROM (VALUES ('sud_ndt_citire', 'r', true, '{authenticated}'), ('sud_ndt_incarcare', 'a', true, '{authenticated}'),
                 ('sud_ndt_sterge_orfan', 'd', true, '{authenticated}'), ('sud_ndt_r_sel', 'r', false, '{authenticated}'),
                 ('sud_ndt_r_ins', 'a', false, '{authenticated}'), ('sud_ndt_r_upd', 'w', false, '{public}'),
                 ('sud_ndt_r_del', 'd', false, '{authenticated}'), ('sud_ndt_r_anon', '*', false, '{anon}')) a(n, cmd, perm, roluri)
    FULL JOIN (SELECT * FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\_ndt\_%') p ON p.polname = a.n
   WHERE a.n IS NULL OR p.polname IS NULL OR p.polcmd::text IS DISTINCT FROM a.cmd OR p.polpermissive IS DISTINCT FROM a.perm
      OR (SELECT array_agg(q.rol ORDER BY q.rol) FROM (SELECT CASE r WHEN 0 THEN 'public' ELSE pg_get_userbyid(r)::text END AS rol
                                                          FROM unnest(p.polroles) r) q)
         IS DISTINCT FROM a.roluri::text[];
  IF v_rau IS NOT NULL OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-ndt' AND public IS FALSE) THEN
    RAISE EXCEPTION '20270114a post: bucket izo-ndt / politicile lui: %', coalesce(v_rau, 'bucket');
  END IF;
  -- informativ: politicile PERMISIVE pe storage.objects care nu încep cu bucket_id = '<un bucket>' (pe producție 27.11.2026: niciuna);
  --   oricum nu ajung la izo-ndt fără să treacă de cele RESTRICTIVE sud_ndt_r_*
  SELECT string_agg(polname, ', ' ORDER BY polname) INTO v_rau FROM pg_policy
   WHERE polrelid = 'storage.objects'::regclass AND polpermissive AND polname NOT LIKE 'sud\_ndt\_%'
     AND NOT (coalesce(pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid), '') ~ '^\(*bucket_id = ''[a-z0-9_-]+''::text'
              AND coalesce(pg_get_expr(polwithcheck, polrelid), pg_get_expr(polqual, polrelid), '') ~ '^\(*bucket_id = ''[a-z0-9_-]+''::text');
  IF v_rau IS NOT NULL THEN RAISE NOTICE '20270114a: politici permisive storage fara bucket fix (acoperite de sud_ndt_r_*): %', v_rau; END IF;
  -- normalizatorul: cazurile de bază (setul complet e în proba PGlite)
  IF public.fn_sud_cod_normalizeaza('GAZPET TR12 S126R', 12) IS DISTINCT FROM
       '{"nr": 126, "cheie": "T12S126", "motiv": null, "stare": "ok", "sufix": "", "tronson": 12, "refacuta": true}'::jsonb
     OR public.fn_sud_cod_normalizeaza('T17S50A', 17)->>'cheie' IS DISTINCT FROM 'T17S50A'
     OR public.fn_sud_cod_normalizeaza('T12S88?1', 12)->>'stare' IS DISTINCT FROM 'nepotrivit'
     OR public.fn_sud_cod_normalizeaza('GAZPET TR13 S5', 12)->>'motiv' IS DISTINCT FROM 'alt_tronson'
     OR public.fn_sud_tronson_nr('TR 1 FOD') IS DISTINCT FROM 1 OR public.fn_sud_tronson_nr('T12') IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION '20270114a post: normalizatorul nu da rezultatele asteptate';
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (docs/izometrie/PORTI_REGULA.md: rândul bucket-ului izo-* e în perimetru;
  -- dacă amprentele nu s-au schimbat, ștampilele recalculate ies identice)
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  -- IZO POST
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270114a post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270114a_izometrie_buletine_ndt:' || txid_current() THEN
    RAISE EXCEPTION '20270114a: garda final invalida';
  END IF;
  RAISE NOTICE '20270114a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
