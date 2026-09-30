# Garda citirii automate Ofertare (`ofertare-ingest-doc` + worker NAS)

**Stare: DRAFT runda 2 — nimic deployat, nimic aplicat.** Închide condițiile de reluare a citirii automate după incidentul de
egress din 24–25.09.2026 (`docs/INCIDENT_EGRESS_2026-09-25.md`, verdictul `docs/INCIDENT_EGRESS_VERDICT_COPILOT_2026-09-30.md`,
`docs/MONITOR_EGRESS.md`, PR #478). Runda 2 răspunde la NO-GO Copilot r1 (secțiunea [Runda 2](#runda-2-no-go-copilot-r1)).

## Ce se schimbă
| Condiție | Implementare |
|---|---|
| (1) fără cale anonimă | `identificaApelant()` (`supabase/functions/_shared/gardaIngestLogica.ts`). Două căi: **serviciu** = header `x-ingest-secret` egal (timp constant) cu `OFERTARE_INGEST_SECRET` (≥ 32 caractere); **utilizator** = JWT verificat de Auth (`getUser`) + `fn_are_acces_ofertare()` (owner sau `user_module_access.module='ofertare'`) + poarta pe cheltuială #51 (owner sau responsabilul licitației). Cheia anon e refuzată mereu; rolul NU se mai citește din payload-ul JWT decodat local; `service_role` ca Bearer fără secret = refuz. Refuz = 401/403 fără a atinge documentul. (OK Copilot r1.) |
| (2) contor persistent + oprire + **o singură încercare pe document** | Tabel `ofertare_ingest_garda` (migrarea `20260930k_ofertare_ingest_garda.sql`). `ofertare_ingest_garda_incearca` (înainte de descărcare) acordă atomic un **token de încercare + lease de 10 min** (`incercare_token`, `in_curs_pana`) doar dacă nu există lease neexpirat — altfel răspunde `in_curs`, fără descărcare și fără numărare. `ofertare_ingest_garda_rezultat(token, …)` acceptă DOAR tokenul memorat și eliberează lease-ul. 5 eșecuri consecutive → **blocat**; backoff 60 s × 2^(n−1), max 6 h. Deblocare DOAR `ofertare_ingest_garda_reactiveaza(doc_id)` — owner. |
| (3) **egress mărginit** (NU „fără re-download”) | (a) După ce documentul e încheiat și amprenta lui e cunoscută, **nu se mai descarcă**: statusurile `procesat`/`partial` ies înainte de gardă, iar `_incearca` răspunde `deja_ingerat` pe mărime + etag egale (fără octeți). (b) Cât documentul e în lucru, **fiecare invocare/felie descarcă obiectul întreg** (arhitectura rămâne), dar numărul de descărcări e **plafonat: 80/document** între două reactivări ale ownerului (toate căile: edge + drumul local al workerului) → blocat + notificare. Garda e **fail-closed**: RPC indisponibil sau „continua” fără token ⇒ nu se descarcă. Calculul — vezi [Egress mărginit](#egress-mărginit-calculul). |
| (4) alerte | La blocare: notificare către toți owner-ii (`ofertare_ingest_garda_notifica`, modul Ofertare). Consumul în BYTES (pe obiect/oră, cota ciclului) e la monitorul de egress (PR #543, branch `claude/erp-continuare-x4p5a7-monitor-egress`) — complementar: monitorul vede **bytes pe obiect** și blochează obiectul, garda vede **încercări pe document**. Ordinea în cod: garda → poarta egress → descărcare. Integrarea `descarcaCuJurnal` se face la merge-ul celui de-al doilea PR (conflict mic, aceeași linie de `download`). |
| Worker NAS | `worker/ofertare/garda.ts` reexportă aceleași adaptoare. `candidati()` exclude documentele blocate / în backoff / cu lease activ (`opritDeGarda`); drumul local (pdftotext) ia un token înainte de descărcare și îl închide exact o dată (`cuIncercare`); când predă documentul altei căi (scan → edge, > 60 MB → `citire_mare.ts`) închide încercarea ca `predat` ÎNAINTE de apel (altfel edge-ul ar primi `in_curs`). Un răspuns `garda:*` al edge-ului oprește documentul în tura curentă fără reîncercare și fără a-i schimba statusul. PDF-urile > 60 MB (`citire_mare.ts`) au contorul lor persistent (`analiza.citire_mare`, max 3, CAS). |

## Egress mărginit: calculul
Formularea din runda 1 („fără re-descărcări complete repetate”) **nu era adevărată**: edge-ul descarcă obiectul întreg la fiecare
invocare (o felie de 2 pagini Sonnet / 8 pagini Haiku), deci un document de 100 de pagini pe Sonnet ≈ 50 de descărcări complete.
Garanția corectă e **egress mărginit**:

| Mărime | Valoare |
|---|---|
| Descărcări / document între două reactivări (`maxDescarcari`, SQL `MAX_DL`) | **80** (toate căile gărzii: invocări edge + drumul local NAS) |
| Mărimea maximă descărcată de edge | **60 MiB** (62 914 560 B): refuz fără descărcare dacă `size_bytes` din BD **sau** (runda 2) mărimea din metadatele Storage depășește pragul |
| **Plafon de egress pe document, calea gărzii** | **80 × 60 MiB = 4 800 MiB ≈ 4,69 GiB ≈ 5,03 GB** (`egressMaximDocumentBytes()` = 5 033 164 800 B) |
| După încheiere (amprenta cunoscută) | **0** descărcări (status încheiat iese înainte; `deja_ingerat` pe mărime + etag) |
| Drumul `citire_mare` (> 60 MB, NAS; în afara contorului gărzii) | ≤ 3 încercări × ≤ 200 MB (`MAX_INCERCARI_MARE`, `MAX_MARE_BYTES`) = 600 MB/document până la reset manual |
| Limita teoretică dacă ambele mărimi (BD + Storage) lipsesc/sunt greșite | limita bucket-ului, 200 MB/descărcare ⇒ 16 000 MB/document |

Comparație cu incidentul: doc 770 (99,9 MB) × ~16 000 descărcări ≈ 1,6 TB. Plafonul e pe **document**; o licitație cu N documente
poate consuma teoretic N × 4,69 GiB (200 de documente ≈ 938 GiB), peste cota ciclului (250 GB). De aici condiția de mai jos.

> **Condiție de reluare (runda 2):** reluarea cozii de ingest (`ofertare_ingest_coada.activ`) se face **DOAR după ce garda de
> bytes din #543 (monitorul de egress: jurnal descărcări, circuit breaker pe obiect, cota ciclului) e live și verificată**, și cu
> acordul lui Răzvan. Garda din acest PR mărginește încercările pe document; bytes-ii pe ciclu îi mărginește #543.

**Opțiunea B — „o singură descărcare pe document” (NEIMPLEMENTATĂ, decizie Răzvan).** Workerul NAS păstrează o copie locală
persistentă a documentului (cheie `doc_id` + sha256/etag, cu evacuare) și toate feliile se fac din aceeași copie: fie workerul trimite
felia PDF în corpul cererii către edge (edge-ul nu mai descarcă din Storage), fie workerul cheamă direct Claude pentru scanuri.
Egress = 1 descărcare/document/versiune, indiferent de numărul de felii sau de reîncercări. Cost: disc pe NAS, mutarea citirii AI
(sau a feliere) în worker, o rundă nouă de review; edge-ul rămâne pentru „Reia” din UI (cu plafonul de mai sus).
A = ce e în PR (egress mărginit + #543); B = schimbare de arhitectură, separată.

## Efecte secundare de știut înainte de deploy
- **Tick-ul pg_cron `ofertare_ingest_tick`** (fallback când workerul NAS nu dă heartbeat) cheamă edge-ul cu `SUPABASE_ANON_JWT` din Vault. După deploy, apelurile lui sunt refuzate (401) — adică fallback-ul devine inert (fail-closed). Variante: A) îl lăsăm inert (recomandat până la reluarea completă); B) migrare separată care îi adaugă headerul `x-ingest-secret` citit din Vault (necesită secret în Vault = aceeași valoare ca în env-ul funcției).
- Drumul local (pdftotext) → AI: documentul se descarcă o dată de worker și o dată per invocare edge; toate se numără în plafonul de 80.
- Un document în curs cu multe felii (ex. 100 pagini Sonnet, felii de 2 → ~50 invocări) încape în 80; plafonul se poate ridica doar printr-o migrare nouă (constantele sunt oglindite în `GARDA`).
- Lease-ul (10 min): o invocare edge trăiește ≤ 400 s (Pro), gateway-ul taie la 150 s; drumul local NAS (≤ 60 MiB + pdftotext + antet Haiku cu timeout 60 s) durează tipic câteva minute. O încercare care depășește 10 min își pierde lease-ul: rezultatul ei întârziat e respins (`token vechi`) și raportat, iar încercarea e numărată ca abandonată (eșec). Rezidual: pdftotext nu are timeout pe drumul local.
- „Reia” (partial → de la zero, din UI) trimite gărzii mărime/etag goale, ca să nu fie oprit de `deja_ingerat` (runda 2; în runda 1 reluarea unui document parțial nemodificat era blocată).

## Ordinea de punere în funcțiune (fiecare pas cu acordul lui Razvan)
1. Secret nou `OFERTARE_INGEST_SECRET` (≥ 32 caractere aleatoare) în Edge Function secrets și în `.env` workerului NAS (chmod 600).
2. Migrarea `20260930k_ofertare_ingest_garda` **doar prin `scripts/livrare_migrare.sh`** (runnerul comun, GO Copilot R9; sha256 aprobat, validator) — NU `apply_migration`/`execute_sql` (garda de livrare le refuză). Apoi `get_advisors`.
3. Deploy `ofertare-ingest-doc` (v13 r2). Test: apel cu cheia anon → 401; cu secret greșit → 401; user fără modul → 403.
4. Merge pe `main` → workerul face `git pull` și repornește.
5. Reactivarea citirii (coada) — decizie separată, **după #543 live și verificat** (condiția de mai sus).

Revenire: `supabase/revenire/20260930k_ofertare_ingest_garda_ROLLBACK.sql` (NU e migrare; armare proprie
`gazpet.revenire_20260930k = 'SCOATE_GARDA_INGEST:' || txid_current()` în aceeași tranzacție; pornește doar din amprenta exactă a
patch-ului). Cu v13 deployat, după revenire citirea automată se oprește complet (RPC lipsă ⇒ fail-closed). Redeploy v12 = decizie
separată (v12 are calea anon).

## Fișa de securitate (CLAUDE.md pct. 7)
- **(a) Conținut extern citit:** PDF-uri din documentațiile de atribuire SEAP (scrise de autorități contractante / proiectanți), trimise la Claude (Haiku/Sonnet) pentru transcriere; `nume_original` al fișierelor. Textul rezultat e DATE: se scrie în `text_extras`, nu declanșează nicio acțiune.
- **(b) Ce scrie / face:** `ofertare_documente_atribuire` (text, status, pagini), `ai_usage_log`, `ofertare_ingest_garda` (doar prin RPC), `notifications` (doar owner-ilor, la blocare). NU trimite mail, NU atinge bani (în afară de costul apelului AI, plafonat de gardă), NU atinge drepturi.
- **(c) Identitate:** edge-ul folosește `service_role` pentru BD/Storage — justificat: bucketul `ofertare` e privat, iar RPC-urile gărzii sunt `SECURITY DEFINER` executabile doar de `service_role` (utilizatorul nu-și poate reseta singur contorul). Identitatea APELANTULUI e verificată înainte, separat. Workerul NAS rulează cu `service_role` din `.env` (container fără porturi de intrare).
- **(d) Cine pornește:** utilizator cu acces Ofertare ȘI (owner sau responsabilul licitației), verificat în cod; workerul NAS cu secret dedicat comparat în timp constant. `verify_jwt` NU e considerat suficient; cheia anon e refuzată.
- **(e) Confirmare umană:** reactivarea unui document blocat (owner, RPC dedicat); reluarea cozii după incident (după #543); aplicarea migrării / deploy / crearea secretului. Regula tare (a)+(b): citește conținut extern ȘI scrie → livrat DOAR cu poarta de rol de mai sus.

## Text propus pentru `claude_docs.registru_automatizari` (NU scris încă)
```
### ofertare-ingest-doc v13 + worker NAS ingest — GARDA (30.09.2026, r2 01.10.2026, PR #553 claude/erp-continuare-x4p5a7-ingest-garda)
- Secret nou: OFERTARE_INGEST_SECRET — Edge Function secrets (ofertare-ingest-doc) + .env worker NAS Terra. Folosit doar ca header x-ingest-secret worker → edge.
- Tabel nou: ofertare_ingest_garda (RLS; SELECT doar authenticated + fn_are_acces_ofertare; anon nimic; scriere doar prin RPC). RPC: ofertare_ingest_garda_incearca / _rezultat (service_role), _reactiveaza (authenticated, owner verificat în corp), _notifica (internă, fără EXECUTE).
- Lease + token de încercare (10 min): o singură încercare pe document; _rezultat acceptă doar tokenul activ (succes|progres|predat|esec); lease expirat = abandonat = eșec.
- Fișa: (a) PDF-uri SEAP → Claude; (b) scrie documente/ai_usage_log/garda/notificări owner, fără mail/bani/drepturi; (c) service_role justificat (bucket privat, contor ne-resetabil de user); (d) user cu acces Ofertare + owner/responsabil, sau worker cu secret (timp constant); anon refuzat; (e) reactivare blocat = owner; reluarea cozii doar după #543 live.
- Limite: 5 eșecuri consecutive (backoff 1→2→4… min, max 6 h) sau 80 descărcări/document → blocat + notificare owner. Egress mărginit: ≤ 80 × 60 MiB = 4 800 MiB/document între reactivări.
- Livrare: scripts/livrare_migrare.sh; revenire: supabase/revenire/20260930k_ofertare_ingest_garda_ROLLBACK.sql (armare gazpet.revenire_20260930k).
- Tick-ul pg_cron ofertare_ingest_tick (anon din Vault) e INERT după deploy până la o migrare care îi dă secretul.
```

## Teste
| Comandă | Ce dovedește | Rezultat r2 |
|---|---|---|
| `node scripts/test_ingest_garda.mjs` (PG17 local, fără live) | SQL: livrare, precondiții, postcondiții, ACL + F1 în ambele ordini, REST, lease/token (inclusiv 10 sesiuni concurente), plafoane, revenire | **99/99** |
| `npx vitest run src/ingestGarda.test.js` | poarta de rol; oglinda TS a gărzii (lease, abandon, 4 rezultate); exact-once (`deschideIncercare`/`cuIncercare`/`plasaExactOnce`); calculul de egress | **32/32** |
| `deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-net=esm.sh,jsr.io supabase/functions/ofertare-ingest-doc/garda_test.ts` | edge, pe handler-ul real: exact un `_rezultat` pe fiecare drum după „continua” (inclusiv excepții) | **8/8** |
| `deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-write=/tmp --allow-run=pdftotext,pdfinfo worker/ofertare/ingest_garda_test.ts` | worker: exact un `_rezultat` pe fiecare drum (inclusiv excepții din blob / pdftotext / BD), filtrul de candidați | **11/11** |
| `deno test … worker/ofertare/ingest_mare_test.ts` / `citire_mare_test.ts` | regresie: bucla 770, citirea pe felii | **4/4**, **29/29** |

## Runda 2 (NO-GO Copilot r1)
Verdictul r1 (`docs/AUDIT_OFERTARE_V2/COPILOT_HANDOFF.md`, 01.10 ~01:50): poarta de identitate OK; 5 blocante. Pe fiecare:

**1. ACL tabel `ofertare_ingest_garda`.**
- *Schimbat:* `REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated; GRANT SELECT … TO authenticated; GRANT ALL … TO service_role;` (r1 nu retrăgea de la `authenticated`, care primea `arwdDxtm` din setările implicite — inclusiv TRUNCATE, care ocolește RLS). Funcțiile: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, apoi EXECUTE exact (`_incearca`/`_rezultat` → service_role, `_reactiveaza` → authenticated, `_notifica` → nimeni). Postcondiții: anon 0 din cele 8 privilegii PG17 (efectiv, `has_table_privilege`) și 0 pe coloane; authenticated EXACT SELECT (efectiv + ACL brut `SELECT:false`, fără grant option); service_role 8/8; PUBLIC absent din ACL-ul brut; 0 ACL pe coloane; + amprenta exactă a ACL-ului în amprenta patch-ului.
- *Ordinea față de F1 (#551):* tabelul pornește din setarea implicită (cu sau fără TRUNCATE) și e adus explicit la aceeași stare finală; F1 aplicat după gardă nu schimbă nimic pe tabel (postcondițiile lui F1 trec).
- *Teste:* `test_ingest_garda.mjs` §2 (injecții: INSERT/TRUNCATE/PUBLIC/GRANT OPTION/ACL pe coloană ⇒ postcondiția refuză, nimic rămas), §3 („ACL exact”, „F1 aplicat DUPĂ garda”, „ACL identic în ordinea B (F1 înainte) cu ordinea A”), §4 (REST: anon refuzat la citire, authenticated refuzat la scriere/TRUNCATE, RLS pe citire, EXECUTE pe funcții).

**2. Concurență — lease + token persistent.**
- *Schimbat:* coloane `incercare_token uuid`, `in_curs_pana timestamptz` (CHECK: ambele NULL sau ambele setate), `rezultate_respinse int`. `_incearca`: lease activ ⇒ `in_curs` (fără descărcare, fără numărare); lease expirat fără rezultat ⇒ încercarea veche închisă ca **abandonată** (eșec +1, backoff socotit de la expirare), apoi decizia normală; `continua` ⇒ token nou (`gen_random_uuid()`) + lease 10 min + descărcarea numărată, atomic sub `FOR UPDATE`. `_rezultat(p_doc_id, p_token, p_rezultat, …)`: doar tokenul memorat e acceptat (NULL/vechi/străin ⇒ `{acceptat:false, motiv}`, starea neatinsă, `rezultate_respinse +1`, raportat și în jurnalul apelantului); eliberează lease-ul. **Durata: 10 min** (> 400 s limita unei invocări edge; drumul local NAS tipic câteva minute) — `GARDA.leaseSec`, `LEASE` în SQL.
- *Decizie de semantică (de validat):* un rezultat întârziat cu tokenul ÎNCĂ memorat (lease expirat, dar nepreluat de altă încercare) e acceptat — încă nu a pornit nimic altceva; preluarea îl închide ca abandonat și îl înlocuiește, după care rezultatul vechi e respins.
- *Teste:* `test_ingest_garda.mjs` §5: „10 sesiuni concurente, document nou → exact 1 continua + 9 in_curs, o singură descărcare numărată” (și pe rând existent), token străin/NULL/vechi respinși, lease expirat → abandonat (asteapta / continua cu token nou), rezultatul târziu al încercării preluate nu atinge lease-ul nou; vitest „lease + token”.

**3. Exact-once rezultat.**
- *Schimbat:* `deschideIncercare` + `cuIncercare` + `plasaExactOnce` (`gardaIngestLogica.ts`): încercarea se marchează închisă sincron, înainte de RPC (a doua închidere nu trimite nimic); excepție ⇒ `esec` cu mesajul ei, apoi re-aruncată; ieșire fără închidere ⇒ `esec` („fără rezultat explicit”); eroarea RPC-ului nu maschează drumul (lease-ul expiră ⇒ abandonat). Rezultatul are 4 valori: `succes` (încheiat + amprentă), `progres` (felie), `predat` (NAS → edge / citire_mare; contoarele neatinse — altfel „ok” la predare ar reseta eșecurile și blocarea la 5 n-ar mai veni niciodată pentru scanuri), `esec`. **Worker:** `citesteDocument` → `cuIncercare(inc, citesteDupaGarda)`; excepțiile din blob / pdfinfo / pdftotext / BD ajung la `esec`, apoi la `proceseazaIngest` (documentul `eroare`, ca înainte); predarea la edge/citire_mare închide `predat` ÎNAINTE de apel. **Edge:** `fail()` închide `esec`, `catch` → `fail()`, `finally` → `plasaExactOnce`; ramura `dejaIngeratLaHash` închide `succes` (e azi inaccesibilă — statusurile încheiate ies înaintea gărzii — și `in_lucru` se scrie abia după ea, ca să nu lase documentul agățat).
- *Teste:* vitest „exact-once” (6 cazuri, inclusiv excepție aruncată, închideri concurente, RPC care aruncă); `supabase/functions/ofertare-ingest-doc/garda_test.ts` (handler-ul real: succes, felii progres→succes, download, PDF corupt, Claude 500, update final, **excepție din fetch și din BD** ⇒ exact un `esec`; fără „continua” ⇒ 0 descărcări, 0 rezultate); `worker/ofertare/ingest_garda_test.ts` (succes, download, **excepție din blob, din pdftotext (Deno.Command aruncă), din BD** ⇒ exact un `esec`; scan ⇒ `predat` înainte de edge; > 60 MB ⇒ `predat` + eroarea ulterioară nu mai trimite nimic; bucla `proceseazaIngest`).

**4. „Fără re-download” → „egress mărginit”.** Arhitectura NU s-a schimbat. Reformulat în doc (secțiunea de mai sus), în cod
(`gardaIngestLogica.ts`, antetul v13 al edge-ului, migrarea) și în PR: fără descărcare după încheiere + amprentă; plafon 80/document;
**80 × 60 MiB = 4 800 MiB ≈ 5,03 GB/document** (testat în vitest „egress mărginit”, plafonul 80 în SQL §6). Adăugat: edge-ul
refuză și după mărimea din metadatele Storage (nu doar `size_bytes` din BD), ca „≤ 60 MiB/descărcare” să nu depindă de o singură
sursă (test edge „peste 60 MB după mărimea din Storage”). Condiția de reluare după #543 live și verificat — adăugată. Opțiunea B descrisă, neimplementată.

**5. Standard de livrare (ca #551/#552).**
- *Migrarea:* fără BEGIN/COMMIT; garda `gazpet.livrare_migrare = '20260930k_ofertare_ingest_garda:' || txid_current()` la start și la final; precondiții fail-closed: rolul postgres, **toate obiectele noi absente în orice schemă** (tabel/index/tip, funcții cu orice semnătură, politică, constrângeri) — amprenta exactă ⇒ „deja aplicat”, altfel ⇒ „stare parțială”; dependențele (documente, auth, profiles, notifications, `fn_are_acces_ofertare()` cu amprenta exactă din 20261004b + fără overload); **fără `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP … IF EXISTS`**; postcondiții = amprenta exactă a patch-ului (structură, constrângeri, index, RLS, politică, ACL tabel/coloane, 0 triggere, md5 corpuri + SECDEF + search_path + ACL EXECUTE) + verificările explicite de la blocantul 1 + helper-ul reverificat. Trece prin `scripts/livrare_validator.py` (runnerul comun `ed7ecb0`, GO R9): „OK 22 instrucțiuni”.
- *Revenirea:* mutată din `supabase/migrations/` în `supabase/revenire/` (nu o mai parcurge niciun runner); un singur bloc DO; armare proprie legată de txid + refuz la armare persistentă; pornește DOAR din amprenta exactă (același text de amprentă și aceeași valoare așteptată ca postcondiția — testul verifică identitatea celor 3 copii); DROP fără CASCADE; postcondiție „0 obiecte”; dezarmare la final.
- *Teste:* `test_ingest_garda.mjs` §0 (validator + control negativ, amprenta identică în 3 locuri, fără IF NOT EXISTS/OR REPLACE), §1 (fără runner / alt marcaj / marcaj de sesiune / alt rol / obiect străin în altă schemă / tabel străin / helper modificat / overload / dependențe ⇒ refuz, nimic creat), §2 (12 injecții ⇒ postcondiția refuză, nimic rămas; marcaj pierdut ⇒ garda finală refuză), §3 („deja aplicat”), §7 (revenire: nearmată, txid greșit, armare persistentă, stare ≠ patch, corp modificat ⇒ refuz; reușită ⇒ 0 obiecte; a doua ⇒ refuz; reaplicare; compunere cu F1).

**Rămâne la Răzvan:** (i) A vs B pentru egress (A = acest PR + #543); (ii) semantica „rezultat întârziat cu token încă memorat = acceptat”; (iii) tick-ul pg_cron inert (A) sau cu secret din Vault (B); (iv) toate pașii de punere în funcțiune, în ordinea de mai sus.
