-- v_ofertare_pt_stare: doua randuri noi de poarta, din sistemul de revizii.
--
-- `observatii_deschise` -> WARN, nu block. O observatie e un canal SOCIAL, nu un fapt: oricine
-- poate deschide una si nimeni nu-i obligat s-o inchida. Un block pe ea inseamna ca orice coleg
-- poate opri o depunere cu o propozitie — iar la termen de SEAP asta nu produce o propunere mai
-- buna, produce un om care marcheaza observatia "respinsa" ca sa treaca poarta. De acolo
-- semaforul e mort. Celelalte 5 randuri blocante sunt fapte verificabile mecanic; asta nu e.
--
-- `capitole_nescrise_de_om` -> BLOCK. Aici e invers: e un fapt binar, nu o interpretare.
-- sursa <> 'om' inseamna literalmente ca nimeni n-a atins textul dupa generare, iar un capitol
-- de propunere tehnica generat si necitit e fix riscul pe care poarta exista sa-l prinda.
-- Blocajul se ridica printr-o actiune CORECTA si ieftina: omul deschide capitolul, il citeste,
-- il salveaza -> UI-ul pune sursa='om' (vezi salveazaCapitol din OfertarePropunere.jsx) si
-- versiunea creste. Cand costul de a face lucrul corect e mai mic decat costul de a ocoli,
-- block-ul e sigur.
--
-- Ambele randuri sunt 0/73 azi (ofertare_pt_capitole e goala). Deci NU sunt calibrate pe date —
-- sunt argumentate din design. La primele 2-3 licitatii reale se recitesc cifrele.

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
    ( SELECT max(g.versiune) FROM grafic_versiuni g WHERE g.licitatie_id = l.id) AS grafic_versiune,
    -- Observatii deschise = cereri de modificare pe care nu le-a inchis nimeni.
    ( SELECT count(*) FROM ofertare_pt_observatii o
          WHERE o.licitatie_id = l.id AND o.stare = 'deschisa'::text) AS observatii_deschise,
    -- Capitole obligatorii cu text pe care nu l-a citit niciun om (sursa <> 'om').
    -- COALESCE(k.sursa,'om'): defaultul coloanei e 'om', dar un import ar putea lasa NULL, iar
    -- fara COALESCE orice rand vechi ar aparea brusc "nescris de om".
    -- `continut <> ''` intentionat: capitolele goale au randul lor (capitole_goale); altfel
    -- acelasi capitol ar fi numarat de doua ori si omul certat de doua ori pentru un lucru.
    -- Predicatul obligatoriu/nu_se_aplica e copiat VERBATIM din capitole_goale, ca cele doua
    -- randuri sa imparta curat aceeasi multime.
    ( SELECT count(*) FROM ofertare_pt_capitole k
          WHERE k.licitatie_id = l.id AND k.obligatoriu AND k.stare <> 'nu_se_aplica'::text
            AND COALESCE(btrim(k.continut), ''::text) <> ''::text
            AND COALESCE(k.sursa, 'om'::text) <> 'om'::text) AS capitole_nescrise_de_om
   FROM ofertare_licitatii l
     LEFT JOIN cer ON cer.licitatie_id = l.id
  GROUP BY l.id;
