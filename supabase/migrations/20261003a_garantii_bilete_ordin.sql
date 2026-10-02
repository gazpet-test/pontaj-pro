-- ════════════════════════════════════════════════════════════════════════════
-- 20261003a_garantii_bilete_ordin — DRAFT, NEAPLICAT (decizia lui Răzvan 02.10.2026 „1B”; claude_context #1544; cererea
--   Marilenei Tudorache). Biletele la ordin (BO) date de Gazpet ca GARANȚIE la polițele de asigurare (nu plata primei),
--   urmărite până la restituire. UI: Financiar → 🏛 Registru garanții → „🧾 BO (n)” (GarantiiBileteOrdin.jsx).
-- Ce face (4 lucruri, nimic altceva):
--   1. tabela public.garantii_bilete_ordin, legată de rândul poliței din public.garantii (FK ON DELETE RESTRICT):
--      serie, număr, sumă (> 0), monedă (RON/EUR), emitere, scadență (≥ emitere), stare emis/restituit/executat,
--      restituit_la (obligatorie DOAR la „restituit”), document_path (scan în bucketul privat documente-firma), observații.
--      Unic pe (coalesce(serie,''), numar) — garantii_bo_serie_numar_uidx (UI-ul traduce eroarea 23505 după acest nume).
--      Trigger updated_at cu helper-ul existent public.set_updated_at().
--   2. RLS: SELECT pentru orice cont logat (ca garantii_rls_sel); INSERT/UPDATE/DELETE cu aceeași poartă ca garantii
--      (public.fn_poate_scrie_garantii(), 20261005b — live). ACL exact: authenticated/service_role S/I/U/D (secvența:
--      USAGE/SELECT); anon și PUBLIC nimic; fără TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (în linie cu F1/F1b, 20261006a).
--   3. public.garantii_alerte() (cronul garantii_alerte_0645): corpul live (md5 fd35c645…, citit read-only 02.10.2026)
--      + un bloc nou la coadă, după bucla existentă: bo_scadent (emis, scadența în 0..14 zile) și bo_expirat (emis,
--      scadența depășită). Amprente în garantii_alerte_amprenta (garantii_alerte_amprenta_pkey = garantie_id, fel).
--      ACL-ul, SECDEF, search_path, semnătura: neschimbate (CREATE OR REPLACE). Modul notificări: 'Financiar'.
--   4. REPARAȚIE în blocul vechi (varianta A aleasă de Răzvan, 02.10.2026) — 2 buguri latente PREEXISTENTE care opreau
--      TOATĂ execuția garantii_alerte() (deci și alertele BO) în ziua în care o garanție intra pe o ramură veche:
--      a) modul = 'financiar' → 'Financiar' (notifications_modul_check acceptă doar 'Financiar');
--      b) ON CONFLICT (garantie_id, fel) → ON CONFLICT ON CONSTRAINT garantii_alerte_amprenta_pkey (lista de coloane se
--         ciocnea cu coloanele OUT ale funcției ⇒ „column reference garantie_id is ambiguous”).
--      Nimic altceva din blocul vechi nu se schimbă — postcondiția 3 o dovedește în BD: inversând exact cele 2 înlocuiri pe
--      partea veche a corpului nou se obține corpul vechi (md5 9ccb8ff8… = corpul fd35c645… fără „END;” final).
--      Efect la livrare (citit read-only pe live 02.10.2026): 0 garanții active pe ramurile vechi ⇒ nicio notificare
--      „în rafală”; ramurile vechi încep să notifice abia când o garanție intră pe ele (recepție bifată / expirare ≤ 60 z).
-- Fișa de securitate a alertei: (a) nu citește conținut extern (doar tabele interne); (b) scrie doar notifications (către
--   owneri; după reparație și pentru ramurile vechi) și garantii_alerte_amprenta; nu trimite mail, nu atinge bani/drepturi; (c) SECURITY DEFINER (owner postgres),
--   rulată de cron ca postgres; (d) EXECUTE doar postgres/service_role (neschimbat) — pornită doar de cronul
--   garantii_alerte_0645; (e) fără confirmare (doar notificări interne, idempotent prin amprente).
-- Precondiții (fail-closed): postgres; tabela nu există; garantii (coloane md5 0cd06900…), fn_poate_scrie_garantii
--   (md5 e8ee20a0…, SECDEF), set_updated_at (md5 1c4318be…) — ca pe live; garantii_alerte() unică, corp md5 fd35c645…,
--   SECDEF, search_path, ACL postgres+service_role; PK amprentelor = (garantie_id, fel); 'Financiar' permis de CHECK.
-- Postcondiții: tabela cu RLS, exact 4 politici, anon/PUBLIC fără drepturi (tabelă + secvență), ACL exact (authenticated și
--   service_role: tabela S/I/U/D, secvența USAGE/SELECT — fără TRUNCATE/REFERENCES/TRIGGER/MAINTAIN);
--   garantii_alerte() cu md5-ul nou; partea veche = corpul vechi + EXACT cele 2 reparații (verificat prin inversare);
--   tiparele vechi ('financiar', ON CONFLICT pe coloane) absente; ACL și atribute neschimbate.
-- Revenire (NU e migrare): supabase/revenire/20261003a_garantii_bilete_ordin_ROLLBACK.sql (refuză dacă tabela are rânduri;
--   readuce corpul vechi EXACT — deci reintroduce și cele 2 buguri; e revenire, nu reparație).
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid); fără BEGIN/COMMIT.
-- Test local: bash scripts/test_garantii_bilete_ordin.sh
-- ════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003a_garantii_bilete_ordin:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003a: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

DO $pre$
DECLARE v_n integer; v_s text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user; END IF;
  -- 0b. tabela nouă nu există (reaplicare = refuz)
  IF to_regclass('public.garantii_bilete_ordin') IS NOT NULL OR to_regclass('public.garantii_bilete_ordin_id_seq') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondiție 0b: garantii_bilete_ordin (sau secvența ei) există deja — reaplicare sau coliziune de nume';
  END IF;
  -- 0c. garantii exact ca pe live (coloane), id bigint
  IF (SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM '0cd06900cf48a7501cc00a57f9a24264' THEN
    RAISE EXCEPTION 'Precondiție 0c: coloanele public.garantii ≠ starea live din 02.10 (md5 0cd06900…)';
  END IF;
  -- 0d. poarta de scriere (20261005b) și helper-ul updated_at, exact
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.proname = 'fn_poate_scrie_garantii';
  IF v_n <> 1 OR (SELECT md5(prosrc) || '|' || prosecdef::text || '|' || provolatile::text FROM pg_proc WHERE oid = to_regprocedure('public.fn_poate_scrie_garantii()'))
       IS DISTINCT FROM 'e8ee20a08440f3c93c763e4bff0670cf|true|s' THEN
    RAISE EXCEPTION 'Precondiție 0d: public.fn_poate_scrie_garantii() lipsește/e dublată sau ≠ live (md5 e8ee20a0…, SECDEF, STABLE)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.set_updated_at()')) IS DISTINCT FROM '1c4318bee4240d4113d86fad7eb15623' THEN
    RAISE EXCEPTION 'Precondiție 0d: public.set_updated_at() lipsește sau ≠ live (md5 1c4318be…)';
  END IF;
  -- 0e. garantii_alerte(): unică (în orice schemă), corpul live exact, atribute și ACL
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'garantii_alerte';
  IF v_n <> 1 OR to_regprocedure('public.garantii_alerte()') IS NULL THEN
    RAISE EXCEPTION 'Precondiție 0e: garantii_alerte trebuie să existe o singură dată, ca public.garantii_alerte() (găsite %)', v_n;
  END IF;
  SELECT md5(p.prosrc) INTO v_s FROM pg_proc p WHERE p.oid = 'public.garantii_alerte()'::regprocedure;
  IF v_s IS DISTINCT FROM 'fd35c645075cfb6ba7956529e0d85486' THEN
    RAISE EXCEPTION 'Precondiție 0e: corpul garantii_alerte() ≠ live din 02.10 (md5 % ≠ fd35c645…) — se reanalizează', v_s;
  END IF;
  IF NOT (SELECT p.prosecdef AND l.lanname = 'plpgsql' AND pg_get_userbyid(p.proowner) = 'postgres'
                 AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
                 AND pg_get_function_result(p.oid) = 'TABLE(fel text, garantie_id bigint, mesaj text)'
            FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.garantii_alerte()'::regprocedure)
     OR (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text)
           FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.garantii_alerte()'::regprocedure AND x.grantee <> 0)
        IS DISTINCT FROM 'postgres:EXECUTE,service_role:EXECUTE'
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.garantii_alerte()'::regprocedure AND x.grantee = 0) THEN
    RAISE EXCEPTION 'Precondiție 0e: garantii_alerte() — atribute (SECDEF, plpgsql, postgres, search_path, semnătură) sau ACL (doar postgres/service_role) ≠ live';
  END IF;
  -- 0f. amprentele: PK (garantie_id, fel) — blocul nou folosește ON CONFLICT ON CONSTRAINT garantii_alerte_amprenta_pkey
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.garantii_alerte_amprenta'::regclass AND conname = 'garantii_alerte_amprenta_pkey')
     IS DISTINCT FROM 'PRIMARY KEY (garantie_id, fel)' THEN
    RAISE EXCEPTION 'Precondiție 0f: garantii_alerte_amprenta_pkey ≠ PRIMARY KEY (garantie_id, fel)';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute WHERE attrelid = 'public.garantii_alerte_amprenta'::regclass AND NOT attisdropped
     AND attname IN ('garantie_id', 'fel', 'amprenta', 'trimis_la');
  IF v_n <> 4 THEN RAISE EXCEPTION 'Precondiție 0f: lipsesc coloane din garantii_alerte_amprenta (găsite %/4)', v_n; END IF;
  -- 0g. modulul notificărilor: 'Financiar' trebuie permis de notifications_modul_check
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_modul_check') NOT LIKE '%''Financiar''::text%' THEN
    RAISE EXCEPTION 'Precondiție 0g: notifications_modul_check nu permite modul = Financiar';
  END IF;
END $pre$;

-- 1. tabela
CREATE TABLE public.garantii_bilete_ordin (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  garantie_id   bigint NOT NULL REFERENCES public.garantii(id) ON DELETE RESTRICT,
  serie         text,
  numar         text NOT NULL CHECK (btrim(numar) <> ''),
  suma          numeric(14,2) NOT NULL CHECK (suma > 0),
  moneda        text NOT NULL DEFAULT 'RON' CHECK (moneda IN ('RON', 'EUR')),
  data_emitere  date NOT NULL,
  data_scadenta date,
  stare         text NOT NULL DEFAULT 'emis' CHECK (stare IN ('emis', 'restituit', 'executat')),
  restituit_la  date,
  document_path text,
  observatii    text,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT garantii_bo_scadenta_check CHECK (data_scadenta IS NULL OR data_scadenta >= data_emitere),
  CONSTRAINT garantii_bo_restituit_check CHECK ((stare = 'restituit') = (restituit_la IS NOT NULL)),
  CONSTRAINT garantii_bo_restituit_dupa_emitere_check CHECK (restituit_la IS NULL OR restituit_la >= data_emitere)
);
COMMENT ON TABLE public.garantii_bilete_ordin IS
  'Bilete la ordin date de Gazpet ca GARANȚIE la polițele de asigurare (nu plata primei), urmărite până la restituire; legate de rândul poliței din garantii. 20261003a, #1544.';
CREATE INDEX garantii_bo_garantie_idx ON public.garantii_bilete_ordin (garantie_id);
CREATE INDEX garantii_bo_scadenta_emis_idx ON public.garantii_bilete_ordin (data_scadenta) WHERE stare = 'emis';
CREATE UNIQUE INDEX garantii_bo_serie_numar_uidx ON public.garantii_bilete_ordin (coalesce(serie, ''), numar);
CREATE TRIGGER garantii_bo_set_updated_at BEFORE UPDATE ON public.garantii_bilete_ordin
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. ACL + RLS (scrierea: aceeași poartă ca garantii, 20261005b)
-- Setarea implicită a lui postgres pe public dă anon/authenticated arwdxt (tabele) și rwU (secvențe) ⇒ se retrage TOT și se
-- acordă exact: tabela S/I/U/D, secvența USAGE/SELECT (fără TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, fără setval).
REVOKE ALL ON TABLE public.garantii_bilete_ordin FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.garantii_bilete_ordin_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.garantii_bilete_ordin TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.garantii_bilete_ordin_id_seq TO authenticated, service_role;
ALTER TABLE public.garantii_bilete_ordin ENABLE ROW LEVEL SECURITY;
CREATE POLICY garantii_bo_rls_sel ON public.garantii_bilete_ordin AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() IS NOT NULL));
CREATE POLICY garantii_bo_rls_ins ON public.garantii_bilete_ordin AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_bo_rls_upd ON public.garantii_bilete_ordin AS PERMISSIVE FOR UPDATE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii())) WITH CHECK ((SELECT public.fn_poate_scrie_garantii()));
CREATE POLICY garantii_bo_rls_del ON public.garantii_bilete_ordin AS PERMISSIVE FOR DELETE TO authenticated USING ((SELECT public.fn_poate_scrie_garantii()));

-- 3+4. garantii_alerte(): corpul live cu EXACT 2 reparații (modul 'Financiar'; ON CONFLICT ON CONSTRAINT) + blocul 4
--      (bilete la ordin) la coadă
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
    SELECT p.id, 'warning', 'Financiar', v_titlu, v_mesaj, '/financiar/garantii'  -- 20261003a: era 'financiar', respins de notifications_modul_check
    FROM public.profiles p WHERE p.is_owner = true;

    INSERT INTO public.garantii_alerte_amprenta (garantie_id, fel, amprenta)
    VALUES (r.id, v_fel, v_amprenta)
    ON CONFLICT ON CONSTRAINT garantii_alerte_amprenta_pkey DO UPDATE SET amprenta = EXCLUDED.amprenta, trimis_la = now();  -- 20261003a: era ON CONFLICT pe coloane, ambiguu cu coloanele OUT

    fel := v_fel; garantie_id := r.id; mesaj := v_mesaj;
    RETURN NEXT;
  END LOOP;

  -- 4. (20261003a, #1544) Bilete la ordin date ca GARANȚIE la polițe (garantii_bilete_ordin), stare 'emis':
  --    bo_scadent = scadența în 0..14 zile, bo_expirat = scadența depășită (biletul tot nerestituit). Un mesaj per poliță
  --    și fel, doar către owneri, modul 'Financiar' (valoare permisă de notifications_modul_check). Amprenta = setul
  --    <id_bilet>:<scadență>; se retrimite DOAR când în set apare un bilet care nu era deja semnalat (restituirea unui
  --    bilet nu produce mesaj). Nu filtrează pe garantii.stare: biletul se urmărește până la restituire, oricare ar fi
  --    starea poliței. Fără conținut extern; scrie doar notifications + garantii_alerte_amprenta.
  DECLARE
    b record;
    v_vechi text[];
  BEGIN
    FOR b IN
      SELECT x.gid, x.fel_bo, min(x.zile) AS zile_min, count(*) AS n,
             array_agg(x.cheie ORDER BY x.cheie) AS chei,
             string_agg(x.eticheta, '; ' ORDER BY x.data_scadenta, x.bo_id) AS lista,
             min(g.numar_document) AS numar_document, min(g.emitent) AS emitent,
             min(coalesce(g.lucrare, g.beneficiar)) AS denumire
      FROM (
        SELECT bo.id AS bo_id, bo.garantie_id AS gid, bo.data_scadenta, (bo.data_scadenta - current_date) AS zile,
               CASE WHEN bo.data_scadenta < current_date THEN 'bo_expirat' ELSE 'bo_scadent' END AS fel_bo,
               bo.id::text || ':' || bo.data_scadenta::text AS cheie,
               concat_ws(' ', bo.serie, bo.numar) || ' (' ||
                 translate(trim(to_char(bo.suma, 'FM999,999,999,990.00')), ',.', '.,') || ' ' || bo.moneda ||
                 ', scadent ' || to_char(bo.data_scadenta, 'DD.MM.YYYY') || ')' AS eticheta
        FROM public.garantii_bilete_ordin bo
        WHERE bo.stare = 'emis' AND bo.data_scadenta IS NOT NULL AND bo.data_scadenta <= current_date + 14
      ) x
      JOIN public.garantii g ON g.id = x.gid
      GROUP BY x.gid, x.fel_bo
      ORDER BY x.gid, x.fel_bo
    LOOP
      SELECT string_to_array(a.amprenta, ',') INTO v_vechi
      FROM public.garantii_alerte_amprenta a WHERE a.garantie_id = b.gid AND a.fel = b.fel_bo;

      IF v_vechi IS NOT NULL AND b.chei <@ v_vechi THEN
        UPDATE public.garantii_alerte_amprenta a SET amprenta = array_to_string(b.chei, ',')
        WHERE a.garantie_id = b.gid AND a.fel = b.fel_bo AND a.amprenta IS DISTINCT FROM array_to_string(b.chei, ',');
        CONTINUE;
      END IF;

      IF b.fel_bo = 'bo_expirat' THEN
        v_titlu := 'Bilet la ordin nerestituit, scadență depășită: ' || coalesce(b.denumire, '—');
        v_mesaj := 'Polița ' || coalesce(b.numar_document, 'fără număr') || coalesce(' (' || b.emitent || ')', '') || ': ' ||
                   b.n || ' bilet(e) la ordin emis(e) ca garanție, cu scadența depășită și încă nerestituit(e) — ' || b.lista ||
                   '. Cere restituirea de la asigurător (sau verifică dacă a fost executat) și actualizează starea în Financiar → Garanții → 🧾 BO.';
      ELSE
        v_titlu := 'Bilet la ordin scadent ' ||
                   CASE b.zile_min WHEN 0 THEN 'azi' WHEN 1 THEN 'în 1 zi' ELSE 'în ' || b.zile_min || ' zile' END ||
                   ': ' || coalesce(b.denumire, '—');
        v_mesaj := 'Polița ' || coalesce(b.numar_document, 'fără număr') || coalesce(' (' || b.emitent || ')', '') || ': ' ||
                   b.n || ' bilet(e) la ordin emis(e) ca garanție, cu scadența în cel mult 14 zile — ' || b.lista ||
                   '. Cere restituirea de la asigurător sau pregătește înlocuirea; după restituire marchează „Restituit” în Financiar → Garanții → 🧾 BO.';
      END IF;

      INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
      SELECT p.id, 'warning', 'Financiar', v_titlu, v_mesaj, '/financiar/garantii'
      FROM public.profiles p WHERE p.is_owner = true;

      INSERT INTO public.garantii_alerte_amprenta AS a (garantie_id, fel, amprenta)
      VALUES (b.gid, b.fel_bo, array_to_string(b.chei, ','))
      ON CONFLICT ON CONSTRAINT garantii_alerte_amprenta_pkey DO UPDATE SET amprenta = EXCLUDED.amprenta, trimis_la = now();

      fel := b.fel_bo; garantie_id := b.gid; mesaj := v_mesaj;
      RETURN NEXT;
    END LOOP;
  END;
END;
$fn$;

DO $post$
DECLARE v_s text;
BEGIN
  -- 1. tabela, RLS, politici
  IF to_regclass('public.garantii_bilete_ordin') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.garantii_bilete_ordin'::regclass) THEN
    RAISE EXCEPTION 'Postcondiție 1: garantii_bilete_ordin lipsește sau fără RLS';
  END IF;
  SELECT string_agg(policyname || ':' || cmd || ':' || permissive || ':' || roles::text, ',' ORDER BY policyname) INTO v_s
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'garantii_bilete_ordin';
  IF v_s IS DISTINCT FROM 'garantii_bo_rls_del:DELETE:PERMISSIVE:{authenticated},garantii_bo_rls_ins:INSERT:PERMISSIVE:{authenticated},garantii_bo_rls_sel:SELECT:PERMISSIVE:{authenticated},garantii_bo_rls_upd:UPDATE:PERMISSIVE:{authenticated}' THEN
    RAISE EXCEPTION 'Postcondiție 1: politicile ≠ cele 4 așteptate (%)', v_s;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'garantii_bilete_ordin' AND cmd <> 'SELECT'
               AND (coalesce(qual, '') !~ 'fn_poate_scrie_garantii' AND coalesce(with_check, '') !~ 'fn_poate_scrie_garantii')) THEN
    RAISE EXCEPTION 'Postcondiție 1: o politică de scriere fără fn_poate_scrie_garantii';
  END IF;
  -- 2. ACL: anon/PUBLIC nimic; authenticated S/I/U/D
  IF has_table_privilege('anon', 'public.garantii_bilete_ordin', 'SELECT') OR has_table_privilege('anon', 'public.garantii_bilete_ordin', 'INSERT')
     OR has_table_privilege('anon', 'public.garantii_bilete_ordin', 'UPDATE') OR has_table_privilege('anon', 'public.garantii_bilete_ordin', 'DELETE')
     OR has_sequence_privilege('anon', 'public.garantii_bilete_ordin_id_seq', 'USAGE') OR has_sequence_privilege('anon', 'public.garantii_bilete_ordin_id_seq', 'UPDATE')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.garantii_bilete_ordin'::regclass, 'public.garantii_bilete_ordin_id_seq'::regclass) AND x.grantee = 0) THEN
    RAISE EXCEPTION 'Postcondiție 2: anon/PUBLIC au drepturi pe garantii_bilete_ordin sau pe secvență';
  END IF;
  SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text, x.privilege_type) INTO v_s
    FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.garantii_bilete_ordin'::regclass AND x.grantee <> 'postgres'::regrole;
  IF v_s IS DISTINCT FROM 'authenticated:DELETE,authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE,service_role:DELETE,service_role:INSERT,service_role:SELECT,service_role:UPDATE' THEN
    RAISE EXCEPTION 'Postcondiție 2: ACL-ul tabelei ≠ exact S/I/U/D pentru authenticated și service_role (%)', v_s;
  END IF;
  SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text, x.privilege_type) INTO v_s
    FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid = 'public.garantii_bilete_ordin_id_seq'::regclass AND x.grantee <> 'postgres'::regrole;
  IF v_s IS DISTINCT FROM 'authenticated:SELECT,authenticated:USAGE,service_role:SELECT,service_role:USAGE' THEN
    RAISE EXCEPTION 'Postcondiție 2: ACL-ul secvenței ≠ exact USAGE/SELECT pentru authenticated și service_role (%)', v_s;
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.garantii_bilete_ordin'::regclass)) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Postcondiție 2: garantii_bilete_ordin nu e a lui postgres';
  END IF;
  -- 3. garantii_alerte(): md5 nou; partea veche = corpul vechi + exact cele 2 reparații; tiparele vechi absente; atribute + ACL
  --    neschimbate; unică
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'garantii_alerte') <> 1 THEN
    RAISE EXCEPTION 'Postcondiție 3: garantii_alerte nu mai e unică';
  END IF;
  SELECT md5(prosrc) INTO v_s FROM pg_proc WHERE oid = 'public.garantii_alerte()'::regprocedure;
  IF v_s IS DISTINCT FROM 'bd170a0f935e7123d85e4000467dd7fd' THEN
    RAISE EXCEPTION 'Postcondiție 3: corpul garantii_alerte() (md5 %) ≠ cel livrat (bd170a0f…)', v_s;
  END IF;
  -- inversând exact cele 2 reparații pe primele 3035 caractere (partea veche) se obține corpul vechi fără „END;” final
  IF (SELECT md5(replace(replace(left(prosrc, 3035),
              'SELECT p.id, ''warning'', ''Financiar'', v_titlu, v_mesaj, ''/financiar/garantii''  -- 20261003a: era ''financiar'', respins de notifications_modul_check',
              'SELECT p.id, ''warning'', ''financiar'', v_titlu, v_mesaj, ''/financiar/garantii'''),
              'ON CONFLICT ON CONSTRAINT garantii_alerte_amprenta_pkey DO UPDATE SET amprenta = EXCLUDED.amprenta, trimis_la = now();  -- 20261003a: era ON CONFLICT pe coloane, ambiguu cu coloanele OUT',
              'ON CONFLICT (garantie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimis_la = now();'))
        FROM pg_proc WHERE oid = 'public.garantii_alerte()'::regprocedure) IS DISTINCT FROM '9ccb8ff8064c8f4c2374a0a5d41b16bc'
     OR (SELECT position('''warning'', ''financiar''' IN prosrc) + position('ON CONFLICT (garantie_id, fel) DO' IN prosrc)
           FROM pg_proc WHERE oid = 'public.garantii_alerte()'::regprocedure) <> 0 THEN
    RAISE EXCEPTION 'Postcondiție 3: partea veche ≠ corpul vechi + exact cele 2 reparații, sau a rămas un tipar vechi (modul financiar / ON CONFLICT pe coloane)';
  END IF;
  IF NOT (SELECT p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
            FROM pg_proc p WHERE p.oid = 'public.garantii_alerte()'::regprocedure)
     OR (SELECT string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text)
           FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = 'public.garantii_alerte()'::regprocedure AND x.grantee <> 0)
        IS DISTINCT FROM 'postgres:EXECUTE,service_role:EXECUTE'
     OR has_function_privilege('anon', 'public.garantii_alerte()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.garantii_alerte()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondiție 3: garantii_alerte() — atribute sau ACL schimbate';
  END IF;
  -- 4. garantii neatinsă
  IF (SELECT md5(string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)) FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM '0cd06900cf48a7501cc00a57f9a24264' THEN
    RAISE EXCEPTION 'Postcondiție 4: coloanele garantii s-au schimbat (nu era în plan)';
  END IF;
  RAISE NOTICE '20261003a după: garantii_alerte md5 %', v_s;
END $post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261003a_garantii_bilete_ordin:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261003a: garda de livrare (final) — marcajul s-a pierdut; se anulează tot';
  END IF;
END $livrare_final$;
