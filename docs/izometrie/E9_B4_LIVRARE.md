# E9 B4 — livrare locală

Modificări limitate la citirea OCR și testele ei:

- `src/IzoDocumenteIntrare.jsx`: buton implicit local, pilot Haiku explicit,
  model superior păstrat; operație unică sub `aiLock`, verificări de context și
  demontare, progres, sursă/timpi/perspectivă/dezacorduri/cost. Nicio schimbare
  în salvare, verificare, confirmare, prefill sau editorul mobil.
- `src/izoOcrLocalFlux.js`: helper fără React; `cere` → `stare` cu backoff
  1,5–5 s → rezultat ori un singur `fallback`. Termenele serverului nu se
  prelungesc: 90/120 s + 5 s marjă, apoi citire autoritativă a stării. Invoke
  blocat și context abandonat nu țin lock-ul nelimitat. Fallback ambiguu se
  recuperează prin polling; nu se repetă apelul plătit.
- `src/izoOcrLocalFlux.test.js`: fake timers, rezultate rapide/tardive,
  abandon, noapte inclusiv DST, refuzuri, plafon, fallback unic/in_curs/pierdut,
  termene, surse și absența aplicării/salvării automate.
- `src/IzoDocumenteIntrare.ocr.test.jsx`: componentă montată cu Testing Library
  și invoke simulat: 409, 429, expirare, schimbare context/fișier, dublu-clic,
  sursă/cost și lipsa salvării automate. Lipsa infrastructurii este raportată
  explicit prin skipped, nu printr-un fals test de montare. Erorile de import
  când infrastructura există nu sunt transformate în skipped.
- `src/izoDocumentePrefill.test.js`: regresie rezultat B2 normalizat → formular
  → `randNormalizat`: 1343 kg, 12,5 m → 12500 mm, null → gol, decizie umană.
- `docs/izometrie/E9_ACCEPTARE.md`: protocol și fișă pentru 10–20 documente;
  acceptarea reală este deschisă, fără rezultate inventate.

## Verificări executate

Vitest 2.1.9 preinstalat local, prin Node, fără npm/rețea/pachete noi:

```
node node_modules/vitest/vitest.mjs run --no-cache src/IzoDocumenteIntrare.ocr.test.jsx src/izoOcrLocalFlux.test.js src/izoDocumentePrefill.test.js src/izoDocumenteLogica.test.js
```

**143 teste trecute, 5 skipped**. Cele cinci teste de componentă NU au fost
executate: checkout-ul și pachetele preinstalate nu au jsdom și
`@testing-library/react`. Nu declarăm R3-7 verificat la nivel de montare.
S-a folosit temporar o joncțiune în worktree către dependențele preinstalate;
cache-ul de test este dezactivat. Nu s-au instalat pachete.

## Contract și limite

Fișierele de intrare coincid cu origin/main, verificate prin comparație locală.
Contractul B2 a fost citit cu `git show` din referința locală cerută, inclusiv
handler, contract, RPC și raport. Nicio operație Git de scriere, commit/push,
credențială, bază sau deploy. B2 nu este prezent în main/worktree și nu a fost copiat.

**Diferență brief–B2:** `fallback` acceptă exclusiv `{op, cerere_id}`;
`cere` refuzat 409/429 nu întoarce ID. Nici noaptea nu avem un ID. Pentru
aceste cazuri se aplică exact R3-7: pilotul Haiku direct, în aceeași operație,
fără reintrare. Pentru cererile admise, fallback-ul trece numai prin edge-ul
local. Folosirea aceluiași edge și pentru refuzurile fără ID cere o schimbare
de contract B2, care nu face parte din B4.

Un `cere` cu răspuns pierdut și fără ID nu declanșează o nouă cheltuială
automată: nu putem recupera identitatea cererii din contractul existent.
Limitele/expirarea/costul real rămân autoritative pe server.

Nu s-au executat API-ul real, workerul/GPU, măsurători de latență/cost,
compararea documentelor sau validarea PDF reală. Nu s-au accesat baze.
Testele helperului nu demonstrează atomicitatea serverului sau superioritatea
localului; integrarea B1–B3 și testele montate rămân porți de verificare pentru Claude.
