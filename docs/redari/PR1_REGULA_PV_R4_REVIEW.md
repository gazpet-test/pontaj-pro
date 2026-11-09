# PR #998 — runda 4

Același branch, commit nou peste runda 3, fără rebase/force/merge. **Nu s-au adăugat tabel, coloană, funcție SQL publică sau drepturi noi**: remedierea folosește calea și `calitate_document` deja propuse. Modificări numai în fișiere, fără aplicare SQL/date reale.

**M** = `supabase/migrations/20261130n_redari_pv_utilizatori.sql`; **DRY** = `supabase/tests/20261130n_redari_pv_utilizatori_dryrun.sql`.

- **M:258–292:** pentru fiecare legare a unei versiuni PV A, serverul validează calea exactă `<proiect>/<uat3>/pv/<nr_pv>_v<N>_<calitate>.docx`, prin regex constant ancorat și egalitate cu forma reconstruită. Proiectul/UAT-ul/numărul trebuie să fie ale PV-ului, iar rolul din cale = rolul deținătorului sub lock = calitate_document. N are 1–9 cifre, fără zero inițial. N trebuie să fie strict mai mare decât versiunea căii curente; calea curentă nu poate fi resetată/ștearsă ca să se piardă pragul. O cale legacy canonică fără rol păstrează pragul numeric; o cale curentă neinterpretabilă este refuzată explicit pentru review.
- **M:258,295:** la semnare se parsează și se verifică din nou calea OLD, rolul din OLD.cale = OLD.calitate_document = rolul curent. PV legacy fără rol/calitate_document cere regenerare. Ștergerea draftului, anularea, starea inițială și celelalte corecții din rundele anterioare rămân protejate.
- **`src/redari/pv.js:8,23,311,355,372`:** parser/validator comun JS, construcție cale cu rol, upload cu versiune peste maximul dintre rând și toate obiectele listate (toate rolurile, legacy, orfane). Listarea continuă până la pagina goală; upload `upsert:false`, retry numai la coliziune. Scans și PV B/C își păstrează forma anterioară. `src/redari/ui/ModalPv.jsx:207` transmite rolul din sursa DOCX și calea curentă; patch-ul verifică noua cale înainte de legare.
- **DRY:62,137:** 18 cazuri de cale, expected literal, aceleași date citite în Vitest. DRY face INSERT/PATCH efective ca editor non-owner authenticated, fiecare fixture anulat. Cazuri: generare inițială, v+1 după rol schimbat, reetichetare P, revenire cu rol corect, reutilizare Q, versiune egală, rol greșit, zero/zero inițial/overflow, sufix/linie nouă, alt proiect/UAT/număr, legacy cu prag păstrat și regenerare obligatorie.
- **DRY:247–303:** secvența exactă P proprietar → Q arendaș → P cu etichetă arendaș este refuzată. Revenirea la P și cu rolul potrivit este refuzată de monotonicitate; după v3, Q v2 nu se poate reutiliza. Fluxul normal rol schimbat → regenerare v+1 → semnare trece în scenariul pregătit. Motivele refuzurilor sunt verificate exact.
- Amprenta triggerului a fost recalculată identic în postcondiția migrării și preflight-ul rollback-ului. Baseline-ul anterior și garda legacy nu au fost relaxate.

Validări executate: **`npx vitest run`: 3.920 trecute, 22 sărite; 162 fișiere trecute / 3 sărite. `npx vite build`: reușit**, avertismente existente de bundle/importuri mixte. 47 teste PR1, inclusiv cele 18 cazuri comune de cale și upload peste orfani/legacy/roluri/cale curentă; regresiile PV rulate. SQL și PL/pgSQL trec parsarea; `git diff --check` curat.

**Neexecutat:** DRY PostgreSQL, PostgREST/RLS/ACL/concurență. Limitările L15 din prima rundă rămân deschise; parsarea nu este declarată test runtime SQL.

| Regulă | Dovadă în runda 4 |
|---|---|
| L01 | M:247 — rolul și calea verificate după lock parcelă → deținător; CAS pe calea/versiunea curentă păstrat în ModalPv. |
| L02 | Calea și rolul documentului sunt verificate/scrise atomic în același UPDATE + trigger. |
| L03 | M:266–290 — document vechi/cale veche nu se reetichetează; rolul sursei și versiunea sunt precondiții. |
| L04 | n/a |
| L05 | pv.js:372 — fișierul se păstrează la erori ambigue; fără retry automat pe timeout/5xx. |
| L06 | Ordinea lock-urilor existentă este păstrată, fără lock pe alte PV-uri. |
| L07 | M:266 — validare server pe PATCH direct și semnare; refuz P → Q → P. |
| L08 | Rolul se citește din deținătorul blocat; eticheta clientului nu îl poate înlocui. |
| L09 | M:258 — cale verificată față de proiectul/UAT-ul/numărul PV-ului. |
| L10 | n/a |
| L11 | n/a |
| L12 | n/a |
| L13 | pv.js:8 / M:267 — regex constant ancorat, reconstrucție exactă, 18 cazuri pozitive/negative comune. |
| L14 | Migrare încă neaplicată; rollback și postcondiții păstrate, fără obiecte SQL noi. |
| L15 | Corp trigger nou amprentat în apply/rollback; baseline-ul rămâne. Validarea catalogului real/mutanților rămâne deschisă. |
| L16 | Calea canonică completă include proiect/UAT/nr/versiune/rol; upload imutabil și versiune strict crescătoare pe PV. |
| L17 | Versiunea este întreg limitat la 9 cifre, fără overflow/reparsare ambiguă. |
| L18 | Cale invalidă, listare incompletă sau versiune curentă necunoscută = refuz explicit. |
| L19 | Parser și validator comun în client; SQL oglindit pe același tabel independent de 18 cazuri. |
| L20 | DRY și JS: refuz reetichetare/reutilizare/rol greșit; flux normal și regenerare legacy pregătite. |
| L21 | n/a |
| L22 | n/a |
| L23 | pv.js:355 — listare până la pagina goală, toate rolurile/orfanii/legacy intră în maxim. |
| L24 | ModalPv:207 — tokenul de generație transmis și verificat în upload/listare, CAS și recitirile păstrate. |
| L25 | Expected literal în tabelul comun; test upload cu răspunsuri Storage realiste; DRY sub authenticated pregătit, neexecutat. |
