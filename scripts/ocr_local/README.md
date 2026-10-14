# ocr_local — pilot OCR local Ofertare (D3c)

Specificația: `docs/paw/PLAN_OCR_LOCAL_OFERTARE.md`. Adaptarea pipeline-ului Codex 0.1.0 (`Documents\Codex\2026-10-10\git\work\pipeline_ocr_local`)
de la un cititor (dots, prompt înghețat) la **două cititoare independente**: LightOnOCR-2-1B și MinerU2.5-Pro, ambele în vLLM pe loopback.
Geometria (`geometry.py`), garda v3 (`guard*.py`) și regulile clientului (IP loopback literal, fără proxy / redirect / reîncercare, 180 s)
sunt cele din Codex; garda primește tokenizer-ul din `protocol.json` (cale + SHA-256).
Singura abatere de logică (14.10.2026, rularea r1, `guard_version` `empty-cells-v4-td-consecutive`): în regula veche „linie lungă repetată”,
liniile de celule `<td>` se socotesc buclă doar de 4 ori **la rând**. Celelalte linii lungi rămân pe regula veche (de 4 ori oriunde), ca să
prindă și buclele cu spațiere variabilă pe care blocul de 200 de caractere nu le vede. Motiv: alarmă falsă pe un tabel corect (d772 p0255_b0).
Teste pe texte reale în `fixtures_garda/`. Pe tot corpusul Codex (5.964 de ieșiri) verdictul se schimbă doar la pagina d772.

**Ce NU face pachetul:** nu pornește servere sau modele, nu cheamă cloud (arbitrajul Sonnet 5 e în edge-ul `ofertare-ocr-arbitreaza`, D3b),
nu scrie în BD (scrierea e prin `ofertare-ocr-scrie`, D3b), nu promovează nimic.
Contractul cu BD (migrarea 20261029b, D3a): întâi manifestul planului (`fn_ofertare_ocr_plan`: benzile + `image_sha256` per pagină,
excluderile cu motiv), apoi fiecare citire cu `compare.segmente(raw)`; dezacordurile se încarcă din `dezacorduri.jsonl` cu `id` →
`item_id`, plus `document_id` / `pagina`. BD reface fiecare fragment `text` din `sursa` (segment + poziții, granițe de token) și
fiecare rând din `pozitie` (toate celulele), deci `compare.py` și BD trebuie să rămână la aceeași tokenizare (`NUM` / `TOKEN`).

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

## Legătura cu ERP — `client.py` (pasul de după D3b)

Singura cale a serverului AI spre ERP: cele 3 edge-uri D3b cu secretul `OCR_LOCAL_SECRET` (antet `x-ocr-local-secret`; din mediu sau
din `C:\Users\Gazpet-Ai\.secrete\ocr_local_secret.txt`, niciodată afișat). Fără service_role, fără acces direct la BD; BD refuză orice
abatere (stare, plan, imagine, proveniență). Rularea o cere un om din ERP (`fn_ofertare_ocr_cerere`, poarta pe cheltuială); clientul
doar o preia. Fiecare pas e o comandă separată, reluabilă (un pas încheiat se marchează în `<dir_rulare>/pasi.json`):

| Pas | Comandă (`python -B -m ocr_local erp …`) | Ce face |
|---|---|---|
| 1 | `preia --work C:/Users/Public/paw-data/ocr_rulari` | ia prima rulare `ceruta` → `preluata`; creează `r<id>/rulare.json` (documente + pagini înghețate) |
| 2 | `descarca <dir>` | `ofertare-pdf-link` → PDF-ul fiecărui document (URL acceptat DOAR pe bucketul `ofertare` al proiectului, fără redirect / proxy) |
| 3 | `foaie <dir>` | foile de contact `orientare/<doc>_pNNNN-NNNN.png` + șablonul `orientare/<doc>.DE_COMPLETAT.json` (valori `null`) |
| — | **om** | completează 0 / 90 / 180 / 270 și salvează `orientare/<doc>.json` (o pagină lipsă = `orientare_nerezolvata`, exclusă) |
| 4 | `plan <dir>` | planul CPU per document + manifestul în BD (o singură dată; reluarea compară amprenta) |
| — | **om** | pornește serverul vLLM al cititorului (`protocol.json` → `vllm_serve`), în fereastra GPU |
| 5 | `citeste <dir> --cititor lighton`, apoi `mineru` | `read.run_reader` pe toate documentele (GPU, `gpu.lock`), fără ERP |
| 6 | `incarca-citiri <dir>` | fiecare bandă × cititor (+ rândurile `exclus`) → `preluata → citita` |
| 7 | `compara <dir>` | `compare.compare` per document → dezacordurile în BD + marcajul (număr + amprentă) |
| 8 | `arbitreaza <dir>` | **PLĂTIT**: `ofertare-ocr-arbitreaza` pe fiecare dezacord (rezervarea + plafonul în BD); `structura_tabele` → `needs_human` fără AI → `arbitrata` |
| 9 | `reconciliaza <dir>` | `reconcile.reconcile` per document → textul reconciliat (`reconciliat` / `needs_human`) → `finalizata` |
| — | `oprire <dir> --motiv …` · `abandon --rezervare N` · `stare <dir>` | oprește rularea · abandonează o rezervare rămasă deschisă (după 15 min) · starea din BD (doar citire) + pașii locali |

- **Egress din Supabase Storage** (cerere Răzvan 14.10, după Huedin — o eroare redescărca în buclă, ~600× plafonul), `erp descarca`
  sub lacătul rulării ȘI al registrului comun al documentelor (`<work>/_pdf_registru`): fiecare PDF se descarcă O SINGURĂ DATĂ PE
  RULARE; copia rulării (`pdf/<doc>.pdf`, SHA-256 + ETag în meta) e singura sursă pentru orice reluare — nicio redescărcare, nicio
  revalidare (versiunea e înghețată la prima descărcare completă a rulării; o copie înghețată lipsă sau coruptă BLOCHEAZĂ reluarea, nu se descarcă altă versiune; o rulare nouă, cerută de om din ERP, descarcă din nou).
  Registrul comun numără ÎNCERCĂRILE EȘUATE pe document, în toate rulările: cel mult 2, la ≥ 60 s una de alta; încercarea se notează
  ÎNAINTEA apelului, iar una rămasă fără rezultat (cădere) contează ca eșuată — doar dacă rularea ei n-a persistat succesul (meta); pauza se măsoară de la ultimul eșec. Plafon de egress pe rulare `OCR_EGRESS_MAX_MB`
  (implicit 2048 MB), REZERVAT pe disc înaintea cererii (coborât la `Content-Length` la antete, reconciliat la octeții reali la succes
  sau la un eșec în proces cu octeți știuți; un eșec ÎN TIMPUL corpului (timeout, conexiune) sau o cădere a procesului lasă rezervarea socotită) — depășire = rularea `oprita`. Un transfer trunchiat
  (lungime != `Content-Length`, PDF fără `%PDF-` / `%%EOF`) nu devine copia rulării; un fișier complet rămas fără meta se adoptă doar
  dacă e transferul în curs al ACELEIAȘI rulări. Jurnal: `<dir_rulare>/egress.json`, heartbeat, `erp stare`.
- **Reluare după cădere** (review r1, decizia B Răzvan): un pas unic (preia, planul, marcajul comparației, o tranziție) poate intra în
  BD și clientul să cadă înainte de marcajul local. La reluare clientul NU interpretează refuzul: citește starea din BD (op
  `stare_rulare` / `rulari_active`, doar citire, migrarea `20261029e`) — planul e confirmat doar dacă amprenta lui canonică din BD
  (`plan_sha`, aceeași formulă în SQL și Python) e a noastră, comparația doar cu același număr + amprentă, tranziția doar dacă rularea e
  deja în starea cerută; o preluare întreruptă (`preia_in_curs.json`, cu instantaneul rulărilor active de dinainte) se recuperează doar
  ca rulare NOUĂ față de instantaneu (`preluata`, fără plan, fără director local; mai multe = decide omul). Intenții locale înaintea
  pașilor unici, fișiere de control scrise atomic + fsync (pe Windows: garanție la căderea procesului).
- **Lacăt exclusiv** pe directorul rulării (`lacat.json`, O_EXCL) pentru toți pașii care scriu (și pe directorul de lucru pentru `preia`): două comenzi `erp` simultane pe aceeași rulare nu se suprapun (un lacăt rămas de la un proces mort se șterge manual). Excepție: `erp oprire` merge FĂRĂ lacăt, și cât rulează arbitrajul: scrie `oprire_ceruta.json` (verificat înaintea fiecărui apel plătit) și cere `oprita` în BD. **Jurnalul apelurilor plătite** `apeluri.jsonl` (per document, append-only + fsync; fiecare încercare cu identificator unic `a`): `start` ÎNAINTEA fiecărui POST, `gata`
  (`decizie` / `refuz` / `pierdut`) după. Un `start` fără `gata` = rezultat NECUNOSCUT (cădere oricând după POST, transport, 409
  decontat, 500, 502): pe acel item nu se mai cere NICIODATĂ un arbitraj Claude, la reluare merge la `needs_human` fără AI (după
  `abandon`, dacă rezervarea e deschisă). Refuzul dinaintea plății (`refuz` = poartă, plafon, stare, amprentă, în zbor) închide apelul și
  oprește pasul (item-ul se poate arbitra la reluare). `409 arbitrat` (decizie în BD pierdută local) → `pierdute.jsonl` = `needs_human` la
  reconciliere. `rezervare_id` apare în mesajul de eroare. O ultimă linie neterminată dintr-un jurnal (scriere întreruptă) se mută în `<jurnal>.coada-<timp>` și se taie (fail-closed: `start`-ul rămâne necunoscut); o linie invalidă în interior = refuz.
- **Oprire automată** (spec §8): gardă / citire incompletă / bandă lipsă (cititor oprit, inclusiv documentele neîncepute după oprire) pe
  > 20% din pagini (la `incarca-citiri`; un cititor încă neterminat = refuz, fără scriere); `needs_human` > 15% din arbitrajele Claude,
  după minim 20, cu necunoscutele + pierdutele Claude socotite PERMANENT `needs_human` (și după conversia la om) — verificat după
  reluare, înaintea FIECĂRUI apel plătit și înainte de `arbitrata` → `oprita` cu motiv.
- Decizia arbitrului se scrie local imediat (`decizii.jsonl`, fsync), înaintea următorului apel.
- **Teste**: `test_client.py` (55, CPU, edge simulat cu verificările BD relevante + căderi simulate) + cap-coadă pe funcțiile SQL REALE în harness
  (`supabase/tests/ofertare_ocr_local_client_e2e.py`, rularea R8 din `scripts/test_ofertare_ocr_local.sh`, fără apel plătit).
  `plan.py` importă PIL doar în funcțiile care randează, ca `load_plan` / `compare` / `reconcile` / `client` să ruleze și fără PIL.

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

## După review-ul Jakarinos r3 (14.10)

- Etichete HTML șterse doar dintr-o listă închisă, cu atribute bine formate (`x<y si z>3` rămâne text); `\|` în markdown = bară
  în celulă, nu separator.
- Tabelul e un marcaj `⟦tabel⟧` în fluxul de text: text mutat de o parte pe alta a unui tabel = dezacord (`contine_tabel`), aplicat
  doar ca `ales_lighton`, altfel `needs_human`.
- `e_cantitate`: orice dezacord pe pagini `quantity_table`; în text, cifră în fragment sau număr vecin; în tabele, orice celulă cu cifre
  care diferă (inclusiv mutată de coloană fără antet).
- `gpu.lock` marcat „de păstrat” din momentul cererii până la scrierea rezultatului complet (o eroare la scriere nu-l mai eliberează).
- În proba de mai jos toate benzile sunt rulate ca `quantity_table` (și cele de text), deci contorul `e_cantitate` din probă (76/84)
  e supraestimat față de o rulare reală.

## După review-urile r4 (Copilot și Jakarinos, 14.10, fără P0)

- Tabel la un cititor, text la celălalt → dezacord explicit `structura_tabele` (și când textul aplatizat e identic); cu `ales_lighton`
  se păstrează structura LightOn.
- `#` scos doar la titlu markdown real (`# Titlu`); `#12`, `##ABC` rămân. Exponent / indice grupate: `^{...}` / `_{...}`.
- Geometria celulelor: `colspan=N` → celulă + N−1 celule goale (aceeași grilă ca LightOn); `rowspan` → marcaj vizibil comparat;
  `<caption>` devine segment de text înaintea tabelului (tronsonul se compară). Etichete HTML doar cu atribute între ghilimele.
- `e_cantitate` = orice dezacord pe pagini `quantity_table`, inclusiv rândurile de tabel și cazul structură diferită.
- Inserare după un tabel final → `needs_human` (fără excepție).

## După review-ul Copilot r5 (14.10, fără P0)

- Tabel vs text: decizia de structură domină — `ales_lighton` pe structură cere `ales_lighton` peste tot în bandă (rezultat =
  citirea LightOn neschimbată), orice altă combinație = `needs_human`.
- `colspan` / `rowspan`: doar întreg valid 1–50 se interpretează; orice altă valoare rămâne marcaj vizibil `⟦colspan_invalid=…⟧`.
- `<img>` nu mai dispare: `alt` / `title` devin marcajul comparat `⟦img alt=…⟧`.
- (Jakarinos r5) Tabel cu etichete neînchise → tot conținutul intră ca text marcat `⟦tabel_neparsat⟧` (comparat), nu se pierde;
  text barat (`<s>`, `<del>`, `<strike>`, `~~…~~`) → marcaj `⟦barat: …⟧`, nu text activ; `rowspan="0"` / `colspan` > 50 = marcaj invalid.
- (Copilot r6) Bucăți de tabel HTML neconsumate (`<table>` fără `</table>`, `</table>` orfan) → text marcat `⟦tabel_neparsat⟧`.
- (Jakarinos r6, P2) Text în tabel în afara rândurilor / celulelor → `⟦tabel_neparsat⟧`; `<img>` păstrează textual toate atributele
  (inclusiv `>` în valori, valori neghilimelate, `src`); bararea prin CSS (`line-through`) → `⟦barat: …⟧`.
- (Copilot r7) Dominanța structurii se aplică ORICĂRUI `structura_tabele` (și granițelor tabel↔tabel): toate deciziile benzii
  `ales_lighton` → citirea LightOn neschimbată, altfel `needs_human`.
- (Jakarinos r7, P2) Bararea CSS și pe `<p>` / `<div>` / `<td>`; slash-ul final al unei valori neghilimelate din `<img>` se păstrează.
- **Recuperare:** dacă reconcilierea pică la mijloc rămâne `reconciliere.tmp/` și orice reluare e refuzată (intenționat). Omul
  verifică ce e în el, îl șterge manual și rulează din nou `reconciliaza`.

## Probă pe benchmark-ul 14.10 (CPU, citirile reale redate din disc)

38 de benzi (30 benzi de text din 10 pagini + 8 pagini de tabel, 5.767 tokeni, 179 rânduri de tabel): **84 de dezacorduri** (~2,2 pe bandă),
dintre care **1 pe cantitate** — `0,056` (LightOn) vs `0.056` (MinerU), marcat și `anomalie_separator`. Restul: diacritice (`protecție` /
`protectie`, `Ștefănești` / `Štefănești`), `m³` / `m3`, `Ø` / `∅`, LaTeX la MinerU (`\( 100m^{2} \)`). Volum estimat pentru arbitraj pe 102
(~1.447 pagini): de ordinul a câteva sute de decupaje, în plafonul de 15 $ din spec §8.

## Teste

`python -B -m unittest ocr_local.test_ocr_local ocr_local.test_client -v` — 89 + 55 teste CPU (clientul ERP: vezi mai sus), fără endpoint (geometrie, gardă, plan, citire cu cititori falși:
redirect, reluare, oprire, lock, SHA greutăți, atestare server; comparare; reconciliere; regresii pe cazurile din review-ul r1; regresie pe
a_098 din benchmark, sărit dacă lipsește).

## Limite cunoscute

- Atributele HTML de pe alte elemente decât `<img>` (în afară de `colspan` / `rowspan` și `line-through`) nu se compară
  (`data-*`, `aria-label`, `title` pe celule). Cititorii pilotului nu le produc (LightOn: tabele HTML tip pandas, MinerU: json2md); la generalizare pe HTML
  arbitrar trebuie tratate (Copilot r6, P2 neblocant pentru pilot).
- Decupajul trimis arbitrului = banda (text) sau pagina întreagă (tabel), nu bbox-ul rândului; contextul (rândul precedent, nr. crt.) ajută
  la localizare.
- `m³` vs `m3`, `Ø` vs `∅` ajung la arbitru (nu normalizăm nimic pe UM / cantități) — ieftin, dar zgomot.
- Cusătura benzilor e euristică (suprapunere de tokeni); lipsa avertismentului nu dovedește completitudinea.
- Clasificatorul de pixeli dă candidați; un tabel dens poate ieși `grid_form` (exclus) — se vede în `plan.json` → `summary.routes`.
