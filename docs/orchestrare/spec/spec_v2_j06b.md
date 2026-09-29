# V2-J06b (Jakarinos): P2, condițiile Copilot înainte de rularea live
Branch-ul tău: `jak/v2-j06-p2` (PR #526), continui pe el. Verdict Copilot: „GO pregătire, NO-RUN live încă”. Completează planul și harness-ul cu:

1. **T0 obligatoriu**, înainte de prima fază: snapshot BD + Storage pentru 103. Include: stări pachet, manifest, cerințe active, audit J05 (`ofertare_derogari_audit`), hash-uri și identități de obiecte Storage relevante (`storage.objects` id/updated_at/eTag/size sub `103/`), contoare-cheie. Salvat ca artefact, cu hash propriu.
2. **Actor fix, non-owner**, pentru toate fazele. Dacă un pas cere owner, faza devine `BLOCKED_BY_ROLE`; nu se schimbă identitatea.
3. **`external_effect`** pe fiecare fază, pe lângă `cost_ai`: `none | db | storage | seap | email | webhook | cron | alta_licitatie`. Runner-ul refuză `--apply` pentru orice fază cu altceva decât `none | db | storage`. Storage și DB se verifică la rulare (gardă activă, nu presupusă din cale), strict în scope-ul 103.
4. **Pentru fiecare P2.01–P2.12**, în `P2_PLAN_RULARE.md`, în ordinea asta: precondiții → acțiune → scrieri așteptate → verdict server așteptat → verdict UI așteptat → dovezi de capturat → cleanup/rollback.
5. **Oprire:** la primul FALSE_GREEN, BYPASS, scriere în afara lui 103 sau divergență UI/server pe un control critic, seria se oprește. Documentezi, apoi ieși cu un cod distinct.
6. **Marker de idempotență** pe fiecare fază: `safe_rerun: true/false` + ce se întâmplă la rerulare. Cele care nu sunt safe cer `--confirm-rerun`.
7. **Postcondiții R5/R12/J05 prin query brut** (SELECT pe view-uri/tabele, cu JWT-ul non-owner), nu prin mesajul din UI. Reținere: `ofertare_r5_blocaj_sursa` e funcție SQL. Dacă RLS nu permite apelul ca non-owner, marchezi explicit că verificarea R5 se face separat de Claude (SQL admin, read-only) și prevezi slotul pentru rezultat.
8. **UNDETERMINED:** motivul numește veriga exactă care lipsește (selector / endpoint / fixture / permisiune / stare / artifact). Fără workaround-uri.
9. **După fiecare fază:** diff față de T0 și față de faza anterioară, inclusiv efecte secundare neașteptate (orice rând nou în afara tabelelor așteptate → BYPASS).

Teste: `node --test --test-isolation=none scripts/audit-v2/*.test.*` + `node scripts/audit-v2/test-retete.mjs`, toate PASS, cu teste noi pentru 3, 5, 6 și 9. Fără live, fără git, fără AI. La final actualizezi `docs/AUDIT_OFERTARE_V2/jak_j06_rezumat.md` (secțiunea J06b).
