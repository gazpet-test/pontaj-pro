# Remedieri documentație Ofertare — rezultate măsurate (25.09.2026)

Regula: doar ce e măsurat sau dovedit în cod. Restul = „neverificat”. Date din BD: SELECT read-only, 25.09.2026.
Separare: **cod** (mai jos) · **date reale**: nicio corecție aplicată (472–474 tot pe siglă, 470 tot `procesat`) · **apeluri AI**: doar PL1 (475) recitit · **decizii comerciale / clarificări**: #63 = propunere, netransmisă.

| PR / migrare | Ce s-a schimbat (dovadă) | Rezultat măsurat | Ce NU s-a verificat |
|---|---|---|---|
| #467 `1945a68` | pdf.js în loc de MuPDF (AGPL), `api/_randare-pdf.js`, clarificare automată ca propunere (migr. `..._planse_propunere.sql`) | PL1 (475) recitit pe randare vectorială: `latime=7017` (față de 900 pe siglă) | 472–474 nerecitite; calitatea randării pe alte planșe |
| #468 `19f67d5` | note tăiate între zone refăcute pe perechi stânga+dreapta (`index.ts:322-324`) | neverificat (fără număr de note recuperate salvat) | efect pe 470/471 |
| #469 `cf1aa43` | antet tabel propagat între zone (`index.ts:507-521`); Dn nestandard excluse (`581-587`) | neverificat pe o recitire 470 după fix | dispariția Dn43/48/56 din debit citit ca Dn |
| #470 `2fb027a` | perechi cu cifre utile primele, fără repetare (`index.ts:452-453`) | neverificat | — |
| #471 `2bdfe87` | lungime declarată doar cu unitate explicită; „54200mp” = necorelare (`index.ts:376-391`) | neverificat pe rulare (fixture PL5 din descriere) | rulare reală pe 471 |
| #472 `bb4ed78` | `paralel` 1..4, reîncercări 429/529/5xx, metrici (`index.ts:28-33, 123, 535-539, 652-658`) | PL1 (475), paralel 4: 5 runde, 48 s, 0 limitări, 0 reîncercări, 0,66 $, 0 tronsoane (plan topografic). 20 zone confirmate și în BD (`analiza.plansa.felii=20`, lățime 7017) | **nicio concluzie de viteză**: fără bază măsurată la paralel 2 |
| #473 `f70580e` | 403 non-owner/non-responsabil înainte de Storage/AI (`plansa-citeste:424-433`, `cantitati-extrage:196-205`); citirea pe siglă nu mai e „citită” (UI:1112) | cod citit: poarta e după `getUser` și înainte de `storage.list`/apel AI | test live 403 (R2); calea `x-radar-secret` neatinsă |
| #474 `70a31bc` | `mod='reia_erori'`/`continua` fără retăiere; `partial` când erori; `COD_VERSIUNE`; avertismente T5/T6/T8 | neverificat pe date (nicio rulare după #474 în BD: `versiune=null` pe toate) | reluare z3_1 pe 470; două taburi |
| migr. `20260925_ofertare_clarificare_planse_auto_v3` | textul editat de om nu mai e suprascris; fără F3 nu trimite la „F3” | neverificat în acest raport (aplicarea în BD și rezultatul pe #63) | `list_migrations` / conținut #63 |

## Restanțe
R2 test 403 · R3 detecție siglă după conținut + recitire 472–474 (cost, confirmare) · R4 coadă/2 taburi · R5 reconciliere 470 · R6 integritate · R7 financiar · R8 clarificare #63 v2.
