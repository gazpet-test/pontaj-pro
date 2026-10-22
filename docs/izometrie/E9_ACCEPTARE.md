# E9 — acceptare B4

Stare: **acceptarea reală NU este executată**. Acest fișier este protocolul de
completat de Claude/Răzvan după integrarea B1–B3. Nicio cifră de precizie,
latență sau economie nu este dedusă din testele simulate.

## Setul și înregistrarea rezultatelor

Alegeți 10–20 documente reale: avize de țeavă și liste de curbe, scanuri drepte
și fotografii din unghi. Omul adjudecă fiecare câmp după original înainte de
compararea rezultatelor. Includeți zerouri inițiale, kg cu separatori, metri cu
zecimale, pachete cu celule unite și câmpuri nestructurale ilizibile.

Pentru fiecare document completați:

| Câmp | Valoare de înregistrat |
|---|---|
| Identificator anonimizat, șablon, orientare | — |
| Valori adjudecate de om (antet + fiecare rând/câmp) | — |
| `cerere_id` local, model/versiuni, hardware | — |
| Rezultat local / local + arbitraj, câmp cu câmp | — |
| Rezultat Haiku integral, câmp cu câmp | — |
| Diferențe structurale și nestructurale, omisiuni/duplicări | — |
| Preluare, pregătire, citire, arbitraj, total (secunde măsurate) | — |
| Modele rezidente simultan, VRAM | — |
| Cost real local/arbitraj/fallback și pilot separat | — |
| Rezervare și decontare din `ai_plafon_rezervari` | — |
| Sursa/costul afișate în UI concordă cu serverul | — |
| Verificator, dată și verdict pe document | — |

Costul rezervat nu se declară cost real. După timeout, o rezervare păstrată se
notează ca atare; costul necunoscut nu devine zero. Pilotul comparativ este o
acțiune separată plătită, pornită de om. Nu rerulați automat pentru un rezultat
mai convenabil. Concluziile privesc exclusiv documentele testate.

## Scenarii de integrare și UI

- `gata` local: sursă „Local LightOn+MinerU”; arbitraj: „Local + Haiku pe N celule”.
- `expirata` / `esuata` / structură incertă / multipagină / timeout după admitere:
  un singur `fallback`, sursă „Haiku fallback”, fără apel suplimentar la pilot.
- `cere` refuzat 409/429 și noapte 22:00–06:00 Europe/Bucharest: Haiku direct
  în aceeași operație și același lock. B2 nu oferă ID pentru aceste refuzuri.
- Heartbeat `noapte` / `oprit` / `eroare` / `pornire`, inclusiv semn expirat:
  refuzul local produce automat rezerva. Testați și schimbarea orei de vară.
- PDF invalid/criptat, lipsă drepturi și fișier prea mare: eroare fără rezervă automată.
- Fallback `in_curs` ori răspuns HTTP pierdut: recuperare doar prin `stare`.
  Plafon epuizat / apel deja consumat / apel pierdut: fără o nouă cheltuială automată.
- Termene server 90 s local / 120 s fallback, plus marja UI de 5 s:
  verificarea finală citește starea autoritativă; nu se resetează termenele la polling.
- Schimbare document/proiect/depozit/șablon/fișier/revizie sau demontare:
  se abandonează, fără propunere tardivă și fără pornirea rezervei.
- Dublu-clic și clic pe pilot în timpul citirii: o singură operație.
- Răspunsul nu aplică și nu salvează. Verificați separat clicurile „Aplică în
  formular”, „Toate primite”, corecțiile, salvarea, verificarea și confirmarea.
- Fotografia rotită/decupată și telefonul folosesc aceeași citire. Verificați
  scanul aplicat și atașarea lui pe fluxul existent.

Acceptarea rămâne deschisă până la executarea scenariilor și completarea
fișelor documentelor. Nu există un verdict de superioritate a OCR-ului local.
