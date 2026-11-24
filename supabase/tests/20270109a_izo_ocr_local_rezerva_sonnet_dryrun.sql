-- DRY 20270109a_izo_ocr_local_rezerva_sonnet: se ruleaza DUPA 20270109a, intr-o singura tranzactie cu ROLLBACK la final, pe clona PG17
-- (psql -X -v ON_ERROR_STOP=1 -f) sau pe PGlite (scripts/pglite/test_izo_ocr_local_rezerva_sonnet_local.mjs). Nimic nu ramane scris.
-- Ce dovedeste, pe RPC-urile REALE ale cozii (20261108a, neschimbate), apelate ca service_role (rolul edge-ului izo-e3-ocr-local);
-- verificarile citesc ca postgres (service_role nu are SELECT pe ocr_local_cereri, 20261108a):
--   t_config      randul de configurare 0.20, valoarea implicita 0.20, CHECK-ul refuza 0.05 (23514);
--   t_rezerva     fn_ocr_local_rezerva_apel rezerva 0.200000 (>= costul maxim Sonnet 0,196) pe plafonul proiectului;
--   t_netrimis    calea noua din edge (PR #1183 r2): ACK `trimis` intarziat, apelul NU pleaca -> trimis -> raspuns {invalid, apel_netrimis}
--                 -> decontat 0 = rezerva eliberata integral (cost_usd 0, cost_real 0, plafonul neatins); trimis -> esuat_inainte e refuzat
--                 de BD (faza_invalida) - de aceea edge-ul nu-l foloseste;
--   t_inainte     calea veche, inaintea ACK-ului: rezervat -> esuat_inainte = cost 0;
--   t_dupa        martor: trimis -> esuat_dupa = decontare CONSERVATOARE a intregii rezerve (0.20) - ce s-ar fi intamplat fara t_netrimis.
-- Conturi / proiecte SINTETICE (proiect 990901, depozit 990902). FIXTURI: pe clona, daca profiles cere alte coloane NOT NULL, se completeaza doar aici.
BEGIN;
SET LOCAL search_path = public, pg_temp;
DO $fix$
DECLARE u uuid := 'f0000000-0000-4000-8000-0000000109a1'; i int;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'DRY 20270109a PRECONDITIE: se ruleaza ca postgres (acum %)', current_user; END IF;
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING' USING u;
  END IF;
  -- r-clona (tiparul 20270105b): profiles.role explicit ('teren' nu da drepturi), fara fisa de angajat
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'role' AND NOT attisdropped) THEN
    EXECUTE 'INSERT INTO public.profiles (id, is_owner, role) VALUES ($1, false, ''teren'') ON CONFLICT (id) DO NOTHING' USING u;
  ELSE
    INSERT INTO public.profiles (id, is_owner) VALUES (u, false) ON CONFLICT (id) DO NOTHING;
  END IF;
  -- 4 cereri in fallback cu dreptul platit acordat (ca dupa fn_ocr_local_drept_platit), cate una pe test
  FOR i IN 1..4 LOOP
    INSERT INTO public.ocr_local_cereri (id, proiect_id, depozit_id, sablon, creat_de, pdf_bytes, stare, ramura, termen_upload, termen_preluare,
        termen_local, termen_fallback, drept_platit_de, drept_platit_la, apel_faza, sterge_dupa)
      VALUES (('d0000000-0000-4000-8000-00000000109' || i)::uuid, 990901, 990902, 'aviz_teava', u, 1000, 'fallback', 'haiku', now(), now(),
        now() + interval '1 hour', now() + interval '1 hour', 'fallback', clock_timestamp(), 'acordat', now() + interval '7 days');
  END LOOP;
END $fix$;
CREATE FUNCTION pg_temp.rd_cerere(i int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT ('d0000000-0000-4000-8000-00000000109' || i)::uuid $f$;
-- un apel RPC ca service_role (rolul edge-ului), apoi înapoi la postgres; rolul verificat în timpul apelului
CREATE FUNCTION pg_temp.rd_faza(i int, f text, r jsonb, c numeric) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'rd_faza: rol %', current_user; END IF;
  PERFORM public.fn_ocr_local_apel_faza(pg_temp.rd_cerere(i), f, NULL, r, c);
  EXECUTE 'RESET ROLE';
END $f$;
CREATE FUNCTION pg_temp.rd_rezerva(i int) RETURNS TABLE(acordat boolean, rezervare_id bigint, status text) LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'rd_rezerva: rol %', current_user; END IF;
  RETURN QUERY SELECT x.acordat, x.rezervare_id, x.status FROM public.fn_ocr_local_rezerva_apel(pg_temp.rd_cerere(i)) x;
  EXECUTE 'RESET ROLE';
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.rd_cerere(int) TO service_role;

-- ── t_config: rândul, valoarea implicită, CHECK-ul ──
DO $t$
BEGIN
  IF (SELECT count(*) FROM public.ocr_local_config) <> 1 OR NOT EXISTS (SELECT 1 FROM public.ocr_local_config WHERE id AND rezerva_usd = 0.20) THEN
    RAISE EXCEPTION 't_config FAIL: randul de configurare nu are rezerva 0.20';
  END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.ocr_local_config'::regclass AND a.attname = 'rezerva_usd') IS DISTINCT FROM '0.20' THEN
    RAISE EXCEPTION 't_config FAIL: valoarea implicita a rezerva_usd nu e 0.20';
  END IF;
  BEGIN
    UPDATE public.ocr_local_config SET rezerva_usd = 0.05 WHERE id;
    RAISE EXCEPTION 't_config FAIL: rezerva 0.05 acceptata';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'DRY 20270109a t_config OK';
END $t$;

-- ── t_rezerva: RPC-ul real rezervă 0.200000 pe plafonul proiectului ──
DO $t$
DECLARE r record; s numeric;
BEGIN
  SELECT * INTO STRICT r FROM pg_temp.rd_rezerva(1);
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 't_rezerva: rolul nu a revenit (%)', current_user; END IF;
  SELECT suma_rezervata INTO STRICT s FROM public.ai_plafon_rezervari WHERE id = r.rezervare_id;
  IF NOT r.acordat OR r.status <> 'rezervat' OR s <> 0.200000 OR s < 46000 * 2 / 1e6 + 10400 * 10 / 1e6 THEN
    RAISE EXCEPTION 't_rezerva FAIL: acordat % status % suma %', r.acordat, r.status, s;
  END IF;
  RAISE NOTICE 'DRY 20270109a t_rezerva OK (suma %)', s;
END $t$;

-- ── t_netrimis: calea r2 a edge-ului — ACK trimis, apelul nu pleacă, raspuns {invalid, apel_netrimis} → decontat 0 ──
DO $t$
DECLARE r record; c public.ocr_local_cereri%ROWTYPE; z public.ai_plafon_rezervari%ROWTYPE; p public.ai_plafon_lunar%ROWTYPE; rez0 numeric; cons0 numeric;
BEGIN
  SELECT * INTO STRICT r FROM pg_temp.rd_rezerva(2);
  SELECT l.rezervat_usd, l.consumat_usd INTO STRICT rez0, cons0 FROM public.ai_plafon_lunar l
    JOIN public.ai_plafon_rezervari x ON x.cheie = l.cheie AND x.luna = l.luna WHERE x.id = r.rezervare_id;
  PERFORM pg_temp.rd_faza(2, 'trimis', NULL, NULL);
  -- din `trimis`, BD nu permite esuat_inainte (de aceea edge-ul închide prin raspuns → decontat 0)
  BEGIN
    PERFORM pg_temp.rd_faza(2, 'esuat_inainte', NULL, NULL);
    RAISE EXCEPTION 't_netrimis FAIL: trimis -> esuat_inainte acceptat';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'faza_invalida' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.rd_faza(2, 'raspuns', '{"invalid":true,"motiv":"termen_depasit","apel_netrimis":true}'::jsonb, NULL);
  PERFORM pg_temp.rd_faza(2, 'decontat', NULL, 0);
  SELECT * INTO STRICT c FROM public.ocr_local_cereri WHERE id = pg_temp.rd_cerere(2);
  SELECT * INTO STRICT z FROM public.ai_plafon_rezervari WHERE id = r.rezervare_id;
  SELECT * INTO STRICT p FROM public.ai_plafon_lunar WHERE cheie = z.cheie AND luna = z.luna;
  IF c.apel_faza <> 'decontat' OR c.cost_usd <> 0 OR c.apel_raspuns <> '{"invalid":true,"motiv":"termen_depasit","apel_netrimis":true}'::jsonb
     OR z.stare <> 'decontat' OR z.cost_real <> 0 OR p.rezervat_usd <> rez0 - 0.20 OR p.consumat_usd <> cons0 THEN
    RAISE EXCEPTION 't_netrimis FAIL: faza % cost % rezervare % / % plafon rezervat % (era %) consumat % (era %)', c.apel_faza, c.cost_usd, z.stare, z.cost_real,
      p.rezervat_usd, rez0, p.consumat_usd, cons0;
  END IF;
  RAISE NOTICE 'DRY 20270109a t_netrimis OK';
END $t$;

-- ── t_inainte: înaintea ACK-ului (termen / numărare / rezervă insuficientă) — esuat_inainte, cost 0 ──
DO $t$
DECLARE r record; c public.ocr_local_cereri%ROWTYPE; z public.ai_plafon_rezervari%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM pg_temp.rd_rezerva(3);
  PERFORM pg_temp.rd_faza(3, 'esuat_inainte', NULL, NULL);
  SELECT * INTO STRICT c FROM public.ocr_local_cereri WHERE id = pg_temp.rd_cerere(3);
  SELECT * INTO STRICT z FROM public.ai_plafon_rezervari WHERE id = r.rezervare_id;
  IF c.apel_faza <> 'esuat_inainte' OR c.cost_usd <> 0 OR z.stare <> 'decontat' OR z.cost_real <> 0 THEN
    RAISE EXCEPTION 't_inainte FAIL: faza % cost % rezervare % / %', c.apel_faza, c.cost_usd, z.stare, z.cost_real;
  END IF;
  RAISE NOTICE 'DRY 20270109a t_inainte OK';
END $t$;

-- ── t_dupa (martor): trimis → esuat_dupa = toată rezerva (0.20) consumată conservator ──
DO $t$
DECLARE r record; c public.ocr_local_cereri%ROWTYPE; z public.ai_plafon_rezervari%ROWTYPE;
BEGIN
  SELECT * INTO STRICT r FROM pg_temp.rd_rezerva(4);
  PERFORM pg_temp.rd_faza(4, 'trimis', NULL, NULL);
  PERFORM pg_temp.rd_faza(4, 'esuat_dupa', NULL, NULL);
  SELECT * INTO STRICT c FROM public.ocr_local_cereri WHERE id = pg_temp.rd_cerere(4);
  SELECT * INTO STRICT z FROM public.ai_plafon_rezervari WHERE id = r.rezervare_id;
  IF c.apel_faza <> 'esuat_dupa' OR c.cost_usd <> 0.20 OR z.stare <> 'pastrat' THEN
    RAISE EXCEPTION 't_dupa FAIL: faza % cost % rezervare %', c.apel_faza, c.cost_usd, z.stare;
  END IF;
  RAISE NOTICE 'DRY 20270109a t_dupa OK (martor: cost conservator %)', c.cost_usd;
END $t$;
DO $t$ BEGIN RAISE NOTICE 'DRY 20270109a TOTUL OK'; END $t$;
ROLLBACK;
