// Inventarul constrângerilor NUMITE ale celor 17 tabele dcc_* (planul, A3 „Inventarul CHECK-urilor față de NULL”, runda 4): fiecare CHECK în
// EXACT o clasă. Aceeași listă e scrisă în $post$ (secțiunea 7 a migrării); proba compară cele două copii și catalogul (p_check_inventar).
//   N1 coloane NOT NULL, expresie fără funcții (pe valori nenule mereu true / false; NULL -> 23502, nu UNKNOWN)
//   N2 coloană nulabilă, NULL PERMIS explicit (col IS NULL OR …)
//   N3 ramuri care CER o valoare (IS NOT NULL explicit) și egalități de booleeni nenuli
//   N4 funcții în CHECK (fn(…) IS TRUE; funcția nu întoarce NULL și nu aruncă)
//   N5 tablouri (col <@ ARRAY[…] pe coloană NOT NULL)
//   N6 implicație pe tablou ((…) IS TRUE)
export const TABELE = ['dcc_casute', 'dcc_ghiduri', 'dcc_ghid_valori', 'dcc_ghid_intervale', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii',
  'dcc_serii', 'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii',
  'dcc_mesaje', 'dcc_legaturi']
// tabelele cu SELECT pentru authenticated (fără dcc_intentii / dcc_casute / dcc_serii)
export const TABELE_CITITE = TABELE.filter(t => !['dcc_intentii', 'dcc_casute', 'dcc_serii'].includes(t))

// INVENTAR-START
export const CHECKURI = [
  ['dcc_casute', 'dcc_casute_adresa_ck', 'N1'], ['dcc_casute', 'dcc_casute_tip_ck', 'N1'], ['dcc_casute', 'dcc_casute_stare_ck', 'N1'],
  ['dcc_casute', 'dcc_casute_proprietar_ck', 'N3'],
  ['dcc_ghiduri', 'dcc_ghiduri_cod_ck', 'N1'], ['dcc_ghiduri', 'dcc_ghiduri_versiune_ck', 'N1'], ['dcc_ghiduri', 'dcc_ghiduri_sursa_ck', 'N1'],
  ['dcc_ghiduri', 'dcc_ghiduri_format_cod_ck', 'N4'], ['dcc_ghiduri', 'dcc_ghiduri_format_fisier_ck', 'N4'], ['dcc_ghiduri', 'dcc_ghiduri_limba_ck', 'N1'],
  ['dcc_ghid_valori', 'dcc_ghid_valori_categorie_ck', 'N1'], ['dcc_ghid_valori', 'dcc_ghid_valori_forma_ck', 'N1'],
  ['dcc_ghid_valori', 'dcc_ghid_valori_fara_tematica_ck', 'N1'],
  ['dcc_ghid_intervale', 'dcc_ghid_intervale_interval_ck', 'N4'], ['dcc_ghid_intervale', 'dcc_ghid_intervale_limite_ck', 'N1'],
  ['dcc_contracte', 'dcc_contracte_beneficiar_ck', 'N1'], ['dcc_contracte', 'dcc_contracte_cod_ck', 'N1'], ['dcc_contracte', 'dcc_contracte_mod_ck', 'N1'],
  ['dcc_contracte', 'dcc_contracte_creat_prin_ck', 'N1'], ['dcc_contracte', 'dcc_contracte_creat_ck', 'N3'],
  ['dcc_proiecte', 'dcc_proiecte_emitent_ck', 'N1'], ['dcc_proiecte', 'dcc_proiecte_limba_ck', 'N2'], ['dcc_proiecte', 'dcc_proiecte_adresa_ck', 'N2'],
  ['dcc_proiecte', 'dcc_proiecte_cc_implicit_ck', 'N1'], ['dcc_proiecte', 'dcc_proiecte_plafon_ck', 'N1'], ['dcc_proiecte', 'dcc_proiecte_casuta_ck', 'N2'],
  ['dcc_proiecte', 'dcc_proiecte_trimitere_ck', 'N1'], ['dcc_proiecte', 'dcc_proiecte_versiune_ck', 'N1'],
  ['dcc_intentii', 'dcc_intentii_operatie_ck', 'N1'], ['dcc_intentii', 'dcc_intentii_hash_ck', 'N1'], ['dcc_intentii', 'dcc_intentii_actor_ck', 'N1'],
  ['dcc_intentii', 'dcc_intentii_autor_ck', 'N3'],
  ['dcc_serii', 'dcc_serii_interval_ck', 'N4'], ['dcc_serii', 'dcc_serii_motiv_ck', 'N1'], ['dcc_serii', 'dcc_serii_initializata_prin_ck', 'N1'],
  ['dcc_serii', 'dcc_serii_initializata_ck', 'N3'], ['dcc_serii', 'dcc_serii_limite_ck', 'N1'], ['dcc_serii', 'dcc_serii_prag_ck', 'N1'],
  ['dcc_serii', 'dcc_serii_ultimul_ck', 'N1'],
  ['dcc_documente', 'dcc_documente_secventa_ck', 'N1'], ['dcc_documente', 'dcc_documente_interval_ck', 'N4'], ['dcc_documente', 'dcc_documente_mod_ck', 'N1'],
  ['dcc_documente', 'dcc_documente_titlu_ck', 'N1'], ['dcc_documente', 'dcc_documente_stare_val_ck', 'N1'], ['dcc_documente', 'dcc_documente_automat_ck', 'N3'],
  ['dcc_documente', 'dcc_documente_stare_ck', 'N3'], ['dcc_documente', 'dcc_documente_anulare_ck', 'N3'], ['dcc_documente', 'dcc_documente_neanulat_ck', 'N3'],
  ['dcc_file', 'dcc_file_fila_ck', 'N1'],
  ['dcc_anexe', 'dcc_anexe_numar_ck', 'N1'], ['dcc_anexe', 'dcc_anexe_titlu_ck', 'N1'],
  ['dcc_revizii', 'dcc_revizii_revizie_ck', 'N1'], ['dcc_revizii', 'dcc_revizii_limba_ck', 'N2'], ['dcc_revizii', 'dcc_revizii_stare_val_ck', 'N1'],
  ['dcc_revizii', 'dcc_revizii_anulata_prin_val_ck', 'N2'], ['dcc_revizii', 'dcc_revizii_verdict_val_ck', 'N2'], ['dcc_revizii', 'dcc_revizii_tinta_ck', 'N1'],
  ['dcc_revizii', 'dcc_revizii_stare_ck', 'N3'], ['dcc_revizii', 'dcc_revizii_anulare_ck', 'N3'], ['dcc_revizii', 'dcc_revizii_neanulata_ck', 'N3'],
  ['dcc_revizii', 'dcc_revizii_verdict_ck', 'N3'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_sursa_ck', 'N1'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_sursa_id_ck', 'N1'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_pozitie_ck', 'N1'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_lot_ck', 'N1'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_valori_ck', 'N1'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_cod_scris_ck', 'N2'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_secventa_ck', 'N2'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_fila_ck', 'N2'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_anexa_ck', 'N2'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_revizie_ck', 'N2'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_limba_ck', 'N2'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_probleme_ck', 'N5'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_hash_ck', 'N1'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_importat_prin_ck', 'N1'],
  ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_importat_ck', 'N3'], ['dcc_istoric_aparitii', 'dcc_istoric_aparitii_revizie_problema_ck', 'N6'],
  ['dcc_snapshoturi', 'dcc_snapshoturi_tip_ck', 'N1'], ['dcc_snapshoturi', 'dcc_snapshoturi_subiect_ck', 'N1'],
  ['dcc_snapshoturi', 'dcc_snapshoturi_manifest_ck', 'N1'], ['dcc_snapshoturi', 'dcc_snapshoturi_hash_ck', 'N1'],
  ['dcc_mesaje', 'dcc_mesaje_directie_ck', 'N1'], ['dcc_mesaje', 'dcc_mesaje_sursa_ck', 'N1'], ['dcc_mesaje', 'dcc_mesaje_thread_ck', 'N3'],
  ['dcc_mesaje', 'dcc_mesaje_manual_ck', 'N3'],
  ['dcc_legaturi', 'dcc_legaturi_metoda_ck', 'N1'], ['dcc_legaturi', 'dcc_legaturi_dovada_ck', 'N1'], ['dcc_legaturi', 'dcc_legaturi_stare_ck', 'N1'],
  ['dcc_legaturi', 'dcc_legaturi_verdict_ck', 'N2'], ['dcc_legaturi', 'dcc_legaturi_confirmare_ck', 'N3'],
]
export const UNICE = [
  ['dcc_casute', 'dcc_casute_adresa_uq'], ['dcc_ghiduri', 'dcc_ghiduri_cod_versiune_uq'], ['dcc_ghid_valori', 'dcc_ghid_valori_uq'],
  ['dcc_ghid_intervale', 'dcc_ghid_intervale_uq'], ['dcc_contracte', 'dcc_contracte_uq'], ['dcc_proiecte', 'dcc_proiecte_executie_contract_uq'],
  ['dcc_proiecte', 'dcc_proiecte_id_contract_uq'], ['dcc_serii', 'dcc_serii_cheie_uq'], ['dcc_documente', 'dcc_documente_cod_uq'],
  ['dcc_documente', 'dcc_documente_id_contract_uq'], ['dcc_documente', 'dcc_documente_id_proiect_uq'], ['dcc_file', 'dcc_file_uq'],
  ['dcc_anexe', 'dcc_anexe_uq'], ['dcc_revizii', 'dcc_revizii_uq'], ['dcc_revizii', 'dcc_revizii_cod_uq'], ['dcc_istoric_aparitii', 'dcc_istoric_sursa_uq'],
  ['dcc_snapshoturi', 'dcc_snapshoturi_id_proiect_uq'], ['dcc_mesaje', 'dcc_mesaje_rfc_uq'], ['dcc_mesaje', 'dcc_mesaje_gmail_uq'],
  ['dcc_legaturi', 'dcc_legaturi_uq'],
]
// INVENTAR-END
