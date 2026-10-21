-- 20261103d_tichete_notif_creator — notificare către CREATORUL tichetului la rezolvare / închidere directă / respingere, în toate departamentele
-- (Razvan 21.10.2026, în chat: „C și în închiderea de ticket” — după TKT-0339/0340, unde creatoarea n-a primit nimic la rezolvare).
-- De ce: fn_tichete_notif_on_status_change anunța creatorul doar în fluxul Logistică; fan-out-ul către echipă îl exclude explicit
-- pe creator, deci la IT / HR / comercial cine deschide tichetul nu afla că s-a rezolvat.
-- Schimbare: un singur bloc nou înaintea RETURN NEW (marcaj notif_creator_v1); restul funcției NESCHIMBAT, caractere identice.
--   rezolvat → creatorul primește descrierea intervenției (primele 300 de caractere) sau titlul;
--   inchis direct (fără rezolvat / reparat / confirmat înainte) → idem;
--   respins în afara Logisticii (Logistica își are deja mesajul) → motivul.
--   Fără notificare dacă schimbarea o face chiar creatorul (auth.uid()); NULL (psql / job) → se notifică.
-- Precondiție: md5(pg_get_functiondef) = 3ac7cbf6973b5f89e56de26884d47509 (live 21.10); postcondiție: 4adb48a37ff5834e7b95836daf3483cb.
-- Revenire: supabase/revenire/20261103d_tichete_notif_creator_ROLLBACK.sql. LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261103d_tichete_notif_creator:' || txid_current() THEN
    RAISE EXCEPTION '20261103d: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261103d: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_tichete_notif_on_status_change()') IS NULL
     OR md5(pg_get_functiondef('public.fn_tichete_notif_on_status_change()'::regprocedure)) IS DISTINCT FROM '3ac7cbf6973b5f89e56de26884d47509' THEN
    RAISE EXCEPTION '20261103d: fn_tichete_notif_on_status_change nu e versiunea asteptata';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tichete' AND column_name = 'descriere_interventie')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tichete' AND column_name = 'motiv_respingere') THEN
    RAISE EXCEPTION '20261103d: lipsesc coloanele tichete.descriere_interventie / motiv_respingere';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_tichete_notif_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_creator UUID := OLD.deschis_de;
  v_titlu TEXT := LEFT(NEW.titlu, 80);
  v_entitate TEXT := COALESCE(NEW.entitate_descriere, '');
  v_link TEXT := '/tichete?id=' || NEW.id;
  v_partener TEXT;
BEGIN
  -- Skip dacă nu s-a schimbat status
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- ── Mesaje specifice creator pentru workflow LOGISTICA ──────────────────────
  IF NEW.departament = 'logistica' THEN
    -- Identific service partener dacă există
    IF NEW.service_partener_id IS NOT NULL THEN
      SELECT nume INTO v_partener FROM public.logistica_service_parteneri WHERE id = NEW.service_partener_id;
    END IF;

    IF NEW.status = 'in_analiza' AND v_creator IS NOT NULL THEN
      INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_creator, 'info', 'Tichete',
        '🔍 Tichet ' || NEW.numar_tichet || ' — în analiză',
        'Departamentul Logistică a început analiza pentru: ' || v_titlu, v_link);
    END IF;

    IF NEW.status = 'programat_service' AND v_creator IS NOT NULL THEN
      INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_creator, 'info', 'Tichete',
        '📅 Tichet ' || NEW.numar_tichet || ' — programat la service',
        'Programare ' || COALESCE(TO_CHAR(NEW.data_programare_service, 'DD.MM.YYYY'), 'TBD')
          || ' la ' || COALESCE(v_partener, NEW.firma_externa, 'service nedefinit'), v_link);
    END IF;

    IF NEW.status = 'in_service' AND v_creator IS NOT NULL THEN
      INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_creator, 'info', 'Tichete',
        '🔧 Tichet ' || NEW.numar_tichet || ' — intrat în service',
        'La ' || COALESCE(v_partener, NEW.firma_externa, 'service')
          || COALESCE(' · estimat ' || TO_CHAR(NEW.data_estimata_reparatie, 'DD.MM.YYYY'), ''), v_link);
    END IF;

    IF NEW.status = 'reparat' AND v_creator IS NOT NULL THEN
      INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to, action_taken)
      VALUES (v_creator, 'success', 'Tichete',
        '✅ Tichet ' || NEW.numar_tichet || ' — REPARAT, confirmă închiderea',
        v_entitate || ' a fost reparat. Click pentru a confirma închiderea.', v_link, false);
    END IF;

    IF NEW.status = 'respins' AND v_creator IS NOT NULL THEN
      INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_creator, 'warning', 'Tichete',
        '❌ Tichet ' || NEW.numar_tichet || ' — respins',
        COALESCE('Motiv: ' || NEW.motiv_respingere, 'Tichetul a fost respins'), v_link);
    END IF;
  END IF;

  -- ── Fan-out către ECHIPA AD-HOC (toate departamentele) ──────────────────────
  -- Membrii asignați (din tichete_asignati) primesc notificare la tranzițiile cheie.
  -- Dedup: NU dubla creatorul (deja notificat mai sus pe logistica).
  IF NEW.status IN ('reparat', 'respins', 'rezolvat', 'inchis', 'confirmat') THEN
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    SELECT ta.profile_id,
      CASE WHEN NEW.status = 'respins' THEN 'warning'
           WHEN NEW.status IN ('reparat','rezolvat') THEN 'success'
           ELSE 'info' END,
      'Tichete',
      '🎫 Tichet ' || NEW.numar_tichet || ' — ' || NEW.status,
      v_titlu, v_link
    FROM public.tichete_asignati ta
    WHERE ta.tichet_id = NEW.id
      AND ta.profile_id <> COALESCE(v_creator, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;


  -- ── Creatorul tichetului (toate departamentele) — 21.10.2026, cerere Razvan [notif_creator_v1] ─────────
  -- Până acum creatorul era anunțat doar în fluxul Logistică (în analiză / service / reparat / respins); la IT, HR etc.
  -- rezolvarea sau închiderea directă nu îi ajungea. Nu se notifică dacă schimbarea o face chiar creatorul (auth.uid()).
  IF v_creator IS NOT NULL
     AND v_creator IS DISTINCT FROM auth.uid()
     AND (NEW.status = 'rezolvat'
          OR (NEW.status = 'inchis' AND OLD.status NOT IN ('rezolvat', 'reparat', 'confirmat'))
          OR (NEW.status = 'respins' AND NEW.departament IS DISTINCT FROM 'logistica')) THEN
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    VALUES (v_creator,
      CASE WHEN NEW.status = 'respins' THEN 'warning' ELSE 'success' END,
      'Tichete',
      '🎫 Tichetul tău ' || NEW.numar_tichet || ' — ' || CASE NEW.status WHEN 'rezolvat' THEN 'rezolvat' WHEN 'inchis' THEN 'închis' ELSE 'respins' END,
      CASE WHEN NEW.status = 'respins' THEN COALESCE('Motiv: ' || NEW.motiv_respingere, v_titlu)
           ELSE COALESCE(LEFT(NULLIF(btrim(NEW.descriere_interventie), ''), 300), v_titlu) END,
      v_link);
  END IF;
  RETURN NEW;
END;
$function$;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.fn_tichete_notif_on_status_change()'::regprocedure)) IS DISTINCT FROM '4adb48a37ff5834e7b95836daf3483cb' THEN
    RAISE EXCEPTION '20261103d: postconditie md5 esuata';
  END IF;
  -- trigger-ul există, e activ și cheamă exact această funcție (review Jakarinos P2; tichete.status e NOT NULL, deci OLD.status nu e NULL)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tichete_notif_status' AND tgrelid = 'public.tichete'::regclass
                 AND NOT tgisinternal AND tgenabled <> 'D'
                 AND tgfoid = 'public.fn_tichete_notif_on_status_change()'::regprocedure) THEN
    RAISE EXCEPTION '20261103d: trigger-ul trg_tichete_notif_status lipseste, e dezactivat sau nu cheama functia';
  END IF;
END $post$;
