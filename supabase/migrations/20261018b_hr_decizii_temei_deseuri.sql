-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 20261018b — temeiul la „Responsabil gestionarea deseurilor” pe firmă (varianta A, Răzvan 07.10.2026)
--
-- Reverificarea textelor de firmă pe modelele NAS (Delgaz 13.01.2026: 6, 7, 15, 16, 19/2026; 227/2026 pe proiect):
--   singura diferență de fond e la RESPONSABIL_DESEURI pe firmă — modelul 7/13.01.2026 se încheie cu
--   „…incepand cu data de 13.01.2026, conform art. 23 din OUG 92/82021” (OUG 92/2021; „82021” e greșeală de tipar
--   în model). Seed-ul PR1 se oprea la dată. Fără punct final, ca în model (la fel ca MEDIU pe firmă, modelul 6/2026).
-- Ce face: UPDATE pe un singur rând de configurare (hr_decizii_tipuri.art1_firma, cod RESPONSABIL_DESEURI), doar dacă
--   textul e exact cel lăsat de PR1 (md5 e232a2bc…). Nimic altceva: fără date reale (0 decizii emise la 07.10),
--   fără funcții (gate 0e = 0), fără drepturi.
-- LIVRARE: doar prin scripts/livrare_migrare.sh (garda gazpet.livrare_migrare legată de txid), fără BEGIN/COMMIT.
-- Revenire: supabase/revenire/20261018b_hr_decizii_temei_deseuri_ROLLBACK.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261018b_hr_decizii_temei_deseuri:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261018b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END
$livrare_start$;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție 0a: rulează ca postgres (current_user = %)', current_user;
  END IF;
  IF (SELECT md5(art1_firma) FROM public.hr_decizii_tipuri WHERE cod = 'RESPONSABIL_DESEURI') IS DISTINCT FROM 'e232a2bcf079994a340c81ae3ffec6e6' THEN
    RAISE EXCEPTION 'Precondiție 0b: art1_firma pentru RESPONSABIL_DESEURI nu e textul lăsat de PR1 (reaplicare sau modificare ulterioară)';
  END IF;
END
$pre$;

-- UPDATE legat atomic de starea PR1 (P10-4): condiția md5 e chiar în WHERE, iar exact un rând trebuie atins.
DO $upd$
DECLARE n int;
BEGIN
  UPDATE public.hr_decizii_tipuri
     SET art1_firma = 'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 23 din OUG 92/2021'
   WHERE cod = 'RESPONSABIL_DESEURI' AND md5(art1_firma) = 'e232a2bcf079994a340c81ae3ffec6e6';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'UPDATE: % rânduri atinse (așteptat 1) — textul s-a schimbat între precondiție și scriere', n; END IF;
END
$upd$;

DO $post$
BEGIN
  IF (SELECT art1_firma FROM public.hr_decizii_tipuri WHERE cod = 'RESPONSABIL_DESEURI')
     IS DISTINCT FROM 'Numirea in functia de {functie} {pe_titlu} {nume} incepand cu data de {data_efect}, conform art. 23 din OUG 92/2021' THEN
    RAISE EXCEPTION 'Postcondiție: textul nou nu e cel așteptat';
  END IF;
  IF (SELECT count(*) FROM public.hr_decizii_tipuri) <> 15 THEN RAISE EXCEPTION 'Postcondiție: numărul de tipuri s-a schimbat'; END IF;
END
$post$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261018b_hr_decizii_temei_deseuri:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261018b: garda de livrare (final)';
  END IF;
END
$livrare_final$;
