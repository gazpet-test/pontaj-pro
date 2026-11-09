# PR #998 — runda 2

Corecții pe `codex/redari-pr1-regula-pv`, într-un commit nou, fără rebase/force/merge. Migrarea PR1 este încă neaplicată; garda legacy rămâne intactă. Nu s-au accesat Supabase sau date reale.

În referințele de mai jos, **M** = `supabase/migrations/20261130n_redari_pv_utilizatori.sql`, **DRY** = `supabase/tests/20261130n_redari_pv_utilizatori_dryrun.sql`.

- **P1 INSERT semnat:** M:210 refuză orice INSERT cu starea diferită de `generat`, inclusiv NULL. DRY:62 verifică drept editor non-owner (`SET LOCAL ROLE authenticated`) refuzul INSERT semnat fără scan/data și cu scan/data, trimis/anulat/NULL; INSERT generat rămâne legitim. Cerințele semnării prin UPDATE din 20261129c rămân intacte. Nu există o cale JS de INSERT semnat de testat.
- **P2 fixture normalizare:** DRY:54 folosește `upper(...)` pentru `nume_normalizat`, conform CHECK-ului real.
- **P2 DOCX / snapshot:** `src/redari/pv.js:122` folosește rolul curent pentru draft; semnat/anulat folosește exclusiv snapshot-ul înghețat. M:227 recalculează snapshot-ul server-side la fiecare scriere de PV A nefinal, inclusiv legarea documentului regenerat și semnare. Anularea rămâne permisă fără a depinde de disponibilitatea deținătorului. `src/redari/ui/ModalPv.jsx:214` și :265 includ snapshot-ul în CAS la generare/semnare. `src/redari/pvUtilizatori.test.js:54` verifică proprietar → arendaș în draft și trimis; testul de PV semnat verifică rolul istoric. DRY:172 verifică refresh la regenerare, apoi o altă schimbare la semnare.
- **P2 CHECK:** M:184 cere calitate nenulă pentru PV A semnat, pe lângă lista de roluri permise.
- **P2 PV șters:** M:214 refuză trecerea în semnat dacă `NEW.sters_la` este nenul. DRY:85 verifică refuzul și anularea legitimă a draftului șters. Fixture-ul „utilizator semnat, apoi șters” este construit după semnare, la DRY:122, numai ca postgres în tranzacția anulată. Întrucât 20261129c îngheață întregul rând semnat inclusiv pentru postgres, harness-ul dezactivează temporar strict triggerul de stare pentru acest fixture și îl reactivează imediat; DRY:112 verifică mai întâi că editorul nu poate șterge un PV semnat. Protecția de producție nu a fost relaxată.
- Amprenta noului corp de trigger este actualizată în M:323 și în `supabase/revenire/20261130n_redari_pv_utilizatori_ROLLBACK.sql:11`; amprentele baseline-ului anterior rămân intacte.

Validări: `npx vitest run` — **3.898 trecute, 22 sărite**, 162 fișiere trecute / 3 sărite; `npx vite build` — **reușit**, avertismente existente de bundle/importuri mixte; parser PostgreSQL — SQL și PL/pgSQL valide în migrare, revenire și DRY; `git diff --check` curat. DRY-ul PostgreSQL, RLS/ACL și concurența **nu au fost executate**. Limitările de validare L15 din prima rundă rămân deschise.

| Regulă | Dovadă în runda 2 |
|---|---|
| L01 | M:229 — recitirea rolului sub lock parcelă → deținător; ModalPv:214,265 — CAS include snapshot. |
| L02 | Refresh-ul snapshot-ului și scrierea PV/DOCX se fac în același UPDATE cu trigger. |
| L03 | ModalPv:214 — CAS pe snapshot, recitirile surselor înainte/după generare păstrate. |
| L04 | n/a |
| L05 | n/a |
| L06 | M:230 — aceeași ordine de lock documentată; fără lock nou pe alte PV-uri. |
| L07 | M:210,214 — INSERT/PATCH direct nu ocolesc starea inițială și refuzul semnării PV șters. |
| L08 | M:227 — rol citit de server; payload-ul nu poate modifica snapshot-ul; semnat/anulat rămân înghețate. |
| L09 | n/a — modelul de acces nu este schimbat. |
| L10 | n/a |
| L11 | n/a |
| L12 | n/a |
| L13 | n/a |
| L14 | M:184 — CHECK cu preflight legacy existent; tranzacția și postcondițiile păstrate; SQL neaplicat. |
| L15 | M:323 / revenire:11 — amprente actualizate pentru corpul nou, verificate local; limitele catalogului real rămân deschise. |
| L16 | n/a |
| L17 | n/a |
| L18 | M:211 — `IS DISTINCT FROM 'generat'` respinge inclusiv NULL. |
| L19 | Snapshot-ul pentru draft și rolul DOCX urmează aceeași sursă; JS și DRY acoperă schimbarea înainte de semnare. |
| L20 | DRY:62,85,112 — refuzuri plus creare generat, anulare draft șters și înghețare legitimă; teste JS semnat/draft. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | ModalPv — tokenul de generație și verificările după await păstrate la cele două CAS modificate. |
| L25 | DRY:54 — CHECK real respectat; teste SQL pregătite sub authenticated, motive exacte ale refuzului; expected JS literal și DOCX real. SQL neexecutat. |
