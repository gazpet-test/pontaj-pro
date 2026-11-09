-- Revenire 20261130l_redari_convocare_rezerva. Runner: o tranzactie, GUC gazpet.revenire_20261130l = 'REDARI_CONVOCARE_REZERVA_SCOS:'||txid_current().
-- Migrarea modifica fn_red_numar_document (garda C; revenirea ii restaurează corpul live exact) si creeaza: fn_red_convocare_rezerva(uuid, boolean, text), functia trigger fn_red_convocari_rezerva_garda() si triggerul
-- trg_red_convocari_garda_rezerva (BEFORE INSERT pe red_convocari). Fara tabele, date, politici -> revenirea = DROP TRIGGER + DROP FUNCTION x2.
-- Convocarile create prin RPC raman convocari obisnuite (nr C + rand red_convocari), nicio pierdere de date.
-- ATENTIE: NU exista fallback. Dupa revenire, clientul primeste PGRST202 si AMBELE cai (generarea in masa si convocatorul individual din
-- Registru, prin rezervaNumarConvocare) REFUZA orice convocator nou („protectia la concurenta nu e activa — aplicati migrarea 20261130l”).
-- Descarcarea / regenerarea cu acelasi numar raman disponibile. Ordinea la livrare: migrarea activa INAINTEA clientului; la revenire, intai codul.
DO $rev$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130l', true) IS DISTINCT FROM 'REDARI_CONVOCARE_REZERVA_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130l revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NULL OR to_regprocedure('public.fn_red_convocari_rezerva_garda()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND tgname = 'trg_red_convocari_garda_rezerva') THEN
    RAISE EXCEPTION '20261130l revenire: migrarea lipseste (functie / garda / trigger)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = 'public.fn_red_convocare_rezerva(uuid,boolean,text)'::regprocedure AND deptype = 'n')
     OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.refobjid = 'public.fn_red_convocari_rezerva_garda()'::regprocedure AND d.deptype = 'n'
                  AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid = (SELECT oid FROM pg_trigger WHERE tgrelid = 'public.red_convocari'::regclass AND tgname = 'trg_red_convocari_garda_rezerva'))) THEN
    RAISE EXCEPTION '20261130l revenire REFUZATA: alte obiecte depind de functiile 20261130l' USING ERRCODE = '55000';
  END IF;
  DROP TRIGGER trg_red_convocari_garda_rezerva ON public.red_convocari;
  DROP FUNCTION public.fn_red_convocari_rezerva_garda();
  DROP FUNCTION public.fn_red_convocare_rezerva(uuid, boolean, text);
  IF to_regprocedure('public.fn_red_convocare_rezerva(uuid,boolean,text)') IS NOT NULL OR to_regprocedure('public.fn_red_convocari_rezerva_garda()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_red_convocari_garda_rezerva') THEN
    RAISE EXCEPTION '20261130l revenire: stare finala gresita';
  END IF;
  -- r7: fn_red_numar_document trebuie să fie EXACT corpul pus de migrare (gardă 'C'), ca restaurarea de mai jos să plece dintr-o stare cunoscută
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure) IS DISTINCT FROM '002a8dbb14f9a69db48d0b4c0428fef0' THEN
    RAISE EXCEPTION '20261130l revenire REFUZATA: fn_red_numar_document nu mai e corpul migrarii (schimbat intre timp)' USING ERRCODE = '55000';
  END IF;
  RAISE NOTICE '20261130l revenire: fn_red_convocare_rezerva + garda rezervarii scoase';
END $rev$;
-- r7: corpul LIVE de dinainte al lui fn_red_numar_document (citit read-only 04.11.2026, md5 b943c0eca339b7d6a03970f0a1f8323e), restaurat EXACT
CREATE OR REPLACE FUNCTION public.fn_red_numar_document(p_tip text, p_uat3 text, p_tronson integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cheie text; v_n int;
BEGIN
  IF coalesce(public.fn_red_nivel(), '') NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'redari: fara drept de numerotare' USING ERRCODE = '42501';
  END IF;
  CASE p_tip
    WHEN 'C' THEN v_cheie := 'C';
    WHEN 'AU' THEN v_cheie := 'AU';
    WHEN 'PVA', 'PVB' THEN
      IF p_uat3 IS NULL OR p_uat3 !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'redari: uat3 invalid (%)', p_uat3; END IF;
      v_cheie := p_tip || '-' || p_uat3;
    WHEN 'PVC' THEN
      IF p_tronson IS NULL OR p_tronson NOT BETWEEN 1 AND 11 THEN RAISE EXCEPTION 'redari: tronson invalid (%)', p_tronson; END IF;
      v_cheie := 'PVC-T' || p_tronson;
    ELSE RAISE EXCEPTION 'redari: tip document necunoscut (%)', p_tip;
  END CASE;
  INSERT INTO public.red_numere (cheie, ultimul) VALUES (v_cheie, 1)
  ON CONFLICT (cheie) DO UPDATE SET ultimul = red_numere.ultimul + 1
  RETURNING ultimul INTO v_n;
  IF v_n > 9999 THEN RAISE EXCEPTION 'redari: numerotarea pe % depaseste 9999', v_cheie; END IF;
  RETURN v_cheie || '-' || lpad(v_n::text, 4, '0');
END $function$
;
DO $rev2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure AND md5(prosrc) = 'b943c0eca339b7d6a03970f0a1f8323e'
                  AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']::text[] AND pg_get_userbyid(proowner) = 'postgres')
     OR (SELECT array_agg(a ORDER BY a COLLATE "C") FROM pg_proc p, unnest(p.proacl::text[]) a WHERE p.oid = 'public.fn_red_numar_document(text,text,integer)'::regprocedure)
       IS DISTINCT FROM ARRAY['authenticated=X/postgres', 'postgres=X/postgres', 'service_role=X/postgres']::text[] THEN
    RAISE EXCEPTION '20261130l revenire: fn_red_numar_document nu a revenit la corpul live (md5 b943...)';
  END IF;
  RAISE NOTICE '20261130l revenire: fn_red_numar_document restaurat (md5 b943c0eca339b7d6a03970f0a1f8323e)';
END $rev2$;
