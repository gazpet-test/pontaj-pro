# Prototip B: PT „Necesită atenția ta” (read-only)

Prototip pentru ecranul din `docs/AUDIT_OFERTARE_V2/PT_UX_TO_BE.md` §4.1 (Varianta B, Workspace V2). Lucrează **doar** pe fixture-ul clonei de audit 103 (`SANDBOX-V2-DOMNESTI`, capturat la 29.09.2026 20:13 UTC, anonimizat).

Nu face parte din aplicație: are config Vite separat și nu e importat din `src/`. Nu scrie nimic, nicăieri. Raportul cu dovezile, clickurile și limitele: `docs/AUDIT_OFERTARE_V2/PT_PROTOTIP_B_RAPORT.md`.

## Cum rulezi

Comenzile se dau din rădăcina repo-ului. `node_modules` există deja, deci nu instalezi nimic.

```bash
npx vite --config vite.prototip.config.js              # http://localhost:5199
npx vitest run prototip/pt-atentie                      # testele (contract + cazuri negative + finding-urile verificatorilor + ecran randat static)
npx vite build --config vite.prototip.config.js         # build în prototip/pt-atentie/dist (ignorat de git prin `dist/`)
```

**Fixture-ul nu e în repo** (`prototip/pt-atentie/.gitignore`: `fixtures/`, `capturi/`, `.cache-vite/`). E date reale anonimizate euristic și nu se comite fără review uman explicit (Răzvan). Fără el:
- testele pe 103 se sar (`it.skipIf`), cele pe snapshoturi sintetice rulează, deci `npm test` rămâne verde pe CI;
- ecranul spune că nu are date și nu afișează nicio listă și niciun verdict.

Cache-ul Vite al prototipului stă în `prototip/pt-atentie/.cache-vite`, nu în `node_modules/.vite` al aplicației.

## Fișiere

| Fișier | Ce face |
|---|---|
| `atentie.js` | Funcțiile pure `construiesteAtentia(snapshot, {acum, licitatieId})`, `normalizeazaSnapshot(fixture)`, `construiesteCuprins(...)`. Nu importă supabase sau React și nu face fetch. Nu citește ceasul: `acum` vine din afară. Nu modifică intrarea. Importă doar evaluatorul existent `src/ofertarePoarta.js` și `campuriCantitatiNevalidate`, ambele pure. |
| `scenarii.js` | Transformări pure ale snapshotului: sursă cu eroare, ceas simulat, licitația sintetică B. Conține și încărcătorul simulat cu gardă de concurență (`creeazaIncarcator`). |
| `PtNecesitaAtentia.jsx` | Ecranul, în două părți. `EcranAtentie` e prezentarea pură. Componenta implicită e containerul cu scenarii; fixture-ul e încărcat opțional (`import.meta.glob`). |
| `main.jsx`, `index.html` | Punctul de intrare al prototipului. |
| `atentie.test.js` | 458 de teste vitest (46 depind de fixture și se sar fără el). |
| `dovezi/playwright_sumar.json` | Rezultatul rulării Playwright: verdictul pe fiecare scenariu, traseul de cereri, stocarea browserului, clickurile măsurate. Nu conține texte din fixture. |
| `fixtures/l103.json`, `capturi/*.png` | Locale, necomise (date reale). |
| `../../vite.prototip.config.js` | `root = prototip/pt-atentie`, port 5199, cache separat. Nu atinge `vite.config.js`, `package.json`, `src/` sau `index.html` de la rădăcină. |

## Ce vezi pe ecran

**1. Antet.** Licitația, verdictul (BLOCKED / WARN / OK / INDISPONIBIL) și banda permanentă **„SIMULAT — J07 neaplicat”**. Sub bandă apar contoarele. Dacă o parte din reguli n-au putut rula, contorul clasei spune „N + M reguli neevaluate”, nu un 0 simplu. Dacă lista nu poate fi construită deloc (altă licitație, licitație nepermisă, toate sursele căzute), contoarele sunt „—”.

**2. Indisponibile.** Apare de câte ori o sursă n-a putut fi citită sau folosită: eroare (inclusiv „ok” venit cu eroare), lipsă, altă licitație (și la nivel de rând), formă invalidă, câmpuri lipsă sau de tip greșit, date expirate sau fără timestamp. Pentru fiecare vezi regulile rămase neevaluate. O sursă indisponibilă nu devine niciodată „0” sau listă goală.

**3. Necesită atenția ta.** Grupele apar în ordinea BLOCK → HUMAN_DECISION → CONFIRM → WARN. Fiecare rând are cauza exactă și textul sursei, proveniența (AI / om / om în bloc / server / regulă client), dacă blochează acțiunea finală, „ai de făcut: …” (intenție de navigare, *prototip read-only*) și „Du-mă acolo”. Acesta selectează capitolul în workspace; pentru ecranele care nu există în prototip spune unde te-ar duce în aplicație.

**4. Rânduri fără excepție.** Colapsate. Doar din surse citite, cu proveniența om, server sau regulă client, niciodată AI. Deciziile în bloc nu apar aici.

**5. Cuprins.** Progresul pe capitol (verificate de om / total), cu candidații AI și „verificate doar în alt capitol” numărate separat. Pe date vechi sau expirate barele și chipurile nu mai sunt verzi.

**6. Workspace capitol.** Stânga: cerințele capitolului, fiecare cu starea **legăturii din acest capitol** (atribuită de AI, citat candidat AI, verificată de om, verificată în alt capitol, blocată, verificată pe altă versiune), plus capcana, E2 și excepțiile. Dreapta: textul capitolului, read-only.

### Scenarii (selectorul de sus)

| Scenariu | Ce demonstrează |
|---|---|
| Fixture 103, normal | Ceasul e setat la captură + 5 min, deci datele sunt proaspete. Rezultatul e BLOCKED. |
| O sursă a dat eroare | Alegi sursa. Datele vechi rămân atașate, ca în `load()` de azi, dar sunt ignorate. Verdictul devine INDISPONIBIL sau BLOCKED, niciodată OK. |
| Date vechi (30 min) | PROSP01 (WARN). Rândurile ok primesc marcajul „date vechi”, nimic nu mai e verde. |
| Date expirate (3 h) | INDISPONIBIL. Excepțiile rămân vizibile, cu marcajul „din date expirate”, iar `ok[]` e gol. |
| Licitație schimbată rapid A→B→A, răspunsul B întârziat | Butonul ▶ rulează secvența. Cu gardă: răspunsul lui B e ignorat (apare în jurnal). Fără gardă (comportamentul de azi): B suprascrie ecranul lui A, dar `construiesteAtentia` refuză datele (`SNAP:alta_licitatie`) și ecranul arată INDISPONIBIL, fără listă și fără contoare. |

Ceasul se poate schimba separat. Pe „ceasul real al browserului”, fixture-ul apare **vechi** după 10 minute și **expirat** după 2 ore de la captură (29.09.2026 20:13 UTC).

## Ce e simulat

- **Verdictul agregat.** J07 (`ofertare_poarta_server()`) nu există în BD, așa că verdictul e calculat în browser după contract. Poartă mereu `simulat: true`, eticheta „SIMULAT — J07 neaplicat” și `nu_inseamna_gata_de_depus: true`. Nu există starea READY. Dacă J07 va exista și va fi mai sever decât simularea, se ia varianta lui (INT05 BLOCK).
- **Ceasul de evaluare**, în afară de opțiunea „ceasul real”.
- **Încărcarea**: întârzieri artificiale, fără rețea.
- **Licitația B** (`9001`): e sintetică și n-are date. Prototipul evaluează doar 103 (`licitatiiPermise = [103]`), iar orice altă licitație iese `licitatie_nepermisa`.

## Ce NU face

- Nu scrie în BD, nu face fetch și nu importă supabase.
- Nu rulează AI.
- Nu citește Jilava (93) sau alte licitații.
- Nu are butoane care confirmă, acceptă text, verifică, semnează sau asamblează pachetul. Nu există nici „confirmă toate”.
- Nu preselectează rânduri după scor. Scorul candidaților nu intră nici în ordonare.
- Nu înlocuiește porțile server: J02, R5, R12, `fn_gate_depunere` și triggerul de pe `ofertare_pt_pachet` rămân singurele care decid.

## Abateri deliberate față de contract / față de server (de confirmat de Copilot + Răzvan)

Principiul comun al abaterilor 2–6: **o decizie fără om identificat sau luată pe grup se tratează ca lipsa deciziei umane.** Simularea poate fi mai strictă decât serverul, niciodată mai permisivă.

1. **H6 `numere` e „neevaluat”, nu `CTRL.numere.ok`.** Pe 103 `bransamente_in_cerinte = null`, deci nu există nimic de comparat. La fel, orice câmp-listă NULL din `v_ofertare_pt_stare` face controlul „neevaluat” (nu putem deosebi „nimic găsit” de „necalculat”).
2. **„Nu se aplică” cere decizie individuală.** O cerință scoasă din registru contează ca „scoasă de om” doar cu autor nevid și moment propriu (`stare_la`, la secundă). Pe 103 cele 108 „scoase de om” au, de fapt, 2 momente (106 + 2 cerințe în aceeași secundă), deci `R06.ok_scoase_om` nu mai apare. Eliminatoriile intră în R06_ELIM_AI_NA. Aceasta înlocuiește vechea abatere „108, nu 107” și trebuie citită împreună cu `INCIDENT_V2_NSA_AI_2026-09-29.md` (OPEN).
3. **R06_ELIM_AI_NA și PT06 blochează final.** Serverul socotește eliminatoria cu „nu se aplică” AI acoperită (J02 / `fn_gate_depunere`) și cerința PT exceptată de AI rezolvată (`v_ofertare_pt_stare.fara_capitol`); incidentul le califică pe amândouă FALSE_GREEN, iar TO-BE §5 cere BLOCK pe eliminatorii. R06_AI_NA (cerințe ne-eliminatorii) rămâne CONFIRM neblocant — de confirmat.
4. **E2 în bloc nu e confirmare (E2_BLOC, blochează).** Pe 103, 395 din 417 confirmări au același moment (15.09 12:31:09). Serverul le socotește confirmate.
5. **„Verificat pe scan” fără autor nu e dovadă umană (R06_FARA_AUTOR, blochează).** Formula R06 a serverului nu cere `verificat_de`. Pe 103 nu apare (cele 4 dovezi au autor).
6. **PT00: 0 cerințe PT = decizie umană blocantă.** Niciun rând `*.ok` nu se emite pe un univers gol („Toate cele 0…”, „0 din 0”).
7. **J07 mai sever decât simularea → INT05 BLOCK** (J07 nu există încă; ramura e pregătită).
8. **Divergențele pe cerință / rând blochează final** (`server_cer`, `dovada_r06`, capcana regex ↔ server: INT01 BLOCK). Pe contoare: „server > recalcul pe un contor blocant → BLOCK, altfel WARN”.
9. **Dependențe mai stricte:** PT05 depinde și de `capitole`; R06_PROPUSA și R06_AI_NA depind și de `legaturi` / `capitole`.
10. **R06_AI_NA prinde și cerințele PT fără capitol** cu acoperire AI favorabilă și `nu_se_aplica` în același timp.
11. **DEP_ROSII are `aspect: null`**; documentele referite dar necitite și termenul lipsă fac DEP_ROSII indisponibil.
12. **Eticheta OK nu conține cuvântul „aprobarea”** (regex-ul I10). **N33 scanează textul autorului, nu datele citate.**
13. **Nume de fișier și funcții în plus:** `atentie.js` (cerut de sarcină), `construiesteCuprins`, `destinatieDuMa`.

## Limite

- **Texte trunchiate.** Fixture-ul are textele de capitol trunchiate la 1500 de caractere. Regulile folosesc `continut_gol`, `continut_len`, `*_md5` și `server_cer`, calculate pe textul integral, dar workspace-ul arată doar începutul capitolelor.
- **Snapshot static** de la 29.09.2026 20:13 UTC. Câmpurile derivate (`server_cer`, `dovada_r06`, `necitit_server`) sunt recalculate la captură, după view-urile de atunci.
- **DEP_ROSII e mereu indisponibil pe 103**, pentru că `documente_firma` nu e în fixture (decizia deschisă 6). De aceea 103 nu poate ieși niciodată OK în prototip.
- **`candidati_citat` nu există încă în BD.** PT07 și atașarea candidaților sunt testate numai pe snapshoturi sintetice.
- **Decizia individuală se deduce din timp** (două decizii în aceeași secundă = bloc). Un script care scrie un singur rând, cu un autor oarecare, trece drept decizie umană. Remedierea reală (actor + moment + versiunea cerinței, scrise pe server) e remedierea A din incident.
- **Anonimizarea fixture-ului e euristică.** Fixture-ul (1,26 MB) și capturile nu se comit. Build-ul prototipului include fixture-ul în `dist/`, care e ignorat.
- **Clickuri măsurate doar pentru (a), (b)+(c), (f).** (d), (e), (g) cer scrieri, pe care prototipul nu le face — vezi raportul.
