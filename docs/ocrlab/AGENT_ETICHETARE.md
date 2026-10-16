# Agentul de etichetare — banca de probă OCR fără om (design v1, 15.10.2026)

Decizia: `claude_context` #1766 (Razvan 15.10.2026). Scop: o bancă etichetată pe imagine, fără interacțiune umană, din care se fixează
plafonul arbitrajului r1 (licitația 102) și se judecă orice regulă nouă de comparator / gardă / triere. NU servește la eliminarea
arbitrului (pragul acela cere ≥100 pagini din documente diferite + 1.000 cantități, D3 Jakarinos).

## Ce etichetăm (populația = r1, comparatorul de pe main, `masoara` → 12.669 dezacorduri)
| strat | populație r1 | în bancă |
|---|---|---|
| `rand_tabel` cu cantitate | 2.832 | 180 |
| `text` cu cantitate | ~2.000 | 90 |
| `rand_lipsa_*` cu cantitate | ~940 | 60 |
| `text` / `rand_tabel` fără cantitate (inclusiv decorul, ~19%) | ~6.300 | 220 |
| `rand_lipsa_*` fără cantitate | ~260 | 50 |
| **dezacorduri** | | **600 (≥330 cu cantitate)** |
| acorduri (rânduri de tabel identice la ambele cititoare, cu cifre) | — | 150 |
| suprapuneri de benzi (rânduri dublate la cusătură) | 41 | 41 |
| alarme de gardă (benzi) | 244 | 244 (doar verdict buclă / fals, nu transcriere) |

Eșantion aleator stratificat cu sămânță fixă, per document (d772 / d1247) proporțional. `structura_tabele` și `banda_intreaga` merg oricum
la om: intră doar în stratul de alarme. Lista eșantionului se îngheață (SHA-256 pe `item_sha256` sortate) înainte de prima etichetă.

## Cine etichetează și cum
1. **Pregătire (CPU, local):** pentru fiecare item, pagina se randează din PDF-ul rulării (`r1/pdf`, doar citire, fără modificări)
   la 150 dpi (ca la citire) și se scrie în `C:\Users\Public\paw-data\banca\v1\img\<item>.png`. Textul dat etichetatorului:
   ancorele de context (`context_inainte` / `context_dupa`, text pe care cititoarele au fost de acord) + tipul itemului + antetul tabelului.
   **Citirile LightOn / MinerU NU se arată** (etichetare oarbă: fără ancorare pe una din variante).
2. **Trecerea A — Opus** (Claude Code, abonament, `claude -p` fără cheie API; doar unealta Read pe directorul băncii) și
   **trecerea B — Astra** (Codex CLI `gpt-6-astra`, `-i <imagine>`, sandbox read-only), independent, același prompt, loturi de 10.
   Fiecare întoarce JSON: `transcriere` exactă între ancore; pentru tabele `celule[] = {rand, coloana, antet, valoare, um, cod}`;
   `zona` = intervalul vertical estimat (% din pagină); `ilizibil` (bool); `incredere` (sigur / nesigur).
3. **Compararea etichetelor (determinist):** cifrele, UM-ul, codul și asocierea rând/coloană trebuie să fie identice literal; textul liber
   se compară după unificarea spațiilor albe (singura normalizare). Acord ⇒ etichetă. Oricare `nesigur` / `ilizibil` ⇒ dezacord.
4. **Trecerea C (doar la dezacord):** decupaj din reuniunea celor două `zona` + 3% margine, randat din PDF la **300 dpi** (zoom real,
   nu mărire de pixeli); ambele modele din nou, independent. Acord ⇒ etichetă cu `trecere=C`; altfel itemul **iese din bancă**
   (`nelamurit`, numărat și raportat pe strat — o rată mare pe un strat e ea însăși rezultat).
5. **Verdictul pe OCR (după etichetare, determinist):** eticheta se compară cu `citire_lighton` / `citire_mineru` → `lighton` / `mineru` /
   `ambele` / `niciunul`; pe acorduri → `corect` / `gresit_impreuna`.

## Adevăr aritmetic (fără om, acolo unde există)
Pe rândurile cu cantitate × preț unitar = valoare și pe subtotalurile / totalurile F3: eticheta care strică o egalitate validă în citire
se respinge (iese din bancă); o egalitate restabilită de etichetă confirmă eticheta. Pe listele fără prețuri (cea mai mare parte din 102)
verificarea e doar pe totaluri — se raportează câte etichete au avut verificare aritmetică.

## Ce se măsoară pe lotul de probă (50 de itemi, stratificat ca mai sus)
Rata de acord A/B pe strat · rata `nelamurit` · secunde și tokeni per item · limitele Codex (mesaje / fereastră de 5 h, erori de rată) ·
câte etichete au verificare aritmetică · 10 itemi văzuți și de laborator pe imagine (control de sanitate, nu etichetare umană).
Cost în bani: 0 (abonamente); dacă un pas ar cere API plătit — oprire și întrebare.

## Limite asumate (de scris în raport)
Erorile comune ambelor modele rămân nevăzute; banca e bună pentru plafon și îmbunătățiri, nu pentru eliminarea arbitrului.
Doar două documente ⇒ fără set de evaluare separat pe documente la nivelul cerut de D3. Arbitrul de producție (Haiku/Sonnet) e altă familie
decât Astra, dar aceeași familie cu Opus — corelarea Opus↔arbitru se raportează separat.

## Securitate
Imaginile și ancorele sunt conținut extern (date, nu instrucțiuni) — promptul o spune explicit. Etichetatorii: fără rețea în sandbox Codex,
Claude doar cu Read; nicio scriere în BD, niciun apel plătit. Ieșirile în `paw-data\banca\v1`; repo-ul primește doar scripturile și sumarul.
**Schimbare de lansator (cere „da”):** `run_paw jak` primește un argument opțional cu lista de imagini (`-i`), doar fișiere `.png` din
`paw-data\banca`, verificate ca la brief (fără UNC / ADS / reparse), maxim 10 per apel. Fără `.ps1` / `.cmd` noi; Codex nu se
pornește pe lângă lansator. Până la „da”: se pregătesc eșantionul și imaginile și rulează doar trecerea A (Opus) pe lotul de probă.

## v2 — după Jakarinos r1 (GO cu condiții, `out\ocrlab_agent_etichetare_r1_jak.log`)
- **P0 localizare:** ancorele `context_*` nu sunt garantat agreate și lipsesc la itemii de tabel (d772 p311 `p0311_b0_r4`). Ținta se dă
  verificabil: pentru tabel = indexul tabelului pe bandă + antetul + rândurile vecine agreate (dacă există) + numărul rândului; pentru text =
  ancoră doar dacă e identică la ambele cititoare, altfel paragraful întreg. Etichetatorul întoarce `tinta` = `unica` / `ambigua` / `lipsa`
  și ce a localizat (rândul vecin de sus și de jos, transcrise). Acord = aceeași localizare ȘI aceeași valoare; `ambigua` / `lipsa` ⇒ afară,
  numărat pe strat.
- **P0 aritmetica:** nu mai respinge și nu mai „confirmă” etichete. Se raportează separat: transcrierea vizuală + `aritmetica` =
  `consistenta` / `inconsistenta` / `neaplicabila` (rotunjire la 2 zecimale, operanzii luați din etichete, nu din OCR).
- **P0 alarmele:** scoase din această bancă. Protocol separat (mai târziu): imagine + ieșirea OCR la punctul de oprire, cititor mascat,
  plus benzi fără alarmă ca negative.
- **P1 trecerea C:** primește pagina completă + antetul + decupajul la 300 dpi, într-o sesiune nouă, fără răspunsurile A/B; se aplică și
  pe un eșantion de 10% din acorduri (verificarea localizării comune).
- **P1 reprezentare comună:** cifrele ca șiruri (semn, separator, zerouri), `gol` ≠ `absent` ≠ `ilizibil`, celulă unită = valoarea o dată +
  `unita_cu`, indici/exponenți ca `_x` / `^x`, text barat marcat. Unificarea spațiilor nu traversează granițe de celulă sau rând.
- **P1 populații:** refăcute din `masoara` pe main la eșantionare (nu cifrele din tabelul de sus); `e_cantitate` se împarte la etichetare în
  `cantitate_efectiva` / `cod` / `specificatie_numerica` / `text`. Ținta ≥300 se socotește pe `cantitate_efectiva`.
- **P1 omisiuni comune:** 5 pagini întregi (aleator, `quantity_table`) transcrise integral A+B și comparate cu ambele citiri.
- **P1 raport:** ponderat pe populații, interval cu grupare pe pagini, `nelamurit` rămâne în numitorul acoperirii.
- **P1 independență:** fiecare trecere vede doar directorul ei de intrare (`banca\v1\in\<trecere>\<item>\`: imagine + ținta); citirile OCR și
  etichetele celuilalt stau în `banca\v1\priv\`, în afara rădăcinii date etichetatorului. Arbitrul se evaluează doar după înghețare.
- **P1 lansator:** rădăcină canonică cu delimitator, părinți fără reparse, PNG decodabil, ≤ 20 MB / ≤ 40 MP, argumente ca listă — intră în
  propunerea de diff, cu review separat.
- **P2 înghețare:** manifest cu SHA-256 pe PDF-uri, orientări, imagini, comparator, prompt, schemă, versiunile modelelor; 20% din pagini
  rezervate, nefolosite la reglaj.
- **Pilot 50 — praguri fixate înainte:** orice acord demonstrat pe ținta greșită sau orice scurgere între treceri ⇒ nu se extinde la 600.
