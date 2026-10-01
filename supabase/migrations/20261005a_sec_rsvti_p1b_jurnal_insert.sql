-- ============================================================================
-- SEC RSVTI P1b + jurnal doar prin RPC — 05.10.2026 (pregătit 01.10, după 20261003c aplicat live 01.10, #538)
-- Deciziile lui Răzvan (docs/SECURITATE_PATCH_RSVTI.md §8, pct. 1 și 2, recomandările Claude):
--   P1b: coloanele rsvti_* din hr_autorizatii se scriu DOAR prin confirm_hr_autorizatie_rsvti;
--   jurnal: varianta A — REVOKE INSERT ON hr_autorizatii_rsvti_confirmari FROM authenticated.
--
-- ⚠ NEAPLICAT. Se aplică doar după GO Copilot + acordul explicit al lui Răzvan, EXCLUSIV prin
--   scripts/livrare_migrare.sh (marcaj de livrare + acest fișier + înregistrare, aceeași tranzacție).
--   Fișierul NU conține BEGIN/COMMIT. Garda de livrare la start și la final (tiparul 20261003c / 20260930j).
--
-- Gaura (live, verificată read-only 01.10):
--   * politica hr_autorizatii_write_authorized (ALL) lasă grupul HR să scrie direct rsvti_* prin REST: atribuire
--     falsă (rsvti_confirmat_de = oricine), scadență 2099, fără rând în jurnal, fără regula datei (R2 / ADV-C5);
--   * INSERT direct în jurnal (politica …_insert_autorizat): HR alege id, created_at, employee_id, datele (R1 / ADV-C4).
--
-- Ce face:
--   0. Precondiții fail-closed (NULL = refuz), cu amprentele live din 01.10: RPC md5 6185a9dd… + semnătura
--      (sau varianta din acest patch, la reaplicare), helperul fn_poate_scrie_hr_autorizatii a59aeb46…, politicile
--      (sursa cc78b7fd…, jurnal 780014ba…), setul EXACT de triggere pe hr_autorizatii (trg_hr_autorizatie_noua
--      eafcc431…, AFTER INSERT; la reaplicare + triggerul din acest patch), funcțiile noi absente sau exact cele de aici.
--   1. fn_hr_autorizatii_rsvti_marcaj(bigint) — SECURITY DEFINER, EXECUTE DOAR pentru postgres (nu e expusă ⇒ în afara
--      gate-ului 0e): pune marcajul de tranzacție gazpet.rsvti_rpc = '<txid>:<id autorizație>' (set_config local);
--      cu NULL îl golește. Doar RPC-ul (proprietar postgres) o apelează.
--   2. fn_trg_hr_autorizatii_rsvti_doar_rpc() + trg_hr_autorizatii_rsvti_doar_rpc (BEFORE INSERT OR UPDATE, ROW):
--      orice INSERT cu rsvti_* nenule sau UPDATE care schimbă vreo coloană rsvti_* e refuzat cu 42501, CU EXCEPȚIA
--      cazului în care (a) marcajul = txid-ul curent + id-ul exact al rândului ȘI (b) current_user = proprietarul
--      RPC-ului (funcția de trigger e SECURITY INVOKER ⇒ în RPC current_user = postgres; prin REST = authenticated).
--      Celelalte coloane rămân scrise ca azi (politica ALL neschimbată).
--   3. confirm_hr_autorizatie_rsvti — identic cu 20261003c, plus marcajul în jurul UPDATE-ului pe hr_autorizatii.
--      Corpul nu conține „set_config”/„execute” ⇒ compatibil cu gate-ul 0e (r8).
--   4. Jurnal: REVOKE INSERT FROM authenticated (și PUBLIC; anon deja retras în 20261003c). Scrierea rămâne prin RPC
--      (SECURITY DEFINER). Politica …_insert_autorizat rămâne, ca plasă (fără grant nu mai e atinsă).
--   5. Postcondiții: amprente + atribute + ACL exact pe cele 3 funcții, triggerul, privilegiile EFECTIVE pe jurnal
--      (INSERT/UPDATE/DELETE false pentru PUBLIC/anon/authenticated, inclusiv pe coloane), politicile neschimbate.
--   Gate 0e (scripts/control_0e.sql) trebuie să dea 0 rânduri după apply (runnerul îl rulează; harness-ul la fel).
--
-- Efecte laterale știute: service_role / SQL direct (postgres) NU mai pot schimba rsvti_* fără RPC (refuz 42501);
--   o corecție administrativă cere dezactivarea explicită a triggerului într-o tranzacție revizuită.
-- Revenire: supabase/revenire/20261005a_sec_rsvti_p1b_jurnal_insert_ROLLBACK.sql (rollback TEHNIC, fără GO de execuție).
-- Migrarea nu modifică date.
-- ============================================================================
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261005a_sec_rsvti_p1b_jurnal_insert:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261005a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh (psql --single-transaction: migrare + înregistrare în aceeași tranzacție)';
  END IF;
END $livrare_start$;

-- ---------------------------------------------------------------------------
-- 0. Precondiții — fail-closed dacă producția s-a schimbat față de citirea din 01.10
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_md5 text;
  v_arg text;
  v_n   integer;
  v_ok  integer;
BEGIN
  -- 0a. RPC-ul: varianta live (20261003c) sau cea din acest patch (reaplicare)
  SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_md5, v_arg
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)');
  IF v_arg IS DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text'
     OR (v_md5 IS DISTINCT FROM '6185a9ddf13a9e666368858decfa9611' AND v_md5 IS DISTINCT FROM 'd0bc1be3cb50ec795aea95e02551ded5') THEN
    RAISE EXCEPTION 'Precondiție 0a: confirm_hr_autorizatie_rsvti nu e nici varianta live 20261003c (6185a9dd…), nici cea din acest patch (md5 %, argumente: %)', v_md5, v_arg;
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'confirm_hr_autorizatie_rsvti') IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'Precondiție 0a: există supraîncărcări ale confirm_hr_autorizatie_rsvti';
  END IF;
  -- 0b. helperul porții = cel din 20261003c
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_poate_scrie_hr_autorizatii()'))
       IS DISTINCT FROM 'a59aeb46d5007222067276184a63aaa0'
     OR (SELECT count(*) FROM pg_proc WHERE proname = 'fn_poate_scrie_hr_autorizatii') IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'Precondiție 0b: fn_poate_scrie_hr_autorizatii nu e definiția din 20261003c (a59aeb46…) sau e supraîncărcată';
  END IF;
  -- 0c. politicile: sursa (singura de scriere pe hr_autorizatii) și jurnalul (singura de scriere), RLS activ pe ambele
  IF (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii'::regclass) IS DISTINCT FROM true
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Precondiție 0c: RLS oprit pe hr_autorizatii sau pe jurnal';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii' AND policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_write_authorized'
     AND cmd IS NOT DISTINCT FROM 'ALL' AND permissive IS NOT DISTINCT FROM 'PERMISSIVE' AND roles::text IS NOT DISTINCT FROM '{authenticated}'
     AND md5(regexp_replace(qual, '\s+', ' ', 'g'))       IS NOT DISTINCT FROM 'cc78b7fd25efb09a9a572d7b6d8f554b'
     AND md5(regexp_replace(with_check, '\s+', ' ', 'g')) IS NOT DISTINCT FROM 'cc78b7fd25efb09a9a572d7b6d8f554b';
  IF v_n IS DISTINCT FROM 1 OR v_ok IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Precondiție 0c: hr_autorizatii are % politici de scriere (% = cea analizată), așteptat exact hr_autorizatii_write_authorized', v_n, v_ok;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari' AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  SELECT count(*) INTO v_ok FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
     AND policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_rsvti_confirmari_insert_autorizat'
     AND cmd IS NOT DISTINCT FROM 'INSERT' AND permissive IS NOT DISTINCT FROM 'PERMISSIVE'
     AND roles::text IS NOT DISTINCT FROM '{authenticated}' AND qual IS NULL
     AND md5(with_check) IS NOT DISTINCT FROM '780014ba883836d16ffb7a014c7430c6';
  IF v_n IS DISTINCT FROM 1 OR v_ok IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Precondiție 0c: jurnalul are % politici de scriere (% = cea din 20261003c)', v_n, v_ok;
  END IF;
  -- 0d. funcțiile noi: absente (prima aplicare) sau EXACT cele din acest patch (reaplicare); fără supraîncărcări
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('fn_hr_autorizatii_rsvti_marcaj', 'fn_trg_hr_autorizatii_rsvti_doar_rpc');
  IF v_n IS DISTINCT FROM 0 THEN
    SELECT count(*) INTO v_ok FROM pg_proc p
      JOIN (VALUES ('public.fn_hr_autorizatii_rsvti_marcaj(bigint)', '0384c47a9ad0e0a434ec5e74ed79e6f1'),
                   ('public.fn_trg_hr_autorizatii_rsvti_doar_rpc()', '7a721187ea236ee2d41359d46f357f70')) AS x(fn, m)
        ON p.oid = to_regprocedure(x.fn) AND md5(p.prosrc) IS NOT DISTINCT FROM x.m;
    IF v_n IS DISTINCT FROM 2 OR v_ok IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'Precondiție 0d: funcțiile fn_hr_autorizatii_rsvti_marcaj / fn_trg_hr_autorizatii_rsvti_doar_rpc există, dar nu sunt cele din acest patch (% găsite, % conforme) — nu se suprascriu', v_n, v_ok;
    END IF;
  END IF;
  -- 0e. setul EXACT de triggere pe hr_autorizatii: trg_hr_autorizatie_noua (AFTER INSERT ROW, tgtype 5, corp analizat)
  --     [+ triggerul din acest patch la reaplicare]. Un trigger necunoscut ar putea scrie rsvti_* sau dezactiva protecția.
  SELECT count(*) INTO v_n FROM pg_trigger t WHERE t.tgrelid = 'public.hr_autorizatii'::regclass AND NOT t.tgisinternal;
  SELECT count(*) INTO v_ok
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN (VALUES ('trg_hr_autorizatie_noua', 'fn_trg_hr_autorizatie_noua', 'eafcc43100ab13e9df6f948be740d441', 5),
                 ('trg_hr_autorizatii_rsvti_doar_rpc', 'fn_trg_hr_autorizatii_rsvti_doar_rpc', '7a721187ea236ee2d41359d46f357f70', 23)) AS x(tg, fn, m, tip)
      ON t.tgname::text IS NOT DISTINCT FROM x.tg AND p.proname::text IS NOT DISTINCT FROM x.fn
     AND md5(p.prosrc) IS NOT DISTINCT FROM x.m AND t.tgtype IS NOT DISTINCT FROM x.tip::int2
   WHERE t.tgrelid = 'public.hr_autorizatii'::regclass AND NOT t.tgisinternal
     AND t.tgenabled IS NOT DISTINCT FROM 'O'::"char" AND t.tgqual IS NULL AND t.tgattr::text IS NOT DISTINCT FROM '';
  IF NOT ((v_n = 1 AND v_ok = 1 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.hr_autorizatii'::regclass AND tgname = 'trg_hr_autorizatie_noua'))
          OR (v_n = 2 AND v_ok = 2)) THEN
    RAISE EXCEPTION 'Precondiție 0e: triggerele de pe hr_autorizatii nu sunt setul analizat (% triggere, % conforme)', v_n, v_ok;
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------
-- 1. Marcajul de tranzacție (nu e expus: EXECUTE doar pentru proprietar)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_hr_autorizatii_rsvti_marcaj(p_autorizatie_id bigint)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
begin
  -- marcaj LOCAL (moare la COMMIT/ROLLBACK), legat de txid + id-ul rândului; NULL = golire
  perform pg_catalog.set_config('gazpet.rsvti_rpc',
    case when p_autorizatie_id is null then '' else pg_catalog.txid_current()::text || ':' || p_autorizatie_id::text end,
    true);
end;
$fn$;
REVOKE ALL ON FUNCTION public.fn_hr_autorizatii_rsvti_marcaj(bigint) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_hr_autorizatii_rsvti_marcaj(bigint) IS
  'SEC RSVTI P1b 05.10.2026: marcajul de tranzacție gazpet.rsvti_rpc = txid:id, pus DOAR de confirm_hr_autorizatie_rsvti. Nu e expusă (EXECUTE doar postgres).';

-- ---------------------------------------------------------------------------
-- 2. Triggerul: rsvti_* doar prin RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
declare
  v_schimbat boolean;
  v_rpc      boolean;
begin
  if tg_op = 'INSERT' then
    v_schimbat := new.rsvti_ultima_confirmare is not null or new.rsvti_urmatoarea_confirmare is not null
               or new.rsvti_confirmat_de is not null or new.rsvti_confirmat_la is not null
               or new.rsvti_observatii is not null;
  else
    v_schimbat := (new.rsvti_ultima_confirmare, new.rsvti_urmatoarea_confirmare, new.rsvti_confirmat_de,
                   new.rsvti_confirmat_la, new.rsvti_observatii)
                  is distinct from
                  (old.rsvti_ultima_confirmare, old.rsvti_urmatoarea_confirmare, old.rsvti_confirmat_de,
                   old.rsvti_confirmat_la, old.rsvti_observatii);
  end if;
  if v_schimbat is not false then
    -- SECURITY INVOKER: current_user = proprietarul RPC-ului doar în interiorul lui (SECURITY DEFINER)
    v_rpc := tg_op = 'UPDATE'
         and new.id is not distinct from old.id
         and current_setting('gazpet.rsvti_rpc', true) is not distinct from (pg_catalog.txid_current()::text || ':' || new.id::text)
         and current_user::text is not distinct from
             (select pg_get_userbyid(p.proowner)::text from pg_proc p
               where p.oid = to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'));
    if v_rpc is not true then
      raise exception 'Viza RTS/RSVTI (coloanele rsvti_*) se modifică doar prin „Confirmă viza” (confirm_hr_autorizatie_rsvti)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;
REVOKE ALL ON FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc() IS
  'SEC RSVTI P1b 05.10.2026: refuză (42501) orice scriere rsvti_* în hr_autorizatii în afara confirm_hr_autorizatie_rsvti (marcaj txid:id + current_user = proprietarul RPC-ului). SECURITY INVOKER intenționat.';

DROP TRIGGER IF EXISTS trg_hr_autorizatii_rsvti_doar_rpc ON public.hr_autorizatii;
CREATE TRIGGER trg_hr_autorizatii_rsvti_doar_rpc
  BEFORE INSERT OR UPDATE ON public.hr_autorizatii
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_hr_autorizatii_rsvti_doar_rpc();

-- ---------------------------------------------------------------------------
-- 3. RPC-ul: identic cu 20261003c + marcajul în jurul UPDATE-ului
-- ---------------------------------------------------------------------------
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

  -- (d) P1b: marcajul de tranzacție (txid + id) permite triggerului trg_hr_autorizatii_rsvti_doar_rpc
  --     scrierea rsvti_* DOAR pentru acest rând, în acest apel; golit imediat după
  perform public.fn_hr_autorizatii_rsvti_marcaj(p_autorizatie_id);
  update public.hr_autorizatii
  set rsvti_ultima_confirmare = v_row.data_confirmare,
      rsvti_urmatoarea_confirmare = v_row.urmatoarea_confirmare,
      rsvti_confirmat_de = v_user,
      rsvti_confirmat_la = now(),
      rsvti_observatii = nullif(trim(coalesce(p_observatii, '')), ''),
      modificat_la = now()
  where id = p_autorizatie_id;
  perform public.fn_hr_autorizatii_rsvti_marcaj(null);

  return v_row;
end;
$function$;
REVOKE ALL ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.confirm_hr_autorizatie_rsvti(bigint, date, text) IS
  'SEC RSVTI 03.10.2026 + P1b 05.10.2026: poartă fn_poate_scrie_hr_autorizatii() (42501); data confirmării EFECTUATE: finită, între 2000-01-01 și azi (Europe/Bucharest), ≥ data_emitere (22023); omisă sau NULL = azi. Scadența calculată aici. Singura cale de scriere a rsvti_* (trg_hr_autorizatii_rsvti_doar_rpc) și a jurnalului (INSERT retras de la authenticated).';

-- ---------------------------------------------------------------------------
-- 4. Jurnalul: varianta A — INSERT direct retras (scrierea rămâne prin RPC-ul SECURITY DEFINER)
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.hr_autorizatii_rsvti_confirmari FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Postcondiții (înainte de înregistrare și de COMMIT-ul runnerului)
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_n   integer;
  v_ok  integer;
  v_are boolean;
  r     record;
BEGIN
  -- 5a. amprente + semnătură + atribute (limbaj, SECURITY DEFINER/INVOKER, proconfig exact, proprietar, tip întors)
  SELECT count(*) INTO v_ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    JOIN (VALUES ('public.confirm_hr_autorizatie_rsvti(bigint,date,text)', 'd0bc1be3cb50ec795aea95e02551ded5', true,  'public.hr_autorizatii_rsvti_confirmari'),
                 ('public.fn_hr_autorizatii_rsvti_marcaj(bigint)',          '0384c47a9ad0e0a434ec5e74ed79e6f1',  true,  'void'),
                 ('public.fn_trg_hr_autorizatii_rsvti_doar_rpc()',          '7a721187ea236ee2d41359d46f357f70',     false, 'trigger'),
                 ('public.fn_poate_scrie_hr_autorizatii()',                 'a59aeb46d5007222067276184a63aaa0', true, 'boolean'))
         AS x(fn, m, secdef, tip)
      ON p.oid = to_regprocedure(x.fn)
   WHERE md5(p.prosrc) IS NOT DISTINCT FROM x.m
     AND p.prosecdef IS NOT DISTINCT FROM x.secdef
     AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
     AND pg_get_userbyid(p.proowner)::text IS NOT DISTINCT FROM 'postgres'
     AND p.prorettype IS NOT DISTINCT FROM to_regtype(x.tip)::oid AND p.proretset IS NOT DISTINCT FROM false
     AND p.prokind IS NOT DISTINCT FROM 'f'::"char";
  IF v_ok IS DISTINCT FROM 4
     OR pg_get_function_arguments(to_regprocedure('public.confirm_hr_autorizatie_rsvti(bigint,date,text)'))
        IS DISTINCT FROM 'p_autorizatie_id bigint, p_data_confirmare date DEFAULT NULL::date, p_observatii text DEFAULT NULL::text'
     OR (SELECT count(*) FROM pg_proc WHERE proname IN ('confirm_hr_autorizatie_rsvti', 'fn_hr_autorizatii_rsvti_marcaj',
                                                        'fn_trg_hr_autorizatii_rsvti_doar_rpc', 'fn_poate_scrie_hr_autorizatii'))
        IS DISTINCT FROM 4::bigint THEN
    RAISE EXCEPTION 'Postcondiție 5a: funcțiile nu sunt cele din acest patch (% din 4 conforme: md5, atribute, semnătură, fără supraîncărcări)', v_ok;
  END IF;
  -- 5b. ACL exact: RPC = postgres + service_role + authenticated; marcaj și trigger = DOAR postgres
  SELECT count(*) INTO v_ok
    FROM (VALUES ('public.confirm_hr_autorizatie_rsvti(bigint,date,text)', ARRAY['authenticated:EXECUTE:false', 'postgres:EXECUTE:false', 'service_role:EXECUTE:false']),
                 ('public.fn_hr_autorizatii_rsvti_marcaj(bigint)',          ARRAY['postgres:EXECUTE:false']),
                 ('public.fn_trg_hr_autorizatii_rsvti_doar_rpc()',          ARRAY['postgres:EXECUTE:false'])) AS x(fn, acl)
    JOIN pg_proc p ON p.oid = to_regprocedure(x.fn)
   WHERE (SELECT array_agg(s.e ORDER BY s.e COLLATE "C")
            FROM (SELECT format('%s:%s:%s', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                                a.privilege_type, a.is_grantable::text) AS e
                    FROM aclexplode(p.proacl) a) s) IS NOT DISTINCT FROM x.acl;
  IF v_ok IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Postcondiție 5b: ACL-ul funcțiilor nu e cel din acest patch (% din 3 conforme)', v_ok;
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public', 'public.fn_hr_autorizatii_rsvti_marcaj(bigint)'), ('anon', 'public.fn_hr_autorizatii_rsvti_marcaj(bigint)'),
      ('authenticated', 'public.fn_hr_autorizatii_rsvti_marcaj(bigint)'), ('service_role', 'public.fn_hr_autorizatii_rsvti_marcaj(bigint)')) AS x(rol, fn)
  LOOP
    IF has_function_privilege(r.rol, r.fn, 'EXECUTE') IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Postcondiție 5b: % are EXECUTE efectiv pe % (marcajul nu trebuie să fie apelabil din API)', r.rol, r.fn;
    END IF;
  END LOOP;
  -- 5c. triggerul: exact 2 pe hr_autorizatii, al nostru BEFORE INSERT OR UPDATE ROW (23), activ, fără WHEN/coloane
  SELECT count(*) INTO v_n FROM pg_trigger t WHERE t.tgrelid = 'public.hr_autorizatii'::regclass AND NOT t.tgisinternal;
  SELECT count(*) INTO v_ok FROM pg_trigger t
   WHERE t.tgrelid = 'public.hr_autorizatii'::regclass AND NOT t.tgisinternal
     AND t.tgname::text IS NOT DISTINCT FROM 'trg_hr_autorizatii_rsvti_doar_rpc'
     AND t.tgfoid = to_regprocedure('public.fn_trg_hr_autorizatii_rsvti_doar_rpc()')
     AND t.tgtype IS NOT DISTINCT FROM 23::int2 AND t.tgenabled IS NOT DISTINCT FROM 'O'::"char"
     AND t.tgqual IS NULL AND t.tgattr::text IS NOT DISTINCT FROM '';
  IF v_n IS DISTINCT FROM 2 OR v_ok IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Postcondiție 5c: triggerul P1b lipsește sau nu e cel din patch (% triggere, % conforme)', v_n, v_ok;
  END IF;
  -- 5d. jurnalul: privilegiile EFECTIVE (PUBLIC, roluri moștenite, granturi pe coloane) — fără INSERT/UPDATE/DELETE din API
  FOR r IN SELECT * FROM (VALUES ('public'), ('anon'), ('authenticated')) AS x(rol) LOOP
    FOREACH v_are IN ARRAY ARRAY[
        has_any_column_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', 'INSERT'),
        has_any_column_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', 'UPDATE'),
        has_table_privilege(r.rol, 'public.hr_autorizatii_rsvti_confirmari', 'DELETE')] LOOP
      IF v_are IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Postcondiție 5d: % are încă INSERT/UPDATE/DELETE efectiv pe hr_autorizatii_rsvti_confirmari', r.rol;
      END IF;
    END LOOP;
  END LOOP;
  -- 5e. politicile neschimbate (sursa + jurnalul), RLS activ
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_autorizatii'
         AND policyname::text IS NOT DISTINCT FROM 'hr_autorizatii_write_authorized'
         AND md5(regexp_replace(with_check, '\s+', ' ', 'g')) IS NOT DISTINCT FROM 'cc78b7fd25efb09a9a572d7b6d8f554b') IS DISTINCT FROM 1::bigint
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_autorizatii_rsvti_confirmari'
         AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')) IS DISTINCT FROM 1::bigint
     OR (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.hr_autorizatii_rsvti_confirmari'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Postcondiție 5e: politicile sau RLS s-au schimbat';
  END IF;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261005a_sec_rsvti_p1b_jurnal_insert:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261005a: garda de livrare (final, după postcondiții) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_final$;
