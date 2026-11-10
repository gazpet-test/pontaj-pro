# Schema 3D a nodului de cuplare (probă, 10.11.2026)

Execuție → proiect → tab „nod”: lângă vederile 2D (Plan, A…F, REZ-*) apare butonul **„🧊 3D (probă)”** dacă în bucket-ul privat
`noduri-scheme` există `<proiect>/<nod>/model_3d.json` (lângă `vederi.json`). Fără fișier = fără buton, fără mesaj.

- Țevile, coturile, teurile, reducțiile, flanșele și robinetele sunt desenate simplificat, colorate pe DN.
- Sudurile din `executie_noduri_suduri` sunt sfere colorate după stare (aceeași legendă ca în 2D); legarea se face după **cod**.
- Atingerea unei sfere deschide **aceeași fișă** ca pe vederile 2D (același RPC de schimbare a stării, aceleași reguli).
- Sudurile grupului fără loc în model apar în lista „📋 Suduri fără loc în 3D”; codurile din model care lipsesc din listă se afișează.
- Piesele și sudurile `estimat` sunt mai deschise la culoare (transparente).
- Three.js (0.186.1, fixat) se încarcă **doar** la apăsarea butonului, într-un fișier separat la build
  (`nodSchema3dThree-*.js`, ~571 KB / ~142 KB gzip); pagina principală nu crește.
- Fără tabele noi, fără migrări: modelul e un fișier static, urcat în bucket de chat.

## Formatul `model_3d.json` (versiunea 1)

Coordonate în **mm**, `z` în sus, `z = 0` la teren. Validarea (`parseModel3d` din `src/nodSchema3dLogica.js`) nu ascunde nimic:
un element sau o sudură invalidă apare în mesajul „Schema 3D, părți ignorate”, restul se afișează.

```json
{
  "format": "gazpet-nod-3d", "versiune": 1, "unitate": "mm", "nod": "NOD-TEST", "titlu": "Exemplu",
  "note": ["Model schematic: pozițiile sunt calculate din planșă."],
  "grupuri": [{
    "id": "rezervoare", "titlu": "Rezervoare", "prefixe": ["CR"], "teren_z": 0,
    "elemente": [
      { "tip": "rezervor", "a": [-2450, 0, 1516], "b": [2450, 0, 1516], "d": 1200, "et": "Rezervor" },
      { "tip": "teava", "a": [0, 0, 0], "b": [1000, 0, 0], "dn": 250, "et": "poz. 24", "cert": "desen" },
      { "tip": "cot", "a": [1000, 0, 0], "c": [1381, 0, 0], "b": [1381, 0, 381], "dn": 250 },
      { "tip": "teu", "a": [1381, 0, 381], "b": [1381, 0, 813], "r": [1562, 0, 597], "dn": 250, "dn2": 100 },
      { "tip": "robinet", "a": [1381, 0, 900], "b": [1381, 0, 1468], "dn": 250, "et": "RAM 10", "cert": "estimat" },
      { "tip": "eticheta", "p": [0, 0, 2500], "text": "spre coș" }
    ],
    "suduri": [{ "cod": "CR-001", "p": [1000, 0, 0], "cert": "desen" }],
    "fara_pozitie": [{ "cod": "CR-114", "motiv": "cot de confirmat" }]
  }]
}
```

| Tip | Câmpuri | Notă |
|---|---|---|
| `teava`, `stut`, `flansa`, `reductie`, `robinet` | `a`, `b`, `dn` (`dn2` la reducție) | segment de la `a` la `b` |
| `cot` | `a`, `c` (colțul), `b`, `dn` | arc între capete |
| `teu` | `a`, `b` (trecerea), `r` (capătul ramificației), `dn`, `dn2` opțional | |
| `rezervor` | `a`, `b` (capetele axei), `d` (diametrul) | funduri bombate |
| `eticheta` | `p`, `text` | text în scenă |

- `cert`: `desen` (din cotele planșei / tabel) sau `estimat`. Lipsă = `desen`.
- `prefixe`: codurile sudurilor care țin de grup (ex. `CR`); sudurile cu aceste prefixe fără poziție intră în lista „fără loc în 3D”.
- `teren_z: null` = fără teren (ex. o schemă fără cote de amplasare).
- Fiecare grup se vede și singur (selector deasupra filtrelor), în sistemul lui de coordonate.

## Amplasarea grupurilor și vederea „🏗 Toată instalația” (varianta B, 10.11.2026)

Câmp **opțional** pe grup (formatul rămâne `versiune: 1`; modelele fără el se comportă exact ca înainte):

```json
{ "id": "gara", "prefixe": ["CP"], "amplasare": { "origine": [12000, -3500, 0], "rot_z": 90 }, "elemente": [], "suduri": [] }
```

- `origine` = unde ajunge originea grupului în **sistemul comun al nodului** (mm); `rot_z` = rotirea grupului în jurul axei z,
  în grade, sens trigonometric (întâi rotirea în originea grupului, apoi mutarea). Terenul comun e la `z = 0` al sistemului comun.
- Validare strictă: exact câmpurile `origine` (3 numere finite, în ±1 km) și `rot_z` (număr între -360 și 360); niciun alt câmp.
  Și punctele grupului, după amplasare, trebuie să rămână în ±1 km. Amplasarea invalidă = mesaj în „Schema 3D, părți ignorate”,
  iar grupul **rămâne** (fără amplasare): se vede în vederea lui, nu în cea comună.
- Vederea „Toată instalația” apare doar dacă **cel puțin două** grupuri au amplasare validă și e cea implicită atunci. Arată toate
  grupurile amplasate în aceeași scenă; grupurile neamplasate sunt enumerate deasupra („Nu sunt amplasate: …”).
- În vederea comună: aceleași sfere, aceeași fișă, aceleași filtre. „Fără loc în 3D” și „în schemă, dar nu în listă” se calculează
  pe reuniunea grupurilor amplasate, fără dubluri; două suduri din grupuri diferite care ajung în același loc (≤ 1 mm) sunt o sferă.
  „Același loc” se caută pe o grilă cu latura de 2 mm (vecinii din celulele alăturate), cu rezultat identic cu compararea
  fiecare-cu-fiecare și la limita de rotunjire a pragului (test de paritate).
- Grupurile pot fi depărtate (până la ±1 km): planul îndepărtat al camerei se potrivește la fiecare randare după sfera care
  cuprinde toată scena, deci piesele și sudurile nu dispar la încadrare sau la zoom înapoi (nodurile obișnuite rămân la 1000 m).
- Sub scenă: câte un buton pe grup (👁 arată / 🚫 ascunde) și „⤢ Du-mă la” (camera pe grup); butonul „🏷 Etichete” ascunde
  etichetele de tip `eticheta`. Piesele fiecărui grup sunt lipite pe material (câteva apeluri de desenare în loc de sute).

## Cum se face modelul

Modelul se generează din planșele de montaj (cote + tabelul de materiale + dimensiuni standard pentru coturi / flanșe / robinete),
parcurgând fiecare legătură piesă cu piesă. Planșele sunt ale Transgaz: **modelul real și generatorul nu intră în repo** (repo public);
stau pe serverul intern, iar chat-ul urcă `model_3d.json` în bucket. În repo sunt doar codul aplicației și exemple sintetice.
