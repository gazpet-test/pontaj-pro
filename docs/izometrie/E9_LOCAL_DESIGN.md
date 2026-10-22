# E9 — citirea avizelor E3 cu OCR local (LightOn + MinerU) și Haiku doar pe dezacorduri — DESIGN r3

Stare: **design r3, fără cod** (laborator OCR, 23.10.2026), pe PR #855.
- **Review r2:** Jakarinos, NO-GO, fără P0. P1-3 (grila) și P1-6 (identități) sunt închise.
- **Ce schimbă r3**, marcat **[r3-n]** în text:
  1. fazele persistente ale apelului plătit, cu recuperare, și o singură regulă de termene;
  2. validitatea structurală pe șablon, verificată înainte și după normalizare;
  3. schema brută a workerului, separată de schema normalizată, plus ramura de eroare;
  4. perspectivă pe cadrul întreg, plus reconcilierea serviciului după cădere;
  5. un singur contract pentru validarea PDF;
  6. cota se rezervă înainte de Storage și se limitează și încercările respinse;
  7. în UI, Haiku rulează fără reintrare în `citesteAI`.

Unde textul de mai jos (r2) contrazice un paragraf [r3-n], **are prioritate [r3-n]**.
- **Decizii:** chatul, cu acordul lui Razvan (#1830, #1832). D1–D4 sunt închise (#1833):
  - D1: secret nou `IZO_OCR_LOCAL_SECRET`;
  - D2: între 22:00 și 06:00 (ora României) nu rulează serviciul local, iar UI-ul oferă Haiku;
  - D3: PDF-urile din coadă se păstrează 7 zile;
  - D4: butonul implicit e citirea locală, iar Haiku intră automat ca rezervă.
- **Review:** r1 a fost respins de Jakarinos (NO-GO, 8 P1, fără P0). Fiecare P1 are răspunsul marcat **[P1-n]** în textul de mai jos.
- **Implementarea** o scrie Codex, în 4 bucăți (§B1–§B4), fiecare cu contract și teste obligatorii. Ordinea: B1 → B2 → B3 → B4. B3 se poate scrie în paralel cu B2, pe contractul din §B2.

Intrarea: testul E9 din 22.10 (`C:\Users\Public\livrare\e9_test\rezumat.md`).
- Pe **două fotografii**, LightOn a citit corect 15/15 rânduri (aviz) și 12/12 (lista de curbe).
- MinerU a citit corect avizul. Pe lista fotografiată din unghi a tăiat câmpul BEND NUMBER pe 4 rânduri și a trunchiat coloana GROSS KG.
- Asta arată doar că se poate. Nu dovedește precizia generală, latența cu modelele pornite simultan sau economia: cei ~0,05 USD din cod sunt rezerva maximă, nu costul mediu.

Ce NU se schimbă:
- poarta E3 și drepturile pe tabelele `izo_*`: migrarea nouă nu atinge drepturile și RPC-urile existente;
- aplicarea propunerii în formular și salvarea documentului rămân **două acțiuni umane**;
- calea Haiku de azi (`ocr-packing-list`, `tip: 'aviz_e3'`) rămâne, cu comportamentul ei.

---

## 0. Model de stări și reguli generale

```
                  cere (JWT; admis doar dacă workerul e „disponibil”)
                          │
                       ceruta ──(termen_preluare = +20 s, fără preluare)──► expirata
                          │ preia (secret; exclusiv; token_executie nou)
                       preluata ──(termen_local = +90 s, fără rezultat)──► expirata
                          │ rezultat(token)              │ rezultat(token, eroare)
                       gata (ramura locală)           esuata (ramura locală)
expirata / esuata ── fallback (JWT, creatorul; consumă dreptul plătit unic) ──► fallback ──► gata | esuata (ramura Haiku)
```

- **[P1-2] Termenele** se calculează pe server, la `cere` (`now()`), și nu se prelungesc niciodată.
  - Pornirea la rece NU este o cerere în așteptare: când workerul nu e `disponibil`, `cere` întoarce `local_indisponibil` și UI-ul merge direct pe Haiku (D4).
  - Cererea nu mai are un termen de 5 minute: rămân doar cele două praguri de mai sus.
- **[P1-1] Dreptul plătit unic:** fiecare cerere are **exact un** drept de apel plătit, consumat atomic de prima dintre:
  - **arbitrajul** pe dezacorduri, cerut de worker;
  - **fallback-ul** pe tot documentul, cerut de UI.

  A doua încercare primește starea sau rezultatul existent și nu mai cheltuie nimic. Dacă dreptul a fost consumat și apelul a eșuat, nu urmează alt apel plătit automat: rămâne butonul Haiku de azi, la clic.
- **[P1-1] Contextul de cost se ia de pe server:** proiectul, utilizatorul, șablonul, modelul (`claude-haiku-5-5`) și cheia plafonului (`izo_e3_ocr:<proiect_id>`) se citesc din rândul cererii. Nu vin din corpul cererii HTTP.
- **[P1-1] Timeout după trimiterea apelului:** costul e necunoscut, deci rezervarea rămâne păstrată (`fn_ai_plafon_deconteaza(id, NULL)` → `pastrat`), ca azi. Migrarea `20261105a` nu se modifică.
- **[P1-5] Pilotul acceptă doar PDF de exact o pagină**, verificat pe server (edge, la `cere`) și pe worker. Un PDF cu mai multe pagini nu intră pe calea locală: `cere` întoarce `multipagina`, iar UI-ul trece direct pe Haiku. Un PDF invalid sau criptat dă eroarea explicită `pdf_invalid`. Contractul complet de validare: **[r3-5]**.
- **[P1-4] Câmpurile structurale** sunt cele care decid ce piesă reprezintă un rând:
  - pe aviz: `nr_crt`, `serie`, `cantitate`;
  - pe lista de curbe: `nr_crt` (poziția), `serie`, `cod`, `cantitate`, `pachet_nr`, plus apartenența rândului la un pachet.

  Un dezacord pe un câmp structural nu se arbitrează pe celule: ramura locală se închide cu `esuata/structura_incerta`, iar UI-ul face fallback pe tot documentul. Pentru câmpurile structurale, `null` nu este o degradare acceptată.
- **Normalizarea finală se face o singură dată, în edge, cu `normalizeazaE3`**, atât pe rezultatele locale, cât și pe fallback. Workerul trimite obiectul în schema modelului, nu o propunere deja normalizată.

## 1. Fluxul (UI → coadă → worker → UI)

1. **În E3 (neschimbat până la `pdfAI`):** poza, apoi rotirea și decupajul făcute de om, apoi `imageToPdf` (maxDim 2600).
2. **Butonul implicit „Citește”**, cu modul `local`, cheamă `izo-e3-ocr-local` → `cere`. Răspunsul e unul din trei:
   - `local_indisponibil`, `noapte`, `multipagina`, `verificare_indisponibila` sau `limita_*` → ramura Haiku de azi, în aceeași operație, sub același lock (**[r3-7]**; nu se reapelează `citesteAI`);
   - `cerere_id` → polling pe `stare` la 1,5 s, până la `gata`, `esuata` sau `expirata`;
   - pe `esuata` sau `expirata` → `fallback` pe `izo-e3-ocr-local`, o singură dată.
3. **La `gata`:** `rezultat` are exact forma răspunsului `aviz_e3` de azi (`tip`, `sablon`, `antet`, `randuri`, `rotatie_grade`, `totaluri_tiparite`, `avertismente`, `model`, `cost_usd`, `plafon`), plus `sursa`. Codul existent din `citesteAI` (verificări, rotire, `setPropunere`) rămâne neschimbat.
4. **Contextul și secvența** (`contextAI`, `fisierSeq`) se verifică după fiecare răspuns și **înaintea** fallback-ului. Dacă s-au schimbat, polling-ul se oprește și fallback-ul nu mai pleacă.

## 2. Securitate și identități [P1-6]

- **Secretul:** `IZO_OCR_LOCAL_SECRET`, nou, stă în Vault, fără fallback la `OCR_LOCAL_SECRET`.
  - Antetul are alt nume, `x-izo-ocr-local-secret`.
  - Helperul e nou, `_shared/izoOcrLocal.ts`, cu numele secretului constant. Nu se refolosește `_shared/ocrLocal.ts` cu parametru.
  - Pe server, workerul citește secretul din fișierul `C:\Users\Gazpet-Ai\.secrete\izo_ocr_local_secret.txt`. Secretul nu apare în argumentele procesului, în loguri sau în URL-uri.
- **Separarea operațiilor:** cele de UI (`cere`, `stare`, `fallback`) cer JWT și refuză antetul de secret. Cele de worker (`preia`, `link`, `arbitreaza`, `rezultat`, `heartbeat`, `curata`) cer secretul și ignoră `Authorization`. O operație chemată pe canalul greșit primește 401.
- **`creat_de` se ia din JWT** (`auth.getUser()`). `stare` și `fallback` citesc contextul (proiect, depozit, șablon, PDF) din cererea stocată și refuză orice alt utilizator decât creatorul, cu `404` (fără să se scurgă dacă cererea există). Poarta E3 se reverifică la `fallback`, ca să prindă drepturile expirate între timp.
- **`link`** primește doar `{cerere_id, token}`. Întoarce un URL semnat pe 120 s pentru `pdf_cale` din rând, doar dacă starea e `preluata`, tokenul e cel curent și termenul local n-a trecut. Nu acceptă căi sau URL-uri din corpul cererii.
- **Conținutul OCR e doar date.** Parserul workerului nu încarcă resurse din HTML (`<img src>` se aruncă), nu interpretează scripturi și nu urmează linkuri. Edge-ul validează lista exactă a celulelor de arbitrat și tipul valorilor. Textul OCR nu poate alege operația, destinația, modelul sau suma.
- **Fișa de securitate (CLAUDE.md pct. 7):**
  - **(a) Conținut extern:** poza avizului, adică text scris de furnizor.
  - **(b) Ce scrie:** doar `ocr_local_cereri`, `ocr_local_worker`, bucket-ul `ocr-local-cereri` și registrul `ai_plafon_*`, numai prin RPC-urile existente. Nu scrie în `izo_*` sau `magazie_*`, nu trimite mail, nu atinge drepturi.
  - **(c) Identitate:** edge-ul folosește `service_role` doar pentru RPC-urile cozii și ale plafonului și pentru Storage. Drepturile utilizatorului le citește cu JWT-ul lui. Workerul are doar secretul.
  - **(d) Cine pornește:** cererea apare doar prin `cere`, după poarta E3. Workerul doar preia cereri. Cronul doar expiră cererile și face curățenie.
  - **(e) Confirmare umană:** aplicarea și salvarea. Cheltuiala are plafon, un singur drept plătit pe cerere și nicio reluare automată.
- **Registre:** la livrare se adaugă câte un rând în `automatizari` și în `registru_automatizari`, pentru worker, cron și edge.

## 3. Maparea (pe scurt; contractul exact e în §B3)

- **Grila [P1-3]:** `compare.segments` nu rezervă coloanele ocupate de un `rowspan`. Adaptorul E3 reconstruiește matricea de ocupare pornind de la HTML-ul brut.
  - Fiecare celulă își păstrează originea: rândul și coloana de start, plus `rowspan` / `colspan`.
  - Ofertarea nu se atinge: `compare.py` rămâne neschimbat.
- **Antetul de coloane:** se recunoaște pe dicționar (§B3), iar antetele repetate, totalurile și antetul documentului inclus în tabel se scot înainte de numărarea pieselor.
- **Pachetele:** `pachet_nr` și `dimensiuni_cm` se propagă pe toate rândurile acoperite de celula unită. `net_kg` și `brut_kg` rămân doar pe primul rând al pachetului.
- **Alinierea rândurilor** între cititori se face pe identitate (§B3), nu pe poziție.

## 4. Perspectiva și orientarea [P1-5][P1-7]

- **Îndreptarea perspectivei** e opțională și nedistructivă. Se aplică doar dacă patrulaterul detectat e sigur (§B3), iar altfel se citește imaginea originală. Nu se taie nimic din imagine.
- **Orientarea:** orientarea 0 se citește cu ambii cititori în paralel.
  - Dacă niciunul nu găsește antetul tabelului, LightOn încearcă singur 90, 180 și 270.
  - Orientarea găsită se folosește la **ambii** cititori (MinerU se rulează din nou pe ea) și se întoarce în `rotatie_grade`.

## 5. Disponibilitate, GPU, fereastra de noapte [P1-7]

- **Starea workerului** (`ocr_local_worker.stare`): `disponibil`, `ocupat`, `pornire`, `eroare`, `noapte`, `oprit`, plus `ora_server` și `ultimul_semn`.
  - Heartbeat-ul vine la 15 s.
  - `cere` admite doar dacă starea e `disponibil` și `ultimul_semn` are sub 45 s.
- **Coordonatorul GPU:** serviciul E3 ține `C:/Users/Public/paw-data/gpu.lock` (deținător `e3_serviciu`) **cât timp modelele sunt pornite**, între 06:00 și 22:00, Europe/Bucharest.
  - Citirile se fac cu `lock=False` în `read.py`, pentru că lacătul e ținut la nivel de serviciu.
  - La 22:00 workerul oprește ambele servere vLLM, confirmă oprirea (fără procese, VRAM eliberat, verificat cu `nvidia-smi`), eliberează lacătul și trece în `noapte`.
  - La 06:00: dacă lacătul e liber, îl ia, pornește modelele (`pornire`) și trece în `disponibil`. Dacă lacătul e ocupat (o rulare de laborator), rămâne `ocupat` și reîncearcă la 5 minute.
  - Rularea grea de laborator ziua se face doar după `e3 opreste` manual.
- **Memoria:** ambele modele încap simultan doar dacă se confirmă măsurat (LightOn ~0,30 + MinerU ~0,40 din 16 GB; de măsurat în B3). Dacă nu încap, B3 alege varianta „un singur model rezident, LightOn”, iar MinerU rulează pornit la cerere. În acest caz ținta de timp crește și trebuie anunțată chatului înainte de B4.

**Timpi țintă** (de măsurat la acceptare, nu promiși):
- preluare ≤ 3 s;
- pregătire ≤ 3 s;
- citire paralelă ≤ 10 s;
- arbitraj ≤ 15 s;
- total ≤ 30 s, iar plafonul tare e 90 s (`termen_local`).

## 6. Retenție și limite [P1-8]

- **`sterge_dupa`** = `creat_la` + 7 zile, fixat la `cere`.
- **Curățenia** se face prin edge-ul `curata`, chemat din cron (pg_cron la 30 min, `net.http_post` cu secretul din Vault). Pașii:
  1. ia până la 50 de cereri expirate;
  2. șterge obiectul din Storage API;
  3. confirmă prin `fn_ocr_local_curatenie_confirma`, care pune `pdf_cale = NULL`, `rezultat = NULL` și `sters_la`. Rândul rămâne ca jurnal, fără date.
  - Când ștergerea eșuează, se incrementează `stergere_incercari` și se scrie `stergere_eroare`. Cererea rămâne în lista de reluare.
  - Peste 10 încercări → o linie în `v_ocr_local_probleme`, citită de rutina zilnică.
- **Obiectele orfane** (upload reușit, insert eșuat sau restart) se tratează așa:
  - **[r3-6]** `cere` rezervă întâi cota și rândul (`fn_ocr_local_admite`, cu id și cale generate de server), apoi urcă obiectul, apoi confirmă (`fn_ocr_local_confirma_upload`). Dacă upload-ul eșuează, rândul rămâne `admisa` și expiră; obiectul parțial îl șterge `curata`;
  - dacă insertul eșuează, șterge imediat obiectul;
  - `curata` listează și obiectele din bucket mai vechi de 1 h fără rând asociat și le șterge.
- **Copiile de pe worker:** fiecare cerere are directorul `C:\ProgramData\Gazpet\e3_ocr\work\<cerere_id>\`, șters la final (`finally`). La pornire și o dată pe oră, workerul șterge directoarele mai vechi de 1 h. Nu se păstrează nimic local după `rezultat`, în afară de jurnalul fără conținut (`e3_ocr\jurnal.jsonl`: id, timpi, stări, coduri).
- **Limite:**
  - cel mult 2 cereri active pe utilizator;
  - cel mult 30 de cereri pe utilizator pe oră;
  - cel mult 400 de cereri pe zi, la nivel global;
  - PDF de cel mult 8 MB, o pagină, cel mult 25 MP la randare;
  - cel mult 200 de rânduri de tabel;
  - cel mult 120 de celule de arbitrat;
  - bucket-ul are `file_size_limit` 8 MB și `allowed_mime_types` doar `application/pdf`.

---

## B1 — Coada și persistența (migrare + revenire + harness PG)

**Fișiere:**
- `supabase/migrations/2026111Xa_ocr_local_cereri.sql`;
- `supabase/revenire/2026111Xa_..._ROLLBACK.sql`;
- `scripts/pg/test_ocr_local_cereri.sh`, harness PG16/17 în WSL, cu tiparul din `docs/ocrlab/test_20261101b.sh`.
- Livrarea se face prin `scripts/livrare_migrare.sh`, cu garda `gazpet.livrare_migrare`.

**Tabele:**

`public.ocr_local_cereri`:
- `id uuid PK`;
- `tip text CHECK (tip='aviz_e3')`;
- `proiect_id bigint NOT NULL`, `depozit_id bigint NOT NULL`;
- `sablon text CHECK IN ('aviz_teava','lista_curbe')`;
- `creat_de uuid NOT NULL → profiles(id)`, `creat_la timestamptz NOT NULL DEFAULT now()`;
- `pdf_cale text NULL`, `pdf_sha256 text CHECK ~ '^[0-9a-f]{64}$'`, `pdf_bytes int CHECK (1..8388608)`, `pagini int CHECK (pagini=1)`;
- `stare text CHECK IN ('ceruta','preluata','gata','esuata','expirata','fallback')`, `ramura text CHECK IN ('locala','haiku') NULL`;
- `termen_preluare timestamptz NOT NULL`, `termen_local timestamptz NOT NULL`;
- `token_executie uuid NULL`, `worker_id text NULL`, `preluata_la timestamptz`;
- `drept_platit_de text CHECK IN ('arbitraj','fallback') NULL`, `drept_platit_la timestamptz`, `rezervare_id bigint NULL → ai_plafon_rezervari(id)`;
- `rezultat jsonb CHECK (pg_column_size(rezultat) <= 524288)`, `eroare text CHECK (eroare ~ '^[a-z_]{1,40}$')`, `cost_usd numeric`, `terminata_la timestamptz`;
- `sterge_dupa timestamptz NOT NULL`, `sters_la timestamptz`, `stergere_incercari int DEFAULT 0`, `stergere_eroare text`.

Constrângeri de coerență:
- `(stare='preluata') = (token_executie IS NOT NULL AND preluata_la IS NOT NULL)` până la închiderea ramurii locale;
- `drept_platit_de IS NULL OR drept_platit_la IS NOT NULL`.

Indici: `(stare, termen_preluare)`, `(creat_de, creat_la)`, `(sterge_dupa) WHERE sters_la IS NULL`.

`public.ocr_local_worker`:
- `worker_id text PK`;
- `stare text CHECK IN ('disponibil','ocupat','pornire','eroare','noapte','oprit')`;
- `ora_server timestamptz`, `ultimul_semn timestamptz`;
- `modele jsonb` (nume, sha, gata);
- `versiune text`.

**Drepturi:**
- RLS activ pe ambele tabele.
- `authenticated` primește doar `SELECT` pe `ocr_local_cereri`, cu `creat_de = auth.uid()` (UI-ul trece totuși prin `stare`, iar politica e plasă de siguranță).
- Pe `ocr_local_worker`, niciun drept pentru `authenticated`.
- `anon` nu primește nimic. Fără `INSERT`/`UPDATE`/`DELETE` pentru nimeni în afară de RPC-uri.
- Funcțiile sunt `SECURITY DEFINER SET search_path = public, pg_temp`, cu `REVOKE ALL FROM PUBLIC, anon, authenticated` și `GRANT EXECUTE TO service_role`.

**RPC-uri** (semnături exacte; erorile se ridică cu `RAISE EXCEPTION '<cod>' USING ERRCODE='P0001'`):

| funcție | efect | refuzuri |
|---|---|---|
| `fn_ocr_local_admite(p_user uuid, p_proiect bigint, p_depozit bigint, p_sablon text, p_bytes int) → table(id uuid, cale text, termen_upload timestamptz)` **[r3-6]** | Pas 1, **înainte de Storage**. Jurnalizează încercarea în `ocr_local_incercari` (și pe cele respinse). Verifică limitele (încercări ≤ 60/oră/utilizator, active ≤ 2, admise ≤ 30/oră, ≤ 400/zi) și disponibilitatea workerului (`disponibil`, semn < 45 s, ora Europe/Bucharest între 06:00 și 22:00). Inserează rândul cu `stare='admisa'`, `termen_upload=now()+60s` și `cale = 'ocr-local-cereri/'\|\|id\|\|'.pdf'`; cota e consumată din acest moment. | `local_indisponibil`, `noapte`, `limita_incercari`, `limita_active`, `limita_ora`, `limita_zi`, `parametri_invalizi` |
| `fn_ocr_local_confirma_upload(p_id uuid, p_user uuid, p_sha text, p_bytes int) → table(termen_preluare, termen_local)` **[r3-6]** | Pas 2, după upload-ul reușit. Merge doar cu `stare='admisa'`, același utilizator și `now() < termen_upload`. Trece în `ceruta`, cu `termen_preluare=now()+20s`, `termen_local=now()+90s` și `sterge_dupa=now()+7d`. | `stare_invalida`, `termen_depasit` |
| `fn_ocr_local_preia(p_worker text) → table(id, token, sablon, cale, sha, termen_local)` | `FOR UPDATE SKIP LOCKED`: prima cerere `ceruta` cu `now() < termen_preluare`. O trece în `preluata`, cu `token_executie=gen_random_uuid()` și `ramura='locala'`. | 0 rânduri = nimic de luat |
| `fn_ocr_local_verifica_token(p_id, p_token) → table(cale, sablon, termen_local)` | Pentru `link`: verifică `stare='preluata'`, tokenul curent și `now() < termen_local`. | `token_invalid`, `termen_depasit` |
| `fn_ocr_local_drept_platit(p_id uuid, p_ramura text, p_token uuid NULL, p_user uuid NULL) → table(acordat bool, stare text, drept_platit_de text, apel_faza text, proiect bigint, user uuid, sablon text, cale text)` | **Atomic** (`UPDATE … WHERE drept_platit_de IS NULL AND …`), cu `apel_faza='acordat'`. `arbitraj`: cere `stare='preluata'`, tokenul curent și `now() < termen_local - 40s` **[r3-1]**. `fallback`: cere `p_user = creat_de` și `stare IN ('esuata','expirata')`, sau `stare IN ('ceruta','preluata')` cu termenul depășit; în al doilea caz o trece mai întâi în `expirata`. Pune `stare='fallback'`, `ramura='haiku'` și `termen_fallback=now()+120s` **[r3-1]**. Repetarea întoarce `acordat=false` și starea curentă. | `nu_e_creatorul` (404 în edge), `stare_invalida` |
| `fn_ocr_local_apel_faza(p_id uuid, p_faza text, p_rezervare bigint NULL, p_raspuns jsonb NULL, p_cost numeric NULL)` **[r3-1]** | Avansează faza apelului plătit, doar înainte: `acordat → rezervat` (leagă `rezervare_id`, obligatoriu ÎNAINTE de `count_tokens` / generare) → `trimis` (imediat înainte de `fetch /v1/messages`) → `raspuns` (persistă `apel_raspuns`: celulele arbitrajului sau propunerea normalizată a fallback-ului, ÎNAINTE de decontare) → `decontat` (după `fn_ai_plafon_deconteaza`). Ramurile de eșec: `esuat_inainte` (nu s-a trimis nimic, cost 0) și `esuat_dupa` (trimis, cost necunoscut). | `faza_invalida`, `deja_legata` |
| `fn_ocr_local_rezultat(p_id, p_token, p_rezultat jsonb, p_eroare text, p_cost numeric)` | Merge doar cu `stare='preluata'`, tokenul curent și `now() < termen_local` **(fără prelungire; [r3-1])**. Pune `gata` (cu rezultat) sau `esuata` (cu eroare) și `terminata_la`. | `token_invalid`, `ramura_inchisa`, `termen_depasit` |
| `fn_ocr_local_inchide_fallback(p_id, p_rezultat jsonb, p_eroare text, p_cost numeric)` | Merge doar cu `stare='fallback'`. Trece în `gata` sau `esuata`. | `stare_invalida` |
| `fn_ocr_local_stare(p_id, p_user) → table(stare, ramura, rezultat, eroare, termen_local, drept_platit_de)` | Doar pentru creator. Înainte de citire aplică expirarea punctuală (ce a trecut de termen devine `expirata`). | `nu_exista` |
| `fn_ocr_local_expira() → int` **[r3-1]** | Rulează din pg_cron la 1 minut și aplică aceleași reguli ca expirarea punctuală din `stare`. `admisa` după `termen_upload` → `expirata`; obiectul eventual urcat îl șterge `curata`. `ceruta` după `termen_preluare` și `preluata` după `termen_local` → `expirata`. Pentru `fallback` după `termen_fallback`, sau orice cerere cu `apel_faza` blocat (nu e `decontat` / `esuat_*`) la 120 s după `drept_platit_la`, finalizarea e conservatoare și **fără reapelare**: (a) cu `apel_raspuns` prezent → `gata`, cu rezultatul persistat (fallback) sau `esuata/local_cazut_dupa_arbitraj` (arbitraj); (b) faza `acordat`/`rezervat` → `fn_ai_plafon_deconteaza(rezervare, 0)`, cost 0, și `esuata/apel_pierdut`; (c) faza `trimis` → `fn_ai_plafon_deconteaza(rezervare, NULL)`, rezervare păstrată conservator, și `esuata/apel_pierdut`. | — |
| `fn_ocr_local_heartbeat(p_worker, p_stare, p_ora_server, p_modele jsonb, p_versiune)` | Face upsert pe rândul workerului. | `stare_invalida` |
| `fn_ocr_local_curatenie_lista(p_limita int) → table(id, cale)` / `fn_ocr_local_curatenie_confirma(p_id, p_ok bool, p_eroare text)` | Pentru §6. | — |

**Revenire:** se armează cu `OCR_LOCAL_REVENIRE:<txid>`. Refuză dacă există cereri care nu sunt în `expirata`/`gata`/`esuata`. Șterge, în ordine: cronurile, funcțiile, tabelele și bucket-ul (doar dacă e gol).

**Teste obligatorii** (în PostgreSQL real, cu rolurile reale `authenticated` / `service_role` / `anon`):
1. Două `preia` concurente → o singură cerere preluată.
2. `rezultat` cu token vechi → refuzat.
3. `rezultat` după `termen_local` → refuzat.
4. `expira` contra `rezultat` simultan → un singur câștigător.
5. `drept_platit` arbitraj contra fallback simultan → un singur `acordat`.
6. `drept_platit` repetat → `acordat=false`.
7. `fallback` de la alt utilizator → refuzat.
8. Limitele (active / oră / zi) sunt respectate.
9. `cere` noaptea sau cu worker fără semn → `local_indisponibil` / `noapte`.
10. `authenticated` nu poate scrie nimic și nu poate chema niciun RPC.
11. Drepturile pe `izo_*` sunt **identice** înainte și după migrare (diff pe `information_schema.role_table_grants` + `pg_proc.proacl`).
12. Revenirea pe o bază curată.

## B2 — Edge-ul și cheltuiala

**Fișiere:**
- `supabase/functions/izo-e3-ocr-local/index.ts`;
- `_shared/izoE3Poarta.ts`, cu poarta extrasă din `avizE3Handler.ts` fără nicio schimbare de logică (refactor limitat; testele existente `avizE3Handler_test.ts` trebuie să rămână verzi);
- `_shared/izoOcrLocal.ts`, cu secretul și canalul;
- `_shared/izoE3Haiku.ts`: apelul Haiku pe tot documentul, extras din `avizE3Handler`, ca fallback-ul să fie aceeași funcție. Primește `{pdf_base64, sablon, model, cheie_plafon, user}`;
- testele Deno.

`verify_jwt = false`: poarta e în cod.

**Operații de UI** (JWT):

- **`cere`** — intrare `{op:'cere', proiect_id, depozit_id, sablon, pdf_base64}`.
  1. Validează cererea ca `valideazaCerereE3`, fără `model`.
  2. Aplică poarta E3 (`_shared/izoE3Poarta.ts`).
  3. Validează PDF-ul după contractul **[r3-5]** (4 rezultate distincte), apoi `fn_ocr_local_admite` (**[r3-6]**, înainte de Storage).
  4. Calculează sha256.
  5. Urcă fișierul la `cale` (din `admite`), apoi `fn_ocr_local_confirma_upload`. Dacă upload-ul eșuează: încearcă să șteargă obiectul și răspunde `503 upload_esuat`; nu se încearcă din nou automat.
  6. Cheamă `fn_ocr_local_cere`; dacă eșuează, șterge obiectul urcat.

  Ieșiri:
  - `200 {success:true, cerere_id, termen_local}`;
  - `409 {success:false, eroare:'local_indisponibil'|'noapte'|'multipagina'|'verificare_indisponibila'}` — semnalul pentru UI să meargă pe Haiku;
  - `429 {eroare:'limita_*'}`;
  - `403 {eroare:'fara_drept'}`;
  - `400`, `413`, `422 pdf_invalid`.
- **`stare`** — intrare `{op:'stare', cerere_id}`, apelează `fn_ocr_local_stare(id, user)`. Ieșire `200 {success:true, stare, ramura, rezultat?, eroare?}`; dacă cererea nu există sau nu e a apelantului, `404`.
- **`fallback`** — intrare `{op:'fallback', cerere_id}`.
  1. Reverifică poarta E3 pe proiectul și depozitul **din rând**.
  2. Cheamă `fn_ocr_local_drept_platit(id,'fallback',NULL,user)`. Dacă dreptul nu e acordat, întoarce starea curentă: `200` cu rezultat dacă e `gata`, altfel `409 {eroare:'in_curs'|'deja_consumat'}`.
  3. Dacă dreptul e acordat: descarcă PDF-ul din Storage, apelează `izoE3Haiku` (rezervare plafon, `count_tokens`, apel, decontare — exact ca azi) și leagă rezervarea.
  4. Închide cererea cu `fn_ocr_local_inchide_fallback`.

  Ieșirea e răspunsul `aviz_e3` de azi, plus `cerere_id`.

**Operații de worker** (antetul `x-izo-ocr-local-secret`):

- **`preia`** — intrare `{op:'preia', worker_id}`; ieșire `{cerere:null}` sau `{cerere:{id, token, sablon, sha, termen_local}}`.
- **`link`** — intrare `{op:'link', cerere_id, token}`; ieșire `{url}`, semnat pe 120 s, nelogat.
- **`arbitreaza`** — intrare `{op:'arbitreaza', cerere_id, token, rotatie_grade, celule:[{rand:int≥1, camp:str, lighton:str|null, mineru:str|null, sugestie:str|null}]}`, cu cel mult 120 de celule.
  - `camp` trebuie să fie din lista **nestructurală**:
    - aviz: `sarja`, `lot`, `specificatie`, `dimensiune`, `grad_otel`, `izolatie`, `lungime_doc`, `greutate_kg`;
    - curbe: `sarja`, `item`, `diametru_mm`, `perete_mm`, `specificatie`, `unghi_doc`, `standard`, `dimensiuni_cm`, `net_kg`, `brut_kg`;
    - antet: toate cheile de antet din `ANTET_COMUN` / `ANTET_SPECIFIC`, cu `rand: 0`.
  - O celulă cu alt câmp sau dublă pe aceeași pereche (rand, camp) respinge **toată** cererea cu `400`.
  - Pași: `drept_platit(arbitraj, token)` → rezervarea plafonului (`rezervaE3` pe mesajul real, cu `count_tokens` obligatoriu; fail closed) → apelul Haiku cu PDF-ul cererii, descărcat de edge din Storage, nu trimis de worker. Apelul are `max_tokens = min(4000, 200 + 60·n)` și schema închisă `{celule:[{rand, camp, valoare:string|null, sigur:boolean}]}`.
  - **Validarea răspunsului:** mulțimea `(rand, camp)` din răspuns trebuie să fie **exact** cea cerută. Dacă lipsesc celule, sunt duble, apar câmpuri în plus, tipurile sunt greșite sau răspunsul e trunchiat (`stop_reason=max_tokens`), răspunsul nu se aplică deloc: întoarce `{arbitraj:'invalid'}`, iar workerul pune toate celulele pe `null`, cu avertisment.
  - Ieșiri: `{arbitraj:'ok', celule:[…]}`, `{arbitraj:'invalid'}`, `{arbitraj:'plafon_depasit'}`, `{arbitraj:'deja_consumat'}`.
- **`rezultat`** — intrare `{op:'rezultat', cerere_id, token, obiect|null, eroare|null, sursa}`. `obiect` respectă schema **brută** `schemaBrutaLocalE3(sablon)` (**[r3-3]**), nu `schemaE3`. Exact unul dintre `obiect` și `eroare` e nenul.
  1. Edge-ul rulează `normalizeazaE3(JSON.stringify(obiect), sablon)`; o excepție înseamnă eroarea `raspuns_local_invalid`.
  2. Construiește răspunsul complet `aviz_e3`: `model:'ocr_local:lighton+mineru'`, plus `+claude-haiku-5-5` dacă a existat arbitraj, `cost_usd` și `plafon`.
  3. Apelează `fn_ocr_local_rezultat`.

  Codurile de eroare locale: `structura_incerta`, `tabel_negasit`, `garda`, `prea_multe_dezacorduri`, `limita_randuri`, `pdf_invalid`, `multipagina`, `intern`.
- **`heartbeat`** — intrare `{op:'heartbeat', worker_id, stare, ora_server, modele, versiune}`.
- **`curata`** — §6; chemat de cron, cu același secret luat din Vault.

**Teste obligatorii** (Deno, cu un PostgREST local real pentru RPC-uri):
- secret greșit sau lipsă; JWT pe o operație de worker; secret pe o operație de UI;
- alt creator la `stare` sau `fallback`; drepturi expirate la `fallback`;
- `link` cu token vechi sau cu cale în corp;
- `arbitreaza` dublu, apoi `fallback` după arbitraj (un singur drept); fallback concurent cu arbitrajul;
- timeout după trimitere (`pastrat`); `count_tokens` indisponibil (cost 0, eliberat); răspuns trunchiat; JSON invalid; celule lipsă sau în plus;
- `rezultat` după termen;
- paritatea normalizării: aceleași fixture-uri ca `avizE3_test.ts`.

## B3 — Workerul și maparea (Python, pe serverul AI)

**Fișiere** (`scripts/ocr_local/`), fiecare cu testele lui:
- `e3_grila.py` — reconstruirea grilei din HTML;
- `e3_mapare.py` + `e3_dictionare.json` — antete de coloană → câmpuri, pe șablon;
- `e3_antet.py` — antetul documentului;
- `e3_aliniere.py` — compararea între cititori;
- `e3_perspectiva.py` — OpenCV; `opencv-python-headless` se adaugă în `env_mineru`, cu versiunea fixată;
- `e3_serviciu.py` — bucla, heartbeat-ul, lacătul GPU, programul zi/noapte;
- `e3_client.py` — operațiile cu secret; refolosește tiparul din `client.py` (IP loopback, fără proxy, timeout-uri), cu antetul și fișierul de secret noi;
- `test_e3_*.py`.

Comenzi:
- `python -m ocr_local e3 serveste`;
- `python -m ocr_local e3 opreste`;
- `python -m ocr_local e3 stare`.

**e3_grila** [P1-3]
- Intrarea e HTML-ul brut al unui `<table>`. Parsarea se face cu `html.parser` din biblioteca standard, fără încărcare de resurse.
- Ieșirea e o listă de rânduri. Fiecare celulă e `{text, origine:(r0,c0), rowspan, colspan, e_origine:bool}`.
- Algoritmul e cel clasic, cu matrice de ocupare: fiecare `<td>` se pune în prima coloană liberă a rândului și marchează ocupate `rowspan × colspan` poziții.
- Testele includ exemplul reprodus de Jakarinos: `["P1 ⟦rowspan=2⟧","A","100"]` / `["B","200"]` → rândul 2 = `[P1(cont.), "B", "200"]`.
- Inconsistențele (rânduri cu lățimi diferite după ocupare, `rowspan` care trece de finalul tabelului) duc la eroarea `structura_incerta`.

**e3_mapare**
- Antetul de coloane e primul rând sau primele două rânduri ale căror celule normalizate (litere mari, fără diacritice, spații comprimate) se potrivesc cu dicționarul pentru **cel puțin 4 coloane obligatorii**:
  - aviz: NR CRT, NR TEAVA, NR SARJA, CANTITATE/GREUTATE;
  - curbe: BEND NUMBER, CODE, PIPE HEAT NUMBER, QUANTITY.
- Rândurile din corpul tabelului:
  - se exclud antetele repetate (aceleași valori ca antetul);
  - se exclud rândurile `TOTAL…`, mutate în `totaluri_tiparite` / antet;
  - se exclud rândurile de antet de document incluse în tabel (eticheta e în dicționarul de antet), mutate în antet.
- Maparea câmpurilor e cea din §3 r1 (preluată din `promptE3`), plus regulile de pachet: `pachet_nr` și `dimensiuni_cm` se iau de la originea celulei unite pentru toate rândurile acoperite, iar `net_kg` și `brut_kg` doar pe rândul în care `e_origine=true`.
- Numerele se dau ca text brut, conform schemei brute **[r3-3]**. Normalizarea finală o face edge-ul (`normalizeazaE3` / `numarKgE3`), urmată de `validaStructuraE3` (**[r3-2]**).
- Pentru comparare, workerul folosește un port Python al `numarE3` / `numarKgE3`, cu test de paritate pe aceleași fixture-uri.

**e3_aliniere** [P1-3][P1-4]
- Cheia rândului:
  - aviz: `(nr_crt, serie)`;
  - curbe: `(serie, cod)`.
- Dacă cheile nu sunt unice într-un cititor → `structura_incerta`.
- Rândurile se potrivesc pe cheie. Dacă un rând există la un singur cititor, sau numărul de rânduri diferă → `structura_incerta`. Nu există toleranță de „±1 rând”.
- Pe fiecare rând potrivit se compară câmpurile **structurale**. Orice diferență, inclusiv o valoare goală față de una plină → `structura_incerta`.
- Câmpurile nestructurale cu diferențe sau cu o valoare goală față de una plină → celule de arbitrat.
  - Peste 120 de celule → `prea_multe_dezacorduri`, cu fallback în UI.
- Validare încrucișată la curbe: `cod` conține `serie` și `sarja` (formatul `serie-…-sarja-item`). Dacă `sarja` diferă între cititori și doar una dintre valori se potrivește cu `cod`, aceea se trimite ca `sugestie`; nu se aplică automat.
- Totalurile tipărite se compară separat. O sumă de rânduri diferită de totalul tipărit dă un avertisment, nu blochează.

**Rezultatul arbitrajului:**
- `valoare` cu `sigur:true` → se aplică.
- `sigur:false` → se aplică, cu avertisment pe rând („verifică <câmp>: L=…, M=…, ales …”).
- `invalid`, `plafon_depasit` sau `deja_consumat` → câmpul devine `null`, cu avertismentul „cititoarele nu s-au înțeles: L=…, M=…”. E sigur, pentru că sunt doar câmpuri nestructurale.

**e3_perspectiva**
- Detecția: grayscale → blur → Canny → contururi → `approxPolyDP`.
- Se acceptă doar un patrulater convex care:
  - are aria cuprinsă între 35% și 98% din imagine;
  - are toate colțurile în imagine;
  - are unghiurile interioare între 60° și 120°.
- Se aplică doar dacă abaterea maximă de la dreptunghi e > 3°.
- **[r3-4] Înlocuit:** transformarea se aplică pe **cadrul întreg** (vezi R3-4), nu pe patrulater cu margine.
- `sursa.perspectiva` ia una dintre valorile `aplicata`, `nesigura` sau `inutila`.
- Riscul de a detecta conturul tabelului în locul foii e acoperit de pragul de arie și de comparația pe ambele variante în testele de acceptare.

**e3_serviciu** — bucla:
- `heartbeat` la 15 s;
- `preia` la 1 s când starea e `disponibil`;
- pe o cerere:
  1. director de lucru;
  2. `link` → descărcare → verificarea sha256 și a numărului de pagini (exact 1, PyMuPDF; criptat → `pdf_invalid`);
  3. randare la 150 dpi (≤ 25 MP), perspectivă, orientare (§4);
  4. LightOn și MinerU **în paralel** (două fire, `read.py` cu `lock=False`, garda v5);
  5. grila → maparea → alinierea;
  6. `arbitreaza`, dacă există celule de arbitrat;
  7. `rezultat`;
  8. ștergerea directorului.

  Orice excepție duce la `rezultat` cu eroarea `intern` și la ștergerea directorului.
- **Garda** oprește un cititor → ramura locală `esuata/garda`, cu fallback; un singur cititor nu e suficient pentru propunere locală. **Limita de rânduri:** peste 200 → `limita_randuri`.
- **Programul zi/noapte și lacătul GPU** sunt cele din §5. Serverele vLLM se pornesc și se opresc cu scripturile din `scripts/ocr_local/servicii/`, adaptate din `start_lighton.sh` / `start_mineru.sh` / `stop_vllm.sh` din laborator, cu memoria fixată după măsurare. Oprirea se confirmă prin lipsa proceselor și VRAM eliberat.
- **Serviciul Windows:** `e3 serveste` rulează ca task la pornirea serverului, cu repornire la cădere (Task Scheduler). Nu se creează fișiere `.ps1`/`.cmd` noi; task-ul cheamă direct `python.exe`.

**Teste obligatorii:**
- grila cu `rowspan` / `colspan` mixte;
- rând lipsă la un cititor, rând dublat, chei duplicate;
- `cantitate` 1 contra 4 → `structura_incerta`;
- pachet pe 2 sau 3 rânduri: greutatea doar pe primul;
- kg și metri în formatul „1,343” / „9.920” / „12.50”, cu paritate Python–TS;
- PDF cu mai multe pagini sau criptat;
- rotire 90° la LightOn, apoi rerulare MinerU pe aceeași orientare;
- perspectivă nesigură → imaginea originală;
- restart în timpul unei cereri: directorul se curăță, iar tokenul vechi e refuzat;
- fixture-uri reale: cele două poze E9, cu rezultatul așteptat scris de om.

## B4 — UI și acceptare

**Fișiere:**
- `src/izoOcrLocal.js` — helper nou, testabil fără React;
- `src/izoOcrLocal.test.js`;
- `src/IzoDocumenteIntrare.jsx` — doar `citesteAI` primește modul `'local'`, plus mesajele de stare;
- `src/izoDocumentePrefill.test.js` — teste noi;
- `docs/izometrie/E9_ACCEPTARE.md`.

**Helperul `citesteLocal({ pdfAI, ed, actual, invoke, timers })`** întoarce `{raspuns}` sau `{haiku:true, motiv}`. Regulile:
1. `cere`:
   - `409` sau `429` → `{haiku:true}`, fără altă cerere;
   - `403` / `400` / `413` / `422` → eroarea de azi, pe aceleași texte.
2. Polling `stare` la 1,5 s, cu limita de client `termen_local + 5 s` (**[r3-1]**; după aceea `stare` aplică expirarea). Înainte de fiecare pas se verifică `actual()`; dacă e `false`, polling-ul se oprește, fără fallback.
3. `gata` → `raspuns = rezultat`.
4. `esuata` sau `expirata` → **un singur** `fallback`, doar dacă `actual()`:
   - `200` → `raspuns`;
   - `409 in_curs` sau răspuns HTTP pierdut → polling pe `stare` până la `termen_fallback + 5 s` (**[r3-1]**); `gata` → rezultatul persistat, `esuata/apel_pierdut` → mesajul de eșec, fără alt apel automat;
   - altfel → eroarea „Citirea a eșuat. Completează manual sau încearcă din nou cu Haiku.”
5. Fără reîncercări automate peste cele de mai sus. Nimic nu se aplică sau se salvează automat.

**Mesaje:**
- „Citesc local…”;
- „Serverul local e oprit (noaptea 22–06) — citesc cu Haiku”;
- „Cititoarele nu s-au înțeles — citesc cu Haiku”;
- „Plafon AI depășit”, ca azi.

`aiMeta.sursa` se afișează în detalii: timpii, numărul de dezacorduri, perspectiva.

**Teste obligatorii** (cu timp controlat, `vi.useFakeTimers`):
- `gata` rapid; `gata` întârziat;
- `expirata` → un singur fallback;
- `409` → Haiku direct;
- schimbarea fișierului sau a editorului în timpul polling-ului → fără fallback și fără `setPropunere`;
- plafon epuizat;
- `fallback` `in_curs`;
- niciun apel `aplicaAI` / `salveaza` fără clic.

Prefill: kg „1,343” → 1343 în formular; metri cu zecimale; câmp nestructural `null` → gol în formular; rândul cu `cantitate > 1` rămâne exclus, ca azi.

**Acceptare** (`E9_ACCEPTARE.md`):
- 10–20 de documente reale (avize și liste de curbe, drepte și fotografiate din unghi), cu valorile adjudecate de om;
- pe fiecare: local contra Haiku pe tot documentul, câmp cu câmp;
- timpii măsurați pe hardware-ul real, cu ambele modele rezidente;
- costul real pe cerere (din `ai_plafon_rezervari`);
- concluziile limitate la setul testat: funcționează pe aceste documente, fără să certifice că localul e superior.

## R3 — contracte care închid review-ul Jakarinos r2 (au prioritate asupra textului de mai sus)

### R3-1 — Fazele apelului plătit, termenele unice, recuperarea

**Coloane noi în `ocr_local_cereri`** (B1):
- `stare` primește și valoarea `'admisa'` (R3-6);
- `termen_upload timestamptz NULL`;
- `termen_fallback timestamptz NULL`;
- `apel_faza text CHECK IN ('acordat','rezervat','trimis','raspuns','decontat','esuat_inainte','esuat_dupa') NULL`;
- `apel_raspuns jsonb NULL`, cu `CHECK (pg_column_size ≤ 524288)`.

Constrângeri:
- `apel_faza IS NULL` ⇔ `drept_platit_de IS NULL`;
- `rezervare_id IS NOT NULL` pentru fazele de la `rezervat` încolo, cu excepția `esuat_inainte`.

**Ordinea în edge, identică pentru arbitraj și fallback** (o singură funcție, `apelPlatitE3(cerere, ramura, construiesteMesaj, valideazaRaspuns)`):
1. `drept_platit` → dacă dreptul nu e acordat, se întoarce starea / `apel_raspuns` existent.
2. `fn_ai_plafon_rezerva`, apoi **imediat** `apel_faza(rezervat, rezervare)`. Dacă legarea eșuează: `deconteaza(rezervare, 0)` și `apel_faza(esuat_inainte)`.
3. `count_tokens`. Dacă numărarea eșuează → `deconteaza(0)` și `esuat_inainte`.
4. `apel_faza(trimis)`, apoi `fetch /v1/messages` (timeout 30 s).
5. Răspuns primit:
   - răspunsul se validează;
   - **`apel_faza(raspuns, apel_raspuns = rezultatul validat, sau {invalid:true, motiv})`**;
   - `deconteaza(cost real)`, apoi `apel_faza(decontat)`.
6. Timeout sau eroare după trimitere → `deconteaza(NULL)` (rezervarea rămâne păstrată) și `apel_faza(esuat_dupa)`.

**Repetarea** cererii (aceeași cerere, oricare ramură) nu mai cheltuie nimic și răspunde după faza în care a rămas apelul:

| faza | răspuns la repetare |
|---|---|
| `raspuns` / `decontat` | `apel_raspuns` persistat |
| `esuat_*` | `deja_consumat` |
| `acordat` / `rezervat` / `trimis` | `in_curs` |

Recuperarea după o cădere a edge-ului o face `fn_ocr_local_expira` (rândul din tabelul B1). Nu există niciodată un al doilea apel.

**Regula unică de termene** (aceleași valori în `stare`, `rezultat`, `expira` și UI; constantele stau într-un singur loc pe fiecare parte: `ocr_local_config` în BD și `izoOcrLocal.js` în UI):

| moment | regulă |
|---|---|
| `T0` | `confirma_upload` |
| preluare | până la `T0 + 20 s` |
| rezultat local | **strict** `< T0 + 90 s`, fără nicio prelungire |
| arbitraj | se poate porni doar `< T0 + 50 s` (= `termen_local − 40 s`); timeout-ul apelului e 30 s, deci arbitrajul se termină înainte de `T0 + 80 s` și rămân 10 s pentru `rezultat` |
| fallback | `termen_fallback` = acordare + 120 s (count + apel 30 s + marjă) |
| UI | urmărește `termen_local + 5 s`, apoi `termen_fallback + 5 s`; după aceea starea vine doar din `stare` |

**Teste B1/B2:**
- cădere înainte de `rezervat`, între `rezervat` și `trimis`, după `trimis` și după `raspuns` (fără `decontat`) → finalizările (a), (b) și (c) din `expira`, cu suma corectă în `ai_plafon_lunar`;
- răspuns HTTP pierdut, urmat de repetare → rezultatul persistat, fără al doilea apel;
- `rezultat` la secundele 89 (acceptat), 90 și 91 (refuzat);
- `fallback` la secunda 119 față de 121 (`expira`);
- arbitraj cerut la secunda 49 (acceptat) și 51 (refuzat → workerul pune celulele pe `null` și trimite rezultatul).

### R3-2 — Validitatea structurală pe șablon (înainte și după normalizare)

Verificarea se face pe **rânduri**, în două locuri:
- **în worker**, pe valorile brute ale ambilor cititori, înainte de comparare;
- **în edge**, după `normalizeazaE3`, cu funcția nouă `validaStructuraE3(propunere, sablon)` din `avizE3.ts`, cu teste.

Orice rând care nu trece duce **toată** ramura locală la `esuata/structura_incerta`, iar UI-ul face fallback. Nu se scoate doar rândul respectiv, pentru că propunerea parțială ar ascunde piese.

| regula | aviz_teava | lista_curbe |
|---|---|---|
| `nr_crt` | prezent la ambii, întreg ≥ 1, unic, egal | poziția (1..n), egală |
| `serie` | prezentă la ambii, nevidă, egală, unică | prezentă, nevidă, egală, unică |
| `cod` | — | prezent, nevid, egal; conține `serie` ca prim segment |
| `cantitate` | **avizul nu are coloană de bucăți**: „CANTITATE (M)” e lungimea și se mapează pe `lungime_doc`. `cantitate` rămâne `null`; un rând = o țeavă cu serie proprie, iar `randNormalizat` ignoră `cantitate` la țevi. Dacă dicționarul găsește pe un aviz o coloană de bucăți (BUC / PCS / QTY), pilotul o refuză → `structura_incerta`. | prezentă la ambii și **exact întregul 1**. Absentă, `0`, fracționară, `>1` sau ilizibilă → `structura_incerta`. Rândurile cu `>1` le exclude deja prefill-ul, dar pilotul nu le propune deloc. |
| `pachet_nr` | — | prezent pe fiecare rând (din originea celulei unite), egal |
| `lungime_doc` | prezentă, `normalizeazaE3` → număr > 0 (dezacordurile merg la arbitraj ca nestructurale; după arbitraj, `null` e permis cu avertisment) | rămâne `null` |

După normalizare, `validaStructuraE3` reverifică regulile din tabel pe propunerea finală, inclusiv după arbitraj. Asta prinde cazurile `0/0`, `1.5/1.5` sau `null/null`, pe care acordul dintre cititori nu le prinde. La refuz, edge-ul salvează `esuata/structura_incerta`, nu propunerea.

**Teste:** cantitate absentă la ambii cititori, `0/0`, `1.5/1.5`, `2/2`, serie goală la ambii, `nr_crt` duplicat, aviz cu coloană BUC. Testul merge **până la prefill + `randNormalizat`**: niciuna dintre aceste propuneri nu trebuie să ajungă în formular.

### R3-3 — Schema brută a workerului, separată de cea normalizată

- **`schemaBrutaLocalE3(sablon)`**, nou în `avizE3.ts`: aceleași chei ca `schemaE3`, dar **toate frunzele sunt `string|null`** (textul exact citit, fără conversii). Excepții:
  - `rotatie_grade` e `integer` (0/90/180/270);
  - `avertismente` e `string[]`.
- Cheile în plus sau tipurile greșite → `rezultat` refuzat cu `400 obiect_invalid`, iar cererea trece în `esuata/raspuns_local_invalid`.
- `rezultat` are două ramuri disjuncte:
  - `{obiect: <brut>, eroare: null}` → validare pe schema brută, apoi `normalizeazaE3(JSON.stringify(obiect), sablon)` (funcția acceptă deja numere ca text, prin `numarE3` / `numarKgE3`), apoi `validaStructuraE3`, apoi `gata`;
  - `{obiect: null, eroare: <cod din lista B2>}` → **fără normalizare**, direct `esuata/<cod>`.
- Celulele arbitrate (`valoare` text) se pun în obiectul brut **înainte** de `rezultat`, tot ca text.
- `rezultat` (normalizat) are schema răspunsului `aviz_e3` de azi, plus `sursa`. Testul de contract compară cheile cu ce așteaptă `citesteAI`.

**Teste:** payload real produs de worker pe cele două poze E9 (fixture JSON salvat în repo) → validarea edge → normalizare → `aplicaPropunereOCR` → `randNormalizat`. Se verifică toate câmpurile `_kg` („1,343” → 1343, „9.920” → 9920), metrii („12.50” → 12500 mm în RPC) și milimetrii („8,8” → 8.8). Separat: ramura de eroare nu atinge normalizatorul.

### R3-4 — Perspectiva pe cadrul întreg; reconcilierea serviciului după cădere

**Perspectiva:**
- Omografia `H` se calculează din patrulater spre dreptunghi, dar se aplică pe **întreaga imagine**. Cele 4 colțuri ale imaginii originale se transformă cu `H`, iar pânza de ieșire e dreptunghiul lor de încadrare (cu translația aferentă). Pixelii din afara patrulaterului rămân în imagine, deci antetul și totalurile nu se pierd.
- Pânza e limitată la 25 MP (scalare uniformă dacă trece de prag).
- Se aplică doar dacă **toate** condițiile sunt adevărate:
  1. patrulaterul convex are 4 colțuri în imagine și ocupă ≥ 50% din aria ei;
  2. „foaia” e demonstrată prin luminanță: mediana în interiorul patrulaterului e cu ≥ 25 de niveluri peste mediana unei benzi de 3% din afara lui, iar ≥ 70% din perimetru are gradient puternic, ca margine de hârtie;
  3. abaterea de la dreptunghi e > 3°.

  Altfel se folosește imaginea originală (`sursa.perspectiva='nesigura'` sau `'inutila'`).
- Un tabel trapezoidal pe foaie albă nu trece condiția 2: interiorul și exteriorul lui au aceeași luminanță.
- **Test obligatoriu:** imagine sintetică cu un tabel trapezoidal valid geometric, cu furnizorul deasupra și totalurile dedesubt, în afara conturului. După procesare, OCR-ul (sau compararea de pixeli pe zonele marcate) trebuie să găsească încă textul din afara conturului.

**Reconcilierea după cădere** (`e3_serviciu`, la pornire și la fiecare 60 s):
- Fișierul de stare e `C:\ProgramData\Gazpet\e3_ocr\servicii.json`, cu PID-urile din WSL, ora pornirii și sha-ul greutăților.
- Procesele `vllm serve` se enumeră în WSL după tiparul modelelor.
- **În afara ferestrei 06–22** (inclusiv după o repornire la 22:05): oprește orice proces `vllm serve` E3, confirmă că lipsesc procesele și că VRAM-ul s-a eliberat (`nvidia-smi`, sub pragul de bază + 1 GB), eliberează lacătul dacă îl ține `e3_serviciu` și trece în `noapte`.
- **În fereastră:** un model se adoptă doar dacă `/health` = 200, `/v1/models` conține numele servit și sha-ul greutăților din `protocol.json` coincide cu cel din fișierul de stare. Altfel modelul se oprește și se repornește.
- **Lacătul:** `gpu.lock` conține `{detinator, pid, pornit_la, gazda}`. E considerat vechi dacă procesul nu mai există sau dacă `pornit_la` e anterior ultimei porniri a sistemului; un lacăt vechi al lui `e3_serviciu` se reia. Lacătul altui deținător (laboratorul) nu se atinge niciodată: starea devine `ocupat`.
- **Teste:** kill -9 pe serviciu cu modelele pornite (repornirea adoptă modelele sau le oprește, după oră); repornire la 22:05 (modele oprite, lacăt eliberat); lacăt vechi după reboot; lacătul laboratorului ocupat la 06:00.

### R3-5 — Un singur contract de validare PDF

- **În edge:** `npm:pdf-lib@1.17.1` (rulează în Deno; limitarea din CLAUDE.md privește bundle-ul Vercel, nu edge-ul). Se încarcă cu `PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })`, cu timeout de 3 s.
- **Pe worker:** PyMuPDF, aceeași clasificare.

| rezultat | condiție | răspuns `cere` | UI |
|---|---|---|---|
| `mono` | încărcat, necriptat, `getPageCount() === 1` | continuă | local |
| `multi` | încărcat, necriptat, `> 1` pagini | `409 multipagina` | Haiku automat |
| `invalid` | antet lipsă (`%PDF`), excepție de parsare, structură coruptă, PDF criptat (`EncryptedPDFError` sau `/Encrypt`) | `422 pdf_invalid` | mesaj de eroare, **fără** Haiku automat (nici Haiku nu poate citi fiabil un PDF criptat sau corupt) |
| `neverificabil` | timeout de 3 s sau eroare internă a validatorului, fără legătură cu fișierul | `409 verificare_indisponibila` | Haiku automat (calea de azi acceptă orice `%PDF` ≤ 8 MB) |

`/Type /Page` căutat în text **nu** se folosește. Numărul de pagini vine doar din arborele de pagini al bibliotecii.

**Teste:** PDF criptat; PDF trunchiat; PDF cu object streams comprimate (pagina e invizibilă la căutarea în text); PDF cu textul `/Type /Page` într-un stream de conținut, dar cu o singură pagină reală; PDF de 2 pagini; fișierul `imageToPdf` real din E3.

### R3-6 — Cota înainte de Storage

- Tabelul nou **`ocr_local_incercari`** (`id`, `user`, `la`, `rezultat`) jurnalizează toate apelurile `cere` care trec de poarta E3, inclusiv cele respinse. RLS e activ și nimeni nu are drepturi, doar RPC-urile. Se curăță după 30 de zile.
- **Limitele** sunt verificate în `fn_ocr_local_admite`, **înainte** de orice operație Storage, sub `pg_advisory_xact_lock(hashtext('ocr_local_cota'))`, ca să fie atomice la concurență:
  - încercări ≤ 60/oră/utilizator, oricare ar fi rezultatul;
  - active (`admisa` / `ceruta` / `preluata` / `fallback`) ≤ 2/utilizator;
  - admise ≤ 30/oră/utilizator și ≤ 400/zi global.
- Workerul indisponibil, noaptea sau limita atinsă → răspuns imediat, **fără upload**. Încercarea se jurnalizează, ca să nu poată fi repetată la infinit.
- Upload-urile abandonate: rândul `admisa` expiră la `termen_upload` (60 s). `curata` șterge obiectul de la `cale`, dacă există, și obiectele fără rând mai vechi de 1 h.
- **Teste B1/B2:**
  - 3 `cere` concurente pentru același utilizator → cel mult 2 admise;
  - limita orară atinsă exact;
  - workerul oprit → 0 obiecte în bucket;
  - upload eșuat → rând `admisa` expirat și obiect șters;
  - ștergere eșuată → `stergere_incercari` crește și cererea rămâne în listă;
  - orfan fără rând → șters după 1 h;
  - `sterge_dupa` atins → `pdf_cale` și `rezultat` = NULL.

### R3-7 — Haiku în UI fără reintrare

`citesteAI(mod)` se rescrie ca **o singură operație sub un singur lock**:

```
citesteAI(mod = 'local'):
  gardă (pdfAI, busy, aiLock, drepturi) → aiLock = true
  try:
    rez = mod === 'local' ? await citesteLocal(...) : { haiku: true }
    if (rez.haiku && actual()) rez = await executaHaikuE3(pdf_base64, context)   // funcție internă, FĂRĂ gardă/lock
    if (!actual()) → abandon
    proceseazaRaspuns(rez.raspuns)   // codul de azi: verificări, rotire, setPropunere
  finally: aiLock = false
```

- `executaHaikuE3` e corpul de azi al `citesteAI`, mutat fără gardă și fără lock.
- Butonul „Citește cu Haiku” cheamă `citesteAI('haiku')`. Nu există apeluri recursive.

**Test la nivel de componentă** (Vitest + Testing Library, cu `IzoDocumenteIntrare` montat și `supabase.functions.invoke` simulat):
- `cere` → 409 → **exact un** `invoke('ocr-packing-list')`;
- `cere` → 429 → la fel;
- `expirata` → exact un `fallback` și niciun `ocr-packing-list`;
- schimbarea fișierului în timpul polling-ului → 0 apeluri Haiku;
- dublu-clic → o singură operație.

## Estimare (orientativă, r3)

| bucată | zile |
|---|---|
| B1 — coada + RPC (faze apel, cotă, recuperare) + harness PG | 2,5 |
| B2 — edge + apel plătit pe faze + validare PDF + schemă brută + teste | 2,5 |
| B3 — worker + grilă/mapare/aliniere/validitate + perspectivă cadru întreg + reconciliere serviciu + teste | 3–3,5 |
| B4 — UI fără reintrare + teste de componentă + acceptare | 1,5 |
| **total** | **~9–10 zile** de lucru Codex + review (Jakarinos pe B1, B2, B3; Copilot pe B1, migrare și cost) |
