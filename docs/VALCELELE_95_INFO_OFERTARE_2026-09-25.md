# Vâlcelele (licitația 95): informații pentru ofertare, 25.09.2026

Analiză READ-ONLY. Sursa: `ofertare_documente_atribuire` (docs 468–482, 494, 1276, 1277), `ofertare_clauze_contract` (id 30–64) și `ofertare_clarificari` (id 63). Nu s-a scris nimic în BD și nu s-a făcut niciun apel AI. Textele citate sunt date din documentație. Sunt copiate literal, cu diacriticele și greșelile originale.

Locator = `doc <id>` + secțiune/articol (+ poziția caracterului în `text_extras`, unde e utilă).

---

## 1. F3 / lista de cantități: **LIPSEȘTE din corpus (VERIFICAT)**

Am căutat în toate cele 17 documente (`nume_original`, `tip`, `text_extras`) termenii: `cantit`, `F3`, `formularul`, `deviz`, `C6`, `lista cuprinz`, `lista de pre`, `forfetar`.
- Nu există niciun document de tip listă de cantități, F3, C6 sau „deviz ofertă”. Singura apariție a „F3” e o notă generată de sistem în PL1 (doc 475): „verifică memoriul și F3”. Nu vine din documentația autorității.
- Doc 482 `DUAE_CERERE_380159.xml` și doc 494 `Caiet de sarcini.pdf` (părintele împărțit în 1276/1277) au `text_extras = NULL`. Doc 482 e DUAE, deci nu conține cantități.
- Documentația cere în schimb o **Listă de prețuri/Centralizator financiar**, cu decontare forfetară:
  - doc 479 (Fișa de date, ~poz. 67 681): „Anexa la Formularul de ofertă – Lista de prețuri/Centralizator financiar; Graficul general fizic și valoric de realizare a investiției publice”.
  - doc 1276 (CS p01, cap. 7, pag. ~25): „Decotarea lucrărilor se face în funcție de stadiul fizic realizat pentru categoria de lucrări inclusă în Lista de prețuri anexă a formularului de ofertă. […] în conformitate cu progresul fizic al contractului și cu încadrarea în sume forfetare.”
  - doc 481 (Secțiunea formulare): se termină la Formularul nr. 11 „Sursa materialelor”. Nu conține o listă de cantități.

**DE CONFIRMAT manual în SEAP (DF1280390):**
(a) Descarcă din nou toate fișierele din anunț, inclusiv anexele și eventualele arhive. Caută liste de cantități pe categorii/obiecte (F3), un deviz pe obiect sau un model de „Lista de prețuri/Centralizator”.
(b) Verifică secțiunea de clarificări și erate.
(c) Verifică dacă `Caiet de sarcini.pdf` (494) are anexe care nu au ajuns la noi.
Dacă lista nu există nici în SEAP, oferta e de tip **forfetar**. Cantitățile se estimează pe risc propriu din memoriu și planșe. În acest caz formulăm o clarificare prin care cerem listele de cantități sau confirmarea explicită că ele nu se pun la dispoziție.

---

## 2. GBE (garanția de bună execuție): roluri distincte

| Rol | Citat literal | Locator | Status |
|---|---|---|---|
| **Cuantum** | „Cuantumul garanției de buna execuție este de 10% din valoarea contractului fara TVA.” | doc 479, III.1.6.b (pag. 12) | VERIFICAT |
| Cuantum (contract) | „…in cuantum de 10% din valoarea contractului fara TVA in conformitate cu prevederile art. 39, alin (4) din HG 395/2016 […], respectiv .................lei.” | doc 480, art. „Garantia de buna executie a contractului”; clauza 30 | VERIFICAT (suma în lei se completează la semnare) |
| **Modalitate de constituire** | „a) virament bancar; b) instrumente de garantare […] scrisori de garanție […] ori asigurări de garanții […]; c) rețineri succesive din sumele datorate pentru facturi parțiale […] Suma inițială […] nu poate fi mai mică de 0,5% din prețul contractului, fără TVA; d) combinarea modalităților…” | doc 480, același articol (~poz. 53 500–54 300); clauza 32. Identic în doc 479, VI.3 (~poz. 79 526) | VERIFICAT |
| Rețineri: funcționare | „Achizitorul va alimenta contul de disponibil prin rețineri succesive din sumele datorate și cuvenite Executantului, până la concurența sumei stabilite drept garanție de bună execuție. […] Contul de disponibil este purtător de dobândă în favoarea E[xecutantului]” | doc 480 (~poz. 54 400) | VERIFICAT |
| **Termen de constituire** | fișa de date: „se constituie în termen de maxim 5 zile lucratoare de la data semnarii contractului public, termen ce poate fi prelungit pana la 15 zile (art. 39 alin. (3) din HG. 395/2016)”. Contractul: „…cel mai tarziu in termen de 5 zile de la data semnarii contractului.” | doc 479, VI.3 (~poz. 77 288); doc 480, clauza 31 | **DE CONFIRMAT**: fișa spune „zile lucrătoare”, prelungibile până la 15, iar contractul spune „5 zile”, fără calificare. Se aplică varianta mai strictă până la clarificare. |
| Condiție pentru începere | „Ordinul de incepere aferent Etapei 1 va fi emis de catre Achizitor numai dupa constituirea de catre Executant a Garantiei de Buna Executie…” | doc 480, art. 6; clauza 44 | VERIFICAT |
| **Eliberare** | „Autoritatea contractanta va elibera/restituii garantia de buna executie conform prevederilor art. 42 alin. (3) si (4) din HG nr. 395/2016” | doc 480 (~poz. 57 512) | VERIFICAT ca trimitere. Procentele de eliberare nu sunt scrise în contract: se aplică regula din HG. **DE CONFIRMAT** de ofertare/juridic (de regulă 70% la recepția la terminare și 30% la recepția finală, după cele 36 de luni). |

Consecință pentru cash-flow (PROPUNERE): cu reținerile succesive, depunerea inițială e de 0,5% din preț, iar restul până la 10% se reține din facturi. Scrisoarea de garanție bancară blochează 10% din prima zi.

---

## 3. Plată / penalități / ajustare / Etapa 2 / garanția lucrărilor (nimic nu e marcat ca validat)

**3.1 Termenul de plată**. Doc 480, art. 25.1 „Modalitati de plata” (clauzele 36, 37).
> „(2) Situatiile de plata partiale se confirma/infirma in termen de maxim 15 zile de la primire. […] (3) dupa confirmarea situatiilor de plata, executantul emite factura fiscala […] (4) Platile se efectueaza in termen de 30 de zile de la primirea facturii de catre Achizitor”

- *Interpretare:* ciclul este situație de plată → confirmare (≤15 zile) → factură → plată (30 de zile). Real, încasarea vine la ~45 de zile sau mai mult. Dacă situația e returnată cu observații, ciclul se reia.
- *Risc:* capital de lucru. Finanțarea e Anghel Saligny + buget local, iar plățile depind de tranșele de la MDLPA.
- *De confirmat:* modelul de cash-flow cu 45–60 de zile; cine suportă întârzierile tranșelor de finanțare.

**3.2 Penalitățile executantului**. Doc 480, „Sanctiuni pentru neindeplinirea culpabila a obligatiilor” (clauzele 33, 34).
> „…penalitati in cuantum de 0,1% pe zi, calculate prin raportare la valoarea fara TVA a etapei sau a partii de Contract afectate […] Pentru obligatiile care privesc Contractul in ansamblu, penalitatile se calculeaza prin raportare la Pretul total al Contractului, fara TVA.” și „orice intarziere imputabila Executantului da dreptul Achizitorului de a solicita penalitati in cuantum de 0,1% pentru fiecare zi de intarziere…”

- *Interpretare:* 0,1% pe zi, fără plafon. Baza de calcul e etapa/partea afectată, iar pentru obligațiile „de ansamblu” e prețul total.
- *Risc:* mare. Nu există plafon. Condițiile meteo previzibile nu justifică prelungirea termenului (clauza 55, art. 27.2 pct. 2). Termenul de execuție e de 12 luni.
- *De confirmat:* ce înseamnă concret „obligații care privesc Contractul în ansamblu”. Merită o clarificare pentru plafonarea penalităților.

**3.3 Penalitățile achizitorului**. Același articol (clauza 35).
> „In cazul in care Achizitorul nu onoreaza facturile, acceptate in prealabil la plata, in termen de 60 de zile de la expirarea perioadei convenite, atunci executantul este indreptatit sa solicite, ca penalitati, o suma echivalenta cu 0,1% din plata neefectuata […] Cuantumul penalitatilor nu poate depasi valoarea debitului restant.”

- *Interpretare:* penalitatea curge abia după 30 + 60 de zile. Sistarea lucrărilor e permisă tot după 60 de zile, cu notificare (clauza 38).
- *Risc:* asimetrie clară. Executantul plătește penalități din prima zi, achizitorul abia după 60 de zile. Legea 72/2013 poate fi invocată separat.
- *De confirmat:* juridic, dacă cerem în clarificări alinierea la Legea 72/2013.

**3.4 Ajustarea prețului**. Doc 479, II.3 (pag. 4–5); doc 480, art. 5.2–5.3 (clauzele 40–42).
> „An = av + m * Mn/Mo + f * Fn/Fo + e * En/Eo […] av = 0; […] m = 0,55; f = 0,25; e = 0,20; […] indicii curenți […] aplicabili la data cu 60 de zile înainte de ultima zi a lunii „n" […] Fo, Eo, Mo […] aplicabili la Data de Referință. […] Buletinele statistice lunare și de prețuri ale Institutului Național de Statistică”

- *Interpretare:* formula e polinomială, fără parte fixă neajustabilă (av = 0 înseamnă că nu există avans). Se ajustează doar lucrările executate și acceptate la plată (art. 5.2).
- *Risc:* (a) „Data de Referință” nu e definită în extras. (b) Nu sunt numiți indicii INS concreți pentru M, F și E. (c) Materialele cumpărate din timp nu se ajustează.
- *De confirmat:* ce înseamnă Data de Referință (termenul de depunere sau cu 28 de zile înainte?) și ce indici INS se folosesc. E candidat bun pentru clarificare.

**3.5 Condiția suspensivă pentru Etapa 2**. Doc 480, definiții lit. s (~poz. 7 662), art. 4, art. 6, „Modalitati de plata” (clauzele 39, 45, 61). Doc 479, II.2.4 și ~poz. 54 960.
> „…executarea lucrărilor aferente Etapei 2 poate începe numai după asigurarea sursei de finanțare și comunicarea scrisă a Achizitorului […] urmată de emiterea Ordinului distinct de începere” / „…nu se îndeplinește în termen de maximum 10 luni de la data semnării Contractului, Achizitorul va notifica Executantul…” / „Neîndeplinirea condiției suspensive […] nu conferă Executantului dreptul de a solicita […] despăgubiri, daune-interese, profit nerealizat…” / „Nu se vor efectua plati pentru lucrari aferente Etapei 2 executate anterior indeplinirii conditiei suspensive…”

- *Interpretare:* se ofertează prețul total (Etapa 1 + Etapa 2), dar doar Etapa 1 e contractată sigur. Etapa 2 poate cădea fără nicio compensație.
- *Risc:* evaluarea se face pe prețul total, deci o Etapă 2 ofertată ieftin poate câștiga licitația fără să fie executată vreodată. Costurile fixe nu trebuie mutate în Etapa 2.
- *De confirmat:* decizia go/no-go și repartizarea costurilor între etape.

**3.6 Garanția lucrărilor**. Doc 480, art. 6 (~poz. 13 963; clauza 47) și obligațiile executantului (clauza 48).
> „36 luni perioada de garantie a lucrarilor, de la data semnarii procesului verbal de receptie la terminarea lucrarilor pana la data semnarii procesului verbal de receptie finala.” + „…viciile ascunse […] 10 ani de la receptia lucrarii…”

- *Risc:* costuri de intervenție timp de 3 ani. Ultima parte din GBE se eliberează abia după recepția finală.
- *De confirmat:* dacă perioada de garanție e un factor de evaluare. Din fișa de date reiese că nu (vezi punctul 4).

---

## 4. Garanția de participare și criteriul de atribuire: **PROPUNERE** pentru `ofertare_licitatii`

**Garanția de participare**. Doc 479, III.1.6.a (pag. 11).
> „Ofertantul va constitui garanția de participare în cuantum de 370 000 lei în conformitate cu prevederile art. 154 din Legea 98/2016 […] În cazul viramentului bancar, viramentul se va face în contul RO71TREZ2015006XXX000189, deschis la Trezoreria Călărași, beneficiar UAT Vâlcelele, CUI 379683.”

- Forme de constituire. Doc 479, VI.3 (~poz. 77 288): „Garanţia de participare sau, după caz, garanţia de bună execuţie trebuie să fie irevocabilă, necondiţionată şi se constituie prin: a) virament bancar; b) instrumente de garantare […] scrisori de garanţie […]”.
- Valabilitate. Doc 479, IV (~poz. 74 318): „Oferta trebuie să fie valabilă pentru o perioadă de 4 luni de la termenul-limită de primire a Ofertelor […] Autoritatea contractantă poate solicita […] să prelungească perioada de valabilitate a Ofertei, precum și, după caz, a garanției de participare.” Nu am găsit o valabilitate separată a garanției. **DE CONFIRMAT** în SEAP. De regulă e egală cu valabilitatea ofertei (4 luni).
- **Atenție, DE CONFIRMAT:** CUI-ul din fișă e „379683”, dar la I.1 apare „3796837”. Probabil lipsește o cifră. IBAN-ul conține „XXX”, adică e mascat. Datele contului trebuie verificate în SEAP înainte de orice virament.

**Valoare propusă pentru `garantie_participare`:** `370.000 lei; virament (Trezoreria Călărași, cont UAT Vâlcelele, de verificat în SEAP) sau SGB/asigurare, irevocabilă și necondiționată; valabilitate ≥ 4 luni de la termenul-limită de depunere (= valabilitatea ofertei)`

**Criteriul de atribuire**. Doc 479, II.2.5 (pag. 2–3).
> „Cel mai bun raport calitate – pret” / „Pretul ofertei | Componenta financiara | 85% […] P(n) = (Pret minim ofertat / Pret n) x punctaj maxim alocat.” / „Prezentarea unei metodologii corespunzătoare […] (planul de management al calității lucrărilor de execuție) […] | 15% […] Calificativ: acceptabil/satisfăcător/parțial relevant - 5 […] bine/adecvat - 10 […] foarte bine/excepțional - 15 puncte”

**Valoare propusă pentru `criteriu`:** `Cel mai bun raport calitate-preț: Preț 85 p (P min/P n × 85); Plan de management al calității lucrărilor – execuție 15 p (calificative 5/10/15)`

Status: PROPUNERE. Nu s-a scris nimic în BD.

---

## 5. PL5 (doc 471): este necesară clarificarea automată `auto_planse_1` (id 63)?

Rezultatul citirii PL5: „40 zone citite, 0 tronsoane, lungime totală 0 m”. Planșa conține doar străzi (Erou Constantin Mușat, George Coșbuc, Ștefan cel Mare, Sălcâmului, Ion Creangă, Stejarului, Grănicerii…), traseul „Gmp”, cote de teren și simboluri fără etichete.

Datele există însă în alte documente:
- **Memoriul tehnic**, doc 468: „Material tubular – PEID 100 SDR 11 / Diametrul – Dn 200 la Dn 40 mm / Lungimea – L = 44,355 ml” și „…doua trepte de presiune […] executa in doua etape”.
- **Schema tehnologică**, doc 470 (tabelele „Dimensionare – Tronson retea de distributie”): „131 tronsoane, lungime totală 49565 m”, cu capetele tronsoanelor, lungimea și Dn pentru fiecare. Exemple: „SRMP -> UAT Cuza Voda-Limita: 5485 m, Dn 200 mm”, „SRS 2 Valcelele -> Libertatii: 15 m, Dn 125 mm”. Include tronsoane pe străzi din intravilan (de ex. Coșbuc apare în 470) și Floroaica. Străzile Mușat și Grănicerii din PL5 **nu** apar în textul extras din 470. Asta poate fi o problemă de citire a schemei sau o diferență reală. DE CONFIRMAT vizual.
- **Nota cu 54200 mp**: se află în **PL1 (doc 475)** și e repetată trunchiat în 471: „Lungimea totala a retelei de alimentare cu gaze naturale este de 54200mp, UAT Vlad Tepes = 3200 mp ; UAT Vilcelele 51000 mp”. Alături apare „suprafata aferenta retelei de gaze naturale este de 51000mp”. Probabil e o notă de urbanism: suprafața de teren ocupată, în mp, și nu lungimea conductei. „Lungimea … mp” e o greșeală de unitate în sursă.

Cifrele nu se corelează între ele: 44 355 ml (memoriu) ≠ 49 565 m (schemă, însumat de AI; include probabil transportul de la SRMP Grădiștea prin UAT-urile vecine) ≠ 54 200 „mp” (planșă). Acestea sunt trei mărimi diferite, iar niciuna nu e defalcată pe Etapa 1 și Etapa 2.

**Concluzie: clarificarea e necesară, dar TREBUIE REFORMULATĂ (PROPUNERE).**
- Varianta actuală cere, pentru PL1 și PL5, „lista tronsoanelor: lungime, Dn, material, SDR”. Acestea sunt date deja existente în 470 și în memoriu. Autoritatea poate răspunde doar cu „vezi schema tehnologică”, deci clarificarea în forma asta e în mare parte redundantă.
- Punctul 2 face trimitere la „poziția din lista de cantități (F3)”. O astfel de listă nu există în documentație (vezi punctul 1), deci trimiterea trebuie scoasă sau transformată în cererea listei.
- Reformulare propusă, cu întrebări pe care documentele nu le lămuresc:
  1. Lungimea totală a rețelei care se execută: 44 355 m (memoriu), 49 565 m (schema tehnologică, însumată) sau 54 200 (PL1, exprimată în „mp”)? Cum se împarte această lungime între Etapa 1 și Etapa 2?
  2. Nota din PL1 „Lungimea totala … 54200mp” se referă la suprafața de teren ocupată, sau e lungimea în m?
  3. Se pun la dispoziție liste de cantități (F3/C6) pe obiecte și etape, sau oferta e integral forfetară pe baza „Listei de prețuri/Centralizator”?
  4. Opțional: planșele PL1–PL5 în DWG/PDF vectorial, cu tronsoanele etichetate.

Nu este necesară o nouă citire plătită a planșelor. Datele pe tronsoane se pot lua din 470, iar corelarea cu străzile din PL5 se face vizual, de către om.

---

### Statusuri rezumat
- VERIFICAT: F3 lipsește din corpus; GBE 10%, 0,5% cu rețineri, eliberare conform HG 395 art. 42; termenul de plată 15 + 30 de zile; penalitățile de 0,1%; formula de ajustare; Etapa 2; garanția lucrărilor 36 de luni; garanția de participare 370.000 lei; criteriul 85/15.
- PROPUNERE: valorile pentru `garantie_participare` și `criteriu`; reformularea clarificării 63.
- DE CONFIRMAT: căutarea F3 în SEAP; termenul GBE (5 zile lucrătoare/15 față de 5 zile); CUI-ul și IBAN-ul pentru garanție; valabilitatea garanției; Data de Referință și indicii INS; procentele de eliberare a GBE; străzile din PL5 care lipsesc din 470.
