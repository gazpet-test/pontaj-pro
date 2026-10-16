# Clasificatorul de pagini — design v1 (laborator OCR, 16.10.2026)

Decizia Razvan 16.10 (prin chat, raportul de noapte, decizia 3): se repară clasificatorul înainte de arbitrajul pe Răcari. Regula: 2 runde Jakarinos.

## Problema (măsurată)
`geometry.classify` (pixeli, pe imaginea NEROTITĂ) decide `drawing` / `grid_form` / `unknown`, iar `plan.py` EXCLUDE aceste pagini de la citire,
fără om și fără semnal în fluxul ERP (pagina apare doar ca `exclus` cu motiv).
- Răcari, lista de cantități (doc 205, 176 de pagini scanate, tipărite cu „----” și „|”): **140 de pagini → `drawing`, 1 → `unknown`**, deci
  excluse. Regula `density < .04 and horizontal+vertical > 2` le prinde pe toate: o listă tipărită subțire are ~0,01–0,03 cerneală, iar chenarul paginii dă 1–4 linii lungi.
- Răcari PTh (doc 203/204): din 24 de pagini excluse, **9 sunt de fapt text/tabel** (fișe de mediu rotite, pagini cu ștampile/semnături) și 15 sunt planșe.
- r1 (licitația 102): 21 de pagini excluse (15 `grid_form`, 6 `drawing`), neverificate de om. Chiar `classify` scrie: „dense quantity tables may resemble forms”.
- O trăsătură mai bună (numărul de rânduri de text pe ambele axe, după scoaterea chenarelor) separă lista de cantități (≥ 52 de rânduri,
  o excepție la 32) de planșe (≤ 41), dar NU separă tabelele rotite sau paginile rarefiate (5–25) de planșe (8–41). Un nou prag ar muta problema, nu ar rezolva-o.

## Propunerea — varianta B: clasificatorul nu mai exclude nimic
1. `plan.py`: `drawing`, `grid_form` și `unknown` NU mai produc `exclus_*`. Pagina merge la citire ca o singură bandă (`box` = toată pagina,
   ca `quantity_table`) și primește un semnal `{'type': 'clasificare_incerta', 'candidate': <kind>, 'features': …}` în `signals`.
   Banda păstrează `kind` = candidatul (`drawing` / `grid_form` / `unknown`).
2. Singurele excluderi rămase sunt cele care nu țin de pixeli: `orientare_nerezolvata` (neschimbat) și suprascrierea explicită a omului.
   Variantă nouă: `--exclude-pagini 12,15-18 --motiv "planșe confirmate"`, înregistrată în `selection` ca `--orientari`.
3. Dezacordurile de pe benzile cu `kind` în (`drawing`, `grid_form`, `unknown`) poartă `kind` în item (deja e în `base`), ca trierea viitoare
   să le poată trece în DEFER (fără arbitraj plătit). Acest PR NU schimbă arbitrajul; doar face posibilă trierea.
4. `classify` rămâne neschimbat (ca semnal). `versions.guard` / protocolul nu se schimbă; `plan` primește `versions.routing = 'v2-fara-excludere-pixeli'`.

## Ce câștigăm / ce plătim
- Câștig: nicio pagină de cantități nu mai dispare în tăcere (Răcari: +141 pagini din listă; +9 pagini PTh; r1: +21).
- Cost: planșele adevărate se citesc (Răcari: +15 pagini, ~1 min GPU) și produc dezacorduri „zgomot” (de măsurat pe rt1: dezacorduri pe
  benzile `drawing`). Cu trierea DEFER nu costă bani; fără triere ar intra la arbitraj, deci până la triere arbitrajul se rulează doar pe HIGH-RISK.
- Fără schimbare de schemă: manifestul BD primește benzi pentru aceste pagini în loc de `exclus` (BD nu constrânge `kind`).

## Teste propuse
Pozitiv: pagină „drawing” → `route = 'ocr'`, o bandă, semnal `clasificare_incerta`. Negativ: `orientare_nerezolvata` rămâne exclusă;
`--exclude-pagini` exclude exact paginile date, cu motiv; plan identic pe paginile `quantity_table` / `continuous_text` (aceleași benzi, aceleași sha).
Măsurătoare: replan rt1 (Răcari) și r1 (102) — câte pagini trec la citire, iar pentru r1 lista celor 21, cu etichetă vizuală.

## v2 — după Jakarinos r1 (GO cu condiții, `out\ocrlab_clasificator_r1_jak.log`) și implementare
- Pagina scoasă din excludere se citește ca `quantity_table` (nu păstrează `drawing`): orice dezacord rămâne „cu cantitate” = HIGH-RISK.
  Fără DEFER după tipul paginii (P1: altfel s-ar fi amânat și cele 140 de pagini de cantități recuperate).
- Semnalul `clasificare_incerta` (cu candidatul) ajunge în `reconciliat.json` → `garda.semnale` în BD (P1 propagare), fără schemă nouă.
- Excludere rămasă din pixeli: doar pagina practic albă (`ink_density < 0,002`, `exclus_pagina_alba`), și doar când omul n-a dat `kind`.
- `--exclude-pagini`: amânat (P2). `versions.routing = 'v2-fara-excludere-pixeli'`; planul se refuce pe o rulare nouă (planul din BD e imuabil).
- Teste: 180 OK (noi: plansă / neclasificat citite, orientare nerezolvată rămâne exclusă, semnal în reconciliere; actualizate: formular, pagină albă).
- Măsurătoare CPU (`clasificator_v2_masurare.json`, script `replan_v2.py`): Răcari d205 +141, d203 +13, d204 +11, d1624 +4 pagini la citire;
  r1 d772 +19 (13 grid_form, 6 drawing), d1247 +2. Toate benzile paginilor neafectate identice (sha): 390 pe Răcari, 4.052 pe r1.
- De făcut pentru runda 2 (GPU, ~49 de pagini noi ≈ 5 min): citirea paginilor recuperate (Răcari PTh/d1624 + r1), alarme / dezacorduri /
  pragurile de oprire pe pagini-planșă, etichete vizuale pe cele 21 din r1.
