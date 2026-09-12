-- Ofertare: acoperirea mutata de un raspuns al autoritatii NU mai trece drept dovada,
-- iar scrierea in registru ramane la echipa de ofertare.
--
-- 1) v_ofertare_dashboard
--    Cand un raspuns al autoritatii schimba textul unei cerinte, RPC-ul de aplicare MUTA acoperirea
--    pe cerinta noua si o marcheaza reverificare_ceruta=true (omul trebuie sa se uite din nou, textul
--    s-a schimbat sub ea). Pana acum view-ul o numara ca dovada: o cerinta eliminatorie al carei text
--    s-a schimbat aparea „cu dovada" fara ca nimeni sa fi verificat noul text. Exact felul de eroare
--    care descalifica oferta. Acum acoperirea de reverificat nu mai tine loc de dovada si apare
--    separat, in coloana noua cerinte_de_reverificat.
--    Astazi efectul e zero (0 randuri marcate in BD) — se armeaza pentru prima aplicare reala.
--    In plus: security_invoker=on, cerut de advisor si de regula noastra pentru view-uri. Sigur azi —
--    toate tabelele citite au SELECT deschis oricarui autentificat (profiles: USING(true)).
--
-- 2) RLS pe cele trei tabele ale registrului
--    Politica veche era FOR ALL cu USING(auth.uid() IS NOT NULL): ORICE angajat logat putea sterge,
--    prin PostgREST, tot registrul de cerinte al unei licitatii. Se desparte in:
--      - SELECT: neschimbat (orice autentificat) — GraficPoarta.jsx citeste cerintele in afara modulului;
--      - INSERT/UPDATE/DELETE: doar fn_are_acces_ofertare() = is_owner sau user_module_access('ofertare').
--    Verificat inainte: singurii oameni care au scris vreodata in aceste tabele sunt Razvan (owner) si
--    Oana Nica (are modulul). Edge functions folosesc service_role si nu trec prin RLS.
--    ROLLBACK (daca blocheaza pe cineva): DROP cele 4 politici noi pe tabelul respectiv si
--      CREATE POLICY <tabel>_all ON public.<tabel> FOR ALL TO authenticated USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE VIEW public.v_ofertare_dashboard WITH (security_invoker = on) AS
 SELECT l.id,
    l.nr_anunt,
    l.autoritate,
    l.obiect,
    l.valoare_estimata,
    l.moneda,
    l.termen_depunere,
    l.status,
    l.decizie_go,
    l.nas_path,
    l.created_at,
    GREATEST(0::numeric, ceil(EXTRACT(epoch FROM l.termen_depunere - now()) / 86400.0))::integer AS zile_ramase,
    ( SELECT count(*) AS count
           FROM ofertare_documente_atribuire d
          WHERE d.licitatie_id = l.id) AS nr_documente,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL) AS nr_cerinte,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.tip = 'eliminatorie'::text) AS nr_eliminatorii,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.tip = 'eliminatorie'::text AND c.stare <> 'nu_se_aplica'::text AND NOT (EXISTS ( SELECT 1
                   FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND (a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])) AND NOT a.reverificare_ceruta))) AS eliminatorii_neacoperite,
    l.responsabil_id,
    p.name AS responsabil_nume,
    ( SELECT g.status
           FROM ofertare_garantii g
          WHERE g.licitatie_id = l.id AND g.status <> 'anulata'::text
          ORDER BY g.id DESC
         LIMIT 1) AS garantie_status,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.stare = 'nu_se_aplica'::text) AS cerinte_nu_se_aplica,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND c.stare = 'blocata'::text) AS cerinte_blocate,
    ( SELECT count(*) AS count
           FROM ofertare_cerinte c
          WHERE c.licitatie_id = l.id AND c.inlocuita_de IS NULL AND c.duplicat_al IS NULL AND (EXISTS ( SELECT 1
                   FROM ofertare_acoperire a
                  WHERE a.cerinta_id = c.id AND a.reverificare_ceruta))) AS cerinte_de_reverificat
   FROM ofertare_licitatii l
     LEFT JOIN profiles p ON p.id = l.responsabil_id;

DROP POLICY IF EXISTS ofertare_cerinte_all ON public.ofertare_cerinte;
CREATE POLICY ofertare_cerinte_select ON public.ofertare_cerinte FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_cerinte_insert ON public.ofertare_cerinte FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_cerinte_update ON public.ofertare_cerinte FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_cerinte_delete ON public.ofertare_cerinte FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_acoperire_all ON public.ofertare_acoperire;
CREATE POLICY ofertare_acoperire_select ON public.ofertare_acoperire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_acoperire_insert ON public.ofertare_acoperire FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_acoperire_update ON public.ofertare_acoperire FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_acoperire_delete ON public.ofertare_acoperire FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));

DROP POLICY IF EXISTS ofertare_documente_all ON public.ofertare_documente_atribuire;
CREATE POLICY ofertare_documente_select ON public.ofertare_documente_atribuire FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY ofertare_documente_insert ON public.ofertare_documente_atribuire FOR INSERT TO authenticated WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_update ON public.ofertare_documente_atribuire FOR UPDATE TO authenticated USING ((SELECT public.fn_are_acces_ofertare())) WITH CHECK ((SELECT public.fn_are_acces_ofertare()));
CREATE POLICY ofertare_documente_delete ON public.ofertare_documente_atribuire FOR DELETE TO authenticated USING ((SELECT public.fn_are_acces_ofertare()));
