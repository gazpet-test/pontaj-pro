// Cele 13 semnale ale testului „pe hârtie” al agentului verificator pe proiectul-pilot (un proiect Transgaz cu ordin de începere, 22.11.2026),
// SINTETIZATE: fără nume de persoane, fără valori de contract, fără căi reale de pe NAS. Fiecare trebuie să se poată REPREZENTA EXACT în
// contractul dovezii din 20270106a (constatat = sursă + dată + fragment; negasit_in_surse = surse consultate + obligația care cere documentul;
// camp_lipsa = câmpul gol; termen confirmat = cu baza calculului). Folosit de scripts/pglite/test_executie_semnale_local.mjs (scrierea reală prin
// fn_executie_semnal_scrie) și de src/executieSemnaleLogica.test.js (afișarea dovezii pentru fiecare).
// Parametri: proiectul și responsabilii (id-uri de angajați din baza de probă): mp = managerul de proiect, contracte = responsabilul contracte,
// owner = null (owner-ul nu e titular ca angajat; completările cu persoane le face omul, cu „da”).
const CONTRACT = { sursa: 'document', data: '2026-09-18', ref: 'NAS: dosarul proiectului / contract (21 pag.)' }
const ORDIN = { sursa: 'document', data: '2026-10-16', ref: 'NAS: dosarul proiectului / ordinul de începere' }
const gol = { dovada_sursa: null, dovada_data: null, dovada_fragment: null, dovada_ref: null, termen: null, termen_baza: null, termen_confirmat: null, incertitudine: null }
const dov = (d, fragment) => ({ dovada_sursa: d.sursa, dovada_data: d.data, dovada_fragment: fragment, dovada_ref: d.ref })

export function PILOT(proiect, { mp = 10, contracte = 11 } = {}) {
  const baza = (tip, obiect, gravitate, titlu, extra) => ({
    proiect_id: proiect, flux: 'lipsuri', tip, obiect, gravitate, titlu, detalii: null, constatare: 'constatat', surse_consultate: [],
    ...gol, propunere: null, responsabil_employee_id: mp, regula_versiune: 'pilot-2026-11-22', ...extra,
  })
  return [
    // 1 CRITIC — GBE negăsită în sursele consultate; obligația: contractul (art. 8 + 6.1); termenul contractual al depunerii, confirmat
    baza('document_negasit', 'polita:GBE', 'critic', 'Garanția de bună execuție (GBE) negăsită în sursele consultate', {
      constatare: 'negasit_in_surse', surse_consultate: ['ERP: polițele legate de proiect', 'NAS: dosarul proiectului (documente după 18.09.2026)'],
      ...dov(CONTRACT, 'art. 8 + art. 6.1 (pag. 3–4): GBE 10% din valoare, în max. 5 zile lucrătoare de la încheiere (max. 15 zile); fără GBE valabilă nu se plătește nicio factură'),
      termen: '2026-10-03', termen_baza: 'art. 8: max. 15 zile de la încheierea contractului (18.09.2026)', termen_confirmat: true,
      incertitudine: 'GBE poate exista la bancă / asigurător sau pe mail, fără să fie în ERP sau pe NAS.',
      propunere: 'De verificat dacă GBE a fost emisă și pusă în ERP (Administrativ → Contracte → polițe).',
    }),
    // 2 CRITIC — contractul neînregistrat în Administrativ (câmp gol în ERP)
    baza('camp_lipsa_erp', 'camp:contract_administrativ', 'critic', 'Contractul nu e înregistrat în Administrativ', {
      constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_data: '2026-11-22', dovada_fragment: 'Contract neînregistrat în Administrativ',
      dovada_ref: 'executie_proiecte.contract_id', detalii: 'Polițele (GBE, CAR), actele adiționale și facturările nu au unde să fie urmărite.',
      propunere: 'Înregistrarea contractului în Administrativ + legarea la proiect.', responsabil_employee_id: contracte,
    }),
    // 3 ATENȚIE — polița CAR negăsită; obligația: art. 5.1 f
    baza('document_negasit', 'polita:CAR', 'atentie', 'Polița de asigurare (CAR) negăsită în sursele consultate', {
      constatare: 'negasit_in_surse', surse_consultate: ['ERP: polițele legate de proiect', 'NAS: dosarul proiectului'],
      ...dov(CONTRACT, 'art. 5.1 lit. f (pag. 2): polița de asigurare e document al contractului'),
      propunere: 'De verificat emiterea și încărcarea în ERP.', responsabil_employee_id: contracte,
    }),
    // 4 ATENȚIE — PSSM negăsit după semnare; obligația: art. 5.1 h
    baza('document_negasit', 'document:PSSM', 'atentie', 'Planul propriu de securitate și sănătate (PSSM) negăsit după semnare', {
      constatare: 'negasit_in_surse', surse_consultate: ['NAS: dosarul proiectului (doar documente de ofertă)', 'ERP: documentele proiectului'],
      ...dov(CONTRACT, 'art. 5.1 lit. h (pag. 3): planul propriu de securitate și sănătate e document al contractului'),
      propunere: 'De întocmit / de depus (responsabilul de planuri).',
    }),
    // 5 ATENȚIE — prima situație de lucrări: termen contractual lunar, confirmat, cu baza; incertitudine pe octombrie
    baza('termen_apropiat', 'situatie_lucrari:2026-11', 'atentie', 'Prima situație de lucrări: până pe 03.12.2026', {
      ...dov(CONTRACT, 'art. 6.4 (pag. 3): situația de lucrări se prezintă în 3 zile de la sfârșitul fiecărei luni'), surse_consultate: ['ERP: situațiile de plată (0)'],
      termen: '2026-12-03', termen_baza: 'art. 6.4 + luna noiembrie 2026 (sfârșit 30.11.2026 + 3 zile)', termen_confirmat: true,
      incertitudine: 'De verificat dacă s-a lucrat în octombrie (ordin de începere 16.10.2026): ar fi fost o situație și pentru octombrie.',
      propunere: 'De pregătit situația pe noiembrie.',
    }),
    // 6 ATENȚIE — echipa proiectului necompletată (câmpuri goale); persoana din contract NU se completează din memorie
    baza('camp_lipsa_erp', 'camp:echipa', 'atentie', 'Echipa proiectului necompletată în ERP', {
      constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_data: '2026-11-22', dovada_fragment: 'manager de proiect, RTE, RTS, șef de șantier: toate goale',
      dovada_ref: 'executie_proiecte.mp_employee_id / rte / rts / sef_santier', surse_consultate: ['document: contractul, art. 24.4 (persoana de contact)'],
      incertitudine: 'Persoana de contact din contract (art. 24.4, pag. 18) nu se completează din memorie; cere confirmare.',
      propunere: 'De completat oamenii pe roluri (cu „da”).', responsabil_employee_id: null,
    }),
    // 7 ATENȚIE — șantierul nu e creat
    baza('camp_lipsa_erp', 'camp:santier', 'atentie', 'Șantierul nu e creat', {
      constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_data: '2026-11-22', dovada_fragment: 'niciun șantier legat de proiect',
      dovada_ref: 'sites.proiect_id', detalii: 'Pontajul, rapoartele zilnice și consumurile nu se pot înregistra pe proiect.',
      propunere: 'Crearea șantierului (cerere deja transmisă responsabilului contracte).', responsabil_employee_id: contracte,
    }),
    // 8 INFO — oferta financiară nu e în ERP
    baza('camp_lipsa_erp', 'oferta:articole', 'info', 'Oferta financiară nu e în ERP', {
      constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_data: '2026-11-22', dovada_fragment: 'dosar PF inexistent, 0 articole de deviz, 0 materiale',
      dovada_ref: 'executie_pf_articole', surse_consultate: ['NAS: oferta (graficul fizic și valoric, centralizatorul rețetelor)'],
      propunere: 'Importul ofertei (restul de decontat / materialele ofertei).',
    }),
    // 9 INFO — graficul general de execuție nu e în ERP; obligația: art. 5.1 d + 7.5 (penalitate la netransmitere)
    baza('document_negasit', 'document:grafic_executie', 'info', 'Graficul general de execuție nu e în ERP', {
      constatare: 'negasit_in_surse', surse_consultate: ['ERP: documentele proiectului', 'NAS: oferta / grafic și program de execuție (varianta de ofertă)'],
      ...dov(CONTRACT, 'art. 5.1 lit. d + art. 7.5 (pag. 2, 4): la orice modificare de termen graficul actualizat se transmite în 10 zile, altfel penalitate 0,01% / zi din rest'),
      propunere: 'De încărcat graficul aprobat.',
    }),
    // 10 INFO — eticheta Gmail a proiectului lipsește
    baza('camp_lipsa_erp', 'camp:eticheta_gmail', 'info', 'Eticheta Gmail a proiectului lipsește', {
      constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_data: '2026-11-22', dovada_fragment: 'eticheta_gmail goală', dovada_ref: 'executie_proiecte.eticheta_gmail',
      detalii: 'Corespondența cu beneficiarul nu poate fi urmărită pe proiect.', propunere: 'De creat eticheta + filtrul (beneficiar, numele proiectului, nr. contract).',
      responsabil_employee_id: null,
    }),
    // 11 INFO — coordonatorul beneficiarului nu e în ERP; numele din ordinul de începere doar cu confirmare
    baza('camp_lipsa_erp', 'camp:coordonator_beneficiar', 'info', 'Dirigintele / coordonatorul beneficiarului nu e în ERP', {
      constatare: 'camp_lipsa', dovada_sursa: 'camp_erp', dovada_data: '2026-11-22', dovada_fragment: 'coordonator_transgaz gol', dovada_ref: 'executie_proiecte.coordonator_transgaz',
      surse_consultate: ['document: ordinul de începere (coordonatorul lucrărilor mecanice)'],
      incertitudine: 'Numele din ordinul de începere se completează doar cu confirmarea omului.', propunere: 'De completat (cu „da”).', responsabil_employee_id: null,
    }),
    // 12 INFO — termenul final, din ordinul de începere + durata din contract; confirmat, cu baza
    baza('termen_contract', 'contract:termen_final', 'info', 'Termen final 16.04.2027', {
      ...dov(ORDIN, 'ordin de începere 16.10.2026; durata de execuție din contract → termen 16.04.2027; autorizația de construire valabilă până la 16.10.2027'),
      surse_consultate: ['document: ordinul de începere', 'document: contractul, art. 7.1 (penalitate 0,05% / zi din valoarea obligațiilor întârziate)'],
      termen: '2027-04-16', termen_baza: 'ordinul de începere (16.10.2026) + durata de execuție din contract', termen_confirmat: true, propunere: 'De urmărit lunar.',
    }),
    // 13 INFO — procesul-verbal de predare a amplasamentului negăsit; avem doar convocarea (dovada că predarea a fost programată)
    baza('document_negasit', 'document:pv_predare_amplasament', 'info', 'Procesul-verbal de predare a amplasamentului negăsit', {
      constatare: 'negasit_in_surse', surse_consultate: ['NAS: corespondența la contract', 'ERP: documentele proiectului'],
      dovada_sursa: 'document', dovada_data: '2026-09-30', dovada_fragment: 'comunicarea de predare a amplasamentului: predarea programată pe 02.10.2026, ora 11',
      dovada_ref: 'NAS: corespondența la contract / comunicarea de predare a amplasamentului', propunere: 'De urcat PV-ul semnat.',
    }),
  ]
}
