-- Version 20270116120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala <md5> --diferente-globale
--   PLAFONUL EXTINS (15000 ms, doar în fereastra 21:00–06:00 Europe/Bucharest, docs/LIVRARE_L15_V2.md §9): aceeași amprentă globală L15 v2 ca la
--   20270114a / 20270115b, a căror probă cu ROLLBACK pe producție a depășit plafonul standard de 5000 ms (decizia proprietarului 27.11.2026).
--   supabase/migrations/20270116a_izometrie_coordonate_clase_subcontr.l15.tsv (manifestul îl generează coordonatorul pe clonă, docs/LIVRARE_L15_V2.md §5).
-- 20270116a_izometrie_coordonate_clase_subcontr — Izometrie, PR1b din docs/izometrie/BULETINE_NDT_SPEC.md (§13 D16–D19, §15, §16, §17, §21 R2 / R6 / R8 / R11,
--   §22 cheia sudurii, §24 drepturile): coordonatele sudurilor, clasele de locație pe intervale de km, marcajul pachetelor de la subcontractor și
--   fotografia exportului INVENTAR. Se aplică DUPĂ 20270115b (o cere exact).
-- Ce face:
--   * Tabele NOI, prefix sud_ (NICIUN FK spre executie_* / izo_*, niciun ALTER pe ele; existența tronsonului / pachetului o verifică funcțiile, sub lock):
--     sud_coordonate_incarcari (fișierul `cod X Y Z` al MP-ului: Storage + amprentă, starea ciorna → confirmat → anulat, versiune) și
--     sud_coordonate (un rând pe sudură și încărcare; cheia sudurii = tronson + număr + sufix, FĂRĂ refacere — §22 — calculată de SERVER; o singură
--     poziție activă pe sudură, istoricul rămâne: o reîncărcare confirmată trece pozițiile vechi în „inlocuit”);
--     sud_clase_surse (schema de montaj citită o dată, cu citirea AI păstrată ca dată; ciorna → confirmat → anulat, o singură sursă vie pe tronson) și
--     sud_clase_interval (intervalele [km_de, km_pana) → clasa = text scurt normalizat de server — fără spații la capete, majuscule, 1–10 caractere
--     din [0-9 A-Z . / + -], fără spații interne; notația o validează MP-ul la confirmare, nu o listă fixă —, scrise O DATĂ, la confirmarea MP-ului;
--     FĂRĂ suprapuneri pe tronson: constrângere
--     de excludere GiST pe intervalele neanulate — capetele comune sunt permise, sudura de la graniță o decide omul în ecran, ca în
--     src/exportInventarXlsx.js);
--     sud_pachete_subcontractor (marcajul „executat de subcontractor”: codul și revizia reale ale pachetului, PDF-ul aprobat obligatoriu, Excel-ul
--     centralizatorului obligatoriu sau — rezerva D19 — motivul lipsei lui și sursa rândurilor „ai_pdf”; cheia = tronson + cod document + revizie,
--     deci un reimport al pachetului îl regăsește, R2).
--   * Bucket privat izo-sud-doc (fișierul de coordonate, schema de montaj, PDF-ul / Excel-ul subcontractorului), cale <proiect>/<tronson>/<nume>, cu
--     ACELEAȘI politici ca izo-ndt (20270114a): permisive (citire, încărcare cu owner_id = auth.uid(), ștergerea propriului fișier NEÎNREGISTRAT după
--     2 h) + RESTRICTIVE sud_doc_r_* (UPDATE interzis, anon oprit). Un fișier se înregistrează doar în prima oră de la încărcare (fn_sud_doc_fisier_ok).
--   * Dreptul: fn_sud_drept din 20270114a (R9, O SINGURĂ definiție): scrieri = owner / MP-ul proiectului; citire = accesul de citire pe pachete.
--     Scrierile DOAR prin funcții SECURITY DEFINER care verifică dreptul în corp (auth.uid() obligatoriu); clienții au doar SELECT pe tabele.
--     Autorul, momentele, cheile sudurilor, versiunile, starea le pune serverul.
--   * fn_sud_export_inregistreaza: CREATE OR REPLACE peste corpul 20270115b (aceeași semnătură), plus DOAR pentru tip = 'inventar': fotografia are
--     în plus pozițiile active ale tronsonului (id-uri), sursa claselor confirmată (id + versiune sau null) și amprentele TUTUROR pachetelor tronsonului
--     (elementul aval vine și din pachetul următor, R7); serverul le recitește sub lock-ul pachetului și refuză cu 40001 la orice diferență (R6).
--     Exportul IZO rămâne exact ca în 20270115b.
-- Conținut extern: schema de montaj și PDF-ul subcontractorului pot fi citite cu AI (PR4 / PR6); citirea se păstrează doar ca dată (formă + mărime
--   validate), nu se execută nimic din ea; intervalele / rândurile intră doar prin confirmarea MP-ului, cu valorile validate de server (tipuri, limite,
--   zecimale, suprapuneri). Rezervarea plafonului AI (R10) vine cu funcțiile edge (PR4 / PR6), nu aici.
-- Concurență (L06): ordinea lock-urilor pe toate căile acestei migrări = tronsonul FOR UPDATE → încărcarea / sursa FOR UPDATE → rândurile copil;
--   marcajul de subcontractor: pachetul FOR UPDATE → marcajul; înregistrarea exportului: pachetul FOR UPDATE → deblocarea (sursele doar citite).
--   Confirmarea / anularea cer versiunea citită (CAS, 40001). Tronsonul se RECITEȘTE sub lock la confirmare / anulare: dreptul se verifică pe
--   proiectul LUI ACTUAL; la confirmare, un tronson șters, mutat pe alt proiect sau (la coordonate) cu alt număr în cod față de încărcare = refuz
--   22023, nimic activat (anulează și reîncarcă).
-- Revenire: supabase/revenire/20270116a_izometrie_coordonate_clase_subcontr_ROLLBACK.sql (refuză dacă există date sau fișiere; repune corpul 20270115b).
-- Probe: scripts/pglite/test_izometrie_coordonate_clase_local.mjs (pe 20270114a + 20270115b aplicate).
DO $pre$
DECLARE v_plafon text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270116a_izometrie_coordonate_clase_subcontr:' || txid_current() THEN
    RAISE EXCEPTION '20270116a: garda start invalida';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270116a: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION '20270116a: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270116a: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '15000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '15000:' || txid_current() THEN
    RAISE EXCEPTION '20270116a: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 15000/session pus de runner inainte de BEGIN: livrare_migrare.sh --plafon-tranzactie-ms 15000 --plafon-extins)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema() AND c.relkind = 'r' AND c.relname ~ '^ag_ina_[0-9a-f]{16}$'
                    AND c.xmin::text = (txid_current() % 4294967296)::text
                    AND (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.pid = pg_backend_pid() AND l.granted) > 0) THEN
    RAISE EXCEPTION '20270116a: AMPRENTA_GLOBALA_LIPSA: livrarea cere amprenta globala L15 v2 a runnerului (--amprenta-globala + --diferente-globale); nimic schimbat';
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF to_regclass('public.executie_proiecte') IS NULL OR to_regclass('public.executie_tronsoane') IS NULL
     OR to_regclass('public.executie_pachete_lansare') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION '20270116a: dependente lipsa (executie_proiecte, executie_tronsoane, executie_pachete_lansare, profiles, storage, auth.uid)';
  END IF;
  -- 20270115b aplicată EXACT: cele 7 tabele și 15 funcții sud_, nimic în plus, iar corpurile pe care se sprijină această migrare (dreptul, normalizatorul,
  -- numărul tronsonului, amprenta pachetului, înregistrarea exportului care se înlocuiește) = cele din 20270114a / 20270115b (md5 pe prosrc fără CR)
  -- + DEFINER, calea, proprietarul, EXECUTE-ul clienților
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname IN
        ('sud_metode_proiect', 'sud_buletine', 'sud_buletin_randuri', 'sud_suduri_eliminate', 'sud_export_deblocari', 'sud_exporturi', 'sud_citiri')) <> 7
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'sud\_%' AND c.relkind = 'r') <> 7
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 15 THEN
    RAISE EXCEPTION '20270116a: starea 20270115b lipseste sau are obiecte sud_ in plus (reaplicare?)';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
          ('public.fn_sud_drept(bigint, text)', 'b95f48de906c9d0047579ca69e961349', true, 'boolean'),
          ('public.fn_sud_cod_normalizeaza(text, integer)', '32a362818c35312d99338496073003bb', false, 'jsonb'),
          ('public.fn_sud_tronson_nr(text)', '98b53b0b9a5285bf189e7f4dec9c0d5e', false, 'integer'),
          ('public.fn_sud_amprenta_pachet(bigint)', '4450813859d7b57ce85abddfbc63547a', true, 'text'),
          ('public.fn_sud_export_inregistreaza(bigint, text, jsonb, bigint, text)', '2881656bdc951dd5d53318ccab93feba', true, 'bigint')) a(semnatura, amprenta, definer, tip)
        LEFT JOIN pg_proc p ON p.oid = to_regprocedure(a.semnatura)
        WHERE p.oid IS NULL OR md5(replace(p.prosrc, chr(13), '')) IS DISTINCT FROM a.amprenta
           OR p.prosecdef IS DISTINCT FROM a.definer OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
           OR p.prorettype IS DISTINCT FROM to_regtype(a.tip)::oid
           OR pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
           OR has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
           OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION '20270116a: fn_sud_drept / normalizatorul / amprenta pachetului / fn_sud_export_inregistreaza nu sunt cele din 20270114a / 20270115b';
  END IF;
  -- lanțul de drept chemat de fn_sud_drept (L15: callee tranzitive) = constantele revizuite din 20270114a
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
    RAISE EXCEPTION '20270116a: lantul de drept (fn_executie_proiect_permis + callee 20261209a, fn_executie_pachete_acces 20261029a) lipseste sau nu e cel revizuit';
  END IF;
  -- coloanele citite, cu tipurile comparate (identitățile ca la 20270114a; codul și revizia pachetului = valorile comparate cu marcajul subcontractorului)
  IF EXISTS (SELECT 1 FROM (VALUES ('executie_proiecte', 'id', 'bigint'), ('executie_tronsoane', 'id', 'bigint'), ('executie_tronsoane', 'proiect_id', 'bigint'),
                                   ('executie_tronsoane', 'cod', 'text'), ('executie_pachete_lansare', 'id', 'bigint'),
                                   ('executie_pachete_lansare', 'proiect_id', 'bigint'), ('executie_pachete_lansare', 'tronson_id', 'bigint'),
                                   ('executie_pachete_lansare', 'cod_document_full', 'text'), ('executie_pachete_lansare', 'revizie', 'integer')) c(t, col, tip)
              WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.t
                                  AND i.column_name = c.col AND i.data_type = c.tip)) THEN
    RAISE EXCEPTION '20270116a: coloanele citite nu au tipurile asteptate (executie_tronsoane / executie_pachete_lansare)';
  END IF;
  IF to_regprocedure('public.fn_izo_porti_lipsa()') IS NULL THEN RAISE EXCEPTION '20270116a: portile Izometrie (fn_izo_porti_lipsa) lipsesc'; END IF;
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270116a: portile Izometrie nu sunt verzi inainte: %', public.fn_izo_porti_lipsa();
  END IF;
  -- reaplicare / coliziune de nume (bucket-ul și politicile lui)
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-sud-doc')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\_doc\_%') THEN
    RAISE EXCEPTION '20270116a: bucket-ul izo-sud-doc / politicile sud_doc_ exista deja (reaplicare)';
  END IF;
END $pre$;

-- ─────────── tabele ───────────
CREATE TABLE public.sud_coordonate_incarcari (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  fisier_path text NOT NULL CHECK (length(fisier_path) <= 500),
  fisier_nume text CHECK (length(fisier_nume) <= 300),
  fisier_sha256 text NOT NULL CHECK (fisier_sha256 ~ '^[0-9a-f]{64}$'),
  nr_randuri integer NOT NULL CHECK (nr_randuri BETWEEN 1 AND 20000),
  rezumat jsonb CHECK (rezumat IS NULL OR jsonb_typeof(rezumat) = 'object'),
  stare text NOT NULL DEFAULT 'ciorna' CHECK (stare IN ('ciorna', 'confirmat', 'anulat')),
  versiune integer NOT NULL DEFAULT 1,
  incarcat_de uuid NOT NULL,
  incarcat_la timestamptz NOT NULL DEFAULT now(),
  confirmat_de uuid,
  confirmat_la timestamptz,
  anulat_de uuid,
  anulat_la timestamptz,
  anulat_motiv text,
  CONSTRAINT sud_coordonate_incarcari_stare_ck CHECK (
    (stare = 'ciorna' AND confirmat_la IS NULL AND confirmat_de IS NULL AND anulat_la IS NULL AND anulat_de IS NULL)
    OR (stare = 'confirmat' AND confirmat_la IS NOT NULL AND confirmat_de IS NOT NULL AND anulat_la IS NULL AND anulat_de IS NULL)
    OR (stare = 'anulat' AND anulat_la IS NOT NULL AND anulat_de IS NOT NULL AND length(btrim(anulat_motiv)) >= 3))
);
-- o singură încărcare în lucru pe tronson; amprenta fișierului unică pe proiect între încărcările neanulate
CREATE UNIQUE INDEX sud_coordonate_incarcari_ciorna_uq ON public.sud_coordonate_incarcari (tronson_id) WHERE stare = 'ciorna';
CREATE UNIQUE INDEX sud_coordonate_incarcari_fisier_uq ON public.sud_coordonate_incarcari (proiect_id, fisier_sha256) WHERE stare <> 'anulat';

CREATE TABLE public.sud_coordonate (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incarcare_id bigint NOT NULL REFERENCES public.sud_coordonate_incarcari(id),
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  linie integer NOT NULL CHECK (linie BETWEEN 1 AND 1000000),
  cod_raw text NOT NULL CHECK (length(cod_raw) <= 80),
  cod text NOT NULL CHECK (length(cod) <= 80),
  cheie text NOT NULL CHECK (cheie ~ '^T[0-9]+S[0-9]+'),
  cod_corectat boolean NOT NULL,
  x numeric NOT NULL, y numeric NOT NULL, z numeric NOT NULL,
  stare text NOT NULL DEFAULT 'propus' CHECK (stare IN ('propus', 'activ', 'inlocuit', 'anulat')),
  inlocuit_de bigint REFERENCES public.sud_coordonate(id),
  inlocuit_la timestamptz,
  CONSTRAINT sud_coordonate_inlocuit_ck CHECK ((stare = 'inlocuit') = (inlocuit_de IS NOT NULL) AND (inlocuit_de IS NULL) = (inlocuit_la IS NULL)),
  CONSTRAINT sud_coordonate_valori_ck CHECK (x = round(x, 3) AND y = round(y, 3) AND z = round(z, 3)
    AND abs(x) < 10000000 AND abs(y) < 10000000 AND abs(z) < 10000),
  UNIQUE (incarcare_id, cheie),
  UNIQUE (incarcare_id, linie)
);
-- O SINGURĂ poziție confirmată pe sudură (§16)
CREATE UNIQUE INDEX sud_coordonate_activ_uq ON public.sud_coordonate (tronson_id, cheie) WHERE stare = 'activ';
CREATE INDEX sud_coordonate_tronson_ix ON public.sud_coordonate (tronson_id, stare);

CREATE TABLE public.sud_clase_surse (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  fisier_path text NOT NULL CHECK (length(fisier_path) <= 500),
  fisier_nume text CHECK (length(fisier_nume) <= 300),
  fisier_sha256 text NOT NULL CHECK (fisier_sha256 ~ '^[0-9a-f]{64}$'),
  citire jsonb CHECK (citire IS NULL OR jsonb_typeof(citire) = 'object'),
  stare text NOT NULL DEFAULT 'ciorna' CHECK (stare IN ('ciorna', 'confirmat', 'anulat')),
  versiune integer NOT NULL DEFAULT 1,
  incarcat_de uuid NOT NULL,
  incarcat_la timestamptz NOT NULL DEFAULT now(),
  confirmat_de uuid,
  confirmat_la timestamptz,
  anulat_de uuid,
  anulat_la timestamptz,
  anulat_motiv text,
  CONSTRAINT sud_clase_surse_stare_ck CHECK (
    (stare = 'ciorna' AND confirmat_la IS NULL AND confirmat_de IS NULL AND anulat_la IS NULL AND anulat_de IS NULL)
    OR (stare = 'confirmat' AND confirmat_la IS NOT NULL AND confirmat_de IS NOT NULL AND anulat_la IS NULL AND anulat_de IS NULL)
    OR (stare = 'anulat' AND anulat_la IS NOT NULL AND anulat_de IS NOT NULL AND length(btrim(anulat_motiv)) >= 3))
);
-- „o singură dată pe tronson” (§15): o singură sursă neanulată; corectura = anulare + reîncărcare (ca la buletine, R5)
CREATE UNIQUE INDEX sud_clase_surse_tronson_uq ON public.sud_clase_surse (tronson_id) WHERE stare <> 'anulat';
CREATE UNIQUE INDEX sud_clase_surse_fisier_uq ON public.sud_clase_surse (proiect_id, fisier_sha256) WHERE stare <> 'anulat';

CREATE TABLE public.sud_clase_interval (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sursa_id bigint NOT NULL REFERENCES public.sud_clase_surse(id),
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  ordine integer NOT NULL,
  km_de numeric NOT NULL,
  km_pana numeric NOT NULL,
  -- forma normalizată (aceeași regulă ca fn_sud_clasa_interval_valid + upper(btrim()) la scriere; paritatea e probată în PGlite)
  clasa text NOT NULL CHECK (clasa ~ '^[0-9A-Z./+-]{1,10}$'),
  anulat boolean NOT NULL DEFAULT false,
  CONSTRAINT sud_clase_interval_km_ck CHECK (km_de >= 0 AND km_pana > km_de AND km_pana < 10000000 AND km_de = round(km_de, 3) AND km_pana = round(km_pana, 3)),
  UNIQUE (sursa_id, ordine),
  -- fără suprapuneri pe tronson (R11): [km_de, km_pana) pe intervalele neanulate; ambele chei sunt intervale (int8range pe tronson), deci nu cere btree_gist
  CONSTRAINT sud_clase_interval_fara_suprapuneri EXCLUDE USING gist (int8range(tronson_id, tronson_id, '[]') WITH &&, numrange(km_de, km_pana, '[)') WITH &&)
    WHERE (NOT anulat)
);

CREATE TABLE public.sud_pachete_subcontractor (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proiect_id bigint NOT NULL,
  tronson_id bigint NOT NULL,
  pachet_id bigint NOT NULL,
  cod_document text NOT NULL CHECK (btrim(cod_document) <> '' AND length(cod_document) <= 200),
  cod_document_cheie text NOT NULL,
  revizie integer NOT NULL CHECK (revizie BETWEEN 0 AND 999),
  subcontractor text CHECK (length(subcontractor) <= 200),
  pdf_path text NOT NULL CHECK (length(pdf_path) <= 500),
  pdf_nume text CHECK (length(pdf_nume) <= 300),
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  excel_path text CHECK (length(excel_path) <= 500),
  excel_nume text CHECK (length(excel_nume) <= 300),
  excel_sha256 text CHECK (excel_sha256 ~ '^[0-9a-f]{64}$'),
  sursa_randuri text NOT NULL CHECK (sursa_randuri IN ('excel', 'ai_pdf')),
  excel_lipsa_motiv text,
  activ boolean NOT NULL DEFAULT true,
  versiune integer NOT NULL DEFAULT 1,
  creat_de uuid NOT NULL,
  creat_la timestamptz NOT NULL DEFAULT now(),
  retras_de uuid, retras_la timestamptz, retras_motiv text,
  -- D19: se cer ambele fișiere; rezerva „ai_pdf” doar fără Excel și cu motivul lipsei lui
  CONSTRAINT sud_pachete_subcontractor_sursa_ck CHECK (
    (sursa_randuri = 'excel' AND excel_path IS NOT NULL AND excel_sha256 IS NOT NULL AND excel_lipsa_motiv IS NULL AND excel_sha256 <> pdf_sha256)
    OR (sursa_randuri = 'ai_pdf' AND excel_path IS NULL AND excel_nume IS NULL AND excel_sha256 IS NULL AND length(btrim(excel_lipsa_motiv)) >= 5)),
  CONSTRAINT sud_pachete_subcontractor_retras_ck CHECK (
    (activ AND retras_la IS NULL AND retras_de IS NULL AND retras_motiv IS NULL)
    OR (NOT activ AND retras_la IS NOT NULL AND retras_de IS NOT NULL AND length(btrim(retras_motiv)) >= 3))
);
CREATE UNIQUE INDEX sud_pachete_subcontractor_uq ON public.sud_pachete_subcontractor (tronson_id, cod_document_cheie, revizie) WHERE activ;

-- ─────────── ajutătoare (INVOKER, chemate DOAR din funcțiile DEFINER de mai jos; clienții nu au EXECUTE) ───────────
-- Fișierul înregistrat: în bucket-ul izo-sud-doc, sub calea proiectului și a tronsonului, încărcat de apelant (owner_id = auth.uid(), coloana pe care
-- o impun politicile de încărcare), în ultima oră (fereastra față de ștergerea orfanului după 2 h, ca la 20270114a). O SINGURĂ definiție (L19).
CREATE FUNCTION public.fn_sud_doc_fisier_ok(p_proiect bigint, p_tronson bigint, p_path text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT coalesce(auth.uid() IS NOT NULL AND p_proiect IS NOT NULL AND p_tronson IS NOT NULL
    AND p_path ~ ('^' || p_proiect::text || '/' || p_tronson::text || '/[^/]+$') AND length(p_path) <= 500
    AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'izo-sud-doc' AND o.name = p_path AND o.owner_id = auth.uid()::text
                  AND o.created_at > now() - interval '1 hour'), false)
$f$;

-- Un rând din fișierul de coordonate, după rezolvarea omului (forma exactă: {linie, cod_raw, cod, x, y, z}; cod = codul ales de MP — la un rând
-- „nesigur” poate fi propunerea acceptată —, cod_raw = textul din fișier). NULL = valid, altfel motivul. Ordinea verificărilor e garantată (IF-uri),
-- castul doar după tip. Coordonatele: Stereo 70, metri, cel mult 3 zecimale (R11) — mai multe = refuz, nu rotunjire.
CREATE FUNCTION public.fn_sud_coord_rand_valid(r jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE k text; v numeric; v_max numeric;
BEGIN
  IF r IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN 'nu e obiect'; END IF;
  IF NOT (r ?& ARRAY['linie', 'cod_raw', 'cod', 'x', 'y', 'z'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) j WHERE j NOT IN ('linie', 'cod_raw', 'cod', 'x', 'y', 'z')) THEN
    RETURN 'chei';
  END IF;
  IF jsonb_typeof(r->'linie') <> 'number' OR r->>'linie' !~ '^[0-9]{1,7}$' THEN RETURN 'linie'; END IF;
  IF (r->>'linie')::integer < 1 OR (r->>'linie')::integer > 1000000 THEN RETURN 'linie'; END IF;
  FOREACH k IN ARRAY ARRAY['cod_raw', 'cod'] LOOP
    IF jsonb_typeof(r->k) <> 'string' OR length(r->>k) > 80 OR r->>k !~ '[^[:space:]]' THEN RETURN k; END IF;
  END LOOP;
  -- un cod scris doar din cifre e un număr de punct topografic, nu un cod de sudură (aceeași regulă ca parseazaCoordonate, src/lib/izoCoordonate.js)
  IF r->>'cod' ~ '^[[:space:]]*[0-9]+[[:space:]]*$' THEN RETURN 'cod: doar numar (punct topografic)'; END IF;
  FOREACH k IN ARRAY ARRAY['x', 'y', 'z'] LOOP
    IF jsonb_typeof(r->k) <> 'number' THEN RETURN k; END IF;
    v := (r->>k)::numeric;
    IF v <> round(v, 3) THEN RETURN k || ': peste 3 zecimale'; END IF;
    -- limita în variabilă: un CASE … THEN în condiția unui IF plpgsql rupe instrucțiunea
    v_max := CASE WHEN k = 'z' THEN 10000 ELSE 10000000 END;
    IF abs(v) >= v_max THEN RETURN k || ': in afara domeniului'; END IF;
  END LOOP;
  RETURN NULL;
END $f$;

-- Un interval de clasă confirmat de MP: {km_de, km_pana, clasa}; metri (aceeași unitate ca poz_km_m din pachet), cel mult 3 zecimale,
-- 0 <= km_de < km_pana < 10.000 km. Clasa: text; după scoaterea spațiilor de la capete, 1–10 caractere din [0-9 A-Z a-z . / + -] (fără spații
-- interne, fără caractere invizibile; litere ASCII, deci majusculele nu depind de localizare). Se scrie cu majuscule (upper(btrim()) în
-- fn_sud_clase_confirma). Notația (1–4, III, 2A …) nu e restrânsă aici: o validează MP-ul la confirmare. NULL = valid, altfel motivul.
CREATE FUNCTION public.fn_sud_clasa_interval_valid(r jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$
DECLARE k text; v numeric;
BEGIN
  IF r IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN 'nu e obiect'; END IF;
  IF NOT (r ?& ARRAY['km_de', 'km_pana', 'clasa'])
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) j WHERE j NOT IN ('km_de', 'km_pana', 'clasa')) THEN
    RETURN 'chei';
  END IF;
  FOREACH k IN ARRAY ARRAY['km_de', 'km_pana'] LOOP
    IF jsonb_typeof(r->k) <> 'number' THEN RETURN k; END IF;
    v := (r->>k)::numeric;
    IF v <> round(v, 3) THEN RETURN k || ': peste 3 zecimale'; END IF;
    IF v < 0 OR v >= 10000000 THEN RETURN k || ': in afara domeniului'; END IF;
  END LOOP;
  IF (r->>'km_pana')::numeric <= (r->>'km_de')::numeric THEN RETURN 'km_pana <= km_de'; END IF;
  IF jsonb_typeof(r->'clasa') <> 'string' OR btrim(r->>'clasa') !~ '^[0-9A-Za-z./+-]{1,10}$' THEN RETURN 'clasa'; END IF;
  RETURN NULL;
END $f$;

-- ─────────── coordonatele (D16, §16) ───────────
-- Încărcarea: fișierul din Storage + rândurile rezolvate de om (parseazaCoordonate + rezolvarea din ecran). Serverul calculează cheia sudurii din `cod`
-- (fn_sud_cod_normalizeaza pe tronsonul încărcării; alt tronson / format = refuz), refuză dublurile de cheie și de linie (omul le rezolvă înainte),
-- marchează cod_corectat când codul ales diferă de cel din fișier. Nimic nu devine poziție confirmată aici (stare „propus”).
-- Ordinea lock-urilor (L06): tronsonul FOR UPDATE → (inserări).
CREATE FUNCTION public.fn_sud_coord_incarca(p_tronson bigint, p_fisier_path text, p_fisier_nume text, p_sha256 text, p_randuri jsonb, p_rezumat jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_tnr integer; v_id bigint; v_i bigint; v_rau text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id, public.fn_sud_tronson_nr(cod) INTO v_proiect, v_tnr FROM public.executie_tronsoane WHERE id = p_tronson FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: tronson inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF v_tnr IS NULL THEN RAISE EXCEPTION 'sud: numarul tronsonului nu se poate citi din codul lui' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_doc_fisier_ok(v_proiect, p_tronson, p_fisier_path) IS NOT TRUE THEN
    RAISE EXCEPTION 'sud: fisierul nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora (reincarca-l)' USING ERRCODE = '22023';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR length(p_fisier_nume) > 300 THEN
    RAISE EXCEPTION 'sud: amprenta / numele fisierului invalide' USING ERRCODE = '22023';
  END IF;
  IF p_rezumat IS NOT NULL AND (jsonb_typeof(p_rezumat) <> 'object' OR octet_length(p_rezumat::text) > 500000) THEN
    RAISE EXCEPTION 'sud: rezumatul are alt format sau e prea mare' USING ERRCODE = '22023';
  END IF;
  IF p_randuri IS NULL OR jsonb_typeof(p_randuri) <> 'array' OR jsonb_array_length(p_randuri) = 0 OR jsonb_array_length(p_randuri) > 20000
     OR octet_length(p_randuri::text) > 5000000 THEN
    RAISE EXCEPTION 'sud: randurile lipsesc sau sunt peste 20000' USING ERRCODE = '22023';
  END IF;
  SELECT e.i, public.fn_sud_coord_rand_valid(e.r) INTO v_i, v_rau FROM jsonb_array_elements(p_randuri) WITH ORDINALITY e(r, i)
   WHERE public.fn_sud_coord_rand_valid(e.r) IS NOT NULL ORDER BY e.i LIMIT 1;
  IF v_i IS NOT NULL THEN RAISE EXCEPTION 'sud: randul % are alta forma (%)', v_i, v_rau USING ERRCODE = '22023'; END IF;
  SELECT e.i INTO v_i FROM jsonb_array_elements(p_randuri) WITH ORDINALITY e(r, i)
   WHERE public.fn_sud_cod_normalizeaza(e.r->>'cod', v_tnr)->>'stare' IS DISTINCT FROM 'ok' ORDER BY e.i LIMIT 1;
  IF v_i IS NOT NULL THEN RAISE EXCEPTION 'sud: randul % are un cod de sudura care nu e valid pe acest tronson', v_i USING ERRCODE = '22023'; END IF;
  SELECT k INTO v_rau FROM (SELECT public.fn_sud_cod_normalizeaza(e.r->>'cod', v_tnr)->>'cheie' AS k FROM jsonb_array_elements(p_randuri) e(r)) z
   GROUP BY k HAVING count(*) > 1 ORDER BY k LIMIT 1;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: sudura % apare de mai multe ori (rezolva dublura inainte)', v_rau USING ERRCODE = '22023'; END IF;
  SELECT k INTO v_rau FROM (SELECT e.r->>'linie' AS k FROM jsonb_array_elements(p_randuri) e(r)) z GROUP BY k HAVING count(*) > 1 ORDER BY k LIMIT 1;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: linia % apare de mai multe ori', v_rau USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_id FROM public.sud_coordonate_incarcari WHERE tronson_id = p_tronson AND stare = 'ciorna' LIMIT 1;
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: incarcare_in_lucru:%', v_id USING ERRCODE = '23505'; END IF;
  SELECT id INTO v_id FROM public.sud_coordonate_incarcari WHERE proiect_id = v_proiect AND fisier_sha256 = p_sha256 AND stare <> 'anulat' LIMIT 1;
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: fisier_deja_incarcat:%', v_id USING ERRCODE = '23505'; END IF;
  INSERT INTO public.sud_coordonate_incarcari (proiect_id, tronson_id, fisier_path, fisier_nume, fisier_sha256, nr_randuri, rezumat, incarcat_de)
  VALUES (v_proiect, p_tronson, p_fisier_path, p_fisier_nume, p_sha256, jsonb_array_length(p_randuri), p_rezumat, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.sud_coordonate (incarcare_id, proiect_id, tronson_id, linie, cod_raw, cod, cheie, cod_corectat, x, y, z)
  SELECT v_id, v_proiect, p_tronson, (e.r->>'linie')::integer, e.r->>'cod_raw', e.r->>'cod',
         public.fn_sud_cod_normalizeaza(e.r->>'cod', v_tnr)->>'cheie',
         (public.fn_sud_cod_normalizeaza(e.r->>'cod_raw', v_tnr)->>'cheie') IS DISTINCT FROM (public.fn_sud_cod_normalizeaza(e.r->>'cod', v_tnr)->>'cheie')
           OR e.r->>'cod_raw' ~ '^[[:space:]]*[0-9]+[[:space:]]*$',
         (e.r->>'x')::numeric, (e.r->>'y')::numeric, (e.r->>'z')::numeric
    FROM jsonb_array_elements(p_randuri) WITH ORDINALITY e(r, i) ORDER BY e.i;
  RETURN v_id;
END $f$;

-- Confirmarea (CAS pe versiune): pozițiile propuse devin active; o poziție activă a aceleiași suduri trece în „inlocuit” (istoricul rămâne, §16).
-- Când valorile diferă, înlocuirea cere confirmarea explicită: p_inlocuiri = EXACT mulțimea cheilor cu altă poziție activă (cum le-a văzut omul);
-- altă mulțime = 40001 (starea s-a schimbat sau înlocuirile nu sunt confirmate), nimic scris. Pozițiile identice se înlocuiesc fără confirmare.
-- Tronsonul se recitește SUB LOCK (FK-ul lipsește intenționat): trebuie să existe, să fie tot pe proiectul încărcării, iar cheile sudurilor
-- recalculate cu codul LUI ACTUAL (fn_sud_tronson_nr → fn_sud_cod_normalizeaza) = cheile de la încărcare; dreptul se verifică pe proiectul ACTUAL.
-- Altfel refuz 22023, nimic activat (omul anulează și reîncarcă).
-- Ordinea lock-urilor (L06): tronsonul FOR UPDATE → încărcarea FOR UPDATE → rândurile sud_coordonate (UPDATE pe tronsonul blocat).
CREATE FUNCTION public.fn_sud_coord_confirma(p_incarcare bigint, p_versiune integer, p_inlocuiri text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_tronson bigint; v_tp bigint; v_tnr integer; i public.sud_coordonate_incarcari%ROWTYPE; v_dif text[]; v_cer text[]; v_ident integer; v_inl integer; v_act integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT tronson_id INTO v_tronson FROM public.sud_coordonate_incarcari WHERE id = p_incarcare;
  IF v_tronson IS NULL THEN RAISE EXCEPTION 'sud: incarcare inexistenta' USING ERRCODE = '22023'; END IF;
  SELECT proiect_id, public.fn_sud_tronson_nr(cod) INTO v_tp, v_tnr FROM public.executie_tronsoane WHERE id = v_tronson FOR UPDATE;
  IF v_tp IS NULL THEN RAISE EXCEPTION 'sud: tronsonul incarcarii nu mai exista; anuleaza incarcarea' USING ERRCODE = '22023'; END IF;
  SELECT * INTO i FROM public.sud_coordonate_incarcari WHERE id = p_incarcare FOR UPDATE;
  IF public.fn_sud_drept(v_tp, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF i.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: incarcarea nu e ciorna (%)', i.stare USING ERRCODE = '55000'; END IF;
  IF p_versiune IS DISTINCT FROM i.versiune THEN RAISE EXCEPTION 'sud: incarcarea s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  IF v_tp IS DISTINCT FROM i.proiect_id THEN
    RAISE EXCEPTION 'sud: tronsonul incarcarii a fost mutat pe alt proiect dupa incarcare; anuleaza si reincarca' USING ERRCODE = '22023';
  END IF;
  IF v_tnr IS NULL OR EXISTS (SELECT 1 FROM public.sud_coordonate c WHERE c.incarcare_id = i.id
                                AND (public.fn_sud_cod_normalizeaza(c.cod, v_tnr)->>'stare' IS DISTINCT FROM 'ok'
                                     OR public.fn_sud_cod_normalizeaza(c.cod, v_tnr)->>'cheie' IS DISTINCT FROM c.cheie)) THEN
    RAISE EXCEPTION 'sud: codul tronsonului s-a schimbat dupa incarcare (cheile sudurilor nu mai corespund); anuleaza si reincarca' USING ERRCODE = '22023';
  END IF;
  -- pozițiile active ale acelorași suduri: cu alte valori (cer confirmarea) / identice (se înlocuiesc fără ea)
  SELECT coalesce(array_agg(n.cheie ORDER BY n.cheie) FILTER (WHERE (a.x, a.y, a.z) IS DISTINCT FROM (n.x, n.y, n.z)), '{}'),
         count(*) FILTER (WHERE (a.x, a.y, a.z) IS NOT DISTINCT FROM (n.x, n.y, n.z))
    INTO v_dif, v_ident FROM public.sud_coordonate n
    JOIN public.sud_coordonate a ON a.tronson_id = n.tronson_id AND a.cheie = n.cheie AND a.stare = 'activ'
   WHERE n.incarcare_id = i.id;
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_cer FROM unnest(coalesce(p_inlocuiri, '{}')) x;
  IF v_cer IS DISTINCT FROM v_dif THEN
    RAISE EXCEPTION 'sud: inlocuirile confirmate nu sunt cele de pe server (% pozitii diferite de cele active); reincarca', cardinality(v_dif)
      USING ERRCODE = '40001';
  END IF;
  -- întâi pozițiile vechi ies din „activ” (indexul unic pe poziția activă), apoi cele noi intră
  UPDATE public.sud_coordonate a SET stare = 'inlocuit', inlocuit_de = n.id, inlocuit_la = now()
    FROM public.sud_coordonate n
   WHERE n.incarcare_id = i.id AND a.tronson_id = n.tronson_id AND a.cheie = n.cheie AND a.stare = 'activ';
  GET DIAGNOSTICS v_inl = ROW_COUNT;
  UPDATE public.sud_coordonate SET stare = 'activ' WHERE incarcare_id = i.id AND stare = 'propus';
  GET DIAGNOSTICS v_act = ROW_COUNT;
  IF v_act <> i.nr_randuri OR v_inl <> cardinality(v_dif) + v_ident THEN
    RAISE EXCEPTION 'sud: confirmarea coordonatelor nu se potriveste cu incarcarea (% / % active, % / % inlocuite)', v_act, i.nr_randuri, v_inl, cardinality(v_dif) + v_ident;
  END IF;
  UPDATE public.sud_coordonate_incarcari SET stare = 'confirmat', confirmat_de = auth.uid(), confirmat_la = now(), versiune = versiune + 1 WHERE id = i.id;
  RETURN jsonb_build_object('active', v_act, 'inlocuite_diferite', cardinality(v_dif), 'inlocuite_identice', v_ident);
END $f$;

-- Anularea (CAS pe versiune, cu motiv): o ciornă sau o încărcare confirmată. Pozițiile ei propuse / active devin „anulat”; pozițiile pe care le
-- înlocuise NU revin singure (nicio poziție nu reapare fără confirmarea omului): sudura rămâne fără poziție până la o încărcare nouă (lipsa se vede
-- în inventar, R8). Rezultatul: {anulate: câte poziții au ieșit, fara_pozitie: [cheile sudurilor care aveau poziția ACTIVĂ din această încărcare
-- și rămân fără nicio poziție activă, în ordinea liniilor din fișier]} — ecranul le afișează (la o ciornă lista e goală: nimic nu era activ).
-- Dreptul: pe proiectul ACTUAL al tronsonului (recitit sub lock); dacă tronsonul nu mai există, pe proiectul încărcării (anularea curăță, nu
-- activează nimic, L20). Ordinea lock-urilor (L06): tronsonul → încărcarea → rândurile.
CREATE FUNCTION public.fn_sud_coord_anuleaza(p_incarcare bigint, p_versiune integer, p_motiv text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_tronson bigint; v_tp bigint; i public.sud_coordonate_incarcari%ROWTYPE; v_n integer; v_fara jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT tronson_id INTO v_tronson FROM public.sud_coordonate_incarcari WHERE id = p_incarcare;
  IF v_tronson IS NULL THEN RAISE EXCEPTION 'sud: incarcare inexistenta' USING ERRCODE = '22023'; END IF;
  SELECT proiect_id INTO v_tp FROM public.executie_tronsoane WHERE id = v_tronson FOR UPDATE;
  SELECT * INTO i FROM public.sud_coordonate_incarcari WHERE id = p_incarcare FOR UPDATE;
  IF public.fn_sud_drept(coalesce(v_tp, i.proiect_id), 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF i.stare = 'anulat' THEN RAISE EXCEPTION 'sud: incarcarea e deja anulata' USING ERRCODE = '55000'; END IF;
  IF p_versiune IS DISTINCT FROM i.versiune THEN RAISE EXCEPTION 'sud: incarcarea s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 3 THEN RAISE EXCEPTION 'sud: motivul anularii e obligatoriu' USING ERRCODE = '22023'; END IF;
  WITH scoase AS (
    UPDATE public.sud_coordonate c SET stare = 'anulat' FROM public.sud_coordonate v
     WHERE v.id = c.id AND c.incarcare_id = i.id AND c.stare IN ('propus', 'activ')
    RETURNING c.cheie, c.linie, v.stare AS stare_veche)
  SELECT count(*), coalesce(jsonb_agg(cheie ORDER BY linie) FILTER (WHERE stare_veche = 'activ'), '[]'::jsonb) INTO v_n, v_fara FROM scoase;
  -- (indexul unic: o singură poziție activă pe sudură, deci cele scoase din „activ” nu mai au nicio poziție activă; verificarea o confirmă)
  IF EXISTS (SELECT 1 FROM public.sud_coordonate a WHERE a.tronson_id = i.tronson_id AND a.stare = 'activ'
               AND a.cheie IN (SELECT jsonb_array_elements_text(v_fara))) THEN
    RAISE EXCEPTION 'sud: anularea a lasat pozitii active pe sudurile scoase';
  END IF;
  UPDATE public.sud_coordonate_incarcari SET stare = 'anulat', anulat_de = auth.uid(), anulat_la = now(), anulat_motiv = btrim(p_motiv), versiune = versiune + 1
   WHERE id = i.id;
  RETURN jsonb_build_object('anulate', v_n, 'fara_pozitie', v_fara);
END $f$;

-- ─────────── clasele de locație (D17, §15) ───────────
-- Încărcarea schemei de montaj: fișierul + citirea AI (doar dată: obiect, cel mult 2 MB; nimic nu se execută din ea). O singură sursă neanulată
-- pe tronson. Intervalele se scriu O DATĂ, la confirmare. Ordinea lock-urilor (L06): tronsonul FOR UPDATE → (inserare).
CREATE FUNCTION public.fn_sud_clase_incarca(p_tronson bigint, p_fisier_path text, p_fisier_nume text, p_sha256 text, p_citire jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id INTO v_proiect FROM public.executie_tronsoane WHERE id = p_tronson FOR UPDATE;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'sud: tronson inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF public.fn_sud_doc_fisier_ok(v_proiect, p_tronson, p_fisier_path) IS NOT TRUE THEN
    RAISE EXCEPTION 'sud: fisierul nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora (reincarca-l)' USING ERRCODE = '22023';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR length(p_fisier_nume) > 300 THEN
    RAISE EXCEPTION 'sud: amprenta / numele fisierului invalide' USING ERRCODE = '22023';
  END IF;
  IF p_citire IS NOT NULL AND (jsonb_typeof(p_citire) <> 'object' OR octet_length(p_citire::text) > 2000000) THEN
    RAISE EXCEPTION 'sud: citirea AI are alt format sau e prea mare' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_id FROM public.sud_clase_surse WHERE tronson_id = p_tronson AND stare <> 'anulat' LIMIT 1;
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: clase_deja_incarcate:%', v_id USING ERRCODE = '23505'; END IF;
  SELECT id INTO v_id FROM public.sud_clase_surse WHERE proiect_id = v_proiect AND fisier_sha256 = p_sha256 AND stare <> 'anulat' LIMIT 1;
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: fisier_deja_incarcat:%', v_id USING ERRCODE = '23505'; END IF;
  INSERT INTO public.sud_clase_surse (proiect_id, tronson_id, fisier_path, fisier_nume, fisier_sha256, citire, incarcat_de)
  VALUES (v_proiect, p_tronson, p_fisier_path, p_fisier_nume, p_sha256, p_citire, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Confirmarea MP-ului (CAS pe versiune): intervalele validate (fn_sud_clasa_interval_valid), fără suprapuneri între ele ([km_de, km_pana): capetele
-- comune sunt permise) — refuz explicit 22023 înaintea constrângerii de excludere. Clasa se scrie normalizată (upper(btrim())).
-- Tronsonul se recitește SUB LOCK: trebuie să existe și să fie tot pe proiectul sursei; dreptul se verifică pe proiectul ACTUAL; altfel 22023, nimic scris.
-- Ordinea lock-urilor (L06): tronsonul → sursa → (inserări).
CREATE FUNCTION public.fn_sud_clase_confirma(p_sursa bigint, p_versiune integer, p_intervale jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_tronson bigint; v_tp bigint; s public.sud_clase_surse%ROWTYPE; v_i bigint; v_j bigint; v_rau text; v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT tronson_id INTO v_tronson FROM public.sud_clase_surse WHERE id = p_sursa;
  IF v_tronson IS NULL THEN RAISE EXCEPTION 'sud: sursa claselor inexistenta' USING ERRCODE = '22023'; END IF;
  SELECT proiect_id INTO v_tp FROM public.executie_tronsoane WHERE id = v_tronson FOR UPDATE;
  IF v_tp IS NULL THEN RAISE EXCEPTION 'sud: tronsonul sursei claselor nu mai exista; anuleaza sursa' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM public.sud_clase_surse WHERE id = p_sursa FOR UPDATE;
  IF public.fn_sud_drept(v_tp, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF s.stare <> 'ciorna' THEN RAISE EXCEPTION 'sud: sursa claselor nu e ciorna (%)', s.stare USING ERRCODE = '55000'; END IF;
  IF p_versiune IS DISTINCT FROM s.versiune THEN RAISE EXCEPTION 'sud: sursa claselor s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  IF v_tp IS DISTINCT FROM s.proiect_id THEN
    RAISE EXCEPTION 'sud: tronsonul sursei claselor a fost mutat pe alt proiect dupa incarcare; anuleaza si reincarca' USING ERRCODE = '22023';
  END IF;
  IF p_intervale IS NULL OR jsonb_typeof(p_intervale) <> 'array' OR jsonb_array_length(p_intervale) = 0 OR jsonb_array_length(p_intervale) > 500 THEN
    RAISE EXCEPTION 'sud: intervalele lipsesc sau sunt peste 500' USING ERRCODE = '22023';
  END IF;
  SELECT e.i, public.fn_sud_clasa_interval_valid(e.r) INTO v_i, v_rau FROM jsonb_array_elements(p_intervale) WITH ORDINALITY e(r, i)
   WHERE public.fn_sud_clasa_interval_valid(e.r) IS NOT NULL ORDER BY e.i LIMIT 1;
  IF v_i IS NOT NULL THEN RAISE EXCEPTION 'sud: intervalul % are alta forma (%)', v_i, v_rau USING ERRCODE = '22023'; END IF;
  SELECT a.i, b.i INTO v_i, v_j FROM jsonb_array_elements(p_intervale) WITH ORDINALITY a(r, i), jsonb_array_elements(p_intervale) WITH ORDINALITY b(r, i)
   WHERE a.i < b.i AND numrange((a.r->>'km_de')::numeric, (a.r->>'km_pana')::numeric, '[)') && numrange((b.r->>'km_de')::numeric, (b.r->>'km_pana')::numeric, '[)')
   ORDER BY a.i, b.i LIMIT 1;
  IF v_i IS NOT NULL THEN RAISE EXCEPTION 'sud: intervalele % si % se suprapun', v_i, v_j USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sud_clase_interval (sursa_id, proiect_id, tronson_id, ordine, km_de, km_pana, clasa)
  SELECT s.id, s.proiect_id, s.tronson_id, e.i, (e.r->>'km_de')::numeric, (e.r->>'km_pana')::numeric, upper(btrim(e.r->>'clasa'))
    FROM jsonb_array_elements(p_intervale) WITH ORDINALITY e(r, i) ORDER BY e.i;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.sud_clase_surse SET stare = 'confirmat', confirmat_de = auth.uid(), confirmat_la = now(), versiune = versiune + 1 WHERE id = s.id;
  RETURN v_n;
END $f$;

-- Anularea (CAS, cu motiv): intervalele ies din constrângerea de excludere (anulat), sursa devine „anulat”; o sursă nouă se poate încărca după.
-- Dreptul: pe proiectul ACTUAL al tronsonului (recitit sub lock); tronson inexistent = pe proiectul sursei (anularea curăță, L20).
-- Ordinea lock-urilor (L06): tronsonul → sursa → intervalele.
CREATE FUNCTION public.fn_sud_clase_anuleaza(p_sursa bigint, p_versiune integer, p_motiv text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_tronson bigint; v_tp bigint; s public.sud_clase_surse%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT tronson_id INTO v_tronson FROM public.sud_clase_surse WHERE id = p_sursa;
  IF v_tronson IS NULL THEN RAISE EXCEPTION 'sud: sursa claselor inexistenta' USING ERRCODE = '22023'; END IF;
  SELECT proiect_id INTO v_tp FROM public.executie_tronsoane WHERE id = v_tronson FOR UPDATE;
  SELECT * INTO s FROM public.sud_clase_surse WHERE id = p_sursa FOR UPDATE;
  IF public.fn_sud_drept(coalesce(v_tp, s.proiect_id), 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF s.stare = 'anulat' THEN RAISE EXCEPTION 'sud: sursa claselor e deja anulata' USING ERRCODE = '55000'; END IF;
  IF p_versiune IS DISTINCT FROM s.versiune THEN RAISE EXCEPTION 'sud: sursa claselor s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 3 THEN RAISE EXCEPTION 'sud: motivul anularii e obligatoriu' USING ERRCODE = '22023'; END IF;
  UPDATE public.sud_clase_interval SET anulat = true WHERE sursa_id = s.id AND NOT anulat;
  UPDATE public.sud_clase_surse SET stare = 'anulat', anulat_de = auth.uid(), anulat_la = now(), anulat_motiv = btrim(p_motiv), versiune = versiune + 1
   WHERE id = s.id;
END $f$;

-- ─────────── pachetele de la subcontractor (D19, §17) ───────────
-- Marcajul pe un pachet existent: codul și revizia declarate = cele ale pachetului (sub lock), PDF-ul aprobat obligatoriu, Excel-ul obligatoriu sau
-- motivul lipsei (atunci rândurile vin din citirea AI a PDF-ului, cu confirmare umană — PR6). Cheia marcajului = tronson + cod + revizie (R2).
-- Starea „aprobat” a pachetului NU se scrie aici (tabelul pachetelor e în perimetrul porților); ecranul PR6 o ia din marcaj.
-- Ordinea lock-urilor (L06): pachetul FOR UPDATE → (inserare).
CREATE FUNCTION public.fn_sud_subcontr_marcheaza(p_pachet bigint, p_cod_document text, p_revizie integer, p_subcontractor text,
  p_pdf_path text, p_pdf_nume text, p_pdf_sha256 text, p_excel_path text, p_excel_nume text, p_excel_sha256 text, p_excel_lipsa_motiv text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_proiect bigint; v_tronson bigint; v_cod text; v_rev integer; v_cheie text; v_id bigint; v_excel boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT proiect_id, tronson_id, cod_document_full, coalesce(revizie, 0) INTO v_proiect, v_tronson, v_cod, v_rev
    FROM public.executie_pachete_lansare WHERE id = p_pachet FOR UPDATE;
  IF v_proiect IS NULL OR v_tronson IS NULL THEN RAISE EXCEPTION 'sud: pachet inexistent sau fara tronson' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(v_proiect, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  v_cheie := upper(regexp_replace(btrim(coalesce(p_cod_document, '')), '\s+', '', 'g'));
  IF v_cheie = '' OR length(p_cod_document) > 200 OR p_revizie IS NULL OR p_revizie < 0 OR p_revizie > 999 THEN
    RAISE EXCEPTION 'sud: codul documentului / revizia lipsesc sau sunt invalide' USING ERRCODE = '22023';
  END IF;
  IF v_cheie IS DISTINCT FROM upper(regexp_replace(btrim(coalesce(v_cod, '')), '\s+', '', 'g')) OR p_revizie IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'sud: codul / revizia declarate nu sunt ale pachetului' USING ERRCODE = '22023';
  END IF;
  IF length(p_subcontractor) > 200 OR length(p_pdf_nume) > 300 OR length(p_excel_nume) > 300 OR length(p_excel_lipsa_motiv) > 500 THEN
    RAISE EXCEPTION 'sud: subcontractor / nume fisier / motiv prea lungi' USING ERRCODE = '22023';
  END IF;
  IF public.fn_sud_doc_fisier_ok(v_proiect, v_tronson, p_pdf_path) IS NOT TRUE OR p_pdf_sha256 IS NULL OR p_pdf_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sud: PDF-ul aprobat lipseste, nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora' USING ERRCODE = '22023';
  END IF;
  v_excel := p_excel_path IS NOT NULL OR p_excel_sha256 IS NOT NULL OR p_excel_nume IS NOT NULL;
  IF v_excel THEN
    IF public.fn_sud_doc_fisier_ok(v_proiect, v_tronson, p_excel_path) IS NOT TRUE OR p_excel_sha256 IS NULL OR p_excel_sha256 !~ '^[0-9a-f]{64}$'
       OR p_excel_sha256 = p_pdf_sha256 OR p_excel_path = p_pdf_path THEN
      RAISE EXCEPTION 'sud: Excel-ul centralizatorului nu e in arhiva tronsonului, nu e al tau, e mai vechi de o ora sau e acelasi fisier cu PDF-ul'
        USING ERRCODE = '22023';
    END IF;
    IF p_excel_lipsa_motiv IS NOT NULL THEN RAISE EXCEPTION 'sud: motivul lipsei Excel-ului se da doar fara Excel' USING ERRCODE = '22023'; END IF;
  ELSIF length(btrim(coalesce(p_excel_lipsa_motiv, ''))) < 5 THEN
    RAISE EXCEPTION 'sud: Excel-ul centralizatorului e obligatoriu (D19); fara el, motivul lipsei e obligatoriu' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_id FROM public.sud_pachete_subcontractor WHERE tronson_id = v_tronson AND cod_document_cheie = v_cheie AND revizie = p_revizie AND activ LIMIT 1;
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'sud: pachet_deja_marcat:%', v_id USING ERRCODE = '23505'; END IF;
  INSERT INTO public.sud_pachete_subcontractor (proiect_id, tronson_id, pachet_id, cod_document, cod_document_cheie, revizie, subcontractor,
    pdf_path, pdf_nume, pdf_sha256, excel_path, excel_nume, excel_sha256, sursa_randuri, excel_lipsa_motiv, creat_de)
  VALUES (v_proiect, v_tronson, p_pachet, btrim(p_cod_document), v_cheie, p_revizie, nullif(btrim(coalesce(p_subcontractor, '')), ''),
    p_pdf_path, p_pdf_nume, p_pdf_sha256, p_excel_path, p_excel_nume, p_excel_sha256, CASE WHEN v_excel THEN 'excel' ELSE 'ai_pdf' END,
    CASE WHEN v_excel THEN NULL ELSE btrim(p_excel_lipsa_motiv) END, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- Retragerea marcajului (CAS pe versiune, cu motiv); fișierele rămân în arhivă. Un singur rând blocat (L06: marcajul FOR UPDATE).
CREATE FUNCTION public.fn_sud_subcontr_retrage(p_id bigint, p_versiune integer, p_motiv text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE m public.sud_pachete_subcontractor%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sud: neautentificat' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM public.sud_pachete_subcontractor WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sud: marcaj inexistent' USING ERRCODE = '22023'; END IF;
  IF public.fn_sud_drept(m.proiect_id, 'scriere') IS NOT TRUE THEN RAISE EXCEPTION 'sud: doar managerul de proiect' USING ERRCODE = '42501'; END IF;
  IF NOT m.activ THEN RAISE EXCEPTION 'sud: marcajul e deja retras' USING ERRCODE = '55000'; END IF;
  IF p_versiune IS DISTINCT FROM m.versiune THEN RAISE EXCEPTION 'sud: marcajul s-a schimbat intre timp; reincarca' USING ERRCODE = '40001'; END IF;
  IF length(btrim(coalesce(p_motiv, ''))) < 3 THEN RAISE EXCEPTION 'sud: motivul e obligatoriu' USING ERRCODE = '22023'; END IF;
  UPDATE public.sud_pachete_subcontractor SET activ = false, retras_de = auth.uid(), retras_la = now(), retras_motiv = btrim(p_motiv), versiune = versiune + 1
   WHERE id = m.id;
END $f$;

-- ─────────── fotografia exportului INVENTAR (R6, R8) ───────────
-- Corpul 20270115b + DOAR pentru tip = 'inventar': fotografia.coordonate (id-urile pozițiilor active ale tronsonului), fotografia.clase (sursa
-- confirmată {id, versiune} sau null) și fotografia.pachete ([{id, amprenta}] pentru TOATE pachetele tronsonului: elementul aval vine și din pachetul
-- următor, R7). Lipsă / altă formă = 22023; diferență față de starea curentă = 40001 cu numele sursei, nimic scris. Exportul IZO = neschimbat.
-- Ordinea lock-urilor (L06): pachetul FOR UPDATE → deblocarea FOR UPDATE; sursele doar citite (o schimbare după verificare = „export depășit”, R6).
CREATE OR REPLACE FUNCTION public.fn_sud_export_inregistreaza(p_pachet bigint, p_tip text, p_fotografie jsonb, p_deblocare_id bigint, p_fisier_path text)
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
  IF jsonb_typeof(p_fotografie->'amprenta_pachet') IS DISTINCT FROM 'string' OR p_fotografie->>'amprenta_pachet' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'sud: fotografia nu are amprenta pachetului de pe server (reincarca pagina si redeschide fereastra)' USING ERRCODE = '22023';
  END IF;
  IF p_tip = 'inventar' AND (jsonb_typeof(p_fotografie->'coordonate') IS DISTINCT FROM 'array' OR jsonb_typeof(p_fotografie->'pachete') IS DISTINCT FROM 'array'
     OR coalesce(jsonb_typeof(p_fotografie->'clase'), 'lipsa') NOT IN ('null', 'object')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'coordonate') e WHERE jsonb_typeof(e) <> 'number' OR e #>> '{}' !~ '^[0-9]{1,18}$')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fotografie->'pachete') e
                 WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'id') IS DISTINCT FROM 'number' OR e->>'id' !~ '^[0-9]{1,18}$'
                    OR jsonb_typeof(e->'amprenta') IS DISTINCT FROM 'string' OR e->>'amprenta' !~ '^[0-9a-f]{32}$'
                    OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('id', 'amprenta')))
     OR (jsonb_typeof(p_fotografie->'clase') = 'object'
         AND (jsonb_typeof(p_fotografie->'clase'->'id') IS DISTINCT FROM 'number' OR p_fotografie->'clase'->>'id' !~ '^[0-9]{1,18}$'
              OR jsonb_typeof(p_fotografie->'clase'->'versiune') IS DISTINCT FROM 'number' OR p_fotografie->'clase'->>'versiune' !~ '^[0-9]{1,9}$'
              OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_fotografie->'clase') k WHERE k NOT IN ('id', 'versiune'))))) THEN
    RAISE EXCEPTION 'sud: fotografia inventarului e incompleta (coordonate [id], clase {id, versiune} sau null, pachete [{id, amprenta}])' USING ERRCODE = '22023';
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
  -- sursele: aceleași ca acum (mulțimi întregi, cu dublurile numărate) + pachetul și rândurile lui (amprenta serverului)
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
    UNION ALL
    SELECT 'pachet' WHERE public.fn_sud_amprenta_pachet(p_pachet) IS DISTINCT FROM p_fotografie->>'amprenta_pachet'
    -- inventarul: pozițiile active, sursa claselor și pachetele tronsonului, ca mulțimi întregi (doar la tip = 'inventar')
    UNION ALL
    SELECT 'coordonate' WHERE p_tip = 'inventar'
      AND (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p_fotografie->'coordonate') x)
          IS DISTINCT FROM (SELECT coalesce(array_agg(c.id::text ORDER BY c.id::text), '{}') FROM public.sud_coordonate c
                             WHERE c.tronson_id = v_tronson AND c.proiect_id = v_proiect AND c.stare = 'activ')
    UNION ALL
    SELECT 'clase' WHERE p_tip = 'inventar'
      AND p_fotografie->'clase' IS DISTINCT FROM coalesce((SELECT jsonb_build_object('id', s.id, 'versiune', s.versiune) FROM public.sud_clase_surse s
                                                             WHERE s.tronson_id = v_tronson AND s.proiect_id = v_proiect AND s.stare = 'confirmat'), 'null'::jsonb)
    UNION ALL
    SELECT 'pachete' WHERE p_tip = 'inventar'
      AND (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT (e->>'id') || ':' || (e->>'amprenta') AS k FROM jsonb_array_elements(p_fotografie->'pachete') e) fp)
          IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM (SELECT p.id::text || ':' || public.fn_sud_amprenta_pachet(p.id) AS k
                                                                                    FROM public.executie_pachete_lansare p
                                                                                   WHERE p.tronson_id = v_tronson AND p.proiect_id = v_proiect) sp)
  ) z;
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION 'sud: sursele s-au schimbat intre verificare si export (%); reincarca fereastra', v_rau USING ERRCODE = '40001'; END IF;
  IF p_deblocare_id IS NOT NULL THEN UPDATE public.sud_export_deblocari SET folosit_la = now() WHERE id = d.id; END IF;
  INSERT INTO public.sud_exporturi (proiect_id, pachet_id, tip, fotografie, incomplet, deblocare_id, fisier_path, creat_de)
  VALUES (v_proiect, p_pachet, p_tip, p_fotografie, p_deblocare_id IS NOT NULL, p_deblocare_id, p_fisier_path, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- ─────────── drepturi pe obiecte ───────────
ALTER TABLE public.sud_coordonate_incarcari ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_coordonate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_clase_surse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_clase_interval ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sud_pachete_subcontractor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sud_coordonate_incarcari, public.sud_coordonate, public.sud_clase_surse, public.sud_clase_interval, public.sud_pachete_subcontractor
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sud_coordonate_incarcari, public.sud_coordonate, public.sud_clase_surse, public.sud_clase_interval, public.sud_pachete_subcontractor
  TO authenticated, service_role;
-- secvențele de identitate primesc ALL din privilegiile implicite: clienții nu le folosesc (scrierile sunt ale funcțiilor DEFINER)
REVOKE ALL ON SEQUENCE public.sud_coordonate_incarcari_id_seq, public.sud_coordonate_id_seq, public.sud_clase_surse_id_seq, public.sud_clase_interval_id_seq,
  public.sud_pachete_subcontractor_id_seq FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY sud_coordonate_incarcari_citire ON public.sud_coordonate_incarcari FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_coordonate_citire ON public.sud_coordonate FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_clase_surse_citire ON public.sud_clase_surse FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_clase_interval_citire ON public.sud_clase_interval FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));
CREATE POLICY sud_pachete_subcontractor_citire ON public.sud_pachete_subcontractor FOR SELECT TO authenticated
  USING ((SELECT public.fn_sud_drept(proiect_id, 'citire')));

-- ajutătoarele: fără EXECUTE pentru clienți (le cheamă doar funcțiile DEFINER, ca proprietar)
REVOKE ALL ON FUNCTION public.fn_sud_doc_fisier_ok(bigint, bigint, text), public.fn_sud_coord_rand_valid(jsonb), public.fn_sud_clasa_interval_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_sud_coord_incarca(bigint, text, text, text, jsonb, jsonb), public.fn_sud_coord_confirma(bigint, integer, text[]),
  public.fn_sud_coord_anuleaza(bigint, integer, text), public.fn_sud_clase_incarca(bigint, text, text, text, jsonb),
  public.fn_sud_clase_confirma(bigint, integer, jsonb), public.fn_sud_clase_anuleaza(bigint, integer, text),
  public.fn_sud_subcontr_marcheaza(bigint, text, integer, text, text, text, text, text, text, text, text), public.fn_sud_subcontr_retrage(bigint, integer, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sud_coord_incarca(bigint, text, text, text, jsonb, jsonb), public.fn_sud_coord_confirma(bigint, integer, text[]),
  public.fn_sud_coord_anuleaza(bigint, integer, text), public.fn_sud_clase_incarca(bigint, text, text, text, jsonb),
  public.fn_sud_clase_confirma(bigint, integer, jsonb), public.fn_sud_clase_anuleaza(bigint, integer, text),
  public.fn_sud_subcontr_marcheaza(bigint, text, integer, text, text, text, text, text, text, text, text), public.fn_sud_subcontr_retrage(bigint, integer, text)
  TO authenticated;

-- ─────────── Storage: bucket privat izo-sud-doc (tiparul izo-ndt din 20270114a) ───────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('izo-sud-doc', 'izo-sud-doc', false, 52428800, ARRAY['application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']);
CREATE POLICY sud_doc_citire ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'izo-sud-doc' AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
         AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')));
CREATE POLICY sud_doc_incarcare ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'izo-sud-doc' AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$' AND owner_id = (SELECT auth.uid())::text
              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint
                            AND t.proiect_id = split_part(name, '/', 1)::bigint)
              AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'scriere')));
-- ștergerea propriului fișier, doar cât NU e înregistrat (încărcări / surse / marcaje anulate țin fișierul), după 2 h, cu dreptul de CITIRE
-- (verificarea „neînregistrat” citește tabelele sub RLS-ul apelantului, ca la sud_ndt_sterge_orfan)
CREATE POLICY sud_doc_sterge_orfan ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'izo-sud-doc' AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$' AND owner_id = (SELECT auth.uid())::text
         AND created_at < now() - interval '2 hours'
         AND (SELECT public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire'))
         AND NOT EXISTS (SELECT 1 FROM public.sud_coordonate_incarcari i WHERE i.fisier_path = objects.name)
         AND NOT EXISTS (SELECT 1 FROM public.sud_clase_surse s WHERE s.fisier_path = objects.name)
         AND NOT EXISTS (SELECT 1 FROM public.sud_pachete_subcontractor m WHERE m.pdf_path = objects.name OR m.excel_path = objects.name));
CREATE POLICY sud_doc_r_sel ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id IS DISTINCT FROM 'izo-sud-doc' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
         AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')));
CREATE POLICY sud_doc_r_ins ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id IS DISTINCT FROM 'izo-sud-doc' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
              AND owner_id = auth.uid()::text AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'scriere')
              AND EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.id = split_part(name, '/', 2)::bigint
                            AND t.proiect_id = split_part(name, '/', 1)::bigint)));
CREATE POLICY sud_doc_r_upd ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
  USING (bucket_id IS DISTINCT FROM 'izo-sud-doc') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-sud-doc');
CREATE POLICY sud_doc_r_del ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id IS DISTINCT FROM 'izo-sud-doc' OR (auth.uid() IS NOT NULL AND name ~ '^[0-9]{1,18}/[0-9]{1,18}/[^/]+$'
         AND owner_id = auth.uid()::text AND created_at < now() - interval '2 hours'
         AND public.fn_sud_drept(split_part(name, '/', 1)::bigint, 'citire')
         AND NOT EXISTS (SELECT 1 FROM public.sud_coordonate_incarcari i WHERE i.fisier_path = objects.name)
         AND NOT EXISTS (SELECT 1 FROM public.sud_clase_surse s WHERE s.fisier_path = objects.name)
         AND NOT EXISTS (SELECT 1 FROM public.sud_pachete_subcontractor m WHERE m.pdf_path = objects.name OR m.excel_path = objects.name)));
CREATE POLICY sud_doc_r_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id IS DISTINCT FROM 'izo-sud-doc') WITH CHECK (bucket_id IS DISTINCT FROM 'izo-sud-doc');

-- ─────────── postcondiții ───────────
DO $post$
DECLARE v_rau text;
BEGIN
  -- tabelele sud_: RLS activ, nefortat, doar SELECT pentru authenticated / service_role (inclusiv cele 7 din 20270114a / 20270115b)
  SELECT string_agg(c.relname || ':' || coalesce(a.d, '-'), '; ') INTO v_rau
    FROM pg_class c LEFT JOIN LATERAL (
      SELECT string_agg(x.d, ',' ORDER BY x.d) d FROM (
        SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || '=' || e.privilege_type AS d
          FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee <> c.relowner) x) a ON true
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%'
     AND (NOT c.relrowsecurity OR c.relforcerowsecurity OR a.d IS DISTINCT FROM 'authenticated=SELECT,service_role=SELECT');
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270116a post: drepturile tabelelor sud_: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'sud\_%') <> 12 THEN
    RAISE EXCEPTION '20270116a post: numarul tabelelor sud_';
  END IF;
  -- politicile pe tabelele noi: EXACT una pe tabel, permisivă, SELECT, authenticated, cu numele ei
  SELECT string_agg(t.n, ', ' ORDER BY t.n) INTO v_rau
    FROM (VALUES ('sud_coordonate_incarcari'), ('sud_coordonate'), ('sud_clase_surse'), ('sud_clase_interval'), ('sud_pachete_subcontractor')) t(n)
   WHERE (SELECT count(*) FROM pg_policy p WHERE p.polrelid = to_regclass('public.' || t.n)) <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.' || t.n) AND p.polname = t.n || '_citire' AND p.polcmd = 'r'
                       AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]);
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270116a post: politicile tabelelor noi: %', v_rau; END IF;
  -- constrângerea de excludere pe intervalele de clasă (fără suprapuneri pe tronson, R11)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sud_clase_interval'::regclass AND conname = 'sud_clase_interval_fara_suprapuneri'
                   AND contype = 'x') THEN
    RAISE EXCEPTION '20270116a post: constrangerea de excludere a intervalelor de clasa lipseste';
  END IF;
  -- secvențele sud_: exact cele 11 de identitate, fără niciun drept în afara proprietarului
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_rau FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%'
     AND EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) e WHERE e.grantee <> c.relowner);
  IF v_rau IS NOT NULL
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S' AND c.relname LIKE 'sud\_%') <> 11 THEN
    RAISE EXCEPTION '20270116a post: secventele sud_ (numar sau drepturi): %', coalesce(v_rau, 'numar');
  END IF;
  -- funcțiile fn_sud_: 26; INVOKER doar cele pure / ajutătoare; cale sigură; proprietar postgres; fără EXECUTE pentru anon / PUBLIC / service_role;
  -- EXECUTE pentru authenticated pe toate, în afara celor 3 ajutătoare noi (chemate doar din funcțiile DEFINER)
  SELECT string_agg(p.proname, ', ') INTO v_rau FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%'
     AND (p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] OR pg_get_userbyid(p.proowner) <> 'postgres'
          OR p.prosecdef <> (p.proname NOT IN ('fn_sud_cod_normalizeaza', 'fn_sud_tronson_nr', 'fn_sud_citire_valida', 'fn_sud_doc_fisier_ok',
                                                'fn_sud_coord_rand_valid', 'fn_sud_clasa_interval_valid'))
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             <> (p.proname NOT IN ('fn_sud_doc_fisier_ok', 'fn_sud_coord_rand_valid', 'fn_sud_clasa_interval_valid'))
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
                      WHERE e.grantee = 0 OR e.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'service_role'))));
  IF v_rau IS NOT NULL THEN RAISE EXCEPTION '20270116a post: functiile fn_sud_: %', v_rau; END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\_sud\_%') <> 26 THEN
    RAISE EXCEPTION '20270116a post: numarul functiilor fn_sud_';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sud_coord_rand_valid(jsonb)'::regprocedure) <> 'i'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sud_clasa_interval_valid(jsonb)'::regprocedure) <> 'i'
     OR (SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_sud_doc_fisier_ok(bigint, bigint, text)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION '20270116a post: volatilitatea functiilor ajutatoare';
  END IF;
  -- bucket-ul privat + EXACT cele 8 politici sud_doc_ cu comanda, felul (permisivă / RESTRICTIVĂ) și rolurile lor
  SELECT string_agg(coalesce(a.n, p.polname::text), ', ' ORDER BY coalesce(a.n, p.polname::text)) INTO v_rau
    FROM (VALUES ('sud_doc_citire', 'r', true, '{authenticated}'), ('sud_doc_incarcare', 'a', true, '{authenticated}'),
                 ('sud_doc_sterge_orfan', 'd', true, '{authenticated}'), ('sud_doc_r_sel', 'r', false, '{authenticated}'),
                 ('sud_doc_r_ins', 'a', false, '{authenticated}'), ('sud_doc_r_upd', 'w', false, '{public}'),
                 ('sud_doc_r_del', 'd', false, '{authenticated}'), ('sud_doc_r_anon', '*', false, '{anon}')) a(n, cmd, perm, roluri)
    FULL JOIN (SELECT * FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'sud\_doc\_%') p ON p.polname = a.n
   WHERE a.n IS NULL OR p.polname IS NULL OR p.polcmd::text IS DISTINCT FROM a.cmd OR p.polpermissive IS DISTINCT FROM a.perm
      OR (SELECT array_agg(q.rol ORDER BY q.rol) FROM (SELECT CASE r WHEN 0 THEN 'public' ELSE pg_get_userbyid(r)::text END AS rol
                                                          FROM unnest(p.polroles) r) q)
         IS DISTINCT FROM a.roluri::text[];
  IF v_rau IS NOT NULL OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'izo-sud-doc' AND public IS FALSE) THEN
    RAISE EXCEPTION '20270116a post: bucket izo-sud-doc / politicile lui: %', coalesce(v_rau, 'bucket');
  END IF;
  -- validările: cazurile de bază (setul complet e în proba PGlite)
  IF public.fn_sud_coord_rand_valid('{"linie": 1, "cod_raw": "T12S1", "cod": "T12S1", "x": 584123.456, "y": 412345.001, "z": 120.5}') IS NOT NULL
     OR public.fn_sud_coord_rand_valid('{"linie": 1, "cod_raw": "T12S1", "cod": "T12S1", "x": 584123.4567, "y": 412345.001, "z": 120.5}') IS NULL
     OR public.fn_sud_coord_rand_valid('{"linie": 1, "cod_raw": "T12S1", "cod": "T12S1", "x": "584123.456", "y": 412345.001, "z": 120.5}') IS NULL
     OR public.fn_sud_clasa_interval_valid('{"km_de": 0, "km_pana": 1250.5, "clasa": "2"}') IS NOT NULL
     OR public.fn_sud_clasa_interval_valid('{"km_de": 1250.5, "km_pana": 1250.5, "clasa": "2"}') IS NULL
     OR public.fn_sud_clasa_interval_valid('{"km_de": 0, "km_pana": 100, "clasa": " 2a "}') IS NOT NULL
     OR public.fn_sud_clasa_interval_valid('{"km_de": 0, "km_pana": 100, "clasa": "2 A"}') IS NULL THEN
    RAISE EXCEPTION '20270116a post: validarile nu dau rezultatele asteptate';
  END IF;
  -- ștampilele porților Izometrie, CALCULATE după ultima schimbare (docs/izometrie/PORTI_REGULA.md: rândul bucket-ului izo-* și politicile de pe
  -- storage.objects sunt în perimetru; dacă amprentele nu s-au schimbat, ștampilele recalculate ies identice)
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3_definitii() IS %L', 'porti_e3=' || public.fn_izo_porti_e3_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e3b_definitii() IS %L', 'porti_e3b=' || public.fn_izo_porti_e3b_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4_definitii() IS %L', 'porti_e4=' || public.fn_izo_porti_e4_definitii());
  EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_e4b_definitii() IS %L', 'porti_e4b=' || public.fn_izo_porti_e4b_definitii());
  -- IZO POST
  IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '20270116a post: portile Izometrie nu sunt verzi dupa: %', public.fn_izo_porti_lipsa();
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270116a_izometrie_coordonate_clase_subcontr:' || txid_current() THEN
    RAISE EXCEPTION '20270116a: garda final invalida';
  END IF;
  RAISE NOTICE '20270116a: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $post$;
