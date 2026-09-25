# Conversie .doc / .xls / .rtf cu LibreOffice headless pe NAS (E4 — plan, NU deployat)

Stare 25.09.2026: .doc se citește deja ca TEXT (word-extractor, în edge `ofertare-word-text` și în workerul Terra).
Ce NU dă word-extractor: paginație, tabele fidele, imagini/ștampile. LibreOffice ar da un PDF care intră pe
drumul PDF existent (pdftotext → marcaje ⟦PAGINA n⟧ → citare cu pagină).

## Arhitectura
```
Supabase Storage ──(worker ofertare, are cheile)──► /conv/in/<sha256>.doc
                                                        │ volum partajat NAS
                              container convertor-doc ◄─┘  (fără rețea, fără chei)
                                                        │
worker ofertare ◄── /conv/out/<sha256>.pdf + <sha256>.json
   └─ verifică hash-urile, urcă PDF-ul lângă original și scrie textul
```
Fișiere: `deploy/libreoffice/Dockerfile`, `convertor.sh`, `docker-compose.yml`.

## Reguli de izolare
1. Containerul LibreOffice NU are chei Supabase și NU are rețea (`network_mode: none`); rootfs read-only,
   `cap_drop: ALL`, `no-new-privileges`, user neprivilegiat, limite mem/cpu/pids, timeout 180 s per fișier.
   Motiv: parsează fișiere de la terți (primării, SEAP) — un exploit de parser rămâne într-o cutie fără nimic de furat și fără ieșire.
2. Singurul canal = volumul `/volume1/docker/ofertare-conv` (`in/`, `out/`, `err/`). Macro-urile nu rulează
   (`--convert-to` headless, profil nou în /tmp).
3. Workerul ofertare (Terra) rămâne singurul cu chei; el pune fișierul și ia rezultatul.

## Legătura fișier convertit ↔ original (hash-uri)
- Workerul calculează `sha256` pe octeții descărcați din Storage și scrie `in/<sha256>.<ext>` atomic (`.tmp` + rename).
- Convertorul refuză orice fișier al cărui nume ≠ sha256 real al conținutului.
- Rezultat: `out/<sha256>.pdf` + `out/<sha256>.json` `{sha256_original, sha256_pdf, convertit_la}`.
- Workerul verifică `sha256_original` == hash-ul originalului și `sha256_pdf` == hash-ul PDF-ului primit.
- În BD (propunere, fără coloană nouă): `antet.conversie = {sha256_original, sha256_pdf, motor:'libreoffice', versiune}`.
  PDF-ul se urcă lângă original (`<fisier>.conv.pdf`); originalul NU se înlocuiește.
- Citările rămân pe documentul original, cu mențiunea „pagină din conversia PDF” (paginația depinde de fonturi).

## Pași de implementare (după aprobare)
1. Build + test local pe 3 fișiere reale (Vâlcelele: contract + formulare; F3 .doc).
2. Pe NAS: `docker compose -f deploy/libreoffice/docker-compose.yml up -d --build`; același volum montat în workerul ofertare
   (+ `--allow-read/--allow-write=/conv` în entrypoint).
3. `worker/ofertare/ingest.ts`: .doc/.rtf/.xls → `in/`, așteaptă `out/` max 5 min, apoi drumul PDF local existent.
   Fallback: rămâne textul word-extractor.
4. `claude_docs.registru_automatizari` + fișa de securitate: (a) citește fișiere externe (SEAP); (b) scrie doar în volum;
   (c) fără identitate/chei; (d) pornit doar de workerul ofertare; (e) nicio acțiune ireversibilă — originalul rămâne neatins.

## Riscuri / de decis
- Fonturi: fără Times New Roman/Arial originale paginația diferă → Liberation/Carlito/Caladea (metrice compatibile).
- Imagine ~600 MB; ~300–500 MB RAM per conversie → o singură conversie simultan.
- Actualizări de securitate LibreOffice: rebuild lunar al imaginii.
