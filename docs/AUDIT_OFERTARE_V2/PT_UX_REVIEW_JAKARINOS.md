# UX-PT — a doua opinie

## 1. Verificarea factuală AS-IS

**Auditul identifică bine fragmentarea muncii, dar supraestimează ce rezolvă automatizarea și amestecă starea datelor cu regulile codului.** Cele mai importante corecții: QW6 este parțial deja implementat; J07 nu este încă verdictul unic complet presupus de V2; verificarea E2 și verificarea răspunsului PT sunt distincte.

Referințe: `P:n` = `C:/Users/Public/ux_OfertarePropunere.jsx:n`; `G:n` = `C:/Users/Public/ux_ofertarePoarta.js:n`. Cele două copii furnizate sunt baza AS-IS; `src/` și SQL sunt dovezi locale suplimentare, nu dovada versiunii instalate. Am citit ambele documente de audit integral. **Nu am accesat BD, producția, browserul sau git.** C = corectă, G = greșită/generalizare nejustificată, N = neverificabilă în acest audit static.

| Afirmația AS-IS | Verdict și dovadă |
|---|---|
| §0: PT93 are 25 capitole, 316 cerințe, 280 atribuite/neverificate, 36 exceptate, 20 de formă; 22 capitole AI, 5 documente necitite; lipsesc pachetul, graficul și anexele | **N**, pentru fiecare număr și stare. Codul expune aceste categorii, nu valorile PT93 (`P:1256`, `P:1295`). Nici clona 103, corecția manuală din acea zi, frecvența operațiilor sau freeze-ul live nu se verifică din surse. |
| §0: `stare='gol'` cu text nu este semnalat ca contradicție | **C pentru UI**, nu pentru existența celor 25 de cazuri: cuprinsul ignoră `stare` la etichetă și derivează gol/scris din text și fișier (`P:543`, `P:583`). |
| §1: tab PT, rezumat în fișă, închiderea modalului | **C**: `src/OfertareLicitatii.jsx:366`, `:385`, `:3631`, `:503`. Referințele auditului `:3548/:3624` nu mai corespund acestei copii locale; tabul din modal este la `:3555`. |
| §1/§3: pierderea contextului fișei | **C cu limită**: există „Înapoi la fișă” (`P:2049`; `src/OfertareLicitatii.jsx:386`), dar tabul modalului se reinițializează la cerințe/triere (`src/OfertareLicitatii.jsx:3465`). Nu lipsește orice cale de întoarcere. |
| §1: `load()` ≈20 query-uri, patru view-uri pentru poartă, recalcul grafic | **C ca ordin de mărime**, imprecis numeric: 15 citiri inițiale + 3 view-uri suplimentare + cumul + 2 F9 = 21; istoric și legături/acoperiri duc la 24; cu grafic sunt cel puțin încă 3 cereri, inclusiv paginare (`P:1256`, `:1291`, `:1299`, `:1315`, `:1324`, `:1339`, `:35`). |
| §1: orice scriere reîncarcă tot | **G ca afirmație universală**. Bifa PT și salvarea capitolului o fac (`P:1764`, `:1582`), dar importul/ștergerea/confirmarea F9 recitesc numai echipa (`P:2005`, `:2014`, `:2023`). |
| §2: ordinea celor 15 blocuri, matricea ultima | **C**. Inventar verificat: bară `P:2048`; eroare `:2093`; poartă `:2095`; F9 `:2099`; cuprins `:2102`; pachete `:2112`; observații `:2143`; echipamente `:2149`; personal `:2156`; organigramă `:2163`; clarificări `:2168`; participanți/anexe/declarații `:2173`; garanție `:2183`; conformitate `:2188`; matrice `:2203`. Sunt blocuri condiționale, nu 15 prezente obligatoriu simultan. |
| §2: exporturile și semnarea au egalitate vizuală | **G literal**: exporturile/aprobarea folosesc `S.btnS`, semnarea `S.btnP` (`P:2058`, `:2081`, `:2086`). Aglomerarea aceleiași bare este reală; impactul vizual cere observație în UI. |
| §2/§3a/f: ≈22 rânduri, 5 clicabile, 17 fără acțiune | **G numeric**: evaluatorul produce **23 fixe + 1 condițional**, cu **4 + 1** filtre; deci **19 fără acțiune**, în ambele cazuri (`G:26–198`; rândul opțional `G:39`). Cinci filtre nu înseamnă cinci rezolvări corecte. |
| §2/§3a: nu există verdict agregat | **C doar în PoartaPT**: randează rândurile (`P:278–305`). Verdictul există în evaluator (`G:200–208`) și rezumatul îl afișează (`P:686–691`). „Nu există în aplicație” ar fi greșit. |
| §2: F9 colapsat, blocajele nu sunt în poarta principală | **C**, dar numărul blocajelor rămâne vizibil în antetul colapsat (`P:211`, `:220`, `:230`; lista porții `G:26–198`). |
| §2: cuprinsul arată doar numărul cerințelor | **C**: `P:569`, `:601–652`; componenta nu primește lista cerințelor (`P:471`). |
| §2: „Pachete aprobate” apare numai după aprobare | **G**: condiția este `pachete.length > 0`; query-ul și randarea includ toate stările, inclusiv `propus` (`P:1277`, `:2112`, `:2120`). |
| §2: echipamente/personal folosite o dată; celelalte blocuri folosite rar | **N** ca frecvență. Este o ipoteză de produs, nu rezultatul codului. Mai mult, `load()` golește rezultatele pachetelor personal/echipamente (`P:1310`). |
| §2: clarificările post-depunere sunt permanent montate | **C**: nu există condiție de depunere în jurul `ClarificariAC` (`P:2168–2170`). |
| §2: trei formulare participanți/declarații/anexe; garanție separată | **C**: `P:2175–2185`. |
| §2/§3f: conformitate fără buton de încărcare | **C în PT**: ramura goală este numai text (`P:723–733`), iar componenta primește doar excepție/tip/extern (`P:2199`). „Goală la PT93” rămâne **N**. |
| §3a–c: traseu tab → selector → poartă; expand capitol; fără listă/filtru per capitol | **C structural**: `P:2050`, `:591`, `:625`, `:331–357`. 2–3 clickuri nu sunt universale: intrarea din fișă preselectează licitația (`P:1220`). |
| §3d: editor de 16 rânduri, salvare numai la text modificat, fără acceptare AI explicită | **C**: `src/OfertareRevizii.jsx:160–178`; salvarea schimbă `sursa` în `om` (`P:1577–1578`). Editorul nu primește cerințe. Blocajul „nescrise” vizează capitolele obligatorii eligibile, nu orice text AI: `supabase/migrations/20260913_ofertare_pt_stare_cerinte_neverificate.sql:56–59`. |
| §3d: generare cu prompt și până la două confirmări | **C**, confirmările sunt condiționale, nu pași obligatorii (`P:1592–1620`). Numărul C=5 nu este o măsurătoare generală. |
| §3e: verificare prin locator liber, autor/data/versiune, apoi reload | **C**: `P:1750–1764`. Se tastează un **locator**, nu obligatoriu un citat exact. Auditul/TO-BE alternează nejustificat cele două noțiuni. |
| §3e: dovadă prin două prompturi, listă de max. 40 documente, verificare ulterioară | **C**: `P:1783–1804`. Sunt documente de atribuire, nu selectorul întregului catalog de dovezi al firmei (`P:1276`, `:1795`). |
| §3e: 280 × (click + prompt) = 560 interacțiuni și 280 reload-uri | **C doar ca estimare condiționată** de 280 verificări reușite, fiecare separată. **N** pentru timpul real, operația dominantă și costul cognitiv; confirmarea dialogului, căutarea și lectura nu sunt măsurate. |
| §3f: filtre pentru fără capitol/capcane/neverificate; E2 fără chip; dovada propusă trimite la filtrul greșit | **C**: `G:35`, `:43`, `:55`, `:75`, `:94`; `P:336–357`. Bifa PT nu modifică registrul (`P:1756`). |
| §3f: fără legături directe spre Documente/Grafic/Cantități/cuprins/conformitate/H1/H4/H5/H8/H9 | **C**: rândurile respective nu au `filtru`, iar rendererul cunoaște doar această acțiune (`G:78–198`; `P:292`). H6 și sursa cantităților merită și ele inventariate explicit. |
| §3g: butoane finale dezactivate cu tooltip; ordinea semnează/aprobă neimpusă în UI; două inputuri depunere | **C**: `P:2081–2088`, `:669–679`; aprobarea pornește fără semnătură selectată (`P:1835–1837`). Recitirea înainte de semnare este în `P:1930–1938`; aprobarea începe din `st` local (`P:1813`). |
| §4: clasificarea PRIMARY/CONTEXT/EXCEPTION/AUDIT | Este **propunere editorială**, nu fapt de verificat. **G** dacă înseamnă ascunderea implicită a provenienței: sursa AI, autorul verificării și actualitatea versiunii sunt informații de decizie, nu doar tehnice (`P:576`, `:434`). |
| §5: cinci locuri cu cifre de cerințe | **C ca afișări**, nu cinci calcule identice: tab `src/OfertareLicitatii.jsx:3555`; rezumat `P:694`; poartă `G:34`; matrice `P:373`; cuprins `P:569`. Numără universuri diferite. |
| §5: trei definiții „neverificate”, două „capcane” | **C ca implementări separate**, cu diferență reală: filtrul folosește `some` pe legături, badge-ul doar prima legătură (`P:345`, `:416`, `:434`); SQL folosește existența unei verificări și absența oricărei blocări (`supabase/migrations/20260913_ofertare_pt_stare_cerinte_neverificate.sql:16`; `supabase/migrations/20260928g_ofertare_pt_stare_r06_r09.sql:19`). Regex client `P:200`, SQL `supabase/migrations/20260913_ofertare_pt_stare_cerinte_neverificate.sql:9`. |
| §5: cinci apeluri `evalueazaPoarta` | **C în copia furnizată**: `P:280`, `:686`, `:1813`, `:1938`, `:2042`. Refolosirea aceleiași funcții nu este, singură, cinci reguli divergente; datele de intrare/actualitatea lor contează. |
| §5: oameni și participanți în câte patru vederi | **C ca inventar neexhaustiv**: F9 `P:248`; personal `:909`; conformitate `:716`; organigramă `:2165`; participanți `:1149`, select capitol `:637`, H8 `G:187`; organigrama primește participanții (`P:2165`). Nu sunt automat informații redundante: rolurile vederilor diferă. |
| §6: verdict client + nouă controale + reverificare + filtre; lista citirilor server | **C pentru P/G**: importul celor nouă `G:16`, utilizarea `G:165–198`, plus controlul sursei `G:173`; view-uri `P:1257`, `:1264`, `:1291`, `:1341`; RPC-uri `P:1546`, `:1682`; dotări `P:1704`. |
| §6: R5 nu este chemat direct din UI, ci „doar în triggerul pachetului” | Prima parte **C**; „doar” **G**: este folosit și în poarta de depunere a licitației (`docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql:979`, `:1036`; `supabase/migrations/20260928f_gate_depunere_r07.sql:39`). |
| §6: J07 = mutarea întregului verdict pe server; statut HOLD/live | **G ca descriere a implementării locale**, **N pentru live**. `src/ofertarePoartaServer.js:1` spune explicit că nu înlocuiește controalele locale; `:17–21` enumeră 12 controale. RPC-ul nu agregă toate rândurile P/G, F9, E2, documentație și R5 (`supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql:214–223`). Migrarea este marcată PROPUSĂ (`:1`), iar `src/OfertarePropunere.jsx:1296` o consumă deja. Nu combin aceste versiuni într-un presupus „main live”. |
| §8: inventarul intervențiilor și sursele de precompletare | **C în mare**: atribuire/excepție `P:1902/:1915`, lacăt `:1635`, responsabil `:1413`, observații `:1644/:1661`, restul în tabelele de mai sus. **G** că regexul garanției nu e folosit: `dinCerinta` precompletează deja lunile și momentul (`P:983`). H5/H8 sunt semnale din text, nu adevăr contractual complet (`src/ofertareControale.js:312–335`; `supabase/migrations/20260913_ofertare_pt_stare_h5_anexe.sql:3`). |

**§7, mesaj cu mesaj:** problemele de orientare sunt reale, însă referințele auditului trebuie corectate. „18 în total” este **N**: tabelul prezintă 12 exemple, fără inventarul complet.

| Mesaj | Verdict / referință corectă |
|---|---|
| „confirmă-le sau exceptează-le” | **C**, ambiguu; `G:73`, nu `:69`. |
| „dovezi propuse… nebifate pe scan” | **C**, `G:42`; există click, dar spre `fara`, nu spre verificarea scanului (`:43`). |
| „documente necitite sau cu eroare” | **C**, fără listă/acțiune; `G:145`. |
| „nicio afirmație încărcată” | **C**, `G:120` și `P:726`, nu `G:121`. |
| „nicio versiune…/deschide Graficul” | **C**, fără link; `G:156/:158`. |
| „transfer în curs — reîncarcă” | **C**, fără buton dedicat; `G:238`, nu `:243`. |
| „N motive blochează F9” | **C**, totalul se vede colapsat, motivele la expand; `P:221/:230`. |
| „fără rol” | **C**, fără atribuire inline; `P:252`, nu `:224`. |
| „DEPĂȘIT — un capitol s-a modificat” | **C**, fără identificarea capitolului; `P:2126`, nu `:2134`. |
| „s-a redeschis un rând roșu” | **C**, fără identificarea rândului; `P:1940`, nu `:1939`. |
| „niciun partener declarat” | **C**, fără salt local; `P:647`. Numărul de secțiuni traversate este estimativ. |
| „gol” cu text | **G dacă este prezentat drept mesaj UI curent**: cuprinsul arată deja „scris” (`P:543/:584`); contradicția cu starea stocată rămâne ascunsă. |

**Ce lipsește din inventar, înainte de redesign:**

- **Falsă dovadă în matrice.** `P:1326` citește doar statusul acoperirii, fără `verificat_pe_scan`/`reverificare_ceruta`; `P:1333`, `:339`, `:429` o prezintă drept închisă cu dovadă. SQL R06 cere scan verificat și nereverificabil (`supabase/migrations/20260928g_ofertare_pt_stare_r06_r09.sql:14`). Clickul pe „dovadă propusă” poate deci duce la o listă care exclude tocmai rândul căutat (`P:336`).
- **F9 importă alternative, nu doar alegerea omului.** Query-ul nu filtrează `ales`, verificarea pe scan sau reverificarea; importul adaugă persoane/roluri și ignoră duplicatele, fără reconcilierea alegerilor retrase (`P:1969–2003`). AUTO pe handlerul actual amplifică problema.
- **„Rezolvate” înseamnă atribuite sau exceptate, nu verificate** (`P:340`). O cerință blocată poate apărea aici. Mai mult, după verificare dispar și butoanele „blochez”/„dovadă” (`P:450–457`): lipsește revenirea explicită asupra unei greșeli fără editarea textului.
- **Constatarea se scrie, dar nu se citește în `load()`.** `P:1773` scrie `constatare`, `P:1325` nu o selectează, deși UI încearcă s-o afișeze (`P:445`). Omul pierde explicația după reload.
- **Actualizare concurentă/context amestecat.** `load(id)` nu golește datele la intrare și nu verifică dacă răspunsul mai aparține licitației selectate (`P:1251–1335`, `:1349`). Salvarea manuală filtrează doar după ID, fără versiunea citită (`P:1577`). Sunt riscuri vizibile în cod, nu incidente runtime demonstrate aici.
- **Erori confundate cu lipsa datelor.** `load()` verifică doar o parte din erorile celor 15 citiri, apoi pune `[]`/`null` pentru altele (`P:1287`, `:1304–1307`). Eroarea F9 păstrează starea anterioară (`P:1344`); absența unui blocaj în state nu dovedește verificare reușită.
- **Pachetul și documentul semnat sunt etape distincte.** AS-IS generează două DOCX (`P:1821–1824`); depunerea compară bytes selectați cu bytes stocați (`P:1884–1887`), nu cu documentul aprobat înainte de transformare/semnare. „Hash diferit ⇒ BLOCK” necesită definirea artefactului comparat.
- **Accesibilitate și reluare:** rândurile porții sunt `div onClick`, fără activare nativă de la tastatură (`P:291–300`); nu sunt inventariate editarea nesalvată, progresul reluabil, anularea generării și starea „control indisponibil”. Frecvența/impactul cer observație, nu presupuneri.

## 2. Clasificarea autonomiei — fiecare rând TO-BE §2

Clasele trebuie separate pe două axe: **cine decide** (AUTO/CONFIRM/HUMAN_DECISION) și **se poate continua etapa finală?** (BLOCK). Blocajul nu interzice automat lucrul pe draft. Un scor mic descrie incertitudine, nu dovedește neconformitate.

| Operație | Verdict asupra clasei propuse / corecție |
|---|---|
| Creare cuprins — AUTO | **Corectă pentru draft** din structură explicită și versiune identificată a fișei; extragerea AI rămâne candidat, nu se camuflează ca șablon verificat. Nu suprascrie cuprinsul ajustat de om. Ambiguitate/clarificări contradictorii → HUMAN_DECISION. |
| Atribuire cerință → capitol — AUTO | **Corectă pentru candidat**, fără verificare implicită și fără înlocuirea legăturilor asumate. Scor apropiat → CONFIRM; pot exista cerințe care cer mai multe capitole. |
| Excepție „nu se aplică la PT” — CONFIRM | **Prea permisivă** dacă motivul este doar `tip ≠ propunere`: matricea include și `forma` (`P:1261`), iar o cerință de personal poate cere și răspuns PT. Excluderea din obligațiile PT cere HUMAN_DECISION motivată; CONFIRM numai pentru o regulă explicită, demonstrabilă din sursa curentă. |
| Scriere capitol — AUTO draft | **Corectă**, cu limite de cost, reluare și protecția textului uman/acceptat. Modelul istoric nu este dovada aplicabilității la licitația curentă. Lacătul și textul de om sunt protejate server-side azi (`supabase/functions/ofertare-genereaza-capitol/index.ts:242–248`). |
| Acceptare AI — CONFIRM | **Corectă**, pe întregul text vN și hash, separată de proveniența autorului și de verificarea fiecărei cerințe. Acceptarea nu ridică automat celelalte blocaje. |
| Verificare legătură cerință ↔ text — CONFIRM | **Corectă numai cu lectura și asumarea fiecărui rând**, nu cu „confirmă scorurile mari”. Cerința compusă cere toate elementele; contradicția/capcana → HUMAN_DECISION. Vezi §3. |
| Dovadă — AUTO candidat / CONFIRM final | **Corectă**. „Fără scan ⇒ BLOCK” este **prea strict universal**: cerințele satisfăcute prin text nu cer toate scan (`P:447–449`). Pentru un document probant obligatoriu absent, blochezi finalizarea pe motivul exact; PDF-ul original verificabil poate fi dovadă fără a fi scan. |
| Confirmare E2 — CONFIRM, aceeași bifă cu PT | Clasa **corectă**, mecanismul **prea permisiv**. E2 confirmă extracția obligației din documentație; PT confirmă îndeplinirea ei prin răspuns (`src/OfertareLicitatii.jsx:1758`, `:2083`; `P:1756`). Două confirmări distincte, eventual în același panou; pentru E2 trebuie sursa autorității, nu doar textul generat. |
| Blocare/constatare — HUMAN_DECISION | **Prea strictă pentru blocaje deterministe**: hash vechi, dovadă lipsă obligatorie sau control indisponibil pot produce automat BLOCK. Verdictul semantic „răspunsul contrazice cerința” rămâne decizie umană; AI propune motivul. |
| Import F9 — AUTO | **Prea permisivă în forma propusă**: AUTO numai pentru sincronizarea alegerilor umane curente și eligibile. Alegerea persoanei/rolului nu rezultă dintr-o listă de candidați. Handlerul actual nu e sigur de automatizat (`P:1969–2003`). |
| Disponibilitate personal — CONFIRM | **Corectă**; lipsa conflictelor în pontaj nu dovedește disponibilitatea pentru execuția viitoare. Confirmarea trebuie legată de interval, rol și alocările relevante; conflict → HUMAN_DECISION. |
| Externi/declarații disponibilitate — CONFIRM | **Corectă** dacă omul vede documentul, persoana și perioada. Numele egal nu dovedește identitatea, rolul sau angajamentul. Document obligatoriu absent → BLOCK final, nu imposibilitatea de a pregăti draftul. |
| Calificare cerută per afirmație — AUTO | **Prea permisivă** dacă deduce cerința din autorizația candidatului: ar ajusta standardul la persoana găsită. AUTO doar copiază tipul exact din cerința deja verificată; altfel candidat + CONFIRM/HUMAN_DECISION. Domeniu/material/valabilitate sunt parte din potrivire, nu doar codul catalogului (`P:1523`, `:1997`). |
| Garanție — CONFIRM | **Corectă**, cu sursa obligației și politica firmei versionate. „72” nu este implicit universal; numărul și momentul de start trebuie confirmate împreună. Precompletarea există parțial (`P:983`). |
| Participanți/declarații/anexe — CONFIRM | **Corectă doar ca validare a candidaților**. H5/H8 nu demonstrează acordul sau existența piesei: H8 compară fraze cu acte declarate (`src/ofertareControale.js:312–335`). Un nume inventat în draft nu trebuie să creeze singur participantul care apoi „validează” draftul. |
| Identitate H1 — HUMAN_DECISION | **Corectă** pentru constatările efective; nu cerem bifă pe fiecare rulare fără schimbări. Decizia leagă numele, contextul, locatorul și hash-ul. „Decizia B” nu este demonstrată implementată: J07 local declară `enforcement: none` (`supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql:222–223`). |
| Observații — HUMAN_DECISION | **Corectă pentru rezolvare/respingere semantică**; detectarea unei modificări poate fi AUTO. Nu închizi o observație doar fiindcă textul s-a schimbat. Astăzi observațiile sunt WARN (`G:132–138`). |
| Semnează verdictul — CONFIRM | **Corectă**, pe snapshot curent și cu rezerve explicite, recalculat/impus în server în aceeași operație. Nu confunda semnătura verdictului ERP cu semnarea electronică a documentelor pentru SEAP (`P:1944`). |
| Aprobă pachet — CONFIRM | **Corectă**. AUTO poate asambla un candidat de pachet; nu îl aprobă. Omul vede manifestul concret și verificările actuale. Nu condiționa asamblarea de un control care cere deja existența pachetului (`src/ofertareControale.js:468–473`). |
| Înregistrare depunere — HUMAN_DECISION | **Prea strictă pentru transcrierea unei recipise verificabile**, dar corectă pentru atestarea explicită a depunerii externe fără integrare sigură. Compară hash-ul artefactului final semnat aprobat pentru transmitere; DOCX nesemnat → PDF semnat schimbă legitim bytes. AS-IS nu demonstrează egalitatea cu aprobarea (`P:1822`, `:1884`). |
| Clarificări după depunere — „ascuns” | **Nu este clasă de autonomie.** Ascunderea după simpla lipsă a stării ERP poate pierde solicitări reale ale unei depuneri istorice neînregistrate. Arată secțiunea când există solicitare sau depunere; răspunsul/asumarea = HUMAN_DECISION/CONFIRM, pregătirea = AUTO candidat. Există chiar fallback la termenul licitației (`G:310–313`). |

Totalul „6 AUTO + 11 CONFIRM + 5 HUMAN_DECISION din ~24” nu este reproductibil: tabelul are 21 rânduri, unul fără clasă și unul mixt. Nici „BLOCK doar când lipsește dovada” nu este corect: există contradicții și controale indisponibile (`G:219–238`). „Human only on exception” rămâne o direcție; dacă toate cele 280 cerințe necesită verificare umană, automatizarea elimină căutarea/tastarea, nu lectura și judecata.

## 3. Verificatorul de citate și confirmarea în bloc

**Un citat găsit exact în text demonstrează existența pasajului, nu satisfacerea cerinței și nici adevărul afirmației.** Două modele de acord nu transformă candidatul în dovadă umană. Exemplu: „vom asigura personal autorizat” poate reproduce cerința perfect și tot nu dovedește persoana, domeniul sau disponibilitatea. Un pasaj cu „20 m” nu dovedește „minimum 20 m” dacă contextul îl neagă sau îl atribuie altei lucrări.

Contractul propus trebuie să aibă trei rezultate separate:

1. **AUTO, verificare mecanică:** citatul există în snapshotul canonic, locatorul indică exact acea apariție, hash-urile și versiunile sunt curente. Offset/paragraf pentru text, pagină și zonă pentru PDF; OCR-ul nu ține locul imaginii originale. Eșecul = candidat negăsit/ambiguu, nu verdict „cerință neîndeplinită”.
2. **AI, propunere semantică:** ce sub-obligații acoperă pasajul, ce lipsește, eventuale contradicții, scor cu semnificație documentată. Nici scorul maxim, nici un al doilea LLM nu pot scrie `verificata`, `confirmata_de` sau acceptarea capitolului.
3. **Om, verificare:** decide dacă răspunsul satisface obligația și dacă afirmațiile factuale au dovada cerută. Actorul și data sunt stabilite pe server. Automatizarea ulterioară consumă această decizie numai cât timp dependențele sunt aceleași.

**Ce trebuie să vadă omul:** obligația completă, inclusiv condiții/excepții/subpuncte; sursa autorității și clarificările aplicabile; citatul exact din răspuns, evidențiat în context suficient pentru negații și referințe; capitol/versiune; documentul probant real unde este necesar; goluri/contradicții și motivul propunerii. Sursele trebuie să se deschidă direct la locator. „262 puternice” poate ordona lista, nu poate ascunde restul textului sau preselecta acceptarea.

**Confirmarea în bloc poate comprima salvarea, nu verificarea.** Nicio selecție implicită după scor. Omul marchează rândurile efectiv examinate; butonul spune „Salvează verificarea celor N selectate”, cu lista exactă. Rândurile off-screen, paginate, filtrate, încărcate ulterior ori omise nu intră. Pentru cerințe compuse se văd toate elementele necesare; acceptarea textului capitolului și E2 au controale distincte. Evenimentele „afișat”/scroll sunt urme utile, **nu dovada că omul a citit sau înțeles**. Nu putem demonstra lectura prin telemetrie; putem preveni promovarea automată și testa calitatea verificării în utilizare.

**Ce se stochează, pe candidat și pe decizie:**

- ID candidat, licitație, cerință, legătură, capitol; textul cerinței/versionarea sa; setul sub-obligațiilor; citat exact și locator structurat; ID/revizie/hash bytes pentru documentele autorității și dovezi.
- `hash_text` pentru întregul snapshot de capitol, nu numai citatul; `hash_citat`; versiune capitol; hash cerință și amprenta dependențelor (legături, clarificări, dovezi, alegeri relevante). Aceeași frază într-un context modificat nu rămâne verificată automat.
- `parser_version` **și versiunea normalizării**, model/prompt/run ID, `scor` și tipul lui; separat `citat_gasit_exact`/ambiguitate. Nu prezenta scorul autodeclarat de LLM drept probabilitate calibrată.
- Decizia umană append-only: actor server, timp server, rezultat/motiv, ID candidat și hash-urile exact văzute, ID sesiune de review și lista explicită a rândurilor asumate. `sursa='ai'` se păstrează; acceptarea nu rescrie autorul.

Aceasta este **schemă și API noi**, nu încă două proprietăți într-un UPDATE. Contractul actual verifică prezența autorului/datei/versiunii, nu un citat și întregul set de hash-uri (`supabase/migrations/20260913_ofertare_pt_legaturi_stare_si_dovezi.sql:25–26`; `P:1756–1760`). `sursa` există pe capitole, dar trebuie verificat separat contractul candidaților de legătură; nu presupunem că poate fi reutilizat fără migrare.

**Invalidare și concurență:** confirmarea trimite ID-urile și hash-urile citite. Serverul verifică accesul, recitește/serializează dependențele, respinge atomar lotul dacă ceva s-a schimbat și returnează exact ce a salvat. Nu doar `WHERE capitol_id = X` sau „toate scorurile > prag”. Un worker întârziat nu poate înlocui un candidat confirmat sau marca actuală o analiză veche. Editarea cerinței, capitolului, contextului, documentului, clarificării, atribuirii ori dovezii marchează deciziile dependente stale, păstrând istoricul; regenerează candidații, dar cere din nou omul. O schimbare de parser invalidează potrivirea automată; nu șterge evenimentul uman istoric. Gate-ul final recalculează actualitatea inclusiv dacă jobul de invalidare n-a rulat.

Versionarea actuală urmărește conținutul/fișierul capitolului (`supabase/migrations/20260913_ofertare_pt_revizii_trigger_rls.sql:12–18`), iar invalidările vechi urmăresc înlocuirea cerinței și revizia documentului (`supabase/migrations/20260913_ofertare_pt_invalidare_dependente.sql:30`, `:53`). Aceste mecanisme și hash-binding-ul celor patru controale text J07 (`supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql:8`, `:48–75`) **nu demonstrează deja invalidarea completă a noilor confirmări de citate**.

**Demonstrația necesară înainte de GO:** teste server negative în care workerul încearcă să confirme; lot cu rând nevăzut/altă licitație; editare concurentă a cerinței sau capitolului; revizie/hash de document schimbat; rerulare veche; două citate identice în contexte diferite; negare/unitate/material greșit; cerință parțial acoperită; OCR eronat; lipsă sursă; refuz parțial și retry. Separat, evaluare oarbă cu erori introduse cunoscute: câte acceptări false produce review-ul pe lot față de review-ul individual, cât timp real economisește și ce ratează la scor mare. Fără eșantion adecvat și incertitudine raportată, **25 confirmări + 18 decizii este doar o machetă**, nu probă de calitate sau productivitate.

## 4. Quick Wins — invariant, schemă, ordine

| QW | Evaluare |
|---|---|
| **1 — banner** | **GO cu condiții**, fără schemă pentru prezentarea evaluatorului actual. Include `WARN`, `indisponibil` și încărcare; zero BLOCK nu se etichetează automat „gata de depus”. Ține F9 vizibil separat până există agregare autoritativă. J07 actual nu este întregul verdict (`src/ofertarePoartaServer.js:17`). |
| **2 — acțiuni pe blocaje** | **GO**, UI/router, fără schemă. Păstrează licitația, cerința, filtrul și întoarcerea; nu trimite toate cauzele în același filtru. Acțiunea pentru indisponibilitate este recitire/diagnostic, nu „confirmă”. |
| **3 — cerințe per capitol** | **GO**, UI, fără schemă. Folosește toate legăturile și distinge atribuit/verificat/blocat/expirat; nu reproduce `find`/„gata” din matrice (`P:340/:416`). |
| **4 — acceptare AI** | **Nu este un QW numai de UI. Necesită schemă + contract server**, view/porți, audit/invalidare și test de concurență. Păstrarea `sursa='ai'` este corectă, dar generatorul protejează azi numai `sursa='om'` sau lacătul (`supabase/functions/ofertare-genereaza-capitol/index.ts:243–248`): fără extinderea protecției poate rescrie textul acceptat. Nu transforma simpla bifă în `sursa='om'`. |
| **5 — panou verificare** | **GO cu condiții**, UI fără schemă dacă produce același locator și aceeași verificare explicită. Selectarea paragrafului nu înseamnă „verificat”; mai trebuie asumarea cerinței. Include textul integral și versiunea. Hash/proveniență robustă și salvare atomică cer extinderea serverului, nu trebuie pretinse existente (`P:1756`). |
| **6 — stare gol cu text** | **NO-GO în formularea actuală**. Afișarea derivată există deja (`P:543/:584`). `gol` stocat nu produce singur `capitole_goale`: SQL verifică text+fișier. Dar „starea nu intră în gate-uri” este fals: `stare <> 'nu_se_aplica'` participă la goale/nescrise (`supabase/migrations/20260913_ofertare_pt_stare_cerinte_neverificate.sql:34/:57`). Un indicator de contradicție poate fi doar UI; „repară la salvare” cere regulă explicită care păstrează excepțiile/verificarea, posibil trigger nou. Niciun backfill implicit. |
| **7 — reordonare/colapsare** | **GO**, fără schemă. Blocajele active din secțiuni colapsate rămân în lista de atenție; deschiderea unei destinații o expandează. Nu ascunde solicitările AC existente doar fiindcă lipsește marcajul ERP de depunere. |
| **8 — mesaje precise** | **GO** pentru text/link, fără schimbarea regulilor. Pentru „cap. X v5 > v4” trebuie comparate sursele manifestului, nu inventată cauza din booleanul `pachetDepasit` (`src/ofertarePachet.js:69–71`). Erorile server fără ID-uri pot cere contract/RPC extins, nu neapărat coloană nouă. |
| **9 — update local + poartă** | **GO cu condiții, după corectitudinea datelor**. Fără schemă obligatorie, dar răspunsul scrierii și toate dependențele porții trebuie reconciliate; optimistic UI nu deschide gate-ul. În P sunt patru view-uri și reverificare grafic (`P:1291–1295`); J07 local adaugă Edge+RPC (`src/ofertarePoartaServer.js:4–8`). Promisiunea „doar două query-uri” nu este susținută. Recitirea finală nu justifică afișarea verde din date vechi. |
| **10 — chip E2 și link** | **GO**, fără schemă; exact această separare trebuie păstrată. Nu introduce pe ascuns bifa dublă E2+PT din §2. |

**Ordine recomandată:** corectarea divergenței matrice–poartă și a erorilor de încărcare → QW10 + QW2/QW8 → QW3 + QW5 → QW7 + QW1 → QW4 ca livrare separată cu server și teste → QW9. QW6 se reformulează sau se scoate. Nu susțin estimarea comună „1–2 zile, risc mic”: include lucru de schemă, generator, invalidare și contract server, fără măsurătoare de efort.

Pentru V2, ordinea §4.4 trebuie schimbată: **contract server complet și dependențe → workspace de review + acceptare sigură → candidați de citate → confirmare pe lot → automatizări și auto-continue**. Nu se livrează confirmarea în bloc înaintea spațiului în care omul poate verifica. R5/R12/J02/J05 rămân active; agregarea lor în UI nu le înlocuiește. Nici aprobarea și nici depunerea nu devin efecte automate ale unui „verde”.

## 5. Top 10 după impact asupra utilizatorului

Ordinea propusă optimizează numărul de clickuri înaintea riscului de încredere falsă. Fără măsurători pe clona 103 nu putem stabili ordinea după minute economisite. Pentru o licitație, recomand prioritatea **impact al erorii × frecvență**, în această ordine:

1. **Stări fals liniștitoare și discrepanța listă–poartă**: „dovedită” fără scan verificat, „rezolvate” doar atribuite, erori tratate drept liste goale (constatările din §1). Combină problema originală #8 cu aceste omisiuni.
2. **Verdict final complet, actual și explicabil**, inclusiv cauzele F9 și indisponibilitatea; mută originalul #10 lângă #3. Serverul previne trecerea, UI-ul trebuie să explice același rezultat.
3. **Workspace pe capitol**, originalul #2: obligație, răspuns, context și dovezi simultan. Este precondiția unei verificări bune.
4. **Verificare asistată fără locator tastat**, originalul #1. Economisește căutare și operații; nu o descrie drept muncă „în care omul nu judecă”.
5. **Acceptare AI explicită și protejată**, originalul #4: elimină editarea artificială și păstrează proveniența.
6. **Concurență, invalidare și posibilitatea de a retrage o verificare greșită**, problemă nouă; include schimbarea licitației în timpul încărcării și păstrarea explicațiilor blocajelor.
7. **Rezolvare directă cu întoarcere la context**, originalul #7 plus acțiunile porții din #3.
8. **Salvare rapidă, fără resetarea muncii și cu stări de eroare clare**, subestimată în listă; QW9 și rezultatele personal/echipamente golite de reload (`P:1310`).
9. **Reordonare și afișare progresivă**, originalul #6, cu excepțiile active mereu vizibile.
10. **Precompletare din surse verificate și sincronizarea F9**, originalul #9, după eliminarea candidaților nealeși și a validării circulare din propriul text.

Scot **#5 „stare gol produce fals-roșu”** ca problemă prioritară demonstrată: premisa nu rezultă din predicatul SQL și UI-ul deja derivează eticheta. Păstrez separat calitatea stării stocate. Nu păstrez „cinci afișări” ca defect în sine; problema este divergența semantică. Adaug ca cerințe transversale accesibilitatea, progresul reluabil și diferența dintre pachet pregătit, aprobat, semnat și efectiv depus.

## 6. Verdict final

| Componentă | Verdict | Condiții de ieșire |
|---|---|---|
| **Quick Wins** | **GO cu condiții** | QW2/3/7/8/10 pot fi livrate ca UI; QW1/5/9 păstrează actualitatea și regulile; QW4 se separă ca schimbare server+schemă; QW6 se corectează. Mai întâi divergența „dovedită” și erorile de date. |
| **Workspace V2** | **GO cu condiții pentru direcție** | Contract agregat complet, fără presupunerea că J07 actual îl oferă deja; E2 separat de PT; acceptări cu provenance și invalidare; protecția textului acceptat; F9 numai din alegeri curente; mașină de stări clară până la depunere. Asamblarea automată produce candidat, nu aprobare. |
| **Verificator de citate + confirmare în bloc, așa cum sunt descrise** | **NO-GO** | GO pentru **propunerea de citate candidate**. Confirmarea în bloc primește GO numai după contractul și testele din §3: potrivire deterministă, review real per cerință, autor server, hash-uri pentru toate dependențele și refuz atomic al datelor stale. „Omul a văzut rândurile” și scorul AI nu sunt suficiente. |

Validare efectuată: lectură statică și corelare de referințe, inclusiv numărarea celor 24 `r.push` (unul condițional) și cinci filtre (unul condițional). **Nu am rulat teste, build, query-uri SQL sau fluxuri UI**; raportul nu certifică deploy-ul, schema live, cifrele PT93, durata operațiilor ori calitatea viitorului verificator. Singurul fișier creat este `jak_ux_review.md`.
