# Matrice de acoperire — audit Ofertare (25.09.2026)

Sursa: `AUDIT_DOCUMENTATIE_OFERTARE_2026-09-25.md` (verdict curent sus) + `VALCELELE_95_INFO_OFERTARE_2026-09-25.md`. Cod verificat pe `main` @ `70a31bc` (#474).
R1 rapoarte · R2 test C2 · R3 stări citire · R4 reluare persistentă · R5 cantități 470 · R6 integritate documente · R7 Vâlcelele financiar · R8 clarificarea #63.

| Constatare | R | Stare | Dovadă | Ce mai lipsește |
|---|---|---|---|---|
| T1 siglă EasySign | R3 | parțial | #473; `OfertareLicitatii.jsx:1112`; `ofertare-plansa-citeste/handler.ts:668-675` | detecție după conținut (nu doar <2000 px); recitire 472–474 (cost, confirmare); listă rezultate istorice afectate |
| T2 PL5 gol | R8 | deschis | 471 `tronsoane_gasite=0`; clarificare #63 | v2 clarificare; verificare umană |
| T3 status `partial` | R3 | remediat în cod | `handler.ts:681-682` (#474) | date vechi (470 tot `procesat`) |
| T4 reluare felie | R4 | remediat în cod | `handler.ts:492-504`; UI 1039-1047 | rulare reală pe 470 z3_1: neverificat |
| T5 1370 m dublat | R5 | parțial (avertisment) | `handler.ts:588-591` | reconciliere pe surse, propunere fără aplicare |
| T6 rânduri repetate | R5 | parțial (avertisment) | `handler.ts:596` | verificare pe imagine; rând tabel salvat (R4) |
| T7 Dn 43/60 | R5 | deschis | `handler.ts:581-587` | mapare De OL→DN; 43/60 păstrate brute |
| T8 material | R5 | parțial | `handler.ts:597` | material doar din legendă demonstrată |
| T9 total 470 | R5 | NEVALIDAT | — | reconciliere cu memoriul |
| T10 | — | VERIFICAT | — | — |
| T11 proveniență | R4 | parțial | `handler.ts:33, 544, 660-665` | rând tabel, coordonate PDF; citirile din BD au `versiune=null` |
| T12 hash/seap_cod | R6 | deschis | nicio coloană hash; `seap_cod` NULL (95/101/102) | sha256 + cale + mărime pe rânduri, legătura arhivă→fișier |
| T13 Huedin RAR | R6 (doar trasabilitate) | **RETRAS** | 233 fișiere în BD, replay 233/233 CRC (`registru_automatizari`) | nimic ca „lipsă”; manifest retroactiv 101/102 |
| T14 Huedin rutare | R6 | deschis | 11 `alta` `partial`, 745/750 `ignorat`, 770 `in_lucru` | reclasificare 1 pag.+mare ⇒ `plansa`; deblocare 770 |
| T15 90 Ibănești | R6 | deschis (valabil) | 340–342 `ignorat` neaduse | upload manual |
| T15 102 Botoșani | R6 | lipsa PT **RETRASĂ**; restul NETESTAT | 485 fișiere, 483 `procesat` | 772/1247 `partial`, 1035/1113/1169 `neprocesat` |
| T16 .doc | — | VERIFICAT | — | LibreOffice→PDF (opțional) |
| T17 blocate vechi | R6 | deschis | 262, 271 | curățenie cu confirmare |
| F1 F3 lipsă | R7/R8 | deschis | VALCELELE §1 | confirmare SEAP ⇒ clarificare |
| F2 clauze | R7 | citat VERIFICAT / interpretare NETESTAT | — | citat→interpretare→scenariu→decizie |
| F3 GBE | R7 | deschis | VALCELELE §2 | câmp rol; termen 5 zile de confirmat |
| F4 plată/ajustare/Etapa 2 | R7 | NETESTAT | VALCELELE §3 | scenarii Etapa 2 |
| F5 garanție participare | R7 | deschis (propunere) | VALCELELE §4 | aplicare cu confirmare; valabilitate |
| F6 formulare 481 | R7 | deschis | registru = 0 | rulare `ce='formulare'` (cost) + reconciliere FD/CS |
| F7 | — | VERIFICAT | — | — |
| C1 cost | — | VERIFICAT | — | — |
| C2 poarta server | R2 | implementat + teste locale trecute (26/26, `deno test`, deps simulate) | `plansa-citeste/handler.ts:427-460`; `cantitati-extrage/handler.ts:201-235`; `poarta.ts` (copie identică, verificată în CI) | deschis: test integrat cu utilizator fără drepturi (cere GO Razvan); verificarea sursei publicate LIVE (`get_edge_function`) după deploy |
| C3 reluare/2 taburi | R4 | parțial — remediat în cod (runda 3 + corecturi verificator, **nedeployat**): rezervare per (doc, zonă, tăiere) înainte de AI; „citește” de la zero nu cooperează; plafon `pana_la`; retăiere fail-closed | `concurenta.ts` `rezervaChei`/`rezActiva`/`REZERVARE_EXPIRA_MS`; `handler.ts` `planifica` + `rezervaChei`; `api/_cas.js` `verificaRetaiere`; teste `R4 rezervare:*`, `R4 reset:*`, `R4 plafon*`; suita `ofertare-plansa-citeste` **78/78** (capul ramurii, după `a800d38`; după `71b74e8` era 62/62), `-A supabase/functions/` 95/95, `concurenta_test.ts` 10×47/47, `test-cas-felii` 34/34, `test-detector-sigla` 23/23; agregarea tronsoanelor pe identitatea rândului (doc, pagină, tabel, Nr) — `R4_REZERVARE_ZONE_SI_COADA_NAS.md` §5 | deploy edge + Vercel; test LIVE cu 2 taburi pe o planșă mică (cost) — GO Razvan; reziduu: fereastra tăiere+upload |
| C4 coadă server | R4 | deschis — design + migrare propusă (neaplicată) | `docs/R4_REZERVARE_ZONE_SI_COADA_NAS.md` §3; `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql` | GO schemă + automatizare plătită; worker `plansa.ts` + UI (~1 zi) |

Notă (25.09.2026): în `ofertare-plansa-citeste` codul s-a mutat din `index.ts` în `handler.ts` (index.ts = doar `Deno.serve`); numerele de linie de mai sus sunt în `handler.ts`, neschimbate. `dry_run` (cantitati-extrage) nu e folosit de UI; dacă va fi expus în UI, avertismentul „previzualizare plătită” trebuie afișat ÎNAINTE de pornire.

## Verdict final (Copilot, 25.09.2026) — stare pe restanțe nominale

| R | Verdict | Restanță (detaliu în `RESTANTE_AUDIT_OFERTARE.md`) |
|---|---|---|
| R1 rapoarte | **ÎNCHIS** | — |
| R2 poarta server (C2) | **ÎNCHIS pe endpointurile testate** | avertisment „previzualizare plătită” ÎNAINTE de apel (UI nu folosește `dry_run`) — tichet UX |
| R3 stări citire | PARȚIAL | 472 în lucru + review manual al rezultatelor istorice |
| R4 reluare | PARȚIAL (perimetru acceptat) | reluare sigură doar cu browserul deschis; coadă persistentă / cost dublu între taburi = deschis |
| R5 cantități 470 | PARȚIAL | reconciliere z3_1, identitate tronsoane, etape + recalcul controlat |
| R6 integritate documente | PARȚIAL | acceptanță end-to-end pe traseu (edge, Vercel, Terra), backfill, cron, 770 fragmentare, 1035 adnotări CTGN |
| R7 Vâlcelele financiar | PARȚIAL | decizii comerciale + parametrizare |
| R8 clarificarea #63 | **redactare ÎNCHISĂ** + test regresie v5 trecut | trimitere / dovadă / răspuns AC |

**Test regresie v5 (R8)** — `ofertare_clarificare_planse_auto` v5, rulat în `DO` cu `RAISE EXCEPTION` (rollback forțat, fără efect permanent): 472 marcat temporar `citita_fara_date_cantitative` ⇒ funcția întoarce `actualizat` id 63, 5 planșe; #63 rămâne `de_trimis`, md5 text neschimbat (`429ce455…`), sursa devine `planse_auto:475,474,473,472,471`; nicio clarificare nouă (1 `auto_planse_%` pe 95). SELECT după: #63 (status, md5, sursa, updated_at) și 472 (md5 analiza `5397ca18…`, `partial`) identice cu înainte.
