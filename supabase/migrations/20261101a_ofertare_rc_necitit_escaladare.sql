-- (a) Escaladare zilnică „răspuns de la autoritate necitit” (Răzvan 19.10.2026: „da d-a-b”, varianta A).
-- De ce: RC3 Racari (lic. 15, 204 pagini, listele de cantități revizuite) a fost adus de veghea SEAP pe 14.10 și a stat 5 zile
-- neprocesat; clopoțelul „SEAP: RASPUNS…” s-a pierdut între 102 notificări SEAP în 30 de zile (1 citită).
--
-- Regula „necitit” — O SINGURĂ definiție, ofertare_rc_doc_necitit(document), folosită și de selecția zilnică, și de revalidarea din
-- edge fn înainte de mail (review Copilot r3, P1: două definiții puteau diverge):
--   document tip 'raspuns_clarificare' cu status_procesare NU în {procesat, ignorat, partial} — deci neprocesat, in_lucru, eroare, NULL
--   sau orice stare nouă (fail-closed, review Gemini #790 r1) — ȘI fără proveniența 'ocr_local_neverificat' pe sha-ul CURENT al textului
--   (Răzvan „X”, 19.10; laboratorul OCR, PR #795): textul importat de laborator = citit, chiar dacă statusul nu a trecut pe procesat.
--   licitații: status ∈ {go, in_lucru}, termen de depunere în viitor.
-- Cine: ziua 0 (ziua sosirii) doar bannerul — EXCEPȚIE urgența (≤ 1 zi până la depunere: alertă din ziua 0, review Gemini r1, P1);
--   ziua 1: responsabilul; ziua 2+: + owner(ii); owner(ii) și oricând cu ≤ 2 zile până la depunere sau fără responsabil.
--   Notificare 'critical', o dată pe zi și set de documente; se oprește singură la procesare.
-- Idempotență (review Copilot r1–r3): REVENDICARE ATOMICĂ a amprentei (INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING; amprenta =
--   ziua + documentele necitite). Mailul (doar owner, ≤ 5 zile până la depunere) are DOUĂ stări: '<amprenta>:p' (în curs) și
--   '<amprenta>:s' (trimis, confirmat după răspunsul Resend). O revendicare „în curs” mai veche de 10 minute se poate RE-revendica
--   (rezultat ambiguu la trimitere — excepție de transport / 5xx — reîncercat la rularea următoare, deduplicat de Resend prin
--   Idempotency-Key); una „trimis” nu. Refuzul explicit (4xx) / documentele procesate între timp ELIBEREAZĂ revendicarea.
--
-- Cron (după apply + deploy, cu „da” de la Răzvan) — 3 rulări pe zi, ca o trimitere ambiguă să poată fi reîncercată în aceeași zi
-- (notificările rămân o dată pe zi, prin amprentă):
--   SELECT cron.schedule('ofertare_rc_necitit', '30 5,8,11 * * *', $$SELECT net.http_post(
--     url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ofertare-rc-necitit',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-radar-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='RADAR_SECRET')),
--     body := '{}'::jsonb)$$);
--
-- Obiecte NOI (cinci funcții); nu schimbă tabele, date existente sau alte funcții. Scrie (la rulare) doar în notifications și
-- ofertare_alerte_amprenta (fel 'rc_necitit' / 'rc_necitit_mail').
-- Revenire: supabase/revenire/20261101a_ofertare_rc_necitit_escaladare_ROLLBACK.sql (armată; doar la cererea lui Răzvan).
-- LIVRARE: doar prin scripts/livrare_migrare.sh; fără BEGIN/COMMIT.
DO $pre$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261101a_ofertare_rc_necitit_escaladare:' || txid_current() THEN
    RAISE EXCEPTION '20261101a: garda start invalida';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION '20261101a: necesita postgres'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.ofertare_rc_doc_necitit(bigint)') IS NOT NULL
     OR to_regprocedure('public.ofertare_alerta_rc_necitit()') IS NOT NULL
     OR to_regprocedure('public.ofertare_alerta_rc_necitite_acum(bigint[])') IS NOT NULL
     OR to_regprocedure('public.ofertare_alerta_rc_mail_elibereaza(bigint,text)') IS NOT NULL
     OR to_regprocedure('public.ofertare_alerta_rc_mail_confirma(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION '20261101a: functiile exista deja';
  END IF;
  IF to_regclass('public.ofertare_alerte_amprenta') IS NULL OR to_regclass('public.notifications') IS NULL
     OR to_regclass('public.ofertare_doc_texte_prov') IS NULL OR to_regclass('public.ofertare_documente_atribuire') IS NULL THEN
    RAISE EXCEPTION '20261101a: dependinte lipsa';
  END IF;
  -- revendicarea atomică cere cheia (licitatie_id, fel) din 20260915
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.ofertare_alerte_amprenta'::regclass AND i.indisunique
                 AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                      WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)) = ARRAY['fel', 'licitatie_id']) THEN
    RAISE EXCEPTION '20261101a: ofertare_alerte_amprenta fara cheie unica (licitatie_id, fel)';
  END IF;
END $pre$;

-- definiția UNICĂ a „necitit” (folosită de selecția zilnică și de revalidarea dinaintea mailului)
CREATE OR REPLACE FUNCTION public.ofertare_rc_doc_necitit(p_document_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM ofertare_documente_atribuire d
    WHERE d.id = p_document_id
      AND d.tip = 'raspuns_clarificare'
      AND coalesce(d.status_procesare, 'neprocesat') NOT IN ('procesat', 'ignorat', 'partial')
      AND NOT EXISTS (SELECT 1 FROM ofertare_doc_texte_prov p
                      WHERE p.document_id = d.id AND p.origine = 'ocr_local_neverificat'
                        AND p.sha256 = encode(sha256(convert_to(coalesce(d.text_extras, ''), 'UTF8')), 'hex')))
$function$;

CREATE OR REPLACE FUNCTION public.ofertare_alerta_rc_necitit()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record; v_pid uuid; v_amprenta text; v_ampr_mail text; v_claim int; v_mail boolean;
  v_azi date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
  v_zile_necitit int; v_zile_dep int; v_trimise int := 0; v_lic jsonb := '[]'::jsonb;
BEGIN
  FOR l IN
    SELECT li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id,
           count(*) AS nr,
           min((d.created_at AT TIME ZONE 'Europe/Bucharest')::date) AS de_la,
           string_agg(d.id::text, ',' ORDER BY d.id) AS ids,
           string_agg(left(coalesce(d.nume_original, '#' || d.id), 60), '; ' ORDER BY d.created_at) AS lista
    FROM ofertare_licitatii li
    JOIN ofertare_documente_atribuire d ON d.licitatie_id = li.id
    WHERE d.tip = 'raspuns_clarificare'
      AND public.ofertare_rc_doc_necitit(d.id)
      AND li.status IN ('go', 'in_lucru')
      AND li.termen_depunere > now()
    GROUP BY li.id, li.nr_anunt, li.obiect, li.termen_depunere, li.responsabil_id
  LOOP
    v_zile_necitit := v_azi - l.de_la;
    v_zile_dep := (l.termen_depunere AT TIME ZONE 'Europe/Bucharest')::date - v_azi;
    -- ziua sosirii: doar bannerul — dar nu când depunerea e azi / mâine (urgență)
    CONTINUE WHEN v_zile_necitit < 1 AND v_zile_dep > 1;

    -- notificările: revendicare atomică pe (zi, documentele necitite)
    v_amprenta := md5(l.id::text || '|rc_necitit|' || v_azi::text || '|' || l.ids);
    v_claim := NULL;
    INSERT INTO ofertare_alerte_amprenta AS a (licitatie_id, fel, amprenta, trimisa_la)
    VALUES (l.id, 'rc_necitit', v_amprenta, now())
    ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now()
      WHERE a.amprenta IS DISTINCT FROM EXCLUDED.amprenta
    RETURNING 1 INTO v_claim;
    IF v_claim IS NOT NULL THEN
      FOR v_pid IN
        SELECT p FROM unnest(ARRAY[l.responsabil_id]) p WHERE p IS NOT NULL
        UNION
        SELECT id FROM profiles WHERE is_owner = true AND (v_zile_necitit >= 2 OR v_zile_dep <= 2 OR l.responsabil_id IS NULL)
      LOOP
        INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
        VALUES (v_pid, 'critical', 'Ofertare',
          format('⚠ RC necitit — %s — %s', coalesce(l.nr_anunt, 'licitația ' || l.id),
                 CASE WHEN v_zile_dep = 0 THEN 'depunerea e AZI' WHEN v_zile_dep = 1 THEN '1 zi până la depunere'
                      ELSE v_zile_dep || ' zile până la depunere' END),
          format('Răspuns de la autoritate necitit %s (din %s): %s. Deschide fișa licitației → Documentație → Procesează. Alerta se repetă zilnic până la procesare.',
                 CASE WHEN v_zile_necitit = 0 THEN 'de azi' WHEN v_zile_necitit = 1 THEN 'de 1 zi' ELSE 'de ' || v_zile_necitit || ' zile' END,
                 to_char(l.de_la, 'DD.MM'), l.lista),
          '/ofertare');
        v_trimise := v_trimise + 1;
      END LOOP;
    END IF;

    -- mailul (doar owner, ≤ 5 zile până la depunere): revendicare atomică „în curs” (':p'); se poate RE-revendica doar o revendicare
    -- „în curs” mai veche de 10 minute (rezultat ambiguu); „trimis” (':s') nu se mai revendică pe aceeași amprentă
    v_mail := false; v_ampr_mail := NULL;
    IF v_zile_dep <= 5 THEN
      v_ampr_mail := md5(l.id::text || '|rc_necitit_mail|' || v_azi::text || '|' || l.ids);
      v_claim := NULL;
      INSERT INTO ofertare_alerte_amprenta AS a (licitatie_id, fel, amprenta, trimisa_la)
      VALUES (l.id, 'rc_necitit_mail', v_ampr_mail || ':p', now())
      ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now()
        WHERE split_part(a.amprenta, ':', 1) IS DISTINCT FROM v_ampr_mail
           OR (a.amprenta = v_ampr_mail || ':p' AND a.trimisa_la < now() - interval '10 minutes')
      RETURNING 1 INTO v_claim;
      v_mail := v_claim IS NOT NULL;
    END IF;

    v_lic := v_lic || jsonb_build_object('licitatie_id', l.id, 'nr_anunt', l.nr_anunt, 'obiect', left(coalesce(l.obiect, ''), 160),
      'zile_necitit', v_zile_necitit, 'zile_depunere', v_zile_dep, 'de_la', l.de_la, 'nr', l.nr, 'lista', l.lista,
      'doc_ids', string_to_array(l.ids, ',')::bigint[], 'mail', v_mail, 'amprenta_mail', CASE WHEN v_mail THEN v_ampr_mail || ':p' END);
  END LOOP;
  RETURN jsonb_build_object('azi', v_azi, 'notificari', v_trimise, 'licitatii', v_lic);
END
$function$;

-- revalidarea dinaintea mailului: aceeași definiție (ofertare_rc_doc_necitit), pe documentele revendicate
CREATE OR REPLACE FUNCTION public.ofertare_alerta_rc_necitite_acum(p_doc_ids bigint[])
 RETURNS TABLE (id bigint, licitatie_id bigint, nume_original text, created_at timestamptz)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d.id, d.licitatie_id, d.nume_original, d.created_at
  FROM ofertare_documente_atribuire d
  WHERE d.id = ANY (coalesce(p_doc_ids, '{}')) AND public.ofertare_rc_doc_necitit(d.id)
$function$;

-- mail trimis (Resend 2xx / 409 idempotent): revendicarea „în curs” devine „trimis” — doar dacă e încă exact cea revendicată
CREATE OR REPLACE FUNCTION public.ofertare_alerta_rc_mail_confirma(p_licitatie_id bigint, p_amprenta text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH x AS (UPDATE ofertare_alerte_amprenta SET amprenta = split_part(p_amprenta, ':', 1) || ':s', trimisa_la = now()
             WHERE licitatie_id = p_licitatie_id AND fel = 'rc_necitit_mail' AND amprenta = p_amprenta AND p_amprenta LIKE '%:p'
             RETURNING 1)
  SELECT count(*) > 0 FROM x
$function$;

-- eliberarea revendicării de mail (mailul sigur n-a plecat): doar dacă amprenta e încă exact cea revendicată „în curs”
CREATE OR REPLACE FUNCTION public.ofertare_alerta_rc_mail_elibereaza(p_licitatie_id bigint, p_amprenta text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH x AS (DELETE FROM ofertare_alerte_amprenta
             WHERE licitatie_id = p_licitatie_id AND fel = 'rc_necitit_mail' AND amprenta = p_amprenta AND p_amprenta LIKE '%:p'
             RETURNING 1)
  SELECT count(*) > 0 FROM x
$function$;

-- nu sunt UI-callable: doar cron / edge fn (service_role)
REVOKE ALL ON FUNCTION public.ofertare_rc_doc_necitit(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_rc_doc_necitit(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.ofertare_alerta_rc_necitit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_alerta_rc_necitit() TO service_role;
REVOKE ALL ON FUNCTION public.ofertare_alerta_rc_necitite_acum(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_alerta_rc_necitite_acum(bigint[]) TO service_role;
REVOKE ALL ON FUNCTION public.ofertare_alerta_rc_mail_confirma(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_alerta_rc_mail_confirma(bigint, text) TO service_role;
REVOKE ALL ON FUNCTION public.ofertare_alerta_rc_mail_elibereaza(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_alerta_rc_mail_elibereaza(bigint, text) TO service_role;

DO $post$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.ofertare_rc_doc_necitit(bigint)', 'public.ofertare_alerta_rc_necitit()',
                           'public.ofertare_alerta_rc_necitite_acum(bigint[])', 'public.ofertare_alerta_rc_mail_confirma(bigint,text)',
                           'public.ofertare_alerta_rc_mail_elibereaza(bigint,text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '20261101a: postconditie drepturi %', f;
    END IF;
  END LOOP;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261101a_ofertare_rc_necitit_escaladare:' || txid_current() THEN
    RAISE EXCEPTION '20261101a: garda final invalida';
  END IF;
END $post$;
