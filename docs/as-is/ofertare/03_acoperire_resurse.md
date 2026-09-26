# AS-IS 03 — Cerințe → Acoperire/Dovezi → Revizii → Personal/Resurse (Ofertare)

Repo `pontaj-pro` @ main 55779b5 (23.09.2026). Surse: `supabase/functions/ofertare-acoperire/{core,index,candidati}.ts`, `worker/ofertare/{acoperire,main}.ts`, `supabase/functions/ofertare-organigrama-spec/index.ts`, `src/OfertareLicitatii.jsx`, `src/OfertareCerinte.jsx`, `src/OfertarePropunere.jsx`, `src/OfertareOrganigrama.jsx`, `src/ofertareOrdine.js`, DB (funcții + view-uri + CHECK-uri + statistici live din `dxczwkbciseqniprspcu`).

Cifre live (23.09.2026): `ofertare_acoperire` = 2707 rânduri; `ales=true` = 2234 (din care `ales_de IS NOT NULL` = **6**); `verificat_pe_scan` = 8; `fisier_path` = 8; `pozitie_id` ≠ NULL = **0**; `ofertare_acoperire_revizii` = 2 / `istoric` = 1075; `ofertare_cerinte.acoperire_snapshot` ≠ NULL = **0**; `ofertare_pt_echipa` = **0**, `roluri` = 0; `ofertare_pt_afirmatii` = **0**; `status='acoperit' AND valabil_la_depunere=false` = 3. Combinații status/mod prezente: `acoperit/gol` (!), `in_lucru/partener`, `in_lucru/recomandare` — stări moștenite, neproduse de codul actual.

Vocabular: *catalog* = tot ce poate dovedi ceva (hr_autorizatii, documente_firma, ofertare_parteneri, ofertare_experienta, hr_recomandari, hr_documente_personale studii/vechime); *acoperire* = rândul din `ofertare_acoperire` care leagă o cerință de un element din catalog; *ales* = varianta care „merge în dosar"; *ales_de* = semnătura omului; *verificat_pe_scan* = om a deschis scanul.

---

## (A) PIPELINE

Coloane: Step_ID · Stage · Trigger · UI/component · Function/API/RPC · Tables/views · Input · Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream_consumer · Failure/retry.

### A01 — Pornire „Propune acoperiri" (coadă)
- **Trigger**: click buton în secțiunea „Acoperirea cerințelor (E3)".
- **UI**: `src/OfertareLicitatii.jsx` → `AcoperireSection.propune()` L2086-2106.
- **API**: `supabase.from('ofertare_acoperire_coada').upsert({licitatie_id, activ:true, cerut_de, cerut_la, terminat_la:null, nota:null, stare:null, jurnal:[]}, {onConflict:'licitatie_id'})` L2089-2092. Nicio verificare de rol în UI (poarta „pe cheltuială" e aplicată doar când se apelează edge function-ul direct — vezi A03; workerul NAS consumă coada cu service_role, deci **oricine cu RLS-write pe `ofertare_acoperire_coada` pornește o rulare plătită**).
- **Tables**: `ofertare_acoperire_coada` (licitatie_id, activ, batchuri, cerinte_ids, cerut_de, stare, jurnal, nota).
- **Input**: licitatie_id. **Output**: rând de coadă activ. Apoi UI face polling 5 s × 720 (=1 h) pe `activ/stare/nota/ultimul_tick` L2096-2104.
- **Status**: n/a (cerințe rămân cum erau).
- **Human_gate**: click, fără confirmare de cost.
- **Failure**: dacă workerul NAS e mort, UI arată „⚠️ workerul NAS nu a mai scris de N min" (L2103); **nu există fallback** — `ofertare_ingest_tick`/`ofertare_extragere_tick` au fallback pg_cron când heartbeat-ul lipsește, dar pentru acoperire nu există niciun `ofertare_acoperire_tick` (verificat: `cron.job` conține doar ingest/extragere/radar/veghe/alerte; `pg_proc` nu are `ofertare_acoperire_tick`). Rândul din coadă rămâne `activ=true` la nesfârșit.

### A02 — Worker NAS: orchestrare felii
- **Trigger**: `worker/ofertare/main.ts` L158-167: la fiecare buclă, dacă `!acoperireInLucru`, ia primul rând `activ=true ORDER BY cerut_la` și cheamă `proceseazaAcoperire()`.
- **Function**: `worker/ofertare/acoperire.ts` → `proceseazaAcoperire(supabase, licId, esteOprire, stare)` L217-299; `felie()` L185-215.
- **Tables**: citește `ofertare_cerinte (id, tip) WHERE licitatie_id AND inlocuita_de IS NULL` (L227; **nu filtrează `duplicat_al`** — cerințele marcate duplicat intră în felii; contrast cu `ofertare_acoperire_pasi` care nici el nu filtrează duplicat_al, și cu `AcoperireSection.load` care le exclude); opțional `cerinte_ids` (reluare pe listă), `batchuri` (implicit `['eliminatorie','propunere']`). Scrie `ofertare_acoperire_coada.{ultimul_tick, jurnal, stare}` la fiecare felie (`tick()` L224-225), la final `activ=false, terminat_la, nota` L293 + `notifications` către `cerut_de` L294-297.
- **Batch**: FELIE=55, FELIE_RELUARE=27, MAX_INCERCARI=3. Pentru fiecare batch: felii de 55 → `felie()`; ce rămâne `fara_raspuns`/`trunchiat`/`felie_goala` → `deReluat` → felii de 27. Dacă reluarea cade: `neconfirmate += rest; break` L270 (restul batch-ului de reluare NU se mai încearcă).
- **Failure/retry în `felie()`**: eroare cu `tăiat|taiat|trunchiat` → sparge felia în două recursiv până la ≤10 (L191-208); erori `catalog|obligatorii|negasita` → return imediat (nu se repetă); altele → retry cu pauză 20 s × încercare, max 3 (L210-212). Rezultatul a două jumătăți e recompus manual (L200-207) — **`conflicte_ales_de_om`, `alese_de_om_expirate`, `clarificari_noi` NU se propagă** din jumătăți (lista are doar `conflicte_verificate`, `conflicte_raspuns`, `cerinte_fara_raspuns`).
- **Notă finală** (L284-292): include `🔒 N cerințe au dovadă verificată de om` (din `conflicte_verificate`) — dar **`conflicte_ales_de_om` (răspunsul RPC `alese_de_om`) nu e citit nicăieri în worker**, deci omul nu află câte cerințe cu alegere semnată au fost sărite.
- **Versioning**: **nu se apelează `fn_ofertare_revizie_noua`** — nicăieri în repo (grep pe `revizie_noua` în src/ts/sql: 0 apeluri; UI doar citește `ofertare_acoperire_revizii` L2199). Cele 2 revizii existente au fost create manual (SQL).

### A03 — Motorul AI: construire catalog + prompt
- **Trigger**: `felie()` → `propuneAcoperiri(supabase, {licitatie_id, batch, ids})` (worker) sau POST HTTP la edge `ofertare-acoperire` (`index.ts` L78-89, `autorizat()` L54-76: service_role liber; anon respins fără coadă activă (`coadaTabel=null` → 'apel neautorizat'); user JWT = owner sau `responsabil_id`).
- **Function**: `supabase/functions/ofertare-acoperire/core.ts` → `propuneAcoperiri()` L92-605. Model `claude-opus-5`, `max_tokens 16000`, `thinking adaptive`, cache_control pe partea stabilă (L260-277). Timeout 10 min (edge cade oricum la 150 s — L263).
- **Tables citite (catalog)**: `ofertare_licitatii (termen_depunere, obiect)`; `ofertare_cerinte (id, sursa_sectiune, text_cerinta, lot, document_probant, cand_se_prezinta) WHERE tip=batch AND inlocuita_de IS NULL` (L103-107; **nu filtrează `duplicat_al`**); `hr_autorizatii` (deleted_at null; titular activ — L110-126; `are_scan=!!fisier_path`, dar NU și scanul de pe `document_personal_id` legat, spre deosebire de panoul „Cine poate acoperi" L2499-2510); `documente_firma activ=true` (L127-135); `ofertare_parteneri activ AND NOT abandonat` (L136-137; `acopera = observatii[:400]`); `isc_rte_domenii`; `hr_documente_personale` categoria `studii` (D) și `angajator_anterior` (V); `hr_recomandari activ` (R); `ofertare_experienta activ` (E — `valoare_proprie_lei` = `valoare_executata_lei` la asociere); `employees active` filtrate pe `ROL_CONDUCERE` regex (L248-255).
- **Gărzi**: orice `error` de citire → `fail('catalog indisponibil')` L177-179; catalog gol (0 autorizații și 0 doc firmă) → refuz L182-184.
- **Input prompt**: `stabil` (nomenclator + personal + 7 cataloage) + `variabil` (licitație, termen, obiect, cerințe JSON) L257-258.
- **AI_action / reguli** (PROMPT L11-54): R1 doar din catalog; R6 valabilitate la termenul de depunere; R7/R10 domeniu ISC din obiect+cerință, nu din experiență; R8 experiență similară pe cotă proprie; R9/R9b clarificare când domeniul/experiența e ambiguă; R11 RTE 2.1 la refaceri drumuri „în motiv"; R12 `regula_propunere` restrâns; R13 CQ/CTC prin decizie internă; **R14 recomandări: transport→distribuție = acoperit CONDIȚIONAT cu clarificare obligatorie; „rețele de gaze" fără precizare = DISTRIBUȚIE**; R14b personal punctat (ordine pe nr. proiecte, punctaj doar pe recomandări verificate, „o persoană un rol", matrice, marjă); R15 `cand_se_prezinta` duae/primul_loc → expirarea nu contează; R16 proiectare prin partener; R17 studii; R18 vechime (CV = pistă, nu dovadă); R19 0-3 candidați; R20 material sudură. Modelul poate afirma: `status`, `autorizatie_id` (numeric/F/E/R/D/V), `partener_id`, `scor`, `motiv`, `domeniu_rte`, `clarificare`.
- **Output**: JSON `{acoperiri:[{cerinta_id,status,domeniu_rte,clarificare,motiv,candidati:[...]}]}`; parse strict — răspuns ne-JSON → `fail('Răspunsul AI nu e JSON valid ...')` **fără scriere** L300-314. `turtesteCandidati()` (`candidati.ts` L100-124) → max 3 candidați/cerință, `scor` implicit `90-i*20` când lipsește, `clarificare` doar pe primul.
- **Cost**: `ai_usage_log` L287-293 (cache write ×1.25, read ×0.1).

### A04 — Motorul AI: post-procesare în cod (gărzi) → rânduri
- **Function**: `core.ts` L339-462.
- **Gărzi în cod** (peste prompt): `regula_propunere` acceptat doar dacă textul cerinței conține `cumul|acela[sș]i persoan|...|nominaliz|asociat` (regex L347), altfel `nu_se_aplica`; `nu_se_aplica` și `regula_propunere` se SCRIU ca rânduri cu `mod=status` (L349-372); id-urile cu prefix se rezolvă în map-uri (L380-403) — id inexistent → candidat fără sursă → `status='gol'` L406-407; **E în asociere fără cotă → `motivBlocat` → gol** L395-400; `valabil_la_depunere` calculat în cod din `data_expirare`/`data_valabilitate` vs `termen_depunere` (L409-411; `azi = termen_depunere || new Date()` L324 — fără termen se judecă la azi, fără avertisment); R15 în cod: docF + cand_se_prezinta duae/primul_loc → `valabil=null`; dacă era `gol` DOAR pentru că expira → **status ridicat la 'acoperit' de cod** L419-424; experiență/recomandare/studii/vechime → `valabil=null` L427-430; `mod` derivat din sursa găsită (L433) — autorizație cu `ext` → `mod='partener'`; `partener_id` fără nimic altceva → `mod='partener'`; `marcheazaSudoriNepotriviti()` (`candidati.ts` L148-173): la licitație „distribuție" + cerință de sudură + toți sudorii de oțel → prefixează `motiv`/`referinta_text` cu ⚠️ și taie `scor≤40` (nu schimbă status).
- **Output**: `rows[]` {cerinta_id, mod, autorizatie_id, doc_firma_id, partener_id, experienta_id, recomandare_id, document_personal_id, referinta_text, status, valabil_la_depunere, verificat_pe_scan:false, domeniu_rte, motiv, scor}; `clarProps[]`.
- **Provenance scrisă**: doar FK-uri (autorizatie_id/doc_firma_id/…); **fără `fisier_path`, fără pagină, fără hash**; `referinta_text`/`motiv` = text AI ≤300.
- **Failure**: `rows.length==0` → `felie_goala` (nu e eroare, felia intră la reluare) L469-477.

### A05 — Scriere atomică: `fn_ofertare_acoperire_rescrie`
- **RPC**: `core.ts` L502-515 → `fn_ofertare_acoperire_rescrie(p_randuri jsonb)` (DB, SECURITY DEFINER; sursa în `db_functions_ofertare.sql` L807-942).
- **Logică**: lock `FOR UPDATE` pe cerințe (ordine crescătoare); `v_pe_scan` = cerințe cu vreun rând `verificat_pe_scan`; `v_alese_om` = cerințe cu vreun rând `ales_de IS NOT NULL`; **ambele sunt excluse integral** (`v_conflicte`) — motorul nu scrie NICIUN rând pe acele cerințe (nici alternative). Temp `_noi` cu `cheie = mod|autorizatie|docF|partener|exp|rec|docPers`; plafon 3 (`rang>3` șters); dedup pe cheie; `UPDATE` pe rândurile existente cu aceeași cheie și `pozitie_id IS NULL AND ales_de IS NULL AND NOT verificat_pe_scan` (setează status, referinta_text, motiv, scor, valabil_la_depunere, domeniu_rte); `INSERT` cele fără pereche cu `ales=false`; **DELETE** rândurile vechi ale cerințelor atinse care nu mai au pereche și `NOT ales` și fără urmă umană (`raspuns_coleg`/`tichet_id`) L915-932.
- **Status_before → after**: orice (neprotejat) → status AI. Un rând vechi `ales=true` (2221 în producție, marcate la migrarea din 21.09 fără `ales_de`) NU e șters (condiția `NOT a.ales`), dar **este actualizat** dacă are aceeași cheie (UPDATE nu verifică `ales`), și rămâne `ales=true` chiar dacă AI-ul l-ar fi retrogradat la `gol` — vezi C-06.
- **Output**: `{scrise, conflicte, pe_scan, alese_de_om, candidati, sterse, pastrate_cu_urma_umana}`.
- **Versioning**: **nu scrie istoric**; rândul vechi e suprascris in-place sau șters. `updated_at` e singura urmă.
- **Human_gate**: niciunul (rulare automată); protecția e doar `verificat_pe_scan`/`ales_de`.

### A06 — Reverificare a alegerilor umane expirate: `fn_ofertare_acoperire_reverifica_alese`
- **RPC**: `core.ts` L520-524 (neblocant) → DB fn L1-47.
- **Logică**: pentru rândurile cu `ales_de IS NOT NULL` și `NOT reverificare_ceruta`, dacă `hr_autorizatii.data_expirare < termen` sau `documente_firma.data_valabilitate < termen` (și nu `fara_expirare`) → `valabil_la_depunere=false, reverificare_ceruta=true, reverificare_motiv='Dovada aleasă a expirat...'`. Nu atinge status/ales.
- **Notă**: acoperă doar autorizații + doc firmă; nu aplică R15 (`cand_se_prezinta`), deci o alegere umană pe ONRC la o cerință „duae" primește semnal roșu.

### A07 — Clarificări auto (R9/R14)
- `core.ts` L550-575: pentru `clarProps` ale cerințelor efectiv scrise → `INSERT ofertare_clarificari {nr, intrebare, sursa:'cerința #id — de clarificat...', status:'de_trimis', origine:'platforma'}`, idempotent pe `sursa` (+ cheia veche). Eroarea nu invalidează acoperirea.
- **Human_gate**: omul trimite (status `de_trimis`); reminder zilnic `ofertare_clarificari_reminder` (cron 06:00).

### A08 — Afișare + grupare candidați (UI)
- **UI**: `AcoperireSection.load()` L2052-2082 (cerințe `registru IS NULL OR 'capabilitate'`, tip eliminatorie/propunere, `inlocuita_de/duplicat_al IS NULL`) → `grupeazaAcoperiri()` din `src/ofertareOrdine.js` L72+: ordine `ales_de → verificat_pe_scan → scor desc → id` (L32-40); primul = „candidatul afișat", restul = `alternative`; `la_egalitate`; grupare pe `cerinta_id|pozitie_id`.
- **Notă**: **`ales` (boolean) NU intră în cheia de ordonare** (doar `ales_de`) — în ecranul principal din Licitații, un rând `ales=true` nesemnat (2221) nu are prioritate față de un candidat AI cu scor mai mare. Ecranul `OfertareCerinte.jsx` L580-584 alege însă după `x.ales` (`lista.find(x => x.ales && !x.pozitie_id) || lista.find(x => x.ales) || lista[0]`). **Cele două ecrane pot arăta candidați diferiți pe aceeași cerință.**
- Stats/KPI (L2158-2183): `acop && reverificare_ceruta` → nu se numără la ✅; `elimFaraDovada = goluriElim + neevaluateElim + naElim + reverifElim`. **Nu cere `verificat_pe_scan`** — `status='acoperit'` de AI stinge alarma E3.
- Există și `verdictRand()` (`OfertareCerinte.jsx`): `verificat` > `rezerva` (reverificare/expirat) > `partener` > `acoperit` — a treia regulă de „ce e o dovadă", diferită de cele două de mai sus.

### A09 — Alegere manuală (3 căi, toate prin `fn_ofertare_alege_acoperire`)
- **A09a** `OfertareLicitatii.jsx` → `CandidatiAcoperirePanel` (potrivire lexicală, fără AI; catalog L2486-2570) → `alegeCandidat(c, cand)` L2008-2043: refuz dacă `a.verificat_pe_scan`; calculează `valabil` doar pentru autorizatie/firma; `payload` cu `mod`, `status='acoperit'|'acoperit_partener'`, FK, `referinta_text='ales manual de <nume> · ...'`, `reverificare_ceruta:false`; **UPDATE pe rândul afișat `a.id` dacă există** (L2035-2036) — adică suprascrie candidatul #1 al AI-ului (inclusiv scor/motiv rămân ale AI-ului: payload nu le resetează) — altfel INSERT; apoi RPC `fn_ofertare_alege_acoperire(rand.id)`.
- **A09b** `OfertareCerinte.jsx` → `CautareInFirma.foloseste()` L243-256: INSERT `{cerinta_id, pozitie_id, status:'acoperit', verificat_pe_scan:false, referinta_text, motiv:'ales manual din registrul firmei', ...legatura}` apoi RPC. Registrul (L172-218) judecă `valabil` la **azi** (`azi = new Date()`), nu la termen; nu scrie `valabil_la_depunere` deloc (→ NULL).
- **A09c** `OfertareCerinte.jsx` → `alegeCandidat(cerintaId, idNou)` L592-605: doar RPC (schimbă între candidați existenți).
- **RPC** `fn_ofertare_alege_acoperire` (migrația `20260921_...marcheaza_omul.sql`): cere `auth.uid()`; un singur UPDATE: `ales=(id=p)`, `ales_de = auth.uid()` pe cel ales, `NULL` pe cel deselectat; unic parțial `ofertare_acoperire_o_aleasa_pe_pozitie (cerinta_id, coalesce(pozitie_id,0)) WHERE ales`.
- **Status_before → after**: orice → `ales=true, ales_de=uid`. **Nu verifică `status`** (se poate alege un rând `gol`/`nu_se_aplica`), nici `valabil_la_depunere`, nici `verificat_pe_scan`.
- **Human_gate**: click = alegere; fără motiv, fără confirmare.
- **Versioning**: rândul deselectat pierde `ales_de` (comentariu migrație: „`ales_de` spune cine a ales ACUM, nu istoricul").

### A10 — „Verificat pe scan" (R1)
- **UI**: `AcoperireSection.verifica(a)` L2109-2122: cere `a.autorizatie?.fisier_path` (doar scanul de pe `hr_autorizatii`; **nu** pe `documente_firma.pdf_path`, nici pe `hr_documente_personale.fisier_path`, nici pe autorizația legată prin `document_personal_id`) → `UPDATE {verificat_pe_scan:true, fisier_path:scan, verificat_de, verificat_la, reverificare_ceruta:false}`. CHECK BD `ofertare_acoperire_r1: NOT verificat_pe_scan OR fisier_path IS NOT NULL`.
- Buton vizibil doar pentru status ≠ gol/nu_se_aplica/regula_propunere (L2347).
- **Provenance**: `fisier_path` = copie a căii din HR la momentul clicului; fără hash, fără pagină, fără versiune; dacă scanul din HR se înlocuiește ulterior, rândul păstrează calea veche (poate fi orfană) și rămâne „verificat".
- **Efect downstream**: cerința intră în `v_pe_scan` → motorul nu mai scrie nimic pe ea; panoul „Cine poate acoperi" devine read-only (`blocat` L2579).

### A11 — Închidere semnal „de reverificat"
- `confirmaReverificare(a)` L2127-2135: `UPDATE {reverificare_ceruta:false, reverificare_motiv:null, observatii += 'reverificat pe textul nou (nume, data)'}`. Fără condiție pe `valabil_la_depunere` (semnalul din A06 „dovada a expirat" se poate stinge fără schimbarea dovezii).

### A12 — Răspuns coleg / tichet
- `salveazaRaspuns` L2045-2050 (`raspuns_coleg/raspuns_de/raspuns_la`); `creeazaTichet` L2137-2157 (INSERT `tichete` + `ofertare_acoperire.tichet_id`). Ambele fac rândul „cu urmă umană" → nu mai e șters de `rescrie` (dar **e actualizat** dacă cheia coincide).

### A13 — Răspuns autoritate → cerință nouă → acoperire mutată (invalidare)
- **RPC**: `fn_ofertare_raspuns_set_aplica` (DB L82-318): pentru `modifica`/`anuleaza`: scrie `ofertare_cerinte.acoperire_snapshot = {la, set_id, set_titlu, acoperiri:[to_jsonb(a)...]}` pe cerința VECHE (L193-201); INSERT cerință nouă `versiune+1`, `inlocuita_de` pe cea veche; **`UPDATE ofertare_acoperire SET cerinta_id = v_nou_id, reverificare_ceruta=true, reverificare_motiv='textul cerintei s-a schimbat...'`** (L239-247) — toate rândurile (inclusiv `verificat_pe_scan`, `ales_de`) migrează pe textul nou cu statusul intact.
- **Trigger** `trg_pt_invalideaza_la_inlocuire` (`fn_pt_invalideaza_la_inlocuire`): la `inlocuita_de` setat → `ofertare_pt_legaturi` de tip `capitol` din `verificata/dovedita/redactata` → `atribuita`. Nu atinge `ofertare_acoperire`.
- **Observație**: `acoperire_snapshot ≠ NULL` = 0 rânduri în producție → calea nu a fost încă exercitată.

### A14 — Revizii (înghețare) & diff
- **DB**: `fn_ofertare_revizie_noua(p_licitatie_id, p_motiv, p_document_id)` L596-635: INSERT `ofertare_acoperire_revizii` + copie în `ofertare_acoperire_istoric` (status, mod, FK, domeniu_rte, valabil_la_depunere, referinta_text — **fără** `ales`, `ales_de`, `verificat_pe_scan`, `fisier_path`, `scor`, `motiv`, `pozitie_id`, `document_personal_id`) pentru cerințele active. `fn_ofertare_diff_revizii` L638-682: nou/disparut/regresie/progres/reclasificat/schimbat.
- **Trigger**: **niciunul în cod** (nici worker, nici UI, nici cron). UI doar listează reviziile (L2197-2201) și cheamă diff.
- **Human_gate**: n/a.

### A15 — Clasificare registru (capabilitate/depunere/executie) din verdictul AI
- **DB**: `fn_ofertare_clasifica_registre(p_licitatie_id)` L538-593: `a.status IN (acoperit, acoperit_partener, gol, regula_propunere)` → `registru='capabilitate'`; `nu_se_aplica` + doc fisa_date/formular → `depunere`, altfel `executie`; `registru_sursa='regula'`; sare `registru_sursa='om'`. **JOIN pe `ofertare_acoperire` fără a alege un rând** — cerință cu 3 candidați produce 3 rânduri în CTE; UPDATE ia unul arbitrar (`FROM clasificare` cu duplicate).
- **Downstream**: `AcoperireSection.load` afișează doar `registru IS NULL OR 'capabilitate'` → un `nu_se_aplica` dat de AI scoate cerința din ecranul de acoperire (după clasificare), deși alarma `naElim` presupune că e vizibilă.

### A16 — Propunere tehnică: „Pornește din acoperiri" → echipa F9
- **UI**: `src/OfertarePropunere.jsx` → `importaEchipa()` L1842-1885 (buton `EchipaF9` „⬇ Pornește din acoperiri").
- **API**: `SELECT ofertare_acoperire (cerinta_id, autorizatie_id, autorizatie:hr_autorizatii(employee_id, extern_id, tip)) WHERE mod='personal' AND cerinta.licitatie_id=licId` L1847-1849 — **fără filtru pe `status`, `ales`, `ales_de`, `verificat_pe_scan`, `valabil_la_depunere`, `reverificare_ceruta`**; deci și candidații 2-3 (alternativele neselectate) și rândurile `gol` cu `mod='personal'` (nu există azi; codul actual pune `mod='gol'` la status gol) devin membri de echipă. `mod='personal'` exclude externii (au `mod='partener'`) — dar codul filtrează `employee_id || extern_id` (L1850) ca și cum ar veni și externi.
- **Scriere**: INSERT `ofertare_pt_echipa {licitatie_id, employee_id XOR extern_id}` (unic parțial `ux_echipa_lic_ang/ext`); UPSERT `ofertare_pt_echipa_roluri {echipa_id, rol_cod, rol_denumire (tip autorizație), autorizatie_id, cerinta_id, sursa:'acoperire'}` on conflict `(echipa_id, cerinta_id, rol_denumire)` ignore.
- **Status_before → after**: persoană „propusă de AI ca variantă" → persoană „în echipa F9" cu `disponibil_confirmat_la=NULL`.
- **Human_gate**: click pe import; **fără selecție per persoană**. Confirmare de disponibilitate ulterioară, opțională (A18).
- **Versioning**: niciuna (rândurile se șterg/adaugă; `creat_de` NULL — insertul nu îl setează).

### A17 — Blocaje F9 & export
- **View** `v_ofertare_pt_echipa_blocaje`: (1) `autorizatie_expirata` — rol cu `hr_autorizatii.data_expirare < termen_depunere`; (2) `cerinta_descoperita` — cerință cu vreun rând `ofertare_acoperire.mod='personal'` (**orice status/ales**) fără rol în echipă; (3) `fara_rol`.
- **View** `v_ofertare_pt_echipa`: nume/functie/relatie/roluri/autorizatii/`roluri_din_cerinte`.
- **Export**: `exportaF9(ciorna)` L1904-1916: final blocat dacă `blocajeF9.length`; **`disponibil_confirmat_la` NU e blocaj** (doar contor „N fără disponibilitate confirmată" L184, L31 și `disponibilitate_neverificata` în `v_ofertare_pt_suprapuneri`). `construiesteF9` (`OfertareExport.js` L242-254) scrie nume/roluri/autorizatii — nu scrie „confirmat"/nu blochează.
- **Scoatere**: `scoateDinEchipa` L1888-1892 — confirm doar dacă `roluri_din_cerinte>0`.

### A18 — Confirmare disponibilitate
- `confirmaDisponibil(rand)` L1895-1901: `UPDATE ofertare_pt_echipa {disponibil_confirmat_de=uid, disponibil_confirmat_la=now}`. Fără motiv/perioadă/document; nu e legată de o declarație de disponibilitate din HR.
- **Consumatori**: `v_ofertare_pt_suprapuneri.disponibilitate_neverificata` (bool_or) — informativ; UI contor. Nimic nu îl cere obligatoriu.

### A19 — Personal disponibil (pachet informativ)
- `genereazaPachet()` L1476-1482 → RPC `fn_ofertare_personal_disponibil(p_la_data=termen_depunere)` (DB L337-360): angajați `active` în firmă la dată (hire/termination) cu autorizație (deleted_at null) valabilă la dată. **Doar angajați (fără `hr_personal_extern`)**, o linie per autorizație. Rezultat în state `pachet` (afișare) — **nu scrie nimic**, nu alimentează echipa.
- Reguli de valabilitate duplicate: (i) aici `a.fara_expirare OR a.data_expirare >= p_la_data`; (ii) `core.ts` L410 `expira !== 'necunoscut' && new Date(expira) >= azi` (expirare NULL fără `fara_expirare` → `valabil=false` în motor, dar în SQL `NULL >= date` → NULL → exclus; ambele îl exclud, prin mecanisme diferite); (iii) `CandidatiAcoperirePanel.valab()` L2581-2587 (`!cand.expira` → „expirare necunoscută", alegerea e permisă); (iv) `OfertareCerinte.incarcaRegistru` `valabil = fara_expirare || !data_expirare || data_expirare >= azi` (**azi**, și NULL = valabil); (v) `v_ofertare_pt_conformitate` `NOT fara_expirare AND data_expirare < termen`; (vi) `v_ofertare_pt_echipa_blocaje` idem; (vii) `fn_ofertare_acoperire_reverifica_alese` idem.

### A20 — Echipamente disponibile / F23
- `genereazaEchipamente()` L1595-1606 → RPC `fn_ofertare_echipamente_disponibile(p_la_data)` (DB L363-400): `logistica_active` `stare='Functional' AND NOT vandut AND NOT deep_sleep`, comodat valabil; `status` valabil/expirat/fara_dovezi din `logistica_documente` tip 1 (ITP), 18 (verificare), 2 (RCA). **Doar afișare** (state `echipamente`).
- `exportaF23()` L1618-1637 → `v_ofertare_dotari WHERE propus_f23=true` (view: logistica_active cu `coalesce(a.in_f23, c.in_f23)`; magazie_echipamente `activ AND NOT este_eip`; parteneri niciodată) → grupare pe `denumire|um|detinere` → DOCX. **`propus_f23` nu ține cont de ITP/verificări expirate** (regula din `fn_ofertare_echipamente_disponibile` nu e în view), nici de licitație (lista e globală, identică pentru toate licitațiile), nici de perioadă/alocare pe alte contracte. Nicio tabelă de alocare echipamente per licitație.

### A21 — Afirmațiile PT (conformitate)
- `ofertare_pt_afirmatii` (fel persoana/utilaj/partener, text_brut, rol_propus, pagina, employee_id, tip_cerut_cod, autorizatie_id/disponibilitate_id pentru externi, exceptat+motiv, sursa om/ai). **Nu există niciun INSERT în repo** (UI doar update: `exceptaAfirmatie` L1440-1450, `setTipCerut` L1452-1460, `setExtern` L1462-1470; edge `ofertare-genereaza-capitol` doar SELECT). Producție: 0 rânduri.
- **View** `v_ofertare_pt_conformitate`: verdict `block` (om_negasit, om_plecat la termen, doua_roluri ∧ interzice_cumul), `warn` (extern fără disponibilitate, autorizație extern expirată, calificare_lipsa pe `tip_cerut_cod`, autorizații expirate ale persoanei, doua_roluri, utilaj/partener fără legătură), `ok`. `interzice_cumul` = regex pe `ofertare_cerinte.text_cerinta` (duplicat caracter cu caracter în `REGEX_INTERZICE_CUMUL` din UI L1191-1197 și în `v_ofertare_pt_stare`).

### A22 — Participanți / parteneri (asociați, subcontractanți, terți)
- `ofertare_pt_participanti` (partener_id sau nume; rol asociat/subcontractant/tert_sustinator/furnizor/proiectant; cota, activitati, document_sursa/data/pagina/scop_declarat; confirmat_de/la). UI `Participanti` L1086+, `adaugaParticipant` L1305, delete L1378. Sursă: `ofertare_parteneri` (catalog general; `observatii` = „ce acoperă" pentru motor).
- **Legătura cu acoperirea**: `ofertare_acoperire.partener_id` → `ofertare_parteneri` (catalog), **nu** → `ofertare_pt_participanti` (angajament pe licitație). Nicio verificare că partenerul care „acoperă" o cerință e și participant declarat (asociat/subcontractant/terț) pe licitația respectivă.

### A23 — Organigramă: spec + „Propune echipa din platformă"
- **Edge** `ofertare-organigrama-spec` (`claude-sonnet-5`): citește `ofertare_cerinte` filtrate `RE_CERINTE` + ferestre ±1800 car. din `text_extras` → JSON spec normalizat (`roluri_cerute`, `linii_cerute`, `personal_pe_categorii`, `domenii_isc_din_obiect`, `avertismente`) → upsert `ofertare_organigrama.spec/spec_la/spec_model/spec_citate` (noduri păstrate). Poartă de rol în cod (owner/responsabil). `spec_citate` = document_id + offset + text[:300] (provenance pe pasaje, fără pagină).
- **UI** `OfertareOrganigrama.jsx` → `propune()` L695-713: `ofertare_acoperire WHERE status IN (acoperit, acoperit_partener) AND autorizatie_id NOT NULL` (**fără `ales`/`ales_de`/`verificat_pe_scan`**; include alternativele) → `construiesteNoduri()` L109-175: persoană per (nume|rol dedus din tipul autorizației `rolDinAutorizatie` L72-83), `domeniu_isc` din `domenii` + `a.domeniu_rte`; operator din `partener_id`/`ext.partener_id`; completează „DE NOMINALIZAT" pentru rolurile din spec și RTE pe fiecare `domenii_isc_din_obiect`; maistru per operator; formații implicite cu cifre hard-codate (2/2/0/2 etc. L100-103). Salvare `salveaza()` L724-735 upsert `noduri/verificari/updated_by`.
- **Verificări** `verificaOrganigrama()` L191-242 (CV/declarație disponibilitate din HR — regex pe denumire/observatii/fisier_nume, L672-690; Gantt total manual).
- **Legătură cu F9**: niciuna — `noduri.persoane` (jsonb) și `ofertare_pt_echipa` sunt două liste independente, populate din aceleași acoperiri prin două funcții diferite (filtre diferite: organigrama cere `status acoperit*`, F9 cere `mod='personal'`).

---

## (B) OBJECT LIFECYCLE

### B1 — `evidence` = rând `ofertare_acoperire` (+ `ofertare_pt_dovezi` unde e atins)

| Aspect | AS-IS |
|---|---|
| **where_created** | (1) motor AI via `fn_ofertare_acoperire_rescrie` INSERT (`ales=false`, `verificat_pe_scan=false`) — A05; (2) om: `alegeCandidat` INSERT L2037 (când cerința n-are rând) / `CautareInFirma.foloseste` INSERT L243; (3) `ofertare_pt_dovezi` INSERT din `adaugaDovada` L1697-1712 (tip `document_atribuire`, `document_id`, `document_revizie`, `locator_local`, `pagina_locala`) — obiect separat, legat de `ofertare_pt_legaturi`, nu de `ofertare_acoperire`. |
| **where_updated** | `rescrie` UPDATE pe cheie (status/referinta_text/motiv/scor/valabil/domeniu_rte) când `pozitie_id IS NULL AND ales_de IS NULL AND NOT verificat_pe_scan` — **inclusiv rândurile `ales=true` nesemnate și cele cu `raspuns_coleg`/`tichet_id`**; `alegeCandidat` UPDATE payload pe `a.id` (rândul afișat) L2036; `verifica` (verificat_pe_scan, fisier_path, verificat_de/la); `confirmaReverificare`; `salveazaRaspuns`; `creeazaTichet` (tichet_id); `fn_ofertare_alege_acoperire` (ales/ales_de); `fn_ofertare_acoperire_reverifica_alese` (valabil_la_depunere=false, reverificare_*); `fn_ofertare_raspuns_set_aplica` (cerinta_id mutat, reverificare_*). |
| **how_versioned** | În-place. Singurele copii: (a) `ofertare_acoperire_istoric` prin `fn_ofertare_revizie_noua` — **neapelată de nicio cale de cod**; subset de coloane (fără ales/ales_de/verificat/fisier_path/scor/motiv/pozitie/document_personal_id); (b) `ofertare_cerinte.acoperire_snapshot` doar la aplicarea unui răspuns al autorității (0 în producție); (c) `ofertare_pt_poarta.snapshot` = `v_ofertare_pt_stare` (agregat, nu rândurile). `updated_at` fără actor (verificat_de/raspuns_de/ales_de sunt pentru acțiuni specifice). |
| **how_invalidated** | (i) rescriere AI: DELETE rând vechi (dacă `NOT ales`, fără urmă umană, cheie dispărută) — dispare fără istoric; (ii) răspuns autoritate: mutat pe cerința nouă + `reverificare_ceruta=true` (statusul rămâne `acoperit`, doar KPI-urile îl scot din ✅); (iii) expirare dovadă aleasă de om: `valabil_la_depunere=false + reverificare_ceruta` (numai autorizații/doc firmă); (iv) **revizie/înlocuire a documentului-sursă (scan nou în HR, versiune nouă `documente_firma` prin `fn_docfirma_auto_inactivate_old_versions` → `activ=false` pe părinte)**: NU se propagă — rândul păstrează `doc_firma_id` vechi (inactiv) și `fisier_path` vechi; nici trigger, nici view nu semnalează; la următoarea rulare AI, cerința e protejată dacă e `verificat_pe_scan`/`ales_de`, deci rămâne pe documentul inactiv; (v) persoană plecată (`employees.active=false`): motorul o exclude din catalog la rerulare, dar rândul existent (mai ales protejat) rămâne `acoperit`; `v_ofertare_pt_conformitate.om_plecat` prinde asta doar pentru afirmații PT (0 rânduri). |
| **how_confirmed** | Trei semnale independente, niciunul obligatoriu: `verificat_pe_scan` (om a văzut scanul — doar autorizații cu `fisier_path`), `ales_de` (om a ales varianta), `reverificare_ceruta=false` (om a reconfirmat după schimbarea textului). `ales=true` fără `ales_de` (2221 rânduri) = artefact de migrare, nu confirmare (comentariu coloană: „NU înseamnă confirmat de om"). |
| **how_linked_to_source** | FK: `autorizatie_id` → `hr_autorizatii`; `doc_firma_id` → `documente_firma`; `partener_id` → `ofertare_parteneri`; `experienta_id` → `ofertare_experienta`; `recomandare_id` → `hr_recomandari`; `document_personal_id` → `hr_documente_personale` (mod studii/vechime; CHECK `*_coerenta` cer FK pentru mod recomandare/experienta/studii/vechime, **nu** pentru personal/firma/partener). `fisier_path` = cale copiată la „Verificat" (fără hash/pagină/versiune). `referinta_text`/`motiv` = text AI. `domeniu_rte` = cod ISC decis de AI (validat regex). Nicio legătură la pasajul/pagina din documentul de atribuire (aceea e pe `ofertare_cerinte.sursa_*`). |
| **how_linked_to_final_package** | Indirect și divergent: (a) F9 ← `ofertare_pt_echipa_roluri.cerinta_id/autorizatie_id` (populat din `mod='personal'`, orice status); (b) organigramă ← `noduri.persoane.autorizatie_id` (din `status acoperit*`); (c) `v_ofertare_pt_stare`/poarta PT ← `dovedite` = cerințe cu vreun rând `status IN (acoperit, acoperit_partener)` (L1258) — fără ales/verificat; (d) pachetul aprobat (`ofertare_pt_pachet_fisiere` cu sha256) conține DOCX-urile, **nu** scanurile dovezilor și nu id-urile rândurilor de acoperire. Nu există „dosar de dovezi" derivat din `ales=true`. |

### B2 — `person/resource` (pt_echipa + roluri, pt_afirmatii, dotări)

| Aspect | pt_echipa / roluri | pt_afirmatii | dotări (F23) |
|---|---|---|---|
| **where_created** | `importaEchipa` (din acoperiri `mod='personal'`, orice status) + manual (UI „completează manual" — nu s-a găsit formular de adăugare în fișierele citite; doar import/scoate/confirmă) | **nicio cale de INSERT în repo** (sursa `ai` prevăzută în CHECK, nefolosită) | nu se creează per licitație; `v_ofertare_dotari` derivă din `logistica_active`/`magazie_echipamente`/`ofertare_parteneri` cu flag `in_f23` pe categorie/activ |
| **where_updated** | `confirmaDisponibil` (de/la); `scoateDinEchipa` DELETE; roluri UPSERT ignoreDuplicates (o schimbare de tip autorizație creează rol nou, nu înlocuiește) | `exceptat/exceptat_motiv`, `tip_cerut_cod`, `autorizatie_id/disponibilitate_id` | în Logistică/Magazie (în afara Ofertare) |
| **how_versioned** | nu (fără istoric; `updated_at` doar la confirmare) | `updated_at` trigger | nu |
| **how_invalidated** | `v_ofertare_pt_echipa_blocaje` (autorizație expirată la termen; cerință `mod='personal'` fără rol; persoană fără rol). **Nu**: persoană plecată, acoperire ștearsă/retrogradată de AI (rolul rămâne cu `cerinta_id` orfan de acoperire), cerință înlocuită prin clarificare (`cerinta_id` rămâne pe cerința veche `inlocuita_de`), disponibilitate neconfirmată, suprapunere cu altă licitație (`v_ofertare_pt_suprapuneri` doar informativ) | `v_ofertare_pt_conformitate` (om_plecat, om_negasit, expirări, cumul) | `motiv_excludere` în view; ITP/verificări expirate NU exclud |
| **how_confirmed** | `disponibil_confirmat_de/la` (opțional, fără dovadă) | `exceptat` cu motiv obligatoriu (CHECK) | niciuna (F23 iese direct din view) |
| **how_linked_to_source** | `employee_id` XOR `extern_id` (CHECK); rol → `autorizatie_id`, `cerinta_id`, `sursa` (acoperire/copiat/manual) — **fără FK la `ofertare_acoperire.id`**, deci nu se știe dacă rolul provine dintr-un rând AI, ales sau verificat | `employee_id`/`autorizatie_id`/`disponibilitate_id`; `text_brut`+`pagina` din PT | `ref_id`+`sursa` (logistica/magazie/partener) |
| **how_linked_to_final_package** | `construiesteF9` (DOCX din `v_ofertare_pt_echipa`; hash în manifest la aprobare pachet) — final blocat doar de `v_ofertare_pt_echipa_blocaje` | poarta PT (`v_ofertare_pt_stare`) | `construiesteF23` (DOCX) — fără legătură cu `fn_ofertare_echipamente_disponibile` |

---

## (C) BREAK_POINTS (fără remediere)

**C-01 — Disponibil ≠ alocat, dar „propus de AI" devine „în echipă/F9" fără pas de alocare.**
`src/OfertarePropunere.jsx` L1847-1849:
```js
const { data: ac, error } = await supabase.from('ofertare_acoperire')
  .select('cerinta_id, autorizatie_id, cerinta:ofertare_cerinte!inner(licitatie_id), autorizatie:hr_autorizatii(...)')
  .eq('mod', 'personal').eq('cerinta.licitatie_id', licId).limit(2000)
```
Fără `status`, `ales`, `ales_de`, `verificat_pe_scan`, `valabil_la_depunere`, `reverificare_ceruta`. Toți cei ≤3 candidați per cerință (inclusiv alternativele respinse implicit, inclusiv candidatul cu ⚠️ PEHD și scor 40) intră în `ofertare_pt_echipa` + `ofertare_pt_echipa_roluri (sursa='acoperire')`. Apoi `v_ofertare_pt_echipa_blocaje.cerinta_descoperita` folosește același predicat (`ac.mod='personal'`), deci scoaterea unei alternative din echipă generează blocaj F9 pe o cerință care e de fapt acoperită de candidatul ales.

**C-02 — Același salt în organigramă, cu alt filtru.** `src/OfertareOrganigrama.jsx` L702-705: `.in('status', ['acoperit','acoperit_partener']).not('autorizatie_id','is',null)` — tot fără `ales`/`ales_de`. Două „echipe" (F9 vs organigramă) derivate din aceleași rânduri cu filtre diferite; niciuna nu citește alegerea omului.

**C-03 — `disponibil_confirmat_la` nu e cerut nicăieri downstream.** `exportaF9` L1906-1910 blochează doar pe `blocajeF9` (view). View-ul nu conține disponibilitatea. `v_ofertare_pt_suprapuneri.disponibilitate_neverificata` e informativ (nu e citit în UI-ul citit). Titlul butonului spune explicit regula („Autorizația îl face eligibil, nu și liber") — L72 — dar nimic nu o aplică.

**C-04 — Status „acoperit" scris de AI stinge alarma eliminatorie fără om.** `AcoperireSection` L2158-2183: `elimFaraDovada = goluriElim + neevaluateElim + naElim + reverifElim`; un rând AI `status='acoperit'` (`verificat_pe_scan=false`, `ales_de=null`) contează ca dovadă. La fel `OfertarePropunere.jsx` L1258 (`dovedite` = `status IN (acoperit, acoperit_partener)`) și `v_ofertare_pt_stare` (după comentariile din cod). CHECK-urile BD nu leagă `status='acoperit'` de vreo confirmare.

**C-05 — `ales` fără `ales_de` (2221 rânduri) — două semantici, două ecrane.** Comentariu coloană: „La migrarea din 21.09.2026 s-a marcat ce afișa deja interfața." `src/ofertareOrdine.js` L32-40 ordonează pe `ales_de`, ignoră `ales`; `src/OfertareCerinte.jsx` L582-584 alege pe `ales`. Pentru aceeași cerință, ecranul Licitații poate arăta candidatul AI cu scor maxim, iar ecranul Cerințe „varianta care merge în dosar" = altul.

**C-06 — `rescrie` actualizează rândurile `ales=true` nesemnate dar nu le poate șterge.** DB fn L886-896 (UPDATE fără condiție pe `ales`) vs L915-920 (`DELETE ... AND NOT a.ales`). Un rând `ales=true` (nesemnat) cu cheie care dispare din propunerea AI rămâne în tabel cu statusul vechi; unul cu cheie prezentă e retrogradat (ex. `gol`) dar rămâne `ales=true` → combinația `acoperit/gol` și rânduri `ales` cu status `gol` sunt posibile (în producție există `acoperit/gol`, `in_lucru/*`).

**C-07 — `fn_ofertare_alege_acoperire` nu validează ce se alege.** Migrația `20260921_...`: UPDATE `ales=(a.id=p)`, `ales_de=auth.uid()` — nu cere `status IN (acoperit*)`, nu cere `valabil_la_depunere <> false`, nu cere `verificat_pe_scan`, nu cere ca rândul să aparțină unei licitații la care userul e responsabil (doar `auth.uid() IS NOT NULL`). Un rând `gol` sau `nu_se_aplica` poate deveni „varianta din dosar" semnată.

**C-08 — Alegerea manuală suprascrie candidatul AI in-place și lasă scor/motiv AI pe el.** `OfertareLicitatii.jsx` L2035-2037: `a ? update(payload).eq('id', a.id) : insert(...)`; `payload` nu conține `scor`/`motiv`/`domeniu_rte`. Rândul rezultat are `referinta_text='ales manual de X'` dar `motiv`/`scor` de la AI pentru candidatul anterior; propunerea AI #1 e pierdută (nu devine alternativă).

**C-09 — Valabilitatea la termen: 7 implementări, 3 referințe temporale.** (i) `core.ts` L324/L409-411 (termen sau azi; expirare NULL → invalid); (ii) `fn_ofertare_personal_disponibil` (termen; NULL → exclus); (iii) `OfertareLicitatii.jsx` L2013-2015 alegere manuală (termen; NULL → `valabil=null`); (iv) `CandidatiAcoperirePanel.valab` L2581-2587 (termen sau azi); (v) `OfertareCerinte.incarcaRegistru` L182-183 **azi** și NULL = valabil (`!x.data_expirare`), și nu scrie `valabil_la_depunere`; (vi) `v_ofertare_pt_conformitate`/`v_ofertare_pt_echipa_blocaje` (termen, `NOT fara_expirare AND data_expirare < termen`); (vii) `fn_ofertare_acoperire_reverifica_alese` (idem, dar doar pe `ales_de`). R15 (`cand_se_prezinta`) e aplicat doar în (i) și în afișare (L2394-2400); lipsește din (ii),(vi),(vii).

**C-10 — Regulă de cumul de funcții în 3 locuri, ca regex duplicat.** `core.ts` L347 (`eRegulaEchipa`), `v_ofertare_pt_conformitate.interzice_cumul`, `OfertarePropunere.jsx` L1191 `REGEX_INTERZICE_CUMUL` = `v_ofertare_pt_stare` („identic, caracter cu caracter" — comentariu L163). Regex-urile din core.ts și din view NU sunt identice (core: `cumul|acela[sș]i persoan|...|\brol(uri|ul|urile)?\b|...|asociat`; view: `cumul\w*\s+(de\s+)?(mai\s+multe\s+)?(func[tț]i|rol|post|pozi[tț]i)|...`).

**C-11 — AI transformă NECUNOSCUT în fapt.**
- PROMPT R14 (`core.ts` L30): „Dacă cerința spune doar «rețele de gaze» / «rețele edilitare gaze» fără să precizeze, o tratezi ca DISTRIBUȚIE" → o recomandare pe distribuție devine `status='acoperit'` sigur, fără clarificare, deși cerința nu precizează.
- R10 (L24): cerință generală „RTE în domeniul contractului" → „o judeci pe domeniul PRINCIPAL al obiectului și pui celelalte domenii în motiv" → `domeniu_rte` scris ca fapt (validat doar sintactic L341).
- R15 în cod (L419-424): `if (status === 'gol' && doarExpirat) status = 'acoperit'` — codul ridică la `acoperit` pe baza unei presupuneri („documentul e bun, doar expirat") dedusă din faptul că AI-ul a atașat un `F<id>` la un rând `gol`.
- `turtesteCandidati` L120: `scor: typeof c.scor === 'number' ? c.scor : (90 - i*20)` — scor inventat de cod când modelul nu îl dă; afișat identic cu unul real (L2410-2413 arată `scor` fără distincție).
- `motivBlocat` (L398-399) și `⚠️ PEHD` (candidati.ts L166-168) se scriu în `motiv`/`referinta_text` ca text; nu există câmp structurat „avertisment", deci filtrele downstream (import F9, organigramă, `dovedite`) nu le văd.
- R13 (L27): afirmă în prompt că atestarea ISC a CTC „e abrogată" — regulă juridică bătută în prompt, nu în date.

**C-12 — Proveniența dovezii = FK + cale de fișier, fără identitate.** `verifica()` L2113-2114: `fisier_path: scan` copiat din `hr_autorizatii.fisier_path`; fără `sha256`, fără pagină, fără `document_revizie`. Contrast: `ofertare_pt_dovezi` are `document_revizie`, `locator_local`, `pagina_locala`, iar `ofertare_pt_pachet_fisiere` are `sha256` — dar niciuna nu e legată de `ofertare_acoperire`. `documente_firma` are versionare (`parent_id`, `fn_docfirma_auto_inactivate_old_versions` → `activ=false`), însă `ofertare_acoperire.doc_firma_id` nu e re-legat la versiunea nouă și nu e semnalat.

**C-13 — Reviziile există în schemă, nu în flux.** `fn_ofertare_revizie_noua` nu e apelată de worker (`acoperire.ts`), de edge (`core.ts`), de UI (doar SELECT L2199) sau de cron. Comentariul L2189-2193 („Fiecare rulare completă îngheață o revizie") nu corespunde codului. `ofertare_acoperire_istoric` nu copiază `ales/ales_de/verificat_pe_scan/fisier_path/scor/motiv/pozitie_id/document_personal_id`.

**C-14 — Snapshot doar pe calea „răspuns autoritate".** `fn_ofertare_raspuns_set_aplica` L193-201 scrie `acoperire_snapshot` pe cerința veche; nicio altă cale (rescriere AI, alegere manuală, verificare, ștergere) nu fotografiază. 0 rânduri în producție.

**C-15 — Mutarea acoperirii pe cerința nouă păstrează `verificat_pe_scan`/`ales_de` și le protejează de rerulare.** DB L239-245: `UPDATE ofertare_acoperire SET cerinta_id=v_nou_id, reverificare_ceruta=true` — rândul rămâne `verificat_pe_scan=true` pe un text pe care nimeni nu l-a verificat; `rescrie` îl consideră `v_pe_scan` și sare cerința; `confirmaReverificare` L2127-2135 stinge semnalul fără să ceară re-verificarea scanului.

**C-16 — Protecția „ales_de" e tăcută în worker.** `core.ts` returnează `conflicte_ales_de_om`/`alese_de_om_expirate` L594-595; `worker/ofertare/acoperire.ts` L251-259 citește doar `conflicte_verificate`, `conflicte_raspuns`, `duplicate_ramase`; nota finală L284-290 nu menționează cerințele sărite pentru alegere umană. Recompunerea la felie spartă (L200-207) pierde și `clarificari_noi`.

**C-17 — Pornirea rulării plătite nu are poartă de rol pe calea reală.** `index.ts` `autorizat()` (owner/responsabil) protejează edge function-ul, dar `propune()` L2089 scrie direct în `ofertare_acoperire_coada`, iar workerul rulează cu service_role. Poarta „pe cheltuială" din CLAUDE.md pct. 10 e ocolită de calea principală (varianta A din 22.09).

**C-18 — Fără fallback pentru coada de acoperire.** Nu există `ofertare_acoperire_tick` (spre deosebire de ingest/extragere); dacă workerul NAS nu rulează, rândul rămâne `activ=true`, UI se oprește după 1 h de polling (L2097), și `autorizat()` cu anon+`coadaTabel=null` (L86) înseamnă că nici pg_net cu cheia anon nu ar fi acceptat.

**C-19 — Cerințele `duplicat_al` intră în motor, dar nu în ecran.** `worker/acoperire.ts` L227 și `core.ts` L103-105 filtrează doar `inlocuita_de`; `AcoperireSection.load` L2058 și `fn_ofertare_revizie_noua` filtrează și `duplicat_al`. Rânduri de acoperire (și clarificări auto) se produc pe cerințe invizibile.

**C-20 — Clasificarea registrului consumă verdictul AI ca decizie.** `fn_ofertare_clasifica_registre`: `a.status = 'nu_se_aplica'` (propunere AI, comentată în UI ca „nu decizia omului") → `registru='depunere'/'executie'` cu `registru_sursa='regula'`; apoi `AcoperireSection.load` ascunde cerința (`registru IS NULL OR 'capabilitate'`). JOIN-ul pe 1..3 rânduri de acoperire per cerință nu alege un rând (rezultat nedeterminist când candidații au statusuri diferite).

**C-21 — `mod` derivat, nu declarat; extern = „partener".** `core.ts` L433: autorizație cu `ext` → `mod='partener'` fără `partener_id` (poate fi NULL) — CHECK-urile nu cer `partener_id` pentru `mod='partener'`; `importaEchipa` cere `mod='personal'`, deci externii cu autorizație nu ajung în F9 prin import (deși codul L1850/L1567 pregătește `extern_id`).

**C-22 — Panoul „Cine poate acoperi" și motorul au cataloage aproape identice, întreținute separat.** `incarcaCatalogAcoperire` L2486-2570 vs `core.ts` L110-244: aceleași 7 surse, aceleași filtre `titularActiv`, dar `are_scan` diferă (UI include `doc.fisier_path` legat; motorul nu), iar `OfertareCerinte.incarcaRegistru` (a treia copie) are doar 3 surse, fără filtre `deleted_at`-only/activ pe parteneri (le marchează), la **azi**.

**C-23 — F23 nu e o alocare și nu cunoaște valabilitatea.** `v_ofertare_dotari.propus_f23` = `in_f23` (categorie/activ) — fără ITP/verificare/RCA (care sunt în `fn_ofertare_echipamente_disponibile`, folosită doar pentru afișare L1597-1606), fără licitație, fără perioadă; aceeași listă pentru toate ofertele deschise simultan; nicio tabelă `ofertare_pt_echipamente`/alocare.

**C-24 — Partener „acoperă" ≠ partener „participă".** `ofertare_acoperire.partener_id` → catalog global; `ofertare_pt_participanti` (asociat/subcontractant/terț cu `confirmat_de/la`, `document_sursa`) e separat; nicio verificare că un `acoperit_partener` are participant declarat pe licitație (organigrama L119-121 leagă doar după `partener_id` egal, când există).

**C-25 — `ofertare_pt_afirmatii` fără producător.** Tot lanțul de conformitate (`v_ofertare_pt_conformitate`, `om_plecat`, `calificare_lipsa`, cumul) e construit pe o tabelă în care nimic din repo nu inserează (0 rânduri live); verdictele sunt goale prin construcție.
