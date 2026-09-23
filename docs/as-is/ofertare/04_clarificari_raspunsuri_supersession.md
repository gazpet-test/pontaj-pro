# 04 — AS-IS: Clarificări → Răspunsuri AC → Supersession cerințe → Solicitări AC post-depunere

Repo `/home/user/pontaj-pro` @ main 55779b5 · Supabase `dxczwkbciseqniprspcu` · citit 23.09.2026. Read-only, fără remediere.

**Stare reală în producție (execute_sql, 23.09):** `ofertare_raspuns_set` = **0 rânduri**; `ofertare_cerinte` cu `inlocuita_de IS NOT NULL` = **0**, `raspuns_set_id IS NOT NULL` = **0**, `raspuns_clarificare_id IS NOT NULL` = **0**, `versiune>1` = **0**. `ofertare_clarificari`: de_trimis 10 · trimisa 27 · raspunsa 2 · retrasa 2; **33 din 41 fără `cheie`** (toate cele dinainte de 22.09 și cele din acoperire R9). Nicio aplicare post-depunere. ⇒ Tot lanțul de supersession (K10–K12) există în cod, dar **nu a rulat niciodată pe date reale**; „registrul după clarificări" e, în practică, registrul inițial + editări in-place (BP-05).

---

## A. PIPELINE (Step_ID K01…)

Câmpuri: Stage · Trigger · UI · Function/API/RPC · Tables/views · Input · Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream_consumer · Failure/retry

### K01 — Clarificare propusă automat din acoperire (R9, legacy încă activ)
- **Stage**: clarification request / create (AI-derived, deterministic)
- **Trigger**: rularea acoperirii (worker/edge `ofertare-acoperire`), la orice felie ce produce `clarProps`
- **UI**: niciun buton dedicat; efect secundar al „Acoperire"
- **Function**: `supabase/functions/ofertare-acoperire/core.ts:550-574`
- **Tables**: INSERT `ofertare_clarificari`
- **Input**: `clarProps` (cerințe RTE fără domeniu / experiență ambiguă)
- **Output**: rânduri `{nr, intrebare, sursa: 'cerința #<id> — de clarificat cu autoritatea (domeniu RTE / experiență)', status:'de_trimis', origine:'platforma'}` — **fără `cheie`**
- **Status**: — → `de_trimis`
- **Human_gate**: nu (scrie direct; omul vede lista)
- **AI_action**: textul întrebării vine din motorul de acoperire (LLM) dar dedup e determinist
- **Versioning**: nu
- **Provenance**: doar `sursa` (text liber, care este și cheie de idempotență): `core.ts:545-547` „`sursa` e si cheia de idempotenta, si textul pe care il vede omul"; dedup pe două chei istorice `sursaPt` / `sursaVeche` (`core.ts:555,560`)
- **Downstream**: K04 (adresa PDF), K02 (contextul „CLARIFICĂRI DEJA EXISTENTE")
- **Failure**: `if (eClar) console.error(...)` — acoperirea nu se invalidează (`core.ts:569-571`)

### K02 — Clarificări propuse de AI (generator „Propune clarificări", 22.09)
- **Stage**: clarification request / create (AI)
- **Trigger**: buton `☁️ Propune clarificări (Sonnet)` → `propuneServer` (`src/OfertareClarificari.jsx:109-123`) → upsert `ofertare_clarificari_coada {activ:true, cerut_de}`; worker NAS `worker/ofertare/clarificari.ts:9-39` consumă coada; alternativ edge `ofertare-clarificari-propune/index.ts`
- **Function**: `propuneClarificari()` `supabase/functions/ofertare-clarificari-propune/core.ts:57-162`
- **Tables**: READ `ofertare_licitatii, ofertare_cerinte (inlocuita_de IS NULL), ofertare_acoperire (status='gol'), ofertare_cantitati, ofertare_verificari, ofertare_documente_atribuire, ofertare_clarificari (aceeași lic + răspunsuri raspunsa de la ALTE licitații)`; WRITE `ofertare_clarificari` (upsert `onConflict:'licitatie_id,cheie', ignoreDuplicates:true`, `core.ts:153`), `ai_usage_log`, `ofertare_clarificari_coada`, `notifications`
- **Input**: prompt system (`core.ts:13-34`) + context JSON (registru trunchiat 220/400 car., goluri, diferențe cantități, inventar docs, clarificări existente, răspunsuri istorice)
- **Output**: rânduri `{nr, intrebare, status:'de_trimis', origine:'platforma', cheie, sursa: '<emoji prioritate>[SOLICITARE DE MODIFICARE][risc divulgare] subiect (cerințe #…) · referință — „fragment" — motiv'}` (`core.ts:145-149`) — **cerinte_ids, prioritate, sursa_tip, interpretari, risc_divulgare se pierd ca date structurate, rămân doar în textul `sursa`**
- **Status**: — → `de_trimis`
- **Human_gate**: poartă pe COST (owner/responsabil) în UI `OfertareClarificari.jsx:111` și în edge `index.ts:10-27`; **nu** poartă pe conținut — rândurile se scriu direct, omul le editează/șterge după
- **AI_action**: generează întrebările; filtre deterministe R1 (`core.ts:128-132`), dedup cheie SHA-256(lic|cerinte_ids sortate|cuvinte(subiect)) `cheieClarificare()` `core.ts:51-55` + Jaccard ≥0.75 pe subiect+întrebare (`core.ts:137`)
- **Versioning**: nu; reluarea nu suprascrie textul editat de om (ignoreDuplicates)
- **Provenance**: `origine='platforma'`, `cheie`; cerințele citate doar în `sursa` (text)
- **Downstream**: K04; `ofertare_clarificari_reminder()` (SQL dump :1094-1137) notifică zilnic pe `status='de_trimis' AND origine='platforma'`
- **Failure**: worker reia max 3× doar pe erori nedeterministe (`clarificari.ts:21-29`); la eroare de salvare returnează propunerile în `rezultat` jsonb al cozii (`core.ts:155`), nu în clarificări

### K03 — Clarificare scrisă de om / încărcată extern
- **Trigger**: `＋ întrebare` (`OfertareClarificari.jsx:124-129`, insert `{intrebare:'', status:'de_trimis'}`) sau `📎 Clarificare externă (PDF)` (`:405-421`, insert `{sursa:'extern', status:'trimisa', fisier_path, origine:'manual', creat_de, intrebare:'(clarificare depusă extern — …)'}`)
- **Tables**: `ofertare_clarificari`, storage `ofertare/<lic>/clarificari/`
- **Status**: — → `de_trimis` (manual) / — → **`trimisa` direct** (PDF extern)
- **Human_gate**: da (omul scrie)
- **Versioning**: nu; `saveQ` (`:98-106`) rescrie in-place `intrebare, sursa, raspuns, raspuns_document_id, status` la fiecare blur
- **Provenance**: `origine:'manual'`, `creat_de`; **fără `cheie`** (K02 nu poate dedupa contra lor decât prin Jaccard)
- **Failure**: toast

### K03b — Citire AI a PDF-ului extern
- **Trigger**: automat după upload (`:420`) sau buton `⚠ necitită — 🤖 citește PDF-ul` (`:443`)
- **Function**: `ofertare-clarificare-citeste/index.ts` (Haiku, PDF base64)
- **Auth**: orice JWT valid SAU `x-radar-secret` (`index.ts:36-42`) — **fără verificare de modul/rol**
- **Writes**: `ofertare_clarificari.{citita_la, citita_rezumat, origine:'manual', intrebare (doar dacă era placeholder), sursa (doar dacă null/'extern')}` (`index.ts:73-78`)
- **AI_action**: rezumat + poate **înlocui `intrebare`** dacă era placeholder — fără confirmare umană
- **Status**: neschimbat

### K04 — Adresa de clarificări + marcare „trimisă"
- **Trigger**: `📄 Generează adresa` → `genereazaAdresa` (`OfertareClarificari.jsx:141-199`): PDF client-side (html2canvas+jsPDF) cu toate `status==='de_trimis' && intrebare.trim()`
- **Tables**: niciuna (PDF descărcat local; **nu se stochează în platformă**, nu există sha256, nu există legătură PDF↔clarificări)
- **Status**: `de_trimis` → `trimisa` **manual**, din `<select>` (`:499-501`), fără dată de trimitere (nu există coloană `trimisa_la`; doar `updated_at`)
- **Human_gate**: depunerea în SEAP e în afara sistemului; toast: „depune și marchează-le «trimisă»"
- **Downstream**: reminder SQL se oprește când status ≠ de_trimis
- **Retragere**: `retrasa` tot din select, fără motiv, fără dată

### K05 — Document de răspuns AC intră în platformă
- **Trigger**: (a) veghea SEAP (import automat, `aparut_ulterior=true`, tip din SEAP) — în afara acestui slice; (b) `📥 Răspuns primit de la autoritate (PDF)` → `urcaRaspuns` (`OfertareClarificari.jsx:222-240`)
- **Tables**: storage `ofertare/<lic>/atribuire/raspunsuri/`, INSERT `ofertare_documente_atribuire {tip:'raspuns_clarificare', sursa:'upload', aparut_ulterior:true, status_procesare:'neprocesat', size_bytes}` — **fără sha256, fără document_date, fără data publicării în SEAP**
- **Status (document)**: — → `neprocesat` (textul `text_extras` vine din pipeline-ul de procesare docs, alt slice)
- **Human_gate**: da (upload)

### K06 — Citire AI a documentului de răspuns (rezumat, nu registru)
- **Trigger**: automat după upload (`:235`) sau `🤖 citește cu AI` (`:333`)
- **Function**: `ofertare-document-nou-citeste/index.ts` (Sonnet, PDF base64); auth `fn_are_acces_ofertare()` sau x-radar-secret (`index.ts:55-68`)
- **Writes**: `ofertare_documente_atribuire.analiza.citire_noi = {tip, rezumat, modificari[], intrebari_raspunse[{intrebare_scurt, raspuns_scurt}], termen_nou, data_document, model, citit_la, citit_de}` + `analiza_la`; și `tip` dacă era `'alta'` (`:117-123`)
- **AI_action**: rezumat/clasificare; **`data_document` e extras de AI, nu introdus de om**, și nu ajunge într-o coloană
- **Versioning**: recitirea suprascrie `citire_noi` (`:113`, „idempotentă")
- **Downstream**: K07 (legare), UI „Documente noi din SEAP"

### K07 — Legarea documentului de întrebările noastre (răspuns → clarificare)
- **Trigger**: `🔗 La ce întrebări răspunde?` → `deschideLegare` (`:244-255`) → `leaga` (`:256-274`); sau select „📎 răspunsul e în documentul" pe rând (`:463-475`)
- **Tables**: UPDATE `ofertare_clarificari {raspuns_document_id, status:'raspunsa', raspuns (doar dacă era gol)}`
- **Input**: bife propuse prin `scorPotrivire` (overlap/min ≥0.34, `:36-41,252`) între `q.intrebare` și `citire_noi.intrebari_raspunse[].intrebare_scurt`; **textul răspunsului propus = `raspuns_scurt` generat de AI, sau `rezumat`-ul întregului document** (`:261,267`)
- **Status**: `trimisa|de_trimis` → `raspunsa`
- **Human_gate**: da (bife + buton), dar textul propus intră ca `raspuns` fără editare obligatorie (toast: „verifică textul răspunsurilor")
- **AI_action**: propune potrivirea și textul răspunsului
- **Versioning**: nu; `raspuns` poate fi apoi editat liber in-place (`:455-456`); `raspuns_la` (date) **nu e setat nicăieri în UI** (există în BD, populat doar legacy — 2 rânduri)
- **Provenance**: `raspuns_document_id` (FK ON DELETE SET NULL)
- **Downstream**: `ofertare-genereaza-capitol/index.ts:85,159` citește `status='raspunsa'` → **„RĂSPUNSURILE AUTORITĂȚII … prevalează asupra cerințelor inițiale"** injectat în promptul de generare capitol; K02 (răspunsuri istorice de la alte licitații)

### K08 — Set de răspuns: creare (document-first)
- **Trigger**: din Clarificări `📋 Analizează impactul în registru` → `onDeschideAnaliza({licitatieId, documentId})` (`OfertareClarificari.jsx:484`) → fișa licitației bifează documentul (`OfertareLicitatii.jsx:1003-1018`) → `🔍 Analizează impactul (n)` → `ruleazaAnaliza` (`:1037-1074`)
- **Function**: `ofertare-raspuns-set` `actiune:'creeaza_set'` (`index.ts:116-175`); auth JWT + `is_owner` sau `user_module_access.module='ofertare'` (`:100-109`) — poartă pe MODUL, nu pe cost/owner
- **Tables**: INSERT `ofertare_raspuns_set {licitatie_id, titlu, lot:null (UI forțează null, :1050), data_raspuns:null (UI nu trimite), creat_de}` (stare default `nou`), `ofertare_raspuns_set_doc`
- **Input**: `document_ids` cu `status_procesare ∈ procesat|partial` și `text_extras ≥ 200` (`:138-143`)
- **Legătură cu clarificarea**: **niciuna** — setul nu știe din ce `ofertare_clarificari.id` a pornit; legătura există doar indirect prin `raspuns_document_id` = document din set
- **Status**: — → `nou`

### K09 — Inventar (faza 1) + Compară (faza 2) — propunerea AI
- **Trigger**: bucle în `ruleazaAnaliza` (`:1057-1069`), un document / rundă, apoi ≤20 dispoziții / rundă
- **Function**: `ofertare-raspuns-set` `inventar` (`index.ts:200-306`), `compara` (`:309-499`); prompturi `prompturi.ts`
- **Tables**: READ `ofertare_documente_atribuire.text_extras`, `ofertare_cerinte (inlocuita_de IS NULL, duplicat_al IS NULL)` filtrate pe lot (`eligibilaPeLot`, `:61-68`); RPC `fn_ofertare_cerinte_amprente` (md5(id:versiune:xmin), SQL dump :66-78); WRITE `ofertare_raspuns_set.{propunere jsonb, propunere_la, model, cost_usd, stare}`
- **Output `propunere`**: `{dispozitii[{disp_id=hash12(doc.id|norm(citat)), tip∈efect_posibil|confirmare|efect_cantitati|neclar|anexa, rezumat, citat, loturi, trimite_la}], documente_citite[], coada_deschisa, acoperire[{doc_id, acoperit_tot}], operatii[{op_id=hash12(set|disp_id|fel|cid|citat), fel∈modifica|anuleaza|noua, cerinta_id, text_nou|text_cerinta, tip, document_probant, cand_se_prezinta, lot, sursa_sectiune:'<titlu set> · solicitarea N', document_id, sursa_pasaj, motiv, incredere, necesita_revizuire, disp_id}], amprente{cid:md5}, dispozitii_comparate[], neclare[], aruncate{motiv:n}, fara_rezultat[], sold}`
- **Status**: `nou` → `analizat` (după orice inventar, `:285`); după compara → `analizat` sau `fara_efect` doar dacă 0 operații ∧ 0 rămase ∧ 0 fără verdict ∧ 0 aruncate (`:469-470`)
- **Human_gate**: nu la scriere (propunerea e jsonb pe set, nu pe cerințe)
- **AI_action**: propune operațiile; codul validează fel/citat/id/text (`:382-416`) și **numără ce aruncă** (`aruncate`)
- **Versioning**: `amprente` fixate la analiză; reluarea adaugă doar disp_id/op_id noi (`:268, :419`)
- **Provenance**: `sursa_pasaj` (citat literal), `document_id`, `disp_id`
- **Failure**: JSON tăiat → `{error, taiat:true}`; costul se loghează înainte de parse (`:238-243`)
- **Blocaj**: `set.stare==='aplicat'` → nu se mai reanalizează (`:210, :319`); `aplicat_partial` **poate** fi reanalizat/reaplicat

### K10 — Aplicare (selecție umană → RPC tranzacțional)
- **Trigger**: bife pe operații (pornesc nebifate, `:1031-1032`) → `✅ Aplică cele n selectate` → `aplicaSelectia` (`OfertareLicitatii.jsx:1076-1095`)
- **Function**: `ofertare-raspuns-set` `aplica` (`index.ts:178-197`) → RPC `fn_ofertare_raspuns_set_aplica(p_set_id, p_op_ids, p_actor, p_dupa_depunere, p_motiv, p_idempotency_key)` (SQL dump :82-318); RPC **fără SECURITY DEFINER** dar apelat cu service_role din edge
- **Input**: `op_ids`, `dupa_depunere = licitatie.status==='depusa'` (**calculat în UI din lista încărcată**, `:1078`), `motiv` (prompt UI), `idempotency_key = '<set_id>-<op_ids sortate>'` (`:1088`)
- **Gate status licitație (RPC :121-131)**: `castigata|pierduta|abandonata` → EXCEPTION; `depusa` → cere `p_dupa_depunere AND motiv`; altfel doar `identificata|analiza|go|in_lucru`
- **Per operație `modifica`/`anuleaza` (RPC :158-252)**: verifică cerința există, e în aceeași lic, `inlocuita_de IS NULL AND duplicat_al IS NULL`, **amprenta recalculată sub lock = `propunere.amprente[cid]`** (:174-182) → altfel `conflicte[]`, CONTINUE; snapshot `ofertare_acoperire` → `cerinte.acoperire_snapshot` pe rândul VECHI (:193-201); **INSERT rând NOU** cu `versiune = vechi+1, raspuns_set_id = set, sursa_document_id = op.document_id (documentul de răspuns), sursa_sectiune = op.sursa_sectiune ?? titlu set, sursa_pasaj = citat, pasaj_verificat=false, extras_de_ai=true, confirmata_de=NULL, nr_ordine = al vechiului`, text = `text_nou` sau `'[ANULATA prin <titlu>] '||text_vechi` cu `stare='nu_se_aplica', stare_motiv='anulata prin …'` (:203-231); UPDATE vechi `inlocuita_de = nou` (:233-237, EXCEPTION 40001 dacă a fost înlocuită paralel); UPDATE `ofertare_acoperire SET cerinta_id = nou, reverificare_ceruta = true, reverificare_motiv=…` (:239-247)
- **Per `noua` (:254-292)**: INSERT `versiune=1, raspuns_set_id, stare='de_analizat', lot = op.lot ?? set.lot, nr_ordine = max+1`; unique_violation pe `ofertare_cerinte_set_text_uniq (raspuns_set_id, md5(btrim(text))) WHERE versiune=1` → conflict „deja introdusa de acest set"
- **Trigger BD**: `trg_pt_invalideaza_la_inlocuire AFTER UPDATE OF inlocuita_de` → `fn_pt_invalideaza_la_inlocuire()`: `UPDATE ofertare_pt_legaturi SET stare='atribuita', verificat_la_versiunea=NULL, constatare = constatare || 'INVALIDATA <data>: cerinta a fost inlocuita prin clarificare (noua: #<id>)' WHERE cerinta_id = OLD.id AND fel='capitol' AND stare IN ('verificata','dovedita','redactata')` — **legăturile rămân pe cerința VECHE** (nu se mută pe `inlocuita_de`)
- **Output**: `rezultat = {set_id, licitatie_id, status_licitatie, modificate, anulate, noi, acoperiri_mutate, aplicate[{op_id, fel, cerinta_veche, cerinta_noua, acoperiri_mutate}], conflicte[{op_id, cerinta_id, motiv, text_curent}]}` scris pe set (:299-314)
- **Status set**: `analizat` → `aplicat` (0 conflicte) / `aplicat_partial` (≥1 conflict); `aplicat_la, aplicat_de, aplicat_dupa_depunere=(status='depusa'), aplicat_motiv, status_licitatie_la_aplicare, idempotency_key`
- **Ce NU se înregistrează**: op_ids **nebifate** (sărite de om) — nu există nicăieri lista „respinse de om"; `p_op_ids` nu se salvează; `aplicate`+`conflicte` acoperă doar ce s-a trimis. `aplicat_partial` = „a avut conflicte", nu „omul a ales o parte"
- **Idempotency**: `rezultat` returnat la același key (:98-103) — dar key-ul e derivat din selecție, deci o a doua selecție diferită pe același set **rescrie** `idempotency_key` și `rezultat` (unique parțial pe key)
- **Human_gate**: da (bife + confirm/motiv la depusa)
- **Failure**: EXCEPTION → tranzacție anulată, edge întoarce `{error}` (:195)

### K11 — Registrul „curent" după clarificări (citire)
- **Query UI** (`OfertareLicitatii.jsx:1462-1466`):
  ```js
  supabase.from('ofertare_cerinte').select(camp)
    .eq('licitatie_id', licitatie.id).is('inlocuita_de', null).is('duplicat_al', null)
    .order('nr_ordine').limit(5000)
  ```
  Aceeași definiție în: `fn_ofertare_cerinte_amprente` (:76-77), `fn_ofertare_revizie_noua` (:621), toate view-urile `v_ofertare_pt_stare*` (migrări 20260913), `ofertare-raspuns-set/compara` (:340), `ofertare-etapa1-mail`, `ofertare-organigrama-spec`. **Excepții** (doar `inlocuita_de IS NULL`, fără `duplicat_al`): `ofertare-clarificari-propune/core.ts:67`, `ofertare-clarificare-aplica:55`, `ofertare-acoperire/core.ts:105`, `ofertare-verificare-finala:74`, `ofertare-genereaza-capitol:248`, `ofertare-fisier-semnat:52`.
- Nu există view/funcție unică „registru activ"; regula e copiată în ≥15 locuri.
- Istoricul unei cerințe = lanțul `id ← inlocuita_de` (fără `inlocuieste`/părinte pe rândul nou; se reconstruiește doar prin `raspuns_set_id` + `rezultat.aplicate[cerinta_veche→cerinta_noua]`); **niciun ecran nu afișează lanțul de versiuni al unei cerințe** (OfertareRevizii.jsx versionează CAPITOLE PT, nu cerințe).

### K12 — Revizii acoperire (snapshot) și diff
- `fn_ofertare_revizie_noua(lic, motiv, document_id)` (SQL :597-635): fotografiază `ofertare_acoperire` pentru cerințele active → `ofertare_acoperire_istoric`; `fn_ofertare_diff_revizii` (:639-682) compară pe `cerinta_id` — o cerință înlocuită apare ca `disparut` + cea nouă ca `nou`, nu ca „schimbat". Nu e apelată automat din K10 (grep: nu apare în raspuns-set).

### K13 — Solicitare AC primită post-depunere
- **Trigger**: `+ Solicitare primită de la AC` → `adaugaSolicitare` (`OfertareClarificariAC.jsx:67-81`), termen din `window.prompt`
- **Tables**: INSERT `ofertare_solicitari_ac {licitatie_id, nr, termen_raspuns}` (stare default `deschisa`); RLS `auth.uid() IS NOT NULL` pe toate cele 3 tabele (**nu `fn_are_acces_ofertare`**)
- **Status**: — → `deschisa`
- **Documentul solicitării**: coloana `fisier_path` există dar **UI nu o completează** (nu se urcă adresa comisiei)

### K14 — Puncte + răspuns + locator
- `adaugaPunct` (`:138-146`) INSERT `ofertare_solicitari_ac_puncte {solicitare_id, nr, intrebare}` (stare default `de_raspuns`); `salveazaPunct` (`:147-150`) UPDATE `{raspuns, stare: raspuns.trim() ? 'raspuns' : 'de_raspuns'}` și `{locator_oferta}` la blur
- Coloana `cerinta_id` există pe punct, **UI nu o setează** (nu se leagă punctul de cerința din registru)
- Fără versionare, fără AI

### K15 — Anexe: sha256 + document_date + proveniență
- `urcaAnexa` (`:158-173`): `sha256 = await sha256Hex(file)` client-side, upload `clarificari-ac/<lic>/<sol>/<punct>/<ts>_<nume>`, INSERT `ofertare_solicitari_ac_anexe {punct_id, nume, fisier_path, sha256, size_bytes, document_date (window.prompt, poate fi gol)}`
- `justifica` (`:174-179`): UPDATE `justificare_post_depunere`
- **Proveniența se calculează în view** `v_ofertare_solicitari_ac_stare` (definiție completă în §C BP-13 / Q5):
  ```sql
  CASE WHEN a.sha256 IS NOT NULL AND EXISTS (SELECT 1 FROM ofertare_pt_pachet_fisiere f JOIN ofertare_pt_pachet pk ON pk.id=f.pachet_id
         WHERE pk.licitatie_id = s_1.licitatie_id AND pk.stare='depus' AND f.sha256 = a.sha256) THEN 'retrimis'
       WHEN a.document_date IS NULL THEN 'fara_data'
       WHEN d_1.depus_la IS NULL THEN 'fara_data'
       WHEN a.document_date <= d_1.depus_la::date THEN 'pre_depunere'
       ELSE 'post_depunere' END AS provenienta
  ```
  `depus_la = COALESCE(max(pk.depus_la) WHERE stare='depus', l.termen_depunere)`, `depus_sursa = 'pachet'|'termen_licitatie'`

### K16 — Poarta + trimitere (cu rezerve)
- `evalueazaPoartaClarificare(st, acum)` (`src/ofertarePoarta.js:180-255`, testată în `ofertarePoartaClarificare.test.js`): block = `puncte==0 || puncte_fara_raspuns>0 || post_depunere nejustificat || termen<0`; warn = locator lipsă, fără dată, depus_sursa=termen_licitatie, termen ≤12h, post-depunere justificat; `poate_cu_rezerve` = block ∧ 0≤ore≤12 ∧ fără block „termen"/„puncte==0"
- `trimite` (`OfertareClarificariAC.jsx:83-97`): UPDATE `ofertare_solicitari_ac {stare:'trimisa'|'trimisa_cu_rezerve', trimisa_la, trimisa_de, rezerve: ev.rezerve.join(' · ')}` — **răspunsul propriu-zis (PDF-ul trimis către AC) nu se generează și nu se stochează**; „trimisă" e o declarație
- **Poarta e doar în UI** (`disabled={ev.stare==='block'}`, `:213`); RLS permite UPDATE direct pe `stare` fără poartă; nu există trigger/CHECK care să impună `rezerve NOT NULL` la `trimisa_cu_rezerve`
- Status: `deschisa` → `trimisa|trimisa_cu_rezerve`; după închidere UI dezactivează editarea (`inchisa`), BD nu

---

## B. OBJECT LIFECYCLES

### B1. Clarification request (`ofertare_clarificari`)
| aspect | as-is |
|---|---|
| where_created | K01 `ofertare-acoperire/core.ts:568` (fără cheie) · K02 `clarificari-propune/core.ts:153` (cu cheie) · K03 `OfertareClarificari.jsx:126` (gol) și `:413` (PDF extern, direct `trimisa`) |
| where_updated | `saveQ` `:100-104` (intrebare, sursa, raspuns, raspuns_document_id, status — in-place, la blur) · K03b `clarificare-citeste:75-78` (citita_*, intrebare dacă placeholder, sursa, origine) · K07 `leaga` `:266-268` (raspuns_document_id, status, raspuns) |
| how_versioned | **deloc**; nu există istoric; `updated_at` singurul semnal |
| how_invalidated | `status='retrasa'` din select (fără motiv/dată) sau DELETE `delQ` `:130-134` (confirm în browser) |
| how_confirmed | implicit: `status='trimisa'` bifat de om = „a plecat"; fără dovada depunerii (PDF-ul adresei nu se stochează, K04) |
| how_linked_to_source | `sursa` text liber (K01: id cerință în text; K02: ids în text); `cantitate_id` FK (pentru cele din diferențe de cantități — în afara slice-ului); **nu există tabel de legătură clarificare↔cerințe** |
| how_linked_to_final_package | niciuna; `ofertare-genereaza-capitol:85` consumă `status='raspunsa'` textual în prompt |
| dedup key | K02: `cheie` = SHA-256(v1\|lic\|cerinte_ids\|cuvinte(subiect)) + UNIQUE `(licitatie_id, cheie)`; K01: `sursa` (string) — două mecanisme diferite pe același tabel; Jaccard ≥0.75 în TS (`asemanare`) fără echivalent SQL |

### B2. Response (răspunsul AC)
| aspect | as-is |
|---|---|
| where_created | (a) document: `ofertare_documente_atribuire` tip `raspuns_clarificare` (K05, veghe sau upload) · (b) text: `ofertare_clarificari.raspuns` (K07 din AI `raspuns_scurt`/`rezumat`, sau textarea `:455`, sau `text_extras` întreg din select `:468-471`) · (c) inventar structurat: `ofertare_raspuns_set.propunere.dispozitii` (K09) |
| where_updated | `raspuns` in-place la blur; `citire_noi` suprascrisă la recitire; `dispozitii` append-only pe set |
| how_versioned | nu; trei reprezentări (text pe clarificare / citire_noi pe document / dispozitii pe set) neconciliate |
| how_invalidated | ștergerea documentului → `raspuns_document_id` SET NULL (FK), `status` rămâne `raspunsa`, `raspuns` rămâne; `ofertare_raspuns_set_doc` FK RESTRICT (documentul nu se poate șterge cât e într-un set) |
| how_confirmed | `status='raspunsa'` pus de om la legare; textul răspunsului nu are câmp „verificat de om" |
| how_linked_to_source | `raspuns_document_id` (clarificare→doc); set→doc via `ofertare_raspuns_set_doc`; **clarificare↔set: fără legătură** |
| how_linked_to_final_package | nu |
| data răspunsului | `ofertare_raspuns_set.data_raspuns` (UI nu o trimite → NULL), `ofertare_clarificari.raspuns_la` (UI nu o setează), `citire_noi.data_document` (AI, în jsonb) — trei locuri, niciunul scris de om în fluxul actual |

### B3. Resolution (ce am decis că e cerința acum)
| aspect | as-is |
|---|---|
| where_created | doar în K10: rândul nou din `ofertare_cerinte` cu `raspuns_set_id` + `sursa_pasaj` (citatul) + `sursa_sectiune='<titlu set> · solicitarea N'`; `propunere.operatii[op_id]` = intenția, `rezultat.aplicate` = execuția |
| where_updated | rândul nou e editabil in-place ca orice cerință: `salveazaCorectia` `OfertareLicitatii.jsx:1566-1571` UPDATE `text_cerinta, tip, document_probant, sursa_sectiune, extras_de_ai=false` **fără versiune nouă**; `setStare` `:1591-1604` |
| how_versioned | `versiune` = vechi+1 numai prin RPC; editarea manuală nu incrementează |
| how_invalidated | o altă aplicare (alt set) îl înlocuiește la rândul lui; DELETE din UI `respinge` `:1572-1577` (FK `inlocuita_de` ON DELETE SET NULL → **cerința veche redevine activă silențios** dacă se șterge cea nouă) |
| how_confirmed | rândul nou vine cu `confirmata_de=NULL, pasaj_verificat=false, extras_de_ai=true` → intră în poarta E2 „confirmă tot" (`confirmaTot` `:1579-1588`, un click pe toate) |
| how_linked_to_source | `raspuns_set_id` → set → docs; `sursa_document_id` = doc răspuns; `raspuns_clarificare_id` **există în schema dar nu e scris de nimeni** (0 rânduri; nici RPC nici UI nu-l populează) |
| how_linked_to_final_package | `ofertare_pt_legaturi` rămân pe cerința veche (trigger le invalidează, nu le mută) |
| nu se înregistrează | operațiile nebifate; motivul omului când sare o operație; cine a bifat (doar `aplicat_de` pe set) |

### B4. Requirement version (`ofertare_cerinte.versiune` / `inlocuita_de`)
| aspect | as-is |
|---|---|
| where_created | RPC `fn_ofertare_raspuns_set_aplica` (:203-231 modifica/anuleaza; :263-281 noua v1) — singurul producător de `versiune>1` și `inlocuita_de` |
| where_updated | `inlocuita_de` UPDATE (:233) o singură dată (guard `AND inlocuita_de IS NULL`) |
| how_versioned | copie rând (nu istoric separat): vechiul rămâne cu `inlocuita_de`, `acoperire_snapshot` jsonb; noul are `nr_ordine` identic |
| how_invalidated | vechi: `inlocuita_de IS NOT NULL` → exclus din toate query-urile „active"; **FK ON DELETE SET NULL** = ștergerea noului reactivează vechiul |
| how_confirmed | amprenta `md5(id:versiune:xmin)` la analiză vs aplicare — protejează contra editărilor între analiză și aprobare; după aplicare, rândul nou nu are amprentă/ștampilă |
| how_linked_to_source | `raspuns_set_id`, `sursa_document_id`, `sursa_pasaj`; **fără pointer înapoi** (nou → vechi) altfel decât căutând `WHERE inlocuita_de = nou.id` |
| how_linked_to_final_package | `ofertare_pt_legaturi.verificat_la_versiunea` se referă la versiunea CAPITOLULUI, nu a cerinței; trigger `fn_pt_invalideaza_la_inlocuire` pune legăturile vechi în `atribuita` cu constatare text |
| în producție | 0 rânduri versionate (nu s-a aplicat niciodată) |

---

## C. BREAK_POINTS

### BP-01 — Răspuns AC ≠ rezoluție ≠ supersession: textul AI devine „răspunsul autorității"
- `src/OfertareClarificari.jsx:261,267`:
  ```js
  const rezumat = (d?.analiza?.citire_noi?.rezumat || '').trim()
  …
  if (!(q.raspuns || '').trim()) patch.raspuns = (legare.propuneri[id] || rezumat || '').slice(0, 20000) || null
  ```
  `legare.propuneri[id]` = `intrebari_raspunse[].raspuns_scurt` (Sonnet, K06). Câmpul `raspuns` (citit apoi de `ofertare-genereaza-capitol:159` ca „RĂSPUNSURILE AUTORITĂȚII … prevalează asupra cerințelor inițiale") conține un rezumat AI, nu textul autorității; fără marcaj de proveniență pe `raspuns`.
- Și `:468-471`: select-ul de document pune **tot `text_extras`** (până la 20.000 car.) în `raspuns` cu toast „taie ce nu ține de întrebarea asta".

### BP-02 — Legare clarificare↔document prin scor lexical, prag 0.34, cu formulă diferită de K02
- `OfertareClarificari.jsx:36-41` overlap/min (`comune / Math.min(A.size, B.size)`) — exact coeficientul pe care `clarificari-propune/core.ts:41` îl abandonează („dădea 1 la orice subset") în favoarea Jaccard. Două normalizări (`cuvinte`) diferite, două praguri (0.34 vs 0.75), două fișiere.

### BP-03 — Setul de răspuns nu știe de clarificare; clarificarea nu știe de set
- `ofertare-raspuns-set/index.ts:153-159` INSERT set fără `clarificare_id`; `OfertareLicitatii.jsx:1044-1051` trimite doar `document_ids`. Singura punte: `ofertare_clarificari.raspuns_document_id` = un doc din `ofertare_raspuns_set_doc`. Coloana `ofertare_cerinte.raspuns_clarificare_id` **nu e scrisă de nimeni** (RPC scrie doar `raspuns_set_id`; grep în `src/` și `supabase/functions/`: 0 scrieri). ⇒ „ce cerințe a schimbat clarificarea nr. 5" nu se poate răspunde.

### BP-04 — `aplicat_partial` conflată: conflict tehnic vs selecție umană; operațiile sărite nu se înregistrează
- RPC :305-306: `stare = CASE WHEN jsonb_array_length(v_conflicte) > 0 THEN 'aplicat_partial' ELSE 'aplicat' END`. Dacă omul bifează 3 din 10 și toate 3 trec → `aplicat` (setul apare „aplicat integral"); `p_op_ids` nu se persistă; `rezultat.aplicate` are doar ce a fost trimis. Nu există `respinse_de_om`.
- UI `OfertareLicitatii.jsx:1363` etichetează TOATE conflictele „s-au schimbat între analiză și aprobare", deși motivele includ „operatia de modificare nu are text nou", „cerinta noua fara text", „fel necunoscut" (RPC :187-190, :255-257, :293-295).

### BP-05 — Versiune pierdută: editare in-place a cerinței (inclusiv a celei create prin răspuns)
- `OfertareLicitatii.jsx:1569`:
  ```js
  await supabase.from('ofertare_cerinte').update({ ...nou, confirmata_de: profile.id, confirmata_la: …, extras_de_ai: false, updated_at: … }).eq('id', c.id)
  ```
  `nou = {sursa_sectiune, text_cerinta, tip, document_probant}` — fără `versiune+1`, fără rând vechi. Singurul urmaș: `ofertare_ai_feedback` (`feedback(c,'corectat',nou)` `:1553-1558`) cu `output_ai`/`output_corectat`. Amprenta (`xmin`) se schimbă → o propunere de set în curs devine conflict (bine), dar istoricul textului nu există. RLS `ofertare_cerinte_update = fn_are_acces_ofertare()` permite UPDATE pe orice coloană, inclusiv `inlocuita_de`, `versiune`, `raspuns_set_id`, din client.

### BP-06 — Ștergerea cerinței noi reactivează silențios cerința veche
- FK `ofertare_cerinte_inlocuita_de_fkey … ON DELETE SET NULL` + `respinge` `OfertareLicitatii.jsx:1575` `delete().eq('id', c.id)` (confirm browser). Vechiul rând revine în `inlocuita_de IS NULL` cu `acoperire_snapshot` populat dar `ofertare_acoperire` mutate pe rândul șters (FK acoperire→cerinta: cascade/set null în alt slice) ⇒ cerință activă fără acoperire, fără urmă a răspunsului.

### BP-07 — AI UNKNOWN → fact: `data_document`, `termen_nou`, `tip` scrise de AI
- `ofertare-document-nou-citeste/index.ts:109-110,120-123`: `data_document`/`termen_nou` extrase de model; `tip` BD schimbat din `'alta'` în `raspuns_clarificare|erata` fără om. `data_document` nu ajunge în coloană, dar în K15 pentru anexe omul o introduce manual — două regimuri pentru aceeași noțiune.
- `ofertare-clarificare-citeste/index.ts:76`: `if (placeholder && j.intrebare) upd.intrebare = …` — textul întrebării noastre (cel care va fi arătat AI-ului K02 ca „deja întrebat") e scris de Haiku. Auth: orice JWT (`:36-42`), fără poartă de modul.

### BP-08 — Amprenta protejează doar între analiză și aplicare; cerințele „noua" n-au amprentă și pot fi duplicate între seturi
- `fn_ofertare_cerinte_amprente` = `md5(id:versiune:xmin)` (:72); unique `ofertare_cerinte_set_text_uniq (raspuns_set_id, md5(text)) WHERE versiune=1` — dedup doar **în același set**. Două seturi pe același document (UI creează set nou la fiecare `ruleazaAnaliza`, `:1044`; nu reutilizează seturi `analizat`) → aceeași cerință nouă de două ori. Compara marchează ⟲ doar cerințe cu `sursa_document_id` din set (`index.ts:347-350`), deci a doua rulare le vede ca existente (ok), dar `noua` din primul set aplicat ≠ blocată în al doilea dacă modelul reformulează.

### BP-09 — Regulă duplicată: „registru activ"
- `is('inlocuita_de', null).is('duplicat_al', null)` în UI/RPC/view-uri vs doar `is('inlocuita_de', null)` în `clarificari-propune/core.ts:67`, `acoperire/core.ts:105`, `verificare-finala:74`, `genereaza-capitol:248`, `fisier-semnat:52`, `clarificare-aplica:55`. Efect: generatorul de clarificări (K02) vede și duplicatele → poate propune o clarificare citând un id marcat `duplicat_al`, iar dedup-ul pe `cerinte_ids` diferă de ce vede omul în registru.

### BP-10 — Regulă duplicată: status maps și gate „depusa"
- Statusuri clarificare: CHECK BD `de_trimis|trimisa|raspunsa|retrasa` ↔ `CLAR_STATUS` `OfertareClarificari.jsx:25-30` ↔ `candidateLegare` `:242` (`trimisa|de_trimis`) ↔ reminder SQL (`de_trimis AND origine='platforma'`). Tranziția e liberă în select (`raspunsa`→`de_trimis` permis).
- Gate depunere: UI `dupaDepunere = licitatie.status === 'depusa'` (`:1078`, din obiectul încărcat la deschiderea fișei) ↔ RPC recitește status sub lock (:113). Dacă UI vede `in_lucru` dar BD e `depusa` → RPC ridică EXCEPTION „cere confirmare explicita si motiv" — corect, dar mesajul ajunge ca eroare generică `aplicare (tranzactie anulata…)`. Invers, RPC acceptă `identificata|analiza|go|in_lucru` — lista whitelist e hardcodată în SQL, `STATUS` map în UI (`OfertareLicitatii.jsx:54`) separat.

### BP-11 — După `depusa`: ce e blocat / permis cu motiv / mută silențios
- **Blocat**: nimic în afara RPC-ului K10 (care cere `dupa_depunere+motiv` la `depusa` și refuză la `castigata|pierduta|abandonata`).
- **Permis cu motiv**: doar aplicarea setului; `aplicat_dupa_depunere` + CHECK `ofertare_raspuns_set_dupa_depunere_chk` (motiv nenul).
- **Mută silențios (fără motiv, fără gate, RLS = acces modul)**: `salveazaCorectia` (text/tip cerință), `setStare`/`setStareSelectate` (`nu_se_aplica` cu motiv, dar `rezolvata`/`in_lucru` fără), `respinge` (DELETE cerință), `confirmaTot`, `desfaRepetarea`, `saveQ` pe clarificări (status/raspuns), `leaga`, upload/citire documente, `ofertare-acoperire` (rescrie acoperiri + inserează clarificări K01), `ofertare-clarificari-propune` (inserează clarificări). Niciun cod din slice nu citește `licitatie.status` în afară de `:1078`. Clarificări „către AC" rămân editabile după depunere deși legal nu mai există fereastră.

### BP-12 — Aplicarea nu face revizie de acoperire și nu mută legăturile PT
- RPC nu apelează `fn_ofertare_revizie_noua`; `fn_ofertare_diff_revizii` compară pe `cerinta_id` → o înlocuire apare ca `disparut`+`nou`. Trigger `fn_pt_invalideaza_la_inlocuire` lasă `ofertare_pt_legaturi.cerinta_id` pe rândul vechi (inactiv) — cerința nouă pornește fără legături; `v_ofertare_pt_stare*` (filtru activ) o va raporta „fără capitol" iar legătura veche invalidată devine invizibilă.

### BP-13 — Solicitări AC: „anexa e fișierul depus" se dovedește prin sha256 doar contra pachetului ERP; poarta e client-side
- View (Q5): `'retrimis'` ⇔ `EXISTS (… ofertare_pt_pachet_fisiere f JOIN ofertare_pt_pachet pk … pk.stare='depus' AND f.sha256 = a.sha256)`. Dacă oferta n-a fost depusă din ERP (`depus_sursa='termen_licitatie'`, `depus_la = l.termen_depunere`), orice anexă cu dată ≤ termen e `pre_depunere` pe baza unei date **introduse manual în `window.prompt`** (`OfertareClarificariAC.jsx:160`), nu extrase din act; `fara_data` = warn, nu block.
- `trimite` (`:90-91`) scrie `stare` direct din client; RLS `auth.uid() IS NOT NULL` (roles `{public}`), fără `fn_are_acces_ofertare`, fără trigger care să reevalueze poarta sau să ceară `rezerve` la `trimisa_cu_rezerve`. Răspunsul trimis (PDF) nu există în platformă: `fisier_path` pe solicitare nefolosit, nu se generează adresa de răspuns, nu se hash-uiește ce a plecat.
- `ofertare_solicitari_ac_puncte.cerinta_id` niciodată setat → punctul comisiei nu se leagă de cerința/versiunea din registru.

### BP-14 — Cheia de dedup: două scheme pe același tabel + Jaccard doar în TS
- K01 `sursa` string (`acoperire/core.ts:555-562`, cu cheie „veche" păstrată pentru compatibilitate) vs K02 `cheie` hash + UNIQUE index. 33/41 rânduri fără `cheie`. K02 dedup contra K01/K03 doar prin Jaccard ≥0.75 în memorie (`core.ts:137`) — nereproductibil în SQL, nedeterminist la editarea textului. Cheia K02 depinde de `cerinte_ids` ⇒ după re-extragerea registrului (id-uri noi) aceleași întrebări se propun din nou (recunoscut în comentariu `core.ts:50`).

### BP-15 — `ofertare-clarificare-aplica` rămâne publicat, cu poartă = orice JWT
- `index.ts:36-43`: JWT user oarecare sau x-radar-secret; nu mai scrie (`:92-98`), dar consumă Sonnet (cost) și expune registrul complet al oricărei licitații oricui autentificat. UI nu-l mai cheamă (`OfertareClarificari.jsx:63-66`).

### BP-16 — `aplicat_partial` reanalizabil, `aplicat` nu; `anulat` fără producător
- `index.ts:210,319` blochează doar `aplicat`. Stare `anulat` din CHECK nu e scrisă de niciun cod (grep). `fara_efect` e concluzie server-side (`:469-470`) dar UI o recalculează independent (`analizaIncompleta`, `OfertareLicitatii.jsx:1261-1262`).

---

## Răspunsuri la întrebările cheie

**Q1 — unde stau response / resolution / supersession și unde se confundă.**
Response: `ofertare_documente_atribuire` (fișier + `analiza.citire_noi` AI) · `ofertare_clarificari.raspuns` (text, adesea AI, BP-01) · `ofertare_raspuns_set.propunere.dispozitii` (inventar AI cu citat literal). Resolution: nu are obiect propriu; e rândul nou din `ofertare_cerinte` (`raspuns_set_id`, `sursa_pasaj`) + `rezultat.aplicate`. Supersession: `ofertare_cerinte.inlocuita_de` + `versiune`, scris doar de RPC. Conflări: (i) `raspuns` = rezumat AI fără proveniență (BP-01); (ii) `inlocuita_de` setat **fără** `raspuns_clarificare_id` — mereu (coloana e moartă, BP-03); (iii) `aplicat_partial` ≠ „omul a sărit operații" — nu se înregistrează ce s-a sărit (BP-04); (iv) editare in-place a cerinței = rezoluție fără versiune (BP-05); (v) `stare='nu_se_aplica'` + prefix text `[ANULATA prin …]` = anularea e și în text și în stare (RPC :184-185, :224).

**Q2 — poate AI schimba text/tip/stare fără selecție umană?**
Pe `ofertare_cerinte`: **nu** — singurul scriitor AI-derivat e RPC-ul cu `p_op_ids` bifate de om; `ofertare-clarificare-aplica` a fost castrat (:92-98). Excepții adiacente: `ofertare-document-nou-citeste:120-123` schimbă `ofertare_documente_atribuire.tip`; `ofertare-clarificare-citeste:76-77` scrie `ofertare_clarificari.intrebare/sursa`; K07 scrie `ofertare_clarificari.raspuns` cu text AI după o bifă (nu editare). Riscul real e indirect: `genereaza-capitol` consumă `raspuns` AI ca „răspunsul autorității care prevalează".

**Q3 — definiție unică a registrului curent?** Da, ca idiom, nu ca obiect: `licitatie_id = ? AND inlocuita_de IS NULL AND duplicat_al IS NULL` (query UI la K11), copiat în ≥15 locuri, cu 6 apelanți care omit `duplicat_al` (BP-09). Nicio view/funcție `v_ofertare_cerinte_active`.

**Q4 — după `depusa`.** Blocat: nimic. Cu motiv: doar `fn_ofertare_raspuns_set_aplica` (`p_dupa_depunere` + `p_motiv`, CHECK pe set). Silențios: tot restul (BP-11).

**Q5 — dovada „anexa = fișierul depus".** Doar prin egalitate `sha256` cu `ofertare_pt_pachet_fisiere` din pachetul `stare='depus'` (view citat la K15/BP-13). Fără pachet ERP, dovada cade pe `document_date` introdus manual + `termen_depunere`. Ce s-a trimis efectiv către AC nu e hash-uit.
