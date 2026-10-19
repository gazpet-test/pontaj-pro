# Zone OCR cu ancore ambigue

In `scripts/ocr_local/banca.py`, `zone_banda()` verifica unicitatea ancorelor in
MinerU si incadrarea intervalului de text intre ancore in ambele fluxuri normalizate.
Motivele noi sunt `ordine_ancore`, `ancora_lipsa_b`, `ancora_neunica_b`.
La insertie/stergere, daca fragmentul celuilalt cititor exista unic in fluxul cu
interval gol, se verifica si pozitia sa reala: difflib poate reprezenta astfel
textul mutat intre coloane. Marginile si clasificarea existenta a tabelelor raman.

`esantion`, `compara` si `raport` exclud zonele ambigue din masuratori si le
contabilizeaza separat ca `ambigue_ancora`, inclusiv cand lipsesc etichetele/lotul.
Esantioanele deja inghetate nu sunt regenerate automat.

Regresii in `scripts/ocr_local/test_banca.py`: text mutat intre coloane prin
comparatorul real, ordine normala/inversata, ancora lipsa/repetata in B, ambiguitate
existenta, insertie/stergere normala, margini si excluderea din cele trei comenzi.
Regula este descrisa si in `scripts/ocr_local/README.md`.

Testarea a fost incercata offline cu `python -B`, dar executia nu a pornit:
nu exista interpretor Python pe PATH (`python`, `python3`, `py` si variantele
versionate verificate lipsesc). Testele NU sunt declarate trecute; verificarea
finala a fost doar statica. Nu s-au accesat reteaua, Git, baza de date sau productia
si nu s-au instalat dependinte.

Pentru verificare intr-un mediu cu Python, din `scripts`:
`python -B -m unittest ocr_local.test_banca -v`.
