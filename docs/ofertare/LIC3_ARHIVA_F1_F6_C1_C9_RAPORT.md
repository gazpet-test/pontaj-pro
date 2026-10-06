# Licitația 3 (CN1095546, ADI Mostiștea Gaze Sud / Mânăstirea): arhiva „DOC_F1_F6_C1_C9” — ce conține și ce rămăsese necitit

Raport întocmit în noaptea de 06–07.10.2026, doar citire: fișierele din platformă și copia locală despachetată în `C:\Users\Public\manastirea_clar`. În baza de date nu s-a modificat nimic.

## Pe scurt
- Arhiva SEAP `CN1095546/00058` a fost publicată pe 02.10.2026, sub titlul „Forumulare F1_F6_C1_C9” (document 1305, 60 MB). Despachetarea pe Terra a produs 159 de fișiere.
- **Ce conține:** formularele de ofertă **necompletate**, adică macheta pe care o completăm noi la ofertare. Alături sunt planșele și studiile pentru cele 5 obiecte (Oltenița-extindere, Ulmeni, Spanțov, Chiselet, Mânăstirea). **Nu conține răspunsuri la clarificări.**
- **Necitit rămăsese doar `Norme ANRE ptr realizarea GIS.rar`** (#1623). Conține 3 fișiere ANRE din 2021: schema XML GIS cerută la licența de operare, descrierea câmpurilor și modificările din 25.05 și 23.06.2021. Asta înseamnă o **cerință de predare GIS la recepție**, în format ANRE.
- **Problemă de clasificare în platformă:** 116 dintre fișiere au tipul `raspuns_clarificare`, deși sunt formulare și planșe. Toate cele 151 au status `neprocesat`, cu excepția celor 7 F3 deja citite. Corectarea e o scriere în date și se face doar cu preview și OK.

## Inventar (123 PDF, 455 de pagini, plus arhiva GIS)
| Grup | Conținut | Nr. |
|---|---|---|
| F1–F6 | centralizator obiectiv, centralizatoare pe obiect (5), liste de cantități F3 pe tronsoane (7), echipamente F4 (5), fișe tehnice F5 (5), grafic F6 | 24 |
| C1–C9 | grafic, centralizatoare, liste C4/C5 (7+7), extrase materiale, manoperă, utilaje și transport (pe deviz, obiect, investiție) | ~62 |
| DG / DO / CM | deviz general, devize pe obiect (5), centralizator C+M | 7 |
| EN, antemăsurători | explicitarea normelor (7), antemăsurători (7) | 14 |
| Planșe 1–36 | plan de situație, izometrie, detalii de montaj, subtraversări (CAA1, DN/DJ/DC), SRMP 4.500 mc (DGSR), ATR Distrigaz Sud Rețele, anexe și soluție, studiu geotehnic, PV-uri de recepție OCPI pentru cele 5 UAT | ~40 |
| GIS | normele ANRE pentru schema XML a licenței de operare (XML + 2 docx) | 3 |

Devizul general și F1 sunt **machete goale**, fără valori, generate cu eDevize.ro de proiectantul Dornacor Invest SRL.

## Ce înseamnă pentru ofertă
1. **Formularele de completat sunt F1–F6 și C1–C9.** Structura pe 5 obiecte și 7 tronsoane trebuie să intre identic în propunerea financiară. Asta se leagă de tema „propunere financiară + formulare F”, aflată în Ofertare.
2. **GIS ANRE:** la recepție se cere predarea rețelei în schema XML ANRE: conducte, branșamente, SM/SR/SRM/SRS, cu câmpurile `NR_PVRTL`, `DATA_PVRTL`, `VALOARE_CONTABILA_LEI`, `REGIM_DE_PRESIUNE_IP_MP_RP_JP` etc. Trebuie inclus costul topografiei și al GIS-ului, dacă nu apare deja într-un articol de deviz. **De verificat în F3/C5** dacă există un articol pentru realizarea GIS-ului.
3. **ATR Distrigaz Sud Rețele (planșa 32) și SRMP 4.500 mc (planșele 23–29, 33):** obiectul Oltenița e extindere pentru DGSR. De verificat cerințele operatorului: tehnologie, recepție, cuplarea în faza 1 și faza 2 (planșele 20–21).
4. **PV-urile OCPI pentru toate cele 5 UAT (36.1–36.5)** completează clarificarea 5, despre planul topografic din faza SF.

## Propuneri (neaplicate, cer OK)
- Reclasificarea celor 116 fișiere: `raspuns_clarificare` → `formular` / `plansa` / `lista_cantitati`. Se face cu preview și OK.
- Citirea cu AI pe felii a formularelor și planșelor-cheie se face doar prin poarta pe cheltuială (owner sau responsabil). Le recomand pe F3/C4/C5 și pe planșele 23–34.
- Suport RAR/7z în importul SEAP (temă veche, #39): arhivele imbricate (`.rar` în `.rar`) au rămas ca fișier „ignorat”. Sesiunea Ofertare poate adăuga despachetarea recursivă.

---

## Actualizare 07.10.2026: reclasificare aplicată și citire cu abonamentul
**Reclasificare (OK Răzvan, aplicată):** 117 rânduri, toate cu tipul vechi `raspuns_clarificare`.
| Tip nou | Nr. | Fișiere |
|---|---|---|
| `plansa` | 31 | 1465–1504 (fără ATR, anexe, studiul geo, PV-uri) |
| `formular` | 70 | 1512, 1533–1591, 1612–1622 |
| `lista_cantitati` | 7 | 1592–1598 |
| `alta` | 9 | 1490, 1492–1498, 1623 |

Revenire: `UPDATE ofertare_documente_atribuire SET tip='raspuns_clarificare' WHERE id IN (<cele 117 id-uri de mai sus>)`. Statusurile de procesare au rămas neatinse.

**Citire locală (pymupdf, pe PC, fără API plătit), cu imaginile scanate citite de Claude:**
- **Grafic C1/F6:** execuție între **01.02.2027 și 31.05.2029** (28 de luni), structurat așa:
  - Oltenița: 02–05.2027, apoi 03–05.2029;
  - Ulmeni, Spanțov, Chiselet și Mânăstirea Dn250: 06–10.2027 + 11.2027–04.2029;
  - Mânăstirea Dn180 și Dn160: 02–05.2029.
- **ATR Distrigaz Sud Rețele nr. 13840091 din 14.10.2025, modificat 26.02.2026** (soluția nr. 362099 din 18.02.2026):
  - extindere din DN315 MP Ulmeni cu PE **Dn250, L = 5.040 m**;
  - racord PE Dn180, L = 5 m;
  - **SRMP-SD automatizată AMR, 4.500 mc/h**, pe limita Oltenița–Ulmeni (teren NC 31159), regulator cu acționare directă, contor **turbină G400 DN150** plus **pistoane rotative G250 DN100**;
  - presiune la livrare **3,72 bar** (ieșire 3,17 bar), cu platformă betonată, împrejmuire și schemă izometrică;
  - DGSR urmărește execuția prin personal autorizat. Termenele de punere în funcțiune sunt cele din Regulamentul de racordare.
- **Anexe + soluție (60 de pagini, scanat):** fișa tehnică SRMP (L2-III-1), schema izometrică DGSR, apoi specificațiile tehnice DGSR:
  - robinete fluture și cu sferă, racorduri din oțel, filtre, regulatoare PM-PJ, supape de descărcare;
  - fiecare cere declarație de conformitate, certificat CE (PED 2014/68/UE, ATEX 2014/34/UE), certificat de inspecție **3.1 (SR EN 10204)**, documente în română și **garanție de minim 36 de luni** de la livrare.
  - **Implicație:** echipamentele SRMP se cumpără numai de la furnizori care livrează pachetul complet de documente DGSR. Prețul trebuie cerut cu această condiție.
- **Planșele 1–31:** în cea mai mare parte sunt desene vectoriale fără text. Planul de situație (128k caractere) și subtraversările 30/31 au text. Citirea lor completă cere vizualizare pe imagine, pe felii.
- Formularele F1–F6 și C1–C9 sunt confirmate goale, adică macheta eDevize de completat.

## Ce schimbăm în motorul Ofertării ca să nu se mai repete (propunere pentru sesiunea Ofertare)
1. **Clasificarea după conținut, nu după arhiva-mamă.** Azi toate fișierele dintr-o arhivă publicată ca „clarificare” moștenesc tipul `raspuns_clarificare`. Propunerea e un clasificator determinist pe numele fișierului, aplicat la despachetare:
   - `^[CF][1-9]_`, `DG_`, `DO_`, `CM_` → `formular`;
   - `lista_cantitati|antemasuratoare|EN_` → `lista_cantitati`;
   - prefix numeric de planșă → `plansa`;
   - `ATR|aviz|PV|studiu` → `alta`;
   - restul rămâne pe tipul moștenit.

   Rezultatul se arată în UI ca „tip propus”, editabil.
2. **Despachetare recursivă RAR/7z/ZIP** în importul SEAP, cu limite de adâncime și volum. Azi un `.rar` din interiorul unei arhive rămâne `ignorat`, adică necitit în tăcere.
3. **Triaj gratuit înaintea celui plătit.** La import, server-side, fără AI:
   - se extrage textul;
   - se numără paginile și caracterele pe pagină;
   - fișierul se marchează `scanat` (sub ~50 de caractere/pagină) sau `text`.

   Doar fișierele scanate sau planșele merg la poarta pe cheltuială. Fișierele cu text se analizează din `text_extras`.
4. **Detector „formular gol”:** macheta eDevize fără valori numerice în coloanele de valoare primește `analiza = {macheta_goala: true}` și nu mai consumă citire AI.
5. **Indicator „arhivă publicată ca clarificare, dar fără răspunsuri”:** dacă după clasificare zero fișiere rămân `raspuns_clarificare`, se pune un banner pe licitație. Așa nu mai credem că avem clarificări necitite.
6. **Alarmă pe fișierele `ignorat` sau neprocesate mai vechi de 24 de ore** în panoul licitației.

Ordinea recomandată: 1 + 2 + 3 (cele mai mari economii), apoi 4–6.
