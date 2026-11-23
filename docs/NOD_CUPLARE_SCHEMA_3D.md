# Schema 3D a nodului de cuplare (probă, 10.11.2026)

Execuție → proiect → tab „nod”: lângă vederile 2D (Plan, A…F, REZ-*) apare butonul **„🧊 3D (probă)”** dacă în bucket-ul privat
`noduri-scheme` există `<proiect>/<nod>/model_3d.json` (lângă `vederi.json`). Fără fișier = fără buton, fără mesaj.

- Țevile, coturile, teurile, reducțiile, flanșele și robinetele sunt desenate simplificat, colorate pe DN.
- Sudurile din `executie_noduri_suduri` sunt sfere colorate după stare (aceeași legendă ca în 2D); legarea se face după **cod**.
- Atingerea unei sfere deschide **aceeași fișă** ca pe vederile 2D (același RPC de schimbare a stării, aceleași reguli).
- Sudurile grupului fără loc în model apar în lista „📋 Suduri fără loc în 3D”; codurile din model care lipsesc din listă se afișează.
- Piesele și sudurile `estimat` sunt mai deschise la culoare (transparente).
- Three.js (0.186.1, fixat) se încarcă **doar** la apăsarea butonului, într-un fișier separat la build
  (`nodSchema3dThree-*.js`, ~590 KB / ~149 KB gzip de la armături, 16.11.2026); pagina principală nu crește.
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

## Beton, armături și piese înglobate (16.11.2026)

Tot formatul `gazpet-nod-3d` versiunea 1: câmpurile și tipurile de mai jos sunt **opționale**, iar modelele fără ele se citesc și
se desenează exact ca înainte (testul de regresie `src/nodSchema3dRegresie.test.jsx` compară citirea și scena, obiect cu obiect,
cu amprentele calculate de codul de dinainte, `src/nodSchema3d.regresie.json`). Logica: `src/nodSchema3dArmare.js`.

```json
{
  "id": "fundatie", "titlu": "Fundație", "prefixe": [], "teren_z": -150, "suduri": [], "fara_pozitie": [],
  "armare": {
    "stare_lista": "neconfirmata",
    "de_confirmat": ["Lungimea mărcii 2: 2,70 m, nu 2,40 m."],
    "marci": [{ "marca": "1", "d": 14, "otel": "PC52", "buc": 24, "lungime_mm": 3400, "kg_m": 1.21, "forma": "U: 135 + 70 + 135 cm" }],
    "extras_kg": 187, "extras_sursa": "Extrasul de armătură de pe planșă"
  },
  "elemente": [
    { "tip": "beton", "min": [-600, -600, -1050], "max": [600, 600, -250], "et": "Bloc C16/20" },
    { "tip": "bara", "marca": "1", "d": 14, "r": 42, "puncte": [[-343, -320, 350], [-343, -320, -993], [343, -320, -993], [343, -320, 350]] },
    { "tip": "bulon", "d": 20, "r": 40, "puncte": [[-250, -290, 700], [-250, -290, -40], [-169, -290, -40]], "et": "B1", "cert": "estimat" },
    { "tip": "placa", "centru": [0, 0, 650], "lx": 700, "ly": 700, "grosime": 15, "gol": 200, "et": "P1", "cert": "estimat" }
  ]
}
```

| Tip | Câmpuri | Notă |
|---|---|---|
| `beton` | `min`, `max` (colțurile cutiei, mm) | semitransparent, cu muchii; treptele = mai multe cutii |
| `bara` | `marca`, `d` (diametrul REAL, 4–60 mm), `r` (raza de îndoire în ax, 0 = colț), `puncte` (vârfurile în axul barei, 2–200) | îndoiri la orice unghi, rotunjite cu `r` |
| `bulon` | `d`, `r`, `puncte` | piesă înglobată (nu armătură) |
| `placa` | `centru` (centrul feței de jos), `lx`, `ly`, `grosime`, `gol` (diametru, opțional) | piesă înglobată, orizontală |

- `cert: "estimat"` pe orice element = desenat mai deschis; legenda numără barele și piesele estimate.
- Blocul `armare` (pe grup): `stare_lista` = `neconfirmata` (banner galben „NECONFIRMATĂ DE OM” + lista `de_confirmat`) sau
  `confirmata`; `marci` = rândurile din extras (marca, Ø, oțel, bucăți total, lungimea unei bare în mm, opțional kg/m și forma);
  `extras_kg` (opțional) = greutatea totală din extras, pentru rândul de control.
- Validarea respinge, cu motiv în „Schema 3D, părți ignorate” (nimic nu se completează în tăcere): bara fără diametru sau fără rază,
  diametrul diferit de al mărcii, marca necunoscută, segmentul sub 1 mm, unghiul peste 179° (bara s-ar întoarce pe ea însăși),
  raza care nu încape pe segment (toleranță 0,5 mm), cutia goală / întoarsă, placa cu golul mai mare decât latura, blocul `armare`
  cu câmpuri necunoscute sau stare greșită, marca invalidă / duplicată / fără bucăți sau lungime, textele de alt tip decât șir
  sau număr (`otel`, `forma`, `et`, `extras_sursa`, punctele `de_confirmat`: un obiect sau o listă e eroare, nu „[object Object]”).
- **Controlul extrasului nu se micșorează în tăcere** (review r2): o marcă respinsă la citire rămâne în totalul de bucăți al
  extrasului (bucăți necitibile = „+ ?”); o marcă fără nicio bară validă rămâne în legendă cu „0 / N” și „fără bare”. În ambele
  cazuri (și când bucățile desenate diferă de extras) rândul „Control INCOMPLET” spune de ce, iar controlul nu mai iese verde,
  oricât de aproape ar fi greutatea. 0 bucăți în extras e o valoare citită: marca e respinsă ca imposibilă, cu „0 buc.” în motiv
  (nu „bucăți necitite”).
- **Controlul se face pe fiecare marcă, nu pe totaluri** (review r3): verde doar dacă FIECARE marcă are exact bucățile din extras
  și lungimea în ±1 mm. Două greșeli opuse (marca 1 cu o bară în plus, marca 2 cu una în minus; sau lungimi greșite în sensuri
  opuse) dau același total de bucăți / aceeași greutate, dar controlul iese INCOMPLET, cu mărcile care nu se potrivesc.
- `prefixe: []` e permis doar la un grup fără nicio sudură (ex. o fundație); cu suduri, prefixele rămân obligatorii.
- Ecranul: butoanele „🧱 Beton”, „🔩 Piese” (buloane, plăci) și „🎨 Pe marcă / Pe diametru”; sub scenă legenda pe mărci (👁 / 🚫
  ascunde marca; Ø, oțel, bucăți desenate / extras, lungimea din extras și cea desenată, kg desenate), totalul și rândul
  „Greutate desenată X kg față de extras Y kg (±Z%)” (verde până la ±2% și doar cu controlul complet). Fără `extras_kg`, rândul
  scrie „extras necunoscut” (nu lipsește, nu 0). Bucățile sau lungimile care nu se potrivesc sunt roșii.
- În „Toată instalația” fiecare grup cu armare are panoul lui (cu titlul grupului): avertismentul „NECONFIRMATĂ DE OM”, punctele de
  confirmat și controlul rămân și în vederea comună. Avertismentul și „estimate” nu depind de mărcile ascunse sau de culoare.
- O marcă scrisă „beton” sau „inglobate” rămâne marcă: grupurile interne ale scenei (betonul, piesele) nu se iau după textul mărcii.
- Lungimea desenată se măsoară **ca în extras**: segmentele în ax + d/2 la fiecare capăt îndoit (laturile pe exterior);
  greutatea = lungime × 7850 kg/m³ × secțiunea barei. E convenția extrasului, nu lungimea dezvoltată pe axa barei cu arcele
  îndoirilor: rândul de control verifică potrivirea cu extrasul, nu masa fizică exactă (o notă scurtă o spune și în ecran).
- Testele scenei rulează pe un DOM fals minim (`src/nodSchema3dDomFals.testutil.js`), fără jsdom, deci nu se mai sar; referința
  regresiei (`src/nodSchema3d.regresie.json`) e verificată și ea (intrările, numărul de scene, amprenta fișierului). În CI le
  rulează `.github/workflows/izometrie-3d.yml` (PR gata de review pe fișierele schemei 3D, sau pornit manual).
- Exemplul complet: `src/nodSchema3d.fundatie-F6.json` (fundația unui rezervor suprateran, 2 bucăți: 56 de bare, 186,63 kg desenate
  față de 187 kg în extras, lista neconfirmată de om, cu 7 puncte de confirmat). În ecran ajunge doar dacă grupul lui e urcat în
  `model_3d.json` al unui nod (vezi mai sus).

## Cum se face modelul

Modelul se generează din planșele de montaj (cote + tabelul de materiale + dimensiuni standard pentru coturi / flanșe / robinete),
parcurgând fiecare legătură piesă cu piesă. Planșele sunt ale Transgaz: **modelul real și generatorul nu intră în repo** (repo public);
stau pe serverul intern, iar chat-ul urcă `model_3d.json` în bucket. În repo sunt doar codul aplicației și exemple sintetice.
