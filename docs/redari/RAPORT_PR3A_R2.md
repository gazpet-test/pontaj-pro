# PR #1002 — PR3a, runda 2

Raport istoric pentru `28232fb0`; starea actuală este în [RAPORT_PR3A_R3.md](RAPORT_PR3A_R3.md).

Același branch `codex/redari-pr3a-poarta-utilizatori`; commit nou, fără merge. SQL numai în fișiere, neaplicat. Fără Supabase/date reale; importul și fișierele excluse din task rămân neatinse.

| Review | Remediere, fișier:linie | Dovadă |
|---|---|---|
| P1 calitatea ocolește poarta | `supabase/migrations/20261131c_redari_poarta_utilizatori.sql:309`: trigger pe UPDATE deținător. Cu false, proprietar → utilizator/arendaș refuzat dacă există convocare activă, inclusiv expediată; utilizator/arendaș → proprietar refuzat chiar fără convocare, ca să nu permită mascarea înainte de prima rezervare. Cu true, schimbările sunt permise și jurnalizate. | DRY `..._dryrun.sql:119,163,204,232`: ambele direcții, rezervat/expediat/anulat, true și audit. Pregătit, neexecutat. |
| P1 serializare | Migrare `:286,323`: cheia `red_convocare_posta:<proiect>:<detinator>`, comună rezervării, regenerării/expedierii și tranziției de calitate. UPDATE are deja lock implicit pe deținător: TRY advisory + proiect NOWAIT, 55P03 la concurență, fără a aștepta în ordine inversă. | Analiză de lock-uri și parsare SQL; testul în două sesiuni rămâne neexecutat. |
| P1/P2 L15 plicuri | Migrare `:158`: amprente corp/limbaj/owner/SECURITY/config/ACL pentru `fn_red_plic_creeaza`, `fn_red_plic_reguli`, `fn_red_plic_propaga`, scan/AR/identitate/deținător + callees comune din baseline existent. Inventar complet red_plicuri, red_proiecte și red_detinatori, inclusiv WHEN/tgnargs/tgargs/tgattr. | `src/redari/poartaUtilizatoriSql.test.js`: amprente raportate la sursele independente 29i/29j/29k și paritate bloc migrare/DRY, verde. DRY `:19`: mutant real care golește propagarea, refuz exact și restaurare în subtranzacție; neexecutat în BD. |
| P1 upload înainte de refuz | `src/redari/docx.js:790`: citire proaspătă convocare → deținător → parcelă → proiect prin FK-urile existente; `motivConvocatorUtilizator` înainte de orice Storage.list/upload, inclusiv true fără șablon; context lipsă sau proiect diferit = refuz. Se aplică tuturor apelanților reîncărcării, inclusiv Fișei și modalului. | `src/redari/docx.test.js`: 4 cazuri calitate × flag + context inaccesibil; numai SELECT, zero Storage. Regresiile proprietarului au trecut. |
| P1 număr consumat fără șablon | `src/redari/ui/comune.jsx:72`; `src/Redari.jsx:537,580` (ModalConvocator este în Redari.jsx): predicat comun la butoane și la acțiune, pe deținător/proiect proaspăt, înainte de fetch șablon și RPC. | `src/redari/ui/ModalConvocatorPoarta.test.jsx`: handler-ele modalului real, props vechi proprietar/date proaspete utilizator sau arendaș, false/true; generare și regenerare fără RPC/fetch/upload. |
| P2 ordinea BEFORE proiect | Migrare `:190,436`: `autorizare_tgz < proiect_utilizatori < proiecte_retentie_mail < versiune`, jurnal AFTER; metadate complete în preflight și postcondiții. | Baseline explicit ordonat COLLATE C; parsare SQL validă. |

Rollback-ul include noul trigger/funcție, amprente actualizate, verificarea tipului/argumentelor/coloanelor triggerelor și lock pe deținători. Migrarea 31c este încă neaplicată; nu s-au editat migrări aplicate sau 20261130n/20261131a.

Verificări executate: `npx vitest run` — **165 fișiere trecute, 3 sărite; 3.930 teste trecute, 22 sărite**. `npx vite build` — **verde** (avertismente de bundle/importuri mixte). `git diff --check` — verde. `pglast` — sintaxa SQL și PL/pgSQL validă pentru migrare, rollback și DRY.

Neexecutat: DRY-ul SQL (inclusiv mutantul), regresiile SQL, două sesiuni concurente, apply → rollback → re-apply și interogarea PostgREST reală. Baseline-urile sunt din sursele versionate, fără recitire live; relațiile FK sunt cele existente în schema repo. Aceste verificări rămân necesare înainte de aplicare. PR3b (șablonul) rămâne deschis; nici cu flag true clientul nu poate genera documentul utilizatorului.

## L01–L25, runda 2

| Regulă | Respectare / dovadă |
|---|---|
| L01 | Migrare `:286,323`: același advisory înainte de verificarea flagului/EXISTS; UPDATE implicit este tratat cu TRY/NOWAIT. CAS-ul comutatorului rămâne neschimbat. |
| L02 | Refuzul din trigger anulează aceeași tranzacție; rezervarea număr+rând rămâne atomică. Nu se adaugă scrieri client înlănțuite; poarta rulează înainte de Storage (`docx.js:790`). |
| L03 | `Redari.jsx:527` recitește proiect/deținător; `docx.js:790` citește relația actuală a convocării înainte de încărcare. Teste cu props vechi și deținător proaspăt. |
| L04 | n/a — nicio trimitere/cheie de idempotentă nouă. |
| L05 | Niciun retry, ștergere sau fallback nou; refuzul pre-upload nu lasă efecte Storage. Testele verifică explicit zero Storage/RPC la refuz. |
| L06 | Comentarii de lock în trigger-ele migrării `:286,323`; TRY/NOWAIT refuză concurența cu 55P03, fără așteptare inversă după lock-ul implicit. Două sesiuni: neexecutat. |
| L07 | Trigger nou pe red_detinatori (`...sql:309`), gardă existentă pe convocări păstrată; UPDATE direct al calității nu mai ocolește poarta. DRY ambele direcții. |
| L08 | Triggerul nou verifică auth.uid() nenul și fn_red_nivel(); fără parametru user/GUC de autorizare, fără bypass de mentenanță. Proveniența aprobării rămâne numai server. |
| L09 | Proiectele vechi/noi derivă din parcele, nu din client; accesul exact redari prin fn_red_nivel(). Uploadul verifică și proiectul real al convocării (`docx.js:794`). |
| L10 | n/a — fără secrete/parole; fixture-uri fictive. |
| L11 | n/a — fără extragere de dovezi. |
| L12 | Refuzurile au motiv explicit în modal, lot și generator; nu se transformă în succes/gol. Teste de handler și zero efecte. |
| L13 | n/a — fără parser/regex nou de business. |
| L14 | Aceeași tranzacție/gardă txid/postcondiții; rollback extins pentru toate obiectele noi (`..._ROLLBACK.sql:106`). Ciclul apply/rollback/re-apply neexecutat. |
| L15 | Preflight migrare `:158,183,190`, postcondiții `:426`; corp+callees/ACL/config și triggere cu argumente/coloane. DRY `:19`: mutant propagare, bloc identic celui livrat; Vitest verde. Execuția BD a mutantului este neefectuată. |
| L16 | n/a — nicio cheie de unicitate nouă. |
| L17 | n/a — fără calcul numeric sau temporal nou. |
| L18 | Erori SELECT/context lipsă = refuz înainte de Storage; SQL IS NOT TRUE/IS DISTINCT FROM; JS true strict. Test context inaccesibil și false/true. |
| L19 | Același motivConvocatorUtilizator în gardă comună/modal/generator/reîncărcare; aceeași cheie advisory SQL. Teste calitate × flag; DRY echivalent pregătit. |
| L20 | Teste utilizator/arendaș false/true și proprietar legitim; DRY tranzacții cu active/anulate, corecție permisă true, audit; ON/OFF al comutatorului neschimbat. |
| L21 | n/a — fără AI. |
| L22 | n/a — fără cost AI. |
| L23 | n/a — numai citiri individuale noi; paginarea lotului rămâne neschimbată și regresiile sunt verzi. |
| L24 | Citirea nouă din modal este în Promise.all existent și verifică tokenul activ înainte de rezultat/efecte (`Redari.jsx:532`). |
| L25 | Vitest pe handler-ele modalului real și client fals PostgREST/Storage, expected explicite. DRY folosește JWT + SET LOCAL ROLE și fixture-uri FK/CHECK; SQL/concurența/mutantul neexecutate, fără a fi declarate trecute. |
