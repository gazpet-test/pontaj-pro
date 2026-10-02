# Raport de dimineață — 02.10.2026, 08:00

Toate faptele de mai jos sunt verificate de agenți în noaptea 01→02.10 (read-only pe BD, nimic aplicat/deployat din raport). Detalii în docs-urile menționate (toate pe `main`).

---

## 1. ✅ Închis peste noapte

| Ce | Stare |
|---|---|
| **#562 IBAN garanții** | migrare `20261006b` aplicată (v`20261001222000`), merged |
| **#563 F1b MAINTAIN** | Copilot GO r2, aplicat v`20261001224000`: MAINTAIN anon/auth = 0 pe 474 relații, service_role 508=508, TRUNCATE 0; merged |
| **#540 tokenuri** (12 dezactivate), **#541 trezorerie**, **#561 RLS garanții**, **J05 #542**, **J02b #554**, **#543 egress** | toate live |
| **#529 conturi c/d/e** | **ÎNCHIS.** 11 runde în noapte (r7→r11), review dublu Copilot + Jakarinos, **GO dublu pe r11** (head `8a7f193`); preflight live read-only toate OK (#572, merged); aplicat prin runner **03:57 RO** (v`20261001230000` / `231500` / `233000`, cod 0, gate 0e 0); sanity: `fn_cont_serializare_activa = true`, 13 triggere pe `employees`, 28 funcții `fn_cont*`, coadă 0; **MERGED `0823d2c`**. 1273 aserțiuni harness, mutații per fix. **Ce aduce live:** legare automată cont↔fișă serializată (chei advisory pe email/nume, `auth.users FOR NO KEY UPDATE NOWAIT`), închidere automată la încetare (coadă + sweep cu NOWAIT, gardă pe aceeași persoană/CNP), colaborare externă pentru foști angajați. **Revenire:** `supabase/revenire` ROLLBACK c/d/e — doar cu GO. |
| **#572 preflight #529** | read-only live, toate OK; merged (docs) |
| **#566** jurnal Copilot, **#568** `docs/EGRESS_STARE_0210.md`, **#570** `docs/JILAVA_DECIZII_0210.md` | merged (docs) |
| **#548 schema CTC** | era deja merged 01.10 16:15 și aplicată live din 30.09 (memoria era veche). Audit post-factum OK. Minor: grants în plus pe view-ul `v_ctc_carti_progres` (agregat, fără efect) → decizia 13 |
| **Todo #51/#52/#53** (istoric export hrană/ITM, ordin deplasare din istoric diurne) | deja live de mult — de închis în memorie (decizia 12) |

---

## 2. 📄 PR-uri draft de citit

| PR | Ce e | Ce testezi LIVE |
|---|---|---|
| [#565](https://github.com/gazpet-test/pontaj-pro/pull/565) | `docs/TODO_TRIAJ_0210.md` — triaj 165 todo: **11 livrate, 19 depășite, 55 parțiale, 80 valabile**; top 15; dubluri #97=#110, #712=#727, #129≈#811≈#824, #105≈#748, #56≈#667 | nimic — doar citit + decizia 12 și 15 |
| [#567](https://github.com/gazpet-test/pontaj-pro/pull/567) | UI Admin → Setări: responsabili default Tichete (#150) + datalist semnatari ordin (#45) | după merge: schimbă un responsabil → tichet nou pe departament → trebuie să vină preselectat. **Ctrl+Shift+R** |
| [#569](https://github.com/gazpet-test/pontaj-pro/pull/569) | Diurne r6: exportul marchează **„nedeterminat"** la defalcare peste 1 ale lunii; vitest 13/13; + `docs/DIURNE_RECONCILIERE_0210.md` | export diurne pe o tranșă care trece peste 1 ale lunii → coloana apare „nedeterminat" |
| [#553](https://github.com/gazpet-test/pontaj-pro/pull/553) | runbook ingest-gardă: merge main făcut; **GO Copilot pe delta de merge**; **Deno 39/39 pe Linux** (pe Windows pică doar din `/tmp` hardcodat — nu e bug de logică); **vitest 36/36**. CI roșu DOAR din check-ul edge functions (decizia 1). **Merge DOAR după apply `20260930k` prin runner** — worker-ul NAS rulează `main` (decizia 17) | nimic încă — ordinea e în decizia 17 |

---

## 3. ⏳ În curs

- **Cercetare juridic-normativă** (sesiune separată, branch `claude/cercetare-normativa`, PR #564 draft, Firecrawl reabonat): ultimul commit `ab0e46d` (01.10 22:37 UTC = 01:37 RO) — raport complet în `docs/cercetare/RAPORT_NOAPTE_0210.md` pe branch. Cifre finale: **182 decizii CNSC** (95 apă-canal / 48 gaze / 18 distribuție / 21 generale; 71 admise, 45 parțial, 66 respinse), **370 surse**, **919 cerințe atomice** (864 verificate pe sursă), **313 relații** în graf, **97 tipare clarificări v1.3** (64 încredere ridicată; 35 cer review juridic). Control judiciar: 13 decizii atacate, 4 modificate (marcate ⚠️). De citit azi: **Ord. ANRE 17/2026** în vigoare din 26.05.2026 — termenul de 3 luni pt dovada noilor cerințe a expirat ~26.08.2026 → **verifică dacă Gazpet a depus dovada**; `pentru_echipa.md` (7 întrebări pt Gemini/Copilot). Nu se face merge pe #564 până nu-l citești.

---

## 4. 🎯 DECIZII

1. **Deploy `ofertare-word-text` v5 + `ofertare-ingest-doc` v22** (modificate 30.09, nedeployate; din cauza lor check-ul CI e roșu pe orice PR). A — acum (verific întâi dacă au nevoie de secret nou) / B — după Jilava 06.10. **Rec: A, dacă nu e secret nou.**
2. **Diurne regularizare septembrie, 1.300 lei** (Baiesu 450, Ioan Sorin 350, Mitrache 300, Tudurachi 200). A — tranșă separată, preview → confirm / B — modific plățile existente (nerecomandat) / C — în afara sistemului. **Rec: A.**
3. **Diurne august** (Mitrache 1.000, Baiesu 300). A — în aceeași regularizare / B — doar notă. **Rec: verifică bifele întâi, apoi decizi.**
4. **Plata lunară „în paralel"** (`isFullMonthPeriod`). A — păstrăm / B — scoatem. **Rec: B.**
5. **RPC diurne cu amprentă (r5).** A — închis / B — proiect separat. **Rec: A deocamdată.**
6. **RTE Pătrașcu (id 92)** pe P19 Bretea, P26 ADI Ialomița, P27 Finta. A — da (cu deciziile de numire) / B — nu. **Rec: A.**
7. **Ordin de începere la distribuție = predare amplasament?** A — da / B — nu. **Rec: B** — invitația susține `data_start` 17.08, dar nu înlocuiește ordinul.
8. **RTE Mironu P32**: UPDATE `rte_employee_id` 109 (Stănescu) → 37 (Dădulescu, decizia 916/28.09). A — aplic cu preview / B — nu. **Rec: A.**
9. **Europan P6**: `nr_contract` „122/06.02.2026" nu apare în niciun document (Gazpet = acord subsecvent 1/27.06.2024) — **de unde vine?** + confirmă propunerile **48** (31.007.489,30 lei) / **40** (GBE 10%) / **49** (penalități zile lucrătoare vs calendaristice). **Rec: spune sursa nr. contract; propunerile le confirmi una câte una.**
10. **`gbe_cont_iban` pe `contracte_terti`** — risc deschis. A — adaug coloana (migrare mică) / B — rămâne așa. **Rec: A, în următoarea migrare pe contracte.**
11. **Generator GBE/CAR/avans** (`claude_context` #1519). A — pornesc / B — parcat. **Rec: B până se închide Jilava.**
12. **Închidere todo-uri în memorie**: 11 livrate + 19 depășite + #51/#52/#53 + #150/#45 (după testul de la #567). A — da, le închid / B — îmi dai lista ta întâi. **Rec: A.**
13. **Grants în plus pe `v_ctc_carti_progres`**: A — migrare mică acum / B — la următoarea migrare CTC / C — nu. **Rec: B.**
14. ~~#553 — testele Deno~~ **Nu mai e decizie**: rulate deja pe Linux, 39/39 (pe Windows pică doar din `/tmp` hardcodat — info, nu blocaj).
15. **Proiecte mari din triaj** — prioritizare sau parcare: WhatsApp Meta (#76/#260), WinMentor (#108), APK/mobil (#112), Izometrie F2/F3 (#162/#163), permisiuni granulare (#128), Asistent licitații RAG (#226 — reformulat după cercetare), pachet carburant (#213/#220/#221/#223/#259), HR contracte + OCR + auto-inbox (#97/#110/#107/#157/#159). A — alegi 1–2 pentru octombrie / B — toate parcate până după Jilava. **Rec: B, apoi #226 + pachet carburant primele.**
16. **Cele 4 P2 acceptate de Jakarinos ca risc documentat pe #529**: (a) deadlock la legare pe loturi; (b) garda de serializare nu verifică `tgqual`/`tgattr`; (c) notificări pierdute fără reluare + `notificat_la` marcat fără livrare; (d) amânare nelimitată a sweep-ului la contenție, fără contor/alertă. A — PR mic de follow-up săptămâna asta / B — rămân documentate. **Rec: A.**
17. **Ordinea #553**: A — preflight → apply `20260930k` prin runner (versiune nouă `20261002090000`) → merge → worker-ul NAS ia `main` (azi) / B — amân după Jilava 06.10. **Rec: A, azi.**

---

## 5. ⚠️ Atenționări

- **Tuya trial expiră ~06.10** — prelungire gratuită, o faci tu.
- **Secrete în clar în comenzile de cron**: cron 41 (`x-bot-secret`), 10 cron-uri cu `x-radar-secret` (doar 2 trec prin vault). Propunere: PR de mutare în vault — dacă zici da, îl fac.
- **Dubluri alimentări Oscar**: 61 rânduri (16 în iunie). Curățare DOAR cu preview → confirm.
- **Jurnalul Copilot** — rândul pentru verdictul #542 (J05 gardă, GO, aplicat v20261001179000) NU mai e adăugat din acest PR (conflict la merge-ul cu main; s-a păstrat versiunea de pe main). La grep pe main nu apare un rând dedicat #542 — de verificat și adăugat separat dacă lipsește.
- **Lecții noapte**: (1) pachetele Copilot peste ~400 KB blochează editorul ChatGPT (`insert_text`) — sub 350 KB merge; (2) `execute_sql` UPDATE pe `claude_docs` cu text lung + paranteze dă timeout — retry cu text mai scurt; (3) testele Deno cu `/tmp` hardcodat pică pe Windows — de parametrizat cu `Deno.makeTempDir()`.
