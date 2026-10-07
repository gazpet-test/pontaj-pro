// Clasificatorul comun al documentelor de atribuire (supabase/functions/_shared/tipDocument.mjs) — motorul de import, var. A
// (Răzvan, 07.10.2026). Adevărul de referință: reclasificarea manuală a celor 160 de fișiere din arhiva lic. 3 (CN1095546,
// ids 1460–1630), care moșteneau toate „raspuns_clarificare”. Plus: moștenirea din arhivă, adâncimea, paritatea cu api/.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tipExplicit, ghicesteTip, tipInArhiva, indiciuArhiva, numeFisier, esteArhiva, adancimeArhiva, MAX_ADANCIME_ARHIVE } from '../supabase/functions/_shared/tipDocument.mjs'

const T = ['Extindere_retea_distributie_gaze_naturale_UAT_Oltenițaptr_Distrigaz_Sud_Retele', 'Infiintare_sistem_distributie_gaze_naturale_UAT_Ulmeni',
  'Infiintare_sistem_distributie_gaze_naturale_UAT_Spanțov', 'Infiintare_sistem_distributie_gaze_naturale_UAT_Chiselet', 'Infiintare_sistem_distributie_gaze_naturale_UAT_Mînăstirea']
const TR = ['1_PE_MP_Dn_250_Tronson_str_Calarasi_limita_UAT_OltenitaUAT_Ulmeni', '2_PE_MP_Dn_250_Tronson_UAT_Ulmeni', '3_PE_MP_Dn_250_Tronson_UAT_Spantov',
  '4_PE_MP_Dn_250_Tronson_UAT_Chiselet', '5_PE_MP_Dn_160_Tronson_UAT_Manastirea', '5_PE_MP_Dn_180_Tronson_UAT_Manastirea', '5_PE_MP_Dn_250_Tronson_UAT_Manastirea']
const obiecte = (pref) => T.map((t, i) => `${pref}_${i + 1}_${t}.pdf`)
const tronsoane = (pref) => TR.map(t => `${pref}_${t}.pdf`)

// lic. 3 — numele exacte din ofertare_documente_atribuire (07.10.2026), grupate pe tipul pus manual
const LIC3 = {
  formular: [
    'C1_grafic_executie.pdf', 'F6_grafic_executie.pdf', 'DG_devizul_general.pdf',
    ...['C6', 'C7', 'C8', 'C9'].flatMap((c, k) => {
      const ce = ['materiale', 'manopera', 'utilaje', 'transport'][k]
      return [...tronsoane(`${c}_deviz_extras_${ce}`), `${c}_investitie_extras_${ce}.pdf`, ...obiecte(`${c}_obiect_extras_${ce}`)]
    }),
    ...obiecte('DO_Devizul_Obiect'), ...obiecte('F4_obiect_echipamente'), ...obiecte('F5_fise_tehnice'),
  ],
  lista_cantitati: [
    ...tronsoane('antemasuratoare_lista_cantitati'), 'C2_centralizator_pe_obiectiv.pdf', ...obiecte('C3_centralizator_pe_obiect'),
    ...tronsoane('C4_lista_cantitati'), ...tronsoane('C5_lista_cantitati'),
    'CM_si_echipamente_centralizator_pe_investitie_Infiintare_sistem_de_distributie_gaze_naturale_ADI_Mostistea_Gaze_Sud.pdf',
    ...tronsoane('EN_explicitare_norme'), 'F1_centralizator_pe_obiectiv.pdf', ...obiecte('F2_centralizator_pe_obiect'), ...tronsoane('F3_lista_cantitati'),
  ],
  plansa: [
    '1. Plan de Situatie ADI.pdf', '10. Montaj terminație fir trasor.pdf', '11. Detaliu de îmbinare a firului trasor.pdf',
    '12. Plan de amplas. al subtraversării CAA1.pdf', '13. Plan de secțiune al subtraversării CAA1.pdf', '14. Detaliu de montaj al distanțierelor în TP-ul CAA 1.pdf',
    '15. Detaliu groapa de poziție subtrav. .pdf', '16. Detaliu subtraversări Dn, Dj si Dc.pdf', '17. Detaliu de montaj al accesoriilor TP la subtrvs..pdf',
    '18. Planul de montaj al rețelei de distribuție GN.pdf', '19. Detaliu montaj Vana și piesa electroizolantă (DGSR).pdf', '2. Schema Izometrica ADI.pdf',
    '20. Delaliu cupl. rețea nouă în rețea existenta Faza-1-a (DGSR).pdf', '21. Delaliu cupl. rețea nouă în rețea existenta Faza-2-a (DGSR).pdf',
    '22. Detaliu montaj rețea distrb. lateral Dn, Dj, Dc.pdf', '23. Schema SRMP 4.500 mc (DGSR).pdf', '24. Platforma betonată a SRMP SD 4.500 mc (DGSR).pdf',
    '25. Cofret SRMP-SD 4.500 mc (DGSR).pdf', '26. Detaliu grile de aerisire SRMP-SD (DGSR).pdf', '27. Detaliu gaurile de aerisire SRMP-SD (DGSR).pdf',
    '28. Detaliu montaj electrozi împamantare SRMP-SD (DGSR).pdf', '29. Electrod împămîntare SRMP-SD (DGSR).pdf', '3. Monaj cd. la cap terminal pe catg teren A+B.pdf',
    '30. Subtraversari DC.pdf', '31. Subtraversari DN&DJ.pdf', '33. Schema izo SRMP SD (DGSR).pdf', '4. Dist de montaj retea vs utilităti.pdf',
    '5. Profile de șanțuri.pdf', '6. Montaj Tuburi de Protecție (TP-uri).pdf', '7. Execut. gauri de aerisire in TP-u.pdf',
    '8. Detaliu montaj răsf.+capac GN în carosapil.pdf', '9. Montaj răsf. SV.pdf',
  ],
  alta: [
    '32. ATR Nou Distrigaz Sud Retele_ADI (DGSR).pdf', '34. Anexe+solutie (DGSR).pdf', '35. Studiu Geo ADI Mostiștea Gaze Sud.pdf',
    '36.1 PV recepție OCPI-Calărași-Oltenița.pdf', '36.2 PV recepție OCPI-Calărași-Ulmeni.pdf', '36.3 PV recepție OCPI-Calărași-Spanțov.pdf',
    '36.4 PV recepție OCPI-Calărași-Chiselet.pdf', '36.5 PV recepție OCPI-Calărași-Manastirea.pdf', 'Norme ANRE ptr realizarea GIS.rar',
  ],
  raspuns_clarificare: ['Clarificare_Oficiu_Automata_CN1095546.pdf'],
}

describe('lic. 3 (CN1095546) — reclasificarea manuală reprodusă integral', () => {
  it('are exact 160 de nume (9 alta, 70 formular, 48 liste, 32 planșe, 1 clarificare)', () => {
    expect(Object.fromEntries(Object.entries(LIC3).map(([k, v]) => [k, v.length]))).toEqual({ formular: 70, lista_cantitati: 48, plansa: 32, alta: 9, raspuns_clarificare: 1 })
    expect(new Set(Object.values(LIC3).flat()).size).toBe(160)
  })
  for (const [tip, nume] of Object.entries(LIC3)) {
    it(`${tip}: fiecare nume, extras din arhiva publicată ca „clarificare”`, () => {
      const gresite = nume.map(n => [n, tipInArhiva(`DOC_F1_F6_C1_C9 (#1305)/sub/${n}`, 'raspuns_clarificare')]).filter(([, t]) => t !== tip)
      expect(gresite).toEqual([])
    })
  }
  it('niciun fișier fără nume grăitor nu mai moștenește raspuns_clarificare', () => {
    expect(Object.values(LIC3).flat().filter(n => tipInArhiva(n, 'raspuns_clarificare') === 'raspuns_clarificare')).toEqual(['Clarificare_Oficiu_Automata_CN1095546.pdf'])
  })
})

describe('regulile, pe cazurile de margine', () => {
  it('documentele principale ale unei licitații', () => {
    expect(ghicesteTip('Fisa de date a achizitiei.pdf')).toBe('fisa_date')
    expect(ghicesteTip('FISA_DATE_achizitie.pdf.p7s')).toBe('fisa_date')
    expect(ghicesteTip('Instructiuni_ofertanti.pdf')).toBe('fisa_date')
    expect(ghicesteTip('Formulare.docx')).toBe('formular')
    expect(ghicesteTip('DUAE.xml')).toBe('formular')
    expect(ghicesteTip('Model de contract.pdf')).toBe('model_contract')
    expect(ghicesteTip('Conditii generale.pdf')).toBe('model_contract')
    expect(ghicesteTip('Caiet de sarcini.pdf')).toBe('cs_volum')
    expect(ghicesteTip('Volumul 2 - Memoriu tehnic.pdf')).toBe('cs_volum')
    expect(ghicesteTip('Raspuns la solicitarea de clarificari nr 3.pdf')).toBe('raspuns_clarificare')
    expect(ghicesteTip('Erata 1.pdf')).toBe('raspuns_clarificare')
    expect(ghicesteTip('Raspuns consolidat la clarificari.pdf')).toBe('raspuns_clarificare')
    expect(ghicesteTip('Documentatie consolidata.pdf')).toBe('alta')   // documentație revizuită, nu răspuns
    expect(ghicesteTip('Planse.zip')).toBe('alta')   // arhiva e container (se despachetează), nu se citește
    expect(ghicesteTip('traseu.dwg')).toBe('plansa')
    expect(ghicesteTip('ceva.pdf')).toBe('alta')
  })
  it('caietul / volumul câștigă în fața codului eDevize și a vocabularului de planșă', () => {
    expect(ghicesteTip('C1 Caiet de sarcini.pdf')).toBe('cs_volum')
    expect(ghicesteTip('Caiet de sarcini montaj.pdf')).toBe('cs_volum')
    expect(ghicesteTip('3. Memoriu tehnic subtraversari.pdf')).toBe('cs_volum')
  })
  it('vocabularul larg de planșă cere număr de foaie și niciun cuvânt de text', () => {
    // un text luat drept planșă nu se mai citește deloc (ofertare_doc_de_citit sare planșele) — de aici prudența
    expect(ghicesteTip('Procedura de montaj.pdf')).toBe('alta')
    expect(ghicesteTip('3. Procedura de montaj.pdf')).toBe('alta')
    expect(ghicesteTip('4. Breviar de calcul subtraversare.pdf')).toBe('alta')
    expect(ghicesteTip('Specificatie tehnica montaj.pdf')).toBe('alta')
    expect(ghicesteTip('Detalii de executie.pdf')).toBe('alta')
    expect(ghicesteTip('Program de control al calitatii.pdf')).toBe('alta')
    expect(ghicesteTip('Profil candidat.pdf')).toBe('alta')
    expect(ghicesteTip('7. Detaliu montaj.pdf')).toBe('plansa')
    expect(ghicesteTip('Plan de situatie.pdf')).toBe('plansa')   // planul de situație e desen și fără număr
    expect(ghicesteTip('Plan de amplasament.pdf')).toBe('plansa')
  })
  it('F1–F3 sunt liste de cantități, celelalte coduri F/C sunt formulare', () => {
    expect(ghicesteTip('F3.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('F3_lista.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('F3 Lista.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('F4_ceva.pdf')).toBe('formular')
    expect(ghicesteTip('C12_ceva.pdf')).toBe('formular')
    expect(ghicesteTip('C5_ceva.pdf')).toBe('lista_cantitati')   // eDevize: C2–C5 sunt liste / centralizatoare
    expect(ghicesteTip('C5 FARA VALORI.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('C4.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('C6 FARA VALORI EXTINDERE.pdf')).toBe('formular')
    expect(ghicesteTip('do_ceva.pdf')).toBe('formular')
    expect(ghicesteTip('document.pdf')).toBe('alta')      // „do” doar ca prefix urmat de separator
  })
  it('diacriticele și calea nu contează', () => {
    expect(ghicesteTip('Fișa de date.pdf')).toBe('fisa_date')
    expect(ghicesteTip('Planșe.pdf')).toBe('plansa')
    expect(ghicesteTip('Arhiva (#12)/sub/dir\\F3_lista.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('Clarificari (#9)/x.pdf')).toBe('alta')   // calea („Clarificari”) nu dă tipul, doar numele
    expect(numeFisier('a/b\\c.pdf')).toBe('c.pdf')
    expect(numeFisier(null)).toBe('')
    expect(ghicesteTip(undefined)).toBe('alta')
  })
})

describe('review adversarial 07.10 (dry-run pe 1333 documente) — cazurile reparate', () => {
  it('„_” e separator: \\bcs\\b / \\bnota\\b / \\batr\\b văd numele cu underscore', () => {
    for (const n of ['CAIET SARCINI LOT 1/RGZ 2025_18_CS_Vol_II.pdf', 'RGZ 2025_18_CS_Vol_I_Constructii.pdf', 'RGZ 2025_18_CS_Vol_I_Electroenergetice.pdf'])
      expect(ghicesteTip(n), n).toBe('cs_volum')
    expect(ghicesteTip('12_Nota_justificativa_subtraversare.pdf')).toBe('alta')
    expect(ghicesteTip('05_Nota_tehnica_montaj_conducte.pdf')).toBe('alta')
    expect(ghicesteTip('3_ATR_Distrigaz.pdf')).toBe('alta')
    expect(ghicesteTip('1_Plan_de_situatie.pdf')).toBe('plansa')
  })
  it('avize / acorduri / CU / studii / PV se decid ÎNAINTEA planșelor (altfel nu se mai citesc)', () => {
    for (const n of ['07. Aviz CNAIR subtraversare DN29D.pdf', '5. Aviz Apele Romane subtraversare parau.pdf', '6. Acord ABA Arges-Vedea subtraversare canal.pdf',
      '3. Aviz Distrigaz - schema de racordare.pdf', '4. Certificat de urbanism - plan de situatie.pdf', 'Certificat de urbanism si plan de situatie.pdf',
      'Studiu topografic.pdf', 'PV receptie OCPI - documentatie topografica.pdf', 'Raport topo.pdf'])
      expect(ghicesteTip(n), n).not.toBe('plansa')
    expect(ghicesteTip('12. Detaliu racord.pdf')).toBe('plansa')   // „racord” nu e „acord”
  })
  it('garda de text: niciun text numerotat cu vocabular de desen nu devine planșă', () => {
    for (const n of ['5. PCCVI montaj retea gaze.pdf', '5. Plan de control al calitatii - montaj conducte.pdf', '2. Tema de proiectare subtraversare DJ.pdf',
      '4. Solutie tehnica subtraversare.pdf', '3. Conditii tehnice de montaj.pdf', '9. Masuri SSM la montajul conductelor.pdf', '4. Fisa tehnica robinet montaj ingropat.pdf',
      '6. Expertiza tehnica platforma SRM.pdf', '12. Fise tehnice montaj robinet.pdf', '4. Lista utilaje montaj.pdf', '2. Descriere solutie subtraversare DN1.pdf',
      '6. Conditii de montaj si executie subtraversare.pdf', '9. Plan de control calitate montaj.pdf', '5_Plan_ul de securitate montaj.pdf', '10. Masuri SSM la montaj.pdf',
      '11. Cerinte tehnice montaj.pdf', '8. Tabel coordonate profil longitudinal.pdf', '2. Tema de proiectare profil.pdf', '1. Borderou piese desenate.pdf',
      'Cuprins piese desenate.docx', 'Lista planse.pdf'])
      expect(ghicesteTip(n), n).not.toBe('plansa')
  })
  it('răspunsurile la clarificări câștigă în fața planșei / listei / contractului (se citesc și apar în Termene)', () => {
    for (const n of ['Erata planse.pdf', 'Clarificare nr 2 - planse revizuite.pdf', 'Raspuns clarificare privind plansele de subtraversare.pdf',
      'Raspuns consolidat clarificari - desene.pdf', 'Clarificare liste de cantitati.pdf', 'Centralizator clarificari.pdf', 'Centralizator intrebari si raspunsuri.pdf',
      'Raspuns clarificari studiu topografic.pdf'])
      expect(ghicesteTip(n), n).toBe('raspuns_clarificare')
  })
  it('„Solicitare de clarificări” e întrebarea ofertantului, nu răspuns (Termene: altfel act fals + alarma AC stinsă)', () => {
    for (const n of ['02_clarificari/clarificari/LOT2/Solicitare de clarificari 3_LOT2.docx', 'Solicitare de clarificari 3_LOT2.docx.p7s',
      'Solicitare clarificari.pdf', 'Cerere de clarificare.pdf', 'Intrebari clarificari.pdf'])
      expect(ghicesteTip(n), n).toBe('alta')
    expect(ghicesteTip('Raspuns la solicitarea de clarificari nr 3.pdf')).toBe('raspuns_clarificare')
    // Copilot conv. 3 (NO-GO r2, P1): numărul intercalat
    for (const n of ['Solicitarea nr. 3 de clarificari.pdf', 'Cererea nr 2 de clarificari.pdf', 'Solicitarea numarul 4 de clarificari.pdf', 'Intrebarea nr. 1 clarificari.pdf'])
      expect(ghicesteTip(n), n).toBe('alta')
    expect(ghicesteTip('Raspuns la solicitarea nr. 3 de clarificari.pdf')).toBe('raspuns_clarificare')
  })
  it('caietul de sarcini câștigă în fața „condițiilor generale”; modelul de contract rămâne', () => {
    expect(ghicesteTip('Caiet de sarcini - Conditii generale.pdf')).toBe('cs_volum')
    expect(ghicesteTip('CS 01 - Conditii generale de executie.pdf')).toBe('cs_volum')
    expect(ghicesteTip('Caiet de sarcini conditii specifice montaj conducte PE.pdf')).toBe('cs_volum')
    expect(ghicesteTip('5_3_Conditii_generale_HG1.pdf')).toBe('model_contract')
  })
  it('volumul de liste dintr-un caiet e listă; partea scrisă a PT e volum (dry-run lic. 1, 3, 9)', () => {
    expect(ghicesteTip('CAIET SARCINI LOT 1/RGZ 2025_18_CS_Vol_III_liste cu cantitati de lucrari.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('3.1 - PT - Partea scrisa 1.pdf')).toBe('cs_volum')
    expect(ghicesteTip('A. Sf parte scrisa - extindere gaze -fara valori POTLOGI .pdf')).toBe('cs_volum')
    expect(ghicesteTip('MEMORIU.pdf')).toBe('cs_volum')
  })
  it('volumul de desene e planșă, volumul de memoriu e caiet', () => {
    for (const n of ['VOLUM DESENE.pdf', 'Volumul II Planse.pdf', 'Volum III - Plansa.pdf', 'RGZ 2025_18_CS_Vol_I_Montaj_Desene.pdf', 'CS Vol II - Planse.pdf']) expect(ghicesteTip(n), n).toBe('plansa')
    expect(ghicesteTip('Volumul 2 - Memoriu tehnic.pdf')).toBe('cs_volum')
    expect(ghicesteTip('Volumul 1.pdf')).toBe('cs_volum')
  })
  it('planșe prinse în plus (cost mic dacă greșește): dwg în nume, „desen” la singular', () => {
    expect(ghicesteTip('CLJ-00-PL-DWG-001-Plan de situatie existent FILA 1.pdf')).toBe('plansa')
    expect(ghicesteTip('B.1 SF DESEN-POTLOGI.pdf')).toBe('plansa')
    expect(ghicesteTip('Parte desenata 1 din 4.pdf')).toBe('plansa')
  })
  it('folderul e indiciu doar când numele tace — fără planșă, răspuns doar din folder „răspuns”', () => {
    expect(ghicesteTip('3.Raspuns consolidat_06.08.2026/Adresa 1234.pdf')).toBe('raspuns_clarificare')
    expect(ghicesteTip('LISTE CANTITATI/Obiect 1.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('02_clarificari/Adresa.pdf')).toBe('alta')     // folderul nostru de întrebări nu face răspuns
    expect(ghicesteTip('Planse/Breviar.pdf')).toBe('alta')            // un text din „Planșe” rămâne de citit
    expect(ghicesteTip('LISTE CANTITATI FARA VALOR/C6 FARA VALORI.PDF')).toBe('formular')   // numele câștigă (calibrarea lic. 3)
    expect(ghicesteTip('Clarificari (#9)/sub/x.pdf')).toBe('alta')    // spațiul de nume al arhivei se sare
  })
})

describe('review adversarial r2 (07.10) — cazurile reparate', () => {
  it('o ARHIVĂ e „alta” (container): un tip esențial pe ea ar bloca poarta de completitudine (lic. 103)', () => {
    for (const n of ['LISTE CANTITATI FARA VALORI.zip', 'Caiet de sarcini.rar', 'Fisa de date.zip.p7s', 'RGZ_18_CS_Vol_II.7z', 'Volumul 3 - Planse.zip'])
      expect(ghicesteTip(n), n).toBe('alta')
    expect(tipInArhiva('X (#5)/Caiet de sarcini.rar', 'cs_volum')).toBe('alta')
  })
  it('planșa „slabă” (număr + desen) cedează în fața folderului și a arhivei de caiet / listă', () => {
    expect(ghicesteTip('Caiete de sarcini/05. Montaj conducte PE.pdf')).toBe('cs_volum')
    expect(ghicesteTip('Liste cantitati/3. Subtraversari.pdf')).toBe('lista_cantitati')
    expect(tipInArhiva('05. Montaj conducte PE.pdf', 'cs_volum')).toBe('cs_volum')
    expect(tipInArhiva('3. Subtraversari.pdf', 'lista_cantitati')).toBe('lista_cantitati')
    expect(tipInArhiva('Planse (#4)/7. Detaliu montaj.pdf', 'alta')).toBe('plansa')
    expect(ghicesteTip('Planse/7. Detaliu montaj.pdf')).toBe('plansa')
  })
  it('garda de text acoperă actele administrative și tehnice uzuale', () => {
    for (const n of ['4. Conventie CFR subtraversare CF 613.pdf', '5. Autorizatie de construire subtraversare DN29.pdf', '5. Decizie CNAIR subtraversare DN1.pdf',
      '2. Prescriptii tehnice de montaj.pdf', '7. Verificari si probe la montaj.pdf', '3. Manual de montaj si exploatare SRM.pdf', '6. Agrement tehnic montaj teava PE.pdf',
      '4. Permis de spargere subtraversare.pdf', 'Autorizatie de construire si plan de situatie vizat.pdf', '5. Declaratie montaj.pdf', '6. Normativ NTPEE montaj.pdf',
      '3. Notificare subtraversare CF.pdf', '4. Documentatie subtraversare DN29.pdf', '8. Propunere tehnica montaj.pdf', '3. Hotarare CL plan de situatie.pdf'])
      expect(ghicesteTip(n), n).not.toBe('plansa')
  })
  it('schema tehnologică / izometria / dwg cedează și ele în fața cuvintelor de text', () => {
    for (const n of ['Descriere schema tehnologica SRM.pdf', 'Breviar de calcul schema tehnologica SRM.pdf', 'Lista echipamente schema tehnologica.pdf',
      'Specificatie tehnica izometrie racord.pdf', 'Tabel coordonate izometrie.pdf', 'Breviar dwg.pdf'])
      expect(ghicesteTip(n), n).not.toBe('plansa')
    // Copilot conv. 3 (NO-GO r2, P1): garda de text înaintea regulilor tari de desen; extensia .dwg rămâne planșă
    for (const n of ['Raport schema tehnologica.pdf', 'Breviar schema tehnologica.pdf']) expect(ghicesteTip(n), n).toBe('alta')
    expect(ghicesteTip('traseu.dwg')).toBe('plansa')
    expect(ghicesteTip('Schema tehnologica SRM.pdf')).toBe('plansa')
    expect(ghicesteTip('2. Schema Izometrica ADI.pdf')).toBe('plansa')
  })
  it('„Răspuns” / „Erată” bat fișa de date și caietul; caietul revizuit rămâne caiet (decizia 16.09)', () => {
    for (const n of ['Raspuns la clarificari privind fisa de date.pdf', 'Erata nr 1 la Fisa de date.pdf', 'Raspuns la solicitarea de clarificari privind caietul de sarcini.pdf',
      'Erata caiet de sarcini.pdf', 'Rasp. solicitare clarificari nr 3.pdf', 'Clarificare la solicitarea de clarificari nr 2.pdf', 'Clarificari la solicitarile de clarificare.pdf'])
      expect(ghicesteTip(n), n).toBe('raspuns_clarificare')
    expect(ghicesteTip('Caiet de sarcini revizuit dupa clarificari.pdf')).toBe('cs_volum')
  })
  it('caietul care conține liste e listă; „Liste fără valori” e listă', () => {
    for (const n of ['Caiet de sarcini si liste de cantitati.pdf', 'Caiet de sarcini - Vol III - Liste de cantitati.pdf', 'Parte scrisa - liste de cantitati.pdf',
      'Memoriu tehnic si antemasuratori.pdf', 'LISTE -FARA VALORI.pdf', 'Liste fara preturi.pdf'])
      expect(ghicesteTip(n), n).toBe('lista_cantitati')
  })
  it('folderul „fișă de date + formulare” nu face fișă de date din orice', () => {
    expect(ghicesteTip('01_fisa_date_formulare/Cerinte SUSSMPM.pdf')).toBe('alta')
    expect(ghicesteTip('01_fisa_date_formulare/Instructiuni_ofertanti_FisaDate_DF1279352.pdf')).toBe('fisa_date')
  })
})

describe('ZIP desfăcut inline în edge = aceeași clasificare ca în worker (Copilot conv. 3, NO-GO pe 004d9de, P1)', () => {
  it('indiciul arhivei: numele, apoi tipul rândului', () => {
    expect(indiciuArhiva('Caiet de sarcini.zip')).toBe('cs_volum')
    expect(indiciuArhiva('Liste cantitati.zip.p7s')).toBe('lista_cantitati')
    expect(indiciuArhiva('PT.zip', 'cs_volum')).toBe('cs_volum')
    expect(indiciuArhiva('PT.zip')).toBeNull()
  })
  it('copiii cu nume generic primesc contextul arhivei', () => {
    expect(tipInArhiva('Capitol 1.pdf', indiciuArhiva('Caiet de sarcini.zip'))).toBe('cs_volum')
    expect(tipInArhiva('Obiect 1.pdf', indiciuArhiva('Liste cantitati.zip'))).toBe('lista_cantitati')
    expect(tipInArhiva('05. Montaj conducte PE.pdf', indiciuArhiva('Caiet de sarcini.zip'))).toBe('cs_volum')
    expect(tipInArhiva('Fisa de date.pdf', indiciuArhiva('Caiet de sarcini.zip'))).toBe('fisa_date')   // regula proprie câștigă
  })
  it('edge-ul și workerul folosesc AMBELE tipInArhiva + indiciuArhiva pentru copiii unei arhive', () => {
    const edge = readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
    expect(edge).toMatch(/tip: dinZip \? tipInArhiva\(numeFinal, indiciuArhiva\(dinZip\)\) : ghicesteTip\(numeFinal\)/)
    expect(edge).toMatch(/await urcaFisier\(r\.nume, r\.buf, doc\.nume, doc\.nume\)/)   // ZIP-ul desfăcut inline transmite numele arhivei
    const worker = readFileSync(new URL('../worker/ofertare/seap.ts', import.meta.url), 'utf8')
    expect(worker).toMatch(/tip: tipInArhiva\(f\.rel, indiciuArhiva\(d\.nume_original, d\.tip\)\)/)
  })
})

describe('moștenirea din arhivă', () => {
  it('regula proprie câștigă', () => {
    expect(tipInArhiva('X (#1)/F3_lista.pdf', 'cs_volum')).toBe('lista_cantitati')
  })
  it('fără regulă proprie → folderul, apoi tipul arhivei', () => {
    expect(tipInArhiva('X (#1)/ceva.pdf', 'cs_volum')).toBe('cs_volum')
    expect(tipInArhiva('X (#1)/Liste cantitati/ceva.pdf', 'cs_volum')).toBe('lista_cantitati')
  })
  it('NU moștenește planșa: un text dintr-o arhivă „Planșe” s-ar pierde la citire', () => {
    for (const n of ['3. Breviar.pdf', 'Borderou.pdf', 'Nota de calcul.pdf', 'Specificatie tehnica conducta.pdf', 'ceva.pdf'])
      expect(tipInArhiva(`Planse (#7)/${n}`, 'plansa'), n).toBe('alta')
    expect(tipInArhiva('Planse (#7)/12. Detaliu montaj.pdf', 'plansa')).toBe('plansa')   // regula proprie rămâne
  })
  it('o arhivă imbricată fără nume grăitor nu moștenește (tip esențial pe o arhivă = poartă de completitudine blocată)', () => {
    expect(tipInArhiva('Volum PT (#3)/x.zip', 'cs_volum')).toBe('alta')
    expect(tipInArhiva('Volum PT (#3)/x.rar.p7s', 'lista_cantitati')).toBe('alta')
  })
  it('dar NU raspuns_clarificare și nici lipsa tipului', () => {
    expect(tipInArhiva('X (#1)/ceva.pdf', 'raspuns_clarificare')).toBe('alta')
    expect(tipInArhiva('X (#1)/ceva.pdf', null)).toBe('alta')
    expect(tipInArhiva('X (#1)/ceva.pdf', undefined)).toBe('alta')
    expect(tipInArhiva('X (#1)/Raspuns clarificare 2.pdf', 'raspuns_clarificare')).toBe('raspuns_clarificare')
  })
  it('tipExplicit întoarce null când numele nu spune nimic', () => {
    expect(tipExplicit('ceva.pdf')).toBeNull()
    expect(tipExplicit('Anexa.docx')).toBe('alta')
  })
})

describe('arhivele și adâncimea', () => {
  it('esteArhiva', () => {
    for (const n of ['a.zip', 'A.RAR', 'b.7z', 'c.zip.p7s', 'Dir (#3)/inner.rar']) expect(esteArhiva(n)).toBe(true)
    for (const n of ['a.pdf', 'a.zip.pdf', 'zip', 'a.tar.gz', null, undefined]) expect(esteArhiva(n)).toBe(false)
  })
  it('adâncimea = câte spații „(#id)” are numele', () => {
    expect(adancimeArhiva('Doc.zip')).toBe(0)
    expect(adancimeArhiva('Doc (#1305)/inner.zip')).toBe(1)
    expect(adancimeArhiva('Doc (#1305)_inner (#1400)/x.rar')).toBe(2)
    expect(adancimeArhiva('A (#1)_B (#2)_C (#3)/x.7z')).toBe(3)
    expect(adancimeArhiva(null)).toBe(0)
    expect(MAX_ADANCIME_ARHIVE).toBe(3)
  })
})

describe('paritatea cu api/_tipDocument.js (funcțiile Vercel nu importă din afara api/)', () => {
  it('copie byte cu byte', () => {
    const sursa = readFileSync(new URL('../supabase/functions/_shared/tipDocument.mjs', import.meta.url))
    const copie = readFileSync(new URL('../api/_tipDocument.js', import.meta.url))
    expect(copie.equals(sursa)).toBe(true)
  })
  it('nicio copie locală veche a regulilor rămasă în consumatori', () => {
    for (const f of ['../api/seap-import.js', '../supabase/functions/ofertare-seap-import/index.ts', './OfertareLicitatii.jsx', '../worker/ofertare/seap.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/function ghicesteTip\s*\(/)
    }
  })
})
