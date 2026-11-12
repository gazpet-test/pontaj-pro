-- ════════════════════════════════════════════════════════════════════════════
-- 20261131e — „❓ Întreabă echipa”: răspunsuri DIN CERCETARE, cu surse (cerere Silviu + Răzvan 06.11.2026).
-- Workerul (worker/intrebari-tehnice/) caută întâi în corpusul intern (docs/cercetare) și pe web DOAR pe domeniile oficiale
-- (listă fixă în cod), apoi răspunde doar din surse; sursele citate se salvează aici, în `surse`, și se afișează sub răspuns.
-- Se adaugă și starea 'de_verificat' (butonul „Răspuns neclar — trimite la verificare”, fără alte efecte) și reluarea la cerere
-- (DOAR ownerul — reluarea costă, „poarta pe cheltuială”; nimic nu se reia automat).
-- Runda 2 (review Jakarinos P1-c / Fable P2): reluarea NU mai ocolește plafonul de 40 de preluări pe zi — plafonul se numără din
-- jurnalul durabil `intrebari_preluari` (un rând la fiecare preluare, niciodată șters de reluare), nu din `preluat_la`, pe care o
-- reluare îl putea goli/suprascrie. Tot în jurnal stă costul fiecărei încercări (`tokeni`) și interogările web trimise.
-- Runda 2 (P1-a): `interogari_web` — interogările EFECTIV trimise la căutarea web (audit, ownerul le vede în ecran).
-- Runda 3 (review r2 P2-5): fn_intrebari_preia blochează întrebările expirate ÎNAINTEA jurnalului lor (aceeași ordine ca
-- fn_intrebari_raspunde / _amana: intrebari_tehnice → intrebari_preluari) — fără deadlock între expirare și un răspuns întârziat.
--
-- FIȘA DE SECURITATE (CLAUDE.md pct. 7) — diferențele față de 20261105a:
--  (a) conținut EXTERN nou: paginile web de pe domeniile oficiale (citite server-side de unealta web search a API-ului) → DATE;
--      speța NU ajunge în apelul cu web search: acolo intră câte O interogare COMPUSĂ de worker doar din vocabularul aprobat
--      (worker/intrebari-tehnice/vocabular_web.json, cercetare.compune_interogari — runda 3);
--  (b) scrie în plus: `surse` + `interogari_web` pe rândul întrebării; starea 'de_verificat'; jurnalul `intrebari_preluari`
--      (doar prin funcțiile SECURITY DEFINER ale workerului); reluarea readuce întrebarea în coadă. Fără mail, bani, drepturi;
--      fără notificări noi;
--  (c) identitate: fn_intrebari_preia / _amana / _raspunde rămân doar service_role (edge); fn_intrebari_de_verificat /
--      fn_intrebari_reia sunt SECURITY DEFINER pentru authenticated (n-au UPDATE pe tabel), cu verificarea autorului / ownerului;
--      `intrebari_preluari`: RLS activ, fără politici, SELECT doar pentru service_role (anon/authenticated: nimic);
--  (d) cine pornește: marcarea — autorul (sau ownerul), doar din 'raspuns'; reluarea — doar ownerul, din 'raspuns' / 'de_verificat' /
--      'eroare'; plafonul global de 40 de preluări pe zi din fn_intrebari_preia se numără din jurnal și include reluările;
--  (e) confirmare umană: reluarea (care costă) e un clic al ownerului, cu confirmare în ecran; răspunsul rămâne informativ.
-- ORDINEA LA DEPLOY: migrarea → edge intrebari-tehnice-worker v2 (trimite p_surse + p_interogari) → workerul nou pe server.
--   Edge-ul vechi merge și după migrare (p_surse / p_interogari au DEFAULT NULL); edge-ul nou NU merge înainte de migrare.
-- LIVRARE: doar prin scripts/livrare_migrare.sh. NEAPLICATĂ la commit — o aplică chat-ul.
-- REVENIRE: supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql (bloc complet, armat, refuză dacă există date
--   noi — sau le arhivează explicit cu al doilea token; vezi supabase/revenire/README.md).
--
-- AMPRENTELE (runda 4, review r3 P2 / L15 — același tipar ca PR #1029 r2). Migrarea refuză dacă schema de pe țintă nu e EXACT
-- baseline-ul revizuit. Valorile stau într-UN SINGUR loc, blocul „AMPRENTE BASELINE” din pg_temp.fn_20261131e_asteptat de mai jos;
-- până se completează, migrarea refuză (fail-closed) cu mesajul „nu sunt completate”. Ce acoperă (interogarea „AMPRENTE”, identică
-- în scripts/intrebari_cercetare_amprente.sql — testul vitest compară textul):
--   * fiecare funcție înlocuită aici (fn_intrebari_inainte_insert, _preia, _amana, _raspunde cu 6 parametri) și fiecare funcție de
--     care depind (auth.uid(), fn_are_acces_intrebari): definiția completă (pg_get_functiondef: corp, SECURITY DEFINER, search_path,
--     volatilitate), proprietar, ACL (sortat; NULL marcat explicit), supraîncărcări — o versiune ulterioară a uneia = refuz;
--   * FIECARE trigger ne-intern și FIECARE politică RLS de pe tabelele atinse (intrebari_tehnice, notifications — funcțiile
--     de aici scriu în ea), cu materialul complet al funcției triggerului;
--   * tabelele: proprietar, RLS, FORCE RLS, ACL pe tabel și pe coloane; constrângerile intrebari_tehnice (una e înlocuită aici);
--   * tipurile coloanelor citite / scrise de funcții (intrebari_tehnice, profiles, notifications, storage.objects).
-- Interogarea stă într-o funcție TEMPORARĂ (pg_temp.fn_20261131e_amprente, SET search_path = pg_catalog, pg_temp: deparsarea nu
-- depinde de sesiune). După creare ($post$): obiectele neatinse au tot amprenta baseline (o schimbare comisă între timp de altă
-- sesiune = refuz), iar cele create / înlocuite aici au exact corpul din acest fișier (md5 fără CR) + atributele așteptate.
-- PAȘII COORDONATORULUI (sesiunea de cod nu are acces la BD):
--   1. Pe PRODUCȚIE, din rădăcina repo-ului (scriptul își deschide singur o tranzacție READ ONLY și o închide cu ROLLBACK):
--        psql -X -v ON_ERROR_STOP=1 -f scripts/intrebari_cercetare_amprente.sql -o <ieșire_prod.txt>
--   2. Review pe MATERIAL (nu doar copiere): definițiile funcțiilor = cele din 20261105a; politicile / triggerele de pe notifications
--      se verifică față de ce așteaptă echipa. Orice diferență neexplicată = stop.
--   3. Același script pe CLONĂ: ieșirea identică cu producția (diff), altfel dry-run-ul nu dovedește nimic.
--   4. Blocul tipărit înlocuiește INTEGRAL conținutul dintre marcajele „>>> AMPRENTE BASELINE” și „<<< AMPRENTE BASELINE”.
--   5. sha256 pe fișierul completat → la review și la runner; apoi dry-run-ul pe clonă (supabase/tests/…_dryrun.sql, cu T4–T5).
-- ════════════════════════════════════════════════════════════════════════════
DO $start$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131e_intrebari_cercetare_surse:' || txid_current() THEN
    RAISE EXCEPTION '20261131e: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('public.intrebari_tehnice') IS NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.fn_intrebari_preia()') IS NULL
     OR to_regprocedure('public.fn_intrebari_amana(bigint,uuid)') IS NULL
     OR to_regprocedure('public.fn_are_acces_intrebari()') IS NULL
     OR to_regprocedure('public.fn_intrebari_inainte_insert()') IS NULL THEN
    RAISE EXCEPTION '20261131e: lipsește 20261105a (intrebari_tehnice / fn_intrebari_preia / _amana / _raspunde / fn_are_acces_intrebari)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'intrebari_tehnice'
               AND column_name IN ('surse', 'de_verificat_la', 'interogari_web'))
     OR to_regclass('public.intrebari_preluari') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_de_verificat(bigint)') IS NOT NULL
     OR to_regprocedure('public.fn_intrebari_reia(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION '20261131e: rulata deja (coloanele / jurnalul / funcțiile noi există)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_tehnice_stare_check') THEN
    RAISE EXCEPTION '20261131e: lipsește constrângerea intrebari_tehnice_stare_check';
  END IF;
  -- același lock pe care îl ia oricum ALTER TABLE de mai jos, luat ÎNAINTEA amprentelor: triggerele, politicile și constrângerile
  -- de pe intrebari_tehnice nu se mai pot schimba până la COMMIT (orice CREATE / ALTER / DROP pe tabel îl așteaptă)
  LOCK TABLE public.intrebari_tehnice IN ACCESS EXCLUSIVE MODE;
END $start$;

CREATE FUNCTION pg_temp.fn_20261131e_asteptat()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $asteptat$
  -- >>> AMPRENTE BASELINE (singurul loc de completat: îl înlocuiește INTEGRAL blocul tipărit de scripts/intrebari_cercetare_amprente.sql)
  SELECT '{
    "coloane:public.intrebari_tehnice": "__DE_COMPLETAT__",
    "coloane:public.notifications": "__DE_COMPLETAT__",
    "coloane:public.profiles": "__DE_COMPLETAT__",
    "coloane:storage.objects": "__DE_COMPLETAT__",
    "constrangeri:public.intrebari_tehnice": "__DE_COMPLETAT__",
    "fn:auth.uid()": "__DE_COMPLETAT__",
    "fn:public.fn_are_acces_intrebari()": "__DE_COMPLETAT__",
    "fn:public.fn_intrebari_amana(bigint,uuid)": "__DE_COMPLETAT__",
    "fn:public.fn_intrebari_inainte_insert()": "__DE_COMPLETAT__",
    "fn:public.fn_intrebari_preia()": "__DE_COMPLETAT__",
    "fn:public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)": "__DE_COMPLETAT__",
    "pol:public.intrebari_tehnice.intrebari_tehnice_ins": "__DE_COMPLETAT__",
    "pol:public.intrebari_tehnice.intrebari_tehnice_sel": "__DE_COMPLETAT__",
    "tabel:public.intrebari_tehnice": "__DE_COMPLETAT__",
    "tabel:public.notifications": "__DE_COMPLETAT__",
    "trg:public.intrebari_tehnice.intrebari_tehnice_inainte_insert": "__DE_COMPLETAT__"
  }'::jsonb
  -- <<< AMPRENTE BASELINE
$asteptat$;

CREATE FUNCTION pg_temp.fn_20261131e_amprente()
 RETURNS TABLE (eticheta text, amprenta text, material text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $amprente$
-- >>> AMPRENTE: interogarea (text IDENTIC în migrarea 20261131e și în scripts/intrebari_cercetare_amprente.sql; testul vitest compară)
WITH tabele(rel) AS (VALUES ('public.intrebari_tehnice'), ('public.notifications')
), tab AS (
  SELECT c.oid, t.rel, c.relowner, c.relrowsecurity, c.relforcerowsecurity, c.relacl
    FROM tabele t JOIN pg_catalog.pg_class c ON c.oid = to_regclass(t.rel)
), fn_lista(eticheta, sig) AS (VALUES
  ('fn:auth.uid()', 'auth.uid()'),
  ('fn:public.fn_are_acces_intrebari()', 'public.fn_are_acces_intrebari()'),
  ('fn:public.fn_intrebari_amana(bigint,uuid)', 'public.fn_intrebari_amana(bigint,uuid)'),
  ('fn:public.fn_intrebari_inainte_insert()', 'public.fn_intrebari_inainte_insert()'),
  ('fn:public.fn_intrebari_preia()', 'public.fn_intrebari_preia()'),
  ('fn:public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)', 'public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)')
), trg AS (
  SELECT t.*, tb.rel FROM pg_catalog.pg_trigger t JOIN tab tb ON t.tgrelid = tb.oid WHERE NOT t.tgisinternal
), fn_mat AS (
  SELECT p.oid,
         'semnatura: ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || E'\nproprietar: ' || pg_get_userbyid(p.proowner)
      || E'\nsecurity_definer: ' || p.prosecdef::text
      || E'\nproconfig: ' || coalesce(p.proconfig::text, '<NULL>')
      || E'\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C") FROM unnest(p.proacl) AS a),
                               '<NULL = drepturile implicite, inclusiv EXECUTE pentru PUBLIC>')
      || E'\nlimbaj: ' || l.lanname || ', volatil: ' || p.provolatile::text || ', strict: ' || p.proisstrict::text
      || ', leakproof: ' || p.proleakproof::text || ', paralel: ' || p.proparallel::text
      || E'\nsupraincarcari cu acelasi nume: ' || (SELECT count(*) FROM pg_catalog.pg_proc q
                                                     WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname)::text
      || E'\ndefinitia (pg_get_functiondef, fara CR):\n' || replace(pg_get_functiondef(p.oid), chr(13), '') AS material
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (SELECT to_regprocedure(f.sig)::oid FROM fn_lista f UNION SELECT trg.tgfoid FROM trg)
), amprente(eticheta, material) AS (
  SELECT f.eticheta, coalesce(m.material, '<LIPSA: ' || f.sig || '>')
    FROM fn_lista f LEFT JOIN fn_mat m ON m.oid = to_regprocedure(f.sig)::oid
  UNION ALL
  SELECT 'trg:' || t.rel || '.' || t.tgname,
         'definitia: ' || pg_get_triggerdef(t.oid)
      || E'\ntgtype: ' || t.tgtype::text || ', activ: ' || t.tgenabled::text || ', amanabil: ' || t.tgdeferrable::text
      || ', amanat_initial: ' || t.tginitdeferred::text || ', constrangere: ' || (t.tgconstraint <> 0)::text
      || E'\nWHEN: ' || coalesce(pg_get_expr(t.tgqual, t.tgrelid), '<NULL = fara conditie>')
      || E'\nUPDATE OF: ' || coalesce((SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
                                         FROM unnest(t.tgattr::int2[]) WITH ORDINALITY AS k(attnum, ord)
                                         JOIN pg_catalog.pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k.attnum),
                                      '<toate coloanele>')
      || E'\nargumente: ' || t.tgnargs::text || ' ' || encode(t.tgargs, 'hex')
      || E'\ntabele de tranzitie: ' || coalesce(t.tgoldtable::text, '<NULL>') || ' / ' || coalesce(t.tgnewtable::text, '<NULL>')
      || E'\n--- functia triggerului ---\n' || coalesce(m.material, '<LIPSA>')
    FROM trg t LEFT JOIN fn_mat m ON m.oid = t.tgfoid
  UNION ALL
  SELECT 'pol:' || tb.rel || '.' || pol.polname,
         'comanda: ' || pol.polcmd::text || ', permisiva: ' || pol.polpermissive::text
      || E'\nroluri: ' || coalesce((SELECT string_agg(r.nume, ',' ORDER BY r.nume COLLATE "C")
                                      FROM (SELECT CASE WHEN x.rol = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.rol)::text END AS nume
                                              FROM unnest(pol.polroles) AS x(rol)) AS r), '<NULL>')
      || E'\nUSING: ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '<NULL = true>')
      || E'\nWITH CHECK: ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '<NULL>')
    FROM pg_catalog.pg_policy pol JOIN tab tb ON pol.polrelid = tb.oid
  UNION ALL
  SELECT 'tabel:' || t.rel,
         coalesce((SELECT 'proprietar: ' || pg_get_userbyid(tb.relowner)
                       || E'\nrls: ' || tb.relrowsecurity::text
                       || E'\nforce_rls: ' || tb.relforcerowsecurity::text
                       || E'\nacl: ' || coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C") FROM unnest(tb.relacl) AS a),
                                                 '<NULL = drepturile implicite ale proprietarului>')
                       || E'\nacl pe coloane: ' || coalesce((SELECT string_agg(at.attname::text || '=' || (SELECT string_agg(a::text, ',' ORDER BY a::text COLLATE "C")
                                                                                                          FROM unnest(at.attacl) AS a),
                                                                               '; ' ORDER BY at.attname::text COLLATE "C")
                                                            FROM pg_catalog.pg_attribute at
                                                           WHERE at.attrelid = tb.oid AND at.attacl IS NOT NULL AND NOT at.attisdropped),
                                                          '<niciunul>')
                    FROM tab tb WHERE tb.rel = t.rel), '<LIPSA: ' || t.rel || '>')
    FROM tabele t
  UNION ALL
  SELECT 'constrangeri:public.intrebari_tehnice',
         coalesce((SELECT string_agg(co.conname::text || ' [' || co.contype::text || ', validata: ' || co.convalidated::text || ']: '
                                     || pg_get_constraintdef(co.oid), E'\n' ORDER BY co.conname::text COLLATE "C")
                     FROM pg_catalog.pg_constraint co WHERE co.conrelid = to_regclass('public.intrebari_tehnice')), '<niciuna>')
  UNION ALL
  SELECT 'coloane:' || c.tabel,
         string_agg(c.col || ': ' || coalesce((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                                                 FROM pg_catalog.pg_attribute a
                                                WHERE a.attrelid = to_regclass(c.tabel) AND a.attname = c.col AND NOT a.attisdropped),
                                              '<LIPSA>'),
                    E'\n' ORDER BY c.col COLLATE "C")
    FROM (VALUES ('public.intrebari_tehnice', 'id'), ('public.intrebari_tehnice', 'autor'), ('public.intrebari_tehnice', 'titlu'),
                 ('public.intrebari_tehnice', 'intrebare'), ('public.intrebari_tehnice', 'context'), ('public.intrebari_tehnice', 'atasamente'),
                 ('public.intrebari_tehnice', 'stare'), ('public.intrebari_tehnice', 'raspuns_md'), ('public.intrebari_tehnice', 'model'),
                 ('public.intrebari_tehnice', 'tokeni'), ('public.intrebari_tehnice', 'eroare'), ('public.intrebari_tehnice', 'incercari'),
                 ('public.intrebari_tehnice', 'incercare_id'), ('public.intrebari_tehnice', 'creat_la'), ('public.intrebari_tehnice', 'preluat_la'),
                 ('public.intrebari_tehnice', 'raspuns_la'),
                 ('public.profiles', 'id'), ('public.profiles', 'is_owner'),
                 ('public.notifications', 'profile_id'), ('public.notifications', 'type'), ('public.notifications', 'modul'),
                 ('public.notifications', 'title'), ('public.notifications', 'message'), ('public.notifications', 'link_to'),
                 ('storage.objects', 'bucket_id'), ('storage.objects', 'name')) AS c(tabel, col)
   GROUP BY c.tabel
)
SELECT eticheta, md5(material) AS amprenta, material FROM amprente ORDER BY eticheta COLLATE "C"
-- <<< AMPRENTE: interogarea
$amprente$;

DO $pre$
DECLARE
  v_asteptat jsonb := pg_temp.fn_20261131e_asteptat();
  v_calc jsonb;
  v_dif text;
BEGIN
  -- (triggerele / politicile de pe notifications nu sunt în migrările din repo: cheile lor vin din ieșirea scriptului coordonatorului)
  IF position('__DE_COMPLETAT__' IN v_asteptat::text) > 0 THEN
    RAISE EXCEPTION '20261131e: amprentele baseline nu sunt completate (pasii 1-5 din antet: scripts/intrebari_cercetare_amprente.sql)';
  END IF;
  SELECT coalesce(jsonb_object_agg(a.eticheta, a.amprenta), '{}'::jsonb) INTO v_calc FROM pg_temp.fn_20261131e_amprente() AS a;
  IF v_calc IS DISTINCT FROM v_asteptat THEN
    SELECT string_agg(coalesce(c.key, a.key) || ' (' || CASE WHEN c.key IS NULL THEN 'lipseste pe tinta' WHEN a.key IS NULL THEN 'nou pe tinta'
                                                           ELSE 'difera' END || ')', '; ' ORDER BY coalesce(c.key, a.key) COLLATE "C")
      INTO v_dif
      FROM jsonb_each_text(v_calc) AS c FULL JOIN jsonb_each_text(v_asteptat) AS a ON a.key = c.key
     WHERE c.value IS DISTINCT FROM a.value;
    RAISE EXCEPTION '20261131e: amprentele schemei difera de baseline-ul revizuit: %', coalesce(v_dif, '?');
  END IF;
END $pre$;

-- ─── coloane + stări ───────────────────────────────────────────────────────
ALTER TABLE public.intrebari_tehnice
  ADD COLUMN surse jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN de_verificat_la timestamptz,
  ADD COLUMN interogari_web jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT intrebari_surse_lista CHECK (jsonb_typeof(surse) = 'array' AND jsonb_array_length(surse) <= 30 AND octet_length(surse::text) <= 100000),
  ADD CONSTRAINT intrebari_interogari_lista CHECK (jsonb_typeof(interogari_web) = 'array' AND jsonb_array_length(interogari_web) <= 20
                                                  AND octet_length(interogari_web::text) <= 8000);
ALTER TABLE public.intrebari_tehnice DROP CONSTRAINT intrebari_tehnice_stare_check;
ALTER TABLE public.intrebari_tehnice ADD CONSTRAINT intrebari_tehnice_stare_check
  CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare', 'de_verificat'));
COMMENT ON COLUMN public.intrebari_tehnice.surse IS '20261131e: sursele citate în răspuns — [{id C1|W1, tip corpus|web, cale|url, titlu, extras}]; web doar pe domeniile oficiale.';
COMMENT ON COLUMN public.intrebari_tehnice.de_verificat_la IS '20261131e: când autorul a marcat răspunsul ca neclar (stare de_verificat).';
COMMENT ON COLUMN public.intrebari_tehnice.interogari_web IS '20261131e r2: interogările efectiv trimise la căutarea web la ultima încercare (audit; speța nu intră în apelul web).';

-- ─── jurnalul durabil al preluărilor (plafon + cost per încercare) ───────────
-- Un rând la FIECARE preluare (fn_intrebari_preia); închis de fn_intrebari_raspunde / _amana / expirare. Reluarea nu îl atinge.
CREATE TABLE public.intrebari_preluari (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intrebare_id  bigint NOT NULL REFERENCES public.intrebari_tehnice(id),     -- fără CASCADE: evidența costului nu se pierde cu rândul
  incercare_id  uuid UNIQUE,                                                -- NULL doar la rândurile din istoric (de dinainte de 20261131e)
  preluat_la    timestamptz NOT NULL DEFAULT now(),
  inchis_la     timestamptz,
  rezultat      text CHECK (rezultat IS NULL OR rezultat IN ('raspuns', 'eroare', 'amanat', 'expirat')),
  tokeni        jsonb,
  interogari_web jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(interogari_web) = 'array' AND octet_length(interogari_web::text) <= 8000),
  din_istoric   boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE public.intrebari_preluari IS '20261131e r2: jurnalul durabil al preluărilor „Întreabă echipa” — plafonul de 40/zi se numără de aici (include reluările); costul fiecărei încercări. Scris doar de funcțiile workerului.';
CREATE INDEX intrebari_preluari_zi_idx ON public.intrebari_preluari (preluat_la);
CREATE INDEX intrebari_preluari_intrebare_idx ON public.intrebari_preluari (intrebare_id);
ALTER TABLE public.intrebari_preluari ENABLE ROW LEVEL SECURITY;   -- fără politici: anon / authenticated nu văd nimic
REVOKE ALL ON TABLE public.intrebari_preluari FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.intrebari_preluari TO service_role;
REVOKE ALL ON SEQUENCE public.intrebari_preluari_id_seq FROM PUBLIC, anon, authenticated, service_role;
-- istoricul: o preluare pe fiecare întrebare deja preluată (cea mai recentă cunoscută) — plafonul zilei livrării rămâne corect
INSERT INTO public.intrebari_preluari (intrebare_id, incercare_id, preluat_la, inchis_la, rezultat, tokeni, din_istoric)
SELECT id, incercare_id, coalesce(preluat_la, raspuns_la), raspuns_la,
       CASE stare WHEN 'raspuns' THEN 'raspuns' WHEN 'eroare' THEN 'eroare' END, tokeni, true
  FROM public.intrebari_tehnice WHERE preluat_la IS NOT NULL OR raspuns_la IS NOT NULL;

-- Inserarea: aceleași reguli ca în 20261105a + câmpurile noi forțate (utilizatorul nu-și poate scrie singur surse / stare).
CREATE OR REPLACE FUNCTION public.fn_intrebari_inainte_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner boolean; v_azi integer; v_limita integer; a jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_intrebari() THEN RAISE EXCEPTION 'Nu ai acces la Întreabă echipa'; END IF;
  NEW.autor := auth.uid();
  NEW.stare := 'noua'; NEW.raspuns_md := NULL; NEW.model := NULL; NEW.tokeni := NULL; NEW.eroare := NULL;
  NEW.incercari := 0; NEW.incercare_id := NULL; NEW.creat_la := now(); NEW.preluat_la := NULL; NEW.raspuns_la := NULL;
  NEW.surse := '[]'::jsonb; NEW.de_verificat_la := NULL; NEW.interogari_web := '[]'::jsonb;
  NEW.titlu := btrim(NEW.titlu); NEW.intrebare := btrim(NEW.intrebare); NEW.context := nullif(btrim(coalesce(NEW.context, '')), '');
  SELECT coalesce(is_owner, false) INTO v_owner FROM public.profiles WHERE id = NEW.autor;
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:' || NEW.autor::text));
  SELECT count(*) INTO v_azi FROM public.intrebari_tehnice
   WHERE autor = NEW.autor AND creat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest');
  v_limita := CASE WHEN v_owner THEN 20 ELSE 5 END;   -- variabilă: IF … CASE … THEN … END THEN se rupe la primul THEN în PL/pgSQL
  IF v_azi >= v_limita THEN
    RAISE EXCEPTION 'Limita zilnică atinsă (% întrebări pe zi). Mâine poți pune din nou.', v_limita;
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(NEW.atasamente) LOOP
    IF jsonb_typeof(a) <> 'object'
       OR NOT (a->>'path') ~ ('^' || NEW.autor::text || '/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$')
       OR coalesce(a->>'mime', '') NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
       OR char_length(coalesce(a->>'nume', '')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Atașament invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'intrebari-tehnice' AND o.name = a->>'path') THEN
      RAISE EXCEPTION 'Atașamentul nu a fost încărcat: %', a->>'nume';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_inainte_insert() FROM PUBLIC, anon, authenticated;

-- ─── worker: preluarea numără plafonul din jurnal (include reluările) și scrie rândul de jurnal ───
-- CREATE OR REPLACE păstrează ACL-ul din 20261105a (doar service_role).
-- ORDINEA LOCK-URILOR (L06, runda 3 — review r2 P2-5), aceeași pe toate căile care ating ambele tabele:
--   [advisory 'intrebari_tehnice:preia', doar aici] → intrebari_tehnice (rândurile, ORDER BY id) → intrebari_preluari.
--   fn_intrebari_raspunde / fn_intrebari_amana: UPDATE intrebari_tehnice (rândul) → UPDATE intrebari_preluari. Înainte, expirarea
--   bloca ÎNTÂI jurnalul și apoi întrebarea, iar un răspuns întârziat bloca întrebarea și apoi jurnalul → deadlock posibil.
--   Acum expirarea ia ÎNTÂI rândurile întrebărilor expirate (FOR UPDATE, ORDER BY id), abia apoi jurnalul lor.
--   INSERT-ul în jurnal (FK spre intrebari_tehnice) ia KEY SHARE pe rândul întrebării deja blocat de noi.
CREATE OR REPLACE FUNCTION public.fn_intrebari_preia() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.intrebari_tehnice; v_inc uuid := gen_random_uuid(); v_exp_id bigint[]; v_exp_inc uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('intrebari_tehnice:preia'));
  -- expirate (worker oprit în timpul apelului AI): 1) rândurile întrebărilor, blocate în ordinea id-ului (un răspuns întârziat
  -- care le ține deja e așteptat aici; după COMMIT-ul lui rândul nu mai e 'in_lucru' și iese din listă — READ COMMITTED reevaluează)
  SELECT coalesce(array_agg(x.id ORDER BY x.id), '{}'), coalesce(array_agg(x.incercare_id ORDER BY x.id), '{}')
    INTO v_exp_id, v_exp_inc
    FROM (SELECT t.id, t.incercare_id FROM public.intrebari_tehnice t
           WHERE t.stare = 'in_lucru' AND t.preluat_la < now() - interval '30 minutes'
           ORDER BY t.id FOR UPDATE OF t) x;
  -- 2) jurnalul lor se închide ÎNAINTE ca incercare_id să fie golit
  UPDATE public.intrebari_preluari p SET inchis_la = now(), rezultat = 'expirat', tokeni = coalesce(p.tokeni, '{"cost_necunoscut": true}'::jsonb)
   WHERE p.incercare_id = ANY (v_exp_inc) AND p.inchis_la IS NULL;
  -- 3) întrebările (deja blocate de noi la pasul 1)
  WITH expirate AS (
    UPDATE public.intrebari_tehnice
       SET stare = 'eroare', eroare = 'Procesarea a fost întreruptă. Pune întrebarea din nou.', raspuns_la = now(), incercare_id = NULL,
           tokeni = coalesce(tokeni, '{"cost_necunoscut": true}'::jsonb)   -- apelul AI întrerupt poate fi fost facturat (review r3 P2-4)
     WHERE id = ANY (v_exp_id) AND stare = 'in_lucru'
     RETURNING autor, titlu, id)
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  SELECT autor, 'info', 'general', '❓ Întrebarea nu a primit răspuns', left(titlu, 200), '/intrebari?id=' || id FROM expirate;
  -- plafon global de cost: max 40 de preluări pe zi (toți utilizatorii, INCLUSIV reluările); amânările certe fără cost nu se numără
  IF (SELECT count(*) FROM public.intrebari_preluari
       WHERE preluat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')
         AND rezultat IS DISTINCT FROM 'amanat') >= 40 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.intrebari_tehnice WHERE stare = 'noua' ORDER BY creat_la LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.intrebari_tehnice SET stare = 'in_lucru', preluat_la = now(), incercari = incercari + 1, incercare_id = v_inc WHERE id = r.id;
  INSERT INTO public.intrebari_preluari (intrebare_id, incercare_id) VALUES (r.id, v_inc);
  RETURN jsonb_build_object('id', r.id, 'incercare', v_inc, 'titlu', r.titlu, 'intrebare', r.intrebare, 'context', r.context,
                            'atasamente', r.atasamente, 'creat_la', r.creat_la);
END $$;

-- Amânare CERTĂ (API a refuzat fără cost: 429 / 529): ca în 20261105a + rândul de jurnal marcat 'amanat' (nu intră în plafon).
CREATE OR REPLACE FUNCTION public.fn_intrebari_amana(p_id bigint, p_incercare uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_stare text; v_autor uuid; v_titlu text;
BEGIN
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN incercari >= 3 THEN 'eroare' ELSE 'noua' END,
         eroare = CASE WHEN incercari >= 3 THEN 'Serviciul AI a fost ocupat de 3 ori. Pune întrebarea din nou mai târziu.' END,
         raspuns_la = CASE WHEN incercari >= 3 THEN now() END,
         preluat_la = NULL, incercare_id = NULL
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare
   RETURNING stare, autor, titlu INTO v_stare, v_autor, v_titlu;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.intrebari_preluari SET inchis_la = now(), rezultat = 'amanat'
   WHERE incercare_id = p_incercare AND intrebare_id = p_id AND inchis_la IS NULL;
  IF v_stare = 'eroare' THEN   -- tranziția finală notifică autorul, atomic (review r2 P2-7)
    INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
    VALUES (v_autor, 'info', 'general', '❓ Întrebarea nu a primit răspuns', left(v_titlu, 200), '/intrebari?id=' || p_id);
  END IF;
  RETURN true;
END $$;

-- ─── worker: răspunsul vine cu sursele și interogările (DEFAULT NULL → edge-ul vechi merge în continuare) ───
DROP FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text);
CREATE FUNCTION public.fn_intrebari_raspunde(p_id bigint, p_incercare uuid, p_raspuns text, p_model text, p_tokeni jsonb, p_eroare text,
                                             p_surse jsonb DEFAULT NULL, p_interogari jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_autor uuid; v_titlu text; v_interogari jsonb := coalesce(p_interogari, '[]'::jsonb);
BEGIN
  IF (p_raspuns IS NULL) = (p_eroare IS NULL) THEN RAISE EXCEPTION 'exact unul dintre raspuns / eroare'; END IF;
  IF p_surse IS NOT NULL AND jsonb_typeof(p_surse) <> 'array' THEN RAISE EXCEPTION 'surse: se așteaptă o listă'; END IF;
  IF jsonb_typeof(v_interogari) <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_interogari) e WHERE jsonb_typeof(e) <> 'string') THEN
    RAISE EXCEPTION 'interogari: se așteaptă o listă de texte';
  END IF;
  UPDATE public.intrebari_tehnice
     SET stare = CASE WHEN p_raspuns IS NULL THEN 'eroare' ELSE 'raspuns' END,
         raspuns_md = p_raspuns, model = left(p_model, 80), tokeni = p_tokeni, eroare = left(p_eroare, 500), raspuns_la = now(), incercare_id = NULL,
         surse = CASE WHEN p_raspuns IS NULL THEN '[]'::jsonb ELSE coalesce(p_surse, '[]'::jsonb) END,
         interogari_web = v_interogari
   WHERE id = p_id AND stare = 'in_lucru' AND incercare_id = p_incercare
   RETURNING autor, titlu INTO v_autor, v_titlu;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.intrebari_preluari
     SET inchis_la = now(), rezultat = CASE WHEN p_raspuns IS NULL THEN 'eroare' ELSE 'raspuns' END, tokeni = p_tokeni, interogari_web = v_interogari
   WHERE incercare_id = p_incercare AND intrebare_id = p_id;
  INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
  VALUES (v_autor, 'info', 'general',
          CASE WHEN p_raspuns IS NULL THEN '❓ Întrebarea nu a primit răspuns' ELSE '❓ Ai primit răspuns la întrebare' END,
          left(v_titlu, 200), '/intrebari?id=' || p_id);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb, jsonb) TO service_role;

-- ─── UI: „Răspuns neclar — trimite la verificare” (autorul sau ownerul; doar marchează, fără alte efecte) ───
CREATE FUNCTION public.fn_intrebari_de_verificat(p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.fn_are_acces_intrebari() THEN RAISE EXCEPTION 'Nu ai acces la Întreabă echipa'; END IF;
  UPDATE public.intrebari_tehnice SET stare = 'de_verificat', de_verificat_la = now()
   WHERE id = p_id AND stare = 'raspuns'
     AND (autor = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner));
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_de_verificat(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_de_verificat(bigint) TO authenticated;

-- ─── UI: reluarea cu cercetare (DOAR ownerul — costă; nimic nu se reia automat) ───
-- Runda 2 (P1-c): NU mai golește preluat_la / tokeni (evidența ultimei încercări rămâne pe rând până la următorul rezultat) și,
-- mai ales, plafonul nu mai depinde de ele: fiecare preluare are rândul ei în intrebari_preluari, pe care reluarea nu-l atinge.
-- `incercari` se resetează (e contorul de amânări al încercării curente, pentru fn_intrebari_amana), nu un contor de cost.
CREATE FUNCTION public.fn_intrebari_reia(p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.is_owner) THEN
    RAISE EXCEPTION 'Doar ownerul poate relua o întrebare';
  END IF;
  UPDATE public.intrebari_tehnice
     SET stare = 'noua', raspuns_md = NULL, surse = '[]'::jsonb, interogari_web = '[]'::jsonb, model = NULL, eroare = NULL, incercari = 0,
         incercare_id = NULL, raspuns_la = NULL, de_verificat_la = NULL
   WHERE id = p_id AND stare IN ('raspuns', 'de_verificat', 'eroare');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.fn_intrebari_reia(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_intrebari_reia(bigint) TO authenticated;

-- ─── postcondiții pe amprente (runda 4, L15) ─────────────────────────────
DO $post$
DECLARE
  -- md5(corpul fiecărei funcții create / înlocuite mai sus, fără CR); ACELEAȘI valori în revenire, ca precondiție
  -- (testul vitest scripts/intrebari_cercetare_amprente.test.js le recalculează din acest fișier)
  c_corpuri CONSTANT jsonb := '{
    "public.fn_intrebari_amana(bigint,uuid)": "badeb4273e51b12d4ba868bc67312148",
    "public.fn_intrebari_de_verificat(bigint)": "532002403818cdb223e896c971abce0e",
    "public.fn_intrebari_inainte_insert()": "faeca2cd890341524950ca45d0d5156d",
    "public.fn_intrebari_preia()": "65336457781dc5a796376bdaadd31b54",
    "public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)": "1c676fa234d086b8e8368eaa04414b5a",
    "public.fn_intrebari_reia(bigint)": "8745d896032fb72cda593ca11f3f6bd7"
  }'::jsonb;
  -- etichetele care se schimbă INTENȚIONAT aici (verificate pe corp mai sus); triggerul de inserare își schimbă amprenta doar prin
  -- funcția lui: definiția triggerului nu se putea schimba între timp (ACCESS EXCLUSIVE pe intrebari_tehnice, luat în $start$)
  c_schimbate CONSTANT text[] := ARRAY['fn:public.fn_intrebari_amana(bigint,uuid)', 'fn:public.fn_intrebari_inainte_insert()',
    'fn:public.fn_intrebari_preia()', 'fn:public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)',
    'constrangeri:public.intrebari_tehnice', 'trg:public.intrebari_tehnice.intrebari_tehnice_inainte_insert'];
  v_asteptat jsonb := pg_temp.fn_20261131e_asteptat();
  v_calc jsonb;
  v_dif text;
  k text;
  f record;
BEGIN
  FOR k IN SELECT jsonb_object_keys(c_corpuri) LOOP
    SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, l.lanname, md5(replace(p.prosrc, chr(13), '')) AS corp,
           (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = p.pronamespace AND q.proname = p.proname) AS supraincarcari,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                    WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE') AS public_exec
      INTO f FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure(k);
    IF NOT FOUND OR f.corp IS DISTINCT FROM c_corpuri->>k OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
       OR f.owner IS DISTINCT FROM 'postgres' OR f.lanname <> 'plpgsql' OR f.supraincarcari <> 1 OR f.anon_exec OR f.public_exec THEN
      RAISE EXCEPTION '20261131e: postconditie functie % (corp / definer / search_path / proprietar / supraincarcari / ACL)', k;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.intrebari_tehnice'::regclass AND t.tgname = 'intrebari_tehnice_inainte_insert'
                   AND t.tgfoid = 'public.fn_intrebari_inainte_insert()'::regprocedure AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '20261131e: postconditie trigger intrebari_tehnice_inainte_insert';
  END IF;
  -- tot restul: exact baseline-ul (o schimbare comisă între timp de altă sesiune, de ex. pe notifications sau pe auth.uid() = refuz)
  SELECT coalesce(jsonb_object_agg(a.eticheta, a.amprenta), '{}'::jsonb) INTO v_calc FROM pg_temp.fn_20261131e_amprente() AS a;
  IF (v_calc - c_schimbate) IS DISTINCT FROM (v_asteptat - c_schimbate) THEN
    SELECT string_agg(coalesce(c.key, a.key), '; ' ORDER BY coalesce(c.key, a.key) COLLATE "C") INTO v_dif
      FROM jsonb_each_text(v_calc - c_schimbate) AS c FULL JOIN jsonb_each_text(v_asteptat - c_schimbate) AS a ON a.key = c.key
     WHERE c.value IS DISTINCT FROM a.value;
    RAISE EXCEPTION '20261131e: postconditie amprente (schema s-a schimbat in timpul migrarii): %', coalesce(v_dif, '?');
  END IF;
  IF v_calc->>'fn:public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)'
       IS DISTINCT FROM md5('<LIPSA: public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)>') THEN
    RAISE EXCEPTION '20261131e: postconditie (fn_intrebari_raspunde cu 6 parametri inca exista)';
  END IF;
END $post$;

-- funcțiile temporare ale amprentelor nu rămân (sunt în pg_temp, dar se șterg explicit înaintea gărzii finale)
DROP FUNCTION pg_temp.fn_20261131e_amprente();
DROP FUNCTION pg_temp.fn_20261131e_asteptat();

DO $final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261131e_intrebari_cercetare_surse:' || txid_current() THEN
    RAISE EXCEPTION '20261131e: garda final invalida';
  END IF;
  IF to_regprocedure('public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)') IS NOT NULL
     OR has_function_privilege('authenticated', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_intrebari_raspunde(bigint, uuid, text, text, jsonb, text, jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_preia()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_preia()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_intrebari_preia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_intrebari_amana(bigint, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_amana(bigint, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_de_verificat(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_intrebari_reia(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_intrebari_de_verificat(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.fn_intrebari_reia(bigint)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.intrebari_tehnice', 'DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.intrebari_preluari'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.intrebari_preluari'::regclass)
     OR has_table_privilege('anon', 'public.intrebari_preluari', 'SELECT')
     OR has_table_privilege('authenticated', 'public.intrebari_preluari', 'SELECT')
     OR has_table_privilege('authenticated', 'public.intrebari_preluari', 'INSERT')
     OR has_table_privilege('authenticated', 'public.intrebari_preluari', 'UPDATE')
     OR has_table_privilege('service_role', 'public.intrebari_preluari', 'INSERT')
     OR has_table_privilege('service_role', 'public.intrebari_preluari', 'UPDATE')
     OR has_table_privilege('service_role', 'public.intrebari_preluari', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.intrebari_preluari', 'SELECT')
     OR has_sequence_privilege('authenticated', 'public.intrebari_preluari_id_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.intrebari_preluari_id_seq', 'USAGE')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.intrebari_tehnice'::regclass AND conname = 'intrebari_tehnice_stare_check'
                      AND pg_get_constraintdef(oid) LIKE '%de_verificat%')
     OR EXISTS (SELECT 1 FROM public.intrebari_tehnice WHERE surse IS DISTINCT FROM '[]'::jsonb OR interogari_web IS DISTINCT FROM '[]'::jsonb)
     OR (SELECT count(*) FROM public.intrebari_preluari WHERE NOT din_istoric) <> 0
     OR (SELECT count(*) FROM public.intrebari_preluari)
        <> (SELECT count(*) FROM public.intrebari_tehnice WHERE preluat_la IS NOT NULL OR raspuns_la IS NOT NULL) THEN
    RAISE EXCEPTION '20261131e: verificarea finală a eșuat';
  END IF;
END $final$;
