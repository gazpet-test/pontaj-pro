# Izometrie E1 — raport (20.10.2026)

Etapa E1 din `IZOMETRIE_DESIGN_v2.md` v2.3: pregătire **fără schemă**. Nu am scris nimic în BD, nu am acordat drepturi și n-am deployat nimic.

## Livrabile

| Fișier | Ce e |
|---|---|
| `docs/izometrie/INVENTAR_SCHEMA_E1.md` | inventarul schemei live (§6.1, punctele 1–17), cu diferențele față de design și planul E2 |
| `src/lib/izoSudura.js` + `izoSudura.cazuri.json` + `izoSudura.test.js` | normalizatorul de sudură (T / TR / „GAZPET TR11 S318/A” / „S202A1” / „204”), afișarea `TR8S478` pe LOT 2, perechea din fișa de tăiere, maparea `legare` / `sudura_sant_pending` / `sudura_refacuta`; setul de cazuri JSON e cel pe care îl va folosi și funcția SQL din E4b |
| `src/lib/izoKml.js` + `izoKml.test.js` | citirea KML (fără DOM și fără librării), clasificarea punctelor după nume, compunerea axului ales de om, ancorarea pe liniuțele de km, calibrarea km pe ancore |
| `scripts/izometrie/preview_e1.mjs` + `preview_e1.config.json` | preview-ul E1, care citește KML-urile și starea BD (din SELECT) |
| `docs/izometrie/PREVIEW_E1.md` / `.json` | rezultatul preview-ului: ax, borne, puncte, linii necunoscute, tronsoane PT față de BD, depozite |
| `docs/izometrie/E1_APPLY_PROPUS.sql` | DML-ul propus (preview → „da” → apply cu RETURNING → control), cu rollback; **nerulat** |

Testele: 74 noi (normalizator 40, KML 34); suita completă și `npx vite build` trec (vezi PR).

## Criteriile E1 (§6.3)

| Criteriu | Rezultat |
|---|---|
| Normalizatorul dă același rezultat pe `T8S543`, `TR8S543`, `T9S88`, „GAZPET TR11 S318/A”, `S202A1`; afișează `TR8S543` pe LOT 2 | **trece** în JS. Partea SQL vine în E4b, pe același set de cazuri |
| KML LOT 1: 50 de borne, 17 TD, 9 TA, 12 THC, CF, R 1, R 2, OS, depozitul | **trece** (50/17/9/12/1/2/1/1) |
| Axul LOT 1 ales are 48 874 m ± 0,1 % | **trece** (48 874 m, suprapunerea de 661 m scoasă) |
| Km-ul fiecărei ancore în ±50 m față de PT | **LOT 2 trece** (abatere maximă 12,6 m, 41 de borne pe liniuța de km). **LOT 1 trece pe 48 din 50**: la 8+000 și 9+000 abaterea e de 76 m și −61 m. În KML, distanța pe ax 7→8 e 1032 m, iar 8→9 doar 885 m, chiar în zona variantelor `kml_1378` / `kml_1400`. E o problemă a desenului KML, nu a calculului (am verificat ambele moduri de a scoate suprapunerea; rezultatul e identic). Între borne, km-ul rămâne ancorat pe borne, deci punctele dintre ele nu sunt afectate peste această zonă. De lămurit cu topograful, odată cu liniile necunoscute |
| Liniile 41+000–41+986 și cea de 916 m de la km 0 apar „necunoscute”, fără efect | **trece** (`kml_1372` 41+000–41+986, `kml_1831` 916 m; plus `kml_1400` violet 2+743–9+411, `kml_1378` 3+416–8+717, `kml_1531` 261 m spre R 2) |
| Km T12–T19 în `executie_tronsoane` = planșele 1413-01-12…19-SM | propunere gata (`E1_APPLY_PROPUS.sql` 3a); se verifică după apply |
| Km T1–T11 = PT, cu fiecare diferență decisă (Q18) | propunere gata (3c), **ține de Q18** |
| Nimic fără preview și „da”; rollback pe lista de id-uri | da: SQL-ul are preview, RETURNING și rollback, și nu a fost rulat |

## Ce s-a aflat pe drum

1. **Sursa limitelor PT**: schemele de montaj `1413-01-NN-SM` (în arhiva licitației 102 / 2023, aceeași PT 1413/2020, pe Drive) scriu „tronson N km a – km b”, în km întregi. LOT 2: T12 49–55, T13 55–60, T14 60–66, T15 66–71, T16 71–75, T17 75–79, T18 79–83, T19 83–89, confirmate și de planșele de protecție catodică. Valorile cu zecimale din analiza v2.2 (T2 până la 5+039,82; T8 29+003,84 – 35+028,81) nu le-am găsit în nicio sursă; în preview apar ca notă. `1413-01-01-SM` e scanat, iar `1413-01-02-SM` lipsește din arhivă.
2. **Depozitele LOT 2 pe km calibrat**: DM Jupânești 55+116 (în **T13**, la 116 m după limita T12/T13), DM Orșova Nord 77+016 (T17), OS Topleț 81+665 (T18). Robinetele R3 55+147, R4 81+241, R5 81+673, R6 87+259, R7 87+391.
3. **Q14 se închide**: LOT 2 n-are niciun pachet în modulul vechi.
4. **Prototipul tabletei** afișează `TR13S048` (cu zerouri), pe când fișele și IZO scriu `T8S68`. Normalizatorul acceptă ambele forme; afișarea are opțiunea `pad`. De ales înainte de E4b (recomand fără zerouri, ca în documentele Transgaz).

## Decizii și aplicare (20.10.2026, seara)

- Razvan: **da 3a, da 3b, Q18 = A, da 3c, numărul sudurii fără zerouri (`TR13S48`)**.
- Aplicate de sesiunea de chat, într-o singură tranzacție, cu gărzi de precondiție; verificate apoi prin SELECT din sesiunea Izometrie:
  - 3a: `executie_tronsoane` id **16–23** (T12–T19, proiectul 3);
  - 3b: `logistica_depozite` id **9 / 10 / 11** (JUP / ORN / TOP, site 6);
  - 3c: T1–T11 pe proiectul 1 (id 1–11) după PT; la T1 și T7 începutul real (0+050 / 24+100) e trecut în observații.
- Rollback: blocurile din `E1_APPLY_PROPUS.sql`, cu id-urile de mai sus.

## Rămâne deschis

- **Branch-ul Supabase** pentru gardă (§6.1 p10): necesită permisiunea dată direct în sesiunea Izometrie. Fără el, E2 nu pornește.
