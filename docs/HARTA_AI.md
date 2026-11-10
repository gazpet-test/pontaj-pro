# Harta AI — desenatorul automatizărilor (format și folosire)

Cerere Răzvan, 06.11.2026: o hartă interactivă a automatizărilor AI ale Gazpet (cine rulează, pe ce cont, ce citește, ce scrie,
unde se oprește fără „da”), care să se poată actualiza și, mai târziu, să intre în ERP ca pagină owner-only.

## Ce e în repo și ce NU

| În repo (public) | În afara repo-ului |
|---|---|
| `src/HartaAI.jsx` — componenta care desenează harta | `harta.json` — datele reale (într-un folder privat, în afara repo-ului) |
| `src/hartaAILogica.js` — validare, poziții, fluxuri, detectorul de secrete | `harta_v2.html` — varianta standalone generată |
| `scripts/harta_ai/genereaza_v2.mjs` + `html.mjs` + `standalone.jsx` — generatorul HTML | README-ul cu sursele fiecărui nod |
| `scripts/harta_ai/exemplu.json` — exemplu fictiv, folosit de teste | |

Repo-ul e public, iar harta descrie infrastructura internă (servere, căi, conturi, nume de secrete). De aceea datele nu intră aici.
Componenta nu e încă legată în meniul ERP: legarea într-o pagină owner-only și citirea JSON-ului din BD se fac după decizia lui Răzvan.

## Cum generezi varianta standalone

```
node scripts/harta_ai/genereaza_v2.mjs <harta.json> <iesire.html>
```

Generatorul validează fișierul și **refuză** să scrie HTML-ul dacă găsește erori: id-uri duplicate, capete de săgeată inexistente,
fluxuri cu pași fără legătură sau orice șir care arată a valoare de secret, telefon sau CNP (tiparele sunt în `cautaSecret`).
HTML-ul rezultat e un singur fișier, fără CDN și fără rețea (React e inclus), cu JSON-ul pus într-un `<script type="application/json">`.

## Formatul `harta.json`

```jsonc
{
  "meta": { "titlu": "…", "stare_la": "06.11.2026", "nota": "…", "surse": ["…"], "emailuri_permise": ["office@…"] },
  "grupuri": [ { "id": "grup_a", "nume": "Server exemplu", "sub": "…", "culoare": "#8a5a14", "x": 0, "y": 0, "w": 420, "h": 300, "coloane": 2, "descriere": "…" } ],
  "noduri": [ {
    "id": "worker_a", "grup": "grup_a", "nume": "worker-exemplu", "sub": "proces de fundal (exemplu)",
    "tip": "worker", "stare": "activ",
    "fisa": {
      "ce_e": "…", "unde": "…", "cont": "…", "cand": "…",
      "a_extern": "…", "b_scrie": "…", "c_identitate": "…", "d_cine_porneste": "…", "e_confirmare": "…",
      "secrete": ["NUME_SECRET_EXEMPLU"], "surse": ["cale/exemplu/sursa.js"], "neverificat": ["…"]
    },
    "probleme": [ { "id": "P1", "tip": "oprire_tacuta", "gravitate": "mare", "titlu": "…", "dovada": "fișier:linie",
                    "propunere": "…", "sursa": "review X", "principal": "worker_a" } ]
  } ],
  "legaturi": [ { "id": "opțional", "de": "worker_a", "la": "api_exemplu", "ce": "text + prompt", "tip": "bani", "dublu": false, "cand": "…", "detaliu": "…", "surse": ["…"], "probleme": [] } ],
  "fluxuri": [ { "id": "seap_cerinte", "nume": "…", "descriere": "…", "drum": ["a", "b", "c"], "ramuri": [["b", "x"]], "note": ["…"] } ]
}
```

- **Grupuri**: dreptunghiuri pe hartă (coordonate în unități de desen). Nodurile fără `x`/`y` se așază singure în grila grupului,
  în ordinea din fișier (`coloane` = câte pe rând). Filtrul de grup din bara de sus le ascunde.
- **Noduri** — `tip`: `om`, `poarta` (poartă umană, chenar roșu), `sesiune`, `agent`, `rutina`, `sarcina`, `cron`, `edge`, `api`,
  `worker`, `model`, `coada`, `tabel`, `stocare`, `script`, `extern` (chenar punctat), `cheie`, `ecran`.
  `stare`: `activ`, `oprit`, `viitor`, `neverificat` (semnul ?), `eroare` (semnul !).
- **Fișa** urmează CLAUDE.md pct. 7: (a) ce conținut extern citește, (b) ce scrie / face, (c) cu ce identitate rulează,
  (d) cine îl poate porni, (e) ce cere confirmare umană. `secrete` = DOAR numele. `neverificat` = ce nu s-a putut confirma
  (se afișează pe galben); nu se ghicește.
- **Legături** = săgeți pe direcția în care merge informația; `ce` = ce trece (brief, diff, PDF, text extras, rând în BD…).
  `tip`: `date`, `comanda`, `bani` (apel plătit), `poarta` (trece prin „da”), `cod`. `dublu: true` = în ambele sensuri.
- **Probleme** (opțional, pe noduri și pe săgeți): listă de `{ id?, tip, gravitate, titlu, dovada, propunere, sursa, principal? }`.
  `tip`: `greseala_coleg`, `oprire_tacuta`, `dublura_moarta`, `propunere`; `gravitate`: `mare`, `medie`, `mica`.
  Aceeași problemă pusă pe mai multe noduri / săgeți poartă același `id` și se numără o dată; `principal` = nodul la care
  duce click-ul din lista „Top probleme”. Pe hartă: insigne pe tip (culoare + număr), butonul „⚠ Doar cu probleme”,
  secțiunea „Probleme” din fișă (cu dovada și propunerea) și lista „Top probleme” ordonată după gravitate.
- **Fluxuri** = un drum întreg (ex. „document SEAP → OCR local → API → cerințe”). Fiecare pereche consecutivă din `drum` trebuie
  să aibă o legătură în acel sens (sau `dublu`). `ramuri` = legături în plus evidențiate odată cu fluxul.

## Pe hartă

Zoom cu rotița, cu butoanele sau prin ciupit; mutare prin tragere; click pe nod = fișa lui (cu ce intră și ce iese);
click pe săgeată = ce trece pe ea; „Evidențiază un flux” stinge restul și numerotează pașii; căutarea merge fără diacritice
și găsește și după numele unui secret; Esc curăță. Săgețile curg discret pe direcția informației (oprite dacă sistemul cere
mișcare redusă sau din butonul „Animație”).
