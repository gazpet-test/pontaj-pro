# Paw v4.6.4 / v4.6.4b / v4.6.4c - doar paza atasamentelor Gemini - procedura pentru Razvan

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

Hash-urile vin din raportul de review, nu din acest fisier. Livrare: folderul din commit-ul
aprobat ajunge in `$Source` (`git archive` al commit-ului, dezarhivat in
`C:\Users\Public\livrare\run_paw_v464c`); verificarea de mai jos decide.

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

Se ruleaza `stare` (doar citire: continutul paginii + numarari, fara click / tastatura / navigare)
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
$Source = 'C:\Users\Public\livrare\run_paw_v464c\docs\paw\run_paw_v464'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$Audit = Join-Path $PawRoot 'operator-v464c'
$SufVechi = '.v464b'     # sufixul copiilor de siguranta (ce e instalat acum: v4.6.4b)
$SufNou = '.v464c'       # sufixul fisierelor noi din zona protejata
$GemMarker = 'C:\Users\Public\paw-data\gem_canal_validat'
$Python = 'C:\Program Files\Python313\python.exe'
$ManifestHash = 'INLOCUIESTE_CU_HASH_MANIFEST_DIN_RAPORT'
$GemHashNou = 'INLOCUIESTE_CU_HASH_GEMINI_PW_DIN_RAPORT'
$GemHashVechi = '5B0CCD4851A2B2A5BCCB0CF0B76A087F544051091827B998A156C35D082972CD'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
```

`$GemHashVechi` = `gemini_pw.py` din v4.6.4b (instalat acum in `bin`, 22.11.2026, main `c8138f0f`). Istoric: la instalarea v4.6.4b peste
v4.6.4 valorile au fost `$Audit = operator-v464b`, `$GemHashVechi = A03E2B5C5ABD5D80709E5E1FB87126F4986245389B4E0943796589E2156AF7B6`
(v4.6.4), sufixele `.v464` / `.v464b`; la instalarea v4.6.4 peste v4.6.3: `operator-v464`, `BE3B867B0BD7FA2333D009B54258A146DF72F4D78C2706C321ABEB2D21AED9F5`
(v4.6.3), `.v463` / `.v464`. Folderele `operator-v464` si `operator-v464b` raman pe disc (copiile v4.6.3 / v4.6.4), nu se ating.

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
if ((Get-FileHash -LiteralPath "$Bin\gemini_pw.py").Hash -ine $GemHashVechi) { throw 'gemini_pw.py instalat nu e cel asteptat (vezi $GemHashVechi)' }
$d = @(Compare-Object -CaseSensitive (Get-Content -LiteralPath "$Bin\gemini_pw.py") (Get-Content -LiteralPath "$Source\gemini_pw.py"))
$d | Where-Object SideIndicator -eq '<=' | Format-List
if ($d.Count -ne 24 -or @($d | Where-Object SideIndicator -eq '<=').Count -ne 5) { throw "Diff gemini_pw.py neasteptat: $($d.Count) linii" }
$ErrorActionPreference = 'Continue'    # unittest scrie pe stderr; in unele gazde PowerShell 5.1 asta ar opri blocul
& $Python -I "$Source\teste\test_gemini_pw.py"
$cod = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($cod -ne 0) { throw 'Testele gemini_pw.py au picat' }
# copia markerului existent (daca exista), pentru rollback - ne-elevat (paw-data e scriibil de utilizatori)
if (Test-Path -LiteralPath $GemMarker) { Copy-Item -LiteralPath $GemMarker -Destination ($GemMarker + $SufVechi) -Force }
```

Asteptat (pachetul v4.6.4c = r10, fata de v4.6.4b INSTALAT in `bin`, `5B0CCD48...`): **24 linii diferite (5 vechi `<=`, 19 noi `=>`)**.
Cele 5 linii vechi sunt toate din v4.6.4b: comentariul `# (tag, clasele EXACTE ..., izolat): acceptat DOAR asa.`, cele doua intrari din
`MARCAJE_PERMISE` (acum cu al saselea camp: `()` pe div-ul r5, `("style",)` pe indicator), linia `for tag, clase, nume, forma, izolat in
MARCAJE_PERMISE:` si linia izolarii `if izolat and any(... (_generat(a) and v == "") ...)` din `_marcaj_permis` (acum si cu
`not (a in goale and VALOARE_SPATII.fullmatch(v))`). Liniile noi: nota v4.6.4c / r10 din antet, comentariile campului `goale`,
`VALOARE_SPATII`, cele doua intrari, comentariul si cele doua linii din `_marcaj_permis`. Testele: `Ran 144 tests ... OK`.
Informativ, fata de v4.6.3 (`BE3B867B...`): 774 / 11 / 763 (aceleasi 11 linii vechi).

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
115 / 21 / 94. Istoricul cifrelor fata de v4.6.3: r10 774 / 11 / 763, r9 760 / 11 / 749, r8 687 / 11 / 676, r7 624 / 11 / 613, r6 622 / 11 / 611, r5 600 / 11 / 589,
r4 536 / 11 / 525, r3 477 / 11 / 466, r2 411 / 11 / 400. Daca mai urmeaza un commit pe `gemini_pw.py`, numerele se schimba din nou: le da
raportul de review al commit-ului respectiv (cifrele din raport inlocuiesc 24 / 5 din blocul de mai sus).

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
  excepteaza); asta nu e STOP - fa F5 si repeta `stare`. Orice alta linie `necunoscut` dupa F5 = STOP.
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

Numai dupa ce ai VAZUT rezultatele 5a-5g, markerul - **ne-elevat (N)**, nu din consola admin:

```powershell
$GemHash = (Get-FileHash -LiteralPath "$Bin\gemini_pw.py" -Algorithm SHA256).Hash
if ($GemHash -ine $GemHashNou) { throw 'gemini_pw.py instalat nu e cel revizuit' }
Set-Content -LiteralPath $GemMarker -Value ('CANAL_VALIDAT ' + $GemHash + ' ' + (Get-Date -Format o) + ' Razvan-v464c') -Encoding ASCII
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

Readuce in `bin` copiile de siguranta cu sufixul `$SufVechi` din `$Audit` (la v4.6.4c: v4.6.4b, `5B0CCD48...`, din `operator-v464c`).

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

Dupa rollback `gem` ramane refuzat (nici v4.6.3, nici v4.6.4, nici v4.6.4b nu au marker valid: testele lor de canal au picat);
jak / cop / cdx neschimbate. Pasul 4 se poate rula ca verificare. Folderul de audit e redenumit,
deci pasul 3 se poate relua de la capat dupa ce cauza e lamurita.

## Pachetele neinstalate v4.6.2 (mil) si v4.7 (cxw)

Amandoua pornesc de la v4.6.1 si au `gemini_pw.py` cu "Argon" si fara paza de mai sus. Inainte de
instalarea oricaruia, `gemini_pw.py` se ia din v4.6.4 (acest pachet), manifestul lor se regenereaza
si diff-ul trece din nou prin review.
