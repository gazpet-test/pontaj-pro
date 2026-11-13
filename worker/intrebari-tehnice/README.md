# ❓ Întreabă echipa — worker pe serverul AI

Decizie Răzvan 05.11.2026 („da 1-2-3-4”): spețe tehnice puse din ERP (`/intrebari`) → răspuns AI **informativ**, vizibil doar
autorului (și ownerului). Primul utilizator: Silviu Stănescu (Director Tehnic). Limită 5 întrebări/zi (owner 20), în BD.

## Piese
| Piesă | Unde |
|---|---|
| Tabel + RLS + bucket + RPC-uri | `supabase/migrations/20261105a_intrebari_tehnice.sql` (livrare: `scripts/livrare_migrare.sh`) |
| Canal worker ↔ ERP | edge `intrebari-tehnice-worker` (verify_jwt = false; poarta: Vault `INTREBARI_WORKER_SECRET`, antet `x-intrebari-secret`) |
| Worker | `intrebari_worker.py` + `cercetare.py` (acest folder), Task Scheduler „Intrebari tehnice worker (Gazpet)”, la 2 minute |
| Cercetare (06.11.2026) | `cercetare.py` (corpus, web oficial, validare); index: `scripts/intrebari/construieste_corpus.mjs` → `corpus_index.json` |
| Surse + `de_verificat` + reluare | `supabase/migrations/20261131e_intrebari_cercetare_surse.sql` (edge v2 o cere) |
| Ecran | `src/IntrebariTehnice.jsx` + `src/intrebariSurse.js`, cheia de modul `intrebari_tehnice` |
| Mascarea numelor + regula „Da / Nu / Incert” (13.11.2026; r4 motorul unic) | `src/intrebariMascare.js` = MOTORUL UNIC (toate regulile; ecranul îl importă, workerul îl cheamă prin `motor.py` → procesul Node `motor_cli.mjs`, verificat cu `motor_manifest.json`); edge v3 (acțiunea `nume`). Pentru owner: `docs/intrebari/MASCARE_SI_VERDICT.md` |

## Răspuns din cercetare (cerere Silviu + Răzvan, 06.11.2026)
1. **Corpus intern** — `scripts/intrebari/corpus.mjs` (`CORPUS`): cercetarea normativă din `docs/cercetare` (baza normativă,
   registrul cerințelor atomice cu locator, registrul surselor, practica CNSC, tipare de clarificări, surse lipsă). NU intră:
   `docs/juridic` (dosare cu date de proiect), brief-uri / rapoarte de lucru, SQL. Indexul se caută local, pe cuvinte-cheie
   (BM25 simplu, fără serviciu extern) → max 8 extrase `C1..C8` (≤ 1500 caractere fiecare, ≤ 14000 în total, max 3 pe fișier).
2. **Web oficial — speța NU intră în apelul cu căutare; interogările le COMPUNE codul** (runda 3, review r2 P1-1). Trei pași:
   - **a. propunere, fără unelte**: `MODEL_INTEROGARI` (Sonnet) primește titlul + speța curățate de mailuri / linkuri /
     telefoane / numere lungi (contextul de proiect, atașamentele și extrasele interne nu ajung nici aici) și vocabularul aprobat,
     și propune max 5 interogări, ca JSON;
   - **b. compunere din vocabular** (`cercetare.compune_interogari`): codul păstrează DOAR termenii din
     **`vocabular_web.json`** (listă închisă, versionată în repo: termeni tehnici + acte normative / standarde din listă) și
     compune el interogarea, din forma din vocabular (nu din textul modelului). Orice alt cuvânt — nume de persoane, firme,
     proiecte, localități, numere de contract — se aruncă, **indiferent de majuscule**, și doar se numără (`termeni_aruncati` în
     jurnal, fără text). Cifrele există doar în numerele actelor din listă, recunoscute după un tipar strict („Legea 10/1995”,
     „HG nr. 273 din 1994”, „Ordinul ANRE 89/2018”, „SR EN 12007-2”, „NTPEE-2018”, „NP 133”); „nr” singur nu mai autorizează nimic.
     O interogare = min. 2 elemente (sau un act), max 8, max 80 de caractere. Vocabularul se schimbă doar prin PR; testele
     verifică forma lui (litere mici fără diacritice, fără dubluri, acte recunoscute întregi, fără nume de firme / localități
     cunoscute) — un vocabular lipsă sau stricat oprește workerul (fail closed);
   - **c. căutarea**: câte O cerere cu unealta `web_search` a API-ului pe FIECARE interogare compusă (max 5), cu `max_uses` = 1 și
     `allowed_domains` = `cercetare.DOMENII_OFICIALE` (listă fixă, identică în `src/intrebariSurse.js` și în edge, toate din
     lista aprobată în CLAUDE.md pct. 11 — de aceea `iscir.ro` a ieșit în runda 3; testul vitest le compară). Modelul din cerere
     vede DOAR interogarea compusă (nu speța, contextul sau extrasele), deci nu are de unde să pună altceva în căutare; rezultatul
     se folosește doar dacă interogarea executată e exact cea compusă (`interogare_respectata`), altfel e ignorat
     (`cautari_ignorate`). **Interogările efectiv trimise** (blocurile `server_tool_use`) se salvează pe întrebare în
     `interogari_web` și în jurnalul `intrebari_preluari` — ownerul le vede în ecran. Fără interogări compuse → nu se caută pe
     web, răspunsul vine doar din corpus.
     Limită declarată: căutarea web e unealta server-side a API-ului — o execută modelul la Anthropic, nu codul nostru direct.
     Controlul e la intrare (cererea conține doar interogarea compusă din vocabular) și la ieșire (rezultat folosit doar pe
     interogarea exactă). O căutare executată integral de cod ar cere un serviciu de căutare separat (cheie nouă) — decizia lui Răzvan.
   Sursele `W1..Wn` = citările + rezultatele, filtrate încă o dată pe domeniu (și în edge, și în UI); plafon total C + W ≤ 30
   ÎNAINTE de generare. **Rezultat web incomplet** (`max_tokens`, `pause_turn`, `web_search_tool_result_error`, propunerea de
   interogări tăiată) → NU se publică nimic: eroare „Cercetare incompletă: …”.
3. **Răspunsul** — fără unelte, doar din `<surse>` (conținutul speței, al extraselor și al paginilor e neutralizat: `<`/`>` →
   `‹`/`›`, deci nu poate închide `<surse>` / `<speta>`): prima linie = verdict (Da / Nu / Incert — de la 13.11.2026 doar trei;
   „Depinde de …” devine „Incert — depinde de …”, vezi pct. 3b),
   fiecare afirmație normativă cu marcaj `[C1]` / `[W2]`. `cercetare.analizeaza` (aceleași reguli în `src/intrebariSurse.js`,
   cazuri comune în `teste_validare.json`):
   - normativă = act / articol / standard / cifră cu unitate **sau o regulă**: obligație, interdicție, permisiune, condiție,
     limită („obligatoriu”, „trebuie”, „se interzice”, „nu se admite”, „este permis”, „are voie”, „numai dacă”, „cu condiția”,
     „cu excepția”, „cel puțin”, „cel mult”, „impune”, „conform” …); pe o linie CU marcaj, și „se poate” / „nu se poate”;
   - excepția „Nu am găsit sursa oficială pentru …” scutește DOAR o linie care e exclusiv declarația de lipsă (fără `;`, fără
     altă propoziție, fără „dar/însă/iar”, fără articol / cifră / obligație) — „Proba se face la 99 bar; nu am găsit sursa
     oficială pentru alt detaliu.” NU e scutită;
   - **cifrele** (runda 4, review r3 P2): o afirmație cu marcaj trece doar dacă **TOATE** cifrele ei apar în sursele citate, ca
     token COMPLET = semn + număr + unitate („−5 bar” nu e „5 bar”; „30 de zile” = „30 zile”; „10 metri” = „10 m”). La o afirmație
     normativă, o cifră fără unitate nu e confirmată de aceeași cifră cu unitate în sursă (și invers): „proba se face la 6” față
     de „6 bar” → scoasă. Unitățile recunoscute: bar, mbar, kPa, MPa, mm, cm, m, km, °C, grade, %, zile, ore, săptămâni, luni,
     ani, minute, secunde, litri, lei, euro, kg, mc, mp. Runda 5 (review r4 P2): unitatea se ia ÎNTREAGĂ — exponent și numitori
     („5 m/s²” ≠ „5 m/s”; „km/h”, „kg/m3”, un numitor necunoscut rămâne scris cum e); semnul contează și despărțit prin spațiu
     („- 5 bar” = „-5 bar”, nu „5 bar”), iar la început de rând e ambiguu (bulină sau minus?) și nu confirmă nimic; un interval
     („între 2 și 6 bar”, „de la 2 la 6 bar”, „2–6 bar”) e UN token „2..6 bar” — un capăt nu confirmă „2 bar”. Cu liniuță doar
     dacă măcar un capăt are unitate („EN 12732-1” rămâne „12732” și „1”);
   - **susținerea pe propoziție** (runda 4, review r3 P1 — înlocuiește „majoritatea termenilor” din runda 3): o afirmație cu
     marcaj trece doar dacă O PROPOZIȚIE dintr-o sursă citată (titlul sursei se adaugă la fiecare propoziție) are:
     · **același tip de regulă**: o obligație cere „obligatoriu / trebuie / necesar / impune” în sursă, o interdicție cere
       „se interzice / nu se admite / nu este permis / nu trebuie”, o permisiune cere „este permis / se admite”; tipul opus
       sau lipsa lui = nesusținută („Se interzice sudarea pe ploaie [C1]” cu sursa „Este permisă sudarea pe ploaie” → scoasă;
       „nu este obligatoriu” nu e susținut de „este obligatoriu”); propoziția sursei nu are voie să aibă o interdicție, o
       condiție („numai dacă”, „cu excepția”) sau — la o valoare — o limită („cel puțin”) pe care afirmația o omite;
     · **aceeași negație** („Proba nu se face …” nu e susținut de „Proba se face …”);
     · **toți termenii de conținut** ai unei afirmații normative, inclusiv calificativele („autorizat”, „atestat”, „calificat”,
       „în scris”, „prealabil”), plus cifrele ei cu unitate — în ACEEAȘI propoziție (nu adunați din propoziții diferite);
       la o afirmație descriptivă rămâne pragul din runda 3: cel puțin jumătate din termeni, acum tot pe propoziție.
     „Este obligatoriu un responsabil autorizat pentru recepția lucrărilor [C1]” cu sursa „Recepția lucrărilor se face de
     responsabilul beneficiarului.” → scoasă (sursa n-are nici obligația, nici „autorizat”). Termenii-cheie = cuvintele de ≥ 3
     litere, normalizate (fără diacritice, rădăcina de 6 litere), fără cuvinte de legătură, verbe generice („este”, „face”,
     „aplică”), structura actelor („art.”, „alin.”) și marcatorii de regulă. O regulă fără niciun termen verificabil și fără
     cifre („Este obligatoriu [C1]”) se scoate;
     · **runda 5 (review r4 P1) — restricțiile sursei nu se pot omite**: propoziția din sursă se ia ÎNTREAGĂ, cu adversativele
       și subordonatele ei (nu se mai taie la „dar”; o propoziție care începe cu „Însă / Dacă / Cu excepția …” ține de cea
       dinainte); „dacă”, „numai”, „doar” simple sunt condiții. La o afirmație normativă comparația e în AMBELE sensuri: fiecare
       restricție a propoziției din sursă (după „dar / însă / totuși / dacă / numai / doar / în cazul în care / cu condiția /
       cu excepția / în afară de / până la”) trebuie să apară în afirmație — un marcator din aceeași familie și toți termenii /
       cifrele ei („numai după verificare și autorizare” NU susține „numai după verificare”); la „sau / ori” ajunge o variantă
       („numai după verificare sau autorizare” susține „numai după verificare”). „Sudarea este permisă [C1]” cu sursa „Sudarea
       este permisă, dar se interzice pe ploaie.” → scoasă; citarea întreagă trece;
     · **fiecare propoziție a rândului** se verifică separat (aceeași trimitere [C1] le acoperă pe toate): „Proba trebuie făcută
       la 6 bar. Durata trebuie să fie 2 ore. [C1]” trece dacă sursa le are pe amândouă, fiecare în propoziția ei;
   - **limita asumată** (runda 4): potrivirea e pe cuvinte, nu pe sens. Suntem intenționat stricți: o parafrază corectă cu alt
     cuvânt e respinsă — „personal competent” pentru sursa „personal calificat”, „impune” pentru sursa „se face la 99 bar” — iar
     răspunsul devine „Incert — de verificat” (de verificat de om), nu greșit. Nu adăugăm sinonime ghicite;
   - **o afirmație normativă scoasă nu se „repară”** prin tăierea unui cuvânt: linia se înlocuiește întreagă cu o notă, iar
     verdictul „Da / Nu / Depinde” se schimbă în **„Incert — de verificat: nu am găsit o sursă care să susțină verdictul
     propus.”** (runda 4: verdictul se putea sprijini pe ea). Tot așa, verdictul are nevoie de temei (runda 3, P2-3): rămâne doar
     dacă după curățare există măcar o afirmație cu dovadă pozitivă; o linie neutră care doar citează C1 nu ține verdictul;
   dacă pică → o singură reparare (cu motivul fiecărei linii); ce rămâne nesusținut se scoate (`curata_raspuns`). Sursele citate
   trec verificarea finală pe setul care se salvează (`verifica_surse_finale`: max 30, ID-uri unice dintre cele trimise,
   domenii / căi valide, < 80 KB) → `surse`.
3b. **Regula B (decizia owner-ului 13.11.2026; r4 conservatoare)** — în MOTORUL UNIC (`aplicaRegulaB` / `cereCitat` din
   `src/intrebariMascare.js`, chemate prin `motor.Sesiune.regula_b` / `cere_citat`), ULTIMUL pas înainte de publicare (după
   `curata_raspuns`): „Da” / „Nu” rămân doar cu un citat INTEGRAL dintr-o propoziție AUTONOMĂ a sursei marcate pe același rând
   (`propozitiiSursa`: nu e element de listă / introducere de listă / „;” / celulă de tabel, nu are trimitere sau expresie
   anaforică, nici excepție, nici restricție în alt rând al paragrafului, paragraful nu e tăiat la marginea extrasului, începe cu
   majusculă și se termină cu punct), ≥ 6 cuvinte, comparat cu `formaCitat` (semnele, cifrele, operatorii și diacriticele rămân).
   Marginile extraselor le dă `cercetare.py` (`inceput_sigur` / `sfarsit_sigur`: bucățile de corpus netăiate = sigure; feliile
   unui paragraf prea lung și fragmentele web = nesigure). Altfel prima linie devine textul „Incert” al motorului și se salvează
   TOATE sursele consultate; la „Da” / „Nu” — doar cele citate. Un „Da” / „Nu” fără citat cere întâi repararea
   (`mesaj_reparare(..., fara_citat=True)`). Cazurile: `teste_motor.json` → `regula_b`.
4. **Model**: întrebările cu temei normativ / juridic (detectate după cuvinte-cheie: lege, normativ, articol, ISCIR, ANRE,
   autorizare, recepție, sudură, contract, achiziții …) merg **implicit pe Opus** — `MODEL_NORMATIV` = `claude-opus-5-5`, cel mai
   scump model, pentru pașii de căutare, răspuns și reparare; restul pe `MODEL_GENERAL` = `claude-sonnet-5-5`. Propunerea de
   interogări e mereu pe Sonnet. Constantele stau în `cercetare.py`; schimbarea modelului = PR.
5. **Cost — maxim de apeluri API pe o preluare**: 1 (interogări) + până la 5 la căutare (o cerere pe interogare compusă,
   `max_uses` = 1, fără continuări — un `pause_turn` = „Cercetare incompletă”) + 1 (răspuns) + 1 (reparare) = **max 8 apeluri**;
   în mod obișnuit 4–6. Căutările web: **max 5 pe întrebare**. Tokenii + `web_search_requests` + `apeluri` se adună în `tokeni`
   (și la erori). Un 429/529 după un pas plătit NU se reia automat (s-ar plăti iar) — eroare vizibilă.
   **Plafonul global de 40 de preluări pe zi** se numără din jurnalul durabil `intrebari_preluari` (un rând la fiecare preluare,
   cu costul ei), deci **include reluările**: „🔁 Reia cu cercetare” nu mai poate ocoli plafonul (review r1 P1-c). Amânările certe
   fără cost (429/529 la primul apel) nu se numără.
6. **UI**: verdictul evidențiat (galben dacă e „Incert”), textul, apoi „Surse” (linkuri doar pe domeniile oficiale); ownerul vede
   și interogările web trimise. „⚑ Răspuns neclar — trimite la verificare” (autorul) → stare `de_verificat`, fără alte efecte.
   „🔁 Reia cu cercetare” — DOAR ownerul (costă, intră în plafon). Rezultatul unei acțiuni rămâne legat de întrebarea pe care
   s-a apăsat (id + generație), nu apare sub altă întrebare deschisă între timp. Cele două butoane apar **doar după ce ecranul a
   detectat migrarea 20261131e** (coloanele ei s-au citit fără eroare — runda 4, review r3 P2); până atunci, în locul lor, o
   notă: „disponibile după actualizarea bazei de date” (`actiuniIntrebare` în `src/intrebariSurse.js`). Runda 5 (review r4 P2):
   fără migrarea detectată, răspunsul arată EXACT ca înainte (eticheta „Răspuns AI · informativ, neverificat”, textul simplu,
   avertizarea despre „[DE VERIFICAT]”); cu migrarea, eticheta „din cercetare” apare doar pe răspunsurile cu surse sau
   interogări salvate (`prezentareRaspuns`).

## Ce ajunge la furnizorul modelului (Anthropic) — decizia owner-ului 13.11.2026 (A: mascarea numelor)
Pe înțelesul ownerului: `docs/intrebari/MASCARE_SI_VERDICT.md` (ce pleacă / ce nu, limite, pornire, fișa a–e). Tehnic:
- **r4 — motorul unic**: TOATE regulile stau în `src/intrebariMascare.js` (cu listele lui: `nemascate.json`, `vocabular_web.json`,
  `cuvinte_comune.json`). Workerul îl cheamă prin `motor.py`: `Motor()` la pornire (manifestul `motor_manifest.json` — sha256 cu LF
  pentru toate fișierele motorului, protocolul, versiunea motorului, Node 24 și versiunea Unicode; fișierele se copiază într-un
  instantaneu privat, doar citire), apoi câte o `Sesiune` (un proces `node --permission --allow-fs-read=<instantaneu>
  --disallow-code-generation-from-strings motor_cli.mjs`, pornit direct, mediu minim, stderr închis) pe preluare. Protocolul:
  `motor_protocol.mjs` (JSON pe linie, versiune + câmpuri exacte, coduri de eroare fără date). Orice abatere → `MotorEroare` →
  nicio cerere nouă, nimic publicat (`motiv: motor` + codul în jurnal). Motor invalid la pornire → `motor_invalid`, nicio preluare.
  Python NU are reguli (testul din `src/intrebariMascare.test.js` și `test_motor.py` o verifică).
- **Lista de nume** (toate sursele din `logic.js` `SURSE_NUME`; plus `localitati` din `red_uat`, care NU se ascund): edge-ul o dă
  workerului la pornire (`{"actiune": "nume"}`); workerul o trece NEATINSĂ fiecărei sesiuni (pe intrarea procesului). Motorul o
  validează (formă, persoane nevide) — o sesiune de probă la pornire; refuz → `nume_indisponibile`, nicio preluare. Jurnalul de
  pornire are `nume_incarcate` cu statisticile motorului (doar numere: câte componente / firme / CUI / localități, câte firme cer
  context, câte intrări aruncate).
- **Mascarea** (o sesiune pe preluare): întâi `invata(titlu, speță, context)`, apoi titlul, speța, contextul (ordinea ecranului),
  apoi sursele și fiecare mesaj spre model; contractul de acoperire și excepțiile — în documentul pentru owner. Etichete stabile
  `[PERSOANA_1]` … `[ASCUNS_1]`, altă formă = `_F2`. Tabelul etichetă → text stă doar în procesul sesiunii; jurnalul primește
  `contoare` (câte valori pe categorie) și `inlocuiri`.
- **Un singur drum spre furnizor**: `cere()` maschează fiecare mesaj → `apel(cheie, corp, mascare)` rulează
  `garda_cerere(corp, mascare)` (conținut EXACT de tip `motor.TextMascat` ȘI produs de sesiunea acestei preluări —
  `Sesiune.a_produs`; sistem / model / unealtă din listele fixe; altfel `GardaMascare`, fără rețea) → `trimite_http()`. Testele AST
  din `test_motor.py` verifică drumul. Garda e împotriva greșelilor de program, nu a unui cod rău-intenționat din același proces.
- **Atașamentele nu mai pleacă** (numele din ele nu se pot masca sigur): modelul primește doar numărul lor.
- **Demascarea** doar pe `raspuns_md`, STRICTĂ: `Sesiune.demascheaza_sigur` (motorul) pune la loc doar etichetele emise, exacte;
  orice „aproape etichetă” (între paranteze drepte sau `PERSOANA_1` cu majuscule și „_”) care nu e una emisă, o etichetă pusă pe o
  „aproape etichetă” a modelului sau o etichetă ruptă (rând nou / invizibil în ea) → eroare, nimic publicat (`motiv: demascare`,
  `detaliu: eticheta_neemisa` / `eticheta_din_model` / `eticheta_rupta`; textul modelului NU intră în jurnal). r4: proza („firma 2”,
  „persoana 2”, „CUI 12345678”) nu mai oprește publicarea. Etichete emise rămase după demascare → `demascare_lipsa`.
- **Entitățile publice vizibile** (decizia owner-ului 13.11.2026): lista închisă din `nemascate.json`, citită DOAR de motor,
  potrivire pe numele întreg. Fișier lipsă / stricat → motorul nu se încarcă, workerul nu preia nimic.
- **Căutarea web**: neschimbată (interogări compuse din vocabular); o interogare pe care mascarea ar schimba-o nu se trimite
  (`cautari_cu_nume` în jurnal).
- Ce NU prinde mascarea: vezi documentul pentru owner (nume necunoscute fără titlu, porecle, inițiale, literă mică, un prenume care
  e și cuvânt obișnuit scris singur, firme fără formă juridică și necunoscute; localitățile rămân vizibile prin decizie).
Conform condițiilor comerciale ale API-ului, Anthropic nu folosește implicit aceste date la antrenarea modelelor; ele trec totuși prin
serverele lui și pot fi păstrate o perioadă limitată.

## Identitate
- Claude prin **API** (cheia din Credential Manager `anthropic-claude-code` / `api`, workspace-ul cu plafon lunar), NU abonamentul:
  abonamentul nu devine backend ERP pentru alți utilizatori (vezi `worker/claude-cli/README.md`).
- Secretul workerului: `C:\Users\Gazpet-Ai\.secrete\intrebari_worker_secret.txt` (64 hex, același cu Vault). Nu se pune în repo, chat sau log.
- Modelul: constantele din `cercetare.py` (Opus la normativ/juridic, Sonnet în rest). Singura unealtă: `web_search` pe domeniile
  oficiale (server-side, la Anthropic) — trebuie activată pentru organizație/workspace în Console. Fără fișiere, fără BD.

## Instalare (o singură dată, pe Gazpet-Claude)
1. Migrarea, prin `livrare_migrare.sh` (după „da”).
2. Secretul: generat în BD (`vault.create_secret(encode(gen_random_bytes(32),'hex'), 'INTREBARI_WORKER_SECRET')`), apoi citit
   cu `psql -At … -o C:\Users\Gazpet-Ai\.secrete\intrebari_worker_secret.txt` — valoarea nu trece prin chat.
3. Deploy edge `intrebari-tehnice-worker` cu verify_jwt = false.
4. Copia scriptului din `main` în `C:\Users\Public\intrebari_worker\intrebari_worker.py` (nu rulează din clona de lucru, care își
   schimbă branch-ul), apoi Task Scheduler (fără .ps1/.cmd ad-hoc — Bitdefender):
   `schtasks /Create /TN "Intrebari tehnice worker (Gazpet)" /SC MINUTE /MO 2 /TR "\"C:\Program Files\Python313\pythonw.exe\" -B C:\Users\Public\intrebari_worker\intrebari_worker.py" /F`
5. Acces: rând în `user_module_access` (`intrebari_tehnice`, editor) — doar cu acordul lui Răzvan.

### Actualizarea „din cercetare” (20261131e) — ordinea contează
1. Migrarea `20261131e_intrebari_cercetare_surse.sql` prin `livrare_migrare.sh` (după „da”) — ÎNAINTE de merge-ul UI-ului
   (ecranul merge și fără ea, pe coloanele vechi, dar butoanele noi cer funcțiile) și înainte de edge.
2. Deploy edge `intrebari-tehnice-worker` v2 (verify_jwt = false, ca înainte).
3. Web search activat în Console pentru workspace-ul cheii API (altfel apelul de cercetare dă 400 → eroare vizibilă).
4. Pe server, din clona la zi pe `main`: copiezi `intrebari_worker.py`, `cercetare.py`, `corpus_manifest.json` **și**
   `vocabular_web.json` (runda 3; lipsă / stricat → workerul nu preia nimic, `vocabular_invalid` în jurnal) în
   `C:\Users\Public\intrebari_worker\`, apoi `node scripts/intrebari/construieste_corpus.mjs C:\Users\Public\intrebari_worker\corpus_index.json`
   (iese cu 1 dacă un fișier din corpus lipsește). La pornire workerul verifică `sha256(corpus_index.json)` = `index_sha256` din
   manifest; index lipsă / stricat / nepotrivit (sau cheia API lipsă) → **nu preia nimic** (`corpus_invalid` în jurnal) —
   întrebările așteaptă în coadă, nu se consumă. Indexul e determinist (fără dată, sha256 pe text cu LF), deci aceeași clonă dă
   același sha pe orice mașină.
   **La o schimbare într-un fișier din `CORPUS`** (`docs/cercetare/...`): în PR-ul respectiv se regenerează manifestul —
   `node scripts/intrebari/construieste_corpus.mjs <temp>.json --manifest worker/intrebari-tehnice/corpus_manifest.json` — iar
   pe server se recopiază manifestul și se reconstruiește indexul. Verificare fără scriere:
   `node scripts/intrebari/construieste_corpus.mjs --verifica worker/intrebari-tehnice/corpus_manifest.json`. Un `docs/cercetare`
   schimbat pe `main` fără manifest nou oprește workerul (fail closed) până la PR-ul cu manifestul.
5. Întrebarea id 1 NU se reia automat: ownerul apasă „🔁 Reia cu cercetare” pe ea, după pașii 1–4.
6. `registru_automatizari` + rândul din `public.automatizari`: fișa nouă (web pe domenii oficiale, Opus) — CLAUDE.md pct. 7.

### Actualizarea „mascare + regula B” (13.11.2026, r2 / r3 / r4) — fără migrare, fără secrete noi
Pașii exacți, în ordine, sunt în `docs/intrebari/MASCARE_SI_VERDICT.md` („Pașii de pornire”). Pe scurt: **workerul OPRIT și
verificat oprit ca prim pas** (task dezactivat + niciun proces `intrebari_worker.py` / `motor_cli.mjs` + lacătul liber), merge,
verificarea coloanelor `SURSE_NUME`, edge-ul (dacă nu e deja publicat: `index.ts` + `logic.js` împreună, cu workerul oprit), proba
acțiunii `nume`, **Node 24 pe server cu aceeași versiune Unicode ca manifestul**, copierea fișierelor workerului (`intrebari_worker.py`,
`cercetare.py`, **`motor.py`**, **`motor_manifest.json`**, `vocabular_web.json`, `corpus_manifest.json`) și a motorului în
`C:\Users\Public\intrebari_worker\motor\` cu căile din repo (lista din manifest), ștergerea vechiului `mascare.py`, testele pe
`main` (vitest + Python), **testul de fum cu task-ul încă dezactivat**, abia apoi reactivarea, apoi registrul. La o schimbare în
motor / protocol / JSON-urile lui (PR): `node scripts/intrebari/manifest_motor.mjs` reface manifestul (`--verifica` = doar
verificare; testul vitest pică dacă manifestul nu e la zi).

## Verificare după livrare (teste negative, într-o tranzacție cu ROLLBACK)
Simulat cu `SET LOCAL ROLE authenticated` + `request.jwt.claims` pentru un utilizator FĂRĂ cheia de modul și pentru autor:
- străinul: INSERT în `intrebari_tehnice` refuzat; SELECT pe întrebările altuia = 0 rânduri; SELECT pe `storage.objects` din bucket = 0;
- autorul: INSERT cu `stare='raspuns'` / `raspuns_md` → câmpurile sunt resetate de trigger; a 6-a întrebare în aceeași zi refuzată;
- `fn_intrebari_preia` / `_raspunde` / `_amana` refuzate pentru `authenticated` și `anon`;
- (20261131e) `intrebari_preluari`: SELECT / INSERT refuzat pentru `authenticated` și `anon`; după N reluări ale aceleiași
  întrebări, `count(*)` pe ziua curentă crește cu N (plafonul de 40 nu se ocolește); `fn_intrebari_reia` nu golește `tokeni` / `preluat_la`.

## Funcționare și erori
- O rulare preia max 3 întrebări; lock `C:\Users\Public\intrebari_worker\worker.lock`.
- Jurnal local: `C:\Users\Public\intrebari_worker\jurnal.jsonl` — doar id, stare, tokeni, durată, numărul de extrase / surse web /
  interogări / căutări / citate, `reparat`, `scoase`, `incert`, motivul erorii (fără conținut, fără textul interogărilor, fără
  secrete). De la 13.11.2026 și: `mascate` (câte valori ascunse pe categorie), `inlocuiri`, `cautari_cu_nume`, `regula_b`
  (`citat` / `fara_citat` / `depinde` / `incert`), `atasamente_netrimise` — numere / coduri, niciodată numele sau valorile. Textul interogărilor trimise stă DOAR în BD (`interogari_web`, `intrebari_preluari`), vizibil ownerului.
- Jurnalul de preluări din BD (`intrebari_preluari`, 20261131e): un rând la fiecare preluare (încercare, rezultat, tokeni,
  interogări). RLS fără politici, SELECT doar `service_role`; scris doar de funcțiile workerului; reluarea nu-l atinge.
- API supraîncărcat / limită de rată → întrebarea rămâne „în lucru”, BD o redă după 30 min (max 3 încercări, apoi „eroare”).
  Fără bucle de reîncercare.
- Credit API terminat → „eroare” cu mesaj clar pentru utilizator.

## Ce NU face
Nu trimite la furnizor nume, date personale sau atașamente (decizia A, 13.11.2026 — vezi mai sus). Nu caută pe web în afara domeniilor oficiale fixe (decizia Silviu + Răzvan 06.11.2026 lărgește regula 27.10.2026 doar pentru
acest worker: apelul cu web nu primește speța, atașamente, context de proiect sau extrase interne — doar câte o interogare compusă
de cod din vocabularul aprobat —
iar ieșirea e limitată la `allowed_domains`), nu deschide pagini în afara căutării, nu trimite mail, nu scrie în alte tabele
decât rândul întrebării și jurnalul ei de preluări, nu vede ERP-ul, nu folosește Copilot / Jakarinos (ar expune contextul intern
al echipei Paw).

## Teste
- `node node_modules/vitest/vitest.mjs run src/intrebariSurse.test.js src/intrebariMascare.test.js src/intrebariUtil.test.js scripts/intrebari/corpus.test.mjs scripts/intrebari/interogari.test.mjs scripts/intrebari_cercetare_amprente.test.js`
- r4 (motorul unic): UN SINGUR set de cazuri, `teste_motor.json` (contractul de acoperire pe rânduri, regresiile r2 / r3, regula B,
  etichetele, intrările aruncate; rezultatele scrise de mână), rulat de trei ori: vitest pe motor (`src/intrebariMascare.test.js`,
  prin `motor_cazuri.mjs`), procesul Node REAL prin `motor.py` (`test_motor.py`; `test_worker.py` pe traseul complet
  `proceseaza()`, cu transportul spre model simulat) și browserul real (`motor_browser.html` — din rădăcina repo-ului
  `python -m http.server 8765 --bind 127.0.0.1`, apoi `http://127.0.0.1:8765/worker/intrebari-tehnice/motor_browser.html`;
  rezultatul în `#rezultat` și `window.REZULTAT_MOTOR`). Mutanți: o regulă scoasă pe fiecare rând al contractului și pe fiecare
  excludere din regula B (vitest, motorul copiat și rulat în Node); fiecare cale de eroare a procesului (`test_motor_defect.mjs` —
  proces cu motorul real, stricat la cererea N: zero cereri noi, zero publicări). Plus: protocolul (schemă exactă, o speță = o
  stare, două procese concurente), manifestul la zi, verificarea statică „fără rețea”, ecranul (previzualizare orientativă).
  Garda: `test_motor.py` (tipul `TextMascat` + proveniența pe sesiune, AST — drumul unic spre furnizor, refuzurile gărzii) și
  `test_worker.py` (nimic din valorile sensibile în nicio cerere, atașamentele nu pleacă, jurnalul fără valori, mutanții „apel
  nemascat” / „tip falsificat” / „altă speță” / „demascare lipsă”, demascarea parțială nu se publică, fără lista de nume sau fără
  motor nu se preia nimic). Edge: `supabase/functions/intrebari-tehnice-worker/logic.test.js` (vitest).
- `python -I -B -m unittest discover -s worker/intrebari-tehnice -p "test_*.py"` — **paritate Python ↔ JS pe aceleași fișiere**:
  validarea (`teste_validare.json`: verdict, fără sursă, cifre neconfirmate, nesusținute, temei, textul după curățare — runda 4:
  polaritatea, calificativele, negația, propozițiile, semnul și unitatea), tokenii numerici / tipul regulii / propozițiile
  (`teste_normative.json`, runda 4) și compunerea interogărilor (`teste_interogari.json`, pe vocabularul real; portarea JS e
  `scripts/intrebari/interogari.mjs`).
- Amprentele migrării (runda 4, L15): `scripts/intrebari_cercetare_amprente.test.js` (vitest: interogarea identică în migrare și
  în scriptul coordonatorului, blocul unic fail-closed, md5-urile corpurilor recalculate din migrare, revenirea = 20261105a verbatim)
  și proba locală PGlite `npm install --no-save @electric-sql/pglite && node scripts/pglite/test_intrebari_cercetare_local.mjs`
  (schemă falsă; NU înlocuiește dry-run-ul pe clonă).
  `test_worker.py` rulează fluxul complet FĂRĂ rețea — `apel` / `edge` înlocuite: cererea web primește doar interogarea compusă,
  o cerere pe interogare cu `max_uses` = 1, căutarea modificată de model e ignorată, rezultat web incomplet nepublicat,
  obligația cu sursă fără legătură devine „Incert”, corpus / vocabular invalid = nicio preluare.
- `node scripts/intrebari/construieste_corpus.mjs --verifica worker/intrebari-tehnice/corpus_manifest.json` (manifestul la zi)
- BD (doar pe clonă, le rulează chat-ul): `supabase/tests/20261131e_intrebari_cercetare_surse_dryrun.sql` (apply → revenire
  standard → re-apply; revenire cu arhivă; expirarea în `fn_intrebari_preia`; T4–T5: migrarea și revenirea refuză o versiune
  ulterioară a unei funcții — cere blocul AMPRENTE BASELINE completat din `scripts/intrebari_cercetare_amprente.sql`) și
  `scripts/test_intrebari_preia_lock.sh --sistem …`
  (două sesiuni reale: expirarea contra unui răspuns întârziat, fără deadlock; `--mutant-r2` trebuie să dea 40P01).
- Revenirea BD: `supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql` (vezi `supabase/revenire/README.md`).
