-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK pentru docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql — NEAPLICAT, doar cu GO Razvan.
-- (R1, implicit) oprește regula din BD: scoate cele două trigger-e și funcțiile; PĂSTREAZĂ tabelul ofertare_cantitati_istoric
--     (valorile și aprobările vechi deja scrise rămân citibile; nimeni nu mai scrie în el). Rândurile din ofertare_cantitati NU se
--     ating: statusurile „diferenta” puse de trigger rămân (revalidarea e decizia omului — nu se „dezinvalidează” automat).
-- (R2, opțional) șterge și tabelul — DOAR dacă e gol; cu rânduri refuză (ar fi DROP ireversibil al istoricului, pct. 3 CLAUDE.md).
-- După R1, aplicația (aplicaRegulaAprobare în UI / transfer / CAD) aplică în continuare regula; rollback-ul de cod e separat.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- (R1)
DROP TRIGGER IF EXISTS trg_zz_ofertare_cantitati_aprobare ON public.ofertare_cantitati;
DROP TRIGGER IF EXISTS trg_zz_ofertare_cantitati_aprobare_del ON public.ofertare_cantitati;
DROP FUNCTION IF EXISTS public.fn_trg_ofertare_cantitati_aprobare();
DROP FUNCTION IF EXISTS public.ofertare_cantitati_atribute(text);
DROP FUNCTION IF EXISTS public.ofertare_fmt_ro(numeric);
-- runda 6: v_ofertare_cantitati_nevalidate și v6 folosesc ofertare_norm_text — se scoate doar dacă view-ul nu mai există (rollback-ul
-- view-ului întâi); altfel rămâne (funcție pură, fără drepturi pe date), ca view-ul și v6 să nu se strice
DO $$ BEGIN
  IF to_regclass('public.v_ofertare_cantitati_nevalidate') IS NULL THEN DROP FUNCTION IF EXISTS public.ofertare_norm_text(text); END IF;
END $$;
COMMENT ON TABLE public.ofertare_cantitati_istoric IS 'R5 (26.09.2026): istoricul aprobărilor din ofertare_cantitati — trigger-ul a fost scos (rollback R1); tabelul păstrat, doar citire.';

-- Runda 5: v_ofertare_cantitati_nevalidate (docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql) citește istoricul — înainte de R2,
-- rollback-ul view-ului se face ÎNTÂI (altfel DROP TABLE e refuzat de dependență, fără nicio pierdere). R1 singur NU strică view-ul
-- (runda 6: nici v6 — ofertare_norm_text rămâne cât există view-ul).
-- (R2) — opțional, separat, doar pe tabel gol:
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.ofertare_cantitati_istoric) THEN
--     RAISE EXCEPTION 'R5 rollback R2: ofertare_cantitati_istoric are % rânduri — NU se șterge (DROP ireversibil al istoricului); cere GO explicit și exportă întâi',
--       (SELECT count(*) FROM public.ofertare_cantitati_istoric);
--   END IF;
--   DROP TABLE public.ofertare_cantitati_istoric;
-- END $$;
