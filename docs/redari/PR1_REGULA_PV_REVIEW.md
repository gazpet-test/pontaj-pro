# PR1 — regula PV utilizatori / arendași (juridic#040)

Implementarea urmează deciziile Răzvan din 05.11.2026, claude_context #1920. PR #998 este publicat ca draft către `main`, fără merge sau aplicare SQL. Publicarea a fost autorizată explicit de Răzvan. Acest document păstrează rezultatele primei runde; pentru corecțiile și validările actuale vezi [raportul rundei 3](PR1_REGULA_PV_R3_REVIEW.md). În runda 2, snapshot-ul draftului urmărește rolul curent la fiecare scriere, inclusiv regenerare; după semnare rămâne înghețat.

Fișiere:

- `supabase/migrations/20261130n_redari_pv_utilizatori.sql` — următorul nume liber după `20261130m`; helper, calitatea semnatarului, trigger, cele trei căi SQL și preflight/postcondiții.
- `supabase/revenire/20261130n_redari_pv_utilizatori_ROLLBACK.sql` — restaurarea definițiilor din 20261129f; lock înainte de verificarea snapshot-urilor și istoricului, refuz dacă există date noi.
- `supabase/tests/20261130n_redari_pv_utilizatori_dryrun.sql` — tranzacție anulată, apply → rollback → re-apply, identități fictive, `request.jwt.claims` + `SET LOCAL ROLE authenticated`.
- `src/redari/pv.js`, `src/redari/ui/ModalPv.jsx` — regula comună în client, calitatea PV A, destinatari PV B separați.
- `src/redari/pvUtilizatori.test.js`, `src/redari/pv.test.js` — paritate și regresii; acest raport.

Regula SQL și JS:

Un PV A activ **semnat**, cu `calitate_semnatar IN ('utilizator','arendas')`, acoperă parcela integral: nu se mai creează/semnează PV B pentru coproprietarii absenți și `red_v_tronson.tip_pv='A'`. Altfel, minimum un deținător activ de pe partea proprietarului și PV A semnat pentru fiecare dintre aceștia înseamnă acoperire A. Coproprietarii fără PV A rămân în PV B când nu există acoperire prin utilizator. Zero deținători sau numai utilizatori fără semnătură permit PV B. Răspunsul la convocare, un draft sau trimiterea spre semnare nu reprezintă semnătură.

`fn_red_parcela_acoperita_a` este apelată din creare B, triggerul de semnare și vedere. Triggerul verifică și INSERT direct. Vederea folosește `security_invoker=on`, aceleași 11 coloane în aceeași ordine; postcondiția compară owner/ACL inclusiv ACL pe coloane. Calitatea este impusă de server la INSERT, recitită sub lock la semnare și apoi imutabilă; schimbarea ulterioară a deținătorului nu rescrie PV semnat. JS citește calitatea istorică din PV, fără fallback la rolul actual pentru acoperirea prin utilizator. PV B separă proprietarii de utilizatori/arendași prin două secțiuni în câmpul multiline existent `nume`, păstrând contractul celor 72 de chei DOCX.

Cazuri DRY pregătite (nu executate pe BD):

- Proprietar unic semnat; coproprietari parțial semnați; coproprietari + utilizator sau arendaș semnat; toți proprietarii semnați + utilizator absent.
- Numai utilizator fără semnătură; trimis spre semnare; anulat; utilizator/arendaș semnat; zero deținători; proprietar nesemnat.
- Utilizator devenit proprietar după semnare; proprietar devenit utilizator; PV șters; deținător șters. Aceste 16 intrări sunt citite și de Vitest, cu rezultate așteptate literale independente de implementare.
- PV B generat înainte de PV A al utilizatorului: semnarea B este refuzată ulterior, anularea rămâne permisă. Calitatea este recitită la semnare și înghețată după schimbarea deținătorului; PATCH al snapshot-ului refuzat; `remediat_la` permis.
- INSERT B direct refuzat pe parcelă acoperită; editor non-owner acceptat; identitate fără acces la modul refuzată și fără vizibilitate în vedere.

Validări executate:

- `npx vitest run`: **162 fișiere trecute, 3 sărite; 3.895 teste trecute, 22 sărite**. Skip-urile sunt condiționate de mediul suitelor existente, inclusiv lipsa jsdom. Cele 22 teste noi PR1 au trecut.
- `npx vite build`: **reușit**; avertisment de bundle >500 kB.
- Parser PostgreSQL `pglast`: cele trei fișiere trec parsarea SQL și a corpurilor PL/pgSQL. Parsarea nu verifică existența tabelelor/coloanelor, RLS, ACL sau comportamentul concurent.
- `git diff --check`: curat.

Deschis înainte de aplicare:

1. SQL nu a fost executat, conform cererii „nu aplica migrări, doar fișierele”. De rulat DRY pe clonă izolată cu schema/rolurile reale, inclusiv ciclul apply/rollback/re-apply și regresiile SQL anterioare. Nu sunt declarate teste SQL sau de concurență trecute.
2. Preflight-ul folosește corpuri exacte din migrările versionate, ACL/config cunoscute și baseline-ul auth din 30g/30j. Abaterile din catalogul real trebuie revizuite; nu se înlocuiesc automat amprentele cu valorile live. Verificarea L15 completă a ACL pe toate sursele tranzitive/coloane/secvențe și testele cu mutanți pe 2–3 niveluri rămân de validat pe PostgreSQL.
3. Migrarea **refuză dacă există PV A deja semnate**, inclusiv șterse logic: rolul istoric nu poate fi inventat din rolul actual. E necesară o cale de backfill istoric revizuită înainte de aplicare într-o asemenea bază. Aplicarea nu face DML pe date business. PV A legacy nesemnate primesc snapshot la semnare.
4. Query-ul cu noua coloană din ModalPv trebuie verificat prin PostgREST după aplicarea aprobată a SQL. PR2–PR4 și avizul juridic al modelului rămân în planul lor. Nu s-au modificat SalariiPage, alte module, migrări vechi sau date reale.

Reguli L01–L25 (implementare și limitele verificării):

| Regulă | Dovadă / rezultat |
|---|---|
| L01 | Migrare:239, 276, 206 — lock pe parcelă înainte de acoperire; snapshot sub lock deținător. ModalPv păstrează CAS și verificarea rowcount. Concurența nu a fost rulată. |
| L02 | Migrare:239 — creare, contor și INSERT în același RPC; snapshot în trigger în aceeași tranzacție. |
| L03 | ModalPv:194 — se păstrează recitirea surselor înainte/după generare și CAS la legarea fișierului. |
| L04 | n/a — nu se introduce flux nou de cantități/bani/mail; unicitatea existentă PV rămâne. |
| L05 | ModalPv:128 — reconcilierea creării ambigue și păstrarea scanului/fișierului la rezultat neconfirmat rămân. |
| L06 | Migrare:13, 206, 239, 276 — ordinea lock-urilor documentată; aceeași parcelă ca în 20261129f; fără lock pe alte PV-uri. Testul cu două sesiuni rămâne deschis. |
| L07 | Migrare:206, 276 — trigger de proveniență pe INSERT/UPDATE și gardă B pe INSERT/UPDATE stare; protecțiile existente de identitate/stare și RLS rămân. DRY include INSERT/PATCH direct. |
| L08 | Migrare:239 — auth.uid + fn_red_nivel pentru apelant; calitatea este citită server-side, nu din payload. Claims simulate numai în harness DRY. |
| L09 | Migrare:239 — se păstrează nivelul pe cheia exactă redari, relațiile deținător–parcelă–UAT–proiect; DRY:149 — non-owner fără modul refuzat. Accesul existent este la nivel de modul, nu proiect. |
| L10 | n/a — nu se introduc parole, secrete sau loguri PII; fixture-uri fictive. |
| L11 | n/a |
| L12 | n/a — fără extragere/import sau mecanism nou de completitudine. |
| L13 | n/a — fără parser/regex nou în codul de producție; extracția fixture-urilor din teste e verificată prin numărul de 16 cazuri. |
| L14 | Migrare:1, 13, 18, 309; revenire:1; DRY:1 — tranzacție unică a runnerului, garzi txid, preflight, postcondiții; rollback blochează înainte de verificare și refuză snapshot/istoric. Ciclul este scris, neexecutat. |
| L15 | Migrare:25, 37, 126, 149 — allow-list corp/config/owner/ACL pentru funcții și callees; vedere comparată canonic, fără regex; RLS/politici și inventar triggere; postcondiții owner/ACL/coloane. Limitările catalogului și testele cu mutanți sunt explicit deschise mai sus. |
| L16 | n/a — nu se schimbă chei/indexuri; red_pv_a_activ_uq și red_pv_b_activ_uq rămân. |
| L17 | Migrare:239 — numerotarea existentă și data Europe/Bucharest păstrate; comparațiile de date JS rămân calendaristice. |
| L18 | Migrare:276 — lipsa lock-ului vizibil refuzată, READ COMMITTED impus; pvsASemnate admite numai stare semnat/activ; clientul păstrează erorile citirilor. |
| L19 | Migrare:187 — un helper în toate cele trei căi SQL; pv.js:184 — oglindă comună tuturor gărzilor JS; pvUtilizatori.test.js — același tabel de 16 cazuri din DRY. Paritatea SQL efectivă așteaptă rularea DRY. |
| L20 | pvUtilizatori.test.js și DRY — succes, refuz, nesemnat/trimis/anulat/șters, rol schimbat, anulare B și remediere permise. JS trecut, DRY pregătit. |
| L21 | n/a |
| L22 | n/a |
| L23 | ModalPv:98 — noua coloană intră în citirea paginată existentă; toate PV A semnate se citesc, fără limită locală de 1.000. |
| L24 | ModalPv:104 — tokenul de generație, resetul la schimbarea entității și anularea rezultatelor vechi sunt păstrate. |
| L25 | pvUtilizatori.test.js:6 — expected literal din tabelul comun; DOCX real, regresii pv.test.js. DRY folosește schema existentă, FK/CHECK și SET LOCAL ROLE cu identități fictive. RLS/GRANT, două sesiuni și regresiile SQL nu au fost executate. |
