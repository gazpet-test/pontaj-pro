-- ════════════════════════════════════════════════════════════════════════════
-- 20261003a_garantii_bilete_ordin_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT
-- starea live din 02.10: fără tabela garantii_bilete_ordin (secvență, indecși, politici, trigger — pleacă odată cu ea),
-- fără amprentele bo_scadent/bo_expirat, garantii_alerte() cu corpul live vechi (md5 fd35c645…, inclus verbatim mai jos;
-- ACL/SECDEF/search_path rămân — CREATE OR REPLACE). ATENȚIE: corpul vechi e readus EXACT, deci revenirea REINTRODUCE și
-- cele 2 buguri reparate de 20261003a (modul 'financiar' respins de notifications_modul_check; ON CONFLICT (garantie_id,
-- fel) ambiguu) — e revenire, nu reparație. NU e gaură de securitate, dar scoate evidența biletelor:
-- REFUZĂ dacă tabela are rânduri (nu se șterg date de aici — decizie separată, pct. 3). Notificările deja trimise rămân.
-- Fără GO de execuție: doar la cererea explicită a lui Răzvan, după decizie + review. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261003a', 'SCOATE_BILETE_ORDIN:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE v_n bigint;
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261003a', true) IS DISTINCT FROM 'SCOATE_BILETE_ORDIN:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261003a: nearmată (gazpet.rollback_tehnic_20261003a legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261003a=%') THEN
    RAISE EXCEPTION 'Revenire 20261003a: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261003a: rulează ca postgres (current_user = %)', current_user; END IF;
  IF to_regclass('public.garantii_bilete_ordin') IS NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.garantii_alerte()')) IS DISTINCT FROM 'bd170a0f935e7123d85e4000467dd7fd'
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'garantii_alerte') <> 1 THEN
    RAISE EXCEPTION 'Revenire 20261003a: precondiție — starea nu e cea a patch-ului (tabela lipsește sau garantii_alerte() ≠ md5 bd170a0f935e7123d85e4000467dd7fd)';
  END IF;
  SELECT count(*) INTO v_n FROM public.garantii_bilete_ordin;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Revenire 20261003a: garantii_bilete_ordin are % rânduri — evidența biletelor nu se șterge de aici (decizie separată)', v_n;
  END IF;
END $arm$;

DROP TABLE public.garantii_bilete_ordin;
DELETE FROM public.garantii_alerte_amprenta WHERE fel IN ('bo_scadent', 'bo_expirat');

CREATE OR REPLACE FUNCTION public.garantii_alerte()
RETURNS TABLE(fel text, garantie_id bigint, mesaj text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_amprenta text;
  v_fel text;
  v_titlu text;
  v_mesaj text;
BEGIN
  FOR r IN
    SELECT g.*, (g.data_expirare - current_date) AS zile
    FROM public.garantii g
    WHERE g.stare = 'activa'
  LOOP
    v_fel := NULL;

    -- 1. Lucrare receptionata, garantia inca blocata -> bani si plafon de recuperat
    IF r.lucrare_receptionata AND r.eliberare_solicitata_la IS NULL THEN
      v_fel := 'de_eliberat';
      v_titlu := 'Garanție de eliberat: ' || coalesce(r.lucrare, r.beneficiar);
      v_mesaj := 'Lucrarea e recepționată, garanția e încă blocată la ' ||
                 coalesce(r.emitent, r.banca, 'Trezorerie') ||
                 coalesce(' (' || translate(trim(to_char(r.valoare,'FM999,999,999.00')), ',.', '.,') || ' ' || r.moneda || ')', '') ||
                 '. Se poate cere eliberarea — generează adresa din Financiar → Garanții.';

    -- 2. Expirata fara receptie -> risc, nu oportunitate
    ELSIF r.data_expirare IS NOT NULL AND r.zile < 0 AND NOT r.lucrare_receptionata THEN
      v_fel := 'expirata_fara_receptie';
      v_titlu := 'Garanție expirată fără recepție: ' || coalesce(r.lucrare, r.beneficiar);
      v_mesaj := 'A expirat la ' || to_char(r.data_expirare,'DD.MM.YYYY') ||
                 ', dar lucrarea nu e marcată recepționată. Verifică dacă beneficiarul cere prelungire.';

    -- 3. Expira curand
    ELSIF r.data_expirare IS NOT NULL AND r.zile BETWEEN 0 AND 60 THEN
      v_fel := 'expira_' || CASE WHEN r.zile <= 7 THEN '7' WHEN r.zile <= 30 THEN '30' ELSE '60' END;
      v_titlu := 'Garanție expiră în ' || r.zile || ' zile: ' || coalesce(r.lucrare, r.beneficiar);
      v_mesaj := coalesce(r.emitent, r.banca, 'Trezorerie') ||
                 coalesce(', ' || r.numar_document, '') ||
                 ', scadență ' || to_char(r.data_expirare,'DD.MM.YYYY') ||
                 '. Dacă lucrarea e recepționată, cere eliberarea; dacă nu, pregătește prelungirea.';
    END IF;

    CONTINUE WHEN v_fel IS NULL;

    v_amprenta := v_fel || '|' || coalesce(r.data_expirare::text,'') || '|' ||
                  r.lucrare_receptionata::text || '|' || coalesce(r.eliberare_solicitata_la::text,'');

    IF EXISTS (SELECT 1 FROM public.garantii_alerte_amprenta a
               WHERE a.garantie_id = r.id AND a.fel = v_fel AND a.amprenta = v_amprenta) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    SELECT p.id, 'warning', 'financiar', v_titlu, v_mesaj, '/financiar/garantii'
    FROM public.profiles p WHERE p.is_owner = true;

    INSERT INTO public.garantii_alerte_amprenta (garantie_id, fel, amprenta)
    VALUES (r.id, v_fel, v_amprenta)
    ON CONFLICT (garantie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimis_la = now();

    fel := v_fel; garantie_id := r.id; mesaj := v_mesaj;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

DO $post$
BEGIN
  IF to_regclass('public.garantii_bilete_ordin') IS NOT NULL OR to_regclass('public.garantii_bilete_ordin_id_seq') IS NOT NULL
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.garantii_alerte()'::regprocedure) IS DISTINCT FROM 'fd35c645075cfb6ba7956529e0d85486'
     OR EXISTS (SELECT 1 FROM public.garantii_alerte_amprenta WHERE fel IN ('bo_scadent', 'bo_expirat'))
     OR NOT (SELECT prosecdef AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc WHERE oid = 'public.garantii_alerte()'::regprocedure)
     OR (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text)
           FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.garantii_alerte()'::regprocedure AND x.grantee <> 0)
        IS DISTINCT FROM 'postgres:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Revenire 20261003a: postcondiție — starea nu e cea live din 02.10 (fără tabelă, garantii_alerte md5 fd35c645…, ACL postgres+service_role, fără amprente bo_*)';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261003a', '', true);
END $post$;
