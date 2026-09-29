# J07 / P3 — poarta de aprobare și depunere pe server

Implementare exclusiv locală, conform `C:\Users\Public\spec_v2_j07.md`. Fără git, producție, secrete sau mailuri. **Migrarea nu este aplicată. Apply numai după Jilava 02.10, prin Claude.**

## Ce s-a schimbat

- `supabase/migrations/20261003a_ofertare_poarta_server_jakv2p3.sql`: funcții STABLE separate pentru cuprins, neverificate, capcane, goale, nescrise, F3–grafic (toleranță 0,1%), garanție structurată, relații grafic și sursa graficului; citirea rezultatelor text; agregatorul `ofertare_poarta_server(p_licitatie_id)`.
- Tabelul `ofertare_poarta_rezultate_text`: INSERT numai service_role; RLS pentru citirea autorizată; fără UPDATE/DELETE/TRUNCATE, inclusiv trigger append-only. Nu se modifică accesul utilizatorilor la module sau rolurile lor.
- RPC intern `ofertare_poarta_text_sursa`: un singur snapshot SQL pentru date și SHA-256. Hash-ul cuprinde toate capitolele, toate versiunile graficului (inclusiv UPDATE pe o versiune veche), textele cerințelor, identitatea pachetului curent și toate intrările controalelor text din view, inclusiv manifestul curent. Ordine canonică și fus UTC. Starea propus/aprobat/depus este normalizată pentru a evita invalidarea artificială la tranziție.
- Lipsă rezultat, hash diferit, parser diferit sau eroare de parser: `undetermined`, deci agregatorul și triggerele blochează. Versiunea curentă: `j07-text-v1`. Editarea sursei face rezultatele stale fără ștergere și fără rescrierea aprobărilor istorice.
- Integrare prin adăugarea unui bloc în funcțiile existente `fn_ofertare_pt_pachet_poarta_documentatie` și `fn_gate_depunere`. Se păstrează OID/ACL, triggerele, R5, R12, J02 și auditul J05. Garda refuză instalarea dacă lipsesc R5/J05 sau ancora diferă. Verificarea rulează la aprobare, pachet depus și licitație depusă; refuz `P0001` cu codurile controalelor. Un pachet vechi nu se aprobă folosind verificarea pachetului curent.
- `supabase/functions/ofertare-poarta-text/`: identitate și modul prin `_shared/poartaOfertare.ts`, înainte de service_role. Body-ul furnizează numai ID-ul; datele/hash-ul sunt recitite din BD. Rezultatele celor patru controale se inserează împreună. Erorile parserului se persistă ca `undetermined`, fără `throw` de business.
- `_shared/ofertarePoartaText.mjs`: funcțiile H4/H5/H6/H9 extrase din `src/ofertareControale.js`, folosite identic de UI și Edge. Parsarea inițială a textului rămâne în `v_ofertare_pt_stare`, aceeași sursă ca UI; Edge evaluează datele extrase de view. Nu există un parser regex concurent în producție.
- UI păstrează controalele locale și adaugă rândul serverului. RPC lipsă/invalid = block. Recalcularea textului are loc la încărcarea panoului, semnare și după scrierea manifestului, înainte de aprobare/depunere. Cardul licitației citește verdictul serverului.
- H1 este `BUSINESS_DECISION_REQUIRED`, fără blocaj, exclus din controalele verzi ale serverului. În UI rămâne rezervă, inclusiv când nu sunt identificate nume străine.
- La depunerea licitației, existența unui pachet vechi depus nu permite folosirea verificării unui draft mai nou. Se refuză explicit nepotrivirea versiunilor; lipsa oricărui pachet depus rămâne verificarea J02 cu derogarea sa istorică.
- Harness PG16: `scripts/pg/test_jakv2p3_poarta_server.mjs`, fixture-uri în `scripts/pg/fixtures/` și `test-fixtures/jakv2p3/`. CI a primit pașii Node, Deno și PG16; **CI nu a fost rulat aici**.

## Derogări și rollback

**Niciun control J07 nu este derogabil.** Flag-ul owner nu sare peste J07 și nici peste R5. Rămân derogabile numai verificările din blocul istoric condiționat de `NOT derogare_depunere` al depunerii: pachet depus/cerințe active (J02), confirmare, acoperire și verificarea dovezilor. Auditul J05 rămâne tranzacțional: dacă J07 refuză, și inserțiile de audit din acea comandă se anulează. Completitudinea documentației la aprobare rămâne obligatorie.

WARN-urile existente nu devin reguli BLOCK noi: de exemplu, grafic fără date declarate sau H6 cu surse contradictorii păstrează avertismentul UI. În rezultatul text persistat, verdictul UI original se păstrează în `detalii`. J07 transportă regulile BLOCK; `ok` al agregatorului J07 nu înlocuiește evaluarea R5/R12 sau avertismentele UI.

Fișierul `_ROLLBACK.sql` elimină strict blocurile J07 din cele două funcții și retrage RPC-ul UI. Păstrează tabelul și istoricul, fără DROP sau pierdere de date; poate fi reaplicat. UI trebuie retras odată cu rollback-ul SQL, altfel va afișa corect „control server indisponibil”. Migrarea și rollback-ul sunt tranzacționale.

## Verificări executate

- Node J07: **7/7 PASS**, paritate UI–Edge, versiunea parserului SQL/Edge, fiecare control text ok/block, parser indisponibil, verdict server invalid și H1.
- Node R5/R9b: **9/9 PASS** (`node --test --test-isolation=none scripts/test-r5-r9b.mjs`).
- Cele șase suite Vitest relevante: **292 teste PASS** (`ofertareControale`, `ofertarePoarta`, `graficRelatii`, `ofertareCantitatiAprobare`, `ofertareSarcina2`, `ofertareRunda2`). Fixture-urile porții includ acum răspunsul serverului și rezerva H1.
- `deno check --node-modules-dir=none supabase/functions/ofertare-poarta-text/index.ts`: **PASS**.
- Cele 4 teste ale handlerului și 19 teste ale porții de rol: **23 callbacks PASS sub Node**, cu adaptor minimal pentru `Deno.test`/`Deno.readTextFile`. Acesta NU este un rezultat al harness-ului Deno.
- Sintaxa JSX a ambelor ecrane modificate, prin Babel: **PASS**. Sintaxa JS a harness-ului PG: **PASS**.

Vitest standard nu pornește în sandbox: esbuild primește `spawn EPERM`. Testele JS au rulat prin API-ul Vitest cu configurație numai în memorie: `configFile:false`, `esbuild:false`, `resolve.preserveSymlinks:true`, un worker threads. Rularea extinsă pe `src` a avut 813 teste trecute, 2 eșecuri în `service.test.js` (89 vs 90 zile și 0,9666 vs 1, cod neatins) și 5 suite necolectate din cauza transformării JSX/TS dezactivate. Nu declar suita completă trecută sau build-ul validat.

`deno test -A --node-modules-dir=none ...` a eșuat în runtime-ul Deno 2.9.7 la crearea pipe-ului Windows (`Unexpected client pipe failure`, handle invalid), înainte de rezultate. Adaptorul Node și `deno check` nu substituie testul Deno propriu-zis.

## Ce nu am putut valida

**SQL-ul nu a fost executat pe PostgreSQL 16:** nu există `PGURI` local configurat, iar `psql` nu este în PATH. Harness-ul refuză lipsa configurației și acceptă doar localhost, login postgres, bază goală `jakv2p3_test_*`; nu recreează baze. Fixture-ul și rolul temporar se retrag prin ROLLBACK.

Harness-ul implementat acoperă controale ok/block, rezultate lipsă/stale/parser vechi, invalidarea textului și graficului, agregare, ACL/RLS/append-only, fluxul complet cu triggerele fixture-ului active, regresii R5/R12/J02/J05, rollback exact, reaplicare și paritate pe date returnate de SQL. **Acoperire implementată ≠ teste PG trecute.**

Fixture-ul aplică migrările reale R5/R08/R09/R12/J02/J05 și matricea pachetului. Schema de bază este sintetică, extinsă din harness-ul R5. Unele migrări istorice H4/H5/H6/H9 din repo conțin doar descrieri, nu definiția live a view-ului; coloanele respective sunt reconstruite explicit în fixture. Nu pretind că reproduce toate obiectele din producție. Claude trebuie să verifice pe PG16 și pe calea PostgREST reală, cu definiția actuală a view-ului, înainte de apply.

Nu am creat PR draft: cererea „DOAR în acest director” și interdicția git păstrează livrarea locală. Titlu propus: **J07: verifică pe server controalele de aprobare și depunere PT**. Descriere: „Mută controalele P3 blocante în poarta serverului, leagă rezultatele text de hash și parser, păstrează R5/R12/J02/J05 și logica UI. H1 rămâne decizie de business. Migrare propusă după 02.10; PG16, Deno runtime și PostgREST încă de validat.”
