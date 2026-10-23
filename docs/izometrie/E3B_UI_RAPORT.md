# E3b UI — 22.10.2026

## Fișiere noi

- `src/IzoCorectii.jsx`: Magazie → Corecții, proiect și filtre propuse/aplicate/respinse/retrase; serie/șarjă, propunător, dată, motiv, înainte/după. Aprobarea cere verificare; respingerea/retragerea cer motiv. Patru ochi inclusiv pentru owner, retragere doar de propunător.
- `src/IzoCorectieModal.jsx`: căutare după seria canonică în tabul Corecții, apoi propuneri carantină, pierdut, recuperare, identitate; găsit nou cu proiect explicit și bucată null. Verificare separată, blocante/avertismente și ținta efectivă înainte de trimitere. Corecția directă folosește exclusiv L minus L_ident și server_ver.
- `src/IzoDocumentIstoric.jsx`: istoric paginat, autor/dată/rezumat și diff detaliat; versiunea hash-ului confirmat; corecție PV cu versiunea documentului și lista corecțiilor PV.
- `src/izoCorectiiLogica.js`, `src/izoCorectiiUI.jsx`: drepturi din aceleași surse ca E3, liste de câmpuri, delta tipizată, paginare, componente inline G/S. Fișa bucății arată mișcările/evenimentele, motivul, NCR și diferențele față de document. Fără PV, operațiile de stare sunt dezactivate. SQLSTATE 40001 afișează conflictul și reîncarcă; formularul vechi se închide.
- `src/izoCorectiiLogica.test.js`: 10 teste pentru drepturi/valabilitate/depozit, patru ochi, geometrie și liste albe, delta, argumentele verificării, episoade de carantină, diferențe E3, mesaje/diff și paginare.

## Fiecare linie schimbată în fișiere existente

Numerotarea este cea finală din worktree; nu există alte schimbări în aceste fișiere.

| Fișier | Linie | Schimbare |
|---|---:|---|
| `src/Magazie.jsx` | 17 | Import nou `IzoCorectii`. |
| `src/Magazie.jsx` | 2293 | Lista taburilor externe: adaugă Corecții lângă Documente, sub aceeași condiție externE3. |
| `src/Magazie.jsx` | 2294 | Lista taburilor interne: adaugă Corecții lângă Documente. |
| `src/Magazie.jsx` | 2325 | Render nou pentru tabul corectii_izo. |
| `src/IzoDocumenteIntrare.jsx` | 16 | Import nou `IzoDocumentIstoric`. |
| `src/IzoDocumenteIntrare.jsx` | 769 | Render nou al istoricului/PV; primește ed.bd, eu, blocajele editorului și deschide pentru reîncărcare. |

Funcțiile E9 și `izoDocumenteLogica.js` / `izoDocumentePrefill.js` nu au fost modificate. Nicio modificare în Izometrie, stoc, backend sau schemă. Niciun apel la storno-ul postgres-only.

## Verificări și limite

- `npm install --offline --ignore-scripts --no-audit --no-fund --package-lock=false --cache .tmp/npm-cache` și `npx --no-install vite build`: oprite în sandbox de `uv_os_homedir ENOMEM`. Nicio conectare la rețea. Dependențele deja instalate din checkout-ul local au fost copiate în node_modules din acest worktree; fără schimbări de manifest/lockfile.
- Vitest 2.1.9 prin `startVitest('test', [cele trei fișiere], {watch:false,maxWorkers:1,minWorkers:1}, {css:{postcss:{}}})`: **114/114 trecute** — E3b 10, izoDocumenteLogica 94, izoDocumentePrefill 10.
- Vite 5.4.21 prin `build({css:{postcss:{}}})`: **trecut**, configurația repo-ului cu PostCSS inline gol pentru a evita descoperirea directorului home. Comanda standard rămâne neverificată cu succes în acest sandbox; avertismente existente despre dimensiunea bundle-ului/importuri mixte.
- Contractele și numele coloanelor au fost comparate static cu designul și SQL-ul local disponibil. Nu am verificat browserul, PostgREST/RLS, concurența sau efectele RPC pe backendul E3b. Acestea necesită verificare după integrarea backendului; build-ul nu le dovedește.
- Numai scrieri locale în worktree; fără Git, credențiale, bază de date sau deploy.
