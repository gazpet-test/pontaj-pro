-- Revenire 20261130b_sms_acces_modul. Runner: o tranzactie, GUC gazpet.revenire_20261130b = 'SMS_ACCES_SCOS:'||txid_current().
-- Fail-closed: modulul SMS revine la „doar owner”, exact ca in 20261130a: corpurile celor 9 functii inlocuite, politicile RLS de pe
-- sms_loturi / sms_mesaje, vederea sms_v_loturi si fn_sms_rezerva cu 3 argumente (la final, md5-ul tuturor celor 25 de functii = 20261130a).
-- NU sterge nimic:
--   * coloanele creat_nivel / aprobat_nivel / anulat_nivel raman pe sms_loturi, cu datele lor (dupa revenire nu le mai scrie nimic);
--   * cheia de modul `sms` si eventualele randuri user_module_access cu module = 'sms' raman (stergerea cheii ar sterge in cascada
--     drepturile = date); nu mai deschid nimic, fiindca toate RPC-urile cer din nou profiles.is_owner.
-- Dupa revenire edge-ul sms-trimite din 20261130b nu mai gaseste fn_sms_rezerva cu 4 argumente: nu trimite nimic pana la redeploy-ul
-- edge-ului din 20261130a (git revert). Corpurile de mai jos sunt copiate din supabase/migrations/20261130a_sms_mvp.sql (generator, nu de mana).
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.revenire_20261130b', true) IS DISTINCT FROM 'SMS_ACCES_SCOS:' || txid_current() THEN
    RAISE EXCEPTION '20261130b revenire: garda invalida';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regprocedure('public.fn_sms_nivel()') IS NULL OR to_regprocedure('public.fn_sms_rezerva(uuid,integer,text,uuid)') IS NULL
     OR to_regclass('public.sms_loturi') IS NULL THEN
    RAISE EXCEPTION '20261130b revenire: migrarea 20261130b lipseste';
  END IF;
END $pre$;

-- ─── 1. RLS: inapoi la doar owner (politicile nu mai depind de functiile 20261130b) ────────────────────────────────────────
ALTER POLICY sms_loturi_sel ON public.sms_loturi USING ((SELECT public.fn_sms_e_owner()));
ALTER POLICY sms_mesaje_sel ON public.sms_mesaje USING ((SELECT public.fn_sms_e_owner()));

-- ─── 2. Vederea din 20261130a (fara coloanele de nivel; CREATE OR REPLACE nu poate scoate coloane) ─────────────────────────
DROP VIEW public.sms_v_loturi;
CREATE VIEW public.sms_v_loturi WITH (security_invoker = on) AS
SELECT l.id, l.categorie, l.text, l.stare, l.proiect_id, l.uat_id, l.filtru, l.nr_destinatari, l.segmente, l.cost_estimat_eur,
       l.excluse_optout, l.excluse_fara_mobil, l.creat_de, l.creat_la, l.aprobat_de, l.aprobat_la, l.aprobat_autorizare_nr,
       l.aprobat_autorizare_data, l.anulat_la, l.motiv_anulare, l.coada_golita_la, l.versiune,
       count(m.id) FILTER (WHERE m.stare = 'in_coada')::integer AS n_in_coada,
       count(m.id) FILTER (WHERE m.stare = 'necunoscut')::integer AS n_necunoscut,
       count(m.id) FILTER (WHERE m.stare = 'trimis')::integer AS n_trimis,
       count(m.id) FILTER (WHERE m.stare = 'livrat')::integer AS n_livrat,
       count(m.id) FILTER (WHERE m.stare = 'esuat')::integer AS n_esuat,
       count(m.id) FILTER (WHERE m.stare = 'anulat')::integer AS n_anulat
  FROM public.sms_loturi l LEFT JOIN public.sms_mesaje m ON m.lot_id = l.id
 GROUP BY l.id;
COMMENT ON VIEW public.sms_v_loturi IS 'SMS: loturile cu numaratoarea mesajelor pe stari (security_invoker: aceeasi RLS ca tabelele = doar owner).';
REVOKE ALL ON public.sms_v_loturi FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sms_v_loturi TO authenticated;

-- ─── 3. Corpurile 20261130a ale functiilor inlocuite (CREATE OR REPLACE pastreaza drepturile) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sms_loturi_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; v record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: loturile nu se sterg (anularea e o stare)' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.sms_setari WHERE id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stare IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'sms: un lot nou e mereu draft' USING ERRCODE = '23514'; END IF;
    SELECT * INTO v FROM public.fn_sms_text_verifica(NEW.text);
    IF v.text_final IS DISTINCT FROM NEW.text OR v.text_final = '' OR v.nepermise <> '' OR v.lungime > 160 THEN
      RAISE EXCEPTION 'sms: textul lotului nu e GSM-7 normalizat (fara diacritice, max 160)' USING ERRCODE = '23514';
    END IF;
    IF NEW.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
    IF NEW.uat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_uat u WHERE u.id = NEW.uat_id AND u.proiect_id = NEW.proiect_id) THEN
      RAISE EXCEPTION 'sms: UAT-ul nu e al proiectului' USING ERRCODE = '23514';
    END IF;
    NEW.creat_de := auth.uid(); NEW.creat_la := now(); NEW.aprobat_de := NULL; NEW.aprobat_la := NULL;
    NEW.aprobat_autorizare_nr := NULL; NEW.aprobat_autorizare_data := NULL; NEW.anulat_de := NULL; NEW.anulat_la := NULL;
    NEW.motiv_anulare := NULL; NEW.coada_golita_la := NULL; NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.categorie, NEW.text, NEW.proiect_id, NEW.uat_id, NEW.filtru, NEW.nr_destinatari, NEW.segmente, NEW.cost_estimat_eur,
      NEW.excluse_optout, NEW.excluse_fara_mobil, NEW.creat_de, NEW.creat_la)
     IS DISTINCT FROM (OLD.id, OLD.categorie, OLD.text, OLD.proiect_id, OLD.uat_id, OLD.filtru, OLD.nr_destinatari, OLD.segmente, OLD.cost_estimat_eur,
      OLD.excluse_optout, OLD.excluse_fara_mobil, OLD.creat_de, OLD.creat_la) THEN
    RAISE EXCEPTION 'sms: continutul unui lot nu se schimba (anuleaza-l si creeaza altul)' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD.stare = 'draft' AND NEW.stare IN ('aprobat', 'anulat'))
       OR (OLD.stare = 'aprobat' AND NEW.stare IN ('in_trimitere', 'anulat'))
       OR (OLD.stare = 'in_trimitere' AND NEW.stare IN ('coada_golita', 'anulat'))) THEN
    RAISE EXCEPTION 'sms: trecere de stare nepermisa pentru lot: % -> %', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  NEW.aprobat_de := OLD.aprobat_de; NEW.aprobat_la := OLD.aprobat_la;
  NEW.aprobat_autorizare_nr := OLD.aprobat_autorizare_nr; NEW.aprobat_autorizare_data := OLD.aprobat_autorizare_data;
  NEW.anulat_de := OLD.anulat_de; NEW.anulat_la := OLD.anulat_la; NEW.coada_golita_la := OLD.coada_golita_la;
  IF NEW.stare <> 'anulat' THEN NEW.motiv_anulare := OLD.motiv_anulare; END IF;
  IF NEW.stare = 'aprobat' THEN
    IF NOT public.fn_sms_e_owner() THEN RAISE EXCEPTION 'sms: doar owner-ul aproba un lot' USING ERRCODE = '42501'; END IF;
    IF NEW.categorie = 'redari' THEN
      IF NOT coalesce(s.redari_autorizat, false) THEN
        RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
      END IF;
      NEW.aprobat_autorizare_nr := s.redari_autorizare_nr; NEW.aprobat_autorizare_data := s.redari_autorizare_data;
    END IF;
    NEW.aprobat_de := auth.uid(); NEW.aprobat_la := now();
  ELSIF NEW.stare = 'anulat' THEN
    IF NOT public.fn_sms_e_owner() THEN RAISE EXCEPTION 'sms: doar owner-ul anuleaza un lot' USING ERRCODE = '42501'; END IF;
    NEW.anulat_de := auth.uid(); NEW.anulat_la := now();
  ELSIF NEW.stare = 'in_trimitere' THEN
    IF coalesce(s.kill_switch, true) THEN RAISE EXCEPTION 'sms: trimiterea e oprita (kill-switch)' USING ERRCODE = '42501'; END IF;
    IF NEW.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.sms_mesaje m WHERE m.lot_id = NEW.id AND m.stare = 'in_coada') THEN
      RAISE EXCEPTION 'sms: lotul mai are mesaje in coada' USING ERRCODE = '23514';
    END IF;
    NEW.coada_golita_la := now();
  END IF;
  NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_mesaje_reguli() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sms: mesajele nu se sterg (sunt jurnalul trimiterii)' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sms_loturi x WHERE x.id = NEW.lot_id AND x.stare = 'draft') THEN
      RAISE EXCEPTION 'sms: mesajele se adauga doar la crearea lotului (draft)' USING ERRCODE = '23514';
    END IF;
    IF NEW.stare IS DISTINCT FROM 'in_coada' THEN RAISE EXCEPTION 'sms: un mesaj nou e mereu in_coada' USING ERRCODE = '23514'; END IF;
    NEW.furnizor := NULL; NEW.furnizor_id := NULL; NEW.cod_eroare := NULL;
    NEW.rezervat_la := NULL; NEW.trimis_la := NULL; NEW.livrat_la := NULL;
    NEW.creat_la := now(); NEW.actualizat_la := now(); NEW.versiune := 1;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.lot_id, NEW.telefon, NEW.destinatar_tip, NEW.destinatar_id, NEW.segmente, NEW.creat_la)
     IS DISTINCT FROM (OLD.id, OLD.lot_id, OLD.telefon, OLD.destinatar_tip, OLD.destinatar_id, OLD.segmente, OLD.creat_la) THEN
    RAISE EXCEPTION 'sms: destinatarul unui mesaj nu se schimba' USING ERRCODE = '23514';
  END IF;
  IF (OLD.furnizor IS NOT NULL AND NEW.furnizor IS DISTINCT FROM OLD.furnizor)
     OR (OLD.furnizor_id IS NOT NULL AND NEW.furnizor_id IS DISTINCT FROM OLD.furnizor_id) THEN
    RAISE EXCEPTION 'sms: furnizorul si id-ul de la furnizor se scriu o singura data' USING ERRCODE = '23514';
  END IF;
  NEW.rezervat_la := OLD.rezervat_la; NEW.trimis_la := OLD.trimis_la; NEW.livrat_la := OLD.livrat_la;
  IF OLD.stare = 'in_coada' AND NEW.stare = 'necunoscut' THEN
    -- rezervarea: din lot in trimitere, cu trimiterea pornita, Redari doar autorizat, fara opt-out, fara id inca
    SELECT * INTO l FROM public.sms_loturi WHERE id = NEW.lot_id;
    SELECT * INTO s FROM public.sms_setari WHERE id;
    IF l.stare IS DISTINCT FROM 'in_trimitere' THEN RAISE EXCEPTION 'sms: mesajul pleaca doar dintr-un lot aprobat, in trimitere' USING ERRCODE = '23514'; END IF;
    IF coalesce(s.kill_switch, true) THEN RAISE EXCEPTION 'sms: trimiterea e oprita (kill-switch)' USING ERRCODE = '42501'; END IF;
    IF l.categorie = 'redari' AND NOT coalesce(s.redari_autorizat, false) THEN
      RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
    END IF;
    IF NEW.furnizor IS NULL OR NEW.furnizor_id IS NOT NULL THEN RAISE EXCEPTION 'sms: rezervarea cere furnizorul, fara id' USING ERRCODE = '23514'; END IF;
    IF EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = NEW.telefon AND o.activ) THEN
      RAISE EXCEPTION 'sms: numarul are opt-out' USING ERRCODE = '23514';
    END IF;
    NEW.rezervat_la := now();
  ELSIF OLD.stare = 'in_coada' AND NEW.stare = 'anulat' THEN
    NULL;
  ELSIF OLD.stare = 'necunoscut' AND NEW.stare = 'trimis' THEN
    IF NEW.furnizor_id IS NULL THEN RAISE EXCEPTION 'sms: trimis cere id-ul de la furnizor' USING ERRCODE = '23514'; END IF;
    NEW.trimis_la := now();
  ELSIF OLD.stare = 'necunoscut' AND NEW.stare IN ('esuat', 'necunoscut') THEN
    IF NEW.furnizor_id IS NOT NULL THEN RAISE EXCEPTION 'sms: id-ul de la furnizor vine doar cu trimis' USING ERRCODE = '23514'; END IF;
    IF NEW.cod_eroare IS NULL THEN RAISE EXCEPTION 'sms: esecul / necunoscutul cer un cod' USING ERRCODE = '23514'; END IF;
  ELSIF OLD.stare = 'trimis' AND NEW.stare IN ('livrat', 'esuat') THEN
    IF NEW.stare = 'livrat' THEN NEW.livrat_la := now(); END IF;
  ELSE
    RAISE EXCEPTION 'sms: trecere de stare nepermisa pentru mesaj: % -> %', OLD.stare, NEW.stare USING ERRCODE = '23514';
  END IF;
  NEW.actualizat_la := now(); NEW.versiune := OLD.versiune + 1;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_panou() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; c record;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO s FROM public.sms_setari WHERE id;
  SELECT * INTO c FROM public.fn_sms_consum();
  RETURN jsonb_build_object('kill_switch', s.kill_switch, 'kill_motiv', s.kill_motiv, 'plafon_zi', s.plafon_zi, 'plafon_luna', s.plafon_luna,
    'consum_zi', c.zi, 'consum_luna', c.luna, 'redari_autorizat', s.redari_autorizat, 'redari_autorizare_nr', s.redari_autorizare_nr,
    'redari_autorizare_data', s.redari_autorizare_data, 'versiune', s.versiune, 'actualizat_la', s.actualizat_la,
    'tarif_eur', 0.049, 'max_caractere', 160);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_angajati_lista() RETURNS TABLE (id integer, nume text, departament text, telefon_mascat text, optout boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.fn_sms_cere_owner();
  RETURN QUERY
  SELECT e.id, e.name, e.department,
         CASE WHEN t.tel IS NULL THEN NULL::text ELSE '07** *** ' || right(t.tel, 3) END,
         (t.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = t.tel AND o.activ))
    FROM public.employees e CROSS JOIN LATERAL (SELECT public.fn_sms_tel_normalizat(e.telefon) AS tel) t
   WHERE e.active IS TRUE
   ORDER BY e.name, e.id;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_intern_creeaza(p_text text, p_departamente text[] DEFAULT NULL, p_angajati integer[] DEFAULT NULL,
                                                 p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- un singur instantaneu: candidatii (angajati activi din filtre), excluderile si lista finala (un SMS per telefon)
  WITH c AS (
    SELECT e.id, public.fn_sms_tel_normalizat(e.telefon) AS tel
      FROM public.employees e
     WHERE e.active IS TRUE
       AND (coalesce(cardinality(p_angajati), 0) = 0 OR e.id = ANY (p_angajati))
       AND (coalesce(cardinality(p_departamente), 0) = 0 OR e.department = ANY (p_departamente))
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms: niciun angajat activ in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms: niciun destinatar cu mobil RO valid (dupa filtre si opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    INSERT INTO public.sms_loturi (categorie, text, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('intern', v_text, jsonb_build_object('departamente', to_jsonb(p_departamente), 'angajati_selectati', coalesce(cardinality(p_angajati), 0)),
            v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'angajat', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'intern', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost, 'plafon_zi', v_plafon,
    'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0), 'preview', coalesce(p_doar_preview, true));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_redari_creeaza(p_text text, p_proiect_id uuid, p_uat_id uuid DEFAULT NULL, p_doar_preview boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_text text; v_lungime integer; v_tel text[]; v_ids text[]; v_cand integer; v_fara integer; v_opt integer; v_nr integer;
        v_lot uuid; v_ins integer; v_plafon integer; v_cost numeric;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  -- Decizia lui Razvan (03.11.2026): construit complet, dar BLOCAT pana la autorizarea scrisa Transgaz (sub-imputernicit art. 28 GDPR)
  IF NOT coalesce((SELECT s.redari_autorizat FROM public.sms_setari s WHERE s.id), false) THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit; il seteaza doar owner-ul, cu nr. si data)'
      USING ERRCODE = '42501';
  END IF;
  IF p_proiect_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.red_proiecte pr WHERE pr.id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: proiect inexistent' USING ERRCODE = '22023';
  END IF;
  IF p_uat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.red_uat u WHERE u.id = p_uat_id AND u.proiect_id = p_proiect_id) THEN
    RAISE EXCEPTION 'sms redari: UAT-ul nu e al proiectului' USING ERRCODE = '22023';
  END IF;
  v_text := public.fn_sms_text_valid(p_text);
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(v_text) f;
  -- destinatarii = detinatorii (activi, nedecedati) cu convocare activa pe parcelele proiectului / UAT-ului; telefonul din contact
  WITH c AS (
    SELECT DISTINCT d.id, public.fn_sms_tel_normalizat(k.telefon) AS tel
      FROM public.red_convocari cv
      JOIN public.red_detinatori d ON d.id = cv.detinator_id AND d.sters_la IS NULL AND d.decedat IS NOT TRUE
      JOIN public.red_parcele pa ON pa.id = d.parcela_id AND pa.sters_la IS NULL AND pa.proiect_id = p_proiect_id
                                AND (p_uat_id IS NULL OR pa.uat_id = p_uat_id)
      LEFT JOIN public.red_detinatori_contact k ON k.detinator_id = d.id
     WHERE cv.stare = 'activ' AND cv.sters_la IS NULL
  ), b AS (
    SELECT c.id, c.tel, (c.tel IS NOT NULL AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = c.tel AND o.activ)) AS opt FROM c
  ), d AS (
    SELECT DISTINCT ON (b.tel) b.tel, b.id FROM b WHERE b.tel IS NOT NULL AND NOT b.opt ORDER BY b.tel, b.id
  )
  SELECT (SELECT count(*) FROM b), (SELECT count(*) FROM b WHERE b.tel IS NULL), (SELECT count(*) FROM b WHERE b.opt),
         (SELECT array_agg(d.tel ORDER BY d.tel) FROM d), (SELECT array_agg(d.id::text ORDER BY d.tel) FROM d)
    INTO v_cand, v_fara, v_opt, v_tel, v_ids;
  v_nr := coalesce(cardinality(v_tel), 0);
  IF v_cand = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu convocare activa in selectie' USING ERRCODE = '22023'; END IF;
  IF v_nr = 0 THEN RAISE EXCEPTION 'sms redari: niciun detinator cu mobil RO valid (dupa opt-out)' USING ERRCODE = '22023'; END IF;
  IF v_nr > 5000 THEN RAISE EXCEPTION 'sms: maximum 5000 de destinatari intr-un lot' USING ERRCODE = '22023'; END IF;
  v_cost := round(v_nr * 0.049, 3);
  SELECT s.plafon_zi INTO v_plafon FROM public.sms_setari s WHERE s.id;
  IF NOT coalesce(p_doar_preview, true) THEN
    INSERT INTO public.sms_loturi (categorie, text, proiect_id, uat_id, filtru, nr_destinatari, segmente, cost_estimat_eur, excluse_optout, excluse_fara_mobil)
    VALUES ('redari', v_text, p_proiect_id, p_uat_id, jsonb_build_object('uat_id', p_uat_id), v_nr, 1, v_cost, v_opt, v_fara)
    RETURNING id INTO v_lot;
    INSERT INTO public.sms_mesaje (lot_id, telefon, destinatar_tip, destinatar_id)
    SELECT v_lot, u.t, 'detinator', u.i FROM unnest(v_tel, v_ids) AS u(t, i);
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins <> v_nr THEN RAISE EXCEPTION 'sms: lista de destinatari s-a schimbat in timpul crearii; reincearca' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN jsonb_build_object('lot_id', v_lot, 'categorie', 'redari', 'text_final', v_text, 'lungime', v_lungime, 'segmente', 1,
    'nr_destinatari', v_nr, 'candidati', v_cand, 'excluse_optout', v_opt, 'excluse_fara_mobil', v_fara,
    'excluse_duplicat', v_cand - v_fara - v_opt - v_nr, 'cost_estimat_eur', v_cost, 'plafon_zi', v_plafon,
    'depaseste_plafon_zi', v_nr > coalesce(v_plafon, 0), 'preview', coalesce(p_doar_preview, true));
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_destinatari(p_lot_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_lista jsonb; v_lungime integer;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002'; END IF;
  SELECT f.lungime INTO v_lungime FROM public.fn_sms_text_verifica(l.text) f;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mesaj_id', x.id, 'destinatar_tip', x.destinatar_tip, 'nume', x.nume,
           'telefon_mascat', '07** *** ' || right(x.telefon, 3), 'stare', x.stare, 'cod_eroare', x.cod_eroare) ORDER BY x.nume, x.id), '[]'::jsonb)
    INTO v_lista
    FROM (SELECT m.id, m.destinatar_tip, m.telefon, m.stare, m.cod_eroare,
                 coalesce(CASE WHEN m.destinatar_tip = 'angajat' THEN e.name ELSE d.nume END, '(destinatar indisponibil)') AS nume
            FROM public.sms_mesaje m
            LEFT JOIN public.employees e
              ON e.id = CASE WHEN m.destinatar_tip = 'angajat' AND m.destinatar_id ~ '^[0-9]{1,9}$' THEN m.destinatar_id::integer END
            LEFT JOIN public.red_detinatori d
              ON d.id = CASE WHEN m.destinatar_tip = 'detinator' AND m.destinatar_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             THEN m.destinatar_id::uuid END
           WHERE m.lot_id = l.id) x;
  RETURN jsonb_build_object('lot_id', l.id, 'categorie', l.categorie, 'stare', l.stare, 'versiune', l.versiune, 'text', l.text,
    'lungime', v_lungime, 'segmente', l.segmente, 'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur,
    'excluse_optout', l.excluse_optout, 'excluse_fara_mobil', l.excluse_fara_mobil, 'proiect_id', l.proiect_id, 'uat_id', l.uat_id,
    'creat_la', l.creat_la, 'destinatari', v_lista);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_aproba(p_lot_id uuid, p_versiune integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; s public.sms_setari; v_n integer;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  -- ordinea lock-urilor: setari -> lot (ca la rezervare)
  SELECT * INTO s FROM public.sms_setari WHERE id FOR SHARE;
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002'; END IF;
  IF l.stare <> 'draft' THEN RAISE EXCEPTION 'sms: doar un lot in draft se aproba (starea: %)', l.stare USING ERRCODE = '23514'; END IF;
  IF p_versiune IS DISTINCT FROM l.versiune THEN
    RAISE EXCEPTION 'sms: lotul s-a schimbat de la previzualizare; reincarca si verifica din nou' USING ERRCODE = '40001';
  END IF;
  IF l.categorie = 'redari' AND NOT s.redari_autorizat THEN
    RAISE EXCEPTION 'sms redari: blocat - asteapta autorizarea scrisa Transgaz (comutatorul redari_autorizat e oprit)' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_n FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada';
  IF v_n <> l.nr_destinatari THEN
    RAISE EXCEPTION 'sms: lotul nu mai e intreg (% mesaje din %); anuleaza-l si creeaza altul', v_n, l.nr_destinatari USING ERRCODE = '23514';
  END IF;
  UPDATE public.sms_loturi SET stare = 'aprobat' WHERE id = l.id RETURNING * INTO l;
  RETURN jsonb_build_object('lot_id', l.id, 'stare', l.stare, 'aprobat_la', l.aprobat_la, 'versiune', l.versiune,
    'nr_destinatari', l.nr_destinatari, 'cost_estimat_eur', l.cost_estimat_eur, 'aprobat_autorizare_nr', l.aprobat_autorizare_nr);
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_sms_lot_anuleaza(p_lot_id uuid, p_motiv text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE l public.sms_loturi; v_n integer; c record;
BEGIN
  PERFORM public.fn_sms_cere_owner();
  SELECT * INTO l FROM public.sms_loturi WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: lotul nu exista' USING ERRCODE = 'P0002'; END IF;
  IF l.stare NOT IN ('draft', 'aprobat', 'in_trimitere') THEN
    RAISE EXCEPTION 'sms: lotul e deja inchis (%)', l.stare USING ERRCODE = '23514';
  END IF;
  UPDATE public.sms_mesaje SET stare = 'anulat', cod_eroare = 'lot_anulat' WHERE lot_id = l.id AND stare = 'in_coada';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.sms_loturi SET stare = 'anulat', motiv_anulare = left(nullif(btrim(p_motiv), ''), 500) WHERE id = l.id RETURNING * INTO l;
  -- ce NU mai pleaca (scoase acum din coada) separat de ce era deja rezervat / predat furnizorului (ramane in istoric, nu se opreste)
  SELECT count(*) FILTER (WHERE m.stare = 'necunoscut') AS necunoscut, count(*) FILTER (WHERE m.stare = 'trimis') AS trimis,
         count(*) FILTER (WHERE m.stare = 'livrat') AS livrat, count(*) FILTER (WHERE m.stare = 'esuat') AS esuat
    INTO c FROM public.sms_mesaje m WHERE m.lot_id = l.id;
  RETURN jsonb_build_object('lot_id', l.id, 'stare', l.stare, 'mesaje_anulate', v_n,
    'deja_predate', c.necunoscut + c.trimis + c.livrat + c.esuat,
    'deja_rezervate_necunoscut', c.necunoscut, 'deja_trimise', c.trimis, 'deja_livrate', c.livrat, 'deja_esuate', c.esuat);
END $fn$;

-- ─── 4. fn_sms_rezerva cu 3 argumente (20261130a), doar service_role ──────────────────────────────────────────────────────
DROP FUNCTION public.fn_sms_rezerva(uuid, integer, text, uuid);
CREATE FUNCTION public.fn_sms_rezerva(p_lot_id uuid, p_max integer, p_furnizor text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE s public.sms_setari; l public.sms_loturi; c record; v_ora integer; v_rest integer; v_n integer; v_arr jsonb; v_ram integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'sms: rezervarea cere izolarea READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF p_max IS NULL OR p_max < 1 OR p_max > 50 THEN RAISE EXCEPTION 'sms: p_max in afara 1..50' USING ERRCODE = '22023'; END IF;
  IF p_furnizor IS NULL OR p_furnizor NOT IN ('smslink', 'simulator') THEN RAISE EXCEPTION 'sms: furnizor necunoscut' USING ERRCODE = '22023'; END IF;
  -- randul de setari FOR UPDATE serializeaza toate rezervarile: kill-switch-ul si plafonul se verifica atomic
  SELECT * INTO s FROM public.sms_setari WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sms: setarile lipsesc' USING ERRCODE = 'P0002'; END IF;
  IF s.kill_switch THEN RETURN jsonb_build_object('motiv', 'kill_switch', 'mesaje', '[]'::jsonb); END IF;
  v_ora := extract(hour FROM now() AT TIME ZONE 'Europe/Bucharest')::integer;
  -- cron intern (fara lot): cel mai vechi lot aprobat care poate pleca acum
  IF p_lot_id IS NULL THEN
    SELECT * INTO l FROM public.sms_loturi x
     WHERE x.stare IN ('aprobat', 'in_trimitere') AND (x.categorie = 'intern' OR (s.redari_autorizat AND v_ora BETWEEN 8 AND 19))
     ORDER BY x.aprobat_la, x.id LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO l FROM public.sms_loturi x WHERE x.id = p_lot_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('motiv', 'fara_lot', 'mesaje', '[]'::jsonb); END IF;
  IF l.stare NOT IN ('aprobat', 'in_trimitere') THEN RETURN jsonb_build_object('motiv', 'lot_' || l.stare, 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND NOT s.redari_autorizat THEN RETURN jsonb_build_object('motiv', 'redari_neautorizat', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  IF l.categorie = 'redari' AND v_ora NOT BETWEEN 8 AND 19 THEN RETURN jsonb_build_object('motiv', 'in_afara_orelor', 'lot_id', l.id, 'mesaje', '[]'::jsonb); END IF;
  SELECT * INTO c FROM public.fn_sms_consum();
  IF c.luna >= s.plafon_luna THEN RETURN jsonb_build_object('motiv', 'plafon_luna', 'lot_id', l.id, 'consum_luna', c.luna, 'mesaje', '[]'::jsonb); END IF;
  IF c.zi >= s.plafon_zi THEN RETURN jsonb_build_object('motiv', 'plafon_zi', 'lot_id', l.id, 'consum_zi', c.zi, 'mesaje', '[]'::jsonb); END IF;
  v_rest := least(s.plafon_zi - c.zi, s.plafon_luna - c.luna) / l.segmente;
  v_n := least(p_max, v_rest);
  IF v_n < 1 THEN RETURN jsonb_build_object('motiv', 'plafon_zi', 'lot_id', l.id, 'consum_zi', c.zi, 'mesaje', '[]'::jsonb); END IF;
  IF l.stare = 'aprobat' THEN UPDATE public.sms_loturi SET stare = 'in_trimitere' WHERE id = l.id; END IF;
  -- opt-out verificat din nou la trimitere: numarul iese din lot (anulat), nu pleaca
  UPDATE public.sms_mesaje m SET stare = 'anulat', cod_eroare = 'optout'
   WHERE m.lot_id = l.id AND m.stare = 'in_coada' AND EXISTS (SELECT 1 FROM public.sms_optout o WHERE o.telefon = m.telefon AND o.activ);
  WITH x AS (
    SELECT m.id FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada' ORDER BY m.creat_la, m.id LIMIT v_n FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.sms_mesaje m SET stare = 'necunoscut', furnizor = p_furnizor FROM x WHERE m.id = x.id RETURNING m.id, m.telefon, m.segmente
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'telefon', u.telefon, 'segmente', u.segmente) ORDER BY u.id), '[]'::jsonb) INTO v_arr FROM u;
  SELECT count(*) INTO v_ram FROM public.sms_mesaje m WHERE m.lot_id = l.id AND m.stare = 'in_coada';
  -- coada goala: lotul NU e „trimis” (mesajele pot fi inca necunoscut); rezultatul real ramane pe mesaje
  IF v_ram = 0 THEN UPDATE public.sms_loturi SET stare = 'coada_golita' WHERE id = l.id AND stare = 'in_trimitere'; END IF;
  RETURN jsonb_build_object('motiv', CASE WHEN jsonb_array_length(v_arr) > 0 THEN 'ok' ELSE 'gata' END, 'lot_id', l.id, 'categorie', l.categorie,
    'text', l.text, 'mesaje', v_arr, 'ramase', v_ram);
END $fn$;
COMMENT ON FUNCTION public.fn_sms_rezerva(uuid, integer, text) IS 'SMS (doar service_role, din edge sms-trimite dupa poarta owner / cron intern): rezerva ATOMIC pana la p_max mesaje ale unui lot aprobat, sub kill-switch si plafoane; mesajele rezervate trec in necunoscut (fara rezultat = nu se retrimit).';
REVOKE ALL ON FUNCTION public.fn_sms_rezerva(uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_sms_rezerva(uuid, integer, text) TO service_role;

-- ─── 5. Functiile noi din 20261130b (nimic nu le mai foloseste) ─────────────────────────────────────────────────────────────
DROP FUNCTION public.fn_sms_cere_lot(uuid, text, text, integer);
DROP FUNCTION public.fn_sms_cere_nivel();
DROP FUNCTION public.fn_sms_redari_permis();
DROP FUNCTION public.fn_sms_nivel();
DROP FUNCTION public.fn_sms_lot_permis(text, boolean, text, integer, boolean);
DROP FUNCTION public.fn_sms_redari_modul_cont(uuid);
DROP FUNCTION public.fn_sms_nivel_cont(uuid);

DO $post$
DECLARE r record; v_o oid;
  v_expuse regprocedure[] := ARRAY['public.fn_sms_e_owner()', 'public.fn_sms_panou()', 'public.fn_sms_angajati_lista()',
    'public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)',
    'public.fn_sms_lot_destinatari(uuid)', 'public.fn_sms_lot_aproba(uuid,integer)', 'public.fn_sms_lot_anuleaza(uuid,text)',
    'public.fn_sms_setari_salveaza(boolean,integer,integer,integer)',
    'public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', 'public.fn_sms_optout_seteaza(text,boolean,text)']::regprocedure[];
  v_serviciu regprocedure[] := ARRAY['public.fn_sms_rezerva(uuid,integer,text)', 'public.fn_sms_rezultat(uuid,boolean,text,text,text)',
    'public.fn_sms_dlr_aplica(text,text,boolean,timestamptz)']::regprocedure[];
BEGIN
  -- toate cele 25 de functii au exact corpurile 20261130a (aceleasi md5 ca garda de start a migrarii 20261130b); CR-urile se ignora
  -- (un fisier aplicat cu CRLF da acelasi corp, cu \r la capat de rand)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_sms_tel_normalizat(text)', '36549798f8f7dcb40aee8cce7a0516b4'),
      ('public.fn_sms_text_final(text)', '5b6c4ac4c68d42fb45949b027f96fabb'),
      ('public.fn_sms_text_verifica(text)', 'fb828f896937261687a9b2c386284218'),
      ('public.fn_sms_text_valid(text)', '8c551b7bb9d0580a0ad9a29a286ceda6'),
      ('public.fn_sms_e_owner()', '4ea29d605a2a8b491594f9d43da7385c'),
      ('public.fn_sms_cere_owner()', 'd6f5485f3f415ac746b580bb100cbd78'),
      ('public.fn_sms_consum()', '5ea88d56e11ed99307a6c53fcbd18c4e'),
      ('public.fn_sms_setari_reguli()', '48c6393049c77bc257c4e19161838927'),
      ('public.fn_sms_loturi_reguli()', '047811f11b9eb383a67e696a8c33281e'),
      ('public.fn_sms_mesaje_reguli()', '6e5a3442e406901efb6bffe1b9ab64c4'),
      ('public.fn_sms_optout_reguli()', '8c13b3633cdcb974150430fcf14a14ab'),
      ('public.fn_sms_dlr_reguli()', 'eca8c83ad782ba9a8514f7462296f395'),
      ('public.fn_sms_panou()', '4268a4e7e136f7347fed768a4754e698'),
      ('public.fn_sms_angajati_lista()', '44ac4de1b6d65eae2db97a33c000f639'),
      ('public.fn_sms_lot_intern_creeaza(text,text[],integer[],boolean)', 'f870f8f33b4c41341404cbe464b17468'),
      ('public.fn_sms_lot_redari_creeaza(text,uuid,uuid,boolean)', '68f3d395e2daa8baa260cc90cbc44cc0'),
      ('public.fn_sms_lot_destinatari(uuid)', 'ed5f409c425c5c21b4342def475cad9f'),
      ('public.fn_sms_lot_aproba(uuid,integer)', '893f96a2813053dd5bc67c6b7f184248'),
      ('public.fn_sms_lot_anuleaza(uuid,text)', 'fc4bc5cfff5d1ce11e24a894fc33bffc'),
      ('public.fn_sms_setari_salveaza(boolean,integer,integer,integer)', 'f7a1165c664db48a28fa6c2040c9abe9'),
      ('public.fn_sms_redari_autorizare_seteaza(boolean,text,date,integer)', '325dd028140a251a121fdbfc78a87106'),
      ('public.fn_sms_optout_seteaza(text,boolean,text)', 'cf86478ac731b04b102c430613fa1f6e'),
      ('public.fn_sms_rezerva(uuid,integer,text)', '415726344645926cc99fac661b7846d5'),
      ('public.fn_sms_rezultat(uuid,boolean,text,text,text)', 'b641f8c12d851541be4e0fc300f44dc3'),
      ('public.fn_sms_dlr_aplica(text,text,boolean,timestamp with time zone)', '38b0a5a364756412f10415282889d9da')) AS v(semnatura, md5_corp) LOOP
    IF to_regprocedure(r.semnatura) IS NULL
       OR md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(r.semnatura)), chr(13), '')) IS DISTINCT FROM r.md5_corp THEN
      RAISE EXCEPTION '20261130b revenire: functia % nu e cea din 20261130a', r.semnatura;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!') <> 25 THEN
    RAISE EXCEPTION '20261130b revenire: au ramas functii fn_sms_* din 20261130b';
  END IF;
  FOR v_o IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn!_sms!_%' ESCAPE '!' LOOP
    IF has_function_privilege('anon', v_o, 'EXECUTE') OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_o AND a.grantee = 0)
       OR has_function_privilege('authenticated', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_expuse))
       OR has_function_privilege('service_role', v_o, 'EXECUTE') IS DISTINCT FROM (v_o::regprocedure = ANY (v_serviciu)) THEN
      RAISE EXCEPTION '20261130b revenire: drepturi gresite pe %', v_o::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('sms_setari', 'sms_loturi', 'sms_mesaje', 'sms_optout', 'sms_dlr')) <> 5
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'sms!_%' ESCAPE '!'
                 AND (qual !~ 'fn_sms_e_owner' OR qual ~ 'fn_sms_nivel' OR cmd <> 'SELECT' OR roles <> '{authenticated}')) THEN
    RAISE EXCEPTION '20261130b revenire: politicile RLS nu sunt cele din 20261130a';
  END IF;
  IF has_table_privilege('anon', 'public.sms_v_loturi', 'SELECT') OR has_table_privilege('service_role', 'public.sms_v_loturi', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.sms_v_loturi', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.sms_v_loturi'::regclass AND reloptions::text ~ 'security_invoker=(on|true)')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sms_v_loturi') <> 28 THEN
    RAISE EXCEPTION '20261130b revenire: vederea sms_v_loturi nu e cea din 20261130a';
  END IF;
  RAISE NOTICE '20261130b revenire: SMS doar owner; pastrate: % loturi cu nivel scris, % drepturi user_module_access sms (inerte)',
    (SELECT count(*) FROM public.sms_loturi WHERE coalesce(creat_nivel, aprobat_nivel, anulat_nivel) IS NOT NULL),
    (SELECT count(*) FROM public.user_module_access WHERE module = 'sms');
END $post$;
