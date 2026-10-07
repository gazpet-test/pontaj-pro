// Clasificatorul comun al documentelor de atribuire (supabase/functions/_shared/tipDocument.mjs) — motorul de import, var. A
// (Răzvan, 07.10.2026). Adevărul de referință: reclasificarea manuală a celor 160 de fișiere din arhiva lic. 3 (CN1095546,
// ids 1460–1630), care moșteneau toate „raspuns_clarificare”. Plus: moștenirea din arhivă, adâncimea, paritatea cu api/.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { tipExplicit, ghicesteTip, tipInArhiva, numeFisier, esteArhiva, adancimeArhiva, MAX_ADANCIME_ARHIVE } from '../supabase/functions/_shared/tipDocument.mjs'

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
    expect(ghicesteTip('Planse.zip')).toBe('plansa')
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
    expect(ghicesteTip('C5_ceva.pdf')).toBe('formular')   // C2–C5 sunt liste doar când numele o spune (centralizator / lista_cantitati)
    expect(ghicesteTip('do_ceva.pdf')).toBe('formular')
    expect(ghicesteTip('document.pdf')).toBe('alta')      // „do” doar ca prefix urmat de separator
  })
  it('diacriticele și calea nu contează', () => {
    expect(ghicesteTip('Fișa de date.pdf')).toBe('fisa_date')
    expect(ghicesteTip('Planșe.zip')).toBe('plansa')
    expect(ghicesteTip('Arhiva (#12)/sub/dir\\F3_lista.pdf')).toBe('lista_cantitati')
    expect(ghicesteTip('Clarificari (#9)/x.pdf')).toBe('alta')   // calea („Clarificari”) nu dă tipul, doar numele
    expect(numeFisier('a/b\\c.pdf')).toBe('c.pdf')
    expect(numeFisier(null)).toBe('')
    expect(ghicesteTip(undefined)).toBe('alta')
  })
})

describe('moștenirea din arhivă', () => {
  it('regula proprie câștigă', () => {
    expect(tipInArhiva('X (#1)/F3_lista.pdf', 'cs_volum')).toBe('lista_cantitati')
  })
  it('fără regulă proprie → tipul arhivei', () => {
    expect(tipInArhiva('X (#1)/ceva.pdf', 'cs_volum')).toBe('cs_volum')
    expect(tipInArhiva('X (#1)/ceva.pdf', 'plansa')).toBe('plansa')
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
