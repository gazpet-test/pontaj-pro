-- P0a — checklist executabil (Mânăstirea, licitatie 3). Rulează DUPĂ migrarea 20260923_p0a_source_pack.sql, într-o tranzacție;
-- se termină întotdeauna cu RAISE EXCEPTION 'P0A_DRYRUN {json}' => NIMIC nu persistă, rezultatele sunt în mesajul erorii.
-- Fixture: pack-ul real B1 trimis (excerpt-uri tăiate la 70 caractere) + pack sintetic cu 3 cerințe (verificat pagina / document / fișier inexistent).
DO $do$
DECLARE r jsonb := '{}'::jsonb; v jsonb; t text; n int; n2 int; pid bigint; sid bigint; res jsonb; res2 jsonb; c0 int; c1 int; m0 int; d0 int; x bigint; f real;
BEGIN
  -- baseline
  SELECT count(*) INTO c0 FROM public.ofertare_cerinte; r := r || jsonb_build_object('B_cerinte_total_inainte', c0);
  SELECT max(nr_ordine) INTO m0 FROM public.ofertare_cerinte WHERE licitatie_id=3; r := r || jsonb_build_object('B_max_ordine_lic3', m0);
  SELECT nr_cerinte INTO d0 FROM public.v_ofertare_dashboard WHERE id=3; r := r || jsonb_build_object('B_dashboard_lic3', d0);

  -- S1 schema
  SELECT jsonb_agg(column_name ORDER BY ordinal_position) INTO v FROM information_schema.columns WHERE table_name='ofertare_source_pack';
  r := r || jsonb_build_object('S1_source_pack_cols', v);
  SELECT jsonb_agg(column_name||':'||is_nullable) INTO v FROM information_schema.columns WHERE table_name='ofertare_cerinte' AND column_name IN ('sursa_pack_id','sursa_ref','locator_verificat','pagina_declarata','incertitudine','sursa_mapare','text_editat_la','text_editat_de');
  r := r || jsonb_build_object('S2_cerinte_cols_noi', v);
  SELECT count(*) INTO n FROM public.ofertare_cerinte WHERE sursa_pack_id IS NOT NULL OR sursa_ref IS NOT NULL OR locator_verificat IS NOT NULL OR pagina_declarata IS NOT NULL OR incertitudine IS NOT NULL OR sursa_mapare IS NOT NULL OR text_editat_la IS NOT NULL OR text_editat_de IS NOT NULL;
  SELECT count(*) INTO n2 FROM public.ofertare_cerinte; r := r || jsonb_build_object('S2_randuri_vechi_cu_valori_noi', n, 'S2_cerinte_total_dupa_migrare', n2);
  SELECT pg_get_constraintdef(oid) INTO t FROM pg_constraint WHERE conname='ofertare_cerinte_cand_se_prezinta_check'; r := r || jsonb_build_object('S4_check_cand', t);
  SELECT count(*) INTO n FROM pg_indexes WHERE indexname='ofertare_cerinte_pack_ref_unic'; r := r || jsonb_build_object('S3_index_unic_exista', n);
  SELECT reloptions::text INTO t FROM pg_class WHERE relname='v_ofertare_source_pack_nereusite'; r := r || jsonb_build_object('S5_view_reloptions', t);

  -- SEC1 RLS + policies
  SELECT jsonb_agg(jsonb_build_object('t',tablename,'p',policyname,'cmd',cmd,'roles',roles::text)) INTO v FROM pg_policies WHERE tablename IN ('ofertare_source_pack','ofertare_source_pack_importuri');
  r := r || jsonb_build_object('SEC1_policies', v);
  SELECT jsonb_agg(jsonb_build_object('t',relname,'rls',relrowsecurity)) INTO v FROM pg_class WHERE relname IN ('ofertare_source_pack','ofertare_source_pack_importuri'); r := r || jsonb_build_object('SEC1_rls', v);
  SELECT jsonb_agg(jsonb_build_object('fn',proname,'definer',prosecdef,'volatile',provolatile,'config',proconfig::text)) INTO v FROM pg_proc WHERE proname IN ('fn_ofertare_source_pack_preview','fn_ofertare_source_pack_import','fn_ofertare_source_pack_mapeaza_doc','fn_ofertare_cerinte_pack_protejeaza','fn_ofertare_source_pack_imutabil');
  r := r || jsonb_build_object('SEC3_functii', v);
  SELECT jsonb_agg(jsonb_build_object('fn',p.proname,'grantee',g.grantee,'priv',g.privilege_type)) INTO v FROM information_schema.routine_privileges g JOIN pg_proc p ON p.proname=g.routine_name WHERE g.routine_name IN ('fn_ofertare_source_pack_preview','fn_ofertare_source_pack_import') AND g.grantee IN ('PUBLIC','anon','authenticated','service_role');
  r := r || jsonb_build_object('SEC3_grants', v);

  -- ID1 insert pack real (ca postgres = ca workerul service_role)
  INSERT INTO public.ofertare_source_pack (licitatie_id, stamp, fisier, pack_hash, model, cost_usd, ture, durata_s, pack, validare, nr_cerinte, nr_nereusite, nr_erate)
  VALUES (3, '2026-09-23_1512', 'out/2026-09-23_1512_source_pack.pack.json', 'ce4462f33ea0fce79e000fe19447c1f7fbbbc608ae02dfdb59ebf212d5fe1286', 'claude-sonnet-5', 1.5857, 30, 506, $fx${
"schema": "gazpet.source_pack/v1",
"licitatie": {
"licitatie_id": 3,
"nr_anunt": "DF1278266"
},
"reader": {
"model": "claude-sonnet-5",
"scop": "documentatie"
},
"documente": [
{
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagini": 23,
"citit": "integral"
},
{
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagini": 113,
"citit": "partial"
},
{
"nume_fisier": "documentatie SEAP/2.1.-Anexa 1- Factori de evaluare - detaliere.pdf",
"seap_cod": null,
"pagini": 11,
"citit": "integral"
},
{
"nume_fisier": "documentatie SEAP/Factorii de evaluare - detaliere.pdf",
"seap_cod": null,
"pagini": 10,
"citit": "partial"
},
{
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagini": 6,
"citit": "integral"
},
{
"nume_fisier": "documentatie SEAP/5_2_Conditii_specifice_HG1_REVIZUITE_ADI_Mostistea_Gaze_Sud.docx",
"seap_cod": null,
"pagini": 4,
"citit": "integral"
},
{
"nume_fisier": "documentatie SEAP/5_3_Conditii_generale_HG1_REVIZUITE_ADI_Mostistea_Gaze_Sud.docx",
"seap_cod": null,
"pagini": 161,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/Formulare_conf_ANAP.docx",
"seap_cod": null,
"pagini": 26,
"citit": "integral"
},
{
"nume_fisier": "documentatie SEAP/DG_devizul_general 1.pdf",
"seap_cod": null,
"pagini": 3,
"citit": "integral"
},
{
"nume_fisier": "documentatie SEAP/3.1 - PT - Partea scrisa 1.pdf",
"seap_cod": null,
"pagini": 30,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/3.2 - Procedura Operationala Dornacor Invest.pdf",
"seap_cod": null,
"pagini": 21,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/3.3 - Hotarare scan cu anexe 1.pdf",
"seap_cod": null,
"pagini": 9,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/3.4 - Conventie Tehnica OE.pdf",
"seap_cod": null,
"pagini": 14,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/3.5 - Aviz CTE Distrigaz Sud Retele.pdf",
"seap_cod": null,
"pagini": 1,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/3.6 - Anexe ATRSolutie Alimentare.pdf",
"seap_cod": null,
"pagini": 60,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/3.7 - ATR Distrigaz Sud Retele_ADI.pdf",
"seap_cod": null,
"pagini": 3,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/5. hotarare scan cu anexe.pdf",
"seap_cod": null,
"pagini": 9,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/6. AC 13 - 23.03.2026 2.pdf",
"seap_cod": null,
"pagini": 4,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/7. Ctr_ATR_Conventie_Dornacor.pdf",
"seap_cod": null,
"pagini": 84,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/8.1. PT - 1.1 Schema tehnologica - Pl. 1.pdf",
"seap_cod": null,
"pagini": 1,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/8.2. PT -1.0 Schema tehnologica - total.pdf",
"seap_cod": null,
"pagini": 1,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/8.3. PT - 1.2 Schema tehnologica - Pl. 2.pdf",
"seap_cod": null,
"pagini": 1,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/8.5. Plan_Toposi PV_Chiselet.pdf",
"seap_cod": null,
"pagini": 9,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/F1_centralizator_pe_obiectiv 1.pdf",
"seap_cod": null,
"pagini": 2,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/F2_centralizator_pe_obiect_1_Infiintare_sistem_distributie_gaze_naturale_SpantovChiselet_si_Manastirea 1.pdf",
"seap_cod": null,
"pagini": 2,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/F2_centralizator_pe_obiect_2_Infiintare_sistem_distributie_gaze_naturale_Ulmeni_si_Oltenita 1.pdf",
"seap_cod": null,
"pagini": 2,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/deviz proiectant si centralizatoare-semnat.pdf",
"seap_cod": null,
"pagini": 10,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/8.4. 2026.01.15.- Retea 35620.dwg",
"seap_cod": null,
"pagini": null,
"citit": "deloc"
},
{
"nume_fisier": "documentatie SEAP/DUAE_CERERE_382225.xml",
"seap_cod": null,
"pagini": null,
"citit": "deloc"
},
{
"nume_fisier": "New folder/109_caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagini": 5,
"citit": "deloc"
},
{
"nume_fisier": "New folder/1_caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagini": 34,
"citit": "deloc"
},
{
"nume_fisier": "New folder/35_caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagini": 40,
"citit": "deloc"
},
{
"nume_fisier": "New folder/75_caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagini": 34,
"citit": "deloc"
}
],
"cerinte": [
{
"ref": "REQ-001",
"text": "Obiectivul contractului: execuție lucrări pentru „Înființare sistem de distribuție gaze naturale în comunele Mânăstirea, Chiselet, Spanțov, județul Călărași”, rețea nouă ~37.320 m, conductă de racord, SRMP.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 1,
"sectiune": "II.1.1",
"excerpt": "Lucrările includ realizarea unei rețele noi de distribuție a gazelor n"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-002",
"text": "Durata de Execuție este de maximum 36 de luni; perioada de garanție a lucrărilor este de 36 de luni de la punerea în funcțiune, distinctă de Durata de Execuție.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 2,
"sectiune": "II.1.4",
"excerpt": "Durata de Execuție este de maximum 36 de luni, calculată de la Data de"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-003",
"text": "Valoarea estimată a contractului este de 29.264.199,92 lei fără TVA; suma de 200.000 lei diverse și neprevăzute este evidențiată distinct și nu se ofertează.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 2,
"sectiune": "II.1.5",
"excerpt": "Valoarea estimată a contractului este de 29.264.199,92 lei fără TVA."
},
"incertitudine": "sigur"
},
{
"ref": "REQ-004",
"text": "Criteriul de atribuire este cel mai bun raport calitate-preț, cu factorul „Prețul ofertei” - pondere 65%, punctaj maxim 65.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "Formularul de ofertă",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 3,
"sectiune": "II.2.5",
"excerpt": "Pretul ofertei                         Componenta financiara          "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-005",
"text": "Formula de ajustare anuală a prețului: An = av + m×Mn/Mo + f×Fn/Fo + e×En/Eo, cu av=0, m=0,4721, f=0,3706, e=0,1573.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 7,
"sectiune": "II.3",
"excerpt": "– m = 0,4721 – ponderea estimată a materialelor;\n          – f = 0,370"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-006",
"text": "Motiv de excludere: ofertantul, asociatul, subcontractantul sau terțul susținător nu trebuie să fi încălcat obligațiile aplicabile în domeniul mediului (art. 167 alin. (1) lit. a) din Legea 98/2016).",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": "documente justificative la solicitarea AC pentru ofertantul clasat pe primul loc",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 7,
"sectiune": "III.1.1.a) Cerinta 1",
"excerpt": "Ofertantul unic/ofertantul asociat/subcontractantul/terțul susținător "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-007",
"text": "Motiv de excludere: faliment/insolvență, lichidare, supraveghere judiciară sau încetarea activității (art. 167 alin. (1) lit. b) din Legea 98/2016).",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": "certificat constatator ONRC sau documente echivalente",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 7,
"sectiune": "III.1.1.a) Cerinta 4",
"excerpt": "respectiv în procedura insolvenței sau în lichidare, în supraveghere j"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-008",
"text": "Persoanele cu funcții de decizie la AC (Iancu Marian-Mugurel, Silviu-Niki Gheorghescu, Mihail Penu, Narcis-Niculae Drăgnoi, Livia-Maria Camciuc, Ioan Camciuc) trebuie luate în calcul la verificarea conflictului de interese.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 9,
"sectiune": "III.1.1.a) Cerinta 12",
"excerpt": "Iancu Marian-Mugurel – primar al comunei Mânăstirea și președinte al A"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-009",
"text": "Operatorul economic care execută efectiv activitățile reglementate din domeniul gazelor naturale trebuie să deţină autorizația ANRE tip EDSB.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": "autorizația ANRE tip EDSB, valabilă la momentul prezentării",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 10,
"sectiune": "III.1.1.b) Cerinta 1",
"excerpt": "Operatorul economic care execută efectiv activitățile reglementate tre"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-010",
"text": "Contractul nu include servicii de proiectare; nu se solicită autorizația ANRE tip PDSB.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 10,
"sectiune": "III.1.1.b) Cerinta 1",
"excerpt": "Contractul nu include servicii de proiectare; în consecință, nu se sol"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-011",
"text": "Ofertantul trebuie să dovedească o formă de înregistrare legală în condiţiile legii din ţara de rezidenţă, cu capacitatea profesională de a realiza activitățile contractului.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": "certificatul constatator ONRC sau document echivalent",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 11,
"sectiune": "III.1.1.b) Cerinta 2",
"excerpt": "Operatorii economici care depun oferta trebuie sa dovedeasca o forma d"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-012",
"text": "Experiență similară: în ultimii 5 ani calculați până la data-limită de depunere a ofertelor, lucrări similare duse la bun sfârșit în valoare cumulată de minimum 29.000.000 lei fără TVA, la maximum 3 contracte.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "DUAE",
"document_probant": "certificate de bună execuție, procese-verbale de recepție, certificate constatatoare",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 11,
"sectiune": "III.1.3.a)",
"excerpt": "ofertantul trebuie să demonstreze că, în ultimii 5 ani calculați până "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-013",
"text": "Garanția de participare este de 292.641,99 lei, cu valabilitate cel puțin egală cu valabilitatea ofertei (4 luni de la data-limită de depunere).",
"tip": "forma",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "dovada constituirii garanției de participare (instrument de garantare/virament)",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 12,
"sectiune": "III.1.6.a)",
"excerpt": "Ofertantul va constitui garanția de participare în cuantum de 292.641,"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-014",
"text": "Garanția de bună execuție este de 10% din Prețul Contractului fără TVA, valabilă de la semnarea Contractului până la expirarea perioadei de garanție a lucrărilor.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 13,
"sectiune": "III.1.6.b)",
"excerpt": "Cuantumul garanției de bună execuție este de 10% din Prețul Contractul"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-015",
"text": "Nu se acordă avans; plățile se efectuează pentru lucrările executate, pe baza Situațiilor de Lucrări verificate de Supervizor și certificate prin Certificate de Plată.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 13,
"sectiune": "III.1.7",
"excerpt": "Nu se acordă avans. Plățile se efectuează pentru lucrările executate, "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-016",
"text": "Perioada minimă pe care ofertantul trebuie să își mențină oferta este de 4 luni de la termenul-limită de primire a ofertelor.",
"tip": "forma",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 14,
"sectiune": "IV.2.6",
"excerpt": "IV.2.6 Perioada minima pe parcursul careia ofertantul trebuie sa isi m"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-017",
"text": "Propunerea tehnică trebuie să respecte întocmai cerințele minime din Caietul de sarcini și Proiectul Tehnic, sub sancțiunea respingerii ofertei ca neconformă; se folosește Formularul nr. 8.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "Formularul nr. 8 - Propunere tehnică",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 14,
"sectiune": "IV.4.1",
"excerpt": "Ofertantul are obligația de a elabora și de a prezenta propunerea tehn"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-018",
"text": "Răspunsurile generice de tip „DA”/„NU”, „CONFORM” sau simpla copiere a caietului de sarcini, fără descrierea abordării proprii, nu demonstrează îndeplinirea cerințelor.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 15,
"sectiune": "IV.4.1",
"excerpt": "Răspunsurile generice de tip „DA”/„NU”, „CONFORM”, „SE VOR RESPECTA CE"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-019",
"text": "Termenul de garanție acordat lucrărilor nu poate fi mai mic de 36 de luni de la data punerii în funcțiune, dovedit prin Formularul nr. 5.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "Formularul nr. 5 - Declarație privind termenul de garanție acordat",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 16,
"sectiune": "IV.4.1",
"excerpt": "Termenul de garanție acordat lucrărilor executate nu poate fi mai mic "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-020",
"text": "Ofertele tehnice nesemnate cu semnătură electronică extinsă bazată pe certificat calificat vor fi declarate neconforme.",
"tip": "forma",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 16,
"sectiune": "IV.4.1",
"excerpt": "Ofertele tehnice nesemnate cu semnătură electronică extinsă, bazată pe"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-021",
"text": "Propunerea financiară se întocmește cu Formularul nr. 4, prețuri unitare pe baza listelor de cantități, și include F1, F2, F3, C6-C9, grafic valoric și curba S.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "Formularul nr. 4 și anexele (F1, F2, F3, C6-C9)",
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 17,
"sectiune": "IV.4.2",
"excerpt": "Formularul nr. 4 – Formular de ofertă, cu precizarea prețului total of"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-022",
"text": "Oferta financiară nu va cuprinde valoarea cheltuielilor diverse și neprevăzute (200.000 lei fără TVA din devizul general).",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 17,
"sectiune": "IV.4.2",
"excerpt": "Oferta financiară nu va cuprinde valoarea cheltuielilor diverse și nep"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-023",
"text": "Oferta și documentele care o însoțesc se transmit exclusiv prin SEAP; nu se acceptă transmiterea prin poștă, curier, e-mail sau depunere fizică.",
"tip": "forma",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 18,
"sectiune": "IV.4.3",
"excerpt": "Oferta și documentele care o însoțesc se transmit exclusiv prin SEAP, "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-024",
"text": "Lista documentelor care se prezintă odată cu oferta: DUAE, Formular 1, dovada garanției de participare, Formular 4, propunerea tehnică (Formular 8), propunerea financiară, Formular 5, 6, 7, 9, 10, împuternicire.",
"tip": "forma",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 19,
"sectiune": "IV.4.3",
"excerpt": "a. DUAE, completat în SEAP de ofertantul individual, fiecare membru al"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-025",
"text": "Necompletarea DUAE, a propunerii tehnice, a propunerii financiare criptate și a documentului privind garanția de participare până la data-limită atrage declararea ofertei ca inacceptabilă.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 19,
"sectiune": "IV.4.3",
"excerpt": "Necompletarea DUAE, a propunerii tehnice, a propunerii financiare crip"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-026",
"text": "Un operator economic poate depune o singură ofertă, individual sau ca membru al unei asocieri; nu este permisă participarea simultană individual și în asociere.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf",
"seap_cod": null,
"pagina": 20,
"sectiune": "IV.4.3",
"excerpt": "Un operator economic poate depune o singură ofertă, individual sau ca "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-027",
"text": "Nu se admit oferte parțiale din punct de vedere cantitativ și calitativ, ci numai oferte integrale care corespund tuturor cerințelor minime din Caietul de sarcini.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 3,
"sectiune": "1",
"excerpt": "Nu se admit ofertele parţiale din punct de vedere cantitativ şi calita"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-028",
"text": "Contractantul va asigura pe durata executării lucrărilor accesul la operatori/specialiști autorizați ANRE, ISCIR, ISC pentru activitățile reglementate; la depunere nu se solicită prezentarea autorizațiilor.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_solicitare",
"document_probant": "autorizații/atestări ANRE, ISCIR, ISC",
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 9,
"sectiune": "3.8",
"excerpt": "Contractantul va asigura, pe durata\nexecutării lucrărilor, accesul la "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-029",
"text": "Executantul va include în ofertă toate lucrările necesare execuției complete a sistemului conform Proiectului Tehnic; nu se acceptă decontări suplimentare pentru lucrări omise din oferta financiară.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 10,
"sectiune": "3.9",
"excerpt": "Executantulva include în ofertă toate lucrările necesare executării co"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-030",
"text": "Măsurătorile topografice trebuie realizate obligatoriu în sistem GIS, cu șanțul deschis, înainte de acoperirea conductei, cu receptoare GNSS.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": "documentație topografică GIS validată de Diriginte și Concesionar",
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 10,
"sectiune": "3.10",
"excerpt": "sa efectueze măsurătorile topografice in sistem GIS (Geographic Inform"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-031",
"text": "Adâncimea standard de pozare a conductei de distribuție gaze naturale este de 0,9 m măsurată de la generatoarea superioară, conform NTPEE 2018.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 10,
"sectiune": "3.10",
"excerpt": "Adâncimea standard de pozare a conductei de distributie gaze naturale,"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-032",
"text": "Descrierea lucrărilor include execuția rețelei de distribuție din conducte PEHD PE100 SDR11.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 14,
"sectiune": "4.4",
"excerpt": "execuţia reţelei de distribuţie gaze naturale din conducte PEHD PE100 "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-033",
"text": "Înainte de începerea săpăturii, Executantul trebuie să informeze Concesionarul, Dirigintele de șantier, AC și persoanele afectate, cu minimum 48 de ore înainte.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 34,
"sectiune": "4.5.1",
"excerpt": "Înainte de începerea lucrărilor de săpătură, Executantul are obligația"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-034",
"text": "În sistemul de distribuție se vor utiliza exclusiv țevi din PEHD PE100, SDR 11 și fitinguri compatibile.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "fișe tehnice materiale",
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 38,
"sectiune": "4.6.1.1",
"excerpt": "În sistemul de distribuţie se vor utiliza exclusiv:\ne  ţevidin PEHD PE"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-035",
"text": "Punctajul suplimentar aferent experienței profesionale se acordă exclusiv pentru Managerul de proiect, cu experiență specifică de minimum un proiect similar.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "documente-suport (recomandări, certificate/adeverințe, procese-verbale)",
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 65,
"sectiune": "4.11.1",
"excerpt": "Experienta specifică de minimum un proiect similar, dobândită într-o p"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-036",
"text": "Cerințe privind asigurările solicitate Contractantului: se aplică prevederile Clauzei 16 din Condițiile Generale (Anexa nr. 2 la HG nr. 1/2018) privind subcontractarea.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 109,
"sectiune": "12",
"excerpt": "Se vor respecta prevederile Contractului — Condiţii generale cu privir"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-037",
"text": "Orice necorelare, omisiune sau neconformitate a documentelor ofertei față de documentația de atribuire conduce la respingerea ofertei.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"seap_cod": null,
"pagina": 111,
"sectiune": "13",
"excerpt": "Orice necorelare, omisiune ori neconformitate constatata în privinţa d"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-038",
"text": "Factorul de evaluare „Preț” are pondere 65% și punctaj maxim 65 puncte (conform documentului Factorii de evaluare - detaliere).",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Factorii de evaluare - detaliere.pdf",
"seap_cod": null,
"pagina": 1,
"sectiune": null,
"excerpt": "1. factorul „Preț” are o pondere de 65% în totalul criteriului de atri"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-039",
"text": "Grila factorului „Gradul de adecvare al graficului general” prevede 5 subfactori, cu punctaj minim 7 și maxim 15 puncte, inclusiv reducerea duratei de execuție punctată doar până la 6 luni.",
"tip": "propunere",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/2.1.-Anexa 1- Factori de evaluare - detaliere.pdf",
"seap_cod": null,
"pagina": 4,
"sectiune": null,
"excerpt": "Orice durată de execuție propusă care\n                                "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-041",
"text": "Dacă nu este prezentat minim 1 proiect similar pentru fiecare expert cheie, oferta va fi considerată neconformă.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/2.1.-Anexa 1- Factori de evaluare - detaliere.pdf",
"seap_cod": null,
"pagina": 7,
"sectiune": null,
"excerpt": "d) In cazul in care nu este prezentat minim 1 proiect similar, oferta "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-042",
"text": "Durata de execuție consemnată în Acordul Contractual nu poate depăși 36 de luni, calculată de la Data de Începere stabilită prin Ordinul Administrativ de Începere.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 1, element q)",
"excerpt": "Durata de Execuție ofertată de Antreprenor în Propunerea Tehnică și co"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-043",
"text": "Suma reținută pentru întârzierea transmiterii Programului de Execuție este de 4000 lei pe zi (Clauza 17.6).",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 17.6",
"excerpt": "sumă reținută pentru întârzierea transmiterii Programului de Execuție\n"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-044",
"text": "Nu se acordă plată în avans; coeficientul av = 0 (Clauza 46.1).",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 46.1",
"excerpt": "nu se acordă avans; coeficientul av = 0"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-045",
"text": "Sumele Reținute din Certificatele de Plată reprezintă 10% din totalul sumelor de la subclauza 50.1, cu limita de 5% din Prețul Contractului la semnare.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 47.1",
"excerpt": "valoarea procentuală a Sumelor Reținute din Certificate de Plată\n10% d"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-046",
"text": "Perioada de Garanție este de 36 de luni de la punerea în funcțiune a rețelei.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 61.6",
"excerpt": "durata Perioadei de Garanție\n36 de luni de la punerea în funcțiune a r"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-047",
"text": "Înlocuirea personalului cheie al Antreprenorului fără respectarea subclauzelor 14.3/14.4 atrage o penalitate de 10.000 lei pe eveniment.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Acord_contractual_REMEDIAT_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 50.3",
"excerpt": "înlocuirea personalului cheie al Antreprenorului fără respectarea prev"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-048",
"text": "Antreprenorul nu elaborează, nu actualizează și nu verifică proiectul tehnic; execută lucrările pe baza documentației puse la dispoziție de Beneficiar.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/5_2_Conditii_specifice_HG1_REVIZUITE_ADI_Mostistea_Gaze_Sud.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 19.2",
"excerpt": "Antreprenorul nu elaborează, nu actualizează și nu verifică proiectul "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-049",
"text": "Dacă ritmul de execuție nu respectă Programul din motive imputabile Antreprenorului, acesta transmite Programul rectificativ și măsurile corective în cel mult 48 de ore de la notificarea Dirigintelui.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/5_2_Conditii_specifice_HG1_REVIZUITE_ADI_Mostistea_Gaze_Sud.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 17 / Program rectificativ",
"excerpt": "acesta transmite Programul rectificativ și măsurile corective/preventi"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-050",
"text": "În Perioada de Garanție de 36 de luni, Antreprenorul remediază pe cheltuiala sa viciile ascunse, defecțiunile imputabile execuției și degradările din neconformități de execuție.",
"tip": "contractuala",
"lot": null,
"cand_se_prezinta": "in_executie",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/5_2_Conditii_specifice_HG1_REVIZUITE_ADI_Mostistea_Gaze_Sud.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Clauza 61 / Perioada de Garanție",
"excerpt": "În această perioadă Antreprenorul remediază, pe cheltuiala sa, viciile"
},
"incertitudine": "sigur"
},
{
"ref": "REQ-051",
"text": "Fiecare ofertant trebuie să prezinte formularele solicitate: Scrisoare de înaintare, Instrument de garantare, Formular de ofertă, Declarație garanție, Acord de asociere/subcontractare, Propunere tehnică, Declarații.",
"tip": "forma",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": null,
"locator": {
"nume_fisier": "documentatie SEAP/Formulare_conf_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Opis formulare",
"excerpt": "Fiecare ofertant care participă, în mod individual sau ca asociat, la "
},
"incertitudine": "sigur"
},
{
"ref": "REQ-052",
"text": "Este interzisă subcontractarea totală a contractului.",
"tip": "eliminatorie",
"lot": null,
"cand_se_prezinta": "la_depunere",
"document_probant": "Formularul nr. 7 - Acord de subcontractare",
"locator": {
"nume_fisier": "documentatie SEAP/Formulare_conf_ANAP.docx",
"seap_cod": null,
"pagina": null,
"sectiune": "Formularul nr. 7",
"excerpt": "Este interzisă subcontractarea totală a contractului."
},
"incertitudine": "sigur"
}
],
"solicitari": [],
"erate": [
{
"fel": "documentatie",
"de_la": "factorul „Calificarea și experiență profesională a personalului desemnat...” are o pondere de 50% (max 50 puncte); prețul are pondere de 30% (max 30 puncte); nu apare factorul de mediu.",
"la": "factorul „Preț” are o pondere de 65% (max 65 puncte); „Măsuri suplimentare de protecție a mediului” are pondere de 10% (max 10 puncte); „Experiența profesională a Managerului de proiect” are pondere de 5% (max 5 puncte).",
"locator": {
"nume_fisier": "documentatie SEAP/Factorii de evaluare - detaliere.pdf",
"seap_cod": null,
"pagina": 1,
"excerpt": "1. factorul „Preț” are o pondere de 65% în totalul criteriului de atribuire, căruia îi corespunde un maximum\n      de 65 puncte"
},
"verificat": "pagina"
}
],
"participanti": [],
"nereusite": [
{
"nume_fisier": "documentatie SEAP/5_3_Conditii_generale_HG1_REVIZUITE_ADI_Mostistea_Gaze_Sud.docx",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/caiet de sarcini revizuit ANAP.pdf",
"motiv": "depasit buget",
"pagini": [
17,
18,
19,
20,
21
]
},
{
"nume_fisier": "documentatie SEAP/3.1 - PT - Partea scrisa 1.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/3.2 - Procedura Operationala Dornacor Invest.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/3.3 - Hotarare scan cu anexe 1.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/3.4 - Conventie Tehnica OE.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/3.5 - Aviz CTE Distrigaz Sud Retele.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/3.6 - Anexe ATRSolutie Alimentare.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/3.7 - ATR Distrigaz Sud Retele_ADI.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/5. hotarare scan cu anexe.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/6. AC 13 - 23.03.2026 2.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/7. Ctr_ATR_Conventie_Dornacor.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/8.1. PT - 1.1 Schema tehnologica - Pl. 1.pdf",
"motiv": "fara text (scanat)",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/8.2. PT -1.0 Schema tehnologica - total.pdf",
"motiv": "fara text (scanat)",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/8.3. PT - 1.2 Schema tehnologica - Pl. 2.pdf",
"motiv": "fara text (scanat)",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/8.5. Plan_Toposi PV_Chiselet.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/F1_centralizator_pe_obiectiv 1.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/F2_centralizator_pe_obiect_1_Infiintare_sistem_distributie_gaze_naturale_SpantovChiselet_si_Manastirea 1.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/F2_centralizator_pe_obiect_2_Infiintare_sistem_distributie_gaze_naturale_Ulmeni_si_Oltenita 1.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/deviz proiectant si centralizatoare-semnat.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/8.4. 2026.01.15.- Retea 35620.dwg",
"motiv": "format nesuportat",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/DUAE_CERERE_382225.xml",
"motiv": "format nesuportat",
"pagini": null
},
{
"nume_fisier": "New folder/109_caiet de sarcini revizuit ANAP.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "New folder/1_caiet de sarcini revizuit ANAP.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "New folder/35_caiet de sarcini revizuit ANAP.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "New folder/75_caiet de sarcini revizuit ANAP.pdf",
"motiv": "depasit buget",
"pagini": null
},
{
"nume_fisier": "documentatie SEAP/2.1.-Anexa 1- Factori de evaluare - detaliere.pdf",
"motiv": "cerință REQ-040 respinsă de validator: excerpt negăsit literal în text",
"pagini": [
8
]
}
],
"observatii_siguranta": [],
"extensii_propuse": [],
"validare": {
"la": "2026-09-23T15:21:03.536Z",
"cerinte_ok_pagina": 33,
"cerinte_ok_document": 18,
"cerinte_respinse": 1,
"probleme_schema": []
}
}$fx$::jsonb, NULL, 51, 27, 1)
  RETURNING id INTO pid;
  SELECT stare INTO t FROM public.ofertare_source_pack WHERE id=pid; r := r || jsonb_build_object('ID1_pack_real_id', pid, 'ID1_stare', t);
  -- ID2 identitate: pack cu licitatie_id 5 pe rând licitatie 3 → CHECK
  BEGIN
    INSERT INTO public.ofertare_source_pack (licitatie_id, pack_hash, pack) VALUES (3, repeat('a',64), jsonb_build_object('licitatie', jsonb_build_object('licitatie_id',5,'nr_anunt','DF1278266'),'cerinte','[]'::jsonb,'nereusite','[]'::jsonb,'documente','[]'::jsonb));
    r := r || jsonb_build_object('ID2_cross_tender_insert', 'A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('ID2_cross_tender_insert', 'refuzat: '||SQLERRM); END;
  -- ID2b nr_anunt diferit → import refuzat
  INSERT INTO public.ofertare_source_pack (licitatie_id, pack_hash, pack) VALUES (3, repeat('b',64), jsonb_build_object('licitatie', jsonb_build_object('licitatie_id',3,'nr_anunt','ALTCEVA'),'cerinte','[]'::jsonb,'nereusite','[]'::jsonb,'documente','[]'::jsonb)) RETURNING id INTO x;
  PERFORM set_config('request.jwt.claims', '{"sub":"43901570-047c-4fc7-9772-08c62ba119ed","role":"authenticated"}', true);
  BEGIN
    PERFORM public.fn_ofertare_source_pack_import(x, ARRAY['REQ-001']);
    r := r || jsonb_build_object('ID2b_nr_anunt_diferit', 'A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('ID2b_nr_anunt_diferit', 'refuzat: '||SQLERRM); END;

  -- SEC6 imutabilitate (ca postgres/service_role)
  BEGIN UPDATE public.ofertare_source_pack SET pack = pack || '{"x":1}' WHERE id=pid; r := r || jsonb_build_object('SEC6_update_pack','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC6_update_pack','refuzat: '||SQLERRM); END;
  BEGIN UPDATE public.ofertare_source_pack SET licitatie_id = 5 WHERE id=pid; r := r || jsonb_build_object('SEC6_update_licitatie','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC6_update_licitatie','refuzat: '||SQLERRM); END;
  BEGIN DELETE FROM public.ofertare_source_pack WHERE id=pid; r := r || jsonb_build_object('SEC6_delete_pack','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC6_delete_pack','refuzat: '||SQLERRM); END;
  UPDATE public.ofertare_source_pack SET nota = 'nota ok' WHERE id=pid; r := r || jsonb_build_object('SEC6_update_nota','ok');

  -- SEC2 RLS ca authenticated
  PERFORM set_config('request.jwt.claims', '{"sub":"62f42dc9-1b71-49c5-ae07-a56ef4a15dbf","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.ofertare_source_pack; r := r || jsonb_build_object('SEC2_fara_acces_vede', n);
  BEGIN INSERT INTO public.ofertare_source_pack (licitatie_id, pack_hash, pack) VALUES (3, repeat('c',64), '{"licitatie":{"licitatie_id":3}}'); r := r || jsonb_build_object('SEC2_auth_insert','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC2_auth_insert','refuzat: '||SQLERRM); END;
  BEGIN UPDATE public.ofertare_source_pack SET nota='hack' WHERE id=pid; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('SEC2_auth_update_rows', n);
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC2_auth_update_rows','refuzat: '||SQLERRM); END;
  PERFORM set_config('request.jwt.claims', '{"sub":"43901570-047c-4fc7-9772-08c62ba119ed","role":"authenticated"}', true);
  BEGIN INSERT INTO public.ofertare_cerinte (licitatie_id, text_cerinta, sursa_pack_id, sursa_ref) VALUES (3, 'fals', pid, 'REQ-999'); r := r || jsonb_build_object('SEC7_insert_direct_cu_pack','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC7_insert_direct_cu_pack','refuzat: '||SQLERRM); END;
  -- SEC7b: user authenticated CU acces Ofertare (responsabilul), încearcă sursa_pack_id direct, chiar cu vechiul GUC setat pe 'on' → BLOCAT
  PERFORM set_config('ofertare.import_pack', 'on', true);
  BEGIN INSERT INTO public.ofertare_cerinte (licitatie_id, text_cerinta, sursa_pack_id, sursa_ref) VALUES (3, 'fals cu guc', pid, 'REQ-998'); r := r || jsonb_build_object('SEC7b_cu_acces_si_guc_on','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC7b_cu_acces_si_guc_on','refuzat: '||SQLERRM); END;
  PERFORM set_config('ofertare.import_pack', '', true);
  -- SEC7c: același user, INSERT normal (fără pack) → merge ca înainte (fluxurile vechi neafectate)
  BEGIN INSERT INTO public.ofertare_cerinte (licitatie_id, text_cerinta) VALUES (3, 'cerinta manuala test') RETURNING id INTO x;
    r := r || jsonb_build_object('SEC7c_insert_normal_authenticated', 'ok id '||x);
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC7c_insert_normal_authenticated','EROARE: '||SQLERRM); END;
  -- SEC7d: service_role (sare peste RLS) încearcă sursa_pack_id direct → blocat de trigger (current_user ≠ owner)
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN INSERT INTO public.ofertare_cerinte (licitatie_id, text_cerinta, sursa_pack_id, sursa_ref) VALUES (3, 'fals service', pid, 'REQ-997'); r := r || jsonb_build_object('SEC7d_service_role_direct','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC7d_service_role_direct','refuzat: '||SQLERRM); END;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT jsonb_agg(policyname||'|'||permissive) INTO v FROM pg_policies WHERE tablename='ofertare_cerinte' AND cmd='INSERT'; r := r || jsonb_build_object('SEC7_policies_insert', v);
  SELECT count(*) INTO n FROM public.ofertare_source_pack; r := r || jsonb_build_object('SEC2_responsabil_vede', n);
  -- SEC4 import: fara sesiune / fara rol / responsabil
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN PERFORM public.fn_ofertare_source_pack_import(pid, ARRAY['REQ-001']); r := r || jsonb_build_object('SEC4_uid_null','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC4_uid_null','refuzat: '||SQLERRM); END;
  PERFORM set_config('request.jwt.claims', '{"sub":"62f42dc9-1b71-49c5-ae07-a56ef4a15dbf","role":"authenticated"}', true);
  BEGIN PERFORM public.fn_ofertare_source_pack_import(pid, ARRAY['REQ-001']); r := r || jsonb_build_object('SEC4_user_fara_rol','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC4_user_fara_rol','refuzat: '||SQLERRM); END;
  -- preview ca responsabil (STABLE, nu schimba starea)
  PERFORM set_config('request.jwt.claims', '{"sub":"43901570-047c-4fc7-9772-08c62ba119ed","role":"authenticated"}', true);
  SELECT jsonb_build_object('n', count(*), 'nemapate', count(*) FILTER (WHERE NOT importabil), 'cu_seamana', count(*) FILTER (WHERE seamana_cu_id IS NOT NULL),
    'mapare', (SELECT jsonb_object_agg(k, c) FROM (SELECT sursa_mapare k, count(*) c FROM public.fn_ofertare_source_pack_preview(pid) GROUP BY 1) q),
    'verificat', (SELECT jsonb_object_agg(coalesce(k,'NULL'), c) FROM (SELECT locator_verificat k, count(*) c FROM public.fn_ofertare_source_pack_preview(pid) GROUP BY 1) q))
  INTO v FROM public.fn_ofertare_source_pack_preview(pid);
  r := r || jsonb_build_object('MAP_preview_real', v);
  SELECT stare INTO t FROM public.ofertare_source_pack WHERE id=pid; r := r || jsonb_build_object('MAP_stare_dupa_preview', t);
  -- IMP1 import 51 ca responsabil
  SELECT jsonb_agg(ref) INTO v FROM (SELECT (jsonb_array_elements(pack->'cerinte')->>'ref') ref FROM public.ofertare_source_pack WHERE id=pid) q;
  SELECT public.fn_ofertare_source_pack_import(pid, (SELECT array_agg(e) FROM jsonb_array_elements_text(v) e)) INTO res;
  r := r || jsonb_build_object('IMP1_rezultat', res - 'inserate' || jsonb_build_object('nr_inserate', jsonb_array_length(res->'inserate')));
  SELECT jsonb_build_object('conf_null', count(*) FILTER (WHERE confirmata_de IS NULL), 'extras_ai', count(*) FILTER (WHERE extras_de_ai), 'pasaj_verificat_true', count(*) FILTER (WHERE pasaj_verificat),
     'cand', (SELECT jsonb_object_agg(coalesce(k,'NULL'),c) FROM (SELECT cand_se_prezinta k, count(*) c FROM public.ofertare_cerinte WHERE sursa_pack_id=pid GROUP BY 1) q),
     'tip', (SELECT jsonb_object_agg(k,c) FROM (SELECT tip k, count(*) c FROM public.ofertare_cerinte WHERE sursa_pack_id=pid GROUP BY 1) q),
     'locator', (SELECT jsonb_object_agg(coalesce(k,'NULL'),c) FROM (SELECT locator_verificat k, count(*) c FROM public.ofertare_cerinte WHERE sursa_pack_id=pid GROUP BY 1) q),
     'mapare', (SELECT jsonb_object_agg(k,c) FROM (SELECT sursa_mapare k, count(*) c FROM public.ofertare_cerinte WHERE sursa_pack_id=pid GROUP BY 1) q),
     'min_ordine', min(nr_ordine), 'max_ordine', max(nr_ordine), 'stare', (SELECT jsonb_object_agg(k,c) FROM (SELECT stare k, count(*) c FROM public.ofertare_cerinte WHERE sursa_pack_id=pid GROUP BY 1) q))
  INTO v FROM public.ofertare_cerinte WHERE sursa_pack_id=pid;
  r := r || jsonb_build_object('IMP1_randuri', v);
  SELECT nr_cerinte INTO n FROM public.v_ofertare_dashboard WHERE id=3; r := r || jsonb_build_object('IMP_dashboard_lic3_dupa', n);
  SELECT stare INTO t FROM public.ofertare_source_pack WHERE id=pid; r := r || jsonb_build_object('IMP1_stare_pack', t);
  -- IMP2 re-import
  SELECT jsonb_agg(ref) INTO v FROM (SELECT (jsonb_array_elements(pack->'cerinte')->>'ref') ref FROM public.ofertare_source_pack WHERE id=pid) q;
  SELECT public.fn_ofertare_source_pack_import(pid, (SELECT array_agg(e) FROM jsonb_array_elements_text(v) e)) INTO res2;
  r := r || jsonb_build_object('IMP2_reimport', jsonb_build_object('nr_inserate', jsonb_array_length(res2->'inserate'), 'nr_sarite', jsonb_array_length(res2->'sarite'), 'stare', res2->>'stare'));
  SELECT count(*) INTO n FROM public.ofertare_source_pack_importuri WHERE pack_id=pid; r := r || jsonb_build_object('IMP_istoric_randuri', n);
  BEGIN UPDATE public.ofertare_source_pack_importuri SET sarite='{}' WHERE pack_id=pid; r := r || jsonb_build_object('SEC6_istoric_update','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC6_istoric_update','refuzat: '||SQLERRM); END;
  -- SEC5 trigger provenienta (ca postgres, claims = responsabil)
  EXECUTE 'RESET ROLE';
  SELECT id INTO x FROM public.ofertare_cerinte WHERE sursa_pack_id=pid ORDER BY id LIMIT 1;
  BEGIN UPDATE public.ofertare_cerinte SET sursa_pasaj='altceva' WHERE id=x; r := r || jsonb_build_object('SEC5_update_pasaj','A TRECUT (RAU)');
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC5_update_pasaj','refuzat: '||SQLERRM); END;
  BEGIN UPDATE public.ofertare_cerinte SET text_cerinta = text_cerinta || ' (editat)' WHERE id=x;
  SELECT jsonb_build_object('editat_la_set', text_editat_la IS NOT NULL, 'editat_de', text_editat_de) INTO v FROM public.ofertare_cerinte WHERE id=x; r := r || jsonb_build_object('SEC5_update_text', v);
  EXCEPTION WHEN OTHERS THEN r := r || jsonb_build_object('SEC5_update_text','EROARE: '||SQLERRM); END;
  SELECT id INTO x FROM public.ofertare_cerinte WHERE licitatie_id=3 AND sursa_pack_id IS NULL ORDER BY id LIMIT 1;
  UPDATE public.ofertare_cerinte SET sursa_pasaj = sursa_pasaj WHERE id=x; r := r || jsonb_build_object('SEC5_rand_vechi_update','ok');
  -- IMP3 sintetic: refuzat + nemapat + partial + similaritate
  EXECUTE 'RESET ROLE';
  INSERT INTO public.ofertare_source_pack (licitatie_id, pack_hash, pack, nr_cerinte) VALUES (3, '98d77d3d44d3d7d9b52d782169dd4dd89da44c0741f9e01764c42530d4ca394e', $sy${"schema":"gazpet.source_pack/v1","licitatie":{"licitatie_id":3,"nr_anunt":"DF1278266"},"reader":{"model":"test","scop":"documentatie"},"documente":[{"nume_fisier":"documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf","seap_cod":null,"pagini":23,"citit":"integral","sursa":"seap"}],"cerinte":[{"ref":"REQ-001","text":"Ofertantul trebuie să dovedească o formă de înregistrare legală în condițiile legii din țara de rezidență.","tip":"eliminatorie","lot":null,"cand_se_prezinta":"DUAE","document_probant":"ONRC","locator":{"nume_fisier":"documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf","seap_cod":null,"pagina":11,"sectiune":"III.1.1.b","excerpt":"Operatorii economici care depun oferta trebuie sa dovedeasca o forma de inregistrare","verificat":"pagina"},"incertitudine":"sigur"},{"ref":"REQ-002","text":"Text sintetic fără corespondent în registru: zebra galactică pe motocicletă.","tip":"contractuala","lot":null,"cand_se_prezinta":"in_executie","document_probant":null,"locator":{"nume_fisier":"documentatie SEAP/Instructiuni_ofertanti_FisaDate_DF1278266.pdf","seap_cod":null,"pagina":9,"pagina_declarata":7,"pagina_validata":9,"sectiune":"x","excerpt":"excerpt gasit in document nu pe pagina declarata","verificat":"document"},"incertitudine":"probabil"},{"ref":"REQ-003","text":"Cerință dintr-un fișier care nu există în ERP.","tip":"forma","lot":null,"cand_se_prezinta":"la_solicitare","document_probant":null,"locator":{"nume_fisier":"documentatie SEAP/fisier_inexistent_xyz.pdf","seap_cod":null,"pagina":1,"sectiune":null,"excerpt":"un excerpt oarecare de peste douazeci de caractere"},"incertitudine":"neclar"}],"solicitari":[],"erate":[],"participanti":[],"nereusite":[],"observatii_siguranta":[],"extensii_propuse":[],"validare":{"cerinte_ok_pagina":1,"cerinte_ok_document":1,"cerinte_respinse":0,"probleme_schema":[]}}$sy$::jsonb, 3) RETURNING id INTO sid;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT jsonb_agg(jsonb_build_object('ref',ref,'importabil',importabil,'mapare',sursa_mapare,'verificat',locator_verificat,'pagina',pagina,'pag_decl',pagina_declarata,'cand',cand_se_prezinta,'seamana',seamana_cu_id,'sim',seamana_cu_similarity)) INTO v FROM public.fn_ofertare_source_pack_preview(sid);
  r := r || jsonb_build_object('SIM_preview_sintetic', v);
  SELECT extensions.similarity(text_cerinta, 'Ofertantul trebuie să dovedească o formă de înregistrare legală în condițiile legii din țara de rezidență.') INTO f FROM public.ofertare_cerinte WHERE id = (SELECT seamana_cu_id FROM public.fn_ofertare_source_pack_preview(sid) WHERE ref='REQ-001');
  r := r || jsonb_build_object('SIM_similarity_direct', f);
  SELECT count(*) INTO n FROM public.fn_ofertare_source_pack_preview(sid, 0.99) WHERE seamana_cu_id IS NOT NULL; r := r || jsonb_build_object('SIM_prag_099_potriviri', n);
  SELECT public.fn_ofertare_source_pack_import(sid, ARRAY['REQ-001','REQ-003','REQ-NU-EXISTA']) INTO res;
  r := r || jsonb_build_object('IMP3_partial', res - 'inserate' || jsonb_build_object('nr_inserate', jsonb_array_length(res->'inserate')));
  SELECT public.fn_ofertare_source_pack_import(sid, ARRAY['REQ-002']) INTO res;
  r := r || jsonb_build_object('IMP3b_completare_asteptat_importat_partial', res - 'inserate' || jsonb_build_object('nr_inserate', jsonb_array_length(res->'inserate')));
  SELECT jsonb_agg(jsonb_build_object('ref',sursa_ref,'cand',cand_se_prezinta,'loc',locator_verificat,'pag',sursa_pagina,'pag_decl',pagina_declarata,'pasaj_v',pasaj_verificat,'incert',incertitudine)) INTO v FROM public.ofertare_cerinte WHERE sursa_pack_id=sid; r := r || jsonb_build_object('IMP3_randuri', v);
  SELECT count(*) INTO n FROM public.ofertare_source_pack_importuri WHERE pack_id=sid; r := r || jsonb_build_object('IMP3_istoric', n);
  -- nereusite view
  SELECT count(*), count(document_id) INTO n, n2 FROM public.v_ofertare_source_pack_nereusite WHERE pack_id=pid; r := r || jsonb_build_object('NER_view_randuri', n, 'NER_view_mapate', n2);
  -- ROLLBACK demonstrat: DELETE pe inserate
  EXECUTE 'RESET ROLE';
  DELETE FROM public.ofertare_cerinte WHERE licitatie_id=3 AND sursa_pack_id IS NULL AND text_cerinta='cerinta manuala test';
  DELETE FROM public.ofertare_cerinte WHERE id = ANY (SELECT jsonb_array_elements_text(inserate)::bigint FROM (SELECT jsonb_agg(i) inserate FROM (SELECT unnest(inserate) i FROM public.ofertare_source_pack_importuri) q) z);
  SELECT count(*) INTO c1 FROM public.ofertare_cerinte; r := r || jsonb_build_object('RB_cerinte_total_dupa_delete', c1, 'RB_egal_baseline', c1 = c0);
  RAISE EXCEPTION 'P0A_DRYRUN %', r::text;
END $do$;
