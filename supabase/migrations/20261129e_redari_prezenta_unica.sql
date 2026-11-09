-- Version 20261129120400. Runner supplies one transaction; no business data changes.
-- Redari felia 5 (Copilot r1 P2-02): o singura prezenta la sesiune per detinator si zi calendaristica (Bucuresti),
-- ca doua tablete sa nu poata inregistra de doua ori aceeasi prezenta. Doar canal 'sesiune' + optiune 'particip'.
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' OR current_setting('gazpet.livrare_migrare',true) IS DISTINCT FROM '20261129e_redari_prezenta_unica:' || txid_current() THEN
    RAISE EXCEPTION '20261129e: garda start invalida';
  END IF;
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.red_raspunsuri IN SHARE MODE;
  IF to_regclass('public.red_raspunsuri_prezenta_uq') IS NOT NULL THEN RAISE EXCEPTION '20261129e: indexul exista'; END IF;
  IF EXISTS (SELECT 1 FROM public.red_raspunsuri WHERE canal='sesiune' AND optiune='particip'
    GROUP BY detinator_id, ((data AT TIME ZONE 'Europe/Bucharest')::date) HAVING count(*) > 1) THEN
    RAISE EXCEPTION '20261129e: exista deja prezente duble; se curata intai (cu acordul owner-ului)';
  END IF;
  PERFORM set_config('gazpet.r29e_policies',(SELECT md5(coalesce(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename='red_raspunsuri'),true);
END $pre$;

CREATE UNIQUE INDEX red_raspunsuri_prezenta_uq ON public.red_raspunsuri
  (detinator_id, ((data AT TIME ZONE 'Europe/Bucharest')::date))
  WHERE canal = 'sesiune' AND optiune = 'particip';
COMMENT ON INDEX public.red_raspunsuri_prezenta_uq IS 'Redari: o prezenta la sesiune (canal sesiune, particip) per detinator si zi Bucuresti; a doua tableta primeste 23505.';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='red_raspunsuri_prezenta_uq'
    AND i.indrelid='public.red_raspunsuri'::regclass AND i.indisunique AND i.indisvalid) THEN RAISE EXCEPTION '20261129e: index lipsa/invalid'; END IF;
  IF (SELECT md5(coalesce(string_agg(policyname || '|' || permissive || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,''), E'\n' ORDER BY policyname),'')) FROM pg_policies WHERE schemaname='public' AND tablename='red_raspunsuri')
    IS DISTINCT FROM current_setting('gazpet.r29e_policies',true) THEN RAISE EXCEPTION '20261129e: politici schimbate'; END IF;
END $post$;
