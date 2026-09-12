-- v_ofertare_pt_stare: regexul de capcane, largit — IDENTIC cu RX_CAPCANA din OfertarePropunere.jsx.
-- Daca cele doua diverg, bannerul spune un numar si lista arata altul.
--
-- Scaparea reparata: regexul cauta `respins`, dar cea mai frecventa formulare e "duce la
-- RESPINGEREA ofertei" — care NU se potriveste (respinger != respins). 4 cerinte reale scapau,
-- printre care "necriptarea pretului duce la respingerea ofertei ca inadmisibila".
--
-- Masurat pe 2127 cerinte INAINTE de a largi. Respinse ca zgomot:
--   `exclu(dere|s)` -> +22, aproape toate "responsabil EXCLUSIV"
--   `resping` gol   -> prinde "respingerea RECEPTIEI", alt subiect
--   `[iî]ntocmai`   -> +2, din care 1 deja prins
-- Pastrat: +4 castigate, toate reale, 0 pierdute. Dupa aplicare: 40 capcane (de la 36),
-- 73 de randuri in view pentru 73 de licitatii.
--
-- `se considera lipsa` si `indiferent de modul de prezentare` sunt verbatim din documentatia
-- Motru (a doua repetata acolo de 6 ori); 0 potriviri azi, documentele alea nu-s ingerate.

CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS
 WITH cer AS (
         SELECT c.id, c.licitatie_id, c.tip,
            c.text_cerinta ~* '(respins|resping[ăa-z]* (a |la )?(ofert|candidatur)|neconform|descalific|inacceptabil|sub sanc[tț]iune|f[aă]r[aă] (posibilitatea de a solicita )?clarific|nu se accept|se consider[aă] (ca )?lips[aă]|indiferent de modul de prezentare)'::text AS capcana,
            (EXISTS ( SELECT 1 FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])))) AS dovedita,
            (EXISTS ( SELECT 1 FROM ofertare_pt_legaturi l_1
                  WHERE l_1.cerinta_id = c.id AND l_1.fel = 'capitol'::text)) AS are_capitol,
            (EXISTS ( SELECT 1 FROM ofertare_pt_legaturi l_1
                  WHERE l_1.cerinta_id = c.id AND l_1.fel = 'exceptat'::text)) AS exceptata
           FROM ofertare_cerinte c
          WHERE (c.tip = ANY (ARRAY['propunere'::text, 'forma'::text])) AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
        )
 SELECT l.id AS licitatie_id,
    count(cer.id) AS de_raspuns,
    count(*) FILTER (WHERE cer.tip = 'forma'::text) AS de_forma,
    count(*) FILTER (WHERE cer.are_capitol) AS cu_capitol,
    count(*) FILTER (WHERE cer.exceptata AND NOT cer.are_capitol) AS exceptate,
    count(*) FILTER (WHERE cer.dovedita AND NOT cer.are_capitol AND NOT cer.exceptata) AS inchise_cu_dovada,
    count(*) FILTER (WHERE NOT cer.are_capitol AND NOT cer.exceptata AND NOT cer.dovedita) AS fara_capitol,
    count(*) FILTER (WHERE cer.capcana) AS capcane,
    count(*) FILTER (WHERE cer.capcana AND NOT cer.are_capitol AND NOT cer.exceptata) AS capcane_descoperite,
    ( SELECT count(*) FROM ofertare_pt_capitole k WHERE k.licitatie_id = l.id) AS capitole,
    ( SELECT count(*) FROM ofertare_pt_capitole k
          WHERE k.licitatie_id = l.id AND k.obligatoriu AND k.stare <> 'nu_se_aplica'::text
            AND COALESCE(btrim(k.continut), ''::text) = ''::text AND COALESCE(btrim(k.fisier_path), ''::text) = ''::text) AS capitole_goale,
    ( SELECT count(*) FROM ofertare_pt_capitole k
          WHERE k.licitatie_id = l.id AND k.continut ~* 'nu (este|e) cazul'::text) AS capitole_nu_e_cazul,
    ( SELECT count(*) FROM ofertare_documente_atribuire d WHERE d.licitatie_id = l.id) AS documente,
    ( SELECT count(*) FROM ofertare_documente_atribuire d
          WHERE d.licitatie_id = l.id AND (d.eroare IS NOT NULL OR (d.status_procesare = ANY (ARRAY['neprocesat'::text, 'partial'::text])))) AS documente_necitite,
    ( SELECT max(p.versiune) FROM ofertare_pt_poarta p WHERE p.licitatie_id = l.id) AS pt_versiune,
    ( SELECT p.verdict FROM ofertare_pt_poarta p WHERE p.licitatie_id = l.id ORDER BY p.versiune DESC LIMIT 1) AS pt_verdict,
    ( SELECT max(g.versiune) FROM grafic_versiuni g WHERE g.licitatie_id = l.id) AS grafic_versiune
   FROM ofertare_licitatii l
     LEFT JOIN cer ON cer.licitatie_id = l.id
  GROUP BY l.id;
