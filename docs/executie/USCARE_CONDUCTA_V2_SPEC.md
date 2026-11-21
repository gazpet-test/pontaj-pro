# Uscare conductă în Execuție — treapta a doua: două etape, prag de lucru, proces-verbal (SPECIFICAȚIE)

Stare: 17.11.2026, runda 2 (deciziile proprietarului din seara de 17.11 incluse). **Doar document.** Nu există cod, migrare sau schimbare de
date în acest PR. Prima livrare (`docs/executie/USCARE_CONDUCTA_SPEC.md`, migrarea `20261225a_executie_uscare.sql`) **nu se schimbă**: tot
ce e nou intră într-o migrare NOUĂ, peste ea (§10). Implementarea se face pe trei felii, fiecare cu review propriu. Ce a rămas deschis: §11.

Termeni: **Antreprenorul** = firma noastră; **beneficiarul** = autoritatea contractantă; **raportul** = raportul de uscare din prima livrare (o
operațiune = o trecere a trenului de pistoane); **PV-ul** = procesul-verbal de uscare, documentul nou; **piston-burete** = buretele din spumă
vehiculat prin conductă; **persoana desemnată** = cineva numit pe proiect să semneze PV-ul pentru Antreprenor din ERP; **reprezentantul** =
reprezentantul beneficiarului care asistă la operațiune pe șantier.

Cuprins: 0. Deciziile și criteriul · 1. Ce există și ce se schimbă · 2. Cele două etape · 3. Calculul · 4. Procesul-verbal · 5. Semnătura
Antreprenorului · 6. Exemplarul olograf și tronsonul confirmat uscat · 7. Stările PV-ului · 8. Vremea · 9. Accesul · 10. Schema și feliile ·
11. Ce a rămas de decis · 12. Ce NU face treapta a doua · 13. Lecțiile · 14. Istoric.

---

## 0. Deciziile proprietarului (17.11.2026) și criteriul

| # | Decis |
|---|---|
| D1 | **Semnătura beneficiarului NU se ia în aplicație.** Nu toți cei care asistă la operațiune au drept de semnătură (în principiu doar diriginții de șantier). PV-ul iese din ERP semnat **doar** de persoana desemnată a Antreprenorului, se tipărește, beneficiarul îl semnează **olograf**, iar scanul exemplarului semnat se urcă în ERP; după verificarea scanului de către om, tronsonul e **confirmat uscat**. Numele și funcția reprezentantului care a asistat le completează echipa (informativ, tipărite la rubrica de semnătură). |
| D2 | **„Trece” = doar ULTIMUL piston-burete sub prag.** Greutățile tuturor pistoanelor se consemnează și apar în PV; calculul propune, omul confirmă. |
| D3 | **Pragul de lucru = 100 g pe km** (exemplu: 500 g pe 5 km), **valoarea implicită** a unui parametru de proiect, modificabil pe proiect, cu istoric. |
| D4 | **Semnătura Antreprenorului se aplică doar când persoana desemnată confirmă, din contul ei**, pe fiecare PV. Lista persoanelor desemnate o administrează owner-ul și managerul de proiect. |
| D5 | **Fără drepturi noi.** Oamenii de pe șantier au deja nivelul de scriere al modulului Execuție. |

**Ce spun documentele despre prag (formularea din PV depinde de asta):**
- caietul de sarcini al proiectului dă o cifră **doar la curățare** („cantitatea de impurități eliminată … mai mică de 0,1 kg pentru un tronson în
  lungime de aproximativ 5 km”); la **uscare** spune doar „**ultimul piston vehiculat iese uscat**” (specificația existentă §1);
- corespondența scrisă a beneficiarului nu conține niciun prag;
- 100 g/km este practica proiectelor (proprietarul).

De aceea PV-ul **citează criteriul caietului** („ultimul piston vehiculat iese uscat”) și arată separat **pragul de lucru al operațiunii**, cu
valoarea și calculul. **Lângă cifră nu scrie „conform caietului de sarcini”.** Semnarea PV-ului de către persoana cu drept de semnătură a
beneficiarului, cu pragul tipărit, înseamnă acceptarea lui. Dacă beneficiarul comunică în scris altă valoare, parametrul proiectului se schimbă
(rând nou în istoric, cu documentul ca sursă).

---

## 1. Ce există și ce se schimbă

| Cerința | Azi (prima livrare) | Treapta a doua |
|---|---|---|
| Cântărirea fiecărui burete la intrare și la ieșire | **Acoperită** (`cantariri`, kg cu 3 zecimale, sau „nu se aplică” cu motiv; cerută la închidere) | Neschimbată ca formă; se adaugă momentul etapei 1 și înghețarea intrării (§2.2) |
| Poza cântarului pe fiecare burete | **Acoperită** (`cantar_intrare` / `cantar_iesire`; lipsa cere justificare) | Neschimbată (fără semnal poza nu urcă, deci nu blocăm, §2.4) |
| Două etape separate în timp | **Parțial**: raportul rămâne deschis, ciornă locală, îmbinare la conflict; nimic nu marchează „pistonul a intrat” | **Nou**: „Închei etapa 1”, ecran ghidat pe etape, lista „așteaptă ieșirea” |
| Diferența de greutate și pragul | Doar în aplicație, în kg, fără prag, nu apare în PDF | Calculată de server și de ecran din aceeași regulă, în **grame întregi**, comparată cu pragul de lucru pe ultimul burete (§3) |
| Concluzia | Omul alege CONFORM / NECONFORM; CONFORM cere „ultimul piston uscat” + poza | Rămâne la om; CONFORM contra calculului e refuzat (§3.4) |
| Proces-verbal | **Nu există** (PDF-ul raportului se semnează pe hârtie) | **Nou** (§4), semnat din ERP de persoana desemnată (§5) |
| Semnătura beneficiarului | Rubrici text liber (`semn_beneficiar_nume` / `_functie`) | **Rămâne pe hârtie** (D1); rubricile devin câmpul informativ „a asistat” (§6.1) |
| Exemplarul semnat urcat în ERP | **Nu există** | **Nou**: urcarea scanului + verificarea de către om (§6) |
| Tronson confirmat uscat | **Nu există** (etapa „uscare” din Probe e manuală, separată) | **Nou**: stare **derivată** din PV-urile cu olograf confirmat, citită prin legătură (§6.4) |
| Km, lungime, temperatură, vreme, poziție, notificarea cu 24 h | **Acoperite** | Neschimbate; PV-ul le preia |

---

## 2. Cele două etape pe telefon

Între introducerea pistonului și ieșirea lui pot trece și 60 de minute (sudarea capacului, legarea compresoarelor), iar ieșirea e adesea la
celălalt capăt, cu alt om.

### 2.1 Ce se completează

Ecranul rămâne cel de azi, dar **ghidat pe etape** (o bandă sus; secțiunile etapei curente deschise, celelalte restrânse).

| Etapa | Se completează | Se încheie cu |
|---|---|---|
| **1 — înainte de introducere** | tronsonul și km-ii, notificarea, data, poziția, temperatura / vremea, utilajele, configurația pistoanelor, **cântarul** (descriere + diviziunea, §3.3), **greutatea la intrare a fiecărui burete, în ordinea din tren** (buretele 1 = primul introdus, ultimul număr = **ultimul piston vehiculat**), pozele cântarului | **„Închei etapa 1 — pistonul intră în conductă”**: momentul îl pune serverul (`etapa1_la`, `etapa1_de`) și devine ora introducerii propusă |
| *între etape* | nimic obligatoriu; raportul rămâne deschis; lista rapoartelor arată „**Așteaptă ieșirea** — introdus la HH:MM” | — |
| **2 — la ieșire** | ora ieșirii, presiunea, timpul de deplasare, cântarul („același” sau altul), **greutatea la ieșire a fiecărui burete**, ultimul piston, observațiile, reprezentantul care a asistat (§6.1), concluzia | „✓ Închide raportul” (ca azi), cu propunerea calculului afișată (§3.4) |

- **Ordinea o impune serverul:** greutățile la ieșire nu se pot scrie cât etapa 1 nu e încheiată; închiderea cere etapa 1 pentru rapoartele
  create după livrare (marcajul `doua_etape`, pus de server la creare). Rapoartele mai vechi se închid ca azi și nu primesc PV.
- **Cine continuă etapa 2:** oricine are scriere pe proiect (D5), cu regulile de concurență de azi (CAS + îmbinarea pe câmpuri).

### 2.2 Înghețarea greutăților la intrare

Greutatea la intrare decide rezultatul, deci nu poate fi schimbată tacit după ce se vede ieșirea:
- la „Închei etapa 1”, serverul reține în jurnal greutățile la intrare, numărul bureților și ordinea lor;
- după aceea, o schimbare e o **corecție consemnată** (motiv obligatoriu, valori vechi și noi în jurnal), tipărită în PV.

### 2.3 Mai multe treceri pe același tronson

Un raport = o trecere (ca azi). Trecerea nereușită se închide NECONFORM; „Trecere nouă pe același tronson” copiază tronsonul, km-ii, utilajele
și configurația, nu greutățile. Numărul trecerii e **derivat** (ordinea după ora începerii, pe același tronson și aceeași campanie). PV-ul se
generează doar din trecerea care trece și **menționează trecerile anterioare** (data, diferența ultimului burete, NECONFORM).

### 2.4 Fără semnal

- **Datele** stau în ciorna locală de azi și se salvează la revenirea semnalului.
- **„Închei etapa 1”** cere semnal (momentul e al serverului). Fără semnal, „Notez ora introducerii” păstrează în ciornă **ora declarată**; la
  revenirea semnalului omul încheie etapa 1, iar serverul reține ambele. PV-ul arată ora declarată și, dacă diferă cu peste 15 minute,
  „înregistrată în platformă la …”.
- **Pozele** se urcă din galerie la revenirea semnalului; ora din anexă rămâne ora încărcării, iar o poză „cântar la intrare” urcată după
  etapa 1 poartă mențiunea „încărcată după introducere” (informație, nu refuz).

---

## 3. Calculul

### 3.1 Formula (D2, D3)

- greutățile, în kg cu cel mult 3 zecimale, sunt **grame întregi**: `g = kg × 1000`;
- diferența pe fiecare burete `Δi = iesire_g − intrare_g` (pozitivă = a reținut apă) — calculată și tipărită **pentru toți**;
- **pragul tronsonului** `P = v × L / 1000` grame: `v` = pragul de lucru al proiectului (g/km, implicit **100**, cel mult o zecimală),
  `L` = `lungime_m` din raport (cel mult o zecimală);
- **condiția** se aplică **doar ultimului burete** (numărul cel mai mare din tren): `Δultim ≤ P` („nu mai mult de” = egalitatea trece).
  Exemplu: 100 g/km × 5.000 m = 500 g; Δ = 500 g trece, Δ = 501 g nu trece. Ceilalți bureți sunt **informativi** (apar în tabel, fără rezultat).

**Comparația, în întregi, identică în SQL și în JS:** `100.000 × Δ ≤ (10·v) × (10·L)` (cel mai mare produs, sub 10¹³, e exact în JS). Nimic
nu se rotunjește înainte de comparație; afișarea: pragul cu cel mult două zecimale („487,35 g”), diferențele în grame întregi.

### 3.2 Unitatea și greșelile de cântărire

Rămânem pe kg (rubricile modelului). Ca o greșeală să se vadă înainte de salvare: lângă fiecare câmp „2,345 kg = **2.345 g**”; lângă ultimul
burete „Δ = +130 g · prag 487,35 g · ✔ în prag”. **Plauzibilitate** (pe toți bureții, aceeași regulă SQL = JS): ieșirea peste 3 × intrarea,
Δ peste 20 × prag sau intrarea sub 0,1 kg cer o confirmare explicită, consemnată („am verificat, cântarul arată … kg”); nu blochează.

### 3.3 Cântarul

La fiecare etapă: descrierea cântarului și **diviziunea** (g). Cântar diferit între etape sau diviziune peste o cincime din prag (ex. 100 g pe
un tronson de 500 m, prag 50 g) ⇒ rezultatul devine „**de verificat**”, iar PV-ul tipărește ambele cântare.

### 3.4 Rezultatul calculului și închiderea

| Situația ultimului burete | Calculul |
|---|---|
| Δ ≤ P | **trece** |
| Δ > P | **nu trece** |
| greutate lipsă sau „nu se aplică” (ex. rămas în conductă) | **nu se poate calcula** (un burete rămas înseamnă oricum altă trecere) |
| Δ negativ mic (cel mult 2 diviziuni; fără diviziune: cel mult 1% din intrare) | **trece** („fără acumulare”), afișat cum s-a măsurat |
| Δ negativ mai mare, cântar diferit / prea grosier | **de verificat** |

| Calculul | Concluzia omului | Închiderea | PV |
|---|---|---|---|
| trece | CONFORM | da | da |
| trece | NECONFORM | da, cu **motiv obligatoriu** | nu |
| nu trece | CONFORM | **refuzată** (în BD) | — |
| nu trece / nu se poate calcula / de verificat | NECONFORM | da | nu |
| nu se poate calcula / de verificat | CONFORM | **refuzată** — recomandare, de decis (§11, R2) | — |

- CONFORM cere în continuare „ultimul piston uscat” + poza lui (criteriul caietului); calculul se adaugă, nu înlocuiește.
- **O singură definiție** (L19): `fn_executie_uscare_criteriu` în SQL = `criteriuUscare` în `src/uscareLogica.js`, cu test de paritate pe un
  tabel de cazuri (egalitatea exactă, prag cu zecimale, Δ negativ la limită, cântar diferit, un prim burete foarte ud cu ultimul uscat). Regula
  de închidere intră în `fn_executie_uscare_lipsa` / `lipsaDinRand`, deci trigger-ul de închidere o impune pe orice cale (L07).
- Ecranul arată propunerea **înainte** ca omul să aleagă: „Calculul: ✔ trece (ultimul burete Δ = 130 g ≤ 487,35 g)”.

### 3.5 Parametrul pe proiect

- **Fără rând pe proiect, se aplică 100 g/km** (valoarea implicită, definită într-un singur loc: funcția SQL care întoarce pragul în vigoare;
  ecranul o citește de la server).
- O schimbare = **rând nou** în `executie_uscare_praguri` (doar adăugare): valoarea (g/km, > 0, cel mult o zecimală), **motivul**
  (obligatoriu), sursa (text, ex. „adresa beneficiarului nr. … din …”, opțională), cine și când (`auth.uid()`, ora serverului, L08). Nu există
  „fără prag”: pragul se poate schimba, nu șterge. Cine îl schimbă: cine administrează lista persoanelor desemnate (§11, R1).
- **La închidere**, serverul copiază în raport **pragul aplicat** (versiunea sau „implicit”, valoarea, `L`, `P`) și rezultatul calculului; PV-ul
  le tipărește din copie. O schimbare ulterioară nu atinge rapoartele închise. Un raport deschis ia pragul în vigoare la închidere (ecranul
  spune dacă s-a schimbat între timp); un raport redeschis se reînchide cu pragul de atunci, iar PV-ul vechi e oricum invalidat (§7).

---

## 4. Procesul-verbal

### 4.1 Conținutul

Fiecare pagină: titlul, numărul PV-ului, **codul documentului** (primele 12 caractere ale amprentei, §4.3), „pagina n din m”.

1. **Antet**: „PROCES-VERBAL DE USCARE A CONDUCTEI nr. … din …”; obiectivul / contractul.
2. **Tronsonul**: codul / denumirea, de la km X + YYY la km X + YYY, lungimea; campania (după proba cu apă / cu aer).
3. **Operațiunea**: data, ora introducerii, ora ieșirii, durata, metoda („suflare cu aer și utilizare de pistoane absorbante”), configurația
   pistoanelor, presiunea, timpul de deplasare, numărul trecerii și trecerile anterioare (§2.3).
4. **Tabelul greutăților** — toți bureții, în ordinea din tren:

   | Piston-burete (ordinea în tren) | La intrare (kg) | La ieșire (kg) | Diferența (g) | Comparat cu pragul |
   |---|---|---|---|---|
   | 1 | … | … | … | informativ |
   | 2 — ultimul piston vehiculat | … | … | … | ≤ … g: DA |

   sub tabel: **„Criteriul de acceptare din caietul de sarcini: ultimul piston vehiculat iese uscat — DA.”** și, pe rând separat, **„Prag de
   lucru al operațiunii: … g/km × … m = … g.”**; cântarul / cântarele și diviziunea; corecțiile consemnate (§2.2).
5. **Vremea**: temperatura exterioară cu sursa ei, condițiile meteo (§8).
6. **Anexa foto**: lista și pozele (cântarul la intrare și la ieșire pe fiecare burete, configurația, manometrul, termometrul, ultimul piston).
7. **Textul de confirmare** (propunere, de validat de Juridic, §11 R4): „Părțile constată că operațiunea de uscare descrisă mai sus, efectuată
   prin suflare cu aer și vehicularea pistoanelor absorbante, pe tronsonul …, de la km … la km …, în lungime de … m, îndeplinește criteriul de
   acceptare din caietul de sarcini: ultimul piston vehiculat a ieșit uscat. Uscarea ultimului piston s-a verificat prin cântărire, față de
   pragul de lucru de mai sus, pe care părțile îl acceptă prin semnarea prezentului proces-verbal. Uscarea tronsonului se consideră efectuată.”
   Textul e versionat; PV-ul reține versiunea folosită.
8. **Semnăturile**:
   - **Antreprenorul**: nume, funcție, „semnat din platformă de persoana desemnată, autentificată, la ZZ.LL.AAAA HH:MM”, imaginea semnăturii
     dacă există (§5.3);
   - **Beneficiarul**: „Reprezentantul beneficiarului care a asistat: <nume>, <funcție>” (câmpul informativ, §6.1; gol = linii de completat) și,
     dedesubt, loc liber: „Nume, funcție și semnătura (persoana cu drept de semnătură)”.

În document nu apar nume de unelte, „generat automat” sau căi interne; autorul e Antreprenorul.

### 4.2 Numărul, exemplarele, forma

- **Numărul**: pe proiect, consecutiv, alocat de server la generare (lock pe proiect + `UNIQUE (proiect, nr)`, L01, L16), forma „U-007/2026”.
  Un PV invalidat își păstrează numărul; cel nou tipărește „înlocuiește PV nr. … (invalidat la …, motiv …)”.
- **Exemplare tipărite**: 2 (câte unul pentru fiecare parte).
- **Forma** (§11 R3): recomandarea e **un singur fișier**: PV-ul ca document principal, raportul pe modelul beneficiarului ca Anexa 1, pozele
  ca Anexa 2; codul documentului pe fiecare pagină, o singură semnătură olografă a beneficiarului.

### 4.3 Ce se îngheață la generare

PV-ul se generează **în același RPC** cu semnătura Antreprenorului (§5.2): un PV nesemnat de Antreprenor nu există.
- **Conținutul canonic** (JSON cu cheile ordonate) îl fixează **serverul**, nimic de la client: proiectul, nr., tronsonul, km-ii, lungimea,
  campania, trecerile, câmpurile operațiunii, cântăririle cu diferențele calculate de server, pragul aplicat și rezultatul, cântarele,
  corecțiile, vremea, lista pozelor (id, categorie, burete, cale, ora încărcării), versiunea textului, reprezentantul care a asistat, raportul
  (id, versiune, momentul închiderii), semnatarul (utilizator, nume și funcție copiate din listă, ora, amprenta imaginii).
- **Amprenta** = SHA-256 pe conținutul canonic, calculată în BD; **codul documentului** = primele 12 caractere.
- **PDF-ul** se generează în navigator doar din conținutul canonic (ca `uscarePdf.js` de azi). Serverul garantează conținutul și amprenta, nu
  paginile; o falsificare se descoperă regenerând PDF-ul din conținutul canonic.
- **Pozele** sunt nemodificabile prin aplicație (fără UPDATE / DELETE pe bucket); PV-ul le identifică prin cale și ora încărcării, fără amprentă
  pe fișiere (risc asumat, scris).

---

## 5. Semnătura Antreprenorului din ERP (D4)

### 5.1 Persoanele desemnate

Lista pe proiect (tabel nou): utilizatorul, numele și funcția **tipărite în PV**, cine l-a desemnat și când, `retras_la` / `retras_de`.
- O administrează owner-ul și managerul de proiect (D4). În Execuție nu există azi un câmp „manager de proiect” pe proiect: §11, R1.
- Persoana desemnată trebuie să aibă și **scriere** pe proiect; nivelul de admin singur **nu** dă dreptul de a semna. Identitatea vine doar din
  `auth.uid()` (L08); numele și funcția le ia serverul din listă, nu din formular. Retragerea nu atinge PV-urile deja semnate.
- Rubricile `semn_constructor_*` din raport rămân pentru tipărirea raportului pe hârtie; în PV contează doar semnatarul din listă.

### 5.2 Semnarea

După închiderea CONFORM, persoana desemnată vede conținutul PV-ului (tabelul, rezultatul, textul, codul documentului) și apasă „**Semnez PV-ul
pentru Antreprenor**”, cu bifa „am verificat datele”. Dacă cel care închide raportul e chiar persoana desemnată, ecranul trece direct la acest
pas — tot două confirmări explicite, două acte. Nimeni altcineva nu poate aplica semnătura, iar închiderea raportului nu o aplică automat.

Un singur RPC (L02): verifică dreptul (persoană din listă, neretrasă, cu scriere pe proiect), raportul `inchisa` + CONFORM + regula de la §3.4,
că nu există alt PV valabil pe raport; alocă numărul, fixează conținutul canonic și amprenta, scrie semnătura și jurnalul. Cheie UUID per
intenție (L04, L05); reluarea întoarce același PV.

### 5.3 Imaginea semnăturii (opțională)

Încărcată o dată de persoana însăși, PNG pe fond transparent, cel mult 200 KB, verificată după conținut, păstrată ca octeți în BD cu SHA-256; o
versiune nouă nu schimbă PV-urile semnate. Nu se citește direct (fără SELECT pentru clienți): ecranul o primește printr-un RPC, doar pentru un PV
pe care a fost aplicată și doar cu citire pe proiect. Fără imagine, PV-ul poartă doar mențiunea „semnat din platformă …”. Tabelă proprie
Execuție (fără dependență de Redări).

---

## 6. Exemplarul olograf și tronsonul confirmat uscat (D1)

### 6.1 Reprezentantul care a asistat

Câmp **informativ**, completat de echipă în etapa 2: numele și funcția reprezentantului beneficiarului care a asistat. Se folosesc rubricile
existente `semn_beneficiar_nume` / `semn_beneficiar_functie` ale raportului (nicio coloană nouă), copiate în conținutul canonic și tipărite la
rubrica beneficiarului (§4.1 pct. 8). Nu e o semnătură și nu dovedește cine a semnat; semnătura o pune pe hârtie persoana cu drept de semnătură.
Fără telefoane sau e-mailuri ale reprezentantului în ERP.

### 6.2 Urcarea scanului

După ce exemplarul semnat olograf se întoarce: orice membru al echipei cu scriere pe proiect urcă scanul / pozele lui (JPG / PNG / PDF, cel mult
6 fișiere, 10 MB în total, tipul verificat după conținut, SHA-256 calculat de server, **octeți în BD**: bucket-ul de azi primește doar JPEG, iar un
scan e adesea PDF), cu cheie UUID per intenție.

### 6.3 Verificarea de către om

Cine confirmă (§11 R6) vede scanul alături de PV-ul generat și bifează explicit, consemnat cu identitatea lui: toate paginile sunt prezente;
codul documentului și nr. PV-ului se citesc pe fiecare pagină; semnătura beneficiarului e la locul ei; niciun text schimbat vizibil. Opțional
notează cine a semnat, dacă e altă persoană decât cea tipărită. **Acceptă** → olograf confirmat = tronson confirmat uscat; **respinge** cu motiv
→ înapoi la „semnat de Antreprenor” (se poate urca alt scan).

**Riscul rămas, spus cinstit:** serverul nu citește scanul; legătura scan ↔ PV e verificarea vizuală a omului. O pagină schimbată, nevăzută la
confirmare, rămâne posibilă; se descoperă comparând scanul cu PV-ul regenerat din conținutul canonic (același cod al documentului).

### 6.4 Unde se vede „confirmat uscat”

Starea **nu se stochează**: e derivată din PV-urile `olograf_confirmat` neinvalidate (L19), printr-o vedere `security_invoker`, citită prin
cheia străină `proba_id` a raportului.
- **Lista rapoartelor**: eticheta PV-ului („PV U-007 — confirmat”, „așteaptă exemplarul semnat”, „scan de verificat”, „invalidat”).
- **Probe pe tronsoane** (lista și fișa): „Uscat confirmat — PV U-007 din 18.11.2026” sau „parțial: 3.200 m din 4.870 m”, cu golurile listate.
  Un tronson de probă e confirmat uscat într-o campanie când reuniunea intervalelor PV-urilor confirmate din acea campanie îi acoperă tot
  intervalul (o singură funcție pe intervale, SQL = JS).
- **Campania** (`dupa_apa` / `dupa_aer`, aleasă la crearea raportului; goală la cele vechi = „nedefinită”): caietul cere uscarea după proba cu apă
  și din nou după cea cu aer; fără ea, o uscare ar părea că le acoperă pe amândouă.
- **Etapa „uscare” din Probe** rămâne manuală: fișa arată starea derivată lângă ea și avertizează la nepotrivire; apoi un buton „Marchează etapa
  uscare făcută (PV U-007)” care cheamă RPC-ul existent al etapei, la confirmarea omului. Fără sincronizare prin trigger-e între module.

---

## 7. Stările PV-ului

Raportul **nu primește stări noi** (`deschisa` / `inchisa` / `anulata` rămân); se adaugă doar marcajul etapei 1. PV-ul e un obiect separat
(`UNIQUE` pe raport pentru PV-urile neinvalidate, L16):

| Din | În | Cine | Ce verifică serverul |
|---|---|---|---|
| — | `semnat_antreprenor` | persoana desemnată (§5.2) | raportul `inchisa`, CONFORM, regula §3.4, niciun alt PV valabil |
| `semnat_antreprenor` | `olograf_incarcat` | scriere pe proiect | fișierele (§6.2) |
| `olograf_incarcat` | `olograf_confirmat` | după R6 | confirmarea explicită (§6.3) |
| `olograf_incarcat` | `semnat_antreprenor` | după R6 | respingere, cu motiv |
| `semnat_antreprenor`, `olograf_incarcat` | `invalidat` | persoana desemnată / admin Execuție cu acces la proiect, cu motiv | — |
| `olograf_confirmat` | `invalidat` | după R6 (recomandat: doar owner-ul), cu motiv | — |
| orice stare neinvalidată | `invalidat` | **automat**, în aceeași tranzacție cu **redeschiderea raportului** | — |

- **Redeschiderea** unui raport cu PV: RPC-ul de azi (`fn_executie_uscare_stare`) invalidează PV-ul în aceeași tranzacție (L02), vizibil; nimic nu
  se șterge (conținutul canonic, semnătura și scanurile rămân, marcate „invalidat”). Reînchiderea cere un PV nou.
- **Concurența:** CAS pe versiunea PV-ului; aceeași ordine a lock-urilor pe toate căile (L06): cheia → raportul FOR UPDATE → numerotarea pe
  proiect (doar la generare) → PV-ul FOR UPDATE → jurnalul. Cel care pierde primește „PV-ul s-a schimbat între timp” și starea curentă.
- **Idempotența:** același spațiu de chei ca azi (jurnalul raportului); lista acțiunilor și funcția de amprentă a intenției se extind cu RPC-urile noi.

---

## 8. Vremea

Există deja (spec. §10): temperatura cu sursa ei (măsurată / din meteo, cu instantaneul construit de server), vremea, poza termometrului. În PV
e oficială **valoarea din raport, cu sursa scrisă**; dacă omul a măsurat și există și instantaneul meteo, a doua linie arată valoarea automată.
Nu se adaugă o a doua temperatură.

---

## 9. Accesul (D5)

Matricea Execuție de azi (spec. §8) rămâne; **niciun drept nou pe module**. Rolurile noi sunt liste pe proiect, în interiorul dreptului existent:

| Acțiune | Cine |
|---|---|
| Etapele, corecția consemnată, reprezentantul care a asistat, urcarea scanului | scriere pe proiect (ca salvarea de azi) |
| Schimbă pragul proiectului, administrează lista persoanelor desemnate | owner + managerul de proiect (D4; cine e „managerul” în Execuție: R1) |
| Semnează PV-ul pentru Antreprenor; își încarcă imaginea semnăturii | **doar** persoanele desemnate, cu scriere pe proiect |
| Confirmă / respinge scanul; invalidează un PV confirmat | R6 |
| Citește PV-urile și starea tronsoanelor | citire pe proiect |

Reprezentantul beneficiarului **nu primește nimic** (niciun cont, link sau acces). Toate scrierile: doar prin RPC-uri SECURITY DEFINER cu
`auth.uid()` obligatoriu și dreptul verificat pe proiectul fiecărui id atins (L07, L08, L09); niciun drept INSERT / UPDATE / DELETE pe tabele.

---

## 10. Schema și feliile (DOAR inventar)

O migrare **NOUĂ** peste `20261225a` (neschimbată, cu manifestul ei L15), numerotată la implementare după numele de pe toate branch-urile, cu
procedura de livrare existentă (amprenta globală L15 v2 cu diferențele declarate, plafonul și bugetul de lock ale runnerului, revenire în
`supabase/revenire/` cu verificarea stării exacte, proba PGlite cu mutanți, proba cu două sesiuni pe clonă). **Precondiție:** `20261225a`
aplicată pe producție. Fiecare felie: migrare proprie + revenire, PR propriu, review înainte de cererea de merge, paritate JS = SQL.

| Obiect | Nou / schimbat | Rolul | Felia |
|---|---|---|---|
| `executie_uscari` + coloane | ALTER | `doua_etape`, `etapa1_la` / `etapa1_de` (server), `etapa1_ora_declarata`, `cantar_intrare` / `cantar_iesire` (jsonb cu formă verificată), `corectie_intrare_motiv`, `plauzibilitate_confirmata`, `campanie`, `prag_aplicat` + `criteriu_rezultat` (server, la închidere), `motiv_nepotrivire` | S1 |
| `executie_uscare_praguri` | nou | istoricul pragului pe proiect, doar adăugare (§3.5) | S1 |
| `fn_executie_uscare_prag_curent` | nou | pragul în vigoare (implicit 100 g/km) | S1 |
| `fn_executie_uscare_criteriu` | nou | calculul pe ultimul burete (§3.1–3.4), paritate cu `criteriuUscare` | S1 |
| `fn_executie_uscare_etapa`, `fn_executie_uscare_prag` | noi (RPC) | încheie etapa 1 / scrie o versiune a pragului | S1 |
| `fn_executie_uscare_salveaza`, `_lipsa` / `lipsaDinRand`, `_garda` | schimbat | cheile noi, ordinea etapelor, corecția, regula de închidere | S1 |
| `fn_executie_uscare_stare` | schimbat | copiază pragul la închidere (S1); invalidează PV-ul la redeschidere (S2) | S1, S2 |
| `fn_executie_uscare_amprenta`, `_retrage`, CHECK-ul acțiunilor din jurnal | schimbat | acțiunile noi în același spațiu de chei | S1–S3 |
| `executie_uscare_semnatari`, `executie_uscare_semnatura_imagini`, `executie_uscare_texte_confirmare` | noi | lista persoanelor desemnate, imaginile, textele versionate | S2 |
| `executie_uscare_pv` | nou | nr., stare, versiune, conținutul canonic, amprenta, semnătura Antreprenorului | S2 |
| `fn_executie_uscare_pv_semneaza`, `_semnatar`, `_semnatura_imagine`, `_pv_invalideaza` | noi (RPC) | §5, §7 | S2 |
| `executie_uscare_pv_olograf` | nou | scanurile (octeți, tip, SHA-256), confirmarea / respingerea | S3 |
| `fn_executie_uscare_pv_olograf`, `_pv_olograf_decide` | noi (RPC) | §6.2–6.3 | S3 |
| `executie_v_uscare_tronsoane` | nou (vedere `security_invoker`) | starea derivată pe tronson și campanie (§6.4) | S3 |
| `UscareConducta.jsx`, `uscareLogica.js`, `uscareRaport.js` / `uscarePdf.js`; fișa din Probe pe tronsoane | schimbat | etapele, calculul, PV-ul, scanul; afișarea în Probe | S1–S3 |

| Felia | Ce aduce | Se poate folosi singură? | Estimare |
|---|---|---|---|
| **S1 — două etape + prag** | ecranul pe etape, „Închei etapa 1”, înghețarea intrării, cântarul, ordinea în tren, pragul de lucru pe proiect, calculul + regula de închidere, campania; în PDF-ul raportului un bloc „prag de lucru” | **da**: raportul se semnează pe hârtie, ca azi | 3–4 zile |
| **S2 — PV + semnătura Antreprenorului** | lista persoanelor desemnate, imaginea, textul, PV-ul (conținut canonic, amprentă, număr), semnarea din cont, PDF-ul, invalidarea la redeschidere | **da**: PV-ul se tipărește și se semnează olograf de beneficiar | 3–4 zile |
| **S3 — exemplarul olograf + tronson confirmat** | urcarea și verificarea scanului, starea derivată, afișarea în Probe | completează ciclul | 2 zile |

S1 cere R2; S2 cere R1, R3, R4 și numele persoanelor desemnate (R5); S3 cere R6.

---

## 11. Ce a rămas de decis

| # | Întrebarea | Variante | Recomandare |
|---|---|---|---|
| R1 | **Cine e „managerul de proiect” în Execuție** (administrează lista persoanelor desemnate și pragul; câmpul nu există azi) | A. administratorul Execuție cu acces la proiect · B. câmp nou „manager de proiect” pe proiect (schemă) · C. doar owner-ul | **A** (fără schemă nouă; owner-ul păstrează oricum dreptul) |
| R2 | **CONFORM când calculul „nu se poate calcula” / „de verificat”** (burete rămas, cântar diferit, pierdere mare de greutate) | A. refuz: se face altă trecere · B. permis, cu motiv tipărit în PV | **A** |
| R3 | **Forma documentului** | A. un fișier: PV + raportul ca Anexa 1 + pozele ca Anexa 2 · B. două documente (raportul semnat separat) | **A**; B doar dacă beneficiarul cere raportul semnat separat |
| R4 | **Textul de confirmare** (§4.1 pct. 7) | A. textul propus, cu propoziția „pe care părțile îl acceptă prin semnare” · B. fără propoziția de acceptare | **A** (face explicită acceptarea pragului de lucru); formularea finală o validează Juridicul |
| R5 | **Persoanele desemnate pe fiecare proiect** | 1–3 pe proiect (ex. responsabilul de contract, șeful de șantier, inginerul care conduce probele) | numele le dă proprietarul înainte de S2; e bine ca șeful de șantier să fie printre ele |
| R6 | **Cine confirmă scanul și cine poate anula un PV confirmat** | A. confirmă persoana desemnată sau administratorul Execuție cu acces la proiect (poate fi și cel care a urcat, consemnat); anularea unui PV confirmat (și redeschiderea raportului lui) doar owner-ul, cu motiv · B. ca A, dar cel care confirmă ≠ cel care a urcat | **A** (echipele sunt mici; separarea se poate cere mai târziu) |

**Propuneri implicite** (se aplică dacă proprietarul nu spune altfel): lungimea de referință = `lungime_m` din raport, cu avertisment dacă
diferă cu peste 2% de intervalul de km; trecerile nereușite se menționează în PV; campania pe raport; numărul „U-nnn/AAAA” pe proiect; 2
exemplare tipărite; Δ negativ de cel mult 2 diviziuni (sau 1%) = fără acumulare; confirmarea explicită la ieșire > 3 × intrare, Δ > 20 × prag
sau intrare < 0,1 kg; „cântar prea grosier” la diviziune > prag / 5; temperatura oficială = valoarea raportului cu sursa; rapoartele vechi (fără
două etape) nu primesc PV; dacă beneficiarul cere și semnătura de mână a Antreprenorului, persoana desemnată semnează olograf exemplarul
(nimic nu se schimbă în ERP).

**De la beneficiar nu e nevoie de nimic înainte** de implementare: pragul de lucru e acceptat prin semnarea PV-ului (§0). Dacă trimite în scris
altă valoare, ea intră ca versiune nouă a pragului proiectului.

---

## 12. Ce NU face treapta a doua

- Nu schimbă migrarea `20261225a` și nici manifestul ei.
- **Nu ia semnătura beneficiarului în aplicație** (nici semnătură trasă pe ecran, nici legătură personală pe dispozitivul lui); posibil ulterior,
  doar dacă beneficiarul o cere în scris.
- Nu trimite nimic (SMS, e-mail, notificare); PV-ul tipărit și scanul le mută oamenii. Nu dă cont, link sau acces reprezentantului.
- Nu are semnătură calificată, sigiliu sau marcă temporală calificată; integritatea e „nemodificabil prin aplicație” (administratorul BD și o
  restaurare din copie rămân în afara garanției).
- Nu citește kilogramele din pozele cântarului și nici scanul olograf (fără OCR, fără AI): cifrele le scrie omul, verificarea o face omul.
- Nu folosește ora din fișierul pozei ca dovadă; nu semnează offline.
- Nu pune prag pe punctul de rouă; nu ține mai multe treceri într-un raport.
- Nu sincronizează etapa „uscare” din Probe prin trigger-e; nu desenează harta intervalelor uscate.
- Nu generează PDF-ul pe server și nu calculează amprenta fotografiilor.
- Nu adaugă drepturi noi pe module.

---

## 13. Lecțiile (ce va conta la implementare)

| Regula | Unde contează |
|---|---|
| L01, L16 | numerotarea PV-urilor (lock pe proiect + `UNIQUE`), un singur PV neinvalidat pe raport, CAS pe versiunea PV-ului |
| L02 | generarea + semnătura Antreprenorului într-un RPC; invalidarea în aceeași tranzacție cu redeschiderea; scanul scris odată cu hash-ul |
| L04, L05 | cheie UUID per intenție pe toate RPC-urile noi, în spațiul de chei existent; „Renunț” prin intenție |
| L06 | ordinea cheia → raportul → numerotarea → PV-ul → jurnalul, aceeași pe semnare, scan, redeschidere |
| L07, L08, L09 | ordinea etapelor, înghețarea intrării și regula de închidere impuse de trigger; `etapa1_*`, pragul aplicat, semnatarul puse de server; dreptul verificat pe proiectul fiecărui id |
| L12 | nimic nu dispare tacit: toți bureții, corecțiile, pozele încărcate după introducere și trecerile anterioare apar în PV |
| L14, L15 | migrare nouă cu amprenta globală L15 v2 și diferențele declarate, revenire testată |
| L17 | grame întregi, comparație în întregi; ora declarată ≠ momentul înregistrării |
| L18 | „nu se poate calcula” ≠ „trece”; o eroare de citire a stării tronsonului = eroare, nu „neuscat” |
| L19 | calculul, plauzibilitatea, pragul în vigoare, acoperirea pe intervale și starea derivată = o singură definiție SQL, cu paritate JS |
| L20 | gărzile testate și pe căile legitime: corecția consemnată, NECONFORM cu motiv, PV invalidat, raport vechi fără etape |
| L23, L24, L25 | vederea pe tronsoane cu keyset; contextul capturat înaintea primului `await`; probe cu conturi non-owner (desemnat vs editor) și două sesiuni |
| L03, L10, L11, L13, L21, L22 | n/a (fără cache derivat, secrete, extragere din text, regex pe date externe sau apeluri AI) |

---

## 14. Istoric

- **17.11.2026, runda 1** — specificația treptei a doua (două etape, prag pe km, PV semnat de Antreprenor din ERP, semnătura reprezentantului
  în ERP sau olograf, tronson confirmat uscat); deciziile O1–O15 deschise.
- **17.11.2026, runda 2** — deciziile proprietarului D1–D5: semnătura beneficiarului doar olografă (scanul urcat + verificat de om); „trece” =
  doar ultimul piston-burete; pragul de lucru implicit 100 g/km, tipărit separat de criteriul caietului; semnătura Antreprenorului doar din
  contul persoanei desemnate; fără drepturi noi. Scoase: semnarea beneficiarului în aplicație, lista reprezentanților, regula „fiecare / suma”,
  „fără prag”. Rămân deschise R1–R6. Documentul s-a scurtat.
