-- Nomenclatorul domeniilor/subdomeniilor de autorizare RTE (Inspectoratul de Stat în Construcții).
-- Sursa: Procedura privind autorizarea și exercitarea dreptului de practică a responsabililor
-- tehnici cu execuția lucrărilor de construcții din 31.08.2016 (MDRAP), publicată în
-- Monitorul Oficial Partea I nr. 767 din 30.09.2016, în vigoare de la 30.09.2016.
-- Codurile și denumirile sunt din art. 8 alin. (2) și Anexa nr. 1. Lista sare de la 9 la 11 —
-- așa e în ordin, nu e o omisiune a noastră.
--
-- De ce există (TKT-0203, Oana): motorul de acoperire alegea domeniul RTE „din burtă" —
-- la o lucrare de alimentare cu apă a propus 8.4 (gaze), pentru că îl deducea din lucrarea de
-- experiență similară. Fără o listă închisă de coduri nu avem cu ce să-l corectăm.
CREATE TABLE IF NOT EXISTS public.isc_rte_domenii (
  cod                      text PRIMARY KEY,
  grup_cod                 text NOT NULL,
  grup_nume                text NOT NULL,
  denumire                 text NOT NULL,
  experienta_ani           smallint NOT NULL,
  experienta_nota          text,
  variante                 text[],
  legitimatie_ceruta       text,
  autorizatie_anre_ceruta  jsonb,
  cuvinte_cheie_lucrari    text[],
  activ                    boolean NOT NULL DEFAULT true,
  sursa_act                text NOT NULL DEFAULT 'Procedura ISC 31.08.2016, MO 767/30.09.2016',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.isc_rte_domenii IS
  'Domeniile/subdomeniile de autorizare RTE — ISC, Procedura din 31.08.2016 (MO 767/30.09.2016).';
COMMENT ON COLUMN public.isc_rte_domenii.variante IS
  'Variante în cadrul aceluiași cod. Doar 8.4 are: D = distribuție, T = transport (art. 8 alin. 2, nota 2*).';
COMMENT ON COLUMN public.isc_rte_domenii.legitimatie_ceruta IS
  'Legitimație care trebuie MENȚINUTĂ VALABILĂ pe toată durata autorizației (art. 51 lit. g). Nu doar la examen.';
COMMENT ON COLUMN public.isc_rte_domenii.autorizatie_anre_ceruta IS
  'Autorizație ANRE obligatorie pentru a putea participa la examen, pe variantă (art. 8 nota 2*): D→EGD, T→EGT.';
COMMENT ON COLUMN public.isc_rte_domenii.cuvinte_cheie_lucrari IS
  'AJUTOR INTERN DE POTRIVIRE, completat de noi — NU face parte din ordin. Folosit ca indiciu la '
  'identificarea domeniului din obiectul licitației; verdictul rămâne al omului. Un cuvânt poate '
  'apărea la mai multe coduri (ex. alimentare cu apă la 8.2 și 9.1) — exact acolo unde ordinul '
  'e ambiguu și se cere clarificare de la autoritate.';

ALTER TABLE public.isc_rte_domenii ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.isc_rte_domenii TO authenticated;
GRANT ALL    ON public.isc_rte_domenii TO service_role;

DROP POLICY IF EXISTS isc_rte_domenii_select ON public.isc_rte_domenii;
CREATE POLICY isc_rte_domenii_select ON public.isc_rte_domenii
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_isc_rte_domenii_grup ON public.isc_rte_domenii (grup_cod, cod);
CREATE INDEX IF NOT EXISTS idx_isc_rte_domenii_cuvinte ON public.isc_rte_domenii USING gin (cuvinte_cheie_lucrari);

-- Cele 23 de subdomenii, exact ca în Anexa nr. 1. Anii de experiență și notele sunt din
-- tabelul de la art. 8 alin. (2). Cuvintele-cheie sunt ale noastre (vezi comentariul coloanei).
INSERT INTO public.isc_rte_domenii
 (cod, grup_cod, grup_nume, denumire, experienta_ani, experienta_nota, variante, legitimatie_ceruta, autorizatie_anre_ceruta, cuvinte_cheie_lucrari)
VALUES
 ('1.1','1','Construcții civile, industriale, agricole, energetice, telecomunicații și miniere','Construcții civile, industriale și agricole',6,NULL,NULL,NULL,NULL,ARRAY['constructii civile','cladire','hala','sediu','industriale','agricole','reabilitare cladire']),
 ('1.2','1','Construcții civile, industriale, agricole, energetice, telecomunicații și miniere','Construcții energetice și transport pe cablu',6,NULL,NULL,NULL,NULL,ARRAY['constructii energetice','transport pe cablu','telegondola','telescaun']),
 ('1.3','1','Construcții civile, industriale, agricole, energetice, telecomunicații și miniere','Construcții telecomunicații',6,NULL,NULL,NULL,NULL,ARRAY['constructii telecomunicatii','turn telecom','pilon antena']),
 ('1.4','1','Construcții civile, industriale, agricole, energetice, telecomunicații și miniere','Construcții miniere',6,NULL,NULL,NULL,NULL,ARRAY['constructii miniere','mina','puturi miniere']),
 ('2.1','2','Construcții rutiere, drumuri, poduri, tunele, piste de aviație','Construcții rutiere și drumuri',6,NULL,NULL,NULL,NULL,ARRAY['drumuri','rutiere','strazi','asfalt','carosabil','refacere sistem rutier','modernizare drum']),
 ('2.2','2','Construcții rutiere, drumuri, poduri, tunele, piste de aviație','Construcții piste de aviație',6,NULL,NULL,NULL,NULL,ARRAY['pista de aviatie','aeroport','platforma aeroportuara']),
 ('2.3','2','Construcții rutiere, drumuri, poduri, tunele, piste de aviație','Construcții poduri',6,NULL,NULL,NULL,NULL,ARRAY['pod','podet','viaduct','pasaj']),
 ('2.4','2','Construcții rutiere, drumuri, poduri, tunele, piste de aviație','Construcții tunele și metrou',6,NULL,NULL,NULL,NULL,ARRAY['tunel','metrou','subtraversare tunel']),
 ('3.1','3','Construcții căi ferate și transport urban pe șină','Construcții căi ferate și transport urban pe șină',6,NULL,NULL,NULL,NULL,ARRAY['cale ferata','cai ferate','tramvai','transport urban pe sina']),
 ('4.1','4','Construcții de porturi și platforme maritime','Construcții de porturi',6,NULL,NULL,NULL,NULL,ARRAY['port','dana','cheu']),
 ('4.2','4','Construcții de porturi și platforme maritime','Construcții de platforme maritime',6,NULL,NULL,NULL,NULL,ARRAY['platforma maritima','offshore']),
 ('5.1','5','Construcții și amenajări hidrotehnice','Construcții și amenajări hidrotehnice',6,NULL,NULL,NULL,NULL,ARRAY['hidrotehnice','baraj','dig','regularizare','aparare de maluri','acumulare']),
 ('6.1','6','Instalații aferente construcțiilor','Instalații electrice',6,NULL,NULL,'electrician',NULL,ARRAY['instalatii electrice','tablou electric','instalatie electrica interioara']),
 ('6.2','6','Instalații aferente construcțiilor','Instalații termice, sanitare și de ventilație/climatizare',6,'Pentru instalații de ventilație/climatizare experiența minimă este de 5 ani (nota 1* din tabel).',NULL,NULL,NULL,ARRAY['instalatii termice','instalatii sanitare','ventilatie','climatizare','hvac','centrala termica']),
 ('6.3','6','Instalații aferente construcțiilor','Instalații gaze naturale combustibile',6,NULL,NULL,'instalator_gaze',NULL,ARRAY['instalatii gaze','instalatie de utilizare gaze','instalatii utilizare gaze naturale','post reglare masura']),
 ('7.1','7','Construcții pentru îmbunătățiri funciare','Construcții pentru îmbunătățiri funciare',6,NULL,NULL,NULL,NULL,ARRAY['imbunatatiri funciare','irigatii','desecare','drenaj','combatere eroziune sol']),
 ('8.1','8','Rețele aferente construcțiilor','Rețele electrice',6,NULL,NULL,'electrician',NULL,ARRAY['retele electrice','lea','les','linie electrica','post trafo','bransament electric']),
 ('8.2','8','Rețele aferente construcțiilor','Rețele termice și sanitare',6,'Pentru rețele termice experiența minimă este de 5 ani (nota 1* din tabel).',NULL,NULL,NULL,ARRAY['retele termice','retele sanitare','alimentare cu apa','canalizare','apa-canal','aductiune','conducta apa','retea apa']),
 ('8.3','8','Rețele aferente construcțiilor','Rețele de telecomunicații',6,NULL,NULL,NULL,NULL,ARRAY['retele telecomunicatii','fibra optica','retea voce date']),
 ('8.4','8','Rețele aferente construcțiilor','Rețele de gaze naturale combustibile',5,NULL,ARRAY['D','T'],'instalator_gaze','{"D":"EGD — Execuție sisteme distribuție gaze naturale","T":"EGT — Execuție sisteme transport gaze naturale"}'::jsonb,ARRAY['retele gaze','conducta gaze','distributie gaze','transport gaze','bransament gaze','srm','statie reglare masurare','gaze naturale']),
 ('8.5','8','Rețele aferente construcțiilor','Rețele pentru transportul produselor petroliere',5,NULL,NULL,NULL,NULL,ARRAY['produse petroliere','conducta titei','transport produse petroliere']),
 ('9.1','9','Construcții edilitare și de gospodărie comunală','Construcții edilitare și de gospodărie comunală',6,NULL,NULL,NULL,NULL,ARRAY['edilitare','gospodarie comunala','alimentare cu apa','canalizare','statie de epurare','statie de pompare','retele edilitare','rezervor apa','gospodarie de apa']),
 ('11.1','11','Lucrări speciale de fundații','Lucrări speciale de fundații',6,NULL,NULL,NULL,NULL,ARRAY['lucrari speciale de fundatii','piloti','pereti mulati','micropiloti','epuismente'])
ON CONFLICT (cod) DO NOTHING;
