# PR #998 — runda 3

Același branch `codex/redari-pr1-regula-pv`, commit nou peste runda 2, fără rebase/force/merge. Numai fișiere; SQL neaplicat, fără acces Supabase/date reale. **M** = `supabase/migrations/20261130n_redari_pv_utilizatori.sql`; **DRY** = `supabase/tests/20261130n_redari_pv_utilizatori_dryrun.sql`.

- **P1 ștergere logică:** M:247 exclude `NEW.sters_la IS NOT NULL` din recitirea obligatorie a sursei. Ștergerea draftului și anularea nu depind de existența activă a deținătorului/parcelei. DRY:97 construiește drafturi, șterge întâi deținătorul, respectiv parcela, apoi șterge PV-ul; verifică succesul ca editor non-owner.
- **P2 document / snapshot:** M:187 adaugă `calitate_document`. La schimbarea căii DOCX, triggerul citește rolul curent sub lock parcelă → deținător, verifică precondiția transmisă de client și scrie valoarea din sursă atomic cu noua cale. Modificarea acestei calități fără o versiune nouă este refuzată. M:260 cere la semnare o cale generată existentă, neschimbată în aceeași operație, și `OLD.calitate_document = rolul curent`. Altfel refuză explicit: „calitatea s-a schimbat dupa generare - regenereaza documentul si semneaza noua versiune”. Snapshot-ul semnatarului este înghețat din valoarea documentului. CHECK-ul cere concordanță pentru PV A semnat.
- **Client:** `pv.js:7` construiește patch-ul de generare cu rolul folosit de DOCX din aceeași sursă; `ModalPv.jsx:212` îl transmite. Payload-ul nu este acceptat ca proveniență liberă: serverul îl compară cu sursa blocată și scrie propria valoare. O schimbare a rolului între citire și legarea fișierului produce refuz, nu un document etichetat cu alt rol.
- **P2 CAS:** `pv.js:14,17` exclude `calitate_semnatar` derivată din CAS și comparații cât timp PV-ul este draft; păstrează câmpurile editabile, calea și `calitate_document`. `ModalPv.jsx:31,214,265` folosește helperii și păstrează verificările de generație async. Pentru semnat/anulat snapshot-ul rămâne în comparații/CAS.
- **DRY:186:** proprietar → DOCX proprietar → arendaș → scan vechi refuzat; starea rămâne neschimbată. PATCH izolat al calității documentului și legarea DOCX cu rol vechi sunt refuzate; regenerare arendaș → semnare acceptată cu snapshot concordant. Fixture-urile semnate existente generează întâi documentul. Revenirea elimină și `calitate_document`, refuză snapshot/istoric nou; amprentele triggerului sunt actualizate în postcondiții și rollback.

Validări executate: **`npx vitest run`: 3.900 trecute, 22 sărite; 162 fișiere trecute / 3 sărite. `npx vite build`: reușit**, cu avertismente existente de bundle/importuri. Cele 27 teste PR1 includ acum payload-ul de generare, rolul din DOCX, CAS și comparațiile draft/final. Parsarea PostgreSQL SQL + PL/pgSQL trece în migrare, rollback și DRY; amprentele corpului nou sunt verificate local. `git diff --check` curat.

**Neexecutat:** DRY PostgreSQL, RLS/ACL, concurență și verificarea PostgREST. Limitările L15 din prima rundă rămân deschise; parserul nu ține loc de test SQL. Garda legacy pentru PV A deja semnate rămâne intactă.

| Regulă | Dovadă în runda 3 |
|---|---|
| L01 | M:247 — lock înainte de citirea rolului; ModalPv:214,265 — CAS pe câmpurile deciziei/documentului. |
| L02 | Rolul documentului și calea se scriu atomic în același UPDATE + trigger. |
| L03 | pv.js:7 și M:260 — rolul sursei din DOCX este precondiție verificată sub lock; recitirile/CAS rămân. |
| L04 | n/a |
| L05 | ModalPv păstrează fișierul și mesajul de legare neconfirmată dacă UPDATE eșuează. |
| L06 | M:248 — ordinea parcelă → deținător este păstrată și documentată; fără lock pe alte PV-uri. |
| L07 | M:224,260 — PATCH direct nu poate schimba calitatea documentului fără regenerare sau semna cu alt rol. |
| L08 | M:271 — serverul scrie rolul din sursa blocată; valoarea trimisă este precondiție verificată. |
| L09 | n/a — drepturile existente nu sunt schimbate. |
| L10 | n/a |
| L11 | n/a |
| L12 | n/a |
| L13 | n/a |
| L14 | Preflight pentru ambele coloane noi, CHECK, postcondiții și rollback complet; DRY în tranzacție anulată pregătit, neexecutat. |
| L15 | Amprenta corpului nou în postcondiții și rollback, fără relaxarea baseline-ului; validarea live/mutanți rămâne deschisă. |
| L16 | n/a |
| L17 | n/a |
| L18 | Rol necunoscut, document absent sau calitate diferită sunt refuzate; SQL `IS DISTINCT FROM`. |
| L19 | pv.js:7 — patch din aceeași sursă ca DOCX; helperi comuni CAS/comparații; teste JS și DRY pentru concordanță. |
| L20 | DRY:97,186 — ștergere legitimă, scan vechi refuzat, regenerare și semnare acceptate; testele JS sunt verzi. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | ModalPv — tokenul de generație și verificările după await rămân în ambele acțiuni modificate. |
| L25 | pvUtilizatori.test.js — expected literal pentru payload/DOCX/CAS; DRY sub authenticated cu FK/CHECK reale pregătit, SQL neexecutat. |
