# Izometrie — Buletine NDT pe suduri (specificație)

Stare: **propunere**, 27.11.2026. Deciziile de mai jos sunt ale lui Răzvan, luate în chat pe 27.11.2026.
Nimic nu e implementat. Schema, funcția edge și costul AI se aplică doar cu „da” separat (CLAUDE.md pct. 3, 7, 10).

## 1. De ce

Coloanele PM / PA-UT / UT din pachetul de lansare sunt text scris de mână. Nu sunt legate de niciun document,
nu există arhivă de buletine, iar pe tronsoanele noi sunt goale. Exportul Transgaz pleacă fără buletine.

## 2. Ce se livrează

1. Arhivă de buletine NDT pe tronson, cu PDF-ul original.
2. Rândurile buletinului (sudură, rezultat, dată, indicații), citite cu AI și confirmate de om.
3. Coloanele PM / PA-UT / UT completate din arhivă, în editorul de pachet și în Excel.
4. Exportul Transgaz ca ZIP: Excel + PDF-urile buletinelor aferente.
5. Blocarea exportului când lipsesc informații, cu lista lipsurilor și deblocare explicită de către MP.

## 3. Decizii luate

| # | Subiect | Decizie |
|---|---|---|
| D1 | Codul sudurii | ERP-ul rămâne pe `T12S127`. Codul din buletin se normalizează la citire. |
| D2 | Suduri refăcute | Se păstrează ambele rânduri: cel respins și refacerea „R” acceptată. |
| D3 | Unde apar buletinele | În tabel (editor + foaia CENTRALIZATOR), nu în partea desenată a schemei. |
| D4 | Citirea | AI citește anexa, un al doilea model verifică independent, omul confirmă. |
| D5 | Modele | Citire: Haiku. Verificare: Sonnet. Schimbabile din setare. |
| D6 | Tronsonul | Se ia din locul încărcării, nu se alege. |
| D7 | Firma | Nu se alege și nu se afișează; se păstrează doar ca text citit, informativ (nu intră în cheia de unicitate, R1). |
| D8 | Export | ZIP cu Excel + PDF-uri, plus foaia „BULETINE” în Excel. |
| D9 | Cine încarcă | Doar managerul de proiect (și owner-ul). |
| D10 | Metode obligatorii | Setare pe proiect. |
| D11 | Export incomplet | Blocat, cu deblocare de MP: click explicit + text de avertisment. |

## 4. Date

Două tabele noi (numele finale se stabilesc la PR1):

**Buletin** — proiect, tronson, metodă (`PM` / `PA-UT` / `UT` / alta), număr, data buletinului, firma citită (text),
calea PDF-ului în Storage, amprenta SHA-256 a fișierului, starea (`ciorna` / `confirmat` / `anulat`),
cine a încărcat și când, cine a confirmat și când, citirile brute ale celor două modele (pentru audit).

**Rând de buletin** — buletin, codul brut din document, codul normalizat, sufix „R”, rezultat (`acceptat` / `respins`),
data inspecției, indicații (start, end, lungime, înălțime, adâncime), observații.

Unicitate:
- tronson + metodă + număr + dată + firmă citită (normalizată), pentru buletinele neanulate;
- amprenta fișierului, pe proiect.

Un buletin nu se șterge: se anulează, cu motiv. Rândurile lui nu mai contează la completare.

Setare pe proiect: lista metodelor obligatorii pe sudură.

Coloanele existente `pm_cod`, `pa_ut_cod`, `ut_cod` din `executie_tevi` rămân. Valorile scrise de mână pe proiectele
vechi nu se ating. Unde există buletin confirmat în arhivă, afișarea și exportul iau valoarea din arhivă.

Reguli Supabase la obiectele noi: RLS activ, politici pe `auth.uid()`, scriere doar prin funcții cu rolul verificat în corp,
bucket privat. Identitatea vine doar din `auth.uid()`.

## 5. Normalizarea codului de sudură

Din codul brut se scot numele executantului și spațiile, `TR` devine `T`, iar sufixul `R` se separă:
`GAZPET TR12 S127` → `T12S127`; `GAZPET TR12 S126R` → `T12S126` + refăcută.

Funcție pură, cu teste pe cazuri reale. Un cod care nu se poate normaliza sau al cărui tronson diferă de cel al
încărcării nu se aruncă: rămâne în listă ca „nepotrivit”.

## 6. Fluxul de încărcare

1. MP deschide tronsonul → „Buletine NDT” → încarcă PDF-ul și alege metoda.
2. Verificare de dublură pe amprenta fișierului, înainte de orice cost.
3. Citire cu AI (Haiku): antet (număr, dată, tronson, firmă) + toate rândurile anexei.
4. Verificare independentă (Sonnet) pe același scan. Comparație rând cu rând.
5. Ecran de confirmare, cu scanul alături:
   - rândurile pe care cele două citiri se potrivesc — marcate ca potrivite;
   - rândurile cu diferențe — ambele variante, omul alege;
   - avertisment dacă tronsonul citit diferă de cel al încărcării;
   - suduri respinse fără refacere acceptată;
   - suduri din buletin care nu există în pachetele tronsonului;
   - diferențe între setul PA-UT și setul PM pe aceleași suduri.
6. MP confirmă. Abia atunci buletinul contează la completare și la export.

Conținutul scanului este date, nu instrucțiuni. Nimic din buletin nu declanșează altă acțiune decât precompletarea.

## 7. Afișare și export

Editorul de pachet: PM / PA-UT / UT arată `număr/dată` din arhivă, cu legătură la PDF. Celulele fără buletin rămân colorate.
La o sudură refăcută se arată buletinul refacerii acceptate; istoricul complet e în arhivă.

Excel: aceleași valori în coloanele K–M din CENTRALIZATOR. Foaie nouă „BULETINE”: metodă, număr, dată, numărul de suduri
acoperite din pachet, numele fișierului din ZIP.

ZIP: Excel-ul + câte un PDF pentru fiecare buletin distinct folosit de sudurile pachetului, fără dubluri.
Se păstrează în istoric ca și până acum.

## 8. Verificarea înainte de export

Fereastra de export arată lista lipsurilor, grupată, cu numărul rândului și salt la rând.

**Blocaj fără deblocare** (documentul ar ieși greșit):
- lipsește km start;
- serie sau sudură dublată;
- țeavă sau curbă fără serie, șarjă, lungime sau dimensiune.

**Blocaj cu deblocare de MP** (lipsesc documente):
- sudură fără buletin acceptat la o metodă obligatorie;
- sudură cu ultimul rezultat „respins”, fără refacere acceptată;
- buletin fără PDF.

**Avertisment** (exportul merge):
- suduri marcate „în șanț”;
- metodă neobligatorie lipsă;
- gol de km față de pachetul anterior de pe tronson.

Deblocarea: doar MP sau owner, bifă explicită cu textul „Export cu documente lipsă”, motiv obligatoriu.
Se înregistrează cine, când, motivul și lista lipsurilor din acel moment. Exportul deblocat poartă „INCOMPLET” în numele
fișierului, iar foaia „BULETINE” listează ce lipsea.

## 9. Fișa de securitate a citirii cu AI (pct. 7)

- (a) Conținut extern citit: scanul buletinului, emis de un laborator terț.
- (b) Ce scrie: doar ciorna buletinului și rândurile ei. Nu trimite mailuri, nu atinge bani sau drepturi.
- (c) Identitate: de stabilit la PR2; dacă e nevoie de `service_role`, se justifică acolo.
- (d) Cine o pornește: MP-ul proiectului sau owner-ul, verificat în cod, nu doar `verify_jwt`.
- (e) Confirmare umană: obligatorie înainte ca buletinul să conteze. Plafon de cost lunar, cu rezervare atomică.

## 10. Etape

| PR | Conținut | Condiții |
|---|---|---|
| PR1 | Tabele, setarea pe proiect, funcțiile de scriere, bucket, revenire | review + probă pe clonă + „da” la aplicare |
| PR2 | Ecranul „Buletine NDT”, funcția edge de citire + verificare, normalizarea | „da” la deploy; rând în `automatizari` + `registru_automatizari` |
| PR3 | Coloanele din arhivă în editor și Excel, foaia „BULETINE”, ZIP, verificarea înainte de export, deblocarea | după PR1 aplicat |

## 11. Proba modelelor (27.11.2026)

Un buletin PA-UT real, 3 pagini scanate, 75 de rânduri (două respinse cu indicații, două refaceri).
Haiku, Sonnet, Opus și Fable au citit toate 75 de rânduri fără abateri. Antetul a ieșit formulat diferit de la model la model,
de aceea metoda o alege omul, iar tronsonul vine din locul încărcării.
Limite: un singur buletin, scan curat, un singur laborator; referința a fost construită din scan, fără verificare umană.

## 12. Deschise

- Proiectele vechi cu PM / PA-UT scrise de mână: rămân așa deocamdată (D13).
- Buletine pentru alte metode (RT, VT, PT): intră în arhivă, fără coloană în centralizator.
- Suduri care apar în pachet cu cod greșit (alt tronson, „-”): curățenie separată, pe date, cu preview și „da”.

## 13. Decizii adăugate (27.11.2026, după-amiază)

| # | Subiect | Decizie |
|---|---|---|
| D12 | Cine e MP | Managerul de proiect setat pe proiect (`executie_proiecte.mp_employee_id`). Fiecare proiect are unul. |
| D13 | Proiectele vechi | Nu se ating acum; buletinele retroactive vin după ce se termină lucrarea de față. |
| D14 | Două exporturi | „Export IZO înainte de lansare” (cel de azi, redenumit) și „Export INVENTAR după lansare” (nou). |
| D15 | Inventarul | Pe pachet (butonul din pachet) și cumulat pe tronson / lot. |
| D16 | Coordonate | Le încarcă MP-ul, pe tronson. Tot ce are coordonate confirmate intră în inventar. |
| D17 | Clasa de locație | Intervale de km pe tronson, citite o dată din schema de montaj și confirmate de MP (§15). |
| D18 | Sufixe de sudură | `R` = refacerea aceleiași suduri. Orice altă literă (A, B, C…) = sudură distinctă (cuplare sau cupon). |
| D19 | Pachete de la subcontractor | Intră ca pachete aprobate (§17). Se cer ambele fișiere: Excel-ul centralizatorului și PDF-ul aprobat; dacă Excel-ul lipsește totuși, rezerva este citirea AI din PDF (acceptată de Răzvan). |

## 14. Codul sudurii — completare la §5

- `T12S126R` → sudura `T12S126`, refăcută. Aceeași sudură, două rânduri de buletin.
- `T17S50A`, `T17S50H` → suduri de sine stătătoare; litera face parte din cod. Apar la cuplări sau când o sudură
  reparată de trei ori se taie și se introduce un cupon (rezultă două suduri noi).
- Sudura tăiată și înlocuită prin cupon rămâne în arhivă cu buletinele ei, marcată „eliminată prin tăiere”,
  și nu mai blochează exportul.
- Seria de litere nu ajunge la `R` (confirmat de Răzvan), deci `R` final înseamnă mereu refacere.

## 15. Clasa de locație

Clasa ține de traseu, nu de țeavă: se păstrează ca intervale de km pe tronson (de la – până la → clasă).

1. MP încarcă schema de montaj a tronsonului (una pe tronson, 12–16 pagini pe proiect).
2. AI citește intervalele, MP le confirmă. O singură dată pe tronson.
3. Fiecare sudură își ia clasa din POZ KM.
4. Avertisment dacă grosimea elementului nu se potrivește cu clasa; sudurile de la granița dintre două clase se confirmă de om.

## 16. Coordonate și Export INVENTAR după lansare

**Fișierul de coordonate**: text, câte o sudură pe rând: `cod X Y Z`. Se încarcă pe tronson, de către MP.

La încărcare nimic nu se pierde tacit. Se afișează și se rezolvă de om:
- coduri nesigure (cu `?`), coduri în alt format, dubluri cu coordonate diferite;
- suduri din fișier care nu există în pachete; suduri din pachete fără coordonate;
- distanța dintre două suduri vecine, calculată din coordonate, față de lungimea elementului dintre ele
  (prinde coduri greșite și propune codul la cele nesigure).

O sudură are o singură poziție confirmată; o reîncărcare cu alte valori cere confirmare și păstrează istoricul.

**Inventarul**: un rând pe sudură — lot, nr. sudură, nr. pachet de lansare (cu revizie), nr. situație de lucrări, tronson,
clasă de locație, elementul amonte (tip, diametru, grosime, lungime, serie, șarjă), elementul aval (la fel), X, Y, Z,
rubrica de semnătură a antreprenorului. Amonte = elementul de pe rândul sudurii, aval = elementul următor,
inclusiv peste granița dintre două pachete.

Verificarea înainte de export urmează §8: blocaj fără deblocare la date care ar da un document greșit
(element fără serie / lungime, sudură fără element aval), blocaj cu deblocare de MP la coordonate sau clasă lipsă.
Coloana „nr. situație de lucrări” rămâne goală până există sursa ei.

## 17. Pachete executate de subcontractor

Pachetele subcontractorului nu se construiesc în ERP; sosesc gata aprobate.

1. „Pachet de la subcontractor” pe tronson: codul și revizia reale, PDF-ul aprobat atașat, starea direct „aprobat”,
   marcat ca executat de subcontractor.
2. Rândurile: din Excel-ul centralizatorului (se cere mereu, D19; importul existent, fără cost). Dacă subcontractorul
   nu îl dă, rezerva este citirea cu AI din PDF-ul aprobat, cu verificare independentă și confirmare umană, ca la buletine.
3. Ambele fișiere se încarcă în aceeași fereastră și rămân în arhiva de documente a pachetului.
4. De aici pachetul se poartă ca oricare altul: buletine, coordonate, inventar.

## 18. Starea datelor pe Lot 2 (constatare, doar citire)

- În ERP, T12 are două pachete mari în ciornă; documentele reale sunt mai multe și grupate altfel.
  Seriile se potrivesc, gruparea nu. Refacerea grupării este modificare de date: preview + „da”.
- Tronsoanele executate de subcontractor nu au pachete în ERP; intră prin §17.

## 19. Etape — actualizare

| PR | Conținut |
|---|---|
| PR1 | Baza de date: buletine + rânduri, setarea de metode, coordonate, intervale de clasă, marcajul de subcontractor |
| PR2 | Buletine NDT: ecran, citire AI + verificare, normalizarea codului |
| PR3 | „Export IZO înainte de lansare”: coloanele din arhivă, ZIP, verificarea și deblocarea |
| PR4 | Coordonate + clasă de locație: încărcare, verificări, confirmare |
| PR5 | „Export INVENTAR după lansare”: pe pachet și cumulat |
| PR6 | Pachete de la subcontractor |

## 20. Copia pe NAS (amânat)

Documentele rămân în ERP, care e sursa. Copierea lor pe NAS, în folderul proiectului, se analizează după PR6:
există deja un mecanism de trimitere pe NAS folosit la facturi, iar proiectele au calea folderului în fișă
(nu toate o au completată). Se face doar dacă mecanismul existent primește o destinație pe proiect fără schimbări mari.

## 21. Reguli precizate după review-ul Jakarinos r1 (27.11.2026)

**R1. Identitatea unui buletin.** Cheia este tronson + metodă + număr + data buletinului. Firma citită NU intră în cheie
(citirea ei variază: „LAB SRL” / „LAB S.R.L.”). Dacă cheia există deja, încărcarea se oprește cu „buletin deja încărcat”
și legătura la cel existent. Cazul rar a două laboratoare cu același număr și aceeași dată pe același tronson:
MP poate forța a doua încărcare doar cu motiv, înregistrat. Amprenta fișierului (SHA-256) e unică doar printre buletinele
neanulate: un buletin anulat poate fi reîncărcat.

**R2. Legătura cu sudurile se face pe cheia sudurii** (tronson + număr + sufix + refacută), nu pe id-ul rândului de pachet.
Reimportul unui pachet nu pierde buletinele, coordonatele sau clasa: ele se reatașează singure la aceleași coduri.

**R3. Rezultatul valabil pe o sudură și o metodă.** Rândurile confirmate (din buletine neanulate) se ordonează după
data inspecției, apoi refacerea (`R`) înaintea originalului, apoi data buletinului. Primul dă starea. Un buletin vechi
încărcat târziu nu bate o refacere mai nouă, pentru că ordinea e după data inspecției, nu după data încărcării.
Două rânduri cu aceeași dată și același tip, rezultate diferite → stare „conflict”, rezolvată de MP (anulează buletinul greșit).

**R4. Sudura tăiată (cupon).** Marcaj separat pe cheia sudurii: „eliminată prin tăiere”, cu motiv, autor, dată, plus sudurile
noi care o înlocuiesc (opțional). O sudură eliminată nu mai e cerută la buletine, la coordonate sau în inventar;
buletinele ei rămân în arhivă. Marcajul îl pune MP și se poate retrage cu motiv.

**R5. Buletin pe tronsonul greșit / confirmat greșit.** Nu se corectează pe loc: MP îl anulează (cu motiv) și îl reîncarcă
corect. Anularea e permisă oricând; efectul pe exporturile deja făcute e la R6.

**R6. Exporturi și schimbări ulterioare.** Fiecare export păstrează lista exactă a buletinelor (id + versiune), a coordonatelor
și a lipsurilor din acel moment. Dacă după export se anulează / confirmă un buletin, se schimbă coordonatele sau clasa pe
sudurile pachetului, pachetul arată „export depășit — sursele s-au schimbat după <data>”, cu lista diferențelor.
Exportul vechi rămâne în istoric; nu se blochează nimic, un export nou face versiunea curentă. Verificarea și generarea
folosesc aceeași fotografie a datelor (citită o dată, la deschiderea ferestrei de export; dacă se schimbă până la click,
exportul cere reîncărcarea ferestrei).

**R7. Ordinea fizică a sudurilor (inventar).** Pe un tronson: pachetele active (ultima revizie) ordonate după km start,
iar în pachet după poziție. Amonte = elementul de pe rândul sudurii, aval = următorul element în această ordine,
inclusiv peste granița dintre pachete. Inventarul cumulat elimină dublurile pe cheia sudurii (rămâne apariția din pachetul cu
revizia cea mai nouă; conflictul se listează).

**R8. Ce intră în inventar și ce blochează.** Intră sudurile cu coordonate confirmate, neeliminate. Regulile proprii (nu tot §8):
- blocaj fără deblocare: element fără serie sau lungime; sudură cu două poziții confirmate diferite;
- blocaj cu deblocare de MP: sudură din pachet fără coordonate (exportul deblocat le lasă afară și le listează), clasă lipsă;
- avertisment: ultima sudură a tronsonului fără element aval (capăt de tronson), abateri de distanță.

**R9. Dreptul.** O singură funcție de drept: scriere = owner SAU managerul proiectului
(`profiles.id = auth.uid()` și `profiles.employee_id = executie_proiecte.mp_employee_id`), plus restricția pe proiect existentă
(`fn_executie_proiect_permis(proiect, true)`). Citire = accesul de citire existent la pachetele Execuției pe proiect
(`fn_executie_pachete_acces(false)` + `fn_executie_proiect_permis(proiect, false)`). Nicio altă categorie. Toate scrierile prin
funcții care verifică dreptul în corp; tabelele au doar SELECT pentru clienți. Cine a încărcat / confirmat / anulat, când și
amprenta fișierului le pune serverul, nu clientul.

**R10. Costul AI.** Toate citirile acestui modul (buletine, clasă de locație, pachete de subcontractor) folosesc același plafon
lunar din `ai_plafon_lunar` (cheie proprie), cu rezervare atomică înainte de apel și decontare după. O citire = Haiku + Sonnet.
Plafonul se fixează de Răzvan; peste plafon citirea se refuză clar, iar încărcarea manuală (fără AI) rămâne posibilă.

**R11. Împărțirea PR1.** PR1a: buletine, rânduri, metode obligatorii, sudurile eliminate, deblocările și fotografia exporturilor
(tot ce trebuie pentru PR2 și PR3). PR1b: coordonate, intervale de clasă (fără suprapuneri: constrângere de excludere pe tronson),
marcajul de subcontractor. Coordonatele: sistemul din fișierele livrate (Stereo 70, metri, 3 zecimale), stocate ca numeric.

## 22. Precizări după review-ul Jakarinos r2 (contractul PR1a)

- **Cheia sudurii** (pentru coordonate, eliminare, potrivirea cu pachetul) = tronson + număr + sufix, FĂRĂ refacere:
  `T12S126` și `T12S126R` sunt aceeași sudură (D18). Refacerea e un atribut al rândului de buletin, nu parte din cheie.
- **Unicitatea buletinului**: cheia R1 se aplică între buletinele neanulate și neforțate. Un buletin forțat (cu motiv) nu ocupă cheia;
  se identifică prin id. Buletinele anulate nu ocupă nici cheia, nici amprenta.
- **Ordinea rezultatelor (R3), complet deterministă**: pe cheie de sudură și metodă, rândurile din buletine confirmate se ordonează
  descrescător după data inspecției; la aceeași dată, refacerea înaintea originalului; apoi data buletinului descrescător; apoi id-ul
  buletinului descrescător. Primul rând dă starea. „Conflict” = printre rândurile cu aceeași dată de inspecție și același atribut de refacere
  ca primul rând există rezultate diferite (oricâte buletine ar fi, nu doar primele două: un al treilea „acceptat” nu poate
  ascunde un „respins” de la aceeași inspecție — decizia chat-ului 27.11.2026, după review-ul PR #1213); starea rămâne
  „conflict” până când MP anulează buletinul greșit. Refaceri repetate: aceeași regulă
  (ultima după dată câștigă).
- **Stările buletinului**: ciornă → confirmat → anulat; ciornă → anulat. Niciun drum înapoi; corectura = anulare + reîncărcare.
  Rândurile se scriu o singură dată, la confirmare, și nu se modifică.
- **Metoda „ALTA” / PT / RT / VT**: intră în arhivă, nu au coloană în centralizator și nu pot fi obligatorii.
- **Fotografia exportului (R6)** cuprinde: id + versiune pentru fiecare buletin folosit, cheile sudurilor eliminate active,
  metodele obligatorii, lipsurile. „Export depășit” = oricare dintre acestea diferă la recitire. Verificarea și generarea folosesc
  aceeași citire; exportul se înregistrează cu fotografia folosită.
- **Proveniența**: autorul, momentele, versiunea, cheile sudurilor le pune serverul. Amprenta fișierului e declarată de client
  (serverul nu citește conținutul din Storage) și servește doar la prinderea dublurilor; fișierul trebuie să fie în arhiva tronsonului,
  încărcat de același utilizator.
- Contractul exact (tabele, constrângeri, funcții): migrarea PR1a, `supabase/migrations/20270114a_izometrie_buletine_ndt.sql`.
