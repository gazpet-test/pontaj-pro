# Redări teren — șabloanele reale (Model_1..7) și harta câmpurilor

**Versiunea modelelor: Final_v2 (03.11.2026, avocatul, deciziile juridic#028 + #029 și Răzvan 03.11)** — din
`G:\My Drive\Lot1_Redari_Modele_v5\Avocat 03.11.2026\Modele PV Redari_Finale\Final_v2\`. Înlocuiește v5 (01.11.2026; v5 rămâne
în istoricul git, commit `a16440d5`). Model_6 (registrul Excel) și cele 3 PDF-uri sunt din pachetul v3. Originalele stau neatinse
în `docs/redari/referinta/` (SHA-256 identice cu fișierele din Drive), șabloanele cu placeholder-e în `public/redari/sabloane/`:

| Model (referință, Final_v2) | Șablon | Per | Rol |
|---|---|---|---|
| `Model_1_Convocator_proprietar_v6_final.docx` | `convocator.docx` | deținător | convocarea scrisă (Anexa 1 din plan) |
| `Model_2_PV_tip_A_cu_proprietarul_v5_final.docx` | `pv_a.docx` | deținător | PV de constatare cu deținătorul (Anexa 2) |
| `Model_3_PV_tip_B_constatare_tehnica_v5_finala.docx` | `pv_b.docx` | parcelă | PV de constatare tehnică + demersuri (Anexa 3) |
| `Model_4_Adresa_UAT_convocare_afisare_PV_v5_finala.docx` | `adresa_uat.docx` | UAT | adresă către primărie + Anexa 2 (convocare de afișare + lista parcelelor) + Anexa 3 (PV de afișare) |
| `Model_5_PV_receptie_tronson_v5_final.docx` | `pv_c.docx` | tronson | PV de recepție a redării pe tronson (Anexa 6) |
| `Model_6_Registru_urmarire_convocari.xlsx` (v3) | — (export xlsx) | — | registrul: foi Registru / Centralizator / Legendă (§5) |
| `Model_7_Anexa7_Tipizat_v6_final.xlsx` (și v5: `Model_7_Anexa7_Tipizat_date_detinatori_TGZ.xlsx`) | — (import, `red_import_loturi.sursa = 'ANEXA7'`) | — | tipizatul cerut Beneficiarului pentru datele deținătorilor (§6) |
| `Lot1_Checklist_urmarire.pdf`, `Lot1_Plan_verificare_redari_DRAFT.pdf`, `Lot1_Scrisoare_Transgaz_DRAFT.pdf` (v3) | — | — | context (§7) |

Din Final_v2 NU intră în repo (nu sunt șabloane ERP, doar referință): `A1_Plan_verificare_redari_Lot1_rev49_final.docx` (de aici
termenul de 10 zile, §8), `A1_Scrisoare_Transgaz_plan_Lot1_rev9_final.docx`, `A3_Adresa_TGZ_acord_art28_v1_final.docx`,
`A3_Informare_GDPR_Lot1_v3_final.docx` (textul informării, încă neaprobat de Transgaz — PR #939 rămâne DRAFT).

**PII**: niciun fișier nu conține nume sau adrese reale de proprietari. Model_6 are 4 rânduri-exemplu marcate explicit
„(exemplu) POPESCU Ion” etc.; Model_7 (v5 și v6) e gol (doar antet). Modelele conțin doar nume de angajați Gazpet
(administratorul, persoana de contact) și date de firmă — devenite placeholder-e unde apar în șabloane
(`{{reprezentant_gazpet}}`, `{{contact_nume}}`). În `docProps/core.xml` al șabloanelor „ultima modificare de” e golit.

### Ce aduc modelele Final_v2 față de v5 (vizibil în șabloane)
- **Toate**: diacriticele și greșelile de tastare corectate de avocat (textul șabloanelor = textul modelelor); linia „MODEL –
  DRAFT INTERN …” nu mai există (poarta reală rămâne împuternicirea: fără ea nu se generează convocatoare / AR-uri).
- **Model_1 (convocator v6)**: titlul informării devine „Date personale” (paragraful rămâne `{{text_gdpr}}`, textul din ERP);
  opțiunea 3 e „Nu particip. Am următoarele obiecții: ____.”; s-a scos fraza „Această constatare nu reprezintă acceptarea
  tacită …” — rămâne „În lipsa participării sau a unui răspuns, … pot efectua o constatare tehnică documentată” (= PV B).
- **Model_2 (PV A)**: fără „Fotografii actuale datate anexate”; **semnează și Antreprenorul** (3 semnatari: deținător, TGZ,
  Gazpet); obiecțiile au o a doua linie de scris (rămâne goală în șablon, textul vine din `{{obiectii_text}}`).
- **Model_3 (PV B)**: fără „Extras jurnal de șantier”, fără „Măsurători topo / plan de situație anexat” și fără fotografii.
- **Model_4 (adresa UAT)**: fără antetul firmei (deci fără contract și denumirea proiectului); pct. 4, termenul de confirmare,
  contactul și anexele sunt într-un singur paragraf; ziua 2 „09:00 – 19:00”. „sau online la ____” din Anexa 2 s-a scos din
  nou în șablon (decizia D1, 02.11: nu există pagină publică pe UAT).
- **Model_5 (PV C)**: același text, doar corecturi.
- **Model_7 (Anexa 7 v6)**: antetul (rândul 5, 30 de coloane) e identic cu v5; s-a schimbat doar fraza de reguli din rândul 2
  („Datele sunt transmise de Transgaz (operator) către Gazpet (persoană împuternicită) …”). Importul nu se schimbă (§6).

Ce adusese v5 față de v3 (istoric): Model_1 — opțiunea 4 e „Contest starea terenului și solicit constatarea pe
teren, la data stabilită de comisie” (fără dată de mână), contactul Gazpet e nominal, propoziția „Procesul-verbal va fi
pregătit cu datele parcelei dumneavoastră; la sesiune doar îl verificați și îl semnați”; Model_2/3 — pct. 4/5 au
„Categoria de folosință inițială conform bazei TGZ”, bife pentru starea terenului, plan DA/NU, „Fotografii actuale datate”
(nu mai există „foto înainte/după”), „Constatarea s-a făcut la sediul Primăriei / pe teren” (PV A), „Verificare efectivă pe
teren … efectuată de … / extras jurnal de șantier” (PV B); Model_3 — rând nou „Reluarea convocării după date corectate de
Beneficiar”, canal „online / SMS / e-mail / telefonic / scris”, reprezentant UAT „nominalizat”; Model_4 — pct. 3 cere
nominalizarea scrisă a reprezentantului Primăriei (nume, funcție, telefon) „trecut în procesele-verbale generate înainte
de sesiuni”, e-mailul de răspuns în convocarea afișată.

## 1. Cum au fost făcute șabloanele (și cum se refac)

- **Reproductibil (Final_v2)**: `node scripts/redari_sabloane_din_modele.mjs` citește modelele din `docs/redari/referinta/` și
  scrie cele 5 șabloane; `--verifica` doar compară (iese cu 1 dacă un șablon din repo diferă de ce ar produce scriptul). Fiecare
  operație caută textul EXACT din model și cere numărul declarat de apariții — un model schimbat oprește scriptul, nu produce
  un șablon greșit. Ieșirea e deterministă (dată fixă pe intrările modificate, fără intrări de director).
- S-a modificat DOAR textul din `<w:t>` în `word/document.xml` (modelele nu au antete/subsoluri Word); formatarea e a
  originalului, cu excepțiile (6) și (7) de mai jos. Excepții structurale: (1) în `convocator.docx` un paragraf nou care conține
  doar `{{qr}}`, imediat după paragraful opțiunilor de răspuns (textul „codul QR alăturat” → „codul QR de mai jos”; din 03.11
  paragraful e un cadru aliniat la dreapta, §9); (2) în `adresa_uat.docx` tabelul „Lista
  parcelelor” rămâne cu UN rând-șablon (`{{rand.*}}`), celelalte 7 rânduri goale se șterg; (3) `docProps`: fără miniatură și
  fără „ultima modificare de”; (4) **nou la Final_v2**: Word a salvat celulele goale ale tabelelor fără run (`<w:p …/>`) — ele
  primesc un run `<w:rPr><w:sz w:val="19"/></w:rPr><w:t>{{…}}</w:t>` (formatul celulelor de date din aceleași tabele, ca la v5);
  (5) în `pv_b.docx` paragraful `{{pv_a_referinta}}` sub „Nume:” (decizia 02.11, PR #935); (6) toate cele 5 trec de pe Letter
  pe A4, cu lățimile tabelelor scalate; (7) convocatorul are formatarea strânsă ca fața să încapă pe o pagină A4 (ambele §9);
  (8) **convocatorul doar cu QR** (decizia Răzvan 03.11 seara: „dacă trimitem link-ul, trimitem degeaba, nu o să-l deschidă
  nimeni”): convocatorul pleacă prin poștă, deci adresa web de răspuns nu se mai tipărește și `{{link}}` dispare din șablon.
  Singura reformulare a textului juridic din ȘABLON (modelul necompletat), declarată în `CONVOCATOR_DOAR_QR` (generator):
  „Prin formularul online de la adresa ______________________ (sau scanând codul QR alăturat), la telefon …” →
  „Prin formularul online, scanând cu telefonul codul QR de mai jos, la telefon {{contact_telefon}} …”. QR-ul duce în continuare
  la formularul de răspuns (`https://redari.gazpet.ro/redari/raspuns/<token>`); generatorul refuză un convocator care mai are
  `{{link}}` sau o adresă web în text, iar `src/redari/sabloaneA4.test.js` cere schimbarea exact o dată și, refăcută înapoi,
  amprenta textului de dinainte (nimic altceva schimbat în șablon). Unde modelul a rupt un câmp în mai
  multe `<w:t>` (ex. „la data de __|_._|__.2026”, „Contact TRANSGAZ … tel. |____”), textul întreg ajunge în primul `<w:t>`, iar
  celelalte se golesc (aceeași formatare).
- **Documentul COMPLETAT (tot excepția (8), #970 r2–r7)**. În plus față de șablon, se schimbă DECLARAT textul GDPR tipărit pe față
  (`text_gdpr` din BD rămâne neschimbat), prin `textGdprFataConvocator` din `docx.js`:
  - `VERSO_INFORMARE_INCLUS = false` (main; versoul cu informarea completă vine cu PR #939): se scoate PROPOZIȚIA ÎNTREAGĂ care
    conține marcajul „Informarea completă: <URL | www. | [link …]>” (r10; și cu rând nou după „:”, și cu text după link) și nu
    se adaugă nicio trimitere la verso, nici când proiectul are `link_informare_gdpr`. **Regula pe propoziție (r7)**: se scoate
    și ORICE propoziție din `text_gdpr` care conține cuvântul „verso” (după normalizare: fără diacritice, litere mici, spații
    albe — inclusiv `\n`, `\r`, NBSP — comprimate), ex. „Informarea completă se află pe verso.”, „Pe verso găsiți informațiile
    complete …”, „Detalii pe verso.”. `text_gdpr` e paragraful „Date personale”, deci orice mențiune a versoului de acolo se
    referă la informare. Propoziția se termină DOAR la `.` `!` `?` URMAT de spațiu alb sau de finalul textului (r8): punctele
    din domenii („dataprotection.ro”) sau din abrevierile lipite nu o încheie, iar un rând nou fără punct nu o încheie nici el;
  - `VERSO_INFORMARE_INCLUS = true` (îl comută #939, odată cu generarea versoului): prima propoziție cu marcaj devine
    „Informarea completă se află pe verso.” (celelalte se scot); fără marcaj, trimiterea se adaugă la final dacă proiectul are
    `link_informare_gdpr`. Dacă textul pomenește deja versoul, în orice formulare (r10), nu se mai adaugă nimic.
- **Adresele web pe documentul completat: clasificare pe TOKENURI (r12)** (`adresaWebNepermisa`, apelată de
  `genereazaConvocator`, strict și la previzualizare; constantele unice `GAZDE_PERMISE`, `MARCAJE_PROPRII` din `docx.js`):
  1. adresele PROPRII (`gazpet.ro`, `vercel.app`, `pontaj-pro`, calea de răspuns, calea de informare) se caută ca subșir pe
     text, după scoaterea e-mailurilor (regex strict r9: partea locală `[A-Za-z0-9._%+-]+`, care nu începe cu `www.`, domeniul
     `[A-Za-z0-9.-]+.tld`, cu limite) și ÎNAINTEA oricărei excepții, ca să nu se ascundă în calea unui URL permis
     (`https://dataprotection.ro/redari.gazpet.ro/x`) → refuz; `www.gazpet.ro,contact@example.com` lasă `www.gazpet.ro` → refuz;
  2. textul se împarte la spații albe (inclusiv rândurile noi și taburile din paragraf, `<w:br/>` / `<w:tab/>`); fiecare token
     pierde punctuația de la margini (`()[]{}«»„”“"'`, iar la dreapta și `.,;:!?`); un token care e în întregime un e-mail
     valid (același regex, ancorat) e permis: `redari@www.gazpet.ro`, `ion@www.dataprotection.ro`;
  3. gazda: cu `://`, partea dintre `://` și primul `/`, `?` sau `#`; altfel, dacă tokenul începe cu `www.` sau partea dinainte
     de primul `/` are un punct, acea parte. Ce e în cale (după primul `/`) NU se clasifică drept domeniu
     (`dataprotection.ro/legislatie/dataprotection.ro.pdf` e permis);
  4. gazda e „web” dacă tokenul are `://` sau începe cu `www.`, ori dacă gazda (fără `user@` și `:port`) are un punct și ultima
     etichetă e alfabetică, de 2–24 litere. O gazdă web e permisă DOAR dacă e exact `dataprotection.ro` sau
     `www.dataprotection.ro` (fără deosebire de majuscule), cu schema http / https (dacă are) și fără `@`, `:` (port), `[` sau
     `]`. Orice altă gazdă web e refuzată: `exemplu.ro.xyz`, `portal.com.uk`, `dataprotection.ro.a.com`, `a.ro`, `x.y.com`,
     IP-uri cu schemă, `:443`, `ftp://`, `user@gazdă`;
  - textul juridic nu dă alarme: „S.N.T.G.N.”, „S.R.L.”, „lit.c”, „art.6”, „H.G. nr. 1.234/2022”, „pct. 5.2”, „A.P.M.”,
    „Nr. 123/2026”, „Data:03.11.2026” nu au ultima etichetă alfabetică de 2+ litere; verificat în teste împreună cu default-ul
    `text_gdpr` din migrare și textul scurt din Model_1 v6. Textele `text_gdpr` reale din BD (LOT1, TEST-RAZVAN) nu au fost
    citite aici; o alarmă falsă pe ele apare ca refuz clar la generare (de ex. un punct fără spațiu după el: „Primăria.Comuna”);
  - mesajul de eroare are doar partea DOCX și marcajul propriu sau gazda găsită (fără utilizator, cale sau text din document — PII);
  - părțile verificate, EXACT: `word/document.xml`, `word/header*.xml`, `word/footer*.xml`, `word/footnotes.xml`,
    `word/endnotes.xml`, `word/comments.xml` (cele care există). Pe fiecare se verifică TOATE textele: fluxul exterior cu
    casetele de text (`w:txbxContent`), `mc:Fallback` și `w:pict` scoase; fiecare casetă, fiecare `mc:Fallback` și fiecare
    `w:pict`, separat; textul complet (aici doar adresele proprii, ca lipirea textelor să nu dea URL-uri false). Run-urile se
    lipesc, paragrafele se despart. Un DOCX cu `w:altChunk` e refuzat. **Limite declarate**: nu se verifică glosarul
    (`word/glossary/*`), obiectele / diagramele încorporate, textul din imagini și câmpurile calculate de Word la deschidere;
    șabloanele convocatorului nu au asemenea structuri.
- Fiecare placeholder stă întreg într-un singur `<w:t>` → `docx.js` înlocuiește local, fără consolidare de run-uri (limita 1).
- Antetul de firmă (adresă, CUI, telefon, „Lider al Asocierii …”) rămâne text fix; din antet s-au parametrizat doar
  `Contract Transgaz nr. {{contract_nr}}/{{contract_data}}` și `{{proiect_denumire}}` (convocator, PV A, PV B, PV C; adresa UAT nu
  mai are antet în Final_v2). Corpul rămâne specific Lot 1 (Prunișor–Jupa, Acordul de mediu nr. 4/18.07.2022, A.P.M. Mehedinți,
  jud. Mehedinți în adresa UAT devine `{{judet}}`) — **șabloanele sunt ale Lot 1**.
- Textele celor 4 opțiuni de răspuns din convocator rămân FIXE (text juridic); informarea GDPR e `{{text_gdpr}}` (tot
  paragraful de sub „Date personale”), contactul Gazpet e `{{contact_nume}} {{contact_telefon}} {{contact_email}}`.
- Verificare (03.11.2026): `node scripts/redari_sabloane_verifica.mjs` (ieșirea în §4) și `src/redari/sabloaneFinalV2.test.js`
  (fără DRAFT, fără „acord” pentru lipsa răspunsului, PV A cu 3 semnatari, PV B fără foto / topo / jurnal, termenul din adresa UAT
  = `TERMEN_CONVOCARE_ZILE`). Test de fum cu `completeazaDocx(…, {strict:true})` pe toate 5: 0 placeholder-e rămase (în
  `adresa_uat.docx`, `{{rand.*}}` se repetă înaintea câmpurilor simple, 3 rânduri), QR-ul devine imagine (`word/media/qr.png`),
  `\n` din `{{obiectii_text}}` devine `<w:br/>`; XML-ul tuturor părților e bine format (minidom), zip-urile trec `testzip`.

### Convenții de placeholder-e noi (în plus față de contract §8)
- `{{bifa_*}}` = o căsuță: codul pune `☒` sau `☐` (textul de după bifă rămâne în șablon). Fără bife, docx.js nu poate
  „bifa” un ☐ din text. Bifele „fixe” care au rămas ☐ în text: niciuna (toate au placeholder).
- `{{semnatar_*}}` = textul de sub linia de semnătură (în model „Nume, calitate, data”): codul pune „NUME Prenume, funcție”
  (data rămâne de mână la semnare).
- `{{rand.camp}}` = celulă a rândului-șablon dintr-un tabel-listă (`adresa_uat.docx`). `repetaRand(xml, randuri)` este
  implementată în `docx.js`, apelată de `completeazaDocx` prin `{ randuri: { rand: [...] } }` înaintea câmpurilor simple.
  Zero parcele produce un singur rând „(nicio parcela importata)”; `strict` refuză și cheile `rand.*` rămase.
- Datele se dau formatate (`formatDataRo` → `zz.ll.aaaa`), numerele cu `formatNumarRo`; valorile goale se dau ca `''`
  (strict cere cheia, nu valoarea).

## 2. Harta câmpurilor pe șablon

Legendă coloană „sursă”: `t.coloană` = tabela din CONTRACT_SCHEMA.md §2; **calcul** = compus în cod; **FĂRĂ SURSĂ** = nu
există în contract (strânse în §3). „Oblig.” = obligatoriu la generarea de trimis (nu la previzualizare).

### 2.1 `convocator.docx` (Model 1) — per deținător, 35 placeholder-e (fără `{{link}}` din 03.11 seara, excepția (8))

| placeholder | sursă în BD | oblig. | observații |
|---|---|---|---|
| `{{contract_nr}}`, `{{contract_data}}` | red_proiecte.contract_nr, .contract_data | da | antet; în model „30/22.01.2025” |
| `{{proiect_denumire}}` | red_proiecte.denumire | da | antet |
| `{{imputernicire_nr}}`, `{{imputernicire_data}}` | red_proiecte.imputernicire_nr, .imputernicire_data | da | fără împuternicire nu se trimite |
| `{{nr_document}}` | red_convocari.nr_document (`fn_red_numar_document('C')`) | da | `C-0001` |
| `{{data}}` | data generării | da | |
| `{{nume}}` | red_detinatori.nume | da | |
| `{{calitate}}` | red_detinatori.calitate | da | în model „(proprietar / utilizator de teren)”; `neidentificat` nu primește convocator |
| `{{adresa}}` | calcul: red_detinatori_contact.adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal | da | o linie; doar admin/editor |
| `{{uat}}` ×2 | red_uat.nume | da | tabel parcelă, „Primăriei {{uat}}” |
| `{{sat}}`, `{{tarla}}` | red_parcele.sat, .tarla | nu | o celulă „{{sat}} / {{tarla}}” |
| `{{nr_cadastral}}` | red_parcele.nr_cadastral | nu | |
| `{{poz_hg}}` | red_parcele.poz_hg | nu | **nou față de contract §8** (coloana există) |
| `{{suprafata}}` | red_parcele.suprafata_temporara_mp (formatNumarRo) | nu | |
| `{{tronson}}` | red_parcele.tronson | nu | **nou față de §8** |
| `{{zi1..3}}` | red_uat.sesiune_zi1..3 | da | |
| `{{program1..3}}` | red_uat.program_zi1..3 | da | model: „09:00 – 16:00”, ziua 2 „09:00 – 19:00 (program prelungit)” |
| `{{sate_zi1..3}}` | **FĂRĂ SURSĂ** → red_uat.sate_zi1..3 text | nu | coloana „Sate / tarlale programate” |
| `{{qr}}` | imagine `genereazaQr(linkRaspuns(red_detinatori.token_raspuns))`, mereu pe `https://redari.gazpet.ro` | da | paragraf nou, singur; linkul NU se tipărește (excepția (8)), `genereazaConvocator` îl întoarce doar în rezultat (`link`) |
| `{{contact_telefon}}` ×2 | red_proiecte.contact_telefon | da | „la telefon …” + contact Gazpet (în model telefonul era gol) |
| `{{contact_nume}}`, `{{contact_email}}` | red_proiecte.contact_nume, .contact_email | da | în model „Ramona Brehui” / „redari@gazpet.ro” = valorile de pus în red_proiecte |
| `{{text_gdpr}}` | red_proiecte.text_gdpr | da | TOT paragraful de sub titlul „Date personale” (Final_v2). În Model_1 v6 aici e „TEXTUL SCURT” din `A3_Informare_GDPR_Lot1_v3_final` („Transgaz folosește datele … Pe verso găsiți informațiile complete …”); ERP-ul păstrează textul din BD până la aprobarea Transgaz (PR #939). **Regula actuală (03.11 seara, §1 excepția (8))**: pe față NU se tipărește niciun link; propoziția „Informarea completă: …” se scoate, iar trimiterea la verso apare doar cu `VERSO_INFORMARE_INCLUS` (PR #939). **Istoric** (înlocuit de regula actuală), v5: textul din Model_1 v5 = valoarea implicită; conține „Destinatari: Primăria ____” și „Informarea completă: ____” → **de decis**: textul din BD ține UAT-ul generic („Primăria comunei pe raza căreia se află parcela”) sau codul înlocuiește un marcaj `{uat}` în text; linkul informării complete intra în text (istoric, nu mai e valabil) |
| `{{reprezentant_tgz}}` | calcul: red_proiecte.reprezentant_tgz_nume + _functie | nu | „Contact TRANSGAZ (DRFT / ofițer de legătură)” |
| `{{reprezentant_tgz_telefon}}` | **FĂRĂ SURSĂ** → red_proiecte.reprezentant_tgz_telefon | nu | |
| `{{semnatar_gazpet}}` | calcul: red_proiecte.reprezentant_gazpet_nume + _functie | nu | sub semnătura Antreprenor |
| `{{semnatar_tgz}}` | calcul: reprezentant_tgz_nume + _functie | nu | sub „Beneficiar (viză)” |

Rămân de mână (intenționat): opțiunile cu ☐ („ziua ____ / intervalul ____”, obiecțiile scrise) — le completează
destinatarul la răspunsul scris; liniile de semnătură. Dispărute față de contract §8: `{{id_parcela}}` (modelul NU afișează
ID-ul intern — de decis dacă îl adăugăm, ex. lângă „Nr. convocare”, pentru corelare cu registrul și formularul public).

### 2.2 pv_a.docx (Model 2) - per detinator, 51 chei distincte (Final_v2: fara bifa_foto_da / bifa_foto_nu / foto_nr)

Generator: src/redari/pv.js, CHEI_PV_A comparat cu sablonul real in pv.test.js.
BIFA_DA = "\u2612" (caseta bifata), BIFA_NU = "\u2610" (caseta goala).
Sablonul are placeholder-e pentru bife; nu are caractere proprii de bifa.

| Placeholder / grup | Sursa finala |
| --- | --- |
| contract_nr, contract_data, proiect_denumire | red_proiecte.contract_nr, contract_data (RO), denumire |
| nr_pv, data_pv, locul | red_procese_verbale; numar atomic fn_red_pv_creeaza, data RO |
| uat | red_uat.nume |
| sat, tarla, nr_cadastral, poz_hg, tronson, categoria_folosinta | red_parcele, aceleasi coloane |
| suprafata | red_parcele.suprafata_temporara_mp, formatNumarRo |
| nume | red_detinatori.nume |
| calitate_cota | eticheta calitate + ", cota " + cota daca exista |
| act_identitate, act_doveditor | goale, completate de mana; actele NU se stocheaza |
| bifa_sol_fertil/nivelare/arat/discuit/insamantare/gard/drum | red_procese_verbale.lucrari jsonb, true explicit |
| bifa_altele, lucrari_altele | lucrari.altele text nevid / text integral |
| bifa_da, bifa_da_cu_obiectii | obiectii_redare false / true |
| categoria_initiala | red_parcele.categoria_folosinta |
| bifa_st_nivelat/strat_vegetal/insamantat/gard_drum | red_procese_verbale.stare_teren jsonb, true explicit |
| bifa_st_alta, stare_teren_alta | stare_teren.alta text nevid / text integral |
| bifa_plan_da, bifa_plan_nu | plan_situatie true / false; NULL = ambele goale |
| bifa_constatare_sediu, bifa_constatare_teren | constatare_mod = sediu / teren |
| verificare_data, verificare_de | parcela.verificare_data (RO), verificare_de_gazpet + " (TGZ: verificare_de_tgz)" |
| bifa_fara_obiectii, bifa_cu_obiectii, obiectii_text | obiectii_redare false / true; text cu newline pastrat |
| termen_remediere, reverificare_la, alte_observatii | red_procese_verbale, date RO si text integral |
| semnatar_detinator | nume + calitate |
| semnatar_gazpet, semnatar_tgz | proiect.reprezentant_gazpet/tgz_nume + functie |

Lucrarile din deviz sunt NUMAI propuneri la prima deschidere (lucrari IS NULL).
fertil/decopert -> sol_fertil; nivel -> nivelare; arat -> arat; discu -> discuit;
insamant/semanat -> insamantare; gard -> gard; drum -> drum. Normalizare fara diacritice.
Operatorul confirma prin salvarea PV; generatorul foloseste exclusiv lucrari persistate.
PV atesta constatarea, nu executia presupusa din deviz. Categoria initiala ramane cea din baza TGZ.
PV A are trei semnatari (detinator, TGZ, Gazpet - semnatura Antreprenorului repusa in Final_v2); reprezentantul UAT este pe PV B.
Final_v2: fara fotografii; red_procese_verbale.foto_nr ramane in BD si in formularul PV, dar nu mai apare in document.

### 2.3 pv_b.docx (Model 3) - per parcela, 72 chei distincte (pv_a_referinta adaugat 02.11; Final_v2 scoate bifa_plan_da/nu, bifa_foto_da/nu, foto_nr, jurnal_santier)

Generator: src/redari/pv.js; CHEI_PV_B verificat pe sablonul real in pv.test.js.
PV B are detinator_id NULL. Motivul explicit este obligatoriu; nu se deduce din absenta raspunsului.

| Placeholder / grup | Sursa finala |
| --- | --- |
| antet, parcela, lucrari, stare teren | Aceiasi constructori de campuri ca PV A (fara plan de situatie / topo, fara fotografii - Final_v2) |
| nume | Numai detinatorii activi FARA PV A semnat activ, ordonati dupa id, uniti cu "; "; zero detinatori = neidentificat |
| bifa_neidentificat, bifa_fara_adresa | Calitate neidentificat (inclusiv zero detinatori), respectiv adresa_cunoscuta false; lipsa contactului = false |
| conv_data_expediere, conv_nr_tracking, conv_data_confirmare, conv_retur | Ultima convocare activa posta, non-reluare, dupa created_at si id; nu se concateneaza |
| bifa_conv_primita, bifa_conv_returnata | Confirmare, respectiv retur nevid pe aceeasi convocare |
| afisare_data_start/end, afisare_pv_nr, zi1/2/3 | red_uat.afisare_*, sesiune_zi1/2/3 |
| raspuns_data/canal, raspuns_alt_text | ultimulRaspuns din stare.js: data, seq, created_at; text obiectii sau optiune |
| bifa_fara_raspuns, bifa_raspuns_fara_obiectii, bifa_alt_raspuns | Absenta raspunsului / optiune nu_particip_fara_obiectii / alta optiune |
| bifa_neprezentat | motiv_pv_b = neprezentat |
| reluare_data, reluare_adresa_tgz_nr, reluare_nr_tracking | Ultima convocare activa reluare=true: data_expediere, adresa_tgz_nr, nr_tracking |
| bifa_reluare_nu_e_cazul | Nicio reluare activa |
| bifa_reluare_fara_raspuns, bifa_reluare_raspuns, reluare_raspuns_text | Raspunsul aceluiasi detinator, data >= data expedierii reluarii; fara data expedierii nu se atribuie un raspuns |
| bifa_sit_declaratie/neprezentat/neidentificat/refuz | Exclusiv motiv_pv_b explicit, una singura bifata |
| verificare_data, verificare_de_gazpet/tgz | red_parcele, obligatoriu data + minimum un verificator nevid |
| reprezentant_uat_nume, semnatar_uat | red_uat.reprezentant_uat_nume, obligatoriu |
| semnatar_gazpet/tgz | red_proiecte.reprezentant_*_nume + functie |
| semnatar_apm | red_proiecte.apm_nume |

`pv_a_referinta`: referintaPvA din src/redari/pv.js, din PV-urile A semnate active ale aceleiasi parcele,
recitite paginat la generare: numar + data_pv pentru fiecare, fara nume de persoane; gol daca nu exista.
Textul precizeaza ca PV B priveste numai detinatorii fara PV A semnat. Daca verificare_data este strict
ulterioara celei mai recente semnat_primit_data (rezerva: data_pv), adauga "Verificare noua a terenului"
cu data verificarii. CHEI_PV_B = 72 (Final_v2); paragraful pv_a_referinta ramane sub „Nume:”.
Final_v2: fara jurnal de santier, topo / plan de situatie si fotografii; red_parcele.jurnal_santier_ref si plan_situatie raman in BD, nu in PV B.
Convocarile, raspunsurile si bifele aferente folosesc numai detinatorii nesemnatari inclusi in PV B.
Generarea reciteste toate sursele, blocheaza modificarile nesalvate si cazul in care TOTI detinatorii
activi au PV A semnat. Un alt coproprietar cu PV A semnat nu blocheaza PV B; modalul afiseaza nota.
Constatarea nu poate contrazice PV A; schimbarea terenului cere verificare noua datata, nu o presupunere.
Reprezentantul UAT semneaza numai PV B. Prezenta/refuzul nu se inventeaza din starea agregata.

### 2.4 `adresa_uat.docx` (Model 4) — per UAT, 40 placeholder-e (adresa + Anexa 2 + Anexa 3; Final_v2 fără antet)

| placeholder | sursă în BD | oblig. | observații |
|---|---|---|---|
| ~~antet (3)~~ | — | — | Final_v2: modelul nu mai are antetul firmei → `contract_nr`, `contract_data`, `proiect_denumire` nu mai sunt în șablon (generatorul le calculează și le cere în continuare) |
| `{{uat}}` ×5, `{{judet}}` | red_uat.nume, .judet | da | |
| `{{nr_document}}`, `{{data}}` | `fn_red_numar_document('AU', NULL, NULL)` → `AU-0001`; `red_uat.adresa_nr, adresa_data` | da | azi, Europe/Bucharest; regenerarea păstrează numărul |
| `{{imputernicire_nr}}`, `{{imputernicire_data}}` | red_proiecte | da | |
| `{{zi1..3}}`, `{{program1..3}}`, `{{sate_zi1..3}}` | red_uat.sesiune_zi1..3, program_zi1..3, sate_zi1..3 | da / nu | cel puțin o zi cu program |
| `{{afisare_data_start}}` ×3, `{{afisare_data_end}}`, `{{afisare_pv_nr}}` | red_uat.afisare_* | da | |
| `{{termen_confirmare}}` | red_uat.termen_confirmare | da | dată RO; se completează explicit |
| `{{contact_nume}}` ×2, `{{contact_telefon}}` ×3, `{{contact_email}}` ×3 | red_proiecte | da | |
| `{{reprezentant_tgz}}` ×2, `{{reprezentant_tgz_telefon}}` ×2 | red_proiecte.reprezentant_tgz_nume, reprezentant_tgz_telefon | nu | |
| `{{reprezentant_gazpet}}` | calcul: reprezentant_gazpet_nume + _functie | da | semnătura adresei |
| `{{zile_sesiune_text}}` ×2, `{{program_text}}` | calcul din sesiune_zi1..3 / program_zi1..3 („10, 11 și 12 noiembrie 2026”; „09:00 – 16:00 (ziua 2 până la 19:00)”) | da | |
| `{{rand.nr}}`, `{{rand.sat}}`, `{{rand.tarla}}`, `{{rand.nr_cadastral}}`, `{{rand.poz_hg}}`, `{{rand.tronson}}` | red_parcele (toate parcelele active ale UAT-ului, fără date personale) | da | rând-șablon → `repetaRand` (§1) |
| `{{reprezentant_uat_nume}}`, `{{reprezentant_uat_functie}}` | red_uat | nu la generarea adresei | Primăria nominalizează ulterior; coloana telefon există din 20261127a |
| `{{reprezentant_gazpet_nume}}` | red_proiecte.reprezentant_gazpet_nume | da | conform D2/felia 2 |
| `{{afisare_ora}}` | red_uat.afisare_ora | nu | HH:MM, deja format RO |
| `{{numar_parcele}}` | calcul: COUNT parcele active ale UAT-ului | da | |
| `{{semnatar_uat}}`, `{{semnatar_gazpet}}` | calcul | nu | |

De mână (intenționat): „Dezafișat la data de ___, ora ___. Semnătura: ___” și liniile de semnătură.

**D1, DECIS și aplicat 02.11.2026:** `link_afisare` scos prin `scripts/redari_sablon_adresa_fara_link.mjs` (rulat o dată).
Pe afișare rămân telefonul și e-mailul. Nu există pagină publică UAT. Restul XML-ului șablonului este păstrat.

Generarea folosește `verificaDateAdresaUat`, separat de `lipsuriUat` (convocator). Împuternicirea este obligatorie;
parcelele pot lipsi. Se citesc numai parcelele active, paginate keyset pe `id_parcela`, în ordinea acelui ID.
Fișierul se salvează imutabil în `redari/{proiectCod}/{uat3}/adresa/{AU-nnnn}_v{n}.docx`, versiunea maximă include orfanele.
Upload-ul precedă UPDATE-ul UAT cu CAS pe versiunea citită și RETURNING explicit. Conflictul sau eroarea de rețea lasă fișierul
în bucket și cer reîncărcare/reconciliere; nu se șterge automat. Descărcarea folosește versiunea maximă și URL semnat 10 minute.
**Numerele rezervate prin RPC se consumă chiar dacă generarea/upload-ul/salvarea ulterioară eșuează** (ca la convocator).
Regenerarea cere confirmare și păstrează `adresa_nr`, crescând numai versiunea fișierului. Modificările nesalvate blochează generarea.

### 2.5 `pv_c.docx` (Model 5) - per tronson, 23 placeholder-e

| Placeholder | Sursa finala |
|---|---|
| contract_nr, contract_data, proiect_denumire | red_proiecte; contract obligatoriu |
| nr_pv, data_pv, tronson | red_procese_verbale tip C; PVC-T{n}-nnnn |
| km_de_la, km_pana_la | MIN(km_de_la), MAX(km_pana_la) din parcelele active ale tronsonului/proiectului; lipsa = gol |
| uat_uri, numar_parcele | Nume UAT distincte ordonate, numarul parcelelor active din red_v_tronson |
| pva_sesiune_nr/mp | tip_pv A si cel putin un PV A activ semnat cu semnat_la_sesiune=true pe parcela |
| pva_corespondenta_nr/mp | tip_pv A, fara PV A activ semnat cu semnat_la_sesiune=true |
| pvb_nr/mp | tip_pv B din red_v_tronson |
| obiectii_deschise_nr/mp | obiectii_deschise=true; nu blocheaza receptia |
| total_nr/mp | Toate parcelele active; mp=sum(suprafata_temporara_mp), null=0; formatNumarRo |
| semnatar_tgz, semnatar_gazpet, semnatar_apm | Reprezentantii proiectului (nume + functie), respectiv apm_nume |

O parcela cu mai multi coproprietari se numara o singura data. Daca semnaturile sunt mixte,
prezenta oricarui PV A semnat la sesiune clasifica parcela la sesiune. Data trimiterii nu decide categoria.
Nu se includ nume de detinatori sau alte date personale. Modelul contine numai agregate;
nu exista tabel de parcele/articole in acest DOCX. Locul si alte_observatii sunt campuri ale PV-ului,
dar nu au placeholder in sablonul actual. Generarea reciteste toate sursele si le verifica dupa upload.
### 2.6 cerere_imputernicire.docx (anexa la scrisoarea TGZ) - 12 placeholder-e

DRAFT Juridic, de validat de avocat. Nu se trimite automat. Adminul descarca DOCX-ul din Setari proiect pentru verificare.
Text integral: `TEXT_CERERE_IMPUTERNICIRE.md`. Regenerare: `node scripts/redari_sablon_cerere_imputernicire.mjs` (jszip existent in dependintele proiectului).

| Placeholder | Sursa |
|---|---|
| `nr_document` | Numar introdus de admin, optional; gol = `___` |
| `data` | Azi in Europe/Bucharest, formatDataRo |
| `beneficiar` | red_proiecte.beneficiar |
| `reprezentant_tgz` | red_proiecte.reprezentant_tgz_nume |
| `contract_nr` | red_proiecte.contract_nr |
| `contract_data` | red_proiecte.contract_data, formatDataRo |
| `proiect_denumire` | red_proiecte.denumire |
| `antreprenor` | ANTREPRENOR = GAZPET INSTAL S.R.L.; denumirea liderului se modifica in cod daca Asocierea este alta |
| `uat_lista` | red_uat.nume, sortare localeCompare('ro'), separate prin virgula |
| `contact_email` | red_proiecte.contact_email |
| `reprezentant_gazpet` | red_proiecte.reprezentant_gazpet_nume |
| `functie` | red_proiecte.reprezentant_gazpet_functie |

## 3. Câmpuri FĂRĂ sursă în contract — de adăugat în schemă / de decis

| câmp (placeholder) | șablon | propunere | de decis |
|---|---|---|---|
| `sate_zi1..3` | convocator, adresa_uat | `red_uat.sate_zi1, sate_zi2, sate_zi3 text` | — |
| `reprezentant_tgz_telefon` | convocator, adresa_uat | `red_proiecte.reprezentant_tgz_telefon text` | — |
| `reprezentant_uat_telefon` | (nominalizare v5, Model 4 pct. 3) | `red_uat.reprezentant_uat_telefon text` (20261127a) | — |
| `text_gdpr` cu UAT + link | convocator | `{uat}` înlocuit de cod; `red_proiecte.link_informare_gdpr` (20261128a) | **D4 DECIS** pentru `textGdprPentruUat` (gol → propoziția „Informarea completă” se omite; HTTPS → link configurat); **pe fața convocatorului poștal** linkul nu se tipărește (03.11 seara, §1 excepția (8), `textGdprFataConvocator`) |
| `act_identitate`, `act_doveditor` | pv_a | DECIS 02.11: actul de identitate NU se stocheaza; `red_procese_verbale.identitate_verificata boolean`; actul doveditor = `red_detinatori.act_doveditor_cunoscut boolean` DA/NU/NULL, fara continutul actului | 20261129a |
| lucrari, lucrari_altele | pv_a, pv_b | DECIS 02.11: `red_procese_verbale.lucrari jsonb`, obiect confirmat de operator; propunerea din articol_deviz se face ulterior in UI | 20261129a |
| stare_teren | pv_a, pv_b | DECIS 02.11: `red_procese_verbale.stare_teren jsonb`, obiect cu 4 bife si alta text; structura interna definita ulterior in UI | 20261129a |
| plan_situatie, foto_nr | pv_a (doar plan), — | DECIS 02.11: pe PV, boolean si integer >= 0; NULL = lipsa informatiei. Final_v2: fotografiile nu mai apar in niciun PV, planul de situatie doar in PV A | 20261129a |
| constatare_mod | pv_a | DECIS 02.11: coloana explicita pe PV, sediu/teren; nu derivata din locul | 20261129a |
| verificare_data, verificare_de_gazpet, verificare_de_tgz, jurnal_santier | pv_a, pv_b (jurnal: niciunul din Final_v2) | DECIS 02.11: pe parcela, verificarea comisiei inainte de sesiune; `jurnal_santier_ref text` liber (Final_v2: nu mai e tiparit in PV B) | 20261129a; legatura Executie ulterior |
| reverificare_la | pv_a | DECIS 02.11: `red_procese_verbale.reverificare_la date` | 20261129a |
| alte_observatii | pv_a | DECIS 02.11: `red_procese_verbale.alte_observatii text` | 20261129a |
| reluare, adresa_tgz_nr | pv_b | DECIS 02.11: `red_convocari.reluare boolean NOT NULL DEFAULT false`, `adresa_tgz_nr text`; unica reluare activa per detinator; anulat/soft-delete elibereaza cheia | 20261129a |
| `semnatar_apm` | pv_b, pv_c | `red_proiecte.apm_nume text` (20261127a), gol = de mână | — |
| `nr_document` pentru adresa UAT | adresa_uat | **DECIS 02.11: serie proprie `AU-0001`** — `fn_red_numar_document('AU')` + `red_uat.adresa_nr` (unic), `adresa_data` (20261127a) | — |
| `termen_confirmare` | adresa_uat | `red_uat.termen_confirmare date` (20261127a), introdus de operator, CHECK < zi1 | N pentru o eventuală propunere automată |
| `afisare_ora` | adresa_uat | `red_uat.afisare_ora text` HH:MM (20261127a) | — |
| `link_afisare` | adresa_uat | **DECIS / SCOS 02.11 (Răzvan)** — pe afișare rămân telefonul și e-mailul; nu există pagină publică pe UAT | implementat în felia 2 |
| `reprezentant_gazpet_nume` la PV afișare | adresa_uat | cine afișează fizic → `red_uat.afisare_reprezentant_gazpet` (20261127a) | — |
| `prezent` (bifa „nu s-a prezentat”; Model 6 col. AA) | pv_b, registru | `red_raspunsuri` cu `canal='sesiune'` ⇒ prezent; sau `red_detinatori.prezent_la_sesiune date` | — |
| motiv_pv_b | pv_b | DECIS 02.11: declaratie/neprezentat/neidentificat/refuz, numai tip B; formularul public ramane neschimbat | 20261129a |
| pva_sesiune vs pva_corespondenta | pv_c | DECIS 02.11: `red_procese_verbale.semnat_la_sesiune boolean` explicit; NULL necunoscut; nu dedus din data trimiterii | 20261129a |
| `km_de_la`, `km_pana_la` pe tronson | pv_c | MIN/MAX din red_parcele sau tabel `red_tronsoane` | — |
| `id_parcela` în documente | toate | modelele nu îl afișează; de decis dacă îl adăugăm | — |
| responsabil_gazpet | registru Model 6 AL | DECIS 02.11: `red_uat.responsabil_id uuid REFERENCES profiles(id)` | 20261129a |
| „constatare pe teren cerută? (data)” (Model 6 col. AB) | registru | v5 spune „la data stabilită de comisie” → data vine din comisie, nu de la deținător: `red_raspunsuri.constatare_teren_data` (setată de operator) | — |
| conținut fix de parametrizat la alt proiect | toate | A.P.M. Mehedinți, Acordul de mediu, „Lider al Asocierii …”, Prunișor–Jupa în corp | nu acum (Lot 1) |

## 4. Ieșirea `node scripts/redari_sabloane_verifica.mjs` (03.11.2026, Final_v2 + A4 + convocator doar cu QR)

```text
# Verificare șabloane Redări — 6 fișiere din public/redari/sabloane (2026-11-03)

## adresa_uat.docx — OK
- părți citite: word/document.xml; paragrafe cu text: 59
- placeholder-e distincte: 40 (apariții: 54); rupte între run-uri: 0
- `{{afisare_data_end}}` `{{afisare_data_start}}`×3 `{{afisare_ora}}` `{{afisare_pv_nr}}` `{{contact_email}}`×3 `{{contact_nume}}`×2 `{{contact_telefon}}`×3 `{{data}}` `{{imputernicire_data}}` `{{imputernicire_nr}}` `{{judet}}` `{{nr_document}}` `{{numar_parcele}}` `{{program1}}` `{{program2}}` `{{program3}}` `{{program_text}}` `{{rand.nr}}` `{{rand.nr_cadastral}}` `{{rand.poz_hg}}` `{{rand.sat}}` `{{rand.tarla}}` `{{rand.tronson}}` `{{reprezentant_gazpet}}` `{{reprezentant_gazpet_nume}}` `{{reprezentant_tgz}}`×2 `{{reprezentant_tgz_telefon}}`×2 `{{reprezentant_uat_functie}}` `{{reprezentant_uat_nume}}` `{{sate_zi1}}` `{{sate_zi2}}` `{{sate_zi3}}` `{{semnatar_gazpet}}` `{{semnatar_uat}}` `{{termen_confirmare}}` `{{uat}}`×5 `{{zi1}}` `{{zi2}}` `{{zi3}}` `{{zile_sesiune_text}}`×2
- pagină: 11906×16838 twips (A4); margini sus/jos/stânga/dreapta (cm): 1.80/1.80/2.00/2.00; corp Normal: 10.5 pt
- relații externe (.rels TargetMode=External): niciuna
- rând-șablon (repetat de `repetaRand` înaintea câmpurilor simple): `{{rand.nr}}` `{{rand.nr_cadastral}}` `{{rand.poz_hg}}` `{{rand.sat}}` `{{rand.tarla}}` `{{rand.tronson}}`
- resturi intenționate: 4× dezafișarea se consemnează de mână, la final (PV afișare); 2× linie de semnătură olografă

## cerere_imputernicire.docx — OK
- părți citite: word/document.xml; paragrafe cu text: 16
- placeholder-e distincte: 12 (apariții: 15); rupte între run-uri: 0
- `{{antreprenor}}`×2 `{{beneficiar}}` `{{contact_email}}` `{{contract_data}}` `{{contract_nr}}` `{{data}}` `{{functie}}`×2 `{{nr_document}}` `{{proiect_denumire}}` `{{reprezentant_gazpet}}`×2 `{{reprezentant_tgz}}` `{{uat_lista}}`
- pagină: 11906×16838 twips (A4); margini sus/jos/stânga/dreapta (cm): 2.00/2.00/2.00/2.00; corp Normal: 12 pt
- relații externe (.rels TargetMode=External): niciuna

## convocator.docx — OK
- părți citite: word/document.xml; paragrafe cu text: 55
- placeholder-e distincte: 35 (apariții: 37); rupte între run-uri: 0
- `{{adresa}}` `{{calitate}}` `{{contact_email}}` `{{contact_nume}}` `{{contact_telefon}}`×2 `{{contract_data}}` `{{contract_nr}}` `{{data}}` `{{imputernicire_data}}` `{{imputernicire_nr}}` `{{nr_cadastral}}` `{{nr_document}}` `{{nume}}` `{{poz_hg}}` `{{program1}}` `{{program2}}` `{{program3}}` `{{proiect_denumire}}` `{{qr}}` `{{reprezentant_tgz}}` `{{reprezentant_tgz_telefon}}` `{{sat}}` `{{sate_zi1}}` `{{sate_zi2}}` `{{sate_zi3}}` `{{semnatar_gazpet}}` `{{semnatar_tgz}}` `{{suprafata}}` `{{tarla}}` `{{text_gdpr}}` `{{tronson}}` `{{uat}}`×2 `{{zi1}}` `{{zi2}}` `{{zi3}}`
- pagină: 11906×16838 twips (A4); margini sus/jos/stânga/dreapta (cm): 1.27/1.27/1.50/1.50; corp Normal: 9.5 pt
- {{qr}} singur în paragraf: da
- relații externe (.rels TargetMode=External): niciuna
- resturi intenționate: 3× opțiune bifată de mână de destinatar (convocator); 2× linie de semnătură olografă

## pv_a.docx — OK
- părți citite: word/document.xml; paragrafe cu text: 46
- placeholder-e distincte: 51 (apariții: 54); rupte între run-uri: 0
- `{{act_doveditor}}` `{{act_identitate}}` `{{alte_observatii}}` `{{bifa_altele}}` `{{bifa_arat}}` `{{bifa_constatare_sediu}}` `{{bifa_constatare_teren}}` `{{bifa_cu_obiectii}}` `{{bifa_da}}` `{{bifa_da_cu_obiectii}}` `{{bifa_discuit}}` `{{bifa_drum}}` `{{bifa_fara_obiectii}}` `{{bifa_gard}}` `{{bifa_insamantare}}` `{{bifa_nivelare}}` `{{bifa_plan_da}}` `{{bifa_plan_nu}}` `{{bifa_sol_fertil}}` `{{bifa_st_alta}}` `{{bifa_st_gard_drum}}` `{{bifa_st_insamantat}}` `{{bifa_st_nivelat}}` `{{bifa_st_strat_vegetal}}` `{{calitate_cota}}` `{{categoria_folosinta}}` `{{categoria_initiala}}` `{{contract_data}}`×2 `{{contract_nr}}`×2 `{{data_pv}}` `{{locul}}` `{{lucrari_altele}}` `{{nr_cadastral}}` `{{nr_pv}}` `{{nume}}` `{{obiectii_text}}` `{{poz_hg}}` `{{proiect_denumire}}` `{{reverificare_la}}` `{{sat}}` `{{semnatar_detinator}}` `{{semnatar_gazpet}}` `{{semnatar_tgz}}` `{{stare_teren_alta}}` `{{suprafata}}` `{{tarla}}` `{{termen_remediere}}` `{{tronson}}`×2 `{{uat}}` `{{verificare_data}}` `{{verificare_de}}`
- pagină: 11906×16838 twips (A4); margini sus/jos/stânga/dreapta (cm): 1.80/1.80/2.00/2.00; corp Normal: 10.5 pt
- relații externe (.rels TargetMode=External): niciuna
- resturi intenționate: 1× antet de coloană (PV A), nu câmp; 3× linie de semnătură olografă

## pv_b.docx — OK
- părți citite: word/document.xml; paragrafe cu text: 63
- placeholder-e distincte: 72 (apariții: 74); rupte între run-uri: 0
- `{{afisare_data_end}}` `{{afisare_data_start}}`×2 `{{afisare_pv_nr}}` `{{bifa_alt_raspuns}}` `{{bifa_altele}}` `{{bifa_arat}}` `{{bifa_conv_primita}}` `{{bifa_conv_returnata}}` `{{bifa_discuit}}` `{{bifa_drum}}` `{{bifa_fara_adresa}}` `{{bifa_fara_raspuns}}` `{{bifa_gard}}` `{{bifa_insamantare}}` `{{bifa_neidentificat}}` `{{bifa_neprezentat}}` `{{bifa_nivelare}}` `{{bifa_raspuns_fara_obiectii}}` `{{bifa_reluare_fara_raspuns}}` `{{bifa_reluare_nu_e_cazul}}` `{{bifa_reluare_raspuns}}` `{{bifa_sit_declaratie}}` `{{bifa_sit_neidentificat}}` `{{bifa_sit_neprezentat}}` `{{bifa_sit_refuz}}` `{{bifa_sol_fertil}}` `{{bifa_st_alta}}` `{{bifa_st_gard_drum}}` `{{bifa_st_insamantat}}` `{{bifa_st_nivelat}}` `{{bifa_st_strat_vegetal}}` `{{categoria_folosinta}}` `{{categoria_initiala}}` `{{contract_data}}` `{{contract_nr}}` `{{conv_data_confirmare}}` `{{conv_data_expediere}}` `{{conv_nr_tracking}}` `{{conv_retur}}` `{{data_pv}}` `{{locul}}` `{{lucrari_altele}}` `{{nr_cadastral}}` `{{nr_pv}}` `{{nume}}` `{{poz_hg}}` `{{proiect_denumire}}` `{{pv_a_referinta}}` `{{raspuns_alt_text}}` `{{raspuns_canal}}` `{{raspuns_data}}` `{{reluare_adresa_tgz_nr}}` `{{reluare_data}}` `{{reluare_nr_tracking}}` `{{reluare_raspuns_text}}` `{{reprezentant_uat_nume}}` `{{sat}}` `{{semnatar_apm}}` `{{semnatar_gazpet}}` `{{semnatar_tgz}}` `{{semnatar_uat}}` `{{stare_teren_alta}}` `{{suprafata}}` `{{tarla}}` `{{tronson}}` `{{uat}}`×2 `{{verificare_data}}` `{{verificare_de_gazpet}}` `{{verificare_de_tgz}}` `{{zi1}}` `{{zi2}}` `{{zi3}}`
- pagină: 11906×16838 twips (A4); margini sus/jos/stânga/dreapta (cm): 1.80/1.80/2.00/2.00; corp Normal: 10.5 pt
- relații externe (.rels TargetMode=External): niciuna
- resturi intenționate: 4× linie de semnătură olografă

## pv_c.docx — OK
- părți citite: word/document.xml; paragrafe cu text: 40
- placeholder-e distincte: 23 (apariții: 23); rupte între run-uri: 0
- `{{contract_data}}` `{{contract_nr}}` `{{data_pv}}` `{{km_de_la}}` `{{km_pana_la}}` `{{nr_pv}}` `{{numar_parcele}}` `{{obiectii_deschise_mp}}` `{{obiectii_deschise_nr}}` `{{proiect_denumire}}` `{{pva_corespondenta_mp}}` `{{pva_corespondenta_nr}}` `{{pva_sesiune_mp}}` `{{pva_sesiune_nr}}` `{{pvb_mp}}` `{{pvb_nr}}` `{{semnatar_apm}}` `{{semnatar_gazpet}}` `{{semnatar_tgz}}` `{{total_mp}}` `{{total_nr}}` `{{tronson}}` `{{uat_uri}}`
- pagină: 11906×16838 twips (A4); margini sus/jos/stânga/dreapta (cm): 1.80/1.80/2.00/2.00; corp Normal: 10.5 pt
- relații externe (.rels TargetMode=External): niciuna
- resturi intenționate: 3× linie de semnătură olografă

## Toate placeholder-ele (140)

| placeholder | șabloane |
|---|---|
| `{{act_doveditor}}` | pv_a |
| `{{act_identitate}}` | pv_a |
| `{{adresa}}` | convocator |
| `{{afisare_data_end}}` | adresa_uat, pv_b |
| `{{afisare_data_start}}` | adresa_uat, pv_b |
| `{{afisare_ora}}` | adresa_uat |
| `{{afisare_pv_nr}}` | adresa_uat, pv_b |
| `{{alte_observatii}}` | pv_a |
| `{{antreprenor}}` | cerere_imputernicire |
| `{{beneficiar}}` | cerere_imputernicire |
| `{{bifa_alt_raspuns}}` | pv_b |
| `{{bifa_altele}}` | pv_a, pv_b |
| `{{bifa_arat}}` | pv_a, pv_b |
| `{{bifa_constatare_sediu}}` | pv_a |
| `{{bifa_constatare_teren}}` | pv_a |
| `{{bifa_conv_primita}}` | pv_b |
| `{{bifa_conv_returnata}}` | pv_b |
| `{{bifa_cu_obiectii}}` | pv_a |
| `{{bifa_da}}` | pv_a |
| `{{bifa_da_cu_obiectii}}` | pv_a |
| `{{bifa_discuit}}` | pv_a, pv_b |
| `{{bifa_drum}}` | pv_a, pv_b |
| `{{bifa_fara_adresa}}` | pv_b |
| `{{bifa_fara_obiectii}}` | pv_a |
| `{{bifa_fara_raspuns}}` | pv_b |
| `{{bifa_gard}}` | pv_a, pv_b |
| `{{bifa_insamantare}}` | pv_a, pv_b |
| `{{bifa_neidentificat}}` | pv_b |
| `{{bifa_neprezentat}}` | pv_b |
| `{{bifa_nivelare}}` | pv_a, pv_b |
| `{{bifa_plan_da}}` | pv_a |
| `{{bifa_plan_nu}}` | pv_a |
| `{{bifa_raspuns_fara_obiectii}}` | pv_b |
| `{{bifa_reluare_fara_raspuns}}` | pv_b |
| `{{bifa_reluare_nu_e_cazul}}` | pv_b |
| `{{bifa_reluare_raspuns}}` | pv_b |
| `{{bifa_sit_declaratie}}` | pv_b |
| `{{bifa_sit_neidentificat}}` | pv_b |
| `{{bifa_sit_neprezentat}}` | pv_b |
| `{{bifa_sit_refuz}}` | pv_b |
| `{{bifa_sol_fertil}}` | pv_a, pv_b |
| `{{bifa_st_alta}}` | pv_a, pv_b |
| `{{bifa_st_gard_drum}}` | pv_a, pv_b |
| `{{bifa_st_insamantat}}` | pv_a, pv_b |
| `{{bifa_st_nivelat}}` | pv_a, pv_b |
| `{{bifa_st_strat_vegetal}}` | pv_a, pv_b |
| `{{calitate}}` | convocator |
| `{{calitate_cota}}` | pv_a |
| `{{categoria_folosinta}}` | pv_a, pv_b |
| `{{categoria_initiala}}` | pv_a, pv_b |
| `{{contact_email}}` | adresa_uat, cerere_imputernicire, convocator |
| `{{contact_nume}}` | adresa_uat, convocator |
| `{{contact_telefon}}` | adresa_uat, convocator |
| `{{contract_data}}` | cerere_imputernicire, convocator, pv_a, pv_b, pv_c |
| `{{contract_nr}}` | cerere_imputernicire, convocator, pv_a, pv_b, pv_c |
| `{{conv_data_confirmare}}` | pv_b |
| `{{conv_data_expediere}}` | pv_b |
| `{{conv_nr_tracking}}` | pv_b |
| `{{conv_retur}}` | pv_b |
| `{{data}}` | adresa_uat, cerere_imputernicire, convocator |
| `{{data_pv}}` | pv_a, pv_b, pv_c |
| `{{functie}}` | cerere_imputernicire |
| `{{imputernicire_data}}` | adresa_uat, convocator |
| `{{imputernicire_nr}}` | adresa_uat, convocator |
| `{{judet}}` | adresa_uat |
| `{{km_de_la}}` | pv_c |
| `{{km_pana_la}}` | pv_c |
| `{{locul}}` | pv_a, pv_b |
| `{{lucrari_altele}}` | pv_a, pv_b |
| `{{nr_cadastral}}` | convocator, pv_a, pv_b |
| `{{nr_document}}` | adresa_uat, cerere_imputernicire, convocator |
| `{{nr_pv}}` | pv_a, pv_b, pv_c |
| `{{numar_parcele}}` | adresa_uat, pv_c |
| `{{nume}}` | convocator, pv_a, pv_b |
| `{{obiectii_deschise_mp}}` | pv_c |
| `{{obiectii_deschise_nr}}` | pv_c |
| `{{obiectii_text}}` | pv_a |
| `{{poz_hg}}` | convocator, pv_a, pv_b |
| `{{program_text}}` | adresa_uat |
| `{{program1}}` | adresa_uat, convocator |
| `{{program2}}` | adresa_uat, convocator |
| `{{program3}}` | adresa_uat, convocator |
| `{{proiect_denumire}}` | cerere_imputernicire, convocator, pv_a, pv_b, pv_c |
| `{{pv_a_referinta}}` | pv_b |
| `{{pva_corespondenta_mp}}` | pv_c |
| `{{pva_corespondenta_nr}}` | pv_c |
| `{{pva_sesiune_mp}}` | pv_c |
| `{{pva_sesiune_nr}}` | pv_c |
| `{{pvb_mp}}` | pv_c |
| `{{pvb_nr}}` | pv_c |
| `{{qr}}` | convocator |
| `{{rand.nr}}` | adresa_uat |
| `{{rand.nr_cadastral}}` | adresa_uat |
| `{{rand.poz_hg}}` | adresa_uat |
| `{{rand.sat}}` | adresa_uat |
| `{{rand.tarla}}` | adresa_uat |
| `{{rand.tronson}}` | adresa_uat |
| `{{raspuns_alt_text}}` | pv_b |
| `{{raspuns_canal}}` | pv_b |
| `{{raspuns_data}}` | pv_b |
| `{{reluare_adresa_tgz_nr}}` | pv_b |
| `{{reluare_data}}` | pv_b |
| `{{reluare_nr_tracking}}` | pv_b |
| `{{reluare_raspuns_text}}` | pv_b |
| `{{reprezentant_gazpet}}` | adresa_uat, cerere_imputernicire |
| `{{reprezentant_gazpet_nume}}` | adresa_uat |
| `{{reprezentant_tgz}}` | adresa_uat, cerere_imputernicire, convocator |
| `{{reprezentant_tgz_telefon}}` | adresa_uat, convocator |
| `{{reprezentant_uat_functie}}` | adresa_uat |
| `{{reprezentant_uat_nume}}` | adresa_uat, pv_b |
| `{{reverificare_la}}` | pv_a |
| `{{sat}}` | convocator, pv_a, pv_b |
| `{{sate_zi1}}` | adresa_uat, convocator |
| `{{sate_zi2}}` | adresa_uat, convocator |
| `{{sate_zi3}}` | adresa_uat, convocator |
| `{{semnatar_apm}}` | pv_b, pv_c |
| `{{semnatar_detinator}}` | pv_a |
| `{{semnatar_gazpet}}` | adresa_uat, convocator, pv_a, pv_b, pv_c |
| `{{semnatar_tgz}}` | convocator, pv_a, pv_b, pv_c |
| `{{semnatar_uat}}` | adresa_uat, pv_b |
| `{{stare_teren_alta}}` | pv_a, pv_b |
| `{{suprafata}}` | convocator, pv_a, pv_b |
| `{{tarla}}` | convocator, pv_a, pv_b |
| `{{termen_confirmare}}` | adresa_uat |
| `{{termen_remediere}}` | pv_a |
| `{{text_gdpr}}` | convocator |
| `{{total_mp}}` | pv_c |
| `{{total_nr}}` | pv_c |
| `{{tronson}}` | convocator, pv_a, pv_b, pv_c |
| `{{uat}}` | adresa_uat, convocator, pv_a, pv_b |
| `{{uat_lista}}` | cerere_imputernicire |
| `{{uat_uri}}` | pv_c |
| `{{verificare_data}}` | pv_a, pv_b |
| `{{verificare_de}}` | pv_a |
| `{{verificare_de_gazpet}}` | pv_b |
| `{{verificare_de_tgz}}` | pv_b |
| `{{zi1}}` | adresa_uat, convocator, pv_b |
| `{{zi2}}` | adresa_uat, convocator, pv_b |
| `{{zi3}}` | adresa_uat, convocator, pv_b |
| `{{zile_sesiune_text}}` | adresa_uat |

Rezultat: toate șabloanele OK
```

## 5. Model_6 — registrul de urmărire (xlsx, v3): stări, reguli, coloane

Foi: `Registru` (rândurile 3..3000 cu validări + formula STARE), `Centralizator` (COUNTIFS pe UAT × stare), `Legendă`.
Un rând = o parcelă + o persoană (coproprietarii au rânduri separate cu același ID parcelă).

### 5.1 Legendă — regulile de folosire (transcriere)
- Un rând = o parcelă + o persoană. Parcelele cu mai mulți coproprietari au câte un rând pentru fiecare, cu același ID parcelă.
- Se completează doar celulele albe; coloana STARE se calculează singură din ce ai completat.
- Nu se șterg rânduri și nu se suprascriu date vechi: corecțiile se scriu în Observații, cu data. În ERP va exista istoric automat.
- Datele personale rămân în acest fișier și în ERP, cu acces restrâns. Exportul către Transgaz se face fără telefoane.

### 5.2 Stările, „în ordinea procesului” (Legendă, rândurile 8–19) — 12 stări

| # Legendă | stare (Excel) | explicația din Legendă | contract §3 (ordinea ierarhiei) |
|---|---|---|---|
| 1 | DE CONVOCAT | avem adresă, scrisoarea nu a plecat încă | 12 `DE_CONVOCAT` |
| 2 | FĂRĂ ADRESĂ – AFIȘARE | nu avem adresă: merge doar prin afișare la primărie; cerem adresa de la TGZ | 11 `FARA_ADRESA_AFISARE` |
| 3 | NEIDENTIFICAT – AFIȘARE | proprietar neidentificat în baza TGZ: afișare la primărie + PV B | 10 `NEIDENTIFICAT_AFISARE` |
| 4 | EXPEDIAT – AȘTEPTĂM AR | scrisoarea a plecat, confirmarea de primire nu s-a întors | 9 `EXPEDIAT_ASTEPTAM_AR` |
| 5 | CONVOCAT – FĂRĂ RĂSPUNS | a primit scrisoarea, nu a răspuns încă | 8 `CONVOCAT_FARA_RASPUNS` |
| 6 | CONVOCARE RETURNATĂ | scrisoarea s-a întors: cerem adresă nouă de la TGZ, rămâne afișarea | 7 `CONVOCARE_RETURNATA` |
| 7 | A RĂSPUNS – PARTICIPĂ | vine la sesiune: îl programăm | 6 `A_RASPUNS_PARTICIPA` |
| 8 | A RĂSPUNS – FĂRĂ OBIECȚII | nu vine, nu are obiecții: generăm PV A și îl trimitem spre semnare | 5 `A_RASPUNS_FARA_OBIECTII` |
| 9 | OBIECȚII – DE TRATAT | a formulat obiecții: le analizăm; cele de readucere se remediază, celelalte merg la TGZ | 4 `OBIECTII_DE_TRATAT` |
| 10 | PV TRIMIS SPRE SEMNARE | PV A plecat prin poștă / electronic, așteptăm semnătura | 3 `PV_TRIMIS_SPRE_SEMNARE` |
| 11 | PV B – CONSTATARE TEHNICĂ | încheiat cu TGZ + Primăria, fără deținător; nu ține locul semnăturii lui | 2 `PV_B_CONSTATARE` |
| 12 | PV A SEMNAT | închis: deținătorul a semnat | 1 `PV_A_SEMNAT` |

Aceleași 12 nume, aceeași ordine (Legenda = ordinea procesului, contractul = aceeași listă inversată, 1 = cel mai avansat).
Centralizatorul folosește exact aceste 12 etichete (rândurile 4–15) + „TOTAL parcele” + „% parcele închise (PV A sau B)”
= (PV A SEMNAT + PV B) / TOTAL — identic cu `red_v_centralizator_uat.procent_inchise`.

### 5.3 Formula STARE din Registru (col. AK) — ordinea evaluării și divergențele față de contract §3

Formula (prima adevărată câștigă): `AJ` (PV semnat primit) ≠ gol → PV A SEMNAT; `AC`="A" → PV A SEMNAT; `AC`="B" → PV B;
`AI` (trimis spre semnare) ≠ gol → PV TRIMIS SPRE SEMNARE; `X` = „nu particip – cu obiecții” → OBIECȚII; `X` = „nu particip
– fără obiecții” → A RĂSPUNS – FĂRĂ OBIECȚII; `X` = „particip” → A RĂSPUNS – PARTICIPĂ; `T` (retur) ≠ gol → CONVOCARE
RETURNATĂ; `S` (confirmare primire) ≠ gol → CONVOCAT – FĂRĂ RĂSPUNS; `Q` (data expediere) ≠ gol → EXPEDIAT; `J` (nume) =
„neidentificat” → NEIDENTIFICAT; `M` (adresă cunoscută) = „NU” → FĂRĂ ADRESĂ; altfel DE CONVOCAT.

Divergențe explicite:
1. **PV A SEMNAT la orice `Tip PV = A`** (Excel) vs contract „PV A activ cu stare `semnat`”. În Excel un PV A generat și
   trimis spre semnare (AC="A", AI completat, AJ gol) apare deja „PV A SEMNAT” (AC="A" e testat înaintea lui AI). Contractul
   e cel corect; de semnalat lui Răzvan ca bug în registrul Excel.
2. **„constatare pe teren”** (opțiune validă în col. X) nu e mapată în formulă → cade pe convocare (ex. CONVOCAT – FĂRĂ
   RĂSPUNS). Contractul o pune la `OBIECTII_DE_TRATAT` (4). Contractul e mai complet.
3. **Retur „primită”**: lista col. T include și „primită”, iar formula face `T<>""` → orice valoare, inclusiv „primită”, dă
   CONVOCARE RETURNATĂ. Contractul separă `data_confirmare_primire` de `retur`. Contractul e corect.
4. **Neidentificat după NUME** (`J="neidentificat"`) vs contract după `calitate='neidentificat'`. Echivalent dacă importul e
   consecvent (contract §7 pune `calitate`).
5. **O singură convocare pe rând** în Excel; contractul permite mai multe convocări active (RETURNATĂ doar dacă „nicio
   convocare activă confirmată ulterior”) — necesar și pentru „reluarea convocării” din Model_3 v5.
6. Valorile din Excel ≠ codurile din contract (doar etichete): retur `returnată – destinatar necunoscut | mutat | avizat
   neridicat | refuz primire | adresă incompletă – neexpediată` ↔ `destinatar_necunoscut | mutat | avizat_neridicat | refuz |
   adresa_incompleta`; canal răspuns `online | telefon | scris | la sesiune | fără răspuns` ↔ `online | telefon | scris |
   sesiune | email | sms` („fără răspuns” = lipsa rândului; `email`/`sms` nu există în Excel, dar există în Model_3 v5);
   opțiune `particip | nu particip – fără obiecții | nu particip – cu obiecții | constatare pe teren` ↔ identic.
7. Coloanele `AF Obiecții de readucere? / AG Termen remediere / AH Remediat la` nu intră în STARE nici în Excel, nici în
   contract (acolo doar `red_v_tronson.obiectii_deschise`) — consecvent.
8. Nr. PV în Excel e număr simplu („17”); contractul: `PVA-HUS-0001`. Col. U „Afișat la primărie (nr. PV afișare)” e per
   rând în Excel, per UAT în contract — consecvent la export.
9. Centralizatorul numără RÂNDURI (parcelă + persoană) dar etichetează „TOTAL parcele”; `red_v_centralizator_uat` numără
   tot rânduri — la fel, dar eticheta exportului trebuie să spună „rânduri (parcelă + persoană)”.

Culori STARE (formatare condiționată, în ordinea priorității): „PV A SEMNAT” verde `C6EFCE`; „PV B” galben `FFEB9C`;
„OBIECȚII” roșu `FFC7CE`; „RETURNATĂ” roșu `FFC7CE`; „FĂRĂ RĂSPUNS” galben `FFEB9C`; „AFIȘARE” gri `D9D9D9`; „DE
CONVOCAT” alb. Lista UAT (validare col. B): Prunișor, Godeanu, Husnicioara, Căzănești, Ilovăț, Bâlvănești, Șișești.
Calitate (col. K): proprietar, coproprietar, moștenitor, arendaș, utilizator, neidentificat (= contractul).

### 5.4 Coloanele registrului (rândul 1 = grupuri, rândul 2 = antete) — pentru exportul xlsx

| grup | col. | antet (exact) | sursă ERP |
|---|---|---|---|
| PARCELA | A | ID parcelă | red_parcele.id_parcela |
| | B | UAT | red_uat.nume |
| | C | Tronson | red_parcele.tronson |
| | D | Sat | red_parcele.sat |
| | E | Tarla | red_parcele.tarla |
| | F | Nr. cadastral / parcelă | red_parcele.nr_cadastral |
| | G | Poz. HG | red_parcele.poz_hg |
| | H | Suprafață temporară (mp) | red_parcele.suprafata_temporara_mp |
| | I | Categoria de folosință | red_parcele.categoria_folosinta |
| PERSOANA | J | Nume deținător | red_detinatori.nume |
| | K | Calitate | red_detinatori.calitate |
| | L | Cotă | red_detinatori.cota |
| | M | Adresă cunoscută? | red_detinatori_contact.adresa_cunoscuta (DA/NU) |
| | N | Sursa datelor (baza TGZ din data) | red_detinatori.sursa_date + versiune_lista_tgz |
| | O | Telefon (dacă există) | red_detinatori_contact.telefon — **se omite la exportul pentru TGZ** |
| CONVOCARE | P | Nr. scrisoare | red_convocari.nr_document |
| | Q | Data expediere | red_convocari.data_expediere |
| | R | Nr. recomandată (AWB) | red_convocari.nr_tracking |
| | S | Data confirmare primire | red_convocari.data_confirmare_primire |
| | T | Retur (motiv) | red_convocari.retur (etichetă RO) |
| | U | Afișat la primărie (nr. PV afișare) | red_uat.afisare_pv_nr |
| RĂSPUNS | V | Canal răspuns | red_raspunsuri.canal (ultimul) |
| | W | Data răspuns | red_raspunsuri.data |
| | X | Opțiune răspuns | red_raspunsuri.optiune (etichetă RO) |
| | Y | Obiecții (text) | red_raspunsuri.obiectii_text |
| SESIUNE | Z | Ziua programată | red_raspunsuri.zi_sesiune_aleasa („Ziua 2” în Excel, dată în ERP) |
| | AA | Prezent? | DA daca exista red_raspunsuri.canal = sesiune pentru detinator; altfel gol |
| | AB | Constatare pe teren cerută? (data) | red_raspunsuri.data pentru ultimul raspuns cu optiune = constatare_teren; altfel gol |
| PV | AC | Tip PV | red_procese_verbale.tip (A/B/—) |
| | AD | Nr. PV | red_procese_verbale.nr_pv |
| | AE | Data PV | red_procese_verbale.data_pv |
| | AF | Obiecții de readucere? | red_procese_verbale.obiectii_redare (DA/NU) |
| | AG | Termen remediere | red_procese_verbale.termen_remediere |
| | AH | Remediat la | red_procese_verbale.remediat_la |
| | AI | Trimis spre semnare prin poștă (data) | red_procese_verbale.trimis_spre_semnare_data |
| | AJ | PV semnat primit (data) | red_procese_verbale.semnat_primit_data |
| STARE | AK | STARE (calculată) | red_v_stare_parcela.stare (etichetă RO din §5.2) |
| | AL | Responsabil Gazpet | red_uat.responsabil_id -> profiles.name |
| | AM | Observații | red_parcele.observatii |

Centralizator: rând 3 antet `Stare | Prunișor | Godeanu | Husnicioara | Căzănești | Ilovăț | Bâlvănești | Șișești | TOTAL`;
rândurile 4–15 = cele 12 stări în ordinea din §5.2; rândul 16 „TOTAL parcele”; rândul 18 „% parcele închise (PV A sau B)”.

Implementat in felia 6 (4.1k README): export Model_6 din Dashboard, descarcare locala.
Registru intern: 39 coloane; TGZ: 38 (O eliminata fizic). TGZ omite textele libere
N/Y/AM si celulele cu sintaxa de contact; numele detinatorilor raman in registru.
Centralizatorul foloseste cele 12 stari in ordinea 5.2, UAT sortate dupa nume,
TOTAL randuri (parcela + persoana), apoi % parcele inchise (PV A sau B).
Etichetele sunt cele comune ERP din stare.js; culorile celulelor urmeaza paleta Model_6
5.3 (verde/galben/rosu/gri/alb). STARE este valoarea calculata de server, fara formule Excel.
AA: prezenta = orice raspuns canal sesiune. AL: red_uat.responsabil_id -> profiles.name.
AB: data ultimului raspuns, daca optiunea lui este constatare_teren.
Legenda este adaptata exportului de consultare, fara promisiunea recalcularii in Excel.
## 6. Model_7 — Anexa 7, tipizatul pentru datele deținătorilor de la Beneficiar (xlsx, v5 și v6)

**v6 (Final_v2, 03.11.2026)**: rândul 5 (antetul, 30 de coloane) e identic celulă cu celulă cu v5; diferă doar fraza de
reguli din rândul 2 (operator / persoană împuternicită în loc de „în temeiul Legii nr. 185/2016, art. 11 alin. (4)”) și
salvarea Excel (sharedStrings). `importAnexa7.js` găsește antetul după conținut, deci citește ambele versiuni fără
modificări (test: `importAnexa7.test.js`, „tipizatul Final_v2 … ambele fișiere reale se citesc fără erori”).

O foaie „Date detinatori Lot 1”; rândul 1 titlu, rândul 2 reguli („Un rând = o parcelă + un deținător … Date transmise în
temeiul Legii nr. 185/2016, art. 11 alin. (4) … nu se solicită CNP, copii de acte de identitate, conturi bancare sau dosare
succesorale”; „Versiunea listei / data: ____”), rândul 4 grupuri, rândul 5 antete, date de la rândul 6. Validări: A (UAT)
lista celor 7 UAT; J (Calitate) cele 6 calități din contract. E sursa importului `sursa = 'ANEXA7'` (`red_import_loturi`) —
`importTgz.js` știe azi doar formatul TGZ (antet pe rândul 3, alte coloane) → **de adăugat un al doilea parser**.

| grup | col. | antet | ținta în ERP |
|---|---|---|---|
| PARCELA | A | UAT | red_uat (după nume) |
| | B | Sat | red_parcele.sat |
| | C | Tarla | red_parcele.tarla |
| | D | Nr. cadastral / parcelă | red_parcele.nr_cadastral |
| | E | Poz. HG | red_parcele.poz_hg |
| | F | Suprafață afectată temporar (mp) | red_parcele.suprafata_temporara_mp |
| | G | Categoria de folosință | red_parcele.categoria_folosinta |
| | H | Tronson / km | red_parcele.tronson, km_de_la/km_pana_la (de parsat „T3 / km 12+300”) |
| DEȚINĂTOR | I | Nume și prenume / denumire | red_detinatori.nume |
| | J | Calitate | red_detinatori.calitate |
| | K | Cotă | red_detinatori.cota |
| | L | Act doveditor cunoscut Beneficiarului (DA/NU) | **fără sursă** → red_detinatori.act_doveditor_cunoscut bool |
| CONTACT | M | Adresă: stradă, nr. | red_detinatori_contact.adresa_strada |
| | N | Sat | red_detinatori_contact.adresa_sat |
| | O | Comună | red_detinatori_contact.adresa_comuna |
| | P | Județ | red_detinatori_contact.adresa_judet |
| | Q | Cod poștal | red_detinatori_contact.cod_postal |
| | R | Telefon | red_detinatori_contact.telefon |
| | S | E-mail | red_detinatori_contact.email |
| STARE | T | Proprietar neidentificat (DA/NU) | calitate = 'neidentificat' |
| | U | Decedat (DA/NU) | red_detinatori.decedat |
| | V | Moștenitori cunoscuți (nume) | rânduri noi red_detinatori cu calitate 'mostenitor' (sau **fără sursă** text) |
| | W | Sursa informației moștenitori | red_detinatori.sursa_date |
| | X | Utilizator / arendaș (dacă e cunoscut) | rânduri noi red_detinatori 'utilizator'/'arendas' |
| | Y | Reprezentant + referința mandatului | **fără sursă** → red_detinatori.reprezentant_mandat text |
| | Z | Despăgubire achitată (DA/NU, nr./data document; fără sumă) | **fără sursă** → red_detinatori.despagubire_doc text |
| | AA | Stadiul verificării calității deținătorului | **fără sursă** → red_detinatori.stadiu_verificare text |
| | AB | Observații | red_parcele.observatii / red_detinatori (fără coloană azi) |
| SURSĂ | AC | Sursa datelor (CF / ANCPI / primărie / notificare L185) | red_detinatori.sursa_date |
| | AD | Data ultimei actualizări | red_detinatori.updated_at / versiune_lista_tgz |

## 7. PDF-urile (Checklist, Plan DRAFT, Scrisoare DRAFT, v3 din 31.10) — ce schimbă/adaugă față de brief

1. Toate 3 sunt DRAFT intern; planul și scrisoarea NU se transmit încă (citatele din acordul de mediu sunt din OCR, de
   confruntat cu originalul; L185/2016 de verificat pe legislatie.just.ro).
2. Termene: Transgaz are 15 zile de răspuns de la primirea scrisorii; datele proprietarilor vin în 15 zile de la aprobare,
   altfel se pornește cu baza din 13.07.2026; TGZ confirmă calendarul și reprezentantul în 5 zile lucrătoare.
3. Convocarea: recomandată cu AR expediată cu ≥10 zile înainte de prima sesiune; afișarea la primărie tot ≥10 zile înainte,
   până la ultima zi de sesiune, cu PV de afișare; 3 zile consecutive pe UAT, cel puțin una până la 19:00.
4. Constatarea pe teren la cerere: în maximum 10 zile de la sesiune (cu Antreprenorul și reprezentantul TGZ); v5 a
   convocatorului spune „la data stabilită de comisie”.
5. PV B se încheie pentru 4 situații: declarație „nu particip, fără obiecții”; neprezentare după convocare + afișare 10 zile;
   neidentificat / fără adresă; **refuz de semnare fără obiecții de readucere** (fără stare în contract — §3).
6. Coproprietari: se convoacă toți cei cunoscuți, semnează cei prezenți; moștenitorii comunicați de TGZ; arendașul/utilizatorul
   semnează separat de proprietar.
7. Obiecțiile care nu țin de redare (despăgubiri, servitute) se înregistrează separat și merg la TGZ (→ `alte_observatii`).
8. Ce cere Transgaz-ului: aprobarea planului + modelelor, împuternicire scrisă (→ `red_proiecte.imputernicire_*`),
   ridicarea interdicției de contact direct, desemnarea DRFT, adresele actualizate + lista neidentificaților (→ Model_7),
   clauzele GDPR.
9. Cifre de pornire: 2.728 parcele, ~1.360 proprietari, 524 neidentificat, 0 telefoane, adresa lipsă la ~31% (pe UAT în plan).
10. Registrul (Anexa 4) „se ține în ERP-ul Gazpet”, se exportă pe UAT și pe tronson, fără telefoane către TGZ.
11. Plan §8 GDPR: datele se țin la Document Control cu acces restrâns, nu se dau subcontractorilor, la final se predau TGZ;
    Gazpet păstrează dovezile de convocare, declarațiile și PV-urile.
12. Checklist: formularul online are „3 opțiuni” (brief-ul + modelele au 4, cu constatarea pe teren); responsabil de proiect
    redări = coloana „Responsabil Gazpet”; ofertă Poșta Română pentru ~1.360 recomandate în vrac.
13. Codul documentelor către TGZ: `30-GAZ-CTG1-COR-[nr]` (registratura Gazpet) — relevant pentru numerotarea adresei UAT.
14. PDF-urile conțin și strategie internă (litigiu, 69a, sume) — sunt în repo-ul privat ca referință; de scos dacă repo-ul
    devine partajat.

## 8. Termenul de convocare și afișare: 10 zile (plan A1 rev49, 03.11.2026)

Textul planului (Final_v2): pct. 4.2 — „Fiecare deținător cu adresă cunoscută primește convocatorul (Anexa 1) prin scrisoare
recomandată cu confirmare de primire, expediată cu cel puțin 10 zile înainte de prima zi de sesiune.”; pct. 4.3 — „Convocarea pe
UAT, cu lista parcelelor (fără date personale), se afișează la intrarea în primărie cu cel puțin 10 zile înainte, pentru toți
proprietarii, inclusiv cei fără adresă sau neidentificați. […] Afișarea e publicitate suplimentară; nu valorează acceptare
tacită.”; calendarul: „Cu cel puțin 10 zile înainte de prima zi de sesiune (pct. 4.2 și 4.3).”; PV B: „proprietarul nu s-a
prezentat după convocarea și afișarea de 10 zile”.

Regula în ERP: zile **calendaristice** (planul nu spune „lucrătoare”), față de **ziua 1 de sesiune** (`red_uat.sesiune_zi1`),
pentru **data expedierii** recomandatei (nu a primirii) și pentru **începutul afișării** (`red_uat.afisare_data_start`). Data-limită
= ziua 1 − 10 zile; o expediere / afișare chiar pe data-limită e în termen, din ziua următoare e după termen. O singură constantă:
`TERMEN_CONVOCARE_ZILE = 10` în `src/redari/setari.js` (`dataLimitaConvocare`, `termenAfisare`).

| Unde | Ce face | Fel |
|---|---|---|
| UAT → fișa UAT (`avertismenteUat`) | afișarea începe după limită → caseta galbenă + confirmare la salvare (dacă se schimbă ziua 1 sau afișarea) | avertisment: data afișării e un fapt (PV de afișare), nu se blochează |
| UAT → tabel „Gata de convocare?” (`lipsuriUat`) | „afișarea începe după ZZ.LL.AAAA (sub 10 zile înainte de ziua 1)” | informare |
| Adresa UAT (`verificaDateAdresaUat`) | nu se generează cu afișarea după limită: adresa promite „cu cel puțin 10 zile înainte de prima sesiune” | **blocant** |
| Plicuri (`termenExpediere`, `avertismentExpediere`, `confirmaExpediereRecitita`) | „expediați până la ZZ.LL.AAAA” pe UAT, pe fiecare plic propus / neexpediat și în modalul de expediere; la „Salvează” ziua 1 se recitește din BD și, dacă expedierea e după limită, confirmarea se cere pe valoarea recitită (recitire eșuată = nu se salvează); plicul expediat după limită apare „⚠ după termen” | avertisment: data expedierii e un fapt (borderoul Poștei) |
| Import CSV de expediere (`propune`, `confirmariAplicare`, `reevalueazaTermene`) | avertisment pe fiecare rând tardiv din previzualizare + contorul „După termenul de 10 zile: N”; la „Aplică” o a doua confirmare numără și enumeră rândurile tardive; imediat înainte de aplicare ziua 1 a UAT-urilor se recitește, iar dacă termenele diferă de previzualizare se cere confirmarea pe valorile de acum (recitire eșuată sau UAT lipsă = nu se aplică nimic); după confirmare rândurile tardive se aplică cu data reală | avertisment: rândul nu se refuză |

În BD nu există CHECK pentru termen (`valideazaUat` rămâne oglinda CHECK-urilor din 20261127a). Propunerea de CHECK (fără
migrare în acest PR) e în descrierea PR-ului.

## 9. Format A4 + fața convocatorului pe o pagină (03.11)

Decizia lui Răzvan din 03.11.2026 („varianta A”): convocatorul se tipărește față-verso pe o foaie A4 — pe față convocatorul,
pe verso informarea GDPR completă (PR #939, separat). Se schimbă **doar formatarea**; textul juridic rămâne identic, cuvânt cu
cuvânt: `construieste()` din `scripts/redari_sabloane_din_modele.mjs` ia textul de referință înainte de orice pas de formatare și îl
compară după fiecare pas (refuză pasul care schimbă textul concatenat din `<w:t>`), iar `src/redari/sabloaneA4.test.js` compară amprenta SHA-256 a acestui text cu cea a șabloanelor de
dinainte (main @ `ac7afa7c`), pe toate 5.

**Ce era**: modelele Final_v2 sunt salvate pe **Letter** (12240×15840 twips), iar convocatorul ocupa 2 pagini (`docProps/app.xml`;
Word marca trecerea la pagina 2 înainte de „În lipsa participării…”, ceea ce estimarea de mai jos reproduce).

**Excepția (6), toate 5 șabloanele**: `w:pgSz` → A4 (11906×16838). Lățimile tabelelor (`w:gridCol`, `w:tcW` dxa, `w:tblW` dxa
unde există) se scalează cu raportul lățimilor utile, ca tabelele să rămână între margini; baza e cea mai mare dintre lățimea
utilă veche și sumele din tabele (în PV A / PV B unele rânduri depășeau cu 1 twip), iar testul cere `tblW`, suma `gridCol` și
suma `tcW` pe fiecare rând ≤ lățimea utilă A4 (PV A, PV B, PV C, adresa UAT: marginile din model, 1,8 / 2 cm,
lățimea tabelelor ×0,966). `cerere_imputernicire.docx` era deja A4 și nu e atins.

**Excepția (7), doar convocatorul** (`CONVOCATOR_FORMAT` în generator):

| Ce | Înainte (model) | Acum |
|---|---|---|
| margini sus/jos, stânga/dreapta | 1,8 cm / 2 cm | **1,27 cm / 1,5 cm** |
| spațiere după paragraf (docDefaults) | 10 pt | 0 pt |
| interlinie (docDefaults) | 1,15 | 1,0 |
| corpul stilului Normal | 10,5 pt | **9,5 pt** (limita de jos cerută) |
| paragrafele goale de separare (5) | 10,5 pt / 8 pt | 4 pt |
| coloanele tabelului parcelei | 6 egale | 17 / 19 / 20 / 12 / 20 / 12 % |
| coloanele programului sesiunilor | 4 egale | 12 / 16 / 27 / 45 % (Ziua / Data / Program / Sate) |
| QR (3 cm, `QR_CM` din `docx.js`) | paragraf centrat, pe rândul lui | cadru de 3,2 cm la dreapta (`w:framePr`), opțiunile de răspuns curg în stânga lui |
| marcajul `lastRenderedPageBreak` | prezent | scos (era poziția paginii 2) |

Rămân neschimbate: titlul (13 pt), tabelele (9,5 pt), antetul firmei (8 pt), blocul „Date personale” (9 / 8,5 pt), rândul de
semnătură (două rânduri libere), mărimea QR-ului. Marginile sunt sub sugestia inițială (1,5 / 1,8 cm) pentru rezerva de 15%.

**Estimarea paginii** (fără Word / LibreOffice pe server): metrici reale Calibri / Calibri Bold / Italic (tabelele `hmtx` +
`OS/2` win din `C:\Windows\Fonts`), încadrare greedy pe cuvinte la lățimea utilă (minus marginile celulelor de 0,19 cm), înălțimea
rândului = 1,2207 × corpul × interlinia, rândurile tabelelor = cea mai înaltă celulă + bordura, QR-ul 85 pt în cadru (textul de
lângă el pe lățimea utilă minus 3,5 cm). Calibrare: pe modelul Letter, estimarea pune trecerea la pagina 2 exact unde a pus-o
Word. Previzualizarea e completată cu `completeazaDocx` (date fictive, QR real); textul GDPR de pe față = textul scurt din
Model_1 + „Informarea completă: <link>” (cazul cel mai lung din `textGdprPentruUat`; istoric: din 03.11 seara propoziția nu se mai tipărește pe față, deci textul real e mai scurt).

| Date fictive | Conținut | Înălțime utilă A4 | Umplere | Rezervă | Cu lățimi +5% |
|---|---|---|---|---|---|
| lungi (nume și adresă lungi, program „09:00 – 19:00 (program prelungit)”, sate lungi, URL de 94 de caractere) | 631 pt | 770 pt | 82,0% | **18,0%** | 15,0% |
| tipice | 610 pt | 770 pt | 79,2% | **20,8%** | 17,8% |

Din 03.11 seara (excepția (8), §1) linkul de răspuns nu se mai tipărește în fraza opțiunilor: textul feței doar s-a scurtat, iar
formatarea a rămas aceeași, deci față de estimarea de mai sus umplerea poate doar să scadă (rezerva doar să crească).

Estimarea nu înlocuiește verificarea în Word: previzualizarea DOCX se deschide în Word (bara de stare: „Pagina 1 din 1”) înainte
de primul lot tipărit. `docProps/app.xml` din șablon păstrează statisticile salvate de Word în model (`<Pages>2</Pages>`): sunt
valoarea veche, nu paginarea nouă, și se actualizează când Word salvează documentul. Dacă Word arată totuși 2 pagini, primele
de strâns sunt marginile (1 cm) — nu corpul de literă, care e la limită. Textul GDPR de pe față vine din `red_proiecte.text_gdpr`:
un text mai lung decât cel din Model_1 consumă din rezervă (~10 pt pe fiecare rând în plus, la 8,5 pt).
