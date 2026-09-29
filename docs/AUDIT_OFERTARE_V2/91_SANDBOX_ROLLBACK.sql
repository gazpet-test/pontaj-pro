-- NU migrare. Preview implicit; apply numai după GO separat pe COUNT-urile afișate.
-- Completați ID-ul din CLONA_ID; nu căutăm automat o licitație după un LIKE larg.
-- Întregul DO este atomic. Păstrați NOTICE RETURNING (rândurile șterse) pentru restaurare.
-- Nu șterge storage. ÎNAINTE de DELETE salvați inventarul exact din rânduri și
-- din manifestul de copiere: sandbox-v2/5/ este doar copia inițială. UI-ul urcă
-- documente noi în <CLONA_ID>/atribuire/ și pachete în pt/<CLONA_ID>/; alte căi
-- de upload se verifică din inventar. Ștergerea lor cere preview + GO separat.
-- Nu eliminați 5/atribuire/, pt/5/ sau fișierele catalogului global.
-- Descoperă inclusiv copiii creați de scenarii (pachete, dovezi, cozi etc.).
-- Un trigger de imutabilitate / o dependență necunoscută anulează tot; nu îl dezactivăm.
DO $$
DECLARE
  v_mod text := 'preview';
  v_clona bigint := NULL; -- parametrul CLONA_ID; obligatoriu și în preview
  v_targets jsonb := '{}'::jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_ids jsonb; v_rows jsonb; v_all jsonb; v_meta jsonb;
  v_where text; v_hash text;
  v_count bigint; v_prev bigint; v_progress bigint; v_remaining bigint; v_n bigint;
  t record; f record;
BEGIN
  IF v_mod NOT IN ('preview','apply') THEN RAISE EXCEPTION 'Mod invalid'; END IF;
  IF v_clona IS NULL OR v_clona=5 THEN RAISE EXCEPTION 'Completați ID-ul clonei, diferit de 5'; END IF;
  SELECT to_jsonb(l) INTO v_meta FROM public.ofertare_licitatii l WHERE id=v_clona;
  IF v_meta IS NULL OR v_meta->>'nr_anunt'<>'SANDBOX-V2-DOMNESTI'
    OR coalesce(v_meta->>'observatii','') NOT LIKE '%[AUDIT V2 SANDBOX sursa=5]%'
    OR v_meta->>'c_notice_id' IS NOT NULL OR v_meta->>'link_seap' IS NOT NULL THEN
    RAISE EXCEPTION 'Guard: ID-ul nu este clona audit V2 izolată';
  END IF;
  IF v_mod='apply' THEN
    PERFORM pg_advisory_xact_lock(20260928,5);
    PERFORM 1 FROM public.ofertare_licitatii WHERE id=v_clona FOR UPDATE;
  END IF;
  -- În schema reală există tabele cu PK cerinta_id / licitatie_id, fără id
  -- (titular, subiect, ingest_state). Urmărim cheia primară unică declarată.
  SELECT coalesce(jsonb_object_agg(c.relname,a.attname),'{}') INTO v_keys
    FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    JOIN pg_constraint pk ON pk.conrelid=c.oid AND pk.contype='p' AND cardinality(pk.conkey)=1
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=pk.conkey[1]
    WHERE ns.nspname='public' AND c.relkind IN ('r','p');
  IF v_keys->>'ofertare_licitatii' IS DISTINCT FROM 'id' THEN RAISE EXCEPTION 'PK licitație neașteptată'; END IF;
  v_targets:=jsonb_build_object('ofertare_licitatii',jsonb_build_array(v_clona));
  -- Rânduri directe, apoi închidere tranzitivă pe FK + cheile logice cunoscute.
  -- Nu presupunem că istoricul live are FK declarat: cerinta_id este urmărit și logic.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='licitatie_id' AND NOT a.attisdropped
    WHERE ns.nspname='public' AND c.relkind IN ('r','p')
      AND (c.relname LIKE 'ofertare_%' OR c.relname LIKE 'grafic_%')
  LOOP
    IF NOT v_keys?t.relname THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE licitatie_id=$1',t.relname) INTO v_count USING v_clona;
      IF v_count>0 THEN RAISE EXCEPTION 'Tabel fără PK simplă: %; rollback explicit necesar',t.relname; END IF;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(%I),''[]'') FROM public.%I WHERE licitatie_id=$1',v_keys->>t.relname,t.relname) INTO v_ids USING v_clona;
    IF jsonb_array_length(v_ids)>0 THEN v_targets:=v_targets||jsonb_build_object(t.relname,v_ids); END IF;
  END LOOP;
  LOOP
    SELECT sum(jsonb_array_length(value)) INTO v_prev FROM jsonb_each(v_targets);
    FOR f IN
      SELECT DISTINCT child.relname AS enfant,parent.relname AS parinte,ca.attname AS coloana,
        cardinality(c.conkey) AS aritate,pa.attname AS cheie
      FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid
      JOIN pg_class parent ON parent.oid=c.confrelid
      JOIN pg_namespace cn ON cn.oid=child.relnamespace
      JOIN pg_namespace pn ON pn.oid=parent.relnamespace
      JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=c.confkey[1]
      WHERE c.contype='f' AND cn.nspname='public' AND pn.nspname='public' AND v_targets?parent.relname
      UNION
      SELECT c.relname,m.parinte,a.attname,1,'id'
      FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND NOT a.attisdropped
      JOIN (VALUES ('cerinta_id','ofertare_cerinte'),('capitol_id','ofertare_pt_capitole'),
        ('acoperire_id','ofertare_acoperire'),('cantitate_id','ofertare_cantitati'),
        ('clarificare_id','ofertare_clarificari'),('pachet_id','ofertare_pt_pachet'),
        ('legatura_id','ofertare_pt_legaturi'),('document_id','ofertare_documente_atribuire')) m(coloana,parinte)
        ON a.attname=m.coloana
      WHERE ns.nspname='public' AND c.relkind IN ('r','p')
        AND (c.relname LIKE 'ofertare_%' OR c.relname LIKE 'grafic_%') AND v_targets?m.parinte
    LOOP
      IF f.aritate<>1 OR f.cheie IS DISTINCT FROM v_keys->>f.parinte THEN RAISE EXCEPTION 'FK compusă/altă cheie: % -> %',f.enfant,f.parinte; END IF;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text IN (SELECT jsonb_array_elements_text($1))',f.enfant,f.coloana)
        INTO v_count USING v_targets->f.parinte;
      IF v_count=0 THEN CONTINUE; END IF;
      IF (f.enfant NOT LIKE 'ofertare_%' AND f.enfant NOT LIKE 'grafic_%') OR NOT v_keys?f.enfant
        THEN RAISE EXCEPTION 'Dependență externă/fără PK simplă: %; rollback refuzat',f.enfant; END IF;
      EXECUTE format('SELECT jsonb_agg(%I) FROM public.%I WHERE %I::text IN (SELECT jsonb_array_elements_text($1))',v_keys->>f.enfant,f.enfant,f.coloana)
        INTO v_ids USING v_targets->f.parinte;
      SELECT jsonb_agg(DISTINCT value) INTO v_all FROM jsonb_array_elements(coalesce(v_targets->f.enfant,'[]')||v_ids);
      v_targets:=v_targets||jsonb_build_object(f.enfant,v_all);
    END LOOP;
    SELECT sum(jsonb_array_length(value)) INTO v_count FROM jsonb_each(v_targets);
    EXIT WHEN v_count=v_prev;
  END LOOP;
  FOR t IN SELECT key AS tabela,value AS ids FROM jsonb_each(v_targets) ORDER BY key LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY %I),''[]'') FROM public.%I s WHERE %I::text IN (SELECT jsonb_array_elements_text($1))',v_keys->>t.tabela,t.tabela,v_keys->>t.tabela)
      INTO v_rows USING t.ids;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE
      (r->>'licitatie_id' IS NOT NULL AND (r->>'licitatie_id')::bigint<>v_clona)
      OR (t.tabela='ofertare_licitatii' AND (r->>'id')::bigint<>v_clona)) THEN
      RAISE EXCEPTION 'Dependență către altă licitație: %; nimic șters',t.tabela;
    END IF;
    FOR f IN SELECT * FROM (VALUES ('cerinta_id','ofertare_cerinte'),
      ('capitol_id','ofertare_pt_capitole'),('acoperire_id','ofertare_acoperire'),
      ('cantitate_id','ofertare_cantitati'),('clarificare_id','ofertare_clarificari'),
      ('pachet_id','ofertare_pt_pachet'),('legatura_id','ofertare_pt_legaturi')) m(coloana,parinte)
    LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE x->>f.coloana IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(v_targets->f.parinte,'[]')) z(id)
          WHERE z.id=x->>f.coloana)) THEN
        RAISE EXCEPTION 'Rând mixt sandbox/original în %.%; rollback refuzat',t.tabela,f.coloana;
      END IF;
    END LOOP;
    RAISE NOTICE 'PREVIEW DELETE %: %',t.tabela,jsonb_array_length(t.ids);
    v_before:=v_before||jsonb_build_object(t.tabela,md5(v_rows::text));
  END LOOP;
  IF v_mod='preview' THEN RETURN; END IF;
  CREATE TEMP TABLE map_audit_v2_rollback(tabela text PRIMARY KEY,ids jsonb,md5_inainte text,terminat boolean DEFAULT false) ON COMMIT DROP;
  CREATE TEMP TABLE map_audit_v2_sursa(tabela text PRIMARY KEY,predicat text,amprenta text) ON COMMIT DROP;
  INSERT INTO map_audit_v2_rollback(tabela,ids,md5_inainte)
    SELECT key,value,v_before->>key FROM jsonb_each(v_targets);
  -- Blocăm fiecare rând inventariat înainte de prima ștergere. FK-urile noi care
  -- ar indica acești părinți așteaptă tranzacția, nu apar după inventar.
  FOR t IN SELECT * FROM map_audit_v2_rollback ORDER BY tabela LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY %I),''[]'') FROM (SELECT * FROM public.%I WHERE %I::text IN (SELECT jsonb_array_elements_text($1)) ORDER BY %I FOR UPDATE) s',v_keys->>t.tabela,t.tabela,v_keys->>t.tabela,v_keys->>t.tabela)
      INTO v_rows USING t.ids;
    IF md5(v_rows::text) IS DISTINCT FROM t.md5_inainte THEN RAISE EXCEPTION 'Clona modificată concurent: %; reluați preview',t.tabela; END IF;
  END LOOP;
  -- Snapshot lic. 5: toate rândurile directe și copiii de cerință/capitol/cantitate.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
      (c.relname LIKE 'ofertare_%' OR c.relname LIKE 'grafic_%') LOOP
    v_where:=CASE WHEN t.relname='ofertare_licitatii' THEN 'id=5' ELSE 'false' END;
    FOR f IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass('public.'||t.relname)
      AND NOT attisdropped AND attname IN ('licitatie_id','cerinta_id','capitol_id','cantitate_id','acoperire_id') LOOP
      v_where:=v_where||' OR '||CASE f.attname
        WHEN 'licitatie_id' THEN 'licitatie_id=5'
        WHEN 'cerinta_id' THEN 'cerinta_id IN (SELECT id FROM public.ofertare_cerinte WHERE licitatie_id=5)'
        WHEN 'capitol_id' THEN 'capitol_id IN (SELECT id FROM public.ofertare_pt_capitole WHERE licitatie_id=5)'
        WHEN 'cantitate_id' THEN 'cantitate_id IN (SELECT id FROM public.ofertare_cantitati WHERE licitatie_id=5)'
        ELSE 'acoperire_id IN (SELECT a.id FROM public.ofertare_acoperire a JOIN public.ofertare_cerinte c ON c.id=a.cerinta_id WHERE c.licitatie_id=5)' END;
    END LOOP;
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY to_jsonb(s)::text),'''')) FROM public.%I s WHERE %s',t.relname,v_where) INTO v_hash;
    INSERT INTO map_audit_v2_sursa VALUES(t.relname,v_where,v_hash);
  END LOOP;
  -- Ordine FK inversă calculată la runtime: se încearcă doar seturi exacte de ID-uri;
  -- FK RESTRICT amână părintele. Un ciclu neștergibil produce rollback integral.
  LOOP
    v_progress:=0;
    FOR t IN SELECT * FROM map_audit_v2_rollback WHERE NOT terminat ORDER BY (tabela='ofertare_licitatii'),tabela LOOP
      -- Nu lăsăm CASCADE să sară peste RETURNING-ul copilului. Auto-FK se șterge
      -- în același DELETE; toate FK între tabele așteaptă întâi copilul inventariat.
      IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class ch ON ch.oid=c.conrelid
        JOIN map_audit_v2_rollback m ON m.tabela=ch.relname AND NOT m.terminat
        WHERE c.contype='f' AND c.confrelid=to_regclass('public.'||t.tabela)
          AND c.conrelid<>c.confrelid) THEN CONTINUE; END IF;
      BEGIN
        EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY %I),''[]'') FROM public.%I s WHERE %I::text IN (SELECT jsonb_array_elements_text($1))',v_keys->>t.tabela,t.tabela,v_keys->>t.tabela)
          INTO v_rows USING t.ids;
        IF md5(v_rows::text) IS DISTINCT FROM t.md5_inainte THEN
          RAISE EXCEPTION 'Trigger/cascadă a schimbat rânduri înainte de RETURNING: %',t.tabela;
        END IF;
        EXECUTE format('WITH d AS (DELETE FROM public.%I WHERE %I::text IN (SELECT jsonb_array_elements_text($1)) RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(d)),''[]'') FROM d',t.tabela,v_keys->>t.tabela)
          INTO v_rows USING t.ids;
        v_deleted:=v_deleted||jsonb_build_object(t.tabela,v_rows);
        UPDATE map_audit_v2_rollback SET terminat=true WHERE tabela=t.tabela;
        v_progress:=v_progress+1;
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END LOOP;
    SELECT count(*) INTO v_remaining FROM map_audit_v2_rollback WHERE NOT terminat;
    EXIT WHEN v_remaining=0;
    IF v_progress=0 THEN RAISE EXCEPTION 'Ciclu FK / dependență neinventariată; rollback integral'; END IF;
  END LOOP;
  FOR t IN SELECT * FROM map_audit_v2_rollback ORDER BY tabela LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text IN (SELECT jsonb_array_elements_text($1))',t.tabela,v_keys->>t.tabela) INTO v_n USING t.ids;
    IF v_n<>0 THEN RAISE EXCEPTION 'Rânduri rămase în %',t.tabela; END IF;
    RAISE NOTICE 'COUNT % înainte=% după=%',t.tabela,jsonb_array_length(t.ids),v_n;
    RAISE NOTICE 'RETURNING % %',t.tabela,v_deleted->t.tabela;
  END LOOP;
  FOR t IN SELECT * FROM map_audit_v2_sursa LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY to_jsonb(s)::text),'''')) FROM public.%I s WHERE %s',t.tabela,t.predicat) INTO v_hash;
    IF v_hash IS DISTINCT FROM t.amprenta THEN RAISE EXCEPTION 'Sursa 5 modificată: %; rollback integral',t.tabela; END IF;
  END LOOP;
  RAISE NOTICE 'ROLLBACK sandbox % terminat; snapshot lic.5 neschimbat. Storage încă existent: inventariați sandbox-v2/5/, %/atribuire/, pt/%/ și căile salvate înainte de DELETE; preview + GO separat.',v_clona,v_clona,v_clona;
END $$;
