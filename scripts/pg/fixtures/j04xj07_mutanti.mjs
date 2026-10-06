// Mutanți pentru suita J04×J07: implementări STRICATE intenționat. Suita trebuie să PICE pe fiecare („mutant ucis”) —
// altfel testele n-ar demonstra că ambele porți sunt obligatorii și independente. Excepție: controlul negativ M00_noop
// (fără efect) TREBUIE să supraviețuiască — dovada că detectorul nu dă ucideri false.
//
// Rulare: node scripts/pg/test_j04xj07_mutanti.mjs  (toți, în paralel)  ·  bash scripts/test_j04xj07.sh --mutanti
//         JX_MUTANT=<nume> node scripts/pg/test_j04xj07.mjs  (unul singur)
//
// Două feluri:
//   * MUTANTI (SQL): un DO care rescrie implementarea REALĂ din baza locală de test (funcție / trigger / politică / grant),
//     aplicat după starea de bază; REFUZĂ dacă ancora lipsește sau efectul nu se vede în catalog — altfel un mutant
//     neaplicat ar părea „ucis” din alt motiv.
//   * MUTANTI_EDGE: înlocuiri textuale pe o COPIE temporară a edge-urilor (supabase/functions), încărcată de runner în
//     locul celei reale după starea de bază; runner-ul refuză copia dacă ancora lipsește. Suita rulează handler-ele
//     reale (index.ts / handler.ts), deci și codul de legătură al edge-urilor e sub test, nu doar evaluatorul.
//
// Catalogul M1…M19 vine din verificarea prin mutații din 29.09 (cerințele Copilot plan A §2); X* = mutații
// suplimentare găsite la verificare. Cele 13 nume vechi (fara_j04, fara_j07, j07_*, j04_*, fara_pachet_versiune) sunt
// păstrate; echivalențele cu M* sunt notate lângă fiecare (M01a = fara_j04, M02a = fara_j07, M02d = j07_doar_la_aprobare,
// M16d = j07_undetermined_ok, M17a = j07_ignora_parser — dublurile exacte NU se rulează de două ori).
// Tabelul mutant → teste care îl prind: docs/AUDIT_OFERTARE_V2/J04xJ07_INTEGRARE_TESTE.md.

function q(s) { return "'" + String(s).replaceAll("'", "''") + "'" }
const rescrie = (functie, din, in_, flag = '') => `DO $m$ DECLARE d text := pg_get_functiondef('${functie}'::regprocedure); n text;
BEGIN
  n := regexp_replace(d, ${q(din)}, ${q(in_)}${flag ? `, ${q(flag)}` : ''});
  IF n = d THEN RAISE EXCEPTION 'mutant: ancora lipsește în ${functie}'; END IF;
  EXECUTE n;
END $m$;`
const asigura = (cond, mesaj) => `DO $v$ BEGIN IF NOT (${cond}) THEN RAISE EXCEPTION 'mutant neaplicat: %', ${q(mesaj)}; END IF; END $v$;`
const OK = cod => `public.ofertare_poarta_rezultat('${cod}','ok','MUTANT: control dezactivat')`
// Scurtcircuit la începutul corpului PL/pgSQL: controlul întoarce mereu ok.
const scurt = (functie, cod) => rescrie(functie, '\\nBEGIN\\n', `\nBEGIN\n  RETURN ${OK(cod)};\n`)
// Controale SQL „contor” (funcții LANGUAGE sql): corpul devine un ok constant.
const contorOk = (functie, cod) => rescrie(functie, 'SELECT public\\.ofertare_ctl_contor\\([^)]*\\)', `SELECT ${OK(cod)}`)
// Controalele text anexe/numere/pachet trec prin ofertare_ctl_text: doar codul dat devine ok.
const textOk = cod => rescrie('public.ofertare_ctl_text(bigint,text)', '\\nBEGIN\\n', `\nBEGIN\n  IF p_control='${cod}' THEN RETURN ${OK(cod)}; END IF;\n`)
// Trigger append-only recreat doar pentru operațiile date (restul scapă).
const triggerFara = (tabel, trig, fn, ops) => `DROP TRIGGER ${trig} ON public.${tabel};
CREATE TRIGGER ${trig} BEFORE ${ops} ON public.${tabel} FOR EACH STATEMENT EXECUTE FUNCTION public.${fn}();
${asigura(`(SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='${trig}') = 'CREATE TRIGGER ${trig} BEFORE ${ops} ON public.${tabel} FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()'`, trig)}`
const J04_VERIF = ['ofertare_pt_pachet_verificari', 'trg_pt_verificari_imuabile', 'fn_pt_verificari_imuabile']
const J07_REZ = ['ofertare_poarta_rezultate_text', 'trg_poarta_text_imuabil', 'fn_ofertare_poarta_text_imuabil']
// Cele 5 controale SQL cu handler de excepție propriu (ofertare_ctl_contor acoperă cuprins/neverificate/capcane/goale/nescrise).
const CTL_SQL = {
  contor: 'public.ofertare_ctl_contor(bigint,text,text,boolean)',
  cantitati_f3_grafic: 'public.ofertare_ctl_cantitati_f3_grafic(bigint)',
  garantie: 'public.ofertare_ctl_garantie(bigint)',
  grafic_sursa: 'public.ofertare_ctl_grafic_sursa(bigint)',
  grafic_relatii: 'public.ofertare_ctl_grafic_relatii(bigint)',
}
// M16b: EXCEPTION WHEN OTHERS → ok (în loc de undetermined).
const eroareOk = f => rescrie(f, "EXCEPTION WHEN OTHERS THEN RETURN public\\.ofertare_poarta_rezultat\\(([^,]+),'undetermined'",
  "EXCEPTION WHEN OTHERS THEN RETURN public.ofertare_poarta_rezultat(\\1,'ok'")
// M16c: calea „date indisponibile” (fără excepție) → ok.
const INDISPONIBIL = {
  contor: ["'undetermined','Contor indisponibil: '", "'ok','Contor indisponibil: '"],
  cantitati_f3_grafic: ["\\('cantitati_f3_grafic','undetermined','Comparația F3", "('cantitati_f3_grafic','ok','Comparația F3"],
  garantie: ["\\('garantie','undetermined','Garanția structurată", "('garantie','ok','Garanția structurată"],
  grafic_sursa: ["\\('grafic_sursa','undetermined','Sursa graficului", "('grafic_sursa','ok','Sursa graficului"],
  grafic_relatii: ["\\('grafic_relatii','undetermined','Datele graficului", "('grafic_relatii','ok','Datele graficului"],
}
const indisponibilOk = k => rescrie(CTL_SQL[k], ...INDISPONIBIL[k])

export const CONTROL_NEGATIV = 'M00_noop'

export const MUTANTI = {
  // Control negativ: niciun efect — TREBUIE să supraviețuiască.
  M00_noop: 'SELECT 1;',

  // ── M1: verificarea hash J04 scoasă / slăbită în tranziția aprobat→depus ───────────────────────────────────────────
  // M01a: bucla J04 dispare; triggerul depus revine la R11 (doar prezența rolurilor depus_final/dovada_seap).
  fara_j04: rescrie('public.fn_pt_pachet_depus_verifica()', 'FOR v_f IN .*END LOOP;', '', 's'),
  // M01b: dovada PASS nu mai trebuie să aibă SHA-ul din manifest.
  M01b_j04_fara_potrivire_sha: rescrie('public.fn_pt_pachet_depus_verifica()',
    'AND v\\.sha256_calculat = v_f\\.sha256 AND v\\.sha256_declarat = v_f\\.sha256', ''),
  // X01c: orice rând de verificare (și REFUZ) cu SHA + identitate potrivite ține loc de PASS.
  X01c_j04_accepta_orice_rezultat: rescrie('public.fn_pt_pachet_depus_verifica()', "AND v\\.rezultat = 'PASS'", ''),
  // J04 acceptă orice PASS cu SHA-ul manifestului, fără identitatea obiectului (id / updated_at / eTag / size).
  j04_fara_identitate: rescrie('public.fn_pt_pachet_depus_verifica()',
    'AND v\\.obj_id = o\\.id AND v\\.obj_updated_at = o\\.updated_at\\s*AND v\\.obj_etag IS NOT DISTINCT FROM \\(o\\.metadata->>\'eTag\'\\)\\s*AND v\\.obj_size > 0 AND v\\.obj_size = v_size', '', 's'),
  // J04 fără blocarea obiectelor până la COMMIT (FOR SHARE).
  j04_fara_lock: rescrie('public.fn_pt_pachet_depus_verifica()', 'FOR SHARE;', ';'),
  // ── C1–C3 (06.10.2026, JILAVA_DECIZII A.2): remedierile fostelor constatări, fiecare stricată separat ──────────────────────
  // C1: INSERT-ul în manifest nu mai blochează pachetul (FOR SHARE) → cursa cu tranziția revine (JX-C1).
  XC1_manifest_fara_lock: rescrie('public.fn_pt_fisier_insert_stare()', 'FOR SHARE;', ';'),
  // C1: starea comisă nu mai e verificată la INSERT (orice rol adaugă în manifestul aprobat / depus) (JX-C1, JX-C3, JX-07j).
  XC1_manifest_orice_stare: rescrie('public.fn_pt_fisier_insert_stare()', '\nBEGIN\n', '\nBEGIN\n  RETURN NEW;\n'),
  // C2: J04 acceptă din nou ORICE PASS, nu ultima verificare (JX-C2).
  XC2_orice_pass: rescrie('public.fn_pt_pachet_depus_verifica()', 'ORDER BY u\\.id DESC LIMIT 1', ''),
  // C3: manifestul se poate rescrie / șterge pe pachetul aprobat (JX-C3, JX-C3b).
  XC3_manifest_rescriibil: rescrie('public.fn_pt_fisier_imuabil()', '\nBEGIN\n', "\nBEGIN\n  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;\n"),
  // C3: cheia de serviciu tratată ca identitate de administrare (JX-C3).
  XC3_service_ca_administrare: rescrie('public.fn_pt_manifest_administrare()', '\nBEGIN\n', '\nBEGIN\n  RETURN true;\n'),
  // J04 cere dovadă doar pentru fișierele depus_final (propunerea, borderoul și dovada SEAP scapă).
  j04_doar_depus_final: rescrie('public.fn_pt_fisier_cere_verificare(text)',
    "p_rol IN \\('propunere_docx','borderou_docx','depus_final','dovada_seap'\\)", "p_rol IN ('depus_final')"),

  // ── M2: apelul la poarta J07 scos / ocolit ────────────────────────────────────────────────────────────────────────
  // M02a: J07 dispare din tranziția pachetului (rămâne doar R5 + completitudine SEAP).
  fara_j07: rescrie('public.fn_ofertare_pt_pachet_poarta_documentatie()', '-- J07 BEGIN.*-- J07 END', '', 's'),
  // M02b: J07 dispare din poarta licitației „depusă” (fn_gate_depunere).
  M02b_fara_j07_licitatie: rescrie('public.fn_gate_depunere()', '-- J07 BEGIN.*-- J07 END', '', 's'),
  // M02c: ofertare_poarta_impune nu mai impune nimic.
  M02c_impune_noop: rescrie('public.ofertare_poarta_impune(bigint,bigint)', '\\nBEGIN\\n', '\nBEGIN\n  RETURN;\n'),
  // M02d: J07 impus doar la aprobare, nu și la depunere (verdictul de la aprobare ar ajunge).
  j07_doar_la_aprobare: rescrie('public.fn_ofertare_pt_pachet_poarta_documentatie()', "IF NEW\\.stare IN \\('aprobat','depus'\\)", "IF NEW.stare IN ('aprobat')"),
  // M02e: fără verificarea „pachetul curent” (pachet_versiune).
  fara_pachet_versiune: rescrie('public.ofertare_poarta_impune(bigint,bigint)', 'IF p_pachet_id IS NOT NULL AND p_pachet_id IS DISTINCT FROM ultim THEN', 'IF false THEN'),

  // ── M3…M14: fiecare din cele 12 controale J07 dezactivat (return ok) + agregatorul incomplet ─────────────────────
  M03_cuprins: contorOk('public.ofertare_ctl_cuprins(bigint)', 'cuprins'),
  M04_neverificate: contorOk('public.ofertare_ctl_neverificate(bigint)', 'neverificate'),
  M05_capcane: contorOk('public.ofertare_ctl_capcane(bigint)', 'capcane'),
  M06_goale: contorOk('public.ofertare_ctl_goale(bigint)', 'goale'),
  M07_nescrise: contorOk('public.ofertare_ctl_nescrise(bigint)', 'nescrise'),
  M08_cantitati_f3_grafic: scurt('public.ofertare_ctl_cantitati_f3_grafic(bigint)', 'cantitati_f3_grafic'),
  M09_garantie: scurt('public.ofertare_ctl_garantie(bigint)', 'garantie'),
  // Garanția are două straturi: structurat (SQL, live) și text (evaluator). Fiecare scos separat.
  M09s_garantie_doar_structurat: rescrie('public.ofertare_ctl_garantie(bigint)', 'IF \\(\\(ol IS NULL OR om IS NULL\\).*?END IF;', '', 's'),
  M09t_garantie_doar_text: rescrie('public.ofertare_ctl_garantie(bigint)',
    "RETURN public\\.ofertare_ctl_text\\(p_licitatie_id,'garantie'\\);", `RETURN ${OK('garantie')};`),
  M10_anexe: textOk('anexe'),
  M11_numere: textOk('numere'),
  M12_pachet: textOk('pachet'),
  M13_grafic_relatii: scurt('public.ofertare_ctl_grafic_relatii(bigint)', 'grafic_relatii'),
  M14_grafic_sursa: scurt('public.ofertare_ctl_grafic_sursa(bigint)', 'grafic_sursa'),
  // „Implementare care verifică doar unul” (Copilot §2): agregatorul evaluează numai controlul cuprins.
  j07_doar_cuprins: rescrie('public.ofertare_poarta_server(bigint)', 'controale:=jsonb_build_array\\(.*?\\);',
    'controale:=jsonb_build_array(public.ofertare_ctl_cuprins(p_licitatie_id));', 's'),
  // Agregatorul fără cele 4 controale text (J07 doar SQL).
  j07_fara_text: rescrie('public.ofertare_poarta_server(bigint)',
    'public\\.ofertare_ctl_garantie\\(p_licitatie_id\\),\\s*public\\.ofertare_ctl_text\\(p_licitatie_id,\'anexe\'\\),public\\.ofertare_ctl_text\\(p_licitatie_id,\'numere\'\\),public\\.ofertare_ctl_text\\(p_licitatie_id,\'pachet\'\\),',
    ''),

  // ── M15: „stale” decis altfel decât prin hash ─────────────────────────────────────────────────────────────────────
  M15a_stale_ttl_24h: rescrie('public.ofertare_ctl_text(bigint,text)', "AND t\\.sursa_hash=src->>'sursa_hash'",
    "AND t.calculat_la > now() - interval '24 hours'"),
  M15b_stale_dupa_ultimul_manifest: rescrie('public.ofertare_ctl_text(bigint,text)', "AND t\\.sursa_hash=src->>'sursa_hash'",
    "AND t.calculat_la >= (SELECT coalesce(max(f.created_at),'-infinity'::timestamptz) FROM public.ofertare_pt_pachet_fisiere f JOIN public.ofertare_pt_pachet p ON p.id=f.pachet_id WHERE p.licitatie_id=p_licitatie_id)"),
  // M15c: J07 legat doar de licitație + control, nu și de hash-ul sursei (verdict stale acceptat).
  j07_fara_hash: rescrie('public.ofertare_ctl_text(bigint,text)', "AND t\\.sursa_hash=src->>'sursa_hash'", ''),
  // M15d: J07 ia PRIMUL rezultat pe hash, nu ultimul (o reevaluare „block” ulterioară ar fi ignorată).
  j07_primul_rezultat: rescrie('public.ofertare_ctl_text(bigint,text)', 'ORDER BY t\\.id DESC', 'ORDER BY t.id ASC'),

  // ── M16: eroare internă / date indisponibile → ok în loc de BLOCK ────────────────────────────────────────────────
  M16a_text_eroare_ok: rescrie('public.ofertare_ctl_text(bigint,text)',
    "EXCEPTION WHEN OTHERS THEN\\s+RETURN public\\.ofertare_poarta_rezultat\\(p_control,'undetermined'",
    "EXCEPTION WHEN OTHERS THEN\n  RETURN public.ofertare_poarta_rezultat(p_control,'ok'"),
  // M16b: excepție → ok în TOATE cele 5 funcții SQL; apoi în fiecare separat.
  M16b_sql_eroare_ok: Object.values(CTL_SQL).map(eroareOk).join('\n'),
  M16b_contor: eroareOk(CTL_SQL.contor),
  M16b_cantitati_f3_grafic: eroareOk(CTL_SQL.cantitati_f3_grafic),
  M16b_garantie: eroareOk(CTL_SQL.garantie),
  M16b_grafic_sursa: eroareOk(CTL_SQL.grafic_sursa),
  M16b_grafic_relatii: eroareOk(CTL_SQL.grafic_relatii),
  // M16c: calea „indisponibil” (view fără rând / contor NULL) → ok în toate 5; apoi în fiecare separat.
  M16c_sql_indisponibil_ok: Object.keys(INDISPONIBIL).map(indisponibilOk).join('\n'),
  M16c_contor: indisponibilOk('contor'),
  M16c_cantitati_f3_grafic: indisponibilOk('cantitati_f3_grafic'),
  M16c_garantie: indisponibilOk('garantie'),
  M16c_grafic_sursa: indisponibilOk('grafic_sursa'),
  M16c_grafic_relatii: indisponibilOk('grafic_relatii'),
  // M16d: agregatorul tratează „undetermined” ca „ok” (blochează doar pe „block”).
  j07_undetermined_ok: rescrie('public.ofertare_poarta_server(bigint)', "WHERE c->>'stare'<>'ok'", "WHERE c->>'stare'='block'"),
  // M16e: ofertare_poarta_impune înghite eroarea agregatorului.
  M16e_impune_inghite_eroarea: rescrie('public.ofertare_poarta_impune(bigint,bigint)', 'r:=public\\.ofertare_poarta_server\\(p_licitatie_id\\);',
    `BEGIN r:=public.ofertare_poarta_server(p_licitatie_id); EXCEPTION WHEN OTHERS THEN r:='{"stare":"ok","blocaje":[]}'::jsonb; END;`),
  // M16g: rezultat text lipsă → ok.
  M16g_text_lipsa_ok: rescrie('public.ofertare_ctl_text(bigint,text)',
    "IF NOT FOUND THEN RETURN public\\.ofertare_poarta_rezultat\\(p_control,'undetermined'",
    "IF NOT FOUND THEN RETURN public.ofertare_poarta_rezultat(p_control,'ok'"),

  // ── M17: parser_version ignorat (M17a; M17b e în edge) ─────────────────────────────────────────────────────────────
  j07_ignora_parser: rescrie('public.ofertare_ctl_text(bigint,text)', "AND t\\.parser_version=src->>'parser_version' ", ''),

  // ── M18: scriere directă a stării / dovezilor de către authenticated ──────────────────────────────────────────────
  // a) matricea de tranziții dispare cu totul (trigger șters): rămân doar politicile RLS + J04/J07.
  M18a_fara_trigger_matrice: `DROP TRIGGER trg_ofertare_pt_pachet_matrice ON public.ofertare_pt_pachet;
${asigura("NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_ofertare_pt_pachet_matrice')", 'matrice')}`,
  // b) funcția matrice păstrează imuabilitatea, dar orice tranziție de stare e permisă.
  M18b_matrice_orice_tranzitie: rescrie('public.fn_ofertare_pt_pachet_matrice()',
    "IF NOT \\( \\(OLD\\.stare = 'propus'  AND NEW\\.stare = 'aprobat'\\)\\s+OR \\(OLD\\.stare = 'aprobat' AND NEW\\.stare = 'depus'\\) \\) THEN",
    'IF false THEN'),
  // c) RLS: authenticated poate UPDATE orice pachet, în orice stare, chiar fără modulul Ofertare.
  M18c_rls_update_liber: `DROP POLICY ofertare_pt_pachet_update ON public.ofertare_pt_pachet;
DROP POLICY ofertare_pt_pachet_depune ON public.ofertare_pt_pachet;
CREATE POLICY mutant_update_liber ON public.ofertare_pt_pachet FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
${asigura("(SELECT count(*) FROM pg_policy WHERE polrelid='public.ofertare_pt_pachet'::regclass AND polcmd='w') = 1", 'rls')}`,
  // d) authenticated poate UPDATE starea dovezilor (rezultat J04 / stare J07); triggerele append-only rămân.
  M18d_dovezi_update_authenticated: `GRANT UPDATE ON public.ofertare_pt_pachet_verificari, public.ofertare_poarta_rezultate_text TO authenticated;
CREATE POLICY mutant_upd_v ON public.ofertare_pt_pachet_verificari FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mutant_upd_t ON public.ofertare_poarta_rezultate_text FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
${asigura("has_table_privilege('authenticated','public.ofertare_poarta_rezultate_text','UPDATE')", 'grant')}`,
  // e) ca d), plus triggerele append-only fără UPDATE: UPDATE-ul direct chiar reușește.
  M18e_dovezi_update_authenticated_fara_trigger: `GRANT UPDATE ON public.ofertare_pt_pachet_verificari, public.ofertare_poarta_rezultate_text TO authenticated;
CREATE POLICY mutant_upd_v ON public.ofertare_pt_pachet_verificari FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY mutant_upd_t ON public.ofertare_poarta_rezultate_text FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
${triggerFara(...J04_VERIF, 'DELETE OR TRUNCATE')}
${triggerFara(...J07_REZ, 'DELETE OR TRUNCATE')}`,
  // f) RPC SECURITY DEFINER pentru authenticated care scrie stare='depus' cu triggerele oprite.
  M18f_rpc_ocolire_triggere: `CREATE FUNCTION public.mutant_depune_direct(p bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.ofertare_pt_pachet SET stare = 'depus', depus_la = now() WHERE id = p;
  PERFORM set_config('session_replication_role', 'origin', true);
END $f$;
REVOKE ALL ON FUNCTION public.mutant_depune_direct(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mutant_depune_direct(bigint) TO authenticated;`,
  // g) manifestul devine modificabil de authenticated (A→B pe același pachet).
  M18g_manifest_update_authenticated: `GRANT UPDATE ON public.ofertare_pt_pachet_fisiere TO authenticated;
CREATE POLICY mutant_upd_f ON public.ofertare_pt_pachet_fisiere FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
${asigura("has_table_privilege('authenticated','public.ofertare_pt_pachet_fisiere','UPDATE')", 'grant')}`,
  // h) poarta licitației „depusă” (J02 + J05 + J07) dispare.
  M18h_fara_gate_licitatie: `DROP TRIGGER trg_gate_depunere ON public.ofertare_licitatii;
${asigura("NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_gate_depunere')", 'gate')}`,

  // ── M19: dovada append-only permite UPDATE / DELETE ─────────────────────────────────────────────────────────────
  M19a_j04_dovezi_update_superuser: triggerFara(...J04_VERIF, 'DELETE OR TRUNCATE'),
  M19b_j07_rezultate_update_superuser: triggerFara(...J07_REZ, 'DELETE OR TRUNCATE'),
  M19c_dovezi_update_service_role: `${triggerFara(...J04_VERIF, 'DELETE OR TRUNCATE')}
${triggerFara(...J07_REZ, 'DELETE OR TRUNCATE')}
GRANT UPDATE ON public.ofertare_pt_pachet_verificari, public.ofertare_poarta_rezultate_text TO service_role;`,
  M19d_grant_update_service_role_trigger_intact: `GRANT UPDATE ON public.ofertare_pt_pachet_verificari, public.ofertare_poarta_rezultate_text TO service_role;
${asigura("has_table_privilege('service_role','public.ofertare_pt_pachet_verificari','UPDATE')", 'grant')}`,
  X19e_j04_dovezi_delete_superuser: triggerFara(...J04_VERIF, 'UPDATE OR TRUNCATE'),
  X19f_j07_rezultate_delete_superuser: triggerFara(...J07_REZ, 'UPDATE OR TRUNCATE'),
}

// ── mutanți EDGE: { fisier (relativ la supabase/functions), din (text exact / RegExp), in_ } ────────────────────────
const EVAL = 'ofertare-poarta-text/evalueaza.mjs', HANDLER_J07 = 'ofertare-poarta-text/handler.ts'
const VERIF = 'ofertare-pachet-verifica/verificare.mjs', HANDLER_J04 = 'ofertare-pachet-verifica/index.ts'
const evaluatorOk = cod => [{ fisier: EVAL, din: "stare: verdict.stare === 'block' ? 'block' : 'ok'",
  in_: `stare: (control_code === '${cod}' || verdict.stare !== 'block') ? 'ok' : 'block'` }]

export const MUTANTI_EDGE = {
  // XP (JILAVA_DECIZII L3): poarta de rol comună lasă pe oricine (fără JWT / fără modul) — JX-07k trebuie să-l prindă.
  XP_poarta_oricine: [{ fisier: '_shared/poartaOfertare.ts',
    din: 'export async function poartaOfertare(req: Request, deps: DepsPoartaOfertare = {}): Promise<Response | null> {\n',
    in_: 'export async function poartaOfertare(req: Request, deps: DepsPoartaOfertare = {}): Promise<Response | null> {\n  if (Date.now() > 0) return null\n' }],
  // M16f: evaluatorul text transformă o excepție (sursă cu contract rupt) în ok.
  M16f_evaluator_eroare_ok: [{ fisier: EVAL, din: "return { control_code, stare: 'undetermined',", in_: "return { control_code, stare: 'ok'," }],
  // M17b: handler-ul J07 nu mai refuză (409) un parser diferit de server și etichetează rezultatele cu versiunea serverului.
  M17b_handler_ignora_parser: [
    { fisier: HANDLER_J07, din: "    if (sursa.parser_version !== PARSER_VERSION) return raspuns(409, { error: 'Versiunea parserului diferă de server; poarta rămâne blocată' })\n", in_: '' },
    { fisier: HANDLER_J07, din: 'parser_version: PARSER_VERSION, sursa_hash: sursa.sursa_hash', in_: 'parser_version: sursa.parser_version, sursa_hash: sursa.sursa_hash' },
  ],
  // XE: evaluatorul real dă ok pe un control text care ar bloca.
  XE_garantie_evaluator_ok: evaluatorOk('garantie'),
  XE_anexe_evaluator_ok: evaluatorOk('anexe'),
  XE_numere_evaluator_ok: evaluatorOk('numere'),
  XE_pachet_evaluator_ok: evaluatorOk('pachet'),
  // XV: verificatorul J04 fără comparația SHA / fără snapshot-ul de după descărcare.
  XV_verificator_fara_sha: [{ fisier: VERIF,
    din: "    if (hash.sha256 !== f.sha256) return refuz('SHA-256 diferit de manifest')\n    return { ...row, rezultat: 'PASS', motiv: null }",
    in_: "    return { ...row, sha256_calculat: f.sha256, rezultat: 'PASS', motiv: null }" }],
  XV_verificator_fara_snapshot_dupa: [{ fisier: VERIF, din: "    if (!snapshotIdentic(before, after)) return refuz('obiect schimbat în timpul verificării')\n", in_: '' }],
  // XH04: codul de legătură al edge-ului J04 (index.ts).
  XH04a_handler_orice_stare: [{ fisier: HANDLER_J04,
    din: "      if (pachet.stare !== 'aprobat') return json({ error: 'Verificarea depunerii cere un pachet aprobat.' }, 409)\n", in_: '' }],
  XH04b_handler_ok_ignora_refuz: [{ fisier: HANDLER_J04,
    din: "ok: lipsa.length === 0 && verificari.every(v => v.rezultat === 'PASS')", in_: 'ok: lipsa.length === 0' }],
  XH04c_handler_refuz_nepersistat: [{ fisier: HANDLER_J04,
    din: "        const { error } = await db.from('ofertare_pt_pachet_verificari').insert(row)",
    in_: "        const { error } = row.rezultat === 'PASS' ? await db.from('ofertare_pt_pachet_verificari').insert(row) : { error: null }" }],
}

for (const n of Object.keys(MUTANTI_EDGE)) if (MUTANTI[n]) throw new Error('Nume de mutant dublat: ' + n)
