# E9 — citirea avizelor E3 cu OCR local (LightOn + MinerU) și Haiku doar pe dezacorduri — DESIGN r2

Stare: **design r2, fără cod** (laborator OCR, 23.10.2026), pe PR #855.
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
- **[P1-5] Pilotul acceptă doar PDF de exact o pagină**, verificat pe server (edge, la `cere`) și pe worker. Un PDF cu mai multe pagini nu intră pe calea locală: `cere` întoarce `multipagina`, iar UI-ul trece direct pe Haiku. Un PDF invalid sau criptat dă eroarea explicită `pdf_invalid`.
- **[P1-4] Câmpurile structurale** sunt cele care decid ce piesă reprezintă un rând:
  - pe aviz: `nr_crt`, `serie`, `cantitate`;
  - pe lista de curbe: `nr_crt` (poziția), `serie`, `cod`, `cantitate`, `pachet_nr`, plus apartenența rândului la un pachet.

  Un dezacord pe un câmp structural nu se arbitrează pe celule: ramura locală se închide cu `esuata/structura_incerta`, iar UI-ul face fallback pe tot documentul. Pentru câmpurile structurale, `null` nu este o degradare acceptată.
- **Normalizarea finală se face o singură dată, în edge, cu `normalizeazaE3`**, atât pe rezultatele locale, cât și pe fallback. Workerul trimite obiectul în schema modelului, nu o propunere deja normalizată.

## 1. Fluxul (UI → coadă → worker → UI)

1. **În E3 (neschimbat până la `pdfAI`):** poza, apoi rotirea și decupajul făcute de om, apoi `imageToPdf` (maxDim 2600).
2. **Butonul implicit „Citește”**, cu modul `local`, cheamă `izo-e3-ocr-local` → `cere`. Răspunsul e unul din trei:
   - `local_indisponibil`, `multipagina` sau `limita` → `citesteAI('haiku')`, calea de azi, automat, o singură dată;
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
  - `cere` urcă obiectul în `ocr-local-cereri/<uuid>.pdf` cu uuid generat de server, apoi inserează rândul cu același id;
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
| `fn_ocr_local_cere(p_id uuid, p_user uuid, p_proiect bigint, p_depozit bigint, p_sablon text, p_cale text, p_sha text, p_bytes int, p_pagini int) → table(id, termen_preluare, termen_local)` | Verifică admiterea: `ocr_local_worker` are un rând `disponibil` cu `ultimul_semn > now()-45s` și ora din Europe/Bucharest e între 06:00 și 22:00. Verifică limitele (§6). Inserează rândul cu `stare='ceruta'`, `termen_preluare=now()+20s`, `termen_local=now()+90s`, `sterge_dupa=now()+7d`. | `local_indisponibil`, `noapte`, `limita_active`, `limita_ora`, `limita_zi`, `multipagina`, `parametri_invalizi` |
| `fn_ocr_local_preia(p_worker text) → table(id, token, sablon, cale, sha, termen_local)` | `FOR UPDATE SKIP LOCKED`: prima cerere `ceruta` cu `now() < termen_preluare`. O trece în `preluata`, cu `token_executie=gen_random_uuid()` și `ramura='locala'`. | 0 rânduri = nimic de luat |
| `fn_ocr_local_verifica_token(p_id, p_token) → table(cale, sablon, termen_local)` | Pentru `link`: verifică `stare='preluata'`, tokenul curent și `now() < termen_local`. | `token_invalid`, `termen_depasit` |
| `fn_ocr_local_drept_platit(p_id uuid, p_ramura text, p_token uuid NULL, p_user uuid NULL) → table(acordat bool, stare text, drept_platit_de text, proiect bigint, user uuid, sablon text, cale text)` | **Atomic** (`UPDATE … WHERE drept_platit_de IS NULL AND …`). `arbitraj`: cere `stare='preluata'`, tokenul curent și `now() < termen_local - 35s`. `fallback`: cere `p_user = creat_de` și `stare IN ('esuata','expirata')`, sau `stare IN ('ceruta','preluata')` cu termenul depășit; în al doilea caz o trece mai întâi în `expirata`. Pune `stare='fallback'` și `ramura='haiku'`, ceea ce închide ramura locală. Repetarea întoarce `acordat=false` și starea curentă. | `nu_e_creatorul` (404 în edge), `stare_invalida` |
| `fn_ocr_local_leaga_rezervare(p_id, p_rezervare bigint)` | Leagă rezervarea plafonului de cerere, o singură dată. | `deja_legata` |
| `fn_ocr_local_rezultat(p_id, p_token, p_rezultat jsonb, p_eroare text, p_cost numeric)` | Merge doar cu `stare='preluata'` și tokenul curent. Fereastra de timp e `now() < termen_local`, sau `now() < termen_local + 30s` dacă `drept_platit_de='arbitraj'` (apelul plătit, cu timeout 25 s în edge, poate depăși cu puțin termenul). Pune `gata` (cu rezultat) sau `esuata` (cu eroare) și `terminata_la`. | `token_invalid`, `ramura_inchisa`, `termen_depasit` |
| `fn_ocr_local_inchide_fallback(p_id, p_rezultat jsonb, p_eroare text, p_cost numeric)` | Merge doar cu `stare='fallback'`. Trece în `gata` sau `esuata`. | `stare_invalida` |
| `fn_ocr_local_stare(p_id, p_user) → table(stare, ramura, rezultat, eroare, termen_local, drept_platit_de)` | Doar pentru creator. Înainte de citire aplică expirarea punctuală (ce a trecut de termen devine `expirata`). | `nu_exista` |
| `fn_ocr_local_expira() → int` | Rulează din pg_cron la 1 minut: `ceruta` după `termen_preluare` și `preluata` după `termen_local` (+30 s dacă e în arbitraj) devin `expirata`. | — |
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
  3. Numără paginile din PDF (cu `pdf-lib` sau un parser minim pentru `/Type /Page`; dacă nu se poate determina sigur, întoarce `multipagina`).
  4. Calculează sha256.
  5. Urcă fișierul în `ocr-local-cereri/<uuid>.pdf`.
  6. Cheamă `fn_ocr_local_cere`; dacă eșuează, șterge obiectul urcat.

  Ieșiri:
  - `200 {success:true, cerere_id, termen_local}`;
  - `409 {success:false, eroare:'local_indisponibil'|'noapte'|'multipagina'}` — semnalul pentru UI să meargă pe Haiku;
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
- **`rezultat`** — intrare `{op:'rezultat', cerere_id, token, obiect|null, eroare|null, sursa}`. `obiect` respectă schema `schemaE3(sablon)`.
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
- Numerele se dau ca text brut. Normalizarea finală o face edge-ul (`normalizeazaE3` / `numarKgE3`).
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
- Ieșirea e imaginea îndreptată, cu marginea de 2% păstrată; fără decupare peste patrulater. Dacă nu se aplică, se citește imaginea originală.
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
2. Polling `stare` la 1,5 s, cu limita de client `termen_local + 35 s`. Înainte de fiecare pas se verifică `actual()`; dacă e `false`, polling-ul se oprește, fără fallback.
3. `gata` → `raspuns = rezultat`.
4. `esuata` sau `expirata` → **un singur** `fallback`, doar dacă `actual()`:
   - `200` → `raspuns`;
   - `409 in_curs` → polling `stare` încă 60 s;
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

## Estimare (orientativă)

| bucată | zile |
|---|---|
| B1 — coada + RPC + harness PG | 1,5 |
| B2 — edge + refactor poartă/Haiku + teste | 1,5–2 |
| B3 — worker + grilă/mapare/aliniere/perspectivă + serviciu + teste | 2,5–3 |
| B4 — UI + teste + acceptare | 1–1,5 |
| **total** | **~7–8 zile** de lucru Codex + review (Jakarinos pe B1, B2, B3; Copilot pe B1, migrare și cost) |
