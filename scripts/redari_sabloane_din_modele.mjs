// Redări teren — refacerea celor 5 șabloane DOCX din modelele Final_v2 ale juristului (03.11.2026), cu metoda din
// docs/redari/SABLOANE.md §1. Originalele stau neatinse în docs/redari/referinta/, șabloanele ies în public/redari/sabloane/.
// Rulare: node scripts/redari_sabloane_din_modele.mjs            (scrie cele 5 șabloane)
//         node scripts/redari_sabloane_din_modele.mjs --verifica (doar compară: iese cu 1 dacă vreun șablon din repo diferă)
//
// Reguli (aceleași ca la v5):
//  - se schimbă DOAR textul din <w:t>; fiecare placeholder stă întreg într-un singur <w:t> (docx.js înlocuiește local);
//  - fiecare operație caută textul exact din model și cere numărul declarat de apariții; altfel scriptul se oprește fără să scrie;
//  - excepții structurale, numite în cod: (1) paragraful nou {{qr}} în convocator; (2) un singur rând-șablon {{rand.*}} în
//    adresa_uat (celelalte 7 rânduri goale se șterg); (3) docProps: fără miniatură și fără „ultima modificare de”;
//    (4) celulele goale din tabele nu mai au run în modelele resalvate de Word → primesc un run cu w:sz=19 (formatul celulelor
//    de date din aceleași tabele); (5) paragraful nou {{pv_a_referinta}} sub „Nume:” în PV B (decizia 02.11, PR #935).
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const RADACINA = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REF = resolve(RADACINA, 'docs/redari/referinta')
const OUT = resolve(RADACINA, 'public/redari/sabloane')
const VERIFICA = process.argv.includes('--verifica')
// data fixă pe intrările zip modificate: rularea repetată dă exact aceiași octeți
const DATA_FIXA = new Date('2026-11-03T00:00:00Z')

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RX_WT = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const wt = text => `<w:t xml:space="preserve">${esc(text)}</w:t>`
const RUN_CELULA = text => `<w:r><w:rPr><w:sz w:val="19"/></w:rPr>${wt(text)}</w:r>`

function asigura(cond, mesaj) { if (!cond) throw new Error(mesaj) }

// <w:t> al cărui text este EXACT `vechi` → `noi[i]`, în ordinea documentului; numărul aparițiilor = noi.length
function inlocuiesteWt(xml, vechi, noi) {
  const lista = Array.isArray(noi) ? noi : [noi]
  const gasite = [...xml.matchAll(RX_WT)].filter(m => m[1] === esc(vechi))
  asigura(gasite.length === lista.length, `„${vechi.slice(0, 60)}”: ${gasite.length} apariții, așteptate ${lista.length}`)
  let i = 0
  return xml.replace(RX_WT, (tot, continut) => (continut === esc(vechi) ? wt(lista[i++]) : tot))
}

// <w:t> unic cu textul exact `vechi`; înlocuirile [caută, pune] se aplică pe rând, fiecare pe PRIMA apariție rămasă
function inWt(xml, vechi, inlocuiri) {
  let nou = vechi
  for (const [cauta, pune] of inlocuiri) {
    asigura(nou.includes(cauta), `„${cauta}” nu mai apare în „${vechi.slice(0, 60)}…”`)
    nou = nou.replace(cauta, () => pune)
  }
  return inlocuiesteWt(xml, vechi, nou)
}

// <w:t>-uri consecutive din ACELAȘI paragraf (texte exacte): primul primește `nou`, celelalte se golesc
function uneste(xml, texte, nou) {
  const intre = '(?:(?!<w:t[\\s>]|<\\/w:p>)[\\s\\S])*?'
  const sablon = texte.map(t => `<w:t(?:\\s[^>]*)?>${rx(esc(t))}<\\/w:t>`).join(`(${intre})`)
  const gasite = [...xml.matchAll(new RegExp(sablon, 'g'))]
  asigura(gasite.length === 1, `secvența „${texte.join('|').slice(0, 60)}”: ${gasite.length} apariții, așteptată 1`)
  const m = gasite[0]
  const bucati = [wt(nou)]
  for (let i = 1; i < texte.length; i++) bucati.push(m[i], wt(''))
  return xml.slice(0, m.index) + bucati.join('') + xml.slice(m.index + m[0].length)
}

// paragraful (gol) dintr-o celulă primește un run cu text; acceptă <w:p .../> și <w:p ...>[<w:pPr>…</w:pPr>]</w:p>
function umpleParagrafGol(pXml, text) {
  if (/^<w:p(?:\s[^>]*)?\/>$/.test(pXml)) return pXml.replace(/\/>$/, `>${RUN_CELULA(text)}</w:p>`)
  asigura(!/<w:r[\s>]/.test(pXml), `celula nu e goală: ${pXml.slice(0, 80)}`)
  return pXml.replace(/<\/w:p>$/, `${RUN_CELULA(text)}</w:p>`)
}
const RX_TR = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g
const RX_TC = /<w:tc>[\s\S]*?<\/w:tc>/g
const RX_P_IN_TC = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/

// rândurile tabelului: indexul rândului care conține <w:t>`text` (unic în document)
function randCuText(xml, text) {
  const randuri = [...xml.matchAll(RX_TR)]
  const idx = randuri.map((m, i) => (m[0].includes(`>${esc(text)}</w:t>`) ? i : -1)).filter(i => i >= 0)
  asigura(idx.length === 1, `rândul cu „${text}”: ${idx.length} apariții, așteptat 1`)
  return { randuri, i: idx[0] }
}
function inlocuiesteRand(xml, m, nou) { return xml.slice(0, m.index) + nou + xml.slice(m.index + m[0].length) }

// rândul de DUPĂ rândul-antet care conține `antet`: toate celulele sunt goale și primesc, în ordine, `valori`
function randGolDupa(xml, antet, valori) {
  const { randuri, i } = randCuText(xml, antet)
  const tinta = randuri[i + 1]
  asigura(tinta, `nu există rând după antetul „${antet}”`)
  const celule = [...tinta[0].matchAll(RX_TC)]
  asigura(celule.length === valori.length, `rândul după „${antet}”: ${celule.length} celule, așteptate ${valori.length}`)
  let k = 0
  const nou = tinta[0].replace(RX_TC, tc => tc.replace(RX_P_IN_TC, p => umpleParagrafGol(p, valori[k++])))
  return inlocuiesteRand(xml, tinta, nou)
}

// în rândul care conține `text`, celula cu indexul `col` (goală) primește `valoare`
function celulaGoala(xml, text, col, valoare) {
  const { randuri, i } = randCuText(xml, text)
  const m = randuri[i]
  let k = 0
  const nou = m[0].replace(RX_TC, tc => (k++ === col ? tc.replace(RX_P_IN_TC, p => umpleParagrafGol(p, valoare)) : tc))
  asigura(k > col, `rândul cu „${text}” nu are celula ${col}`)
  return inlocuiesteRand(xml, m, nou)
}

// șterge `n` rânduri goale (fără niciun <w:t> cu text) imediat după rândul care conține `text`
function stergeRanduriGoaleDupa(xml, text, n) {
  const { randuri, i } = randCuText(xml, text)
  const deSters = randuri.slice(i + 1, i + 1 + n)
  asigura(deSters.length === n, `după „${text}” sunt ${deSters.length} rânduri, așteptate ${n}`)
  for (const m of deSters) asigura(![...m[0].matchAll(RX_WT)].some(w => w[1].trim()), 'rândul de șters nu e gol')
  // rândurile sunt consecutive în același tabel: se taie intervalul [primul, ultimul]
  const start = deSters[0].index, end = deSters.at(-1).index + deSters.at(-1)[0].length
  asigura(!xml.slice(start, end).includes('</w:tbl>'), 'rândurile de șters trec în alt tabel')
  return xml.slice(0, start) + xml.slice(end)
}

// paragraf nou, inserat imediat după paragraful care conține <w:t> cu textul exact `text`
function paragrafDupa(xml, text, paragrafNou) {
  const RX_P = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
  const gasite = [...xml.matchAll(RX_P)].filter(m => m[0].includes(`>${esc(text)}</w:t>`))
  asigura(gasite.length === 1, `paragraful cu „${text.slice(0, 50)}”: ${gasite.length} apariții`)
  const m = gasite[0], end = m.index + m[0].length
  return xml.slice(0, end) + paragrafNou + xml.slice(end)
}

const ANTET_VECHI = 'Lider al Asocierii Gazpet Instal – Moldocor – Habau – Comesad RO · Contract Transgaz nr. 30/22.01.2025 · Conductă de transport gaze naturale Prunișor–Orșova–Băile Herculane–Jupa, LOT 1'
const ANTET_NOU = 'Lider al Asocierii Gazpet Instal – Moldocor – Habau – Comesad RO · Contract Transgaz nr. {{contract_nr}}/{{contract_data}} · {{proiect_denumire}}'
const NR_LOC = ['Nr. ________ / ___.___.2026        Locul încheierii: ______________________', 'Nr. {{nr_pv}} / {{data_pv}}        Locul încheierii: {{locul}}']
const PARCELA_7 = ['{{uat}}', '{{sat}} / {{tarla}}', '{{nr_cadastral}}', '{{poz_hg}}', '{{suprafata}}', '{{categoria_folosinta}}', '{{tronson}}']
const NCD = 'Nume, calitate, data'
const bife = nume => nume.map(n => ['☐', `{{bifa_${n}}}`])

const RETETE = {
  'convocator.docx': {
    model: 'Model_1_Convocator_proprietar_v6_final.docx',
    pasi: x => {
      x = inlocuiesteWt(x, ANTET_VECHI, ANTET_NOU)
      x = inlocuiesteWt(x, '___ / ___.___.2026).', '{{imputernicire_nr}} / {{imputernicire_data}}).')
      x = inlocuiesteWt(x, 'Nr. convocare: ___________        Data: ___.___.2026', 'Nr. convocare: {{nr_document}}        Data: {{data}}')
      x = inlocuiesteWt(x, 'Către: ______________________________________ (proprietar / utilizator de teren)', 'Către: {{nume}} ({{calitate}})')
      x = inlocuiesteWt(x, 'Adresa: ________________________________________________________________', 'Adresa: {{adresa}}')
      x = randGolDupa(x, 'Suprafață afectată temporar (mp)', ['{{uat}}', '{{sat}} / {{tarla}}', '{{nr_cadastral}}', '{{poz_hg}}', '{{suprafata}}', '{{tronson}}'])
      x = inWt(x, 'Lucrările de readucere a terenului la starea inițială pe parcela de mai sus au fost executate. Vă invităm să constatați starea terenului și să semnați procesul-verbal de constatare, la sediul Primăriei ____________________, în una dintre zilele de mai jos. Puteți veni în oricare dintre zile, în intervalul programat pentru satul sau tarlaua dumneavoastră sau în oricare alt interval liber. Procesul-verbal va fi pregătit cu datele parcelei dumneavoastră; la sesiune doar îl verificați și îl semnați.',
        [['Primăriei ____________________,', 'Primăriei {{uat}},']])
      x = inlocuiesteWt(x, '___.___.2026', ['{{zi1}}', '{{zi2}}', '{{zi3}}'])
      x = inlocuiesteWt(x, '09:00 – 16:00', ['{{program1}}', '{{program3}}'])
      x = inlocuiesteWt(x, '09:00 – 19:00 (program prelungit)', '{{program2}}')
      for (const i of [1, 2, 3]) x = celulaGoala(x, `Ziua ${i}`, 3, `{{sate_zi${i}}}`)
      const link = 'Prin formularul online de la adresa ______________________ (sau scanând codul QR alăturat), la telefon ______________ sau prin răspuns scris la adresa de mai jos. Puteți alege una dintre opțiunile:'
      x = inWt(x, link, [['adresa ______________________ (sau scanând codul QR alăturat)', 'adresa {{link}} (sau scanând codul QR de mai jos)'], ['telefon ______________', 'telefon {{contact_telefon}}']])
      // excepția (1): paragraf nou, centrat, doar cu {{qr}}, imediat după paragraful cu {{link}}
      x = paragrafDupa(x, link.replace('adresa ______________________ (sau scanând codul QR alăturat)', 'adresa {{link}} (sau scanând codul QR de mai jos)').replace('telefon ______________', 'telefon {{contact_telefon}}'),
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>{{qr}}</w:t></w:r></w:p>')
      // informarea GDPR: tot paragraful de sub „Date personale” = {{text_gdpr}} (textul rămâne cel din ERP, red_proiecte.text_gdpr)
      x = uneste(x, ['Transgaz folosește datele dumneavoastră ca să organizeze verificarea terenului după lucrările la conducta de gaze. Gazpet', ' Instal',
        ' vă trimite această convocare în numele Transgaz. Datele nu sunt folosite pentru reclamă. Pe verso găsiți informațiile complete despre folosirea datelor și drepturile dumneavoastră (inclusiv temeiurile legale); le găsiți și scanând codul QR sau la [link scurt].'], '{{text_gdpr}}')
      x = inlocuiesteWt(x, 'Contact GAZPET INSTAL: Ramona Brehui, tel. ______________, e-mail redari@gazpet.ro', 'Contact GAZPET INSTAL: {{contact_nume}}, tel. {{contact_telefon}}, e-mail {{contact_email}}')
      x = uneste(x, ['Contact TRANSGAZ (DRFT / ofițer de legătură): _______________________, tel. ', '______________'], 'Contact TRANSGAZ (DRFT / ofițer de legătură): {{reprezentant_tgz}}, tel. {{reprezentant_tgz_telefon}}')
      x = inlocuiesteWt(x, NCD, ['{{semnatar_gazpet}}', '{{semnatar_tgz}}'])
      return x
    },
  },
  'pv_a.docx': {
    model: 'Model_2_PV_tip_A_cu_proprietarul_v5_final.docx',
    pasi: x => {
      x = inlocuiesteWt(x, ANTET_VECHI, ANTET_NOU)
      x = inlocuiesteWt(x, ...NR_LOC)
      x = randGolDupa(x, 'Categoria de folosință', PARCELA_7)
      x = randGolDupa(x, 'Act doveditor al calității (dacă e cazul)', ['{{nume}}', '{{calitate_cota}}', '{{act_identitate}}', '{{act_doveditor}}'])
      x = inWt(x, '☐ împrăștierea stratului de sol fertil   ☐ nivelare   ☐ arat   ☐ discuit / grăpat   ☐ însămânțare   ☐ refacere gard   ☐ refacere drum de acces   ☐ altele: ______________________',
        [...bife(['sol_fertil', 'nivelare', 'arat', 'discuit', 'insamantare', 'gard', 'drum', 'altele']), ['______________________', '{{lucrari_altele}}']])
      x = inWt(x, 'conform devizului „Refaceri amplasamente – tronson ____” din contractul nr. 30/22.01.2025.', [['tronson ____', 'tronson {{tronson}}'], ['30/22.01.2025', '{{contract_nr}}/{{contract_data}}']])
      x = inWt(x, 'Terenul a fost adus la starea și categoria de folosință avute anterior lucrărilor:   ☐ DA   ☐ DA, cu obiecțiile de la pct. 5', bife(['da', 'da_cu_obiectii']))
      x = inWt(x, 'Categoria de folosință inițială, conform bazei de date a Beneficiarului: ____________. Starea terenului la data constatării: ☐ nivelat ☐ strat vegetal refăcut ☐ însămânțat ☐ gard / drum refăcut ☐ alta: ____________. Plan de situație anexat: ☐ DA ☐ NU. ',
        [['____________', '{{categoria_initiala}}'], ...bife(['st_nivelat', 'st_strat_vegetal', 'st_insamantat', 'st_gard_drum', 'st_alta']), ['____________', '{{stare_teren_alta}}'], ...bife(['plan_da', 'plan_nu'])])
      x = inWt(x, 'Constatarea s-a făcut: ☐ la sediul Primăriei, pe baza declarației deținătorului și a verificării efectuate de comisie pe teren la data ___.___.2026 (de: ______________)   ☐ pe teren, în prezența deținătorului. Obiecțiile formulate verbal în sesiune se consemnează la pct. 5.',
        [['☐', '{{bifa_constatare_sediu}}'], ['___.___.2026', '{{verificare_data}}'], ['______________', '{{verificare_de}}'], ['☐', '{{bifa_constatare_teren}}']])
      x = inWt(x, '☐ Nu am obiecții.', bife(['fara_obiectii']))
      x = inlocuiesteWt(x, '☐ Am următoarele obiecții: _________________________________________________________________', '{{bifa_cu_obiectii}} Am următoarele obiecții: {{obiectii_text}}')
      // a doua linie de scris de mână a obiecțiilor (și cea de la pct. 6) — textul vine din PV, linia rămâne goală
      x = inlocuiesteWt(x, '_______________________________________________________________________________________', ['', '{{alte_observatii}}'])
      x = inWt(x, 'Termen de remediere convenit: ___.___.2026. Reverificare la: ___.___.2026.', [['___.___.2026', '{{termen_remediere}}'], ['___.___.2026', '{{reverificare_la}}']])
      x = inlocuiesteWt(x, NCD, ['{{semnatar_detinator}}', '{{semnatar_tgz}}', '{{semnatar_gazpet}}'])
      return x
    },
  },
  'pv_b.docx': {
    model: 'Model_3_PV_tip_B_constatare_tehnica_v5_finala.docx',
    pasi: x => {
      x = inlocuiesteWt(x, ANTET_VECHI, ANTET_NOU)
      x = inlocuiesteWt(x, ...NR_LOC)
      x = randGolDupa(x, 'Categoria de folosință', PARCELA_7)
      const nume = 'Nume: {{nume}}   {{bifa_neidentificat}} proprietar neidentificat în baza de date   {{bifa_fara_adresa}} fără adresă cunoscută'
      x = inlocuiesteWt(x, 'Nume: ________________________________   ☐ proprietar neidentificat în baza de date   ☐ fără adresă cunoscută', nume)
      // excepția (5): paragraful {{pv_a_referinta}} sub „Nume:” (gol dacă nu există PV A semnat al altui coproprietar)
      x = paragrafDupa(x, nume, '<w:p><w:r><w:t xml:space="preserve">{{pv_a_referinta}}</w:t></w:r></w:p>')
      x = celulaGoala(x, 'Scrisoare recomandată cu confirmare de primire', 1, '{{conv_data_expediere}}')
      x = inlocuiesteWt(x, 'nr. recomandată ______', 'nr. recomandată {{conv_nr_tracking}}')
      x = inlocuiesteWt(x, '☐ primită la ___  ☐ returnată: ____________', '{{bifa_conv_primita}} primită la {{conv_data_confirmare}}  {{bifa_conv_returnata}} returnată: {{conv_retur}}')
      x = celulaGoala(x, 'Afișare la sediul Primăriei', 1, '{{afisare_data_start}}')
      x = inlocuiesteWt(x, 'PV de afișare nr. ______', 'PV de afișare nr. {{afisare_pv_nr}}')
      x = inlocuiesteWt(x, 'afișat de la ___ până la ___', 'afișat de la {{afisare_data_start}} până la {{afisare_data_end}}')
      x = celulaGoala(x, ' online / SMS / e-mail / telefonic / scris', 1, '{{raspuns_data}}')
      x = celulaGoala(x, ' online / SMS / e-mail / telefonic / scris', 2, '{{raspuns_canal}}')
      x = inlocuiesteWt(x, '☐ fără răspuns  ☐ nu particip, fără obiecții  ☐ alt răspuns: ______', '{{bifa_fara_raspuns}} fără răspuns  {{bifa_raspuns_fara_obiectii}} nu particip, fără obiecții  {{bifa_alt_raspuns}} alt răspuns: {{raspuns_alt_text}}')
      x = inlocuiesteWt(x, 'zilele ___, ___, ___', 'zilele {{zi1}}, {{zi2}}, {{zi3}}')
      x = inlocuiesteWt(x, '☐ nu s-a prezentat', '{{bifa_neprezentat}} nu s-a prezentat')
      x = celulaGoala(x, 'Reluarea convocării după date corectate de Beneficiar (dacă e cazul)', 1, '{{reluare_data}}')
      x = uneste(x, ['adresa Beneficiar nr. ______ / recomandată nr. ', '______'], 'adresa Beneficiar nr. {{reluare_adresa_tgz_nr}} / recomandată nr. {{reluare_nr_tracking}}')
      x = inlocuiesteWt(x, '☐ nu e cazul  ☐ fără răspuns  ☐ răspuns: ______', '{{bifa_reluare_nu_e_cazul}} nu e cazul  {{bifa_reluare_fara_raspuns}} fără răspuns  {{bifa_reluare_raspuns}} răspuns: {{reluare_raspuns_text}}')
      x = inWt(x, '☐ deținătorul a declarat că nu participă și nu are obiecții (declarația se anexează)', bife(['sit_declaratie']))
      x = inWt(x, '☐ deținătorul nu s-a prezentat după convocare și afișare', bife(['sit_neprezentat']))
      x = inWt(x, '☐ deținător neidentificat / fără adresă cunoscută', bife(['sit_neidentificat']))
      x = inWt(x, '☐ deținătorul a refuzat semnarea fără a formula obiecții privind readucerea terenului', bife(['sit_refuz']))
      x = inWt(x, 'Lucrări executate: ☐ împrăștierea stratului de sol fertil ☐ nivelare ☐ arat ☐ discuit / grăpat ☐ însămânțare ☐ refacere gard ☐ refacere drum ☐ altele: __________',
        [...bife(['sol_fertil', 'nivelare', 'arat', 'discuit', 'insamantare', 'gard', 'drum', 'altele']), ['__________', '{{lucrari_altele}}']])
      x = inWt(x, 'Categoria de folosință inițială, conform bazei de date a Beneficiarului (informație din acea sursă, nu verificată independent): __________. Starea terenului la data constatării: ☐ nivelat ☐ strat vegetal refăcut ☐ însămânțat ☐ gard / drum refăcut ☐ alta: __________.',
        [['__________', '{{categoria_initiala}}'], ...bife(['st_nivelat', 'st_strat_vegetal', 'st_insamantat', 'st_gard_drum', 'st_alta']), ['__________', '{{stare_teren_alta}}']])
      x = uneste(x, ['Verificare efectivă pe teren la data de __', '_._', '__.2026, efectuată de: ______________ (Antreprenor), ______________ (Beneficiar). '],
        'Verificare efectivă pe teren la data de {{verificare_data}}, efectuată de: {{verificare_de_gazpet}} (Antreprenor), {{verificare_de_tgz}} (Beneficiar). ')
      x = inlocuiesteWt(x, ' ____________ – ', ' {{uat}} – ')
      x = inlocuiesteWt(x, ' nominalizat: ____________', ' nominalizat: {{reprezentant_uat_nume}}')
      x = inlocuiesteWt(x, NCD, ['{{semnatar_tgz}}', '{{semnatar_gazpet}}', '{{semnatar_uat}}', '{{semnatar_apm}}'])
      return x
    },
  },
  'adresa_uat.docx': {
    model: 'Model_4_Adresa_UAT_convocare_afisare_PV_v5_finala.docx',
    pasi: x => {
      x = inlocuiesteWt(x, 'ADRESĂ către Primăria ______________________', 'ADRESĂ către Primăria {{uat}}')
      x = inlocuiesteWt(x, 'Nr. ________ / ___.___.2026', ['Nr. {{nr_document}} / {{data}}', 'Nr. {{afisare_pv_nr}} / {{afisare_data_start}}'])
      x = inlocuiesteWt(x, 'Către: Primăria comunei ______________________, jud. Mehedinți', 'Către: Primăria comunei {{uat}}, jud. {{judet}}')
      x = inWt(x, 'În numele și cu împuternicirea Beneficiarului (împuternicire nr. ___ / ___.2026, anexată), vă rugăm să ne sprijiniți cu următoarele:', [['nr. ___ / ___.2026,', 'nr. {{imputernicire_nr}} / {{imputernicire_data}},']])
      x = inlocuiesteWt(x, '___.___.2026', ['{{zi1}}', '{{zi2}}', '{{zi3}}'])
      x = inlocuiesteWt(x, '09:00 – 16:00', ['{{program1}}', '{{program3}}'])
      x = inlocuiesteWt(x, '09:00 – 19:00', '{{program2}}')
      for (const i of [1, 2, 3]) x = celulaGoala(x, `Ziua ${i}`, 3, `{{sate_zi${i}}}`)
      x = inWt(x, 'începând cu data de ___.___.2026 (cu cel puțin 10 zile înainte de prima sesiune) și până la ultima zi de sesiune, cu încheierea procesului-verbal de afișare anexat. Convocarea afișată conține identificarea parcelelor (sat, tarla, nr. cadastral), fără date personale.', [['___.___.2026', '{{afisare_data_start}}']])
      x = inWt(x, 'Vă rugăm să ne confirmați disponibilitatea spațiului și datele propuse până la ___.___.2026. ', [['___.___.2026', '{{termen_confirmare}}']])
      x = inlocuiesteWt(x, 'Persoană de contact GAZPET INSTAL: Ramona Brehui, tel. ______________, e-mail redari@gazpet.ro. Reprezentantul TRANSGAZ: _______________________, tel. ______________.',
        'Persoană de contact GAZPET INSTAL: {{contact_nume}}, tel. {{contact_telefon}}, e-mail {{contact_email}}. Reprezentantul TRANSGAZ: {{reprezentant_tgz}}, tel. {{reprezentant_tgz_telefon}}.')
      x = inlocuiesteWt(x, 'GAZPET INSTAL S.R.L. – Răzvan Trusu, Administrator', 'GAZPET INSTAL S.R.L. – {{reprezentant_gazpet}}')
      x = inWt(x, 'Către toți proprietarii și utilizatorii terenurilor de pe raza comunei ______________ afectate temporar de lucrările la conducta de transport gaze naturale Prunișor–Jupa, Lot 1 (lista parcelelor mai jos).', [['______________', '{{uat}}']])
      x = inWt(x, 'Lucrările de readucere a terenului la starea inițială au fost executate. Sunteți invitați să constatați starea terenului și să semnați procesul-verbal la sediul Primăriei, în zilele ___, ___ și ___ ___________ 2026, între orele 09:00 – 16:00 (ziua 2 până la 19:00). Aduceți actul de identitate și, dacă e cazul, actul care dovedește calitatea de proprietar, moștenitor sau arendaș.',
        [['zilele ___, ___ și ___ ___________ 2026, între orele 09:00 – 16:00 (ziua 2 până la 19:00).', 'zilele {{zile_sesiune_text}}, între orele {{program_text}}.']])
      // D1 (Răzvan 02.11): fără pagină publică pe UAT — „sau online la ____” se scoate; pe afișare rămân telefonul și e-mailul
      x = inWt(x, 'Dacă nu vă puteți prezenta, ne puteți răspunde la telefon ______________, pe e-mail la redari@gazpet.ro sau online la ______________________. În lipsa participării, starea terenului poate fi constatată tehnic de reprezentanții Beneficiarului, ai Antreprenorului și ai Primăriei; această constatare nu reprezintă acceptarea tacită din partea dumneavoastră.',
        [['telefon ______________', 'telefon {{contact_telefon}}'], ['e-mail la redari@gazpet.ro sau online la ______________________.', 'e-mail la {{contact_email}}.']])
      x = inWt(x, 'Convocarea se face în numele S.N.T.G.N. TRANSGAZ S.A., Beneficiar al investiției. Contact GAZPET INSTAL: Ramona Brehui, ______________, redari@gazpet.ro. Contact TRANSGAZ: ______________.',
        [['Ramona Brehui, ______________, redari@gazpet.ro.', '{{contact_nume}}, {{contact_telefon}}, {{contact_email}}.'], ['Contact TRANSGAZ: ______________.', 'Contact TRANSGAZ: {{reprezentant_tgz}}, tel. {{reprezentant_tgz_telefon}}.']])
      // excepția (2): un singur rând-șablon în „Lista parcelelor”, celelalte 7 rânduri goale se șterg
      x = randGolDupa(x, 'Nr. cadastral / parcelă', ['{{rand.nr}}', '{{rand.sat}}', '{{rand.tarla}}', '{{rand.nr_cadastral}}', '{{rand.poz_hg}}', '{{rand.tronson}}'])
      x = stergeRanduriGoaleDupa(x, '{{rand.tronson}}', 7)
      x = inWt(x, 'Subsemnații, ______________________, în calitate de ______________ al Primăriei comunei ______________, și ______________________, reprezentant al GAZPET INSTAL S.R.L., constatăm că astăzi, ___.___.2026, ora ____, a fost afișată la avizierul de la intrarea în sediul Primăriei convocarea proprietarilor și utilizatorilor de teren la constatarea readucerii terenului la starea inițială, pentru ____ parcele din lista anexată, cu programul sesiunilor din zilele ___, ___, ___ ___________ 2026.',
        [['Subsemnații, ______________________,', 'Subsemnații, {{reprezentant_uat_nume}},'], ['de ______________ al', 'de {{reprezentant_uat_functie}} al'], ['comunei ______________,', 'comunei {{uat}},'],
          ['și ______________________,', 'și {{reprezentant_gazpet_nume}},'], ['astăzi, ___.___.2026, ora ____,', 'astăzi, {{afisare_data_start}}, ora {{afisare_ora}},'], ['pentru ____ parcele', 'pentru {{numar_parcele}} parcele'],
          ['zilele ___, ___, ___ ___________ 2026.', 'zilele {{zile_sesiune_text}}.']])
      x = inWt(x, 'Convocarea rămâne afișată până la data de ___.___.2026 (ultima zi de sesiune). Dezafișarea se consemnează mai jos.', [['___.___.2026', '{{afisare_data_end}}']])
      x = inlocuiesteWt(x, 'Primăria ______________ (semnătura și ștampila)', 'Primăria {{uat}} (semnătura și ștampila)')
      x = inlocuiesteWt(x, NCD, ['{{semnatar_uat}}', '{{semnatar_gazpet}}'])
      return x
    },
  },
  'pv_c.docx': {
    model: 'Model_5_PV_receptie_tronson_v5_final.docx',
    pasi: x => {
      x = inlocuiesteWt(x, ANTET_VECHI, ANTET_NOU)
      x = inlocuiesteWt(x, 'Nr. ________ / ___.___.2026', 'Nr. {{nr_pv}} / {{data_pv}}')
      x = randGolDupa(x, 'Nr. total parcele', ['{{tronson}}', '{{km_de_la}} – {{km_pana_la}}', '{{uat_uri}}', '{{numar_parcele}}'])
      x = celulaGoala(x, 'PV tip A – semnate cu deținătorul', 1, '{{pva_sesiune_nr}}')
      x = celulaGoala(x, 'PV tip A – semnate cu deținătorul', 2, '{{pva_sesiune_mp}}')
      x = celulaGoala(x, 'PV tip A – semnate prin corespondență', 1, '{{pva_corespondenta_nr}}')
      x = celulaGoala(x, 'PV tip A – semnate prin corespondență', 2, '{{pva_corespondenta_mp}}')
      x = celulaGoala(x, 'PV tip B – constatare tehnică (deținător absent / neidentificat / refuz nemotivat)', 1, '{{pvb_nr}}')
      x = celulaGoala(x, 'PV tip B – constatare tehnică (deținător absent / neidentificat / refuz nemotivat)', 2, '{{pvb_mp}}')
      x = celulaGoala(x, ' de readucere deschise (termen de remediere în curs)', 1, '{{obiectii_deschise_nr}}')
      x = celulaGoala(x, ' de readucere deschise (termen de remediere în curs)', 2, '{{obiectii_deschise_mp}}')
      x = celulaGoala(x, 'TOTAL', 1, '{{total_nr}}')
      x = celulaGoala(x, 'TOTAL', 2, '{{total_mp}}')
      x = inlocuiesteWt(x, NCD, ['{{semnatar_tgz}}', '{{semnatar_gazpet}}', '{{semnatar_apm}}'])
      return x
    },
  },
}

async function construieste(sablon, { model, pasi }) {
  const zip = await JSZip.loadAsync(readFileSync(resolve(REF, model)), { createFolders: false })
  const doc = await zip.file('word/document.xml').async('string')
  const nou = pasi(doc)
  asigura(!/\{\{(?![A-Za-z0-9_.]+\}\})/.test(nou), `${sablon}: acoladă malformată`)
  zip.file('word/document.xml', nou, { date: DATA_FIXA, createFolders: false })
  // excepția (3): fără miniatură (nu mai corespunde) și fără numele ultimului editor în docProps
  if (zip.file('docProps/thumbnail.jpeg')) zip.remove('docProps/thumbnail.jpeg')
  const core = await zip.file('docProps/core.xml')?.async('string')
  if (core) zip.file('docProps/core.xml', core.replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, '<cp:lastModifiedBy></cp:lastModifiedBy>'), { date: DATA_FIXA, createFolders: false })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// Jakarinos f-v2 r2 P3: toate cele 5 se construiesc și se validează în memorie; pe disc se scrie doar dacă au trecut TOATE
// (un eșec la un model nu mai lasă șabloanele dinainte suprascrise)
const construite = []
for (const [sablon, reteta] of Object.entries(RETETE)) {
  const buf = await construieste(sablon, reteta)
  const chei = [...new Set([...(await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')).matchAll(/\{\{([A-Za-z0-9_.]+)\}\}/g)].map(m => m[1]))]
  construite.push({ sablon, reteta, buf, chei })
}
if (VERIFICA) {
  let diferente = 0
  for (const { sablon, reteta, buf } of construite) {
    let acum = null
    try { acum = readFileSync(resolve(OUT, sablon)) } catch { acum = null }
    const egal = acum && Buffer.compare(acum, buf) === 0
    if (!egal) diferente += 1
    console.log(`${egal ? 'identic' : 'DIFERĂ'}  ${sablon}  ←  ${reteta.model}`)
  }
  if (diferente) process.exit(1)
} else {
  // Copilot f-v2 r3 P3-02: publicare în doi pași. (1) toate 5 se scriu în fișiere temporare lângă destinație și se recitesc
  // octet cu octet; un eșec aici șterge temporarele și NU atinge șabloanele. (2) abia apoi rename temporar → destinație.
  // Limita (Windows, 5 fișiere): fiecare rename e atomic, dar cele 5 nu formează o tranzacție; un eșec la pasul (2) (fișier
  // deschis în Word / blocat de antivirus) e raportat cu lista celor deja publicate, iar `--verifica` arată ce a rămas vechi.
  const temporar = sablon => resolve(OUT, `.${sablon}.tmp-${process.pid}`)
  // curățenie pe TOATE cele 5 temporare (și unul scris parțial, înainte de eșec); o ștergere eșuată nu ascunde eroarea inițială
  const stergeTemporare = (pastreaza = []) => {
    const ramase = []
    for (const { sablon } of construite) {
      if (pastreaza.includes(sablon)) continue
      try { rmSync(temporar(sablon), { force: true }) } catch { ramase.push(temporar(sablon)) }
    }
    return ramase.length ? ` Temporare care nu s-au putut șterge: ${ramase.join(', ')}.` : ''
  }
  try {
    for (const { sablon, buf } of construite) {
      writeFileSync(temporar(sablon), buf)
      asigura(Buffer.compare(readFileSync(temporar(sablon)), buf) === 0, `${sablon}: fișierul temporar nu corespunde`)
    }
  } catch (e) {
    throw new Error(`Nimic publicat (șabloanele au rămas cele vechi): ${e.message}.${stergeTemporare()}`)
  }
  const publicate = []
  try {
    for (const { sablon, reteta, buf, chei } of construite) {
      renameSync(temporar(sablon), resolve(OUT, sablon))
      publicate.push(sablon)
      console.log(`scris ${sablon} (${buf.length} octeți, ${chei.length} placeholder-e distincte)  ←  ${reteta.model}`)
    }
  } catch (e) {
    throw new Error(`Publicare parțială: ${publicate.join(', ') || 'niciunul'} sunt noi, restul au rămas vechi (${e.message}). Rulează din nou scriptul.${stergeTemporare(publicate)}`)
  }
}
