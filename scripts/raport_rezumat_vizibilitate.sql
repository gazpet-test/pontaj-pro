-- Proba de VIZIBILITATE a rezumatului 20261216a (r3, Jakarinos: „garda DEFINER citește ca proprietar”) — DOAR CITIRE, pe clonă sau producție.
-- Întrebarea: un cont care vede raportul vede și TOT ce intră în rezumatul lui? Garda compune intrarea ca proprietar (o singură imagine,
--   salvată pe rând), deci rezumatul nu are voie să conțină nimic ce cititorul n-ar vedea altfel. Prin construcție (migrarea, blocul INTRARE)
--   intrarea ia doar rândul raportului, șantierul lui, proiectul ȘANTIERULUI și liniile / activitățile / obiectele ACELUIAȘI proiect. Ce
--   rămâne de dovedit sunt politicile de azi ale tabelelor-sursă (sites, executie_proiecte, raport_lucrari, proiect_activitati,
--   proiect_unitati, raport_distributie_linii) — nu sunt în repo, deci se probează pe date:
--   pentru FIECARE cont ne-owner și FIECARE raport pe care îl vede (din ultimele :zile zile), intrarea compusă CA EL (rolul authenticated,
--   JWT-ul lui în ambele surse, RLS-ul lui) trebuie să fie IDENTICĂ cu intrarea compusă ca proprietar (ce ar salva garda). O diferență pe
--   oricare câmp = rezumatul i-ar arăta ceva ce nu vede => NO-GO la aplicare (se scoate câmpul din intrare sau se schimbă politica).
-- Blocul INTRARE e copiat IDENTIC din fn_raport_rezumat_intrare (migrarea 20261216a); testul src/raportRezumat.test.js verifică. Merge și
--   ÎNAINTE de aplicare (nu cheamă nicio funcție a migrării).
-- Ieșirea: doar numere (conturile = „cont #k”, fără id-uri / nume / texte din rapoarte). Verdict pe ultima linie a jurnalului:
--   „VIZIBILITATE OK: …” sau eroare („VIZIBILITATE DIFERENTE …” / „VIZIBILITATE NECONCLUDENT …” = zero cazuri, L25: o paritate fără cazuri
--   nu dovedește nimic). Tranzacție READ ONLY, încheiată cu ROLLBACK (la eroare psql iese, tranzacția se anulează): nimic scris.
-- Rulare (coordonatorul, ca postgres; parola din pgpass):
--   psql -X -v ON_ERROR_STOP=1 [-v zile=60] -h <host> -p <port> -U <user> -d postgres -f scripts/raport_rezumat_vizibilitate.sql
-- Limite declarate: (1) dovedește starea de AZI a datelor și politicilor (un cont / o politică nouă = se reia înainte de aplicare și după
--   orice schimbare de RLS pe tabelele-sursă); (2) doar rolul authenticated (conturile aplicației); rolurile speciale ale portalului de
--   teren nu citesc rapoarte_zilnice; (3) rezumatul salvat urmează raportul: dacă un șantier își schimbă proiectul, rezumatul vechi rămâne
--   până la următoarea salvare a raportului.
\set ON_ERROR_STOP 1
\if :{?zile}
\else
\set zile 60
\endif
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '900s';
SET LOCAL search_path = public, pg_temp;
SELECT set_config('rzviz.zile', :'zile', true) AS zile;
DO $viz$
DECLARE
  v_zile integer := current_setting('rzviz.zile')::integer;
  v_de_la date := (now() AT TIME ZONE 'Europe/Bucharest')::date - current_setting('rzviz.zile')::integer;
  c record; k integer := 0; v_inv jsonb; v_prop jsonb; v_id text; v_camp text;
  v_conturi integer := 0; v_cu_rapoarte integer := 0; v_perechi bigint := 0; v_dif bigint := 0; v_dif_cont integer;
  v_pe_camp jsonb := '{}'::jsonb; v_cont_camp jsonb;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'VIZIBILITATE: ruleaza ca postgres (acum %)', current_user; END IF;
  IF v_zile IS NULL OR v_zile < 1 OR v_zile > 3660 THEN RAISE EXCEPTION 'VIZIBILITATE: zile invalid (%)', v_zile; END IF;
  -- 0. CA PROPRIETARUL (ce ar salva garda DEFINER), o dată, pe toate rapoartele din fereastră (al doilea exemplar al blocului INTRARE)
  SELECT coalesce(jsonb_object_agg(r.id::text, r.intrare), '{}'::jsonb) INTO v_prop
    FROM (
      SELECT z.id,
    -- INTRARE-START
    jsonb_build_object(
      'santier', (SELECT s.name FROM public.sites s WHERE s.id = z.site_id),
      'proiect', (SELECT p.nume FROM public.sites s JOIN public.executie_proiecte p ON p.id = s.proiect_id WHERE s.id = z.site_id),
      'data', to_char(z.data, 'YYYY-MM-DD'),
      'meteo', z.meteo,
      'personal', z.personal_snapshot,
      'utilaje', z.utilaje_snapshot,
      'linii', (SELECT coalesce(jsonb_agg(jsonb_build_object('obiect_cod', pu.cod, 'obiect_nume', pu.nume, 'activitate', pa.nume, 'um', pa.um,
                                                             'cantitate', rl.cantitate, 'bifa', coalesce(pa.tip_raportare, 'cantitate') = 'bifa')
                                          ORDER BY (rl.unitate_id IS NOT NULL), pu.ordine, pu.id, pa.ordine, pa.id, rl.id), '[]'::jsonb)
                  FROM public.raport_lucrari rl
                  JOIN public.sites sp ON sp.id = z.site_id
                  LEFT JOIN public.proiect_activitati pa ON pa.id = rl.activitate_id
                  LEFT JOIN public.proiect_unitati pu ON pu.id = rl.unitate_id
                 WHERE rl.raport_id = z.id
                   AND (rl.proiect_id IS NULL OR rl.proiect_id = sp.proiect_id)
                   AND (pa.id IS NULL OR pa.proiect_id = sp.proiect_id)
                   AND (pu.id IS NULL OR pu.proiect_id = sp.proiect_id)),
      'distributie', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                  ELSE jsonb_build_object('conducte', count(*) FILTER (WHERE d.tabel = 'conducta'),
                                                          'bransamente', count(*) FILTER (WHERE d.tabel = 'bransament')) END
                        FROM public.raport_distributie_linii d WHERE d.raport_id = z.id),
      'lucrari', z.lucrari_efectuate,
      'probleme', z.probleme,
      'masini', z.masini,
      'subcontractori', z.subcontractori,
      'aprovizionare', z.aprovizionare,
      'plan_maine', z.plan_maine,
      'poze', cardinality(z.poze))
    -- INTRARE-END
        AS intrare
        FROM public.rapoarte_zilnice z WHERE z.data >= v_de_la) r;
  FOR c IN SELECT p.id FROM public.profiles p WHERE p.is_owner IS NOT TRUE ORDER BY p.id LOOP
    k := k + 1; v_conturi := v_conturi + 1;
    -- 1. CA CONTUL: ambele surse JWT (auth.uid() citește întâi request.jwt.claim.sub), rolul fără BYPASSRLS, verificat
    PERFORM set_config('request.jwt.claims', json_build_object('sub', c.id, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', c.id::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF auth.uid() IS DISTINCT FROM c.id OR current_user IS DISTINCT FROM 'authenticated'
       OR (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
      RAISE EXCEPTION 'VIZIBILITATE: identitatea contului #% nu s-a schimbat', k;
    END IF;
    SELECT coalesce(jsonb_object_agg(r.id::text, r.intrare), '{}'::jsonb) INTO v_inv
      FROM (
        SELECT z.id,
    -- INTRARE-START
    jsonb_build_object(
      'santier', (SELECT s.name FROM public.sites s WHERE s.id = z.site_id),
      'proiect', (SELECT p.nume FROM public.sites s JOIN public.executie_proiecte p ON p.id = s.proiect_id WHERE s.id = z.site_id),
      'data', to_char(z.data, 'YYYY-MM-DD'),
      'meteo', z.meteo,
      'personal', z.personal_snapshot,
      'utilaje', z.utilaje_snapshot,
      'linii', (SELECT coalesce(jsonb_agg(jsonb_build_object('obiect_cod', pu.cod, 'obiect_nume', pu.nume, 'activitate', pa.nume, 'um', pa.um,
                                                             'cantitate', rl.cantitate, 'bifa', coalesce(pa.tip_raportare, 'cantitate') = 'bifa')
                                          ORDER BY (rl.unitate_id IS NOT NULL), pu.ordine, pu.id, pa.ordine, pa.id, rl.id), '[]'::jsonb)
                  FROM public.raport_lucrari rl
                  JOIN public.sites sp ON sp.id = z.site_id
                  LEFT JOIN public.proiect_activitati pa ON pa.id = rl.activitate_id
                  LEFT JOIN public.proiect_unitati pu ON pu.id = rl.unitate_id
                 WHERE rl.raport_id = z.id
                   AND (rl.proiect_id IS NULL OR rl.proiect_id = sp.proiect_id)
                   AND (pa.id IS NULL OR pa.proiect_id = sp.proiect_id)
                   AND (pu.id IS NULL OR pu.proiect_id = sp.proiect_id)),
      'distributie', (SELECT CASE WHEN count(*) = 0 THEN NULL
                                  ELSE jsonb_build_object('conducte', count(*) FILTER (WHERE d.tabel = 'conducta'),
                                                          'bransamente', count(*) FILTER (WHERE d.tabel = 'bransament')) END
                        FROM public.raport_distributie_linii d WHERE d.raport_id = z.id),
      'lucrari', z.lucrari_efectuate,
      'probleme', z.probleme,
      'masini', z.masini,
      'subcontractori', z.subcontractori,
      'aprovizionare', z.aprovizionare,
      'plan_maine', z.plan_maine,
      'poze', cardinality(z.poze))
    -- INTRARE-END
          AS intrare
          FROM public.rapoarte_zilnice z WHERE z.data >= v_de_la) r;
    -- 2. înapoi la postgres; comparația cu intrarea proprietarului, câmp cu câmp (doar numărătorile ies din bloc)
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
    IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'VIZIBILITATE: revenirea la postgres a esuat'; END IF;
    IF v_inv = '{}'::jsonb THEN CONTINUE; END IF;
    v_cu_rapoarte := v_cu_rapoarte + 1;
    v_dif_cont := 0; v_cont_camp := '{}'::jsonb;
    FOR v_id IN SELECT jsonb_object_keys(v_inv) LOOP
      v_perechi := v_perechi + 1;
      IF v_prop -> v_id IS NULL THEN
        v_dif := v_dif + 1; v_dif_cont := v_dif_cont + 1;
        v_cont_camp := jsonb_set(v_cont_camp, '{raport}', to_jsonb(coalesce((v_cont_camp ->> 'raport')::int, 0) + 1));
        CONTINUE;
      END IF;
      IF (v_inv -> v_id) IS DISTINCT FROM (v_prop -> v_id) THEN
        v_dif := v_dif + 1; v_dif_cont := v_dif_cont + 1;
        FOR v_camp IN SELECT x FROM jsonb_object_keys((v_inv -> v_id) || (v_prop -> v_id)) x LOOP
          IF (v_inv -> v_id -> v_camp) IS DISTINCT FROM (v_prop -> v_id -> v_camp) THEN
            v_cont_camp := jsonb_set(v_cont_camp, ARRAY[v_camp], to_jsonb(coalesce((v_cont_camp ->> v_camp)::int, 0) + 1));
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    IF v_dif_cont > 0 THEN
      RAISE NOTICE 'VIZIBILITATE cont #%: % rapoarte vizibile, % cu intrare diferita; campuri %', k, (SELECT count(*) FROM jsonb_object_keys(v_inv)), v_dif_cont, v_cont_camp;
      FOR v_camp IN SELECT jsonb_object_keys(v_cont_camp) LOOP
        v_pe_camp := jsonb_set(v_pe_camp, ARRAY[v_camp], to_jsonb(coalesce((v_pe_camp ->> v_camp)::int, 0) + (v_cont_camp ->> v_camp)::int));
      END LOOP;
    END IF;
  END LOOP;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'VIZIBILITATE DIFERENTE: % perechi (cont, raport) din % au intrarea compusa ca proprietar diferita de cea vazuta de cont; pe campuri %. NO-GO la aplicare.',
      v_dif, v_perechi, v_pe_camp;
  END IF;
  IF v_perechi = 0 THEN
    RAISE EXCEPTION 'VIZIBILITATE NECONCLUDENT: niciun cont ne-owner nu vede vreun raport din ultimele % zile (% conturi verificate): nimic dovedit', v_zile, v_conturi;
  END IF;
  RAISE NOTICE 'VIZIBILITATE OK: % conturi ne-owner (% cu rapoarte vizibile), % perechi (cont, raport) din ultimele % zile, toate identice cu intrarea compusa ca proprietar',
    v_conturi, v_cu_rapoarte, v_perechi, v_zile;
END $viz$;
ROLLBACK;
