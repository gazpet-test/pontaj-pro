# Plan C — geometria PDF pentru dovada rândului

**Analiză, 18.10.2026. Bază: origin/main `0203e26`. Nicio implementare,
migrație, recitire sau modificare în producție în acest branch.**

## Problema și punctele reale de integrare

`worker/ofertare/ingest.ts:textLocal` rulează deja `pdfinfo` și
`pdftotext -layout -enc UTF-8`, apoi `imparteText`/`compuneText` transformă
rezultatul în `text_extras` cu marcaje de pagină. Spațiile sunt comprimate.
Calea pentru PDF-uri mari din `worker/ofertare/citire_mare.ts` trebuie extinsă
împreună cu cea obișnuită; altfel geometria lipsește tocmai la dosarele mari.

`_shared/cantNumar.ts:blocRand` folosește linii de text, `Total=`, maximum de
continuări și certificarea `orientareDedesubt`. `umLanga` caută vecinătatea în
text/markdown. `_shared/cantNormalizare.ts` verifică astfel codul și Dn-ul.
Geometria trebuie să rezolve **apartenența la articol și rolul coloanei**, nu
să schimbe interpretarea numerică.

[PR749](https://github.com/gazpet-test/pontaj-pro/pull/749), inclusiv decizia
finală după r1–r6, arată de ce textul singur nu poate certifica poziția descrierii
față de cantitate. Riscul acceptat este marcat `dn_din_continuare`, cu bifă umană.
`docs/PIPELINE_CITIRE_DOCUMENTE.md` §1.4 mai descrie ultima celulă markdown fără
separator final, UM căutat peste linie și ambiguitatea cantitate/preț.
Documentul descrie istoric `p2/n3`; codul din main are deja `p3/n4/f1` în
`ofertare-cantitati-extrage/structurat.ts`. Planul se aplică acestui cod actual,
nu propune revenirea la n3. Numerele din PR sunt rezultate istorice, nerulate aici.

## Reprezentare propusă și extracție locală

Pe NAS, din aceiași octeți PDF verificați prin SHA-256, generăm separat
`pdftotext -bbox-layout -enc UTF-8 <pdf> <xml>`; `-bbox` simplu rămâne variantă
de diagnostic. Versiunea exactă Poppler, argumentele, limitele de timp/memorie
și hash-ul XML intră în manifest. Opțiunile și convenția coordonatelor se verifică
pe versiunea instalată înaintea implementării; nu am rulat aceste comenzi pe NAS.

XML-ul furnizează cuvinte/poziții și grupări de layout, **nu certifică celule sau
articole**. Parser fără entități externe/DTD, fără rețea, cu plafon de octeți,
pagini, cuvinte și adâncime. Exit nenul, ieșire trunchiată, coordonate NaN/negative
sau în afara paginii devin eșec explicit. Nu schimbăm automat calea în AI plătit.
Pagina doar imagine rămâne `geometrie_nativa_absenta`, nu „zero articole”.

Sidecar `pdf-geometry-v1`, cu:

- identitate: `pdf_sha256`, `document_id`, `text_sha256`, `geometry_sha256`,
  versiuni Poppler/parser/algoritm, argumente, timestamp și acoperire per pagină;
- pagină fizică în PDF (1-based), pagină globală după `pagina_offset`, dimensiuni,
  CropBox/MediaBox și transformare documentată către coordonate canonice;
- cuvinte: ID stabil în artefact, text literal, bbox, pagină, bloc/linie Poppler;
- linii și rânduri **derivate**: ID, bbox, token IDs, secțiune/tabel, roluri de
  coloană și motivele ambiguității; `sursa=native_pdf` separat de orice OCR;
- legături în textul exact: intervale `[de_la,pana_la)` în unități UTF-16,
  ca offseturile JS existente. Fiecare token poate avea zero sau mai multe
  intervale candidate; numai maparea unică este dovadă. Hash text obligatoriu.

Păstrăm textul literal și XML-ul brut. Transformarea paginii include rotația și
CropBox; o probă 0/90/180/270 verifică raportarea coordonatelor. Nu presupunem
că ordinea obiectelor PDF ori ordinea XML este ordinea vizuală. Textul rotit în
interiorul unei pagini sau suprapus rămâne ambiguu dacă bbox nu îl rezolvă.

## Algoritm de rând și dovadă

1. Separăm regiuni/tabele și secțiuni; nu grupăm global toate cuvintele cu y
   apropiat (ar reuni coloane/tabele independente). Folosim suprapunerea
   verticală și dimensiunea mediană a caracterelor; praguri versionate și fixate
   înainte de evaluarea lotului rezervat pentru test.
2. Identificăm antetele și intervalele x pentru cod, descriere, UM, cantitate,
   preț și valoare. Antete pe mai multe linii, celule unite, două tabele vecine
   sau o coloană fără rol unic => `coloana_necertificata`, fără ghicit după poziția
   „ultima coloană”. Ancorele sunt locale secțiunii, nu transferate între machete.
3. Construim articolul din ancorele cod/cantitate și regiunea descrierii. Textul
   deasupra sau dedesubt se atașează numai cu delimitare geometrică unică față
   de articolele vecine. „Cel mai apropiat y” singur nu este suficient. Dacă două
   atribuiri sunt posibile, rândul rămâne nedovedit. Continuitatea peste pagină
   se tratează separat, fără lipire automată prin similitudine.
4. Codul întreg, UM și cantitatea trebuie să fie în celulele rolurilor lor,
   în același articol. Dn-ul se verifică în descrierea acestuia, nu în vecin.
   Golul rămâne gol; un zero imprimat este distinct. Dublurile/suprapunerile
   de text ascuns nu se numără de două ori și nu se elimină arbitrar.
5. `blocRand` nu se șterge din prima: introducem un resolver geometric separat,
   apelat prin context opțional în `normalizeazaRand`. Dovadă geometrică validă
   are token/cell IDs și bbox; lipsă/contradicție rămâne explicită. Fallback-ul
   vechi păstrează eticheta și confirmarea umană `dn_din_continuare`; niciun rând
   legacy nu este promovat automat ca „geometric”.

Citatul și numărul propuse de model se verifică în sidecar, nu invers. Nu
construim geometria pe baza răspunsului AI. Regulile `valoareInDocument`,
convenția numerică pe grup, codul întreg și verificarea Dn rămân obligatorii:
coordonatele nu decid dacă `3.995` înseamnă 3995 sau 3,995.

## Persistență și integrare

**Pilot local:** sidecar și manifest în directorul de rulare, fără schimbarea
`text_extras`. Recitirea din `scripts/recitire_val1/citeste.ts` este un pilot AI
plătit, nu locul în care introducem apeluri bbox ori ocolim bugetul. Adăugăm
ulterior un pas CPU explicit, separat, cu identitatea PDF și paginile cerute.
`asambleaza.ts` produce raport comparativ și verifică identitatea grupului;
`aplica.sql`/`aplica_rezultat.sql` păstrează CAS și fereastra de mentenanță.
Aprobarea aplicării textului nu autorizează implicit publicarea geometriei.

**Propunere pentru producție, schemă nouă numai într-un PR ulterior:** artefact
XML/JSON imutabil într-un storage privat; tabel metadata propus
`ofertare_doc_geometrii` cu document/licitatie, hash PDF/text/geometrie, versiune,
acoperire, cale, status și motive. Numele este propunere, nu tabel existent.
Metadatele și pointerul activ se publică atomic prin RPC cu verificarea
identității și lease-ului ingest. RLS aceleași limite de licitație/lot ca sursa,
linkuri temporare, fără bucket public. Rolurile și grants se testează separat.
Nu îngropăm sidecar-ul în `seap_meta` și nu încărcăm XML-ul întreg în fiecare
apel Edge. Index per pagină/felie pentru a limita transferul și memoria.

`ofertare-cantitati-extrage/handler.ts` transmite disponibilitatea/identitatea;
`structurat.ts` păstrează poarta `fn_ofertare_cb_text_valid`, selecția loturilor,
cererea și bugetul. `extractorIdContext` include și hash-ul geometriei, versiunea
algoritmului și modul dovezii. Orice schimbare invalidează cache-ul; rezultate
vechi rămân accesibile ca istoric, fără rescriere tăcută. Noul context nu trebuie
să amestece părți din același PDF cu text/sidecar din versiuni diferite.

Observația stocată primește într-un PR separat dovada geometrică (pagina,
regiune, rând, celule, bbox și hash artefact); `rand_interval` rămâne pentru
compatibilitate, dar un bloc geometric neliniar nu se falsifică printr-un singur
interval textual larg. UI-ul arată extrasul sursă și evidențiază celulele pentru
verificare. H2 „gata” nu pierde bifele umane până la acceptarea noii porți.

## PR-uri mici și verificări

| PR | Livrabil | Poartă înainte de pasul următor |
|---|---|---|
| C1 | Parser XML și schemă sidecar, funcții pure | Fixture sintetice, XXE refuzat, dimensiuni/rotații și UTF-16 corecte |
| C2 | Extracție CPU în worker, ambele căi PDF; mod umbră | Lease/timeouts, hash PDF, pagini lipsă, sursă schimbată; zero efect asupra textului activ |
| C3 | Resolver rând/coloane și comparație offline | DN63/DN110 și cele 6 contraexemple PR749; antete multilinii/preț vs cantitate; nicio promovare ambiguă |
| C4 | Metadata/storage/RPC/RLS/CAS, doar după aprobare | Izolare loturi/roluri, cache incompatibil refuzat, rollback pointer; fără ștergerea istoricului |
| C5 | Integrare normalizator/Edge și UI sursă | Regresii normalizator/structurat/Răcari, diferențe analizate, mod nou versionat |
| C6 | Pilot independent pe alte machete, apoi activare explicită | Set înghețat și adjudecat vizual, raport complet și decizie umană |

Setul de teste include: descriere deasupra/dedesubt; același cod pe pagini și
secțiuni diferite; articol fără număr; text în două coloane; celule unite/goale;
ultimă celulă fără separator markdown; UM pe alt rând; antete repetate și subsol;
preț/cantitate identice; cantitate zero vs gol; ligaturi/diacritice/exponenți;
PDF mixt, doar imagine, strat OCR invizibil greșit; crop și rotație; pagină
împărțită, offset global; XML întrerupt; două artefacte pe același hash text dar
PDF-uri diferite. Nicio referință generată din predicția modelului.

Raportăm pe pagini/rânduri: acoperire geometrică, asocieri corecte/greșite,
omisiuni, duplicate, nedovedite, diferențe față de legacy și erori tăcute,
separat de succesul tehnic. Pragurile campaniei OCR (≥99,5%, zero erori tăcute,
goale păstrate) nu constituie dovadă de acceptare a acestui algoritm încă
neimplementat; orice prag pentru C trebuie înghețat înaintea pilotului. Pentru
porți de siguranță: zero asocieri greșite promovate în fixture-urile negative.

## Riscuri și ce NU s-a verificat

Bbox dovedește poziția unui text extras, nu faptul că stratul PDF este corect
față de imagine. Scanurile cer OCR cu coordonate și proveniență separată, în
alt scope. Planșele tehnice nu devin liste de materiale certificate prin bbox.
Limitele de memorie/timp și performanța NAS/Poppler nu sunt măsurate aici.
Nu am rulat recitiri, testele Deno istorice, SQL, migrații, inferențe sau deploy.
Am verificat doar că planul indică fișiere/simboluri existente în main și am
citit §1.4 și PR749. Implementarea, acuratețea și integrarea rămân de testat.
