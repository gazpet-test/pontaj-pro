-- Version 20261215120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh (psql --single-transaction, marcajul gazpet.livrare_migrare legat de txid).
-- 20261215a_executie_raport_rezumat — Raportul zilnic de șantier: REZUMATUL scurt salvat pe raport (etapa 1, determinist, fără AI).
--
-- Ce face:
--   * rapoarte_zilnice + rezumat_text, rezumat_sursa ('automat' / 'editat'), rezumat_la, rezumat_de (NULL la automat). Rândurile vechi rămân
--     cu rezumatul gol (NULL) până la prima lor salvare: migrarea NU scrie date.
--   * Textul automat îl scrie SERVERUL, în aceeași tranzacție cu salvarea raportului, pe ORICE cale de scriere a antetului (L02 / L07):
--     - trigger BEFORE INSERT / UPDATE pe rapoarte_zilnice (trg_raport_zilnic_zz_rezumat; după trg_raport_zilnic_versiune, ordinea numelui):
--       raport nou = rezumat automat; scriere fără rezumat (RPC-ul de salvare, telefonul cu versiunea veche, alte module) = rezumatul
--       automat se reface, DAR un text corectat de om ('editat') NU se suprascrie;
--     - trigger AFTER INSERT pe raport_zilnic_salvari (ultimul pas al fn_raport_zilnic_salveaza, după antet + linii + distribuție): rezumatul
--       automat se reface pe conținutul FINAL al salvării. Nimic de schimbat în telefon: și telefonul vechi primește rezumatul.
--   * Textul automat e derivat (o funcție de raport + liniile lui), deci o scriere care schimbă DOAR rezumatul automat nu mărește
--     versiune_salvare (CAS-ul salvării din 20261208a): altfel telefonul ar vedea un conflict fals după propria salvare.
--   * Corectura omului: UPDATE pe rapoarte_zilnice cu rezumat_sursa = 'editat' + textul (dreptul de scriere de azi pe tabel, niciun drept nou),
--     cu CAS pe versiune_salvare din aplicație; trigger-ul cere dreptul pe șantier (fn_raport_santier_drept, aceeași regulă ca RPC-ul de
--     salvare, L19), text nevid, cel mult 4000 de caractere (peste = refuz, nu tăiere); autorul și ora le pune serverul (L08).
--     Corectura MĂREȘTE versiunea (e o modificare a raportului). „Revino la automat” = UPDATE cu rezumat_sursa = 'automat' (textul îl
--     scrie serverul, nu clientul: un text trimis de client ca „automat” e înlocuit).
--   * Regula textului: fn_raport_rezumat_text(jsonb) — oglinda lui rezumatRaport() din src/raportRezumat.js (L19: dublare inevitabilă
--     SQL / JS = paritate pe același tabel de cazuri, src/raportRezumat.cazuri.json; testul: scripts/test_executie_raport_rezumat.sql).
--     Intrarea: fn_raport_rezumat_intrare(rând) — blocul INTRARE de mai jos e copiat identic în scripts/raport_rezumat_proba.sql.
-- De ce NU se schimbă fn_raport_zilnic_salveaza: 20261209a (acces pe proiect, neaplicată la scriere) îi ține amprenta corpului în inventar,
--   iar 20261213a ține amprenta inventarului; o schimbare a RPC-ului le-ar opri pe amândouă. Funcțiile de aici nu sunt apelabile din API
--   (fără EXECUTE pentru anon / authenticated / service_role), deci nici detectorul de catalog al lui 20261209a nu le cere clasificare.
-- Ce NU face: nicio dată (niciun rezumat generat pentru rapoartele vechi; generarea lor e un pas separat, după proba pe 20 de rapoarte),
--   niciun drept nou, nicio politică, nicio atingere pe raport_lucrari / raport_distributie_linii / RPC-urile 20261208a.
-- Dependențe: 20261208a aplicată (fn_raport_zilnic_salveaza cu amprenta revizuită, fn_raport_zilnic_versiune, raport_zilnic_salvari) și 20261027a.
-- Ordinea lock-urilor (L06), aceeași ca în fn_raport_zilnic_salveaza: rapoarte_zilnice (ACCESS EXCLUSIVE) -> raport_zilnic_salvari (SHARE ROW EXCLUSIVE).
--   La rulare: trigger-ul de pe jurnal actualizează rândul raportului deja blocat de RPC (FOR UPDATE, pasul 1) — niciun lock nou.
-- Revenire: supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql. Test: scripts/test_executie_raport_rezumat.sql (clonă) +
--   scripts/pglite/test_raport_rezumat_local.mjs (local, PGlite).
DO $pre$
DECLARE r record; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215a_executie_raport_rezumat:' || txid_current() THEN
    RAISE EXCEPTION '20261215a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261215a: armare persistenta refuzata';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  -- reaplicare = refuz
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
               AND column_name IN ('rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_raport\_rezumat\_%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_raport_zilnic_zz_rezumat', 'trg_raport_zilnic_salvari_rezumat'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rapoarte_zilnice_rezumat_ck') THEN
    RAISE EXCEPTION '20261215a: obiectele exista deja (reaplicare)';
  END IF;
  -- 20261208a aplicată, cu corpurile revizuite (L15): salvarea scrie jurnalul ULTIMA (după antet, linii, distribuție), versiunea crește la orice scriere
  IF to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)')
                     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres'
                     AND md5(replace(p.prosrc, chr(13), '')) = 'c9c6b6b3d27f14fe29712196b7f23e2c')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_zilnic_versiune()')
                     AND NOT p.prosecdef AND md5(replace(p.prosrc, chr(13), '')) = 'fc7ae4071bb57185e44eda647183192b')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_versiune'
                     AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0
                     AND tg.tgfoid = to_regprocedure('public.fn_raport_zilnic_versiune()')
                     AND tg.tgtype = (1 | 2 | 4 | 16))   -- ROW, BEFORE, INSERT, UPDATE
     OR to_regclass('public.raport_zilnic_salvari') IS NULL THEN
    RAISE EXCEPTION '20261215a: 20261208a nu e aplicata sau RPC-ul de salvare / versiunea difera de amprenta revizuita';
  END IF;
  -- dreptul pe șantier (20261208a; 20261209a îi adaugă condiția de proiect): doar contractul, nu corpul
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_raport_santier_drept(bigint)')
                   AND p.prorettype = 'boolean'::regtype AND p.prosecdef) THEN
    RAISE EXCEPTION '20261215a: fn_raport_santier_drept(bigint) lipseste sau nu e DEFINER boolean';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regclass('public.raport_distributie_linii') IS NULL THEN
    RAISE EXCEPTION '20261215a: auth.uid / raport_distributie_linii (20261027a) lipsesc';
  END IF;
  -- coloanele citite de rezumat, cu tipurile acceptate (din migrările 20261027a / 20261208a și din cod; ce diferă oprește migrarea)
  FOR r IN SELECT * FROM (VALUES
      ('rapoarte_zilnice', 'id', 'bigint'), ('rapoarte_zilnice', 'site_id', 'integer|bigint'), ('rapoarte_zilnice', 'data', 'date'),
      ('rapoarte_zilnice', 'lucrari_efectuate', 'text'), ('rapoarte_zilnice', 'probleme', 'text'), ('rapoarte_zilnice', 'masini', 'text'),
      ('rapoarte_zilnice', 'personal_snapshot', 'jsonb'), ('rapoarte_zilnice', 'utilaje_snapshot', 'jsonb'), ('rapoarte_zilnice', 'meteo', 'jsonb'),
      ('rapoarte_zilnice', 'poze', 'ARRAY'), ('rapoarte_zilnice', 'versiune_salvare', 'integer'), ('rapoarte_zilnice', 'updated_at', 'timestamp with time zone'),
      ('sites', 'id', 'integer|bigint'), ('sites', 'name', 'text|character varying'), ('sites', 'proiect_id', 'integer|bigint'),
      ('executie_proiecte', 'id', 'bigint'), ('executie_proiecte', 'nume', 'text|character varying'),
      ('raport_lucrari', 'id', 'bigint'), ('raport_lucrari', 'raport_id', 'bigint'), ('raport_lucrari', 'activitate_id', 'integer|bigint'),
      ('raport_lucrari', 'unitate_id', 'bigint'), ('raport_lucrari', 'cantitate', 'numeric'),
      ('proiect_activitati', 'id', 'integer|bigint'), ('proiect_activitati', 'nume', 'text|character varying'), ('proiect_activitati', 'um', 'text|character varying'),
      ('proiect_activitati', 'tip_raportare', 'text|character varying'), ('proiect_activitati', 'ordine', 'integer|bigint|smallint|numeric'),
      ('proiect_unitati', 'id', 'bigint'), ('proiect_unitati', 'cod', 'text|character varying'), ('proiect_unitati', 'nume', 'text|character varying'),
      ('proiect_unitati', 'ordine', 'integer|bigint|smallint|numeric'),
      ('raport_distributie_linii', 'raport_id', 'bigint'), ('raport_distributie_linii', 'tabel', 'text|character varying')
    ) v(t, c, tipuri) LOOP
    SELECT data_type INTO v_tip FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c;
    IF v_tip IS NULL OR NOT (v_tip = ANY (string_to_array(r.tipuri, '|'))) THEN
      RAISE EXCEPTION '20261215a: coloana %.% lipseste sau are alt tip (%; asteptat %)', r.t, r.c, coalesce(v_tip, 'lipsa'), r.tipuri;
    END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.rapoarte_zilnice'::regclass AND attname = 'poze' AND NOT attisdropped) <> 'text[]' THEN
    RAISE EXCEPTION '20261215a: rapoarte_zilnice.poze nu e text[]';
  END IF;
  -- trigger-ul nostru compară rândul DUPĂ celelalte trigger-e BEFORE: niciun trigger BEFORE ROW necunoscut nu rulează după el
  -- (ordinea PostgreSQL = numele, colația C) și nu-i schimbă rândul după comparație
  SELECT string_agg(tg.tgname, ', ') INTO v_tip FROM pg_trigger tg
   WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND NOT tg.tgisinternal AND (tg.tgtype & 2) = 2 AND (tg.tgtype & 1) = 1
     AND tg.tgname::text COLLATE "C" > 'trg_raport_zilnic_zz_rezumat' COLLATE "C";
  IF v_tip IS NOT NULL THEN
    RAISE EXCEPTION '20261215a: trigger-e BEFORE ROW necunoscute dupa garda rezumatului pe rapoarte_zilnice: %', v_tip;
  END IF;
  -- lock-urile, în ordinea RPC-ului (L06), înaintea oricărei schimbări
  LOCK TABLE public.rapoarte_zilnice IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.raport_zilnic_salvari IN SHARE ROW EXCLUSIVE MODE;
END $pre$;

-- ── coloanele (constrângere cu nume explicit, diferit de cele automate de coloană) ──
ALTER TABLE public.rapoarte_zilnice
  ADD COLUMN rezumat_text text,
  ADD COLUMN rezumat_sursa text,
  ADD COLUMN rezumat_la timestamptz,
  ADD COLUMN rezumat_de uuid,
  ADD CONSTRAINT rapoarte_zilnice_rezumat_ck CHECK (
    (rezumat_sursa IS NULL AND rezumat_text IS NULL AND rezumat_la IS NULL AND rezumat_de IS NULL)
    OR (rezumat_sursa = 'automat' AND rezumat_text IS NOT NULL AND rezumat_la IS NOT NULL AND rezumat_de IS NULL)
    OR (rezumat_sursa = 'editat' AND rezumat_text ~ '[^[:space:]]' AND char_length(rezumat_text) <= 4000 AND rezumat_la IS NOT NULL));
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_text IS
  'Rezumatul scurt al raportului (WhatsApp / director). Automat = fn_raport_rezumat_text, refăcut de server la fiecare salvare; editat = corectat de om, nu se suprascrie. 20261215a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_sursa IS 'automat / editat (NULL = raport salvat înainte de 20261215a, încă fără rezumat). 20261215a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_la IS 'Când s-a schimbat ultima dată textul rezumatului (pus de server). 20261215a.';
COMMENT ON COLUMN public.rapoarte_zilnice.rezumat_de IS 'Cine a corectat rezumatul (auth.uid(), pus de server); NULL la automat. 20261215a.';

-- ── unelte de text: O SINGURĂ regulă (aceeași în src/raportRezumat.js: curata / trunchiaza / fmtNr) ──
-- un singur rând: caracterele de control (1–31, 127) -> spațiu, spațiile repetate -> unul, fără spații la capete
CREATE FUNCTION public.fn_raport_rezumat_curata(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN p IS NULL THEN '' ELSE
    btrim(regexp_replace(regexp_replace(p, '[' || chr(1) || '-' || chr(31) || chr(127) || ']+', ' ', 'g'), ' {2,}', ' ', 'g'), ' ') END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_curata(text) FROM PUBLIC, anon, authenticated, service_role;

-- cel mult n caractere, tăiat la ultimul spațiu (cuvânt unic mai lung = tăiat la n), cu „…”
CREATE FUNCTION public.fn_raport_rezumat_taie(p text, n integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE t text := public.fn_raport_rezumat_curata(p); c text; i integer;
BEGIN
  IF length(t) <= n THEN RETURN t; END IF;
  c := left(t, n + 1);
  i := CASE WHEN strpos(c, ' ') = 0 THEN 0 ELSE length(c) - strpos(reverse(c), ' ') + 1 END;
  RETURN CASE WHEN i > 1 THEN left(c, i - 1) ELSE left(t, n) END || '…';
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_taie(text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- un șir JSON (alt tip = NULL: nu se interpretează); un număr JSON exact cum e, cu virgulă zecimală (alt tip = NULL)
CREATE FUNCTION public.fn_raport_rezumat_sir(j jsonb, k text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN jsonb_typeof(j -> k) = 'string' THEN j ->> k END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_sir(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.fn_raport_rezumat_nr(j jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT CASE WHEN jsonb_typeof(j) = 'number' THEN replace(trim_scale((j #>> '{}')::numeric)::text, '.', ',') END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_nr(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── textul rezumatului (oglinda lui rezumatRaport din src/raportRezumat.js; cifrele copiate, câmp lipsă = bucata lipsește) ──
CREATE FUNCTION public.fn_raport_rezumat_text(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE
  x jsonb := CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END;
  v_out text[] := ARRAY[]::text[];
  s text; pr text; d text; m jsonb; mp text[] := ARRAY[]::text[]; al text;
  ps jsonb; cat text[]; v_oam text := ''; u jsonb; nef text[]; v_ut text := ''; v_pz text := ''; ech text[];
  l jsonb; cod text; nume text; et text; act text; buc text; c text; um text; k integer;
  grp_et text[] := ARRAY[]::text[]; grp_b text[] := ARRAY[]::text[];
  di jsonb; dp text[] := ARRAY[]::text[]; t text; pb text[];
BEGIN
  -- 1. șantierul (+ proiectul, dacă e altul), data, vremea
  s := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(x, 'santier'));
  pr := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(x, 'proiect'));
  d := CASE WHEN jsonb_typeof(x -> 'data') = 'string' AND (x ->> 'data') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN substr(x ->> 'data', 9, 2) || '.' || substr(x ->> 'data', 6, 2) || '.' || substr(x ->> 'data', 1, 4) ELSE '' END;
  m := x -> 'meteo';
  IF jsonb_typeof(m) = 'object' THEN
    IF jsonb_typeof(m -> 'temp') = 'number' THEN mp := mp || (public.fn_raport_rezumat_nr(m -> 'temp') || ' °C'); END IF;
    IF jsonb_typeof(m -> 'precip_mm') = 'number' AND (m ->> 'precip_mm')::numeric > 0 THEN
      mp := mp || ('precipitații ' || public.fn_raport_rezumat_nr(m -> 'precip_mm') || ' mm');
    END IF;
    IF jsonb_typeof(m -> 'alerte') = 'array' THEN
      SELECT string_agg(w.z, ', ' ORDER BY w.o) INTO al
        FROM (SELECT public.fn_raport_rezumat_curata(CASE WHEN jsonb_typeof(q.a) = 'string' THEN q.a #>> '{}' END) AS z, q.o
                FROM jsonb_array_elements(m -> 'alerte') WITH ORDINALITY q(a, o)) w
       WHERE w.z <> '';
      IF al IS NOT NULL THEN mp := mp || ('alerte: ' || al); END IF;
    END IF;
  END IF;
  v_out := v_out || (coalesce(nullif(s, ''), 'Raport zilnic')
                     || CASE WHEN pr <> '' AND pr <> s THEN ' (proiect ' || pr || ')' ELSE '' END
                     || CASE WHEN d <> '' THEN ' · ' || d ELSE '' END
                     || CASE WHEN cardinality(mp) > 0 THEN ' · ' || array_to_string(mp, ', ') ELSE '' END);
  -- 2. oameni · utilaje · poze
  ps := x -> 'personal';
  IF jsonb_typeof(ps) = 'object' THEN
    SELECT array_agg(ct.l || ' ' || public.fn_raport_rezumat_nr(ps -> ct.k) ORDER BY ct.o) INTO cat
      FROM (VALUES (1, 'sudori', 'sudori'), (2, 'lacatusi', 'lăcătuși'), (3, 'operatori', 'operatori utilaje'), (4, 'soferi', 'șoferi'),
                   (5, 'necalificati', 'necalificați'), (6, 'tesa', 'TESA'), (7, 'altii', 'alții')) ct(o, k, l)
     WHERE jsonb_typeof(ps -> ct.k) = 'number' AND (ps ->> ct.k)::numeric > 0;
    IF jsonb_typeof(ps -> 'total') = 'number' THEN
      v_oam := 'Oameni: ' || public.fn_raport_rezumat_nr(ps -> 'total') || CASE WHEN cat IS NOT NULL THEN ' (' || array_to_string(cat, ', ') || ')' ELSE '' END;
    ELSIF cat IS NOT NULL THEN
      v_oam := 'Oameni: ' || array_to_string(cat, ', ');
    END IF;
  END IF;
  u := x -> 'utilaje';
  IF jsonb_typeof(u) = 'array' AND jsonb_array_length(u) > 0 THEN
    SELECT array_agg(CASE WHEN w.mo <> '' THEN w.den || ' – ' || w.mo ELSE w.den END ORDER BY w.o) INTO nef
      FROM (SELECT q.o,
                   coalesce(nullif(public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(q.e, 'nume')), ''),
                            nullif(public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(q.e, 'cod')), ''), 'fără denumire') AS den,
                   public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(q.e, 'motiv'), 80) AS mo
              FROM jsonb_array_elements(u) WITH ORDINALITY q(e, o)
             WHERE jsonb_typeof(q.e) = 'object' AND public.fn_raport_rezumat_sir(q.e, 'stare') = 'nefunctional') w;
    v_ut := 'Utilaje: ' || jsonb_array_length(u) || CASE WHEN nef IS NOT NULL THEN ' (nefuncționale: ' || array_to_string(nef, '; ') || ')' ELSE '' END;
  END IF;
  IF jsonb_typeof(x -> 'poze') = 'number' AND (x ->> 'poze')::numeric > 0 THEN v_pz := 'Poze: ' || public.fn_raport_rezumat_nr(x -> 'poze'); END IF;
  ech := array_remove(ARRAY[v_oam, v_ut, v_pz], '');
  IF cardinality(ech) > 0 THEN v_out := v_out || array_to_string(ech, ' · '); END IF;
  -- 3. lucrările cu cantități, pe obiecte, în ordinea primei apariții; distribuția
  IF jsonb_typeof(x -> 'linii') = 'array' THEN
    FOR l IN SELECT q.e FROM jsonb_array_elements(x -> 'linii') WITH ORDINALITY q(e, o) ORDER BY q.o LOOP
      CONTINUE WHEN jsonb_typeof(l) IS DISTINCT FROM 'object';
      cod := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'obiect_cod'));
      nume := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'obiect_nume'));
      et := CASE WHEN cod <> '' AND nume <> '' THEN cod || ' · ' || nume ELSE coalesce(nullif(cod, ''), nume) END;
      act := coalesce(nullif(public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'activitate')), ''), 'activitate');
      IF l -> 'bifa' = 'true'::jsonb THEN
        buc := act || ' (efectuat)';
      ELSE
        c := public.fn_raport_rezumat_nr(l -> 'cantitate');
        um := public.fn_raport_rezumat_curata(public.fn_raport_rezumat_sir(l, 'um'));
        buc := CASE WHEN c IS NULL THEN act || ' (fără cantitate)' ELSE act || ' ' || c || CASE WHEN um <> '' THEN ' ' || um ELSE '' END END;
      END IF;
      k := array_position(grp_et, et);
      IF k IS NULL THEN grp_et := grp_et || et; grp_b := grp_b || buc; ELSE grp_b[k] := grp_b[k] || '; ' || buc; END IF;
    END LOOP;
  END IF;
  FOR k IN 1 .. coalesce(cardinality(grp_et), 0) LOOP
    v_out := v_out || (CASE WHEN grp_et[k] <> '' THEN 'Lucrări ' || grp_et[k] ELSE 'Lucrări' END || ': ' || grp_b[k]);
  END LOOP;
  di := x -> 'distributie';
  IF jsonb_typeof(di) = 'object' THEN
    IF jsonb_typeof(di -> 'conducte') = 'number' AND (di ->> 'conducte')::numeric > 0 THEN dp := dp || ('conducte ' || public.fn_raport_rezumat_nr(di -> 'conducte')); END IF;
    IF jsonb_typeof(di -> 'bransamente') = 'number' AND (di ->> 'bransamente')::numeric > 0 THEN dp := dp || ('branșamente ' || public.fn_raport_rezumat_nr(di -> 'bransamente')); END IF;
    IF cardinality(dp) > 0 THEN v_out := v_out || ('Distribuție gaze (rânduri): ' || array_to_string(dp, ', ')); END IF;
  END IF;
  -- 4. textul liber al lucrărilor (detalii, dacă există și cantități)
  t := public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'lucrari'), 240);
  IF t <> '' THEN v_out := v_out || (CASE WHEN cardinality(grp_et) > 0 THEN 'Detalii' ELSE 'Lucrări' END || ': ' || t); END IF;
  -- 5. probleme · mașini
  pb := array_remove(ARRAY[
          CASE WHEN public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'probleme'), 240) <> ''
               THEN 'Probleme: ' || public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'probleme'), 240) END,
          CASE WHEN public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'masini'), 160) <> ''
               THEN 'Mașini: ' || public.fn_raport_rezumat_taie(public.fn_raport_rezumat_sir(x, 'masini'), 160) END], NULL);
  IF cardinality(pb) > 0 THEN v_out := v_out || array_to_string(pb, ' · '); END IF;
  RETURN array_to_string(v_out, chr(10));
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_text(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── intrarea rezumatului, din rândul raportului (NEW în trigger) + liniile / distribuția lui de acum ──
-- Blocul INTRARE e copiat IDENTIC în scripts/raport_rezumat_proba.sql (testul src/raportRezumat.test.js verifică).
CREATE FUNCTION public.fn_raport_rezumat_intrare(z public.rapoarte_zilnice) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT
    -- INTRARE-START
    jsonb_build_object(
      'santier', (SELECT s.name FROM public.sites s WHERE s.id = z.site_id),
      'proiect', (SELECT p.nume FROM public.sites s JOIN public.executie_proiecte p ON p.id = s.proiect_id WHERE s.id = z.site_id),
      'data', to_char(z.data, 'YYYY-MM-DD'),
      'meteo', z.meteo,
      'personal', z.personal_snapshot,
      'utilaje', z.utilaje_snapshot,
      'linii', (SELECT coalesce(jsonb_agg(jsonb_build_object('obiect_cod', pu.cod, 'obiect_nume', pu.nume, 'activitate', pa.nume, 'um', pa.um,
                                                             'cantitate', rl.cantitate, 'bifa', coalesce(pa.tip_raportare, 'cantitate') = 'bifa')
                                          ORDER BY (rl.unitate_id IS NOT NULL), pu.ordine, pu.id, pa.ordine, pa.id, rl.id), '[]'::jsonb)
                  FROM public.raport_lucrari rl
                  LEFT JOIN public.proiect_activitati pa ON pa.id = rl.activitate_id
                  LEFT JOIN public.proiect_unitati pu ON pu.id = rl.unitate_id
                 WHERE rl.raport_id = z.id),
      'distributie', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                  ELSE jsonb_build_object('conducte', count(*) FILTER (WHERE d.tabel = 'conducta'),
                                                          'bransamente', count(*) FILTER (WHERE d.tabel = 'bransament')) END
                        FROM public.raport_distributie_linii d WHERE d.raport_id = z.id),
      'lucrari', z.lucrari_efectuate,
      'probleme', z.probleme,
      'masini', z.masini,
      'poze', cardinality(z.poze))
    -- INTRARE-END
$f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_intrare(public.rapoarte_zilnice) FROM PUBLIC, anon, authenticated, service_role;

-- ── garda + generarea, pe ORICE scriere a antetului (L07). DEFINER: citește liniile / numele ca proprietar (aceeași imagine pentru oricine)
--    și cheamă fn_raport_santier_drept (fără EXECUTE pentru clienți). Nu e apelabilă din API (trigger, fără EXECUTE). ──
CREATE FUNCTION public.fn_raport_rezumat_garda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_uid uuid := auth.uid(); v_text text;
  v_cols text[] := ARRAY['versiune_salvare', 'rezumat_text', 'rezumat_sursa', 'rezumat_la', 'rezumat_de'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- raport nou: rezumatul automat (o corectură se face doar pe un raport existent); ce a trimis clientul nu contează (L08)
    NEW.rezumat_sursa := 'automat';
  ELSIF (NEW.rezumat_text, NEW.rezumat_sursa, NEW.rezumat_la, NEW.rezumat_de)
        IS NOT DISTINCT FROM (OLD.rezumat_text, OLD.rezumat_sursa, OLD.rezumat_la, OLD.rezumat_de) THEN
    -- scriere fără rezumat (RPC-ul de salvare, telefonul vechi, alte module): textul corectat de om rămâne; altfel se reface
    IF OLD.rezumat_sursa = 'editat' THEN RETURN NEW; END IF;
    NEW.rezumat_sursa := 'automat';
  ELSIF NEW.rezumat_sursa = 'editat' THEN
    -- corectura omului: dreptul pe șantier (aceeași regulă ca salvarea, L19); calea server fără JWT (psql) = permisă
    IF v_uid IS NOT NULL AND public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN
      RAISE EXCEPTION 'rezumat: nu ai drept de scriere pe raportul acestui șantier' USING ERRCODE = '42501';
    END IF;
    IF NEW.rezumat_text IS NULL OR NEW.rezumat_text !~ '[^[:space:]]' THEN
      RAISE EXCEPTION 'rezumat: textul corectat nu poate fi gol (pentru textul automat: rezumat_sursa = automat)' USING ERRCODE = '22023';
    END IF;
    IF char_length(NEW.rezumat_text) > 4000 THEN
      RAISE EXCEPTION 'rezumat: textul corectat are % caractere (maximum 4000)', char_length(NEW.rezumat_text) USING ERRCODE = '22023';
    END IF;
    NEW.rezumat_la := now();
    NEW.rezumat_de := v_uid;
    RETURN NEW;   -- versiunea crește (trigger-ul de versiune): corectura e o modificare a raportului
  ELSIF NEW.rezumat_sursa = 'automat' THEN
    -- cerere de (re)generare: peste un text corectat de om, tot cu dreptul pe șantier; textul îl scrie serverul (mai jos)
    IF OLD.rezumat_sursa = 'editat' AND v_uid IS NOT NULL AND public.fn_raport_santier_drept(NEW.site_id::bigint) IS NOT TRUE THEN
      RAISE EXCEPTION 'rezumat: nu ai drept de scriere pe raportul acestui șantier' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'rezumat: sursa rezumatului trebuie să fie automat sau editat' USING ERRCODE = '22023';
  END IF;
  -- textul automat: din câmpurile raportului (NEW) și liniile / distribuția lui de acum
  v_text := public.fn_raport_rezumat_text(public.fn_raport_rezumat_intrare(NEW));
  NEW.rezumat_la := CASE WHEN TG_OP = 'UPDATE' AND OLD.rezumat_sursa = 'automat' AND OLD.rezumat_text IS NOT DISTINCT FROM v_text
                         THEN OLD.rezumat_la ELSE now() END;
  NEW.rezumat_text := v_text;
  NEW.rezumat_de := NULL;
  -- scriere care schimbă DOAR rezumatul automat (derivat): versiunea rămâne (CAS-ul salvării, 20261208a)
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - v_cols) = (to_jsonb(OLD) - v_cols) THEN
    NEW.versiune_salvare := OLD.versiune_salvare;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_garda() FROM PUBLIC, anon, authenticated, service_role;
-- „zz”: după trg_raport_zilnic_versiune (PostgreSQL rulează trigger-ele în ordinea numelui)
CREATE TRIGGER trg_raport_zilnic_zz_rezumat BEFORE INSERT OR UPDATE ON public.rapoarte_zilnice
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_garda();

-- ── după salvarea prin RPC (jurnalul e scris ULTIMUL): rezumatul automat pe conținutul final. Rulează ca apelantul inserției în jurnal
--    (doar RPC-ul DEFINER scrie acolo; clienții nu au niciun drept pe tabel). ──
CREATE FUNCTION public.fn_raport_rezumat_dupa_salvare() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  UPDATE public.rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE id = NEW.raport_id AND rezumat_sursa IS DISTINCT FROM 'editat';
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION public.fn_raport_rezumat_dupa_salvare() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_raport_zilnic_salvari_rezumat AFTER INSERT ON public.raport_zilnic_salvari
  FOR EACH ROW EXECUTE FUNCTION public.fn_raport_rezumat_dupa_salvare();

-- ── postcondiții ──
DO $post$
DECLARE v_fn name[] := ARRAY['fn_raport_rezumat_curata', 'fn_raport_rezumat_taie', 'fn_raport_rezumat_sir', 'fn_raport_rezumat_nr',
                             'fn_raport_rezumat_text', 'fn_raport_rezumat_intrare', 'fn_raport_rezumat_garda', 'fn_raport_rezumat_dupa_salvare']::name[];
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rapoarte_zilnice'
        AND ((column_name IN ('rezumat_text', 'rezumat_sursa') AND data_type = 'text') OR (column_name = 'rezumat_la' AND data_type = 'timestamp with time zone')
             OR (column_name = 'rezumat_de' AND data_type = 'uuid'))) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rapoarte_zilnice'::regclass AND conname = 'rapoarte_zilnice_rezumat_ck'
                     AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION '20261215a post: coloanele / constrangerea';
  END IF;
  -- funcțiile: search_path fix; DEFINER doar garda; NICIUN EXECUTE pentru clienți (nu sunt apelabile din API)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY (v_fn)) <> 8
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = ANY (v_fn)
                   AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
                        OR p.prosecdef IS DISTINCT FROM (p.proname = 'fn_raport_rezumat_garda')
                        OR pg_get_userbyid(p.proowner) <> 'postgres'
                        OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                        OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                        OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))) THEN
    RAISE EXCEPTION '20261215a post: functii (definer / search_path / owner / EXECUTE)';
  END IF;
  -- trigger-ele: exact forma (L15) și ordinea (garda rezumatului DUPĂ versiune)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.rapoarte_zilnice'::regclass AND tg.tgname = 'trg_raport_zilnic_zz_rezumat'
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_raport_rezumat_garda()'::regprocedure
                   AND tg.tgtype = (1 | 2 | 4 | 16))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = 'public.raport_zilnic_salvari'::regclass AND tg.tgname = 'trg_raport_zilnic_salvari_rezumat'
                   AND tg.tgenabled = 'O' AND tg.tgqual IS NULL AND tg.tgnargs = 0 AND tg.tgfoid = 'public.fn_raport_rezumat_dupa_salvare()'::regprocedure
                   AND tg.tgtype = (1 | 4))   -- ROW, AFTER, INSERT
     OR NOT ('trg_raport_zilnic_versiune' COLLATE "C" < 'trg_raport_zilnic_zz_rezumat' COLLATE "C") THEN
    RAISE EXCEPTION '20261215a post: trigger-ele';
  END IF;
  -- textul: un caz cu diacritice, amprenta UTF-8 a rezultatului (prinde și o codare greșită a fișierului la aplicare)
  IF md5(convert_to(public.fn_raport_rezumat_text(jsonb_build_object('santier', 'Ș', 'data', '2026-01-02',
           'personal', jsonb_build_object('lacatusi', 2, 'total', 2), 'probleme', 'a' || chr(9) || 'b')), 'UTF8')) <> 'eb4f44e7d61bfc57dd33cc2b7e2d37d0'
     OR public.fn_raport_rezumat_text('{}'::jsonb) <> 'Raport zilnic' THEN
    RAISE EXCEPTION '20261215a post: textul rezumatului difera de cel asteptat (codarea fisierului?)';
  END IF;
  -- migrarea nu scrie date
  IF EXISTS (SELECT 1 FROM public.rapoarte_zilnice WHERE rezumat_sursa IS NOT NULL OR rezumat_text IS NOT NULL) THEN
    RAISE EXCEPTION '20261215a post: migrarea nu scrie date';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261215a_executie_raport_rezumat:' || txid_current() THEN
    RAISE EXCEPTION '20261215a: garda final invalida';
  END IF;
END $post$;
