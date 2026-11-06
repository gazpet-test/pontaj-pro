# PR3b — Model 1U, convocator utilizator / arendaș

Implementat pe `codex/redari-pr3b-sablon-utilizator`, realiniat la baza actuală PR3a
`codex/redari-pr3a-poarta-utilizatori` @ `69d5cf8f82db9864ae093a315a6dab6290f10621`.
PR #1004 integrat în main; textul juridic este validat de Razvan 06.11.2026.
Fără acces Supabase, migrări, date reale, modificări în `pv.js`, `ModalPv.jsx`, SalariiPage sau alte module.
Actualizare 06.11.2026 pe branch-ul PR #999: antetul-imagine comun este aplicat și Modelului 1U.

## Fișiere

| Fișier | Rezultat |
|---|---|
| `public/redari/sabloane/convocator_utilizator.docx` | Model 1U generat, 35 de placeholder-e, fără chei noi. |
| `scripts/redari_sabloane_din_modele.mjs:467` | Rețetă din Model 1 v6, moștenește rețeta proprietarului și aplică exact textul Juridic. |
| `src/redari/docx.js:621` | Calitatea captată înainte de await determină șablonul, eticheta și `calitateDocument`. Pentru utilizator/arendaș încarcă explicit Model 1U; ignoră bufferul proprietarului trimis de apelanții existenți. |
| `src/redari/convocareUtilizatori.js:8` | Elimină exclusiv refuzul „șablon lipsă”; păstrează poarta owner PR3a prin același predicat. |
| `docs/redari/SABLOANE.md:196` | §2.1U: aceeași hartă cu §2.1, eticheta „arendaș”, reproducere, limite și formatare. |
| `src/redari/docx.test.js:247` | Expected din textul Juridic; DOCX real completat strict, alegere după calitate, chei, QR, structură, erori și instantaneul calității. |
| `src/redari/convocareUtilizatori.test.js:20` | Refuz cu poarta închisă, inclusiv previzualizare; aprobarea nu mai primește motivul vechi PR3b. |
| `src/redari/convocatoareMasa.test.js:571` | Utilizatorul aprobat intră în plan fără consum de numere la planificare. |
| `src/redari/ui/ModalConvocatorPoarta.test.jsx:45` | Actualizează așteptările provizorii PR3a; rândul vechi nu ocolește poarta proaspătă închisă; motivul comun permite aprobarea. Codul UI nu este modificat. |
| `docs/redari/RAPORT_PR3B.md` | Acest raport. |

## Generare reproductibilă și compunere cu antetul

```sh
node scripts/redari_sabloane_din_modele.mjs
node scripts/redari_sabloane_din_modele.mjs --verifica
```

Sursa nemodificată: `docs/redari/referinta/Model_1_Convocator_proprietar_v6_final.docx`.
Fiecare înlocuire folosește `inlocuiesteWt` / `inWt`, cu exact **o apariție** declarată prin
argument scalar. Orice nepotrivire oprește construirea înainte de publicarea fișierelor.
Nu a fost necesară inventarea vreunei mapări sau reformulări.

Rețeta reutilizează parametrizarea, antetul existent, QR-ul, A4, marginile și stilurile Modelului 1.
În excepția de formatare (7), doar 1U primește 30 pt înainte de paragraful de după opțiuni:
altfel, în LibreOffice QR-ul de 3 cm suprapunea primele rânduri ale paragrafului mai lung.
Textul este comparat înainte/după fiecare pas de formatare și trebuie să rămână identic.
Testul de structură permite exclusiv această spațiere suplimentară față de Model 1.

Model 1U folosește `scripts/redari_antet.mjs` din #999 prin constructorul comun `construieste`:
`faraDateFirma` scoate rândul scris, iar `adaugaAntet` introduce imaginea doar în header-ul primei pagini.
Aceiași pași se aplică tuturor celor șase rețete; cererea de împuternicire folosește același modul.

Verificarea octet cu octet raportează `identic` pentru toate cele șase rezultate ale rețetei,
inclusiv `convocator_utilizator.docx`. La integrarea cu #999 toate șabloanele au fost regenerate.

## Frazele Juridic

| Punct | Aplicare / dovadă |
|---|---|
| 1 | Aplicat literal: „Către: {{nume}}, în calitate de {{calitate}} al terenului”; rețetă:485, test pentru utilizator/arendaș. |
| 2 | Aplicat literal titlul „Parcela pe care o folosiți (în arendă / în folosință), afectată temporar de lucrări:”; rețetă:486. |
| 3 | Aplicată invitarea în calitate de utilizator și propoziția integrală despre convocarea separată, semnarea de oricare și consemnarea calității; rețetă:488. |
| 4 | Adăugată integral fraza „Semnătura dumneavoastră privește numai starea terenului constatată la fața locului; ea nu modifică drepturile proprietarului asupra terenului și nici raporturile dintre dumneavoastră și proprietar.”; rețetă:492. Poziția urmează textul complet 1U furnizat. |
| 5 | n/a ca înlocuire: cele patru opțiuni rămân identice, verificate între DOCX-urile reale în `docx.test.js:269`. |
| 6 | Aplicate ambele propoziții, inclusiv „Dacă procesul-verbal a fost deja semnat de proprietar înainte de sesiune, prezența dumneavoastră nu mai este necesară.”; rețetă:496. |
| 7 | Aplicată integral precizarea despre folosință, culturi și persoanele îndreptățite potrivit legii; rețetă:498. |
| 8 | Aplicată integral precizarea despre actul de folosință „dacă îl aveți”, evidențele Beneficiarului și faptul că actele nu se rețin/copiază; rețetă:499. |
| 9 | Aplicată integral precizarea despre încetarea/parțialitatea folosinței, alt utilizator și semnarea numai pentru parcela folosită efectiv; rețetă:500. |
| 10 | n/a ca înlocuire: datele personale, contactele, semnăturile, antetul, tabelul sesiunilor și QR-ul sunt moștenite; verificare de structură și stiluri în `docx.test.js:269`. |

Aplicată și diferența explicită din textul complet: „datele parcelei dumneavoastră” →
„datele parcelei” (`...mjs:491`). Toate frazele noi sunt așteptări independente în
`src/redari/docx.test.js:248`, copiate din textul Juridic, fără import din rețetă.

Punctele de confirmat (a), (b), (c) sunt păstrate în forma furnizată, fără variantele alternative.
(d), schimbarea confirmării din formularul public, este n/a în acest PR, conform delimitării din cerere.
Nu s-au schimbat regulile PV A/PV B sau condițiile de semnare în aplicație.

Verificările actualizării #999 (inclusiv eșecul preexistent Ofertare din main) sunt în
[RAPORT_PR999_ACTUALIZARE.md](RAPORT_PR999_ACTUALIZARE.md). Rezultatele de mai jos sunt istoricul verificării inițiale #1004.

## Verificări executate inițial (#1004)

- `npx vitest run`: **165 fișiere trecute, 3 sărite; 3.956 teste trecute, 22 sărite**.
- `npx vite build`: **verde**; avertismente Vite privind importuri mixte și chunk-uri mari.
- `node scripts/redari_sabloane_din_modele.mjs --verifica`: **identic pentru toate cele șase șabloane**.
- `git diff --check`: verde.
- Cazuri reale DOCX: toate cele 35 de chei întregi; completare strictă fără placeholder-e rămase în părțile XML;
  utilizator/arendaș → Model 1U; proprietar/coproprietar/moștenitor → Model 1; eticheta „arendaș”; QR și verso.
- Poarta închisă refuză inclusiv previzualizarea; poarta aprobată permite generarea și reîncărcarea.
  HTTP nereușit, rețea sau DOCX invalid refuză fără fallback la Model 1.
- Probă negativă de formatare, într-o copie temporară a scriptului cu selectorul de paragraf absent:
  exit 1, mesaj exact `1U: paragraful după opțiuni: 0 apariții, așteptată 1`; rulată cu `--verifica`, fără scriere.
- Control vizual LibreOffice pe document completat strict cu date exclusiv fictive: **două pagini A4**,
  convocarea pe pagina 1, informarea pe pagina 2; QR fără suprapunere după ajustarea declarată de spațiere.
  Aceasta este o verificare pe exemplul fictiv, nu o garanție de paginare pentru orice lungime a datelor sau orice versiune Word.

Nu s-au rulat SQL, PostgREST, migrare/rollback sau probe cu date reale; sunt în afara acestei cereri.
Textul Modelului 1U: validat de Razvan 06.11.2026. Textul juridic nu a fost schimbat la integrarea antetului.

## Reguli L01–L25

| Regulă | Respectare / dovadă |
|---|---|
| L01 | n/a |
| L02 | n/a |
| L03 | `docx.js:622,644,676`: aceeași calitate captată înainte de await pentru etichetă, alegerea șablonului și stampila returnată. Testul `docx.test.js:339` schimbă deținătorul în timpul încărcării și verifică păstrarea calității originale. Nu se modifică protocolul PR3a de legare în BD. |
| L04 | n/a |
| L05 | n/a — nu se adaugă scrieri, trimiteri sau retry; nicio ștergere/fallback la eroare de încărcare. |
| L06 | n/a |
| L07 | Poarta PR3a este păstrată prin alias la predicatul existent (`convocareUtilizatori.js:8`); teste de refuz inclusiv previzualizare (`convocareUtilizatori.test.js:20`) și date proaspete în modal (`ModalConvocatorPoarta.test.jsx:45`). Trigger-ele/RPC/RLS rămân cele din PR3a, neatinse; fără revendicare de verificare live BD în PR3b. |
| L08 | n/a |
| L09 | n/a |
| L10 | n/a |
| L11 | n/a |
| L12 | Rețeta cere aparițiile exacte (`...mjs:485`), verifică textul neschimbat după fiecare formatare (`...mjs:520`); testul independent verifică integral frazele noi (`docx.test.js:248`), iar strict refuză cheile rămase. Nicio frază omisă tacit. |
| L13 | Selectorul de paragraf folosește tiparul XML existent, verifică forma și exact o apariție (`...mjs:473`). Test pozitiv de structură (`docx.test.js:269`) și proba negativă pe copie temporară: 0 apariții → exit 1 înainte de scriere. Înlocuirile juridice sunt texte exacte, nu regex permisiv. |
| L14 | n/a |
| L15 | n/a |
| L16 | n/a |
| L17 | n/a — nu se introduc calcule/parsers de numere sau timp; se păstrează helper-ele existente. Fixture-ul de control are dată explicită. |
| L18 | `docx.js:678`: verificare `raspuns.ok` înainte de buffer; erorile HTTP/rețea/DOCX se propagă fără șablon de rezervă. Testele `docx.test.js:325`. Lipsa/NULL a aprobării rămâne refuz, prin predicatul comun. |
| L19 | `esteUtilizator` comun și `motivConvocatorUtilizator = motivPoartaUtilizatori`; fără o nouă definiție a porții. Rețeta 1U moștenește rețeta Model 1 (`...mjs:468,483`), inclusiv formatarea și antetul. |
| L20 | Matrice utilizator/arendaș, aprobat/neaprobat, strict/previzualizare; proprietar/coproprietar/moștenitor legitimi, încărcare nereușită și stampilă captată: `docx.test.js:284`, `convocareUtilizatori.test.js:16`, `convocatoareMasa.test.js:571`, `ModalConvocatorPoarta.test.jsx:65`. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a — fără modificări de load/acțiune în componente; instantaneul generatorului este verificat la L03. |
| L25 | DOCX real, QR și verso, așteptări copiate independent din textul Juridic (`docx.test.js:248`), apel cu buffer Model 1 ca apelanții existenți, refuz HTTP/rețea/DOCX, schimbare de calitate în await. Suitele existente ale convocatorului și întreaga suită vitest sunt verzi; fără simularea unor probe BD ca fiind executate. |
