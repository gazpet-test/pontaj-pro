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
COMMENT ON TABLE public.ofertare_cantitati_istoric IS 'R5 (26.09.2026): istoricul aprobărilor din ofertare_cantitati — trigger-ul a fost scos (rollback R1); tabelul păstrat, doar citire.';

-- (R2) — opțional, separat, doar pe tabel gol:
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.ofertare_cantitati_istoric) THEN
--     RAISE EXCEPTION 'R5 rollback R2: ofertare_cantitati_istoric are % rânduri — NU se șterge (DROP ireversibil al istoricului); cere GO explicit și exportă întâi',
--       (SELECT count(*) FROM public.ofertare_cantitati_istoric);
--   END IF;
--   DROP TABLE public.ofertare_cantitati_istoric;
-- END $$;
