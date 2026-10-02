-- ════════════════════════════════════════════════════════════════════════════
-- 20261006b_sec_garantii_iban_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT starea
-- live din 01.10: SELECT pe tot tabelul garantii pentru anon/authenticated, view-ul și RPC-ul cu g.iban direct, fără
-- fn_garantie_iban. REDESCHIDE expunerea IBAN pentru orice cont logat. Fără GO de execuție: doar la cererea explicită a lui
-- Răzvan, după decizie + review Copilot. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261006b', 'REDESCHIDE_IBAN_GARANTII:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261006b', true) IS DISTINCT FROM 'REDESCHIDE_IBAN_GARANTII:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261006b: nearmată (gazpet.rollback_tehnic_20261006b legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261006b=%') THEN
    RAISE EXCEPTION 'Revenire 20261006b: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF to_regprocedure('public.fn_garantie_iban(bigint)') IS NULL OR has_column_privilege('authenticated', 'public.garantii', 'iban', 'SELECT') THEN
    RAISE EXCEPTION 'Revenire 20261006b: precondiție — starea nu e cea a patch-ului (fn_garantie_iban lipsește sau iban e deja citibil)';
  END IF;
END $arm$;

CREATE OR REPLACE VIEW public.v_garantii_situatie WITH (security_invoker = on) AS
 SELECT id,
    forma,
    tip,
    beneficiar,
    contract_numar,
    contract_data,
    lucrare,
    proiect_id,
    licitatie_id,
    valoare,
    moneda,
    procent,
    trezorerie_cont_id,
    iban,
    banca,
    emitent,
    numar_document,
    data_emitere,
    data_expirare,
    stare,
    lucrare_receptionata,
    data_receptie,
    document_receptie,
    data_eliberare,
    eliberare_solicitata_la,
    sursa_document,
    observatii,
    created_at,
    updated_at,
    (data_expirare - CURRENT_DATE) AS zile_pana_expirare,
        CASE
            WHEN (stare <> 'activa'::text) THEN NULL::text
            WHEN (lucrare_receptionata AND (eliberare_solicitata_la IS NULL)) THEN 'Lucrare receptionata - se poate cere eliberarea'::text
            WHEN ((data_expirare IS NOT NULL) AND (data_expirare < CURRENT_DATE) AND (NOT lucrare_receptionata)) THEN 'EXPIRATA dar lucrarea nu e receptionata - risc de garantie neacoperita'::text
            WHEN ((data_expirare IS NOT NULL) AND ((data_expirare - CURRENT_DATE) <= 30)) THEN 'Expira in sub 30 de zile'::text
            WHEN ((data_expirare IS NOT NULL) AND ((data_expirare - CURRENT_DATE) <= 60)) THEN 'Expira in sub 60 de zile'::text
            WHEN (eliberare_solicitata_la IS NOT NULL) THEN ('Eliberare ceruta la '::text || eliberare_solicitata_la)
            ELSE NULL::text
        END AS de_facut
   FROM public.garantii g;

CREATE OR REPLACE FUNCTION public.garantii_adresa_eliberare(p_id bigint)
 RETURNS TABLE(destinatar text, subiect text, corp text, avertisment text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    coalesce(g.emitent, g.banca, 'Trezoreria Municipiului Ploiesti'),
    'Solicitare eliberare garantie de buna executie – contract nr. ' ||
      coalesce(g.contract_numar, '___') || ' – ' || coalesce(g.lucrare, g.beneficiar),
    CASE WHEN g.blocat_litigiu THEN
      '⛔ Garantia e blocata de un litigiu in curs cu ' || g.beneficiar || '.' || E'\n\n' ||
      coalesce(g.litigiu_detalii || E'\n\n', '') ||
      'Nu se genereaza adresa de eliberare cat timp litigiul e deschis. ' ||
      'Daca litigiul s-a incheiat, scoate bifa de litigiu din fisa garantiei si genereaza adresa din nou.'
    ELSE
      'Catre, ' || coalesce(g.emitent, g.banca, 'Trezoreria Municipiului Ploiesti') || E'\n\n' ||
      'Subscrisa GAZPET INSTAL SRL, CUI RO22029920, cu sediul in Ploiesti, str. Fluturilor nr. 34, ' ||
      'jud. Prahova, reprezentata prin Trusu Razvan Mihail in calitate de administrator,' || E'\n\n' ||
      'Referitor la ' ||
        CASE g.forma
          WHEN 'polita_asigurare' THEN 'polita de asigurare pentru garantia de buna executie nr. ' || coalesce(g.numar_document,'___')
          WHEN 'scrisoare_bancara' THEN 'scrisoarea de garantie bancara nr. ' || coalesce(g.numar_document,'___')
          WHEN 'depozit_bancar' THEN 'depozitul pentru garantii de buna executie, cont ' || coalesce(g.iban,'___')
          ELSE 'contul de disponibil din sume reprezentand garantie de buna executie ' || coalesce(g.iban,'___')
        END ||
        coalesce(', constituit(a) la data de ' || to_char(g.data_emitere, 'DD.MM.YYYY'), '') ||
        coalesce(' cu scadenta ' || to_char(g.data_expirare, 'DD.MM.YYYY'), '') ||
        ', in favoarea ' || g.beneficiar ||
        ', pentru contractul nr. ' || coalesce(g.contract_numar,'___') ||
        coalesce('/' || to_char(g.contract_data, 'DD.MM.YYYY'), '') ||
        coalesce(' – „' || g.lucrare || '”', '') || ',' || E'\n\n' ||
      'va aducem la cunostinta ca lucrarile au fost receptionate' ||
        coalesce(' prin ' || g.document_receptie, '') ||
        coalesce(' din data de ' || to_char(g.data_receptie, 'DD.MM.YYYY'), '') ||
        ', iar obligatiile contractuale au fost indeplinite integral.' || E'\n\n' ||
      'Prin prezenta va solicitam eliberarea garantiei' ||
        coalesce(' in valoare de ' ||
          translate(trim(to_char(g.valoare, 'FM999,999,999.00')), ',.', '.,') || ' ' || g.moneda, '') ||
        ' si diminuarea corespunzatoare a expunerii inregistrate pe numele societatii noastre.' || E'\n\n' ||
      'Anexam documentele justificative.' || E'\n\n' ||
      'Cu stima,' || E'\n' ||
      'GAZPET INSTAL SRL' || E'\n' ||
      'Trusu Razvan Mihail, Administrator'
    END,
    CASE
      WHEN g.blocat_litigiu
        THEN 'BLOCAT DE LITIGIU — nu trimite nimic pana nu se lamureste.'
      WHEN NOT g.lucrare_receptionata AND g.data_receptie IS NOT NULL
        THEN 'Receptia e documentata (' || coalesce(g.document_receptie,'PV gasit') ||
             ') dar nu e inca bifata in fisa. Bifeaza „Receptie" inainte de a trimite.'
      WHEN NOT g.lucrare_receptionata
        THEN 'ATENTIE: lucrarea NU e marcata ca receptionata si nu avem niciun PV. Expirarea nu inseamna eliberare - cererea va fi respinsa.'
      WHEN g.document_receptie IS NULL
        THEN 'Lucrarea e marcata receptionata dar nu e trecut documentul de receptie (PVR/PVRTL). Completeaza-l inainte de a trimite.'
      WHEN g.document_receptie ILIKE '%PVRTL%' OR g.document_receptie ILIKE '%terminarea lucrarilor%'
        THEN 'Receptia e la TERMINAREA lucrarilor, nu finala - de regula se elibereaza doar 70%. Verifica ce procent ceri.'
      WHEN g.stare <> 'activa'
        THEN 'Garantia nu mai e activa (stare: ' || g.stare || '). Verifica daca adresa mai are rost.'
      ELSE NULL
    END
  FROM public.garantii g WHERE g.id = p_id;
$function$;

DROP FUNCTION public.fn_garantie_iban(bigint);
REVOKE SELECT (id, forma, tip, beneficiar, contract_numar, contract_data, lucrare, proiect_id, licitatie_id, valoare, moneda, procent, trezorerie_cont_id, banca, emitent, numar_document, data_emitere, data_expirare, stare, lucrare_receptionata, data_receptie, document_receptie, data_eliberare, eliberare_solicitata_la, sursa_document, observatii, created_at, updated_at, contract_terti_id, gbe_polita_id, blocat_litigiu, litigiu_detalii) ON public.garantii FROM anon, authenticated;
GRANT SELECT ON public.garantii TO anon, authenticated;

DO $post$
BEGIN
  IF md5(pg_get_viewdef('public.v_garantii_situatie'::regclass)) IS DISTINCT FROM 'e0457893f4071bd3a63d247454c84fee'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.garantii_adresa_eliberare(bigint)'::regprocedure) IS DISTINCT FROM '3645ed09558cf2b347f5822cd4c76da4'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.garantii'::regclass AND attacl IS NOT NULL)
     OR NOT has_table_privilege('authenticated', 'public.garantii', 'SELECT') OR NOT has_table_privilege('anon', 'public.garantii', 'SELECT') THEN
    RAISE EXCEPTION 'Revenire 20261006b: postcondiție — starea nu e cea live din 01.10 (view e0457893…, RPC 3645ed09…, SELECT pe tabel, fără ACL pe coloane)';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261006b', '', true);
END $post$;
