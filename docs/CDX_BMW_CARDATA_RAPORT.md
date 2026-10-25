# Cartela BMW CarData - 25.10.2026

Implementat exclusiv in worktree. Fara comenzi Git, commit, push, credentiale,
acces BD sau deploy. Fara migrari si fara dependente noi.

## Fisiere

- `src/BmwCardataCard.jsx`: cartela pliabila, paleta G/stiluri S primite din
  Logistica, valori nenule, VIN mascat, data Europe/Bucharest, banner peste 36 h,
  grafice SVG, totaluri pe 7/30 zile, comparatie EvoGPS numai cu interval nenul.
  Implicit deschisa la minimum 700px, inchisa sub 700px. Incarcare la montare/VIN
  nou si buton Reincarca, fara polling. Raspunsurile dupa demontare sunt ignorate.
- `src/bmwCardataLogica.js`: functii pure pentru VIN, vechime, zile calendaristice
  Bucuresti, intervale, totaluri complete, consum OBFCM si formatari romanesti.
- `src/bmwCardataLogica.test.js`: 20 teste pentru seria reala, zile lipsa,
  scaderi/reveniri de kilometraj, schimbarea orei, ferestre complete, consum,
  null-uri, randare statica, mobil, interogari simulate si erori.
- `src/Logistica.jsx`: numai doua linii adaugate:
  - linia 24: import BmwCardataCard;
  - linia 2249: un singur loc de montare, inainte de CarteTehnicaSearch,
    cu activ.id drept key si serie_sasiu, G, S drept proprietati.

## Reguli de calcul

Graficul pastreaza ultima citire din fiecare zi. O bara reprezinta media
intervalului si apare doar in ziua citirii de la capatul intervalului; nu umple
zilele lipsa. Liniile procentuale nu traverseaza zile fara citire. Totalurile
folosesc toate citirile, numai intervale cu ambele capete in fereastra de timp,
fara proratare. Kilometrajul descrescator si intervalele de revenire de dupa
scadere sunt marcate/excluse, pentru a evita numararea dubla.

Consumul foloseste diferente cumulative valide OBFCM combustibil/distanta,
ponderate doar pe intervalele acoperite in ultimele 30 zile. Nu calculeaza
consumul din scaderea nivelului rezervorului: alimentarile intermediare nu sunt
cunoscute. combustibil_litri este afisat ca nivel, daca exista.

La fiecare incarcare sunt doua SELECT-uri: citiri filtrate pe VIN normalizat,
ordonate citit_la desc, limita 60; view filtrat pe acelasi VIN, zi desc, limita
60. Fara acces la brut/locatii, fara scrieri. Erorile sunt logate fara payload-ul
vehiculului; UI afiseaza discret mesajul cerut.

## Verificari rulate

Prima incercare npm install a esuat la profilul Windows (uv_os_homedir ENOMEM).
Cu USERPROFILE local si cache in worktree, descarcarea a esuat cu EACCES la
registry.npmjs.org. Au fost reutilizate prin copiere dependente locale din
worktree-ul 20261023-114219-991299-export-teava; package-lock.json identic SHA256:
EDF3412EE5F422B787A0C3817840C5F237BC791ADD4192F5D83C5BD8A4991202.
Hash-ul fisierului curent a ramas identic dupa verificari.

Comenzi executate cu Node din C:/Program Files/nodejs, PATH si USERPROFILE
configurate doar in procesele locale; cache si userconfig in .tmp:

```text
npx.cmd --offline --cache .tmp/npm-cache --userconfig .tmp/npm-user.config vite build
exit 0
  built in 9.19s

npx.cmd --offline --cache .tmp/npm-cache --userconfig .tmp/npm-user.config vitest run
exit 0
  src/bmwCardataLogica.test.js (20 tests) 164ms
  Test Files  102 passed | 1 skipped (103)
       Tests  2534 passed | 6 skipped (2540)
    Duration  2.47s
```

Build-ul raporteaza avertismente despre chunk-uri peste 500 kB, importuri
dinamice/statice si alte fisiere existente; fara eroare de build.
O rulare intermediara a colectat accidental teste din copia temporara a
dependentelor; copia a fost mutata sub .tmp/node_modules, exclus implicit,
apoi suita completa a fost rerulata cu rezultatul de mai sus.

Loguri complete: `.tmp/bmw-build-verified.log`, `.tmp/bmw-tests-verified.log`.
Fisierele noi de cod au fost verificate: zero caractere non-ASCII.

## Neverificat

Nu exista verificare de aspect sau interactiune intr-un browser. Randarea
statica si mock-urile nu demonstreaza functionarea live prin PostgREST/RLS.
Nu am interogat BD/API real; numele coloanelor si drepturile sunt cele din brief.
Cele 6 teste sarite nu sunt declarate trecute. Nu am efectuat commit, conform
restrictiei explicite de la inceputul cererii.
