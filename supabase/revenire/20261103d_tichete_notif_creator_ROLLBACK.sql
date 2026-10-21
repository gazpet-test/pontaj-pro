-- Revenire 20261103d_tichete_notif_creator: readuce fn_tichete_notif_on_status_change exact la versiunea de dinainte (md5 3ac7cbf6973b5f89e56de26884d47509).
-- Armată: rulează doar cu set_config('gazpet.revenire_20261103d', 'TICHETE_NOTIF_CREATOR_SCOATE:' || txid_current(), true).
DO $pre$
BEGIN
  IF current_setting('gazpet.revenire_20261103d', true) IS DISTINCT FROM 'TICHETE_NOTIF_CREATOR_SCOATE:' || txid_current() THEN
    RAISE EXCEPTION 'revenire 20261103d: garda start invalida';
  END IF;
  IF md5(pg_get_functiondef('public.fn_tichete_notif_on_status_change()'::regprocedure)) IS DISTINCT FROM '4adb48a37ff5834e7b95836daf3483cb' THEN
    RAISE EXCEPTION 'revenire 20261103d: functia nu e versiunea 20261103d';
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

  RETURN NEW;
END;
$function$;

DO $post$
BEGIN
  IF md5(pg_get_functiondef('public.fn_tichete_notif_on_status_change()'::regprocedure)) IS DISTINCT FROM '3ac7cbf6973b5f89e56de26884d47509' THEN
    RAISE EXCEPTION 'revenire 20261103d: postconditie md5 esuata';
  END IF;
END $post$;
