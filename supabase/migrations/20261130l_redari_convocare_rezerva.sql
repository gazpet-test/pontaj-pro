-- Version 20261130140000. Runner supplies one transaction.
-- 20261130l_redari_convocare_rezerva — Redări: rezervarea ATOMICĂ a unei convocări poștale (număr C + rând red_convocari) pentru generarea în masă.
-- Cerința: PR #989 (L1, convocatoare în masă pe UAT), review Jakarinos NO-GO P1-1: două taburi / doi utilizatori care pregătesc același deținător
-- ca „nou” rezervă fiecare un număr și inserează câte o convocare (dublură; UNIQUE(nr_document) nu ajută, numerele diferă).
-- Ce face: O SINGURĂ funcție nouă, fn_red_convocare_rezerva(p_detinator_id uuid, p_numar_nou_confirmat boolean DEFAULT false)
--   RETURNS TABLE (convocare_id uuid, nr_document text), SECURITY DEFINER, VOLATILE, search_path fix. Fără tabele, vederi, politici, triggere noi.
--   1. Acces: refuz 42501 dacă fn_red_nivel() nu e 'admin' / 'editor' (aceeași regulă ca fn_red_numar_document și politica red_convocari_ins).
--   2. Parametri NULL → 22023 (folosit și de client ca probă fără efecte: „funcția există?”). Doar READ COMMITTED (25001), ca verificarea de după
--      lock să vadă rândurile comise de tranzacția concurentă.
--   3. Deținătorul activ (sters_la NULL), pe o parcelă activă → proiect, uat3, tronson; altfel P0002.
--   4. pg_advisory_xact_lock pe cheia ('red_convocare_posta', proiect, deținător) — serializează două rezervări pentru același deținător.
--   5. Sub lock: dacă există o convocare poștală activă, neexpediată, neștearsă logic, și nu s-a cerut explicit p_numar_nou_confirmat → RD001
--      (mesajul conține numerele existente); niciun număr consumat.
--   6. fn_red_plic_garda_persoana(deținător): aceeași gardă pe care trg_red_convocari_posta_garda o rulează la INSERT pentru utilizatori — trigger-ul
--      o sare când current_user = 'postgres', iar funcția aceasta rulează ca owner (postgres), deci o apelăm explicit, ÎNAINTE de număr.
--   7. Numărul prin fn_red_numar_document('C', uat3, tronson) (calea existentă, aceeași serie globală 'C'), apoi INSERT red_convocari
--      (detinator_id, canal 'posta', nr_document); created_by = DEFAULT auth.uid() (utilizatorul din JWT), trg_red_legaturi / trg_red_jurnal rulează.
--      Calea, hash-ul și fișierul le pune apoi clientul prin reincarcaConvocator (UPDATE pe rând, RLS-ul existent).
--   Ce NU face: nu marchează expediat, nu trimite nimic; calea individuală (ModalConvocator: fn_red_numar_document + INSERT direct) NU e schimbată
--   în această migrare și NU ia lock-ul — protecția acoperă generarea în masă (client src/redari/convocatoareMasa.js).
-- Identitate: SECURITY DEFINER (owner postgres) e necesar pentru că lock-ul + verificarea + rezervarea + INSERT-ul trebuie să fie în ACEEAȘI
--   tranzacție, iar red_numere nu are drept de scriere pentru authenticated (doar prin fn_red_numar_document). Poarta de rol e în corp (pct. 1).
-- Revenire: supabase/revenire/20261130l_redari_convocare_rezerva_ROLLBACK.sql (DROP FUNCTION; convocările create rămân convocări obișnuite).
-- DRY producție (doar citiri, fără rezervare): supabase/tests/20261130l_redari_convocare_rezerva_dryrun.sql.
-- DRY local PG17 (cu concurență prin dblink): supabase/tests/20261130l_redari_convocare_rezerva_schelet.sql + _dryrun_local.sql,
--   runner scripts/redari_30l_dry_local.sh.
-- NEAPLICATĂ: se aplică doar după GO Jakarinos + Copilot și DRY verde (regula 01.11); clientul are fallback la calea veche până atunci.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261130l_redari_convocare_rezerva:' || txid_current() THEN
    RAISE EXCEPTION '20261130l: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.red_convocari') IS NULL OR to_regclass('public.red_detinatori') IS NULL OR to_regclass('public.red_parcele') IS NULL
     OR to_regclass('public.red_uat') IS NULL OR to_regclass('public.red_numere') IS NULL
     OR to_regprocedure('public.fn_red_nivel()') IS NULL OR to_regprocedure('public.fn_red_numar_document(text,text,integer)') IS NULL
     OR to_regprocedure('public.fn_red_plic_garda_persoana(uuid)') IS NULL THEN
    RAISE EXCEPTION '20261130l: lipseste schema Redari (red_convocari, red_detinatori, red_parcele, red_uat, red_numere, fn_red_nivel, fn_red_numar_document, fn_red_plic_garda_persoana)';
  END IF;
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean)') IS NOT NULL THEN RAISE EXCEPTION '20261130l: functia exista deja'; END IF;
  -- coloanele citite / scrise (baseline citit read-only pe live 04.11.2026)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari'
        AND column_name IN ('id', 'detinator_id', 'canal', 'nr_document', 'data_expediere', 'stare', 'sters_la', 'created_by', 'created_at', 'plic_id')) <> 10
     OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari' AND column_name = 'created_by') IS DISTINCT FROM 'auth.uid()'
     OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_convocari' AND column_name = 'stare') IS DISTINCT FROM '''activ''::text'
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_detinatori' AND column_name IN ('id', 'parcela_id', 'sters_la')) <> 3
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_parcele' AND column_name IN ('id', 'proiect_id', 'uat_id', 'tronson', 'sters_la')) <> 5
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'red_uat' AND column_name IN ('id', 'uat3')) <> 2 THEN
    RAISE EXCEPTION '20261130l: coloanele Redari au alta forma';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_canal_check')
       IS DISTINCT FROM 'CHECK ((canal = ANY (ARRAY[''posta''::text, ''sms''::text, ''email''::text, ''afisare''::text, ''telefon''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.red_convocari'::regclass AND conname = 'red_convocari_stare_check')
       IS DISTINCT FROM 'CHECK ((stare = ANY (ARRAY[''activ''::text, ''anulat''::text])))' THEN
    RAISE EXCEPTION '20261130l: CHECK-urile canal / stare pe red_convocari nu mai sunt cele revizuite';
  END IF;
  -- L15: amprentele apelaților (direcți și tranzitivi pana la nivelul 3), baseline citit read-only pe live 04.11.2026.
  -- nivel 1: fn_red_nivel, fn_red_numar_document, fn_red_plic_garda_persoana; triggerele red_convocari / red_numere (fn_red_convocari_posta_garda,
  -- fn_red_legaturi, fn_red_jurnal); nivel 2: auth.uid(), fn_red_plic_incearca_lock_detinator, fn_red_cheie_persoana.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'public.fn_red_nivel()'::regprocedure AND g.lanname = 'sql' AND p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                    AND p.prorettype = 'text'::regtype AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND md5(p.prosrc) = '21db8e5d4b69b7f19e571a7087c361ae')
     OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_red_nivel()'::regprocedure)
       IS DISTINCT FROM ARRAY['authenticated=X/postgres', 'postgres=X/postgres', 'service_role=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130l: fn_red_nivel() nu mai are amprenta revizuita';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure AND g.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND p.prorettype = 'text'::regtype AND NOT p.proretset AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND md5(p.prosrc) = 'b943c0eca339b7d6a03970f0a1f8323e')
     OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure)
       IS DISTINCT FROM ARRAY['authenticated=X/postgres', 'postgres=X/postgres', 'service_role=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130l: fn_red_numar_document nu mai are amprenta revizuita';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'public.fn_red_plic_garda_persoana(uuid)'::regprocedure AND g.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
                    AND p.prorettype = 'void'::regtype AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
                    AND pg_get_userbyid(p.proowner) = 'postgres' AND md5(p.prosrc) = '4c1f0bb4757c68630989e5e464b7682f') THEN
    RAISE EXCEPTION '20261130l: fn_red_plic_garda_persoana nu mai are amprenta revizuita';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_convocari_posta_garda()'::regprocedure) IS DISTINCT FROM '27f9e3fd61880e97cb43fc7599536ed3'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_legaturi()'::regprocedure) IS DISTINCT FROM 'd1912ec6514cba162babea3bcebdfb24'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_jurnal()'::regprocedure) IS DISTINCT FROM '27479409c823996f436459089945c789'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_plic_incearca_lock_detinator(uuid)'::regprocedure) IS DISTINCT FROM 'c7b8cff21c1999435246f84e085b7aea'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_cheie_persoana(uuid)'::regprocedure) IS DISTINCT FROM '2d2a98bf9d8747668718c5a7eb6404e7' THEN
    RAISE EXCEPTION '20261130l: functiile de trigger / garda plic nu mai au corpul revizuit (posta_garda / legaturi / jurnal / plic_incearca_lock_detinator / cheie_persoana)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language g ON g.oid = p.prolang
                  WHERE p.oid = 'auth.uid()'::regprocedure AND g.lanname = 'sql' AND NOT p.prosecdef AND p.provolatile = 's' AND p.pronargs = 0
                    AND p.prorettype = 'uuid'::regtype AND p.proconfig IS NULL AND pg_get_userbyid(p.proowner) = 'supabase_auth_admin'
                    AND md5(p.prosrc) = 'cdef18c69c4f4cbbced2eaf81e628b49') THEN
    RAISE EXCEPTION '20261130l: auth.uid() nu mai are amprenta revizuita';
  END IF;
  -- triggerele exacte (nume = functie / enabled / tip) pe red_convocari si red_numere
  IF (SELECT string_agg(tgname::text || '=' || tgfoid::regprocedure::text || '/' || tgenabled::text || '/' || tgtype::text, ',' ORDER BY tgname)
        FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND NOT tgisinternal)
       IS DISTINCT FROM 'trg_red_convocari_posta_garda=fn_red_convocari_posta_garda()/O/23,trg_red_jurnal=fn_red_jurnal()/O/29,trg_red_legaturi=fn_red_legaturi()/O/23'
     OR (SELECT string_agg(tgname::text || '=' || tgfoid::regprocedure::text || '/' || tgenabled::text || '/' || tgtype::text, ',' ORDER BY tgname)
        FROM pg_trigger WHERE tgrelid = 'public.red_numere'::regclass AND NOT tgisinternal) IS DISTINCT FROM 'trg_red_jurnal=fn_red_jurnal()/O/29' THEN
    RAISE EXCEPTION '20261130l: triggerele pe red_convocari / red_numere nu sunt cele revizuite';
  END IF;
  -- functia scrie ca owner (postgres) peste RLS: owner-ul tabelelor = postgres, fara FORCE RLS
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.red_convocari'::regclass, 'public.red_detinatori'::regclass, 'public.red_parcele'::regclass,
                                                  'public.red_uat'::regclass, 'public.red_numere'::regclass)
              AND (relforcerowsecurity OR pg_get_userbyid(relowner) <> 'postgres')) THEN
    RAISE EXCEPTION '20261130l: owner / FORCE RLS neasteptat pe tabelele atinse';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_red_convocare_rezerva(p_detinator_id uuid, p_numar_nou_confirmat boolean DEFAULT false)
RETURNS TABLE (convocare_id uuid, nr_document text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_proiect uuid; v_uat3 text; v_tronson integer; v_existente text; v_nr text; v_id uuid;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de rezervare a convocarii' USING ERRCODE = '42501';
  END IF;
  IF p_detinator_id IS NULL OR p_numar_nou_confirmat IS NULL THEN RAISE EXCEPTION 'redari: parametri lipsa' USING ERRCODE = '22023'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'redari: rezervarea convocarii doar in READ COMMITTED' USING ERRCODE = '25001';
  END IF;
  SELECT p.proiect_id, u.uat3, p.tronson INTO v_proiect, v_uat3, v_tronson
    FROM public.red_detinatori d JOIN public.red_parcele p ON p.id = d.parcela_id JOIN public.red_uat u ON u.id = p.uat_id
   WHERE d.id = p_detinator_id AND d.sters_la IS NULL AND p.sters_la IS NULL;
  IF v_proiect IS NULL THEN RAISE EXCEPTION 'redari: detinator inexistent sau sters' USING ERRCODE = 'P0002'; END IF;
  -- serializare pe (proiect, detinator); lock-ul tine pana la sfarsitul tranzactiei (dupa INSERT)
  PERFORM pg_advisory_xact_lock(hashtextextended('red_convocare_posta:' || v_proiect::text || ':' || p_detinator_id::text, 0));
  -- READ COMMITTED: instructiunea de dupa lock vede convocarea comisa de tranzactia care a tinut lock-ul inainte
  SELECT string_agg(c.nr_document, ', ' ORDER BY c.created_at, c.id) INTO v_existente
    FROM public.red_convocari c
   WHERE c.detinator_id = p_detinator_id AND c.canal = 'posta' AND c.stare = 'activ' AND c.data_expediere IS NULL AND c.sters_la IS NULL;
  IF v_existente IS NOT NULL AND NOT p_numar_nou_confirmat THEN
    RAISE EXCEPTION 'redari: detinatorul are deja convocare postala neexpediata (%)', v_existente USING ERRCODE = 'RD001';
  END IF;
  -- garda plic pe persoana (trigger-ul o sare pentru owner) — inainte de numar, ca un refuz sa nu consume numere
  PERFORM public.fn_red_plic_garda_persoana(p_detinator_id);
  v_nr := public.fn_red_numar_document('C', v_uat3, v_tronson);
  INSERT INTO public.red_convocari (detinator_id, canal, nr_document) VALUES (p_detinator_id, 'posta', v_nr) RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_nr;
END $fn$;
COMMENT ON FUNCTION public.fn_red_convocare_rezerva(uuid, boolean) IS 'Redări: rezervare atomică (lock pe proiect + deținător, fără convocare poștală activă neexpediată, '
  'gardă plic, număr C prin fn_red_numar_document, INSERT red_convocari). RD001 = există deja convocare neexpediată. Doar admin/editor. Antet: migrarea 20261130l.';
REVOKE ALL ON FUNCTION public.fn_red_convocare_rezerva(uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_red_convocare_rezerva(uuid, boolean) TO authenticated;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_convocare_rezerva(uuid,boolean)'::regprocedure AND prosecdef AND provolatile = 'v'
                  AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres') THEN
    RAISE EXCEPTION '20261130l: functia are setari gresite (DEFINER / VOLATILE / search_path / owner)';
  END IF;
  IF (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_red_convocare_rezerva(uuid,boolean)'::regprocedure)
       IS DISTINCT FROM ARRAY['authenticated=X/postgres', 'postgres=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130l: privilegii gresite pe fn_red_convocare_rezerva (doar authenticated + owner)';
  END IF;
  IF (SELECT array_agg(n ORDER BY o) FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, md, o)
       WHERE p.oid = 'public.fn_red_convocare_rezerva(uuid,boolean)'::regprocedure AND a.md = 't')
     IS DISTINCT FROM ARRAY['convocare_id', 'nr_document']::text[] THEN
    RAISE EXCEPTION '20261130l: coloanele de iesire nu sunt cele asteptate';
  END IF;
END $post$;
