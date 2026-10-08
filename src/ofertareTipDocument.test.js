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
    expect(edge).toMatch(/await urcaFisier\(alegere\.nume, r\.buf, doc\.nume, doc\.nume,/)   // ZIP-ul desfăcut inline transmite numele arhivei
    const worker = readFileSync(new URL('../worker/ofertare/seap.ts', import.meta.url), 'utf8')
    expect(worker).toMatch(/tip: tipInArhiva\(ds\.nume, indiciuArhiva\(d\.nume_original, d\.tip\)\)/)   // numele după desfacerea semnăturii
  })
})

describe('.p7m: arhivele (var. A, #644) + documentele „X (semnat).ext” (var. B, Răzvan 07.10.2026 seara)', () => {
  it('arhivele semnate .p7m sunt arhive (container → alta); documentele .p7m nu sunt', () => {
    for (const n of ['Raspuns clarificari consolidat.rar.p7m', 'Raspuns consolidat la solicitarile de clarificari - 2.rar.p7m', 'PT.zip.p7m', 'X.7z.P7M', 'X.part1.rar.p7m'])
      expect(esteArhiva(n), n).toBe(true)
    for (const n of ['Caiet de sarcini.pdf.p7m', 'Formulare.docx.p7m', 'X.rar.pdf.p7m']) expect(esteArhiva(n), n).toBe(false)
    expect(ghicesteTip('Raspuns clarificari consolidat.rar.p7m')).toBe('alta')
  })
  it('toate cele 4 drumuri desfac semnătura cu ACEEAȘI funcție (_shared/semnaturaCms.mjs); nicio copie locală a parserului', () => {
    for (const f of ['../supabase/functions/ofertare-seap-import/index.ts', '../supabase/functions/ofertare-seap-veghe/index.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).toMatch(/import \{[^}]*\bdesface\b[^}]*\} from '\.\.\/_shared\/semnaturaCms\.mjs'/)
      expect(src, f).not.toMatch(/function desfaSemnatura|OID_DATA/)
    }
    expect(readFileSync(new URL('../api/seap-import.js', import.meta.url), 'utf8')).toMatch(/from '\.\/_semnaturaCms\.js'/)
    expect(readFileSync(new URL('../worker/ofertare/seap.ts', import.meta.url), 'utf8')).toMatch(/from '\.\.\/\.\.\/supabase\/functions\/_shared\/semnaturaCms\.mjs'/)
  })
  it('inventarul rândurilor existente folosește cheieRand pe TOATE drumurile (rândul brut „X.pdf.p7s” ≠ „X.pdf”, Copilot NO-GO r1 pe #649)', () => {
    for (const f of ['../supabase/functions/ofertare-seap-import/index.ts', '../supabase/functions/ofertare-seap-veghe/index.ts', '../api/seap-import.js', '../worker/ofertare/seap.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/(urcate|placeholders|cunoscute|urcateAcum|toateCunoscute|numeCunoscute)[^\n]*\.map\(\(?d[^)]*\)? => \[?cheieNume\(d\.nume_original\)/)
      expect(src, f).toMatch(/cheieRand\(d\.nume_original\)/)
    }
  })
  it('veghea, canalul de clarificări: fișierul adus intră „neprocesat”, fără notă → „….rar.p7m” ajunge la bucla workerului (Copilot r3 pe #644); DOAR un document nedesfăcut intră „ignorat” cu nota (#20)', () => {
    const veghe = readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
    const ins = veghe.match(/\.insert\(\{\s*licitatie_id: lic\.id, fisier_path: path,[\s\S]*?\}\);/)
    expect(ins, 'insert-ul din canalul de clarificări').toBeTruthy()
    expect(ins[0]).toMatch(/status_procesare: notaSemn \? 'ignorat' : 'neprocesat'/)
    expect(ins[0]).toMatch(/\.\.\.\(notaSemn \? \{ eroare: notaSemn \} : \{\}\)/)   // altfel fără notă
    expect(veghe).toMatch(/const notaSemn = ds\.nota && !esteArhiva\(ds\.nume\) \? ds\.nota : null/)   // arhiva: niciodată notă
    // documentația inițială nu se descarcă în veghe: placeholder fără fișier → îl ia drumul SEAP (aduLicitatie)
    expect(veghe).toMatch(/fisier_path: `\$\{lic\.id\}\/atribuire\/neincarcat\//)
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

describe('edge seap-import: ZIP-ul întreg pleacă la NAS abia după dovezile din manifest (review PR-C P1)', () => {
  it('scrieManifest() + golirea listei stau ÎNAINTEA urcării ZIP-ului întreg (bucla NAS l-ar revendica fără dovezi → dubluri)', () => {
    const src = readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
    const bloc = src.slice(src.indexOf('if (!rz.complet || necititeDinZip)'), src.indexOf('} else {', src.indexOf('if (!rz.complet || necititeDinZip)')))
    const iM = bloc.indexOf('await scrieManifest()'), iG = bloc.indexOf('manifest.length = 0'), iU = bloc.indexOf('await urcaFisier(numeFinal, buf')
    expect([iM > 0, iG > iM, iU > iG]).toEqual([true, true, true])
    // Jakarinos pe PR-C: ZIP-ul pleacă DOAR dacă dovezile s-au scris (altfel rămâne pentru rularea următoare)
    expect(bloc).toMatch(/if \(await scrieManifest\(\)\) \{\s*manifest\.length = 0;\s*await urcaFisier\(numeFinal, buf/)
  })
  it('intrarea sărită ca „deja” lasă legătura (arhiva curentă, cale) → document în manifest; rezerva scrie dovezile înainte; „adusă” doar fără nerecuperate', () => {
    const src = readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/if \('deja' in alegere\) \{[\s\S]{0,1500}stare: 'deja_in_platforma'/)
    // Jakarinos r2: legătura nu suprascrie dovada „urcat” a aceleiași chei (reluare peste aceeași arhivă)
    expect(src).toMatch(/if \(!\(manUrcat \|\| \[\]\)\.some\(areDovada\) && !manifest\.some\(areDovada\)\) manifest\.push\(rand\)/)
    // Jakarinos r2: dovezi nescrise → rezerva DownloadArchive amânată, nu pornită
    expect(src).toMatch(/const doveziScrise = !nevoieDeArhiva \|\| await scrieManifest\(\);/)
    expect(src).toMatch(/if \(nevoieDeArhiva && doveziScrise\) \{\s*if \(!perFisierOk\)/)
    expect(src).toMatch(/if \(deLaIndex === 0 && !arhivaIncompleta && !nerecuperate\) await supa\.from\('ofertare_licitatii'\)/)
    // Jakarinos r3: dovada „urcat” se păstrează doar dacă spune același lucru (document + sha), altfel legătura nouă o înlocuiește
    expect(src).toMatch(/rr\.document_id === rand\.document_id && rr\.sha256 === rand\.sha256/)
    // Jakarinos r2: upload sau rând BD eșuat = nerecuperat (urcaFisier întoarce succesul real)
    expect(src).toMatch(/if \(eUp\) \{ nerecuperate\+\+;/)
    expect(src).toMatch(/else nerecuperate\+\+;[^\n]*\n\s*urcatiOcteti \+= buf\.length;\n\s*return !!docId;/)
  })
})

describe('paritatea cu api/_tipDocument.js (funcțiile Vercel nu importă din afara api/)', () => {
  it('copie byte cu byte', () => {
    const sursa = readFileSync(new URL('../supabase/functions/_shared/tipDocument.mjs', import.meta.url))
    const copie = readFileSync(new URL('../api/_tipDocument.js', import.meta.url))
    expect(copie.equals(sursa)).toBe(true)
  })
  // 08.10.2026: aceeași regulă pentru celelalte copii din api/ (semnătura CMS #649, ZIP-ul și paginarea — audit #9/#21)
  it.each([['semnaturaCms.mjs', '_semnaturaCms.js'], ['zipFlux.mjs', '_zipFlux.js'], ['paginat.mjs', '_paginat.js']])('_shared/%s = api/%s byte cu byte', (src, api) => {
    const sursa = readFileSync(new URL(`../supabase/functions/_shared/${src}`, import.meta.url))
    const copie = readFileSync(new URL(`../api/${api}`, import.meta.url))
    expect(copie.equals(sursa)).toBe(true)
  })
  it('nicio copie locală veche a regulilor rămasă în consumatori', () => {
    for (const f of ['../api/seap-import.js', '../supabase/functions/ofertare-seap-import/index.ts', './OfertareLicitatii.jsx', '../worker/ofertare/seap.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/function ghicesteTip\s*\(/)
    }
  })
})

describe('audit #4 var. B — codul SEAP ca identitate (Răzvan 08.10.2026: L1 = A, N = A, M = A, S = B, P = A, 4 = A)', () => {
  const edge = () => readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
  const veghe = () => readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
  it('edge: decizia vine din _shared/codSeap.mjs, iar inventarul citește codul (și tipul / mărimea / seap_meta pentru versiuni, verificare, GetAll)', () => {
    const src = edge()
    expect(src).toMatch(/import \{[^}]*\bdecideSeap\b[^}]*\} from '\.\.\/_shared\/codSeap\.mjs'/)
    expect(src).toMatch(/\.select\('id, nume_original, fisier_path, seap_cod, tip, size_bytes, seap_meta'\)\.eq\('licitatie_id', licitatieId\)/)
    expect(src).toMatch(/documente\.push\(\{ nume, url: link, cod: codDin\(f\) \}\)/)
    expect(src).not.toMatch(/function (decideSeap|numeVersiune|eDuplicatCod)\s*\(/)   // nicio copie locală a regulilor
    // lista și inventarul pe cheile SEAP (echivalența .p7s ≡ document): rivalii se văd în ambele ordini (review PR-1, P1)
    expect(src).toMatch(/const lista = indexLista\(documente, \(n: string\) => cheiSeapCu\(n, cheieNume\)\);/)
    expect(src).toMatch(/inventarCod\(dejaAre \|\| \[\], \{ cheieRand, cheiSeap: \(n: string\) => cheiSeapCu\(n, cheieNume\),/)
  })
  it('edge: pe drumul per fișier numele decide DOAR fără cod; rezerva DownloadArchive rămâne pe nume, fără cod', () => {
    const src = edge()
    expect(src).not.toMatch(/if \(dejaSubUnNume\(urcate, doc\.nume\) \|\|/)
    expect(src).toMatch(/const dec: any = decideSeap\(inv, lista, doc0, cheiSeapCu\(doc0\.nume, cheieNume\), \{ adoptie: ADOPTIE \}\);/)
    expect(src).toMatch(/if \(dec\.fel === 'fara_cod' && dejaSubUnNume\(urcate, doc0\.nume\)\)/)
    // E5 (r5): arhiva se parcurge mereu de la prima intrare (un de_la_index primit e poziție în lista SEAP, nu în ZIP)
    expect(src).toMatch(/const sarim = dejaSubUnNume\(urcate, h\.nume\) \|\| JUNK_RE\.test\(h\.nume\) \|\| preaMare;/)
    expect(src).not.toMatch(/deLaIndexArhiva|index = deLaIndex; \}/)
    expect(src).toMatch(/await urcaFisier\(r\.nume, r\.buf, 'seap:downloadarchive', null, esteArhiva\(r\.nume\) \? null : r\.nota, h\.nume\);/)   // fără al 8-lea argument
    // semnătura unui document listat: sărită, dar nu „ambiguă”
    expect(src).toMatch(/else if \(dec\.motiv !== 'semnatura'\) raport\.coduri_ambigue\.push\(/)
  })
  it('edge: codul NU ajunge pe copiii ZIP-ului desfăcut inline (doar aparut_ulterior la o versiune); doar nivelul de sus îl primește', () => {
    const src = edge()
    const copii = src.split('\n').filter((l) => l.includes('await urcaFisier(alegere.nume'))
    expect(copii.length).toBe(1)
    expect(copii[0]).not.toMatch(/campuri|seap_cod/)
    expect(copii[0]).toMatch(/h\.nume, h\.nume, planCopii\);$/)
    expect(src).toMatch(/const planCopii = decF\.fel === 'versiune' \? \{ aparut_ulterior: true \} : null;/)
    expect(src).toMatch(/await urcaFisier\(numeFinal, buf, null, null, null, doc\.nume, null, campuri\)/)
    expect(src).toMatch(/await urcaFisier\(numeFinal, buf, null, null, esteArhiva\(numeFinal\) \? null : ds\.nota, doc\.nume, null, campuri\)/)
    expect(src).toMatch(/seap: Record<string, unknown> \| null = null\) => \{/)   // al 8-lea parametru, adăugat la coadă
    // ZIP-ul unei versiuni / al unui frate, desfăcut complet inline, se urcă și întreg, cu codul — dovezile copiilor ÎNAINTE
    expect(src).toMatch(/\} else if \(strict\) \{[\s\S]{0,900}?if \(await scrieManifest\(\)\) \{\s*manifest\.length = 0;\s*await urcaFisier\(numeFinal, buf, null, null, null, doc\.nume, null, campuri\)/)
  })
  it('edge: intrările peste 20 MB din ZIP-ul unui document merg la NAS (ZIP-ul întreg), nu la „Sărite (prea mari)” (review PR-1)', () => {
    const src = edge()
    expect(src).toMatch(/if \(h\.usize > PRAG_MARE\) \{ necititeDinZip\+\+; raport\.lasate_pentru_nas\.push\(/)
    expect(src).toMatch(/lasate_pentru_nas: \[\] as string\[\]/)
  })
  it('edge: codul deja pe alt rând = prezent — obiectul abia urcat se șterge înainte de manifest și nu se numără „nerecuperat”', () => {
    const src = edge()
    const iD = src.indexOf('if (sc.duplicat) {'), iR = src.indexOf(".remove([path])", iD), iM = src.indexOf('await noteazaManifest(arhivaCheie, caleManifest ?? numeFinal, buf, docId')
    expect([iD > 0, iR > iD, iM > iR]).toEqual([true, true, true])
    expect(src.slice(iD, iM)).not.toMatch(/nerecuperate\+\+/)
  })
  it('edge: verificarea pe conținut — nimic citit înainte de descărcare; din Storage doar aceeași mărime, cu plafon pe document și octeții în buget (anti-bug 3)', () => {
    const src = edge()
    const bloc = src.slice(src.indexOf('const shaDinStorage = async'), src.indexOf('const shaRanduri = async'))
    expect(bloc).toMatch(/marime <= PRAG_MARE/)
    expect(bloc).toMatch(/urcatiOcteti \+= b\.length;/)
    expect(bloc).toMatch(/\} catch \(_\) \{ sha = null; \}/)
    const sr = src.slice(src.indexOf('const shaRanduri = async'), src.indexOf('const areDovada ='))
    expect(sr).toMatch(/if \(!lungimi\.includes\(marime\)\) \{ m\.set\(r\.id, ALT_CONTINUT\); continue; \}/)   // altă mărime = alt conținut, fără citire
    expect(sr).toMatch(/if \(citit \+ marime > PLAFON_CANDIDATI\) \{ m\.set\(r\.id, null\); continue; \}/)
    expect(sr).toMatch(/if \(sha && shas\.has\(sha\)\) return m;/)                                          // prima potrivire ajunge
    // înainte de descărcare doar verificabil (pur, fără citiri); candidații se citesc DUPĂ descărcare și pragul de mărime
    const iV = src.indexOf('if (!verificabil(dec, areDovada)) {'), iF = src.indexOf('const rd = await fetchSeap(link'), iP = src.indexOf('if (cl > PRAG_MARE) {', iF)
    const iS = src.indexOf('decF = rezolvaVerificare(dec, shas, await shaRanduri(dec.candidati, new Set(shas), lungimi));')
    expect([iV > 0, iF > iV, iP > iF, iS > iP]).toEqual([true, true, true, true])
    expect(src).toMatch(/urcatiOcteti \+= brut\.length;   \/\/ anti-bug 3/)
  })
  it('edge: un frate cu ACELAȘI conținut ca un rând existent nu se dublează (fără rând „neprocesat” de citit din nou)', () => {
    const src = edge()
    const bloc = src.slice(src.indexOf("if (decF.fel === 'frate') {"), src.indexOf('const campuri = doc0.cod'))
    expect(bloc).toMatch(/const shaR = await shaRanduri\(rude, new Set\(shas\), lungimi\);/)
    expect(bloc).toMatch(/nu se dublează/)
    expect(bloc).toMatch(/i\+\+;[\s\S]*continue;/)
    expect(bloc).not.toMatch(/urcaFisier/)
  })
  it('edge: fiecare ieșire timpurie din bucla per fișier avansează poziția (i++) — next_index rămâne stabil', () => {
    const src = edge()
    const bucla = src.slice(src.indexOf('for (const doc0 of documente) {'), src.indexOf('    index = i;\n  }'))
    expect(bucla.length).toBeGreaterThan(1000)
    let prec = 0
    for (const m of bucla.matchAll(/\bcontinue;/g)) {
      expect(bucla.slice(prec, m.index), `continue la ${m.index}`).toMatch(/\bi\+\+/)
      prec = m.index + 'continue;'.length
    }
  })
  it('veghea: decide pe cod (aceeași funcție), pornește importul și pentru adopții / frați / verificări; versiunile intră la răspunsuri + mail (M = A) — R1: doar din rândul importat', () => {
    const src = veghe()
    expect(src).toMatch(/import \{[^}]*\bdecideSeap\b[^}]*\} from '\.\.\/_shared\/codSeap\.mjs'/)
    expect(src).toMatch(/const dec: any = decideSeap\(inv, lista, d, cheiSeap\(d\.nume\), \{ adoptie: ADOPTIE \}\);/)
    // Copilot r1: fără NICIO cale de dovadă → nu se pornește importul, dar se raportează (identitate_neverificata)
    expect(src).toMatch(/if \(dec\.fel === 'verifica' && !verificabil\(dec, \(r: any\) => !!dovezi\.get\(r\.id\)\)\) \{ neverificate\.push\(`\$\{d\.nume\} \(\$\{d\.cod\}\)`\); continue; \}/)
    // R1 (r4): versiunea NU intră în `noi`; grupa răspunsuri + mail le ia DOAR din rândurile importate cu de_anuntat
    expect(src).toMatch(/if \(dec\.fel === 'versiune'\) \{ versiuni\.add\(dec\.nume\); versiuniCod\.push\(\{ nume: dec\.nume, cod: d\.cod \}\); continue; \}/)
    // E2 (r5): listele de versiuni se fac PE CANAL (clopoțel / mail), fiecare cu grupa ei de răspunsuri
    // r6: listele se fac din grupul PROASPĂT (ancora + membrii revendicați), nu dintr-un grup de reluat
    expect(src).toMatch(/const grupNou = anc && !G \? \[anc, \.\.\.membriRev\] : \[\];/)
    expect(src).toMatch(/let vNotif = destinatariNecunoscuti \? \[\] : grupNou\.filter\(\(d: any\) => !d\.seap_meta\?\.notificat_la\);/)
    expect(src).toMatch(/let vMail = grupNou\.filter\(\(d: any\) => !d\.seap_meta\?\.mail_la\);/)
    expect(src).toMatch(/const versiuniNotif = vNotif\.map\(\(d: any\) => d\.nume_original as string\);\s*const versiuniMail = vMail\.map\(\(d: any\) => d\.nume_original as string\);/)
    expect(src).toMatch(/for \(const n of \[\.\.\.noi\.filter\(esteRaspuns\), \.\.\.versiuniCanal, \.\.\.raspunsuriAduse\]\)/)
    expect(src).toMatch(/const raspunsuri = grupa\(versiuniNotif\);[^\n]*\n\s*const raspunsuriMail = grupa\(versiuniMail\);/)
    expect(src).toMatch(/const restul = noi\.filter\(\(n\) => !esteRaspuns\(n\) && !areNume\(cheiRaspunsuriAduse, n\)\);/)
  })
  it('veghea (review PR-1, P1): importurile TĂCUTE rulează într-o a doua trecere, DUPĂ toate anunțurile și mailurile, cu buget de timp', () => {
    const src = veghe()
    // nimic de anunțat și nicio versiune → licitația intră în a doua trecere, fără import aici
    expect(src).toMatch(/if \(!noi\.length && !versiuni\.size && !raspunsuriAduse\.length && !termen\?\.nou && !areDeAnuntat\) \{[\s\S]{0,300}?if \(deRezolvat\) tacute\.push\(\{ id: lic\.id, coduri, camp: 'import' \}\);[^\n]*\n\s*continue;/)
    // în bucla licitațiilor importul se pornește DOAR pentru documente noi SAU versiuni (R1: adusă și anunțată în aceeași rulare);
    // E6 (r5): pornit doar de versiuni → fara_rezerva_arhiva
    expect(src).toMatch(/if \(noi\.length \|\| versiuni\.size\) \{\s*const erori: string\[\] = \[\];\s*optImport = noi\.length \? \{\} : \{ fara_rezerva_arhiva: true \};\s*coduri\.import = await importa\(lic\.id, false, erori, optImport\);\s*if \(erori\.length\) coduri\.import_erori = erori;\s*\}/)
    expect(src).not.toMatch(/noi\.length \|\| deRezolvat/)
    const iMail = src.lastIndexOf("subject: `SEAP — raspuns de la autoritate"), iDoi = src.indexOf('for (const t of tacute) t.coduri[t.camp] = await importa(t.id, true, null, t.optiuni ?? {}, t.runde ?? RUNDE_IMPORT);')
    expect([iMail > 0, iDoi > iMail]).toEqual([true, true])
    expect(src).toMatch(/if \(cuBuget && Date\.now\(\) - t0 > BUGET_TACUT_MS\) return/)
    // rundele își trec de_la_index (un document care nu converge nu mai oprește toate rundele în același loc)
    expect(src).toMatch(/body: JSON\.stringify\(\{ licitatie_id: licId, de_la_index: de, \.\.\.optiuni \}\),/)
    expect(src).toMatch(/de = Number\(rez\.next_index\) \|\| 0;/)
  })
  it('veghea (review PR-1): un JWT de utilizator cere acces la modulul Ofertare (poarta comună), nu doar o sesiune validă', () => {
    const src = veghe()
    expect(src).toMatch(/import \{ poartaOfertare \} from '\.\.\/_shared\/poartaOfertare\.ts'/)
    expect(src).toMatch(/if \(jwt !== SERVICE\) \{\s*const refuz = await poartaOfertare\(req\);\s*if \(refuz\) return refuz;\s*\}/)
    expect(src).not.toMatch(/anon\.auth\.getUser\(jwt\)/)
  })
  it('veghea: nu adoptă coduri (adopția e doar în import), placeholder-ul rămâne FĂRĂ cod; singura scriere nouă = de_anuntat pe versiunile anunțate', () => {
    const src = veghe()
    expect(src).not.toMatch(/adoptaCod/)
    const i = src.indexOf('fisier_path: `${lic.id}/atribuire/neincarcat/')
    const bloc = src.slice(src.lastIndexOf('.insert({', i), src.indexOf('});', i))
    expect(bloc).toMatch(/aparut_ulterior: true/)
    expect(bloc).not.toMatch(/seap_cod/)
    // versiunea adusă de ORICINE (UI, NAS) se anunță o dată: flag-ul se stinge DUPĂ notificări și mail
    // r5: confirmarea (care stinge flag-ul) se face DUPĂ clopoțel și mail (funcția `confirma` e doar definită mai sus)
    const iMail = src.indexOf('const rm = await trimiteMail(planMail.corp, planMail.cheie);'), iF = src.indexOf('if (anc && !G) await incheie(')
    expect([iMail > 0, iF > iMail]).toEqual([true, true])
    expect(src).toMatch(/if \(meta\.notificat_la && meta\.mail_la\) \{ meta\.de_anuntat = false; meta\.anuntat_la = cand; \}/)
    expect(src).toMatch(/const versiuneDeAnuntat = \(d: any\) => !estePlaceholder\(d\) && d\?\.seap_meta\?\.de_anuntat === true;/)
  })
  it('placeholder.ts: violarea indexului codului = „duplicat”, cu aceeași funcție comună', () => {
    const src = readFileSync(new URL('../supabase/functions/ofertare-seap-import/placeholder.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/import \{ eDuplicatCod \} from '\.\.\/_shared\/codSeap\.mjs'/)
    expect((src.match(/eDuplicatCod\(error\) \? \{ id: null, completat: false, duplicat: true \}/g) || []).length).toBe(2)
  })
  it('edge (F1, review PR-1): versiunea care completează placeholder-ul veghei (anunțată deja + mail) intră cu de_anuntat = false, în aceeași scriere', () => {
    const src = edge()
    const bloc = src.slice(src.indexOf('const scrie = async'), src.indexOf('const r = await scrieDocument(supa, rand, cheie, placeholders);'))
    expect(bloc.length).toBeGreaterThan(100)
    expect(bloc).toMatch(/const deCompletat = placeholders\.has\(cheie\) && rand\?\.seap_meta\?\.de_anuntat === true;/)
    expect(bloc).toMatch(/if \(deCompletat\) rand = \{ \.\.\.rand, seap_meta: \{ \.\.\.rand\.seap_meta, de_anuntat: false, anuntat_la: new Date\(\)\.toISOString\(\), anuntat_prin: 'placeholder veghe' \} \};/)
  })
  it('edge (F5, review PR-1 + R2): o versiune republicată IDENTIC nu se urcă și nu se anunță — codul nou se mută pe rândul înlocuit identic (mutaCod), căutat pe TOȚI candidații', () => {
    const src = edge()
    expect(src).toMatch(/import \{[^}]*\bmutaCod\b[^}]*\} from '\.\.\/_shared\/codSeap\.mjs'/)
    expect(src).toMatch(/import \{[^}]*\bcandidatiMutare\b[^}]*\} from '\.\.\/_shared\/codSeap\.mjs'/)
    expect(src).toMatch(/dec\.fel === 'verifica' \|\| dec\.fel === 'frate' \|\| dec\.fel === 'versiune' \? \[await sha256Hex\(buf\)/)
    expect(src).toMatch(/coduri_mutate: \[\] as \{ id: number; de: string; la: string \}\[\]/)
    // D1 (r3): îngustat — doar pe un înlocuit fără nume de cod și fără placeholder pe N2 (aceleași chei ca scrie()), ÎNAINTE de
    // orice citire din Storage; altfel versiunea normală (cu placeholder: F1, de_anuntat = false)
    expect(src).toMatch(/const phN2 = placeholders\.has\(cheieRand\(doc\.nume\)\) \|\| placeholders\.has\(cheieRand\(numeFinal\)\);/)
    // R2 (r4): toți înlocuiții mutabili (candidatiMutare = mutaPeIdentic + țintele deja folosite în rulare), o singură dovadă plafonată
    const iV = src.indexOf('const deMutat: any[] = candidatiMutare(decF, phN2, tinteMutare);'), iC = src.indexOf('const campuri = doc0.cod')
    expect([iV > 0, iC > iV, iC < src.indexOf('if (eArhivaAdevarata(numeFinal, buf)) {')]).toEqual([true, true, true])
    expect(src.indexOf('const phN2 =')).toBeLessThan(iV)
    expect(src).toMatch(/const tinteMutare = new Set<number>\(\);/)
    expect(src.indexOf('const tinteMutare = new Set<number>();')).toBeLessThan(src.indexOf('for (const doc0 of documente) {'))   // pe rulare, nu pe document
    const bloc = src.slice(iV, iC)
    expect(bloc).toMatch(/if \(deMutat\.length\) \{\s*const shaC = await shaRanduri\(deMutat, new Set\(shas\), lungimi\);/)   // aceeași dovadă ca la frate
    expect(bloc).toMatch(/const inl = deMutat\.find\(\(r: any\) => shas\.includes\(shaC\.get\(r\.id\) as string\)\);/)            // necunoscut → versiune, ca înainte
    expect(bloc).toMatch(/if \(inl\) \{\s*tinteMutare\.add\(inl\.id\);/)
    expect(bloc).toMatch(/await mutaCod\(supa, licitatieId, inv, inl, codVechi, doc0\.cod\)/)
    expect(bloc).toMatch(/raport\.coduri_mutate\.push\(\{ id: inl\.id, de: codVechi, la: doc0\.cod \}\)/)
    expect(bloc).toMatch(/republicat identic sub cod nou — codul mutat pe #\$\{inl\.id\}, fără versiune/)
    expect(bloc).toMatch(/urcatiOcteti \+= brut\.length;   \/\/ anti-bug 3/)
    expect(bloc).not.toMatch(/urcaFisier|campuriCod|de_anuntat/)
    // regula (a)+(b) stă în _shared/codSeap.mjs, pe numeBaza (rândul cu nume de cod nu-și schimbă niciodată codul)
    const cs = readFileSync(new URL('../supabase/functions/_shared/codSeap.mjs', import.meta.url), 'utf8')
    expect(cs).toMatch(/export const mutaPeIdentic = \(inl, arePlaceholderN2\) => !arePlaceholderN2 && numeBaza\(inl\?\.nume_original, codRand\(inl\)\) === null/)
    // R2: decideSeap dă toți înlocuiții (inlocuit = primul, ca înainte); candidatiMutare îi filtrează cu mutaPeIdentic + țintele folosite
    expect(cs).toMatch(/\{ fel: 'versiune', nume: N2, inlocuit: inloc\[0\], inlocuiti: inloc, linie \}/)
    expect(cs).toMatch(/return toti\.filter\(\(r\) => mutaPeIdentic\(r, arePlaceholderN2\) && !\(r\?\.id != null && folosite\.has\(r\.id\)\) && peLinie\(r\)\)/)
    // E1 (r5): ținta doar capul liniei — niciun candidat cu nume de cod cu număr mai mare (revenirea la un conținut vechi se anunță)
    expect(cs).toMatch(/const capete = \(Array\.isArray\(dec\.linie\) \? dec\.linie : toti\)\.filter\(\(r\) => numeBaza\(r\?\.nume_original, codRand\(r\)\) !== null\)\.map\(nr\)/)
    expect(cs).toMatch(/const peLinie = \(r\) => !capete\.some\(\(c\) => nr\(r\) == null \|\| c > nr\(r\)\)/)
  })
  it('veghea (F2/F4 + D3 + R4, review PR-1): next_index trece mai departe doar de la o rundă per-fisier fără rezerva arhivă; o rundă terminată de la > 0 e urmată de O rundă de la 0 DOAR pe a doua trecere, apoi stop; importul dă next_index = 0 pe arhivă (R3)', () => {
    const src = veghe()
    const bloc = src.slice(src.indexOf('const importa = async'), src.indexOf('const tacute: {'))
    expect(bloc.length).toBeGreaterThan(300)
    expect(bloc).toMatch(/if \(rez\?\.metoda === 'per-fisier' && !rez\?\.rezerva_arhiva\) de = Number\(rez\.next_index\) \|\| 0;\s*else de = 0;/)
    // R4 (r4): runda finală de la 0 doar cu cuBuget (a doua trecere; bugetul îl verifică capul buclei) — pe drumul principal niciodată
    // E4 (r5): lanțul drumului principal oprit de la de > 0 e marcat pentru O rundă de la 0 pe a doua trecere
    expect(bloc).toMatch(/if \(!rez\?\.continua\) \{\s*const finala = de > 0 && i \+ 1 < runde;\s*if \(finala && cuBuget\) \{ de = 0; reluare = true; continue; \}\s*if \(de > 0 && !cuBuget\) deLa0\.add\(licId\);[^\n]*\n\s*return `\$\{i \+ 1\} runde\$\{finala \? ' \(fara runda finala de la 0: drumul principal\)' : ''\}`;/)
    expect(bloc).not.toMatch(/Date\.now\(\) - t0 < BUGET_TACUT_MS/)
    expect(bloc).toMatch(/if \(cuBuget && Date\.now\(\) - t0 > BUGET_TACUT_MS\) return `amanat/)
    const iR = bloc.indexOf('if (reluare) return'), iC = bloc.indexOf('if (!rez?.continua) {')
    expect([iR > 0, iC > iR]).toEqual([true, true])   // runda de la 0 e ULTIMA, oricum ar răspunde
    // contractul importului pe care se sprijină regula: metoda + continua + next_index în răspuns
    const imp = edge()
    expect(imp).toMatch(/metoda: 'per-fisier' as 'per-fisier' \| 'arhiva', rezerva_arhiva: false,/)
    expect(imp).toMatch(/raport\.rezerva_arhiva = true;/)
    // R3 (r4): pe rezerva / metoda arhivă poziția numără intrările ZIP-ului → continuarea de la 0 (veghea și lanțul din UI)
    expect(imp).toMatch(/const peArhiva = raport\.rezerva_arhiva \|\| raport\.metoda === 'arhiva';\s*return json\(\{ \.\.\.raport, continua, next_index: continua \? \(peArhiva \? 0 : index\) : null \}\);/)
    expect(imp).not.toMatch(/next_index: continua \? index : null/)
    expect(readFileSync(new URL('./OfertareLicitatii.jsx', import.meta.url), 'utf8')).toMatch(/deLa = data\.next_index; runde\+\+/)
  })
  it('veghea (F3/F6, review PR-1): a doua trecere (tăcută) DOAR la rularea programată, fără licitatie_id; amânările de buget se văd în tacute_amanate', () => {
    const src = veghe()
    expect(src).toMatch(/const programata = !body\?\.licitatie_id;\s*if \(programata\) \{[\s\S]{0,300}?for \(const t of tacute\) t\.coduri\[t\.camp\] = await importa\(t\.id, true, null, t\.optiuni \?\? \{\}, t\.runde \?\? RUNDE_IMPORT\);\s*\} else for \(const t of tacute\) t\.coduri\[t\.camp\] = 'nepornit/)
    expect(src).toMatch(/const BUGET_TACUT_MS = 150000;/)
    expect(src).toMatch(/return `amanat \(bugetul de timp al veghei\)/)
    expect(src).toMatch(/const tacute_amanate = tacute\.filter\(\(t\) => String\(t\.coduri\[t\.camp\] \?\? ''\)\.startsWith\('amanat'\)\)/)
    expect(src).toMatch(/return json\(\{ verificate: \(licitatii \|\| \[\]\)\.length, raport, tacute_amanate \}\);/)
    expect(src).not.toMatch(/EdgeRuntime\.waitUntil/)   // fără fire-and-forget
    const doc = readFileSync(new URL('../docs/ofertare/AUDIT_MOTOR_IMPORT_2026-10-07.md', import.meta.url), 'utf8')
    expect(doc).toMatch(/tacute_amanate/)
  })
  it('veghea (R1, review PR-1 r4 — cauza rădăcină): o versiune se anunță DOAR după ce a fost importată — fără `noi`, fără placeholder, fără Vercel; anunțul doar din rândul cu de_anuntat', () => {
    const src = veghe()
    // codul mort al F5/D2 (versiunea anunțată înainte de import, apoi scoasă dacă ieșea identică) a dispărut cu totul
    expect(src).not.toMatch(/scoateIdentice|codVersiune|coduri\.identice|cheiVersiuniNoi|versiuniAduse/)
    expect(src).not.toMatch(/numele EXACT/)                    // indicația de urcare a unei versiuni sub „N (COD)” (nu mai are placeholder)
    expect(src).not.toMatch(/versiuni\.has\(/)                // nicio versiune în `noi`, deci nimic de filtrat din el
    expect(src).toMatch(/if \(dec\.fel === 'versiune'\) \{ versiuni\.add\(dec\.nume\); versiuniCod\.push\(\{ nume: dec\.nume, cod: d\.cod \}\); continue; \}/)
    // treapta Vercel, placeholder-ele și marcarea pe nume lucrează doar pe `noi` (documente noi reale)
    for (const x of ['if (!eDupaEdge && noi.some((n) => !areNume(urcateAcum, n))) {', 'const ramase = inventarOk ? noi.filter((n) => !areNume(urcate, n)) : [];', 'const cheiNoi = new Set(noi.flatMap((n) => cheiSeap(n)));', 'for (const n of ramase) {'])
      expect(src.includes(x), x).toBe(true)
    // anunțul: din inventarul de DUPĂ import (rânduri reale cu de_anuntat), înainte de notificări și mail; flag-ul se stinge după
    const iAcum = src.indexOf('const { data: acum, error: eAcum } = await inventar('), iDe = src.indexOf('const restante = inventarOk ? (acum || []).filter(versiuneDeAnuntat) : [];')   // r6: ancora + revendicarea
    const iNot = src.indexOf('const eN = await clopotel(supa, [...catre], m, m === mesajVersiuni);'), iMail = src.indexOf('const rm = await trimiteMail(planMail.corp, planMail.cheie);'), iF = src.indexOf('if (anc && !G) await incheie(')
    expect([iAcum > 0, iDe > iAcum, iNot > iDe, iMail > iNot, iF > iMail]).toEqual([true, true, true, true, true])
    // gol acceptat: versiunea neadusă rămâne în raport (coduri.versiuni + erorile importului) și se reia la rularea următoare
    expect(src).toMatch(/const coduri: any = \{ de_rezolvat: deRezolvat, versiuni: \[\.\.\.versiuni\], instabile, import: null, \.\.\.\(neverificate\.length \? \{ identitate_neverificata: neverificate \} : \{\}\) \};/)
    const bloc = src.slice(src.indexOf('const importa = async'), src.indexOf('const tacute: {'))
    expect(bloc).toMatch(/if \(erori\) \{\s*for \(const e of \[\.\.\.\(Array\.isArray\(rez\?\.erori\) \? rez\.erori : \[\]\), \.\.\.\(rez\?\.error \? \[rez\.error\] : \[\]\)\]\.map\(String\)\) \{\s*if \(erori\.length < 20 && !erori\.includes\(e\)\) erori\.push\(e\);/)
    // importul a rulat deja în prima trecere când existau documente noi sau versiuni — nu încă o dată în a doua
    expect(src).toMatch(/if \(coduri\.import == null && deRezolvat\) tacute\.push\(\{ id: lic\.id, coduri, camp: 'import' \}\);/)
    // importul păstrează plasa F1 (placeholder-e de dinainte de R1) și D1 (mutaPeIdentic, prin candidatiMutare)
    expect(edge()).toMatch(/const deCompletat = placeholders\.has\(cheie\) && rand\?\.seap_meta\?\.de_anuntat === true;/)
    const doc = readFileSync(new URL('../docs/ofertare/AUDIT_MOTOR_IMPORT_2026-10-07.md', import.meta.url), 'utf8')
    expect(doc).toMatch(/R1 — cauza rădăcină/)
    expect(doc).toMatch(/Gol acceptat/)
  })
  it('veghea (E2, r5 — Jakarinos P1): anunțul unei versiuni se confirmă PE CANAL; de_anuntat = false doar cu notificat_la ȘI mail_la', () => {
    const src = veghe()
    // clopoțelul: doar inserturile mesajului care poartă versiunile confirmă canalul
    expect(src).toMatch(/if \(versiuniNotif\.length\) mesajVersiuni = m;/)
    // Jakarinos r2: un singur INSERT per mesaj (atomic, toti destinatarii); destinatarii necititi nu confirma canalul
    expect(src).toMatch(/let notifOk = !eOwners && !eValizi;\s*for \(const m of mesaje\) \{\s*if \(!catre\.size\) continue;\s*const eN = await clopotel\(supa, \[\.\.\.catre\], m, m === mesajVersiuni\);/)
    // clopotel(): un singur INSERT cu tot lotul
    expect(src).toMatch(/if \(!lot\.length\) return null;\s*const \{ error \} = await supa\.from\('notifications'\)\.insert\(lot\.map\(/)
    expect(src).not.toMatch(/for \(const pid of catre\)/)
    expect(src).toMatch(/await supa\.from\('profiles'\)\.select\('id'\)\.in\('id', \[\.\.\.catre\]\)/)
    expect(src).toMatch(/let \{ data: owners, error: eOwners \} = await supa\.from\('profiles'\)/)
    expect(src).toMatch(/if \(eOwners\) \(\{ data: owners, error: eOwners \} = await supa\.from\('profiles'\)/)
    expect(src).toMatch(/if \(m === mesajVersiuni\) notifOk = false;/)
    // mailul: plecat, sau nedatorat (nimic de trimis / Resend neconfigurat — ca înainte); eșuat → rămâne pentru rularea următoare
    expect(src).toMatch(/let mailOk = !raspunsuriMail\.length;\s*let planMail[^\n]*\n[\s\S]{0,400}?if \(raspunsuriMail\.length\) \{/)
    expect(src).toMatch(/mail = 'sarit: lipseste RESEND_API_KEY';\s*mailOk = true;/)
    expect(src).toMatch(/mailOk = rm\.ok && A\.destinatariOk;/)
    expect(src).toMatch(/if \(eResp\) \{ destinatariOk = false;/)
    expect(src).toMatch(/const neaduse = raspunsuriMail\.filter/)
    // marcarea: fiecare canal reușit acum își pune data; flag-ul se stinge doar cu amândouă
    const bloc = src.slice(src.indexOf('let versiuniInLucru = 0, versiuniAnuntate = 0;'), src.indexOf('raport.push({ licitatie: lic.nr_anunt, termen, noi: noi.length'))
    expect(bloc.length).toBeGreaterThan(1000)
    expect(bloc).toMatch(/if \(!meta\.notificat_la && notifAcum\) meta\.notificat_la = cand;/)
    expect(bloc).toMatch(/if \(!meta\.mail_la && mailAcum\) meta\.mail_la = cand;/)
    expect(bloc).toMatch(/\(\) => \(grupEsuat \? \[false, false\] : \[notifOk, mailOk\]\)\);/)
    expect(bloc).toMatch(/if \(meta\.notificat_la && meta\.mail_la\) \{ meta\.de_anuntat = false; meta\.anuntat_la = cand; \}/)
    expect(bloc).not.toMatch(/de_anuntat: false/)
  })
  it('import (E3, r5): SEAP se reîncearcă ca în veghe (403/429/5xx, 4 încercări, 0,7/1,4/2,1 s), în bugetul de timp; cookie-urile din încercarea reușită', () => {
    const src = edge()
    expect(src).toMatch(/async function fetchSeap\(url: string, init: RequestInit, pesteBuget: \(pauzaMs: number\) => boolean, incercari = 4\): Promise<Response> \{/)
    expect(src).toMatch(/const merita = r\.status === 403 \|\| r\.status === 429 \|\| r\.status >= 500;/)
    expect(src).toMatch(/const pauza = 700 \* \(i \+ 1\);/)
    expect(src).toMatch(/if \(!merita \|\| i === incercari - 1 \|\| pesteBuget\(pauza\)\) return r;/)
    expect(src).toMatch(/const pesteBuget = \(pauzaMs: number\) => Date\.now\(\) - t0 \+ pauzaMs > BUGET_MS;/)
    // lista: răspunsul întors de fetchSeap e cel reușit — cookie-urile LUI leagă linkurile de descărcare
    expect(src).toMatch(/const rl = await fetchSeap\(`\$\{SEAP\}\/NoticeCommon\/GetDfNoticeSectionFiles\/\?\$\{qs\}`, \{ headers: SEAP_HDR \}, pesteBuget\);\s*if \(!rl\.ok\)[^\n]*\n\s*else \{\s*cookie = cookieDin\(rl\);/)
    expect(src).toMatch(/const rd = await fetchSeap\(link, \{ headers: antetDesc \}, pesteBuget, esecuriLaRand >= 3 \? 1 : 4\);/)
    expect(src).toMatch(/res = await fetchSeap\(url, \{ headers: SEAP_HDR \}, pesteBuget\);/)
    expect((src.match(/await fetch\(/g) || []).length).toBe(1)   // singurul fetch direct e în fetchSeap
  })
  it('veghea (E4, r5): lanțul drumului principal oprit de la de > 0 primește O rundă de la 0 pe a doua trecere (o singură dată, cu aceleași opțiuni)', () => {
    const src = veghe()
    expect(src).toMatch(/const deLa0 = new Set<number>\(\);/)
    expect(src).toMatch(/else if \(deLa0\.has\(lic\.id\) && !tacute\.some\(\(t\) => t\.id === lic\.id\)\) tacute\.push\(\{ id: lic\.id, coduri, camp: 'import_de_la_0', runde: 1, optiuni: optImport \}\);/)
    expect(src).toMatch(/return `\$\{runde\} runde, ramas de continuat`;/)
  })
  it('import (E6, r5): fara_rezerva_arhiva sare rezerva DownloadArchive și o spune; implicit neschimbat', () => {
    const src = edge()
    expect(src).toMatch(/const faraRezervaArhiva = body\?\.fara_rezerva_arhiva === true;/)
    expect(src).toMatch(/const cerutaArhiva = !continua && \(!perFisierOk \|\| !!motivRezerva\);/)
    expect(src).toMatch(/const nevoieDeArhiva = cerutaArhiva && !faraRezervaArhiva;/)
    expect(src).toMatch(/if \(cerutaArhiva && faraRezervaArhiva\) \{\s*raport\.rezerva_arhiva_sarita = motivRezerva \|\| 'lista indisponibila';\s*nerecuperate\+\+;/)
    expect(src).toMatch(/rezerva_arhiva_sarita: null as string \| null/)
    const doc = readFileSync(new URL('../docs/ofertare/AUDIT_MOTOR_IMPORT_2026-10-07.md', import.meta.url), 'utf8')
    expect(doc).toMatch(/Review PR-1, runda 5 \(E1–E7\)/)
  })
})

describe('audit #4 — review PR-1 după runda 5 (Jakarinos r2 + verificarea internă)', () => {
  const imp = readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
  it('veghea: cu destinatari necunoscuți, clopoțelul versiunilor se amână întreg (Jakarinos r3)', () => {
    const veg = readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
    expect(veg).toMatch(/const destinatariNecunoscuti = !!eOwners \|\| !!eValizi;[\s\S]{0,15000}?let vNotif = destinatariNecunoscuti \? \[\] :/)
    const iV = veg.indexOf('const destinatariNecunoscuti'), iO = veg.indexOf('let { data: owners, error: eOwners }'), iP = veg.indexOf("const { data: valizi, error } = await supa.from('profiles')")
    expect(iO).toBeGreaterThan(0); expect(iP).toBeGreaterThan(iO); expect(iV).toBeGreaterThan(iP)
  })
  it('veghea (Jakarinos r4): rulări simultane — anunțul versiunii doar din revendicarea atomică a rândului; confirmare condiționată de revendicare; mail cu Idempotency-Key', () => {
    const veg = readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
    // revendicarea: UPDATE condiționat (de_anuntat încă true, canalele cum au fost citite, nicio revendicare vie) — o instrucțiune
    expect(veg).toMatch(/\.update\(\{ seap_meta: meta \}\)\.eq\('id', d\.id\)\.eq\('seap_meta->>de_anuntat', 'true'\);/)
    expect(veg).toMatch(/q = m0\[c\] \? q\.eq\(`seap_meta->>\$\{c\}`, String\(m0\[c\]\)\) : q\.is\(`seap_meta->>\$\{c\}`, null\);/)
    expect(veg).toMatch(/q\.or\(`seap_meta->>revendicat_pana\.is\.null,seap_meta->>revendicat_pana\.lt\.\$\{acum\}`\)\.select\('id'\)/)
    expect(veg).toMatch(/const REVENDICARE_MS = 10 \* 60 \* 1000;/)
    // doar versiunile revendicate de rularea asta intră în canale; confirmarea trece doar cu revendicarea încă a ei
    // r6: ANCORA livrării (grupul de reluat sau versiunea cu id-ul cel mai mic) se revendică întâi; membrii după ea
    expect(veg).toMatch(/const ancoraCit = cuGrup\.length \? minId\(cuGrup\) : restante\.length \? minId\(restante\) : null;/)
    expect(veg).toMatch(/const rv = cuGrup\.length \? await revendicaGrup\(supa, ancoraCit, tokenRulare\) : await revendicaAnunt\(supa, ancoraCit, tokenRulare\);/)
    expect(veg).toMatch(/const r2 = await revendicaAnunt\(supa, d, tokenRulare\);\s*if \(r2\.meta\) membriRev\.push/)
    expect(veg).toMatch(/\.eq\('id', d\.id\)\.eq\('seap_meta->>revendicare', token\)\.select\('id'\);/)
    expect(veg).toMatch(/const eF = await confirmaAnunt\(supa, d, tokenRulare, meta\);/)
    expect(veg).not.toMatch(/else if \(!nou\) continue;/)
    // idempotența livrării: cheia Resend = amprenta conținutului; clopoțelul versiunilor fără repetare la același conținut (24 h)
    expect(veg).toMatch(/planMail = \{ corp, cheie: `seap-veghe\/\$\{lic\.id\}\/\$\{await sha256Hex\(corp\)\}`, to \};/)
    expect(veg).toMatch(/'Idempotency-Key': cheie \},/)
    expect(veg).toMatch(/if \(faraRepetare && lot\.length\) \{\s*const \{ data: deja, error: eD \} = await supa\.from\('notifications'\)\.select\('profile_id'\)\.in\('profile_id', lot\)/)
  })
  it('veghea (Jakarinos r5 + r6): grupul livrării — pe UN rând-ancoră, scris ÎNAINTE de trimitere; reluarea doar de cine revendică ancora; ancora confirmată ULTIMA, grupul șters doar cu toți membrii confirmați', () => {
    const veg = readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
    expect(veg).toMatch(/const GRUP_VALABIL_MS = 20 \* 3600 \* 1000;/)
    // revendicarea ancorei care poartă grupul: același grup + nicio revendicare vie
    expect(veg).toMatch(/\.eq\('id', d\.id\)\.eq\('seap_meta->grup->>id', String\(m0\.grup\?\.id\)\)/)
    // grupul: o singură scriere pe ancoră, înainte de clopoțel și mail
    const iGrup = veg.indexOf('const eG = await scrieGrup(supa, anc, tokenRulare, grup);'), iClop = veg.indexOf('const eN = await clopotel(supa, [...catre], m, m === mesajVersiuni);'), iMail = veg.indexOf('const rm = await trimiteMail(planMail.corp, planMail.cheie);')
    expect([iGrup > 0, iClop > iGrup, iMail > iClop]).toEqual([true, true, true])
    expect(veg).toMatch(/notif: A\.mesajVersiuni \? \{ \.\.\.A\.mesajVersiuni, catre: \[\.\.\.catre\], ids: vNotif\.map\(\(d: any\) => d\.id\) \} : null,/)
    expect(veg).toMatch(/mail: A\.planMail && vMail\.length \? \{ corp: A\.planMail\.corp, cheie: A\.planMail\.cheie, complet: A\.destinatariOk, ids: vMail\.map\(\(d: any\) => d\.id\) \} : null,/)
    // grupul nescris → nimic despre versiuni nu pleacă acum, fără date de canal
    expect(veg).toMatch(/grupEsuat = true; vNotif = \[\]; vMail = \[\];\s*A = await alcatuieste\(\[\], \[\]\);/)
    // reluarea: doar canalele netrimise, IDENTIC (destinatarii și corpul + cheia din grup)
    expect(veg).toMatch(/if \(G\.notif && !trimis\.notif\) \{/)
    expect(veg).toMatch(/const eN = await clopotel\(supa, \(G\.notif\.catre \|\| \[\]\)\.filter\(\(pid: string\) => ok\.has\(pid\)\), G\.notif, true\);/)
    expect(veg).toMatch(/if \(G\.mail && !trimis\.mail\) \{\s*const rm = await trimiteMail\(G\.mail\.corp, G\.mail\.cheie\);/)
    // încheierea: „trimis” pe ancoră, membrii, ancora ULTIMA; grupul păstrat cât un membru e nerevendicat / neconfirmat
    expect(veg).toMatch(/for \(const d of membriRev\) \{ const \[n, m\] = steag\(d\); if \(!\(await confirma\(d, n, m, null\)\)\) incomplet = true; \}/)
    expect(veg).toMatch(/const neplecat = !!grup && \(\(!!grup\.notif && !grup\.trimis\?\.notif\) \|\| \(!!grup\.mail && !grup\.trimis\?\.mail\)\);\s*const \[n, m\] = steag\(anc\);\s*await confirma\(anc, n, m, incomplet \|\| neplecat \? grup : null\);/)
    expect(veg).toMatch(/if \(grup\) meta\.grup = grup; else delete meta\.grup;/)
    expect(veg).not.toMatch(/PLIC_VALABIL_MS|scriePlic|ordineConfirmare/)
    // Jakarinos r7: verificarea clopoțelului necitită = eroare, FĂRĂ insert (grupul rămâne, se reia identic)
    expect(veg).toMatch(/if \(eD\) return `verificarea clopotelului: \$\{eD\.message\}`;/)
    expect(veg).not.toMatch(/if \(!eD\) \{ const au = new Set/)
  })
  it('Copilot r1 pe #652: identitatea NEDOVEDITĂ nu e „există deja” — candidații fără mărime se citesc din Storage; ce rămâne neverificat e fail-closed (nerecuperate, raportat); „neaduse” din inventarul de după import', () => {
    const imp = readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
    const cod = readFileSync(new URL('../supabase/functions/_shared/codSeap.mjs', import.meta.url), 'utf8')
    const veg = readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
    expect(cod).toMatch(/return \(dec\.candidati \?\? \[\]\)\.some\(\(r\) => areDovada\(r\) \|\| Number\(r\.size_bytes\) > 0 \|\| !!r\.fisier_path\)/)
    expect(imp).toMatch(/const necunoscuta = !\(Number\.isFinite\(marime\) && marime > 0\);[\s\S]{0,300}?if \(r\.fisier_path && \(necunoscuta \? !esteArhiva\(r\.nume_original\) : marime <= PRAG_MARE\)\) \{/)
    expect(imp).toMatch(/raport\.identitate_neverificata\.push\(t\); raport\.erori\.push\(t\); nerecuperate\+\+;/)
    expect(imp).toMatch(/else neverificat\('conținutul unui candidat nu s-a putut citi'\);/)
    expect(imp).toMatch(/if \(dec\.fel === 'verifica'\) neverificat\(`peste 20 MB/)
    expect(imp).not.toMatch(/rămas pe regula veche'\}`\);\s*raport\.sarite_existente\+\+;/)
    expect(imp).toMatch(/if \(deLaIndex === 0 && !arhivaIncompleta && !nerecuperate\) await supa\.from\('ofertare_licitatii'\)\.update\(\{ documentatie_adusa_la/)
    expect(veg).toMatch(/coduri\.versiuni_neaduse = versiuniCod\.filter\(\(v\) => !inventarOk \|\| !coduriAcum\.has\(v\.cod\)\)\.map\(\(v\) => v\.nume\);/)
    expect(veg).toMatch(/inventar\(supa, lic\.id, 'id, nume_original, fisier_path, seap_cod, seap_meta'\)/)
  })
  it('codSeap (Jakarinos r7): doar CAPUL liniei poate fi înlocuit — rândurile înlocuite deja (inlocuieste_id / cod_anterior) nu justifică o versiune; E1 judecă pe toată linia', () => {
    const cod = readFileSync(new URL('../supabase/functions/_shared/codSeap.mjs', import.meta.url), 'utf8')
    expect(cod).toMatch(/const inlocuitDeja = \(r\) => \(r\.id != null && !!inv\.inlocuite\?\.has\(r\.id\)\) \|\| !!inv\.coduriInlocuite\?\.has\(codRand\(r\)\)/)
    expect(cod).toMatch(/const inloc = linie\.filter\(\(r\) => !inlocuitDeja\(r\)\)/)
    expect(cod).toMatch(/inlocuit: inloc\[0\], inlocuiti: inloc, linie \}/)
    expect(cod).toMatch(/inlocuieste_id: r\.seap_meta\?\.inlocuieste_id \?\? null, cod_anterior: r\.seap_meta\?\.cod_anterior \?\? null/)
    expect(cod).toMatch(/const capete = \(Array\.isArray\(dec\.linie\) \? dec\.linie : toti\)/)
    const imp = readFileSync(new URL('../supabase/functions/ofertare-seap-import/index.ts', import.meta.url), 'utf8')
    expect(imp).toMatch(/inlocuieste_id: \(seap\?\.seap_meta as any\)\?\.inlocuieste_id \?\? null, cod_anterior: \(seap\?\.seap_meta as any\)\?\.cod_anterior \?\? null/)
  })
  it('importul: după 3 descărcări per fișier căzute la rând, o singură încercare (bugetul rămâne pentru rezerva arhivă)', () => {
    expect(imp).toMatch(/const rd = await fetchSeap\(link, \{ headers: antetDesc \}, pesteBuget, esecuriLaRand >= 3 \? 1 : 4\);/)
    expect(imp).toMatch(/if \(!rd\.ok\) \{ esecuriLaRand\+\+;/)
    expect(imp).toMatch(/esecuriLaRand = 0;/)
  })
})

