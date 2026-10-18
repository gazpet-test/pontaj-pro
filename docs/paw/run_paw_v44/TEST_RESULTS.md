# Validare locala v4.4 r2 - 2026-10-18

Rezultate masurate in worktree, cu date sintetice si copii ale lansatorului.
Nicio rulare Codex reala, instalare, certificat, autentificare sau acces DB.

| Suita | Rezultat | Ce acopera |
|---|---|---|
| python -I docs/paw/run_paw_v44/teste/test_cdx.py | 14 trecute, 1 SKIPPED; ultima 37.418 s | worktree/base/commit/diff, refuz fara certificat, slug/cale, timeout+copil, lock, tinta/fetch esuat, secret env absent, tmp sters, metadate Git schimbate, filter/nested Git/hardlink refuzate, lock hardlink netrunchiat |
| python -I docs/paw/run_paw_v44/teste/test_cdx_security.py | 29 cazuri trecute (subteste); ultima 0.689 s | sintaxa tuturor PS1, ACL owner/writer (descriptor sintetic), cai rezervate/ADS/UNC/reparse/root/hardlink, allowlist env/config Git, hash set extra/metadata, quoting intern, refuz certificare numai din relatarea modelului/lipsa incercare/dubluri |
| python -I docs/paw/run_paw_v44/teste/test_cdx_installer.py | 4 trecute; ultima 1.466 s | numai Prepare pe copii: hash manifest gresit, helper modificat, stage existent, bytes copiate identic; fara marker/config instalare |
| python -I docs/paw/run_paw_v44/teste/test_run_paw.py | 33 trecute; 57.277 s | regresii canale legacy cu stuburi, Job Object, lock, bariera de procese, fara browser/model real |

Total: 80 verificari/cazuri trecute, 1 test OS SKIPPED. Cifra nu reprezinta
80 teste de penetrare independente: include 29 subteste dintr-un singur harness.
Git diff --check trecut; manifestul se verifica pe octetii exacti, cu .gitattributes -text.

Testele cdx inlocuiesc DOAR in copii temporare ACL/binding/runtime/origin cu
fixture-uri. Codul livrat NU contine flag sau variabila de mediu pentru bypass.
Config Git de test permite un origin bare local, fara conexiuni GitHub. Nu s-a
rulat GCM sau citit vreun secret real. Niciun credential manager nu este certificat
prin testul sintetic de quoting.

Primele executii limitate de sandboxul agentului au refuzat TEMP/Add-Type si
interogarea/oprirea proceselor. TEMP a fost mutat in fixture; testele Job/process
au fost rerulate cu permisiunea necesara pentru testele locale. Au fost remediate
si verificate: nume NTFS cu punct final, mediu Path/PATH duplicat in .NET Framework,
si adaptarea harness-ului la noua bariera. Aceste esecuri intermediare nu sunt
certificate de izolarea produsului.

NETESTAT: Install pe ProgramData, ACL reale de instalare, copierea npm reala,
swap/rollback, schedulerul de certificare, sandbox elevated real, apply_patch
real, canarii/reteaua/profilul reale, autentificarea CODEX_HOME si GCM/fetch privat.
Fara audit sursa exact-tag pentru toate scrierile hostului. Varianta PawCdx nu
este implementata. Citirea profilului poate bloca poarta native: nu se elimina
proba pentru a obtine PASS. Nicio afirmatie de GO pentru activare.

SHA256.json: 3098484BD2E01B3C07076131CBA12FFEFC01E89A91924E42C4D5864C8EAA9DA3
Acesta este hash-ul setului de sapte artefacte de instalare, nu un certificat OS.
