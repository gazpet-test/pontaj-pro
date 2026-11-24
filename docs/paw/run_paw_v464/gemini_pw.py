# gemini_pw.py - canal Gemini ("gem") pentru run_paw v4.6 (27.10.2026, aprobat de Razvan); v4.6.3: modelul Carbon; v4.6.6: Automat;
# v4.6.4: paza atasamentelor inainte de chatul nou.
# Playwright atasat la Edge-ul existent de pe serverul AI (CDP 9333, doar loopback, profil separat in care Razvan
# s-a logat o data pe gemini.google.com). Model: cgpt_pw.py. NU inchide Edge, NU da reload; navigare la /app sau URL de chat validat de lansator,
# NU ataseaza fisiere, NU scrie fisiere: brief-ul (citit ca DATE) intra in editor, raspunsul iese pe stdout.
# uz:  python gemini_pw.py stare                       (doar citire: tab, model, daca scrie)
#      python gemini_pw.py trimite <brief.md> [secunde_max=600]
# iesire: stdout UTF-8; la eroare ultima linie "GEM_EROARE <cod> <detaliu>" si exit 3.
# coduri: fara_tab_gemini, mai_multe_taburi_gemini, model_gresit, gemini_ocupat, editor_lipsa, editor_multiplu, text_neintrat,
#         ciorna_cu_atasamente, ciorna_necitibila, ciorna_necunoscuta, brief_invalid, timeout_raspuns, cdp_indisponibil,
#         eroare_playwright, comanda_necunoscuta, url_invalid
# r2 (16.10.2026, dupa Jakarinos r1): ciorna = brief-ul exact (normalizare explicita), refuz cu atasamente in ciorna,
#   limita de marime pe textul citit inainte de strip.
# v4.6.3 (13.11.2026, aprobat de Razvan): modelul cerut = Carbon (Argon a disparut din lista Gemini). Eticheta afisata trebuie sa fie
#   EXACT "Carbon", optional precedata de "Gemini" si / sau de numarul versiunii ("4 Carbon", "Gemini 4 Carbon"); orice sufix
#   ("Carbon Thinking") sau alt model = model_gresit, fara Enter. In lansator eticheta canalului ramane "argon" / "argon:<lucrare>"
#   (nume istoric; run_paw.ps1 nu se schimba in v4.6.3, deci certificarea cdx ramane valabila).
# v4.6.4 (19.11.2026, dupa testul de canal picat): in v4.6.3 trimite() deschidea chatul nou (pg.goto) INAINTE de prima
#   verificare a atasamentelor; chatul nou goleste ciorna, deci verificarea vedea 0 si brief-ul pleca. Acum ciorna tab-ului
#   curent se verifica INAINTE de orice actiune (navigare / click / tastatura), apoi din nou pe chatul nou si chiar inainte
#   de Enter. Numararea: un fisier = un element CHIP (cel mai exterior) in zona de compunere a editorului, citita din
#   page.content() si analizata in Python (testabila pe HTML sintetic); orice alt semn de atasament fara chip = refuz.
# v4.6.4 r2 (Jakarinos NO-GO pe 51b659c4): "0 chip-uri + 0 semne" NU mai inseamna ciorna goala. Ciorna goala se verifica
#   POZITIV: fiecare element si fiecare text din zona de compunere (in afara editorului) trebuie sa fie recunoscut - element
#   neutru fara eticheta / rol / actiune, structura stiuta a zonei, sau intrare din listele albe (CONTROALE_CUNOSCUTE,
#   STRUCTURA_CUNOSCUTA, TEXTE_CUNOSCUTE). Orice altceva (ex. <attachment-card>, img, buton "Remove ...", text "a.txt")
#   = GEM_EROARE ciorna_necunoscuta, exit 3. Listele albe se completeaza DOAR din calibrarea pe pagina reala (RUNBOOK,
#   pasul 0), nu din presupuneri: un refuz fals (operatorul goleste ciorna de mana / se completeaza lista) e preferat
#   unei trimiteri false.
# v4.6.4 r3 (21.11.2026, calibrarea de la pasul 0 pe pagina reala, Carbon, nimic atasat): listele albe contin EXACT semnaturile
#   afisate de `stare` in cele trei stari (chat nou gol / acelasi chat cu un cuvant in ciorna / chat existent gol), reuniune.
#   Textul de confidentialitate Google Workspace ("Chaturile gazpet.ro nu sunt folosite ...") era luat drept nume de fisier:
#   un cuvant care e EXACT un domeniu al firmei (DOMENII_FIRMA, lista inchisa) nu e fisier; "gazpet.ro.pdf", "a.gazpet.ro.docx",
#   "gazpet.rox" raman fisiere. Textele afisate de `stare` nu se mai taie la 40 de caractere (calibrarea cere textul intreg).
# v4.6.4 r4 (Jakarinos NO-GO pe d50dda4e, P1): o intrare din listele albe putea ascunde semne de atasament pe care semnatura nu le
#   arata (clase, data-*, atribute necunoscute: <gem-icon class="attachment-card" data-file-name="oferta.pdf">, <div class="..."
#   removeattachment="oferta.pdf">). Acum ORICE semnal de atasament purtat de un element (_semnal: eticheta, toate clasele, id-ul,
#   NUMELE si VALORILE tuturor atributelor, apoi textele si descendentii lui) se verifica INAINTEA oricarei acceptari - element
#   neutru, structura, lista alba, butonul modelului, editorul - si e refuz, oricare ar fi lista. De aceea un element cu cuvant
#   de atasament (token_...) nu mai poate fi trecut in STRUCTURA: intrarea `div{text-input-field simplified-input-area}` a fost
#   scoasa (sursa cuvantului "file" - un atribut al div-ului real - nu e cunoscuta; `stare` afiseaza acum si numele atributelor).
#   P2: textul integral al avertismentului Workspace (citit de chat pe 21.11.2026) e in TEXTE_CUNOSCUTE -> chatul existent trece.
# v4.6.4 r5 (Jakarinos NO-GO pe 86f6ff72, P1): nume.extensie se cauta acum in TOATE valorile unui element - clase, id, orice atribut,
#   URL-uri (href / src / srcset, si blob:) si style - nu doar in valorile "obisnuite" (r4 sarea clasele / id-ul, URL-urile si style).
#   Singura exceptie, inchisa si testata: intr-un `href` cu schema http(s) a carui gazda e EXACT un host Google (HREF_GAZDE_FARA_FISIER;
#   linkul calibrat "Confidentialitatea ta si Gemini" sta pe google.com), hostname-ul nu e fisier; restul URL-ului se verifica integral.
#   Orice alt URL (blob:, data:, alt host, src / srcset) si orice style se verifica ca text intreg: un nume.extensie = refuz.
#   token_file: sursa reala a cuvantului "file" pe div-ul editorului (citita de chat din pagina reala, 21.11.2026, doar citire) e NUMELE
#   atributului `xapfileselectordropzone` (marcajul zonei de drop al selectorului de fisiere, cu valoare GOALA), alaturi de
#   `_ngcontent-ng-c<numar>=""`, `class="text-input-field simplified-input-area"` si `jslog="303810;track:impression"`. Acceptat EXACT
#   atat (MARCAJE_GOALE_PERMISE): acel nume, doar cu valoare goala, doar pe div-ul cu exact acele doua clase; orice valoare nevida, alt
#   nume cu "file" (si cu prefix / sufix), alt tag sau alte clase = refuz in continuare. Nicio acceptare globala a lui "file".
# v4.6.4 r6 (Jakarinos NO-GO pe 807119f9, P1): ELEMENTUL ZONEI DE COMPUNERE INSESI (input-area-v2 sau zona exterioara gasita prin
#   ZONA_TAGURI / ZONA_CLASE) nu era verificat: _necunoscute() pornea de la copiii zonei, iar chip-urile si semnele se numarau doar pe
#   descendenti; <input-area-v2 data-file-name="oferta.docx"> (sau class / id / style cu nume de fisier, sau marcajul
#   xapfileselectordropzone pe zona) dadea 0 / 0 / 0 si brief-ul pleca. Acum zona e PRIMUL element verificat, cu aceleasi reguli ca
#   orice element (_motiv_element: media, fundal, _semnal pe eticheta / clase / id / numele si valorile tuturor atributelor / URL / style,
#   apoi structura - tagul zonei e in STRUCTURA_TAGURI, deci trece doar fara semnal), iar chip-urile / semnele se numara pe zona si
#   pe descendentii ei (_cu_descendenti). Zona nu devine niciodata "control" (textele din ea nu sunt eticheta ei). Marcajul
#   xapfileselectordropzone ramane permis DOAR pe div-ul structural exact (MARCAJE_GOALE_PERMISE), nu pe zona. Atributele reale ale zonei
#   (citite de chat din pagina, 21.11.2026, doar citire): _ngcontent-ng-c<nr>="" trace="" _nghost-ng-c<nr>="" class="ng-tns-c<nr>-4
#   ui-improvements-phase-1 with-toolbox-drawer input-box-shadow discovery-feed-the..." - fara semnal, deci trece. Celelalte niveluri
#   "parinte" (rich-textarea, invelisurile editorului, editorul) erau deja descendenti ai zonei si treceau prin _semnal (teste pastrate).
#   Linkul real de confidentialitate (chat existent): href="https://support.google.com/gemini/answer/14620100" - gazda Google, calea fara fisier.
# v4.6.4 r7 (Jakarinos NO-GO pe 0a8ab9a3, P1): EDITORUL INSUSI (div.ql-editor[contenteditable]) avea o cale separata (_motiv_editor):
#   trecea prin _semnal, dar verificarea media / fundal CSS (style cu "url(") se facea doar pe descendentii lui si in _motiv_element;
#   <div class="ql-editor" contenteditable="true" style="background: url(/resource/1234)"> dadea 0 / 0 / 0 si brief-ul pleca.
#   Ca sa nu mai existe niveluri cu reguli diferite: media si fundalul CSS au intrat IN _semnal, iar _semnal e SINGURA functie de semnale,
#   apelata dintr-un singur loc (_motiv_element) pentru ORICE element analizat - zona, invelisurile de incredere (input-container,
#   .input-area-container, fieldset, rich-textarea, textarea-wrapper / -inner, div-ul editorului), editorul, descendentii editorului si
#   descendentii zonei (neutri, structura, liste albe, butonul modelului). _motiv_editor a disparut: editorul si continutul lui trec prin
#   _motiv_element cu contextul in_editor (dupa semnal: in editor sunt tolerate doar etichetele de text EDITOR_TAGURI, textele brief-ului
#   se compara separat in verifica_ciorna). Motivele din editor: "semnal_in_editor:<semnal>" / "element_in_editor:<semnatura>".
# v4.6.4b / r8 (22.11.2026, dupa 5a PICAT pe v4.6.4 instalat, A03E2B5C): pagina Gemini s-a schimbat dupa calibrarea din 21.11. Pe un chat
#   NOU gol (Carbon, Esc + F5), `stare` a dat de doua ori aceleasi 3 necunoscute - toate SEMNALE (token_...), niciuna calibrabila prin liste:
#   (1) token_file:file-drop-indicator{data-filedrop-id} - indicatorul de drag & drop (vazut gol la 21.11, in STRUCTURA) poarta acum un atribut
#       `data-filedrop-id`; cuvantul "file" e in NUMELE lui (valoarea nu era afisata). Regula INCHISA in MARCAJE_PERMISE (fosta MARCAJE_GOALE_PERMISE,
#       acum cu forma valorii): acel nume, doar pe <file-drop-indicator> fara clase, doar cu valoare de IDENTIFICATOR ([A-Za-z0-9_-]{0,64}, deci
#       fara punct = fara nume.extensie); valoarea se verifica in continuare la cuvinte / nume de fisier ca orice alta valoare. Indicatorul nu e chip
#       (CHIP = uploader-file-preview), nu poarta nume de fisier (regex + nume.extensie), iar orice alt atribut, clasa, continut sau element = refuz.
#   (2) token_incarca:gem-icon-button[type=onsurface]{menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-butt} si
#   (3) semnal_in_editor:token_chip:div[role=textbox][aria-label=introdu o solicitare pentru gemini][contenteditable]{ql-editor ql-blank textarea
#       new-input-ui rich-query-formatting-enabled input-url}: cuvintele "incarca" si "chip" NU apar in partea afisata a lui {...} (taiata la 80 de
#       caractere, ambele exact la limita), iar "open" si "input-url" NU sunt cuvinte de atasament (nu sunt in TOKENI_ATAS; "url(" se cauta doar
#       in style) - elementele cu EXACT clasele afisate trec cu 0 necunoscute (teste). Sursa reala (o clasa / un atribut de dincolo de 80 de
#       caractere) nu se poate stabili din captura, deci NU se excepteaza nimic pentru ele (o exceptie ghicita = wildcard). Ca urmatorul 5a sa
#       dea sursa, `stare` afiseaza acum, sub fiecare `necunoscut` cu semnal, o linie `    sursa <fel>:<unde>=<valoare>` (fel = tag / style /
#       eticheta / clasa / id / nume_atribut / valoare_atribut), iar {...} se afiseaza intreg (pana la 400 de caractere). Nicio decizie nu depinde
#       de sursa afisata: ea vine din ACEEASI functie _semnal (al doilea element al rezultatului), nu dintr-o a doua cautare.
# v4.6.4b r2 / r9 (22.11.2026, PR #1168 runda 2): sursa EXACTA a celor 3 semnale, din atributele COMPLETE ale elementelor, citite de chat
#   prin CDP din pagina reala (doar citire, chat nou gol, Esc + F5; paw_v464_calibrare\atribute_complete_22_11.txt). Constatarea r8 (sursa
#   dincolo de caracterul 80) e confirmata; niciuna din cele trei nu e un fisier:
#   (1) <file-drop-indicator> are EXACT: clasele Angular `ng-tns-*` / `ng-star-inserted`, atributele `_ngcontent-*` / `_nghost-*` goale si
#       `data-filedrop-id="chat-window-input-container"`; fara text, fara copii. Regula din MARCAJE_PERMISE devine EXACTA: valoarea
#       `chat-window-input-container` (nu orice identificator) si elementul IZOLAT (niciun alt atribut in afara celor Angular goale si a
#       clasei cu doar `ng-*`, niciun copil, niciun text). Orice alta valoare / atribut / copil -> numele intra in cautare = semnal ca pana acum.
#   (2) butonul "+" (`gem-icon-button`) poarta atributul Angular `arialabel="Incarcare si instrumente"` (FARA cratima: nu e `aria-label` din
#       semnatura, ci o valoare oarecare de atribut, pasul 4) si `ariahaspopup="menu"`; cuvantul "incarca" e in valoarea lui. Exceptie EXACTA
#       (VALORI_PERMISE): pe `gem-icon-button`, atributul `arialabel` cu valoarea EXACT `incarcare si instrumente` (dupa _ascii, ca orice
#       eticheta din liste) SI `ariahaspopup` EXACT `menu` nu e semnal; alt tag / alta valoare / fara `ariahaspopup=menu` = semnal.
#   (3) editorul (`div.ql-editor[contenteditable]`) are clasele `input-url-linkification-enabled` si `inline-chips-enabled` (steaguri de
#       functionalitate); cuvantul "chip" e in a doua. Exceptie EXACTA (CLASE_EDITOR_PERMISE): pe EDITOR (_e_editor), aceste doua token-uri
#       de clasa, comparate INTREGI (nu subsir), nu intra in cautarea cuvintelor / numelor de fisier; `chip`, `file-chip`,
#       `inline-chips-enabled-x`, acelasi token pe alt element = semnal.
#   Toate trei stau in aceeasi functie _semnal (cate o exceptie pe element, prin ajutatoare pure apelate doar de acolo); afisarea sursei (r8)
#   ramane. Pe pagina reconstituita din atributele complete: 0 necunoscute, `paza ciorna: OK`; cu un chip real tot `ciorna_cu_atasamente`.
# v4.6.4c / r10 (22.11.2026, dupa 5g PICAT pe v4.6.4b instalat, 5B0CCD48): pe chatul NOU deschis de script, <file-drop-indicator> are, pe
#   langa atributele reale din r9, `style=""` (GOL; paw_v464_calibrare\atribute_5g_22_11.txt, citit de chat prin CDP, doar citire). Regula
#   `izolat` din r9 il refuza (orice alt atribut = semnal). Acum marcajul are al saselea camp, `goale`: atributele care pot sta pe elementul
#   izolat DOAR cu valoarea goala sau doar spatii albe HTML (spatiu, \t, \n, \r, \f - VALOARE_SPATII, fara NBSP / latime zero / \s Unicode);
#   pentru indicator = ("style",), pentru div-ul r5 = (). Orice `style` cu continut (url(, escape CSS, var(), nume de fisier,
#   `--uploader-height: 112px`, display:none) -> elementul nu mai e izolat -> numele `data-filedrop-id` intra in cautare = token_file, ca azi.
#   5e (style `--uploader-height: 112px;` ramas pe zona si pe editor dupa scoaterea manuala a fisierelor, pana la F5) ramane REFUZ (decizie
#   chat 22.11): nu se excepteaza nimic acolo - RUNBOOK: F5 inainte de trimitere.
# v4.6.4d / r11 (23.11.2026, refuz fals la un brief LUNG pe v4.6.4c instalat, 09E78891): cu ~10 KB de text in ciorna, Gemini extinde
#   caseta de compunere. Paza de inainte de Enter a dat `ciorna_necunoscuta` cu 2 linii (paw-data\out\juridic_43eb636364a95c9d.log):
#   (1) token_file:div{text-input-field height-expanded-past-single-line pre-fullscreen with-toolbox-drawer jslog xapfileselectordropzone}
#       - div-ul zonei de drop (marcajul r5 `xapfileselectordropzone=""`, GOL) are in starea extinsa ALTE clase: dispare
#       `simplified-input-area`, apar `height-expanded-past-single-line`, `pre-fullscreen` si `with-toolbox-drawer` (atributele complete,
#       citite de chat prin CDP cu textul in ciorna, NETRIMIS: paw_v464_calibrare\stare_text_lung_23_11.json). Marcajul nu mai cere o
#       singura multime de clase, ci una din lista INCHISA CLASE_DIV_DROP (multimi EXACTE, token intreg, fara cele generate `ng-*`);
#       orice alta clasa / token in plus / token lipsa / alt tag / valoare nevida = numele intra in cautare = token_file, ca pana acum.
#   (2) element:button[aria-label=extinde intrarea la ecran complet][aria-describedby] - butonul "Ecran complet" (`fullscreen-button`,
#       gemtooltip "Ecran complet") apare cu textul lung: fara semnal, trecut EXACT in CONTROALE_CUNOSCUTE (ca la calibrarea din 21.11).
#   Butonul de trimitere in starea `has-input submit` (cu `style=""`) era deja acceptat (structura + controlul calibrat) - testat.
# v4.6.4d / r12 (23.11.2026, Jakarinos NO-GO pe r11): (a) un control din CONTROALE_CUNOSCUTE transmite contextul lui descendentilor, iar
#   _motiv_text accepta in el orice text fara semnal (eticheta controlului) -> un <span>continut strain arbitrar</span> pus in butonul
#   "Ecran complet" ajungea la Enter. Butonul nou e un control cu text INCHIS (CONTROALE_TEXT_INCHIS): in el si in toti descendentii lui
#   e permis doar textul gol sau EXACT tooltip-ul vazut ("ecran complet", dupa _ascii); orice alt text = `text_in_control:` (refuz).
#   Iconita nu are text permis: numele ei nu e in captura (stare_text_lung_23_11.json are doar atributele butonului). Contextul inchis
#   nu poate fi inlocuit de un control / buton de model imbricat. Celelalte controale raman neschimbate. (b) CLASE_DIV_DROP = doar
#   cele 4 multimi cu baza vazuta (varianta B): cele 3 "simplified-input-area + token de inaltime" sunt scoase (presupunere contrazisa
#   de captura) si refuzate ca orice alta multime.
# v4.6.4d / r13 (23.11.2026, Jakarinos NO-GO pe r12): r12 inchidea doar NODURILE text; atributele cu text (gemtooltip, aria-label pe
#   butonul modelului, arialabel...) pe un element acceptat - sau pe un descendent neutru - treceau (3 reproduceri: 0 necunoscute, Enter).
#   Acum TOATE acceptarile din _motiv_element trec prin _acceptat: un atribut cu text (ATRIBUTE_TEXT + fragmente de nume + ng-reflect-* +
#   data-* cu text liber) e permis doar gol sau cu o valoare EXACTA din VALORI_TEXT_CUNOSCUTE (tag, atribut, forma), copiata din
#   capturile 21.11 / 22.11 / 23.11; altfel `atribut_text:` (refuz). Textul descrierilor (aria-describedby -> containerul CDK, in afara
#   zonei) se verifica dupa nume de fisier / cuvinte de atasament (`descriere_fisier:` / `descriere_atasament:`).
# v4.6.4d / r14 (23.11.2026, Jakarinos NO-GO pe r13): lista NEAGRA a atributelor cu text (nume + fragmente + data-* cu forma) lasa sa
#   treaca orice nume necunoscut (matbadge, ariavaluetext, data-text cu identificator) si orice text in tinta lui aria-describedby.
#   Decizia chat-ului: LISTA ALBA. Pe orice element ACCEPTAT din zona (zona insasi, controalele, descendentii lor, structura, editorul si
#   descendentii lui) fiecare atribut trebuie sa fie in ATRIBUTE_PERMISE: numele EXACT, pe tagul vazut, cu valoarea EXACTA din capturi
#   (sau forma exacta vazuta, pentru valorile tehnice care variaza: clase, jslog, style cu inaltimea ferestrei, identificatorii CDK /
#   ai meniului). Atributele generate de Angular (`_ngcontent-ng-c<n>` / `_nghost-ng-c<n>`) doar GOALE. Nume necunoscut pe tag =
#   `atribut_necunoscut:`, valoare necunoscuta = `atribut_valoare:` (refuz). Lista = reuniunea capturilor 21.11 / 22.11 / 23.11
#   (paw_v464_calibrare\stare_completa_23_11.json, stare_text_lung_23_11.json, atribute_complete_22_11.txt, atribute_5g_22_11.txt,
#   link_si_zona.txt, semnaturile din calibrarea 21.11). Tinta lui aria-describedby (oriunde in pagina): text EXACT din
#   DESCRIERI_CUNOSCUTE (cele 4 din `descrieri`, 23.11), elementul doar cu `id` (+ `role="tooltip"`), fara elemente in el; altfel
#   `descriere_text:` / `descriere_structura:` (refuz).
# v4.6.4d / r15 (23.11.2026, Jakarinos NO-GO pe r14): (1) `class` si `jslog` aveau forme largi (orice token / orice `track:...`), deci
#   `<span class="continut-strain-arbitrar">` si `jslog="123;track:continut_strain_arbitrar"` treceau. Acum `class` = fiecare token EXACT
#   din CLASE_PERMISE[tag] (vazut in capturi pe acel tag) sau generat Angular vazut (CLASE_GENERATE: `ng-tns-c<cifre>-<cifre>`,
#   `ng-star-inserted`, `ng-animating`); `jslog` = una din valorile vazute (JSLOG_VAZUTE) cu DOAR numarul variabil, iar cheia
#   BardVeMetadataKey (taiata in capturi) decodata si verificata pe structura vazuta (_meta_permisa). (2) Comparatiile cu listele
#   (valorile atributelor, textul descrierilor, textele permise, VALORI_PERMISE) se fac pe Unicode EXACT, fara _ascii: listele contin
#   sirurile reale din capturi (cu diacritice si U+21E7), ca escape-uri. `Ecr\u00e2n complet`, `Dicteaz\u0103 (^\u732bD)` (unde _ascii dadea
#   acelasi "?") si spatiile in plus / minus = refuz. _ascii ramane doar pentru cautarea cuvintelor / numelor de fisier si afisare.
# v4.6.4d / r16 (23.11.2026, Jakarinos NO-GO r15): si NODURILE TEXT pe lista alba. (1) Un control fara lista de texte accepta orice text
#   fara semnal (<span>continut strain arbitrar</span> in "Incarcare si instrumente" / "Trimite mesajul" ajungea la Enter). Acum ORICE nod
#   text din zona, in afara editorului, e permis DOAR daca e gol pe textul BRUT (doar spatiile albe HTML: spatiu, \t, \n, \r, \f) sau daca
#   perechea (loc, text) e EXACT in TEXTE_CUNOSCUTE: locul = controlul in care sta textul (semnatura lui, sau LOC_MODEL pentru butonul
#   modelului; contextul primului control ramane si sub controalele / butoanele de model imbricate), altfel cel mai apropiat stramos din
#   STRUCTURA_CUNOSCUTA din zona, altfel LOC_ZONA. Lista = textele vazute pe locul lor: "Carbon" in butonul modelului (singurul text propriu
#   din captura NETAIATA 23.11, toate cele 3 stari), textele linkului de confidentialitate si avertismentul Workspace (chat existent, 21.11).
#   Toate controalele au acum text inchis (CONTROALE_TEXT_INCHIS a disparut); butonul "Ecran complet" nu mai are niciun text permis (in
#   captura netaiata nu are niciun nod text: tooltip-ul sta in atributul gemtooltip si in descrierea CDK, in afara zonei). (2) Ligaturile
#   mat-icon: RE_LIGATURA (regex) scos; LIGATURI_VAZUTE = lista inchisa a ligaturilor vazute = GOALA (in captura netaiata toate iconitele
#   au text gol, numele sta in fonticon / data-mat-icon-name). (3) Golul se decide pe textul BRUT: _ascii nu mai decide nimic in _motiv_text
#   (U+0301, U+200B, NBSP, U+2060, U+FEFF = text nevid -> refuz; afisarea lor in escape-uri). Cheia BardVeMetadataKey citita intreaga:
#   butonul de trimitere are 35 de elemente, cu [34] = [0] (nevazut cat era taiata) -> pozitia 34 = [<cifre>], META_LUNGIME = 35 (vazut).
# v4.6.4d / r17 (23.11.2026, Jakarinos NO-GO r16): (1) exceptia de text a editorului (contextul in_editor: textul nu e "necunoscut", se
#   compara cu brief-ul) acoperea ORICE contenteditable="true" de sub rich-textarea - si div.ql-clipboard, al carui text nu era comparat
#   cu nimic (comparatia citea doar primul editor): <div class="ql-clipboard" contenteditable="true" tabindex="-1">continut strain
#   arbitrar</div> (si contract.pdf, U+0301, U+200B) sau un al doilea element editabil langa editor ajungeau la Enter. Acum EDITORUL
#   PRINCIPAL e unul singur si e EXACT elementul comparat: rich-textarea > div[role="textbox"][contenteditable="true"] (EDITOR in CSS =
#   _e_editor in Python), unic in HTML (altfel ciorna_necitibila) si unic la locator (altfel editor_multiplu), citit de verifica_ciorna.
#   div.ql-clipboard e permis DOAR gol (niciun copil, nici spatii) si cu atributele EXACTE din capturi (_e_clipboard); orice alt element
#   cu atributul contenteditable (al doilea editor, clipboard cu text sau cu alte atribute, contenteditable pe alt nod, in editor sau
#   in zona) = semnal `editabil:` (_semnal, pasul 5). (2) Comparatia cu brief-ul nu mai elimina in tacere U+200B / U+200C / U+200D /
#   U+2060 / U+FEFF si nu mai inlocuieste NBSP: un caracter invizibil prezent in editor si absent din brief = text_neintrat. Ramane doar
#   comprimarea spatiilor albe HTML, necesara pentru randarea reala Quill (normalizeaza: <p> pe linie -> inner_text cu \n in plus).
# v4.6.4d / r18 (23.11.2026, Jakarinos NO-GO r7): (1) script / style / template / noscript erau sarite cu tot subarborele (NEVIZIBILE),
#   si in editor: <style contenteditable="true">continut strain arbitrar</style> dadea 0 necunoscute, iar un <style> care ascundea un
#   <span> strain din editor lasa inner_text() egal cu brief-ul. Acum NICIO eticheta nu se sare (doar chip-urile / semnele, numarate si
#   refuzate separat): cele patru sunt elemente ca oricare, fara loc in liste -> refuz. Textul editorului se citeste din HTML-ul BRUT
#   (_text_editor: textContent, forma Quill - doar <p> in editor, in <p> doar text sau exact un <br>), nu din inner_text(), deci nu mai
#   depinde de CSS; in editor sunt permise doar p / br FARA niciun atribut (EDITOR_TAGURI), restul = element_in_editor:. (2) Ultima paza
#   citea textul cu ed.inner_text() INAINTE de page.content() si excludea din HTML tot ce era in editor -> un text adaugat intre cele
#   doua citiri pleca. Acum _ultima_paza: UN SINGUR page.content(), din care se deriva textul comparat, editorul unic, atasamentele si
#   necunoscutele (inainte doar doua citiri prin locator care pot doar refuza); Enter imediat dupa.
# v4.6.4d / r19 (23.11.2026, Jakarinos NO-GO r8): page.content() nu serializeaza shadow DOM-ul -> un shadow root dintr-un div permis al
#   zonei putea purta <div contenteditable="true"><p>continut strain arbitrar</p></div> nevazut de analiza (0 editoare in plus, 0
#   necunoscute, Enter). Acum instantaneul (_instantaneu) = UN SINGUR pg.evaluate care intoarce HTML-ul SI numarul de shadow root-uri
#   deschise (pagina / zona) si de elemente custom inregistrate (zona); orice shadow root sau custom in zona = refuz (verifica_fara_umbre),
#   in ultima paza, in paza dinaintea chatului nou / pe chatul nou si in `stare`. Nicio citire page.content() nu mai exista in cod.
# v4.6.4d / r20 (23.11.2026, Jakarinos NO-GO r9): un shadow root INCHIS pe o eticheta standard (div) nu se vede din JavaScript-ul paginii
#   (el.shadowRoot = null), deci evaluate-ul r19 dadea 0 si brief-ul pleca. Decizia chat-ului: instantaneul = UN SINGUR apel CDP
#   DOM.getDocument({depth: -1, pierce: true}) (sesiune pg.context.new_cdp_session(pg), DOM.enable cu includeWhitespace "all" inainte,
#   altfel nodurile text din doar spatii lipsesc). Din el se deriva TOT: arborele analizat (_arbore_cdp construieste aceleasi _Nod ca
#   parserul HTML: taguri, atribute, noduri text, continutul template-urilor), textul editorului, atasamentele, necunoscutele si
#   numararea shadow root-urilor DIN ACELASI raspuns: orice shadow root open / closed / de alt tip, oriunde (si imbricat, si in
#   documentele iframe-urilor) = refuz; user-agent (input / img / video...) doar in afara zonei (pagina reala: unul, pe un img din
#   istoric); un text trunchiat de CDP (> 10000 de caractere) in zona = refuz. CDP indisponibil / forma neasteptata = refuz (nu exista o
#   cale mai slaba). Verificarea r19 din evaluate ramane, ca citire anterioara care poate DOAR refuza (fara HTML).
# v4.6.4d / r21 (23.11.2026, Jakarinos NO-GO r10 + recalibrarea pe pagina de azi): (1) trunchierea CDP si limita liniilor brief-ului se
#   masoara in UNITATI UTF-16, ca Chromium (_u16 / _taiat_cdp): un emoji = 2 unitati, deci un text real de peste 10000 de unitati putea
#   veni ca 10000 de puncte de cod + U+2026 = exact brief-ul (len() din r20 nu-l vedea). (2) Pagina Gemini s-a schimbat: pe chatul nou de
#   azi `stare` dadea 10 necunoscute (refuz fals). Listele albe primesc EXACT atributele / valorile / clasele vazute in capturile de azi
#   (z23s: gol / scurt / mediu / lung, Edge 9333, doar citire + textele 5g2-a scrise fara Enter si golite imediat): zona exterioara
#   input-container, back-to-bottom-fab, span[role=status], div.input-area-container, hallucination-disclaimer. Niciun element / text nou.
# v4.6.4e (23.11.2026 seara, refuz fals la testul de canal pe v4.6.4d instalat, 50332B12): dupa F5, cu ciorna goala, pe chatul nou
#   (Carbon) `stare` dadea 3 necunoscute. Captura acestei variante de pagina (f5 = paw_v464_calibrare\stare_completa_23_11_varianta_f5.json,
#   chat, doar citire, gol / mediu / lung, ciorna golita) are fata de capturile 23.11 (c23 / c23n / t23 / z23s) EXACT trei diferente
#   negenerate: `style=""` (GOL) pe simplified-input-menu si pe speech-dictation-mic-button (toate starile) si token-ul de clasa
#   `ng-pristine` pe rich-textarea (doar starea gol: campul Angular inca neatins; dupa scriere devine `ng-dirty`, deja vazut). Token-urile
#   `enterprise` / `simplified-input` din aceeasi linie erau deja pe lista (c23). Lista alba primeste EXACT atat: style doar GOL si doar pe
#   cele doua taguri, ng-pristine doar pe rich-textarea. Niciun element, text, descriere sau alt atribut nou.
# v4.6.4f (23.11.2026 seara, refuz fals la testul de canal pe v4.6.4e instalat, 4132781B): dupa F5 repetat (6 reincarcari) `stare` a dat
#   ALEATOR `atribut_necunoscut:<tag>{style}` pe auto-suggest / back-to-bottom-fab / hallucination-disclaimer, toate cu `style=""` (GOL):
#   Angular lasa atributul gol dupa animatii, pe orice element animat, deci lista pe taguri nu se inchide. Regula generala (_style_gol):
#   `style` cu valoarea EXACT sirul vid e permis pe ORICE element care e deja acceptat (aceleasi liste albe de taguri / controale /
#   structura / neutre, aceleasi semnale inainte). Nu acopera: style cu spatii sau cu orice continut (ramane pe formele exacte de pe tag,
#   altfel refuz ca inainte), un element neacceptat (refuzat inainte de atribute), <p> / <br> din editor (FARA niciun atribut, neschimbat),
#   div.ql-clipboard (atributele EXACT CLIPBOARD_ATRIBUTE, neschimbat). Nicio alta relaxare.
# v4.6.5 (23.11.2026 seara, decizia lui Razvan: varianta B, risc acceptat de owner): lista alba STRICTA pe toata zona casetei (r2-r21,
#   v4.6.4e / f) se rupea la fiecare schimbare cosmetica a paginii Gemini (clase, `style=""`, placeholder) -> refuz fals + runda noua.
#   Acum paza STRICTA ramane doar pe ce PLEACA si pe ce poate pleca:
#   BLOCHEAZA (refuz, ca pana acum): (1) editorul principal unic, textul lui din instantaneu = EXACT brief-ul, in el doar p / br fara
#   atribute (regulile Quill), niciun alt element editabil - contenteditable in zona (in afara editorului si a clipboard-ului gol) SAU
#   oriunde in pagina cu valoare editabila (orice in afara de "false"), plus textarea / input / select in zona (EDITABILE_TAGURI) -,
#   div.ql-clipboard doar GOL; (2) atasamente: toate detectoarele existente (chip-uri, semne ATAS, locatori, media, fundal CSS, cuvinte de
#   atasament / nume.extensie in etichete, clase, id, numele si valorile atributelor, texte si descrieri - lista neagra ramane strat
#   suplimentar); (3) shadow root non-user-agent oriunde, CDP indisponibil, text trunchiat CDP in zona; (4) modelul cerut, pagina nu
#   genereaza.
#   NU MAI BLOCHEAZA (AVERTISMENT, scris in `stare` si in log ca `avertisment necunoscut <motiv>` + linia `sursa`): decorul - motivele
#   din lista INCHISA MOTIVE_AVERTISMENT (element:, text:, text_in_control:, atribut_necunoscut:, atribut_valoare:, descriere_text:,
#   descriere_structura:), adica taguri / atribute / clase / texte / descrieri necunoscute care NU poarta semne de atasament (_semnal,
#   verificat inaintea oricarei clasificari) si nu sunt editabile. Orice alt motiv (si orice motiv nou, nescris in lista) = refuz
#   (fail-closed). Atributele EDITORULUI insusi (ex. data-placeholder schimbat) sunt decor (avertisment); copiii lui raman stricti.
#   Clipboard-ul Quill = div cu clasa ql-clipboard (fara alte clase negenerate), contenteditable="true", FARA niciun copil, unic langa
#   editorul unic; celelalte atribute ale lui sunt decor. Listele albe raman, doar ca sa reduca zgomotul din avertismente. Descrierea
#   (aria-describedby) se verifica si pe elementele cu avertisment (nume de fisier / cuvant de atasament in ea = refuz).
#   Mesajul trimis = doar textul editorului (comparat cu brief-ul); textul decorului nu intra in el (teste).
# v4.6.5 r2 (23.11.2026 noaptea, Jakarinos NO-GO P1 pe #1176 + testul de canal real pe v4.6.4f): (1) _motiv_descriere parcurge TOATE
#   referintele (aria-describedby SI aria-labelledby, fiecare id, fiecare tinta) si toate motivele fiecarei tinte; un motiv BLOCANT castiga
#   intotdeauna asupra unui avertisment, indiferent de ordinea id-urilor (`d1 d2` = `d2 d1`). Semnalele de atasament PE tinta si IN ea
#   (_semnal: <img>, blob:, cuvinte in clase / atribute) = `descriere_semnal:` (refuz; pana la r1 = descriere_structura, decor). Celelalte
#   functii care dau avertismente nu au acest tipar: _atribut_strain / _acceptat dau doar avertismente (semnalele tuturor atributelor sunt
#   verificate inainte, de _semnal), _motiv_text cauta fisier / cuvant inaintea listei, _necunoscute si analizeaza_arbore aduna toate
#   motivele, iar decizia citeste `blocante` din lista completa (nu din detaliile taiate la 60). (2) Testul de canal pe v4.6.4f (strict) a
#   refuzat: `semnal_in_editor:atribut_valoare:...{data-placeholder}` dupa focus pe editor (placeholder schimbat) si, dupa schimbarea
#   modelului, `atribut_valoare:span{class}` (clase de animatie) + eticheta / textul butonului de model ("4 Hydrogen"). Pe v4.6.5 toate
#   sunt decor (avertisment): atributele editorului insusi (r1), atributele / textele butonului de model; modelul ramane verificat separat
#   (verifica_model -> `model_gresit`, blocant, inaintea oricarei scrieri). Continutul editorului ramane strict. Nicio alta schimbare.
# v4.6.6 (24.11.2026, decizia lui Razvan: Carbon raspunde prea greu): modelul cerut = "Automat" (modul Auto; pe pagina reala butonul
#   are aria-label "Deschide selectorul de moduri, momentan Automat" si textul propriu "Automat"). Forma acceptata: [Gemini ]Automat, fara
#   versiune numerica; orice alt model ("Carbon", "4 Carbon", "4 Hydrogen") sau sufix = model_gresit, blocant, ca inainte. Listele albe
#   de decor ale butonului de model (eticheta, textul pe LOC_MODEL) = valorile cu "Automat" (doar zgomot mai putin in avertismente).
#   Paza pe ce pleaca (ciorna, atasamente, editor) neatinsa.
# Lansatorul (run_paw.ps1) tine lock-ul global gem, verifica CDP pe loopback si scrie markerul PAW_GATA / PAW_EROARE.
# ASCII only.
import sys, time, os, re, unicodedata, base64, json
from urllib.parse import urlparse
from html.parser import HTMLParser

CDP = "http://127.0.0.1:9333"
GAZDA = "gemini.google.com"
# r17: editorul PRINCIPAL (unic), aceeasi regula ca _e_editor; ql-clipboard (fara role) si orice alt contenteditable nu se potrivesc
EDITOR = 'rich-textarea > div[role="textbox"][contenteditable="true"]'
# r17: div.ql-clipboard EXACT cum apare in capturile cu atribute complete (c23n gol / mediu / lung; la 21.11 `stare` arata doar
# "editor: 2", fara atribute): aceste atribute si niciun altul
CLIPBOARD_ATRIBUTE = {"class": "ql-clipboard", "contenteditable": "true", "tabindex": "-1"}
RASPUNS = "message-content"
MODEL = '[data-test-id="bard-mode-menu-button"]'
STOP = 'button[aria-label*="Stop" i]:visible, button[aria-label*="Opre" i]:visible'
ZONA = 'input-area-v2, input-container, .input-area-container, .input-area'       # zona de compunere
ATAS = ('uploader-file-preview, uploader-file-preview-container, file-preview, [data-test-id*="file-preview"], '
        '[data-test-id*="uploaded-file"], [class*="file-preview"]')                # SEMNE de atasament (largi, se suprapun)
# v4.6.4 - selectorul UNIC care numara: elementul Angular <uploader-file-preview> = chip-ul unui fisier pus in ciorna
#   (zona de compunere; raspunsurile si mesajele trimise nu il folosesc). Se numara doar chip-urile cele mai exterioare
#   (un chip imbricat in alt chip = acelasi fisier). ATAS de mai sus nu mai numara, e doar semn: in v4.6.3 suma
#   ZONA>>ATAS + chip-uri globale numara acelasi fisier de mai multe ori (container + chip + clasele interioare
#   *file-preview* + inca o data chip-ul global), de aici "5" pentru un fisier.
CHIP = "uploader-file-preview"
ZONA_TAGURI = ("input-area-v2", "input-container")          # aceeasi lista ca ZONA, pentru analiza HTML in Python
ZONA_CLASE = ("input-area-container", "input-area")
SEMN_TAGURI = ("uploader-file-preview", "uploader-file-preview-container", "file-preview")
SEMN_DATA_TEST = ("file-preview", "uploaded-file")
SEMN_CLASA = "file-preview"
VOIDE = ("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr")
# --- v4.6.4 r2: structura RECUNOSCUTA a ciornei goale (verificare pozitiva; orice alt element / text = ciorna_necunoscuta) ---
# elemente fara continut propriu: trec doar FARA eticheta / rol / actiune (vezi _semnificativ) si fara cuvinte de atasament
NEUTRE = ("div", "span", "p", "br", "mat-icon", "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon",
          "ellipse", "defs", "clippath", "lineargradient", "radialgradient", "stop", "mask", "use", "symbol")
STRUCTURA_TAGURI = ZONA_TAGURI + ("rich-textarea",)       # zona si invelisul editorului (aceleasi nume ca selectorii)
# r18 (Jakarinos NO-GO r7): NICIO eticheta nu mai e sarita in zona (script / style / template / noscript erau "nevizibile" si se
# sareau cu tot subarborele, si in editor): ele trec prin _motiv_element ca orice element si nu sunt in nicio lista alba -> refuz
MEDIA = ("img", "picture", "video", "audio", "canvas", "object", "embed", "iframe", "image", "source", "track")
# v4.6.5: controalele de formular editabile (nu contenteditable) - in zona = semnal `editabil:` (refuz), ca orice element editabil in plus.
# Pagina reala (toate capturile 21.11 - 23.11) nu are niciunul in zona; input[type=file] era deja refuzat (eticheta `type=file`).
EDITABILE_TAGURI = ("textarea", "input", "select")
# v4.6.5 (varianta B): motivele care NU blocheaza (decorul) - lista INCHISA de prefixe EXACTE (cu ":"), comparate pe inceputul motivului.
# Toate sunt motive fara semnal de atasament: _semnal (media, fundal, eticheta, token_*, atribut_fisier, editabil) e verificat inaintea
# oricarei acceptari, iar motivele textelor cu nume de fisier / cuvinte de atasament au prefixe proprii (text_fisier:, text_atasament:,
# descriere_fisier:, descriere_atasament:; r2: descriere_semnal:). Tot ce poarta prefixul editorului (semnal_in_editor:, element_in_editor:, editor_structura:)
# si text_trunchiat_cdp: blocheaza. Orice motiv care nu incepe cu una din intrari = refuz (fail-closed).
MOTIVE_AVERTISMENT = ("element:", "text:", "text_in_control:", "atribut_necunoscut:", "atribut_valoare:", "descriere_text:",
                      "descriere_structura:")
# v4.6.5: ce prindea lista alba STRICTA si acum ar fi doar decor, mutat in _semnal (refuz): (a) cuvant de atasament in NUMELE TAGULUI
# (<attachment-card>, <gem-file-chip>: pana la v4.6.4f = `element:`, refuzat de lista); singura exceptie, INCHISA, e tagul real
# <file-drop-indicator> (tinta de drag & drop, mereu in DOM) si doar GOL (niciun copil in afara textelor din spatii albe HTML) - atributele
# lui trec in continuare prin semnale (marcajul data-filedrop-id, MARCAJE_PERMISE); (b) URL local de fisier (blob: / filesystem: / data:,
# schema la inceput de cuvant) in VALOAREA oricarui atribut, si in etichete (pana la v4.6.4f: `atribut_necunoscut:` / `atribut_valoare:`).
TAGURI_CU_CUVANT_PERMISE = ("file-drop-indicator",)
RE_URL_LOCAL = re.compile(r"(?<![a-z0-9+.-])(?:blob|filesystem|data):")
# r18: in editor intra DOAR ce produce Quill pentru textul brief-ului: <p> pe linie, <br> singur intr-un <p> (linia goala), FARA niciun
# atribut (_motiv_element) si in forma de mai jos (_text_editor); orice alta eticheta (span, div, b, code, a, style...) = element_in_editor:
EDITOR_TAGURI = ("p", "br")
# atribute care fac un element "semnificativ" (eticheta, rol, actiune): elementul trebuie sa fie in listele albe
SEMN_ATR_VALOARE = ("role", "aria-label", "data-test-id", "data-testid", "type", "name", "title", "alt", "placeholder",
                    "mattooltip", "data-tooltip")              # in semnatura cu valoare
SEMN_ATR_CHEIE = ("tabindex", "jsaction", "onclick", "href", "src", "srcset", "draggable", "contenteditable",
                  "aria-labelledby", "aria-describedby", "aria-description", "aria-roledescription")  # doar cheia
ROLURI_NEUTRE = ("presentation", "none")
ICON_TAGURI = ("mat-icon", "svg")                             # role="img" pe o iconita (Angular Material) = neutru
# cuvinte de atasament (ASCII, litere mici, dupa scoaterea diacriticelor): in clasa / id / atributele data-* ale unui element
# neutru sau in ligatura unei iconite (in afara unui control recunoscut) = nerecunoscut
TOKENI_ATAS = ("file", "fisier", "attach", "atasa", "upload", "incarca", "remove", "elimin", "sterge", "delete",
               "preview", "previz", "thumb", "miniatur", "document", "image", "imagin", "photo", "poza", "media", "chip",
               "card", "pdf")
TOKENI_ELIMINA = ("remove", "elimin", "terge", "delete")     # eticheta unui buton de scoatere ("terge" = sterge cu / fara diacritice)
# r4: eticheta unui element (atributele cu valoare din semnatura: aria-label, title, alt, type, data-test-id...) poate contine DOAR
# cuvintele de incarcare ("upload" / "incarca": butonul calibrat "Incarcare si instrumente" deschide meniul; eticheta lui e comparata
# EXACT cu lista); orice alt cuvant de atasament (file, attach, remove, preview, thumb, card, chip, pdf...) sau un nume.extensie in
# eticheta = refuz, oricare ar fi lista alba ("eticheta:"). "terge" = sterge cu / fara diacritice (ca in TOKENI_ELIMINA).
TOKENI_ETICHETA_PERMISE = ("upload", "incarca")
TOKENI_ETICHETA_INTERZISA = tuple(t for t in TOKENI_ATAS if t not in TOKENI_ETICHETA_PERMISE) + ("terge",)
# r5: nume.extensie se cauta in TOATE valorile (clase, id, orice atribut, URL-uri, style). Un URL contine "domeniu.tld", care dupa RE_FISIER
# e un nume.extensie; singura exceptie e INCHISA: in `href` cu schema http / https, hostname-ul EXACT (nu si calea / interogarea /
# fragmentul) nu e fisier DACA e unul din hosturile de mai jos sau un subdomeniu al lor (linkul calibrat de confidentialitate sta pe
# google.com). Orice alt URL (blob:, data:, alt host) sau atribut (src, srcset, style, data-*) se verifica ca text intreg = refuz.
HREF_GAZDE_FARA_FISIER = ("google.com",)                     # lista INCHISA, constanta in cod: hostname == intrare sau se termina cu ".intrare"
ATRIBUTE_AFISATE_SEPARAT = ("class", "id")                   # afisate in {...} ca "clase #id", nu ca nume de atribut; valorile lor verificate separat
# r5: marcaje de atribut cu cuvant de atasament in NUME care NU sunt fisiere - lista INCHISA, citita din pagina reala (chat, 21.11.2026,
# doar citire): `div.text-input-field.simplified-input-area` are atributele `_ngcontent-ng-c<numar>=""`, `xapfileselectordropzone=""`,
# `class=...`, `jslog=...`; cuvantul "file" vine din NUMELE `xapfileselectordropzone` (zona de drop a selectorului de fisiere, nu un fisier).
# r8 (v4.6.4b): + `data-filedrop-id` pe <file-drop-indicator> (5a din 22.11.2026 pe pagina reala, chat nou gol: `token_file:file-drop-indicator
# {data-filedrop-id}` - fara clase, fara id, singurul atribut neafisat separat). Forma valorii e parte din regula, pe valoarea BRUTA (un spatiu
# nu e "gol"): `xapfileselectordropzone` doar GOL; `data-filedrop-id` (r9) doar EXACT `chat-window-input-container` - valoarea reala, citita de
# chat din pagina (atribute_complete_22_11.txt); r8 accepta orice identificator [A-Za-z0-9_-]{0,64}, r9 nu mai accepta decat valoarea reala.
# Valoarea trece oricum si prin cautarea cuvintelor / numelor de fisier din _semnal (pasul 4), ca orice alta valoare.
# r9: al cincilea camp, `izolat`: elementul nu poate avea NICIUN alt atribut in afara marcajului, a clasei (cu doar token-uri generate `ng-*`,
# prin campul claselor = ()) si a atributelor generate `_ng*` cu valoare GOALA, si NICIUN copil (element sau text cu continut). Indicatorul real
# e exact asa; un indicator cu un copil (ex. numele unui fisier), cu un atribut in plus sau cu alta valoare NU e marcaj: numele `data-filedrop-id`
# intra in cautare si da `token_file:...` ca pana acum (iar copilul se verifica si el, element cu element). Div-ul r5 nu e izolat (are `jslog`).
# r10 (v4.6.4c): al saselea camp, `goale`: atributele (nume EXACT) care pot sta in plus pe elementul IZOLAT doar cu valoarea bruta goala sau
# doar din spatii albe HTML (VALOARE_SPATII: spatiu, \t, \n, \r, \f; NU NBSP, latime zero sau alt spatiu Unicode). Indicatorul pe chatul nou
# deschis de script (5g, atribute_5g_22_11.txt) are `style=""` -> ("style",). Un `style` cu orice continut -> elementul nu e izolat -> semnal.
# r11 (v4.6.4d): al doilea camp nu mai e O multime de clase, ci lista INCHISA a multimilor acceptate (fiecare comparata EXACT, ca
# multime de token-uri intregi, fara cele generate `ng-*`). Pentru div-ul r5: CLASE_DIV_DROP (starea normala + starile cu text lung);
# pentru indicator: doar multimea goala.
# (tag, multimile de clase EXACTE fara cele generate, numele atributului, forma valorii, izolat, goale): acceptat DOAR asa.
VALOARE_GOALA = re.compile(r"")                               # exact ""
VALOARE_FILEDROP = re.compile(re.escape("chat-window-input-container"))     # r9: EXACT valoarea reala (nu un identificator oarecare)
VALOARE_SPATII = re.compile(r"[ \t\n\r\f]*")                  # r10: gol sau doar spatii albe HTML (L13: clasa explicita, nu \s)
# r11: clasele div-ului zonei de drop (cel cu `xapfileselectordropzone=""`). Starea normala (21.11, token_file_atribute.txt) si starea
# cu ~10 KB de text in ciorna (23.11, stare_text_lung_23_11.json: `simplified-input-area` dispare, apar cei doi token-i ai inaltimii si
# `with-toolbox-drawer`) sunt VAZUTE pe pagina reala; celelalte doua sunt baza vazuta la 23.11 cu doar unul din cei doi token-i ai
# inaltimii (starile intermediare - DEDUCTII, nevazute inca: 5g2 din RUNBOOK le captureaza, nu le dovedeste). r12 (varianta B, Jakarinos):
# multimile "simplified-input-area + token de inaltime" din r11 sunt scoase (captura arata ca `simplified-input-area` dispare in starea
# extinsa). Nimic din afara listei (alt token, prefix, sufix, litere mari, ambele baze odata) nu e acceptat.
CLASE_DIV_DROP = (
    ("text-input-field", "simplified-input-area"),                                                        # r5 - normal (vazut 21.11)
    ("text-input-field", "height-expanded-past-single-line", "pre-fullscreen", "with-toolbox-drawer"),    # r11 - text lung (vazut 23.11)
    ("text-input-field", "height-expanded-past-single-line", "with-toolbox-drawer"),                      # r11 - intermediar (dedus)
    ("text-input-field", "pre-fullscreen", "with-toolbox-drawer"),                                        # r11 - intermediar (dedus)
)
MARCAJE_PERMISE = (
    ("div", CLASE_DIV_DROP, "xapfileselectordropzone", VALOARE_GOALA, False, ()),                         # r5 (21.11) + r11 (23.11)
    ("file-drop-indicator", ((),), "data-filedrop-id", VALOARE_FILEDROP, True, ("style",)),               # r8 + r9 + r10 (22.11)
)
# r9: VALORI de atribut cu cuvant de atasament care NU sunt fisiere - lista INCHISA, citita din pagina reala (chat, CDP, 22.11.2026, doar citire):
# butonul "+" `<gem-icon-button>` are `arialabel="Incarcare si instrumente"` (atribut Angular FARA cratima - nu e `aria-label`, deci nu e
# eticheta din semnatura, ci o valoare oarecare verificata la pasul 4 din _semnal) si `ariahaspopup="menu"` (deschide meniul); cuvantul
# "incarca" vine din valoarea lui. (tag, numele atributului, valoarea EXACTA dupa _ascii - ca etichetele din liste -, alte atribute cerute cu
# valoarea lor bruta EXACTA): doar asa valoarea nu intra in cautare. Alt tag, alta valoare (si "incarcare si instrumente x"), fara
# `ariahaspopup="menu"`, sau acelasi cuvant in alt atribut al butonului = semnal ca pana acum. Nu e o acceptare a cuvantului "incarca".
VALORI_PERMISE = (
    ("gem-icon-button", "arialabel", "\u00cenc\u0103rcare \u0219i instrumente", (("ariahaspopup", "menu"),)),   # r15: Unicode exact (a22)
)
# r9: TOKEN-uri de clasa cu cuvant de atasament care NU sunt fisiere, DOAR pe editor (_e_editor: div.ql-editor[contenteditable] / sub
# rich-textarea) - lista INCHISA, citita din pagina reala (22.11.2026): editorul are clasele `... rich-query-formatting-enabled
# input-url-linkification-enabled inline-chips-enabled` (steaguri de functionalitate Quill / Gemini); cuvantul "chip" vine din a doua.
# Comparatia e pe token-ul INTREG de clasa (egalitate, nu subsir, nu prefix): `chip`, `file-chip`, `inline-chips`, `inline-chips-enabled-x`,
# `Inline-Chips-Enabled` raman semnale, la fel acelasi token pe orice alt element (zona, rich-textarea, gem-icon, div). Token-ul scutit nu
# intra nici in cautarea numelor de fisier (n-are punct, deci e echivalent). Nu e o acceptare a cuvantului "chip".
CLASE_EDITOR_PERMISE = ("input-url-linkification-enabled", "inline-chips-enabled")
RE_FISIER = re.compile(r"(?<![a-z0-9])[a-z0-9][a-z0-9_-]*\.[a-z][a-z0-9]{0,4}(?![a-z0-9])")   # nume.extensie in text
# r3: un cuvant care e EXACT un domeniu al firmei nu e fisier (textul de confidentialitate Workspace: "Chaturile gazpet.ro nu
# sunt folosite ..."). Cuvantul = potrivirea RE_FISIER extinsa peste toate caracterele de nume de fisier din jur, deci
# "gazpet.ro.pdf", "a.gazpet.ro.docx", "gazpet.rox", "www.gazpet.ro" NU sunt domeniul exact si raman fisiere (refuz).
DOMENII_FIRMA = ("gazpet.ro",)                                # lista INCHISA, constanta in cod (nu se citeste de nicaieri)
CARACTERE_NUME = "abcdefghijklmnopqrstuvwxyz0123456789_.-"   # caracterele din care RE_FISIER compune un nume.extensie
TEXT_AFISAT = 200                                             # r3: textul unui motiv text: / text_fisier: (calibrarea cere textul intreg)
DETALIU_AFISAT = 600                                          # o linie "necunoscut ..." (motiv + semnatura / text); r8: 240 -> 600, cu {...} intreg
SEMNATURA_TOKEN_AFISATA = 400                                 # r8: {clase #id atribute} al unui element cu semnal (era 80: pe pagina reala taia
                                                              #     exact sursa cuvantului, vezi antetul v4.6.4b)
SURSA_AFISATA = 160                                           # r8: valoarea aratata in linia "    sursa ..." a lui `stare`
# r16 (Jakarinos NO-GO r15): textul unei iconite mat-icon = doar ligaturile EXACTE vazute (lista inchisa, nu regex). In captura netaiata
# 23.11 (gol / mediu / lung) toate cele 3 / 5 iconite au text GOL (numele: fonticon / data-mat-icon-name = ICOANE) -> lista e goala.
LIGATURI_VAZUTE = ()
MODEL_DATA_TEST = "bard-mode-menu-button"                     # butonul modelului (= MODEL), verificat separat
# LISTE ALBE - completate DOAR din calibrarea pe pagina reala (RUNBOOK pasul 0): EXACT semnaturile afisate de `stare`
# (liniile "necunoscut ..."), doar pentru elemente vazute de om pe ecran cu ciorna goala / doar text, niciodata pentru ceva ce
# seamana a fisier. CONTROALE = butoane / linkuri (r16: textele din ele doar cele din TEXTE_CUNOSCUTE pe locul lor); STRUCTURA = invelisuri
# (continutul lor se verifica in continuare element cu element); TEXTE = (loc, text) vazute in zona (r16: si in controale).
# Calibrarea din 21.11.2026 (chat-ul, copia neinstalata a lui ae3e8947, Edge 9333, un tab, Carbon, nimic atasat, niciun
# instrument): (i) chat nou gol = 27 linii, (ii) acelasi chat cu un cuvant in ciorna, fara Enter = 31, (iii) chat existent
# gol = 32. Mai jos reuniunea lor; in comentariu starea in care a aparut fiecare. NU e trecuta (r4) linia
# `token_file:div{text-input-field simplified-input-area}`: un element cu cuvant de atasament nu poate fi acceptat de nicio lista
# (semnalele se verifica intai); cuvantul vine dintr-un atribut al div-ului real pe care semnatura din r3 nu il afisa - `stare`
# il afiseaza acum in {...} si decizia se ia dupa citirea lui din pagina (RUNBOOK pasul 0), nu prin acceptare globala.
# r5: atributul citit din pagina reala = `xapfileselectordropzone=""` -> regula inchisa MARCAJE_PERMISE (mai sus), nu o intrare
# in liste; cu ea div-ul e un element neutru obisnuit, iar continutul lui se verifica in continuare element cu element.
# r8 (22.11.2026, 5a pe v4.6.4 instalat, chat nou gol): cele 3 linii noi sunt toate semnale (`token_...`), deci listele NU se schimba
# (reuniunea liniilor `element:` / `text:` reale ramane cea de la 21.11: 5 + 23 + 3). r9: toate trei sunt lamurite din atributele complete
# citite de chat din pagina (antetul v4.6.4b r2): (1) MARCAJE_PERMISE (exact + izolat), (2) VALORI_PERMISE, (3) CLASE_EDITOR_PERMISE.
# r11 (23.11.2026, brief lung): + o intrare in CONTROALE (butonul "Ecran complet"); listele devin 6 + 23 + 3.
CONTROALE_CUNOSCUTE = (
    "button[aria-label=deruleaza in jos][type=button][tabindex]",   # i ii iii - "Deruleaza in jos" (in back-to-bottom-fab)
    "button[aria-label=incarcare si instrumente]",                   # i ii iii - butonul "+" care deschide meniul (nu e fisier)
    "button[aria-label=dicteaza (^?d)]",                             # i ii iii - microfonul (dictare; "?" = caracterul non-ASCII)
    "button[aria-label=trimite mesajul]",                            # ii       - butonul de trimitere, apare doar cu text in ciorna
    "a[data-test-id=footer-privacy-notice-link][href]",              # iii      - linkul "Confidentialitatea ta si Gemini"
    # r11 (23.11.2026, text lung in ciorna, NETRIMIS): butonul "Ecran complet" (class fullscreen-button, gemtooltip "Ecran complet"),
    # semnatura copiata EXACT din linia `element:` a jurnalului refuzului (juridic_43eb636364a95c9d.log); fara semnal (atributele complete
    # in stare_text_lung_23_11.json). Alta semnatura (ex. fara aria-describedby) = element necunoscut, refuz (fals, dar sigur).
    "button[aria-label=extinde intrarea la ecran complet][aria-describedby]",
)
# r12 (Jakarinos NO-GO r11): controale cu text INCHIS - (semnatura EXACTA din CONTROALE_CUNOSCUTE, textele permise EXACT dupa _ascii).
# In controlul acesta si in TOTI descendentii lui (oricat de adanc) un nod text e permis doar gol sau egal cu unul din textele listei;
# orice alt text = `text_in_control:` (refuz), chiar fara cuvant de atasament. Contextul nu se schimba sub el (un control / butonul
# modelului imbricat nu-i elibereaza textele). Butonul "Ecran complet": tooltip-ul vazut `gemtooltip="Ecran complet"`; numele iconitei
# NU e in captura, deci nicio ligatura nu e permisa (iconita fara text - svg / gem-icon - trece). Celelalte controale: neschimbate.
# r16 (Jakarinos NO-GO r15): CONTROALE_TEXT_INCHIS scos - TOATE controalele au acum text inchis, prin TEXTE_CUNOSCUTE (loc, text); butonul
# "Ecran complet" nu mai are niciun text (captura netaiata: niciun nod text in el; tooltip-ul nu e un nod text in buton).
# r14 (Jakarinos NO-GO r13; inlocuieste lista neagra r13 ATRIBUTE_TEXT / FRAGMENTE_NUME_TEXT / FORMA_IDENTIFICATOR / VALORI_TEXT_CUNOSCUTE):
# LISTA ALBA de atribute. Pe ORICE element ACCEPTAT (zona, invelisurile STRUCTURA_TAGURI, editorul si descendentii lui, elementele neutre,
# controalele / structura din liste, butonul modelului - deci si pe descendentii unui control acceptat) FIECARE atribut trebuie sa se
# potriveasca cu o intrare (taguri, nume, forma): numele EXACT, tagul elementului in `taguri` ("*" = orice tag, doar `class` cu token-uri
# generate), valoarea BRUTA (r15: Unicode exact, fara _ascii; r14 compara etichetele dupa _ascii) potrivita INTEGRAL (fullmatch) cu `forma`. Atributele generate de Angular (ATR_GENERAT: `_ngcontent-ng-c<n>` / `_nghost-ng-c<n>`, nume EXACT de forma asta) doar cu
# valoarea GOALA. Nume necunoscut pe tagul lui = `atribut_necunoscut:<semnatura>{<nume>}`; nume cunoscut cu alta valoare =
# `atribut_valoare:<semnatura>{<nume>}` (refuz, chiar fara cuvant de atasament). Elementele refuzate deja (semnal, element:) isi pastreaza
# motivul. Sursa fiecarei intrari: capturile reale (chat, CDP, doar citire), cu starea in comentariu:
#   c23 = stare_completa_23_11.json (gol / mediu / lung, toate elementele din input-area-v2, fara descendentii editorului);
#   t23 = stare_text_lung_23_11.json; a22 = atribute_complete_22_11.txt; g22 = atribute_5g_22_11.txt; z21 = link_si_zona.txt;
#   s21 = semnaturile din calibrarea 21.11 (stare_i / ii / iii: numele + valoarea atributelor din SEMN_ATR_VALOARE, doar numele celor din
#   SEMN_ATR_CHEIE - valoarea lor e cea vazuta la 23.11 pe acelasi tag).
# Valori EXACTE pentru tot ce nu variaza; FORMA exacta vazuta doar pentru valorile tehnice care variaza intre incarcari / ferestre:
# clasele (r15: token-uri EXACTE pe tag + generatele Angular vazute, CLASE_PERMISE), jslog (r15: valorile vazute cu doar numerele variabile,
# JSLOG_VAZUTE), style (doar proprietatile CSS vazute, cu numere), identificatorul descrierii CDK si al meniului. Un atribut absent din capturi (id, title, alt, src,
# matbadge, ariavaluetext, data-text, aria-labelledby...) = necunoscut. Elementele vazute doar prin semnatura la 21.11 (back-to-bottom-fab,
# butonul "Deruleaza in jos", span[role=status], linkul de confidentialitate, hallucination-disclaimer, prompt-flow-bar) au doar atributele
# din semnatura: orice alt atribut al lor = refuz FALS dar sigur (recalibrare: `stare` arata numele si valoarea in linia `sursa`).
#   r21: z23s = capturile pagini de AZI (23.11 seara, Edge 9333, chat nou /app, Carbon, nimic atasat; rocky_r21_calibrare: gol / scurt /
#   mediu / lung = textele 5g2-a scrise cu insert_text, fara Enter, golite imediat): atributele COMPLETE ale zonei exterioare
#   input-container, back-to-bottom-fab + butonul + iconita, span[role=status], div.input-area-container, hallucination-disclaimer +
#   div.capabilities-disclaimer + p[data-test-id=empty-disclaimer] (gol, doar un <br>). Toate valorile adaugate sunt EXACT cele vazute
#   (aceleasi in cele 4 stari); niciun element si niciun text nou.
ATR_GENERAT = re.compile(r"_ng(?:content|host)-ng-c[0-9]{1,12}")
_E = lambda *v: re.compile("|".join(re.escape(x) for x in v))              # una din valorile EXACTE (fullmatch, Unicode brut)
GOL = _E("")
BOOL = _E("true", "false")                                                   # starile ARIA booleene (strict tehnice)
# r15 (Jakarinos NO-GO r14 P1): `class` nu mai are forma larga FORMA_CLASE. Valoarea se imparte DOAR pe spatiile albe HTML (spatiu, \t, \n,
# \r, \f; un NBSP / alt spatiu Unicode ramane in token, deci token necunoscut) si FIECARE token trebuie sa fie (a) unul EXACT din
# CLASE_PERMISE[tag] (token-urile vazute in capturi pe acel tag, c23 / t23 / a22 / g22) sau (b) un token generat de Angular din
# CLASE_GENERATE (doar cele vazute: `ng-tns-c<cifre>-<cifre>`, `ng-star-inserted`, `ng-animating`; pe orice tag, le pune Angular).
# Restul token-urilor `ng-*` vazute (ng-trigger-*, ng-dirty, ng-untouched, ng-valid) sunt exacte pe tagul lor, nu tipare. Tag fara clase
# vazute (a, svg, prompt-flow-bar, gem-popover, toolbox-drawer...) = doar CLASE_GENERATE. r21: p, back-to-bottom-fab, hallucination-disclaimer
# si input-container au acum clasele vazute pe pagina de azi (z23s).
CLASE_GENERATE = re.compile(r"ng-tns-c[0-9]{1,12}-[0-9]{1,4}|ng-star-inserted|ng-animating")   # c23 t23 g22 (fullmatch)
SPATII_HTML = re.compile(r"[ \t\n\r\f]+")
# r21 z23s (pagina de azi, chat nou, gol / scurt / mediu / lung): + token-urile vazute pe zona exterioara input-container, pe
# back-to-bottom-fab si butonul lui, pe span[role=status], pe div.input-area-container, pe hallucination-disclaimer si continutul lui.
CLASE_PERMISE = {
    "back-to-bottom-fab": ("back-to-bottom-fab",),                                                                             # r21 z23s
    "button": ("back-to-bottom-fab", "fullscreen-button", "input-area-switch", "lm-enabled", "mat-badge", "mat-badge-above",
               "mat-badge-after", "mat-badge-hidden", "mat-badge-overlap", "mat-badge-small", "mat-mdc-button", "mat-mdc-button-base",
               "mat-mdc-icon-button", "mat-mdc-tooltip-trigger", "mat-primary", "mat-unthemed", "mdc-button",
               "mdc-icon-button"),                                                                                     # c23 t23 (r21 z23s)
    "div": ("capabilities-disclaimer", "children-ready", "circle-overlay", "fullscreen-button-container", "gem-menu-redesign",
            "gem-mic-button-wrapper", "has-model-picker", "height-expanded-past-single-line", "inline-chips-enabled", "inner", "input-area",
            "input-area-container", "input-area-switch-label", "input-buttons-wrapper-bottom", "input-buttons-wrapper-top",
            "input-url-linkification-enabled", "is-zero-state", "leading-actions-wrapper", "lm-enabled", "logo-pill-label-container",
            "mat-mdc-tooltip-trigger", "mic-button-container", "model-picker-container", "new-input-ui", "ng-trigger",
            "ng-trigger-inputAreaAnimation", "ng-trigger-sendButtonVisibility", "ng-trigger-slide", "ng-trigger-toolboxDrawerEnter",
            "persistent-mic", "pill-ui-logo-container", "pre-fullscreen", "ql-blank", "ql-clipboard", "ql-editor",
            "rich-query-formatting-enabled", "send-button-container", "simplified-input-area", "simplified-input-menu-container",
            "single-line-format", "text-input-field", "text-input-field-main-area", "text-input-field_textarea-inner",
            "text-input-field_textarea-wrapper", "textarea", "textarea-wrapper", "toolbox-drawer-container", "trailing-actions-wrapper",
            "under-input", "visible", "with-model-picker", "with-toolbox-drawer"),                                    # c23 t23 a22 (r21 z23s)
    "fieldset": ("input-area-fieldset",),                                                                                      # c23
    "gem-icon": ("dropdown-icon",),                                                                                            # c23
    "gem-icon-button": ("gem-button", "gem-button-badge-size-small", "gem-button-size-small", "gem-button-type-on-surface",
                        "gem-menu-button", "has-input", "lm-enabled", "mat-mdc-tooltip-trigger", "menu-button", "open", "send-button",
                        "speech_dictation_mic_button", "submit"),                                                              # c23 t23 a22
    "hallucination-disclaimer": ("enable-luminous-disclaimer-updates", "hallucination-disclaimer"),                            # r21 z23s
    "input-area-v2": ("discovery-feed-theme", "input-box-shadow", "lm-input-redesign", "single-line-input", "ui-improvements-phase-1",
                      "with-toolbox-drawer"),                                                                                  # t23 (z21 taiat)
    "input-container": ("edge-to-edge", "grow-input-downwards", "hide-on-print", "input-gradient-overlay",
                        "lm-input-redesign"),                                                                                  # r21 z23s
    "mat-icon": ("gds-icon-l", "google-symbols", "lm-icon-l", "lm-icon-m", "lumi-symbols", "mat-icon", "mat-icon-no-color",
                 "mat-ligature-font", "notranslate"),                                                                          # c23 (r21 z23s: lm-icon-m)
    "p": ("desktop-spacing", "empty-disclaimer", "gds-body-s"),                                                                # r21 z23s
    "rich-textarea": ("enterprise", "ng-dirty", "ng-pristine", "ng-untouched", "ng-valid", "ql-bubble", "ql-container",
                      "simplified-input", "text-input-field_textarea"),                                                        # c23 (v4.6.4e f5: ng-pristine)
    "simplified-input-menu": ("simplified-input-menu",),                                                                       # c23
    "span": ("cdk-visually-hidden", "gds-body-m", "inline-upgrade-banner-live-region", "mat-focus-indicator",
             "mat-mdc-button-persistent-ripple", "mat-mdc-button-touch-target", "mdc-button__label", "mdc-button__ripple",
             "mdc-icon-button__ripple", "picker-primary-text"),                                                        # c23 (r21 z23s)
    "speech-dictation-mic-button": ("speech-dictation-mic-button",),                                                           # c23
}


class _FormaClase(object):
    # r15: forma lui `class` pe un tag: fiecare token (impartire DOAR pe SPATII_HTML) in `exacte` sau generat (CLASE_GENERATE)
    def __init__(self, exacte):
        self.exacte = frozenset(exacte)

    def fullmatch(self, v):
        return all(t in self.exacte or CLASE_GENERATE.fullmatch(t) for t in SPATII_HTML.split(v) if t != "")


# r15 (Jakarinos NO-GO r14 P1): `jslog` = valorile VAZUTE in capturi (c23 / t23), cu DOAR numarul de la inceput variabil ({N} = cifre);
# restul e literal (`track:impression`, `track:generic_click,impression`, `;mutable:true`). Orice componenta textuala noua (alt track, alt
# camp, alta ordine, litere mari) = valoare necunoscuta. {B} = cheia BardVeMetadataKey (base64): capturile o TAIE la 300 de caractere
# (diag: `slice(0, 300)`; doar valoarea 206752 de pe t23 e intreaga), deci nu se poate compara ca sir intreg; se DECODEAZA si se verifica
# structura vazuta (_meta_permisa): JSON canonic (re-serializat identic), lista de cel mult META_LUNGIME elemente, fiecare `null`, cu doua
# exceptii pe pozitiile vazute - [8] = [<cifre>,"ro",<cifre>,""] (c23 / t23, butonul de trimitere) si [22] = ["<16 cifre hexazecimale>"]
# (t23, identificatorul conversatiei, aceeasi forma ca in URL-ul /app/<id>; singura parte variabila care nu e zecimala: un chat
# existent are alt id). Orice text, cheie, numar zecimal, alta pozitie = refuz.
# r16: cheile citite INTREGI (c23n = stare_completa_23_11_netaiat.json): modelul = 23 de elemente ([22] = id-ul conversatiei), trimite =
# 35 de elemente ([8] limba, [22] id-ul, [34] = [0]) -> a treia exceptie, [34] = [<cifre>] (META_NUMAR), si META_LUNGIME = 35.
JSLOG_VAZUTE = (
    (("div",), "{N};track:impression"),                                                  # c23 t23 (251251, 303810)
    (("button", "rich-textarea"), "{N};track:generic_click,impression"),                 # c23 t23 (175863, 300142; 356556)
    (("button",), "{N};track:generic_click,impression;BardVeMetadataKey:{B}"),           # c23 t23 (173899, 206752)
    (("button",), "{N};track:generic_click,impression;BardVeMetadataKey:{B};mutable:true"),   # t23 (206752)
    (("button",), "{N};track:generic_click"),                                            # r21 z23s - "Deruleaza in jos" (353361)
)
META_LUNGIME = 35                       # r16 (c23n, netaiat): cea mai lunga lista vazuta = 35 (trimite); modelul = 23 (r15: 64, dedus)
META_LIMBA = (8, "ro")                  # c23 t23: pozitia si limba interfetei din [<cifre>,"ro",<cifre>,""]
META_CONVERSATIE = (22, re.compile(r"[0-9a-f]{16}"))      # t23: ["95a4c0abcba24364"]
META_NUMAR = 34                         # r16 (c23n): butonul de trimitere, ultima pozitie = [0] (nevazuta cat cheia era taiata) -> [<cifre>]


def _sablon_jslog(s):
    r = "".join("[0-9]{1,9}" if p == "{N}" else "([A-Za-z0-9+/]{4,8000}={0,2})" if p == "{B}" else re.escape(p)
                for p in re.split(r"(\{N\}|\{B\})", s))
    return re.compile(r)


def _meta_permisa(b):
    # r15: cheia BardVeMetadataKey (base64) -> True doar daca decodata e EXACT structura vazuta (vezi JSLOG_VAZUTE)
    s = b.rstrip("=")
    u = "=" * (-len(s) % 4)
    if b not in (s, s + u):
        return False                                    # umplutura "=": lipsa sau EXACT cea corecta
    try:
        raw = base64.b64decode(s + u, validate=True)
        t = raw.decode("ascii")
    except Exception:
        return False
    if base64.b64encode(raw).decode("ascii") != s + u:
        return False                                    # doar forma canonica (fara biti in plus in ultimul caracter)
    try:
        o = json.loads(t)
    except ValueError:
        return False
    if not isinstance(o, list) or len(o) > META_LUNGIME or json.dumps(o, separators=(",", ":")) != t:
        return False
    for i, x in enumerate(o):
        if x is None:
            continue
        if (i == META_LIMBA[0] and isinstance(x, list) and len(x) == 4 and x[1] == META_LIMBA[1] and x[3] == ""
                and all(type(x[j]) is int and 0 <= x[j] < 10 ** 9 for j in (0, 2))):
            continue
        if (i == META_CONVERSATIE[0] and isinstance(x, list) and len(x) == 1 and isinstance(x[0], str)
                and META_CONVERSATIE[1].fullmatch(x[0])):
            continue
        if i == META_NUMAR and isinstance(x, list) and len(x) == 1 and type(x[0]) is int and 0 <= x[0] < 10 ** 9:
            continue
        return False
    return True


class _FormaJslog(object):
    # r15: forma lui `jslog` pe un tag: unul din sabloanele JSLOG_VAZUTE ale tagului, potrivit integral; {B} verificat de _meta_permisa
    def __init__(self, sabloane):
        self.sabloane = tuple(_sablon_jslog(s) for s in sabloane)

    def fullmatch(self, v):
        for r in self.sabloane:
            m = r.fullmatch(v)
            if m and all(_meta_permisa(g) for g in m.groups()):
                return True
        return False


def _intrari_clase_jslog():
    # r15: intrarile `class` (una pe tag cu clase vazute + "*" = doar generate) si `jslog` (una pe tag) pentru ATRIBUTE_PERMISE
    out = [((tag,), "class", _FormaClase(t)) for tag, t in sorted(CLASE_PERMISE.items())]
    out.append((("*",), "class", _FormaClase(())))
    for tag in sorted(set(t for taguri, _ in JSLOG_VAZUTE for t in taguri)):
        out.append(((tag,), "jslog", _FormaJslog([s for taguri, s in JSLOG_VAZUTE if tag in taguri])))
    return tuple(out)


FORMA_STYLE_DIV = re.compile(r"(?:--chat-container-height: [0-9]{1,5};)?")             # c23: "" / "--chat-container-height: 718;"
FORMA_STYLE_RICH = re.compile(r"--textarea-max-rows: [0-9]{1,3}; --chat-container-height: [0-9]{1,5}px;")   # c23 (rich-textarea)
FORMA_DESCRIERE_CDK = re.compile(r"cdk-describedby-message-ng-1-[0-9]{1,4}")       # c23 / t23 / a22: n = 2 / 11 / 16 / 17 / 18; UN singur id
FORMA_MENIU = re.compile(r"ng-menu-a[0-9]{1,8}-[0-9]{1,4}")                      # c23 / t23: ng-menu-a26090-1 (numarul e generat)
ICOANE = _E("plus", "keyboard_arrow_down", "mic", "expand_content", "arrow_upward", "arrow_downward")   # c23 (+ r21 z23s): numele iconitelor (font)
# r21 z23s: valorile `style` vazute pe pagina de azi (chat nou, toate cele 4 stari: aceeasi valoare), EXACTE (fara forma cu numere)
STYLE_ICONITA = 'font-family: "Google Symbols";'                                         # mat-icon "arrow_downward"
STYLE_ZERO_STATE = ("--initial-input-half-height: 32px; position: absolute; bottom: 50vh; transform: "
                    "translateY(var(--input-area-transform-y, calc(100% - var(--initial-input-half-height))));")   # div.input-area-container
STYLE_DISCLAIMER = "--align-text: center;"                                               # div.capabilities-disclaimer
HREF_CONFIDENTIALITATE = "https://support.google.com/gemini/answer/14620100"             # z21 (chat existent)
# r15: textele = sirurile Unicode EXACTE din capturi (comparate brut, fara _ascii / litere mici / spatii comprimate; escape-uri in sursa)
DEDUS_DERULEAZA = "Deruleaz\u0103 \u00een jos"                              # s21: DOAR semnatura ASCII "deruleaza in jos" (DEDUCTIE)
ETICHETA_INCARCARE = "\u00cenc\u0103rcare \u0219i instrumente"                # c23 t23 a22
ETICHETE_BUTOANE = (                                                        # aria-label pe <button>, EXACT
    DEDUS_DERULEAZA,                                                        # s21 i ii iii (alta forma = refuz, sigur)
    ETICHETA_INCARCARE,                                                     # c23 / t23
    "Dicteaz\u0103 (^\u21e7D)",                                             # c23 / t23 (U+21E7 = sageata Shift)
    "Trimite mesajul",                                                      # c23 lung / mediu
    "Extinde intrarea la ecran complet",                                    # c23 lung / mediu; t23 - butonul "Ecran complet"
    "Deschide selectorul de moduri, momentan Automat",                      # v4.6.6 (24.11, pagina reala) - butonul modelului (= MODEL_CERUT)
)
ATRIBUTE_PERMISE = (
    (("input-area-v2", "auto-suggest", "simplified-input-menu", "toolbox-drawer", "bard-mode-switcher"), "trace", GOL),   # z21 c23 t23
    (("input-container",), "trace", GOL),                            # r21 z23s (zona exterioara)
    (("span",), "aria-atomic", _E("true")),                          # r21 z23s - span[role=status] (regiune live)
    (("span",), "aria-live", _E("polite")),                          # r21 z23s - span[role=status]
    (("button",), "aria-hidden", _E("true")),                        # r21 z23s - butonul "Deruleaza in jos"
    (("mat-icon",), "style", _E(STYLE_ICONITA)),                     # r21 z23s - iconita "arrow_downward"
    (("div",), "style", _E(STYLE_ZERO_STATE, STYLE_DISCLAIMER)),     # r21 z23s - div.input-area-container / div.capabilities-disclaimer
    (("hallucination-disclaimer",), "aligntext", _E("center")),      # r21 z23s
    (("div",), "uireadyparent", GOL),                                # c23
    (("div",), "data-node-type", _E("input-area", "speech_dictation_mic_button")),     # c23
    (("div",), "xapfileselectordropzone", GOL),                      # c23 t23 (si marcajul r5 din MARCAJE_PERMISE)
    (("div",), "style", FORMA_STYLE_DIV),                            # c23 a22
    (("rich-textarea",), "style", FORMA_STYLE_RICH),                 # c23
    (("gem-icon-button", "toolbox-drawer", "at-mentions-menu-v2"), "style", GOL),     # c23
    (("simplified-input-menu", "speech-dictation-mic-button"), "style", GOL),        # v4.6.4e f5 (dupa F5, toate starile)
    (("file-drop-indicator",), "style", VALOARE_SPATII),             # g22 (r10: gol sau doar spatii albe HTML)
    (("file-drop-indicator",), "data-filedrop-id", VALOARE_FILEDROP),                 # g22
    (("div",), "data-test-id", _E("textarea-inner", "textarea-wrapper", "logo-pill-label-container", "send-button-container")),  # c23
    (("button",), "data-test-id", _E(MODEL_DATA_TEST)),              # c23 t23
    (("a",), "data-test-id", _E("footer-privacy-notice-link")),      # s21 iii
    (("p",), "data-test-id", _E("empty-disclaimer")),                # s21 i ii
    (("span",), "data-test-id", _E("content")),                      # s21 iii
    (("a",), "href", _E(HREF_CONFIDENTIALITATE)),                    # z21
    (("div",), "role", _E("group", "textbox")),                      # c23
    (("fieldset",), "role", _E("none")),                             # c23
    (("mat-icon",), "role", _E("img")),                              # c23
    (("span",), "role", _E("status")),                               # s21
    (("div",), "tabindex", _E("-1")),                                # c23 (ql-clipboard)
    (("button",), "tabindex", _E("0", "-1")),                        # c23 t23 (s21: doar cheia); r21 z23s: "-1" pe "Deruleaza in jos"
    (("button",), "type", _E("button")),                             # c23 t23 s21
    (("gem-icon-button",), "type", _E("onSurface")),                 # c23 a22
    (("div", "bard-mode-switcher"), "tooltipanchorposition", _E("above-end")),        # c23
    (("div",), "data-gramm", _E("false")),                           # c23 a22
    (("div",), "contenteditable", _E("true")),                       # c23 a22 (editorul, ql-clipboard)
    (("div", "rich-textarea"), "dir", _E("ltr")),                    # c23 a22
    (("div",), "aria-multiline", _E("true")),                        # c23 a22
    (("div",), "aria-label", _E("Introdu o solicitare pentru Gemini")),              # c23 a22 - editorul
    (("div",), "data-placeholder", _E("\u00centreab\u0103 Gemini")),          # c23 a22 - editorul
    (("button", "div", "gem-icon-button"), "aria-describedby", FORMA_DESCRIERE_CDK),  # c23 t23 a22 (tinta: _motiv_descriere)
    (("button", "div", "gem-icon-button"), "cdk-describedby-host", _E("ng-1")),       # c23 t23 a22
    (("span",), "cdk-overlay-origin", GOL),                          # c23
    (("gem-icon-button",), "theme", _E("lm")),                       # c23 a22
    (("gem-icon-button",), "ariahaspopup", _E("menu")),              # c23 a22
    (("gem-icon-button",), "arialabel", _E(ETICHETA_INCARCARE)),             # c23 a22
    (("gem-icon-button", "button"), "aria-disabled", BOOL),          # c23 t23
    (("button",), "aria-expanded", BOOL),                            # c23 t23
    (("button",), "aria-pressed", BOOL),                             # c23 t23
    (("button", "rich-textarea"), "aria-haspopup", _E("menu", "true")),               # c23 t23
    (("button",), "aria-controls", FORMA_MENIU),                     # c23 t23 (butonul modelului)
    (("button",), "aria-label", _E(*ETICHETE_BUTOANE)),               # vezi ETICHETE_BUTOANE
    (("button",), "gemtooltip", _E("Ecran complet")),               # c23 t23
    (("button",), "gemtooltipposition", _E("below")),                # c23 t23
    (("button",), "matbadgeposition", _E("after")),                  # c23 t23
    (("button",), "mat-ripple-loader-class-name", _E("mat-mdc-button-ripple")),       # c23 t23
    (("button",), "color", _E("primary")),                           # c23 t23
    (("button",), "maticonbutton", GOL),                             # c23 t23
    (("button",), "mat-icon-button", GOL),                           # c23 t23
    (("button",), "mat-button", GOL),                                # c23 t23
    (("button",), "mat-ripple-loader-uninitialized", GOL),           # c23 t23
    (("button",), "mat-ripple-loader-centered", GOL),                # c23 t23
    (("button",), "cdkoverlayorigin", GOL),                          # c23 t23
    (("button",), "gemmenutrigger", GOL),                            # c23 t23
    (("button",), "periodictabletrigger", GOL),                      # c23 t23
    (("gem-icon",), "fonticonname", _E("keyboard_arrow_down", "arrow_downward")),     # c23; r21 z23s (in back-to-bottom-fab)
    (("gem-icon",), "size", _E("large", "medium")),                  # c23; r21 z23s
    (("mat-icon",), "aria-hidden", BOOL),                            # c23
    (("mat-icon",), "fonticon", ICOANE),                             # c23 (r21: + arrow_downward)
    (("mat-icon",), "data-mat-icon-name", ICOANE),                   # c23 (r21: + arrow_downward)
    (("mat-icon",), "data-mat-icon-type", _E("font")),               # c23
    (("mat-icon",), "data-mat-icon-namespace", _E("lumi-symbols", "")),               # c23; r21 z23s: gol pe iconita "arrow_downward"
    (("rich-textarea",), "atmentions", GOL),                         # c23
    (("rich-textarea",), "enterkeyhint", _E("send")),                # c23
    (("gem-popover",), "glassmenutheme", GOL),                       # c23
) + _intrari_clase_jslog()   # r15: class / jslog (mai sus)
# r14: textul tintei lui aria-describedby (elementul cu acel id, oriunde in pagina - containerul CDK); r15: textul BRUT (nodurile text
# lipite, fara _ascii, fara strip, fara comprimarea spatiilor), EXACT unul din textele vazute
# (c23 `descrieri`: gol / mediu / lung). Tinta mai poate avea doar `id` si `role="tooltip"` (AriaDescriber din Angular CDK pune exact
# atat pe mesaj: DEDUCTIE din sursa CDK, nevazuta in capturi - alta forma = refuz fals, sigur; 5g2-a o captureaza) si niciun element in ea.
DESCRIERI_CUNOSCUTE = (
    "Schimb\u0103 modelul (^\u21e7M)",                                      # c23 - butonul modelului (ng-1-11)
    "Dicteaz\u0103 (^\u21e7D)",                                             # c23 - microfonul (ng-1-2)
    "Ecran complet",                                                        # c23 mediu / lung - butonul "Ecran complet" (ng-1-18)
    "Trimite",                                                              # c23 mediu / lung - butonul de trimitere (ng-1-17)
)
ATRIBUTE_TINTA_DESCRIERE = (("role", _E("tooltip")),)                       # + `id` (egal cu referinta)
# v4.6.5 r2: atributele cu LISTA de id-uri a caror tinta se verifica (_motiv_descriere). aria-labelledby nu e pe nicio pagina reala (capturi
# 21.11 - 23.11): pe un element ramane `atribut_necunoscut:` (decor), dar tinta lui se verifica la fel (semn de atasament in ea = refuz).
ATRIBUTE_REFERINTA = ("aria-describedby", "aria-labelledby")
STRUCTURA_CUNOSCUTA = (
    "span[role=status]",                                             # i ii iii - regiune live pentru cititoare de ecran (goala)
    "back-to-bottom-fab",                                            # i ii iii - invelisul butonului "Deruleaza in jos"
    "gem-icon",                                                      # i ii iii - iconita (componenta Angular; svg-ul din ea e neutru)
    "file-drop-indicator",                                           # i ii iii - tinta de drag & drop, mereu in DOM, fara continut
    "auto-suggest",                                                  # i ii iii - sugestiile de completare (goale)
    "fieldset[role=none]",                                           # i ii iii - invelisul zonei de text
    "simplified-input-menu",                                         # i ii iii - invelisul butonului "+"
    "gem-icon-button[type=onsurface]",                               # i ii iii - invelisul unui buton cu iconita ("+", trimite)
    "toolbox-drawer",                                                # i ii iii - sertarul instrumentelor (niciun instrument ales)
    "div[data-test-id=textarea-inner]",                              # i ii iii
    "div[data-test-id=textarea-wrapper]",                            # i ii iii
    "at-mentions-menu-v2",                                           # i ii iii - meniul @ (inchis)
    "bard-mode-switcher",                                            # i ii iii - invelisul butonului de model (verificat separat)
    "div[role=group]",                                               # i ii iii - grup in bard-mode-switcher
    "div[data-test-id=logo-pill-label-container]",                   # i ii iii - eticheta modelului
    "gem-popover",                                                   # i ii iii - popover-ul listei de modele (inchis)
    "speech-dictation-mic-button",                                   # i ii iii - invelisul microfonului
    "gem-icon-button[type=onsurface][aria-describedby]",             # i ii iii - invelisul microfonului (cu descriere)
    "div[data-test-id=send-button-container][aria-describedby]",     # ii       - invelisul butonului de trimitere
    "hallucination-disclaimer",                                      # i ii iii - invelisul textului "Gemini poate gresi" (text verificat)
    "p[data-test-id=empty-disclaimer]",                              # i ii     - paragraful gol al avertismentului pe chat nou
    "prompt-flow-bar",                                               # iii      - bara de deasupra ciornei pe un chat existent (goala)
    "span[data-test-id=content]",                                    # iii      - textul linkului de confidentialitate
)
# r16 (Jakarinos NO-GO r15): textele permise sunt perechi (LOC, TEXT) - textul e acceptat DOAR pe locul pe care a fost vazut (_loc_text):
# LOC_MODEL = in butonul modelului; semnatura unui control din CONTROALE_CUNOSCUTE = in acel control (si in descendentii lui); semnatura
# din STRUCTURA_CUNOSCUTA = sub acel invelis, in afara controalelor (cel mai apropiat stramos din zona); LOC_ZONA = altundeva in zona
# (niciun text). TEXT = sirul Unicode EXACT, comparat cu textul BRUT al nodului din care se scot DOAR spatiile albe HTML de la capete.
LOC_MODEL = "buton_model"                                        # butonul modelului (MODEL_DATA_TEST), verificat separat de verifica_model
LOC_ZONA = "zona"                                                # in zona, in afara oricarui control / invelis din liste: niciun text
LOC_LINK = "a[data-test-id=footer-privacy-notice-link][href]"    # = intrarea din CONTROALE_CUNOSCUTE
TEXTE_CUNOSCUTE = (
    # c23n (captura NETAIATA 23.11, gol / mediu / lung): singurul text propriu din input-area-v2 in afara editorului, in
    # span.picker-primary-text din butonul modelului (21.11: acelasi text, in butonul modelului - pagina_calibrare)
    # v4.6.6 (24.11.2026, pagina reala dupa alegerea modului Auto): textul propriu al butonului = "Automat" (inainte "Carbon")
    (LOC_MODEL, "Automat"),
    # iii (r4) - avertismentul Google Workspace de sub ciorna pe un chat existent (element hallucination-disclaimer), citit INTREG de
    # chat pe 21.11.2026 (doar citire): textul paragrafului, fara linkul care ii urmeaza. Un text care contine in plus un nume.extensie
    # sau un cuvant de atasament NU trece niciodata (verificate inaintea listei).
    # r15: sirurile Unicode EXACTE din avertisment_workspace.txt (textContent citit de chat la 21.11), comparate brut (doar spatiile albe
    # HTML de la capetele nodului scoase); r16: fiecare doar pe locul lui (avertismentul sub hallucination-disclaimer, textele linkului in link)
    ("hallucination-disclaimer",
     "Chaturile Gazpet.ro nu sunt folosite pentru a ne \u00eembun\u0103t\u0103\u021bi modelele. Gemini este un AI \u0219i poate "
     "s\u0103 fac\u0103 gre\u0219eli, inclusiv \u00een leg\u0103tur\u0103 cu persoane."),
    (LOC_LINK, "Confiden\u021bialitatea ta \u0219i Gemini"),         # iii - textul linkului de confidentialitate
    (LOC_LINK, "Se deschide \u00eentr-o fereastr\u0103 nou\u0103"),  # iii - textul ascuns al linkului (se deschide in alt tab)
)
# acelasi lucru vazut de locator (strapunge shadow DOM-ul deschis, pe care page.content() nu il serializeaza): semn = refuz
SEMN_EXTRA = ", ".join(list(MEDIA) + ['[aria-label*="%s" i]' % t for t in TOKENI_ELIMINA])
MODEL_CERUT = "Automat"
# v4.6.6: forma acceptata a etichetei afisate (dupa normalizarea spatiilor): [Gemini ]Automat - fara versiune numerica (modul
# "Automat" nu are versiune pe pagina) si nimic dupa nume; orice alt model ("Carbon", "4 Hydrogen") sau sufix = model_gresit
MODEL_FORMA = re.compile(r"(?:Gemini )?" + re.escape(MODEL_CERUT))
BRIEF_ROOTS = [r"C:\Users\Public\paw-data\brief", r"C:\Users\Public\erp_review"]
MAX_CAR = 200000          # brief-uri mai mari nu se trimit (editorul web devine nesigur)
PAS_MS = 2000             # o citire la 2 s
CITIRI_IDENTICE = 5       # raspunsul e gata dupa 5 citiri identice consecutive (si fara buton de oprire)


class GemEroare(Exception):
    def __init__(self, cod, detaliu=""):
        super().__init__(cod)
        self.cod = cod
        self.detaliu = detaliu


def spune(*a):
    sys.stdout.write(" ".join(str(x) for x in a) + "\n")
    sys.stdout.flush()


def citeste_brief(cale, roots=BRIEF_ROOTS):
    # aparare in adancime: lansatorul a validat deja calea (UNC/ADS/reparse/radacini); aici doar radacina + .md + marime
    try:
        full = os.path.realpath(cale)
    except Exception:
        raise GemEroare("brief_invalid", "cale nerezolvabila")
    ok = any(os.path.normcase(full).startswith(os.path.normcase(os.path.realpath(r)).rstrip("\\") + "\\") for r in roots)
    if not ok:
        raise GemEroare("brief_invalid", "in afara radacinilor: " + full)
    if not full.lower().endswith(".md"):
        raise GemEroare("brief_invalid", "nu e .md")
    # r2 (Jakarinos P2): limita se aplica pe textul CITIT, inainte de strip (spatiile nu "scurteaza" un brief prea mare)
    try:
        if os.path.getsize(full) > MAX_CAR * 4 + 3:          # UTF-8: cel mult 4 octeti/caracter + BOM
            raise GemEroare("brief_invalid", "peste %d caractere" % MAX_CAR)
        with open(full, "r", encoding="utf-8-sig") as f:
            brut = f.read(MAX_CAR + 1)
    except GemEroare:
        raise
    except Exception as e:
        raise GemEroare("brief_invalid", "necitibil: " + type(e).__name__)
    if len(brut) > MAX_CAR:
        raise GemEroare("brief_invalid", "peste %d caractere" % MAX_CAR)
    text = brut.strip()
    if not text:
        raise GemEroare("brief_invalid", "gol")
    return text


# r17 (Jakarinos NO-GO r6): singurele caractere comprimate la comparare = spatiile albe HTML (spatiu, \t, \n, \r, \f), aceleasi ca la golul
# din _motiv_text; orice alt caracter (U+200B, U+2060, U+FEFF, U+200C / U+200D, NBSP, U+0301, U+3000, VT...) se compara EXACT
SPATII_COMPARATIE = re.compile("[ \t\n\r\f]+")


def normalizeaza(t):
    # r2 (Jakarinos P1-b): normalizare EXPLICITA pentru compararea ciornei cu brief-ul.
    # r17 (Jakarinos NO-GO r6: "normalizarea elimina intentionat U+200B / U+2060"): NIMIC nu se mai elimina sau inlocuieste. Singura
    # transformare = orice sir de spatii albe HTML -> un spatiu, capetele fara ele. De ce e NECESARA (randarea reala Quill): editorul pune
    # fiecare linie a brief-ului intr-un <p> (linia goala = <p><br></p>); r18: textul se citeste din HTML (_text_editor: liniile lipite cu
    # \n), iar \r din brief (CRLF), linia goala finala pe care Quill o poate adauga si tab-urile / spatiile de la capetele liniilor nu au o
    # forma garantata in <p> -> fara comprimare, un brief cu mai multe linii ar putea fi refuzat fals. Testat cu randari Quill in HTML
    # (teste: TestUltimaPazaR18). Ce NU se comprima: NBSP (Quill are white-space: pre-wrap, deci Chrome pastreaza
    # spatiile obisnuite; un NBSP in editor si spatiu in brief = nepotrivire) si caracterele invizibile (prezente in editor, absente din
    # brief = nepotrivire, text_neintrat). Daca la 5a prima diferenta arata U+00A0, e o decizie noua (commit + review), nu o exceptie tacuta.
    return SPATII_COMPARATIE.sub(" ", t or "").strip(" ")


def _cod_la(s, i):
    # r17: caracterul de la prima diferenta, ca punct de cod (operatorul vede si un invizibil); "sfarsit" = textul s-a terminat
    return "U+%04X" % ord(s[i]) if i < len(s) else "sfarsit"


def verifica_ciorna(text_editor, brief, n_atasamente):
    # inainte de Enter: ciorna nu are atasamente si contine EXACT brief-ul (dupa normalizeaza: doar spatiile albe HTML comprimate) - nimic
    # in plus, nimic lipsa, niciun caracter invizibil in plus
    if n_atasamente:
        raise GemEroare("ciorna_cu_atasamente", "%d atasament(e) in ciorna - nu trimit" % n_atasamente)
    a, b = normalizeaza(text_editor), normalizeaza(brief)
    if a != b:
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
        raise GemEroare("text_neintrat", "ciorna difera de brief (%d/%d car. normalizate, prima diferenta la %d: editor %s, brief %s)"
                        % (len(a), len(b), i, _cod_la(a, i), _cod_la(b, i)))


# --- v4.6.4: ciorna citita din HTML-ul paginii (page.content()), analizata aici, fara browser ---

class _Nod(object):
    __slots__ = ("tag", "attrs", "parinte", "copii", "date")

    def __init__(self, tag, attrs, parinte, date=""):
        self.tag = tag
        self.attrs = attrs
        self.parinte = parinte
        self.copii = []
        self.date = date                    # r2: textul unui nod "#text"


class _Arbore(HTMLParser):
    # arbore minim din HTML; etichetele neinchise se inchid la eticheta de sfarsit a unui stramos
    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.radacina = _Nod("#document", {}, None)
        self.stiva = [self.radacina]

    def _nod(self, tag, attrs):
        n = _Nod(tag, dict((k, "" if v is None else v) for k, v in attrs), self.stiva[-1])
        self.stiva[-1].copii.append(n)
        return n

    def handle_starttag(self, tag, attrs):
        n = self._nod(tag, attrs)
        if tag not in VOIDE:
            self.stiva.append(n)

    def handle_startendtag(self, tag, attrs):
        self._nod(tag, attrs)

    def handle_endtag(self, tag):
        for i in range(len(self.stiva) - 1, 0, -1):
            if self.stiva[i].tag == tag:
                del self.stiva[i:]
                return

    def handle_data(self, data):
        # r2: textul afisat (ex. numele unui fisier) intra in arbore ca nod "#text" sub elementul curent
        if data:
            self.stiva[-1].copii.append(_Nod("#text", {}, self.stiva[-1], data))


def _descendenti(n):
    st = list(reversed(n.copii))
    while st:
        x = st.pop()
        yield x
        st.extend(reversed(x.copii))


def _cu_descendenti(n):
    # r6 (Jakarinos r5 P1): elementul INSUSI, apoi descendentii lui - zona de compunere se verifica si ea, nu doar continutul ei
    yield n
    for x in _descendenti(n):
        yield x


def _clase(n):
    return (n.attrs.get("class") or "").split()


def _e_zona(n):
    # = ZONA: input-area-v2, input-container, .input-area-container, .input-area
    return n.tag in ZONA_TAGURI or any(c in ZONA_CLASE for c in _clase(n))


def _e_editor(n):
    # = EDITOR: rich-textarea > div[role="textbox"][contenteditable="true"] (valori exacte, ca in CSS).
    # r17 (Jakarinos NO-GO r6: "exceptia editorului acopera si elemente al caror text nu e comparat cu brief-ul"): EDITORUL PRINCIPAL e
    # EXACT elementul al carui text se compara cu brief-ul (trimite: locatorul EDITOR, unic) - div cu role="textbox" si contenteditable=
    # "true", copil DIRECT al lui rich-textarea (ca in capturile c23n gol / mediu / lung si atributele 22.11). Doar el poarta contextul
    # in_editor (textul lui nu e "text necunoscut"). Trebuie sa fie UNIC in pagina: analizeaza_arbore il numara, verifica_fara_atasamente
    # refuza orice alt numar decat 1. div.ql-clipboard si orice alt element contenteditable NU sunt editor (_e_clipboard / _semnal).
    p = n.parinte
    return (n.tag == "div" and n.attrs.get("role") == "textbox" and n.attrs.get("contenteditable") == "true"
            and p is not None and p.tag == "rich-textarea")


def _e_clipboard(n):
    # r17: div.ql-clipboard al lui Quill, permis DOAR exact cum apare in toate capturile (c23n gol / mediu / lung: atributele
    # CLIPBOARD_ATRIBUTE, text propriu gol, niciun descendent): atributele EXACT acestea (niciunul in plus / lipsa / alta valoare), FARA
    # niciun copil (nici text, nici spatii albe: gol pe textul brut, nici element), copil direct al unui rich-textarea care are exact un
    # editor principal si exact un astfel de clipboard printre copii. Textul lui NU se compara cu brief-ul, deci nu are voie sa aiba text.
    # v4.6.5 (varianta B): identitatea clipboard-ului nu mai cere atributele EXACTE (CLIPBOARD_ATRIBUTE ramane forma vazuta, pe lista
    # alba prin ATRIBUTE_PERMISE): _forma_clipboard = div, clasa ql-clipboard (fara alt token negenerat), contenteditable="true", FARA niciun
    # copil. Restul atributelor lui sunt decor (_acceptat -> avertisment). Strict raman: golul, unicitatea, locul langa editorul unic.
    p = n.parinte
    if not _forma_clipboard(n) or p is None or p.tag != "rich-textarea":
        return False
    return (sum(1 for c in p.copii if _e_editor(c)) == 1
            and sum(1 for c in p.copii if _forma_clipboard(c)) == 1)


def _forma_clipboard(n):
    # v4.6.5: forma minima a lui div.ql-clipboard (vezi _e_clipboard): gol pe textul brut = niciun copil (nici text, nici spatii, nici element)
    return (n.tag == "div" and [c for c in _clase(n) if not _generat(c)] == ["ql-clipboard"]
            and n.attrs.get("contenteditable") == "true" and not n.copii)


def _e_semn(n):
    # = ATAS (semne largi, se pot suprapune; nu numara fisiere)
    if n.tag in SEMN_TAGURI:
        return True
    dt = n.attrs.get("data-test-id")
    if dt is not None and any(s in dt for s in SEMN_DATA_TEST):
        return True
    return SEMN_CLASA in (n.attrs.get("class") or "")


def _sub(n, stramos):
    p = n.parinte
    while p is not None:
        if p is stramos:
            return True
        p = p.parinte
    return False


# --- r2: verificarea POZITIVA a structurii ciornei (tot ce nu e recunoscut = ciorna_necunoscuta) ---

_LATIME_ZERO = "".join(map(chr, (0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF)))     # doar _ascii (cautare / afisare); r17: normalizeaza NU le mai scoate


def _ascii(s):
    # comparare / afisare: fara diacritice (NFKD) si caractere de latime zero, ASCII, litere mici, spatii albe comprimate
    t = unicodedata.normalize("NFKD", s or "")
    t = "".join(c for c in t if not unicodedata.combining(c) and c not in _LATIME_ZERO)
    return " ".join(t.encode("ascii", "replace").decode("ascii").lower().split())


def _semnatura(n):
    # forma exacta folosita de listele albe si afisata de `stare`: tag[atr=valoare]...[cheie]...
    s = _ascii(n.tag)[:40]
    for k in SEMN_ATR_VALOARE:
        if k in n.attrs:
            s += "[%s=%s]" % (k, _ascii(n.attrs[k])[:60])
    for k in SEMN_ATR_CHEIE:
        if k in n.attrs:
            s += "[%s]" % k
    return s


def _semnificativ(n):
    # element cu eticheta, rol, actiune sau sursa: nu e "neutru", trebuie recunoscut explicit
    rol = _ascii(n.attrs.get("role"))
    if rol and rol not in ROLURI_NEUTRE and not (rol == "img" and n.tag in ICON_TAGURI):
        return True
    if any(k in n.attrs for k in SEMN_ATR_VALOARE if k != "role") or any(k in n.attrs for k in SEMN_ATR_CHEIE):
        return True
    return any(k.startswith("aria-") and k != "aria-hidden" for k in n.attrs)


def _cuvant(t, cuvinte=TOKENI_ATAS):
    # primul cuvant de atasament din textul ASCII t (sau None)
    return next((x for x in cuvinte if x in t), None)


def _generat(nume):
    # clase / atribute generate de Angular la fiecare build (ng-tns-c12-3, ng-star-inserted, _ngcontent-ng-c123): nu se afiseaza
    return nume.startswith(("ng-", "_ng"))


def _semnatura_token(n):
    # r4: semnatura unui element cu semnal de atasament: + clasele (fara cele generate), id-ul si NUMELE tuturor atributelor din
    # afara semnaturii (data-*, necunoscute - ex. removeattachment -, style, fara cele generate), ca sursa semnalului sa se vada in `stare`
    clase = [c for c in _clase(n) if not _generat(c)]
    atribute = sorted(k for k in n.attrs if k not in ATRIBUTE_AFISATE_SEPARAT and k not in SEMN_ATR_VALOARE
                      and k not in SEMN_ATR_CHEIE and not _generat(k))
    parti = clase + (["#" + n.attrs["id"]] if n.attrs.get("id") else []) + atribute
    return _semnatura(n) + "{" + _ascii(" ".join(parti))[:SEMNATURA_TOKEN_AFISATA] + "}"


def _nume_fisier(a):
    # r3: primul nume.extensie din textul ASCII `a` (sau None). O potrivire al carei cuvant intreg (extins peste CARACTERE_NUME
    # in ambele sensuri) e EXACT un domeniu din DOMENII_FIRMA nu e fisier; orice alt cuvant care o cuprinde (gazpet.ro.pdf,
    # a.gazpet.ro.docx, gazpet.rox, www.gazpet.ro) ramane fisier. Singura definitie, folosita de texte si de etichete.
    for m in RE_FISIER.finditer(a):
        i, j = m.start(), m.end()
        while i > 0 and a[i - 1] in CARACTERE_NUME:
            i -= 1
        while j < len(a) and a[j] in CARACTERE_NUME:
            j += 1
        if a[i:j] in DOMENII_FIRMA:
            continue
        return m.group(0)
    return None


def _eticheta_interzisa(n):
    # eticheta (toate atributele cu valoare din semnatura: aria-label, title, alt, type, role, data-test-id...) cu cuvant de
    # atasament (in afara celor de incarcare) sau cu nume de fisier: nicio lista alba nu o acopera. r8: intoarce (atribut, valoare ASCII)
    # al primului atribut vinovat (sursa afisata de `stare`) sau None; cuvintele si numele n-au spatii, deci verificarea atribut cu
    # atribut decide la fel ca pe textul lor lipit (cum era pana la r7)
    for k in SEMN_ATR_VALOARE:
        if k not in n.attrs:
            continue
        t = _ascii(n.attrs.get(k))
        if _cuvant(t, TOKENI_ETICHETA_INTERZISA) is not None or _nume_fisier(t) is not None:
            return k, t
    return None


def _marcaj_permis(n, k):
    # r5 / r8 / r9: atributul k al elementului n e un marcaj din MARCAJE_PERMISE: numele EXACT (nu prefix / sufix / subsir), pe tagul exact,
    # cu clasele (fara cele generate) EXACT una din multimile listei (r11), cu valoarea BRUTA de forma ceruta (goala / valoarea reala exacta) si - daca marcajul
    # cere element izolat (r9) - fara niciun alt atribut in afara clasei si a celor generate `_ng*` GOALE, fara niciun copil (element sau text
    # cu continut). Doar atunci numele lui nu intra in cautarea cuvintelor de atasament; valoarea ramane verificata in _semnal (pasul 4) ca
    # orice alta valoare. Orice abatere = atributul se verifica ca oricare altul (refuz).
    # r10: pe elementul izolat mai pot sta DOAR atributele din campul `goale` (nume exact), cu valoarea bruta goala / doar spatii albe HTML
    # (VALOARE_SPATII, fullmatch); orice continut in ele = elementul nu e izolat (refuz).
    for tag, clase, nume, forma, izolat, goale in MARCAJE_PERMISE:
        if k != nume:
            continue
        if n.tag != tag or not any(set(c for c in _clase(n) if not _generat(c)) == set(x) for x in clase):
            continue
        if not forma.fullmatch(n.attrs.get(k) or ""):
            continue
        if izolat and any(a != k and a != "class" and not (_generat(a) and v == "") and not (a in goale and VALOARE_SPATII.fullmatch(v)) for a, v in n.attrs.items()):
            continue
        if izolat and any(c.tag != "#text" or not VALOARE_SPATII.fullmatch(c.date) for c in n.copii):   # r15: text brut, doar spatii HTML
            continue
        return True
    return False


def _valoare_permisa(n, k):
    # r9: VALOAREA atributului k al elementului n e una din VALORI_PERMISE: tagul exact, numele exact, valoarea EXACT egala (dupa _ascii, ca
    # etichetele din listele albe) si fiecare atribut cerut alaturi cu valoarea lui bruta EXACTA. Doar atunci valoarea nu intra in cautarea
    # cuvintelor / numelor de fisier (pasul 4 din _semnal); numele atributului se verifica oricum (pasul 2). Orice abatere = valoarea se
    # verifica ca oricare alta (refuz).
    for tag, nume, valoare, cerute in VALORI_PERMISE:
        if k != nume or n.tag != tag:
            continue
        if n.attrs.get(k) != valoare:                   # r15: valoarea BRUTA, Unicode exact (fara _ascii)
            continue
        if any(n.attrs.get(a) != v for a, v in cerute):
            continue
        return True
    return False


def _clase_verificate(n):
    # r9: clasele elementului care intra in cautarea cuvintelor / numelor de fisier: toate, in afara token-urilor EXACTE din CLASE_EDITOR_PERMISE
    # si doar pe editor (_e_editor). Comparatia e pe token-ul intreg, brut (nu subsir / prefix / fara litere mari). Afisarea (_semnatura_token)
    # arata in continuare toate clasele.
    if not _e_editor(n):
        return _clase(n)
    return [c for c in _clase(n) if c not in CLASE_EDITOR_PERMISE]


def _gazda_permisa(gazda):
    return any(gazda == d or gazda.endswith("." + d) for d in HREF_GAZDE_FARA_FISIER)


def _fara_gazda_permisa(k, v):
    # r5: valoarea atributului k, ca text ASCII, pentru cautarea nume.extensie. SINGURA exceptie: in `href` cu schema http / https si
    # gazda (hostname EXACT) din HREF_GAZDE_FARA_FISIER sau subdomeniu al ei, gazda e scoasa (un hostname nu e fisier); schema,
    # utilizatorul, calea, parametrii, interogarea si fragmentul raman si se verifica integral. Orice alt URL (blob:, data:, alt host,
    # relativ) sau atribut (src, srcset, style, data-*, necunoscute) = textul intreg.
    a = _ascii(v)
    if k != "href":
        return a
    try:
        u = urlparse(v.strip())
    except Exception:
        return a
    gazda = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not gazda or not _gazda_permisa(gazda):
        return a
    return _ascii(" ".join([u.scheme, u.username or "", u.password or "", u.path, u.params, u.query, u.fragment]))


def _semnal(n):
    """r4 (Jakarinos r3 P1): primul semn de atasament purtat de elementul INSUSI, ca motiv de refuz (sau None). Se verifica
    INAINTEA oricarei acceptari si pe ORICE element (neutru, din listele albe, zona / rich-textarea, butonul modelului, editorul).
    r7 (Jakarinos r6 P1): SINGURA functie de semnale - apelata dintr-un singur loc (_motiv_element) pentru toate nivelurile (zona,
    invelisuri, editor, descendentii editorului, descendentii zonei); nicio cale separata nu mai verifica altceva. v4.6.5 r2: al doilea
    apel, din _semnale_tinta = aceeasi functie pe tintele descrierilor (aria-describedby / aria-labelledby, de obicei in afara zonei). Ordinea:
    (0) r7: elementul e media (img, picture, video, audio, canvas, object, embed, iframe, image, source, track) -> "media:<semnatura>";
        style cu "url(" (miniatura pusa ca imagine de fundal) -> "fundal:<semnatura>";
    (1) eticheta (atributele cu valoare din semnatura): cuvant interzis sau nume.extensie -> "eticheta:<semnatura>";
    (2) cuvant de atasament in orice clasa, in id sau in NUMELE oricarui atribut (si data-*, si necunoscute: removeattachment)
        -> "token_<cuvant>:<semnatura>{clase #id atribute}"; r5 / r8 / r9: singurele nume exceptate sunt marcajele din MARCAJE_PERMISE,
        fiecare doar pe elementul lui, cu valoarea de forma ceruta (_marcaj_permis); r9: singurele clase exceptate sunt token-urile
        EXACTE din CLASE_EDITOR_PERMISE, doar pe editor (_clase_verificate);
    (3) r5: nume.extensie intr-o clasa sau in id -> "atribut_fisier:...";
    (4) in VALOAREA oricarui atribut din afara semnaturii (data-*, aria-description, necunoscute, style, href / src / srcset):
        cuvant -> "token_...", nume.extensie -> "atribut_fisier:..."; r5: si in URL-uri si in style, singura exceptie fiind gazda
        Google a unui href http(s) (_fara_gazda_permisa); blob: / data: / alt host / src / srcset = textul intreg; r9: singura valoare
        exceptata e cea EXACTA din VALORI_PERMISE, pe elementul si cu atributele cerute (_valoare_permisa).
    (5) r17: atributul contenteditable (orice valoare, si "", "false", "plaintext-only") pe ORICE element in afara editorului principal
        (_e_editor) si a clipboard-ului Quill gol, exact (_e_clipboard) -> "editabil:<semnatura>{...}": al doilea editor, clipboard cu text /
        copii / alte atribute, contenteditable in editor sau in zona. Ultimul pas: semnalele de atasament de mai sus au prioritate la afisare.
        v4.6.5: si elementele EDITABILE_TAGURI (textarea / input / select) -> "editabil:..." (sursa "tag:<tag>"); clipboard-ul = forma
        minima (_forma_clipboard), nu atributele exacte.
    Tagul (in afara celor media) nu e semnal: el E semnatura, comparata exact cu lista (file-drop-indicator a fost vazut gol de om
    la calibrare). v4.6.5: tagul E semnal daca are un cuvant de atasament (<attachment-card>), in afara lui file-drop-indicator gol
    (_tag_permis), iar un URL local de fisier (blob: / filesystem: / data:) in orice valoare = atribut_fisier: - dupa pasul (4), inaintea
    pasului (5), ca motivele de pana la v4.6.4f sa ramana neschimbate.
    Textele si descendentii elementului se verifica mai departe, element cu element (_motiv_text / _necunoscute).
    r8: intoarce (motiv, sursa) sau None. Sursa = "<fel>:<unde>=<valoare>" (fel: tag / style / eticheta / clasa / id / nume_atribut /
    valoare_atribut), afisata de `stare` sub linia `necunoscut`; NU intra in nicio decizie (motivul e neschimbat), e doar locul exact
    al cuvantului / numelui, ca o linie de pe pagina reala sa nu mai ramana nelamurita (5a din 22.11.2026: sursa taiata din {...}).
    r9: cele trei exceptii de pe pagina din 22.11 (marcaj / valoare / clase) sunt toate aici, cate una pe element, prin ajutatoare pure
    apelate doar din aceasta functie (si din _sursa_cuvant, pentru afisare)."""
    sem = _semnatura(n)
    if n.tag in MEDIA:
        return "media:" + sem, "tag:" + n.tag
    if "url(" in _ascii(n.attrs.get("style")):
        return "fundal:" + sem, "style:" + _ascii(n.attrs.get("style"))[:SURSA_AFISATA]
    e = _eticheta_interzisa(n)
    if e:
        return "eticheta:" + sem, "eticheta:%s=%s" % (e[0], e[1][:SURSA_AFISATA])
    clase_id = _ascii(" ".join(_clase_verificate(n) + [n.attrs.get("id") or ""]))
    nume_atribute = _ascii(" ".join(k for k in n.attrs if not _marcaj_permis(n, k)))
    t = _cuvant(clase_id + " " + nume_atribute)
    if t:
        return "token_%s:%s" % (t, _semnatura_token(n)), _sursa_cuvant(n, t)
    f = _nume_fisier(clase_id)
    if f is not None:
        return "atribut_fisier:" + _semnatura_token(n), _sursa_cuvant(n, f)
    for k, v in n.attrs.items():
        if k in ATRIBUTE_AFISATE_SEPARAT or k in SEMN_ATR_VALOARE or not v or _valoare_permisa(n, k):
            continue
        a = _ascii(v)
        t = _cuvant(a)
        if t:
            return "token_%s:%s" % (t, _semnatura_token(n)), "valoare_atribut:%s=%s" % (k, a[:SURSA_AFISATA])
        if _nume_fisier(_fara_gazda_permisa(k, v)) is not None:
            return "atribut_fisier:" + _semnatura_token(n), "valoare_atribut:%s=%s" % (k, a[:SURSA_AFISATA])
    # v4.6.5: dupa semnalele de pana la v4.6.4f (motivele si sursele lor raman neschimbate acolo unde exista deja un semnal)
    t = _cuvant(_ascii(n.tag))
    if t and not _tag_permis(n):                # (a) cuvant de atasament in numele tagului
        return "token_%s:%s" % (t, _semnatura_token(n)), "tag:" + _ascii(n.tag)[:SURSA_AFISATA]
    for k, v in n.attrs.items():                # (b) URL local de fisier in orice valoare (si in etichete)
        if RE_URL_LOCAL.search(_ascii(v)):
            return "atribut_fisier:" + _semnatura_token(n), "valoare_atribut:%s=%s" % (k, _ascii(v)[:SURSA_AFISATA])
    if "contenteditable" in n.attrs and not _e_editor(n) and not _e_clipboard(n):
        return "editabil:" + _semnatura_token(n), "contenteditable:%s=%s" % (n.tag, _ascii(n.attrs["contenteditable"])[:SURSA_AFISATA])
    if n.tag in EDITABILE_TAGURI:
        return "editabil:" + _semnatura_token(n), "tag:" + n.tag          # v4.6.5: textarea / input / select (camp editabil in plus)
    return None


def _tag_permis(n):
    # v4.6.5: tagul cu cuvant de atasament e permis DOAR daca e in TAGURI_CU_CUVANT_PERMISE si elementul e GOL (copii doar text din spatii albe HTML)
    return n.tag in TAGURI_CU_CUVANT_PERMISE and all(c.tag == "#text" and VALOARE_SPATII.fullmatch(c.date) for c in n.copii)


def _sursa_cuvant(n, t):
    # r8: unde sta textul t (cuvant de atasament sau nume.extensie gasit de _semnal in clase / id / numele atributelor): prima clasa, apoi
    # id-ul, apoi primul nume de atribut (cu valoarea lui, ca la 5a sa se vada si ce poarta - ex. data-filedrop-id=<valoare>). Doar afisare.
    # r9: aceleasi clase / nume ca in _semnal (fara token-urile si marcajele scutite), ca sursa sa fie chiar locul care a dat semnalul
    for c in _clase_verificate(n):
        if t in _ascii(c):
            return "clasa:" + _ascii(c)[:SURSA_AFISATA]
    if t in _ascii(n.attrs.get("id")):
        return "id:" + _ascii(n.attrs.get("id"))[:SURSA_AFISATA]
    for k, v in n.attrs.items():
        if t in _ascii(k) and not _marcaj_permis(n, k):
            return "nume_atribut:%s=%s" % (k, _ascii(v)[:SURSA_AFISATA])
    return "?:" + t                                          # (nu se ajunge: t vine chiar din aceste texte)


def _loc_text(nod, ctrl, zona):
    # r16: LOCUL unui nod text (prima componenta a perechilor din TEXTE_CUNOSCUTE): in controlul ctrl -> LOC_MODEL (butonul modelului) /
    # semnatura controlului; in afara controalelor -> semnatura celui mai apropiat stramos din STRUCTURA_CUNOSCUTA, cautat DOAR pana la
    # zona (exclusiv); altfel LOC_ZONA
    if ctrl is not None:
        return LOC_MODEL if ctrl.attrs.get("data-test-id") == MODEL_DATA_TEST else _semnatura(ctrl)
    p = nod.parinte
    while p is not None and p is not zona:
        s = _semnatura(p)
        if s in STRUCTURA_CUNOSCUTA:
            return s
        p = p.parinte
    return LOC_ZONA


def _vizibil(b):
    # r16: textul unui motiv cand forma ASCII e goala (doar caractere invizibile / combinate / de control): escape-uri Python (\u0301,
    # \xa0, \x0b), ca operatorul sa vada ce e acolo
    return b.encode("unicode_escape").decode("ascii")


def _intrari_atribut(tag, k):
    # r14: intrarile din ATRIBUTE_PERMISE pentru numele EXACT k pe tagul `tag` ("*" = orice tag)
    return [forma for taguri, nume, forma in ATRIBUTE_PERMISE if nume == k and (tag in taguri or "*" in taguri)]


def _style_gol(k, v):
    # v4.6.4f: atributul cu numele EXACT `style` si valoarea BRUTA EXACT sirul vid (nu spatii, nu NBSP) - permis pe orice element care
    # ajunge la _atribut_strain (adica deja acceptat de _motiv_element: semnalele, tagul / controlul / structura sunt verificate inainte)
    return k == "style" and v == ""


def _atribut_strain(n):
    # r14: primul atribut al elementului n care NU e in lista alba -> (fel, nume, valoare ASCII afisata), fel = "atribut_necunoscut" (numele
    # nu e permis pe tagul lui) / "atribut_valoare" (numele e permis, valoarea nu se potriveste integral cu nicio forma); altfel None.
    # Generatele Angular (ATR_GENERAT, nume EXACT de forma lor) doar cu valoarea bruta goala. r15: valoarea se compara BRUTA (Unicode exact,
    # fara _ascii); _ascii ramane doar la afisare (linia `sursa`). v4.6.4f: `style=""` (EXACT gol) trece pe orice tag (_style_gol); style
    # cu orice continut se clasifica neschimbat (formele exacte de pe tag din ATRIBUTE_PERMISE).
    for k, v in n.attrs.items():
        if ATR_GENERAT.fullmatch(k):
            if v == "":
                continue
            return "atribut_valoare", k, _ascii(v)
        if _style_gol(k, v):
            continue
        intrari = _intrari_atribut(n.tag, k)
        if not intrari:
            return "atribut_necunoscut", k, _ascii(v)
        if not any(forma.fullmatch(v) for forma in intrari):
            return "atribut_valoare", k, _ascii(v)
    return None


def _acceptat(n, ctrl_copii, in_editor=False):
    # r13 / r14: SINGURUL punct de acceptare din _motiv_element (toate caile care intorc "recunoscut"): elementul e acceptat doar daca
    # TOATE atributele lui sunt in lista alba (_atribut_strain); altfel `atribut_necunoscut:` / `atribut_valoare:` (in editor cu prefixul
    # semnal_in_editor:), copiii se verifica in continuare cu acelasi context
    a = _atribut_strain(n)
    if a is None:
        return None, ctrl_copii, ""
    m = "%s:%s{%s}" % (a[0], _semnatura(n), a[1])
    return ("semnal_in_editor:" + m if in_editor else m), ctrl_copii, "%s:%s=%s" % (a[0], a[1], a[2][:SURSA_AFISATA])


def _text_nod(x):
    # textul afisat al unui element (toate nodurile text din el), ASCII - pentru cautarea cuvintelor / numelor de fisier si afisare
    return _ascii(" ".join(d.date for d in _descendenti(x) if d.tag == "#text"))


def _text_brut(x):
    # r15: textul BRUT al unui element (nodurile text lipite, ca textContent), fara nicio normalizare - pentru comparatia cu listele
    return "".join(d.date for d in _descendenti(x) if d.tag == "#text")


def _motiv_descriere(n, ids):
    # r13 / r14: DESCRIEREA unui element acceptat (aria-describedby -> fiecare element cu acel id, cautat in toata pagina, in zona sau in
    # afara ei - de obicei containerul CDK). Nume.extensie / cuvant de atasament = `descriere_fisier:` / `descriere_atasament:`; r14: tinta
    # cu alt atribut decat `id` / ATRIBUTE_TINTA_DESCRIERE sau cu un element in ea = `descriere_structura:`; textul ei BRUT (r15: Unicode
    # exact, fara _ascii) nevid si in afara listei inchise DESCRIERI_CUNOSCUTE = `descriere_text:` (refuz). Identificator lipsa = nicio
    # descriere afisata. Cautarea cuvintelor / numelor de fisier ramane pe textul ASCII (mai larga = mai multe refuzuri, nu mai putine).
    # v4.6.5 r2 (Jakarinos NO-GO P1 pe #1176: `aria-describedby="d1 d2"` cu d1 decor si d2 = oferta.pdf trecea, iar `d2 d1` era refuzat):
    # se parcurg TOATE referintele (_referinte: aria-describedby SI aria-labelledby; fiecare id; fiecare element cu acel id) si se ADUNA
    # TOATE motivele fiecarei tinte (fara return la primul gasit). Un motiv BLOCANT castiga intotdeauna, oricare ar fi ordinea id-urilor sau
    # a motivelor; altfel primul avertisment (decor), in ordinea de pana la r1; altfel None. Nou: semnalele de atasament PE tinta si IN ea
    # (_semnale_tinta: <img>, blob:, cuvinte in clase / atribute) = `descriere_semnal:` (BLOCANT; pana la r1 = descriere_structura, decor).
    motive = []
    for tok in _referinte(n):
        for x in ids.get(tok, ()):
            a = _text_nod(x)
            sursa = "descriere:%s=%s" % (tok[:60], a[:SURSA_AFISATA])
            if _nume_fisier(a) is not None:
                motive.append(("descriere_fisier:%s{%s}" % (_semnatura(n), a[:TEXT_AFISAT]), sursa))
            if _cuvant(a) is not None:
                motive.append(("descriere_atasament:%s{%s}" % (_semnatura(n), a[:TEXT_AFISAT]), sursa))
            motive.extend(_semnale_tinta(n, tok, x))
            for k, v in x.attrs.items():
                if k != "id" and not any(k == nume and forma.fullmatch(v) for nume, forma in ATRIBUTE_TINTA_DESCRIERE):
                    motive.append(("descriere_structura:%s{%s}" % (_semnatura(n), k),
                                   "descriere_atribut:%s=%s" % (k, _ascii(v)[:SURSA_AFISATA])))
            e = next((d for d in _descendenti(x) if d.tag != "#text"), None)
            if e is not None:
                motive.append(("descriere_structura:%s{%s}" % (_semnatura(n), _ascii(e.tag)[:40]), "descriere_element:" + _semnatura(e)))
            b = _text_brut(x)
            if b != "" and b not in DESCRIERI_CUNOSCUTE:          # r15: Unicode EXACT (fara _ascii / strip / spatii comprimate)
                motive.append(("descriere_text:%s{%s}" % (_semnatura(n), a[:TEXT_AFISAT]), sursa))
    blocante = [m for m in motive if not _e_avertisment(m[0])]
    return (blocante or motive or [None])[0]


def _referinte(n):
    # v4.6.5 r2: id-urile referite de n, din TOATE atributele ATRIBUTE_REFERINTA (aria-describedby, apoi aria-labelledby), in ordine
    return [tok for atr in ATRIBUTE_REFERINTA for tok in (n.attrs.get(atr) or "").split()]


def _semnale_tinta(n, tok, x):
    # v4.6.5 r2: semnalele de atasament (_semnal, aceeasi functie ca in zona) pe tinta x insasi si pe FIECARE element din ea -> lista de
    # (`descriere_semnal:<semnatura lui n>{<motivul semnalului>}`, `descriere_<sursa semnalului>`), toate BLOCANTE
    return [("descriere_semnal:%s{%s}" % (_semnatura(n), s[0][:TEXT_AFISAT]), "descriere_%s=%s" % (tok[:60], s[1][:SURSA_AFISATA]))
            for s in (_semnal(d) for d in _cu_descendenti(x) if d.tag != "#text") if s]


def _motiv_text(nod, ctrl, zona=None):
    # ctrl = controlul recunoscut (din lista alba / butonul modelului) in care sta textul, sau None; zona = zona analizata (limita lui _loc_text)
    # r16 (Jakarinos NO-GO r15): LISTA ALBA si pentru nodurile text. `b` = textul BRUT din care se scot DOAR spatiile albe HTML de la capete
    # (spatiu, \t, \n, \r, \f - indentarea sablonului); b == "" = gol, singurul text acceptat fara lista. ORICE alt text (si U+0301, U+200B,
    # NBSP: _ascii le sterge, dar NU mai decide golul) e acceptat doar daca perechea (locul lui, b) e EXACT in TEXTE_CUNOSCUTE sau, intr-o
    # iconita mat-icon, daca b e EXACT o ligatura vazuta (LIGATURI_VAZUTE, goala). Intr-un control (oricare) = `text_in_control:`, altfel
    # `text:` (refuz). `a` (ASCII) doar pentru cautarea cuvintelor / numelor de fisier si afisare.
    b = nod.date.strip(" \t\n\r\f")
    if b == "":
        return None                                     # gol pe textul brut (doar spatii albe HTML)
    a = _ascii(nod.date)
    v = (a or _vizibil(b))[:TEXT_AFISAT]
    if _nume_fisier(a) is not None:
        return "text_fisier:" + v                       # nume.extensie: refuz chiar si intr-un control cunoscut / text din lista
    if _cuvant(a) is not None:
        return "text_atasament:" + v                    # r4: cuvant de atasament: refuz chiar si intr-un control / text din lista
    if (_loc_text(nod, ctrl, zona), b) in TEXTE_CUNOSCUTE:
        return None                                     # r16: textul EXACT vazut pe acest loc
    p = nod.parinte
    if p is not None and p.tag == "mat-icon" and b in LIGATURI_VAZUTE:
        return None                                     # r16: ligatura EXACTA vazuta (lista inchisa, goala)
    return ("text_in_control:" if ctrl is not None else "text:") + v


def _motiv_element(n, ctrl, in_editor=False):
    # -> (motiv sau None, controlul recunoscut in care sunt copiii - sau None, sursa semnalului - "" cand nu e semnal; r8)
    # r7 (Jakarinos r6 P1): ORICE element analizat (zona, invelisurile de incredere, editorul, descendentii editorului, descendentii
    # zonei) trece pe aici, iar primul pas e ACEEASI functie de semnale, _semnal (media, fundal CSS, eticheta, clase, id, numele si
    # valorile tuturor atributelor, URL-uri, style). Nicio alta cale nu verifica semnale: un element cu semnal e refuzat oricare ar fi
    # nivelul, contextul sau lista.
    # r4 (Jakarinos r3 P1): semnalele se verifica INAINTEA oricarei acceptari (editor, structura, neutru, liste albe, butonul
    # modelului); mutantul care muta blocul dupa liste e prins de teste
    sem = _semnatura(n)
    s = _semnal(n)
    if s:
        return ("semnal_in_editor:" + s[0] if in_editor else s[0]), ctrl, s[1]
    if in_editor:
        # in editor intra doar textul brief-ului (comparat separat, verifica_ciorna, pe textul citit din HTML - _text_editor)
        # r18: editorul insusi = atributele lui pe lista alba; in el DOAR p / br (EDITOR_TAGURI) si FARA niciun atribut (nici cele permise
        # pe p in afara editorului, ex. data-test-id); orice alt element = nerecunoscut (nicio lista alba nu se consulta in editor)
        if _e_editor(n):
            return _acceptat(n, ctrl)                   # v4.6.5: atributele editorului INSUSI = decor (avertisment, fara prefixul editorului)
        if n.tag not in EDITOR_TAGURI:
            return "element_in_editor:" + sem, ctrl, ""
        r = _acceptat(n, ctrl, True)
        if r[0] is None and n.attrs:
            k = sorted(n.attrs)[0]
            return ("semnal_in_editor:atribut_in_editor:%s{%s}" % (sem, _ascii(k)[:40]), ctrl,
                    "atribut_in_editor:%s=%s" % (_ascii(k)[:40], _ascii(n.attrs[k])[:SURSA_AFISATA]))
        return r
    if _e_clipboard(n):
        return _acceptat(n, ctrl)                       # r17: div.ql-clipboard gol, exact ca in capturi (fara copii: nimic de citit in el)
    # r13: fiecare acceptare de mai jos trece prin _acceptat (atributele cu text = valori EXACTE cunoscute)
    if n.tag in STRUCTURA_TAGURI:
        return _acceptat(n, ctrl)                       # zona si invelisul editorului (aceleasi nume ca selectorii)
    if n.attrs.get("data-test-id") == MODEL_DATA_TEST:
        return _acceptat(n, n)                          # butonul modelului: verificat separat (verifica_model); textul lui = eticheta
    if n.tag in NEUTRE and not _semnificativ(n):
        return _acceptat(n, ctrl)                       # element neutru fara eticheta / rol / actiune (si fara semnal, mai sus)
    if sem in CONTROALE_CUNOSCUTE:
        return _acceptat(n, n)                          # control vazut la calibrare; textele din el = eticheta lui (verificate mai sus)
    if sem in STRUCTURA_CUNOSCUTA:
        return _acceptat(n, ctrl)                       # invelis vazut la calibrare; continutul lui se verifica mai departe
    return "element:" + sem, ctrl, ""


def _necunoscute(zona, editoare, ids=None):
    """Elementele / textele din zona (r6: SI ELEMENTUL ZONEI INSESI, primul verificat) care NU fac parte din structura recunoscuta
    a ciornei goale (lista de motive). Se sar DOAR chip-urile si semnele (numarate separat, si pe zona: orice chip / semn = refuz in
    verifica_fara_atasamente). r18 (Jakarinos NO-GO r7): script / style / template / noscript NU se mai sar (nici in zona, nici in
    editor) - sunt elemente ca oricare, fara loc in listele albe, deci refuz; textul lor (si al unui style care ar ascunde ceva) e nod text.
    r7: UN SINGUR traseu pentru toate elementele - fiecare (zona, invelisuri, editor, descendenti) trece prin
    _motiv_element (deci prin _semnal); editorul si descendentii lui poarta doar contextul in_editor, nu o alta functie.
    r8: lista de perechi (motiv, sursa); sursa e "" pentru motivele fara semnal (element: / text...)."""
    out = []
    st = [(zona, None, False)]              # r6 (Jakarinos r5 P1): zona insasi, cu aceleasi reguli ca orice element; apoi continutul ei
    while st:
        n, ctrl, in_editor = st.pop()
        if n.tag == "#text":
            if not in_editor:               # in editor sta textul brief-ului: se compara separat (verifica_ciorna), nu e "text necunoscut"
                m = _motiv_text(n, ctrl, zona)
                if m:
                    out.append((m, ""))
            continue
        if n.tag == CHIP or _e_semn(n):
            continue                        # numarate separat (atasamente / semne): refuz acolo
        if any(n is e for e in editoare):
            in_editor = True                # r7: editorul = acelasi traseu, cu context (nu o cale separata)
        m, ctrl_copii, sursa = _motiv_element(n, ctrl, in_editor)
        if m:
            out.append((m, sursa))
        if (not m or _e_avertisment(m)) and ids is not None:
            d = _motiv_descriere(n, ids)           # r13 / r14: descrierea unui element acceptat (tinta oriunde in pagina)
            if d:                                  # v4.6.5: si pe elementele cu avertisment (decor), nu doar pe cele acceptate
                out.append(d)
        if n is zona:
            ctrl_copii = None               # r6: zona e un invelis, niciodata un control (textele din ea nu sunt eticheta ei)
        if ctrl is not None:
            ctrl_copii = ctrl               # r12 / r16: sub ORICE control contextul ramane al lui (nimic imbricat nu-l inlocuieste)
        st.extend((c, ctrl_copii, in_editor) for c in reversed(n.copii))
    return out


def _text_editor(ed):
    """r18 (Jakarinos NO-GO r7 P1-1): textul editorului principal citit din HTML-ul BRUT (textContent pe arborele lui), nu din
    inner_text() - deci independent de CSS (un <style> / display:none nu mai poate ascunde un text din comparatie). Forma acceptata =
    exact ce produce Quill pentru un text: copiii editorului sunt DOAR <p> (niciun alt element si niciun text direct in editor, in afara
    separatorilor din doar spatii albe HTML intre paragrafe - fara continut, comprimati oricum de normalizeaza); un <p> contine fie DOAR
    noduri text (o linie a brief-ului), fie exact un <br> si nimic altceva (linia goala, <p><br></p>); niciun <p> gol, niciun <br> langa
    text, nimic imbricat. Liniile se lipesc cu \\n (comparatia comprima oricum spatiile albe HTML, normalizeaza).
    -> (text, None) sau (None, motiv "editor_structura:..."); motivul intra la necunoscute (analizeaza_arbore), deci refuz."""
    linii = []
    for p in ed.copii:
        if p.tag == "#text" and SPATII_COMPARATIE.fullmatch(p.date):
            continue                        # separator din spatii albe HTML intre paragrafe (fara continut)
        if p.tag != "p":
            return None, "editor_structura:%s direct in editor" % ("text" if p.tag == "#text" else _ascii(p.tag)[:40])
        if len(p.copii) == 1 and p.copii[0].tag == "br":
            linii.append("")                # linia goala Quill
            continue
        if not p.copii:
            return None, "editor_structura:p gol"
        for c in p.copii:
            if c.tag != "#text":
                return None, "editor_structura:%s in p" % _ascii(c.tag)[:40]
        linii.append("".join(c.date for c in p.copii))
    if not linii:
        return None, "editor_structura:editor fara paragraf"
    return "\n".join(linii), None


def analizeaza_ciorna(html):
    """HTML -> analiza (analizeaza_arbore). r20: folosit doar de teste / diagnostic pe capturi; trimite / stare analizeaza arborele
    din instantaneul CDP (_instantaneu -> _arbore_cdp), nu un HTML."""
    a = _Arbore()
    a.feed(html or "")
    HTMLParser.close(a)                     # inchide parserul HTML (nu browserul: canalul nu inchide nimic in Edge)
    return analizeaza_arbore(a.radacina)


def analizeaza_arbore(radacina, trunchiate=()):
    """arborele paginii (_Nod) -> dict: editoare, zone (zonele de compunere ale editoarelor, cele mai exterioare),
    atasamente (chip-uri CHIP cele mai exterioare din zone = fisiere), semne (elemente ATAS din zone), detalii.
    r20: trunchiate = nodurile text pe care CDP le-a taiat (> LIMITA_TEXT_CDP); unul in zona = necunoscut (textul real nu e cunoscut)."""
    editoare = [n for n in _descendenti(radacina) if _e_editor(n)]     # r17: editoarele PRINCIPALE din toata pagina (paza cere exact 1)
    zone = []
    for e in editoare:
        z, p = None, e.parinte
        while p is not None:
            if _e_zona(p):
                z = p                       # urc pana la zona cea mai exterioara (chip-urile pot sta langa editor, nu in el)
            p = p.parinte
        if z is not None and not any(z is x for x in zone):
            zone.append(z)
    zone = [z for z in zone if not any(_sub(z, x) for x in zone if x is not z)]
    atas, semne, detalii = 0, 0, {}
    for z in zone:
        for n in _cu_descendenti(z):        # r6: si zona insasi (un chip / semn pe elementul zonei se numara)
            if n.tag == CHIP:
                p, exterior = n.parinte, True
                while p is not None and p is not z:
                    if p.tag == CHIP:
                        exterior = False
                        break
                    p = p.parinte
                if exterior:
                    atas += 1
            if _e_semn(n):
                semne += 1
                c = _clase(n)
                k = (n.tag + ("." + c[0] if c else ""))[:60].encode("ascii", "replace").decode("ascii")
                detalii[k] = detalii.get(k, 0) + 1
    ids = {}                                # r13: elementele paginii dupa id (tinta lui aria-describedby; id dublat = toate)
    for n in _descendenti(radacina):
        if n.attrs.get("id"):
            ids.setdefault(n.attrs["id"], []).append(n)
    necunoscute = []                        # r2: verificarea pozitiva (tot ce nu e structura recunoscuta a ciornei goale)
    for z in zone:
        necunoscute.extend(_necunoscute(z, editoare, ids))
    for x in trunchiate:                    # r20: text taiat de CDP in zona (si in editor) = nu stiu ce scrie -> refuz
        if any(_sub(x, z) for z in zone):
            necunoscute.append(("text_trunchiat_cdp:%d unitati UTF-16 citite" % _u16(x.date), ""))
    # r18: textul editorului UNIC, din ACELASI arbore (acelasi instantaneu) ca atasamentele si necunoscutele; forma lui = regulile Quill
    text_editor = None
    if len(editoare) == 1:
        text_editor, m = _text_editor(editoare[0])
        if m:
            necunoscute.append((m, ""))
    # v4.6.5: "niciun alt contenteditable in PAGINA" - in afara zonelor (in zona: _semnal, pasul 5, orice valoare) un element cu valoare
    # editabila (orice in afara de "false", ca in HTML: "", "true", "plaintext-only", valori invalide mostenite) care nu e editorul
    # principal si nici clipboard-ul gol = refuz. contenteditable="false" (chip-uri needitabile in raspunsuri) nu e editabil.
    editabile_pagina = 0
    for n in _descendenti(radacina):
        if (n.tag != "#text" and "contenteditable" in n.attrs and n.attrs["contenteditable"].strip(" \t\n\r\f").lower() != "false"
                and not _e_editor(n) and not _e_clipboard(n) and not any(n is z or _sub(n, z) for z in zone)):
            editabile_pagina += 1
            necunoscute.append(("editabil_in_pagina:" + _semnatura_token(n),
                                "contenteditable:%s=%s" % (n.tag, _ascii(n.attrs["contenteditable"])[:SURSA_AFISATA])))
    # v4.6.5 (varianta B): `necunoscute` = TOT ce nu e recunoscut (diagnostic, aceeasi clasificare ca pana la v4.6.4f); decizia se ia
    # doar pe `blocante` (motivele din afara MOTIVE_AVERTISMENT - si orice motiv nou); decorul (MOTIVE_AVERTISMENT) = `avertismente`
    blocante = [x for x in necunoscute if not _e_avertisment(x[0])]
    avertismente = [x for x in necunoscute if _e_avertisment(x[0])]
    return {"editoare": len(editoare), "zone": len(zone), "atasamente": atas, "semne": semne, "text_editor": text_editor,
            "detalii": ["%s x%d" % (k, v) for k, v in sorted(detalii.items())][:12], "editabile_pagina": editabile_pagina,
            "necunoscute": len(necunoscute), "necunoscute_detalii": [m[:DETALIU_AFISAT] for m, _ in necunoscute[:60]],
            "necunoscute_surse": [s[:DETALIU_AFISAT] for _, s in necunoscute[:60]],     # r8: paralel cu necunoscute_detalii
            "blocante": len(blocante), "blocante_detalii": [m[:DETALIU_AFISAT] for m, _ in blocante[:60]],
            "blocante_surse": [s[:DETALIU_AFISAT] for _, s in blocante[:60]],
            "avertismente": len(avertismente), "avertismente_detalii": [m[:DETALIU_AFISAT] for m, _ in avertismente[:60]],
            "avertismente_surse": [s[:DETALIU_AFISAT] for _, s in avertismente[:60]]}


def _e_avertisment(m):
    # v4.6.5: motivul e decor (MOTIVE_AVERTISMENT, prefix EXACT) -> avertisment; orice altceva -> blocheaza
    return any(m.startswith(p) for p in MOTIVE_AVERTISMENT)


def spune_avertismente(info, moment):
    # v4.6.5: avertismentele (decorul necunoscut, nu blocheaza) in log / `stare`: `avertisment necunoscut <motiv>` + `    sursa ...`
    # (aceeasi forma ca liniile `necunoscut`). Textele vin din _ascii (o singura linie, fara caractere de control), taiate la DETALIU_AFISAT.
    spune("avertismente in zona (%s, nu blocheaza):" % moment, info["avertismente"])
    for m, s in zip(info["avertismente_detalii"], info["avertismente_surse"]):
        spune("  avertisment necunoscut", m)
        if s:
            spune("    sursa", s)


def verifica_fara_atasamente(info, semn_locator, moment):
    # paza ciorna: fail-closed. Zona negasita = nu stiu ce e in ciorna; chip = fisier; orice semn fara chip = refuz
    # r17: editorul principal trebuie sa fie UNIC (el e cel comparat cu brief-ul); doua sau mai multe = nu stiu in care scriu -> refuz
    if info["editoare"] != 1 or not info["zone"]:
        raise GemEroare("ciorna_necitibila", "%s: zona de compunere negasita sau editorul principal nu e unic (editoare %d, zone %d) - nu trimit"
                        % (moment, info["editoare"], info["zone"]))
    if info["atasamente"]:
        raise GemEroare("ciorna_cu_atasamente", "%s: %d atasament(e) in ciorna - nu trimit" % (moment, info["atasamente"]))
    if info["semne"] or semn_locator:
        raise GemEroare("ciorna_cu_atasamente", "%s: semn de atasament fara chip recunoscut (zona %d, locator %d) - nu trimit"
                        % (moment, info["semne"], semn_locator))
    # r2: 0 chip-uri + 0 semne NU dovedeste ciorna goala; trebuie ca TOT ce e in zona sa fie structura recunoscuta
    # v4.6.5 (varianta B): ...in afara decorului (avertismente, MOTIVE_AVERTISMENT): refuz doar pe motivele BLOCANTE
    if info["blocante"]:
        raise GemEroare("ciorna_necunoscuta", "%s: %d element(e) nerecunoscute in zona ciornei - nu trimit (%s)"
                        % (moment, info["blocante"], "; ".join(info["blocante_detalii"][:3])))
    return 0


def e_tab_gemini(url):
    try:
        u = urlparse(url)
    except Exception:
        return False
    return u.scheme == "https" and (u.hostname or "").lower() == GAZDA


def alege_tab(pagini):
    pg = [x for x in pagini if e_tab_gemini(x.url)]
    if not pg:
        raise GemEroare("fara_tab_gemini", "nu exista tab https://" + GAZDA + " in Edge 9333")
    if len(pg) > 1:
        # fara tinta de conversatie: refuz in loc sa ghicesc in ce conversatie scriu
        raise GemEroare("mai_multe_taburi_gemini", "%d taburi Gemini deschise; lasati unul singur" % len(pg))
    return pg[0]


def verifica_model(text_model):
    t = " ".join((text_model or "").split())      # spatii / linii noi / NBSP -> un singur spatiu
    if not MODEL_FORMA.fullmatch(t):
        raise GemEroare("model_gresit", "afisat: '" + t.encode("ascii", "replace").decode("ascii")[:80] + "', cerut: " + MODEL_CERUT)
    return t


def asteapta_raspuns(citeste, genereaza, asteapta, inainte_n, maxs, ceas=time.monotonic):
    """citeste() -> lista textelor message-content; genereaza() -> bool; asteapta(ms).
    Intoarce (text, complet). Un raspuns nou = mai multe message-content decat inainte de trimitere."""
    t0 = ceas()
    ultim = None
    identice = 0
    while ceas() - t0 < maxs:
        asteapta(PAS_MS)
        m = citeste()
        if len(m) <= inainte_n:
            continue
        cur = (m[-1] or "").strip()
        if cur and cur == ultim:
            identice += 1
        else:
            identice = 1 if cur else 0
        ultim = cur
        if identice >= CITIRI_IDENTICE and not genereaza():
            return cur, True
    return (ultim or ""), False


# --- partea cu browserul (in teste doar cu o pagina falsa, fara Playwright) ---

def _pagini(b):
    return [x for c in b.contexts for x in c.pages]


def _model_afisat(pg):
    loc = pg.locator(MODEL)
    if loc.count() == 0:
        raise GemEroare("model_gresit", "selectorul modelului lipseste (pagina schimbata sau nelogat)")
    return loc.first.inner_text()


def _genereaza(pg):
    return pg.locator(STOP).count() > 0


def _mesaje(pg):
    return pg.locator(RASPUNS).all_inner_texts()


def _semn_locator(pg):
    # v4.6.3 (numara gresit, pastrat doar ca SEMN fail-closed: vede si ce page.content() n-ar serializa, ex. shadow DOM)
    # r2: + media / butoane de scoatere din zona (SEMN_EXTRA), vazute si in shadow DOM
    return pg.locator(ZONA).locator(ATAS).count() + pg.locator(CHIP).count() + pg.locator(ZONA).locator(SEMN_EXTRA).count()


# r19 (Jakarinos NO-GO r8 P1): page.content() NU serializeaza subarborii shadow, deci un shadow root din zona poate purta continut
# (ex. un al doilea contenteditable cu text strain) pe care analiza HTML nu il vede. r19 numara shadow root-urile din JavaScript-ul paginii.
# r20 (Jakarinos NO-GO r9 P1): un shadow root INCHIS pe o eticheta standard (div, span...) nu se vede din JavaScript-ul paginii
# (el.shadowRoot = null). Verificarea din pg.evaluate (JS_UMBRE, fara HTML) ramane ca citire ANTERIOARA care poate DOAR refuza:
#   shadow_pagina = shadow root-uri DESCHISE in toata pagina (recursiv, si in shadow root-urile gasite);
#   shadow_zona   = dintre ele, cele cu gazda in zona (elementele ZONA si descendentii lor) sau pe stramosii editorului (EDITOR);
#   custom_zona   = elemente custom INREGISTRATE (customElements.getName pe constructorul elementului - prinde si built-in-urile
#                   personalizate create cu createElement(tag, {is}), care NU au atributul is in DOM - plus customElements.get pe
#                   eticheta cu cratima / pe atributul is) in zona / pe stramosii editorului (CDP nu spune daca un element e inregistrat);
#   custom_pagina = la fel, in toata pagina (doar afisat in `stare`, nu decide).
# Decizia se ia din instantaneul CDP (_instantaneu), care vede si shadow root-urile inchise.
CHEI_UMBRE = ("shadow_pagina", "shadow_zona", "custom_pagina", "custom_zona")
JS_UMBRE = (
    "() => {\n"
    "  const Z = " + json.dumps(ZONA) + ", E = " + json.dumps(EDITOR) + ";\n"
    "  const zone = Array.from(document.querySelectorAll(Z)), stramosi = new Set();\n"
    "  for (const e of document.querySelectorAll(E)) { for (let p = e; p; p = p.parentElement) stramosi.add(p); }\n"
    "  const inZona = (el) => stramosi.has(el) || zone.some((z) => z.contains(el));\n"
    "  const ce = window.customElements;\n"
    "  const custom = (el) => !!ce && ((typeof ce.getName === 'function' && !!ce.getName(el.constructor))\n"
    "                                  || (el.localName.indexOf('-') > 0 && !!ce.get(el.localName))\n"
    "                                  || (el.hasAttribute('is') && !!ce.get(el.getAttribute('is'))));\n"
    "  let sp = 0, sz = 0, cp = 0, cz = 0;\n"
    "  const parcurge = (rad, subZona) => {\n"
    "    for (const el of rad.querySelectorAll('*')) {\n"
    "      const z = subZona || inZona(el);\n"
    "      if (custom(el)) { cp++; if (z) cz++; }\n"
    "      if (el.shadowRoot) { sp++; if (z) sz++; parcurge(el.shadowRoot, z); }\n"
    "    }\n"
    "  };\n"
    "  parcurge(document, false);\n"
    "  return { shadow_pagina: sp, shadow_zona: sz, custom_pagina: cp, custom_zona: cz };\n"
    "}")


def _umbre_js(pg):
    # r19 / r20: citirea din JavaScript-ul paginii (doar numaratori, fara HTML); forma verificata strict, altfel refuz
    r = pg.evaluate(JS_UMBRE)
    if not isinstance(r, dict) or set(r) != set(CHEI_UMBRE) or any(type(r[k]) is not int or r[k] < 0 for k in CHEI_UMBRE):
        raise GemEroare("ciorna_necitibila", "numararea shadow DOM din pagina nu are forma asteptata - nu trimit")
    return r


def verifica_fara_umbre(umbre, moment):
    # r19: shadow DOM vazut din pagina -> refuz (pagina reala: 0); custom_pagina doar afisat
    if umbre["shadow_pagina"] or umbre["shadow_zona"] or umbre["custom_zona"]:
        raise GemEroare("ciorna_necunoscuta", "%s: shadow DOM nevazut de analiza (shadow root: pagina %d, zona %d; custom inregistrate in zona %d)"
                        " - nu trimit" % (moment, umbre["shadow_pagina"], umbre["shadow_zona"], umbre["custom_zona"]))
    return 0


# r20: instantaneul = UN SINGUR raspuns CDP DOM.getDocument({depth: -1, pierce: true}). Cu pierce, fiecare element vine cu `children`
# (DOM-ul obisnuit), `shadowRoots` (TOATE: open, closed, user-agent - inclusiv cele inchise, nevazute din pagina), `contentDocument`
# (iframe-urile din acelasi proces) si `templateContent`. Fara DOM.enable({includeWhitespace: "all"}) Chromium SARE nodurile text din
# doar spatii albe (verificat in Edge 157: `<div>  </div>` apare fara copil), deci DOM.enable cu acest parametru e obligatoriu. Textele
# mai lungi de 10000 de caractere vin TAIATE (primele 10000 + U+2026): LIMITA_TEXT_CDP.
# r21 (Jakarinos NO-GO r10 P1): Chromium masoara in UNITATI UTF-16 (inspector_dom_agent.cc: node_value.length() > 10000 -> Left(10000) +
# U+2026), nu in puncte de cod ca len() din Python: un caracter din afara BMP (emoji) = 2 unitati. Deci un text real de peste 10000 de
# unitati poate veni ca 10000 de PUNCTE DE COD terminate cu U+2026 (len() = 10000, nedetectat in r20). Masura = _u16; trunchiat =
# _taiat_cdp: peste LIMITA unitati (forma normala: LIMITA + U+2026 = LIMITA + 1) SAU exact LIMITA unitati terminate cu U+2026 (cazul in
# care Left() a taiat o pereche surogat si jumatatea ramasa s-a pierdut pe drum) - un text real de exact LIMITA unitati terminat cu
# U+2026 e refuzat fals (sigur). Aceeasi regula pe liniile brief-ului (inceputul lui `trimite`). Verificat in Edge 157.0.4341.60
# (headless, local): emoji + 9998 a + text -> 10000 de puncte de cod / 10001 unitati terminate cu U+2026; perechea taiata vine ca
# U+FFFD (tot 10001 unitati); pierderea ei (a doua ramura) e o aparare, nevazuta.
LIMITA_TEXT_CDP = 10000
ELIPSA_CDP = chr(0x2026)                       # r21: sufixul pus de Chromium la taiere (U+2026)


def _u16(s):
    # r21: lungimea in unitati UTF-16 (ca String.length din Chromium / JavaScript); un surogat singur (pereche taiata) = 1 unitate
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _taiat_cdp(s):
    # r21: textul (nodeValue din CDP sau o linie a brief-ului) e / ar fi TAIAT de CDP (vezi LIMITA_TEXT_CDP)
    u = _u16(s)
    return u > LIMITA_TEXT_CDP or (u == LIMITA_TEXT_CDP and s.endswith(ELIPSA_CDP))
CHEI_UMBRE_CDP = ("deschise", "inchise", "alt_tip", "ua_pagina", "ua_zona", "documente_iframe")
TIPURI_UMBRE = {"open": "deschise", "closed": "inchise"}     # orice alt tip in afara de "user-agent" = "alt_tip" (refuz, ca open / closed)


def _cdp_rau(motiv):
    return GemEroare("ciorna_necitibila", "instantaneul CDP nu are forma asteptata (%s) - nu trimit" % motiv)


def _lista_cdp(n, cheie):
    v = n.get(cheie, [])
    if not isinstance(v, list) or not all(isinstance(x, dict) for x in v):
        raise _cdp_rau(cheie)
    return v


def _atribute_cdp(c):
    # lista plata [nume, valoare, ...] -> dict cu numele in litere mici (ca HTMLParser); doua nume egale dupa litere mici = refuz
    a = c.get("attributes", [])
    if not isinstance(a, list) or len(a) % 2 or not all(isinstance(x, str) for x in a):
        raise _cdp_rau("attributes")
    d = {}
    for i in range(0, len(a), 2):
        k = a[i].lower()
        if k in d:
            raise _cdp_rau("atribut dublat %s" % _ascii(k)[:40])
        d[k] = a[i + 1]
    return d


def _arbore_cdp(doc):
    """r20: rezultatul DOM.getDocument(depth -1, pierce) -> (radacina _Nod, umbre, trunchiate). Arborele = DOM-ul obisnuit al documentului
    principal, cu aceleasi _Nod ca _Arbore (tag si nume de atribut in litere mici, noduri "#text" cu textul brut, continutul unui <template>
    ca copii ai lui); comentariile / doctype / instructiunile de procesare se ignora (ca HTMLParser), CDATA = text. Continutul shadow
    root-urilor si al documentelor iframe NU intra in arbore: se parcurge doar ca sa NUMERE shadow root-urile (si cele imbricate);
    continutul unui shadow root user-agent e al browserului (nu se parcurge). Fiecare shadow root are o ancora in arbore (gazda, sau
    gazda / iframe-ul exterior pentru cele imbricate), folosita la "in zona". Orice abatere de forma = ciorna_necitibila."""
    if not isinstance(doc, dict) or not isinstance(doc.get("root"), dict) or doc["root"].get("nodeType") != 9:
        raise _cdp_rau("root")
    rad = _Nod("#document", {}, None)
    umbre = dict((k, 0) for k in CHEI_UMBRE_CDP)
    ancore_ua, trunchiate = [], []
    st = [(c, rad, None) for c in reversed(_lista_cdp(doc["root"], "children"))]
    while st:
        c, p, ancora = st.pop()             # p = parintele din arbore (None = in afara arborelui analizat), ancora = nodul din arbore
        t = c.get("nodeType")
        if t in (3, 4):
            v = c.get("nodeValue")
            if not isinstance(v, str):
                raise _cdp_rau("nodeValue")
            if p is not None:
                x = _Nod("#text", {}, p, v)
                p.copii.append(x)
                if _taiat_cdp(v):           # r21: in unitati UTF-16, ca Chromium (nu len())
                    trunchiate.append(x)
            continue
        if t in (7, 8, 10):
            continue
        if t != 1 or not isinstance(c.get("localName"), str) or not c["localName"]:
            raise _cdp_rau("nodeType %r" % (t,))
        x = None
        if p is not None:
            x = _Nod(c["localName"].lower(), _atribute_cdp(c), p)
            p.copii.append(x)
        else:
            _atribute_cdp(c)                # forma verificata si in afara arborelui
        a = x if x is not None else ancora
        for s in _lista_cdp(c, "shadowRoots"):
            tip = s.get("shadowRootType")
            if tip == "user-agent":
                umbre["ua_pagina"] += 1
                ancore_ua.append(a)
                continue
            umbre[TIPURI_UMBRE.get(tip, "alt_tip")] += 1
            st.extend((y, None, a) for y in reversed(_lista_cdp(s, "children")))
        if "contentDocument" in c:
            d = c["contentDocument"]
            if not isinstance(d, dict) or d.get("nodeType") != 9:
                raise _cdp_rau("contentDocument")
            umbre["documente_iframe"] += 1
            st.extend((y, None, a) for y in reversed(_lista_cdp(d, "children")))
        copii = _lista_cdp(c, "children")
        if "templateContent" in c:
            if not isinstance(c["templateContent"], dict):
                raise _cdp_rau("templateContent")
            copii = copii + _lista_cdp(c["templateContent"], "children")
        st.extend((y, x, a) for y in reversed(copii))
    # "in zona" = ca in JS_UMBRE: elementul e o zona (ZONA) sau sub una, ori e un stramos al unui editor principal (EDITOR)
    stramosi = set()
    for e in _descendenti(rad):
        if _e_editor(e):
            q = e
            while q is not None:
                stramosi.add(id(q))
                q = q.parinte
    for a in ancore_ua:
        q, z = a, a is not None and id(a) in stramosi
        while q is not None and not z:
            z = _e_zona(q)
            q = q.parinte
        if z:
            umbre["ua_zona"] += 1
    return rad, umbre, trunchiate


def _instantaneu(pg):
    # r20: SINGURA citire a paginii din care se ia decizia: un apel CDP DOM.getDocument(pierce) -> (info, umbre), ambele din acelasi
    # raspuns. CDP indisponibil sau orice eroare = refuz (nu exista o cale de rezerva mai slaba)
    try:
        cdp = pg.context.new_cdp_session(pg)
    except Exception as e:
        raise GemEroare("ciorna_necitibila", "CDP indisponibil pentru instantaneu (%s) - nu trimit" % type(e).__name__)
    try:
        cdp.send("DOM.enable", {"includeWhitespace": "all"})
        doc = cdp.send("DOM.getDocument", {"depth": -1, "pierce": True})
    except Exception as e:
        raise GemEroare("ciorna_necitibila", "instantaneul CDP a esuat (%s) - nu trimit" % type(e).__name__)
    finally:
        try:
            cdp.detach()
        except Exception:
            pass                            # dupa citire: desprinderea sesiunii nu decide nimic (raspunsul e deja primit sau refuzat)
    rad, umbre, trunchiate = _arbore_cdp(doc)
    return analizeaza_arbore(rad, trunchiate), umbre


def verifica_umbre_cdp(umbre, moment):
    # r20: orice shadow root care nu e al browserului (open / closed / alt tip), oriunde in pagina = refuz (pagina reala: 0); user-agent
    # doar in afara zonei (pagina reala: 1, pe un img din istoric, in afara zonei)
    if umbre["deschise"] or umbre["inchise"] or umbre["alt_tip"] or umbre["ua_zona"]:
        raise GemEroare("ciorna_necunoscuta", "%s: shadow DOM in pagina (CDP: deschise %d, inchise %d, alt tip %d; user-agent in zona %d)"
                        " - nu trimit" % (moment, umbre["deschise"], umbre["inchise"], umbre["alt_tip"], umbre["ua_zona"]))
    return 0


def _citeste_ciorna(pg):
    # r20: citirile care pot doar refuza (locatorii, evaluate), apoi instantaneul CDP (ultimul)
    semn = _semn_locator(pg)
    umbre_js = _umbre_js(pg)
    info, umbre = _instantaneu(pg)
    return info, semn, umbre_js, umbre


def _paza_ciorna(pg, moment):
    # doar citire (count + evaluate + CDP); ridica GemEroare daca ciorna are atasamente / shadow DOM sau nu poate fi citita
    info, semn, umbre_js, umbre = _citeste_ciorna(pg)
    verifica_fara_umbre(umbre_js, moment)
    verifica_umbre_cdp(umbre, moment)
    r = verifica_fara_atasamente(info, semn, moment)
    if info["avertismente"]:
        spune_avertismente(info, moment)    # v4.6.5: decorul necunoscut, in log (dupa decizie; nu blocheaza)
    return r


def _editor_unic(pg):
    # r17: locatorul EDITOR (aceeasi regula ca _e_editor; vede si shadow DOM-ul deschis) trebuie sa gaseasca EXACT un element; editorul
    # unic din instantaneu (r20: arborele CDP al documentului) se verifica separat (verifica_fara_atasamente: editoare == 1).
    loc = pg.locator(EDITOR)
    k = loc.count()
    if k == 0:
        raise GemEroare("editor_lipsa", "editorul nu e vizibil")
    if k != 1:
        raise GemEroare("editor_multiplu", "%d editoare principale - nu stiu care e ciorna, nu trimit" % k)
    return loc.first


def _ultima_paza(pg, text):
    # r18 (Jakarinos NO-GO r7 P1-2): ultima paza = UN SINGUR instantaneu, din care se deriva si textul editorului comparat cu brief-ul
    # (_text_editor), si editorul unic, si atasamentele / semnele / necunoscutele. Inainte de instantaneu, doar citiri care pot DOAR
    # refuza: editorul unic si semnele de atasament (locatori), shadow DOM-ul vazut din pagina (r19, evaluate).
    # r20 (Jakarinos NO-GO r9 P1): instantaneul = UN apel CDP DOM.getDocument(pierce) (_instantaneu): arborele analizat SI shadow
    # root-urile (si cele inchise) din acelasi raspuns; decizia foloseste doar rezultatul lui. Apelantul apasa Enter imediat dupa (fara
    # alte asteptari sau citiri). Instantaneul si Enter raman doua operatii distincte (limita documentata in RUNBOOK).
    _editor_unic(pg)
    semn = _semn_locator(pg)
    verifica_fara_umbre(_umbre_js(pg), "inainte_de_enter")
    info, umbre = _instantaneu(pg)
    verifica_umbre_cdp(umbre, "inainte_de_enter")
    verifica_fara_atasamente(info, semn, "inainte_de_enter")
    verifica_ciorna(info["text_editor"], text, info["atasamente"])
    return info                             # v4.6.5: avertismentele se scriu DUPA Enter (nimic intre instantaneu si Enter)


def stare(pg):
    spune("URL:", pg.url)
    spune("model:", _model_afisat(pg).strip().encode("ascii", "replace").decode("ascii"))
    info, semn, umbre_js, umbre = _citeste_ciorna(pg)
    spune("genereaza:", _genereaza(pg), "| editor:", pg.locator(EDITOR).count(), "| raspunsuri:", pg.locator(RASPUNS).count(),
          "| atasamente in ciorna:", info["atasamente"] if info["zone"] else "?")
    spune("zone compunere:", info["zone"], "| semne atasament: zona", info["semne"], "/ locator", semn,
          "| detalii:", ", ".join(info["detalii"]) or "-")
    # r19: shadow DOM vazut din pagina (pagina reala: 0 / 0; custom inregistrate: zona 0)
    spune("shadow root: pagina", umbre_js["shadow_pagina"], "/ zona", umbre_js["shadow_zona"], "| custom inregistrate: pagina",
          umbre_js["custom_pagina"], "/ zona", umbre_js["custom_zona"])
    # r20: shadow root-urile din instantaneul CDP (pagina reala 23.11: 0 / 0 / 0, user-agent pagina 1 / zona 0)
    spune("shadow root CDP: deschise", umbre["deschise"], "/ inchise", umbre["inchise"], "/ alt tip", umbre["alt_tip"],
          "| user-agent: pagina", umbre["ua_pagina"], "/ zona", umbre["ua_zona"], "| documente iframe:", umbre["documente_iframe"])
    # r2: calibrarea listelor albe (RUNBOOK pasul 0) copiaza EXACT aceste semnaturi, cate una pe linie
    # r8: sub un necunoscut cu semnal (token_... / atribut_fisier: / eticheta: / fundal: / media:), locul exact al cuvantului / numelui
    # v4.6.5: liniile `necunoscut` = doar ce BLOCHEAZA (refuz); decorul necunoscut = `avertisment necunoscut` (nu blocheaza, risc acceptat B)
    spune("contenteditable in pagina in afara zonei:", info["editabile_pagina"])
    spune("necunoscute in zona:", info["blocante"])
    for m, s in zip(info["blocante_detalii"], info["blocante_surse"]):
        spune("  necunoscut", m)
        if s:
            spune("    sursa", s)
    spune_avertismente(info, "stare")
    try:
        verifica_fara_umbre(umbre_js, "stare")
        verifica_umbre_cdp(umbre, "stare")
        verifica_fara_atasamente(info, semn, "stare")
        spune("paza ciorna: OK (trimite ar continua)")
    except GemEroare as e:
        spune("paza ciorna: REFUZ", e.cod, e.detaliu)

def trimite(pg, text, maxs, target="https://gemini.google.com/app"):
    if target != "https://gemini.google.com/app" and not re.fullmatch(r"https://gemini\.google\.com/app/[0-9a-fA-F]+", target):
        raise GemEroare("url_invalid", "tinta refuzata")
    # r20: o linie mai lunga decat LIMITA_TEXT_CDP ar ajunge TAIATA in instantaneul CDP (refuz la ultima paza): refuz inainte de orice actiune
    # r21: aceeasi regula ca la ultima paza (_taiat_cdp, unitati UTF-16), ca nimic refuzat acolo sa nu ajunga scris in ciorna
    if any(_taiat_cdp(l.rstrip("\r")) for l in text.split("\n")):
        raise GemEroare("brief_invalid", "o linie are peste %d unitati UTF-16 (instantaneul CDP o taie) - nu trimit" % LIMITA_TEXT_CDP)
    # v4.6.4: PRIMA operatie pe pagina = paza ciornei din tab-ul curent (doar citire). Chatul nou goleste ciorna, deci
    # o verificare facuta dupa navigare nu mai vede atasamentele puse de operator (cauza testului de canal picat 19.11.2026).
    _paza_ciorna(pg, "inainte_de_chat_nou")
    # Chat nou in acelasi tab, sub lock-ul global al lansatorului. Niciun URL din brief.
    if _genereaza(pg):
        raise GemEroare("gemini_ocupat", "Gemini inca scrie - nu navighez peste el")
    pg.goto(target, wait_until="domcontentloaded", timeout=60000)
    try:
        pg.locator(EDITOR).first.wait_for(state="visible", timeout=60000)
    except Exception:
        raise GemEroare("editor_lipsa", "chatul nou nu are camp de prompt gata")
    if target != "https://gemini.google.com/app" and pg.url != target:
        raise GemEroare("url_invalid", "conversatie indisponibila")
    # r7 (test de canal 01.11): pe chat nou butonul de model apare dupa editor; il astept explicit, apoi verific modelul cerut
    try:
        pg.locator(MODEL).first.wait_for(state="visible", timeout=20000)
    except Exception:
        raise GemEroare("model_gresit", "selectorul modelului nu a aparut in 20s (pagina schimbata sau nelogat)")
    model = verifica_model(_model_afisat(pg))
    if _genereaza(pg):
        raise GemEroare("gemini_ocupat", "Gemini inca scrie - nu trimit peste el")
    inainte_n = len(_mesaje(pg))
    ed = _editor_unic(pg)
    _paza_ciorna(pg, "pe_chatul_nou")       # defensiv: chatul nou / conversatia tinta, inainte de click si tastatura
    ed.click()
    pg.keyboard.press("Control+A")      # ciorna ramasa in editor se inlocuieste, nu se lipeste in fata brief-ului
    pg.keyboard.press("Delete")
    pg.keyboard.insert_text(text)
    pg.wait_for_timeout(800)
    # r2 (Jakarinos P1-b): continut identic (normalizat), nu doar lungime; atasamentele se verifica din nou chiar inainte de Enter
    # r18: textul, editorul unic si atasamentele din ACELASI instantaneu (_ultima_paza), Enter imediat dupa
    info = _ultima_paza(pg, text)
    pg.keyboard.press("Enter")
    if info["avertismente"]:
        spune_avertismente(info, "inainte_de_enter")   # v4.6.5: dupa Enter, ca sa nu existe nimic intre instantaneu si Enter
    spune("GEM_MODEL:", model.encode("ascii", "replace").decode("ascii"))
    spune("TRIMIS (%d car.); astept raspunsul..." % len(text))
    t0 = time.monotonic()
    rasp, complet = asteapta_raspuns(lambda: _mesaje(pg), lambda: _genereaza(pg), pg.wait_for_timeout, inainte_n, maxs)
    spune("=== RASPUNS (%d car., %ds) ===" % (len(rasp), int(time.monotonic() - t0)))
    spune(rasp)
    if not complet:
        raise GemEroare("timeout_raspuns", "raspuns incomplet dupa %ds (partial mai sus)" % maxs)


def url_final(real, target):
    # r5 (Jakarinos r4 P1): dupa ORICE trimitere, URL-ul real al tab-ului e obligatoriu si e singura sursa a GEM_CHAT_URL;
    # un marker fals in textul raspunsului e urmat mereu de linia reala sau de eroare (exit nenul)
    if not re.fullmatch(r"https://gemini\.google\.com/app/[0-9a-fA-F]+", real or ""):
        raise GemEroare("url_invalid", "url real lipsa dupa trimitere")
    if target != "https://gemini.google.com/app" and real != target:
        raise GemEroare("url_invalid", "conversatia s-a schimbat")
    return real


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "stare"
    if cmd not in ("stare", "trimite"):
        raise GemEroare("comanda_necunoscuta", cmd[:40])
    text = None
    maxs = 600
    if cmd == "trimite":
        if len(argv) < 3:
            raise GemEroare("brief_invalid", "lipseste calea brief-ului")
        text = citeste_brief(argv[2])
        if len(argv) > 3:
            try:
                maxs = max(30, min(int(argv[3]), 3600))
            except ValueError:
                raise GemEroare("brief_invalid", "secunde_max invalid")
    target = argv[4] if cmd == "trimite" and len(argv) > 4 else "https://gemini.google.com/app"
    if target != "https://gemini.google.com/app" and not re.fullmatch(r"https://gemini\.google\.com/app/[0-9a-fA-F]+", target):
        raise GemEroare("url_invalid")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        try:
            b = p.chromium.connect_over_cdp(CDP)
        except Exception as e:
            raise GemEroare("cdp_indisponibil", type(e).__name__)
        pg = alege_tab(_pagini(b))
        if cmd == "stare":
            stare(pg)
        else:
            trimite(pg, text, maxs, target)
            spune("GEM_CHAT_URL", url_final(pg.url, target))


if __name__ == "__main__":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        main(sys.argv)
    except GemEroare as e:
        spune("GEM_EROARE", e.cod, e.detaliu)
        sys.exit(3)
    except Exception as e:
        spune("GEM_EROARE", "eroare_playwright", (type(e).__name__ + ": " + str(e)).splitlines()[0][:300] if str(e) else type(e).__name__)
        sys.exit(3)
