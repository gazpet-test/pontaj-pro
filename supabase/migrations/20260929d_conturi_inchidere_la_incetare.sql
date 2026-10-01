-- ============================================================================
-- R2 — contract de muncă încheiat → contul platformei se închide automat, cu jurnal de revenire
-- Specificație: docs/CONTURI_CICLU_VIATA.md, secțiunea B (+ 0.2: corecțiile din 30.09 după S-A live; 0.3: runda 3).
-- Depinde de 20260929c (fn_identitate_*, fn_nume_*, fn_cont_notifica_owneri). PRECONDIȚIE: S-A 20260929g live (neatins).
-- Citește și tabela de producție hr_employees_private (CNP-ul aplicației, index UNIQUE; nu o modifică, doar îi pune
-- 2 triggere: lock pe persoană și garda „cont revocat”).
--   * conturi_inchideri_jurnal (append-only, RLS doar owner citire, scriere doar prin funcții)
--   * conturi_inchideri_coada  — ce nu se poate face pe loc: flagurile pe calea HR, reîncercări după eșec,
--                                închideri programate (dezactivat înainte de data încetării); runda 3: backoff,
--                                limită de încercări (abandonat_la), notificare o singură dată (notificat_la)
--   * fn_cont_flaguri()        — lista flagurilor de acces din profiles (internă)
--   * fn_cont_garda_persoana() — gardă ATOMICĂ „aceeași persoană” (internă): CNP din AMBELE surse (hr_employees_private
--                                + employees), „situație incompletă” și pe nume de familie / email; lock pe persoană
--   * fn_cont_inchide(...)     — închiderea idempotentă + convergentă (internă); FĂRĂ golirea claims
--   * fn_cont_inchide_owner    — închidere manuală, poartă owner în cod
--   * trg_employees_zz_ciclu_cont — AFTER UPDATE pe employees când se schimbă active SAU termination_date
--       (prinde calea UI, calea toggleEmp și cron-ul hr_auto_deactivate_terminated, neschimbat); o închidere
--       RESTAURATĂ de owner nu se re-aplică automat decât la o nouă plecare (runda 3, X3)
--   * trg_employees_persoana_lock / trg_hr_employees_private_persoana_lock — același lock pe persoană la orice scriere
--       care poate crea / reactiva un contract sau schimba identitatea unei fișe (CNP în oricare sursă, nume, email)
--   * trg_employees_00_cont_revocat / trg_hr_employees_private_00_cont_revocat — un cont închis / banat (JWT încă
--       valabil) nu mai scrie fișe de angajat și date personale (runda 3, X10 / P1e-f)
--   * fn_conturi_inchideri_sweep — procesarea cozii, rulată de pg_cron ca postgres (identitate explicită db_login)
--   ORDINEA LOCK-URILOR (uniformă, runda 3; r3: fișa employees FOR UPDATE întâi, ca la UPDATE-ul HR): [employees] → persoană (advisory) → profil (FOR UPDATE) → coadă / jurnal.
--   * fn_pgrst_pre_request     — hook PostgREST pentru revocarea EFECTIVĂ a JWT-urilor deja emise;
--                                CREAT, dar NEACTIVAT (activarea = ALTER ROLE authenticator, cu acordul lui Răzvan)
--   * fn_cont_restaureaza      — revenire din jurnal, EXCLUSIV owner, cu previzualizare (p_simulare)
--   * fn_cont_stare_angajati   — starea contului pe fișa HR (owner / HR / date personale)
--   * fn_admin_conturi_alerte  — extinsă (aceeași semnătură)
-- Ce NU atinge: role/department/is_owner/nume/email, employee_id, istoricul (pontaje, aprobări,
-- documente, notificări, chat), alocările de flux (doar alertă), jobul cron 13 și
-- fn_employees_termination_notify, triggerul S-A. Owner-ul nu se închide niciodată automat.
-- Idempotentă. Nu atinge datele existente (coada pornește goală; sweep-ul lucrează doar pe coadă).
-- ============================================================================

-- B.2 Jurnalul append-only -------------------------------------------------------
-- ── Garda de livrare (start): DOAR prin scripts/livrare_migrare.sh (psql --single-transaction, marcaj legat de txid).
--    Fișierul NU conține BEGIN/COMMIT; psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260929d_conturi_inchidere_la_incetare:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260929d: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── Precondiții fail-closed (adăugate 01.10.2026 pentru runner) ──────────────────────────
DO $pre_livrare$
DECLARE v_lipsa text[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_identitate_om','fn_identitate_privilegiata','fn_nume_familie','fn_cont_notifica_owneri']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile migrării anterioare: %', v_lipsa; END IF;
  -- r3: nu doar numele — triggerul S-A e activ (O), cheamă exact funcția S-A și are tipul live (19 = BEFORE UPDATE FOR EACH ROW)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_campuri_owner_only'
                    AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
                    AND tgfoid = to_regprocedure('public.fn_profiles_campuri_owner_only()')) THEN
    RAISE EXCEPTION 'Precondiție: S-A (trg_profiles_campuri_owner_only pe profiles: activ, fn_profiles_campuri_owner_only, BEFORE UPDATE ROW) nu e live — se reanalizează';
  END IF;
  IF to_regclass('public.hr_employees_private') IS NULL THEN RAISE EXCEPTION 'Precondiție: public.hr_employees_private lipsește'; END IF;
  -- Live 01.10.2026: S-A extins 30a (#532, v20261001178000, peste SEC F2 r4) a rescris fn_profiles_campuri_owner_only (md5 prosrc 1114af39…);
  -- pachetul e aliniat la acel predicat. Altă variantă ⇒ starea de pornire s-a schimbat ⇒ refuz.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_profiles_campuri_owner_only()'))
     IS DISTINCT FROM '1114af39c13e295dd2ab666dab495567' THEN
    RAISE EXCEPTION 'Precondiție: fn_profiles_campuri_owner_only nu e varianta 30a (S-A extins peste F2 r4, md5 1114af39…) — se reanalizează';
  END IF;
  -- Live 01.10.2026 (citit read-only): SEC F1 (v20261001123000) — setarea implicită a lui postgres pe public nu mai dă
  -- TRUNCATE lui anon/authenticated; tabelele create aici moștenesc asta. Dacă F1 a fost revertit, se reanalizează.
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
              WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
                AND a.privilege_type = 'TRUNCATE' AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) THEN
    RAISE EXCEPTION 'Precondiție: SEC F1 nu e live (setarea implicită a lui postgres dă TRUNCATE lui anon/authenticated) — se reanalizează';
  END IF;
  -- r3: amprenta EXACTĂ a helperilor din c folosiți aici (semnătură unică, md5 prosrc, SECURITY DEFINER, proconfig, owner, ACL)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_identitate_om', 'fn_identitate_om()', '2c64d6b19e2afbf7d158b33d67845e32'),
                 ('fn_identitate_privilegiata', 'fn_identitate_privilegiata()', '13b245513eed1f7f3848ce4edbcec383'),
                 ('fn_identitate_eticheta', 'fn_identitate_eticheta()', '876a28f98d4f4aee76a0580dab4ecc51'),
                 ('fn_nume_familie', 'fn_nume_familie(text)', 'd45994c4bc8aaf51da653578c1cf86cf'),
                 ('fn_nume_cuvinte', 'fn_nume_cuvinte(text)', '8ec2a2ee5b6313ab55ba9ff1a1c6c998'),
                 ('fn_cont_notifica_owneri', 'fn_cont_notifica_owneri(text,text,text,text)', 'ecfb5fa1d44c93c57df39aed1f5c9a5e')) AS w(f, sig, m)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
                        AND p.proacl::text = '{postgres=X/postgres}');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: helperii din 20260929c nu au amprenta livrată (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
END $pre_livrare$;

CREATE TABLE IF NOT EXISTS public.conturi_inchideri_jurnal (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id      uuid NOT NULL,          -- fără FK: jurnalul supraviețuiește ștergerii contului
  email           text NOT NULL,
  employee_id     integer,                -- fără FK (append-only; un SET NULL ar fi blocat)
  motiv           text NOT NULL CHECK (length(btrim(motiv)) >= 5),
  sursa           text NOT NULL CHECK (sursa IN ('trigger_contract_incheiat','coada_contract_incheiat','manual_owner','import_manual')),
  snapshot        jsonb NOT NULL,         -- {versiune:1, flaguri, module, santiere, banned_until, profil, rezumat}
  facut_de        uuid,                   -- omul din platformă (JWT authenticated prin PostgREST); NULL = nu e un om
  facut_de_identitate text,               -- identitatea EXPLICITĂ a declanșatorului (fn_identitate_eticheta):
                                          -- db_login:postgres (cron/migrare) · service_role · owner:<uuid> · authenticated:<uuid> …
  facut_la        timestamptz NOT NULL DEFAULT now(),
  restaurat_de    uuid,
  restaurat_la    timestamptz,
  restaurare_nota text,
  CONSTRAINT conturi_inchideri_restaurare_chk CHECK ((restaurat_de IS NULL) = (restaurat_la IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conturi_inchidere_deschisa
  ON public.conturi_inchideri_jurnal(profile_id) WHERE restaurat_la IS NULL;
CREATE INDEX IF NOT EXISTS idx_conturi_inchideri_employee ON public.conturi_inchideri_jurnal(employee_id);
COMMENT ON TABLE public.conturi_inchideri_jurnal IS
  'Jurnal append-only al închiderilor de conturi (R2): ce avea contul înainte (snapshot), cine/când/de ce. Se scrie doar prin fn_cont_inchide / fn_cont_restaureaza.';

ALTER TABLE public.conturi_inchideri_jurnal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conturi_inchideri_jurnal_select_owner ON public.conturi_inchideri_jurnal;
CREATE POLICY conturi_inchideri_jurnal_select_owner ON public.conturi_inchideri_jurnal
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE));
-- P1 (audit C): service_role doar citește. Un INSERT cu snapshot fabricat ar deveni drepturi la „Restaurează”,
-- iar un UPDATE pe restaurat_* ar marca o închidere „restaurată” fără restaurare.
REVOKE ALL ON TABLE public.conturi_inchideri_jurnal FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.conturi_inchideri_jurnal TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.conturi_inchideri_jurnal_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- P2 (audit C): garda append-only rămâne SECURITY INVOKER intenționat — doar RAISE, nu citește/scrie date.
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_append_only()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Jurnalul închiderilor de conturi e append-only: % interzis', TG_OP USING ERRCODE = '42501';
  END IF;
  -- UPDATE: permis o singură dată, doar restaurat_de/la/nota din NULL în valori.
  IF OLD.restaurat_de IS NOT NULL OR OLD.restaurat_la IS NOT NULL OR OLD.restaurare_nota IS NOT NULL THEN
    RAISE EXCEPTION 'Închiderea #% a fost deja restaurată; jurnalul nu se mai modifică', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.restaurat_de IS NULL OR NEW.restaurat_la IS NULL
     OR (NEW.id, NEW.profile_id, NEW.email, NEW.employee_id, NEW.motiv, NEW.sursa, NEW.snapshot, NEW.facut_de,
         NEW.facut_de_identitate, NEW.facut_la)
        IS DISTINCT FROM
        (OLD.id, OLD.profile_id, OLD.email, OLD.employee_id, OLD.motiv, OLD.sursa, OLD.snapshot, OLD.facut_de,
         OLD.facut_de_identitate, OLD.facut_la) THEN
    RAISE EXCEPTION 'Jurnalul închiderilor e append-only: se completează doar restaurarea (o singură dată)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_append_only() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_conturi_inchideri_append_only ON public.conturi_inchideri_jurnal;
CREATE TRIGGER trg_conturi_inchideri_append_only BEFORE UPDATE OR DELETE ON public.conturi_inchideri_jurnal
  FOR EACH ROW EXECUTE FUNCTION public.fn_conturi_inchideri_append_only();
DROP TRIGGER IF EXISTS trg_conturi_inchideri_fara_truncate ON public.conturi_inchideri_jurnal;
CREATE TRIGGER trg_conturi_inchideri_fara_truncate BEFORE TRUNCATE ON public.conturi_inchideri_jurnal
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_conturi_inchideri_append_only();

-- B.2b Coada închiderilor (corecția 30.09, audit A #2/#3) ---------------------------
-- Ce NU se face pe loc intră aici și e procesat de fn_conturi_inchideri_sweep (pg_cron, login postgres):
--   flaguri     — calea HR (identitate neprivilegiată): modulele, șantierele, banul, sesiunile și refresh
--                 tokenurile se revocă PE LOC; flagurile din profiles le pune pe false sweep-ul (≤ 5 min), fără
--                 falsificarea identității (varianta veche golea claims = impersonarea „lipsei identității”);
--   reincercare — închiderea automată a picat (eroare) → se reîncearcă, cu numărul de încercări și ultima eroare;
--   programata  — fișa dezactivată ÎNAINTE de data încetării → închiderea se face când data ajunge.
-- Sweep-ul lucrează DOAR pe coadă → aplicarea migrării nu închide nimic din datele existente.
-- Runda 3 (X6): după o eroare, următoarea încercare vine cu backoff (5 min · 2^(n-1), max. 6 h); după 8 eșecuri coada
-- se oprește (abandonat_la) — intrarea rămâne DESCHISĂ (alerta o arată, rollback-ul d o vede), iar owner-ul primește
-- o singură notificare la primul eșec (notificat_la; nu una la 5 minute după ce o citește) și una la abandonare.
-- Un eveniment nou pe aceeași intrare (HR salvează din nou fișa, altă eroare din trigger) pornește un ciclu nou.
CREATE TABLE IF NOT EXISTS public.conturi_inchideri_coada (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id          uuid NOT NULL,
  employee_id         integer,
  tip                 text NOT NULL CHECK (tip IN ('flaguri','reincercare','programata')),
  motiv               text NOT NULL,
  scadent_la          date NOT NULL DEFAULT CURRENT_DATE,
  incercari           integer NOT NULL DEFAULT 0,
  ultima_eroare       text,
  creat_la            timestamptz NOT NULL DEFAULT now(),
  creat_de_identitate text,
  rezolvat_la         timestamptz,
  rezultat            text,
  urmatoarea_incercare_la timestamptz,        -- backoff după eșec (NULL = la următoarea rulare)
  abandonat_la        timestamptz,            -- limita de încercări atinsă: coada nu mai reîncearcă (intrarea rămâne deschisă)
  notificat_la        timestamptz,            -- owner-ul a fost anunțat de eșecul intrării (o singură dată pe ciclu)
  CONSTRAINT conturi_inchideri_coada_rezolvare_chk CHECK ((rezolvat_la IS NULL) = (rezultat IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conturi_inchideri_coada_deschisa
  ON public.conturi_inchideri_coada(profile_id, tip) WHERE rezolvat_la IS NULL;
COMMENT ON TABLE public.conturi_inchideri_coada IS
  'Coada R2: flaguri de resetat (calea HR), reîncercări după eșec, închideri programate. Scrisă doar de funcțiile R2, procesată de fn_conturi_inchideri_sweep (pg_cron).';
ALTER TABLE public.conturi_inchideri_coada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conturi_inchideri_coada_select_owner ON public.conturi_inchideri_coada;
CREATE POLICY conturi_inchideri_coada_select_owner ON public.conturi_inchideri_coada
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_owner IS TRUE));
REVOKE ALL ON TABLE public.conturi_inchideri_coada FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.conturi_inchideri_coada TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.conturi_inchideri_coada_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Pune (sau actualizează scadența) unei intrări deschise. Internă.
-- p_eroare nenul = apelantul tocmai a anunțat owner-ul (cont_inchidere_esuata) → notificat_la = acum.
-- Un eveniment nou pe o intrare deschisă = ciclu nou de reîncercări (runda 3: incercari / backoff / abandonare resetate).
CREATE OR REPLACE FUNCTION public.fn_cont_coada_pune(p_profile_id uuid, p_employee_id integer, p_tip text, p_motiv text,
                                                     p_scadent date DEFAULT CURRENT_DATE, p_eroare text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la, ultima_eroare, creat_de_identitate,
                                              notificat_la)
  VALUES (p_profile_id, p_employee_id, p_tip, p_motiv, COALESCE(p_scadent, CURRENT_DATE), p_eroare, public.fn_identitate_eticheta(),
          CASE WHEN p_eroare IS NOT NULL THEN now() END)
  ON CONFLICT (profile_id, tip) WHERE rezolvat_la IS NULL
  DO UPDATE SET scadent_la = EXCLUDED.scadent_la, employee_id = EXCLUDED.employee_id, motiv = EXCLUDED.motiv,
                ultima_eroare = COALESCE(EXCLUDED.ultima_eroare, public.conturi_inchideri_coada.ultima_eroare),
                incercari = 0, urmatoarea_incercare_la = NULL, abandonat_la = NULL, notificat_la = EXCLUDED.notificat_la;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_coada_pune(uuid, integer, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;

-- B.1 Lista flagurilor de acces (calculată la rulare; testul R2-00 o fixează) ----
CREATE OR REPLACE FUNCTION public.fn_cont_flaguri()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(a.attname::text ORDER BY a.attname), '{}'::text[])
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid = 'boolean'::regtype
     AND a.attname ~ '^(can_|receive_|email_notifications_)|^whatsapp_enabled$'
     AND a.attname <> 'is_owner';
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_flaguri() FROM PUBLIC, anon, authenticated, service_role;

-- B.3a Garda „aceeași persoană” (condiția Copilot, audit B #4; runda 3: X1 / X2) --------------------
-- Nu există tabel de contracte: contractul = rândul din employees; aceeași persoană = același CNP (normalizat:
-- doar litere și cifre, majuscule — acoperă și un număr de pașaport).
-- RUNDA 3 (X1, MAJOR): CNP-ul aplicației stă în hr_employees_private.cnp (Admin → Angajați → Editează, AdeverinteLegator;
-- index UNIQUE — a doua fișă a aceluiași om NU poate primi același CNP acolo), iar employees.cnp îl scrie doar wizard-ul
-- „Angajat nou”. „CNP cunoscut” = COALESCE(NULLIF(hp.cnp,''), e.cnp); când sursele diferă (0 cazuri la 30.09) contează
-- AMBELE valori. NU se copiază CNP-uri în employees.cnp: employees e citibil de orice cont logat (regresie GDPR).
-- Întoarce NULL = se poate închide; altfel NU se închide automat (doar alertă):
--   'cnp_lipsa'                  — fișa nu are CNP în nicio sursă (situație incompletă, D7);
--   'alt_contract_activ:<id>'    — altă fișă ACTIVĂ cu același CNP (în oricare sursă);
--   'posibil_alt_contract:<id>'  — altă fișă ACTIVĂ fără niciun CNP cunoscut, cu același nume de familie (fn_nume_cuvinte,
--                                  în ambele sensuri) sau același email → nu pot verifica că e alt om (situație incompletă).
-- ATOMICĂ: pg_advisory_xact_lock pe cheile persoanei (CNP-uri, cuvintele numelui, emailul), ținute până la COMMIT; aceleași
-- chei le iau trg_employees_persoana_lock și trg_hr_employees_private_persoana_lock la orice scriere care poate crea /
-- reactiva un contract sau schimba identitatea unei fișe → o fișă nouă (și FĂRĂ CNP, cu același nume — X2) sau un CNP
-- nou în datele personale nu se pot strecura între verificare și închidere. Verificarea citește DUPĂ lock (funcție
-- VOLATILE → instantaneu nou în READ COMMITTED).
CREATE OR REPLACE FUNCTION public.fn_cont_cnp_normalizat(p_cnp text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_cnp, ''), '[^0-9A-Za-z]', '', 'g')), '');
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_cnp_normalizat(text) FROM PUBLIC, anon, authenticated, service_role;

-- CNP-urile cunoscute ale unei fișe (normalizate, distincte), din ambele surse.
CREATE OR REPLACE FUNCTION public.fn_cont_persoana_cnp(p_employee_id integer)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT x.c ORDER BY x.c), '{}'::text[])
    FROM (SELECT public.fn_cont_cnp_normalizat(hp.cnp) AS c FROM public.hr_employees_private hp WHERE hp.employee_id = p_employee_id
          UNION ALL
          SELECT public.fn_cont_cnp_normalizat(e.cnp) FROM public.employees e WHERE e.id = p_employee_id) x
   WHERE x.c IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_persoana_cnp(integer) FROM PUBLIC, anon, authenticated, service_role;

-- Cheile de lock ale unei persoane: 'gazpet.persoana:<CNP>' (formatul din 30.09, același ca fn_cont_lock_persoana),
-- 'gazpet.persoana.nume:<CUVÂNT>' pentru fiecare cuvânt al numelui, 'gazpet.persoana.email:<email>'.
CREATE OR REPLACE FUNCTION public.fn_cont_persoana_chei(p_cnp text[], p_nume text, p_email text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT x.k ORDER BY x.k), '{}'::text[])
    FROM (SELECT 'gazpet.persoana:' || c AS k FROM unnest(COALESCE(p_cnp, '{}'::text[])) c WHERE c IS NOT NULL
          UNION ALL
          SELECT 'gazpet.persoana.nume:' || w FROM unnest(public.fn_nume_cuvinte(p_nume)) w
          UNION ALL
          SELECT 'gazpet.persoana.email:' || lower(btrim(p_email)) WHERE NULLIF(btrim(COALESCE(p_email, '')), '') IS NOT NULL) x;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_persoana_chei(text[], text, text) FROM PUBLIC, anon, authenticated, service_role;

-- Ia lock-urile în ordinea valorii hash (aceeași ordine globală în orice tranzacție → două tranzacții care își iau cheile
-- dintr-o dată nu pot forma un ciclu). Reentrant: o cheie deja ținută de tranzacție nu mai blochează.
CREATE OR REPLACE FUNCTION public.fn_cont_lock_chei(p_chei text[])
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_h bigint;
BEGIN
  FOR v_h IN SELECT DISTINCT hashtextextended(k, 0) FROM unnest(COALESCE(p_chei, '{}'::text[])) k WHERE k IS NOT NULL ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(v_h);
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_lock_chei(text[]) FROM PUBLIC, anon, authenticated, service_role;

-- Compatibilitate (30.09): lock doar pe cheia unui CNP normalizat.
CREATE OR REPLACE FUNCTION public.fn_cont_lock_persoana(p_cnp_normalizat text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT pg_advisory_xact_lock(hashtextextended('gazpet.persoana:' || p_cnp_normalizat, 0))
   WHERE p_cnp_normalizat IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_lock_persoana(text) FROM PUBLIC, anon, authenticated, service_role;

-- Altă fișă ACTIVĂ (contract neîncheiat) cu un CNP comun, în oricare sursă. NULL = niciuna.
CREATE OR REPLACE FUNCTION public.fn_cont_alt_contract_activ(p_employee_id integer, p_cnp text[])
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT min(b.id)
    FROM public.employees b
   WHERE b.id <> p_employee_id
     AND b.active IS TRUE
     AND (b.termination_date IS NULL OR b.termination_date > CURRENT_DATE)
     AND cardinality(COALESCE(p_cnp, '{}'::text[])) > 0
     AND (public.fn_cont_cnp_normalizat(b.cnp) = ANY (p_cnp)
          OR EXISTS (SELECT 1 FROM public.hr_employees_private hp
                      WHERE hp.employee_id = b.id AND public.fn_cont_cnp_normalizat(hp.cnp) = ANY (p_cnp)));
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_alt_contract_activ(integer, text[]) FROM PUBLIC, anon, authenticated, service_role;

-- „Situație incompletă” pe nume / email: altă fișă ACTIVĂ fără niciun CNP cunoscut, cu același email (nevid) sau al cărei
-- nume de familie apare printre cuvintele numelui fișei date ȘI invers (prinde și ordinea inversată „ION MARIN” /
-- „MARIN ION”). Nu pot dovedi că e alt om → doar alertă. NULL = niciuna.
CREATE OR REPLACE FUNCTION public.fn_cont_posibil_aceeasi_persoana(p_employee_id integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH a AS (
    SELECT e.id, public.fn_nume_cuvinte(e.name) AS cuv, public.fn_nume_familie(e.name) AS fam,
           lower(btrim(COALESCE(e.email, ''))) AS em
      FROM public.employees e WHERE e.id = p_employee_id
  )
  SELECT min(b.id)
    FROM public.employees b, a
   WHERE b.id <> a.id
     AND b.active IS TRUE
     AND (b.termination_date IS NULL OR b.termination_date > CURRENT_DATE)
     AND cardinality(public.fn_cont_persoana_cnp(b.id)) = 0
     AND ((a.em <> '' AND lower(btrim(COALESCE(b.email, ''))) = a.em)
          OR (a.fam IS NOT NULL AND a.fam = ANY (public.fn_nume_cuvinte(b.name))
              AND public.fn_nume_familie(b.name) = ANY (a.cuv)));
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_posibil_aceeasi_persoana(integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cont_garda_persoana(p_employee_id integer)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_chei    text[];
  v_blocate text[] := '{}';
  v_cnp     text[];
  v_alt     integer;
BEGIN
  -- 1) lock pe persoană; cheile se recalculează după lock (o scriere concurentă tocmai confirmată poate aduce un CNP /
  --    nume nou) — cel mult 3 treceri, fiecare citire e o instrucțiune nouă (instantaneu nou)
  FOR i IN 1..3 LOOP
    SELECT public.fn_cont_persoana_chei(public.fn_cont_persoana_cnp(e.id), e.name, e.email) INTO v_chei
      FROM public.employees e WHERE e.id = p_employee_id;
    EXIT WHEN v_chei IS NULL OR v_chei <@ v_blocate;
    PERFORM public.fn_cont_lock_chei(v_chei);
    v_blocate := v_blocate || v_chei;
  END LOOP;
  -- 2) verificarea, DUPĂ lock
  v_cnp := public.fn_cont_persoana_cnp(p_employee_id);
  IF cardinality(v_cnp) = 0 THEN
    RETURN 'cnp_lipsa';
  END IF;
  v_alt := public.fn_cont_alt_contract_activ(p_employee_id, v_cnp);
  IF v_alt IS NOT NULL THEN
    RETURN 'alt_contract_activ:' || v_alt;
  END IF;
  v_alt := public.fn_cont_posibil_aceeasi_persoana(p_employee_id);
  IF v_alt IS NOT NULL THEN
    RETURN 'posibil_alt_contract:' || v_alt;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_garda_persoana(integer) FROM PUBLIC, anon, authenticated, service_role;

-- Textul pentru owner al unui rezultat al gărzii (notificarea cont_inchidere_suspendata, din trigger și din coadă).
CREATE OR REPLACE FUNCTION public.fn_cont_motiv_garda(p_garda text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_garda IS NULL THEN NULL
    WHEN p_garda = 'cnp_lipsa' THEN 'CNP lipsă (nici în datele personale, nici pe fișă): nu pot verifica dacă omul are alt contract activ'
    WHEN p_garda LIKE 'alt_contract_activ:%' THEN format('are alt contract ACTIV (fișa #%s), același CNP', split_part(p_garda, ':', 2))
    WHEN p_garda LIKE 'posibil_alt_contract:%' THEN
      format('posibil alt contract ACTIV: fișa #%s %s, fără CNP, cu același nume de familie sau email — completează CNP-ul ei (Admin → Angajați → date personale) sau închide contul manual',
             split_part(p_garda, ':', 2), COALESCE((SELECT e.name FROM public.employees e WHERE e.id::text = split_part(p_garda, ':', 2)), ''))
    ELSE p_garda END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_motiv_garda(text) FROM PUBLIC, anon, authenticated, service_role;

-- Același lock pe persoană la orice scriere pe employees care poate crea / reactiva un contract sau schimba identitatea
-- unei fișe (CNP, nume, email). O scriere care DOAR încheie / dezactivează (fișa nu rămâne contract activ, identitatea
-- neschimbată — ex. cron-ul 13) nu poate crea „alt contract activ” → fără lock aici (garda fișei închise își ia singură
-- lock-urile); așa cron-ul nu mai ține chei inutile pe rândurile lotului.
CREATE OR REPLACE FUNCTION public.fn_employees_persoana_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_priv text;
  v_chei text[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.cnp IS NOT DISTINCT FROM OLD.cnp AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NOT (NEW.active IS TRUE AND (NEW.termination_date IS NULL OR NEW.termination_date > CURRENT_DATE)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT public.fn_cont_cnp_normalizat(hp.cnp) INTO v_priv FROM public.hr_employees_private hp WHERE hp.employee_id = NEW.id;
  END IF;
  v_chei := public.fn_cont_persoana_chei(ARRAY[public.fn_cont_cnp_normalizat(NEW.cnp), v_priv], NEW.name, NEW.email);
  IF TG_OP = 'UPDATE' THEN
    v_chei := v_chei || public.fn_cont_persoana_chei(ARRAY[public.fn_cont_cnp_normalizat(OLD.cnp)], OLD.name, OLD.email);
  END IF;
  PERFORM public.fn_cont_lock_chei(v_chei);
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_persoana_lock ON public.employees;
CREATE TRIGGER trg_employees_persoana_lock BEFORE INSERT OR UPDATE OF cnp, active, termination_date, name, email ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.fn_employees_persoana_lock();

-- Același lock la scrierea CNP-ului în datele personale (INSERT / UPDATE OF cnp, employee_id / DELETE): un CNP care apare,
-- dispare sau se mută pe altă fișă în timpul unei închideri așteaptă garda (runda 3, X1).
CREATE OR REPLACE FUNCTION public.fn_hr_employees_private_persoana_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.fn_cont_lock_chei(public.fn_cont_persoana_chei(
    ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN public.fn_cont_cnp_normalizat(NEW.cnp) END,
          CASE WHEN TG_OP <> 'INSERT' THEN public.fn_cont_cnp_normalizat(OLD.cnp) END], NULL, NULL));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_hr_employees_private_persoana_lock() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_hr_employees_private_persoana_lock ON public.hr_employees_private;
CREATE TRIGGER trg_hr_employees_private_persoana_lock BEFORE INSERT OR UPDATE OF cnp, employee_id OR DELETE ON public.hr_employees_private
  FOR EACH ROW EXECUTE FUNCTION public.fn_hr_employees_private_persoana_lock();

-- B.3b Cont revocat = fără scrieri pe fișe (runda 3, X10 / P1e-f) -------------------------------------------
-- Un cont cu închidere deschisă sau ban activ, cu JWT-ul emis înainte de închidere (valabil ≤ 1 h până la D9) și cu
-- flagurile încă TRUE (calea HR, ≤ 5 min până la coadă), putea: încheia contractul altcuiva (închide conturi), goli
-- CNP-uri (ocolește garda), edita fișe. Statement-level: refuză înainte de orice rând, 42501. Nu atinge cron-ul,
-- migrările, service_role (fără uid) și nici un cont activ. Celelalte tabele (RLS pe JWT) rămân expuse până la D9.
CREATE OR REPLACE FUNCTION public.fn_cont_revocat_nu_scrie()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_uid uuid := public.fn_identitate_uid();
BEGIN
  IF v_uid IS NOT NULL AND public.fn_identitate_revocata(v_uid) THEN
    RAISE EXCEPTION 'Contul e închis sau blocat: nu mai poate modifica % (JWT emis înainte de închidere)', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_revocat_nu_scrie() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_00_cont_revocat ON public.employees;
CREATE TRIGGER trg_employees_00_cont_revocat BEFORE INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cont_revocat_nu_scrie();
DROP TRIGGER IF EXISTS trg_hr_employees_private_00_cont_revocat ON public.hr_employees_private;
CREATE TRIGGER trg_hr_employees_private_00_cont_revocat BEFORE INSERT OR UPDATE OR DELETE ON public.hr_employees_private
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_cont_revocat_nu_scrie();

-- Ultima închidere a contului, dacă a fost RESTAURATĂ de owner (runda 3, X3). Cât timp e așa, nimic nu re-închide
-- automat contul (corecția datei, data pusă ulterior pe o fișă inactivă, programarea) până la o acțiune explicită:
-- închiderea manuală de către owner sau o NOUĂ plecare (fișa trece iar din activă în inactivă). NULL = nu e cazul.
CREATE OR REPLACE FUNCTION public.fn_cont_restaurare_activa(p_profile_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT x.id FROM (SELECT j.id, j.restaurat_la FROM public.conturi_inchideri_jurnal j
                     WHERE j.profile_id = p_profile_id ORDER BY j.id DESC LIMIT 1) x
   WHERE x.restaurat_la IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_restaurare_activa(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- B.3 Închiderea (internă). Întoarce 'inchis' | 'deja_inchis' | 'sarit_owner' | 'inexistent'.
-- CORECȚIA 30.09 (audit A #2, M2): NU se mai golesc claims (era impersonarea „lipsei identității”; cu S-A extins
-- 20260930a închiderea din UI s-ar fi anulat toată). Decizia pe identitatea EXPLICITĂ a declanșatorului:
--   * owner / service_role / db_login (pg_cron, migrare): UPDATE-ul de flaguri se face pe loc — S-A (și S-A
--     extins), trg_profiles_protectie_legatura și cele 3 triggere owner-only vechi îl acceptă;
--   * altfel (HR prin UI, orice altă identitate): tot restul se revocă pe loc, flagurile intră în coadă (tip
--     'flaguri') și le pune pe false fn_conturi_inchideri_sweep (pg_cron, ≤ 5 min).
-- Revocarea accesului: banned_until, refresh tokens ȘTERȘI, sesiuni ȘTERSE (JWT-urile deja emise rămân valabile
-- până la expirare — vezi fn_pgrst_pre_request, B.5c; runda 3: contul revocat nu mai e „om” pentru porțile R3 și nu
-- mai scrie fișe — fn_identitate_om / trg_employees_00_cont_revocat).
-- Ordinea lock-urilor (uniformă în pachet, runda 3): profil (FOR UPDATE) → jurnal → coadă; apelanții care au nevoie de
-- garda persoanei (triggerul, sweep-ul) iau lock-ul persoanei ÎNAINTEA profilului.
CREATE OR REPLACE FUNCTION public.fn_cont_inchide(p_profile_id uuid, p_motiv text, p_sursa text, p_employee_id integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ident    text := public.fn_identitate_privilegiata();
  v_actor    uuid := public.fn_identitate_om();
  v_eticheta text := public.fn_identitate_eticheta();
  v_p        public.profiles%ROWTYPE;
  v_flaguri  text[] := public.fn_cont_flaguri();
  v_jurnal   bigint;
  v_rez      text;
  v_snap     jsonb;
  v_set      text;
  v_amanat   boolean := false;
BEGIN
  SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;   -- serializează pe profil
  IF NOT FOUND THEN RETURN 'inexistent'; END IF;

  IF v_p.is_owner IS TRUE THEN                        -- SIGURANȚĂ: owner-ul nu se închide niciodată automat
    BEGIN                                             -- notificarea e best-effort (nu blochează nimic)
      PERFORM public.fn_cont_notifica_owneri('cont_owner_neinchis', '⚠️ Contract încheiat pentru un OWNER',
        format('Contul OWNER %s (fișa #%s) NU a fost închis automat. Decide manual. Motiv: %s',
               v_p.email, COALESCE(p_employee_id::text, v_p.employee_id::text, '—'), p_motiv),
        '/admin?tab=managers&cont=' || p_profile_id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_cont_inchide notificare owner (%): % [%]', p_profile_id, SQLERRM, SQLSTATE;
    END;
    RETURN 'sarit_owner';
  END IF;

  SELECT j.id INTO v_jurnal FROM public.conturi_inchideri_jurnal j
   WHERE j.profile_id = p_profile_id AND j.restaurat_la IS NULL;
  IF v_jurnal IS NULL THEN
    v_snap := jsonb_build_object(
      'versiune', 1,
      'flaguri', COALESCE((SELECT jsonb_object_agg(f.key, f.value ORDER BY f.key)
                             FROM jsonb_each(to_jsonb(v_p)) f WHERE f.key = ANY (v_flaguri)), '{}'::jsonb),
      'module', COALESCE((SELECT jsonb_agg(jsonb_build_object('module', m.module, 'access_level', m.access_level,
                                                             'granted_at', m.granted_at, 'granted_by', m.granted_by)
                                           ORDER BY m.module)
                            FROM public.user_module_access m WHERE m.profile_id = p_profile_id), '[]'::jsonb),
      'santiere', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'id' - 'profile_id' ORDER BY s.site_id)
                              FROM public.profile_sites s WHERE s.profile_id = p_profile_id), '[]'::jsonb),
      'banned_until', (SELECT to_jsonb(u.banned_until) FROM auth.users u WHERE u.id = p_profile_id),
      'profil', jsonb_build_object('role', v_p.role, 'department', v_p.department, 'name', v_p.name, 'email', v_p.email),
      'rezumat', jsonb_build_object(
        'module', (SELECT count(*) FROM public.user_module_access m WHERE m.profile_id = p_profile_id),
        'santiere', (SELECT count(*) FROM public.profile_sites s WHERE s.profile_id = p_profile_id),
        'flaguri_true', (SELECT count(*) FROM jsonb_each(to_jsonb(v_p)) f WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb),
        'sesiuni', (SELECT count(*) FROM auth.sessions se WHERE se.user_id = p_profile_id),
        'refresh_tokens_active', (SELECT count(*) FROM auth.refresh_tokens rt
                                   WHERE rt.user_id = p_profile_id::text AND rt.revoked IS NOT TRUE)));
    INSERT INTO public.conturi_inchideri_jurnal (profile_id, email, employee_id, motiv, sursa, snapshot, facut_de, facut_de_identitate)
    VALUES (p_profile_id, COALESCE(v_p.email, p_profile_id::text), COALESCE(p_employee_id, v_p.employee_id::integer),
            p_motiv, p_sursa, v_snap, v_actor, v_eticheta)
    RETURNING id INTO v_jurnal;
    v_rez := 'inchis';
  ELSE
    v_rez := 'deja_inchis';                           -- NU suprascrie primul snapshot
  END IF;

  -- Aplicarea e convergentă: rulează și pe 'deja_inchis' (scoate un acces redat manual între timp).
  DELETE FROM public.user_module_access WHERE profile_id = p_profile_id;
  DELETE FROM public.profile_sites      WHERE profile_id = p_profile_id;

  -- Flagurile: doar cu identitate privilegiată explicită; altfel coada (fără falsificarea identității).
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(v_flaguri) f;
  IF v_ident IS NOT NULL THEN
    IF v_set IS NOT NULL THEN
      EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING p_profile_id;
    END IF;
    UPDATE public.conturi_inchideri_coada SET rezolvat_la = now(), rezultat = 'flaguri_resetate'
     WHERE profile_id = p_profile_id AND tip = 'flaguri' AND rezolvat_la IS NULL;
  ELSE
    v_amanat := true;
    PERFORM public.fn_cont_coada_pune(p_profile_id, COALESCE(p_employee_id, v_p.employee_id::integer), 'flaguri',
      format('Flagurile contului închis (jurnal #%s) — declanșat de %s', v_jurnal, v_eticheta));
  END IF;

  -- Logare blocată + sesiuni și refresh tokens ȘTERSE (aceeași valoare ca la închiderea manuală, nu 'infinity').
  UPDATE auth.users SET banned_until = '2999-12-31 00:00:00+00'
   WHERE id = p_profile_id AND (banned_until IS NULL OR banned_until < '2999-12-31 00:00:00+00');
  DELETE FROM auth.refresh_tokens WHERE user_id = p_profile_id::text;
  DELETE FROM auth.sessions WHERE user_id = p_profile_id;

  -- Intrările deschise de reîncercare / programare pentru acest cont sunt rezolvate de închiderea de acum.
  UPDATE public.conturi_inchideri_coada SET rezolvat_la = now(), rezultat = v_rez
   WHERE profile_id = p_profile_id AND tip IN ('reincercare', 'programata') AND rezolvat_la IS NULL;

  IF v_rez = 'inchis' THEN
    BEGIN                                             -- best-effort: închiderea rămâne făcută și dacă notificarea pică
      PERFORM public.fn_cont_notifica_owneri('cont_inchis_automat', '🔒 Cont închis: ' || COALESCE(v_p.email, p_profile_id::text),
        format('%s · jurnal #%s%s', p_motiv, v_jurnal,
               CASE WHEN v_amanat THEN ' · flagurile de acces se resetează la următoarea rulare a cozii (≤ 5 min)' ELSE '' END),
        '/admin?tab=managers&cont=' || p_profile_id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_cont_inchide notificare (%): % [%]', p_profile_id, SQLERRM, SQLSTATE;
    END;
  END IF;
  RETURN v_rez;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_inchide(uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- B.4 Închiderea manuală de către owner (poartă în cod) --------------------------
CREATE OR REPLACE FUNCTION public.fn_cont_inchide_owner(p_profile_id uuid, p_motiv text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_emp integer;
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate închide manual un cont' USING ERRCODE = '42501';
  END IF;
  IF p_motiv IS NULL OR length(btrim(p_motiv)) < 5 THEN
    RAISE EXCEPTION 'Motivul închiderii e obligatoriu (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT employee_id::integer INTO v_emp FROM public.profiles WHERE id = p_profile_id;
  RETURN public.fn_cont_inchide(p_profile_id, btrim(p_motiv), 'manual_owner', v_emp);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_inchide_owner(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_inchide_owner(uuid, text) TO authenticated;

-- B.5 Triggerul pe employees ------------------------------------------------------
-- AFTER UPDATE + WHEN pe active SAU termination_date (nu UPDATE OF): vede și active=false pus de
-- fn_employees_termination_notify (BEFORE) pe calea UI, UPDATE-ul cron-ului (fără JWT) și data pusă
-- ULTERIOR pe o fișă deja inactivă (audit B #5-ii).
-- Pentru fiecare cont legat de fișă (și de celelalte fișe încheiate ale ACELEIAȘI persoane, după CNP din ambele surse):
--   * owner → niciodată închis (notificare);
--   * închidere RESTAURATĂ de owner (runda 3, X3) și fără o plecare nouă (fișa nu trece acum din activă în inactivă:
--     corecția datei, data pusă ulterior) → nu se re-închide automat, doar notificare; o plecare nouă sau închiderea
--     manuală a owner-ului ridică blocajul;
--   * tip_cont extern/test/sistem → nu se închide automat (doar alertă) (audit B #5-iv);
--   * garda „aceeași persoană” (ATOMICĂ, lock pe persoană): CNP lipsă / alt contract activ / posibil alt contract
--     activ (fișă activă fără CNP, același nume de familie sau email) → nu se închide (doar alertă);
--   * altfel fn_cont_inchide; o eroare → notificare + coadă 'reincercare' (nu blochează NICIODATĂ UPDATE-ul).
-- Dezactivare cu dată în VIITOR → coadă 'programata' (închiderea se face când data ajunge), cu aceeași excepție pentru
-- conturile restaurate fără plecare nouă.
CREATE OR REPLACE FUNCTION public.fn_employees_ciclu_cont()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r        record;
  v_rez    text;
  v_err    text;
  v_cnp    text[];
  v_garda  text;
  v_motiv  text;
  v_rest   bigint;
  v_plecare boolean := OLD.active IS TRUE;          -- trecere activ → inactiv = plecare nouă (omul a lucrat după o restaurare)
  v_inchide boolean := NEW.active IS FALSE AND NEW.termination_date IS NOT NULL AND NEW.termination_date <= CURRENT_DATE
                       AND (OLD.active IS TRUE OR OLD.termination_date IS DISTINCT FROM NEW.termination_date);
BEGIN
  IF v_inchide THEN
    -- Garda o singură dată, ÎNAINTEA subtranzacțiilor de închidere: lock-ul pe persoană rămâne până la COMMIT
    -- (blocul reușit face RELEASE, nu abort). O eroare în gardă = situație incompletă → nu se închide.
    BEGIN
      v_garda := public.fn_cont_garda_persoana(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      v_garda := 'eroare_garda: ' || SQLERRM;
    END;
    v_cnp := public.fn_cont_persoana_cnp(NEW.id);
    FOR r IN SELECT p.id, p.email, p.is_owner, p.tip_cont, p.employee_id::integer AS emp
               FROM public.profiles p
              WHERE p.employee_id = NEW.id
                 OR (cardinality(v_cnp) > 0 AND p.employee_id IN (
                      SELECT e.id FROM public.employees e
                       WHERE e.id <> NEW.id AND public.fn_cont_persoana_cnp(e.id) && v_cnp
                         AND e.active IS NOT TRUE AND e.termination_date IS NOT NULL AND e.termination_date <= CURRENT_DATE))
              ORDER BY p.id LOOP
      v_rest := CASE WHEN NOT v_plecare THEN public.fn_cont_restaurare_activa(r.id) END;
      v_motiv := CASE
        WHEN r.is_owner IS TRUE THEN NULL             -- fn_cont_inchide întoarce sarit_owner și anunță
        WHEN EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j
                      WHERE j.profile_id = r.id AND j.restaurat_la IS NULL) THEN NULL   -- deja închis: reaplicare convergentă
        WHEN v_rest IS NOT NULL THEN
          format('contul a fost RESTAURAT de owner (jurnal #%s) și nu se re-închide automat la o corecție a fișei; închide-l manual dacă omul a plecat definitiv', v_rest)
        WHEN COALESCE(r.tip_cont, 'angajat') <> 'angajat' THEN format('contul e marcat „%s”, nu se închide automat', r.tip_cont)
        ELSE public.fn_cont_motiv_garda(v_garda)
      END;
      IF v_motiv IS NOT NULL THEN
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
            format('%s (fișa #%s %s): %s. Contul rămâne deschis; închide-l manual din Admin → Manageri sau corectează fișa.',
                   r.email, NEW.id, NEW.name, v_motiv),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
        CONTINUE;
      END IF;
      BEGIN
        v_rez := public.fn_cont_inchide(r.id,
                   format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
                   'trigger_contract_incheiat', r.emp);
      EXCEPTION WHEN OTHERS THEN
        -- Nu blocăm NICIODATĂ UPDATE-ul din HR sau lotul cron-ului; închiderea se reîncearcă din coadă.
        v_err := SQLERRM;
        BEGIN
          PERFORM public.fn_cont_coada_pune(r.id, r.emp, 'reincercare',
            format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
            CURRENT_DATE, v_err);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont coadă (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
            format('%s (fișa #%s %s): %s · se reîncearcă automat din coadă', r.email, NEW.id, NEW.name, v_err),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont (%): închiderea a eșuat (%) și notificarea la fel: % [%]', r.email, v_err, SQLERRM, SQLSTATE;
        END;
      END;
    END LOOP;
    -- Alt cont, NELEGAT, al aceleiași persoane (emailul de logare = emailul de pe fișă): doar alertă (audit B #5-iii).
    IF NULLIF(btrim(COALESCE(NEW.email, '')), '') IS NOT NULL THEN
      FOR r IN SELECT p.id, u.email::text AS email
                 FROM public.profiles p JOIN auth.users u ON u.id = p.id
                WHERE p.employee_id IS NULL AND lower(btrim(u.email)) = lower(btrim(NEW.email)) LOOP
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_posibil_aceeasi_persoana', '⚠️ Cont nelegat al unui fost angajat?',
            format('Contractul fișei #%s %s s-a încheiat, iar contul NELEGAT %s are emailul de pe fișă. NU s-a închis automat — verifică și închide-l manual dacă e al lui.',
                   NEW.id, NEW.name, r.email),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
      END LOOP;
    END IF;
  ELSIF NEW.active IS FALSE AND (OLD.active IS TRUE OR OLD.termination_date IS DISTINCT FROM NEW.termination_date) THEN
    FOR r IN SELECT p.id, p.email, p.is_owner, p.employee_id::integer AS emp
               FROM public.profiles p WHERE p.employee_id = NEW.id ORDER BY p.id LOOP
      v_rest := CASE WHEN NOT v_plecare THEN public.fn_cont_restaurare_activa(r.id) END;
      IF NEW.termination_date IS NOT NULL AND NEW.termination_date > CURRENT_DATE AND r.is_owner IS NOT TRUE THEN
        IF v_rest IS NULL THEN
          BEGIN                                       -- dezactivat înainte de dată: închiderea se programează
            PERFORM public.fn_cont_coada_pune(r.id, r.emp, 'programata',
              format('Contract încheiat la %s (fișa #%s %s)', to_char(NEW.termination_date, 'DD.MM.YYYY'), NEW.id, NEW.name),
              NEW.termination_date);
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'fn_employees_ciclu_cont coadă (%): % [%]', r.email, SQLERRM, SQLSTATE;
          END;
        ELSE
          BEGIN                                       -- cont restaurat de owner, fără plecare nouă: nu se programează
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
              format('%s (fișa #%s %s): contul a fost RESTAURAT de owner (jurnal #%s) și nu se re-închide automat la o corecție a fișei (data încetării: %s). Contul rămâne deschis; închide-l manual din Admin → Manageri dacă omul a plecat definitiv.',
                     r.email, NEW.id, NEW.name, v_rest, to_char(NEW.termination_date, 'DD.MM.YYYY')),
              '/admin?tab=managers&cont=' || r.id::text);
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
          END;
        END IF;
      END IF;
      IF OLD.active IS TRUE THEN
        BEGIN
          PERFORM public.fn_cont_notifica_owneri('cont_angajat_inactiv_fara_incetare', '⚠️ Angajat dezactivat fără contract încheiat',
            format('%s (fișa #%s %s) a fost dezactivat%s. Contul NU s-a închis automat%s — verifică fișa sau închide contul manual.',
                   r.email, NEW.id, NEW.name,
                   CASE WHEN NEW.termination_date IS NULL THEN ' fără dată de încetare'
                        ELSE ' înainte de data încetării (' || to_char(NEW.termination_date, 'DD.MM.YYYY') || ')' END,
                   CASE WHEN NEW.termination_date IS NOT NULL AND r.is_owner IS NOT TRUE
                        THEN ' (închiderea e programată pentru data încetării)' ELSE '' END),
            '/admin?tab=managers&cont=' || r.id::text);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
        END;
      END IF;
    END LOOP;
  ELSIF OLD.active IS NOT TRUE AND NEW.active IS TRUE THEN
    -- Reactivarea NU redă nimic automat; doar anunță owner-ul. Programările / reîncercările se anulează.
    BEGIN
      UPDATE public.conturi_inchideri_coada c SET rezolvat_la = now(), rezultat = 'anulat_reactivat'
       WHERE c.rezolvat_la IS NULL AND c.tip IN ('reincercare', 'programata') AND c.employee_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_employees_ciclu_cont coadă (fișa #%): % [%]', NEW.id, SQLERRM, SQLSTATE;
    END;
    FOR r IN SELECT p.id, p.email, j.id AS jid
               FROM public.profiles p
               JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
              WHERE p.employee_id = NEW.id ORDER BY p.id LOOP
      BEGIN
        PERFORM public.fn_cont_notifica_owneri('cont_angajat_reactivat', '↩ Angajat reactivat — contul rămâne închis',
          format('%s (fișa #%s %s) a fost reactivat. Accesul NU a fost redat automat; restaurarea din jurnalul #%s o face doar owner-ul.',
                 r.email, NEW.id, NEW.name, r.jid),
          '/admin?tab=managers&cont=' || r.id::text);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_employees_ciclu_cont notificare (%): % [%]', r.email, SQLERRM, SQLSTATE;
      END;
    END LOOP;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_employees_ciclu_cont() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_employees_zz_ciclu_cont ON public.employees;
CREATE TRIGGER trg_employees_zz_ciclu_cont AFTER UPDATE ON public.employees
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.termination_date IS DISTINCT FROM NEW.termination_date)
  EXECUTE FUNCTION public.fn_employees_ciclu_cont();

-- B.5b Procesarea cozii (pg_cron, login postgres fără claims = identitate explicită db_login) ----------
-- Gardă în cod: doar o identitate privilegiată explicită (fn_identitate_privilegiata); EXECUTE revocat de la
-- toate rolurile API. Nu citește conținut extern; doar ia drepturi (flaguri → false, închideri), nu dă niciodată.
-- Un cont restaurat de owner NU se re-închide: restaurarea anulează intrările din coadă și sweep-ul verifică
-- din nou toate condițiile (fișă încă inactivă, dată ajunsă, legătura neschimbată, gardă, tip cont, owner, restaurare).
-- Runda 3:
--   * ordinea lock-urilor (X / 40P01): candidații se citesc FĂRĂ lock; pentru fiecare: persoana (garda, advisory) →
--     profilul (FOR UPDATE) → intrarea din coadă (FOR UPDATE, recitită) → jurnalul (în fn_cont_inchide) — aceeași
--     ordine ca fn_cont_inchide / fn_cont_restaureaza (profil înaintea cozii); varianta veche bloca intrarea întâi;
--   * X6: după o eroare, backoff 5 min · 2^(n-1) (max. 6 h); după 8 eșecuri abandonat_la (coada se oprește, intrarea
--     rămâne deschisă, alerta cont_activ_fost_angajat / inchis_cu_acces_rest o arată); owner-ul e anunțat o singură
--     dată la primul eșec (dacă nu l-a anunțat deja triggerul) și o dată la abandonare — nu la fiecare rulare.
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_max_incercari constant integer := 8;
  q        record;
  x        public.conturi_inchideri_coada%ROWTYPE;
  e        record;
  v_rez    text;
  v_garda  text;
  v_set    text;
  v_n      jsonb := '{}'::jsonb;
  v_rezult text;
  v_err    text;
  v_email  text;
BEGIN
  IF public.fn_identitate_privilegiata() IS NULL THEN
    RAISE EXCEPTION 'Coada închiderilor o procesează doar pg_cron (login postgres) sau o identitate privilegiată explicită'
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(public.fn_cont_flaguri()) f;
  FOR q IN SELECT c.id, c.profile_id, c.employee_id, c.tip
             FROM public.conturi_inchideri_coada c
            WHERE c.rezolvat_la IS NULL AND c.abandonat_la IS NULL AND c.scadent_la <= CURRENT_DATE
              AND (c.urmatoarea_incercare_la IS NULL OR c.urmatoarea_incercare_la <= now())
            ORDER BY c.id LOOP
    v_rezult := NULL;
    v_garda := NULL;
    BEGIN
      IF q.tip <> 'flaguri' AND q.employee_id IS NOT NULL THEN
        -- 0) fișa de angajat (r3, D1 Copilot): aceeași ordine ca un UPDATE HR pe employees (rând → advisory → profil → coadă).
        --    Fără lock, sweep-ul putea citi termination_date veche deja comisă în timp ce HR o muta în viitor ⇒ cont închis
        --    cu dată viitoare. Cu FOR UPDATE, citirea de mai jos (instrucțiune nouă, READ COMMITTED) vede versiunea comisă.
        PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
        v_garda := public.fn_cont_garda_persoana(q.employee_id);          -- 1) persoana (lock până la COMMIT)
      END IF;
      PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;   -- 2) profilul
      SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE;   -- 3) intrarea, recitită
      IF NOT FOUND OR x.rezolvat_la IS NOT NULL OR x.abandonat_la IS NOT NULL THEN
        CONTINUE;                                    -- rezolvată între timp (restaurare, închidere manuală, reactivare)
      END IF;
      IF x.tip = 'flaguri' THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id) THEN
          v_rezult := 'anulat_profil_inexistent';
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = x.profile_id AND j.restaurat_la IS NULL)
              AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.is_owner IS NOT TRUE) THEN
          IF v_set IS NOT NULL THEN
            EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING x.profile_id;
          END IF;
          v_rezult := 'flaguri_resetate';
        ELSE
          v_rezult := 'anulat_restaurat';
        END IF;
      ELSE
        SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;   -- recitire după lock (revalidare)
        IF NOT FOUND
           OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.employee_id = x.employee_id)
           OR e.active IS TRUE OR e.termination_date IS NULL THEN
          v_rezult := 'anulat_conditii';
        ELSIF e.termination_date > CURRENT_DATE THEN
          UPDATE public.conturi_inchideri_coada SET scadent_la = e.termination_date WHERE id = x.id;   -- data s-a mutat
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = x.profile_id AND j.restaurat_la IS NULL) THEN
          v_rezult := 'deja_inchis';
        ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id
                        AND (p.is_owner IS TRUE OR COALESCE(p.tip_cont, 'angajat') <> 'angajat')) THEN
          v_rezult := 'suspendat_owner_sau_tip_cont';
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j
                       WHERE j.id = public.fn_cont_restaurare_activa(x.profile_id) AND j.restaurat_la >= x.creat_la) THEN
          v_rezult := 'anulat_restaurat';                -- restaurare mai nouă decât intrarea: decizia owner-ului rămâne
        ELSIF v_garda IS NOT NULL THEN
          v_rezult := 'suspendat_' || split_part(v_garda, ':', 1);
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
            format('%s (fișa #%s %s): %s. Contul rămâne deschis; închide-l manual din Admin → Manageri sau corectează fișa.',
                   (SELECT p.email FROM public.profiles p WHERE p.id = x.profile_id), e.id, e.name, public.fn_cont_motiv_garda(v_garda)),
            '/admin?tab=managers&cont=' || x.profile_id::text);
        ELSE
          v_rez := public.fn_cont_inchide(x.profile_id,
                     format('Contract încheiat la %s (fișa #%s %s) · %s', to_char(e.termination_date, 'DD.MM.YYYY'), e.id, e.name,
                            CASE x.tip WHEN 'programata' THEN 'închidere programată' ELSE 'reîncercare după eșec' END),
                     'coada_contract_incheiat', e.id);
          v_rezult := v_rez;                                -- fn_cont_inchide a rezolvat deja intrarea
        END IF;
      END IF;
      IF v_rezult IS NOT NULL THEN
        UPDATE public.conturi_inchideri_coada
           SET rezolvat_la = COALESCE(rezolvat_la, now()), rezultat = COALESCE(rezultat, v_rezult), incercari = incercari + 1
         WHERE id = x.id;
        v_n := jsonb_set(v_n, ARRAY[v_rezult], to_jsonb(COALESCE((v_n ->> v_rezult)::int, 0) + 1));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_n := jsonb_set(v_n, ARRAY['eroare'], to_jsonb(COALESCE((v_n ->> 'eroare')::int, 0) + 1));
      BEGIN
        -- subtranzacția anulată a eliberat lock-urile din bloc → aceeași ordine: profil, apoi intrarea
        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
        UPDATE public.conturi_inchideri_coada
           SET incercari = incercari + 1, ultima_eroare = v_err,
               urmatoarea_incercare_la = now() + least(interval '5 minutes' * power(2, incercari), interval '6 hours'),
               abandonat_la = CASE WHEN incercari + 1 >= c_max_incercari THEN now() END
         WHERE id = q.id AND rezolvat_la IS NULL
        RETURNING * INTO x;
        IF FOUND THEN
          v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
          IF x.abandonat_la IS NOT NULL THEN
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_abandonata', '⛔ Închiderea automată a contului s-a oprit',
              format('%s (coada #%s, %s): %s încercări eșuate, ultima: %s · coada NU mai reîncearcă — elimină cauza și închide contul manual (Admin → Manageri)',
                     v_email, x.id, x.tip, x.incercari, v_err),
              '/admin?tab=managers&cont=' || q.profile_id::text);
          ELSIF x.notificat_la IS NULL THEN
            PERFORM public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
              format('%s (coada #%s, %s): %s · se reîncearcă automat (încercarea %s din %s; următoarea după %s)',
                     v_email, x.id, x.tip, v_err, x.incercari, c_max_incercari,
                     to_char(x.urmatoarea_incercare_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            UPDATE public.conturi_inchideri_coada SET notificat_la = now() WHERE id = q.id;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): % [%] · eroarea inițială: %', q.id, SQLERRM, SQLSTATE, v_err;
      END;
    END;
  END LOOP;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_sweep() FROM PUBLIC, anon, authenticated, service_role;

-- Programarea (pg_cron, la 5 minute, ca postgres). Nume fix → cron.schedule e idempotent (actualizează jobul).
-- Local (harness PG16 fără pg_cron) se sare; testele cheamă funcția direct, ca login postgres.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('conturi_inchideri_coada', '*/5 * * * *', 'SELECT public.fn_conturi_inchideri_sweep()');
  END IF;
END $cron$;

-- B.5c Revocarea EFECTIVĂ a JWT-urilor deja emise (audit A #5 / B #6) ----------------
-- PostgREST verifică doar semnătura și expirarea (jwt_exp = 3600 s în producție): după închidere, tokenul de acces
-- rămâne valabil până la o oră, iar politicile `auth.uid() IS NOT NULL` / `USING (true)` (ex. employees: CNP,
-- IBAN) răspund în continuare. Hook-ul pre-request refuză (42501) o cerere authenticated dacă: contul are o
-- închidere nerestaurată, e banat, sau sesiunea din token (session_id) nu mai există în auth.sessions.
-- ⚠ Funcția e CREATĂ, dar NU e activată. Activarea e schimbare de configurație globală (cere acordul lui Răzvan):
--     ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.fn_pgrst_pre_request';
--     NOTIFY pgrst, 'reload config';
--   Storage și Realtime NU trec prin hook → de scurtat și JWT expiry (Dashboard → Auth), ex. 900 s.
-- (01.10.2026, gate 0e r8) Citirea session_id din JWT stă într-o funcție INTERNĂ (fără EXECUTE pentru anon/authenticated),
-- ca hook-ul expus să nu conțină referințe la GUC-urile request.jwt* (invariantul de catalog SEC F2 0e).
CREATE OR REPLACE FUNCTION public.fn_identitate_sesiune()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RETURN coalesce(nullif(current_setting('request.jwt.claims', true), ''),
                  nullif(current_setting('request.jwt.claim', true), ''))::jsonb ->> 'session_id';
END $fn$;
REVOKE ALL ON FUNCTION public.fn_identitate_sesiune() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_pgrst_pre_request()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  c      record;
  v_uid  uuid;
  v_sess text;
BEGIN
  SELECT * INTO c FROM public.fn_identitate_claims();
  IF c.rol IS DISTINCT FROM 'authenticated' THEN
    RETURN;                                           -- anon / service_role: neatinse
  END IF;
  v_uid := public.fn_identitate_uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = v_uid AND j.restaurat_la IS NULL)
     OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND u.banned_until > now()) THEN
    RAISE EXCEPTION 'Contul a fost închis: accesul e revocat' USING ERRCODE = '42501';
  END IF;
  v_sess := public.fn_identitate_sesiune();
  IF v_sess ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = v_sess::uuid) THEN
    RAISE EXCEPTION 'Sesiunea a fost revocată' USING ERRCODE = '42501';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_pgrst_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pgrst_pre_request() TO anon, authenticated, service_role;

-- B.6 Restaurarea din jurnal — EXCLUSIV owner, cu previzualizare -----------------
-- Nimic nu se redă automat (reactivarea doar anunță). Ordinea lock-urilor = cea din fn_cont_inchide
-- (profil, apoi jurnal, apoi coada), ca o închidere concurentă să nu lase jurnalul „restaurat” pe un cont banat
-- (audit B #7b) și ca sweep-ul să nu intre în deadlock cu restaurarea (runda 3: sweep-ul ia și el profilul întâi).
-- După restaurare, contul NU se re-închide automat decât la o plecare nouă sau manual (fn_cont_restaurare_activa, X3).
-- p_simulare = true: întoarce ce s-ar reface (module, șantiere, flaguri, ban), fără nicio scriere.
-- (01.10.2026, gate 0e r8) UPDATE-ul dinamic al flagurilor la restaurare stă într-o funcție INTERNĂ (fără EXECUTE pentru
-- anon/authenticated/service_role): fn_cont_restaureaza e expusă (authenticated) și nu mai conține EXECUTE dinamic.
-- Cheile se refiltrează aici pe fn_cont_flaguri() (lista albă) — un apelant intern nu poate seta alte coloane.
CREATE OR REPLACE FUNCTION public.fn_cont_restaureaza_flaguri(p_profile_id uuid, p_flaguri jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_set text;
BEGIN
  SELECT string_agg(format('%I = ($1 ->> %L)::boolean', k, k), ', ') INTO v_set
    FROM jsonb_object_keys(COALESCE(p_flaguri, '{}'::jsonb)) k
   WHERE k = ANY (public.fn_cont_flaguri());
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE public.profiles SET %s WHERE id = $2', v_set) USING p_flaguri, p_profile_id;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_restaureaza_flaguri(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_cont_restaureaza(bigint, text);
CREATE OR REPLACE FUNCTION public.fn_cont_restaureaza(p_jurnal_id bigint, p_nota text, p_simulare boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid     uuid;
  v_pid     uuid;
  v_j       public.conturi_inchideri_jurnal%ROWTYPE;
  v_el      jsonb;
  v_refacut text[] := '{}';
  v_sarit   text[] := '{}';
  v_s_ok    integer[] := '{}';
  v_s_sarit integer[] := '{}';
  v_fl      jsonb;
  v_sim     boolean := COALESCE(p_simulare, false);
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate restaura un cont închis' USING ERRCODE = '42501';
  END IF;
  v_uid := public.fn_identitate_uid();
  IF NOT v_sim AND (p_nota IS NULL OR length(btrim(p_nota)) < 5) THEN
    RAISE EXCEPTION 'Nota restaurării e obligatorie (minim 5 caractere)' USING ERRCODE = '22023';
  END IF;
  SELECT j.profile_id INTO v_pid FROM public.conturi_inchideri_jurnal j WHERE j.id = p_jurnal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Închiderea #% nu există în jurnal', p_jurnal_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = v_pid FOR UPDATE;                  -- 1) profilul
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profilul % nu mai există; nu am ce restaura', v_pid USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_j FROM public.conturi_inchideri_jurnal WHERE id = p_jurnal_id FOR UPDATE;   -- 2) jurnalul
  IF v_j.restaurat_la IS NOT NULL THEN
    RAISE EXCEPTION 'Închiderea #% a fost deja restaurată la %', p_jurnal_id, v_j.restaurat_la USING ERRCODE = '22023';
  END IF;
  -- Forma snapshot-ului (B.2): altfel o restaurare „reușită” ar pierde flagurile/șantierele și ar marca
  -- definitiv jurnalul ca restaurat (ex. un import manual cu forma {profile:{…}, module:[…]}).
  IF (v_j.snapshot ->> 'versiune') IS DISTINCT FROM '1'
     OR jsonb_typeof(v_j.snapshot -> 'flaguri') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_j.snapshot -> 'module') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_j.snapshot -> 'santiere') IS DISTINCT FROM 'array'
     OR NOT (v_j.snapshot ? 'banned_until') THEN
    RAISE EXCEPTION 'Snapshot-ul închiderii #% nu are forma așteptată (versiune 1: flaguri{}, module[], santiere[], banned_until); nu restaurez', p_jurnal_id
      USING ERRCODE = '22023', HINT = 'Corectează importul (G.7) — jurnalul NU a fost marcat restaurat.';
  END IF;

  -- Module (doar cele care mai există în app_modules)
  FOR v_el IN SELECT e FROM jsonb_array_elements(COALESCE(v_j.snapshot -> 'module', '[]'::jsonb)) e LOOP
    IF EXISTS (SELECT 1 FROM public.app_modules WHERE key = v_el ->> 'module') THEN
      IF NOT v_sim THEN
        INSERT INTO public.user_module_access (profile_id, module, access_level, granted_at, granted_by)
        VALUES (v_j.profile_id, v_el ->> 'module', v_el ->> 'access_level', now(), v_uid)
        ON CONFLICT (profile_id, module) DO NOTHING;
      END IF;
      v_refacut := v_refacut || (v_el ->> 'module');
    ELSE
      v_sarit := v_sarit || (v_el ->> 'module');
    END IF;
  END LOOP;

  -- Șantiere (doar cele care mai există)
  FOR v_el IN SELECT e FROM jsonb_array_elements(COALESCE(v_j.snapshot -> 'santiere', '[]'::jsonb)) e LOOP
    IF EXISTS (SELECT 1 FROM public.sites WHERE id = (v_el ->> 'site_id')::integer) THEN
      IF NOT v_sim THEN
        INSERT INTO public.profile_sites (profile_id, site_id, valid_until, granted_by, note)
        VALUES (v_j.profile_id, (v_el ->> 'site_id')::integer, (v_el ->> 'valid_until')::date, v_uid, v_el ->> 'note')
        ON CONFLICT (profile_id, site_id) DO NOTHING;
      END IF;
      v_s_ok := v_s_ok || (v_el ->> 'site_id')::integer;
    ELSE
      v_s_sarit := v_s_sarit || (v_el ->> 'site_id')::integer;
    END IF;
  END LOOP;

  -- Flaguri: doar cheile care sunt și azi în fn_cont_flaguri(). Apelantul e owner (identitate explicită) →
  -- S-A, protecția și triggerele owner-only permit.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_fl
    FROM jsonb_each(COALESCE(v_j.snapshot -> 'flaguri', '{}'::jsonb)) f
   WHERE f.key = ANY (public.fn_cont_flaguri());

  IF v_sim THEN
    RETURN jsonb_build_object('simulare', true, 'jurnal_id', p_jurnal_id, 'profile_id', v_j.profile_id,
      'module_refacute', to_jsonb(v_refacut), 'module_sarite', to_jsonb(v_sarit),
      'santiere', to_jsonb(v_s_ok), 'santiere_sarite', to_jsonb(v_s_sarit), 'flaguri', v_fl,
      'banned_until', v_j.snapshot -> 'banned_until');
  END IF;

  PERFORM public.fn_cont_restaureaza_flaguri(v_j.profile_id, v_fl);

  -- Logarea: banned_until revine la valoarea din snapshot (de regulă NULL). Sesiunile nu se refac.
  UPDATE auth.users SET banned_until = (v_j.snapshot ->> 'banned_until')::timestamptz WHERE id = v_j.profile_id;

  UPDATE public.conturi_inchideri_jurnal
     SET restaurat_de = v_uid, restaurat_la = now(), restaurare_nota = btrim(p_nota)
   WHERE id = p_jurnal_id;
  -- Decizia owner-ului e respectată: nimic din coadă nu mai re-închide / re-resetează contul.
  UPDATE public.conturi_inchideri_coada SET rezolvat_la = now(), rezultat = 'anulat_restaurat'
   WHERE profile_id = v_j.profile_id AND rezolvat_la IS NULL;

  RETURN jsonb_build_object('simulare', false, 'jurnal_id', p_jurnal_id, 'profile_id', v_j.profile_id,
    'module_refacute', to_jsonb(v_refacut), 'module_sarite', to_jsonb(v_sarit),
    'santiere', to_jsonb(v_s_ok), 'santiere_sarite', to_jsonb(v_s_sarit), 'flaguri', v_fl);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_restaureaza(bigint, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_restaureaza(bigint, text, boolean) TO authenticated;

-- B.7 Starea contului pentru fișa HR (și coloana „Stare” din Admin → Manageri) ------
-- Owner / can_modify_employees / can_access_personal_data; ceilalți primesc 0 rânduri (fără eroare).
-- Owner-ul primește TOATE conturile (inclusiv nelegate), ca „blocat” (ban fără jurnal) să apară și în Manageri.
-- Runda 3 (P1g): un cont REVOCAT (închidere deschisă / ban activ), cu JWT-ul și flagurile încă valabile, primește 0 rânduri.
CREATE OR REPLACE FUNCTION public.fn_cont_stare_angajati()
RETURNS TABLE(employee_id integer, profile_id uuid, email text, stare text, inchis_la timestamptz, jurnal_id bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := public.fn_identitate_uid();
  v_owner boolean := public.fn_identitate_privilegiata() IS NOT DISTINCT FROM 'owner';
BEGIN
  IF v_uid IS NULL OR public.fn_identitate_revocata(v_uid) OR NOT EXISTS (
       SELECT 1 FROM public.profiles pr WHERE pr.id = v_uid
          AND (pr.is_owner IS TRUE OR pr.can_modify_employees IS TRUE OR pr.can_access_personal_data IS TRUE)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.employee_id::integer, p.id, p.email,
         CASE WHEN j.id IS NOT NULL THEN 'inchis'
              WHEN u.banned_until IS NOT NULL AND u.banned_until > now() THEN 'blocat'
              ELSE 'activ' END,
         j.facut_la, j.id
    FROM public.profiles p
    LEFT JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.employee_id IS NOT NULL OR v_owner
   ORDER BY p.employee_id NULLS LAST, p.id;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_stare_angajati() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_stare_angajati() TO authenticated;

-- B.8 Alerta extinsă (aceeași semnătură, aceeași poartă owner) --------------------
-- cont_activ_fost_angajat primește în `alocari` motivul pentru care contul NU s-a închis automat:
-- {"motiv_neinchis": owner | tip_cont | fara_data | data_viitoare | cnp_lipsa | alt_contract_activ |
--   posibil_alt_contract | esuat_abandonat | in_coada | restaurat | esuat_sau_neprins, "alt_contract": <id>,
--   "coada": {tip, incercari, ultima_eroare, scadent_la, urmatoarea_incercare_la, abandonat_la},
--   "restaurat": {jurnal_id, restaurat_la}}.
-- Runda 3: CNP-ul din AMBELE surse (fn_cont_persoana_cnp); „posibil_alt_contract” (fișă activă fără CNP, același nume
-- de familie / email); „restaurat” în locul lui „esuat_sau_neprins” pentru un cont restaurat de owner (X3);
-- „esuat_abandonat” când coada s-a oprit după limita de încercări (X6).
-- inchis_cu_acces_rest arată și dacă flagurile sunt încă în coadă (calea HR, ≤ 5 min) sau dacă resetarea lor s-a oprit.
-- fara_angajat: marcajele de identitate ale contului, ca în c (P12b).
CREATE OR REPLACE FUNCTION public.fn_admin_conturi_alerte()
RETURNS TABLE(id text, cod text, profile_id uuid, email text, tip_cont text, is_owner boolean,
              employee_id integer, employee_name text, employee_active boolean, termination_date date,
              banned_until timestamptz, jurnal_id bigint, inchis_la timestamptz,
              candidati jsonb, alocari jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_flaguri text[] := public.fn_cont_flaguri();
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Alertele de conturi sunt doar pentru owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH pr AS (
    SELECT p.id AS pid, COALESCE(u.email::text, p.email) AS pemail, u.email::text AS uemail, p.tip_cont AS ptip, p.is_owner AS powner,
           p.employee_id::integer AS emp, e.id AS eid, e.name AS enume, e.active AS eactiv, e.termination_date AS etd,
           public.fn_cont_persoana_cnp(e.id) AS ecnp,
           u.banned_until AS ban, j.id AS jid, j.facut_la AS jla, to_jsonb(p) AS pj,
           NULLIF(jsonb_strip_nulls(jsonb_build_object(
             'email_diferit', CASE WHEN lower(btrim(COALESCE(p.email, ''))) <> lower(btrim(COALESCE(u.email::text, ''))) THEN true END,
             'email_profil', CASE WHEN lower(btrim(COALESCE(p.email, ''))) <> lower(btrim(COALESCE(u.email::text, ''))) THEN p.email END,
             'email_neconfirmat', CASE WHEN u.id IS NOT NULL AND u.email_confirmed_at IS NULL THEN true END)), '{}'::jsonb) AS marcaje
      FROM public.profiles p
      LEFT JOIN public.employees e ON e.id = p.employee_id
      LEFT JOIN auth.users u ON u.id = p.id
      LEFT JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
  ),
  aloc AS (
    SELECT pr.pid, jsonb_strip_nulls(jsonb_build_object(
      'comenzi_aprobatori',   NULLIF((SELECT count(*) FROM public.comenzi_aprobatori x WHERE x.profile_id = pr.pid AND x.activ), 0),
      'necesar_responsabili', NULLIF((SELECT count(*) FROM public.necesar_responsabili x WHERE x.profile_id = pr.pid AND x.activ), 0),
      'hr_aprobatori',        NULLIF((SELECT count(*) FROM public.hr_aprobatori x WHERE x.profile_id = pr.pid AND x.activ), 0),
      'marketing_aprobatori', NULLIF((SELECT count(*) FROM public.marketing_aprobatori x WHERE x.profile_id = pr.pid), 0),
      'hr_concediu_rute',     NULLIF((SELECT count(*) FROM public.hr_concediu_rute x WHERE x.aprobator_profile_id = pr.pid), 0),
      'tichete_default_responsabili', NULLIF((SELECT count(*) FROM public.tichete_default_responsabili x WHERE x.profile_id = pr.pid), 0),
      'hr_recrutare_pozitii', NULLIF((SELECT count(*) FROM public.hr_recrutare_pozitii x
                                       WHERE x.responsabil_id = pr.pid AND x.activ IS TRUE AND x.deleted_at IS NULL), 0)
    )) AS alocari
      FROM pr WHERE pr.jid IS NOT NULL
  ),
  toate AS (
    -- fara_angajat
    SELECT 'fara_angajat'::text AS cod, pr.pid, pr.pemail, pr.ptip, pr.powner, NULL::integer AS emp, NULL::text AS enume,
           NULL::boolean AS eactiv, NULL::date AS etd, pr.ban, NULL::bigint AS jid, NULL::timestamptz AS jla,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id', c.employee_id, 'employee_name', c.employee_name,
                                                         'metoda', c.metoda, 'profil_legat', c.profil_legat)
                                      ORDER BY c.employee_id)
                       FROM public.fn_cont_candidati_angajat(pr.uemail) c), '[]'::jsonb) AS candidati,
           pr.marcaje AS alocari
      FROM pr WHERE pr.emp IS NULL AND COALESCE(pr.ptip, 'angajat') = 'angajat'
    UNION ALL
    -- cont_activ_fost_angajat: legat de o fișă inactivă, fără închidere, nebanat (+ motivul)
    SELECT 'cont_activ_fost_angajat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, NULL::bigint, NULL::timestamptz, NULL::jsonb,
           jsonb_strip_nulls(jsonb_build_object(
             'motiv_neinchis', CASE
                WHEN pr.powner THEN 'owner'
                WHEN COALESCE(pr.ptip, 'angajat') <> 'angajat' THEN 'tip_cont'
                WHEN pr.etd IS NULL THEN 'fara_data'
                WHEN pr.etd > CURRENT_DATE THEN 'data_viitoare'
                WHEN cardinality(pr.ecnp) = 0 THEN 'cnp_lipsa'
                WHEN alt.id IS NOT NULL THEN 'alt_contract_activ'
                WHEN pos.id IS NOT NULL THEN 'posibil_alt_contract'
                WHEN cq.id IS NOT NULL AND cq.abandonat_la IS NOT NULL THEN 'esuat_abandonat'
                WHEN cq.id IS NOT NULL THEN 'in_coada'
                WHEN rest.id IS NOT NULL THEN 'restaurat'
                ELSE 'esuat_sau_neprins' END,
             'alt_contract', COALESCE(alt.id, pos.id),
             'coada', CASE WHEN cq.id IS NOT NULL THEN jsonb_build_object('tip', cq.tip, 'incercari', cq.incercari,
                                                                          'ultima_eroare', cq.ultima_eroare, 'scadent_la', cq.scadent_la,
                                                                          'urmatoarea_incercare_la', cq.urmatoarea_incercare_la,
                                                                          'abandonat_la', cq.abandonat_la) END,
             'restaurat', CASE WHEN rest.id IS NOT NULL THEN jsonb_build_object('jurnal_id', rest.id, 'restaurat_la', rest.restaurat_la) END))
      FROM pr
      LEFT JOIN LATERAL (SELECT public.fn_cont_alt_contract_activ(pr.eid, pr.ecnp) AS id) alt ON true
      LEFT JOIN LATERAL (SELECT public.fn_cont_posibil_aceeasi_persoana(pr.eid) AS id) pos ON true
      LEFT JOIN LATERAL (SELECT q.* FROM public.conturi_inchideri_coada q
                          WHERE q.profile_id = pr.pid AND q.rezolvat_la IS NULL AND q.tip IN ('reincercare', 'programata')
                          ORDER BY q.id LIMIT 1) cq ON true
      LEFT JOIN LATERAL (SELECT j2.id, j2.restaurat_la FROM public.conturi_inchideri_jurnal j2
                          WHERE j2.id = public.fn_cont_restaurare_activa(pr.pid)) rest ON true
     WHERE pr.eid IS NOT NULL AND pr.eactiv IS NOT TRUE AND pr.jid IS NULL
       AND (pr.ban IS NULL OR pr.ban < now())
    UNION ALL
    -- inchis_dar_deblocat
    SELECT 'inchis_dar_deblocat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb, NULL::jsonb
      FROM pr WHERE pr.jid IS NOT NULL AND (pr.ban IS NULL OR pr.ban < now())
    UNION ALL
    -- inchis_cu_acces_rest
    SELECT 'inchis_cu_acces_rest', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb,
           jsonb_build_object(
             'module', (SELECT count(*) FROM public.user_module_access m WHERE m.profile_id = pr.pid),
             'santiere', (SELECT count(*) FROM public.profile_sites s WHERE s.profile_id = pr.pid),
             'flaguri', (SELECT COALESCE(jsonb_agg(f.key ORDER BY f.key), '[]'::jsonb) FROM jsonb_each(pr.pj) f
                          WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb),
             'flaguri_in_coada', EXISTS (SELECT 1 FROM public.conturi_inchideri_coada q
                                          WHERE q.profile_id = pr.pid AND q.tip = 'flaguri' AND q.rezolvat_la IS NULL),
             'flaguri_abandonate', EXISTS (SELECT 1 FROM public.conturi_inchideri_coada q
                                            WHERE q.profile_id = pr.pid AND q.tip = 'flaguri' AND q.rezolvat_la IS NULL
                                              AND q.abandonat_la IS NOT NULL))
      FROM pr WHERE pr.jid IS NOT NULL
                AND (EXISTS (SELECT 1 FROM public.user_module_access m WHERE m.profile_id = pr.pid)
                  OR EXISTS (SELECT 1 FROM public.profile_sites s WHERE s.profile_id = pr.pid)
                  OR EXISTS (SELECT 1 FROM jsonb_each(pr.pj) f WHERE f.key = ANY (v_flaguri) AND f.value = 'true'::jsonb))
    UNION ALL
    -- reactivat_acces_neredat
    SELECT 'reactivat_acces_neredat', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb, NULL::jsonb
      FROM pr WHERE pr.jid IS NOT NULL AND pr.eactiv IS TRUE
    UNION ALL
    -- alocari_ramase (doar alertă — D3 varianta A)
    SELECT 'alocari_ramase', pr.pid, pr.pemail, pr.ptip, pr.powner, pr.emp, pr.enume, pr.eactiv, pr.etd,
           pr.ban, pr.jid, pr.jla, NULL::jsonb, a.alocari
      FROM pr JOIN aloc a ON a.pid = pr.pid WHERE a.alocari <> '{}'::jsonb
    UNION ALL
    -- inactiv_fara_data: fișe inactive fără dată de încetare (cu sau fără cont)
    SELECT 'inactiv_fara_data', p.id, COALESCE(u.email::text, p.email), p.tip_cont, p.is_owner, e.id, e.name, e.active, e.termination_date,
           u.banned_until, j.id, j.facut_la, NULL::jsonb, NULL::jsonb
      FROM public.employees e
      LEFT JOIN public.profiles p ON p.employee_id = e.id
      LEFT JOIN auth.users u ON u.id = p.id
      LEFT JOIN public.conturi_inchideri_jurnal j ON j.profile_id = p.id AND j.restaurat_la IS NULL
     WHERE e.active IS FALSE AND e.termination_date IS NULL
  )
  SELECT t.cod || ':' || COALESCE(t.pid::text, 'e' || t.emp::text), t.cod, t.pid, t.pemail, t.ptip, t.powner,
         t.emp, t.enume, t.eactiv, t.etd, t.ban, t.jid, t.jla, t.candidati, t.alocari
    FROM toate t
   ORDER BY 1;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_admin_conturi_alerte() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_conturi_alerte() TO authenticated;

-- ── Postcondiții (adăugate 01.10.2026 pentru runner) — orice abatere anulează tot ──────────
DO $post_livrare$
DECLARE v_n integer; v_lipsa text[];
BEGIN
  -- funcțiile migrării există; cele SECURITY DEFINER au search_path fixat; niciuna executabilă de anon (excepții explicite)
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_admin_conturi_alerte','fn_cont_alt_contract_activ','fn_cont_cnp_normalizat','fn_cont_coada_pune','fn_cont_flaguri','fn_cont_garda_persoana','fn_cont_inchide','fn_cont_inchide_owner','fn_cont_lock_chei','fn_cont_lock_persoana','fn_cont_motiv_garda','fn_cont_persoana_chei','fn_cont_persoana_cnp','fn_cont_posibil_aceeasi_persoana','fn_cont_restaurare_activa','fn_cont_restaureaza','fn_cont_revocat_nu_scrie','fn_cont_stare_angajati','fn_conturi_inchideri_append_only','fn_conturi_inchideri_sweep','fn_employees_ciclu_cont','fn_employees_persoana_lock','fn_hr_employees_private_persoana_lock','fn_pgrst_pre_request']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții lipsă după migrare: %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_alt_contract_activ','fn_cont_cnp_normalizat','fn_cont_coada_pune','fn_cont_flaguri','fn_cont_garda_persoana','fn_cont_inchide','fn_cont_inchide_owner','fn_cont_lock_chei','fn_cont_lock_persoana','fn_cont_motiv_garda','fn_cont_persoana_chei','fn_cont_persoana_cnp','fn_cont_posibil_aceeasi_persoana','fn_cont_restaurare_activa','fn_cont_restaureaza','fn_cont_revocat_nu_scrie','fn_cont_stare_angajati','fn_conturi_inchideri_append_only','fn_conturi_inchideri_sweep','fn_employees_ciclu_cont','fn_employees_persoana_lock','fn_hr_employees_private_persoana_lock','fn_pgrst_pre_request']::text[]) AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c WHERE c LIKE 'search_path=%');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: SECURITY DEFINER fără search_path: %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY(ARRAY['fn_admin_conturi_alerte','fn_cont_alt_contract_activ','fn_cont_cnp_normalizat','fn_cont_coada_pune','fn_cont_flaguri','fn_cont_garda_persoana','fn_cont_inchide','fn_cont_inchide_owner','fn_cont_lock_chei','fn_cont_lock_persoana','fn_cont_motiv_garda','fn_cont_persoana_chei','fn_cont_persoana_cnp','fn_cont_posibil_aceeasi_persoana','fn_cont_restaurare_activa','fn_cont_restaureaza','fn_cont_revocat_nu_scrie','fn_cont_stare_angajati','fn_conturi_inchideri_append_only','fn_conturi_inchideri_sweep','fn_employees_ciclu_cont','fn_employees_persoana_lock','fn_hr_employees_private_persoana_lock','fn_pgrst_pre_request']::text[])
     AND p.proname <> ALL(ARRAY['fn_pgrst_pre_request']::text[]) AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
  -- tabelele noi: RLS activ, anon fără niciun drept
  SELECT array_agg(t) INTO v_lipsa FROM unnest(ARRAY['conturi_inchideri_jurnal','conturi_inchideri_coada']::text[]) t
   WHERE to_regclass('public.' || t) IS NULL
      OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t))
      OR has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: tabele fără RLS sau cu drepturi pentru anon: %', v_lipsa; END IF;
  -- triggerele cerute există și sunt active
  SELECT array_agg(t.r || '.' || t.n) INTO v_lipsa FROM (VALUES ('conturi_inchideri_jurnal','trg_conturi_inchideri_append_only'),('conturi_inchideri_jurnal','trg_conturi_inchideri_fara_truncate'),('employees','trg_employees_persoana_lock'),('employees','trg_employees_00_cont_revocat'),('employees','trg_employees_zz_ciclu_cont'),('hr_employees_private','trg_hr_employees_private_persoana_lock'),('hr_employees_private','trg_hr_employees_private_00_cont_revocat')) AS t(r, n)
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || t.r) AND g.tgname = t.n AND g.tgenabled <> 'D');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: triggere lipsă/dezactivate: %', v_lipsa; END IF;
  -- hook-ul pre-request e CREAT, dar NU activat (activarea = ALTER ROLE authenticator, acord separat al lui Răzvan)
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'pgrst.db_pre_request=%') THEN
    RAISE EXCEPTION 'Postcondiție: pgrst.db_pre_request e setat — migrarea nu are voie să activeze hook-ul';
  END IF;
  IF to_regnamespace('cron') IS NOT NULL AND to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE jobname = ''conturi_inchideri_coada''' INTO v_n;
    IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Postcondiție: jobul cron conturi_inchideri_coada lipsește (% joburi)', v_n; END IF;
  END IF;
  v_n := 0;
END $post_livrare$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20260929d_conturi_inchidere_la_incetare:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20260929d: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
