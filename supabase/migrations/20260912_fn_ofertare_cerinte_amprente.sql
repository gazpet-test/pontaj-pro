-- Singura definitie de amprenta din sistem. Folosita si cand se genereaza propunerea, si cand se
-- aplica: daca ar exista doua implementari (una in TypeScript, una in SQL) ar diverge garantat.
--
-- Amprenta e PE LINIE, nu pe tot registrul: pe licitatia 3 registrul activ are 927 de cerinte, iar o
-- amprenta globala ar fi fost invalidata de orice editare fara legatura (o re-extragere, marcarea unui
-- duplicat, o schimbare de stare facuta de un coleg) — adica refuzuri permanente pe propuneri de ~0,45 USD.
--
-- xmin, nu updated_at: ofertare_cerinte NU are trigger de updated_at, deci un UPDATE care nu trimite
-- explicit coloana lasa valoarea veche si schimbarea ar trece nedetectata. xmin se schimba la ORICE
-- UPDATE al randului. Efect secundar acceptat: un VACUUM FREEZE produce fals pozitiv („propunere
-- invechita"), adica fail-closed — se reia analiza, nu se scrie gresit.
--
-- „Activa" inseamna inlocuita_de IS NULL *si* duplicat_al IS NULL: fara al doilea filtru intra in
-- calcul si cele 210 cerinte marcate duplicat.
--
-- Probat 12.09 pe licitatie de test: un UPDATE care schimba doar `stare` (fara updated_at) a schimbat
-- amprenta, iar cerintele neatinse au ramas identice.
CREATE OR REPLACE FUNCTION public.fn_ofertare_cerinte_amprente(p_licitatie_id bigint, p_ids bigint[])
RETURNS TABLE (cerinta_id bigint, amprenta text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT c.id, md5(c.id::text || ':' || c.versiune::text || ':' || c.xmin::text)
  FROM public.ofertare_cerinte c
  WHERE c.licitatie_id = p_licitatie_id
    AND c.id = ANY (p_ids)
    AND c.inlocuita_de IS NULL
    AND c.duplicat_al IS NULL;
$fn$;
COMMENT ON FUNCTION public.fn_ofertare_cerinte_amprente(bigint, bigint[]) IS
  'Amprenta pe linie a cerintelor active dintr-o licitatie: md5(id:versiune:xmin). Se cheama la generarea propunerii si din nou, sub lock, la aplicare; o linie a carei amprenta difera nu se aplica niciodata.';
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinte_amprente(bigint, bigint[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinte_amprente(bigint, bigint[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_ofertare_cerinte_amprente(bigint, bigint[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_cerinte_amprente(bigint, bigint[]) TO service_role;
