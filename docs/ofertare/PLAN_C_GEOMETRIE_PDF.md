# Plan C - geometria PDF ca validator independent

Revizia 2, 18.10.2026, dupa review Copilot/Gemini pentru PR761 (#023).
Doar analiza. Fara implementare, date reale, migrare, recitire sau deploy.

## Ordine si rol

Extractorul A se livreaza primul, prin propriul review si propria aprobare de
productie. C nu il blocheaza si nu ii inlocuieste textul: ruleaza in UMBRA,
independent de candidatii modelului. Ordine: C1 schema/parser, C2 adaptor worker,
C3 resolver offline, apoi pilot offline; NUMAI daca pilotul aduce valoare se
propun persistenta/RPC/RLS si integrarea Edge. Geometria este poarta suplimentara,
nu sursa de adevar si nu autorizeaza automat eliminarea bifei umane.

Starea verificata in main 0203e26: worker/ofertare/ingest.ts:textLocal ruleaza
pdfinfo si pdftotext -layout; imparteText/compuneText comprima spatii si adauga
marcaje. worker/ofertare/citire_mare.ts are calea pentru PDF-uri mari. Ambele
necesita adaptor, aceleasi limite/lease si identificare prin hash.
_shared/cantNumar.ts:blocRand/orientareDedesubt/umLanga lucreaza pe text;
cantNormalizare.ts verifica randul propus. structurat.ts are p3/n4/f1, nu p2/n3
mentionate in parti istorice ale documentatiei.

Context: docs/PIPELINE_CITIRE_DOCUMENTE.md sectiunea 1.4 si
https://github.com/gazpet-test/pontaj-pro/pull/749 (inclusiv r1-r6 si decizia finala).
Limite: DN al vecinului, descriere deasupra/dedesubt, cod ca subsir, pret confundat
cu cantitate, UM peste rand, ultima celula markdown fara separator. Bbox nu
rezolva automat aceste probleme; le face testabile spatial. Rezultatele istorice
din PR749 nu au fost reproduse in aceasta sarcina.

## Schema comuna: doua surse, un singur resolver

pdf-geometry-v1 accepta de la inceput `source=native_pdf|local_ocr_bbox`.
Adaptor Poppler: pdftotext -bbox-layout -enc UTF-8; -bbox simplu pentru diagnostic.
Adaptor OCR local: bbox LightOn/MinerU, numai daca versiunea concreta produce
coordonate verificabile. Suportul efectiv al acestor modele NU a fost verificat
in aceasta sarcina. Fara bbox, adaptorul raporteaza indisponibil, nu inventeaza.
Schema comuna nu inseamna incredere comuna: provenienta, model/revizie/prompt,
scoruri si limite se pastreaza separat pe pagina/regiune. Acelasi resolver primeste
schema, nu doua implementari paralele pentru randuri.

Identitate: pdf_sha256, document_id, versiuni motor/parser/resolver, argumente,
geometry_sha256, acoperire per pagina, timp si semnale. Pagina fizica 1-based,
pagina globala + pagina_offset, MediaBox/CropBox, rotatie si transformare catre
coordonate canonice (origine stanga sus, unitati pt, domeniul CropBox). Conventia
Poppler/OCR se verifica pe fixture si nu se presupune. Pentru OCR se pastreaza
transformarea inversa pixeli/rotire/deskew/tile -> pagina, inclusiv overlap.

Text literal + bbox de sursa + ID-uri; apoi celule si randuri derivate, tabel,
sectiune, rolul coloanei, bbox si motive de ambiguitate. Tokenii derivati pastreaza
lista fragmentelor sursa; forma normalizata de comparare nu rescrie originalul.
Bbox de cuvant nu este bbox de celula; celulele goale se disting de zero si de
absenta dovezii. Nu se fabrica text pentru a umple grila.

Parser XML fara DTD/entitati externe/retea, cu limite de octeti/pagini/noduri.
Validari: coordonate finite, domeniu, pagini lipsa, exit nenul/trunchiere, versiune
si hash. XML brut pastrat in pilot; in productie se poate aplica retentie limitata
aprobata, in timp ce sidecar-ul normalizat si provenienta raman imuabile.

## PDF sandwich si geometrie nesigura

Prezenta textului nu inseamna nativ de incredere. Inventarul foloseste
pdfimages -list ca indiciu de raster mare, plus inspectia efectiva a plasarii
imaginii si a text rendering mode (inclusiv mode 3 invizibil), pe pagina.
pdfimages -list singur NU dovedeste acoperirea paginii sau invizibilitatea textului.
Raster full-page + text invizibil/strat OCR => `text_layer_origin=embedded_ocr`,
`trust=unverified`; nu intra in cohorta native_pdf de incredere. Schema pastreaza
originea extragerii Poppler distincta de originea textului. Detectie neconcludenta
=> `sandwich_suspect`, fara promovare. Optional OCR local separat, fara amestec
sau vot automat. Font fara ToUnicode/PUA, text decalibrat sau suprapus => semnal.
Nici macar textul nativ vizibil nu este declarat adevar fara verificare pe sursa.

## Dovada: pagina / rand / coloana, nu offset obligatoriu

Accept propunerea Gemini de a elimina maparea UTF-16 ca PRECONDITIE a dovezii.
Identitatea dovezii este (pdf_sha, geometry_sha, pagina, tabel_id,
rand_geometric_id, rol_coloana, token_ids). Nu incercam aliniere fuzzy obligatorie
intre -layout si -bbox-layout ori intre un rezumat AI si XML.
Legatura unica exacta in text_extras, daca exista, ramane metadatum OPTIONAL pentru
UI, cu text_sha si unitati UTF-16 documentate. Lipsa ei nu invalideaza o dovada
geometrica, dar nici nu produce rand_interval fictiv. O mapare schimbata nu
reasociaza tacit istoricul. Normalizarea NBSP/ligaturi/diacritice/surrogate se
testeaza distinct, cu legatura la forma originala, fara a normaliza separatorii
cantitatilor pe baza presupunerilor.

Nu accept in aceasta faza propunerea de a inlocui textul trimis extractorului A
cu text reconstruit de C: ar altera extractorul si ar pierde independenta
pilotului. Modelul propune; resolverul identifica independent candidati geometrici.
Asocierea dintre rezultat A si C trebuie sa fie unica in aceeasi pagina/tabel,
cu cod/UM/cantitate si dovezi complete; egalitatea unui numar singur nu ajunge.
Ambiguitate => nedovedit, nu alegerea randului cel mai apropiat.

## Resolver si articole intre pagini

- Separa regiuni/tabele inainte de gruparea pe y. Antetele multilinii definesc
  intervale x pentru cod/descriere/UM/cantitate/pret/valoare. Celule unite,
  antete grafice/verticale sau roluri neclare => coloana_necertificata.
- Poppler <word> nu este unitate lexicala imuabila: fragmente adiacente doar in
  ACEEASI celula, apoi tokenizare lexicala versionata. Pastreaza delimitari si
  bbox sursa. `m1160.000`, `1160.` + `000`, cod cu sufix si spatii de mii au teste;
  nu lipeste celule vecine si nu transforma DN90 in cantitate.
- Descrierea deasupra/dedesubt se leaga numai cand delimitarea fata de vecini este
  unica; cod intreg, UM si cantitate in rolurile lor. DN din descrierea acelui
  articol, nu din vecin. Geometria nu decide conventia 3.995.
- Articol rupt la pagina: in prima versiune ramane `cross_page_ambiguous`, inclusiv
  sub antet repetat. Putem inregistra o legatura candidata daca paginile sunt
  consecutive, acelasi tabel/CropBox/scara, coloane aliniate, articolul precedent
  deschis si primul bloc urmator numai in descriere (fara cod/nr/UM/cantitate).
  Aceste conditii NU promoveaza dovada pana la regula testata pe cazuri negative.
  Fara lipire prin similitudine sau doar lipsa lui Total=.
- Fara antet pe pagina urmatoare: mostenirea x de la pagina anterioara ramane
  candidat necertificat. Toleranta +/-3 pt propusa de Gemini nu este adoptata
  ca fapt universal; trebuie calibrata si inghetata pe setul de dezvoltare.
- Fallback blocRand ramane etichetat legacy/dn_din_continuare, cu bifa umana.
  Nicio ambiguitate geometrica nu este promovata automat de fallback.

## Integrare numai dupa pilot

Pilot local: sidecar/manifest in directorul rularii, fara DB, fara text_extras nou.
Pas CPU separat de scripts/recitire_val1/citeste.ts (pilot AI cu buget); nu introducem
apeluri platite si nu ocolim fereastra de mentenanta. asambleaza.ts va putea raporta
comparativ, iar aplica.sql/aplica_rezultat.sql trebuie sa pastreze CAS pe identitate.

Dupa decizie: storage privat cu sidecar imutabil, metadata propusa
ofertare_doc_geometrii (NU exista prin acest plan), pointer activ publicat atomic
cu lease/hash PDF. RLS pe aceeasi licitatie/lot, grants minime, fara bucket public.
Edge citeste subset per pagina/felie, nu XML integral. handler.ts/structurat.ts
pastreaza poarta fn_ofertare_cb_text_valid, cererea, bugetul, loturile. Resolver
optional separat de blocRand; dovada noua stocata explicit, fara interval textual
inventat. extractorIdContext include geometrie/sursa/model/algoritm si manifestul
partilor; invalidare cache la orice modificare. UI arata pagina/celulele si limitele.
Stocarea si integrarea nu sunt aprobate implicit prin acest document.

## Patru PR-uri, cu pilot INAINTE de DB/Edge

| PR | Continut | Poarta |
|---|---|---|
| C1 | Schema comuna, parser/adaptoare si resolver pur (C1+C3 logic) | sintetice + contraexemple PR749, doua proveniente, ambiguitate refuzata |
| C2 | Worker ambele cai, CPU in umbra | limite/lease/hash, zero schimbari text activ, scan/sandwich separate |
| C3 | Pilot offline independent, artefacte si raport | valoare masurata si decizie umana inainte de integrare |
| C4 | Propunere storage/RPC/RLS + Edge/UI | review separat schema/securitate, CAS/cache/rollback, activare explicita |

Comasez parserul/resolverul si stocarea/integrarea, dar RESPING pilotul pus dupa
DB/Edge in ordinea Gemini. Componentele C1-C2-C3 din descrierea initiala raman
pasi logici, chiar daca primesc alt ambalaj de PR. Nu adopt estimari 1-2 zile,
procente SEAP 60-70% sau costuri din review ca rezultate masurate aici.

## Acceptare separata si teste

Seturi distincte dezvoltare/test inghetat, alte machete, referinte verificate
vizual independent de model. Denominatoare per sursa si categorie, fara selectie
post-hoc a celor reusite. Pilotul raporteaza:

1. ZERO asocieri gresite promovate pe setul evaluat si toate contraexemplele.
2. Recall geometric = randuri eligibile confirmate corect / toate randurile
   eligibile din referinta independenta; prag numeric stabilit INAINTE de pilot.
3. % coloana_necertificata = randuri cu rol incert / randuri eligibile, separat
   de alte ambiguitati; plafon stabilit inainte de pilot.
4. Diferenta fata de legacy/A: rezolvari noi corecte, regresii, omisiuni, duplicate,
   erori tacite, timp/memorie si volum sidecar; nu doar o acuratete agregata.

Nu inventam acum praguri de recall fara inventarul setului; fara pragurile
preinregistrate nu exista GO pentru activare. 99,5% din campania OCR nu certifica C.

Fixture: cele sase contraexemple PR749, DN63/DN110, descriere sus/jos, numere/coduri
repetate in sectiuni, antete absente/repetate, articol peste pagina, pret=cantitate,
gol vs zero, celule unite, UM peste rand, text local rotit, 0/90/180/270,
CropBox != MediaBox, transformare tile/deskew, NBSP, ligaturi, Unicode decomposed,
surrogate pairs, font ToUnicode lipsa/PUA, sandwich cu text gresit dar bbox plauzibil,
XML trunchiat/XXE, sursa schimbata, cache vechi, selectie loturi/RLS.

## Ce NU s-a verificat

Nicio executie Poppler/OCR/SQL sau test pe documente reale in acest branch.
Nu am masurat ponderea scanurilor, acuratetea, recall-ul, viteza sau memoria C.
Nu am verificat bbox disponibile in versiunile LightOn/MinerU instalate.
Referintele de cod si istoricul au fost citite; planul nu este implementare.
Geometria nu interpreteaza scheme de montaj si nu certifica listele de materiale.

## Conditii din review r2 (Copilot + Gemini, 18.10.2026) — obligatorii in C1
- **Provenienta raster pentru `local_ocr_bbox`**: pe langa `pdf_sha256`, se pastreaza hash-ul imaginii exacte pe care a rulat OCR-ul (pagina/banda/tile) si parametrii de randare (dpi, rotire, deskew, decupaj), ca dovada sa poata fi refacuta pe aceiasi pixeli.
- **Regula canonica pentru `geometry_sha256`**: serializare stabila (chei sortate, ordine determinista a paginilor/tokenilor, numere cu precizie fixa), fara timestamp-uri, cai sau alte campuri volatile; regula si versiunea ei se scriu in schema inainte de prima implementare.
- **Imperecherea A <-> C cand acelasi (cod, UM, cantitate) apare legal de doua ori pe aceeasi pagina** (subcapitole/tronsoane): cheia de imperechere include pozitia (rand geometric / Y) si contextul de subcapitol, ca sa nu devina ambiguitate falsa.
- C1 se implementeaza cu commit-uri si teste separabile pentru parser vs resolver.
