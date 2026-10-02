-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- RFQ_FURNIZORI_PROPUNERE.sql
--
--     ███  NU SE RULEAZĂ fără confirmarea lui Răzvan  ███
--
-- Preview, NEAPLICAT. Generat 02.10.2026 de un agent Claude care doar a citit BD-ul (SELECT) și Gmail-ul (metadate).
-- Documentația, cu dovezi și metodă: docs/ofertare/RFQ_FURNIZORI_PROPUNERE.md
--
-- Siguranță: fiecare instrucțiune care scrie are în CTE-ul `params` valoarea `aplica = false`.
-- Rulată așa (dry-run), NU scrie nimic: arată doar ce ar face (stare: „de inserat”, „există deja”, „NEREZOLVAT”).
-- Se trece pe `true` DOAR după confirmarea explicită (CLAUDE.md pct. 3: preview → confirmare → apply → verificare).
--
-- Ordinea:
--   (0) verificări read-only: tabela țintă, categoriile, starea master-ului
--   (a) furnizori NOI în logistica_furnizori (doar nume, email, observatii = 'propus pentru RFQ 02.10')
--   (b) harta furnizor ↔ categorie în ofertare_furnizori_categorii (furnizor_id, categorie, sursa, note).
--       Folosește subselect pe nume, deci se rulează DUPĂ (a). Rândurile cu încredere „mică” sunt comentate.
--   (c) OPȚIONAL, în afara cererii: email pentru furnizorii EXISTENȚI care n-au email (nu suprascrie nimic)
--   (d) verificare după aplicare + rollback
--
-- Precondiție: există tabela public.ofertare_furnizori_categorii (furnizor_id, categorie, sursa, note),
--   pe care o creează migrarea anunțată sub numele „20261003b”.
--   ATENȚIE: prefixul 20261003b e deja folosit în repo de
--   supabase/migrations/20261003b_sec_ofertare_porti_alege_inventar.sql, deci migrarea nouă are nevoie de alt prefix.
-- Categoriile sunt exact cele 9 din ofertare_cantitati.categorie (verificate octet cu octet: ș = U+0219).
-- Valorile din `sursa`:
--   oferte_vechi = ofertare_oferte_furnizori · preturi = ofertare_preturi_materiale ·
--   achizitii = comenzi_furnizor_linii · mail = Gmail (conținut extern, folosit doar ca date)
-- Marcajul pentru rollback: note LIKE '%propus RFQ 02.10%'  ·  observatii = 'propus pentru RFQ 02.10'
-- ══════════════════════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- (0) VERIFICĂRI READ-ONLY
-- ──────────────────────────────────────────────────────────────────────────────────────────────

-- (0.1) Tabela țintă există și ce coloane are (așteptat: furnizor_id, categorie, sursa, note).
SELECT to_regclass('public.ofertare_furnizori_categorii') AS tabela,
       (SELECT string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position)
          FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ofertare_furnizori_categorii') AS coloane;

-- (0.2) Cele 9 categorii țintă trebuie să existe exact așa în ofertare_cantitati.categorie.
--       Așteptat: 9 rânduri, toate cu randuri_in_cantitati > 0.
SELECT c.categorie,
       (SELECT count(*) FROM public.ofertare_cantitati q WHERE q.categorie = c.categorie) AS randuri_in_cantitati
FROM (VALUES ('Conducte și montaj'), ('Armături'), ('Sudură și îmbinări'), ('Branșamente'), ('Cămine'),
             ('Materiale'), ('Betoane'), ('Terasamente'), ('Drumuri și refacere')) AS c(categorie);

-- (0.3) Starea master-ului înainte (la 02.10.2026: 36 de furnizori, 2 cu email, 0 propuși).
SELECT count(*)                                                      AS furnizori,
       count(*) FILTER (WHERE nullif(btrim(email), '') IS NOT NULL)  AS cu_email,
       count(*) FILTER (WHERE observatii = 'propus pentru RFQ 02.10') AS deja_propusi
FROM public.logistica_furnizori;


-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- (a) FURNIZORI NOI ÎN logistica_furnizori
--     18 rânduri active (a1) + 5 comentate (a2, încredere mică).
--     Coloana „de_verificat_seamana_cu” arată furnizorii existenți al căror nume conține primul cuvânt
--     din numele propus. Alarmă falsă cunoscută (verificată pe 02.10): INDUSTRIAL FLUID SRL ↔ 6 METALARC INDUSTRIAL GAZ SRL
--     și 10 INDUSTRIAL M.D.TRADING SRL, care sunt firme diferite. Toate celelalte 22 de nume noi nu au corespondent în master.
-- ──────────────────────────────────────────────────────────────────────────────────────────────
WITH params AS (SELECT false AS aplica),   -- ← true DOAR după confirmarea lui Răzvan
v(nume, email) AS (VALUES
    ('SAMI PLASTIC SA',      'marketingsud@samiplastic.ro')    -- sigur (trimite ofertele, 2026)
  , ('TEHNO WORLD',          'office@tehnoworld.ro')           -- probabil (cereri Gazpet 03 și 05.2026)
  , ('INDUSTRIAL FLUID SRL', 'office@ifluid.ro')               -- sigur
  , ('TONIVIAD',             'office@toniviad.ro')             -- probabil (cereri Gazpet 03 și 05.2026)
  , ('ROMVALVES',            'romvalves@romvalves.ro')         -- probabil (cerere Gazpet 24.03.2026)
  , ('TIMOREX',              'sctimoreximpex@yahoo.com')       -- probabil; denumirea legală e de confirmat
  , ('UPRUC CTR',            'ciprian.fratila@uprucctr.com')   -- probabil (adresă nominală)
  , ('VALROTRADE',           'desfacere@valrotrade.ro')        -- sigur (Departament Vânzări)
  , ('FERBAT SERV',          'office@ferbatserv.ro')           -- probabil (cereri Gazpet 02.2026)
  , ('AQUA COLOR',           'office@aquacolor.ro')            -- sigur
  , ('SIGSERV',              NULL)                             -- slab: sig.serv_group@yahoo.com (doar 2023–2024)
  , ('HATBORU RO',           'leonardo.stanescu@hatboru.ro')   -- probabil (adresă nominală, oferte 2026)
  , ('APAZOL',               'office@apazol.ro')               -- sigur; e subantreprenor (de decis dacă intră în master)
  , ('COLIAL',               NULL)
  , ('ADREMAT',              NULL)
  , ('SORCHIV',              NULL)                             -- slab: cms_sorchiv.gaz@yahoo.com; e subantreprenor de drumuri
  , ('BALASTIERA CARBESTI',  NULL)
  , ('PMV',                  NULL)
    -- (a2) încredere mică: se decomentează doar la cererea lui Răzvan
--, ('ARMAX',                NULL)                             -- slab: armaxsrl@yahoo.com; ≠ ARMAX GAZ (armaxgaz.ro)
--, ('ROMCIM',               NULL)
--, ('KHINEZU',              NULL)                             -- în NAS apare „Kinezu”
--, ('KOROLIS',              NULL)
--, ('CITADIN PREST SA',     NULL)
),
r AS (
  SELECT v.nume, v.email,
         (SELECT string_agg(lf.id || ' ' || lf.nume, '; ' ORDER BY lf.id)
            FROM public.logistica_furnizori lf
           WHERE upper(btrim(lf.nume)) = upper(btrim(v.nume)))                                   AS exista_exact,
         (SELECT string_agg(lf.id || ' ' || lf.nume, '; ' ORDER BY lf.id)
            FROM public.logistica_furnizori lf
           WHERE upper(lf.nume) LIKE '%' || split_part(upper(btrim(v.nume)), ' ', 1) || '%')     AS seamana_cu
  FROM v
),
ins AS (
  INSERT INTO public.logistica_furnizori (nume, email, observatii)
  SELECT r.nume, r.email, 'propus pentru RFQ 02.10'
  FROM r CROSS JOIN params
  WHERE params.aplica AND r.exista_exact IS NULL
  ON CONFLICT (nume) DO NOTHING
  RETURNING id, nume
)
SELECT r.nume,
       r.email,
       CASE WHEN r.exista_exact IS NOT NULL                       THEN 'există deja: ' || r.exista_exact
            WHEN EXISTS (SELECT 1 FROM ins WHERE ins.nume = r.nume) THEN 'inserat'
            WHEN (SELECT aplica FROM params)                      THEN 'NEINSERAT (conflict de nume)'
            ELSE 'de inserat (dry-run)' END                       AS stare,
       r.seamana_cu                                               AS de_verificat_seamana_cu,
       (SELECT array_agg(id ORDER BY id) FROM ins)                AS ids_rollback
FROM r
ORDER BY r.nume;


-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- (b) HARTA furnizor ↔ categorie în ofertare_furnizori_categorii
--     105 perechi propuse: 77 active (încredere mare sau medie) și 28 comentate (încredere mică).
--     furnizor_id se ia prin subselect pe nume (fără diferență între majuscule și minuscule), deci (a) trebuie rulat întâi.
--     Numele existente sunt scrise exact ca în master: „Izocond”, „Valrom Industrie SRL”, „All instal”,
--     „INDUSTRIAL M.D.TRADING SRL” (= IMD) etc.
--     Rezultat așteptat pe categorii (doar rândurile active): Conducte și montaj 18 · Sudură și îmbinări 18 ·
--     Materiale 16 · Armături 10 · Branșamente 10 · Drumuri și refacere 3 · Betoane 2 · Cămine 0 · Terasamente 0.
-- ──────────────────────────────────────────────────────────────────────────────────────────────
WITH params AS (SELECT false AS aplica),   -- ← true DOAR după confirmarea lui Răzvan și DUPĂ (a)
v(nume, categorie, sursa, note) AS (VALUES
    -- 1. KITMETAL (id 5)
    ('KITMETAL', 'Sudură și îmbinări', 'oferte_vechi+preturi+achizitii', 'încredere mare · manșoane Covalence, benzi Polyken, MIJ, weldolet; 23 licitații, 28 comenzi · propus RFQ 02.10')
  , ('KITMETAL', 'Conducte și montaj', 'oferte_vechi+preturi+achizitii', 'încredere mare · inele distanțiere, burdufuri de etanșare (tub de protecție) · propus RFQ 02.10')
  , ('KITMETAL', 'Materiale', 'preturi+achizitii', 'încredere medie · benzi anticorozive, mastic, garnituri · propus RFQ 02.10')
    -- 2. PETROUZINEX (id 12)
  , ('PETROUZINEX SRL', 'Sudură și îmbinări', 'oferte_vechi+preturi+achizitii', 'încredere mare · coturi/curbe EN 10253, flanșe, capace, teuri, reducții; 10 licitații · propus RFQ 02.10')
  , ('PETROUZINEX SRL', 'Armături', 'oferte_vechi+preturi+achizitii', 'încredere mare · robineți sferă/ventil/clapetă (oferta robineți 46653) · propus RFQ 02.10')
  , ('PETROUZINEX SRL', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere medie · curbe din țeavă SAWL/SMLS, țeavă de protecție (oferta țeavă 46589) · propus RFQ 02.10')
  , ('PETROUZINEX SRL', 'Materiale', 'preturi+achizitii', 'încredere medie · garnituri spirometalice, dopuri · propus RFQ 02.10')
    -- 3. TERAPLAST (id 19)
  , ('TERAPLAST', 'Conducte și montaj', 'oferte_vechi+preturi+achizitii', 'încredere mare · țeavă PE100 gaz/apă, tub protecție PEHD; 9 licitații · propus RFQ 02.10')
  , ('TERAPLAST', 'Sudură și îmbinări', 'oferte_vechi+preturi+achizitii', 'încredere mare · fitinguri GF electrosudabile, fitinguri tranziție PE/OL · propus RFQ 02.10')
  , ('TERAPLAST', 'Branșamente', 'preturi+achizitii', 'încredere mare · capăt branșament (riser), teu branșament gas stop · propus RFQ 02.10')
  , ('TERAPLAST', 'Armături', 'preturi+achizitii', 'încredere medie · robineți PE100 GF cu tijă · propus RFQ 02.10')
  , ('TERAPLAST', 'Materiale', 'preturi+achizitii', 'încredere medie · folie avertizare, fir detector · propus RFQ 02.10')
--, ('TERAPLAST', 'Cămine', 'preturi', 'încredere mică · piesă trecere PE/OL D400 (lic. 176) · propus RFQ 02.10')
    -- 4. IZOCOND TECH (în master: Izocond, id 23)
  , ('Izocond', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere mare · izolație protecție mecanică rășină+fibră sticlă (conducte la foraj); 8 licitații · propus RFQ 02.10')
  , ('Izocond', 'Drumuri și refacere', 'oferte_vechi', 'încredere medie · ofertă refacere asfalt + agregate (lic. 40 Hoghilag) · propus RFQ 02.10')
  , ('Izocond', 'Betoane', 'preturi', 'încredere medie · beton C25/30 + transport (lic. 40) · propus RFQ 02.10')
  , ('Izocond', 'Materiale', 'preturi', 'încredere medie · balast, nisip (lic. 40) · propus RFQ 02.10')
    -- 5. VALROM INDUSTRIE (id 32)
  , ('Valrom Industrie SRL', 'Conducte și montaj', 'oferte_vechi+preturi+achizitii', 'încredere mare · țeavă VALGasio PE100, țeavă PE100 D400; 6 licitații · propus RFQ 02.10')
  , ('Valrom Industrie SRL', 'Sudură și îmbinări', 'oferte_vechi+preturi+achizitii', 'încredere mare · coturi, teuri, reducții PE100, mufe EF · propus RFQ 02.10')
  , ('Valrom Industrie SRL', 'Branșamente', 'preturi', 'încredere mare · teu branșament orientabil 360, riser cu răsuflător · propus RFQ 02.10')
  , ('Valrom Industrie SRL', 'Armături', 'preturi', 'încredere medie · vane VALGasio PEHD cu tijă, robinet gaz · propus RFQ 02.10')
--, ('Valrom Industrie SRL', 'Cămine', 'oferte_vechi+achizitii', 'încredere mică · cutie PEHD vană gaz, cutii protecție · propus RFQ 02.10')
    -- 6. IMD = INDUSTRIAL M.D.TRADING SRL (id 10; identitatea e de confirmat cu CUI 8270719)
  , ('INDUSTRIAL M.D.TRADING SRL', 'Armături', 'oferte_vechi+preturi', 'încredere mare · robineți API 6D sferă/cep (oferte robinete 2025–2026); 5 licitații · propus RFQ 02.10')
  , ('INDUSTRIAL M.D.TRADING SRL', 'Sudură și îmbinări', 'oferte_vechi+preturi', 'încredere medie · curbe DN500/DN800, îmbinare electroizolantă, benzi închidere manșon · propus RFQ 02.10')
  , ('INDUSTRIAL M.D.TRADING SRL', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere medie · burdufuri de etanșare, elemente distanțiere (lic. 167) · propus RFQ 02.10')
    -- 7. SEVLAR (id 3)
  , ('SEVLAR', 'Sudură și îmbinări', 'oferte_vechi+achizitii', 'încredere mare · flanșe, weldolet, reducții, capace bombate, mufe sudabile; 14 comenzi · propus RFQ 02.10')
  , ('SEVLAR', 'Materiale', 'achizitii', 'încredere mare · prezoane/piulițe 42CrMo4, inele etanșare R31 · propus RFQ 02.10')
    -- 8. SAMI PLASTIC SA (nou)
  , ('SAMI PLASTIC SA', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere mare · țeavă PE100 SDR11, tub protecție PE; 5 licitații 2026 · propus RFQ 02.10')
  , ('SAMI PLASTIC SA', 'Sudură și îmbinări', 'oferte_vechi+preturi', 'încredere mare · coturi/dopuri/mufe electrosudabile · propus RFQ 02.10')
  , ('SAMI PLASTIC SA', 'Branșamente', 'preturi', 'încredere mare · teu branșament GASKIT, riser D32 · propus RFQ 02.10')
  , ('SAMI PLASTIC SA', 'Armături', 'preturi', 'încredere medie · robineți/vane PE100 · propus RFQ 02.10')
  , ('SAMI PLASTIC SA', 'Materiale', 'preturi', 'încredere medie · bandă avertizare, fir trasor · propus RFQ 02.10')
    -- 9. TEHNO WORLD (nou)
  , ('TEHNO WORLD', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere mare · țeavă PE100 SDR11 gaz; 5 licitații 2026 · propus RFQ 02.10')
  , ('TEHNO WORLD', 'Sudură și îmbinări', 'preturi', 'încredere mare · coturi, dopuri, mufe EF · propus RFQ 02.10')
  , ('TEHNO WORLD', 'Branșamente', 'preturi', 'încredere mare · teu branșament GAZSTOP, cap de branșament, firidă · propus RFQ 02.10')
  , ('TEHNO WORLD', 'Armături', 'preturi', 'încredere medie · robineți PE · propus RFQ 02.10')
--, ('TEHNO WORLD', 'Materiale', 'preturi', 'încredere mică · fir trasor, cutii conexiune · propus RFQ 02.10')
    -- 10. INDUSTRIAL FLUID SRL (nou)
  , ('INDUSTRIAL FLUID SRL', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere mare · inele distanțiere cu role, burdufuri de închidere; 5 licitații · propus RFQ 02.10')
    -- 11. APAZOL (nou; subantreprenor)
  , ('APAZOL', 'Drumuri și refacere', 'oferte_vechi+preturi', 'încredere medie · subantreprenor: beton asfaltic, borduri, asfalt turnat; 4 licitații · propus RFQ 02.10')
--, ('APAZOL', 'Betoane', 'preturi', 'încredere mică · betoane C8/10–C25/30 în devizul ofertat · propus RFQ 02.10')
--, ('APAZOL', 'Terasamente', 'preturi', 'încredere mică · epuizare, sprijiniri în devizul ofertat · propus RFQ 02.10')
    -- 12. UPRUC CTR (nou)
  , ('UPRUC CTR', 'Sudură și îmbinări', 'oferte_vechi', 'încredere medie · fitinguri (oferte PQ…FT); 4 licitații · propus RFQ 02.10')
    -- 13. VALROTRADE (nou)
  , ('VALROTRADE', 'Conducte și montaj', 'oferte_vechi+mail', 'încredere medie · țeavă OL izolată/neizolată (ofertă 12.2025 + comandă confirmată); 4 licitații · propus RFQ 02.10')
    -- 14. VASTRUM TRANSCOM (id 4)
  , ('Vastrum Transcom SRL', 'Sudură și îmbinări', 'achizitii', 'încredere mare · flanșe cu gât/oarbe, coturi, coupling, niplu; 11 comenzi · propus RFQ 02.10')
  , ('Vastrum Transcom SRL', 'Materiale', 'achizitii', 'încredere medie · prezoane, piulițe · propus RFQ 02.10')
    -- 15. MEDA CONSTRUCT (id 25)
  , ('MEDA CONSTRUCT', 'Sudură și îmbinări', 'achizitii', 'încredere mare · mufe/teuri/reducții electrosudabile; 9 comenzi · propus RFQ 02.10')
  , ('MEDA CONSTRUCT', 'Branșamente', 'achizitii+preturi', 'încredere mare · teu branșament stop gaz, capăt branșament, răsuflători · propus RFQ 02.10')
  , ('MEDA CONSTRUCT', 'Conducte și montaj', 'achizitii', 'încredere medie · țeavă gaz PE, tub protecție PVC · propus RFQ 02.10')
  , ('MEDA CONSTRUCT', 'Materiale', 'achizitii', 'încredere medie · bandă avertizare gaz · propus RFQ 02.10')
    -- 16. TONIVIAD (nou)
  , ('TONIVIAD', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere mare · țeavă gaz PE100 D32–D400; 3 licitații · propus RFQ 02.10')
  , ('TONIVIAD', 'Sudură și îmbinări', 'oferte_vechi+preturi', 'încredere mare · curbe/reducții/mufe EF D400, fiting tranziție PE-OL · propus RFQ 02.10')
  , ('TONIVIAD', 'Branșamente', 'preturi', 'încredere medie · riser, teu branșament gas stop · propus RFQ 02.10')
  , ('TONIVIAD', 'Armături', 'preturi', 'încredere medie · robineți PEHD · propus RFQ 02.10')
--, ('TONIVIAD', 'Materiale', 'preturi', 'încredere mică · bandă avertizare · propus RFQ 02.10')
    -- 17. SIGSERV (nou)
  , ('SIGSERV', 'Sudură și îmbinări', 'oferte_vechi+preturi', 'încredere medie · manșoane termocontractabile (Canusa), benzi anticorozive; 3 licitații · propus RFQ 02.10')
  , ('SIGSERV', 'Conducte și montaj', 'oferte_vechi+preturi', 'încredere medie · țeavă OL, inele distanțiere/burdufuri · propus RFQ 02.10')
--, ('SIGSERV', 'Materiale', 'preturi', 'încredere mică · primer, benzi de protecție · propus RFQ 02.10')
    -- 18. AQUA COLOR (nou)
  , ('AQUA COLOR', 'Materiale', 'oferte_vechi+preturi', 'încredere medie · vopsele Interseal 670HS / Interthane 990 + aplicare; 3 licitații · propus RFQ 02.10')
    -- 19. ALL INSTAL (id 21)
  , ('All instal', 'Branșamente', 'oferte_vechi+preturi+achizitii', 'încredere mare · firide, teu branșament EF, riser · propus RFQ 02.10')
  , ('All instal', 'Sudură și îmbinări', 'preturi', 'încredere mare · coturi/mufe/dopuri EF, fiting tranziție · propus RFQ 02.10')
  , ('All instal', 'Conducte și montaj', 'preturi', 'încredere medie · țeavă gaz PE100 · propus RFQ 02.10')
  , ('All instal', 'Armături', 'preturi', 'încredere medie · robineți PEHD cu bilă · propus RFQ 02.10')
  , ('All instal', 'Materiale', 'preturi+achizitii', 'încredere medie · bandă avertizare, fir trasor · propus RFQ 02.10')
    -- 20. SINTAX (id 1)
  , ('SINTAX', 'Conducte și montaj', 'oferte_vechi+achizitii', 'încredere mare · țeavă OL L360 izolată PEHD Ø508/Ø711; 6 comenzi · propus RFQ 02.10')
  , ('SINTAX', 'Sudură și îmbinări', 'achizitii', 'încredere medie · curbe SAWL/SMLS, reducții, capace bombate · propus RFQ 02.10')
    -- 21. METALARC INDUSTRIAL GAZ (id 6)
  , ('METALARC INDUSTRIAL GAZ SRL', 'Sudură și îmbinări', 'achizitii', 'încredere mare · electrozi OK 55/Bohler, sârmă de sudură; 9 comenzi · propus RFQ 02.10')
  , ('METALARC INDUSTRIAL GAZ SRL', 'Materiale', 'achizitii', 'încredere medie · discuri, consumabile · propus RFQ 02.10')
    -- 22. ROMVALVES (nou)
  , ('ROMVALVES', 'Armături', 'oferte_vechi+preturi', 'încredere mare · robineți sferă API6D DBB, cep echilibrat; lic. 177, 180 · propus RFQ 02.10')
    -- 23. COLIAL (nou)
  , ('COLIAL', 'Materiale', 'oferte_vechi+preturi', 'încredere medie · balast, sorturi, piatră spartă; lic. 168, 176 · propus RFQ 02.10')
--, ('COLIAL', 'Terasamente', 'preturi', 'încredere mică · nisip (sort 0-4) pentru pat/umplutură · propus RFQ 02.10')
--, ('COLIAL', 'Drumuri și refacere', 'preturi', 'încredere mică · balast/piatră spartă pentru straturi · propus RFQ 02.10')
    -- 24. ARMAX (nou, a2: rândul din (a) e comentat)
--, ('ARMAX', 'Armături', 'oferte_vechi+preturi', 'încredere mică · robineți DN15, manometre, traductoare (lic. 146, 167) · propus RFQ 02.10')
    -- 25. TIMOREX (nou)
  , ('TIMOREX', 'Armături', 'oferte_vechi', 'încredere medie · robineți ROS/RRC/RSP/RVD (fișe tehnice lic. 30, 180) · propus RFQ 02.10')
    -- 26. FERBAT SERV (nou)
  , ('FERBAT SERV', 'Sudură și îmbinări', 'oferte_vechi+preturi', 'încredere medie · teuri/reducții P285NH, flanșe RTJ (61 prețuri, lic. 30) · propus RFQ 02.10')
  , ('FERBAT SERV', 'Materiale', 'preturi', 'încredere medie · garnituri plane · propus RFQ 02.10')
    -- 27. ADREMAT (nou)
  , ('ADREMAT', 'Betoane', 'oferte_vechi+preturi', 'încredere medie · beton C20/25, C25/30, pompare (lic. 168) · propus RFQ 02.10')
  , ('ADREMAT', 'Materiale', 'preturi', 'încredere medie · balast, piatră spartă, nisip (lic. 168) · propus RFQ 02.10')
--, ('ADREMAT', 'Terasamente', 'preturi', 'încredere mică · balast 0-63 pentru terasamente · propus RFQ 02.10')
--, ('ADREMAT', 'Drumuri și refacere', 'preturi', 'încredere mică · agregate pentru straturi · propus RFQ 02.10')
    -- 28. ROMCIM (nou, a2)
--, ('ROMCIM', 'Betoane', 'oferte_vechi+preturi', 'încredere mică · beton C20/25, C25/30 (lic. 168) · propus RFQ 02.10')
    -- 29. SORCHIV (nou; subantreprenor de drumuri)
  , ('SORCHIV', 'Drumuri și refacere', 'oferte_vechi+preturi', 'încredere medie · subantreprenor: deviz refacere drumuri (bitum, emulsie, asfalt), lic. 176 · propus RFQ 02.10')
    -- 30. KHINEZU (nou, a2)
--, ('KHINEZU', 'Materiale', 'oferte_vechi+preturi', 'încredere mică · balast, nisip, pietriș, piatră spartă (lic. 30) · propus RFQ 02.10')
--, ('KHINEZU', 'Terasamente', 'preturi', 'încredere mică · agregate · propus RFQ 02.10')
--, ('KHINEZU', 'Drumuri și refacere', 'preturi', 'încredere mică · agregate · propus RFQ 02.10')
    -- 31. KOROLIS (nou, a2)
--, ('KOROLIS', 'Betoane', 'oferte_vechi', 'încredere mică · ofertă beton + agregat (lic. 48) · propus RFQ 02.10')
--, ('KOROLIS', 'Materiale', 'oferte_vechi', 'încredere mică · agregate (lic. 48) · propus RFQ 02.10')
--, ('KOROLIS', 'Terasamente', 'oferte_vechi', 'încredere mică · agregate · propus RFQ 02.10')
--, ('KOROLIS', 'Drumuri și refacere', 'oferte_vechi', 'încredere mică · agregate · propus RFQ 02.10')
    -- 32. NORD GAZ DISTRIBUȚIE (id 22)
  , ('NORD GAZ DISTRIBUTIE S.R.L.', 'Branșamente', 'oferte_vechi+preturi+achizitii', 'încredere medie · contor G10, regulator Fiorentini, firidă echipată · propus RFQ 02.10')
    -- 33. HOMPLEX (id 26)
  , ('Homplex S.A.', 'Branșamente', 'preturi+achizitii', 'încredere medie · firide echipate cu regulator, contoare smart AMR · propus RFQ 02.10')
--, ('Homplex S.A.', 'Armături', 'achizitii', 'încredere mică · robinet bilă gaz · propus RFQ 02.10')
--, ('Homplex S.A.', 'Materiale', 'achizitii', 'încredere mică · bandă avertizare · propus RFQ 02.10')
    -- 34. WINTER COM (id 31)
  , ('WINTER COM SRL', 'Branșamente', 'achizitii', 'încredere medie · teu branșament MB D90-32 · propus RFQ 02.10')
  , ('WINTER COM SRL', 'Sudură și îmbinări', 'achizitii', 'încredere medie · reducție electrosudabilă D63-32 · propus RFQ 02.10')
--, ('WINTER COM SRL', 'Armături', 'achizitii', 'încredere mică · robinet GF PE100 · propus RFQ 02.10')
    -- 35. SENAL-COM (id 14)
  , ('SENAL - COM SRL', 'Conducte și montaj', 'achizitii', 'încredere medie · țeavă laminată la cald OL, țeavă OL 1" · propus RFQ 02.10')
    -- 36. PALPLAST (id 30)
  , ('PALPLAST', 'Conducte și montaj', 'achizitii', 'încredere medie · țeavă gaz PE100 D32–D140 · propus RFQ 02.10')
    -- 37. BALASTIERA CĂRBEȘTI (nou)
  , ('BALASTIERA CARBESTI', 'Materiale', 'oferte_vechi+preturi', 'încredere medie · balast, nisip, sorturi, piatră spartă (lic. 146) · propus RFQ 02.10')
--, ('BALASTIERA CARBESTI', 'Terasamente', 'preturi', 'încredere mică · nisip/balast pentru umplutură · propus RFQ 02.10')
--, ('BALASTIERA CARBESTI', 'Drumuri și refacere', 'preturi', 'încredere mică · balast/piatră spartă pentru straturi · propus RFQ 02.10')
    -- 38. PMV (nou)
  , ('PMV', 'Materiale', 'oferte_vechi+preturi', 'încredere medie · balast, nisip, pietriș, bolovani (lic. 135) · propus RFQ 02.10')
--, ('PMV', 'Terasamente', 'preturi', 'încredere mică · nisip/balast pentru umplutură · propus RFQ 02.10')
--, ('PMV', 'Drumuri și refacere', 'preturi', 'încredere mică · balast pentru straturi · propus RFQ 02.10')
    -- 39. HATBORU RO (nou)
  , ('HATBORU RO', 'Conducte și montaj', 'oferte_vechi+mail', 'încredere medie · țeavă OL DN500 (ofertă + confirmare comandă 03.2025, lic. 135) · propus RFQ 02.10')
    -- 40. CITADIN PREST SA (nou, a2)
--, ('CITADIN PREST SA', 'Drumuri și refacere', 'preturi', 'încredere mică · mixturi asfaltice · propus RFQ 02.10')
),
r AS (
  SELECT v.nume, v.categorie, v.sursa, v.note,
         (SELECT array_agg(lf.id ORDER BY lf.id)
            FROM public.logistica_furnizori lf
           WHERE upper(btrim(lf.nume)) = upper(btrim(v.nume))) AS ids          -- subselect pe nume
  FROM v
),
ins AS (
  INSERT INTO public.ofertare_furnizori_categorii (furnizor_id, categorie, sursa, note)
  SELECT r.ids[1], r.categorie, r.sursa, r.note
  FROM r CROSS JOIN params
  WHERE params.aplica
    AND cardinality(r.ids) = 1
    AND NOT EXISTS (SELECT 1 FROM public.ofertare_furnizori_categorii x
                     WHERE x.furnizor_id = r.ids[1] AND x.categorie = r.categorie)
  RETURNING furnizor_id, categorie
)
SELECT r.categorie,
       r.nume,
       r.ids                                                                 AS furnizor_id,
       CASE WHEN r.ids IS NULL           THEN 'NEREZOLVAT — furnizorul nu e (încă) în logistica_furnizori; rulați întâi (a)'
            WHEN cardinality(r.ids) > 1  THEN 'AMBIGUU — mai multe rânduri cu același nume; nu se inserează'
            WHEN EXISTS (SELECT 1 FROM ins WHERE ins.furnizor_id = r.ids[1] AND ins.categorie = r.categorie)
                                         THEN 'inserat'
            WHEN EXISTS (SELECT 1 FROM public.ofertare_furnizori_categorii x
                          WHERE x.furnizor_id = r.ids[1] AND x.categorie = r.categorie)
                                         THEN 'există deja'
            ELSE 'de inserat (dry-run)' END                                  AS stare,
       (SELECT count(*) FROM ins)                                            AS inserate_total
FROM r
ORDER BY r.categorie, r.nume;


-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- (c) OPȚIONAL (în afara cererii de azi): email pentru furnizorii EXISTENȚI care n-au email în master.
--     Fără email, RFQ-ul nu are unde pleca. Atinge DOAR rândurile cu email gol; nu suprascrie nimic.
--     Sursa adreselor: Gmail (metadate), vezi anexa din .md. „probabil” = de confirmat înainte de primul RFQ.
-- ──────────────────────────────────────────────────────────────────────────────────────────────
WITH params AS (SELECT false AS aplica),   -- ← true DOAR dacă Răzvan vrea și acest pas
v(nume, email) AS (VALUES
    ('KITMETAL',                    'contact@kitmetal.ro')            -- sigur
  , ('PETROUZINEX SRL',             'marketing@petrouzinex.ro')       -- sigur
  , ('TERAPLAST',                   'office@teraplast.ro')            -- sigur
  , ('Izocond',                     'office@izocond.ro')              -- sigur
  , ('Valrom Industrie SRL',        'office@valrom.ro')               -- sigur
  , ('SEVLAR',                      'ofertare@sevlar.ro')             -- sigur
  , ('METALARC INDUSTRIAL GAZ SRL', 'office@metalarc.ro')             -- sigur
  , ('NORD GAZ DISTRIBUTIE S.R.L.', 'nordgazdistributie@gmail.com')   -- sigur (adresa gmail de pe care trimite firma)
  , ('INDUSTRIAL M.D.TRADING SRL',  'radu.ghita@imd.ro')              -- probabil (persoana din master)
  , ('All instal',                  'licitatii@all-instal.ro')        -- probabil
  , ('MEDA CONSTRUCT',              'bogdanalexandru@meda.com.ro')    -- probabil
  , ('Homplex S.A.',                'marketing@homplex.ro')           -- probabil
  , ('WINTER COM SRL',              'nicolae.avram@wintercom.ro')     -- probabil (persoana din master)
  , ('PALPLAST',                    'daniel.dita@palplast.ro')        -- probabil (persoana din master)
),
r AS (
  SELECT v.nume, v.email, lf.id, lf.email AS email_actual
  FROM v
  LEFT JOIN public.logistica_furnizori lf ON upper(btrim(lf.nume)) = upper(btrim(v.nume))
),
upd AS (
  UPDATE public.logistica_furnizori lf
     SET email = r.email
    FROM r CROSS JOIN params
   WHERE params.aplica
     AND lf.id = r.id
     AND nullif(btrim(lf.email), '') IS NULL
  RETURNING lf.id
)
SELECT r.nume,
       r.id,
       r.email_actual,
       r.email                                                            AS email_propus,
       CASE WHEN r.id IS NULL                                     THEN 'NEREZOLVAT — nume negăsit în master'
            WHEN EXISTS (SELECT 1 FROM upd WHERE upd.id = r.id)   THEN 'actualizat'
            WHEN nullif(btrim(r.email_actual), '') IS NOT NULL    THEN 'are deja email — nu se atinge'
            ELSE 'de actualizat (dry-run)' END                            AS stare,
       (SELECT array_agg(id ORDER BY id) FROM upd)                        AS ids_rollback
FROM r
ORDER BY r.nume;


-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- (d) VERIFICARE DUPĂ APLICARE + ROLLBACK
-- ──────────────────────────────────────────────────────────────────────────────────────────────

-- (d.1) Harta aplicată, pe categorii. Așteptat, cu rândurile active: Armături 10 · Betoane 2 · Branșamente 10 ·
--       Conducte și montaj 18 · Drumuri și refacere 3 · Materiale 16 · Sudură și îmbinări 18 (total 77).
SELECT c.categorie, count(*) AS furnizori, string_agg(lf.nume, ', ' ORDER BY lf.nume) AS lista
FROM public.ofertare_furnizori_categorii c
JOIN public.logistica_furnizori lf ON lf.id = c.furnizor_id
WHERE c.note LIKE '%propus RFQ 02.10%'
GROUP BY c.categorie
ORDER BY c.categorie;

-- (d.2) Furnizorii noi din master. Așteptat: 18 rânduri, dacă (a2) rămâne comentat.
SELECT id, nume, email, observatii
FROM public.logistica_furnizori
WHERE observatii = 'propus pentru RFQ 02.10'
ORDER BY id;

-- (d.3) ROLLBACK, doar la nevoie. Păstrați ids_rollback întoarse de (a), (b) și (c).
--       Ordinea: întâi harta (b), apoi furnizorii (a), pentru că harta are FK către logistica_furnizori.
-- DELETE FROM public.ofertare_furnizori_categorii WHERE note LIKE '%propus RFQ 02.10%';
-- DELETE FROM public.logistica_furnizori lf
--  WHERE lf.id = ANY ('{<ids_rollback din (a)>}'::int[])
--    AND lf.observatii = 'propus pentru RFQ 02.10'
--    AND NOT EXISTS (SELECT 1 FROM public.comenzi_furnizor cf  WHERE cf.furnizor_id = lf.id)   -- ⚠ FK ON DELETE SET NULL: nu ștergem furnizori deja folosiți
--    AND NOT EXISTS (SELECT 1 FROM public.logistica_active la  WHERE la.furnizor_id = lf.id)
--    AND NOT EXISTS (SELECT 1 FROM public.upa_achizitii ua     WHERE ua.furnizor_id = lf.id)
--    AND NOT EXISTS (SELECT 1 FROM public.ofertare_furnizori_categorii x WHERE x.furnizor_id = lf.id);
-- UPDATE public.logistica_furnizori SET email = NULL WHERE id = ANY ('{<ids_rollback din (c)>}'::int[]);
