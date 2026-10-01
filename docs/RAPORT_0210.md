# Raport de dimineață — 02.10.2026, 08:00

Toate faptele de mai jos sunt verificate de agenți în noaptea 01→02.10 (read-only pe BD, nimic aplicat/deployat din raport). Detalii în docs-urile menționate (toate pe `main`).

---

## 1. ✅ Închis peste noapte

| Ce | Stare |
|---|---|
| **#562 IBAN garanții** | migrare `20261006b` aplicată (v`20261001222000`), merged |
| **#563 F1b MAINTAIN** | Copilot GO r2, aplicat v`20261001224000`: MAINTAIN anon/auth = 0 pe 474 relații, service_role 508=508, TRUNCATE 0; merged |
| **#540 tokenuri** (12 dezactivate), **#541 trezorerie**, **#561 RLS garanții**, **J05 #542**, **J02b #554**, **#543 egress** | toate live |
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
| [#553](https://github.com/gazpet-test/pontaj-pro/pull/553) | runbook ingest: merge main făcut, build + vitest OK. **Teste Deno NErulate** (fără deno în container) + lipsește GO Copilot pe delta de merge. CI roșu DOAR din check-ul edge functions (vezi decizia 1 și 14) | nimic încă |

---

## 3. ⏳ În curs

- **#529 conturi r7** (head `b916970`): Jakarinos a dat NO-GO pe r6 (4 P1 + 1 P2) — toate închise în r7 cu 1034 aserțiuni + mutații. Verdict Copilot + Jakarinos așteptat în noapte; versiuni migrări c `20261001230000` / d `231500` / e `233000`. **Completez la 08:00** cu rezultatul.
- **Cercetare juridic-normativă** (sesiune separată, branch `claude/cercetare-normativa`, Firecrawl reabonat): la ora raportului, ultimul commit `ba5ac8e` — 136 decizii CNSC (lot 4, 2025–2026), 211 surse în `registru_surse.json`, 449 cerințe atomice, 82 tipare clarificări. Stadiul complet în `docs/cercetare/README.md` pe branch (fișierul `RAPORT_NOAPTE_0210.md` nu există încă).

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
14. **#553 — testele Deno**: A — le rulezi tu pe PC / B — eu prin Desktop Commander (dacă e deno instalat). **Rec: B, dacă merge Desktop Commander; altfel A.**
15. **Proiecte mari din triaj** — prioritizare sau parcare: WhatsApp Meta (#76/#260), WinMentor (#108), APK/mobil (#112), Izometrie F2/F3 (#162/#163), permisiuni granulare (#128), Asistent licitații RAG (#226 — reformulat după cercetare), pachet carburant (#213/#220/#221/#223/#259), HR contracte + OCR + auto-inbox (#97/#110/#107/#157/#159). A — alegi 1–2 pentru octombrie / B — toate parcate până după Jilava. **Rec: B, apoi #226 + pachet carburant primele.**

---

## 5. ⚠️ Atenționări

- **Tuya trial expiră ~06.10** — prelungire gratuită, o faci tu.
- **Secrete în clar în comenzile de cron**: cron 41 (`x-bot-secret`), 10 cron-uri cu `x-radar-secret` (doar 2 trec prin vault). Propunere: PR de mutare în vault — dacă zici da, îl fac.
- **Dubluri alimentări Oscar**: 61 rânduri (16 în iunie). Curățare DOAR cu preview → confirm.
- **`auth.users` nu e blocat `FOR UPDATE` în #529** — declarat deschis, nu rezolvat în r7.
- **Jurnalul Copilot** nu avea rândul pentru verdictul #542 (J05 gardă) — adăugat în acest PR în `docs/AUDIT_OFERTARE_V2/COPILOT_HANDOFF.md` (01.10 | 2 | #542 J05 gardă | GO | aplicat v20261001179000, merged).
