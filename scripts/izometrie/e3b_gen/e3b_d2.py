"""D2: celula aprobata Q1=A, Q17=A, Q14=A; numai delta fata de LIVE."""

PROLOG = """    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'E3b cere READ COMMITTED' USING ERRCODE='25001'; END IF;
    IF NOT pg_try_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare')) THEN
      RAISE EXCEPTION 'E3b: schema ocupata' USING ERRCODE='55P03'; END IF;
    IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN
      RAISE EXCEPTION 'E3b: porti incomplete' USING ERRCODE='42501'; END IF;
"""


def build_d2(e2, e3, bloc, prosrc, q, md5):
    old = {n: bloc(s, n) for n, s in {
        'fn_izo_import_sold_initial': e2, 'fn_izo_import_storno': e2,
        'fn_izo_doc_anuleaza': e3, 'fn_izo_garda_receptie': e3}.items()}
    new = {n: b.replace('  CREATE FUNCTION', '  CREATE OR REPLACE FUNCTION', 1) for n, b in old.items()}

    def change(n, a, b):
        assert new[n].count(a) == 1, (n, a)
        new[n] = new[n].replace(a, b, 1)

    for n in ('fn_izo_import_sold_initial', 'fn_izo_import_storno'):
        anchor = "    END IF;\n    PERFORM set_config('izo.registru_tx'"
        change(n, anchor, "    END IF;\n" + PROLOG + "    PERFORM set_config('izo.registru_tx'")
    assert prosrc(new['fn_izo_import_sold_initial']).replace(PROLOG, '', 1) == prosrc(old['fn_izo_import_sold_initial'])
    n = 'fn_izo_import_storno'
    change(n, 'v_alt int;', 'v_alt int; v_m bigint[]; v_deschise bigint[];')
    start = new[n].index('    SELECT count(*) INTO v_alt')
    end = new[n].index('    INSERT INTO public.magazie_bucati_evenimente', start)
    new[n] = new[n][:start] + """    SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_m
      FROM public.magazie_bucati b WHERE b.stare <> 'anulata' AND EXISTS (
        SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=b.id AND m.eveniment_id=v_imp.eveniment_id AND m.rol='nascut');
    SELECT array_agg(x.bucata_id ORDER BY x.bucata_id) INTO v_deschise FROM public.fn_izo_cor_deschise(v_m) x;
    IF cardinality(v_deschise)>0 THEN
      RAISE EXCEPTION 'E3b: decide / retrage intai propunerile: %',v_deschise USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO v_alt FROM public.fn_izo_lant_blocant(v_m,ARRAY[v_imp.eveniment_id]);
    IF v_alt>0 THEN RAISE EXCEPTION 'izo: storno refuzat: % miscari ulterioare',v_alt USING ERRCODE='23514'; END IF;
""" + new[n][end:]
    change(n, 'FROM public.magazie_bucati b JOIN public.magazie_bucati_miscari m ON m.bucata_id = b.id AND m.eveniment_id = v_imp.eveniment_id;',
           'FROM public.magazie_bucati b WHERE b.id=ANY(v_m);')
    change(n, 'FROM public.magazie_bucati_miscari m WHERE m.bucata_id = b.id AND m.eveniment_id = v_imp.eveniment_id;',
           "WHERE b.id=ANY(v_m) AND b.stare <> 'anulata';")
    change(n, '    GET DIAGNOSTICS v_n = ROW_COUNT;', "    GET DIAGNOSTICS v_n = ROW_COUNT;\n    IF v_n <> cardinality(v_m) THEN RAISE EXCEPTION 'E3b: reconciliere import esuata'; END IF;")

    n = 'fn_izo_doc_anuleaza'
    change(n, 'p_motiv text)', 'p_motiv text, p_cerut_de uuid DEFAULT NULL)')
    change(n, 'v_st_pv bigint;', 'v_m bigint[]; v_deschise bigint[]; v_st_pv bigint;')
    change(n, "    PERFORM pg_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare'));", "    IF NOT pg_try_advisory_xact_lock_shared(hashtext('gazpet.livrare_migrare')) THEN\n      RAISE EXCEPTION 'E3b: schema ocupata' USING ERRCODE='55P03'; END IF;")
    point = "    IF d.stare = 'anulat' THEN"
    change(n, point, """    IF NOT public.fn_izo_cor_cerut_de_valid(d.proiect_id,p_cerut_de) THEN
      RAISE EXCEPTION 'E3b: cerut_de neeligibil' USING ERRCODE='42501'; END IF;
    PERFORM set_config('izo.anulare_cerut_de',txid_current()::text || '|' || d.id::text || '|' || p_cerut_de::text,true);
""" + point)
    start = new[n].index('    -- fail-closed:')
    end = new[n].index("    PERFORM public.fn_izo_receptie_marcheaza('anulare'", start)
    new[n] = new[n][:start] + """    SELECT array_agg(x.bucata_id ORDER BY x.bucata_id) INTO v_deschise FROM public.fn_izo_cor_deschise(v_toate) x;
    IF cardinality(v_deschise)>0 THEN
      RAISE EXCEPTION 'E3b: decide / retrage intai propunerile: %',v_deschise USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO v_n FROM public.fn_izo_lant_blocant(v_toate,array_remove(ARRAY[d.eveniment_intrare_id,d.eveniment_pv_id],NULL));
    IF v_n>0 THEN RAISE EXCEPTION 'izo E3: anulare refuzata: % miscari ulterioare',v_n USING ERRCODE='23514'; END IF;
""" + new[n][end:]
    # Ambele evenimente administrative poarta omul validat; celelalte campuri raman identice.
    assert new[n].count('motiv, aplicat_de, server_ver)') == 2
    new[n] = new[n].replace('motiv, aplicat_de, server_ver)', 'motiv, declarat_de, aplicat_de, server_ver)')
    new[n] = new[n].replace('v_motiv, public.fn_izo_uid(), nextval(', 'v_motiv, p_cerut_de, public.fn_izo_uid(), nextval(')
    change(n, 'FROM public.magazie_bucati_miscari m WHERE m.eveniment_id = d.eveniment_pv_id;',
           "FROM public.magazie_bucati_miscari m JOIN public.magazie_bucati b ON b.id=m.bucata_id WHERE m.eveniment_id = d.eveniment_pv_id AND b.stare='receptionat';")
    point = '    INSERT INTO public.magazie_bucati_evenimente (tip, proiect_id, document_tip, document_id, storno_de_eveniment_id, motiv, declarat_de, aplicat_de, server_ver)\n    VALUES'
    change(n, point, "    SELECT coalesce(array_agg(b.id ORDER BY b.id),'{}') INTO v_m FROM public.magazie_bucati b WHERE b.id=ANY(v_toate) AND b.stare<>'anulata';\n" + point)
    change(n, 'FROM public.magazie_bucati b WHERE b.id = ANY (v_toate) ORDER BY b.id;', 'FROM public.magazie_bucati b WHERE b.id = ANY (v_m) ORDER BY b.id;')
    change(n, 'WHERE id = ANY (v_toate);', "WHERE id = ANY (v_m) AND stare<>'anulata';")
    assert n == 'fn_izo_doc_anuleaza' and new[n].count('cardinality(v_toate)') == 2
    new[n] = new[n].replace('cardinality(v_toate)', 'cardinality(v_m)', 2)

    n = 'fn_izo_garda_receptie'
    change(n, "p_old ->> 'stare' IN ('sosit', 'carantina')", "p_old ->> 'stare' IN ('sosit', 'receptionat', 'carantina', 'pierduta')")
    for event, predicate in [
        ('v_st_pv', "v_b.stare <> 'receptionat' OR NOT EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=v_b.id AND m.eveniment_id=v_ev_pv)"),
        ('v_st_intrare', "v_b.stare NOT IN ('sosit','receptionat','carantina','pierduta')")]:
        point = '        v_exp := public.fn_izo_miscare_asteptata(' + event + ','
        change(n, point, "        IF " + predicate + " OR EXISTS (SELECT 1 FROM public.magazie_bucati_miscari m WHERE m.bucata_id=v_b.id AND m.eveniment_id=" + event + ") THEN\n          RAISE EXCEPTION 'E3b: miscare storno invalida / repetata' USING ERRCODE='42501'; END IF;\n" + point)
    point = '      v_exp := public.fn_izo_eveniment_asteptat(v_op, v_doc, v_storno_de, v_arg);'
    change(n, point, point + """
      IF v_op='anulare' THEN
        IF split_part(coalesce(current_setting('izo.anulare_cerut_de',true),''),'|',1) IS DISTINCT FROM txid_current()::text
          OR split_part(current_setting('izo.anulare_cerut_de',true),'|',2) IS DISTINCT FROM v_doc::text
          OR nullif(split_part(current_setting('izo.anulare_cerut_de',true),'|',3),'') IS NULL THEN
          RAISE EXCEPTION 'E3b: context cerut_de invalid' USING ERRCODE='42501'; END IF;
        v_exp := jsonb_set(v_exp,'{declarat_de}',to_jsonb(split_part(current_setting('izo.anulare_cerut_de',true),'|',3)::uuid));
      END IF;""")

    sigs = {
        'fn_izo_import_sold_initial': ('bigint, text, jsonb', 'izo_registru_writer'),
        'fn_izo_import_storno': ('bigint, text, text', 'izo_registru_writer'),
        'fn_izo_doc_anuleaza': ('bigint, text, uuid', 'izo_receptie_writer'),
        'fn_izo_garda_receptie': ('text, text, jsonb, jsonb', 'postgres')}

    def owned(b, owner):
        if owner == 'postgres':
            return b
        return '  GRANT CREATE ON SCHEMA public TO %s;\n  SET LOCAL ROLE %s;\n%s\n  RESET ROLE;\n  REVOKE CREATE ON SCHEMA public FROM %s;' % (owner, owner, b, owner)

    forward, reverse = [], []
    for name, b in new.items():
        sig, owner = sigs[name]
        signature = name + '(' + sig + ')'
        if name == 'fn_izo_doc_anuleaza':
            forward.append('  SET LOCAL ROLE izo_receptie_writer;\n  DROP FUNCTION public.fn_izo_doc_anuleaza(bigint, text);\n  RESET ROLE;')
            forward.append(owned(b.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 1), owner))
            forward.append(owned('  REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role;\n  GRANT EXECUTE ON FUNCTION public.%s TO postgres;' % (signature, signature), owner))
            reverse.append('  SET LOCAL ROLE izo_receptie_writer;\n  DROP FUNCTION public.' + signature + ';\n  RESET ROLE;')
            restore = old[name].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
            reverse.append(owned(restore, owner))
            reverse.append(owned('  REVOKE ALL ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text) FROM PUBLIC, anon, authenticated, service_role;\n  GRANT EXECUTE ON FUNCTION public.fn_izo_doc_anuleaza(bigint, text) TO postgres;', owner))
            reverse.append("  IF (SELECT proacl::text FROM pg_proc WHERE oid='public.fn_izo_doc_anuleaza(bigint, text)'::regprocedure) IS DISTINCT FROM '{izo_receptie_writer=X/izo_receptie_writer,postgres=X/izo_receptie_writer}' THEN RAISE EXCEPTION 'E3b: ACL anulare restaurat diferit'; END IF;")
            sig = 'bigint, text'
        else:
            forward.append(owned(b, owner))
            reverse.append(owned(old[name].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1), owner))
        if name == 'fn_izo_import_sold_initial':
            forward.append("  IF (SELECT md5(replace(prosrc, %s, '')) FROM pg_proc WHERE oid='public.%s(%s)'::regprocedure) IS DISTINCT FROM %s THEN RAISE EXCEPTION 'Postconditie E3b: corp in afara prologului modificat'; END IF;" % (q(PROLOG),name,sig,q(md5(prosrc(old[name])))))
        reverse.append("  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.%s(%s)'::regprocedure) IS DISTINCT FROM %s THEN RAISE EXCEPTION 'E3b: restaurare D2 diferita'; END IF;" % (name,sig,q(md5(prosrc(old[name])))))
    return old, new, '\n'.join(forward), '\n'.join(reverse)
