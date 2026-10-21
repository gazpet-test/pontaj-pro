# Generatorul migrării 20261103b (E3), al revenirii și al helper-ului de test diferențial.
# Sursele sunt șabloanele de lângă el (e3_tpl.sql, e3_rev_tpl.sql); fișierele din supabase/ sunt IEȘIRI — nu se editează de mână.
# Utilizare (din orice director): python scripts/izometrie/e3_gen/gen_e3.py   apoi harness-ul: scripts/test_izometrie_e3.sh
import hashlib, os, re
SP = os.path.dirname(os.path.abspath(__file__)).replace(os.sep, '/') + '/'
R = os.path.abspath(os.path.join(SP, '..', '..', '..')).replace(os.sep, '/') + '/'
e2a = open(R + 'supabase/migrations/20261102a_izometrie_e2a_registru.sql', encoding='utf-8').read()
tpl = open(SP + 'e3_tpl.sql', encoding='utf-8').read()

def bloc_functie(semn):
    i = e2a.index('  CREATE FUNCTION public.%s' % semn)
    j = e2a.index('END $f$;', i) + len('END $f$;')
    return e2a[i:j]

def prosrc(bloc):
    i = bloc.index('AS $f$') + len('AS $f$'); j = bloc.rindex('$f$')
    return bloc[i:j]

def md5(t): return hashlib.md5(t.encode('utf-8')).hexdigest()

amp_i = e2a.index('  -- <amprenta>'); amp_j = e2a.index('  -- </amprenta>') + len('  -- </amprenta>')
AMPRENTA = e2a[amp_i:amp_j]

# ── constantele ──
C = ['proiect_id', 'comanda_furnizor_id', 'tip_material_id', 'serie', 'sarja', 'dimensiune', 'grad_otel', 'standard', 'lungime_m',
     'lungime_originala_m', 'greutate_kg', 'unghi_curba', 'cantitate', 'um', 'provenienta', 'izolatie', 'furnizor', 'producator',
     'sursa_receptie', 'fara_packing_list', 'nr_document', 'data_receptie', 'mtc_path', 'stare', 'locatie_tip', 'locatie_site_id',
     'executie_teava_id', 'atribute', 'observatii', 'receptionat_de', 'receptionat_la', 'created_by', 'tip_cod', 'parinte_id',
     'cod_bucata', 'capat_stanga', 'capat_dreapta', 'dezambiguare', 'lungime_aviz_mm', 'lungime_masurata_mm', 'lungime_mm',
     'lungime_calculata', 'perete_mm', 'diametru_mm', 'lot', 'aviz_intrare_id', 'nr_crt_aviz', 'bend_no', 'capat_marcaj',
     'depozit_id', 'tronson_id']
assert len(C) == 51 and len(set(C)) == 51
EV = ['tip', 'proiect_id', 'document_tip', 'document_id', 'import_id', 'storno_de_eveniment_id', 'motiv', 'declarat_de', 'aplicat_de',
      'aplicat_rol', 'ora_tableta', 'dispozitiv_id']
MIS = ['eveniment_id', 'proiect_id', 'bucata_id', 'rol', 'stare_inainte', 'stare_dupa', 'din_loc', 'in_loc', 'lungime_mm', 'inainte', 'dupa']
arr = lambda xs: "ARRAY[" + ", ".join("'%s'" % x for x in xs) + "]::text[]"

TIPURI_E2A = ['sold_initial', 'intrare_aviz', 'gasit', 'iesire_tranzit', 'livrare', 'retur_fizic', 'confirmare_primire_depozit',
              'mutare_tronson', 'taiere', 'montaj', 'demontaj', 'deseu', 'pierdut', 'inventar_ajustare', 'corectie', 'corectie_radacina', 'storno']
TIP_CHECK_E2A = "CHECK ((tip = ANY (ARRAY[" + ", ".join("'%s'::text" % t for t in TIPURI_E2A) + "])))"
TIPURI_E3 = TIPURI_E2A + ['intrare_lista_ambalare', 'receptie_pv']

# ── antet / rânduri / scanuri: cheile API și tipurile ──
ANTET = [('furnizor', 'text'), ('furnizor_cif', 'text'), ('nr_document', 'text'), ('data_document', 'date'), ('cumparator', 'text'),
         ('transport_nr', 'text'), ('nume_proiect', 'text'), ('lot', 'text'), ('loc_livrare', 'text'), ('data_incarcare', 'date'),
         ('data_descarcare', 'date'), ('nr_camion', 'text'), ('factura', 'text'), ('importator', 'text'), ('destinatar', 'text'),
         ('referinta_client', 'text'), ('referinta_furnizor', 'text'), ('placa_camion_container', 'text'), ('total_m', 'numeric'),
         ('total_kg', 'numeric'), ('total_bucati', 'integer'), ('total_pachete', 'integer'), ('total_net_kg', 'numeric'),
         ('total_brut_kg', 'numeric'), ('observatii', 'text')]
RAND = [('nr_crt', 'integer'), ('serie', 'text'), ('sarja', 'text'), ('lot', 'text'), ('specificatie', 'text'), ('dimensiune', 'text'),
        ('grad_otel', 'text'), ('standard', 'text'), ('izolatie', 'text'), ('diametru_mm', 'integer'), ('perete_mm', 'numeric'),
        ('greutate_kg', 'numeric'), ('lungime_doc_mm', 'integer'), ('lungime_masurata_mm', 'integer'), ('cod', 'text'), ('item', 'text'),
        ('unghi_doc', 'numeric'), ('unghi_masurat', 'numeric'), ('cantitate', 'integer'), ('pachet_nr', 'text'),
        ('dimensiuni_cm', 'text'), ('net_kg', 'numeric'), ('brut_kg', 'numeric'), ('decizie', 'text'), ('motiv', 'text'),
        ('observatie', 'text')]
SCAN = [('cale', 'text'), ('sha256_original', 'text'), ('sha256_pdf', 'text'), ('marime', 'bigint'), ('mime', 'text')]
val = lambda src, k, t: ("(%s ->> '%s')::%s" % (src, k, t)) if t != 'text' else ("%s ->> '%s'" % (src, k))
CHEI_ANTET = ", ".join("'%s'" % k for k, _ in ANTET)
CHEI_RAND = ", ".join("'%s'" % k for k, _ in RAND)
ANTET_COLS = ", ".join(k for k, _ in ANTET)
ANTET_VALS = ", ".join(val('p_antet', k, t) for k, t in ANTET)
ANTET_SET = ",\n        ".join("%s = %s" % (k, val('p_antet', k, t)) for k, t in ANTET)
RAND_COLS = ", ".join(k for k, _ in RAND)
RAND_VALS = ", ".join(("coalesce(x ->> 'decizie', 'primit')" if k == 'decizie' else val('x', k, t)) for k, t in RAND)

INTRARI = r"""
  -- salvarea draftului (§5, r5d): creare / editare, CAS pe versiune, rândurile și (opțional) manifestul înlocuite integral
  CREATE FUNCTION public.fn_izo_doc_salveaza(p_doc_id bigint, p_versiune bigint, p_antet jsonb, p_randuri jsonb, p_scanuri jsonb) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; d public.izo_documente_intrare; v_k text; v_x jsonb; v_tp bigint; v_td integer;
    c_antet constant text[] := ARRAY[@@CHEI_ANTET@@];
    c_creare constant text[] := ARRAY['proiect_id', 'depozit_id', 'sablon', 'inlocuieste_document_id', 'motiv_inlocuire'];
    c_rand constant text[] := ARRAY[@@CHEI_RAND@@];
    c_scan constant text[] := ARRAY['cale', 'sha256_original', 'sha256_pdf', 'marime', 'mime'];
  BEGIN
    v_uid := public.fn_izo_doc_api_verifica();
    IF jsonb_typeof(p_antet) IS DISTINCT FROM 'object' OR jsonb_typeof(p_randuri) IS DISTINCT FROM 'array'
       OR (p_scanuri IS NOT NULL AND jsonb_typeof(p_scanuri) IS DISTINCT FROM 'array') THEN
      RAISE EXCEPTION 'izo E3: p_antet trebuie să fie obiect, p_randuri listă, p_scanuri listă sau null' USING ERRCODE = '22023';
    END IF;
    SELECT k INTO v_k FROM jsonb_object_keys(p_antet) k WHERE k <> ALL (c_antet || c_creare) LIMIT 1;
    IF v_k IS NOT NULL THEN RAISE EXCEPTION 'izo E3: cheie necunoscută în antet: %', v_k USING ERRCODE = '22023'; END IF;
    FOR v_x IN SELECT x FROM jsonb_array_elements(p_randuri) x LOOP
      IF jsonb_typeof(v_x) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'izo E3: un rând nu e obiect' USING ERRCODE = '22023'; END IF;
      SELECT k INTO v_k FROM jsonb_object_keys(v_x) k WHERE k <> ALL (c_rand) LIMIT 1;
      IF v_k IS NOT NULL THEN RAISE EXCEPTION 'izo E3: cheie necunoscută în rând: %', v_k USING ERRCODE = '22023'; END IF;
    END LOOP;
    IF p_scanuri IS NOT NULL THEN
      FOR v_x IN SELECT x FROM jsonb_array_elements(p_scanuri) x LOOP
        IF jsonb_typeof(v_x) IS DISTINCT FROM 'object'
           OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_x) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(c_scan) k) THEN
          RAISE EXCEPTION 'izo E3: un scan din manifest are exact cheile cale, sha256_original, sha256_pdf, marime, mime' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    IF p_doc_id IS NULL THEN
      IF p_versiune IS NOT NULL THEN RAISE EXCEPTION 'izo E3: la creare p_versiune e NULL' USING ERRCODE = '22023'; END IF;
      IF NOT public.fn_izo_doc_autorizare_lock((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer) THEN
        RAISE EXCEPTION 'izo E3: nu ești gestionar pe acest proiect și depozit' USING ERRCODE = '42501';
      END IF;
      IF coalesce(public.fn_izo_nivel((p_antet ->> 'proiect_id')::bigint), 'off') NOT IN ('stoc', 'montaj') THEN
        RAISE EXCEPTION 'izo E3: proiectul nu are registrul de țeavă activ' USING ERRCODE = '42501';
      END IF;
      IF NOT public.fn_izo_loc_valid((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, NULL) THEN
        RAISE EXCEPTION 'izo E3: depozitul nu e activ sau nu e pe site-ul proiectului' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.izo_documente_intrare (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, @@ANTET_COLS@@)
      VALUES ((p_antet ->> 'proiect_id')::bigint, (p_antet ->> 'depozit_id')::integer, p_antet ->> 'sablon',
              (p_antet ->> 'inlocuieste_document_id')::bigint, p_antet ->> 'motiv_inlocuire', v_uid, @@ANTET_VALS@@)
      RETURNING * INTO d;
    ELSE
      SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
      IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
        RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
      END IF;
      IF d.stare <> 'draft' THEN RAISE EXCEPTION 'izo E3: documentul e %; se editează doar ciornele', d.stare USING ERRCODE = '42501'; END IF;
      IF p_versiune IS DISTINCT FROM d.versiune THEN
        RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %) — reîncarcă', d.versiune, p_versiune USING ERRCODE = '40001';
      END IF;
      IF (p_antet ? 'proiect_id' AND (p_antet ->> 'proiect_id')::bigint IS DISTINCT FROM d.proiect_id)
         OR (p_antet ? 'depozit_id' AND (p_antet ->> 'depozit_id')::integer IS DISTINCT FROM d.depozit_id)
         OR (p_antet ? 'sablon' AND p_antet ->> 'sablon' IS DISTINCT FROM d.sablon)
         OR (p_antet ? 'inlocuieste_document_id' AND (p_antet ->> 'inlocuieste_document_id')::bigint IS DISTINCT FROM d.inlocuieste_document_id)
         OR (p_antet ? 'motiv_inlocuire' AND p_antet ->> 'motiv_inlocuire' IS DISTINCT FROM d.motiv_inlocuire) THEN
        RAISE EXCEPTION 'izo E3: proiectul / depozitul / șablonul / înlocuirea nu se schimbă după creare (document nou)' USING ERRCODE = '22023';
      END IF;
      UPDATE public.izo_documente_intrare SET
        @@ANTET_SET@@,
        versiune = versiune + 1, updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
    END IF;
    -- înlocuirea (r5d §13.4 + r5e): ținta există, e anulată (finală), nu e documentul curent, iar utilizatorul e autorizat și pe
    -- proiectul / depozitul ȚINTEI (gestionar acolo sau owner); revalidată sub lock la fiecare salvare. Mesaj generic: nu
    -- dezvăluie dacă ținta există pe un proiect inaccesibil
    IF d.inlocuieste_document_id IS NOT NULL THEN
      SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
       WHERE t.id = d.inlocuieste_document_id AND t.stare = 'anulat' AND t.id <> d.id FOR SHARE;
      IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
        RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
      END IF;
    END IF;
    DELETE FROM public.izo_documente_intrare_randuri WHERE document_id = d.id;
    INSERT INTO public.izo_documente_intrare_randuri (document_id, @@RAND_COLS@@)
    SELECT d.id, @@RAND_VALS@@ FROM jsonb_array_elements(p_randuri) x;
    IF p_scanuri IS NOT NULL THEN
      DELETE FROM public.izo_documente_scanuri WHERE document_id = d.id;
      INSERT INTO public.izo_documente_scanuri (document_id, cale, sha256_original, sha256_pdf, marime, mime)
      SELECT d.id, x ->> 'cale', x ->> 'sha256_original', x ->> 'sha256_pdf', (x ->> 'marime')::bigint, x ->> 'mime' FROM jsonb_array_elements(p_scanuri) x;
      IF EXISTS (SELECT 1 FROM public.izo_documente_scanuri s WHERE s.document_id = d.id AND NOT public.fn_izo_scan_exista(s.cale)) THEN
        RAISE EXCEPTION 'izo E3: un scan din manifest nu există în Storage (încarcă-l întâi)' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'hash', public.fn_izo_doc_hash(d.id));
  END $f$;

  -- verificarea (doar citire): hash + versiune (cele pe care confirma le cere înapoi), blocante, avertismente
  CREATE FUNCTION public.fn_izo_doc_verifica(p_doc_id bigint) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_bloc jsonb;
  BEGIN
    PERFORM public.fn_izo_doc_api_verifica();
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id;
    IF NOT FOUND OR NOT public.fn_izo_citire(d.proiect_id) THEN
      RAISE EXCEPTION 'izo E3: documentul nu există sau nu ai acces la proiect' USING ERRCODE = '42501';
    END IF;
    v_bloc := CASE WHEN d.stare = 'draft' THEN public.fn_izo_doc_blocante(d.id) ELSE '[]'::jsonb END;
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'stare', d.stare, 'hash', public.fn_izo_doc_hash(d.id),
                              'ok', d.stare = 'draft' AND jsonb_array_length(v_bloc) = 0, 'blocante', v_bloc,
                              'avertismente', public.fn_izo_doc_avertismente(d.id));
  END $f$;

  -- anularea ciornei de către gestionar (r5d §13.3): doar antetul; registrul neatins
  CREATE FUNCTION public.fn_izo_doc_anuleaza_draft(p_doc_id bigint, p_versiune bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE v_uid uuid; d public.izo_documente_intrare; v_motiv text := btrim(p_motiv);
  BEGIN
    v_uid := public.fn_izo_doc_api_verifica();
    IF v_motiv IS NULL OR char_length(v_motiv) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'izo E3: motivul anulării e obligatoriu (3–1000 de caractere)' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
      RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
    END IF;
    IF d.stare <> 'draft' THEN
      RAISE EXCEPTION 'izo E3: documentul e %; pe calea asta se anulează doar ciornele (un document confirmat se anulează administrativ)', d.stare
        USING ERRCODE = '42501';
    END IF;
    IF p_versiune IS DISTINCT FROM d.versiune THEN
      RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %)', d.versiune, p_versiune USING ERRCODE = '40001';
    END IF;
    UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = v_uid, anulat_de_rol = session_user, anulat_la = now(),
           anulat_motiv = v_motiv, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'versiune', d.versiune, 'stare', d.stare);
  END $f$;

  -- confirmarea (§7): §4 pașii 1–8, apoi DML-ul static, totul sau nimic
  CREATE FUNCTION public.fn_izo_doc_confirma(p_doc_id bigint, p_versiune bigint, p_hash text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_bloc jsonb; v_avert jsonb; v_ev bigint; v_id bigint; r record; v_n integer; v_m integer;
    v_bucati bigint[] := '{}'; v_tp bigint; v_td integer;
  BEGIN
    PERFORM public.fn_izo_doc_api_verifica();
    IF p_doc_id IS NULL OR p_versiune IS NULL OR p_hash IS NULL THEN
      RAISE EXCEPTION 'izo E3: documentul, versiunea și hash-ul (din verificare) sunt obligatorii' USING ERRCODE = '22023';
    END IF;
    -- 1. documentul
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    -- 2. autorizarea, sub lock
    IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
      RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
    END IF;
    IF d.stare = 'confirmat' THEN
      IF d.hash_confirmat = p_hash THEN   -- retry după un răspuns pierdut: același conținut, fără scrieri
        RETURN jsonb_build_object('document_id', d.id, 'eveniment_id', d.eveniment_intrare_id,
          'bucati', (SELECT coalesce(jsonb_agg(x.bucata_id ORDER BY x.nr_crt), '[]'::jsonb) FROM public.izo_documente_intrare_randuri x
                      WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL),
          'avertismente', coalesce(d.avertismente, '[]'::jsonb), 'versiune', d.versiune, 'idempotent', true);
      END IF;
      RAISE EXCEPTION 'izo E3: documentul e deja confirmat cu alt conținut' USING ERRCODE = '23505';
    END IF;
    IF d.stare <> 'draft' THEN RAISE EXCEPTION 'izo E3: documentul e %', d.stare USING ERRCODE = '42501'; END IF;
    -- 3–4. locurile, tabelele, advisory-ul partajat pe proiect
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(d.proiect_id);
    -- 6. revalidarea pe starea comisă
    IF d.versiune <> p_versiune OR public.fn_izo_doc_hash(d.id) IS DISTINCT FROM p_hash THEN
      RAISE EXCEPTION 'izo E3: documentul s-a schimbat de la verificare (versiunea %, trimisă %) — verifică din nou', d.versiune, p_versiune
        USING ERRCODE = '40001';
    END IF;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') THEN
      RAISE EXCEPTION 'izo E3: proiectul nu are registrul de țeavă activ' USING ERRCODE = '42501';
    END IF;
    IF d.depozit_id IS NULL OR NOT public.fn_izo_loc_valid(d.proiect_id, d.depozit_id, NULL) THEN
      RAISE EXCEPTION 'izo E3: depozitul nu e activ sau nu e pe site-ul proiectului' USING ERRCODE = '23514';
    END IF;
    IF d.inlocuieste_document_id IS NOT NULL THEN
      SELECT t.proiect_id, t.depozit_id INTO v_tp, v_td FROM public.izo_documente_intrare t
       WHERE t.id = d.inlocuieste_document_id AND t.stare = 'anulat' AND t.id <> d.id FOR SHARE;
      IF NOT FOUND OR NOT public.fn_izo_doc_autorizare_lock(v_tp, v_td) THEN
        RAISE EXCEPTION 'izo E3: documentul înlocuit nu există, nu e anulat sau nu ai acces la el' USING ERRCODE = '23514';
      END IF;
    END IF;
    -- 7. blocantele (recalculate: totaluri, motive, valori, serii, coliziuni, scanuri) și avertismentele
    v_bloc := public.fn_izo_doc_blocante(d.id);
    IF jsonb_array_length(v_bloc) > 0 THEN
      RAISE EXCEPTION 'izo E3: documentul are blocante: %', v_bloc USING ERRCODE = '23514';
    END IF;
    v_avert := public.fn_izo_doc_avertismente(d.id);
    -- 8. marcajul (contextul operației), apoi doar DML static
    PERFORM public.fn_izo_receptie_marcheaza('confirma', d.id, d.proiect_id, d.depozit_id, d.versiune, p_hash);
    BEGIN
      INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, motiv, aplicat_de, server_ver)
      VALUES (CASE d.sablon WHEN 'aviz_teava' THEN 'intrare_aviz' ELSE 'intrare_lista_ambalare' END, d.proiect_id, 'doc_intrare',
              d.id::text, p_hash, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
      RETURNING id INTO v_ev;
      FOR r IN SELECT x.id, x.nr_crt FROM public.izo_documente_intrare_randuri x
                WHERE x.document_id = d.id AND x.decizie IN ('primit', 'primit_neconform') ORDER BY x.nr_crt LOOP
        v_id := nextval('public.magazie_bucati_id_seq');
        INSERT INTO public.magazie_bucati /*C*/ (@@INSERT_COLS@@)
        SELECT @@INSERT_VALS@@
          FROM jsonb_populate_record(NULL::public.magazie_bucati, public.fn_izo_doc_bucata_asteptata(d.id, r.nr_crt)) x;
        INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_dupa, in_loc, lungime_mm, server_ver)
        SELECT v_ev, d.proiect_id, b.id, 'nascut', b.stare, jsonb_build_object('tip', 'depozit', 'depozit_id', d.depozit_id), b.lungime_mm,
               nextval('public.izo_server_ver_seq')
          FROM public.magazie_bucati b WHERE b.id = v_id;
        UPDATE public.izo_documente_intrare_randuri SET bucata_id = v_id WHERE id = r.id;
        v_bucati := v_bucati || v_id;
      END LOOP;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'izo E3: o serie din document a fost înregistrată între timp de alt document (sau există deja în registru): %', SQLERRM
        USING ERRCODE = '23505';
    END;
    -- reconcilierea, înainte de RETURN
    SELECT count(*) INTO v_n FROM public.magazie_bucati_miscari WHERE eveniment_id = v_ev AND rol = 'nascut';
    SELECT count(*) INTO v_m FROM public.izo_documente_intrare_randuri WHERE document_id = d.id AND decizie IN ('primit', 'primit_neconform');
    IF v_n <> v_m OR cardinality(v_bucati) <> v_m
       OR (SELECT count(*) FROM public.izo_documente_intrare_randuri WHERE document_id = d.id AND bucata_id IS NOT NULL) <> v_m THEN
      RAISE EXCEPTION 'izo E3: reconcilierea confirmării a eșuat (mișcări %, rânduri primite %)', v_n, v_m;
    END IF;
    UPDATE public.izo_documente_intrare SET stare = 'confirmat', hash_confirmat = p_hash, avertismente = v_avert,
           confirmat_de = public.fn_izo_uid(), confirmat_la = now(), eveniment_intrare_id = v_ev, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'eveniment_id', v_ev, 'bucati', to_jsonb(v_bucati), 'avertismente', v_avert,
                              'versiune', d.versiune, 'idempotent', false);
  END $f$;

  -- PV-ul (§8): mulțimea așteptată = TOATE rândurile primit; fiecare bucată verificată, fără filtrare prealabilă
  CREATE FUNCTION public.fn_izo_doc_pv(p_doc_id bigint, p_versiune bigint, p_pv_nr text, p_pv_data date) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_canon text; v_ev bigint; v_set bigint[]; v_upd bigint[]; v_err jsonb; v_tip text;
  BEGIN
    PERFORM public.fn_izo_doc_api_verifica();
    IF p_doc_id IS NULL OR p_versiune IS NULL OR p_pv_data IS NULL OR p_pv_nr IS NULL OR char_length(btrim(p_pv_nr)) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'izo E3: documentul, versiunea, numărul și data PV-ului sunt obligatorii' USING ERRCODE = '22023';
    END IF;
    v_canon := upper(regexp_replace(btrim(p_pv_nr), '[[:space:]]+', ' ', 'g'));
    IF position('|' IN v_canon) > 0 THEN RAISE EXCEPTION 'izo E3: numărul PV-ului nu poate conține „|”' USING ERRCODE = '22023'; END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF NOT public.fn_izo_doc_autorizare_lock(d.proiect_id, d.depozit_id) THEN
      RAISE EXCEPTION 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' USING ERRCODE = '42501';
    END IF;
    IF d.stare <> 'confirmat' THEN RAISE EXCEPTION 'izo E3: PV-ul se pune doar pe un document confirmat (e %)', d.stare USING ERRCODE = '42501'; END IF;
    IF d.eveniment_pv_id IS NOT NULL THEN
      IF d.pv_nr_canon = v_canon AND d.pv_data = p_pv_data THEN
        RETURN jsonb_build_object('document_id', d.id, 'eveniment_pv_id', d.eveniment_pv_id,
          'bucati_receptionate', (SELECT count(*) FROM public.magazie_bucati_miscari WHERE eveniment_id = d.eveniment_pv_id),
          'avertismente', '[]'::jsonb, 'versiune', d.versiune, 'idempotent', true);
      END IF;
      RAISE EXCEPTION 'izo E3: documentul are deja PV-ul % / %', d.pv_nr, d.pv_data USING ERRCODE = '23505';
    END IF;
    IF d.versiune <> p_versiune THEN
      RAISE EXCEPTION 'izo E3: documentul s-a schimbat între timp (versiunea %, trimisă %)', d.versiune, p_versiune USING ERRCODE = '40001';
    END IF;
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_partajat(d.proiect_id);
    PERFORM 1 FROM public.magazie_bucati b
      WHERE b.id IN (SELECT x.bucata_id FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL)
      ORDER BY b.id FOR UPDATE;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') OR NOT public.fn_izo_loc_valid(d.proiect_id, d.depozit_id, NULL) THEN
      RAISE EXCEPTION 'izo E3: registrul nu e activ pe proiect sau depozitul nu mai e valid' USING ERRCODE = '42501';
    END IF;
    v_tip := CASE d.sablon WHEN 'aviz_teava' THEN 'teava' ELSE 'curba' END;
    SELECT coalesce(jsonb_agg(jsonb_build_object('nr_crt', x.nr_crt, 'bucata_id', x.bucata_id, 'motiv',
             CASE WHEN x.bucata_id IS NULL THEN 'rândul n-are bucată — document corupt'
                  WHEN b.id IS NULL THEN 'bucata nu mai există'
                  WHEN b.aviz_intrare_id IS DISTINCT FROM d.id OR b.nr_crt_aviz IS DISTINCT FROM x.nr_crt OR b.proiect_id IS DISTINCT FROM d.proiect_id
                       OR b.tip_cod IS DISTINCT FROM v_tip THEN 'bucata nu mai aparține rândului / documentului'
                  WHEN b.stare <> 'sosit' THEN 'starea e ' || b.stare
                  ELSE 'nu mai e în depozitul documentului' END) ORDER BY x.nr_crt), '[]'::jsonb)
      INTO v_err
      FROM public.izo_documente_intrare_randuri x LEFT JOIN public.magazie_bucati b ON b.id = x.bucata_id
     WHERE x.document_id = d.id AND x.decizie = 'primit'
       AND (x.bucata_id IS NULL OR b.id IS NULL OR b.aviz_intrare_id IS DISTINCT FROM d.id OR b.nr_crt_aviz IS DISTINCT FROM x.nr_crt
            OR b.proiect_id IS DISTINCT FROM d.proiect_id OR b.tip_cod IS DISTINCT FROM v_tip OR b.stare <> 'sosit'
            OR b.depozit_id IS DISTINCT FROM d.depozit_id OR b.tronson_id IS NOT NULL);
    IF jsonb_array_length(v_err) > 0 THEN
      RAISE EXCEPTION 'izo E3: bucăți ieșite / modificate înainte de PV — decizie: %', v_err USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(array_agg(x.bucata_id ORDER BY x.bucata_id), '{}') INTO v_set
      FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.decizie = 'primit';
    PERFORM public.fn_izo_receptie_marcheaza('pv', d.id, d.proiect_id, d.depozit_id, d.versiune, v_canon || '|' || p_pv_data::text);
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, motiv, aplicat_de, server_ver)
    VALUES ('receptie_pv', d.proiect_id, 'doc_intrare', d.id::text, 'PV ' || v_canon || ' / ' || p_pv_data::text, public.fn_izo_uid(),
            nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_ev;
    WITH u AS (UPDATE public.magazie_bucati SET stare = 'receptionat', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
                WHERE id = ANY (v_set) AND stare = 'sosit' RETURNING id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_upd FROM u;
    IF v_upd IS DISTINCT FROM v_set THEN RAISE EXCEPTION 'izo E3: reconcilierea PV-ului a eșuat (% față de %)', cardinality(v_upd), cardinality(v_set); END IF;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_ev, d.proiect_id, x, 'stare', 'sosit', 'receptionat', nextval('public.izo_server_ver_seq') FROM unnest(v_upd) x;
    UPDATE public.izo_documente_intrare SET pv_nr = btrim(p_pv_nr), pv_nr_canon = v_canon, pv_data = p_pv_data, pv_pus_de = public.fn_izo_uid(),
           pv_pus_la = now(), eveniment_pv_id = v_ev, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'eveniment_pv_id', v_ev, 'bucati_receptionate', cardinality(v_upd),
      'avertismente', CASE WHEN cardinality(v_upd) = 0
                           THEN jsonb_build_array(jsonb_build_object('nr_crt', NULL, 'cod', 'pv_fara_bucati', 'mesaj', 'niciun rând primit conform'))
                           ELSE '[]'::jsonb END,
      'versiune', d.versiune, 'idempotent', false);
  END $f$;

  -- anularea administrativă (§9.1; doar postgres): ciorna → doar antetul; confirmatul → storno PV, apoi storno intrare
  CREATE FUNCTION public.fn_izo_doc_anuleaza(p_doc_id bigint, p_motiv text) RETURNS jsonb
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  DECLARE d public.izo_documente_intrare; v_motiv text := btrim(p_motiv); v_lipsa text[]; v_toate bigint[]; v_pv bigint[];
    v_st_pv bigint; v_st_i bigint; v_n integer;
  BEGIN
    IF session_user IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'izo E3: anularea administrativă se cheamă doar dintr-o sesiune postgres directă (session_user = %)', session_user
        USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));
    IF coalesce(current_setting('izo.receptie_ctx', true), '') <> '' THEN
      RAISE EXCEPTION 'izo E3: o altă operație E3 rulează deja în această tranzacție' USING ERRCODE = '42501';
    END IF;
    v_lipsa := public.fn_izo_porti_lipsa();
    IF cardinality(v_lipsa) <> 0 THEN RAISE EXCEPTION 'izo E3: porțile registrului nu sunt complete: %', v_lipsa USING ERRCODE = '42501'; END IF;
    IF v_motiv IS NULL OR char_length(v_motiv) NOT BETWEEN 3 AND 1000 THEN
      RAISE EXCEPTION 'izo E3: motivul anulării e obligatoriu (3–1000 de caractere)' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO d FROM public.izo_documente_intrare WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'izo E3: documentul % nu există', p_doc_id USING ERRCODE = '22023'; END IF;
    IF d.stare = 'anulat' THEN RAISE EXCEPTION 'izo E3: documentul e deja anulat' USING ERRCODE = '23505'; END IF;
    IF d.stare = 'draft' THEN
      PERFORM public.fn_izo_receptie_marcheaza('anulare_draft', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
      UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
             anulat_motiv = v_motiv, versiune = versiune + 1, updated_at = now()
       WHERE id = d.id RETURNING * INTO d;
      RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', false, 'versiune', d.versiune);
    END IF;
    PERFORM public.fn_izo_blocheaza_locuri(d.proiect_id, ARRAY[d.depozit_id], '{}'::bigint[]);
    PERFORM public.fn_izo_blocheaza_tabele();
    PERFORM public.fn_izo_lock_proiect(d.proiect_id, true);
    SELECT coalesce(array_agg(x.bucata_id ORDER BY x.bucata_id), '{}') INTO v_toate
      FROM public.izo_documente_intrare_randuri x WHERE x.document_id = d.id AND x.bucata_id IS NOT NULL;
    PERFORM 1 FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id FOR UPDATE;
    IF coalesce(public.fn_izo_nivel(d.proiect_id), 'off') NOT IN ('stoc', 'montaj') THEN
      RAISE EXCEPTION 'izo E3: proiectul e off — anularea unui document confirmat cere întâi reactivarea' USING ERRCODE = '42501';
    END IF;
    -- fail-closed: nicio mișcare în afară de nașterea din intrare și PV-ul documentului
    SELECT count(*) INTO v_n FROM public.magazie_bucati_miscari m
     WHERE m.bucata_id = ANY (v_toate) AND m.eveniment_id <> d.eveniment_intrare_id AND m.eveniment_id IS DISTINCT FROM d.eveniment_pv_id;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'izo E3: anulare refuzată — % mișcări ulterioare pe bucățile documentului (stornează întâi lanțul, explicit)', v_n
        USING ERRCODE = '23514';
    END IF;
    PERFORM public.fn_izo_receptie_marcheaza('anulare', d.id, d.proiect_id, d.depozit_id, d.versiune, v_motiv);
    IF d.eveniment_pv_id IS NOT NULL THEN
      INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
      VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_pv_id, v_motiv, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
      RETURNING id INTO v_st_pv;
      SELECT coalesce(array_agg(m.bucata_id ORDER BY m.bucata_id), '{}') INTO v_pv FROM public.magazie_bucati_miscari m WHERE m.eveniment_id = d.eveniment_pv_id;
      INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
      SELECT v_st_pv, d.proiect_id, x, 'stare', 'receptionat', 'sosit', nextval('public.izo_server_ver_seq') FROM unnest(v_pv) x;
      UPDATE public.magazie_bucati SET stare = 'sosit', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now()
       WHERE id = ANY (v_pv) AND stare = 'receptionat';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> cardinality(v_pv) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului PV a eșuat'; END IF;
    END IF;
    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, aplicat_de, server_ver)
    VALUES ('storno', d.proiect_id, 'doc_intrare', d.id::text, d.eveniment_intrare_id, v_motiv, public.fn_izo_uid(), nextval('public.izo_server_ver_seq'))
    RETURNING id INTO v_st_i;
    INSERT INTO public.magazie_bucati_miscari (eveniment_id, proiect_id, bucata_id, rol, stare_inainte, stare_dupa, server_ver)
    SELECT v_st_i, d.proiect_id, b.id, 'anulat', b.stare, 'anulata', nextval('public.izo_server_ver_seq')
      FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id;
    UPDATE public.magazie_bucati SET stare = 'anulata', server_ver = nextval('public.izo_server_ver_seq'), updated_at = now() WHERE id = ANY (v_toate);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_toate) THEN RAISE EXCEPTION 'izo E3: reconcilierea storno-ului intrării a eșuat'; END IF;
    UPDATE public.izo_documente_intrare SET stare = 'anulat', anulat_de = public.fn_izo_uid(), anulat_de_rol = session_user, anulat_la = now(),
           anulat_motiv = v_motiv, eveniment_storno_intrare_id = v_st_i, eveniment_storno_pv_id = v_st_pv, versiune = versiune + 1, updated_at = now()
     WHERE id = d.id RETURNING * INTO d;
    RETURN jsonb_build_object('document_id', d.id, 'stare', d.stare, 'storno', true, 'storno_intrare_id', v_st_i, 'storno_pv_id', v_st_pv,
                              'bucati_anulate', cardinality(v_toate), 'versiune', d.versiune);
  END $f$;
"""

DOC_TAB = "public.izo_documente_intrare, public.izo_documente_intrare_randuri, public.izo_documente_scanuri"
FUNC_INTERNE = ["fn_izo_coloane_c()", "fn_izo_coloane_ev()", "fn_izo_coloane_mis()", "fn_izo_proiectie(jsonb, text[])", "fn_izo_jwt_rol()",
                "fn_izo_canon_serie(text)", "fn_izo_doc_autorizare_lock(bigint, integer)", "fn_izo_scan_exista(text)",
                "fn_izo_scan_poate_incarca(text)", "fn_izo_scan_poate_citi(text)", "fn_izo_scan_poate_sterge(text)", "fn_izo_doc_hash(bigint)",
                "fn_izo_doc_blocante(bigint)", "fn_izo_doc_avertismente(bigint)", "fn_izo_doc_bucata_asteptata(bigint, integer)",
                "fn_izo_eveniment_asteptat(text, bigint, bigint, text)",
                "fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer)",
                "fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text)", "fn_izo_garda_receptie(text, text, jsonb, jsonb)",
                "fn_izo_doc_garda()", "fn_izo_porti_e3_definitii()", "fn_izo_porti_e3_lipsa()", "fn_izo_doc_api_verifica()",
                "fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb)", "fn_izo_doc_verifica(bigint)",
                "fn_izo_doc_anuleaza_draft(bigint, bigint, text)", "fn_izo_doc_confirma(bigint, bigint, text)",
                "fn_izo_doc_pv(bigint, bigint, text, date)", "fn_izo_doc_anuleaza(bigint, text)"]
pf = lambda xs: ", ".join("public." + x for x in xs)
DREPTURI = """  -- tabelele documentelor: API doar SELECT (filtrat de RLS); scriu doar rolurile E3, pe coloanele operațiilor (§3.5)
  REVOKE ALL ON TABLE %(T)s FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON TABLE %(T)s TO authenticated, izo_doc_editor, izo_receptie_writer;
  GRANT INSERT (proiect_id, depozit_id, sablon, inlocuieste_document_id, motiv_inlocuire, creat_de, %(AC)s) ON public.izo_documente_intrare TO izo_doc_editor;
  GRANT UPDATE (%(AC)s, versiune, updated_at, stare, anulat_de, anulat_de_rol, anulat_la, anulat_motiv) ON public.izo_documente_intrare TO izo_doc_editor;
  GRANT UPDATE (stare, versiune, updated_at, hash_confirmat, avertismente, confirmat_de, confirmat_la, eveniment_intrare_id, pv_nr, pv_nr_canon,
                pv_data, pv_pus_de, pv_pus_la, eveniment_pv_id, anulat_de, anulat_de_rol, anulat_la, anulat_motiv, eveniment_storno_intrare_id,
                eveniment_storno_pv_id) ON public.izo_documente_intrare TO izo_receptie_writer;
  GRANT INSERT (document_id, %(RC)s), DELETE ON public.izo_documente_intrare_randuri TO izo_doc_editor;
  GRANT UPDATE (bucata_id) ON public.izo_documente_intrare_randuri TO izo_receptie_writer;
  GRANT INSERT (document_id, cale, sha256_original, sha256_pdf, marime, mime), DELETE ON public.izo_documente_scanuri TO izo_doc_editor;
  ALTER TABLE public.izo_documente_intrare ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_documente_intrare_randuri ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.izo_documente_scanuri ENABLE ROW LEVEL SECURITY;
  CREATE POLICY izo_doc_api_sel ON public.izo_documente_intrare FOR SELECT TO authenticated USING (public.fn_izo_citire(proiect_id));
  CREATE POLICY izo_doc_rand_api_sel ON public.izo_documente_intrare_randuri FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id = document_id));
  CREATE POLICY izo_doc_scan_api_sel ON public.izo_documente_scanuri FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.izo_documente_intrare d WHERE d.id = document_id));
  -- rolurile E3: acces pe rând larg; restricția reală e în trigger-ul documentelor + gardă (§3.5)
  CREATE POLICY izo_doc_editor_sel ON public.izo_documente_intrare FOR SELECT TO izo_doc_editor USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_editor_ins ON public.izo_documente_intrare FOR INSERT TO izo_doc_editor WITH CHECK (stare = 'draft');
  CREATE POLICY izo_doc_editor_upd ON public.izo_documente_intrare FOR UPDATE TO izo_doc_editor
    USING (proiect_id IS NOT NULL) WITH CHECK (stare IN ('draft', 'anulat'));
  CREATE POLICY izo_doc_writer_sel ON public.izo_documente_intrare FOR SELECT TO izo_receptie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_writer_upd ON public.izo_documente_intrare FOR UPDATE TO izo_receptie_writer
    USING (proiect_id IS NOT NULL) WITH CHECK (proiect_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_editor_sel ON public.izo_documente_intrare_randuri FOR SELECT TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_editor_ins ON public.izo_documente_intrare_randuri FOR INSERT TO izo_doc_editor WITH CHECK (bucata_id IS NULL);
  CREATE POLICY izo_doc_rand_editor_del ON public.izo_documente_intrare_randuri FOR DELETE TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_writer_sel ON public.izo_documente_intrare_randuri FOR SELECT TO izo_receptie_writer USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_rand_writer_upd ON public.izo_documente_intrare_randuri FOR UPDATE TO izo_receptie_writer
    USING (document_id IS NOT NULL) WITH CHECK (bucata_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_editor_sel ON public.izo_documente_scanuri FOR SELECT TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_editor_ins ON public.izo_documente_scanuri FOR INSERT TO izo_doc_editor WITH CHECK (document_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_editor_del ON public.izo_documente_scanuri FOR DELETE TO izo_doc_editor USING (document_id IS NOT NULL);
  CREATE POLICY izo_doc_scan_writer_sel ON public.izo_documente_scanuri FOR SELECT TO izo_receptie_writer USING (document_id IS NOT NULL);
  -- registrul, pentru rolurile E3 (politici permisive noi; cele RESTRICTIVE E2a pentru anon / authenticated rămân)
  GRANT SELECT ON TABLE public.magazie_bucati TO izo_doc_editor, izo_receptie_writer;
  GRANT INSERT (%(CC)s) ON public.magazie_bucati TO izo_receptie_writer;
  GRANT UPDATE (stare, server_ver, updated_at) ON public.magazie_bucati TO izo_receptie_writer;
  GRANT SELECT, INSERT ON TABLE public.magazie_bucati_evenimente, public.magazie_bucati_miscari TO izo_receptie_writer;
  GRANT USAGE ON SEQUENCE public.magazie_bucati_id_seq, public.izo_server_ver_seq, public.magazie_bucati_evenimente_id_seq,
    public.magazie_bucati_miscari_id_seq TO izo_receptie_writer;
  CREATE POLICY magbuc_izo_doceditor_sel ON public.magazie_bucati FOR SELECT TO izo_doc_editor USING (provenienta = 'beneficiar' AND tip_cod IS NOT NULL);
  CREATE POLICY magbuc_izo_receptie_sel ON public.magazie_bucati FOR SELECT TO izo_receptie_writer USING (provenienta = 'beneficiar');
  CREATE POLICY magbuc_izo_receptie_ins ON public.magazie_bucati FOR INSERT TO izo_receptie_writer
    WITH CHECK (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  CREATE POLICY magbuc_izo_receptie_upd ON public.magazie_bucati FOR UPDATE TO izo_receptie_writer
    USING (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'))
    WITH CHECK (provenienta = 'beneficiar' AND coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  CREATE POLICY izo_ev_receptie_sel ON public.magazie_bucati_evenimente FOR SELECT TO izo_receptie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_ev_receptie_ins ON public.magazie_bucati_evenimente FOR INSERT TO izo_receptie_writer
    WITH CHECK (coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  CREATE POLICY izo_mis_receptie_sel ON public.magazie_bucati_miscari FOR SELECT TO izo_receptie_writer USING (proiect_id IS NOT NULL);
  CREATE POLICY izo_mis_receptie_ins ON public.magazie_bucati_miscari FOR INSERT TO izo_receptie_writer
    WITH CHECK (coalesce(public.fn_izo_nivel(proiect_id), 'off') IN ('stoc', 'montaj'));
  -- funcțiile: nimic implicit (default privileges ar da EXECUTE la anon / authenticated / service_role)
  REVOKE ALL ON FUNCTION %(FI)s FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.fn_izo_coloane_c(), public.fn_izo_coloane_ev(), public.fn_izo_coloane_mis(), public.fn_izo_proiectie(jsonb, text[]),
    public.fn_izo_jwt_rol(), public.fn_izo_canon_serie(text), public.fn_izo_doc_autorizare_lock(bigint, integer), public.fn_izo_scan_exista(text),
    public.fn_izo_doc_hash(bigint), public.fn_izo_doc_blocante(bigint), public.fn_izo_doc_avertismente(bigint), public.fn_izo_doc_api_verifica()
    TO izo_doc_editor, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_bucata_asteptata(bigint, integer), public.fn_izo_eveniment_asteptat(text, bigint, bigint, text),
    public.fn_izo_miscare_asteptata(bigint, bigint, text, text, text, jsonb, integer), public.fn_izo_garda_receptie(text, text, jsonb, jsonb)
    TO izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_scan_poate_incarca(text), public.fn_izo_scan_poate_citi(text), public.fn_izo_scan_poate_sterge(text) TO authenticated;
  -- funcțiile E2a chemate de rolurile E3 (matricea §3.5, apelurile tranzitive)
  GRANT EXECUTE ON FUNCTION public.fn_izo_nivel(bigint), public.fn_izo_uid(), public.fn_izo_porti_lipsa(), public.fn_izo_loc_valid(bigint, integer, bigint),
    public.fn_izo_citire(bigint) TO izo_doc_editor, izo_receptie_writer;
  GRANT EXECUTE ON FUNCTION public.fn_izo_blocheaza_locuri(bigint, integer[], bigint[]), public.fn_izo_blocheaza_tabele(), public.fn_izo_lock_partajat(bigint[]),
    public.fn_izo_lock_proiect(bigint, boolean), public.fn_izo_porti_definitii(), public.fn_izo_garda_scriitor(), public.fn_izo_tip_cod(integer),
    public.fn_izo_site_proiect(bigint), public.fn_izo_tip_material(text) TO izo_receptie_writer;""" % {
    'T': DOC_TAB, 'AC': ANTET_COLS, 'RC': RAND_COLS, 'CC': ", ".join(['id', 'uid', 'radacina_id', 'server_ver'] + C), 'FI': pf(FUNC_INTERNE)}

OWNERI = """  ALTER FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_confirma(bigint, bigint, text) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_pv(bigint, bigint, text, date) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_anuleaza(bigint, text) OWNER TO izo_receptie_writer;
  ALTER FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb) OWNER TO izo_doc_editor;
  ALTER FUNCTION public.fn_izo_doc_verifica(bigint) OWNER TO izo_doc_editor;
  ALTER FUNCTION public.fn_izo_doc_anuleaza_draft(bigint, bigint, text) OWNER TO izo_doc_editor;
  REVOKE CREATE ON SCHEMA public FROM izo_doc_editor, izo_receptie_writer;
  -- ALTER OWNER mută ACL-ul pe owner-ul nou; GRANT-urile le dă owner-ul (postgres nu e superuser pe Supabase)
  SET LOCAL ROLE izo_receptie_writer;
  REVOKE ALL ON FUNCTION public.fn_izo_receptie_marcheaza(text, bigint, bigint, integer, bigint, text), public.fn_izo_doc_confirma(bigint, bigint, text),
    public.fn_izo_doc_pv(bigint, bigint, text, date), public.fn_izo_doc_anuleaza(bigint, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_confirma(bigint, bigint, text), public.fn_izo_doc_pv(bigint, bigint, text, date) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text) TO postgres;
  RESET ROLE;
  SET LOCAL ROLE izo_doc_editor;
  REVOKE ALL ON FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint),
    public.fn_izo_doc_anuleaza_draft(bigint, bigint, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_salveaza(bigint, bigint, jsonb, jsonb, jsonb), public.fn_izo_doc_verifica(bigint),
    public.fn_izo_doc_anuleaza_draft(bigint, bigint, text) TO authenticated;
  RESET ROLE;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Livrare 20261103b: rolul nu a revenit la postgres după GRANT'; END IF;"""

# ── gărzile E2a → varianta cu v_aut ──
GB = bloc_functie('fn_izo_garda_bucati() RETURNS trigger')
GF = bloc_functie('fn_izo_garda_fapte() RETURNS trigger')
V_AUT = """    -- E3 (20261103b): predicatul de autorizare, calculat o singură dată — scriitorul E2a cu marcaj SAU scriitorul E3 în
    -- contextul operației (true sau excepție); fără RETURN timpuriu: verificările E2a de mai jos se aplică tuturor
    v_aut := public.fn_izo_garda_scriitor();
    IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN
      v_aut := public.fn_izo_garda_receptie(TG_TABLE_NAME, TG_OP, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
                                            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
    END IF;
"""
gb = GB.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
assert gb.count('    v_p bigint;\n') == 1
gb = gb.replace('    v_p bigint;\n', '    v_p bigint;\n    v_aut boolean;\n')
k = gb.index('  BEGIN\n') + len('  BEGIN\n')
gb = gb[:k] + V_AUT + gb[k:]
assert gb.count('public.fn_izo_garda_scriitor() IS NOT TRUE') == 2
gb = gb.replace('public.fn_izo_garda_scriitor() IS NOT TRUE', 'v_aut IS NOT TRUE')
gf = GF.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
assert gf.count('  BEGIN\n') == 1
gf = gf.replace('  BEGIN\n', '  DECLARE v_aut boolean;\n  BEGIN\n')
old = "    IF public.fn_izo_garda_scriitor() IS NOT TRUE THEN\n"
assert gf.count(old) == 1
gf = gf.replace(old, V_AUT.replace("CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END", "to_jsonb(NEW)") + "    IF v_aut IS NOT TRUE THEN\n")

# ── poarta E2a → închiderea rapidă + poarta E3 ──
PL = bloc_functie('fn_izo_porti_lipsa() RETURNS text[]')
pl = PL.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1)
a = pl.index("      c_scheme_platforma constant text[] := ARRAY['auth'")
a = pl.index("    BEGIN\n", a)
b = pl.index("      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;\n")
b = b + len("      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;\n")
SEED_FN = pl[pl.index("      -- funcțiile cu SQL dinamic (orice EXECUTE)", a):pl.index("      -- r15 (Jakarinos + Copilot r14): funcțiile „mutator”", a)]
RAPID = r"""      -- r5d (20261103b): aceeași semantică, evaluare SEMI-NAIVĂ — fiecare element nou al închiderii se caută o singură dată,
      -- cu o singură expresie per iterație (alternanța numelor din frontieră); corpurile se citesc o dată
      k_oid oid[]; k_corp text[]; k_cale text[]; f_rel oid[]; f_fn oid[]; f_mut oid[]; n_rel oid[]; n_fn oid[]; n_mut oid[];
      p_cal text; p_neq text; p_plat jsonb;
    BEGIN
      SELECT array_agg(c.oid) INTO c_rel FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('magazie_bucati','izo_proiect_config','izo_atribuiri','izo_importuri','magazie_bucati_evenimente','magazie_bucati_miscari');
@@SEED_FN@@      -- corpurile candidate (orice schemă non-sistem, în afara public.fn_izo_*), o singură dată; calea fixată în proconfig
      -- (NULL = necunoscută: funcția moștenește calea apelantului)
      SELECT coalesce(array_agg(p.oid ORDER BY p.oid), '{}'),
             coalesce(array_agg(p.prosrc || ' ' || coalesce(pg_get_function_sqlbody(p.oid), '') ORDER BY p.oid), '{}'),
             coalesce(array_agg((SELECT array_to_string(string_to_array(lower(regexp_replace(substr(c, 13), '[[:space:]"]', '', 'g')), ','), ',')
                                   FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%' LIMIT 1) ORDER BY p.oid), '{}')
        INTO k_oid, k_corp, k_cale
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_' AND p.prolang NOT IN (12, 13)
         AND NOT (n.nspname = 'public' AND p.proname LIKE 'fn\_izo\_%');
      -- mutatorii de cale (r15): sămânța = corp cu set_config / search_path; propagați până la punct fix
      SELECT coalesce(array_agg(k.oid), '{}') INTO c_mut FROM unnest(k_oid, k_corp) k(oid, corp) WHERE k.corp ~* '(set_config|search_path)';
      f_mut := c_mut; v_iter := 0;
      WHILE cardinality(f_mut) > 0 AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        SELECT c_st || '(' || string_agg(n2.nspname || '"?[[:space:]]*\.[[:space:]]*"?' || regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') || ')' || c_dr,
               c_st || '(' || string_agg(regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') FILTER (WHERE n2.nspname <> ALL (c_scheme_platforma)) || ')' || c_dr
          INTO p_cal, p_neq
          FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_mut);
        SELECT coalesce(jsonb_object_agg(z.s, c_st || '(' || z.nume || ')' || c_dr), '{}') INTO p_plat
          FROM (SELECT n2.nspname::text s, string_agg(regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') nume
                  FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace
                 WHERE q.oid = ANY (f_mut) AND n2.nspname = ANY (c_scheme_platforma) GROUP BY 1) z;
        n_mut := ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale) WHERE k.oid <> ALL (c_mut)
                         AND (k.corp ~* p_cal OR (p_neq IS NOT NULL AND k.corp ~* p_neq)
                              OR EXISTS (SELECT 1 FROM jsonb_each_text(p_plat) e
                                          WHERE (k.cale IS NULL OR e.key = ANY (string_to_array(k.cale, ','))) AND k.corp ~* e.value)));
        c_mut := c_mut || n_mut; f_mut := n_mut;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'propagarea mutatorilor de cale nu converge (citire nerevizuită)'); END IF;
      -- închiderea: frontiera = elementele adăugate în iterația precedentă (view-urile noi intră în frontiera aceleiași iterații,
      -- ca în E2a, unde sunt adăugate înaintea funcțiilor)
      f_rel := c_rel; f_fn := c_fn; v_iter := 0;
      WHILE (cardinality(f_rel) > 0 OR cardinality(f_fn) > 0) AND v_iter < 100 LOOP
        v_iter := v_iter + 1;
        n_rel := ARRAY(SELECT DISTINCT rw.ev_class FROM pg_depend d JOIN pg_rewrite rw ON rw.oid = d.objid
                        WHERE d.classid = 'pg_rewrite'::regclass
                          AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                               OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn)))
                          AND rw.ev_class <> ALL (c_rel));
        c_rel := c_rel || n_rel; f_rel := f_rel || n_rel;
        p_cal := NULL; p_neq := NULL; p_plat := '{}';
        WITH t AS (SELECT n2.nspname::text nsp, regexp_replace(c.relname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') nume
                     FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE c.oid = ANY (f_rel)
                   UNION
                   SELECT n2.nspname::text, regexp_replace(q.proname, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g')
                     FROM pg_proc q JOIN pg_namespace n2 ON n2.oid = q.pronamespace WHERE q.oid = ANY (f_fn))
        SELECT c_st || '(' || string_agg(t.nsp || '"?[[:space:]]*\.[[:space:]]*"?' || t.nume, '|') || ')' || c_dr,
               c_st || '(' || string_agg(t.nume, '|') FILTER (WHERE t.nsp <> ALL (c_scheme_platforma)) || ')' || c_dr,
               (SELECT coalesce(jsonb_object_agg(z.s, c_st || '(' || z.nn || ')' || c_dr), '{}')
                  FROM (SELECT t2.nsp s, string_agg(t2.nume, '|') nn FROM t t2 WHERE t2.nsp = ANY (c_scheme_platforma) GROUP BY 1) z)
          INTO p_cal, p_neq, p_plat FROM t;
        n_fn := ARRAY(SELECT k.oid FROM unnest(k_oid, k_corp, k_cale) k(oid, corp, cale) WHERE k.oid <> ALL (c_fn)
                        AND ((p_cal IS NOT NULL AND k.corp ~* p_cal) OR (p_neq IS NOT NULL AND k.corp ~* p_neq)
                             -- schemele platformei: necalificat doar dacă schema e în calea funcției; calea e necunoscută dacă nu e
                             -- fixată SAU dacă funcția e mutator (r15)
                             OR EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(p_plat, '{}')) e
                                         WHERE (k.oid = ANY (c_mut) OR k.cale IS NULL OR e.key = ANY (string_to_array(k.cale, ','))) AND k.corp ~* e.value)
                             OR EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = k.oid
                                           AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid = ANY (f_rel))
                                                OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid = ANY (f_fn))))));
        c_fn := c_fn || n_fn;
        f_rel := n_rel; f_fn := n_fn;
      END LOOP;
      IF v_iter >= 100 THEN v := array_append(v, 'închiderea citirilor nu converge (citire nerevizuită)'); END IF;
""".replace('@@SEED_FN@@', SEED_FN)
pl = pl[:a] + RAPID + pl[b:]
fin = "    RETURN v;\n  END $f$;"
assert pl.count(fin) == 1
pl = pl.replace(fin, """    -- E3 (20261103b): poarta documentelor de intrare, chemată de aici, ca orice activare / import E2a s-o includă (r5d §13.1)
    v := v || public.fn_izo_porti_e3_lipsa();
""" + fin)

INSERT_COLS = ", ".join(['id', 'uid', 'radacina_id', 'server_ver'] + C)
INSERT_VALS = ", ".join(["v_id", "gen_random_uuid()", "v_id", "nextval('public.izo_server_ver_seq')"] + ["x." + c for c in C])
INTRARI = (INTRARI.replace('@@CHEI_ANTET@@', CHEI_ANTET).replace('@@CHEI_RAND@@', CHEI_RAND).replace('@@ANTET_COLS@@', ANTET_COLS)
           .replace('@@ANTET_VALS@@', ANTET_VALS).replace('@@ANTET_SET@@', ANTET_SET).replace('@@RAND_COLS@@', RAND_COLS)
           .replace('@@RAND_VALS@@', RAND_VALS).replace('@@INSERT_COLS@@', INSERT_COLS).replace('@@INSERT_VALS@@', INSERT_VALS))

mig = (tpl.replace('@@C_ARRAY@@', arr(C)).replace('@@EV_ARRAY@@', arr(EV)).replace('@@MIS_ARRAY@@', arr(MIS))
          .replace('@@MD5_GB_E2A@@', md5(prosrc(GB))).replace('@@MD5_GF_E2A@@', md5(prosrc(GF)))
          .replace('@@TIP_CHECK_E2A@@', TIP_CHECK_E2A.replace("'", "''")).replace('@@TIPURI_E3@@', ", ".join("'%s'" % t for t in TIPURI_E3))
          .replace('@@AMPRENTA@@', AMPRENTA).replace('@@GARDA_BUCATI_E3@@', gb).replace('@@GARDA_FAPTE_E3@@', gf)
          .replace('@@PORTI_LIPSA_E3@@', pl).replace('@@INTRARI@@', INTRARI).replace('@@DREPTURI@@', DREPTURI).replace('@@OWNERI@@', OWNERI))
assert '@@' not in mig, re.findall('@@[A-Z_0-9]+@@', mig)
open(R + 'supabase/migrations/20261103b_izometrie_e3_documente.sql', 'w', encoding='utf-8', newline='\n').write(mig)

# ── revenirea ──
rev = open(SP + 'e3_rev_tpl.sql', encoding='utf-8').read()
rev = (rev.replace('@@AMPRENTA@@', AMPRENTA)
          .replace('@@GARDA_BUCATI_E2A@@', GB.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
          .replace('@@GARDA_FAPTE_E2A@@', GF.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
          .replace('@@PORTI_LIPSA_E2A@@', PL.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1))
          .replace('@@MD5_GB_E2A@@', md5(prosrc(GB))).replace('@@MD5_GF_E2A@@', md5(prosrc(GF))).replace('@@MD5_PL_E2A@@', md5(prosrc(PL)))
          .replace('@@TIPURI_E2A@@', ", ".join("'%s'" % t for t in TIPURI_E2A)).replace('@@FI@@', pf(FUNC_INTERNE)))
assert '@@' not in rev, re.findall('@@[A-Z_0-9]+@@', rev)
open(R + 'supabase/revenire/20261103b_izometrie_e3_documente_ROLLBACK.sql', 'w', encoding='utf-8', newline='\n').write(rev)

# ── testul diferențial: închiderea veche (E2a, exact) și cea nouă (exact textul din migrare), ca funcții INVOKER de test ──
def bloc_inchidere(text):
    i = text.index("    DECLARE\n      c_rel oid[]; c_fn oid[] := '{}'")
    j = text.index("\n    END;\n", i)
    corp = text[i:j]
    k = corp.rindex("      IF EXISTS (SELECT 1 FROM pg_class vw WHERE vw.oid = ANY (c_rel)")
    return corp[:k] + "      o_rel := c_rel; o_fn := c_fn; o_mut := c_mut; o_mesaje := v;\n    END;\n"
def functie_test(nume, text):
    return ("CREATE FUNCTION teste.%s(OUT o_rel oid[], OUT o_fn oid[], OUT o_mut oid[], OUT o_mesaje text[])\n"
            "  LANGUAGE plpgsql STABLE AS $t$\nDECLARE v text[] := '{}';\nBEGIN\n%s\nEND $t$;\n") % (nume, bloc_inchidere(text))
helper = ("-- Generat de gen_e3.py: închiderea citirilor din poarta E2a (20261102a, exact) și din poarta E3 (20261103b, exact),\n"
          "-- ca funcții de test INVOKER (doar în baza *_test), pentru testul diferențial din scripts/test_izometrie_e3.sh.\n"
          + functie_test('inchidere_veche', PL) + "\n" + functie_test('inchidere_noua', pl))
open(R + 'supabase/tests/izometrie_e3_inchidere.sql', 'w', encoding='utf-8', newline='\n').write(helper)
print('ok', len(mig.splitlines()), len(rev.splitlines()))
