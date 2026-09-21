-- Gaura semnalată pe 21.09.2026: `ales_de` protejează INTENȚIA omului, nu CORECTITUDINEA ei.
--
-- Poarta pusă azi-dimineață face ca rerularea motorului să nu atingă o cerință pe care un coleg
-- a ales deja ceva. Bine — nu-i mai pierdem munca. Dar dacă autorizația aleasă expiră între
-- timp, înainte de termenul de depunere, motorul NU mai are voie s-o corecteze, iar ecranul
-- arată verde o acoperire care nu mai ține. Poarta a transformat o alegere bună într-una
-- înghețată. E un risc introdus chiar de reparația de dimineață.
--
-- Reparația respectă amândouă lucrurile: rândul ales NU se schimbă (rămâne al omului), dar i se
-- recalculează `valabil_la_depunere` și i se cere reverificare, cu motivul scris pe față.
-- Omul vede că trebuie să revină; nimeni nu i-a luat alegerea din mână.
--
-- Verificat pe producție: cu autorizația 216 (expiră 10.10.2026) aleasă pe o cerință a
-- licitației 15 (termen 12.10.2026), funcția întoarce cerința, pune valabil_la_depunere=false
-- și reverificare_ceruta=true, iar `ales` și `ales_de` rămân neatinse. Pe cele 5 alegeri reale,
-- toate cu documente valabile până în 2027, nu declanșează — fără alarme false.

CREATE OR REPLACE FUNCTION public.fn_ofertare_acoperire_reverifica_alese(p_cerinte bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expirate bigint[] := '{}';
BEGIN
  IF p_cerinte IS NULL OR array_length(p_cerinte, 1) IS NULL THEN
    RETURN jsonb_build_object('reverificate', '[]'::jsonb);
  END IF;

  WITH termen AS (
    SELECT c.id AS cerinta_id, l.termen_depunere::date AS td
      FROM ofertare_cerinte c JOIN ofertare_licitatii l ON l.id = c.licitatie_id
     WHERE c.id = ANY(p_cerinte)
  ), expirate AS (
    SELECT a.id, a.cerinta_id
      FROM ofertare_acoperire a
      JOIN termen t ON t.cerinta_id = a.cerinta_id
      LEFT JOIN hr_autorizatii au ON au.id = a.autorizatie_id
      LEFT JOIN documente_firma df ON df.id = a.doc_firma_id
     WHERE a.ales_de IS NOT NULL
       AND t.td IS NOT NULL
       AND NOT a.reverificare_ceruta
       AND (
         (au.id IS NOT NULL AND au.data_expirare IS NOT NULL AND au.data_expirare < t.td)
         OR (df.id IS NOT NULL AND NOT coalesce(df.fara_expirare, false)
             AND df.data_valabilitate IS NOT NULL AND df.data_valabilitate < t.td)
       )
  ), marcate AS (
    UPDATE ofertare_acoperire a
       SET valabil_la_depunere = false,
           reverificare_ceruta = true,
           reverificare_motiv = 'Dovada aleasă a expirat înainte de termenul de depunere — motorul nu poate corecta o alegere umană, dar te anunță. Alege altă variantă sau reînnoiește documentul.',
           updated_at = now()
      FROM expirate e
     WHERE a.id = e.id
    RETURNING a.cerinta_id
  )
  SELECT coalesce(array_agg(DISTINCT cerinta_id ORDER BY cerinta_id), '{}') INTO v_expirate FROM marcate;

  RETURN jsonb_build_object('reverificate', to_jsonb(v_expirate));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_ofertare_acoperire_reverifica_alese(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_acoperire_reverifica_alese(bigint[]) TO authenticated, service_role;
