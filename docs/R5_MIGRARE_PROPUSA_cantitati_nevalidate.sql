-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 (Copilot 25.09.2026) — MIGRARE PROPUSĂ, NEAPLICATĂ. Nu e în supabase/migrations/ tocmai ca să nu fie luată drept aplicată.
-- „Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta aprobată."
-- Context și inventarul consumatorilor: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md.
--
-- Se aplică DOAR cu GO Razvan, prin apply_migration (nume propus: r5_cantitati_nevalidate), DUPĂ r5_cantitati_aprobare_istoric
-- (docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql — view-ul citește istoricul; fără el, migrarea se oprește cu mesaj) și ÎNAINTE de merge-ul ramurii
-- claude/cantitati-nevalidate-consumatori. Ordinea contează: codul nou citește v_ofertare_cantitati_nevalidate; fără view,
-- rândul H2 („cantitati") din poarta propunerii spune „nu putem verifica" pe orice licitație care are F3 (fail-closed, ca
-- P0c cu v_ofertare_pt_cerinte_neconfirmate). Azi (SELECT 25.09.2026) doar lic. 5 are F3 de rețea: 47 rânduri, toate 'extras'.
--
-- Conține:
--   1) VIEW NOU v_ofertare_cantitati_nevalidate (security_invoker) — câte rânduri de rețea NU sunt validate de om, pe surse.
--      Filtrul de rețea e IDENTIC cu CTE-ul qm din v_ofertare_pt_stare (dacă îl schimbi acolo, schimbă-l și aici și în v6).
--   2) ofertare_clarificare_planse_auto v6 — totalul F3 citat AUTORITĂȚII vine doar din rânduri validate; cât există
--      rânduri F3 de rețea nevalidate, textul cere corespondența fără total. Baza = funcția LIVE (verificat: repo v5
--      + linia `v_nou := v_noi > 0 AND v_standard` = live, md5 fără comentarii/spații 0875c2200e072289cd5b972b49cabb0c).
--      Atenție: fișierul supabase/migrations/20260926b_…_v5.sql din repo NU e identic cu live (are `v_nou := v_noi > 0`).
--      Runda 4 (verificator R3): setul F3 din v6 = EXACT filtrul qm / lista_f3_m din v_ofertare_pt_stare (același set ca
--      view-ul de mai sus și H2), nu filtrul vechi (um m/ml/M + denumire conduct/țeav/tub), care lua și articole de deviz și
--      rândurile TOTAL; numărul se scrie ro-RO fără ambiguitate („6.519,8 m”, „6.520 m”), independent de lc_numeric.
--
-- Rollback exact: docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate_ROLLBACK.sql.
-- Testat local pe PGlite 0.5.8 (Postgres 18.3 compilat WASM, în proces, de unică folosință; schemă minimă cu coloanele reale),
-- NU pe un Postgres 16 și nu pe BD-ul de producție — un Postgres local (initdb) a fost refuzat de izolarea worktree-ului.
-- Scripturile de test: scratchpad/pglite/test_r5.mjs (runda 3) și test_r5_runda4.mjs (runda 4).
--
-- PREVIEW (rulează ÎNAINTE, doar SELECT; execute_sql întoarce doar ultimul rezultat → un SELECT per apel):
--   (P1) ce va arăta view-ul, pe licitații:
--     SELECT q.licitatie_id, count(*) FILTER (WHERE q.tip_sursa='lista_f3' AND q.status<>'validat') f3_nev,
--            round(sum(q.cantitate) FILTER (WHERE q.tip_sursa='lista_f3' AND q.status<>'validat')) f3_nev_m,
--            count(*) FILTER (WHERE q.tip_sursa='plansa' AND q.status<>'validat') plansa_nev,
--            count(*) FILTER (WHERE q.tip_sursa IS NULL AND q.status<>'validat') fara_tip_nev, count(*) retea
--       FROM ofertare_cantitati q
--      WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--        AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total'
--      GROUP BY 1 ORDER BY 1;
--     La 25.09.2026: lic. 3 → 0 F3 (memoriu 3 din 5 nevalidate); lic. 5 → F3 47 nevalidate / 6.520 m; lic. 95 → 6 fără tip,
--     toate nevalidate (48.195 m); lic. 102 → 2 fără tip, nevalidate.
--   (P1b) ce total F3 ar cita v6 (runda 4, filtrul qm; NULL = fără total, pentru că există F3 nevalidată) vs filtrul vechi:
--     SELECT q.licitatie_id, count(*) FILTER (WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--              AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total') f3_qm_n,
--            count(*) FILTER (WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea' AND q.status<>'validat'
--              AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total') f3_qm_nev,
--            round(sum(q.cantitate) FILTER (WHERE lower(coalesce(q.um,'')) ~ '^m(l|\.l\.)?\.?$' AND q.denumire ~* '(conduct|teav|țeav|tub)'), 1) f3_filtru_vechi_m
--       FROM ofertare_cantitati q WHERE q.tip_sursa='lista_f3' GROUP BY 1 ORDER BY 1;
--     La 26.09.2026: doar lic. 5 — qm 47 rânduri (6.519,79 m), toate nevalidate => v6 fără total; filtrul vechi 62 rânduri /
--     7.747,68 m (+15 rânduri cu um „M” = articole de deviz, 1.227,89 m, ex. „MONTAREA PARAPETELOR SI PODETELOR…”), 0 rânduri TOTAL.
--   (P2) ciornele automate „planse_auto" al căror text s-ar schimba la următorul apel (text standard + F3 cu rânduri nevalidate):
--     SELECT c.id, c.licitatie_id, c.status, left(c.intrebare, 60) FROM ofertare_clarificari c
--      WHERE c.origine='automat' AND c.cheie LIKE 'auto_planse_%' AND c.status IN ('propunere','de_trimis')
--        AND left(coalesce(c.intrebare,''), 92) = 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe'
--        AND EXISTS (SELECT 1 FROM ofertare_cantitati q WHERE q.licitatie_id=c.licitatie_id AND q.tip_sursa='lista_f3' AND q.status<>'validat'
--                     AND q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--                     AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total');
--     (#63 de la lic. 95 NU intră: text editat de om, iar lic. 95 n-are F3.)
--   (P1c) condiția 2 (26.09.2026) — corpul view-ului extins, rulat ca SELECT pe producție: lic. 3 → 3 de rețea nevalidate (23.630 m),
--     0 invalidate ieșite; lic. 5 → F3 47 / 6.520 m, rețea 94 / 94 (28.862 m); lic. 95 → 6 fără tip (48.195 m); lic. 102 → 2 fără tip
--     (167.200 m); invalidate_in_afara_retea = 0 peste tot (regula de invalidare nu rulează încă în BD — vezi
--     docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql). PGlite capăt-la-capăt cu trigger-ul: scratchpad pglite/test_view_conditia2.mjs
--     (runda 6: 18/18), adv_r6.mjs 13/13, test_r5_runda4.mjs 16/16.
--   (P1d) runda 6 (unitatea normalizată, decis în audit 26.09.2026, reversibil) — rândurile care intră în setul de rețea DOAR prin
--     normalizare (um ≠ exact 'm', dar ofertare_norm_text(um) = 'm'):
--     SELECT q.licitatie_id, q.um, q.tip_sursa, q.status, count(*), round(sum(q.cantitate), 2) FROM ofertare_cantitati q
--      WHERE q.um IS DISTINCT FROM 'm' AND lower(btrim(translate(coalesce(q.um,''), chr(160), ' '))) = 'm'
--        AND q.categorie ~* 'conduct|re[țt]ea' AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total'
--      GROUP BY 1,2,3,4;
--     La 26.09.2026: DOAR lic. 5 — 15 rânduri F3 „M”, extras, 1.227,89 m, în „Conducte și montaj”, dar sunt ARTICOLE DE DEVIZ (borduri,
--     parapete…). Efect după aplicare: lista_f3_nevalidate lic. 5 47 → 62 și um_de_normalizat_f3 = 15 (H2 BLOCK, numite); v6 nu citează
--     total cât există rânduri F3 cu unitatea ≠ exact 'm' (f3_um_de_normalizat). Nimic nu se adună tacit; corecția = categoria lor.
-- SANITY (după): SELECT * FROM v_ofertare_cantitati_nevalidate WHERE licitatie_id IN (3,5,95,102) ORDER BY 1;
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 1) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- R5 condiția 2 (Copilot 26.09.2026): rândul invalidat / nevalidat nu dispare TACIT. În plus față de runda 4: metrii pe fiecare
-- sursă, rândurile de rețea fără tip de sursă (nu intră în nicio sumă a lui v_ofertare_pt_stare) și rândurile INVALIDATE care au
-- ieșit din setul de rețea (ex. unitatea m → ml a scos un rând F3 din qm, deci lista_f3_m a scăzut fără semnal). DROP + CREATE
-- (coloane noi în mijloc); view-ul e nou, nimic nu depinde de el.
-- Runda 5 (verificator, MAJOR 1): „invalidat” NU mai depinde doar de textul notei — transferul din planșă și CAD rescriu nota
-- oricărui rând nevalidat, deci o recitire ștergea prefixul „Rândul era VALIDAT …” și rândul ieșea tacit din numărătoare. Sursa
-- principală e ISTORICUL (docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql): ultimul eveniment al rândului e 'invalidat' / 'redeschis'
-- (fără 'validat' după el); prefixul notei rămâne sursă secundară (transferul și CAD îl păstrează acum). Aceeași regulă ca
-- `esteInvalidat` + `marcheazaInvalidate` din src/ofertareCantitatiAprobare.js. ORDINEA: migrarea istoricului se aplică ÎNAINTE.
DO $$ BEGIN
  IF to_regclass('public.ofertare_cantitati_istoric') IS NULL OR to_regprocedure('public.ofertare_norm_text(text)') IS NULL THEN
    RAISE EXCEPTION 'R5: aplică întâi docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql (r5_cantitati_aprobare_istoric) — view-ul citește istoricul';
  END IF;
END $$;
-- Runda 6 (decis în audit 26.09.2026 pe principiile Copilot, reversibil):
--  (a) unitatea NORMALIZATĂ (ofertare_norm_text: trim, lower, spații Unicode — ca `normUm` / randuriFront din JS și regula de
--      invalidare): „M” / „m ” sunt metri, „ml” nu. v_ofertare_pt_stare.qm (live, neatins aici) cere încă exact 'm' => rândurile de
--      rețea cu unitatea scrisă altfel nu intră în totalurile ei: SEMNALATE (um_de_normalizat, _m, _f3), nu scăzute tacit;
--  (b) rândurile TOTAL (‚total’ în obiect / denumire / sursă) invalidate: numărate SEPARAT (total_invalidate, _m — referință, nu se
--      adună cu rândurile pe care le totalizează), ca în randuriLipsa din JS; invalidate_in_afara_retea = fără TOTAL;
--  (c) rândul NEAPROBAT ieșit din rețea prin schimbarea unității (istoric 'unitate_schimbata' după ultima validare, sau prefixul notei
--      „Unitatea s-a schimbat … de reverificat.”): unitate_schimbata_in_afara_retea, _m — nu mai dispare tacit;
--  (d) „invalidat” din istoric = ultimul eveniment al APROBĂRII (fără 'unitate_schimbata'), ca invalidateDinIstoric din JS; prefixele
--      notei contează doar cu terminatorul lor („validarea se reface.” / „de reverificat.”), ca prefixInvalidare / prefixUnitate.
DROP VIEW IF EXISTS public.v_ofertare_cantitati_nevalidate;
CREATE VIEW public.v_ofertare_cantitati_nevalidate WITH (security_invoker = on) AS
WITH ist AS (
  SELECT DISTINCT ON (h.cantitate_id) h.cantitate_id, h.motiv
    FROM public.ofertare_cantitati_istoric h
   WHERE h.motiv <> 'unitate_schimbata'
   ORDER BY h.cantitate_id, h.id DESC
), ium AS (
  SELECT DISTINCT ON (h.cantitate_id) h.cantitate_id, h.motiv
    FROM public.ofertare_cantitati_istoric h
   WHERE h.motiv IN ('validat', 'unitate_schimbata')
   ORDER BY h.cantitate_id, h.id DESC
), b0 AS (
  SELECT q.licitatie_id, q.tip_sursa, q.status, q.cantitate, q.um,
         -- filtrul qm din v_ofertare_pt_stare, cu unitatea NORMALIZATĂ (runda 6); coalesce: categorie NULL = în afara rețelei
         coalesce(public.ofertare_norm_text(q.um) = 'm'::text AND q.categorie ~* 'conduct|re[țt]ea'::text
           AND ((((COALESCE(q.obiect, ''::text) || ' '::text) || COALESCE(q.denumire, ''::text)) || ' '::text) || COALESCE(q.sursa, ''::text)) !~* 'total'::text, false) AS in_retea,
         ((((COALESCE(q.obiect, ''::text) || ' '::text) || COALESCE(q.denumire, ''::text)) || ' '::text) || COALESCE(q.sursa, ''::text)) ~* 'total'::text AS e_total,
         q.status <> 'validat' AND ((coalesce(q.diferenta_nota, '') LIKE 'Rândul era VALIDAT%' AND strpos(q.diferenta_nota, 'validarea se reface.') > 0)
           OR coalesce(i.motiv IN ('invalidat', 'redeschis'), false)) AS invalidat,
         q.status <> 'validat' AND ((strpos(coalesce(q.diferenta_nota, ''), 'Unitatea s-a schimbat') = 1 AND strpos(q.diferenta_nota, 'de reverificat.') > 0)
           OR coalesce(u.motiv = 'unitate_schimbata', false)) AS unitate
    FROM public.ofertare_cantitati q
    LEFT JOIN ist i ON i.cantitate_id = q.id
    LEFT JOIN ium u ON u.cantitate_id = q.id
), b AS (
  SELECT b0.*, (NOT in_retea AND unitate AND NOT invalidat AND NOT e_total) AS unitate_iesit FROM b0
)
SELECT b.licitatie_id,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND status <> 'validat')                  AS lista_f3_nevalidate,
       round(sum(cantitate) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND status <> 'validat'))   AS lista_f3_nevalidate_m,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_c6' AND status <> 'validat')                  AS lista_c6_nevalidate,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'memoriu'  AND status <> 'validat')                  AS memoriu_nevalidate,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'plansa'   AND status <> 'validat')                  AS plansa_nevalidate,
       count(*) FILTER (WHERE in_retea AND tip_sursa IS NULL      AND status <> 'validat')                  AS fara_tip_nevalidate,
       round(sum(cantitate) FILTER (WHERE in_retea AND tip_sursa IS NULL AND status <> 'validat'))        AS fara_tip_nevalidate_m,
       count(*) FILTER (WHERE in_retea AND status <> 'validat')                                              AS retea_nevalidate,
       round(sum(cantitate) FILTER (WHERE in_retea AND status <> 'validat'))                                AS retea_nevalidate_m,
       count(*) FILTER (WHERE in_retea)                                                                      AS retea_randuri,
       count(*) FILTER (WHERE NOT in_retea AND invalidat AND NOT e_total)                                    AS invalidate_in_afara_retea,
       round(sum(cantitate) FILTER (WHERE NOT in_retea AND invalidat AND NOT e_total))                      AS invalidate_in_afara_retea_m,
       count(*) FILTER (WHERE e_total AND invalidat)                                                         AS total_invalidate,
       round(sum(cantitate) FILTER (WHERE e_total AND invalidat))                                           AS total_invalidate_m,
       count(*) FILTER (WHERE unitate_iesit)                                                                 AS unitate_schimbata_in_afara_retea,
       round(sum(cantitate) FILTER (WHERE unitate_iesit))                                                   AS unitate_schimbata_in_afara_retea_m,
       count(*) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm')                                          AS um_de_normalizat,
       round(sum(cantitate) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm'))                            AS um_de_normalizat_m,
       count(*) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm' AND tip_sursa = 'lista_f3')              AS um_de_normalizat_f3
  FROM b
 GROUP BY b.licitatie_id
HAVING count(*) FILTER (WHERE in_retea OR invalidat OR unitate_iesit) > 0;
-- runda 5: default privileges dau ALL pe obiectele noi — întâi REVOKE ALL (și de la authenticated), apoi doar SELECT
REVOKE ALL ON public.v_ofertare_cantitati_nevalidate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ofertare_cantitati_nevalidate TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_cantitati_nevalidate IS 'R5 (25–26.09.2026, runda 6): per licitație, câte rânduri de rețea (filtrul qm din v_ofertare_pt_stare, cu unitatea normalizată) NU sunt validate de om (status<>validat), pe tip_sursa, cu metri; plus rândurile INVALIDATE (istoricul aprobării: ultimul eveniment invalidat / redeschis; sau prefixul notei) ieșite din rețea, rândurile TOTAL invalidate (separat), rândurile neaprobate ieșite din rețea prin schimbarea unității și rândurile de rețea cu unitatea scrisă altfel decât exact m (pe care qm din v_ofertare_pt_stare nu le adună). Citit de OfertarePropunere (H2, controlCantitati): nimic nu dispare tacit. security_invoker.';

-- 2) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- v6 (R5): față de live se schimbă DOAR: v_f3_n/v_f3_nev/v_f3_txt declarate; SELECT-ul F3 (filtrul qm, sumă doar din
-- 'validat' + numărători, runda 5: + rândurile F3 invalidate ieșite din qm); formatul ro-RO al totalului; ramura nouă
-- „2. Corespondența … (F3) în care este cuprins;" fără total; 'f3_nevalidate' în rezultat. Restul = live.
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[]; v_nume text[]; v_motive text[]; v_acoperite bigint[]; v_draft record; v_lot int; v_f3 numeric;
  v_text text; v_lista text; v_det text; v_id bigint; v_nou boolean := false; v_resp uuid; v_nr int; v_noi int;
  v_antet constant text := 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe';
  v_standard boolean; v_tok text; v_det_fd text; v_ilizibile int; v_fara_date int;
  v_f3_n int; v_f3_nev int; v_f3_txt text; v_f3_um int;
BEGIN
  SELECT array_agg(id ORDER BY nume_original),
         array_agg(regexp_replace(nume_original, '\.pdf$', '', 'i') ORDER BY nume_original),
         array_agg(CASE
           WHEN analiza->'plansa'->>'rezultat' = 'citita_fara_date_cantitative'
             OR eroare IN ('citită fără rezultat','citită fără date cantitative') THEN 'fara_date'
           ELSE 'ilizibil' END ORDER BY nume_original)
    INTO v_ids, v_nume, v_motive
  FROM ofertare_documente_atribuire
  WHERE licitatie_id = p_licitatie_id
    AND coalesce(analiza->'plansa'->>'rezultat','') NOT IN ('sursa_gresita_sigla','ok','partial')
    AND NOT (analiza->'plansa'->>'rezultat' IS NULL
             AND NOT coalesce((analiza->'plansa'->>'vectorial')::boolean, false)
             AND greatest(coalesce((analiza->'plansa'->>'latime')::int,0), coalesce((analiza->'plansa'->>'inaltime')::int,0)) BETWEEN 1 AND 1999)
    AND ( analiza->'plansa'->>'rezultat' IN ('ilizibil','citita_fara_date_cantitative')
          OR (analiza->'plansa'->>'citibila') = 'false'
          OR eroare IN ('citită fără rezultat','citită fără date cantitative','ilizibilă')
          OR (analiza->'plansa'->>'randare_esuata') = 'true' );
    -- v4: eșecul tehnic (status eroare fără verdict de lizibilitate) NU mai e tratat ca „ilizibil”.
  IF v_ids IS NULL THEN
    -- v4: se retrag DOAR ciornele cu textul standard; o ciornă editată de om rămâne (decide omul).
    UPDATE ofertare_clarificari SET status = 'retrasa', updated_at = now()
     WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
       AND left(coalesce(intrebare,''), length(v_antet)) = v_antet;
    RETURN jsonb_build_object('actiune','nimic');
  END IF;

  SELECT coalesce(array_agg(x::bigint), '{}') INTO v_acoperite
  FROM ofertare_clarificari c, unnest(string_to_array(replace(c.sursa, 'planse_auto:', ''), ',')) x
  WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%'
    AND c.status NOT IN ('propunere','de_trimis') AND x ~ '^\d+$';
  SELECT array_agg(i), array_agg(n), array_agg(m) INTO v_ids, v_nume, v_motive
  FROM unnest(v_ids, v_nume, v_motive) AS t(i, n, m) WHERE NOT (i = ANY(v_acoperite));
  IF v_ids IS NULL THEN RETURN jsonb_build_object('actiune','deja_trimise'); END IF;

  -- v6 (R5, Copilot 25.09.2026): cifra F3 citată AUTORITĂȚII vine DOAR din rânduri validate de om (status='validat').
  -- Cât există rânduri F3 de rețea nevalidate (transcriere AI neverificată), textul cere corespondența FĂRĂ total.
  -- Runda 4: setul = EXACT filtrul qm / lista_f3_m din v_ofertare_pt_stare (și din v_ofertare_cantitati_nevalidate, H2):
  -- um='m', categorie conductă/rețea, fără „total” în obiect/denumire/sursa. Filtrul vechi (um m/ml/M, denumire
  -- conduct/țeav/tub) lua și articole de deviz (lic. 5: +15 rânduri „M”, 1.227,89 m) și rândurile TOTAL (dublare).
  -- Runda 5 (verificator, minor „um”): un rând F3 INVALIDAT care a ieșit din setul qm (ex. unitatea „m” → „M” / „ml”) nu mai e
  -- omis tacit din total: se numără ca nevalidat (=> fără total) și ca rând F3 (=> textul cere corespondența, nu „nu le-am
  -- identificat”). „Invalidat” = ca în v_ofertare_cantitati_nevalidate (istoric: ultimul eveniment invalidat / redeschis; sau
  -- prefixul notei).
  -- Runda 6 (decis în audit, reversibil): unitatea NORMALIZATĂ în qm (ca view-ul și JS); „de reverificat” = invalidat (istoricul
  -- aprobării, fără 'unitate_schimbata'; sau prefixul regulii, cu terminatorul) SAU unitatea schimbată pe un rând neaprobat
  -- ('unitate_schimbata' după ultima validare; sau prefixul „Unitatea s-a schimbat … de reverificat.”) — un rând F3 care a ieșit din qm
  -- prin m → ml nu mai e omis tacit din total. Și: un rând F3 din qm cu unitatea scrisă altfel decât exact „m” („M”, „m ”; lic. 5
  -- reală: 15 articole de deviz „M” în categoria „Conducte și montaj”, 1.227,89 m) e în setul normalizat, dar poate fi un articol de
  -- deviz => totalul NU se citează autorității cât există astfel de rânduri (v_f3_um > 0: fără total, ca la nevalidate) — nici
  -- umflare tăcută, nici omisiune tăcută; H2 le semnalează (um_de_normalizat_f3).
  SELECT round(sum(x.cantitate) FILTER (WHERE x.status = 'validat' AND x.qm), 1),
         count(*) FILTER (WHERE x.qm OR x.invalidat), count(*) FILTER (WHERE x.status <> 'validat' AND (x.qm OR x.invalidat)),
         count(*) FILTER (WHERE x.qm AND x.um IS DISTINCT FROM 'm')
    INTO v_f3, v_f3_n, v_f3_nev, v_f3_um
  FROM (
    SELECT q.cantitate, q.status, q.um,
           coalesce(public.ofertare_norm_text(q.um) = 'm' AND q.categorie ~* 'conduct|re[țt]ea'
             AND (coalesce(q.obiect, '') || ' ' || coalesce(q.denumire, '') || ' ' || coalesce(q.sursa, '')) !~* 'total', false) AS qm,
           q.status <> 'validat' AND (
             (coalesce(q.diferenta_nota, '') LIKE 'Rândul era VALIDAT%' AND strpos(q.diferenta_nota, 'validarea se reface.') > 0)
             OR (strpos(coalesce(q.diferenta_nota, ''), 'Unitatea s-a schimbat') = 1 AND strpos(q.diferenta_nota, 'de reverificat.') > 0)
             OR coalesce((SELECT h.motiv FROM ofertare_cantitati_istoric h WHERE h.cantitate_id = q.id AND h.motiv <> 'unitate_schimbata' ORDER BY h.id DESC LIMIT 1)
                         IN ('invalidat', 'redeschis'), false)
             OR coalesce((SELECT h.motiv FROM ofertare_cantitati_istoric h WHERE h.cantitate_id = q.id AND h.motiv IN ('validat', 'unitate_schimbata') ORDER BY h.id DESC LIMIT 1)
                         = 'unitate_schimbata', false)) AS invalidat
      FROM ofertare_cantitati q
     WHERE q.licitatie_id = p_licitatie_id AND q.tip_sursa = 'lista_f3'
  ) x;
  IF v_f3_nev > 0 OR v_f3_um > 0 THEN v_f3 := NULL; END IF;
  -- runda 4: format ro-RO neambiguu, independent de lc_numeric („,” și „.” din șablon sunt fixe, G/D ar urma locale-ul):
  -- 6519.8 → „6.519,8”; 6520 → „6.520”. Live scria „7.747.7” (separatorul de mii și zecimalele = același punct).
  v_f3_txt := CASE WHEN v_f3 IS NULL THEN NULL
    WHEN v_f3 = trunc(v_f3) THEN translate(to_char(v_f3, 'FM999,999,999,990'), ',', '.')
    ELSE translate(to_char(v_f3, 'FM999,999,999,990.0'), ',.', '.,') END;

  v_lista := array_to_string(v_nume, ', ');
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det, v_ilizibile FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'ilizibil';
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det_fd, v_fara_date FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'fara_date';
  v_text := v_antet || E'\n\n' ||
    CASE WHEN v_ilizibile > 0 THEN
      'În documentația de atribuire, următoarele planșe nu au putut fi citite (textul — cote, lungimi, diametre, materiale, notări de tronsoane — nu este lizibil sau fișierul nu poate fi deschis):' || E'\n' || v_det || E'\n\n'
    ELSE '' END ||
    CASE WHEN v_fara_date > 0 THEN
      'Pentru următoarele planșe, în lectura efectuată nu au fost identificate date cantitative (lungimi, diametre, tronsoane):' || E'\n' || v_det_fd || E'\n\n'
    ELSE '' END ||
    'Pentru fundamentarea corectă a ofertei, vă rugăm să ne comunicați, pentru planșele de mai sus:' || E'\n' ||
    '1. Lista tronsoanelor: denumire/capete tronson, lungime (m), diametru nominal, material și SDR, mod de pozare, subtraversări/traversări;' || E'\n' ||
    CASE WHEN coalesce(v_f3,0) > 0
      THEN '2. Corespondența fiecărui tronson cu poziția din lista de cantități (F3) în care este cuprins (lungimea totală de conductă din F3: ' ||
           v_f3_txt || ' m);'
      WHEN v_f3_n > 0
      THEN '2. Corespondența fiecărui tronson cu poziția din lista de cantități (F3) în care este cuprins;'
      ELSE '2. Dacă documentația de atribuire cuprinde liste de cantități de lucrări pentru rețea (nu le-am identificat în documentația publicată) și, în caz afirmativ, publicarea acestora;'
    END ||
    CASE WHEN v_ilizibile > 0 THEN E'\n' || '3. Ca alternativă, pentru planșele care nu au putut fi citite, varianta în format editabil (DWG/DXF) sau PDF cu text selectabil.' ELSE '' END ||
    E'\n\n' ||
    'Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.';

  SELECT * INTO v_draft FROM ofertare_clarificari
  WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
  ORDER BY id DESC LIMIT 1;

  IF FOUND THEN
    -- textul e încă cel generat de funcție? (orice text care nu începe cu antetul standard = editat de om)
    v_standard := left(coalesce(v_draft.intrebare, ''), length(v_antet)) = v_antet;
    -- v4: marcajele rezervate de revizie (,revizie_*) din sursa se PĂSTREAZĂ la rescriere
    SELECT coalesce(string_agg(',' || t, '' ORDER BY o), '') INTO v_tok
      FROM unnest(string_to_array(v_draft.sursa, ',')) WITH ORDINALITY AS x(t, o) WHERE o > 1 AND t ~ '^revizie_[a-z0-9_]+$';
    SELECT count(*) INTO v_noi FROM unnest(v_ids) i
      WHERE NOT (i::text = ANY(string_to_array(replace(v_draft.sursa,'planse_auto:',''), ',')));
    IF v_noi = 0 AND v_draft.sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok
       AND (NOT v_standard OR v_draft.intrebare = v_text) THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard);
    END IF;
    -- v5: ciorna editată/aprobată de om NU se retrogradează la 'propunere' (doar sursa se actualizează)
    UPDATE ofertare_clarificari SET
      intrebare = CASE WHEN v_standard THEN v_text ELSE intrebare END,
      sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok,
      status = CASE WHEN v_noi > 0 AND v_standard THEN 'propunere' ELSE status END, updated_at = now()
      WHERE id = v_draft.id;
    v_id := v_draft.id; v_nou := v_noi > 0 AND v_standard;
  ELSE
    SELECT count(*) + 1 INTO v_lot FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id AND cheie LIKE 'auto_planse_%';
    SELECT coalesce(max(nr), 0) + 1 INTO v_nr FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id;
    INSERT INTO ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie)
      VALUES (p_licitatie_id, v_nr, v_text, 'planse_auto:' || array_to_string(v_ids, ','), 'propunere', 'automat', 'auto_planse_' || v_lot)
      ON CONFLICT (licitatie_id, cheie) DO NOTHING RETURNING id INTO v_id;
    v_nou := v_id IS NOT NULL;
  END IF;

  IF v_nou THEN
    SELECT responsabil_id INTO v_resp FROM ofertare_licitatii WHERE id = p_licitatie_id;
    IF v_resp IS NOT NULL THEN
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_resp, 'info', 'Ofertare', '💭 Propunere de clarificare (planșe)',
        'Licitația #' || p_licitatie_id || ': ' || cardinality(v_ids) || ' planșe fără date extrase (' || left(v_lista, 160) ||
        '). Verifică dacă datele nu sunt în memoriu/F3, apoi confirmă motivul în Clarificări. NU s-a trimis nimic.',
        '/ofertare');
    END IF;
  END IF;
  RETURN jsonb_build_object('actiune', CASE WHEN v_draft.id IS NOT NULL THEN 'actualizat' ELSE 'creat' END, 'id', v_id,
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'ilizibile', v_ilizibile, 'fara_date', v_fara_date, 'f3_m', v_f3, 'f3_nevalidate', v_f3_nev, 'f3_um_de_normalizat', v_f3_um);
END $function$;
REVOKE EXECUTE ON FUNCTION public.ofertare_clarificare_planse_auto(bigint) FROM PUBLIC, anon, authenticated;
