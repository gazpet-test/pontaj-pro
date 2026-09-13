-- H2 (Hoghilag, Jakarinos 13.09): CONSERVAREA CANTITATILOR. Aceeasi cantitate trebuie sa fie
-- aceeasi in toate reprezentarile. La Hoghilag: 372 bransamente in obiectiv, 371 in tabelul
-- echipelor — si compensarea intre localitati (-19 Prod / +18 Valchid) NU e reconciliere.
-- Prima pereche pe care o avem in ERP: metrii de retea din ofertare_cantitati (memoriu sau
-- plansa, dupa baza asumata in grafic_parametri.cantitati_asumate) vs suma fronturilor din
-- grafic_parametri.fronturi (ce intra in grafic). Totalul e doar primul control; defalcarea
-- pe obiect ramane in panou, fiindca fronturile au nume libere si nu se mapeaza automat (H9).

CREATE OR REPLACE VIEW public.v_ofertare_pt_stare WITH (security_invoker = on) AS
 WITH cer AS (
         SELECT c.id, c.licitatie_id, c.tip,
            c.text_cerinta ~* '(respins|resping[ăa-z]* (a |la )?(ofert|candidatur)|neconform|descalific|inacceptabil|sub sanc[tț]iune|f[aă]r[aă] (posibilitatea de a solicita )?clarific|nu se accept|se consider[aă] (ca )?lips[aă]|indiferent de modul de prezentare)'::text AS capcana,
            (EXISTS ( SELECT 1 FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])))) AS dovedita,
            (EXISTS ( SELECT 1 FROM ofertare_pt_legaturi l_1
                  WHERE l_1.cerinta_id = c.id AND l_1.fel = 'capitol'::text)) AS are_capitol,
            (EXISTS ( SELECT 1 FROM ofertare_pt_legaturi l_1
                  WHERE l_1.cerinta_id = c.id AND l_1.fel = 'exceptat'::text)) AS exceptata,
            (EXISTS ( SELECT 1 FROM ofertare_pt_legaturi l_1 JOIN ofertare_pt_capitole k ON k.id = l_1.capitol_id
                  WHERE l_1.cerinta_id = c.id AND l_1.fel = 'capitol'::text
                    AND l_1.stare = 'verificata'::text
                    AND l_1.verificat_la_versiunea = k.versiune)) AS verificata
           FROM ofertare_cerinte c
          WHERE (c.tip = ANY (ARRAY['propunere'::text, 'forma'::text])) AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL
        ),
      gp AS (
         SELECT p.licitatie_id,
                p.parametri->>'cantitati_asumate' AS baza,
                ( SELECT round(sum(nullif(f->>'lungime_m','')::numeric)) FROM jsonb_array_elements(coalesce(p.parametri->'fronturi','[]'::jsonb)) f) AS fronturi_m
           FROM grafic_parametri p
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
          WHERE d.licitatie_id = l.id
            AND ((d.eroare IS NOT NULL AND d.status_procesare <> 'procesat'::text)
                 OR (d.status_procesare = ANY (ARRAY['neprocesat'::text, 'partial'::text])))) AS documente_necitite,
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
            AND COALESCE(k.sursa, 'om'::text) <> 'om'::text) AS capitole_nescrise_de_om,
    -- Avertismentele din poarta ULTIMEI versiuni de grafic. `poarta` e array-ul
    -- [{k,titlu,stare,detalii}] scris de GraficPoarta.jsx la inghetare.
    COALESCE(( SELECT count(*) FROM grafic_versiuni g,
                 LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g.poarta) = 'array' THEN g.poarta ELSE '[]'::jsonb END) e
                WHERE g.licitatie_id = l.id
                  AND g.versiune = ( SELECT max(g2.versiune) FROM grafic_versiuni g2 WHERE g2.licitatie_id = l.id)
                  AND e->>'stare' <> 'ok'), 0) AS grafic_avertismente,
    ( SELECT count(*) FROM v_ofertare_pt_conformitate f WHERE f.licitatie_id = l.id) AS afirmatii,
    ( SELECT count(*) FROM v_ofertare_pt_conformitate f WHERE f.licitatie_id = l.id AND f.verdict = 'block'::text) AS afirmatii_blocante,
    ( SELECT count(*) FROM v_ofertare_pt_conformitate f WHERE f.licitatie_id = l.id AND f.verdict = 'warn'::text) AS afirmatii_de_verificat,
    count(*) FILTER (WHERE cer.are_capitol AND NOT cer.verificata) AS cerinte_neverificate,
    -- H2: metrii de retea din cantitati, pe baza asumata (memoriu = cantitate, plansa = cantitate_plansa)
    ( SELECT max(g.baza) FROM gp g WHERE g.licitatie_id = l.id) AS cantitati_baza,
    ( SELECT round(sum(CASE WHEN (SELECT max(g.baza) FROM gp g WHERE g.licitatie_id = l.id) = 'plansa' THEN q.cantitate_plansa ELSE q.cantitate END))
        FROM ofertare_cantitati q
       WHERE q.licitatie_id = l.id AND q.um = 'm' AND q.categorie ~* 'conduct|re[țt]ea' AND coalesce(q.obiect,'') !~* 'total') AS cantitati_retea_m,
    ( SELECT max(g.fronturi_m) FROM gp g WHERE g.licitatie_id = l.id) AS grafic_fronturi_m
   FROM ofertare_licitatii l
     LEFT JOIN cer ON cer.licitatie_id = l.id
  GROUP BY l.id;
