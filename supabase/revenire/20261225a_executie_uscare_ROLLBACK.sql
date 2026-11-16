-- Revenire 20261225a_executie_uscare. NEAPLICAT. Fără GO de execuție: doar la cererea explicită a owner-ului (supabase/revenire/README.md).
-- Scoate tot ce a creat migrarea: tabelele executie_uscari, executie_uscare_incarcari, executie_uscare_poze, executie_uscare_jurnal (cu
-- politicile, trigger-ele și cheile lor), cele 17 funcții fn_executie_uscare_*, politicile executie_uscare_citire / _adauga de pe
-- storage.objects și bucket-ul executie-uscare. Tabelele și funcțiile existente NU se ating.
-- Starea EXACTĂ a migrării e verificată înainte, pe DEFINIȚII (nu doar pe numere): corpul fiecărei funcții (amprenta fără CR) + limbajul,
-- DEFINER-ul, search_path-ul, proprietarul, EXECUTE pe fiecare rol; fiecare politică (nume, comandă, permisivă, roluri, expresia exactă);
-- fiecare trigger (funcția, tipul, activ, fără WHEN / argumente / coloane); configurația bucket-ului (privat, limita, tipurile); drepturile pe
-- tabele (fiecare drept, pe fiecare rol, plus PUBLIC și coloane) și ACL-ul EXACT al tabelelor și secvențelor (niciun alt rol); STRUCTURA
-- fiecărui tabel (runda 3), ca amprentă: coloanele (nume, tip, NOT NULL, valoarea implicită, identitate, generare, colație), constrângerile
-- (nume + definiție: un CHECK adăugat pe tabelul gol = altă amprentă), indecșii (definiția), opțiunile tabelului, parametrii secvenței de
-- identitate. Altă stare = refuz, nimic schimbat. Amprentele se regenerează și se verifică cu scripts/pglite/test_executie_uscare_local.mjs.
-- REFUZĂ dacă există date: un raport, o rezervare, o poză, un rând de jurnal sau un fișier în bucket (rapoartele de uscare sunt documente
-- semnate; golirea = decizie separată: preview → „da” owner → export → apply).
--
-- LIVRAREA = prin runner, ca migrarea, DOAR cu plafon:
--   bash scripts/livrare_migrare.sh --migrare supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql --sha256 <sha256 al fișierului>
--        --versiune 20261225120001 --tinta-db postgres --tinta-sistem <system_identifier> --tinta-host <H> --tinta-port <P> --user postgres
--        --plafon-tranzactie-ms 2000
--   Runnerul pune marcajul (gazpet.livrare_migrare = '20261225a_executie_uscare_ROLLBACK:<txid>') și plafonul; fără ele fișierul refuză.
-- Ordinea (L06, L14): 1. gărzile + starea exactă (doar catalog); 2. lock-urile, NOWAIT, cu bugetul de 1 s de la BEGIN verificat înaintea fiecărei
--   încercări și DUPĂ obținere (un lock luat după prima secundă = refuz, nimic schimbat), în ordinea:
--   executie_uscari, executie_uscare_incarcari, executie_uscare_poze, executie_uscare_jurnal (ACCESS EXCLUSIVE), storage.objects (ACCESS
--   EXCLUSIVE: DROP POLICY), ÎNAINTEA verificării „fără date”; 3. sub lock: starea din nou, „fără date”, DROP-urile, postcondiția.
-- Un SINGUR bloc DO: un refuz e singura instrucțiune care eșuează.
DO $revenire$
DECLARE v_plafon text; v_incercari integer := 0; v_pas integer; r record; v_rau text;
  v_tabele constant text[] := ARRAY['executie_uscari', 'executie_uscare_incarcari', 'executie_uscare_poze', 'executie_uscare_jurnal'];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261225a revenire: garda invalida (fara marcajul runnerului din aceasta tranzactie)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.livrare_migrare=%') THEN
    RAISE EXCEPTION '20261225a revenire: armare persistenta refuzata';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '20261225a revenire: necesita READ COMMITTED (acum %)', current_setting('transaction_isolation');
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION '20261225a revenire: cere PostgreSQL 17 (plafonul tranzactiei)'; END IF;
  SELECT setting || '/' || source INTO v_plafon FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
  IF v_plafon IS DISTINCT FROM '2000/session'
     OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN
    RAISE EXCEPTION '20261225a revenire: PLAFON_TRANZACTIE lipsa: % marcaj % (cerut 2000/session pus de runner inainte de BEGIN + marcajul prologului: livrare_migrare.sh --plafon-tranzactie-ms 2000)',
      coalesce(v_plafon, 'lipsa'), coalesce(nullif(current_setting('gazpet.plafon_tranzactie', true), ''), 'lipsa');
  END IF;
  PERFORM set_config('lock_timeout', '100ms', true);
  PERFORM set_config('search_path', 'public, pg_temp', true);
  FOR v_pas IN 1 .. 2 LOOP
    IF v_pas = 2 THEN
      LOOP
        IF clock_timestamp() >= now() + interval '1 second' THEN
          RAISE EXCEPTION '20261225a revenire: BUGET_LOCK: % incercari, % ms de la BEGIN (bugetul lock-urilor e 1 s de la BEGIN); nimic schimbat',
            v_incercari, round(extract(epoch FROM clock_timestamp() - now()) * 1000) USING ERRCODE = '55P03';
        END IF;
        v_incercari := v_incercari + 1;
        BEGIN
          LOCK TABLE public.executie_uscari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_uscare_incarcari IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_uscare_poze IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE public.executie_uscare_jurnal IN ACCESS EXCLUSIVE MODE NOWAIT;
          LOCK TABLE storage.objects IN ACCESS EXCLUSIVE MODE NOWAIT;
          EXIT;
        EXCEPTION WHEN lock_not_available THEN
          PERFORM pg_sleep(0.05);
        END;
      END LOOP;
      IF clock_timestamp() >= now() + interval '1 second' THEN
        RAISE EXCEPTION '20261225a revenire: BUGET_LOCK: lock-urile obtinute abia la % ms de la BEGIN (% incercari; bugetul e 1 s de la BEGIN); nimic schimbat',
          round(extract(epoch FROM clock_timestamp() - now()) * 1000), v_incercari USING ERRCODE = '55P03';
      END IF;
    END IF;
    IF to_regclass('public.executie_uscari') IS NULL OR to_regclass('public.executie_uscare_incarcari') IS NULL
       OR to_regclass('public.executie_uscare_poze') IS NULL OR to_regclass('public.executie_uscare_jurnal') IS NULL THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, tabele)', v_pas;
    END IF;
    -- coloanele fiecărui tabel: numele + tipul, în ordine (o coloană adăugată / schimbată = alt obiect decât cel creat)
    SELECT string_agg(t.tab, ', ') INTO v_rau FROM (VALUES
        -- COLOANE-START
        ('executie_uscari', 'id:bigint,proiect_id:bigint,proba_id:bigint,tronson:text,km_de_la_m:integer,km_pana_la_m:integer,lungime_m:numeric(8,1),inceput_planificat:timestamp with time zone,notificare_la:timestamp with time zone,notificare_ref:text,data_operatie:date,ora_inceput:timestamp with time zone,ora_final:timestamp with time zone,poz_lat:numeric(8,6),poz_lng:numeric(9,6),poz_sursa:text,poz_precizie_m:numeric(7,1),poz_la:timestamp with time zone,poz_km_m:integer,poz_traseu_versiune:text,temperatura_c:numeric(4,1),temperatura_sursa:text,meteo:jsonb,vreme:text,constructor:text,utilaje:jsonb,pig_metalic_buc:smallint,piston_pu_buc:smallint,bureti_buc:smallint,cantariri:jsonb,punct_roua_c:numeric(4,1),punct_roua_loc:text,presiune_bar:numeric(5,2),timp_deplasare_min:numeric(6,1),piston_final_rezultat:text,poze_justificare:text,observatii:text,concluzie:text,semn_constructor_nume:text,semn_constructor_functie:text,semn_beneficiar_nume:text,semn_beneficiar_functie:text,stare:text,motiv_anulare:text,revizie:smallint,inchis_la:timestamp with time zone,inchis_de:uuid,versiune:integer,creat_de:uuid,creat_la:timestamp with time zone,modificat_de:uuid,modificat_la:timestamp with time zone'),
        ('executie_uscare_incarcari', 'id:bigint,uscare_id:bigint,proiect_id:bigint,cale:text,categorie:text,burete_nr:smallint,legenda:text,renuntat_motiv:text,renuntat_la:timestamp with time zone,renuntat_de:uuid,creat_de:uuid,creat_la:timestamp with time zone'),
        ('executie_uscare_poze', 'id:bigint,uscare_id:bigint,proiect_id:bigint,categorie:text,burete_nr:smallint,cale:text,legenda:text,creat_de:uuid,creat_la:timestamp with time zone'),
        ('executie_uscare_jurnal', 'id:bigint,uscare_id:bigint,proiect_id:bigint,actiune:text,stare_veche:text,stare_noua:text,valori:jsonb,motiv:text,cheie:uuid,amprenta:text,creat_de:uuid,creat_la:timestamp with time zone')
        -- COLOANE-END
      ) t(tab, coloane)
     WHERE t.coloane IS DISTINCT FROM (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum)
                                         FROM pg_attribute a WHERE a.attrelid = ('public.' || t.tab)::regclass AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, coloane: %)', v_pas, v_rau;
    END IF;
    -- drepturile pe tabele, fiecare pe rând: doar SELECT pentru authenticated / service_role; nimic pentru anon, PUBLIC, pe coloane
    SELECT string_agg(DISTINCT x.tab || '/' || y.rol || '/' || z.drept, ', ') INTO v_rau
      FROM unnest(v_tabele) x(tab), unnest(ARRAY['anon', 'authenticated', 'service_role']) y(rol),
           unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) z(drept)
     WHERE has_table_privilege(y.rol, ('public.' || x.tab)::regclass, z.drept) IS DISTINCT FROM (z.drept = 'SELECT' AND y.rol <> 'anon');
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_class c ON c.oid = ('public.' || x.tab)::regclass
                    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e WHERE e.grantee = 0)
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_attribute a ON a.attrelid = ('public.' || x.tab)::regclass WHERE a.attnum > 0 AND a.attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x(tab) JOIN pg_class c ON c.oid = ('public.' || x.tab)::regclass
                   WHERE NOT c.relrowsecurity OR c.relforcerowsecurity OR pg_get_userbyid(c.relowner) <> 'postgres') THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, drepturi / RLS: %)', v_pas, coalesce(v_rau, 'PUBLIC / coloane / RLS / proprietar');
    END IF;
    -- ACL-ul EXACT (runda 3): pe tabele doar proprietarul + SELECT (fără GRANT OPTION) pentru authenticated / service_role, niciun alt rol;
    -- pe secvențele de identitate doar proprietarul (postgres)
    SELECT string_agg(DISTINCT c.relname || '/' || CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END || '/' || e.privilege_type, ', ') INTO v_rau
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) e
     WHERE c.oid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x
                     UNION ALL SELECT pg_get_serial_sequence('public.' || x, 'id')::regclass FROM unnest(v_tabele) x)
       AND e.grantee <> c.relowner
       AND NOT (c.relkind = 'r' AND e.grantee IN ('authenticated'::regrole::oid, 'service_role'::regrole::oid) AND e.privilege_type = 'SELECT' AND NOT e.is_grantable);
    IF v_rau IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(v_tabele) x WHERE pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = pg_get_serial_sequence('public.' || x, 'id')::regclass)) IS DISTINCT FROM 'postgres') THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, drepturi ACL: %)', v_pas, coalesce(v_rau, 'proprietarul secventei');
    END IF;
    -- STRUCTURA fiecărui tabel (runda 3): coloanele (nume, tip, NOT NULL, valoarea implicită, identitate, generare, colație), constrângerile
    -- (nume, tip, validată, definiția; fără rândurile NOT NULL ale PG18, acoperite de attnotnull), indecșii (definiția), opțiunile, parametrii
    -- secvenței de identitate; o amprentă md5 pe tabel. Mesajul de refuz dă amprenta găsită (diagnostic), nu o acceptă.
    SELECT string_agg(t.tab || ' (gasit ' || x.amp || ')', ', ') INTO v_rau FROM (VALUES
        -- STRUCTURA-START
        ('executie_uscari', '456ffbdfe2fa4fcca58456e96f134a24'),
        ('executie_uscare_incarcari', '846d5be8353da7e23a0e6a604b315b17'),
        ('executie_uscare_poze', 'ed428e6233195f5f5f10c1bbf15d58e7'),
        ('executie_uscare_jurnal', 'c243a2121d6ca337fd6765c750c4e9d1')
        -- STRUCTURA-END
      ) t(tab, amp)
      CROSS JOIN LATERAL (SELECT md5(concat_ws(E'\n',
        (SELECT string_agg(format('c %s|%s|%s|%s|%s|%s|%s', a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                                  coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity, a.attgenerated, a.attcollation), E'\n' ORDER BY a.attnum)
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = ('public.' || t.tab)::regclass AND a.attnum > 0 AND NOT a.attisdropped),
        (SELECT string_agg(format('k %s|%s|%s|%s', k.conname, k.contype, k.convalidated, pg_get_constraintdef(k.oid)), E'\n' ORDER BY k.conname)
           FROM pg_constraint k WHERE k.conrelid = ('public.' || t.tab)::regclass AND k.contype <> 'n'),
        (SELECT string_agg(format('i %s', pg_get_indexdef(i.indexrelid)), E'\n' ORDER BY ic.relname)
           FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = ('public.' || t.tab)::regclass),
        (SELECT format('o %s|%s|%s', c.relpersistence, coalesce(array_to_string(c.reloptions, ','), ''), c.relreplident)
           FROM pg_class c WHERE c.oid = ('public.' || t.tab)::regclass),
        (SELECT string_agg(format('s %s|%s|%s|%s|%s|%s|%s', s.seqtypid::regtype, s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle), E'\n')
           FROM pg_sequence s WHERE s.seqrelid = pg_get_serial_sequence('public.' || t.tab, 'id')::regclass))) AS amp) x
     WHERE x.amp IS DISTINCT FROM t.amp;
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, structura: %)', v_pas, v_rau;
    END IF;
    -- politicile: EXACT cele 4 + 2, fiecare cu definiția ei (comanda, permisivă, rolurile, expresiile)
    SELECT string_agg(coalesce(a.nume, p.polname), ', ') INTO v_rau
      FROM (VALUES
        ('public.executie_uscari'::regclass, 'executie_uscari_citire', 'r', 'fn_executie_nod_drept(proiect_id, false)', NULL::text),
        ('public.executie_uscare_incarcari'::regclass, 'executie_uscare_incarcari_citire', 'r', 'fn_executie_nod_drept(proiect_id, false)', NULL),
        ('public.executie_uscare_poze'::regclass, 'executie_uscare_poze_citire', 'r', 'fn_executie_nod_drept(proiect_id, false)', NULL),
        ('public.executie_uscare_jurnal'::regclass, 'executie_uscare_jurnal_citire', 'r', 'fn_executie_nod_drept(proiect_id, false)', NULL),
        ('storage.objects'::regclass, 'executie_uscare_citire', 'r', '((bucket_id = ''executie-uscare''::text) AND fn_executie_uscare_obiect(bucket_id, name, false))', NULL),
        ('storage.objects'::regclass, 'executie_uscare_adauga', 'a', NULL, '((bucket_id = ''executie-uscare''::text) AND fn_executie_uscare_obiect(bucket_id, name, true))')
      ) a(rel, nume, cmd, qual, chk)
      FULL JOIN (SELECT * FROM pg_policy WHERE polrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_incarcari'::regclass,
                   'public.executie_uscare_poze'::regclass, 'public.executie_uscare_jurnal'::regclass)
                   OR (polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_uscare\_%')) p
        ON p.polrelid = a.rel AND p.polname = a.nume
     WHERE a.nume IS NULL OR p.oid IS NULL OR p.polcmd::text IS DISTINCT FROM a.cmd OR NOT p.polpermissive
        OR p.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
        OR replace(pg_get_expr(p.polqual, p.polrelid), 'public.', '') IS DISTINCT FROM a.qual
        OR replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', '') IS DISTINCT FROM a.chk;
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, politici: %)', v_pas, v_rau;
    END IF;
    -- trigger-ele: EXACT cele 8, fiecare cu funcția, tipul, activ, fără WHEN / argumente / coloane
    SELECT string_agg(coalesce(a.nume, tg.tgname), ', ') INTO v_rau
      FROM (VALUES
        ('public.executie_uscari'::regclass, 'trg_executie_uscare_garda', 'public.fn_executie_uscare_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_incarcari'::regclass, 'trg_executie_uscare_incarcare_garda', 'public.fn_executie_uscare_incarcare_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_poze'::regclass, 'trg_executie_uscare_poza_garda', 'public.fn_executie_uscare_poza_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscare_jurnal'::regclass, 'trg_executie_uscare_jurnal_garda', 'public.fn_executie_uscare_jurnal_garda()', 1 | 2 | 4 | 8 | 16),
        ('public.executie_uscari'::regclass, 'trg_executie_uscare_fara_golire', 'public.fn_executie_uscare_fara_golire()', 2 | 32),
        ('public.executie_uscare_incarcari'::regclass, 'trg_executie_uscare_incarcari_fara_golire', 'public.fn_executie_uscare_fara_golire()', 2 | 32),
        ('public.executie_uscare_poze'::regclass, 'trg_executie_uscare_poze_fara_golire', 'public.fn_executie_uscare_fara_golire()', 2 | 32),
        ('public.executie_uscare_jurnal'::regclass, 'trg_executie_uscare_jurnal_fara_golire', 'public.fn_executie_uscare_fara_golire()', 2 | 32)
      ) a(rel, nume, fn, tip)
      FULL JOIN (SELECT * FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.executie_uscari'::regclass, 'public.executie_uscare_incarcari'::regclass,
                   'public.executie_uscare_poze'::regclass, 'public.executie_uscare_jurnal'::regclass)) tg
        ON tg.tgrelid = a.rel AND tg.tgname = a.nume
     WHERE a.nume IS NULL OR tg.oid IS NULL OR tg.tgfoid IS DISTINCT FROM to_regprocedure(a.fn) OR tg.tgtype IS DISTINCT FROM a.tip::int2
        OR tg.tgenabled IS DISTINCT FROM 'O' OR tg.tgqual IS NOT NULL OR tg.tgnargs <> 0 OR coalesce(array_length(tg.tgattr::int2[], 1), 0) <> 0;
    IF v_rau IS NOT NULL THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, trigger-e: %)', v_pas, v_rau;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare' AND name = 'executie-uscare' AND public IS FALSE
                     AND file_size_limit = 10485760 AND allowed_mime_types = ARRAY['image/jpeg']) THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, bucket: altă configurație)', v_pas;
    END IF;
    -- funcțiile: exact cele 17, fiecare cu corpul revizuit (amprenta fără CR), limbajul, DEFINER-ul, search_path-ul, proprietarul, EXECUTE
    SELECT string_agg(a.fn, ', ') INTO v_rau FROM (VALUES
        -- AMPRENTE-START
        ('public.fn_executie_uscare_utilaje_ok(jsonb)', 'sql', false, '5950452f25882bc1f1e087fde7dd7ad5'),
        ('public.fn_executie_uscare_cantariri_ok(jsonb)', 'sql', false, 'b2b7beb9b33adb5234f10201a32efbc0'),
        ('public.fn_executie_uscare_meteo_ok(jsonb)', 'sql', false, '6cfd85f84c26d390fc6ba4eb24d8443c'),
        ('public.fn_executie_uscare_poze_lipsa(public.executie_uscari, jsonb)', 'sql', false, '77b9e149472ef2fdcf8777129788ea9a'),
        ('public.fn_executie_uscare_lipsa(public.executie_uscari, jsonb, integer)', 'sql', false, 'b1e1fa06e3088887150a62da7661fb9d'),
        ('public.fn_executie_uscare_lipsa_raport(public.executie_uscari)', 'sql', false, '0ed0119211719a15740601bd2182641c'),
        ('public.fn_executie_uscare_tranzitie(text, text)', 'sql', false, '2576d2a04c4a2177ac35cfd79c0ea84c'),
        ('public.fn_executie_uscare_garda()', 'plpgsql', false, 'eb89e5502b231f05132283b7ccf1db89'),
        ('public.fn_executie_uscare_poza_garda()', 'plpgsql', false, '61e054fed73b139da295212b69fbff6a'),
        ('public.fn_executie_uscare_incarcare_garda()', 'plpgsql', false, '2599ca1f5feab4f0da29e69758ec984d'),
        ('public.fn_executie_uscare_jurnal_garda()', 'plpgsql', false, 'f6b8159d9439e6bd046fc4766d3076a9'),
        ('public.fn_executie_uscare_fara_golire()', 'plpgsql', false, '1b0ebeecc0b85f90e433e344a10524f4'),
        ('public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid)', 'plpgsql', true, '65c38443b4bc4b9510ae26773aeb6924'),
        ('public.fn_executie_uscare_stare(bigint, integer, text, text, uuid)', 'plpgsql', true, 'deab7a030187d84d2acfc4a5ef3990a6'),
        ('public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid)', 'plpgsql', true, 'cf553d55e76fd487809df8ae6c1e21a8'),
        ('public.fn_executie_uscare_obiect(text, text, boolean)', 'sql', true, '98336ee3ff2579f4e39618b8a874c6fa'),
        ('public.fn_executie_uscare_retrage(bigint, uuid)', 'plpgsql', true, 'ce7d5d890b65e4430f1e8b1b7cafb1ba'),
        -- AMPRENTE-END
        ('', '', false, '')
      ) a(fn, limbaj, definer, amp)
      WHERE a.fn <> '' AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                         WHERE p.oid = to_regprocedure(a.fn) AND l.lanname = a.limbaj AND p.prosecdef = a.definer
                           AND md5(replace(p.prosrc, chr(13), '')) = a.amp
                           AND pg_get_userbyid(p.proowner) = 'postgres' AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public, pg_temp']
                           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = (a.definer)
                           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0));
    IF v_rau IS NOT NULL
       OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%') <> 17 THEN
      RAISE EXCEPTION '20261225a revenire: starea nu e cea din 20261225a (pasul %, functii: %)', v_pas, coalesce(v_rau, 'alt numar');
    END IF;
    -- nimic din afara migrării nu depinde de obiectele ei: vederi / chei străine spre tabele, funcții care le numesc, alte politici
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
                WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x))
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f'
                   AND c.confrelid IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x)
                   AND c.conrelid NOT IN (SELECT ('public.' || x)::regclass FROM unnest(v_tabele) x))
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast_)?temp_'
                     AND p.proname NOT LIKE 'fn\_executie\_uscare\_%'
                     AND p.prosrc ~ '\m(executie_uscari|executie_uscare_incarcari|executie_uscare_poze|executie_uscare_jurnal|fn_executie_uscare_[a-z_]+)\M')
       OR EXISTS (SELECT 1 FROM pg_policies WHERE NOT (schemaname = 'storage' AND tablename = 'objects' AND policyname IN ('executie_uscare_citire', 'executie_uscare_adauga'))
                   AND NOT (schemaname = 'public' AND tablename = ANY (v_tabele))
                   AND coalesce(qual, '') || coalesce(with_check, '') ~ '(executie-uscare|fn_executie_uscare_)') THEN
      RAISE EXCEPTION '20261225a revenire: alte obiecte depind de obiectele migrarii (vederi / chei straine / functii / politici)';
    END IF;
  END LOOP;
  -- sub lock: fără date (rapoartele de uscare sunt documente semnate și nu se șterg de aici)
  IF EXISTS (SELECT 1 FROM public.executie_uscari) OR EXISTS (SELECT 1 FROM public.executie_uscare_incarcari) OR EXISTS (SELECT 1 FROM public.executie_uscare_poze)
     OR EXISTS (SELECT 1 FROM public.executie_uscare_jurnal) OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'executie-uscare') THEN
    RAISE EXCEPTION '20261225a revenire: exista rapoarte / rezervari / poze / jurnal / fisiere de uscare (nu se sterg de aici)';
  END IF;
  DROP POLICY executie_uscare_citire ON storage.objects;
  DROP POLICY executie_uscare_adauga ON storage.objects;
  -- Storage poate refuza ștergerile directe din tabelele lui (trigger de protecție, comutat de această setare locală tranzacției);
  -- bucket-ul e gol (verificat mai sus, sub lock)
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.buckets WHERE id = 'executie-uscare';
  -- funcțiile cu parametrul de tipul rândului executie_uscari ies înaintea tabelului (trigger-ul le cheamă doar prin nume)
  DROP FUNCTION public.fn_executie_uscare_lipsa_raport(public.executie_uscari);
  DROP FUNCTION public.fn_executie_uscare_lipsa(public.executie_uscari, jsonb, integer);
  DROP FUNCTION public.fn_executie_uscare_poze_lipsa(public.executie_uscari, jsonb);
  DROP TABLE public.executie_uscare_jurnal;
  DROP TABLE public.executie_uscare_poze;
  DROP TABLE public.executie_uscare_incarcari;
  DROP TABLE public.executie_uscari;
  DROP FUNCTION public.fn_executie_uscare_salveaza(bigint, bigint, integer, jsonb, uuid);
  DROP FUNCTION public.fn_executie_uscare_stare(bigint, integer, text, text, uuid);
  DROP FUNCTION public.fn_executie_uscare_poza(bigint, text, bigint, text, text, integer, text, uuid);
  DROP FUNCTION public.fn_executie_uscare_obiect(text, text, boolean);
  DROP FUNCTION public.fn_executie_uscare_retrage(bigint, uuid);
  DROP FUNCTION public.fn_executie_uscare_garda();
  DROP FUNCTION public.fn_executie_uscare_poza_garda();
  DROP FUNCTION public.fn_executie_uscare_incarcare_garda();
  DROP FUNCTION public.fn_executie_uscare_jurnal_garda();
  DROP FUNCTION public.fn_executie_uscare_fara_golire();
  DROP FUNCTION public.fn_executie_uscare_tranzitie(text, text);
  DROP FUNCTION public.fn_executie_uscare_utilaje_ok(jsonb);
  DROP FUNCTION public.fn_executie_uscare_cantariri_ok(jsonb);
  DROP FUNCTION public.fn_executie_uscare_meteo_ok(jsonb);
  IF to_regclass('public.executie_uscari') IS NOT NULL OR to_regclass('public.executie_uscare_incarcari') IS NOT NULL
     OR to_regclass('public.executie_uscare_poze') IS NOT NULL OR to_regclass('public.executie_uscare_jurnal') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'fn\_executie\_uscare\_%')
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'executie-uscare')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'executie\_uscare\_%') THEN
    RAISE EXCEPTION '20261225a revenire post: au ramas obiecte';
  END IF;
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261225a_executie_uscare_ROLLBACK:' || txid_current() THEN
    RAISE EXCEPTION '20261225a revenire: garda final invalida';
  END IF;
  RAISE NOTICE '20261225a revenire: sfarsit la % ms de la BEGIN', round(extract(epoch FROM clock_timestamp() - now()) * 1000);
END $revenire$;
