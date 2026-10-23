# E9 B3 — livrare locală, 23.10.2026

Implementarea urmărește `E9_LOCAL_DESIGN.md`, B3 și pasajele r3. B1, B2, B4,
schema BD, funcțiile edge și UI-ul nu au fost modificate. Nu am rulat Git, nu am
accesat secrete, baza de date, API-uri de producție sau GPU. Nu am instalat nimic
din rețea. Toate scrierile și temporarele verificărilor sunt în worktree.

Fișierele noi sunt `scripts/ocr_local/e3_{contract,grila,antet,mapare,aliniere,pdf,
perspectiva,read,client,gpu,serviciu}.py`, dicționarul JSON și cerințele de mediu
`e3_requirements.txt`. `__main__.py` delegă numai prefixul nou `e3`, iar README
descrie configurația și Task Scheduler, fără scripturi .ps1/.cmd noi.

Intrări: `python -B -m ocr_local e3 serveste --config <config-local.json>`,
`e3 opreste`, `e3 stare`; alternativ `python -B -m ocr_local.e3_serviciu`.

R3-1: workerul nu calculează alte termene ale cozii, nu reia tokenuri și nu
reîncearcă arbitrajul; îl cere strict înainte de `termen_local - 40s`. Refuzul sau
pierderea răspunsului lasă celulele nestructurale null, cu avertisment. Fazele
persistente ale plății și refuzul autoritativ al tokenului sunt exclusiv B1/B2.

R3-2: Python validează separat ambii cititori, apoi identitățile și câmpurile
structurale. La aviz, Cantitate M devine lungime, cantitatea de bucăți rămâne null,
iar BUC/PCS/QTY refuză pilotul. La curbe: cantitate exact 1, serie unică, poziție
1..n, cod cu seria în primul segment, pachet prezent. Originea celulelor verifică
apartenența la pachet. Lipsurile și dublurile refuză întregul document. După
arbitraj se revalidează; lungime null este permisă cu avertisment, 0 nu este.

R3-3: schema brută Python are cheile E3 și frunze string/null, cu cele două
excepții din design. Payload-urile celor două fotografii sunt salvate în fixtures;
numerele nu sunt rescrise. Ramura de eroare are obiect null și nu ajunge la
normalizare. Numerele Python servesc doar comparării. Testul Node execută funcțiile
reale TS și traseul `normalizeazaE3 → aplicaPropunereOCR → randNormalizat`.

R3-4: OpenCV cere arie ≥50%, convexitate, unghiuri 60–120°, luminanță interior
minus banda exterioară ≥25 și gradient pe ≥70% din perimetru. Omografia transformă
cadrul întreg, cu translație și scalare la ≤25 MP; un orizont proiectiv în cadru
refuză transformarea. Testele sintetice verifică atât tabelul alb nesigur, cât și
păstrarea marcajelor exterioare unei foi dovedite. Reconcilierea adoptă numai
modele cu PID, SHA, health și nume/rădăcină conforme. Verifică lock mort / reboot,
lock laborator, restart la 22:05 și prag VRAM înainte de release. Heartbeat-ul
este separat de reconcilierea potențial lentă. Cititoarele reutilizează
`read.run_reader(lock=False)` în procese izolate, cu garda v5; la timeout procesul
este terminat, inclusiv firul MinerU. După gardă / eroare internă modelele se
reconciliază înaintea altei preluări.

R3-5: PyMuPDF în proces cu timeout 3s clasifică mono/multi/invalid/neverificabil;
respinge inclusiv PDF reparat, criptat și trunchiat. Arborele bibliotecii decide
numărul paginilor, inclusiv cu object streams și text /Type /Page în conținut.
Contractul B2 nu permite `verificare_indisponibila` la `rezultat`: helperul păstrează
clasificarea `neverificabil`, iar workerul transmite `intern` în acea situație.

Verificări executate:

- `PYTHONPATH=scripts`, Python 3.13: `python -B -m unittest discover -s
  scripts/ocr_local/tests/e3 -p "test_e3_*.py" -q` — 44 teste descoperite,
  **39 trecute, 5 omise**. Toate apelurile modelelor / edge sunt fake.
- Paritate Python–TS pe vectorii comuni și cele două payload-uri brute, plus
  prefill-ul și unitățile RPC: executate prin Node **24.20.0**, trecute.
- Parsare AST a celor 11 module E3 și `python -B -m ocr_local e3 --help`: trecute.
- `python -B -m pytest ...`: nu rulează, pytest nu este instalat. Testele sunt
  `unittest.TestCase`, compatibile cu descoperirea pytest.
- Regresia existentă `test_client.py`: importul este blocat de lipsa Pillow; nu
  declar regresia Ofertare trecută. Fișierele existente plan/read/compare/client,
  garda și protocolul nu au fost modificate.

Limite / acceptare rămasă:

- Cele trei teste de perspectivă sunt omise: lipsesc OpenCV, numpy și Pillow.
  Testul de fus orar este omis: lipsește tzdata pe Windows. Codul nu pretinde că
  aceste verificări au fost executate.
- PDF-ul **real** `imageToPdf` nu există în livrare; testul așteaptă fixture-ul
  `scripts/ocr_local/tests/e3/imageToPdf_e3.pdf` și este omis explicit. PDF-urile
  generate cu PyMuPDF nu sunt prezentate drept substitut pentru acest fixture.
- Testele nu exercită un edge B2, PostgREST sau un serviciu WSL real. Comanda
  read-only de enumerare a distribuțiilor WSL a fost refuzată de mediul local.
  Refuzul tokenului vechi este simulat la transport, nu certificat pe B1/B2.
- Tabelele așteptate sunt transcrise explicit din livrarea E9; nu înlocuiesc
  adjudecarea umană a fotografiilor. Fixture-ul MinerU cu seriile 919/932/938/915
  este refuzat structural, fără completare din codul piesei.
- Coloanele nemapate rămân null; nu deducem diametru/perete din descrierea liberă
  a avizului. Textul complet rămâne în `specificatie` pentru verificarea umană.
- Rezidența simultană, fracțiile VRAM, baza `nvidia-smi`, comenzile WSL și timpii
  trebuie verificate pe server înainte de B4. Configurația cere explicit valori
  măsurate; nu s-a activat prin presupunere varianta MinerU pornit la cerere.
- Nu există validare edge pe `schemaBrutaLocalE3` / poarta `validaStructuraE3`
  în acest chunk. Acestea și testele de componentă sunt responsabilitatea B2/B4;
  integrarea trebuie să confirme și ramura de eroare fără normalizare.

README conține operațiile și pașii necesari pentru validarea pe server. Nu s-a
creat sau pornit serviciul Windows și nu s-au înregistrat automatizări în BD.
