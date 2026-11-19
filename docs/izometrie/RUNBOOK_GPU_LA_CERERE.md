# RUNBOOK — E3 cu GPU la cerere (instalare pe serverul AI, cu revenire)

Decizia Răzvan 19.11.2026: placa video e liberă pentru AI și ziua; Izometria (E3) o ia doar când are o lucrare.
Codul: `scripts/ocr_local/e3_gpu.py` (`GpuLaCerere`), `e3_serviciu.py`, `gpu_cedare.py`, `read.py`.
Fără schimbări în edge, BD sau UI. Pașii îi face chat-ul, cu „da”-ul lui Răzvan, după merge.

Notații: `<clona>` = clona repo-ului din care rulează serviciul E3 (Start in = `<clona>\scripts`),
`<root>` = folderul serviciului (argumentul `--root` din task), `<py>` = interpretorul Windows al serviciului (env_mineru).

## 0. Înainte
- PR-ul e pe `main`. Momentul: oricând fără lucrare E3 în curs (`jurnal.jsonl` fără linie în ultimele 2 minute).
- Notezi pentru revenire: `git -C <clona> rev-parse HEAD` și o copie `config.json` → `config.json.inainte` (în `<root>`).

## 1. Oprire curată
1. `<py> -B -m ocr_local e3 opreste --root <root>` (din `<clona>\scripts`).
2. În ≤ 60 s `stare.json` arată `oprit` (ora nouă). Task-ul se încheie cu cod 0 (nu repornește singur).
3. `gpu.lock` nu e al E3 (lipsă sau al laboratorului) și `nvidia-smi` arată memoria de bază.

## 2. Codul nou
1. `git -C <clona> fetch origin` + `git -C <clona> merge --ff-only origin/main` (doar fast-forward; altfel oprire și întrebare).
2. Testele offline, din rădăcina clonei, cu `PYTHONPATH=<clona>\scripts`:
   `<py> -B -m pytest scripts/ocr_local/tests/e3 -q -p no:cacheprovider` → toate verzi (1 omis e normal).
3. `config.json`: adaugi explicit `"gpu_mod": "la_cerere", "inactiv_minute": 10` (implicitele, scrise ca să se vadă).
   O valoare greșită oprește serviciul la pornire (`config_gpu`), înainte de GPU.

## 3. Pornire și verificări
1. Task Scheduler → „Run” pe task-ul E3.
2. În ≤ 15 s `stare.json`: ziua `disponibil`, noaptea `noapte`. Heartbeat-ul spune versiunea `e9-b3-r5-la-cerere`.
3. Cu coada goală: `gpu.lock` lipsă (sau al altcuiva), `nvidia-smi` la bază, nicio linie nouă în jurnal în afară de
   eventualul `descarcat` / `pornire_serviciu` (curățenia modelelor rămase).

## 4. Proba pe date de test (ziua, proiect de test)
1. O cerere E3 pe proiectul de test. În jurnal apare `incarcat` cu durata încărcării în secunde: **aceasta e măsurătoarea
   care decide dacă prima lucrare după pauză poate rămâne locală** (bugetul e ~43 s: termenul de 90 s minus rezerva de 45 s
   pentru citire). Dacă încărcarea durează mai mult, prima lucrare merge pe Haiku („Serverul local nu e pregătit”), iar
   următoarele, în 10 minute, se citesc local.
2. A doua cerere în ≤ 10 minute: `gata` sau un cod de conținut, fără `incarcat` nou.
3. După 10 minute fără cereri: `descarcat` / `inactiv`, `gpu.lock` dispare, `nvidia-smi` revine la bază.
4. Opțional, prioritatea: o citire de laborator (`citeste`, cu lacăt) pornită, apoi o cerere E3 → citirea se oprește
   după banda curentă cu `cedat_e3` în `read_<cititor>.json`, E3 ia lacătul; după descărcare, `citeste` din nou reia.

## 5. Revenire
- **A, fără cod (recomandat întâi):** în `config.json` `"gpu_mod": "zi"`, apoi pașii 1 + 3. Programul vechi: modelele
  pornite 06–22. Rămâne doar îmbunătățirea pauzelor (reconcilierea căzută nu se mai reia la fiecare secundă).
- **B, codul vechi:** pasul 1, `git -C <clona> checkout <commit notat la 0>`, `config.json.inainte` → `config.json`, pasul 3.
- Ce să urmărești în primele zile: liniile `gpu_pauza` (o treaptă = o linie; cauza e scrisă), `ocupat` repetat
  (un proces care nu respectă `gpu.cerere`), `incarcat` (durata), `lacat_pierdut` (lacăt șters de mână).

## Ce nu se poate dovedi fără server
Durata reală a încărcării vLLM (ambele modele), oprirea reală în WSL și eliberarea VRAM-ului, comportamentul unui
proces Ollama / Docling care nu folosește încă `gpu.cerere` (E3 nu pornește vLLM peste memoria lui: lucrarea merge pe
fallback și E3 anunță `ocupat` 5 minute).
