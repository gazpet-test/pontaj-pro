-- Doua goluri gasite la turul prin Ofertare din 15.09.2026: platforma STIE, dar nu SPUNE.
--  (1) Licitatii cu termen aproape si FARA RESPONSABIL. Pe SCN1179522 (Potlogi) documentatia era
--      citita, registrul generat (421 cerinte, 87 eliminatorii neacoperite) — si nimeni alocat,
--      la 6 zile de depunere. Nici in lucru, nici inchisa. Fara responsabil nu se poate porni
--      citirea integrala / registrul / acoperirea (poarta pe cheltuiala), deci nu avanseaza.
--  (2) Arhive pe care platforma NU le poate desface (.rar, .7z, volume .partN / .z01). Nota
--      „urca-l manual" statea doar in randul documentului, unde o vede doar cine se uita acolo.
--      Pe SCN1179589 (Simian) PT_Supratraversari.rar zacea de o zi, pe o licitatie fara responsabil.
--
-- BUG REPARAT DIN DRUM: ofertare_alerte_amprenta avea PRIMARY KEY doar pe licitatie_id, desi are
-- coloana `fel`. Cu o singura alerta mergea; la a doua, amprentele s-ar fi suprascris reciproc si
-- alertele ar fi plecat in bucla. Cheia devine (licitatie_id, fel), iar ofertare_alerta_pagini_goale
-- se aliniaza la ON CONFLICT (licitatie_id, fel) — altfel crapa la prima rulare de dupa migrare.
--
-- Cron: SELECT cron.schedule('ofertare_alerte_atentie_0630', '30 6 * * *',
--                            'SELECT public.ofertare_alerte_atentie();');

ALTER TABLE public.ofertare_alerte_amprenta DROP CONSTRAINT IF EXISTS ofertare_alerte_amprenta_pkey;
ALTER TABLE public.ofertare_alerte_amprenta ADD PRIMARY KEY (licitatie_id, fel);

CREATE OR REPLACE FUNCTION public.ofertare_alerte_atentie(p_zile int DEFAULT 14)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  l record; v_pid uuid; v_amprenta text; v_veche text; v_trimise int := 0;
  v_zile int; v_lista text; v_nr int;
BEGIN
  FOR l IN
    SELECT id, nr_anunt, obiect, termen_depunere, responsabil_id, created_by
    FROM ofertare_licitatii
    WHERE termen_depunere > now()
      AND status IN ('in_lucru','go','identificata')
  LOOP
    v_zile := (l.termen_depunere::date - CURRENT_DATE);

    -- (1) fara responsabil, cu termenul in fata
    IF l.responsabil_id IS NULL AND v_zile <= p_zile THEN
      -- amprenta pe numarul de zile: revine daca situatia se inrautateste (mai putine zile),
      -- nu in fiecare dimineata cu acelasi text
      v_amprenta := md5(l.id::text || '|fara_resp|' || v_zile::text);
      SELECT amprenta INTO v_veche FROM ofertare_alerte_amprenta
       WHERE licitatie_id = l.id AND fel = 'fara_responsabil';
      IF v_veche IS DISTINCT FROM v_amprenta THEN
        FOR v_pid IN
          SELECT DISTINCT p FROM unnest(ARRAY[l.created_by]) p WHERE p IS NOT NULL
          UNION SELECT id FROM profiles WHERE is_owner = true
        LOOP
          INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
          VALUES (v_pid, 'warning', 'Ofertare',
            format('Fara responsabil, %s zile pana la depunere: %s', v_zile, coalesce(l.nr_anunt, 'licitatia ' || l.id)),
            format('„%s" nu are responsabil alocat si se depune peste %s zile. Fara responsabil nu se poate porni citirea integrala, registrul sau acoperirea (poarta pe cheltuiala) — deci licitatia nu avanseaza. Alege un responsabil in fisa licitatiei sau inchide-o daca nu o mai facem.',
                   left(coalesce(l.obiect, ''), 90), v_zile),
            '/ofertare');
          v_trimise := v_trimise + 1;
        END LOOP;
        INSERT INTO ofertare_alerte_amprenta (licitatie_id, fel, amprenta, trimisa_la)
        VALUES (l.id, 'fara_responsabil', v_amprenta, now())
        ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now();
      END IF;
    END IF;

    -- (2) arhive pe care nu le putem desface, ramase neincarcate
    SELECT count(*), string_agg(left(nume_original, 50), '; ' ORDER BY nume_original)
      INTO v_nr, v_lista
    FROM ofertare_documente_atribuire d
    WHERE d.licitatie_id = l.id
      AND d.nume_original ~* '\.(rar|7z|z[0-9]{2}|part[0-9]+\.rar)$'
      AND (d.fisier_path IS NULL OR d.fisier_path LIKE '%/neincarcat/%');

    IF coalesce(v_nr, 0) > 0 THEN
      v_amprenta := md5(l.id::text || '|arhive|' || coalesce(v_lista, ''));
      SELECT amprenta INTO v_veche FROM ofertare_alerte_amprenta
       WHERE licitatie_id = l.id AND fel = 'arhiva_nedesfacuta';
      IF v_veche IS DISTINCT FROM v_amprenta THEN
        FOR v_pid IN
          SELECT DISTINCT p FROM unnest(ARRAY[l.responsabil_id, l.created_by]) p WHERE p IS NOT NULL
          UNION SELECT id FROM profiles WHERE is_owner = true
        LOOP
          INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
          VALUES (v_pid, 'warning', 'Ofertare',
            format('%s arhiva(e) de urcat manual: %s', v_nr, coalesce(l.nr_anunt, 'licitatia ' || l.id)),
            format('Pe „%s" au aparut in SEAP arhive pe care platforma nu le poate desface: %s. Dezarhiveaza-le pe calculator si trage folderul in „Urca folder" — altfel continutul lor NU intra in analiza. Termen: %s zile.',
                   left(coalesce(l.obiect, ''), 70), left(coalesce(v_lista, ''), 300), v_zile),
            '/ofertare');
          v_trimise := v_trimise + 1;
        END LOOP;
        INSERT INTO ofertare_alerte_amprenta (licitatie_id, fel, amprenta, trimisa_la)
        VALUES (l.id, 'arhiva_nedesfacuta', v_amprenta, now())
        ON CONFLICT (licitatie_id, fel) DO UPDATE SET amprenta = EXCLUDED.amprenta, trimisa_la = now();
      END IF;
    END IF;
  END LOOP;
  RETURN v_trimise;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ofertare_alerte_atentie(int) FROM PUBLIC;

COMMENT ON FUNCTION public.ofertare_alerte_atentie(int) IS
  'Alerte zilnice Ofertare: licitatii fara responsabil cu termenul aproape + arhive .rar/.7z care nu se pot desface. Anti-spam prin ofertare_alerte_amprenta.';

-- NOTA: ofertare_alerta_pagini_goale a fost si ea redefinita, identic cu varianta anterioara,
-- doar cu ON CONFLICT (licitatie_id, fel) in loc de ON CONFLICT (licitatie_id).
