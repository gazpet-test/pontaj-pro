# Raportul zilnic de șantier — rezumatul scurt (etapa 1)

Cererea: pe fiecare raport zilnic, o rubrică cu un text scurt, salvat în ERP, de folosit pe WhatsApp sau pentru directorul de execuție.
Etapa 1 = rezumat **determinist** (fără AI), salvat pe raport, vizibil în birou și pe telefon, cu „Copiază” și corectură de mână.
Fără buton de trimitere (WhatsApp / mail).

## Ce conține rezumatul

Câteva rânduri, în ordinea asta (rândul / bucata lipsește când câmpul lipsește din raport — nu „0”, nu „necunoscut”):

1. **un singur nume**: șantierul (`sites.name`, scurtat pe cuvinte la 80); proiectul apare doar dacă numele lui NU e deja conținut în numele
   șantierului (comparație fără diacritice / majuscule) și atunci scurtat la 60 · data · vremea (temperatura **la grad întreg**, precipitațiile > 0, alertele)
2. oameni (totalul + categoriile cu valoare > 0) · utilaje (numărul + cele nefuncționale: numărul lor și **cel mult primele 3**, cu motivul, apoi „+N”) · poze (numărul)
3. câte un rând de lucrări pe obiect (tronson / nod), cu cantitățile **exact ca în raport** și unitatea de măsură; activitățile cu bifă = „(efectuat)”
4. distribuție gaze (numărul de rânduri conducte / branșamente), dacă e cazul
5. textul liber al lucrărilor („Detalii:” dacă există și cantități), tăiat pe cuvinte la 240 de caractere, cu „…”
6. subcontractorii (200), dacă rubrica e completată
7. probleme (240) · mașini (160)
8. aprovizionarea (160) și planul pentru mâine (200), fiecare doar dacă e completat — textul omului, nimic dedus

Exemplu (date inventate):

```
Lot 9 Alfa – Beta (proiect Contract 99/2026 Lot 9) · 10.11.2026 · 8 °C, precipitații 2,4 mm, alerte: Cod galben ploi
Oameni: 17 (sudori 4, lăcătuși 3, operatori utilaje 2, șoferi 1, necalificați 6, TESA 1) · Utilaje: 3 (nefuncționale 2: BULDOEXCAVATOR JCB 3CX – furtun hidraulic spart; GEN-1) · Poze: 6
Lucrări TR1 · Tronson 1: Săpătură șanț 35,5 mc; Sudură cap la cap 12 buc
Lucrări TR2 · Tronson 2: Lansare conductă 147,25 m; Probă presiune (efectuat)
Detalii: S-a continuat pe TR1 și TR2.
Probleme: Acces dificil după ploaie.
```

Cifrele nu se rotunjesc, nu se adună și nu se deduc (două linii pe aceeași activitate rămân două); singura rotunjire e temperatura
(jumătatea departe de zero: 8,5 → 9; −0,3 → 0). Virgula zecimală e cea românească (12,5). Numele șefului de șantier nu intră în rezumat.

r3: textul automat are un **plafon total de 3000 de caractere**: peste el rămân rândurile întregi care încap, apoi
„… (rezumat scurtat; restul în raport)”. În rezumat intră **doar ce ține de proiectul șantierului**: o linie, activitate sau obiect al altui
proiect (rămas pe raport după o mutare a șantierului, de exemplu) nu apare în text.

**Ce a ieșit la proba pe 20 de rapoarte reale (r2):** rapoartele reale au lucrările ca **text liber** (`lucrari_efectuate`), nu pe linii (în ultimele
două zile niciun raport nu avea linii în `raport_lucrari`) — rezumatul le redă ca „Lucrări: …”. Lipseau subcontractorii, aprovizionarea și
planul pentru mâine (completate des) → adăugate; antetul repeta numele (șantier + proiect aproape identic) → un singur nume; lista utilajelor
nefuncționale putea fi lungă → primele 3 + „+N”; temperatura cu zecimale („8,19 °C”) → grad întreg.

## Unde se generează (decizia de la pct. 3) — în baza de date, în aceeași tranzacție cu salvarea

Coloanele noi pe `rapoarte_zilnice`: `rezumat_text`, `rezumat_sursa` (`automat` / `editat`), `rezumat_la`, `rezumat_de` (gol la automat),
`rezumat_eroare` (r3: codul ultimei compuneri automate eșuate; gol = a reușit).

**Ales: generarea pe server, prin trigger, nu în client.** Motivele:

- **Telefonul vechi** (aplicația rămasă în cache) salvează fără niciun câmp nou: rezumatul tot apare, corect, fără să schimbăm nimic în telefon.
- **Cifrele vin din ce s-a salvat efectiv** (liniile finale din aceeași tranzacție), nu din ce crede telefonul că a trimis.
- **Regula „textul corectat de om nu se suprascrie” e în BD** și ține pe orice cale de scriere (salvarea prin RPC, scrierea directă, alte module).
- **RPC-ul de salvare (`fn_raport_zilnic_salveaza`) rămâne neschimbat**: migrarea de acces pe proiect (20261209a) îi ține amprenta corpului, iar
  20261213a ține amprenta inventarului 20261209a; o schimbare a RPC-ului le-ar opri pe amândouă. Cele două triggere de aici nu sunt apelabile din API,
  deci nu cer clasificare în inventarul 20261209a. Ordinea de aplicare față de 20261209a / 20261213a nu contează.
- **Niciun drept nou** pe tabel.

Cum lucrează:

- trigger `BEFORE INSERT / UPDATE` pe `rapoarte_zilnice` (după cel de versiune): raport nou = rezumat automat; o scriere fără rezumat reface
  rezumatul automat, dar NU atinge un text `editat`; textul „automat” îl scrie mereu serverul (cel trimis de un client e înlocuit);
- trigger `AFTER INSERT` pe jurnalul salvărilor (`raport_zilnic_salvari`, ultimul pas al RPC-ului): rezumatul se reface pe antetul + liniile +
  distribuția finale;
- textul automat e derivat, deci o scriere care schimbă **doar** rezumatul automat nu mărește `versiune_salvare` (altfel telefonul ar vedea un
  conflict fals după propria salvare); orice **decizie a omului** mărește versiunea: corectura și (r3) „Revino la automat” — două telefoane care au
  citit aceeași versiune nu se mai pot suprascrie în tăcere (al doilea primește „s-a modificat între timp”);
- corectura: `UPDATE` cu CAS pe `versiune_salvare` din aplicație, cu dreptul de scriere de azi pe tabel; trigger-ul cere un cont logat (r3: fără
  identitate = refuz, nicio cale de server nu corectează în locul unui om) și dreptul pe șantier (`fn_raport_santier_drept`, aceeași regulă ca
  salvarea), curăță caracterele de control (rândul nou rămâne), apoi cere text nevid, maximum 4000 de caractere (peste = refuz, nu tăiere);
  autorul și ora le pune serverul;
- (r3) **rezumatul nu poate strica salvarea raportului**: dacă citirea / compunerea rezumatului dă o eroare la o salvare a raportului, raportul se
  salvează, rezumatul rămâne cel de dinainte (raport nou: fără rezumat), iar codul erorii se notează pe rând (`rezumat_eroare`, doar codul);
  rubrica arată „Rezumatul automat nu s-a putut reface la ultima salvare (cod …)”. La „Generează” / „Revino la automat” eroarea se arată omului.

Prețul: regula textului există în două limbaje — SQL (`fn_raport_rezumat_text`, cea care scrie în BD) și JS (`rezumatRaport` din
`src/raportRezumat.js`, pentru proba pe date reale). Paritatea e verificată pe **același tabel de cazuri** (`src/raportRezumat.cazuri.json`,
rezultatele scrise de mână), în vitest (JS) și în harness-ul SQL (T1), plus mutanți pe PGlite care trebuie să pice.

Rapoartele salvate înainte de migrare rămân fără rezumat până la prima lor salvare (sau „Generează” din rubrică). O generare în masă e un pas
separat, pe date reale (preview → „da” → aplicare): `UPDATE rapoarte_zilnice SET rezumat_sursa = 'automat' WHERE rezumat_sursa IS NULL` — nu
mărește versiunile (schimbă doar rezumatul automat).

## În aplicație

- **Birou** (Rapoarte Șantier → detaliul raportului) și **telefon** (`/m`, la un raport deja salvat): rubrica „📝 Rezumat” cu textul,
  eticheta „generat automat” / „editat de <nume>”, ora, „📋 Copiază”, „✏️ Corectează” și „↺ Revino la automat” (doar pentru cine are drept de
  scriere pe raport: owner sau alocat pe șantier; serverul decide oricum).
- Dacă raportul a fost salvat din nou după o corectură, rubrica avertizează că textul corectat poate să nu mai corespundă.
- Înainte de aplicarea migrării, rubrica nu apare deloc (coloanele lipsesc din rând): deploy-ul poate merge înaintea migrării.

## Rezumatul ZILEI, pe toate șantierele (r2)

Un singur text pe zi, pentru directorul de execuție / WhatsApp. **Fără schemă nouă**: se calculează în aplicație, la cerere, și nu se salvează.

- **Unde:** Rapoarte Șantier (ecranul de birou) → butonul „📝 Rezumatul zilei” → fereastră cu ziua (implicit capătul intervalului din filtru),
  textul și „📋 Copiază”. Fără buton de trimitere.
- **Ce citește:** doar `SELECT` pe `rapoarte_zilnice` (ziua aleasă, șantierele din ecran) și `raport_lucrari` (liniile acelor rapoarte), cu
  drepturile de azi ale celui care cere. Fiecare vede doar ce vede deja: lista de șantiere din ecran (owner / contabilitate = toate active;
  ceilalți = cele alocate) + RLS-ul existent (un cont restrâns pe proiect primește doar rapoartele lui). Nimic ocolit, niciun drept nou.
- **Textul** (`rezumatZi` din `src/raportRezumat.js`, determinist):
  - antet: „Rapoarte șantiere — 11.11.2026: 5 șantiere, 95 de oameni, 98 de utilaje” (oamenii = suma totalurilor din rapoarte, utilajele = suma
    listelor; un raport fără număr NU devine 0 — se spune câte rapoarte n-au avut numărul);
  - câte 2–4 rânduri pe șantier, în ordinea numărului de oameni: „• nume: oameni · utilaje (nefuncționale)”, „Lucrări: …” (cantitățile exacte pe
    obiecte, apoi textul liber scurtat la 200), „Subcontractori: …” (120) și „Probleme: …” (160) dacă există; fără lucrări = „nimic trecut în raport”;
  - la final, șantierele care trebuiau să raporteze și n-au trimis (aceeași regulă ca „Lipsă azi” din ecran: active, cu raport zilnic necesar).
- **Formularea listei de la final (r3):** lista e diferența dintre șantiere și rapoartele pe care contul le **vede**, deci „Fără raport” se
  afirmă doar când contul vede tot (owner) **și** ziua e azi. Altfel: „Fără raport vizibil pentru contul tău” (cont restrâns: un raport pe care
  nu-l poate citi nu devine „lipsă”) și/sau „din lista curentă de șantiere” (o zi trecută: starea de azi a șantierelor nu dovedește că trebuiau
  să raporteze atunci).

Exemplu (date inventate):

```
Rapoarte șantiere — 11.11.2026: 5 șantiere, 95 de oameni, 98 de utilaje

• Lot 1 Prunișor – Jupa: 40 de oameni · 32 de utilaje (nefuncționale 4: N1; N2; N3; +1)
  Lucrări: Sudură TR3, lansare 120 m.
  Probleme: Ploaie după-amiaza.
• Domnești: 25 de oameni · 20 de utilaje
  Lucrări: Montaj conductă.
  Subcontractori: Rominsta — foraj orizontal
…

Fără raport (2): Beta, Zeta
```

## Fără AI în textul rezumatului (constatare r2)

Textul rămâne **determinist** în etapa 1, și pentru rezumatul raportului, și pentru cel al zilei. O probă separată cu un model local care
„lustruia” textul a arătat că modelul **inventează planul de mâine** când rubrica e goală și **mută în viitor** lucrările subcontractorilor.
De aceea nu există și nu se pregătește nicio etapă de lustruire cu AI pe acest text; orice idee în direcția asta trece întâi pe la Răzvan.

## Pozele raportului → proiect / contract (analiză, fără implementare)

Cum sunt azi:

- telefonul comprimă pozele (~1600 px, JPEG) și le urcă în bucket-ul `rapoarte-zilnice`, pe calea `<șantier>/<AAAA-LL-ZZ>/<moment>_<aleator>.jpg`;
- căile stau pe raport, în `rapoarte_zilnice.poze` (listă de text); 4–12 poze pe raport (fără minim în zilele fără personal);
- **nu există un tabel de poze**: nicio legătură cu obiectul / tronsonul, nicio amprentă, nici autorul pe poză;
- legătura cu proiectul e **indirectă**: raport → șantier → `sites.proiect_id` → proiectul din Execuție (contractul);
- pozele sunt folosite azi în detaliul raportului (link semnat, 1 oră) și în Marketing (ciornele de postări din pozele rapoartelor);
- documentele proiectului (tab-ul Documente din Execuție) sunt altceva: `documente_proiect` (corespondența), în alt bucket, sincronizat cu NAS-ul.

Variante:

| | Ce înseamnă | Efort | Plusuri / minusuri |
|---|---|---|---|
| **A. Galerie pe proiect, doar citire** | Tab „Poze” în proiectul din Execuție: pozele tuturor rapoartelor șantierelor proiectului, pe zile, din `rapoarte_zilnice.poze` | mic (~1 zi), fără migrare | + imediat, nimic nou de scris; − legătura rămâne prin șantier (dacă șantierul își schimbă proiectul, pozele „se mută”), fără filtru pe tronson |
| **B. Tabel de poze** (`raport_poze`) | Un rând pe poză: raport, proiect fixat la urcare, obiect / tronson opțional, cale, amprentă, autor, data | mediu (2–3 zile + migrare + schimbarea salvării, coordonată cu 20261209a) | + galerie pe proiect și pe tronson, export pentru dosar, fără dubluri; − schimbă RPC-ul de salvare (review mai greu) |
| **C. Pozele alese intră în documentele proiectului** | O selecție (ex. albumul lunar pentru beneficiar / cartea tehnică) se copiază în dosarul proiectului (și pe NAS) | mare (3–5 zile) | + ajung acolo unde se caută documentele contractului; − stocare dublă, sincronizare NAS, cine decide ce intră |

Recomandare: **A** acum (rapid, fără risc), **B** când e nevoie de poze pe tronson / album pentru beneficiar.

## Fișiere și teste

- `src/raportRezumat.js` — regula JS (oglinda) + `rezumatZi` (rezumatul zilei) și citirea lui; `src/raportRezumat.cazuri.json` — tabelul de cazuri comun; `src/raportRezumat.test.js`
- `src/RubricaRezumat.jsx` (+ `.test.jsx`, jsdom) — rubrica; legată în `src/RapoarteSantierPage.jsx` și `src/AppMobilManageri.jsx`
- `src/RezumatZiModal.jsx` (+ `.test.jsx`, jsdom) — fereastra „Rezumatul zilei” din Rapoarte Șantier
- `supabase/migrations/20261216a_executie_raport_rezumat.sql` (NEAPLICAT) + `supabase/revenire/20261216a_executie_raport_rezumat_ROLLBACK.sql`
- `scripts/raport_rezumat_amprente.sql` — (r3) amprenta L15 pentru blocul BASELINE al migrării, DOAR citire (coordonatorul, pe producție)
- `scripts/raport_rezumat_vizibilitate.sql` — (r3) proba „cititorul vede tot ce intră în rezumat”, DOAR citire (clonă / producție)
- `scripts/raport_rezumat_concurenta.sh` — (r3) două telefoane pe aceeași versiune, cu două sesiuni reale (DOAR clonă)
- `scripts/test_executie_raport_rezumat.sql` — harness pentru clonă (T0–T11: paritate, salvare prin RPC, CAS, corectură, identitate, drepturi,
  căile directe, eroare injectată în compunere, linii din alt proiect, revenire, re-aplicare)
- `scripts/pglite/test_raport_rezumat_local.mjs` — același harness local (PGlite) + 31 de mutanți + scenariile de refuz (baseline, plafon, stare schimbată, revenire)
- `scripts/raport_rezumat_proba.sql` + `.mjs` — proba pe 20 de rapoarte reale, DOAR citire, înainte de aplicare
- **Livrarea** (r3): DOAR cu `scripts/livrare_migrare.sh … --plafon-tranzactie-ms 2000`, după ce blocul BASELINE e completat și revizuit
  (pașii exacți: antetul migrării și raportul PR-ului).

Proba pe date reale (coordonatorul):

```
psql -X -A -t -v ON_ERROR_STOP=1 -f scripts/raport_rezumat_proba.sql -o <folder de lucru>/intrari_rezumat.json
node scripts/raport_rezumat_proba.mjs <folder de lucru>/intrari_rezumat.json > <folder de lucru>/rezumate_proba.txt
```

Ieșirea poate conține nume din textele libere: rămâne la coordonator, nu intră în repo.
