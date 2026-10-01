-- ============================================================================
-- ROLLBACK TEHNIC pentru supabase/migrations/20261005a_sec_rsvti_p1b_jurnal_insert.sql (SEC RSVTI P1b + jurnal A).
--
-- ⚠ ARTEFACT DE TEST / REVENIRE EXCEPȚIONALĂ, FĂRĂ GO DE EXECUȚIE (supabase/revenire/README.md). Readuce starea de după
--   20261003c (aplicată live 01.10): HR poate scrie din nou direct rsvti_* și poate insera direct în jurnal (în nume
--   propriu). Poarta RPC-ului din 20261003c RĂMÂNE. Folosire în producție doar la decizia explicită a lui Răzvan + review.
--
-- Execuția documentată = UN SINGUR string (fișierul NU conține BEGIN/COMMIT):
--     BEGIN;
--     SELECT set_config('gazpet.rollback_tehnic_20261005a', 'REDESCHIDE_P1B_RSVTI:' || txid_current(), true);
--     <conținutul acestui fișier>
--     COMMIT;
-- Siguranțe: armare persistentă = refuz; armarea legată de txid; precondiții = EXACT patch-ul 20261005a;
--   postcondiții = EXACT starea 20261003c (RPC 6185a9dd…, fără trigger/funcții P1b, INSERT authenticated pe jurnal);
--   dezarmare la final. Nu modifică date.
-- ============================================================================
DO $rollback_pre$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c(cfg)
              WHERE lower(split_part(c.cfg, '=', 1)) IS NOT DISTINCT FROM 'gazpet.rollback_tehnic_20261005a') THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261005a blocat: comutator armat PERSISTENT (pg_db_role_setting)' USING ERRCODE = '42501';
  END IF;
  IF current_setting('gazpet.rollback_tehnic_20261005a', true) IS DISTINCT FROM ('REDESCHIDE_P1B_RSVTI:' || txid_current()::text) THEN
    RAISE EXCEPTION 'ROLLBACK TEHNIC 20261005a blocat: redeschide P1b + INSERT direct în jurnal. Fără GO de execuție; armarea se face în aceeași tranzacție: SELECT set_config(''gazpet.rollback_tehnic_20261005a'', ''REDESCHIDE_P1B_RSVTI:'' || txid_current(), true);' USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'))
       IS DISTINCT FROM 'd0bc1be3cb50ec795aea95e02551ded5'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_hr_autorizatii_rsvti_marcaj(bigint)'))
       IS DISTINCT FROM '0384c47a9ad0e0a434ec5e74ed79e6f1'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.fn_trg_hr_autorizatii_rsvti_doar_rpc()'))
       IS DISTINCT FROM '7a721187ea236ee2d41359d46f357f70'
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.hr_autorizatii'::regclass AND tgname = 'trg_hr_autorizatii_rsvti_doar_rpc') THEN
    RAISE EXCEPTION 'Precondiție rollback 20261005a: starea curentă nu e patch-ul 20261005a — nu se revine tacit peste o versiune neanalizată' USING ERRCODE = '55000';
  END IF;
END $rollback_pre$;

DROP TRIGGER trg_hr_autorizatii_rsvti_doar_rpc ON public.hr_autorizatii;
CREATE OR REPLACE FUNCTION public.confirm_hr_autorizatie_rsvti(p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text)
 RETURNS hr_autorizatii_rsvti_confirmari
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aut public.hr_autorizatii%rowtype;
  v_tip public.hr_autorizatii_tipuri%rowtype;
  v_user uuid := auth.uid();
  -- „azi” pentru o firmă din România, independent de TimeZone-ul sesiunii (UTC în producție)
  v_azi  date := (now() at time zone 'Europe/Bucharest')::date;
  -- data confirmării EFECTUATE (nu scadența). Data omisă (DEFAULT NULL din semnătură) și NULL explicit = azi în
  -- Europe/Bucharest: aceeași referință ca limita „nu în viitor”, oricare ar fi fusul sesiunii
  v_data date := coalesce(p_data_confirmare, v_azi);
  v_next date;
  v_row public.hr_autorizatii_rsvti_confirmari%rowtype;
begin
  -- (a) Poarta — înainte de orice citire/scriere. Identitate explicită: sub-ul JWT al unui profil cu drept
  --     (aceeași regulă ca politica hr_autorizatii_write_authorized). Fără identitate ⇒ refuz, nu „sistem”.
  --     IS NOT TRUE: și un rezultat NULL al porții înseamnă refuz.
  if v_user is null or public.fn_poate_scrie_hr_autorizatii() is not true then
    raise exception 'Nu ai dreptul să confirmi viza RSVTI (doar HR/Administrativ, owner, superadmin sau can_modify_employees)'
      using errcode = '42501';
  end if;

  select * into v_aut
  from public.hr_autorizatii
  where id = p_autorizatie_id
    and deleted_at is null;

  if not found then
    raise exception 'Autorizatia nu exista sau este stearsa';
  end if;

  select * into v_tip
  from public.hr_autorizatii_tipuri
  where id = v_aut.tip_id;

  if not coalesce(v_tip.necesita_confirmare_rsvti, false) then
    raise exception 'Tipul de autorizatie nu necesita confirmare RSVTI';
  end if;

  -- (b) Regula datei: o confirmare efectuată e o zi trecută sau de azi, nu precede emiterea autorizației și nu e
  --     înainte de 2000-01-01 (regulă de business pentru date plauzibile, nu dovadă că o dată anterioară e greșită)
  if v_data > v_azi then
    raise exception 'Data confirmării (%) nu poate fi în viitor (azi: %)', v_data, v_azi
      using errcode = '22023';
  end if;
  if not isfinite(v_data) or v_data < date '2000-01-01' then
    raise exception 'Data confirmării (%) e în afara intervalului acceptat: minimul e 2000-01-01', v_data
      using errcode = '22023';
  end if;
  if v_aut.data_emitere is not null and v_data < v_aut.data_emitere then
    raise exception 'Data confirmării (%) nu poate fi înainte de emiterea autorizației (%)', v_data, v_aut.data_emitere
      using errcode = '22023';
  end if;

  -- (c) Scadența următoarei confirmări: calculată din tipul autorizației, nu primită de la apelant
  v_next := (v_data + make_interval(months => coalesce(v_tip.interval_confirmare_rsvti_luni, 6)))::date;

  insert into public.hr_autorizatii_rsvti_confirmari (
    autorizatie_id,
    employee_id,
    data_confirmare,
    urmatoarea_confirmare,
    confirmat_de,
    observatii
  ) values (
    p_autorizatie_id,
    v_aut.employee_id,
    v_data,
    v_next,
    v_user,
    nullif(trim(coalesce(p_observatii, '')), '')
  )
  returning * into v_row;

  update public.hr_autorizatii
  set rsvti_ultima_confirmare = v_row.data_confirmare,
      rsvti_urmatoarea_confirmare = v_row.urmatoarea_confirmare,
      rsvti_confirmat_de = v_user,
      rsvti_confirmat_la = now(),
      rsvti_observatii = nullif(trim(coalesce(p_observatii, '')), ''),
      modificat_la = now()
  where id = p_autorizatie_id;

  return v_row;
end;
$function$;
REVOKE ALL ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) IS
  'SEC RSVTI 03.10.2026: poartă fn_poate_scrie_hr_autorizatii() (42501); data confirmării EFECTUATE: finită, între 2000-01-01 și azi (Europe/Bucharest), ≥ data_emitere (22023); omisă sau NULL = azi (Europe/Bucharest). Scadența = data + interval_confirmare_rsvti_luni al tipului (implicit 6), calculată aici.';
DROP FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc();
DROP FUNCTION public.fn_hr_autorizatii_rsvti_marcaj(bigint);
GRANT INSERT ON public.hr_autorizatii_rsvti_confirmari TO authenticated;

DO $rollback_post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'))
       IS DISTINCT FROM '6185a9ddf13a9e666368858decfa9611'
     OR (SELECT count(*) FROM pg_proc WHERE proname IN ('fn_hr_autorizatii_rsvti_marcaj', 'fn_trg_hr_autorizatii_rsvti_doar_rpc')) IS DISTINCT FROM 0::bigint
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.hr_autorizatii'::regclass AND NOT tgisinternal) IS DISTINCT FROM 1::bigint
     OR has_table_privilege('authenticated', 'public.hr_autorizatii_rsvti_confirmari', 'INSERT') IS DISTINCT FROM true
     OR has_any_column_privilege('anon', 'public.hr_autorizatii_rsvti_confirmari', 'INSERT') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Postcondiție rollback 20261005a: starea nu e EXACT 20261003c (RPC 6185a9dd…, fără funcții/trigger P1b, INSERT authenticated pe jurnal)';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261005a', '', true);
  PERFORM set_config('gazpet.rollback_tehnic_20261005a', '', false);
END $rollback_post$;
