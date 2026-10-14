# ocr_local — pilot OCR local Ofertare (D3c)

Specificația: `docs/paw/PLAN_OCR_LOCAL_OFERTARE.md`. Adaptarea pipeline-ului Codex 0.1.0 (`Documents\Codex\2026-10-10\git\work\pipeline_ocr_local`)
de la un cititor (dots, prompt înghețat) la **două cititoare independente**: LightOnOCR-2-1B și MinerU2.5-Pro, ambele în vLLM pe loopback.
Geometria (`geometry.py`), garda v3 (`guard*.py`) și regulile clientului (IP loopback literal, fără proxy / redirect / reîncercare, 180 s)
sunt cele din Codex; garda primește tokenizer-ul din `protocol.json` (cale + SHA-256).

**Ce NU face pachetul:** nu pornește servere sau modele, nu cheamă cloud (arbitrajul Sonnet 5 e în edge-ul `ofertare-ocr-arbitreaza`, D3b),
nu scrie în BD (scrierea e prin `ofertare-ocr-scrie`, D3b), nu promovează nimic.

## Pași

Interpretorul: `C:\Users\Gazpet-Ai\Documents\Codex\2026-10-10\git\work\env_mineru\Scripts\python.exe` (are Pillow, NumPy, PyMuPDF,
tokenizers, mineru_vl_utils 2.0.7). `PYTHONPATH=scripts` din rădăcina repo-ului.

| Pas | Comandă | Unde | Ce iese |
|---|---|---|---|
| 0 | `python -B -m ocr_local foaie-orientare <pdf> --output foaie.png --pagini 325-636` | CPU | miniaturi; omul scrie `orientari.json` `{"325": 0, …}` |
| 1 | `python -B -m ocr_local plan <pdf> --output <dir> --pagini 325-636 --orientari orientari.json` | CPU | `plan.json`, `pageNNNN/*.png` |
| 2 | `python -B -m ocr_local citeste <dir> --cititor lighton --rulare <id>` | GPU (serverul LightOn pornit de om, port 8017) | `<banda>/lighton/raw.txt + result.json` |
| 3 | `python -B -m ocr_local citeste <dir> --cititor mineru --rulare <id>` | GPU (serverul MinerU pornit de om, port 8018) | `<banda>/mineru/…` |
| 4 | `python -B -m ocr_local compara <dir>` | CPU | `comparatie.json`, `dezacorduri.jsonl` |
| 5 | arbitrajul (edge, D3b) → `decizii.jsonl` | cloud, plafon | o decizie pe dezacord |
| 6 | `python -B -m ocr_local reconciliaza <dir> --decizii decizii.jsonl` | CPU | `reconciliere/reconciliat.json`, `reconciliere/tripleti.jsonl` |

Comenzile `vllm serve` exacte (flagurile din benchmark) stau în `protocol.json` → `readers.*.vllm_serve`. Modelele se rulează pe rând.

## Reguli

- **Selecția paginilor** (spec §1): doar paginile cerute (`--pagini` = `pagini_necitite`); un strat de text nativ (≥ 200 caractere) e doar
  semnal (`text_nativ_prezent`) — pagina trece oricum prin ambele cititoare (poate fi un OCR ascuns, greșit); planșe / formulare (`grid_form`, `drawing`) și pagini neclasificate → excluse; **orientarea nu se ghicește**: fără
  confirmare (`--clockwise` sau `--orientari`) pagina rămâne `orientare_nerezolvata`.
- **Greutățile**: la `citeste`, SHA-256 al `model.safetensors` se compară cu `protocol.json`; diferit → refuz (LightOn `cbe12d08…`,
  MinerU `f2650d91…`, calea existentă din folderul Codex — fără copie).
- **GPU**: `C:/Users/Public/paw-data/gpu.lock` creat exclusiv la începutul citirii (cu `run_id`), șters la final doar dacă e tot al rulării.
  Lock-ul altcuiva → refuz.
- **Reluare**: banda cu `result.json` se sare; banda începută și neterminată (`request_started.json` fără rezultat) oprește rularea
  (`interrupted_needs_review`) — nu se reîncearcă automat. Primul rezultat incomplet oprește cititorul (`stopped_no_retry`).
- **Comparare** (spec §2): cuvinte cu ș/ş, ț/ţ unificate DOAR la comparare; cifrele literal (separatorul zecimal niciodată normalizat);
  tabele rând cu rând (aliniere ordonată), rolurile cod / UM / cantitate din antet sau euristic. Celulele unite (LightOn: celule goale,
  MinerU: colspan) nu sunt dezacord DOAR dacă rândul n-are nicio cifră și conținutul nevid e identic; altfel merge la arbitru.
  Citire incompletă / gardă pe oricare cititor → toată banda merge la arbitru (`banda_intreaga`).
- **Reconciliere**: baza = citirea LightOn; deciziile se validează strict (schema spec §3); dezacord fără decizie validă = `needs_human`
  (fail-closed); o pagină cu `needs_human` nu are text propus. Benzile se cos doar pe 1–3 rânduri întregi identice (≥ 8 tokeni) — altfel pagina = `needs_human`.
  Fiecare dezacord → rând în `tripleti.jsonl` (LightOn / MinerU / ales + motiv + model + versiune prompt).

## După review-ul r1 (Copilot NO-GO, Jakarinos NO-GO, 14.10)

- Tokeni cu semn / exponent / procent și operatori (`-5` ≠ `5`, `5%` ≠ `5`, `10**2` ≠ `102`); `**` scos doar ca pereche de bold; cheile de
  rând literale (`AB-12C` ≠ `AB12-C`); fragmentele pentru arbitru = subșirul exact din citire (`10-20`, nu tokeni lipiți).
- Fiecare dezacord are `item_sha256` (plan, bandă, imagine, citiri, poziții, celule); decizia trebuie să-l poarte identic, cu model și
  versiune de prompt din `protocol.json` → `arbitru` (lista de prompturi e GOALĂ până la D3b ⇒ azi orice decizie = `needs_human`).
- Reconcilierea reface comparația din citiri și refuză dacă `raw.txt` / `result.json` / `dezacorduri.jsonl` nu mai corespund; nu rescrie o
  reconciliere existentă; celulele se iau ca vectori; un rând nou doar în interiorul aceluiași tabel (altfel `needs_human`); marcajul de
  cantitate al arbitrului se adaugă; cusătura benzilor acceptată doar pe ≥ 8 tokeni și 1–3 rânduri întregi, altfel pagina = `needs_human`.
- Citirea: rezultat vechi refolosit doar dacă e compatibil (cititor, protocol, greutăți, imagine, raw); `gpu.lock` cu jeton unic de
  achiziție, PĂSTRAT la termen depășit (backend neconfirmat idle); atestare `/v1/models` (nume servit + rădăcina greutăților); MinerU
  fără proxy și fără jurnalul de cereri al bibliotecii; căile din `plan.json` validate.

## După review-ul r2 (Copilot NO-GO fără P0, 14.10)

- Semnele și comparatorii sunt tokeni și când stau separat (`± 0,5`, `- 5`, `≤ 50`, `> 100`); colspan scutit doar pe rânduri fără cifre.
- `item_sha256` peste TOT obiectul dezacordului (id, ancore, marcaje, protocolul și greutățile cititorilor); reconcilierea cere egalitate
  canonică completă cu comparația refăcută și refuză ID-uri duplicate; `compara` acceptă doar rezultate ale protocolului și greutăților curente.
- Cusătura pe rânduri întregi (nu pe tokeni); `raw.txt` scris ca octeți exacți (hash stabil pe Windows); `reconciliat.json` + `tripleti.jsonl`
  publicate împreună din fișiere temporare; `__pycache__` scos din git — rulați cu `python -B`.

## După review-ul Jakarinos r2 (14.10)

- `**` scos doar ca bold nelipit de cifre/litere (`10**2 + 3**2` rămâne); `.5` ≠ `5`; se șterg doar etichete HTML reale
  (`x < 5 si y > 3` rămâne text).
- Granițele tabelelor: dacă rândurile potrivite leagă un tabel de mai multe tabele ale celuilalt cititor → dezacord `structura_tabele`
  (doar `ales_lighton` e acceptat automat, altfel `needs_human`); un rând găsit doar de MinerU se inserează automat DOAR între doi vecini
  consecutivi din același tabel la ambii cititori (la început / sfârșit de tabel = om).
- `|` din celule escapat la ieșire; orice rezultat incomplet (termen, eroare de transport, gardă) păstrează `gpu.lock`.
- Cu regulile r2–r3, proba pe benchmark marchează 20 de dezacorduri ca posibilă cantitate (rânduri cu cifre și celule unite), dintre
  care unul singur e o diferență reală de valoare (`0,056` / `0.056`) — preț acceptat pentru fail-closed (merg la audit).

## După review-ul Copilot r3 (14.10)

- Politica inversă la tokeni: orice caracter nespațiu care nu e număr sau literă e token (`5 %`, `‰`, `_`, `(5)`, `€` rămân dezacorduri);
  `<sup>` / `<sub>` devin `^x` / `_x` (nu dispar: `m<sup>2</sup>` ≠ `m2`); niciun rând de tabel cu alt număr de celule sau alte
  poziții nu mai e scutit (parserul nu păstrează `colspan`, deci echivalența nu se poate dovedi).
- Reconcilierea publică `reconciliere/` (ambele artefacte) printr-un singur rename; pachetul nu scrie `__pycache__` (`python -B`).

## Probă pe benchmark-ul 14.10 (CPU, citirile reale redate din disc)

38 de benzi (30 benzi de text din 10 pagini + 8 pagini de tabel, 5.767 tokeni, 179 rânduri de tabel): **84 de dezacorduri** (~2,2 pe bandă),
dintre care **1 pe cantitate** — `0,056` (LightOn) vs `0.056` (MinerU), marcat și `anomalie_separator`. Restul: diacritice (`protecție` /
`protectie`, `Ștefănești` / `Štefănești`), `m³` / `m3`, `Ø` / `∅`, LaTeX la MinerU (`\( 100m^{2} \)`). Volum estimat pentru arbitraj pe 102
(~1.447 pagini): de ordinul a câteva sute de decupaje, în plafonul de 15 $ din spec §8.

## Teste

`python -B -m unittest ocr_local.test_ocr_local -v` — 65 de teste CPU, fără endpoint (geometrie, gardă, plan, citire cu cititori falși:
redirect, reluare, oprire, lock, SHA greutăți, atestare server; comparare; reconciliere; regresii pe cazurile din review-ul r1; regresie pe
a_098 din benchmark, sărit dacă lipsește).

## Limite cunoscute

- Decupajul trimis arbitrului = banda (text) sau pagina întreagă (tabel), nu bbox-ul rândului; contextul (rândul precedent, nr. crt.) ajută
  la localizare.
- `m³` vs `m3`, `Ø` vs `∅` ajung la arbitru (nu normalizăm nimic pe UM / cantități) — ieftin, dar zgomot.
- Cusătura benzilor e euristică (suprapunere de tokeni); lipsa avertismentului nu dovedește completitudinea.
- Clasificatorul de pixeli dă candidați; un tabel dens poate ieși `grid_form` (exclus) — se vede în `plan.json` → `summary.routes`.
