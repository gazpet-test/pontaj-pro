# Uscare conductă în Execuție — specificație (prima livrare)

Stare: **cod + migrare NEAPLICATĂ** (`supabase/migrations/20261225a_executie_uscare.sql`, revenire în
`supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql`). Ecranul: Execuție → proiect → Izometrie → „💨 Uscare conductă”
(`src/UscareConducta.jsx`). Până la aplicarea migrării, ecranul spune că funcția nu e încă activă și nu scrie nimic.

## 1. Ce cere beneficiarul

La fiecare operațiune de uscare a conductei după proba de presiune, un **raport de uscare** completat și semnat de constructor și de
reprezentantul beneficiarului, susținut cu fotografii. Rubricile modelului (un singur tabel, în această ordine):

1. Data operațiunii, Tronson, De la km, La km, Lungime (m), Temperatura exterioară, Denumire constructor.
2. Utilaje / echipamente (denumire, nr. buc.); Perioada (ora începerii, ora finalizării); Durata (ore); Configurația ansamblului de pistoane
   (PIG metalic, piston poliuretan, bureți spumă — buc.); Cântărirea buretelui 1 (la intrare / la ieșire, kg); Punctul de rouă (valoare °C,
   locul măsurării).
3. Presiunea în spatele buretelui (bar); Timpul de deplasare (min); Viteza medie (m/s); Cântărirea bureților 2 și 3 (intrare / ieșire, kg).
4. Observații.
5. Concluzie pentru tronson: CONFORM / NECONFORM.
6. Semnături: CONSTRUCTOR și BENEFICIAR (nume / prenume, funcție).

Cerințe în afara tabelului: notificarea beneficiarului **cu minimum 24 h înainte** de începerea operațiunilor (ca să-și desemneze
reprezentantul); **fotografii** pentru tot ce se trece în tabel, cel puțin: presiune, temperatura exterioară, configurația pistoanelor,
cântărirea buretelui la intrare și la ieșire. Raportul, cu fotografiile, se predă completat și semnat la finalizarea operațiunilor.

## 2. Ce exista deja în platformă (pasul 0)

| Subiect | Ce există | Ce folosim |
|---|---|---|
| Tronsoanele de probă | `executie_probe_tronsoane` (20261202a): intervale de km pe proiect (P1, P2…), cu 4 etape în `executie_probe_etape` (pistonare / curățare, **uscare**, calibrare, presiune), fiecare cu starea ei; etapa „uscare” ține doar starea, datele și punctul de rouă. Ecran: `src/ProbeTronsoane.jsx`. Programul probelor de presiune există doar ca document (nu e structurat în platformă). | Raportul de uscare se leagă **opțional** de un tronson de probă (cheie străină compusă, același proiect); fără legătură = interval liber (ex. uscarea finală pe tot traseul). Starea etapei „uscare” NU se sincronizează automat (vezi §9). |
| Modulul Probe (execuția probei de presiune) | `probe_calcule` + bucket `probe-citiri` (fotografii la manometru / ore de bord; comprimare în browser, 1600 px JPEG; urcare fără suprascriere și verificare prin citire dacă răspunsul se pierde). | Același tipar de urcare a pozelor (`upsert: false`, verificare prin `download`). |
| Pozele în Execuție | Bucket-uri `noduri-scheme` (doar citire), `executie-contracte`, `executie-borderouri`, `documente-proiect` etc.; restricția pe proiect (20261209a) le clasifică în inventarul ei. `src/compressFile.js` comprimă la 2048 px / JPEG 0,82. | Bucket NOU, privat, `executie-uscare` (doar `image/jpeg`, 10 MB): calea `<proiect>/<uscare>/<uuid>.jpg`; comprimare în browser la 1920 px / JPEG 0,82. |
| PDF | jsPDF + html2canvas; tiparul `src/raportDistributiePdf.js`: HTML pur (testabil) → html2canvas → jsPDF. Reguli: `<colgroup>` în procente, signed URL → `fetchAsDataURL` (CORS), 2× `requestAnimationFrame` înainte de captură. | `src/uscareRaport.js` (HTML pur, testat) + `src/uscarePdf.js` (captură, A4 portret, o pagină pentru tabel + anexa foto). |
| Meteo | `meteo_cache`: vremea **curentă** pe șantier (`sites`), reîmprospătată de `meteo-sync` cam la 2 ore; `meteo_istoric_zilnic` (zilnic, Tmin / Tmax) și `meteo_zilnic_xweather` (zilnic, 20261221a). Nu există istoric **pe oră**. | Butonul „🌡️ Din meteo” propune temperatura și vremea curente ale șantierului proiectului (`sites.proiect_id`), cu ora datelor; omul acceptă sau corectează. Se păstrează sursa (`meteo` / `manual`) și ora datelor meteo. Pentru o operațiune trecută nu se propune nimic automat (istoricul e doar zilnic). |
| Restricția pe proiect | 20261209a + 20261213a: `fn_executie_nod_drept(proiect, scriere)` include condiția de proiect (`fn_executie_proiect_permis`); ecranele întreabă dreptul prin RPC-ul `fn_executie_nod_drept`. | Toate politicile și RPC-urile noi folosesc `fn_executie_nod_drept` (clasa „drept” din inventarul 20261209a); redeschiderea: `fn_executie_contract_drept` (nivelul admin). Migrarea verifică pe amprentă tot lanțul acestor funcții, înainte și după. |

## 3. Fluxul

1. **Planificare** — din lista proiectului: „Uscare nouă” pe un tronson de probă (codul și km-ii se completează singuri) sau pe un interval
   liber. Se trec începutul planificat, momentul notificării beneficiarului și referința ei (nr. adresă / mail).
2. **Notificarea cu 24 h** — platforma NU trimite nimic; doar consemnează și **avertizează** dacă notificarea e sub 24 h față de începutul
   real (sau, până la el, cel planificat). Comparația e pe momentul exact, în ora României.
3. **Operațiunea** — pe telefon, pe secțiuni (ordinea modelului): tronson, vremea, utilaje, perioada, pistoane, cântăriri, punct de rouă,
   deplasare; salvare pe parcurs (buton fix jos) + **ciornă locală** în browser (dacă semnalul cade, modificările nu se pierd; la redeschidere
   se oferă restaurarea).
4. **Măsurători și poze** — fiecare secțiune are butonul „📷 Fotografiază” (camera telefonului), pe categoria ei; la cântăriri, pe burete și
   pe intrare / ieșire. Pozele se pot adăuga doar după prima salvare a raportului.
5. **Concluzia** — omul alege CONFORM / NECONFORM (platforma nu decide: pragurile nu sunt date de beneficiar).
6. **Închiderea** — doar dacă toate rubricile modelului sunt completate (în afara observațiilor și a numelor semnatarilor, care se pot scrie
   de mână). Lipsa fotografiilor cerute de beneficiar e afișată ca avertisment (nu blochează: „acolo unde este posibil”).
7. **Raportul semnat** — PDF-ul (tabelul + anexa foto cu legendă) se tipărește și se semnează; un raport neînchis iese marcat „CIORNĂ”.

## 4. Stările

| Stare | Ce se poate | Cine |
|---|---|---|
| `deschisa` | salvare (CAS pe versiune), poze adăugate / scoase, închidere, anulare | scriere pe proiect |
| `inchisa` | NIMIC nu se mai schimbă (nici pozele), pe nicio cale (trigger-e pe tabel). Doar **redeschidere consemnată**: motiv obligatoriu, revizia crește, conținutul închis (raport + lista pozelor) rămâne în jurnal | admin Execuție / owner |
| `anulata` | finală (motiv obligatoriu); nimic nu se mai schimbă | scriere pe proiect, doar din `deschisa` |

Tranzițiile (o singură listă, `fn_executie_uscare_tranzitie` = `TRANZITII` din `src/uscareLogica.js`, test de paritate):
`deschisa → inchisa` (închide), `inchisa → deschisa` (redeschide), `deschisa → anulata` (anulează). Un raport nu se șterge niciodată.

## 5. Matricea de acces

| Cont | Citește rapoartele / pozele | Creează / salvează / poze / închide / anulează | Redeschide |
|---|---|---|---|
| owner | toate proiectele | da | da |
| Execuție `admin`, nerestrâns | toate | da | da |
| Execuție `editor`, nerestrâns | toate | da | nu |
| Execuție `viewer` | toate | nu | nu |
| cont restrâns (manager de proiect), `editor` pe proiect | doar proiectele lui | doar pe proiectele lui | doar dacă are și modulul `admin` |
| cont restrâns, `viewer` pe proiect | doar proiectele lui | nu | nu |
| alt modul / fără drept | nimic | nu | nu |
| anonim | nimic (fără drepturi pe tabele / funcții) | nu | nu |

Scrierea: DOAR prin `fn_executie_uscare_salveaza` / `_stare` / `_poza` (SECURITY DEFINER, `auth.uid()` obligatoriu); niciun drept
INSERT / UPDATE / DELETE pe tabele. Fișierele: încărcare doar cu dreptul de scriere și pe un raport **deschis** al aceluiași proiect din
cale; nicio modificare / ștergere din aplicație (o poză scoasă din raport rămâne în bucket ca dovadă; jurnalul spune care).

## 6. Ce se calculează și ce introduce omul

Calculat (o singură definiție, `src/uscareLogica.js`; nu se stochează, ca să nu existe două adevăruri):

- **Durata (ore)** = ora finalizării − ora începerii, 2 zecimale.
- **Viteza medie (m/s)** = lungimea (m) / (timpul de deplasare (min) × 60), 2 zecimale.
- **Diferența de greutate a buretelui** = ieșire − intrare (kg, 3 zecimale; pozitivă = buretele a reținut apă). Afișată pe ecran, nu e o
  rubrică a modelului.
- **Verificarea celor 24 h** = începutul (real, altfel planificat) − momentul notificării ≥ 24 h, pe momentul exact.
- **Ce lipsește pentru închidere** = aceeași regulă în SQL (`fn_executie_uscare_lipsa`) și în JS (`lipsaDinRand`), paritate verificată pe
  cazuri în proba PGlite.

Introdus de om: toate valorile măsurate, tronsonul, km-ii, lungimea (propusă din km, dar poate diferi), temperatura (sau acceptată din meteo),
utilajele, pistoanele, cântăririle, punctul de rouă, observațiile, **concluzia**, semnatarii, notificarea.

Validări (server, refuz cu mesaj, fără rotunjire tăcută): temperatura −50…60 °C cu o zecimală; punctul de rouă −100…50 °C cu o zecimală;
presiunea 0,01…100 bar cu 2 zecimale; timpul 0,1…10.000 min cu o zecimală; kg 0,001…1000 cu 3 zecimale; bucăți 0…99; cel mult 20 de utilaje
și 20 de bureți; ora finalizării după ora începerii (cel mult 30 de zile); data operației în ultimii 2 ani sau în următoarele 60 de zile.
Acestea sunt limite de plauzibilitate a introducerii, NU criterii de acceptare.

## 7. Ce NU se știe (necunoscute, nu se inventează)

- **Pragul de acceptare pentru punctul de rouă** — beneficiarul nu l-a dat în model sau în mail. Platforma nu calculează „conform”.
- **Criteriul pentru diferența de greutate a buretelui** — nedat.
- **Procedura de uscare** (metoda: aer uscat / azot / vacuum, numărul de treceri, condiția de oprire) — neprimită.
- **Aparatele de măsură** (tip, serie, verificare metrologică) — modelul nu are rubrică; se pot trece la observații.
- **Numărul de exemplare, termenul de predare în zile, formatul fotografiilor** — nespecificate.
- **Calea notificării** și reprezentantul beneficiarului — nespecificate; platforma doar consemnează momentul și referința.
- **Ora fotografiei**: în anexă apare ora ÎNCĂRCĂRII în platformă (nu ora din aparat), scrisă explicit „încărcată la”.

## 8. Schema (migrarea 20261225a)

- `executie_uscari` — operațiunea (rubricile modelului + planificarea + starea, revizia, versiunea, proveniența). Utilajele și cântăririle
  sunt liste JSON cu formă exactă (verificată de `CHECK` pe orice cale); se scriu mereu odată cu raportul, într-un singur RPC.
- `executie_uscare_poze` — categoria (manometru, temperatura, pistoane, cântar intrare, cântar ieșire, punct de rouă, utilaje, altele),
  numărul buretelui (doar la cântăriri), calea fișierului, legenda.
- `executie_uscare_jurnal` — doar adăugare: creare, salvare (diferențele câmp cu câmp), închidere / redeschidere (conținutul complet),
  anulare, poze; cheia de idempotență a fiecărei apăsări (UNIQUE) + amprenta conținutului (aceeași cheie, alt conținut = refuz).
- RLS pe toate trei (citire = `fn_executie_nod_drept(proiect_id, false)`), fără `USING (true)`, fără drepturi de scriere pentru clienți.
- Livrare: runnerul `scripts/livrare_migrare.sh --plafon-tranzactie-ms 2000` (+ amprenta globală L15 v2; manifestul `.l15.tsv` îl generează
  coordonatorul pe clonă). Lock-uri la aplicare (NOWAIT, ≤ 1 s): `executie_proiecte`, `executie_probe_tronsoane` (chei străine),
  `storage.objects` (politicile noi) — de aplicat într-un moment liniștit.
- Revenire: refuză dacă există orice raport / poză / rând de jurnal / fișier; altfel scoate tot ce a creat migrarea.

## 9. Ce NU face prima livrare (pași următori, de decis)

- **Nu sincronizează** etapa „uscare” din Probe pe tronsoane cu raportul (lecția de design: fără copii sincronizate prin trigger-e). Pasul
  următor propus: în fișa tronsonului de probă, lista rapoartelor de uscare legate (citire prin cheia străină), iar starea etapei rămâne
  pusă de om.
- **Nu trimite** notificarea către beneficiar și nu trimite raportul (mailurile rămân la oameni).
- Nu are semnătură electronică: raportul se semnează pe hârtie (sau scanat), după PDF.
- Nu are câmpuri pentru aparatele de măsură / mai multe treceri ale buretelui (modelul nu le are); se pot trece la observații.

## 10. Alegeri făcute (de confirmat de Răzvan)

- **A. Redeschiderea** unui raport închis: doar admin Execuție / owner (ales). Alternativa: orice cont cu scriere pe proiect.
- **B. Pozele cerute** de beneficiar: avertisment la închidere (ales). Alternativa: închiderea blocată până există câte o poză pe categorie.
- **C. Constructorul** propus implicit în raport nou: denumirea firmei (se poate schimba pe raport).
- **D. Diferența de greutate** a buretelui: doar afișată în aplicație, nu în PDF (modelul nu are rubrica).
