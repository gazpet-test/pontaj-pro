-- Revenire 20270106a_executie_semnale. NEAPLICAT (ca și migrarea). Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate TOT ce a creat migrarea: vederea v_executie_semnale, tabelele executie_semnale și executie_semnale_jurnal (cu politicile, trigger-ele,
-- cheile și indexurile lor) și cele 12 funcții fn_executie_semnal_*. Tabelele și funcțiile existente (executie_proiecte, employees, lanțul
-- 20261209a) NU se ating.
-- Starea EXACTĂ a migrării e verificată înainte, pe DEFINIȚIILE EFECTIVE (nu pe nume / numere): coloanele fiecărui tabel (nume, tip, NOT NULL,
-- valoarea implicită, identitatea, în ordine), TEXTUL fiecărei constrângeri (pg_get_constraintdef, validată) și al fiecărui index (pg_get_indexdef,
-- valid), TEXTUL vederii (pg_get_viewdef) + security_invoker, politicile (comanda, permisivă, rolurile, expresia exactă), trigger-ele (funcția,
-- tipul, activ, fără WHEN / argumente / coloane), funcțiile (corpul = amprenta fără CR, limbajul, DEFINER-ul, search_path-ul, proprietarul, EXECUTE
-- pe fiecare rol), drepturile pe tabele / vedere / secvențe (fiecare drept, pe fiecare rol, plus PUBLIC și coloane) și ACL-ul EXACT (niciun alt
-- rol), nimic străin dependent. Un CHECK înlocuit sub același nume, un index recreat pe alte coloane, un implicit schimbat, o vedere rescrisă =
-- alt obiect decât cel creat = refuz. Altă stare = refuz, nimic schimbat.
-- Blocurile se regenerează din migrare / de pe baza cu migrarea aplicată: AMPRENTE cu scripts/executie_semnale_amprente.mjs
-- --actualizeaza-revenire, DEFINITII cu node scripts/pglite/test_executie_semnale_local.mjs --scrie-definitii (proba le verifică la fiecare rulare).
-- Fără amprentă globală L15 (varianta A din docs/LIVRARE_L15_V2.md §9, plafonul 2000 al revenirilor): garanția revenirii e verificarea
-- definițiilor de mai sus + „fără date”, nu comparația cu un manifest; dacă proprietarul cere aceeași garanție ca la aplicare (varianta B),
-- revenirea se livrează separat, cu manifestul ei.
-- REFUZĂ dacă există date: un semnal sau un rând de jurnal (semnalele și deciziile oamenilor asupra lor sunt istoric; golirea = decizie
-- separată a owner-ului: preview → „da” → export → apply, într-o tranzacție armată, înaintea acestui fișier — trigger-ele refuză DELETE / TRUNCATE
-- pentru oricine, inclusiv postgres, deci golirea cere dezactivarea lor în aceeași tranzacție).
-- ÎNAINTE de revenire: agentul de noapte (faza 2, dacă e pornit) se oprește; ecranul „🔔 Semnale” arată „indisponibil după revenire” (vederea lipsește).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon:
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20270106a_executie_semnale_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20270106120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul (gazpet.livrare_migrare = '20270106a_executie_semnale_ROLLBACK:<txid>') și plafonul; fără ele fișierul refuză.
-- Ordinea (L06, L14): 1. gărzile + starea exactă (doar catalog); 2. lock-urile, NOWAIT, cu bugetul de 1 s de la BEGIN verificat înaintea fiecărei
--   încercări și DUPĂ obținere, în ordinea: executie_semnale, executie_semnale_jurnal (ACCESS EXCLUSIVE), ÎNAINTEA verificării „fără date”;
--   3. sub lock: starea din nou, „fără date”, DROP-urile (fără CASCADE), postcondiția. Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; v_rau text; v_n integer;
  v_tabele constant text[] := ARRAY['executie_semnale', 'executie_semnale_jurnal'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270106a_executie_semnale_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270106a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20270106a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20270106a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20270106a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20270106a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20270106a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.executie_semnale IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_semnale_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20270106a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    IF to_regclass('public.executie_semnale') IS NULL OR to_regclass('public.executie_semnale_jurnal') IS NULL OR to_regclass('public.v_executie_semnale') IS NULL
       OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.v_executie_semnale')) IS DISTINCT FROM 'v'
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.v_executie_semnale') AND 'security_invoker=on' = ANY (reloptions)) THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, tabele / vedere)', v_pas;
    END IF;
    -- DEFINIȚIILE efective, pe fiecare obiect: coloanele (nume : tip : NOT NULL : implicit : identitate / generată, în ordine), fiecare
    -- constrângere (numele + textul ei + validată; fără rândurile NOT NULL ale PG18), fiecare index (textul lui + valid), vederea (textul ei).
    -- Textul așteptat (blocul DEFINITII) e generat de pe baza cu migrarea aplicată și verificat de probă la fiecare rulare; expresia care citește
    -- starea reală (blocul DEF-ACTUAL) e aceeași în probă (citită de aici, nu copiată).
    SELECT string_agg(a.cheie, ', ') FILTER (WHERE a.def IS DISTINCT FROM a.real),
           count(DISTINCT a.cheie) FILTER (WHERE a.cheie IN ('coloane:executie_semnale', 'coloane:executie_semnale_jurnal', 'constrangeri:executie_semnale',
                                                             'constrangeri:executie_semnale_jurnal', 'indexuri:executie_semnale', 'indexuri:executie_semnale_jurnal', 'vedere:v_executie_semnale'))
      INTO v_rau, v_n
      FROM (SELECT a.cheie, a.def, (
        -- DEF-ACTUAL-START
        CASE split_part(a.cheie, ':', 1)
          WHEN 'coloane' THEN (SELECT string_agg(c.attname || ':' || format_type(c.atttypid, c.atttypmod) || ':' || CASE WHEN c.attnotnull THEN 'nn' ELSE 'n' END
                                                 || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || c.attidentity::text || c.attgenerated::text, ',' ORDER BY c.attnum)
                                 FROM pg_attribute c LEFT JOIN pg_attrdef d ON d.adrelid = c.attrelid AND d.adnum = c.attnum
                                WHERE c.attrelid = ('public.' || split_part(a.cheie, ':', 2))::regclass AND c.attnum > 0 AND NOT c.attisdropped)
          WHEN 'constrangeri' THEN (SELECT string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid) || CASE WHEN k.convalidated THEN '' ELSE ' NOT VALID' END, '; ' ORDER BY k.conname)
                                      FROM pg_constraint k WHERE k.conrelid = ('public.' || split_part(a.cheie, ':', 2))::regclass AND k.contype <> 'n')
          WHEN 'indexuri' THEN (SELECT string_agg(pg_get_indexdef(i.indexrelid) || CASE WHEN i.indisvalid THEN '' ELSE ' INVALID' END, '; ' ORDER BY pg_get_indexdef(i.indexrelid))
                                  FROM pg_index i WHERE i.indrelid = ('public.' || split_part(a.cheie, ':', 2))::regclass)
          WHEN 'vedere' THEN regexp_replace(pg_get_viewdef(('public.' || split_part(a.cheie, ':', 2))::regclass), '[[:space:]]+', ' ', 'g')
        END
        -- DEF-ACTUAL-END
        ) AS real FROM (VALUES
        -- DEFINITII-START
        ('coloane:executie_semnale', 'id:bigint:nn:-:d,proiect_id:bigint:nn:-:,flux:text:nn:-:,tip:text:nn:-:,obiect:text:nn:-:,gravitate:text:nn:-:,titlu:text:nn:-:,detalii:text:n:-:,constatare:text:nn:-:,surse_consultate:text[]:nn:''{}''::text[]:,dovada_sursa:text:n:-:,dovada_data:date:n:-:,dovada_fragment:text:n:-:,dovada_ref:text:n:-:,dovada_amprenta:text:nn:-:,termen:date:n:-:,termen_baza:text:n:-:,termen_confirmat:boolean:n:-:,incertitudine:text:n:-:,propunere:text:n:-:,responsabil_employee_id:integer:n:-:,responsabil_sursa:text:n:-:,stare:text:nn:''nou''::text:,stare_motiv:text:n:-:,stare_dovada:text:n:-:,actiune_ref:text:n:-:,stare_de:uuid:n:-:,stare_la:timestamp with time zone:n:-:,regula_versiune:text:nn:-:,detectat_la:timestamp with time zone:nn:now():,ultima_verificare:timestamp with time zone:nn:now():,versiune:integer:nn:1:'),
        ('coloane:executie_semnale_jurnal', 'id:bigint:nn:-:d,semnal_id:bigint:nn:-:,proiect_id:bigint:nn:-:,actiune:text:nn:-:,stare_veche:text:n:-:,stare_noua:text:n:-:,actor:text:nn:-:,actor_profile:uuid:n:-:,motiv:text:n:-:,dovada:text:n:-:,valori:jsonb:nn:''{}''::jsonb:,regula_versiune:text:n:-:,creat_la:timestamp with time zone:nn:now():'),
        ('constrangeri:executie_semnale', 'executie_semnale_amprenta_ck CHECK ((dovada_amprenta ~ ''^[0-9a-f]{32}$''::text)); executie_semnale_cheie_uq UNIQUE (proiect_id, tip, obiect); executie_semnale_constatare_ck CHECK (((constatare = ANY (ARRAY[''constatat''::text, ''negasit_in_surse''::text, ''camp_lipsa''::text])) AND ((dovada_sursa IS NULL) OR (dovada_sursa = ANY (ARRAY[''document''::text, ''mail''::text, ''camp_erp''::text]))) AND (cardinality(surse_consultate) <= 50) AND ((constatare IS DISTINCT FROM ''constatat''::text) OR ((dovada_sursa IS NOT NULL) AND (dovada_data IS NOT NULL) AND (dovada_fragment IS NOT NULL))) AND ((constatare IS DISTINCT FROM ''negasit_in_surse''::text) OR ((cardinality(surse_consultate) >= 1) AND (dovada_sursa IS NOT NULL) AND (dovada_data IS NOT NULL) AND (dovada_fragment IS NOT NULL))) AND ((constatare IS DISTINCT FROM ''camp_lipsa''::text) OR ((NOT (dovada_sursa IS DISTINCT FROM ''camp_erp''::text)) AND (dovada_ref IS NOT NULL))))); executie_semnale_flux_ck CHECK ((flux = ANY (ARRAY[''lipsuri''::text, ''tichete''::text, ''corespondenta''::text]))); executie_semnale_gravitate_ck CHECK ((gravitate = ANY (ARRAY[''info''::text, ''atentie''::text, ''critic''::text]))); executie_semnale_obiect_ck CHECK ((((length(obiect) >= 1) AND (length(obiect) <= 200)) AND (obiect !~ ''[[:cntrl:]]''::text) AND (NOT (obiect IS DISTINCT FROM fn_executie_semnal_spatii(obiect))))); executie_semnale_pkey PRIMARY KEY (id); executie_semnale_proiect_id_fkey FOREIGN KEY (proiect_id) REFERENCES executie_proiecte(id); executie_semnale_regula_ck CHECK ((regula_versiune ~ ''^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$''::text)); executie_semnale_responsabil_ck CHECK ((((responsabil_sursa IS NULL) OR (responsabil_sursa = ANY (ARRAY[''agent''::text, ''om''::text]))) AND ((responsabil_employee_id IS NULL) OR (responsabil_sursa IS NOT NULL)) AND ((responsabil_sursa IS DISTINCT FROM ''agent''::text) OR (responsabil_employee_id IS NOT NULL)))); executie_semnale_responsabil_employee_id_fkey FOREIGN KEY (responsabil_employee_id) REFERENCES employees(id); executie_semnale_stare_ck CHECK (((stare = ANY (ARRAY[''nou''::text, ''in_lucru''::text, ''asteapta_informatii''::text, ''rezolvat''::text, ''respins''::text])) AND (((stare = ''nou''::text) AND (stare_motiv IS NULL) AND (stare_dovada IS NULL) AND (actiune_ref IS NULL) AND (stare_de IS NULL) AND (stare_la IS NULL)) OR ((stare <> ''nou''::text) AND (stare_de IS NOT NULL) AND (stare_la IS NOT NULL) AND ((stare <> ALL (ARRAY[''rezolvat''::text, ''respins''::text])) OR (stare_motiv IS NOT NULL)) AND ((stare IS DISTINCT FROM ''rezolvat''::text) OR (stare_dovada IS NOT NULL) OR (actiune_ref IS NOT NULL)))))); executie_semnale_termen_ck CHECK (((((termen IS NULL) AND (termen_baza IS NULL) AND (termen_confirmat IS NULL)) OR ((termen IS NOT NULL) AND ((termen >= ''2000-01-01''::date) AND (termen <= ''2100-12-31''::date)) AND (termen_confirmat IS NOT NULL) AND ((termen_confirmat IS NOT TRUE) OR (termen_baza IS NOT NULL)))) AND ((dovada_data IS NULL) OR ((dovada_data >= ''2000-01-01''::date) AND (dovada_data <= ''2100-12-31''::date))))); executie_semnale_texte_ck CHECK ((((detalii IS NULL) OR (((length(detalii) >= 1) AND (length(detalii) <= 4000)) AND (detalii ~ ''[^[:space:]]''::text))) AND ((dovada_fragment IS NULL) OR (((length(dovada_fragment) >= 1) AND (length(dovada_fragment) <= 1000)) AND (dovada_fragment ~ ''[^[:space:]]''::text))) AND ((dovada_ref IS NULL) OR (((length(dovada_ref) >= 1) AND (length(dovada_ref) <= 1000)) AND (dovada_ref !~ ''[[:cntrl:]]''::text) AND (dovada_ref ~ ''[^[:space:]]''::text))) AND ((termen_baza IS NULL) OR (((length(termen_baza) >= 1) AND (length(termen_baza) <= 500)) AND (termen_baza ~ ''[^[:space:]]''::text))) AND ((incertitudine IS NULL) OR (((length(incertitudine) >= 1) AND (length(incertitudine) <= 1000)) AND (incertitudine ~ ''[^[:space:]]''::text))) AND ((propunere IS NULL) OR (((length(propunere) >= 1) AND (length(propunere) <= 2000)) AND (propunere ~ ''[^[:space:]]''::text))) AND ((stare_motiv IS NULL) OR (((length(stare_motiv) >= 1) AND (length(stare_motiv) <= 2000)) AND (stare_motiv ~ ''[^[:space:]]''::text))) AND ((stare_dovada IS NULL) OR (((length(stare_dovada) >= 1) AND (length(stare_dovada) <= 1000)) AND (stare_dovada ~ ''[^[:space:]]''::text))) AND ((actiune_ref IS NULL) OR (((length(actiune_ref) >= 1) AND (length(actiune_ref) <= 200)) AND (actiune_ref !~ ''[[:cntrl:]]''::text) AND (actiune_ref ~ ''[^[:space:]]''::text))))); executie_semnale_timp_ck CHECK (((versiune >= 1) AND (ultima_verificare >= detectat_la))); executie_semnale_tip_ck CHECK ((tip ~ ''^[a-z][a-z0-9_]{1,59}$''::text)); executie_semnale_titlu_ck CHECK ((((length(titlu) >= 3) AND (length(titlu) <= 200)) AND (titlu !~ ''[[:cntrl:]]''::text) AND (titlu ~ ''[^[:space:]]''::text)))'),
        ('constrangeri:executie_semnale_jurnal', 'executie_semnale_jurnal_actiune_ck CHECK ((actiune = ANY (ARRAY[''creat''::text, ''actualizat''::text, ''redeschis''::text, ''stare''::text, ''responsabil''::text]))); executie_semnale_jurnal_actor_ck CHECK (((actor = ANY (ARRAY[''agent''::text, ''om''::text])) AND ((actor = ''om''::text) = (actor_profile IS NOT NULL)))); executie_semnale_jurnal_pkey PRIMARY KEY (id); executie_semnale_jurnal_semnal_id_fkey FOREIGN KEY (semnal_id) REFERENCES executie_semnale(id); executie_semnale_jurnal_valori_ck CHECK ((jsonb_typeof(valori) = ''object''::text))'),
        ('indexuri:executie_semnale', 'CREATE INDEX executie_semnale_proiect_stare_idx ON public.executie_semnale USING btree (proiect_id, stare, gravitate); CREATE INDEX executie_semnale_responsabil_idx ON public.executie_semnale USING btree (responsabil_employee_id) WHERE (responsabil_employee_id IS NOT NULL); CREATE UNIQUE INDEX executie_semnale_cheie_uq ON public.executie_semnale USING btree (proiect_id, tip, obiect); CREATE UNIQUE INDEX executie_semnale_pkey ON public.executie_semnale USING btree (id)'),
        ('indexuri:executie_semnale_jurnal', 'CREATE INDEX executie_semnale_jurnal_semnal_idx ON public.executie_semnale_jurnal USING btree (semnal_id, id); CREATE UNIQUE INDEX executie_semnale_jurnal_pkey ON public.executie_semnale_jurnal USING btree (id)'),
        ('vedere:v_executie_semnale', ' SELECT s.id, s.proiect_id, s.flux, s.tip, s.obiect, s.gravitate, s.titlu, s.detalii, s.constatare, s.surse_consultate, s.dovada_sursa, s.dovada_data, s.dovada_fragment, s.dovada_ref, s.dovada_amprenta, s.termen, s.termen_baza, s.termen_confirmat, s.incertitudine, s.propunere, s.responsabil_employee_id, s.responsabil_sursa, s.stare, s.stare_motiv, s.stare_dovada, s.actiune_ref, s.stare_de, s.stare_la, s.regula_versiune, s.detectat_la, s.ultima_verificare, s.versiune, e.cod_intern AS proiect_cod, e.nume AS proiect_nume FROM (executie_semnale s JOIN executie_proiecte e ON ((e.id = s.proiect_id)));'),
        -- DEFINITII-END
        ('', '')
      ) a(cheie, def) WHERE a.cheie <> '') a;
    IF v_rau IS NOT NULL OR v_n IS DISTINCT FROM 7 THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, definitii: %)', v_pas, coalesce(v_rau, 'blocul DEFINITII incomplet (' || coalesce(v_n, 0) || ' din 7)');
    END IF;
    -- drepturile pe tabele / vedere, fiecare pe rând: doar SELECT pentru authenticated / service_role; nimic pentru anon, PUBLIC, pe coloane
    SELECT string_agg(DISTINCT x.tab || '/' || y.rol || '/' || z.drept, ', ') INTO v_rau
      FROM unnest(v_tabele || ARRAY['v_executie_semnale']) x(tab), unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol),
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
     WHERE has_table_privilege(y.rol, ('public.' || x.tab)::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon');
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(v_tabele || ARRAY['v_executie_semnale']) x(tab) JOIN pg_class c ON c.oid = ('public.' || x.tab)::regclass
                    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee = 0)
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_attribute a ON a.attrelid = ('public.' || x.tab)::regclass WHERE a.attnum > 0 AND a.attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_class c ON c.oid = ('public.' || x.tab)::regclass
                   WHERE NOT c.relrowsecurity OR c.relforcerowsecurity OR pg_get_userbyid(c.relowner) <> 'postgres')
       OR pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.v_executie_semnale'::regclass)) <> 'postgres' THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, drepturi / RLS: %)', v_pas, coalesce(v_rau, 'PUBLIC / coloane / RLS / proprietar');
    END IF;
    -- ACL-ul EXACT: pe tabele / vedere doar proprietarul + SELECT (fără GRANT OPTION) pentru authenticated / service_role, niciun alt rol;
    -- pe secvențele de identitate doar proprietarul (postgres)
    SELECT string_agg(DISTINCT c.relname || '/' || CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || '/' || e.privilege_type, ', ') INTO v_rau
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) e
     WHERE c.oid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele || ARRAY['v_executie_semnale']) x
                     UNION ALL SELECT pg_get_serial_sequence('public.' || x, 'id')::regclass FROM unnest(v_tabele) x)
       AND e.grantee <> c.relowner
       AND NOT (c.relkind IN ('r', 'v') AND e.grantee IN ('authenticated'::regrole::oid, 'service_role'::regrole::oid) AND e.privilege_type = 'SELECT' AND NOT e.is_grantable);
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x WHERE pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = pg_get_serial_sequence('public.' || x, 'id')::regclass)) IS DISTINCT FROM 'postgres') THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, drepturi ACL: %)', v_pas, coalesce(v_rau, 'proprietarul secventei');
    END IF;
    -- politicile: EXACT cele 2, fiecare cu definiția ei (comanda, permisivă, rolurile, expresia)
    SELECT string_agg(coalesce(a.nume, p.polname), ', ') INTO v_rau
      FROM (VALUES
        ('public.executie_semnale'::regclass, 'executie_semnale_citire', 'r', 'fn_executie_semnal_drept(proiect_id, responsabil_employee_id)'),
        ('public.executie_semnale_jurnal'::regclass, 'executie_semnale_jurnal_citire', 'r', 'fn_executie_semnal_drept_id(semnal_id)')
      ) a(rel, nume, cmd, qual)
      FULL JOIN (SELECT * FROM pg_policy WHERE polrelid IN ('public.executie_semnale'::regclass, 'public.executie_semnale_jurnal'::regclass)) p
        ON p.polrelid = a.rel AND p.polname = a.nume
     WHERE a.nume IS NULL OR p.oid IS NULL OR p.polcmd::text IS DISTINCT FROM a.cmd OR NOT p.polpermissive
        OR p.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
        OR replace(pg_get_expr(p.polqual, p.polrelid), 'public.', '') IS DISTINCT FROM a.qual
        OR p.polwithcheck IS NOT NULL;
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, politici: %)', v_pas, v_rau;
    END IF;
    -- trigger-ele: EXACT cele 4, fiecare cu funcția, tipul, activ, fără WHEN / argumente / coloane
    SELECT string_agg(coalesce(a.nume, tg.tgname), ', ') INTO v_rau
      FROM (VALUES
        ('public.executie_semnale'::regclass, 'trg_executie_semnal_garda', 'public.fn_executie_semnal_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_semnale_jurnal'::regclass, 'trg_executie_semnal_jurnal_garda', 'public.fn_executie_semnal_jurnal_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_semnale'::regclass, 'trg_executie_semnale_fara_golire', 'public.fn_executie_semnal_fara_golire()', 2 | 32),
        ('public.executie_semnale_jurnal'::regclass, 'trg_executie_semnale_jurnal_fara_golire', 'public.fn_executie_semnal_fara_golire()', 2 | 32)
      ) a(rel, nume, fn, tip)
      FULL JOIN (SELECT * FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.executie_semnale'::regclass, 'public.executie_semnale_jurnal'::regclass)) tg
        ON tg.tgrelid = a.rel AND tg.tgname = a.nume
     WHERE a.nume IS NULL OR tg.oid IS NULL OR tg.tgfoid IS DISTINCT FROM to_regprocedure(a.fn) OR tg.tgtype IS DISTINCT FROM a.tip::int2
        OR tg.tgenabled IS DISTINCT FROM 'O' OR tg.tgqual IS NOT NULL OR tg.tgnargs <> 0 OR tg.tgattr::text <> '';
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, trigger-e: %)', v_pas, v_rau;
    END IF;
    -- funcțiile: exact cele 12, fiecare cu corpul revizuit (amprenta fără CR), limbajul, DEFINER-ul, search_path-ul, proprietarul, EXECUTE pe clasă
    SELECT string_agg(a.fn, ', ') INTO v_rau FROM (VALUES
        -- AMPRENTE-START
        ('public.fn_executie_semnal_drept(bigint, integer)', 'sql', true, 'e518d28f2e083bbbb58f1a76f408a998'),
        ('public.fn_executie_semnal_drept_id(bigint)', 'sql', true, 'fef8852a3559d16ce8ef6414c8f633ff'),
        ('public.fn_executie_semnal_tranzitie(text, text, text)', 'sql', false, 'c36465e6826f935218a565bd7768df4b'),
        ('public.fn_executie_semnal_spatii(text)', 'sql', false, 'a78f097911e50a46ed9cb187bd6efa46'),
        ('public.fn_executie_semnal_canonic(text)', 'sql', false, 'd285f87e9432d94300b76522db780661'),
        ('public.fn_executie_semnal_amprenta(text, text[], text, date, text, text)', 'sql', false, '050a504f3c525dd1eea737c82e05254d'),
        ('public.fn_executie_semnal_dif(jsonb, jsonb)', 'sql', false, 'e12240cbab35d2468a77fe093456ee84'),
        ('public.fn_executie_semnal_garda()', 'plpgsql', false, 'ead4b8688b66d0079dec64c5ee0fb297'),
        ('public.fn_executie_semnal_jurnal_garda()', 'plpgsql', false, '06bfbc1622933e7305aefe0cd2e16efb'),
        ('public.fn_executie_semnal_fara_golire()', 'plpgsql', false, 'cc70f302ba552a0d797b136a6df85b67'),
        ('public.fn_executie_semnal_scrie(jsonb)', 'plpgsql', true, '760ee1725fae6fe5cc995522813e96e2'),
        ('public.fn_executie_semnal_stare(bigint, integer, text, text, text, text, integer, boolean)', 'plpgsql', true, '6342f1c7c7cec8ac479f3db9df86c7d2'),
        -- AMPRENTE-END
        ('', '', false, '')
      ) a(fn, limbaj, definer, amp)
      WHERE a.fn <> '' AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                         WHERE p.oid = to_regprocedure(a.fn) AND l.lanname = a.limbaj AND p.prosecdef = a.definer
                           AND md5(replace(p.prosrc, chr(13), '')) = a.amp
                           AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                           AND has_function_privilege('service_role', p.oid, 'EXECUTE') = (a.fn LIKE 'public.fn_executie_semnal_scrie(%')
                           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = (a.fn LIKE 'public.fn_executie_semnal_drept(%'
                                 OR a.fn LIKE 'public.fn_executie_semnal_drept_id(%' OR a.fn LIKE 'public.fn_executie_semnal_stare(%')
                           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0));
    IF v_rau IS NOT NULL
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_semnal\_%') <> 12 THEN
      RAISE EXCEPTION '20270106a revenire: starea nu e cea din 20270106a (pasul %, functii: %)', v_pas, coalesce(v_rau, 'alt numar');
    END IF;
    -- nimic din afara migrării nu depinde de obiectele ei: vederi (în afara celei proprii) / chei străine spre tabele, funcții care le numesc, alte politici
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x)
                  AND w.ev_class <> 'public.v_executie_semnale'::regclass)
       OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                   WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.v_executie_semnale'::regclass AND w.ev_class <> 'public.v_executie_semnale'::regclass)
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                   AND c.confrelid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x)
                   AND c.conrelid NOT IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT LIKE 'fn\_executie\_semnal\_%'
                     AND p.prosrc ~ '\m(executie_semnale|executie_semnale_jurnal|v_executie_semnale|fn_executie_semnal_[a-z_]+)\M')
       OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'public' AND tablename = ANY (v_tabele))
                   AND coalesce(qual, '') || coalesce(with_check, '') ~ '(executie_semnale|fn_executie_semnal_)') THEN
      RAISE EXCEPTION '20270106a revenire: alte obiecte depind de obiectele migrarii (vederi / chei straine / functii / politici)';
    END IF;
  END LOOP;
  -- sub lock: fără date (semnalele și deciziile oamenilor nu se șterg de aici)
  IF EXISTS (SELECT 1 FROM public.executie_semnale) OR EXISTS (SELECT 1 FROM public.executie_semnale_jurnal) THEN
    RAISE EXCEPTION '20270106a revenire: exista semnale / jurnal (nu se sterg de aici)';
  END IF;
  DROP VIEW public.v_executie_semnale;
  DROP TABLE public.executie_semnale_jurnal;
  DROP TABLE public.executie_semnale;
  DROP FUNCTION public.fn_executie_semnal_scrie(jsonb);
  DROP FUNCTION public.fn_executie_semnal_stare(bigint, integer, text, text, text, text, integer, boolean);
  DROP FUNCTION public.fn_executie_semnal_drept_id(bigint);
  DROP FUNCTION public.fn_executie_semnal_drept(bigint, integer);
  DROP FUNCTION public.fn_executie_semnal_garda();
  DROP FUNCTION public.fn_executie_semnal_jurnal_garda();
  DROP FUNCTION public.fn_executie_semnal_fara_golire();
  DROP FUNCTION public.fn_executie_semnal_tranzitie(text, text, text);
  DROP FUNCTION public.fn_executie_semnal_amprenta(text, text[], text, date, text, text);
  DROP FUNCTION public.fn_executie_semnal_canonic(text);
  DROP FUNCTION public.fn_executie_semnal_spatii(text);
  DROP FUNCTION public.fn_executie_semnal_dif(jsonb, jsonb);
  IF to_regclass('public.executie_semnale') IS NOT NULL OR to_regclass('public.executie_semnale_jurnal') IS NOT NULL OR to_regclass('public.v_executie_semnale') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_semnal\_%') THEN
    RAISE EXCEPTION '20270106a revenire post: au ramas obiecte';
  END IF;
  -- lanțul 20261209a a rămas neatins (aceleași amprente ca în garda migrării)
  IF (SELECT count(*) FROM pg_proc p JOIN (VALUES
        ('public.fn_executie_proiect_permis(bigint, boolean)', 'bd4320f76e9f36f492c7186c0a982155'),
        ('public.fn_executie_acces_nerestrans()', 'b863c5324684dbf4eb9af81474fbc4e1'),
        ('public.fn_executie_acces_lista(boolean)', 'd9e123a46b83530a7203d4a24da5cf9b')
      ) a(semnatura, amprenta) ON p.oid = to_regprocedure(a.semnatura) AND md5(replace(p.prosrc, chr(13), '')) = a.amprenta) <> 3 THEN
    RAISE EXCEPTION '20270106a revenire post: lantul de drept 20261209a difera';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20270106a_executie_semnale_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20270106a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20270106a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
