-- Conformitate propunere tehnică: cumul de funcții.
-- (1) doua_roluri devine 'block' când licitația are o cerință care interzice explicit cumulul
--     (ex. „O persoană nu poate îndeplini în mod cumulativ mai multe funcții") — coloană nouă interzice_cumul, la coadă.
-- (2) doua_roluri acoperă și externii: aceeași persoană externă (hr_autorizatii.extern_id) cu roluri diferite.
CREATE OR REPLACE VIEW public.v_ofertare_pt_conformitate WITH (security_invoker = on) AS
 WITH baza AS (
         SELECT a.id,
            a.licitatie_id,
            a.fel,
            a.text_brut,
            a.rol_propus,
            a.pagina,
            a.employee_id,
            a.exceptat,
            a.exceptat_motiv,
            a.tip_cerut_cod,
            a.autorizatie_id,
            a.disponibilitate_id,
            e.name AS nume_in_erp,
            e.functie AS functie_in_erp,
            l.termen_depunere::date AS la_data,
            a.fel = 'persoana'::text AND a.employee_id IS NULL AND a.autorizatie_id IS NOT NULL AS extern,
            a.fel = 'persoana'::text AND e.id IS NOT NULL AND (e.termination_date IS NOT NULL AND e.termination_date < COALESCE(l.termen_depunere::date, CURRENT_DATE) OR e.termination_date IS NULL AND NOT e.active) AS om_plecat,
            a.fel = 'persoana'::text AND a.employee_id IS NULL AND a.autorizatie_id IS NULL AS om_negasit,
            ( SELECT count(*) AS count
                   FROM hr_autorizatii h
                  WHERE h.employee_id = e.id AND h.deleted_at IS NULL AND NOT h.fara_expirare AND h.data_expirare < COALESCE(l.termen_depunere::date, CURRENT_DATE)) AS autorizatii_expirate,
            a.fel = 'persoana'::text AND a.employee_id IS NULL AND a.autorizatie_id IS NOT NULL AND a.disponibilitate_id IS NULL AS extern_fara_disponibilitate,
            a.autorizatie_id IS NOT NULL AND (EXISTS ( SELECT 1
                   FROM hr_autorizatii h
                  WHERE h.id = a.autorizatie_id AND h.deleted_at IS NULL AND NOT h.fara_expirare AND h.data_expirare < COALESCE(l.termen_depunere::date, CURRENT_DATE))) AS autorizatie_extern_expirata,
            a.fel = 'persoana'::text AND a.employee_id IS NOT NULL AND a.tip_cerut_cod IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM hr_autorizatii h
                     JOIN hr_autorizatii_tipuri tt ON tt.id = h.tip_id
                  WHERE h.employee_id = e.id AND h.deleted_at IS NULL AND tt.cod = a.tip_cerut_cod AND (h.fara_expirare OR h.data_expirare >= COALESCE(l.termen_depunere::date, CURRENT_DATE)))) AS calificare_lipsa,
            -- aceeași persoană (angajat SAU extern, identificat prin extern_id-ul autorizației) cu alt rol în aceeași licitație
            a.fel = 'persoana'::text AND (a.employee_id IS NOT NULL OR ha.extern_id IS NOT NULL) AND (EXISTS ( SELECT 1
                   FROM ofertare_pt_afirmatii b_1
                     LEFT JOIN hr_autorizatii hb ON hb.id = b_1.autorizatie_id
                  WHERE b_1.licitatie_id = a.licitatie_id AND b_1.fel = 'persoana'::text AND b_1.id <> a.id
                    AND ((a.employee_id IS NOT NULL AND b_1.employee_id = a.employee_id)
                      OR (ha.extern_id IS NOT NULL AND hb.extern_id = ha.extern_id))
                    AND COALESCE(b_1.rol_propus, ''::text) <> COALESCE(a.rol_propus, ''::text))) AS doua_roluri,
            -- licitația are o cerință scrisă care interzice cumulul de funcții
            (EXISTS ( SELECT 1
                   FROM ofertare_cerinte c
                  WHERE c.licitatie_id = a.licitatie_id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
                    AND c.text_cerinta ~* '(cumul\w*\s+(de\s+)?(mai\s+multe\s+)?(func[tț]i|rol|post|pozi[tț]i)|(func[tț]i|rol|post)\w*[^.]{0,40}cumul|nu poate (îndeplini|indeplini)|(o|aceea[sș]i) persoan[aă] nu poate|nu se (admite|accept[aă]) cumul)')) AS interzice_cumul
           FROM ofertare_pt_afirmatii a
             JOIN ofertare_licitatii l ON l.id = a.licitatie_id
             LEFT JOIN employees e ON e.id = a.employee_id
             LEFT JOIN hr_autorizatii ha ON ha.id = a.autorizatie_id
        )
 SELECT id, licitatie_id, fel, text_brut, rol_propus, pagina, employee_id, exceptat, exceptat_motiv,
    tip_cerut_cod, autorizatie_id, disponibilitate_id, nume_in_erp, functie_in_erp, la_data, extern,
    om_plecat, om_negasit, autorizatii_expirate, extern_fara_disponibilitate, autorizatie_extern_expirata,
    calificare_lipsa, doua_roluri,
        CASE
            WHEN exceptat THEN 'exceptat'::text
            WHEN om_negasit THEN 'block'::text
            WHEN om_plecat THEN 'block'::text
            WHEN doua_roluri AND interzice_cumul THEN 'block'::text
            WHEN extern_fara_disponibilitate THEN 'warn'::text
            WHEN autorizatie_extern_expirata THEN 'warn'::text
            WHEN calificare_lipsa THEN 'warn'::text
            WHEN autorizatii_expirate > 0 THEN 'warn'::text
            WHEN doua_roluri THEN 'warn'::text
            WHEN (fel = ANY (ARRAY['utilaj'::text, 'partener'::text])) AND employee_id IS NULL THEN 'warn'::text
            ELSE 'ok'::text
        END AS verdict,
    interzice_cumul
   FROM baza b;
