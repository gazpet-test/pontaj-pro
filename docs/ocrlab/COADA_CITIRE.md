# Coada de citire OCR local (24.11.2026)

Decizia Răzvan (varianta A): sesiunile (Cowork, chat, juridic) **nu pornesc modele**. Ele **cer** citirea; un singur proces
pe serverul AI (`coada lucreaza`, pornit de Task Scheduler) rulează cererile pe rând: LightOn pe tot lotul, apoi MinerU,
apoi compararea. Regula OCR rămâne: doi cititori, dezacordurile pe cantități merg la om, nicio cifră din scanuri în ERP
fără confirmare umană. Codul: `scripts/ocr_local/coada.py`; teste: `scripts/ocr_local/tests/coada/`.

## Pentru sesiuni (o pagină)

Toate comenzile rulează pe server, din `<clona>\scripts`, cu `<py>` = interpretorul env_mineru. Ieșirea e JSON; codul 2 = refuz
(motivul în `eroare`), nimic scris.

| Ce | Comanda |
|---|---|
| 1. Planul (CPU, ca până acum) | `<py> -B -m ocr_local plan <sursa.pdf> --output C:/Users/Public/paw-data/<lucrare>/ocr_plan/<nume> [--pagini ...] [--orientari orientari.json]` |
| 2. Cererea | `<py> -B -m ocr_local coada adauga <plan_dir> [<plan_dir> ...] --cine chat` (`--cine`: litere, cifre, `_ . -`, max 40) |
| 3. Starea | `<py> -B -m ocr_local coada stare [--cine chat]` |
| 4. Anularea | `<py> -B -m ocr_local coada anuleaza c000012` (doar cererile `asteapta`) |

- **Ce se acceptă:** un director cu `plan.json` complet (`plan_complete`, imaginile neschimbate), **sub `C:\Users\Public\paw-data\`**,
  cale absolută, fără UNC (`\\server`, `//server`, `\\?\`), fără ADS (`fișier:flux`), fără symlink / junction pe drum. Același plan
  într-o cerere încă activă = refuz cu numărul cererii. Cel mult 200 de planuri pe cerere.
- **Stări:** `asteapta` → `citeste_lighton` → `citeste_mineru` → `compara` → `gata` / `eroare` (cu `motiv`) / `anulata`.
  `stare` arată și `dezacorduri` (total pe cerere), `pagini_nerezolvate` (pagini cu orientarea neconfirmată: NU se citesc —
  confirmi orientarea pe foaia de contact și refaci planul) și `proces` (faza procesului unic și ora ultimei scrieri).
- **Rezultatele** stau în fiecare plan: `read_lighton.json`, `read_mineru.json`, `comparatie.json`, `dezacorduri.jsonl` și, dacă
  PDF-ul sursă se găsește neschimbat (`<parinte>\pdf\<nume>.pdf` sau sursa din plan pe paw-data / Z: / G: / NAS, cu același
  sha256), `text_conv.txt`. Dezacordurile se arbitrează de om (sau, cu „da”-ul lui Răzvan, prin pașii plătiți existenți).
- **`eroare` pe o cerere nu oprește coada.** Motive tipice: plan schimbat după adăugare, imagine schimbată, citire oprită
  (`stopped_no_retry`: termen / transport), bandă întreruptă la o cădere (`interrupted_needs_review`: rămâne la om, ca până
  acum — după verificare se șterge `request_started.json` al benzii și se adaugă din nou cererea).
- **Ce NU faci:** nu pornești `vllm serve`, nu rulezi `citeste` de mână, nu atingi `gpu.lock` / `gpu.cerere`, nu scrii în
  `ocr_coada\`. Durata: o pagină durează zeci de secunde pe cititor; ziua, o lucrare Izometrie (E3) poate opri coada câteva
  minute (cedează după banda curentă și reia singură).

## Cum lucrează procesul unic

- `instanta.lock` (mutex de OS, eliberat și la cădere) = o singură instanță; `coada.lock` = tranzițiile scurte (adăugare,
  anulare, preluare în lot; o cerere anulată nu intră în lot).
- Lotul = cererile active, în ordinea numerelor. Pentru fiecare cititor: așteaptă să nu existe cerere E3 și lacătul să fie liber
  → ia `gpu.lock` (deținător `ocr_coada`) → nu pornește dacă memoria plăcii e ținută fără lacăt (Ollama / Docling) → scrie
  obligația în `modele.json` → pornește modelul → citește planurile → oprește modelul și eliberează lacătul **doar după memoria
  confirmată** (`Coordinator.descarca`, ca E3). Compararea și textul (CPU) se fac fără lacăt.
- **E3 are prioritate:** `gpu.cerere` activă = citirea se oprește după banda curentă (`cedat_e3` în `read_<cititor>.json`),
  modelul se oprește cu dovadă, coada așteaptă până E3 termină și descarcă (lacătul liber), apoi reia; benzile gata se sar.
  Cu E3 oprit, placa e a cozii. În modul E3 „zi” (modele 06–22) coada citește doar noaptea.
- **Erori de infrastructură** (WSL, vLLM care nu răspunde la `/health` în 300 s, memorie neconfirmată): pauză 60 → 120 → … →
  3600 s, o linie de jurnal pe treaptă; pauza se resetează doar după un plan citit complet. O excepție neprevăzută pe același
  plan de 3 ori = eroare pe cerere, coada merge mai departe.
- **Cădere:** la pornire, dacă lacătul e liber sau e al unei instanțe moarte a cozii, modelele rămase se opresc și lacătul se
  eliberează după memoria confirmată (obligația din `modele.json` supraviețuiește căderii). Lacătul E3 / al laboratorului nu se
  atinge. Cererile rămase în lucru se reiau din starea lor.
- Fișiere în `C:\Users\Public\paw-data\ocr_coada\`: `cereri\c000NNN.json`, `jurnal.jsonl` (o linie pe eveniment: `pornire`,
  `lot`, `incarcat`, `descarcat`, `cedat_e3`, `pauza`, `memorie_tinuta`, `plan_eroare`, `gata`, `eroare`, `oprit`, `cadere`),
  `stare.json`, `modele.json`, `instanta.lock`, `coada.lock`, `opreste` (doar cât se cere oprirea).

## Instalare (o face chat-ul, cu „da”-ul lui Răzvan, după merge)

Notații ca în `docs/izometrie/RUNBOOK_GPU_LA_CERERE.md`: `<clona>`, `<py>`, `<config>` = `config.json` al serviciului E3.

0. **Înainte:** PR-ul e pe `main`; notezi `git -C <clona> rev-parse HEAD`. Inventarul plăcii (`nvidia-smi --query-compute-apps=...`)
   ca la E3 § 0: un proces care nu respectă `gpu.lock` / `gpu.cerere` și ține memoria face ca coada să aștepte (`memorie_tinuta`).
1. **Cod:** `git -C <clona> fetch origin` + `git -C <clona> merge --ff-only origin/main`. Teste offline, din rădăcina clonei, cu
   `PYTHONPATH=<clona>\scripts`: `<py> -B -m pytest scripts/ocr_local/tests -q -p no:cacheprovider` → toate verzi (1 omis e normal).
   Dacă serviciul E3 rulează: îl repornești după E3 § 1–3 (codul E3 primește doar parametrul `detinator` al lacătului, implicit
   neschimbat).
2. **Task-ul:** copiezi `docs/ocrlab/coada_citire_task.xml`, înlocuiești `__UTILIZATOR__`, `__PY__`, `__CLONA__`, `__CONFIG__`
   (utilizatorul și opțiunea de logare = cele ale task-ului E3), apoi
   `schtasks /Create /TN "Gazpet\OCR coada citire" /XML <fișier.xml> /RU <utilizator> /RP *` (sau Task Scheduler → Import Task).
3. **Pornire:** `schtasks /Run /TN "Gazpet\OCR coada citire"`. În ≤ 30 s `stare.json` = `liber`; în jurnal `pornire` +
   `curatat_la_pornire` (sau `pornire_lacat_altcuiva` dacă E3 ține placa). `gpu.lock` lipsă (sau al E3), `nvidia-smi` la bază.
4. **Proba (date de test, fără documente reale):** un PDF de 2–3 pagini făcut pentru probă → `plan` în
   `paw-data\ocr_coada_proba\` → `coada adauga ... --cine proba` → `stare` până la `gata`. În jurnal: `incarcat` lighton,
   `descarcat`, `incarcat` mineru, `descarcat`, `gata`; după final `nvidia-smi` la bază și `gpu.lock` lipsă.
5. **Prioritatea (obligatorie):** cu o probă de ~10 pagini în citire, o cerere E3 pe proiectul de test → `cedat_e3` în jurnal în
   cel mult durata unei benzi, E3 ia lacătul; după descărcarea E3 coada reia (`read_<cititor>.json`: `skipped_existing` > 0) și
   termină `gata`. Fără `cedat_e3` → revenire A.
6. **Căderea:** cu un model încărcat, oprești forțat procesul din Task Manager → după 5 min (sau Run) jurnalul arată
   `curatat_la_pornire` DOAR după ce `nvidia-smi` e la bază; banda în lucru la cădere dă `interrupted_needs_review` pe acea cerere
   (corect, rămâne la om).

## Revenire

- **A (fără cod, recomandat întâi):** `<py> -B -m ocr_local coada opreste` (oprire după banda curentă, model oprit cu dovadă,
  lacăt eliberat; în jurnal `oprit` cu `lacat_pastrat: false`), apoi `schtasks /Change /TN "Gazpet\OCR coada citire" /DISABLE`.
  E3 nu e afectat. Cererile rămân ca fișiere în `ocr_coada\cereri\` (anunți sesiunile); citirea de mână (`citeste`) merge ca înainte.
- **B (fără task):** A, apoi `schtasks /Delete /TN "Gazpet\OCR coada citire" /F`; opțional `git -C <clona> checkout <commit notat>`
  (schimbările din `e3_gpu.py` / `read.py` sunt compatibile înapoi: implicitele vechi neschimbate) și repornirea E3 după E3 § 1–3.
- `lacat_pastrat: true` la oprire = memoria n-a coborât: nu ștergi `gpu.lock` de mână; verifici `nvidia-smi`, apoi pornești din
  nou task-ul (curățenia de la pornire îl eliberează după dovadă).

## Ce nu se poate dovedi fără server

Durata reală a încărcării vLLM, oprirea în WSL și coborârea memoriei (pașii 4–6), comportamentul Task Scheduler la repornire,
procesele de pe placă care nu folosesc lacătul. Testele offline (27, cu `run_reader` / `compare` / `GpuLock` / `Coordinator` reali
și WSL fals) dovedesc logica: ordinea, refuzurile, cedarea și reluarea fără benzi repetate, lacătul eliberat doar după memoria
confirmată, curățenia la pornire, instanța unică, eroarea izolată pe o cerere.
