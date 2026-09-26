# Matrice de acoperire — audit Ofertare (25.09.2026; rândurile R4–R7 actualizate 26.09.2026)

Sursa: `AUDIT_DOCUMENTATIE_OFERTARE_2026-09-25.md` (verdict curent sus) + `VALCELELE_95_INFO_OFERTARE_2026-09-25.md`. Cod verificat pe `main` @ `70a31bc` (#474).
R1 rapoarte · R2 test C2 · R3 stări citire · R4 reluare persistentă · R5 cantități 470 · R6 integritate documente · R7 Vâlcelele financiar · R8 clarificarea #63.

| Constatare | R | Stare | Dovadă | Ce mai lipsește |
|---|---|---|---|---|
| T1 siglă EasySign | R3 | parțial | #473; `OfertareLicitatii.jsx:1112`; `ofertare-plansa-citeste/handler.ts:668-675` | detecție după conținut (nu doar <2000 px); recitire 472–474 (cost, confirmare); listă rezultate istorice afectate |
| T2 PL5 gol | R8 | deschis | 471 `tronsoane_gasite=0`; clarificare #63 | v2 clarificare; verificare umană |
| T3 status `partial` | R3 | remediat în cod | `handler.ts:681-682` (#474) | date vechi (470 tot `procesat`) |
| T4 reluare felie | R4 | remediat în cod | `handler.ts:492-504`; UI 1039-1047 | rulare reală pe 470 z3_1: neverificat |
| T5 1370 m dublat | R5 | parțial (avertisment); reconcilierea pe surse în `R5_RECONCILIERE_470_V2.md` (rev. 6), propunere fără aplicare | `handler.ts:588-591` | verificarea Oanei pe imagine; #63; aprobarea umană |
| T6 rânduri repetate | R5 | remediat în cod **pe ramură** (identitatea rândului, `claude/r4-rezervare-zone` @ `7a7bf86`), nedeployat; reverificarea rundei 9: 2 majore pe rândurile TOTAL | `handler.ts:596` (main); ramura: `identificaRanduri` l.457 | fixul majorelor + reverificare; merge + deploy (GO); recitirea 470 (GO separat) |
| T7 Dn 43/60 | R5 | deschis | `handler.ts:581-587` | mapare De OL→DN; 43/60 păstrate brute |
| T8 material | R5 | parțial | `handler.ts:597` | material doar din legendă demonstrată |
| T9 total 470 | R5 | NEVALIDAT (48.905 m pe tabel, 133 de rânduri; BD 48.195) | `R5_RECONCILIERE_470_V2.md` §2–§3 | cele 6 criterii R5; totalul derivat din rândurile reconciliate, nu ajustat spre 44.355 |
| T10 | — | VERIFICAT | — | — |
| T11 proveniență | R4 | parțial | `handler.ts:33, 544, 660-665` | rând tabel, coordonate PDF; citirile din BD au `versiune=null` |
| T12 hash/seap_cod | R6 | **ÎNCHIS tehnic** (26.09) | manifest SEAP verificat pe 878 fișiere (`verifica_manifest.ts`, #482); cron săptămânal în worker (#484) | reconcilierea înaintea înghețării pachetului final |
| T13 Huedin RAR | R6 (doar trasabilitate) | **RETRAS** | 233 fișiere în BD, replay 233/233 CRC (`registru_automatizari`) | nimic ca „lipsă”; manifest retroactiv 101/102 |
| T14 Huedin rutare | R6 | 770 citit de worker pe felii (#485): **PARȚIAL** — 215 pagini cu text + 499 fără text (714) | SELECT 26.09: `partial`, `analiza.citire_mare`; coada 101 închisă, 14 `partial` | triere vizuală după cuprins / tip de pagină ÎNAINTE de orice OCR (~2,5 USD, aprobare separată); paginile relevante neverificate blochează controlul aplicabil; reclasificarea 745/750 nereverificată |
| T15 90 Ibănești | R6 | deschis (valabil) | 340–342 `ignorat` neaduse | upload manual |
| T15 102 Botoșani | R6 | lipsa PT **RETRASĂ**; restul NETESTAT | 485 fișiere, 483 `procesat` | 772/1247 `partial`, 1035/1113/1169 `neprocesat` |
| T16 .doc | — | VERIFICAT | — | LibreOffice→PDF (opțional) |
| T17 blocate vechi | R6 | deschis | 262, 271 | curățenie cu confirmare |
| F1 F3 lipsă | R7/R8 | deschis | VALCELELE §1 | confirmare SEAP ⇒ clarificare |
| F2 clauze | R7 | citat VERIFICAT / interpretare NETESTAT | — | citat→interpretare→scenariu→decizie |
| F3 GBE | R7 | deschis | VALCELELE §2 | câmp rol; termen 5 zile de confirmat |
| F4 plată/ajustare/Etapa 2 | R7 | NETESTAT | VALCELELE §3 | scenarii Etapa 2 |
| F5 garanție participare | R7 | valabilitatea în luni, fără 90 de zile implicit (#487, main); propagarea termenului **pe ramură** (`claude/r7-propagare-garantie` @ `80d618f`, 81/81 vitest) | `ofertareGarantieValabilitate.js`; R7 fișa pct. 2 | decizia 2 (Razvan); merge + test LIVE |
| F6 formulare 481 | R7 | deschis | registru = 0 | rulare `ce='formulare'` (cost) + reconciliere FD/CS |
| F7 | — | VERIFICAT | — | — |
| C1 cost | — | VERIFICAT | — | — |
| C2 poarta server | R2 | implementat + teste locale trecute (26/26, `deno test`, deps simulate) | `plansa-citeste/handler.ts:427-460`; `cantitati-extrage/handler.ts:201-235`; `poarta.ts` (copie identică, verificată în CI) | deschis: test integrat cu utilizator fără drepturi (cere GO Razvan); verificarea sursei publicate LIVE (`get_edge_function`) după deploy |
| C3 reluare/2 taburi | R4 | parțial | `mod='continua'` `handler.ts:495-504` | blocare optimistă; coadă persistentă |
| C4 coadă server | R4 | deschis | UI secvențial | worker/coadă existentă |

Notă (25.09.2026): în `ofertare-plansa-citeste` codul s-a mutat din `index.ts` în `handler.ts` (index.ts = doar `Deno.serve`); numerele de linie de mai sus sunt în `handler.ts`, neschimbate. `dry_run` (cantitati-extrage) nu e folosit de UI; dacă va fi expus în UI, avertismentul „previzualizare plătită” trebuie afișat ÎNAINTE de pornire.

## Verdict final (Copilot, 25.09.2026; R4–R7 după verdictele din 25.09 seara și 26.09 dimineața) — stare pe restanțe nominale
Rândurile C3 / C4 de mai sus sunt actualizate pe ramura `claude/r4-rezervare-zone` (și în `claude/cantitati-nevalidate-consumatori`, care o conține); aici au rămas ca la 25.09, ca să nu apară conflict la merge. Starea curentă a lui R4 e în tabelul de mai jos și în `RESTANTE_AUDIT_OFERTARE.md`.

| R | Verdict | Restanță (detaliu în `RESTANTE_AUDIT_OFERTARE.md`) |
|---|---|---|
| R1 rapoarte | **ÎNCHIS** | — |
| R2 poarta server (C2) | **ÎNCHIS pe endpointurile testate** | avertisment „previzualizare plătită” ÎNAINTE de apel (UI nu folosește `dry_run`) — tichet UX |
| R3 stări citire | PARȚIAL | 472 în lucru + review manual al rezultatelor istorice |
| R4 reluare | PARȚIAL (perimetru acceptat) — atomicitatea aplicată (#481), nu se redeschide | rezervarea pe zonă pe ramură (`7a7bf86`), nedeployată; coada independentă de browser = design + migrare propusă, neaplicată |
| R5 cantități 470 | **DESCHIS** (0 / 6 criterii închise; R5 v2 rev. 6) | protecția consumatorilor pe ramură (`6313184`, condițiile Copilot 1–2 tratate), migrări neaplicate; deduplicarea pe ramură (`7a7bf86`), **reverificarea rundei 9: 2 majore** (TOTAL-a / TOTAL-b); verificarea Oanei; #63; aprobarea umană; propagarea; marcajul pasului B nealiniat între SQL și cod |
| R6 integritate documente | **ÎNCHIS tehnic** (26.09) | 770 = citire PARȚIALĂ (215 + 499 = 714): triere vizuală înaintea oricărui OCR (~2,5 USD, aprobare separată); paginile relevante neverificate blochează controlul aplicabil; „coada închisă curat” ≠ cele 14 parțiale citite integral; reconcilierea înaintea înghețării pachetului final |
| R7 Vâlcelele financiar | **DESCHIS** (structura fișei v3 acceptată; #487 corect) | deciziile nominale ale lui Razvan (lista 1–12 din fișă); verificarea umană a celor 35 de clauze (0 / 35); cl. 43 cu proveniență; utilizarea consecventă în ofertă; testul de propagare pe ramură (`80d618f`), nemergiuit; aprobarea fișei nu reaprobă clauzele |
| R8 clarificarea #63 | **redactare ÎNCHISĂ** + test regresie v5 trecut | trimitere / dovadă / răspuns AC |

**Test regresie v5 (R8)** — `ofertare_clarificare_planse_auto` v5, rulat în `DO` cu `RAISE EXCEPTION` (rollback forțat, fără efect permanent): 472 marcat temporar `citita_fara_date_cantitative` ⇒ funcția întoarce `actualizat` id 63, 5 planșe; #63 rămâne `de_trimis`, md5 text neschimbat (`429ce455…`), sursa devine `planse_auto:475,474,473,472,471`; nicio clarificare nouă (1 `auto_planse_%` pe 95). SELECT după: #63 (status, md5, sursa, updated_at) și 472 (md5 analiza `5397ca18…`, `partial`) identice cu înainte.
