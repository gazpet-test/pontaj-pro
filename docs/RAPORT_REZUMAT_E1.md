# Raportul zilnic de șantier — rezumatul scurt (etapa 1)

Cererea: pe fiecare raport zilnic, o rubrică cu un text scurt, salvat în ERP, de folosit pe WhatsApp sau pentru directorul de execuție.
Etapa 1 = rezumat **determinist** (fără AI), salvat pe raport, vizibil în birou și pe telefon, cu „Copiază” și corectură de mână.
Fără buton de trimitere (WhatsApp / mail).

## Ce conține rezumatul

Câteva rânduri, în ordinea asta (rândul / bucata lipsește când câmpul lipsește din raport — nu „0”, nu „necunoscut”):

1. șantierul (+ proiectul, dacă are alt nume) · data · vremea (temperatura, precipitațiile > 0, alertele)
2. oameni (totalul + categoriile cu valoare > 0) · utilaje (numărul + cele nefuncționale, cu motivul) · poze (numărul)
3. câte un rând de lucrări pe obiect (tronson / nod), cu cantitățile **exact ca în raport** și unitatea de măsură; activitățile cu bifă = „(efectuat)”
4. distribuție gaze (numărul de rânduri conducte / branșamente), dacă e cazul
5. textul liber al lucrărilor („Detalii:” dacă există și cantități), tăiat pe cuvinte la 240 de caractere, cu „…”
6. probleme (240) · mașini (160)

Exemplu (date inventate):

```
Lot 9 Alfa – Beta (proiect Contract 99/2026 Lot 9) · 10.11.2026 · 8,3 °C, precipitații 2,4 mm, alerte: Cod galben ploi
Oameni: 17 (sudori 4, lăcătuși 3, operatori utilaje 2, șoferi 1, necalificați 6, TESA 1) · Utilaje: 3 (nefuncționale: BULDOEXCAVATOR JCB 3CX – furtun hidraulic spart; GEN-1) · Poze: 6
Lucrări TR1 · Tronson 1: Săpătură șanț 35,5 mc; Sudură cap la cap 12 buc
Lucrări TR2 · Tronson 2: Lansare conductă 147,25 m; Probă presiune (efectuat)
Detalii: S-a continuat pe TR1 și TR2.
Probleme: Acces dificil după ploaie.
```

Cifrele nu se rotunjesc, nu se adună și nu se deduc (două linii pe aceeași activitate rămân două). Virgula zecimală e cea românească (12,5).
Numele șefului de șantier nu intră în rezumat.

## Unde se generează (decizia de la pct. 3) — în baza de date, în aceeași tranzacție cu salvarea

Coloanele noi pe `rapoarte_zilnice`: `rezumat_text`, `rezumat_sursa` (`automat` / `editat`), `rezumat_la`, `rezumat_de` (gol la automat).

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
  conflict fals după propria salvare); corectura omului **mărește** versiunea (e o modificare a raportului);
- corectura: `UPDATE` cu CAS pe `versiune_salvare` din aplicație, cu dreptul de scriere de azi pe tabel; trigger-ul cere dreptul pe șantier
  (`fn_raport_santier_drept`, aceeași regulă ca salvarea), text nevid, maximum 4000 de caractere (peste = refuz, nu tăiere); autorul și ora le pune serverul.

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

## Lustruirea cu un model local (doar proiectare, fără cod în etapa 1)

- **Unde:** pe serverul AI din birou, model local (Ollama), ca serviciul OCR. Fără apeluri din browser către server și fără API-uri externe.
- **Cum e chemat:** coadă în BD. La o schimbare a textului automat, serverul pune o cerere (raport, amprenta textului determinist). Un worker
  local ia cererile cu un cont de serviciu care vede DOAR coada, trimite modelului DOAR textul determinist (nimic altceva din raport) și scrie
  propunerea înapoi tot în coadă.
- **Verificare mecanică înainte de acceptare:** din ambele texte se scot perechile „număr + unitate” cu același cititor; mulțimile trebuie să fie
  identice și să nu apară niciun număr nou (nici în cuvinte); lungime maximă; fără linkuri. Altfel propunerea e respinsă și rămâne textul determinist.
- **Fără rezultat vechi:** propunerea se scrie doar dacă amprenta textului determinist e încă cea din cerere (altfel raportul s-a schimbat → aruncată).
- **Textul corectat de om nu e atins niciodată**; varianta „în frază” ar sta lângă cea deterministă, iar omul alege ce copiază.
- **Conținut extern:** textele raportului sunt scrise de oameni; modelul nu are unelte și nu poate scrie altceva decât propunerea, verificată ca mai sus.
- **Resurse:** ziua GPU-ul e ocupat de OCR → lustruirea ar rula cu prioritate mică (model mic) sau noaptea.

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

- `src/raportRezumat.js` — regula JS (oglinda); `src/raportRezumat.cazuri.json` — tabelul de cazuri comun; `src/raportRezumat.test.js`
- `src/RubricaRezumat.jsx` (+ `.test.jsx`, jsdom) — rubrica; legată în `src/RapoarteSantierPage.jsx` și `src/AppMobilManageri.jsx`
- `supabase/migrations/20261215a_executie_raport_rezumat.sql` (NEAPLICAT) + `supabase/revenire/20261215a_executie_raport_rezumat_ROLLBACK.sql`
- `scripts/test_executie_raport_rezumat.sql` — harness pentru clonă (T0–T9: paritate, salvare prin RPC, CAS, corectură, drepturi, căile directe, revenire, re-aplicare)
- `scripts/pglite/test_raport_rezumat_local.mjs` — același harness local (PGlite) + 19 mutanți
- `scripts/raport_rezumat_proba.sql` + `.mjs` — proba pe 20 de rapoarte reale, DOAR citire, înainte de aplicare

Proba pe date reale (coordonatorul):

```
psql -X -A -t -v ON_ERROR_STOP=1 -f scripts/raport_rezumat_proba.sql -o <folder de lucru>/intrari_rezumat.json
node scripts/raport_rezumat_proba.mjs <folder de lucru>/intrari_rezumat.json > <folder de lucru>/rezumate_proba.txt
```

Ieșirea poate conține nume din textele libere: rămâne la coordonator, nu intră în repo.
