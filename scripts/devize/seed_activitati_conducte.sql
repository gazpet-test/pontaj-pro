-- NERULAT. Setul standard de activități pentru conducte (propunerea „Legarea raportului zilnic de devize”, §2.2), pe UN proiect.
-- Cine îl rulează: chat-ul, după „da”-ul lui Răzvan (date reale), DUPĂ ce migrarea 20261208a e aplicată. Calea server (postgres, fără JWT)
-- trece de garda de configurare; din aplicație aceeași configurare o face Execuție editor / admin.
-- Rulare:  psql -X -v ON_ERROR_STOP=1 -v proiect_id=<id> -f scripts/devize/seed_activitati_conducte.sql
-- Idempotent: o activitate cu același nume (fără diacritice / majuscule) pe proiect NU se dublează și NU se suprascrie.
-- Ce înseamnă coloanele: coduri_deviz = prefixele articolelor din catalog; UM = UM-ul din teren (conversia din UM-ul articolului e automată:
-- HM = 100 m, 100 MC = 100 mc, M.C. = mc); factor_um = multiplicator suplimentar, 1 peste tot; baza „oferta” = doar contractul inițial.
-- DE CONFIRMAT (Răzvan / Kostas) înainte de rulare:
--   * literele radiografiilor pe DN, din denumirile devizelor Lot 1: A = DN ≤ 150, B = 200, C = 250, D = 300, F = 400, H = 500, I = 600, K = 800;
--     ținta sudurilor = radiografiile din OFERTĂ (în revizuită sunt 0: s-a renunțat la ele prin acte adiționale);
--   * TSC (săpătură) prinde și TSC17 în „100 M” (nu e volum): apare ca „date incomplete”, nu se adună — de confirmat dacă e săpătură;
--   * TSD (astupare) prinde TSD01 / TSD04 în mc și TSD02 / TSD03 în 100 mc: se adună corect după conversie; TSD03 = împrăștiere pământ
--     la refacerea amplasamentului — de confirmat dacă intră la „astupare”;
--   * probele: GC03 (cu aer, pe bucată) = bifă; GC05 (hidraulic, în HM) și GC01 (curățare / calibrare / uscare, în HM) = metri;
--   * sudurile la nod se iau din schema nodului (sursa „schema_nod”), pe tronsoane le scrie șeful de șantier.
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('gazpet.seed_devize_proiect', :'proiect_id', true);
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'seed: rulează ca postgres'; END IF;
  IF current_setting('gazpet.seed_devize_proiect', true) !~ '^[0-9]{1,18}$'
     OR NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = current_setting('gazpet.seed_devize_proiect')::bigint) THEN
    RAISE EXCEPTION 'seed: proiectul % nu există', current_setting('gazpet.seed_devize_proiect', true);
  END IF;
  IF to_regprocedure('public.fn_executie_tinte_calcul()') IS NULL THEN RAISE EXCEPTION 'seed: migrarea 20261208a nu e aplicată'; END IF;
END $pre$;

WITH p AS (SELECT current_setting('gazpet.seed_devize_proiect')::bigint AS id),
start AS (SELECT coalesce(max(a.ordine), 0) AS o FROM public.proiect_activitati a, p WHERE a.proiect_id = p.id),
v(n, nume, um, coduri, tip, sursa, baza, dn_min, dn_max) AS (VALUES
  (1,  'Suduri DN 800',                     'buc', 'M1L05K',                'cantitate', 'schema_nod', 'oferta',    800,  800),
  (2,  'Suduri DN 600',                     'buc', 'M1L05I',                'cantitate', 'schema_nod', 'oferta',    600,  600),
  (3,  'Suduri DN 500',                     'buc', 'M1L05H',                'cantitate', 'schema_nod', 'oferta',    500,  500),
  (4,  'Suduri DN 400',                     'buc', 'M1L05F',                'cantitate', 'schema_nod', 'oferta',    400,  400),
  (5,  'Suduri DN 300',                     'buc', 'M1L05D',                'cantitate', 'schema_nod', 'oferta',    300,  300),
  (6,  'Suduri DN 250',                     'buc', 'M1L05C',                'cantitate', 'schema_nod', 'oferta',    250,  250),
  (7,  'Suduri DN 200',                     'buc', 'M1L05B',                'cantitate', 'schema_nod', 'oferta',    200,  200),
  (8,  'Suduri DN 150 și mai mici',         'buc', 'M1L05A',                'cantitate', 'schema_nod', 'oferta',    NULL, 150),
  (9,  'Țeavă lansată',                     'm',   'GA03,GA04,GA05,GA06',   'cantitate', 'raport',     'revizuita', NULL, NULL),
  (10, 'Izolare suduri (manșoane)',         'mp',  'IZMTT',                 'cantitate', 'raport',     'revizuita', NULL, NULL),
  (11, 'Săpătură',                          'mc',  'TSC',                   'cantitate', 'raport',     'revizuita', NULL, NULL),
  (12, 'Astupare / umplutură',              'mc',  'TSD',                   'cantitate', 'raport',     'revizuita', NULL, NULL),
  (13, 'Probă de presiune cu aer',          'buc', 'GC03',                  'bifa',      'raport',     'revizuita', NULL, NULL),
  (14, 'Probă hidraulică',                  'm',   'GC05',                  'cantitate', 'raport',     'revizuita', NULL, NULL),
  (15, 'Curățare / calibrare / uscare',     'm',   'GC01',                  'cantitate', 'raport',     'revizuita', NULL, NULL),
  (16, 'Control ultrasunete (NDT)',         'buc', 'M1L42',                 'cantitate', 'raport',     'revizuita', NULL, NULL))
INSERT INTO public.proiect_activitati (proiect_id, nume, um, coduri_deviz, ordine, tip_raportare, activ,
                                       principala, factor_um, sursa_executat, baza_deviz, dn_min, dn_max)
SELECT p.id, v.nume, v.um, v.coduri, start.o + v.n, v.tip, true, true, 1, v.sursa, v.baza, v.dn_min, v.dn_max
  FROM v CROSS JOIN p CROSS JOIN start
 WHERE NOT EXISTS (SELECT 1 FROM public.proiect_activitati a WHERE a.proiect_id = p.id
                     AND lower(translate(a.nume, 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT')) = lower(translate(v.nume, 'ăâîșşțţĂÂÎȘŞȚŢ', 'aaissttAAISSTT')))
RETURNING id, nume, coduri_deviz, sursa_executat, baza_deviz;

-- control: activitățile principale ale proiectului după seed (ce exista înainte rămâne neatins)
SELECT id, nume, um, coduri_deviz, tip_raportare, principala, factor_um, sursa_executat, baza_deviz, dn_min, dn_max
  FROM public.proiect_activitati WHERE proiect_id = current_setting('gazpet.seed_devize_proiect')::bigint ORDER BY ordine, id;
COMMIT;
