# PIPELINE AS-IS — modulul Ofertare (Gazpet ERP)

**Sursa**: repo `gazpet-test/pontaj-pro` @ `main` `55779b5` (23.09.2026) + schema și datele LIVE Supabase `dxczwkbciseqniprspcu` (citite în aceeași zi). Read-only: nimic modificat, nimic propus. Construită din 8 felii detaliate (anexele 01–08, cu Step_ID-uri, citate de cod și linii); acest document consolidează. Când e nevoie de linia exactă, anexa e sursa.

Legendă fișiere: `OL` = `src/OfertareLicitatii.jsx` · `OP` = `src/OfertarePropunere.jsx` · `EF/<n>` = `supabase/functions/<n>/index.ts` (sau `core.ts`) · `W/<n>` = `worker/ofertare/<n>.ts` · `SQL:<fn>` = funcție Postgres `public`.

---

## 0. Fapte de producție care schimbă lectura hărții (23.09.2026)

| Obiect | Live | Ce înseamnă |
|---|---|---|
| `ofertare_pt_pachet` / `_fisiere` / `ofertare_pt_poarta` / storage `ofertare/pt/*` | **0 / 0 / 0 / 0** | Lanțul pachet → manifest → hash → poartă semnată **nu a rulat niciodată** în producție |
| Licitații `depusa|castigata|pierduta` | **54**, toate fără pachet; **53 fără nicio cerință** în `ofertare_cerinte`; 0 derogări | `depusa` s-a atins mereu în afara oricărei dovezi; `fn_gate_depunere` trece trivial cu 0 cerințe |
| Domnești (lic 5, depusă de mână 18.09) | status **`in_lucru`** | Depunerea reală nu are nicio urmă în ERP |
| `ofertare_raspuns_set` / `ofertare_cerinte.inlocuita_de` / `versiune>1` / `raspuns_clarificare_id` | **0 / 0 / 0 / 0** | Supersession-ul cerințelor (răspuns AC → versiune nouă) există în cod, **nu a fost folosit** |
| `ofertare_acoperire_revizii` | 2 (manuale); `fn_ofertare_revizie_noua` fără niciun apelant în cod | Reviziile de acoperire sunt schemă fără flux |
| `ofertare_acoperire` | 2707; `ales=true` 2234 dar `ales_de` doar **6**; `verificat_pe_scan` 8; `acoperire_snapshot` 0 | „Ales" e artefact de migrare, nu decizie umană |
| `ofertare_pt_legaturi` | 271: **270 `sursa='ai'`** pe lic 5, create 17.09, 0 confirmate; niciun cod din repo nu scrie `sursa='ai'` | Legăturile cerință→capitol de la Domnești au fost inserate prin SQL, nu prin aplicație |
| `ofertare_pt_capitole` | 15 (toate lic 5), toate `sursa='ai'`, toate `stare='gol'` | Mașina de stări a capitolului (gol→scris→verificat) nu e scrisă de niciun cod |
| `ofertare_pt_dovezi` / `pt_afirmatii` / `pt_observatii` / `pt_participanti` / `pt_declaratii` | 0 / 0 / 0 / 0 / 0 | `pt_afirmatii` nu are nicio cale de INSERT în repo |
| `ofertare_cerinte` | 4283; **1196 fără pagină, 1017 fără pasaj, 9 fără document**; 16 confirmate cu pasaj neverificat; 210 `duplicat_al` (o singură operație manuală) | Proveniența e opțională și parțial absentă |
| `ofertare_cantitati` | 1078; **1072 `extras`** (nevalidate), toate `extras_de_ai`; `tip_sursa` setat o singură dată prin backfill | Cifrele AI intră în F3/Gantt/poartă ca fapte |
| `ofertare_clarificari` | 41; 33 fără `cheie`; `raspuns_la` nescris de UI | — |
| `grafic_versiuni` | 1 rând (lic 85, `mod='import'`, `poarta=[]`, inserat prin SQL); lic 5 are 20 activități editate și 0 versiuni | Working ≠ versiune, fără avertisment |
| `ofertare_verificari` | 2 (1 galben, 1 verdict NULL) | Verdictul nu e legat de nicio versiune |
| `ofertare_extragere_coada` | niciun producător în repo | Extragerea „pe server" e operată manual (SQL) |

---

## 1. PIPELINE_AS_IS

Coloane: Step_ID · Stage · Trigger · UI/component · Function/API/RPC · Tables/views · Input → Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream_consumer · Failure/retry. Detaliul complet (linie cu linie) e în anexa indicată de prefixul Step_ID: **L** = 01, **C** = 02, **A** = 03, **K** = 04, **Q/R/G-garanție/P-garanție** = 05, **G** = 06, **P** = 07, **F** = 08.

### 1.1 Licitație → import SEAP → documente (anexa 01)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status_before → after | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L01 | Radar SEAP | cron `ofertare_radar_0500/1230` sau buton | `OL` `RadarLicitatii.scaneaza` L3350 | `EF/ofertare-radar-scan` L88-299; auth = `x-radar-secret` **sau orice JWT valid** | `ofertare_radar`, `ofertare_radar_scan_log` | zile → anunțuri noi + scor | — → `radar.status='nou'` | NONE (cron) / orice user | Haiku 4.5, scor+motiv+lipsuri | rândul radar se suprascrie | `nr_seap`, `c_notice_id`; `noticeDocumentUrl` temporar salvat (inutilizabil) | L02, L03 | erori în `scan_log.eroare`; rescore max 5/rulare |
| L03 | Promovare → licitație | „Promovează" | `OL` `promoveaza` L3368 | insert `ofertare_licitatii` + update radar | `ofertare_licitatii`, `ofertare_radar` | rând radar → licitație `identificata` | — → `identificata` | `window.confirm` | NONE | n/a | `nr_anunt` UNIQUE, `link_seap`, `radar.licitatie_id` | L06 | update radar neverificat |
| L04 | Înregistrare manuală + E0 autofill | „＋ Licitație nouă" / drag PDF | `OL` `LicitatieFormModal` L455-590 | `EF/ofertare-e0-autofill`; insert licitație + doc fișă `e0/...` | `ofertare_licitatii`, `ofertare_documente_atribuire`, bucket | formular+PDF → licitație + doc | — → `identificata` | confirm anti-dublură | AI propune câmpuri | edit = update in place | `nr_anunt`; docul fișă în afara prefixului `<lic>/atribuire/` | L06 | toast |
| L05/L14/L16/L17 | Tranziții status | „Marchează …" | `OL` `TRANZITII` L50-57 → `schimbaStatus` L279-285 | `update({status})` — **fără rol, fără confirm**; server: doar `trg_gate_depunere` (L16) | `ofertare_licitatii` | — | `identificata→analiza`, `go→in_lucru`, `in_lucru→depusa`, `depusa→castigata/pierduta` (harta doar în UI) | click, orice user cu acces modul | NONE | n/a; fără istoric de status | — | filtre, GBE, etapa1-mail | excepție trigger → toast |
| L13 | GO / NO-GO | „🟢 GO"/„⛔ NO-GO" (doar `analiza` + owner **în UI**) | `OL` `decide` L288-299 | `update({decizie_go, decizie_de, decizie_la, status})` | `ofertare_licitatii` | decizie+motivare → `go`/`abandonata` | `analiza` → `go`/`abandonata` | owner **doar client-side** (L289); RLS = orice autentificat | NONE | a doua decizie suprascrie fără istoric | `decizie_de/la` | L14 | toast |
| L06 | Import documentație SEAP (edge) | „⬇️ Adu din SEAP" / veghe | `OL` `aduDinSeap` L769-838 | `EF/ofertare-seap-import` L330-553; auth secret / **orice JWT** / service | `ofertare_documente_atribuire`, bucket `<lic>/atribuire/`, SEAP | listă fișiere → rânduri `sursa:'seap'`, `tip=ghicesteTip` | orice → neschimbat | click / NONE | NONE | **fără**: `cheieNume` existent → sărit (versiunea nouă nu se aduce) | `nume_original`; **fără hash**, link SEAP nesalvat | L08, L09 | buget 240s → `continua`; >20MB → Vercel |
| L07 | Import treapta grea (Vercel) | din L06 sau veghe | `OL` L816 | `api/seap-import.js` L115-224 | idem, doar `DownloadArchive` | idem | — | click/NONE | NONE | dedup pe `nume_original` **exact** (altă cheie decât L06) | idem | L08 | `break` la eroare |
| L08 | Upload manual | „📁 Urcă folder/fișiere" | `OL` `urca` L720-767 | storage + insert/update | idem | fișiere → rânduri `sursa:'upload'` | — → `neprocesat`/`ignorat` | click (RLS acces modul) | NONE | dedup `nume|size`; același nume altă mărime → **rând nou nelegat** | fără hash | L09 | insert neverificat |
| L10 | Veghe SEAP | cron `ofertare_seap_veghe_0520/1250` / buton | `OL` `DocumenteNoiSection.verificaAcum` L2698 | `EF/ofertare-seap-veghe` L230-624 | `ofertare_licitatii` (**update `termen_depunere`** automat L430), `ofertare_documente_atribuire`, `notifications`, Resend | SEAP → docuri noi + răspunsuri (`seap_cod`, `seap_meta.inlocuieste`=nume vechi) + termen nou | orice (fără filtru status: și `depusa/castigata`) → termen rescris | NONE | NONE | versiune nouă = **rând nou**; rândul vechi rămâne `procesat`, eligibil la extragere | `seap_cod` (23 rânduri); `inlocuieste` ca text, nu id; fără hash | L12, K05, K08 | retry ×4 SEAP; erori în raport |
| L12 | Citire AI document nou | „🤖 Citește cu AI" | `OL` L2687; `OfertareClarificari.jsx` `urcaRaspuns` L222 | `EF/ofertare-document-nou-citeste`; auth `fn_are_acces_ofertare()` | `ofertare_documente_atribuire.analiza.citire_noi`, `tip` | PDF → rezumat, modificări, întrebări răspunse, `termen_nou`, `data_document` | neschimbat; `tip` schimbat de AI dacă era `alta` | click | Sonnet 5 | `citire_noi` **suprascris** la recitire | `citit_de` | K07 legare | `{error}` |
| L09 | Procesare text (ingest) | „🤖 Procesează" / „☁️ Pe server" | `OL` `proceseaza` L886 / `proceseazaPeServer` L697 | `EF/ofertare-ingest-doc`; `SQL:ofertare_ingest_tick` (cron 1/min); `W/ingest` | `ofertare_documente_atribuire` (`text_extras`, `antet`, **`revizie`**), `ofertare_ingest_coada/lansari` | PDF → text cu `⟦PAGINA n⟧` + antet | `neprocesat`→`in_lucru`→`procesat/partial/eroare` | poarta pe cost `poatePorniProcesarea` **doar UI**; tick-ul nu reverifică | Sonnet/Haiku transcriere; **`revizie` = citită de AI din antet** (L301) | `revizie`/`antet` suprascrise la reprocesare; fără istoric text | `procesat_de` | C05, C06, P07 | retry ×2 UI; lease 3 min, max 4 încercări server |
| L15 | Aplicare răspuns (după depunere) | „Aplică" | `OL` `aplicaSelectia` L1076 | `EF/ofertare-raspuns-set` → `SQL:fn_ofertare_raspuns_set_aplica` | vezi K10 | — | `depusa` → motiv obligatoriu (server) | da | NONE | vezi K10 | — | — | — |
| L18/L19/L11 | Cron-uri informative | zilnic/săptămânal | — | `EF/ofertare-etapa1-mail`, `EF/ofertare-participari-import`, `SQL:ofertare_alerte_atentie` | `ofertare_raport_zilnic`, `ofertare_mailuri`, `ofertare_participari`, `notifications` | — | — | NONE | NONE | upsert | — | om | — |
| L20 | Revizii acoperire | **fără apelant** | `OL` L2198 (doar citire + diff) | `SQL:fn_ofertare_revizie_noua`, `fn_ofertare_diff_revizii` | `ofertare_acoperire_revizii/istoric` | — | — | — | NONE | `revizie=max+1` | `document_id` opțional | UI diff | NOT IMPLEMENTED ca flux (2 rânduri manuale) |

### 1.2 Ingest → cerințe → triere (anexa 02)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C02/C02b/C02c | Citire PDF (3 căi) | browser / `ofertare_ingest_tick` / worker NAS | `OL` `proceseaza` | `EF/ofertare-ingest-doc` (AI) · `SQL:ofertare_ingest_tick` · `W/ingest` (pdftotext, AI doar pe scan) | `ofertare_documente_atribuire`, `ofertare_ingest_coada/lansari`, `worker_heartbeat` | PDF → `text_extras` | `neprocesat`→`procesat/partial/eroare` | `autorizat()` owner/responsabil/service/anon+coadă; **rândul de coadă e scriibil de orice autentificat** (RLS) | Sonnet (fișă/formulare) / Haiku (rest); worker: Haiku doar antet | fără; `partial` reluat concatenând | `⟦PAGINA n⟧` produs în **4 locuri cu reguli diferite** (AI+`asiguraMarcaje` cu interval/clamp; pdftotext exact; launcher awk; Word deloc) | C05 | 2 retry UI; lease 3 min/4 încercări; tick tace când heartbeat NAS <10 min |
| C03 | Text Word | **neapelat din UI** | — | `EF/ofertare-word-text` (orice JWT) | idem | .docx → text **fără pagini**, `status='procesat'` forțat | orice → `procesat` | niciuna | — | rescrie integral | fără pagină | C05 | text <50 car → nu scrie |
| C04 | Planșe | „📐 citește" | `OL` `citestePlansa` L961 | `api/plansa-felii` → `EF/ofertare-plansa-citeste` (**orice JWT**, Opus) | `analiza.citire_ai`, `ofertare_cantitati` | felii JPEG → tronsoane → Q03 | doc neatins | click (fără rol) | Opus 5 | `citire_ai` suprascris | etichetă felie | Q03 | felie cu eroare → `amanat` |
| C05 | Completitudine | „🤖 Extrage cerințele" | `OL` `CerinteSection.extrage` L1485 (`confirm`) | `SQL:ofertare_pregatire_extragere`; view `v_ofertare_completitudine` | `ofertare_documente_atribuire` | → lista problemelor | — | `confirm()` „OK = extrag oricum"; **`blocheaza` din view nu e citit** | — | — | — | C06 | — |
| C06/C06b/C06c | Extragere cerințe | browser / `ofertare_extragere_tick` / worker | `OL` L1504-1548 (secțiuni III,IV,II,rest + corpus) | `EF/ofertare-cerinte` → `core.ts extrageCerinte` L152-325; `SQL:ofertare_extragere_tick/pasi` | `ofertare_cerinte` INSERT L310; `ai_feedback` few-shot | text → rânduri (text ≤200 car **parafrază**, tip, lot, document_probant, cand_se_prezinta, pagina, pasaj) | — → `de_analizat`, `confirmata_de NULL`, `versiune 1` | `autorizat()`; `reset` = DELETE neconfirmate | Opus 5 implicit; worker: **Sonnet pe corpus** (decis de worker, nu de coadă) | **fără**: re-extragere = DELETE+INSERT | `sursa_document_id`, `sursa_pagina` (fallback = pagina afirmată de model dacă pasajul nu e găsit L292-298), `sursa_pasaj` **stocat și când nu e găsit** (L127), `pasaj_verificat` | C07, A01, P02 | INSERT necondiționat → **duplicate la reluare**; după 3 eșecuri pasul e sărit fără urmă |
| C07 | Registru: confirmare/corecție/stare | om | `OL` `confirma` L1561, `salveazaCorectia` L1566, `respinge` L1572 (**DELETE**), `confirmaTot` L1579, `setStare` L1591 | PostgREST (RLS `fn_are_acces_ofertare`) | `ofertare_cerinte`, `ai_feedback` | → `confirmata_de/la`; corecție in-place | neconfirmată → confirmată; `stare` CHECK | **poarta E2** = confirmarea (oricine cu acces modul) | — | corecția **nu versionează**; `pasaj_verificat` rămâne true pe pasajul vechi | — | acoperire, PT | — |
| C08 | Clasificare registru | RPC (fără apelant în src) | — | `SQL:fn_ofertare_clasifica_registre` | `ofertare_cerinte.registru` | verdict AI acoperire + ILIKE nume fișier → registru | NULL → capabilitate/depunere/executie, `registru_sursa='regula'` | niciuna (`'om'` fără writer) | indirect (consumă `status` AI) | — | — | `AcoperireSection.load` filtru | JOIN pe 1..3 acoperiri → nedeterminist |
| C09 | Duplicate | **fără writer** | UI „desfă" | — | `duplicat_al` | — | — | — | — | — | — | toți cititorii filtrează | 210 rânduri manuale |
| C10 | Versionare prin răspuns | vezi K10 | | | | | | | | **singura** cale `versiune+1` | | | |
| C11 | Triere | „⚡ Triere" | `src/OfertareTriere.jsx` `ruleaza` L126 | `EF/ofertare-triere` v1.8 | `ofertare_triere` (upsert on licitatie_id) | PDF fișă + catalog HR → verdict, roluri, matrice (calculată din BD), risc | — | fără poartă; „Participăm → procesează tot" **doar schimbă tab-ul** | Sonnet 5; codul re-derivă matricea/punctajele | upsert = ultima rulare | `rezultat.sursa` doc | UI | `max_tokens` → fail |
| C12 | Inventar AI independent | apel manual edge | `OL` `InventarIndependentSection` L1795 | `EF/ofertare-inventar-ai`; `SQL:ofertare_inventar_pereche` | `ofertare_inventar_ai`; UI INSERT `ofertare_cerinte` **fără `sursa_document_id`/pasaj** | PDF → obligații; om → registru | verdict NULL → acoperit/lipsa → confirmat/respins | „➕ în registru" | Gemini / GPT; pasaj **neverificat** | versiune per (doc, model) | pagina afirmată de model | registru | JSON invalid → fail |
| C13 | Pagini goale | cron 06:15 | — | `SQL:ofertare_pagini_goale/alerta` | `notifications` | pagini >400 car fără cerință | — | — | — | — | folosește `sursa_pagina` (NULL invizibil) | om | — |
| C14 | Pilot CLI NAS (B1, branch) | `run_pilot.sh <folder> source_pack` | — | `worker/claude-cli/launcher.sh` + `verifica_pack.mjs` (validator fără AI) | **nicio tabelă** | folder → `source_pack.pack.json` (text verbatim + locator validat literal) | — | om pornește; import B2 nescris | Sonnet (abonament) | fișier per rulare | locator + validare pagină/document; cerința nevalidată **iese** în `nereusite` | B2 (viitor) | exit codes; fără retry |

### 1.3 Acoperire / dovezi / resurse (anexa 03)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A01 | Pornire „Propune acoperiri" | click | `OL` `AcoperireSection.propune` L2086 | upsert `ofertare_acoperire_coada` **direct din client** | coadă | → rând activ | — | click, fără rol, fără confirm cost | — | — | `cerut_de` | A02 | fără fallback pg_cron (nu există `ofertare_acoperire_tick`); rândul rămâne activ la nesfârșit |
| A02 | Worker NAS felii | buclă worker | — | `W/acoperire` `proceseazaAcoperire` L217-299 (felii 55/27, retry 3) | `ofertare_cerinte` (**fără filtru `duplicat_al`**), coadă | → felii | — | niciuna (service_role) | — | **nu apelează `fn_ofertare_revizie_noua`** | — | A03 | felie spartă pierde `conflicte_ales_de_om`/`clarificari_noi` |
| A03/A04 | Motor AI + gărzi cod | din A02 / edge | — | `EF/ofertare-acoperire/core.ts propuneAcoperiri` L92-605 (R1–R20); post-procesare L339-462 | catalog 7 surse (HR, doc firmă, parteneri, experiență, recomandări, studii, vechime) | cerințe+catalog → `{status, autorizatie_id/…, scor, motiv, domeniu_rte, clarificare}` | — | edge: owner/responsabil; **calea reală (worker) fără poartă** | Opus 5; R14 „rețele de gaze fără precizare = distribuție"; R10 domeniu principal; cod: `gol` doar-expirat → **`acoperit`** (L419-424); scor inventat `90-i*20` | — | doar FK; **fără fisier_path/pagină/hash** | A05 | JSON invalid → fail fără scriere |
| A05 | Scriere atomică | din A03 | — | `SQL:fn_ofertare_acoperire_rescrie` | `ofertare_acoperire` | rows → UPDATE pe cheie / INSERT / DELETE | orice → status AI | niciuna; protejate doar cerințele cu `verificat_pe_scan` sau `ales_de` | — | **in-place, fără istoric**; rândurile `ales=true` nesemnate sunt actualizate dar nu șterse | `updated_at` | A08 | — |
| A06 | Reverificare alese expirate | din A05 | — | `SQL:fn_ofertare_acoperire_reverifica_alese` | `ofertare_acoperire` | → `valabil_la_depunere=false`, `reverificare_ceruta` | — | — | — | — | — | KPI | doar autorizații+doc firmă; fără R15 |
| A07 | Clarificări auto (R9/R14) | din A03 | — | `core.ts` L550-575 INSERT `ofertare_clarificari` | `ofertare_clarificari` | → `de_trimis`, `origine:'platforma'`, **fără `cheie`** | — | omul trimite | text AI | — | `sursa` text = cheie de idempotență | K04 | eroarea nu invalidează acoperirea |
| A08 | Afișare candidați | render | `OL` `AcoperireSection.load` L2052; `src/ofertareOrdine.js` | — | — | — | — | — | — | — | — | — | ordonare pe `ales_de` (Licitații) vs `ales` (`OfertareCerinte.jsx`) → **candidați diferiți pe ecrane diferite** |
| A09 | Alegere manuală (3 căi) | click | `OL` `alegeCandidat` L2008; `OfertareCerinte.jsx` `foloseste` L243, `alegeCandidat` L592 | `SQL:fn_ofertare_alege_acoperire` | `ofertare_acoperire` | → `ales=true, ales_de=uid` | orice → ales | click; **RPC nu validează status/valabilitate/scan** | — | `ales_de` = „cine a ales ACUM"; UPDATE in place suprascrie candidatul AI #1 (scor/motiv AI rămân) | — | F9, organigramă | — |
| A10 | „Verificat pe scan" | click | `OL` `verifica` L2109 | UPDATE | `ofertare_acoperire` | → `verificat_pe_scan`, `fisier_path` copiat | — | click (doar autorizații cu scan) | — | — | cale copiată; **fără hash/pagină/versiune**; scan înlocuit în HR → cale orfană rămâne „verificat" | motorul nu mai atinge cerința | — |
| A13 | Răspuns AC → acoperire mutată | din K10 | — | `SQL:fn_ofertare_raspuns_set_aplica` L239-247 | `ofertare_acoperire.cerinta_id` mutat + `reverificare_ceruta`; `acoperire_snapshot` pe cerința veche | — | — | — | — | snapshot (0 în producție) | — | — | `verificat_pe_scan`/`ales_de` rămân pe text neverificat |
| A15 | Clasificare registru din verdict AI | RPC | — | `SQL:fn_ofertare_clasifica_registre` | `ofertare_cerinte.registru` | `status` AI → registru | — | — | indirect | — | — | ascunde cerința din ecranul acoperire | — |
| A16 | „Pornește din acoperiri" → echipa F9 | click | `OP` `importaEchipa` L1842-1885 | SELECT `ofertare_acoperire WHERE mod='personal'` **fără filtru status/ales/verificat** → INSERT `ofertare_pt_echipa` + `_roluri` | `ofertare_pt_echipa(_roluri)` | toți candidații (≤3/cerință, inclusiv alternativele) → membri echipă | propus de AI → **în echipă** | click, fără selecție per persoană | — | fără | rol fără FK la `ofertare_acoperire.id` | A17, F9 | — |
| A17/A18 | Blocaje F9 + confirmare disponibilitate | render / click | `OP` `exportaF9` L1904; `confirmaDisponibil` L1895 | view `v_ofertare_pt_echipa_blocaje` | `ofertare_pt_echipa` | — | — | export final blocat doar de view; **`disponibil_confirmat_la` nu e cerut nicăieri** | — | — | fără dovadă/perioadă | DOCX F9 (fără hash) | — |
| A19/A20 | Personal/echipamente disponibile; F23 | click | `OP` `genereazaPachet` L1476; `exportaF23` L1618 | `SQL:fn_ofertare_personal_disponibil`, `fn_ofertare_echipamente_disponibile`; view `v_ofertare_dotari` | logistica/magazie | → liste afișate; F23 DOCX | — | — | — | — | F23 **global**, fără ITP/expirări, fără alocare per licitație | DOCX | — |
| A21 | Afirmații PT / conformitate | — | `OP` doar UPDATE | view `v_ofertare_pt_conformitate` | `ofertare_pt_afirmatii` | — | — | — | — | — | — | poartă WARN permanent (0 rânduri) | **niciun INSERT în repo** |
| A22/A23 | Participanți / organigramă | click | `OP` `Participanti`; `OfertareOrganigrama.jsx` `propune` L695 | `EF/ofertare-organigrama-spec` (Sonnet, rol în cod) | `ofertare_pt_participanti`, `ofertare_organigrama` | acoperiri `status acoperit*` (fără ales) → noduri | — | om | Sonnet spec | upsert | `spec_citate` doc+offset | — | organigrama și F9 = două liste independente din aceleași acoperiri, filtre diferite |

### 1.4 Clarificări → răspunsuri AC → supersession → solicitări AC (anexa 04)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| K01 | Clarificare din acoperire (R9) | rulare acoperire | — | `EF/ofertare-acoperire/core.ts` L550-574 | `ofertare_clarificari` | → `de_trimis`, fără `cheie` | — → `de_trimis` | nu (scrie direct) | text din motor | nu | `sursa` text | K04 | eroarea nu invalidează |
| K02 | Clarificări propuse (generator 22.09) | „☁️ Propune clarificări" → coadă → worker / edge | `src/OfertareClarificari.jsx` `propuneServer` L109 | `EF/ofertare-clarificari-propune/core.ts` L57-162; `W/clarificari` | `ofertare_clarificari` (upsert `licitatie_id,cheie`), `ofertare_clarificari_coada` | registru + goluri + diferențe cantități + istoric → întrebări | — → `de_trimis` | poartă pe **cost** (owner/responsabil); **nu pe conținut** | Sonnet; dedup SHA-256 + Jaccard ≥0.75 (TS) | nu; ignoreDuplicates | `cheie`; `cerinte_ids/prioritate/risc` **pierdute ca date** (rămân în textul `sursa`) | K04 | retry 3 worker |
| K03/K03b | Clarificare scrisă de om / PDF extern + citire | „＋ întrebare" / „📎 Clarificare externă" | `OfertareClarificari.jsx` L124, L405 | `EF/ofertare-clarificare-citeste` (Haiku, **orice JWT**) | `ofertare_clarificari` | → `de_trimis` / **`trimisa` direct** | — | om | Haiku poate **înlocui `intrebare`** dacă placeholder | `saveQ` rescrie in-place la blur | `origine`, `creat_de`; fără `cheie` | — | toast |
| K04 | Adresa de clarificări | „📄 Generează adresa" | `genereazaAdresa` L141-199 (PDF client) | — | **niciuna** (PDF descărcat, nestocat, fără hash) | → PDF local | `de_trimis` → `trimisa` **manual din select**, fără dată | om | — | — | — | reminder SQL se oprește | — |
| K05/K06 | Document răspuns AC intră + citire AI | veghe / „📥 Răspuns primit" | `urcaRaspuns` L222 | `EF/ofertare-document-nou-citeste` | `ofertare_documente_atribuire` (`tip raspuns_clarificare`, `aparut_ulterior`) | PDF → `citire_noi{rezumat, intrebari_raspunse, termen_nou, data_document}` | — → `neprocesat` | upload | Sonnet; `data_document` extras de AI, nu ajunge în coloană | recitire suprascrie | fără sha256, fără dată SEAP | K07 | — |
| K07 | Legare răspuns → întrebare | „🔗 La ce întrebări răspunde?" | `leaga` L256-274; select pe rând L463 | UPDATE `ofertare_clarificari` | `ofertare_clarificari` | bife (scor lexical overlap/min ≥0.34) → `raspuns_document_id`, `status='raspunsa'`, **`raspuns` = `raspuns_scurt` AI sau `rezumat` sau întreg `text_extras`** | `trimisa` → `raspunsa` | bife + buton; textul intră fără editare obligatorie | AI propune potrivirea și textul | nu; `raspuns_la` **nescris de UI** | `raspuns_document_id` | **`EF/ofertare-genereaza-capitol` L159**: „RĂSPUNSURILE AUTORITĂȚII … prevalează" (injectat în prompt) | — |
| K08 | Set de răspuns (document-first) | „📋 Analizează impactul" | `OL` `ruleazaAnaliza` L1037 | `EF/ofertare-raspuns-set` `creeaza_set` | `ofertare_raspuns_set(_doc)` | `document_ids` → set `nou`; **fără legătură la clarificare** | — → `nou` | poartă pe modul | — | — | doc-uri | K09 | — |
| K09 | Inventar + Compară | bucle UI | idem | `inventar`/`compara` L200-499 | `ofertare_raspuns_set.propunere` (dispoziții, operații `modifica|anuleaza|noua`, amprente md5(id:versiune:xmin)) | text răspuns + registru activ → propunere jsonb | `nou`→`analizat`/`fara_efect` | nu la scriere (jsonb pe set) | Opus/Sonnet; codul validează și numără `aruncate` | amprente fixate | `sursa_pasaj` citat, `document_id`, `disp_id` | K10 | JSON tăiat → `{error}` |
| K10 | Aplicare | bife → „✅ Aplică" | `OL` `aplicaSelectia` L1076 (`dupaDepunere` din status **încărcat în UI**) | `SQL:fn_ofertare_raspuns_set_aplica` (tranzacțional, lock, amprente) | `ofertare_cerinte` (INSERT versiune+1, `inlocuita_de` pe vechi, `acoperire_snapshot`), `ofertare_acoperire` mutată, `ofertare_raspuns_set.rezultat` | op_ids → cerințe noi `confirmata_de NULL, pasaj_verificat=false` | activă → `inlocuita_de`; set → `aplicat`/`aplicat_partial` (= conflicte tehnice, **nu** „omul a sărit") | bife; `depusa` ⇒ motiv (server) | — | **singura** versionare; op-urile nebifate **nu se înregistrează** | `raspuns_set_id`, `sursa_document_id`=doc răspuns; **`raspuns_clarificare_id` niciodată scris** | trigger `fn_pt_invalideaza_la_inlocuire` (legăturile PT rămân pe cerința veche) | idempotency_key; conflict → CONTINUE |
| K11 | „Registru curent" | citire | `OL` L1462 | idiom `inlocuita_de IS NULL AND duplicat_al IS NULL` copiat ≥15 locuri; **6 apelanți omit `duplicat_al`** | — | — | — | — | — | — | — | — | nu există view „registru activ" |
| K13–K16 | Solicitări AC post-depunere | „+ Solicitare", puncte, anexe, „Trimite" | `src/OfertareClarificariAC.jsx` L67-213 | `evalueazaPoartaClarificare` (`src/ofertarePoarta.js` L180-255, **client**) | `ofertare_solicitari_ac(_puncte,_anexe)`; view `v_ofertare_solicitari_ac_stare` | puncte + răspuns text + locator + anexe (sha256 client, `document_date` din `window.prompt`) → `trimisa`/`trimisa_cu_rezerve` | `deschisa` → `trimisa*` (UPDATE direct din client; RLS `auth.uid()` doar) | poartă doar în UI | — | nu | `provenienta` = `retrimis` iff sha256 ∈ pachet `depus` (imposibil azi: 0 pachete) altfel dată manuală vs `COALESCE(depus_la, termen_depunere)` | — | **răspunsul trimis AC nu se generează/stochează/hash-uiește**; `puncte.cerinta_id`, `fisier_path` nefolosite |

### 1.5 Cantități → RFQ → garanție (anexa 05)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | Extragere cantități | **apel manual** (fără buton) | — | `EF/ofertare-cantitati-extrage` (secret / **orice JWT**) | `ofertare_cantitati` upsert `(licitatie_id,denumire,sursa)` `ignoreDuplicates` | text F3/C6/memoriu → rânduri `status='extras'` | — → `extras` | niciuna | OpenAI/Gemini/Anthropic | **fără**; duplicat tăcut / valoare veche păstrată | `sursa` = string „doc — text AI" (nu FK/pagină); `tip_sursa` **NU e setat** | Q02–Q07 | felii sărite nereținute |
| Q02 | Categorie | trigger `fn_trg_categorie_cantitate` (doar `extras_de_ai`) | — | regex din `ofertare_categorii_reguli` | `categorie` | — | — | — | — | — | regula nereținută | F3/fronturi | `tip_sursa` doar backfill migrație 13.09 |
| Q03 | Planșă → `cantitate_plansa` | „📐 citește" | `OL` `citestePlansa` L960 | `EF/ofertare-plansa-citeste treciInCantitati` L150-241 | `ofertare_cantitati` | Dn → UPDATE `cantitate_plansa` / INSERT rând nou `cantitate=cantitate_plansa` | `extras` → `diferenta` (condiționat) | click | Opus | a doua planșă **suprascrie** | `diferenta_nota` text; fără `document_id` | Q05 | ambiguități nepersistate |
| Q04 | Validare manuală | onBlur / toggle | `src/OfertareCantitati.jsx` `saveC` L61, `valideazaC` L70 | PostgREST RLS `auth.uid()` | `ofertare_cantitati` | → `validat` (**fără `validat_de/la`**) | `extras` ⇄ `validat` | singura poartă, opțională; nimic downstream nu o cere | — | nu; `saveC` nu resetează `extras_de_ai` (trigger rescrie categoria) | — | — | `revizuit_clarificare` fără writer |
| Q05 | Contradicții | view | — | `v_ofertare_contradictii` | — | — | — | — | — | — | — | **niciun consumator** | — |
| Q06 | Cantități → fronturi Gantt | „Propune din cantități" | `src/GraficPoarta.jsx` `propuneFronturi` L261 | — | `grafic_parametri.parametri.fronturi[]` | rânduri um='m' rețea → **copie numerică** | — | om alege memoriu/planșă | — | — | fără id de cantitate | G01 | — |
| Q07 | Cantități → H2 | view + `controlCantitati` | `src/ofertareControale.js` L30-54 | `v_ofertare_pt_stare` CTE `qm` (pe `tip_sursa`, **fără status**) | — | F3 vs Σ fronturi (toleranță 0,1 %) | — | — | — | — | — | poartă BLOCK | F3 NULL → block „lipsește F3" |
| R01–R06 | RFQ | manual | `src/OfertareRFQ.jsx` | `EF/ofertare-rfq-import` (Sonnet, rol owner/responsabil), `EF/ofertare-rfq-inbox` (mail extern, `x-inbox-secret`, service_role) | `ofertare_rfq(_materiale,_oferte,_preturi)`; `_destinatari` **nefolosit** | materiale manuale (fără legătură cu cantități); PDF furnizor → prețuri (DELETE+INSERT la re-import → **`ales` pierdut**) | status liber din select; inbox → `oferte_primite` | `ales` fără actor; `trimiteReferinte` → `finalizata` | Sonnet | nu | `oferte.fisier_path` fără hash; referințe doar `note:'din RFQ #id'` | `ofertare_preturi_materiale` | inbox: orice mail cu „RFQ-<id>" intră și pornește citire plătită |
| G01–G05 (garanție) | Poliță participare | UI | `src/OfertareGarantie.jsx` L589-717 | `EF/ofertare-garantie-mail` (**orice JWT**, service_role, Resend → broker) | `ofertare_garantii` | → `cerere_trimisa` (**scris înainte de mail**) → `draft_primit` → `achitata` → `original` | tranziții doar în JSX; RLS ALL | om | — | nu; `anulata` + rând nou | fișiere fără hash; zile = prima regex „NN zile" din cerințe, fallback 90 | KPI verde; **nu intră în pachet** | — |
| P01 (garanție lucrări) | `pt_garantie` | click cerință + save | `OP` `Garantie` L910-970; `salveazaGarantie` L1285 | upsert | `ofertare_pt_garantie` | cerut = regex pe text; oferit tastat → `confirmat_de/la` **la fiecare save** | — | confirmarea e implicită | — | nu | `cerut_cerinta_id` opțional (NULL live); `cerut_text` nescris | `controlGarantie` (BLOCK) | — |

### 1.6 Gantt (anexa 06)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G01 | Parametri | om / „Propune din cantități" | `src/GraficPoarta.jsx` L257-284 | upsert `grafic_parametri` | `grafic_parametri` | fronturi, echipe, durată, iarnă → jsonb | — | om, fără validare server | — | **nu** (suprascris) | `updated_by` | G02, G03, view `grafic_fronturi_m` | — |
| G02 | Checklist poartă grafic | useMemo | L287-314 | pură, **client** | — | → `poarta[]` în memorie | — | buton „Generează" blocat pe `block` (React) | — | persistat doar în `grafic_versiuni.poarta` la G03 | — | `grafic_avertismente` (view) | RLS permite INSERT versiune cu `poarta=[]` (cazul Laza) |
| G03 | Generare + îngheț | „⚙️ Generează grafic" | `genereaza()` L316-348; `motorPEHD` L80-174 (client) | INSERT `grafic_versiuni` → DELETE all → INSERT → UPDATE predecesori rând cu rând (**ne-tranzacțional**) | `grafic_versiuni`, `grafic_activitati` | parametri+norme → activități FS/SS | — | confirm | nu (determinist) | `versiune=max+1` **calculat în browser**; snapshot = activități pre-insert (id temporare, **fără es/ef**), parametri, toate cantitățile, norme, `cerinte_ids`; **fără hash** | `generat_de/la` | G04, G09, G10 | eroare la pasul 3/4 → versiune fără activități |
| G04 | Editor + CPM | pagina `/grafic/licitatie/:id` | `src/GraficLucrare.jsx`; `calcCPM` `src/graficCPM.js` L24-71 (`useMemo`) | per rând insert/update | `grafic_activitati` | → rânduri; **es/ef/float/critic doar în memorie** | `dirty` local | „Salvează" | — | **nu** — salvarea nu creează versiune, nu marchează divergența | fără `updated_by` | G05–G07, G09 (LIVE) | salvare parțială la primul eșec |
| G05–G07 | Export PDF / F9 / MSPDI | butoane | `GraficLucrare.jsx` L123, L148, L230; `exportMSPDI` `GraficPoarta.jsx` L195-223 | client | **niciuna** | working copy (posibil nesalvat) → fișier local | — | — | — | — | **fără hash, fără manifest**; MSPDI: FF/SF exportate ca FS, calendar 7 zile×8h | om | — |
| G08 | Pachet PT ↔ grafic | „Aprobă pachetul" | `OP` L1751 | — | `ofertare_pt_pachet.grafic_versiune` (int, fără FK) | → număr copiat | — | — | — | — | nicio piesă de grafic hash-uită | `controlGraficSursa` | — |
| G09 | Generator PT citește graficul | „Generează capitol" | — | `EF/ofertare-genereaza-capitol` L81: `from('grafic_activitati')` **LIVE** | `grafic_activitati` | ordine/denumire/durată/resurse → prompt | — | rol owner/responsabil | Sonnet | **nu știe versiunea**; nu loghează ce a citit | — | capitol | — |
| G10 | Consum în poartă PT | render | `src/ofertarePoarta.js` L107-145 | `v_ofertare_pt_stare` | — | rând `grafic` **advisory**; H2 `cantitati` **block** (pe `grafic_parametri`, nu pe versiune); `grafic_sursa` block doar dacă manifestul ar avea piesă de grafic (nu are niciodată); `grafic_relatii` block pe conflict | — | — | — | — | — | semnătură `galben` la warn (nu oprește) | — |
| G11 | Import versiune depusă | **fără UI** (SQL) | — | — | `grafic_versiuni` `mod='import'` | — | — | — | — | — | — | poarta o vede; editorul și generatorul **nu** (0 activități) | — |

### 1.7 Propunere tehnică (anexa 07)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P01 | Cuprins | „📋 model" / „➕" | `OP` `creeazaCuprins` L1392, `adaugaCapitol` L1408 | INSERT | `ofertare_pt_capitole` | → capitole `gol`, v1, `sursa='sablon'` | — → `gol` | om | — | v1 | — | P02, P06 | 23505 |
| P02/P03 | Legătură cerință→capitol / exceptare | selecție + buton | `atribuie` L1784 (`sursa:'om'`), `excepta` L1797 | upsert; trigger `fn_pt_legatura_coerenta` (aceeași licitație) | `ofertare_pt_legaturi` | → `atribuita` / `exceptat` (motiv CHECK) | — | om | **nu în cod**; live 270 `sursa='ai'` inserate extern | in-place | `cerinta_id` | P06, view | — |
| P04 | Salvare capitol de om | editor | `salveazaCapitol` L1506 (`continut`, `sursa:'om'`; **nu scrie `stare`**) | trigger `fn_pt_capitol_versioneaza` → `ofertare_pt_capitole_versiuni` + `versiune++` | `ofertare_pt_capitole(_versiuni)` | text → versiune nouă | `sursa` → `om` | om | — | **da** (singura versionare reală din PT); `schimbat_de=auth.uid()` (NULL la service_role: 32/32 live) | — | P08 stale derivat, `pachetDepasit` | last-write-wins (fără condiție de versiune) |
| P06 | Generare capitol AI | „🤖 Generează din cerințe" | `genereazaCapitol` L1522 | `EF/ofertare-genereaza-capitol` (rol owner/responsabil; lacăt; `peste_om` confirm; optimistic lock pe `versiune`) | citește acoperiri, grafic LIVE, garanție, participanți, clarificări `raspunsa`, alte capitole, `pt_afirmatii` (cu **coloane inexistente** L165) | cerințe legate → `continut`, `sursa='ai'` | `versiune++` prin trigger; `stare` neschimbată | poartă `nescrise` BLOCK până salvează un om | Sonnet 5; L156 **„OFERTANT UNIC"** din tabel gol; L150 garanție „iei lunile din cerință" | prin trigger | `ai_usage_log` fără ce a citit | P08 | `max_tokens` → nu scrie |
| P07 | Dovadă pe legătură | „+ dovadă" | `adaugaDovada` L1698-1720 | INSERT | `ofertare_pt_dovezi` | doc + locator text → `document_revizie` (copiat), `pagina_locala` = primul număr din text; **`pagina_globala` niciodată** | `atribuita` → `dovedita` | om | — | nu | fără verificare contra fișierului/paginilor/hash | trigger revizie doc | 0 live |
| P08 | Verificare umană legătură | „✓ verific" | `verificaLegatura` L1665 | UPDATE (CHECK cere confirmat_de/la + `verificat_la_versiunea`) | `ofertare_pt_legaturi` | locator → `verificata` | → `verificata` | om (locator obligatoriu doar UI) | — | stale = **derivat** (`verificat_la_versiunea ≠ k.versiune`) în view/UI/poartă; rândul rămâne `verificata` | `confirmat_de/la` | poartă `neverificate` BLOCK | — |
| P09 | Observații | UI | `adaugaObservatie` L1559, `inchideObservatie` L1576 | INSERT/UPDATE (CHECK închidere) | `ofertare_pt_observatii` | → `deschisa`/`rezolvata` cu `rezolvat_in_versiunea` | — | om | intră în promptul generatorului | — | — | poartă WARN | 0 live |
| P10 | Afirmații / conformitate | — | UPDATE doar | `v_ofertare_pt_conformitate` | `ofertare_pt_afirmatii` | — | — | — | — | — | — | poartă: 0 afirmații ⇒ WARN | **fără INSERT în repo** |
| P11 | Declarații / participanți / anexe așteptate / garanție | UI | L1285-1367 | upsert/insert/delete, `confirmat_de/la` la fiecare save | `ofertare_pt_declaratii/participanti/anexe_asteptate/garantie` | — | — | om | — | nu | `document_sursa/pagina` text liber | controale poartă, generator | 0/0/0/1 live |
| P12 | Poartă PT: evaluare, semnare, aprobare pachet | render / „Semnează" / „Aprobă" | `evalueazaPoarta` `src/ofertarePoarta.js` L21-157; `semneaza` `OP` L1808; `aprobaPachet` L1726 | client; INSERT `ofertare_pt_poarta` (verdict verde/galben, `poarta=[]`, snapshot=view); INSERT pachet cu **`pt_poarta_id: null`** | `v_ofertare_pt_stare`, `ofertare_pt_poarta`, `ofertare_pt_pachet` | vezi F04–F06 | — | click; block doar în client | — | UNIQUE versiune | snapshot = contori view, nu hash-uri | nimic nu consumă verdictul | 0 live |
| P13 | Verificare finală AI | parolă `'Gazpet2026'` **în client** L3952 | `OL` `VerificareFinalaSection` L3939 | `EF/ofertare-verificare-finala` (**orice JWT** sau secret) | `ofertare_cerinte`+`acoperire`+`v_dovezi_stare`; **NU citește PT/legături/poartă** | → `ofertare_verificari{verdict}` fără versiune | — | niciuna server-side | A determinist, B Sonnet 5, C Fable 5.1 | doar `created_at` | — | card: „🟢 VERDE — depunere sigură" (funcția spune „nimic în neregulă în ce am extras") | verdict NULL posibil |
| P14 | Gate depunere DB | UPDATE status | — | `SQL:fn_gate_depunere` | `ofertare_cerinte`, `ofertare_acoperire`, `documente_firma` | — | → `depusa` | vezi F08 | — | — | — | — | ignoră PT/pachet/poartă/verificări |
| P15 | Invalidări | triggere | — | `fn_pt_invalideaza_la_inlocuire` (cerință înlocuită), `fn_pt_invalideaza_la_revizie_document` (revizie doc) | `ofertare_pt_legaturi` → `atribuita` + constatare | — | — | — | — | — | — | — | nimic pentru: capitol modificat, dovadă ștearsă, doc reîncărcat fără schimbare de `revizie` |

### 1.8 Pachet → poartă → semnare → depusă (anexa 08)

| Step_ID | Stage | Trigger | UI/component | Function/API/RPC | Tables/views | Input → Output | Status | Human_gate | AI_action | Versioning | Provenance | Downstream | Failure/retry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F01–F03 | Export DOCX propunere / borderou / F23 / F9 | butoane | `OP` L1641, L1913, L1635; `src/OfertareExport.js` | `docx` client, `<a download>` | **niciuna** | state UI → fișier local; borderou = lista **capitolelor**, „Nr. pag." **gol** (L116, L129) | — | nu (iese și cu capitole goale, marcate roșu) | — | nu | fără hash | om | — |
| F04 | Evaluare poartă | render | `evalueazaPoarta(st)` | pură, client | `v_ofertare_pt_stare` | → `{stare, randuri}` (20 rânduri) | — | — | — | — | — | F05, F06 | — |
| F05 | Aprobare pachet | „🔏 Aprobă pachetul" | `aprobaPachet` L1726-1783 | client, 4 scrieri secvențiale fără RPC: block-check pe **state din memorie** → DOCX propunere+borderou → sha256 (`crypto.subtle` pe blob **înainte** de upload) → INSERT pachet `propus` (`pt_poarta_id: null`) → upload `pt/<lic>/v<n>/` (upsert:false → retry **upsert:true**) → INSERT manifest → UPDATE `aprobat`, `aprobat_de`=**creatorul** | `ofertare_pt_pachet(_fisiere)`, bucket `ofertare` (policy **ALL authenticated**) | → pachet cu **doar 2 fișiere** (`propunere_docx`, `borderou_docx`); `anexa_ref/semnat/sursa_participant/unit_in` **fără writer** | — → `propus` → `aprobat` | confirm + poartă ≠ block (client) | — | `versiune=max+1` din state; `sursa_versiune`=`capitole@{id:vN…}` (un șir global); `grafic_versiune` int fără FK | sha256 pe DOCX generat; **niciodată re-verificat** față de storage | listă pachete, `pachetDepasit` (render), F09 | rollback `DELETE … stare='propus'` **contrazice `REVOKE DELETE`** → rânduri `propus` orfane |
| F06 | Semnare verdict poartă | „📦 Semnează verdictul" | `semneaza` L1810-1838 | recitește view, `evalueazaPoarta`, INSERT `ofertare_pt_poarta{verdict verde|galben, snapshot}`; `poarta` rămâne `[]` | `ofertare_pt_poarta` (RLS **UPDATE/DELETE deschise**) | — | — | click, oricine cu acces | — | UNIQUE versiune | snapshot = view (fără id pachet, fără hash) | **nimeni nu consumă verdictul** (nici `aprobaPachet`, nici `fn_gate_depunere`) | `rosu` nescriibil din UI |
| F07 | Pachet → `depus` | **NOT IMPLEMENTED în UI** | — | doar RLS `aprobat→depus` + CHECK `depus_la` | `ofertare_pt_pachet` | — | — | — | — | — | — | `v_ofertare_solicitari_ac_stare` | — |
| F08 | Licitație → `depusa` | „📮 Marchează Depusă" | `OL` L2987 → `schimbaStatus` L279 (fără rol) | `SQL:fn_gate_depunere`: RAISE dacă cerințe active neconfirmate / fără acoperire `acoperit*` / dovezi doc firmă roșii; **bypass `derogare_depunere`** (fără UI, fără owner-check, RLS orice autentificat) | `ofertare_licitatii`, `ofertare_cerinte`, `ofertare_acoperire`, `documente_firma` | — | `in_lucru` (UI) / **orice** (server) → `depusa` | click | — | fără `depusa_de/la` | **nimic**: nu cere pachet, poartă, verificare, fișier, hash | F09, GBE, raspuns-set | 0 cerințe ⇒ trece |
| F09 | Post-depunere: solicitări AC | view | — | `v_ofertare_solicitari_ac_stare` | — | `depus_la = COALESCE(max(pk.depus_la) stare='depus', termen_depunere)`; `retrimis` iff sha256 ∈ pachet depus | — | — | — | — | — | poartă clarificare (client) | azi 100 % pe `termen_licitatie` |
| F11 | Verificare finală | vezi P13 | | | | | | | | | | **nu e condiție** nicăieri | |
| F12 | „Semnare" fișiere | — | — | `EF/ofertare-fisier-semnat` = **signed URLs**, nu semnătură | — | — | — | — | — | — | — | — | nicio verificare p7s/PAdES în tot modulul |

---

## 2. OBJECT_LIFECYCLES

| Object | where_created | where_updated | how_versioned | how_invalidated | how_confirmed | how_linked_to_source | how_linked_to_final_package |
|---|---|---|---|---|---|---|---|
| **document** (`ofertare_documente_atribuire`) | E0 (`OL` L266), upload (`OL` L755), seap-import edge/Vercel, veghe (răspunsuri + placeholder), `OfertareClarificari.jsx` L229, `api/pdf-sparge.js`, `sursa='drive'` (writer negăsit) | ingest-doc (text/antet/**revizie**/status), document-nou-citeste (`analiza`, `tip`), plansa-citeste, word-text, pdf-sparge, veghe (`aparut_ulterior` pe toate rândurile cu acel nume) | **nu**: `revizie` = text din antet citit de AI, suprascris la reprocesare; republicare SEAP = rând nou cu `seap_meta.inlocuieste`=nume text; rândul vechi neatins; reupload = rând nou nelegat | doar `trg_pt_invalideaza_la_revizie_document` (legături PT cu dovadă pe altă revizie); nimic pentru cerințele extrase din docul înlocuit; fără UI de ștergere | `procesat_de/la`, `citit_de`; niciun „verificat de om" | `seap_cod` (23 rânduri), `nume_original`, `sursa`; **fără hash**; link SEAP nesalvat | `ofertare_pt_dovezi.document_id + document_revizie` → legături → PT (0 dovezi live) |
| **licitație** | `promoveaza` L3370, `salveaza` L259 | `schimbaStatus`, `decide`, `salveaza`, veghe (`termen_depunere`), seap-import (`documentatie_adusa_la`), GBE (`contract_id`) | nu; fără istoric status | `sterge` (owner doar UI) | `decizie_*`; depunere = doar `status` + gate cerințe; fără `depusa_de/la` | `nr_anunt`, `c_notice_id`, `link_seap` | `ofertare_pt_pachet.licitatie_id` (0), `ofertare_verificari` (fără efect) |
| **requirement** (`ofertare_cerinte`) | `core.ts` L294-311 (3 căi de rulare), `fn_ofertare_raspuns_set_aplica` (versiune nouă / `noua`), UI inventar L1833/L1848 (fără doc/pasaj) | `confirma`, `salveazaCorectia` (in-place, nu atinge pasaj), `confirmaTot` (include rânduri ascunse), `setStare`, `desfaRepetarea`, RPC (`inlocuita_de`, `acoperire_snapshot`), `fn_ofertare_clasifica_registre`, `respinge` **DELETE**, `reset` DELETE neconfirmate | doar RPC (`versiune+1`, `inlocuita_de`) — **0 în producție**; re-extragere = DELETE+INSERT; corecție in-place | `inlocuita_de`, `duplicat_al` (fără writer), `stare nu_se_aplica/blocata`, DELETE; **FK `inlocuita_de ON DELETE SET NULL` reactivează vechiul la ștergerea noului** | `confirmata_de/la` (poarta E2, fără dependență de `pasaj_verificat`); `pasaj_verificat` doar la INSERT AI | `sursa_document_id/sectiune/pagina/pasaj` toate nullable (1196/1017/9 NULL live) | `ofertare_pt_legaturi` (rămân pe cerința veche la înlocuire) |
| **clarification request** (`ofertare_clarificari`) | acoperire R9 (fără cheie), generator K02 (cheie), om, PDF extern (direct `trimisa`) | `saveQ` in-place la blur, `clarificare-citeste` (AI scrie `intrebare` dacă placeholder), `leaga` | **deloc** | `retrasa` din select / DELETE | `status='trimisa'` bifat manual; adresa PDF nestocată | `sursa` text, `cheie` (33/41 lipsă); **fără tabel clarificare↔cerințe** | niciuna; `genereaza-capitol` consumă `raspuns` textual |
| **response** (răspuns AC) | doc `raspuns_clarificare` (K05); text `clarificari.raspuns` (AI `raspuns_scurt`/`rezumat`/`text_extras`); `raspuns_set.propunere.dispozitii` | `raspuns` in-place; `citire_noi` suprascris; dispoziții append | nu; **3 reprezentări neconciliate** | ștergere doc → `raspuns_document_id` NULL, `status` rămâne `raspunsa` | `status='raspunsa'` la legare; textul fără „verificat de om" | `raspuns_document_id`; set→doc; **clarificare↔set fără legătură** | nu |
| **resolution** | doar K10: rândul nou `ofertare_cerinte` cu `raspuns_set_id` + `rezultat.aplicate` | editabil in-place ca orice cerință (fără versiune) | `versiune` doar prin RPC | alt set; DELETE (reactivează vechiul) | vine `confirmata_de NULL, pasaj_verificat=false` → `confirmaTot` | `raspuns_set_id`, `sursa_document_id`=doc răspuns; **`raspuns_clarificare_id` mort** | legăturile PT nu se mută (trigger doar invalidează) |
| **evidence** (`ofertare_acoperire`) | motor via `fn_ofertare_acoperire_rescrie`; om `alegeCandidat` INSERT / `foloseste` | `rescrie` UPDATE pe cheie (inclusiv `ales=true` nesemnate), `alegeCandidat` UPDATE in-place pe rândul AI, `verifica`, `confirmaReverificare`, `salveazaRaspuns`, `creeazaTichet`, `fn_ofertare_alege_acoperire`, `reverifica_alese`, `raspuns_set_aplica` (mutare) | in-place; istoric doar prin `fn_ofertare_revizie_noua` (**neapelată**, subset de coloane); `acoperire_snapshot` doar la răspuns AC (0) | rescriere AI (DELETE fără istoric); mutare + `reverificare_ceruta`; expirare (doar autorizații/doc firmă); **nu**: scan înlocuit în HR, versiune nouă `documente_firma`, persoană plecată | 3 semnale independente, niciunul obligatoriu: `verificat_pe_scan`, `ales_de`, `reverificare_ceruta=false`; `ales=true` fără `ales_de` = artefact | FK + `fisier_path` copiat; fără hash/pagină/versiune | F9 ← `mod='personal'` (orice status); organigramă ← `status acoperit*`; poartă PT ← `dovedite` (orice rând `acoperit*`); pachetul nu conține scanurile |
| **evidence PT** (`ofertare_pt_dovezi`) | doar `adaugaDovada` (tip fix `document_atribuire`) | nicăieri | nu | trigger revizie doc (legătura cade, dovada rămâne) | nu (`creat_de` nesetat de UI) | `document_id`, `document_revizie` text copiat, `locator_local`, `pagina_locala` = primul număr din text, `pagina_globala` **niciodată** | nu |
| **person/resource** (`pt_echipa`, `pt_afirmatii`, dotări) | `importaEchipa` (toate acoperirile `mod='personal'`); `pt_afirmatii` **fără INSERT**; dotări = view global | `confirmaDisponibil`, `scoateDinEchipa`; afirmații doar update | nu | view blocaje (expirare la termen, cerință fără rol); **nu**: persoană plecată, acoperire retrogradată, cerință înlocuită, suprapunere altă licitație | `disponibil_confirmat_de/la` opțional, fără dovadă, **necerut downstream** | `employee_id XOR extern_id`; rol fără FK la acoperire | DOCX F9/F23 fără hash, nu în manifest |
| **quantity** (`ofertare_cantitati`) | cantitati-extrage (upsert AI), plansa-citeste (INSERT Dn nou), `addC` manual | `saveC` (orice câmp, orice user), `valideazaC`, plansa-citeste, trigger categorie, backfill `tip_sursa` | **nu**; `ignoreDuplicates` → valoare veche păstrată / dublură | DELETE fizic; `validat→extras` toggle | `validat` fără `validat_de/la`; **nimic nu o cere** | `sursa` string; `tip_sursa` doar backfill; fără FK/pagină | `grafic_parametri.fronturi` copie numerică → `grafic_versiuni` → `pachet.grafic_versiune` int |
| **schedule** (`grafic_activitati`) / **schedule version** (`grafic_versiuni`) | G03 generare (DELETE all + INSERT); editor; SQL manual | editor per rând; versiuni **niciodată** (append-only) | versiune doar la „Generează" (snapshot pre-insert, id temporare, fără es/ef, fără hash); editorul **nu** versionează | înlocuire totală la generare; versiunea „curentă" = `max(versiune)` | niciun câmp; `pachet.grafic_versiune` copiat automat fără verificare activități ≡ versiune | `snapshot.cantitati` copie; `resurse` text liber; fără FK cantități/persoane | `pachet.grafic_versiune` int fără FK; nicio piesă de grafic în manifest |
| **PT chapter** (`ofertare_pt_capitole`) | `creeazaCuprins`, `adaugaCapitol` | `salveazaCapitol` (`continut`, `sursa='om'`), generator (`sursa='ai'`, lock versiune), `blocheazaCapitol`, `capitolResponsabil`; **`stare/stare_motiv/responsabil_id/fisier_path/formular` fără writer** | trigger `fn_pt_capitol_versioneaza` (doar `continut`/`fisier_path`) → `capitole_versiuni` (`schimbat_de` NULL la service_role) | nu se invalidează el; invalidează derivat legăturile și pachetul (`pachetDepasit` la render) | `sursa='om'` la salvare; fără `verificat_de` | `ofertare_pt_legaturi`; `participant_id`; fără legătură capitol→doc/pagină | `pachet_fisiere.sursa_versiune` = `capitole@{id:vN}` (un șir pentru toate); DOCX din state UI |
| **form** (F9/F23/„Formular N") | F9 din echipă; F23 din view; formular = `capitole.eticheta/formular` (nescris) + `pt_garantie.oferit_formular` | — | nu | nu | nu | regex etichetă | DOCX fără hash, nu în manifest |
| **annex** (`pt_anexe_asteptate` + derivate) | `adaugaAnexaAsteptata` (0 live); view `anexe_asteptate/referite` prin regex | DELETE | nu | nu | `confirmat_de/la` la inserare | `document_sursa/pagina` text | `controlPachetComplet` = potrivire **nume/ref** cu manifest |
| **package** (`ofertare_pt_pachet`) | `aprobaPachet` L1750 (client) | L1771 → `aprobat`; `aprobat→depus` **nicăieri** | `versiune` din state; UNIQUE | doar vizual (`pachetDepasit`); niciun trigger pe capitole/grafic | `aprobat_de` = creator (fără 4-eyes); poartă doar client | `grafic_versiune` int, `sursa_versiune` string, `pt_poarta_id` **NULL mereu** | este pachetul; conține doar 2 DOCX generate |
| **package file** (`pt_pachet_fisiere` + bucket) | F05 | niciodată (REVOKE); bucket **ALL authenticated** (bytes înlocuibili) | prin pachet (`v<n>` în cale) | n/a | sha256 client pe blob pre-upload; **nere-verificat**; `semnat` fără writer | `sursa_versiune` global | FK `pachet_id` |
| **gate record** (`ofertare_pt_poarta`) | `semneaza` L1822 | RLS **UPDATE/DELETE deschise** | UNIQUE versiune | niciodată; `pt_verdict` = ultima | `semnat_de` = click; verdict verde/galben (`rosu` nescriibil) | `snapshot` = view; `poarta=[]` | **nu** (`pt_poarta_id` NULL) |
| **signing record** | **NOT IMPLEMENTED** (`pt_pachet_fisiere.semnat` bool fără writer; `ofertare-fisier-semnat` = signed URLs) | — | — | — | — | — | — |
| **submitted artifact** | **NOT IMPLEMENTED** (fără upload ZIP/PDF/recipisă SEAP; `status='depusa'` singura urmă, fără timestamp dedicat) | — | — | — | — | — | — |

---

## 3. HUMAN_GATES

| # | Gate | Unde trăiește | Ce verifică | Impus server-side? | Cine poate trece | Bypass / observație |
|---|---|---|---|---|---|---|
| H1 | Anti-dublură la înregistrare | `OL` L238-248 `confirm` | suprapunere autoritate/obiect | nu | oricine | — |
| H2 | GO / NO-GO owner | `OL` `decide` L289 (`is_owner`) | — | **nu** (RLS orice autentificat; fără trigger) | orice user prin PostgREST | a doua decizie suprascrie fără istoric |
| H3 | Tranziții status (`TRANZITII`) | `OL` L50-57 | harta permisă | **nu** (server: doar gate `depusa`) | oricine cu acces modul | `identificata→castigata` direct prin PostgREST |
| H4 | Poarta pe cost (procesare/extragere/acoperire/clarificări) | `poatePorniProcesarea` `OfertareTriere.jsx` L36; edge `autorizat()` | owner/responsabil | **parțial**: edge da (JWT user); calea reală via coadă: rândul de coadă e scriibil de orice autentificat (RLS) și workerul/tick-ul nu reverifică; `cantitati-extrage`, `plansa-citeste`, `word-text`, `verificare-finala`, `garantie-mail`, `clarificare-citeste`, seap-import/veghe/radar = orice JWT | oricine autentificat | „Participăm → procesează tot" doar schimbă tab-ul |
| H5 | Completitudine înainte de extragere | `OL` L1498 `confirm` „OK = extrag oricum" | probleme din RPC | nu (`v_ofertare_completitudine.blocheaza` necitit) | oricine | — |
| H6 | **E2 — confirmarea cerinței** | `confirma`/`confirmaTot` L1561-1588 | omul spune „rândul e corect" | CHECK doar pe `stare_motiv`; `confirmata_de` fără dependență de `pasaj_verificat` | oricine cu acces modul | `confirmaTot` confirmă și rândurile ascunse (duplicat/înlocuite/alt registru); 16 confirmate cu pasaj neverificat |
| H7 | Alegere dovadă („ales") + „verificat pe scan" | A09/A10 | click | RPC `fn_ofertare_alege_acoperire` nu validează status/valabilitate; CHECK doar `verificat ⇒ fisier_path` | oricine | rând `gol` poate deveni „ales"; `ales=true` fără `ales_de` = 2221 rânduri |
| H8 | Bifare operații răspuns AC + motiv după depunere | K10 | op_ids selectate; `depusa` ⇒ motiv | **da** (RPC sub lock, CHECK pe set) — singura poartă server-side reală din modul | acces modul | op-urile nebifate nu se înregistrează; după `depusa` tot restul mutează silențios |
| H9 | Legare răspuns ↔ întrebare | K07 bife | potrivire | nu | oricine | textul AI intră ca `raspuns` fără editare |
| H10 | „Trimisă" clarificare / solicitare AC | select `OfertareClarificari.jsx` L499; `trimite` `OfertareClarificariAC.jsx` L83 | — / `evalueazaPoartaClarificare` client | nu (RLS `auth.uid()` doar) | oricine | fără dovada depunerii (PDF nestocat) |
| H11 | Validare cantitate | `valideazaC` | — | nu; nimic downstream nu o cere | oricine | 1072/1078 nevalidate intră în F3/Gantt |
| H12 | Disponibilitate confirmată (F9) | `confirmaDisponibil` | — | nu; nu blochează exportul | oricine | butonul spune „autorizația îl face eligibil, nu și liber", nimic nu aplică |
| H13 | Poarta grafic (Generează) | `GraficPoarta.jsx` L314 `blocat` | checklist | **nu** (RLS INSERT versiune cu `poarta=[]` — cazul Laza) | oricine | — |
| H14 | Salvare capitol de om (`nescrise` BLOCK) | poartă PT rând `nescrise` | `sursa≠'om'` | doar în evaluator client | — | `peste_om` confirm la regenerare |
| H15 | Verificare umană legătură (`✓ verific`) | P08 | locator (UI) | CHECK cere `confirmat_*` + `verificat_la_versiunea`; stale doar derivat | oricine cu acces | 270 legături `ai` neconfirmate; `sursa` nu e folosită de poartă |
| H16 | Exceptare cerință (motiv) | P03 | motiv | **da** (CHECK) | — | — |
| H17 | Confirmare garanție lucrări | `salveazaGarantie` | — | nu (ștampilă la orice save) | oricine | confirmare implicită |
| H18 | Poarta PT (block) la aprobare pachet | `aprobaPachet` L1729 | `evalueazaPoarta` pe **state din memorie** | **nu** (INSERT pachet fără trigger/CHECK pe poartă) | oricine cu acces modul; aprobator = creator | pachet `aprobat`/`depus` insertabil direct |
| H19 | Semnătura porții | `semneaza` L1810 | recitire view + evaluator | nu (`pt_poarta` UPDATE/DELETE deschise; verdict neconsumat) | oricine cu acces | poate fi semnată înainte de pachet |
| H20 | Verificare finală AI (parolă) | `'Gazpet2026'` în JS public L3952 | — | nu (funcția acceptă orice JWT) | oricine | verdict afișat „depunere sigură", condiționează nimic |
| H21 | **Gate `depusa`** | `fn_gate_depunere` (trigger) | cerințe active neconfirmate / fără `acoperit*` / doc firmă roșii | **da**, dar trivial cu 0 cerințe (53/54) | click oricine (fără rol UI) | `derogare_depunere` = bypass total, setabil de orice autentificat, fără UI; nu cere pachet/poartă/verificare/fișier |
| H22 | Pachet `depus` | — | — | doar RLS/CHECK | **nu există buton** | NOT IMPLEMENTED |
| H23 | Justificare anexă post-depunere | `justifica` `OfertareClarificariAC.jsx` L174 | text | nu | oricine | data documentului din `window.prompt` |

Gate-uri **reale server-side** în tot modulul: H8 (RPC răspuns-set), H16 (CHECK motiv exceptare), H21 (trigger depunere, trivial în practică), CHECK-urile de motiv pe `stare`/`blocata`/`nu_se_aplica`, CHECK `verificata ⇒ confirmat_*`. Tot restul e client-side.

---

## 4. AI_TOUCHPOINTS

| # | Touchpoint | Model | Citește | Scrie | Ce poate afirma ca „fapt" (fără verificare de cod) | Poartă de rol reală | Verificare a output-ului |
|---|---|---|---|---|---|---|---|
| T1 | Radar scor (`ofertare-radar-scan`) | Haiku 4.5 | anunț SEAP | `radar.scor/motiv/lipsuri/relevant` | relevanță, scor | secret sau orice JWT | niciuna |
| T2 | E0 autofill (`ofertare-e0-autofill`) | — (neinclus în felii) | fișă PDF | câmpuri propuse licitație | „AI propune, omul verifică" (L470) | — | om în formular |
| T3 | Ingest transcriere (`ofertare-ingest-doc`) | Sonnet 5 / Haiku 4.5 | PDF | `text_extras` (cu marcaje AI + `asiguraMarcaje` interval/clamp), **`antet.revizie` → coloana `revizie`** | textul, paginile (clamp „mai bine ±1 decât inventată"), **revizia documentului** (declanșează trigger PT) | `autorizat()` + coadă | niciuna pe text; marcaje renumerotate secvențial |
| T4 | Antet worker (`W/ingest antetDinText`) | Haiku | primele 2 pagini | `antet`, `revizie` | idem | service_role | — |
| T5 | Document nou (`ofertare-document-nou-citeste`) | Sonnet 5 | PDF | `analiza.citire_noi{tip, rezumat, modificari, intrebari_raspunse, termen_nou, data_document}`, **`documente.tip`** | tipul documentului, data, termen nou, „ce întrebări răspunde" | `fn_are_acces_ofertare()` | niciuna; K07 propune `raspuns_scurt` drept răspunsul AC |
| T6 | Clarificare externă (`ofertare-clarificare-citeste`) | Haiku | PDF | `clarificari.citita_rezumat`, **`intrebare`** (dacă placeholder), `sursa` | textul întrebării noastre | **orice JWT** | niciuna |
| T7 | Planșe (`ofertare-plansa-citeste`) | Opus 5 | felii JPEG | `analiza.citire_ai`, **`ofertare_cantitati`** (INSERT/UPDATE, `status='diferenta'`) | tronsoane, lungimi, Dn | **orice JWT** | potrivire Dn regex; nimic pe cifre |
| T8 | Word (`ofertare-word-text`) | — determinist | .docx | `text_extras`, `status='procesat'` forțat | — | orice JWT | — |
| T9 | **Extragere cerințe** (`ofertare-cerinte/core.ts`) | Opus 5 (implicit) / Sonnet 5 (worker corpus) | `text_extras` felii | `ofertare_cerinte` INSERT | **text_cerinta (parafrază ≤200 car)**, `tip` (default `propunere` la lipsă/invalid), `lot` (regex nume fișier, fallback `toate`), `document_probant`, `cand_se_prezinta`, `sursa_pagina` (fallback pagina modelului), `sursa_pasaj` (stocat și negăsit) | `autorizat()`; coada scriibilă de oricine | doar `verificaPasaj` (literal normalizat sau primele 80 car); `pasaj_verificat` invizibil în UI |
| T10 | Inventar independent (`ofertare-inventar-ai`) | Gemini 3.1 Pro / GPT-6 | PDF original | `ofertare_inventar_ai`; om → `ofertare_cerinte` fără doc/pasaj | obligații, pagină | manual | pasaj **neverificat** |
| T11 | Triere (`ofertare-triere` v1.8) | Sonnet 5 | PDF fișă + catalog HR + recomandări | `ofertare_triere.rezultat` | roluri, barem, tip lucrare; codul recalculează matricea/punctaj/risc | fără poartă | cod re-derivă din BD |
| T12 | **Motor acoperire** (`ofertare-acoperire/core.ts`, R1–R20) | Opus 5 | cerințe + catalog 7 surse | `ofertare_acoperire` via `rescrie` (status/candidați/scor/motiv/domeniu_rte), `ofertare_clarificari` (R9/R14) | `status='acoperit'` (stinge alarma eliminatorie în UI și `dovedite` în PT), `domeniu_rte`, R14 „rețele de gaze fără precizare = DISTRIBUȚIE", R10 domeniu principal; cod ridică `gol`→`acoperit` la doar-expirat (R15), scor inventat `90-i*20` | edge: owner/responsabil; **worker: niciuna** | gărzi regex în cod; rescrierea protejează doar `verificat_pe_scan`/`ales_de` |
| T13 | Organigramă spec (`ofertare-organigrama-spec`) | Sonnet 5 | cerințe + ferestre text | `ofertare_organigrama.spec` | roluri cerute, linii, domenii ISC | owner/responsabil în cod | `spec_citate` (doc+offset) |
| T14 | Clarificări propuse (`ofertare-clarificari-propune`) | Sonnet 5 | registru, goluri, diferențe cantități, istoric | `ofertare_clarificari` INSERT direct | întrebările (cu prioritate/risc pierdute ca date) | owner/responsabil (cost) | dedup hash + Jaccard; fără poartă de conținut |
| T15 | Răspuns-set inventar/compară (`ofertare-raspuns-set`) | Opus/Sonnet | text răspuns + registru activ (fără `duplicat_al` filtru? — cu, L340) | `raspuns_set.propunere` jsonb | dispoziții, operații propuse (text nou, tip, cand, lot) | modul | cod validează fel/citat/id; **omul bifează** (H8) |
| T16 | Clarificare-aplica (legacy, deployat) | Sonnet | registru complet | nimic (castrat) | — | **orice JWT** (expune registrul, cost) | — |
| T17 | Cantități (`ofertare-cantitati-extrage`) | OpenAI/Gemini/Anthropic | text liste | `ofertare_cantitati` upsert `status='extras'` | denumire, um, cantitate, sursă textuală | **orice JWT** | niciuna; categoria prin regex trigger |
| T18 | RFQ import (`ofertare-rfq-import`) | Sonnet 5 | PDF furnizor | DELETE+INSERT `rfq_preturi`; suprascrie `oferte.furnizor` | potrivire material↔poziție, preț | owner/responsabil | niciuna; șterge `ales` |
| T19 | **Generator capitol PT** (`ofertare-genereaza-capitol`) | Sonnet 5 | acoperiri, grafic **LIVE**, garanție, participanți, clarificări `raspunsa` (text AI din K07 ca „răspunsul autorității care prevalează"), alte capitole, `pt_afirmatii` (coloane greșite) | `capitole.continut`, `sursa='ai'` (lock versiune) | L156 **„OFERTANT UNIC"** din tabel gol; L150 garanție din textul cerinței; „nu e cazul" permis când „pachetul o confirmă" (absența datelor) | owner/responsabil în cod | doar `[DE COMPLETAT:` count pentru toast; poarta `nescrise` BLOCK până salvează om |
| T20 | Verificare finală (`ofertare-verificare-finala`) | A determinist, B Sonnet 5, C Fable 5.1 | cerințe (220 car) + acoperire + dovezi roșii; **nu PT** | `ofertare_verificari.verdict` | verde/galben/roșu pe registru, nu pe documentul depus | **orice JWT**; parolă în client | UI afișează „depunere sigură" contrar comentariului funcției |
| T21 | Pilot CLI (`worker/claude-cli`, B1, branch) | Sonnet (abonament) | folder NAS (read-only) | **nimic** (fișier pack) | text verbatim + locator; tip/cand/document_probant afirmate | om pornește fiecare rulare | validator fără AI: excerpt literal pe pagină/document; nevalidat → `nereusite` |

Cazuri în care **UNKNOWN devine fapt** prin default de cod/prompt (nu prin model): `tip→'propunere'` (5 locuri + DEFAULT coloană), `lot→'toate'`, `sursa_sectiune` fallback plauzibil, `sursa_pagina` fallback pagina modelului, `cand_se_prezinta NULL` afișat ca „la depunere", `minim=1` proiect în triere, `zile=90` garanție, `scor=90-i*20`, `gol→acoperit` (R15 în cod), registru din verdict AI, `revizie` din antet AI, „ofertant unic" din tabel gol, `garantie_luni_in_capitole` regex → fapt blocant, `cerut_luni/moment` regex.

---

## 5. VERSION_INVALIDATION_MAP

| Obiect | Versionat de | Invalidat de (mecanism real) | Se propagă la | Unde se pierde versiunea |
|---|---|---|---|---|
| Document atribuire | nimic (rând nou la republicare SEAP cu `inlocuieste`=text; `revizie`=text AI) | `trg_pt_invalideaza_la_revizie_document` → legături PT cu dovadă pe altă revizie | doar `ofertare_pt_legaturi` | `revizie`/`antet`/`citire_noi`/`citire_ai` suprascrise la recitire; rândul vechi rămâne `procesat` și eligibil la extragere; fără hash |
| Cerință | `fn_ofertare_raspuns_set_aplica` (`versiune+1`, `inlocuita_de`) — 0 în producție | `trg_pt_invalideaza_la_inlocuire` → legături PT `atribuita` + constatare (rămân pe cerința veche); `acoperire` mutată + `reverificare_ceruta` | legături PT, acoperire (KPI) | `salveazaCorectia` in-place; re-extragere DELETE+INSERT; `respinge` DELETE → **FK SET NULL reactivează vechiul**; RLS permite UPDATE client pe `inlocuita_de/versiune` |
| Clarificare / răspuns | nimic | nimic (ștergere doc → SET NULL, status rămâne) | `genereaza-capitol` (text) | `saveQ` in-place; `raspuns` fără proveniență; 3 reprezentări ale răspunsului |
| Set de răspuns | `amprente` md5(id:versiune:xmin) între analiză și aplicare | conflict de amprentă → `aplicat_partial` | — | op-uri nebifate nepersistate; `idempotency_key` rescris la selecție diferită |
| Acoperire | nimic in-place; `acoperire_snapshot` doar la răspuns AC (0); `fn_ofertare_revizie_noua` neapelată | `rescrie` (DELETE/UPDATE), `reverifica_alese` (expirare), mutare la răspuns | KPI, F9 (nu), organigramă (nu), poartă PT `dovedite` | scan înlocuit în HR / `documente_firma` versiune nouă → rândul păstrează id/cale veche, rămâne „verificat"; alegere manuală suprascrie candidatul AI |
| Echipă F9 / roluri | nimic | view blocaje (expirare la termen) | export F9 (ciornă) | acoperire retrogradată/cerință înlocuită → rol orfan |
| Cantitate | nimic (`ignoreDuplicates`) | DELETE fizic | fronturi (copie), `qm` view | re-extragere păstrează cifra veche; a doua planșă suprascrie `cantitate_plansa`; categorie rescrisă de trigger |
| Parametri grafic | nimic (upsert) | — | H2 (compară parametrii, nu versiunea) | suprascris |
| Grafic (activități) | `grafic_versiuni` doar la „Generează" (snapshot fără es/ef, fără hash) | DELETE all la regenerare | generator PT (LIVE), poartă (versiune) | editorul salvează fără versiune și fără avertisment; generare ne-atomică; id temporare ≠ id reale; start date „azi" la reload |
| Capitol PT | **da**: `fn_pt_capitol_versioneaza` → `capitole_versiuni` (`schimbat_de` NULL la service_role) | derivat: `verificat_la_versiunea ≠ k.versiune` (view/UI/poartă), `pachetDepasit` (render) | legături (stale), pachet (badge) | schimbări de `titlu/sursa/blocat/participant_id/stare` fără versiune; niciun trigger pe pachet |
| Legătură cerință→capitol | nimic (in-place) | 2 triggere (cerință înlocuită, revizie doc) → `atribuita`; capitol modificat → **doar derivat**, rândul rămâne `verificata` | poartă `neverificate` | `sursa='ai'` nefolosită nicăieri |
| Dovadă PT | nimic | indirect (trigger revizie cade legătura) | — | `pagina_globala` nescrisă; fără verificare fișier |
| Garanție lucrări / declarații / participanți / anexe așteptate | nimic (upsert) | — | controale poartă | `confirmat_la` re-ștampilat la fiecare save |
| Verificare finală | nimic (doar `created_at`) | — | card licitație | verdict „ultimul" indiferent de ce s-a schimbat |
| Poartă semnată | UNIQUE versiune | niciodată; RLS UPDATE/DELETE deschise | `pt_verdict` (afișare) | `poarta=[]`; snapshot fără id pachet/hash |
| Pachet | UNIQUE versiune | doar vizual (`pachetDepasit`) | F09 (`depus_la`, `retrimis`) | `pt_poarta_id` NULL; `grafic_versiune` fără FK; bytes din bucket înlocuibili; `sursa_versiune` string global |
| Status licitație | nimic | — | tot | fără istoric, fără `depusa_de/la`, fără legătură la pachet |

---

## 6. FINAL_PACKAGE_FLOW

| Pas | Stare | Ce există | Ce lipsește |
|---|---|---|---|
| 1. Export | EXISTS | DOCX propunere/borderou/F9/F23 generate client din state UI (`OfertareExport.js`) | asamblare anexe, PDF final, paginare reală (`OfertareExport.js:15-19` o declară) |
| 2. Borderou / opis | EXISTS (parțial) | DOCX cu lista **capitolelor**, coloana „Nr. pag." goală | opis al fișierelor din pachet; opis→fișier→pagină |
| 3. Hash | EXISTS (parțial) | SHA-256 client pe blob-ul generat, înainte de upload; CHECK regex | hash pe anexe/F9/F23/ce se depune efectiv; re-hash din storage |
| 4. Storage | EXISTS | bucket `ofertare` `pt/<lic>/v<n>/`, `upsert:false` cu fallback `upsert:true` | write-once (policy = ALL authenticated); verificare obiect ↔ manifest |
| 5. Manifest | EXISTS (parțial) | `ofertare_pt_pachet_fisiere` append-only (rol, nume, mime, size, sha256, path, `sursa_versiune`) | writer pentru `anexa_ref/semnat/sursa_participant/unit_in`; legătură per fișier → capitol/dovadă/grafic |
| 6. Package approval | EXISTS (client) | `propus→aprobat`, `aprobat_de/la`, block-check pe state din memorie | rol aprobator, 4-eyes, cerință de poartă semnată, verificare server-side |
| 7. Gate | EXISTS (client) | `evalueazaPoarta` (20 rânduri, testat) + `ofertare_pt_poarta` snapshot | `pt_poarta_id` pe pachet; persistarea rândurilor (`poarta=[]`); imutabilitate; verdict `rosu`; consum al verdictului |
| 8. Signing record | **NOT IMPLEMENTED** | `semnat` bool fără writer; `ofertare-fisier-semnat` = signed URLs | orice semnătură p7s/PAdES/XAdES pe artefact |
| 9. Pachet `depus` | **NOT IMPLEMENTED în UI** | RLS + CHECK | buton, `depus_la` writer |
| 10. `depusa` (licitație) | EXISTS | buton + `fn_gate_depunere` (cerințe/acoperire/doc firmă) | legătură cu pachet/poartă/hash/artefact; owner pe derogare; UI derogare; timestamp |
| 11. Post-submission | EXISTS | `v_ofertare_solicitari_ac_stare` (`retrimis` via sha256 vs pachet depus) | 100 % fallback pe `termen_depunere` azi |

**Există un pas care recitește artefactul final asamblat și verifică opis → document real → pagină reală?** **NU. NOT IMPLEMENTED.** Cel mai apropiat: `controlPachetComplet` (`src/ofertareControale.js:490+`) compară **nume/ref** din anexe așteptate cu `pachet_fisiere[].nume/anexa_ref` (string matching); `pachetDepasit` compară amprenta `capitole@{id:vN}`; borderoul lasă „Nr. pag." gol. Niciun cod nu deschide DOCX/PDF-ul din storage, nu re-calculează hash-ul, nu numără pagini, nu potrivește opisul cu conținutul.

### Gantt (sub-flux cerut separat)

| Pas | Stare |
|---|---|
| editor | EXISTS client (`GraficLucrare.jsx`), salvare per rând, fără versiune |
| CPM | EXISTS client-only (`graficCPM.js` + duplicat `cpmTotal`); rezultatele nepersistate |
| FS/SS/FF/SF | parser acceptă toate 4; **calcul și export tratează FF/SF ca FS**; doar `verificaRelatii` (control poartă) le implementează corect |
| calendar | **NOT IMPLEMENTED** (zile calendaristice; lună = 30,44 motor / 30 F9 / 7 zile×8h MSPDI; iarnă = rând informativ sau coef 0.7 pe tot lanțul; fără sărbători) |
| resources | text liber (`resurse`), `echipe` int; fără FK persoane/utilaje; fără alocare |
| freeze/version | doar la „Generează" (snapshot fără es/ef, fără hash); editorul nu versionează; append-only RLS |
| export MSPDI | EXISTS (download local, fără hash/manifest; calendar 7×8h) |
| consum generator PT | citește `grafic_activitati` **LIVE**, nu versiunea; nu loghează |
| consum poartă | rând `grafic` advisory; H2 block pe `grafic_parametri` (nu versiune); `grafic_sursa` inert (manifestul n-are piese de grafic); `grafic_relatii` block pe conflict |

---

## 7. BREAK_POINTS

Format per item: **file · function/component · table/view/RPC · line/region · current behavior**. Selecție consolidată (lista completă în anexe: 01 BP01–20, 02 C-1…C-6, 03 C-01…C-25, 04 BP-01…16, 05 BP-Q/R/G/P/X, 06 BP-01…16, 07 BP-01…07, 08 BP-1…9).

### 7.1 Aceeași regulă în mai multe locuri
- `OL` · `TRANZITII` + `schimbaStatus` · `ofertare_licitatii` · L50-57, L279-285 · harta de tranziții doar în UI; serverul nu verifică tranziția (doar gate `depusa`).
- `OL` L614-626 · `EF/ofertare-seap-import` L100-110 · `api/seap-import.js` L36-46 · `ghicesteTip` · 3 regex-uri divergente → același fișier primește `tip` diferit după calea de intrare.
- `EF/seap-import` `cheieNume` L81 · `api/seap-import.js` L150/180 (nume exact) · `OL` `urca` L733 (`nume|size`) · 3 chei de dedup pe documente.
- `SQL:ofertare_doc_de_citit` L450 · `OL` `deCititCaPdf` L879 · `EF/ofertare-ingest-doc` L156-186 · „ce PDF se citește" în 3 copii (comentariu UI L868 o recunoaște).
- `⟦PAGINA n⟧`: `EF/ofertare-ingest-doc asiguraMarcaje` L74-87 (interval/clamp) · `W/ingest` L110 (exact) · `worker/claude-cli/launcher.sh` L56 · `ofertare-word-text` (deloc); `verifica_pack.mjs` L35 nu acceptă interval.
- Lista tipuri doc la extragere: `core.ts` L185 (cu `clarificare`) · `OL` L1523 (**fără**) · `SQL:ofertare_extragere_pasi` L955 · `ofertare_pregatire_extragere` L1317.
- Sufix „bucată": `SQL:ofertare_doc_are_bucati` (` — pN_pag`) vs `ofertare_extragere_pasi` L958 + `OL` L1528 (` — partea`).
- Modelul extragerii: `core.ts` L23 · `ofertare_extragere_coada.model DEFAULT 'claude-opus-5'` · `W/main` L28/77-83 (Sonnet pe corpus).
- „Registru activ" `inlocuita_de IS NULL AND duplicat_al IS NULL`: ≥15 copii; **6 omit `duplicat_al`**: `clarificari-propune/core.ts:67`, `clarificare-aplica:55`, `acoperire/core.ts:105`, `verificare-finala:74`, `genereaza-capitol:248`, `fisier-semnat:52`.
- Valabilitate la termen: 7 implementări, 3 referințe temporale (`core.ts` L324/409; `fn_ofertare_personal_disponibil`; `OL` L2013; `CandidatiAcoperirePanel.valab` L2581; `OfertareCerinte.incarcaRegistru` L182 **azi**, NULL=valabil; `v_ofertare_pt_conformitate`; `fn_ofertare_acoperire_reverifica_alese`); R15 doar în motor.
- Cumul funcții regex: `acoperire/core.ts` L347 · `v_ofertare_pt_conformitate.interzice_cumul` · `OP` L1191 `REGEX_INTERZICE_CUMUL` (= `v_ofertare_pt_stare`) — nu identice.
- Dedup clarificări: `acoperire/core.ts` L555-562 (`sursa` string) · `clarificari-propune/core.ts` L51-55 (SHA-256 `cheie`) + Jaccard 0.75 TS · `OfertareClarificari.jsx` L36-41 (overlap/min 0.34).
- Cantități „conductă/rețea": `v_ofertare_pt_stare` CTE `qm` · `GraficPoarta.jsx` L45-54 · `plansa-citeste eConducta`; „total" în 5 locuri; „luni garanție" în 3 (`RX_LUNI` `OP` L901, CTE `gk`, `garantie_cerinte_lucrari`); UI exclude „participare/bună execuție", view nu.
- Capcane, anexe/formulare, asociere: SQL (`v_ofertare_pt_stare`) + JS (`OP` L172 `RX_CAPCANA`, `ofertareControale.js` L168, L273) — copii manuale „identic caracter cu caracter".
- „Verificată la versiunea curentă": 1 SQL + 3 JS (`OP` L312, L386, L402).
- CPM: `graficCPM.js` L24-71 + `GraficPoarta.jsx` L178-192; luna: 30,44 / 30 / 7×8h; coeficienți 100/0.6/0.7 hard-codate `GraficPoarta.jsx` L82-84.
- Gate de depunere ×3 cu semantici diferite: `fn_gate_depunere` (SQL, blocant, pe `confirmata_de`/acoperire) · `verificare-finala` pasul A (TS, raport) · `v_ofertare_pt_stare` + `evalueazaPoarta` (JS, pe legături) — niciunul nu-l citește pe celălalt (`ofertarePoarta.js:1-13`).

### 7.2 UI spune ceva ce serverul nu impune
- `OL` `decide` L289 · `ofertare_licitatii` · owner-only GO/NO-GO client; RLS `auth.uid() IS NOT NULL` pe ALL.
- `OL` `schimbaStatus` L279 · fără rol, fără confirm; server fără verificare de tranziție.
- `OfertareTriere.jsx` `poatePorniProcesarea` L36 · `OL` `proceseazaPeServer` L697, `propune` L2089 · `ofertare_ingest_coada`, `ofertare_acoperire_coada`, `ofertare_extragere_coada` RLS ALL authenticated · poarta pe cost e client; rândul de coadă deschide poarta anon/worker.
- `OL` `confirma`/`confirmaTot` L1561-1588 · „✓ confirmat" fără `pasaj_verificat`; 16 rânduri live.
- `OfertareCerinte.jsx` L415 · `cand_se_prezinta NULL` afișat identic cu `depunere`.
- `OL` L1668 „🔒 registrul îl generează ownerul" · edge acceptă service_role liber + anon cu coadă.
- `OP` `importaEchipa` L1847 · titlul butonului „autorizația îl face eligibil, nu și liber" (L72) · nimic nu cere `disponibil_confirmat_la`.
- `OfertareGarantie.jsx` L690, L799-820 · tranziții și „PDF obligatoriu la original" doar în JSX; RLS ALL.
- `GraficPoarta.jsx` L314/L374 · butonul blocat pe checklist; RLS INSERT `grafic_versiuni` cu `poarta=[]` (Laza v1).
- `OP` `aprobaPachet` L1729 · block-check pe state din memorie; INSERT pachet fără trigger/CHECK pe poartă; rollback L1777 contrazice `REVOKE DELETE`.
- `OP` `semneaza` L1816 · verdict client; `ofertare_pt_poarta` UPDATE/DELETE deschise.
- `OL` L3952 `'Gazpet2026'` · parola în JS public; `ofertare-verificare-finala` orice JWT; `ofertare_verificari` RLS ALL.
- `OfertareClarificariAC.jsx` L213 `disabled={ev.stare==='block'}` · `trimite` scrie `stare` direct; RLS `auth.uid()` doar; fără CHECK `rezerve` la `trimisa_cu_rezerve`.
- `OL` L2844/L3967 „🟢 VERDE — depunere sigură" vs comentariul funcției L14-18 („nimic în neregulă în ce am extras").
- `GraficPoarta.jsx` L318 confirm „Versiunea veche rămâne în istoric" · editările nu ajung în nicio versiune.

### 7.3 AI transformă UNKNOWN în fapt
- `core.ts` L302 `TIPURI.includes(c.tip) ? c.tip : 'propunere'` (+ `fn_ofertare_raspuns_set_aplica` L274, `inventar-ai` L161, `OL` L1832/1852, DEFAULT coloană).
- `core.ts` L192-193, L303 `lot` din regex nume fișier, fallback `'toate'`.
- `core.ts` L292-298 `sursa_pagina` = pagina afirmată de model când pasajul nu e găsit; L127 pasaj stocat și negăsit.
- `EF/ofertare-ingest-doc` L82-86 clamp pagină; L301 `revizie` = citirea AI a antetului (declanșează trigger PT).
- `EF/ofertare-document-nou-citeste` L109-123 `tip`, `data_document`, `termen_nou` de la model; `clarificare-citeste` L76 `intrebare` scrisă de Haiku.
- `OfertareClarificari.jsx` L261, L267, L468 `raspuns` = `raspuns_scurt` AI / `rezumat` / `text_extras` → `genereaza-capitol` L159 „prevalează asupra cerințelor inițiale".
- `EF/ofertare-acoperire/core.ts` L30 (R14 „fără precizare = DISTRIBUȚIE"), L24 (R10), L419-424 (`gol`→`acoperit` doar-expirat), `candidati.ts` L120 (scor `90-i*20`), L27 (R13 „atestarea CTC e abrogată" ca regulă juridică în prompt).
- `SQL:fn_ofertare_clasifica_registre` L554-559 · registru din `a.status` (AI) + ILIKE nume fișier, marcat `registru_sursa='regula'`.
- `EF/ofertare-genereaza-capitol` L156 „OFERTANT UNIC" din tabel gol; L67 „nu e cazul" permis; L150 garanție din cerință; L165 `pt_afirmatii` cu coloane inexistente (`tip/text/afirmatie/valoare`).
- `EF/ofertare-triere` L150 `minim = 1` fallback; `tip_lucrare_gaze` dedus.
- `OfertareGarantie.jsx` L590-592 zile = prima regex „NN zile", fallback 90.
- `OP` L920 `cerut_luni/cerut_moment` regex; `v_ofertare_pt_stare` `garantie_luni_in_capitole` regex → fapt blocant în `controlGarantie` L81.
- `fn_trg_categorie_cantitate` · categoria din regex, doar pe `extras_de_ai`; `plansa-citeste` L209-224 status `diferenta` + INSERT rânduri.
- Toate consumatorii cantităților (`qm`, `randuriFront`, `clarificari-propune` L69) ignoră `status` → 1072 rânduri `extras` = fapte.

### 7.4 Response, resolution și supersession confundate
- `OfertareClarificari.jsx` L256-274 `leaga` · `ofertare_clarificari.raspuns` · text AI fără proveniență = „răspunsul autorității".
- `EF/ofertare-raspuns-set` L153-159 · set creat fără `clarificare_id`; `ofertare_cerinte.raspuns_clarificare_id` **fără writer** (RPC scrie doar `raspuns_set_id`).
- `SQL:fn_ofertare_raspuns_set_aplica` L305-306 · `aplicat_partial` = conflicte tehnice; op-urile nebifate de om nu se persistă; UI L1363 etichetează toate conflictele „s-au schimbat între analiză și aprobare".
- RPC L184-185, L224 · anularea e și în text (`[ANULATA prin …]`) și în `stare='nu_se_aplica'`.
- `OL` `salveazaCorectia` L1569 · rezoluție in-place fără versiune (inclusiv pe cerința creată prin răspuns).
- FK `ofertare_cerinte_inlocuita_de_fkey ON DELETE SET NULL` + `respinge` L1575 · ștergerea versiunii noi reactivează silențios vechiul.
- `fn_pt_invalideaza_la_inlocuire` · legăturile PT rămân pe cerința veche; cea nouă pornește „fără capitol".
- `ofertare_raspuns_set.data_raspuns` (UI nu trimite), `clarificari.raspuns_la` (nescris), `citire_noi.data_document` (AI) — 3 locuri pentru data răspunsului, niciunul scris de om.
- Post-`depusa` (anexa 04 BP-11): blocat = nimic; cu motiv = doar RPC-ul; silențios = corecții/ștergeri cerințe, status clarificări, acoperire, clarificări noi.

### 7.5 Resursă disponibilă devine implicit alocată
- `OP` `importaEchipa` L1847-1849 · `ofertare_acoperire WHERE mod='personal'` fără `status/ales/ales_de/verificat/valabil` → toți candidații (≤3/cerință) în `ofertare_pt_echipa` + roluri `sursa='acoperire'`.
- `OfertareOrganigrama.jsx` L702-705 · `status IN (acoperit*)` fără `ales` → a doua „echipă", alt filtru.
- `OP` `exportaF9` L1906-1910 · blocat doar de `v_ofertare_pt_echipa_blocaje`; `disponibil_confirmat_la` necerut; `v_ofertare_pt_suprapuneri` informativ.
- `SQL:fn_ofertare_personal_disponibil` · „autorizație valabilă la data X" = disponibil; nicio alocare/perioadă; apelată doar pentru afișare (`OP` L1478).
- `v_ofertare_dotari.propus_f23` · listă globală, fără ITP/expirări (care sunt în `fn_ofertare_echipamente_disponibile`, folosită doar la afișare L1597), fără licitație/perioadă.
- `grafic_activitati.resurse` text liber; `parametri.echipe` int; Gantt-ul nu consultă disponibilitatea.
- `OL` L2158-2183 · `status='acoperit'` AI (nesemnat, neverificat) stinge alarma eliminatorie; `OP` L1258 `dovedite` la fel.
- `SQL:fn_ofertare_alege_acoperire` · nu validează status/valabilitate/scan/licitație.
- `ofertare_acoperire.partener_id` → catalog global, nu `ofertare_pt_participanti` (angajament pe licitație).

### 7.6 Versiunea se pierde
- `EF/ofertare-ingest-doc` L301 `revizie`/`antet` suprascrise; `document-nou-citeste` L113 `citire_noi`; `plansa-citeste` L359 `citire_ai`.
- `EF/ofertare-seap-veghe` L335-365 · înlocuirea = rând nou cu text; vechiul neatins; `upsert:true` fără `cod` suprascrie același obiect.
- `core.ts` L238-240 `reset` DELETE + INSERT; `OL` `salveazaCorectia` in-place; `respinge` DELETE.
- `SQL:fn_ofertare_acoperire_rescrie` L886-932 · UPDATE/DELETE fără istoric; `fn_ofertare_revizie_noua` fără apelant; `istoric` fără `ales/ales_de/verificat/fisier_path/scor/motiv`.
- `OL` `alegeCandidat` L2035 · UPDATE in-place pe candidatul AI (#1 pierdut, scor/motiv AI rămân).
- `ofertare_cantitati` · `ignoreDuplicates` L300; `saveC`; a doua planșă L207-210.
- `EF/ofertare-rfq-import` L119-127 DELETE+INSERT (pierde `ales`).
- `GraficLucrare.jsx` L96-121 salvare fără versiune; `GraficPoarta.jsx` L325-341 generare ne-atomică; L324 `versiune` din browser; L337 id temporare mapate pe `ordine`; L59 start date „azi".
- `fn_pt_capitol_versioneaza` · nu versionează `titlu/sursa/blocat/participant_id/stare`; `schimbat_de` NULL (32/32).
- `ofertare_verificari` · doar `created_at`.
- `OP` L1285-1367 · `pt_garantie/declaratii/participanti/anexe` upsert cu `confirmat_la` re-ștampilat.
- `ofertare_licitatii` · fără istoric status, decizie GO suprascrisă (L290).

### 7.7 Pachetul final nu mai poate fi legat exact de sursele lui
- `OP` L1752 `pt_poarta_id: null` (singurul writer).
- `OP` L1742 `sursa_versiune = capitole@{id:vN,…}` — un șir global pe ambele fișiere, nu per capitol/fișier; DOCX generat din state UI.
- `OP` L1751 `grafic_versiune` int fără FK; nicio piesă de grafic în manifest; generatorul a citit LIVE.
- `ofertare_pt_pachet_fisiere.anexa_ref/semnat/sursa_participant/unit_in` fără writer; anexele/F9/F23/scanurile dovezilor/polița nu sunt în pachet.
- `ofertare_pt_poarta.poarta` rămâne `[]`; `snapshot` = contori, fără hash-uri.
- `ofertare_acoperire` fără `fisier_path`/hash/pagină; `ofertare_pt_dovezi` fără `pagina_globala`, fără verificare fișier; `ofertare_cerinte.sursa_*` nullable; documentele fără hash.
- `ofertare_pt_legaturi` pe cerința veche după înlocuire; `raspuns_clarificare_id` mort.

### 7.8 `working != final != submitted`
- working: `ofertare_pt_capitole` (versionat), `grafic_activitati` (neversionat), `grafic_parametri` (upsert), `ofertare_acoperire` (in-place).
- final: `ofertare_pt_pachet` — invalidare doar la render (`ofertarePachet.js` L68-72 `pachetDepasit`); niciun trigger pe capitole/grafic atinge pachetul; capitolele/graficul pot fi rescrise după `aprobat`; poarta poate fi semnată înainte de pachet; verdictul nu se re-evaluează.
- submitted: **inexistent ca obiect** — `status='depusa'` fără pachet/hash/fișier/timestamp; Domnești depusă de mână = `in_lucru`; 54 finale fără pachet.
- generatorul PT citește graficul LIVE (`genereaza-capitol` L81); `verificare-finala` nu citește PT-ul deloc.
- exporturile Gantt/F9/F23/PDF ies din working copy posibil nesalvat (`GraficLucrare.jsx` L123-231).

### 7.9 Doar existența unui artefact, nu identitatea/hash-ul lui
- `ofertare_documente_atribuire` · fără sha256 (identitate = `fisier_path` cu timestamp + nume + size); veghe `upsert:true`.
- `ofertare_acoperire.fisier_path` copiat (A10); `hr_autorizatii` scan înlocuit → cale orfană „verificată".
- `ofertare_rfq_oferte.fisier_path`, `ofertare_garantii.*_path` fără hash.
- `ofertare_clarificari` · adresa PDF nestocată; răspunsul către AC (solicitări) negenerat/nestocat; `solicitari_ac.fisier_path` nefolosit.
- `ofertare_pt_pachet_fisiere.sha256` · pe blob pre-upload, nere-verificat; bucket ALL authenticated; `semnat` bool fără writer.
- `grafic_versiuni` fără hash; exporturi MSPDI/PDF/F9 fără hash/manifest.
- `ofertare_pt_poarta` · `semnat_de` = click, nu semnătură; nicio verificare p7s/PAdES în modul.

### 7.10 `depusa` fără demonstrarea pachetului depus
- `SQL:fn_gate_depunere` (trigger `trg_gate_depunere BEFORE UPDATE ofertare_licitatii`) · condiție exclusiv `n_neconfirmate>0 OR n_neacoperite>0 OR n_rosii>0` pe cerințe; **nu** apare `ofertare_pt_pachet`, `ofertare_pt_poarta`, `ofertare_pt_capitole`, `ofertare_verificari`, fișier, `decizie_go`, `OLD.status`; cu 0 cerințe trece (53/54 live).
- `derogare_depunere` · `AND NOT COALESCE(NEW.derogare_depunere,false)`; mesaj „doar cu decizia lui Razvan"; fără UI (grep 0), fără owner-check în DB/RLS (= R07 din audit, neremediat).
- `OL` L2987 → `schimbaStatus` L279 · click fără rol; `identificata→depusa` posibil server-side.
- `ofertare_pt_pachet` `aprobat→depus` / `depus_la` · fără writer în UI.
- `v_ofertare_solicitari_ac_stare` · `depus_la` cade pe `termen_depunere` (100 % azi); `retrimis` imposibil.
- `ofertare_verificari.verdict` · afișat, neconsumat.

---

## 8. Răspuns factual: poate sistemul demonstra end-to-end o cerință obligatorie?

Lanțul cerut, verigă cu verigă, pe codul și datele de azi:

| # | Verigă | Ce oferă sistemul | Se ține? |
|---|---|---|---|
| 1 | **source requirement** | `ofertare_cerinte{sursa_document_id, sursa_pagina, sursa_pasaj, pasaj_verificat}` | **Parțial**: pasajul e parafrază + citat verificat doar la INSERT (literal/80 car); 1196 fără pagină, 1017 fără pasaj; documentul-sursă fără hash și fără versiune structurală; corecția umană nu re-verifică pasajul. |
| 2 | **current requirement after clarifications** | `inlocuita_de` + `versiune` prin `fn_ofertare_raspuns_set_aplica`; `raspuns_set_id` | **Se rupe**: 0 rânduri versionate în producție; `raspuns_clarificare_id` mort (nu se poate spune ce clarificare a schimbat cerința); corecțiile reale sunt in-place; răspunsul AC intră ca text AI (`raspuns`) în promptul PT; op-urile sărite nepersistate. Definiția „registru curent" e un idiom copiat, cu 6 apelanți divergenți. |
| 3 | **approved evidence** | `ofertare_acoperire{status, ales, ales_de, verificat_pe_scan, fisier_path}` | **Se rupe**: „aprobat" nu are o definiție unică (3 semnale opționale; `ales` fără `ales_de` pe 2221 rânduri); statusul AI `acoperit` e tratat ca dovadă de UI/poartă; `fisier_path` fără hash/pagină; rescrierea AI șterge fără istoric; nicio legătură între dovada aleasă și dosar. |
| 4 | **PT response** | `ofertare_pt_legaturi{cerinta_id, capitol_id, locator_raspuns}` + `ofertare_pt_capitole` | **Parțial**: legătura există (270 live, toate `sursa='ai'` inserate extern, 0 confirmate); locatorul e text liber; la înlocuirea cerinței legătura rămâne pe versiunea veche. |
| 5 | **verified version** | `pt_legaturi.stare='verificata'` + `verificat_la_versiunea` vs `capitole.versiune`; `capitole_versiuni` | **Parțial**: singura versionare reală din modul (trigger); stale doar derivat; 0 legături verificate live; `schimbat_de` NULL. |
| 6 | **required artifact** | `ofertare_pt_anexe_asteptate`, `pachet_fisiere.anexa_ref` (fără writer) | **Se rupe**: 0 anexe așteptate; anexele/F9/F23/polița/scanurile nu intră în pachet; potrivirea e pe nume. |
| 7 | **final package file** | `ofertare_pt_pachet_fisiere{sha256, sursa_versiune}` | **Se rupe**: 0 pachete în producție; când ar exista: doar 2 DOCX generate din state UI, `sursa_versiune` global, `pt_poarta_id` NULL, bytes înlocuibili în bucket, hash nere-verificat. |
| 8 | **exact page/location** | `pt_dovezi.pagina_globala` (niciodată scrisă), borderou „Nr. pag." gol | **Se rupe**: NOT IMPLEMENTED — nimic nu asamblează, nu paginează, nu recitește. |
| 9 | **submitted artifact** | — | **Se rupe**: NOT IMPLEMENTED — nu există obiect „ce a primit autoritatea"; `status='depusa'` e setat fără pachet, fără hash, fără timestamp, fără rol; Domnești e `in_lucru`. |

**Concluzie factuală**: lanțul se întrerupe prima dată la veriga 2 (registrul „curent" nu e derivabil din date: supersession-ul nu a rulat niciodată, iar modificările reale sunt in-place) și definitiv la veriga 3 (nu există o definiție unică a „dovezii aprobate"). Verigile 7–9 nu au nicio instanță în producție; 8 și 9 nu sunt implementate. Singurele legături cu integritate server-side pe tot lanțul sunt: `fn_ofertare_raspuns_set_aplica` (amprente + lock), `fn_pt_capitol_versioneaza` (istoric capitole), CHECK-urile de motiv/confirmare pe legături și `fn_gate_depunere` (care însă verifică registrul, nu dosarul, și trece trivial cu 0 cerințe).

---

*Anexe (detaliu linie cu linie): 01_licitatie_seap_documente · 02_ingest_cerinte · 03_acoperire_resurse · 04_clarificari_raspunsuri_supersession · 05_cantitati_rfq_garantie · 06_gantt · 07_pt_capitole_verificari · 08_pachet_poarta_depunere.*
