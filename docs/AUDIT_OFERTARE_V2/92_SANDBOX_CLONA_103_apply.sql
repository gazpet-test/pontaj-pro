-- Audit V2 — varianta EXECUTATĂ a clonei (Claude, 28.09.2026), derivată din 90_SANDBOX_CLONA.sql (Jakarinos).
-- Diferențe față de 90 (motivate de pre-flight-ul pe datele reale ale lic 5):
--   1. id fix 103 pentru licitația-clonă (rezervat prin nextval pe 28.09; storage-ul e deja sub 103/…);
--   2. căile fișierelor: '5/…' → '103/…' (convenția aplicației <licitatie_id>/…, nu sandbox-v2/);
--   3. se clonează și ofertare_acoperire_revizii (1 rând) — istoricul acoperirii (378) îl referă prin revizie_id (FK);
--   4. clarificarea 'raspunsa' se inserează ca 'trimisa' și se trece pe 'raspunsa' prin UPDATE (triggerul refuză INSERT direct);
--   5. harta id-urilor, căile și sanity-ul se scriu în claude_docs (slug audit_v2_clona_103_map) — NOTICE-urile nu ajung prin MCP.
-- Restul (MD5 pe sursă înainte/după, read-back per rând, remapare FK + walker JSON, refuz la orice ambiguitate) e al lui Jakarinos.
-- Rulare: un singur DO, atomic. GO Răzvan 28.09 („ia diff-ul și fă clona"). Rollback: 91_SANDBOX_ROLLBACK.sql cu v_clona=103.
DO $$
DECLARE
  v_mod text := 'apply';
  v_responsabil_id uuid := '10c105d3-536d-4ca6-b943-803592626909'; -- claude@gazpet.ro (ofertare:admin, non-owner)
  v_sursa bigint := 5;
  v_clona_fix constant bigint := 103;
  v_clona bigint;
  v_tabele text[] := ARRAY[
    'ofertare_licitatii','ofertare_documente_atribuire','ofertare_cantitati',
    'ofertare_clarificari','ofertare_cerinte','ofertare_acoperire_revizii','ofertare_acoperire',
    'ofertare_acoperire_istoric','ofertare_pt_capitole',
    'ofertare_pt_capitole_versiuni','ofertare_pt_legaturi',
    'grafic_activitati','grafic_parametri'];
  v_t text; v_where text; v_cols text; v_seq text; v_hash text;
  v_n bigint; v_id bigint;
  v_row jsonb; v_row_ins jsonb; v_status_final text; v_json jsonb; v_maps jsonb := '{}'::jsonb;
  v_before jsonb := '{}'::jsonb; v_counts jsonb := '{}'::jsonb;
  v_paths jsonb := '[]'::jsonb; v_key text; v_target text; v_path text[]; v_cale text;
  r record; f record; j record;
BEGIN
  IF v_mod NOT IN ('preview','apply') THEN RAISE EXCEPTION 'Mod invalid'; END IF;
  IF v_sursa <> 5 THEN RAISE EXCEPTION 'Fixture permis: numai licitația 5'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id=v_sursa)
    THEN RAISE EXCEPTION 'Sursa 5 lipsește'; END IF;
  IF v_mod='apply' THEN
    IF v_responsabil_id IS NULL THEN RAISE EXCEPTION 'Completați responsabil_id după GO'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_responsabil_id) THEN
      RAISE EXCEPTION 'Responsabilul parametrizat nu există';
    END IF;
    PERFORM pg_advisory_xact_lock(20260928,5);
    IF EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE nr_anunt='SANDBOX-V2-DOMNESTI')
      THEN RAISE EXCEPTION 'Clona există deja; refuz duplicarea'; END IF;
    IF EXISTS (SELECT 1 FROM public.ofertare_licitatii WHERE id=v_clona_fix)
      THEN RAISE EXCEPTION 'Id-ul rezervat % e deja ocupat', v_clona_fix; END IF;
  END IF;

  FOREACH v_t IN ARRAY v_tabele LOOP
    IF to_regclass('public.'||v_t) IS NULL THEN RAISE EXCEPTION 'Tabel lipsă: %',v_t; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||v_t)
      AND attname='id' AND NOT attisdropped) THEN RAISE EXCEPTION 'Schema fără id: %; adaptați explicit',v_t; END IF;
    v_where := CASE v_t
      WHEN 'ofertare_licitatii' THEN 'id=5'
      WHEN 'ofertare_acoperire' THEN 'cerinta_id IN (SELECT id FROM public.ofertare_cerinte WHERE licitatie_id=5)'
      WHEN 'ofertare_pt_legaturi' THEN 'cerinta_id IN (SELECT id FROM public.ofertare_cerinte WHERE licitatie_id=5)'
      WHEN 'ofertare_pt_capitole_versiuni' THEN 'capitol_id IN (SELECT id FROM public.ofertare_pt_capitole WHERE licitatie_id=5)'
      WHEN 'ofertare_acoperire_istoric' THEN 'cerinta_id IN (SELECT id FROM public.ofertare_cerinte WHERE licitatie_id=5)'
      ELSE 'licitatie_id=5' END;
    EXECUTE format('SELECT count(*),md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY id),'''')) FROM public.%I s WHERE %s',v_t,v_where)
      INTO v_n,v_hash;
    RAISE NOTICE 'PREVIEW %: %',v_t,v_n;
    v_before := v_before || jsonb_build_object(v_t,jsonb_build_object('where',v_where,'md5',v_hash));
    v_counts := v_counts || jsonb_build_object(v_t,v_n);
  END LOOP;
  IF v_mod='preview' THEN RETURN; END IF;

  CREATE TEMP TABLE map_audit_v2(tabela text, id_vechi bigint, id_nou bigint,
    rand_sursa jsonb, rand_clona jsonb, PRIMARY KEY(tabela,id_vechi), UNIQUE(tabela,id_nou)) ON COMMIT DROP;
  CREATE TEMP TABLE map_audit_v2_sanity(tabela text PRIMARY KEY,sursa bigint,clona bigint,md5_sursa text) ON COMMIT DROP;
  FOREACH v_t IN ARRAY v_tabele LOOP
    v_where := v_before->v_t->>'where';
    v_seq := pg_get_serial_sequence('public.'||v_t,'id');
    IF v_seq IS NULL THEN RAISE EXCEPTION 'Fără secvență id pentru %',v_t; END IF;
    FOR r IN EXECUTE format('SELECT to_jsonb(s) AS val FROM public.%I s WHERE %s ORDER BY id FOR SHARE',v_t,v_where) LOOP
      v_id := CASE WHEN v_t='ofertare_licitatii' THEN v_clona_fix ELSE nextval(v_seq::regclass) END;
      INSERT INTO map_audit_v2(tabela,id_vechi,id_nou,rand_sursa)
        VALUES(v_t,(r.val->>'id')::bigint,v_id,r.val);
    END LOOP;
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY id),'''')) FROM public.%I s WHERE %s',v_t,v_where) INTO v_hash;
    IF v_hash IS DISTINCT FROM v_before->v_t->>'md5' THEN RAISE EXCEPTION 'Sursa modificată concurent: %, reluați preview',v_t; END IF;
  END LOOP;
  SELECT id_nou INTO STRICT v_clona FROM map_audit_v2 WHERE tabela='ofertare_licitatii' AND id_vechi=5;
  IF v_clona <> v_clona_fix THEN RAISE EXCEPTION 'Id clonă neașteptat: %', v_clona; END IF;
  SELECT jsonb_object_agg(tabela,ids) INTO v_maps FROM
    (SELECT tabela,jsonb_object_agg(id_vechi::text,id_nou) ids FROM map_audit_v2 GROUP BY tabela) s;

  FOREACH v_t IN ARRAY v_tabele LOOP
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO v_cols FROM pg_attribute
      WHERE attrelid=to_regclass('public.'||v_t) AND attnum>0 AND NOT attisdropped AND attgenerated='';
    FOR r IN SELECT * FROM map_audit_v2 WHERE tabela=v_t ORDER BY id_vechi LOOP
      v_row := r.rand_sursa || jsonb_build_object('id',r.id_nou);
      FOR f IN SELECT c.conname,pa.attname AS col,rt.relname AS destinatie,
        cardinality(c.conkey) AS aritate,ra.attname AS cheie
        FROM pg_constraint c JOIN pg_class rt ON rt.oid=c.confrelid
        JOIN pg_namespace ns ON ns.oid=rt.relnamespace
        JOIN pg_attribute pa ON pa.attrelid=c.conrelid AND pa.attnum=c.conkey[1]
        JOIN pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=c.confkey[1]
        WHERE c.contype='f' AND c.conrelid=to_regclass('public.'||v_t) AND ns.nspname='public'
      LOOP
        IF v_row->f.col IS NULL OR v_row->f.col='null'::jsonb THEN CONTINUE; END IF;
        IF f.col IN ('raspuns_set_id','sursa_pack_id') THEN v_row:=jsonb_set(v_row,ARRAY[f.col],'null'); CONTINUE; END IF;
        IF f.destinatie=ANY(v_tabele) THEN
          IF f.aritate<>1 OR f.cheie<>'id' THEN RAISE EXCEPTION 'FK neacceptată: %',f.conname; END IF;
          v_json := v_maps->f.destinatie->(v_row->>f.col);
          IF v_json IS NULL THEN RAISE EXCEPTION 'FK în afara sursei: %.%=%',v_t,f.col,v_row->>f.col; END IF;
          IF f.col NOT IN ('licitatie_id','cerinta_id','acoperire_id','capitol_id','cantitate_id',
             'document_id','doc_id','sursa_document_id','document_sursa_id','raspuns_document_id',
             'raspuns_clarificare_id','clarificare_id','inlocuita_de','duplicat_al','activitate_id') THEN
            v_row:=jsonb_set(v_row,ARRAY[f.col],v_json);
          END IF;
        ELSIF f.destinatie LIKE 'ofertare_%' AND f.destinatie NOT IN
          ('ofertare_parteneri','ofertare_experienta','ofertare_parteneri_documente') THEN
          RAISE EXCEPTION 'FK locală spre tabel neclonat: %.% -> %; revizie explicită necesară',v_t,f.col,f.destinatie;
        END IF;
      END LOOP;
      FOR j IN WITH RECURSIVE walk(p,val) AS (
        SELECT ARRAY[]::text[],v_row
        UNION ALL
        SELECT w.p||x.k,x.val FROM walk w CROSS JOIN LATERAL (
          SELECT key k,value val FROM jsonb_each(CASE WHEN jsonb_typeof(w.val)='object' THEN w.val ELSE '{}'::jsonb END)
          UNION ALL
          SELECT (ordinality-1)::text,value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.val)='array' THEN w.val ELSE '[]'::jsonb END) WITH ORDINALITY
        ) x
      ) SELECT p,val FROM walk WHERE cardinality(p)>0 AND jsonb_typeof(val) NOT IN ('object','array','null') LOOP
        v_path:=j.p; v_key:=v_path[cardinality(v_path)]; v_target:=NULL;
        IF cardinality(v_path)=1 AND v_key='id' THEN CONTINUE; END IF;
        IF v_key IN ('raspuns_set_id','sursa_pack_id') THEN v_row:=jsonb_set(v_row,v_path,'null'); CONTINUE; END IF;
        v_target := CASE
          WHEN v_key='licitatie_id' THEN 'ofertare_licitatii'
          WHEN v_key IN ('cerinta_id','inlocuita_de','duplicat_al') THEN 'ofertare_cerinte'
          WHEN v_key='acoperire_id' THEN 'ofertare_acoperire'
          WHEN v_key='capitol_id' THEN 'ofertare_pt_capitole'
          WHEN v_key='cantitate_id' THEN 'ofertare_cantitati'
          WHEN v_key IN ('document_id','doc_id','sursa_document_id','document_sursa_id','raspuns_document_id') THEN 'ofertare_documente_atribuire'
          WHEN v_key IN ('raspuns_clarificare_id','clarificare_id') THEN 'ofertare_clarificari'
          WHEN v_key='activitate_id' OR (v_key='id' AND 'predecesori'=ANY(v_path)) THEN 'grafic_activitati'
          WHEN v_key='id' AND v_t='ofertare_acoperire_istoric'
            AND (v_row#>v_path[1:cardinality(v_path)-1])?'cerinta_id'
            AND (v_row#>v_path[1:cardinality(v_path)-1])?'verificat_pe_scan'
            THEN 'ofertare_acoperire'
          ELSE NULL END;
        IF v_target IS NOT NULL THEN
          v_json:=v_maps->v_target->(j.val#>>'{}');
          IF v_json IS NULL THEN RAISE EXCEPTION 'Referință locală fără mapare %.%=%',v_t,array_to_string(v_path,'.'),j.val; END IF;
          v_row:=jsonb_set(v_row,v_path,v_json);
        ELSIF v_key='id' AND cardinality(v_path)>1 AND jsonb_typeof(j.val)='number' THEN
          RAISE EXCEPTION 'ID JSON ambiguu %.%; necesită mapare explicită',v_t,array_to_string(v_path,'.');
        ELSIF jsonb_typeof(j.val)='number' AND (
          (v_key LIKE '%\_id' ESCAPE '\' AND v_key NOT IN
            ('autorizatie_id','doc_firma_id','partener_id','experienta_id','document_personal_id',
             'recomandare_id','employee_id','angajat_id','proiect_id','c_notice_id','sys_notice_type_id'))
          OR (cardinality(v_path)>1 AND v_path[cardinality(v_path)-1] LIKE '%\_ids' ESCAPE '\')) THEN
          IF cardinality(v_path)>1 OR NOT EXISTS (SELECT 1 FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
            WHERE c.contype='f' AND c.conrelid=to_regclass('public.'||v_t) AND a.attname=v_key) THEN
            RAISE EXCEPTION 'ID numeric neclasificat %.%; adaptați maparea',v_t,array_to_string(v_path,'.');
          END IF;
        ELSIF v_key IN ('fisier_path','cale_storage','storage_path') AND (j.val#>>'{}')<>'' THEN
          v_cale := j.val#>>'{}';
          IF v_cale NOT LIKE '5/%' THEN
            IF v_t NOT IN ('ofertare_acoperire','ofertare_acoperire_istoric') THEN
              RAISE EXCEPTION 'Cale locală neașteptată: %.%=%',v_t,array_to_string(v_path,'.'),j.val;
            END IF;
          ELSE
            v_row:=jsonb_set(v_row,v_path,to_jsonb(v_clona_fix::text||substr(v_cale,2)));
            v_paths:=v_paths||jsonb_build_array(jsonb_build_object('cale_veche',v_cale,'cale_noua',v_clona_fix::text||substr(v_cale,2)));
          END IF;
        END IF;
      END LOOP;
      IF v_t='ofertare_licitatii' THEN
        v_row:=v_row||jsonb_build_object('nr_anunt','SANDBOX-V2-DOMNESTI','link_seap',NULL,'c_notice_id',NULL,
          'sys_notice_type_id',NULL,'status','in_lucru','termen_depunere',now()+interval '30 days',
          'responsabil_id',v_responsabil_id,'nas_path',NULL,
          'observatii',concat(v_row->>'observatii',E'\n[AUDIT V2 SANDBOX sursa=5] ',now()));
        IF v_row?'derogare_depunere' THEN v_row:=jsonb_set(v_row,'{derogare_depunere}','false'); END IF;
      END IF;
      IF v_row?'proiect_id' AND v_row->'proiect_id'<>'null'::jsonb THEN
        RAISE EXCEPTION '%.proiect_id nenul: clonarea ar lega proiect real; revizie necesară',v_t;
      END IF;
      UPDATE map_audit_v2 SET rand_clona=v_row WHERE tabela=v_t AND id_vechi=r.id_vechi;
      v_row_ins := v_row; v_status_final := NULL;
      IF v_t='ofertare_cerinte' THEN
        IF v_row_ins?'inlocuita_de' THEN v_row_ins:=jsonb_set(v_row_ins,'{inlocuita_de}','null'); END IF;
        IF v_row_ins?'duplicat_al' THEN v_row_ins:=jsonb_set(v_row_ins,'{duplicat_al}','null'); END IF;
      END IF;
      -- Clarificarea răspunsă: triggerul cere „trimisă” înainte de „răspunsă” (INSERT direct e refuzat).
      IF v_t='ofertare_clarificari' AND v_row_ins->>'status'='raspunsa' THEN
        v_status_final := 'raspunsa'; v_row_ins := jsonb_set(v_row_ins,'{status}','"trimisa"');
      END IF;
      EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) RETURNING id',v_t,v_cols,v_cols,v_t)
        INTO v_id USING v_row_ins;
      IF v_id<>r.id_nou THEN RAISE EXCEPTION 'RETURNING id diferă de mapare: %',v_t; END IF;
      IF v_status_final IS NOT NULL THEN
        EXECUTE format('UPDATE public.%I SET status=$1 WHERE id=$2 RETURNING id',v_t) INTO v_id USING v_status_final, r.id_nou;
      END IF;
    END LOOP;
  END LOOP;
  FOR r IN SELECT * FROM map_audit_v2 WHERE tabela='ofertare_cerinte' LOOP
    FOREACH v_key IN ARRAY ARRAY['inlocuita_de','duplicat_al'] LOOP
      IF r.rand_clona?v_key AND r.rand_clona->v_key<>'null'::jsonb THEN
        EXECUTE format('UPDATE public.ofertare_cerinte SET %I=$1 WHERE id=$2 RETURNING id',v_key)
          INTO v_id USING (r.rand_clona->>v_key)::bigint,r.id_nou;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_t IN ARRAY v_tabele LOOP
    FOR r IN SELECT * FROM map_audit_v2 WHERE tabela=v_t LOOP
      EXECUTE format('SELECT to_jsonb(s)-''updated_at'' FROM public.%I s WHERE id=$1',v_t) INTO v_json USING r.id_nou;
      IF v_json IS DISTINCT FROM (r.rand_clona-'updated_at') THEN
        RAISE EXCEPTION 'Read-back diferit (trigger/coloană generată): % id=% — %',v_t,r.id_nou,
          (SELECT string_agg(k, ',') FROM jsonb_object_keys(v_json) k WHERE v_json->k IS DISTINCT FROM (r.rand_clona->k));
      END IF;
    END LOOP;
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY id),'''')) FROM public.%I s WHERE %s',v_t,v_before->v_t->>'where') INTO v_hash;
    IF v_hash IS DISTINCT FROM v_before->v_t->>'md5' THEN RAISE EXCEPTION 'Sursa 5 a fost modificată: %',v_t; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s',v_t,
      replace(v_before->v_t->>'where','=5','='||v_clona::text)) INTO v_n;
    IF v_n<>(v_counts->>v_t)::bigint THEN RAISE EXCEPTION 'Număr diferit clonă vs sursă: %',v_t; END IF;
    INSERT INTO map_audit_v2_sanity VALUES(v_t,(v_counts->>v_t)::bigint,v_n,v_hash);
  END LOOP;
  SELECT coalesce(jsonb_agg(DISTINCT value),'[]') INTO v_paths FROM jsonb_array_elements(v_paths);
  SELECT jsonb_agg(to_jsonb(s) ORDER BY tabela) INTO v_json FROM map_audit_v2_sanity s;
  -- Harta, căile și sanity-ul → claude_docs (memoria de lucru a auditului; NOTICE-urile nu trec prin MCP).
  INSERT INTO public.claude_docs(slug,title,category,content_md,active,source)
  VALUES('audit_v2_clona_103_map','Audit V2 — clona 103 (Domnești): harta id-urilor vechi→noi, căi storage, sanity','audit',
    jsonb_pretty(jsonb_build_object('clona_id',v_clona,'sursa_id',v_sursa,'creat_la',now(),'responsabil_id',v_responsabil_id,
      'sanity',v_json,'counts',v_counts,'storage_paths',v_paths,'maps',v_maps)),true,'92_SANDBOX_CLONA_103_apply.sql')
  ON CONFLICT (slug) DO UPDATE SET content_md=EXCLUDED.content_md, updated_at=now();
  RAISE NOTICE 'CLONA_ID %; SANITY %',v_clona,v_json;
END $$;
