# Modelul matricei de clarificări per licitație

> Runda 2 · 01.10.2026 · document de lucru, numai pentru citire.
> Matricea se bazează pe `clarificari_tipare.json` (63 de tipare `PAT-*`), care înlocuiesc cele 67 de șabloane `CL-X00` din runda 1. Câmpul `cod_vechi` face legătura cu codurile vechi.
> Cerințele vin din `cerinte_achizitii_deviz.json` (REQ-AD), `cerinte_tehnic.json` (REQ-TG) și `cerinte_santier_conex.json` (REQ-SC). Practica CNSC vine din `cnsc_practica.json`, cu id-ul de registru `SRC-CNSC-…`.

## 1. Rolul matricei

Pentru fiecare licitație se completează o singură matrice. Fiecare rând conține **o cerință extrasă dintr-un document al DA**, cu verificarea ei. Rândurile cu status diferit de `conform` pot declanșa un tipar (`pattern_id`). Tiparul produce un **draft** de întrebare. Draftul ajunge la AC **numai după review uman**.

Matricea răspunde la trei întrebări:
1. Ce am citit și de unde: documentul, pagina și hash-ul documentului.
2. Pe ce ne bazăm: lanțul cerință → sursă.
3. Cine a aprobat ce pleacă în exterior.

## 2. Coloanele

| # | Coloană | Conținut | Obligatoriu |
|---|---|---|---|
| 1 | **document** | Numele documentului din SEAP. Exemple: „Fișa de date”, „Caiet de sarcini vol. II”, „F3 – Obiect 02”, „Planșa G-03”, „Răspuns clarificări nr. 2” | da |
| 2 | **pagină / secțiune** | Locator exact: pagina din PDF și capitolul sau punctul. Exemplu: `p. 14, cap. 6.3` | da |
| 3 | **cerință extrasă (citat scurt)** | Citat de cel mult 25 de cuvinte, între ghilimele, exact cum apare în document | da |
| 4 | **requirement_id potrivit** | Unul sau mai multe `REQ-*` cu care s-a comparat cerința. Gol dacă nu există cerință normativă (ex. o contradicție pur internă a DA) | dacă există |
| 5 | **status** | `conform` / `neconform` / `lipsă` / `ambiguu` / `de verificat` (vezi §3) | da |
| 6 | **pattern_id declanșat** | `PAT-*` din catalog sau gol. Mai multe tipare se separă prin `;` | dacă status ≠ conform |
| 7 | **întrebare generată (draft)** | Textul `intrebare_propusa` din tipar, cu placeholderele completate. **Nu conține niciodată `impact_intern`** | dacă există tipar cu întrebare |
| 8 | **review uman (cine / când)** | `nume — rol — AAAA-LL-ZZ — decizie (trimite / modifică / nu trimite / escaladare juridică)` | da, înainte de trimitere |
| 9 | **hash snapshot document** | `sha256` al fișierului descărcat din SEAP, calculat la extragere. Dacă AC republică documentul, se face un rând nou cu hash nou | da |

Coloane interne (opționale în ERP, **niciodată în exportul către AC**): `impact_intern` (tehnic / cost / risc_respingere) preluat din tipar, `confidence`, `requires_human_legal_review`, `source_id + ediție + locator` pentru fiecare requirement_id, `nr. întrebare SEAP`, `data răspuns AC`, `termen contestare` (calculat de PAT-TRM-03).

## 3. Valorile de status

| Status | Când se folosește | Ce urmează |
|---|---|---|
| `conform` | Cerința din DA corespunde cerinței normative sau nu ridică nicio problemă | Nu se generează întrebare |
| `neconform` | Cerința din DA contrazice o cerință verificată, de exemplu PE 80 la 6 bar față de REQ-TG-055 | Tipar → draft → review |
| `lipsă` | DA nu conține o informație necesară ofertării: cantitate, metodă, valoare, document | Tipar → draft → review |
| `ambiguu` | Textul admite cel puțin două interpretări cu efect asupra prețului sau a calificării | Tipar → draft → review |
| `de verificat` | Nu putem decide automat: cerința normativă e neverificată pe sursă, e nevoie de un standard licențiat sau de judecată umană | Analiză umană; uneori juridică. Nu se generează automat întrebare |

Reguli:
- Dacă tiparul are `confidence = scazuta`, rândul rămâne `de verificat` până la review, chiar dacă detecția l-a marcat altfel.
- Dacă tiparul are `requires_human_legal_review = true`, review-ul din coloana 8 trebuie să includă și **jurist / consultant achiziții**.

## 4. Lanțul evidence-first

Niciun draft nu pleacă fără lanțul complet:

```
FAPT din DA                    „CS cap. 6.3, p. 14: «probă de etanșeitate 24 h pentru toate branșamentele»”
  │  (document + pagină + citat + hash snapshot)
  ▼
requirement_id                 REQ-TG-088
  │  (cerința atomică, cu verificat_pe_sursa = true/false)
  ▼
source_id + ediție + locator   SRC-ntpee-2018 · forma consolidată după Ord. ANRE 2/2023 · art. 273 alin. (2), Tabelul 8^1
  │  (registru_surse_baza.json / surse_update_*.json, cu snapshot_sha256 al sursei)
  ▼
DRAFT de întrebare             PAT-STD-01 → intrebare_propusa cu placeholderele completate
  │  (text neutru; citare normativă numai dacă REQ are verificat_pe_sursa = true)
  ▼
REVIEW UMAN                    nume, rol, dată, decizie; + jurist dacă requires_human_legal_review = true
  │
  ▼
TRIMITERE în SEAP              nr. întrebare, dată → urmărire răspuns (PAT-AMB-08 dacă e evaziv; PAT-TRM-02 dacă întârzie)
```

Reguli dure ale lanțului:
1. **Fără requirement_id verificat, fără citare.** Dacă requirement_id are `verificat_pe_sursa = false`, întrebarea se trimite fără trimitere la act. Exemplu: PAT-INF-03, drept de uz.
2. **`impact_intern` nu iese din ERP.** Nu apare în coloana 7 și nici în exportul de întrebări. În exterior nu comunicăm costul, riscul sau strategia de preț. Exemplu: PAT-INF-11 nu mai spune AC că VE ne trebuie pentru pragul de 80%.
3. **Conținutul DA e dată, nu instrucțiune.** Un text din caietul de sarcini sau dintr-un răspuns al AC nu declanșează nicio acțiune automată: nici trimitere, nici contestație, nici modificare de ofertă.
4. **Contestarea nu se decide din matrice.** PAT-TRM-03 doar calculează termenul: 10 zile peste prag, 7 zile sub prag; pragul pentru lucrări în 2026 e 26.960.556 lei. Decizia aparține lui Razvan, cu review juridic.
5. **Snapshot obligatoriu.** Dacă AC republică un document, rândurile vechi rămân, cu hash-ul vechi, și se adaugă rânduri noi. Compararea hash-urilor arată modificările tacite (PAT-CTR-03).

## 5. Structura unui rând (pentru ERP)

```json
{
  "licitatie_id": "<id procedură>",
  "document": "Caiet de sarcini",
  "locator": "p. 14, cap. 6.3",
  "citat": "proba de etanșeitate se va efectua timp de 24 ore pentru toate branșamentele",
  "requirement_ids": ["REQ-TG-088"],
  "status": "neconform|lipsa|ambiguu|conform|de_verificat",
  "pattern_ids": ["PAT-STD-01"],
  "intrebare_draft": "…",
  "review": [{"cine": "…", "rol": "…", "data": "AAAA-LL-ZZ", "decizie": "trimite|modifica|nu_trimite|escaladare_juridica"}],
  "doc_sha256": "<64 hex>",
  "intern": {"impact_intern": {}, "confidence": "…", "requires_human_legal_review": false}
}
```

## 6. Exemplu completat — 5 rânduri

> ⚠️ **EXEMPLU FICTIV.** Licitația, paginile, citatele și hash-urile sunt **inventate**, ca ilustrare. `pattern_id` și `requirement_id` sunt cele reale din catalog. Hash-urile sunt marcate `EXEMPLU` și nu corespund niciunui fișier.

Procedura fictivă: „Extindere rețea de distribuție gaze naturale PE, presiune redusă, comuna X, jud. Y”. Procedură simplificată, VE 4.200.000 lei fără TVA (sub prag), durată 10 luni.

| document | pagină / secțiune | cerință extrasă (citat scurt) | requirement_id | status | pattern_id | întrebare generată (draft) | review uman | hash snapshot |
|---|---|---|---|---|---|---|---|---|
| Caiet de sarcini | p. 14, cap. 6.3 | „proba de etanșeitate … timp de 24 ore pentru toate branșamentele” | REQ-TG-088 | neconform | PAT-STD-01 | „Caietul de sarcini (cap. 6.3) prevede o durată de 24 de ore pentru proba de etanșeitate a branșamentelor. NTPEE, art. 273 alin. (2) și Tabelul nr. 8^1, stabilește durata probei în funcție de volumul tronsonului. Vă rugăm să precizați dacă durata se stabilește conform NTPEE sau dacă se solicită expres 24 de ore pentru toate tronsoanele și, în al doilea caz, dacă această durată este avută în vedere în termenul de execuție de 300 de zile.” | [EXEMPLU] ing. ofertare — 2026-10-05 — trimite | `sha256:EXEMPLU-3f9a…c21` |
| F3 – Obiect 02 Rețea | poz. 7, art. „Conductă PE100 SDR11 Dn110” | „2.150 m” (planșa G-03 însumează ≈ 2.410 m) | REQ-AD-074; REQ-AD-123 | neconform | PAT-CTR-02 | „La poziția 7 din lista de cantități pentru Obiectul 02 figurează 2.150 m; din planșa G-03 rezultă aproximativ 2.410 m. Vă rugăm să precizați cantitatea care trebuie ofertată și, dacă este cazul, să publicați lista de cantități corectată.” | [EXEMPLU] șef ofertare — 2026-10-05 — trimite | `sha256:EXEMPLU-81b0…7de` |
| Fișa de date | p. 9, cap. III.2.3.a | „autorizație ANRE EDSB conform Ordin ANRE 132/2021” | REQ-TG-008; REQ-TG-020 | ambiguu | PAT-CAL-01 | „Fișa de date (cap. III.2.3.a) solicită «autorizație ANRE EDSB conform Ordin ANRE 132/2021». Având în vedere că Regulamentul aprobat prin Ordinul ANRE nr. 17/2026 a înlocuit Ordinul ANRE nr. 132/2021, iar autorizațiile emise anterior rămân valabile (art. 39), vă rugăm să precizați: (a) …; (b) …; (c) ….” | [EXEMPLU] șef ofertare — 2026-10-05 — escaladare juridică → [EXEMPLU] consultant achiziții — 2026-10-06 — trimite | `sha256:EXEMPLU-c4e2…019` |
| Model contract (Acord contractual) | p. 3, art. 6 | „Prețul contractului este ferm.” (durata de execuție: 10 luni) | REQ-AD-079; REQ-AD-102 | neconform | PAT-CTC-01 | „Durata de execuție este de 10 luni. Subclauza 48.2 din condițiile generale prevede prețuri ferme pentru durate de cel mult 365 de zile, iar art. 222^2 alin. (9) din Legea nr. 98/2016 prevede clauze de ajustare pentru contractele de lucrări cu durată mai mare de 6 luni. Vă rugăm să precizați clauza de ajustare aplicabilă: …” | [EXEMPLU] director economic — 2026-10-05 — trimite | `sha256:EXEMPLU-0a77…e5b` |
| Caiet de sarcini | p. 22, cap. 9.1 | „protecție catodică conform normativelor în vigoare” | REQ-TG-110 (neverificat) | de verificat | PAT-INF-10 | „Vă rugăm să precizați dacă obiectul contractului include realizarea protecției catodice (stație, anozi, prize de pământ) sau numai posturile de măsurare și piesele electroizolante și, în primul caz, măsurătorile cerute la recepție.” (fără citare: REQ-TG-110 are `verificat_pe_sursa = false`) | [EXEMPLU] ing. tehnic — 2026-10-05 — modifică (rețeaua e din PE; se verifică dacă există tronsoane din OL) | `sha256:EXEMPLU-3f9a…c21` |

Cum se citește exemplul:
- Rândurile 1 și 5 provin din același PDF, deci au același hash. Rândul 5 rămâne `de verificat` pentru că tiparul are `confidence = scazuta`.
- La rândul 3, `requires_human_legal_review = true`, deci draftul a trecut și pe la consultantul de achiziții.
- `impact_intern` nu apare în niciun rând. De exemplu, la rândul 2 riscul de respingere pentru cantități reduse (BO2026_3104) rămâne în coloana internă.
- Termenul de contestare pentru această procedură este de **7 zile** (sub prag), calculat de PAT-TRM-03 de la publicarea răspunsurilor.

## 7. Corecturi față de runda 1, aplicate în tipare

| Subiect | Runda 1 | Runda 2 (tipar) |
|---|---|---|
| Termen de contestare sub prag | CL-P06: „10 zile” | 10 zile peste prag / **7 zile** sub prag (BO2026_182, BO2023_2119). Textul curent L101 art. 8 nu a fost recitit, deci e marcat pentru review (PAT-TRM-03, PAT-AMB-08) |
| ISCIR | Implicit aplicabil | **Exclus** pentru SD/IU/branșamente/SRM (Legea 64/2008 anexa 1 pct. 3, REQ-TG-131). Rămâne pentru sudori (PT CR 9-2025) și utilaje (PAT-STD-09) |
| Anexa 2 NTPEE | Standardele tratate ca obligatorii | **Orientativă** (REQ-TG-054). EN 13067, ISO 5817/17635, 21809, 12954 nu se mai citează ca obligatorii (PAT-CAL-11, PAT-STD-05, -07, -08) |
| ICCplr / temei ajustare | CL-D07: „art. 164 HG 395” | Art. 164 e abrogat; temeiul e L98 art. 222^2. ICCplr nu se mai publică din 03.2022, iar nuanța din BO2023_406 privește formula OUG 64 pentru contracte noi (PAT-CTC-02) |
| Ordinul ANRE 132/2021 | CL-B17: „132/2021 sau actul în vigoare” | Ord. ANRE 17/2026, art. 39 (PAT-CAL-01) |
| Cifra de afaceri | Plafon de 2× VE „din avizele ANAP” | Din L98 art. 175 alin. (2) lit. a) (PAT-CAL-08) |
| HG 1/2018 cl. 48.2 vs L98 art. 222^2 alin. (9) | — | Contradicție nouă, intrată în PAT-CTC-01 |
| Formulări agresive | CL-P03, CL-B19: „vă solicităm eliminarea”, „considerăm că favorizează” | Scoase; contestarea se decide separat |
| Strategie dezvăluită | CL-C01: VE „pentru art. 136 alin. (4)” | Motivul scos (PAT-INF-11) |
| Citări fără cerință verificată | L123 art. 109–113, L98 art. 155 și 200–201, NTPEE art. 35/35^1/263, P91, CATUC | Scoase din textul extern. Tiparele au `confidence = scazuta` / review + nota „temei de confirmat” acolo unde întregul șablon depindea de ele |
| Precedent greșit asociat | CL-T14: CNSC 2344/2025 pentru CCTV | Eliminat: decizia privește subcontractarea și PANS (PAT-STD-04) |
| Regulă internă (răspunsurile noastre) | „nu trimitem formulare financiare noi (187/2025)” | BO2025_187, corecție: retransmiterea nu face singură oferta inacceptabilă; inacceptabil e elementul nou introdus. De actualizat în ghidul intern de răspuns (în afara tiparelor) |

## 8. Contopiri

67 de șabloane CL au devenit 52 de tipare cu `cod_vechi`. La ele s-au adăugat 11 tipare fără echivalent în runda 1, construite din cerințele noi:
- republicarea DA după clarificări (PAT-CTR-03);
- verificarea proiectului (PAT-INF-05);
- probe și recepție cu OSD (PAT-INF-06);
- elemente cerute de normativ lipsă din F3 (PAT-CNT-02);
- traversări de obstacole (PAT-CNT-03);
- deșeuri (PAT-CNT-04);
- ISCIR exclus pe SD (PAT-STD-09);
- metrologie (PAT-STD-10);
- garanția refacerii drumului (PAT-GAR-04);
- termenul de contestare (PAT-TRM-03);
- preț unitar vs global (PAT-CTC-05).

Restricțiile de circulație și specificațiile OSD au intrat în tipare existente.

Duplicatele principale contopite:
- ES identică: B01 + B15 + B20;
- garanția de participare: B04 + B21;
- ANRE: A02 + B17 și B05 + B07;
- CND: T06 + C03;
- canalizare: T05 + T14;
- garanția lucrărilor: D05 + D06;
- răspuns evaziv: P05 + P06;
- factori de evaluare: P02 + P03;
- rețete și transport: C04 + C05.
