# PR #1003 — runda 2

Același branch `codex/redari-pr2-stare-ui`, commit nou, fără merge/rebase/force. Numai fișiere; fără acces Supabase, aplicare SQL sau date reale.

Referințe: **M** = `supabase/migrations/20261131d_redari_stare_utilizatori.sql`; **R** = `supabase/revenire/20261131d_redari_stare_utilizatori_ROLLBACK.sql`; **D** = `supabase/tests/20261131d_redari_stare_utilizatori_dryrun.sql`.

- **P1 — profilurile automate:** D:135 actualizează profilurile deja create de `on_auth_user_created → handle_new_user` (20260929c:490). UPDATE strict pe cele trei UUID-uri fictive, verificare `ROW_COUNT = 3`, `is_owner = false` și rolul așteptat. Lipsa triggerului/profilurilor oprește explicit harness-ul; niciun INSERT redundant în `profiles`. Editorul, viewer-ul și contul fără modul rămân non-owner.
- **P2 — L15 tranzitiv:** M:293 / R:293 fixează baseline-ul extern pentru `profiles` și `user_module_access`: cele cinci coloane consumate de `fn_red_nivel` (tip/collation/ACL), ACL de tabel, refuzul ACL de coloană pe întregul tabel, owner, RLS+FORCE și toate cele nouă politici (inclusiv SELECT; `qual NULL` comparat distinct). Surse: baseline-ul de scriere din 20261003d, SELECT din scheletul SEC F2 citit de pe live 05.10 și ACL după SEC F1. Nu se preia automat catalogul curent. Câmpurile de profil ale altor module nu sunt inventariate ca structură completă; proiecția consumată este explicită.
- **P2 — vederea tranzitivă:** M:372 compară `red_v_tronson` cu definiția fixă PR1, coloanele/ordinea/tipurile/collation, owner, ACL și `security_invoker=on`. Definiția-martor este la M:443. Aceleași verificări în R; `red_v_tronson` nu este modificată. M:19 / R:19 adaugă lock pe sursele de autorizare, în aceeași ordine.
- **Mutanți:** D:71 adaugă 15 probe: pentru fiecare tabel, ACL, RLS dezactivat, FORCE, coloană redenumită, politică suplimentară și SELECT cu qual NULL; pentru tronson, definiție, `security_invoker` și ACL. Fiecare cere mesajul exact, anulează mutația în subtranzacție și verifică din nou baseline-ul legitim. Mutanții anteriori pe corpuri/callees rămân.
- **P2 — contact absent:** `src/redari/stare.js:121` aplică regula SQL `coalesce(..., false)`: doar `adresa_cunoscuta === true` permite trecerea spre `DE_CONVOCAT`, în lipsa unei stări mai avansate. D:174 / `src/redari/stareUtilizatori.test.js:21` includ `contact_absent_null`; D:241 verifică lipsa rândului de contact și NULL efectiv din vedere. Testul JS:144 acoperă null/undefined/false/true, prioritatea neidentificatului și PV A semnat.

Validări executate: `npx vitest run` — **3.963 trecute, 22 sărite; 164 fișiere trecute / 3 sărite**. `npx vite build` — **reușit**, avertismente existente de bundle/importuri mixte. Parsare SQL și PL/pgSQL reușită în M/R/D; corpul verificatorului M/R este identic; `git diff --check` curat. Expected comun: **18 cazuri / 34 perechi / 18 parcele / 9 închise / 50%**.

Neexecutat: DRY PostgreSQL, mutanții, apply/rollback/re-apply, verificarea catalogului live, RLS/ACL/PostgREST și concurența. Acestea rămân condiții operaționale pe clonă izolată cu schema/rolurile reale; parsarea nu este declarată execuție SQL. Baseline-ul nou necesită aceeași verificare de catalog înainte de aplicare, fără relaxare automată. Nu s-au atins fișierele PR1, `pv.js`, `ModalPv.jsx`, alte module sau drepturile aplicației.

| Regulă | Dovadă în runda 2 |
|---|---|
| L01 | M/R:19 — lock înaintea verificării surselor de autorizare. Fără RPC/scrieri business noi. |
| L02 | D:4 — toate fixture-urile și mutațiile în tranzacția anulată; runnerul unic pentru M/R păstrat. |
| L03 | n/a |
| L04 | n/a |
| L05 | n/a |
| L06 | M/R:19 — aceeași ordine DDL, sursele de autorizare ultimele, timeout păstrat; concurența neexecutată. |
| L07 | M:344,372 — baseline RLS/ACL și security_invoker tranzitiv; drepturi neschimbate. D:71 — mutanți pregătiți, neexecutați. |
| L08 | D:135 — identități fictive non-owner verificate; claims numai în harness. Nicio sursă nouă de autorizare în producție. |
| L09 | D:135 — editor/viewer/refuz non-owner; scenariile de acces existente păstrate, SQL neexecutat. |
| L10 | n/a |
| L11 | n/a |
| L12 | n/a |
| L13 | n/a — fără parser/regex nou în producție; parser PostgreSQL folosit la validarea fișierelor. |
| L14 | M/R — preflight și cleanup pentru manifestele/vederea-martor temporare; ciclul D păstrat, neexecutat. |
| L15 | M/R:293,344,372,443 — baseline auth și tronson; D:71 — 15 mutanți noi cu refuz exact și restaurare. Validare de catalog/runtime neexecutată. |
| L16 | n/a |
| L17 | n/a |
| L18 | `stare.js:121` — NULL nu devine adresă cunoscută; D:135 — UPDATE fără toate profilurile refuzat; M — abaterile de metadata refuzate. |
| L19 | D:174 / `stareUtilizatori.test.js:21,144` — caz null comun și cele patru valori de contact; expected literal independent. |
| L20 | D:71 — mutații refuzate și baseline legitim după restaurare; JS:144 — contact cunoscut și priorități legitime păstrate. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a |
| L25 | D:135 — triggerul real de creare profil respectat, non-owner verificat; D:241 — NULL efectiv; teste JS trecute. DRY/ACL/RLS nu sunt declarate executate. |
