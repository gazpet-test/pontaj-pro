// Fiecare fază este obligatorie. Selectorii și valorile obiectelor concrete vin după clonare.
export const contracte = {
  '01_seap_documente': { verigi: [1], tabele: ['ofertare_documente_atribuire', 'ofertare_seap_manifest'], faze: ['import_copie', 'inlocuire_acelasi_nume', 'document_lipsa'] },
  '02_citire': { verigi: [1], tabele: ['ofertare_documente_atribuire', 'ofertare_ingest_coada'], faze: ['citire_integrala', 'recitire_idempotenta'] },
  '03_cerinte': { verigi: [1, 2], tabele: ['ofertare_cerinte', 'ofertare_extragere_coada'], faze: ['extragere', 'confirmare_umana', 'corectie', 'reextragere_pastreaza_corectie', 'trunchiere_semnalata'] },
  '04_clarificari': { verigi: [2, 4, 5], tabele: ['ofertare_clarificari', 'ofertare_raspuns_set'], faze: ['leaga_289', 'leaga_290', 'leaga_333', 'aplica_D1', 'clarificare_dupa_PT'] },
  '05_acoperire': { verigi: [3], tabele: ['ofertare_cerinte'], faze: ['motor', 'alegere_umana', 'verificare_scan', 'AI_neverificata', 'retry_pastreaza_alegerea'] },
  '06_cantitati': { verigi: [2], tabele: ['ofertare_cantitati', 'ofertare_pt_pachet', 'ofertare_pt_poarta'], faze: ['validare_partiala', 'revizie_F3', 'diferenta_blocheaza'] },
  '07_grafic': { verigi: [5, 7], tabele: ['grafic_activitati', 'grafic_versiuni', 'ofertare_pt_capitole', 'ofertare_pt_pachet'], faze: ['editare', 'inghetare', 'generare_PT', 'editare_dupa_PT'] },
  '08_pt': { verigi: [3, 4, 5, 8], tabele: ['ofertare_pt_capitole'], faze: ['generare', 'confirma_legaturi', 'verifica_D1', 'verifica_D6', 'verifica_D8', 'promisiune_peste_cerinta', 'editeaza_dupa_verificare'] },
  '09_verificari': { verigi: [5], tabele: ['ofertare_verificari', 'ofertare_pt_capitole'], faze: ['verificare_finala', 'modificare_versiune', 'verdict_invalideaza'] },
  '10_pachet': { verigi: [3, 5, 6, 7], tabele: ['ofertare_pt_pachet', 'ofertare_pt_poarta'], faze: ['pachet_incomplet', 'AI_neverificata_blocheaza', 'asamblare', 'upload_readback_hash', 'aprobare', 'semnare_poarta', 'modificare_fisier_dupa_aprobare'] },
  '11_depunere': { verigi: [7, 9], tabele: ['ofertare_pt_pachet'], faze: ['fara_dovada_SEAP', 'cu_depus_final_si_dovada', 'status_depusa', 'derogare_non_owner'] },
  '12_comparatie': { verigi: [1, 2, 3, 4, 5, 6, 7, 8, 9], tabele: ['ofertare_pt_pachet'], faze: ['matrice_D1', 'matrice_D6', 'matrice_D8'], readOnly: true },
  '13_concurenta_cerinta': { verigi: [1, 2], tabele: ['ofertare_cerinte'], faze: ['aceeasi_cerinta'], concurenta: true, obiect: 'ofertare_cerinte' },
  '14_concurenta_capitol': { verigi: [4, 5], tabele: ['ofertare_pt_capitole'], faze: ['acelasi_capitol'], concurenta: true, obiect: 'ofertare_pt_capitole' },
  '15_concurenta_acoperire': { verigi: [3], tabele: ['ofertare_cerinte'], faze: ['aceeasi_acoperire'], concurenta: true, obiect: 'ofertare_acoperire' },
  '16_restart_worker': { verigi: [1], tabele: ['ofertare_documente_atribuire', 'ofertare_ingest_coada'], faze: ['porneste_citire', 'dupa_restart', 'retry_idempotent'], restart: true },
}

for (const pas of ['10_pachet', '11_depunere']) contracte[pas].tabele.push('ofertare_derogari_audit', 'v_ofertare_cantitati_nevalidate', 'v_ofertare_seap_completitudine')
