-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261018b_hr_decizii_temei_deseuri_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/).
-- Readuce art1_firma la RESPONSABIL_DESEURI la textul din PR1 (fără „conform art. 23 din OUG 92/2021”).
-- Deciziile deja emise NU se schimbă: textul lor e înghețat în continut. Fără GO de execuție: doar la cererea lui Răzvan.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN ISOLATION LEVEL READ COMMITTED;
--   SELECT set_config('gazpet.revenire_20261018b', 'TEMEI_DESEURI:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $arm$
BEGIN
  IF current_setting('gazpet.revenire_20261018b', true) IS DISTINCT FROM 'TEMEI_DESEURI:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261018b: nearmată (gazpet.revenire_20261018b legat de txid_current) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'Revenire 20261018b: rulează ca postgres'; END IF;
  IF (SELECT art1_firma FROM public.hr_decizii_tipuri WHERE cod = 'RESPONSABIL_DESEURI' FOR UPDATE)
     IS DISTINCT FROM 'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 23 din OUG 92/2021' THEN
    RAISE EXCEPTION 'Revenire 20261018b: textul nu e exact cel lăsat de 20261018b — o modificare ulterioară s-ar pierde; refuz';
  END IF;
  UPDATE public.hr_decizii_tipuri
     SET art1_firma = 'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}.'
   WHERE cod = 'RESPONSABIL_DESEURI';
  IF (SELECT md5(art1_firma) FROM public.hr_decizii_tipuri WHERE cod = 'RESPONSABIL_DESEURI') IS DISTINCT FROM 'e232a2bcf079994a340c81ae3ffec6e6' THEN
    RAISE EXCEPTION 'Revenire 20261018b: postcondiție — textul PR1 nu s-a refăcut exact';
  END IF;
END
$arm$;
