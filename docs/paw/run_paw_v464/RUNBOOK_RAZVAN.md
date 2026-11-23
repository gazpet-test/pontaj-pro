# Paw v4.6.4 / v4.6.4b / v4.6.4c / v4.6.4d / v4.6.4e / v4.6.4f - doar paza atasamentelor Gemini - procedura pentru Razvan

Numai operatorul executa pasii. Agentul nu a instalat nimic si nu a cerut elevare.
A = PowerShell 5.1 admin Gazpet-Ai; N = acelasi cont NE-elevat. Orice eroare = STOP.

**De ce:** testul de canal v4.6.3 (19.11.2026) a picat la atasament: cu un fisier in ciorna,
`stare` arata `atasamente in ciorna: 5`, iar `trimite` NU a refuzat - a deschis un chat nou
(care goleste ciorna) si abia apoi a verificat atasamentele, deci a trimis brief-ul.

**Ce se schimba:** numai `gemini_pw.py` si linia lui din `SHA256.json`.
- `trimite` verifica ciorna tab-ului curent INAINTE de orice actiune (chat nou, click,
  tastatura). Cu atasament: `GEM_EROARE ciorna_cu_atasamente inainte_de_chat_nou: ...`, exit 3,
  chatul ramane neatins. Aceeasi verificare pe chatul nou (inainte de click) si chiar inainte de Enter.
- Numararea: un fisier = un chip `uploader-file-preview` in zona de compunere (nu imaginile din
  raspunsuri). Orice alt semn de atasament fara chip = tot refuz. Zona de compunere negasita =
  `GEM_EROARE ciorna_necitibila` (nu stie ce e in ciorna, deci nu trimite).
- **r2 (dupa review):** "zero chip-uri si zero semne" NU mai inseamna ciorna goala. Ciorna goala
  se verifica POZITIV: tot ce e in zona de compunere, in afara textului din editor, trebuie sa fie
  recunoscut (elemente neutre, structura zonei, butonul modelului, plus listele albe completate la
  pasul 0 din pagina reala). Orice altceva - un card de fisier cu alt nume, o imagine, un buton
  "Remove", un text de tip `a.txt` - = `GEM_EROARE ciorna_necunoscuta ...`, exit 3, nimic trimis.
  Un refuz fals e preferat unei trimiteri false: atunci se goleste ciorna de mana sau se reface pasul 0.
- `stare` mai scrie: `zone compunere ... | semne atasament ... | detalii ...`,
  `necunoscute in zona: N` urmat de cate o linie `  necunoscut <semnatura>`, si
  `paza ciorna: OK` / `paza ciorna: REFUZ <cod> ...`.
- Celelalte 11 fisiere sunt copii octet cu octet ale celor instalate acum in `bin` (v4.6.3).

**De ce NU e nevoie de Install / WFP / Run / Seal:** `run_paw.ps1` nu se schimba, iar legatura din
`cdx_sandbox_validat.json` (functia `GetCdxBinding`) nu contine `gemini_pw.py` si nici
`SHA256.json`. Certificatul cdx ramane valabil; jak / cop / cdx nu sunt atinse.
**Ce se reface:** testul de canal Gemini (markerul `paw-data\gem_canal_validat` nu exista pentru
v4.6.3; cel nou se leaga de hash-ul v4.6.4).
**Ramane neschimbat in lansator:** canalul se cheama tot `gem ... argon` / `argon:<lucrare>`.

**Stare 22.11.2026 (v4.6.4 -> v4.6.4b):** v4.6.4 (`gemini_pw.py` `A03E2B5C...`, head `5417037b`) a fost INSTALAT pe 22.11.2026
(pasii 1-4, zona protejata `operator-v464`), dar pasul 5a a PICAT: pe un chat NOU gol (Carbon, Esc + F5) `stare` a dat de doua ori
`necunoscute in zona: 3` (`paw-data\out\paw_v464_calibrare\stare_22_11_dupa_instalare.txt`) - pagina Gemini s-a schimbat dupa
calibrarea din 21.11. Markerul NU a fost scris, deci lansatorul refuza `gem` (sigur). **v4.6.4b** (acest pachet) schimba din nou
DOAR `gemini_pw.py` + linia lui din `SHA256.json` si se instaleaza PESTE v4.6.4 cu aceeasi procedura: hash-ul vechi = `A03E2B5C...`,
zona protejata noua `operator-v464b`, copiile de siguranta cu sufixul `.v464`, fisierele noi cu `.v464b` (pasul 1). Ce aduce, pe scurt
(detaliile la pasul 0, "Stare r8" si "Stare r9"): r8 - regula inchisa pentru atributul `data-filedrop-id` al indicatorului de drag & drop
(linia 1 din 5a) si afisarea sursei fiecarui semnal (`    sursa <fel>:<unde>=<valoare>`, `{...}` intreg); r9 (runda 2 a PR-ului, dupa ce
chat-ul a citit din pagina atributele COMPLETE ale celor 3 elemente) - cate o exceptie EXACTA pe element pentru cele trei semnale, toate
in functia unica de semnale: indicatorul doar cu valoarea reala si izolat, butonul "+" doar cu `arialabel` exact + `ariahaspopup="menu"`,
editorul doar cu cele doua token-uri de clasa intregi. Pe pagina reconstituita din atributele complete: 0 necunoscute, `paza ciorna: OK`.

**Stare 22.11.2026 (v4.6.4b -> v4.6.4c):** v4.6.4b (`gemini_pw.py` `5B0CCD48...`, main `c8138f0f`) a fost INSTALAT; testul de canal:
5a-5d OK, 5e refuz fals (vezi 5e mai jos: ramane refuz, F5 inainte de trimitere), 5f OK, **5g a PICAT**: pe chatul NOU deschis de
script, `<file-drop-indicator>` are in plus `style=""` (GOL; `paw-data\out\paw_v464_calibrare\atribute_5g_22_11.txt`), iar regula
"izolat" din r9 refuza orice atribut in plus. Markerul NU a fost scris (`gem` refuzat, sigur). **v4.6.4c** (acest pachet, r10) schimba
din nou DOAR `gemini_pw.py` + linia lui din `SHA256.json` si se instaleaza PESTE v4.6.4b cu aceeasi procedura: hash-ul vechi =
`5B0CCD48...`, zona protejata noua `operator-v464c`, copiile de siguranta cu sufixul `.v464b`, fisierele noi cu `.v464c` (pasul 1).
Ce aduce (detaliile la pasul 0, "Stare r10"): pe indicatorul izolat mai poate sta DOAR `style` cu valoarea goala sau doar spatii albe
(spatiu, tab, linie noua); orice `style` cu continut (url(, nume de fisier, `--uploader-height`, orice altceva) = refuz ca pana acum.
Rollback-ul (mai jos) readuce v4.6.4b.

**Stare 23.11.2026 (v4.6.4c -> v4.6.4d):** v4.6.4c (`gemini_pw.py` `09E78891...`, main `16a9a9f7`) a fost INSTALAT, testul de canal
5a-5g a trecut si markerul e scris (`gem` merge prin lansator). Pe 23.11 un brief LUNG (~10 KB, sesiunea juridica) a fost refuzat
FALS chiar inainte de Enter: `GEM_EROARE ciorna_necunoscuta inainte_de_enter: 2 element(e) ...` - nimic trimis (sigur). Cu text lung
Gemini extinde caseta de compunere: div-ul zonei de drop isi schimba clasele (`height-expanded-past-single-line`, `pre-fullscreen`,
`with-toolbox-drawer` in loc de `simplified-input-area`) si apare butonul "Ecran complet" (atributele complete:
`paw-data\out\paw_v464_calibrare\stare_text_lung_23_11.json`, citite de chat cu textul in ciorna, netrimis). **v4.6.4d** (acest pachet,
r11) schimba din nou DOAR `gemini_pw.py` + linia lui din `SHA256.json` si se instaleaza PESTE v4.6.4c cu aceeasi procedura: hash-ul vechi =
`09E78891...`, zona protejata noua `operator-v464d`, copiile de siguranta cu sufixul `.v464c`, fisierele noi cu `.v464d` (pasul 1).
Ce aduce (detaliile la pasul 0, "Stare r11" ... "Stare r21"; r21: lungimile textelor CDP si ale liniilor brief-ului in unitati UTF-16,
ca Chromium, si listele albe recalibrate pe pagina Gemini de azi - chat nou, gol / scurt / mediu / lung; r20: instantaneul ultimei paze = UN apel CDP `DOM.getDocument(pierce)`, din
care vin si arborele analizat si shadow root-urile, si cele INCHISE: orice shadow root open / closed / alt tip oriunde in pagina = refuz,
user-agent doar in afara zonei, CDP indisponibil = refuz; r19: orice shadow root deschis in pagina sau element custom inregistrat
in zona = refuz (citirea din `pg.evaluate` ramane, poate doar refuza); r14: LISTA ALBA de atribute + textele exacte ale descrierilor; r15: clasele si
`jslog` doar valorile vazute, textele pe Unicode exact; r16: si NODURILE TEXT pe lista alba, pe locul lor; r17: un singur editor principal,
exact cel comparat cu brief-ul, `ql-clipboard` doar gol, orice alt `contenteditable` = refuz, comparatia cu brief-ul fara stergerea
caracterelor invizibile; r18: nicio eticheta sarita (si `script` / `style` / `template` / `noscript` = refuz), in editor doar `<p>` /
`<br>` fara atribute, textul comparat citit din HTML (nu din textul vizibil), ultima paza dintr-o singura citire, Enter imediat dupa):
div-ul zonei de drop e acceptat
in starea extinsa DOAR cu una din cele 4 multimi de clase din lista inchisa (marcajul `xapfileselectordropzone` tot GOL), butonul "Ecran
complet" e pe lista controalelor; r16: in ORICE control (si in afara lor) un text e permis doar gol (spatii albe HTML) sau exact textul
vazut pe acel loc ("Carbon" doar in butonul modelului, textele linkului de confidentialitate doar in link, avertismentul Workspace doar sub
el). Testul de canal are un pas nou, **5g2** (captura casetei,
doar citire, la trei lungimi de text + trimiterea unui brief lung si a unuia mediu). Rollback-ul (mai jos) readuce v4.6.4c (cu markerul ei).

**Stare 23.11.2026 seara (v4.6.4d -> v4.6.4e):** v4.6.4d (`gemini_pw.py` `50332B12...`, main `b8e9f541`) a fost INSTALAT; la testul de
canal, pasul **5e** (dupa F5, ciorna goala, chat nou, Carbon) `stare` a dat 3 necunoscute - refuz FALS, nimic trimis, markerul NU a fost
scris (`paw-data\gem_canal_validat` e tot cel al lui v4.6.4c, legat de `09E78891...`, deci lansatorul refuza `gem` acum - sigur):
`atribut_necunoscut:simplified-input-menu{style}` si `atribut_necunoscut:speech-dictation-mic-button{style}` (ambele cu `style=` GOL) si
`atribut_valoare:rich-textarea{class}`. Captura completa a acestei variante de pagina (chat, doar citire, ciorna golita):
`paw-data\out\paw_v464_calibrare\stare_completa_23_11_varianta_f5.json` (gol / mediu / lung). Fata de toate capturile anterioare are
EXACT trei diferente negenerate: `style=""` pe cele doua taguri (in toate starile) si token-ul de clasa **`ng-pristine`** pe
`rich-textarea` (doar in starea gol: campul Angular inca neatins dupa F5; dupa scriere devine `ng-dirty`, deja permis). Atentie: in
linia clasei `enterprise` si `simplified-input` NU sunt noi (erau pe lista din c23); token-ul care lipsea e `ng-pristine`. **v4.6.4e**
(acest pachet) schimba din nou DOAR `gemini_pw.py` + linia lui din `SHA256.json` si se instaleaza PESTE v4.6.4d cu aceeasi procedura:
hash-ul vechi = `50332B12...`, zona protejata noua `operator-v464e`, copiile de siguranta cu sufixul `.v464d`, fisierele noi cu `.v464e`
(pasul 1). Ce aduce: `style` DOAR cu valoarea goala si DOAR pe `simplified-input-menu` / `speech-dictation-mic-button` (orice continut =
refuz, ca pana acum), `ng-pristine` DOAR pe `rich-textarea`. Nimic altceva (niciun element, text, descriere sau alt atribut). Pe varianta F5
reconstituita din captura: 0 necunoscute in toate starile; pe capturile anterioare (c23n, z23s): tot 0. Rollback-ul (mai jos) readuce
v4.6.4d (fara marker valid: `gem` ramane refuzat, ca acum).

**Stare 23.11.2026 seara, mai tarziu (v4.6.4e -> v4.6.4f):** v4.6.4e (`gemini_pw.py` `4132781B...`, main `03bf2b24`) a fost INSTALAT; la
testul de canal, dupa F5 repetat (6 reincarcari), `stare` a dat ALEATOR (nu la fiecare incarcare) `atribut_necunoscut:auto-suggest{style}`,
`atribut_necunoscut:back-to-bottom-fab{style}`, `atribut_necunoscut:hallucination-disclaimer{style}`, toate cu `style=` GOL - refuz FALS,
nimic trimis, markerul NU a fost scris (tot cel al lui v4.6.4c, legat de `09E78891...`, deci `gem` e refuzat acum - sigur). Angular lasa
`style=""` dupa animatii pe orice element animat, deci o lista pe taguri nu se inchide (v4.6.4e adaugase doua taguri, au aparut altele
trei). Lista: `paw-data\out\paw_v464_calibrare\stare_f5b_necunoscute.txt`; captura completa (chat, doar citire, ciorna golita):
`stare_completa_23_11_varianta_f5b.json` (acelasi folder; fata de f5 are in plus exact `style=""` pe `auto-suggest`, in toate starile).
**v4.6.4f** (acest pachet) schimba din nou DOAR `gemini_pw.py` + linia lui din `SHA256.json` si se instaleaza PESTE v4.6.4e cu aceeasi
procedura: hash-ul vechi = `4132781B...`, zona protejata noua `operator-v464f`, copiile de siguranta cu sufixul `.v464e`, fisierele noi
cu `.v464f` (pasul 1). Ce aduce: O regula generala - `style` cu valoarea EXACT goala (sirul vid, nu spatii) e permis pe ORICE element
deja acceptat (aceleasi liste albe de taguri / controale / structura). Neschimbat: `style` cu orice continut (si doar spatii) = refuz ca
pana acum (cu formele exacte deja permise), orice element neacceptat = refuz, `<p>` / `<br>` din editor fara niciun atribut,
`div.ql-clipboard` doar cu atributele exacte. Nimic altceva. NU s-a adaugat: `data-placeholder` cu textul `Introdu @ pentru conectori,
abilitati si altele` (vazut o data, doar in forma ASCII din `stare`, valoarea reala cu diacritice nu e in nicio captura) - ramane refuz
sigur; daca reapare, se captureaza valoarea exacta si se adauga separat. Rollback-ul (mai jos) readuce v4.6.4e (fara marker valid: `gem`
ramane refuzat, ca acum).

Hash-urile vin din raportul de review, nu din acest fisier. Livrare: folderul din commit-ul
aprobat ajunge in `$Source` (`git archive` al commit-ului, dezarhivat in
`C:\Users\Public\livrare\run_paw_v464f`); verificarea de mai jos decide.

## 0. Calibrare pe pagina reala (N, DOAR citire, INAINTE de review-ul final si de instalare)

Listele albe din `gemini_pw.py` (`CONTROALE_CUNOSCUTE`, `STRUCTURA_CUNOSCUTA`, `TEXTE_CUNOSCUTE`)
sunt livrate GOALE: structura reala a ciornei Gemini (butoanele trimite / microfon / incarcare etc.)
nu se vede fara Edge. Fara calibrare, `stare` si `trimite` vor refuza cu `ciorna_necunoscuta`.

**Stare (r3, 21.11.2026):** pasul 0 a fost rulat de sesiunea de chat pe 21.11.2026 seara din copia
neinstalata a lui `ae3e8947` (27 / 31 / 32 semnaturi in cele trei stari) si listele albe contin
EXACT acele semnaturi (reuniunea), cu testul `test_listele_livrate_si_locatorul` legat de ele.

**Stare (r4, 21.11.2026, dupa review-ul Jakarinos pe r3):**
- **Semnalele inaintea listelor (P1).** O intrare din listele albe NU mai poate acoperi un element care
  poarta vreun semn de atasament: inainte de orice acceptare se verifica eticheta, toate clasele, id-ul,
  numele si valorile tuturor atributelor (si `data-*`, si atribute necunoscute), apoi textele si
  elementele dinauntru. Un astfel de element = `ciorna_necunoscuta`, fara nicio actiune, oricare ar fi
  lista. Liniile lui `stare` care NU se trec NICIODATA in liste (si nici n-ar avea efect): `media:`,
  `fundal:`, `eticheta:`, `text_fisier:`, `text_atasament:`, `token_...:`, `atribut_fisier:`,
  `..._in_editor:`. Calibrabile raman doar `element:<semnatura>` si `text:<text>`.
- **Textul Workspace (P2).** Textul integral al avertismentului de sub ciorna pe un chat existent
  (citit de chat pe 21.11.2026) e in `TEXTE_CUNOSCUTE`: starea (iii) trece (pe pagina sintetica care
  reproduce calibrarea). Un text care contine in plus un nume de fisier sau un cuvant de atasament
  ramane refuzat.
- **Linia `token_file:div{text-input-field simplified-input-area}` NU e in liste (scoasa).** Cuvantul
  "file" nu vine din clase (verificat), ci dintr-un atribut al div-ului real pe care afisarea r3 nu il
  arata. Din r4, `stare` afiseaza in `{...}` si numele atributelor din afara semnaturii, deci pe pagina
  reala linia va fi `necunoscut token_file:div{text-input-field simplified-input-area <nume-atribut>}`.
  **Consecinta: pana la r5, pe pagina reala toate cele trei stari dau 1 necunoscut (aceasta linie) si
  `trimite` refuza.** Pasul 0 se repeta O DATA (ajunge starea i, chat nou gol) cu copia commit-ului r4;
  sesiunea de chat copiaza linia `token_file...` intreaga. Decizia (in chat, apoi r5 + review): daca
  atributul e un marcaj gol de drag & drop (tip `...filedroptarget=""`), se poate adauga o regula
  inchisa si exacta pentru acel nume cu valoare goala (nu o intrare in STRUCTURA, care nu mai are
  efect pe un element cu semnal); orice alt atribut sau o valoare nevida = ramane refuz.
- Pe pagina reala pot aparea si alte linii noi `token_...` / `atribut_fisier:` pe elemente din liste
  (de ex. o clasa cu "card" sau "chip" pe `gem-icon`), fiindca r3 nu verifica clasele / atributele
  elementelor din liste. Ele NU se trec in liste: se copiaza pentru chat si se lamuresc una cate una.

**Stare (r5, 21.11.2026, dupa review-ul Jakarinos pe r4):**
- **Nume de fisier peste tot (P1).** `nume.extensie` se cauta acum in TOATE valorile unui element: clase,
  id, orice atribut, URL-uri (`href` / `src` / `srcset`, inclusiv `blob:`) si `style` (nu doar `url(`).
  Reproducerile din verdict (`gem-icon class="oferta.docx"`, `id="oferta.docx"`, `a ... href="blob:.../
  oferta.docx"`, `gem-icon style="--x: oferta.pdf"`) sunt refuzate fara nicio actiune. Singura exceptie,
  inchisa si testata: intr-un `href` cu schema http(s) a carui gazda e EXACT un host Google (`google.com`
  sau subdomeniu - linkul calibrat "Confidentialitatea ta si Gemini"), hostname-ul nu e fisier; calea,
  interogarea si fragmentul se verifica integral. Orice alt URL (alt host, `blob:`, `data:`, `src`,
  `srcset`) si orice `style` se verifica ca text intreg. **Presupunere declarata:** href-ul real al linkului
  (valoarea nu a fost copiata la pasul 0) sta pe un host Google; daca nu, pe pagina reala va aparea
  `atribut_fisier:a[data-test-id=footer-privacy-notice-link][href]{}` si se lamureste in chat (nu se trece
  in liste). La fel, un `style` real cu un cuvant de atasament (ex. `--mat-card-...`) ar da `token_card:...`.
- **Linia `token_file` lamurita.** Sursa citita de chat din pagina reala (doar citire, chat nou gol):
  `div.text-input-field.simplified-input-area` are EXACT atributele `_ngcontent-ng-c<numar>=""`,
  `xapfileselectordropzone=""`, `class`, `jslog="303810;track:impression"`. Cuvantul "file" vine din NUMELE
  `xapfileselectordropzone` (marcajul zonei de drop al selectorului de fisiere, cu valoare goala), nu dintr-un
  fisier. Regula inchisa `MARCAJE_GOALE_PERMISE`: acceptat EXACT acest nume, doar cu valoare goala, doar pe
  div-ul cu exact aceste doua clase. Orice valoare nevida, alt atribut cu "file", acelasi atribut pe alt
  element sau cu alte clase = refuz in continuare (teste negative + mutanti). Nu e o intrare in liste si nu
  e o acceptare globala a lui "file". Cu ea, pe pagina sintetica cele trei stari dau 0 necunoscute.
- Pasul 0 NU se mai repeta inainte de review; 5a pe pagina reala e confirmarea (0 necunoscute in ambele
  chaturi). Daca 5a arata totusi o linie `necunoscut ...`, STOP si se copiaza pentru chat.

**Stare (r6, 21.11.2026, dupa review-ul Jakarinos pe r5):**
- **Zona de compunere insasi (P1).** Pana la r5, elementul zonei (`<input-area-v2>` sau zona exterioara
  gasita prin clasa) NU era verificat: analiza pornea de la continutul lui, iar chip-urile si semnele se
  numarau doar pe descendenti. Un atribut, o clasa, un id sau un `style` cu nume de fisier pus chiar pe
  zona (sau marcajul `xapfileselectordropzone` pe zona) dadea 0 / 0 / 0 si brief-ul pleca. Acum zona e PRIMUL
  element verificat, cu aceleasi reguli ca orice element (semnale, media, fundal, apoi structura), iar
  chip-urile / semnele se numara si pe ea. Marcajul `xapfileselectordropzone=""` ramane permis DOAR pe
  div-ul structural exact, nu pe zona. Celelalte niveluri "parinte" (`rich-textarea`, invelisurile editorului,
  editorul) erau deja verificate ca descendenti ai zonei.
- **Datele reale, citite de chat din pagina (doar citire, 21.11.2026).** Zona `input-area-v2` are atributele
  `_ngcontent-ng-c<nr>=""`, `trace=""`, `_nghost-ng-c<nr>=""` si `class="ng-tns-c<nr>-4 ui-improvements-phase-1
  with-toolbox-drawer input-box-shadow discovery-feed-the..."` (valoarea clasei citita taiata la 100 de
  caractere) - fara semnal, deci trece (testat pe pagina sintetica, cele trei stari). Linkul "Confidentialitatea
  ta si Gemini" (chat existent) are `href="https://support.google.com/gemini/answer/14620100"`: gazda Google,
  calea fara nume de fisier - presupunerea din r5 e confirmata si testata cu valoarea exacta.
- Daca 5a arata `token_...:input-area-v2{...}` sau `atribut_fisier:input-area-v2{...}`, restul clasei zonei
  (necitit) contine un cuvant de atasament sau un nume.extensie: STOP, copiaza linia pentru chat (nu se trece
  in liste; se lamureste ca la r5).

**Stare (r7, 22.11.2026, dupa review-ul Jakarinos pe r6):**
- **Editorul insusi (P1).** Pana la r6, editorul (`div.ql-editor[contenteditable]`) avea o cale separata de
  verificare: trecea prin semnalele r4 / r5 (clase, atribute, nume de fisier), dar verificarea media / fundal
  CSS (`style` cu `url(`) se facea doar pe descendentii lui. Un `style="background: url(/resource/1234)"` (sau
  `url(blob:...)`) pus chiar pe editor dadea 0 / 0 / 0 si brief-ul pleca. Acum editorul e refuzat ca orice alt
  element: `semnal_in_editor:fundal:div[role=textbox][contenteditable]`, fara nicio actiune, in toate cele trei
  momente (tab-ul curent, chatul nou, inainte de Enter).
- **O singura functie de semnale, un singur traseu.** Ca sa nu mai existe niveluri cu reguli diferite, media
  si fundalul CSS au intrat in functia unica de semnale (`_semnal`), iar aceasta e apelata dintr-un singur loc
  (`_motiv_element`), pentru TOATE elementele analizate: zona, invelisurile de incredere (`input-container`,
  `.input-area-container`, `fieldset`, `rich-textarea`, `textarea-wrapper` / `-inner`, div-ul editorului),
  editorul, elementele din editor si toate elementele din zona (neutre, structura, liste albe, butonul
  modelului). Calea separata a editorului (`_motiv_editor`) a disparut; editorul poarta doar un context
  (in editor sunt tolerate etichetele de text ale brief-ului, nicio lista alba nu se consulta). Testul de
  paritate pune acelasi semnal pe fiecare nivel si cere acelasi tip de motiv; un test structural verifica
  ca `_semnal` are un singur apel si ca media / `url(` se verifica doar acolo. Motivele din editor sunt
  `semnal_in_editor:<semnal>` (si pentru media: `semnal_in_editor:media:img[src]`, nu mai exista
  `media_in_editor:`) si `element_in_editor:<semnatura>`; niciunul nu se trece in liste.
- La 5a, o linie `semnal_in_editor:...` cu ciorna goala pe ecran inseamna ca editorul real poarta un stil cu
  `url(` sau un atribut cu nume / cuvant de fisier: STOP, copiaza linia pentru chat (nu se trece in liste).

**Stare (r8 = v4.6.4b, 22.11.2026, dupa 5a PICAT pe v4.6.4 instalat):**
- **Ce a aratat 5a** (chat nou gol, Carbon, dupa Esc + F5, de doua ori identic): `necunoscute in zona: 3`, toate SEMNALE (`token_...`),
  deci niciuna calibrabila prin listele albe (r4: un element cu semnal e refuzat oricare ar fi lista); listele raman cele de la 21.11
  (5 + 23 + 3). Liniile, exact:
  1. `token_file:file-drop-indicator{data-filedrop-id}` - indicatorul de drag & drop (vazut gol la 21.11, e in STRUCTURA) poarta acum
     un atribut `data-filedrop-id`; cuvantul "file" e in NUMELE lui, valoarea nu era afisata. **Lamurit, regula inchisa** (`MARCAJE_PERMISE`,
     fosta `MARCAJE_GOALE_PERMISE`, acum cu forma valorii): numele EXACT, doar pe `<file-drop-indicator>` fara clase (in afara celor
     generate), doar cu valoare de identificator (`[A-Za-z0-9_-]`, cel mult 64, deci fara punct = fara nume.extensie), pe valoarea bruta;
     valoarea trece oricum si prin cautarea cuvintelor / numelor de fisier. De ce nu poate masca un atasament: indicatorul nu e chip
     (fisierele se numara doar pe `uploader-file-preview`, si in el), nu poate purta nume de fisier (regex + nume.extensie), orice alta
     clasa / atribut / continut (text, imagine, card, buton) sau acelasi atribut pe alt element = refuz in continuare (teste + 6 mutanti).
     **Presupunere declarata:** valoarea reala e un identificator fara cuvant de atasament; daca nu, 5a va arata aceeasi linie cu
     `    sursa nume_atribut:data-filedrop-id=<valoare>` (forma gresita) sau `    sursa valoare_atribut:data-filedrop-id=<valoare>`
     (cuvant in valoare) -> STOP, copiaza pentru chat.
  2. `token_incarca:gem-icon-button[type=onsurface]{menu-button gem-menu-button open gem-button gem-button-badge-size-small gem-butt}`
  3. `semnal_in_editor:token_chip:div[role=textbox][aria-label=introdu o solicitare pentru gemini][contenteditable]{ql-editor ql-blank
     textarea new-input-ui rich-query-formatting-enabled input-url}`
     **NElamurite, nimic exceptat.** Cuvintele din motiv ("incarca", "chip") NU apar in partea afisata a lui `{...}` - amandoua sunt
     taiate exact la limita de 80 de caractere a afisarii r4-r7 (a sasea clasa a butonului e taiata la "gem-butt"). "open" si "input-url"
     NU sunt cuvinte de atasament si nu se verifica ca URL (`url(` se cauta doar in `style`): elementele cu EXACT clasele afisate trec cu
     0 necunoscute (test). Sursa reala e o clasa / un atribut de dincolo de 80 de caractere, necunoscut; o exceptie pe "open" sau pe
     "url" n-ar avea niciun efect, iar una ghicita ar fi un wildcard. **Ce se schimba ca sa se vada:** `stare` afiseaza `{...}` intreg
     (pana la 400 de caractere; linia pana la 600) si, sub fiecare `necunoscut` cu semnal, `    sursa <fel>:<unde>=<valoare>` (fel =
     `tag` / `style` / `eticheta` / `clasa` / `id` / `nume_atribut` / `valoare_atribut`), calculata in aceeasi functie `_semnal` (al
     doilea element al rezultatului), fara nicio decizie pe baza ei. **La 5a liniile 2 si 3 vor aparea in continuare** (refuz, marker
     nescris), dar cu sursa: se copiaza pentru chat liniile `necunoscut` + `sursa`, iar regula exacta (daca sursa e inofensiva) intra
     intr-un commit nou, cu review.
- Fixture-ul `pagina_22_11` din teste = pagina calibrata la 21.11 + ce se vede in captura (indicatorul cu `data-filedrop-id`, clasele
  butonului "+", clasele si eticheta editorului gol): pe v4.6.4 (`A03E2B5C`) da EXACT linia 1 si nimic altceva; pe v4.6.4b 0 necunoscute,
  paza OK, `trimite` ajunge la Enter; cu un chip de fisier real in ea = `ciorna_cu_atasamente` fara nicio actiune (ca la 5b / 5c).

**Stare (r9 = v4.6.4b runda 2, 22.11.2026, dupa ce chat-ul a citit atributele COMPLETE din pagina reala):**
- **Sursa exacta a celor 3 linii.** Sesiunea de chat a citit prin CDP (doar citire, chat nou gol, dupa Esc + F5) atributele complete ale
  celor 3 elemente semnalate (`paw-data\out\paw_v464_calibrare\atribute_complete_22_11.txt`). Constatarea r8 (sursa dincolo de caracterul
  80) s-a confirmat, si niciuna nu e fisier:
  1. `<file-drop-indicator>` are EXACT: clasele Angular `ng-tns-*` / `ng-star-inserted`, atributele `_ngcontent-*` / `_nghost-*` goale si
     `data-filedrop-id="chat-window-input-container"`; fara text, fara copii.
  2. butonul "+" `<gem-icon-button>` are atributul Angular `arialabel="Incarcare si instrumente"` (FARA cratima: nu e eticheta `aria-label`
     din semnatura, ci o valoare oarecare de atribut, de aceea cuvantul "incarca" din ea era semnal) si `ariahaspopup="menu"`; clasele
     `menu-button gem-menu-button open gem-button ... lm-enabled` (meniul "+", permanent).
  3. editorul `div[role=textbox][contenteditable]` are clasele `... input-url-linkification-enabled inline-chips-enabled` (steaguri de
     functionalitate); cuvantul "chip" e in a doua.
- **Exceptii EXACTE, toate in functia unica de semnale, cate una pe element** (nicio intrare in listele albe, care raman 5 + 23 + 3):
  (1) marcajul `data-filedrop-id` e acceptat DOAR cu valoarea `chat-window-input-container` (r8 accepta orice identificator; acum nu) si
  DOAR pe un indicator IZOLAT: niciun alt atribut in afara celor Angular goale si a clasei cu doar `ng-*`, niciun copil, niciun text -
  orice alta valoare / atribut / copil readuce numele in cautare (`token_file:...`, ca pana acum), iar copilul se verifica si el;
  (2) pe `gem-icon-button`, valoarea `arialabel` EXACT `incarcare si instrumente` (dupa normalizarea ASCII, ca toate etichetele din liste)
  impreuna cu `ariahaspopup="menu"` nu e semnal - alt tag, alta valoare (si "... oferta.docx"), fara `ariahaspopup="menu"`, sau acelasi
  cuvant in alt atribut = semnal; (3) pe EDITOR, token-urile de clasa EXACT `input-url-linkification-enabled` si `inline-chips-enabled`
  (comparate intregi, nu subsir) nu intra in cautare - `chip`, `file-chip`, `inline-chips`, `inline-chips-enabled-x`, litere mari, sau
  acelasi token pe alt element (zona, rich-textarea, gem-icon, div, un p din editor) = semnal.
- **Dovezi (teste 131 -> 138, toate `python -I`):** pagina reconstituita din atributele complete da, pe gemini_pw.py din v4.6.4 instalat
  (codul real, nu mock), EXACT cele 3 linii din captura, in aceeasi ordine; pe r8 ar fi dat liniile 2 si 3 intregi cu sursa (ce prevedea
  raportul r8); pe r9 0 necunoscute si `paza ciorna: OK` in cele trei stari, `trimite` ajunge la Enter; cu un chip real tot
  `ciorna_cu_atasamente` fara nicio actiune. Abaterile fiecarui element (valoare / atribut / copil / token / alt element) sunt refuzate cu
  motivul si sursa asteptate; 12 mutanti (valoarea ca identificator, izolarea scoasa pe atribute / pe copii, `ariahaspopup` necerut,
  valoarea ca subsir, tagul necerut, token ca prefix, scutirea pe orice element, "chip" / "incarca" scoase din cuvinte, "wildcard" pe buton /
  pe editor) lasa fiecare scenariul lui sa plece si pagina reala sa treaca; pe cod toate refuza. Identificatorii acceptati de r8 (`1`,
  uuid etc.) sunt acum refuzati.
- **La 5a (v4.6.4b r9) sunt asteptate 0 necunoscute pe chat NOU si pe chat EXISTENT.** Daca apare totusi o linie `necunoscut`, ea vine cu
  `    sursa ...` sub ea: STOP, copiaza amandoua pentru chat (nu se trece in liste; regula exacta, daca sursa e inofensiva, intr-un commit nou).

**Stare (r10 = v4.6.4c, 22.11.2026, dupa 5g PICAT pe v4.6.4b instalat):**
- **Ce a aratat 5g.** Pe chatul NOU deschis de `trimite`, indicatorul de drop are, pe langa atributele reale din r9, `style=""` (GOL),
  citit de chat prin CDP (`paw-data\out\paw_v464_calibrare\atribute_5g_22_11.txt`, doar citire). Regula "izolat" din r9 (niciun alt
  atribut) il refuza: `token_file:file-drop-indicator{data-filedrop-id style}`.
- **Regula noua, EXACTA.** Marcajul `data-filedrop-id` are un al saselea camp, `goale` = `("style",)` (doar pentru indicator; div-ul r5:
  nimic): pe indicatorul izolat mai poate sta DOAR atributul cu numele exact `style`, cu valoarea goala sau doar din spatii albe HTML
  (spatiu, tab, linie noua, `\r`, `\f`; NU spatiul neseparabil, latime zero, tab vertical sau alte spatii Unicode). Orice `style` cu
  continut - `url(` (si scris cu escape CSS), `var()`, `display:none`, un nume de fisier, `--uploader-height: 112px` - face indicatorul
  ne-izolat: numele `data-filedrop-id` intra in cautare = `token_file:...` (sau `fundal:...` pentru `url(` literal), ca in r9. `style=""`
  nu acopera nicio alta abatere (alt atribut, si gol, `data-style`, clasa, copil, alta valoare = refuz ca in r9).
- **5e ramane refuz (decizia din 22.11).** Dupa scoaterea manuala a fisierelor, pana la F5, zona si editorul pastreaza
  `style="--uploader-height: 112px;"` -> `token_upload:...` cu `    sursa valoare_atribut:style=--uploader-height: 112px;`. Nu se
  excepteaza (un refuz fals e preferat): **dupa scoaterea manuala a fisierelor, F5 inainte de trimitere**.
- **Dovezi (teste 138 -> 144, toate `python -I`):** indicatorul real din 5g trece pe chat nou in cele trei stari (`paza ciorna: OK`,
  `trimite` ajunge la Enter, inclusiv scenariul 5g: tab curent fara `style`, chatul nou cu `style=""`); pe regulile v4.6.4b acelasi
  scenariu e refuzat dupa `goto`; cu chip real tot `ciorna_cu_atasamente`. Fiecare `style` cu continut e refuzat cu motivul si sursa
  asteptate (si pe chatul nou, dupa `goto`, fara click / tastatura); 5e pe zona si pe editor = refuz. 5 mutanti (style cu orice valoare,
  `match` neancorat, spatiile Unicode `\s`, orice atribut gol, numele ca subsir) lasa fiecare scenariul lui sa plece si pagina 5g sa
  treaca; pe cod toate refuza. `url(` literal ramane refuzat si de mutantul "orice valoare" (pasul fundal) - de aceea testul are si
  `u\72l(` (url( cu escape CSS), oprit DOAR de regula izolarii.
- **La 5a-5g (v4.6.4c) sunt asteptate aceleasi rezultate ca la v4.6.4b, plus 5g OK.**

**Stare (r11 = v4.6.4d, 23.11.2026, dupa refuzul FALS al unui brief lung pe v4.6.4c instalat):**
- **Ce s-a vazut.** Jurnalul refuzului (`paw-data\out\juridic_43eb636364a95c9d.log`) are 2 linii, ambele lamurite din atributele complete
  (`stare_text_lung_23_11.json`): (1) `token_file:div{text-input-field height-expanded-past-single-line pre-fullscreen with-toolbox-drawer
  jslog xapfileselectordropzone}` - acelasi div al zonei de drop (marcajul `xapfileselectordropzone=""`, GOL), dar cu alte clase decat
  cele calibrate la 21.11 (`text-input-field simplified-input-area`), deci regula marcajului nu se mai potrivea; (2)
  `element:button[aria-label=extinde intrarea la ecran complet][aria-describedby]` - butonul "Ecran complet" (`fullscreen-button`,
  tooltip "Ecran complet"), fara niciun semnal. Butonul de trimitere in starea `has-input submit` era deja acceptat.
- **Atentie: clasele reale difera de ce presupunea cererea.** In starea extinsa NU raman clasele normale: `simplified-input-area` dispare,
  iar `with-toolbox-drawer` apare. Lista inchisa `CLASE_DIV_DROP` (r12, varianta B) are 4 multimi EXACTE: normala (21.11), cea vazuta pe
  23.11 si cele doua intermediare pe aceeasi baza (doar unul din cei doi token-i ai inaltimii). Doar doua sunt VAZUTE pe pagina; cele
  doua intermediare sunt DEDUCTII (nedovedite) - 5g2 le cauta in capturi, dar nici capturile nici trimiterile nu le pot dovedi daca nu
  apar. Daca o stare reala are alte clase, refuzul e fals dar sigur (STOP, copiezi linia). Orice alt token, prefix / sufix, litere mari,
  token lipsa, ambele baze odata, alt tag, sau o valoare a marcajului = `token_file:...` ca inainte (sau `token_<cuvant>` daca o clasa
  noua contine un cuvant de atasament, ex. `pre-fullscreen-file`).
- **Butonul "Ecran complet"** e trecut EXACT cu semnatura din jurnal in lista controalelor (6 + 23 + 3); fara `aria-describedby` sau cu alta
  eticheta = element necunoscut (refuz); cu un nume de fisier in eticheta / in text / intr-un atribut, cu o clasa de atasament sau cu o
  imagine in el = refuz, oricare ar fi lista. Textul din el: vezi "Stare r12".
- **Dovezi r11 (teste 144 -> 153, toate `python -I`):** pe regulile v4.6.4c pagina reconstituita da EXACT linia `GEM_EROARE` din jurnal
  (la `inainte_de_enter`, dupa scriere, fara Enter); pe r11 aceeasi stare da 0 necunoscute, `paza ciorna: OK`, iar `trimite` ajunge la
  Enter; cu 1 / 2 fisiere reale tot `ciorna_cu_atasamente` (si cand fisierul apare odata cu textul lung: refuz chiar inainte de Enter);
  21 de abateri pe div refuzate cu motivul si sursa asteptate; 5 mutanti (supramultime, submultime, fara litere mari, forma valorii
  ignorata, semnatura controlului ca prefix) lasa fiecare scenariul lui sa plece si starea reala sa treaca; pe cod toate refuza.
  Testele noi pica pe v4.6.4c (main `ae5ca32d`).

**Stare (r12 = v4.6.4d runda 2, 23.11.2026, dupa NO-GO Jakarinos pe r11 `c8b6534a`):**
- **Ce era gresit in r11.** Un control din lista transmite contextul lui descendentilor, iar orice text fara cuvant de atasament / nume de
  fisier din el trecea ca "eticheta controlului". Jakarinos a pus `<span>continut strain arbitrar</span>` in butonul "Ecran complet":
  0 necunoscute, `trimite` ajungea la Enter. (Nu era o cale de ocolire a numararii fisierelor - chip-ul real e numarat oriunde -, dar
  un text strain langa brief nu are voie sa treaca.)
- **Ce face r12.** Butonul "Ecran complet" e un control cu text INCHIS (`CONTROALE_TEXT_INCHIS`): in el si in toti descendentii lui
  (oricat de adanc) un text e permis doar gol / doar spatii sau EXACT tooltip-ul vazut "Ecran complet" (dupa scoaterea diacriticelor si
  a literelor mari). Orice alt text = `text_in_control:<text>` (refuz inainte de Enter), chiar fara cuvinte de atasament; cu cuvinte de
  atasament / nume de fisier = `text_atasament:` / `text_fisier:` ca inainte. Numele iconitei NU e in captura din 23.11 (doar atributele
  butonului), deci nicio ligatura de iconita (`<mat-icon>fullscreen</mat-icon>`) nu e permisa: iconita fara text (svg / `gem-icon`)
  trece. Un control sau butonul modelului pus in el nu ii elibereaza textele. Celelalte 5 controale raman EXACT ca in r11 (testat:
  acelasi rezultat pe r11 si pe r12 pentru text strain / atasament / fisier / iconita in fiecare).
- **Clasele div-ului: varianta B.** Cele 3 multimi "normala + token de inaltime" din r11 sunt scoase (captura le contrazice) si sunt
  acum refuzate ca orice alta multime (in orice ordine, cu token-urile generate `ng-*`).
- **Dovezi (teste 153 -> 161, toate `python -I`):** reproducerea din verdict, copiata exact: pe r12 `text_in_control:continut strain
  arbitrar`, refuz fara nicio actiune pe o ciorna simpla si refuz inainte de Enter in starea reala cu brief lung; pe regulile r11 aceeasi
  reproducere ajunge la Enter. 14 texte straine (direct, adanc, iconite cu ligatura, controale imbricate) si 5 cu cuvinte de atasament /
  fisier: refuz inainte de Enter. Buton gol / cu iconita svg / cu tooltip-ul exact (si cu spatii / litere mari): trece si ajunge la Enter.
  Structural: o singura intrare, citita dintr-un singur loc. 6 mutanti (fara regula = r11, orice text, tooltip ca subsir, contextul
  inlocuit de un control imbricat, ligaturi acceptate, cele 3 multimi readuse) lasa fiecare scenariul lui sa plece si starea reala sa
  treaca; pe cod toate refuza. Testele noi / schimbate pica pe r11 (`c8b6534a`: 7 FAIL + 2 ERROR din 161).
- **Atentie la 5g2:** daca butonul real are in el o iconita cu text (ligatura), 5g2 da refuz fals `text_in_control:<nume iconita>`
  (sigur, nimic trimis); capturile de la 5g2 arata continutul butonului, iar numele exact intra intr-un commit nou, cu review.
- **La 5a-5g (v4.6.4d) sunt asteptate aceleasi rezultate ca la v4.6.4c; 5g2 (nou) trebuie sa treaca.**

**Stare (r13 = v4.6.4d runda 3, 23.11.2026, dupa NO-GO Jakarinos pe r12 `e2c93803`):**
- **Ce era gresit in r12.** Regula textului inchis privea doar textele afisate (nodurile text), nu ATRIBUTELE care poarta text.
  Jakarinos a pus `gemtooltip="continut strain arbitrar"` pe butonul "Ecran complet", acelasi atribut pe un `<span>` din el si un buton
  de model cu `aria-label` strain in el: toate trei 0 necunoscute, `press Enter`.
- **Ce face r13.** Pe ORICE element acceptat (zona, invelisuri, editor, elemente neutre, controalele si structura din liste, butonul
  modelului - deci si pe toti descendentii unui control) atributele cu text au voie doar GOALE sau cu o valoare EXACTA vazuta pe pagina
  reala (lista inchisa `VALORI_TEXT_CUNOSCUTE`: 13 intrari, fiecare cu sursa ei - eticheta fiecarui buton, tooltip-ul "Ecran complet",
  eticheta butonului de model DOAR cu "Carbon", eticheta si placeholder-ul editorului, identificatorii CDK ai descrierilor). Orice
  alta valoare = `atribut_text:<element>{<atribut>}` (refuz), chiar fara cuvinte de atasament. Atribute cu text = aria-label /
  aria-description si celelalte ARIA citite ca text, title / placeholder / alt / label / value, tooltip-urile Angular / Gemini, eticheta
  Angular `arialabel`, `data-placeholder` etc., orice nume cu label / tooltip / title / placeholder / descri / caption / hint,
  orice `ng-reflect-*` si orice `data-*` cu text liber (cu spatii / punctuatie; un identificator ca `data-gramm="false"` nu e text).
  Textul descrierilor (`aria-describedby` -> containerul CDK din afara casetei) se verifica dupa nume de fisier / cuvinte de atasament.
- **Deductie scrisa:** identificatorul de descriere pe `div[data-test-id=send-button-container]` nu e in capturi (doar cheia, la
  21.11); se presupune forma CDK reala `cdk-describedby-message-ng-1-<n>`, ca la celelalte. Alta forma = refuz fals (sigur) la 5g2-a,
  vizibil in `captura_caseta_*` (acum cu atributele TUTUROR elementelor casetei si textele descrierilor).
- **Dovezi (teste 161 -> 170, `python -I`):** cele 3 reproduceri copiate exact: refuz fara actiuni si refuz inainte de Enter in starea
  reala cu brief lung; cu regula r13 oprita (= r12) aceleasi ajung la Enter. 18 atribute straine x 10 locuri (control, descendent
  neutru / adanc / svg / gem-icon in control, alt control, butonul modelului, structura, invelis, div neutru) + zona / rich-textarea /
  editor / paragraf din editor: refuz. Valorile reale trec; aceeasi valoare cu un cuvant in plus / pe alt tag / alt model = refuz. Toate
  starile reale (21.11 i-iii, 22.11 i-iii si cu indicatorul 5g, 23.11 text lung si chat nou) trec si ajung la Enter. 14 mutanti
  (fara verificare, cate una din cele 6 cai de acceptare ocolita, subsir, tag ignorat, fara fragmente, fara data-*, fara ng-reflect,
  fara descriere, orice identificator de descriere) lasa fiecare scenariul lui sa plece si starile reale sa treaca; pe cod refuz.
- **5g2-a (RUNBOOK, r13):** dupa `stare` se cer `$LASTEXITCODE -eq 0`, exact o linie `paza ciorna:` si aceea = `paza ciorna: OK
  (trimite ar continua)`; captura cu cod 0 si `CAPTURA_GATA`. Altfel STOP.

**Stare (r14 = v4.6.4d runda 4, 23.11.2026, dupa NO-GO Jakarinos pe r13 `9c790264`):**
- **Ce era gresit in r13.** Lista NEAGRA (ce atribute "poarta text") nu poate fi completa: `matbadge`, `ariavaluetext` si `data-text`
  (cu valoare de forma unui identificator) pe descendentii butonului "Ecran complet" treceau; descrierea (`aria-describedby` -> tinta din
  afara casetei) accepta orice text fara fisier / cuvant de atasament. Toate patru: 0 necunoscute, `press Enter`. In plus (gasit acum, pe
  captura completa din 23.11): r13 ar fi refuzat FALS chiar pagina reala (`enterkeyhint="send"` si `tooltipanchorposition="above-end"`
  contin fragmentele "hint" / "tooltip").
- **Ce face r14 (decizia chat-ului: lista ALBA).** Pe ORICE element acceptat din zona (zona insasi, controalele si toti descendentii lor,
  structura, editorul si descendentii lui) FIECARE atribut trebuie sa fie in `ATRIBUTE_PERMISE` (67 de intrari): numele EXACT, pe tagul pe
  care a fost vazut, cu valoarea EXACTA din capturi; pentru valorile tehnice care variaza (clasele, `jslog`, `style` cu inaltimea ferestrei,
  identificatorii CDK / ai meniului) forma exacta vazuta. Atributele generate Angular `_ngcontent-ng-c<n>` / `_nghost-ng-c<n>` doar goale.
  Nume necunoscut = `atribut_necunoscut:<element>{<atribut>}`, valoare necunoscuta = `atribut_valoare:<element>{<atribut>}` (refuz);
  linia `    sursa` arata numele si valoarea (asta e calibrarea). Tinta descrierii: textul EXACT din `DESCRIERI_CUNOSCUTE` (cele 4 din
  captura: "Schimba modelul (^?M)", "Dicteaza (^?D)", "Ecran complet", "Trimite"), elementul doar cu `id` (+ `role="tooltip"`) si fara
  elemente in el; altfel `descriere_text:` / `descriere_structura:` (refuz). Sursele listei: `stare_completa_23_11.json` (gol / mediu / lung),
  `stare_text_lung_23_11.json`, `atribute_complete_22_11.txt`, `atribute_5g_22_11.txt`, `link_si_zona.txt` si semnaturile din 21.11.
- **Deductii scrise (refuz FALS, dar sigur, daca sunt gresite):** (a) `role="tooltip"` pe tinta descrierii: din sursa Angular CDK (mesajul
  tooltip-ului), nevazut in capturi; o tinta cu alt atribut = `descriere_structura:`. (b) Descendentii editorului (Quill: `<p>`, `<br>`) nu
  sunt in capturi: se presupun FARA atribute; orice atribut pe ei = `semnal_in_editor:atribut_...`. (c) Elementele vazute doar prin
  semnatura la 21.11 (butonul "Deruleaza in jos", `back-to-bottom-fab`, `span[role=status]`, linkul de confidentialitate,
  `hallucination-disclaimer`, `prompt-flow-bar`) au doar atributele din semnatura; pe pagina din 23.11 nu mai sunt in `input-area-v2`.
  (d) Identificatorul meniului de model (`ng-menu-a26090-1`) e acceptat ca forma `ng-menu-a<cifre>-<cifre>`.
  **De aceea pasul 0 e obligatoriu inainte de instalare:** `stare` din copia neinstalata r14 pe (i) chat nou gol si (iii) chat existent gol,
  apoi 5g2-a (captura acum citeste si tintele descrierilor, zona exacta a analizei si DOAR atributele elementelor din editor, fara text).
  O linie `atribut_necunoscut:` / `atribut_valoare:` / `descriere_structura:` cu ciorna fara fisiere pe ecran = STOP: numele + valoarea din
  linia `    sursa` merg la chat, care decide intrarea noua (commit nou, review). Nu se trece nimic ce seamana a fisier.
- **Dovezi (teste 170, `python -I`):** cele 4 reproduceri r3 copiate exact: refuz fara actiuni si refuz inainte de Enter (si in captura
  reala); cu lista alba oprita trec (= ce a gasit Jakarinos). 16 nume inventate x 3 valori x 11 locuri + zona / rich-textarea / editor /
  paragraf din editor + starile reale din captura: refuz. 26 de nume cunoscute cu alta valoare / pe alt tag: refuz. Fiecare triplet real
  (tag, atribut, valoare) trece; fiecare intrare din lista are cel putin un triplet real pe fiecare tag al ei (nimic inventat). 12 tinte de
  descriere straine (text, atribut, element, id dublat): refuz; textele reale (cu / fara `role`, gol, tinta lipsa): trec. Starile reale
  (captura 23.11 gol / mediu / lung cu descrierile, 21.11 i-iii, 22.11 i-iii si cu 5g, 23.11 text lung + chat nou) trec si ajung la Enter.
  15 mutanti (fara lista alba, cele 6 cai de acceptare ocolite, doar numele, tag ignorat, prefix, generate cu valoare / ca prefix, fara lista
  descrierilor, tinta cu orice atribut / cu elemente) lasa fiecare scenariul lui sa plece si starile reale sa treaca; pe cod refuz. Pe
  codul r13 (`9c790264`) testele noi pica (10 FAIL + 18 ERROR din 170).

**Stare (r15 = v4.6.4d runda 5, 23.11.2026, dupa NO-GO Jakarinos pe r14 `dd872d09`):**
- **Ce era gresit in r14.** (1) `class` si `jslog` aveau forme largi: orice token de clasa si orice `track:...` treceau, deci
  `<span class="continut-strain-arbitrar">` in butonul "Ecran complet" si `jslog="123;track:continut_strain_arbitrar"` pe buton dadeau
  0 necunoscute si `press Enter`. (2) Descrierile si etichetele din lista alba se comparau dupa `_ascii` (fara diacritice, litere mici,
  orice alt caracter -> "?"): cu referinta reala `cdk-describedby-message-ng-1-16`, "Ecran complet" cu un a-circumflex si "Dicteaza (^?D)"
  cu un ideogram in locul sagetii Shift (U+21E7) treceau (acelasi "?").
- **Ce face r15.** `class`: valoarea se imparte DOAR pe spatiile albe HTML si FIECARE token trebuie sa fie unul EXACT din
  `CLASE_PERMISE[tag]` (token-urile vazute in capturi pe acel tag; un tag fara clase vazute = doar generatele) sau un generat Angular vazut
  (`CLASE_GENERATE`: `ng-tns-c<cifre>-<cifre>`, `ng-star-inserted`, `ng-animating`). Celelalte `ng-*` vazute (`ng-trigger*`, `ng-dirty`,
  `ng-untouched`, `ng-valid`) sunt exacte pe tagul lor. `jslog`: una din valorile vazute (`JSLOG_VAZUTE`, pe tag) cu DOAR numarul de la
  inceput variabil; cheia `BardVeMetadataKey` e decodata (base64 canonic, JSON canonic) si trebuie sa fie lista vazuta: doar `null`, cu
  `[<cifre>,"ro",<cifre>,""]` pe pozitia 8 si `["<16 cifre hexazecimale>"]` (identificatorul conversatiei) pe pozitia 22, cel mult 64 de
  elemente. Textele (valorile atributelor din lista alba, textul descrierilor, textul permis in "Ecran complet", `TEXTE_CUNOSCUTE`,
  exceptia `arialabel`) se compara pe Unicode EXACT, cu sirurile reale din capturi (diacritice, U+21E7); la textele din zona se scot doar
  spatiile albe HTML de la capete. `_ascii` ramane doar pentru cautarea cuvintelor / numelor de fisier si pentru afisare.
- **Deductii scrise (refuz FALS, dar sigur, daca sunt gresite):** (a) capturile din 23.11 TAIE valorile la 300 de caractere, deci cheia
  `BardVeMetadataKey` a butoanelor 173899 / 206752 (c23) si 173899 (t23) e JSON neterminat (doar 206752 de pe t23 e intreaga): structura
  de dupa taietura (lungimea listei, alte pozitii) nu e cunoscuta; o pozitie noua = `atribut_valoare:...{jslog}`. **5g2-a citeste acum
  `jslog` netaiat** (`diag\captura_caseta.py`, r15). (b) Identificatorul conversatiei (16 hex) e singura parte variabila care nu e
  zecimala (un chat existent are alt id; aceeasi forma ca in URL-ul `/app/<id>`). (c) Eticheta "Deruleaza in jos" e trecuta cu
  diacriticele romanesti (a-breve, i-circumflex; `DEDUS_DERULEAZA`): la 21.11 s-a vazut doar semnatura ASCII. (d) Pe un chat proaspat `rich-textarea` poate avea
  `ng-pristine` / `ng-touched` (capturile arata `ng-dirty ng-untouched ng-valid`): alta stare de formular = refuz pana la recalibrare.
  (e) Clasele Quill pe paragrafele editorului (ex. `ql-align-*`) si clasele elementelor vazute doar prin semnatura la 21.11 nu sunt in
  capturi: orice clasa pe ele = refuz. **Pasul 0 + 5g2-a raman obligatorii inainte de instalare** (ca la r14); orice linie
  `atribut_valoare:...{class}` / `{jslog}` cu ciorna fara fisiere = STOP, token-ul / valoarea din linia `    sursa` merg la chat.
- **Dovezi (teste 184, `python -I`):** cele 2 reproduceri de clase / jslog si cele 2 de descrieri din verdict copiate exact: refuz fara
  actiuni si refuz inainte de Enter (si in captura reala); pe mutantul cu formele / comparatiile r14 trec (= ce a gasit Jakarinos). Clasa
  straina pe control, descendent, structura, zona, rich-textarea, editor, paragraful editorului, butonul modelului si in starile reale:
  refuz. Fiecare tipar generat: pozitive + 23 de negative. Clasele din cod = EXACT token-urile reale pe tag (sursa independenta: tripletele
  capturilor); un token real al altui tag = refuz (proprietate pe toate perechile). `jslog`: numarul variaza, orice componenta textuala noua /
  alta ordine / alt tag = refuz; cheia: 37 de structuri JSON + 10 codari base64 straine = refuz; valorile taiate exact cum au fost citite = refuz. Descrieri
  (21 de variante: diacritice, caractere, spatii in plus / minus, NBSP, latime zero, litere mari, NFD), etichete (11, in captura reala) si
  texte: refuz. 14 mutanti r15 lasa fiecare scenariul lui sa plece si starile reale sa treaca; pe cod refuz. Pe codul r14 (`dd872d09`)
  testele noi pica (27 FAIL + 8 ERROR din 184).

**Stare (r16 = v4.6.4d runda 6, 23.11.2026, dupa NO-GO Jakarinos pe r15 `7b9aa4da`):**
- **Ce era gresit in r15.** Listele albe acopereau atributele, dar NU si nodurile text: (1) un control fara lista de texte (toate, in afara
  butonului "Ecran complet") accepta orice text fara semnal - `<span>continut strain arbitrar</span>` in "Incarcare si instrumente" sau in
  "Trimite mesajul" dadea 0 necunoscute si `press Enter`, si in capturile reale mediu / lung; (2) ligaturile iconitelor treceau dupa un
  regex larg (`[a-z0-9_]{1,40}`): `<mat-icon>continut_strain_arbitrar</mat-icon>` in zona = Enter; (3) golul se decidea dupa forma ASCII:
  un nod doar cu U+0301 (accent combinat) sau U+200B (latime zero) era "gol" = Enter.
- **Ce face r16.** Orice nod text din zona, in afara editorului, trece DOAR daca e gol pe textul BRUT (doar spatiile albe HTML: spatiu, tab,
  linie noua, CR, form feed) sau daca perechea (loc, text) e EXACT in `TEXTE_CUNOSCUTE`. Locul = controlul in care sta textul (butonul
  modelului = `buton_model`; primul control ramane locul si sub controalele imbricate), altfel cel mai apropiat invelis din
  `STRUCTURA_CUNOSCUTA` (cautat doar pana la zona), altfel `zona`. Lista = 4 perechi, toate vazute: `Carbon` in butonul modelului
  (singurul text propriu din captura NETAIATA 23.11, in toate cele 3 stari), cele doua texte ale linkului de confidentialitate in link si
  avertismentul Workspace sub `hallucination-disclaimer` (chat existent, 21.11). `CONTROALE_TEXT_INCHIS` a disparut (toate controalele au
  text inchis); butonul "Ecran complet" nu mai are niciun text permis (in captura netaiata nu are niciun nod text). Ligaturile: lista
  inchisa `LIGATURI_VAZUTE` = GOALA (in captura netaiata toate iconitele au text gol, numele sta in `fonticon`). U+0301, U+200B, NBSP,
  U+2060, U+FEFF, U+3000 etc. = text nevid = refuz, afisat in escape-uri (`text:\u0301` in linia `necunoscut`). Cheia `BardVeMetadataKey`
  citita intreaga: butonul de trimitere are 35 de elemente, ultimul `[0]` (pozitia 34, nevazuta cat era taiata; r15 ar fi dat refuz FALS
  pe pagina reala) -> pozitia 34 = `[<cifre>]`, plafonul listei = 35 (cel vazut; r15: 64, dedus). 5g2-a citeste acum si `text_propriu`
  (nodurile text directe, brute) pe fiecare element.
- **Deductii / riscuri ramase (refuz FALS, dar sigur):** (a) textele butonului "Deruleaza in jos", ale lui `span[role=status]` si ale
  `prompt-flow-bar` nu sunt in captura netaiata (stau in afara `input-area-v2`); la 21.11 nu aratau niciun text, deci lista lor e goala -
  un text sau o ligatura acolo = refuz pana la recalibrare. (b) Un alt nume de model / alta forma a etichetei din butonul modelului ("Gemini
  4 Carbon" afisat ca text) = refuz (`verifica_model` ar accepta eticheta, lista textelor nu). (c) Raman cele din r15 (b)-(e).
  **Pasul 0 + 5g2-a raman obligatorii inainte de instalare**; orice linie `text:` / `text_in_control:` cu ciorna fara fisiere = STOP, textul
  (si captura 5g2-a, cu `text_propriu`) merg la chat pentru o pereche noua (commit nou, review).
- **Dovezi (teste 192, `python -I`):** cele 3 reproduceri din verdict copiate exact (span in "Incarcare si instrumente" / "Trimite mesajul"
  in capturile reale gol / mediu / lung si in starea cu brief lung, mat-icon cu ligatura inventata in zona capturii lungi, span cu U+0301 /
  U+200B): refuz fara actiuni si refuz inainte de Enter; pe regulile r15 (mutant) pleaca la Enter (= ce a gasit Jakarinos). Variante: 11
  texte x 3 forme in 7 locuri reale (fiecare control, butonul modelului, span-ul "Carbon", iconita de trimitere); "Carbon" in alt control /
  in zona; 10 forme ale lui "Carbon"; textele cunoscute pe alt loc (11 cazuri); 12 ligaturi (numele reale ale iconitelor incluse) in zona
  si in fiecare iconita reala; 14 caractere invizibile / spatii Unicode / entitati HTML in zona, sub avertisment, in controale, in butonul
  modelului, in iconita, in link si lipite de un text cunoscut. Pozitive: cele 3 stari din captura NETAIATA (si: singurul text nevid =
  "Carbon", perechile calculate din pagina = exact lista), 21.11 i-iii, 22.11 i-iii, 23.11 text lung. Testele pozitive folosesc acum
  `jslog`-urile REALE netaiate (completarea dedusa din r15 a fost scoasa). Mutanti r16 (5) + mutantii r12 rescrisi (5): fiecare lasa
  scenariul lui sa plece si starile reale sa treaca; pe cod refuz. Pe codul r15 (`7b9aa4da`) testele noi pica (45 FAIL + 4 ERROR din 192).

**Stare (r17 = v4.6.4d runda 7, 23.11.2026, dupa NO-GO Jakarinos pe r16 `ed293d49`):**
- **Ce era gresit in r16.** "Editorul" (contextul in care textul NU e verificat ca text necunoscut, fiindca se compara cu brief-ul) era
  ORICE element `contenteditable="true"` de sub `rich-textarea` - deci si `div.ql-clipboard` (prezent in toate capturile, gol). Comparatia
  cu brief-ul citea insa doar PRIMUL editor. `<div class="ql-clipboard" contenteditable="true" tabindex="-1">continut strain arbitrar</div>`
  (si `contract.pdf`, U+0301, U+200B) in capturile gol / mediu / lung dadea 2 editoare, 0 necunoscute si `press Enter`; la fel un element
  editabil pus langa editor. In plus, comparatia stergea in tacere U+200B / U+200C / U+200D / U+2060 / U+FEFF si inlocuia NBSP cu spatiu.
- **Ce face r17.** (1) EDITORUL PRINCIPAL = exact `rich-textarea > div[role="textbox"][contenteditable="true"]` (aceeasi regula in
  selectorul `EDITOR` si in analiza HTML), UNIC: in HTML altfel de 1 = `ciorna_necitibila`; la locator (vede si shadow DOM) 0 =
  `editor_lipsa`, 2+ = `editor_multiplu` (cod nou), verificat inainte de click SI chiar inainte de citirea textului. Doar el are exceptia de
  text si doar textul lui se compara cu brief-ul. `div.ql-clipboard` e acceptat DOAR exact ca in capturi: atributele `class="ql-clipboard"`
  `contenteditable="true"` `tabindex="-1"` si niciunul in plus, fara NICIUN copil (nici text, nici spatii, nici element), fiu al aceluiasi
  `rich-textarea` cu editorul, unic acolo. Orice alt element cu atributul `contenteditable` (orice valoare: "", "false", "plaintext-only",
  "TRUE"), oriunde in zona (in editor, langa el, pe `rich-textarea`, pe zona) = semnal `editabil:<semnatura>` -> refuz. (2) Comparatia cu
  brief-ul comprima DOAR spatiile albe HTML (spatiu, tab, linie noua, CR, form feed) - necesar fiindca Quill pune fiecare linie intr-un
  `<p>`, iar `inner_text()` intoarce mai multe linii noi decat brief-ul. Nimic altceva nu se sterge / inlocuieste: un caracter invizibil
  (U+200B, U+2060, U+FEFF, U+200C, U+200D, U+0301) sau un NBSP / U+3000 / VT / U+2028 prezent in editor si absent din brief =
  `text_neintrat`, fara Enter; mesajul arata punctul de cod de la prima diferenta (`editor U+200B, brief U+0052`).
- **Deductii / riscuri ramase (refuz FALS, dar sigur):** (a) NBSP: Quill are `white-space: pre-wrap`, deci spatiile scrise raman spatii
  obisnuite (presupunere, nevazuta pe pagina reala); daca la 5a / 5g `text_neintrat` arata `editor U+00A0`, e STOP si decizie noua
  (commit + review), nu o exceptie tacuta. (b) Daca Gemini schimba editorul (alt rol, nu mai e fiu direct al lui `rich-textarea`) sau
  clipboard-ul (alt atribut, text) = `ciorna_necitibila` / `editabil:` pana la recalibrare. (c) Raman cele din r16 (a)-(c).
- **Dovezi (teste 202, `python -I`):** reproducerile din verdict copiate exact (continutul clipboard-ului = `continut strain arbitrar`,
  `contract.pdf`, U+0301, U+200B, in capturile gol / mediu / lung; un `div contenteditable` cu text langa editor; un al doilea editor
  principal, si in alt `rich-textarea` din pagina): refuz fara actiuni si refuz inainte de Enter; pe regulile r16 (mutant) 2 editoare,
  0 necunoscute si Enter (= ce a masurat Jakarinos). Variante: `contenteditable` pe `span` / `div` cu 5 valori / zona / `rich-textarea` /
  in editor; clipboard cu 5 feluri de copii, 6 variante de atribute, doua clipboard-uri; locatorul cu 0 / 2 editoare (si al doilea aparut
  dupa scriere). Comparatia: 10 caractere x 4 pozitii in editor = `text_neintrat` fara Enter, cu punctul de cod; pe normalizarea r16
  (mutant) U+200B / U+2060 / U+FEFF / U+200C / U+200D / NBSP pleaca la Enter. Pozitive: 3 randari de tip Quill ale unui brief cu mai multe
  linii (linii noi in plus, CR) = Enter; acelasi invizibil si in brief si in editor = egal; starile reale (captura netaiata gol -> mediu /
  lung, 21.11 i-iii, 22.11 i-iii si cu 5g, 23.11 text lung + chat nou) = Enter, cu 1 editor principal. Mutanti r17 (5): fara `editabil:`,
  clipboard cu copii, clipboard dupa clasa, mai multe clipboard-uri, paza "cel putin un editor"; + locatorul fara `k != 1`. Pe codul r16
  (`ed293d49`) testele noi pica (17 FAIL + 2 ERROR din 202).

**Stare (r18 = v4.6.4d runda 8, 23.11.2026, dupa NO-GO Jakarinos pe r17 `50743b8f`):**
- **Ce era gresit in r17.** (1) `script`, `style`, `template` si `noscript` erau sarite cu tot continutul ("nu se afiseaza"), si in
  editor: `<style contenteditable="true">continut strain arbitrar</style>` (la fel cu celelalte trei) dadea 0 necunoscute si Enter in
  capturile gol / mediu / lung; un `<style>rich-textarea span { display: none }</style>` in zona ascundea un `<span>` strain din editor,
  iar `inner_text()` (textul VIZIBIL) ramanea egal cu brief-ul -> Enter. (2) Ultima paza citea textul cu `ed.inner_text()` INAINTE de
  `page.content()`; textul aparut in editor intre cele doua citiri era vazut de a doua, dar exclus ca "editor" -> Enter cu text in plus.
- **Ce face r18.** (1) NICIO eticheta nu mai e sarita (doar chip-urile / semnele, numarate si refuzate separat): cele patru sunt elemente
  ca oricare, fara loc in liste -> `element:` / `editabil:` / `element_in_editor:` + textul lor `text:` = refuz. In editor sunt permise
  DOAR `<p>` si `<br>`, FARA niciun atribut, in forma Quill: copiii editorului doar `<p>` (intre ele doar spatii albe HTML), un `<p>` = doar
  text SAU exact un `<br>` (linia goala); orice alta forma = `editor_structura:...` (refuz). Textul comparat cu brief-ul se citeste din
  HTML-ul BRUT (textul nodurilor, liniile lipite cu linie noua), nu din `inner_text()`: CSS-ul nu mai poate ascunde nimic din comparatie.
  (2) Ultima paza = UN SINGUR `page.content()`: din el se deriva textul comparat, editorul unic, atasamentele si necunoscutele; inainte doar
  doua citiri prin locator care pot DOAR refuza (editor unic si semne in shadow DOM); Enter imediat dupa, fara asteptari.
- **Deductii / riscuri ramase (refuz FALS, dar sigur):** (a) continutul editorului NU e in capturi (`diag\captura_caseta.py` il exclude,
  e ciorna): forma "un `<p>` pe linie, `<p><br></p>` = linie goala, fara atribute" e forma Quill standard, DEDUSA. Daca la 5a / 5g apare
  `element_in_editor:` / `editor_structura:` / `semnal_in_editor:atribut_...` pe o ciorna scrisa de script = STOP, captura editorului (doar
  etichete si atribute, fara text) si decizie noua (commit + review). Candidati plauzibili: Gemini transforma un URL in link (clasa
  `input-url-linkification-enabled`) sau o mentiune in chip (`inline-chips-enabled`) -> un brief cu URL-uri poate fi refuzat. (b) Ramane
  fereastra inerenta dintre instantaneu si Enter (orice verificare o are; acum fara nicio asteptare in ea). (c) Raman cele din r17.
- **Dovezi (teste 212, `python -I`):** reproducerile din verdict copiate exact, pe codul vechi REAL `50743b8f` si pe r18 (unealta separata,
  aceleasi fixture-uri): **33 de scenarii, pe r17 toate 33 Enter, pe r18 toate 33 refuz** (cele 4 etichete x 3 capturi in editor si in
  zona, style + span strain in editor si in paragraf x 3, editorul schimbat la ultima paza x 3). In teste: aceleasi reproduceri (refuz pe
  cod, Enter pe regulile r17 ca mutant); 11 forme ne-Quill (text direct in editor, `<br>` langa text, `<p>` gol, `<p>` in `<p>`, editor
  fara paragraf, span / div / style, `<p>` cu atribut permis in afara editorului / necunoscut); instantaneul: 27 de tipare de schimbare a
  ciornei intre citiri (curat / text strain / chip, pe 3 citiri) x 2 capturi - decizia = starea din SINGURA citire dupa scriere, Enter
  doar dupa o citire curata si nimic intre ea si Enter. Pozitive: 5 randari Quill (si cu linie goala finala, separatori, CRLF, linii
  dublate) x 5 brief-uri (si cu `& < > "`, diacritice, tab, NBSP) = Enter; starile reale (captura netaiata, 21.11 i-iii, 22.11 i-iii si cu
  5g, 23.11) = Enter cu textul citit din HTML. Mutanti r18 (6): etichetele sarite repuse, editorul r17 + text fara forma Quill, atributele
  permise pe `<p>` din editor, textul din `inner_text()`, doua citiri, o asteptare inainte de Enter. Pe codul r17 testele noi pica (18 FAIL
  + 6 ERROR din 212).

**Stare (r19 = v4.6.4d runda 9, 23.11.2026, dupa NO-GO Jakarinos pe r18 `426e2436`):**
- **Ce era gresit in r18.** `page.content()` NU serializeaza subarborii shadow. Un `<div>` permis din zona putea gazdui un shadow root cu
  `<div contenteditable="true"><p>continut strain arbitrar</p></div>`: HTML-ul analizat arata doar gazda goala (editoare 1, atasamente 0,
  semne 0, necunoscute 0), iar locatorii (editorul principal, semnele de atasament) nu se potriveau pe acel continut -> Enter.
- **Ce face r19.** Instantaneul = UN SINGUR `pg.evaluate(JS_INSTANTANEU)` (`_instantaneu`), care intoarce din ACELASI apel: HTML-ul paginii
  (`documentElement.outerHTML`, analizat ca pana acum) si numaratorile `shadow_pagina` (shadow root-uri DESCHISE in toata pagina, recursiv),
  `shadow_zona` (cele cu gazda in zona sau pe stramosii editorului), `custom_zona` (elemente custom INREGISTRATE in zona / pe stramosii
  editorului - autonome sau built-in personalizate, prin `customElements.getName(el.constructor)` / `customElements.get`), `custom_pagina`
  (doar afisat). Refuz (`ciorna_necunoscuta`, `verifica_fara_umbre`) daca `shadow_pagina`, `shadow_zona` sau `custom_zona` != 0: pagina
  reala are 0 shadow root-uri (citire CDP a chat-ului, 23.11), deci si unul in afara zonei = refuz sigur. Se aplica la toate trei pazele
  (inainte de chatul nou, pe chatul nou, ultima paza) si in `stare`; decizia ultimei paze foloseste doar rezultatul acelui apel. Forma
  rezultatului se verifica strict (exact cheile, numere intregi >= 0, HTML text), altfel `ciorna_necitibila`. Nicio citire
  `page.content()` nu mai exista in cod (testat). `stare` scrie o linie noua:
  `shadow root: pagina 0 / zona 0 | custom inregistrate: pagina 0 / zona 0` (asteptat la pasul 0; altfel STOP si captura la Rocky).
- **Limite acceptate (documentate, nu rezolvate):**
  (a) **Instantaneul si Enter raman doua operatii distincte** (fereastra de milisecunde intre `pg.evaluate` si `pg.keyboard.press("Enter")`,
  fara nicio asteptare sau alta citire intre ele). Ce le-ar face atomice: o singura operatie "citeste si, daca e curat, apasa" executata
  in browser fara intoarcere la Python - Playwright NU are asa ceva (`evaluate` nu poate apasa o tasta de incredere; un `dispatchEvent`
  din pagina e "untrusted" si Gemini il poate ignora), deci nimic disponibil. Orice paza dinainte de o actiune are aceasta fereastra.
  (b) **Un shadow root INCHIS pe o eticheta standard** (`div`, `span`, `p`...) nu se vede din JavaScript-ul paginii (verificat in Edge real:
  numaratorile raman 0). Il vede doar protocolul CDP (`DOM.getDocument` cu `pierce`, verificat in Edge real: `closed` + `open`), intr-un
  apel SEPARAT de `pg.evaluate` (nu acelasi instantaneu). Daca se vrea si acesta, e o decizie noua (commit + review): fie o citire CDP
  inaintea instantaneului care poate doar refuza (ca locatorii), fie instantaneul intreg din CDP. Elementele custom INREGISTRATE (singurele,
  in afara etichetelor standard, care pot purta un shadow root inchis creat de clasa lor) sunt deja refuzate in zona.
  **-> Jakarinos r9: NO-GO pe (b); rezolvat in r20 (instantaneul intreg din CDP, mai jos).**
  (c) Raman cele din r18 (forma Quill dedusa, URL-uri / chip-uri in editor = refuz fals) si r17 / r16.
- **Dovezi (teste 220, `python -I`):** reproducerea din verdict (in simulare, ca la Jakarinos: HTML-ul = captura reala neschimbata, shadow
  root-ul doar in numaratori) pe codul vechi REAL `426e2436` si pe r19 (unealta separata, aceleasi fixture-uri): **12 scenarii (shadow in
  zona de la inceput / doar la ultima paza, shadow in pagina in afara zonei, custom in zona) x 3 capturi: pe r18 toate 12 Enter, pe r19
  toate 12 refuz**; starile reale (0) = Enter pe ambele. In Edge REAL (headless local, retea blocata, fara Gemini, captura "mediu"):
  10 scenarii - curat 0/0/0/0 si `stare` OK; cazul din verdict (open shadow pe un div din zona cu `contenteditable` strain) = 1/1 -> refuz,
  cu 0 necunoscute in HTML (= ocolirea, acum prinsa); open shadow in afara zonei, pe `rich-textarea`, imbricat pe 2 niveluri; custom
  inregistrat cu shadow inchis, built-in personalizat (cu si fara atributul `is` in DOM) in zona = refuz; custom in afara zonei = doar
  afisat; shadow INCHIS pe div standard = 0 (limita b). Playwright intoarce numerele ca `int`. In suita (clasa `TestUmbreR19`, 8 teste):
  reproducerea, shadow in pagina in afara zonei (si pe chatul nou), custom, starile reale (si `stare`), 11 forme gresite ale rezultatului,
  tipare de umbre intre citiri (decizia = singura citire), structural (niciun `.content(`, un singur `.evaluate(`, JS-ul cu partile lui).
  Mutanti r19 (5): umbrele ignorate, doar zona, fara custom, instantaneul r18 (`content()`), doua `evaluate` in ultima paza - fiecare lasa
  scenariul lui la Enter, starile reale trec pe toti. Pe codul r18 testele noi / aliniate pica (11 FAIL + 1 ERROR din 220).

**Stare (r20 = v4.6.4d runda 10, 23.11.2026, dupa NO-GO Jakarinos pe r19 `5a1e2613`):**
- **Ce era gresit in r19.** Un shadow root INCHIS (`attachShadow({mode: 'closed'})`) pe un `div` standard din zona, cu continut strain:
  `el.shadowRoot` = null din JavaScript-ul paginii, deci numaratorile evaluate erau 0, HTML-ul nu avea subarborele, iar paza dadea
  `editoare=1, atasamente=0, semne=0, necunoscute=0` -> Enter. Limita (b) din r19 nu era acceptata de brief.
- **Ce face r20 (decizia chat-ului).** Instantaneul ultimei paze = UN SINGUR apel CDP: `pg.context.new_cdp_session(pg)`, apoi
  `DOM.enable({includeWhitespace: "all"})` si `DOM.getDocument({depth: -1, pierce: true})`, apoi desprinderea sesiunii (nu decide nimic).
  Din ACELASI raspuns se deriva TOT: arborele analizat (`_arbore_cdp` construieste aceleasi noduri ca parserul HTML de pana acum - tag si
  nume de atribut in litere mici, noduri text cu textul brut, continutul unui `<template>` ca copii; comentariile / doctype ignorate),
  textul editorului, atasamentele, necunoscutele si numararea shadow root-urilor. Cu `pierce`, CDP intoarce TOATE shadow root-urile
  (`open`, `closed`, `user-agent`) si documentele iframe-urilor din acelasi proces. Reguli (`verifica_umbre_cdp`): orice shadow root `open`
  / `closed` / de alt tip, oriunde (si imbricat in alt shadow root, si in documentul unui iframe) = `ciorna_necunoscuta`; `user-agent` (al
  browserului: `input`, `img`, `video`...; continutul lui nu se parcurge) doar in afara zonei (zona = elementele ZONA si ce e sub ele, plus
  stramosii editorului, ca in r19). CDP indisponibil, eroare CDP sau raspuns cu alta forma = `ciorna_necitibila` (nu exista cale de rezerva).
  Citirea din `pg.evaluate` (r19, acum `JS_UMBRE`, fara HTML) ramane INAINTEA instantaneului si poate doar refuza (ca locatorii); la fel
  in pazele dinaintea chatului nou / pe chatul nou si in `stare`. `stare` scrie o linie noua:
  `shadow root CDP: deschise 0 / inchise 0 / alt tip 0 | user-agent: pagina N / zona 0 | documente iframe: N`.
  Doua detalii ale CDP, verificate in Edge 157 (`sonda_cdp.py`): fara `includeWhitespace: "all"` Chromium SARE nodurile text din doar
  spatii (`<div>  </div>` apare fara copil; de aceea parametrul e obligatoriu si testat), iar un text mai lung de 10000 de caractere vine
  TAIAT (10000 + `...` U+2026): un astfel de text in zona = necunoscut `text_trunchiat_cdp:` (refuz), iar un brief cu o linie de peste 10000
  de caractere e refuzat la inceput (`brief_invalid`, nicio actiune).
- **Pagina reala (doar citire, Edge 9333, 23.11 seara, chat nou `/app`, ciorna goala, Carbon):** `DOM.getDocument(pierce)` = **0 shadow
  root-uri open / closed / alt tip**, **1 user-agent** (pe un `img`, poza de profil din fereastra de chat, in afara zonei), 3 documente
  iframe (fara shadow root-uri). Analiza din arborele CDP = analiza din `outerHTML` (identice, camp cu camp). ATENTIE: pe pagina de azi
  analiza (si cea r19, si cea r20) da **10 necunoscute** pe chatul nou gol (zona exterioara e acum `input-container`, cu `trace`,
  `back-to-bottom-fab`, `span[role=status][aria-atomic]`, disclaimer-ele de sub caseta...) -> `paza ciorna: REFUZ` (refuz FALS, sigur:
  nimic trimis). E o schimbare a paginii, nu a r20: pasul 0 o arata; recalibrarea e runda separata (zona citita, doar citire:
  `paw-data\out\rocky_r20_zona_reala.html`).
- **Limite acceptate:** (a) din r19 ramane: instantaneul (`DOM.getDocument`) si Enter sunt doua operatii distincte (fereastra de ms, fara
  asteptari sau alte citiri intre ele; desprinderea sesiunii CDP e singurul apel intre ele si nu citeste nimic). (b) iframe-urile din ALT
  proces (alt site) nu au `contentDocument` in raspuns; un iframe in zona e oricum refuzat (`media:`). (c) Pseudo-elementele CSS
  (`::before` / `::after`) nu intra in arbore (ca la HTML). (d) Shadow root-urile user-agent apar abia dupa layout (un `input` adaugat prin
  JS e vazut ca element, iar umbra lui doar dupa randare); in zona orice astfel de element e refuzat oricum ca element necunoscut.
- **Dovezi (teste 232, `python -I`):** clasa `TestUmbreCdpR20` (12 teste), cu pagina falsa CDP (forma verificata in Edge 157; spatiile
  sarite fara `includeWhitespace`, textele taiate la 10000): reproducerea din verdict (shadow INCHIS pe un div din zona cu
  `<div contenteditable="true"><p>continut strain arbitrar</p></div>`: evaluate 0, HTML 0 necunoscute, CDP `inchise 1` -> refuz de la
  inceput fara actiuni / la ultima paza fara Enter; pe instantaneul fara umbre (M109 = ce vedea r19): Enter) x 3 capturi; inchis / deschis
  / alt tip / fara tip in afara zonei si pe `rich-textarea`; imbricat (inchis in deschis / in inchis); inchis in documentul unui iframe;
  user-agent pe un `img` in afara zonei = OK, in zona / pe zona / pe stramosii editorului = refuz; `ql-clipboard` cu un spatiu = refuz doar
  cu `includeWhitespace`; text taiat in zona / in afara; linia de 10001 / 10000 de caractere; CDP indisponibil (de la inceput / doar la
  ultima paza), 16 forme gresite ale raspunsului si erori la `DOM.enable` / `DOM.getDocument` = `ciorna_necitibila`; arborele CDP = cel
  HTML pe toate capturile reale si pe reproducerile negative; 16 tipare de umbre CDP intre citiri (decizia = singurul instantaneu);
  `stare`; structural. Mutanti r20 (9): umbrele CDP ignorate, doua instantanee, fara `includeWhitespace`, user-agent in zona acceptat,
  `closed` acceptat, iframe-uri neparcurse, tipuri necunoscute acceptate, fara verificarea liniilor brief-ului - fiecare lasa scenariul lui
  la Enter (sau refuza abia la ultima paza), starile reale trec pe toti; al noualea (umbrele imbricate neparcurse) schimba doar numararea
  (umbra exterioara e refuzata oricum). In Edge REAL (headless local, retea blocata, fara Gemini; `edge_real_r20.py`): pe 14 capturi
  reale analiza din `_instantaneu` = analiza HTML, 0 umbre; 11 scenarii OK (cazul din verdict = `inchise 1` -> refuz; inchis in afara
  zonei, deschis in zona, inchis in deschis, inchis in iframe srcdoc = refuz; `input` in afara zonei = OK, in zona = refuz; clipboard cu
  spatiu = refuz; text de 12000 in zona = refuz, in afara = OK); `stare` pe captura = OK, 0 cereri de retea.

**Stare (r21 = v4.6.4d runda 11, 23.11.2026, dupa NO-GO Jakarinos pe r20 `fa6fac8e` + recalibrarea pe pagina de azi):**
- **Ce era gresit in r20 (P1).** Trunchierea CDP se detecta cu `len(v) > 10000` (puncte de cod), iar Chromium taie dupa 10000 de UNITATI
  UTF-16 (un emoji = 2). Reproducerea din verdict: brief = emoji + 9998 `a` + U+2026 (`len` 10000, trecea validarea), textul real din
  editor = emoji + 9998 `a` + `CONTINUT STRAIN`; CDP il arata EXACT ca brief-ul (10000 de puncte de cod), paza nu vedea taietura -> Enter.
- **Ce face r21.** `_u16` = lungimea in unitati UTF-16; `_taiat_cdp` = peste 10000 de unitati SAU exact 10000 terminate cu U+2026 (aparare:
  jumatatea unei perechi taiate pierduta pe drum). Aceeasi regula pe textele CDP din zona (`text_trunchiat_cdp:<n> unitati UTF-16 citite`,
  refuz) si pe liniile brief-ului la inceputul lui `trimite` (`brief_invalid`, nicio actiune). Verificat in Edge 157.0.4341.60 (headless,
  local, `edge_real_r21.py`): cazul din verdict vine ca 10000 de puncte de cod / 10001 unitati terminate cu U+2026; o pereche taiata vine
  ca U+FFFD + U+2026 (10001 unitati); simulatorul din teste taie identic in toate cele 8 cazuri masurate.
- **Recalibrarea (pagina de AZI, Edge 9333, un tab, chat nou `/app`, Carbon, nimic atasat).** Rocky a citit (doar citire) zona si a scris
  in ciorna DOAR textele de calibrare 5g2-a (`scurt` / `mediu` / `lung`, cu `insert_text`, ca `trimite`, FARA Enter), golite imediat
  (Ctrl+A, Delete; ciorna verificata goala dupa fiecare). Pe codul r20: aceleasi **10 necunoscute** in toate 4 starile (gol / scurt / mediu
  / lung). Inventarul complet (toate atributele, nu doar primul motiv pe element): 33 de diferente, TOATE atribute / valori / clase pe
  elemente deja cunoscute; niciun element nou, niciun text nou (paragraful avertismentului e gol pe chatul nou: doar un `<br>`). Adaugate
  EXACT valorile vazute (aceleasi in cele 4 stari): `trace=""` pe `input-container` + clasele lui (`hide-on-print`,
  `input-gradient-overlay`, `edge-to-edge`, `lm-input-redesign`, `grow-input-downwards`); pe `span[role=status]` `aria-atomic="true"`,
  `aria-live="polite"`, clasele `cdk-visually-hidden`, `inline-upgrade-banner-live-region`; pe `back-to-bottom-fab` clasa lui; pe butonul
  "Deruleaza in jos" clasa `back-to-bottom-fab`, `aria-hidden="true"`, `tabindex="-1"`, `jslog` `<N>;track:generic_click`; pe iconita lui
  `gem-icon` `fonticonname="arrow_downward"`, `size="medium"` si `mat-icon` cu `lm-icon-m`, `arrow_downward`, `data-mat-icon-namespace=""`,
  `style='font-family: "Google Symbols";'`; pe `div.input-area-container` clasele `input-area-container`,
  `ng-trigger-inputAreaAnimation` si style-ul exact (`--initial-input-half-height: 32px; position: absolute; bottom: 50vh; ...`); pe
  `hallucination-disclaimer` `aligntext="center"` + clasele lui; pe `div.capabilities-disclaimer` clasa si `style="--align-text: center;"`;
  pe `p[data-test-id=empty-disclaimer]` clasele `gds-body-s`, `empty-disclaimer`, `desktop-spacing`. Cu codul r21, pe pagina reala:
  **`necunoscute in zona: 0` si `paza ciorna: OK (trimite ar continua)` in toate 4 starile** (`rocky_r21_calibrare\v2_stare_*.txt`).
  Vazute acum (erau deductii): eticheta `Deruleaza in jos` cu diacritice (`DEDUS_DERULEAZA`) si tintele descrierilor cu exact `id` +
  `role="tooltip"`.
- **NU s-a vazut azi:** (iii) chat EXISTENT (brief-ul interzicea deschiderea altui chat): pe el pot aparea alte clase / atribute (de ex.
  `prompt-flow-bar`, avertismentul Workspace in noua structura a disclaimer-ului). La pasul 0 (iii) si la 5a-5g pe o conversatie existenta,
  orice linie `necunoscut ...` = refuz FALS (sigur, nimic trimis): STOP, liniile la chat pentru o recalibrare.
- **Dovezi (teste 246, `python -I`):** `TestUtf16R21` (7) - masura UTF-16 si pragurile; simulatorul = Chromium; reproducerea din verdict pe
  7 pagini (capturile 23.11 gol / mediu / lung + pagina de azi in 4 stari): brief-ul refuzat la inceput fara actiuni, fara verificarea
  liniilor (M118) textul real e vazut taiat si refuzat inainte de Enter, pe masurarea r20 = Enter; doua linii sub limita lipite intr-un
  paragraf (M119 = Enter); perechea taiata ca U+FFFD / surogat singur / pierduta (M120 = Enter); limita liniilor (10000 / 10001 unitati,
  emoji, U+2026); mutantii M118-M120 lasa starile reale sa treaca; structural. `TestPaginaAziR21` (6) - fixture GENERAT din capturile de
  azi (`CAPTURA_Z23S`): cele 4 stari trec (analiza, CDP, `trimite` pana la Enter, `stare` OK); pe listele r20 exact cele 10 linii vazute;
  FIECARE din cele 33 de adaosuri e necesar (fara el pagina e refuzata in toate starile); valorile vecine raman refuzate; descrierile;
  token / text strain = refuz. Tripletele reale de azi intra in testele listei inchise (`REALE`). Pe codul r20 (`fa6fac8e`) testele noi /
  aliniate pica: 18 FAIL + 3 ERROR din 246; reproducerea pe codul r20 real (`repro_vechi_r21.py`): brief-ul din verdict = Enter pe
  capturile 23.11 (pe pagina de azi codul r20 refuza oricum tot, cele 10 necunoscute), pe r21 = `brief_invalid`.

**Stare v4.6.4e (23.11.2026 seara, varianta de pagina de dupa F5, pe v4.6.4d instalat `50332B12...`):**
- **Vazut (5e, `stare`, ciorna goala dupa F5, chat nou, Carbon):** 3 necunoscute - `style=""` pe `simplified-input-menu` si pe
  `speech-dictation-mic-button`, clasa lui `rich-textarea` cu `ng-pristine`. Captura chat-ului (doar citire, ciorna golita dupa):
  `paw_v464_calibrare\stare_completa_23_11_varianta_f5.json`, starile gol / mediu / lung, aceeasi forma ca captura netaiata (lista plata).
- **Comparatia (tripletele tag / atribut / valoare, fara atributele `_ng*` si token-urile generate `ng-tns-*` / `ng-star-inserted`):**
  fata de c23 / c23n / t23 / z23s exact 3 diferente: `style=""` pe cele doua taguri (gol / mediu / lung) si `ng-pristine` pe
  `rich-textarea` (doar gol; in mediu / lung clasa are `ng-dirty`, ca in c23n). Aceleasi taguri, adancimi si texte ca c23n; descrierile =
  aceleasi 4 texte cunoscute (alte numere `ng-1-13` / `ng-1-14`, forma deja permisa). `enterprise` / `simplified-input` erau deja pe lista.
- **Adaugate EXACT:** o intrare `ATRIBUTE_PERMISE` `(("simplified-input-menu", "speech-dictation-mic-button"), "style", GOL)` si
  `ng-pristine` in `CLASE_PERMISE["rich-textarea"]`. Cu v4.6.4e: **`necunoscute in zona: 0`, `paza ciorna: OK`** pe varianta F5 (3 stari),
  pe c23n (3 stari) si pe z23s (4 stari); `trimite` ajunge la Enter si cu tab-ul intr-o varianta si chatul nou in cealalta.
- **Dovezi (teste 253, `python -I`):** `TestVariantaF5` (7) - fixture GENERAT din captura (`CAPTURA_F5`, adancimile din c23n verificate
  pe secventa exacta de taguri); ambele variante trec (analiza, arborele CDP, `stare` OK, `trimite` pana la Enter); pe listele v4.6.4d
  exact liniile din `stare` (3 in gol, 2 in mediu / lung) si refuz fara nicio actiune; FIECARE din cele 3 adaosuri e necesar; negative:
  `style` cu continut (spatiu, NBSP, tab, `display:none`, style-urile altor taguri, `url(` = `fundal:`) pe cele doua taguri = refuz,
  `style=""` pe alte taguri = refuz, token strain / variante ale lui `ng-pristine` pe `rich-textarea` = refuz, `ng-pristine` pe orice alt
  tag = refuz; structural. Tripletele f5 intra in testele listei inchise (`REALE`). Pe v4.6.4d instalat real (`50332B12...`, copie in
  afara repo-ului): testele noi / aliniate pica (8 FAIL + 1 ERROR din 253; ERROR = testul care citeste RUNBOOK-ul, absent din copie);
  reproducerea (`repro_vechi.py`): varianta F5 = exact cele 3 linii din `stare`, iar `trimite` cu chatul nou in varianta F5 =
  `ciorna_necunoscuta` dupa `goto`; pe v4.6.4e = Enter.
- **NU s-a vazut:** combinatii de stari Angular nevazute (de ex. `ng-pristine` cu text in ciorna) sunt acceptate token cu token, ca toate
  clasele (lista e pe token, nu pe multime); nu sunt semne de atasament. Chat EXISTENT dupa F5: nevazut - la 5a pe un chat existent,
  orice `necunoscut ...` = STOP, liniile la chat.

**Stare v4.6.4f (23.11.2026 seara, F5 repetat, pe v4.6.4e instalat `4132781B...`):**
- **Vazut (testul de canal, `stare` dupa 6 reincarcari, ciorna goala, chat nou, Carbon):** aleator, 3 necunoscute - `style=""` pe
  `back-to-bottom-fab`, `auto-suggest`, `hallucination-disclaimer` (`paw_v464_calibrare\stare_f5b_necunoscute.txt`). Captura chat-ului
  (doar citire, ciorna golita dupa): `stare_completa_23_11_varianta_f5b.json`, gol / mediu / lung, aceeasi forma ca f5. Fata de f5:
  EXACT `style=""` in plus pe `auto-suggest` (toate starile); restul = doar numere generate (`aria-describedby` CDK, `aria-controls` meniu,
  atributele `_ng*`), aceleasi 4 descrieri. Celelalte doua taguri sunt in zona exterioara (z23s), nu in captura `input-area-v2`.
- **Regula noua (una singura, `_style_gol` in `_atribut_strain`):** `style` cu valoarea EXACT sirul vid trece pe orice element care a
  ajuns deja la verificarea atributelor (adica a trecut semnalele si e pe lista alba de taguri / controale / structura / neutre). Restul
  atributelor elementului se verifica in continuare. Neschimbat: orice `style` cu continut (si `" "`, NBSP, tab, `;`) = aceeasi clasificare
  ca pe v4.6.4e; element neacceptat cu `style=""` = acelasi refuz; `<p>` / `<br>` in editor cu `style=""` = `atribut_in_editor`;
  `div.ql-clipboard` cu `style=""` = semnalul `editabil:`. Intrarile `style` existente din `ATRIBUTE_PERMISE` raman (doar pentru
  clasificarea valorilor cu continut).
- **Dovezi (teste 262, `python -I`):** `TestStyleGolV464f` (9) - fixture GENERAT din captura (`CAPTURA_F5B`, adancimile din f5 verificate
  pe secventa exacta de taguri; tripletele lui intra in `REALE`); pe v4.6.4e (regula oprita) exact liniile din `stare_f5b_necunoscute.txt`
  (pagina z23s cu `style=""` pe cele trei taguri, 4 stari) si f5b = `auto-suggest{style}`, refuz fara nicio actiune; pe v4.6.4f: f5b
  (3 stari), z23s cu cele trei `style=""` (4 stari), f5, c23n, z23s = 0 necunoscute, arborele CDP identic, `stare` OK, `trimite` pana la
  Enter (si amestecat); `style=""` pe FIECARE element real din c23n / f5 / f5b / z23s (peste 700 de cazuri, unul cate unul si toate
  deodata) = 0 necunoscute, cu exceptia `ql-clipboard` (refuz, ca pe v4.6.4e); `style` cu continut pe fiecare element real = analiza
  identica cu v4.6.4e; 18 valori negoale pe cele trei taguri = refuz; 9 elemente neacceptate cu `style=""` = acelasi refuz ca fara style
  si ca pe v4.6.4e; `data-placeholder` necapturat = refuz; structural. Testele vechi neschimbate, cu o exceptie aliniata: in
  `TestVariantaF5` asertiunile `style=""` pe alte taguri = refuz ruleaza acum cu regula oprita (= comportamentul v4.6.4e), iar simularile
  listelor vechi (`fara_r21`) opresc si regula. 8 mutanti ai regulii (fara regula, spatii albe, `strip()`, nume fara majuscule, orice nume
  gol, tot elementul acceptat, doar pe taguri fara intrare, orice `style`) pica toti. Pe v4.6.4e instalat real (`4132781B...`, copie in
  afara repo-ului): testele noi / aliniate pica (7 FAIL + 2 ERROR din 262; un ERROR = testul care citeste RUNBOOK-ul, absent din copie).
- **NU s-a adaugat:** `data-placeholder` = `Introdu @ pentru conectori, abilitati si altele` (vazut o data, doar forma ASCII din `stare`;
  valoarea reala nu e in nicio captura) - ramane refuz sigur. Daca reapare la 5e: STOP, captura cu valoarea exacta, adaos separat.

Se ruleaza `stare` (doar citire: continutul paginii + numarari + citirea CDP `DOM.getDocument`, fara click / tastatura / navigare)
din copia NEINSTALATA a commit-ului curent al PR-ului (`git archive` dezarhivat, de ex. in
`C:\Users\Public\livrare\run_paw_v464_calibrare`), cu Edge 9333, un singur tab Gemini, Carbon
selectat si niciun `gem` pornit prin lansator:

```powershell
$Cal = 'C:\Users\Public\livrare\run_paw_v464_calibrare\docs\paw\run_paw_v464'
& 'C:\Program Files\Python313\python.exe' "$Cal\gemini_pw.py" stare
```

De trei ori: (i) chat nou (`/app`), ciorna goala; (ii) acelasi chat, cu un cuvant scris DE MANA
in ciorna (fara Enter; apoi il stergi); (iii) un chat existent, ciorna goala. Pe ecran, in toate
trei: niciun fisier, nicio imagine, niciun instrument selectat. Copiaza pentru sesiunea de chat
toate liniile `necunoscute in zona: N` si `  necunoscut ...`. Rocky trece in listele albe EXACT
acele semnaturi (commit nou, hash-uri noi, review din nou). NU se trec niciodata linii `media:`,
`fundal:`, `eticheta:`, `text_fisier:`, `text_atasament:`, `token_...:`, `atribut_fisier:`,
`..._in_editor:` sau orice seamana a fisier (din r4 nici n-ar avea efect: semnalele se verifica
inaintea listelor): daca apar cu ciorna goala pe ecran, STOP si se lamureste in chat. Pasul 0 nu
scrie nimic si nu trimite nimic.

## 1. Variabile (A si N, in orice consola noua, inclusiv la rollback)

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v464f\docs\paw\run_paw_v464'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$Audit = Join-Path $PawRoot 'operator-v464f'
$SufVechi = '.v464e'     # sufixul copiilor de siguranta (ce e instalat acum: v4.6.4e)
$SufNou = '.v464f'       # sufixul fisierelor noi din zona protejata
$GemMarker = 'C:\Users\Public\paw-data\gem_canal_validat'
$Python = 'C:\Program Files\Python313\python.exe'
$ManifestHash = 'INLOCUIESTE_CU_HASH_MANIFEST_DIN_RAPORT'
$GemHashNou = 'INLOCUIESTE_CU_HASH_GEMINI_PW_DIN_RAPORT'
$DiagHash = 'INLOCUIESTE_CU_HASH_CAPTURA_CASETA_DIN_RAPORT'    # diag\captura_caseta.py (pasul 5g2; nu se instaleaza)
$GemHashVechi = '4132781B0429681145C6DC73F3F409A8EC4CD7A69CD30CB902332B4FB4D851AC'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
```

`$GemHashVechi` = `gemini_pw.py` din v4.6.4e (instalat acum in `bin`, recitit 23.11.2026 seara, = main `03bf2b24`). Istoric: la
instalarea v4.6.4e peste v4.6.4d valorile au fost `$Audit = operator-v464e`, `$GemHashVechi = 50332B129BEAC6C14992E4B42905146BC3FAC904AB8F02D61EA598DAE3FE1BD0`
(v4.6.4d), sufixele `.v464d` / `.v464e`; la instalarea v4.6.4d peste v4.6.4c valorile au fost `$Audit = operator-v464d`, `$GemHashVechi = 09E78891CD4D73DA5B457D0397CC2CE6BD2A7E83EF3F7AD51C320AF0D69EA862`
(v4.6.4c), sufixele `.v464c` / `.v464d`; la instalarea v4.6.4c peste v4.6.4b valorile au fost `$Audit = operator-v464c`, `$GemHashVechi = 5B0CCD4851A2B2A5BCCB0CF0B76A087F544051091827B998A156C35D082972CD`
(v4.6.4b), sufixele `.v464b` / `.v464c`; la instalarea v4.6.4b peste v4.6.4 valorile au fost `$Audit = operator-v464b`, `$GemHashVechi = A03E2B5C5ABD5D80709E5E1FB87126F4986245389B4E0943796589E2156AF7B6`
(v4.6.4), sufixele `.v464` / `.v464b`; la instalarea v4.6.4 peste v4.6.3: `operator-v464`, `BE3B867B0BD7FA2333D009B54258A146DF72F4D78C2706C321ABEB2D21AED9F5`
(v4.6.3), `.v463` / `.v464`. Folderele `operator-v464`, `operator-v464b`, `operator-v464c`, `operator-v464d` si `operator-v464e` raman
pe disc (copiile v4.6.3 / v4.6.4 / v4.6.4b / v4.6.4c / v4.6.4d), nu se ating.

## 2. Verificari inainte de inlocuire (N - NU in consola admin; o data, inainte de pasul 3)

Testele ruleaza cod din folderul de livrare (scriibil de utilizator): de aceea DOAR ne-elevat.

```powershell
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $GemHashNou -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-urile din raport' }
if ((Get-FileHash -LiteralPath "$Source\SHA256.json").Hash -ine $ManifestHash) { throw 'Alt pachet' }
$manifest = Get-Content -LiteralPath "$Source\SHA256.json" -Raw | ConvertFrom-Json
if (@($manifest.PSObject.Properties).Count -ne 12) { throw 'Manifestul nu are 12 fisiere' }
foreach ($e in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $e.Name)).Hash -ine $e.Value) { throw "Hash diferit in pachet: $($e.Name)" }
    if ($e.Name -ne 'gemini_pw.py' -and (Get-FileHash -LiteralPath (Join-Path $Bin $e.Name)).Hash -ine $e.Value) { throw "Difera de instalat: $($e.Name)" }
}
if ($manifest.'gemini_pw.py' -ine $GemHashNou) { throw 'gemini_pw.py din pachet nu e cel revizuit' }
if ($DiagHash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-ul lui diag\captura_caseta.py din raport' }
if ((Get-FileHash -LiteralPath "$Source\diag\captura_caseta.py").Hash -ine $DiagHash) { throw 'diag\captura_caseta.py nu e cel revizuit' }
if ((Get-FileHash -LiteralPath "$Bin\gemini_pw.py").Hash -ine $GemHashVechi) { throw 'gemini_pw.py instalat nu e cel asteptat (vezi $GemHashVechi)' }
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\gemini_pw.py") (Get-Content -LiteralPath "$Source\gemini_pw.py"))
$d | Where-Object SideIndicator -eq '<=' | Format-List
if ($d.Count -ne 18 -or @($d | Where-Object SideIndicator -eq '<=').Count -ne 1) { throw "Diff gemini_pw.py neasteptat: $($d.Count) linii" }
$ErrorActionPreference = 'Continue'    # unittest scrie pe stderr; in unele gazde PowerShell 5.1 asta ar opri blocul
& $Python -I "$Source\teste\test_gemini_pw.py"
$cod = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($cod -ne 0) { throw 'Testele gemini_pw.py au picat' }
# copia markerului existent (daca exista), pentru rollback - ne-elevat (paw-data e scriibil de utilizatori)
if (Test-Path -LiteralPath $GemMarker) { Copy-Item -LiteralPath $GemMarker -Destination ($GemMarker + $SufVechi) -Force }
```

Asteptat (pachetul v4.6.4f, fata de v4.6.4e INSTALAT in `bin`, `4132781B...`): **18 linii diferite (1 veche `<=`, 17 noi `=>`)**.
Linia veche = ultima linie a comentariului lui `_atribut_strain` (`# fara _ascii); _ascii ramane doar la afisare (linia `sursa`).`),
rescrisa cu nota v4.6.4f. Liniile noi: nota v4.6.4f din antet (7), functia `_style_gol` (4 linii: definitia, 2 comentarii, `return`) si
cele 2 linii goale de dupa ea, comentariul rescris al lui `_atribut_strain` (2) si cele 2 linii ale regulii (`if _style_gol(k, v):` /
`continue`). Testele: `Ran 262 tests ... OK`. Informativ: fata de v4.6.3 (`BE3B867B...`) 1694 / 26 / 1668; fata de origin/main
(`03bf2b24`, = instalat) tot 18 / 1 / 17.

Istoric (pachetul v4.6.4e, fata de v4.6.4d instalat atunci, `50332B12...`): 12 linii diferite (2 vechi `<=`, 10 noi `=>`).
Cele 2 linii vechi = cele doua linii ale intrarii `"rich-textarea": (...)` din `CLASE_PERMISE` (rescrisa cu `ng-pristine`). Liniile noi:
nota v4.6.4e din antet (7), cele doua linii noi ale intrarii `"rich-textarea"` si intrarea `style` GOL pe `simplified-input-menu` /
`speech-dictation-mic-button` din `ATRIBUTE_PERMISE`. Testele: `Ran 253 tests ... OK`. Informativ: fata de v4.6.3 (`BE3B867B...`)
1678 / 26 / 1652; fata de origin/main (`b8e9f541`, = instalat) tot 12 / 2 / 10.

Istoric (pachetul v4.6.4d = r21, fata de v4.6.4c instalat atunci, `09E78891...`): 1038 linii diferite (86 vechi `<=`, 952 noi `=>`).
Cele 86 de linii vechi = EXACT cele 86 din r20 (mai jos; r21 nu schimba nicio linie venita din v4.6.4c - doar linii adaugate de r11-r20
sau noi). Liniile noi r21: nota r21 din antet; `_u16` / `_taiat_cdp` / `ELIPSA_CDP` + comentariul lor; masurarea UTF-16 in `_arbore_cdp`,
in mesajul `text_trunchiat_cdp:` si in verificarea liniilor brief-ului din `trimite`; adaosurile din listele albe (comentariul z23s,
`CLASE_PERMISE` rescris cu token-urile noi, o intrare `jslog`, `ICOANE` + `STYLE_ICONITA` / `STYLE_ZERO_STATE` / `STYLE_DISCLAIMER`, 7
intrari noi si 4 schimbate in `ATRIBUTE_PERMISE`). Testele: `Ran 246 tests ... OK`. Informativ: fata de v4.6.3 (`BE3B867B...`)
1670 / 26 / 1644; fata de r20 (`479E64CF...`, head-ul anterior al PR-ului, neinstalat) 115 / 30 / 85.

Istoric (r20, fata de acelasi v4.6.4c instalat): 983 linii diferite (86 vechi `<=`, 897 noi `=>`).
Cele 86 de linii vechi = cele 84 din r19 (mai jos) + 2 noi, din v4.6.4c, schimbate de r20: cele doua linii ale docstring-ului lui
`analizeaza_ciorna` (`"""HTML-ul paginii -> dict: editoare, zone ...` si `atasamente (chip-uri CHIP ...) ... detalii."""`; acum
`analizeaza_ciorna` doar parseaza HTML-ul pentru teste, iar analiza sta in `analizeaza_arbore`, cu docstring nou). Liniile noi r20: nota
r20 din antet, `analizeaza_arbore` (corpul vechi + `text_trunchiat_cdp:`), comentariul r19 / r20 + `JS_UMBRE` (fara HTML) + `_umbre_js`,
`LIMITA_TEXT_CDP` / `CHEI_UMBRE_CDP` / `TIPURI_UMBRE`, `_cdp_rau` / `_lista_cdp` / `_atribute_cdp` / `_arbore_cdp`, `_instantaneu` (CDP),
`verifica_umbre_cdp`, `_citeste_ciorna` / `_paza_ciorna` / `_ultima_paza` / `stare` cu citirea evaluate inainte si instantaneul CDP ultimul,
linia `shadow root CDP: ...` din `stare`, verificarea liniilor brief-ului (`brief_invalid`) la inceputul lui `trimite`. Testele de atunci:
`Ran 232 tests ... OK`. Informativ: fata de v4.6.3 (`BE3B867B...`) 1615 / 26 / 1589; fata de r19 (`111986CB...`, head-ul anterior al
PR-ului, neinstalat) 251 / 44 / 207.

Istoric (r19, fata de acelasi v4.6.4c instalat): 816 linii diferite (84 vechi `<=`, 732 noi `=>`).
Cele 84 de linii vechi = cele 80 din r18 (mai jos) + 4 noi, toate din v4.6.4c, schimbate de r19 (instantaneul dintr-un `pg.evaluate`, cu
shadow DOM): din `_citeste_ciorna` linia `return analizeaza_ciorna(pg.content()), _semn_locator(pg)`, din `_paza_ciorna` comentariul
`# doar citire (content + count); ridica GemEroare daca ciorna are atasamente sau nu poate fi citita` si linia
`info, semn = _citeste_ciorna(pg)`, plus aceeasi linie `info, semn = _citeste_ciorna(pg)` din `stare` (acum `info, semn, umbre = ...`).
Liniile noi r19: nota r19 din antet, comentariul + `CHEI_UMBRE` + `JS_INSTANTANEU`, `_instantaneu`, `verifica_fara_umbre`,
`_citeste_ciorna` / `_paza_ciorna` noi, in `_ultima_paza` comentariul r19 + `info, umbre = _instantaneu(pg)` + `verifica_fara_umbre(...)`,
in `stare` linia `shadow root: ...` si `verifica_fara_umbre(umbre, "stare")`. Testele de atunci: `Ran 220 tests ... OK`. Informativ: fata de v4.6.3
(`BE3B867B...`) 1452 / 26 / 1426; fata de r18 (`C534E953...`, head-ul anterior al PR-ului, neinstalat) 80 / 5 / 75.

Istoric (r18, fata de acelasi v4.6.4c instalat): 738 linii diferite (80 vechi `<=`, 658 noi `=>`).
Cele 80 de linii vechi = cele 64 din r17 (mai jos) + 16 noi, toate din v4.6.4c, schimbate de r18 (nicio eticheta sarita, editorul doar
p / br in forma Quill, textul din HTML, ultima paza dintr-un instantaneu): `NEVIZIBILE = ("script", "style", "template", "noscript")`
(scoasa), comentariul `# in editor (contenteditable) intra doar textul brief-ului: ...` si cele doua linii ale `EDITOR_TAGURI` (acum
`("p", "br")`), din `_motiv_element` cele doua linii de comentariu ale ramurii editorului, `if n.tag in EDITOR_TAGURI:` si `return
"element_in_editor:" + sem, ctrl, ""` (acum indentata in ramura noua), din docstring-ul `_necunoscute` cele doua linii despre ce se sare,
linia `if n.tag in NEVIZIBILE or n.tag == CHIP or _e_semn(n):` (acum fara `NEVIZIBILE`), linia `return {"editoare": ...` din
`analizeaza_ciorna` (acum + `text_editor`), cele trei linii ale vechii `_atasamente` si `verifica_ciorna(ed.inner_text(), text,
_atasamente(pg))` din `trimite` (acum `_ultima_paza(pg, text)`). Liniile noi r18: nota r18 din antet, comentariile noi ale
`STRUCTURA_TAGURI` / `EDITOR_TAGURI`, comentariul din `normalizeaza`, ramura editorului din `_motiv_element` (editorul insusi / p si br fara
niciun atribut), `_text_editor`, `text_editor` din `analizeaza_ciorna`, `_ultima_paza` si apelul ei din `trimite`. Testele de atunci: `Ran 212 tests
... OK`. Informativ: fata de v4.6.3 (`BE3B867B...`) 1382 / 26 / 1356 (2 linii v4.6.3 in plus atinse: `def _atasamente(pg):` si apelul cu
`ed.inner_text()` din `trimite`); fata de r17 (`FD99AA72...`, head-ul anterior al PR-ului, neinstalat) 106 / 22 / 84.

Istoric (r17, fata de acelasi v4.6.4c instalat): 644 linii diferite (64 vechi `<=`, 580 noi `=>`).
Cele 64 de linii vechi = cele 39 din r16 (mai jos) + 25 noi, toate din v4.6.4c, schimbate de r17 (editorul principal unic, comparatia):
linia cu lista de coduri `# coduri: ... editor_lipsa, text_neintrat,` (acum + `editor_multiplu`), selectorul
`EDITOR = 'rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"]'` (acum `rich-textarea > div[role="textbox"]
[contenteditable="true"]`), din `normalizeaza` cele 6 linii (cele doua comentarii r2, `t = (t or "").replace(...)`, bucla `for z in (...)`,
`t = t.replace(z, "")`, `return " ".join(t.split())`), din `verifica_ciorna` comentariul `# inainte de Enter: ...` si `raise
GemEroare("text_neintrat", ...)` (acum cu punctul de cod), din `_e_editor` comentariul `# = EDITOR: ...`, `if n.attrs.get("contenteditable")
!= "true":`, `if n.tag == "div" and "ql-editor" in _clase(n):`, `while p is not None:`, `if p.tag == "rich-textarea":`, cele doua
`return True` si `return False`, comentariul lui `_LATIME_ZERO` (`# aceleasi ca in normalizeaza()`), linia `editoare = [...]` din
`analizeaza_ciorna` (acum cu comentariu), din `verifica_fara_atasamente` `if not info["editoare"] or not info["zone"]:` si mesajul
`ciorna_necitibila`, iar din `trimite` `ed = pg.locator(EDITOR)`, `if ed.count() == 0:` si `ed = ed.first` (acum `_editor_unic`).
Liniile noi r17: nota r17 din antet, `EDITOR` + `CLIPBOARD_ATRIBUTE`, `SPATII_COMPARATIE`, `normalizeaza` / `_cod_la` / `verifica_ciorna`,
`_e_editor` / `_e_clipboard`, pasul 5 din `_semnal` (`editabil:`), acceptarea clipboard-ului din `_motiv_element`, paza "exact un editor",
`_editor_unic` si cele doua apeluri din `trimite`. Testele de atunci: `Ran 202 tests ... OK`. Informativ: fata de v4.6.3 (`BE3B867B...`) 1316 / 24 /
1292 (13 linii v4.6.3 schimbate acum: lista de coduri, `EDITOR`, normalizarea, verificarea editorului din `trimite`); fata de r16
(`5ACAED8D...`, head-ul anterior al PR-ului, neinstalat) 112 / 26 / 86.

Istoric (r16, fata de acelasi v4.6.4c instalat): 534 linii diferite (39 vechi `<=`, 495 noi `=>`).
Cele 39 de linii vechi = cele 24 din r15 (mai jos) + 15 noi, toate din v4.6.4c, schimbate de r16 (nodurile text pe lista alba):
`RE_LIGATURA = re.compile(...)` (acum `LIGATURI_VAZUTE = ()`), cele doua linii de comentariu de deasupra listelor albe ("CONTROALE = butoane
/ linkuri (textul si iconitele din ele sunt eticheta lor) ..." si "... TEXTE = texte afisate in zona, in afara controalelor."), doua linii
de comentariu din `TEXTE_CUNOSCUTE` ("... trecut aici dupa normalizarea _ascii ..." si "(textele linkului = cele doua intrari de mai jos /
eticheta controlului a[...]) ..."), si din `_motiv_text`: antetul `def _motiv_text(nod, ctrl):` (acum cu `zona`), comentariul `# ctrl =
controlul recunoscut ...`, `if not a:` + `return None` (golul dupa forma ASCII), cele doua `return "text_fisier:" / "text_atasament:" +
a[:TEXT_AFISAT]` (acum `+ v`), `return None   # ligatura unei iconite ...`, `return None` (dupa `TEXTE_CUNOSCUTE`), `return "text:" +
a[:TEXT_AFISAT]` (acum `text_in_control:` / `text:`), plus apelul `m = _motiv_text(n, ctrl)` din `_necunoscute` (acum cu `zona`).
Liniile noi r16: nota r16 din antet, `LIGATURI_VAZUTE`, comentariul fostei `CONTROALE_TEXT_INCHIS`, `LOC_MODEL` / `LOC_ZONA` / `LOC_LINK` si
`TEXTE_CUNOSCUTE` pe perechi (loc, text), `META_LUNGIME = 35` / `META_NUMAR` si exceptia pozitiei 34 din `_meta_permisa`, `_loc_text`,
`_vizibil`, `_motiv_text` rescrisa, contextul primului control in `_necunoscute`. Testele de atunci: `Ran 192 tests ... OK`. Informativ: fata de
v4.6.3 (`BE3B867B...`) 1230 / 11 / 1219; fata de r15 (`CDA58F4F...`, head-ul anterior al PR-ului, neinstalat) 128 / 47 / 81.

Istoric (r15, fata de acelasi v4.6.4c instalat): 470 linii diferite (24 vechi `<=`, 446 noi `=>`).
Cele 24 de linii vechi = cele 14 din r13 / r14 (mai jos) + 10 noi, toate din v4.6.4c, schimbate de r15 (comparatiile pe Unicode exact /
importurile): linia `import sys, time, os, re, unicodedata` (acum + `base64, json`), intrarea din `VALORI_PERMISE` (valoarea reala
"Incarcare si instrumente" cu diacritice, in escape-uri), cele 4 linii ale `TEXTE_CUNOSCUTE` (sirurile reale), linia izolarii copiilor din
`_marcaj_permis` (`... or _ascii(c.date) ...`, acum text brut doar din spatii HTML), linia `if _ascii(n.attrs.get(k)) != valoare:` din
`_valoare_permisa`, ligatura `RE_LIGATURA.fullmatch(a)` si `if a in TEXTE_CUNOSCUTE:` din `_motiv_text` (acum pe textul brut `b`).
Liniile noi r15: nota r15 din antet, `CLASE_GENERATE` / `SPATII_HTML` / `CLASE_PERMISE` / `_FormaClase`, `JSLOG_VAZUTE` / `META_*` /
`_sablon_jslog` / `_meta_permisa` / `_FormaJslog` / `_intrari_clase_jslog`, `ATRIBUTE_PERMISE` cu 3 campuri si valorile reale,
`ETICHETE_BUTOANE` / `DESCRIERI_CUNOSCUTE` / `TEXTE_CUNOSCUTE` reale, `_text_brut`, comparatiile brute din `_atribut_strain`,
`_motiv_descriere`, `_motiv_text`, `_valoare_permisa`. Testele de atunci: `Ran 184 tests ... OK`. Informativ (r15): fata de v4.6.3
(`BE3B867B...`) 1196 / 11 / 1185; fata de r14 (`275E6107...`) 367 / 109 / 258.

Istoric (r14, fata de acelasi v4.6.4c instalat): 301 linii diferite (14 vechi `<=`, 287 noi `=>`).
Cele 14 linii vechi sunt EXACT cele din r13 (lista de mai jos); r14 schimba doar liniile NOI: lista neagra r13 (`ATRIBUTE_TEXT`,
`FRAGMENTE_NUME_TEXT`, `FORMA_IDENTIFICATOR`, `VALORI_TEXT_CUNOSCUTE`, `_atribut_cu_text`, `_atribut_text_strain`) e inlocuita de lista
alba `ATRIBUTE_PERMISE` (67 de intrari) cu formele ei (`ATR_GENERAT`, `GOL`, `BOOL`, `FORMA_CLASE`, `FORMA_JSLOG`, `FORMA_STYLE_*`,
`FORMA_MENIU`, `ICOANE`, `ETICHETE_BUTOANE`), `DESCRIERI_CUNOSCUTE`, `ATRIBUTE_TINTA_DESCRIERE`, functiile `_intrari_atribut` /
`_atribut_strain`, `_acceptat` si `_motiv_descriere` rescrise, nota r14 din antet. Testele de atunci: `Ran 170 tests ... OK`. Informativ
(r14): fata de v4.6.3 (`BE3B867B...`) 1047 / 11 / 1036; fata de r13 (`E169AEE6...`) 239 / 76 / 163.

Istoric (r13, fata de acelasi v4.6.4c instalat): 214 linii diferite (14 vechi `<=`, 200 noi `=>`).
r13 adauga la cele 6 linii vechi de mai jos inca 8, toate din v4.6.4c: cele 6 `return None, ...` de acceptare din `_motiv_element` (acum
`return _acceptat(...)`, editorul, zona / invelisurile, butonul modelului, neutrul, controlul, structura), antetul
`def _necunoscute(zona, editoare):` (acum cu `ids=None`) si apelul `necunoscute.extend(_necunoscute(z, editoare))` (acum cu `ids`).
Liniile noi r13: nota r13 din antet, `ATRIBUTE_TEXT` / `FRAGMENTE_NUME_TEXT` / `FORMA_IDENTIFICATOR` / `FORMA_DESCRIERE_CDK` /
`VALORI_TEXT_CUNOSCUTE` cu comentariile lor, functiile `_atribut_cu_text`, `_atribut_text_strain`, `_acceptat`, `_text_nod`,
`_motiv_descriere`, cele 6 acceptari, apelul descrierii din `_necunoscute` si indexul `ids` din `analizeaza_ciorna`. Testele de atunci:
`Ran 170 tests ... OK`. Informativ (r13): fata de v4.6.3 (`BE3B867B...`) 960 / 11 / 949; fata de r12 (`CF6C642A...`) 136 / 8 / 128.

Istoric (r12, fata de acelasi v4.6.4c instalat): 78 linii diferite (6 vechi `<=`, 72 noi `=>`).
Cele 6 linii vechi sunt toate din v4.6.4c: comentariul `# (tag, clasele EXACTE fara cele generate, ..., goale): acceptat DOAR asa.`,
cele doua intrari din `MARCAJE_PERMISE` (acum al doilea camp e lista multimilor de clase: `CLASE_DIV_DROP` pe div, `((),)` pe indicator),
comentariul `# cu clasele (fara cele generate) EXACT cele din lista, ...` din `_marcaj_permis`, linia
`if n.tag != tag or set(c for c in _clase(n) if not _generat(c)) != set(clase):` (acum `not any(... == set(x) for x in clase)`) si
linia `return None   # eticheta unui control recunoscut` din `_motiv_text` (r12: acum cu indentarea blocului controlului cu text inchis).
Liniile noi: notele v4.6.4d r11 + r12 din antet, comentariile si constanta `CLASE_DIV_DROP` (4 multimi), cele doua intrari, cele doua
linii din `_marcaj_permis`, nota r11 de la listele albe, butonul "Ecran complet" (cu comentariul lui) in `CONTROALE_CUNOSCUTE`,
`CONTROALE_TEXT_INCHIS` (cu comentariul ei), functia `_texte_control_inchis`, blocul controlului inchis din `_motiv_text` si cele doua
linii din `_necunoscute` (contextul inchis nu se inlocuieste). Testele de atunci: `Ran 161 tests ... OK`. Informativ, fata de v4.6.3
(`BE3B867B...`): 840 / 11 / 829 (aceleasi 11 linii vechi); fata de r11 (`AFA20126...`, head-ul anterior al PR-ului, neinstalat): 51 / 9 / 42.

Istoric (pachetul v4.6.4c = r10, fata de v4.6.4b instalat atunci, `5B0CCD48...`): 24 linii diferite (5 vechi `<=`, 19 noi `=>`).
Cele 5 linii vechi erau toate din v4.6.4b: comentariul `# (tag, clasele EXACTE ..., izolat): acceptat DOAR asa.`, cele doua intrari din
`MARCAJE_PERMISE` (acum cu al saselea camp: `()` pe div-ul r5, `("style",)` pe indicator), linia `for tag, clase, nume, forma, izolat in
MARCAJE_PERMISE:` si linia izolarii `if izolat and any(... (_generat(a) and v == "") ...)` din `_marcaj_permis` (acum si cu
`not (a in goale and VALOARE_SPATII.fullmatch(v))`). Liniile noi: nota v4.6.4c / r10 din antet, comentariile campului `goale`,
`VALOARE_SPATII`, cele doua intrari, comentariul si cele doua linii din `_marcaj_permis`. Testele de atunci: `Ran 144 tests ... OK`.
Informativ (r10), fata de v4.6.3 (`BE3B867B...`): 774 / 11 / 763 (aceleasi 11 linii vechi).

Istoric (pachetul v4.6.4b = r9, fata de v4.6.4 instalat atunci, `A03E2B5C...`): 230 linii diferite (47 vechi `<=`, 183 noi `=>`).
Cele 47 de linii vechi erau toate din v4.6.4 (nu din v4.6.3): constanta `MARCAJE_GOALE_PERMISE` si comentariile ei, `DETALIU_AFISAT = 240`,
taierea `[:80]` din `_semnatura_token`, functiile `_are_eticheta_interzisa` si `_marcaj_gol_permis` (inlocuite de `_eticheta_interzisa` /
`_marcaj_permis`), liniile `return` cu un singur rezultat din `_semnal` si cu doua din `_motiv_element` (acum cu sursa), linia `clase_id = ...`
si linia `if k in ATRIBUTE_AFISATE_SEPARAT ...` din `_semnal` (acum cu `_clase_verificate` / `_valoare_permisa`), `out.append(m)` si linia
`for m in ...` din `_necunoscute` / `stare`, docstring-urile celor doua functii. Liniile noi: notele v4.6.4b r8 si r9 din antet,
`VALOARE_GOALA` / `VALOARE_FILEDROP` / `MARCAJE_PERMISE` / `VALORI_PERMISE` / `CLASE_EDITOR_PERMISE` cu comentariile lor,
`SEMNATURA_TOKEN_AFISATA` / `SURSA_AFISATA`, `_marcaj_permis` (cu izolarea), `_valoare_permisa`, `_clase_verificate`, `_sursa_cuvant`,
rezultatul `(motiv, sursa)`, `necunoscute_surse` si liniile `    sursa` din `stare`. Testele de atunci: `Ran 138 tests ... OK`.
Informativ (r9), fata de v4.6.3 (`BE3B867B...`, nu mai e in `bin`): 760 / 11 / 749 - aceleasi 11 linii vechi ca in r2-r8 (antetul, lista de
coduri, `import`, comentariul `ATAS`, titlul partii cu browserul, cele doua linii din vechea `_atasamente`, linia `atasamente in ciorna`
din `stare`, cele trei linii ale vechii verificari din `trimite`); fata de r8 (`C7609E9E...`, head-ul anterior al PR-ului, neinstalat):
115 / 21 / 94. Istoricul cifrelor fata de v4.6.3: r20 1615 / 26 / 1589, r19 1452 / 26 / 1426, r18 1382 / 26 / 1356, r17 1316 / 24 / 1292, r16 1230 / 11 / 1219, r15 1196 / 11 / 1185, r14 1047 / 11 / 1036, r13 960 / 11 / 949, r12 840 / 11 / 829, r11 807 / 11 / 796, r10 774 / 11 / 763, r9 760 / 11 / 749, r8 687 / 11 / 676, r7 624 / 11 / 613, r6 622 / 11 / 611, r5 600 / 11 / 589,
r4 536 / 11 / 525, r3 477 / 11 / 466, r2 411 / 11 / 400. Daca mai urmeaza un commit pe `gemini_pw.py`, numerele se schimba din nou: le da
raportul de review al commit-ului respectiv (cifrele din raport inlocuiesc 78 / 6 din blocul de mai sus). Istoric r11 (fata de v4.6.4c):
43 / 5 / 38, `Ran 153 tests`.

Regula pentru tot ce urmeaza: in consola admin (A) nu se scrie si nu se muta NIMIC sub
`C:\Users\Public\paw-data` (cale controlabila de utilizatori: o operatie elevata ar putea fi
redirectionata printr-o legatura). Markerul canalului se copiaza, se scrie si se restaureaza
DOAR ne-elevat (N).

## 3. Inlocuirea (A, dupa pasul 1)

Niciun Paw pornit: spune-i sesiunii de chat sa nu lanseze nimic pana termini. Bariera de mai jos
se ia exclusiv: daca ruleaza un lansator, deschiderea ei pica (STOP, reincearca dupa ce termina);
cat timp o tii, niciun lansator nu poate porni. In consola admin NU se executa nimic din folderul
de livrare (scriibil de utilizatori): fiecare dintre cele doua fisiere se citeste de acolo O SINGURA
DATA, in memorie; hash-ul se verifica pe octetii cititi, fata de valorile din raport; doar acei octeti
se scriu in `$Audit` (scriibil doar de admin) si abia de acolo ajung in `bin`. Un fisier inlocuit sau
redirectionat printr-o legatura da alt hash si nu e scris nicaieri.

```powershell
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $GemHashNou -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Pune hash-urile din raport' }
$p = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)(run_paw|gemini_pw|cgpt_pw|certifica_cdx)' })
if ($p.Count) { $p | Select-Object ProcessId, Name | Format-Table; throw 'Ruleaza un proces Paw' }
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
if (Test-Path -LiteralPath $Audit) { throw 'Audit exista deja (instalare reluata? vezi Rollback)' }
$barrier = OpenCdxInstallBarrier $true
try {
    [void][IO.Directory]::CreateDirectory($Audit); SetCdxAdminAcl $Audit $ReaderSid
    # (a) copii de siguranta ale fisierelor instalate (sufixul $SufVechi, pasul 1)
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        AssertCdxAdminAcl (Join-Path $Bin $n); AssertCdxSingleFile (Join-Path $Bin $n)
        Copy-Item -LiteralPath (Join-Path $Bin $n) -Destination (Join-Path $Audit ($n + $SufVechi))
        SetCdxAdminAcl (Join-Path $Audit ($n + $SufVechi)) $ReaderSid
    }
    if ((HashCdx "$Audit\gemini_pw.py$SufVechi") -ine $GemHashVechi) { throw 'Fisierul instalat nu e gemini_pw.py asteptat (vezi $GemHashVechi)' }
    # (b) pachetul: fiecare sursa se citeste O SINGURA DATA in memorie, hash-ul se verifica pe octetii cititi si
    #     doar acei octeti se scriu in zona protejata. Sursa nu se redeschide intre verificare si copiere, iar un
    #     continut care nu e cel revizuit nu ajunge nicaieri (nici macar in $Audit).
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($n in 'gemini_pw.py', 'SHA256.json') {
            $asteptat = if ($n -eq 'SHA256.json') { $ManifestHash } else { $GemHashNou }
            $fs = [IO.File]::Open((Join-Path $Source $n), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            try {
                if ($fs.Length -lt 1 -or $fs.Length -gt 1048576) { throw "Sursa cu marime neasteptata: $n" }
                $octeti = New-Object byte[] ([int]$fs.Length)
                $citit = 0
                while ($citit -lt $octeti.Length) {
                    $r = $fs.Read($octeti, $citit, $octeti.Length - $citit)
                    if ($r -le 0) { throw "Citire incompleta: $n" }
                    $citit += $r
                }
            } finally { $fs.Dispose() }
            if (([BitConverter]::ToString($sha.ComputeHash($octeti))).Replace('-', '') -ine $asteptat) { throw "Sursa nu e cea revizuita: $n (nimic scris)" }
            $st = Join-Path $Audit ($n + $SufNou)
            [IO.File]::WriteAllBytes($st, $octeti)
            SetCdxAdminAcl $st $ReaderSid; AssertCdxSingleFile $st
        }
    } finally { $sha.Dispose() }
    if ((HashCdx "$Audit\SHA256.json$SufNou") -ine $ManifestHash) { throw 'Manifestul copiat nu e cel revizuit' }
    if ((HashCdx "$Audit\gemini_pw.py$SufNou") -ine $GemHashNou) { throw 'gemini_pw.py copiat nu e cel revizuit' }
    $manifest = Get-Content -LiteralPath "$Audit\SHA256.json$SufNou" -Raw | ConvertFrom-Json
    if (@($manifest.PSObject.Properties).Count -ne 12 -or $manifest.'gemini_pw.py' -ine $GemHashNou) { throw 'Manifest neasteptat' }
    foreach ($e in $manifest.PSObject.Properties) {
        if ($e.Name -ne 'gemini_pw.py' -and (HashCdx (Join-Path $Bin $e.Name)) -ine $e.Value) { throw "Instalat difera de manifest: $($e.Name)" }
    }
    # (c) inlocuirea, din zona protejata
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $dest = Join-Path $Bin $n
        Copy-Item -LiteralPath (Join-Path $Audit ($n + $SufNou)) -Destination $dest -Force
        AssertCdxAdminAcl $dest; AssertCdxSingleFile $dest
    }
    # (d) starea finala: toate cele 12 fisiere din bin = manifestul revizuit
    if ((HashCdx "$Bin\SHA256.json") -ine $ManifestHash) { throw 'Manifest instalat diferit de cel revizuit' }
    foreach ($e in $manifest.PSObject.Properties) {
        if ((HashCdx (Join-Path $Bin $e.Name)) -ine $e.Value) { throw "Dupa inlocuire difera: $($e.Name)" }
    }
    AssertCdxAdminAcl $Bin
    'Inlocuit: gemini_pw.py + SHA256.json. Copiile de siguranta sunt in ' + $Audit
} finally { $barrier.Dispose() }
```

`Copy-Item -Force` rescrie continutul fisierului existent: ACL-ul si proprietarul lui raman
(verificate inainte si dupa). Orice `throw` dupa (c): Rollback (mai jos). Un `throw` inainte de
(c) nu a schimbat nimic in `bin`. Markerul nu se atinge aici: e legat de hash, deci dupa (c)
lansatorul refuza oricum `gem` pana la markerul nou (pasul 5).

## 4. Legatura cdx neschimbata (N, consola noua, dupa pasul 1)

```powershell
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
$b = GetCdxBinding
$c = Get-Content -LiteralPath "$Bin\cdx_sandbox_validat.json" -Raw | ConvertFrom-Json
foreach ($k in $c.binding.bin.PSObject.Properties) {
    if ([string]$b.bin[$k.Name] -cne [string]$k.Value) { throw "Legatura cdx difera: $($k.Name)" }
}
if (@($b.bin.Keys).Count -ne @($c.binding.bin.PSObject.Properties).Count) { throw 'Legatura cdx: alt numar de fisiere' }
'Legatura cdx identica cu certificatul (' + @($b.bin.Keys).Count + ' fisiere)'
```

## 5. Testul de canal Gemini (N; cu "Carbon")

Fara marker, lansatorul refuza `gem`, deci probele directe de mai jos nu se pot suprapune cu o
rulare prin lansator. In Edge-ul 9333: un singur tab Gemini, modelul **Carbon** selectat, ciorna goala.

```powershell
$GemId = Get-Date -Format 'yyyyMMdd-HHmmss'
$GemBrief = "C:\Users\Public\paw-data\brief\gem-canal-$GemId.md"
'Raspunde exact: PAW_GEM_TEST_OK' | Set-Content -LiteralPath $GemBrief -Encoding ASCII
& $Python "$Bin\gemini_pw.py" stare
```

Orice rezultat diferit de cel cerut mai jos = **STOP**, fara marker; copiaza toate liniile lui
`stare` (sau ultima linie a lui `trimite`) pentru sesiunea de chat.

- **5a.** `stare` arata `model: Carbon`, `genereaza: False`, `atasamente in ciorna: 0`,
  `necunoscute in zona: 0`, `paza ciorna: OK (trimite ar continua)`. Cu ciorna goala pe ecran,
  `paza ciorna: REFUZ ciorna_necunoscuta ...` = calibrarea (pasul 0) nu acopera pagina: STOP,
  fara marker, copiaza liniile `necunoscut ...` SI liniile `    sursa ...` de sub ele (v4.6.4b) pentru chat.
  **Asteptat la v4.6.4b r9 (declarat, pasul 0 "Stare r9"):** toate cele 3 linii din 22.11 dispar (fiecare are
  regula ei exacta, scrisa din atributele complete citite din pagina): `necunoscute in zona: 0`, `paza ciorna: OK`.
  Daca apare totusi o linie `necunoscut`, ea vine cu `    sursa ...` sub ea: STOP, markerul NU se scrie, copiaza
  amandoua pentru chat (regula exacta, daca e cazul, intr-un commit nou, cu review). 5a se ruleaza pe un chat NOU si apoi
  inca o data pe un chat EXISTENT (tab-ul ramane pe chatul vechi dupa fiecare `gem`, iar paza
  verifica intai tab-ul curent): ambele trebuie sa dea `necunoscute in zona: 0`. (Pachetul r4 arata aici
  1 necunoscut `token_file:...`; r5 il lamureste prin regula marcajului `xapfileselectordropzone=""` -
  vezi pasul 0. Href-ul real al linkului de confidentialitate e confirmat din pagina si testat in r6; daca
  5a arata totusi `atribut_fisier:a[...][href]{}`, o linie pe zona `...:input-area-v2{...}` sau o linie pe
  editor `semnal_in_editor:...` (r7: un stil cu `url(` / un atribut cu fisier chiar pe editor), STOP,
  copiaza linia pentru chat.)
- **5b.** Pune de mana UN fisier mic (de ex. un `.txt`) in ciorna, fara sa trimiti; `stare` din nou:
  trebuie EXACT `atasamente in ciorna: 1` si `paza ciorna: REFUZ ciorna_cu_atasamente ...`.
  `0`, `2`, `5`, `?` sau orice alt numar = STOP (numararea nu se potriveste cu pagina reala).
- **5c.** Cu fisierul in ciorna: `& $Python "$Bin\gemini_pw.py" trimite $GemBrief 120` - ultima
  linie `GEM_EROARE ciorna_cu_atasamente inainte_de_chat_nou: 1 atasament(e) in ciorna - nu trimit`.
  Pe ecran: NU s-a deschis chat nou, nu a plecat niciun mesaj, fisierul e tot in ciorna.
  `stare` din nou: tot `atasamente in ciorna: 1`. (Exact pasul care a picat pe 19.11.)
- **5d.** Pune al doilea fisier in ciorna; `stare`: EXACT `atasamente in ciorna: 2`.
- **5e.** Scoate ambele fisiere de mana, apoi **F5** (reincarca pagina; dupa scoaterea manuala a fisierelor, F5 inainte de
  trimitere), apoi `stare`: `atasamente in ciorna: 0`, `necunoscute in zona: 0`, `paza ciorna: OK ...`. Fara F5, zona si
  editorul pastreaza `style="--uploader-height: 112px;"` si `stare` da `necunoscut token_upload:...` cu
  `    sursa valoare_atribut:style=--uploader-height: 112px;` = refuz fals, dar sigur (decizia din 22.11: ramane refuz, NU se
  excepteaza); asta nu e STOP - fa F5 si repeta `stare`. Orice alta linie `necunoscut` dupa F5 = STOP. (Pe v4.6.4d 5e picase aici:
  dupa F5 pagina vine in varianta cu `style=""` pe `simplified-input-menu` / `speech-dictation-mic-button` si `ng-pristine` pe
  `rich-textarea`; v4.6.4e le accepta exact asa. Pe v4.6.4e 5e a picat din nou, dupa F5 repetat: `style=""` aleator pe
  `auto-suggest` / `back-to-bottom-fab` / `hallucination-disclaimer`; v4.6.4f accepta `style=""` EXACT gol pe orice element deja
  acceptat - asteptat acum `necunoscute in zona: 0` dupa oricate F5. Fa F5 de cel putin 3 ori si ruleaza `stare` dupa fiecare. Orice
  `necunoscut` cu `style` NEgol, sau `atribut_valoare:...{data-placeholder}` = STOP, liniile la chat.)
- **5f.** Selecteaza de mana alt model (4 Hydrogen) si repeta `trimite`: ultima linie
  `GEM_EROARE model_gresit afisat: '...Hydrogen...', cerut: Carbon`; nu a plecat niciun mesaj.
- **5g.** Revino de mana la Carbon si ruleaza blocul de mai jos: doua trimiteri, fiecare verificata
  (cod de iesire 0, nicio linie `GEM_EROARE`, ultima linie `GEM_CHAT_URL ...`, raspunsul contine
  `PAW_GEM_TEST_OK` - un raspuns partial urmat de timeout NU trece). Pe ecran: chat nou in
  ACELASI tab de fiecare data, fara taburi create / inchise. (Pe v4.6.4b 5g picase aici: pe chatul nou indicatorul de drop avea
  `style=""`; v4.6.4c il accepta DOAR gol / spatii albe.)

```powershell
foreach ($i in 1, 2) {
    $ErrorActionPreference = 'Continue'
    $out = @(& $Python "$Bin\gemini_pw.py" trimite $GemBrief 120)
    $cod = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $out
    if ($cod -ne 0) { throw "Trimiterea ${i}: cod de iesire $cod" }
    if (@($out | Where-Object { $_ -match '^GEM_EROARE' }).Count) { throw "Trimiterea ${i}: GEM_EROARE" }
    if ($out.Count -eq 0 -or $out[-1] -notmatch '^GEM_CHAT_URL https://gemini\.google\.com/app/[0-9a-fA-F]+$') { throw "Trimiterea ${i}: lipseste linia finala GEM_CHAT_URL" }
    if (@($out | Where-Object { $_ -match 'PAW_GEM_TEST_OK' }).Count -eq 0) { throw "Trimiterea ${i}: raspunsul nu contine PAW_GEM_TEST_OK" }
    "Trimiterea ${i}: OK"
}
```

Daca 5g da `GEM_EROARE ciorna_necitibila ...` cu ciorna goala: zona de compunere are alt nume in
pagina reala; STOP, fara marker, copiaza linia `zone compunere ...` din `stare` pentru chat.
Daca 5g da `GEM_EROARE ciorna_necunoscuta <moment>: N element(e) nerecunoscute in zona ciornei -
nu trimit (...)` cu ciorna goala (sau doar cu textul brief-ului): pagina are elemente pe care
calibrarea nu le-a vazut (de ex. butonul de trimitere apare abia dupa scriere); nu a plecat nimic.
STOP, fara marker, copiaza linia `GEM_EROARE` + liniile `necunoscut ...` din `stare` pentru chat.

- **5g2 (nou in v4.6.4d).** Tot cu Carbon, ciorna goala. Pe 23.11 un brief de ~10 KB a fost refuzat fals pe v4.6.4c, chiar inainte de
  Enter: cu text lung caseta se EXTINDE. 5g2 are doua parti, in aceasta ordine:
  - **5g2-a, captura (doar citire, r12).** La trei lungimi de text - `scurt` (o linie), `mediu` (5 linii), `lung` (~13 KB) - LIPESTI DE
    MANA textul in ciorna (blocul il pune in clipboard; Ctrl+V in caseta, **fara Enter**), apesi Enter in CONSOLA, iar blocul ruleaza
    `diag\captura_caseta.py` (din pachetul verificat la pasul 2; nicio actiune pe pagina: fara click, tastatura sau navigare - doar
    citeste clasele div-ului zonei de drop si atributele + continutul butoanelor din caseta) si `stare` (tot doar citire), le salveaza
    in `paw-data\out\captura_caseta_<lungime>_<GemId>.json` / `stare_caseta_<lungime>_<GemId>.txt`, apoi golesti ciorna de mana
    (Ctrl+A, Delete). Capturile sunt pentru chat: arata ce multimi de clase si ce continut al butonului "Ecran complet" au aparut efectiv
    (r13: si atributele tuturor elementelor casetei + textele descrierilor; r14: + atributele tintelor descrierilor, zona exacta a analizei
    si DOAR atributele elementelor din editor, fara text; r15: valorile `jslog` NETAIATE, ca cheia `BardVeMetadataKey` sa se vada
    intreaga; r16: + `text_propriu` = nodurile text directe ale fiecarui element, BRUTE, fara textul ciornei - r16 accepta un text doar
    pe locul pe care a fost vazut). **Merge mai departe DOAR la succes explicit (r13):** captura cu
    cod 0 si ultima linie `CAPTURA_GATA <lungime>`, `stare` cu cod 0, nicio linie `  necunoscut`, exact o linie `paza ciorna:` si aceea
    = `paza ciorna: OK (trimite ar continua)`. O eroare, o iesire goala sau `paza ciorna: REFUZ ...` = STOP inainte de 5g2-b.
  - **5g2-b, trimiterea:** (1) brief-ul LUNG, (2) brief-ul MEDIU. Aceleasi verificari ca la 5g: cod 0, nicio linie `GEM_EROARE`, ultima
    linie `GEM_CHAT_URL ...`, raspunsul contine `PAW_GEM_TEST_OK`. Pe ecran: chat nou in ACELASI tab, brief-ul intreg in mesajul trimis,
    niciun fisier.
  - **Ce dovedeste si ce NU.** Trimiterile dovedesc doar ca scenariile lor (lung, mediu) trec; ele NU inregistreaza ce clase a avut
    caseta si NU dovedesc multimile pe care nu le-au intalnit. Capturile arata clasele la trei lungimi; o multime din `CLASE_DIV_DROP`
    care nu apare in nicio captura (de ex. una din cele doua intermediare) ramane DEDUCTIE, nedovedita - nu e o eroare si nu e STOP.
    O multime aparuta intr-o captura care NU e in lista, sau `stare` cu `necunoscut ...` la o lungime, = refuz fals la acea lungime:
    STOP inainte de 5g2-b, fara marker, capturile + `stare` merg la chat (regula exacta intr-un commit nou, cu review).

```powershell
$GemBriefLung = "C:\Users\Public\paw-data\brief\gem-canal-lung-$GemId.md"
$GemBriefMediu = "C:\Users\Public\paw-data\brief\gem-canal-mediu-$GemId.md"
$umplutura = @(1..160 | ForEach-Object { 'Linia {0:D3} a unui brief lung de proba, doar text simplu; nu raspunde la ea, citeste mai departe.' -f $_ })
(@('Test de canal cu brief lung. Ignora liniile numerotate de mai jos.') + $umplutura + @('Raspunde exact: PAW_GEM_TEST_OK')) |
    Set-Content -LiteralPath $GemBriefLung -Encoding ASCII
@('Test de canal cu brief mediu.', 'Linia 1 de proba.', 'Linia 2 de proba.', 'Linia 3 de proba.', 'Raspunde exact: PAW_GEM_TEST_OK') |
    Set-Content -LiteralPath $GemBriefMediu -Encoding ASCII
if ((Get-Item -LiteralPath $GemBriefLung).Length -lt 10000) { throw 'Brief-ul lung are sub 10 KB' }
# 5g2-a: captura, doar citire (operatorul lipeste si goleste ciorna de mana; scriptul nu atinge pagina)
if ((Get-FileHash -LiteralPath "$Source\diag\captura_caseta.py").Hash -ine $DiagHash) { throw 'diag\captura_caseta.py nu e cel revizuit' }
$texte = [ordered]@{ scurt = 'Test de captura, o linie, NU se trimite.'; mediu = (Get-Content -LiteralPath $GemBriefMediu -Raw); lung = (Get-Content -LiteralPath $GemBriefLung -Raw) }
foreach ($k in $texte.Keys) {
    Set-Clipboard -Value $texte[$k]
    Read-Host "5g2-a ${k}: lipeste (Ctrl+V) in ciorna Gemini, FARA Enter, apoi Enter aici"
    $ErrorActionPreference = 'Continue'
    $cap = @(& $Python "$Source\diag\captura_caseta.py" $k)
    $codCap = $LASTEXITCODE
    $st = @(& $Python "$Bin\gemini_pw.py" stare)
    $codSt = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $cap | Set-Content -LiteralPath "C:\Users\Public\paw-data\out\captura_caseta_${k}_$GemId.json" -Encoding ASCII
    $st | Set-Content -LiteralPath "C:\Users\Public\paw-data\out\stare_caseta_${k}_$GemId.txt" -Encoding ASCII
    $st | Where-Object { $_ -match '^(necunoscute in zona|  necunoscut|    sursa|paza ciorna|GEM_EROARE)' }
    Read-Host "5g2-a ${k}: goleste ciorna de mana (Ctrl+A, Delete), apoi Enter aici"
    # r13: succes EXPLICIT, nu doar lipsa erorilor: cod 0 la ambele, captura terminata, `stare` cu EXACT o linie `paza ciorna:` si
    # aceea = linia de succes, scrisa exact (o iesire goala, o eroare sau `paza ciorna: REFUZ ...` = STOP)
    if ($codCap -ne 0 -or $cap.Count -eq 0 -or $cap[-1] -cne "CAPTURA_GATA $k") { throw "5g2-a ${k}: captura nu s-a terminat (cod $codCap, vezi fisierul)" }
    if ($codSt -ne 0) { throw "5g2-a ${k}: stare a iesit cu codul $codSt - STOP, fisierele la chat" }
    if (@($st | Where-Object { $_ -match '^  necunoscut ' }).Count) { throw "5g2-a ${k}: necunoscute in caseta - STOP, capturile la chat" }
    if (@($st | Where-Object { $_ -clike 'paza ciorna:*' }).Count -ne 1) { throw "5g2-a ${k}: stare nu are exact o linie 'paza ciorna:' - STOP" }
    if (@($st | Where-Object { $_ -ceq 'paza ciorna: OK (trimite ar continua)' }).Count -ne 1) { throw "5g2-a ${k}: lipseste linia 'paza ciorna: OK (trimite ar continua)' - STOP, capturile la chat" }
    "5g2-a ${k}: OK"
}
Set-Clipboard -Value ' '
# 5g2-b: trimiterea
foreach ($b in $GemBriefLung, $GemBriefMediu) {
    $ErrorActionPreference = 'Continue'
    $out = @(& $Python "$Bin\gemini_pw.py" trimite $b 180)
    $cod = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $out
    if ($cod -ne 0) { throw "5g2 ${b}: cod de iesire $cod" }
    if (@($out | Where-Object { $_ -match '^GEM_EROARE' }).Count) { throw "5g2 ${b}: GEM_EROARE" }
    if ($out.Count -eq 0 -or $out[-1] -notmatch '^GEM_CHAT_URL https://gemini\.google\.com/app/[0-9a-fA-F]+$') { throw "5g2 ${b}: lipseste linia finala GEM_CHAT_URL" }
    if (@($out | Where-Object { $_ -match 'PAW_GEM_TEST_OK' }).Count -eq 0) { throw "5g2 ${b}: raspunsul nu contine PAW_GEM_TEST_OK" }
    "5g2 ${b}: OK"
}
```

Daca 5g2-b da `GEM_EROARE ciorna_necunoscuta inainte_de_enter: ...`: caseta extinsa are o forma pe care r12 nu o cunoaste (de ex. o stare
intermediara cu alte clase, sau o iconita cu text in butonul "Ecran complet" = `text_in_control:...`); nu a plecat nimic. STOP, fara
marker. Pentru chat: linia `GEM_EROARE` intreaga + fisierele `captura_caseta_*` / `stare_caseta_*` de la 5g2-a; daca lungimea
respectiva nu e acolo, acelasi brief lipit de mana in ciorna (NU trimis), `stare` + `captura_caseta.py`, apoi golesti ciorna.

Numai dupa ce ai VAZUT rezultatele 5a-5g2, markerul - **ne-elevat (N)**, nu din consola admin:

```powershell
$GemHash = (Get-FileHash -LiteralPath "$Bin\gemini_pw.py" -Algorithm SHA256).Hash
if ($GemHash -ine $GemHashNou) { throw 'gemini_pw.py instalat nu e cel revizuit' }
Set-Content -LiteralPath $GemMarker -Value ('CANAL_VALIDAT ' + $GemHash + ' ' + (Get-Date -Format o) + ' Razvan-v464f') -Encoding ASCII
```

## 6. Smoke prin lansator (N)

```powershell
$Id = Get-Date -Format 'yyyyMMdd-HHmmss'
$B = "C:\Users\Public\paw-data\brief\smoke-v464-$Id.md"
'Raspunde exact: PAW_TEST_OK' | Set-Content -LiteralPath $B -Encoding ASCII
& "$Bin\run_paw.cmd" gem $B "C:\Users\Public\paw-data\out\smoke-v464-gem-$Id.log" argon
& "$Bin\run_paw.cmd" jak $B "C:\Users\Public\paw-data\out\smoke-v464-jak-$Id.log"
```

Asteptat (ultima linie din fiecare log): gem `PAW_GATA`; jak `PAW_GATA`. In logul gem apare
`GEM_MODEL: Carbon`. cop si cdx nu se testeaza: fisierele lor nu s-au schimbat.

Dupa smoke: sesiunea de chat actualizeaza `registru_automatizari`, randul `run_paw` din
`public.automatizari` si mentiunea "Gemini 4 Argon" din CLAUDE.md (model: Carbon).

## Rollback la versiunea dinainte (A, consola noua, dupa pasul 1; pasul 2 NU se ruleaza)

Readuce in `bin` copiile de siguranta cu sufixul `$SufVechi` din `$Audit` (la v4.6.4f: v4.6.4e, `4132781B...`, din `operator-v464f`).

```powershell
. "$Bin\cdx_security.ps1"
$PAW_ROOT = $PawRoot
$barrier = OpenCdxInstallBarrier $true
try {
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        $src = Join-Path $Audit ($n + $SufVechi)
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw ('Lipseste copia de siguranta pentru ' + $n + ' - bin nu a fost atins de pasul 3 (compara hash-urile de mana)') }
        AssertCdxAdminAcl $src; AssertCdxSingleFile $src
    }
    if ((HashCdx "$Audit\gemini_pw.py$SufVechi") -ine $GemHashVechi) { throw 'Copia de siguranta nu e gemini_pw.py asteptat (vezi $GemHashVechi)' }
    foreach ($n in 'gemini_pw.py', 'SHA256.json') {
        Copy-Item -LiteralPath (Join-Path $Audit ($n + $SufVechi)) -Destination (Join-Path $Bin $n) -Force
        AssertCdxAdminAcl (Join-Path $Bin $n); AssertCdxSingleFile (Join-Path $Bin $n)
        if ((HashCdx (Join-Path $Bin $n)) -ine (HashCdx (Join-Path $Audit ($n + $SufVechi)))) { throw "Rollback incomplet: $n" }
    }
} finally { $barrier.Dispose() }
Rename-Item -LiteralPath $Audit -NewName ((Split-Path -Leaf $Audit) + '-anulat-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
```

Apoi markerul, **ne-elevat (N)**, dupa pasul 1 (copia facuta la pasul 2, daca exista):

```powershell
if (Test-Path -LiteralPath ($GemMarker + $SufVechi)) { Copy-Item -LiteralPath ($GemMarker + $SufVechi) -Destination $GemMarker -Force }
```

Dupa rollback la v4.6.4e, markerul copiat la pasul 2 (`gem_canal_validat.v464e`) e pus la loc; acela e tot markerul lui v4.6.4c (legat
de `09E78891...`: testele de canal ale lui v4.6.4d si v4.6.4e au picat la 5e, markerul n-a fost scris), deci `gem` ramane REFUZAT cu
v4.6.4e (sigur), ca inainte de v4.6.4f. Ca `gem` sa mearga din nou fara v4.6.4f: rollback la v4.6.4c, pas cu pas (v4.6.4e -> v4.6.4d cu
variabilele de la instalarea v4.6.4e: `$Audit = operator-v464e`, `$SufVechi = .v464d`, `$GemHashVechi = 50332B12...`; apoi v4.6.4d ->
v4.6.4c cu cele de la instalarea v4.6.4d: `$Audit = operator-v464d`, `$SufVechi = .v464c`, `$GemHashVechi = 09E78891...`) - markerul
`.v464c` (legat de `09E78891...`) o valideaza (cu refuzul fals la brief-urile lungi, sigur). Istoric (rollback-ul v4.6.4d -> v4.6.4c): markerul copiat la pasul 2
(`gem_canal_validat.v464c`) e pus la loc, deci `gem` merge din nou cu v4.6.4c. Rollback mai departe (v4.6.4b sau mai vechi) = `gem` refuzat: nici
v4.6.3, nici v4.6.4, nici v4.6.4b nu au marker valid (testele lor de canal au picat). jak / cop / cdx neschimbate. Pasul 4 se poate rula ca verificare. Folderul de audit e redenumit,
deci pasul 3 se poate relua de la capat dupa ce cauza e lamurita.

## Pachetele neinstalate v4.6.2 (mil) si v4.7 (cxw)

Amandoua pornesc de la v4.6.1 si au `gemini_pw.py` cu "Argon" si fara paza de mai sus. Inainte de
instalarea oricaruia, `gemini_pw.py` se ia din v4.6.4 (acest pachet), manifestul lor se regenereaza
si diff-ul trece din nou prin review.
