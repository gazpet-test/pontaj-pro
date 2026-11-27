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
| D7 | Firma | Nu se alege și nu se afișează; se păstrează doar ca text citit, pentru unicitate. |
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

- Cum se identifică MP-ul în cod: `executie_proiecte.mp_employee_id` și/sau atribuirile din Izometrie — de verificat la PR1.
- Proiectele vechi cu PM / PA-UT scrise de mână: rămân așa sau se încarcă buletinele retroactiv — decide Răzvan.
- Buletine pentru alte metode (RT, VT, PT): intră în arhivă, fără coloană în centralizator.
- Suduri care apar în pachet cu cod greșit (alt tronson, „-”): curățenie separată, pe date, cu preview și „da”.
