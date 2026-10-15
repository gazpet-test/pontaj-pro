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
