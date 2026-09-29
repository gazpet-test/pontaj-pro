// Mutanți pentru suita J04×J07: implementări STRICATE intenționat, aplicate după migrări (doar în baza locală de test).
// Suita trebuie să PICE pe fiecare („mutant ucis”) — altfel testele n-ar demonstra că ambele porți sunt obligatorii și
// independente. Rulare: bash scripts/test_j04xj07.sh --mutanti   (sau JX_MUTANT=<nume> node scripts/pg/test_j04xj07.mjs)
// Fiecare mutant e un DO care rescrie o funcție reală prin înlocuire textuală și REFUZĂ dacă ancora lipsește
// (altfel un mutant „fără efect” ar părea ucis din alt motiv).
const rescrie = (functie, din, in_, flag = '') => `DO $m$ DECLARE d text := pg_get_functiondef('${functie}'::regprocedure); n text;
BEGIN
  n := regexp_replace(d, ${q(din)}, ${q(in_)}${flag ? `, ${q(flag)}` : ''});
  IF n = d THEN RAISE EXCEPTION 'mutant: ancora lipsește în ${functie}'; END IF;
  EXECUTE n;
END $m$;`
function q(s) { return "'" + String(s).replaceAll("'", "''") + "'" }

export const MUTANTI = {
  // J04 dispare: triggerul depus revine la R11 (doar prezența rolurilor depus_final/dovada_seap).
  fara_j04: rescrie('public.fn_pt_pachet_depus_verifica()', 'FOR v_f IN .*END LOOP;', '', 's'),
  // J07 dispare din tranziția pachetului (rămâne doar R5 + completitudine SEAP).
  fara_j07: rescrie('public.fn_ofertare_pt_pachet_poarta_documentatie()', '-- J07 BEGIN.*-- J07 END', '', 's'),
  // „Implementare care verifică doar unul”: agregatorul evaluează numai controlul cuprins.
  j07_doar_cuprins: rescrie('public.ofertare_poarta_server(bigint)', 'controale:=jsonb_build_array\\(.*?\\);',
    'controale:=jsonb_build_array(public.ofertare_ctl_cuprins(p_licitatie_id));', 's'),
  // Agregatorul fără cele 4 controale text (J07 doar SQL).
  j07_fara_text: rescrie('public.ofertare_poarta_server(bigint)',
    'public\\.ofertare_ctl_garantie\\(p_licitatie_id\\),\\s*public\\.ofertare_ctl_text\\(p_licitatie_id,\'anexe\'\\),public\\.ofertare_ctl_text\\(p_licitatie_id,\'numere\'\\),public\\.ofertare_ctl_text\\(p_licitatie_id,\'pachet\'\\),',
    ''),
  // Fără verificarea „pachetul curent” (pachet_versiune).
  fara_pachet_versiune: rescrie('public.ofertare_poarta_impune(bigint,bigint)', 'IF p_pachet_id IS NOT NULL AND p_pachet_id IS DISTINCT FROM ultim THEN', 'IF false THEN'),
  // J04 acceptă orice PASS cu SHA-ul manifestului, fără identitatea obiectului (id / updated_at / eTag / size).
  j04_fara_identitate: rescrie('public.fn_pt_pachet_depus_verifica()',
    'AND v\\.obj_id = o\\.id AND v\\.obj_updated_at = o\\.updated_at\\s*AND v\\.obj_etag IS NOT DISTINCT FROM \\(o\\.metadata->>\'eTag\'\\)\\s*AND v\\.obj_size > 0 AND v\\.obj_size = v_size', '', 's'),
  // J04 fără blocarea obiectelor până la COMMIT (FOR SHARE).
  j04_fara_lock: rescrie('public.fn_pt_pachet_depus_verifica()', 'FOR SHARE;', ';'),
  // J07 ignoră parser_version (rezultatele vechi rămân valabile după upgrade).
  j07_ignora_parser: rescrie('public.ofertare_ctl_text(bigint,text)', "AND t\\.parser_version=src->>'parser_version' ", ''),
  // J07 ia PRIMUL rezultat pe hash, nu ultimul.
  j07_primul_rezultat: rescrie('public.ofertare_ctl_text(bigint,text)', 'ORDER BY t\\.id DESC', 'ORDER BY t.id ASC'),
  // J07 legat doar de licitație + control, nu și de hash-ul sursei (verdict stale acceptat).
  j07_fara_hash: rescrie('public.ofertare_ctl_text(bigint,text)', "AND t\\.sursa_hash=src->>'sursa_hash'", ''),
  // Agregatorul tratează „undetermined” ca „ok” (blochează doar pe „block”): eroarea/lipsa rezultatului ar trece.
  j07_undetermined_ok: rescrie('public.ofertare_poarta_server(bigint)', "WHERE c->>'stare'<>'ok'", "WHERE c->>'stare'='block'"),
  // J07 impus doar la aprobare, nu și la depunere (verdictul de la aprobare ar ajunge).
  j07_doar_la_aprobare: rescrie('public.fn_ofertare_pt_pachet_poarta_documentatie()', "IF NEW\\.stare IN \\('aprobat','depus'\\)", "IF NEW.stare IN ('aprobat')"),
  // J04 cere dovadă doar pentru fișierele depus_final (propunerea, borderoul și dovada SEAP scapă).
  j04_doar_depus_final: rescrie('public.fn_pt_fisier_cere_verificare(text)',
    "p_rol IN \\('propunere_docx','borderou_docx','depus_final','dovada_seap'\\)", "p_rol IN ('depus_final')"),
}
