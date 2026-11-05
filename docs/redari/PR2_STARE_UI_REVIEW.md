# PR2 — stare și UI pentru utilizatori / arendași (juridic#040)

Branch: `codex/redari-pr2-stare-ui`, pornit din `9966d45adf5eec61a8b3e777bf497e5da1e9e976` al `codex/redari-pr1-regula-pv` (PR #998, deschis). PR DRAFT către **codex/redari-pr1-regula-pv**, fără merge. Deciziile Răzvan din claude_context #1920 sunt baza regulii. Numai fișiere; fără acces Supabase, aplicare de migrări sau date reale.

## Regula și comportamentul

Un PV A activ semnat de utilizator/arendaș acoperă parcela prin helperul PR1 `fn_red_parcela_acoperita_a`; semnătura folosește `calitate_semnatar` istorică. În lipsa lui, helperul cere PV A pentru toți deținătorii activi de pe partea proprietarului. Răspunsul la convocare, draftul și trimiterea spre semnare nu sunt semnătură.

În `red_v_stare_parcela`, semnatarul propriu păstrează `PV_A_SEMNAT`; ceilalți deținători ai parcelei acoperite primesc **PV_A_ACOPERIT_PARCELA** („Acoperit prin PV A pe parcelă”), inclusiv peste un PV B generat anterior. Ambele stări A au rangul 1; rangurile celor 12 stări existente rămân neschimbate. JS primește acoperirea calculată, fără să inventeze rolul istoric din calitatea curentă.

Q5: `red_v_centralizator_uat`, Dashboard, Notificări și XLSX numără parcela o singură dată. Fără acoperire A/B, centralizatorul păstrează starea cea mai puțin avansată dintre deținători. Registrul și statisticile de comunicare păstrează perechile individuale; unitățile sunt explicite. Notificările includ numărul și procentul parcelelor închise. Starea întregii parcele se calculează înaintea filtrelor: ascunderea unui coproprietar nesemnat nu închide parcela, inclusiv când semnatarul istoric proprietar a devenit ulterior utilizator.

Fișa are grup separat „Utilizatori / arendași”, cu aceleași acțiuni/contacte și istoric șters. Filtrul Toți / Proprietari / Utilizatori-arendași este comun pentru Registru, Notificări și exportul XLSX; Proprietari include coproprietari, moștenitori și neidentificați. În Registru și citirea deținătorilor pentru export filtrul este aplicat înaintea paginării. Pentru statisticile filtrate se citesc complet stările parcelei, fără nume/contacte, astfel încât un filtru să nu schimbe acoperirea juridică. Un plic cu două convocatoare rămâne permis; gruparea plicurilor nu este modificată.

## Fișiere

- `supabase/migrations/20261131d_redari_stare_utilizatori.sql` (**M**) — două vederi `security_invoker=on`, fără coloane noi. Cele 20 coloane din starea parcelei și cele 8 din centralizator rămân în aceeași ordine, cu aceleași tipuri, owner și ACL. Gardă `gazpet.livrare_migrare` + txid, refuz de armare persistentă, lock-uri, baseline și postcondiții. Runnerul trebuie să dețină o singură tranzacție (`psql --single-transaction`), cu armarea în aceeași tranzacție.
- `supabase/revenire/20261131d_redari_stare_utilizatori_ROLLBACK.sql` (**R**) — restaurează definițiile și comentariile anterioare sub aceleași verificări/lock-uri. Nu elimină coloane, date, istoric, configurații sau obiecte PR1. Manifestele și verificatorul sunt temporare; revenirea le elimină.
- `supabase/tests/20261131d_redari_stare_utilizatori_dryrun.sql` (**D**) — tranzacție anulată, apply → rollback → re-apply, mutanți L15, 17 cazuri comune SQL/JS, editor/viewer/refuz cu claims și `SET LOCAL ROLE authenticated`, revenire cu păstrarea istoricului/datele fictive.
- `src/redari/stare.js` — stare nouă, stări finale comune, agregare pe parcelă și păstrarea stării întregii parcele înaintea filtrelor.
- `src/redari/rol.js`, `src/redari/ui/FiltruRol.jsx` — roluri canonice, predicat existent PR1 pentru utilizatori, selector accesibil comun.
- `src/Redari.jsx` — rol în ambele citiri ale Registrului, reset pagină/selecție și invalidare export la schimbare.
- `src/redari/notificari.js`, `src/redari/ui/NotificariEcran.jsx` — închidere/procent pe parcele și filtre/export după rol.
- `src/redari/ui/FisaParcela.jsx` — grupurile de persoane, fără modificarea fluxurilor PV sau de scriere.
- `src/redari/sesiune.js`, `src/redari/ui/DashboardEcran.jsx` — noua stare finală și unitate „parcele”.
- `src/redari/exportXlsx.js`, `src/redari/ui/ExportEcran.jsx` — rol, centralizator pe parcele, verificarea distribuțiilor și a mulțimii exacte de perechi/calități; refuz dacă sursele s-au schimbat între citiri.
- `src/redari/stareUtilizatori.test.js`, `src/redari/ui/rolUtilizatoriRender.test.jsx` — 38 teste noi de paritate, filtre, XLSX, incompletitudine și randare. `src/redari/__tests__/stare.test.js`, `src/redari/exportXlsx.test.js`, `src/redari/notificari.test.js` — expected actualizat pentru noua stare/unitate, cu regresiile existente păstrate.
- Acest raport.

## DRY pregătit, neexecutat

Cele 17 cazuri: utilizator acoperă; arendaș acoperă; semnătură proprie; coproprietari parțial; toți proprietarii semnați/utilizator absent; utilizator generat; trimis; anulat; răspuns fără semnătură; rol schimbat după semnare; proprietar devenit utilizator; semnatar utilizator șters logic; numai utilizator nesemnat; proprietar unic semnat; PV B; PV B anulat; acoperire A peste B vechi.

Expected independent: **33 perechi, 17 parcele, 9 închise, 52,9%**. Verificări ca editor non-owner, viewer fără contacte și cont fără modul. Niciun nume, telefon sau adresă reală.

Mutanți pregătiți cu refuzul exact: corp `fn_red_adresa_cunoscuta`, `fn_red_nivel`, `auth.uid` (lanț de 2–3 niveluri), ACL helper, trigger dezactivat și politică SELECT suplimentară permisivă. Fiecare mutație se anulează într-o subtranzacție; calea legitimă este verificată după restaurare. Baseline-ul este fixat din migrările versionate: 32 funcții, metadate/ACL, 156 coloane pe 7 tabele sursă, 33 triggere, 21 politici și secvența răspunsurilor. Nu se acceptă automat amprenta catalogului live și nu se fac verificări prin regex pe text SQL.

## Validare executată

- `npx vitest run`: **164 fișiere trecute / 3 sărite; 3.938 teste trecute / 22 sărite**. Toate cele 38 teste noi au trecut. Skip-urile sunt cele condiționate de mediul suitelor existente (inclusiv jsdom/fixture OCR).
- `npx vite build`: **reușit**, avertismente existente de bundle mare/importuri mixte.
- `pglast 8.7`: parsare SQL și PL/pgSQL reușită pentru M, R și D (inclusiv verificatorul și mutanții). Nu dovedește rezoluția coloanelor, ACL/RLS sau execuția.
- `git diff --check`: curat. Fișierele interzise nu au diferențe față de baza PR1.

## Ce rămâne

SQL **nu a fost executat sau aplicat**, conform cererii. Pe o clonă izolată PostgreSQL 16 cu schema/rolurile reale și PR1 aplicat trebuie executate D, verificările L15 în catalog, mutanții și regresiile SQL existente; apoi verificarea prin PostgREST a noii proiecții și smoke UI pe fluxul real. Nu se declară RLS/ACL, apply/rollback/re-apply, mutanții sau concurența ca trecute. Baseline-ul fix trebuie verificat la review față de catalog, fără înlocuire automată cu valori live. Nu se certifică aici catalogul întregii aplicații sau tabelele indirecte din celelalte fluxuri plic/mail.

PV B pentru utilizatori, inclusiv secțiunea documentului/modalului, rămâne separat după merge-ul #998, conform cererii explicite. PR3 (convocator/poartă/aviz) și PR4 (import) rămân separate. `pv.js`, `ModalPv.jsx`, migrările `20261130n` / `20261131a` / `20261131c`, SalariiPage și celelalte module nu sunt modificate.

## L01–L25

| Regulă | Respectare / dovadă |
|---|---|
| L01 | M:16 — lock înaintea verificărilor catalogului; fără RPC sau scriere business nouă. |
| L02 | M:2 — un singur transaction runner; ambele vederi și postcondițiile în aceeași tranzacție. D:4 — BEGIN, D:211 — ROLLBACK. |
| L03 | `ui/ExportEcran.jsx:94` — compară distribuțiile/mulțimea perechilor și calitatea; teste pentru surse schimbate. Fără scriere de derivat server-side. |
| L04 | n/a |
| L05 | n/a |
| L06 | M:14 — aceeași ordine DDL în M și R, timeout local; nicio cale nouă de lock business. Concurența neexecutată. |
| L07 | M:453,502 — `security_invoker=on`; M:599 — owner/ACL/coloane păstrate. D — viewer și cont fără acces, pregătite, neexecutate. |
| L08 | Nicio identitate/GUC de autorizare nouă în producție; helperii PR1 și `fn_red_nivel` rămân sursa. Claims simulate exclusiv în D. |
| L09 | D — editor/viewer non-owner și identitate fără intrare `redari`; accesul existent nu este extins. SQL neexecutat. |
| L10 | n/a — nu există secrete noi; toate fixture-urile sunt fictive, fără PII reală. |
| L11 | n/a |
| L12 | `ui/ExportEcran.jsx:94` — perechi/distribuții complete sau eroare, fără export parțial; regresii XLSX. |
| L13 | n/a — fără parser/regex nou în producție. Parsarea SQL este verificată cu parser PostgreSQL. |
| L14 | M/R — tranzacția runnerului, gardă txid, preflight/postcondiții, CREATE OR REPLACE fără DML; D — ciclul și păstrarea istoricului după revenire, neexecutate. Refuzul la date noi nu este necesar unei reveniri care nu elimină date/schema de stocare. |
| L15 | M:21,87,245,254,290 — allow-list de corpuri/callees, metadata, ACL, coloane/secvență, RLS/FORCE, toate politicile și triggerele surselor directe. D:13 — mutanți 2–3 niveluri și refuzuri exacte, pregătiți, neexecutați. Limitele catalogului sunt precizate mai sus. |
| L16 | n/a — fără cheie sau constrângere de unicitate nouă. Q5 grupează după `parcela_id`, nu după nume/persoană. |
| L17 | n/a — fără parsare numerică/timp nouă; helperii existenți București păstrați. |
| L18 | `stare.js:130`, `rol.js:13`, `ui/ExportEcran.jsx:94` — stare/rol necunoscut și surse incomplete refuzate; flag A acceptat doar boolean true. Teste negative inclusiv liste goale cu rol invalid. |
| L19 | M:486 — helperul SQL PR1; `stare.js:129` — stări finale comune; `rol.js` — rol comun și clasificatorul PR1; `stareUtilizatori.test.js` — 17 cazuri juridice comune D/JS și regresia filtrelor. |
| L20 | `stareUtilizatori.test.js` — semnat/generat/trimis/anulat, răspuns fără semnătură, rol istoric, B vechi, incomplete; D verifică și calea legitimă după mutanți. SQL neexecutat. |
| L21 | n/a |
| L22 | n/a |
| L23 | `Redari.jsx:246,273` — rol înainte de range; `ui/ExportEcran.jsx` — keyset până la gol și citire completă pentru acoperirea pe parcelă; testele de paginare existente trec. |
| L24 | `Redari.jsx:300` — rol în dependențe/reseturi și invalidarea generației exportului; `ui/ExportEcran.jsx:143` — rol blocat pe durata exportului, tokenul de generație/proiect păstrat. |
| L25 | 38 teste noi cu expected literal, XLSX și markup efectiv; D cu FK/CHECK reale, claims + SET LOCAL ROLE authenticated, non-owner și motive exacte. Testele JS și parserul au rulat; execuția PostgreSQL/PostgREST rămâne neefectuată. |
