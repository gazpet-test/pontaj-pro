# A doua opinie — S09 / S10 / S12

Data: 28.09.2026. Contract citit întâi: `00_PLAN_SI_FIXTURE.md`; baseline: `RESTANTE_AUDIT_OFERTARE.md`, secțiunea „28.09.2026 — Auditul de cod R01–R17”. Audit local, static, fără git, producție, chei, mailuri sau modificări de aplicație. Nu certifică schema ori deploy-ul live. Numerele de mai jos sunt linii din copia locală.

**Verdict:** codul disponibil nu demonstrează criteriile 8–10 din plan. Există căi distincte pentru statusul licitației, starea pachetului și verdictul porții. Hash-ul citit înapoi în browser este util, dar nu este verificare de server. Mai grav, politicile permisive UPDATE ale pachetului permit combinarea condițiilor dintre tranziții: protecția Storage depinde de o stare care poate fi retrogradată.

Reproducerile SQL/API de mai jos sunt **scenarii de rulat exclusiv local / sandbox autorizat**, nu comenzi executate pe date reale. Identificatori simbolici: `L` = licitația-clonă; `P` = pachetul ei; `C` = cerință a clonei; `U` = utilizator cu modul, non-owner; `N` = utilizator fără modul; UUID-ul lui `V` = alt profil existent. Pentru aprobări, se pornește dintr-un fixture fără blocaj de documentație / R5, ca să se izoleze defectul.

## Constatări în formatul §5

### JAK-V2-01 · S09/S12 · 7/9 · rls/storage · BYPASS

**Titlu:** politicile UPDATE permit dezghețarea pachetului și sărirea aprobării semnate.

**Scenariu reproductibil:** (a) cu JWT `U`, pe `P` aprobat, PATCH `stare='propus'`; înlocuiește obiectul din manifest prin Storage; reaprobă pachetul. (b) pe `P` propus, inserează rânduri `depus_final` și `dovada_seap`, apoi PATCH direct `stare='depus', aprobat_de=V, aprobat_la=<data>`. Nu este nevoie ca `V=U`.

**Dovadă:** `supabase/migrations/20260913_ofertare_pt_pachet_manifest.sql:58` păstrează politica `ofertare_pt_pachet_depune`, cu USING `aprobat`, CHECK `depus`; `20260928h_ofertare_pachet_poarta_r12.sql:10` definește cealaltă politică cu USING `propus`, CHECK `propus OR (aprobat AND aprobat_de=auth.uid())`. Politicile sunt PERMISSIVE: USING-urile se combină între ele cu OR, separat de CHECK-uri. Așadar vechi `aprobat` satisface prima politică, nou `propus` satisface a doua. `20260928m_r07_r12_copilot.sql:31` îngheață obiectul numai cât pachetul are stare `aprobat/depus`; politicile Storage de la liniile 42–47 consultă această funcție. CHECK-ul tabelului de la `20260913_ofertare_pt_pachet_manifest.sql:21` cere semnătură nenulă la depus, nu identitatea apelantului. Triggerul R11 de la `20260928k_ofertare_pachet_depus_r11.sql:17` nu verifică OLD.stare=`aprobat`.

**Severitate:** critică — bypass al aprobării și identitate de bytes pierdută fără versiune nouă.

**Test necesar / existent:** PostgreSQL real, rol `authenticated`, ambele politici instalate simultan: `aprobat→propus`, `propus→depus`, schimbare de `aprobat_de` la depunere trebuie refuzate; testul Storage trebuie repetat după tentativa de retrogradare. Niciun test al acestui scenariu combinat identificat; nu a fost executat aici.

**Fix minim:** trigger de tranziții cu OLD/NEW, semnare server-side și imuabilitate a coloanelor după aprobare; RLS singur nu poate împerechea USING-ul unei politici cu CHECK-ul aceleiași politici. Înghețul trebuie să rămână adevărat pentru un obiect deja aprobat, indiferent de tranzițiile ulterioare.

**Relație audit vechi:** incomplet:R12, nu repetarea cazului vechi „INSERT direct aprobat”. **Verdict adversarial:** valid static; triggerul de completitudine/R5 verifică sursele, nu tranziția înapoi. Exploatabilitatea live rămâne de confirmat pe lista completă a triggerelor live.

### JAK-V2-02 · S09 · 7/9 · trigger/rls/ui · BYPASS

**Titlu:** `depus` verifică existența rolurilor, nu existența obiectelor și hash-ul lor.

**Scenariu:** `U` adaugă la `P` aprobat două rânduri de manifest cu rolurile obligatorii, `sha256=repeat('a',64)`, nume distincte, `fisier_path=NULL` (sau cale inexistentă), apoi marchează depus. Pentru fixture fără blocaje independente, condițiile R11 sunt satisfăcute fără upload.

**Dovadă:** `20260913_ofertare_pt_pachet_manifest.sql:34` validează doar forma SHA; linia 35 permite cale NULL. `20260928k_ofertare_pachet_depus_r11.sql:8` permite inserarea rolurilor la aprobat; liniile 18 și 21 fac numai EXISTS pe rol. `src/OfertarePropunere.jsx:1884` descarcă fișierul în **browser**, iar linia 1888 trimite hash-ul declarat prin client. `aprobaPachet`, linia 1826, calculează hash înaintea uploadului fără read-back la aprobare.

**Severitate:** critică — pachet depus fără artefact demonstrat.

**Test necesar / existent:** PATCH prin PostgREST cu obiect absent, cale NULL, hash greșit și hash corect; numai ultimul caz poate trece după citire server. Există implementarea read-back UI R11, nu verificarea server identificată în cod. Niciun apel live efectuat.

**Fix minim:** endpoint autorizat care citește bytes din bucket, calculează hash, validează manifestul și marchează depus; interzicerea scrierii directe în câmpurile care certifică verificarea. Calea obligatorie singură nu rezolvă hash-ul fals.

**Relație:** incomplet:R11. **Verdict adversarial:** verificarea UI nu apără apelul direct cu JWT; regex-ul SHA nu dovedește conținutul. Nu se afirmă că un fișier încărcat normal este corupt.

### JAK-V2-03 · S09 · 9 · trigger · MISSING_LINK

**Titlu:** statusul licitației `depusa` nu cere pachet `depus`.

**Scenariu:** `L` are cerințe confirmate, acoperiri verificate și surse R5 rezolvate, dar niciun pachet; PATCH licitația în `depusa`, fără derogare. Variantă: licitație fără cerințe, pentru a verifica și agregările vide.

**Dovadă:** întregul corp `supabase/migrations/20260928f_gate_depunere_r07.sql:7` verifică cerințe, documente de firmă, reverificări și `ofertare_r5_blocaj_sursa`; nu citește `ofertare_pt_pachet`. Modificările `20260928m_r07_r12_copilot.sql:15` și `20260928n_gate_depunere_r06.sql:7` întăresc derogarea și scanul, fără legătură cu pachetul. În sens invers, `src/OfertarePropunere.jsx:1894` actualizează pachetul, fără statusul licitației.

**Severitate:** critică pentru criteriul 9 al planului; veriga lipsă este demonstrată static, acceptarea live a PATCH-ului este nedeterminată fără schema live.

**Test necesar / existent:** test de tranziție fără pachet / cu aprobat / cu depus; trebuie acceptat numai depus valid. Nu a fost rulat aici. **Fix minim:** poartă server care cere un pachet depus al aceleiași licitații, cu identitatea verificată; tratează explicit înregistrarea unei depuneri externe istorice.

**Relație:** nou; R07/R06 rămân corecte pe condițiile pe care le verifică. **Verdict adversarial:** nu confundăm `depus` al pachetului cu `depusa` al licitației; o altă funcție live absentă din repo ar putea închide legătura, de verificat înainte de declararea unui exploit live.

### JAK-V2-04 · S09/S12 · 4/5/6/7 · ui/sql_fn/rls · BYPASS

**Titlu:** poarta completă PT este în JavaScript; serverul pachetului verifică un subset.

**Scenariu:** păstrează documentația/R5 fără blocaj, dar un capitol obligatoriu gol, o legătură neverificată sau o anexă lipsă; `U` creează și aprobă pachet prin API direct. Separat, inserează `ofertare_pt_poarta` cu verdict favorabil și snapshot furnizat de client.

**Dovadă:** `src/ofertarePoarta.js:28`, `:53`, `:101`, `:191`, `:195` au controalele de cuprins, verificări, capitole/anexe/grafic; `src/OfertarePropunere.jsx:1813` și `:1938` le aplică în UI. Corpul server de referință `docs/R5_MIGRARE_3_review_copilot.sql:206` verifică numai `v_ofertare_seap_completitudine` și R5. `20260912_ofertare_propunere_tehnica_v1.sql:139` permite INSERT în poartă cu acces modul; `20260928h...sql:13` elimină UPDATE/DELETE, nu INSERT-ul cu snapshot declarat. Pachetul este creat cu `pt_poarta_id:null` la `OfertarePropunere.jsx:1837`.

**Severitate:** critică — verdict favorabil / pachet aprobat prin ocolirea controalelor de depunere.

**Test necesar / existent:** matrice JS↔SQL pentru fiecare rând `block`, apel direct pe tabel și snapshot fals; teste JS existente `src/ofertarePoarta.test.js`, dar nu dovedesc SQL. **Fix minim:** evaluator server unic, snapshot și actor produse server-side într-o operație atomică; legarea pachetului de evaluarea și versiunile aprobate.

**Relație:** incomplet:R12/R13; nu redeschide comportamentul JS reparat în R13. **Verdict adversarial:** completitudinea SEAP și R5 sunt protejate server-side; nu afirmăm absența tuturor porților. Corpusul SQL aplicat din `docs/` este necesar: doar migrațiile nu reconstruiesc live.

### JAK-V2-05 · S10 · X · vercel_api/edge · BYPASS

**Titlu:** o sesiune validă fără modul poate folosi rute privilegiate de scriere.

**Scenariu:** cu `N`, trimite cererea normală pentru documentul `D` din clonă la `api/pdf-sparge` ori `api/plansa-felii`; compară documentele, `analiza` și Storage. Pentru Edge `ofertare-word-text`, trimite `doc_id=D,dry_run=false`. Separat, testează autorizarea rutelor de mail doar cu transportul mail simulat, fără mail real.

**Dovadă:** toate verifică `getUser` fără modul înaintea clientului service: `api/seap-import.js:129` / `:140`, `api/pdf-sparge.js:25` / `:33`, `api/plansa-felii.js:169` / `:180`, `api/cad-parse.js:47` / `:59`. Efecte concrete: `pdf-sparge.js:84` / `:95` inserează copii și schimbă documentul-sursă; `cad-parse.js:134` scrie cantități; `seap-import.js:178` scrie manifest. Edge: `ofertare-word-text/index.ts:97` și `:154`; `ofertare-verificare-finala/index.ts:53` și `:135`; `ofertare-garantie-mail/index.ts:31` și `:92`; `ofertare-etapa1-mail/index.ts:48`; `ofertare-radar-scan/index.ts:93`; `ofertare-seap-import/index.ts:340`; `ofertare-seap-veghe/index.ts:246`; `ofertare-clarificare-citeste/index.ts:36`.

**Severitate:** mare — acces și scriere în modul fără drept, cost și trimitere externă posibile; fără a pretinde o depunere falsă demonstrată prin aceste rute.

**Test necesar / existent:** pentru fiecare rută: anonim, user fără modul, editor, responsabil, owner; absența oricărui efect înainte de 403. Niciun test complet al acestei matrice identificat. **Fix minim:** autentificare + acces explicit la modul, apoi poarta suplimentară pe cost/decizie, înaintea Storage/AI/mutațiilor; nu este suficient RLS când operațiile folosesc service_role.

**Relație:** nou; R01 a reparat `clarificare-aplica`, nu întreaga familie. **Verdict adversarial:** `getUser` respinge anon/invalid pe aceste ramuri; problema demonstrată este utilizatorul autentic fără modul. Secretul intern nu este cunoscut și nu a fost folosit.

### JAK-V2-06 · S10 · X · edge/ci · BYPASS

**Titlu:** trei endpointuri AI nu au gardă în handler; trierea continuă și fără identitate.

**Scenariu:** pe funcții locale cu servicii simulate, invocă `ofertare-e0-autofill` cu `path` valid, `ofertare-inventar-ai` / `ofertare-citire-test` cu `doc_id=D`, ca `N` și cu cheia publică anon; numără accesările Storage/AI. Pentru triere, returnează user NULL din mock și verifică faptul că fluxul continuă.

**Dovadă:** `ofertare-e0-autofill/index.ts:51`–63, `ofertare-inventar-ai/index.ts:52`–69, `ofertare-citire-test/index.ts:37`–49 creează service client și procesează body fără autorizare. `ofertare-triere/index.ts:435`–441 ignoră absența userului și `:573` scrie upsert. `.github/workflows/deploy-edge-function.yml:66` nu pune aceste patru nume în NO_JWT: există verificarea gateway, nu verificarea dreptului de modul.

**Severitate:** mare — cost neautorizat și citire de documente prin service_role. **Test necesar / existent:** handler + gateway local, rol anon valid, JWT `N`, lipsă JWT; niciun test executat aici. **Fix minim:** gardă explicită în handler, rolul de cheltuială și accesul la document, înaintea descărcării; testele auxiliare de citire restrânse la apelant intern verificat.

**Relație:** nou. **Verdict adversarial:** un request fără token poate fi oprit de gateway; nu declarăm endpointurile deschise pe internet fără JWT. Un JWT valid de utilizator fără modul nu este refuzat de codul analizat. Acceptarea tokenului anon în gateway-ul deployat rămâne de măsurat.

### JAK-V2-07 · S10 · X · rls/grant · BYPASS

**Titlu:** unele tabele ale modulului acordă scriere oricărui utilizator autentificat.

**Scenariu:** cu `N`, INSERT/UPDATE/DELETE pe `ofertare_triere` pentru `L`; repetă pe solicitările AC, punctele și anexele clonei.

**Dovadă:** `supabase/migrations/20260914_ofertare_triere.sql:20` acordă DML la authenticated; linia 25, politica ALL cere numai `auth.uid() IS NOT NULL`. `20260914_ofertare_solicitari_ac.sql:66`–68 are același predicat pe cele trei tabele. Nu s-a identificat în migrațiile ulterioare înlocuirea acestor politici. În schimb, `20260912_ofertare_reverificare_si_rls_scriere.sql:74`–89 separă citirea autentificată de scrierea cu modul pentru cerințe/acoperiri/documente.

**Severitate:** mare. **Test necesar / existent:** PostgREST cu `N` trebuie să nu poată scrie; read-back din alt cont pentru a nu confunda zero rânduri cu succes. Neexecutat. **Fix minim:** politici cu `fn_are_acces_ofertare()` și verificarea tuturor politicilor permisive existente; drepturile efective se verifică din catalogul live înainte de migrare.

**Relație:** nou. **Verdict adversarial:** nu există aici dovadă că anon poate scrie — `auth.uid()` NULL nu trece aceste politici. Citirea largă este separată de scriere și nu este prezentată drept defect nou critic.

### JAK-V2-08 · S12 · 3/5 · edge/ui · FALSE_GREEN

**Titlu:** verificarea finală numește acoperirea AI „dovadă legată”, fără verificarea umană R06.

**Scenariu:** `C` confirmată, singura acoperire `status='acoperit', verificat_pe_scan=false` (sau `reverificare_ceruta=true`); rulează constructorul verificării finale cu AI simulat verde. Raportul A declară zero neacoperite și payload-ul B spune `acoperita:true`.

**Dovadă:** `ofertare-verificare-finala/index.ts:73` nu selectează verificarea pe scan / reverificarea; `:77` și `:104` acceptă numai statusul; `:111` îl descrie „are dovada legata”. `:129`–136 degradează verdele pentru formulare, nu pentru R06. UI arată „VERDE — nimic în neregulă în registrul extras” la `src/OfertareLicitatii.jsx:3506` și `:4657`. Gate-ul real R06 cere scan și fără reverificare în `20260928n_gate_depunere_r06.sql:15`.

**Severitate:** mare — fals verde în verificare, nu bypass dovedit al gate-ului R06. **Test necesar / existent:** aceeași fixture evaluată de constructor și gate trebuie să identifice dovada propusă; mock AI verde nu trebuie să o ascundă. Nu a fost rulat aici. **Fix minim:** aceeași definiție server a dovezii pentru constructor, prompt și verdict; amprentă a stării/versiunilor analizate.

**Relație:** incomplet:R06; R14 este păstrat (UI nu mai promite verificarea pachetului final). **Verdict adversarial:** verdictul AI efectiv este nedeterminist, deci nu susținem că va fi mereu verde; intrarea deterministă eronată și lipsa corecției în cod sunt certe.

### JAK-V2-09 · S09/S12 · 6/7/9 · ui · PARTIAL

**Titlu:** manifestul fără anexe poate rămâne galben chiar la `depus`; absența pachetului dă `ok` pe controlul local.

**Scenariu:** `controlPachetComplet({anexe_asteptate:['Formular 9','Formular 23']})` → `ok`. Cu `pachet_stare:'depus'` și două fișiere numite `oferta.pdf` / `confirmare.pdf`, rolurile `depus_final` / `dovada_seap`, fără `anexa_ref` → `warn`, `lipsa:[]`. `controlGraficSursa({pachet_fisiere:[]},{final:true})` → `ok`.

**Dovadă:** `src/ofertareControale.js:667`, `:674`, `:784`; `src/ofertarePoarta.js:191` și `:195` folosesc aceste rezultate. `src/OfertarePropunere.jsx:1822` generează numai PT și borderou; `inregistreazaDepunere` la `:1872` nu reevaluează completitudinea înainte de marcare.

**Severitate:** mare — lipsurile obligatorii nu devin blocaj final; eticheta `ok` la lipsa pachetului este locală, nu dovadă că întreaga poartă ar fi verde.

**Test necesar / existent:** **executat local cu Node**, import direct al funcțiilor pure; rezultatele de mai sus confirmate. Există `src/ofertareControale.test.js`, nu certifică poarta server. Adaugă teste distincte draft/aprobare/depunere și identificare explicită a anexelor din PDF-ul final.

**Fix minim:** separarea controlului draft de verificarea finală obligatorie; la depunere lipsa identificării fiecărei piese este `nedeterminat/block`, cu locatori în fișier, nu acceptare pe numele fișierului.

**Relație:** restanță manifest complet; incomplet:R13 pentru lipsa piesei, nu pentru piesa prezentă cu sursă greșită. **Verdict adversarial:** `oferta.pdf` poate conține anexele; nu spunem că lipsesc în document, ci că includerea nu este demonstrată. Niciun PDF nu a fost creat/citit în acest test.

### JAK-V2-10 · S09/S12 · 5/7 · ui/trigger · MISSING_LINK

**Titlu:** un pachet depășit poate fi înregistrat depus fără verificarea versiunilor curente.

**Scenariu:** aprobă `P`, modifică un capitol sau îngheață altă versiune de grafic, apoi folosește „înregistrează depunerea” pe `P`; selectează fișiere finale și dovadă. Varianta API nu depinde de UI.

**Dovadă:** `src/ofertarePachet.js:68` verifică numai amprenta capitolelor și întoarce NULL dacă lipsește; `src/OfertarePropunere.jsx:2128` afișează formularul pentru orice pachet aprobat; `:1872` verifică doar selecția fișierelor. Triggerul `20260928k...sql:17` nu compară capitole/grafic/poartă. `docs/R5_MIGRARE_3_review_copilot.sql:206` nu adaugă verificarea acestor versiuni.

**Severitate:** mare — versiunea verificată nu este legată server de versiunea depusă. **Test necesar / existent:** două sesiuni, schimbare capitol după aprobare, schimbare grafic și resetare cerință; depunerea vechiului pachet trebuie să ceară revizie/excepție explicită. Neexecutat. **Fix minim:** amprente server pentru toate dependențele aprobării și verificare atomică la depunere.

**Relație:** incomplet:R08/R13; invalidarea legăturii la editare rămâne corectă, legătura cu depunerea lipsește. **Verdict adversarial:** păstrarea vechiului pachet în istoric este necesară; defectul nu este existența lui, ci certificarea fără reverificare.

### JAK-V2-11 · S09/S10 · 3/7/9 · trigger/rls · MATCH

**Titlu:** reparațiile R06/R07/R11/R12 există pentru cazurile lor directe.

**Scenarii:** AI neverificat nu acoperă cerința în gate; non-owner încearcă să seteze derogarea; INSERT direct `aprobat`; UPDATE/DELETE pe evaluarea porții; depunere fără unul dintre cele două roluri; înlocuire directă de obiect cât pachetul rămâne aprobat.

**Dovadă:** `20260928n_gate_depunere_r06.sql:15`; `20260928m_r07_r12_copilot.sql:10`; `20260928h_ofertare_pachet_poarta_r12.sql:7` și `:13`; `20260928k_ofertare_pachet_depus_r11.sql:18`; `20260928m...sql:42`. `fn_are_acces_ofertare()` la `20260912_ofertare_acces_fara_parametru.sql:10` cere owner sau intrare explicită modul.

**Severitate:** info. **Test necesar / existent:** baseline declară teste rollback/live în registrul R01–R17; acestea nu au fost rerulate aici. **Fix minim:** niciun fix pentru cazurile directe; extinderea scenariilor la combinațiile JAK-V2-01/02/04. **Relație:** cunoscut:R06/R07/R11/R12 închis pe scenariile documentate. **Verdict adversarial:** MATCH static, nu certificat live și nu exclude bypass-urile combinate.

### JAK-V2-12 · S10 · X · schema/grant/ci · UNDETERMINED

**Titlu:** repo-ul nu poate demonstra drepturile efective anon și toate triggerele live.

**Scenariu:** construiește inventarul efectiv `pg_policies`, `relrowsecurity`, `pg_class.relacl`, `pg_proc.proacl`, `pg_trigger`, definiții view și setările deploy pentru toate `ofertare_*`; compară cu repo fără a aplica migrări.

**Dovadă:** scripturile `docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql:222` și `:228` cer obiecte live deja existente; migrarea `20260928f...sql:7` redefinește funcția gate fără să creeze triggerul inițial. `.github/workflows/deploy-edge-function.yml:66` este o listă derivată din live la 25.09, nu starea live citită azi. Pe obiectele noi există revocări explicite: `20260923_p0a_source_pack_post_apply.sql:6` și `20260912_ofertare_propunere_tehnica_v1.sql:122`; acestea nu inventariază automat toate tabelele istorice.

**Severitate:** medie — limită de demonstrabilitate, nu vulnerabilitate anonimă declarată. **Test necesar / existent:** export autorizat read-only al catalogului, probe PostgREST cu rolurile reale; nefăcute. **Fix minim:** păstrarea unui snapshot de schemă/ACL sanitizat pentru harness, separat de migrări deja aplicate; niciun fix de producție în audit.

**Relație:** restanță de fidelitate repo/live din plan §3. **Verdict adversarial:** „nu am găsit în repo” nu înseamnă „nu există live”; toate exploiturile propuse sunt condiționate explicit de schema analizată.

## Inventarul tuturor entrypoint-urilor Edge Ofertare

Au fost inventariate cele 29 de `supabase/functions/ofertare-*/index.ts`, inclusiv cele două care deleagă în `handler.ts`. Toate căile de mai jos folosesc client privilegiat pentru operațiile principale. „Intern” înseamnă secret validat/comparație cu cheia internă, nu cheia publică anon. Nu s-au citit valori din mediu sau Vault.

| Funcție | Gardă observată și reper | Ce nu demonstrează |
|---|---|---|
| acoperire | `index.ts:54`, JWT owner/responsabil; anon refuzat în apelul de la :86 | comparația `rol==='service_role'` decodat local depinde de JWT verificat de gateway |
| alerte-mail | `index.ts:34`, secret radar via RPC | existența unui secret nu dovedește politica destinatarilor |
| cantitati-extrage | `index.ts:2` → `handler.ts:198`, `:216`, secret intern sau JWT owner/responsabil | acces modul distinct nu este verificat pentru responsabil |
| cerinte | `index.ts:16`, owner/responsabil; anon acceptat când coada este activă | coada activă este autorizație reutilizabilă pentru apeluri anon, de testat retry/rate |
| citire-test | `index.ts:37`, fără gardă handler | JAK-V2-06 |
| clarificare-aplica | `index.ts:40`, `:44`, JWT + RPC modul sau secret; doar propunere | R01 închis; nu substituie autorizația pe celelalte funcții |
| clarificare-citeste | `index.ts:36`, JWT simplu sau secret radar | JAK-V2-05 |
| clarificari-propune | `index.ts:10`, owner/responsabil, service | gardă de modul distinctă absentă |
| clauze-formulare | `index.ts:43`, owner/responsabil, service | gardă de modul distinctă absentă |
| document-nou-citeste | `index.ts:64`, `:66`, JWT + modul sau secret | protecție explicită bună pe ramura utilizator |
| e0-autofill | `index.ts:51`, fără gardă handler | JAK-V2-06 |
| etapa1-mail | `index.ts:48`, JWT simplu sau secret | JAK-V2-05; selectarea echipei la :61 nu autorizează apelantul |
| fisier-semnat | `index.ts:34`, RPC secret dedicat, acceptă ID-uri, nu căi libere | nu este endpoint de verificare hash al pachetului |
| garantie-mail | `index.ts:31`, JWT simplu | JAK-V2-05; scriere și mail cu service |
| genereaza-capitol | `index.ts:195`, owner/responsabil, service | nu validează întregul pachet |
| ingest-doc | `index.ts:97`, owner/responsabil, service sau anon cu coadă activă | retry anonim trebuie verificat la stratul coadă |
| inventar-ai | `index.ts:52`, fără gardă handler | JAK-V2-06 |
| organigrama-spec | `index.ts:35`, owner/responsabil, service | R16 nu închide autorizarea modulului în ansamblu |
| participari-import | `index.ts:86`, secret radar | anon fără secret nu este autorizat de handler |
| plansa-citeste | `index.ts:2` → `handler.ts:1980`, JWT verificat / cheie internă exactă; :2004 owner/responsabil | teste de cost existente, nu dovadă pentru API-ul de tăiere |
| radar-scan | `index.ts:93`, JWT simplu sau secret | JAK-V2-05 |
| raspuns-set | `index.ts:95`, `:101`, JWT + owner/modul | gardă explicită, nu permis doar pentru că JWT există |
| rfq-import | `index.ts:31`, owner sau responsabilul licitației RFQ, service | nu se reduce corect la simplu „toți utilizatorii” |
| rfq-inbox | `index.ts:28`, secret inbox din env, verificat înaintea service | secret absent/gresit refuzat |
| seap-import | `index.ts:340`, secret sau JWT simplu (cheie service exactă exceptată) | JAK-V2-05 |
| seap-veghe | `index.ts:239`, secret veghe sau JWT simplu (service exceptat) | JAK-V2-05 |
| triere | `index.ts:435`, identitatea este doar metadata opțională | JAK-V2-06 |
| verificare-finala | `index.ts:53`, secret sau JWT simplu | JAK-V2-05/08 |
| word-text | `index.ts:97`, secret sau JWT simplu | JAK-V2-05 |

Numărul de 29 a fost verificat pe fișierele locale; nu se deduce din numărul total de Edge Functions din producție.

Lista NO_JWT este la workflow linia 66: alerte-mail, cantitati-extrage, document-nou-citeste, etapa1-mail, fisier-semnat, garantie-mail, participari-import, radar-scan, rfq-inbox, seap-veghe, verificare-finala, word-text. Toate au autentificare proprie în cod; mai multe au numai sesiune, nu autorizare pe modul. Funcțiile cu `rol==='service_role'` decodat fără verificare criptografică NU apar în această listă; nu raportăm falsificarea JWT ca exploit demonstrat azi, dar eliminarea verificării gateway la un deploy ulterior ar schimba evaluarea.

## Acoperirea api/*.js și politicilor

Endpointurile Ofertare `seap-import`, `pdf-sparge`, `plansa-felii`, `cad-parse` intră în JAK-V2-05. Celelalte endpointuri: `hr-drive-import.js:80` are aceeași gardă JWT simplu/secret (în afara domeniului Ofertare); `hr-fise-import.js:38` acceptă numai secretul dedicat. Nu au fost invocate.

Fișierele `_cas`, `_dxf`, `_manifest`, `_cadCantitate`, `_p7s`, `_randare-pdf`, `_hr_fise`, `_hr_clasificare`, `_google`, `_cantitatiInvalidare` sunt helperi importați, fără handler HTTP default; `_cadCantitate.test.js` este test. Nu li se atribuie fictiv un endpoint public ori o gardă proprie. Rutele apelante stabilesc autorizația.

Scanarea migrațiilor pentru RLS/GRANT a găsit: familia PT/source-pack/raspuns-set cu revocări anon și `security_invoker`; scrierea cerințe/acoperiri/documente cu modul, citirea permisă tuturor autentificaților; clauze/formulare/parteneri-documente cu modul; excepțiile de scriere documentate în JAK-V2-07. Funcția `fn_are_acces_ofertare()` are `SECURITY DEFINER`, `search_path` fix și EXECUTE revocat PUBLIC/anon. Absența unui export complet live limitează verdictul general pe tabelele istorice — JAK-V2-12.

## Acoperirea semantică S12 și baseline

Au fost căutate etichetele `verde/ok/verificat/complet/gata/blocat` în `src/Ofertare*.jsx` și `src/ofertare*.js`, apoi urmărite căile relevante de aprobare/depunere în SQL. Culorile decorative și toast-urile de salvare nu sunt tratate automat ca verdict de conformitate.

| Suprafață | Evaluare |
|---|---|
| Matrice PT: verificată numai la versiunea curentă (`OfertarePropunere.jsx:432`) | MATCH static R08/R09; veriga către depunere rămâne JAK-V2-10 |
| Poartă null / completitudine indisponibilă (`ofertarePoarta.js:23`, `:70`, `:85`) | MATCH: lipsa controlului blochează, nu zero |
| Acoperiri verificate / propuse (`OfertareLicitatii.jsx:2889`, `:2920`, `:2924`) | PARTIAL: scanul are marcaj separat, statusul simplu rămâne „acoperit”; nu-l confundăm cu dovadă aprobată |
| Verificarea finală (`OfertareLicitatii.jsx:3506`, `:4657`) | R14 păstrat; divergență R06 în constructor, JAK-V2-08 |
| Pachet complet și sursa graficului (`ofertareControale.js:617`, `:781`) | JAK-V2-09; R13 reparat pentru piesa prezentă fără sursă, nu pentru manifest absent |
| Clarificări fără efect (`OfertareLicitatii.jsx:1664`) | MATCH static R02: analiza incompletă afișată ca nedeterminată |
| Cantități/revizii/transfer (`ofertareControale.js:131`, `ofertareTransferRestante.js:42`) | blocaj la indisponibil / conflict; nu redeschidem R10 și R5 din simpla culoare |
| Garanție termen curent (`OfertareLicitatii.jsx:3493`, `:3574`) | semnalul de reverificare păstrat; business/date poliță neauditate aici |
| Inventar/citire/lanț probator | rezultate locale nu dovedesc pachetul final; R15/R17 nu sunt raportate ca defect nou |

R01–R05, R08–R10, R14–R17 nu sunt republicate ca vulnerabilități vechi. R06/R11/R12/R13 apar numai cu calea suplimentară/incompletă explicită; R07 este MATCH pe protecția derogării. Nu s-a reconfirmat situația comercială a unei licitații reale.

## Validare și limite

Executat: lectură statică a entrypoint-urilor și gardelor, scan migrații/SQL din docs, parcurgere UI→server pentru S09, test Node al celor trei rezultate din JAK-V2-09. Nu s-au creat teste noi de aplicație și nu s-a modificat codul aplicației. Niciun apel de rețea, test live, mail sau scriere de date reale.

Nu s-a executat PostgreSQL pentru constatările acestei opinii; dovezile RLS sunt raționament static și trebuie confirmate în harness pe Postgres real cu rol neprivilegiat. Verificarea adversarială din fiecare fișă este o a doua trecere locală a autorului, **nu** validarea independentă de către alt agent cerută pentru inventarul final P1. Este necesară înainte de închiderea constatărilor. Absența unor teste în acest raport nu înseamnă că nu există în arhive externe.
